import { getProviderRow, getProviderSecret, getSettings, providerModelIds } from '../repository.ts';
import type { ProviderInfo, ReasoningLevel, ReasoningPreference } from '../../shared/types.ts';
import { fail } from '../pipeline/types.ts';
import { RETRY_BACKOFF_MS, STEP_TIMEOUT_MS } from '../pipeline/types.ts';

/**
 * 单步模型调用（ARCHITECTURE §3.1 / §3.8 / §4.5）。
 * 纪律：
 * 1. 所有解析与校验都在发请求之前完成 —— 调用方拿到异常时数据库一定还没有副作用；
 * 2. 取消用 job 自己的 AbortSignal（页面断开不 abort，见 INV-5）；
 * 3. 推理等级不被模型支持时降级到最接近的档位并写日志，不直接把整个任务打成 502；
 * 4. content 为空但 reasoning 非空 → EMPTY_OUTPUT（不能报成 INVALID_JSON）。
 */

export interface CallSelection {
  providerId: string;
  modelId: string;
  reasoning: ReasoningPreference;
  provider: ProviderInfo;
  apiKey: string;
  kind: ProviderInfo['kind'];
  baseUrl: string;
}

export interface CallResult {
  text: string;
  reasoning: string;
  finishReason: string;
  usage: { prompt?: number; completion?: number; total?: number } | null;
  providerId: string;
  modelId: string;
  attempts: number;
}

const REASONING_ORDER: ReasoningLevel[] = ['low', 'medium', 'high'];

function isLocalBaseUrl(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal/i.test(baseUrl || '');
}

export function describeProvider(row: Record<string, any>): ProviderInfo['kind'] {
  const kind = String(row.kind || 'openai');
  if (kind === 'mock' || kind === 'anthropic' || kind === 'google') return kind;
  return 'openai';
}

/**
 * 解析「要用哪个供应商/模型」。显式覆盖必须成对给（providerId+modelId），
 * 只给半边会被拒绝，避免悄悄借默认的另一半。
 */
export function resolveSelection(override?: { providerId?: string; modelId?: string; reasoning?: ReasoningPreference }): CallSelection {
  const settings = getSettings();
  let providerId = override?.providerId || '';
  let modelId = override?.modelId || '';
  if (!providerId && !modelId) {
    if (!settings.defaultModel) fail('NO_DEFAULT_MODEL');
    providerId = settings.defaultModel.providerId;
    modelId = settings.defaultModel.modelId;
  } else if (!providerId || !modelId) {
    fail('BAD_REQUEST', 'providerId 与 modelId 必须同时提供');
  }

  const row = getProviderRow(providerId);
  if (!row) fail('NO_DEFAULT_MODEL', '默认模型对应的供应商不存在，请到设置中重新选择');
  const provider: ProviderInfo = {
    id: String(row.id),
    name: String(row.name),
    family: String(row.family || ''),
    kind: describeProvider(row),
    mark: String(row.mark || ''),
    brand: String(row.brand || ''),
    baseUrl: String(row.base_url || ''),
    configured: true,
    enabled: Boolean(row.enabled),
    apiKeyMasked: '',
    models: [],
    enabledModels: [],
    defaultModel: '',
    isDefault: Boolean(row.is_default),
  };
  if (!provider.enabled) fail('NO_DEFAULT_MODEL', '默认模型对应的供应商未启用，请到设置中重新选择');

  const models = providerModelIds(providerId);
  if (models.length && !models.includes(modelId)) fail('MODEL_NOT_FOUND', `模型 ${modelId} 不在 ${provider.name} 的可用列表里`);

  const apiKey = getProviderSecret(providerId);
  if (!apiKey && provider.kind !== 'mock' && !isLocalBaseUrl(provider.baseUrl)) {
    fail('NO_API_KEY', `「${provider.name}」还没有填写 API Key`);
  }

  const reasoning = resolveReasoning(provider, modelId, override?.reasoning ?? settings.reasoningLevel);
  return { providerId, modelId, reasoning, provider, apiKey, kind: provider.kind, baseUrl: provider.baseUrl || defaultBaseUrl(provider.kind, provider.id) };
}

function resolveReasoning(provider: ProviderInfo, modelId: string, preferred: ReasoningPreference): ReasoningPreference {
  if (preferred === 'default') return 'default';
  const supported = supportedReasoning(provider, modelId);
  if (!supported.length) {
    console.log(`[provider] reasoning=${preferred} unsupported by model=${modelId} → fallback default`);
    return 'default';
  }
  if (supported.includes(preferred)) return preferred;
  const wanted = REASONING_ORDER.indexOf(preferred);
  const nearest = [...supported].sort((a, b) => Math.abs(REASONING_ORDER.indexOf(a) - wanted) - Math.abs(REASONING_ORDER.indexOf(b) - wanted))[0];
  console.log(`[provider] reasoning=${preferred} unsupported by model=${modelId} → fallback ${nearest}`);
  return nearest;
}

