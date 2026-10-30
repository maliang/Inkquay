const BASE = 'http://127.0.0.1:5821';
const j = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  return { status: res.status, body, raw: text };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(pid, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const snap = await j(`/api/projects/${pid}/pipeline`);
    const job = snap.body.job;
    if (!job) return snap.body;
    if (['done', 'failed', 'cancelled', 'interrupted'].includes(job.state)) return snap.body;
    await sleep(400);
  }
  throw new Error('job timeout');
}
const out = (label, v) => console.log(`\n### ${label}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);

// 1. default model = mock
out('settings', (await j('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) })).status);

// 2. create novel pipeline project
const created = await j('/api/projects', { method: 'POST', body: JSON.stringify({ title: '评审探针-长篇', type: 'novel', premise: '一个铁匠的女儿在海边醒来，发现自己能听见潮汐的名字。', targetWords: 30000, start: 'pipeline' }) });
out('create', { status: created.status, project: created.body.project?.id, job: created.body.job?.id, err: created.body.code });
const pid = created.body.project.id;

for (const stage of ['p1', 'p2']) {
  let snap = await waitJob(pid);
  out(`${stage} after job`, { stageStatus: snap.stages[stage].status, items: snap.stages[stage].counts, lastError: snap.lastError, jobState: snap.job?.state });
  const conf = await j(`/api/projects/${pid}/stages/${stage}/confirm`, { method: 'POST', body: '{}' });
  out(`confirm ${stage}`, { status: conf.status, code: conf.body.code, blockers: conf.body.blockers?.map((b) => b.message) });
  const start = await j(`/api/projects/${pid}/pipeline/start`, { method: 'POST', body: JSON.stringify({ stage: stage === 'p1' ? 'p2' : 'p3' }) });
  out(`start ${stage === 'p1' ? 'p2' : 'p3'}`, { status: start.status, code: start.body.code, job: start.body.job?.id });
}

let snap = await waitJob(pid);
out('p3 after plan job', { status: snap.stages.p3.status, counts: snap.stages.p3.counts, lastError: snap.lastError, nextStep: snap.nextStep });
const units = (await j(`/api/projects/${pid}/units`)).body;
out('units', { n: units.units.length, first: units.units[0] && { id: units.units[0].id, title: units.units[0].title, targetWords: units.units[0].targetWords } });

// 3. edit a plan unit -> manual revision, then restore it (F1)
const u = units.units[0];
const patched = await j(`/api/projects/${pid}/stages/p3/units/${u.id}`, { method: 'PATCH', body: JSON.stringify({ targetWords: (u.targetWords || 3000) + 200 }) });
out('patchUnit', { status: patched.status, code: patched.body.code, targetWords: patched.body.summary?.units?.[0]?.targetWords });
const revs = await j(`/api/projects/${pid}/stages/p3/revisions?targetId=${u.id}`);
const revList = revs.body.revisions || [];
out('revisions', { status: revs.status, n: revList.length, items: revList.map((r) => ({ id: r.id, source: r.source, scope: r.scope })) });
const manual = revList.find((r) => r.source === 'manual') || revList[0];
const restore = await j(`/api/projects/${pid}/items/${u.id}/revisions/${manual.id}/restore`, { method: 'POST', body: '{}' });
out('RESTORE chapter_plan revision', { status: restore.status, contentTypeBody: String(restore.raw).slice(0, 300) });
console.log('\nPID=' + pid);
