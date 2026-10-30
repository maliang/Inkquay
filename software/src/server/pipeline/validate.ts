import type { KindProfile } from './types.ts';
import { DEFAULT_WORD_RANGE } from './types.ts';

/**
 * 手写结构校验（ARCHITECTURE §4.4）。不引 zod：
 * - 严格裁剪而不是宽容修补：模型多给条目就报错，附「多给了 N 条」，绝不静默 slice 丢掉用户本该看到的内容；
 * - 每条错误带 path，前端/日志都能定位；
 * - 校验失败由调用方把原始输出存成 revisions(source='ai_rejected')，界面只说「模型输出格式不对」。
 */

export interface FieldError {
  path: string;
  message: string;
}

export interface Validation<T> {
  ok: boolean;
  errors: FieldError[];
  value?: T;
}

const PLACEHOLDER = /^(未命名|角色[A-Za-z]|待定|TODO|TBD|\.\.\.|…)$/;

function ok<T>(value: T): Validation<T> {
  return { ok: true, errors: [], value };
}

function bad<T>(errors: FieldError[]): Validation<T> {
  return { ok: false, errors };
}

function asObject(raw: unknown): Record<string, any> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function intOf(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(number) ? Math.round(number) : null;
}

/** 从模型输出里取出 JSON 对象（去掉 ```json 围栏与前后噪声）。 */
export function parseJsonResponse(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, message: '模型没有返回任何内容' };
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  try {
    return { ok: true, value: JSON.parse(slice) };
  } catch {
    return { ok: false, message: '模型没有返回有效 JSON' };
  }
}

function requireArray(raw: unknown, key: string, errors: FieldError[]): any[] | null {
  const root = asObject(raw);
  if (!root) {
    errors.push({ path: '$', message: '输出必须是一个 JSON 对象' });
    return null;
  }
  const list = Array.isArray(root[key]) ? root[key] : null;
  if (!list) {
    errors.push({ path: key, message: `缺少 ${key} 数组` });
    return null;
  }
  return list;
}

function checkCount(list: any[], path: string, min: number, max: number, errors: FieldError[], label: string) {
  if (list.length < min) errors.push({ path, message: `${label}至少 ${min} 条，模型给了 ${list.length} 条` });
  if (list.length > max) errors.push({ path, message: `${label}最多 ${max} 条，模型多给了 ${list.length - max} 条` });
}

// ---------------------------------------------------------------------------
// P1
// ---------------------------------------------------------------------------

export interface WorldPayload {
  era: string;
  worldRules: string;
  worldRulesNotNeeded: boolean;
  tone: string;
  language: string;
}

export function validateWorld(raw: unknown, profile: KindProfile): Validation<WorldPayload> {
  const errors: FieldError[] = [];
  const root = asObject(Array.isArray(raw) ? raw[0] : raw);
  if (!root) return bad([{ path: '$', message: '世界观必须是一个 JSON 对象' }]);
  const era = textOf(root.era ?? root.timeAndPlace ?? root.setting);
  const tone = textOf(root.tone ?? root.mood);
  const language = textOf(root.language ?? root.voice);
  const worldRules = textOf(root.worldRules ?? root.rules);
  const notNeeded = root.worldRulesNotNeeded === true;
  if (!era) errors.push({ path: 'era', message: '缺少时代地点' });
  if (!tone) errors.push({ path: 'tone', message: '缺少基调母题' });
  if (!language) errors.push({ path: 'language', message: '缺少语言习惯' });
  if (!worldRules) {
    if (profile.requiresWorldRules && !notNeeded) errors.push({ path: 'worldRules', message: '缺少世界规则（若不适用请显式返回 worldRulesNotNeeded=true）' });
  }
  if (errors.length) return bad(errors);
  return ok({ era, worldRules, worldRulesNotNeeded: notNeeded && !worldRules, tone, language });
}

export interface EnvPayload {
  name: string;
  type: string;
  mood: string;
  reason: string;
}

const ENV_TYPES = ['城', '村', '机构', '异境'];

export function validateEnvList(raw: unknown, profile: KindProfile): Validation<EnvPayload[]> {
  const errors: FieldError[] = [];
  const list = requireArray(raw, 'environments', errors);
  if (!list) return bad(errors);
  const min = profile.kind === 'short' ? 1 : 2;
  checkCount(list, 'environments', min, 4, errors, '环境');
  const value: EnvPayload[] = [];
  list.forEach((entry, index) => {
    const item = asObject(entry);
    if (!item) {
      errors.push({ path: `environments[${index}]`, message: '必须是对象' });
      return;
    }
    const name = textOf(item.name);
    const type = textOf(item.type);
    const mood = textOf(item.mood ?? item.atmosphere);
    const reason = textOf(item.reason ?? item.why);
    if (!name) errors.push({ path: `environments[${index}].name`, message: '缺少名称' });
    if (!type) errors.push({ path: `environments[${index}].type`, message: '缺少类型' });
    else if (!ENV_TYPES.includes(type)) errors.push({ path: `environments[${index}].type`, message: `类型必须是 ${ENV_TYPES.join('/')} 之一` });
    if (!mood) errors.push({ path: `environments[${index}].mood`, message: '缺少氛围关键词' });
    if (!reason) errors.push({ path: `environments[${index}].reason`, message: '缺少出场理由' });
    value.push({ name, type, mood, reason });
  });
  return errors.length ? bad(errors) : ok(value);
}

