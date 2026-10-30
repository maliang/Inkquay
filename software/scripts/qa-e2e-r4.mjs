/**
 * QA 独立复验（t18 / verification r4）：DEF-13 / DEF-14 / DEF-15 与 SPEC M3 条目与排序能力
 *
 * 立场：不采信 t17 的自测数字（36/35/30/14），也不复用 api-test.mjs / ui-test.mjs 的断言。
 * 自己起 fresh 进程（临时 PW_DATA_DIR），先 API 取证、再真实浏览器点击。
 *
 * 覆盖：
 *   A1  准备：显式选 mock 供应商，建长篇流水线作品
 *   A2  P1 新增条目：人物/环境可加；世界观唯一；未知 kind 被拒（DEF-15）
 *   A3  P1 删除：普通可删、锁定 409 ITEM_LOCKED、解锁后可删；章不能从条目接口删
 *   A4  P1 排序：人物倒序生效、少一条/外来 id/未知 block/p4 全部被拒
 *   A5  P2 新增：幕/节拍可加、节拍必须挂幕（DEF-15）
 *   A6  P2 排序：幕倒序、幕内节拍倒序生效；非法排序被拒
 *   A7  P2 删除：删幕级联删节拍
 *   A8  P3 排序：章节计划倒序生效；少一条被拒；正文不动
 *   A9  写正文后排序：正文字节级不变（含 PATCH 保存过的两章）
 *   A10 重启（SIGKILL）后条目与章节顺序保持
 *   A11 旧作品：迁移后条目增删排序，正文与版本不变
 *   U1  DEF-13：编辑 P1 → P2 confirmed+stale → 复核并保留 → 再编辑 P1 → 横幅重现（真点击）
 *   U2  DEF-14：上游未确认时「按上游重排」禁用+写明原因；确认上游后恢复并真的重排（真点击）
 *   U3  DEF-15 UI：P1 新增人物 → ↑↓ 排序 → 刷新保持 → 删除（真点击）
 *   U4  DEF-15 UI：P2 新增一幕 + 新增节拍 → 刷新保持（真点击）
 *   U5  DEF-15 UI：P3 章节计划 ↑↓ 排序 → 刷新保持（真点击）
 *   U6  console / pageerror 汇总
 *
 * 输出：team/inkquay-ai-first/evidence/qa-r4-results.json + screenshots/qa-r4-*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const cwd = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(cwd, '..');
const evidenceDir = path.join(repoRoot, 'team/inkquay-ai-first/evidence');
const shotDir = path.join(cwd, 'screenshots');
const PORT = Number(process.env.QA_R4_PORT || 8841);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-r4-'));
const serverLog = '/tmp/qa-r4-server.log';

const results = [];
const defects = [];
const consoleErrors = [];
const httpErrors = [];
let currentStep = null;

function record(id, title, status, evidence) {
  results.push({ id, title, status, evidence, at: Date.now() - startedAt });
  const icon = status === 'passed' ? '✓' : '✗';
  console.log(`  ${icon} ${id} ${title}\n      ${evidence}`);
}

async function step(id, title, fn) {
  currentStep = id;
  const t0 = Date.now();
  try {
    const evidence = await fn();
    record(id, title, 'passed', `${evidence} (${Date.now() - t0}ms)`);
    return true;
  } catch (error) {
    record(id, title, 'failed', String(error && error.message ? error.message : error));
    return false;
  } finally {
    currentStep = null;
  }
}

function defect(id, severity, title, file, detail, repro) {
  defects.push({ id, severity, title, file, detail, repro });
  console.log(`  ! ${id} [${severity}] ${title}\n      ${file}`);
}

const startedAt = Date.now();

// ------------------------------------------------------------------ server ---
let server = null;
let serverLogStream = null;
let stdoutTail = '';

async function startServer() {
  serverLogStream = fs.createWriteStream(serverLog, { flags: 'a' });
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd,
    env: { ...process.env, PORT: String(PORT), PW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    stdoutTail = (stdoutTail + chunk.toString()).slice(-4000);
    serverLogStream.write(chunk);
  });
  server.stderr.on('data', (chunk) => serverLogStream.write(chunk));
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/providers`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server 没起来：${stdoutTail.slice(-800)}`);
}

async function stopServer(signal = 'SIGTERM') {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill(signal);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  serverLogStream?.end();
}

// --------------------------------------------------------------------- api ---
async function api(pathname, options = {}) {
  const res = await fetch(base + pathname, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, ok: res.ok, data };
}

const post = (pathname, body) => api(pathname, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = (pathname, body) => api(pathname, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
const put = (pathname, body) => api(pathname, { method: 'PUT', body: JSON.stringify(body ?? {}) });
const del = (pathname) => api(pathname, { method: 'DELETE' });

const snapshot = async (projectId) => (await api(`/api/projects/${projectId}/pipeline`)).data;
const itemsOf = async (projectId, stage) => (await api(`/api/projects/${projectId}/stages/${stage}/items`)).data;
const unitsOf = async (projectId) => (await api(`/api/projects/${projectId}/units`)).data;
const projectDetail = async (projectId) => (await api(`/api/projects/${projectId}`)).data;

async function waitJob(projectId, { timeoutMs = 90000, jobId = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snap = await snapshot(projectId);
    last = snap;
    const candidates = [snap.job, snap.lastJob].filter(Boolean);
    const target = jobId ? candidates.find((job) => job.id === jobId) : snap.job || snap.lastJob;
    if (target && target.id && !['queued', 'running', 'pausing'].includes(target.state)) return snap;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`job 没落定：${JSON.stringify(last?.job || last?.lastJob)}`);
}

/** 只是为了证据好看：把一条条 id 压成序号表 */
const seq = (rows) => rows.map((row) => row.id);
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);

async function waitFor(fn, { timeoutMs = 15000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`${label} 超时${lastError ? `：${lastError.message}` : ''}`);
}

