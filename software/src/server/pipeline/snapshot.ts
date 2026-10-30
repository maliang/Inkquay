import { getSettings, getProviderRow, getProviderSecret, providerModelIds } from '../repository.ts';
import type { JobView, MigrationView, NextStep, PipelineSnapshot, PrecheckResult, ReviewCounts, StageKey, StageView } from '../../shared/pipeline.ts';
import {
  activeJob,
  getProjectRow,
  kindOf,
  latestJob,
  latestJobByStatus,
  listItems,
  listUnits,
  oneRow,
  parseJson,
  projectLastError,
  projectWordTotal,
  stageRows,
  staleReasonOf,
  allRows,
} from './store.ts';
import type { JobRow } from './store.ts';
import { STAGE_KEYS, fail, kindProfileOf } from './types.ts';
import type { StageStatus } from './types.ts';
import { reviewSummary } from './runner.ts';

/**
 * 服务端唯一真相：PipelineSnapshot 与 nextStep（ARCHITECTURE §3.12，D6）。
 * 前端不做任何状态推导，只渲染这里给出的 nextStep。
 */

function stageViewStatus(status: StageStatus, itemCount: number, locked: boolean): StageView['status'] {
  if (status === 'generating' || status === 'review' || status === 'confirmed' || status === 'failed' || status === 'skipped') {
    if (locked) return itemCount > 0 ? 'review' : 'empty';
    return status;
  }
  if (status === 'empty') return 'empty';
  if (status === 'locked') return itemCount > 0 ? 'review' : 'empty';
  return 'empty';
}

const STAGE_UPSTREAM: Record<StageKey, StageKey | null> = { p1: null, p2: 'p1', p3: 'p2', p4: 'p3' };

export function buildStageViews(projectId: string, kind: 'novel' | 'short'): Record<StageKey, StageView> {
  const rows = stageRows(projectId);
  const byKey = new Map(rows.map((row) => [row.stage_key, row]));
  const units = listUnits(projectId);
  const views = {} as Record<StageKey, StageView>;
  for (const key of STAGE_KEYS) {
    const row = byKey.get(key);
    const items = listItems(projectId, key);
    const status = (row?.status || (key === 'p1' ? 'empty' : 'locked')) as StageStatus;
    const locked = status === 'locked';
    const upstream = STAGE_UPSTREAM[key];
    const upstreamRow = upstream ? byKey.get(upstream) : null;
    const blockedBy = locked && upstream && upstreamRow && upstreamRow.status !== 'confirmed' && upstreamRow.status !== 'skipped' ? upstream : undefined;
    // staleReason 只在 stale 标记仍为 1 时下发：`stale/resolve {action:'keep'}` 会把 stale 清零，
    // 若这里不看标记，横幅会在「已复核并保留」之后继续挂着（t14 缺陷的孪生 bug）。
    // F11：原因存 app_meta（last_error 只放失败），旧库回落到 last_error 里的 staleReason。
    const staleReason =
      row && Number(row.stale) === 1
        ? staleReasonOf(projectId, key) || parseJson<{ staleReason?: string }>(row.last_error, {}).staleReason || null
        : null;
    const words = key === 'p4' ? units.reduce((total, unit) => total + (unit.words || 0), 0) : undefined;
    const unitStats =
      key === 'p3' || key === 'p4'
        ? {
            units: units.length,
            unitsDone: units.filter((unit) => ['approved', 'approved_manual', 'skipped', 'in_review'].includes(unit.reviewStatus || '')).length,
          }
        : {};
    views[key] = {
      status: stageViewStatus(status, items.length, locked),
      locked,
      ...(blockedBy ? { blockedBy } : {}),
      counts: {
        items: items.length,
        locked: items.filter((item) => item.locked).length,
        ...(words === undefined ? {} : { words }),
        ...unitStats,
      },
      updatedAt: row?.updated_at ?? null,
      staleReason,
      // N4：重建中途停下的痕迹（有值=只完成了一部分），前端据此提示「可以再点一次继续」。
      partialAt: row?.partial_at ? String(row.partial_at) : null,
    };
  }
  return views;
}

