import { countWords, now, uid } from '../db.ts';
import { createChapterVersion } from '../repository.ts';
import { callModel, resolveSelection } from '../provider/call.ts';
import { allRows, exec, getStage, insertStageItem, listStageItemRows, listUnits, markDownstreamStale, oneRow, parseJson, requireProject, touchProject, updateStage, updateStageItem, withTx } from './store.ts';
import type { JobRow } from './store.ts';
import { addRevision, appendJobEvent, pruneItemRevisions, setStageStatus } from './store.ts';
import { findItemRow, stageKeyOfTable } from './store.ts';
import { DEFAULT_WORD_RANGE, fail, kindProfileOf } from './types.ts';
import type { StageKey } from './types.ts';
import { buildActsPrompt, buildBeatsPrompt, buildChapterPlanPrompt, buildCharactersPrompt, buildEnvPrompt, buildWorldPrompt, buildWritingPrompt, mockStepText } from './prompts.ts';
import type { StepContext } from './prompts.ts';
import { loadContext, previousUnit } from './context.ts';
import type { LoadedContext } from './context.ts';
import {
  formatErrors,
  parseJsonResponse,
  parseProseResponse,
  validateActs,
  validateBeats,
  validateChapterPlan,
  validateChapterText,
  validateCharacters,
  validateEnvList,
  validateWorld,
} from './validate.ts';
import type { ActPayload, BeatPayload, CharacterPayload, ChapterPlanPayload, EnvPayload, WorldPayload } from './validate.ts';

export interface StepDef {
  op: string;
  targetId?: string;
}

export interface StepOutcome {
  label: string;
  unitsDone: number;
  words: number;
}

/** P3 每批最多 20 单元（ARCHITECTURE §4.1）。 */
export const PLAN_BATCH_SIZE = 20;
export function planStepsForStage(projectId: string, stageKey: StageKey, options: { block?: string; targetId?: string } = {}): StepDef[] {
  const project = requireProject(projectId);
  const profile = kindProfileOf(project.type);
  if (stageKey === 'p1') {
    if (options.block) return [{ op: options.block }];
    return [{ op: 'world' }, { op: 'env' }, { op: 'characters' }];
  }
  if (stageKey === 'p2') {
    if (options.block === 'acts') return [{ op: 'acts' }];
    if (options.block === 'beats') return [{ op: 'beats', targetId: options.targetId }];
    const context = loadContext(projectId);
    const acts = context.acts || [];
    return [{ op: 'acts' }, ...acts.map((_act, index) => ({ op: 'beats', targetId: String(index) }))];
  }
  if (stageKey === 'p3') {
    const units = Math.max(profile.minUnits, Math.min(profile.maxUnits, Math.round(Number(project.goal_words || profile.defaultGoalWords) / profile.defaultUnitWords)));
    const total = clamp(units, profile.minUnits, profile.maxUnits);
    const steps: StepDef[] = [];
    for (let start = 0; start < total; start += PLAN_BATCH_SIZE) {
      steps.push({ op: 'plan', targetId: `${start}:${Math.min(PLAN_BATCH_SIZE, total - start)}` });
    }
    return steps;
  }
  return writingSteps(projectId);
}

