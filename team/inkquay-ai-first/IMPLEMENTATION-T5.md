# IMPLEMENTATION T5 — AI-first 后端流水线（阶段状态机 / 生成任务 / 章节计划 / 迁移）

实现范围：`software/src/server/`、`software/src/shared/pipeline.ts`、`software/scripts/api-test.mjs`。
未改前端（`software/src/client/`、`desktop/`、`.github/` 零改动），未 commit / push。

验证（仓库根目录实跑）：

```
$ pnpm --dir software typecheck      # exit 0
$ pnpm --dir software test           # exit 0，30 组 PASS，末尾 "All API tests passed."
```

---

## 1. 模块地图

| 文件 | 职责 |
|---|---|
| `src/shared/pipeline.ts` | 前后端共用契约：`StageKey`/`StageView`/`NextStepKind(15)`/`JobView`/`PipelineSnapshot`/`PipelineItem`/`Revision`/`MigrationView`/`ReviewActionInput` |
| `src/server/pipeline/schema.ts` | 7 张新表 DDL + 现有 5 表补列（PRAGMA 判列）+ 4 个新索引 + `detectSchemaVersion()`（只认表结构，不认版本号） |
| `src/server/pipeline/types.ts` | `KIND_PROFILE`（长篇/短篇）、`WORD_PRESETS`、`PipelineErrorException`、18+ 错误码 → HTTP 状态映射、`STEP_TIMEOUT_MS=120s` 等常量 |
| `src/server/pipeline/store.ts` | 唯一 DB 访问层：`withTx`(BEGIN IMMEDIATE)、stages/revisions/stage_items/units/jobs/events/review 的读写、`UnitRow` 适配器（chapters ↔ stage_items） |
| `src/server/provider/call.ts` | 单步模型调用：选择解析、reasoning 降级、超时+abort 组合、429/网络重试 1 次、`EMPTY_OUTPUT` 守卫、OpenAI/Anthropic/Google 三家族 + mock |
| `src/server/pipeline/validate.ts` | 手写结构校验器（world/env/characters/acts/beats/chapterPlan/chapterText）+ `parseJsonResponse` / `parseProseResponse` |
| `src/server/pipeline/prompts.ts` | 分阶段 prompt + 确定性 mock 文本（mock provider 走同一校验管线） |
| `src/server/pipeline/context.ts` | 上下文装配与 12000 字符预算裁剪（记录 `truncated[]`） |
| `src/server/pipeline/steps.ts` | 一次模型调用 = 一个 step 的落库（world/env/characters/acts/beats/plan/write/item），模型调用在事务外、产物在一个事务内 |
| `src/server/pipeline/runner.ts` | job 队列（全局并发 3，FIFO）、claim（条件 UPDATE）、逐步进度、取消/暂停、失败归因、P2 步数展开 |
| `src/server/pipeline/snapshot.ts` | `PipelineSnapshot` 读取契约 + `deriveNextStep()` 15 行推导（服务端唯一下发） |
| `src/server/pipeline/actions.ts` | 写动作：确认/跳过/重生成/反馈/编辑/锁定/回滚版本/字数分配/审阅 |
| `src/server/pipeline/legacy.ts` | 旧作品迁移：前置检查 → 备份 → 事务内映射 + 九条校验 → 成功/失败留痕；回退 SQL |
| `src/server/pipeline/create.ts` | 创建即落库（作品 + 4 stages + 首个 job 同事务，不预写空幕/空章） |
| `src/server/pipeline/routes.ts` | 全部 pipeline 路由（含错误中间件：`{code,message,blockers?,detail?,retryable}`） |
| `src/server/db.ts` | `migrate()` 包进 `BEGIN IMMEDIATE`，末尾 `ensurePipelineSchema(db)`；导出 `dataDir`/`backupDir` |
| `src/server/index.ts` | 启动时 `migrate()` → `recoverInterruptedMigrations()` → `recoverInterruptedJobs()` → `pump()`；`POST /api/projects` 增加流水线分支（幂等键支持） |

## 2. 数据与状态机