export function jobView(job: JobRow | undefined, unitTitle?: (unitId: string) => string | undefined): JobView | null {
  if (!job) return null;
  const progress = parseJson<Record<string, any>>(job.progress, {});
  const state: JobView['state'] =
    job.status === 'running' ? (job.pause_requested ? 'pausing' : 'running') : job.status === 'cancelled' ? (job.stop_mode === 'pause' ? 'paused' : 'cancelled') : job.status;
  const started = Date.parse(job.started_at) || Date.now();
  const finished = job.finished_at ? Date.parse(job.finished_at) : Date.now();
  const unitId = job.current_unit_id || undefined;
  const unitsTotal = Number(progress.unitsTotal || 0);
  const unitsDone = Number(progress.unitsDone || 0);
  const avgUnitMs = unitsDone > 0 ? Math.round((finished - started) / unitsDone) : undefined;
  return {
    id: job.id,
    kind: job.kind,
    stage: job.stage_key,
    ...(job.step ? { step: job.step } : {}),
    state,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    elapsedMs: Math.max(0, finished - started),
    unit: job.stage_key === 'p4' ? (kindOf(job.project_id) === 'short' ? 'beat' : 'chapter') : undefined,
    ...(unitId ? { currentUnitId: unitId } : {}),
    ...(unitId && unitTitle?.(unitId) ? { currentUnitTitle: unitTitle(unitId) } : {}),
    unitsDone,
    unitsTotal: unitsTotal || unitsDone,
    wordsTotal: Number(progress.wordsTotal || 0),
    stepIndex: Number(job.step_index || 0),
    stepTotal: Number(job.step_total || 0),
    // 暂停请求已受理但当前单元还在写（D4：这一章写完后才停）→ 前端显示「正在写完当前这一章」
    pausePending: Boolean(job.pause_requested && job.status === 'running'),
    avgUnitMs,
    retryOfId: job.retry_of_id,
    ...(job.error_code ? { error: { code: job.error_code as any, message: job.error_message || '' } } : {}),
  };
}

export function buildJobView(job: JobRow): JobView {
  const title = (unitId: string) => listUnits(job.project_id).find((unit) => unit.id === unitId)?.title;
  return jobView(job, title)!;
}

export function precheck(): PrecheckResult {
  const settings = getSettings();
  if (!settings.defaultModel) return { ok: false, code: 'NO_DEFAULT_MODEL', message: '还没有选择默认模型，请到设置中配置' };
  const row = getProviderRow(settings.defaultModel.providerId);
  if (!row) return { ok: false, code: 'NO_DEFAULT_MODEL', message: '默认模型对应的供应商不存在，请到设置中重新选择' };
  if (!row.enabled) return { ok: false, code: 'NO_DEFAULT_MODEL', message: '默认模型对应的供应商未启用，请到设置中重新选择' };
  const models = providerModelIds(settings.defaultModel.providerId);
  if (models.length && !models.includes(settings.defaultModel.modelId)) {
    return { ok: false, code: 'NO_DEFAULT_MODEL', message: '默认模型已不在该供应商的可用列表里，请到设置中重新选择' };
  }
  const needsKey = row.kind !== 'mock' && !/localhost|127\.0\.0\.1/i.test(String(row.base_url || ''));
  if (needsKey && !getProviderSecret(settings.defaultModel.providerId)) {
    return { ok: false, code: 'NO_API_KEY', message: '该供应商未填写 API Key' };
  }
  return { ok: true, providerId: settings.defaultModel.providerId, modelId: settings.defaultModel.modelId };
}

export interface SnapshotOptions {
  /** 任务视图里做当前单元标题查找用 */
  withUnitTitles?: boolean;
}

