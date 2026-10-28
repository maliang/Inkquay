import type { ModelInfo, ReasoningLevel } from '../shared/types.ts';

type Row = Record<string, any>;

const REASONING_LEVELS: ReasoningLevel[] = ['low', 'medium', 'high'];

export interface DiscoveryInput {
  providerId: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  existing?: ModelInfo[];
}

function trimBase(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function endpoint(baseUrl: string, path: string): string {
  const base = trimBase(baseUrl);
  if (!base) throw new Error('Base URL 未配置');
  if (/\/v\d+(?:beta)?$/i.test(base) || /compatible-mode\/v\d+$/i.test(base)) return `${base}${path}`;
  return `${base}/v1${path}`;
}

function formatContext(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * 只对「供应商确实支持调节推理强度」的模型暴露档位。
 * 这里不做“看着像推理模型就加一个下拉”的猜测——不支持却显示，等于新的假开关。
 */
export function inferReasoning(providerId: string, kind: string, modelId: string): ReasoningLevel[] {
  const id = modelId.toLowerCase();
  if (kind === 'anthropic' && /claude-(3[.-]7|4|5|sonnet-4|opus-4)/.test(id)) return [...REASONING_LEVELS];
  if (kind === 'google' && /gemini-(2[.-]5|3|4)/.test(id)) return [...REASONING_LEVELS];
  if (kind === 'openai' && /^(o[1-9]|gpt-5|gpt-6)/.test(id)) return [...REASONING_LEVELS];
  if (providerId === 'xai' && /grok-(4|5)/.test(id)) return [...REASONING_LEVELS];
  if (providerId === 'groq' && /gpt-oss/.test(id)) return [...REASONING_LEVELS];
  if (providerId === 'openrouter' || providerId === 'together') {
    if (/openai\/(gpt-5|gpt-6|o[1-9]|gpt-oss)|anthropic\/claude-(?:[^/]*-)?(4|5)|google\/gemini-(2[.-]5|3|4)|x-ai\/grok-(4|5)/.test(id)) return [...REASONING_LEVELS];
  }
  return [];
}

function existingModel(existing: ModelInfo[] | undefined, id: string): ModelInfo | undefined {
  return existing?.find((model) => model.id === id);
}

function normalizeModel(raw: Row, input: DiscoveryInput): ModelInfo | null {
  const googleName = typeof raw.name === 'string' ? raw.name.replace(/^models\//, '') : '';
  const id = String(raw.id || googleName || raw.model || '').trim();
  if (!id) return null;
  if (Array.isArray(raw.supportedGenerationMethods) && !raw.supportedGenerationMethods.includes('generateContent')) return null;
  const existing = existingModel(input.existing, id);
  const rawName = String(raw.display_name || raw.displayName || raw.name || id).replace(/^models\//, '');
  const reasoning = inferReasoning(input.providerId, input.kind, id);
  const ctx = formatContext(raw.context_length ?? raw.context_window ?? raw.inputTokenLimit ?? raw.contextLength)
    || existing?.ctx
    || '—';
  const tags = existing?.tags?.length ? [...existing.tags] : ['API'];
  if (reasoning.length && !tags.includes('推理')) tags.push('推理');
  return {
    id,
    name: existing?.name || rawName,
    ctx,
    tags,
    ...(reasoning.length ? { reasoning } : {}),
  };
}

function modelArray(payload: Row): Row[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  if (Array.isArray(payload)) return payload;
  return [];
}

export async function fetchProviderModels(input: DiscoveryInput): Promise<{ models: ModelInfo[]; message: string }> {
  if (input.kind === 'mock') {
    return { models: input.existing || [{ id: 'mock-writer', name: '墨笔演示模型', ctx: '离线', tags: ['演示', '无需 Key'] }], message: '本地演示模型无需连接' };
  }
  const base = trimBase(input.baseUrl);
  if (!base) throw new Error('请先填写 Base URL');
  const key = String(input.apiKey || '').trim();
  if (!key && input.providerId !== 'ollama') throw new Error('请先填写 API Key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let url: string;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (input.kind === 'anthropic') {
      url = endpoint(base, '/models?limit=1000');
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (input.kind === 'google') {
      url = `${base}/models?key=${encodeURIComponent(key)}&pageSize=1000`;
    } else {
      url = endpoint(base, '/models');
      if (key) headers.Authorization = `Bearer ${key}`;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload: Row = {};
    try { payload = JSON.parse(text) as Row; } catch { /* handled below */ }
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || payload?.error || text.slice(0, 200);
      throw new Error(`拉取模型失败：HTTP ${response.status} ${String(detail || '').trim()}`.trim());
    }
    const models = modelArray(payload)
      .map((raw) => normalizeModel(raw, input))
      .filter((model): model is ModelInfo => Boolean(model));
    if (!models.length) throw new Error('接口返回了空模型列表，请检查供应商权限或 Base URL');
    return { models, message: `发现 ${models.length} 个可用模型` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('拉取模型超时（15 秒），请检查网络或 Base URL');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
