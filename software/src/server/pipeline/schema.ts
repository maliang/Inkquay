import type { DatabaseSync } from 'node:sqlite';

/**
 * 流水线结构（S0）：7 张新表 + 现有表补列 + 索引。
 * 纪律（MIGRATION §2.3）：
 * - 只 CREATE IF NOT EXISTS + PRAGMA 判列，因此可重入、可重复执行；
 * - 判断 schema 版本只认表结构（有没有 stages 表），不认版本号；
 * - 不改既有列的语义，不物理删列（SQLite 也不支持 DROP COLUMN）。
 */
export const PIPELINE_SCHEMA_VERSION = 2;

const PIPELINE_TABLES = `
  CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    scope TEXT NOT NULL,
    target_id TEXT,
    source TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    content_kind TEXT NOT NULL DEFAULT 'json',
    job_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revisions_item ON revisions(project_id, target_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_revisions_stage ON revisions(project_id, stage_key, created_at DESC);

  CREATE TABLE IF NOT EXISTS stages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'locked',
    stale INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    confirmed_revision_id TEXT,
    confirmed_at TEXT,
    last_error TEXT,
    partial_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_stages_project_key ON stages(project_id, stage_key);

  CREATE TABLE IF NOT EXISTS stage_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    body TEXT NOT NULL DEFAULT '',
    words INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    review_status TEXT NOT NULL DEFAULT 'pending',
    current_revision_id TEXT,
    source TEXT NOT NULL DEFAULT 'ai',
    error_code TEXT,
    archived_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stage_items_list ON stage_items(project_id, stage_key, kind, ordinal);

  CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    step TEXT,
    step_index INTEGER NOT NULL DEFAULT 0,
    step_total INTEGER NOT NULL DEFAULT 0,
    progress TEXT NOT NULL DEFAULT '{}',
    provider_id TEXT,
    model_id TEXT,
    usage TEXT,
    error_code TEXT,
    error_message TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    pause_requested INTEGER NOT NULL DEFAULT 0,
    stop_mode TEXT,
    current_unit_id TEXT,
    retry_of_id TEXT,
    client_request_id TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    heartbeat_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON generation_jobs(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_jobs_active ON generation_jobs(status) WHERE status IN ('queued', 'running');
  CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idem ON generation_jobs(project_id, client_request_id) WHERE client_request_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS job_events (
    job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    PRIMARY KEY (job_id, seq)
  );

  CREATE TABLE IF NOT EXISTS review_records (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    unit_kind TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    action TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    version_id TEXT,
    job_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_review_records_unit ON review_records(project_id, unit_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'legacy-to-pipeline',
    from_schema INTEGER NOT NULL,
    to_schema INTEGER NOT NULL,
    status TEXT NOT NULL,
    backup_path TEXT,
    bundle_path TEXT,
    checks TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_migrations_done ON migrations(project_id) WHERE status = 'done';
`;

/** 现有表补列：[列名, 列定义]。全部可空或带默认值，不加 NOT NULL 无默认。 */
const PIPELINE_COLUMNS: Record<string, Array<[string, string]>> = {
  // N4：整阶段重建中途取消/失败要留痕（`partial_at`），旧库靠这里幂等补列。
  stages: [['partial_at', 'TEXT']],
  projects: [
    ['pipeline_status', "TEXT NOT NULL DEFAULT 'legacy'"],
    ['stale', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_error', 'TEXT'],
    ['migration_id', 'TEXT'],
    ['schema_version', 'INTEGER NOT NULL DEFAULT 1'],
    ['style_notes', "TEXT NOT NULL DEFAULT ''"],
    ['client_request_id', 'TEXT'],
  ],
  chapters: [
    // '' 表示「无流水线语义」：旧作品不进流水线时旧读路径完全不看它（MIGRATION D-3）。
    ['review_status', "TEXT NOT NULL DEFAULT ''"],
    ['plan_function', "TEXT NOT NULL DEFAULT ''"],
    ['plan_synopsis', "TEXT NOT NULL DEFAULT ''"],
    ['plan_characters', "TEXT NOT NULL DEFAULT '[]'"],
    ['min_words', 'INTEGER'],
    ['target_words', 'INTEGER'],
    ['max_words', 'INTEGER'],
    ['target_manual', 'INTEGER NOT NULL DEFAULT 0'],
    ['plan_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['current_version_id', 'TEXT'],
    ['stale', 'INTEGER NOT NULL DEFAULT 0'],
    ['archived_at', 'TEXT'],
    ['last_error', 'TEXT'],
  ],
  characters: [
    ['motivation', "TEXT NOT NULL DEFAULT ''"],
    ['arc', "TEXT NOT NULL DEFAULT ''"],
    ['is_protagonist', 'INTEGER NOT NULL DEFAULT 0'],
    ['locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['source', "TEXT NOT NULL DEFAULT 'manual'"],
  ],
  outline_acts: [
    ['act_function', "TEXT NOT NULL DEFAULT ''"],
    ['characters', "TEXT NOT NULL DEFAULT '[]'"],
    ['locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['source', "TEXT NOT NULL DEFAULT 'manual'"],
  ],
  outline_beats: [
    ['beat_function', "TEXT NOT NULL DEFAULT ''"],
    ['planned_chapters', 'INTEGER NOT NULL DEFAULT 1'],
    ['foreshadow', "TEXT NOT NULL DEFAULT ''"],
    ['locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['source', "TEXT NOT NULL DEFAULT 'manual'"],
  ],
};

const PIPELINE_INDEXES = `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_client_req ON projects(client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_chapters_review ON chapters(project_id, review_status, sort_order) WHERE archived_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_chapters_versions_cur ON chapters(project_id, current_version_id);
`;

function addMissingColumns(target: DatabaseSync, table: string, columns: Array<[string, string]>) {
  const existing = target.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const names = new Set(existing.map((column) => column.name));
  for (const [name, definition] of columns) {
    if (names.has(name)) continue;
    target.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

/** 幂等：任何一次启动都可以安全调用。 */
export function ensurePipelineSchema(target: DatabaseSync) {
  target.exec(PIPELINE_TABLES);
  for (const [table, columns] of Object.entries(PIPELINE_COLUMNS)) {
    addMissingColumns(target, table, columns);
  }
  target.exec(PIPELINE_INDEXES);
  target
    .prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(PIPELINE_SCHEMA_VERSION));
}

/** 结构版本只认表结构，不认版本号字符串（MIGRATION §2.3）。 */
export function detectSchemaVersion(target: DatabaseSync): number {
  const row = target.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'stages'").get() as { ok?: number } | undefined;
  return row?.ok ? PIPELINE_SCHEMA_VERSION : 1;
}
