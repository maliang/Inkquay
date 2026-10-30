# Inkquay AI-first 最终字节复验（t25）

- 复验对象：`software/` 当前工作树字节（HEAD `ae75612`，pipeline 与前端流水线文件均未跟踪，无 git 历史可 diff）
- 复验人：reviewer（独立复验，只读；未修改任何业务代码、未 commit/push）
- 任务：t25 —— t24 的 pass 绑定的是 t23 字节，t10 随后又改了 8 个文件，需对最终字节重新绑定
- 结论：**verdict = pass**。六条合同命令全部 exit 0，N7–N10 四条集成修复逐条确认，旧作品正文/版本/设定零丢失；只余 low 级残留（§6），登记为下一轮候选，不阻塞交付

---

## 1. 字节绑定（这次 pass 绑定的是哪些字节）

`git log --oneline -1` → `ae75612 feat: discover provider models and add reasoning levels`；`git status --porcelain -- software/src software/scripts desktop` 显示 pipeline 与前端流水线文件仍全部为未跟踪，改动面与 t23 相同（另有两个 `desktop/build/icon.*.bak-20261028` 备份文件与大量 `software/screenshots/*` 截图噪声，与本任务无关）。

复验开始与结束各取一次 sha256，两次一致（下列为前 16 位）：

| 文件 | sha256(前16) |
| --- | --- |
| `software/src/server/pipeline/actions.ts` | `74ea24df880cc85c` |
| `software/src/server/pipeline/legacy.ts` | `5f866054e10ffe08` |
| `software/src/server/pipeline/runner.ts` | `a44709b97c3e5e5d` |
| `software/src/server/pipeline/store.ts` | `0109a7140087d63a` |
| `software/src/server/pipeline/types.ts` | `3a063480f52d1253` |
| `software/src/server/pipeline/routes.ts` | `647a4854c8572158` |
| `software/src/server/pipeline/steps.ts` | `bee5c112db0e07f5` |
| `software/src/server/pipeline/schema.ts` | `03dfbb47d18b451e` |
| `software/src/server/pipeline/snapshot.ts` | `c85505579b103d71` |
| `software/src/shared/pipeline.ts` | `61d42f68b2c0d307` |
| `software/src/server/index.ts` | `75e0a812d77108e8` |
| `software/src/server/repository.ts` | `510702aa4f1e1c91` |
| `software/src/server/db.ts` | `4dd42bcf9b31f763` |
| `software/scripts/api-test.mjs` | `d5f574bb7e0d9f53` |
| `software/scripts/ui-test.mjs` | `6c78a81f082b7115` |
| `software/scripts/qa-e2e-api.mjs` | `69beda88db9b8dff` |
| `software/scripts/qa-e2e-ui.mjs` | `3a2380e7b73380d5` |

t10 相对 t23 的改动面（INTEGRATION.md 自述 + 我的 diff 抽样核对）集中在 `pipeline/{types,store,legacy,runner,actions}.ts`、`qa-e2e-{api,ui}.mjs`；`routes.ts`/`steps.ts`/`schema.ts`/`snapshot.ts` 的时间戳仍停在 16:50–16:53（t23 时期），说明 N1–N6 的字节没有被二次改动。

## 2. 复验方法

1. 只读复验：从头到尾没有编辑 `software/`、`desktop/` 下任何文件；唯一新增产物是本报告与 `team/inkquay-ai-first/evidence/final-bytes-*.{mjs,json}`。
2. 六条合同命令**全部自己重跑**一次（不复用 t10 的日志），各命令独占端口（api-test 8799、ui-test 8798、qa-e2e-api 8831、qa-e2e-ui 8832；跑前用 `lsof -iTCP:8799/8798 -sTCP:LISTEN` 确认无监听、`ps aux | grep -c "[a]pi-test.mjs"` 为 0，避免多 agent 并发时互踩端口与孤儿进程）。
3. N7–N10 不只读代码，用本地真实服务 + 临时 `PW_DATA_DIR` 跑黑盒探针（端口 8842/8843/8846，跑完即删临时库）。
4. 「旧作品不丢」用逐字段指纹比对：`chapters[].content`、`chapters[].words`、版本条数、`characters[]`、`outline.acts[]`、`outline.beats[]` 迁移前后与回退前后各取一次快照，逐项 JSON 相等比较，并要求正文**逐字节**等于写入值（含中文引号「」与 emoji 🐟）。

