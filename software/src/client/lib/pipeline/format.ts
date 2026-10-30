import type { StageKey, StageViewStatus } from '../../../shared/pipeline.ts';

export type ProjectKind = 'novel' | 'short';

/** 字数口径（UX-SPEC §2.5）：≤9999 用「1,240 字」，≥10000 用「3.4 万字」。 */
export function formatWords(words: number | null | undefined): string {
  const value = Number(words || 0);
  if (Math.abs(value) < 10000) return `${value.toLocaleString('zh-CN')} 字`;
  return `${(value / 10000).toFixed(1)} 万字`;
}

/** 秒数口径：<60s 用「34 秒」，否则「3 分 12 秒」。 */
export function formatElapsed(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

/** 偏差带符号、一位小数。 */
export function formatDeviation(pct: number | null | undefined): string {
  const value = Number(pct || 0);
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatClock(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 短篇统一把「章」换成「节拍」，避免文案漏改。 */
export function unitLabel(kind: ProjectKind): string {
  return kind === 'short' ? '节拍' : '章';
}

export function unitCountLabel(kind: ProjectKind, count: number): string {
  return `${count} ${unitLabel(kind)}`;
}

export function actLabel(kind: ProjectKind): string {
  return kind === 'short' ? '节拍组' : '幕';
}

export interface StageMeta {
  key: StageKey;
  index: number;
  title: string;
  subtitle: string;
}

export function stageMetas(kind: ProjectKind): StageMeta[] {
  const chapterUnit = unitLabel(kind);
  return [
    { key: 'p1', index: 1, title: '设定', subtitle: '世界观、环境与人物' },
    { key: 'p2', index: 2, title: '故事大纲', subtitle: kind === 'short' ? '把设定拆成可写的节拍' : '把设定拆成可写的事件' },
    { key: 'p3', index: 3, title: kind === 'short' ? '节拍计划' : '章节计划', subtitle: `每个${chapterUnit}写什么、写多长` },
    { key: 'p4', index: 4, title: kind === 'short' ? '逐节拍写作' : '逐章写作', subtitle: 'AI 一个接一个往下写，你可以随时暂停' },
  ];
}

export function stageMeta(kind: ProjectKind, key: StageKey): StageMeta {
  return stageMetas(kind).find((meta) => meta.key === key) || stageMetas(kind)[0];
}

export const STAGE_STATUS_LABEL: Record<StageViewStatus, string> = {
  empty: '待生成',
  generating: '生成中',
  review: '待确认',
  confirmed: '已确认',
  failed: '生成失败',
  skipped: '已跳过',
};

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: '待写',
  generating: '生成中',
  in_review: '待审阅',
  approved: '已通过',
  changes_requested: '需修改',
  approved_manual: '人工通过',
  skipped: '已跳过',
};

export function reviewStatusLabel(status: string | null | undefined, kind: ProjectKind): string {
  const label = REVIEW_STATUS_LABEL[String(status || 'pending')] || '待写';
  if (kind === 'novel') return label;
  return label.replace('章', '节拍');
}

export const REVISION_SOURCE_LABEL: Record<string, string> = {
  ai_initial: 'AI 初稿',
  ai_regen: '整份重生成',
  ai_feedback: '按意见重做',
  manual: '你修改',
  rollback: '回滚',
  migration: '迁移',
  ai_rejected: '未通过校验',
  confirm: '确认快照',
};

export function revisionSourceLabel(source: string | null | undefined): string {
  return REVISION_SOURCE_LABEL[String(source || '')] || '修订';
}

export interface ErrorCopy {
  title: string;
  hint: string;
  /** 可选的补救动作；`settings`/`retry`/`continue` 会渲染成按钮 */
  action?: { label: string; kind: 'settings' | 'retry' | 'continue' | 'provider' };
  retryable: boolean;
}

const ERROR_COPY: Record<string, ErrorCopy> = {
  NO_DEFAULT_MODEL: {
    title: '还没有选默认模型',
    hint: '到设置里挑一个供应商和模型，AI 才能开始工作。',
    action: { label: '去设置里选模型', kind: 'settings' },
    retryable: false,
  },
  NO_API_KEY: {
    title: '这个供应商还没填 API Key',
    hint: '在设置里补上 Key 再重试，或者换一个已经配置好的供应商。',
    action: { label: '去设置里填 Key', kind: 'settings' },
    retryable: false,
  },
  AUTH_FAILED: {
    title: 'Key 无效或已经过期',
    hint: '到供应商后台确认 Key 还有效，然后重新保存一次。',
    action: { label: '去设置里更新 Key', kind: 'settings' },
    retryable: false,
  },
  MODEL_NOT_FOUND: {
    title: '这个模型现在用不了',
    hint: '供应商可能下线了这个模型，换一个模型再试。',
    action: { label: '换一个模型', kind: 'settings' },
    retryable: false,
  },
  REASONING_UNSUPPORTED: {
    title: '这个模型不支持推理等级',
    hint: '把设置里的推理等级改回「默认」，再重新生成。',
    action: { label: '去关掉推理等级', kind: 'settings' },
    retryable: false,
  },
  RATE_LIMIT: {
    title: '供应商限流了',
    hint: '等一会儿再重试，通常 1–2 分钟就能恢复。',
    action: { label: '重试', kind: 'retry' },
    retryable: true,
  },
  PROVIDER_TIMEOUT: {
    title: '模型服务超时',
    hint: '模型两分钟没返回内容。可以直接重试，或者换一个更快的模型。',
    action: { label: '重试这一步', kind: 'retry' },
    retryable: true,
  },
  PROVIDER_ERROR: {
    title: '模型服务返回了错误',
    hint: '这通常是供应商侧的问题，可以直接重试。',
    action: { label: '重试', kind: 'retry' },
    retryable: true,
  },
  NETWORK: {
    title: '连不上本地服务',
    hint: '确认应用还在运行；网络恢复后重试即可，已经生成的进度都在本地。',
    action: { label: '重试连接', kind: 'retry' },
    retryable: true,
  },
  EMPTY_OUTPUT: {
    title: '模型没有返回内容',
    hint: '这一次是空响应，可以直接重试；连续出现就换一个模型。',
    action: { label: '重试这一步', kind: 'retry' },
    retryable: true,
  },
  INVALID_JSON: {
    title: '模型返回的格式不对',
    hint: '原始输出已保存，重试一次通常就能过；也可以换一个更稳的模型。',
    action: { label: '重试这一步', kind: 'retry' },
    retryable: true,
  },
  CONTENT_BLOCKED: {
    title: '内容被供应商拦截了',
    hint: '换一个模型，或把这一段的要求写得缓和一些。',
    retryable: false,
  },
  QUOTA_EXCEEDED: {
    title: '账户额度用完了',
    hint: '到供应商后台充值后再回来重试。',
    action: { label: '去设置里换模型', kind: 'settings' },
    retryable: false,
  },
  CANCELLED: { title: '已取消', hint: '这一步被取消了，可以重新开始。', retryable: true },
  INTERRUPTED: {
    title: '上次的生成被中断了',
    hint: '应用可能被关掉或崩溃过。已经写好的内容都在，从断点继续即可。',
    action: { label: '从断点继续', kind: 'continue' },
    retryable: true,
  },
  STAGE_LOCKED: {
    title: '请先完成上一步',
    hint: '阶段要按「设定 → 大纲 → 章节计划 → 写作」的顺序推进。',
    retryable: false,
  },
  CONCURRENT_JOB: {
    title: '还有任务在跑',
    hint: '等当前任务结束，或者先暂停它。',
    retryable: true,
  },
  CONFIRM_BLOCKED: {
    title: '还有条件没满足',
    hint: '按下面的清单补齐后再确认。',
    retryable: false,
  },
  CONTENT_WOULD_BE_LOST: {
    title: '这样会删掉已经写好的正文',
    hint: '已有正文的章不能通过减少章数删除，可以先只删空白章。',
    retryable: false,
  },
  DEVIATION_NOT_ACCEPTED: {
    title: '计划字数和目标差得太远',
    hint: '确认接受这个偏差，或者调整每章的字数范围。',
    retryable: false,
  },
  NOTE_TOO_SHORT: {
    title: '意见写得太短了',
    hint: '至少写 4 个字，AI 才知道往哪里改。',
    retryable: false,
  },
  MIGRATION_FAILED: {
    title: '旧作品升级失败',
    hint: '数据已经回滚到升级前，可以查看技术详情后重试。',
    retryable: true,
  },
  NOT_FOUND: { title: '找不到这条内容', hint: '它可能已经被删除了，刷新后再看。', retryable: false },
  BAD_REQUEST: { title: '这个操作现在做不了', hint: '检查一下输入，或者刷新页面再试。', retryable: false },
  TYPE_NOT_SUPPORTED: {
    title: '这类作品不进 AI 流水线',
    hint: '剧本请用剧本工作台；AI 流水线目前支持长篇和短篇。',
    retryable: false,
  },
  // U12：这四个码原来落到兜底文案「可以重试一次」，但它们重试也不会好，必须说清原因。
  TARGET_EDITED: {
    title: '这一条被你手改过',
    hint: '手改过的内容不会被批量覆盖；要重做请对单条点「重生成此条」。',
    retryable: false,
  },
  ITEM_LOCKED: {
    title: '这一条已经锁定',
    hint: '锁定的条目不会被重生成覆盖。先解锁，再重做。',
    retryable: false,
  },
  MIGRATION_CHECK_FAILED: {
    title: '旧作品升级前的校验没通过',
    hint: '为了不弄坏原文，升级被挡住了。把技术详情发给开发者看具体哪一条不符。',
    retryable: false,
  },
  IDEMPOTENT_REPLAY: {
    title: '这次请求已经处理过了',
    hint: '同一个请求重复提交不会重复执行，刷新看看最新结果即可。',
    retryable: false,
  },
};

/**
 * 「只有确认覆盖这一条路」的专用文案（N1）。
 * 服务端 `CONFIRM_BLOCKED` 有两种含义：条件没满足（清单式）和「会覆盖手改内容，要不要继续」。
 * 后者用 generic 文案会误导用户去「补齐清单」，所以按 `requiresConfirm` 分开写。
 */
const OVERWRITE_COPY: ErrorCopy = {
  title: '这会覆盖你手改过的内容',
  hint: '继续会用 AI 的新内容替换掉手改的部分；手改本身仍保留在修改历史里，可以找回。',
  action: { label: '确认覆盖并重排', kind: 'retry' },
  retryable: false,
};

export function errorCopy(code: string | null | undefined, options?: { requiresConfirm?: string | null | undefined }): ErrorCopy {
  if (!code) return { title: '出了点问题', hint: '可以重试一次；如果一直失败，把技术详情发给开发者。', retryable: true };
  if (code === 'CONFIRM_BLOCKED' && options?.requiresConfirm === 'overwrite') return OVERWRITE_COPY;
  return (
    ERROR_COPY[code] || {
      // 未知错误码：先说清「哪个码」，用户报障时能直接对上日志（U12）。
      title: `出了点问题（${code}）`,
      hint: '可以先重试一次；如果一直失败，把技术详情发给开发者。',
      action: { label: '重试', kind: 'retry' },
      retryable: true,
    }
  );
}

/** 阶段内各块的标题与字段（P1/P2 共用）。 */
export const FUNCTION_OPTIONS = ['推进主线', '揭示信息', '关系变化', '铺垫伏笔', '回收伏笔', '冲突升级', '高潮', '收束', '过渡'];

export const ACT_FUNCTIONS = ['钩子', '推进', '转折', '揭示', '高潮', '收束', '缓冲'];

export const ENV_TYPES = ['城', '村', '机构', '异境'];
