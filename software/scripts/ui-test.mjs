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
    await page.locator('.provider-card', { hasText: name }).click();
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
  await page.locator('.provider-model-item', { hasText: 'DeepSeek R2' }).locator('input').check();
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
  await page.locator('.provider-model-item', { hasText: 'DeepSeek R2' }).locator('input').uncheck();
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