## 3. 六条命令实测（本次复验自己的退出码）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --dir software typecheck` | **EXIT 0** | `/tmp/t25b-typecheck.log` |
| `pnpm --dir software build` | **EXIT 0**（`✓ built in 191ms`） | `/tmp/t25b-build.log` |
| `pnpm --dir software test` | **48 组 PASS**，末行 `All API tests passed.`，**EXIT 0** | `/tmp/t25b-api.log` |
| `pnpm --dir software test:ui` | **47 组 PASS**，`All UI tests passed.`，**EXIT 0** | `/tmp/t25b-ui.log` |
| `node software/scripts/qa-e2e-api.mjs` | **通过 30 / 30，失败 0，缺陷 0**，**EXIT 0** | `/tmp/t25b-qaapi.log`；结构化结果 `team/inkquay-ai-first/evidence/qa-api-results.json` |
| `node software/scripts/qa-e2e-ui.mjs` | **通过 14 / 14，失败 0，缺陷 0**，**EXIT 0** | `/tmp/t25b-qaui.log`；结构化结果 `team/inkquay-ai-first/evidence/qa-ui-results.json` |

两组 QA 日志末尾各有 3 条 HTTP ≥400，逐条核对为脚本**故意走的错误路径**（`GET /api/projects/:id/pipeline` 404 ×2 用于「不存在的作品」、`POST allocate/apply` 400 用于范围校验），不是产品缺陷。

## 4. N7–N10 逐条确认（t10 的集成修复）

### N7 回退清理迁移期 `stage_items` —— 已修 ✓

- 代码：`software/src/server/pipeline/legacy.ts:520-524`
  ```ts
  // N7：迁移期写进去的 stage_items（P1/P2 条目、短篇 beat_plan）即便没被改过也要清掉
  exec("DELETE FROM stage_items WHERE project_id = ? AND (updated_at > ? OR source = 'migration')", projectId, finishedAt);
  ```
- 实测（探针 `evidence/final-bytes-probe-integrity.mjs`）：旧短篇（1 章，正文 26 字）→ `migrate` 后 `state=done`、`/units` 1 条 → `migrate/rollback {mode:'sql', confirm:true}` 后 **`/units` 0 条**（t24 实测的同一条路径当时是 1 条）、`pipelineStatus=legacy`、正文逐字节不变。
- 无新回归：短篇再次 `migrate` 仍只有 1 条单元（`legacy.ts:253-255` 映射前先删 `kind='beat_plan'`），不会重复堆叠。

### N8 `partial_at` 覆盖崩溃中断 —— 已修（代码）+ 崩溃分支未动态演示（§7）

- 代码：`software/src/server/pipeline/runner.ts:70-75`（`recoverInterruptedJobs()` 内）
  ```ts
  for (const row of stale) {
    if (!isPartialRebuild(getJob(String(row.id)))) continue;
    updateStage(projectId, row.stage_key as StageKey, { partial_at: now() });
  }
  ```
- 清理侧：`actions.ts:175` confirmStage 写 `{ stale: 0, partial_at: null }`、`:194` skipStage patch 含 `partial_at: null`、`:311` startStageJob 起跑清空；`runner.ts:230` finishDone 清、`:246` finishFailed 写、`:263` 意外异常写。
- 我已确认真实跑起来时 `stages.partial_at` 列存在（`schema.ts:134-135` 幂等补列）且 `StageView.partialAt` 透出（`snapshot.ts:82`）；api-test 的 `a half-finished stage rebuild is marked and can be finished by running it again`（`interface/scripts` → `software/scripts/api-test.mjs` 第 1315-1336 段）走的是 **stop** 路径（finishCancelled），本次 48 组全绿。
- 崩溃分支（recoverInterruptedJobs）**我没能在真实进程里造出来**：见 §7。

### N9 p3 整阶段重生成的覆盖确认 —— 已修 ✓

