import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require(path.join(import.meta.dirname, '..', 'software/node_modules/playwright'));
const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-desktop-e2e-'));
const env = { ...process.env, PW_DESKTOP_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;

async function launch() {
  const app = await electron.launch({
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-gpu', path.join(root, 'desktop/main.cjs')]
      : [path.join(root, 'desktop/main.cjs')],
    cwd: root,
    env,
    timeout: 60000,
  });
  const window = await app.firstWindow({ timeout: 30000 });
  await window.waitForLoadState('networkidle');
  return { app, window };
}

let first;
let second;
try {
  first = await launch();
  await first.window.waitForSelector('.onboarding');
  await first.window.locator('.onboarding-form input').nth(0).fill('桌面作者');
  await first.window.locator('.onboarding-card__foot .btn--primary').click();
  await first.window.locator('.onboarding-provider', { hasText: 'DeepSeek' }).click();
  await first.window.locator('.onboarding-form input[type="password"]').fill('sk-desktop-test-123456');
  await first.window.locator('.onboarding-card__foot .btn--primary').click();
  await first.window.waitForSelector('.first-run', { timeout: 15000 });
  await first.window.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
    });
  });
  await first.window.reload({ waitUntil: 'networkidle' });
  await first.window.waitForSelector('.first-run');
  await first.window.locator('.first-run .btn--primary').click();
  await first.window.fill('#np-title', '桌面测试作品');
  await first.window.locator('.modal__foot .btn--primary').click();
  await first.window.waitForSelector('.plan-review', { timeout: 20000 });
  await first.window.locator('.plan-review__actions .btn--primary').click();
  await first.window.waitForSelector('.editor', { timeout: 20000 });
  const projectId = new URL(first.window.url()).pathname.split('/')[2];
  await first.window.locator('.editor').click();
  await first.window.keyboard.type('桌面版持久化');
  await first.window.waitForTimeout(1300);
  await first.window.screenshot({ path: path.join(root, 'software/screenshots/91-desktop-studio.png') });
  await first.window.keyboard.press('End');
  await first.window.keyboard.type('关窗也落盘');
  // 模拟用户点窗口关闭按钮；Playwright 的 app.close()/window.close()
  // 会直接结束进程，绕过 BrowserWindow 的 close 事件与 flush 握手。
  // 写作台注册了 closeGuard，落盘完成即 ack，正常应在几百毫秒内退出；
  // 超时收紧到 4000ms（原 8000ms 会把 desktop/main.cjs 的 5000ms 兜底掩盖成「通过」）。
  const studioCloseStartedAt = Date.now();
  await first.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron 关窗后进程未退出（>4000ms）')), 4000);
    first.app.process().once('exit', () => { clearTimeout(timer); resolve(); });
  });
  console.log(`PASS studio dirty close ${Date.now() - studioCloseStartedAt}ms (<4000ms)`);

  second = await launch();
  const port = new URL(second.window.url()).port;
  await second.window.goto(`http://127.0.0.1:${port}/project/${projectId}`);
  await second.window.waitForSelector('.editor');
  const text = await second.window.locator('.editor').innerText();
  assert.ok(text.includes('桌面版持久化'), 'desktop data persists across restarts');
  assert.ok(text.includes('关窗也落盘'), 'closing immediately after typing still flushes the draft');
  assert.equal(await second.window.locator('.onboarding').count(), 0, 'onboarding is not shown again');

  // T3：非写作台（设置页）关窗不得再等 desktop/main.cjs 的 5000ms 兜底。
  // 历史缺陷：onCloseRequest 只在 StudioPage 注册，其余路由只能等兜底 → 每次都卡满 5 秒。
  // 现在监听挂在 App 根上（无 guard 也立即 ack），所以断言 < 2500ms；基线在同一断言下应为红（≈5160ms）。
  await second.window.goto(`http://127.0.0.1:${port}/settings`);
  await second.window.waitForSelector('.settings-route', { timeout: 15000 });
  assert.ok(second.window.url().endsWith('/settings'), 'settings route is loaded before closing');
  const settingsCloseStartedAt = Date.now();
  await second.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('设置页关窗后进程未退出（>6000ms）')), 6000);
    second.app.process().once('exit', () => { clearTimeout(timer); resolve(); });
  });
  const settingsCloseMs = Date.now() - settingsCloseStartedAt;
  assert.ok(settingsCloseMs < 2500, `settings 页关窗不得等 5s 兜底：实际 ${settingsCloseMs}ms，要求 <2500ms`);
  console.log(`PASS T3 settings close ${settingsCloseMs}ms (<2500ms)`);

  console.log('Desktop E2E passed.');
} catch (error) {
  console.error('Desktop E2E failed:', error);
  process.exitCode = 1;
} finally {
  // 测试断言已结束，不再走 close 握手，直接结束 Electron，避免 Playwright 等待。
  for (const app of [first?.app, second?.app]) {
    try { app?.process().kill('SIGKILL'); } catch { /* already exited */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
