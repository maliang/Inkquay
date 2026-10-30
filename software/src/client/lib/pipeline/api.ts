import type {
  AllocationPreview,
  AllocationRow,
  JobView,
  MigrationView,
  PipelineItem,
  PipelineSnapshot,
  PrecheckResult,
  Revision,
  ReviewActionInput,
  ReviewActionResult,
  StageConfirmResult,
  StageKey,
  UnitPlanPatch,
} from '../../../shared/pipeline.ts';
import { pipelineRequest, withIdempotencyKey } from './http.ts';

export interface PipelineUnit {
  id: string;
  kind: 'chapter' | 'beat';
  ordinal: number;
  title: string;
  function: string;
  synopsis: string;
  characters: string[];
  minWords: number | null;
  targetWords: number | null;
  maxWords: number | null;
  targetManual: boolean;
  locked: boolean;
  words: number;
  reviewStatus: string;
  hasContent: boolean;
}

export interface PlanSummary {
  units: number;
  totalTarget: number;
  goalWords: number;
  deviationPct: number;
  overTolerance: boolean;
  accepted: boolean;
  ready: number;
  locked: number;
}

export interface UnitVersionRow {
  id: string;
  createdAt?: string;
  created_at?: string;
  source?: string;
  words?: number;
  note?: string;
  content?: string;
}

