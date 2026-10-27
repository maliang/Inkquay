// 独立验收探针：桌面端关窗握手耗时 / 保存失败时拒绝关窗
// usage: node /tmp/qa-close-probe.mjs <rootDir> <settings|guardfail|library>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = '/Users/maliang/Documents/develop/maliang/私家写手';
const require = createRequire(import.meta.url);
const { _electron: electron } = require(path.join(repoRoot, 'software/node_modules/playwright'));
const root = path.resolve(process.argv[2]);
const mode = process.argv[3] || 'settings';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `pw-qa-${mode}-`));
const env = { ...process.env, PW_DESKTOP_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;

async function launch() {
  const app = await electron.launch({
    args: [path.join(root, 'desktop/main.cjs')],
    cwd: root,
    env,
    timeout: 60000,
  });
  const window = await app.firstWindow({ timeout: 30000 });
  await window.waitForLoadState('networkidle');
  return { app, window };
}

function waitExit(app, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`进程在 ${timeoutMs}ms 内未退出`)), timeoutMs);
    app.process().once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

let main;
try {
  main = await launch();
  const w = main.window;
  await w.waitForSelector('.onboarding');
  await w.locator('.onboarding-form input').nth(0).fill('验收作者');
  await w.locator('.onboarding-card__foot .btn--primary').click();
  await w.locator('.onboarding-provider', { hasText: 'DeepSeek' }).click();
  await w.locator('.onboarding-form input[type="password"]').fill('sk-qa-verify-123456');
  await w.locator('.onboarding-card__foot .btn--primary').click();
  await w.waitForSelector('.first-run', { timeout: 15000 });
  await w.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }),
    });
  });
  await w.reload({ waitUntil: 'networkidle' });
  await w.waitForSelector('.first-run');
  await w.locator('.first-run .btn--primary').click();
  await w.fill('#np-title', `验收作品-${mode}`);
  await w.locator('.modal__foot .btn--primary').click();
  await w.waitForSelector('.plan-review', { timeout: 20000 });
  await w.locator('.plan-review__actions .btn--primary').click();
  await w.waitForSelector('.editor', { timeout: 20000 });
  const port = new URL(w.url()).port;

  if (mode === 'library') {
    await w.goto(`http://127.0.0.1:${port}/library`);
    await w.waitForLoadState('networkidle');
  } else if (mode === 'settings') {
    await w.goto(`http://127.0.0.1:${port}/settings`);
    await w.waitForLoadState('networkidle');
    await w.waitForSelector('text=设置', { timeout: 15000 });
  } else if (mode === 'guardfail') {
    // 让章节保存请求失败：模拟网络错误
    await w.evaluate(() => {
      const original = window.fetch;
      window.fetch = (input, init) => {
        const url = String(input);
        const method = String(init?.method || 'GET').toUpperCase();
        if (url.includes('/chapters/') && method !== 'GET') {
          return Promise.reject(new TypeError('qa simulated network failure'));
        }
        return original(input, init);
      };
    });
    await w.locator('.editor').click();
    await w.keyboard.type('保存会失败的一段');
    await w.waitForTimeout(1200); // 触发自动保存尝试与失败
    await main.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await new Promise((r) => setTimeout(r, 7000));
    const alive = await main.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const body = await w.locator('body').innerText();
    console.log('QA guardfail: windows alive =', alive);
    console.log('QA guardfail: toast visible =', /保存失败|先不关闭/.test(body));
    assert.equal(alive, 1, '保存失败时必须保持窗口打开（cancelClose 清掉 5s 兜底）');
    // 恢复 fetch，再点关闭，应能正常退出
    await w.evaluate(() => { /* 页面已重新加载前无法恢复原引用，直接 reload 拿回真实 fetch */ });
    await w.reload({ waitUntil: 'networkidle' });
    const started2 = Date.now();
    const exit2 = waitExit(main.app, 20000);
    await main.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await exit2;
    console.log(`QA guardfail: second close after reload = ${Date.now() - started2}ms`);
    console.log(`QA ${mode}: PASS`);
  } else {
    throw new Error(`unknown mode ${mode}`);
  }

  if (mode !== 'guardfail') {
    const started = Date.now();
    const exit = waitExit(main.app, 20000);
    await main.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await exit;
    const elapsed = Date.now() - started;
    console.log(`QA ${mode}: close elapsed = ${elapsed}ms`);
    assert.ok(elapsed < 2500, `关窗耗时应 <2500ms，实测 ${elapsed}ms`);
    console.log(`QA ${mode}: PASS`);
  }
} catch (error) {
  console.error(`QA ${mode}: FAIL`, error);
  process.exitCode = 1;
} finally {
  try { main?.app?.process().kill('SIGKILL'); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
