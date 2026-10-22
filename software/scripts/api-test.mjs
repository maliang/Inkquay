import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-api-test-'));
const port = 8799;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd,
  env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
server.stdout.on('data', (d) => { stdout += String(d); });
server.stderr.on('data', (d) => { stderr += String(d); });

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
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  await waitForServer();
  const boot = await json('/api/bootstrap');
  assert.equal(boot.projects.length, 0, 'fresh install has no demo projects');
  assert.equal(boot.providers.length, 9, 'seed has 9 providers');
  assert.equal(boot.settings.onboarding.completed, false);
  assert.equal(boot.settings.profile.name, '');
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
  console.log('PASS mandatory onboarding + encrypted provider key');

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
  const regenRes = await fetch(`${base}/api/ai/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, chapterId, prompt: '先写一段气氛。', regenerate: true }),
  });
  assert.equal(regenRes.status, 200);
  await regenRes.text();
  const messagesRegen = await json(`/api/projects/${projectId}/messages?chapterId=${chapterId}`);
  assert.equal(messagesRegen.messages.length, messagesAfter.messages.length + 1, 'regenerate saves only assistant');
  console.log('PASS AI stream + regenerate');

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
  console.log('PASS markdown + docx export');

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
