import { countWords, now, uid } from '../db.ts';
import { createChapterVersion } from '../repository.ts';
import type { AllocationPreview, AllocationRow, MigrationView, PipelineItem, Revision, ReviewActionResult, StageConfirmResult } from '../../shared/pipeline.ts';
import {
  activeJob,
  addReviewRecord,
  addRevision,
  allRows,
  countUnitsByStatus,
  exec,
  findItemRow,
  getProjectRow,
  getStage,
  getStageItemRow,
  getUnitRow,
  insertStageItem,
  kindOf,
  latestJob,
  listItems,
  listRevisions,
  listStageItemRows,
  listUnits,
  markDownstreamStale,
  oneRow,
  parseJson,
  requireProject,
  setPipelineStatus,
  setProjectLastError,
  setStageStatus,
  setStaleReason,
  setUnitStatus,
  staleReasonOf,
  stageKeyOfTable,
  stageRows,
  touchProject,
  updateStage,
  updateStageItem,
  withTx,
} from './store.ts';
import type { JobRow, UnitRow } from './store.ts';
import { latestRevision, pruneItemRevisions } from './store.ts';
import { DEVIATION_TOLERANCE, DEFAULT_WORD_RANGE, STAGE_KEYS, fail, kindProfileOf } from './types.ts';
import type { StageKey, StageStatus } from './types.ts';
import { planStepsForStage, recalcProjectWords, writingSteps } from './steps.ts';
import { ensureNoActiveJob, requestCancel, resumeStepsFor, startJob } from './runner.ts';
import { buildSnapshot } from './snapshot.ts';
import { formatErrors } from './validate.ts';

/**
 * 动作接口的业务层（ARCHITECTURE §3.13）。
 * 规矩：每个写接口只做一件事、只返回最小结果，成功后前端重拉一次快照。
 */

// ---------------------------------------------------------------------------
// 阶段确认 / 跳过 / stale 处理
// ---------------------------------------------------------------------------

function blockersOf(projectId: string, stageKey: StageKey, acceptDeviation: boolean): string[] {
  const kind = kindOf(projectId);
  const project = requireProject(projectId);
  const profile = kindProfileOf(project.type);
  const blockers: string[] = [];
  if (stageKey === 'p1') {
    const items = listItems(projectId, 'p1');
    const characters = items.filter((item) => item.kind === 'character');
    const envs = items.filter((item) => item.kind === 'env');
    const world = items.find((item) => item.kind === 'world');
    if (!characters.length) blockers.push('还没有人物');
    for (const character of characters) {
      const payload = character.payload as Record<string, unknown>;
      if (!String(payload.name || character.title).trim() || !String(payload.role || '').trim() || !String(payload.motivation || '').trim()) {
        blockers.push(`人物「${character.title || '未命名'}」缺少姓名/身份/动机`);
      }
    }
    if (!envs.length) blockers.push('还没有环境');
    for (const env of envs) if (!env.title.trim()) blockers.push('有环境缺少名称');
    if (!world) blockers.push('还没有世界观');
    else {
      const payload = world.payload as Record<string, unknown>;
      const rules = String(payload.worldRules || '').trim();
      if (profile.requiresWorldRules && !rules && payload.worldRulesNotNeeded !== true) blockers.push('世界规则为空，请填写或勾选「本书不需要明确规则」');
      if (!String(payload.era || '').trim()) blockers.push('世界观缺少时代地点');
    }
  }
  if (stageKey === 'p2') {
    const acts = listItems(projectId, 'p2');
    const groups = kind === 'short' ? acts.filter((item) => item.kind === 'beat_group' || item.kind === 'act') : acts.filter((item) => item.kind === 'act');
    if (groups.length < profile.actRange[0]) blockers.push(`${profile.actLabel}至少 ${profile.actRange[0]} 个，现在 ${groups.length} 个`);
    if (groups.length > profile.actRange[1]) blockers.push(`${profile.actLabel}最多 ${profile.actRange[1]} 个`);
    for (const group of groups) {
      const payload = group.payload as Record<string, unknown>;
      if (!String(payload.function || '').trim()) blockers.push(`「${group.title}」缺少功能`);
      if (String(payload.summary || '').trim().length < 15) blockers.push(`「${group.title}」摘要不足 15 字`);
    }
    if (kind === 'novel') {
      const beats = acts.filter((item) => item.kind === 'beat');
      if (!beats.length) blockers.push('还没有任何节拍');
    }
    const characterNames = new Set(listItems(projectId, 'p1').filter((item) => item.kind === 'character').map((item) => item.title));
    const mentioned = new Set<string>();
    for (const group of groups) {
      const list = (group.payload as Record<string, unknown>).characters;
      if (Array.isArray(list)) for (const name of list) mentioned.add(String(name));
    }
    if (characterNames.size && ![...mentioned].some((name) => characterNames.has(name))) blockers.push(`主角至少要在 1 个${profile.actLabel}里出现`);
  }
  if (stageKey === 'p3') {
    const units = listUnits(projectId);
    if (units.length < profile.minUnits) blockers.push(`${profile.unitLabel}数至少 ${profile.minUnits}，现在 ${units.length}`);
    if (units.length > profile.maxUnits) blockers.push(`${profile.unitLabel}数最多 ${profile.maxUnits}`);
    for (const unit of units) {
      if (!unit.planFunction.trim()) blockers.push(`「${unit.title}」缺少功能`);
      // 迁移带进来的旧稿只有正文、没有章节大纲；对它放宽大纲必填，让用户能先确认再逐章改。
      if (unit.source !== 'migration' && unit.planSynopsis.trim().length < 15) blockers.push(`「${unit.title}」大纲不足 15 字`);
      const min = unit.minWords ?? 0;
      const target = unit.targetWords ?? 0;
      const max = unit.maxWords ?? 0;
      if (!(DEFAULT_WORD_RANGE.minWordsFloor <= min && min <= target && target <= max && max <= DEFAULT_WORD_RANGE.maxWordsCeiling)) {
        blockers.push(`「${unit.title}」字数范围不合法（需 ${DEFAULT_WORD_RANGE.minWordsFloor} ≤ min ≤ target ≤ max ≤ ${DEFAULT_WORD_RANGE.maxWordsCeiling}）`);
      }
    }
    const total = units.reduce((sum, unit) => sum + (unit.targetWords || 0), 0);
    const goal = Number(project.goal_words || 0);
    if (goal > 0 && !acceptDeviation) {
      const deviation = (total - goal) / goal;
      if (Math.abs(deviation) > DEVIATION_TOLERANCE) {
        blockers.push(`总目标 ${total} 字 / 全书目标 ${goal} 字（${(deviation * 100).toFixed(1)}%），超出 ±${Math.round(DEVIATION_TOLERANCE * 100)}%`);
      }
    }
  }
  return blockers;
}

const DEVIATION_KEY = (projectId: string) => `p3_deviation:${projectId}`;

export function acceptDeviation(projectId: string, accepted: boolean) {
  exec(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    DEVIATION_KEY(projectId),
    accepted ? '1' : '0',
  );
}

export function deviationAccepted(projectId: string): boolean {
  const row = oneRow('SELECT value FROM app_meta WHERE key = ?', DEVIATION_KEY(projectId));
  return row?.value === '1';
}

export function confirmStage(projectId: string, stageKey: StageKey): StageConfirmResult {
  const project = requireProject(projectId);
  if (project.type !== 'novel' && project.type !== 'short') fail('TYPE_NOT_SUPPORTED');
  const stage = getStage(projectId, stageKey);
  if (!stage) fail('NOT_FOUND', '阶段不存在');
  if (stageKey !== 'p1') {
    const upstream = STAGE_KEYS[STAGE_KEYS.indexOf(stageKey) - 1];
    const upstreamStage = getStage(projectId, upstream);
    if (!upstreamStage || (upstreamStage.status !== 'confirmed' && upstreamStage.status !== 'skipped')) fail('STAGE_LOCKED', `请先确认${upstream}阶段`);
  }
  const blockers = blockersOf(projectId, stageKey, deviationAccepted(projectId));
  if (blockers.length) fail('CONFIRM_BLOCKED', '还有未满足的确认条件', { blockers });

  const snapshot = withTx(() => {
    const revision = addRevision({
      projectId,
      stageKey,
      scope: 'stage',
      targetId: null,
      source: 'ai_initial',
      content: JSON.stringify({ stage: stageKey, items: listItems(projectId, stageKey), confirmedAt: now() }),
      contentKind: 'json',
      note: '确认快照',
    });
    setStageStatus(projectId, stageKey, 'confirmed', { confirmed_revision_id: revision.id, confirmed_at: now(), last_error: null });
    // 确认即定稿：以前那次「只重建了一部分」的痕迹到此为止（N8）。
    updateStage(projectId, stageKey, { stale: 0, partial_at: null });
    setStaleReason(projectId, stageKey, null);
    const index = STAGE_KEYS.indexOf(stageKey);
    for (const downstream of STAGE_KEYS.slice(index + 1)) {
      const row = getStage(projectId, downstream);
      if (!row) continue;
      if (row.status === 'locked') updateStage(projectId, downstream, { status: 'empty' });
    }
    setPipelineStatus(projectId, stageKey === 'p4' ? 'completed' : 'reviewing');
    touchProject(projectId);
    return revision;
  });
  console.log(`[stage] project=${projectId} stage=${stageKey} action=confirm revision=${snapshot.id}`);
  return { stage: stageKey, status: 'confirmed', snapshotRevisionId: snapshot.id, confirmedAt: snapshot.createdAt, snapshot: buildSnapshot(projectId) };
}

