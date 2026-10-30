/**
 * AI-first 流水线的对外契约（前端只依赖本文件，不 import 服务端实现）。
 * 对齐 ARCHITECTURE §3.12/§3.13：快照全量、nextStep 由服务端唯一推导、写接口只返回最小结果。
 */

export type StageKey = 'p1' | 'p2' | 'p3' | 'p4';

/** UX 六态（stages.status 的内部值也在其中，locked 通过 locked 布尔表达） */
export type StageViewStatus = 'empty' | 'generating' | 'review' | 'confirmed' | 'failed' | 'skipped';

export type NextStepKind =
  | 'migrate'
  | 'fix-provider'
  | 'watch'
  | 'resume-writing'
  | 'retry-failed'
  | 'generate-p1'
  | 'review-p1'
  | 'generate-p2'
  | 'review-p2'
  | 'generate-p3'
  | 'review-p3'
  | 'start-writing'
  | 'fix-chapters'
  | 'review-chapters'
  | 'export';

export type JobKind = 'plan' | 'regen-stage' | 'regen-item' | 'chapter-plan' | 'writing' | 'chapter-rewrite';

export type JobState = 'queued' | 'running' | 'pausing' | 'paused' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export type UnitReviewStatus =
  | 'pending'
  | 'generating'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'approved_manual'
  | 'skipped';

export type PipelineErrorCode =
  | 'NO_DEFAULT_MODEL'
  | 'NO_API_KEY'
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'REASONING_UNSUPPORTED'
  | 'RATE_LIMIT'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'NETWORK'
  | 'EMPTY_OUTPUT'
  | 'INVALID_JSON'
  | 'CONTENT_BLOCKED'
  | 'QUOTA_EXCEEDED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'STAGE_LOCKED'
  | 'CONCURRENT_JOB'
  | 'MIGRATION_FAILED'
  // 扩展码（ARCHITECTURE §3.8 / MIGRATION §4.4）
  | 'CONFIRM_BLOCKED'
  | 'TYPE_NOT_SUPPORTED'
  | 'IDEMPOTENT_REPLAY'
  | 'NOTE_TOO_SHORT'
  | 'NOTE_REQUIRED'
  | 'DEVIATION_NOT_ACCEPTED'
  | 'TARGET_EDITED'
  | 'CONTENT_WOULD_BE_LOST'
  | 'ITEM_LOCKED'
  | 'NOT_MIGRATABLE_EMPTY'
  | 'MIGRATION_CHECK_FAILED'
  | 'BACKUP_FAILED'
  | 'DISK_WRITE_FAILED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INTERNAL';

export interface PipelineError {
  code: PipelineErrorCode;
  message: string;
  detail?: unknown;
}

export interface StageView {
  status: StageViewStatus;
  locked: boolean;
  blockedBy?: StageKey;
  counts: { items: number; locked: number; words?: number; units?: number; unitsDone?: number };
  updatedAt: string | null;
  staleReason?: string | null;
  /** N4：整阶段重建中途取消/失败的时间戳；有值说明这次重建只完成了一部分，可以再点一次继续。 */
  partialAt?: string | null;
}

export interface NextStep {
  kind: NextStepKind;
  label: string;
  stage?: StageKey;
  blockers?: string[];
  count?: number;
  /** 非阻断提示（例如「上游有变更尚未复核」），前端只展示，不禁用按钮。 */
  hint?: string;
}

export interface JobView {
  id: string;
  kind: JobKind;
  stage: StageKey;
  step?: string;
  state: JobState;
  startedAt: string;
  finishedAt?: string | null;
  elapsedMs: number;
  unit?: 'chapter' | 'beat';
  currentUnitNo?: number;
  currentUnitId?: string;
  currentUnitTitle?: string;
  currentUnitWords?: number;
  unitsDone: number;
  unitsTotal: number;
  wordsTotal: number;
  stepIndex: number;
  stepTotal: number;
  pausePending?: boolean;
  failedUnitNo?: number;
  avgUnitMs?: number;
  retryOfId?: string | null;
  error?: PipelineError;
}