export interface CharacterPayload {
  name: string;
  role: string;
  motivation: string;
  age: string;
  personality: string;
  secret: string;
  tags: string[];
  isProtagonist: boolean;
}

export function validateCharacters(raw: unknown, limit = 20): Validation<CharacterPayload[]> {
  const errors: FieldError[] = [];
  const list = requireArray(raw, 'characters', errors);
  if (!list) return bad(errors);
  checkCount(list, 'characters', 1, limit, errors, '人物');
  const seen = new Set<string>();
  const value: CharacterPayload[] = [];
  list.forEach((entry, index) => {
    const item = asObject(entry);
    if (!item) {
      errors.push({ path: `characters[${index}]`, message: '必须是对象' });
      return;
    }
    const name = textOf(item.name);
    const role = textOf(item.role);
    const motivation = textOf(item.motivation ?? item.goal);
    if (!name) errors.push({ path: `characters[${index}].name`, message: '缺少姓名' });
    else if (PLACEHOLDER.test(name)) errors.push({ path: `characters[${index}].name`, message: `「${name}」是占位名，请给出真实姓名` });
    else if (seen.has(name)) errors.push({ path: `characters[${index}].name`, message: `人物「${name}」重复` });
    else seen.add(name);
    if (!role) errors.push({ path: `characters[${index}].role`, message: '缺少身份' });
    if (!motivation) errors.push({ path: `characters[${index}].motivation`, message: '缺少动机' });
    value.push({
      name,
      role,
      motivation,
      age: textOf(item.age),
      personality: textOf(item.personality ?? item.description),
      secret: textOf(item.secret),
      tags: Array.isArray(item.tags) ? item.tags.map(textOf).filter(Boolean) : [],
      isProtagonist: item.isProtagonist === true || /主角|protagonist/i.test(role),
    });
  });
  if (!value.some((item) => item.isProtagonist)) errors.push({ path: 'characters', message: '至少要有一个主角（role 里写明「主角」或 isProtagonist=true）' });
  return errors.length ? bad(errors) : ok(value);
}

// ---------------------------------------------------------------------------
// P2
// ---------------------------------------------------------------------------

export interface ActPayload {
  title: string;
  function: string;
  summary: string;
  characters: string[];
}

const FUNCTIONS = ['钩子', '推进', '转折', '揭示', '高潮', '收束', '缓冲'];

export function validateActs(raw: unknown, profile: KindProfile): Validation<ActPayload[]> {
  const errors: FieldError[] = [];
  const list = requireArray(raw, 'acts', errors);
  if (!list) return bad(errors);
  checkCount(list, 'acts', profile.actRange[0], profile.actRange[1], errors, profile.actLabel);
  const value: ActPayload[] = [];
  list.forEach((entry, index) => {
    const item = asObject(entry);
    if (!item) {
      errors.push({ path: `acts[${index}]`, message: '必须是对象' });
      return;
    }
    const title = textOf(item.title);
    const fn = textOf(item.function ?? item.actFunction);
    const summary = textOf(item.summary);
    if (!title) errors.push({ path: `acts[${index}].title`, message: '缺少标题' });
    if (!fn) errors.push({ path: `acts[${index}].function`, message: '缺少功能' });
    else if (!FUNCTIONS.includes(fn)) errors.push({ path: `acts[${index}].function`, message: `功能必须是 ${FUNCTIONS.join('/')} 之一` });
    if (!summary) errors.push({ path: `acts[${index}].summary`, message: '缺少摘要' });
    else if (summary.length < 15) errors.push({ path: `acts[${index}].summary`, message: '摘要不足 15 字' });
    value.push({ title, function: fn, summary, characters: Array.isArray(item.characters) ? item.characters.map(textOf).filter(Boolean) : [] });
  });
  return errors.length ? bad(errors) : ok(value);
}

export interface BeatPayload {
  title: string;
  function: string;
  summary: string;
  plannedChapters: number;
  foreshadow: string;
}

