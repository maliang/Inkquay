# REVIEW-BACKEND · t8 独立评审（后端状态机 / 持久化 / 迁移 / 错误边界）

- 评审人：reviewer（t8，attempt 503cf329-d198-48b4-a7d2-ffb7cf0f1354）
- 时间：2026-10-29
- 评审对象：工作树字节（branch `main`，HEAD `ae75612`；`software/src/server/pipeline/` 全部 untracked，无 git 历史可 diff）
- 评审方法：① 逐文件通读 5658 行 pipeline 后端 + 相关 `repository.ts` / `index.ts` 读路径；② 起真实服务（`PW_DATA_DIR=/tmp/pw-rev-db PORT=5821 node_modules/.bin/tsx src/server/index.ts`）+ 直接读写 sqlite 构造旧数据；③ 用本地假 OpenAI 兼容供应商（`/tmp/pw-probe4.mjs` 等）做模型侧异常注入；④ 反向对照 `software/scripts/api-test.mjs` 断言了什么、没断言什么。
- 未改动任何业务代码、未 commit/push（`team/` 之外零写入）。

## 结论

**verdict = needs_revision**

两条 blocker 级问题（一条让「历史恢复」在 P3 章节计划上必然 500；一条会静默删掉已生成的章节计划），另有三条 high/medium 影响导出与短篇正文归属。任务合同里「取消/失败不留半脏状态」「迁移后仍能继续写作」「短篇不被强制走 chapters」三项均只是部分达成。

| # | 级别 | 位置 | 一句话 |
|---|------|------|--------|
| F1 | blocker | `software/src/server/pipeline/actions.ts:726` / `:730`、`software/src/server/pipeline/store.ts:35-46` | `restoreItemRevision` 在事务里再开事务 → P3 章节计划历史恢复 HTTP 500 |
| F2 | blocker | `software/src/server/pipeline/steps.ts:296`、`:341`、`software/src/server/pipeline/validate.ts:290` | 批次重建按「模型返回条数」删尾部 → 30 章计划静默变 4 章 |
| F9 | high | `software/src/server/pipeline/steps.ts:378`、`actions.ts:709`、`legacy.ts:267-271` | 短篇正文按 `sort_order` 镜像 → 排序后正文写进错误的章节行 |
| F10 | high | `software/src/server/index.ts:453-454`、`software/src/server/repository.ts:478-480` | 导出/上下文只认 `chapters` → 短篇流水线作品写完导不出；长篇排序后目录错序 |
| F3 | medium | `software/src/server/pipeline/legacy.ts:250-278` | 迁移把 `planSynopsis` 写成空串 → 迁移作品永远过不了 P3 确认（进不了 P4 写作） |
| F3b | medium | `software/src/server/pipeline/legacy.ts:283-290` | 迁移后阶段顺序倒挂：`p3=review` 而 `p4=confirmed` |
| F17 | medium | `software/src/server/pipeline/legacy.ts:171` + `snapshot.ts:216` | 迁移失败后再成功，`projects.last_error` 不清 → nextStep 永远「重试」 |
| F4 | medium | `software/src/server/pipeline/legacy.ts:390`、`:406` | 回退的「升级后已有新内容」守卫不可达；回退不清理升级后新增行 |
| F5 | medium | `software/src/server/pipeline/actions.ts:941`（对比 `:936-940`、`:924-925`） | 长篇「应用分配」把所有章都标成手改 → 第二次分配被全量拦 |
| F6 | medium | `software/src/server/pipeline/actions.ts:941` | 分配结果零校验（min/target/max 矛盾值直接入库） |
| F8 | medium | `software/src/server/pipeline/actions.ts:491`（其余入口缺失） | 生成期间只有 `createItem` 互斥，编辑/删除/排序都能改 |
| F7 | medium | `software/src/server/pipeline/steps.ts:419-422` + `:156/:169/:194-205/:238/:249` | 多步破坏性重建每步各自提交 → 失败/取消留半重建阶段 |
| F15 | low | `software/src/server/pipeline/store.ts:700` | `row.content ? 'p4' : 'p3'` 阶段归属启发式 |
| F11 | low | `software/src/server/pipeline/store.ts:183` | `stage.last_error` 一列两用（stale 原因覆盖失败原因） |
| F12 | low | `software/src/server/pipeline/runner.ts:209-217`、`:234-246` | 已确认阶段被无条件降级；`confirmed_revision_id` 与 `status` 可不一致（含 OBS-2 根因） |
| F13 | low | `actions.ts:374-375`、`runner.ts:214`、`legacy.ts:368`、`:370-371` | 死代码与恒真校验（「九条校验全过」里两条自证） |
| F14 | low | `software/src/server/pipeline/actions.ts:226` + `routes.ts:129-136` | p4 上游门禁被 `/pipeline/start` 旁路 |
| F18 | low | `software/src/server/pipeline/routes.ts:456` | 测试后门 `forceFail` 暴露在公开接口（注释写的是 env） |
| F19 | low | `software/src/server/pipeline/store.ts:179-185` | 空阶段也被标 stale |
| F20 | low | `software/src/server/pipeline/snapshot.ts:216` | `deriveNextStep` 忽略 stale：下游还挂着「上游已变更」就提示「开始写作」 |