export interface ReviewCounts {
  pending: number;
  approved: number;
  changesRequested: number;
  manual: number;
  skipped: number;
  inReview: number;
  generating: number;
}

export interface PipelineSnapshot {
  project: {
    id: string;
    title: string;
    type: string;
    genre: string;
    premise: string;
    targetWords: number;
    styleNotes: string;
    pipelineStatus: string;
    totalWords: number;
    updatedAt: string;
  };
  kind: 'novel' | 'short';
  stages: Record<StageKey, StageView>;
  nextStep: NextStep;
  job: JobView | null;
  lastJob: JobView | null;
  review: ReviewCounts;
  progress: { unitsDone: number; unitsTotal: number; words: number; plannedWords: number };
  lastError: PipelineError | null;
  migration?: { state: 'legacy' | 'failed' | 'done'; at?: string; migrationId?: string };
}

/** 统一条目形状（ARCHITECTURE §3.3 的 Item） */
export interface PipelineItem {
  id: string;
  kind: string;
  stageKey: StageKey;
  ordinal: number;
  title: string;
  payload: Record<string, unknown>;
  locked: boolean;
  source: string;
  stale: boolean;
  revisionCount: number;
  updatedAt: string | null;
  body?: string;
  unit?: {
    reviewStatus: UnitReviewStatus | '';
    words: number;
    min: number | null;
    target: number | null;
    max: number | null;
  };
}

export interface Revision {
  id: string;
  projectId: string;
  stageKey: StageKey;
  scope: 'stage' | 'item';
  targetId: string | null;
  source: string;
  note: string;
  content: string;
  contentKind: 'json' | 'text';
  jobId: string | null;
  createdAt: string;
}

export interface PrecheckResult {
  ok: boolean;
  code?: 'NO_DEFAULT_MODEL' | 'NO_API_KEY';
  message?: string;
  providerId?: string;
  modelId?: string;
}

export interface StageConfirmResult {
  stage: StageKey;
  status: StageViewStatus;
  snapshotRevisionId: string | null;
  confirmedAt: string;
  snapshot?: PipelineSnapshot;
}

export interface UnitPlanPatch {
  title?: string;
  function?: string;
  synopsis?: string;
  characters?: string[];
  minWords?: number;
  targetWords?: number;
  maxWords?: number;
  acceptDeviation?: boolean;
}

export interface AllocationRow {
  unitId: string;
  targetWords: number;
  minWords: number;
  maxWords: number;
  manuallyEdited: boolean;
}

export interface AllocationPreview {
  preview: AllocationRow[];
  totalBefore: number;
  totalAfter: number;
  deviationPct: number;
  overTolerance: boolean;
  goalWords: number;
}

export interface MigrationView {
  state: 'none' | 'legacy' | 'running' | 'done' | 'failed' | 'rolled_back';
  migrationId?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  backupPath?: string | null;
  checks?: Array<{ id: string; ok: boolean; detail?: string }>;
  error?: string | null;
  alreadyMigrated?: boolean;
  /** 回退结果：被归档 / 被删除的章节标题（N3 之前只回一个 state，用户不知道哪些章被收起来了）。 */
  archivedTitles?: string[];
  deletedTitles?: string[];
  /** 是否按「迁移前的章节 id 清单」判定新章（false 说明这本没有该清单，只能按时间兜底）。 */
  legacyChapterIdsKnown?: boolean;
}

export interface ReviewActionInput {
  action: 'approve' | 'request_changes' | 'manual_approve' | 'skip' | 'rewrite' | 'expand' | 'shrink';
  note?: string;
  mode?: 'continuous' | 'single';
}

export interface ReviewActionResult {
  unit?: PipelineItem;
  projectId: string;
  nextPendingChapterId?: string | null;
  job?: JobView;
}
