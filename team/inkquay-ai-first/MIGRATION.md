# MIGRATION — 旧作品与库结构的迁移、校验与回退

版本：v1.0（2026-10-28）｜作者：architect（team inkquay-ai-first）
上位文档：`SPEC.md` §9（迁移三原则、六步流程、映射表、九条校验）、`DEFERRED-SCOPE.md`（E3：不做数据可携带；迁移仅是内部结构升级）
配套文档：`ARCHITECTURE.md`（模型与写路径）、`DECISIONS.md`（ADR-8 迁移只用新增列、ADR-9 回退=删新增行）

范围：**只针对本机 `studio.db`（SQLite / `node:sqlite`）**。不做跨机数据可携带、不做云迁移、不导出到第三方格式（导出 md/docx 是既有功能，不在本文范围）。

---

## 1. 目标、边界与三条原则

### 1.1 迁移要解决的问题

新架构要求的"阶段"「条目」「修订」「任务」在旧库里没有物理位置，而旧库里有用户真实写下的**正文与版本**。迁移要同时满足：

| # | 目标 | 判据 |
|---|---|---|
| G1 | 旧作品在升级后仍能打开、继续写、导出 | 升级后 `StudioPage` 打不开任何旧作 = 失败 |
| G2 | 旧作品可选进入新流水线，且不丢正文/版本 | 九条逐字节校验全过（§4.3） |
| G3 | 库结构升级本身零数据损失、可重入、可回退 | 连跑两次 `migrate()` 后全表行数与内容不变 |
| G4 | 用户不做任何操作也不被破坏 | 升级后默认所有旧作品 `pipeline_status='legacy'`，行为与 v0.1.12 一致 |

### 1.2 三条原则（继承 SPEC §9.1，逐条给出实现约束）

| 原则 | 实现约束（可审查） |
|---|---|
| **不迁移也能用** | 升级只做"加表 + 加列"，`projects.pipeline_status` 默认 `'legacy'`；`StudioPage`/`OutlinePage`/`CodexPage` 的旧读路径**一行不改**；流水线页对 `legacy` 作品显示只读横幅 + 迁移入口 |
| **不自动迁移** | 迁移只由用户点击（`POST /api/projects/:id/migrate`）或 `npm run migrate:legacy`（批处理，交互确认）触发；服务启动路径里**没有**任何数据迁移调用 |
| **备份 + 事务 + 校验 + 失败回滚** | 备份先于任何写（§6）；单作品迁移全部写操作在一个 `BEGIN IMMEDIATE` 事务内；校验不过 → `ROLLBACK` 并落一条 `migrations.status='failed'` 记录（该记录在事务外写，否则回滚会把它一起抹掉） |
| **禁止丢正文/版本**（追加，来自派单） | 迁移**从不 UPDATE `chapters.content` / 从不 DELETE `chapter_versions`**；九条校验里第 1、2 条就是逐字节比对正文与版本数 |

### 1.3 明确不做

- 不做 `DROP TABLE/COLUMN`（SQLite 3.35+ 才支持 DROP COLUMN，`node:sqlite` 的 SQLite 版本随 Node 走，不赌）。
- 不做数据格式改写（不改 `tags`/`relations`/`content` 的既有 JSON 或 HTML 形态）。
- 不做"升级时顺手把旧作品全部迁移"的批处理默认开启。
- 不动 `providers` / `settings` / `ai_messages` / `shots` / `scenes` / `foreshadows`（不新增列、不改语义）。

### 1.4 为什么"零数据迁移"也能成立

旧作品一旦进流水线，P1/P2/P3 的条目**物理上复用旧表**（`characters` / `outline_acts` / `outline_beats` / `chapters`，见 ARCHITECTURE §3.3 ADR-3），因此迁移不需要"搬数据"：

- 旧作品已有的 `characters` / `outline_acts` / `outline_beats` / `chapters` 行 → **原地成为** P1/P2/P3 的 items（只补新列的值）。
- 迁移额外要写的只有：`stages`（4 行）、`revisions`（迁移快照）、`migrations`（记录）、以及 `projects`/`chapters`/`characters`/`outline_*` 上的新列。

这就是 ADR-8 的结论：**只用新增列 + 新增表，绝不移动/重写旧行**。它让"回退"退化为"删新增行 + 把新列复位"，可证、可测（§8）。

---

## 2. 库结构升级（S0：幂等、可重入、可回退）

> 本节是 **DDL 的权威版本**（ARCHITECTURE §6 只讲模型与约束映射）。
> 写法沿用仓库既有的幂等补列范式：`db.ts:174-183` 用 `PRAGMA table_info(...)` 判断列是否存在再 `ALTER`。新表一律 `CREATE ... IF NOT EXISTS`。

### 2.1 新表（7 张）

按依赖顺序创建（`revisions` 先于 `stages`，避免 `FOREIGN KEY` 指向未建表；`target_id` 是多态引用，**不设 FK**，由应用层保证）。