---

## F1（blocker）P3 章节计划的历史恢复必然 500，且错误脱离接口契约

**位置**：`software/src/server/pipeline/actions.ts:717-739`（`restoreItemRevision`），关键两行：`:726` `withTx(() => {`、`:730` `patchItem(projectId, targetId, {...})`；`patchItem` 自己在 `actions.ts:336` 又 `withTx(`；`withTx` 实现见 `software/src/server/pipeline/store.ts:35-46`（只有 `db.exec('BEGIN IMMEDIATE')`，没有嵌套守卫/保存点）。

**实证**（`/tmp/pw-probe1.mjs`，novel 流水线作品，PATCH 章计划产生 `manual` 修订后恢复）：

```
POST /api/projects/<pid>/items/<unitId>/revisions/<revId>/restore
→ 500  {"error":"cannot start a transaction within a transaction"}
```

**影响**：
1. 用户对「章节计划」（chapters 行）做任何历史恢复都失败——而这正是流水线最需要 undo 的地方；`p1/p2`（stage_items 分支 `actions.ts:727-729`）不受影响，所以现象是「设定能恢复、章节计划不能恢复」，很难被当成 bug 报出来。
2. 该异常不是 `PipelineErrorException`，`routes.ts:472-484` 的错误处理器对它 `return next(error)`，最终由 Express 默认处理器回 HTML/裸 `{error}`，违反「所有失败返回 `{code,message,blockers}`」（`routes.ts:41` 的约定，前端按 code 渲染全挂）。
3. `software/scripts/api-test.mjs:581-582` 只测了一个 p1 world 条目的恢复，从未覆盖 chapter_plan（chapters 行）——所以 42 条全绿。

**requiredFix**：`withTx` 支持嵌套（内层用 `SAVEPOINT`/`RELEASE`），或把 `patchItem` 的写入主体抽成不开事务的内部函数供恢复路径直接调用；同时把非 `PipelineError` 异常映射成 `INTERNAL` 形状的统一错误响应。补一条 chapter_plan 恢复用例（PATCH 字数 → 恢复 → 断言 min/target/max 回到旧值）。

## F2（blocker）章节计划批次重建会静默删掉后续批次

**位置**：`software/src/server/pipeline/steps.ts:274-348`（`plan` 步），删除循环 `steps.ts:296`（短篇）/ `steps.ts:341`（长篇）：

```ts
for (const extra of existing.slice(entries.length + batchStart)) { ...删... }
```

**根因**：下界用的是**模型实际返回条数** `entries.length`，不是本批窗口的上界 `batchStart + batchSize`。而 `validateChapterPlan`（`software/src/server/pipeline/validate.ts:286-315`）只做 `checkCount(list, key, 1, limit, ...)`（`validate.ts:290`，min=1、max=batchSize）——模型合法返回 1..batchSize 条即可通过校验（提示词 `prompts.ts:158` 写「必须正好 N 条」，但没有任何强制）。此外窗口是按**数组下标**而不是单元 `ordinal` 计算的（`existing[batchStart + i]`），一旦有 archived/缺失行就会错位。

**实证**（`/tmp/pw-probe4.mjs`）：novel、目标 90000 字（每章 3000 → 两步 `0:20` + `20:10`），先用 mock 正常生成 **30 章计划**；随后切到一个「永远只回 2 条合法 chapter」的本地假供应商，`POST /pipeline/start {stage:'p3'}` 重做：

```
before: units=30 (ordinal 0..29)
after : units=4  (ordinal 0,1,20,21)，标题「假第1章/假第2章」重复
snapshot: p3=review, lastError=null, job=done
```

**影响**：26 条已生成的章节计划被 `DELETE`，无任何报错、无 stale 标记、无用户确认；计划里用户手写过的大纲/字数随行消失（删的是「无正文且未锁定」的行，所以数据其实全是计划数据）。这是「AI 少回几条」这种最常见的模型故障的必然结果。

**requiredFix**：删除边界改成 `existing.slice(batchStart + entries.length, batchStart + batchSize)`（只清本批窗口内的余额），并且当 `entries.length !== batchSize` 时**不删**、改为在 job 事件里记一条 `plan-short-batch` 警告；窗口对齐改用 `unit.ordinal` 而不是数组下标。补一条反向用例：假供应商少回条目 → 断言其他单元数不变。