export function skipStage(projectId: string, stageKey: StageKey, reason?: string): StageConfirmResult {
  if (stageKey !== 'p1') fail('BAD_REQUEST', '只有设定阶段可以跳过');
  const revision = withTx(() => {
    updateStage(projectId, stageKey, { status: 'skipped', skipped: 1, confirmed_at: now(), confirmed_revision_id: null, partial_at: null });
    const next = getStage(projectId, 'p2');
    if (next?.status === 'locked') updateStage(projectId, 'p2', { status: 'empty' });
    const snapshot = addRevision({ projectId, stageKey, scope: 'stage', targetId: null, source: 'manual', content: JSON.stringify({ stage: stageKey, skipped: true, reason: reason || '', at: now() }) });
    touchProject(projectId);
    return snapshot;
  });
  return { stage: stageKey, status: 'skipped', snapshotRevisionId: revision.id, confirmedAt: revision.createdAt, snapshot: buildSnapshot(projectId) };
}

/**
 * 处理「上游已变更」横幅上的三键（keep / regenerate / ignore）。
 *
 * N1：横幅上的「重新生成」是用户最容易点到的整阶段重做入口，但它以前不带
 * `confirmOverwrite`，于是只要手改过任何一条就永久 422 —— 主路径上无路可走。
 * 现在把确认原样透传给 startStageJob，和直连 regenerate 走同一条校验。
 */
export function resolveStale(
  projectId: string,
  stageKey: StageKey,
  action: 'keep' | 'regenerate' | 'ignore',
  options: { confirmOverwrite?: boolean } = {},
) {
  if (action === 'regenerate') {
    const job = startStageJob(projectId, stageKey, {
      scope: 'all',
      kind: 'regen-stage',
      confirmOverwrite: options.confirmOverwrite === true,
    });
    return { job: jobViewOf(job), stage: buildSnapshot(projectId).stages[stageKey] };
  }
  if (action === 'keep') {
    withTx(() => {
      updateStage(projectId, stageKey, { stale: 0 });
      setStaleReason(projectId, stageKey, null);
    });
  }
  return { stage: buildSnapshot(projectId).stages[stageKey] };
}

// ---------------------------------------------------------------------------
// 生成入口
// ---------------------------------------------------------------------------

export interface StartStageOptions {
  scope: 'all' | 'block' | 'item';
  targetId?: string;
  note?: string;
  kind?: 'plan' | 'regen-stage' | 'regen-item' | 'chapter-plan' | 'writing';
  /** 明确同意覆盖手改过的条目（F7）。不传时，若会覆盖手改内容则返回 CONFIRM_BLOCKED。 */
  confirmOverwrite?: boolean;
}

/**
 * 破坏性重建前的保底确认（F7）。
 *
 * 「整份/整块重生成」会先删掉未锁定的条目再重建，一步一个事务；
 * 多步之间若中途失败或取消，就会留下「一部分是新生成的、一部分是旧的」的阶段。
 * V1 不做跨步大事务（模型调用必须在事务外），所以至少要在开跑前把
 * 「哪些手改内容会被覆盖」摆到用户面前，由用户显式点头，而不是静默吞掉。
 */
function assertOverwriteAllowed(projectId: string, stageKey: StageKey, options: StartStageOptions) {
  if (options.confirmOverwrite || options.scope === 'item') return;
  // N9：p3 的「条目」是章节单元（长篇 chapters / 短篇 beat），不落在 stage_items 上。
  // 以前只挡 p1/p2，于是整份重生成会静默覆盖手改过的章节大纲与字数、并把 target_manual 清零，
  // 连带让 applyAllocation 的「手改保护」失效 —— 现在 p3 走同一条确认。
  if (stageKey !== 'p1' && stageKey !== 'p2' && stageKey !== 'p3') return;
  const edited = allRows(
    "SELECT DISTINCT target_id FROM revisions WHERE project_id = ? AND stage_key = ? AND scope = 'item' AND source IN ('manual', 'rollback') AND target_id IS NOT NULL",
    projectId,
    stageKey,
  );
  const units = stageKey === 'p3' ? listUnits(projectId) : [];
  const locked =
    stageKey === 'p3'
      ? units.filter((unit) => unit.locked).map((unit) => ({ id: unit.id, title: unit.title }))
      : listItems(projectId, stageKey).filter((item) => item.locked);
  if (!edited.length && !locked.length) return;
  const titles = new Map<string, string>(
    stageKey === 'p3'
      ? units.map((unit) => [unit.id, unit.title] as [string, string])
      : listItems(projectId, stageKey).map((item) => [item.id, item.title] as [string, string]),
  );
  const blockers = [
    ...edited.map((row) => `手改：${titles.get(String(row.target_id)) || String(row.target_id)}`),
    ...locked.map((item) => `已锁定：${item.title}`),
  ];
  fail('CONFIRM_BLOCKED', '重新生成会覆盖你手改或锁定的条目，请先确认', {
    blockers: [...new Set(blockers)].slice(0, 20),
    detail: { requiresConfirm: 'overwrite' },
  });
}

export function startStageJob(projectId: string, stageKey: StageKey, options: StartStageOptions): JobRow {
  ensureNoActiveJob(projectId);
  const project = requireProject(projectId);
  kindProfileOf(project.type);
  if (stageKey !== 'p1') {
    const index = STAGE_KEYS.indexOf(stageKey);
    const upstream = STAGE_KEYS[index - 1];
    const upstreamStage = getStage(projectId, upstream);
    if (!upstreamStage || (upstreamStage.status !== 'confirmed' && upstreamStage.status !== 'skipped')) {
      // F14：p4 也走同一条门禁。原来把 p4 豁免了，`POST /pipeline/start {stage:'p4'}`
      // 能绕过「先确认章节计划」直接开写；恢复入口（writing/continue、jobs/retry）另有路径，不受影响。
      fail('STAGE_LOCKED', '请先确认上一阶段');
    }
  }
  assertOverwriteAllowed(projectId, stageKey, options);
  let steps = planStepsForStage(projectId, stageKey, { block: options.scope === 'block' ? options.targetId : undefined, targetId: undefined });
  if (options.scope === 'item') {
    if (!options.targetId) fail('BAD_REQUEST', '缺少 targetId');
    steps = [{ op: 'item', targetId: options.targetId }];
  }
  const kind = options.kind || (stageKey === 'p4' ? 'writing' : options.scope === 'item' ? 'regen-item' : options.scope === 'block' ? 'regen-item' : 'plan');
  // 这一阶段正在按上游/意见重做：stale 使命已达成，先清掉，避免生成完还挂着「上游已变更」的横幅。
  if (getStage(projectId, stageKey)?.stale) updateStage(projectId, stageKey, { stale: 0, last_error: null });
  // 重新起跑就清掉「上次只重建了一部分」的痕迹：这一次的结果由本次 job 决定（N4）。
  if (getStage(projectId, stageKey)?.partial_at) updateStage(projectId, stageKey, { partial_at: null });
  const job = startJob({
    projectId,
    stageKey,
    kind,
    steps,
    note: options.note || '',
    unitsTotal: stageKey === 'p4' ? steps.length : 0,
  });
  if (stageKey === 'p4') {
    for (const step of steps) if (step.targetId) setUnitStatus(projectId, step.targetId, 'generating');
  }
  return job;
}

export function startWriting(projectId: string, mode: 'continuous' | 'single', unitId?: string): JobRow {
  ensureNoActiveJob(projectId);
  const project = requireProject(projectId);
  const profile = kindProfileOf(project.type);
  const stage = getStage(projectId, 'p3');
  if (!stage || stage.status !== 'confirmed') fail('STAGE_LOCKED', '请先确认章节计划');
  if (mode === 'single' && !unitId) fail('BAD_REQUEST', '单章写作需要指定 unitId');
  const steps = writingSteps(projectId, mode === 'single' ? { unitId } : {});
  if (!steps.length) fail('BAD_REQUEST', mode === 'single' ? '这一章不需要重写' : '所有章节都已处理完');
  const job = startJob({ projectId, stageKey: 'p4', kind: 'writing', steps, unitsTotal: steps.length });
  for (const step of steps) if (step.targetId) setUnitStatus(projectId, step.targetId, 'generating');
  console.log(`[job] project=${projectId} stage=p4 mode=${mode} units=${steps.length} unit=${profile.unitLabel}`);
  return job;
}

