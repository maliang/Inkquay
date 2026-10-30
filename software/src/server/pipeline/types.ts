import type { PipelineErrorCode, StageKey, UnitReviewStatus } from '../../shared/pipeline.ts';
import type { PipelineError as PipelineErrorShape } from '../../shared/pipeline.ts';

export type { StageKey, UnitReviewStatus, PipelineErrorCode };

export const STAGE_KEYS: StageKey[] = ['p1', 'p2', 'p3', 'p4'];
export const STAGE_LABEL: Record<StageKey, string> = {
  p1: '世界观与人物',
  p2: '故事大纲',
  p3: '章节计划',
  p4: '逐章正文',
};

export type StageStatus = 'locked' | 'empty' | 'generating' | 'review' | 'confirmed' | 'failed' | 'skipped';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';
export type JobKind = 'plan' | 'regen-stage' | 'regen-item' | 'chapter-plan' | 'writing' | 'chapter-rewrite';
export type RevisionSource = 'ai_initial' | 'ai_feedback' | 'ai_regen' | 'manual' | 'rollback' | 'migration' | 'ai_rejected';

const STATUS_BY_CODE: Record<PipelineErrorCode, number> = {
  NO_DEFAULT_MODEL: 422,
  NO_API_KEY: 422,
  AUTH_FAILED: 502,
  MODEL_NOT_FOUND: 502,
  REASONING_UNSUPPORTED: 422,
  RATE_LIMIT: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  NETWORK: 502,
  EMPTY_OUTPUT: 502,
  INVALID_JSON: 502,
  CONTENT_BLOCKED: 422,
  QUOTA_EXCEEDED: 402,
  CANCELLED: 409,
  INTERRUPTED: 409,
  STAGE_LOCKED: 409,
  CONCURRENT_JOB: 409,
  MIGRATION_FAILED: 500,
  CONFIRM_BLOCKED: 422,
  TYPE_NOT_SUPPORTED: 422,
  IDEMPOTENT_REPLAY: 200,
  NOTE_TOO_SHORT: 422,
  NOTE_REQUIRED: 422,
  DEVIATION_NOT_ACCEPTED: 422,
  TARGET_EDITED: 422,
  CONTENT_WOULD_BE_LOST: 422,
  ITEM_LOCKED: 409,
  NOT_MIGRATABLE_EMPTY: 422,
  MIGRATION_CHECK_FAILED: 500,
  BACKUP_FAILED: 500,
  DISK_WRITE_FAILED: 500,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL: 500,
};

export const MESSAGE_BY_CODE: Partial<Record<PipelineErrorCode, string>> = {
  NO_DEFAULT_MODEL: '还没有选择默认模型，请到设置中配置',
  NO_API_KEY: '该供应商未填写 API Key',
  AUTH_FAILED: 'API Key 无效或无权限',
  MODEL_NOT_FOUND: '模型不存在或未开通',
  REASONING_UNSUPPORTED: '模型不支持该推理等级',
  RATE_LIMIT: '请求过于频繁（或额度不足），请稍后重试',
  PROVIDER_TIMEOUT: '供应商超时',
  PROVIDER_ERROR: '供应商返回错误',
  NETWORK: '无法连接供应商',
  EMPTY_OUTPUT: '模型未返回正文内容',
  INVALID_JSON: '模型输出格式不对',
  CONTENT_BLOCKED: '内容被供应商的策略拦截',
  QUOTA_EXCEEDED: '账户余额不足',
  CANCELLED: '已取消',
  INTERRUPTED: '生成被中断（已保留已完成部分）',
  STAGE_LOCKED: '请先确认上一阶段',
  CONCURRENT_JOB: '当前有生成任务进行中',
  MIGRATION_FAILED: '升级失败，已回到升级前状态',
  TYPE_NOT_SUPPORTED: '该作品类型不进流水线',
  ITEM_LOCKED: '这一条已锁定，先解锁再改',
  NOT_FOUND: '找不到这个对象',
  BAD_REQUEST: '请求参数不正确',
  NOT_MIGRATABLE_EMPTY: '这本还没有可升级的内容',
  MIGRATION_CHECK_FAILED: '升级校验未通过，作品未被修改（已回滚）',
  BACKUP_FAILED: '无法创建备份，已取消升级。',
  INTERNAL: '服务端处理失败，请重试或查看日志',
};

export class PipelineErrorException extends Error {
  code: PipelineErrorCode;
  status: number;
  blockers?: string[];
  detail?: unknown;
  retryable: boolean;