```sql
-- 1) 修订历史（INV-2：任何内容先落 revision，再改"当前指针"）
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,              -- p1|p2|p3|p4
  scope TEXT NOT NULL,                  -- stage|item
  target_id TEXT,                       -- scope=item 时指向具体条目；多态，不设 FK
  source TEXT NOT NULL,                 -- ai|manual|migration|retry
  note TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,                -- 快照：stage=整阶段 JSON；item=该条目 JSON 或正文
  content_kind TEXT NOT NULL DEFAULT 'json',  -- json|text
  job_id TEXT,                          -- 产生该修订的任务
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_item
  ON revisions(project_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_stage
  ON revisions(project_id, stage_key, created_at DESC);

-- 2) 阶段状态（每作品 4 行）
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',   -- locked|generating|review|confirmed|failed
  stale INTEGER NOT NULL DEFAULT 0,        -- 上游变更导致"待复核"
  skipped INTEGER NOT NULL DEFAULT 0,      -- P1 可整阶段跳过
  confirmed_revision_id TEXT,              -- 确认时指向 revisions.id（快照永不清）
  confirmed_at TEXT,
  last_error TEXT,                         -- 该阶段最近一次失败的 {code,message,at}
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stages_project_key ON stages(project_id, stage_key);

-- 3) 无旧表归宿的条目（P1 world/env、短篇 P3/P4 beat_plan）
CREATE TABLE IF NOT EXISTS stage_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- world|env|beat_plan
  ordinal INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',      -- JSON（world/env 的结构化字段）
  body TEXT NOT NULL DEFAULT '',           -- 正文（短篇节拍/正文块）
  words INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'pending',
  current_revision_id TEXT,
  source TEXT NOT NULL DEFAULT 'ai',       -- ai|manual|migration
  error_code TEXT,
  archived_at TEXT,                        -- 软删（绝不物理删正文）
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_items_list
  ON stage_items(project_id, stage_key, kind, ordinal);

-- 4) 生成任务（与页面解耦：INV-5）
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- plan|writing
  status TEXT NOT NULL,                     -- queued|running|done|failed|cancelled|interrupted
  step TEXT,                                -- setting|outline|chapter-plan|writing
  step_index INTEGER NOT NULL DEFAULT 0,
  step_total INTEGER NOT NULL DEFAULT 0,
  progress TEXT NOT NULL DEFAULT '{}',      -- JSON：{current, total, label, unitId}
  provider_id TEXT, model_id TEXT,
  usage TEXT,                               -- JSON：tokens 汇总
  error_code TEXT, error_message TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  pause_requested INTEGER NOT NULL DEFAULT 0,
  stop_mode TEXT,                           -- pause|stop|user_cancel|NULL
  current_unit_id TEXT,                     -- P4 当前章节/节拍
  retry_of_id TEXT,                         -- 重试来源 job
  client_request_id TEXT,                   -- 幂等键
  started_at TEXT NOT NULL,
  finished_at TEXT,
  heartbeat_at TEXT                         -- runner 每次 step/心跳更新
);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON generation_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_active
  ON generation_jobs(status) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idem
  ON generation_jobs(project_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- 5) 任务事件（V1 只落库供排障；V1.1 供 SSE 按 seq 重放）
CREATE TABLE IF NOT EXISTS job_events (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- 6) 审阅留痕（与 chapter_versions 互补：一个记内容，一个记动作）
CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_kind TEXT NOT NULL,                  -- chapter|beat
  unit_id TEXT NOT NULL,
  action TEXT NOT NULL,                     -- approve|request_changes|skip|manual_pass|reopen
  note TEXT NOT NULL DEFAULT '',
  version_id TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_records_unit
  ON review_records(project_id, unit_id, created_at DESC);

-- 7) 迁移记录与校验结果
CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'legacy-to-pipeline',
  from_schema INTEGER NOT NULL,
  to_schema INTEGER NOT NULL,
  status TEXT NOT NULL,                     -- done|failed|rolled_back
  backup_path TEXT, bundle_path TEXT,
  checks TEXT NOT NULL DEFAULT '[]',        -- JSON：九条校验逐条 {id, ok, detail}
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_migrations_done
  ON migrations(project_id) WHERE status = 'done';
```

### 2.2 现有表补列（全部"可空或带默认"，不改既有列语义）

幂等写法（照 `db.ts:174-183` 的范式，一个 helper 覆盖全部）：

```ts
const COLUMNS: Record<string, Array<[name: string, ddl: string]>> = {
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
    ['review_status', "TEXT NOT NULL DEFAULT ''"],
    ['plan_function', "TEXT NOT NULL DEFAULT ''"],
    ['plan_synopsis', "TEXT NOT NULL DEFAULT ''"],
    ['plan_characters', "TEXT NOT NULL DEFAULT '[]'"],
    ['min_words', 'INTEGER'], ['target_words', 'INTEGER'], ['max_words', 'INTEGER'],
    ['target_manual', 'INTEGER NOT NULL DEFAULT 0'],
    ['plan_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['current_version_id', 'TEXT'],
    ['stale', 'INTEGER NOT NULL DEFAULT 0'],
    ['archived_at', 'TEXT'],
    ['last_error', 'TEXT'],
  ],
  characters: [['motivation', "TEXT NOT NULL DEFAULT ''"], ['arc', "TEXT NOT NULL DEFAULT ''"],
               ['is_protagonist', 'INTEGER NOT NULL DEFAULT 0'], ['locked', 'INTEGER NOT NULL DEFAULT 0'],
               ['source', "TEXT NOT NULL DEFAULT 'manual'"]],
  outline_acts: [['act_function', "TEXT NOT NULL DEFAULT ''"], ['characters', "TEXT NOT NULL DEFAULT '[]'"],
                 ['locked', 'INTEGER NOT NULL DEFAULT 0'], ['source', "TEXT NOT NULL DEFAULT 'manual'"]],
  outline_beats: [['beat_function', "TEXT NOT NULL DEFAULT ''"], ['planned_chapters', "TEXT NOT NULL DEFAULT ''"],
                  ['foreshadow', "TEXT NOT NULL DEFAULT ''"], ['locked', 'INTEGER NOT NULL DEFAULT 0'],
                  ['source', "TEXT NOT NULL DEFAULT 'manual'"]],
};
// 逐表 PRAGMA table_info → 缺列才 ALTER TABLE ADD COLUMN
```

