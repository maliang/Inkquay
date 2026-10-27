export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

export function now(): string {
  return new Date().toISOString();
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 未配置模型时的统一拒绝文案。
 * 服务端是唯一权威：调用方（共笔 / AI 企划）都用这两条，避免同一个问题出现两种说法。
 */
export const AI_NO_DEFAULT_MODEL = '还没有选择默认模型，请到设置中配置';
export const AI_NO_MODEL_SELECTED = '还没有选择模型，请到设置中配置';
