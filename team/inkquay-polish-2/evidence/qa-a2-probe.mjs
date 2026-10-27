// 独立验收探针：A2 删除作品安全网（清单失败重试 / 取消 / 遮罩 / Esc / 404）+ A3 旧库剧本卡片与路由
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = '/Users/maliang/Documents/develop/maliang/私家写手';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repoRoot, 'software/node_modules/playwright'));
const port = 8794;
const base = `http://127.0.0.1:${port}`;
const state = JSON.parse(fs.readFileSync('/tmp/qa-oldlib-state.json', 'utf8'));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd: path.join(repoRoot, 'software'),
  env: { ...process.env, PORT: String(port), PW_DATA_DIR: '/tmp/qa-oldlib', PW_STATIC_DIR: path.join(repoRoot, 'software/dist') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += String(d); });
server.stderr.on('data', (d) => { serverLog += String(d); });

let browser;
const deletes = [];
const errors = [];
try {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('request', (req) => { if (req.method() === 'DELETE') deletes.push(req.url()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'networkidle' });

  const openDoomed = async (title) => {
    const card = page.locator('.project-card', { hasText: title }).first();
    assert.ok(await page.locator('.project-card', { hasText: title }).count() >= 1, `${title} 卡片可见`);
    await card.hover();
    await card.locator('.project-card__more').click();
    await page.waitForSelector('.modal--project-settings');
    await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
    await page.waitForSelector('.danger-confirm');
  };

  // ---- 1. 清单接口失败：显示可重试提示且不阻塞输入 ----
  const novelId = state.novelId;
  const blocked = ['**/api/projects/*', '**/api/projects/**'];
  for (const pattern of blocked) await page.route(pattern, (route) => route.abort());
  await openDoomed('旧库小说');
  await page.locator('.danger-confirm__note', { hasText: '清单暂时取不到' }).waitFor({ timeout: 15000 });
  const failNote = await page.locator('.danger-confirm').innerText();
  assert.ok(failNote.includes('清单暂时取不到'), `清单失败提示缺失：${failNote}`);
  assert.equal(await page.locator('.danger-confirm ul li').count(), 0, '失败时不应显示半截清单');
  console.log('PASS A2 impact failure shows retry note');
  for (const pattern of blocked) await page.unroute(pattern);
  await page.locator('.danger-confirm__note .btn--ghost').click(); // 重试
  await page.waitForSelector('.danger-confirm ul li', { timeout: 10000 });
  const rows = await page.locator('.danger-confirm ul li').count();
  const listText = await page.locator('.danger-confirm ul').innerText();
  assert.ok(rows >= 6, `重试后清单应有 6~7 项，实际 ${rows}`);
  assert.match(listText, /章节\s*2/, `旧库小说应统计到 2 章：${listText}`);
  assert.match(listText, /历史版本\s*\d+/, `应统计到历史版本：${listText}`);
  console.log('PASS A2 retry recovers impact list:', JSON.stringify(listText.replace(/\n/g, ' / ')));

  // ---- 2. 取消 / 遮罩 / Esc 都不得发 DELETE ----
  const deletesAtStart = deletes.length;
  const confirmBtn = page.locator('.danger-confirm .btn--danger');
  assert.equal(await confirmBtn.isDisabled(), true, '未输入书名必须禁用');
  await page.locator('.danger-confirm input').fill('旧库小说');
  assert.equal(await confirmBtn.isEnabled(), true, '书名匹配后可用');
  await page.locator('.modal--project-settings .modal__foot-actions .btn--ghost', { hasText: '取消' }).click();
  await page.waitForSelector('.modal--project-settings', { state: 'detached' });
  assert.equal(deletes.length, deletesAtStart, '取消不得发 DELETE');

  await openDoomed('旧库小说');
  await page.locator('.overlay').click({ position: { x: 8, y: 8 } }); // 点遮罩
  await page.waitForSelector('.modal--project-settings', { state: 'detached', timeout: 5000 });
  assert.equal(deletes.length, deletesAtStart, '点遮罩不得发 DELETE');

  await openDoomed('旧库小说');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const modalAfterEsc = await page.locator('.modal--project-settings').count();
  const confirmAfterEsc = await page.locator('.danger-confirm').count();
  assert.equal(deletes.length, deletesAtStart, 'Esc 不得发 DELETE');
  console.log(`PASS A2 cancel/mask/Esc never DELETE (Esc 后 modal=${modalAfterEsc} danger=${confirmAfterEsc})`);
  if (modalAfterEsc) await page.keyboard.press('Escape').catch(() => {});
  if (await page.locator('.modal--project-settings').count()) {
    await page.locator('.overlay').click({ position: { x: 8, y: 8 } }).catch(() => {});
    await page.waitForTimeout(300);
    if (await page.locator('.modal--project-settings').count()) {
      await page.locator('.modal--project-settings .modal__head .icon-btn').click();
      await page.waitForTimeout(250);
    }
  }

  // ---- 3. 404：作品已被别处删除，确认删除要给友好提示并回书架 ----
  const doomed = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '验收待删作品', type: 'novel', description: '404 路径专用' }),
    });
    return res.json();
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await openDoomed('验收待删作品');
  await page.waitForSelector('.danger-confirm ul li', { timeout: 10000 });
  await page.locator('.danger-confirm input').fill('验收待删作品');
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }); }, doomed.project.id);
  const deletesBeforeConfirm = deletes.length;
  await page.locator('.danger-confirm .btn--danger').click();
  await page.waitForSelector('.toast', { timeout: 8000 });
  const toastText = await page.locator('.toast').innerText();
  assert.ok(/已经不存在|刷新/.test(toastText), `404 提示不友好：${toastText}`);
  await page.waitForURL((url) => url.pathname === '/', { timeout: 8000 });
  await page.locator('.project-card', { hasText: '验收待删作品' }).waitFor({ state: 'detached', timeout: 8000 });
  console.log('PASS A2 404 path:', JSON.stringify(toastText), 'deletes=', deletes.length - deletesBeforeConfirm);
  assert.equal(errors.length, 0, `browser errors: ${errors.join('\n')}`);

  // ---- 4. A3：旧库剧本卡片/英雄卡/路由 ----
  // 先走一遍剧本路由（ScreenplayPage 会记住「上次打开的作品」）
  await page.goto(`${base}/project/${state.screenplayId}`, { waitUntil: 'networkidle' });
  await page.waitForURL((url) => url.pathname === `/project/${state.screenplayId}/screenplay`, { timeout: 10000 });
  assert.equal(await page.locator('.doc-title-input').count(), 0, '剧本不得落进章节写作台');
  // 英雄卡取「最近更新的在写作品」，用 PATCH 把剧本顶到最前面（与真实“刚改过剧本”等价）
  await page.evaluate(async (pid) => {
    const { project } = await fetch(`/api/projects/${pid}`).then((r) => r.json());
    await fetch(`/api/projects/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: project.title, genre: project.genre, description: project.description, goalWords: project.goalWords, status: project.status }),
    });
  }, state.screenplayId);
  await page.goto(base, { waitUntil: 'networkidle' });
  const spCard = page.locator('.project-card', { hasText: '旧库剧本' }).first();
  assert.ok(await page.locator('.project-card', { hasText: '旧库剧本' }).count() >= 1);
  const spText = await spCard.innerText();
  assert.ok(!spText.includes('页'), `剧本卡片不得出现「页」：${spText}`);
  assert.match(spText, /场/, `剧本卡片应显示场次：${spText}`);
  const hero = await page.locator('.continue-card').innerText();
  console.log('hero card:', JSON.stringify(hero.replace(/\n/g, ' / ')));
  assert.ok(hero.includes('个分镜'), `剧本英雄卡应显示分镜：${hero}`);
  assert.equal(await page.locator('.continue-card .pbar').count(), 0, '剧本英雄卡不得显示假字数进度条');
  await page.locator('.continue-card .btn--primary').click();
  await page.waitForURL((url) => url.pathname === `/project/${state.screenplayId}/screenplay`, { timeout: 10000 });
  console.log('PASS A3 old-library screenplay card + redirect:', JSON.stringify(spText.replace(/\n/g, ' / ')));
  console.log('\nQA A2/A3 PROBE PASS');
} catch (error) {
  console.error('QA A2/A3 PROBE FAIL:', error);
  console.error(serverLog.split('\n').slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGKILL');
}