配套索引（现有表的查询支撑）：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_client_req
  ON projects(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chapters_review
  ON chapters(project_id, review_status, sort_order) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chapters_versions_cur
  ON chapters(project_id, current_version_id);
```

> **`chapters.review_status` 为什么默认 `''` 而不是 `'pending'`**：旧工作的章节从未进流水线，`''` 明确表示"无流水线语义"，列表页/导出/字数统计完全不看它；一旦进流水线被迁移或新生成，才写入 SPEC 的 7 态取值。这样"旧作品行为不变"是一条可断言的属性（§9 V3），而不是靠约定。

### 2.3 schema 版本与"结构升级"记账

```sql
-- app_meta 已有该表，此处只写 key（幂等：INSERT OR REPLACE）
-- key = 'schema_version'，value = '2'
```

| 版本 | 含义 | 升级动作 | 回退动作 |
|---|---|---|---|
| 1 | v0.1.12 及更早（本仓 main `ae75612`） | — | — |
| 2 | 本文件 §2.1+§2.2 的结构 | 加表 + 加列（幂等） | 见 §8.2（旧代码可正常跑，只是不读新表） |

**判断依据只认表结构，不认版本号**：`migrate()` 每次都执行幂等 DDL，最后把 `app_meta.schema_version` 写成实际检测到的版本：

```ts
const hasPipeline = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stages'").get();
const version = hasPipeline ? 2 : 1;   // 不做"版本号决定是否建表"的分支，避免版本号写错就整库不升级
```

### 2.4 可重入与并发保护

- **可重入**：`CREATE ... IF NOT EXISTS` + `PRAGMA table_info` 判列 ⇒ 连跑 N 次结果相同。验收：§9 V1（连跑两次 `migrate()`，`sqlite_master` 表/索引集合与全表行数不变）。
- **并发**：`node:sqlite` 是同步 API，进程内不存在并发迁移；跨进程（用户同时开两个 Inkquay 实例）由 SQLite 的 `BEGIN IMMEDIATE` 与 5s busy_timeout 兜底；`migrate()` 自身在 `BEGIN IMMEDIATE` 内执行（`db.ts:migrate()` 现在无事务，这是 S0 要补的：失败不能留半套结构）。
- **WAL**：`CREATE/ALTER` 在 WAL 模式下安全；备份见 §6（必须用 `VACUUM INTO`，不能只复制 `studio.db`）。

---

## 3. 旧数据 → 目标模型（字段级映射）

> 宏观映射表见 SPEC §9.3（已确认，本文不改其规则）。本节把它落成**字段级、可编码、可断言**的规格，并处理 SPEC 未覆盖的边缘情况。

### 3.1 适用与不适用

| 作品类型 | 是否可迁入流水线 | 理由 |
|---|---|---|
| `novel` | 可以 | P0–P4 齐全 |
| `short` | 可以 | P3 用 `stage_items(kind='beat_plan')` 表达（§3.4） |
| `screenplay` | **不可** | SPEC §2.4：剧本不进流水线，只修无响应与错误提示；`POST /api/projects/:id/migrate` → `422 TYPE_NOT_SUPPORTED` |
| `series` | **不可** | 同上（剧集大纲） |

### 3.2 前置检查（S1）：不满足就拒绝，不产生半套数据

| # | 检查 | 失败 code | 依据 |
|---|---|---|---|
| C1 | 作品存在且 `deleted_at` 语义未删、可读 | `NOT_FOUND` | — |
| C2 | `type ∈ {novel, short}` | `TYPE_NOT_SUPPORTED` | SPEC §2.4 |
| C3 | 该作品无 `queued/running` 任务 | `CONCURRENT_JOB` | INV-7 |
| C4 | 数据目录可写（备份落盘） | `DISK_WRITE_FAILED` | SPEC §9.2 S2 |
| C5 | **已迁移过**（`migrations` 有 `status='done'`） | **幂等返回 200 + 既有记录**（不重复插入） | SPEC §9.5 第 9 条 |
| C6 | **孤儿空壳**：`outline_acts`≤ 0 且 `characters`=0 且 `chapters` 全空正文 | `NOT_MIGRATABLE_EMPTY` | SPEC §3.4 孤儿定义；AUDIT 现场项目 `p_mvru40vy_yx8p3x` 正是此形态，强行迁移只会得到一个"什么都没有的流水线作品" |

> C6 的提示文案必须给出出路：「这个作品没有可迁移的企划内容（旧版企划失败了）。可以直接删除，或用 AI 重新企划。」——它同时是 AUDIT R4「空壳项目」的收尾机制。

### 3.3 长篇（novel）字段级映射

**project（1 行，只改新列）**

| 目标列 | 来源 | 规则 |
|---|---|---|
| `pipeline_status` | — | `'reviewing'`（P1/P2 已 confirmed，P3 待确认）；**迁移失败/回退时为 `'legacy'`** |
| `stale` | — | `0` |
| `schema_version` | — | `2` |
| `premise`（**不新增列**） | `projects.description` | 一句话灵感本来就落在 `description`（`NewProjectModal.tsx:110` 提交 `description: premise`），直接复用，不做列复制；API 的 `premise` 字段 ↔ 该列 |
| `style_notes` | — | `''`，UI 提示"旧作品没有风格约束，可补" |
| `migration_id` | 新 `migrations.id` | 供回退定位 |

**P1 设定**

| 目标 | 来源 | 规则 |
|---|---|---|
| `characters.*` | `characters` 行 | **原地复用，不新增行、不复制**：`name/role/age/avatar/tags/quote/description/secret/relations/sort_order` 全保留；补 `source='migration'`、`locked=0`、`is_protagonist=0`、`motivation=''`、`arc=''`（**不猜**：`role` 含"主角"并不等于作者意图，猜错会让 P2/P4 的 prompt 带着错误设定） |
| P1 `world` / `env` items | 无旧字段 | **不造占位内容**（SPEC §9.3 明令）：不插 `stage_items` 行；P1 阶段状态仍为 `confirmed`（迁移特例），UI 在 P1 面板顶部给出"旧作品没有环境设定，可补充" |
| `stages(p1)` | — | `status='confirmed'`、`confirmed_at=now`、`confirmed_revision_id=<迁移快照 revision>` |
| 迁移快照 revision | 上述 characters+空 world/env | `revisions(scope='stage', stage_key='p1', source='migration', content=JSON)` |

**P2 故事大纲**

| 目标 | 来源 | 规则 |
|---|---|---|
| `outline_acts.*` | `outline_acts` 行 | 原地复用：`title/summary/sort_order` 保留；补 `source='migration'`、`locked=0`、`act_function=''`（显示为「迁移（未标注）」）、`characters='[]'` |
| `outline_beats.*` | `outline_beats` 行 | 原地复用：`act_id/chapter_no/title/summary/tags/status/sort_order` 全保留；补 `source='migration'`、`locked=0`、`beat_function=''`、`planned_chapters = String(chapter_no)`（`chapter_no>0` 时）、`foreshadow=''` |
| 旧 `status`（`待写`/`已用`…） | `outline_beats.status` | **不改**（`OutlinePage` 仍按它渲染）；流水线视图不读该列，另以 `stages(p2).status` 为准 |
| `stages(p2)` | — | `status='confirmed'`（大纲非空时）；`outline_acts` 与 `outline_beats` 都为空 → `status='locked'` 且 P3/P4 保持 `locked`，与 SPEC §9.3「为空则 empty」一致（V1 用 `locked`+`skipped=0` 表达，避免新增枚举值） |
| 迁移快照 revision | acts+beats | `revisions(scope='stage', stage_key='p2', source='migration')` |

**P3 章节计划（复用 `chapters` 计划列，长文不额外建行）**

| 目标列 | 来源 | 规则（照 SPEC §9.3 原文实现） |
|---|---|---|
| `chapters.title` | 原值 | 保留 |
| `plan_function` | — | `'迁移（未标注）'` |
| `plan_synopsis` | `outline_beats` | 取 `chapter_no == chapters.number`（数值化后相等）的 beat `summary`；匹配不到 → `''` |
| `plan_characters` | — | `'[]'`（不猜） |
| `min_words` / `max_words` | `chapters.words` | `min = max(300, words)`；`max = max(words + 1500, 3000)` |
| `target_words` | `chapters.words` | `max(words, 3000)` |
| `plan_locked` | — | `0` |
| `sort_order` | 原值 | 保留（章节顺序不变，`chapters` 的 `idx_chapters_project` 不受影响） |
| `stages(p3)` | — | `status='review'`（计划待用户确认；**不自动确认**，因为功能/大纲字段是"迁移（未标注）"，需要人看一眼） |

**P4 逐章（正文零改动）**

| 目标列 | 来源 | 规则 |
|---|---|---|
| `chapters.content` | 原值 | **逐字节不变**（迁移代码里不允许出现对 content 的 UPDATE） |
| `chapters.words` | 原值 | 不变（不走 `countWords` 重算，避免中文/标点口径差异导致"字数变了"） |
| `chapters.review_status` | `content` 是否为空 | 非空 → `'approved_manual'`（SPEC §9.3：视作已定稿，**防止 AI 覆盖用户原文**）；空 → `'pending'`（UI 标"空章"，允许用户一键删除，但**迁移不删**） |
| `chapters.current_version_id` | `chapter_versions` | 取该章 `created_at DESC` 第一条，且**仅当**其 `content` 与 `chapters.content` 逐字节相等时写入；否则留 `NULL` 并在迁移报告里记 `version_mismatch`（提示"当前正文与最新版本不一致，回滚前请注意"） |
| `chapter_versions.*` | 原表 | **一行不动**（不重排、不截断 40 条上限之外的清理也不在迁移里做） |
| `stages(p4)` | — | 有任一 `review_status='pending'` 的章 → `status='review'`；全部 `approved_manual`/`approved` → `status='confirmed'` |

**不动但要记录的表**

| 表 | 处理 |
|---|---|
| `scenes` / `shots` | 一行不动；迁移报告记录行数（SPEC §9.5 第 6 条要求） |
| `foreshadows` | 一行不动；V1 **不**把伏笔并进 `outline_beats.foreshadow`（ADR-10：伏笔并入节拍需要"哪条伏笔属于哪个节拍"的判断，凭空推断会产出错误大纲；`CodexPage` 仍可编辑） |
| `ai_messages` | 一行不动；迁移报告记录条数与最近一条时间（DOM 上给"历史对话仍保留在编辑器"的说明） |
| `providers` / `settings` | 不读不写 |

### 3.4 短篇（short）字段级映射

短篇复用 P0/P1/P2 的**全部**映射规则（§3.3 的 project/P1/P2 部分逐条相同），差异只在 P3/P4：

| 目标 | 来源 | 规则 |
|---|---|---|
| `stage_items(kind='beat_plan')`（P3 计划 + P4 正文块） | `chapters` 行**按 `sort_order` 顺序逐章 1:1** | `title` = 章标题；`ordinal` = 章序号；`body` = `chapters.content`（逐字节）；`words` = `chapters.words`；`review_status` = 非空 → `approved_manual` / 空 → `pending`；`payload` = `{ planFunction:'迁移（未标注）', planSynopsis:'', plannedWords: target_words }`（字数目标由 `chapters` 的同款公式算出后**写进 payload**，因为短篇不建 `chapters` 行） |
| `chapters` 行本身 | 原表 | **保留不删**（旧短篇作品仍要能被 `StudioPage`/导出读到；`chapters` 与 `stage_items` 在此是同一份正文的两处引用，以 `chapters` 为存储真相，`stage_items.body` 为迁移时的一致性副本——**写入方向**：迁移后流水线 P4 编辑写 `stage_items.body`，并在同事务里把结果回写 `chapters.content`（ADR-12），避免双份漂移） |
| `stages(p3)` / `stages(p4)` | — | 同长篇规则：计划待确认 → `review`；正文全部非空 → `confirmed` |

> **为什么短篇不新增"短篇表"**：`chapters` 是现有导出（md/docx）、字数统计（`recalculateProjectWords` 用 `SUM(words) FROM chapters`，`repository.ts:248`）与版本面板的唯一来源；为短篇另建一套会让这两条链路要么改口径、要么两份数据不一致。`stage_items.body` 只在"节拍粒度"上存在（短篇的 P4 单位是节拍而不是章），两者由 ADR-12 的"同事务回写"绑定。

### 3.5 迁移产出的 revisions 只用于审计

迁移写 `revisions(source='migration')` 的用途：① 让 `stages.confirmed_revision_id` 有指向；② 回退时能证明"哪些内容来自迁移"；③ 用户可以在 P1/P2 历史抽屉里看到"迁移前的原始快照"。它**不是**一个可回滚的编辑版本（`source='migration'` 的 revision 不出现在"恢复到此版本"按钮里，防止用户误把迁移快照套回）。

---

## 4. 单作品迁移算法（S2–S6）

### 4.1 时序与事务边界

```
POST /api/projects/:id/migrate  (或 npm run migrate:legacy -- <projectId>)
 ├─ S1 前置检查（只读）        … C1–C6，任一不过 → 4xx，零写入
 ├─ S2 备份（写盘，事务外）
 │    ├─ VACUUM INTO '<dataDir>/backups/studio.db.bak-<migrationId>'   ← WAL 安全副本
 │    └─ 写 '<dataDir>/backups/<projectId>-<ts>.bundle.json'（GET /bundle 同构）
 ├─ 写 migrations 行（status='running'，事务外）        ← 失败也要留痕
 ├─ BEGIN IMMEDIATE
 │    S3 结构补齐：stages×4 + revisions×n + 新列赋值 + stage_items（短篇）
 │    S4 校验（九条，§4.3；全部在事务内读，读到的就是待提交状态）
 │    ├─ 任一条 fail → ROLLBACK，回写 migrations.status='failed' + checks JSON
 │    └─ 全 pass → COMMIT
 ├─ S5 写 migrations.status='done' + checks + projects.migration_id（事务外，短事务）
 └─ S6 返回 { ok:true, migrationId, checks, viewUrl:'/project/:id/pipeline' }
```

**为什么校验在事务内**：校验读到的必须是"即将提交的库状态"。若先 COMMIT 再校验，失败回滚需要"补偿删除"，而补偿删除本身可能被中断 ⇒ 半套数据。`BEGIN IMMEDIATE` 保证从 S3 到 S4 之间没有其它写者插入。

**为什么 `migrations` 行在事务外写**：ROLLBACK 会把它一起抹掉，而"这次迁移失败了"正是最需要留痕的信息。代价是可能留下 `status='running'` 的孤儿记录（进程崩溃）——启动时由 `recoverInterruptedMigrations()` 扫描 `status='running'` 且 `started_at` 早于 10 分钟的行，改成 `'failed'`（与 job 的 `interrupted` 恢复同一套扫描时机，ARCHITECTURE §3.9）。

### 4.2 幂等键与二次执行

- `migrations` 上 `UNIQUE(project_id) WHERE status='done'` ⇒ 数据库层面禁止同一作品两条成功记录。
- 二次点击升级：C5 命中 → 直接返回既有 `checks` 与 `migrationId`，**不写任何行**（HTTP 200，响应体带 `alreadyMigrated: true`）。
- 若上次是 `failed`/`rolled_back`：允许重试，新 `migrations` 行（旧行保留）；`stages` 行可能残留（如果失败发生在 COMMIT 之后不可能，因为校验在事务内；`failed` 必然是 ROLLBACK 过）⇒ 重试前先 `DELETE FROM stages WHERE project_id=?` 兜底，再重插。

### 4.3 九条校验（逐条实现，SPEC §9.5）

| # | 校验 | 实现要点 | 失败含义 |
|---|---|---|---|
| V1 | 章节数相等 | `SELECT COUNT(*) FROM chapters WHERE project_id=? AND deleted_at IS NULL` 与备份副本比对（备份副本用 `ATTACH` 到备份文件读，避免只比"自己跟自己"） | 结构补齐误删/误加 |
| V2 | 每章 `content` 逐字节相等 | 按 `id` 逐行 `content` 字符串 `===`；**不做 trim、不做换行归一** | 正文被改写（最严重） |
| V3 | 每章 `words` 相等 | 逐行整数相等（不重算） | 字数口径被动过 |
| V4 | `chapter_versions` 行数与内容相等 | 行数 + 每行 `content` 逐字节相等；且"最新版本 vs `chapters.content`"的一致性结论只记录不强判（旧库本就可能不一致） | 版本丢失/被截断 |
| V5 | `characters`/`outline_acts`/`outline_beats` 行数相等且关键字段相等 | 行数 + `name`/`title`/`summary` 逐条相等（按 `id` 对齐） | 条目被清空或复制 |
| V6 | `scenes`/`foreshadows` 行数相等 | 行数相等即可 | 短篇/剧本相关数据丢失 |
| V7 | 项目元数据相等 | `title/type/goal_words/cover/description/created_at` 逐字段相等（新列不在比对范围） | 元数据被改写 |
| V8 | **未调用任何模型** | 迁移代码路径不 import `provider/call.ts`；测试用 `test/fake-provider.mjs` 计数断言 0 次请求（复用 AUDIT 的假供应商） | 迁移偷跑生成 |
| V9 | 二次升级幂等 | 连跑两次 → `stages`/`revisions`/`migrations` 行数不变，第二次返回 `alreadyMigrated` | 重复插入 |

**V1/V5/V6/V7 的比对基准怎么取**：迁移开始时 `ATTACH '<backupPath>' AS bak`，所有"相等"断言都对着 `bak.*`。这样即使实现里误写了旧表，校验也能发现——比"自己跟自己比"强，也是这套校验唯一能真正发现写入副作用的做法。校验完 `DETACH`。

### 4.4 失败的对外语义

| 场景 | HTTP | code | 用户可见文案 | 数据状态 |
|---|---|---|---|---|
| 前置检查不过 | 4xx | `TYPE_NOT_SUPPORTED` / `CONCURRENT_JOB` / `NOT_MIGRATABLE_EMPTY` / `DISK_WRITE_FAILED` | 各自的具体出路（§3.2 表末列） | 未变 |
| 校验失败 | 500 | `MIGRATION_CHECK_FAILED` | "升级校验未通过，作品未被修改（已回滚）。备份在 …，可反馈日志。" | 回滚到迁移前 |
| 备份失败 | 500 | `BACKUP_FAILED` | "无法创建备份，已取消升级。" | 未变 |
| 进程中断 | — | — | 下次启动把 `running` 标 `failed`，界面显示"上次升级未完成，可重试" | 未变（未 COMMIT） |

---

## 5. 批量升级（全库 sweep）

存在价值：升级后用户可能有 10–50 个旧作品，逐个点太慢。提供**显式**批处理，默认不跑。

### 5.1 入口与前置

```
npm run migrate:legacy              # 干跑（默认）：只出报告，不写库
npm run migrate:legacy -- --apply   # 真跑
npm run migrate:legacy -- --apply --project p_xxx   # 单个
```

| 约束 | 实现 |
|---|---|
| 必须先退出 App | 检测 `data/studio.db-wal` 存在且近期有写入？→ 不可靠。改为：启动时尝试 `BEGIN IMMEDIATE`，5s 内拿不到锁即退出并提示"检测到 Inkquay 正在运行，请先退出应用" |
| 有 running job 的作品跳过 | `SELECT project_id FROM generation_jobs WHERE status IN ('queued','running')` |
| 逐作品独立事务 | 一个失败不影响其它（与 §4.1 相同事务边界） |
| 断点续跑 | `migrations(status='done')` 即"已做"；`failed` 可重试；天然幂等（C5） |
| 进度可见 | 复用记忆里的规矩：`(n/N) 作品标题 … ✓ 说明（0.8s）`，每作品一行，失败行标 `✗ code: 文案` |
| 报告落盘 | `<dataDir>/backups/migration-report-<ts>.json`：逐作品 `{id,title,status,checks[],counts,before/after}` |
| 退出码 | 任一失败 → 1（CI/脚本可判） |

### 5.2 干跑报告要回答的问题

用户点不点"升级"，取决于报告能否说明"这个作品迁过去长什么样"。干跑输出（表格 + JSON）：

| 列 | 含义 |
|---|---|
| 作品 | 标题 + 类型 + 字数 |
| 可迁 | `是` / `否 + code`（C2/C6） |
| P1 | `N 人物` / `无设定` |
| P2 | `M 幕 · K 节拍` / `无大纲` |
| P3 | `X 章`（短篇：`X 节拍`） |
| P4 | `Y 章已有正文 / Z 空章` |
| 提示 | 例：`3 章正文与最新版本不一致`、`无环境设定`、`无大纲，迁入后 P2 仍为未生成` |

干跑**只读**：不得写 `migrations` 行、不得写备份（SPEC §9.2 要求"升级前备份"，干跑无副作用）。

---

## 6. 备份与恢复

### 6.1 备份（S2，写盘在事务外）

```ts
// 整库副本：WAL 模式下不能只 copyFile(studio.db)
db.exec(`VACUUM INTO '${backupPath}'`);          // 目标文件必须不存在
```

| 项 | 规定 |
|---|---|
| 命名 | `studio.db.bak-<migrationId>`（migrationId 落 `migrations.backup_path`） |
| 位置 | `<dataDir>/backups/`（`PW_DATA_DIR` 或 `<cwd>/data`，与 `db.ts:6-8` 同口径） |
| 保留 | 每作品最近 3 份成功备份；失败的保留全部（排障用）。超过的在迁移成功后按 `mtime` 清理，并在日志里打印删了哪个 |
| bundle 附带 | 另存 `bundle.json`（`exportProjectBundle` 同构，含 `pipeline` 可选字段）：整库副本是兜底，bundle 是"用户自己能看懂的存档" |
| 磁盘检查 | 备份前 `statfs` 可用空间 ≥ 3×`studio.db` 大小，否则 `DISK_WRITE_FAILED`（备份失败比迁移失败更该早失败） |

### 6.2 为什么不能 `cp studio.db`

WAL 模式下未 checkpoint 的页在 `studio.db-wal` 里；只复制主文件会得到**旧页 + 新索引**的混合体，恢复后表现为"表结构对、数据缺最新几百字"。`VACUUM INTO` 由 SQLite 自己在读事务里导出，是官方推荐的在线备份方式。验收：备份文件 `PRAGMA integrity_check` 返回 `ok`，且 `SELECT MAX(updated_at) FROM chapters` 与源库一致。

### 6.3 从备份恢复（用户可见的唯一手动路径）

```
作品菜单 → 回退到升级前（§8.1）→ 若"升级后已有新内容" → 二次确认 → 覆盖 studio.db
```

恢复步骤固定：① 退出 App（或调用 `POST /api/admin/close-db` 由服务自己释放句柄）；② `studio.db` → `studio.db.pre-rollback-<ts>`；③ 备份文件 → `studio.db`；④ 删除 `studio.db-wal`/`-shm`（否则 WAL 会把旧页重放回来，这是最典型的"恢复了但没生效"）；⑤ 重启 App。

---

## 7. 新旧并存期（legacy 与 pipeline 同一库共存）

| 场景 | 行为 |
|---|---|
| 未迁移旧作品 | `pipeline_status='legacy'`；`/project/:id` 仍进 `StudioPage`（与 v0.1.12 一致）；`/project/:id/pipeline` 显示只读横幅 +「升级」+「继续用编辑器」 |
| 已迁移作品 | 两个入口都在：流水线页（新）与 StudioPage（旧编辑器，可直接改正文）；**同一份数据**，无同步问题 |
| 旧页面写"已迁移作品"的 P1/P2/P3 内容 | 必须经 `pipeline/store.ts` 适配器写（`revisions` + 阶段回到 `review` + 下游 `stale`），否则阶段状态与实际内容脱节 ⇒ 这是 M2/M3 的改造项（`OutlinePage` / `CodexPage` 的保存调用点） |
| 归档章（`chapters.archived_at`） | 旧读路径必须同时加 `archived_at IS NULL` 过滤（`listChapters`、`getProjectDetail`、`exportProject`、`recalculateProjectWords`）。**这是升级阶段就要做的改动**：否则一旦降级回 v0.1.12，归档章会复活，用户看到"删掉的章又回来了" |
| 旧作品被删除 | `ON DELETE CASCADE` 连带清 `stages`/`stage_items`/`revisions`/`generation_jobs`/`review_records`/`migrations`；`chapter_versions` 由现有 FK 级联（`db.ts` 已声明） |

---

## 8. 回退（三条独立路径，别混为一谈）

### 8.1 单作品迁移回退（用户动作，不需换二进制）

因为迁移**只做新增**（ADR-8），回退是精确的：

```sql
BEGIN IMMEDIATE;
DELETE FROM stages          WHERE project_id = ?;
DELETE FROM stage_items     WHERE project_id = ?;     -- 短篇才有
DELETE FROM revisions       WHERE project_id = ? AND source IN ('migration');
DELETE FROM migrations      WHERE project_id = ?;     -- 连同 done 记录
UPDATE projects SET pipeline_status='legacy', stale=0, last_error=NULL,
                    migration_id=NULL, schema_version=2 WHERE id = ?;
-- chapters / characters / outline_* 上由迁移写入的新列复位（见下）
UPDATE chapters SET review_status='', plan_function='', plan_synopsis='',
                    plan_characters='[]', min_words=NULL, target_words=NULL,
                    max_words=NULL, plan_locked=0, current_version_id=NULL,
                    stale=0, last_error=NULL WHERE project_id = ?;
COMMIT;
```

**新列复位的安全前提**：迁移只写这些列的"迁移值"，用户升级后在流水线里的编辑也写同样这些列。所以回退的语义是"放弃升级后的一切流水线元数据"，正对应 SPEC §9.4 的警告语：

- 升级后**没有**新正文/新版本/确认动作（比对 `chapters.updated_at`、`chapter_versions.created_at`、`stages.confirmed_at` 都早于 `migrations.finished_at`）→ 直接执行上面的 SQL，无损耗，**不碰备份文件**；
- 升级后**有**新内容 → 先确认"要丢 N 章正文、M 条修改"（输入确认词）→ 再执行 SQL；`chapters.content` 里升级后 AI 写进的新正文会被保留（因为回退 SQL 不动 content），但 `review_status` 复位后这些章在旧编辑器里表现为"有正文的草稿"——这是可接受的，因为旧流程本来就只看 content；
- 若用户要的是"文件级时间旅行"（连 AI 写的新正文一起回到升级前）→ 走 §6.3 的整库恢复，并明确告知会丢失这些正文。

> **为什么不支持"回退但保留 P1/P2 的阶段视图"**：那等于同时维护两套状态，且没有任何用户价值（要么用新流程，要么用旧流程）。

### 8.2 整库 / 二进制降级（发布回退）

结论：**降级到 v0.1.12 无需回滚库结构**。逐条依据：

| 新结构 | 旧代码会怎样 | 结论 |
|---|---|---|
| 7 张新表 | 旧 `migrate()` 只 `CREATE ... IF NOT EXISTS` 自己认识的表，不删不读别的表 | 无害 |
| `projects` / `chapters` / `characters` / `outline_*` 上的新列 | 旧代码 `INSERT` 列清单显式、`SELECT` 列清单显式或忽略未知键 | 无害（新列都有默认值/可空） |
| `chapters` 归档行 | 旧查询不过滤 `archived_at` | **需在升级阶段就补过滤**（§7），否则"删掉的章复活" |
| `app_meta.schema_version='2'` | 旧代码不认识该 key | 无害 |
| 新版写过的 `pipeline_status='reviewing'` | 旧代码不读 | 无害（作品仍在旧库里，可继续写） |

因此降级只要求一件事：**新代码不得写入旧代码会误解的值**。已核对的三个易踩点：① `chapters.status`（旧枚举 `草稿/…`）不被新代码改写，流水线状态另存 `review_status`；② `projects.status` 不动；③ 不物理删除任何旧行（归档用 `archived_at`）。

### 8.3 回退后必须复验的四条

| # | 断言 |
|---|---|
| MR1 | 作品在 `/project/:id` 正常打开，章节列表/正文/版本面板与回退前一致 |
| MR2 | `SELECT COUNT(*) FROM chapters/characters/outline_acts/outline_beats/chapter_versions WHERE project_id=?` 与迁移前相等 |
| MR3 | 流水线页对该作品显示 `legacy` 横幅，不再显示阶段视图（`[data-testid="migration-banner"][data-state=legacy]`） |
| MR4 | 再次点"升级"能成功（`migrations` 已清，幂等键不残留） |
---

## 9. 验收：可执行命令与实跑输出

> 本节命令分两类：**A 类现在就能跑**（只读盘点，已实跑，输出粘在下面）；**B 类在 M8 实施后才有**（迁移功能落地后按序执行）。
> 库路径统一用 `$DB`；本机安装版实测路径 `/Users/maliang/Library/Application Support/Inkquay/data/studio.db`（v0.1.12 真实数据，只读打开）。

### 9.1 A 类：现状盘点（现在可跑，只读）

```bash
DB="$HOME/Library/Application Support/Inkquay/data/studio.db"
sqlite3 -readonly "$DB" "PRAGMA integrity_check;"
# ok

sqlite3 -readonly "$DB" "select name from sqlite_master where type='table' order by name;" | tr '\n' ' '
# ai_messages app_meta chapter_versions chapters characters foreshadows outline_acts outline_beats projects providers scenes settings shots
# ⇒ 13 张表，无 stages/stage_items/revisions/generation_jobs/job_events/review_records/migrations（S0 后应为 20 张）

sqlite3 -readonly "$DB" "SELECT p.id, p.title FROM projects p WHERE p.type IN ('novel','short')
  AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.project_id=p.id AND length(c.content)>0)
  AND NOT EXISTS (SELECT 1 FROM characters x WHERE x.project_id=p.id)
  AND NOT EXISTS (SELECT 1 FROM outline_beats b WHERE b.project_id=p.id);"
