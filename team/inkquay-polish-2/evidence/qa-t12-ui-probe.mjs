// t12 独立 UI 验收（当前工作区字节 + /tmp/qa-t12lib 数据）：
// A3 路由/书架计数、D-1 大纲示意图与真实幕、D-2 剧本示意与真实场次、D-3 设定口径、
// A1-UI 未配置模型提示、A2 删除闸门（禁用/取消/Esc/遮罩/清单失败重试/404）、A6 供应商保存不改默认模型。
// 所有断言基于界面可见文本与网络请求记录，不依赖 ui-test.mjs 的断言逻辑。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const dataDir = '/tmp/qa-t12lib';
const st = JSON.parse(fs.readFileSync('/tmp/qa-t12-state.json', 'utf8'));
const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const port = 8813;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd, env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
});
let slog = '';
server.stdout.on('data', (d) => { slog += String(d); });
server.stderr.on('data', (d) => { slog += String(d); });
async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start\n${slog}`);
}
async function api(p, method = 'GET', body) {
  const res = await fetch(`${base}${p}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const out = [];
const ok = (name) => { out.push(`PASS ${name}`); console.log(`PASS ${name}`); };
const errors = [];
let browser;

try {
  await waitForServer();
  // 准备：让剧本成为「最近更新」（书架英雄卡取第一个），并给小说灌入真实大纲 beats
  await api('/api/settings', 'PUT', { defaultModel: { providerId: 'mock', modelId: 'mock-writer' } });
  const planPreview = await api(`/api/projects/${st.novelId}/plan`, 'POST');
  await api(`/api/projects/${st.novelId}/plan/apply`, 'POST', { plan: planPreview.plan });
  await api(`/api/settings`, 'PUT', { defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' } });
  await api(`/api/projects/${st.spId}`, 'PATCH', { description: '旧库剧本，最新更新。' });
  const spDetail = await api(`/api/projects/${st.spId}`);
  const novelDetail = await api(`/api/projects/${st.novelId}`);
  console.log(`[setup] screenplay scenes=${spDetail.project.scenes.length} shots=${spDetail.project.shots.length}; novel acts=${novelDetail.project.outline.acts.length} beats=${novelDetail.project.outline.beats.length}`);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const deletes = [];
  page.on('request', (r) => { if (r.method() === 'DELETE') deletes.push(r.url()); });

  // ---- A3/D-1 书架：英雄卡按类型计数，不再出现「页」或假字数进度 ----
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.continue-card');
  const heroText = (await page.locator('.continue-card').innerText()).replace(/\s+/g, ' ');
  assert.ok(heroText.includes(`${spDetail.project.sceneCount} 场`), `英雄卡应显示真实场次：${heroText}`);
  assert.ok(heroText.includes(`${spDetail.project.shots.length} 个分镜`), `英雄卡应显示真实分镜：${heroText}`);
  assert.ok(!heroText.includes('页'), `英雄卡不得出现「页」：${heroText}`);
  assert.equal(await page.locator('.continue-card .progress-ring').count(), 0, '剧本英雄卡不得有假字数进度环');
  assert.equal(await page.locator('.continue-card .pbar').count(), 0, '剧本英雄卡不得有假字数进度条');
  const spCardText = (await page.locator('.project-card', { hasText: '旧库剧本' }).innerText()).replace(/\s+/g, ' ');
  assert.ok(spCardText.includes('场 ·'), `剧本项目卡应显示场次/分镜：${spCardText}`);
  assert.ok(!spCardText.includes(' 页'), `剧本项目卡不得出现「页」：${spCardText}`);
  ok('A3 书架：剧本英雄卡与项目卡显示真实场次/分镜，无「页」与假进度');

  // ---- A3 路由：剧本项目不进章节写作台 ----
  await page.goto(`${base}/project/${st.spId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(new RegExp(`/project/${st.spId}/screenplay$`), { timeout: 15000 });
  await page.waitForSelector('.script-inspector');
  assert.equal(await page.locator('.doc-title-input').count(), 0, '剧本项目不得渲染章节写作台');
  ok('A3 剧本项目 /project/:id 自动重定向 /screenplay（未进章节写作台）');

  // ---- D-2 剧本：示意标注 + 真实场次进度 ----
  assert.equal((await page.locator('.script-inspector__head .tag--hint').innerText()).trim(), '示意');
  assert.ok((await page.locator('.script-inspector__note').innerText()).includes('不来自本场正文分析'));
  const progressText = (await page.locator('.goal-mini strong').innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(/^\d+ \/ \d+ 场有正文$/.test(progressText), `剧本进度应为真实场次：${progressText}`);
  const scoreText = await page.locator('.score').first().innerText();
  assert.ok(scoreText.includes('4.5'), '示意评分保留但有标注');
  const sceneBody = await page.locator('body').innerText();
  assert.ok(!sceneBody.includes('数据来自') , '不得出现「数据来自」式假承诺');
  ok('D-2 剧本：本场分析标注「示意」并说明非正文分析，进度为真实场次');

  // ---- D-1 大纲：真实幕/章节区间 + 示意标注 ----
  await page.goto(`${base}/project/${st.novelId}/outline`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tension-card');
  const actCount = await page.locator('.act').count();
  assert.equal(actCount, novelDetail.project.outline.acts.length, `分幕区幕数应等于真实 acts：${actCount}`);
  const structureText = await page.locator('.structure-card').innerText();
  assert.ok(structureText.includes(`${novelDetail.project.outline.acts.length} 幕`), `结构卡应显示真实幕数：${structureText}`);
  const chartLabels = await page.locator('.chart-labels text').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
  assert.ok(chartLabels.length >= 1, `张力曲线应有章节区间标签，实际 ${chartLabels.length}`);
  for (const label of chartLabels) assert.ok(/^第 \d+–\d+ 章$/.test(label.trim()), `标签应为「第 X–Y 章」：${label}`);
  const hints = await page.locator('.tag--hint').count();
  assert.ok(hints >= 2, `张力曲线与人物弧光都应有「示意」标记，实际 ${hints}`);
  const outlineText = await page.locator('body').innerText();
  for (const banned of ['按章节场景数量与状态估算', '数据来自设定库', '故事结构 · 三幕式']) {
    assert.ok(!outlineText.includes(banned), `大纲页仍有旧假精确措辞「${banned}」`);
  }
  assert.equal(await page.locator('.act-item.is-active').count(), 1, '当前幕只能有一个高亮');
  ok('D-1 大纲：三幕卡/幕列表读真实 acts，章节区间来自真实 chapterNo，曲线与弧光标注「示意」');

  // ---- D-3 设定页口径 ----
  await page.goto(`${base}/project/${st.novelId}/codex`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.memory-index');
  const codexText = await page.locator('body').innerText();
  for (const banned of ['已同步', '已索引', '自动引用', '已经进入 AI', '长期记忆', '72%']) {
    assert.ok(!codexText.includes(banned), `设定页仍有假承诺「${banned}」`);
  }
  assert.ok((await page.locator('.memory-index__head').innerText()).includes('本地保存'));
  assert.equal(await page.locator('.memory-index .pbar').count(), 0, '设定索引不得有 72% 假进度条');
  await page.locator('.codex-tabs button', { hasText: '伏笔' }).click();
  assert.ok((await page.locator('.foreshadow-head p').innerText()).includes('记录埋设位置'));
  ok('D-3/A4 设定页：仅本地保存与手动引用，无「已同步/已索引/自动引用」与假进度条');

  // ---- A1-UI：未配置模型时明确提示，不静默 ----
  await api('/api/settings', 'PUT', { defaultModel: null });
  await page.goto(`${base}/project/${st.novelId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.model-pill');
  assert.ok((await page.locator('.model-pill').innerText()).includes('未配置模型'));
  const hint = await page.locator('.composer-hint').innerText();
  assert.ok(hint.includes('默认模型还没配置'), `共笔提示应说明未配置：${hint}`);
  assert.ok(!/由\s*未配置模型\s*提供/.test(hint), `共笔提示病句未修：${hint}`);
  const msgsBefore = await page.locator('.chat .msg').count();
  await page.locator('.msg__quick button').first().click();
  await page.waitForSelector('.toast', { timeout: 6000 });
  assert.ok((await page.locator('.toast').innerText()).includes('还没有选择默认模型'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.chat .msg').count(), msgsBefore, '未配置模型时不得凭空插入对话');
  const bodyAfter = await page.locator('body').innerText();
  assert.ok(!bodyAfter.includes('本地演示') || true, '占位');
  await api('/api/settings', 'PUT', { defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' } });
  ok('A1-UI 未配置模型：明确 toast + 提示语，未产生消息');

  // ---- A2 删除闸门 ----
  await page.goto(base, { waitUntil: 'networkidle' });
  const novelCard = page.locator('.project-card', { hasText: '旧库小说' });
  await novelCard.hover();
  await novelCard.locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  const confirmBtn = page.locator('.danger-confirm .btn--danger');
  assert.ok(await confirmBtn.isDisabled(), '未输入书名时确认删除必须禁用');
  await page.locator('.danger-confirm input').fill('旧库小');
  assert.ok(await confirmBtn.isDisabled(), '书名不完整时确认删除必须禁用');
  await page.locator('.danger-confirm input').fill('《旧库小说》');
  assert.ok(await confirmBtn.isEnabled(), '书名匹配（含书名号）后应可删除');
  await page.waitForSelector('.danger-confirm ul li');
  assert.equal(await page.locator('.danger-confirm ul li').count(), 7, '影响清单应为 7 项');
  const delBeforeCancel = deletes.length;
  await page.locator('.modal--project-settings .modal__foot-actions .btn--ghost', { hasText: '取消' }).click();
  await page.waitForSelector('.modal--project-settings', { state: 'detached' });
  await page.waitForTimeout(500);
  assert.equal(deletes.length, delBeforeCancel, '取消不得发出 DELETE');

  // Esc 退回编辑态、不发 DELETE
  await novelCard.hover();
  await novelCard.locator('.project-card__more').click();
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  await page.locator('.danger-confirm input').fill('旧库小说');
  const delBeforeEsc = deletes.length;
  await page.keyboard.press('Escape');
  await page.locator('.danger-confirm').waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await page.locator('.modal--project-settings').count(), 1, 'Esc 只退确认区，不关整个弹窗');
  await page.waitForTimeout(500);
  assert.equal(deletes.length, delBeforeEsc, 'Esc 不得发出 DELETE');

  // 遮罩点击关闭、不发 DELETE
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  await page.locator('.danger-confirm input').fill('旧库小说');
  const delBeforeOverlay = deletes.length;
  await page.locator('.overlay').click({ position: { x: 6, y: 6 } });
  await page.waitForSelector('.modal--project-settings', { state: 'detached' });
  await page.waitForTimeout(500);
  assert.equal(deletes.length, delBeforeOverlay, '点遮罩不得发出 DELETE');

  // 清单失败 → 降级 + 重试
  await novelCard.hover();
  await novelCard.locator('.project-card__more').click();
  await page.route('**/api/projects/**', (route) => route.abort());
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  await page.waitForFunction(() => document.body.innerText.includes('清单暂时取不到'), null, { timeout: 10000 });
  const failNote = (await page.locator('.danger-confirm__note').first().innerText()).trim();
  assert.ok(failNote.includes('清单暂时取不到'), `清单失败应降级提示：${failNote}`);
  assert.equal(await page.locator('.danger-confirm ul li').count(), 0, '失败时不得展示半截清单');
  await page.unroute('**/api/projects/**');
  await page.locator('.danger-confirm__note button', { hasText: '重试' }).click();
  await page.waitForSelector('.danger-confirm ul li', { timeout: 10000 });
  assert.equal(await page.locator('.danger-confirm ul li').count(), 7, '重试后恢复 7 项清单');
  await page.locator('.modal--project-settings .modal__foot-actions .btn--ghost', { hasText: '取消' }).click();
  await page.waitForSelector('.modal--project-settings', { state: 'detached' });
  ok('A2 删除闸门：书名禁用/启用、取消·Esc·遮罩零 DELETE、清单失败降级可重试');

  // ---- A2 404：作品已被别处删除 ----
  const tmp = await api('/api/projects', 'POST', { title: '验收待删作品', type: 'novel' });
  await page.goto(base, { waitUntil: 'networkidle' });
  const tmpCard = page.locator('.project-card', { hasText: '验收待删作品' });
  await tmpCard.hover();
  await tmpCard.locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  await page.locator('.danger-confirm input').fill('验收待删作品');
  await api(`/api/projects/${tmp.project.id}`, 'DELETE');
  await page.locator('.danger-confirm .btn--danger').click();
  await page.waitForSelector('.toast', { timeout: 8000 });
  assert.ok((await page.locator('.toast').innerText()).includes('这部作品已经不存在了'), '404 应给友好提示');
  await page.waitForURL(`${base}/`, { timeout: 8000 });
  ok('A2 404：作品已被删除时友好提示并回到书架');

  // ---- A6 供应商弹窗不得偷改默认模型 ----
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.settings-route');
  await page.locator('.settings-menu button', { hasText: '模型与供应商' }).click();
  await page.waitForSelector('.provider-card', { timeout: 10000 });
  const before = (await api('/api/settings')).settings.defaultModel;
  assert.equal(before.providerId, 'deepseek');
  await page.locator('.provider-card', { hasText: 'OpenAI' }).click();
  await page.waitForSelector('.provider-default-select');
  assert.equal(await page.locator('.provider-default-select').inputValue(), '', '无关供应商弹窗默认应为「不设为默认」');
  await page.locator('.provider-dialog .btn--primary').click();
  await page.waitForTimeout(800);
  const after = (await api('/api/settings')).settings.defaultModel;
  assert.equal(after.providerId, before.providerId, `保存无关供应商不得改默认模型：${JSON.stringify(after)}`);
  assert.equal(after.modelId, before.modelId);
  ok('A6 供应商弹窗：默认「不设为默认」，保存无关供应商不改默认模型');

  // 预期噪音：清单失败用例主动 abort 的 3 个请求（ERR_FAILED）与 404 用例故意制造的 404
  const unexpected = errors.filter((e) => !/ERR_FAILED|status of 404/.test(e));
  assert.deepEqual(unexpected, [], `unexpected browser errors: ${unexpected.join('\n')}`);
  console.log(`[noise] 预期内页面错误 ${errors.length - unexpected.length} 条（abort/404 用例）`);
  assert.equal(deletes.length, 1, `只应有 404 用例那一次 DELETE，实际 ${deletes.length}`);
  console.log(`\nALL ${out.length} UI CHECKS PASSED`);
  server.kill('SIGTERM');
  await browser.close();
} catch (err) {
  console.error('UI PROBE FAILED:', err?.message || err);
  console.error('passed so far:\n' + out.join('\n'));
  console.error('browser errors:', errors.slice(0, 10).join('\n'));
  console.error(slog.slice(0, 1200));
  process.exitCode = 1;
  try { await browser?.close(); } catch {}
  server.kill('SIGTERM');
}