function supportedReasoning(provider: ProviderInfo, modelId: string): ReasoningLevel[] {
  const row = getProviderRow(provider.id);
  const models = JSON.parse(String(row?.models || '[]')) as Array<{ id: string; reasoning?: ReasoningLevel[] }>;
  const hit = models.find((model) => model.id === modelId);
  return Array.isArray(hit?.reasoning) ? (hit!.reasoning as ReasoningLevel[]) : [];
}

export function isMockSelection(selection: CallSelection): boolean {
  return selection.kind === 'mock';
}

function defaultBaseUrl(kind: ProviderInfo['kind'], providerId: string): string {
  if (kind === 'anthropic') return 'https://api.anthropic.com';
  if (kind === 'google') return 'https://generativelanguage.googleapis.com';
  if (providerId === 'deepseek') return 'https://api.deepseek.com';
  return 'https://api.openai.com';
}

export function endpoint(baseUrl: string, path: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (/\/v\d+[a-z]*$/i.test(base)) return `${base}${path}`;
  return `${base}/v1${path}`;
}

const REASONING_BUDGET: Record<ReasoningLevel, number> = { low: 1024, medium: 2048, high: 4096 };
const THINKING_BUDGET: Record<ReasoningLevel, number> = { low: 1024, medium: 4096, high: 12288 };

export interface CallOptions {
  system: string;
  prompt: string;
  /** 挂 job 自己的 AbortSignal；超时由本函数叠加 120s。 */
  signal?: AbortSignal;
  override?: { providerId?: string; modelId?: string; reasoning?: ReasoningPreference };
  maxTokens?: number;
  temperature?: number;
  /** mock 供应商（显式选择）时用来产出确定性内容，绝不作为静默兜底。 */
  mockText?: () => string;
  label?: string;
}

interface HttpOutcome {
  status: number;
  text: string;
  json: any;
  ok: boolean;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<HttpOutcome> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, text, json, ok: response.ok };
}

