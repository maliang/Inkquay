import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { migrate } from './db.ts';
import { buildProjectDocx } from './docx.ts';
import { generateProjectPlan } from './plan.ts';
import {
  createBeat,
  createChapter,
  createChapterVersion,
  createCharacter,
  createForeshadow,
  createProject,
  createProvider,
  createScene,
  createShot,
  completeOnboarding,
  applyProjectPlan,
  deleteBeat,
  deleteChapter,
  deleteCharacter,
  deleteForeshadow,
  deleteProject,
  deleteScene,
  deleteShot,
  exportProjectBundle,
  exportProjectMarkdown,
  importProjectBundle,
  getChapter,
  getProjectDetail,
  getProviderRow,
  getSettings,
  listChapterVersions,
  listProjectVersions,
  listDeletedChapters,
  restoreChapter,
  purgeChapter,
  listMessages,
  listProjects,
  listProviders,
  saveSettings,
  testProviderConnection,
  updateBeat,
  updateChapter,
  updateCharacter,
  updateForeshadow,
  updateProject,
  updateProvider,
  updateScene,
  reorderBeats,
  restoreChapterVersion,
  generateShotsForScene,
  updateShot,
} from './repository.ts';
import { streamAssistant } from './ai.ts';
import { fetchProviderModels } from './models.ts';
import { decryptSecret } from './crypto.ts';
import type { AiStreamRequest, AppSettings, ChapterPatch, ModelInfo, ProjectBundle } from '../shared/types.ts';

const app = express();
const port = Number(process.env.PORT || 8787);

migrate();