# p_mvru40vy_yx8p3x|修仙日常
# ⇒ C6 孤儿空壳命中：唯一的真实作品不可迁移（3 幕空 summary、0 人物、0 节拍、1 空章、0 版本）
```

同一作品的其他计数（判定 C6 的依据，逐项实跑）：

```bash
sqlite3 -readonly "$DB" "select total_words, goal_words from projects;"        # 0|300000
sqlite3 -readonly "$DB" "select count(*) from chapter_versions;"               # 0
sqlite3 -readonly "$DB" "select id,title,length(summary) from outline_acts;"   # 3 行，summary 长度全为 0
sqlite3 -readonly "$DB" "select count(*) from characters; select count(*) from outline_beats;"  # 0 / 0
sqlite3 -readonly "$DB" "select count(*) from ai_messages;"                    # 0
```

> **结论（迁移视角）**：本机现状是"零可迁移作品 + 一个孤儿空壳"。因此 M8 的迁移功能在当前数据上**没有真实正样本**，验收必须造样本（§9.4 脚本），否则"迁移通过"是空话。

### 9.2 B 类：结构升级验收（S0 发布后）

| # | 命令 | 期望 |
|---|---|---|
| V0-1 | `sqlite3 -readonly "$DB" "select count(*) from sqlite_master where type='table';"` | `20`（13 + 7） |
| V0-2 | 连跑两次升级（重启 App 两次）后再执行 V0-1 与 `select count(*) from sqlite_master where type='index';` | 两次结果**完全相等**（可重入，§2.4） |
| V0-3 | `sqlite3 -readonly "$DB" "select count(*) from projects where pipeline_status<>'legacy';"` | `0`（升级不动旧作品语义） |
| V0-4 | `sqlite3 -readonly "$DB" "select count(*) from chapters where review_status<>'';"` | `0` |
| V0-5 | `sqlite3 -readonly "$DB" "select count(*) from chapters; select count(*) from chapter_versions; select count(*) from characters; select count(*) from outline_acts; select count(*) from outline_beats;"` | 与升级前逐项相等（用 §9.1 的输出做基线：1 / 0 / 0 / 3 / 0） |
| V0-6 | `sqlite3 -readonly "$DB" "PRAGMA integrity_check;"` | `ok` |

### 9.3 B 类：单作品迁移验收（SPEC §9.5 九条，逐条给命令）

迁移后立刻执行（`$BAK` = `migrations.backup_path` 指向的文件）：

```bash
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;"
# V1 章节数
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select (select count(*) from chapters where project_id='$PID' and deleted_at is null)
       = (select count(*) from bak.chapters where project_id='$PID' and deleted_at is null);"        # 1