function statusError(outcome: HttpOutcome): never {
  const { status, json, text } = outcome;
  const bodyText = typeof text === 'string' ? text.slice(0, 400) : '';
  const detail = json?.error?.message || json?.error?.type || bodyText;
  if (status === 401 || status === 403) fail('AUTH_FAILED', undefined, { detail });
  if (status === 404) fail('MODEL_NOT_FOUND', undefined, { detail });
  if (status === 402) fail('QUOTA_EXCEEDED', undefined, { detail });
  if (status === 429) fail('RATE_LIMIT', undefined, { detail });
  if (/insufficient_quota|exceeded your current quota|余额/i.test(bodyText)) fail('QUOTA_EXCEEDED', undefined, { detail });
  if (/content[_ ]?policy|content_filter|safety/i.test(bodyText)) fail('CONTENT_BLOCKED', undefined, { detail });
  fail('PROVIDER_ERROR', `供应商返回错误（HTTP ${status}）`, { detail });
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === 'RATE_LIMIT' || code === 'NETWORK';
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (index === attempts - 1 || !isRetryable(error)) throw error;
      console.log(`[provider] retry after=${(error as { code?: string })?.code} attempt=${index + 2}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }
  }
  throw lastError;
}

function composeSignal(signal?: AbortSignal): { signal: AbortSignal; cancel: () => void; timeout: () => boolean } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
    timeout: () => controller.signal.aborted && !signal?.aborted,
  };
}

export async function callModel(options: CallOptions): Promise<CallResult> {
  const selection = resolveSelection(options.override);
  const startedAt = Date.now();
  if (isMockSelection(selection)) {
    if (!options.mockText) fail('NO_DEFAULT_MODEL', 'mock 供应商只能用于本地演示');
    const text = options.mockText();
    console.log(`[provider] mock model=${selection.modelId} dur=${Date.now() - startedAt}ms stage=${options.label || ''}`);
    return { text, reasoning: '', finishReason: 'stop', usage: null, providerId: selection.providerId, modelId: selection.modelId, attempts: 1 };
  }

  const signalHost = composeSignal(options.signal);
  let attempts = 0;
  try {
    const result = await withRetry(async () => {
      attempts += 1;
      try {
        return await requestOnce(selection, options, signalHost.signal);
      } catch (error) {
        if (signalHost.timeout()) fail('PROVIDER_TIMEOUT', `供应商超时（已等 ${Math.round(STEP_TIMEOUT_MS / 1000)} 秒）`);
        if (options.signal?.aborted) fail('CANCELLED');
        if ((error as Error)?.name === 'AbortError') fail('CANCELLED');
        if ((error as Error)?.name === 'TypeError' && /fetch failed|network|ENOTFOUND|ECONNRESET|EAI_AGAIN/i.test((error as Error).message)) fail('NETWORK');
        throw error;
      }
    });
    console.log(`[provider] model=${selection.modelId} dur=${Date.now() - startedAt}ms completion=${result.usage?.completion ?? 0} label=${options.label || ''}`);
    return { ...result, providerId: selection.providerId, modelId: selection.modelId, attempts };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    console.log(`[provider] model=${selection.modelId} status=fail code=${code || 'UNKNOWN'} dur=${Date.now() - startedAt}ms label=${options.label || ''}`);
    throw error;
  } finally {
    signalHost.cancel();
  }
}

async function requestOnce(selection: CallSelection, options: CallOptions, signal: AbortSignal) {
  if (selection.kind === 'anthropic') return requestAnthropic(selection, options, signal);
  if (selection.kind === 'google') return requestGoogle(selection, options, signal);
  return requestOpenAI(selection, options, signal);
}

function emptyGuard(text: string, reasoning: string): { text: string; reasoning: string } {
  if (!text.trim()) {
    if (reasoning.trim()) fail('EMPTY_OUTPUT', '模型只返回了推理过程、没有返回正文内容');
    fail('EMPTY_OUTPUT');
  }
  return { text, reasoning };
}

async function requestOpenAI(selection: CallSelection, options: CallOptions, signal: AbortSignal) {
  const body: Record<string, unknown> = {
    model: selection.modelId,
    stream: false,
    temperature: options.temperature ?? 0.8,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.prompt },
    ],
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (selection.reasoning !== 'default') {
    if (selection.provider.family === 'openrouter') body.reasoning = { effort: selection.reasoning };
    else body.reasoning_effort = selection.reasoning;
  }
  const headers: Record<string, string> = {};
  if (selection.apiKey) headers.Authorization = `Bearer ${selection.apiKey}`;
  let outcome: HttpOutcome;
  try {
    outcome = await postJson(endpoint(selection.baseUrl, '/chat/completions'), body, headers, signal);
  } catch (error) {
    throw error;
  }
  if (!outcome.ok) statusError(outcome);
  const message = outcome.json?.choices?.[0]?.message || {};
  const reasoning = String(message.reasoning_content || message.reasoning || '');
  const guarded = emptyGuard(String(message.content ?? ''), reasoning);
  return {
    text: guarded.text,
    reasoning: guarded.reasoning,
    finishReason: String(outcome.json?.choices?.[0]?.finish_reason || 'stop'),
    usage: usageOf(outcome.json?.usage),
  };
}

async function requestAnthropic(selection: CallSelection, options: CallOptions, signal: AbortSignal) {
  const budget = REASONING_BUDGET[(selection.reasoning === 'default' ? 'medium' : selection.reasoning) as ReasoningLevel];
  const body: Record<string, unknown> = {
    model: selection.modelId,
    max_tokens: Math.max(options.maxTokens ?? 8192, selection.reasoning === 'default' ? 4096 : budget + 2048),
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
  };
  if (selection.reasoning !== 'default') body.thinking = { type: 'enabled', budget_tokens: budget };
  const outcome = await postJson(endpoint(selection.baseUrl, '/messages'), body, { 'x-api-key': selection.apiKey, 'anthropic-version': '2023-06-01' }, signal);
  if (!outcome.ok) statusError(outcome);
  const blocks: any[] = Array.isArray(outcome.json?.content) ? outcome.json.content : [];
  const text = blocks.filter((block) => block?.type === 'text').map((block) => String(block.text || '')).join('\n');
  const reasoning = blocks.filter((block) => block?.type === 'thinking').map((block) => String(block.thinking || '')).join('\n');
  const guarded = emptyGuard(text, reasoning);
  return { text: guarded.text, reasoning: guarded.reasoning, finishReason: String(outcome.json?.stop_reason || 'stop'), usage: usageOf(outcome.json?.usage) };
}

async function requestGoogle(selection: CallSelection, options: CallOptions, signal: AbortSignal) {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    generationConfig: { temperature: options.temperature ?? 0.8, ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}) },
  };
  if (selection.reasoning !== 'default') {
    body.generationConfig = { ...(body.generationConfig as object), thinkingConfig: { thinkingBudget: THINKING_BUDGET[selection.reasoning as ReasoningLevel] } };
  }
  const url = `${endpoint(selection.baseUrl, `/models/${encodeURIComponent(selection.modelId)}:generateContent`)}?key=${encodeURIComponent(selection.apiKey)}`;
  const outcome = await postJson(url, body, {}, signal);
  if (!outcome.ok) statusError(outcome);
  const candidate = outcome.json?.candidates?.[0];
  const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.filter((part) => !part?.thought).map((part) => String(part.text || '')).join('');
  const reasoning = parts.filter((part) => part?.thought).map((part) => String(part.text || '')).join('');
  const guarded = emptyGuard(text, reasoning);
  return { text: guarded.text, reasoning: guarded.reasoning, finishReason: String(candidate?.finishReason || 'stop'), usage: usageOf(outcome.json?.usageMetadata) };
}

function usageOf(usage: any): CallResult['usage'] {
  if (!usage) return null;
  return {
    prompt: Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0) || undefined,
    completion: Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? 0) || undefined,
    total: Number(usage.total_tokens ?? usage.totalTokenCount ?? 0) || undefined,
  };
}