export function writingSteps(projectId: string, options: { unitId?: string; statuses?: string[] } = {}): StepDef[] {
  const statuses = options.statuses ?? ['pending', 'changes_requested'];
  const units = listUnits(projectId);
  return units.filter((unit) => (options.unitId ? unit.id === options.unitId : statuses.includes(unit.reviewStatus || 'pending'))).map((unit) => ({ op: 'write', targetId: unit.id }));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export interface StepRuntime {
  signal: AbortSignal;
  note: string;
  onProgress?: (patch: { label?: string; unitsDone?: number; words?: number; currentUnitId?: string | null }) => void;
}

/** 执行一个 step：模型调用在事务外，产物落库在一个事务内。 */
export async function runStep(job: JobRow, step: StepDef, runtime: StepRuntime): Promise<StepOutcome> {
  const projectId = job.project_id;
  const context = loadContext(projectId, { note: runtime.note });
  const profile = context.profile;
  const selection = resolveSelection();
  const isMock = selection.kind === 'mock';

  const callJson = async (built: { system: string; prompt: string; label: string }, mock: () => string, maxTokens = 4096) => {
    const result = await callModel({
      system: built.system,
      prompt: built.prompt,
      signal: runtime.signal,
      override: { providerId: selection.providerId, modelId: selection.modelId, reasoning: selection.reasoning },
      maxTokens,
      mockText: isMock ? mock : undefined,
      label: `${job.stage_key}:${built.label}`,
    });
    return result.text;
  };

  const reject = (text: string, detail: string): never => {
    addRevision({
      projectId,
      stageKey: job.stage_key,
      scope: 'item',
      targetId: null,
      source: 'ai_rejected',
      content: text.slice(0, 20000),
      contentKind: 'text',
      note: detail.slice(0, 300),
      jobId: job.id,
    });
    fail('INVALID_JSON', '模型输出格式不对', { detail });
  };

  const parseAndValidate = <T,>(text: string, validate: (raw: unknown) => { ok: boolean; errors: Array<{ path: string; message: string }>; value?: T }): T => {
    const parsed = parseJsonResponse(text);
    if (!parsed.ok) return reject(text, parsed.message);
    const validation = validate(parsed.value);
    if (!validation.ok) return reject(text, formatErrors(validation.errors));
    return (validation as unknown as { value?: T }).value as T;
  };

  /**
   * 修订来源：带用户意见 → ai_feedback；重生成任务 → ai_regen；首次生成/逐章写作 → ai_initial。
   * 来源必须能区分「AI 初稿 / 按意见重做 / 整份重生成」，否则历史里看不出哪一版是按意见改的。
   */
  const revisionSource = (): 'ai_initial' | 'ai_regen' | 'ai_feedback' => {
    if (runtime.note && runtime.note.trim()) return 'ai_feedback';
    if (job.kind === 'regen-stage' || job.kind === 'regen-item' || job.kind === 'chapter-rewrite') return 'ai_regen';
    return 'ai_initial';
  };

  if (step.op === 'world') {
    const text = await callJson(buildWorldPrompt(context), () => mockStepText('world', context));
    const payload = parseAndValidate<WorldPayload>(text, (raw) => validateWorld(raw, profile));
    commit(projectId, () => {
      const existing = listStageItemRows(projectId, 'p1', 'world')[0];
      const itemPayload = payload as unknown as Record<string, unknown>;
      const id = existing
        ? (updateStageItem(existing.id, { title: payload.era.slice(0, 40), payload: itemPayload }), existing.id)
        : insertStageItem({ projectId, stageKey: 'p1', kind: 'world', ordinal: 0, title: payload.era.slice(0, 40), payload: itemPayload });
      recordItemRevision(projectId, 'p1', id, revisionSource(), itemPayload, job.id);
    });
    return { label: 'world', unitsDone: 1, words: 0 };
  }

  if (step.op === 'env') {
    const text = await callJson(buildEnvPrompt(context), () => mockStepText('env', context));
    const list = parseAndValidate<EnvPayload[]>(text, (raw) => validateEnvList(raw, profile));
    commit(projectId, () => {
      for (const row of listStageItemRows(projectId, 'p1', 'env')) if (!row.locked) exec('DELETE FROM stage_items WHERE id = ?', row.id);
      list.forEach((entry, index) => {
        const id = insertStageItem({ projectId, stageKey: 'p1', kind: 'env', ordinal: index + 1, title: entry.name, payload: { ...entry } });
        recordItemRevision(projectId, 'p1', id, revisionSource(), { ...entry }, job.id);
      });
    });
    return { label: 'env', unitsDone: list.length, words: 0 };
  }

  if (step.op === 'characters') {
    const text = await callJson(buildCharactersPrompt(context), () => mockStepText('characters', context), 6000);
    const list = parseAndValidate<CharacterPayload[]>(text, (raw) => validateCharacters(raw));
    commit(projectId, () => {
      exec('DELETE FROM characters WHERE project_id = ? AND locked = 0', projectId);
      list.forEach((entry, index) => {
        const id = uid('chr');
        exec(
          `INSERT INTO characters (id, project_id, name, role, age, avatar, tags, quote, description, secret, relations, sort_order, motivation, arc, is_protagonist, locked, source)
           VALUES (?, ?, ?, ?, ?, '', ?, '', ?, ?, '[]', ?, ?, '', ?, 0, 'ai')`,
          id,
          projectId,
          entry.name,
          entry.role,
          entry.age,
          JSON.stringify(entry.tags),
          entry.personality,
          entry.secret,
          index,
          entry.motivation,
          entry.isProtagonist ? 1 : 0,
        );
        recordItemRevision(projectId, 'p1', id, revisionSource(), { ...entry }, job.id);
      });
    });
    return { label: 'characters', unitsDone: list.length, words: 0 };
  }

  if (step.op === 'acts') {
    const text = await callJson(buildActsPrompt(context), () => mockStepText('acts', context), 6000);
    const acts = parseAndValidate<ActPayload[]>(text, (raw) => validateActs(raw, profile));
    commit(projectId, () => {
      if (profile.kind === 'short') {
        for (const row of listStageItemRows(projectId, 'p2', 'beat_group')) if (!row.locked) exec('DELETE FROM stage_items WHERE id = ?', row.id);
        acts.forEach((act, index) => {
          const id = insertStageItem({ projectId, stageKey: 'p2', kind: 'beat_group', ordinal: index, title: act.title, payload: { function: act.function, summary: act.summary, characters: act.characters } });
          recordItemRevision(projectId, 'p2', id, revisionSource(), { ...act }, job.id);
        });
      } else {
        for (const row of allRows('SELECT id, locked FROM outline_beats WHERE project_id = ?', projectId)) if (!row.locked) exec('DELETE FROM outline_beats WHERE id = ?', row.id);
        for (const row of allRows('SELECT id, locked FROM outline_acts WHERE project_id = ?', projectId)) if (!row.locked) exec('DELETE FROM outline_acts WHERE id = ?', row.id);
        acts.forEach((act, index) => {
          const id = uid('act');
          exec(
            'INSERT INTO outline_acts (id, project_id, title, summary, sort_order, act_function, characters, locked, source) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
            id,
            projectId,
            act.title,
            act.summary,
            index,
            act.function,
            JSON.stringify(act.characters),
            'ai',
          );
          recordItemRevision(projectId, 'p2', id, revisionSource(), { ...act }, job.id);
        });
      }
    });
    return { label: 'acts', unitsDone: acts.length, words: 0 };
  }

  if (step.op === 'beats') {
    const acts = context.acts || [];
    const actIndex = step.targetId ? Number(step.targetId) : 0;
    const act = acts[actIndex];
    if (!act) fail('STAGE_LOCKED', '生成节拍前需要先生成上一级结构');
    const text = await callJson(buildBeatsPrompt(context, act, actIndex), () => mockStepText('beats', context, { actIndex }), 6000);
    const beats = parseAndValidate<BeatPayload[]>(text, (raw) => validateBeats(raw, act, profile));
    commit(projectId, () => {
      if (profile.kind === 'short') {
        const groupIds = listStageItemRows(projectId, 'p2', 'beat_group').map((row) => row.id);
        const groupId = groupIds[actIndex];
        for (const row of listStageItemRows(projectId, 'p2', 'beat').filter((item) => parseJson<Record<string, unknown>>(item.payload, {}).groupId === groupId)) {
          if (!row.locked) exec('DELETE FROM stage_items WHERE id = ?', row.id);
        }
        beats.forEach((beat, index) => {
          const id = insertStageItem({ projectId, stageKey: 'p2', kind: 'beat', ordinal: index, title: beat.title, payload: { ...beat, groupId } });
          recordItemRevision(projectId, 'p2', id, revisionSource(), { ...beat }, job.id);
        });
      } else {
        const actRows = allRows('SELECT id, locked FROM outline_acts WHERE project_id = ? ORDER BY sort_order ASC', projectId);
        const actRow = actRows[actIndex];
        if (!actRow) fail('STAGE_LOCKED', '生成节拍前需要先生成上级幕');
        for (const row of allRows('SELECT id, locked FROM outline_beats WHERE project_id = ? AND act_id = ?', projectId, String(actRow.id))) {
          if (!row.locked) exec('DELETE FROM outline_beats WHERE id = ?', row.id);
        }
        beats.forEach((beat, index) => {
          const id = uid('beat');
          exec(
            `INSERT INTO outline_beats (id, project_id, act_id, chapter_no, title, summary, tags, status, sort_order, beat_function, planned_chapters, foreshadow, locked, source)
             VALUES (?, ?, ?, ?, ?, ?, '[]', '待写', ?, ?, ?, ?, 0, 'ai')`,
            id,
            projectId,
            String(actRow.id),
            index + 1,
            beat.title,
            beat.summary,
            index,
            beat.function,
            String(beat.plannedChapters),
            beat.foreshadow,
          );
          recordItemRevision(projectId, 'p2', id, revisionSource(), { ...beat }, job.id);
        });
      }
    });
    return { label: `beats:${actIndex}`, unitsDone: beats.length, words: 0 };
  }

  if (step.op === 'plan') {
    const [startText, sizeText] = String(step.targetId || '').split(':');
    const batchStart = Number(startText || 0);
    const batchSize = Number(sizeText || PLAN_BATCH_SIZE);
    const text = await callJson(buildChapterPlanPrompt(context, batchStart, batchSize), () => mockStepText('plan', context, { batchStart, batchSize }), 8000);
    const entries = parseAndValidate<ChapterPlanPayload[]>(text, (raw) => validateChapterPlan(raw, batchSize, profile));
    commit(projectId, () => {
      if (profile.kind === 'short') {
        const existing = listStageItemRows(projectId, 'p3', 'beat_plan');
        entries.forEach((entry, index) => {
          const ordinal = batchStart + index;
          const target = existing.find((row) => Number(row.ordinal || 0) === ordinal);
          if (target && (target.body.trim() || target.locked)) return;
          const payload = { planFunction: entry.function, planSynopsis: entry.synopsis, minWords: entry.minWords, plannedWords: entry.targetWords, maxWords: entry.maxWords, characters: entry.characters };
          if (target) {
            updateStageItem(target.id, { title: entry.title, payload });
            recordItemRevision(projectId, 'p3', target.id, revisionSource(), payload, job.id);
          } else {
            const id = insertStageItem({ projectId, stageKey: 'p3', kind: 'beat_plan', ordinal, title: entry.title, payload, reviewStatus: 'pending' });
            recordItemRevision(projectId, 'p3', id, revisionSource(), payload, job.id);
          }
        });
        prunePlanWindow(projectId, job.id, 'short', existing, entries.length, batchStart, batchSize);
      } else {
        const existing = listUnits(projectId);
        entries.forEach((entry, index) => {
          const ordinal = batchStart + index;
          const target = existing.find((unit) => unit.ordinal === ordinal);
          if (target && (target.content.trim() || target.locked)) return;
          if (target) {
            exec(
              `UPDATE chapters SET title = ?, plan_function = ?, plan_synopsis = ?, plan_characters = ?, min_words = ?, target_words = ?, max_words = ?, target_manual = 0, review_status = ?, updated_at = ? WHERE id = ?`,
              entry.title,
              entry.function,
              entry.synopsis,
              JSON.stringify(entry.characters),
              entry.minWords,
              entry.targetWords,
              entry.maxWords,
              target.reviewStatus || 'pending',
              now(),
              target.id,
            );
            recordItemRevision(projectId, 'p3', target.id, revisionSource(), { ...entry }, job.id);
          } else {
            const id = uid('ch');
            exec(
              `INSERT INTO chapters (id, project_id, volume, number, title, content, status, sort_order, words, updated_at, review_status, plan_function, plan_synopsis, plan_characters, min_words, target_words, max_words, target_manual, plan_locked, stale)
               VALUES (?, ?, '第一卷', ?, ?, '', '草稿', ?, 0, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
              id,
              projectId,
              `第${ordinal + 1}章`,
              entry.title,
              ordinal,
              now(),
              entry.function,
              entry.synopsis,
              JSON.stringify(entry.characters),
              entry.minWords,
              entry.targetWords,
              entry.maxWords,
            );
            recordItemRevision(projectId, 'p3', id, revisionSource(), { ...entry }, job.id);
          }
        });
        prunePlanWindow(projectId, job.id, 'novel', existing, entries.length, batchStart, batchSize);
      }
      touchProject(projectId);
    });
    return { label: `plan:${batchStart}`, unitsDone: entries.length, words: 0 };
  }

  if (step.op === 'write') {
    const unitId = String(step.targetId || '');
    const units = listUnits(projectId);
    const unit = units.find((item) => item.id === unitId);
    if (!unit) fail('NOT_FOUND', '找不到要写的这一章');
    if (!unit.targetWords) fail('STAGE_LOCKED', '这一章还没有字数计划，请先确认章节计划');
    const previous = previousUnit(projectId, unitId, profile.kind);
    const writingContext: LoadedContext = { ...context, previous };
    const text = await callJson(
      buildWritingPrompt(writingContext, {
        title: unit.title,
        planFunction: unit.planFunction,
        planSynopsis: unit.planSynopsis,
        minWords: unit.minWords ?? DEFAULT_WORD_RANGE.minWords,
        targetWords: unit.targetWords,
        maxWords: unit.maxWords ?? DEFAULT_WORD_RANGE.maxWords,
      }),
      () => mockStepText('write', context, { unit: { title: unit.title, targetWords: unit.targetWords || profile.defaultUnitWords } }),
      Math.min(16000, Math.max(4000, (unit.maxWords || 4000) * 2)),
    );
    runtime.onProgress?.({ currentUnitId: unitId });
    const checked = parseProseResponse(text);
    const proseCheck = validateChapterText(checked, unit.minWords ?? DEFAULT_WORD_RANGE.minWords);
    if (!proseCheck.ok) reject(text, formatErrors(proseCheck.errors));
    const words = countWords(checked);
    commit(projectId, () => {
      if (profile.kind === 'short') {
        updateStageItem(unitId, { body: checked, words, review_status: 'in_review' });
        const mirror = oneRow('SELECT id FROM chapters WHERE project_id = ? AND sort_order = ? AND deleted_at IS NULL', projectId, unit.ordinal);
        if (mirror) exec('UPDATE chapters SET content = ?, words = ?, updated_at = ? WHERE id = ?', checked, words, now(), String(mirror.id));
        const revision = addRevision({ projectId, stageKey: 'p4', scope: 'item', targetId: unitId, source: revisionSource(), content: checked, contentKind: 'text', jobId: job.id });
        updateStageItem(unitId, { current_revision_id: revision.id });
        pruneItemRevisions(projectId, unitId);
      } else {
        // N2：这一章可能在写作期间被删掉（例如并发改章节数）。UPDATE 命中 0 行时如果继续，
        // createChapterVersion 仍会插一条指向不存在章节的版本行，而 job 照样报成功 —— 正文彻底丢失且无痕。
        const written = exec(
          "UPDATE chapters SET content = ?, words = ?, review_status = 'in_review', last_error = NULL, updated_at = ? WHERE id = ?",
          checked,
          words,
          now(),
          unitId,
        );
        if (!Number(written.changes || 0)) fail('NOT_FOUND', '这一章已被删除，请重新生成计划');
        const version = createChapterVersion(unitId, 'AI 生成', checked, unit.title);
        if (version) exec('UPDATE chapters SET current_version_id = ? WHERE id = ?', version.id, unitId);
        const revision = addRevision({ projectId, stageKey: 'p4', scope: 'item', targetId: unitId, source: revisionSource(), content: checked, contentKind: 'text', jobId: job.id });
        pruneItemRevisions(projectId, unitId);
        if (!revision.id) fail('BAD_REQUEST', '写版本失败');
      }
      recalcProjectWords(projectId);
      touchProject(projectId);
    });
    return { label: `write:${unit.title}`, unitsDone: 1, words };
  }

  if (step.op === 'item') {
    const found = findItemRow(String(step.targetId || ''));
    if (!found) fail('NOT_FOUND', '找不到要重写的条目');
    const stageKey = stageKeyOfTable(found.table, found.row);
    const itemContext = loadContext(projectId, { note: runtime.note });
    const prompt = buildItemPrompt(found.table, found.row, itemContext);
    const text = await callJson(prompt, () => mockItemText(found.table, found.row, itemContext), 3000);
    const patch = parseAndValidate<Record<string, unknown>>(text, (raw) => {
      const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      if (!object) return { ok: false, errors: [{ path: '$', message: '必须是一个 JSON 对象' }] };
      return { ok: true, errors: [], value: object };
    });
    commit(projectId, () => {
      applyItemPatch(projectId, found.table, found.row, patch);
      recordItemRevision(projectId, stageKey, String(found.row.id), revisionSource(), patch, job.id);
    });
    return { label: 'item', unitsDone: 1, words: 0 };
  }

  fail('BAD_REQUEST', `未知的生成步骤：${step.op}`);
}

function commit<T>(projectId: string, fn: () => T): T {
  touchProject(projectId);
  return withTx(fn);
}

/**
 * 一批计划生成后，清掉「同一批窗口内、模型这次没给到」的空计划行（F2）。
 *
 * 两个约束：
 * ① 只动本批窗口 `[batchStart + returned, batchStart + batchSize)`，
 *    绝不越过窗口去删后续批次已经生成好的计划（原实现按 returned 数量做偏移，
 *    模型少回几条就会把 20 章之后的计划整片删掉，而且没有任何报错）；
 * ② 模型返回条数与请求不一致时一条都不删，只记 job 事件——
 *    少数派结果交给用户看，不由后端替用户决定丢哪几章。
 */
function prunePlanWindow(
  projectId: string,
  jobId: string,
  kind: 'novel' | 'short',
  existing: Array<Record<string, any>>,
  returned: number,
  batchStart: number,
  batchSize: number,
) {
  if (returned !== batchSize) {
    appendJobEvent(jobId, 'plan-window-kept', { batchStart, batchSize, returned, reason: '模型返回条数与请求窗口不一致，本轮不裁剪计划' });
    console.warn(`[plan] project=${projectId} batch=${batchStart} expected=${batchSize} returned=${returned} — 保留全部计划，不裁剪`);
    return;
  }
  const from = batchStart + returned;
  const to = batchStart + batchSize;
  for (const row of existing) {
    const ordinal = Number(row.ordinal ?? 0);
    if (ordinal < from || ordinal >= to) continue;
    if (Number(row.locked || 0) === 1) continue;
    const body = kind === 'short' ? String(row.body || '') : String(row.content || '');
    if (body.trim() || Number(row.words || 0) > 0) continue;
    exec(kind === 'short' ? 'DELETE FROM stage_items WHERE id = ?' : 'DELETE FROM chapters WHERE id = ?', String(row.id));
  }
}

function recordItemRevision(projectId: string, stageKey: StageKey, itemId: string, source: 'ai_initial' | 'ai_regen' | 'ai_feedback' | 'manual' | 'rollback' | 'migration', content: Record<string, unknown>, jobId: string) {
  addRevision({
    projectId,
    stageKey,
    scope: 'item',
    targetId: itemId,
    source,
    content: JSON.stringify(content),
    contentKind: 'json',
    jobId,
  });
  pruneItemRevisions(projectId, itemId);
  const stage = getStage(projectId, stageKey);
  // 已确认阶段只增不改：新增修订 + 标下游 stale，不回退本阶段确认状态（INV-1）。
  // F12：状态与 confirmed_* 由 setStageStatus 统一维护，这里不再两条分支各写一次。
  if (!stage) return;
  if (stage.status === 'confirmed') {
    markDownstreamStale(projectId, stageKey, `${stageKey}:regenerated`);
  } else {
    setStageStatus(projectId, stageKey, 'review');
  }
}

export function recalcProjectWords(projectId: string) {
  const row = oneRow('SELECT COALESCE(SUM(words), 0) AS words FROM chapters WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL', projectId);
  const itemRow = oneRow("SELECT COALESCE(SUM(words), 0) AS words FROM stage_items WHERE project_id = ? AND kind = 'beat_plan' AND archived_at IS NULL", projectId);
  exec('UPDATE projects SET total_words = ?, updated_at = ? WHERE id = ?', Number(row?.words || 0) + Number(itemRow?.words || 0), now(), projectId);
}

// ---------------------------------------------------------------------------
// 单条目重写
// ---------------------------------------------------------------------------

function buildItemPrompt(table: string, row: Record<string, any>, context: StepContext): { system: string; prompt: string; label: string } {
  const current = JSON.stringify(row, null, 0).slice(0, 1500);
  const system = '你是一位资深中文小说策划编辑。你只输出严格 JSON，不要代码围栏，不要解释。';
  const prompt = `书名：${context.project.title}｜类型：${context.project.type}｜题材：${context.project.genre}
${context.note ? `用户修改意见（必须落实）：${context.note}` : ''}
现有这一条内容（JSON）：
${current}

请只重写这一条，保持它在结构中的位置与作用，输出 JSON 对象（字段与现有条目一致，中文填写，禁止占位内容）。`;
  return { system, prompt, label: `item:${table}` };
}

function mockItemText(table: string, row: Record<string, any>, context: StepContext): string {
  const payload = parseJson<Record<string, unknown>>(row.payload, {});
  if (table === 'characters') {
    return JSON.stringify({
      name: String(row.name || '沈砚'),
      role: String(row.role || '主角'),
      age: String(row.age || '34'),
      motivation: '查清父亲失踪的真相，同时保住自己仅剩的记忆。',
      personality: '话少，先观察再开口，对细节有偏执的记忆力。',
      secret: '他其实已经忘记母亲的脸。',
      tags: ['调查者'],
      isProtagonist: true,
    });
  }
  if (row.kind === 'world') {
    return JSON.stringify({ era: String(payload.era || '沿海旧城，梅雨季'), worldRules: String(payload.worldRules || '超常现象必以记忆为代价'), worldRulesNotNeeded: false, tone: String(payload.tone || '克制悬疑'), language: String(payload.language || '第三人称限知，短句') });
  }
  if (row.kind === 'env') {
    return JSON.stringify({ name: String(row.title || '旧城印刷厂'), type: String(payload.type || '机构'), mood: '铁锈 潮气', reason: '主角的工作地，也是第一条线索被发现的地方。' });
  }
  return JSON.stringify({ ...payload, summary: payload.summary || '这一条被重新改写，情节更紧凑。' });
}

export function applyItemPatch(projectId: string, table: string, row: Record<string, any>, patch: Record<string, unknown>) {
  const id = String(row.id);
  if (table === 'stage_items') {
    const payload = { ...parseJson<Record<string, unknown>>(row.payload, {}), ...(typeof patch === 'object' ? patch : {}) };
    updateStageItem(id, { title: String(patch.name || patch.title || row.title), payload });
    return;
  }
  if (table === 'characters') {
    exec(
      'UPDATE characters SET name = ?, role = ?, age = ?, motivation = ?, description = ?, secret = ?, tags = ? WHERE id = ?',
      String(patch.name ?? row.name ?? ''),
      String(patch.role ?? row.role ?? ''),
      String(patch.age ?? row.age ?? ''),
      String(patch.motivation ?? row.motivation ?? ''),
      String(patch.personality ?? row.description ?? ''),
      String(patch.secret ?? row.secret ?? ''),
      JSON.stringify(Array.isArray(patch.tags) ? patch.tags : parseJson<string[]>(row.tags, [])),
      id,
    );
    return;
  }
  if (table === 'outline_acts') {
    exec(
      'UPDATE outline_acts SET title = ?, summary = ?, act_function = ?, characters = ? WHERE id = ?',
      String(patch.title ?? row.title ?? ''),
      String(patch.summary ?? row.summary ?? ''),
      String(patch.function ?? row.act_function ?? ''),
      JSON.stringify(Array.isArray(patch.characters) ? patch.characters : parseJson<string[]>(row.characters, [])),
      id,
    );
    return;
  }
  if (table === 'outline_beats') {
    exec(
      'UPDATE outline_beats SET title = ?, summary = ?, beat_function = ?, planned_chapters = ?, foreshadow = ? WHERE id = ?',
      String(patch.title ?? row.title ?? ''),
      String(patch.summary ?? row.summary ?? ''),
      String(patch.function ?? row.beat_function ?? ''),
      String(patch.plannedChapters ?? row.planned_chapters ?? '1'),
      String(patch.foreshadow ?? row.foreshadow ?? ''),
      id,
    );
    return;
  }
  if (table === 'chapters') {
    exec(
      `UPDATE chapters SET title = ?, plan_function = ?, plan_synopsis = ?, plan_characters = ?, min_words = ?, target_words = ?, max_words = ?, updated_at = ? WHERE id = ?`,
      String(patch.title ?? row.title ?? ''),
      String(patch.function ?? row.plan_function ?? ''),
      String(patch.synopsis ?? row.plan_synopsis ?? ''),
      JSON.stringify(Array.isArray(patch.characters) ? patch.characters : parseJson<string[]>(row.plan_characters, [])),
      Number(patch.minWords ?? row.min_words ?? DEFAULT_WORD_RANGE.minWords),
      Number(patch.targetWords ?? row.target_words ?? DEFAULT_WORD_RANGE.targetWords),
      Number(patch.maxWords ?? row.max_words ?? DEFAULT_WORD_RANGE.maxWords),
      now(),
      id,
    );
  }
}
