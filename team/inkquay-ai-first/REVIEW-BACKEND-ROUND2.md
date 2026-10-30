# REVIEW-BACKEND-ROUND2.md — AI-first 后端 round-2 评审（复审 t19）

- 评审对象：`software/src/server/pipeline/**`、`software/src/shared/pipeline.ts`、`software/src/server/{index,repository,db}.ts`、`software/scripts/api-test.mjs`（工作树字节，branch main / HEAD ae75612；pipeline 目录全部未跟踪，无 git 历史可 diff）
- 复审目标：t8 的 F1–F20 是否真落地；状态机/迁移/并发边界是否真的支撑「AI 主导 + 人工把关」的流水线，而不是把旧接口换个名字
- **verdict = needs_revision**（3 条需要整改：N1 主路径死路、N2 并发脏数据、N3 回退归档口径；另 3 条 low 建议随手清）
- 未改业务代码、未 commit / push；本轮新增文件只有本报告与 `evidence/backend-round2-*.mjs` 三个探针

---

## 0. 一句话结论

t19 对 F1–F20 的修复**基本都是真改代码，不是改测试或改文案**：嵌套事务换成 SAVEPOINT、计划窗口按批次边界裁剪、阶段状态收敛到 `setStageStatus` 并维护 `confirmed_*` 不变式、迁移不倒挂且清 `last_error`、导出按 kind 取语料、回退守卫与 confirm 解耦——这些我都逐条对着当前字节复核过（§2）。

但 **F7 的「覆盖手改确认」只接通了 HTTP 直连 `regenerate`，漏掉了两条真实入口**：`stale/resolve` 路由不转发 `confirmOverwrite`，前端也从不发送该字段。结果是**用户手改过任何人物/幕/节拍之后，「重新生成本阶段」和横幅里的「上游已变更 → 重新生成」都会稳定拿到 422 CONFIRM_BLOCKED，界面上没有任何确认入口**——这正是产品最核心的「AI 生成 + 人工修改」组合动作。这条不放行。

---

## 1. 复验方法（可复跑）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `cd software && pnpm typecheck` | `EXIT:0`（`/tmp/t20-typecheck.log`） |
| 后端 API 测试 | `cd software && pnpm test`（独占端口 8799） | **43 段 PASS + `All API tests passed.` + `EXIT:0`**（`/tmp/t20-apitest.log`） |
| 探针 1：覆盖确认直连 | `node evidence/backend-round2-confirm-overwrite.mjs`（端口 5822） | 见 §3 N1 |
| 探针 2：横幅「重新生成」 | `node evidence/backend-round2-banner-regenerate.mjs`（端口 5823） | 见 §3 N1 |
| 探针 3：创建幂等 | `node evidence/backend-round2-idempotency.mjs`（端口 5824） | 见 §3 N5 |

探针都是「`PW_DATA_DIR=/tmp/... PORT=58xx` 起真服务 → onboarding → 默认模型切 mock → 走真实 HTTP」，跑完自删临时库。测试用固定端口 8798/8799，多 agent 并发跑会互踩并留孤儿进程，本轮已先 `lsof` 确认端口空闲再跑。

复核的字节时间戳（`ls -l --time-style=full-iso`）：`store.ts` 16:27:58、`scripts/api-test.mjs` 16:27:58、`actions.ts` 16:12:04、`legacy.ts` 16:02:42、`runner.ts` 13:46、`routes.ts` 13:52、`steps.ts` 13:11、`snapshot.ts` 13:16、`types.ts` 13:12。

---

## 2. F1–F20 逐条复验

