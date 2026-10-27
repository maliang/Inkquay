// t12 独立验收：用基线 4a43f42 代码建「旧库」，再用当前工作区代码打开同一库，
// 覆盖 A1（拒绝语义/零副作用/显式 mock）、A3（sceneCount/shotCount）、T1（剧本导出）、T2（项目包）、删除级联、D-1 大纲数据面。
// 用法：node /tmp/qa-t12-api-probe.mjs baseline   → 用基线代码建库并复现 B-1 静默 mock
//       node /tmp/qa-t12-api-probe.mjs current    → 用当前代码打同一个库
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const phase = process.argv[2];
const dataDir = '/tmp/qa-t12lib';
const statePath = '/tmp/qa-t12-state.json';
const port = phase === 'baseline' ? 8811 : 8812;
const base = `http://127.0.0.1:${port}`;
const cwd = phase === 'baseline'
  ? '/tmp/qa-base/software'
  : '/Users/maliang/Documents/develop/maliang/私家写手/software';

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
  const events = text.split('\n\n').map((c) => c.trim()).filter(Boolean).map((c) => {
    const line = c.split('\n').find((l) => l.startsWith('data: '));
    try { return JSON.parse(line.slice(6)); } catch { return { type: 'unparsed', raw: c }; }
  });
  return { status: res.status, events };
}
const results = [];
function check(name, fn) { return Promise.resolve().then(fn).then(() => results.push(`PASS ${name}`)); }

