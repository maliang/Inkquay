import type { ProjectDetail, ProjectPlan, PlannedAct, PlannedCharacter, ReasoningPreference } from '../shared/types.ts';
import { decryptSecret } from './crypto.ts';
import { getProviderRow, getSettings } from './repository.ts';
import { AI_NO_DEFAULT_MODEL } from './utils.ts';

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (!base) throw new Error('Base URL 未配置');
  if (/\/v\d+(?:beta)?$/i.test(base) || /\/(?:api\/)?v\d+$/i.test(base) || /compatible-mode\/v1$/i.test(base)) return `${base}${path}`;
  return `${base}/v1${path}`;
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回有效 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizePlan(raw: any, project: ProjectDetail): ProjectPlan {
  const acts: PlannedAct[] = Array.isArray(raw?.acts) ? raw.acts.slice(0, 4).map((act: any, i: number) => ({
    title: String(act?.title || `第${i + 1}幕`),
    summary: String(act?.summary || ''),
    beats: Array.isArray(act?.beats) ? act.beats.slice(0, 8).map((beat: any, j: number) => ({
      chapterNo: Number(beat?.chapterNo) || i * 8 + j + 1,
      title: String(beat?.title || '未命名场景'),
      summary: String(beat?.summary || ''),
      tags: Array.isArray(beat?.tags) ? beat.tags.map(String) : [],
    })) : [],
  })) : [];
  if (acts.length < 2) throw new Error('模型返回的大纲结构不完整');
  const characters: PlannedCharacter[] = Array.isArray(raw?.characters) ? raw.characters.slice(0, 8).map((c: any) => ({
    name: String(c?.name || '未命名人物'),
    role: String(c?.role || ''),
    age: String(c?.age || ''),
    tags: Array.isArray(c?.tags) ? c.tags.map(String) : [],
    quote: String(c?.quote || ''),
    description: String(c?.description || ''),
    secret: String(c?.secret || ''),
  })) : [];
  return {
    acts,
    characters,
    chapter: {
      title: String(raw?.chapter?.title || '第一章'),
      content: String(raw?.chapter?.content || ''),
    },
  };
}

function mockPlan(project: ProjectDetail): ProjectPlan {
  const premise = project.description || project.title;
  const acts: PlannedAct[] = [
    { title: '第一幕 · 裂缝', summary: `日常被一个意外打破：${premise}`, beats: [
      { chapterNo: 1, title: '不寻常的清晨', summary: '用一个小异常把主角推出日常。', tags: ['钩子'] },
      { chapterNo: 2, title: '不该出现的线索', summary: '主角第一次意识到事情与自己有关。', tags: ['谜面'] },
      { chapterNo: 3, title: '越过边界', summary: '主角做出无法撤回的选择。', tags: ['转折'] },
    ] },
    { title: '第二幕 · 深水', summary: '追查让主角失去控制，也逼近真相。', beats: [
      { chapterNo: 4, title: '旧关系', summary: '一个过去的人带来新的信息。', tags: ['关系'] },
      { chapterNo: 5, title: '错误答案', summary: '主角相信了一个看似合理的解释。', tags: ['误导'] },
      { chapterNo: 6, title: '代价', summary: '追查开始伤害主角身边的人。', tags: ['升级'] },
      { chapterNo: 7, title: '夜里的证词', summary: '沉默的人终于开口。', tags: ['线索'] },
      { chapterNo: 8, title: '真正的对手', summary: '对手不再隐藏。', tags: ['转折'] },
    ] },
    { title: '第三幕 · 回声', summary: '真相与代价同时抵达，主角必须选择。', beats: [
      { chapterNo: 9, title: '回到原点', summary: '主角回到故事开始的地方。', tags: ['回收'] },
      { chapterNo: 10, title: '最后一次选择', summary: '用行动回答主题。', tags: ['高潮'] },
      { chapterNo: 11, title: '余波', summary: '世界没有变好，但主角变了。', tags: ['结尾'] },
    ] },
  ];
  const characters: PlannedCharacter[] = [
    { name: '主角', role: '主角', age: '30', tags: ['克制', '执拗'], quote: '“我只是想知道，那天到底发生了什么。”', description: `一个被「${premise}」卷进事件的人。`, secret: '他其实早就知道一部分真相。' },
    { name: '对手', role: '对手', age: '45', tags: ['体面', '冷静'], quote: '“有些答案，知道了就回不去了。”', description: '维护现有秩序的人，相信沉默比真相更安全。', secret: '他曾经也是受害者。' },
    { name: '引路人', role: '关键关系人', age: '28', tags: ['警觉', '熟悉内情'], quote: '“别问我是谁，先问你自己怕什么。”', description: '掌握关键信息，却不完全站在主角这一边。', secret: '她一直在等主角出现。' },
  ];
  return {
    acts, characters,
    chapter: {
      title: '第一章 不寻常的清晨',
      content: `${premise}\n\n天刚亮的时候，主角听见门外有人放下了一样东西。不是信，也不是包裹，而是一声很轻的、像钥匙碰到瓷盘的响动。\n\n他没有立刻开门。窗帘缝里透进来的光落在地板上，灰尘在光里慢慢下沉。那个声音又响了一次。`,
    },
  };
}

