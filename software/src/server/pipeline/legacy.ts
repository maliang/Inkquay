import fs from 'node:fs';
import path from 'node:path';
import { backupDir, db, now, uid } from '../db.ts';
import { exportProjectBundle } from '../repository.ts';
import type { MigrationView } from '../../shared/pipeline.ts';
import { activeJob, addRevision, allRows, ensureStages, exec, getProjectRow, oneRow, parseJson, requireProject, setPipelineStatus, updateStage, withTx } from './store.ts';
import { LEDGER_NOTE, fail, kindProfileOf } from './types.ts';
import type { StageKey } from './types.ts';
import { recalcProjectWords } from './steps.ts';
import { acceptDeviation } from './actions.ts';

/**
 * 旧作品 → 流水线模型的一次性升级（MIGRATION.md §3/§4）。
 * 三条硬规矩：①可重入（幂等键 + CREATE/UPDATE 幂等）②可回退（只删新增行、只复位新增列）
 * ③九条校验在事务内、备份在事务外；任一条不过就整笔回滚，旧数据逐字节不动。
 */

export interface MigrationCheck {
  id: string;
  ok: boolean;
  detail: string;
}

/**
 * 迁移时记下的「迁前章节 id 清单」快照 note。
 * 回退靠它区分「迁移前就有的章」与「升级后新建的章」（chapters 没有 created_at 列，N3）。
 */
const LEGACY_CHAPTER_IDS_NOTE = LEDGER_NOTE;

/** 回退结果：在 MigrationView 之外补上「归档/删掉了哪些章」，让用户知道自己的字去哪了。 */
export interface RollbackResult extends MigrationView {
  archivedTitles?: string[];
  deletedTitles?: string[];
  /** 是否拿到了迁移前的章节清单（拿不到时按时间戳兜底判定，结果可能偏保守）。 */
  legacyChapterIdsKnown?: boolean;
}

export interface MigrateOptions {
  forceFail?: boolean;
  actor?: string;
}

interface MigrationRow {
  id: string;
  project_id: string;
  status: string;
  backup_path?: string | null;
  bundle_path?: string | null;
  checks?: string | null;
  error?: string | null;
  started_at: string;
  finished_at?: string | null;
}

function latestMigration(projectId: string): MigrationRow | undefined {
  return oneRow('SELECT * FROM migrations WHERE project_id = ? ORDER BY started_at DESC LIMIT 1', projectId) as MigrationRow | undefined;
}

export function migrationView(projectId: string): MigrationView {
  const project = requireProject(projectId);
  const row = latestMigration(projectId);
  if (!row) {
    return { state: project.pipeline_status && project.pipeline_status !== 'legacy' ? 'none' : 'legacy' };
  }
  return {
    state: (row.status as MigrationView['state']) ?? 'none',
    migrationId: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    backupPath: row.backup_path ?? null,
    checks: parseJson<MigrationCheck[]>(row.checks || '[]', []),
    error: row.error ?? null,
    alreadyMigrated: row.status === 'done',
  };
}

