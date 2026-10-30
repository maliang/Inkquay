import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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
let stdout = '';
let stderr = '';
// 起服务抽成函数：进程被杀后要能原样重启同一个 dataDir（验证 interrupted → 断点继续）
function startServer() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { stdout += String(d); });
  child.stderr.on('data', (d) => { stderr += String(d); });
  return child;
}
let server = startServer();

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
  // 浏览器把「接口返回 4xx」也记成 console error（Failed to load resource）。本套件里有
  // 故意制造失败的分支（无模型拦截、供应商失联、继续写作的兜底重试），所以这类网络日志
  // 单独收集成 httpErrors，最后按「允许的失败请求清单」逐条核对；其它 console error 仍判红。
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() !== 'error') return;
    if (/Failed to load resource: the server responded with a status of \d+/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  const httpErrors = [];
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    httpErrors.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
  });
  const deleteRequests = [];
  page.on('request', (req) => { if (req.method() === 'DELETE') deleteRequests.push(req.url()); });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.onboarding');
  assert.equal(await page.locator('.lib-head').count(), 0, 'main UI is gated before onboarding');
  assert.ok(await page.locator('.onboarding-card__foot .btn--primary').isDisabled());
  await page.locator('.onboarding-form input').nth(0).fill('E2E作者');
  await page.locator('.onboarding-form input').nth(1).fill('E2E签名');
  await page.locator('.onboarding-card__foot .btn--primary').click();
  await page.locator('.onboarding-provider', { hasText: 'DeepSeek' }).click();
  assert.equal(await page.locator('.onboarding-discover .btn').count(), 1, 'onboarding exposes model discovery');
  assert.equal(await page.locator('.onboarding-form select').count(), 2, 'onboarding exposes model + reasoning selects');
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


  // ==================== AI 流水线（AI-first 五阶段工作台） ====================
  const setDefaultModel = (model) => page.evaluate(async (next) => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: next }),
    });
  }, model);

  const createProvider = (name, baseUrl, modelId) => page.evaluate(async ({ name, baseUrl, modelId }) => {
    const res = await fetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        kind: 'openai',
        baseUrl,
        apiKey: 'sk-e2e-fake',
        models: [{ id: modelId, name: modelId, ctx: '8k', tags: ['OpenAI 兼容'] }],
        enabledModels: [modelId],
      }),
    });
    const data = await res.json();
    const id = data.provider.id;
    // 带 Key 的供应商创建后即启用；这里再显式启用一次，确保 precheck 不会因 enabled=0 失败
    // （服务端只有 PATCH，用 PUT 会 404 并让 enabled 保持 0）。
    await fetch(`/api/providers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    return id;
  }, { name, baseUrl, modelId });

  const projectCount = () => page.evaluate(async () => (await (await fetch('/api/projects')).json()).projects.length);

  // ---- S5 两级前置拦截：没有默认模型时不创建作品、不落空壳 ----
  await setDefaultModel(null);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.first-run');
  await page.locator('.first-run .btn--primary').click();
  await page.waitForSelector('[data-testid="new-project-form"]');
  await page.waitForSelector('[data-testid="new-project-precheck"][data-code="NO_DEFAULT_MODEL"]', { timeout: 10000 });
  assert.ok((await page.locator('[data-testid="new-project-precheck"]').innerText()).includes('还不能让 AI 企划'));
  await page.fill('#np-title', '不该被创建的作品');
  await page.locator('[data-testid="new-project-submit"]').click();
  await page.waitForSelector('[data-testid="new-project-error"][data-code="NO_DEFAULT_MODEL"]', { timeout: 10000 });
  assert.equal(await projectCount(), 0, '前置拦截不通过时不得创建空壳作品');
  assert.ok((await page.locator('[data-testid="new-project-error"]').innerText()).includes('不会留下空壳'));
  await page.locator('.modal__head .icon-btn').click();
  await page.waitForSelector('[data-testid="new-project-form"]', { state: 'detached' });
  console.log('PASS pipeline precheck blocks creation without model');

  // ---- 慢供应商：企划有进度、可取消、取消后可删除作品（不留孤儿） ----
  const slowServer = http.createServer((req, res) => {
    if (req.url && req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'slow-model', object: 'model' }] }));
      return;
    }
    // /chat/completions 永不回包：模拟「模型很慢」的等待期
  });
  await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
  const slowBase = `http://127.0.0.1:${slowServer.address().port}/v1`;
  const slowProviderId = await createProvider('慢供应商', slowBase, 'slow-model');
  await setDefaultModel({ providerId: slowProviderId, modelId: 'slow-model' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.first-run');

  await page.locator('.first-run .btn--primary').click();
  await page.waitForSelector('[data-testid="new-project-form"]');
  await page.fill('#np-title', 'AI 流水线·慢企划');
  await page.fill('#np-premise', '一个在雨夜收到未来来信的人。');
  await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 10000 });
  const slowCreateAt = Date.now();
  await page.locator('[data-testid="new-project-submit"]').click();
  await page.waitForURL(/\/pipeline/, { timeout: 8000 });
  assert.ok(Date.now() - slowCreateAt < 5000, '创建后必须立刻进入企划页，不能等整份企划');
  await page.waitForSelector('[data-testid="plan-progress"][data-state="running"]', { timeout: 10000 });
  const elapsedFirst = Number(await page.locator('[data-testid="plan-progress"]').getAttribute('data-elapsed'));
  await page.waitForTimeout(2400);
  const elapsedSecond = Number(await page.locator('[data-testid="plan-progress"]').getAttribute('data-elapsed'));
  assert.ok(elapsedSecond > elapsedFirst, `等待期必须持续显示进度秒数（${elapsedFirst} → ${elapsedSecond}）`);
  assert.ok(await page.locator('[data-testid="stage-p1"]').isVisible(), '左栏阶段轨道要一直在');
  await page.screenshot({ path: 'screenshots/98-pipeline-running.png' });

  await page.locator('[data-testid="plan-cancel"]').click();
  await page.waitForSelector('[data-testid="stage-p1"][data-status="empty"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="plan-delete"]', { timeout: 15000 });
  await page.locator('[data-testid="plan-delete"]').click();
  await page.locator('[data-testid="confirm-ok"]').click();
  await page.waitForURL(base + '/', { timeout: 10000 });
  assert.equal(await projectCount(), 0, '取消后删除作品，不留下孤儿项目');
  await slowServer.close();
  console.log('PASS pipeline cancel keeps progress visible and leaves no orphan');

  // ---- 失联供应商：失败要有人话错误 + 重试入口 ----
  const deadPort = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port;
      probe.close(() => resolve(value));
    });
  });
  const deadProviderId = await createProvider('失联供应商', `http://127.0.0.1:${deadPort}/v1`, 'dead-model');
  await setDefaultModel({ providerId: deadProviderId, modelId: 'dead-model' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.first-run');
  await page.locator('.first-run .btn--primary').click();
  await page.waitForSelector('[data-testid="new-project-form"]');
  await page.fill('#np-title', 'AI 流水线·失联');
  await page.locator('[data-testid="new-project-submit"]').click();
  await page.waitForURL(/\/pipeline/, { timeout: 8000 });
  const planError = page.locator('[data-testid="plan-error"]').first();
  await planError.waitFor({ timeout: 30000 });
  const errorCode = await planError.getAttribute('data-code');
  assert.ok(errorCode && errorCode !== 'EMPTY', '失败要有结构化错误码');
  const errorText = await planError.innerText();
  assert.ok(!/The operation was aborted|502 /.test(errorText), `错误卡不能把底层报文当主文案：${errorText}`);
  assert.ok(await page.locator('[data-testid="plan-retry"]').isVisible(), '失败要能重试');
  await page.screenshot({ path: 'screenshots/97-pipeline-error.png' });
  await page.locator('[data-testid="plan-delete"]').click();
  await page.locator('[data-testid="confirm-ok"]').click();
  await page.waitForURL(base + '/', { timeout: 10000 });
  assert.equal(await projectCount(), 0, '失败作品删除后不留空壳');
  console.log(`PASS pipeline failure shows readable error (${errorCode}) with retry`);

  // ---- 长篇黄金路径：设定 → 大纲 → 章节计划 → 逐章写作（mock 供应商） ----
  await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.first-run');
  await page.locator('.first-run .btn--primary').click();
  await page.waitForSelector('[data-testid="new-project-form"]');
  await page.fill('#np-title', 'AI 流水线·长篇');
  await page.fill('#np-premise', '一个替人写遗书的代笔人，收到了一封写给自己的遗书。');
  await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 10000 });
  await page.locator('[data-testid="new-project-submit"]').click();
  await page.waitForURL(/\/pipeline/, { timeout: 8000 });
  const pipelineProjectId = new URL(page.url()).pathname.split('/')[2];
  assert.ok(pipelineProjectId.startsWith('p_'));

  await page.waitForSelector('[data-testid="stage-p1"][data-status="review"]', { timeout: 30000 });
  const railTitles = await page.locator('.pipeline-rail__title').evaluateAll((nodes) => nodes.map((node) => (node.firstChild?.textContent || '').trim()));
  assert.deepEqual(railTitles.slice(0, 4), ['设定', '故事大纲', '章节计划', '逐章写作'], `阶段导航文案：${railTitles.join('|')}`);
  assert.ok((await page.locator('[data-testid="stage-p1"]').innerText()).includes('待确认'));

  const openStage = async (index) => {
    await page.locator('.pipeline-rail__row').nth(index).click();
    await page.waitForTimeout(400);
    const trigger = page.locator('[data-testid="stage-generate"]');
    if (await trigger.count()) {
      await trigger.click();
      await page.waitForTimeout(400);
    }
  };

  // P1 分块编辑：改一个角色 + 保留修改历史
  const characterCard = page.locator('[data-testid="item-card"][data-kind="character"]').first();
  await characterCard.locator('[data-testid="item-edit"]').click();
  const motivation = characterCard.locator('.pipeline-item__fields textarea').first();
  const beforeMotivation = await motivation.inputValue();
  await motivation.fill(`${beforeMotivation || '想要活下去'}（E2E 手工补充：怕雨声）`);
  await characterCard.locator('[data-testid="item-edit-save"]').click();
  await page.waitForSelector('[data-testid="item-card"][data-kind="character"] [data-testid="item-edit"]', { timeout: 15000 });
  await characterCard.locator('[data-testid="item-edit"]').click();
  const reopenedMotivation = characterCard.locator('.pipeline-item__fields textarea').first();
  assert.ok((await reopenedMotivation.inputValue()).includes('怕雨声'), '条目卡保存后要把改后的内容存下来并回显');
  await characterCard.locator('[data-testid="item-edit-cancel"]').click();
  await page.waitForTimeout(300);
  await characterCard.locator('[data-testid="item-history"]').click();
  await page.waitForSelector('[data-testid="item-history-drawer"]');
  await page.waitForSelector('.pipeline-history__row', { timeout: 15000 });
  const historyRows = await page.locator('.pipeline-history__row').count();
  assert.ok(historyRows >= 2, `手工编辑要留修订历史（当前 ${historyRows} 条）`);
  await page.locator('[data-testid="item-history-drawer"] .pipeline-drawer__head .btn').click();
  await page.waitForSelector('[data-testid="item-history-drawer"]', { state: 'detached' });

  // P1 向 AI 提意见（条目级）→ 生成任务 → 完成后历史再 +1
  const secondCharacter = page.locator('[data-testid="item-card"][data-kind="character"]').nth(1);
  const secondCharacterId = await secondCharacter.getAttribute('data-id');
  await secondCharacter.locator('[data-testid="item-feedback"]').click();
  await page.waitForSelector('[data-testid="stage-feedback-drawer"]');
  await page.locator('[data-testid="stage-feedback-drawer"] textarea').fill('把这个人物的动机写得更自私一点，和主角形成对立。');
  await page.locator('[data-testid="stage-feedback-submit"]').click();
  await page.waitForSelector('[data-testid="stage-feedback-drawer"]', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('[data-testid="plan-progress"]', { state: 'detached', timeout: 60000 });
  const feedbackRow = page.locator(`[data-testid="item-card"][data-id="${secondCharacterId}"]`).first();
  await feedbackRow.locator('[data-testid="item-history"]').click();
  await page.waitForSelector('[data-testid="item-history-drawer"]');
  await page.waitForFunction(() => document.querySelectorAll('.pipeline-history__row').length >= 2, null, { timeout: 20000 });
  await page.locator('[data-testid="item-history-drawer"] .pipeline-drawer__head .btn').click();
  await page.waitForSelector('[data-testid="item-history-drawer"]', { state: 'detached' });
  console.log('PASS pipeline P1 edit + feedback keeps revision history');

  // 确认设定 → 大纲 → 章节计划
  await page.locator('[data-testid="stage-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p1"][data-status="confirmed"]', { timeout: 20000 });
  await openStage(1);
  await page.waitForSelector('[data-testid="stage-p2"][data-status="review"]', { timeout: 60000 });
  assert.ok((await page.locator('[data-testid="item-card"][data-kind="act"]').count()) >= 2, '大纲要按幕/节拍组分块');
  await page.locator('[data-testid="stage-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p2"][data-status="confirmed"]', { timeout: 20000 });

  await openStage(2);
  await page.waitForSelector('[data-testid="chapter-plan-row"]', { timeout: 90000 });
  const planRows = await page.locator('[data-testid="chapter-plan-row"]').count();
  assert.ok(planRows >= 3, `章节计划至少 3 行（当前 ${planRows}）`);
  const firstPlanId = await page.locator('[data-testid="chapter-plan-row"]').first().getAttribute('data-id');
  await page.locator('[data-testid="chapter-plan-row"]').first().locator('[data-testid="unit-move-down"]').click();
  await page.waitForFunction(
    (id) => document.querySelector('[data-testid="chapter-plan-row"]')?.getAttribute('data-id') !== id,
    firstPlanId,
    { timeout: 15000 },
  );
  console.log('PASS chapter plan rows can be reordered');

  await page.fill('[data-testid="chapter-plan-count"]', '5');
  await page.locator('[data-testid="chapter-plan-count-preview-button"]').click();
  await page.waitForSelector('[data-testid="chapter-plan-count-preview"]', { timeout: 10000 });
  await page.locator('[data-testid="chapter-plan-count-apply"]').click();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('[data-testid="chapter-plan-row"]').count(), 5, '章节数可按输入调整');

  const secondRow = page.locator('[data-testid="chapter-plan-row"]').nth(1);
  const rowMin = Number(await secondRow.getAttribute('data-words-min'));
  const editedTarget = String(rowMin || 2500);
  const targetInput = secondRow.locator('.pipeline-words input').nth(1);
  await targetInput.fill(editedTarget);
  await targetInput.blur();
  await page.waitForFunction(
    (value) => document.querySelectorAll('[data-testid="chapter-plan-row"]')[1]?.getAttribute('data-words-target') === value,
    editedTarget,
    { timeout: 15000 },
  );
  assert.equal(await page.locator('[data-testid="chapter-plan-row"]').nth(1).getAttribute('data-words-target'), editedTarget, '每章目标字数可改');
  assert.ok((await page.locator('[data-testid="chapter-plan-total"]').innerText()).includes('偏差'), '合计条要显示总字数与偏差');

  await page.locator('[data-testid="chapter-plan-preset"][data-preset="fast"]').click();
  await page.waitForSelector('[data-testid="chapter-plan-preset"][data-preset="fast"]', { timeout: 10000 });
  await page.waitForTimeout(2500);
  const presetTargets = await page.locator('[data-testid="chapter-plan-row"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-words-target')));
  assert.ok(presetTargets.filter((value) => value === '2000').length >= 4, `三档预设要批量改未锁定行：${presetTargets.join(',')}`);
  await page.locator('[data-testid="chapter-plan-total"] .btn', { hasText: '接受偏差' }).click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('[data-testid="chapter-plan-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p3"][data-status="confirmed"]', { timeout: 20000 });
  assert.ok(await page.locator('[data-testid="write-start"]').isVisible(), '章节计划确认后才出现开始写作');
  console.log('PASS pipeline P2 + P3 plan editing (count / words / preset / total)');

  // P4 逐章写作：切到「慢写作」供应商，让连续写作的进度/暂停真的可观察
  const prose = Array.from({ length: 40 }, () => '雨点砸在铁皮棚顶上，声音像有人在数钱。林昭把伞收起来，抖了抖水，抬头看见那盏一直没换过的灯。').join('\n\n');
  const writeServer = http.createServer((req, res) => {
    if (req.url && req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'slow-writer', object: 'model' }] }));
      return;
    }
    if (req.url && req.url.includes('/chat/completions')) {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-e2e',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: prose }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 800, total_tokens: 810 },
        }));
      }, 2500);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => writeServer.listen(0, '127.0.0.1', resolve));
  const writeProviderId = await createProvider('慢写作供应商', `http://127.0.0.1:${writeServer.address().port}/v1`, 'slow-writer');
  await setDefaultModel({ providerId: writeProviderId, modelId: 'slow-writer' });
  await page.goto(`${base}/project/${pipelineProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="write-start"]', { timeout: 20000 });

  await page.locator('[data-testid="write-start"]').click();
  await page.waitForSelector('[data-testid="write-control"][data-state="running"]', { timeout: 30000 });
  assert.ok(await page.locator('[data-testid="write-pause"]').isVisible(), '写作中要能暂停');
  await page.waitForSelector('[data-testid="chapter-row"][data-status="generating"]', { timeout: 20000 });
  await page.screenshot({ path: 'screenshots/96-pipeline-writing.png' });
  await page.locator('[data-testid="write-pause"]').click();
  await page.waitForSelector('[data-testid="write-continue"]', { timeout: 40000 });
  await page.screenshot({ path: 'screenshots/95-pipeline-paused.png' });
  await page.locator('[data-testid="write-continue"]').click();
  await page.waitForSelector('[data-testid="write-control"][data-state="running"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="write-review"]', { timeout: 180000 });
  await page.waitForSelector('[data-testid="chapter-row"][data-status="in_review"]', { timeout: 30000 });
  const chapterRows = await page.locator('[data-testid="chapter-row"]').count();
  assert.equal(chapterRows, 5, '章节板按计划列出全部章节');
  assert.equal(await page.locator('[data-testid="beat-row"]').count(), 0, '长篇不出现节拍行');
  await page.locator('[data-testid="write-review"]').click();
  await page.waitForURL(/review=1/, { timeout: 20000 });
  await page.waitForSelector('[data-testid="chapter-approve"]');
  assert.ok(await page.locator('[data-testid="chapter-request-changes"]').isVisible());
  assert.ok(await page.locator('[data-testid="chapter-version-list"]').isVisible());
  const reviewCount = await page.locator('[data-testid="review-queue-count"]').innerText();
  assert.ok(/\d+ 章待审/.test(reviewCount), `审阅队列计数：${reviewCount}`);
  await page.locator('[data-testid="chapter-approve"]').click();
  await page.waitForTimeout(1200);
  const approvedRows = await page.evaluate(async (pid) => {
    const data = await (await fetch(`/api/projects/${pid}/units`)).json();
    return data.units.filter((unit) => unit.reviewStatus === 'approved').length;
  }, pipelineProjectId);
  assert.ok(approvedRows >= 1, '写作台通过后章节状态要落库');
  await page.locator('[data-testid="chapter-version-list"]').click();
  await page.waitForSelector('.trash-modal, .modal[aria-label="章节版本"]', { timeout: 10000 });
  await page.locator('.modal[aria-label="章节版本"] .btn--ghost').last().click();
  console.log('PASS pipeline P4 continuous writing + pause/continue + review in writing desk');

  writeServer.close();

  // 刷新后阶段与内容不丢
  await page.goto(`${base}/project/${pipelineProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="chapter-row"]', { timeout: 20000 });
  assert.equal(await page.locator('[data-testid="chapter-row"]').count(), 5, '刷新后章节计划与状态保持');
  assert.equal(await page.locator('[data-testid="stage-p3"]').getAttribute('data-status'), 'confirmed');
  console.log('PASS pipeline survives refresh');

  // ---- repair-round-2 回归（t9 U2/U3/U4/U13）：每一条都真实点击 ----
  const openStageMenu = async () => {
    const more = page.locator('.pipeline-confirm__more');
    if (await more.count()) {
      await more.click();
      await page.waitForTimeout(150);
    }
  };
  await page.goto(`${base}/project/${pipelineProjectId}/pipeline?stage=p3`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="chapter-plan-row"]', { timeout: 20000 });
  await openStageMenu();
  assert.equal(await page.locator('[data-testid="stage-skip"]').count(), 0, '章节计划阶段不显示「跳过」（服务端只允许跳 P1）');
  await openStageMenu();
  console.log('PASS repair: stage skip is p1-only');

  // U4：清空字数不是「静默无效」，要就地报错
  const firstPlanRow = page.locator('[data-testid="chapter-plan-row"]').first();
  const wordsInput = firstPlanRow.locator('.pipeline-words input').first();
  const originalMin = await firstPlanRow.getAttribute('data-words-min');
  await wordsInput.fill('');
  await wordsInput.blur();
  await page.waitForSelector('[data-testid="chapter-plan-row-error"]', { timeout: 8000 });
  assert.equal(await wordsInput.getAttribute('aria-invalid'), 'true', '清空字数要标 aria-invalid');
  assert.ok((await page.locator('[data-testid="chapter-plan-row-error"]').innerText()).includes('不能留空'));
  await wordsInput.fill(String(originalMin));
  await wordsInput.blur();
  await page.waitForTimeout(600);
  console.log('PASS repair: cleared word count reports inline instead of silently ignoring');

  // U3：排序失败要有可见提示（不是 unhandled rejection）
  await page.route('**/stages/p3/units/reorder', (route) => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'STAGE_LOCKED', message: '正在生成中，先别调整顺序' }),
  }));
  await firstPlanRow.locator('[data-testid="unit-move-down"]').click();
  await page.waitForSelector('[data-testid="chapter-plan-error"]', { timeout: 8000 });
  const reorderError = await page.locator('[data-testid="chapter-plan-error"]').innerText();
  assert.ok(/排序失败|正在生成|别调整/.test(reorderError), `排序失败要给出原因，实际：${reorderError}`);
  await page.unroute('**/stages/p3/units/reorder');
  console.log('PASS repair: reorder failure surfaces an inline error');

  // 章节计划的修订历史（阶段级）可回看：确认快照 + 每次改字数都会留痕
  await page.locator('[data-testid="stage-history"]').click();
  await page.waitForSelector('[data-testid="item-history-drawer"] .pipeline-history__row', { timeout: 15000 });
  const planHistoryRows = await page.locator('[data-testid="item-history-drawer"] .pipeline-history__row').count();
  assert.ok(planHistoryRows >= 1, `章节计划应该能回看修订历史，实际 ${planHistoryRows} 条`);
  await page.locator('[data-testid="item-history-drawer"] .pipeline-drawer__head .btn').click();
  console.log('PASS repair: chapter plan revision history is viewable');

  // U14：跨幕移动节拍在 V1 明确降级（讲清原因与替代做法，而不是假装有这个能力）
  await page.goto(`${base}/project/${pipelineProjectId}/pipeline?stage=p2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="item-card"][data-kind="beat"]', { timeout: 20000 });
  const beatMoveMenu = page.locator('[data-testid="beat-move-menu"]').first();
  assert.ok(await beatMoveMenu.count(), '多幕作品里的节拍要给出「移动到…」入口');
  await beatMoveMenu.click();
  await page.waitForSelector('[data-testid="beat-move-hint"]', { timeout: 5000 });
  const beatMoveHint = await page.locator('[data-testid="beat-move-hint"]').first().innerText();
  assert.ok(beatMoveHint.includes('还不支持跨幕移动'), `跨幕移动的降级说明：${beatMoveHint}`);
  console.log('PASS repair: cross-act beat move states the V1 limitation');

  // U13：写作台里刚打的字，点「下一篇」之前必须先落库
  await page.goto(`${base}/project/${pipelineProjectId}?review=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="review-bar"]', { timeout: 20000 });
  const reviewCountAfter = await page.locator('[data-testid="review-queue-count"]').innerText();
  assert.ok(/\d+ 章待审/.test(reviewCountAfter), `审阅队列计数：${reviewCountAfter}`);
  // 队列可能正停在最后一篇（此时「下一篇」是禁用的）：先回退一篇，保证能切走
  const reviewNext = page.locator('.pipeline-review__nav button').filter({ hasText: '下一篇' });
  if (await reviewNext.isDisabled()) {
    await page.locator('.pipeline-review__nav button').filter({ hasText: '上一篇' }).click();
    await page.waitForSelector('[data-testid="review-bar"]', { timeout: 10000 });
    await page.waitForTimeout(1200);
  }
  const reviewMark = `审阅不丢字-${Date.now()}`;
  await page.locator('.editor').click();
  await page.keyboard.press('End');
  await page.keyboard.type(reviewMark);
  // 故意不等自动保存的 debounce，立刻切下一篇
  await reviewNext.click();
  await page.waitForTimeout(1500);
  const savedContents = await page.evaluate(async (pid) => {
    const data = await (await fetch(`/api/projects/${pid}`)).json();
    return data.project.chapters.map((chapter) => chapter.content).join('\n');
  }, pipelineProjectId);
  assert.ok(savedContents.includes(reviewMark), '切到下一篇之前必须先把刚打的字保存掉');
  console.log('PASS repair: switching review unit saves the edit first');

  // U1：全部章进入终态后，nextStep 变成「导出成稿」，按钮必须真的能下载
  await page.evaluate(async (pid) => {
    const data = await (await fetch(`/api/projects/${pid}/units`)).json();
    for (const unit of data.units) {
      if (['approved', 'approved_manual', 'skipped'].includes(unit.reviewStatus)) continue;
      await fetch(`/api/chapters/${unit.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
    }
  }, pipelineProjectId);
  await page.goto(`${base}/project/${pipelineProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pipeline-next-step"][data-kind="export"]', { timeout: 30000 });
  const [exportDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('[data-testid="pipeline-next-step"] [data-testid="pipeline-next-action"]').click(),
  ]);
  assert.ok(/\.md$/i.test(exportDownload.suggestedFilename()), `导出要真的下载 markdown：${exportDownload.suggestedFilename()}`);
  console.log('PASS repair: export button downloads the manuscript');

  // U18：修订历史可以恢复到某一版（恢复会写一条新修订）
  await page.goto(`${base}/project/${pipelineProjectId}/pipeline?stage=p1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="item-card"][data-kind="character"]', { timeout: 20000 });
  await page.locator('[data-testid="item-card"][data-kind="character"]').first().locator('[data-testid="item-history"]').click();
  await page.waitForSelector('[data-testid="item-history-drawer"] .pipeline-history__row', { timeout: 10000 });
  const historyRowsBefore = await page.locator('[data-testid="item-history-drawer"] .pipeline-history__row').count();
  assert.ok(historyRowsBefore >= 2, `这一条应该有多版历史，实际 ${historyRowsBefore}`);
  await page.locator('[data-testid="item-history-restore"]').first().click();
  await page.locator('[data-testid="item-history-restore-confirm"]').click();
  await page.waitForFunction(
    (before) => document.querySelectorAll('[data-testid="item-history-drawer"] .pipeline-history__row').length > before,
    historyRowsBefore,
    { timeout: 20000 },
  );
  console.log('PASS repair: revision restore writes a new revision instead of deleting history');
  await page.locator('[data-testid="item-history-drawer"] .pipeline-drawer__head .btn').click();

  // ---- 短篇：节拍计划 + 节拍写作（不出现章节树） ----
  await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lib-head');
  await page.locator('.lib-head .btn--primary').click();
  await page.waitForSelector('[data-testid="new-project-form"]');
  await page.locator('.type-option', { hasText: '短篇小说' }).click();
  await page.fill('#np-title', 'AI 流水线·短篇');
  await page.fill('#np-premise', '一个只在停电夜里出现的邻居。');
  await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 10000 });
  await page.locator('[data-testid="new-project-submit"]').click();
  await page.waitForURL(/\/pipeline/, { timeout: 8000 });
  const shortProjectId = new URL(page.url()).pathname.split('/')[2];
  await page.waitForSelector('[data-testid="stage-p1"][data-status="review"]', { timeout: 30000 });
  await page.locator('[data-testid="stage-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p1"][data-status="confirmed"]', { timeout: 20000 });
  await openStage(1);
  await page.waitForSelector('[data-testid="stage-p2"][data-status="review"]', { timeout: 60000 });
  await page.locator('[data-testid="stage-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p2"][data-status="confirmed"]', { timeout: 20000 });
  await openStage(2);
  await page.waitForSelector('[data-testid="beat-plan-row"]', { timeout: 90000 });
  assert.equal(await page.locator('[data-testid="chapter-plan-row"]').count(), 0, '短篇用节拍，不出现章节行');
  const shortPlanRows = await page.locator('[data-testid="beat-plan-row"]').count();
  await page.locator('[data-testid="chapter-plan-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p3"][data-status="confirmed"]', { timeout: 20000 });
  await page.locator('[data-testid="write-start"]').click();
  await page.waitForSelector('[data-testid="beat-row"]', { timeout: 60000 });
  assert.equal(await page.locator('[data-testid="chapter-row"]').count(), 0, '短篇不显示章节树');
  assert.equal(await page.locator('[data-testid="beat-row"]').count(), shortPlanRows, '节拍板与节拍计划条数一致');
  console.log('PASS pipeline short story uses beats (no chapter tree)');

  // ---- repair-round-2 回归（t9 U2/U5/U18）：跳过键只属于 P1、未确认计划不许开写、进程被杀后断点续写 ----
  const interruptProjectId = await page.evaluate(async () => {
    const created = await (await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'AI 流水线·中断续写', type: 'novel', premise: '停电夜里的最后一班车。', targetWords: 12000, start: 'pipeline' }),
    })).json();
    const id = created.project.id;
    const waitIdle = async () => {
      for (let i = 0; i < 400; i += 1) {
        const snap = await (await fetch(`/api/projects/${id}/pipeline`)).json();
        if (!snap.job) return snap;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('后台任务没有结束');
    };
    const startStage = async (stage) => {
      await fetch(`/api/projects/${id}/pipeline/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      await waitIdle();
    };
    await waitIdle();
    await fetch(`/api/projects/${id}/stages/p1/confirm`, { method: 'POST' });
    await startStage('p2');
    await fetch(`/api/projects/${id}/stages/p2/confirm`, { method: 'POST' });
    await startStage('p3');
    return id;
  }, { timeout: 180000 });

  await page.goto(`${base}/project/${interruptProjectId}/pipeline?stage=p1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="item-card"][data-kind="character"]', { timeout: 20000 });
  await openStageMenu();
  assert.equal(await page.locator('[data-testid="stage-skip"]').count(), 1, 'P1 的 ⋯ 菜单里保留「跳过设定」');
  await openStageMenu();
  console.log('PASS repair: p1 keeps the skip action');

  // U5：章节计划没确认时，「开始写作」必须是禁用态并说明原因
  await page.goto(`${base}/project/${interruptProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="write-start"]', { timeout: 20000 });
  assert.ok(await page.locator('[data-testid="write-start"]').isDisabled(), '计划未确认时不能开始写作');
  assert.ok(await page.locator('[data-testid="write-start-hint"]').isVisible(), '要说明为什么不能写');
  assert.ok((await page.locator('[data-testid="write-start-hint"]').innerText()).includes('先确认'));
  await page.goto(`${base}/project/${interruptProjectId}/pipeline?stage=p3`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="chapter-plan-row"]', { timeout: 20000 });
  await page.locator('[data-testid="chapter-plan-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p3"][data-status="confirmed"]', { timeout: 20000 });
  await page.goto(`${base}/project/${interruptProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="write-start"]', { timeout: 20000 });
  assert.ok(!(await page.locator('[data-testid="write-start"]').isDisabled()), '确认计划后可以开始写作');
  console.log('PASS repair: write-start is gated on plan confirmation');

  // U18：写作用慢供应商拖着，中途 SIGKILL 进程 → 重启后横幅报中断 + plan-continue 继续
  const interruptServer = http.createServer((req, res) => {
    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'interrupt-writer', object: 'model' }] }));
      return;
    }
    setTimeout(() => {
      const prose = Array.from({ length: 40 }, () => '雨点砸在铁皮棚顶上，像有人在数秒。').join('\n\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: prose }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 40 } }));
    }, 4000);
  });
  await new Promise((resolve) => interruptServer.listen(0, '127.0.0.1', resolve));
  const interruptProviderId = await createProvider('中断写作供应商', `http://127.0.0.1:${interruptServer.address().port}/v1`, 'interrupt-writer');
  await setDefaultModel({ providerId: interruptProviderId, modelId: 'interrupt-writer' });
  await page.goto(`${base}/project/${interruptProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="write-start"]').click();
  await page.waitForSelector('[data-testid="write-control"][data-state="running"]', { timeout: 20000 });

  server.kill('SIGKILL');
  await new Promise((resolve) => server.once('exit', resolve));
  server = startServer();
  await waitForServer();

  await page.goto(`${base}/project/${interruptProjectId}/pipeline?stage=p4`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pipeline-banner"][data-state="interrupted"]', { timeout: 30000 });
  const interruptedBanner = await page.locator('[data-testid="pipeline-banner"][data-state="interrupted"]').innerText();
  assert.ok(interruptedBanner.includes('中断'), `中断横幅文案：${interruptedBanner}`);
  await page.locator('[data-testid="plan-continue"]').click();
  await page.waitForSelector('[data-testid="write-control"][data-state="running"]', { timeout: 30000 });
  const resumed = await page.evaluate(async (pid) => {
    const snap = await (await fetch(`/api/projects/${pid}/pipeline`)).json();
    return { state: snap.job?.state ?? null, done: snap.job?.unitsDone ?? 0, total: snap.job?.unitsTotal ?? 0 };
  }, interruptProjectId);
  assert.equal(resumed.state, 'running', `继续写作要真的重新跑起来：${JSON.stringify(resumed)}`);
  console.log('PASS repair: crash recovery offers plan-continue and resumes writing');
  // 收尾：停掉这个后台任务，避免拖着整个 suite
  await page.evaluate(async (pid) => {
    const snap = await (await fetch(`/api/projects/${pid}/pipeline`)).json();
    if (snap.job) await fetch(`/api/jobs/${snap.job.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'stop' }) });
  }, interruptProjectId);
  interruptServer.close();
  await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });

  // 旧项目（legacy）继续可用：新建时不勾 AI 企划 → 空白编辑器 + 旧企划审核链路
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lib-head');
  await page.locator('.lib-head .btn--primary').click();
  await page.fill('#np-title', 'E2E 长篇');
  await page.fill('#np-premise', '一个在雨夜收到未来来信的人。');
  await page.locator('#np-ai-plan').uncheck();
  await page.locator('.modal__foot .btn--primary').click();
  await page.waitForSelector('.doc-title-input', { timeout: 20000 });
  const projectId = new URL(page.url()).pathname.split('/')[2];
  assert.ok(projectId.startsWith('p_'));
  assert.ok(!page.url().includes('/pipeline'), '不勾 AI 企划的旧项目仍进写作台，不被新流程劫持');
  console.log('PASS legacy project still opens the blank editor');

  // 旧能力保留：写作台里「AI 企划这一本」仍在，逐条审核后应用
  await page.locator('.draft-start .btn', { hasText: 'AI 企划这一本' }).click();
  await page.waitForSelector('.plan-review', { timeout: 40000 });
  const previewBeatCount = await page.locator('.plan-beat').count();
  assert.ok(previewBeatCount >= 6);
  await page.locator('.plan-beat input').first().uncheck();
  await page.locator('.plan-review__actions .btn--primary').click();
  await page.waitForSelector('.doc-title-input', { timeout: 20000 });
  const planDetail = await page.evaluate(async (pid) => (await fetch(`/api/projects/${pid}`)).json(), projectId);
  assert.equal(planDetail.project.outline.beats.length, previewBeatCount - 1, 'only selected beats applied');
  assert.ok(planDetail.project.characters.length >= 3, 'AI plan created characters');
  await page.screenshot({ path: 'screenshots/99-new-project-empty.png' });
  console.log('PASS legacy writing desk keeps per-item AI plan review');

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


  // ---- A3：剧本不进章节写作台；作品库/英雄卡按类型显示「场 · 分镜」 ----
  await page.evaluate(async (pid) => {
    const { project } = await fetch(`/api/projects/${pid}`).then((r) => r.json());
    await fetch(`/api/projects/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: project.title, genre: project.genre, description: project.description, goalWords: project.goalWords, status: project.status }),
    });
  }, screenplay.project.id);
  await page.goto(base, { waitUntil: 'networkidle' });
  const screenplayCard = page.locator('.project-card', { hasText: 'E2E 剧本' });
  assert.equal(await screenplayCard.count(), 1, 'screenplay card visible in library');
  const screenplayCardText = await screenplayCard.innerText();
  assert.ok(!screenplayCardText.includes(' 页'), `剧本卡片不该出现「页」：${screenplayCardText}`);
  assert.ok(screenplayCardText.includes('场'), `剧本卡片应显示场次：${screenplayCardText}`);
  const heroText = await page.locator('.continue-card').innerText();
  assert.ok(heroText.includes('个分镜'), `剧本英雄卡应显示分镜：${heroText}`);
  assert.equal(await page.locator('.continue-card .pbar').count(), 0, '剧本英雄卡不得显示假字数进度');
  await page.locator('.continue-card .btn--primary').click();
  await page.waitForURL((url) => url.pathname === `/project/${screenplay.project.id}/screenplay`, { timeout: 10000 });
  await page.waitForSelector('.script-page');
  await page.goto(`${base}/project/${screenplay.project.id}`, { waitUntil: 'networkidle' });
  await page.waitForURL((url) => url.pathname === `/project/${screenplay.project.id}/screenplay`, { timeout: 10000 });
  await page.waitForSelector('.script-page');
  assert.equal(await page.locator('.doc-title-input').count(), 0, '剧本不得落进章节写作台');
  // A3b：导出范围换作品后复位为「全书」（回归保护，改前也通过，不作为红证据）
  await page.goto(`${base}/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.export-scope');
  await page.locator('.export-scope').selectOption('chapter');
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.goto(`${base}/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.export-scope');
  assert.equal(await page.locator('.export-scope').inputValue(), 'book', '导出范围应复位为全书');
  console.log('PASS A3 screenplay routing + library counts + export scope reset');

  // ---- A4：设定页 / 共笔面板不再承诺「已进入 AI 上下文」 ----
  const bannedClaims = ['进入 AI 的写作上下文', '已进入上下文', '已同步', '自动引用', '已索引'];
  await page.goto(`${base}/project/${projectId}/codex`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.memory-index');
  const codexText = await page.locator('body').innerText();
  for (const banned of bannedClaims) assert.ok(!codexText.includes(banned), `设定页仍出现「${banned}」`);
  assert.ok(codexText.includes('设定索引'), '设定页应显示「设定索引」');
  assert.ok(codexText.includes('手动引用'), '设定页应说明伏笔需手动引用');
  assert.equal(await page.locator('.memory-index .pbar').count(), 0, '设定页不得保留 72% 假进度条');
  await page.goto(`${base}/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.memory-card');
  const memoryText = await page.locator('.memory-card').innerText();
  assert.ok(memoryText.includes('写作上下文'), `共笔面板应显示「写作上下文」：${memoryText}`);
  assert.ok(memoryText.includes('手动引用'), `共笔面板应标注伏笔手动引用：${memoryText}`);
  console.log('PASS A4 context wording aligned');

  // ---- A2：删除作品要打书名 + 看到真实清单 ----
  const doomed = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'E2E 待删', type: 'novel', description: '删除链路专用，不参与其他断言。' }),
    });
    return res.json();
  });
  await page.evaluate(async (pid) => {
    const { project } = await fetch(`/api/projects/${pid}`).then((r) => r.json());
    await fetch(`/api/projects/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: project.title, genre: project.genre, description: project.description, goalWords: project.goalWords, status: project.status }),
    });
  }, projectId);
  await page.goto(base, { waitUntil: 'networkidle' });
  const doomedCard = page.locator('.project-card', { hasText: 'E2E 待删' });
  assert.equal(await doomedCard.count(), 1, 'doomed project visible');
  await doomedCard.hover();
  await doomedCard.locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  await page.waitForSelector('.danger-confirm ul li', { timeout: 10000 });
  const confirmDelete = page.locator('.danger-confirm .btn--danger');
  assert.equal(await confirmDelete.isDisabled(), true, '未输入书名时删除按钮必须禁用');
  const deleteCountBeforeTyping = deleteRequests.length;
  await page.locator('.danger-confirm input').fill('随便一个名字');
  assert.equal(await confirmDelete.isDisabled(), true, '书名不匹配时删除按钮仍禁用');
  await page.locator('.danger-confirm input').fill('E2E 待删');
  assert.equal(await confirmDelete.isEnabled(), true, '书名匹配后删除按钮可用');
  assert.equal(deleteRequests.length, deleteCountBeforeTyping, '输入书名阶段不得发出 DELETE');
  const impactRows = await page.locator('.danger-confirm ul li').count();
  assert.ok(impactRows >= 5, `删除清单应列出级联内容，实际 ${impactRows} 行`);
  await confirmDelete.click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 10000 });
  await page.locator('.project-card', { hasText: 'E2E 待删' }).waitFor({ state: 'detached', timeout: 10000 });
  assert.equal(await page.locator('.project-card', { hasText: 'E2E 待删' }).count(), 0, 'deleted project leaves library');
  const doomedStatus = (await fetch(`${base}/api/projects/${doomed.project.id}`)).status;
  assert.equal(doomedStatus, 404, 'deleted project is gone');
  console.log('PASS A2 delete requires typed title + impact list');

  // ---- A6 / T4：供应商弹窗保存不得偷改默认模型 ----
  const readDefaultModel = async () => (await page.evaluate(async () => (await fetch('/api/settings')).json())).settings.defaultModel;
  const writeDefaultModel = async (model) => {
    await page.evaluate(async (next) => {
      await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultModel: next }) });
    }, model);
  };
  const openProviderDialog = async (name) => {
    await page.locator('.provider-card').filter({ has: page.locator('h4', { hasText: name }) }).click();
    await page.waitForSelector('.provider-dialog');
  };
  const saveProviderDialog = async () => {
    await page.locator('.provider-dialog__foot .btn--primary').click();
    await page.waitForSelector('.provider-dialog', { state: 'detached' });
  };
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await page.locator('.settings-menu button', { hasText: '模型与供应商' }).click();
  await page.waitForSelector('.provider-card');
  const baselineModel = await readDefaultModel();
  assert.equal(baselineModel?.providerId, 'mock', `基线默认模型应是 mock：${JSON.stringify(baselineModel)}`);
  await openProviderDialog('DeepSeek');
  await page.locator('.provider-model-item', { hasText: 'DeepSeek Reasoner' }).locator('input').check();
  await saveProviderDialog();
  assert.deepEqual(await readDefaultModel(), baselineModel, '保存非默认供应商不得改默认模型');
  await writeDefaultModel({ providerId: 'deepseek', modelId: 'deepseek-reasoner' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.settings-menu button', { hasText: '模型与供应商' }).click();
  await page.waitForSelector('.provider-card');
  await openProviderDialog('DeepSeek');
  assert.equal(await page.locator('.provider-default-select').inputValue(), 'deepseek-reasoner', '弹窗应回显真实现有默认模型');
  await saveProviderDialog();
  assert.equal((await readDefaultModel())?.modelId, 'deepseek-reasoner', '原样保存不得把默认模型打回第一个');
  await openProviderDialog('DeepSeek');
  await page.locator('.provider-model-item', { hasText: 'DeepSeek Reasoner' }).locator('input').uncheck();
  await saveProviderDialog();
  const afterUncheck = await readDefaultModel();
  assert.equal(afterUncheck?.modelId, 'deepseek-chat', `取消勾选当前默认模型后应落到仍启用的模型：${JSON.stringify(afterUncheck)}`);
  await writeDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
  await page.reload({ waitUntil: 'networkidle' });
  console.log('PASS A6/T4 provider save keeps default model');

  // ---- A1-UI：未配置模型时给出明确提示，而不是「点了没反应」 ----
  await writeDefaultModel(null);
  await page.goto(`${base}/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.model-pill');
  assert.ok((await page.locator('.model-pill').innerText()).includes('未配置模型'), '无默认模型时写作台顶部应显示「未配置模型」');
  const msgCountBefore = await page.locator('.chat .msg').count();
  await page.locator('.msg__quick button').first().click();
  await page.waitForSelector('.toast', { timeout: 5000 });
  assert.ok((await page.locator('.toast').innerText()).includes('还没有选择默认模型'), '未配置模型时应提示去设置里选择');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.chat .msg').count(), msgCountBefore, '未配置模型时不得凭空插入对话');
  assert.equal(deleteRequests.length, deleteCountBeforeTyping + 1, '本轮只有确认删除发出过 DELETE');
  await writeDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
  console.log('PASS A1-UI no default model prompt');

  // ---- t10：大纲/剧本/设定的示意标记与真实数据 + 确认区 Esc ----
  await page.goto(`${base}/project/${projectId}/outline`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.acts .act');
  const actCards = page.locator('.acts .act');
  const actCount = await actCards.count();
  assert.ok(actCount >= 3, `大纲应渲染真实幕，实际 ${actCount}`);
  const structureSub = await page.locator('.structure-card span').first().innerText();
  assert.ok(structureSub.startsWith(`${actCount} 幕`), `结构卡应显示真实幕数：${structureSub}`);
  assert.equal((await page.locator('.tension-card .tag--hint').innerText()).trim(), '示意', '张力曲线必须有可见「示意」标记');
  assert.ok((await page.locator('.tension-card__head p').innerText()).includes('不按正文计算'), '张力曲线必须说明不是真实计算');
  assert.ok((await page.locator('.panel-section-head', { hasText: '人物弧光' }).innerText()).includes('示意'), '人物弧光必须标注示意');
  const chartLabels = page.locator('.chart-labels text');
  const labelCount = await chartLabels.count();
  assert.ok(labelCount >= 2, `张力图应标出真实幕区间，实际 ${labelCount}`);
  for (let i = 0; i < labelCount; i += 1) {
    const label = (await chartLabels.nth(i).textContent()).trim();
    assert.ok(/^第 \d+–\d+ 章$/.test(label), `章节区间应来自真实场景数据：${label}`);
  }
  await actCards.nth(1).locator('.beat').first().click();
  assert.equal((await page.locator('.act--current .act__no').innerText()).trim(), 'II', '选中第二幕后第二幕高亮');
  await actCards.nth(0).locator('.beat').first().click();
  assert.equal((await page.locator('.act--current .act__no').innerText()).trim(), 'I', '当前幕必须跟随选中场景，不能写死第二幕');
  assert.equal((await page.locator('.act-item.is-active .act-item__no').innerText()).trim(), 'I', '侧栏幕列表的当前幕也要跟随选中场景');
  console.log('PASS t10 D-1 outline acts are real + schematic markers');

  await page.goto(`${base}/project/${screenplay.project.id}/screenplay`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.script-inspector');
  assert.equal((await page.locator('.script-inspector__head .tag--hint').innerText()).trim(), '示意', '本场分析必须标注示意');
  assert.ok((await page.locator('.script-inspector__note').innerText()).includes('不来自本场正文分析'), '本场分析需说明不是真实评分');
  const sceneProgressText = (await page.locator('.goal-mini strong').innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(/\d+ \/ \d+ 场有正文/.test(sceneProgressText), `剧本进度应显示真实已写场次：${sceneProgressText}`);
  console.log('PASS t10 D-2 screenplay scene analysis marked as schematic');

  await page.goto(`${base}/project/${projectId}/codex`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.memory-index');
  await page.locator('.codex-tabs button', { hasText: '伏笔' }).click();
  const codexTextAll = await page.locator('body').innerText();
  for (const banned of ['已同步', '已索引', '自动引用', '进入 AI 的写作上下文']) {
    assert.ok(!codexTextAll.includes(banned), `设定页仍有假承诺「${banned}」`);
  }
  assert.ok((await page.locator('.foreshadow-head p').innerText()).includes('记录埋设位置'), '伏笔台账不得再承诺 AI 自动追踪');
  assert.ok((await page.locator('.memory-index__head').innerText()).includes('本地保存'), '设定索引应说明本地保存');
  console.log('PASS t10 D-3 codex wording stays local-only');

  await page.goto(`${base}/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer-hint');
  const composerHint = await page.locator('.composer-hint').innerText();
  assert.ok(!/由\s*未配置模型\s*提供/.test(composerHint), `共笔提示不得出现病句：${composerHint}`);
  assert.ok(composerHint.includes('由'), `配置了默认模型时应说明由谁提供：${composerHint}`);
  console.log('PASS t10 studio composer wording');

  await page.goto(base, { waitUntil: 'networkidle' });
  const escCard = page.locator('.project-card', { hasText: 'E2E 长篇' });
  await escCard.hover();
  await escCard.locator('.project-card__more').click();
  await page.waitForSelector('.modal--project-settings');
  await page.locator('.modal--project-settings .modal__foot .btn--danger').click();
  await page.waitForSelector('.danger-confirm');
  await page.locator('.danger-confirm input').fill('半个书名');
  const deleteCountBeforeEsc = deleteRequests.length;
  await page.keyboard.press('Escape');
  await page.locator('.danger-confirm').waitFor({ state: 'detached', timeout: 5000 });
  assert.ok(await page.locator('.modal--project-settings .wizard-body .form-block').first().isVisible(), 'Esc 后应退回编辑态');
  assert.equal(await page.locator('.modal--project-settings').count(), 1, 'Esc 只关闭确认区，不关闭整个弹窗');
  await page.waitForTimeout(700);
  assert.equal(deleteRequests.length, deleteCountBeforeEsc, 'Esc 关闭确认区不得发出 DELETE');
  await page.locator('.modal--project-settings .modal__foot-actions .btn--ghost', { hasText: '取消' }).click();
  await page.waitForSelector('.modal--project-settings', { state: 'detached' });
  console.log('PASS t10 delete confirm closes on Esc without DELETE');

  // ---- t17 / SPEC M3 + DEF-14：条目增删排序；上游未确认时「按上游重排」禁用并说明原因 ----
  await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.lib-head__actions .btn--primary', { hasText: '新建作品' }).click();
  await page.waitForSelector('[data-testid="new-project-form"]');
  await page.fill('#np-title', 'AI 流水线·条目与排序');
  await page.waitForSelector('[data-testid="new-project-precheck"][data-state="ok"]', { timeout: 10000 });
  await page.locator('[data-testid="new-project-submit"]').click();
  await page.waitForURL(/\/pipeline/, { timeout: 8000 });
  const m3ProjectId = new URL(page.url()).pathname.split('/')[2];
  await page.waitForSelector('[data-testid="stage-p1"][data-status="review"]', { timeout: 30000 });

  const charCards = '[data-testid="item-card"][data-kind="character"]';
  const charIdsBefore = await page.locator(charCards).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  assert.ok(charIdsBefore.length >= 1, 'P1 至少要有一个人物条目');
  await page.locator('[data-testid="stage-block-add-characters"]').click();
  await page.waitForFunction(
    ([selector, expected]) => document.querySelectorAll(selector).length === expected,
    [charCards, charIdsBefore.length + 1],
    { timeout: 15000 },
  );
  const charIdsAdded = await page.locator(charCards).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  const addedCharId = charIdsAdded.find((id) => !charIdsBefore.includes(id));
  assert.ok(addedCharId, '新增人物后应出现一张新的条目卡');

  await page.locator(`${charCards}[data-id="${charIdsAdded[0]}"] [data-testid="item-move-down"]`).click();
  await page.waitForFunction(
    ([selector, first]) => document.querySelector(selector)?.getAttribute('data-id') !== first,
    [charCards, charIdsAdded[0]],
    { timeout: 15000 },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="stage-p1"]');
  const charIdsAfterReload = await page.locator(charCards).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  assert.equal(charIdsAfterReload[0], charIdsAdded[1], '条目排序要落到服务端，刷新后仍然生效');

  await page.locator(`${charCards}[data-id="${addedCharId}"] [data-testid="item-delete"]`).click();
  await page.locator('[data-testid="confirm-ok"]').click();
  await page.waitForFunction(
    ([selector, expected]) => document.querySelectorAll(selector).length === expected,
    [charCards, charIdsBefore.length],
    { timeout: 15000 },
  );
  console.log('PASS pipeline stage items can be added, reordered and deleted');

  await page.locator('[data-testid="stage-confirm"]').click();
  await page.waitForSelector('[data-testid="stage-p1"][data-status="confirmed"]', { timeout: 20000 });
  await page.locator('.pipeline-rail__row').nth(1).click();
  await page.waitForTimeout(400);
  const p2Trigger = page.locator('[data-testid="stage-generate"]');
  if (await p2Trigger.count()) await p2Trigger.click();
  await page.waitForSelector('[data-testid="stage-p2"][data-status="review"]', { timeout: 60000 });

  await page.evaluate(async ({ projectId, itemId }) => {
    await fetch(`/api/projects/${projectId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '上游改动后的名字' }),
    });
  }, { projectId: m3ProjectId, itemId: charIdsAfterReload[0] });

  await page.goto(`${base}/project/${m3ProjectId}/pipeline?stage=p2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="stage-stale-banner"]', { timeout: 20000 });
  assert.equal(
    await page.locator('[data-testid="stage-stale-regenerate"]').isDisabled(),
    true,
    '上游还没重新确认时，「按上游重排」必须是禁用态（否则必然 409）',
  );
  const regenHint = page.locator('[data-testid="stage-stale-regenerate-hint"]');
  assert.ok(await regenHint.isVisible(), '禁用时要写明原因');
  assert.ok((await regenHint.innerText()).includes('先确认上一阶段'), `提示要说清先确认上一阶段：${await regenHint.innerText()}`);

  await page.evaluate(async (projectId) => {
    await fetch(`/api/projects/${projectId}/stages/p1/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  }, m3ProjectId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="stage-stale-banner"]', { timeout: 20000 });
  assert.equal(
    await page.locator('[data-testid="stage-stale-regenerate"]').isEnabled(),
    true,
    '上游确认之后「按上游重排」要恢复可用',
  );
  await page.locator('[data-testid="stage-stale-regenerate"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="stage-stale-banner"]'), null, { timeout: 90000 });
  await page.waitForSelector('[data-testid="stage-p2"][data-status="review"]', { timeout: 60000 });
  console.log('PASS stale banner keeps the regenerate key usable only after the upstream stage is confirmed');

  // N1：手改过条目之后，「整份重新生成」必须给出「会覆盖手改内容」的二次确认，
  // 确认后真的能起 job —— 以前这条路在界面上是死的（只有 API 直连能带 confirmOverwrite）。
  await page.evaluate(async ({ projectId, itemId }) => {
    await fetch(`/api/projects/${projectId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '手改之后要点重生成的主角' }),
    });
  }, { projectId: m3ProjectId, itemId: charIdsAfterReload[0] });
  await page.goto(`${base}/project/${m3ProjectId}/pipeline?stage=p1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="stage-p1"]', { timeout: 20000 });
  await page.locator('[data-testid="stage-regen-all"]').click();
  await page.waitForSelector('[data-testid="confirm-dialog"]', { timeout: 15000 });
  await page.locator('[data-testid="confirm-dialog"] [data-testid="confirm-ok"]').click();
  const overwriteDialog = page.locator('[data-testid="confirm-overwrite"]');
  await overwriteDialog.waitFor({ state: 'visible', timeout: 20000 });
  const overwriteText = await overwriteDialog.innerText();
  assert.ok(
    overwriteText.includes('覆盖') && overwriteText.includes('手改'),
    `覆盖确认要说明会动到手改内容：${overwriteText}`,
  );
  await page.locator('[data-testid="confirm-overwrite"] [data-testid="confirm-ok"]').click();
  await page.waitForSelector('[data-testid="stage-p1"][data-status="review"]', { timeout: 90000 });
  console.log('PASS regenerating over hand edits asks for an overwrite confirmation and then runs');

  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
  // 负向用例会故意打到失败接口：允许清单之外的 4xx/5xx 一律判红。
  const allowedHttpErrors = [
    // 「继续写作」的兜底：先探测 /writing/continue，服务端拒绝后退回 retry（见 PipelinePage）。
    /^400 POST \/api\/projects\/p_[^/]+\/writing\/continue$/,
    // 删除作品的瞬间仍在飞的轮询（组件卸载后已 abort，这里是极窄的竞态窗口）。
    /^404 GET \/api\/projects\/p_[^/]+\/pipeline$/,
    // 「排序失败要给出提示」用 route 注入的 409（服务端真身不会在生成中接受排序）。
    /^409 POST \/api\/projects\/p_[^/]+\/stages\/p3\/units\/reorder$/,
    // N1 覆盖确认：第一次不带 confirmOverwrite 的整阶段重生成按设计会 422，用来触发二次确认。
    /^422 POST \/api\/projects\/p_[^/]+\/stages\/p1\/regenerate$/,
  ];
  console.log('HTTP >=400 during run:');
  for (const line of httpErrors) {
    console.log('  ' + line);
    assert.ok(
      allowedHttpErrors.some((re) => re.test(line)),
      `unexpected HTTP error during UI test: ${line}`,
    );
  }
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