export function pauseWriting(projectId: string): JobRow {
  const active = activeJob(projectId);
  if (!active) {
    const latest = oneRow("SELECT * FROM generation_jobs WHERE project_id = ? AND status = 'cancelled' AND stop_mode = 'pause' ORDER BY started_at DESC LIMIT 1", projectId) as JobRow | undefined;
    if (latest) fail('CONCURRENT_JOB', '当前没有正在进行的写作任务', { detail: { jobId: latest.id } });
    fail('BAD_REQUEST', '当前没有正在进行的写作任务');
  }
  return requestCancel(active.id, 'pause');
}

export function stopWriting(projectId: string, confirm: boolean): JobRow {
  if (!confirm) fail('BAD_REQUEST', '停止写作需要显式确认（confirm=true）');
  const active = activeJob(projectId);
  if (!active) fail('BAD_REQUEST', '当前没有正在进行的写作任务');
  return requestCancel(active.id, 'stop');
}

export function continueWriting(projectId: string): JobRow {
  ensureNoActiveJob(projectId);
  // 暂停之后不能「继续」已被停止/已完成的任务：只看最近一个 job，
  // 这样 stop（user_cancel）与 done 都不会被更早的 paused 行顶替（R: 停止后不可 continue）。
  const previous = latestJob(projectId);
  if (!previous) fail('BAD_REQUEST', '没有可继续的写作任务');
  const resumable = (previous.status === 'cancelled' && previous.stop_mode === 'pause') || previous.status === 'interrupted';
  if (!resumable) {
    if (previous.status === 'cancelled') fail('BAD_REQUEST', '这次写作已被停止，不能继续；如需接着写请重新开始写作');
    fail('BAD_REQUEST', '没有可继续的写作任务');
  }
  if (previous.stage_key !== 'p4') fail('BAD_REQUEST', '没有可继续的写作任务');
  const steps = resumeStepsFor(projectId, 'p4', previous);
  if (!steps.length) fail('BAD_REQUEST', '没有需要继续写的章节');
  const job = startJob({ projectId, stageKey: 'p4', kind: 'writing', steps, unitsTotal: steps.length, retryOfId: previous.id });
  for (const step of steps) if (step.targetId) setUnitStatus(projectId, step.targetId, 'generating');
  return job;
}

export function retryJob(projectId: string, jobId: string): JobRow {
  ensureNoActiveJob(projectId);
  const job = oneRow('SELECT * FROM generation_jobs WHERE id = ? AND project_id = ?', jobId, projectId) as JobRow | undefined;
  if (!job) fail('NOT_FOUND', '找不到这个生成任务');
  const steps = resumeStepsFor(projectId, job.stage_key, job);
  if (!steps.length) fail('BAD_REQUEST', '这个任务没有需要重跑的步骤');
  const next = startJob({ projectId, stageKey: job.stage_key, kind: job.kind, steps, retryOfId: job.id, unitsTotal: steps.length });
  if (job.stage_key === 'p4') for (const step of steps) if (step.targetId) setUnitStatus(projectId, step.targetId, 'generating');
  return next;
}

export function jobViewOf(job: JobRow) {
  return buildSnapshot(job.project_id).job || buildSnapshot(job.project_id).lastJob;
}

// ---------------------------------------------------------------------------
// 条目编辑 / 锁定 / 历史
// ---------------------------------------------------------------------------

const ITEM_FIELD_WHITELIST: Record<string, string[]> = {
  world: ['era', 'worldRules', 'worldRulesNotNeeded', 'tone', 'language'],
  env: ['name', 'type', 'mood', 'reason'],
  character: ['name', 'role', 'age', 'motivation', 'personality', 'secret', 'tags'],
  act: ['title', 'summary', 'function', 'characters'],
  beat: ['title', 'summary', 'function', 'plannedChapters', 'foreshadow'],
  chapter_plan: ['title', 'function', 'synopsis', 'characters', 'minWords', 'targetWords', 'maxWords'],
  chapter: ['title'],
};

export function patchItem(
  projectId: string,
  itemId: string,
  patch: { title?: string; payload?: Record<string, unknown> },
  stageHint?: StageKey,
): { item: PipelineItem; stage: StageKey } {
  const found = findItemRow(itemId);
  if (!found || found.row.project_id !== projectId) fail('NOT_FOUND', '找不到这个条目');
  const stageKey = stageKeyOfTable(found.table, found.row, stageHint);
  ensureStageIdle(projectId, stageKey);
  const actor: 'manual' = 'manual';
  const updated = withTx(() => {
    if (found.table === 'stage_items') {
      const current = parseJson<Record<string, unknown>>(found.row.payload, {});
      const kind = String(found.row.kind || '');
      const allowed = ITEM_FIELD_WHITELIST[kind] || Object.keys(patch.payload || {});
      const next: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(patch.payload || {})) if (allowed.includes(key)) next[key] = value;
      const title = patch.title ?? String(found.row.title || '');
      updateStageItem(itemId, { title, payload: next });
      const revision = addRevision({ projectId, stageKey, scope: 'item', targetId: itemId, source: actor, content: JSON.stringify({ title, payload: next }) });
      updateStageItem(itemId, { current_revision_id: revision.id });
      pruneItemRevisions(projectId, itemId);
    } else if (found.table === 'chapters') {
      const next = { ...patch.payload } as Record<string, unknown>;
      const target = Number(next.targetWords ?? found.row.target_words ?? DEFAULT_WORD_RANGE.targetWords);
      let min = Number(next.minWords ?? found.row.min_words ?? DEFAULT_WORD_RANGE.minWords);
      let max = Number(next.maxWords ?? found.row.max_words ?? DEFAULT_WORD_RANGE.maxWords);
      if (min > target) min = target;
      if (max < target) max = target;
      if (min < DEFAULT_WORD_RANGE.minWordsFloor) fail('BAD_REQUEST', `最小字数不得低于 ${DEFAULT_WORD_RANGE.minWordsFloor}`);
      if (max > DEFAULT_WORD_RANGE.maxWordsCeiling) fail('BAD_REQUEST', `最大字数不得超过 ${DEFAULT_WORD_RANGE.maxWordsCeiling}`);
      const manualTarget = next.targetWords === undefined ? 0 : 1;
      exec(
        'UPDATE chapters SET title = ?, plan_function = ?, plan_synopsis = ?, plan_characters = ?, min_words = ?, target_words = ?, max_words = ?, target_manual = ?, updated_at = ? WHERE id = ?',
        String(patch.title ?? next.title ?? found.row.title ?? ''),
        String(next.function ?? found.row.plan_function ?? ''),
        String(next.synopsis ?? found.row.plan_synopsis ?? ''),
        JSON.stringify(Array.isArray(next.characters) ? next.characters : parseJson<string[]>(found.row.plan_characters, [])),
        min,
        target,
        max,
        manualTarget ? 1 : Number(found.row.target_manual || 0),
        now(),
        itemId,
      );
      addRevision({ projectId, stageKey, scope: 'item', targetId: itemId, source: actor, content: JSON.stringify(patch) });
    } else {
      applyCharacterOrOutlinePatch(found.table, found.row, patch);
      addRevision({ projectId, stageKey, scope: 'item', targetId: itemId, source: actor, content: JSON.stringify(patch) });
    }
    afterContentTouched(projectId, stageKey);
    return { item: findItem(projectId, itemId), stage: stageKey };
  });
  return updated;
}

function applyCharacterOrOutlinePatch(table: string, row: Record<string, any>, patch: { title?: string; payload?: Record<string, unknown> }) {
  const payload = { ...(patch.payload || {}) } as Record<string, any>;
  if (table === 'characters') {
    exec(
      'UPDATE characters SET name = ?, role = ?, age = ?, motivation = ?, description = ?, secret = ?, tags = ? WHERE id = ?',
      String(patch.title ?? payload.name ?? row.name ?? ''),
      String(payload.role ?? row.role ?? ''),
      String(payload.age ?? row.age ?? ''),
      String(payload.motivation ?? row.motivation ?? ''),
      String(payload.personality ?? row.description ?? ''),
      String(payload.secret ?? row.secret ?? ''),
      JSON.stringify(Array.isArray(payload.tags) ? payload.tags : parseJson<string[]>(row.tags, [])),
      String(row.id),
    );
    return;
  }
  if (table === 'outline_acts') {
    exec(
      'UPDATE outline_acts SET title = ?, summary = ?, act_function = ?, characters = ? WHERE id = ?',
      String(patch.title ?? payload.title ?? row.title ?? ''),
      String(payload.summary ?? row.summary ?? ''),
      String(payload.function ?? row.act_function ?? ''),
      JSON.stringify(Array.isArray(payload.characters) ? payload.characters : parseJson<string[]>(row.characters, [])),
      String(row.id),
    );
    return;
  }
  if (table === 'outline_beats') {
    exec(
      'UPDATE outline_beats SET title = ?, summary = ?, beat_function = ?, planned_chapters = ?, foreshadow = ? WHERE id = ?',
      String(patch.title ?? payload.title ?? row.title ?? ''),
      String(payload.summary ?? row.summary ?? ''),
      String(payload.function ?? row.beat_function ?? ''),
      String(payload.plannedChapters ?? row.planned_chapters ?? '1'),
      String(payload.foreshadow ?? row.foreshadow ?? ''),
      String(row.id),
    );
  }
}