- 新增表：`stages`（每作品 4 行）、`stage_items`（world/env/beat_plan/beat_group/beat）、`revisions`（scope=stage|item，来源 `ai_initial|ai_feedback|ai_regen|manual|rollback|migration|ai_rejected`）、`generation_jobs`、`job_events`、`review_records`、`migrations`。
- 补列（全部可空或带默认，旧读路径不受影响）：`projects.{pipeline_status,stale,last_error,migration_id,schema_version,style_notes,client_request_id}`、`chapters.{review_status,plan_function,plan_synopsis,plan_characters,min_words,target_words,max_words,target_manual,plan_locked,current_version_id,stale,archived_at,last_error}`、`characters.{motivation,arc,is_protagonist,locked,source}`、`outline_acts.{act_function,characters,locked,source}`、`outline_beats.{beat_function,planned_chapters,foreshadow,locked,source}`。
- 状态：Stage `empty|generating|review|confirmed|failed|skipped`（`locked`/`stale` 是正交标记）；Job `queued|running|done|failed|cancelled|interrupted`（暂停不是状态：`pause_requested` + `stop_mode='pause'` → 前端显示 `paused`）；Chapter `pending|generating|in_review|approved|changes_requested|approved_manual|skipped`。
- 已确认阶段不被回滚：`stages.confirmed_revision_id` 只增不改，编辑已确认内容会写新 revision 并把阶段置回 `review`，下游标 `stale`（不删内容）。

## 3. 长任务：进度 / 取消 / 重试 / 恢复

- 进度：`GET /api/projects/:id/pipeline` 一次返回全量快照（阶段、单元计数、当前 job、`nextStep`、`lastError`、`review` 计数）；job 每步写 `job_events`（seq 单调）。V1 走轮询，SSE 留到 V1.1，因此页面关闭不会中止 job。
- 取消：`POST /api/jobs/:id/cancel {mode:'pause'|'stop'}` → 落 `cancel_requested/pause_requested` 后立刻 abort 上游 fetch；step 边界检查 → `cancelled` + `stop_mode`；被取消的那一步零写入（测试断言 P1 items 仍为 0）；≤5s 释放上游。
- 重试：`POST /api/projects/:id/jobs/:jobId/retry` 新建 job 并带 `retry_of_id`，从失败步续跑；P4 从第一个 `pending` 单元续跑，不重写已完成章。
- 断点恢复：进程被杀后启动时 `recoverInterruptedJobs()` 把 `queued|running` 改 `interrupted` 并落 `INTERRUPTED` 错误码，界面给"重试"入口；迁移遗留的 `running` 行同步改 `failed`。
- 并发与幂等：单作品同时只允许一个 active job（`409 CONCURRENT_JOB`）；全局并发 3；`projects.client_request_id` 与 `generation_jobs(project_id, client_request_id)` 唯一部分索引，重复请求返回同一作品/任务。

## 4. 章节计划与逐章生成

- `POST /api/projects/:id/stages/p3/...` 生成计划；每单元含 `function`（钩子/推进/转折/揭示/高潮/收束/缓冲）、`synopsis`（≥15 字）、`min/target/max` 字数范围（`300 ≤ min ≤ target ≤ max ≤ 20000`）、涉及人物、锁定。
- `PATCH .../stages/p3/units/:unitId` 改字数会置 `target_manual=1`；`.../units/allocate` 只算不落库，`.../allocate/apply` 默认跳过手改行（`422 TARGET_EDITED`，需 `includeEdited:true`）；`.../units/count` 减章时若有正文 → `422 CONTENT_WOULD_BE_LOST`（可 `archiveOrphans` 归档而不是删除）。
- 确认 P3 前校验 `Σtarget` 与全书目标偏差 ≤25%（超差需显式 `accept-deviation`）。
- `POST /api/projects/:id/writing/start {mode:'single'|'continuous', unitId?}`：`single` 只写目标单元。测试断言"其余章 0 字且 pending"。
- 审阅唯一入口 `POST /api/chapters/:id/review`（`approve|request_changes|manual_approve|skip|rewrite|expand|shrink`）：`request_changes` 必须带说明（`422 NOTE_REQUIRED`）；`rewrite/expand/shrink` 起 `chapter-rewrite` job 并返回 202。

## 5. 长篇 / 短篇统一

`KIND_PROFILE` 一套组件两个 profile：长篇 P3 写 `chapters` 计划列、P4 写 `chapters.content` + `chapter_versions`；短篇 P2 是「节拍组 → 节拍」、P3 写 `stage_items(kind='beat_plan')`、P4 写 `stage_items.body`（**短篇不创建 chapters 行**），整篇正文由节拍按 ordinal 拼接派生。剧本/剧集 `422 TYPE_NOT_SUPPORTED`，不进流水线。

## 6. 旧数据迁移

