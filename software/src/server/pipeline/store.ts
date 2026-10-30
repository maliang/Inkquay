import type { DatabaseSync } from 'node:sqlite';
import { db, countWords, now, uid } from '../db.ts';
import type { PipelineItem, Revision } from '../../shared/pipeline.ts';
import { LEDGER_NOTE, STAGE_KEYS, fail } from './types.ts';
import type { JobKind, JobStatus, RevisionSource, StageKey, StageStatus, UnitReviewStatus } from './types.ts';

export type Row = Record<string, any>;
export type Db = DatabaseSync;

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function allRows(sql: string, ...params: Array<string | number | null>): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

export function oneRow(sql: string, ...params: Array<string | number | null>): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

export function exec(sql: string, ...params: Array<string | number | null>) {
  return db.prepare(sql).run(...params);
}

/**
 * BEGIN IMMEDIATE + 显式回滚。node:sqlite 是同步 API，
 * 因此「事务里绝不做网络调用」这条纪律由调用方保证（ARCHITECTURE §3.4）。
 *
 * 支持嵌套（F1）：外层用 BEGIN IMMEDIATE，内层用 SAVEPOINT/RELEASE，
 * 于是「恢复历史版本」这类组合动作可以在自己的事务里复用别的写函数，
 * 不必为了避开 `cannot start a transaction within a transaction` 复制实现。
 */
let txDepth = 0;
let savepointSeq = 0;

export function withTx<T>(fn: () => T): T {
  if (txDepth > 0) {
    const name = `pw_sp_${(savepointSeq += 1)}`;
    db.exec(`SAVEPOINT ${name}`);
    txDepth += 1;
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      try {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
      } catch {}
      throw error;
    } finally {
      txDepth -= 1;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    txDepth = 0;
  }
}

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  title: string;
  type: string;
  genre: string;
  description: string;
  cover: string;
  status: string;
  total_words: number;
  goal_words: number;
  pipeline_status: string;
  stale: number;
  last_error: string | null;
  migration_id: string | null;
  schema_version: number;
  style_notes: string;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
}

export function getProjectRow(projectId: string): ProjectRow | undefined {
  return oneRow('SELECT * FROM projects WHERE id = ?', projectId) as ProjectRow | undefined;
}

export function requireProject(projectId: string): ProjectRow {
  const row = getProjectRow(projectId);
  if (!row) fail('NOT_FOUND', '作品不存在');
  return row;
}

export function kindOf(projectId: string): 'novel' | 'short' {
  const row = requireProject(projectId);
  if (row.type === 'novel') return 'novel';
  if (row.type === 'short') return 'short';
  return fail('TYPE_NOT_SUPPORTED', `「${row.type}」不进 AI 流水线`);
}

export function touchProject(projectId: string) {
  exec('UPDATE projects SET updated_at = ? WHERE id = ?', now(), projectId);
}

export function setPipelineStatus(projectId: string, status: string) {
  exec('UPDATE projects SET pipeline_status = ?, updated_at = ? WHERE id = ?', status, now(), projectId);
}

export function setProjectLastError(projectId: string, error: { code: string; message: string; stageKey?: string; unitId?: string } | null) {
  exec('UPDATE projects SET last_error = ?, stale = ?, updated_at = ? WHERE id = ?', error ? JSON.stringify({ ...error, at: now() }) : null, error ? 1 : 0, now(), projectId);
}

export function projectLastError(projectId: string): { code: string; message: string; at: string; stageKey?: string; unitId?: string } | null {
  const row = getProjectRow(projectId);
  return parseJson(row?.last_error ?? null, null);
}

// ---------------------------------------------------------------------------
// stages
// ---------------------------------------------------------------------------

export interface StageRow {
  id: string;
  project_id: string;
  stage_key: StageKey;
  status: StageStatus;
  stale: number;
  skipped: number;
  confirmed_revision_id: string | null;
  confirmed_at: string | null;
  last_error: string | null;
  partial_at: string | null;
  updated_at: string;
}

export function stageRows(projectId: string): StageRow[] {
  const rows = allRows('SELECT * FROM stages WHERE project_id = ? ORDER BY stage_key ASC', projectId) as StageRow[];
  return rows;
}