function findItem(projectId: string, itemId: string): PipelineItem {
  for (const stage of STAGE_KEYS) {
    const hit = listItems(projectId, stage).find((item) => item.id === itemId);
    if (hit) return hit;
  }
  fail('NOT_FOUND', '找不到这个条目');
}

/**
 * 内容被改动后：本阶段若已确认则回到 review（R2），并**无条件**给下游标 stale。
 *
 * DEF-13：早期把 markDownstreamStale 也放进了 `if (status === 'confirmed')`，
 * 于是「编辑 P1 → P2 keep 清 stale → 再编辑 P1」这条链路里 P2 永久失去 stale 提示
 * （第二次编辑时 P1 已是 review，不再进那个分支）。上游变了就是变了，
 * 下游要不要复核与上游自己是否已确认无关，所以标记必须无条件做。
 */
function afterContentTouched(projectId: string, stageKey: StageKey, action: 'edited' | 'regenerated' = 'edited') {
  const stage = getStage(projectId, stageKey);
  if (!stage) return;
  if (stage.status === 'confirmed') setStageStatus(projectId, stageKey, 'review');
  markDownstreamStale(projectId, stageKey, `${stageKey}:${action}`);
  touchProject(projectId);
}

/**
 * 生成期间禁止手改（F8）：正在跑 job 的阶段由 runner 独占写，
 * 手改会与「生成完整体替换」串味（改一条、被覆盖、还以为保存了）。
 */
export function ensureStageIdle(projectId: string, stageKey: StageKey) {
  const stage = getStage(projectId, stageKey);
  if (stage?.status === 'generating') {
    fail('CONCURRENT_JOB', '这一阶段正在生成，等它跑完或先取消再改', { blockers: [stageKey] });
  }
  // 队列里刚起跑（queued）时阶段状态还没翻成 generating，也要挡住并发写，否则「生成期间编辑」会漏。
  const job = activeJob(projectId);
  if (job && String(job.stage_key) === stageKey) {
    fail('CONCURRENT_JOB', '这一阶段正在生成，等它跑完或先取消再改', { blockers: [stageKey] });
  }
}

export function lockItem(projectId: string, itemId: string, locked: boolean): PipelineItem {
  const found = findItemRow(itemId);
  if (!found || found.row.project_id !== projectId) fail('NOT_FOUND', '找不到这个条目');
  if (found.table === 'stage_items') updateStageItem(itemId, { locked });
  else if (found.table === 'chapters') exec('UPDATE chapters SET plan_locked = ?, updated_at = ? WHERE id = ?', locked ? 1 : 0, now(), itemId);
  else if (found.table === 'characters') exec('UPDATE characters SET locked = ? WHERE id = ?', locked ? 1 : 0, itemId);
  else if (found.table === 'outline_acts') exec('UPDATE outline_acts SET locked = ? WHERE id = ?', locked ? 1 : 0, itemId);
  else if (found.table === 'outline_beats') exec('UPDATE outline_beats SET locked = ? WHERE id = ?', locked ? 1 : 0, itemId);
  return findItem(projectId, itemId);
}

export function stageRevisions(projectId: string, stageKey: StageKey, targetId?: string): Revision[] {
  return listRevisions(projectId, stageKey, targetId ?? null);
}

// ---------------------------------------------------------------------------
// 条目新增 / 删除 / 排序（SPEC M3，DEF-15）
// ---------------------------------------------------------------------------

function nextOrder(sql: string, ...params: Array<string | number | null>): number {
  const row = oneRow(sql, ...params);
  return Number(row?.n || 0);
}

export interface ItemCreateInput {
  kind?: string;
  title?: string;
  payload?: Record<string, unknown>;
  /** 节拍必须挂在某一幕/节拍组下：novel 传 outline_acts.id，short 传 stage_items(beat_group).id */
  parentId?: string;
}

/**
 * 新增一条 P1/P2 条目。
 * 只允许在 p1/p2 增条目：p3 的单元数由「章节数」接口负责（避免两条路径各删一半），p4 是正文。
 */
export function createItem(projectId: string, stageKey: StageKey, input: ItemCreateInput): { item: PipelineItem; stage: StageKey } {
  const project = requireProject(projectId);
  kindProfileOf(project.type);
  if (stageKey !== 'p1' && stageKey !== 'p2') fail('BAD_REQUEST', '只有设定与故事大纲支持新增条目');
  ensureStageIdle(projectId, stageKey);
  const isShort = kindOf(projectId) === 'short';
  const payload = { ...(input.payload || {}) };
  const title = String(input.title || '');
  const newId = withTx(() => {
    let id = '';
    if (stageKey === 'p1') {
      const kind = String(input.kind || 'character');
      if (kind === 'world') {
        if (listItems(projectId, 'p1').some((item) => item.kind === 'world')) fail('BAD_REQUEST', '世界观只能有一条，直接编辑现有的那条');
        id = insertStageItem({ projectId, stageKey: 'p1', kind, ordinal: 0, title: title || '世界观', payload, source: 'manual' });
      } else if (kind === 'env') {
        const ordinal = nextOrder("SELECT COALESCE(MAX(ordinal), -1) + 1 AS n FROM stage_items WHERE project_id = ? AND stage_key = 'p1' AND kind = 'env'", projectId);
        id = insertStageItem({ projectId, stageKey: 'p1', kind, ordinal, title: title || '新环境', payload, source: 'manual' });
      } else if (kind === 'character') {
        id = uid('chr');
        const order = nextOrder('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM characters WHERE project_id = ?', projectId);
        exec(
          `INSERT INTO characters (id, project_id, name, role, age, avatar, tags, quote, description, secret, relations, sort_order, motivation, arc, is_protagonist, locked, source)
           VALUES (?, ?, ?, ?, ?, '', ?, '', ?, ?, '[]', ?, ?, '', 0, 0, 'manual')`,
          id,
          projectId,
          title || String(payload.name || '新人物'),
          String(payload.role || ''),
          String(payload.age || ''),
          JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
          String(payload.personality ?? ''),
          String(payload.secret || ''),
          order,
          String(payload.motivation || ''),
        );
      } else {
        fail('BAD_REQUEST', '设定阶段只支持 world / env / character 三种条目');
      }
    } else if (isShort) {
      const kind = String(input.kind || (input.parentId ? 'beat' : 'beat_group'));
      if (kind === 'beat_group') {
        const ordinal = nextOrder("SELECT COALESCE(MAX(ordinal), -1) + 1 AS n FROM stage_items WHERE project_id = ? AND stage_key = 'p2' AND kind = 'beat_group'", projectId);
        id = insertStageItem({ projectId, stageKey: 'p2', kind, ordinal, title: title || '新节拍组', payload, source: 'manual' });
      } else if (kind === 'beat') {
        const parentId = String(input.parentId || payload.groupId || '');
        const parent = parentId ? getStageItemRow(parentId) : undefined;
        if (!parent || parent.project_id !== projectId || parent.kind !== 'beat_group') fail('BAD_REQUEST', '节拍必须挂在某个节拍组下');
        const ordinal = nextOrder("SELECT COALESCE(MAX(ordinal), -1) + 1 AS n FROM stage_items WHERE project_id = ? AND stage_key = 'p2' AND kind = 'beat'", projectId);
        id = insertStageItem({
          projectId,
          stageKey: 'p2',
          kind,
          ordinal,
          title: title || '新节拍',
          payload: { ...payload, groupId: parentId },
          source: 'manual',
        });
      } else {
        fail('BAD_REQUEST', '短篇大纲只支持 beat_group / beat 两种条目');
      }
    } else {
      const kind = String(input.kind || (input.parentId ? 'beat' : 'act'));
      if (kind === 'act') {
        const order = nextOrder('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM outline_acts WHERE project_id = ?', projectId);
        id = uid('act');
        exec(
          'INSERT INTO outline_acts (id, project_id, title, summary, sort_order, act_function, characters, locked, source) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
          id,
          projectId,
          title || `第${order + 1}幕`,
          String(payload.summary || ''),
          order,
          String(payload.function || ''),
          JSON.stringify(Array.isArray(payload.characters) ? payload.characters : []),
          'manual',
        );
      } else if (kind === 'beat') {
        const parentId = String(input.parentId || payload.actId || '');
        const act = parentId ? oneRow('SELECT * FROM outline_acts WHERE id = ? AND project_id = ?', parentId, projectId) : undefined;
        if (!act) fail('BAD_REQUEST', '节拍必须挂在某一幕下');
        const order = nextOrder('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM outline_beats WHERE project_id = ? AND act_id = ?', projectId, parentId);
        id = uid('beat');
        exec(
          `INSERT INTO outline_beats (id, project_id, act_id, chapter_no, title, summary, tags, status, sort_order, beat_function, planned_chapters, foreshadow, locked, source)
           VALUES (?, ?, ?, ?, ?, ?, '[]', '待写', ?, ?, ?, ?, 0, 'manual')`,
          id,
          projectId,
          parentId,
          order + 1,
          title || '新节拍',
          String(payload.summary || ''),
          order,
          String(payload.function || ''),
          String(payload.plannedChapters ?? '1'),
          String(payload.foreshadow || ''),
        );
      } else {
        fail('BAD_REQUEST', '长篇大纲只支持 act / beat 两种条目');
      }
    }
    const revision = addRevision({ projectId, stageKey, scope: 'item', targetId: id, source: 'manual', content: JSON.stringify({ title, payload, created: true }) });
    if (stageKey === 'p1' && (findItemRow(id)?.table === 'stage_items')) updateStageItem(id, { current_revision_id: revision.id });
    if (stageKey === 'p2' && findItemRow(id)?.table === 'stage_items') updateStageItem(id, { current_revision_id: revision.id });
    afterContentTouched(projectId, stageKey);
    return id;
  });
  return { item: findItem(projectId, newId), stage: stageKey };
}

