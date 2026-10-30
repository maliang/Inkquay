import { countWords } from '../db.ts';
import { allRows, kindOf, listStageItemRows, listUnits, oneRow, parseJson, requireProject, getStageItemRow } from './store.ts';
import { CONTEXT_BUDGET, fail, kindProfileOf } from './types.ts';
import type { StepContext, StepProject } from './prompts.ts';
import type { ActPayload, BeatPayload, CharacterPayload, EnvPayload, WorldPayload } from './validate.ts';

/**
 * 上下文装配与预算（ARCHITECTURE §4.2）。
 * 总预算 12000 字符，按 L0..L6 依次装箱；超预算时从最可牺牲的层级开始截断，
 * 绝不把全书正文塞进上下文。
 */

export interface Truncation {
  layer: string;
  dropped: number;
}

export interface LoadedContext extends StepContext {
  truncated: Truncation[];
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function projectStep(projectId: string): StepProject {
  const row = requireProject(projectId);
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    genre: row.genre || '',
    premise: row.description || '',
    targetWords: Number(row.goal_words || 0),
    styleNotes: row.style_notes || '',
  };
}

export function loadContext(projectId: string, options: { note?: string } = {}): LoadedContext {
  const project = projectStep(projectId);
  const kind = kindOf(projectId);
  const profile = kindProfileOf(project.type);

  const worldRow = listStageItemRows(projectId, 'p1', 'world')[0];
  const world: WorldPayload | null = worldRow
    ? {
        era: textOf(parseJson<Record<string, unknown>>(worldRow.payload, {}).era),
        worldRules: textOf(parseJson<Record<string, unknown>>(worldRow.payload, {}).worldRules),
        worldRulesNotNeeded: Boolean(parseJson<Record<string, unknown>>(worldRow.payload, {}).worldRulesNotNeeded),
        tone: textOf(parseJson<Record<string, unknown>>(worldRow.payload, {}).tone),
        language: textOf(parseJson<Record<string, unknown>>(worldRow.payload, {}).language),
      }
    : null;

  const environments: EnvPayload[] = listStageItemRows(projectId, 'p1', 'env').map((row) => {
    const payload = parseJson<Record<string, unknown>>(row.payload, {});
    return {
      name: row.title || textOf(payload.name),
      type: textOf(payload.type),
      mood: textOf(payload.mood),
      reason: textOf(payload.reason),
    };
  });

  const characters: CharacterPayload[] = allRows('SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order ASC', projectId).map((row) => ({
    name: String(row.name || ''),
    role: String(row.role || ''),
    motivation: String(row.motivation || ''),
    age: String(row.age || ''),
    personality: String(row.description || ''),
    secret: String(row.secret || ''),
    tags: parseJson<string[]>(row.tags, []),
    isProtagonist: Boolean(row.is_protagonist) || /主角/.test(String(row.role || '')),
  }));

  const acts: ActPayload[] = kind === 'novel'
    ? allRows('SELECT * FROM outline_acts WHERE project_id = ? ORDER BY sort_order ASC', projectId).map((row) => ({
        title: String(row.title || ''),
        function: String(row.act_function || ''),
        summary: String(row.summary || ''),
        characters: parseJson<string[]>(row.characters, []),
      }))
    : listStageItemRows(projectId, 'p2', 'beat_group').map((row) => {
        const payload = parseJson<Record<string, unknown>>(row.payload, {});
        return {
          title: row.title,
          function: textOf(payload.function),
          summary: textOf(payload.summary),
          characters: Array.isArray(payload.characters) ? (payload.characters as string[]) : [],
        };
      });

  const beats: Array<BeatPayload & { actId: string; actTitle: string }> = kind === 'novel'
    ? allRows('SELECT * FROM outline_beats WHERE project_id = ? ORDER BY sort_order ASC', projectId).map((row) => ({
        title: String(row.title || ''),
        function: String(row.beat_function || ''),
        summary: String(row.summary || ''),
        plannedChapters: Number(row.planned_chapters || 1),
        foreshadow: String(row.foreshadow || ''),
        actId: String(row.act_id || ''),
        actTitle: String(row.act_title || ''),
      }))
    : [];

  const units = listUnits(projectId).map((unit) => ({
    id: unit.id,
    ordinal: unit.ordinal,
    title: unit.title,
    planFunction: unit.planFunction,
    planSynopsis: unit.planSynopsis,
    minWords: unit.minWords,
    targetWords: unit.targetWords,
    maxWords: unit.maxWords,
  }));

  const context: LoadedContext = { project, profile, world, environments, characters, acts, beats, units, note: options.note, truncated: [] };
  return fitBudget(context);
}