- 代码：`software/src/server/pipeline/actions.ts:253-290` `assertOverwriteAllowed` 放开到 p3（`if (stageKey !== 'p1' && stageKey !== 'p2' && stageKey !== 'p3') return;`），p3 分支改用 `listUnits(projectId)` 收集 `已锁定` 与 `手改`（依据 `revisions` 里 `source IN ('manual','rollback')`）生成 blockers。
- 实测（探针 `evidence/final-bytes-probe-n9-overwrite.mjs`）：迁移得来 1 章的旧长篇 → 用前端真实路径 `PATCH /api/projects/:id/items/:chapterId {stage:'p3', payload:{synopsis:…}}` 手改大纲（200）→ `PATCH /api/projects/:id/stages/p3/units/:unitId {synopsis}` 再手改（200）→ 单元修订历史 `{count:2, sources:["manual","manual"]}` →
  - `POST /stages/p3/regenerate {scope:'all'}`（不带确认）→ **422** `{"code":"CONFIRM_BLOCKED","requiresConfirm":"overwrite","blockers":["手改：未命名章节"]}`
  - 带 `confirmOverwrite:true` → **202**，job `queued`
- 这是 t24 报的 N9 的直接复验：当时「整阶段重生成静默抹掉手改」，现在必须先确认。

### N10 迁移账本不进用户修订历史 —— 已修 ✓

- 代码：`software/src/server/pipeline/types.ts:184` `export const LEDGER_NOTE = '迁移前章节清单';`；`store.ts:340-352` 的 `listRevisions` 阶段级查询加了 `AND COALESCE(note, '') <> ?`；`legacy.ts:7,28` 复用同一常量。
- 实测（探针 integrity）：旧长篇 `migrate` 后 `GET /api/projects/:id/stages/p3/revisions` 返回 `{count:1, notes:["迁移快照"], ledgerVisible:false}` —— 账本行不再出现在用户可见的修订历史里（t24 当时能看到 `迁移前章节清单`）。
- 无新回归：回退依赖的账本仍然可读（`legacy.ts:492-499` 直接按 `note = LEDGER_NOTE` 查库，不经过 `listRevisions`），实测回退 `legacyIdsKnown:true`、`archived:[]`、`deleted:[]`、正文不变。

## 5. 旧作品正文 / 版本 / 设定未被改动

探针 `evidence/final-bytes-probe-integrity.mjs`（旧作品用直接写库方式构造，模拟升级前形态）：

- 旧长篇（1 章，正文含「」与 🐟，1 人物，1 幕）：`migrate` → 九条校验 `checks:9, failed:0`，比对 `contentSame/wordsSame/versionsSame/charactersSame/actsSame/beatsSame` **全部 true**；`rollback` 后同样**全部 true**，且 `exactText:true`（逐字节等于写入值）。
- 旧短篇（1 章，正文 26 字）：`migrate` 后 `pipelineStatus` 走流水线、`rollback` 后正文 `same:true`、`chapters` 仍 1 行、`pipelineStatus=legacy`。
- 回退的「新内容保护」仍生效：`rollback {confirm:true}` 返回 `legacyChapterIdsKnown:true`；api-test 的 `rollback keeps edited legacy chapters instead of archiving them`（1315/1338 段）本次全绿，说明「迁移时存在的老章被改过功能列」也不会被误归档。

## 6. 残留（全部 low，登记为下一轮候选，不阻塞）

| 编号 | 位置 | 问题 | requiredFix |
| --- | --- | --- | --- |
| R1 | `software/src/client/components/pipeline/P4WritingView.tsx:267-269` | 行内「立即写本X」按钮 `disabled={busy \|\| running}`，未受 `planConfirmed` 约束（顶层 `write-start`/`write-restart` 已加，`:128`/`:156`）；从 `?stage=p4` 直进时仍可点，点下必 409 | 该按钮同样加 `!planConfirmed` 并为 409 提供前置提示 |
| R2 | `software/src/client/pages/PipelinePage.tsx:947` | 已确认时间用阶段行 `updatedAt` 代替确认时刻，确认后任何阶段更新都会让时间漂 | wire 的 `StageView` 增加 `confirmedAt`（服务端已有 `stages.confirmed_at`），前端直接用 |
| R3 | `software/src/client/hooks/usePipeline.ts:95-107,138` | 快照请求有 15s 超时，但 `loadDetails` 三个详情 GET 仍只用外部 signal、无超时 ⇒ 详情挂起时 `inFlight` 永久为 true、`failures` 不增长 | 详情请求同样加超时并计入失败 |
| R4 | `software/src/client/components/pipeline/P2OutlineView.tsx:160-186` | 跨幕移动节拍 V1 不支持（已诚实降级并给替代做法） | 登记 UX-SPEC §5 偏差，V2 再实现 |
| R5 | `software/src/client/lib/pipeline/format.ts` `ERROR_COPY` | 服务端 34 个错误码中仍缺 5 条文案：`NOTE_REQUIRED`、`NOT_MIGRATABLE_EMPTY`、`BACKUP_FAILED`、`DISK_WRITE_FAILED`、`INTERNAL`（其中 `NOT_MIGRATABLE_EMPTY` 在空作品点升级时可达） | 补齐码表并把 `INTERNAL/磁盘/备份` 类标 `retryable:false` |
| R6 | `software/src/server/pipeline/steps.ts:300-326` + `actions.ts:1038` | p3 整阶段重生成经确认后会把 `target_manual` 清零，`applyAllocation` 的手改保护对该批章失效（数据仍可从 `revisions(scope='item', source='manual')` 找回；INTEGRATION.md §9 已登记） | 重生成时保留 `target_manual`，或让分配以「有 manual 修订」为判据而非仅 `target_manual` |