/** 删除一条 P1/P2 条目；锁定条目与带正文的单元不允许删（避免静默丢内容）。 */
export function deleteItem(projectId: string, itemId: string): { stage: StageKey; deleted: string[] } {
  const found = findItemRow(itemId);
  if (!found || found.row.project_id !== projectId) fail('NOT_FOUND', '找不到这个条目');
  if (found.table === 'chapters') fail('BAD_REQUEST', '章/节拍的增删请用「章节数」或「节拍计划」，这里只能改与排序');
  if (Number(found.row.locked || 0) === 1) fail('ITEM_LOCKED', '这一条已锁定，先解锁再删');
  const stageKey = stageKeyOfTable(found.table, found.row);
  if (stageKey !== 'p1' && stageKey !== 'p2') fail('BAD_REQUEST', '只有设定与故事大纲支持删除条目');
  ensureStageIdle(projectId, stageKey);
  const deleted: string[] = [];
  withTx(() => {
    if (found.table === 'outline_acts') {
      for (const beat of allRows('SELECT id FROM outline_beats WHERE act_id = ?', itemId)) {
        if (Number(oneRow('SELECT locked FROM outline_beats WHERE id = ?', String(beat.id))?.locked || 0) === 1) fail('ITEM_LOCKED', '这一幕里还有锁定的节拍，先解锁再删');
        exec('DELETE FROM outline_beats WHERE id = ?', String(beat.id));
        deleted.push(String(beat.id));
      }
    }
    if (found.table === 'stage_items' && String(found.row.kind) === 'beat_group') {
      for (const beat of allRows("SELECT id FROM stage_items WHERE project_id = ? AND stage_key = 'p2' AND kind = 'beat'", projectId)) {
        const row = getStageItemRow(String(beat.id))!;
        if (parseJson<Record<string, unknown>>(row.payload, {}).groupId !== itemId) continue;
        if (Number(row.locked) === 1) fail('ITEM_LOCKED', '这个节拍组里还有锁定的节拍，先解锁再删');
        exec('DELETE FROM stage_items WHERE id = ?', String(beat.id));
        deleted.push(String(beat.id));
      }
    }
    if (found.table === 'stage_items') exec('DELETE FROM stage_items WHERE id = ?', itemId);
    else if (found.table === 'characters') exec('DELETE FROM characters WHERE id = ?', itemId);
    else if (found.table === 'outline_acts') exec('DELETE FROM outline_acts WHERE id = ?', itemId);
    else if (found.table === 'outline_beats') exec('DELETE FROM outline_beats WHERE id = ?', itemId);
    deleted.push(itemId);
    afterContentTouched(projectId, stageKey);
  });
  return { stage: stageKey, deleted };
}

/** 排序校验：提交的 id 必须正好是这一块的全部条目（少一个/多一个都拒，避免静默漏排）。 */
function assertPermutation(expected: string[], ids: string[], label: string) {
  if (!Array.isArray(ids) || ids.length !== expected.length) fail('BAD_REQUEST', `排序要提交${label}的全部条目（当前 ${expected.length} 条）`);
  const wanted = new Set(expected);
  const seen = new Set<string>();
  for (const id of ids) {
    if (!wanted.has(id)) fail('BAD_REQUEST', `有不属于${label}的条目混进了排序请求`);
    if (seen.has(id)) fail('BAD_REQUEST', '排序请求里有重复条目');
    seen.add(id);
  }
}

export function reorderItems(projectId: string, stageKey: StageKey, input: { block?: string; ids: string[] }): { stage: StageKey; items: PipelineItem[] } {
  requireProject(projectId);
  if (stageKey === 'p3') {
    reorderUnits(projectId, input.ids);
    return { stage: stageKey, items: listItems(projectId, stageKey) };
  }
  if (stageKey === 'p4') fail('BAD_REQUEST', '正文按章节顺序排列，不支持单独排序');
  const block = String(input.block || '');
  if (!block) fail('BAD_REQUEST', '缺少排序范围');
  ensureStageIdle(projectId, stageKey);
  const isShort = kindOf(projectId) === 'short';
  withTx(() => {
    if (stageKey === 'p1') {
      if (block === 'env') {
        const rows = allRows("SELECT id FROM stage_items WHERE project_id = ? AND stage_key = 'p1' AND kind = 'env' AND archived_at IS NULL ORDER BY ordinal ASC, id ASC", projectId);
        const expected = rows.map((row) => String(row.id));
        assertPermutation(expected, input.ids, '环境列表');
        input.ids.forEach((id, index) => updateStageItem(id, { ordinal: index }));
      } else if (block === 'characters') {
        const rows = allRows('SELECT id FROM characters WHERE project_id = ? ORDER BY sort_order ASC, id ASC', projectId);
        const expected = rows.map((row) => String(row.id));
        assertPermutation(expected, input.ids, '人物列表');
        input.ids.forEach((id, index) => exec('UPDATE characters SET sort_order = ? WHERE id = ?', index, id));
      } else {
        fail('BAD_REQUEST', '设定阶段只有环境与人物可以排序');
      }
    } else if (block === 'acts') {
      if (isShort) {
        const expected = listStageItemRows(projectId, 'p2', 'beat_group').map((row) => row.id);
        assertPermutation(expected, input.ids, '节拍组列表');
        input.ids.forEach((id, index) => updateStageItem(id, { ordinal: index }));
      } else {
        const rows = allRows('SELECT id FROM outline_acts WHERE project_id = ? ORDER BY sort_order ASC, id ASC', projectId);
        const expected = rows.map((row) => String(row.id));
        assertPermutation(expected, input.ids, '幕列表');
        input.ids.forEach((id, index) => exec('UPDATE outline_acts SET sort_order = ? WHERE id = ?', index, id));
      }
    } else if (isShort) {
      const group = getStageItemRow(block);
      if (!group || group.project_id !== projectId || group.kind !== 'beat_group') fail('NOT_FOUND', '找不到这个节拍组');
      const expected = listStageItemRows(projectId, 'p2', 'beat')
        .filter((row) => parseJson<Record<string, unknown>>(row.payload, {}).groupId === block)
        .map((row) => row.id);
      assertPermutation(expected, input.ids, '节拍列表');
      input.ids.forEach((id, index) => updateStageItem(id, { ordinal: index }));
    } else {
      const act = oneRow('SELECT * FROM outline_acts WHERE id = ? AND project_id = ?', block, projectId);
      if (!act) fail('NOT_FOUND', '找不到这一幕');
      const rows = allRows('SELECT id FROM outline_beats WHERE project_id = ? AND act_id = ? ORDER BY sort_order ASC, id ASC', projectId, block);
      const expected = rows.map((row) => String(row.id));
      assertPermutation(expected, input.ids, '节拍列表');
      input.ids.forEach((id, index) => exec('UPDATE outline_beats SET sort_order = ? WHERE id = ?', index, id));
    }
    afterContentTouched(projectId, stageKey);
  });
  return { stage: stageKey, items: listItems(projectId, stageKey) };
}