function fitBudget(context: LoadedContext): LoadedContext {
  const layers: Array<{ name: string; weight: number; measure: (ctx: LoadedContext) => number; shrink: (ctx: LoadedContext) => boolean }> = [
    { name: 'L1:world', weight: 1200, measure: (ctx) => JSON.stringify(ctx.world || {}).length, shrink: (ctx) => shrinkWorld(ctx) },
    { name: 'L2:characters', weight: 2500, measure: (ctx) => JSON.stringify(ctx.characters || []).length, shrink: (ctx) => shrinkCharacters(ctx) },
    { name: 'L3:outline', weight: 1500, measure: (ctx) => JSON.stringify(ctx.acts || []).length + JSON.stringify(ctx.beats || []).length, shrink: (ctx) => shrinkOutline(ctx) },
    { name: 'L6:units', weight: 600, measure: (ctx) => JSON.stringify(ctx.units || []).length, shrink: (ctx) => shrinkUnits(ctx) },
  ];
  const total = () => JSON.stringify({ world: context.world, env: context.environments, characters: context.characters, acts: context.acts, beats: context.beats, units: context.units }).length;
  if (total() <= CONTEXT_BUDGET) return context;
  // 先按最可牺牲的顺序反复裁剪，直到回到预算内或没有可裁剪的层
  for (let round = 0; round < 40 && total() > CONTEXT_BUDGET; round += 1) {
    let shrunk = false;
    for (const layer of [...layers].reverse()) {
      if (total() <= CONTEXT_BUDGET) break;
      const before = layer.measure(context);
      if (before <= layer.weight * 0.25) continue;
      if (layer.shrink(context)) {
        context.truncated.push({ layer: layer.name, dropped: Math.max(0, before - layer.measure(context)) });
        shrunk = true;
      }
    }
    if (!shrunk) break;
  }
  return context;
}

function shrinkWorld(context: LoadedContext): boolean {
  if (!context.world) return false;
  context.world = { ...context.world, language: context.world.language.slice(0, 20) };
  return true;
}

function shrinkCharacters(context: LoadedContext): boolean {
  const list = context.characters || [];
  if (list.length > 8) {
    context.characters = list.slice(0, Math.max(4, Math.floor(list.length * 0.7)));
    return true;
  }
  if (list.some((item) => item.personality.length > 30)) {
    context.characters = list.map((item) => ({ ...item, personality: item.personality.slice(0, 30) }));
    return true;
  }
  if (list.length > 1) {
    context.characters = list.slice(0, list.length - 1);
    return true;
  }
  return false;
}

function shrinkOutline(context: LoadedContext): boolean {
  const beats = context.beats || [];
  if (beats.length > 6) {
    context.beats = beats.slice(0, Math.max(4, Math.floor(beats.length * 0.7)));
    return true;
  }
  const acts = context.acts || [];
  if (acts.some((act) => act.summary.length > 60)) {
    context.acts = acts.map((act) => ({ ...act, summary: act.summary.slice(0, 60) }));
    return true;
  }
  return false;
}

function shrinkUnits(context: LoadedContext): boolean {
  const units = context.units || [];
  if (units.length > 12) {
    context.units = units.slice(0, 12);
    return true;
  }
  return false;
}

/** P4 需要的「上一单元梗概 + 结尾原文」，长篇读 chapters，短篇读 stage_items.body。 */
export function previousUnit(projectId: string, unitId: string, kind: 'novel' | 'short'): { title: string; synopsis: string; tail: string } | null {
  const units = listUnits(projectId);
  const index = units.findIndex((unit) => unit.id === unitId);
  if (index <= 0) return null;
  const previous = units[index - 1];
  if (kind === 'short') {
    const row = getStageItemRow(previous.id);
    const body = String(row?.body || '');
    return { title: previous.title, synopsis: previous.planSynopsis, tail: body.slice(-500) };
  }
  const row = oneRow('SELECT content FROM chapters WHERE id = ?', previous.id);
  const body = String(row?.content || '');
  return { title: previous.title, synopsis: previous.planSynopsis, tail: body.slice(-500) };
}

export function wordCountOf(text: string): number {
  return countWords(text);
}

export function notFound(message: string): never {
  fail('NOT_FOUND', message);
}
