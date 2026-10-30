import { now } from '../db.ts';
import {
  allRows,
  exec,
  activeJob,
  appendJobEvent,
  claimJob,
  countUnitsByStatus,
  getJob,
  getStage,
  insertJob,
  jobPlanOf,
  listItems,
  listUnits,
  setPipelineStatus,
  setStageStatus,
  setProjectLastError,
  setUnitStatus,
  updateJob,
  updateStage,
} from './store.ts';
import type { JobRow } from './store.ts';
import { planStepsForStage, runStep } from './steps.ts';
import type { StepDef } from './steps.ts';
import { GLOBAL_JOB_CONCURRENCY, MESSAGE_BY_CODE, fail, isPipelineError } from './types.ts';
import type { StageKey } from './types.ts';

/**
 * 生成任务执行器（ARCHITECTURE §3.2/§3.5–§3.9）。
 * - 单作品最多 1 个 active job（由 activeJob() 前置检查保证）；
 * - 全局并发 3，FIFO；
 * - 取消/暂停的真相在数据库（cancel_requested/pause_requested），进程内 AbortController 只负责尽快释放上游；
 * - 每个 step 的产物在事务内提交，取消/失败的那一步零写入。
 */

const queue: string[] = [];
const controllers = new Map<string, AbortController>();
let running = 0;

export function enqueueJob(jobId: string) {
  if (!queue.includes(jobId)) queue.push(jobId);
  const job = getJob(jobId);
  if (job) appendJobEvent(jobId, 'queued', { position: queue.indexOf(jobId) + 1 });
  pump();
}

export function queuePosition(jobId: string): number {
  const index = queue.indexOf(jobId);
  return index < 0 ? 0 : index + 1;
}

export function runningCount(): number {
  return running;
}

export function recoverInterruptedJobs(): void {
  const stale = allRows("SELECT id, project_id, stage_key, step FROM generation_jobs WHERE status IN ('queued','running')");
  for (const row of stale) {
    updateJob(String(row.id), { status: 'interrupted', finished_at: now(), error_code: 'INTERRUPTED', error_message: MESSAGE_BY_CODE.INTERRUPTED || '生成被中断' });
    appendJobEvent(String(row.id), 'interrupted', { project: row.project_id, stage: row.stage_key, step: row.step });
    setProjectLastError(String(row.project_id), { code: 'INTERRUPTED', message: MESSAGE_BY_CODE.INTERRUPTED || '生成被中断', stageKey: String(row.stage_key) });
    console.log(`[job] id=${row.id} project=${row.project_id} stage=${row.stage_key} status=interrupted`);
  }
  const generating = allRows("SELECT id, project_id FROM chapters WHERE review_status = 'generating'");
  for (const row of generating) exec("UPDATE chapters SET review_status = 'pending' WHERE id = ?", row.id);
  const beatGenerating = allRows("SELECT id FROM stage_items WHERE review_status = 'generating'");
  for (const row of beatGenerating) exec("UPDATE stage_items SET review_status = 'pending' WHERE id = ?", row.id);
  const generatingStages = allRows("SELECT project_id, stage_key FROM stages WHERE status = 'generating'");
  for (const row of generatingStages) setStageStatus(String(row.project_id), String(row.stage_key) as StageKey, 'review');
  // N8：被崩溃打断的多步重建要和「取消/失败」同口径留痕，否则重启后用户只看到阶段回到 review，
  // 看不出这一阶段其实只重建了一半（下一步会提示「可以再点一次继续」）。
  for (const row of stale) {
    if (!isPartialRebuild(getJob(String(row.id)))) continue;
    updateStage(String(row.project_id), String(row.stage_key) as StageKey, { partial_at: now() });
  }
}

