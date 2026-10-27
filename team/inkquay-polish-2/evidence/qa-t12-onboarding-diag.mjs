// t12 诊断：ui-test 卡在 .onboarding 的原因定位（不改业务代码）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-diag-'));
const port = 8821;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd, env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
});
let slog = '';
server.stdout.on('data', (d) => { slog += String(d); });
server.stderr.on('data', (d) => { slog += String(d); });
for (let i = 0; i < 80; i += 1) {
  try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const apiSettings = await (await fetch(`${base}/api/settings`)).text();
console.log('GET /api/settings ->', apiSettings.slice(0, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('console', (m) => logs.push(`console.${m.type()}: ${m.text()}`));
page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
const resp = await page.goto(base, { waitUntil: 'networkidle' });
console.log('doc status', resp?.status());
await page.waitForTimeout(1500);
console.log('URL:', page.url());
const html = await page.content();
console.log('BODY LEN', html.length);
console.log('BODY SNIPPET:', html.replace(/\s+/g, ' ').slice(0, 1200));
console.log('CLASS COUNTS:', await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('*').forEach(() => {});
  ['onboarding', 'lib-head', 'app', 'first-run', 'route-loading', 'error-screen'].forEach((c) => { out[c] = document.querySelectorAll('.' + c).length; });
  out.rootHTML = (document.getElementById('root')?.innerHTML || '').slice(0, 300);
  return out;
}));
console.log('--- page logs ---');
console.log(logs.slice(0, 30).join('\n'));
console.log('--- server log ---');
console.log(slog.slice(0, 800));
await browser.close();
server.kill('SIGTERM');