export function buildSnapshot(projectId: string, options: SnapshotOptions = {}): PipelineSnapshot {
  const project = getProjectRow(projectId);
  if (!project) fail('NOT_FOUND', '作品不存在');
  const kind = kindOf(projectId);
  const profile = kindProfileOf(project.type);
  const stages = buildStageViews(projectId, kind);
  const units = listUnits(projectId);
  const titleOf = (unitId: string) => units.find((unit) => unit.id === unitId)?.title;
  const active = activeJob(projectId);
  const latest = latestJob(projectId);
  const review = reviewSummary(projectId);
  const lastError = projectLastError(projectId);
  const migrationRow = oneRow('SELECT * FROM migrations WHERE project_id = ? ORDER BY started_at DESC LIMIT 1', projectId);
  const pipelineStatus = String(project.pipeline_status || 'legacy');
  const migration = migrationRow
    ? {
        state: (migrationRow.status === 'done' ? 'done' : migrationRow.status === 'failed' ? 'failed' : 'legacy') as 'done' | 'failed' | 'legacy',
        at: (migrationRow.finished_at || migrationRow.started_at || undefined) as string | undefined,
        migrationId: String(migrationRow.id),
      }
    : pipelineStatus === 'legacy'
      ? ({ state: 'legacy' as const, at: undefined as string | undefined, migrationId: undefined as string | undefined })
      : undefined;

  const snapshot: PipelineSnapshot = {
    project: {
      id: project.id,
      title: project.title,
      type: project.type,
      genre: project.genre || '',
      premise: project.description || '',
      targetWords: Number(project.goal_words || 0),
      styleNotes: project.style_notes || '',
      pipelineStatus,
      totalWords: projectWordTotal(projectId),
      updatedAt: project.updated_at,
    },
    kind,
    stages,
    nextStep: { kind: 'generate-p1', label: '' },
    job: jobView(active, titleOf),
    lastJob: latest && latest.id !== active?.id ? jobView(latest, titleOf) : null,
    review,
    progress: {
      unitsDone: units.filter((unit) => ['approved', 'approved_manual', 'skipped', 'in_review'].includes(unit.reviewStatus || '')).length,
      unitsTotal: units.length,
      words: units.reduce((total, unit) => total + (unit.words || 0), 0),
      plannedWords: units.reduce((total, unit) => total + (unit.targetWords || 0), 0) || Number(project.goal_words || profile.defaultGoalWords),
    },
    lastError: lastError ? { code: lastError.code as any, message: lastError.message } : null,
    ...(migration ? { migration } : {}),
  };
  snapshot.nextStep = deriveNextStep(snapshot);
  return snapshot;
}

/**
 * 15 行推导表（ARCHITECTURE §3.12）：按序第一个命中，纯函数。
 */
