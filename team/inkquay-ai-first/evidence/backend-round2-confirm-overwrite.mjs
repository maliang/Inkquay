// t20 探针：F7 的「覆盖确认」在 HTTP 层是否真的可用（confirmOverwrite 门禁 + 前端/路由是否给出路）
// 结论用于 REVIEW-BACKEND-ROUND2.md
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const port = 5822;
const dataDir = '/tmp/t20-probe-db';
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
    body: JSON.stringify({ title: '探针作品', type: 'novel', description: '探针', genre: '悬疑', start: 'pipeline' }),
  });
  const projectId = created.data?.project?.id;
  console.log('created', created.status, projectId);
  const snap = await waitJob(projectId);
  console.log('after plan:', JSON.stringify({
    p1: { status: snap.stages?.p1?.status, items: snap.stages?.p1?.counts?.items },
    p2: { status: snap.stages?.p2?.status },
    next: snap.nextStep?.kind,
    lastError: snap.lastError?.code || null,
  }));

  // 找一个人物条目做「手改」
  const itemsRes = await json(`/api/projects/${projectId}/stages/p1/items`);
  const p1Items = itemsRes.data?.items || [];
  const character = p1Items.find((i) => i.kind === 'character') || p1Items[0];
  console.log('p1 items:', p1Items.length, 'pick:', character?.id, character?.kind);
  const patched = await json(`/api/projects/${projectId}/items/${character.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '手改过的人物名', payload: { name: '手改过的人物名', role: '主角', motivation: '手改' } }),
  });
  console.log('patch item:', patched.status);

  // 1) 不带 confirmOverwrite 的全阶段重生成：期望 422 CONFIRM_BLOCKED
  const regen1 = await json(`/api/projects/${projectId}/stages/p1/regenerate`, { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
  console.log('regen(no confirm):', regen1.status, JSON.stringify(regen1.data).slice(0, 300));

  // 2) 带 confirmOverwrite：期望 202
  const regen2 = await json(`/api/projects/${projectId}/stages/p1/regenerate`, { method: 'POST', body: JSON.stringify({ scope: 'all', confirmOverwrite: true }) });
  console.log('regen(confirmOverwrite):', regen2.status, JSON.stringify(regen2.data).slice(0, 200));
  await waitJob(projectId);

  // 3) stale/regenerate 路由是否接受 confirmOverwrite（F7 的另一个入口）
  const stale = await json(`/api/projects/${projectId}/stages/p2/stale/resolve`, { method: 'POST', body: JSON.stringify({ action: 'regenerate', confirmOverwrite: true }) });
  console.log('stale resolve(regenerate, confirmOverwrite passed):', stale.status, JSON.stringify(stale.data).slice(0, 200));
} catch (error) {
  console.error('PROBE ERROR:', error?.message);
  console.error(stderr.slice(-2000));
} finally {
  server.kill('SIGKILL');
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}
