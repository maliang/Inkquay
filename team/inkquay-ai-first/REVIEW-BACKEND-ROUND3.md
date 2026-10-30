# REVIEW-BACKEND-ROUND3.md — AI-first 后端 round-3 评审（复审 t23）

- 评审对象：`software/src/server/pipeline/**`、`software/src/shared/pipeline.ts`、`software/src/server/{index,repository,db}.ts`、`software/scripts/{api-test,ui-test}.mjs`、以及 t23 为接通 N1 而改的 `software/src/client/{lib/pipeline,pages/PipelinePage.tsx}`（工作树字节，branch main / HEAD ae75612；pipeline 目录全部未跟踪，无 git 历史可 diff）
- 复审目标：t20 判 failed 的 6 条（N1 high / N2 medium / N3·N4·N5·N6 low）是否真落地；状态机、迁移、并发与取消边界是否真的成立，而不是靠新增测试把红灯涂绿
- **verdict = pass**（N1–N6 逐条确认修复；另记 4 条 low/medium 残留 N7–N10，均不阻塞：不丢正文、不改阶段状态机语义、都能在下一轮顺手清掉）
- 未改业务代码、未 commit / push；本轮新增文件只有本报告与 `evidence/backend-round3-rollback-units.mjs` 一个探针

---

## 0. 一句话结论

t23 的修复是**真改链路**，不是改测试或改文案：

- N1 的「有门无路」被打通了**两端**——服务端 `stale/resolve` 现在转发 `confirmOverwrite`，前端 `regenerateAll()` 先不带确认发一次、被 422 挡回弹 `confirm-overwrite` 再带确认重发；我独立跑 UI 测试，那条「手改之后点整份重生成 → 覆盖确认 → 真的起 job」是真点击、真等待阶段回到 review。
- N2 从两处堵上：入口 `setUnitCount` 拒绝任何在跑的 job（409 `CONCURRENT_JOB`），写步骤 `UPDATE chapters ... WHERE id=?` 命中 0 行时 `fail('NOT_FOUND')`，不再「静默成功 + 插孤儿版本」。
- N3 换成「迁移时记迁前章节 id 清单 → 回退按 id 集合判新章」，并且把 `archivedTitles/deletedTitles/legacyChapterIdsKnown` 回给用户。
- N4 用 `stages.partial_at` + `StageView.partialAt` + nextStep `hint` 暴露「只完成一部分」；重新起跑与成功完成都会清标记。

残留的四条我都实测/读码确认了边界（§3），性质分别是：回退没清干净迁移期写入的 `stage_items`（N7）、崩溃中断不写 `partialAt` 且确认后不清（N8）、p3 整阶段重生成仍会静默覆盖手改的计划字段并清零 `target_manual`（N9）、迁移的记账快照出现在用户可见的 P3 修订历史里（N10）。

---

## 1. 复验方法（可复跑）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `cd software && pnpm typecheck` | `EXIT:0`（`/tmp/t24-typecheck.log` 末行） |
| 后端 API 测试 | `cd software && pnpm test`（独占端口 8799，跑前 `lsof -iTCP:8799` 无监听） | **48 段 PASS + `All API tests passed.` + `EXIT:0`**（`/tmp/t24-apitest.log`） |
| 前端 UI 测试（t23 改了 client，必须自己跑） | `cd software && pnpm test:ui`（独占端口 8798） | **47 段 PASS + `All UI tests passed.` + `EXIT:0`**（`/tmp/t24-uitest.log`），其中含新增 `PASS regenerating over hand edits asks for an overwrite confirmation and then runs` |
| 探针：短篇「升级 → 回退 → 再升级」 | `node evidence/backend-round3-rollback-units.mjs`（`PW_DATA_DIR=/tmp/t24-db PORT=5826`） | 见 §3 N7 |

