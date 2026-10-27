/**
 * 真实供应商冒烟：只测环境变量中已配置 Key 的供应商。
 *
 *   DEEPSEEK_API_KEY=... pnpm test:providers
 *   OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... pnpm test:providers
 *
 * 每个供应商做两件事：/providers/:id/test 连接检查 + 一次极短的真实流式生成。
 * 没有 Key 默认 SKIP；release gate 可设 PROVIDER_SMOKE_REQUIRED=1 让“没有 Key”直接失败。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provider-smoke-'));
const port = 8801;
const base = `http://127.0.0.1:${port}`;
const required = process.env.PROVIDER_SMOKE_REQUIRED === '1';

const targets = [
  { id: 'deepseek', env: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', model: 'deepseek-chat' },
  { id: 'openai', env: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', model: 'gpt-5.2' },
  { id: 'anthropic', env: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', model: 'claude-sonnet-4-5' },
  { id: 'google', env: 'GEMINI_API_KEY', altEnv: 'GOOGLE_API_KEY', modelEnv: 'GEMINI_MODEL', model: 'gemini-3-5-pro' },
  { id: 'qwen', env: 'DASHSCOPE_API_KEY', modelEnv: 'QWEN_MODEL', model: 'qwen3-8-max' },
  { id: 'zhipu', env: 'ZHIPU_API_KEY', modelEnv: 'ZHIPU_MODEL', model: 'glm-5' },
  { id: 'moonshot', env: 'MOONSHOT_API_KEY', modelEnv: 'MOONSHOT_MODEL', model: 'kimi-k3' },
];

function log(value) { console.log(value); }
function keyFor(target) { return process.env[target.env] || (target.altEnv ? process.env[target.altEnv] : ''); }

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
  for (let i = 0; i < 80; i += 1) {
    try { const res = await fetch(`${base}/api/health`); if (res.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start\n${stdout}\n${stderr}`);
}

async function json(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function smokeOne(target, index) {
  const key = keyFor(target);
  const model = process.env[target.modelEnv] || target.model;
  const label = `${target.id} (${model})`;
  if (index === 0) {
    await json('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ name: 'Provider Smoke', signature: 'smoke', providerId: target.id, apiKey: key, modelId: target.model }),
    });
  }
  const boot = await json('/api/bootstrap');
  const provider = boot.providers.find((item) => item.id === target.id);
  if (!provider) throw new Error(`供应商不存在：${target.id}`);
  const models = provider.models.some((item) => item.id === model)
    ? provider.models
    : [...provider.models, { id: model, name: model, ctx: '自定义', tags: ['冒烟'] }];
  await json(`/api/providers/${target.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ apiKey: key, models, enabledModels: [model] }),
  });
  await json('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: target.id, modelId: model } }) });

  const tested = await json(`/api/providers/${target.id}/test`, { method: 'POST' });
  assert.equal(tested.ok, true, `${label} 连接失败：${tested.message}`);
  log(`PASS ${label} 连接检查：${tested.message}`);

  const created = await json('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `Provider smoke ${target.id}`, type: 'short', genre: '测试' }),
  });
  const projectId = created.project.id;
  const chapterId = created.project.chapters[0].id;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let text = '';
  let error = '';
  let done = false;
  try {
    const res = await fetch(`${base}/api/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId, chapterId, providerId: target.id, modelId: model,
        prompt: '只回复两个字：收到。不要解释。', mode: 'continue',
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('没有响应体');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let event;
          try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (event.type === 'delta') text += event.text || '';
          if (event.type === 'error') error = event.message || 'AI 请求失败';
          if (event.type === 'done') done = true;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(error, '', `${label} 流式失败：${error}`);
  assert.ok(text.trim().length > 0, `${label} 未返回文本`);
  assert.ok(done, `${label} 未收到 done 事件`);
  log(`PASS ${label} 真实流式生成：${text.trim().slice(0, 40)}`);

  await json(`/api/projects/${projectId}`, { method: 'DELETE' });
}

async function main() {
  await waitForServer();
  const available = targets.filter((target) => keyFor(target));
  if (available.length === 0) {
    log('SKIP 未配置真实供应商 Key。可设置 DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 等后重跑。');
    if (required) process.exitCode = 1;
    return;
  }
  for (let i = 0; i < available.length; i += 1) await smokeOne(available[i], i);
  log(`\nProvider smoke passed: ${available.length} provider(s).`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 1000).unref();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