## F9（high）短篇正文按 `sort_order` 镜像，排序/迁移后写进错误的章节行

**位置**：短篇 `write` 步 `software/src/server/pipeline/steps.ts:376-382`，镜像语句在 `:378`：

```ts
const mirror = oneRow('SELECT id FROM chapters WHERE project_id = ? AND sort_order = ? AND deleted_at IS NULL', projectId, unit.ordinal);
```

`unit.ordinal` 与 `chapters.sort_order` 只在创建时对齐：`reorderUnits` 短篇只改 `updateStageItem(id, { ordinal: index })`（`actions.ts:709`），迁移短篇按 `chapters.forEach((chapter, index) => ... ordinal: index)` 写入（`legacy.ts:267-271`）而 `chapters.sort_order` 保持原值。

**实证**（`/tmp/pw-probe6.mjs`，迁移短篇 + 交换前两条）：
```
reorder 后 units: 0:第2节标题  1:第1节标题  2:第3节标题
写「第2节标题」→ job done
legacy chapters: sort_order=0「第1节标题」的正文被替换成「第2节标题」的新正文（1266 字）
                 「第2节标题」行仍是旧正文
```

**影响**：旧写作台（`software/src/client/pages/StudioPage.tsx`）与导出都读 `chapters`，用户看到的就是「内容跑到别的标题下面」；短篇正文唯一的对外通道正因为这个镜像而错位。

**requiredFix**：改用稳定外键（`stage_items` 增 `chapter_id`，或在迁移时就建映射表）；过渡方案是在 `reorderUnits` 里同时重排 `chapters.sort_order` 并重算 `number`，并让迁移短篇按 chapters 的实际 `sort_order` 写 ordinal。补用例：迁移短篇 → reorder → 写一章 → 断言哪一行 chapters 变了。

## F10（high）导出与 AI 上下文只认 `chapters`：短篇写完导不出，长篇排序后目录错序

**位置**：`software/src/server/index.ts:453-454`（markdown 导出守卫 `hasBody`）、`index.ts:418-419`（docx 同一守卫）、`software/src/server/repository.ts:478-480`（`## ${c.number} ${c.title}`）；`reorderUnits` 长篇只改 `sort_order`（`actions.ts:710`），从不重算 `chapters.number`。

**实证**（`/tmp/pw-probe7.mjs`）：新建短篇（12000 字）走完 p1/p2/p3 并确认，写第 1 个 beat（1266 字）：

```
project.chapters.length = 0
GET /api/projects/<pid>/export.docx → 400（"这本还没有可导出的正文"）
```
（`/api/projects/:id/export` 走同一守卫，README 里短篇同样只能靠 chapters 导出。）

**影响**：
1. 短篇流水线作品的成品**导不出来**，而短篇恰恰是新流程的主场景之一；用户在流水线里看到正文写完了，点导出拿到 400。
2. 长篇：排序后 `chapters.number` 与 `sort_order` 脱钩，导出目录出现「第10章」排第一（DEF-16），同一个 `number` 也被 AI 对话上下文使用（`repository.ts:458/462`），会给模型灌错章节号。

**requiredFix**：导出层改为「按 kind 取语料」：novel 用 chapters（按 `sort_order` 重排编号或落库重算 `number`）、short 用 `stage_items(kind='beat_plan').body` 拼 markdown/docx；导出守卫相应接受 units 语料。DEF-16 与这一条同源，建议一并修。

## F3（medium）迁移后的作品永远过不了 P3 确认，进而进不了 P4 写作

**位置**：`software/src/server/pipeline/legacy.ts:250-278`（短篇 `planSynopsis: ''`；长篇 `synopsis = kind === 'novel' ? beat.summary : ''`）→ `actions.ts:110` 的 `blockersOf`：`if (unit.planSynopsis.trim().length < 15)`。

**实证**（`/tmp/pw-probe2.mjs` / `pw-probe3.mjs`，legacy 短篇 3 章）：

```
POST /stages/p3/confirm → 422 CONFIRM_BLOCKED
blockers: ["「第1节标题」大纲不足 15 字","「第2节标题」大纲不足 15 字","「第3节标题」大纲不足 15 字",
           "总目标 4500 字 / 全书目标 12000 字（-62.5%），超出 ±25%"]
POST /writing/start → 409「请先确认章节计划」
```

**影响**：迁移承诺「升级后继续写作」，但短篇迁移作品必须先逐条手写 ≥15 字大纲、再手动接受 25% 偏差才能开写；长篇在 beat 摘要短于 15 字时同样被堵。用户视角就是「升级完了点下一步，被要求补一堆东西」。

