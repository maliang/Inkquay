import { db, countWords, now, uid } from './db.ts';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.ts';
import type {
  AppSettings,
  Chapter,
  ChapterVersion,
  ChapterPatch,
  Character,
  ChatMessage,
  Foreshadow,
  ModelInfo,
  OutlineAct,
  OutlineBeat,
  ProjectBundle,
  ProjectDetail,
  ProjectSummary,
  ProviderInfo,
  ProjectPlan,
  Scene,
  Shot,
} from '../shared/types.ts';

type Row = Record<string, any>;

const DEFAULT_SETTINGS: AppSettings = {
  profile: { name: '', signature: '' },
  onboarding: { completed: false },
  appearance: { theme: 'ink', accent: 'cinnabar', customAccent: null, editorSize: 17.5, reduceMotion: false },
  prefs: { pov: '第三人称限知', genre: '悬疑 · 文学', aiLength: '中 · 约 500 字', autoSave: true, style: '克制留白' },
  generation: { temperature: 0.8, streaming: true },
  defaultModel: null,
  fallbackModel: null,
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function projectSummary(row: Row): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    genre: row.genre,
    description: row.description,
    cover: row.cover,
    status: row.status,
    totalWords: Number(row.total_words || 0),
    goalWords: Number(row.goal_words || 300000),
    chapterCount: Number(row.chapter_count || 0),
    sceneCount: Number(row.scene_count || 0),
    shotCount: Number(row.shot_count || 0),
    updatedAt: row.updated_at,
  };
}

function chapterFromRow(row: Row): Chapter {
  return {
    id: row.id,
    projectId: row.project_id,
    volume: row.volume,
    number: row.number,
    title: row.title,
    content: row.content,
    status: row.status,
    sortOrder: Number(row.sort_order),
    words: Number(row.words),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function characterFromRow(row: Row): Character {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    role: row.role,
    age: row.age,
    avatar: row.avatar,
    tags: parseJson<string[]>(row.tags, []),
    quote: row.quote,
    description: row.description,
    secret: row.secret,
    relations: parseJson(row.relations, []),
    sortOrder: Number(row.sort_order),
  };
}

function beatFromRow(row: Row): OutlineBeat {
  return {
    id: row.id,
    projectId: row.project_id,
    actId: row.act_id,
    chapterNo: Number(row.chapter_no),
    title: row.title,
    summary: row.summary,
    tags: parseJson<string[]>(row.tags, []),
    status: row.status,
    sortOrder: Number(row.sort_order),
  };
}

function sceneFromRow(row: Row): Scene {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    groupName: row.group_name,
    place: row.place,
    time: row.time,
    heading: row.heading,
    content: row.content,
    status: row.status,
    sortOrder: Number(row.sort_order),
  };
}

function versionFromRow(row: Row): ChapterVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    source: row.source,
    title: row.title,
    content: row.content,
    words: Number(row.words),
    createdAt: row.created_at,
  };
}

function shotFromRow(row: Row): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    shotNo: row.shot_no,
    shotType: row.shot_type,
    camera: row.camera,
    duration: row.duration,
    description: row.description,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
  };
}

/** 作品摘要的计数列：列表与详情共用一份，避免两处 SQL 漂移。 */
const SUMMARY_COUNTS = `
    (SELECT COUNT(*) FROM chapters c WHERE c.project_id = p.id AND c.deleted_at IS NULL) AS chapter_count,
    (SELECT COUNT(*) FROM scenes s WHERE s.project_id = p.id) AS scene_count,
    (SELECT COUNT(*) FROM shots s WHERE s.project_id = p.id) AS shot_count`;

export function listProjects(): ProjectSummary[] {
  const rows = db.prepare(`
    SELECT p.*, ${SUMMARY_COUNTS}
    FROM projects p
    ORDER BY p.updated_at DESC
  `).all() as Row[];
  return rows.map(projectSummary);
}

