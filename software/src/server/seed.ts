import type { DatabaseSync } from 'node:sqlite';
import { now } from './utils.ts';

type Row = Record<string, unknown>;

function insert(db: DatabaseSync, table: string, row: Row) {
  const keys = Object.keys(row);
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  db.prepare(sql).run(...keys.map((k) => row[k] as any));
}

const providers = [
  {
    id: 'mock', name: '本地演示', family: '内置', kind: 'mock', mark: 'M', brand: '#6f8a80', baseUrl: '',
    models: [{ id: 'mock-writer', name: '墨笔演示模型', ctx: '离线', tags: ['演示', '无需 Key'] }],
    enabledModels: ['mock-writer'], enabled: 1, isDefault: 1,
  },
  {
    id: 'deepseek', name: 'DeepSeek', family: '国内', kind: 'openai', mark: 'D', brand: '#4d6bfe', baseUrl: 'https://api.deepseek.com/v1',
    models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', ctx: '128k', tags: ['长文', '中文'] }, { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', ctx: '128k', tags: ['推理'] }],
    enabledModels: ['deepseek-chat'], enabled: 0, isDefault: 0,
  },
  {
    id: 'anthropic', name: 'Anthropic', family: '海外', kind: 'anthropic', mark: 'A', brand: '#d97757', baseUrl: 'https://api.anthropic.com/v1',
    models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', ctx: '200k', tags: ['长文', '文风'], reasoning: ['low', 'medium', 'high'] }, { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', ctx: '200k', tags: ['推理', '长文'], reasoning: ['low', 'medium', 'high'] }],
    enabledModels: ['claude-sonnet-4-5'], enabled: 0, isDefault: 0,
  },
  {
    id: 'openai', name: 'OpenAI', family: '海外', kind: 'openai', mark: 'O', brand: '#10a37f', baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-5.2', name: 'GPT-5.2', ctx: '128k', tags: ['通用', '结构'], reasoning: ['low', 'medium', 'high'] }, { id: 'o4', name: 'o4', ctx: '200k', tags: ['推理'], reasoning: ['low', 'medium', 'high'] }],
    enabledModels: ['gpt-5.2'], enabled: 0, isDefault: 0,
  },
  {
    id: 'google', name: 'Google Gemini', family: '海外', kind: 'google', mark: 'G', brand: '#4285f4', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [{ id: 'gemini-3-5-pro', name: 'Gemini 3.5 Pro', ctx: '1M', tags: ['超长文'], reasoning: ['low', 'medium', 'high'] }],
    enabledModels: ['gemini-3-5-pro'], enabled: 0, isDefault: 0,
  },
  {
    id: 'qwen', name: '通义千问', family: '国内', kind: 'openai', mark: 'Q', brand: '#7a5af5', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [{ id: 'qwen3-8-max', name: 'Qwen3.8 Max', ctx: '128k', tags: ['中文', '长文'] }],
    enabledModels: ['qwen3-8-max'], enabled: 0, isDefault: 0,
  },
  {
    id: 'zhipu', name: '智谱 GLM', family: '国内', kind: 'openai', mark: 'Z', brand: '#3856d6', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [{ id: 'glm-5', name: 'GLM-5', ctx: '128k', tags: ['中文'] }],
    enabledModels: ['glm-5'], enabled: 0, isDefault: 0,
  },
  {
    id: 'moonshot', name: 'Moonshot', family: '国内', kind: 'openai', mark: 'K', brand: '#8c9199', baseUrl: 'https://api.moonshot.cn/v1',
    models: [{ id: 'kimi-k3', name: 'Kimi K3', ctx: '256k', tags: ['长文', '中文'] }],
    enabledModels: ['kimi-k3'], enabled: 0, isDefault: 0,
  },
  {
    id: 'openrouter', name: 'OpenRouter', family: '聚合', kind: 'openai', mark: 'R', brand: '#6467f2', baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openai/gpt-5.2', name: 'GPT-5.2 · OpenRouter', ctx: '128k', tags: ['聚合', '通用'], reasoning: ['low', 'medium', 'high'] },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 · OpenRouter', ctx: '200k', tags: ['聚合', '文风'], reasoning: ['low', 'medium', 'high'] },
    ],
    enabledModels: ['openai/gpt-5.2'], enabled: 0, isDefault: 0,
  },
  {
    id: 'groq', name: 'Groq', family: '海外', kind: 'openai', mark: 'G', brand: '#f55036', baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B · Groq', ctx: '131k', tags: ['高速', '推理'], reasoning: ['low', 'medium', 'high'] },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', ctx: '128k', tags: ['通用'] },
    ],
    enabledModels: ['openai/gpt-oss-120b'], enabled: 0, isDefault: 0,
  },
  {
    id: 'mistral', name: 'Mistral', family: '海外', kind: 'openai', mark: 'M', brand: '#fa520f', baseUrl: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', ctx: '128k', tags: ['通用', '多语'] },
      { id: 'codestral-latest', name: 'Codestral', ctx: '256k', tags: ['代码'] },
    ],
    enabledModels: ['mistral-large-latest'], enabled: 0, isDefault: 0,
  },
  {
    id: 'xai', name: 'xAI Grok', family: '海外', kind: 'openai', mark: 'X', brand: '#1a1a1a', baseUrl: 'https://api.x.ai/v1',
    models: [
      { id: 'grok-4.2', name: 'Grok 4.2', ctx: '256k', tags: ['推理', '长文'], reasoning: ['low', 'medium', 'high'] },
      { id: 'grok-4-fast', name: 'Grok 4 Fast', ctx: '2M', tags: ['高速', '长文'] },
    ],
    enabledModels: ['grok-4.2'], enabled: 0, isDefault: 0,
  },
  {
    id: 'siliconflow', name: '硅基流动', family: '国内', kind: 'openai', mark: 'S', brand: '#5b5bd6', baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek V3.2 · 硅基流动', ctx: '128k', tags: ['中文', '开源'] },
      { id: 'Qwen/Qwen3.5-235B-A22B', name: 'Qwen3.5 235B', ctx: '128k', tags: ['中文', '开源'] },
    ],
    enabledModels: ['deepseek-ai/DeepSeek-V3.2'], enabled: 0, isDefault: 0,
  },
  {
    id: 'together', name: 'Together AI', family: '聚合', kind: 'openai', mark: 'T', brand: '#0f6fff', baseUrl: 'https://api.together.xyz/v1',
    models: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B · Together', ctx: '131k', tags: ['聚合', '推理'], reasoning: ['low', 'medium', 'high'] },
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', name: 'Llama 4 Maverick', ctx: '1M', tags: ['聚合', '长文'] },
    ],
    enabledModels: ['openai/gpt-oss-120b'], enabled: 0, isDefault: 0,
  },
  {
    id: 'ollama', name: 'Ollama', family: '本地', kind: 'openai', mark: 'L', brand: '#6f8a80', baseUrl: 'http://localhost:11434/v1',
    models: [{ id: 'llama4-70b', name: 'Llama 4 70B', ctx: '128k', tags: ['本地', '隐私'] }],
    enabledModels: ['llama4-70b'], enabled: 0, isDefault: 0,
  },
] as const;

export function seedDatabase(db: DatabaseSync) {
  const stamp = now();
  for (const p of providers) {
    insert(db, 'providers', {
      id: p.id, name: p.name, family: p.family, kind: p.kind, mark: p.mark, brand: p.brand, base_url: p.baseUrl,
      api_key_enc: null, models: JSON.stringify(p.models), enabled_models: JSON.stringify(p.enabledModels),
      enabled: p.enabled, is_default: p.isDefault, created_at: stamp, updated_at: stamp,
    });
  }

  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('seeded_at', ?)").run(stamp);

  const appSettings = {
    profile: { name: '', signature: '' },
    onboarding: { completed: false },
    appearance: { theme: 'ink', accent: 'cinnabar', customAccent: null, editorSize: 17.5, reduceMotion: false },
    prefs: { pov: '第三人称限知', genre: '悬疑 · 文学', aiLength: '中 · 约 500 字', autoSave: true, style: '克制留白' },
    generation: { temperature: 0.8, streaming: true },
    defaultModel: null,
    fallbackModel: null,
    reasoningLevel: 'default',
  };
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(appSettings));
}