  constructor(code: PipelineErrorCode, message?: string, options: { status?: number; blockers?: string[]; detail?: unknown; retryable?: boolean } = {}) {
    super(message || MESSAGE_BY_CODE[code] || code);
    this.name = 'PipelineError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500;
    this.blockers = options.blockers;
    this.detail = options.detail;
    this.retryable = options.retryable ?? (code === 'RATE_LIMIT' || code === 'NETWORK');
  }

  toJSON(): PipelineErrorShape & { blockers?: string[] } {
    return { code: this.code, message: this.message, ...(this.detail === undefined ? {} : { detail: this.detail }), ...(this.blockers ? { blockers: this.blockers } : {}) };
  }
}

export function fail(code: PipelineErrorCode, message?: string, options?: ConstructorParameters<typeof PipelineErrorException>[2]): never {
  throw new PipelineErrorException(code, message, options);
}

export function isPipelineError(error: unknown): error is PipelineErrorException {
  return error instanceof PipelineErrorException;
}

/** 长短篇参数单一真相（ARCHITECTURE §5.1、SPEC §10）。 */
export interface KindProfile {
  kind: 'novel' | 'short';
  unit: 'chapter' | 'beat';
  unitLabel: string;
  actLabel: string;
  beatLabel: string;
  defaultGoalWords: number;
  minGoalWords: number;
  maxGoalWords: number;
  minUnits: number;
  maxUnits: number;
  defaultUnitWords: number;
  actRange: [number, number];
  beatRange: [number, number];
  requiresWorldRules: boolean;
}

export const KIND_PROFILE: Record<'novel' | 'short', KindProfile> = {
  novel: {
    kind: 'novel',
    unit: 'chapter',
    unitLabel: '章',
    actLabel: '幕',
    beatLabel: '节拍',
    defaultGoalWords: 300000,
    minGoalWords: 10000,
    maxGoalWords: 3000000,
    minUnits: 3,
    maxUnits: 200,
    defaultUnitWords: 3000,
    actRange: [2, 12],
    beatRange: [2, 12],
    requiresWorldRules: true,
  },
  short: {
    kind: 'short',
    unit: 'beat',
    unitLabel: '节拍',
    actLabel: '节拍组',
    beatLabel: '节拍',
    defaultGoalWords: 12000,
    minGoalWords: 3000,
    maxGoalWords: 15000,
    minUnits: 3,
    maxUnits: 40,
    defaultUnitWords: 1500,
    actRange: [1, 4],
    beatRange: [1, 12],
    requiresWorldRules: false,
  },
};

export const WORD_PRESETS = [
  { id: 'fast', label: '快节奏', minWords: 1500, targetWords: 2000, maxWords: 2500 },
  { id: 'standard', label: '标准', minWords: 2500, targetWords: 3000, maxWords: 4000 },
  { id: 'heavy', label: '厚重', minWords: 4000, targetWords: 5000, maxWords: 6000 },
];

export const DEFAULT_WORD_RANGE = { minWords: 2500, targetWords: 3000, maxWords: 4000, minWordsFloor: 300, maxWordsCeiling: 20000 };
export const DEVIATION_TOLERANCE = 0.25;
export const STEP_TIMEOUT_MS = Number(process.env.PW_STEP_TIMEOUT_MS || 120000);
export const RETRY_BACKOFF_MS = Number(process.env.PW_RETRY_BACKOFF_MS || 1000);
export const GLOBAL_JOB_CONCURRENCY = Number(process.env.PW_JOB_CONCURRENCY || 3);
export const CONTEXT_BUDGET = 12000;
/**
 * 迁移记账用的修订 note（N10）：迁移时把「迁前章节 id 清单」写成一条 revisions，
 * 它只是回滚用的内部账本、不是用户的创作历史，所以列修订历史时按这个 note 排除。
 */
export const LEDGER_NOTE = '迁移前章节清单';
export const UNIT_STATUSES: UnitReviewStatus[] = ['pending', 'generating', 'in_review', 'approved', 'changes_requested', 'approved_manual', 'skipped'];

export function kindProfileOf(type: string): KindProfile {
  if (type === 'short') return KIND_PROFILE.short;
  if (type === 'novel') return KIND_PROFILE.novel;
  fail('TYPE_NOT_SUPPORTED', `「${type}」不进 AI 流水线，请继续用原来的编辑器写作`);
}

export function stageOfKind(kind: JobKind, stageKey: StageKey): StageKey {
  return stageKey;
}