测试脚本用**固定端口** 8798/8799 + 临时 dataDir，多 agent 并发跑会互踩并留孤儿进程；本轮跑前确认端口空闲、跑完确认无残留。

复核的字节时间戳：`software/src/server/pipeline/{store,actions,steps,legacy,runner,routes,snapshot,schema}.ts`、`software/src/client/pages/PipelinePage.tsx` 均已被 t23 改动过，本报告所有行号取自当前工作树（不是转述 t23 的自述）。

---

## 2. N1–N6 逐条复验

### N1 [high] 覆盖手改确认在主路径可达 —— 已修 ✓

- 服务端：`software/src/server/pipeline/actions.ts:210-222` `resolveStale(projectId, stageKey, action, options = {})` 把 `confirmOverwrite: options.confirmOverwrite === true` 透传给 `startStageJob`；`software/src/server/pipeline/routes.ts:222-228` 的 `POST /stages/:stage/stale/resolve` 现在转发 `req.body?.confirmOverwrite === true`（旧版只读 `action`，这是 N1 的根因）。
- 前端：`software/src/client/lib/pipeline/http.ts:42-47` 新增 `requiresConfirmOf(error)`（读 `detailRaw.requiresConfirm`);
  `software/src/client/lib/pipeline/api.ts:91-96` `regenerate(..., { confirmOverwrite })`、`:107-113` `resolveStale(..., { confirmOverwrite })` 都会带字段；
  `software/src/client/lib/pipeline/format.ts:277-291` 对 `CONFIRM_BLOCKED && requiresConfirm==='overwrite'` 给专用文案「这会覆盖你手改过的内容 / 确认覆盖并重排」（旧版通用文案「按清单补齐」把用户引到错路）；
  `software/src/client/pages/PipelinePage.tsx:213-238` `regenerateAll(stage, viaStale)`：先 `call(false)`，`run(..., { onOverwrite: askOverwrite })` 收到 422 时 `setConfirm({ kind:'overwrite', ... })`，`onConfirm` 再 `call(true)`；横幅（`:932`）与页头「整份重新生成」（`:845`）都走这一条。弹窗 testid `confirm-overwrite`（`:1079`）。
- 独立验证：`api-test.mjs:1261-1277`「the banner regenerate accepts an explicit overwrite confirmation」先断言 422 + `detail.requiresConfirm==='overwrite'`，再带 `confirmOverwrite:true` 断言真的起了 job 并等到结束；`ui-test.mjs:1205-1226` 是真点击路径（PATCH 手改 → 点 `stage-regen-all` → 通用确认 → `confirm-overwrite` 出现且文案含「覆盖」「手改」→ 确认 → 等 `stage-p1[data-status=review]`）。两条我都在本机独立跑绿（日志见 §1）。

### N2 [medium] 生成期间改章节数会丢正文 / 留孤儿版本 —— 已修 ✓

- `software/src/server/pipeline/actions.ts:938-951` `setUnitCount` 现在先 `ensureStageIdle(projectId,'p3')`（`:947`），再 `const running = activeJob(projectId); if (running) fail('CONCURRENT_JOB', '「p4」正在生成，等它跑完或先取消再改章节数', { blockers:[stage] })`（`:948-951`）——注释写得对：「只挡 p3 不够，p4 写作时 p3 是 confirmed」。
- 写步骤兜底：`software/src/server/pipeline/steps.ts:388-389` `const written = exec("UPDATE chapters SET content = ?, ... WHERE id = ?", ...); if (!Number(written.changes || 0)) fail('NOT_FOUND', '这一章已被删除，请重新生成计划');` 然后才 `createChapterVersion`。旧实现是「UPDATE 命中 0 行不报错 → 仍插版本 → job 报成功」，正文彻底丢失。
- 独立验证：`api-test.mjs:1279-1313`「the chapter count cannot change while a generation job runs」用慢供应商把写作挂住，断言 409 + `code=CONCURRENT_JOB`，取消后同一请求可正常改；本机跑绿。