| # | 原 finding | 复验 | 证据（当前字节） |
| --- | --- | --- | --- |
| F1 | 嵌套 `withTx` 必炸 / 版本恢复 500 | ✅ 已修 | `store.ts:42` `withTx` 用模块级 `txDepth`，内层 `SAVEPOINT pw_sp_N` → `RELEASE`，异常 `ROLLBACK TO` + `RELEASE`；外层 `BEGIN IMMEDIATE`/`COMMIT`。全仓 `withTx(async` 0 命中、19 处回调均同步。非 `PipelineError` 也统一 500 `{code:'INTERNAL'}`（`routes.ts:482-497`）。`api-test.mjs` 有「chapter plan revisions restore through nested transactions」（43 条中的 #35） |
| F2 | 章节计划批量重建多删后续批次 | ✅ 已修 | `steps.ts:430` `prunePlanWindow`：`returned !== batchSize` 时不裁剪 + 写 `plan-window-kept` 事件 + warn；否则只删 `[batchStart+returned, batchStart+batchSize)` 且未锁、无正文的行。测试 #41「a short model reply keeps the plan outside the window」 |
| F3 | 迁移作品 planSynopsis 空串 → 永远过不了 p3 确认 | ✅ 已修 | `legacy.ts` 长篇取 `beat.summary`、短篇取 `firstParagraph(content)`，不足 15 字补 `（迁移自旧稿，可直接改写）`；成功路径 `acceptDeviation(projectId, true)`（`legacy.ts:186`）。测试 #37 断言迁移短篇可直接确认 |
| F3b | 迁移阶段倒挂（p4 confirmed 而 p1 empty） | ✅ 已修 | `legacy.ts:315-329`：`p3Ready = upstreamReady && chapters.length>0`，p3/p4 只给 `review` 或 `locked`，p4 不再 confirmed |
| F4 | 回退「已有新内容」守卫不可达 | ✅ 已修 | `rollbackMigration` 先算 5 类 touched（版本/阶段确认/非迁移修订/审阅/新章），`if (touched.length && !confirm) fail('CONFIRM_BLOCKED', ...)` 独立于 `!confirm` 判定。测试 #38 断言 422 + blockers，并断言原文仍在 |
| F5 | 长篇 allocate 把手改标记全写脏 | ✅ 已修 | `actions.ts:1038` `applyAllocation` 用 `changed` 判定，只对真正改值的行打 `target_manual`；`!includeEdited && blocked.length` 才 TARGET_EDITED。测试 #40「only marks rows whose target really changed」 |
| F6 | allocate 不校验字数区间 | ✅ 已修 | `actions.ts:1026` `allocationProblems`：floor 300 / ceiling 20000 / `min<=target<=max`，非法 400 + 逐行 blockers。测试 #40 |
| F7 | 破坏性重建前无内容保护 | ⚠️ 修了一半（见 N1） | `actions.ts:238` `assertOverwriteAllowed` 逻辑本身正确（手改/锁定条目 → 422 + blockers），但它只在 `regenerate`/`feedback` 两个路由被转发；`stale/resolve` 不转发、前端从不发送该字段 |
| F8 | 生成期间可被并发编辑 | ⚠️ 留缺口（见 N2） | `actions.ts:501` `ensureStageIdle` 覆盖 patchItem(385)/createItem(553)/deleteItem(666)/reorderItems(716)/reorderUnits(778)/patchUnit(856)/applyAllocation(1040)/restoreUnitVersion(1181)；**`setUnitCount`（`actions.ts:920`）没有** |
| F9 | 短篇正文镜像按 sort_order 猜行、排序后错位 | ✅ 已修 | `actions.ts:774` `reorderUnits`：短篇先建 `旧 sort_order → chapters.id` 的 mirror（临时 `-1000-order` 占位），排序后按 `mirror.get(unit.ordinal)` 回写 `sort_order` + `number = 第N节拍`。测试 #37 断言反转后正文落在排第一的行 |
| F10 | `chapters.number` 不重算 → 导出/AI 上下文错序 | ✅ 已修 | 长篇在 `reorderUnits` 里按 `sort_order ASC, id ASC` 全量重算 `number`；短篇镜像行同步 `number` |
| F11 | `markDownstreamStale` 覆盖真实错误信息 | ✅ 已修 | `store.ts:235` 用 `STALE_WORTHY` 过滤 + `setStaleReason()` 独立列，非 worthy 阶段反而清 stale |
| F12 | finishDone 无条件回落 review / 失败后 de-confirm | ✅ 已修 | `store.ts:254` `setStageStatus` 在 `status !== 'confirmed'` 时清 `confirmed_revision_id/at`；`runner.ts:221`（finishDone）/`:235`（finishCancelled）保留 `staysConfirmed`；`:246` finishFailed 走同一入口。测试 #30/#36 断言单条重生成保持 confirmed |
| F13 | 死代码 | ⚠️ 残留（见 N6） | `actions.ts`/`runner.ts` 的几处已清；`legacy.ts` 仍有 `void p1Content; void p3Snapshot; void p4Snapshot;`，`snapshot.ts` 的 `allPending` 首项 `review.pending === review.pending + 0` 恒真 |
| F14 | p4 上游门禁被旁路 | ✅ 已修 | `startStageJob` 的 `if (stageKey !== 'p1')` 分支对所有阶段（含 p4）校验上游 confirmed/skipped |
| F15 | `stageKeyOfTable` 靠「有没有正文」猜阶段 | ✅ 已修 | `store.ts:789`：stage_items 取 `stage_key`，characters→p1、outline_*→p2，其余按 `hint || 'p3'`；`restoreItemRevision`（`actions.ts:812`）优先用修订自身的 `stage_key` |
| F16 | 无 Key/无默认模型静默 mock | ✅ 保持 | 测试 #20「pipeline config gates (no model / no key refuse instead of silently mocking)」 |
| F17 | 迁移成功不清 `last_error` → nextStep 卡 retry-failed | ✅ 已修 | `legacy.ts:184` 成功路径带 `last_error = NULL`；`snapshot.ts:224-228` 迁移已 done 时忽略历史 `MIGRATION_FAILED`。测试 #39 断言 `lastError === null` 且不再是 retry-failed |
| F18 | `forceFail` 走公开接口可被生产调用 | ✅ 已修 | `routes.ts:461-463` 只在 dev 构建或 `PW_MIGRATION_FORCE_FAIL=1` 时接受 |
| F19 | 空阶段被标 stale | ✅ 已修 | `STALE_WORTHY` 过滤 + `setStaleReason` |
| F20 | stale 让 nextStep 卡死 | ✅ 已修（改为提示） | `snapshot.ts:208` 起：stale 只作为 `hint` + `blockers: ['p3:stale']`，不 gate（SPEC §4.6 R1a 已定案） |

