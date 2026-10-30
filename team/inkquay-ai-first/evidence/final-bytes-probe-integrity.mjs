/**
 * t25 最终字节复验探针 v2
 *   A 旧长篇：migrate / rollback 前后 正文·字数·版本·人物·幕·节拍 逐项不变
 *   B 旧短篇：migrate → rollback 后 /units 必须为 0（N7）；p3 修订历史不含迁移账本（N10）
 *   C p3 手改后整阶段重生成：无确认 422 CONFIRM_BLOCKED、带确认 202（N9）
 *   D 慢供应商拖住 P2 重建 → SIGKILL → 重启后 partialAt 非空（N8）→ 完整重跑后清空
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const cwd = '/Users/maliang/Documents/develop/maliang/私家写手/software';
const PORT = Number(process.env.PORT || 8842);
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 't25-probe2-'));
const logFile = '/tmp/t25-probe2-server.log';
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
async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data, ok: res.ok };
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = (p, body) => api(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) });

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
        const prose = Array.from({ length: 20 }, () => '旧城的雨把铁皮棚顶敲成一片鼓点。').join('\n\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: prose }, finish_reason: 'stop' }] }));
      }, delayMs);
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}/v1` })));
}

const detailOf = async (id) => (await api(`/api/projects/${id}`)).data.project || {};
const fingerprint = async (id) => {
  const project = await detailOf(id);
  const versions = (await api(`/api/projects/${id}/versions`)).data;
  return {
    chapters: (project.chapters || []).map((c) => ({ id: c.id, title: c.title, words: c.words, content: c.content })),
    characters: (project.characters || []).map((c) => ({ id: c.id, name: c.name, role: c.role })),
    acts: (project.outline?.acts || []).map((a) => ({ id: a.id, title: a.title, summary: a.summary })),
    beats: (project.outline?.beats || []).map((b) => ({ id: b.id, title: b.title, summary: b.summary })),
    versionCount: (versions.versions || []).length,
  };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  await startServer();
  const ob = await post('/api/onboarding', { name: 't25 复验', signature: 't25', providerId: 'mock', apiKey: '', modelId: 'mock-writer' });
  log('A0 onboarding', { status: ob.status, ok: ob.ok });
  if (!ob.ok) throw new Error(`onboarding ${ob.status} ${JSON.stringify(ob.data).slice(0, 300)}`);
  const pre = await api('/api/pipeline/precheck');
  log('A0 precheck', { status: pre.status, ok: pre.data?.ok, provider: pre.data?.providerId, model: pre.data?.modelId });

  // ---------------- A. 旧长篇：迁移/回退不丢
  const novel = await post('/api/projects', { title: 't25 旧长篇', type: 'novel', description: '迁移不得改字' });
  const novelId = novel.data.project.id;
  const novelChapter = novel.data.project.chapters[0].id;
  const novelText = '第一章正文，迁移前后必须逐字节一致。\n\n第二段也不能少。\n\n第三段：引号「」与 emoji 🐟 都要保留。';
  await patch(`/api/chapters/${novelChapter}`, { content: novelText });
  await post(`/api/projects/${novelId}/characters`, { name: '旧人物', role: '主角', motivation: '找回记忆' });
  await post(`/api/projects/${novelId}/actors`, { title: '第一幕', summary: '旧幕摘要也要留着' });

  const beforeN = await fingerprint(novelId);
  const mig = await post(`/api/projects/${novelId}/migrate`);
  log('A1 migrate novel', { status: mig.status, state: mig.data?.migration?.state, checks: (mig.data?.migration?.checks || []).length, failed: (mig.data?.migration?.checks || []).filter((c) => !c.ok).length });
  const afterMig = await fingerprint(novelId);
  log('A2 novel after migrate', {
    contentSame: same(afterMig.chapters.map((c) => c.content), beforeN.chapters.map((c) => c.content)),
    wordsSame: same(afterMig.chapters.map((c) => c.words), beforeN.chapters.map((c) => c.words)),
    versionsSame: afterMig.versionCount === beforeN.versionCount,
    charactersSame: same(afterMig.characters, beforeN.characters),
    actsSame: same(afterMig.acts, beforeN.acts),
    beatsSame: same(afterMig.beats, beforeN.beats),
  });
  const revs = await api(`/api/projects/${novelId}/stages/p3/revisions`);
  const revList = revs.data.revisions || [];
  log('B3 N10 p3 revisions after migrate', { count: revList.length, notes: revList.map((r) => r.note || null), ledgerVisible: revList.some((r) => String(r.note || '').includes('迁移前章节清单')) });

  const rb = await post(`/api/projects/${novelId}/migrate/rollback`, { mode: 'sql', confirm: true });
  log('A3 rollback novel', { status: rb.status, state: rb.data?.migration?.state, archived: rb.data?.migration?.archivedTitles, deleted: rb.data?.migration?.deletedTitles, legacyIdsKnown: rb.data?.migration?.legacyChapterIdsKnown });
  const afterRb = await fingerprint(novelId);
  log('A4 novel after rollback', {
    contentSame: same(afterRb.chapters.map((c) => c.content), beforeN.chapters.map((c) => c.content)),
    wordsSame: same(afterRb.chapters.map((c) => c.words), beforeN.chapters.map((c) => c.words)),
    versionsSame: afterRb.versionCount === beforeN.versionCount,
    charactersSame: same(afterRb.characters, beforeN.characters),
    actsSame: same(afterRb.acts, beforeN.acts),
    beatsSame: same(afterRb.beats, beforeN.beats),
    exactText: afterRb.chapters[0]?.content === novelText,
  });
  const unitsN = (await api(`/api/projects/${novelId}/units`)).data.units || [];
  log('A5 novel units after rollback (chapters 表，含原章属正常)', { count: unitsN.length, titles: unitsN.map((u) => u.title) });

  // ---------------- B. 旧短篇：N7 回退后 /units 必须 0
  const short = await post('/api/projects', { title: 't25 旧短篇', type: 'short', description: '短篇节拍迁移' });
  const shortId = short.data.project.id;
  const shortChapter = short.data.project.chapters[0].id;
  await patch(`/api/chapters/${shortChapter}`, { content: '短篇旧正文，回退后必须一字不差。' });
  const migShort = await post(`/api/projects/${shortId}/migrate`);
  const unitsShort = (await api(`/api/projects/${shortId}/units`)).data.units || [];
  log('B1 short after migrate', { status: migShort.status, state: migShort.data?.migration?.state, units: unitsShort.length, titles: unitsShort.map((u) => u.title) });
  const rbShort = await post(`/api/projects/${shortId}/migrate/rollback`, { mode: 'sql', confirm: true });
  const unitsShortAfter = (await api(`/api/projects/${shortId}/units`)).data.units || [];
  log('B2 N7 short units after rollback (期望 0)', { status: unitsShortAfter.length ? 'FAIL' : 'PASS', count: unitsShortAfter.length, titles: unitsShortAfter.map((u) => u.title), rollbackState: rbShort.data?.migration?.state });
  const shortDetail = await detailOf(shortId);
  log('B2b short 正文 after rollback', { same: (shortDetail.chapters || [])[0]?.content === '短篇旧正文，回退后必须一字不差。', chapters: (shortDetail.chapters || []).length, pipelineStatus: (await api(`/api/projects/${shortId}/pipeline`)).data.project?.pipelineStatus });

  // ---------------- C. N9：p3 手改后整阶段重生成必须 422
  await post(`/api/projects/${novelId}/migrate`); // 再迁移回来，拿 p3 单元
  const unitsNovel = (await api(`/api/projects/${novelId}/units`)).data.units || [];
  let n9 = { skipped: true };
  if (unitsNovel.length) {
    const unit = unitsNovel[0];
    const patched = await patch(`/api/projects/${novelId}/stages/p3/units/${unit.id}`, { targetWords: Number(unit.targetWords || 3000) + 100 });
    const noConfirm = await post(`/api/projects/${novelId}/stages/p3/regenerate`, { scope: 'all' });
    const withConfirm = await post(`/api/projects/${novelId}/stages/p3/regenerate`, { scope: 'all', confirmOverwrite: true });
    n9 = {
      skipped: false,
      patchStatus: patched.status,
      noConfirm: { status: noConfirm.status, code: noConfirm.data?.code, requiresConfirm: noConfirm.data?.detail?.requiresConfirm, blockers: noConfirm.data?.blockers?.slice(0, 3) },
      withConfirm: { status: withConfirm.status, jobState: withConfirm.data?.job?.state || null, code: withConfirm.data?.code },
    };
    for (let i = 0; i < 300; i += 1) {
      const snap = (await api(`/api/projects/${novelId}/pipeline`)).data;
      const state = snap.job?.state;
      if (!['queued', 'running', 'pausing'].includes(state)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  log('C1 N9 p3 overwrite guard', n9);

  // ---------------- D. N8：慢供应商 + SIGKILL → partialAt
  const slow = await slowProvider(1500);
  const prov = await post('/api/providers', { name: 't25 slow', kind: 'openai', baseUrl: slow.url, apiKey: 'sk-t25' });
  log('D0 provider', { status: prov.status, id: prov.data?.provider?.id || null, raw: prov.status === 201 ? undefined : prov.data });
  const pid = prov.data?.provider?.id;
  const models = await post(`/api/providers/${pid}/models`);
  log('D1 models', { status: models.status, models: (models.data?.models || []).map((m) => m.id) });
  const settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: pid, modelId: 'slow-model' } }) });
  log('D2 settings', { status: settings.status, defaultModel: settings.data?.settings?.defaultModel || settings.data?.defaultModel || null });
  const pre2 = await api('/api/pipeline/precheck');
  log('D3 precheck slow', { ok: pre2.data?.ok, provider: pre2.data?.providerId, model: pre2.data?.modelId, code: pre2.data?.code });

  const crash = await post('/api/projects', { title: 't25 崩溃复验', type: 'novel', premise: '一个在停电夜替人守灵的人。', targetWords: 30000, start: 'pipeline' });
  log('D4 create crash project', { status: crash.status, code: crash.data?.code, hasProject: Boolean(crash.data?.project) });
  const crashId = crash.data?.project?.id;
  if (crashId) {
    for (let i = 0; i < 400; i += 1) {
      const snap = (await api(`/api/projects/${crashId}/pipeline`)).data;
      const state = snap.job?.state;
      if (!['queued', 'running', 'pausing'].includes(state)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const cf = await post(`/api/projects/${crashId}/stages/p1/confirm`, {});
    log('D5 confirm p1', { status: cf.status, code: cf.data?.code });
    const regen = await post(`/api/projects/${crashId}/stages/p2/regenerate`, { scope: 'all', confirmOverwrite: true });
    log('D6 regen p2', { status: regen.status, jobState: regen.data?.job?.state || null, code: regen.data?.code });
    let saw = null;
    for (let i = 0; i < 600; i += 1) {
      const snap = (await api(`/api/projects/${crashId}/pipeline`)).data;
      const job = snap.job;
      if (job && (job.stepIndex ?? 0) >= 1) { saw = { state: job.state, stepIndex: job.stepIndex, step: job.step }; break; }
      if (job && !['queued', 'running', 'pausing'].includes(job.state)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    log('D7 before SIGKILL', { sawStep: saw });
    await stopServer('SIGKILL');
    await new Promise((r) => setTimeout(r, 400));
    await startServer();
    const snapCrash = (await api(`/api/projects/${crashId}/pipeline`)).data;
    log('D8 N8 partialAt after crash restart (期望非空)', {
      p2PartialAt: snapCrash.stages?.p2?.partialAt ?? null,
      p2Status: snapCrash.stages?.p2?.status,
      next: snapCrash.nextStep?.kind,
      hint: snapCrash.nextStep?.hint || null,
      jobState: snapCrash.job?.state || snapCrash.lastJob?.state || null,
    });
    // 完整重跑一次，partial 应被清掉
    await post(`/api/projects/${crashId}/stages/p2/regenerate`, { scope: 'all', confirmOverwrite: true });
    for (let i = 0; i < 600; i += 1) {
      const snap = (await api(`/api/projects/${crashId}/pipeline`)).data;
      const state = snap.job?.state;
      if (!['queued', 'running', 'pausing'].includes(state)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const snapRerun = (await api(`/api/projects/${crashId}/pipeline`)).data;
    log('D9 N8 partialAt after successful rerun (期望 null)', { p2PartialAt: snapRerun.stages?.p2?.partialAt ?? null, p2Status: snapRerun.stages?.p2?.status, lastJob: snapRerun.lastJob?.state || null });
  }

  slow.server.close();
  await stopServer('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync('/tmp/t25-probe2-out.json', JSON.stringify(out, null, 2));
  console.log('PROBE_DONE');
}

main().catch(async (error) => {
  console.error('PROBE_FAILED', error?.stack || error);
  try { await stopServer('SIGKILL'); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  fs.writeFileSync('/tmp/t25-probe2-out.json', JSON.stringify(out, null, 2));
  process.exit(1);
});