### N3 [low] 回退把「改过功能列的迁移老章」归档藏起来 —— 已修 ✓（残留见 N7）

- `software/src/server/pipeline/legacy.ts:28` `LEGACY_CHAPTER_IDS_NOTE='迁移前章节清单'`；迁移事务内 `:330-340` 写一条 `revisions(scope='stage', stage_key='p3', source='migration', content=JSON.stringify({legacyChapterIds:[...]}), note=...})`。
- 回退：`:492-499` 读回清单 → `legacyIds: Set<string> | null`；`:500-502` `isNewChapter = legacyIds ? !legacyIds.has(id) : (updated_at>finishedAt && plan_function<>迁移标注)`（取不到清单才回落旧启发式）；`:503-504` 只对有正文的新章 `archived_at` 归档、空章删除，并 `archivedTitles/deletedTitles` 回给调用方（`:515-530`、`:562-568`），字段也提进了 `software/src/shared/pipeline.ts:256-259`。
- 独立验证：`api-test.mjs:1338-1364`「rollback keeps edited legacy chapters instead of archiving them」改 `function` 列后回退，断言 `legacyChapterIdsKnown===true`、`archivedTitles===[]`、正文仍在书里；本机跑绿。

### N4 [low] 多步重建非原子只留下「看着完整」的半成品 —— 大体已修（两个缺口见 N8）

- `software/src/server/pipeline/schema.ts:39` + `:134-135` 幂等补列 `stages.partial_at`；`store.ts:150`/`:185` 的 Row/patch 类型同步。
- `runner.ts:272-277` `isPartialRebuild(job)`：`kind ∈ {'plan','regen-stage'}`、`stage ∈ {p1,p2,p3}`、`step_index > 0` 才算；`:240`（finishCancelled）/`:257`（finishFailed）写 `partial_at=now()`；`:224`（finishDone）清；`actions.ts:299` 每次重新起跑也清（「这一次的结果由本次 job 决定」）。
- 暴露：`snapshot.ts:82` `partialAt`；`:227-235` `partialHint` 只挂在 review-p1/p2/p3 的 `nextStep.hint`（「这次重建只完成了一部分，可以再点一次继续」），不 gate 任何动作——与 SPEC §4.6 R1a「stale/partial 只提示不 gate」一致。
- 独立验证：`api-test.mjs:1315-1336`「a half-finished stage rebuild is marked and can be finished by running it again」慢 `slowPlan` 供应商 + 10s 后 stop，断言 `partialAt` 非空、阶段 review、`nextStep.hint` 含「只完成了一部分」、旧幕仍可读；再跑一次断言 `partialAt===null`；本机跑绿。

### N5 [low] 创建幂等无测试 —— 已修 ✓

- `api-test.mjs:1366-1390`「the same Idempotency-Key replays one project instead of creating a second one」：同 key 第二次断言 `project.id` 相同且 `replayed===true`，换 key 断言 201 新书；本机跑绿。（我在 round-2 用探针证明过行为正确，这轮终于有回归保护。）

### N6 [low] 死代码 / 注释 —— 已清 ✓

- round-2 记的 `legacy.ts` 里 `void p1Content; void p3Snapshot; void p4Snapshot;` 已删；`snapshot.ts` 恒真首项 `review.pending === review.pending + 0` 已改写成正常条件（现 `deriveNextStep` 的 p4 分支直接读 `review.pending`）；`runner.ts` 的 `stageKey === 'p4' ? 'reviewing' : 'reviewing'` 死三元在此前 round 已清。

---

## 3. 残留（不阻塞，建议下一轮清）

### N7 [low] 回退没清迁移期写入的 `stage_items`：回退后 `/units` 仍有节拍

