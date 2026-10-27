// 独立验收探针：旧库（基线 4a43f42 建的库）升级 + A1 未配置模型拒绝语义
// phase=baseline 用基线代码建库并复现静默 mock；phase=current 用当前代码打同一个库
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const phase = process.argv[2];
const dataDir = '/tmp/qa-oldlib';
const port = phase === 'baseline' ? 8791 : 8792;
const base = `http://127.0.0.1:${port}`;
const cwd = phase === 'baseline' ? '/tmp/qa-base/software' : '/Users/maliang/Documents/develop/maliang/私家写手/software';

if (phase === 'baseline') fs.rmSync(dataDir, { recursive: true, force: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd, env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += String(d); });
server.stderr.on('data', (d) => { log += String(d); });

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start\n${log}`);
}

async function json(p, options = {}) {
  const res = await fetch(`${base}${p}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${p} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function stream(body) {
  const res = await fetch(`${base}/api/ai/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  const events = text.split('\n\n').map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const line = chunk.split('\n').find((l) => l.startsWith('data: '));
    try { return JSON.parse(line.slice(6)); } catch { return { type: 'unparsed', raw: chunk }; }
  });
  return { status: res.status, events };
}

const state = phase === 'current' ? JSON.parse(fs.readFileSync('/tmp/qa-oldlib-state.json', 'utf8')) : {};
const novel = state.novelId;
const chapter = state.chapterId;

try {
  await waitForServer();
  if (phase === 'baseline') {
    await json('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ name: '旧库作者', signature: '旧库签名', providerId: 'deepseek', apiKey: 'sk-old-lib-123456', modelId: 'deepseek-chat' }),
    });
    const created = await json('/api/projects', {
      method: 'POST', body: JSON.stringify({ title: '旧库小说', type: 'novel', description: '旧库', genre: '悬疑' }),
    });
    const chapterId = created.project.chapters[0].id;
    await json(`/api/chapters/${chapterId}`, {
      method: 'PATCH', body: JSON.stringify({ title: '旧库第一章', content: '旧库正文，必须保留。\n\n第二段旧库内容。' }),
    });
    const bytes = await json(`/api/projects/${created.project.id}/bundle`);
    const sp = await json('/api/projects', {
      method: 'POST', body: JSON.stringify({ title: '旧库剧本', type: 'screenplay', description: '旧库剧本' }),
    });
    const sceneA = await json(`/api/projects/${sp.project.id}/scenes`, {
      method: 'POST', body: JSON.stringify({ number: '1', place: '旧公寓 雨夜', time: '夜', heading: '1. 内景 · 旧公寓 · 夜', content: '旧库场景正文，必须保留。' }),
    });
    const sceneB = await json(`/api/projects/${sp.project.id}/scenes`, {
      method: 'POST', body: JSON.stringify({ number: '2', place: '天台', time: '黎明', heading: '2. 外景 · 天台 · 黎明', content: '第二场旧库正文。' }),
    });
    await json(`/api/projects/${sp.project.id}/shots`, {
      method: 'POST', body: JSON.stringify({ sceneId: sceneA.scene.id, shotNo: '1', shotType: '特写', description: '怀表' }),
    });
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });
    const before = await json(`/api/projects/${created.project.id}/messages`);
    const bad = await stream({ projectId: created.project.id, chapterId, prompt: '旧库测试：没有默认模型时会发生什么？' });
    const after = await json(`/api/projects/${created.project.id}/messages`);
    const meta = bad.events.find((e) => e.type === 'meta');
    const deltas = bad.events.filter((e) => e.type === 'delta');
    const errors = bad.events.filter((e) => e.type === 'error');
    console.log(`BASELINE status=${bad.status} meta=${JSON.stringify(meta)} deltas=${deltas.length} errors=${JSON.stringify(errors)}`);
    console.log(`BASELINE messages before=${before.messages.length} after=${after.messages.length}`);
    fs.writeFileSync('/tmp/qa-oldlib-state.json', JSON.stringify({
      novelId: created.project.id, chapterId, screenplayId: sp.project.id,
      sceneAId: sceneA.scene.id, sceneBId: sceneB.scene.id, bundleBytes: JSON.stringify(bytes).length,
    }, null, 2));
    assert.equal(errors.length, 0, 'baseline 未配置模型时没有报错');
    assert.ok(deltas.length > 0, 'baseline 未配置模型时静默返回演示正文（复现缺陷）');
    assert.equal(meta.provider, '本地演示', 'baseline meta 显示本地演示');
    console.log('BASELINE RED CONFIRMED: 未配置模型也生成了正文', deltas.length, 'delta');
  } else {
    const boot = await json('/api/bootstrap');
    assert.equal(boot.projects.length, 2, '旧库两个作品都在');
    const detail = await json(`/api/projects/${novel}`);
    assert.equal(detail.project.chapters[0].title, '旧库第一章');
    assert.equal(detail.project.chapters[0].content, '旧库正文，必须保留。\n\n第二段旧库内容。', '旧库正文逐字保留');
    const spDetail = await json(`/api/projects/${state.screenplayId}`);
    const sceneContents = spDetail.project.scenes.map((x) => x.content);
    assert.ok(sceneContents.some((c) => c === '旧库场景正文，必须保留。'), '旧库场景正文保留');
    assert.ok(sceneContents.some((c) => c === '第二场旧库正文。'), '旧库第二场正文保留');
    console.log('PASS old library intact:', JSON.stringify({
      novel: detail.project.chapters[0].title,
      scenes: spDetail.project.scenes.length,
      sceneCount: spDetail.project.sceneCount,
      shotCount: spDetail.project.shotCount,
      novelSceneCount: detail.project.sceneCount,
      novelShotCount: detail.project.shotCount,
    }));
    assert.equal(spDetail.project.sceneCount, spDetail.project.scenes.length, '剧本 sceneCount 与 scenes 数一致');
    assert.equal(detail.project.sceneCount, 0, '小说 sceneCount 为 0');

    const msgsBefore = (await json(`/api/projects/${novel}/messages?chapterId=${chapter}`)).messages;
    const chapterBefore = (await json(`/api/projects/${novel}`)).project.chapters[0];

    // 1) 没有默认模型
    let r = await stream({ projectId: novel, chapterId: chapter, prompt: '没有默认模型' });
    console.log('A1 no-default:', r.status, JSON.stringify(r.events.map((e) => e.type)), JSON.stringify(r.events.find((e) => e.type === 'error')));
    assert.equal(r.status, 200);
    assert.equal(r.events.filter((e) => e.type === 'delta').length, 0, 'no default model -> 0 delta');
    assert.match(r.events.find((e) => e.type === 'error').message, /还没有选择默认模型/);

    // 2) 只给 modelId
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '只给 model', modelId: 'mock-writer' });
    assert.equal(r.events.filter((e) => e.type === 'delta').length, 0);
    console.log('A1 model-only:', JSON.stringify(r.events.find((e) => e.type === 'error')));
    // 3) 只给 providerId
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '只给 provider', providerId: 'mock' });
    assert.equal(r.events.filter((e) => e.type === 'delta').length, 0);
    console.log('A1 provider-only:', JSON.stringify(r.events.find((e) => e.type === 'error')));
    // 4) 供应商不存在
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'ghost', modelId: 'x' } }) });
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '供应商不存在' });
    assert.equal(r.events.filter((e) => e.type === 'delta').length, 0);
    console.log('A1 missing provider:', JSON.stringify(r.events.find((e) => e.type === 'error')));
    // 5) 供应商未启用
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'openai', modelId: 'gpt-4o' } }) });
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '供应商未启用' });
    assert.equal(r.events.filter((e) => e.type === 'delta').length, 0);
    console.log('A1 disabled provider:', JSON.stringify(r.events.find((e) => e.type === 'error')));
    // 6) 模型不在可用列表
    const providers = (await json('/api/providers')).providers;
    const ds = providers.find((p) => p.id === 'deepseek');
    console.log('deepseek enabledModels =', JSON.stringify(ds.enabledModels), 'models =', JSON.stringify(ds.models?.map?.((m) => m.id) || ds.models));
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'deepseek', modelId: 'deepseek-reasoner' } }) });
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '模型不在列表' });
    assert.equal(r.events.filter((e) => e.type === 'delta').length, 0);
    console.log('A1 model not allowed:', JSON.stringify(r.events.find((e) => e.type === 'error')));

    // 零副作用校验
    const msgsAfter = (await json(`/api/projects/${novel}/messages?chapterId=${chapter}`)).messages;
    console.log('messages before/after refusals =', msgsBefore.length, msgsAfter.length);
    const chapterAfter = (await json(`/api/projects/${novel}`)).project.chapters[0];
    assert.equal(msgsAfter.length, msgsBefore.length, '拒绝后没有新增消息');
    assert.equal(chapterAfter.content, chapterBefore.content, '拒绝后正文未变');
    assert.equal(chapterAfter.words, chapterBefore.words, '拒绝后字数未变');

    // 7) 显式 mock 仍可用
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '显式演示模型', providerId: 'mock', modelId: 'mock-writer' });
    const deltas = r.events.filter((e) => e.type === 'delta').length;
    console.log('A1 explicit mock:', r.status, 'deltas=', deltas, 'meta=', JSON.stringify(r.events.find((e) => e.type === 'meta')));
    assert.ok(deltas > 0, '显式 mock 仍能生成');
    assert.equal(r.events.find((e) => e.type === 'meta').provider, '本地演示');

    // 8) 恢复默认模型后恢复正常
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
    r = await stream({ projectId: novel, chapterId: chapter, prompt: '恢复默认模型' });
    assert.ok(r.events.filter((e) => e.type === 'delta').length > 0);
    assert.ok(r.events.some((e) => e.type === 'done'));
    console.log('PASS A1 all branches + zero side effects');

    // 9) 旧库继续可写、可导出、可备份
    const saved = await json(`/api/chapters/${chapter}`, { method: 'PATCH', body: JSON.stringify({ content: '旧库正文，必须保留。\n\n第二段旧库内容。\n\n新增第三段。' }) });
    assert.ok(saved.chapter.words > 0);
    const added = await json(`/api/projects/${novel}/chapters`, { method: 'POST', body: JSON.stringify({ title: '旧库新章' }) });
    assert.ok(added.chapter.id);
    const md = await fetch(`${base}/api/projects/${state.screenplayId}/export?scope=book&format=md`);
    const mdText = await md.text();
    assert.ok(mdText.includes('旧公寓') && mdText.includes('旧库场景正文'), '剧本导出含旧库内容');
    const bundle = await json(`/api/projects/${novel}/bundle`);
    assert.ok(bundle.project.chapters.length >= 2);
    const imported = await json('/api/projects/import', { method: 'POST', body: JSON.stringify({ bundle }) });
    assert.ok(imported.project.id);
    console.log('PASS old library still writable/exportable/backup-importable; bundle chapters=', bundle.project.chapters.length);
  }
} catch (error) {
  console.error(`PHASE ${phase} FAIL:`, error);
  console.error(log.split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
} finally {
  server.kill('SIGKILL');
}