# V2 正文逐字节（差异行的 id 列表必须为空）
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select c.id from chapters c join bak.chapters b on b.id=c.id
   where c.project_id='$PID' and c.content <> b.content;"                                             # 无输出
# V3 字数
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select c.id from chapters c join bak.chapters b on b.id=c.id
   where c.project_id='$PID' and c.words <> b.words;"                                                  # 无输出
# V4 版本数 + 版本正文逐字节
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select (select count(*) from chapter_versions where project_id='$PID')
       = (select count(*) from bak.chapter_versions where project_id='$PID');
  select v.id from chapter_versions v join bak.chapter_versions b on b.id=v.id
   where v.project_id='$PID' and v.content <> b.content;"                                              # 1 / 无输出
# V5 设定与大纲行数 + 关键字段
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select (select count(*) from characters where project_id='$PID')=(select count(*) from bak.characters where project_id='$PID'),
         (select count(*) from outline_acts where project_id='$PID')=(select count(*) from bak.outline_acts where project_id='$PID'),
         (select count(*) from outline_beats where project_id='$PID')=(select count(*) from bak.outline_beats where project_id='$PID');
  select x.id from characters x join bak.characters b on b.id=x.id where x.project_id='$PID' and (x.name<>b.name or x.role<>b.role);"  # 1|1|1 / 无输出
