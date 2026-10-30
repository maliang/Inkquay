/**
 * QA 独立端到端验收（API 层）：t7
 *
 * 与 scripts/api-test.mjs（实现者自测）**没有共用断言**：本脚本另建夹具、另设断言，
 * 重点覆盖实现者脚本没覆盖或有兜底掩盖的路径：
 *   A 新建 + AI 企划：加载可观测（最大观测间隔）、成功、失败、取消、取消后重试
 *   B 长篇五阶段：编辑 / 意见重生成 / 确认（含越阶确认必须被拒）/ 字数范围 / 逐章写作 / 审阅 / 重写单章
 *   C 短篇：无章节（chapters 表 0 行）、节拍计划与逐节拍写作
 *   D 长任务：暂停（当场 / 在写一章时）、继续、进程被 kill 后恢复、断网失败后重试
 *   E 旧项目迁移：正文/版本/设定不丢、可重入、回退、强制失败仍可打开
 *   F 无 Key / 无默认模型：明确报错且不落空壳，且绝不静默 mock
 *
 * 输出：team/inkquay-ai-first/evidence/qa-api-results.json（逐条通过/失败 + 证据）
 * 用法：node scripts/qa-e2e-api.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const cwd = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(cwd, '..');
const evidenceDir = path.join(repoRoot, 'team/inkquay-ai-first/evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const PORT = Number(process.env.QA_PORT || 8831);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-e2e-api-'));
const logFile = path.join(evidenceDir, 'qa-api-server.log');
fs.writeFileSync(logFile, '');

const MOCK_SIGNATURE = '印刷厂的老机器停在原地';
const results = [];
const defects = [];
let currentStep = null;

function record(id, title, status, evidence, extra = {}) {
  const item = { id, title, status, evidence, ...extra };
  results.push(item);
  const mark = status === 'passed' ? 'PASS' : 'FAIL';
  console.log(`${mark} ${id} ${title}${status === 'passed' ? '' : `\n     → ${evidence}`}`);
  return item;
}

async function step(id, title, fn) {
  currentStep = id;
  const started = Date.now();
  try {
    const evidence = await fn();
    // 函数内部可能已经自行 record（部分失败/缺陷路径），不要重复计一条
    if (results.some((item) => item.id === id)) return results.find((item) => item.id === id);
    return record(id, title, 'passed', evidence || `ok (${Date.now() - started}ms)`);
  } catch (error) {
    if (results.some((item) => item.id === id)) return results.find((item) => item.id === id);
    return record(id, title, 'failed', error instanceof Error ? error.message : String(error));
  } finally {
    currentStep = null;
  }
}

function defect(id, severity, title, file, detail, repro) {
  defects.push({ id, severity, title, file, detail, repro });
  console.log(`DEFECT ${id} [${severity}] ${title} — ${file}`);
}

// ---------------------------------------------------------------- server ----
let server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd,
  env: { ...process.env, PORT: String(PORT), PW_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stdout.on('data', (d) => { fs.appendFileSync(logFile, String(d)); });
server.stderr.on('data', (d) => { stderr += String(d); fs.appendFileSync(logFile, String(d)); });

async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start\n${stderr.slice(-4000)}`);
}

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(PORT), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { fs.appendFileSync(logFile, String(d)); });
  server.stderr.on('data', (d) => { stderr += String(d); fs.appendFileSync(logFile, String(d)); });
  await waitForServer();
}

async function stopServer(signal = 'SIGTERM') {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill(signal);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
}

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data, ok: res.ok };
}

async function okJson(pathname, options = {}) {
  const res = await api(pathname, options);
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} → ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
  return res.data;
}

const post = (pathname, body, headers) => api(pathname, { method: 'POST', body: JSON.stringify(body ?? {}), headers });
const patch = (pathname, body) => api(pathname, { method: 'PATCH', body: JSON.stringify(body ?? {}) });

// ------------------------------------------------------- fake providers ----
function createFakeProvider({ delayMs = 0, mode = 'ok', label = 'fake' } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const entry = { url: req.url, startedAt: Date.now(), closedAt: null, aborted: false };
    log.push(entry);
    res.on('close', () => { entry.closedAt = Date.now(); if (!res.writableEnded) entry.aborted = true; });
    if (req.url && req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: `${label}-model`, object: 'model' }] }));
      return;
    }
    if (!req.url || !req.url.includes('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const respond = () => {
        if (res.writableEnded || entry.aborted) return;
        if (mode === 'timeout') return; // 永不回包，用于超时/取消
        if (mode === 'auth') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        if (mode === 'garbage') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: '这不是 JSON，只是一段散文。' }, finish_reason: 'stop' }] }));
          return;
        }
        if (mode === 'empty') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: '', reasoning_content: '我想了很久但什么都没输出' }, finish_reason: 'stop' }] }));
          return;
        }
        // mode === 'ok' → 固定散文；mode === 'varying' → 每次多一段，用来验证「重写单章真的换了内容」
        const counter = (entry.seq = (entry.seq || 0) + 1);
        const base = '旧城的雨把铁皮棚顶敲成一片鼓点，林昭把伞收起来，抖了抖水，抬头看见那盏一直没换过的灯。';
        const extra = mode === 'varying' ? `这是第 ${counter} 次重写的版本，语气更冷，句子更短。\n\n` : '';
        const prose = extra + Array.from({ length: 30 }, () => base).join('\n\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'qa-fake',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: prose }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 900, total_tokens: 920 },
        }));
      };
      if (delayMs > 0) setTimeout(respond, delayMs); else respond();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, log, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/v1` });
    });
  });
}

async function addProvider(name, baseUrl, modelId, apiKey = 'sk-qa-fake') {
  const created = await okJson('/api/providers', {
    method: 'POST',
    body: JSON.stringify({
      name,
      kind: 'openai',
      baseUrl,
      apiKey,
      models: [{ id: modelId, name: modelId, ctx: '8k' }],
      enabledModels: [modelId],
    }),
  });
  const id = created.provider.id;
  await patch(`/api/providers/${id}`, { enabled: true });
  return { id, modelId };
}

async function setDefaultModel(model) {
  await okJson('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: model }) });
}

const snapshot = (projectId) => okJson(`/api/projects/${projectId}/pipeline`);
const unitsOf = (projectId) => okJson(`/api/projects/${projectId}/units`);
const itemsOf = (projectId, stage) => okJson(`/api/projects/${projectId}/stages/${stage}/items`);
const projectDetail = (projectId) => okJson(`/api/projects/${projectId}`);

/**
 * 等待 job 终止。
 * jobId 用来避免「上一个已 done 的 lastJob」让等待立刻返回（假绿）。给了 jobId 就必须等到那个 job。
 */
