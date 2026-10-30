// 复现脚本：新建作品 → 勾选「创建后让 AI 先做企划」→ 创建
// 用法: node /tmp/inkq-audit/repro.mjs <scenario>
// 场景: mock | noModel | badKey | unreachable | novel-screenplay
import { createRequire } from 'node:module';
// playwright 装在 software/node_modules；脚本放在 team/ 下，按路径解析而不是按 cwd。
const require = createRequire(new URL('../../software/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const scenario = process.argv[2] || 'mock';

const log = [];
function note(...a) { const s = a.join(' '); log.push(s); console.log(s); }

async function seed(settingsPatch, providerPatch) {
  if (providerPatch) {
    const r = await fetch(`${BASE}/api/providers/${providerPatch.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(providerPatch.body),
    });
    note('[seed] PATCH provider', providerPatch.id, r.status);
  }
  const r = await fetch(`${BASE}/api/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsPatch),
  });
  note('[seed] PUT settings', r.status, JSON.stringify(await r.json()).slice(0, 300));
}

const profile = { profile: { name: '审计作者', signature: '只读审计' }, onboarding: { completed: true } };

if (scenario === 'mock') {
  await seed({ ...profile, defaultModel: { providerId: 'mock', modelId: 'mock-writer' } });
} else if (scenario === 'noModel') {
  await seed({ ...profile, defaultModel: null });
} else if (scenario === 'badKey') {
  await seed({ ...profile, defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' } },
    { id: 'deepseek', body: { apiKey: 'sk-invalid-audit-key', enabled: true, enabledModels: ['deepseek-chat'] } });
} else if (scenario === 'unreachable') {
  await seed({ ...profile, defaultModel: { providerId: 'ollama', modelId: 'llama3.1' } },
    { id: 'ollama', body: { apiKey: 'x', enabled: true, baseUrl: 'http://127.0.0.1:1/v1', enabledModels: ['llama3.1'] } });
} else if (scenario === 'nokey') {
  await seed({ ...profile, defaultModel: { providerId: 'openai', modelId: 'gpt-4o-mini' } },
    { id: 'openai', body: { enabled: true, enabledModels: ['gpt-4o-mini'] } });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleMsgs = [];
const pageErrors = [];
const netLog = [];
page.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
page.on('request', (r) => { if (r.url().includes('/api/')) netLog.push(`→ ${r.method()} ${new URL(r.url()).pathname}${r.postData() ? ' body=' + r.postData().slice(0, 200) : ''}`); });
page.on('response', async (r) => {
  if (!r.url().includes('/api/')) return;
  let body = '';
  try { body = (await r.text()).slice(0, 300); } catch { body = '<no body>'; }
  netLog.push(`← ${r.status()} ${new URL(r.url()).pathname} ${body.replace(/\n/g, ' ')}`);
});

const t0 = Date.now();
function el() { return ((Date.now() - t0) / 1000).toFixed(1) + 's'; }
page.on('request', (r) => { if (r.url().includes('/plan')) note(`[${el()}] >>> POST plan 发出`); });
page.on('response', (r) => { if (r.url().includes('/plan')) note(`[${el()}] <<< POST plan 响应 ${r.status()}`); });

await page.goto(BASE, { waitUntil: 'networkidle' });
note('[state] url =', page.url());
note('[state] 首屏可见 .lib-head =', await page.locator('.lib-head').count());
note('[state] onboarding 可见 =', await page.locator('.onboarding').count());

// 打开新建作品
const openBtn = page.locator('.lib-head__actions .btn--primary, .first-run .btn--primary').first();
await openBtn.click();
await page.waitForSelector('.modal', { timeout: 5000 });
note('[step] 新建作品弹窗已打开');
const toggle = page.locator('.ai-plan-toggle input[type="checkbox"]');
note('[step] AI 企划勾选框存在 =', await toggle.count(), '当前 checked =', await toggle.count() ? await toggle.isChecked() : 'n/a');
await page.fill('#np-title', `审计-${scenario}`);
await page.fill('#np-premise', '一个在雨夜收到未来来信的人。');

const primary = page.locator('.modal__foot .btn--primary');
note('[step] 主按钮文案 =', JSON.stringify((await primary.innerText()).trim()), 'disabled =', await primary.isDisabled());
await primary.click();
note('[step] 已点击主按钮');

// 观察 20 秒内的界面变化
const marks = [];
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(500);
  const snap = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const btn = q('.modal__foot .btn--primary');
    return {
      url: location.pathname,
      modal: !!q('.modal'),
      btnText: btn ? btn.textContent.trim() : null,
      btnDisabled: btn ? btn.disabled : null,
      notice: q('.modal__notice') ? q('.modal__notice').innerText.replace(/\s+/g, ' ').slice(0, 160) : null,
      toast: Array.from(document.querySelectorAll('.toast')).map((e) => e.innerText.replace(/\s+/g, ' ')).join(' | ') || null,
      planReview: !!q('.plan-review'),
      studioDoc: !!q('.doc-title-input'),
      loadingScreen: !!q('.loading-screen'),
    };
  });
  const key = JSON.stringify(snap);
  if (marks[marks.length - 1] !== key) { marks.push(key); note(`[${el()}] 界面 = ${key}`); }
  if (snap.planReview || snap.notice || snap.toast) break;
}
await page.screenshot({ path: `/tmp/inkq-audit/shot-${scenario}.png`, fullPage: true });

const finalUrl = page.url();
const projects = await (await fetch(`${BASE}/api/projects`)).json();
note('[result] 最终 URL =', finalUrl);
note('[result] 项目数 =', projects.projects.length, JSON.stringify(projects.projects.map((p) => ({ id: p.id, title: p.title, chapters: p.chapterCount, words: p.totalWords }))));
note('[result] console =', JSON.stringify(consoleMsgs.slice(0, 10)));
note('[result] pageErrors =', JSON.stringify(pageErrors.slice(0, 5)));
console.log('\n===== NETWORK =====');
console.log(netLog.join('\n'));
await browser.close();