/**
 * 章节计划排序。
 *
 * F9/F10：`chapters` 是「计划 + 正文」共用的一张表，短篇的节拍正文还会按
 * `stage_items.ordinal == chapters.sort_order` 回写镜像行。所以排序必须三件事一起做：
 *   ① 长篇：改写 `chapters.sort_order` 并重算 `number`（否则目录错序、给模型灌错章号）；
 *   ② 短篇：改写 `stage_items.ordinal`，并同步镜像 `chapters` 行的 `sort_order` 与 `number`；
 *   ③ 两段式写入（先挪到负区再落到目标值），避免中途撞上仍有 UNIQUE 语义的行。
 */
export function reorderUnits(projectId: string, ids: string[]): { summary: ReturnType<typeof planSummary> } {
  requireProject(projectId);
  const units = listUnits(projectId);
  assertPermutation(units.map((unit) => unit.id), Array.isArray(ids) ? ids : [], '章节计划');
  ensureStageIdle(projectId, 'p3');
  const isShort = kindOf(projectId) === 'short';
  withTx(() => {
    // 短篇：先记下「旧 ordinal → chapters 镜像行」的关系，排序后按新位置回写。
    const mirror = new Map<number, string>();
    if (isShort) {
      const rows = allRows('SELECT id, sort_order FROM chapters WHERE project_id = ? AND deleted_at IS NULL', projectId);
      rows.forEach((row, order) => {
        mirror.set(Number(row.sort_order || 0), String(row.id));
        exec('UPDATE chapters SET sort_order = ? WHERE id = ?', -1000 - order, String(row.id));
      });
    }
    ids.forEach((id, index) => {
      const unit = units.find((entry) => entry.id === id)!;
      if (unit.kind === 'beat') updateStageItem(id, { ordinal: index });
      else exec('UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ?', index, now(), id);
    });
    if (isShort) {
      // 节拍没有 number 列，镜像行的章号跟位置走，保证「第 N 节拍」与导出顺序一致。
      ids.forEach((id, index) => {
        const unit = units.find((entry) => entry.id === id)!;
        const chapterId = mirror.get(unit.ordinal);
        if (!chapterId) return;
        exec('UPDATE chapters SET sort_order = ?, number = ?, updated_at = ? WHERE id = ?', index, `第${index + 1}节拍`, now(), chapterId);
      });
    } else {
      const rows = allRows('SELECT id FROM chapters WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC', projectId);
      rows.forEach((row, index) => exec('UPDATE chapters SET number = ? WHERE id = ?', `第${index + 1}章`, String(row.id)));
    }
    afterContentTouched(projectId, 'p3', 'edited');
  });
  return { summary: planSummary(projectId) };
}

export function restoreItemRevision(projectId: string, revisionId: string): PipelineItem {
  const row = oneRow('SELECT * FROM revisions WHERE id = ? AND project_id = ?', revisionId, projectId);
  if (!row) fail('NOT_FOUND', '找不到这个历史版本');
  const targetId = String(row.target_id || '');
  if (!targetId) fail('BAD_REQUEST', '阶段级快照不能单条恢复，请使用阶段历史预览');
  const payload = parseJson<Record<string, unknown>>(row.content, {});
  const found = findItemRow(targetId);
  if (!found) fail('NOT_FOUND', '这一条已经被删除了');
  // F1/F15：阶段来自这条修订自己的 stage_key（恢复计划 → p3，恢复正文 → p4），不靠猜；
  // 嵌套 withTx 由 SAVEPOINT 支持，所以这里可以直接复用 patchItem 的写入主体。
  const stageKey = (String(row.stage_key || '') as StageKey) || stageKeyOfTable(found.table, found.row);
  withTx(() => {
    if (found.table === 'stage_items') {
      updateStageItem(targetId, { title: String(payload.title || found.row.title), payload: (payload.payload as Record<string, unknown>) || payload });
    } else if (found.table === 'chapters') {
      // 章节计划的修订有两种写入形态：`/items/:id` 记 {title, payload}，`/units/:id` 记扁平的字数对象。
      // 恢复时必须都认，否则「恢复历史」会静默什么都不改（F1 回归用例当场抓到）。
      patchItem(projectId, targetId, { title: String(payload.title || ''), payload: (payload.payload as Record<string, unknown>) || payload }, stageKey);
    } else {
      applyCharacterOrOutlinePatch(found.table, found.row, { title: String(payload.title || ''), payload: (payload.payload as Record<string, unknown>) || {} });
    }
    const revision = addRevision({ projectId, stageKey, scope: 'item', targetId, source: 'rollback', content: String(row.content) });
    if (found.table === 'stage_items') updateStageItem(targetId, { current_revision_id: revision.id });
    afterContentTouched(projectId, stageKey);
  });
  return findItem(projectId, targetId);
}

// ---------------------------------------------------------------------------
// 章节计划：字数、数量、分配
// ---------------------------------------------------------------------------

export function patchUnit(projectId: string, unitId: string, patch: {
  title?: string;
  function?: string;
  synopsis?: string;
  characters?: string[];
  minWords?: number;
  targetWords?: number;
  maxWords?: number;
  acceptDeviation?: boolean;
}) {
  const unit = getUnitRow(projectId, unitId);
  if (!unit) fail('NOT_FOUND', '找不到这一章');
  ensureStageIdle(projectId, 'p3');
  const min = Math.round(patch.minWords ?? unit.minWords ?? DEFAULT_WORD_RANGE.minWords);
  const target = Math.round(patch.targetWords ?? unit.targetWords ?? DEFAULT_WORD_RANGE.targetWords);
  const max = Math.round(patch.maxWords ?? unit.maxWords ?? DEFAULT_WORD_RANGE.maxWords);
  if (min < DEFAULT_WORD_RANGE.minWordsFloor) fail('BAD_REQUEST', `最小字数不得低于 ${DEFAULT_WORD_RANGE.minWordsFloor}`);
  if (max > DEFAULT_WORD_RANGE.maxWordsCeiling) fail('BAD_REQUEST', `最大字数不得超过 ${DEFAULT_WORD_RANGE.maxWordsCeiling}`);
  if (!(min <= target && target <= max)) fail('BAD_REQUEST', '字数范围必须满足 min ≤ target ≤ max');
  if (patch.acceptDeviation) acceptDeviation(projectId, true);

  withTx(() => {
    if (unit.kind === 'beat') {
      const row = getStageItemRow(unitId)!;
      const payload = {
        ...parseJson<Record<string, unknown>>(row.payload, {}),
        planFunction: patch.function ?? unit.planFunction,
        planSynopsis: patch.synopsis ?? unit.planSynopsis,
        minWords: min,
        plannedWords: target,
        maxWords: max,
        characters: patch.characters ?? unit.planCharacters,
        targetManual: patch.targetWords === undefined ? Boolean(parseJson<Record<string, unknown>>(row.payload, {}).targetManual) : true,
      };
      updateStageItem(unitId, { title: patch.title ?? unit.title, payload });
      addRevision({ projectId, stageKey: 'p3', scope: 'item', targetId: unitId, source: 'manual', content: JSON.stringify(payload) });
    } else {
      exec(
        'UPDATE chapters SET title = ?, plan_function = ?, plan_synopsis = ?, plan_characters = ?, min_words = ?, target_words = ?, max_words = ?, target_manual = ?, updated_at = ? WHERE id = ?',
        patch.title ?? unit.title,
        patch.function ?? unit.planFunction,
        patch.synopsis ?? unit.planSynopsis,
        JSON.stringify(patch.characters ?? unit.planCharacters),
        min,
        target,
        max,
        patch.targetWords === undefined ? (Number((oneRow('SELECT target_manual FROM chapters WHERE id = ?', unitId)?.target_manual) || 0)) : 1,
        now(),
        unitId,
      );
      addRevision({ projectId, stageKey: 'p3', scope: 'item', targetId: unitId, source: 'manual', content: JSON.stringify(patch) });
    }
    afterContentTouched(projectId, 'p3');
  });
  const summary = planSummary(projectId);
  return { unit: listItems(projectId, 'p3').find((item) => item.id === unitId) || null, summary };
}

export function planSummary(projectId: string) {
  const units = listUnits(projectId);
  const project = requireProject(projectId);
  const total = units.reduce((sum, unit) => sum + (unit.targetWords || 0), 0);
  const goal = Number(project.goal_words || 0);
  const deviationPct = goal > 0 ? Number((((total - goal) / goal) * 100).toFixed(1)) : 0;
  return {
    units: units.length,
    totalTarget: total,
    goalWords: goal,
    deviationPct,
    overTolerance: Math.abs(deviationPct / 100) > DEVIATION_TOLERANCE,
    accepted: deviationAccepted(projectId),
    ready: units.filter((unit) => Boolean(unit.content.trim())).length,
    locked: units.filter((unit) => unit.locked).length,
  };
}