/** C1–C6 前置检查：只读，不产生任何行。 */
export function precheckMigration(projectId: string): { ok: true; project: Record<string, any> } | { ok: false; code: string; message: string; blockers?: string[] } {
  const project = oneRow('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) return { ok: false, code: 'NOT_FOUND', message: '作品不存在' };
  if (project.type !== 'novel' && project.type !== 'short') {
    return { ok: false, code: 'TYPE_NOT_SUPPORTED', message: '剧本与剧集不走流水线，无需升级' };
  }
  const done = oneRow("SELECT * FROM migrations WHERE project_id = ? AND status = 'done'", projectId);
  if (done) return { ok: true, project };
  const stages = Number(oneRow('SELECT COUNT(*) AS n FROM stages WHERE project_id = ?', projectId)?.n || 0);
  if (stages > 0 && String(project.pipeline_status || 'legacy') !== 'legacy') {
    return { ok: false, code: 'BAD_REQUEST', message: '这本已经是流水线作品，不需要升级' };
  }
  const job = activeJob(projectId);
  if (job) return { ok: false, code: 'CONCURRENT_JOB', message: '当前有生成任务进行中，请先等待完成或取消', blockers: [job.id] };
  const acts = Number(oneRow('SELECT COUNT(*) AS n FROM outline_acts WHERE project_id = ?', projectId)?.n || 0);
  const characters = Number(oneRow('SELECT COUNT(*) AS n FROM characters WHERE project_id = ?', projectId)?.n || 0);
  const beats = Number(oneRow('SELECT COUNT(*) AS n FROM outline_beats WHERE project_id = ?', projectId)?.n || 0);
  const chapters = allRows('SELECT id, content FROM chapters WHERE project_id = ?', projectId);
  const hasContent = chapters.some((chapter) => String(chapter.content || '').trim().length > 0);
  if (acts <= 0 && characters <= 0 && beats <= 0 && !hasContent) {
    return {
      ok: false,
      code: 'NOT_MIGRATABLE_EMPTY',
      message: '这本还没有任何可迁移的内容（没有设定、没有大纲、没有正文）。可以直接删除它，或者用 AI 重新企划。',
    };
  }
  return { ok: true, project };
}

function ensureWritableDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch {
    fail('DISK_WRITE_FAILED', '无法写入备份目录，已取消升级');
  }
}

/** 取正文第一段做迁移大纲（F3）：旧稿短篇往往没有大纲，正文首段是最接近「这一节拍讲什么」的语料。 */
function firstParagraph(text: string): string {
  return (
    text
      .split(/\n{2,}/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .find((part) => part.length > 0) || ''
  );
}

function quoteSqlPath(target: string): string {
  return `'${target.replace(/'/g, "''")}'`;
}

export function migrateProject(projectId: string, options: MigrateOptions = {}): MigrationView {
  const precheck = precheckMigration(projectId);
  if (!precheck.ok) fail(precheck.code as any, precheck.message, precheck.blockers ? { blockers: precheck.blockers } : {});
  const existing = latestMigration(projectId);
  if (existing?.status === 'done') {
    return { ...migrationView(projectId), alreadyMigrated: true };
  }
  const project = precheck.project;
  const kind = project.type as 'novel' | 'short';
  kindProfileOf(kind);
  ensureWritableDir(backupDir);

  const migrationId = uid('mig');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `studio.db.bak-${migrationId}`);
  const bundlePath = path.join(backupDir, `${projectId}-${stamp}.bundle.json`);

  // S2 备份（事务外）：VACUUM INTO 得到一致快照，bundle 供用户肉眼核对
  try {
    db.exec(`VACUUM INTO ${quoteSqlPath(backupPath)}`);
    const bundle = exportProjectBundle(projectId);
    fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
  } catch (error) {
    fail('BACKUP_FAILED', '无法创建备份，已取消升级', { detail: (error as Error).message });
  }

  // 留痕：写 running 行（事务外，失败也要能查到）
  const startedAt = now();
  exec(
    "INSERT INTO migrations (id, project_id, kind, from_schema, to_schema, status, backup_path, bundle_path, checks, started_at) VALUES (?, ?, 'legacy-to-pipeline', 1, 2, 'running', ?, ?, '[]', ?)",
    migrationId,
    projectId,
    backupPath,
    bundlePath,
    startedAt,
  );

  const checks: MigrationCheck[] = [];
  try {
    db.prepare('ATTACH DATABASE ? AS bak').run(backupPath);
    try {
      withTx(() => {
        ensureStages(projectId);
        applyMapping(projectId, kind, migrationId, checks, startedAt);
        if (options.forceFail) {
          checks.push({ id: 'V-Force', ok: false, detail: 'PW_MIGRATION_FORCE_FAIL 已开启：故意触发失败以验证回滚' });
        }
        const failed = checks.find((check) => !check.ok);
        if (failed) throw new Error(`MIGRATION_CHECK_FAILED:${failed.id}:${failed.detail}`);
      });
    } finally {
      try {
        db.exec('DETACH DATABASE bak');
      } catch {
        /* 已断开 */
      }
    }
    const finishedAt = now();
    exec(
      "UPDATE migrations SET status = 'done', checks = ?, finished_at = ? WHERE id = ?",
      JSON.stringify(checks),
      finishedAt,
      migrationId,
    );
    // F17：迁移成功的作品不该再背着「升级失败」的 last_error，否则 nextStep 永远停在 retry-failed。
    // schema_version 语义统一为「结构版本」：迁移与回退都保持 2（回退只复位数据语义，不降结构）。
    exec('UPDATE projects SET migration_id = ?, schema_version = 2, pipeline_status = ?, stale = 0, last_error = NULL, updated_at = ? WHERE id = ?', migrationId, 'reviewing', finishedAt, projectId);
    // 旧稿的 P3 总量必然与目标字数不一致，迁移即视为用户接受偏差，否则永远卡在确认门槛。
    acceptDeviation(projectId, true);
    console.log(`[migrate] project=${projectId} id=${migrationId} status=ok checks=${checks.length} backup=${path.basename(backupPath)}`);
    return { ...migrationView(projectId), alreadyMigrated: false };
  } catch (error) {
    const message = (error as Error).message || '升级失败';
    const detail = message.replace(/^MIGRATION_CHECK_FAILED:/, '');
    exec("UPDATE migrations SET status = 'failed', checks = ?, error = ?, finished_at = ? WHERE id = ?", JSON.stringify(checks), detail, now(), migrationId);
    exec('UPDATE projects SET last_error = ?, stale = 1, updated_at = ? WHERE id = ?', JSON.stringify({ code: 'MIGRATION_FAILED', message: detail, at: now(), stageKey: 'p1' }), now(), projectId);
    console.log(`[migrate] project=${projectId} id=${migrationId} status=fail detail=${detail}`);
    fail('MIGRATION_CHECK_FAILED', '升级校验未通过，作品未被修改（已回滚）', { detail });
  }
}