async function callOpenAI(provider: any, key: string, model: string, system: string, prompt: string, reasoning: ReasoningPreference): Promise<string> {
  const body: Record<string, any> = {
    model, stream: false, temperature: 0.7,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
  };
  if (reasoning !== 'default') {
    if (/openrouter/i.test(String(provider.base_url || ''))) body.reasoning = { effort: reasoning };
    else body.reasoning_effort = reasoning;
  }
  const response = await fetch(endpoint(provider.base_url, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(provider: any, key: string, model: string, system: string, prompt: string, reasoning: ReasoningPreference): Promise<string> {
  const budget = reasoning === 'low' ? 1024 : reasoning === 'medium' ? 2048 : reasoning === 'high' ? 4096 : 0;
  const body: Record<string, any> = { model, max_tokens: budget ? Math.max(8192, budget + 2048) : 4096, system, messages: [{ role: 'user', content: prompt }] };
  if (budget) body.thinking = { type: 'enabled', budget_tokens: budget };
  const response = await fetch(endpoint(provider.base_url, '/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
  return (data.content || []).map((part: any) => part?.text || '').join('');
}

async function callGoogle(provider: any, key: string, model: string, system: string, prompt: string, reasoning: ReasoningPreference): Promise<string> {
  const url = `${provider.base_url.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const generationConfig = reasoning !== 'default'
    ? { thinkingConfig: { thinkingBudget: reasoning === 'low' ? 1024 : reasoning === 'medium' ? 4096 : 12288 } }
    : undefined;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], ...(generationConfig ? { generationConfig } : {}) }),
    signal: AbortSignal.timeout(90000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
}

export async function generateProjectPlan(project: ProjectDetail): Promise<ProjectPlan> {
  const settings = getSettings();
  const modelRef = settings.defaultModel;
  if (!modelRef) throw new Error(AI_NO_DEFAULT_MODEL);
  const provider = getProviderRow(modelRef.providerId);
  if (!provider) throw new Error('默认模型对应的供应商不存在');
  if (provider.kind === 'mock') return mockPlan(project);
  const key = decryptSecret(provider.api_key_enc);
  if (!key) throw new Error('供应商未配置 API Key');
  const models = JSON.parse(String(provider.models || '[]')) as Array<{ id: string; reasoning?: string[] }>;
  const selectedModel = models.find((model) => model.id === modelRef.modelId);
  const reasoning = settings.reasoningLevel || 'default';
  if (reasoning !== 'default' && !selectedModel?.reasoning?.includes(reasoning)) {
    throw new Error(`模型 ${modelRef.modelId} 不支持「${reasoning}」推理等级，请到设置中重置`);
  }
  const system = '你是一位资深中文小说策划编辑。你只输出严格 JSON，不写解释，不使用 Markdown。';
  const prompt = `请为下面这部作品做一份可直接落地的三幕企划，并写第一章开头。

作品名：${project.title}
类型：${project.type}
题材：${project.genre}
一句话设定：${project.description}

输出 JSON，结构必须严格如下：
{
  "acts": [
    { "title": "第一幕标题", "summary": "这一幕做什么", "beats": [
      { "chapterNo": 1, "title": "场景标题", "summary": "场景事件与作用", "tags": ["钩子"] }
    ] }
  ],
  "characters": [
    { "name": "姓名", "role": "主角/对手/关系人", "age": "年龄", "tags": ["性格"], "quote": "一句台词", "description": "动机与底色", "secret": "秘密" }
  ],
  "chapter": { "title": "第一章标题", "content": "第一章正文，300-500 字，空行分段" }
}

要求：
- 3 幕，每幕 3-6 个场景，章节号连续，第一个场景对应第一章。
- 3-5 个主要人物，名字符合题材，不要用“主角/对手”这种占位词。
- 第一章正文要具体、有场景、有动作，不要解释设定。
- 只输出 JSON。`;
  const text = provider.kind === 'anthropic'
    ? await callAnthropic(provider, key, modelRef.modelId, system, prompt, reasoning)
    : provider.kind === 'google'
      ? await callGoogle(provider, key, modelRef.modelId, system, prompt, reasoning)
      : await callOpenAI(provider, key, modelRef.modelId, system, prompt, reasoning);
  return normalizePlan(extractJson(text), project);
}
