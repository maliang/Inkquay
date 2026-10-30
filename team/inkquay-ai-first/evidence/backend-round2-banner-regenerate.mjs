// t20 探针 2：Banner「上游已变更 → 重新生成」这条路（POST /stages/:s/stale/resolve {action:'regenerate'}）
// 在存在手改条目时是否变成死胡同（N1 的第二条路径）。
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const port = 5823;
const dataDir = '/tmp/t20-probe-banner-db';
const base = `http://127.0.0.1:${port}`;
rmSync(dataDir, { recursive: true, force: true });

let stderr = '';
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  cwd,
  env: { ...process.env, PORT: String(port), PW_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => { stderr += String(d); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await sleep(250);
  }
  throw new Error(`server did not start\n${stderr.slice(-3000)}`);
}

async function json(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitJob(projectId) {
  for (let i = 0; i < 600; i += 1) {
    const snap = await json(`/api/projects/${projectId}/pipeline`);
    const job = snap.data?.job;
    if (job && ['queued', 'running', 'pausing'].includes(job.state)) { await sleep(100); continue; }
    return snap.data;
  }
  throw new Error('job did not settle');
}

try {
  await waitHealth();
  await json('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ name: '探针作者', signature: 'probe', providerId: 'deepseek', apiKey: 'sk-probe-123456', modelId: 'deepseek-chat' }),
  });
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });

  const created = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: '探针作品2', type: 'novel', description: '探针', genre: '悬疑', start: 'pipeline' }),
  });
  const projectId = created.data?.project?.id;
  let snap = await waitJob(projectId);
  console.log('p1:', snap.stages?.p1?.status, 'next:', snap.nextStep?.kind);

  const confirm1 = await json(`/api/projects/${projectId}/stages/p1/confirm`, { method: 'POST', body: '{}' });
  console.log('confirm p1:', confirm1.status, JSON.stringify(confirm1.data).slice(0, 120));

  const gen2 = await json(`/api/projects/${projectId}/stages/p2/regenerate`, { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
  console.log('generate p2:', gen2.status);
  snap = await waitJob(projectId);
  console.log('p2:', snap.stages?.p2?.status, 'next:', snap.nextStep?.kind, 'blockers:', JSON.stringify(snap.nextStep?.blockers || []));

  const confirm2 = await json(`/api/projects/${projectId}/stages/p2/confirm`, { method: 'POST', body: '{}' });
  console.log('confirm p2:', confirm2.status, JSON.stringify(confirm2.data).slice(0, 200));

  // 手改一条节拍（记录 manual revision）
  const beats = await json(`/api/projects/${projectId}/stages/p2/items`);
  const beat = (beats.data?.items || []).find((i) => i.kind === 'beat');
  console.log('beats:', (beats.data?.items || []).length, 'pick:', beat?.id);
  const patched = await json(`/api/projects/${projectId}/items/${beat.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: beat.title, payload: { ...(beat.payload || {}), summary: '手改过的节拍摘要，足够长足够长。' } }),
  });
  console.log('patch beat:', patched.status);

  // 1) Banner 的「重新生成」入口
  const banner = await json(`/api/projects/${projectId}/stages/p2/stale/resolve`, { method: 'POST', body: JSON.stringify({ action: 'regenerate' }) });
  console.log('banner regenerate (stale/resolve):', banner.status, JSON.stringify(banner.data).slice(0, 240));

  // 2) 带 confirmOverwrite 的 banner 请求（路由不转发，预期同样失败）
  const banner2 = await json(`/api/projects/${projectId}/stages/p2/stale/resolve`, { method: 'POST', body: JSON.stringify({ action: 'regenerate', confirmOverwrite: true }) });
  console.log('banner regenerate + confirmOverwrite:', banner2.status, JSON.stringify(banner2.data).slice(0, 200));

  // 3) 直接 regenerate 路由带 confirmOverwrite（这条能过）
  const direct = await json(`/api/projects/${projectId}/stages/p2/regenerate`, { method: 'POST', body: JSON.stringify({ scope: 'all', confirmOverwrite: true }) });
  console.log('direct regenerate + confirmOverwrite:', direct.status);
  await waitJob(projectId);
} catch (error) {
  console.error('PROBE ERROR:', error?.message);
  console.error(stderr.slice(-2000));
} finally {
  server.kill('SIGKILL');
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}
