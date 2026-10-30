/**
 * t25 探针 v6：N8 崩溃中断写 partialAt
 * 做法：p1 用 mock 快速生成并确认 → 切默认模型到「慢的假 OpenAI 兼容供应商」（每步 900ms，返回合法 acts/beats JSON）
 *      → 重建 P2 → 观察到 step_index>=1（正在跑 beats 步）→ SIGKILL → 重启 → 断言 stages.p2.partialAt 非空
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const PORT = Number(process.env.PORT || 8846);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 't25-probe6-'));
const logFile = '/tmp/t25-probe6-server.log';
fs.writeFileSync(logFile, '');
let server = null;
let stderr = '';
const out = [];
const log = (label, value) => { out.push({ label, value }); console.log(`### ${label}: ${JSON.stringify(value)}`); };

function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd, env: { ...process.env, PORT: String(PORT), PW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => fs.appendFileSync(logFile, String(d)));
  server.stderr.on('data', (d) => { stderr += String(d); fs.appendFileSync(logFile, String(d)); });
  return waitForServer();
}
async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`server did not start\n${stderr.slice(-2000)}`);
}
async function stopServer(signal = 'SIGTERM') {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill(signal);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
}
async function api(p, options = {}) {
  const res = await fetch(`${base}${p}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data, ok: res.ok };
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body ?? {}) });
const snap = async (id) => (await api(`/api/projects/${id}/pipeline`)).data;
const waitIdle = async (id) => { for (let i = 0; i < 3000; i += 1) { const s = await snap(id); if (!['queued', 'running', 'pausing'].includes(s.job?.state)) return s; await new Promise((r) => setTimeout(r, 100)); } return snap(id); };

const ACTS = { acts: [
  { title: '第一幕 停电', function: '钩子', summary: '停电夜，守灵人接到一通自称来自死者的电话，犹豫后还是出了门。', characters: [] },
  { title: '第二幕 旧账', function: '推进', summary: '他顺着电话里的线索找到二十年前的账本，发现父亲的名字被涂改过。', characters: [] },
] };
const BEATS = { beats: [
  { title: '守灵夜', function: '钩子', summary: '灵堂的灯泡忽明忽暗，他在供桌下摸到一部不属于任何人的手机。', plannedChapters: 2, foreshadow: '手机外壳上刻着父亲的名字' },
  { title: '第二通电话', function: '转折', summary: '电话第二次响起，对方叫出了只有父亲才会叫的小名。', plannedChapters: 2, foreshadow: '' },
] };

function slowProvider(delayMs) {
  const s = http.createServer((req, res) => {
    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'slow-model', object: 'model' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      setTimeout(() => {
        if (res.writableEnded) return;
        const wantsBeats = body.includes('"beats"');
        const wantsActs = body.includes('"acts"');
        const payload = wantsBeats ? BEATS : wantsActs ? ACTS : { text: '夜里下了很久的雨。' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' }] }));
      }, delayMs);
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}/v1` })));
}

async function main() {
  await startServer();
  await post('/api/onboarding', { name: 't25 N8', signature: 't25', providerId: 'mock', apiKey: '', modelId: 'mock-writer' });
  const created = await post('/api/projects', { title: 't25 N8c', type: 'novel', premise: '停电夜守灵的人接到一通电话。', targetWords: 30000, start: 'pipeline' });
  const id = created.data?.project?.id;
  let s = await waitIdle(id);
  log('N8c-1 p1 (mock)', { status: created.status, p1: s.stages?.p1?.status, items: s.stages?.p1?.counts?.items });
  log('N8c-2 confirm p1', { status: (await post(`/api/projects/${id}/stages/p1/confirm`, {})).status });

  const slow = await slowProvider(900);
  const prov = await post('/api/providers', { name: 't25 slow', kind: 'openai', baseUrl: slow.url, apiKey: 'sk-t25', models: [{ id: 'slow-model', name: 'slow-model', ctx: 'x', tags: ['OpenAI 兼容'] }], enabledModels: ['slow-model'] });
  const providerId = prov.data?.provider?.id;
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId, modelId: 'slow-model' } }) });
  log('N8c-3 default model', (await api('/api/pipeline/precheck')).data);

  const regen = await post(`/api/projects/${id}/stages/p2/regenerate`, { scope: 'all', confirmOverwrite: true });
  log('N8c-4 regen p2 (slow)', { status: regen.status, code: regen.data?.code });
  let saw = null;
  const t0 = Date.now();
  for (let i = 0; i < 4000; i += 1) {
    const cur = await snap(id);
    const job = cur.job;
    if (job && Number(job.stepIndex || 0) >= 1) { saw = { state: job.state, stepIndex: job.stepIndex, stepTotal: job.stepTotal, step: job.step, atMs: Date.now() - t0 }; break; }
    if (job && !['queued', 'running', 'pausing'].includes(job.state)) { saw = { ended: job.state, stepIndex: job.stepIndex, atMs: Date.now() - t0 }; break; }
    if (Date.now() - t0 > 25000) { saw = { timeout: true }; break; }
    await new Promise((r) => setTimeout(r, 40));
  }
  log('N8c-5 caught', saw);
  await stopServer('SIGKILL');
  await new Promise((r) => setTimeout(r, 400));
  await startServer();
  const after = await snap(id);
  log('N8c-6 after crash restart', {
    p2PartialAt: after.stages?.p2?.partialAt ?? null,
    p2Status: after.stages?.p2?.status,
    next: after.nextStep?.kind || null,
    hint: after.nextStep?.hint || null,
    lastJob: after.lastJob?.state || null,
    lastError: after.lastError?.code || null,
    p2Items: after.stages?.p2?.counts?.items ?? null,
  });
  // 再用 mock 完整重跑一次，partial 应被清
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });
  const rerun = await post(`/api/projects/${id}/stages/p2/regenerate`, { scope: 'all', confirmOverwrite: true });
  log('N8c-7 rerun with mock', { status: rerun.status, code: rerun.data?.code });
  const done = await waitIdle(id);
  log('N8c-8 after successful rerun (期望 partialAt null)', { p2PartialAt: done.stages?.p2?.partialAt ?? null, p2Status: done.stages?.p2?.status, lastJob: done.lastJob?.state || null });
  slow.server.close();
  await stopServer('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync('/tmp/t25-probe6-out.json', JSON.stringify(out, null, 2));
  console.log('PROBE_DONE');
}
main().catch(async (error) => { console.error('PROBE_FAILED', error?.stack || error); try { await stopServer('SIGKILL'); } catch {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} fs.writeFileSync('/tmp/t25-probe6-out.json', JSON.stringify(out, null, 2)); process.exit(1); });