export function setUnitCount(projectId: string, count: number, archiveOrphans = false) {
  const project = requireProject(projectId);
  const profile = kindProfileOf(project.type);
  const wanted = Math.round(count);
  if (!(profile.minUnits <= wanted && wanted <= profile.maxUnits)) fail('BAD_REQUEST', `${profile.unitLabel}数必须在 ${profile.minUnits}–${profile.maxUnits} 之间`);
  // N2：写作进行中改章节数会把「正在写的那一章」删掉 —— 写步骤的 UPDATE 命中 0 行不报错，
  // 紧接着照样插一条版本行，于是正文丢失、版本表留下孤儿、job 却报成功。
  // 这里不能只挡 p3 自己：p4 写作时 p3 已经是 confirmed（不是 generating），
  // 从阶段状态看是「空闲的」，所以改成任何 active job 都拒。
  ensureStageIdle(projectId, 'p3');
  const running = activeJob(projectId);
  if (running) {
    fail('CONCURRENT_JOB', `「${String(running.stage_key)}」正在生成，等它跑完或先取消再改${profile.unitLabel}数`, {
      blockers: [String(running.stage_key)],
    });
  }
  const units = listUnits(projectId);
  if (wanted < units.length) {
    const removed = units.slice(wanted);
    const withContent = removed.filter((unit) => Boolean(unit.content.trim()));
    if (withContent.length && !archiveOrphans) fail('CONTENT_WOULD_BE_LOST', '要删除的范围内已有正文', { blockers: withContent.map((unit) => unit.title) });
    withTx(() => {
      for (const unit of removed) {
        if (unit.kind === 'beat') {
          if (unit.content.trim() || archiveOrphans) updateStageItem(unit.id, { archived_at: now() });
          else exec('DELETE FROM stage_items WHERE id = ?', unit.id);
        } else if (unit.content.trim() || archiveOrphans) {
          exec('UPDATE chapters SET archived_at = ?, updated_at = ? WHERE id = ?', now(), now(), unit.id);
        } else {
          exec('DELETE FROM chapters WHERE id = ?', unit.id);
        }
      }
      afterContentTouched(projectId, 'p3');
    });
  } else if (wanted > units.length) {
    withTx(() => {
      for (let index = units.length; index < wanted; index += 1) addPlannedUnit(projectId, index);
      afterContentTouched(projectId, 'p3');
    });
  }
  return planSummary(projectId);
}

function addPlannedUnit(projectId: string, ordinal: number) {
  const project = requireProject(projectId);
  const profile = kindProfileOf(project.type);
  const min = Math.round(profile.defaultUnitWords * 0.83);
  const target = profile.defaultUnitWords;
  const max = Math.round(profile.defaultUnitWords * 1.33);
  if (project.type === 'short') {
    insertStageItem({
      projectId,
      stageKey: 'p3',
      kind: 'beat_plan',
      ordinal,
      title: `第${ordinal + 1}${profile.unitLabel}`,
      payload: { planFunction: '推进', planSynopsis: '待补充大纲：请编辑这一节拍发生了什么。', minWords: min, plannedWords: target, maxWords: max, characters: [] },
      reviewStatus: 'pending',
    });
    return;
  }
  exec(
    `INSERT INTO chapters (id, project_id, volume, number, title, content, status, sort_order, words, updated_at, review_status, plan_function, plan_synopsis, plan_characters, min_words, target_words, max_words, target_manual, plan_locked, stale)
     VALUES (?, ?, '第一卷', ?, ?, '', '草稿', ?, 0, ?, 'pending', '推进', '待补充大纲：请编辑这一章发生了什么。', '[]', ?, ?, ?, 0, 0, 0)`,
    uid('ch'),
    projectId,
    `第${ordinal + 1}章`,
    `第${ordinal + 1}章`,
    ordinal,
    now(),
    min,
    target,
    max,
  );
}

export function allocate(projectId: string, totalTarget: number, rows?: AllocationRow[]): AllocationPreview {
  const units = listUnits(projectId);
  if (!units.length) fail('BAD_REQUEST', '还没有章节计划');
  const project = requireProject(projectId);
  const goal = totalTarget > 0 ? Math.round(totalTarget) : Number(project.goal_words || 0);
  const equal = Math.max(DEFAULT_WORD_RANGE.minWordsFloor, Math.round(goal / units.length));
  const preview: AllocationRow[] = units.map((unit) => {
    const manual = rows?.find((row) => row.unitId === unit.id);
    const target = manual ? Math.round(manual.targetWords) : equal;
    return {
      unitId: unit.id,
      targetWords: target,
      minWords: manual ? Math.round(manual.minWords) : Math.round(target * 0.85),
      maxWords: manual ? Math.round(manual.maxWords) : Math.round(target * 1.2),
      manuallyEdited: manualTargetOf(unit.id),
    };
  });
  const totalBefore = units.reduce((sum, unit) => sum + (unit.targetWords || 0), 0);
  const totalAfter = preview.reduce((sum, row) => sum + row.targetWords, 0);
  const deviationPct = goal > 0 ? Number((((totalAfter - goal) / goal) * 100).toFixed(1)) : 0;
  return { preview, totalBefore, totalAfter, deviationPct, overTolerance: Math.abs(deviationPct / 100) > DEVIATION_TOLERANCE, goalWords: goal };
}

/**
 * 手改标记以服务端为准（D9）：长篇读 chapters.target_manual，短篇读 stage_items.payload.targetManual。
 * 客户端传来的 manuallyEdited 一律忽略，避免伪造 false 覆盖用户手改。
 */
function manualTargetOf(unitId: string): boolean {
  const chapter = oneRow('SELECT target_manual FROM chapters WHERE id = ?', unitId);
  if (chapter) return Number(chapter.target_manual || 0) === 1;
  const item = oneRow("SELECT payload FROM stage_items WHERE id = ? AND kind = 'beat_plan'", unitId);
  if (!item) return false;
  return parseJson<Record<string, unknown>>(item.payload, {}).targetManual === true;
}

/**
 * 分配结果落库（F5/F6）。
 * - 逐行复用章节计划同样的区间校验，非法行一次性列出来，不写半套；
 * - `target_manual` 只在「本次目标值确实变了」的行上置 1，`includeEdited` 只清被这次覆盖的行。
 *   原实现把每一行都标成手改，于是第一次分配之后这个作品的分配功能就永久锁死了。
 */
function allocationProblems(row: AllocationRow): string[] {
  const min = Math.round(Number(row.minWords));
  const target = Math.round(Number(row.targetWords));
  const max = Math.round(Number(row.maxWords));
  if (!Number.isFinite(min) || !Number.isFinite(target) || !Number.isFinite(max)) return ['字数必须是数字'];
  const problems: string[] = [];
  if (min < DEFAULT_WORD_RANGE.minWordsFloor) problems.push(`最小字数不得低于 ${DEFAULT_WORD_RANGE.minWordsFloor}`);
  if (max > DEFAULT_WORD_RANGE.maxWordsCeiling) problems.push(`最大字数不得超过 ${DEFAULT_WORD_RANGE.maxWordsCeiling}`);
  if (!(min <= target && target <= max)) problems.push('字数范围必须满足 min ≤ target ≤ max');
  return problems;
}

export function applyAllocation(projectId: string, rows: AllocationRow[], includeEdited = false) {
  if (!Array.isArray(rows) || !rows.length) fail('BAD_REQUEST', '缺少分配结果');
  ensureStageIdle(projectId, 'p3');
  const invalid = rows
    .map((row) => ({ unitId: row.unitId, problems: allocationProblems(row) }))
    .filter((entry) => entry.problems.length);
  if (invalid.length) {
    fail('BAD_REQUEST', `有 ${invalid.length} 行字数范围不合法`, {
      blockers: invalid.map((entry) => `${entry.unitId}: ${entry.problems.join('；')}`),
    });
  }
  const planned = rows
    .map((row) => {
      const unit = getUnitRow(projectId, row.unitId);
      if (!unit) return null;
      const min = Math.round(Number(row.minWords));
      const target = Math.round(Number(row.targetWords));
      const max = Math.round(Number(row.maxWords));
      // F5：只有「这次真的改了目标值」的行才算被覆盖；原样重放同一份分配不该再要求确认，
      // 否则第一次分配就把整本标成手改，之后每次分配都要 includeEdited，功能等于废掉。
      const changed = target !== Math.round(Number(unit.targetWords || 0));
      return { unit, min, target, max, changed };
    })
    .filter((entry): entry is { unit: UnitRow; min: number; target: number; max: number; changed: boolean } => Boolean(entry));
  const blocked = planned.filter((entry) => entry.changed && manualTargetOf(entry.unit.id));
  if (!includeEdited && blocked.length) {
    fail('TARGET_EDITED', '有章节的字数是手工改过的，请确认后再覆盖', { blockers: blocked.map((entry) => entry.unit.id) });
  }
  withTx(() => {
    for (const entry of planned) {
      if (entry.unit.kind === 'beat') {
        const item = getStageItemRow(entry.unit.id)!;
        const current = parseJson<Record<string, unknown>>(item.payload, {});
        const payload = {
          ...current,
          minWords: entry.min,
          plannedWords: entry.target,
          maxWords: entry.max,
          targetManual: entry.changed ? !includeEdited : current.targetManual === true,
        };
        updateStageItem(entry.unit.id, { payload });
      } else {
        const manual = entry.changed ? (includeEdited ? 0 : 1) : Number(entry.unit.targetManual ? 1 : 0);
        exec(
          'UPDATE chapters SET min_words = ?, target_words = ?, max_words = ?, target_manual = ?, updated_at = ? WHERE id = ?',
          entry.min,
          entry.target,
          entry.max,
          manual,
          now(),
          entry.unit.id,
        );
      }
    }
    afterContentTouched(projectId, 'p3');
  });
  return planSummary(projectId);
}