**requiredFix**：迁移时用已有语料填 synopsis（短篇取正文首段截断到 ≥15 字，长篇取 `beat.summary`；不足 15 字补一句「（迁移自旧稿，可直接改写）」），并对 `source='migration'` 的单元放宽「大纲必填」（有正文即视为可写）；迁移成功时自动 `acceptDeviation`（旧作品的字数目标本来就不符合新口径）。

## F3b（medium）迁移后的阶段状态倒挂

**位置**：`legacy.ts:283-290`：`p3 = chapters.length ? 'review' : 'locked'`、`p4 = pendingCount > 0 ? 'review' : 'confirmed'`。

**实证**（`pw-probe13.mjs`，legacy 长篇 3 章全有正文）：迁移后 `p1=confirmed p2=confirmed p3=review p4=confirmed`，nextStep 却是 `retry-failed`/`generate-p1`。

**影响**：`p4=confirmed` 但 `p3` 未确认，与 `confirmStage` 维护的不变式（上游必须已确认）冲突；前端把 p4 画成「已完成」，用户点任何后续动作都会被 `startWriting` 的 p3 门禁（`actions.ts:255-256`）打回。

**requiredFix**：迁移后 p4 只能是 `empty`（除非 p3 已 confirmed），按 p1/p2 是否齐备给 p1/p2 的 `review`/`locked`，p3 只在 p1/p2 都 confirmed 时给 `review`。

## F17（medium）迁移失败后再成功，项目级错误不清 → nextStep 永远「重试」

**位置**：`legacy.ts:171` 成功路径 `UPDATE projects SET migration_id = ?, schema_version = 2, pipeline_status = ?, stale = 0, ...`（**没有清 `last_error`**）；`snapshot.ts:216` `if (lastError && !job) return { kind: 'retry-failed', ... }` 优先级高于所有阶段推进分支。

**实证**（`pw-probe13.mjs`）：`POST /migrate {forceFail:true}` → 500 `MIGRATION_CHECK_FAILED`（阶段数据 0 行、正文逐字节不变，失败路径本身是干净的）→ 再 `POST /migrate {}` → 200 `state=done`，四个阶段 `confirmed/confirmed/review/confirmed`，但：

```
snapshot.lastError = {code:"MIGRATION_FAILED", message:"V-Force:..."}
snapshot.nextStep  = {kind:"retry-failed", label:"重试"}
```

**影响**：一旦用户经历过一次迁移失败，即使后来成功，流水线头部永远挂着红色错误、下一步永远是「重试」，只能靠成功跑一个 job（`runner.ts:213` 清 `last_error`）或显式清错误接口才能恢复。这是「状态机是否真持久化正确」的直接反例：状态落库了，但派生状态（nextStep）被陈旧错误锁死。

**requiredFix**：迁移成功路径同时 `last_error = NULL`；`deriveNextStep` 在 `migration.state === 'done'` 时忽略 `MIGRATION_FAILED`。

## F4（medium）迁移回退：「升级后已有新内容」守卫不可达，回退不清理升级后新增行

**位置**：`legacy.ts:390` `if (!confirm) fail('BAD_REQUEST', '回退需要显式确认（confirm=true）')` 在最前 → `legacy.ts:406` `if (touched.length && !confirm) fail('CONFIRM_BLOCKED', '升级后已有新内容，回退会丢掉它们')` **永远不可达**（能走到这里 `confirm` 必为 true）。

**其他回退缺陷**（`legacy.ts:409-431`）：
- 只 `DELETE stages/stage_items/revisions(source='migration')/generation_jobs/review_records/migrations` + 复位 chapters 的 `plan_*`，**不删升级后由流水线新建的 chapters 行**（`addPlannedUnit`，`actions.ts:877-892`），也**不回退流水线写进 chapters 的正文**（短篇镜像 `steps.ts:378-382`、长篇 `steps.ts:355-370`）→ 回退后得到「旧作品 + 一堆没有计划字段的流水线章节」的混合体，而这些章节还会被导出。
- `characters/outline_acts/outline_beats` 一律置 `source='manual'`（`legacy.ts:423-425`），来源区分（迁移/手改/AI）全部丢失，二次迁移无法判断。
- `migrations` 行写成 `from_schema=2, to_schema=1`（`legacy.ts:429-431`），而 `projects.schema_version` 留在 2（`legacy.ts:419`）——语义自相矛盾。

**实证**（`pw-probe3.mjs`）：迁移后立即 `rollback {confirm:true}` → `state=rolled_back`、units=0、原正文不变（这一路径 OK）；但「升级后已写新正文」的场景因守卫不可达，代码路径上根本不会被拦。

**requiredFix**：touched 检查独立于 `confirm`（`confirm=false` 时也返回 `CONFIRM_BLOCKED` + blockers，让前端能弹二次确认）；回退时按 `migration.finished_at` 删除升级后新增的 chapters / stage_items / chapter_versions，并恢复 `source`；统一 `schema_version` 语义（结构版本 vs 迁移状态分离）。

