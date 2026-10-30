// t24 复审用：短篇「升级 → 回退」之后，迁移生成的 beat_plan stage_items 是否被清掉。
// 期望：回退 = 回到升级前 —— /units 为空、/pipeline 说这是旧作品、正文仍在。
const BASE = 'http://127.0.0.1:5826';
const j = async (p, i = {}) => {
  const r = await fetch(BASE + p, { ...i, headers: { 'content-type': 'application/json', ...(i.headers || {}) } });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 300); }
  return { status: r.status, body: b };
};
const out = (l, v) => console.log(`\n### ${l}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);

await j('/api/settings', { method: 'PUT', body: JSON.stringify({ defaultModel: { providerId: 'mock', modelId: 'mock-writer' } }) });

const created = await j('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ title: '短篇回退探针', type: 'short', premise: '海边小镇的一个下午', targetWords: 6000 }),
});
const pid = created.body.project.id;
out('created', { status: created.status, pid, chapters: created.body.project.chapters?.length });
const chapter = created.body.project.chapters[0];
if (chapter) {
  await j(`/api/chapters/${chapter.id}`, { method: 'PATCH', body: JSON.stringify({ content: '海风把晒着的渔网吹得发响。\n\n她把最后一页稿纸压在石头下面。' }) });
}

const beforeUnits = await j(`/api/projects/${pid}/units`);
out('units before migrate', { status: beforeUnits.status, count: beforeUnits.body.units?.length ?? null });

const migrated = await j(`/api/projects/${pid}/migrate`, { method: 'POST', body: '{}' });
out('migrate', { status: migrated.status, state: migrated.body.migration?.state, code: migrated.body.code, msg: migrated.body.message });
const afterUnits = await j(`/api/projects/${pid}/units`);
out('units after migrate', { count: afterUnits.body.units?.length ?? null, titles: (afterUnits.body.units || []).map((u) => u.title) });

const rollback = await j(`/api/projects/${pid}/migrate/rollback`, { method: 'POST', body: JSON.stringify({ mode: 'sql', confirm: true }) });
out('rollback', { status: rollback.status, state: rollback.body.migration?.state, archived: rollback.body.migration?.archivedTitles, deleted: rollback.body.migration?.deletedTitles });

const unitsAfterRollback = await j(`/api/projects/${pid}/units`);
out('units after rollback (期望 0)', { status: unitsAfterRollback.status, count: unitsAfterRollback.body.units?.length ?? null, titles: (unitsAfterRollback.body.units || []).map((u) => u.title) });

const snapAfter = await j(`/api/projects/${pid}/pipeline`);
out('pipeline after rollback', { status: snapAfter.status, pipelineStatus: snapAfter.body.project?.pipelineStatus, next: snapAfter.body.nextStep?.kind, stages: snapAfter.body.stages ? Object.fromEntries(Object.entries(snapAfter.body.stages).map(([k, v]) => [k, v.status])) : null });

// 再迁移一次：看重复行
const remigrated = await j(`/api/projects/${pid}/migrate`, { method: 'POST', body: '{}' });
out('re-migrate', { status: remigrated.status, state: remigrated.body.migration?.state, code: remigrated.body.code, msg: remigrated.body.message });
const unitsAfterRemigrate = await j(`/api/projects/${pid}/units`);
out('units after re-migrate (期望与原章数相同)', { count: unitsAfterRemigrate.body.units?.length ?? null, titles: (unitsAfterRemigrate.body.units || []).map((u) => u.title) });

const proj = await j(`/api/projects/${pid}`);
out('book chapters', (proj.body.project.chapters || []).map((c) => ({ title: c.title, words: c.words, content: String(c.content || '').slice(0, 12) })));