export function validateBeats(raw: unknown, act: ActPayload | null, profile: KindProfile): Validation<BeatPayload[]> {
  const errors: FieldError[] = [];
  const list = requireArray(raw, 'beats', errors);
  if (!list) return bad(errors);
  checkCount(list, 'beats', profile.beatRange[0], profile.beatRange[1], errors, profile.beatLabel);
  const value: BeatPayload[] = [];
  list.forEach((entry, index) => {
    const item = asObject(entry);
    if (!item) {
      errors.push({ path: `beats[${index}]`, message: '必须是对象' });
      return;
    }
    const title = textOf(item.title);
    const fn = textOf(item.function ?? item.beatFunction);
    const summary = textOf(item.summary);
    const planned = intOf(item.plannedChapters ?? item.chapters) ?? 1;
    if (!title) errors.push({ path: `beats[${index}].title`, message: '缺少标题' });
    if (!fn) errors.push({ path: `beats[${index}].function`, message: '缺少功能' });
    else if (!FUNCTIONS.includes(fn)) errors.push({ path: `beats[${index}].function`, message: `功能必须是 ${FUNCTIONS.join('/')} 之一` });
    if (!summary) errors.push({ path: `beats[${index}].summary`, message: '缺少摘要' });
    if (planned < 1) errors.push({ path: `beats[${index}].plannedChapters`, message: '预计章节数必须 ≥1' });
    value.push({ title, function: fn, summary, plannedChapters: planned, foreshadow: textOf(item.foreshadow ?? item.payoff) });
  });
  if (!errors.length && act && value.length && !value.some((beat) => beat.summary.length >= 10)) {
    errors.push({ path: 'beats', message: '节拍摘要都太短' });
  }
  return errors.length ? bad(errors) : ok(value);
}

// ---------------------------------------------------------------------------
// P3
// ---------------------------------------------------------------------------

export interface ChapterPlanPayload {
  title: string;
  function: string;
  synopsis: string;
  minWords: number;
  targetWords: number;
  maxWords: number;
  characters: string[];
}

export function validateChapterPlan(raw: unknown, limit: number, profile: KindProfile): Validation<ChapterPlanPayload[]> {
  const errors: FieldError[] = [];
  const list = requireArray(raw, profile.kind === 'short' ? 'beats' : 'chapters', errors);
  if (!list) return bad(errors);
  checkCount(list, profile.kind === 'short' ? 'beats' : 'chapters', 1, limit, errors, profile.unitLabel);
  const value: ChapterPlanPayload[] = [];
  list.forEach((entry, index) => {
    const item = asObject(entry);
    if (!item) {
      errors.push({ path: `units[${index}]`, message: '必须是对象' });
      return;
    }
    const title = textOf(item.title);
    const fn = textOf(item.function ?? item.planFunction);
    const synopsis = textOf(item.synopsis ?? item.outline);
    const minWords = intOf(item.minWords) ?? DEFAULT_WORD_RANGE.minWords;
    const targetWords = intOf(item.targetWords) ?? DEFAULT_WORD_RANGE.targetWords;
    const maxWords = intOf(item.maxWords) ?? DEFAULT_WORD_RANGE.maxWords;
    if (!title) errors.push({ path: `units[${index}].title`, message: '缺少标题' });
    if (!fn) errors.push({ path: `units[${index}].function`, message: '缺少功能' });
    if (!synopsis) errors.push({ path: `units[${index}].synopsis`, message: '缺少大纲' });
    else if (synopsis.length < 15) errors.push({ path: `units[${index}].synopsis`, message: '大纲不足 15 字' });
    if (!(DEFAULT_WORD_RANGE.minWordsFloor <= minWords)) errors.push({ path: `units[${index}].minWords`, message: `最小字数不得小于 ${DEFAULT_WORD_RANGE.minWordsFloor}` });
    if (!(minWords <= targetWords && targetWords <= maxWords)) errors.push({ path: `units[${index}]`, message: '字数范围必须满足 min ≤ target ≤ max' });
    if (!(maxWords <= DEFAULT_WORD_RANGE.maxWordsCeiling)) errors.push({ path: `units[${index}].maxWords`, message: `最大字数不得超过 ${DEFAULT_WORD_RANGE.maxWordsCeiling}` });
    value.push({ title, function: fn, synopsis, minWords, targetWords, maxWords, characters: Array.isArray(item.characters) ? item.characters.map(textOf).filter(Boolean) : [] });
  });
  return errors.length ? bad(errors) : ok(value);
}

// ---------------------------------------------------------------------------
// P4
// ---------------------------------------------------------------------------

const PLACEHOLDER_TAIL = /(（未完）|\(未完\)|待续|\[续\]|未完待续|to be continued)/i;

export function validateChapterText(text: string, minWords: number): Validation<string> {
  const errors: FieldError[] = [];
  const body = String(text || '').trim();
  if (!body) errors.push({ path: 'text', message: '模型返回了空正文' });
  if (PLACEHOLDER_TAIL.test(body)) errors.push({ path: 'text', message: '正文里出现「未完/待续」占位，视为截断' });
  if (!errors.length && minWords > 0 && body.length < Math.max(200, minWords * 0.3)) errors.push({ path: 'text', message: '正文明显过短' });
  return errors.length ? bad(errors) : ok(body);
}

/** 正文类的宽松解析：模型可能给纯文本，也可能包一层 {"text": "..."}。 */
export function parseProseResponse(text: string): string {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{')) {
    const parsed = parseJsonResponse(trimmed);
    const value = parsed.ok ? (parsed.value as Record<string, unknown> | undefined) : undefined;
    const candidate = value?.text ?? value?.content ?? value?.body;
    if (typeof candidate === 'string') return candidate.trim();
  }
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

export function formatErrors(errors: FieldError[]): string {
  return errors.slice(0, 6).map((error) => `${error.path}: ${error.message}`).join('; ');
}