## F5（medium）长篇「应用分配」把所有章都标成手改，第二次分配被全量拦截

**位置**：`actions.ts:922-947`。长篇分支 `:941`：

```ts
exec('UPDATE chapters SET min_words = ?, target_words = ?, max_words = ?, target_manual = ?, updated_at = ? WHERE id = ?',
     row.minWords, row.targetWords, row.maxWords, includeEdited ? 0 : 1, now(), row.unitId);
```

即「只要不是 includeEdited，就把所有行标成手工改过」；短篇分支（`:936-940`）是 `targetManual: includeEdited ? false : 原有值`（保留原值）。两分支语义相反。

**实证**（`/tmp/pw-probe5.mjs`）：
```
第一次 apply（不传 includeEdited）→ 200
再取 allocate 预览 → 4/4 行 manuallyEdited = true
第二次 apply（不传 includeEdited）→ 422 TARGET_EDITED，blockers=4 个 unitId
```

**影响**：用户点一次「应用分配」之后，这个作品的分配功能就永久锁死，除非勾「覆盖手改」——而勾了又把所有手改标记清零（`target_manual=0`），手改保护形同虚设。D9「手改标记以服务端为准」的意图被实现反噬。

**requiredFix**：长篇改成「只在本次目标值与现值不同时置 1」，与短篇分支统一；`includeEdited=true` 只清被本次覆盖的行，而不是全表。

## F6（medium）分配结果零校验

**位置**：`actions.ts:926-947`（`applyAllocation`）直接写 `rows` 的 min/target/max；路由 `routes.ts:304-311` 原样透传 `body.rows`。对比 `patchUnit` 有 `if (!(min <= target && target <= max)) fail('BAD_REQUEST', ...)`（`actions.ts:764`）与 floor/ceiling 校验。

**实证**（`pw-probe5.mjs`）：
```
POST .../units/allocate/apply
{rows:[{unitId, minWords:9000, targetWords:10, maxWords:5000}], includeEdited:true} → 200
GET /units → {target:10, min:9000, max:5000}   ← 非法区间真的入库了
之后 confirm p3 → 422 ["「假第1章」字数范围不合法（需 300 ≤ min ≤ target ≤ max ≤ 20000）"]
```

**影响**：非法字数区间被写进数据库，错误只能在「确认 P3」时以一条汇总 blocker 出现；此后如果用户直接开始写作，`steps.ts:355` 会拿 `targetWords=10` 去写（`validateChapterText` 的 `minWords` 门槛同样荒谬）。

**requiredFix**：`applyAllocation` 复用 `patchUnit` 的校验（`min<=target<=max`、`minWordsFloor`、`maxWordsCeiling`），逐行失败时返回 `blockers` 指明哪些行非法。

## F8（medium）生成期间没有写互斥：只有 `createItem` 挡了一下

**位置**：全仓只有 `actions.ts:491` `if (stage?.status === 'generating') fail('BAD_REQUEST', '正在生成，等这一步结束后再改')`（在 `createItem` 里）；`patchItem`（`actions.ts:331`）、`deleteItem`（`actions.ts:597-630`）、`lockItem`（`actions.ts:450-459`）、`reorderItems`（`actions.ts:644-699`）、`patchUnit`（`actions.ts:745-802`）、`setUnitCount`（`actions.ts:822-852`）都没有同类守卫。

**影响**：与破坏性重建组合成数据丢失：`steps.ts:169` `DELETE FROM characters WHERE project_id = ? AND locked = 0`——用户在「正在生成设定」时手加的人物会在该步提交时被静默删掉；`reorderUnits` 在 P4 写作期间改 `sort_order` 也会让短篇镜像（F9）写错行。这一条与 F7 是同一个「并发边界」问题的两端。

**requiredFix**：在 pipeline 的写入口处统一加 `ensureStageIdle(projectId, stageKey)`（`generating` 时 409），或对 `manual` 来源/`locked` 条目在重建步骤里做保护性保留；补测试：generating 期间 PATCH/DELETE/reorder 期望 409。

## F7（medium）多步破坏性重建非原子：失败/取消留下半重建阶段

**位置**：`steps.ts:419-422` 每个 step 各自 `commit(projectId, fn) → withTx(fn)`；破坏性步骤：`steps.ts:156`（env 删未锁）、`:169`（characters 删未锁）、`:194-205`（acts：先删未锁 beats 再删 acts / 短篇删 beat_group）、`:238`、`:249`（beats 按 act 删）。