# V6 scenes / foreshadows
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select (select count(*) from scenes where project_id='$PID')=(select count(*) from bak.scenes where project_id='$PID'),
         (select count(*) from foreshadows where project_id='$PID')=(select count(*) from bak.foreshadows where project_id='$PID');"   # 1|1
# V7 元数据
sqlite3 -readonly "$DB" "ATTACH '$BAK' AS bak;
  select p.id from projects p join bak.projects b on b.id=p.id
   where p.id='$PID' and (p.title<>b.title or p.type<>b.type or p.goal_words<>b.goal_words or p.cover<>b.cover);"  # 无输出
```

| # | 断言 | 方式 |
|---|---|---|
| V8 | 迁移未调用模型 | 迁移代码路径不 import `provider/call.ts`（`grep -n "provider/call" src/server/pipeline/migrate.ts` 应**无输出**）；端到端用 `test/fake-provider.mjs` 计数 0 |
| V9 | 二次升级幂等 | 连点两次「升级」→ 第二次响应 `alreadyMigrated:true`，且 `select count(*) from stages where project_id='$PID';` 仍为 `4`、`select count(*) from migrations where project_id='$PID';` 不增 |

**阶段状态断言**（SPEC §9.3 映射结果）：

```bash
sqlite3 -readonly "$DB" "select stage_key,status,stale from stages where project_id='$PID' order by stage_key;"
# 期望（有 3 幕+节拍的旧作）：p1|confirmed|0  p2|confirmed|0  p3|review|0  p4|review|0
# 期望（人物为空的旧作）  ：p1|confirmed|0  p2|...
sqlite3 -readonly "$DB" "select review_status, count(*) from chapters where project_id='$PID' group by 1;"
# 期望：approved_manual|<有正文的章数>  pending|<空章数>
sqlite3 -readonly "$DB" "select count(*) from chapters where project_id='$PID' and current_version_id is not null;"   # 仅内容与最新版本逐字节一致时 >0
```

### 9.4 造样本（现有数据无可迁移正样本，B 类验收的前置）

`test/fixtures/legacy/` 下三份库文件（迁移测试用，不进安装包）：

| 样本 | 内容 | 用途 |
|---|---|---|
| `legacy-novel-full.db` | 3 幕 × 3 节拍、4 人物（含 relations/tags）、12 章（9 章有正文、3 章空）、每章 2–3 个版本、2 条 foreshadows | 正向全字段 |
| `legacy-short.db` | short 类型、3 章（1 章空）、含 `scenes` 2 行 | 短篇分支 + V6 |
| `legacy-orphan.db` | 3 空幕 + 1 空章、0 人物（复刻 `p_mvru40vy_yx8p3x`） | C6 拒绝路径 |

生成方式：`npm run test:fixtures`（脚本用 `DatabaseSync` 建库，不联网、不调模型）。验收时必须同时跑"三个样本 + 本机真实库"四条路径。

### 9.5 回退验收（§8.3 四条）

| # | 命令 | 期望 |
|---|---|---|
| MR1 | 迁移→回退后打开 `/project/:id`（Playwright 或手工） | 章节列表/正文/版本面板与迁移前一致 |
| MR2 | 回退前后逐表 `count(*)` | 与迁移前基线逐项相等（§9.1 输出） |
| MR3 | 打开 `/project/:id/pipeline` | 显示 `legacy` 横幅，无阶段视图（`[data-testid="migration-banner"][data-state="legacy"]` 存在） |
| MR4 | 再点「升级」 | 成功，`migrations` 新增一条 `done`，`stages` 仍是 4 行 |

---

## 10. 风险与对策

| # | 风险 | 触发条件 | 对策 |
|---|---|---|---|
| M-R1 | 只复制 `studio.db` 当备份 | WAL 有未 checkpoint 页 | §6.1 强制 `VACUUM INTO`；验收断言备份 `<PRAGMA integrity_check>`=ok 且 `MAX(chapters.updated_at)` 一致 |
| M-R2 | 升级过程中被强杀 | 用户 Cmd+Q / 断电 | 校验在事务内 ⇒ 未 COMMIT 即无痕；`migrations.status='running'` 孤儿由启动扫描改 `failed` |
| M-R3 | 降级后归档章复活 | 旧读路径未过滤 `archived_at` | §7 要求升级阶段就补过滤（4 个读路径），并进 M1 的改动清单 |
| M-R4 | 短篇双份正文漂移 | P4 写 `stage_items.body` 未回写 `chapters.content` | ADR-12：同事务回写；验收：短篇 P4 写完 `select content from chapters` 与 `stage_items.body` 逐字节相等 |
| M-R5 | 迁移把"空幕"当有效大纲 | `outline_acts` 有行但 summary 全空（本机现状） | C6 判定不只看行数：`outline_beats`=0 且 characters=0 即视为空壳；且 P2 空 → P3/P4 保持 `locked` |
| M-R6 | 迁移后 P3 计划字段是"迁移（未标注）"却被当成已确认 | 自动 confirmed | 强制 `stages(p3).status='review'`（§3.3），必须人点确认 |
| M-R7 | 老库 `chapters` 有重号（`number` 重复或空） | 用户手工乱序 | P3 计划按 `sort_order` 生成 `ordinal`，`number` 只用于 `plan_synopsis` 的 beat 匹配（匹配不到留空，不报错） |
| M-R8 | 40 条版本上限清理与迁移冲突 | 迁移后新写版本触发清理 | 清理逻辑（`createChapterVersion` 保留 40 条）不在迁移里执行；迁移只写 revisions，不碰 `chapter_versions` |
| M-R9 | 批量迁移与用户同时用 App | 双进程写同一库 | §5.1 `BEGIN IMMEDIATE` 抢锁 + 明示"请先退出 App" |
| M-R10 | `node:sqlite` 版本差异导致 DDL 语法不支持 | 部分索引 / `VACUUM INTO` | 两者在 SQLite 3.27+/3.8+ 即有；Node 22 自带 SQLite 3.46+。验收 V0-1 在目标 Electron 运行时实跑（不能只在 tsx 下验） |

---

## 11. 与 SPEC / 派单要求的偏差（逐条给出理由）

| # | 偏差 | 理由 | 影响面 |
|---|---|---|---|
| D-1 | SPEC §9.3 写 P1「characters 非空 → P1 confirmed（迁移特例，允许环境为空）」；本文加了一条 UI 约束：**一旦用户编辑 P1 就回到 review 并按 §4.2 完整门槛校验** | SPEC 未规定"编辑后门槛怎么恢复"，留空会让"P1 confirmed 但环境为空"永久绕过门槛 | 仅 P1 面板 |
| D-2 | SPEC §9.3 写 P3「功能 = 迁移（未标注）」；本文补 `stages(p3)='review'`（不自动确认） | SPEC §9.3 只给了映射，未给确认状态；P2 自动 confirmed 可以（大纲原样），P3 的"未标注功能"必须人看 | 迁移后首个界面 |
| D-3 | SPEC §9.3 写 P4「空章 → pending（UI 标空章，允许一键删除，但迁移不删）」；本文把 `chapters.review_status` 默认设 `''` 而非 `pending` | 旧作品不能凭空变成"流水线待写章"，否则流水线页一打开就把旧作品标成"待生成"，与 G4（不操作也不被破坏）冲突 | 旧读路径零改动 |
| D-4 | SPEC §9.4 只说"回退"，本文分成三条独立路径（单作品迁移回退 / 整库恢复 / 二进制降级），并给出降级兼容的逐项依据 | 三条路径代价差 3 个数量级，混在一起会让用户以为"回退就是换回旧版本" | 运维与 QA |
| D-5 | 派单要求"迁移必须可重入、可回退"，本文把回退实现为**删新增行 + 复位新增列**（而非"反向 DDL"） | SQLite 不支持 `DROP COLUMN`（且不赌运行时版本）；新增列在迁移前等价于默认值，复位即精确还原 | 回退实现 |
| D-6 | 派单要求"短篇无 chapters 时用 scenes/beats 作等价结构"；本文用 `stage_items(kind='beat_plan')` 而非 `scenes`/`outline_beats` | `scenes` 是剧本（场/分镜）语义，`outline_beats` 属 P2；短篇 P4 的单位是"节拍正文"，需要 `body` 与 `words`，二者语义都不符（详见 DECISIONS ADR-13） | 短篇 P3/P4 |

---

## 12. 复核方式（本文每条断言怎么验的）

| 断言 | 复核命令（本轮实跑） |
|---|---|
| 现有 13 张表、无 pipeline 表 | `sqlite3 -readonly <真实库> "select name from sqlite_master where type='table' order by name;"` |
| 真实库唯一作品是孤儿空壳 | §9.1 的孤儿 SQL + 各表 `count(*)`（实跑输出已粘） |
| 现有补列范式是 `PRAGMA table_info` + `ALTER` | `sed -n 174,183p software/src/server/db.ts` |
| 字数统计只认 `chapters.words` | `repository.ts:248` `SUM(words) FROM chapters` |
| `chapters` 软删列是 `deleted_at`（无 `archived_at`） | `db.ts` 建表语句 + `db.ts:180-182` 补列逻辑 |
| 旧 `INSERT` 均显式列清单（降级安全） | `repository.ts` 中各 `INSERT INTO ... (...)` 语句 |
| 40 条版本上限 | `repository.ts:966-993` `createChapterVersion` |
| SPEC 九条校验编号 | `SPEC.md` §9.5（第 549–600 行内） |
| 字数范围公式 | `SPEC.md` §9.3 P3 行原文 |