/** S3 + S4：结构补齐 + 九条校验（必须在事务内、bak 已 ATTACH） */
function applyMapping(projectId: string, kind: 'novel' | 'short', migrationId: string, checks: MigrationCheck[], startedAt: string) {
  const timestamp = now();
  const project = oneRow('SELECT * FROM projects WHERE id = ?', projectId)!;

  // ---- 角色/大纲：原地复用，只补流水线字段，绝不猜内容 ----
  exec("UPDATE characters SET source = 'migration' WHERE project_id = ?", projectId);
  exec("UPDATE outline_acts SET source = 'migration' WHERE project_id = ?", projectId);
  exec("UPDATE outline_beats SET source = 'migration' WHERE project_id = ?", projectId);
  exec('UPDATE outline_beats SET planned_chapters = CAST(COALESCE(chapter_no, 1) AS TEXT) WHERE project_id = ?', projectId);

  const acts = Number(oneRow('SELECT COUNT(*) AS n FROM outline_acts WHERE project_id = ?', projectId)?.n || 0);
  const beats = Number(oneRow('SELECT COUNT(*) AS n FROM outline_beats WHERE project_id = ?', projectId)?.n || 0);
  const characters = Number(oneRow('SELECT COUNT(*) AS n FROM characters WHERE project_id = ?', projectId)?.n || 0);

  const snapshot = (stageKey: string, payload: unknown) =>
    addRevision({
      projectId,
      stageKey: stageKey as StageKey,
      scope: 'stage',
      targetId: null,
      source: 'migration',
      content: JSON.stringify({ stage: stageKey, migrationId, payload }),
      note: '迁移快照',
    });

  // ---- P3 / P4 语料先读出来：阶段状态要按真实内容决定，不能凭空倒挂（F3b） ----
  const chapters = allRows('SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, id ASC', projectId);
  let pendingCount = 0;
  let versionMismatch = 0;
  const synopsisPlaceholder = '（迁移自旧稿，可直接改写）';
  for (const [index, chapter] of chapters.entries()) {
    const words = Number(chapter.words || 0);
    const min = Math.max(300, words);
    const max = Math.max(words + 1500, 3000);
    const target = Math.max(words, 3000);
    const content = String(chapter.content || '');
    const beat = oneRow(
      'SELECT summary FROM outline_beats WHERE project_id = ? AND chapter_no = ? ORDER BY sort_order ASC LIMIT 1',
      projectId,
      Number(String(chapter.number || '').replace(/[^0-9]/g, '') || 0),
    );
    // F3：迁移作品必须能直接过 P3 确认，所以大纲要用旧稿已有语料补足，而不是留空串。
    const raw = kind === 'novel' ? String(beat?.summary || '').trim() : firstParagraph(content);
    const synopsis = raw.length >= 15 ? raw.slice(0, 200) : `${raw}${synopsisPlaceholder}`.slice(0, 200);
    const reviewStatus = content.trim() ? 'approved_manual' : 'pending';
    if (!content.trim()) pendingCount += 1;
    const latestVersion = oneRow('SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1', chapter.id);
    let currentVersionId: string | null = null;
    if (latestVersion && String(latestVersion.content || '') === content && content.trim()) currentVersionId = String(latestVersion.id);
    else if (latestVersion && content.trim()) versionMismatch += 1;
    exec(
      `UPDATE chapters SET review_status = ?, plan_function = '迁移（未标注）', plan_synopsis = ?, plan_characters = '[]', min_words = ?, target_words = ?, max_words = ?, plan_locked = 0, current_version_id = ?, stale = 0, sort_order = ?, updated_at = ? WHERE id = ?`,
      reviewStatus,
      synopsis,
      min,
      target,
      max,
      currentVersionId,
      index,
      timestamp,
      chapter.id,
    );
  }

  // ---- P1 / P2 ----
  const p1Snapshot = snapshot('p1', { characters, acts, beats, chapters: chapters.length });
  updateStage(projectId, 'p1', {
    status: characters > 0 || acts > 0 ? 'confirmed' : 'locked',
    confirmed_revision_id: characters > 0 || acts > 0 ? p1Snapshot.id : null,
    confirmed_at: characters > 0 || acts > 0 ? timestamp : null,
    stale: 0,
  });

  const outlineNonEmpty = acts > 0 || beats > 0;
  const p2Snapshot = snapshot('p2', { acts, beats });
  updateStage(projectId, 'p2', {
    status: outlineNonEmpty ? 'confirmed' : 'locked',
    confirmed_revision_id: outlineNonEmpty ? p2Snapshot.id : null,
    confirmed_at: outlineNonEmpty ? timestamp : null,
    stale: 0,
  });

  if (kind === 'short') {
    // 短篇：chapters 1:1 映射成 stage_items(kind='beat_plan')，chapters 行保留。
    // F9：ordinal 跟 chapters 的实际位置（上一步已归一化为 0..n-1）对齐，正文回写才不会串行。
    exec("DELETE FROM stage_items WHERE project_id = ? AND stage_key = 'p3' AND kind = 'beat_plan'", projectId);
    chapters.forEach((chapter, index) => {
      const words = Number(chapter.words || 0);
      const content = String(chapter.content || '');
      const raw = firstParagraph(content);
      const synopsis = raw.length >= 15 ? raw.slice(0, 200) : `${raw}${synopsisPlaceholder}`.slice(0, 200);
      exec(
        `INSERT INTO stage_items (id, project_id, stage_key, kind, ordinal, title, payload, body, words, locked, review_status, source, updated_at)
         VALUES (?, ?, 'p3', 'beat_plan', ?, ?, ?, ?, ?, 0, ?, 'migration', ?)`,
        uid('it'),
        projectId,
        index,
        String(chapter.title || `第${index + 1}节拍`),
        JSON.stringify({
          planFunction: '迁移（未标注）',
          planSynopsis: synopsis,
          minWords: Math.max(300, words),
          plannedWords: Math.max(words, 1500),
          maxWords: Math.max(words + 1200, 3000),
          plannedChapters: String(index + 1),
        }),
        content,
        words,
        content.trim() ? 'approved_manual' : 'pending',
        timestamp,
      );
    });
  }

  // N3：回退要能区分「迁移前就存在的章」和「升级后新建的章」。chapters 表没有 created_at 列，
  // 用 `updated_at > finished_at AND plan_function <> '迁移（未标注）'` 猜会把「改过功能列的旧章」
  // 误判成升级后新增 —— 有正文就被归档（listUnits 过滤 archived_at，章节从书和导出里消失）。
  // 所以迁移时把旧章 id 清单记进一条迁移快照，回退时按清单判定。
  addRevision({
    projectId,
    stageKey: 'p3',
    scope: 'stage',
    targetId: null,
    source: 'migration',
    content: JSON.stringify({ legacyChapterIds: chapters.map((chapter) => String(chapter.id)) }),
    note: LEGACY_CHAPTER_IDS_NOTE,
  });

  // F3b：阶段不能倒挂 —— P3 只有前置都确认过才给 review，P4 迁移后一律 empty（等人工逐章确认）。
  const upstreamReady = characters > 0 || acts > 0 ? outlineNonEmpty : false;
  const p3Ready = upstreamReady && chapters.length > 0;
  snapshot('p3', { units: chapters.length });
  updateStage(projectId, 'p3', {
    status: p3Ready ? 'review' : 'locked',
    confirmed_revision_id: null,
    confirmed_at: null,
    stale: 0,
  });
  snapshot('p4', { chapters: chapters.length, pending: pendingCount });
  updateStage(projectId, 'p4', {
    status: p3Ready ? 'review' : 'locked',
    confirmed_revision_id: null,
    confirmed_at: null,
    stale: 0,
  });
  recalcProjectWords(projectId);
  setPipelineStatus(projectId, 'reviewing');

  // ---- 九条校验（对 bak 比，避免自己跟自己比） ----
  const bakChapters = allRows('SELECT * FROM bak.chapters WHERE project_id = ? ORDER BY sort_order ASC', projectId);
  checks.push({
    id: 'V1',
    ok: bakChapters.length === chapters.length,
    detail: `章节数 ${bakChapters.length} vs ${chapters.length}`,
  });
  let mismatched = 0;
  for (const before of bakChapters) {
    const after = oneRow('SELECT content FROM chapters WHERE id = ?', before.id);
    if (String(before.content || '') !== String(after?.content || '')) mismatched += 1;
  }
  checks.push({ id: 'V2', ok: mismatched === 0, detail: mismatched === 0 ? '章正文逐字节一致' : `${mismatched} 章正文不一致` });
  let wordsMismatch = 0;
  for (const before of bakChapters) {
    const after = oneRow('SELECT words FROM chapters WHERE id = ?', before.id);
    if (Number(before.words || 0) !== Number(after?.words || 0)) wordsMismatch += 1;
  }
  checks.push({ id: 'V3', ok: wordsMismatch === 0, detail: wordsMismatch === 0 ? '字数一致' : `${wordsMismatch} 章字数不一致` });
  const bakVersions = allRows('SELECT * FROM bak.chapter_versions WHERE project_id = ?', projectId);
  const afterVersions = allRows('SELECT * FROM chapter_versions WHERE project_id = ?', projectId);
  const versionContentSame = bakVersions.every((before) => {
    const after = afterVersions.find((row) => row.id === before.id);
    return after && String(after.content || '') === String(before.content || '');
  });
  checks.push({
    id: 'V4',
    ok: bakVersions.length === afterVersions.length && versionContentSame,
    detail: `版本数 ${bakVersions.length} vs ${afterVersions.length}${versionContentSame ? '，正文一致' : '，正文不一致'}`,
  });
  const bakCharacters = allRows('SELECT id, name FROM bak.characters WHERE project_id = ?', projectId);
  const afterCharacters = allRows('SELECT id, name FROM characters WHERE project_id = ?', projectId);
  const bakActs = allRows('SELECT id, title, summary FROM bak.outline_acts WHERE project_id = ?', projectId);
  const afterActs = allRows('SELECT id, title, summary FROM outline_acts WHERE project_id = ?', projectId);
  const bakBeats = allRows('SELECT id, title, summary FROM bak.outline_beats WHERE project_id = ?', projectId);
  const afterBeats = allRows('SELECT id, title, summary FROM outline_beats WHERE project_id = ?', projectId);
  const rowsSame = (left: Array<Record<string, any>>, right: Array<Record<string, any>>, keys: string[]) =>
    left.length === right.length &&
    left.every((row) => {
      const other = right.find((candidate) => candidate.id === row.id);
      return other && keys.every((key) => String(row[key] ?? '') === String(other[key] ?? ''));
    });
  checks.push({
    id: 'V5',
    ok: rowsSame(bakCharacters, afterCharacters, ['name']) && rowsSame(bakActs, afterActs, ['title', 'summary']) && rowsSame(bakBeats, afterBeats, ['title', 'summary']),
    detail: `人物 ${bakCharacters.length}、幕 ${bakActs.length}、节拍 ${bakBeats.length}`,
  });
  const bakScenes = Number(oneRow('SELECT COUNT(*) AS n FROM bak.scenes WHERE project_id = ?', projectId)?.n || 0);
  const afterScenes = Number(oneRow('SELECT COUNT(*) AS n FROM scenes WHERE project_id = ?', projectId)?.n || 0);
  const bakShots = Number(oneRow('SELECT COUNT(*) AS n FROM bak.shots WHERE project_id = ?', projectId)?.n || 0);
  const afterShots = Number(oneRow('SELECT COUNT(*) AS n FROM shots WHERE project_id = ?', projectId)?.n || 0);
  const bakForeshadows = Number(oneRow('SELECT COUNT(*) AS n FROM bak.foreshadows WHERE project_id = ?', projectId)?.n || 0);
  const afterForeshadows = Number(oneRow('SELECT COUNT(*) AS n FROM foreshadows WHERE project_id = ?', projectId)?.n || 0);
  checks.push({
    id: 'V6',
    ok: bakScenes === afterScenes && bakShots === afterShots && bakForeshadows === afterForeshadows,
    detail: `场景 ${afterScenes}、分镜 ${afterShots}、伏笔 ${afterForeshadows}`,
  });
  const bakProject = oneRow('SELECT * FROM bak.projects WHERE id = ?', projectId)!;
  const metaSame = ['title', 'type', 'goal_words', 'cover', 'description', 'created_at'].every(
    (key) => String(bakProject[key] ?? '') === String(project[key] ?? ''),
  );
  checks.push({ id: 'V7', ok: metaSame, detail: metaSame ? '项目元数据一致' : '项目元数据被改动' });
  // F13：V8 不再是恒真常量 —— 迁移路径一旦真的调过模型，就会留下 job 或 ai_messages。
  const jobsDuring = Number(oneRow('SELECT COUNT(*) AS n FROM generation_jobs WHERE project_id = ? AND started_at >= ?', projectId, startedAt)?.n || 0);
  const messagesDuring = Number(oneRow('SELECT COUNT(*) AS n FROM ai_messages WHERE project_id = ? AND created_at >= ?', projectId, startedAt)?.n || 0);
  checks.push({
    id: 'V8',
    ok: jobsDuring === 0 && messagesDuring === 0,
    detail: `升级期间新建生成任务 ${jobsDuring} 个、AI 消息 ${messagesDuring} 条（应均为 0）`,
  });
  // F13：V9 改成逐项枚举，并给出可判定的断言（有主版本的章，主版本正文必须与当前正文一致）。
  const versionRows = chapters.map((chapter) => {
    const currentId = oneRow('SELECT current_version_id FROM chapters WHERE id = ?', chapter.id)?.current_version_id as string | null;
    if (!currentId) return { id: chapter.id, aligned: null as boolean | null };
    const version = oneRow('SELECT content FROM chapter_versions WHERE id = ?', currentId);
    return { id: chapter.id, aligned: Boolean(version) && String(version?.content || '') === String(chapter.content || '') };
  });
  const alignedRows = versionRows.filter((row) => row.aligned === true).length;
  const danglingRows = versionRows.filter((row) => row.aligned === false).length;
  checks.push({
    id: 'V9',
    ok: danglingRows === 0,
    detail: `主版本对齐 ${alignedRows} 章、无主版本 ${versionRows.filter((row) => row.aligned === null).length} 章、主版本与正文不一致 ${danglingRows} 章（正文与版本均未改动，${versionMismatch} 章因内容差异未挂主版本）`,
  });
}