- 位置：`software/src/server/pipeline/legacy.ts:536-541`（回退事务 ①）只删「升级之后新增」的行：`DELETE FROM chapter_versions WHERE created_at > finishedAt`、`DELETE FROM stage_items WHERE project_id = ? AND updated_at > ?`；迁移时写入的 `stage_items(kind='beat_plan', source='migration')` 的 `updated_at` 早于 `finished_at`，因此**一条都不会被删**，随后 `DELETE FROM stages` 又只删了阶段行。
- 实测（`evidence/backend-round3-rollback-units.mjs`，短篇 legacy → migrate → rollback）：

  ```
  ### units after migrate      { "count": 1, "titles": ["未命名章节"] }
  ### rollback                 { "status": 200, "state": "rolled_back", "archived": [], "deleted": [] }
  ### units after rollback (期望 0) { "status": 200, "count": 1, "titles": ["未命名章节"] }
  ### pipeline after rollback  { "pipelineStatus": "legacy", "next": "migrate", "stages": {"p1":"empty","p2":"empty","p3":"review","p4":"review"} }
  ```

  即：项目已经回到 `legacy`（nextStep=`migrate`），但阶段视图仍显示 p3/p4 有内容（`stageViewStatus` 把「locked + 有 items」渲染成 review），`GET /units` 仍返回那条节拍。对纯读取无害（写作台读 `chapters`，正文正确），但「回退 = 回到升级前」在这块不成立。
- 为什么没被测试抓住：`api-test.mjs:1246-1259` 只断言 `state==='rolled_back'` 与正文还在，没有断言 `/units` 为空。
- requiredFix：回退事务里补一条 `DELETE FROM stage_items WHERE project_id = ? AND source = 'migration'`（迁移写入的行都带 `source='migration'`，见 `legacy.ts:262-283` 的 INSERT 列表），或把删条件从 `updated_at > finishedAt` 改成「`source='migration'` 或 `updated_at > finishedAt`」；并在 `api-test` 的回退用例里补一句「回退后 `/units` 为空、`stages` 里没有 p3/p4 内容」。

### N8 [low] `partialAt` 只覆盖取消/失败：崩溃中断不写、确认后不清

- 崩溃中断：`software/src/server/pipeline/runner.ts:56-75` `recoverInterruptedJobs()` 把 queued/running 置 `interrupted`、把 `generating` 的章节/阶段复位，并 `setProjectLastError({code:'INTERRUPTED'})`，但**没有** `partial_at`。若进程在 p2 重建的第 2 步被 SIGKILL，重启后阶段是干净的 `review`，用户看不到「只完成一部分」——只能从 `lastError=INTERRUPTED` + `retry` 猜。修法：在 `recoverInterruptedJobs` 里对 `isPartialRebuild(row)` 为真的 job 写 `partial_at`（job 行的 `step_index` 在库里，信息齐备）。
- 确认后不清：`actions.ts:150-185` `confirmStage` 与 `skipStage` 都不碰 `partial_at`（只 `setStageStatus(..., 'confirmed')` + 清 stale），于是「确认了一个只重建了一半的阶段」之后，`GET /pipeline` 里 `stages.p3.partialAt` 仍是非空值，直到下次起 job 才清。当前前端只用 `nextStep.hint`（且只对 review 生效），所以**用户看不见**，属 API 语义残留。修法：`confirmStage`/`skipStage` 里连带 `partial_at: null`。

### N9 [medium] p3「整份重新生成」仍会静默覆盖手改的计划字段并清零 `target_manual`