`POST /api/projects/:id/migrate`：
1. 前置检查（只读）：存在性 / 类型 / 无 active job / 是否已迁移过 / 孤儿空壳（无幕、无人物、无正文 → `NOT_MIGRATABLE_EMPTY`）/ 已是流水线作品（`BAD_REQUEST`）。
2. 备份在事务外：`VACUUM INTO data/backups/studio.db.bak-<migrationId>` + bundle JSON。
3. 事务内：`stages`×4 + 旧行补 `source='migration'` + chapters 只写计划列与 `review_status`（**正文与字数逐字节不动**）+ 短篇生成 `beat_plan` 副本。
4. 九条校验（V1 章节数 / V2 正文逐字节 / V3 字数 / V4 版本数与正文 / V5 人物·幕·节拍 / V6 场景·分镜·伏笔 / V7 元数据 / V8 零模型调用 / V9 版本指针错位），全部对 `ATTACH` 的备份副本比；任一条不过整笔 ROLLBACK 并留 `status='failed'`。
5. 成功后 `migrations.status='done'` + `projects.migration_id`，二次调用返回 `alreadyMigrated:true`（不写新行）。
6. 回退 `POST /api/projects/:id/migrate/rollback {mode:'sql',confirm:true}`：删新增行（stages/stage_items/migration 来源 revisions/jobs/review_records/migrations）+ 复位新增列，正文与版本不动；回退后可再次迁移。

## 7. 错误边界（禁止静默 mock）

- 无默认模型 / 供应商未启用 → `422 NO_DEFAULT_MODEL`；供应商缺 Key → `422 NO_API_KEY`；两者都会拦住"创建后立即 AI 企划"，**不落空壳作品**（测试断言库里没有该作品）。
- `GET /api/pipeline/precheck` 供前端在填写表单时就提示。
- 结构化校验失败 → `INVALID_JSON`（附前 6 条 `path: message`），原始输出存 `revisions(source='ai_rejected')`；推理模型只回 `reasoning_content` → `EMPTY_OUTPUT`（与 `INVALID_JSON` 严格区分）；超时 `PROVIDER_TIMEOUT`、429 `RATE_LIMIT`（自动重试 1 次）、401/403 `AUTH_FAILED`、余额 `QUOTA_EXCEEDED`、内容拦截 `CONTENT_BLOCKED`。
- 失败不影响已确认阶段：`stages.status` 有旧内容回 `review`、无内容回 `empty`；`projects.last_error` 落库，刷新后仍可见。

## 8. 测试覆盖（`software/scripts/api-test.mjs`，30 组 PASS）

新增 9 组，对验收 7 条：

| 验收 | 对应 PASS 组 |
|---|---|
| 刷新/重启后仍在且可继续 | `pipeline stage data survives restart and continues from the current stage`、`interrupted job is marked and resumed through retry` |
| 整份/局部生成、修改、历史 | `pipeline stage items are editable structured data with revision history`（PATCH → manual revision → restore；`scope:'item'` 重生成不动其他条目） |
| 章节计划 + 字数 + 逐章生成 + 短篇 | `chapter plan carries function / synopsis / word range and supports allocation`、`per-chapter generation writes only the target chapter and needs an explicit review`、`short projects run the same pipeline with beat plans instead of chapters` |
| 取消/重试/断点，不写半截、不回滚已确认 | `cancel stops the run quickly, keeps no half-written stage data and supports retry`、断点恢复组 |
| 迁移可重入/可回退/不丢 | `legacy migration is re-entrant, rollback-safe and never loses text/versions/settings`（九条校验全 true、正文逐字节相等、二次迁移 `alreadyMigrated`、回退后再迁移成功、`forceFail` → 500 且旧正文可读） |
| 无模型/无 Key 明确报错 | `pipeline config gates (no model / no key refuse instead of silently mocking)` |
| typecheck + test 通过 | 本节开头两条命令 |

`failed` 与 `INVALID_JSON` 可区分由 `invalid model output fails with a readable code instead of empty content` 覆盖（断言 `stages.p1.status='failed'`、`counts.items=0`、存在 `ai_rejected` revision）。

## 9. 已知边界

- 单进程设计：同一 `PW_DATA_DIR` 不允许起两个 server（job 队列在内存里）。
- V1 用轮询；`GET /api/jobs/:jobId/stream`（SSE + `Last-Event-ID` 重放）留 V1.1，契约已在 ARCHITECTURE §3.11 锁定。
- 迁移的 `mode:'file'` 回退（从备份覆盖）未实现自动执行，返回 `BAD_REQUEST` 并提示用备份文件手动恢复（避免在运行中覆盖自身库）。
- 旧接口 `POST /api/projects/:id/plan` 与 `/plan/apply` 保留给剧本/剧集，novel/short 不再走它。