export function getStage(projectId: string, stageKey: StageKey): StageRow | undefined {
  return oneRow('SELECT * FROM stages WHERE project_id = ? AND stage_key = ?', projectId, stageKey) as StageRow | undefined;
}

export function insertStage(projectId: string, stageKey: StageKey, status: StageStatus = 'locked', stamp = now()): string {
  const id = uid('stg');
  exec(
    'INSERT INTO stages (id, project_id, stage_key, status, stale, skipped, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?)',
    id,
    projectId,
    stageKey,
    status,
    stamp,
  );
  return id;
}

export function ensureStages(projectId: string) {
  for (const key of STAGE_KEYS) {
    if (!getStage(projectId, key)) insertStage(projectId, key, key === 'p1' ? 'empty' : 'locked');
  }
}

export function updateStage(
  projectId: string,
  stageKey: StageKey,
  patch: Partial<{ status: StageStatus; stale: number; skipped: number; confirmed_revision_id: string | null; confirmed_at: string | null; last_error: string | null; partial_at: string | null }>,
) {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number | null);
  }
  fields.push('updated_at = ?');
  values.push(now());
  values.push(projectId, stageKey);
  exec(`UPDATE stages SET ${fields.join(', ')} WHERE project_id = ? AND stage_key = ?`, ...values);
}

const DOWNSTREAM: Record<StageKey, StageKey[]> = {
  p1: ['p2', 'p3', 'p4'],
  p2: ['p3', 'p4'],
  p3: ['p4'],
  p4: [],
};

/**
 * 只有「已经有产物」的阶段才值得提示复核（F19）：
 * empty/locked 的下游本来就要重新生成，标 stale 只会让 nextStep 和横幅说废话。
 */
const STALE_WORTHY: StageStatus[] = ['review', 'confirmed', 'generating'];

/**
 * stale 原因单独存（F11）：`stages.last_error` 只放失败。
 * 原来两件事挤一列，一次上游编辑就会把真正的失败原因覆盖掉。
 */
function staleReasonKey(projectId: string, stageKey: StageKey): string {
  return `stale_reason:${projectId}:${stageKey}`;
}

