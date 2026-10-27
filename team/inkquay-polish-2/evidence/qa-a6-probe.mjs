// 独立验收探针：A6 供应商弹窗保存不得偷改默认模型 + 无默认模型时设置页显示一致性
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';

const repoRoot = '/Users/maliang/Documents/develop/maliang/私家写手';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repoRoot, 'software/node_modules/playwright'));
const port = 8795;
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd: path.join(repoRoot, 'software'),
  env: { ...process.env, PORT: String(port), PW_DATA_DIR: '/tmp/qa-oldlib', PW_STATIC_DIR: path.join(repoRoot, 'software/dist') },
  stdio: 'ignore',
});
let browser;
const errors = [];
try {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const readDefault = async () => (await page.evaluate(async () => (await fetch('/api/settings')).json())).settings.defaultModel;
  const writeDefault = async (m) => page.evaluate(async (next) => {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultModel: next }) });
  }, m);
  const gotoProviders = async () => {
    await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
    await page.locator('.settings-menu button', { hasText: '模型与供应商' }).click();
    await page.waitForSelector('.provider-card');
  };
  const openDialog = async (name) => {
    await page.locator('.provider-card', { hasText: name }).click();
    await page.waitForSelector('.provider-dialog');
  };
  const saveDialog = async () => {
    await page.locator('.provider-dialog__foot .btn--primary').click();
    await page.waitForSelector('.provider-dialog', { state: 'detached' });
  };

  await page.goto(base, { waitUntil: 'networkidle' });
  await writeDefault({ providerId: 'deepseek', modelId: 'deepseek-chat' });
  await gotoProviders();

  // 1. 保存一个与默认无关的供应商（OpenAI），不得改动默认模型
  await openDialog('OpenAI');
  const openaiChoice = await page.locator('.provider-default-select').inputValue();
  assert.equal(openaiChoice, '', '非默认供应商的弹窗应默认「不设为默认」');
  await saveDialog();
  assert.deepEqual(await readDefault(), { providerId: 'deepseek', modelId: 'deepseek-chat' }, '保存其他供应商不得改默认模型');
  console.log('PASS A6 unrelated provider save keeps default');

  // 2. 原样保存「当前默认供应商」不得把默认模型打回第一个启用项
  await openDialog('DeepSeek');
  assert.equal(await page.locator('.provider-default-select').inputValue(), 'deepseek-chat', '弹窗应回显当前默认模型');
  await saveDialog();
  assert.deepEqual(await readDefault(), { providerId: 'deepseek', modelId: 'deepseek-chat' }, '原样保存不得重置默认模型');
  console.log('PASS A6 unchanged save keeps the real default');

  // 3. 停用当前默认供应商且没有其他启用项 → 默认模型应清空，而不是偷偷留一个无效项
  await openDialog('DeepSeek');
  await page.locator('.provider-dialog .switch').click();
  await saveDialog();
  const afterDisable = await readDefault();
  console.log('after disabling default provider:', JSON.stringify(afterDisable));
  if (afterDisable) assert.notEqual(afterDisable.providerId, 'deepseek', '停用后默认模型不得仍指向被停用的供应商');
  // 复原
  await openDialog('DeepSeek');
  await page.locator('.provider-dialog .switch').click();
  await page.locator('.provider-default-select').selectOption('deepseek-chat');
  await saveDialog();
  assert.deepEqual(await readDefault(), { providerId: 'deepseek', modelId: 'deepseek-chat' });

  // 4. 无默认模型时，设置页「默认模型」下拉与写作台口径是否一致
  await writeDefault(null);
  await gotoProviders();
  await page.locator('.settings-menu button', { hasText: '生成参数' }).click();
  await page.waitForTimeout(400);
  const settingsBody = await page.locator('body').innerText();
  const selectValue = await page.locator('.settings-panel select.text-input--compact, .text-input--compact').first().inputValue().catch(() => '(no select)');
  const shown = await page.locator('.text-input--compact').first().evaluate((el) => el.selectedOptions?.[0]?.textContent || '(none)').catch(() => '(n/a)');
  console.log('A1-UI/settings consistency: select value =', JSON.stringify(selectValue), 'displayed =', JSON.stringify(shown), 'bodyHead =', JSON.stringify(settingsBody.slice(0, 180)));
  assert.equal(errors.length, 0, `browser errors: ${errors.join('\n')}`);
  // 复原
  await writeDefault({ providerId: 'mock', modelId: 'mock-writer' });
  console.log('\nQA A6 PROBE PASS');
} catch (error) {
  console.error('QA A6 PROBE FAIL:', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGKILL');
}