**影响**：P2 的 `acts` 步成功、`beats` 步失败或被取消 → 阶段停在被掏空一半的状态（幕已重建、节拍只剩一部分），前面步骤不回滚；而 `finishCancelled`（`runner.ts:219-232`）明确不回滚已提交步骤。没有任何 `CONTENT_WOULD_BE_LOST` 之类前置确认（该错误码只用在 `setUnitCount`，`actions.ts:831`）。

**未被测试覆盖**：`api-test.mjs:716-718` 的取消用例只取消 P1，且断言 `cancelSnap.stages.p1.counts.items===0`；多步重建中途取消（acts 已成、beats 未成）没有任何测试。

**requiredFix**：把同一 job 的重建步骤收进一个事务（或「先收割全部产物到内存/临时表，最后一次性 swap」）；至少在破坏性重建前返回需要确认的 blocker（列出将被覆盖的手改条目数）。

## F15（low）阶段归属启发式：`row.content ? 'p4' : 'p3'`

**位置**：`store.ts:696-701`，`return row.content ? 'p4' : 'p3';`（`:700`）。

**影响**：已有正文的章节行，任何「计划字段」编辑（`patchItem` → `afterContentTouched(projectId, stageKey)`，`actions.ts:380`）与历史恢复（`restoreItemRevision`，`actions.ts:726-736`）都会被记到 p4，于是修订历史归错阶段、stale 标到 p4 而不是 p3（下游语义相反：p3 的下游是 p4，p4 没有下游）。

**requiredFix**：`stageKeyOfTable` 不再猜，改为调用方显式传 stageKey（plan 相关一律 p3，正文相关 p4）。

## F11（low）`stage.last_error` 一列两用

**位置**：`store.ts:179-185`，`:183` `updateStage(projectId, key, { stale: 1, last_error: JSON.stringify({ staleReason: reason }) })`。

**影响**：`last_error` 同时承载「失败原因」（`runner.ts:240` 写 `{code,message}`）与「stale 原因」（`snapshot.ts:53-56` 读 `staleReason`）。一个刚失败过的阶段，被上游一次编辑标记 stale，失败原因就被覆盖；反之 `resolveStale('keep')`（`actions.ts:202`）把 `last_error` 置 null 时也会抹掉失败原因（如果同时存在）。

**requiredFix**：stale 原因换独立列（`stale_reason`）或独立表；`last_error` 只放失败。

## F12（low）已确认阶段被无条件降级，`status` 与 `confirmed_revision_id` 可不一致

**位置**：`runner.ts:209-217`（`finishDone` 无条件 `status: stage.skipped ? 'skipped' : 'review'`、`last_error: null`）、`:219-232`（`finishCancelled` 同样降到 `review`/`empty`）、`:234-246`（`finishFailed` 降到 `review`/`failed`）；`confirmed_revision_id`/`confirmed_at` 三处都不清。

**影响**：
1. OBS-2 的根因就在这里：`steps.ts:424-443`（`recordItemRevision`）刻意实现「阶段已确认时单条重生成只标下游 stale，不撤销本阶段确认」（INV-1），但 `finishDone` 随后把本阶段置为 `review`，那段分支成为死代码——代码里同时存在两种互相矛盾的语义，读代码的人无法判断哪个是产品意图。
2. 一个 `confirmed_revision_id` 存在但 `status='review'/'failed'` 的阶段，会让「历史确认版本」与「当前状态」打架（前端如果按 `confirmed_revision_id` 渲染就是错的）。
3. `recoverInterruptedJobs`（`runner.ts:55-69`）把 `generating` 一律置 `review`，即使该阶段一条条目都没有（我的重启探针里 p3=review 且 counts.items=0）。

**requiredFix**：把「阶段状态的写入」收敛到一个函数（含 `confirmed_*` 的同步不变量：非 confirmed 状态必须清 `confirmed_revision_id`，或反之）；明确单条重生成是否撤销确认，并删掉另一条不被采用的路径（不要留死分支）。

## F13（low）死代码与恒真校验

- `actions.ts:374-375`：`const columns = {...}; void columns;`
- `runner.ts:214`：`setPipelineStatus(projectId, stageKey === 'p4' ? 'reviewing' : 'reviewing')`
- `legacy.ts:368`：`checks.push({ id: 'V8', ok: true, detail: '升级过程未调用任何模型…' })` —— 没有任何断言，直接 true。
- `legacy.ts:370-371`：`V9 { ok: versionMismatch >= 0 }` —— 常量真。

**影响**：迁移界面显示「九条校验全过」，其中 V8/V9 是自证；如果将来 provider 被误引入迁移路径，V8 也不会红。

**requiredFix**：V8 改成真实断言（迁移前后 provider 调用计数为 0 / 迁移函数不接受 provider 依赖），V9 改成 `versionMismatch` 的具体项枚举；删掉死变量与死三元。

## F14（low）p4 上游门禁被 `/pipeline/start` 旁路

