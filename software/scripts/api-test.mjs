import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-api-test-'));
const port = 8799;
const base = `http://127.0.0.1:${port}`;
let server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd,
  env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
server.stdout.on('data', (d) => { stdout += String(d); });
server.stderr.on('data', (d) => { stderr += String(d); });

server.on('exit', (code, signal) => {
  if (code && code !== 0) console.error(`[server exited] code=${code} signal=${signal}\n${stderr.slice(-4000)}`);
});

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start\n${stdout}\n${stderr}`);
}

async function json(pathname, options = {}) {
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (error) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed: ${error?.message}\n--- server stderr ---\n${stderr.slice(-4000)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}


async function waitPipelineJob(projectId) {
  for (let i = 0; i < 400; i += 1) {
    const snap = await json(`/api/projects/${projectId}/pipeline`);
    const job = snap.job;
    if (job && ['queued', 'running', 'pausing'].includes(job.state)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    return snap;
  }
  throw new Error(`pipeline job for ${projectId} never settled`);
}

async function main() {
  await waitForServer();
  const boot = await json('/api/bootstrap');
  assert.equal(boot.projects.length, 0, 'fresh install has no demo projects');
  assert.equal(boot.providers.length, 15, 'seed has 15 providers');
  assert.equal(boot.settings.onboarding.completed, false);
  assert.equal(boot.settings.profile.name, '');
  assert.equal(boot.settings.reasoningLevel, 'default');
  console.log('PASS clean install bootstrap');

  const invalid = await fetch(`${base}/api/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 'deepseek', modelId: 'deepseek-chat' }),
  });
  assert.equal(invalid.status, 400, 'onboarding requires name and API key');

  const onboarded = await json('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({
      name: 'API 作者', signature: '测试签名', providerId: 'deepseek',
      apiKey: 'sk-api-test-123456', modelId: 'deepseek-chat',
    }),
  });
  assert.equal(onboarded.settings.onboarding.completed, true);
  assert.equal(onboarded.settings.profile.name, 'API 作者');
  assert.equal(onboarded.settings.defaultModel.providerId, 'deepseek');
  assert.equal(onboarded.provider.configured, true);
  assert.ok(onboarded.provider.apiKeyMasked.includes('3456'));
  const discovered = await json('/api/providers/mock/models', { method: 'POST', body: JSON.stringify({}) });
  assert.ok(discovered.models.length > 0, 'mock provider exposes a model list');
  const fakeProvider = await json('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ name: '本地假接口', kind: 'openai', baseUrl: `http://127.0.0.1:${port + 1}/v1`, apiKey: 'test-key' }),
  });
  const fakeModelServer = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-reasoner', display_name: 'Fake Reasoner', context_length: 128000 }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => fakeModelServer.listen(port + 1, '127.0.0.1', resolve));
  const fakeModels = await json(`/api/providers/${fakeProvider.provider.id}/models`, { method: 'POST', body: JSON.stringify({ apiKey: 'test-key' }) });
  assert.equal(fakeModels.models[0].id, 'fake-reasoner');
  assert.equal(fakeModels.models[0].ctx, '128k');
  await new Promise((resolve) => fakeModelServer.close(resolve));
  console.log('PASS mandatory onboarding + encrypted provider key + model discovery');

  await json('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
  });

  const created = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: 'API 测试作品', type: 'novel', description: '测试创建', genre: '悬疑' }),
  });
  assert.ok(created.project.id);
  assert.equal(created.project.chapters.length, 1);
  assert.equal(created.project.outline.acts.length, 3, 'new project gets three empty acts');
  console.log('PASS create project + default acts');

  const projectId = created.project.id;
  const preview = await json(`/api/projects/${projectId}/plan`, { method: 'POST' });
  assert.ok(preview.plan.acts.length >= 3);
  assert.ok(preview.plan.acts.reduce((n, a) => n + a.beats.length, 0) >= 6);
  assert.ok(preview.plan.characters.length >= 3);
  assert.ok(preview.plan.chapter.content.length > 50);
  const emptyAfterPreview = await json(`/api/projects/${projectId}`);
  assert.equal(emptyAfterPreview.project.characters.length, 0, 'preview does not write data');
  const applied = await json(`/api/projects/${projectId}/plan/apply`, {
    method: 'POST', body: JSON.stringify({ plan: preview.plan }),
  });
  assert.ok(applied.project.outline.beats.length >= 6);
  assert.ok(applied.project.characters.length >= 3);
  assert.ok(applied.project.chapters[0].content.length > 50);
  console.log('PASS AI project plan preview + apply');
  const chapterId = created.project.chapters[0].id;
  const chapter = await json(`/api/chapters/${chapterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '第一章 测试', content: '这是一个自动保存测试。\n\n第二段正文。' }),
  });
  assert.equal(chapter.chapter.title, '第一章 测试');
  assert.ok(chapter.chapter.words > 10);
  const detail = await json(`/api/projects/${projectId}`);
  assert.equal(detail.project.totalWords, chapter.chapter.words);
  const versions = await json(`/api/projects/${projectId}/versions?chapterId=${chapterId}`);
  assert.ok(versions.versions.length >= 2, 'plan creates before/after versions');
  const restored = await json(`/api/chapters/${chapterId}/versions/${versions.versions[0].id}/restore`, { method: 'POST' });
  assert.equal(restored.chapter.id, chapterId);
  assert.ok(restored.versions.length >= 3, 'restore snapshots current before rollback');
  console.log('PASS chapter save + version restore');

  const beat = await json(`/api/projects/${projectId}/beats`, {
    method: 'POST',
    body: JSON.stringify({ actId: detail.project.outline.acts[0].id, title: '新场景', chapterNo: 2, summary: '摘要' }),
  });
  const editedBeat = await json(`/api/beats/${beat.beat.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '编辑后的场景', status: '初稿' }),
  });
  assert.equal(editedBeat.beat.title, '编辑后的场景');
  const beatList = await json(`/api/projects/${projectId}`);
  const allBeatIds = beatList.project.outline.beats.map((b) => b.id).reverse();
  const reordered = await json(`/api/projects/${projectId}/outline/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ beatIds: allBeatIds }),
  });
  assert.equal(reordered.beats[0].id, allBeatIds[0]);
  const deleted = await json(`/api/beats/${beat.beat.id}`, { method: 'DELETE' });
  assert.equal(deleted.ok, true);
  console.log('PASS beat create/update/reorder/delete');

  const character = await json(`/api/projects/${projectId}/characters`, {
    method: 'POST',
    body: JSON.stringify({ name: '测试人物', role: '配角', description: '人物描述', tags: ['冷静'] }),
  });
  const editedCharacter = await json(`/api/characters/${character.character.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: '更新后的人物描述' }),
  });
  assert.equal(editedCharacter.character.description, '更新后的人物描述');
  const foreshadow = await json(`/api/projects/${projectId}/foreshadows`, {
    method: 'POST',
    body: JSON.stringify({ name: '测试伏笔', planted: '第 2 章', payoff: '第 9 章' }),
  });
  const editedForeshadow = await json(`/api/foreshadows/${foreshadow.foreshadow.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: '已回收' }),
  });
  assert.equal(editedForeshadow.foreshadow.status, '已回收');
  console.log('PASS character create/update + foreshadow');

  const screenplay = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: 'API 测试剧本', type: 'screenplay' }),
  });
  assert.equal(screenplay.project.scenes.length, 1);
  const scene = await json(`/api/scenes/${screenplay.project.scenes[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: '内景 · 测试场景\n\n人物：台词。' }),
  });
  assert.ok(scene.scene.content.includes('测试场景'));
  const generated = await json(`/api/scenes/${scene.scene.id}/shots/generate`, { method: 'POST' });
  assert.equal(generated.shots.length, 6);
  const shot = await json(`/api/shots/${generated.shots[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: '测试分镜画面', camera: '手持' }),
  });
  assert.equal(shot.shot.description, '测试分镜画面');
  console.log('PASS screenplay scene + storyboard');

  // T1：剧本导出（题库里原本只覆盖小说的 md/docx，剧本走 scenes 分支但没人验证过）
  const sceneTwo = await json(`/api/projects/${screenplay.project.id}/scenes`, {
    method: 'POST',
    body: JSON.stringify({ number: '2', heading: '2. 外景 · 测试街道 · 夜', content: '夜雨。人物站在街灯下。' }),
  });
  assert.equal(sceneTwo.scene.number, '2', 'second scene created');
  const screenplayDetail = await json(`/api/projects/${screenplay.project.id}`);
  assert.equal(screenplayDetail.project.scenes.length, 2);
  assert.equal(screenplayDetail.project.sceneCount, 2, 'ProjectSummary.sceneCount reflects scenes');
  assert.equal(screenplayDetail.project.shotCount, 6, 'ProjectSummary.shotCount reflects shots');
  assert.equal(screenplayDetail.project.chapterCount, 0, 'screenplay still has no chapters');
  const screenplayList = await json('/api/projects');
  const listedScreenplay = screenplayList.projects.find((p) => p.id === screenplay.project.id);
  assert.equal(listedScreenplay.sceneCount, 2, 'project list carries sceneCount');
  assert.equal(listedScreenplay.shotCount, 6, 'project list carries shotCount');
  const listedNovel = screenplayList.projects.find((p) => p.id === projectId);
  assert.equal(listedNovel.sceneCount, 0, 'novel sceneCount is 0 (not undefined/NaN)');
  assert.equal(listedNovel.shotCount, 0, 'novel shotCount is 0 (not undefined/NaN)');

  const screenplayMd = await fetch(`${base}/api/projects/${screenplay.project.id}/export`);
  assert.equal(screenplayMd.status, 200, 'screenplay markdown export is allowed');
  const screenplayMarkdown = await screenplayMd.text();
  assert.ok(screenplayMarkdown.includes('## 1. 内景 · 未命名场景 · 日'), 'export uses scene heading of scene 1');
  assert.ok(screenplayMarkdown.includes('## 2. 外景 · 测试街道 · 夜'), 'export uses scene heading of scene 2');
  assert.ok(screenplayMarkdown.includes('内景 · 测试场景'), 'export keeps scene body');
  const screenplayDocx = await fetch(`${base}/api/projects/${screenplay.project.id}/export.docx`);
  assert.equal(screenplayDocx.status, 200, 'screenplay docx export is allowed');
  const screenplayDocxBytes = new Uint8Array(await screenplayDocx.arrayBuffer());
  assert.equal(screenplayDocxBytes[0], 0x50);
  assert.equal(screenplayDocxBytes[1], 0x4b);
  assert.ok(screenplayDocxBytes.byteLength > 1000, 'screenplay docx has real content');
  const emptyScreenplay = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '空剧本', type: 'screenplay' }),
  });
  const emptyScreenplayExport = await fetch(`${base}/api/projects/${emptyScreenplay.project.id}/export`);
  assert.equal(emptyScreenplayExport.status, 400, 'empty screenplay export is rejected');
  const emptyScreenplayBody = await emptyScreenplayExport.json();
  assert.equal(emptyScreenplayBody.error, '这本还没有可导出的正文');
  await json(`/api/projects/${emptyScreenplay.project.id}`, { method: 'DELETE' });
  console.log('PASS T1 screenplay markdown + docx export (and empty screenplay guard)');

  // T2（剧本部分）：项目包必须带走 scenes/shots，导入后计数一致
  const screenplayBundleRes = await fetch(`${base}/api/projects/${screenplay.project.id}/bundle`);
  assert.equal(screenplayBundleRes.status, 200);
  const screenplayBundle = await screenplayBundleRes.json();
  const importedScreenplay = await json('/api/projects/import', {
    method: 'POST', body: JSON.stringify({ bundle: screenplayBundle }),
  });
  assert.equal(importedScreenplay.project.type, 'screenplay');
  assert.equal(importedScreenplay.project.scenes.length, 2, 'screenplay bundle keeps both scenes');
  assert.equal(importedScreenplay.project.shots.length, 6, 'screenplay bundle keeps shots');
  assert.equal(importedScreenplay.project.sceneCount, 2);
  assert.equal(importedScreenplay.project.shotCount, 6);
  assert.ok(importedScreenplay.project.scenes.some((s) => s.heading === '2. 外景 · 测试街道 · 夜'));
  assert.ok(importedScreenplay.project.shots.some((s) => s.description === '测试分镜画面'));
  await json(`/api/projects/${importedScreenplay.project.id}`, { method: 'DELETE' });
  console.log('PASS T2 screenplay bundle keeps scenes + shots');

  const deletedProject = await json(`/api/projects/${screenplay.project.id}`, { method: 'DELETE' });
  assert.equal(deletedProject.ok, true);
  const deletedLookup = await fetch(`${base}/api/projects/${screenplay.project.id}`);
  assert.equal(deletedLookup.status, 404);
  console.log('PASS project delete cascade');

  const settings = await json('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      appearance: { theme: 'paper', accent: 'jade', editorSize: 19, reduceMotion: true },
      defaultModel: { providerId: 'mock', modelId: 'mock-writer' },
    }),
  });
  assert.equal(settings.settings.appearance.theme, 'paper');
  assert.equal(settings.settings.appearance.accent, 'jade');
  assert.equal(settings.settings.onboarding.completed, true);
  const reread = await json('/api/settings');
  assert.equal(reread.settings.profile.name, 'API 作者');
  console.log('PASS settings + profile');

  const messagesBefore = await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`);
  const streamRes = await fetch(`${base}/api/ai/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, chapterId, prompt: '先写一段气氛。' }),
  });
  assert.equal(streamRes.status, 200);
  const raw = await streamRes.text();
  assert.ok(raw.includes('"type":"delta"'), 'SSE has deltas');
  assert.ok(raw.includes('"type":"done"'), 'SSE done');
  const messagesAfter = await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`);
  assert.equal(messagesAfter.messages.length, messagesBefore.messages.length + 2);
  assert.ok(messagesAfter.messages.at(-1).content.length > 20);
  const previousAssistant = messagesAfter.messages.at(-1);
  const regenRes = await fetch(`${base}/api/ai/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, chapterId, prompt: '先写一段气氛。', regenerate: true, replaceMessageId: previousAssistant.id }),
  });
  assert.equal(regenRes.status, 200);
  await regenRes.text();
  const messagesRegen = await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`);
  assert.equal(messagesRegen.messages.length, messagesAfter.messages.length, 'regenerate replaces the old assistant instead of appending');
  assert.notEqual(messagesRegen.messages.at(-1).id, previousAssistant.id);
  console.log('PASS AI stream + regenerate');

  const stopController = new AbortController();
  const stopRes = await fetch(`${base}/api/ai/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, chapterId, prompt: '写一段会被中止的长段落。' }),
    signal: stopController.signal,
  });
  assert.equal(stopRes.status, 200);
  const reader = stopRes.body.getReader();
  await reader.read();
  stopController.abort();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const stoppedMessages = await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`);
  const stopped = stoppedMessages.messages.at(-1);
  assert.equal(stopped.role, 'assistant');
  assert.equal(stopped.status, 'aborted');
  assert.ok(stopped.content.length > 0, 'aborted stream keeps the partial text');
  console.log('PASS abort keeps partial assistant text');

  // T5 / A1-API：模型没配好时必须明确拒绝，不许静默回退演示模型并落库
  const t5ChapterUrl = `/api/projects/${projectId}`;
  const chapterBeforeT5 = (await json(t5ChapterUrl)).project.chapters.find((c) => c.id === chapterId);
  const messagesBeforeT5 = (await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`)).messages.length;
  const aiStream = async (body, options = {}) => fetch(`${base}/api/ai/stream`, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, chapterId, ...body }),
  });

  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });
  const noModelRes = await aiStream({ prompt: '没有默认模型时不该有正文。' });
  assert.equal(noModelRes.status, 200, 'SSE keeps 200 for validation errors');
  const noModelRaw = await noModelRes.text();
  assert.ok(noModelRaw.includes('"type":"error"'), 'no default model -> SSE error event');
  assert.ok(noModelRaw.includes('默认模型'), 'error tells the user to pick a default model');
  assert.ok(!noModelRaw.includes('"type":"delta"'), 'no silent mock delta');
  assert.ok(!noModelRaw.includes('"type":"done"'), 'no done event without a model');

  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' }, reasoningLevel: 'high' }) });
  const normalizedSettings = await json('/api/settings');
  assert.equal(normalizedSettings.settings.reasoningLevel, 'default', 'stale reasoning level falls back when the model does not support it');
  const unsupportedReasoning = await (await aiStream({ prompt: '测试不支持推理等级。', reasoning: 'high' })).text();
  assert.ok(unsupportedReasoning.includes('"type":"error"'), 'explicit unsupported reasoning is refused');
  assert.ok(unsupportedReasoning.includes('推理等级'), 'error names reasoning level');
  assert.ok(!unsupportedReasoning.includes('"type":"delta"'));
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ reasoningLevel: 'default' }) });

  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'ghost', modelId: 'ghost-1' } }) });
  const ghostRaw = await (await aiStream({ prompt: '供应商不存在。' })).text();
  assert.ok(ghostRaw.includes('"type":"error"') && ghostRaw.includes('不存在'), 'unknown provider is refused explicitly');
  assert.ok(!ghostRaw.includes('"type":"delta"'));

  await json('/api/providers/deepseek', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' } }) });
  const disabledRaw = await (await aiStream({ prompt: '供应商被停用了。' })).text();
  assert.ok(disabledRaw.includes('"type":"error"'), 'disabled provider -> error');
  assert.ok(disabledRaw.includes('未在此工作台启用'), 'disabled provider is named as disabled');
  assert.ok(!disabledRaw.includes('"type":"delta"'));

  await json('/api/providers/deepseek', { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'deepseek', modelId: 'deepseek-reasoner' } }) });
  const notAllowedRaw = await (await aiStream({ prompt: '模型不在可用列表。' })).text();
  assert.ok(notAllowedRaw.includes('"type":"error"'), 'model outside enabledModels -> error');
  assert.ok(notAllowedRaw.includes('可用列表'), 'error explains the model is not in the available list');
  assert.ok(!notAllowedRaw.includes('"type":"delta"'));

  const messagesAfterRefusals = (await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`)).messages.length;
  assert.equal(messagesAfterRefusals, messagesBeforeT5, 'refusals persist no message at all');
  const chapterAfterRefusals = (await json(t5ChapterUrl)).project.chapters.find((c) => c.id === chapterId);
  assert.equal(chapterAfterRefusals.content, chapterBeforeT5.content, 'refusals leave chapter text untouched');
  assert.equal(chapterAfterRefusals.words, chapterBeforeT5.words, 'refusals leave word count untouched');

  // 修复不许误伤显式演示模型：ui-test / desktop-test 依赖 providerId=mock 的离线性
  const explicitMockRes = await aiStream({ prompt: '显式演示模型仍然可用。', providerId: 'mock', modelId: 'mock-writer' });
  assert.equal(explicitMockRes.status, 200);
  const explicitMockRaw = await explicitMockRes.text();
  assert.ok(explicitMockRaw.includes('"type":"delta"'), 'explicit mock still streams deltas');
  assert.ok(explicitMockRaw.includes('"provider":"本地演示"'), 'explicit mock is served by 本地演示');
  const messagesAfterExplicitMock = (await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`)).messages.length;
  assert.equal(messagesAfterExplicitMock, messagesAfterRefusals + 2, 'explicit mock persists user + assistant messages');

  // 只给一半（provider 有、model 空）时不许借用默认模型的另一半
  const halfRaw = await (await aiStream({ prompt: '只给供应商。', providerId: 'mock', modelId: '' })).text();
  assert.ok(halfRaw.includes('"type":"error"'), 'half override -> error');
  assert.ok(halfRaw.includes('还没有选择模型'), 'half override asks for the missing model');
  assert.ok(!halfRaw.includes('"type":"delta"'));
  assert.equal(
    (await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`)).messages.length,
    messagesAfterExplicitMock,
    'half override persists no message',
  );

  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
  const restoredRaw = await (await aiStream({ prompt: '恢复默认模型后继续写作。' })).text();
  assert.ok(restoredRaw.includes('"type":"delta"'), 'restored default model streams again');
  assert.ok(restoredRaw.includes('"provider":"本地演示"'));
  console.log('PASS T5 unconfigured model refuses instead of silently mocking');

  await json(`/api/chapters/${chapterId}`, {
    method: 'PATCH', body: JSON.stringify({ content: '这是一个导出测试。\n\n正文必须可读。' }),
  });
  const exportRes = await fetch(`${base}/api/projects/${projectId}/export`);
  assert.equal(exportRes.status, 200);
  const markdown = await exportRes.text();
  assert.ok(markdown.includes('# API 测试作品'));
  const docxRes = await fetch(`${base}/api/projects/${projectId}/export.docx`);
  assert.equal(docxRes.status, 200);
  assert.ok((docxRes.headers.get('content-type') || '').includes('wordprocessingml'));
  const docxBytes = new Uint8Array(await docxRes.arrayBuffer());
  assert.equal(docxBytes[0], 0x50);
  assert.equal(docxBytes[1], 0x4b);
  const scopedMd = await fetch(`${base}/api/projects/${projectId}/export?chapterId=${chapterId}`);
  assert.equal(scopedMd.status, 200);
  assert.ok((await scopedMd.text()).includes('这是一个导出测试'));
  const scopedDocx = await fetch(`${base}/api/projects/${projectId}/export.docx?chapterId=${chapterId}`);
  assert.equal(scopedDocx.status, 200);
  assert.ok((await scopedDocx.arrayBuffer()).byteLength > 1000);
  console.log('PASS markdown + docx export (book + chapter)');

  const bundleRes = await fetch(`${base}/api/projects/${projectId}/bundle`);
  assert.equal(bundleRes.status, 200);
  const bundle = await bundleRes.json();
  assert.equal(bundle.format, 'inkquay.project');
  assert.equal(bundle.project.title, 'API 测试作品');
  const imported = await json('/api/projects/import', {
    method: 'POST', body: JSON.stringify({ bundle }),
  });
  assert.notEqual(imported.project.id, projectId);
  assert.equal(imported.project.title, 'API 测试作品');
  assert.ok(imported.project.chapters.some((chapter) => chapter.content.includes('导出测试')));
  // T2（小说部分）：项目包必须带走全部集合，导入后计数与正文一致
  const novelSource = await json(`/api/projects/${projectId}`);
  const collectionCounts = (project) => ({
    chapters: project.chapters.length,
    scenes: project.scenes.length,
    shots: project.shots.length,
    characters: project.characters.length,
    foreshadows: project.foreshadows.length,
  });
  const sourceCounts = collectionCounts(novelSource.project);
  assert.ok(sourceCounts.chapters > 0 && sourceCounts.characters > 0 && sourceCounts.foreshadows > 0, 'bundle fixture is not empty');
  assert.deepEqual(collectionCounts(imported.project), sourceCounts, 'imported project keeps every collection count');
  assert.equal(imported.project.chapters[0].content, novelSource.project.chapters[0].content, 'imported chapter text is identical');
  assert.equal(imported.project.chapters[0].title, novelSource.project.chapters[0].title, 'imported chapter titles are identical');
  assert.equal(imported.project.foreshadows[0].name, novelSource.project.foreshadows[0].name, 'imported foreshadow names are identical');
  assert.equal(imported.project.sceneCount, sourceCounts.scenes, 'imported sceneCount matches scenes');
  assert.equal(imported.project.shotCount, sourceCounts.shots, 'imported shotCount matches shots');
  assert.ok(Array.isArray(bundle.project.versions) && bundle.project.versions.length > 0);
  const importedBundleRes = await fetch(`${base}/api/projects/${imported.project.id}/bundle`);
  const importedBundle = await importedBundleRes.json();
  assert.equal(importedBundle.project.versions.length, bundle.project.versions.length);
  await json(`/api/projects/${imported.project.id}`, { method: 'DELETE' });
  console.log('PASS project bundle export + import');

  const extra = await json(`/api/projects/${projectId}/chapters`, {
    method: 'POST', body: JSON.stringify({ title: '待删除章节' }),
  });
  await json(`/api/chapters/${extra.chapter.id}/versions`, {
    method: 'POST', body: JSON.stringify({ source: '测试快照' }),
  });
  const deletedChapter = await json(`/api/chapters/${extra.chapter.id}`, { method: 'DELETE' });
  assert.equal(deletedChapter.ok, true);
  assert.ok(deletedChapter.versions >= 0);
  const afterDelete = await json(`/api/projects/${projectId}`);
  assert.ok(!afterDelete.project.chapters.some((chapter) => chapter.id === extra.chapter.id));
  const trash = await json(`/api/projects/${projectId}/trash`);
  assert.ok(trash.chapters.some((chapter) => chapter.id === extra.chapter.id), 'deleted chapter is in trash');
  const restoredChapter = await json(`/api/chapters/${extra.chapter.id}/restore`, { method: 'POST' });
  assert.equal(restoredChapter.ok, true);
  assert.ok(restoredChapter.project.chapters.some((chapter) => chapter.id === extra.chapter.id), 'chapter restores from trash');
  await json(`/api/chapters/${extra.chapter.id}`, { method: 'DELETE' });
  const purged = await json(`/api/chapters/${extra.chapter.id}/purge`, { method: 'DELETE' });
  assert.equal(purged.ok, true);
  const trashAfterPurge = await json(`/api/projects/${projectId}/trash`);
  assert.ok(!trashAfterPurge.chapters.some((chapter) => chapter.id === extra.chapter.id));
  const allVersions = await json(`/api/projects/${projectId}/versions`);
  assert.ok(Array.isArray(allVersions.versions));
  console.log('PASS chapter trash + restore + purge + project version list');

  const emptyProject = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '空作品' }),
  });
  const emptyExport = await fetch(`${base}/api/projects/${emptyProject.project.id}/export`);
  assert.equal(emptyExport.status, 400, 'empty project export is rejected with a readable error');
  await json(`/api/projects/${emptyProject.project.id}`, { method: 'DELETE' });
  console.log('PASS empty export guard');

  // ===================== AI-first 流水线（阶段状态机 / 生成 / 取消 / 迁移 / 短篇） =====================
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });
  const precheckNoModel = await json('/api/pipeline/precheck');
  assert.equal(precheckNoModel.ok, false, 'precheck fails without a default model');
  assert.equal(precheckNoModel.code, 'NO_DEFAULT_MODEL');
  const refusedCreate = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '不该创建的作品', type: 'novel', start: 'pipeline' }),
  });
  assert.equal(refusedCreate.status, 422, 'creating with AI planning and no model is refused');
  assert.equal((await refusedCreate.json()).code, 'NO_DEFAULT_MODEL');
  const afterRefusal = await json('/api/projects');
  assert.ok(!afterRefusal.projects.some((project) => project.title === '不该创建的作品'), 'refused creation leaves no orphan project');

  const keylessProvider = await json('/api/providers', {
    method: 'POST',
    body: JSON.stringify({ name: '缺 Key 供应商', kind: 'openai', baseUrl: 'https://api.example.com/v1' }),
  });
  await json(`/api/providers/${keylessProvider.provider.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
  await json('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultModel: { providerId: keylessProvider.provider.id, modelId: 'custom-model' } }),
  });
  const precheckNoKey = await json('/api/pipeline/precheck');
  assert.equal(precheckNoKey.ok, false, 'precheck fails when the provider has no api key');
  assert.equal(precheckNoKey.code, 'NO_API_KEY');
  await json('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
  });
  console.log('PASS pipeline config gates (no model / no key refuse instead of silently mocking)');

  // --- 创建即落库：4 个阶段 + job，且不预写空幕/空章 ---
  const piped = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: '流水线长篇', type: 'novel', premise: '旧印刷厂里的失踪名单', targetWords: 30000,
      styleNotes: '克制，不要爽文', start: 'pipeline',
    }),
  });
  assert.ok(piped.job && piped.job.id, 'creating with start returns a job');
  assert.equal(piped.project.chapters.length, 0, 'pipeline project does not pre-write an empty chapter');
  assert.equal(piped.project.outline.acts.length, 0, 'pipeline project does not pre-write empty acts');
  const pipelineId = piped.project.id;
  let snap = await waitPipelineJob(pipelineId);
  assert.equal(snap.kind, 'novel');
  assert.equal(snap.stages.p1.status, 'review', 'P1 lands in review');
  assert.equal(snap.stages.p2.status, 'empty', 'P2 stays empty until generated');
  assert.equal(snap.nextStep.kind, 'review-p1');
  assert.ok(snap.lastJob && snap.lastJob.state === 'done', 'finished job is reported as done');
  const p1Items = (await json(`/api/projects/${pipelineId}/stages/p1/items`)).items;
  assert.equal(p1Items.filter((item) => item.kind === 'world').length, 1, 'one world entry');
  assert.ok(p1Items.filter((item) => item.kind === 'env').length >= 2, 'at least two environments');
  assert.ok(p1Items.filter((item) => item.kind === 'character').length >= 1, 'at least one character');
  assert.ok(p1Items.every((item) => item.revisionCount >= 1), 'every generated item keeps a revision');

  // --- 修改 + 历史 + 局部重生成 ---
  const worldItem = p1Items.find((item) => item.kind === 'world');
  const editedItem = await json(`/api/projects/${pipelineId}/items/${worldItem.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ payload: { ...worldItem.payload, tone: '更冷一些，少形容词' } }),
  });
  assert.equal(editedItem.item.payload.tone, '更冷一些，少形容词', 'item edit is persisted as structured payload');
  const worldRevisions = (await json(`/api/projects/${pipelineId}/stages/p1/revisions?targetId=${worldItem.id}`)).revisions;
  assert.ok(worldRevisions.some((revision) => revision.source === 'manual'), 'manual edit appends a revision');
  assert.ok(worldRevisions.length >= 2, 'history keeps the AI version next to the manual one');
  const restoredItem = await json(`/api/projects/${pipelineId}/items/${worldItem.id}/revisions/${worldRevisions[worldRevisions.length - 1].id}/restore`, { method: 'POST' });
  assert.ok(restoredItem.item, 'restoring a revision returns the item');

  const characterIdsBefore = (await json(`/api/projects/${pipelineId}/stages/p1/items`)).items
    .filter((item) => item.kind === 'character').map((item) => item.id).sort();
  await json(`/api/projects/${pipelineId}/stages/p1/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ scope: 'item', targetId: worldItem.id, note: '环境再潮湿一些' }),
  });
  snap = await waitPipelineJob(pipelineId);
  const characterIdsAfter = (await json(`/api/projects/${pipelineId}/stages/p1/items`)).items
    .filter((item) => item.kind === 'character').map((item) => item.id).sort();
  assert.deepEqual(characterIdsAfter, characterIdsBefore, 'partial regeneration leaves other items untouched');
  assert.equal(snap.stages.p1.status, 'review', 'regeneration puts the stage back into review');
  console.log('PASS pipeline stage items are editable structured data with revision history');

  // --- 顺序门槛：P1 未确认不能确认 P2 ---
  const p2TooEarly = await fetch(`${base}/api/projects/${pipelineId}/stages/p2/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(p2TooEarly.status, 409);
  assert.equal((await p2TooEarly.json()).code, 'STAGE_LOCKED');

  const confirmedP1 = await json(`/api/projects/${pipelineId}/stages/p1/confirm`, { method: 'POST' });
  assert.equal(confirmedP1.stage, 'p1');
  assert.equal(confirmedP1.status, 'confirmed');
  assert.ok(confirmedP1.snapshotRevisionId, 'confirming stores a snapshot revision');
  await json(`/api/projects/${pipelineId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  snap = await waitPipelineJob(pipelineId);
  assert.equal(snap.stages.p2.status, 'review');
  assert.equal(snap.nextStep.kind, 'review-p2');
  const p2Items = (await json(`/api/projects/${pipelineId}/stages/p2/items`)).items;
  assert.ok(p2Items.filter((item) => item.kind === 'act').length >= 2, 'acts generated');
  assert.ok(p2Items.filter((item) => item.kind === 'beat').length >= 2, 'beats generated per act');
  await json(`/api/projects/${pipelineId}/stages/p2/confirm`, { method: 'POST' });

  // --- P3 章节计划：每章功能 / 大纲 / 字数范围，且能改字数与总量分配 ---
  await json(`/api/projects/${pipelineId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  snap = await waitPipelineJob(pipelineId);
  assert.equal(snap.stages.p3.status, 'review');
  const plan = await json(`/api/projects/${pipelineId}/units`);
  assert.ok(plan.units.length >= 3, 'chapter plan has at least 3 units');
  assert.ok(plan.units.every((unit) => unit.function && unit.synopsis && unit.targetWords), 'each unit carries function, synopsis and word target');
  assert.ok(plan.units.every((unit) => unit.minWords <= unit.targetWords && unit.targetWords <= unit.maxWords), 'word range is min <= target <= max');
  const firstUnit = plan.units[0];
  const patchedUnit = await json(`/api/projects/${pipelineId}/stages/p3/units/${firstUnit.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ targetWords: firstUnit.targetWords + 400, maxWords: firstUnit.maxWords + 400 }),
  });
  assert.equal(patchedUnit.unit.unit.target, firstUnit.targetWords + 400, 'unit word target is editable');
  assert.equal(patchedUnit.unit.unit.max, firstUnit.maxWords + 400, 'unit word range is editable');
  const allocate = await json(`/api/projects/${pipelineId}/stages/p3/units/allocate`, { method: 'POST', body: JSON.stringify({ totalTarget: 30000 }) });
  assert.equal(allocate.preview.length, plan.units.length, 'allocation previews every unit');
  assert.ok(allocate.preview.some((row) => row.manuallyEdited), 'manually edited units are flagged');
  const guardedApply = await fetch(`${base}/api/projects/${pipelineId}/stages/p3/units/allocate/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: allocate.preview }),
  });
  assert.equal(guardedApply.status, 422, 'applying an allocation refuses to overwrite a hand-edited word target');
  assert.equal((await guardedApply.json()).code, 'TARGET_EDITED');
  const allocateApply = await json(`/api/projects/${pipelineId}/stages/p3/units/allocate/apply`, {
    method: 'POST', body: JSON.stringify({ rows: allocate.preview, includeEdited: true }),
  });
  assert.ok(allocateApply.summary, 'applying an allocation returns a summary');
  await json(`/api/projects/${pipelineId}/stages/p3/confirm`, { method: 'POST' });
  console.log('PASS chapter plan carries function / synopsis / word range and supports allocation');

  // --- 逐章生成：只写目标章 ---
  await json(`/api/projects/${pipelineId}/writing/start`, {
    method: 'POST', body: JSON.stringify({ mode: 'single', unitId: firstUnit.id }),
  });
  snap = await waitPipelineJob(pipelineId);
  assert.equal(snap.nextStep.kind, 'review-chapters');
  const unitsAfterWrite = (await json(`/api/projects/${pipelineId}/units`)).units;
  const writtenUnit = unitsAfterWrite.find((unit) => unit.id === firstUnit.id);
  assert.ok(writtenUnit.words > 0, 'the target chapter got text');
  assert.equal(writtenUnit.reviewStatus, 'in_review');
  assert.ok(unitsAfterWrite.filter((unit) => unit.id !== firstUnit.id).every((unit) => unit.words === 0 && unit.reviewStatus === 'pending'), 'other chapters are untouched');
  const chapterVersions = await json(`/api/projects/${pipelineId}/units/${firstUnit.id}/versions`);
  assert.ok(chapterVersions.versions.length >= 1, 'writing a chapter stores a version');

  const noteRequired = await fetch(`${base}/api/chapters/${firstUnit.id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request_changes', note: '再' }),
  });
  assert.equal(noteRequired.status, 422, 'requesting changes without a note is refused');
  assert.equal((await noteRequired.json()).code, 'NOTE_REQUIRED');
  const approved = await json(`/api/chapters/${firstUnit.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'approve' }) });
  assert.equal(approved.unit.unit.reviewStatus, 'approved');
  assert.ok(approved.nextPendingChapterId, 'approval points at the next pending chapter');
  console.log('PASS per-chapter generation writes only the target chapter and needs an explicit review');

  // --- 取消：慢供应商下取消必须快速生效且不留半截数据 ---
  let fakeMode = 'ok';
  // 正文类步骤要求「不是明显过短」，默认文本只够校验不触碰下限，暂停用例要写一整章时再换长文本
  let fakeText = '一段正文。';
  const fakeChat = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      if (req.url && req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'fake-chat', display_name: 'Fake Chat' }] }));
        return;
      }
      if (fakeMode === 'slow' || fakeMode === 'slowPlan') await new Promise((resolve) => setTimeout(resolve, 8000));
      if (fakeMode === 'slowPlan') {
        // 慢速但**合法**的计划：用来制造「P2 多幕重建跑到一半」的真实现场
        // （纯 slow 模式回的是正文文本，计划步会先 INVALID_JSON 挂掉，根本走不到第二步）。
        const slowPlan = JSON.stringify({
          acts: [
            { title: '第一幕', function: '钩子', summary: '主角在雨夜收到一封不该出现的信，决定顺着寄信人查下去。', characters: [] },
            { title: '第二幕', function: '推进', summary: '线索指向旧码头，主角与守夜人第一次正面交锋。', characters: [] },
          ],
          beats: [
            { title: '节拍一', function: '推进', summary: '主角在码头找到半张湿透的船票。', plannedChapters: 1, foreshadow: '' },
            { title: '节拍二', function: '揭示', summary: '守夜人拦住主角，两人在雾里对峙。', plannedChapters: 1, foreshadow: '' },
          ],
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: slowPlan }, finish_reason: 'stop' }], usage: { total_tokens: 40 } }));
        return;
      }
      if (fakeMode === 'fewChapters') {
        // 只回一条计划：用来验证「模型少回几条时不许删掉窗口外的既有计划」
        const few = JSON.stringify({
          chapters: [
            { title: '只剩一章', function: '推进', synopsis: '这一版模型只回了一条，用来验证不会把已经生成过的计划删掉。', minWords: 2500, targetWords: 3000, maxWords: 4000, characters: [] },
          ],
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: few }, finish_reason: 'stop' }], usage: { total_tokens: 12 } }));
        return;
      }
      if (fakeMode === 'invalid') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '这不是 JSON，只是一段闲聊。' }, finish_reason: 'stop' }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: fakeText }, finish_reason: 'stop' }], usage: { total_tokens: 12 } }));
    });
  });
  await new Promise((resolve) => fakeChat.listen(0, '127.0.0.1', resolve));
  const chatPort = fakeChat.address().port;
  const chatProvider = await json('/api/providers', {
    method: 'POST',
    body: JSON.stringify({
      name: '可控假对话', kind: 'openai', baseUrl: `http://127.0.0.1:${chatPort}/v1`, apiKey: 'test-key',
      models: [{ id: 'fake-chat', name: 'fake-chat', ctx: '8k', tags: [] }],
    }),
  });
  await json('/api/settings', {
    method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }),
  });
  fakeMode = 'slow';
  const slowProject = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '取消测试', type: 'novel', targetWords: 12000, start: 'pipeline' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const cancelStarted = Date.now();
  const cancelled = await json(`/api/jobs/${slowProject.job.id}/cancel`, { method: 'POST', body: JSON.stringify({ mode: 'stop' }) });
  assert.equal(cancelled.code === undefined || cancelled.ok !== false, true);
  const cancelSnap = await waitPipelineJob(slowProject.project.id);
  const cancelLatency = Date.now() - cancelStarted;
  assert.ok(cancelLatency < 5000, `cancel settles quickly (${cancelLatency}ms)`);
  assert.equal(cancelSnap.lastJob.state, 'cancelled');
  assert.equal(cancelSnap.stages.p1.counts.items, 0, 'cancelling P1 writes no partial items');
  assert.equal(cancelSnap.lastError, null, 'a user cancel is not an error');
  const retryable = await json(`/api/projects/${slowProject.project.id}/jobs/${slowProject.job.id}/retry`, { method: 'POST', body: '{}' });
  assert.ok(retryable.job && retryable.job.retryOfId === slowProject.job.id, 'retry links back to the interrupted job');
  await json(`/api/jobs/${retryable.job.id}/cancel`, { method: 'POST', body: JSON.stringify({ mode: 'stop' }) });
  await waitPipelineJob(slowProject.project.id);
  console.log('PASS cancel stops the run quickly, keeps no half-written stage data and supports retry');

  // --- 暂停 vs 立即停止（D4）：暂停=写完当前章才停且可继续；停止=立刻丢弃当前章且不可继续 ---
  await json('/api/settings', {
    method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
  });
  const pauseProject = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '暂停语义', type: 'novel', genre: '悬疑', premise: '录音笔里出现了明天的审讯', targetWords: 12000, start: 'pipeline' }),
  });
  const pauseProjectId = pauseProject.project.id;
  await waitPipelineJob(pauseProjectId);
  await json(`/api/projects/${pauseProjectId}/stages/p1/confirm`, { method: 'POST' });
  await json(`/api/projects/${pauseProjectId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  await waitPipelineJob(pauseProjectId);
  await json(`/api/projects/${pauseProjectId}/stages/p2/confirm`, { method: 'POST' });
  await json(`/api/projects/${pauseProjectId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(pauseProjectId);
  await json(`/api/projects/${pauseProjectId}/stages/p3/confirm`, { method: 'POST' });

  // 写作阶段换回「慢」假供应商：每章 8s，便于在写到一半时按暂停
  await json('/api/settings', {
    method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }),
  });
  fakeMode = 'slow';
  fakeText = '雨点敲在审讯室的铁窗上，他把录音笔推到桌子中央，谁也没有先开口。'.repeat(120);
  const writeStartedAt = Date.now();
  await json(`/api/projects/${pauseProjectId}/writing/start`, { method: 'POST', body: JSON.stringify({ mode: 'continuous' }) });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const pauseAckAt = Date.now();
  const pauseAck = await json(`/api/projects/${pauseProjectId}/writing/pause`, { method: 'POST', body: '{}' });
  const pauseAckLatency = Date.now() - pauseAckAt;
  assert.ok(pauseAckLatency < 2000, `pause is acknowledged immediately (${pauseAckLatency}ms)`);
  assert.equal(pauseAck.job.state, 'pausing', 'pause is pending while the current chapter is still being written');
  assert.equal(pauseAck.job.pausePending, true, 'pausePending tells the UI the in-flight chapter is finishing');

  const pausedSnap = await waitPipelineJob(pauseProjectId);
  const pauseSettledAfter = Date.now() - writeStartedAt;
  assert.equal(pausedSnap.lastJob.state, 'paused', 'pausing lands in paused (not cancelled) after the current chapter');
  assert.ok(pauseSettledAfter >= 7000, `pause waited for the in-flight chapter instead of aborting it (${pauseSettledAfter}ms)`);
  assert.equal(pausedSnap.stages.p4.status, 'review');
  assert.equal(pausedSnap.nextStep.kind, 'resume-writing');
  const pausedUnits = (await json(`/api/projects/${pauseProjectId}/units`)).units;
  const writtenWhilePausing = pausedUnits.filter((unit) => unit.words > 0);
  assert.equal(writtenWhilePausing.length, 1, 'pausing keeps exactly the chapter that was in flight');
  assert.equal(writtenWhilePausing[0].reviewStatus, 'in_review', 'the finished chapter is kept for review');
  assert.ok(
    pausedUnits.filter((unit) => unit.id !== writtenWhilePausing[0].id).every((unit) => unit.words === 0 && unit.reviewStatus === 'pending'),
    'paused run leaves the remaining chapters untouched and pending',
  );

  const continued = await json(`/api/projects/${pauseProjectId}/writing/continue`, { method: 'POST', body: '{}' });
  assert.equal(continued.job.retryOfId, pausedSnap.lastJob.id, 'continue resumes the paused job');
  const pausedChapterIds = writtenWhilePausing.map((unit) => unit.id);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await json(`/api/projects/${pauseProjectId}/writing/stop`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
  const stoppedSnap = await waitPipelineJob(pauseProjectId);
  assert.equal(stoppedSnap.lastJob.state, 'cancelled', 'stopping is user_cancel, not paused');
  const stoppedUnits = (await json(`/api/projects/${pauseProjectId}/units`)).units;
  const writtenAfterStop = stoppedUnits.filter((unit) => unit.words > 0);
  assert.deepEqual(writtenAfterStop.map((unit) => unit.id), pausedChapterIds, 'the chapter aborted by stop is not written at all');
  assert.ok(stoppedUnits.every((unit) => unit.reviewStatus !== 'generating'), 'no unit is left in generating after a stop');
  const continueAfterStop = await fetch(`${base}/api/projects/${pauseProjectId}/writing/continue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(continueAfterStop.status, 400, 'a stopped run cannot be continued (only a paused one can)');
  assert.equal((await continueAfterStop.json()).code, 'BAD_REQUEST');
  fakeMode = 'ok';
  fakeText = '一段正文。';
  await json('/api/settings', {
    method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }),
  });
  console.log('PASS pause finishes the current chapter and can continue, stop aborts it and cannot continue');

  // --- 断点恢复：进程被杀时正在跑的 job 必须变成 interrupted，且能从第一个未完成单元继续 ---
  fakeMode = 'slow';
  const interrupted = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '断点恢复', type: 'novel', targetWords: 12000, start: 'pipeline' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  server.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { stdout += String(data); });
  server.stderr.on('data', (data) => { stderr += String(data); });
  await waitForServer();
  const crashedSnap = await json(`/api/projects/${interrupted.project.id}/pipeline`);
  assert.equal(crashedSnap.lastJob.state, 'interrupted', 'a job killed with the process is marked interrupted');
  assert.equal(crashedSnap.lastError.code, 'INTERRUPTED', 'the interruption is reported with its own code, not a model error');
  assert.equal(crashedSnap.nextStep.kind, 'retry-failed', 'interrupted work is offered as a retry');
  fakeMode = 'ok';
  const resumed = await json(`/api/projects/${interrupted.project.id}/jobs/${interrupted.job.id}/retry`, { method: 'POST', body: '{}' });
  assert.equal(resumed.job.retryOfId, interrupted.job.id);
  await waitPipelineJob(interrupted.project.id);
  const resumedSnap = await waitPipelineJob(interrupted.project.id);
  console.log('PASS interrupted job is marked and resumed through retry');

  // --- 结构化校验失败必须可读，且不被吞成空内容 ---
  fakeMode = 'invalid';
  const invalidProject = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '格式错误', type: 'novel', targetWords: 12000, start: 'pipeline' }),
  });
  const invalidSnap = await waitPipelineJob(invalidProject.project.id);
  assert.equal(invalidSnap.lastError.code, 'INVALID_JSON');
  assert.equal(invalidSnap.lastJob.state, 'failed');
  assert.equal(invalidSnap.stages.p1.status, 'failed', 'failed stage is visible as failed');
  assert.equal(invalidSnap.stages.p1.counts.items, 0, 'invalid output is not stored as an empty item');
  const rejectedRevisions = (await json(`/api/projects/${invalidProject.project.id}/stages/p1/revisions`)).revisions;
  assert.ok(rejectedRevisions.some((revision) => revision.source === 'ai_rejected'), 'raw invalid output is kept for diagnosis');
  fakeMode = 'ok';
  await json('/api/settings', {
    method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
  });
  console.log('PASS invalid model output fails with a readable code instead of empty content');

  // --- 旧作品迁移：可重入、可回退、正文/版本/设定不丢 ---
  const legacyProject = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '旧作品迁移', type: 'novel', description: '旧的一句话简介' }),
  });
  const legacyId = legacyProject.project.id;
  const legacyChapterId = legacyProject.project.chapters[0].id;
  const legacyText = '第一章正文，迁移前后必须逐字节一致。\n\n第二段也不能少。';
  await json(`/api/chapters/${legacyChapterId}`, { method: 'PATCH', body: JSON.stringify({ content: legacyText }) });
  await json(`/api/chapters/${legacyChapterId}/versions`, { method: 'POST', body: JSON.stringify({ source: '迁移前快照' }) });
  await json(`/api/projects/${legacyId}/characters`, { method: 'POST', body: JSON.stringify({ name: '旧人物', role: '主角' }) });
  const legacyBefore = await json(`/api/projects/${legacyId}`);
  const migration = await json(`/api/projects/${legacyId}/migrate`, { method: 'POST', body: '{}' });
  assert.equal(migration.migration.state, 'done');
  assert.ok(migration.migration.checks.every((check) => check.ok), `all migration checks pass: ${migration.migration.checks.filter((check) => !check.ok).map((check) => check.id).join(',')}`);
  assert.ok(migration.migration.backupPath, 'migration writes a backup before touching data');
  const legacyAfter = await json(`/api/projects/${legacyId}`);
  assert.equal(legacyAfter.project.chapters[0].content, legacyText, 'chapter text is byte-identical after migration');
  assert.equal(legacyAfter.project.chapters[0].words, legacyBefore.project.chapters[0].words, 'word count is not recalculated');
  assert.equal(legacyAfter.project.characters.length, legacyBefore.project.characters.length, 'characters survive migration');
  assert.equal(legacyAfter.project.outline.acts.length, legacyBefore.project.outline.acts.length, 'acts survive migration');
  const migratedSnap = await json(`/api/projects/${legacyId}/pipeline`);
  assert.equal(migratedSnap.project.pipelineStatus, 'reviewing');
  assert.equal(migratedSnap.stages.p1.status, 'confirmed');
  assert.equal(migratedSnap.stages.p3.status, 'review', 'migration never auto-confirms the chapter plan');
  const migrationAgain = await json(`/api/projects/${legacyId}/migrate`, { method: 'POST', body: '{}' });
  assert.equal(migrationAgain.migration.alreadyMigrated, true, 'migrating twice is idempotent');
  const versionsAfterMigration = await json(`/api/projects/${legacyId}/versions`);
  const versionsBeforeMigration = await json(`/api/projects/${legacyId}/versions`);
  assert.equal(versionsAfterMigration.versions.length, versionsBeforeMigration.versions.length, 'migration does not duplicate versions');
  const rolledBack = await json(`/api/projects/${legacyId}/migrate/rollback`, { method: 'POST', body: JSON.stringify({ mode: 'sql', confirm: true }) });
  assert.equal(rolledBack.migration.state, 'rolled_back');
  const afterRollback = await json(`/api/projects/${legacyId}`);
  assert.equal(afterRollback.project.chapters[0].content, legacyText, 'rollback keeps the original text');
  assert.equal((await json(`/api/projects/${legacyId}/pipeline`)).project.pipelineStatus, 'legacy', 'rollback restores the legacy status');
  const remigrated = await json(`/api/projects/${legacyId}/migrate`, { method: 'POST', body: '{}' });
  assert.equal(remigrated.migration.state, 'done', 'a rolled back project can be migrated again');

  const failingLegacy = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '迁移失败', type: 'novel' }),
  });
  await json(`/api/chapters/${failingLegacy.project.chapters[0].id}`, { method: 'PATCH', body: JSON.stringify({ content: '失败也要能读' }) });
  const failedMigration = await fetch(`${base}/api/projects/${failingLegacy.project.id}/migrate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceFail: true }),
  });
  assert.equal(failedMigration.status, 500);
  assert.equal((await failedMigration.json()).code, 'MIGRATION_CHECK_FAILED');
  const afterFailedMigration = await json(`/api/projects/${failingLegacy.project.id}`);
  assert.equal(afterFailedMigration.project.chapters[0].content, '失败也要能读', 'a failed migration leaves the old data readable');
  const failedView = await json(`/api/projects/${failingLegacy.project.id}/migration`);
  assert.equal(failedView.migration.state, 'failed', 'a failed migration is recorded with an explicit state');
  console.log('PASS legacy migration is re-entrant, rollback-safe and never loses text/versions/settings');

  // --- 短篇：同等阶段 + scenes/beats 等价结构 ---
  const shortProject = await json('/api/projects', {
    method: 'POST', body: JSON.stringify({ title: '流水线短篇', type: 'short', targetWords: 12000, start: 'pipeline' }),
  });
  const shortId = shortProject.project.id;
  await waitPipelineJob(shortId);
  await json(`/api/projects/${shortId}/stages/p1/confirm`, { method: 'POST' });
  await json(`/api/projects/${shortId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  await waitPipelineJob(shortId);
  await json(`/api/projects/${shortId}/stages/p2/confirm`, { method: 'POST' });
  await json(`/api/projects/${shortId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(shortId);
  const shortPlan = await json(`/api/projects/${shortId}/units`);
  assert.ok(shortPlan.units.length >= 3, 'short project plans beats');
  const shortPlanSnap = await json(`/api/projects/${shortId}/pipeline`);
  assert.equal(shortPlanSnap.nextStep.kind, 'review-p3');
  assert.ok(shortPlanSnap.nextStep.label.includes('节拍'), `short nextStep speaks in beats: ${shortPlanSnap.nextStep.label}`);
  assert.ok(!shortPlanSnap.nextStep.label.includes('章节'), 'short nextStep never says 章节');
  assert.equal((await json(`/api/projects/${shortId}`)).project.chapters.length, 0, 'short projects do not create chapter rows');
  await json(`/api/projects/${shortId}/stages/p3/confirm`, { method: 'POST' });
  await json(`/api/projects/${shortId}/writing/start`, { method: 'POST', body: JSON.stringify({ mode: 'single', unitId: shortPlan.units[0].id }) });
  const shortSnap = await waitPipelineJob(shortId);
  assert.equal(shortSnap.nextStep.kind, 'review-chapters');
  const shortUnits = (await json(`/api/projects/${shortId}/units`)).units;
  assert.ok(shortUnits[0].words > 0, 'the target beat got text');
  assert.ok(shortUnits.slice(1).every((unit) => unit.words === 0), 'other beats stay empty');

  // 短篇审阅：同一个 /api/chapters/:id/review 入口必须能审节拍（DEF-2）
  const approvedBeat = await json(`/api/chapters/${shortUnits[0].id}/review`, {
    method: 'POST', body: JSON.stringify({ action: 'approve' }),
  });
  assert.equal(approvedBeat.unit.unit.reviewStatus, 'approved', 'a beat can be approved through the review entry point');
  await json(`/api/projects/${shortId}/writing/start`, { method: 'POST', body: JSON.stringify({ mode: 'single', unitId: shortUnits[1].id }) });
  await waitPipelineJob(shortId);
  const rejectedBeat = await json(`/api/chapters/${shortUnits[1].id}/review`, {
    method: 'POST', body: JSON.stringify({ action: 'request_changes', note: '这一节拍的对白太顺了，加一次打断' }),
  });
  assert.equal(rejectedBeat.unit.unit.reviewStatus, 'changes_requested', 'a beat can be sent back with a note');
  console.log('PASS short projects run the same pipeline with beat plans instead of chapters');

  // --- 回归（t13/DEF-1）：P2 单条意见重生成不得把已确认的 P1 打回 review，且修订要记到 p2 + ai_feedback ---
  const regressProject = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '回归 P2 单条重生成', type: 'novel', premise: '一个关于回声的故事', targetWords: 12000, start: 'pipeline' }),
  });
  const regressId = regressProject.project.id;
  await waitPipelineJob(regressId);
  await json(`/api/projects/${regressId}/stages/p1/confirm`, { method: 'POST' });
  await json(`/api/projects/${regressId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  await waitPipelineJob(regressId);
  const regressActs = (await json(`/api/projects/${regressId}/stages/p2/items`)).items.filter((item) => item.kind === 'act');
  assert.ok(regressActs.length >= 2, 'p2 produced acts');
  const actId = regressActs[0].id;
  await json(`/api/projects/${regressId}/stages/p2/feedback`, {
    method: 'POST', body: JSON.stringify({ scope: 'item', targetId: actId, note: '这一幕开头的冲突要更早出现' }),
  });
  await waitPipelineJob(regressId);
  const afterActRegen = await json(`/api/projects/${regressId}/pipeline`);
  assert.equal(afterActRegen.stages.p1.status, 'confirmed', 'regenerating a p2 item never knocks confirmed p1 back into review');
  const actRevisions = (await json(`/api/projects/${regressId}/stages/p2/revisions?targetId=${actId}`)).revisions;
  assert.ok(actRevisions.some((revision) => revision.source === 'ai_feedback'), 'feedback regeneration records an ai_feedback revision');
  const actOnP1 = (await json(`/api/projects/${regressId}/stages/p1/revisions?targetId=${actId}`)).revisions;
  assert.equal(actOnP1.length, 0, 'act revisions are filed under p2, not p1');
  const p2Confirmed = await json(`/api/projects/${regressId}/stages/p2/confirm`, { method: 'POST' });
  assert.equal(p2Confirmed.stage, 'p2');
  assert.equal(p2Confirmed.status, 'confirmed', 'a single-item regeneration does not block the p2 confirmation');
  console.log('PASS regenerating one p2 item keeps p1 confirmed and still allows p2 confirmation');

  // --- D9：手改标记由服务端判定，客户端伪造 manuallyEdited=false 也不能覆盖 ---
  await json(`/api/projects/${regressId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(regressId);
  const regressUnits = (await json(`/api/projects/${regressId}/units`)).units;
  assert.ok(regressUnits.length >= 3, 'p3 planned units');
  await json(`/api/projects/${regressId}/stages/p3/units/${regressUnits[0].id}`, {
    method: 'PATCH', body: JSON.stringify({ minWords: 1200, targetWords: 1500, maxWords: 2000 }),
  });
  const guardPreview = await json(`/api/projects/${regressId}/stages/p3/units/allocate`, {
    method: 'POST', body: JSON.stringify({ totalTarget: 12000 }),
  });
  assert.equal(guardPreview.preview.find((row) => row.unitId === regressUnits[0].id).manuallyEdited, true, 'the server reports the manual edit itself');
  const forgedRows = guardPreview.preview.map((row) => ({ ...row, manuallyEdited: false }));
  const forgedApply = await fetch(`${base}/api/projects/${regressId}/stages/p3/units/allocate/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: forgedRows }),
  });
  assert.equal(forgedApply.status, 422, 'a forged manuallyEdited=false cannot overwrite a hand-edited target');
  assert.equal((await forgedApply.json()).code, 'TARGET_EDITED');
  const forcedApply = await json(`/api/projects/${regressId}/stages/p3/units/allocate/apply`, {
    method: 'POST', body: JSON.stringify({ rows: forgedRows, includeEdited: true }),
  });
  assert.ok(forcedApply.summary.units >= 3, 'includeEdited applies the allocation');
  console.log('PASS allocation judges hand-edited targets on the server and ignores client flags');

  // --- 上游变更：已确认的下游阶段保持 confirmed；「复核并保留」只清 stale，不回滚确认 ---
  const regressChars = (await json(`/api/projects/${regressId}/stages/p1/items`)).items.filter((item) => item.kind === 'character');
  assert.ok(regressChars.length >= 1, 'p1 characters are available for the stale case');
  await json(`/api/projects/${regressId}/items/${regressChars[0].id}`, {
    method: 'PATCH', body: JSON.stringify({ title: `${regressChars[0].title}（改）` }),
  });
  const staleSnap = await json(`/api/projects/${regressId}/pipeline`);
  assert.equal(staleSnap.stages.p2.status, 'confirmed', 'an upstream edit never rolls a confirmed downstream stage back');
  assert.equal(staleSnap.stages.p2.staleReason, 'p1:edited', 'the stale reason names the upstream stage and the action');
  const keptStale = await json(`/api/projects/${regressId}/stages/p2/stale/resolve`, { method: 'POST', body: JSON.stringify({ action: 'keep' }) });
  assert.equal(keptStale.stage.status, 'confirmed', 'keep does not change the confirmed status');
  const clearedSnap = await json(`/api/projects/${regressId}/pipeline`);
  assert.equal(clearedSnap.stages.p2.staleReason, null, '"keep" clears the stale reason so the banner can go away');
  assert.equal(clearedSnap.stages.p2.status, 'confirmed');
  console.log('PASS an upstream edit marks the confirmed stage stale, and "keep" clears it without rolling back');

  // --- DEF-13 回归：上游已回到 review 后再次编辑，仍要给下游 confirmed 阶段标 stale ---
  await json(`/api/projects/${regressId}/items/${regressChars[0].id}`, {
    method: 'PATCH', body: JSON.stringify({ title: `${regressChars[0].title}（再改一次）` }),
  });
  const reEditedSnap = await json(`/api/projects/${regressId}/pipeline`);
  assert.equal(reEditedSnap.stages.p1.status, 'review', 'the edited upstream stage stays in review');
  assert.equal(reEditedSnap.stages.p2.status, 'confirmed', 'the downstream confirmation is still not rolled back');
  assert.equal(reEditedSnap.stages.p2.staleReason, 'p1:edited', 'a second upstream edit re-marks the confirmed downstream stage');
  console.log('PASS editing an upstream stage that is already in review keeps re-marking the confirmed downstream stage stale');

  // --- SPEC M3：P1/P2 条目新增 / 删除 / 排序，P3 章节计划排序 ---
  const stageItemsOf = async (projectId, stage) => (await json(`/api/projects/${projectId}/stages/${stage}/items`)).items;
  const envsBefore = (await stageItemsOf(regressId, 'p1')).filter((item) => item.kind === 'env');
  const createdEnv = await json(`/api/projects/${regressId}/stages/p1/items`, {
    method: 'POST', body: JSON.stringify({ kind: 'env', title: '新增的一处场景' }),
  });
  assert.equal(createdEnv.stage, 'p1');
  assert.equal(createdEnv.item.kind, 'env');
  assert.equal(createdEnv.item.title, '新增的一处场景');
  assert.ok(createdEnv.item.revisionCount >= 1, 'a hand-added item opens with a manual revision');
  const createdChar = await json(`/api/projects/${regressId}/stages/p1/items`, {
    method: 'POST', body: JSON.stringify({ kind: 'character', title: '新增的配角', payload: { role: '证人', motivation: '想保住家人' } }),
  });
  assert.equal(createdChar.item.kind, 'character');
  const envIds = (await stageItemsOf(regressId, 'p1')).filter((item) => item.kind === 'env').map((item) => item.id);
  assert.equal(envIds.length, envsBefore.length + 1);
  const envReversed = [...envIds].reverse();
  const reorderedEnvs = await json(`/api/projects/${regressId}/stages/p1/items/reorder`, {
    method: 'POST', body: JSON.stringify({ block: 'env', ids: envReversed }),
  });
  assert.deepEqual(reorderedEnvs.items.filter((item) => item.kind === 'env').map((item) => item.id), envReversed, 'env order is persisted');
  assert.equal(reorderedEnvs.stage, 'p1');

  const badReorder = await fetch(`${base}/api/projects/${regressId}/stages/p1/items/reorder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block: 'env', ids: [envReversed[0], 'itm_not_mine'] }),
  });
  assert.equal(badReorder.status, 400, 'reorder refuses ids that are not exactly this block');

  await json(`/api/projects/${regressId}/items/${createdChar.item.id}/lock`, { method: 'POST', body: JSON.stringify({ locked: true }) });
  const lockedDelete = await fetch(`${base}/api/projects/${regressId}/items/${createdChar.item.id}`, { method: 'DELETE' });
  assert.equal(lockedDelete.status, 409, 'a locked item refuses to be deleted');
  assert.equal((await lockedDelete.json()).code, 'ITEM_LOCKED');
  await json(`/api/projects/${regressId}/items/${createdChar.item.id}/lock`, { method: 'POST', body: JSON.stringify({ locked: false }) });
  const deletedChar = await json(`/api/projects/${regressId}/items/${createdChar.item.id}`, { method: 'DELETE' });
  assert.equal(deletedChar.stage, 'p1');
  assert.deepEqual(deletedChar.deleted, [createdChar.item.id]);
  const deletedEnv = await json(`/api/projects/${regressId}/items/${createdEnv.item.id}`, { method: 'DELETE' });
  assert.equal(deletedEnv.stage, 'p1');

  const p2Acts = (await stageItemsOf(regressId, 'p2')).filter((item) => item.kind === 'act');
  assert.ok(p2Acts.length >= 2, 'p2 has acts to reorder');
  const actReversed = [...p2Acts.map((item) => item.id)].reverse();
  const reorderedActs = await json(`/api/projects/${regressId}/stages/p2/items/reorder`, {
    method: 'POST', body: JSON.stringify({ block: 'acts', ids: actReversed }),
  });
  assert.deepEqual(reorderedActs.items.filter((item) => item.kind === 'act').map((item) => item.id), actReversed, 'act order is persisted');

  const createdAct = await json(`/api/projects/${regressId}/stages/p2/items`, { method: 'POST', body: JSON.stringify({ kind: 'act', title: '新增的一幕' }) });
  assert.equal(createdAct.item.kind, 'act');
  const createdBeat = await json(`/api/projects/${regressId}/stages/p2/items`, {
    method: 'POST', body: JSON.stringify({ kind: 'beat', parentId: createdAct.item.id, title: '新增的节拍' }),
  });
  assert.equal(createdBeat.item.kind, 'beat');
  assert.equal(createdBeat.item.payload.actId, createdAct.item.id, 'a new beat hangs under its act');
  const actBeats = (await stageItemsOf(regressId, 'p2')).filter((item) => item.kind === 'beat' && item.payload.actId === createdAct.item.id);
  assert.equal(actBeats.length, 1);
  const deletedBeat = await json(`/api/projects/${regressId}/items/${createdBeat.item.id}`, { method: 'DELETE' });
  assert.equal(deletedBeat.stage, 'p2');
  const deletedAct = await json(`/api/projects/${regressId}/items/${createdAct.item.id}`, { method: 'DELETE' });
  assert.equal(deletedAct.stage, 'p2');

  const planUnits = (await json(`/api/projects/${regressId}/units`)).units;
  assert.ok(planUnits.length >= 3, 'p3 has units to reorder');
  const unitReversed = [...planUnits.map((unit) => unit.id)].reverse();
  const reorderedUnits = await json(`/api/projects/${regressId}/stages/p3/units/reorder`, {
    method: 'POST', body: JSON.stringify({ ids: unitReversed }),
  });
  assert.ok(reorderedUnits.summary.units >= 3, 'the reorder response carries the refreshed plan summary');
  assert.equal(reorderedUnits.summary.totalTarget > 0, true);
  const unitsAfterReorder = (await json(`/api/projects/${regressId}/units`)).units;
  assert.deepEqual(unitsAfterReorder.map((unit) => unit.id), unitReversed, 'chapter plan order is persisted');
  assert.deepEqual(unitsAfterReorder.map((unit) => unit.ordinal), unitReversed.map((_, index) => index), 'ordinals follow the new order');
  const badUnitReorder = await fetch(`${base}/api/projects/${regressId}/stages/p3/units/reorder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [unitReversed[0]] }),
  });
  assert.equal(badUnitReorder.status, 400, 'unit reorder needs every unit exactly once');
  console.log('PASS stage items and chapter plans can be added, deleted and reordered');

  // --- F1：章节计划的历史恢复不能撞嵌套事务（withTx 已改为 SAVEPOINT） ---
  const planUnitId = firstUnit.id;
  const planBefore = (await json(`/api/projects/${pipelineId}/units`)).units.find((unit) => unit.id === planUnitId);
  await json(`/api/projects/${pipelineId}/stages/p3/units/${planUnitId}`, {
    method: 'PATCH', body: JSON.stringify({ minWords: 2000, targetWords: 2200, maxWords: 2600 }),
  });
  const planRevisions = (await json(`/api/projects/${pipelineId}/stages/p3/revisions?targetId=${planUnitId}`)).revisions;
  assert.ok(planRevisions.length >= 2, 'editing the plan keeps a revision trail');
  const restoreTarget = planRevisions[planRevisions.length - 1];
  const restoredPlan = await fetch(`${base}/api/projects/${pipelineId}/items/${planUnitId}/revisions/${restoreTarget.id}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(restoredPlan.status, 200, 'restoring a chapter plan revision must not fail on nested transactions');
  const planAfterRestore = (await json(`/api/projects/${pipelineId}/units`)).units.find((unit) => unit.id === planUnitId);
  const restoreValues = JSON.parse(restoreTarget.content || '{}');
  const restoreRange = restoreValues.payload || restoreValues;
  assert.equal(planAfterRestore.targetWords, Number(restoreRange.targetWords), 'restore puts the recorded target back');
  assert.equal(planAfterRestore.minWords, Number(restoreRange.minWords), 'restore puts the recorded minimum back');
  assert.equal(planAfterRestore.maxWords, Number(restoreRange.maxWords), 'restore puts the recorded maximum back');
  assert.equal(planAfterRestore.targetWords, planBefore.targetWords, 'the restored target matches what the plan had before the edit');
  console.log('PASS chapter plan revisions restore through nested transactions');

  // 计划被改过之后 P3 会按 SPEC R2 回落到「待确认」，这里重新确认，
  // 让后面的重启用例断言的是「已确认的阶段重启后仍然是已确认」。
  const reconfirmedP3 = await json(`/api/projects/${pipelineId}/stages/p3/confirm`, { method: 'POST' });
  assert.equal(reconfirmedP3.status, 'confirmed', 'the edited chapter plan can be confirmed again');

  // --- F7/F8：覆盖手改条目要先确认；生成期间禁止并发写 ---
  const guardProject = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '守卫项目', type: 'novel', premise: '一个关于守夜人的故事', targetWords: 12000, start: 'pipeline' }),
  });
  const guardId = guardProject.project.id;
  await waitPipelineJob(guardId);
  const guardCharacters = (await json(`/api/projects/${guardId}/stages/p1/items`)).items.filter((item) => item.kind === 'character');
  assert.ok(guardCharacters.length >= 2, 'the guard project produced characters');
  await json(`/api/projects/${guardId}/items/${guardCharacters[0].id}`, { method: 'PATCH', body: JSON.stringify({ title: '手改过的主角' }) });
  const blockedRegen = await fetch(`${base}/api/projects/${guardId}/stages/p1/regenerate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'all' }),
  });
  assert.equal(blockedRegen.status, 422, 'regenerating over hand edits needs an explicit confirmation');
  const blockedRegenBody = await blockedRegen.json();
  assert.equal(blockedRegenBody.code, 'CONFIRM_BLOCKED');
  assert.ok(Array.isArray(blockedRegenBody.blockers) && blockedRegenBody.blockers.length >= 1, 'the blocker names the items that would be overwritten');
  // 锁一条，保证它在整阶段重建里不会被换掉（否则并发写会先 404 而不是 409）
  await json(`/api/projects/${guardId}/items/${guardCharacters[1].id}/lock`, { method: 'POST', body: JSON.stringify({ locked: true }) });
  // 换成慢供应商，让「生成期间」这个窗口真实存在（mock 是同步的，会瞬间跑完）
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }) });
  fakeMode = 'slow';
  const confirmedRegen = await json(`/api/projects/${guardId}/stages/p1/regenerate`, {
    method: 'POST', body: JSON.stringify({ scope: 'all', confirmOverwrite: true }),
  });
  assert.ok(confirmedRegen.job, 'confirming the overwrite starts the job');
  const writeDuringGeneration = await fetch(`${base}/api/projects/${guardId}/items/${guardCharacters[1].id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '生成期间写' }),
  });
  assert.equal(writeDuringGeneration.status, 409, 'editing during generation is refused');
  assert.equal((await writeDuringGeneration.json()).code, 'CONCURRENT_JOB', 'the refusal names the running generation');
  const deleteDuringGeneration = await fetch(`${base}/api/projects/${guardId}/items/${guardCharacters[1].id}`, { method: 'DELETE' });
  assert.equal(deleteDuringGeneration.status, 409, 'deleting during generation is refused');
  const reorderDuringGeneration = await fetch(`${base}/api/projects/${guardId}/stages/p1/items/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: 'characters', ids: guardCharacters.map((item) => item.id).reverse() }),
  });
  assert.equal(reorderDuringGeneration.status, 409, 'reordering during generation is refused');
  await json(`/api/jobs/${confirmedRegen.job.id}/cancel`, { method: 'POST', body: JSON.stringify({ mode: 'stop' }) });
  await waitPipelineJob(guardId);
  fakeMode = 'ok';
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
  // F12：单条重生成不撤销本阶段的确认（只多一条修订 + 给下游标 stale）
  await json(`/api/projects/${guardId}/stages/p1/confirm`, { method: 'POST' });
  const afterCancelCharacters = (await json(`/api/projects/${guardId}/stages/p1/items`)).items.filter((item) => item.kind === 'character');
  await json(`/api/projects/${guardId}/stages/p1/regenerate`, {
    method: 'POST', body: JSON.stringify({ scope: 'item', targetId: afterCancelCharacters[0].id, note: '这一句太顺了，加一次打断' }),
  });
  await waitPipelineJob(guardId);
  const afterItemRegen = await json(`/api/projects/${guardId}/pipeline`);
  assert.equal(afterItemRegen.stages.p1.status, 'confirmed', 'single-item regeneration keeps the stage confirmation');
  const itemRegenSources = (await json(`/api/projects/${guardId}/stages/p1/revisions?targetId=${afterCancelCharacters[0].id}`)).revisions.map((revision) => revision.source);
  assert.ok(itemRegenSources.includes('ai_feedback'), 'the revision records that it came from feedback');
  console.log('PASS regenerating over hand edits needs confirmation and blocks concurrent writes');

  // --- F3/F9/F10：旧短篇迁移后能确认、排序后正文归属正确、能导出 ---
  const legacyShort = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: '旧短篇', type: 'short' }) });
  const legacyShortId = legacyShort.project.id;
  await json(`/api/chapters/${legacyShort.project.chapters[0].id}`, {
    method: 'PATCH', body: JSON.stringify({ content: '开头的一段正文，讲的是雨夜里的一盏灯。\n\n第二段继续写那盏灯。' }),
  });
  const legacyShortSecond = await json(`/api/projects/${legacyShortId}/chapters`, { method: 'POST', body: JSON.stringify({ title: '第二节' }) });
  await json(`/api/chapters/${legacyShortSecond.chapter.id}`, { method: 'PATCH', body: JSON.stringify({ content: '第二节的正文，写的是灯灭之后。' }) });
  const legacyShortThird = await json(`/api/projects/${legacyShortId}/chapters`, { method: 'POST', body: JSON.stringify({ title: '第三节' }) });
  await json(`/api/chapters/${legacyShortThird.chapter.id}`, { method: 'PATCH', body: JSON.stringify({ content: '第三节的正文，写的是天亮之前。' }) });
  const legacyShortMigration = await json(`/api/projects/${legacyShortId}/migrate`, { method: 'POST', body: '{}' });
  assert.equal(legacyShortMigration.migration.state, 'done');
  const legacyShortUnits = (await json(`/api/projects/${legacyShortId}/units`)).units;
  assert.equal(legacyShortUnits.length, 3, 'each legacy chapter becomes one beat');
  const legacyShortPlan = (await json(`/api/projects/${legacyShortId}/pipeline`));
  assert.equal(legacyShortPlan.stages.p3.status, 'review', 'a migrated plan waits for a human');
  assert.equal(legacyShortPlan.nextStep.kind, 'review-p3');
  // F3：迁移补出来的大纲 + 自动接受偏差，让确认能直接通过
  const legacyShortConfirm = await json(`/api/projects/${legacyShortId}/stages/p3/confirm`, { method: 'POST' });
  assert.equal(legacyShortConfirm.status, 'confirmed', 'a migrated plan can be confirmed without hand-editing it first');
  // F9：反转节拍顺序后重写，正文必须落回排在第一的那一行
  await json(`/api/projects/${legacyShortId}/stages/p3/units/reorder`, {
    method: 'POST', body: JSON.stringify({ ids: [legacyShortUnits[1].id, legacyShortUnits[0].id, ...legacyShortUnits.slice(2).map((unit) => unit.id)] }),
  });
  fakeText = '雨点敲在审讯室的铁窗上，他把录音笔推到桌子中央，谁也没有先开口。'.repeat(60);
  await json(`/api/chapters/${legacyShortUnits[1].id}/review`, { method: 'POST', body: JSON.stringify({ action: 'rewrite', note: '给这一节加一场雨' }) });
  await waitPipelineJob(legacyShortId);
  const legacyShortAfter = (await json(`/api/projects/${legacyShortId}/units`)).units;
  assert.equal(legacyShortAfter[0].id, legacyShortUnits[1].id, 'the rewritten beat is first after reordering');
  const legacyShortItems = (await json(`/api/projects/${legacyShortId}/stages/p4/items`)).items;
  const rewrittenBody = legacyShortItems.find((item) => item.id === legacyShortUnits[1].id)?.body || '';
  assert.ok(rewrittenBody.length > 100, 'the rewritten beat has a body');
  const legacyShortDetail = await json(`/api/projects/${legacyShortId}`);
  const mirroredChapters = legacyShortDetail.project.chapters.filter((chapter) => !chapter.deletedAt);
  assert.equal(mirroredChapters[0].content, rewrittenBody, 'the mirror chapter row follows the beat it now represents');
  assert.ok(String(mirroredChapters[0].number || '').includes('1'), 'the mirror row is renumbered with the beat order');
  // F10：短篇按节拍语料导出，不再 400
  const shortExport = await fetch(`${base}/api/projects/${legacyShortId}/export`);
  assert.equal(shortExport.status, 200, 'short projects export markdown from beat bodies');
  const shortExportText = await shortExport.text();
  assert.ok(shortExportText.includes(rewrittenBody.slice(0, 20)), 'exported markdown carries the beat text');
  const shortDocx = await fetch(`${base}/api/projects/${legacyShortId}/export.docx`);
  assert.equal(shortDocx.status, 200, 'short projects export docx from beat bodies');
  assert.ok((await shortDocx.arrayBuffer()).byteLength > 2000, 'the docx is not empty');
  console.log('PASS migrated short projects confirm, reorder, rewrite and export beat text');

  // --- F4：升级后已有新内容时，回退必须显式确认 ---
  const touchedRollback = await fetch(`${base}/api/projects/${legacyShortId}/migrate/rollback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'sql', confirm: false }),
  });
  const touchedBody = await touchedRollback.json();
  assert.equal(touchedRollback.status, 422, `rolling back over new content is refused without confirmation (${JSON.stringify(touchedBody)})`);
  assert.equal(touchedBody.code, 'CONFIRM_BLOCKED');
  assert.ok(Array.isArray(touchedBody.blockers) && touchedBody.blockers.length >= 1, 'the blocker lists what would be lost');
  const forcedRollback = await json(`/api/projects/${legacyShortId}/migrate/rollback`, {
    method: 'POST', body: JSON.stringify({ mode: 'sql', confirm: true }),
  });
  assert.equal(forcedRollback.migration.state, 'rolled_back');
  const legacyShortReadback = await json(`/api/projects/${legacyShortId}`);
  assert.ok(legacyShortReadback.project.chapters.some((chapter) => String(chapter.content || '').includes('雨夜里的一盏灯')), 'the original text survives the rollback');
  console.log('PASS rollback over new content needs explicit confirmation and keeps the original text');

  // --- N1：横幅「按上游重排」必须能带上覆盖确认（以前路由不转发，手改过就永久 422） ---
  const bannerCharacters = (await json(`/api/projects/${guardId}/stages/p1/items`)).items.filter((item) => item.kind === 'character');
  await json(`/api/projects/${guardId}/items/${bannerCharacters[0].id}`, { method: 'PATCH', body: JSON.stringify({ title: '横幅重排前手改的主角' }) });
  const bannerResolveBlocked = await fetch(`${base}/api/projects/${guardId}/stages/p1/stale/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regenerate' }),
  });
  const bannerResolveBlockedBody = await bannerResolveBlocked.json();
  assert.equal(bannerResolveBlocked.status, 422, `the banner regenerate still needs a confirmation over hand edits (${JSON.stringify(bannerResolveBlockedBody)})`);
  assert.equal(bannerResolveBlockedBody.code, 'CONFIRM_BLOCKED');
  assert.equal(bannerResolveBlockedBody.detail?.requiresConfirm, 'overwrite', 'the server tells the UI which confirmation is needed');
  const bannerResolveConfirmed = await json(`/api/projects/${guardId}/stages/p1/stale/resolve`, {
    method: 'POST', body: JSON.stringify({ action: 'regenerate', confirmOverwrite: true }),
  });
  assert.ok(bannerResolveConfirmed.job, 'confirming the overwrite lets the banner rebuild run');
  assert.ok(bannerResolveConfirmed.job.id, 'the banner rebuild starts a job');
  await waitPipelineJob(guardId);
  console.log('PASS the banner regenerate accepts an explicit overwrite confirmation');

  // --- N2：任何生成任务在跑时都不能改章节数（否则写作步写进被删掉的章 = 正文丢失 + 孤儿版本） ---
  const countGuard = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '章节数守卫', type: 'novel', premise: '一个关于守夜人的故事', targetWords: 12000, start: 'pipeline' }),
  });
  const countGuardId = countGuard.project.id;
  await waitPipelineJob(countGuardId);
  await json(`/api/projects/${countGuardId}/stages/p1/confirm`, { method: 'POST' });
  await json(`/api/projects/${countGuardId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  await waitPipelineJob(countGuardId);
  await json(`/api/projects/${countGuardId}/stages/p2/confirm`, { method: 'POST' });
  await json(`/api/projects/${countGuardId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(countGuardId);
  await json(`/api/projects/${countGuardId}/stages/p3/confirm`, { method: 'POST' });
  const countGuardUnits = (await json(`/api/projects/${countGuardId}/units`)).units;
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }) });
  fakeMode = 'slow';
  const countWriteJob = await json(`/api/projects/${countGuardId}/writing/start`, {
    method: 'POST', body: JSON.stringify({ mode: 'single', unitId: countGuardUnits[0].id }),
  });
  const countDuringWriting = await fetch(`${base}/api/projects/${countGuardId}/stages/p3/units/count`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: countGuardUnits.length + 2 }),
  });
  const countDuringWritingBody = await countDuringWriting.json();
  assert.equal(countDuringWriting.status, 409, `changing the chapter count during a run is refused (${JSON.stringify(countDuringWritingBody)})`);
  assert.equal(countDuringWritingBody.code, 'CONCURRENT_JOB', 'the refusal names the running job');
  await json(`/api/jobs/${countWriteJob.job.id}/cancel`, { method: 'POST', body: JSON.stringify({ mode: 'stop' }) });
  await waitPipelineJob(countGuardId);
  fakeMode = 'ok';
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
  const countWhenIdle = await json(`/api/projects/${countGuardId}/stages/p3/units/count`, {
    method: 'POST', body: JSON.stringify({ count: countGuardUnits.length }),
  });
  assert.ok(countWhenIdle.summary, 'the chapter count is editable again once the run stopped');
  console.log('PASS the chapter count cannot change while a generation job runs');

  // --- N4：P2 多幕重建中途停下要留「只完成一部分」的痕迹，旧内容不丢且能再点一次 ---
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }) });
  fakeMode = 'slowPlan';
  const partialRebuild = await json(`/api/projects/${countGuardId}/stages/p2/regenerate`, { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
  assert.ok(partialRebuild.job, 'the p2 rebuild starts');
  // 第一幕（acts）先落库，第二幕的节拍还在写的时候就停：这时阶段是「一半新一半旧」
  await new Promise((resolve) => setTimeout(resolve, 10000));
  await json(`/api/jobs/${partialRebuild.job.id}/cancel`, { method: 'POST', body: JSON.stringify({ mode: 'stop' }) });
  const partialSnap = await waitPipelineJob(countGuardId);
  assert.ok(partialSnap.stages.p2.partialAt, 'a rebuild stopped halfway records partialAt on the stage');
  assert.equal(partialSnap.stages.p2.status, 'review', 'the half-rebuilt stage still waits for a human');
  assert.equal(partialSnap.nextStep.kind, 'review-p2');
  assert.ok(String(partialSnap.nextStep.hint || '').includes('只完成了一部分'), 'nextStep tells the user the rebuild is incomplete');
  const partialItems = (await json(`/api/projects/${countGuardId}/stages/p2/items`)).items;
  assert.ok(partialItems.filter((item) => item.kind === 'act').length >= 1, 'the old/partial outline is still readable');
  // 再点一次就能跑完：跑完后痕迹必须消失，不能永久挂着「没做完」
  fakeMode = 'ok';
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
  await json(`/api/projects/${countGuardId}/stages/p2/regenerate`, { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
  const rebuiltSnap = await waitPipelineJob(countGuardId);
  assert.equal(rebuiltSnap.stages.p2.partialAt, null, 'finishing the rebuild clears partialAt');
  console.log('PASS a half-finished stage rebuild is marked and can be finished by running it again');

  // --- N3：回退按「迁移前的章节 id 清单」判定新章，改过功能列的老章不能被归档藏起来 ---
  const legacyNovel = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: '旧长篇待回退', type: 'novel' }) });
  const legacyNovelId = legacyNovel.project.id;
  await json(`/api/chapters/${legacyNovel.project.chapters[0].id}`, {
    method: 'PATCH', body: JSON.stringify({ content: '老章的正文，讲的是码头上的雾。\n\n第二段写雾里靠岸的船。' }),
  });
  await json(`/api/projects/${legacyNovelId}/migrate`, { method: 'POST', body: '{}' });
  const legacyNovelUnits = (await json(`/api/projects/${legacyNovelId}/units`)).units;
  assert.ok(legacyNovelUnits.length >= 1, 'the legacy novel migrated into units');
  // 用户只是改了下「功能」列（既不新增也不删章）：以前这会被当成升级后新增的章而归档
  await json(`/api/projects/${legacyNovelId}/stages/p3/units/${legacyNovelUnits[0].id}`, {
    method: 'PATCH', body: JSON.stringify({ function: '推进主线' }),
  });
  const legacyNovelRollback = await json(`/api/projects/${legacyNovelId}/migrate/rollback`, {
    method: 'POST', body: JSON.stringify({ mode: 'sql', confirm: true }),
  });
  assert.equal(legacyNovelRollback.migration.state, 'rolled_back');
  assert.equal(legacyNovelRollback.migration.legacyChapterIdsKnown, true, 'the rollback knows which chapters existed before the upgrade');
  assert.deepEqual(legacyNovelRollback.migration.archivedTitles || [], [], 'an edited legacy chapter is never archived by the rollback');
  assert.ok(Array.isArray(legacyNovelRollback.migration.deletedTitles), 'the rollback reports what it deleted');
  const legacyNovelReadback = await json(`/api/projects/${legacyNovelId}`);
  const legacyNovelVisible = legacyNovelReadback.project.chapters.filter((chapter) => !chapter.deletedAt && !chapter.archivedAt);
  assert.ok(
    legacyNovelVisible.some((chapter) => String(chapter.content || '').includes('码头上的雾')),
    'the hand-edited legacy chapter is still in the book after the rollback',
  );
  console.log('PASS rollback keeps edited legacy chapters instead of archiving them');

  // --- 幂等：同一个 Idempotency-Key 提交两次只会建一本书，第二次回 replayed ---
  const idemKey = `api-test-${Date.now()}`;
  const idemFirst = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
    body: JSON.stringify({ title: '幂等作品', type: 'novel', premise: '一个关于重复提交的故事', targetWords: 12000, start: 'pipeline' }),
  });
  assert.equal(idemFirst.status, 201, 'the first idempotent create returns 201');
  const idemFirstBody = await idemFirst.json();
  const idemSecond = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
    body: JSON.stringify({ title: '幂等作品', type: 'novel', premise: '一个关于重复提交的故事', targetWords: 12000, start: 'pipeline' }),
  });
  const idemSecondBody = await idemSecond.json();
  assert.equal(idemSecondBody.project?.id, idemFirstBody.project?.id, 'the replay returns the same project');
  assert.equal(idemSecondBody.replayed, true, 'the replay is flagged instead of creating a second book');
  const idemThird = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${idemKey}-other` },
    body: JSON.stringify({ title: '幂等作品二', type: 'novel', premise: '另一个故事', targetWords: 12000, start: 'pipeline' }),
  });
  assert.equal(idemThird.status, 201, 'a different key still creates a new book');
  const idemOtherId = (await idemThird.json()).project.id;
  console.log('PASS the same Idempotency-Key replays one project instead of creating a second one');

  // --- F3/F17：迁移失败后重试成功，错误必须被清掉 ---
  const retriedMigration = await json(`/api/projects/${failingLegacy.project.id}/migrate`, { method: 'POST', body: '{}' });
  assert.equal(retriedMigration.migration.state, 'done', 'a failed migration can be retried');
  const retriedSnap = await json(`/api/projects/${failingLegacy.project.id}/pipeline`);
  assert.equal(retriedSnap.lastError, null, 'a successful retry clears the recorded failure');
  assert.notEqual(retriedSnap.nextStep.kind, 'retry-failed', 'nextStep no longer asks for a retry');
  assert.equal(retriedSnap.stages.p3.status, 'review', 'the migrated plan still waits for a human');
  console.log('PASS a retried migration clears the previous failure');

  // --- F5/F6：分配要校验区间，且只把手改标记打在真正改过的行上 ---
  const allocProject = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '分配项目', type: 'novel', premise: '一个关于配给的故事', targetWords: 12000, start: 'pipeline' }),
  });
  const allocId = allocProject.project.id;
  await waitPipelineJob(allocId);
  await json(`/api/projects/${allocId}/stages/p1/confirm`, { method: 'POST' });
  await json(`/api/projects/${allocId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  await waitPipelineJob(allocId);
  await json(`/api/projects/${allocId}/stages/p2/confirm`, { method: 'POST' });
  await json(`/api/projects/${allocId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(allocId);
  const allocUnits = (await json(`/api/projects/${allocId}/units`)).units;
  const allocPreview = await json(`/api/projects/${allocId}/stages/p3/units/allocate`, { method: 'POST', body: JSON.stringify({ totalTarget: 12000 }) });
  assert.equal(allocPreview.preview.length, allocUnits.length);
  const invalidAllocation = await fetch(`${base}/api/projects/${allocId}/stages/p3/units/allocate/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [{ unitId: allocUnits[0].id, minWords: 9000, targetWords: 10, maxWords: 5000 }] }),
  });
  assert.equal(invalidAllocation.status, 400, 'an impossible word range is rejected');
  assert.ok((await invalidAllocation.json()).blockers.length >= 1, 'the rejection names the offending row');
  const validRows = allocPreview.preview.map((row) => ({ ...row, minWords: 1200, targetWords: 1500, maxWords: 2000 }));
  await json(`/api/projects/${allocId}/stages/p3/units/allocate/apply`, { method: 'POST', body: JSON.stringify({ rows: validRows }) });
  const afterFirstApply = (await json(`/api/projects/${allocId}/units`)).units;
  assert.ok(afterFirstApply.some((unit) => unit.targetManual), 'applying a new target marks those rows as hand-set');
  const reapply = await json(`/api/projects/${allocId}/stages/p3/units/allocate/apply`, { method: 'POST', body: JSON.stringify({ rows: validRows }) });
  assert.ok(reapply.summary.units >= 3, 're-applying the same targets is still allowed (nothing changed, nothing locked)');
  console.log('PASS allocation validates ranges and only marks rows whose target really changed');

  // --- F2：模型少回几条时，窗口外的既有计划不许被删 ---
  const fewProject = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '少回项目', type: 'novel', premise: '一个关于返回条数的故事', targetWords: 24000, start: 'pipeline' }),
  });
  const fewId = fewProject.project.id;
  await waitPipelineJob(fewId);
  await json(`/api/projects/${fewId}/stages/p1/confirm`, { method: 'POST' });
  await json(`/api/projects/${fewId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p2' }) });
  await waitPipelineJob(fewId);
  await json(`/api/projects/${fewId}/stages/p2/confirm`, { method: 'POST' });
  await json(`/api/projects/${fewId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(fewId);
  const plannedUnits = (await json(`/api/projects/${fewId}/units`)).units;
  assert.ok(plannedUnits.length >= 3, 'the mock plan creates several units');
  const lastPlannedTitle = plannedUnits[plannedUnits.length - 1].title;
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: chatProvider.provider.id, modelId: 'fake-chat' } }) });
  fakeMode = 'fewChapters';
  await json(`/api/projects/${fewId}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: 'p3' }) });
  await waitPipelineJob(fewId);
  const afterFewUnits = (await json(`/api/projects/${fewId}/units`)).units;
  assert.equal(afterFewUnits.length, plannedUnits.length, 'a short model reply must not delete the plan outside the request window');
  assert.equal(afterFewUnits[afterFewUnits.length - 1].title, lastPlannedTitle, 'units outside the window keep their titles');
  fakeMode = 'ok';
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
  console.log('PASS a short model reply keeps the plan outside the window');

  // --- 刷新 / 重启后阶段数据仍在，并能从当前阶段继续 ---
  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 600));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { stdout += String(data); });
  server.stderr.on('data', (data) => { stderr += String(data); });
  await waitForServer();
  const rebooted = await json(`/api/projects/${pipelineId}/pipeline`);
  assert.equal(rebooted.stages.p1.status, 'confirmed', 'confirmed stage survives a restart');
  assert.equal(rebooted.stages.p3.status, 'confirmed');
  assert.equal(rebooted.stages.p4.status, 'review');
  assert.ok(rebooted.stages.p4.counts.units >= 3, 'planned units survive a restart');
  const rebootedItems = (await json(`/api/projects/${pipelineId}/stages/p1/items`)).items;
  assert.ok(rebootedItems.some((item) => item.kind === 'world'), 'stage items survive a restart');
  const rebootedUnits = (await json(`/api/projects/${pipelineId}/units`)).units;
  const survived = rebootedUnits.find((unit) => unit.id === firstUnit.id);
  assert.ok(survived.words > 0 && survived.reviewStatus === 'approved', 'approved chapter survives a restart');
  assert.equal(rebooted.nextStep.kind, 'start-writing', 'after restart the pipeline continues from the current stage');
  console.log('PASS pipeline stage data survives restart and continues from the current stage');

  fakeChat.close();
  for (const id of [pipelineId, slowProject.project.id, pauseProjectId, interrupted.project.id, invalidProject.project.id, legacyId, failingLegacy.project.id, shortId, regressId, guardId, legacyShortId, allocId, fewId, countGuardId, legacyNovelId, idemFirstBody.project.id, idemOtherId]) {
    await json(`/api/projects/${id}`, { method: 'DELETE' });
  }
  await json(`/api/providers/${keylessProvider.provider.id}`, { method: 'DELETE' }).catch(() => {});
  await json(`/api/providers/${chatProvider.provider.id}`, { method: 'DELETE' }).catch(() => {});
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });

  const providersBeforeRestart = (await json('/api/providers')).providers.length;
  await json(`/api/projects/${projectId}`, { method: 'DELETE' });
  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { stdout += String(d); });
  server.stderr.on('data', (d) => { stderr += String(d); });
  await waitForServer();
  const reboot = await json('/api/bootstrap');
  assert.equal(reboot.projects.length, 0, 'restart after deleting all projects stays empty');
  assert.equal(reboot.providers.length, providersBeforeRestart, 'restart does not duplicate providers');
  console.log('PASS restart after empty library');

  console.log('\nAll API tests passed.');
}
try {
  await main();
} catch (error) {
  console.error('\nAPI TEST FAILED');
  console.error(error);
  console.error('\n--- server stdout ---\n', stdout);
  console.error('\n--- server stderr ---\n', stderr);
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