try {
  await waitForServer();

  if (phase === 'baseline') {
    await json('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ name: '旧库作者', signature: '旧库签名', providerId: 'deepseek', apiKey: 'sk-t12-old-123456', modelId: 'deepseek-chat' }),
    });
    const novel = await json('/api/projects', {
      method: 'POST', body: JSON.stringify({ title: '旧库小说', type: 'novel', genre: '悬疑 · 文学', description: '旧库建的作品', goalWords: 80000 }),
    });
    const novelId = novel.project.id;
    const chapterId = novel.project.chapters[0].id;
    const novelContent = '旧库正文，必须保留。\n\n第二段旧库内容。';
    await json(`/api/chapters/${chapterId}`, { method: 'PATCH', body: JSON.stringify({ title: '旧库第一章', content: novelContent }) });

    const sp = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: '旧库剧本', type: 'screenplay' }) });
    const spId = sp.project.id;
    const s1 = sp.project.scenes[0].id;
    await json(`/api/scenes/${s1}`, { method: 'PATCH', body: JSON.stringify({ content: '旧库场景正文', heading: '1. 内景 · 旧公寓 · 夜' }) });
    const s2 = await json(`/api/projects/${spId}/scenes`, { method: 'POST', body: JSON.stringify({ number: '2', heading: '2. 外景 · 旧码头 · 晨', content: '旧库第二场正文' }) });
    const gen = await json(`/api/scenes/${s2.scene.id}/shots/generate`, { method: 'POST' });

    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });
    const silent = await stream({ projectId: novelId, chapterId, prompt: '旧库未配置模型时写一段。' });
    const meta = silent.events.find((e) => e.type === 'meta');
    const deltas = silent.events.filter((e) => e.type === 'delta');
    const errors = silent.events.filter((e) => e.type === 'error');
    console.log(`[baseline] status=${silent.status} provider=${meta?.provider} model=${meta?.model} deltas=${deltas.length} errors=${errors.length}`);
    assert.equal(silent.status, 200);
    assert.equal(meta?.provider, '本地演示', 'baseline silently falls back to mock provider');
    assert.ok(deltas.length > 0, 'baseline silently generates text');
    assert.equal(errors.length, 0);

    fs.writeFileSync(statePath, JSON.stringify({ novelId, chapterId, novelContent, spId, s1, s2: s2.scene.id, shots: gen.shots.length }, null, 2));
    console.log('PASS baseline library seeded + B-1 silent mock reproduced (改前红)');
  } else {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    // 旧库完整性
    const list = await json('/api/projects');
    await check('旧库升级：两本作品都在且计数正确', () => {
      assert.equal(list.projects.length, 2, `projects=${list.projects.length}`);
      const novel = list.projects.find((p) => p.id === st.novelId);
      const sp = list.projects.find((p) => p.id === st.spId);
      assert.ok(novel && sp, 'both projects present');
      assert.equal(sp.sceneCount, 2, 'screenplay sceneCount');
      assert.equal(sp.shotCount, st.shots, 'screenplay shotCount');
      assert.equal(novel.sceneCount, 0, 'novel sceneCount is 0');
      assert.equal(novel.shotCount, 0, 'novel shotCount is 0');
    });
    const novelDetail = await json(`/api/projects/${st.novelId}`);
    await check('旧库升级：章节正文逐字保留', () => {
      const chapter = novelDetail.project.chapters.find((c) => c.id === st.chapterId);
      assert.equal(chapter.content, st.novelContent);
      assert.equal(chapter.title, '旧库第一章');
    });
    const spDetail = await json(`/api/projects/${st.spId}`);
    await check('旧库升级：剧本场次/正文/分镜保留', () => {
      assert.equal(spDetail.project.scenes.length, 2);
      assert.equal(spDetail.project.scenes[0].content, '旧库场景正文');
      assert.equal(spDetail.project.scenes[0].heading, '1. 内景 · 旧公寓 · 夜');
      assert.equal(spDetail.project.shots.length, st.shots);
    });

    // A1：六条拒绝分支 + 零副作用
    const messagesBefore = (await json(`/api/projects/${st.novelId}/messages?chapterId=${st.chapterId}`)).messages.length;
    const chapterBefore = (await json(`/api/projects/${st.novelId}`)).project.chapters.find((c) => c.id === st.chapterId);
    const p = { projectId: st.novelId, chapterId: st.chapterId, prompt: 'A1 拒绝测试' };
    const cases = [
      ['无默认模型', {}, '还没有选择默认模型，请到设置中配置'],
      ['只给 modelId 不借用默认 provider', { modelId: 'deepseek-chat' }, '还没有选择默认模型，请到设置中配置'],
      ['只给 providerId', { providerId: 'deepseek' }, '还没有选择模型，请到设置中配置'],
      ['供应商不存在', { providerId: 'ghost', modelId: 'x' }, '供应商「ghost」不存在'],
      ['供应商未启用', { providerId: 'openai', modelId: 'gpt-4o' }, '未在此工作台启用'],
      ['模型不在可用列表', { providerId: 'deepseek', modelId: 'deepseek-reasoner' }, '不在「DeepSeek」的可用列表里'],
    ];
    for (const [name, extra, expected] of cases) {
      const r = await stream({ ...p, ...extra });
      const errs = r.events.filter((e) => e.type === 'error');
      const ds = r.events.filter((e) => e.type === 'delta');
      await check(`A1 ${name} → 200 + 单条 SSE error + 0 delta`, () => {
        assert.equal(r.status, 200);
        assert.equal(ds.length, 0, `deltas=${ds.length}`);
        assert.equal(errs.length, 1, `errors=${errs.length}`);
        assert.ok(String(errs[0].message).includes(expected), `实际文案: ${errs[0].message}`);
      });
    }
    const messagesAfter = (await json(`/api/projects/${st.novelId}/messages?chapterId=${st.chapterId}`)).messages.length;
    const chapterAfter = (await json(`/api/projects/${st.novelId}`)).project.chapters.find((c) => c.id === st.chapterId);
    await check('A1 拒绝后零副作用（消息数/正文不变）', () => {
      assert.equal(messagesAfter, messagesBefore, `messages ${messagesBefore} → ${messagesAfter}`);
      assert.equal(chapterAfter.content, chapterBefore.content);
      assert.equal(chapterAfter.words, chapterBefore.words);
    });

    // 显式 mock 不误伤
    const mock = await stream({ ...p, providerId: 'mock', modelId: 'mock-writer' });
    await check('A1 显式 mock 仍可用', () => {
      const meta = mock.events.find((e) => e.type === 'meta');
      assert.equal(meta?.provider, '本地演示');
      assert.ok(mock.events.some((e) => e.type === 'delta'));
      assert.equal(mock.events.filter((e) => e.type === 'error').length, 0);
    });
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
    const back = await stream(p);
    await check('A1 恢复默认模型后恢复流式', () => {
      assert.ok(back.events.some((e) => e.type === 'delta'));
      assert.ok(back.events.some((e) => e.type === 'done'));
    });
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });

    // T1 剧本导出
    const mdRes = await fetch(`${base}/api/projects/${st.spId}/export`);
    const md = await mdRes.text();
    await check('T1 剧本 md 导出含两场 heading 与正文', () => {
      assert.equal(mdRes.status, 200);
      assert.ok(md.includes('1. 内景 · 旧公寓 · 夜'));
      assert.ok(md.includes('2. 外景 · 旧码头 · 晨'));
      assert.ok(md.includes('旧库场景正文'));
      assert.ok(md.includes('旧库第二场正文'));
    });
    const docxRes = await fetch(`${base}/api/projects/${st.spId}/export.docx`);
    const docxBuf = Buffer.from(await docxRes.arrayBuffer());
    await check('T1 剧本 docx 导出为合法 zip', () => {
      assert.equal(docxRes.status, 200);
      assert.equal(docxBuf.subarray(0, 2).toString(), 'PK');
      assert.ok(docxBuf.length > 1000, `size=${docxBuf.length}`);
    });
    const emptySp = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: '空剧本', type: 'screenplay' }) });
    const emptyRes = await fetch(`${base}/api/projects/${emptySp.project.id}/export`);
    await check('T1 空剧本导出 400 且有中文原因', async () => {
      assert.equal(emptyRes.status, 400);
      assert.ok((await emptyRes.text()).includes('还没有可导出的正文'));
    });

    // T2 项目包往返
    const bundleNovel = await (await fetch(`${base}/api/projects/${st.novelId}/bundle`)).json();
    const importedNovel = await json('/api/projects/import', { method: 'POST', body: JSON.stringify({ bundle: bundleNovel }) });
    const bundleSp = await (await fetch(`${base}/api/projects/${st.spId}/bundle`)).json();
    const importedSp = await json('/api/projects/import', { method: 'POST', body: JSON.stringify({ bundle: bundleSp }) });
    await check('T2 小说项目包往返保留章节正文', () => {
      const chapter = importedNovel.project.chapters.find((c) => c.title === '旧库第一章') || importedNovel.project.chapters[0];
      assert.ok(chapter, 'chapter survives import');
      assert.equal(chapter.content, st.novelContent, 'imported chapter body matches');
      assert.ok(importedNovel.project.chapters.length >= 1);
    });
    await check('T2 剧本项目包往返保留 2 场/分镜/heading', () => {
      assert.equal(importedSp.project.scenes.length, 2);
      assert.equal(importedSp.project.shots.length, st.shots);
      assert.ok(importedSp.project.scenes.some((s) => s.heading === '2. 外景 · 旧码头 · 晨'));
      assert.equal(importedSp.project.sceneCount, 2);
    });
    for (const id of [importedNovel.project.id, importedSp.project.id, emptySp.project.id]) {
      await json(`/api/projects/${id}`, { method: 'DELETE' });
    }

    // 删除级联仍成立（A2 只加 UI 闸门，不动后端语义）
    const tmp = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: '临时删除作品', type: 'novel' }) });
    await json(`/api/chapters/${tmp.project.chapters[0].id}`, { method: 'PATCH', body: JSON.stringify({ content: '待删正文' }) });
    await json(`/api/projects/${tmp.project.id}`, { method: 'DELETE' });
    const gone = await fetch(`${base}/api/projects/${tmp.project.id}`);
    await check('删除作品仍级联删除且随后 404（无回归）', () => assert.equal(gone.status, 404));

    // D-1 数据面：UI 读到的幕/章节区间来自真实数据（旧库有 3 个默认幕；有 beats 的项目 chapterNo 必须是数字）
    const outline = novelDetail.project.outline;
    await check('D-1 大纲数据面：旧库作品有真实 acts', () => {
      assert.ok(outline.acts.length >= 1, `acts=${outline.acts.length}`);
      assert.ok(outline.acts.every((a) => typeof a.id === 'string' && a.id.length > 0), 'acts have real ids');
    });
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
    const planned = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'D1 大纲样例', type: 'novel' }) });
    const planPreview = await json(`/api/projects/${planned.project.id}/plan`, { method: 'POST' });
    const planApplied = await json(`/api/projects/${planned.project.id}/plan/apply`, { method: 'POST', body: JSON.stringify({ plan: planPreview.plan }) });
    await check('D-1 大纲数据面：beats 带 actId 与数字 chapterNo', () => {
      const o = planApplied.project.outline;
      assert.ok(o.beats.length >= 1, `beats=${o.beats.length}`);
      assert.ok(o.beats.every((b) => typeof b.chapterNo === 'number'), 'every beat has numeric chapterNo');
      assert.ok(o.beats.every((b) => o.acts.some((a) => a.id === b.actId)), 'beats reference real acts');
    });
    await json(`/api/projects/${planned.project.id}`, { method: 'DELETE' });
    await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: null }) });

    await check('旧库仍可写：PATCH 章节成功', async () => {
      const patch = await json(`/api/chapters/${st.chapterId}`, { method: 'PATCH', body: JSON.stringify({ content: `${st.novelContent}\n\n新增一段。` }) });
      assert.ok(patch.chapter.content.includes('新增一段。'));
      assert.ok(patch.chapter.words > chapterBefore.words);
      await json(`/api/chapters/${st.chapterId}`, { method: 'PATCH', body: JSON.stringify({ content: st.novelContent }) });
    });

    console.log(results.join('\n'));
    console.log(`ALL ${results.length} CHECKS PASSED (current code on baseline-built library)`);
  }
} catch (err) {
  console.error('PROBE FAILED:', err?.message || err);
  console.error('partial results:\n' + results.join('\n'));
  console.error(log.slice(0, 1500));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 3000).unref();
}