export function recoverInterruptedMigrations(): void {
  const stale = allRows("SELECT id, project_id, started_at FROM migrations WHERE status = 'running'");
  for (const row of stale) {
    const age = Date.now() - (Date.parse(String(row.started_at)) || 0);
    if (age > 10 * 60 * 1000) {
      exec("UPDATE migrations SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", '升级进程中断（已超过 10 分钟未完成）', now(), row.id);
      console.log(`[migrate] project=${row.project_id} id=${row.id} status=fail reason=interrupted`);
    }
  }
}

/** §8.1 单作品回退：只删新增行、只复位新增列；旧数据一字不动。 */
export function rollbackMigration(projectId: string, mode: 'sql' | 'file', confirm: boolean): RollbackResult {
  requireProject(projectId);
  const done = oneRow("SELECT * FROM migrations WHERE project_id = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1", projectId) as MigrationRow | undefined;
  if (!done) fail('BAD_REQUEST', '这本还没有升级过，无需回退');
  const job = activeJob(projectId);
  if (job) fail('CONCURRENT_JOB', '当前有生成任务进行中，请先取消');
  if (mode === 'file') {
    fail('BAD_REQUEST', '数据库文件级回退需要在应用退出后手动执行（把备份文件覆盖回 studio.db）', {
      detail: done.backup_path || '',
    });
  }
  const finishedAt = done.finished_at || done.started_at;
  // F4：守卫必须与 confirm 解耦 —— 只要升级后产生过新内容，就必须显式确认才允许回退，
  // 否则「回退会丢新稿」的提示永远走不到（原实现 confirm=false 在更前面就 return 了）。
  const migratedPlan = '迁移（未标注）';
  const touched: string[] = [];
  const laterVersions = Number(oneRow('SELECT COUNT(*) AS n FROM chapter_versions WHERE project_id = ? AND created_at > ?', projectId, finishedAt)?.n || 0);
  if (laterVersions) touched.push(`升级后新增 ${laterVersions} 条版本`);
  const laterStages = Number(oneRow('SELECT COUNT(*) AS n FROM stages WHERE project_id = ? AND confirmed_at > ?', projectId, finishedAt)?.n || 0);
  if (laterStages) touched.push(`升级后确认过 ${laterStages} 个阶段`);
  // 短篇改稿只写 stage_items.body + revisions，不产生 chapter_versions；而确认过的阶段一旦被编辑，
  // confirmed_at 又会被清空。只数版本会漏掉这两类「升级后确实写过东西」，所以把非迁移来源的修订
  // 与审阅记录也算进来，回退守卫才不会对「升级后已改过稿」的作品放行。
  const laterRevisions = Number(
    oneRow("SELECT COUNT(*) AS n FROM revisions WHERE project_id = ? AND created_at > ? AND source <> 'migration'", projectId, finishedAt)?.n || 0,
  );
  if (laterRevisions) touched.push(`升级后新增 ${laterRevisions} 次编辑或重生成`);
  const laterReviews = Number(oneRow('SELECT COUNT(*) AS n FROM review_records WHERE project_id = ? AND created_at > ?', projectId, finishedAt)?.n || 0);
  if (laterReviews) touched.push(`升级后审阅过 ${laterReviews} 次`);
  // N3：新章判定按迁移时记下的「迁前章节 id 清单」，不用 `updated_at + plan_function` 猜 ——
  // 后者会把「改过功能列的迁移老章」当成升级后新增，有正文就直接归档，用户的字从书里消失。
  const legacyIdsRow = oneRow('SELECT content FROM revisions WHERE project_id = ? AND note = ? ORDER BY created_at DESC LIMIT 1', projectId, LEGACY_CHAPTER_IDS_NOTE);
  let legacyIds: Set<string> | null = null;
  if (legacyIdsRow) {
    try {
      const parsed = JSON.parse(String(legacyIdsRow.content || '{}')) as { legacyChapterIds?: unknown };
      if (Array.isArray(parsed.legacyChapterIds)) legacyIds = new Set(parsed.legacyChapterIds.map((id) => String(id)));
    } catch {
      legacyIds = null;
    }
  }
  const chapterRows = allRows(
    'SELECT id, title, content, updated_at, plan_function, archived_at, deleted_at FROM chapters WHERE project_id = ?',
    projectId,
  );
  const isNewChapter = (row: Record<string, any>) =>
    legacyIds
      ? !legacyIds.has(String(row.id))
      : String(row.updated_at || '') > String(finishedAt) && String(row.plan_function || '') !== migratedPlan;
  const laterChapterRows = chapterRows.filter((row) => isNewChapter(row) && !row.archived_at && !row.deleted_at);
  if (laterChapterRows.length) touched.push(`升级后新增 ${laterChapterRows.length} 章/节拍`);
  if (touched.length && !confirm) fail('CONFIRM_BLOCKED', '升级后已有新内容，回退会丢掉它们', { blockers: touched });
  if (!confirm) fail('BAD_REQUEST', '回退需要显式确认（confirm=true）');

  const archivedTitles: string[] = [];
  const deletedTitles: string[] = [];
  withTx(() => {
    // ① 只删「升级之后新增」的行；迁移前就存在的旧数据一条不动（F4）。
    exec('DELETE FROM chapter_versions WHERE project_id = ? AND created_at > ?', projectId, finishedAt);
    // N7：迁移期写进去的 stage_items（P1/P2 条目、短篇 beat_plan）即便没被改过也要清掉，
    // 否则回退后阶段视图还挂着 review、短篇 /units 仍能读到迁移产物，用户以为没退成功。
    exec(
      "DELETE FROM stage_items WHERE project_id = ? AND (updated_at > ? OR source = 'migration')",
      projectId,
      finishedAt,
    );
    // 升级后新建且还没有正文的章直接删；已有正文的只归档，不物理删用户的字。
    // 两条都以 isNewChapter 为准，并把标题带回响应，用户才知道哪些章被收起来了。
    for (const row of laterChapterRows) {
      const title = String(row.title || row.id);
      if (String(row.content || '').trim()) {
        exec('UPDATE chapters SET archived_at = ? WHERE id = ?', now(), String(row.id));
        archivedTitles.push(title);
      } else {
        exec('DELETE FROM chapters WHERE id = ?', String(row.id));
        deletedTitles.push(title);
      }
    }
    // ② 删流水线结构行与其产生的修订/任务/审阅记录
    exec('DELETE FROM stages WHERE project_id = ?', projectId);
    exec('DELETE FROM revisions WHERE project_id = ?', projectId);
    exec('DELETE FROM generation_jobs WHERE project_id = ?', projectId);
    exec('DELETE FROM review_records WHERE project_id = ?', projectId);
    exec('DELETE FROM migrations WHERE project_id = ?', projectId);
    // ③ 复位新增列（SQLite 不能 DROP COLUMN）+ 语义回到 legacy；
    // schema_version 统一表示「结构版本」，回退不降结构，所以保持 2。
    exec(
      "UPDATE projects SET pipeline_status = 'legacy', stale = 0, last_error = NULL, migration_id = NULL, schema_version = 2, updated_at = ? WHERE id = ?",
      now(),
      projectId,
    );
    exec(
      `UPDATE chapters SET review_status = '', plan_function = '', plan_synopsis = '', plan_characters = '[]', min_words = NULL, target_words = NULL, max_words = NULL, plan_locked = 0, current_version_id = NULL, stale = 0, last_error = NULL WHERE project_id = ?`,
      projectId,
    );
    exec("UPDATE characters SET source = 'manual' WHERE project_id = ?", projectId);
    exec("UPDATE outline_acts SET source = 'manual' WHERE project_id = ?", projectId);
    exec("UPDATE outline_beats SET source = 'manual' WHERE project_id = ?", projectId);
  });
  exec(
    "INSERT INTO migrations (id, project_id, kind, from_schema, to_schema, status, started_at, finished_at, error) VALUES (?, ?, 'legacy-to-pipeline', 2, 2, 'rolled_back', ?, ?, ?)",
    uid('mig'),
    projectId,
    now(),
    now(),
    '用户回退（数据回到升级前，结构保持 v2）',
  );
  console.log(`[migrate] project=${projectId} status=rolled_back archived=${archivedTitles.length} deleted=${deletedTitles.length}`);
  return {
    ...migrationView(projectId),
    state: 'rolled_back' as const,
    archivedTitles,
    deletedTitles,
    legacyChapterIdsKnown: Boolean(legacyIds),
  };
}