function json<T>(path: string, method: string, body?: unknown): Promise<T> {
  return pipelineRequest<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const pipelineApi = {
  precheck: () => pipelineRequest<PrecheckResult>('/api/pipeline/precheck'),

  snapshot: (projectId: string, signal?: AbortSignal) =>
    pipelineRequest<PipelineSnapshot>(`/api/projects/${projectId}/pipeline`, { signal }),

  items: (projectId: string, stage: StageKey, signal?: AbortSignal) =>
    pipelineRequest<{ items: PipelineItem[] }>(`/api/projects/${projectId}/stages/${stage}/items`, { signal }),

  units: (projectId: string, signal?: AbortSignal) =>
    pipelineRequest<{ units: PipelineUnit[]; summary: PlanSummary }>(`/api/projects/${projectId}/units`, { signal }),

  jobs: (projectId: string) => pipelineRequest<{ jobs: JobView[] }>(`/api/projects/${projectId}/jobs`),

  startStage: (projectId: string, stage: StageKey) =>
    json<{ job: JobView }>(`/api/projects/${projectId}/pipeline/start`, 'POST', { stage }),

  retryJob: (projectId: string, jobId: string) =>
    json<{ job: JobView }>(`/api/projects/${projectId}/jobs/${jobId}/retry`, 'POST', {}),

  cancelJob: (jobId: string, mode: 'pause' | 'stop') => json<{ job: JobView }>(`/api/jobs/${jobId}/cancel`, 'POST', { mode }),

  confirmStage: (projectId: string, stage: StageKey) =>
    json<StageConfirmResult>(`/api/projects/${projectId}/stages/${stage}/confirm`, 'POST', {}),

  skipStage: (projectId: string, stage: StageKey, reason?: string) =>
    json<{ stage: StageKey; status: string }>(`/api/projects/${projectId}/stages/${stage}/skip`, 'POST', { reason }),

  regenerate: (
    projectId: string,
    stage: StageKey,
    input: { scope: 'all' | 'block' | 'item'; targetId?: string; note?: string; confirmOverwrite?: boolean },
  ) => json<{ job: JobView }>(`/api/projects/${projectId}/stages/${stage}/regenerate`, 'POST', input),

  feedback: (
    projectId: string,
    stage: StageKey,
    input: { scope: 'all' | 'block' | 'item'; targetId?: string; note: string },
  ) => json<{ job: JobView }>(`/api/projects/${projectId}/stages/${stage}/feedback`, 'POST', input),

  resolveStale: (
    projectId: string,
    stage: StageKey,
    action: 'keep' | 'regenerate' | 'ignore',
    options?: { confirmOverwrite?: boolean },
  ) =>
    json<{ stage: StageKey; status: string }>(`/api/projects/${projectId}/stages/${stage}/stale/resolve`, 'POST', {
      action,
      ...(options?.confirmOverwrite ? { confirmOverwrite: true } : {}),
    }),

  revisions: (projectId: string, stage: StageKey, targetId?: string) =>
    pipelineRequest<{ revisions: Revision[] }>(
      `/api/projects/${projectId}/stages/${stage}/revisions${targetId ? `?targetId=${encodeURIComponent(targetId)}` : ''}`,
    ),

  patchItem: (projectId: string, itemId: string, patch: { title?: string; payload?: Record<string, unknown> }) =>
    json<{ item: PipelineItem; stage: StageKey }>(`/api/projects/${projectId}/items/${itemId}`, 'PATCH', patch),

  lockItem: (projectId: string, itemId: string, locked: boolean) =>
    json<{ item: PipelineItem }>(`/api/projects/${projectId}/items/${itemId}/lock`, 'POST', { locked }),

  restoreItemRevision: (projectId: string, itemId: string, revisionId: string) =>
    json<{ item: PipelineItem }>(`/api/projects/${projectId}/items/${itemId}/revisions/${revisionId}/restore`, 'POST', {}),

  /** 新增一条 P1/P2 条目（人物/环境/幕/节拍）；节拍必须带 parentId。 */
  createItem: (
    projectId: string,
    stage: StageKey,
    input: { kind?: string; title?: string; payload?: Record<string, unknown>; parentId?: string },
  ) => json<{ item: PipelineItem; stage: StageKey }>(`/api/projects/${projectId}/stages/${stage}/items`, 'POST', input),

  /** 删除一条 P1/P2 条目（锁定条目 409 ITEM_LOCKED，章/节拍删不了）。 */
  deleteItem: (projectId: string, itemId: string) =>
    json<{ stage: StageKey; deleted: string[] }>(`/api/projects/${projectId}/items/${itemId}`, 'DELETE'),

  /** 条目排序：ids 必须正好是这一块的全部条目（block：env/characters/acts/幕 id/节拍组 id）。 */
  reorderItems: (projectId: string, stage: StageKey, input: { block: string; ids: string[] }) =>
    json<{ stage: StageKey; items: PipelineItem[] }>(`/api/projects/${projectId}/stages/${stage}/items/reorder`, 'POST', input),

  /** 章节/节拍计划排序：ids 必须是全部单元的排列。 */
  reorderUnits: (projectId: string, ids: string[]) =>
    json<{ summary: PlanSummary }>(`/api/projects/${projectId}/stages/p3/units/reorder`, 'POST', { ids }),

  allocate: (projectId: string, totalTarget: number) =>
    json<AllocationPreview>(`/api/projects/${projectId}/stages/p3/units/allocate`, 'POST', { totalTarget }),

  applyAllocation: (projectId: string, rows: AllocationRow[], includeEdited = false) =>
    json<{ summary: PlanSummary }>(`/api/projects/${projectId}/stages/p3/units/allocate/apply`, 'POST', {
      rows,
      includeEdited,
    }),

  setUnitCount: (projectId: string, count: number, archiveOrphans = false) =>
    json<{ summary: PlanSummary }>(`/api/projects/${projectId}/stages/p3/units/count`, 'POST', { count, archiveOrphans }),

  patchUnit: (projectId: string, unitId: string, patch: UnitPlanPatch) =>
    json<{ summary: PlanSummary }>(`/api/projects/${projectId}/stages/p3/units/${unitId}`, 'PATCH', patch),

  acceptDeviation: (projectId: string, accepted: boolean) =>
    json<{ summary: PlanSummary }>(`/api/projects/${projectId}/pipeline/accept-deviation`, 'POST', { accepted }),

  startWriting: (projectId: string, input?: { mode?: 'continuous' | 'single'; unitId?: string }) =>
    json<{ job: JobView }>(`/api/projects/${projectId}/writing/start`, 'POST', input || { mode: 'continuous' }),

  pauseWriting: (projectId: string) => json<{ job: JobView }>(`/api/projects/${projectId}/writing/pause`, 'POST', {}),

  continueWriting: (projectId: string) =>
    json<{ job: JobView }>(`/api/projects/${projectId}/writing/continue`, 'POST', {}),

  stopWriting: (projectId: string, confirm: boolean) =>
    json<{ job: JobView }>(`/api/projects/${projectId}/writing/stop`, 'POST', { confirm }),

  reviewChapter: (chapterId: string, input: ReviewActionInput) =>
    json<ReviewActionResult | { status?: number; result?: ReviewActionResult }>(`/api/chapters/${chapterId}/review`, 'POST', input),

  unitVersions: (projectId: string, unitId: string) =>
    pipelineRequest<{ versions: UnitVersionRow[]; currentVersionId: string | null }>(
      `/api/projects/${projectId}/units/${unitId}/versions`,
    ),

  restoreUnitVersion: (projectId: string, unitId: string, versionId: string) =>
    json<{ unit: PipelineItem | null }>(`/api/projects/${projectId}/units/${unitId}/versions/${versionId}/restore`, 'POST', {}),

  migration: (projectId: string) => pipelineRequest<{ migration: MigrationView }>(`/api/projects/${projectId}/migration`),

  migratePrecheck: (projectId: string) => json<Record<string, unknown>>(`/api/projects/${projectId}/migrate/precheck`, 'POST', {}),

  migrate: (projectId: string) =>
    json<{ migration: MigrationView; ok: boolean; viewUrl: string }>(`/api/projects/${projectId}/migrate`, 'POST', {}),

  rollbackMigration: (projectId: string, mode: 'sql' | 'file') =>
    json<{ migration: MigrationView }>(`/api/projects/${projectId}/migrate/rollback`, 'POST', { mode, confirm: true }),

  /**
   * 创建 AI-first 作品：立即落库 + 后台企划，无模型/无 Key 时服务端 422 且不落库。
   * Idempotency-Key 防重复提交（双击/重试）造成两个作品。
   */
  createProject: (input: {
    title: string;
    type: string;
    genre?: string;
    premise?: string;
    targetWords?: number;
    clientRequestId?: string;
  }) =>
    pipelineRequest<{ project: { id: string; title: string; type: string }; job: JobView | null; replayed?: boolean }>(
      '/api/projects',
      {
        method: 'POST',
        headers: withIdempotencyKey(input.clientRequestId),
        body: JSON.stringify({
          title: input.title,
          type: input.type,
          genre: input.genre ?? '',
          premise: input.premise ?? '',
          targetWords: input.targetWords,
          start: 'pipeline',
        }),
      },
    ),
};
