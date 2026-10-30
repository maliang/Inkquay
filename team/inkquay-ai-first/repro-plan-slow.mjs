// 慢供应商下的「新建并让 AI 企划」时间线取证
import { createRequire } from 'node:module';
// playwright 装在 software/node_modules；脚本放在 team/ 下，按路径解析而不是按 cwd。
const require = createRequire(new URL('../../software/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5180';
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 60000);
const ESC_AT = Number(process.env.ESC_AT || 0); // >0 时在该时刻按 Escape

// 1) 让 ollama 供应商指向本地假服务
let r = await fetch(`${BASE}/api/providers/ollama`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled: true, apiKey: 'fake-key', baseUrl: 'http://127.0.0.1:8899/v1', enabledModels: ['llama4-70b'] }),
});
console.log('patch ollama', r.status, (await r.text()).slice(0, 200));
r = await fetch(`${BASE}/api/settings`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ profile: { name: '审计作者', signature: '慢供应商' }, onboarding: { completed: true }, defaultModel: { providerId: 'ollama', modelId: 'llama4-70b' } }),
});
console.log('put settings', r.status);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('.lib-head__actions .btn--primary, .first-run .btn--primary').first().click();
await page.waitForSelector('.modal');
await page.fill('#np-title', '审计-慢供应商');
await page.fill('#np-premise', '一个在雨夜收到未来来信的人。');
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
await page.locator('.modal__foot .btn--primary').click();
console.log(`[${el()}] clicked 创建并让 AI 企划`);

const snap = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const btn = q('.modal__foot .btn--primary');
  const ghost = Array.from(document.querySelectorAll('.modal__foot .btn--ghost')).map((b) => b.textContent.trim());
  const dis = Array.from(document.querySelectorAll('.modal input, .modal textarea')).map((i) => i.disabled);
  return {
    path: location.pathname,
    modalOpen: !!q('.modal'),
    primary: btn ? btn.textContent.trim() + (btn.disabled ? '(disabled)' : '') : null,
    ghosts: ghost,
    inputsDisabled: dis.length ? dis.every(Boolean) : null,
    notice: q('.modal__notice') ? q('.modal__notice').innerText.replace(/\s+/g, ' ').slice(0, 200) : null,
    planReview: !!q('.plan-review'),
    spinner: q('.modal .spinner') ? 'spinner' : null,
    busyText: document.body.innerText.includes('企划中') || document.body.innerText.includes('正在企划'),
  };
});

let last = '';
let shot = {};
for (const ms of [500, 2000, 5000, 10000, 20000, 30000, 45000, 60000, 75000, 95000]) {
  if (ms > OBSERVE_MS) break;
  while (Date.now() - t0 < ms) await page.waitForTimeout(200);
  if (ESC_AT && Date.now() - t0 >= ESC_AT && !shot.esc) {
    shot.esc = true;
    await page.keyboard.press('Escape');
    console.log(`[${el()}] >>> 按下 Escape`);
  }
  const s = await snap();
  const line = JSON.stringify(s);
  console.log(`[${el()}] ${line}`);
  if (line !== last) {
    last = line;
    await page.screenshot({ path: `/tmp/inkq-audit/slow-${ms}ms.png` });
  }
}
console.log('errors', JSON.stringify(errors.slice(0, 5)));
const projects = await (await fetch(`${BASE}/api/projects`)).json();
const p = projects.projects.find((x) => x.title === '审计-慢供应商');
const detail = await (await fetch(`${BASE}/api/projects/${p.id}`)).json();
console.log('project', p.id, 'chapters', detail.project.chapters.length, 'acts', detail.project.outline?.acts?.length, 'beats', detail.project.outline?.acts?.reduce((n, a) => n + (a.beats?.length || 0), 0), 'characters', detail.project.characters.length);
await browser.close();