export function setStaleReason(projectId: string, stageKey: StageKey, reason: string | null) {
  const key = staleReasonKey(projectId, stageKey);
  if (!reason) {
    exec('DELETE FROM app_meta WHERE key = ?', key);
    return;
  }
  exec('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, reason);
}

export function staleReasonOf(projectId: string, stageKey: StageKey): string | null {
  const row = oneRow('SELECT value FROM app_meta WHERE key = ?', staleReasonKey(projectId, stageKey));
  return row ? String(row.value) : null;
}

/** 上游变更只标 stale，不删下游内容（SPEC R1/D2）。 */
export function markDownstreamStale(projectId: string, fromStage: StageKey, reason: string) {
  for (const key of DOWNSTREAM[fromStage]) {
    const stage = getStage(projectId, key);
    if (!stage) continue;
    if (!STALE_WORTHY.includes(stage.status)) {
      // 空阶段无需复核提示：保持干净，避免「上游已变更」对着空白页面出现。
      if (Number(stage.stale) === 1) updateStage(projectId, key, { stale: 0 });
      setStaleReason(projectId, key, null);
      continue;
    }
    updateStage(projectId, key, { stale: 1 });
    setStaleReason(projectId, key, reason);
  }
}

/**
 * 阶段状态唯一写入口（F12）：保证 `confirmed_*` 与 status 的不变式——
 * 只有 confirmed 才可能带确认快照，其余状态一律把快照指针清空。
 */
export function setStageStatus(

  projectId: string,
  stageKey: StageKey,
  status: StageStatus,
  extra: Partial<{ confirmed_revision_id: string | null; confirmed_at: string | null; skipped: number; last_error: string | null }> = {},
) {
  const patch: Parameters<typeof updateStage>[2] = { status, ...extra };
  if (status !== 'confirmed') {
    patch.confirmed_revision_id = null;
    patch.confirmed_at = null;
  }
  updateStage(projectId, stageKey, patch);
}

export function clearStale(projectId: string, stageKey: StageKey, status?: StageStatus) {
  if (status) setStageStatus(projectId, stageKey, status);
  updateStage(projectId, stageKey, { stale: 0 });
  setStaleReason(projectId, stageKey, null);
}

// ---------------------------------------------------------------------------
// revisions
// ---------------------------------------------------------------------------

export function addRevision(input: {
  projectId: string;
  stageKey: StageKey;
  scope: 'stage' | 'item';
  targetId?: string | null;
  source: RevisionSource;
  content: string;
  contentKind?: 'json' | 'text';
  note?: string;
  jobId?: string | null;
}): Revision {
  const id = uid('rev');
  const createdAt = now();
  exec(
    `INSERT INTO revisions (id, project_id, stage_key, scope, target_id, source, note, content, content_kind, job_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.projectId,
    input.stageKey,
    input.scope,
    input.targetId ?? null,
    input.source,
    input.note ?? '',
    input.content,
    input.contentKind ?? 'json',
    input.jobId ?? null,
    createdAt,
  );
  return {
    id,
    projectId: input.projectId,
    stageKey: input.stageKey,
    scope: input.scope,
    targetId: input.targetId ?? null,
    source: input.source,
    note: input.note ?? '',
    content: input.content,
    contentKind: input.contentKind ?? 'json',
    jobId: input.jobId ?? null,
    createdAt,
  };
}

function revisionFromRow(row: Row): Revision {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    stageKey: row.stage_key as StageKey,
    scope: row.scope as 'stage' | 'item',
    targetId: (row.target_id as string | null) ?? null,
    source: String(row.source),
    note: String(row.note || ''),
    content: String(row.content),
    contentKind: (row.content_kind as 'json' | 'text') ?? 'json',
    jobId: (row.job_id as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function listRevisions(projectId: string, stageKey: StageKey, targetId?: string | null): Revision[] {
  // N10：迁移记账快照（note = LEDGER_NOTE）是回滚用的内部账本，不是创作历史；
  // 阶段级列表把它排除，否则用户会在 P3 修订历史里看到一条「迁移前章节清单」的假快照。
  const rows = targetId
    ? allRows('SELECT * FROM revisions WHERE project_id = ? AND stage_key = ? AND target_id = ? ORDER BY created_at DESC, id DESC', projectId, stageKey, targetId)
    : allRows(
        "SELECT * FROM revisions WHERE project_id = ? AND stage_key = ? AND COALESCE(note, '') <> ? ORDER BY created_at DESC, id DESC",
        projectId,
        stageKey,
        LEDGER_NOTE,
      );
  return rows.map(revisionFromRow);
}

export function countRevisions(targetId: string): number {
  const row = oneRow('SELECT COUNT(*) AS n FROM revisions WHERE target_id = ?', targetId);
  return Number(row?.n || 0);
}

export function latestRevision(projectId: string, targetId: string): Revision | undefined {
  const row = oneRow('SELECT * FROM revisions WHERE project_id = ? AND target_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', projectId, targetId);
  return row ? revisionFromRow(row) : undefined;
}

/** 只保留每个 target 最近的 50 条 item 级修订；阶段确认快照永不裁剪。 */
export function pruneItemRevisions(projectId: string, targetId: string, keep = 50) {
  exec(
    `DELETE FROM revisions WHERE project_id = ? AND target_id = ? AND scope = 'item' AND id NOT IN (
       SELECT id FROM revisions WHERE project_id = ? AND target_id = ? AND scope = 'item' ORDER BY created_at DESC, id DESC LIMIT ?
     )`,
    projectId,
    targetId,
    projectId,
    targetId,
    keep,
  );
}

// ---------------------------------------------------------------------------
// stage_items
// ---------------------------------------------------------------------------

export interface StageItemRow {
  id: string;
  project_id: string;
  stage_key: StageKey;
  kind: string;
  ordinal: number;
  title: string;
  payload: string;
  body: string;
  words: number;
  locked: number;
  review_status: UnitReviewStatus;
  current_revision_id: string | null;
  source: string;
  error_code: string | null;
  archived_at: string | null;
  updated_at: string;
}

export function listStageItemRows(projectId: string, stageKey: StageKey, kind?: string): StageItemRow[] {
  const rows = kind
    ? allRows(
        'SELECT * FROM stage_items WHERE project_id = ? AND stage_key = ? AND kind = ? AND archived_at IS NULL ORDER BY ordinal ASC, id ASC',
        projectId,
        stageKey,
        kind,
      )
    : allRows('SELECT * FROM stage_items WHERE project_id = ? AND stage_key = ? AND archived_at IS NULL ORDER BY ordinal ASC, id ASC', projectId, stageKey);
  return rows as StageItemRow[];
}

export function getStageItemRow(id: string): StageItemRow | undefined {
  return oneRow('SELECT * FROM stage_items WHERE id = ?', id) as StageItemRow | undefined;
}

export function insertStageItem(input: {
  projectId: string;
  stageKey: StageKey;
  kind: string;
  ordinal: number;
  title: string;
  payload?: Record<string, unknown>;
  body?: string;
  reviewStatus?: UnitReviewStatus | '';
  source?: string;
  locked?: boolean;
}): string {
  const id = uid('itm');
  const body = input.body ?? '';
  exec(
    `INSERT INTO stage_items (id, project_id, stage_key, kind, ordinal, title, payload, body, words, locked, review_status, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.projectId,
    input.stageKey,
    input.kind,
    input.ordinal,
    input.title,
    JSON.stringify(input.payload ?? {}),
    body,
    countWords(body),
    input.locked ? 1 : 0,
    input.reviewStatus ?? 'pending',
    input.source ?? 'ai',
    now(),
  );
  return id;
}

export function updateStageItem(
  id: string,
  patch: Partial<{
    title: string;
    payload: Record<string, unknown>;
    body: string;
    words: number;
    locked: boolean;
    review_status: UnitReviewStatus | '';
    current_revision_id: string | null;
    error_code: string | null;
    archived_at: string | null;
    source: string;
    ordinal: number;
  }>,
) {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'payload') values.push(JSON.stringify(value));
    else if (key === 'locked') values.push(value ? 1 : 0);
    else values.push(value as string | number | null);
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);
  exec(`UPDATE stage_items SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

// ---------------------------------------------------------------------------
// units（长篇 = chapters，短篇 = stage_items(kind='beat_plan')）
// ---------------------------------------------------------------------------

export interface UnitRow {
  id: string;
  projectId: string;
  kind: 'chapter' | 'beat';
  ordinal: number;
  title: string;
  reviewStatus: UnitReviewStatus | '';
  words: number;
  minWords: number | null;
  targetWords: number | null;
  maxWords: number | null;
  planFunction: string;
  planSynopsis: string;
  planCharacters: string[];
  locked: boolean;
  targetManual: boolean;
  content: string;
  stale: boolean;
  /** 这一行是迁移带进来的旧稿（`source='migration'`），确认门槛对它放宽。 */
  source: string;
}

function unitFromChapter(row: Row): UnitRow {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: 'chapter',
    ordinal: Number(row.sort_order || 0),
    title: String(row.title || ''),
    reviewStatus: (row.review_status || '') as UnitReviewStatus | '',
    words: Number(row.words || 0),
    minWords: row.min_words === null || row.min_words === undefined ? null : Number(row.min_words),
    targetWords: row.target_words === null || row.target_words === undefined ? null : Number(row.target_words),
    maxWords: row.max_words === null || row.max_words === undefined ? null : Number(row.max_words),
    planFunction: String(row.plan_function || ''),
    planSynopsis: String(row.plan_synopsis || ''),
    planCharacters: parseJson<string[]>(row.plan_characters, []),
    locked: Boolean(row.plan_locked),
    targetManual: Boolean(row.target_manual),
    content: String(row.content || ''),
    stale: Boolean(row.stale),
    source: String(row.source || ''),
  };
}

function unitFromItem(row: StageItemRow): UnitRow {
  const payload = parseJson<Record<string, any>>(row.payload, {});
  return {
    id: row.id,
    projectId: row.project_id,
    kind: 'beat',
    targetManual: false,
    ordinal: Number(row.ordinal || 0),
    title: row.title,
    reviewStatus: row.review_status,
    words: Number(row.words || 0),
    minWords: payload.minWords === undefined ? null : Number(payload.minWords),
    targetWords: payload.plannedWords === undefined ? null : Number(payload.plannedWords),
    maxWords: payload.maxWords === undefined ? null : Number(payload.maxWords),
    planFunction: String(payload.planFunction || ''),
    planSynopsis: String(payload.planSynopsis || ''),
    planCharacters: Array.isArray(payload.characters) ? payload.characters.map(String) : [],
    locked: Boolean(row.locked),
    content: row.body || '',
    stale: false,
    source: row.source,
  };
}

export function listUnits(projectId: string): UnitRow[] {
  const kind = kindOf(projectId);
  if (kind === 'novel') {
    const rows = allRows(
      "SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY sort_order ASC, id ASC",
      projectId,
    );
    return rows.map(unitFromChapter);
  }
  return listStageItemRows(projectId, 'p3', 'beat_plan').map(unitFromItem);
}

export function getUnitRow(projectId: string, unitId: string): UnitRow | undefined {
  return listUnits(projectId).find((unit) => unit.id === unitId);
}

export function requireUnit(projectId: string, unitId: string): UnitRow {
  const unit = getUnitRow(projectId, unitId);
  if (!unit) fail('NOT_FOUND', '找不到这一章');
  return unit;
}

export function setUnitStatus(projectId: string, unitId: string, status: UnitReviewStatus | '', extra: { words?: number; errorCode?: string | null } = {}) {
  const kind = kindOf(projectId);
  if (kind === 'novel') {
    const fields = ['review_status = ?'];
    const values: Array<string | number | null> = [status];
    if (extra.words !== undefined) {
      fields.push('words = ?');
      values.push(extra.words);
    }
    fields.push('last_error = ?');
    values.push(extra.errorCode ? JSON.stringify({ code: extra.errorCode }) : null);
    fields.push('updated_at = ?');
    values.push(now());
    values.push(unitId);
    exec(`UPDATE chapters SET ${fields.join(', ')} WHERE id = ?`, ...values);
    return;
  }
  const patch: Parameters<typeof updateStageItem>[1] = { review_status: status };
  if (extra.words !== undefined) patch.words = extra.words;
  if (extra.errorCode !== undefined) patch.error_code = extra.errorCode;
  updateStageItem(unitId, patch);
}

export function countUnitsByStatus(projectId: string): Record<string, number> {
  const units = listUnits(projectId);
  const counts: Record<string, number> = {};
  for (const unit of units) {
    const key = unit.reviewStatus || 'pending';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// items（统一条目视图）
// ---------------------------------------------------------------------------

function itemFromStageItem(row: StageItemRow, stageKey: StageKey): PipelineItem {
  const payload = parseJson<Record<string, unknown>>(row.payload, {});
  return {
    id: row.id,
    kind: row.kind,
    stageKey,
    ordinal: Number(row.ordinal || 0),
    title: row.title,
    payload,
    locked: Boolean(row.locked),
    source: row.source,
    stale: false,
    revisionCount: countRevisions(row.id),
    updatedAt: row.updated_at,
    ...(row.body ? { body: row.body } : {}),
    ...(row.kind === 'beat_plan'
      ? {
          unit: {
            reviewStatus: row.review_status,
            words: Number(row.words || 0),
            min: payload.minWords === undefined ? null : Number(payload.minWords),
            target: payload.plannedWords === undefined ? null : Number(payload.plannedWords),
            max: payload.maxWords === undefined ? null : Number(payload.maxWords),
          },
        }
      : {}),
  };
}

function itemFromCharacter(row: Row): PipelineItem {
  return {
    id: String(row.id),
    kind: 'character',
    stageKey: 'p1',
    ordinal: Number(row.sort_order || 0),
    title: String(row.name || ''),
    payload: {
      name: row.name,
      role: row.role,
      age: row.age,
      tags: parseJson<string[]>(row.tags, []),
      quote: row.quote,
      description: row.description,
      secret: row.secret,
      motivation: row.motivation || '',
      arc: row.arc || '',
      isProtagonist: Boolean(row.is_protagonist),
    },
    locked: Boolean(row.locked),
    source: String(row.source || 'manual'),
    stale: false,
    revisionCount: countRevisions(String(row.id)),
    updatedAt: null,
  };
}

function itemFromAct(row: Row): PipelineItem {
  return {
    id: String(row.id),
    kind: 'act',
    stageKey: 'p2',
    ordinal: Number(row.sort_order || 0),
    title: String(row.title || ''),
    payload: {
      summary: row.summary || '',
      function: row.act_function || '',
      characters: parseJson<string[]>(row.characters, []),
    },
    locked: Boolean(row.locked),
    source: String(row.source || 'manual'),
    stale: false,
    revisionCount: countRevisions(String(row.id)),
    updatedAt: null,
  };
}

function itemFromBeat(row: Row): PipelineItem {
  return {
    id: String(row.id),
    kind: 'beat',
    stageKey: 'p2',
    ordinal: Number(row.sort_order || 0),
    title: String(row.title || ''),
    payload: {
      actId: row.act_id,
      chapterNo: Number(row.chapter_no || 0),
      summary: row.summary || '',
      function: row.beat_function || '',
      plannedChapters: Number(row.planned_chapters || 1),
      foreshadow: row.foreshadow || '',
      tags: parseJson<string[]>(row.tags, []),
    },
    locked: Boolean(row.locked),
    source: String(row.source || 'manual'),
    stale: false,
    revisionCount: countRevisions(String(row.id)),
    updatedAt: null,
  };
}

function itemFromChapter(row: Row, stageKey: StageKey): PipelineItem {
  return {
    id: String(row.id),
    kind: stageKey === 'p4' ? 'chapter' : 'chapter_plan',
    stageKey,
    ordinal: Number(row.sort_order || 0),
    title: String(row.title || ''),
    payload: {
      volume: row.volume || '',
      number: row.number || '',
      function: row.plan_function || '',
      synopsis: row.plan_synopsis || '',
      characters: parseJson<string[]>(row.plan_characters, []),
      minWords: row.min_words,
      targetWords: row.target_words,
      maxWords: row.max_words,
      targetManual: Boolean(row.target_manual),
      status: row.status || '',
    },
    locked: Boolean(row.plan_locked),
    source: 'ai',
    stale: Boolean(row.stale),
    revisionCount: countRevisions(String(row.id)),
    updatedAt: String(row.updated_at || ''),
    ...(stageKey === 'p4' && row.content ? { body: String(row.content) } : {}),
    unit: {
      reviewStatus: (row.review_status || '') as UnitReviewStatus | '',
      words: Number(row.words || 0),
      min: row.min_words === null || row.min_words === undefined ? null : Number(row.min_words),
      target: row.target_words === null || row.target_words === undefined ? null : Number(row.target_words),
      max: row.max_words === null || row.max_words === undefined ? null : Number(row.max_words),
    },
  };
}

export function listItems(projectId: string, stageKey: StageKey): PipelineItem[] {
  const kind = kindOf(projectId);
  if (stageKey === 'p1') {
    const items = listStageItemRows(projectId, 'p1').map((row) => itemFromStageItem(row, 'p1'));
    const characters = allRows('SELECT * FROM characters WHERE project_id = ? ORDER BY sort_order ASC', projectId).map(itemFromCharacter);
    return [...items, ...characters].sort((a, b) => a.ordinal - b.ordinal);
  }
  if (stageKey === 'p2') {
    if (kind === 'short') {
      return listStageItemRows(projectId, 'p2').map((row) => itemFromStageItem(row, 'p2'));
    }
    const acts = allRows('SELECT * FROM outline_acts WHERE project_id = ? ORDER BY sort_order ASC', projectId).map(itemFromAct);
    const beats = allRows('SELECT * FROM outline_beats WHERE project_id = ? ORDER BY sort_order ASC', projectId).map(itemFromBeat);
    return [...acts, ...beats];
  }
  if (stageKey === 'p3') {
    if (kind === 'short') return listStageItemRows(projectId, 'p3', 'beat_plan').map((row) => itemFromStageItem(row, 'p3'));
    return allRows("SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY sort_order ASC", projectId).map((row) =>
      itemFromChapter(row, 'p3'),
    );
  }
  if (kind === 'short') return listStageItemRows(projectId, 'p3', 'beat_plan').map((row) => itemFromStageItem(row, 'p4'));
  return allRows("SELECT * FROM chapters WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY sort_order ASC", projectId).map((row) =>
    itemFromChapter(row, 'p4'),
  );
}

export type ItemTable = 'stage_items' | 'characters' | 'outline_acts' | 'outline_beats' | 'chapters';

export function findItemRow(itemId: string): { table: ItemTable; row: Row } | undefined {
  const stages = oneRow('SELECT * FROM stage_items WHERE id = ?', itemId);
  if (stages) return { table: 'stage_items', row: stages };
  const character = oneRow('SELECT * FROM characters WHERE id = ?', itemId);
  if (character) return { table: 'characters', row: character };
  const act = oneRow('SELECT * FROM outline_acts WHERE id = ?', itemId);
  if (act) return { table: 'outline_acts', row: act };
  const beat = oneRow('SELECT * FROM outline_beats WHERE id = ?', itemId);
  if (beat) return { table: 'outline_beats', row: beat };
  const chapter = oneRow('SELECT * FROM chapters WHERE id = ?', itemId);
  if (chapter) return { table: 'chapters', row: chapter };
  return undefined;
}

/**
 * 条目所属阶段（F15）：不再靠 `row.content` 猜。
 * 一张 chapters 行同时承载「章节计划（p3）」与「正文（p4）」，有正文不等于这次改的是正文；
 * 猜错就会把计划编辑记进 p4 并给错误的下游标 stale。调用方必须给出 hint。
 */
export function stageKeyOfTable(table: ItemTable, row: Row, hint?: StageKey): StageKey {
  if (table === 'stage_items') return (row.stage_key as StageKey) || hint || 'p1';
  if (table === 'characters') return 'p1';
  if (table === 'outline_acts' || table === 'outline_beats') return 'p2';
  return hint || 'p3';
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------

export interface JobRow {
  id: string;
  project_id: string;
  stage_key: StageKey;
  kind: JobKind;
  status: JobStatus;
  step: string | null;
  step_index: number;
  step_total: number;
  progress: string;
  provider_id: string | null;
  model_id: string | null;
  usage: string | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: number;
  pause_requested: number;
  stop_mode: string | null;
  current_unit_id: string | null;
  retry_of_id: string | null;
  client_request_id: string | null;
  started_at: string;
  finished_at: string | null;
  heartbeat_at: string | null;
}

export function getJob(jobId: string): JobRow | undefined {
  return oneRow('SELECT * FROM generation_jobs WHERE id = ?', jobId) as JobRow | undefined;
}

export function requireJob(jobId: string): JobRow {
  const job = getJob(jobId);
  if (!job) fail('NOT_FOUND', '找不到这个生成任务');
  return job;
}

export function activeJob(projectId: string): JobRow | undefined {
  return oneRow("SELECT * FROM generation_jobs WHERE project_id = ? AND status IN ('queued','running') ORDER BY started_at DESC LIMIT 1", projectId) as JobRow | undefined;
}

export function latestJob(projectId: string): JobRow | undefined {
  return oneRow('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1', projectId) as JobRow | undefined;
}

export function latestJobByStatus(projectId: string, statuses: JobStatus[]): JobRow | undefined {
  const marks = statuses.map(() => '?').join(',');
  return oneRow(`SELECT * FROM generation_jobs WHERE project_id = ? AND status IN (${marks}) ORDER BY started_at DESC LIMIT 1`, projectId, ...statuses) as JobRow | undefined;
}

export function listJobs(projectId: string, limit = 20): JobRow[] {
  return allRows('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?', projectId, limit) as JobRow[];
}

export function insertJob(input: {
  projectId: string;
  stageKey: StageKey;
  kind: JobKind;
  plan: Array<{ op: string; targetId?: string }>;
  stepTotal: number;
  retryOfId?: string | null;
  clientRequestId?: string | null;
  note?: string;
  unitsTotal?: number;
}): JobRow {
  const id = uid('job');
  const startedAt = now();
  exec(
    `INSERT INTO generation_jobs (id, project_id, stage_key, kind, status, step, step_index, step_total, progress, retry_of_id, client_request_id, started_at)
     VALUES (?, ?, ?, ?, 'queued', NULL, 0, ?, ?, ?, ?, ?)`,
    id,
    input.projectId,
    input.stageKey,
    input.kind,
    input.stepTotal,
    JSON.stringify({ plan: input.plan, note: input.note || '', unitsTotal: input.unitsTotal || 0 }),
    input.retryOfId ?? null,
    input.clientRequestId ?? null,
    startedAt,
  );
  return getJob(id)!;
}

/** 条件 UPDATE 抢占：只有 queued 能被抢占，返回是否成功（INV-7）。 */
export function claimJob(jobId: string): boolean {
  const result = exec("UPDATE generation_jobs SET status = 'running', started_at = ? , heartbeat_at = ? WHERE id = ? AND status = 'queued'", now(), now(), jobId);
  return Number(result.changes) === 1;
}

export function updateJob(
  jobId: string,
  patch: Partial<{
    status: JobStatus;
    step: string | null;
    step_index: number;
    step_total: number;
    progress: Record<string, unknown>;
    provider_id: string | null;
    model_id: string | null;
    usage: Record<string, unknown>;
    error_code: string | null;
    error_message: string | null;
    cancel_requested: number;
    pause_requested: number;
    stop_mode: string | null;
    current_unit_id: string | null;
    finished_at: string | null;
    heartbeat_at: string | null;
  }>,
) {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'progress' || key === 'usage') values.push(JSON.stringify(value));
    else values.push(value as string | number | null);
  }
  if (!fields.length) return;
  values.push(jobId);
  exec(`UPDATE generation_jobs SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

export function jobPlanOf(job: JobRow): { plan: Array<{ op: string; targetId?: string }>; note: string; unitsTotal: number } {
  const progress = parseJson<Record<string, any>>(job.progress, {});
  return {
    plan: Array.isArray(progress.plan) ? progress.plan : [],
    note: String(progress.note || ''),
    unitsTotal: Number(progress.unitsTotal || 0),
  };
}

export function setJobPlan(job: JobRow, plan: Array<{ op: string; targetId?: string }>, extra: Record<string, unknown> = {}) {
  const current = parseJson<Record<string, unknown>>(job.progress, {});
  updateJob(job.id, { progress: { ...current, ...extra, plan }, step_total: Math.max(plan.length, job.step_total) });
}

export function appendJobEvent(jobId: string, type: string, payload: Record<string, unknown> = {}) {
  const row = oneRow('SELECT COALESCE(MAX(seq), 0) AS seq FROM job_events WHERE job_id = ?', jobId);
  const seq = Number(row?.seq || 0) + 1;
  exec('INSERT INTO job_events (job_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)', jobId, seq, type, JSON.stringify(payload), now());
}

export function listJobEvents(jobId: string): Array<{ seq: number; type: string; payload: Row; createdAt: string }> {
  return allRows('SELECT * FROM job_events WHERE job_id = ? ORDER BY seq ASC', jobId).map((row) => ({
    seq: Number(row.seq),
    type: String(row.type),
    payload: parseJson<Row>(row.payload, {}),
    createdAt: String(row.created_at),
  }));
}

/** 启动时把上次进程留下的 queued/running 全部标 interrupted（ARCHITECTURE §3.9）。 */
export function recoverInterruptedJobs(): number {
  const rows = allRows("SELECT id, project_id FROM generation_jobs WHERE status IN ('queued','running')");
  for (const row of rows) {
    exec("UPDATE generation_jobs SET status = 'interrupted', error_code = 'INTERRUPTED', error_message = ?, finished_at = ? WHERE id = ?", '生成被中断（已保留已完成部分）', now(), String(row.id));
    appendJobEvent(String(row.id), 'interrupted', {});
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// review records
// ---------------------------------------------------------------------------

export function addReviewRecord(input: { projectId: string; unitKind: string; unitId: string; action: string; note?: string; versionId?: string | null; jobId?: string | null }) {
  exec(
    'INSERT INTO review_records (id, project_id, unit_kind, unit_id, action, note, version_id, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid('rvw'),
    input.projectId,
    input.unitKind,
    input.unitId,
    input.action,
    input.note ?? '',
    input.versionId ?? null,
    input.jobId ?? null,
    now(),
  );
}

export function listReviewRecords(projectId: string, unitId: string): Row[] {
  return allRows('SELECT * FROM review_records WHERE project_id = ? AND unit_id = ? ORDER BY created_at DESC', projectId, unitId);
}

export function projectWordTotal(projectId: string): number {
  const row = oneRow('SELECT COALESCE(SUM(words), 0) AS words FROM chapters WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL', projectId);
  const chapterWords = Number(row?.words || 0);
  const itemRow = oneRow("SELECT COALESCE(SUM(words), 0) AS words FROM stage_items WHERE project_id = ? AND kind = 'beat_plan' AND archived_at IS NULL", projectId);
  return chapterWords + Number(itemRow?.words || 0);
}
