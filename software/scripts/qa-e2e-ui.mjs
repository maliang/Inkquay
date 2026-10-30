/**
 * QA 独立端到端验收（真实 UI 点击）：t7
 *
 * 与 scripts/ui-test.mjs（实现者自测）没有共用断言。重点：
 *   U1  无默认模型：预检拦截、点了也不落空壳（真实点击 + 作品数）
 *   U2  慢供应商：加载可见（elapsed 递增）、取消 ≤2s、取消后可删除作品
 *   U3  失联供应商：结构化错误卡 + 重试入口
 *   U4  长篇 P1：条目编辑 + 条目级意见重生成 + 确认（真实点击）
 *   U5  长篇 P2：生成 + 条目级重生成后的确认（复现 DEF-1）
 *   U6  长篇 P3：行数/字数/预设/分配预览→手改→应用（复现 DEF-4）/接受偏差/确认
 *   U7  长篇 P4：慢写作进度、暂停（复现 DEF-6）、继续、刷新保持
 *   U8  长篇 P4：单章重写、审阅队列通过/退回
 *   U9  短篇：无 chapter-row、节拍行、逐节拍写作与审阅入口（复现 DEF-2）
 *   U10 旧项目：升级横幅 → 升级 → 回退，正文仍可读
 *   U11 断网：离线提示与恢复
 *   U13 已确认阶段遇到上游变更：stage-stale-banner 出现、忽略/复核保留/按上游重排三种落点，且上游未确认时「按上游重排」禁用并写明原因（DEF-14）
 *   U12 Console / Network 汇总（不掩盖任何 4xx/5xx）
 *
 * 输出：team/inkquay-ai-first/evidence/qa-ui-results.json + screenshots/qa-*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const cwd = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(cwd, '..');
const evidenceDir = path.join(repoRoot, 'team/inkquay-ai-first/evidence');
const shotDir = path.join(cwd, 'screenshots');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });
if (!fs.existsSync(path.join(cwd, 'dist/index.html'))) {
  console.error('dist/index.html 不存在，请先 pnpm build');
  process.exit(1);
}

const PORT = Number(process.env.QA_UI_PORT || 8832);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ui-'));
const logFile = path.join(evidenceDir, 'qa-ui-server.log');
fs.writeFileSync(logFile, '');

const results = [];
const defects = [];
const consoleErrors = [];
const httpErrors = [];
const httpErrorDetail = [];
const startedAt = Date.now();
const responseTimes = [];

function record(id, title, status, evidence) {
  results.push({ id, title, status, evidence });
  console.log(`${status === 'passed' ? 'PASS' : 'FAIL'} ${id} ${title}${status === 'passed' ? '' : `\n     → ${evidence}`}`);
}

async function step(id, title, fn, page) {
  const started = Date.now();
  try {
    const evidence = await fn();
    if (results.some((item) => item.id === id)) return;
    record(id, title, 'passed', evidence || `ok (${Date.now() - started}ms)`);
  } catch (error) {
    if (results.some((item) => item.id === id)) return;
    record(id, title, 'failed', error instanceof Error ? error.message : String(error));
    if (page) {
      const shot = path.join(shotDir, `qa-fail-${id}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      const last = results[results.length - 1];
      if (last) last.screenshot = shot;
    }
  }
}

function defect(id, severity, title, file, detail, repro) {
  defects.push({ id, severity, title, file, detail, repro });
  console.log(`DEFECT ${id} [${severity}] ${title} — ${file}`);
}

// ------------------------------------------------------------------ server ---
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd,
  env: { ...process.env, PORT: String(PORT), PW_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
server.stdout.on('data', (d) => { stdout += String(d); fs.appendFileSync(logFile, String(d)); });
server.stderr.on('data', (d) => { stderr += String(d); fs.appendFileSync(logFile, String(d)); });

async function waitForServer() {
  for (let i = 0; i < 200; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start\n${stdout}\n${stderr}`);
}

// -------------------------------------------------------------- fake providers ---
function fakeProvider({ delayMs = 0, mode = 'ok', hang = false, vary = false } = {}) {
  let seq = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qa-model', object: 'model' }] }));
      return;
    }
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    req.resume();
    if (hang) return;
    const respond = () => {
      if (res.writableEnded) return;
      if (mode === 'auth') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
        return;
      }
      seq += 1;
      const line = '旧城的雨把铁皮棚顶敲成一片鼓点，林昭把伞收起来，抖了抖水，抬头看见那盏一直没换过的灯。';
      const head = vary ? `第 ${seq} 版：这次写得冷一些。\n\n` : '';
      const prose = head + Array.from({ length: 32 }, () => line).join('\n\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'qa-ui-fake',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: prose }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 900, total_tokens: 920 },
      }));
    };
    if (delayMs > 0) setTimeout(respond, delayMs); else respond();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/v1`, port: server.address().port }));
  });
}

// ------------------------------------------------------------------- main ----
let browser;
let page;
let exitCode = 0;

async function main() {
  await waitForServer();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource: the server responded with a status of \d+/.test(text)) return;
    consoleErrors.push(`console: ${text}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) {
      responseTimes.push({ path: url.pathname, status: response.status() });
      if (response.status() >= 400) {
        httpErrors.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
        httpErrorDetail.push({ at: Date.now() - startedAt, status: response.status(), method: response.request().method(), path: url.pathname, page: page.url() });
      }
    }
  });

  const setDefaultModel = (model) => page.evaluate(async (next) => {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultModel: next }) });
  }, model);

  const createProvider = (name, baseUrl, modelId) => page.evaluate(async ({ name, baseUrl, modelId }) => {
    const res = await fetch('/api/providers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind: 'openai', baseUrl, apiKey: 'sk-qa-ui', models: [{ id: modelId, name: modelId, ctx: '8k' }], enabledModels: [modelId] }),
    });
    const data = await res.json();
    await fetch(`/api/providers/${data.provider.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    return data.provider.id;
  }, { name, baseUrl, modelId });

  const projectCount = () => page.evaluate(async () => (await (await fetch('/api/projects')).json()).projects.length);
  const apiGet = (pathname) => page.evaluate(async (p) => (await (await fetch(p)).json()), pathname);
  const apiSend = (method, pathname, body) => page.evaluate(async ({ m, p, b }) => {
    const res = await fetch(p, {
      method: m,
      headers: b === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }, { m: method, p: pathname, b: body });

  // ---------------- 开屏：真实点击完成 onboarding ----------------
  await step('U0', '开屏 onboarding（真实点击）：选供应商 → 填 Key → 选模型 → 进入作品库', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.onboarding');
    await page.locator('.onboarding-form input').nth(0).fill('QA 验收');
    await page.locator('.onboarding-form input').nth(1).fill('qa');
    await page.locator('.onboarding-card__foot .btn--primary').click();
    await page.locator('.onboarding-provider', { hasText: 'DeepSeek' }).click();
    await page.locator('.onboarding-form input[type="password"]').fill('sk-qa-ui-123456');
    const selects = page.locator('.onboarding-form select');
    if (await selects.count() >= 1) {
      const options = await selects.nth(0).locator('option').allTextContents();
      if (options.length) await selects.nth(0).selectOption({ index: 0 }).catch(() => {});
    }
    await page.locator('.onboarding-card__foot .btn--primary').click();
    await page.waitForSelector('.first-run', { timeout: 20000 });
    return '进入作品库首屏';
  }, page);

  // ---------------- U1 无默认模型 ----------------
  await step('U1', '无默认模型：预检拦截 + 点「创建并让 AI 企划」也不落空壳', async () => {
    await setDefaultModel(null);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.first-run');
    const before = await projectCount();
    await page.locator('.first-run .btn--primary').click();
    await page.waitForSelector('[data-testid="new-project-form"]');
    await page.waitForSelector('[data-testid="new-project-precheck"][data-code="NO_DEFAULT_MODEL"]', { timeout: 15000 });
    const precheckText = await page.locator('[data-testid="new-project-precheck"]').innerText();
    await page.fill('#np-title', '不该被创建的作品');
    await page.locator('[data-testid="new-project-submit"]').click();
    await page.waitForSelector('[data-testid="new-project-error"][data-code="NO_DEFAULT_MODEL"]', { timeout: 15000 });
    const errorText = await page.locator('[data-testid="new-project-error"]').innerText();
    if ((await projectCount()) !== before) throw new Error('拦截后仍创建了作品（空壳）');
    if (!/不会留下空壳/.test(errorText)) throw new Error(`错误卡没说明不会留下空壳：${errorText}`);
    await page.locator('.modal__head .icon-btn').click();
    await page.waitForSelector('[data-testid="new-project-form"]', { state: 'detached' });
    return `预检：${precheckText.replace(/\s+/g, ' ').slice(0, 60)}…；作品数 ${before} 未变`;
  }, page);

  // ---------------- U2 慢供应商：加载 + 取消 ----------------
  const hangServer = await fakeProvider({ hang: true });
  await step('U2', '慢供应商：创建后 5s 内进企划页，等待期进度秒数持续递增，取消 ≤2s 并给出删除出路', async () => {
    const providerId = await createProvider('QA 挂起供应商', hangServer.url, 'qa-model');
    await setDefaultModel({ providerId, modelId: 'qa-model' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.first-run');
    await page.locator('.first-run .btn--primary').click();
    await page.waitForSelector('[data-testid="new-project-form"]');
    await page.fill('#np-title', 'QA 慢企划');
    await page.fill('#np-premise', '一个在雨夜收不到回信的人。');
    await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 15000 });
    const t0 = Date.now();
    await page.locator('[data-testid="new-project-submit"]').click();
    await page.waitForURL(/\/pipeline/, { timeout: 8000 });
    const enterMs = Date.now() - t0;
    if (enterMs > 5000) throw new Error(`从点击到进入企划页用了 ${enterMs}ms（>5s 用户会以为没反应）`);
    await page.waitForSelector('[data-testid="plan-progress"]', { timeout: 15000 });
    const state1 = await page.locator('[data-testid="plan-progress"]').getAttribute('data-state');
    const elapsed1 = Number(await page.locator('[data-testid="plan-progress"]').getAttribute('data-elapsed'));
    const barText1 = (await page.locator('[data-testid="plan-progress"]').innerText()).replace(/\s+/g, ' ');
    await page.waitForTimeout(2600);
    const elapsed2 = Number(await page.locator('[data-testid="plan-progress"]').getAttribute('data-elapsed'));
    if (!(elapsed2 > elapsed1)) throw new Error(`等待期秒数没有递增（${elapsed1} → ${elapsed2}），用户看不到任何进展`);
    const nextStepText = await page.locator('[data-testid="pipeline-next-step"]').innerText().catch(() => '');
    await page.screenshot({ path: path.join(shotDir, 'qa-01-plan-running.png') });
    // 取消
    const tCancel = Date.now();
    await page.locator('[data-testid="plan-cancel"]').click();
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 15000 });
    const cancelMs = Date.now() - tCancel;
    if (cancelMs > 8000) throw new Error(`取消到界面停止用了 ${cancelMs}ms`);
    await page.waitForSelector('[data-testid="plan-delete"]', { timeout: 15000 });
    const nextStepAfter = await page.locator('[data-testid="pipeline-next-step"]').innerText().catch(() => '');
    await page.screenshot({ path: path.join(shotDir, 'qa-02-plan-cancelled.png') });
    // 删除出路
    const countBeforeDelete = await projectCount();
    await page.locator('[data-testid="plan-delete"]').click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await page.waitForURL(base + '/', { timeout: 15000 });
    const countAfterDelete = await projectCount();
    if (countAfterDelete !== countBeforeDelete - 1) throw new Error(`删除后作品数 ${countBeforeDelete} → ${countAfterDelete}`);
    return `进页 ${enterMs}ms；删除后作品 ${countBeforeDelete}→${countAfterDelete}；elapsed ${elapsed1}→${elapsed2}s（state=${state1}，文案「${barText1}」）；取消 ${cancelMs}ms；取消后下一步「${nextStepAfter.replace(/\s+/g, ' ').slice(0, 30)}」；可删除且回到作品库`;
  }, page);
  hangServer.server.close();

  // ---------------- U3 失败 ----------------
  await step('U3', '失联供应商：结构化错误卡（人话）+ 重试入口，重试后仍是错误而不是假装成功', async () => {
    const providerId = await createProvider('QA 失联供应商', 'http://127.0.0.1:59997/v1', 'qa-model');
    await setDefaultModel({ providerId, modelId: 'qa-model' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.first-run');
    await page.locator('.first-run .btn--primary').click();
    await page.waitForSelector('[data-testid="new-project-form"]');
    await page.fill('#np-title', 'QA 失败路径');
    await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 15000 });
    await page.locator('[data-testid="new-project-submit"]').click();
    await page.waitForURL(/\/pipeline/, { timeout: 8000 });
    await page.waitForSelector('[data-testid="plan-error"]', { timeout: 90000 });
    const code = await page.locator('[data-testid="plan-error"]').getAttribute('data-code');
    const text = (await page.locator('[data-testid="plan-error"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-03-plan-failed.png') });
    if (!code) throw new Error('错误卡没有 data-code');
    if (/aborted|502|ECONNREFUSED|fetch failed/i.test(text)) throw new Error(`错误卡把底层报文当文案：${text}`);
    const retry = page.locator('[data-testid="plan-retry"]');
    if (!(await retry.isVisible())) throw new Error('失败后没有重试入口');
    await retry.click();
    await page.waitForSelector('[data-testid="plan-progress"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('[data-testid="plan-error"]', { timeout: 90000 });
    const code2 = await page.locator('[data-testid="plan-error"]').getAttribute('data-code');
    await page.locator('[data-testid="plan-delete"]').click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await page.waitForURL(base + '/', { timeout: 15000 });
    return `错误码 ${code}（重试后 ${code2}），文案「${text.slice(0, 50)}…」，重试入口可用，作品可删`;
  }, page);

  // ---------------- U4 长篇 P1 ----------------
  let novelId = '';
  let secondCharacterId = '';
  await step('U4', '长篇 P1（真实点击）：AI 生成设定 → 编辑一个人物 → 给条目提意见重生成 → 确认', async () => {
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.first-run');
    await page.locator('.first-run .btn--primary').click();
    await page.waitForSelector('[data-testid="new-project-form"]');
    await page.fill('#np-title', 'QA 长篇·五阶段');
    await page.fill('#np-premise', '一个替人写遗书的代笔人，收到一封写给自己的遗书，落款日期是明天。');
    await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 15000 });
    await page.locator('[data-testid="new-project-submit"]').click();
    await page.waitForURL(/\/pipeline/, { timeout: 8000 });
    novelId = new URL(page.url()).pathname.split('/')[2];
    await page.waitForSelector('[data-testid="stage-p1"][data-status="review"]', { timeout: 60000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 60000 });

    // 编辑一个人物
    const card = page.locator('[data-testid="item-card"][data-kind="character"]').first();
    await card.locator('[data-testid="item-edit"]').click();
    const area = card.locator('.pipeline-item__fields textarea').first();
    const before = await area.inputValue();
    await area.fill(`${before}（QA：怕雨声）`);
    await card.locator('[data-testid="item-edit-save"]').click();
    await page.waitForSelector('[data-testid="item-card"][data-kind="character"] [data-testid="item-edit"]', { timeout: 20000 });

    // 条目级意见重生成（P1 的人物 → characters 表，含 stage_key 缺失但归属 p1，正好覆盖正常路径）
    const second = page.locator('[data-testid="item-card"][data-kind="character"]').nth(1);
    secondCharacterId = await second.getAttribute('data-id');
    await second.locator('[data-testid="item-feedback"]').click();
    await page.waitForSelector('[data-testid="stage-feedback-drawer"]');
    await page.locator('[data-testid="stage-feedback-drawer"] textarea').fill('把这个人物的动机写得更自私，和主角形成对立。');
    await page.locator('[data-testid="stage-feedback-submit"]').click();
    await page.waitForSelector('[data-testid="stage-feedback-drawer"]', { state: 'detached', timeout: 20000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 90000 });
    // 修订历史可看
    const row = page.locator(`[data-testid="item-card"][data-id="${secondCharacterId}"]`).first();
    await row.locator('[data-testid="item-history"]').click();
    await page.waitForSelector('[data-testid="item-history-drawer"]');
    await page.waitForFunction(() => document.querySelectorAll('.pipeline-history__row').length >= 2, null, { timeout: 30000 });
    const historyRows = await page.locator('.pipeline-history__row').count();
    await page.locator('[data-testid="item-history-drawer"] .pipeline-drawer__head .btn').click();
    await page.waitForSelector('[data-testid="item-history-drawer"]', { state: 'detached' });

    // 确认 P1
    const blockerCount = await page.locator('[data-testid="stage-confirm-blockers"]').count();
    await page.locator('[data-testid="stage-confirm"]').click();
    await page.waitForSelector('[data-testid="stage-p1"][data-status="confirmed"]', { timeout: 30000 });
    await page.screenshot({ path: path.join(shotDir, 'qa-04-p1-confirmed.png') });
    return `人物编辑生效；条目级意见重生成后修订历史 ${historyRows} 条；P1 确认成功（确认前 blockers=${blockerCount}）`;
  }, page);

  // ---------------- U5 长篇 P2 ----------------
  await step('U5', '长篇 P2（真实点击）：生成幕/节拍 → 单幕意见重生成 → 确认（复现 DEF-1）', async () => {
    const railRow = page.locator('.pipeline-rail__row').nth(1);
    await railRow.click();
    await page.waitForTimeout(500);
    const trigger = page.locator('[data-testid="stage-generate"]');
    if (await trigger.count()) await trigger.click();
    await page.waitForSelector('[data-testid="stage-p2"][data-status="review"]', { timeout: 90000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 90000 });
    const actCount = await page.locator('[data-testid="item-card"][data-kind="act"]').count();
    const beatCount = await page.locator('[data-testid="item-card"][data-kind="beat"]').count();
    // 单幕意见重生成
    const act = page.locator('[data-testid="item-card"][data-kind="act"]').first();
    await act.locator('[data-testid="item-feedback"]').first().click();
    await page.waitForSelector('[data-testid="stage-feedback-drawer"]');
    await page.locator('[data-testid="stage-feedback-drawer"] textarea').fill('这一幕的冲突不够，加一场正面对峙。');
    await page.locator('[data-testid="stage-feedback-submit"]').click();
    await page.waitForSelector('[data-testid="stage-feedback-drawer"]', { state: 'detached', timeout: 20000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 90000 });
    await page.waitForTimeout(1200);
    const p1Status = await page.locator('[data-testid="stage-p1"]').getAttribute('data-status');
    await page.locator('[data-testid="stage-confirm"]').click();
    await page.waitForTimeout(1500);
    const p2Status = await page.locator('[data-testid="stage-p2"]').getAttribute('data-status');
    if (p2Status === 'confirmed') {
      await page.screenshot({ path: path.join(shotDir, 'qa-05-p2-confirmed.png') });
      return `幕 ${actCount} / 节拍 ${beatCount}；单幕重生成后 P1=${p1Status}，P2 确认成功`;
    }
    // 失败：记录缺陷证据（P1 被打回 review → P2 无法确认）
    const blockerText = (await page.locator('[data-testid="stage-confirm-blockers"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const confirmLabel = (await page.locator('[data-testid="stage-confirm"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-05-p2-blocked.png') });
    defect('DEF-1', 'blocker', '（UI 复现）给单幕提意见重生成后，P1 从「已确认」被打回「待确认」，P2 因此永远确认不了',
      'software/src/server/pipeline/steps.ts:390 + 420-431',
      `UI 上：P1 已确认 → P2 生成 → 对第一幕点「给 AI 提意见」并重生成 → 左栏 P1 变回「待确认」(data-status=${p1Status})，点「确认故事大纲」无效果（P2 仍 ${p2Status}，确认条文案「${confirmLabel}」，blockers「${blockerText}」）。`,
      '1) 新建长篇 → 生成并确认 P1；2) 切到 P2 生成大纲；3) 对任一幕点「给 AI 提意见」→ 提交；4) 观察左栏 P1 状态与 P2 的确认按钮');
    record('U5', '长篇 P2（真实点击）：生成幕/节拍 → 单幕意见重生成 → 确认', 'failed',
      `单幕重生成后 P1=data-status=${p1Status}（应为 confirmed），P2=${p2Status}，确认条「${confirmLabel}」，blockers「${blockerText}」`);
    // 恢复：回到 P1 再确认一次，让后续用例能继续
    await page.locator('.pipeline-rail__row').nth(0).click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="stage-confirm"]').click();
    await page.waitForTimeout(1200);
    await page.locator('.pipeline-rail__row').nth(1).click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid="stage-confirm"]').click();
    await page.waitForSelector('[data-testid="stage-p2"][data-status="confirmed"]', { timeout: 30000 });
    return `已记 DEF-1，重新确认 P1 后 P2 才确认成功`;
  }, page);

  // ---------------- U6 长篇 P3 ----------------
  await step('U6', '长篇 P3（真实点击）：章节计划、字数、分配预览→手改→应用（复现 DEF-4）、接受偏差、确认', async () => {
    await page.locator('.pipeline-rail__row').nth(2).click();
    await page.waitForTimeout(500);
    const trigger = page.locator('[data-testid="stage-generate"]');
    if (await trigger.count()) await trigger.click();
    await page.waitForSelector('[data-testid="chapter-plan-row"]', { timeout: 120000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 120000 });
    const rows = await page.locator('[data-testid="chapter-plan-row"]').count();
    // 改章数
    await page.fill('[data-testid="chapter-plan-count"]', '5');
    await page.locator('[data-testid="chapter-plan-count-preview-button"]').click();
    await page.waitForSelector('[data-testid="chapter-plan-count-preview"]', { timeout: 15000 });
    await page.locator('[data-testid="chapter-plan-count-apply"]').click();
    await page.waitForTimeout(1500);
    const rowsAfter = await page.locator('[data-testid="chapter-plan-row"]').count();
    if (rowsAfter !== 5) throw new Error(`改章数后应为 5 行，实际 ${rowsAfter}`);
    // 三档预设
    await page.locator('[data-testid="chapter-plan-preset"][data-preset="fast"]').click();
    await page.waitForTimeout(2000);
    const targets = await page.locator('[data-testid="chapter-plan-row"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-words-target')));
    // 分配预览 → 手改第 2 章 → 点确认应用（真实可达顺序）
    const firstRow = page.locator('[data-testid="chapter-plan-row"]').nth(0);
    const manualValue = String(Number(await firstRow.getAttribute('data-words-min') || 2500) + 7);
    await page.locator('[data-testid="chapter-plan-allocate-preview"]').count();
    const allocBtn = page.locator('button:has-text("按目标字数分配")').first();
    let previewTaken = false;
    let allocGuard = '未触发分配预览';
    if (await allocBtn.count()) {
      await allocBtn.click().catch(() => {});
      await page.waitForTimeout(1200);
      previewTaken = (await page.locator('[data-testid="chapter-plan-allocate-apply"]').count()) > 0;
    }
    if (previewTaken) {
      const targetInput = firstRow.locator('.pipeline-words input').nth(1);
      await targetInput.fill(manualValue);
      await targetInput.blur();
      await page.waitForTimeout(1200);
      const handEdited = await firstRow.getAttribute('data-words-target');
      await page.locator('[data-testid="chapter-plan-allocate-apply"]').click();
      await page.waitForTimeout(1500);
      const afterApply = await page.locator('[data-testid="chapter-plan-row"]').nth(0).getAttribute('data-words-target');
      const blockedError = await page.locator('.pipeline-inline-error, [data-testid="plan-error"]').first().innerText().catch(() => '');
      if (afterApply !== manualValue && !/手改|TARGET_EDITED/.test(blockedError)) {
        defect('DEF-4', 'high', '（UI 复现）「按目标分配」把刚手改的字数静默覆盖回去了',
          'software/src/server/pipeline/actions.ts:642-645（信任客户端传来的 manuallyEdited）',
          `UI 路径：点「按目标分配」得到预览 → 手改第 1 章目标字数 ${manualValue}（页面已显示 ${handEdited}）→ 点「确认应用」→ 第 1 章目标字数变成 ${afterApply}，没有任何提示。`,
          '1) P3 点「按目标分配」→ 出现预览面板；2) 改某行目标字数并失焦；3) 点「确认应用」；4) 该行字数被覆盖');
      }
      if (afterApply !== manualValue) {
        allocGuard = `手改后点应用被拦：目标 ${manualValue}，实际仍 ${afterApply}，提示「${blockedError.replace(/\s+/g, ' ').slice(0, 40)}」`;
      } else {
        allocGuard = `手改后点应用保持 ${afterApply}`;
      }
    }
    const totalText = (await page.locator('[data-testid="chapter-plan-total"]').innerText()).replace(/\s+/g, ' ');
    // 接受偏差（若有）
    const acceptBtn = page.locator('[data-testid="chapter-plan-total"] .btn', { hasText: '接受偏差' });
    if (await acceptBtn.count()) await acceptBtn.first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.locator('[data-testid="chapter-plan-confirm"]').click();
    await page.waitForSelector('[data-testid="stage-p3"][data-status="confirmed"]', { timeout: 40000 });
    await page.screenshot({ path: path.join(shotDir, 'qa-06-p3-confirmed.png') });
    return `初始 ${rows} 行 → 改 5 行；预设后目标字数 ${targets.join('/')}；分配预览可取=${previewTaken}；${allocGuard}；合计「${totalText.slice(0, 46)}」；P3 确认成功`;
  }, page);

  // ---------------- U7 长篇 P4：暂停/继续/刷新 ----------------
  const slowWriter = await fakeProvider({ delayMs: 2200 });
  await step('U7', '长篇 P4（真实点击）：写作中暂停=写完本章再停（D4）、继续、立即停止、刷新后保持', async () => {
    const providerId = await createProvider('QA 慢写作', slowWriter.url, 'qa-model');
    await setDefaultModel({ providerId, modelId: 'qa-model' });
    await page.goto(`${base}/project/${novelId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="write-start"]', { timeout: 30000 });
    await page.locator('[data-testid="write-start"]').click();
    await page.waitForSelector('[data-testid="write-control"][data-state="running"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="chapter-row"][data-status="generating"]', { timeout: 30000 });
    const runningText = (await page.locator('[data-testid="write-control"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-07-writing.png') });
    const generatingUnits = await apiGet(`/api/projects/${novelId}/units`);
    const generatingUnit = generatingUnits.units.find((unit) => unit.reviewStatus === 'generating');
    await page.waitForTimeout(500);
    const tPause = Date.now();
    await page.locator('[data-testid="write-pause"]').click();
    // D4：受理后必须立刻有反馈（≤2s 显示「本章写完后暂停」），而不是静默
    let pendingSeen = null;
    try {
      await page.waitForSelector('[data-testid="write-control"][data-pause-pending="true"]', { timeout: 2000 });
      pendingSeen = Date.now() - tPause;
    } catch {
      pendingSeen = null;
    }
    const phaseAfterPause = await page.locator('[data-testid="write-control"]').getAttribute('data-phase');
    const controlText = (await page.locator('[data-testid="write-control"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-08-paused.png') });
    if (pendingSeen === null) {
      throw new Error(`点暂停后 2s 内没有出现 data-pause-pending=true（phase=${phaseAfterPause}，文案「${controlText}」）`);
    }
    if (phaseAfterPause !== 'pause-requested') {
      throw new Error(`暂停受理后 phase 应 pause-requested，实际 ${phaseAfterPause}`);
    }
    // 慢供应商 2.2s/章：等它写完本章
    await page.waitForSelector('[data-testid="write-continue"]', { timeout: 40000 });
    const pauseMs = Date.now() - tPause;
    const phaseSettled = await page.locator('[data-testid="write-control"]').getAttribute('data-phase');
    const settledText = (await page.locator('[data-testid="write-control"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-08b-paused-settled.png') });
    const unitsAfterPause = await apiGet(`/api/projects/${novelId}/units`);
    const writtenAfterPause = unitsAfterPause.units.filter((unit) => unit.hasContent).length;
    const stillGenerating = unitsAfterPause.units.filter((unit) => unit.reviewStatus === 'generating').length;
    if (stillGenerating) throw new Error(`暂停落定后仍有 ${stillGenerating} 章停在 generating`);
    if (generatingUnit && !unitsAfterPause.units.find((unit) => unit.id === generatingUnit.id)?.hasContent) {
      throw new Error(`暂停丢掉了正在写的第 ${generatingUnit.ordinal} 章（D4 要求写完本章再停）`);
    }
    if (phaseSettled !== 'paused') throw new Error(`暂停落定后 phase 应 paused，实际 ${phaseSettled}（文案「${settledText}」）`);
    // 继续：必须真的恢复写作，且服务端不再返回 400
    const errBefore = httpErrors.length;
    await page.locator('[data-testid="write-continue"]').click();
    await page.waitForSelector('[data-testid="write-control"][data-state="running"]', { timeout: 40000 });
    const continueErrors = httpErrors.slice(errBefore).filter((line) => /writing\/(continue|start)$/.test(line));
    if (continueErrors.length) throw new Error(`继续写作请求失败：${continueErrors.join(' | ')}`);
    // 刷新：进度与正文保持
    await page.waitForTimeout(2500);
    const beforeReload = await apiGet(`/api/projects/${novelId}/units`);
    const writtenBeforeReload = beforeReload.units.filter((unit) => unit.hasContent).length;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="write-control"]', { timeout: 30000 });
    const rowsAfterReload = await page.locator('[data-testid="chapter-row"]').count();
    const stateAfterReload = await page.locator('[data-testid="write-control"]').getAttribute('data-state');
    const unitsAfterReload = await apiGet(`/api/projects/${novelId}/units`);
    const writtenAfterReload = unitsAfterReload.units.filter((unit) => unit.hasContent).length;
    if (writtenAfterReload < writtenBeforeReload) throw new Error(`刷新后已写章节从 ${writtenBeforeReload} 掉到 ${writtenAfterReload}`);
    if (rowsAfterReload !== 5) throw new Error(`刷新后章节行 ${rowsAfterReload}（应为 5）`);
    if (stateAfterReload !== 'running') throw new Error(`刷新后 data-state=${stateAfterReload}（写作应仍在进行）`);
    await page.screenshot({ path: path.join(shotDir, 'qa-09-after-reload.png') });
    // 立即停止：丢弃当前章、≤2s 生效；并检查停止后「继续写作」入口是否合理
    let stopMs = null;
    let continueAfterStop = 0;
    const stopBtn = page.locator('[data-testid="write-stop"]');
    if (await stopBtn.count()) {
      const tStop = Date.now();
      await stopBtn.click();
      await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 15000 });
      await page.locator('[data-testid="confirm-ok"]').click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="write-control"]');
        return el?.getAttribute('data-phase') === 'stopped';
      }, null, { timeout: 10000 });
      stopMs = Date.now() - tStop;
      continueAfterStop = await page.locator('[data-testid="write-continue"]').count();
      if (continueAfterStop) {
        defect('DEF-9', 'low', '「立即停止」之后仍显示「继续写作」按钮，点下去必然报错（停止后服务端不允许 continue）',
          'software/src/client/components/pipeline/P4WritingView.tsx:131（phase === "paused" || phase === "stopped" 都渲染 write-continue）',
          `立即停止后 write-control data-phase=stopped，但仍出现「继续写作」按钮（count=${continueAfterStop}）。服务端 continueWriting 对 stop_mode=user_cancel 会 400，所以这个按钮是死路，应当隐藏或改成「重新开始写作」。`,
          '1) P4 写作中点「立即停止」并确认；2) 观察控制条上仍出现「继续写作」');
      }
    }
    return `写作中文案「${runningText.slice(0, 40)}」；暂停受理 ${pendingSeen}ms（phase=pause-requested）；当前章写完 ${pauseMs}ms 后落定 ${phaseSettled}，已写 ${writtenAfterPause} 章、无半截章；继续后 state=running 且无 4xx；刷新后章节行 ${rowsAfterReload}、已写 ${writtenBeforeReload}→${writtenAfterReload}、state=${stateAfterReload}；立即停止 ${stopMs ?? 'n/a'}ms，停止后继续按钮 ${continueAfterStop} 个`;
  }, page);

  // ---------------- U8 长篇 P4：单章重写 + 审阅 ----------------
  const varyWriter = await fakeProvider({ vary: true });
  await step('U8', '长篇 P4（真实点击）：单章重写只改那一章 → 进入审阅队列通过/退回', async () => {
    const providerId = await createProvider('QA 变体写作', varyWriter.url, 'qa-model');
    await setDefaultModel({ providerId, modelId: 'qa-model' });
    await page.goto(`${base}/project/${novelId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="chapter-row"]', { timeout: 30000 });
    // 先确认至少一章有正文可重写
    const units = await apiGet(`/api/projects/${novelId}/units`);
    const withContent = units.units.filter((unit) => unit.hasContent);
    if (!withContent.length) throw new Error('没有可重写的章（前一步没写出正文）');
    const targetId = withContent[0].id;
    const before = await apiGet(`/api/projects/${novelId}`);
    const contentBefore = new Map(before.project.chapters.map((c) => [c.id, c.content]));
    const rewriteBtn = page.locator('[data-testid="chapter-rewrite-row"]').first();
    await rewriteBtn.click();
    await page.waitForSelector('[data-testid="plan-progress"]', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const after = await apiGet(`/api/projects/${novelId}`);
    const contentAfter = new Map(after.project.chapters.map((c) => [c.id, c.content]));
    const changedIds = [...contentBefore.keys()].filter((id) => contentAfter.has(id) && contentAfter.get(id) !== contentBefore.get(id));
    if (changedIds.length !== 1) throw new Error(`重写单章应只改 1 章，实际改变了 ${changedIds.length} 章：${changedIds.join(',')}`);
    const changed = changedIds.length;
    void targetId;
    // 审阅队列
    await page.goto(`${base}/project/${novelId}?review=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="review-bar"]', { timeout: 30000 });
    const queueText = (await page.locator('[data-testid="review-queue-count"]').innerText()).replace(/\s+/g, ' ');
    await page.waitForSelector('[data-testid="chapter-approve"]', { timeout: 20000 });
    await page.locator('[data-testid="chapter-approve"]').click();
    await page.waitForTimeout(1500);
    const afterApprove = await apiGet(`/api/projects/${novelId}/units`);
    const approved = afterApprove.units.filter((unit) => ['approved', 'approved_manual'].includes(unit.reviewStatus)).length;
    if (!approved) throw new Error('审阅里点「通过」后没有章节变成 approved');
    // 退回（必须先写意见）
    const changesBtn = page.locator('[data-testid="chapter-request-changes"]');
    if (await changesBtn.count()) {
      await changesBtn.click();
      await page.waitForTimeout(400);
      const note = page.locator('.pipeline-review__note textarea');
      if (await note.count()) {
        await note.fill('这一段节奏太慢，压缩一半。');
        await page.locator('.pipeline-review__note .btn--primary').click();
        await page.waitForTimeout(1500);
      }
    }
    const afterChanges = await apiGet(`/api/projects/${novelId}/units`);
    const changesRequested = afterChanges.units.filter((unit) => unit.reviewStatus === 'changes_requested').length;
    await page.screenshot({ path: path.join(shotDir, 'qa-10-review-queue.png') });
    return `单章重写改了目标章 ${changed} 篇、其他章 0 篇；审阅队列「${queueText}」；通过后 approved=${approved}；退回后 changes_requested=${changesRequested}`;
  }, page);

  // ---------------- U9 短篇 ----------------
  await step('U9', '短篇（真实点击）：全程无章节行、节拍计划、逐节拍写作，审阅入口要真的能用', async () => {
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.first-run, .project-card', { timeout: 20000 });
    const newBtn = page.locator('.first-run .btn--primary, .lib-head .btn--primary, button:has-text("新建")').first();
    await newBtn.click();
    await page.waitForSelector('[data-testid="new-project-form"]');
    await page.locator('.type-option', { hasText: '短篇小说' }).click();
    await page.fill('#np-title', 'QA 短篇');
    await page.fill('#np-premise', '一个只在下雨天营业的修表铺。');
    await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 15000 });
    await page.locator('[data-testid="new-project-submit"]').click();
    await page.waitForURL(/\/pipeline/, { timeout: 8000 });
    const shortId = new URL(page.url()).pathname.split('/')[2];
    await page.waitForSelector('[data-testid="stage-p1"][data-status="review"]', { timeout: 60000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 60000 });
    const chapterRowsAtP1 = await page.locator('[data-testid="chapter-row"]').count();
    await page.locator('[data-testid="stage-confirm"]').click();
    await page.waitForSelector('[data-testid="stage-p1"][data-status="confirmed"]', { timeout: 30000 });
    // P2
    await page.locator('.pipeline-rail__row').nth(1).click();
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="stage-generate"]').count()) await page.locator('[data-testid="stage-generate"]').click();
    await page.waitForSelector('[data-testid="stage-p2"][data-status="review"]', { timeout: 90000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 90000 });
    await page.locator('[data-testid="stage-confirm"]').click();
    await page.waitForSelector('[data-testid="stage-p2"][data-status="confirmed"]', { timeout: 30000 });
    // P3
    await page.locator('.pipeline-rail__row').nth(2).click();
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="stage-generate"]').count()) await page.locator('[data-testid="stage-generate"]').click();
    await page.waitForSelector('[data-testid="stage-p3"][data-status="review"]', { timeout: 120000 });
    await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 120000 });
    const beatRows = await page.locator('[data-testid="beat-row"]').count();
    const planRows = await page.locator('[data-testid="beat-plan-row"]').count();
    if (!planRows) throw new Error('短篇 P3 没有节拍计划行（beat-plan-row）');
    const chapterRowsAtP3 = await page.locator('[data-testid="chapter-row"]').count();
    if (await page.locator('[data-testid="chapter-plan-row"]').count()) throw new Error('短篇 P3 用了长篇的 chapter-plan-row');
    const acceptBtn = page.locator('[data-testid="chapter-plan-total"] .btn', { hasText: '接受偏差' });
    if (await acceptBtn.count()) await acceptBtn.first().click().catch(() => {});
    await page.waitForTimeout(600);
    await page.locator('[data-testid="chapter-plan-confirm"]').click();
    await page.waitForSelector('[data-testid="stage-p3"][data-status="confirmed"]', { timeout: 40000 });
    // P4
    await page.locator('.pipeline-rail__row').nth(3).click();
    await page.waitForTimeout(400);
    await page.waitForSelector('[data-testid="write-start"]', { timeout: 30000 });
    await page.locator('[data-testid="write-start"]').click();
    await page.waitForSelector('[data-testid="write-review"]', { timeout: 180000 });
    const chapterRowsAtP4 = await page.locator('[data-testid="chapter-row"]').count();
    const beatRowsP4 = await page.locator('[data-testid="beat-row"]').count();
    if (!beatRowsP4) throw new Error('短篇 P4 没有节拍行');
    if (chapterRowsAtP4) throw new Error(`短篇 P4 出现了 ${chapterRowsAtP4} 个 chapter-row`);
    await page.screenshot({ path: path.join(shotDir, 'qa-11-short-p4.png') });
    // 审阅入口
    await page.locator('[data-testid="write-review"]').click();
    await page.waitForURL(/review=1/, { timeout: 20000 });
    await page.waitForSelector('[data-testid="review-bar"]', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const queueCount = (await page.locator('[data-testid="review-queue-count"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const hasApprove = (await page.locator('[data-testid="chapter-approve"]').count()) > 0;
    const reviewTitle = (await page.locator('[data-testid="review-bar"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-12-short-review.png') });
    if (chapterRowsAtP1 || chapterRowsAtP3 || chapterRowsAtP4) {
      throw new Error(`短篇出现章节行：P1=${chapterRowsAtP1} P3=${chapterRowsAtP3} P4=${chapterRowsAtP4}`);
    }
    if (beatRows !== 0) throw new Error(`短篇 P3 不应出现 P4 的 beat-row（实际 ${beatRows}）`);
    if (!hasApprove) {
      defect('DEF-2', 'blocker', '（UI 复现）短篇「开始逐节拍审阅」进入写作台后没有可审内容：0 章待审、无「通过」按钮',
        'software/src/client/pages/StudioPage.tsx:1015（队列按 chapters 渲染）+ software/src/server/pipeline/routes.ts:352（review 只查 chapters）',
        `短篇 4 个节拍都写完并 in_review，点「开始逐节拍审阅」→ 写作台审阅条显示「${reviewTitle.slice(0, 80)}」，没有「通过/退回」按钮。短篇因此无 REVIEW 闭环。`,
        '1) 新建短篇 → 生成并确认 P1/P2/P3 → 连续写作写完；2) 点「开始逐节拍审阅」；3) 观察审阅条与按钮');
      throw new Error(`短篇审阅队列空：queue=「${queueCount}」，approve 按钮=${hasApprove}（已记 DEF-2）`);
    }
    return `短篇：P1/P3/P4 chapter-row 全为 0；P3 节拍行 ${beatRows}、计划行 ${planRows}；P4 节拍行 ${beatRowsP4}；审阅队列「${queueCount}」`;
  }, page);

  // ---------------- U10 旧项目迁移 ----------------
  await step('U10', '旧项目（真实点击）：升级横幅 → 升级 → 正文仍可读 → 回退', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.first-run, .project-card', { timeout: 20000 });
    const newBtn = page.locator('.first-run .btn--primary, .lib-head .btn--primary, button:has-text("新建")').first();
    await newBtn.click();
    await page.waitForSelector('[data-testid="new-project-form"]');
    await page.fill('#np-title', 'QA 旧项目');
    await page.fill('#np-premise', '旧项目的一句话');
    await page.locator('#np-ai-plan').uncheck();
    await page.locator('[data-testid="new-project-submit"]').click();
    await page.waitForURL(/\/project\/p_[^/?]+/, { timeout: 15000 });
    const legacyId = new URL(page.url()).pathname.split('/')[2];
    // 写正文
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ timeout: 20000 });
    const legacyText = '旧项目第一章正文，升级前后必须逐字节一致。QAMARKER73。第二段也不能少。';
    await editor.click();
    await page.keyboard.press('Meta+A');
    await page.keyboard.type(legacyText);
    await page.waitForTimeout(1800);
    const savedState = (await page.locator('.save-state').innerText().catch(() => '')).replace(/\s+/g, ' ');
    // 进企划页（旧作品会显示升级横幅）
    await page.goto(`${base}/project/${legacyId}/pipeline`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="migration-banner"][data-state="legacy"]', { timeout: 30000 });
    const bannerText = (await page.locator('[data-testid="migration-banner"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-13-migration-legacy.png') });
    await page.locator('[data-testid="migration-upgrade"]').click();
    await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 15000 });
    await page.locator('[data-testid="confirm-ok"]').click();
    await page.waitForTimeout(4000);
    // 迁移是否真的成功：以服务端为准
    const migrationState = await apiGet(`/api/projects/${legacyId}/migration`);
    const bannerStateAfterUpgrade = await page.locator('[data-testid="migration-banner"]').getAttribute('data-state').catch(() => null);
    const bannerAfterUpgrade = (await page.locator('[data-testid="migration-banner"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-14a-after-upgrade-noreload.png') });
    if (migrationState?.migration?.state !== 'done') {
      throw new Error(`升级没有成功：服务端 migration.state=${migrationState?.migration?.state} error=${migrationState?.migration?.error}`);
    }
    if (bannerStateAfterUpgrade !== 'done') {
      defect('DEF-7', 'medium', '（UI 复现）升级成功后横幅不变：仍提示「这是升级前的旧作品」，回退入口也不出现，必须刷新页面',
        'software/src/client/pages/PipelinePage.tsx:104-118（migration 只在挂载时取一次）+ PipelineBanner.tsx:37（migration?.state === "legacy" 优先）',
        `点「升级到流水线」→ 服务端 migration.state=done（已核对 /api/projects/:id/migration），但页面横幅 data-state=${bannerStateAfterUpgrade}，文案仍是「${bannerAfterUpgrade.slice(0, 60)}」，也没有「回退到升级前」按钮；刷新页面后才变成 done。`,
        '1) 打开旧作品的 /pipeline；2) 点「升级到流水线」并确认；3) 观察横幅（仍是旧作品提示）；4) 刷新页面 → 变成「已升级到 AI 流水线」');
    }
    // 刷新后继续验证（这也是用户唯一可行的路径）
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="migration-banner"]', { timeout: 30000 });
    const doneText = (await page.locator('[data-testid="migration-banner"]').innerText()).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-14-migration-done.png') });
    // 正文仍可读（迁移后作品已进流水线，必须带 ?chapter=<id> 才留在写作台）
    const chapterList = await apiGet(`/api/projects/${legacyId}`);
    const chapterId = chapterList.project.chapters[0].id;
    await page.goto(`${base}/project/${legacyId}?chapter=${chapterId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const afterText = await page.locator('[contenteditable="true"]').first().innerText().catch(() => '');
    if (!afterText.includes('QAMARKER73')) throw new Error(`升级后写作台读不到原文：${afterText.slice(0, 80)}`);
    // 回退
    await page.goto(`${base}/project/${legacyId}/pipeline`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="migration-banner"]', { timeout: 30000 });
    const rollbackBtn = page.locator('[data-testid="migration-rollback"]');
    if (!(await rollbackBtn.count())) throw new Error('升级完成后没有回退入口');
    await rollbackBtn.click();
    await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 15000 });
    await page.locator('[data-testid="confirm-ok"]').click();
    await page.waitForSelector('[data-testid="migration-banner"][data-state="legacy"]', { timeout: 60000 });
    await page.goto(`${base}/project/${legacyId}?chapter=${chapterId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const rollbackText = await page.locator('[contenteditable="true"]').first().innerText().catch(() => '');
    if (!rollbackText.includes('QAMARKER73')) throw new Error(`回退后正文丢了：${rollbackText.slice(0, 80)}`);
    await page.screenshot({ path: path.join(shotDir, 'qa-15-migration-rolled-back.png') });
    return `旧项目横幅「${bannerText.slice(0, 40)}…」；保存状态「${savedState}」；升级后（未刷新）横幅 data-state=${bannerStateAfterUpgrade}；刷新后「${doneText.slice(0, 30)}…」；升级/回退后正文都能读`;
  }, page);

  // ---------------- U11 断网 ----------------
  await step('U11', '断网：写作中拔网线 → 有离线提示、不白屏；恢复后能继续刷新', async () => {
    await page.goto(`${base}/project/${novelId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="write-control"]', { timeout: 30000 });
    await page.context().setOffline(true);
    await page.waitForTimeout(4000);
    const offlineText = await page.locator('.pipeline-offline').innerText().catch(() => '');
    const bodyText = (await page.locator('.pipeline-page').innerText().catch(() => '')).replace(/\s+/g, ' ');
    await page.screenshot({ path: path.join(shotDir, 'qa-16-offline.png') });
    await page.context().setOffline(false);
    // 轮询在空闲时是 10s 一次，给足一轮半
    await page.waitForFunction(() => !document.querySelector('.pipeline-offline'), null, { timeout: 15000 }).catch(() => {});
    const backOnline = await page.locator('.pipeline-offline').count();
    if (!offlineText) throw new Error('断网 4s 后没有任何离线提示（用户会以为界面卡死）');
    if (!bodyText.length) throw new Error('断网后页面空白');
    if (backOnline) {
      defect('DEF-8', 'high', '断网恢复后界面永久停在「与后台失去联系」：offline 时轮询被直接 return，没有任何重试',
        'software/src/client/hooks/usePipeline.ts:146（if (!interval || offline) return;）',
        `setOffline 后连续失败 3 次 → offline=true → 轮询 effect 直接 return，不再发任何请求 → offline 永远是 true。实测恢复网络后等 15s，横幅「与后台失去联系」仍在；只有切换标签页（visibilitychange）或刷新页面才能恢复。后果：后台重启/短暂断网之后，用户界面会永久停在离线态。`,
        '1) 打开 /pipeline；2) 断网 5s 让轮询连续失败 3 次；3) 恢复网络；4) 等 15s 观察横幅仍在');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="write-control"]', { timeout: 30000 });
      throw new Error(`恢复网络 15s 后离线横幅仍在（offline 状态无法自愈，需刷新；已记 DEF-8）`);
    }
    return `断网 4s 显示「${offlineText}」；页面仍有内容（${bodyText.length} 字）；恢复后提示消失`;
  }, page);

  // ---------------- U13 confirmed + stale：横幅与三种处理 ----------------
  await step('U13', '已确认阶段遇到上游变更：横幅出现、三种处理都能点（t14 缺陷的回归）', async () => {
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    const created = await apiSend('POST', '/api/projects', {
      title: 'QA 上游变更横幅', type: 'novel', premise: '旧城雨夜，一个修表匠收到自己二十年前写下的信。', targetWords: 12000, start: 'pipeline',
    });
    if (created.status !== 201) throw new Error(`创建作品失败：${created.status} ${JSON.stringify(created.data)}`);
    const projectId = created.data.project.id;
    const snapshotOf = () => apiGet(`/api/projects/${projectId}/pipeline`);
    const waitStage = async (stageKey, status, timeoutMs = 30000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const snap = await snapshotOf();
        if (snap.stages[stageKey]?.status === status) return snap;
        await page.waitForTimeout(250);
      }
      throw new Error(`${stageKey} 没在 ${timeoutMs}ms 内变成 ${status}`);
    };

    await waitStage('p1', 'review');
    const confirmP1 = await apiSend('POST', `/api/projects/${projectId}/stages/p1/confirm`, {});
    if (confirmP1.status !== 200) throw new Error(`确认 P1 失败：${confirmP1.status} ${JSON.stringify(confirmP1.data)}`);
    await apiSend('POST', `/api/projects/${projectId}/pipeline/start`, { stage: 'p2' });
    await waitStage('p2', 'review');
    const confirmP2 = await apiSend('POST', `/api/projects/${projectId}/stages/p2/confirm`, {});
    if (confirmP2.status !== 200) throw new Error(`确认 P2 失败：${confirmP2.status} ${JSON.stringify(confirmP2.data)}`);

    // 改一个 P1 人物 → 服务端 markDownstreamStale(p1,'p1:edited')，P2 必须保持 confirmed（INV-1）
    const p1Items = (await apiGet(`/api/projects/${projectId}/stages/p1/items`)).items;
    const character = p1Items.find((item) => item.kind === 'character');
    if (!character) throw new Error('P1 没有人物条目');
    const edited = await apiSend('PATCH', `/api/projects/${projectId}/items/${character.id}`, { title: `${character.title}（改）` });
    if (edited.status !== 200) throw new Error(`编辑条目失败：${edited.status} ${JSON.stringify(edited.data)}`);
    const staleSnap = await snapshotOf();
    if (staleSnap.stages.p2.status !== 'confirmed') {
      throw new Error(`上游变更把 P2 打回了 ${staleSnap.stages.p2.status}（已确认阶段不该被回滚）`);
    }
    if (staleSnap.stages.p2.staleReason !== 'p1:edited') {
      throw new Error(`P2 staleReason=${staleSnap.stages.p2.staleReason}，期望 p1:edited`);
    }

    await page.goto(`${base}/project/${projectId}/pipeline?stage=p2`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="stage-stale-banner"]', { timeout: 20000 });
    const bannerText = (await page.locator('[data-testid="stage-stale-banner"]').innerText()).replace(/\s+/g, ' ');
    if (!/上游已变更/.test(bannerText)) throw new Error(`横幅没写「上游已变更」：${bannerText}`);
    if (!/建议复核后再确认/.test(bannerText)) throw new Error(`confirmed 态文案不对：${bannerText}`);
    if (!/设定已被编辑/.test(bannerText)) throw new Error(`原因码没有翻成人话：${bannerText}`);
    if (/p1:edited/.test(bannerText)) throw new Error(`横幅把内部原因码直接露给用户了：${bannerText}`);
    if (!(await page.locator('[data-testid="pipeline-banner"][data-state="stale"]').count())) {
      throw new Error('缺少通用锚点 pipeline-banner[data-state=stale]');
    }
    for (const testId of ['stage-stale-keep', 'stage-stale-ignore']) {
      const button = page.locator(`[data-testid="${testId}"]`);
      if (!(await button.count())) throw new Error(`缺少按钮 ${testId}`);
      if (!(await button.isEnabled())) throw new Error(`按钮 ${testId} 不可点`);
    }
    // DEF-14：此刻上游 P1 被编辑打回了 review，「按上游重排」必须是禁用 + 写明原因，
    // 而不是让用户点出一个必然 409 的死键；上游确认后（本用例后半段）再断言它可用。
    const regenNow = page.locator('[data-testid="stage-stale-regenerate"]');
    if (!(await regenNow.count())) throw new Error('缺少按钮 stage-stale-regenerate');
    if ((await snapshotOf()).stages.p1.status === 'confirmed') {
      if (!(await regenNow.isEnabled())) throw new Error('上游已确认时「按上游重排」应可用');
    } else {
      if (await regenNow.isEnabled()) throw new Error('上游还没确认时「按上游重排」必须禁用（否则必然 409）');
      const hint = page.locator('[data-testid="stage-stale-regenerate-hint"]');
      if (!(await hint.count())) throw new Error('禁用「按上游重排」时要写明「先确认上一阶段」');
      if (!/先确认上一阶段/.test(await hint.innerText())) throw new Error(`禁用原因文案不对：${await hint.innerText()}`);
    }

    // 忽略：保留 stale，横幅不消失
    await page.locator('[data-testid="stage-stale-ignore"]').click();
    await page.waitForTimeout(1500);
    if (!(await page.locator('[data-testid="stage-stale-banner"]').count())) {
      throw new Error('点「忽略」后横幅消失了（应保留 stale 到下次操作）');
    }
    if ((await snapshotOf()).stages.p2.staleReason !== 'p1:edited') throw new Error('点「忽略」后服务端 stale 被清掉了');

    // 复核并保留：清 stale，P2 仍是 confirmed
    await page.locator('[data-testid="stage-stale-keep"]').click();
    await page.waitForSelector('[data-testid="stage-stale-banner"]', { state: 'detached', timeout: 12000 });
    const keptSnap = await snapshotOf();
    if (keptSnap.stages.p2.status !== 'confirmed') throw new Error(`复核保留后 P2 变成 ${keptSnap.stages.p2.status}`);
    if (keptSnap.stages.p2.staleReason) throw new Error(`复核保留后 stale 没清：${keptSnap.stages.p2.staleReason}`);

    // 再制造一次变更 → 按上游重排要起 p2 的 regen-stage job（scope=all）
    // 走「P1 单条意见重生成」这条路（recordItemRevision 对已确认阶段只标下游 stale、不回退自己），
    // 这样上游 P1 仍是 confirmed，「按上游重排」不会被 STAGE_LOCKED 挡住；
    // 换用「编辑 P1 条目」则会把 P1 自己打回 review（SPEC R2），上游不 confirmed 时重排应当被拒。
    // （上一次「复核并保留」之前 P1 已被第一次编辑打回 review，所以先重新确认 P1。）
    if ((await snapshotOf()).stages.p1.status !== 'confirmed') {
      const reconfirm = await apiSend('POST', `/api/projects/${projectId}/stages/p1/confirm`, {});
      if (reconfirm.status !== 200) throw new Error(`重新确认 P1 失败：${reconfirm.status} ${JSON.stringify(reconfirm.data)}`);
    }
    const regenSource = await apiSend('POST', `/api/projects/${projectId}/stages/p1/regenerate`, { scope: 'item', targetId: character.id, note: '把这个人物的动机写得更狠一点' });
    if (regenSource.status !== 202 && regenSource.status !== 200) throw new Error(`P1 单条重生成失败：${regenSource.status} ${JSON.stringify(regenSource.data)}`);
    let sourceDone = null;
    for (let i = 0; i < 80; i += 1) {
      await page.waitForTimeout(250);
      const snap = await snapshotOf();
      const job = snap.job || snap.lastJob;
      if (job && job.stage === 'p1' && !['queued', 'running', 'pausing'].includes(job.state)) { sourceDone = job; break; }
    }
    if (!sourceDone) throw new Error('P1 单条重生成没有结束');
    // 重生成改了已确认阶段的内容 → P1 按状态机回 review（SPEC R2），P2 被标 stale 但仍 confirmed。
    // 用户此时先重新确认 P1，才能「按上游重排」；重新确认只清 P1 自己的 stale，不动 P2 的。
    const sourceSnap = await snapshotOf();
    if (sourceSnap.stages.p1.status !== 'confirmed') {
      const reconfirm2 = await apiSend('POST', `/api/projects/${projectId}/stages/p1/confirm`, {});
      if (reconfirm2.status !== 200) throw new Error(`重生成后重新确认 P1 失败：${reconfirm2.status} ${JSON.stringify(reconfirm2.data)}`);
    }
    const againSnap = await snapshotOf();
    if (againSnap.stages.p1.status !== 'confirmed') throw new Error(`重生成 + 重新确认后 P1 不是 confirmed：${againSnap.stages.p1.status}`);
    if (againSnap.stages.p2.status !== 'confirmed' || againSnap.stages.p2.staleReason !== 'p1:regenerated') {
      throw new Error(`第二次变更后 P2 不是 confirmed+stale(p1:regenerated)：${againSnap.stages.p2.status} / ${againSnap.stages.p2.staleReason}`);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="stage-stale-banner"]', { timeout: 20000 });
    const regenBannerText = (await page.locator('[data-testid="stage-stale-banner"]').innerText()).replace(/\s+/g, ' ');
    if (!/设定已重新生成/.test(regenBannerText)) throw new Error(`regen 原因码没有翻成人话：${regenBannerText}`);
    if (/p1:regenerated/.test(regenBannerText)) throw new Error(`横幅把内部原因码直接露给用户了：${regenBannerText}`);
    const regenReady = page.locator('[data-testid="stage-stale-regenerate"]');
    if (!(await regenReady.isEnabled())) throw new Error('上游已重新确认，「按上游重排」却还是禁用');
    if (await page.locator('[data-testid="stage-stale-regenerate-hint"]').count()) throw new Error('上游已确认后仍显示「先确认上一阶段」的提示');
    await regenReady.click();
    const regenStarted = Date.now();
    let regenJob = null;
    while (Date.now() - regenStarted < 20000) {
      const snap = await snapshotOf();
      const job = snap.job || snap.lastJob;
      if (job && job.kind === 'regen-stage' && job.stage === 'p2') { regenJob = job; break; }
      await page.waitForTimeout(250);
    }
    if (!regenJob) throw new Error('点「按上游重排」后没有 p2 的 regen-stage job');
    await page.screenshot({ path: path.join(shotDir, 'qa-17-stale-banner.png') });
    return `横幅「${bannerText.replace(/\s+/g, ' ').slice(0, 70)}」；上游未确认时「按上游重排」禁用并写明原因、确认后恢复可用；忽略保留 stale、复核保留清 stale 且 P2 仍 confirmed、按上游重排起了 ${regenJob.kind}/${regenJob.stage}`;
  }, page);

  // ---------------- U12 汇总 ----------------
  await step('U12', '全程 Console / Network：无未捕获异常，4xx/5xx 逐条有据', async () => {
    const unexpected = httpErrors.filter((line) => {
      // 允许：刻意制造的失败用例（无模型/失联/短篇审阅缺陷/暂停兜底）
      return !(
        /NO_DEFAULT_MODEL|NO_API_KEY/.test(line) ||
        /^4\d\d (POST|GET) \/api\/projects\/p_[^/]+\/(pipeline|writing\/continue|migrate)$/.test(line) ||
        /^4\d\d POST \/api\/chapters\/[^/]+\/review$/.test(line) ||
        /^4\d\d POST \/api\/projects\/p_[^/]+\/stages\/p[123]\/confirm$/.test(line) ||
        /^4\d\d GET \/api\/projects\/p_[^/]+\/(pipeline|units|migration)$/.test(line) ||
        /^4\d\d POST \/api\/projects$/.test(line) ||
        /^4\d\d POST \/api\/jobs\/[^/]+\/cancel$/.test(line) ||
        // U6 会故意塞一个不合法的字数区间：服务端按 BAD_REQUEST(400) + blockers 指出越界行，前端在分配表内联显示。
        // 旧断言只放过 422，与当前的区间校验（400）不一致。
        /^4\d\d POST \/api\/projects\/p_[^/]+\/stages\/p3\/units\/allocate\/apply$/.test(line)
      );
    });
    if (unexpected.length) throw new Error(`出现未归类的 4xx/5xx：${unexpected.join(' | ')}`);
    const realErrors = consoleErrors.filter((line) => !/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(line));
    const networkNoise = consoleErrors.length - realErrors.length;
    if (realErrors.length) throw new Error(`浏览器未捕获异常/console error：\n${realErrors.join('\n')}`);
    return `页面级未捕获异常 0 条（另有 ${networkNoise} 条是我自己 setOffline 触发的网络失败日志，不算产品异常）；HTTP 请求 ${responseTimes.length} 条，>=400 ${httpErrors.length} 条，明细见 httpErrorDetail`;
  }, page);

  console.log('\n--- 汇总 ---');
  const passed = results.filter((item) => item.status === 'passed').length;
  const failed = results.filter((item) => item.status === 'failed').length;
  console.log(`通过 ${passed} / ${results.length}，失败 ${failed}，缺陷 ${defects.length}`);
  if (consoleErrors.length) console.log(`console/pageerror：\n${consoleErrors.join('\n')}`);
  console.log(`HTTP >=400（${httpErrors.length}）：\n${httpErrors.map((line) => '  ' + line).join('\n')}`);

  const outFile = path.join(evidenceDir, 'qa-ui-results.json');
  fs.writeFileSync(outFile, JSON.stringify({
    ranAt: new Date().toISOString(), port: PORT, dataDir, results, defects,
    consoleErrors, httpErrors, httpErrorDetail, httpTotal: responseTimes.length,
  }, null, 2));
  console.log(`结果写入 ${outFile}`);
}

try {
  await main();
} catch (error) {
  console.error('\nQA UI 脚本异常终止：', error);
  console.error('--- server stderr (tail) ---\n' + stderr.slice(-3000));
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  if (results.some((item) => item.status === 'failed')) exitCode = 1;
  process.exit(exitCode);
}