**位置**：`actions.ts:226` `if (stageKey !== 'p4') fail('STAGE_LOCKED', '请先确认上一阶段')`；`routes.ts:129-136` 的 `POST /api/projects/:id/pipeline/start` 对任意 stage 调 `startStageJob(projectId, stage, { scope: 'all', kind: 'plan' })`。

**影响**：未经 p3 确认也能起 p4 写作任务，绕过 `startWriting` 的 `stage.status !== 'confirmed'` 门禁（`actions.ts:255-256`）。

**requiredFix**：p4 的 start 也校验 p3 confirmed（或只允许 `continueWriting`/`retry` 这类明确恢复入口）。

## F18（low）测试后门暴露在公开接口

**位置**：`routes.ts:456` `migrateProject(projectId, { forceFail: Boolean(req.body?.forceFail) })`，而 `legacy.ts:151-153` 的注释写的是 `PW_MIGRATION_FORCE_FAIL 已开启`。

**影响**：任何客户端都能强制让迁移失败（会把 `projects.last_error` 写成 `MIGRATION_FAILED`，配合 F17 会长期卡住 nextStep）。本地单用户风险低，但测试钩子进了产品代码路径、且文档与实现不一致。

**requiredFix**：仅在 `process.env.PW_MIGRATION_FORCE_FAIL === '1'` 或 dev 构建下接受 `forceFail`。

## F19（low）空阶段也被标 stale

**位置**：`store.ts:179-185`（不判阶段是否为空）。

**实证**（`pw-probe11.mjs`/`11b.mjs`）：p2/p3/p4 都还是 `empty` 时编辑 p1，三个下游都拿到 `staleReason="p1:edited"`；p3 被编辑后 p4（`empty`）也拿到 `p3:edited`。

**影响**：前端会在「尚未生成的阶段」上显示「上游已变更」横幅，提示用户去复核一个还不存在的产物。

**requiredFix**：只对 `status ∈ {review, confirmed, generating}` 标 stale。

## F20（low）`deriveNextStep` 忽略 stale：下游还挂着「上游已变更」，提示却是「开始写作」

**位置**：`snapshot.ts:204-232`（判定链里没有任何 stale 分支）。

**实证**（`pw-probe11b.mjs`）：p1 重新确认后，p2/p3/p4 仍 `staleReason="p1:edited"`，而 `nextStep = {kind:'start-writing'}`。

**影响**：这可能是产品决策（INV-1：stale 只是建议，不阻塞），但那样文案应写「可继续，但下游待复核」；当前形态是「头部提示开始写作，同时三个阶段挂红条」，用户不知道听哪个。

**requiredFix**：在 SPEC 里明确 stale 是否 gate；若要 gate，`startWriting` 前检查下游 stale 并要求显式「忽略」；若不 gate，nextStep 文案带上待复核提示。

---

## 验收项逐条判定

| 合同验收项 | 判定 | 依据 |
|---|---|---|
| 阶段产物真的落库（刷新/重启不丢阶段） | **pass** | sqlite；`index.ts:68-70` 启动链 `migrate(); recoverInterruptedMigrations(); recoverInterruptedJobs(); pump();`。`pw-probe8.mjs`：SIGKILL 后重启 → job `interrupted`、`p1/p2=confirmed` 保留、p3 `review`、nextStep `retry-failed` |
| 长任务可取消/可恢复 | **pass** | `pw-probe10b.mjs`：cancel → job `cancelled`/`stopMode=user_cancel`；`POST /jobs/:id/retry` 从 `step_index` 续跑，30 个单元 ordinal 无重复（`resumeStepsFor`，`runner.ts:285-296`） |
| 取消/失败不留半脏数据 | **partial** | 单步事务本身干净（`pw-probe13.mjs` 强制迁移失败：stages 0 行、正文逐字节不变）；但多步破坏性重建非原子（F7），计划批次重建会被截断（F2） |
| 旧项目迁移安全（可重入/可回退/不丢正文·版本·设定） | **partial** | 幂等 ✓（二次 `migrate` → `alreadyMigrated`，`pw-probe3.mjs`）；正文/版本逐字节保留 ✓（V2/V4 真断言，`pw-probe13.mjs` 校验后仍 intact）；**但**短篇迁移后过不了 P3 确认（F3）、阶段倒挂（F3b）、失败重试后陈旧错误锁死 nextStep（F17）、回退守卫不可达且残留流水线行（F4） |
| 无 Key/无默认模型不得静默 mock | **pass** | `steps.ts:90-99` 只有 `selection.kind==='mock'` 才注入 mockText；`snapshot.ts:123-138` 的 precheck 返回 `NO_DEFAULT_MODEL`/`NO_API_KEY` 并根据 `deriveNextStep` 给出「去配置」 |
| 短篇不被强制走 chapters | **partial** | 写作/审校/单元 API 全走 `stage_items(kind='beat_plan')` ✓；**但导出与旧读路径只认 chapters**（F10），镜像本身还会错位（F9） |
| 并发/幂等/重试边界有测试或明确不可测 | **partial** | `api-test.mjs` 42 条覆盖了 happy path + 部分异常（stale/cancel/pause/interrupted/migrate/rollback/allocate/reorder），但 chapter_plan 恢复、少条批次、迁移后写作、回退 touched 保护、生成期编辑互斥 全部无覆盖（见下） |