export function deriveNextStep(snapshot: Omit<PipelineSnapshot, 'nextStep'>): NextStep {
  const { stages, job, lastJob, lastError, review, kind } = snapshot;
  const unitLabel = kind === 'short' ? '节拍' : '章';
  if (snapshot.project.pipelineStatus === 'legacy' || snapshot.migration?.state === 'legacy') {
    return { kind: 'migrate', label: '升级到流水线' };
  }
  const gate = precheck();
  if (!gate.ok) return { kind: 'fix-provider', label: '去配置模型', blockers: [gate.code || 'NO_DEFAULT_MODEL'] };
  if (job && (job.state === 'running' || job.state === 'pausing')) {
    return { kind: 'watch', label: job.stage === 'p4' ? '正在写作…' : '正在企划…', stage: job.stage, ...(job.unitsTotal ? { count: job.unitsDone } : {}) };
  }
  if (lastJob?.state === 'paused') return { kind: 'resume-writing', label: '继续写作', stage: 'p4' };
  // F17：升级已经成功就把历史失败放过——否则 lastError 还是 MIGRATION_FAILED 时，
  // nextStep 永远停在「重试」，用户看不到「让 AI 生成设定」。
  const migrationDone = snapshot.migration?.state === 'done';
  const blockingError = lastError && !(migrationDone && lastError.code === 'MIGRATION_FAILED') ? lastError : null;
  if (blockingError && !job) return { kind: 'retry-failed', label: '重试', blockers: [blockingError.code] };
  // N4：整阶段重建中途停下（取消/失败）会留下 partialAt —— 阶段看着是「待审阅」，
  // 但内容只更新了一部分。用 nextStep.hint 明说，别让用户以为这就是全部。
  const partialHint = (key: StageKey) => (stages[key].partialAt ? '这次重建只完成了一部分，可以再点一次继续' : undefined);
  if (stages.p1.status === 'empty') return { kind: 'generate-p1', label: '让 AI 生成设定', stage: 'p1' };
  if (stages.p1.status === 'review') return { kind: 'review-p1', label: '审阅并确认设定', stage: 'p1', ...(partialHint('p1') ? { hint: partialHint('p1') } : {}) };
  if (stages.p2.status === 'empty') return { kind: 'generate-p2', label: '生成故事大纲', stage: 'p2' };
  if (stages.p2.status === 'review') return { kind: 'review-p2', label: '审核故事大纲', stage: 'p2', ...(partialHint('p2') ? { hint: partialHint('p2') } : {}) };
  if (stages.p3.status === 'empty') return { kind: 'generate-p3', label: kind === 'short' ? '生成节拍计划' : '生成章节计划', stage: 'p3' };
  if (stages.p3.status === 'review') return { kind: 'review-p3', label: `检查${unitLabel}字数并确认`, stage: 'p3', ...(partialHint('p3') ? { hint: partialHint('p3') } : {}) };
  // N6：原来这里是 `review.pending === review.pending + 0 && ...`，首项恒真（写成 x === x + 0），
  // 读起来像在判「全部待写」其实什么都没判。这里写成它真正想表达的意思：还有待写的单元。
  const readyToWrite = stages.p4.counts.items > 0 && review.pending > 0;
  if (readyToWrite || stages.p4.status === 'empty' || stages.p4.status === 'review') {
    if (review.changesRequested > 0) return { kind: 'fix-chapters', label: `修改被退回的${unitLabel}`, stage: 'p4', count: review.changesRequested };
    if (review.inReview > 0) return { kind: 'review-chapters', label: `开始逐${unitLabel}审阅`, stage: 'p4', count: review.inReview };
    if (review.pending > 0) {
      const staleStage = (['p1', 'p2', 'p3'] as const).find((key) => stages[key].staleReason);
      if (staleStage) {
        // F20：V1 不 gate（已确认阶段的内容照旧可用），但必须让用户看见「上游变过」。
        return {
          kind: 'start-writing',
          label: kind === 'short' ? '开始逐节拍写作' : '开始连续写作',
          stage: 'p4',
          count: review.pending,
          blockers: [`${staleStage}:stale`],
          hint: '上游阶段有变更尚未复核，建议先处理再继续写作',
        } as NextStep;
      }
      return { kind: 'start-writing', label: kind === 'short' ? '开始逐节拍写作' : '开始连续写作', stage: 'p4', count: review.pending };
    }
  }
  if (review.changesRequested > 0) return { kind: 'fix-chapters', label: `修改被退回的${unitLabel}`, stage: 'p4', count: review.changesRequested };
  if (review.inReview > 0) return { kind: 'review-chapters', label: `开始逐${unitLabel}审阅`, stage: 'p4', count: review.inReview };
  return { kind: 'export', label: '导出成稿', stage: 'p4' };
}

export function migrationOf(projectId: string): MigrationView {
  const row = oneRow('SELECT * FROM migrations WHERE project_id = ? ORDER BY started_at DESC LIMIT 1', projectId);
  if (!row) return { state: 'none' };
  return {
    state: (row.status as MigrationView['state']) ?? 'none',
    migrationId: String(row.id),
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    backupPath: (row.backup_path as string | null) ?? null,
    checks: parseJson<Array<{ id: string; ok: boolean; detail?: string }>>(row.checks, []),
    error: (row.error as string | null) ?? null,
  };
}

export function countsOf(projectId: string, table: string): number {
  const row = oneRow(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`, projectId);
  return Number(row?.n || 0);
}

export function legacyJobs(projectId: string) {
  return allRows('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY started_at DESC LIMIT 20', projectId);
}