export function getProjectDetail(id: string): ProjectDetail | null {
  const row = db.prepare(`
    SELECT p.*, ${SUMMARY_COUNTS}
    FROM projects p WHERE p.id = ?
  `).get(id) as Row | undefined;
  if (!row) return null;
  const chapters = (db.prepare('SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC').all(id) as Row[]).map(chapterFromRow);
  const characters = (db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order ASC').all(id) as Row[]).map(characterFromRow);
  const acts = (db.prepare('SELECT * FROM outline_acts WHERE project_id = ? ORDER BY sort_order ASC').all(id) as Row[]).map((a) => ({
    id: a.id, projectId: a.project_id, title: a.title, summary: a.summary, sortOrder: Number(a.sort_order),
  })) as OutlineAct[];
  const beats = (db.prepare('SELECT * FROM outline_beats WHERE project_id = ? ORDER BY sort_order ASC').all(id) as Row[]).map(beatFromRow);
  const scenes = (db.prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order ASC').all(id) as Row[]).map(sceneFromRow);
  const shots = (db.prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY sort_order ASC').all(id) as Row[]).map(shotFromRow);
  const foreshadows = (db.prepare('SELECT * FROM foreshadows WHERE project_id = ? ORDER BY sort_order ASC').all(id) as Row[]).map((f) => ({
    id: f.id, projectId: f.project_id, name: f.name, planted: f.planted, payoff: f.payoff, status: f.status,
  })) as Foreshadow[];
  return {
    ...projectSummary(row),
    createdAt: row.created_at,
    chapters,
    characters,
    outline: { acts, beats },
    scenes,
    shots,
    foreshadows,
  };
}

export function getChapter(id: string): Chapter | null {
  const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Row | undefined;
  return row ? chapterFromRow(row) : null;
}

export function updateChapter(id: string, patch: ChapterPatch): Chapter | null {
  const existing = getChapter(id);
  if (!existing || existing.deletedAt) return null;
  const next = {
    title: patch.title ?? existing.title,
    content: patch.content ?? existing.content,
    status: patch.status ?? existing.status,
    volume: patch.volume ?? existing.volume,
    number: patch.number ?? existing.number,
  };
  const words = countWords(next.content);
  const stamp = now();
  db.prepare(`UPDATE chapters SET title = ?, content = ?, status = ?, volume = ?, number = ?, words = ?, updated_at = ? WHERE id = ?`)
    .run(next.title, next.content, next.status, next.volume, next.number, words, stamp, id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(stamp, existing.projectId);
  recalculateProjectWords(existing.projectId);
  return getChapter(id);
}

export function createChapter(projectId: string, input: { title?: string; volume?: string; number?: string; content?: string }): Chapter {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM chapters WHERE project_id = ?').get(projectId) as Row;
  const content = input.content || '';
  const stamp = now();
  const id = uid('ch');
  const chapter: Chapter = {
    id,
    projectId,
    volume: input.volume || '第一卷',
    number: input.number || '新章节',
    title: input.title || '未命名章节',
    content,
    status: '草稿',
    sortOrder: Number(row.max) + 1,
    words: countWords(content),
    updatedAt: stamp,
  };
  db.prepare(`INSERT INTO chapters (id, project_id, volume, number, title, content, status, sort_order, words, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(chapter.id, chapter.projectId, chapter.volume, chapter.number, chapter.title, chapter.content, chapter.status, chapter.sortOrder, chapter.words, chapter.updatedAt);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(stamp, projectId);
  recalculateProjectWords(projectId);
  return chapter;
}

export function recalculateProjectWords(projectId: string) {
  const row = db.prepare('SELECT COALESCE(SUM(words), 0) AS words FROM chapters WHERE project_id = ? AND deleted_at IS NULL').get(projectId) as Row;
  db.prepare('UPDATE projects SET total_words = ? WHERE id = ?').run(Number(row.words), projectId);
}

export function createProject(input: { title: string; type: string; genre?: string; description?: string; goalWords?: number }): ProjectDetail {
  const id = uid('p');
  const stamp = now();
  const cover = input.type === 'screenplay' ? 'echo' : input.type === 'short' ? 'ferry' : 'fog';
  db.prepare(`INSERT INTO projects (id, title, type, genre, description, cover, status, total_words, goal_words, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(id, input.title, input.type, input.genre || '', input.description || '', cover, '草稿', input.goalWords || (input.type === 'short' ? 12000 : 300000), stamp, stamp);
  ['第一幕', '第二幕', '第三幕'].forEach((title, index) => {
    db.prepare('INSERT INTO outline_acts (id, project_id, title, summary, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(uid('act'), id, title, '', index);
  });
  if (input.type === 'screenplay') {
    db.prepare(`INSERT INTO scenes (id, project_id, number, group_name, place, time, heading, content, status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid('scene'), id, '1', '第一幕', '未命名场景', '日', '1. 内景 · 未命名场景 · 日', '', '草稿', 0);
  } else {
    createChapter(id, { title: '未命名章节', volume: '第一卷', number: '第一章' });
  }
  return getProjectDetail(id)!;
}

export function updateProject(id: string, patch: { title?: string; genre?: string; description?: string; status?: string; goalWords?: number }) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db.prepare('UPDATE projects SET title = ?, genre = ?, description = ?, status = ?, goal_words = ?, updated_at = ? WHERE id = ?')
    .run(patch.title ?? row.title, patch.genre ?? row.genre, patch.description ?? row.description, patch.status ?? row.status, patch.goalWords ?? row.goal_words, now(), id);
  return getProjectDetail(id);
}

export function getSettings(): AppSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as Row | undefined;
  const stored = parseJson<Partial<AppSettings>>(row?.value, {});
  return {
    profile: { ...DEFAULT_SETTINGS.profile, ...(stored.profile || {}) },
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...(stored.onboarding || {}) },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(stored.appearance || {}) },
    prefs: { ...DEFAULT_SETTINGS.prefs, ...(stored.prefs || {}) },
    generation: { ...DEFAULT_SETTINGS.generation, ...(stored.generation || {}) },
    defaultModel: stored.defaultModel ?? DEFAULT_SETTINGS.defaultModel,
    fallbackModel: stored.fallbackModel ?? DEFAULT_SETTINGS.fallbackModel,
  };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = {
    profile: { ...getSettings().profile, ...(patch.profile || {}) },
    onboarding: { ...getSettings().onboarding, ...(patch.onboarding || {}) },
    appearance: { ...getSettings().appearance, ...(patch.appearance || {}) },
    prefs: { ...getSettings().prefs, ...(patch.prefs || {}) },
    generation: { ...getSettings().generation, ...(patch.generation || {}) },
    defaultModel: patch.defaultModel !== undefined ? patch.defaultModel : getSettings().defaultModel,
    fallbackModel: patch.fallbackModel !== undefined ? patch.fallbackModel : getSettings().fallbackModel,
  };
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(next));
  return next;
}

function providerInfo(row: Row, settings: AppSettings): ProviderInfo {
  const models = parseJson<ModelInfo[]>(row.models, []);
  const enabledModels = parseJson<string[]>(row.enabled_models, []);
  const key = decryptSecret(row.api_key_enc);
  const configured = row.id === 'mock' || Boolean(key);
  return {
    id: row.id,
    name: row.name,
    family: row.family,
    kind: row.kind,
    mark: row.mark,
    brand: row.brand,
    baseUrl: row.base_url,
    configured,
    enabled: Boolean(row.enabled),
    apiKeyMasked: row.id === 'mock' ? '内置模型，无需密钥' : maskSecret(key),
    models,
    enabledModels,
    defaultModel: enabledModels[0] || models[0]?.id || '',
    isDefault: settings.defaultModel?.providerId === row.id,
  };
}

export function listProviders(): ProviderInfo[] {
  const settings = getSettings();
  const rows = db.prepare('SELECT * FROM providers ORDER BY is_default DESC, name ASC').all() as Row[];
  return rows.map((row) => providerInfo(row, settings));
}

export function getProviderRow(id: string): Row | undefined {
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Row | undefined;
}

/**
 * 供应商当前可用的模型 id：勾选过 enabledModels 就以它为准，从未勾选过则回退到全量 models。
 * 用于在发起 AI 请求前判断「模型是否真的在这个供应商里可用」，避免带错模型打到接口上。
 */
export function providerModelIds(id: string): string[] {
  const row = getProviderRow(id);
  if (!row) return [];
  const enabled = parseJson<string[]>(row.enabled_models, []);
  return enabled.length ? enabled : parseJson<ModelInfo[]>(row.models, []).map((m) => m.id);
}

export function getProviderSecret(id: string): string {
  const row = getProviderRow(id);
  return row ? decryptSecret(row.api_key_enc) : '';
}

export function updateProvider(id: string, patch: {
  name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean;
  enabledModels?: string[]; models?: ModelInfo[];
}) {
  const row = getProviderRow(id);
  if (!row) return null;
  const keyEnc = patch.apiKey === undefined ? row.api_key_enc : (patch.apiKey ? encryptSecret(patch.apiKey) : null);
  db.prepare(`UPDATE providers SET name = ?, base_url = ?, api_key_enc = ?, enabled = ?, enabled_models = ?, models = ?, updated_at = ? WHERE id = ?`)
    .run(
      patch.name ?? row.name,
      patch.baseUrl ?? row.base_url,
      keyEnc,
      patch.enabled === undefined ? row.enabled : Number(patch.enabled),
      JSON.stringify(patch.enabledModels ?? parseJson(row.enabled_models, [])),
      JSON.stringify(patch.models ?? parseJson(row.models, [])),
      now(),
      id,
    );
  return listProviders().find((p) => p.id === id) || null;
}

export function createProvider(input: { name: string; kind?: string; baseUrl?: string; apiKey?: string; models?: ModelInfo[]; enabledModels?: string[] }) {
  const id = uid('prov');
  const stamp = now();
  const models = input.models || [{ id: 'custom-model', name: 'custom-model', ctx: '自定义', tags: ['OpenAI 兼容'] }];
  db.prepare(`INSERT INTO providers (id, name, family, kind, mark, brand, base_url, api_key_enc, models, enabled_models, enabled, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, input.name, '自定义', input.kind || 'openai', input.name.slice(0, 1) || 'C', '#9a8fc4', input.baseUrl || '',
      input.apiKey ? encryptSecret(input.apiKey) : null, JSON.stringify(models), JSON.stringify(input.enabledModels || [models[0].id]), input.apiKey ? 1 : 0, stamp, stamp);
  return listProviders().find((p) => p.id === id) || null;
}

export async function testProviderConnection(id: string): Promise<{ ok: boolean; message: string; models?: string[] }> {
  const row = getProviderRow(id);
  if (!row) return { ok: false, message: '供应商不存在' };
  if (row.kind === 'mock') return { ok: true, message: '本地演示模型无需连接' };
  const key = decryptSecret(row.api_key_enc);
  if (!key) return { ok: false, message: '请先填写 API Key' };
  const base = String(row.base_url || '').replace(/\/+$/, '');
  if (!base) return { ok: false, message: '请先填写 Base URL' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let url = `${base}/models`;
    const headers: Record<string, string> = {};
    if (row.kind === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (row.kind === 'google') {
      url = `${base}/models?key=${encodeURIComponent(key)}`;
    } else {
      headers.Authorization = `Bearer ${key}`;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: `连接失败：HTTP ${response.status} ${(data as any)?.error?.message || ''}`.trim() };
    }
    const models = Array.isArray((data as any)?.data)
      ? (data as any).data.map((m: any) => m.id).filter(Boolean)
      : Array.isArray((data as any)?.models)
        ? (data as any).models.map((m: any) => m.name || m.id).filter(Boolean)
        : [];
    return { ok: true, message: models.length ? `连接成功，发现 ${models.length} 个模型` : '连接成功', models };
  } catch (error) {
    return { ok: false, message: `连接失败：${error instanceof Error ? error.message : '网络错误'}` };
  } finally {
    clearTimeout(timer);
  }
}

export function listMessages(projectId: string, chapterId?: string | null): ChatMessage[] {
  const rows = chapterId
    ? db.prepare('SELECT * FROM ai_messages WHERE project_id = ? AND chapter_id = ? ORDER BY created_at ASC').all(projectId, chapterId)
    : db.prepare('SELECT * FROM ai_messages WHERE project_id = ? AND chapter_id IS NULL ORDER BY created_at ASC').all(projectId);
  return (rows as Row[]).map((r) => ({
    id: r.id, projectId: r.project_id, chapterId: r.chapter_id, role: r.role, content: r.content,
    status: (r.status as 'complete' | 'aborted') || 'complete', createdAt: r.created_at,
  }));
}

export function saveMessage(input: {
  projectId: string; chapterId?: string | null; role: 'user' | 'assistant'; content: string;
  providerId?: string; modelId?: string; status?: 'complete' | 'aborted';
}): ChatMessage {
  const id = uid('msg');
  const createdAt = now();
  const status = input.status || 'complete';
  db.prepare('INSERT INTO ai_messages (id, project_id, chapter_id, role, content, provider_id, model_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.projectId, input.chapterId || null, input.role, input.content, input.providerId || null, input.modelId || null, status, createdAt);
  return { id, projectId: input.projectId, chapterId: input.chapterId || null, role: input.role, content: input.content, status, createdAt };
}

export function deleteMessage(projectId: string, messageId: string): boolean {
  const result = db.prepare('DELETE FROM ai_messages WHERE id = ? AND project_id = ?').run(messageId, projectId);
  return Number(result.changes) > 0;
}

export function buildWritingContext(projectId: string, chapterId: string | null): string {
  const project = getProjectDetail(projectId);
  if (!project) return '';
  const chapter = chapterId ? project.chapters.find((c) => c.id === chapterId) : null;
  const recent = project.chapters.filter((c) => c.content).slice(-3);
  const beats = project.outline.beats.slice(0, 12);
  const characters = project.characters.slice(0, 8);
  const prefs = getSettings().prefs;
  return [
    `作品：《${project.title}》｜类型：${project.type}｜题材：${project.genre}`,
    `写作偏好：${prefs.pov}｜${prefs.style}｜单次目标 ${prefs.aiLength}`,
    project.description ? `故事梗概：${project.description}` : '',
    `当前章节：${chapter ? `${chapter.volume} ${chapter.number} ${chapter.title}` : '未指定'}`,
    chapter?.content ? `当前正文（节选）：\n${chapter.content.slice(-4000)}` : '',
    characters.length ? `主要人物：\n${characters.map((c) => `- ${c.name}（${c.role}）：${c.description}；秘密：${c.secret}`).join('\n')}` : '',
    beats.length ? `大纲节拍：\n${beats.map((b) => `- 第${b.chapterNo}章 ${b.title}：${b.summary} [${b.status}]`).join('\n')}` : '',
    recent.length ? `最近章节：\n${recent.map((c) => `${c.number} ${c.title}：${c.content.slice(-500)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function exportProjectMarkdown(projectId: string, chapterId?: string | null): string | null {
  const project = getProjectDetail(projectId);
  if (!project) return null;
  const chapter = chapterId ? project.chapters.find((item) => item.id === chapterId) : null;
  if (chapterId && !chapter) return null;
  const scopedTitle = chapter ? `${project.title} · ${chapter.number} ${chapter.title}` : project.title;
  const lines = [`# ${scopedTitle}`, '', `> ${project.description}`, '', `作者：${getSettings().profile.name}`, ''];
  if (project.type === 'screenplay') {
    project.scenes.forEach((s) => {
      lines.push(`## ${s.heading}`, '', s.content, '');
    });
  } else {
    (chapter ? [chapter] : project.chapters).forEach((c) => {
      lines.push(`## ${c.number} ${c.title}`, '', c.content, '');
    });
  }
  return lines.join('\n');
}

export function updateCharacter(id: string, patch: {
  name?: string; role?: string; age?: string; avatar?: string; tags?: string[];
  quote?: string; description?: string; secret?: string; relations?: Character['relations'];
}): Character | null {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  const current = characterFromRow(row);
  db.prepare(`UPDATE characters SET name = ?, role = ?, age = ?, avatar = ?, tags = ?, quote = ?, description = ?, secret = ?, relations = ? WHERE id = ?`)
    .run(
      patch.name ?? current.name,
      patch.role ?? current.role,
      patch.age ?? current.age,
      patch.avatar ?? current.avatar,
      JSON.stringify(patch.tags ?? current.tags),
      patch.quote ?? current.quote,
      patch.description ?? current.description,
      patch.secret ?? current.secret,
      JSON.stringify(patch.relations ?? current.relations),
      id,
    );
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), current.projectId);
  return characterFromRow(db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row);
}

export function createCharacter(projectId: string, input: {
  name: string; role?: string; age?: string; avatar?: string; tags?: string[];
  quote?: string; description?: string; secret?: string; relations?: Character['relations'];
}): Character {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM characters WHERE project_id = ?').get(projectId) as Row;
  const id = uid('char');
  db.prepare(`INSERT INTO characters (id, project_id, name, role, age, avatar, tags, quote, description, secret, relations, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, input.name, input.role || '', input.age || '', input.avatar || input.name.slice(0, 1),
      JSON.stringify(input.tags || []), input.quote || '', input.description || '', input.secret || '',
      JSON.stringify(input.relations || []), Number(row.max) + 1);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
  return characterFromRow(db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row);
}

export function updateBeat(id: string, patch: {
  title?: string; summary?: string; chapterNo?: number; tags?: string[]; status?: string; actId?: string;
}): OutlineBeat | null {
  const row = db.prepare('SELECT * FROM outline_beats WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  const current = beatFromRow(row);
  db.prepare('UPDATE outline_beats SET title = ?, summary = ?, chapter_no = ?, tags = ?, status = ?, act_id = ? WHERE id = ?')
    .run(
      patch.title ?? current.title,
      patch.summary ?? current.summary,
      patch.chapterNo ?? current.chapterNo,
      JSON.stringify(patch.tags ?? current.tags),
      patch.status ?? current.status,
      patch.actId ?? current.actId,
      id,
    );
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), current.projectId);
  return beatFromRow(db.prepare('SELECT * FROM outline_beats WHERE id = ?').get(id) as Row);
}

export function createBeat(projectId: string, input: {
  actId: string; title: string; chapterNo: number; summary?: string; tags?: string[]; status?: string;
}): OutlineBeat {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM outline_beats WHERE project_id = ?').get(projectId) as Row;
  const id = uid('beat');
  db.prepare(`INSERT INTO outline_beats (id, project_id, act_id, chapter_no, title, summary, tags, status, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, input.actId, input.chapterNo, input.title, input.summary || '', JSON.stringify(input.tags || []), input.status || '待写', Number(row.max) + 1);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
  return beatFromRow(db.prepare('SELECT * FROM outline_beats WHERE id = ?').get(id) as Row);
}

export function updateScene(id: string, patch: {
  heading?: string; content?: string; place?: string; time?: string; status?: string; number?: string; groupName?: string;
}): Scene | null {
  const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  const current = sceneFromRow(row);
  db.prepare('UPDATE scenes SET heading = ?, content = ?, place = ?, time = ?, status = ?, number = ?, group_name = ? WHERE id = ?')
    .run(
      patch.heading ?? current.heading,
      patch.content ?? current.content,
      patch.place ?? current.place,
      patch.time ?? current.time,
      patch.status ?? current.status,
      patch.number ?? current.number,
      patch.groupName ?? current.groupName,
      id,
    );
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), current.projectId);
  return sceneFromRow(db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Row);
}

export function createScene(projectId: string, input: {
  number: string; groupName?: string; place?: string; time?: string; heading?: string; content?: string; status?: string;
}): Scene {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM scenes WHERE project_id = ?').get(projectId) as Row;
  const id = uid('scene');
  const number = input.number;
  const place = input.place || '未命名场景';
  const time = input.time || '日';
  db.prepare(`INSERT INTO scenes (id, project_id, number, group_name, place, time, heading, content, status, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, number, input.groupName || '第一幕', place, time,
      input.heading || `${number}. 内景 · ${place} · ${time}`, input.content || '', input.status || '草稿', Number(row.max) + 1);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
  return sceneFromRow(db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Row);
}

export function updateForeshadow(id: string, patch: { name?: string; planted?: string; payoff?: string; status?: string }): Foreshadow | null {
  const row = db.prepare('SELECT * FROM foreshadows WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db.prepare('UPDATE foreshadows SET name = ?, planted = ?, payoff = ?, status = ? WHERE id = ?')
    .run(patch.name ?? row.name, patch.planted ?? row.planted, patch.payoff ?? row.payoff, patch.status ?? row.status, id);
  return { id, projectId: row.project_id, name: patch.name ?? row.name, planted: patch.planted ?? row.planted, payoff: patch.payoff ?? row.payoff, status: patch.status ?? row.status };
}

export function createForeshadow(projectId: string, input: { name: string; planted?: string; payoff?: string; status?: string }): Foreshadow {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM foreshadows WHERE project_id = ?').get(projectId) as Row;
  const id = uid('fore');
  db.prepare('INSERT INTO foreshadows (id, project_id, name, planted, payoff, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, input.name, input.planted || '', input.payoff || '', input.status || '待回收', Number(row.max) + 1);
  return { id, projectId, name: input.name, planted: input.planted || '', payoff: input.payoff || '', status: input.status || '待回收' };
}

export function deleteBeat(id: string): boolean {
  const row = db.prepare('SELECT * FROM outline_beats WHERE id = ?').get(id) as Row | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM outline_beats WHERE id = ?').run(id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), row.project_id);
  return true;
}

export function reorderBeats(projectId: string, beatIds: string[]): OutlineBeat[] {
  const stamp = now();
  beatIds.forEach((id, index) => {
    db.prepare('UPDATE outline_beats SET sort_order = ? WHERE id = ? AND project_id = ?').run(index, id, projectId);
  });
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(stamp, projectId);
  return (db.prepare('SELECT * FROM outline_beats WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as Row[]).map(beatFromRow);
}


export function updateShot(id: string, patch: { shotNo?: string; shotType?: string; camera?: string; duration?: string; description?: string; notes?: string }): Shot | null {
  const row = db.prepare('SELECT * FROM shots WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  const current = shotFromRow(row);
  db.prepare('UPDATE shots SET shot_no = ?, shot_type = ?, camera = ?, duration = ?, description = ?, notes = ? WHERE id = ?')
    .run(patch.shotNo ?? current.shotNo, patch.shotType ?? current.shotType, patch.camera ?? current.camera,
      patch.duration ?? current.duration, patch.description ?? current.description, patch.notes ?? current.notes, id);
  return shotFromRow(db.prepare('SELECT * FROM shots WHERE id = ?').get(id) as Row);
}

export function createShot(input: {
  projectId: string; sceneId: string; shotNo: string; shotType?: string; camera?: string;
  duration?: string; description?: string; notes?: string;
}): Shot {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM shots WHERE scene_id = ?').get(input.sceneId) as Row;
  const id = uid('shot');
  db.prepare(`INSERT INTO shots (id, project_id, scene_id, shot_no, shot_type, camera, duration, description, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.projectId, input.sceneId, input.shotNo, input.shotType || '中景', input.camera || '定镜',
      input.duration || '3s', input.description || '', input.notes || '', Number(row.max) + 1);
  return shotFromRow(db.prepare('SELECT * FROM shots WHERE id = ?').get(id) as Row);
}

export function generateShotsForScene(sceneId: string): Shot[] {
  const existing = db.prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order ASC').all(sceneId) as Row[];
  if (existing.length) return existing.map(shotFromRow);
  const sceneRow = db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId) as Row | undefined;
  if (!sceneRow) return [];
  const scene = sceneFromRow(sceneRow);
  const templates = [
    ['01', '全景', '缓慢推进', '6s', `${scene.place}`, '交代空间与光源，让观众先感到不安。'],
    ['02', '中景', '横移', '4s', '人物进入空间', '用移动建立人物与环境的距离。'],
    ['03', '特写', '定镜', '2s', '关键道具', '只给一个读者需要记住的细节。'],
    ['04', '近景', '手持', '3s', '人物眼神', '让反应先于台词。'],
    ['05', '过肩', '缓慢环绕', '5s', '人物对峙', '把关系张力放进画面。'],
    ['06', '特写', '定镜', '2s', '声音 / 光线', '用声音或光完成场景转折。'],
  ];
  return templates.map((t) => createShot({
    projectId: scene.projectId, sceneId, shotNo: t[0], shotType: t[1], camera: t[2], duration: t[3], description: t[4], notes: t[5],
  }));
}

export function deleteProject(id: string): boolean {
  const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as Row | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return true;
}

export function deleteChapter(id: string): { projectId: string; versions: number } | null {
  const chapter = getChapter(id);
  if (!chapter || chapter.deletedAt) return null;
  const row = db.prepare('SELECT COUNT(*) AS count FROM chapter_versions WHERE chapter_id = ?').get(id) as Row;
  const stamp = now();
  db.prepare('UPDATE chapters SET deleted_at = ?, updated_at = ? WHERE id = ?').run(stamp, stamp, id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(stamp, chapter.projectId);
  recalculateProjectWords(chapter.projectId);
  return { projectId: chapter.projectId, versions: Number(row.count) || 0 };
}

export function listDeletedChapters(projectId: string): Chapter[] {
  return (db.prepare('SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(projectId) as Row[]).map(chapterFromRow);
}

export function restoreChapter(id: string): { projectId: string; chapter: Chapter } | null {
  const chapter = getChapter(id);
  if (!chapter || !chapter.deletedAt) return null;
  const stamp = now();
  db.prepare('UPDATE chapters SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(stamp, id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(stamp, chapter.projectId);
  recalculateProjectWords(chapter.projectId);
  const restored = getChapter(id);
  return restored ? { projectId: chapter.projectId, chapter: restored } : null;
}

export function purgeChapter(id: string): { projectId: string; versions: number } | null {
  const chapter = getChapter(id);
  if (!chapter || !chapter.deletedAt) return null;
  const row = db.prepare('SELECT COUNT(*) AS count FROM chapter_versions WHERE chapter_id = ?').get(id) as Row;
  db.prepare('DELETE FROM chapters WHERE id = ?').run(id);
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), chapter.projectId);
  recalculateProjectWords(chapter.projectId);
  return { projectId: chapter.projectId, versions: Number(row.count) || 0 };
}

export function deleteCharacter(id: string): string | null {
  const row = db.prepare('SELECT project_id FROM characters WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  return String(row.project_id);
}

export function deleteScene(id: string): string | null {
  const row = db.prepare('SELECT project_id FROM scenes WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
  return String(row.project_id);
}

export function deleteShot(id: string): string | null {
  const row = db.prepare('SELECT project_id FROM shots WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM shots WHERE id = ?').run(id);
  return String(row.project_id);
}

export function deleteForeshadow(id: string): string | null {
  const row = db.prepare('SELECT project_id FROM foreshadows WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM foreshadows WHERE id = ?').run(id);
  return String(row.project_id);
}

export function exportProjectBundle(projectId: string): ProjectBundle | null {
  const project = getProjectDetail(projectId);
  if (!project) return null;
  return {
    format: 'inkquay.project',
    version: 1,
    exportedAt: now(),
    project: {
      title: project.title,
      type: project.type,
      genre: project.genre,
      description: project.description,
      cover: project.cover,
      status: project.status,
      goalWords: project.goalWords,
      chapters: project.chapters,
      characters: project.characters,
      outline: project.outline,
      scenes: project.scenes,
      shots: project.shots,
      foreshadows: project.foreshadows,
      versions: db.prepare(
        'SELECT v.id, v.project_id AS projectId, v.chapter_id AS chapterId, v.source, v.title, v.content, v.words, v.created_at AS createdAt FROM chapter_versions v JOIN chapters c ON c.id = v.chapter_id WHERE v.project_id = ? AND c.deleted_at IS NULL ORDER BY v.created_at ASC',
      ).all(projectId) as unknown as ChapterVersion[],
    },
  };
}

export function importProjectBundle(bundle: ProjectBundle): ProjectDetail {
  if (!bundle || bundle.format !== 'inkquay.project' || bundle.version !== 1 || !bundle.project) {
    throw new Error('不是有效的 Inkquay 项目备份');
  }
  const source = bundle.project;
  if (!source.title?.trim()) throw new Error('备份缺少作品名');
  const type = ['novel', 'short', 'screenplay', 'series'].includes(source.type) ? source.type : 'novel';
  const project = createProject({
    title: source.title.trim(),
    type,
    genre: source.genre || '',
    description: source.description || '',
    goalWords: Number(source.goalWords) || undefined,
  });
  const stamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM chapters WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM outline_beats WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM outline_acts WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM characters WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM shots WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM foreshadows WHERE project_id = ?').run(project.id);

    const chapterMap = new Map<string, string>();
    (source.chapters || []).forEach((chapter, index) => {
      const id = uid('ch');
      if (chapter.id) chapterMap.set(chapter.id, id);
      const content = chapter.content || '';
      db.prepare(`INSERT INTO chapters (id, project_id, volume, number, title, content, status, sort_order, words, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, project.id, chapter.volume || '第一卷', chapter.number || `第${index + 1}章`, chapter.title || '未命名章节',
          content, chapter.status || '草稿', index, countWords(content), stamp);
    });

    (source.versions || []).forEach((version) => {
      const chapterId = chapterMap.get(version.chapterId);
      if (!chapterId || typeof version.content !== 'string') return;
      db.prepare(`INSERT INTO chapter_versions (id, project_id, chapter_id, source, title, content, words, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid('ver'), project.id, chapterId, version.source || '导入', version.title || '未命名章节',
          version.content, countWords(version.content), version.createdAt || stamp);
    });

    (source.characters || []).forEach((character, index) => {
      db.prepare(`INSERT INTO characters (id, project_id, name, role, age, avatar, tags, quote, description, secret, relations, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid('char'), project.id, character.name || '未命名人物', character.role || '', character.age || '',
          character.avatar || (character.name || '人').slice(0, 1), JSON.stringify(character.tags || []),
          character.quote || '', character.description || '', character.secret || '',
          JSON.stringify(character.relations || []), index);
    });

    const actMap = new Map<string, string>();
    (source.outline?.acts || []).forEach((act, index) => {
      const id = uid('act');
      if (act.id) actMap.set(act.id, id);
      db.prepare('INSERT INTO outline_acts (id, project_id, title, summary, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(id, project.id, act.title || `第${index + 1}幕`, act.summary || '', index);
    });
    (source.outline?.beats || []).forEach((beat, index) => {
      const actId = actMap.get(beat.actId) || (source.outline?.acts?.[0]?.id ? actMap.get(source.outline.acts[0].id) : undefined);
      if (!actId) return;
      db.prepare(`INSERT INTO outline_beats (id, project_id, act_id, chapter_no, title, summary, tags, status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid('beat'), project.id, actId, Number(beat.chapterNo) || index + 1, beat.title || '未命名场景',
          beat.summary || '', JSON.stringify(beat.tags || []), beat.status || '待写', index);
    });

    const sceneMap = new Map<string, string>();
    (source.scenes || []).forEach((scene, index) => {
      const id = uid('scene');
      if (scene.id) sceneMap.set(scene.id, id);
      db.prepare(`INSERT INTO scenes (id, project_id, number, group_name, place, time, heading, content, status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, project.id, scene.number || String(index + 1), scene.groupName || '', scene.place || '',
          scene.time || '', scene.heading || '', scene.content || '', scene.status || '草稿', index);
    });
    (source.shots || []).forEach((shot, index) => {
      const sceneId = sceneMap.get(shot.sceneId);
      if (!sceneId) return;
      db.prepare(`INSERT INTO shots (id, project_id, scene_id, shot_no, shot_type, camera, duration, description, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid('shot'), project.id, sceneId, shot.shotNo || String(index + 1), shot.shotType || '', shot.camera || '',
          shot.duration || '', shot.description || '', shot.notes || '', index);
    });
    (source.foreshadows || []).forEach((foreshadow, index) => {
      db.prepare('INSERT INTO foreshadows (id, project_id, name, planted, payoff, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid('fore'), project.id, foreshadow.name || '未命名伏笔', foreshadow.planted || '', foreshadow.payoff || '',
          foreshadow.status || '待回收', index);
    });

    db.prepare('UPDATE projects SET cover = ?, status = ?, total_words = 0, updated_at = ? WHERE id = ?')
      .run(source.cover || project.cover, source.status || '草稿', stamp, project.id);
    recalculateProjectWords(project.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getProjectDetail(project.id)!;
}

export function completeOnboarding(input: {
  name: string; signature?: string; providerId: string; apiKey: string; baseUrl?: string; modelId: string;
}): { settings: AppSettings; provider: ProviderInfo } {
  const name = input.name.trim();
  if (!name) throw new Error('请填写称呼');
  if (!input.providerId || !input.modelId) throw new Error('请选择模型供应商和模型');
  const provider = getProviderRow(input.providerId);
  if (!provider) throw new Error('供应商不存在');
  const models = parseJson<ModelInfo[]>(provider.models, []);
  if (!models.some((m) => m.id === input.modelId)) throw new Error('模型不存在');
  const key = input.apiKey.trim();
  if (provider.kind !== 'mock' && provider.id !== 'ollama' && !key) {
    throw new Error('请填写 API Key');
  }
  const updated = updateProvider(input.providerId, {
    apiKey: key || undefined,
    baseUrl: input.baseUrl?.trim() || provider.base_url,
    enabled: true,
    enabledModels: [input.modelId],
  });
  if (!updated) throw new Error('供应商配置失败');
  const settings = saveSettings({
    profile: { name, signature: input.signature?.trim() || '' },
    onboarding: { completed: true },
    defaultModel: { providerId: input.providerId, modelId: input.modelId },
    fallbackModel: null,
  });
  return { settings, provider: updated };
}

export function applyProjectPlan(projectId: string, plan: ProjectPlan): ProjectDetail | null {
  const project = getProjectDetail(projectId);
  if (!project) return null;
  const stamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM outline_beats WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM outline_acts WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId);

    plan.acts.slice(0, 4).forEach((act, actIndex) => {
      const actId = uid('act');
      db.prepare('INSERT INTO outline_acts (id, project_id, title, summary, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(actId, projectId, act.title || `第${actIndex + 1}幕`, act.summary || '', actIndex);
      act.beats.slice(0, 8).forEach((beat, beatIndex) => {
        db.prepare(`INSERT INTO outline_beats (id, project_id, act_id, chapter_no, title, summary, tags, status, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uid('beat'), projectId, actId, beat.chapterNo || actIndex * 8 + beatIndex + 1,
            beat.title || '未命名场景', beat.summary || '', JSON.stringify(beat.tags || []), '待写',
            actIndex * 8 + beatIndex);
      });
    });

    plan.characters.slice(0, 8).forEach((character, index) => {
      db.prepare(`INSERT INTO characters (id, project_id, name, role, age, avatar, tags, quote, description, secret, relations, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`)
        .run(uid('char'), projectId, character.name || '未命名人物', character.role || '', character.age || '',
          (character.name || '人').slice(0, 1), JSON.stringify(character.tags || []), character.quote || '',
          character.description || '', character.secret || '', index);
    });

    const chapterRow = db.prepare('SELECT id FROM chapters WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1').get(projectId) as Row | undefined;
    if (plan.chapter && (plan.chapter.title || plan.chapter.content)) {
      const content = plan.chapter.content || '';
      const chapterTitle = plan.chapter.title || '第一章';
      if (chapterRow) {
        const current = getChapter(chapterRow.id);
        if (current) createChapterVersion(chapterRow.id, '企划前', current.content, current.title);
        db.prepare('UPDATE chapters SET title = ?, content = ?, words = ?, updated_at = ? WHERE id = ?')
          .run(chapterTitle, content, countWords(content), stamp, chapterRow.id);
        createChapterVersion(chapterRow.id, 'AI 企划', content, chapterTitle);
      } else {
        const created = createChapter(projectId, { title: chapterTitle, volume: '第一卷', number: '第一章', content });
        if (created) createChapterVersion(created.id, 'AI 企划', content, chapterTitle);
      }
    }
    recalculateProjectWords(projectId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(stamp, projectId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getProjectDetail(projectId);
}

export function createChapterVersion(chapterId: string, source: string, content?: string, title?: string): ChapterVersion | null {
  const chapter = getChapter(chapterId);
  if (!chapter || chapter.deletedAt) return null;
  const snapshot = content ?? chapter.content;
  const chapterTitle = title ?? chapter.title;
  const latest = db.prepare('SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1').get(chapterId) as Row | undefined;
  if (latest && latest.content === snapshot && latest.title === chapterTitle) return versionFromRow(latest);
  const id = uid('ver');
  db.prepare('INSERT INTO chapter_versions (id, project_id, chapter_id, source, title, content, words, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, chapter.projectId, chapterId, source, chapterTitle, snapshot, countWords(snapshot), now());
  db.prepare(`DELETE FROM chapter_versions WHERE chapter_id = ? AND id NOT IN (
    SELECT id FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 40
  )`).run(chapterId, chapterId);
  return versionFromRow(db.prepare('SELECT * FROM chapter_versions WHERE id = ?').get(id) as Row);
}

export function listChapterVersions(projectId: string, chapterId: string): ChapterVersion[] {
  return (db.prepare('SELECT * FROM chapter_versions WHERE project_id = ? AND chapter_id = ? ORDER BY created_at DESC').all(projectId, chapterId) as Row[]).map(versionFromRow);
}

export function listProjectVersions(projectId: string): ChapterVersion[] {
  const rows = db.prepare(`SELECT v.*, c.title AS chapter_title
    FROM chapter_versions v JOIN chapters c ON c.id = v.chapter_id
    WHERE v.project_id = ? AND c.deleted_at IS NULL
    ORDER BY v.created_at DESC`).all(projectId) as Row[];
  return rows.map((row) => ({ ...versionFromRow(row), chapterTitle: String(row.chapter_title || '') }));
}

export function restoreChapterVersion(chapterId: string, versionId: string): { chapter: Chapter; versions: ChapterVersion[] } | null {
  const version = db.prepare('SELECT * FROM chapter_versions WHERE id = ? AND chapter_id = ?').get(versionId, chapterId) as Row | undefined;
  if (!version) return null;
  const current = getChapter(chapterId);
  if (!current || current.deletedAt) return null;
  createChapterVersion(chapterId, '回退前', current.content, current.title);
  db.prepare('UPDATE chapters SET title = ?, content = ?, words = ?, updated_at = ? WHERE id = ?')
    .run(version.title, version.content, countWords(version.content), now(), chapterId);
  recalculateProjectWords(current.projectId);
  const chapter = getChapter(chapterId)!;
  return { chapter, versions: listChapterVersions(current.projectId, chapterId) };
}