app.use(express.json({ limit: '25mb' }));
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) console.log(`[api] ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'private-writer-studio', time: new Date().toISOString() });
});

app.get('/api/bootstrap', (_req, res) => {
  const projects = listProjects();
  res.json({
    projects,
    settings: getSettings(),
    providers: listProviders(),
    projectCount: projects.length,
  });
});

app.get('/api/projects', (_req, res) => {
  res.json({ projects: listProjects() });
});

app.post('/api/projects', (req, res) => {
  const { title, type, genre, description, goalWords } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: '作品名不能为空' });
  const project = createProject({
    title: title.trim(),
    type: type || 'novel',
    genre: genre || '',
    description: description || '',
    goalWords: Number(goalWords) || undefined,
  });
  res.status(201).json({ project });
});

app.post('/api/projects/:id/plan', async (req, res) => {
  const project = getProjectDetail(req.params.id);
  if (!project) return res.status(404).json({ error: '作品不存在' });
  try {
    const plan = await generateProjectPlan(project);
    res.json({ plan });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'AI 企划失败' });
  }
});

app.post('/api/projects/:id/plan/apply', (req, res) => {
  const project = getProjectDetail(req.params.id);
  if (!project) return res.status(404).json({ error: '作品不存在' });
  const plan = req.body?.plan;
  if (!plan || !Array.isArray(plan.acts) || !Array.isArray(plan.characters)) {
    return res.status(400).json({ error: '企划数据不完整' });
  }
  try {
    const updated = applyProjectPlan(project.id, plan);
    res.json({ project: updated });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '应用企划失败' });
  }
});

app.get('/api/projects/:id', (req, res) => {
  const project = getProjectDetail(req.params.id);
  if (!project) return res.status(404).json({ error: '作品不存在' });
  res.json({ project });
});

app.delete('/api/projects/:id', (req, res) => {
  if (!deleteProject(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  res.json({ ok: true });
});

app.patch('/api/projects/:id', (req, res) => {
  const project = updateProject(req.params.id, req.body || {});
  if (!project) return res.status(404).json({ error: '作品不存在' });
  res.json({ project });
});

app.post('/api/projects/:id/chapters', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  const chapter = createChapter(req.params.id, req.body || {});
  res.status(201).json({ chapter });
});

app.get('/api/projects/:id/versions', (req, res) => {
  const chapterId = typeof req.query.chapterId === 'string' ? req.query.chapterId : '';
  if (!chapterId) return res.json({ versions: listProjectVersions(req.params.id) });
  res.json({ versions: listChapterVersions(req.params.id, chapterId) });
});

app.get('/api/projects/:id/trash', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  res.json({ chapters: listDeletedChapters(req.params.id) });
});

app.post('/api/chapters/:id/versions', (req, res) => {
  const source = String(req.body?.source || '手动');
  const content = typeof req.body?.content === 'string' ? req.body.content : undefined;
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  const version = createChapterVersion(req.params.id, source, content, title);
  if (!version) return res.status(404).json({ error: '章节不存在' });
  res.status(201).json({ version });
});

app.post('/api/chapters/:id/versions/:versionId/restore', (req, res) => {
  const result = restoreChapterVersion(req.params.id, req.params.versionId);
  if (!result) return res.status(404).json({ error: '版本不存在' });
  res.json(result);
});

app.patch('/api/chapters/:id', (req, res) => {
  const chapter = updateChapter(req.params.id, req.body as ChapterPatch);
  if (!chapter) return res.status(404).json({ error: '章节不存在' });
  res.json({ chapter });
});

app.delete('/api/chapters/:id', (req, res) => {
  const result = deleteChapter(req.params.id);
  if (!result) return res.status(404).json({ error: '章节不存在' });
  res.json({ ok: true, trashed: true, ...result });
});

app.post('/api/chapters/:id/restore', (req, res) => {
  const result = restoreChapter(req.params.id);
  if (!result) return res.status(404).json({ error: '回收站里没有这一章' });
  res.json({ ok: true, ...result, project: getProjectDetail(result.projectId) });
});

app.delete('/api/chapters/:id/purge', (req, res) => {
  const result = purgeChapter(req.params.id);
  if (!result) return res.status(404).json({ error: '回收站里没有这一章' });
  res.json({ ok: true, ...result });
});

app.patch('/api/characters/:id', (req, res) => {
  const character = updateCharacter(req.params.id, req.body || {});
  if (!character) return res.status(404).json({ error: '人物不存在' });
  res.json({ character });
});

app.post('/api/projects/:id/characters', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  if (!req.body?.name?.trim()) return res.status(400).json({ error: '人物名不能为空' });
  const character = createCharacter(req.params.id, { ...req.body, name: req.body.name.trim() });
  res.status(201).json({ character });
});

app.delete('/api/characters/:id', (req, res) => {
  if (!deleteCharacter(req.params.id)) return res.status(404).json({ error: '人物不存在' });
  res.json({ ok: true });
});

app.patch('/api/beats/:id', (req, res) => {
  const beat = updateBeat(req.params.id, req.body || {});
  if (!beat) return res.status(404).json({ error: '场景不存在' });
  res.json({ beat });
});

app.delete('/api/beats/:id', (req, res) => {
  if (!deleteBeat(req.params.id)) return res.status(404).json({ error: '场景不存在' });
  res.json({ ok: true });
});

app.patch('/api/projects/:id/outline/reorder', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  const ids = Array.isArray(req.body?.beatIds) ? req.body.beatIds.filter((x: unknown) => typeof x === 'string') : [];
  if (!ids.length) return res.status(400).json({ error: '缺少 beatIds' });
  res.json({ beats: reorderBeats(req.params.id, ids) });
});

app.post('/api/projects/:id/beats', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  if (!req.body?.actId || !req.body?.title?.trim()) return res.status(400).json({ error: '缺少幕或场景标题' });
  const beat = createBeat(req.params.id, { ...req.body, title: req.body.title.trim(), chapterNo: Number(req.body.chapterNo) || 1 });
  res.status(201).json({ beat });
});

app.patch('/api/shots/:id', (req, res) => {
  const shot = updateShot(req.params.id, req.body || {});
  if (!shot) return res.status(404).json({ error: '分镜不存在' });
  res.json({ shot });
});

app.post('/api/projects/:id/shots', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  if (!req.body?.sceneId || !req.body?.shotNo) return res.status(400).json({ error: '缺少场次或镜头号' });
  const shot = createShot({ ...req.body, projectId: req.params.id });
  res.status(201).json({ shot });
});

app.delete('/api/shots/:id', (req, res) => {
  if (!deleteShot(req.params.id)) return res.status(404).json({ error: '分镜不存在' });
  res.json({ ok: true });
});

app.post('/api/scenes/:id/shots/generate', (req, res) => {
  const shots = generateShotsForScene(req.params.id);
  if (!shots.length) return res.status(404).json({ error: '场次不存在' });
  res.json({ shots });
});

app.patch('/api/scenes/:id', (req, res) => {
  const scene = updateScene(req.params.id, req.body || {});
  if (!scene) return res.status(404).json({ error: '场次不存在' });
  res.json({ scene });
});

app.delete('/api/scenes/:id', (req, res) => {
  if (!deleteScene(req.params.id)) return res.status(404).json({ error: '场次不存在' });
  res.json({ ok: true });
});

app.post('/api/projects/:id/scenes', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  const number = String(req.body?.number || '').trim();
  if (!number) return res.status(400).json({ error: '场次号不能为空' });
  const scene = createScene(req.params.id, { ...req.body, number });
  res.status(201).json({ scene });
});

app.patch('/api/foreshadows/:id', (req, res) => {
  const foreshadow = updateForeshadow(req.params.id, req.body || {});
  if (!foreshadow) return res.status(404).json({ error: '伏笔不存在' });
  res.json({ foreshadow });
});

app.post('/api/projects/:id/foreshadows', (req, res) => {
  if (!getProjectDetail(req.params.id)) return res.status(404).json({ error: '作品不存在' });
  if (!req.body?.name?.trim()) return res.status(400).json({ error: '伏笔名不能为空' });
  const foreshadow = createForeshadow(req.params.id, { ...req.body, name: req.body.name.trim() });
  res.status(201).json({ foreshadow });
});

app.delete('/api/foreshadows/:id', (req, res) => {
  if (!deleteForeshadow(req.params.id)) return res.status(404).json({ error: '伏笔不存在' });
  res.json({ ok: true });
});

app.get('/api/projects/:id/messages', (req, res) => {
  const chapterId = typeof req.query.chapterId === 'string' ? req.query.chapterId : null;
  res.json({ messages: listMessages(req.params.id, chapterId) });
});

app.post('/api/onboarding', (req, res) => {
  try {
    const result = completeOnboarding(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '初始化失败' });
  }
});

app.get('/api/settings', (_req, res) => {
  res.json({ settings: getSettings() });
});

app.put('/api/settings', (req, res) => {
  const next = saveSettings((req.body || {}) as Partial<AppSettings>);
  res.json({ settings: next });
});

app.get('/api/providers', (_req, res) => {
  res.json({ providers: listProviders() });
});

app.patch('/api/providers/:id', (req, res) => {
  const patch = req.body || {};
  const provider = updateProvider(req.params.id, {
    name: patch.name,
    baseUrl: patch.baseUrl,
    apiKey: patch.apiKey,
    enabled: patch.enabled,
    enabledModels: patch.enabledModels,
    models: patch.models as ModelInfo[] | undefined,
  });
  if (!provider) return res.status(404).json({ error: '供应商不存在' });
  res.json({ provider });
});

app.post('/api/providers', (req, res) => {
  const { name, kind, baseUrl, apiKey, models, enabledModels } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '供应商名称不能为空' });
  const provider = createProvider({
    name: name.trim(),
    kind,
    baseUrl,
    apiKey,
    models,
    enabledModels,
  });
  res.status(201).json({ provider });
});

app.post('/api/providers/:id/test', async (req, res) => {
  const result = await testProviderConnection(req.params.id);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/providers/:id/models', async (req, res) => {
  const row = getProviderRow(req.params.id);
  if (!row) return res.status(404).json({ error: '供应商不存在' });
  const body = req.body || {};
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim()
    ? body.apiKey.trim()
    : decryptSecret(row.api_key_enc);
  try {
    const result = await fetchProviderModels({
      providerId: row.id,
      kind: row.kind,
      baseUrl: String(body.baseUrl || row.base_url || ''),
      apiKey,
      existing: JSON.parse(String(row.models || '[]')) as ModelInfo[],
    });
    res.json({ ok: true, message: result.message, models: result.models });
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : '拉取模型失败', models: [] });
  }
});

app.get('/api/projects/:id/export.docx', async (req, res) => {
  const project = getProjectDetail(req.params.id);
  if (!project) return res.status(404).json({ error: '作品不存在' });
  const chapterId = typeof req.query.chapterId === 'string' ? req.query.chapterId : '';
  const chapter = chapterId ? project.chapters.find((item) => item.id === chapterId) : null;
  if (chapterId && !chapter && project.type !== 'screenplay') return res.status(404).json({ error: '章节不存在' });
  const scoped = chapter && project.type !== 'screenplay' ? { ...project, chapters: [chapter] } : project;
  const hasBody = scoped.chapters.some((item) => item.content.trim()) || scoped.scenes.some((scene) => scene.content.trim());
  if (!hasBody) return res.status(400).json({ error: chapter ? '这一章还没有可导出的正文' : '这本还没有可导出的正文' });
  const buffer = await buildProjectDocx(scoped);
  const name = chapter && project.type !== 'screenplay' ? `${project.title}-${chapter.number}${chapter.title}` : project.title;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.docx`)}`);
  res.send(buffer);
});

app.get('/api/projects/:id/bundle', (req, res) => {
  const bundle = exportProjectBundle(req.params.id);
  if (!bundle) return res.status(404).json({ error: '作品不存在' });
  const safeName = bundle.project.title.replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.inkquay.json`);
  res.send(JSON.stringify(bundle, null, 2));
});

