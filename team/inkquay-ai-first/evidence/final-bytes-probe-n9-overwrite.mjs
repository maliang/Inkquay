/**
 * t25 最终字节复验探针 v3（只读，不碰仓库）
 *   C  N9：手改 p3 章节计划（items PATCH，产生 manual 修订）→ 整阶段重生成 必须 422 CONFIRM_BLOCKED
 *        → 带 confirmOverwrite:true 才 202；顺带记录 patch 400 的真实原因
 *   D  N8：慢供应商拖住 P2 重建 → SIGKILL → 重启后 stages.p2.partialAt 非空 → 完整重跑后清空
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const PORT = Number(process.env.PORT || 8843);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 't25-probe3-'));
const logFile = '/tmp/t25-probe3-server.log';
fs.writeFileSync(logFile, '');
let server = null;
let stderr = '';
const out = [];
const log = (label, value) => { out.push({ label, value }); console.log(`### ${label}: ${JSON.stringify(value)}`); };

function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(PORT), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => fs.appendFileSync(logFile, String(d)));
  server.stderr.on('data', (d) => { stderr += String(d); fs.appendFileSync(logFile, String(d)); });
  return waitForServer();
}
async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start\n${stderr.slice(-3000)}`);
}
async function stopServer(signal = 'SIGTERM') {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill(signal);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
}
async function api(p, options = {}) {
  const res = await fetch(`${base}${p}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, data, ok: res.ok };
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = (p, body) => api(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
const waitIdle = async (id, label) => {
  for (let i = 0; i < 900; i += 1) {
    const snap = (await api(`/api/projects/${id}/pipeline`)).data;
    const state = snap.job?.state;
    if (!['queued', 'running', 'pausing'].includes(state)) return snap;
    await new Promise((r) => setTimeout(r, 200));
  }
  log(`${label}: timeout waiting job`, {});
  return (await api(`/api/projects/${id}/pipeline`)).data;
};
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
        const prose = Array.from({ length: 30 }, () => '旧城的雨把铁皮棚顶敲成一片鼓点。').join('\n\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: prose }, finish_reason: 'stop' }] }));
      }, delayMs);
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}/v1` })));
}

async function main() {
  await startServer();
  const ob = await post('/api/onboarding', { name: 't25 复验', signature: 't25', providerId: 'mock', apiKey: '', modelId: 'mock-writer' });
  log('C0 onboarding', { status: ob.status, ok: ob.ok });

  // ---------- C. N9：手改 p3 后整阶段重生成必须带确认
  const novel = await post('/api/projects', { title: 't25 N9', type: 'novel', description: 'p3 覆盖确认' });
  const pid = novel.data.project.id;
  const ch = novel.data.project.chapters[0];
  await patch(`/api/chapters/${ch.id}`, { content: '旧稿正文，用来说明p3存在的作品。' });
  const mig = await post(`/api/projects/${pid}/migrate`);
  const units = (await api(`/api/projects/${pid}/units`)).data.units || [];
  log('C1 migrated', { state: mig.data?.migration?.state, units: units.length, first: units[0] && { id: units[0].id, title: units[0].title, target: units[0].targetWords, min: units[0].minWords, max: units[0].maxWords } });

  const unit0 = units[0];
  // 手改方式一：PATCH /items/:itemId（payload.synopsis），这是前端「编辑章节计划」的真实路径
  const edit = await patch(`/api/projects/${pid}/items/${unit0.id}`, { stage: 'p3', payload: { synopsis: '这是人手改过的章节大纲，二十个字以上，用来触发覆盖确认。' } });
  log('C2 hand edit via items', { status: edit.status, code: edit.data?.code, message: edit.data?.message, synopsis: edit.data?.item?.synopsis || edit.data?.synopsis || null });
  // 手改方式二：PATCH /stages/p3/units/:unitId（字数），记录 400 真因
  const unitPatch = await patch(`/api/projects/${pid}/stages/p3/units/${unit0.id}`, { synopsis: '再改一次大纲，确认 revison 里有 manual。' });
  log('C3 hand edit via units', { status: unitPatch.status, code: unitPatch.data?.code, message: unitPatch.data?.message, blockers: unitPatch.data?.blockers?.slice(0, 3) });

  const revs = await api(`/api/projects/${pid}/stages/p3/revisions?targetId=${unit0.id}`);
  log('C4 revisions of unit', { count: (revs.data.revisions || []).length, sources: (revs.data.revisions || []).map((r) => r.source) });

  const noConfirm = await post(`/api/projects/${pid}/stages/p3/regenerate`, { scope: 'all' });
  log('C5 N9 regenerate without confirm (期望 422)', { status: noConfirm.status, code: noConfirm.data?.code, requiresConfirm: noConfirm.data?.detail?.requiresConfirm, blockers: noConfirm.data?.blockers?.slice(0, 3) });
  const withConfirm = await post(`/api/projects/${pid}/stages/p3/regenerate`, { scope: 'all', confirmOverwrite: true });
  log('C6 N9 regenerate with confirm (期望 202)', { status: withConfirm.status, code: withConfirm.data?.code, jobState: withConfirm.data?.job?.state || null });
  await waitIdle(pid, 'C7');

  // ---------- D. N8：崩溃中断写 partialAt
  const slow = await slowProvider(1200);
  const prov = await post('/api/providers', {
    name: 't25 slow',
    kind: 'openai',
    baseUrl: slow.url,
    apiKey: 'sk-t25',
    models: [{ id: 'slow-model', name: 'slow-model', ctx: '慢模型', tags: ['OpenAI 兼容'] }],
    enabledModels: ['slow-model'],
  });
  const providerId = prov.data?.provider?.id;
  log('D0 slow provider', { status: prov.status, id: providerId });
  const settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId, modelId: 'slow-model' } }) });
  const pre = await api('/api/pipeline/precheck');
  log('D1 precheck slow', { ok: pre.data?.ok, code: pre.data?.code, provider: pre.data?.providerId, model: pre.data?.modelId, settingsStatus: settings.status });

  const crash = await post('/api/projects', { title: 't25 N8', type: 'novel', premise: '一个在停电夜替人守灵的人，接到一通不该接的电话。', targetWords: 30000, start: 'pipeline' });
  const cid = crash.data?.project?.id;
  log('D2 create', { status: crash.status, code: crash.data?.code, id: cid });
  if (cid) {
    await waitIdle(cid, 'D3');
    const cf = await post(`/api/projects/${cid}/stages/p1/confirm`, {});
    log('D4 confirm p1', { status: cf.status, code: cf.data?.code, blockers: cf.data?.blockers?.slice(0, 4) });
    const regen = await post(`/api/projects/${cid}/stages/p2/regenerate`, { scope: 'all', confirmOverwrite: true });
    log('D5 regen p2 (slow)', { status: regen.status, code: regen.data?.code, jobState: regen.data?.job?.state || null });
    let saw = null;
    for (let i = 0; i < 900; i += 1) {
      const snap = (await api(`/api/projects/${cid}/pipeline`)).data;
      const job = snap.job;
      if (job && Number(job.stepIndex || 0) >= 1) { saw = { state: job.state, stepIndex: job.stepIndex, step: job.step }; break; }
      if (job && !['queued', 'running', 'pausing'].includes(job.state)) { saw = { ended: job.state, stepIndex: job.stepIndex }; break; }
      await new Promise((r) => setTimeout(r, 120));
    }
    log('D6 before kill', { saw, p2Status: (await api(`/api/projects/${cid}/pipeline`)).data.stages?.p2?.status });
    await stopServer('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
    await startServer();
    const after = (await api(`/api/projects/${cid}/pipeline`)).data;
    log('D7 N8 partialAt after crash restart', {
      p2PartialAt: after.stages?.p2?.partialAt ?? null,
      p2Status: after.stages?.p2?.status,
      next: after.nextStep?.kind || null,
      hint: after.nextStep?.hint || null,
      lastJob: after.lastJob?.state || null,
      jobNow: after.job?.state || null,
      lastError: after.lastError?.code || null,
    });
    // 完整重跑一次（同样慢供应商，但这次等它跑完再断言 partial 被清）
    const rerun = await post(`/api/projects/${cid}/stages/p2/regenerate`, { scope: 'all', confirmOverwrite: true });
    log('D8 rerun p2', { status: rerun.status, code: rerun.data?.code });
    const end = await waitIdle(cid, 'D9');
    log('D9 N8 partialAt after successful rerun (期望 null)', { p2PartialAt: end.stages?.p2?.partialAt ?? null, p2Status: end.stages?.p2?.status, lastJob: end.lastJob?.state || null });
  }

  slow.server.close();
  await stopServer('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync('/tmp/t25-probe3-out.json', JSON.stringify(out, null, 2));
  console.log('PROBE_DONE');
}
main().catch(async (error) => {
  console.error('PROBE_FAILED', error?.stack || error);
  try { await stopServer('SIGKILL'); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  fs.writeFileSync('/tmp/t25-probe3-out.json', JSON.stringify(out, null, 2));
  process.exit(1);
});
