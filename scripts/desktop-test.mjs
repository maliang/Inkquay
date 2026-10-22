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
    args: [path.join(root, 'desktop/main.cjs')],
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
  await first.app.close();

  second = await launch();
  const port = new URL(second.window.url()).port;
  await second.window.goto(`http://127.0.0.1:${port}/project/${projectId}`);
  await second.window.waitForSelector('.editor');
  const text = await second.window.locator('.editor').innerText();
  assert.ok(text.includes('桌面版持久化'), 'desktop data persists across restarts');
  assert.equal(await second.window.locator('.onboarding').count(), 0, 'onboarding is not shown again');
  console.log('Desktop E2E passed.');
} catch (error) {
  console.error('Desktop E2E failed:', error);
  process.exitCode = 1;
} finally {
  if (first?.app) await first.app.close().catch(() => {});
  if (second?.app) await second.app.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
