// t20 探针 3：创建幂等（Idempotency-Key 重放）是否真的可用 —— 原 issue 就是「新建被点两次」
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const port = 5824;
const dataDir = '/tmp/t20-probe-idem-db';
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

try {
  await waitHealth();
  await json('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ name: '探针作者', signature: 'probe', providerId: 'deepseek', apiKey: 'sk-probe-123456', modelId: 'deepseek-chat' }),
  });
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });

  const key = `probe-${Date.now()}`;
  const payload = JSON.stringify({ title: '幂等作品', type: 'novel', description: '探针', genre: '悬疑', start: 'pipeline' });
  const first = await json('/api/projects', { method: 'POST', body: payload, headers: { 'Idempotency-Key': key } });
  const second = await json('/api/projects', { method: 'POST', body: payload, headers: { 'Idempotency-Key': key } });
  const third = await json('/api/projects', { method: 'POST', body: payload, headers: { 'Idempotency-Key': `${key}-other` } });
  console.log('first:', first.status, first.data?.project?.id, 'replayed=', first.data?.replayed);
  console.log('second(same key):', second.status, second.data?.project?.id, 'replayed=', second.data?.replayed);
  console.log('third(new key):', third.status, third.data?.project?.id, 'replayed=', third.data?.replayed);
  const list = await json('/api/projects');
  console.log('projects:', (list.data?.projects || []).length);
} catch (error) {
  console.error('PROBE ERROR:', error?.message);
  console.error(stderr.slice(-2000));
} finally {
  server.kill('SIGKILL');
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
}
