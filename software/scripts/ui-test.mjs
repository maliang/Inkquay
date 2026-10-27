import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const cwd = path.resolve(import.meta.dirname, '..');
if (!fs.existsSync(path.join(cwd, 'dist/index.html'))) {
  console.error('dist/index.html 不存在，请先运行 pnpm build');
  process.exit(1);
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ui-test-'));
const port = 8798;
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

const errors = [];
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.onboarding');
  assert.equal(await page.locator('.lib-head').count(), 0, 'main UI is gated before onboarding');
  assert.ok(await page.locator('.onboarding-card__foot .btn--primary').isDisabled());
  await page.locator('.onboarding-form input').nth(0).fill('E2E作者');
  await page.locator('.onboarding-form input').nth(1).fill('E2E签名');
  await page.locator('.onboarding-card__foot .btn--primary').click();
  await page.locator('.onboarding-provider', { hasText: 'DeepSeek' }).click();
  await page.locator('.onboarding-form input[type="password"]').fill('sk-e2e-test-123456');
  await page.locator('.onboarding-card__foot .btn--primary').click();
  await page.waitForSelector('.first-run', { timeout: 15000 });
  assert.ok((await page.locator('.lib-head h1').innerText()).includes('E2E作者'));
  console.log('PASS mandatory onboarding');

  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.first-run');
  assert.equal(await page.locator('.project-card').count(), 0, 'fresh workspace has no projects');

  await page.locator('.first-run .btn--primary').click();
  await page.fill('#np-title', 'E2E 长篇');
  await page.fill('#np-premise', '一个在雨夜收到未来来信的人。');
  await page.locator('.modal__foot .btn--primary').click();
  await page.waitForSelector('.plan-review', { timeout: 20000 });
  const previewBeatCount = await page.locator('.plan-beat').count();
  assert.ok(previewBeatCount >= 6);
  await page.locator('.plan-beat input').first().uncheck();
  await page.locator('.plan-review__actions .btn--primary').click();
  await page.waitForSelector('.doc-title-input', { timeout: 20000 });
  const projectId = new URL(page.url()).pathname.split('/')[2];
  assert.ok(projectId.startsWith('p_'));
  const planDetail = await page.evaluate(async (pid) => (await fetch(`/api/projects/${pid}`)).json(), projectId);
  assert.equal(planDetail.project.outline.beats.length, previewBeatCount - 1, 'only selected beats applied');
  assert.ok(planDetail.project.characters.length >= 3, 'AI plan created characters');
  await page.screenshot({ path: 'screenshots/99-new-project-empty.png' });
  console.log('PASS create project + per-item AI plan review');

  await page.locator('.editor').click();
  await page.keyboard.type('E2E自动保存');
  await page.waitForTimeout(1400);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.editor');
  assert.ok((await page.locator('.editor').innerText()).includes('E2E自动保存'));
  console.log('PASS studio autosave');

  await page.locator('.msg__quick button').first().click();
  await page.waitForTimeout(5000);
  assert.ok((await page.locator('.chat .msg__bubble').last().innerText()).length > 20);
  const userCountBefore = await page.locator('.chat .msg--user').count();
  await page.locator('.msg__actions button', { hasText: '重新生成' }).last().click();
  await page.waitForTimeout(4800);
  assert.equal(await page.locator('.chat .msg--user').count(), userCountBefore);
  await page.locator('.msg__actions button', { hasText: '插入正文' }).last().click();
  await page.waitForTimeout(1100);
  assert.ok((await page.locator('.editor').innerText()).length > 20);
  await page.locator('.ai-tab', { hasText: '本地检查' }).click();
  await page.waitForTimeout(250);
  assert.ok((await page.locator('.ai-check').innerText()).includes('本地检查'));
  await page.locator('.ai-tab', { hasText: '共笔' }).click();

  const beforeRewrite = await page.locator('.editor').innerText();
  await page.locator('.editor').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForSelector('.selection-toolbar');
  await page.locator('.selection-toolbar__actions button', { hasText: '改写' }).click();
  await page.waitForTimeout(5000);
  await page.locator('.msg__actions button', { hasText: '替换选中' }).last().click();
  await page.waitForTimeout(900);
  assert.notEqual(await page.locator('.editor').innerText(), beforeRewrite);
  await page.locator('.ai-tab', { hasText: '版本' }).click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('.version-item').count()) >= 1, 'version history available');
  await page.locator('.version-item').first().click();
  await page.waitForSelector('.version-compare');
  await page.locator('.version-compare .modal__foot .btn--primary').click();
  await page.waitForTimeout(550);
  assert.equal(await page.locator('.version-compare').count(), 0, 'version restore closes compare');
  console.log('PASS version compare + restore');
  await page.locator('.version-scope button', { hasText: '全书' }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.version-item').count()) >= 1, 'project-wide version list available');
  console.log('PASS project-wide version list');

  await page.locator('button[aria-label="新建章节"]').click();
  await page.waitForTimeout(700);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('button[title="移入回收站"]').click();
  await page.waitForTimeout(700);
  await page.locator('button[aria-label="回收站"]').click();
  await page.waitForSelector('.trash-modal');
  await page.waitForSelector('.trash-item');
  assert.equal(await page.locator('.trash-item').count(), 1, 'deleted chapter appears in trash');
  await page.locator('.trash-item .btn--primary').click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.trash-item').count(), 0, 'chapter restored from trash');
  await page.locator('.trash-modal .modal__foot .btn--ghost').click();
  console.log('PASS chapter trash + restore');
  console.log('PASS AI stream + regenerate + insert + local check');

  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.locator('.profile-editor input').first().fill('E2E作者2');
  await page.locator('.profile-editor__foot .btn--primary').click();
  await page.waitForTimeout(500);
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.locator('.settings-menu button', { hasText: '外观' }).click();
  await page.locator('.theme-card', { hasText: '宣纸' }).click();
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'paper');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'paper');
  console.log('PASS profile + theme persistence');

  await page.evaluate(async (pid) => {
    const detail = await fetch(`/api/projects/${pid}`).then((r) => r.json());
    const actId = detail.project.outline.acts[0].id;
    for (const [i, title] of ['场景 A', '场景 B'].entries()) {
      await fetch(`/api/projects/${pid}/beats`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actId, title, chapterNo: i + 1, summary: 'E2E 摘要' }),
      });
    }
  }, projectId);
  await page.goto(`${base}/project/${projectId}/outline`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.insight-form input');
  await page.locator('.insight-form input').first().fill('E2E 场景标题');
  await page.locator('.insight-form__actions .btn--primary').click();
  await page.waitForTimeout(550);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.insight-form input');
  assert.equal(await page.locator('.insight-form input').first().inputValue(), 'E2E 场景标题');
  const beats = page.locator('.beat');
  const firstBeat = await beats.nth(0).boundingBox();
  const secondBeat = await beats.nth(1).boundingBox();
  assert.ok(firstBeat && secondBeat);
  const firstText = await beats.nth(0).innerText();
  await page.mouse.move(firstBeat.x + firstBeat.width / 2, firstBeat.y + firstBeat.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBeat.x + firstBeat.width / 2 + 24, firstBeat.y + firstBeat.height / 2 + 18, { steps: 5 });
  await page.mouse.move(secondBeat.x + secondBeat.width / 2, secondBeat.y + secondBeat.height / 2, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  assert.notEqual(await beats.nth(0).innerText(), firstText);
  console.log('PASS outline edit + drag');

  await page.goto(`${base}/project/${projectId}/codex`, { waitUntil: 'networkidle' });
  await page.locator('.topbar-actions .btn--primary', { hasText: '新增人物' }).click();
  await page.waitForSelector('.modal--character');
  await page.locator('.modal--character input.text-input').first().fill('E2E 人物');
  await page.locator('.modal--character textarea').first().fill('E2E 人物描述');
  await page.locator('.modal--character .modal__foot .btn--primary').click();
  await page.waitForTimeout(550);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.char-card', { hasText: 'E2E 人物' }).click();
  await page.waitForTimeout(250);
  assert.ok((await page.locator('.inspector').innerText()).includes('E2E 人物描述'));
  console.log('PASS character create/edit');

  const screenplay = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'E2E 剧本', type: 'screenplay' }),
    });
    return res.json();
  });
  await page.goto(`${base}/project/${screenplay.project.id}/screenplay`, { waitUntil: 'networkidle' });
  await page.locator('.inspector__actions button', { hasText: '编辑本场' }).click();
  await page.waitForSelector('.modal--scene');
  await page.locator('.modal--scene textarea').fill('E2E 剧本正文。\n\n第二段。');
  await page.locator('.modal--scene .modal__foot .btn--primary').click();
  await page.waitForTimeout(550);
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok((await page.locator('.script-page').innerText()).includes('E2E 剧本正文'));
  await page.locator('.segmented button', { hasText: '分镜板' }).click();
  await page.waitForTimeout(350);
  await page.locator('.empty-state button', { hasText: '生成 6 个分镜' }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.shot-card').count(), 6);
  await page.locator('.shot-card').first().click();
  await page.waitForSelector('.modal--shot');
  await page.locator('.modal--shot .form-block', { hasText: '画面内容' }).locator('input').fill('E2E 分镜描述');
  await page.locator('.modal--shot .modal__foot .btn--primary').click();
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.segmented button', { hasText: '分镜板' }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.shot-card').first().innerText()).includes('E2E 分镜描述'));
  console.log('PASS screenplay + storyboard');

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).hover();
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings .form-row input').first().fill('E2E 悬疑');
  await page.locator('.modal--project-settings .modal__foot .btn--primary').click();
  await page.waitForTimeout(650);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).hover();
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  assert.equal(await page.locator('.modal--project-settings .form-row input').first().inputValue(), 'E2E 悬疑');
  await page.locator('.modal--project-settings .modal__head .icon-btn').click();
  await page.waitForTimeout(250);
  console.log('PASS project settings');

  await page.locator('.project-card', { hasText: 'E2E 长篇' }).hover();
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings select').selectOption('已归档');
  await page.locator('.modal--project-settings .modal__foot .btn--primary').click();
  await page.waitForTimeout(700);
  await page.locator('.filters button', { hasText: '归档' }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.project-card', { hasText: 'E2E 长篇' }).count(), 1, 'archived project remains visible under archive filter');
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).hover();
  await page.locator('.project-card', { hasText: 'E2E 长篇' }).locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings .modal__foot .btn--ghost', { hasText: '移出归档' }).click();
  await page.waitForTimeout(700);
  await page.locator('.filters button', { hasText: '全部' }).click();
  assert.equal(await page.locator('.project-card', { hasText: 'E2E 长篇' }).count(), 1, 'unarchived project returns to all');
  console.log('PASS archive visibility + unarchive');

  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
  console.log('\nAll UI tests passed.');
} catch (error) {
  console.error('\nUI TEST FAILED');
  console.error(error);
  console.error('\n--- server stdout ---\n', stdout);
  console.error('\n--- server stderr ---\n', stderr);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
