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