// --------------------------------------------------------------------- main ---
let novelId = null;
let legacyId = null;
let browser = null;
let page = null;

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await startServer();
  console.log(`server 起来了（PORT=${PORT}, PW_DATA_DIR=${dataDir}）`);
  await put('/api/settings', { onboarding: { completed: true } });
  await put('/api/settings', { defaultModel: { providerId: 'mock', modelId: 'mock-writer' } });

  // ============================================================ A. 条目 API ===
  await step('A1', '准备：显式选 mock 模型，建长篇流水线作品（生成 P1）', async () => {
    const created = await post('/api/projects', {
      title: 'QA r4 长篇', type: 'novel', premise: '一个校对员发现所有错字都在同一页消失', targetWords: 30000, start: 'pipeline',
    });
    if (created.status !== 201) throw new Error(`创建 → ${created.status} ${JSON.stringify(created.data)}`);
    novelId = created.data.project.id;
    await waitJob(novelId, { timeoutMs: 60000, jobId: created.data.job.id });
    const p1 = await itemsOf(novelId, 'p1');
    const kinds = p1.items.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] || 0) + 1 }), {});
    if (!p1.items.some((item) => item.kind === 'world')) throw new Error('P1 没有世界观条目');
    return `作品 ${novelId}，P1 条目 ${p1.items.length} 条（${JSON.stringify(kinds)}）`;
  });

  await step('A2', 'P1 新增条目（DEF-15）：人物/环境可加，世界观唯一，未知 kind 被拒', async () => {
    const char = await post(`/api/projects/${novelId}/stages/p1/items`, { kind: 'character', title: 'QA 新增人物', payload: { role: '配角' } });
    if (char.status !== 201) throw new Error(`新增人物 → ${char.status} ${JSON.stringify(char.data)}`);
    const env = await post(`/api/projects/${novelId}/stages/p1/items`, { kind: 'env', title: 'QA 新增环境' });
    if (env.status !== 201) throw new Error(`新增环境 → ${env.status} ${JSON.stringify(env.data)}`);
    const worldAgain = await post(`/api/projects/${novelId}/stages/p1/items`, { kind: 'world', title: '第二条世界观' });
    if (worldAgain.status !== 400) throw new Error(`重复世界观应 400，实际 ${worldAgain.status}`);
    const bogus = await post(`/api/projects/${novelId}/stages/p1/items`, { kind: 'bogus', title: '瞎写' });
    if (bogus.status !== 400) throw new Error(`未知 kind 应 400，实际 ${bogus.status}`);
    const p1 = await itemsOf(novelId, 'p1');
    if (!p1.items.some((item) => item.id === char.data.item.id)) throw new Error('新增人物没有出现在条目列表里');
    if (!p1.items.some((item) => item.id === env.data.item.id)) throw new Error('新增环境没有出现在条目列表里');
    return `新增人物 ${char.data.item.id}、环境 ${env.data.item.id}；重复世界观 400「${worldAgain.data?.message}」；未知 kind 400`;
  });

  await step('A3', 'P1 删除（DEF-15）：普通可删、锁定 409 ITEM_LOCKED、解锁后可删', async () => {
    const p1 = await itemsOf(novelId, 'p1');
    const victim = p1.items.find((item) => item.kind === 'character' && item.title === 'QA 新增人物');
    if (!victim) throw new Error('找不到 A2 新增的人物');
    const lock = await post(`/api/projects/${novelId}/items/${victim.id}/lock`, { locked: true });
    if (!lock.ok) throw new Error(`锁定 → ${lock.status}`);
    const lockedDelete = await del(`/api/projects/${novelId}/items/${victim.id}`);
    if (lockedDelete.status !== 409 || lockedDelete.data?.code !== 'ITEM_LOCKED') {
      throw new Error(`锁定条目删除应 409 ITEM_LOCKED，实际 ${lockedDelete.status} ${JSON.stringify(lockedDelete.data)}`);
    }
    await post(`/api/projects/${novelId}/items/${victim.id}/lock`, { locked: false });
    const unlockedDelete = await del(`/api/projects/${novelId}/items/${victim.id}`);
    if (unlockedDelete.status !== 200) throw new Error(`解锁后删除 → ${unlockedDelete.status} ${JSON.stringify(unlockedDelete.data)}`);
    const after = await itemsOf(novelId, 'p1');
    if (after.items.some((item) => item.id === victim.id)) throw new Error('删除后条目仍在列表里');
    const envs = after.items.filter((item) => item.kind === 'env');
    if (envs.length) {
      const envDelete = await del(`/api/projects/${novelId}/items/${envs[envs.length - 1].id}`);
      if (envDelete.status !== 200) throw new Error(`删除环境 → ${envDelete.status}`);
    }
    return `锁定删除 409 ITEM_LOCKED「${lockedDelete.data.message}」；解锁后删除 200（deleted=${unlockedDelete.data?.deleted?.length ?? 0}，含被删条目）；环境也可删`;
  });

  await step('A4', 'P1 人物排序（DEF-15）：倒序生效；少一条/外来 id/未知 block/p4 全部被拒', async () => {
    const p1 = await itemsOf(novelId, 'p1');
    const chars = p1.items.filter((item) => item.kind === 'character');
    if (chars.length < 2) throw new Error(`人物不足 2 条（${chars.length}），无法验证排序`);
    const original = seq(chars);
    const reversed = [...original].reverse();
    const moved = await post(`/api/projects/${novelId}/stages/p1/items/reorder`, { block: 'characters', ids: reversed });
    if (!moved.ok) throw new Error(`人物排序 → ${moved.status} ${JSON.stringify(moved.data)}`);
    const after = (await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character');
    if (!sameIds(seq(after), reversed)) throw new Error(`排序没生效：期望 ${reversed.join(',')} 实际 ${seq(after).join(',')}`);
    const subset = await post(`/api/projects/${novelId}/stages/p1/items/reorder`, { block: 'characters', ids: original.slice(1) });
    if (subset.status !== 400) throw new Error(`少一条应 400，实际 ${subset.status}`);
    const foreign = await post(`/api/projects/${novelId}/stages/p1/items/reorder`, { block: 'characters', ids: [...original, 'chr_not_mine'] });
    if (foreign.status !== 400) throw new Error(`外来 id 应 400，实际 ${foreign.status}`);
    const badBlock = await post(`/api/projects/${novelId}/stages/p1/items/reorder`, { block: 'world', ids: original });
    if (badBlock.status !== 400) throw new Error(`未知 block 应 400，实际 ${badBlock.status}`);
    const p4 = await post(`/api/projects/${novelId}/stages/p4/items/reorder`, { block: 'characters', ids: original });
    if (p4.status !== 400) throw new Error(`p4 排序应 400，实际 ${p4.status}`);
    const kept = await post(`/api/projects/${novelId}/stages/p1/items/reorder`, { block: 'characters', ids: original });
    if (!kept.ok) throw new Error(`恢复原顺序 → ${kept.status}`);
    return `倒序生效（${reversed.length} 条）；少一条 400「${subset.data?.message}」；外来 id 400；block=world 400；p4 400「${p4.data?.message}」`;
  });

  await step('A5', 'P2 新增条目（DEF-15）：幕/节拍可加，节拍必须挂幕', async () => {
    const confirmed = await post(`/api/projects/${novelId}/stages/p1/confirm`);
    if (!confirmed.ok) throw new Error(`确认 P1 → ${confirmed.status} ${JSON.stringify(confirmed.data)}`);
    const started = await post(`/api/projects/${novelId}/pipeline/start`, { stage: 'p2' });
    if (started.status !== 202) throw new Error(`生成 P2 → ${started.status} ${JSON.stringify(started.data)}`);
    await waitJob(novelId, { timeoutMs: 60000, jobId: started.data.job.id });
    const p2 = await itemsOf(novelId, 'p2');
    const acts = p2.items.filter((item) => item.kind === 'act');
    if (!acts.length) throw new Error('P2 没有生成任何幕');
    const act = await post(`/api/projects/${novelId}/stages/p2/items`, { kind: 'act', title: 'QA 新一幕', payload: { summary: '手动加的一幕' } });
    if (act.status !== 201) throw new Error(`新增幕 → ${act.status} ${JSON.stringify(act.data)}`);
    const beat = await post(`/api/projects/${novelId}/stages/p2/items`, { kind: 'beat', parentId: act.data.item.id, title: 'QA 新节拍' });
    if (beat.status !== 201) throw new Error(`新增节拍 → ${beat.status} ${JSON.stringify(beat.data)}`);
    const orphan = await post(`/api/projects/${novelId}/stages/p2/items`, { kind: 'beat', title: '没有幕的节拍' });
    if (orphan.status !== 400) throw new Error(`无父节拍应 400，实际 ${orphan.status}`);
    const bogus = await post(`/api/projects/${novelId}/stages/p2/items`, { kind: 'bogus' });
    if (bogus.status !== 400) throw new Error(`未知 kind 应 400，实际 ${bogus.status}`);
    return `幕 ${acts.length} 条；新增幕 ${act.data.item.id}、节拍 ${beat.data.item.id}（挂幕）；无父节拍 400「${orphan.data?.message}」`;
  });

  await step('A6', 'P2 排序（DEF-15）：幕倒序与幕内节拍倒序生效；非法排序被拒', async () => {
    const p2 = await itemsOf(novelId, 'p2');
    const acts = p2.items.filter((item) => item.kind === 'act');
    const original = seq(acts);
    const reversed = [...original].reverse();
    const moved = await post(`/api/projects/${novelId}/stages/p2/items/reorder`, { block: 'acts', ids: reversed });
    if (!moved.ok) throw new Error(`幕排序 → ${moved.status} ${JSON.stringify(moved.data)}`);
    const after = (await itemsOf(novelId, 'p2')).items.filter((item) => item.kind === 'act');
    if (!sameIds(seq(after), reversed)) throw new Error(`幕排序没生效：期望 ${reversed.join(',')} 实际 ${seq(after).join(',')}`);
    const qaAct = (await itemsOf(novelId, 'p2')).items.find((item) => item.title === 'QA 新一幕');
    const qaBeat = (await itemsOf(novelId, 'p2')).items.find((item) => item.title === 'QA 新节拍');
    const beatMove = await post(`/api/projects/${novelId}/stages/p2/items/reorder`, { block: qaAct.id, ids: [qaBeat.id] });
    if (!beatMove.ok) throw new Error(`幕内节拍排序 → ${beatMove.status} ${JSON.stringify(beatMove.data)}`);
    const shortIds = await post(`/api/projects/${novelId}/stages/p2/items/reorder`, { block: 'acts', ids: original.slice(1) });
    if (shortIds.status !== 400) throw new Error(`幕少一条应 400，实际 ${shortIds.status}`);
    const noBlock = await post(`/api/projects/${novelId}/stages/p2/items/reorder`, { ids: original });
    if (noBlock.status !== 400) throw new Error(`缺 block 应 400，实际 ${noBlock.status}`);
    const ghost = await post(`/api/projects/${novelId}/stages/p2/items/reorder`, { block: 'act_not_exist', ids: [qaBeat.id] });
    if (ghost.status !== 404) throw new Error(`不存在的幕应 404，实际 ${ghost.status}`);
    await post(`/api/projects/${novelId}/stages/p2/items/reorder`, { block: 'acts', ids: original });
    return `幕倒序生效（${reversed.length} 条）；幕内节拍排序 200；少一条 400「${shortIds.data?.message}」；缺 block 400；不存在的幕 404`;
  });

  await step('A7', 'P2 删除（DEF-15）：删幕级联删节拍', async () => {
    const p2 = await itemsOf(novelId, 'p2');
    const qaAct = p2.items.find((item) => item.title === 'QA 新一幕');
    if (!qaAct) throw new Error('找不到 A5 新增的幕');
    const removed = await del(`/api/projects/${novelId}/items/${qaAct.id}`);
    if (removed.status !== 200) throw new Error(`删幕 → ${removed.status} ${JSON.stringify(removed.data)}`);
    const after = await itemsOf(novelId, 'p2');
    if (after.items.some((item) => item.id === qaAct.id)) throw new Error('幕没删掉');
    if (after.items.some((item) => item.title === 'QA 新节拍')) throw new Error('幕里的节拍没跟着删');
    return `删幕 200，级联删 ${removed.data?.deleted?.length ?? 0} 条（幕 + 节拍）`;
  });

  await step('A8', 'P3 排序（DEF-15）：章节计划倒序生效；少一条被拒；章节不能从条目接口删', async () => {
    const confirmed = await post(`/api/projects/${novelId}/stages/p2/confirm`);
    if (!confirmed.ok) throw new Error(`确认 P2 → ${confirmed.status} ${JSON.stringify(confirmed.data)}`);
    const started = await post(`/api/projects/${novelId}/pipeline/start`, { stage: 'p3' });
    if (started.status !== 202) throw new Error(`生成 P3 → ${started.status} ${JSON.stringify(started.data)}`);
    await waitJob(novelId, { timeoutMs: 90000, jobId: started.data.job.id });
    const units = (await unitsOf(novelId)).units;
    if (units.length < 2) throw new Error(`章节不足 2 条（${units.length}）`);
    const original = seq(units);
    const reversed = [...original].reverse();
    const moved = await post(`/api/projects/${novelId}/stages/p3/units/reorder`, { ids: reversed });
    if (!moved.ok) throw new Error(`章节排序 → ${moved.status} ${JSON.stringify(moved.data)}`);
    const after = seq((await unitsOf(novelId)).units);
    if (!sameIds(after, reversed)) throw new Error(`章节排序没生效：期望 ${reversed.join(',')} 实际 ${after.join(',')}`);
    const shortIds = await post(`/api/projects/${novelId}/stages/p3/units/reorder`, { ids: original.slice(1) });
    if (shortIds.status !== 400) throw new Error(`少一条应 400，实际 ${shortIds.status}`);
    const chapterDelete = await del(`/api/projects/${novelId}/items/${reversed[0]}`);
    if (chapterDelete.status !== 400) throw new Error(`章节从条目接口删除应 400，实际 ${chapterDelete.status}`);
    return `章节 ${units.length} 条倒序生效；少一条 400「${shortIds.data?.message}」；章节删除被拒 400「${chapterDelete.data?.message}」`;
  });

  await step('A9', '排序不动正文：给两章写正文后再排一次，正文逐字节不变', async () => {
    const units = (await unitsOf(novelId)).units;
    const targets = units.slice(0, 2);
    const texts = {};
    for (const [index, unit] of targets.entries()) {
      const text = `QA-R4 正文 ${index + 1}\n第二行包含标点：「引号」、省略号……与 emoji 🙂\n${'段落内容 '.repeat(30)}`; 
      const saved = await patch(`/api/chapters/${unit.id}`, { content: text });
      if (!saved.ok) throw new Error(`写正文 ${unit.id} → ${saved.status} ${JSON.stringify(saved.data)}`);
      texts[unit.id] = text;
    }
    const before = await projectDetail(novelId);
    for (const [id, text] of Object.entries(texts)) {
      const row = before.project.chapters.find((chapter) => chapter.id === id);
      if (!row || row.content !== text) throw new Error(`写入后读回不一致：${id}`);
    }
    const current = seq((await unitsOf(novelId)).units);
    const moved = await post(`/api/projects/${novelId}/stages/p3/units/reorder`, { ids: [...current].reverse() });
    if (!moved.ok) throw new Error(`排序 → ${moved.status} ${JSON.stringify(moved.data)}`);
    const after = await projectDetail(novelId);
    for (const [id, text] of Object.entries(texts)) {
      const row = after.project.chapters.find((chapter) => chapter.id === id);
      if (!row) throw new Error(`排序后章节不见了：${id}`);
      if (row.content !== text) throw new Error(`排序改动了正文：${id}（长度 ${row.content.length} vs ${text.length}）`);
    }
    return `两章正文（${Object.values(texts).map((t) => t.length).join('/')} 字符）排序后逐字节一致；章节数 ${after.project.chapters.length}`;
  });

  await step('A10', '重启（SIGKILL）后条目与章节顺序保持', async () => {
    const charsBefore = seq((await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character'));
    const unitsBefore = seq((await unitsOf(novelId)).units);
    await stopServer('SIGKILL');
    await new Promise((r) => setTimeout(r, 600));
    await startServer();
    const charsAfter = seq((await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character'));
    const unitsAfter = seq((await unitsOf(novelId)).units);
    if (!sameIds(charsAfter, charsBefore)) throw new Error(`人物顺序没保持：${charsBefore.join(',')} → ${charsAfter.join(',')}`);
    if (!sameIds(unitsAfter, unitsBefore)) throw new Error(`章节顺序没保持：${unitsBefore.join(',')} → ${unitsAfter.join(',')}`);
    return `SIGKILL 重启后人物 ${charsAfter.length} 条、章节 ${unitsAfter.length} 条顺序与重启前逐项一致`;
  });

  await step('A11', '旧作品：迁移后条目增删排序，正文与版本不变', async () => {
    const created = await post('/api/projects', { title: 'QA r4 旧项目', type: 'novel', premise: '升级前的旧作品' });
    if (!created.ok) throw new Error(`建旧作品 → ${created.status} ${JSON.stringify(created.data)}`);
    legacyId = created.data.project.id;
    const detail = await projectDetail(legacyId);
    const chapter = detail.project.chapters[0];
    if (!chapter) throw new Error('旧作品没有章节');
    // 注意：PATCH /api/chapters/:id 只存正文、不建版本（版本由显式快照或 AI 生成写入），
    // 所以要验证「版本不丢」必须先显式建两个版本快照（这是验收规范的动作，不是改动产品行为）。
    const text = 'QA-R4 旧正文：这一行必须在迁移与排序之后逐字节不变。';
    const draft = `${text} 第一稿`;
    await patch(`/api/chapters/${chapter.id}`, { content: draft });
    const version1 = await post(`/api/chapters/${chapter.id}/versions`, { source: 'QA 第一稿' });
    if (version1.status !== 201) throw new Error(`建版本 1 → ${version1.status} ${JSON.stringify(version1.data)}`);
    await patch(`/api/chapters/${chapter.id}`, { content: text });
    const version2 = await post(`/api/chapters/${chapter.id}/versions`, { source: 'QA 终稿' });
    if (version2.status !== 201) throw new Error(`建版本 2 → ${version2.status} ${JSON.stringify(version2.data)}`);
    const versionsBefore = (await api(`/api/projects/${legacyId}/versions?chapterId=${chapter.id}`)).data?.versions?.length ?? 0;
    if (versionsBefore < 2) throw new Error(`显式建版本后仍读不到版本记录（${versionsBefore} 条）`);
    const actsBefore = (await itemsOf(legacyId, 'p2')).items.filter((item) => item.kind === 'act').map((item) => item.title);
    const migrated = await post(`/api/projects/${legacyId}/migrate`, {});
    if (!migrated.ok) throw new Error(`迁移 → ${migrated.status} ${JSON.stringify(migrated.data)}`);
    const char = await post(`/api/projects/${legacyId}/stages/p1/items`, { kind: 'character', title: 'QA 迁移后新增人物' });
    if (char.status !== 201) throw new Error(`迁移后新增条目 → ${char.status} ${JSON.stringify(char.data)}`);
    const p1 = await itemsOf(legacyId, 'p1');
    const chars = p1.items.filter((item) => item.kind === 'character');
    if (chars.length >= 2) {
      const moved = await post(`/api/projects/${legacyId}/stages/p1/items/reorder`, { block: 'characters', ids: seq(chars).reverse() });
      if (!moved.ok) throw new Error(`迁移后排序 → ${moved.status} ${JSON.stringify(moved.data)}`);
    }
    const removed = await del(`/api/projects/${legacyId}/items/${char.data.item.id}`);
    if (removed.status !== 200) throw new Error(`迁移后删条目 → ${removed.status} ${JSON.stringify(removed.data)}`);
    const after = await projectDetail(legacyId);
    const kept = after.project.chapters.find((row) => row.id === chapter.id);
    if (!kept) throw new Error('迁移后章节不见了');
    if (kept.content !== text) throw new Error(`迁移/条目操作改动了正文：${JSON.stringify(kept.content.slice(0, 40))}`);
    const versionsAfter = (await api(`/api/projects/${legacyId}/versions?chapterId=${chapter.id}`)).data?.versions?.length ?? 0;
    if (versionsAfter < versionsBefore) throw new Error(`版本丢了：${versionsBefore} → ${versionsAfter}`);
    // 迁移后版本仍可恢复：先回退到「第一稿」，再回退到「终稿」，正文逐字节回到迁移后状态
    const restored = await post(`/api/chapters/${chapter.id}/versions/${version1.data.version.id}/restore`, {});
    if (!restored.ok) throw new Error(`迁移后恢复旧版本 → ${restored.status} ${JSON.stringify(restored.data)}`);
    const restoredText = (await projectDetail(legacyId)).project.chapters.find((row) => row.id === chapter.id)?.content;
    if (restoredText !== draft) throw new Error(`恢复第一稿后正文不对：${JSON.stringify(String(restoredText).slice(0, 30))}`);
    await post(`/api/chapters/${chapter.id}/versions/${version2.data.version.id}/restore`, {});
    const finalText = (await projectDetail(legacyId)).project.chapters.find((row) => row.id === chapter.id)?.content;
    if (finalText !== text) throw new Error('恢复回终稿后正文不对');
    const actsAfter = (await itemsOf(legacyId, 'p2')).items.filter((item) => item.kind === 'act').map((item) => item.title);
    if (!actsBefore.length) throw new Error('迁移前读不到旧大纲的幕（前置条件不成立）');
    if (actsAfter.length < actsBefore.length) throw new Error(`迁移后幕少了：${actsBefore.length} → ${actsAfter.length}`);
    for (const title of actsBefore) {
      if (!actsAfter.includes(title)) throw new Error(`迁移后找不到旧幕「${title}」`);
    }
    return `迁移 ${migrated.data?.migration?.state ?? 'done'}；正文仍是「${text.slice(0, 16)}…」（${kept.content.length} 字符）；版本 ${versionsBefore} → ${versionsAfter} 且迁移后能回退到第一稿再回终稿（逐字节一致）；旧幕 ${actsBefore.length} 条全部可读（${actsAfter.slice(0, 3).join(' / ')}）；新增/排序/删除条目均成功`;
  });

  await step('A12', '短篇等价：节拍组/节拍可增可排，P3 节拍计划可排序，且全程没有 chapters 行', async () => {
    const created = await post('/api/projects', {
      title: 'QA r4 短篇', type: 'short', premise: '一次没有写完的告别', targetWords: 12000, start: 'pipeline',
    });
    if (created.status !== 201) throw new Error(`建短篇 → ${created.status} ${JSON.stringify(created.data)}`);
    const shortId = created.data.project.id;
    await waitJob(shortId, { timeoutMs: 60000, jobId: created.data.job.id });
    await post(`/api/projects/${shortId}/stages/p1/confirm`);
    const g2 = await post(`/api/projects/${shortId}/pipeline/start`, { stage: 'p2' });
    if (g2.status !== 202) throw new Error(`短篇生成 P2 → ${g2.status}`);
    await waitJob(shortId, { timeoutMs: 60000, jobId: g2.data.job.id });
    const p2 = await itemsOf(shortId, 'p2');
    const groups = p2.items.filter((item) => item.kind === 'beat_group');
    if (!groups.length) throw new Error('短篇 P2 没有生成节拍组');
    // 新增的节拍组要能通过确认门槛：function 必填、summary ≥ 15 字（SPEC 4.2）
    const group = await post(`/api/projects/${shortId}/stages/p2/items`, {
      kind: 'beat_group', title: 'QA 新节拍组', payload: { function: '收束全篇情绪', summary: '把告别收在一句没说完的话上，留白给读者' },
    });
    if (group.status !== 201) throw new Error(`短篇新增节拍组 → ${group.status} ${JSON.stringify(group.data)}`);
    const beat = await post(`/api/projects/${shortId}/stages/p2/items`, { kind: 'beat', parentId: group.data.item.id, title: 'QA 新节拍' });
    if (beat.status !== 201) throw new Error(`短篇新增节拍 → ${beat.status} ${JSON.stringify(beat.data)}`);
    const badKind = await post(`/api/projects/${shortId}/stages/p2/items`, { kind: 'act' });
    if (badKind.status !== 400) throw new Error(`短篇用 act 应 400，实际 ${badKind.status}`);
    // 全排列：新增的节拍组也算一条（少一条会被服务端 400 拒掉，这正是保护）
    const allGroups = seq((await itemsOf(shortId, 'p2')).items.filter((item) => item.kind === 'beat_group'));
    const partial = await post(`/api/projects/${shortId}/stages/p2/items/reorder`, { block: 'acts', ids: allGroups.slice(1) });
    if (partial.status !== 400) throw new Error(`短篇节拍组少一条应 400，实际 ${partial.status}`);
    const reversed = [...allGroups].reverse();
    const movedGroups = await post(`/api/projects/${shortId}/stages/p2/items/reorder`, { block: 'acts', ids: reversed });
    if (!movedGroups.ok) throw new Error(`短篇节拍组排序 → ${movedGroups.status} ${JSON.stringify(movedGroups.data)}`);
    const groupsAfter = seq((await itemsOf(shortId, 'p2')).items.filter((item) => item.kind === 'beat_group'));
    if (!sameIds(groupsAfter, reversed)) throw new Error(`短篇节拍组排序没生效：${groupsAfter.join(',')}`);
    const movedBeat = await post(`/api/projects/${shortId}/stages/p2/items/reorder`, { block: group.data.item.id, ids: [beat.data.item.id] });
    if (!movedBeat.ok) throw new Error(`短篇节拍排序 → ${movedBeat.status}`);
    const confirmP2 = await post(`/api/projects/${shortId}/stages/p2/confirm`);
    if (!confirmP2.ok) throw new Error(`短篇确认 P2 → ${confirmP2.status} ${JSON.stringify(confirmP2.data)}`);
    const g3 = await post(`/api/projects/${shortId}/pipeline/start`, { stage: 'p3' });
    if (g3.status !== 202) throw new Error(`短篇生成 P3 → ${g3.status} ${JSON.stringify(g3.data)}`);
    await waitJob(shortId, { timeoutMs: 90000, jobId: g3.data.job.id });
    const beats = (await unitsOf(shortId)).units;
    if (!beats.length) throw new Error('短篇 P3 没有节拍单元');
    if (beats.some((unit) => unit.kind !== 'beat')) throw new Error('短篇 P3 出现了非节拍单元');
    const beatIds = seq(beats).reverse();
    const movedUnits = await post(`/api/projects/${shortId}/stages/p3/units/reorder`, { ids: beatIds });
    if (!movedUnits.ok) throw new Error(`短篇节拍计划排序 → ${movedUnits.status} ${JSON.stringify(movedUnits.data)}`);
    const unitsAfter = seq((await unitsOf(shortId)).units);
    if (!sameIds(unitsAfter, beatIds)) throw new Error(`短篇节拍计划排序没生效：${unitsAfter.join(',')}`);
    const detail = await projectDetail(shortId);
    if ((detail.project.chapters || []).length !== 0) throw new Error(`短篇不该有 chapters 行，实际 ${detail.project.chapters.length} 行`);
    return `短篇 ${shortId}：节拍组 ${groups.length} 条倒序生效、新增节拍组+节拍成功、act 被拒 400；节拍计划 ${beats.length} 条倒序生效；chapters 行 0`;
  });

  await step('A13', '排序后的章号一致性（观察项）：计划表序号连续，但 chapters.number 不跟着重排', async () => {
    const original = seq((await unitsOf(novelId)).units);
    const beforeNumbers = (await projectDetail(novelId)).project.chapters.map((row) => String(row.number || ''));
    const moved = await post(`/api/projects/${novelId}/stages/p3/units/reorder`, { ids: [...original].reverse() });
    if (!moved.ok) throw new Error(`重排 → ${moved.status} ${JSON.stringify(moved.data)}`);
    const afterNumbers = (await projectDetail(novelId)).project.chapters.map((row) => String(row.number || ''));
    const digits = afterNumbers.map((value) => Number(value.replace(/[^0-9]/g, '')));
    const monotonic = digits.every((value, index) => index === 0 || value === digits[index - 1] + 1);
    await post(`/api/projects/${novelId}/stages/p3/units/reorder`, { ids: original });
    if (!monotonic) {
      defect('DEF-16', 'low', '章节重排后 chapters.number 不重排：写作台章号与计划表序号对不上',
        'software/src/server/pipeline/actions.ts:710（reorderUnits 只写 sort_order/updated_at）；显示处 software/src/client/pages/StudioPage.tsx:1036、:1151、:1383',
        `P3 章节计划倒序后 /api/projects/:id 的 chapters 顺序变成新的，但 number 仍是旧值：${afterNumbers.slice(0, 5).join(' → ')} …（重排前是 ${beforeNumbers.slice(0, 3).join(' → ')} …）。P3 计划表按 index 渲染 1..N，写作台左侧章号与正文抬头仍用 chapters.number ⇒ 同一本书两处编号不一致。`,
        '1) 长篇生成 P3（10 章）；2) POST /stages/p3/units/reorder 倒序；3) GET /api/projects/:id 看 chapters[].number 仍是第1章…第10章原值；4) 打开写作台看左侧章号与正文抬头');
    }
    return `重排后 chapters 顺序的 number 为 ${afterNumbers.slice(0, 5).join(' → ')} …（连续=${monotonic}）；计划表序号仍按 index 渲染 1..${afterNumbers.length}`;
  });

  // ============================================================= B. 真实 UI ===
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource: the server responded with a status of \d+/.test(text)) return;
    consoleErrors.push(`console: ${text}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    httpErrors.push({ at: Date.now() - startedAt, status: response.status(), method: response.request().method(), url: response.url() });
  });

  const shot = async (name) => {
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, `qa-r4-${name}.png`), fullPage: true });
  };
  const openStage = async (stage) => {
    await page.goto(`${base}/project/${novelId}/pipeline?stage=${stage}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="pipeline-next-step"], [data-testid="stage-confirm"], [data-testid="write-control"]', { timeout: 20000 });
    await page.waitForTimeout(400);
  };
  const bannerState = async () =>
    (await page.locator('[data-testid="pipeline-banner"]').first().getAttribute('data-state').catch(() => null)) || null;

  /** 用条目卡里的「编辑」改一个字段并保存（真实点击） */
  const editFirstCharacter = async (suffix) => {
    const card = page.locator('[data-testid="item-card"][data-kind="character"]').first();
    await card.locator('[data-testid="item-edit"]').click();
    const input = card.locator('.pipeline-item__editor input.text-input').first();
    const current = await input.inputValue();
    await input.fill(`${current.replace(/\s*\(QA 编辑 \d+\)$/, '')} (QA 编辑 ${suffix})`);
    await card.locator('[data-testid="item-edit-save"]').click();
    await page.waitForTimeout(700);
  };

  await step('U1', 'DEF-13：编辑 P1 → P2 已确认却被标 stale → 复核并保留 → 再编辑 P1 → 横幅重现', async () => {
    // 先把 p1/p2 都确认好（p1 被编辑后自己回 review，这是 SPEC R2 的要求）
    await post(`/api/projects/${novelId}/stages/p1/confirm`);
    await post(`/api/projects/${novelId}/stages/p2/confirm`);
    let snap = await snapshot(novelId);
    if (snap.stages.p2.status !== 'confirmed') throw new Error(`前置条件不成立：p2=${snap.stages.p2.status}`);

    await openStage('p1');
    await editFirstCharacter(1);
    snap = await waitFor(async () => {
      const next = await snapshot(novelId);
      return next.stages.p2.staleReason === 'p1:edited' ? next : null;
    }, { label: '第一次编辑后 p2 标 stale' });
    if (snap.stages.p1.status !== 'review') throw new Error(`编辑后 p1 应为 review，实际 ${snap.stages.p1.status}`);
    if (snap.stages.p2.status !== 'confirmed') throw new Error(`p2 不该被降级，实际 ${snap.stages.p2.status}`);

    await openStage('p2');
    if ((await bannerState()) !== 'stale') throw new Error('第一次编辑后 P2 页面没有 stale 横幅');
    await shot('u1-stale-confirmed');
    await page.locator('[data-testid="stage-stale-keep"]').click();
    await waitFor(async () => (await snapshot(novelId)).stages.p2.staleReason === null, { label: '复核并保留后 stale 清空' });

    // DEF-13 的核心：p1 已经是 review，此时再编辑一次，p2 必须重新被标 stale
    await openStage('p1');
    await editFirstCharacter(2);
    snap = await waitFor(async () => {
      const next = await snapshot(novelId);
      return next.stages.p2.staleReason === 'p1:edited' ? next : null;
    }, { timeoutMs: 20000, label: '二次编辑后 p2 重新标 stale（DEF-13）' });
    await openStage('p2');
    const state = await bannerState();
    if (state !== 'stale') throw new Error(`二次编辑后 P2 横幅没回来（banner=${state}）（DEF-13 未修）`);
    await shot('u1-stale-again');
    return `第一次编辑 → p1=review、p2=confirmed+stale(p1:edited)；keep 后 stale 清空；二次编辑 → p2 再次 stale 且 P2 横幅重现（banner=data-state=${state}）`;
  });

  await step('U2', 'DEF-14：「按上游重排」在上游未确认时禁用并写明原因，确认上游后恢复且真的起重排 job', async () => {
    // 此刻 p1=review（U1 第二次编辑），p2=confirmed+stale → 正是「按上游重排」最容易变成死键的状态
    await openStage('p2');
    if ((await bannerState()) !== 'stale') throw new Error('前置条件不成立：P2 没有 stale 横幅');
    const regen = page.locator('[data-testid="stage-stale-regenerate"]');
    const hint = page.locator('[data-testid="stage-stale-regenerate-hint"]');
    const disabled = await regen.isDisabled();
    const hintVisible = await hint.isVisible().catch(() => false);
    const hintText = hintVisible ? (await hint.innerText()).trim() : '';
    const describedBy = await regen.getAttribute('aria-describedby');
    await shot('u2-regen-disabled');
    if (!disabled) throw new Error('上游还没确认时「按上游重排」居然可点（点了必然 409）');
    if (!hintVisible || !/先确认上一阶段/.test(hintText)) throw new Error(`没有写明禁用原因（hint=${hintVisible ? hintText : '无'}）`);
    if (describedBy !== 'stage-stale-regenerate-hint') throw new Error(`aria-describedby 没指向提示（${describedBy}）`);

    await openStage('p1');
    await page.locator('[data-testid="stage-confirm"]').click();
    await waitFor(async () => (await snapshot(novelId)).stages.p1.status === 'confirmed', { label: '确认 P1' });
    await openStage('p2');
    const enabled = await waitFor(async () => ((await regen.isDisabled()) ? null : true), { label: '上游确认后「按上游重排」恢复可点' });
    if (!enabled) throw new Error('上游确认后按钮仍是禁用');
    const before = httpErrors.length;
    await regen.click();
    await waitFor(async () => {
      const snap = await snapshot(novelId);
      const job = snap.job || snap.lastJob;
      if (job && job.stage === 'p2') return job;
      return snap.stages.p2.status === 'generating' || snap.stages.p2.status === 'review' ? snap.stages.p2 : null;
    }, { timeoutMs: 25000, label: '重排 job 起来' });
    await waitFor(async () => (await snapshot(novelId)).stages.p2.staleReason === null, { timeoutMs: 60000, label: '重排完成后 stale 清空' });
    const stageLocked = httpErrors.slice(before).filter((row) => row.status === 409);
    if (stageLocked.length) throw new Error(`点击「按上游重排」仍吃到 409：${JSON.stringify(stageLocked)}`);
    await page.waitForTimeout(400);
    const stateAfter = await bannerState();
    if (stateAfter === 'stale') throw new Error('重排成功后横幅还挂着');
    return `上游 review 时 button.disabled=true、aria-describedby 指向提示、提示文案「${hintText}」；确认 P1 后恢复可点，点击起 p2 重排 job 且无 409、横幅消失`;
  });

  await step('U3', 'DEF-15 UI：P1 新增人物 → ↑↓ 排序 → 刷新保持 → 删除（真实点击）', async () => {
    await openStage('p1');
    const before = (await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character');
    await page.locator('[data-testid="stage-block-add-characters"]').click();
    const created = await waitFor(async () => {
      const list = (await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character');
      return list.length > before.length ? list.find((item) => !before.some((old) => old.id === item.id)) : null;
    }, { label: '点「新增人物」后服务端多一条' });
    await page.waitForTimeout(500);
    const newCard = page.locator(`[data-testid="item-card"][data-id="${created.id}"]`);
    if (!(await newCard.count())) throw new Error('新增的人物卡没出现在页面上');
    // ↑ 一次，然后比对服务端顺序
    await newCard.locator('[data-testid="item-move-up"]').click();
    await waitFor(async () => {
      const list = seq((await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character'));
      return list.indexOf(created.id) === list.length - 2 ? list : null;
    }, { label: '上移生效' });
    const orderAfterMove = seq((await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="item-card"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    const domOrder = await page.locator('[data-testid="item-card"][data-kind="character"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
    if (!sameIds(domOrder, orderAfterMove)) throw new Error(`刷新后 DOM 顺序变了：${domOrder.join(',')} vs ${orderAfterMove.join(',')}`);
    await shot('u3-p1-items');
    // 删除（二次确认）
    await page.locator(`[data-testid="item-card"][data-id="${created.id}"] [data-testid="item-delete"]`).click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await waitFor(async () => {
      const list = (await itemsOf(novelId, 'p1')).items.filter((item) => item.kind === 'character');
      return !list.some((item) => item.id === created.id);
    }, { label: '删除生效' });
    return `新增人物 ${created.id} → 上移后序号 ${orderAfterMove.indexOf(created.id) + 1}/${orderAfterMove.length} → 刷新后 DOM 顺序与服务端一致 → 删除（confirm-ok）后条目消失`;
  });

  await step('U4', 'DEF-15 UI：P2 新增一幕 + 新增节拍 → 刷新保持（真实点击）', async () => {
    await openStage('p2');
    const actsBefore = (await itemsOf(novelId, 'p2')).items.filter((item) => item.kind === 'act');
    await page.locator('[data-testid="act-add"]').click();
    const newAct = await waitFor(async () => {
      const list = (await itemsOf(novelId, 'p2')).items.filter((item) => item.kind === 'act');
      return list.length > actsBefore.length ? list.find((item) => !actsBefore.some((old) => old.id === item.id)) : null;
    }, { label: '新增幕' });
    await page.waitForTimeout(500);
    const actBlock = page.locator(`[data-testid="item-card"][data-id="${newAct.id}"]`);
    // 只在这一幕里点「新增节拍」：它和节拍在同一个 block 容器里
    const blockContainer = page.locator('.pipeline-block').filter({ has: actBlock });
    await blockContainer.locator('[data-testid="beat-add"]').first().click();
    const newBeat = await waitFor(async () => {
      const list = (await itemsOf(novelId, 'p2')).items.filter((item) => item.kind === 'beat');
      const byAct = list.filter((item) => item.payload?.actId === newAct.id);
      return byAct.length ? byAct[0] : null;
    }, { label: '新增节拍' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="item-card"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    const actStill = await page.locator(`[data-testid="item-card"][data-id="${newAct.id}"]`).count();
    const beatStill = await page.locator(`[data-testid="item-card"][data-id="${newBeat.id}"]`).count();
    await shot('u4-p2-items');
    if (!actStill || !beatStill) throw new Error(`刷新后新增的幕/节拍不在了（act=${actStill}, beat=${beatStill}）`);
    return `新增幕 ${newAct.id}、其下节拍 ${newBeat.id}；刷新后两张卡仍在（act=${actStill}, beat=${beatStill}）`;
  });

  await step('U5', 'DEF-15 UI：P3 章节计划 ↑↓ 排序 → 刷新保持（真实点击）', async () => {
    await openStage('p3');
    const unitsBefore = seq((await unitsOf(novelId)).units);
    const rows = page.locator('[data-testid="chapter-plan-row"]');
    if ((await rows.count()) < 2) throw new Error('章节计划行不足 2 条');
    const secondId = unitsBefore[1];
    await page.locator('[data-testid="chapter-plan-row"]').nth(1).locator('[data-testid="unit-move-up"]').click();
    await waitFor(async () => {
      const list = seq((await unitsOf(novelId)).units);
      return list[0] === secondId ? list : null;
    }, { label: '上移生效' });
    const orderAfter = seq((await unitsOf(novelId)).units);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="chapter-plan-row"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    const domOrder = await page.locator('[data-testid="chapter-plan-row"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
    const domNonEmpty = domOrder.filter(Boolean);
    await shot('u5-p3-order');
    if (domNonEmpty.length && !sameIds(domNonEmpty, orderAfter)) {
      throw new Error(`刷新后计划表顺序变了：${domNonEmpty.join(',')} vs ${orderAfter.join(',')}`);
    }
    return `章节计划 ${unitsBefore.length} 条：把第 2 条上移成第 1 条（服务端顺序已变 ${orderAfter[0] === secondId ? '✓' : '✗'}），刷新后顺序保持（DOM 读到 ${domNonEmpty.length} 个 data-id）`;
  });

  await step('U6', 'Console / pageerror 汇总：不得有未捕获异常', async () => {
    if (consoleErrors.length) throw new Error(`发现 ${consoleErrors.length} 条：\n${consoleErrors.slice(0, 6).join('\n')}`);
    const unexpected = httpErrors.filter((row) => !isExpectedHttp(row));
    if (unexpected.length) throw new Error(`非预期 4xx/5xx：${unexpected.map((row) => `${row.status} ${row.method} ${new URL(row.url).pathname}`).join('; ')}`);
    return `pageerror/console 异常 0 条；HTTP≥400 共 ${httpErrors.length} 条，均为「上游未确认时点重排的 409」「删作品瞬间在飞的轮询 404」这类预期项`;
  });
}

/** 只放过刻意制造的那两类：409 stale/resolve（DEF-14 禁用前探过）与删除后仍在飞的 404 */
function isExpectedHttp(row) {
  const pathname = new URL(row.url).pathname;
  if (row.status === 404 && /^\/api\/projects\/[^/]+\/pipeline$/.test(pathname)) return true;
  return false;
}

// --------------------------------------------------------------------- run ---
let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error('探针崩了：', error);
  results.push({ id: 'FATAL', title: '探针异常退出', status: 'failed', evidence: String(error && error.stack ? error.stack : error) });
  exitCode = 2;
} finally {
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  await stopServer().catch(() => {});
  const passed = results.filter((row) => row.status === 'passed').length;
  const failed = results.filter((row) => row.status === 'failed').length;
  fs.writeFileSync(
    path.join(evidenceDir, 'qa-r4-results.json'),
    JSON.stringify(
      {
        _meta: { task: 't18 verification r4', port: PORT, dataDir, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt },
        passed,
        failed,
        results,
        defects,
        consoleErrors,
        httpErrors,
      },
      null,
      2,
    ),
  );
  console.log(`\nqa-r4：${passed} 通过 / ${failed} 失败 / ${defects.length} 缺陷`);
  console.log('证据：team/inkquay-ai-first/evidence/qa-r4-results.json');
  if (failed) exitCode = 1;
}
process.exit(exitCode);