- 位置：`actions.ts:254-256` `assertOverwriteAllowed` 开头 `if (stageKey !== 'p1' && stageKey !== 'p2') return;` —— N1 的覆盖确认只覆盖 p1/p2。
- p3 的 `plan` 步骤（`steps.ts:300-326`）对「未锁定且无正文」的既有单元直接 `UPDATE chapters SET title, plan_function, plan_synopsis, plan_characters, min_words, target_words, max_words, target_manual = 0, ...`：**用户逐章改过的 synopsis / 功能 / 目标字数会被覆盖，且 `target_manual` 被无条件清零**。
- 后果链：`target_manual=0` 之后，`applyAllocation` 的 `blocked = planned.filter(changed && manualTargetOf(...))` 不再把这些章当手改行（`actions.ts:1038` 起的分配逻辑），F5/F6 那套「手改保护」在这条路径上被静默绕过——用户此前的分配结果不会丢（`target_words` 已被写成新值），但「我手改过」的标记没了。
- 为什么仍然判不阻塞：① 数据可恢复——`patchUnit` 对每次手改都写 `revisions(scope='item', source='manual')`（`actions.ts:1046-1050`），逐条可从修订历史找回；② 阶段级确认弹窗的文案本来就写「AI 会重做这一阶段的全部内容」（`PipelinePage.tsx:838-843`），只是没说「计划字段也一样」。
- requiredFix（二选一）：把 p3 纳入 `assertOverwriteAllowed`（修订里的 `scope='item' AND source IN ('manual','rollback')` 对 p3 同样成立，改一行即可，前端已具备覆盖确认弹窗）；或保留行为但在确认文案里点名「章节计划的标题/大纲/字数也会被重写，手改标记会清空」。

### N10 [low] 迁移的记账快照出现在用户可见的 P3 修订历史里

- 位置：`legacy.ts:330-340` 把 `{legacyChapterIds:[...]}` 写成一条 `revisions(scope='stage', stage_key='p3', targetId=null, note='迁移前章节清单')`；`pruneItemRevisions` 只裁 `scope='item'`，所以它长期驻留。
- 实测（迁移后的项目 `GET /api/projects/:id/stages/p3/revisions`）：

  ```json
  [{ "source": "migration", "note": "迁移前章节清单", "scope": "stage", "targetId": null,
     "content": "{\"legacyChapterIds\":[\"ch_...\"]}" },
   { "source": "migration", "note": "迁移快照", "scope": "stage", ... }]
  ```

  修订抽屉打开会把这段裸 JSON 当成「阶段快照」展示给用户；点恢复只会得到「阶段级快照暂不支持一键恢复」的 toast。功能上无害，属噪声。
- requiredFix：把清单存到 `migrations` 表的新列（或 `app_meta`），不要混进 `revisions`；若坚持用 `revisions`，给这类记账行一个用户不可见的 `source`/`scope` 并在 `listRevisions` 里过滤。

---

## 4. 七条验收判定