补充确认（不属于 F 序）：短篇导出已由 `index.ts:424` `shortUnitsOf`（`stage_items(kind='beat_plan')`）+ `:436` `shortMarkdown` 承担，两条导出路由的 `hasBody`（`index.ts:457-460`、`:514`）都把 beat body 算进去了；测试 #37 断言短篇 md/docx 均 200。**注意 `repository.ts:466-483 exportProjectMarkdown` 本身仍只遍历 chapters**——短篇走的是 `index.ts` 另一套语料，属于「两套导出语料」，不是缺陷，但必须在 IMPLEMENTATION/doc 里写明，否则后来人改一处漏一处。

---

## 3. 新增 findings

### N1 [high] 覆盖手改的「确认」只有 API 直连可用，两条真实入口都是死路

- 位置：
  - `software/src/server/pipeline/actions.ts:203-214`：`resolveStale(projectId, stageKey, action)` 在 `action === 'regenerate'` 时直接 `startStageJob(projectId, stageKey, { scope: 'all', kind: 'regen-stage' })`，**不携带 `confirmOverwrite`**；
  - `software/src/server/pipeline/routes.ts:222-228`：`/stages/:stage/stale/resolve` 只读 `action`，不转发 `req.body.confirmOverwrite`（对比 `:195` 的 regenerate、`:215` 的 feedback 都有转发）；
  - `software/src/client/lib/pipeline/api.ts:92-96`：`regenerate(projectId, stage, input: { scope; targetId?; note? })` 类型里没有 `confirmOverwrite`；`grep -rn "confirmOverwrite\|requiresConfirm" src/client` **0 命中**；
  - `software/src/client/pages/PipelinePage.tsx:793`：整阶段重生成只发 `{ scope: 'all' }`；`PipelineBanner` 的「上游已变更 → 重新生成」走 `resolveStale('regenerate')`，同样带不上确认；
  - `software/src/client/lib/pipeline/format.ts:221-225`：`CONFIRM_BLOCKED` 的文案是「还有条件没满足 / 按下面的清单补齐后再确认」，对「覆盖手改」这种**只能确认、不能补齐**的场景是误导。
- 实证（`evidence/backend-round2-confirm-overwrite.mjs`，端口 5822）：
  ```
  手改一条人物后：
  POST /stages/p1/regenerate {scope:'all'}                          → 422 CONFIRM_BLOCKED
    blockers: ["手改：手改过的人物名"] detail:{requiresConfirm:'overwrite'}
  POST /stages/p1/regenerate {scope:'all', confirmOverwrite:true}   → 202（起 job）
  ```
  实证（`evidence/backend-round2-banner-regenerate.mjs`，端口 5823，p1/p2 都确认后手改一条节拍）：
  ```
  POST /stages/p2/stale/resolve {action:'regenerate'}                       → 422 CONFIRM_BLOCKED
  POST /stages/p2/stale/resolve {action:'regenerate', confirmOverwrite:true} → 422（路由不转发，同一错误）
  POST /stages/p2/regenerate {scope:'all', confirmOverwrite:true}            → 202
  ```