// ---------------------------------------------------------------------------
// 章节审阅（唯一写入口，D5）
// ---------------------------------------------------------------------------

export function reviewUnit(projectId: string, unitId: string, input: { action: 'approve' | 'request_changes' | 'manual_approve' | 'skip' | 'rewrite' | 'expand' | 'shrink'; note?: string; mode?: 'continuous' | 'single' }) {
  const project = requireProject(projectId);
  const profile = kindProfileOf(project.type);
  const unit = getUnitRow(projectId, unitId);
  if (!unit) fail('NOT_FOUND', '找不到这一章');
  const note = (input.note || '').trim();
  const generation = input.action === 'rewrite' || input.action === 'expand' || input.action === 'shrink';
  if (generation) {
    ensureNoActiveJob(projectId);
    if (!unit.content.trim()) fail('BAD_REQUEST', '这一章还没有正文，无法重写');
    const target = unit.targetWords || profile.defaultUnitWords;
    const hint =
      input.action === 'expand'
        ? `扩写：当前 ${unit.words} 字，目标 ${target} 字，请补足场景与细节，不要灌水。`
        : input.action === 'shrink'
          ? `压缩：当前 ${unit.words} 字，目标 ${target} 字，请删掉重复与拖沓的情节。`
          : '重写：保留本章功能与信息点，换一种更有效的写法。';
    const job = startJob({
      projectId,
      stageKey: 'p4',
      kind: 'chapter-rewrite',
      steps: [{ op: 'write', targetId: unitId }],
      note: note ? `${hint}\n用户意见：${note}` : hint,
      unitsTotal: 1,
    });
    if (unit.kind === 'beat') setUnitStatus(projectId, unitId, 'generating');
    else exec("UPDATE chapters SET review_status = 'generating' WHERE id = ?", unitId);
    return { status: 202 as const, job, nextPendingChapterId: nextPending(projectId, unitId) };
  }
  if ((input.action === 'request_changes') && note.length < 2) fail('NOTE_REQUIRED', '请说明要改什么');
  if (input.action === 'approve' || input.action === 'manual_approve') {
    if (unit.reviewStatus !== 'in_review' && unit.reviewStatus !== 'changes_requested' && unit.reviewStatus !== 'approved') {
      fail('BAD_REQUEST', '这一章还没有待审的正文');
    }
  }
  const record = withTx(() => {
    const status =
      input.action === 'approve' ? 'approved' : input.action === 'manual_approve' ? 'approved_manual' : input.action === 'request_changes' ? 'changes_requested' : 'skipped';
    if (unit.kind === 'beat') updateStageItem(unitId, { review_status: status });
    else exec('UPDATE chapters SET review_status = ?, updated_at = ? WHERE id = ?', status, now(), unitId);
    const jobRow = oneRow("SELECT id FROM generation_jobs WHERE project_id = ? AND stage_key = 'p4' ORDER BY started_at DESC LIMIT 1", projectId);
    addReviewRecord({
      projectId,
      unitKind: unit.kind,
      unitId,
      action: input.action,
      note,
      versionId: unit.kind === 'chapter' ? (oneRow('SELECT current_version_id FROM chapters WHERE id = ?', unitId)?.current_version_id as string | null) : null,
      jobId: (jobRow?.id as string | null) ?? null,
    });
    touchProject(projectId);
    return unitId;
  });
  console.log(`[review] project=${projectId} unit=${record} action=${input.action} note=${note.slice(0, 40)}`);
  return { status: 200 as const, unit: listItems(projectId, 'p4').find((item) => item.id === unitId) || null, nextPendingChapterId: nextPending(projectId, unitId) };
}

function nextPending(projectId: string, currentUnitId: string): string | null {
  const units = listUnits(projectId);
  const index = units.findIndex((unit) => unit.id === currentUnitId);
  const next = units.slice(index + 1).find((unit) => (unit.reviewStatus || 'pending') === 'pending');
  return next?.id ?? null;
}

export function unitVersions(projectId: string, unitId: string) {
  const unit = getUnitRow(projectId, unitId);
  if (!unit) fail('NOT_FOUND', '找不到这一章');
  if (unit.kind === 'chapter') {
    const versions = allRows('SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC', unitId);
    const current = oneRow('SELECT current_version_id FROM chapters WHERE id = ?', unitId);
    return { versions, currentVersionId: (current?.current_version_id as string | null) ?? null };
  }
  const revisions = listRevisions(projectId, 'p4', unitId).filter((revision) => revision.contentKind === 'text');
  const row = getStageItemRow(unitId);
  return { versions: revisions, currentVersionId: row?.current_revision_id ?? null };
}

export function restoreUnitVersion(projectId: string, unitId: string, versionId: string) {
  const unit = getUnitRow(projectId, unitId);
  if (!unit) fail('NOT_FOUND', '找不到这一章');
  ensureStageIdle(projectId, unit.kind === 'beat' ? 'p4' : 'p4');
  withTx(() => {
    if (unit.kind === 'chapter') {
      const version = oneRow('SELECT * FROM chapter_versions WHERE id = ? AND chapter_id = ?', versionId, unitId);
      if (!version) fail('NOT_FOUND', '找不到这个版本');
      createChapterVersion(unitId, '回退前', unit.content, unit.title);
      exec('UPDATE chapters SET content = ?, words = ?, current_version_id = ?, updated_at = ? WHERE id = ?', String(version.content || ''), countWords(String(version.content || '')), versionId, now(), unitId);
    } else {
      const revision = oneRow("SELECT * FROM revisions WHERE id = ? AND target_id = ? AND content_kind = 'text'", versionId, unitId);
      if (!revision) fail('NOT_FOUND', '找不到这个版本');
      updateStageItem(unitId, { body: String(revision.content || ''), words: countWords(String(revision.content || '')) });
      const next = addRevision({ projectId, stageKey: 'p4', scope: 'item', targetId: unitId, source: 'rollback', content: String(revision.content || ''), contentKind: 'text' });
      updateStageItem(unitId, { current_revision_id: next.id });
    }
    recalcProjectWords(projectId);
  });
  return { unit: listItems(projectId, 'p4').find((item) => item.id === unitId) || null };
}

export function jobHistory(projectId: string) {
  return allRows('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY started_at DESC LIMIT 20', projectId);
}

export function stageStatus(projectId: string, stageKey: StageKey): StageStatus | undefined {
  return getStage(projectId, stageKey)?.status;
}

export function setProjectError(projectId: string, code: string, message: string) {
  setProjectLastError(projectId, { code, message });
}

export function clearProjectError(projectId: string) {
  setProjectLastError(projectId, null);
}

export function setStageGenerating(projectId: string, stageKey: StageKey) {
  updateStage(projectId, stageKey, { status: 'generating' });
}

export function reviewCounts(projectId: string) {
  return countUnitsByStatus(projectId);
}

export function projectMigration(projectId: string): MigrationView {
  void getProjectRow(projectId);
  void stageRows(projectId);
  return { state: 'none' };
}

export function stageSummaryOf(projectId: string) {
  return stageRows(projectId).map((row) => ({ key: row.stage_key, status: row.status, stale: Boolean(row.stale) }));
}

export function pipelineStatusOf(projectId: string) {
  return getProjectRow(projectId)?.pipeline_status || 'legacy';
}

export function setPipeline(projectId: string, status: string) {
  setPipelineStatus(projectId, status);
}

export function formatValidation(errors: Array<{ path: string; message: string }>): string {
  return formatErrors(errors);
}

export function panelRevision(projectId: string, revisionId: string): Revision | undefined {
  const row = oneRow('SELECT * FROM revisions WHERE id = ? AND project_id = ?', revisionId, projectId);
  if (!row) return undefined;
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    stageKey: row.stage_key as StageKey,
    scope: row.scope === 'stage' ? 'stage' : 'item',
    targetId: (row.target_id as string | null) ?? null,
    source: String(row.source),
    note: String(row.note || ''),
    content: String(row.content),
    contentKind: (row.content_kind as 'json' | 'text') ?? 'json',
    jobId: (row.job_id as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function latestSnapshotOf(projectId: string) {
  return latestRevision(projectId, '');
}

export type { ReviewActionResult };