| # | 验收项 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 逐文件审查后端状态机与迁移，不以测试变绿代替正确性 | **pass** | §2 逐条对着当前字节读；三条高危/中危（N1/N2/N3）都用「读码 + 独立跑测 + 至少一处实测」三重确认；新测试也逐条看过断言是不是真能变红（如 N2 用慢供应商把 job 挂住才断言 409） |
| 2 | findings 带 file:line、问题、requiredFix | **pass** | §2/§3 每条都有坐标与修法；报告内所有行号取自当前工作树 |
| 3 | 阶段产物与状态真实落库，刷新/重启可继续 | **pass** | 本轮无回归：`api-test` 的「stage data survives restart」「restart after empty library」绿；`runner.ts:56-75` 恢复钩子仍是启动链第一段；`partial_at` 让「重启后阶段状态」比此前更诚实（除 N8 的崩溃分支） |
| 4 | 取消/失败不会留下半截脏数据 | **pass（有保留）** | 每步一个事务、被取消的步零写入（此前实测）；多步重建中途停下现在有 `partial_at` + hint（`runner.ts:240/257`、`snapshot.ts:227-235`）。保留：崩溃中断这条路径不写 `partialAt`（N8），以及回退残留 `stage_items`（N7）——后者不是「取消/失败」但同属「半截」类 |
| 5 | 旧项目迁移可重入、可回退，正文/版本/设定不丢 | **pass（有保留）** | 迁移失败路径干净、成功路径清 `last_error`、二次 migrate `alreadyMigrated`、回退按 id 清单判定且正文验收通过（测试 + 我的探针：回退后 `book chapters` 正文仍在、字数 26 未变）。保留：N7（回退未清迁移期 `stage_items`）、N10（记账快照进修订历史） |
| 6 | 无 Key / 无默认模型不静默 mock；短篇 scenes/beats 不硬套 chapters | **pass** | 配置门禁与 mock 分支本轮未动（`steps.ts` 的 `isMock` 仍只认 `selection.kind==='mock'`，`snapshot.ts` 的 `precheck` 仍先拦）；`api-test` 的「pipeline config gates (no model / no key refuse instead of silently mocking)」绿。短篇仍以 `stage_items(beat_plan)` 为唯一语料，`chapters` 只在 `mirror` 命中时同步（`steps.ts:375-377`），导出走 `shortMarkdown`（`index.ts:436` 起） |
| 7 | 并发/幂等/重试边界有测试或明确无法测试的原因 | **pass** | 并发：`CONCURRENT_JOB`（生成中 PATCH/DELETE/reorder/改章节数，`api-test.mjs:1139-1148`、`:1279-1313`）；幂等：创建幂等 `:1366-1390`、迁移幂等 `:876` 段；重试/续跑：interrupted → retry（`:1240` 前的 restart 段）、pause/continue；不可自动化项（真 SIGKILL 的时序）已有 `ui-test.mjs:628-664` 的 server kill 用例覆盖到「重启后 plan-continue」 |

---

## 5. 与 round-2 结论的差异

- round-2 的 N1（high）**不再成立**：`stale/resolve` 已转发确认，前端已具备二次确认并可重发；我用 UI 测试确认这条路在真实点击下可用。
- round-2 的 N2（medium）**不再成立**：入口 + 写步骤双保险，且有回归测试。
- round-2 的 N3（low）**不再成立**（改功能列的旧章不再被归档）；但同一处改动带出 N7（迁移期 `stage_items` 没清）。
- round-2 的 N4（low）**大体成立**：cancel/fail 已留痕；崩溃分支与确认后清理仍缺（N8）。
- round-2 的 N5、N6 **关闭**：幂等有测试；死代码已清。
- 新增 N9（p3 计划字段被覆盖 + `target_manual` 清零）与 N10（记账快照进修订历史），都是本轮读码/实测新发现，不在 t20 的清单里。

## 6. 明确无法验证 / 不在本轮范围

- **真机供应商 + 真 SIGKILL 时序**：我验证的是「服务端被杀后重启」的确定性路径（`ui-test` 有覆盖）；「模型调用在飞时被杀、上游是否仍在计费」属供应商侧，无法在本机断言。
- **Windows / Linux 上的文件锁与 VACUUM INTO 备份**：只在 macOS 本机验证。
- **多进程同时读写同一 `studio.db`**：设计明确单进程（DECISIONS ADR-6），本轮不验。
- **前端视觉/交互细节**（除 N1 的确认链路）：属 t22 范围，本报告不复核。

## 7. 证据与清理

- 探针：`team/inkquay-ai-first/evidence/backend-round3-rollback-units.mjs`（起 `PORT=5826` + 临时 `PW_DATA_DIR=/tmp/t24-db`，短篇 legacy → migrate → rollback → 再 migrate，打印 `/units`、`/pipeline`、`book chapters`）。跑完已 kill 5826 并删除 `/tmp/t24-db`、`/tmp/t24-server.log`。
- 日志：`/tmp/t24-typecheck.log`、`/tmp/t24-apitest.log`、`/tmp/t24-uitest.log`（末行均 `EXIT:0`）。
- 仓库内本轮只新增本报告与上面那个探针；`software/` 与 `desktop/` 零改动，未 commit / push。