- 影响：产品主线是「AI 先写、人再改」。只要用户改过任何一条（这是最正常的行为），「重新生成本阶段」和横幅「重新生成」就永久 422，界面没有确认按钮、也没有清掉手改标记的办法；用户只能先去逐条删除/重生成，或者干脆放弃这个阶段。测试 #36 只验证了「直连 regenerate 带 `confirmOverwrite:true` 能过」，所以后端自测全绿而用户路径是断的。
- requiredFix：
  1. 后端：`resolveStale` 增加 `options?: { confirmOverwrite?: boolean }` 并传给 `startStageJob`；`routes.ts` 的 stale/resolve 转发 `confirmOverwrite: req.body?.confirmOverwrite === true`。
  2. 前端：捕获 `code === 'CONFIRM_BLOCKED' && detail.requiresConfirm === 'overwrite'` 时弹二次确认（列出 blockers），确认后带 `confirmOverwrite: true` 重发；`format.ts` 为该分支单独文案（「会覆盖 N 条手改内容，是否继续」）。
  3. 测试：api-test 增加 stale/resolve 带 confirm 的用例；ui-test 增加「手改一条 → 整阶段重新生成 → 出现确认 → 确认后起 job」的点击断言。

### N2 [medium] `setUnitCount` 没有并发守卫，写作中的删章会丢正文并留下孤儿版本

- 位置：`software/src/server/pipeline/actions.ts:920-952` `setUnitCount` 直接 `withTx` 删除/归档 chapters 与 `beat_plan`，**入口没有 `ensureStageIdle(projectId,'p3')`**（其余 8 个写入口都有）；对照写步骤 `software/src/server/pipeline/steps.ts:375-381`：`UPDATE chapters SET content = ? ... WHERE id = ?` 命中 0 行不报错，紧接着 `createChapterVersion(unitId, 'AI 生成', checked, unit.title)` 仍插入版本行 ⇒ 正文写入丢失、版本表留下指向不存在章节的孤儿行、job 仍报成功。
- 可达性：UI 层 p3 计划表在 **p4 写作期间仍可编辑**（`P3PlanView` 的 `readOnly` 只看本阶段 `status === 'generating'` 与页面 `busy`，p4 写作时 p3 是 `confirmed` 而非 `generating`），用户可一边看进度条一边改章节数。
- requiredFix：`setUnitCount` 入口加 `ensureStageIdle(projectId, 'p3')`（如担心与 p4 冲突，可放宽为「任何 activeJob 都拒」）；写步骤里校验 `UPDATE ... ` 的影响行数，命中 0 行时 `fail('NOT_FOUND','这一章已被删除，请重新生成计划')` 而不是静默继续。

### N3 [low] 回退用「updated_at + plan_function」判定新章，迁移来的老章可能被归档

- 位置：`software/src/server/pipeline/legacy.ts:466-497`。touched 与「删/归档」条件都是 `updated_at > finishedAt AND COALESCE(plan_function,'') <> '迁移（未标注）'`。迁移章节的 `plan_function` 初始恒为 `迁移（未标注）`，**但只要用户在计划表里改过「功能」列，它就不再等于该值**，于是这本是迁移前就存在的章会被当成「升级后新增」：有正文 → `archived_at = now()`（`legacy.ts:490`）⇒ `listUnits` 过滤 `archived_at IS NULL`，这章从书籍/导出里消失；无正文 → 直接 DELETE（`legacy.ts:484`）。回退响应只给 `state: 'rolled_back'`，不列出归档了哪些章。文本本身仍留在库里（`content` 未被清），但用户看不到、也拿不回来（恢复章节要走回收站，而归档不是回收站）。
- requiredFix：改用 `chapters.created_at > finishedAt`（迁移前就存在的章 created_at 必然更早）判定新章；迁移时也可记录 chapter id 清单进 migrations 行；归档时在回退结果里返回被归档标题列表。

### N4 [low] 多步破坏性重建仍非原子，取消/失败后阶段半新半旧且无「部分完成」提示

- 位置：`software/src/server/pipeline/steps.ts:419-422` 每步 `commit(...) → withTx`；`acts` 步删除整组幕/节拍后重建（短篇删 `beat_group`），`beats` 步按幕删改。P2 的 `acts` 成功、`beats` 取消/失败时，阶段停在「幕已换新、只剩前几幕的节拍是新的」，`runner.finishCancelled`（`runner.ts:230`）只把状态置 review，不回滚也不标「部分完成」。api-test #24 的 cancel 断言只覆盖 P1（单步），P2 中途取消无断言。
- requiredFix：要么给「整阶段重建」加阶段级快照 + 失败自动回滚到快照，要么在 stage 上记录 `partial_at` 并在 `StageView` 暴露（前端提示「这次重建只完成了一部分，可以再点一次继续」），并补 P2 中途取消的用例。

### N5 [low] 创建幂等可用但无测试（contract 要求「有测试或说明不可测原因」）