## 对两条已知 low 的裁定（captain 问）

- **DEF-16（`actions.ts:710` 排序不重算 `chapters.number`）**：**不单独阻塞**，但我把它并入 F10 一起判——它不是纯显示问题：`number` 进导出 markdown（`repository.ts:479`）和 AI 对话上下文（`repository.ts:458/462`），排序后会给出错序目录与错误章节号。级别建议 medium，属 F10 修复范围内。
- **OBS-2（`runner.ts:212` 无条件置 review 使 `steps.ts:432-443` 成死代码）**：**不阻塞**。行为上「内容变了回 review」是安全侧；问题是代码里同时存在 INV-1 的反向语义，属于可维护性/一致性问题（并入 F12）。不建议为它单独返工，但要求在同一次整改里删掉或接通 INV-1 分支，别留死代码。

## 测试缺口（建议补进 `software/scripts/api-test.mjs`）

1. `chapter_plan` 的历史恢复（当前只测 p1 world，`api-test.mjs:581-582`）→ 直接抓 F1。
2. 假供应商少回条目 / 多回条目 → 断言其他单元数不变（F2）。
3. 迁移短篇后走到 P4 写作（当前迁移只测 novel 且只断言 p1/p3 状态，`api-test.mjs:868-871`）。
4. `rollback` 在「升级后已有新正文」时的 `CONFIRM_BLOCKED`（当前不可能触发，F4）。
5. 多步重建中途取消（acts 成、beats 未成）后阶段内容完整性（F7）。
6. `generating` 期间 PATCH/DELETE/reorder 期望 409（F8）。
7. `applyAllocation` 非法区间的 422（F6）与二次 apply 的 `TARGET_EDITED` 行为（F5）。
8. 短篇导出（F10）：写完 beat 后 `GET /export` 应返回 200 且含正文。

## 明确无法验证 / 未验证项

- 真机 macOS Desktop 端（窗口关闭守卫、`closeGuard`）不在本任务 inScope，未验。
- 真实第三方供应商行为（超时/限流/上下文超长）未做端到端；只用本地假供应商模拟「返回条数不足」「连接失败」（NETWORK）。`PROVIDER_TIMEOUT` 路径只做了代码审查（`provider/call.ts` + `STATUS_BY_CODE`）。
- 并发多项目（`PW_JOB_CONCURRENCY=3`）下的公平性与不互相干扰未压测；单项目互斥的 `ensureNoActiveJob` 已验。
- Windows/Linux 路径与 sqlite 行为未验。

## 探针与清理

可复现探针已留档到 `team/inkquay-ai-first/evidence/`（均为一次性脚本，跑前需先在本机起服务：`cd software && PW_DATA_DIR=/tmp/pw-rev-db PORT=5821 node_modules/.bin/tsx src/server/index.ts`，并按脚本内注释先 `PUT /api/settings {defaultModel:{providerId:'mock',modelId:'mock-writer'}}`）：

| 脚本 | 复现的 finding |
|---|---|
| `evidence/backend-review-f1-restore-500.mjs` | F1（chapter_plan 历史恢复 500） |
| `evidence/backend-review-f2-plan-truncation.mjs` | F2（30 章 → 4 章，自带假供应商） |
| `evidence/backend-review-f9-short-mirror.mjs` | F9（排序后正文写错行，需先有一本迁移短篇） |
| `evidence/backend-review-f10-short-export.mjs` | F10（短篇写完导出 400） |
| `evidence/backend-review-stale-propagation.mjs` | F19/F20（空阶段被标 stale、nextStep 忽略 stale） |
| `evidence/backend-review-f17-migrate-fail.mjs` | F17（迁移失败后再成功仍残留错误），同时验证失败路径不留脏数据 |

其余探针（重启恢复、cancel+retry、allocate 标记、迁移短篇确认阻塞）在同一次评审中执行，原始输出已摘录在上文对应 finding 里；评审结束后已 kill 5821 端口进程并删除 `/tmp/pw-rev-db`、`/tmp/pw-rev-server.log` 与 `/tmp/pw-probe*.mjs`。仓库内除本文件与上述 6 个 evidence 脚本外未新增/修改任何文件（业务代码零改动）。