app.post('/api/projects/import', (req, res) => {
  try {
    const bundle = (req.body?.bundle || req.body) as ProjectBundle;
    const project = importProjectBundle(bundle);
    res.status(201).json({ project });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '导入失败' });
  }
});

app.get('/api/projects/:id/export', (req, res) => {
  const project = getProjectDetail(req.params.id);
  if (!project) return res.status(404).json({ error: '作品不存在' });
  const chapterId = typeof req.query.chapterId === 'string' ? req.query.chapterId : '';
  const chapter = chapterId ? project.chapters.find((item) => item.id === chapterId) : null;
  if (chapterId && !chapter && project.type !== 'screenplay') return res.status(404).json({ error: '章节不存在' });
  const scoped = chapter && project.type !== 'screenplay' ? { ...project, chapters: [chapter] } : project;
  const hasBody = scoped.chapters.some((item) => item.content.trim()) || scoped.scenes.some((scene) => scene.content.trim());
  if (!hasBody) return res.status(400).json({ error: chapter ? '这一章还没有可导出的正文' : '这本还没有可导出的正文' });
  const markdown = exportProjectMarkdown(req.params.id, chapterId || null);
  if (!markdown) return res.status(404).json({ error: '作品不存在' });
  const name = chapter && project.type !== 'screenplay' ? `${project.title}-${chapter.number}${chapter.title}` : project.title;
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.md`)}`);
  res.send(markdown);
});

app.post('/api/ai/stream', async (req, res) => {
  const body = req.body as Partial<AiStreamRequest>;
  if (!body?.projectId || !body.prompt?.trim()) {
    return res.status(400).json({ error: '缺少 projectId 或 prompt' });
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);
  try {
    await streamAssistant(res, {
      projectId: body.projectId,
      chapterId: body.chapterId || null,
      prompt: body.prompt.trim(),
      providerId: body.providerId,
      modelId: body.modelId || "",
      mode: body.mode,
      regenerate: Boolean(body.regenerate),
      replaceMessageId: body.replaceMessageId,
      reasoning: body.reasoning,
      signal: controller.signal,
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'AI 请求失败' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'AI 请求失败' })}\n\n`);
      res.end();
    }
  } finally {
    res.off('close', onClose);
  }
});

const dist = process.env.PW_STATIC_DIR ? path.resolve(process.env.PW_STATIC_DIR) : path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(dist, 'index.html'));
    }
    next();
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err instanceof Error ? err.message : '服务器内部错误' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`[server] 私家写手 API → http://127.0.0.1:${port}`);
  if (!fs.existsSync(dist)) console.log('[server] 开发模式：前端由 Vite 提供（5180）');
});