export function pump() {
  while (running < GLOBAL_JOB_CONCURRENCY && queue.length) {
    const jobId = queue.shift()!;
    running += 1;
    void runJob(jobId)
      .catch((error) => {
        console.log(`[job] id=${jobId} status=fail unexpected=${(error as Error)?.message || error}`);
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

export interface StartJobInput {
  projectId: string;
  stageKey: StageKey;
  kind: JobRow['kind'];
  steps: StepDef[];
  note?: string;
  retryOfId?: string | null;
  clientRequestId?: string | null;
  unitsTotal?: number;
}

export function startJob(input: StartJobInput): JobRow {
  if (!input.steps.length) fail('STAGE_LOCKED', '没有可执行的生成步骤，请检查上一阶段是否已确认');
  const job = insertJob({
    projectId: input.projectId,
    stageKey: input.stageKey,
    kind: input.kind,
    plan: input.steps.map((step) => ({ op: step.op, ...(step.targetId ? { targetId: step.targetId } : {}) })),
    stepTotal: input.steps.length,
    retryOfId: input.retryOfId ?? null,
    clientRequestId: input.clientRequestId ?? null,
    note: input.note ?? '',
    unitsTotal: input.unitsTotal ?? 0,
  });
  appendJobEvent(job.id, 'queued', { steps: input.steps.length });
  enqueueJob(job.id);
  return job;
}

async function runJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  if (!claimJob(jobId)) {
    appendJobEvent(jobId, 'skipped', { reason: 'not-queued' });
    return;
  }
  const projectId = job.project_id;
  const controller = new AbortController();
  controllers.set(jobId, controller);
  const stageKey = job.stage_key;
  const stage = getStage(projectId, stageKey);
  // F12：单条条目重生成 / 重写一章不撤销本阶段的确认——内容只多一条修订，确认快照仍然有效，
  // 因此把阶段留在 confirmed，只由 recordItemRevision 去给下游标 stale。
  // 整阶段重生成（plan）才把阶段翻成 generating，收尾回落 review 等用户重新确认。
  const itemScope = job.kind === 'regen-item' || job.kind === 'chapter-rewrite';
  const keepsConfirmation = Boolean(itemScope && stage && stage.status === 'confirmed' && stage.confirmed_revision_id);
  if (stage && stage.status !== 'generating' && !keepsConfirmation) setStageStatus(projectId, stageKey, 'generating');
  setPipelineStatus(projectId, stageKey === 'p4' ? 'writing' : 'planning');
  const jobPlan = jobPlanOf(job);
  let plan = jobPlan.plan as StepDef[];
  const { note } = jobPlan;
  let unitsTotal = jobPlan.unitsTotal;
  const startedAt = Date.now();
  let unitsDone = 0;
  let wordsTotal = 0;
  console.log(`[job] id=${jobId} project=${projectId} stage=${stageKey} status=start steps=${plan.length}`);
  appendJobEvent(jobId, 'start', { stage: stageKey, steps: plan.length });

  try {
    for (let index = 0; index < plan.length; index += 1) {
      const current = getJob(jobId);
      if (!current) return;
      // 单元边界：暂停/停止都在这里生效（D4：暂停=写完当前单元再停）
      if (current.cancel_requested) {
        finishCancelled(jobId, projectId, stageKey, stopModeOf(current), unitsDone, wordsTotal);
        return;
      }
      const step = plan[index] as StepDef;
      updateJob(jobId, { step: step.op === 'write' ? 'writing' : stepLabelOf(stageKey), step_index: index, progress: { plan, note, unitsTotal, unitsDone, wordsTotal } });
      appendJobEvent(jobId, 'step', { index, op: step.op, targetId: step.targetId ?? null });
      const outcome = await runStep(current, step, {
        signal: controller.signal,
        note,
        onProgress: (patch) => {
          if (patch.currentUnitId !== undefined) updateJob(jobId, { current_unit_id: patch.currentUnitId });
        },
      });
      unitsDone += outcome.unitsDone;
      wordsTotal += outcome.words;
      updateJob(jobId, {
        step_index: index + 1,
        heartbeat_at: now(),
        progress: { plan, note, unitsTotal: unitsTotal || unitsDone, unitsDone, wordsTotal },
      });
      appendJobEvent(jobId, 'step-ok', { index, op: step.op, label: outcome.label, words: outcome.words });
      // P2：幕数要等 acts 那一步跑完才知道 → 在此展开后续「每幕一组节拍」的步骤
      if (stageKey === 'p2' && step.op === 'acts') {
        const replanned = planStepsForStage(projectId, 'p2');
        const beats = replanned.filter((item) => item.op === 'beats');
        plan = [...plan.slice(0, index + 1), ...beats];
        unitsTotal = plan.length;
        updateJob(jobId, { step_total: plan.length });
      }
      // 单元之间检查暂停/取消（P4 连续写作的关键停点）
      const after = getJob(jobId);
      if (after?.cancel_requested) {
        finishCancelled(jobId, projectId, stageKey, stopModeOf(after), unitsDone, wordsTotal);
        return;
      }
    }
    finishDone(jobId, projectId, stageKey, unitsDone, wordsTotal, Date.now() - startedAt);
  } catch (error) {
    const pipelineError = isPipelineError(error) ? error : null;
    // 只有「真的被 abort」才算取消：暂停不 abort（写完当前单元才停），
    // 因此暂停期间供应商自己报错仍然要按失败处理，不能伪装成 paused。
    const aborted = pipelineError?.code === 'CANCELLED' || (error as Error)?.name === 'AbortError';
    if (aborted) {
      finishCancelled(jobId, projectId, stageKey, stopModeOf(getJob(jobId)), unitsDone, wordsTotal);
      return;
    }
    finishFailed(jobId, projectId, stageKey, error, unitsDone, wordsTotal);
  } finally {
    controllers.delete(jobId);
  }
}

/** 停止原因：pause_requested=1 是「暂停」，否则是「立即停止/用户取消」（D4）。 */
function stopModeOf(job: JobRow | undefined): 'pause' | 'user_cancel' {
  return job?.pause_requested ? 'pause' : 'user_cancel';
}

function stepLabelOf(stageKey: StageKey): string {
  if (stageKey === 'p1') return 'setting';
  if (stageKey === 'p2') return 'outline';
  if (stageKey === 'p3') return 'chapter-plan';
  return 'writing';
}

function finishDone(jobId: string, projectId: string, stageKey: StageKey, unitsDone: number, wordsTotal: number, durationMs: number) {
  updateJob(jobId, { status: 'done', finished_at: now(), heartbeat_at: now(), error_code: null, error_message: null, current_unit_id: null });
  const stage = getStage(projectId, stageKey);
  // F12：阶段状态与 confirmed_* 的不变式统一由 setStageStatus 维护；
  // F13：原来这里是 `stageKey === 'p4' ? 'reviewing' : 'reviewing'` 的恒真三元。
  if (stage) {
    const staysConfirmed = Boolean(stage.status === 'confirmed' && stage.confirmed_revision_id);
    setStageStatus(projectId, stageKey, stage.skipped ? 'skipped' : staysConfirmed ? 'confirmed' : 'review', { last_error: null });
    // 整阶段重建跑完了 → 清掉「只完成一部分」的痕迹（N4）。
    if (stage.partial_at) updateStage(projectId, stageKey, { partial_at: null });
  }
  setProjectLastError(projectId, null);
  setPipelineStatus(projectId, 'reviewing');
  appendJobEvent(jobId, 'done', { unitsDone, wordsTotal, durationMs });
  console.log(`[job] id=${jobId} project=${projectId} stage=${stageKey} status=ok units=${unitsDone} words=${wordsTotal} dur=${durationMs}ms`);
}

function finishCancelled(jobId: string, projectId: string, stageKey: StageKey, stopMode: 'pause' | 'stop' | 'user_cancel', unitsDone: number, wordsTotal: number) {
  const jobRow = getJob(jobId);
  updateJob(jobId, { status: 'cancelled', stop_mode: stopMode, finished_at: now(), current_unit_id: null });
  const stage = getStage(projectId, stageKey);
  if (stage) {
    const hasContent = stageHasContent(projectId, stageKey);
    const staysConfirmed = Boolean(stage.status === 'confirmed' && stage.confirmed_revision_id);
    setStageStatus(projectId, stageKey, staysConfirmed ? 'confirmed' : hasContent ? 'review' : 'empty');
    if (isPartialRebuild(jobRow)) updateStage(projectId, stageKey, { partial_at: now() });
  }
  // 被取消的单元回到 pending，正文不写入（INV-3）
  for (const unit of listUnits(projectId)) {
    if (unit.reviewStatus === 'generating') setUnitBackToPending(projectId, unit.id);
  }
  appendJobEvent(jobId, 'cancelled', { stopMode, unitsDone, wordsTotal });
  console.log(`[job] id=${jobId} project=${projectId} stage=${stageKey} status=cancel mode=${stopMode} units=${unitsDone}`);
}

function finishFailed(jobId: string, projectId: string, stageKey: StageKey, error: unknown, unitsDone: number, wordsTotal: number) {
  const code = isPipelineError(error) ? error.code : 'PROVIDER_ERROR';
  const message = (error as Error)?.message || String(error);
  updateJob(jobId, { status: 'failed', error_code: code, error_message: message, finished_at: now(), current_unit_id: null });
  const stage = getStage(projectId, stageKey);
  if (stage) {
    setStageStatus(projectId, stageKey, stageHasContent(projectId, stageKey) ? 'review' : 'failed', { last_error: JSON.stringify({ code, message }) });
    if (isPartialRebuild(getJob(jobId))) updateStage(projectId, stageKey, { partial_at: now() });
  }
  setProjectLastError(projectId, { code, message, stageKey });
  for (const unit of listUnits(projectId)) {
    if (unit.reviewStatus === 'generating') setUnitBackToPending(projectId, unit.id);
  }
  appendJobEvent(jobId, 'error', { code, message, unitsDone, wordsTotal });
  console.log(`[job] id=${jobId} project=${projectId} stage=${stageKey} status=fail code=${code} units=${unitsDone}`);
}

/**
 * N4：整阶段重建是「多步、每步各一个事务」，中途取消/失败会让阶段停在「一半新一半旧」。
 * 这里判定「这次 job 属于那种破坏性重建，并且确实已经走完至少一步」，据此在阶段上记 `partial_at`，
 * 让 UI 能说清「只完成了一部分、可以再点一次继续」，而不是把半成品当成完整结果。
 */
function isPartialRebuild(job: JobRow | undefined): boolean {
  if (!job) return false;
  if (job.kind !== 'plan' && job.kind !== 'regen-stage') return false;
  if (job.stage_key !== 'p1' && job.stage_key !== 'p2' && job.stage_key !== 'p3') return false;
  return Number(job.step_index || 0) > 0;
}

function stageHasContent(projectId: string, stageKey: StageKey): boolean {
  if (stageKey === 'p4') {
    return listUnits(projectId).some((unit) => Boolean(unit.content && unit.content.trim()));
  }
  return listItems(projectId, stageKey).length > 0;
}

function setUnitBackToPending(projectId: string, unitId: string) {
  setUnitStatus(projectId, unitId, 'pending');
}

/** 暂停/停止（ARCHITECTURE §3.7 + CAPTAIN-DECISIONS D4）：
 * - pause：只落 pause_requested，**不 abort 上游**，让在飞的那一章写完并落库，然后在单元边界停下（stop_mode='pause'），之后可 continue；
 * - stop：落 cancel_requested 并立刻 abort，当前章正文丢弃（该步零写入，stop_mode='user_cancel'），之后不能 continue。
 */
export function requestCancel(jobId: string, mode: 'pause' | 'stop'): JobRow {
  const job = getJob(jobId);
  if (!job) fail('NOT_FOUND', '找不到这个生成任务');
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') return job;
  if (job.status === 'queued') {
    updateJob(jobId, { status: 'cancelled', stop_mode: mode === 'pause' ? 'pause' : 'user_cancel', cancel_requested: 1, pause_requested: mode === 'pause' ? 1 : 0, finished_at: now() });
    appendJobEvent(jobId, mode === 'pause' ? 'pause-requested' : 'cancel-requested', { mode, during: 'queued' });
    return getJob(jobId)!;
  }
  if (mode === 'pause') {
    updateJob(jobId, { cancel_requested: 1, pause_requested: 1, stop_mode: 'pause' });
    appendJobEvent(jobId, 'pause-requested', { mode });
    console.log(`[job] id=${jobId} project=${job.project_id} stage=${job.stage_key} status=pause-requested`);
    return getJob(jobId)!;
  }
  updateJob(jobId, { cancel_requested: 1, pause_requested: 0, stop_mode: 'user_cancel' });
  appendJobEvent(jobId, 'cancel-requested', { mode });
  controllers.get(jobId)?.abort();
  return getJob(jobId)!;
}

/** 中断恢复：新 job 续跑未完成的步骤（ARCHITECTURE §3.9）。 */
export function resumeStepsFor(projectId: string, stageKey: StageKey, previous: JobRow): StepDef[] {
  const { plan } = jobPlanOf(previous);
  const done = Number(previous.step_index || 0);
  const remaining = plan.slice(done) as StepDef[];
  if (remaining.length) return remaining;
  if (stageKey === 'p4') {
    return listUnits(projectId)
      .filter((unit) => (unit.reviewStatus || 'pending') === 'pending')
      .map((unit) => ({ op: 'write', targetId: unit.id }));
  }
  return remaining;
}

export function reviewSummary(projectId: string) {
  const counts = countUnitsByStatus(projectId);
  return {
    pending: counts.pending || 0,
    inReview: counts.in_review || 0,
    generating: counts.generating || 0,
    approved: counts.approved || 0,
    changesRequested: counts.changes_requested || 0,
    manual: counts.approved_manual || 0,
    skipped: counts.skipped || 0,
  };
}

export function ensureNoActiveJob(projectId: string) {
  const active = activeJob(projectId);
  if (active) fail('CONCURRENT_JOB', '当前有生成任务进行中', { detail: { jobId: active.id } });
}