- 证据（`evidence/backend-round2-idempotency.mjs`）：
  ```
  同 Idempotency-Key 第一次 → 201 p_...（新项目）
  同 Idempotency-Key 第二次 → 200 同一 id，replayed:true
  换 key                    → 201 另一个 id；projects 总数 2
  ```
- 缺测试：`api-test.mjs` 里只有迁移幂等断言（`api-test.mjs:876`「migrating twice is idempotent」），没有 `Idempotency-Key` 重放断言。原始事故正是「新建并让 AI 企划」被点两次/重载，这条路径值得一条明确用例。
- requiredFix：api-test 增加「同 key 两次 → 同一个 projectId 且第二次 `replayed:true`」。

### N6 [low] 残留死代码

- `software/src/server/pipeline/legacy.ts:325-327` `void p1Content; void p3Snapshot; void p4Snapshot;`；
- `software/src/server/pipeline/snapshot.ts:236` `const allPending = review.pending === review.pending + 0 && ...`（首项恒真，条件等价于后半段，容易误读）。

---

## 4. 合同验收项判定

| # | 验收项 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 逐文件审查状态机与迁移，不以测试变绿代替正确性 | passed | §2 逐条对字节复核；N1/N2/N3 都不在测试里 |
| 2 | findings 带 file:line / 问题 / requiredFix | passed | §3 |
| 3 | 阶段产物与状态真实落库、刷新/重启可继续 | passed | 探针中 p1 生成后 `status=review`、6 条 items 落库；api-test #42「stage data survives restart and continues from the current stage」；`setStageStatus` 维护 `confirmed_revision_id/at` 不变式 |
| 4 | 取消/失败不留半截脏数据 | **failed（部分）** | P1 单步已测（#24）；P2 多步中途取消无断言且现状是半新半旧（N4）；`setUnitCount` 并发下可丢正文并留孤儿版本（N2） |
| 5 | 迁移可重入、可回退，正文/版本/设定不丢 | **failed（部分）** | F3/F3b/F17/F4 已修且有测试；但 N3 的归档口径会把迁移前的老章藏起来，且回退结果不告知 |
| 6 | 无 Key/无默认模型不静默 mock | passed | api-test #20；`precheck()` 门禁 + `steps.ts` 只在 selection.kind==='mock' 时注入 mockText |
| 7 | 短篇 scenes/beats 不硬套 chapters | passed | api-test #29/#37；`shortUnitsOf`+`shortMarkdown` 独立语料 |
| 8 | 并发/幂等/重试边界有测试或明确不可测原因 | **failed（部分）** | 并发 409 已测（#36）；幂等（N5）无测试；`setUnitCount` 缺口（N2）；多进程并发属 V1 单进程，已在 ARCHITECTURE 声明 |

---

## 5. 建议的最小整改顺序

1. **N1**（后端 2 处 + 前端 2 处 + 2 条测试）——这是用户可见的主路径断点，必须修。
2. **N2**（`setUnitCount` 加守卫 + 写步骤校验影响行数）——防止脏数据，改动 3 行。
3. **N3**（判定改 `created_at`）——回退安全性。
4. N4 / N5 / N6 —— 低优先，建议同批清掉，尤其 N5 的幂等用例（原事故同源）。

---

## 6. 未验证 / 无法验证

- 真实供应商长任务（>120s 超时、429 重试、EMPTY_OUTPUT）未用真实 Key 压测，只用假 OpenAI 兼容供应商模拟慢/挂；这部分能力在 t5 已测，本轮未重测。
- 多进程/多实例并发（V1 明确单进程，`ARCHITECTURE` 已声明）无法验证。
- Electron 桌面端（`desktop/`）与前端渲染细节不在本轮范围（前端由 t22 覆盖，本轮只验证前端是否会发 `confirmOverwrite`）。
- `rollbackMigration` 的 `mode:'file'` 路径（需应用退出后手动覆盖 db 文件）按设计不可自动测。

## 7. 证据清单

- `evidence/backend-round2-confirm-overwrite.mjs`（N1 直连路径）
- `evidence/backend-round2-banner-regenerate.mjs`（N1 横幅路径）
- `evidence/backend-round2-idempotency.mjs`（N5 幂等）
- 日志：`/tmp/t20-typecheck.log`（EXIT 0）、`/tmp/t20-apitest.log`（43 PASS / EXIT 0）
- 探针起服务方式：`PW_DATA_DIR=/tmp/xxx PORT=58xx node_modules/.bin/tsx src/server/index.ts`（脚本内已封装，跑完自动清理临时库）