## 7. 无法验证 / 未能演示（如实记录）

1. **N8 崩溃分支未动态演示**：`recoverInterruptedJobs() → partial_at` 我做了代码复核，但没能在真实进程里造出「`step_index >= 1` 时被杀」的状态：
   - mock 供应商的步骤在 Node 事件循环内同步完成（探针日志 `[provider] mock … dur=0ms`，P2 重建 12 幕 + beats 共 13 步约 11ms 跑完），轮询拿不到中间态；
   - 换慢的假 OpenAI 兼容供应商时，项目在创建时已绑定模型，p1 必须由同一供应商产出合法 JSON，而我的假供应商 JSON 未通过 `validateActs` → 重建失败为 `INVALID_JSON`（探针 `evidence/final-bytes-probe-n8-crash-attempt.mjs`，输出见 `evidence/final-bytes-results.json` 的 `n8CrashProbe`）。
   - 影响：`finishCancelled`/`finishFailed` 的 partial 语义有 api-test 覆盖（1315 段绿）；崩溃恢复分支只有代码级保证。属**证据强度**问题，不是已发现的缺陷。
2. **真实供应商仅抽样**：本轮全部黑盒验证用显式 mock 或本地假 OpenAI 兼容供应商；真实 DeepSeek/Anthropic 输出格式差异未覆盖（INTEGRATION.md §9 同样登记）。
3. **平台**：只在 macOS arm64（node v26.11.1）验证，Windows/Linux 未跑。
4. **并发**：单进程、单用户假设下验证；多进程写同一 sqlite（WAL + `BEGIN IMMEDIATE`）未压测。

## 8. 证据与清理

- 探针脚本（可复跑，均自建临时 `PW_DATA_DIR`、结束即删）：
  - `team/inkquay-ai-first/evidence/final-bytes-probe-integrity.mjs`（旧作品迁移/回退逐字段比对、N7、N10）
  - `team/inkquay-ai-first/evidence/final-bytes-probe-n9-overwrite.mjs`（N9 覆盖确认 422→202）
  - `team/inkquay-ai-first/evidence/final-bytes-probe-n8-crash-attempt.mjs`（N8 崩溃窗口尝试，记录为何不可得）
  - `team/inkquay-ai-first/evidence/final-bytes-results.json`（本轮探针观测值汇总）
- 命令日志：`/tmp/t25b-{typecheck,build,api,ui,qaapi,qaui}.log`（每条末尾 `EXIT:0`）。
- 清理：8842/8843/8845/8846 端口的复验服务已停止，临时库 `/tmp/t25-probe*-*` 已删除；仓库内除本报告与上述 evidence 外无任何新增/修改文件。

## 9. 结论

**pass。** 六条合同命令在当前字节上全部 exit 0（API 48 / UI 47 / qa-api 30/30 / qa-ui 14/14），N7、N9、N10 有黑盒实测证据，N8 为代码级确认（崩溃分支无法在单进程 mock 下构造，已如实说明），旧作品正文/版本/设定在迁移与回退前后逐字段一致。残留 R1–R6 均为 low，建议作为下一轮收尾补丁，不作为本次交付阻塞项。