async function waitJob(projectId, { timeoutMs = 90000, jobId = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snap = await snapshot(projectId);
    last = snap;
    const active = snap.job;
    const latest = snap.lastJob;
    const candidates = [active, latest].filter(Boolean);
    const target = jobId ? candidates.find((job) => job.id === jobId) : (active || latest);
    if (target && !['queued', 'running', 'pausing'].includes(target.state)) {
      if (!jobId || target.id === jobId) return snap;
    }
    if (jobId && !target && Date.now() - (deadline - timeoutMs) > 3000) {
      // job 既不在 job 也不在 lastJob：可能刚被挤到更早的历史里，继续等一小会儿
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`job never settled for ${projectId}${jobId ? ` (jobId=${jobId})` : ''}: ${JSON.stringify(last?.job || last?.lastJob)}`);
}

const projectCount = async () => (await okJson('/api/projects')).projects.length;

// ------------------------------------------------------------------ main ----
async function main() {
  await waitForServer();

  // ================= A. 新建 + AI 企划 =================
  await step('A0', '环境准备：onboarding + mock 供应商（显式选择才允许 mock）', async () => {
    const onboard = await post('/api/onboarding', {
      name: 'QA 验收作者',
      signature: 'qa',
      providerId: 'mock',
      apiKey: '',
      modelId: 'mock-writer',
    });
    if (!onboard.ok) throw new Error(`onboarding failed: ${onboard.status} ${JSON.stringify(onboard.data)}`);
    const pre = await okJson('/api/pipeline/precheck');
    if (!pre.ok) throw new Error(`precheck after onboarding should be ok, got ${JSON.stringify(pre)}`);
    return `precheck ok → ${pre.providerId}/${pre.modelId}`;
  });

  await step('A1', '「新建并让 AI 企划」成功路径：创建即返回、job 立刻可见、进度持续变化', async () => {
    const t0 = Date.now();
    const created = await post('/api/projects', {
      title: 'QA 长篇·无响应回归',
      type: 'novel',
      premise: '一个替人写遗书的代笔人，收到一封写给自己的遗书。',
      targetWords: 60000,
      start: 'pipeline',
    });
    if (created.status !== 201) throw new Error(`create should return 201, got ${created.status} ${JSON.stringify(created.data)}`);
    const createMs = Date.now() - t0;
    const projectId = created.data.project.id;
    if (createMs > 5000) throw new Error(`创建请求耗时 ${createMs}ms，超过 5s 即用户会以为没反应`);
    if (!created.data.job) throw new Error('创建响应里没有 job（创建后必须立刻有后台任务）');

    // 观测时间线：每 100ms 采样一次，记录 state/step/items 变化
    const timeline = [];
    const deadline = Date.now() + 60000;
    let settled = null;
    while (Date.now() < deadline) {
      const snap = await snapshot(projectId);
      const job = snap.job || snap.lastJob;
      const key = `${job?.state}|${job?.step || ''}|${snap.stages.p1.counts.items}|${job?.unitsDone ?? 0}|${job?.stepIndex ?? 0}`;
      if (!timeline.length || timeline[timeline.length - 1].key !== key) {
        timeline.push({ at: Date.now() - t0, key, state: job?.state, step: job?.step, items: snap.stages.p1.counts.items, elapsedMs: job?.elapsedMs });
      }
      if (job && !['queued', 'running', 'pausing'].includes(job.state)) { settled = snap; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!settled) throw new Error(`60s 内 job 未结束；时间线=${JSON.stringify(timeline)}`);
    const gaps = timeline.slice(1).map((point, index) => point.at - timeline[index].at);
    const maxGap = gaps.length ? Math.max(...gaps) : 0;
    if (settled.stages.p1.status !== 'review') throw new Error(`p1 应为 review，实际 ${settled.stages.p1.status}`);
    if (settled.stages.p1.counts.items < 5) throw new Error(`p1 条目太少：${settled.stages.p1.counts.items}`);
    if ((settled.job || settled.lastJob).state !== 'done') throw new Error(`job 应为 done，实际 ${(settled.job || settled.lastJob).state}`);
    if (maxGap > 15000) throw new Error(`界面最长 ${maxGap}ms 无任何变化，超过「无响应」阈值 15s`);
    const nextStep = settled.nextStep;
    if (nextStep.kind !== 'review-p1') throw new Error(`nextStep 应为 review-p1，实际 ${nextStep.kind}`);
    return `创建 ${createMs}ms 返回 201；观测 ${timeline.length} 次状态变化，最大间隔 ${maxGap}ms；p1=${settled.stages.p1.status}/${settled.stages.p1.counts.items} 条；nextStep=${nextStep.kind}；时间线=${timeline.map((p) => `${p.at}ms:${p.state}/${p.step}/items=${p.items}`).join(' → ')}`;
  });

  // ---- A2 失败路径：供应商连不上 ----
  let brokenProjectId = null;
  await step('A2', 'AI 企划失败（供应商不可达）：结构化错误码、无伪造内容、状态可读', async () => {
    const brokenUrl = 'http://127.0.0.1:59999/v1';
    const provider = await addProvider('QA 不可达供应商', brokenUrl, 'dead-model');
    await setDefaultModel({ providerId: provider.id, modelId: provider.modelId });
    const created = await post('/api/projects', {
      title: 'QA 失败路径', type: 'novel', premise: '测试失败', targetWords: 60000, start: 'pipeline',
    });
    if (created.status !== 201) throw new Error(`create → ${created.status}`);
    brokenProjectId = created.data.project.id;
    const snap = await waitJob(brokenProjectId, { timeoutMs: 120000 });
    const job = snap.lastJob;
    if (job.state !== 'failed') throw new Error(`job 应 failed，实际 ${job.state}`);
    const code = job.error?.code;
    if (!['NETWORK', 'PROVIDER_ERROR', 'PROVIDER_TIMEOUT'].includes(code)) throw new Error(`错误码不对：${code}`);
    if (snap.stages.p1.counts.items !== 0) throw new Error('失败却写入了设定条目（应零写入）');
    if (snap.lastError?.code !== code) throw new Error(`lastError 未持久化：${JSON.stringify(snap.lastError)}`);
    const detail = await projectDetail(brokenProjectId);
    const chars = detail.project.characters?.length || 0;
    if (chars !== 0) throw new Error(`失败却写入了人物 ${chars} 个`);
    // 出路：重试接口存在且可重入（不 500）
    const retry = await post(`/api/projects/${brokenProjectId}/jobs/${job.id}/retry`);
    if (![202, 200].includes(retry.status)) throw new Error(`retry → ${retry.status} ${JSON.stringify(retry.data)}`);
    const afterRetry = await waitJob(brokenProjectId, { timeoutMs: 120000, jobId: retry.data.job.id });
    if (afterRetry.stages.p1.counts.items !== 0) throw new Error('重试仍失败却又写了条目');
    return `job state=failed code=${code}；p1 条目 0；lastError=${snap.lastError.code}；retry → ${retry.status} 并再次失败但无脏数据`;
  });

  // ---- A3 取消路径 ----
  let cancelProjectId = null;
  let cancelJobId = null;
  const slowPlan = await createFakeProvider({ delayMs: 4000, label: 'slow-plan' });
  await step('A3', 'AI 企划取消：≤2s 停止、上游 ≤5s 释放、被取消步零写入、留可重试出路', async () => {
    const provider = await addProvider('QA 慢企划供应商', slowPlan.url, 'slow-plan-model');
    await setDefaultModel({ providerId: provider.id, modelId: provider.modelId });
    const created = await post('/api/projects', {
      title: 'QA 取消路径', type: 'novel', premise: '测试取消', targetWords: 60000, start: 'pipeline',
    });
    cancelProjectId = created.data.project.id;
    cancelJobId = created.data.job.id;
    // 等 job 真的开始跑（step 已开始）
    let snap = null;
    const startDeadline = Date.now() + 30000;
    while (Date.now() < startDeadline) {
      snap = await snapshot(cancelProjectId);
      if (snap.job && snap.job.state === 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!snap?.job || snap.job.state !== 'running') throw new Error(`job 未进入 running：${JSON.stringify(snap?.job)}`);
    const tCancel = Date.now();
    const cancel = await post(`/api/jobs/${cancelJobId}/cancel`, { mode: 'stop' });
    if (![200, 202].includes(cancel.status)) throw new Error(`cancel → ${cancel.status}`);
    let terminal = null;
    while (Date.now() - tCancel < 10000) {
      const live = await snapshot(cancelProjectId);
      const job = live.job || live.lastJob;
      if (job && !['queued', 'running', 'pausing'].includes(job.state)) { terminal = { snap: live, job, ms: Date.now() - tCancel }; break; }
      await new Promise((r) => setTimeout(r, 80));
    }
    if (!terminal) throw new Error('取消后 10s 仍未终止');
    if (terminal.ms > 2000) throw new Error(`取消到真的停下用了 ${terminal.ms}ms（要求 ≤2s）`);
    if (terminal.job.state !== 'cancelled') throw new Error(`state 应 cancelled，实际 ${terminal.job.state}`);
    // 上游释放：等待假供应商侧看到连接关闭
    const inflight = slowPlan.log.filter((e) => e.url?.includes('/chat/completions'));
    let releasedMs = null;
    for (let i = 0; i < 100; i += 1) {
      const pending = inflight.filter((e) => !e.closedAt);
      if (!pending.length) {
        releasedMs = Math.max(...inflight.map((e) => e.closedAt)) - tCancel;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (releasedMs === null) throw new Error('取消后上游连接 10s 内未释放');
    if (releasedMs > 5000) throw new Error(`上游释放用了 ${releasedMs}ms（要求 ≤5s）`);
    // 零写入：p1 一条都没有
    const after = await snapshot(cancelProjectId);
    if (after.stages.p1.counts.items !== 0) throw new Error(`被取消的步骤写了 ${after.stages.p1.counts.items} 条`);
    // 出路：可重试
    const retry = await post(`/api/projects/${cancelProjectId}/jobs/${cancelJobId}/retry`);
    if (![200, 202].includes(retry.status)) throw new Error(`取消后 retry → ${retry.status}`);
    await post(`/api/jobs/${retry.data.job.id}/cancel`, { mode: 'stop' });
    return `cancel→terminal ${terminal.ms}ms；上游释放 ${releasedMs}ms；被取消步写入 0 条；retry → ${retry.status}`;
  });

  // ================= B. 长篇五阶段 =================
  await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
  let novelId = null;
  let p1ItemId = null;

  await step('B1', '越阶确认必须被拒（未确认 p1 时确认 p2 → STAGE_LOCKED）', async () => {
    const created = await post('/api/projects', {
      title: 'QA 长篇五阶段', type: 'novel', genre: '悬疑 · 文学',
      premise: '一个替人写遗书的代笔人，收到一封写给自己的遗书，落款日期是明天。',
      targetWords: 80000, start: 'pipeline',
    });
    novelId = created.data.project.id;
    await waitJob(novelId, { timeoutMs: 60000, jobId: created.data.job.id });
    const blocked = await post(`/api/projects/${novelId}/stages/p2/confirm`);
    if (blocked.status !== 409) throw new Error(`越阶确认应 409，实际 ${blocked.status} ${JSON.stringify(blocked.data)}`);
    if (blocked.data.code !== 'STAGE_LOCKED') throw new Error(`错误码应 STAGE_LOCKED，实际 ${blocked.data.code}`);
    return `p2 confirm → 409 ${blocked.data.code}`;
  });

  await step('B2', 'P1 设定：编辑条目落库并产生修订；给 AI 意见后重生成', async () => {
    const items = await itemsOf(novelId, 'p1');
    const world = items.items.find((item) => item.kind === 'world');
    if (!world) throw new Error('没有 world 条目');
    const before = world.payload.era;
    const edited = await patch(`/api/projects/${novelId}/items/${world.id}`, {
      payload: { ...world.payload, era: '改写后的时代设定：沿海旧城，2003 年。' },
    });
    if (!edited.ok) throw new Error(`PATCH item → ${edited.status} ${JSON.stringify(edited.data)}`);
    const after = await itemsOf(novelId, 'p1');
    const world2 = after.items.find((item) => item.id === world.id);
    if (world2.payload.era === before) throw new Error('编辑没有生效');
    const revs = await okJson(`/api/projects/${novelId}/stages/p1/revisions?targetId=${world.id}`);
    if (!revs.revisions.length) throw new Error('编辑后没有修订记录');
    // 带着手改内容做「整阶段重做」必须先显式确认，否则等于静默覆盖（N1/N9 的语义）
    const blind = await post(`/api/projects/${novelId}/stages/p1/feedback`, { note: '世界观要更冷一些，少一点温情。' });
    if (blind.status !== 422) {
      throw new Error(`手改后整阶段 feedback 应 422 要确认，实际 ${blind.status} ${JSON.stringify(blind.data)}`);
    }
    if (blind.data?.code !== 'CONFIRM_BLOCKED' || blind.data?.detail?.requiresConfirm !== 'overwrite') {
      throw new Error(`应 CONFIRM_BLOCKED + requiresConfirm=overwrite，实际 ${JSON.stringify(blind.data)}`);
    }
    // 真实 UI 的 FeedbackComposer 会把意见发到具体条目（scope:item + targetId）
    const fb = await post(`/api/projects/${novelId}/stages/p1/feedback`, {
      note: '世界观要更冷一些，少一点温情。', scope: 'item', targetId: world.id,
    });
    if (fb.status !== 202) throw new Error(`feedback → ${fb.status} ${JSON.stringify(fb.data)}`);
    await waitJob(novelId, { timeoutMs: 60000, jobId: fb.data.job.id });
    const revs2 = await okJson(`/api/projects/${novelId}/stages/p1/revisions`);
    if (revs2.revisions.length <= revs.revisions.length) {
      throw new Error(`按意见重生成没有新增修订（${revs.revisions.length} → ${revs2.revisions.length}）`);
    }
    globalThis.__p1RevsAfterFeedback = revs2.revisions;
    // 短意见必须被拒
    const shortNote = await post(`/api/projects/${novelId}/stages/p1/feedback`, { note: '改', scope: 'item', targetId: world.id });
    if (shortNote.status !== 422) throw new Error(`过短意见应 422，实际 ${shortNote.status}`);
    p1ItemId = world.id;
    return `编辑后修订 ${revs.revisions.length} 条；整阶段无确认 → 422 ${blind.data.code}；按单条意见重生成后 ${revs2.revisions.length} 条；短意见 → 422 ${shortNote.data.code}`;
  });

  await step('B2b', '修订历史要能区分「AI 首次生成」与「按你的意见重生成」', async () => {
    const revs = globalThis.__p1RevsAfterFeedback || [];
    const sources = [...new Set(revs.map((rev) => rev.source))];
    const feedbackRevs = revs.filter((rev) => rev.source === 'ai_feedback');
    if (!feedbackRevs.length) {
      defect('DEF-3', 'medium', '修订历史的来源永远是 ai_initial：按意见重生成与首次生成分不开',
        'software/src/server/pipeline/steps.ts 的 revisionSource()（带 runtime.note → ai_feedback，regen-* job → ai_regen，否则 ai_initial）',
        `给 AI 提意见后跑完重生成，修订来源集合仍是 ${JSON.stringify(sources)}，没有一条 ai_feedback/ai_regen（只有单条 item 重生成走的是 ai_regen）。后果：修订历史/版本抽屉无法区分「AI 第一次写的」和「按你的意见改的」，用户回看与回退时没有依据。`,
        '1) 新建长篇 → 生成 P1；2) POST /stages/p1/feedback {note:"世界观更冷一些"}；3) 等 job done；4) GET /api/projects/:id/stages/p1/revisions → 全部 source=ai_initial');
      throw new Error(`按意见重生成后没有任何 ai_feedback 修订；实际来源集合=${JSON.stringify(sources)}`);
    }
    return `来源集合 ${JSON.stringify(sources)}，其中 ai_feedback ${feedbackRevs.length} 条`;
  });

  await step('B3', 'P1 确认 → 解锁 P2；确认快照只增不改', async () => {
    const confirm = await post(`/api/projects/${novelId}/stages/p1/confirm`);
    if (!confirm.ok) throw new Error(`p1 confirm → ${confirm.status} ${JSON.stringify(confirm.data)}`);
    const snap = await snapshot(novelId);
    if (snap.stages.p1.status !== 'confirmed') throw new Error(`p1 状态 ${snap.stages.p1.status}`);
    if (snap.nextStep.kind !== 'generate-p2') throw new Error(`nextStep 应 generate-p2，实际 ${snap.nextStep.kind}`);
    const revs = await okJson(`/api/projects/${novelId}/stages/p1/revisions`);
    const snapshotRevs = revs.revisions.filter((rev) => rev.scope === 'stage');
    if (!snapshotRevs.length) throw new Error('确认没有落确认快照');
    return `p1=confirmed，确认快照 ${snapshotRevs.length} 条，nextStep=${snap.nextStep.kind}`;
  });

  await step('B4', 'P2 大纲：生成幕与节拍 → 编辑 → 单条意见重生成 → 确认', async () => {
    const gen = await post(`/api/projects/${novelId}/pipeline/start`, { stage: 'p2' });
    if (gen.status !== 202) throw new Error(`start p2 → ${gen.status} ${JSON.stringify(gen.data)}`);
    await waitJob(novelId, { timeoutMs: 90000, jobId: gen.data.job.id });
    const items = await itemsOf(novelId, 'p2');
    const acts = items.items.filter((item) => item.kind === 'act');
    const beats = items.items.filter((item) => item.kind === 'beat');
    if (acts.length < 2) throw new Error(`幕数太少 ${acts.length}`);
    if (!beats.length) throw new Error('没有节拍');
    const edited = await patch(`/api/projects/${novelId}/items/${acts[0].id}`, { title: 'QA 改写的第一幕' });
    if (!edited.ok) throw new Error(`act PATCH → ${edited.status}`);
    const regen = await post(`/api/projects/${novelId}/stages/p2/feedback`, {
      scope: 'item', targetId: acts[1].id, note: '这一幕冲突不够，加一场对峙。',
    });
    if (regen.status !== 202) throw new Error(`item feedback → ${regen.status} ${JSON.stringify(regen.data)}`);
    await waitJob(novelId, { timeoutMs: 90000, jobId: regen.data.job.id });
    const after = await itemsOf(novelId, 'p2');
    const stillEdited = after.items.find((item) => item.id === acts[0].id);
    if (stillEdited.title !== 'QA 改写的第一幕') throw new Error('重生成把人工改过的幕标题冲掉了');
    const confirm = await post(`/api/projects/${novelId}/stages/p2/confirm`);
    if (!confirm.ok) {
      const stagesNow = (await snapshot(novelId)).stages;
      // 已知缺陷复现路径：单条重生成把 P1 打回 review → P2 永远确认不了。
      // 这里记录缺陷后走「重新确认 P1」的恢复路径，让 P3/P4 仍能被独立验证。
      const recover = await post(`/api/projects/${novelId}/stages/p1/confirm`);
      const retryConfirm = await post(`/api/projects/${novelId}/stages/p2/confirm`);
      record('B4', 'P2 大纲：生成幕与节拍 → 编辑 → 单条意见重生成 → 确认', 'failed',
        `单条意见重生成后 p2 confirm → ${confirm.status} ${JSON.stringify(confirm.data)}；此时阶段状态 ${JSON.stringify(Object.fromEntries(Object.entries(stagesNow).map(([k, v]) => [k, v.status])))}；恢复(重新确认p1)=${recover.status}，重试确认p2=${retryConfirm.status}`);
      defect('DEF-1', 'blocker', 'P2 单条「给 AI 提意见重生成」会把已确认的 P1 打回 review，导致 P2 无法确认',
        'software/src/server/pipeline/steps.ts:390（stageKey 回退 p1）+ steps.ts:420-431（recordItemRevision 改所属阶段状态）',
        `重生成 outline_acts/outline_beats 时 found.row.stage_key 不存在 → 回退 'p1'，于是 P1 被置为 review 并把下游标 stale；实测 p2 confirm → 409 STAGE_LOCKED「请先确认p1阶段」。同一根因还导致该条目的修订被归档到 p1 阶段（p2 的修订历史里查不到）。`,
        '1) 新建长篇并生成/确认 P1、P2；2) 对任意一幕调用 POST /api/projects/:id/stages/p2/feedback {scope:"item",targetId:actId,note:"…"}；3) POST /stages/p2/confirm → 409；4) GET /api/projects/:id/pipeline 看到 p1=review');
      const snapAfterRecovery = await snapshot(novelId);
      if (snapAfterRecovery.stages.p2.status !== 'confirmed') {
        throw new Error(`缺陷已复现且恢复失败：${confirm.status} ${JSON.stringify(confirm.data)}；恢复后 p2=${snapAfterRecovery.stages.p2.status}`);
      }
      return `幕 ${acts.length} / 节拍 ${beats.length}；人工改过的幕保留；但单条重生成把 P1 打回 review（已记 DEF-1），重新确认 P1 后 P2 可确认`;
    }
    const snap = await snapshot(novelId);
    if (snap.stages.p2.status !== 'confirmed') throw new Error(`p2 状态 ${snap.stages.p2.status}`);
    return `幕 ${acts.length} / 节拍 ${beats.length}；人工改过的幕在重生成后保留；p2=confirmed，nextStep=${snap.nextStep.kind}`;
  });

  await step('B5', 'P3 章节计划：函数/梗概/字数范围；字数分配两步（预览 + 应用）', async () => {
    const gen = await post(`/api/projects/${novelId}/pipeline/start`, { stage: 'p3' });
    if (gen.status !== 202) throw new Error(`start p3 → ${gen.status}`);
    await waitJob(novelId, { timeoutMs: 90000, jobId: gen.data.job.id });
    const units = await unitsOf(novelId);
    if (units.units.length < 2) throw new Error(`章节太少 ${units.units.length}`);
    for (const unit of units.units) {
      if (!unit.function || !unit.synopsis) throw new Error(`章节 ${unit.ordinal} 缺 function/synopsis`);
      if (!(unit.minWords > 0 && unit.minWords < unit.targetWords && unit.targetWords < unit.maxWords)) {
        throw new Error(`章节 ${unit.ordinal} 字数范围不合法 ${unit.minWords}/${unit.targetWords}/${unit.maxWords}`);
      }
    }
    // 分配预览（纯预览，不改库）
    const preview = await post(`/api/projects/${novelId}/stages/p3/units/allocate`, { totalTarget: 90000 });
    if (!preview.ok) throw new Error(`allocate preview → ${preview.status}`);
    const beforeApply = await unitsOf(novelId);
    if (beforeApply.units[0].targetWords !== units.units[0].targetWords) throw new Error('预览阶段就改了库（应纯预览）');
    const applied = await post(`/api/projects/${novelId}/stages/p3/units/allocate/apply`, { rows: preview.data.preview, includeEdited: false });
    if (!applied.ok) throw new Error(`allocate apply → ${applied.status} ${JSON.stringify(applied.data)}`);
    const afterApply = await unitsOf(novelId);
    const targetSum = afterApply.units.reduce((sum, unit) => sum + (unit.targetWords || 0), 0);
    if (Math.abs(targetSum - 90000) / 90000 > 0.25) throw new Error(`分配后 Σtarget=${targetSum} 偏离 90000 超过 ±25%`);
    // 手工改一行（必须落在 min/target/max 合法关系内）→ 再覆盖必须被拦（TARGET_EDITED）
    const one = afterApply.units[0];
    const manual = await patch(`/api/projects/${novelId}/stages/p3/units/${one.id}`, { targetWords: Number(one.minWords) + 10 });
    if (!manual.ok) throw new Error(`patch unit → ${manual.status} ${JSON.stringify(manual.data).slice(0, 200)}`);
    // 用「改之前取到的预览」再应用一次（这正是 UI 里 预览 → 手改一章 → 点确认应用 的顺序）
    const reApply = await post(`/api/projects/${novelId}/stages/p3/units/allocate/apply`, { rows: preview.data.preview, includeEdited: false });
    if (reApply.status !== 422 || reApply.data.code !== 'TARGET_EDITED') {
      const nowUnit = (await unitsOf(novelId)).units.find((unit) => unit.id === one.id);
      defect('DEF-4', 'medium', '「按目标分配」的保护依赖客户端传来的 manuallyEdited：旧预览/多标签页会静默覆盖人工改过的字数',
        'software/src/server/pipeline/actions.ts:644（blocked 只看 row.manuallyEdited，不回查 chapters.target_manual）',
        `人工把「${one.title}」目标字数改成 ${Number(one.minWords) + 10} 后，用改之前取的预览再应用一次 → ${reApply.status}${reApply.data.code ? ` ${reApply.data.code}` : ''}，该章目标字数变成 ${nowUnit?.targetWords}，没有 TARGET_EDITED 拦截。单页正常顺序（预览→手改→应用）在 UI 上实测是被拦住的（HTTP 422），所以只在「另一个标签页仍握着旧预览」或直接调接口时才会静默覆盖；但「是否手改」这种事实应由服务端回查 chapters.target_manual 决定，不能让客户端声明。`,
        '1) P3 调 /units/allocate 拿到 preview；2) 另一个标签页 PATCH 某章 targetWords；3) 用步骤 1 的 preview 调 /units/allocate/apply {includeEdited:false} → 200，手改被覆盖');
      throw new Error(`应 422 TARGET_EDITED，实际 ${reApply.status} ${reApply.data.code || ''}（已记 DEF-4）`);
    }
    return `章节 ${units.units.length}；预览不改库；apply 后 Σtarget=${targetSum}（±25% 内）；手改行再覆盖 → 422 TARGET_EDITED`;
  });

  await step('B6', 'P3 确认门槛：Σtarget 偏差超 ±25% 需显式接受才可确认', async () => {
    // 先让目标字数严重偏离：把总目标设得很小
    const allUnits = await unitsOf(novelId);
    const tiny = allUnits.units.map((unit) => ({
      unitId: unit.id, manuallyEdited: false,
      // 必须落在合法区间内（300 ≤ min ≤ target ≤ max ≤ 20000），否则会被「字数范围不合法」先拦
      targetWords: 320, minWords: 300, maxWords: 400,
    }));
    const applied = await post(`/api/projects/${novelId}/stages/p3/units/allocate/apply`, { rows: tiny, includeEdited: true });
    if (!applied.ok) throw new Error(`apply tiny → ${applied.status}`);
    const blocked = await post(`/api/projects/${novelId}/stages/p3/confirm`);
    if (blocked.status !== 422) throw new Error(`偏差超限应 422，实际 ${blocked.status} ${JSON.stringify(blocked.data).slice(0, 300)}`);
    const deviationBlocked = (blocked.data.blockers || []).some((text) => /总目标.*全书目标/.test(String(text)));
    if (!deviationBlocked) throw new Error(`拦截原因不是字数偏差：${JSON.stringify(blocked.data).slice(0, 300)}`);
    const accept = await post(`/api/projects/${novelId}/pipeline/accept-deviation`, { accepted: true });
    if (!accept.ok) throw new Error(`accept-deviation → ${accept.status}`);
    // 先把字数恢复成合理值再确认（编辑已确认阶段会按设计回落 review，所以必须在确认前做）
    const restore = await post(`/api/projects/${novelId}/stages/p3/units/allocate`, { totalTarget: 80000 });
    const restoreApply = await post(`/api/projects/${novelId}/stages/p3/units/allocate/apply`, { rows: restore.data.preview, includeEdited: true });
    if (!restoreApply.ok) throw new Error(`restore allocate → ${restoreApply.status}`);
    const confirm = await post(`/api/projects/${novelId}/stages/p3/confirm`);
    if (!confirm.ok) throw new Error(`接受偏差后仍无法确认：${confirm.status} ${JSON.stringify(confirm.data).slice(0, 300)}`);
    const snap = await snapshot(novelId);
    if (snap.stages.p3.status !== 'confirmed') throw new Error(`p3 状态 ${snap.stages.p3.status}`);
    return `偏差超限 confirm → 422（原因：${(blocked.data.blockers || []).find((text) => /总目标/.test(String(text))) || '字数偏差'}）；接受偏差+恢复合理字数后确认成功；p3=confirmed`;
  });

  await step('B7', 'P4 逐章生成：每章都写、字数落在范围内、只写目标章', async () => {
    const before = await unitsOf(novelId);
    const start = await post(`/api/projects/${novelId}/writing/start`, { mode: 'continuous' });
    if (start.status !== 202) throw new Error(`writing start → ${start.status} ${JSON.stringify(start.data)}`);
    const snap = await waitJob(novelId, { timeoutMs: 180000, jobId: start.data.job.id });
    const units = await unitsOf(novelId);
    const empty = units.units.filter((unit) => !unit.hasContent);
    if (empty.length) throw new Error(`${empty.length} 章没有正文：${empty.map((u) => u.ordinal).join(',')}`);
    const outOfRange = units.units.filter((unit) => unit.words < unit.minWords * 0.9 || unit.words > unit.maxWords * 1.1);
    if (outOfRange.length) throw new Error(`字数不在范围内的章：${outOfRange.map((u) => `#${u.ordinal} ${u.words}/${u.minWords}-${u.maxWords}`).join('; ')}`);
    if (units.units.length !== before.units.length) throw new Error('写作改变了章节数量');
    const allInReview = units.units.every((unit) => ['in_review', 'approved', 'changes_requested'].includes(unit.reviewStatus));
    if (!allInReview) throw new Error(`有章节没进入待审：${units.units.map((u) => `${u.ordinal}:${u.reviewStatus}`).join(',')}`);
    return `${units.units.length} 章全部有正文；字数全部落在 [min,max]；状态 ${units.units.map((u) => u.reviewStatus).join('/')}；job=${(snap.job || snap.lastJob).state}`;
  });

  await step('B8', '审阅：通过 / 退回（必须写意见）/ 重写单章不影响其他章 / 版本可恢复', async () => {
    const units = await unitsOf(novelId);
    const [first, second] = units.units;
    const approve = await post(`/api/chapters/${first.id}/review`, { action: 'approve' });
    if (!approve.ok) throw new Error(`approve → ${approve.status} ${JSON.stringify(approve.data)}`);
    const noNote = await post(`/api/chapters/${second.id}/review`, { action: 'request_changes' });
    if (noNote.status !== 422) throw new Error(`退回不写意见应 422，实际 ${noNote.status}`);
    const changes = await post(`/api/chapters/${second.id}/review`, { action: 'request_changes', note: '第二段节奏太慢' });
    if (!changes.ok) throw new Error(`request_changes → ${changes.status}`);
    // 重写单章
    const targetContent = (await projectDetail(novelId)).project.chapters.find((c) => c.id === second.id).content;
    const otherBefore = (await projectDetail(novelId)).project.chapters.filter((c) => c.id !== second.id).map((c) => `${c.id}:${c.content.length}`);
    // mock 是确定性的：重写会产出逐字节相同的内容 → createChapterVersion 去重、版本数不增。
    // 所以这里换成一个「每次内容都不同」的供应商，才能验证「重写单章」真的换了正文并留下版本。
    const varying = await createFakeProvider({ label: 'varying', mode: 'varying' });
    const varyingProvider = await addProvider('QA 变体供应商', varying.url, 'varying-model');
    await setDefaultModel({ providerId: varyingProvider.id, modelId: varyingProvider.modelId });
    const rewrite = await post(`/api/chapters/${second.id}/review`, { action: 'rewrite', note: '换一种更冷的写法' });
    if (rewrite.status !== 202) throw new Error(`rewrite → ${rewrite.status} ${JSON.stringify(rewrite.data)}`);
    await waitJob(novelId, { timeoutMs: 90000, jobId: rewrite.data.job.id });
    const detail = await projectDetail(novelId);
    const rewritten = detail.project.chapters.find((c) => c.id === second.id);
    if (!rewritten.content.trim()) throw new Error('重写后没有正文');
    if (rewritten.content === targetContent) throw new Error('重写单章没有改变正文（用户点重写等于没效果）');
    const otherAfter = detail.project.chapters.filter((c) => c.id !== second.id).map((c) => `${c.id}:${c.content.length}`);
    if (otherBefore.join('|') !== otherAfter.join('|')) throw new Error('重写单章改动了其他章');
    const versions = await okJson(`/api/projects/${novelId}/units/${second.id}/versions`);
    if (versions.versions.length < 2) throw new Error(`重写后版本应 ≥2，实际 ${versions.versions.length}`);
    const original = versions.versions.find((version) => version.content === targetContent);
    if (!original) throw new Error(`重写前的版本没有被保存（${versions.versions.length} 条，无一条等于原文）`);
    const restore = await post(`/api/projects/${novelId}/units/${second.id}/versions/${original.id}/restore`);
    if (!restore.ok) throw new Error(`version restore → ${restore.status} ${JSON.stringify(restore.data)}`);
    const restored = (await projectDetail(novelId)).project.chapters.find((c) => c.id === second.id);
    if (restored.content !== targetContent) throw new Error('版本恢复后正文与原版本不一致');
    const statuses = (await unitsOf(novelId)).units.map((u) => `${u.ordinal}:${u.reviewStatus}`);
    return `通过 #1；退回 #2 需意见（无意见 422）；单章重写只改目标章；版本 ${versions.versions.length} 条并可恢复；状态 ${statuses.join(',')}`;
  });

  await step('B9', 'P3 减章：有正文时不得静默丢正文（CONTENT_WOULD_BE_LOST）', async () => {
    const units = await unitsOf(novelId);
    const target = Math.max(1, units.units.length - 2);
    const res = await post(`/api/projects/${novelId}/stages/p3/units/count`, { count: target });
    if (res.status !== 422 || res.data.code !== 'CONTENT_WOULD_BE_LOST') {
      throw new Error(`有正文减章应 422 CONTENT_WOULD_BE_LOST，实际 ${res.status} ${res.data.code}`);
    }
    return `count ${units.units.length}→${target} → 422 ${res.data.code}`;
  });

  // ================= C. 短篇 =================
  let shortId = null;
  await step('C1', '短篇创建 + 企划：与长篇同一套阶段，但 plan 用节拍', async () => {
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    const created = await post('/api/projects', {
      title: 'QA 短篇', type: 'short', premise: '一个只在下雨天营业的修表铺。', targetWords: 8000, start: 'pipeline',
    });
    if (created.status !== 201) throw new Error(`short create → ${created.status} ${JSON.stringify(created.data)}`);
    shortId = created.data.project.id;
    const done = await waitJob(shortId, { timeoutMs: 60000, jobId: created.data.job.id });
    if (done.kind !== 'short') throw new Error(`kind 应 short，实际 ${done.kind}`);
    if (done.stages.p1.status !== 'review') throw new Error(`p1 状态 ${done.stages.p1.status}`);
    const detail = await projectDetail(shortId);
    if ((detail.project.chapters || []).length !== 0) throw new Error(`短篇不该有章节行，实际 ${detail.project.chapters.length}`);
    return `短篇 p1=${done.stages.p1.status}/${done.stages.p1.counts.items} 条；chapters 行 ${detail.project.chapters.length}`;
  });

  await step('C2', '短篇 P2 → P3：节拍计划而非章节，且不建空章节', async () => {
    await post(`/api/projects/${shortId}/stages/p1/confirm`);
    const p2 = await post(`/api/projects/${shortId}/pipeline/start`, { stage: 'p2' });
    if (p2.status !== 202) throw new Error(`p2 start → ${p2.status}`);
    await waitJob(shortId, { timeoutMs: 60000, jobId: p2.data.job.id });
    await post(`/api/projects/${shortId}/stages/p2/confirm`);
    const p3 = await post(`/api/projects/${shortId}/pipeline/start`, { stage: 'p3' });
    if (p3.status !== 202) throw new Error(`p3 start → ${p3.status} ${JSON.stringify(p3.data)}`);
    await waitJob(shortId, { timeoutMs: 60000, jobId: p3.data.job.id });
    const units = await unitsOf(shortId);
    if (!units.units.length) throw new Error('短篇没有节拍计划');
    const nonBeat = units.units.filter((unit) => unit.kind !== 'beat');
    if (nonBeat.length) throw new Error(`短篇出现非节拍单元：${nonBeat.map((u) => u.kind).join(',')}`);
    const detail = await projectDetail(shortId);
    if ((detail.project.chapters || []).length !== 0) throw new Error(`短篇在 P3 造出了 ${detail.project.chapters.length} 个空章节`);
    const snap = await snapshot(shortId);
    if (!/节拍/.test(snap.nextStep.label)) {
      defect('DEF-5', 'low', '短篇的「下一步」文案仍写「检查章节字数并确认」，没有按短篇词表换成「节拍」',
        'software/src/server/pipeline/snapshot.ts:218',
        `短篇 nextStep.label = "${snap.nextStep.label}"；UX-SPEC §8 要求短篇一切「章」字走 unitLabel()。前端虽另有 unitLabel 处理，但服务端下发的文案会原样出现在「下一步」卡片上。`,
        '新建短篇 → 生成 P3 后 GET /api/projects/:id/pipeline → nextStep.label');
      throw new Error(`短篇 nextStep 文案没用「节拍」：${snap.nextStep.label}`);
    }
    return `节拍 ${units.units.length} 个，全部 kind=beat；chapters 行 0；nextStep="${snap.nextStep.label}"`;
  });

  await step('C3', '短篇 P4：逐节拍写作、审阅，全程无章节行', async () => {
    const confirm = await post(`/api/projects/${shortId}/stages/p3/confirm`);
    if (!confirm.ok) throw new Error(`p3 confirm → ${confirm.status} ${JSON.stringify(confirm.data)}`);
    const start = await post(`/api/projects/${shortId}/writing/start`, { mode: 'continuous' });
    if (start.status !== 202) throw new Error(`writing start → ${start.status} ${JSON.stringify(start.data)}`);
    await waitJob(shortId, { timeoutMs: 120000, jobId: start.data.job.id });
    const units = await unitsOf(shortId);
    const empty = units.units.filter((unit) => !unit.hasContent);
    if (empty.length) throw new Error(`${empty.length} 个节拍没有正文`);
    const detail = await projectDetail(shortId);
    if ((detail.project.chapters || []).length !== 0) throw new Error(`短篇写作后出现了 ${detail.project.chapters.length} 个章节`);
    const beat = units.units[0];
    const review = await post(`/api/chapters/${beat.id}/review`, { action: 'manual_approve' });
    if (!review.ok) {
      const snapNow = await snapshot(shortId);
      defect('DEF-2', 'blocker', '短篇的逐节拍审阅走不通：D5 唯一写入口只查 chapters 表，节拍 id 直接 404',
        'software/src/server/pipeline/routes.ts:352（oneRow 查 chapters）',
        `4 个节拍全部 in_review，但 POST /api/chapters/:id/review → ${review.status} ${JSON.stringify(review.data)}；快照 nextStep=${snapNow.nextStep.kind}「${snapNow.nextStep.label}」会把用户带到写作台，而短篇在 chapters 表里 0 行，写作台没有可审的内容。短篇因此没有 REVIEW 闭环（长篇不受影响，长篇的 unit 就是 chapters 行）。`,
        '1) 新建短篇 → 生成并确认 P1/P2/P3；2) 连续写作写完；3) 取 /api/projects/:id/units 里任一 kind=beat 的 id；4) POST /api/chapters/<该id>/review {action:"approve"} → 404 NOT_FOUND「找不到这一章」');
      throw new Error(`短篇审阅 → ${review.status} ${JSON.stringify(review.data)}（已记 DEF-2）`);
    }
    const after = await unitsOf(shortId);
    if (after.units[0].reviewStatus !== 'approved_manual') throw new Error(`审阅状态 ${after.units[0].reviewStatus}`);
    return `${units.units.length} 个节拍全部有正文；chapters 行 0；人工通过后状态 approved_manual`;
  });

  // ================= D. 长任务 =================
  let pauseProjectId = null;
  const slowWrite = await createFakeProvider({ delayMs: 2500, label: 'slow-write' });
  await step('D1', '暂停（D4）：≤2s 受理（pausing + pausePending）→ 当前章写完落库 → 落定 paused', async () => {
    const provider = await addProvider('QA 慢写作供应商', slowWrite.url, 'slow-write-model');
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    const created = await post('/api/projects', {
      title: 'QA 长任务', type: 'novel', premise: '测试暂停', targetWords: 30000, start: 'pipeline',
    });
    pauseProjectId = created.data.project.id;
    await waitJob(pauseProjectId, { timeoutMs: 60000, jobId: created.data.job.id });
    const c1 = await post(`/api/projects/${pauseProjectId}/stages/p1/confirm`);
    if (!c1.ok) throw new Error(`p1 confirm → ${c1.status} ${JSON.stringify(c1.data).slice(0, 200)}`);
    const g2 = await post(`/api/projects/${pauseProjectId}/pipeline/start`, { stage: 'p2' });
    if (g2.status !== 202) throw new Error(`p2 start → ${g2.status}`);
    await waitJob(pauseProjectId, { timeoutMs: 60000, jobId: g2.data.job.id });
    const c2 = await post(`/api/projects/${pauseProjectId}/stages/p2/confirm`);
    if (!c2.ok) throw new Error(`p2 confirm → ${c2.status} ${JSON.stringify(c2.data).slice(0, 200)}`);
    const g3 = await post(`/api/projects/${pauseProjectId}/pipeline/start`, { stage: 'p3' });
    if (g3.status !== 202) throw new Error(`p3 start → ${g3.status}`);
    await waitJob(pauseProjectId, { timeoutMs: 60000, jobId: g3.data.job.id });
    const alloc = await post(`/api/projects/${pauseProjectId}/stages/p3/units/allocate`, { totalTarget: 30000 });
    if (alloc.ok) await post(`/api/projects/${pauseProjectId}/stages/p3/units/allocate/apply`, { rows: alloc.data.preview, includeEdited: true });
    const c3 = await post(`/api/projects/${pauseProjectId}/stages/p3/confirm`);
    if (!c3.ok) throw new Error(`p3 confirm → ${c3.status} ${JSON.stringify(c3.data).slice(0, 300)}`);
    await setDefaultModel({ providerId: provider.id, modelId: provider.modelId });
    const start = await post(`/api/projects/${pauseProjectId}/writing/start`, { mode: 'continuous' });
    if (start.status !== 202) throw new Error(`writing start → ${start.status} ${JSON.stringify(start.data)}`);
    let generating = null;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const units = await unitsOf(pauseProjectId);
      const hit = units.units.find((unit) => unit.reviewStatus === 'generating');
      if (hit) { generating = hit; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!generating) throw new Error('40s 内没有章节进入 generating');
    await new Promise((r) => setTimeout(r, 400));
    const tPause = Date.now();
    const pause = await post(`/api/projects/${pauseProjectId}/writing/pause`);
    if (![200, 202].includes(pause.status)) throw new Error(`pause → ${pause.status} ${JSON.stringify(pause.data)}`);
    // 1) 受理必须有反馈：≤2s 进入 pausing 且 pausePending=true
    let pausing = null;
    while (Date.now() - tPause < 2000) {
      const snap = await snapshot(pauseProjectId);
      const job = snap.job || snap.lastJob;
      if (job && job.state === 'pausing' && job.pausePending) { pausing = { ms: Date.now() - tPause, job }; break; }
      await new Promise((r) => setTimeout(r, 60));
    }
    if (!pausing) {
      const snap = await snapshot(pauseProjectId);
      const job = snap.job || snap.lastJob;
      throw new Error(`暂停后 2s 内没有进入 pausing（state=${job?.state} pausePending=${job?.pausePending}）`);
    }
    // 2) D4：写完当前章才停 → 落定 paused，且那一章有正文
    let settled = null;
    const settleDeadline = Date.now() + 30000;
    while (Date.now() < settleDeadline) {
      const snap = await snapshot(pauseProjectId);
      const job = snap.job || snap.lastJob;
      if (job && job.state === 'paused') { settled = { snap, job, ms: Date.now() - tPause }; break; }
      if (job && ['failed', 'cancelled'].includes(job.state)) throw new Error(`暂停异常终止：state=${job.state} error=${JSON.stringify(job.error)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!settled) throw new Error('暂停后 30s 仍未落定 paused');
    const units = await unitsOf(pauseProjectId);
    const target = units.units.find((unit) => unit.id === generating.id);
    if (!target) throw new Error('正在写的那一章不见了');
    if (target.reviewStatus === 'generating') throw new Error('暂停后当前章仍停在 generating');
    if (!target.hasContent) throw new Error(`暂停丢掉了正在写的第 ${generating.ordinal} 章（D4 要求写完本章再停）`);
    if (units.units.some((unit) => unit.reviewStatus === 'generating')) throw new Error('暂停后还有章节停在 generating');
    if (settled.snap.nextStep?.kind !== 'resume-writing') throw new Error(`paused 后 nextStep 应为 resume-writing，实际 ${settled.snap.nextStep?.kind}`);
    return `暂停受理 ${pausing.ms}ms（state=pausing, pausePending=true）→ 当前章写完落库 ${settled.ms}ms → state=paused；该章 ${target.words ?? 0} 字；nextStep=resume-writing`;
  });

  await step('D2', '暂停后「继续写作」可用：从下一个待写单元续写，已写内容逐字节不变', async () => {
    const before = await projectDetail(pauseProjectId);
    const contentBefore = new Map(before.project.chapters.filter((c) => c.content).map((c) => [c.id, c.content]));
    const doneBefore = contentBefore.size;
    const cont = await post(`/api/projects/${pauseProjectId}/writing/continue`);
    if (cont.status === 400) {
      defect('DEF-6', 'high', '暂停后 /writing/continue 返回 400：暂停不可继续（D4 要求可继续）（DEF-6 回归）',
        'software/src/server/pipeline/actions.ts:280-297（continueWriting 只认 stop_mode=pause 的 cancelled job）',
        `POST /writing/pause 之后 POST /writing/continue → 400 ${JSON.stringify(cont.data)}：暂停被当成了用户取消。`,
        '1) 慢供应商写作中点暂停；2) 等 job 落定 paused；3) POST /writing/continue → 400');
      throw new Error(`POST /writing/continue → 400 ${JSON.stringify(cont.data)}`);
    }
    if (cont.status !== 202) throw new Error(`continue → ${cont.status} ${JSON.stringify(cont.data)}`);
    const resumedJob = cont.data.job;
    let grew = doneBefore;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const units = await unitsOf(pauseProjectId);
      grew = units.units.filter((unit) => unit.hasContent).length;
      if (grew > doneBefore) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const stop = await post(`/api/projects/${pauseProjectId}/writing/stop`, { confirm: true });
    if (![200, 202].includes(stop.status)) throw new Error(`stop → ${stop.status} ${JSON.stringify(stop.data)}`);
    const after = await projectDetail(pauseProjectId);
    for (const [id, content] of contentBefore) {
      const now = after.project.chapters.find((c) => c.id === id);
      if (!now || now.content !== content) throw new Error(`继续写作改动了已写章节 ${id}`);
    }
    if (grew <= doneBefore) throw new Error(`continue 后没有新章写完（${doneBefore} → ${grew}）`);
    return `continue → 202（续写 ${resumedJob.unitsTotal} 个单元）；已写 ${doneBefore} → ${grew} 章；已写内容逐字节不变`;
  });

  await step('D4', '立即停止（D4）：≤2s 丢弃当前章、不留半截正文；停止后不能 continue 但可重新开始', async () => {
    const start = await post(`/api/projects/${pauseProjectId}/writing/start`, { mode: 'continuous' });
    if (start.status !== 202) throw new Error(`重新开始写作 → ${start.status} ${JSON.stringify(start.data)}`);
    let generating = null;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const units = await unitsOf(pauseProjectId);
      const hit = units.units.find((unit) => unit.reviewStatus === 'generating');
      if (hit) { generating = hit; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!generating) throw new Error('40s 内没有章节进入 generating');
    await new Promise((r) => setTimeout(r, 400));
    const tStop = Date.now();
    const stop = await post(`/api/projects/${pauseProjectId}/writing/stop`, { confirm: true });
    if (![200, 202].includes(stop.status)) throw new Error(`stop → ${stop.status} ${JSON.stringify(stop.data)}`);
    let stopped = null;
    while (Date.now() - tStop < 5000) {
      const snap = await snapshot(pauseProjectId);
      const job = snap.job || snap.lastJob;
      if (job && !['queued', 'running', 'pausing'].includes(job.state)) { stopped = { snap, job, ms: Date.now() - tStop }; break; }
      await new Promise((r) => setTimeout(r, 60));
    }
    if (!stopped) throw new Error('停止后 5s 仍未终止');
    if (stopped.ms > 2000) throw new Error(`停止耗时 ${stopped.ms}ms（要求 ≤2s）`);
    if (stopped.job.state !== 'cancelled') throw new Error(`停止后 state=${stopped.job.state}（应 cancelled）`);
    const units = await unitsOf(pauseProjectId);
    const target = units.units.find((unit) => unit.id === generating.id);
    if (!target) throw new Error('正在写的那一章不见了');
    if (target.hasContent) throw new Error(`立即停止应丢弃当前章正文，但第 ${generating.ordinal} 章有正文`);
    if (target.reviewStatus === 'generating') throw new Error('停止后当前章仍停在 generating');
    const cont = await post(`/api/projects/${pauseProjectId}/writing/continue`);
    if (cont.status !== 400) throw new Error(`停止后 continue 应 400，实际 ${cont.status}`);
    const restart = await post(`/api/projects/${pauseProjectId}/writing/start`, { mode: 'continuous' });
    if (restart.status !== 202) throw new Error(`停止后不能重新开始：${restart.status} ${JSON.stringify(restart.data)}`);
    await post(`/api/projects/${pauseProjectId}/writing/stop`, { confirm: true }).catch(() => {});
    return `停止 ${stopped.ms}ms 生效（state=cancelled）；当前章正文已丢弃；continue → 400；重新开始 → 202（有出路）`;
  });

  await step('D3', '刷新/重启：进程被 kill 后 job=interrupted，retry 从断点续写且已写章节逐字节不变', async () => {
    // 仍在 D1 的慢供应商下继续写，写满至少两章后 kill
    const start = await post(`/api/projects/${pauseProjectId}/writing/start`, { mode: 'continuous' });
    if (start.status !== 202) throw new Error(`writing start → ${start.status} ${JSON.stringify(start.data)}`);
    // 等到至少 1 章写完整
    let wroteOne = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const units = await unitsOf(pauseProjectId);
      if (units.units.filter((unit) => unit.hasContent).length >= 2) { wroteOne = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!wroteOne) throw new Error('60s 内没写满 2 章，无法制造中断');
    const beforeKill = await projectDetail(pauseProjectId);
    const contentBefore = new Map(beforeKill.project.chapters.map((c) => [c.id, c.content]));
    await stopServer('SIGKILL');
    await startServer();
    const recovered = await snapshot(pauseProjectId);
    const jobAfter = recovered.job || recovered.lastJob;
    if (!jobAfter || jobAfter.state !== 'interrupted') throw new Error(`重启后 job 应 interrupted，实际 ${jobAfter?.state}`);
    if (recovered.stages.p4.status === 'generating') throw new Error('重启后阶段还停在 generating');
    const afterRestart = await projectDetail(pauseProjectId);
    let changed = 0;
    for (const chapter of afterRestart.project.chapters) {
      const before = contentBefore.get(chapter.id);
      if (before !== undefined && before !== chapter.content) changed += 1;
    }
    if (changed) throw new Error(`重启改了 ${changed} 章已写正文`);
    // 继续：retry 从第一个 pending 续写
    const retry = await post(`/api/projects/${pauseProjectId}/jobs/${jobAfter.id}/retry`);
    if (![200, 202].includes(retry.status)) throw new Error(`retry interrupted → ${retry.status} ${JSON.stringify(retry.data)}`);
    await post(`/api/projects/${pauseProjectId}/writing/stop`, { confirm: true }).catch(() => {});
    const afterRetry = await projectDetail(pauseProjectId);
    const keptAll = afterRestart.project.chapters.every((chapter) => afterRetry.project.chapters.some((c) => c.id === chapter.id && c.content === chapter.content));
    if (!keptAll) throw new Error('retry 后已写章节被改动');
    return `kill 后 job=interrupted；已写 ${contentBefore.size} 章逐字节不变；retry → ${retry.status} 且保留全部已写内容`;
  });

  // ================= E. 迁移 =================
  let legacyId = null;
  const legacyText = '第一章正文，迁移前后必须逐字节一致。\n\n第二段也不能少。\n\n第三段：引号「」与 emoji 🐟 都要保留。';
  let legacyVersionsBefore = 0;
  await step('E1', '旧项目夹具：正文 + 版本 + 人物 + 大纲', async () => {
    const created = await post('/api/projects', { title: 'QA 旧项目', type: 'novel', genre: '悬疑', description: '旧项目一句话' });
    if (created.status !== 201) throw new Error(`legacy create → ${created.status} ${JSON.stringify(created.data)}`);
    legacyId = created.data.project.id;
    const chapterId = created.data.project.chapters[0].id;
    const saved = await patch(`/api/chapters/${chapterId}`, { content: legacyText });
    if (!saved.ok) throw new Error(`save chapter → ${saved.status}`);
    const version = await post(`/api/chapters/${chapterId}/versions`, { source: '迁移前快照' });
    if (!version.ok) throw new Error(`create version → ${version.status}`);
    const character = await post(`/api/projects/${legacyId}/characters`, { name: '旧人物', role: '主角', motivation: '找回记忆' });
    if (!character.ok) throw new Error(`create character → ${character.status}`);
    const detail = await projectDetail(legacyId);
    const versions = await okJson(`/api/projects/${legacyId}/versions`);
    legacyVersionsBefore = versions.versions.length;
    if (detail.project.chapters[0].content !== legacyText) throw new Error('夹具正文没写进去');
    if ((detail.project.outline?.acts || []).length < 1) throw new Error('夹具没有幕');
    return `legacy=${legacyId}，正文 ${legacyText.length} 字，版本 ${legacyVersionsBefore} 条，人物 ${detail.project.characters.length} 个，幕 ${detail.project.outline.acts.length}`;
  });

  await step('E2', '升级到流水线：九条校验全过、正文逐字节不变、P3 不被自动确认', async () => {
    const before = await projectDetail(legacyId);
    const res = await post(`/api/projects/${legacyId}/migrate`);
    if (!res.ok) throw new Error(`migrate → ${res.status} ${JSON.stringify(res.data)}`);
    const migration = res.data.migration;
    if (migration.state !== 'done') throw new Error(`迁移状态 ${migration.state}`);
    const failedChecks = (migration.checks || []).filter((check) => !check.ok);
    if (failedChecks.length) throw new Error(`校验未过：${failedChecks.map((c) => `${c.id}:${c.detail}`).join('; ')}`);
    if (!migration.backupPath) throw new Error('没有备份路径');
    if (!fs.existsSync(migration.backupPath)) throw new Error(`备份文件不存在：${migration.backupPath}`);
    const after = await projectDetail(legacyId);
    if (after.project.chapters[0].content !== legacyText) throw new Error('迁移改了正文');
    if (after.project.chapters[0].words !== before.project.chapters[0].words) throw new Error('迁移重算了字数');
    if (after.project.characters.length !== before.project.characters.length) throw new Error('人物数量变了');
    if (after.project.outline.acts.length !== before.project.outline.acts.length) throw new Error('幕数量变了');
    const versions = await okJson(`/api/projects/${legacyId}/versions`);
    if (versions.versions.length !== legacyVersionsBefore) throw new Error(`版本数 ${legacyVersionsBefore} → ${versions.versions.length}`);
    const snap = await snapshot(legacyId);
    if (snap.project.pipelineStatus === 'legacy') throw new Error('迁移后仍是 legacy');
    if (snap.stages.p1.status !== 'confirmed') throw new Error(`p1 应 confirmed，实际 ${snap.stages.p1.status}`);
    if (snap.stages.p3.status === 'confirmed') throw new Error('P3 被自动确认了（不允许）');
    return `checks=${migration.checks.length} 全过；备份=${path.basename(migration.backupPath)}；正文逐字节一致；版本 ${versions.versions.length}；p1=confirmed / p3=${snap.stages.p3.status}`;
  });

  await step('E3', '迁移可重入 + 回退后正文与版本仍可读 + 可再迁移', async () => {
    const again = await post(`/api/projects/${legacyId}/migrate`);
    if (!again.ok || !again.data.migration.alreadyMigrated) throw new Error(`二次迁移应 alreadyMigrated，实际 ${JSON.stringify(again.data).slice(0, 200)}`);
    const rollback = await post(`/api/projects/${legacyId}/migrate/rollback`, { mode: 'sql', confirm: true });
    if (!rollback.ok) throw new Error(`rollback → ${rollback.status} ${JSON.stringify(rollback.data)}`);
    if (rollback.data.migration.state !== 'rolled_back') throw new Error(`回退状态 ${rollback.data.migration.state}`);
    const afterRollback = await projectDetail(legacyId);
    if (afterRollback.project.chapters[0].content !== legacyText) throw new Error('回退后正文不同');
    const versions = await okJson(`/api/projects/${legacyId}/versions`);
    if (versions.versions.length !== legacyVersionsBefore) throw new Error(`回退后版本数 ${versions.versions.length}`);
    if ((await snapshot(legacyId)).project.pipelineStatus !== 'legacy') throw new Error('回退后 pipelineStatus 不是 legacy');
    const remigrate = await post(`/api/projects/${legacyId}/migrate`);
    if (!remigrate.ok || remigrate.data.migration.state !== 'done') throw new Error(`回退后再迁移失败：${JSON.stringify(remigrate.data).slice(0, 200)}`);
    return `二次迁移 alreadyMigrated；回退后正文/版本不变（${versions.versions.length} 条）；再迁移 done`;
  });

  await step('E4', '迁移失败：有明确提示、旧数据仍可打开、失败后可重试成功', async () => {
    const created = await post('/api/projects', { title: 'QA 迁移失败', type: 'novel', description: '失败也要能读' });
    const failingId = created.data.project.id;
    const chapterId = created.data.project.chapters[0].id;
    await patch(`/api/chapters/${chapterId}`, { content: '失败也要能读' });
    const failed = await post(`/api/projects/${failingId}/migrate`, { forceFail: true });
    if (failed.status !== 500) throw new Error(`强制失败应 500，实际 ${failed.status} ${JSON.stringify(failed.data)}`);
    if (!['MIGRATION_FAILED', 'MIGRATION_CHECK_FAILED'].includes(failed.data.code)) {
      throw new Error(`错误码应 MIGRATION_FAILED/MIGRATION_CHECK_FAILED，实际 ${failed.data.code}`);
    }
    const view = await okJson(`/api/projects/${failingId}/migration`);
    if (view.migration.state !== 'failed') throw new Error(`迁移记录状态 ${view.migration.state}`);
    if (!view.migration.error) throw new Error('失败没有留下原因');
    const detail = await projectDetail(failingId);
    if (detail.project.chapters[0].content !== '失败也要能读') throw new Error('失败后正文读不到');
    const retry = await post(`/api/projects/${failingId}/migrate`);
    if (!retry.ok || retry.data.migration.state !== 'done') throw new Error(`失败后重试应成功，实际 ${JSON.stringify(retry.data).slice(0, 200)}`);
    return `forceFail → 500 ${failed.data.code}；migration.state=failed 且有 error；旧正文仍可读；重试 → done`;
  });

  // ================= F. 配置门禁 / 不静默 mock =================
  await step('F1', '无默认模型：precheck 与创建都明确报错，且不落空壳', async () => {
    await setDefaultModel(null);
    const pre = await okJson('/api/pipeline/precheck');
    if (pre.ok || pre.code !== 'NO_DEFAULT_MODEL') throw new Error(`precheck 应 NO_DEFAULT_MODEL，实际 ${JSON.stringify(pre)}`);
    const countBefore = await projectCount();
    const created = await post('/api/projects', { title: '不该被创建', type: 'novel', start: 'pipeline' });
    if (created.status !== 422 || created.data.code !== 'NO_DEFAULT_MODEL') {
      throw new Error(`创建应 422 NO_DEFAULT_MODEL，实际 ${created.status} ${JSON.stringify(created.data)}`);
    }
    const countAfter = await projectCount();
    if (countAfter !== countBefore) throw new Error(`拦截后作品数 ${countBefore} → ${countAfter}（留下空壳）`);
    return `precheck=${pre.code}；create → 422 ${created.data.code}；作品数不变 ${countBefore}`;
  });

  await step('F2', '无 API Key：明确报错且不落空壳', async () => {
    const created = await post('/api/providers', {
      name: 'QA 无 Key 供应商', kind: 'openai', baseUrl: 'https://api.example.invalid/v1',
      models: [{ id: 'nokey-model' }], enabledModels: ['nokey-model'],
    });
    const id = created.data.provider.id;
    await patch(`/api/providers/${id}`, { enabled: true });
    await setDefaultModel({ providerId: id, modelId: 'nokey-model' });
    const pre = await okJson('/api/pipeline/precheck');
    if (pre.ok || pre.code !== 'NO_API_KEY') throw new Error(`precheck 应 NO_API_KEY，实际 ${JSON.stringify(pre)}`);
    const countBefore = await projectCount();
    const blocked = await post('/api/projects', { title: '无 Key 也不该创建', type: 'novel', start: 'pipeline' });
    if (blocked.status !== 422 || blocked.data.code !== 'NO_API_KEY') throw new Error(`创建应 422 NO_API_KEY，实际 ${blocked.status} ${JSON.stringify(blocked.data)}`);
    if ((await projectCount()) !== countBefore) throw new Error('拦截后仍创建了作品');
    return `precheck=${pre.code}；create → 422 ${blocked.data.code}；作品数不变`;
  });

  await step('F3', '绝不静默 mock：真实供应商失败时不产出任何正文（含 mock 特征文本）', async () => {
    const broken = await addProvider('QA 静默 mock 探测', 'http://127.0.0.1:59998/v1', 'ghost-model');
    await setDefaultModel({ providerId: broken.id, modelId: broken.modelId });
    const created = await post('/api/projects', { title: 'QA 不静默 mock', type: 'novel', start: 'pipeline' });
    const projectId = created.data.project.id;
    const snap = await waitJob(projectId, { timeoutMs: 120000, jobId: created.data.job.id });
    const job = snap.lastJob;
    if (job.state !== 'failed') throw new Error(`job 应 failed，实际 ${job.state}`);
    const detail = await projectDetail(projectId);
    const allText = JSON.stringify(detail.project);
    if (allText.includes(MOCK_SIGNATURE)) throw new Error('失败路径产出了 mock 特征文本（静默 mock）');
    if ((detail.project.chapters || []).some((chapter) => String(chapter.content || '').trim())) throw new Error('失败却写了正文');
    const items = await itemsOf(projectId, 'p1');
    if (items.items.length) throw new Error('失败却写了设定');
    // 明确选择 mock 时必须能用（证明 mock 是「显式选择」，不是兜底）
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    const mockCreated = await post('/api/projects', { title: 'QA 显式 mock', type: 'novel', start: 'pipeline' });
    if (mockCreated.status !== 201) throw new Error(`显式 mock 创建 → ${mockCreated.status}`);
    await waitJob(mockCreated.data.project.id, { timeoutMs: 60000, jobId: mockCreated.data.job.id });
    const mockItems = await itemsOf(mockCreated.data.project.id, 'p1');
    if (!mockItems.items.length) throw new Error('显式 mock 供应商也无法生成（mock 通道坏了）');
    return `真实供应商失败 → 无任何 mock 文本/正文/设定；显式 mock → 正常生成 ${mockItems.items.length} 条`;
  });

  // ================= G. 幂等与并发 =================
  await step('G1', '创建幂等：同 Idempotency-Key 只建一个作品', async () => {
    await setDefaultModel({ providerId: 'mock', modelId: 'mock-writer' });
    const key = `qa-idem-${Date.now()}`;
    const countBefore = await projectCount();
    const first = await api('/api/projects', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ title: 'QA 幂等', type: 'novel', start: 'pipeline' }),
    });
    const second = await api('/api/projects', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ title: 'QA 幂等', type: 'novel', start: 'pipeline' }),
    });
    if (first.status !== 201) throw new Error(`首次创建 ${first.status}`);
    if (second.status !== 200) throw new Error(`重放应 200，实际 ${second.status}`);
    if (first.data.project.id !== second.data.project.id) throw new Error('重放返回了不同作品');
    if ((await projectCount()) !== countBefore + 1) throw new Error('重放多建了作品');
    await post('/api/jobs/' + (first.data.job?.id || '') + '/cancel', { mode: 'stop' }).catch(() => {});
    return `201 → 200，同一 project=${first.data.project.id}，作品数 +1`;
  });

  await step('G2', '并发保护：单作品同时只能有一个生成任务', async () => {
    const slow = await createFakeProvider({ delayMs: 3000, label: 'concurrent' });
    const provider = await addProvider('QA 并发供应商', slow.url, 'concurrent-model');
    await setDefaultModel({ providerId: provider.id, modelId: provider.modelId });
    const created = await post('/api/projects', { title: 'QA 并发', type: 'novel', start: 'pipeline' });
    const projectId = created.data.project.id;
    await new Promise((r) => setTimeout(r, 800));
    const second = await post(`/api/projects/${projectId}/pipeline/start`, { stage: 'p1' });
    if (second.status !== 409 || second.data.code !== 'CONCURRENT_JOB') {
      throw new Error(`并发应 409 CONCURRENT_JOB，实际 ${second.status} ${JSON.stringify(second.data).slice(0, 200)}`);
    }
    await post(`/api/jobs/${created.data.job.id}/cancel`, { mode: 'stop' });
    slow.server.close();
    return `第二次启动 → 409 ${second.data.code}`;
  });

  // ================= 清理 =================
  console.log('\n--- 汇总 ---');
  const passed = results.filter((item) => item.status === 'passed').length;
  const failed = results.filter((item) => item.status === 'failed').length;
  console.log(`通过 ${passed} / ${results.length}，失败 ${failed}，缺陷 ${defects.length}`);

  const outFile = path.join(evidenceDir, 'qa-api-results.json');
  fs.writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), port: PORT, dataDir, results, defects }, null, 2));
  console.log(`结果写入 ${outFile}`);
  console.log(`服务端日志 ${logFile}`);
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error('\nQA E2E 脚本异常终止：', error);
  console.error('--- server stderr (tail) ---');
  console.error(stderr.slice(-4000));
  exitCode = 1;
} finally {
  await stopServer('SIGTERM');
  if (results.some((item) => item.status === 'failed')) exitCode = 1;
  process.exit(exitCode);
}
