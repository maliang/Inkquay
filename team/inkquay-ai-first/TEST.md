# TEST.md — AI-first 创作流水线独立 E2E 验收（t7 第一轮 + t14 第二轮 + t16 第三轮 + t18 第四轮复验）

- 验收人：qa（AgentTeams 成员），不复用实现者自测结论，全部用例独立编写。
- 任务：t7（attempt 2）/ t14（attempt 2）/ t16（attempt 2）/ **t18 第四轮（attempt 2，`attempt_id=8f3198a9-5e85-4486-90b0-c10f1ab8b0a4`）**
- 时间：2026-10-29（本机 macOS arm64）
- 仓库：`/Users/maliang/Documents/develop/maliang/私家写手`，应用在 `software/`
- 代码状态：HEAD=`ae75612`，工作树含重构未提交改动（`software/src/server/pipeline/`、`software/src/client/pages/PipelinePage.tsx` 等）。本次验收**未改动任何业务代码**，只新增 `software/scripts/qa-e2e-api.mjs`、`software/scripts/qa-e2e-ui.mjs`、`software/scripts/qa-e2e-r4.mjs` 与本文件；**未 commit / 未 push**。

## 0. 当前结论（t18 第四轮复验，最新）

> 第一至第三轮的结论保留在 §0-R1 / §0-R2 / §0-R3 与 §1–§10，作为历史；**当前有效结论以本节与 §11 为准**。

| 项 | 结果 |
| --- | --- |
| 验证命令（我自己起 fresh 进程实跑） | `typecheck` exit 0（`tsc --noEmit` 无输出）/ `test` **36 组** PASS（`All API tests passed.`）/ `test:ui` **35 段** PASS（`All UI tests passed.`） |
| 独立 API 套件（30 步，重跑） | **30 通过 / 0 失败 / 0 缺陷**，exit 0 |
| 独立 UI 套件（14 段真点击，重跑） | **14 通过 / 0 失败 / 0 缺陷**，exit 0 |
| 本轮新增的自建探针 `qa-e2e-r4.mjs` | **19 步全通过 / 0 失败 / 1 条 low 观察项**（A1–A13 API 取证 + U1–U6 真实点击），exit 0 |
| 上一轮 3 条 medium 复核 | **DEF-13 / DEF-14 / DEF-15 全部验证已关闭**，且都有我自己造的 API 响应与浏览器点击证据（§11.2–§11.4），不采信 t17 自测的 36/35/30/14 |
| 本轮新增发现 | **DEF-16 [low]**：P3 章节计划重排后顺序变了，但 `chapters.number` 不重排 —— 计划表按 index 显示 1..N，写作台左侧章号与正文抬头仍显示旧章号，同一本书两处编号不一致（§11.6） |
| 本轮 verdict | **pass**：t18 三条验收标准逐条达标（§11.8）；DEF-16 是 low、且不在 t17 声明范围内，已登记给 captain 决定是否排修，不阻塞 t8/t9 评审 |

一句话结论：t17 的三处修复经我独立复验**确实成立**——上游改动现在每次都会标下游 stale（含「复核并保留」之后再改）、「按上游重排」在上游未确认时禁用并写明「先确认上一阶段（设定）」、确认上游后恢复可点且真的起重排 job 且不再 409、P1/P2 条目与 P3 章节/节拍排序在浏览器真点击可用且刷新/重启后顺序保持、旧作品迁移后正文逐字节不变且版本可回退。

## 0-R3 第三轮（t16）结论（历史）

> 第一轮（t7）与第二轮（t14）的结论保留在 §0-R1 / §0-R2 与 §1–§9，作为历史；**当前有效结论以本节与 §10 为准**。

| 项 | 结果 |
| --- | --- |
| 验证命令（我自己起 fresh 进程实跑） | `typecheck` exit 0 / `test` **34 组** PASS（`All API tests passed.`）/ `test:ui` **32 段** PASS（`All UI tests passed.`） |
| 独立 API 套件（30 步） | **30 通过 / 0 失败 / 0 缺陷**，exit 0 |
| 独立 UI 套件（14 段真点击） | **14 通过 / 0 失败 / 0 缺陷**，exit 0 |
| 第一轮 9 条缺陷 + 第二轮 3 条缺陷复核 | DEF-1/2/3/4/5/7/8/9、DEF-10/11/12 **全部验证已修**（t15 补的服务端 `snapshot.ts:56` 与 `actions.ts:201` 两处我单独取证，见 §10.2）；DEF-6 早在 t12 关闭 |
| 本轮新增发现 | **DEF-13 [medium]** 上游改动**只会**在「本阶段处于 confirmed」时标下游 stale，「复核并保留」之后再改上游 → 已确认下游永久失去提示；**DEF-14 [medium]** 横幅上的「按上游重排」在横幅出现的那个状态里必定 409（必须先回上游重新确认）；**DEF-15 [medium]** SPEC M3 的「条目增删 / 章节重排」V1 必须项未实现（接口 404、界面无入口） |
| 本轮 verdict | **needs_revision**：7 条验收标准逐条达标（§10.4），但 3 条 medium 都是「SPEC 明写、实现没有」的落差，且 DEF-13/DEF-14 让 SPEC R1 的 stale 机制在用户最常走的路径上失效或死路 |

好消息（本轮独立复现，重构目标持续成立）：「新建作品 + AI 企划」不再无响应；长篇 P1→P4 与短篇节拍全流程真点击走通；暂停=写完本章再停、继续续写不丢内容、立即停止丢弃当前章、SIGKILL 重启后 `interrupted` 可 retry；旧作品升级/回退后正文逐字节不变；无 Key/无默认模型明确 422 且不落空壳、失败路径无 mock 特征文本。

## 0-R2 第二轮（t14）结论（历史）

| 项 | 结果 |
| --- | --- |
| 验证命令 | 全绿：`typecheck` exit 0 / `test` 33 组 PASS / `test:ui` 32 段 PASS |
| 独立 API 套件（30 步） | **30 通过 / 0 失败 / 0 缺陷** |
| 独立 UI 套件（13 段） | **13 通过 / 0 失败 / 0 缺陷** |
| 第一轮 9 条缺陷复核 | DEF-1/2/3/4/5/7/8/9 全部验证已修；DEF-6 已由 t12 关闭 |
| 本轮新增发现 | DEF-10 [medium] 已确认下游看不到 stale 提示；DEF-11 [low] 锚点 `stage-stale-banner` 不存在；DEF-12 [low] 横幅直接把 `p1:regenerated` 给用户看 |
| 本轮 verdict | **needs_revision** |

## 0-R1 第一轮（t7）结论（历史）

| 项 | 结果 |
| --- | --- |
| 三条验证命令 | 全绿：`typecheck` exit 0 / `test` 31 组全 PASS / `test:ui` `All UI tests passed.` |
| 独立 API 套件（30 步） | **25 通过 / 5 失败**，另有 6 条缺陷 |
| 独立 UI 套件（13 步，Playwright 真点击） | **10 通过 / 3 失败**，另有 7 条缺陷 |
| 本轮 verdict | **needs_revision**：2 条 blocker（DEF-1、DEF-2）使「长篇 P2 阶段确认」「短篇逐节拍审阅」走不通 |
| 上一轮 blocker 复核 | DEF-6（暂停后 `continue` 400）已由 t12 修复，本轮 D1/D2/D4 与 U7 **全部通过**，缺陷关闭 |

用户可见的好消息（本次重构的核心目标已达成）：**「新建作品 + 让 AI 企划」不再无响应**——创建 7ms 返回、5s 内进企划页、等待期有秒级进度与「取消」、失败给结构化错误卡并可重试、取消/删除不留孤儿空壳（U1/U2/U3、A1/A2/A3 全通过）。暂停语义按 D4 修好：暂停=写完本章再停（受理 5ms、落定 paused、该章有正文、`nextStep=resume-writing`），继续写作从下一个待写单元续写且已写内容逐字节不变，立即停止丢弃当前章且 ≤2s 生效。

## 1. 验收方法（为什么不复用实现者断言）

实现者的 `software/scripts/ui-test.mjs` / `api-test.mjs` 是其自测。本轮另写两套独立脚本：

- `software/scripts/qa-e2e-api.mjs`（新，900+ 行）：自建临时数据目录 + 端口 8831 + 自建假 OpenAI 兼容供应商（可注入 `delayMs / hang / auth 失败 / 乱码 JSON / 空 content / varying`），30 个断言步骤 A0–G2，每步独立 `record()`；证据写 `team/inkquay-ai-first/evidence/qa-api-results.json`，服务端日志写 `evidence/qa-api-server.log`。
- `software/scripts/qa-e2e-ui.mjs`（新，Playwright，端口 8832，临时数据目录）：13 段真实点击 U0–U12，覆盖开屏配置、新建+企划的成功/失败/取消、长篇 P1→P4、短篇、迁移、断网；三路采集 `pageerror` / `console` / `response`，`>=400` 请求逐条带 `at(ms)/status/method/path/page`；截图存 `evidence/ui-shots/`，结果写 `evidence/qa-ui-results.json`。

判定纪律（避免把「我的断言写错」当成产品缺陷）：每步先取服务端真实状态（`GET /api/projects/:id/pipeline`、`/units`、`/migration`）再对照 UI；`waitJob` 必须带 `jobId`（否则上个已 `done` 的 `lastJob` 会让等待立刻返回，产生假绿）；`>=400` 只放过脚本刻意制造的失败用例。

### 复现命令

```bash
pnpm --dir software typecheck
pnpm --dir software test
pnpm --dir software test:ui
node software/scripts/qa-e2e-api.mjs      # 独立 API 验收（exit 1 = 有失败/缺陷）
node software/scripts/qa-e2e-ui.mjs       # 独立 UI 验收（Playwright 真点击）
```

两个 QA 脚本自带 fake provider 与临时 `PW_DATA_DIR`，不碰主人的真实库（真实库 `~/Library/Application Support/inkquay/studio.db` 未被访问）。

## 2. 三条验证命令的实跑结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir software typecheck` | `tsc --noEmit` 无输出，exit 0 |
| `pnpm --dir software test` | 31 组全 PASS，末行 `All API tests passed.`；含 `PASS pause finishes the current chapter and can continue, stop aborts it and cannot continue`、`PASS short projects run the same pipeline with beat plans instead of chapters`、`PASS legacy migration is re-entrant, rollback-safe and never loses text/versions/settings` |
| `pnpm --dir software test:ui` | `All UI tests passed.`；运行期两条 `404 GET /api/projects/<id>/pipeline`（作品被删瞬间仍在飞的轮询，见 OBS-1） |

注意：这三条命令全绿**不代表验收通过**——它们覆盖不到 DEF-1（P2 单条重生成打回 P1）、DEF-2（短篇审阅 404）。这正是本任务要求独立验收的原因。

## 3. 独立 API 套件：30 步结果

| 步骤 | 结论 | 证据摘要 |
| --- | --- | --- |
| A0 环境准备（mock 供应商显式选择） | PASS | precheck ok → mock/mock-writer |
| A1 新建+AI 企划成功路径 | PASS | 创建 **7ms** 返回 201；job 立即可见；p1=review/6 条；`nextStep=review-p1`；无 >15s 静默 |
| A2 企划失败（供应商不可达） | PASS | `job.state=failed code=NETWORK`；p1 条目 0（零写入）；`lastError=NETWORK`；retry → 202 |
| A3 企划取消 | PASS | cancel → terminal **8ms**；上游释放 5ms；被取消步写入 0 条；retry → 202（有出路） |
| B1 越阶确认 | PASS | 未确认 p1 时确认 p2 → `409 STAGE_LOCKED` |
| B2 P1 编辑 + 意见重生成 | PASS | 编辑产生修订；按意见重生成后 13 条修订；空意见 → `422 NOTE_TOO_SHORT` |
| B2b 修订来源要区分「首次生成 / 按意见重生成」 | **FAIL** | 来源集合只有 `["ai_initial","manual"]`，没有任何 `ai_feedback`（DEF-3） |
| B3 P1 确认 → 解锁 P2 | PASS | p1=confirmed、确认快照 1 条、`nextStep=generate-p2` |
| B4 P2 生成幕/节拍 → 编辑 → 单条意见重生成 → 确认 | **FAIL** | 单条重生成后确认 p2 → `409 {"code":"STAGE_LOCKED","message":"请先确认p1阶段"}`，阶段状态 `{p1:review,p2:review}`（DEF-1）。重新确认 p1 后可确认 p2 ⇒ 数据未丢、但阶段门槛被打乱 |
| B5 P3 字数分配两步 + 手改保护 | **FAIL** | 用「改字数之前」的预览再 apply → 200，手改被静默覆盖（应 `422 TARGET_EDITED`，DEF-4） |
| B6 P3 偏差 ±25% 门槛 | PASS | confirm → 422「总目标 8640 字 / 全书目标 80000 字（-89.2%），超出 ±25%」；接受偏差 + 恢复合理字数后确认成功 |
| B7 逐章生成 | PASS | 27 章全部有正文，字数全部落在 `[min,max]` 内，只写目标章 |
| B8 审阅：通过 / 退回（必须意见）/ 单章重写 / 版本恢复 | PASS | 通过 #1；退回无意见 → 422；单章重写只改目标章；版本 2 条可恢复 |
| B9 P3 减章不静默丢正文 | PASS | count 27→25 → `422 CONTENT_WOULD_BE_LOST` |
| C1 短篇创建 + 企划 | PASS | 与长篇同一套阶段；`chapters` 行 0；plan 产节拍 |
| C2 短篇 P2→P3 用「节拍」词表 | **FAIL** | `nextStep.label = "检查章节字数并确认"`（短篇应为「节拍」，DEF-5） |
| C3 短篇 P4 逐节拍写作 + 审阅 | **FAIL** | `POST /api/chapters/<beatId>/review` → `404 {"code":"NOT_FOUND","message":"找不到这一章"}`（DEF-2） |
| D1 暂停（D4 语义） | PASS | 受理 **5ms**（`state=pausing, pausePending=true`）→ 当前章写完落库 2193ms → `state=paused`；该章 1170 字；无半截章节；`nextStep=resume-writing` |
| D2 暂停后继续写作 | PASS | `continue` → 202（续写 9 个单元）；已写 1→2 章；**此前已写内容逐字节不变** |
| D4 立即停止（D4 语义） | PASS | 停止 **6ms** 生效（`state=cancelled`）；当前章正文已丢弃；`continue` → 400；重新开始 → 202 |
| D3 进程被 SIGKILL 后重启 | PASS | job → `interrupted`；已写 10 章逐字节不变；retry → 202 且从断点续写 |
| E1 旧项目夹具（正文+版本+人物+幕） | PASS | 正文 54 字、版本 1 条、人物 1 个、幕 3 |
| E2 升级到流水线 | PASS | 九条校验全过；备份 `studio.db.bak-mig_*`；正文逐字节一致；版本 1；`p1=confirmed / p3=review`（P3 不被自动确认） |
| E3 迁移可重入 + 回退 + 再迁移 | PASS | 二次迁移 `alreadyMigrated`；回退后正文/版本不变；再迁移 done |
| E4 迁移失败 | PASS | forceFail → `500 MIGRATION_CHECK_FAILED`；`migration.state=failed` 带 error；旧正文仍可读；重试 → done |
| F1 无默认模型 | PASS | precheck `NO_DEFAULT_MODEL`；创建 → `422 NO_DEFAULT_MODEL`；作品数不变 |
| F2 无 API Key | PASS | precheck `NO_API_KEY`；创建 → 422；作品数不变 |
| F3 绝不静默 mock | PASS | 真实供应商失败时零正文、零 mock 特征文本；显式 mock 才生成 6 条设定 |
| G1 创建幂等 | PASS | 同 `Idempotency-Key`：201 → 200，同一个 project，作品数 +1 |
| G2 并发保护 | PASS | 同作品第二次启动 → `409 CONCURRENT_JOB` |

## 4. 独立 UI 套件：13 段真实点击结果

| 段 | 结论 | 证据摘要 |
| --- | --- | --- |
| U0 开屏 onboarding | PASS | 选供应商 → 填 Key → 选模型 → 进入作品库 |
| U1 无默认模型 | PASS | 预检拦「还不能让 AI 企划：还没有选择默认模型…」；点「创建并让 AI 企划」不落空壳（作品数 0 未变） |
| U2 慢供应商（企划挂起） | PASS | 进页 **405ms**；`plan-progress` 秒数 0→2s 递增（文案「正在生成设定… · 0/3 步 · 0 秒」+ 取消）；取消 **77ms**；`plan-delete` 可删且作品 1→0 |
| U3 供应商失联 | PASS | `plan-error data-code=NETWORK`，文案是人话（不含底层报文）；`plan-retry` 重试仍失败但有出路；可删 |
| U4 长篇 P1 | PASS | AI 生成设定 → 编辑人物生效 → 条目级意见重生成 → 修订历史 2 条 → 确认成功（blockers=0） |
| U5 长篇 P2 | **FAIL** | 单幕「给 AI 提意见重生成」后 `P1=data-status=review`（应为 confirmed），`P2=review`，确认「故事大纲」时服务端 409（DEF-1） |
| U6 长篇 P3 | PASS | 100 行→改 5 行；预设 fast 后目标字数 2000×5；分配预览 → 手改 → 应用被 **422 TARGET_EDITED** 拦住（单页路径守卫生效）；合计「共 5 章 · 计划 9,507 字 · 目标 30.0 万字 · 偏差 -96.8%⚠」；确认成功 |
| U7 长篇 P4（暂停/继续/停止/刷新） | PASS | 暂停受理 **59ms**（`data-phase=pause-requested`、`data-pause-pending=true`）→ 当前章写完 2422ms 后落定 `paused`，已写 1 章、无半截章 → 继续后 `running` 且无 4xx → 刷新后 5 行、已写不减 → 立即停止 112ms |
| U8 单章重写 + 审阅队列 | PASS | 重写只改目标章 1 篇（其他 0 篇）；`?review=1` 队列「2 章待审」；通过 → approved=1；退回 → changes_requested=1（无意见被拦） |
| U9 短篇 | **FAIL** | 全程 `chapter-row` 计数 0（正确）；但「开始逐节拍审阅」后审阅队列**没有可审内容**：`review-queue-count` 显示「8 章待审」却 `approve` 按钮不存在（DEF-2） |
| U10 旧项目迁移 | PASS | legacy 横幅 → 升级 → 刷新后 `data-state=done` 且「正文、设定和版本都保留着」→ 回退 → 正文仍可读（DEF-7 见下） |
| U11 断网 | **FAIL** | 断网有 `.pipeline-offline` 提示、不白屏；但恢复网络 15s 后离线横幅**仍在**，只有切标签页/刷新才恢复（DEF-8） |
| U12 Console/Network 汇总 | PASS | 页面级未捕获异常 **0 条**（3 条 `ERR_INTERNET_DISCONNECTED` 是我自己 `setOffline` 造成）；HTTP 361 条，`>=400` 4 条均有据 |

`>=400` 明细（含时刻）：`404 GET /pipeline` ×2（删作品瞬间在飞的轮询）、`409 POST /stages/p2/confirm`（DEF-1）、`422 POST /stages/p3/units/allocate/apply`（DEF-4 的单页路径守卫）。

## 5. 缺陷清单

### DEF-1 [blocker] P2 单条「给 AI 提意见重生成」会把已确认的 P1 打回 review，P2 从此确认不了

- 文件行号：`software/src/server/pipeline/steps.ts:390`（`const stageKey = (found.row.stage_key as StageKey) || 'p1';`——`outline_acts` 行没有 `stage_key` 列，一律回退成 `p1`）+ `software/src/server/pipeline/steps.ts:420-431`（`recordItemRevision` 只要写入修订就把该阶段状态改成 `review` 并 `markDownstreamStale`）。
- 症状（两路独立复现）：API B4 单条重生成后 `POST /stages/p2/confirm` → `409 {"code":"STAGE_LOCKED","message":"请先确认p1阶段"}`，阶段状态 `{"p1":"review","p2":"review"}`；UI U5 同样在真实点击后观察到 `stage-p1[data-status=review]`。
- 影响：P2 阶段的「编辑→提意见→重生成→确认」这条主流程在单条重生成这一步就断掉；已确认阶段的确认快照被推翻（违反「已确认阶段只增不改」的 INV），界面还把错误归因成「请先确认 p1」，用户不知道该回去点 P1。
- 复现：`node software/scripts/qa-e2e-api.mjs`（B4）或 UI 脚本 U5：创建长篇 → 生成并确认 P1 → 生成 P2 → 对第一幕 `item-feedback` 提交意见 → 回到 `stage-p2` 点确认 → 409。
- 建议修法：`stageKey` 由表格归属推导（`outline_acts → p2`），且 `ai_regen` 只把**同一阶段**标回 `review`；已确认阶段的条目重生成应走「新增修订 + 标下游 stale」而不推翻阶段确认状态。

### DEF-2 [blocker] 短篇逐节拍审阅走不通：D5 唯一写入口只查 `chapters` 表，节拍 id 直接 404

- 文件行号：`software/src/server/pipeline/routes.ts:352`（`oneRow('SELECT * FROM chapters WHERE id = ?')`）+ `software/src/client/pages/StudioPage.tsx:1015`（审阅队列按 chapters 渲染，短篇队列为空）。
- 症状：短篇 4 个节拍全部 `in_review`，`POST /api/chapters/<beatId>/review` → `404 {"code":"NOT_FOUND","message":"找不到这一章"}`（API C3）；UI 点「开始逐节拍审阅」进入写作台后队列显示「8 章待审」但没有「通过」按钮（U9）。
- 影响：短篇流水线在最后一步（人工 REVIEW 门槛）无法完成——按 SPEC/D4「每章必须人工终态」，短篇作品永远到不了 `done`。这是长短篇统一目标（成功判据之一）的直接破口。
- 复现：API 脚本 C3 / UI 脚本 U9。

### DEF-3 [medium] 修订历史的来源永远是 `ai_initial`：按意见重生成与首次生成分不开

- 文件行号：`software/src/server/pipeline/steps.ts:137/149/177/191/209/232/257/280/309/328`（`recordItemRevision(..., 'ai_initial', ...)` 在意见重生成路径上同样传 `ai_initial`）。
- 症状：B2 按意见重生成后修订 13 条，来源集合只有 `["ai_initial","manual"]`，没有 `ai_feedback`；修订抽屉里看不出哪一版是「按你的意见改的」。
- 复现：`node software/scripts/qa-e2e-api.mjs`（B2b）。

### DEF-4 [medium] 「按目标分配」的手改保护依赖客户端传来的 `manuallyEdited`

- 文件行号：`software/src/server/pipeline/actions.ts:644`（`const blocked = rows.filter((row) => !includeEdited && row.manuallyEdited);`——不回查 `chapters.target_manual`）。
- 症状：用「改字数之前」的预览再 apply → `200`，手改被静默覆盖（B5）；单页正常顺序（预览→手改→应用）在 UI 上被 422 拦住（U6），所以只在「旧预览/多标签页/直接调接口」时命中。面板文案写的是「你手改过的默认不动」，与行为不一致。
- 复现：B5（先 `POST /units/allocate` 取 preview → `PATCH` 某章 targetWords → 用旧 preview `POST /units/allocate/apply`）。

### DEF-5 [low] 短篇「下一步」文案仍写「检查章节字数并确认」

- 文件行号：`software/src/server/pipeline/snapshot.ts:218`（`label: '检查章节字数并确认'` 硬编码「章节」）。
- 症状：短篇 `nextStep.label` = 「检查章节字数并确认」（C2）；同族还有 `software/src/client/pages/StudioPage.tsx:1015` 硬编码「{n} 章待审」（短篇 U9 见到「8 章待审」）。
- 影响：违反 SPEC 的短篇词表（应为「节拍」），用户会以为自己建的短篇被当成长篇。

### DEF-6 [closed] 暂停后 `/writing/continue` 返回 400 —— t12 已修复，本轮通过

- 上一轮证据：`400 POST /api/projects/<id>/writing/continue`（暂停被记成 `user_cancel`）。
- 本轮复核：D1（`state=pausing/pausePending` → 落定 `paused`，本章写完）、D2（continue 202，续写且已写内容逐字节不变）、D4（stop → cancelled、continue 400、可重新开始）**全部 PASS**；UI U7 同期通过。

### DEF-7 [medium] 升级成功后横幅不变：仍提示「这是升级前的旧作品」，回退入口不出现，必须刷新

- 文件行号：`software/src/client/pages/PipelinePage.tsx:104-118`（migration 只在挂载时取一次）+ `software/src/client/components/pipeline/PipelineBanner.tsx:37`（`migration?.state === "legacy"` 优先）。
- 症状：点「升级到流水线」→ 服务端 `migration.state=done`（用 `/api/projects/:id/migration` 核对），页面 `migration-banner[data-state=legacy]` 不变、也没有「回退到升级前」按钮；刷新后才变 done（U10，截图 `qa-14a-after-upgrade-noreload.png`）。
- 影响：用户会重复点「升级」或以为失败。

### DEF-8 [high] 断网恢复后界面永久停在「与后台失去联系」

- 文件行号：`software/src/client/hooks/usePipeline.ts:146`（`if (!interval || offline) return;`——连续失败 3 次后 `offline=true`，此后轮询直接 return，没有任何重试/退避）。
- 症状：写作中断网 → 3 次失败 → 离线横幅；恢复网络等 15s 横幅仍在，只有 `visibilitychange` 或刷新才恢复（U11）。
- 影响：后台重启、切网、短时断流之后，界面会永久停在离线态，长任务的实际进度不再更新。

### DEF-9 [low] 「立即停止」之后仍显示「继续写作」按钮，点下去必然报错

- 文件行号：`software/src/client/components/pipeline/P4WritingView.tsx:131`（`phase === "paused" || phase === "stopped"` 都渲染 `write-continue`）。
- 症状：U7 停止后统计到 1 个 `write-continue`；服务端停止后 `continue` 必 400（D4 已验证 400）。
- 影响：给用户一个点了就错的入口；应只在 `paused`/`interrupted` 显示。

### 观察项（不计缺陷）

- OBS-1 `404 GET /api/projects/<id>/pipeline`：作品被删除的瞬间仍在飞的轮询（我的套件 2 次、实现者 `test:ui` 2 次），属可接受的竞态，建议前端在删除后立刻 abort。
- OBS-2 迁移后打开写作台必须带 `?chapter=<真实章 id>`，否则会被重定向回流水线——行为合理，但文档需要写清。

## 6. 验收标准逐条判定

| # | 验收标准 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 真实点击「新建作品 + AI 企划」能观察到加载→成功/失败/取消，不得无响应；失败与取消均有出路 | **PASS** | U1/U2/U3 通过：进页 405ms、进度秒数递增、取消 77ms 且可删、失败给结构化错误卡 + 重试；API A1/A2/A3 通过（创建 7ms、零写入、retry 可入） |
| 2 | 长篇完整走通五阶段；每阶段可编辑/重生成/确认 | **FAIL** | P1/P3/P4 通过，**P2 的「单条意见重生成 → 确认」被 DEF-1 阻断**（409 STAGE_LOCKED）；重生成本身可用，但会把已确认的 P1 打回 review |
| 3 | 短篇完整走通无章节版本，场景/节拍结构可用，且没有空章节或错误导航 | **FAIL** | 无章节行（`chapter-row=0`）、节拍计划与逐节拍写作可用；但 **DEF-2** 让逐节拍审阅 404/队列为空，短篇永远走不到终态；另 DEF-5 词表混用 |
| 4 | 逐章生成中暂停、继续、重写单章可用；刷新或重启后进度与内容保持；失败可重试且不丢已确认内容 | **PASS** | D1/D2/D4/D3 + U7/U8：暂停 5ms/59ms 受理、本章写完再停、继续续写且已写内容逐字节不变、停止丢弃当前章 ≤2s、SIGKILL 后 `interrupted` + retry 续跑、刷新后行数与已写不变、单章重写只改目标章 |
| 5 | 旧项目迁移后正文、版本、设定可读；迁移失败有提示且旧数据仍可打开 | **PASS** | E1–E4 + U10：九条校验全过、正文逐字节一致、版本/人物/幕保留、P3 不自动确认、可重入、回退后正文可读、forceFail 有明确错误且可重试 |
| 6 | 无 API Key/无默认模型时明确报错，不能静默 mock 生成正文 | **PASS** | F1/F2/F3 + U1：precheck 与创建都 422 且不落空壳；真实供应商失败时零正文、无 mock 特征文本 |
| 7 | 所有发现写入 TEST.md，含通过/失败项、证据（截图/请求/日志）与复现步骤 | **PASS** | 本文件（用例表 + 缺陷 file:line + 复现命令 + 证据索引） |

## 7. 证据索引

- `team/inkquay-ai-first/evidence/qa-api-results.json` — API 30 步逐条结果 + 6 条缺陷（含 file 字段）
- `team/inkquay-ai-first/evidence/qa-api-server.log` — API 套件期间的服务端日志
- `team/inkquay-ai-first/evidence/qa-ui-results.json` — UI 13 段逐条结果 + 缺陷 + `consoleErrors` / `httpErrors` / `httpErrorDetail`
- `team/inkquay-ai-first/evidence/qa-ui-server.log` — UI 套件期间的服务端日志
- `team/inkquay-ai-first/evidence/ui-shots/qa-*.png` — 21 张真点击截图（含 `qa-05-p2-blocked.png`=DEF-1、`qa-fail-U9.png`/`qa-12-short-review.png`=DEF-2、`qa-14a-after-upgrade-noreload.png`=DEF-7、`qa-16-offline.png`+`qa-fail-U11.png`=DEF-8）
- 脚本：`software/scripts/qa-e2e-api.mjs`、`software/scripts/qa-e2e-ui.mjs`

## 8. 未覆盖与限制（如实登记）

1. **真实供应商未做长跑**：全套用假 OpenAI 兼容供应商注入延迟/故障（可控、可重复）。真实供应商只做了单项取证（t1 已用主人 Key 重放，200 / 190ms / 3108 字可解析），本次未再用真 Key 造 27 章长文。
2. **单进程假设**：并发保护只在单进程内验证（`GLOBAL_JOB_CONCURRENCY=3`、`409 CONCURRENT_JOB`），多实例部署未测（ADR 已声明 V1 单进程）。
3. **迁移的「批量 sweep」**：只验证单作品升级/回退，未造成百上千作品压测；迁移夹具为脚本内自造（真实库唯一作品是孤儿空壳，无正样本）。
4. **平台**：只在 macOS arm64 + 本机 Chromium 验证，未跑 Windows/Linux。
5. **环境失败登记**：本任务 attempt 1 因 DSH 侧 thinking API 错误中断，**未形成任何产品结论**（不记为产品失败）；attempt 2 全程未再出现该错误。
6. **工作树**：测试只新增/改写 `software/scripts/qa-*.mjs` 与 `team/inkquay-ai-first/*`；`software/screenshots/` 下由实现者 `test:ui` 生成的 `95-98-*.png` 保持原样，我的 `qa-*.png` 已移入 `evidence/ui-shots/`，`99-new-project-empty.png` 已 `git checkout` 还原。未 commit / 未 push。

## 9. 第二轮复验（t14，2026-10-29）

- 任务：t14 · verification-round-2 · `attempt_id=d95462bc-5413-47d5-a1d9-20ccc341b5b0`
- 立场：不复用 t13 的「30/30、13/13」结论，全部命令与用例由我自己重跑；另写了 4 个一次性探针（`/tmp/probe-t14*.mjs`，用后即删）专门验证 t13 改动的语义边界。
- 代码状态：HEAD=`ae75612`，工作树含未提交改动；本轮**未改任何业务代码**（`git diff --stat software/src` 与 t13 交付一致），只重跑脚本 + 追加本文件；未 commit / 未 push。

### 9.1 验证命令（fresh 进程，逐条实跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir software typecheck` | `tsc --noEmit` 无输出，**exit 0** |
| `pnpm --dir software test` | **33 组全 PASS**，末行 `All API tests passed.`，**exit 0**（含 `PASS pause finishes the current chapter and can continue, stop aborts it and cannot continue`、`PASS allocation judges hand-edited targets on the server and ignores client flags`、`PASS short projects run the same pipeline with beat plans instead of chapters`、`PASS legacy migration is re-entrant, rollback-safe and never loses text/versions/settings`） |
| `pnpm --dir software test:ui` | **32 段 PASS**，`All UI tests passed.`，**exit 0**；运行期 2 条 `404 GET /api/projects/<id>/pipeline`（删除作品瞬间在飞的轮询，见 OBS-1） |
| `node software/scripts/qa-e2e-api.mjs` | **30/30 通过、0 失败、0 缺陷**，exit 0 |
| `node software/scripts/qa-e2e-ui.mjs` | **13/13 通过、0 失败、0 缺陷**，exit 0 |

### 9.2 第一轮缺陷逐条复核（我自己的断言，不看实现者用例）

| 缺陷 | 第一轮症状 | 本轮实测 | 判定 |
| --- | --- | --- | --- |
| DEF-1 blocker | P2 单幕意见重生成后 p1 从 confirmed 变 review，`POST /stages/p2/confirm` → 409 | 探针 A：确认 P1 与 P2 后对一幕做 `stages/p2/feedback{scope:item}` → `p1=confirmed`、`p2=review`、新增修订 `source=ai_feedback`；`POST /stages/p2/confirm` → **200**。UI U5 通过 | **已修** |
| DEF-2 blocker | 短篇逐节拍审阅 `POST /api/chapters/<beatId>/review` → 404 | API C3 通过（节拍 approve + request_changes 各一次真调用）；UI U9 通过（审阅队列有数、按钮可用、`chapter-row=0` 全程） | **已修** |
| DEF-3 medium | 修订来源恒 `ai_initial` | 探针 A 新修订 `source=ai_feedback`；API B2b 通过 | **已修** |
| DEF-4 medium | 分配 apply 信任客户端 `manuallyEdited`，旧预览会静默覆盖手改 | API B5 通过：伪造 `manuallyEdited=false` → **422 TARGET_EDITED**；`includeEdited=true` → 200。UI U6 同样被 422 拦住 | **已修** |
| DEF-5 low | 短篇「下一步」写「检查章节字数并确认」 | API C2 通过：短篇 nextStep 文案含「节拍」不含「章节」 | **已修** |
| DEF-7 medium | 升级成功后横幅仍显示 legacy、不回退入口不出现，必须刷新 | UI U10 通过：升级后不刷新即变 `data-state=done` 并出现回退按钮 | **已修** |
| DEF-8 high | 断网恢复后界面永久停在「与后台失去联系」 | UI U11 通过：断网有提示不白屏；恢复后自动清 offline（新增 5s 低频探测 + `online` 事件重试） | **已修** |
| DEF-9 low | 「立即停止」后仍给「继续写作」入口，点必 400 | UI U7 通过：停止后 `write-continue` 计数 = 0，改为「重新开始写作」 | **已修** |
| DEF-6（t12 关） | 暂停后 `/writing/continue` → 400 | API D1/D2/D4 通过：暂停受理后 `state=pausing`+`pausePending`、落定 `paused`、`continue` → 202 且续写、`stop` → `cancelled` 且 `continue` 400 | **保持已修** |

### 9.3 额外语义探针（本轮新增，专验 t13 改动的边界）

1. **R2（已确认阶段被 AI 重生成后是否回 review）**：确认 P1、P2 后对一幕做意见重生成 → `p2=review`、`p1=confirmed`（未被误伤）、`confirmed_revision_id` 保留旧快照、`nextStep=review-p2`。符合 SPEC.md:363 / ARCHITECTURE.md:344。再对已确认 P1 的一个人物做意见重生成 → `p1=review`、`nextStep=review-p1`，再次确认 P2 时按顺序 409（正确的前置拦截）。
   注：`software/src/server/pipeline/runner.ts:212` 的 `finishDone` 无条件把该阶段置 `review`，所以 `steps.ts:432-443` 里「已确认阶段不回退」的分支实际不会生效——语义正确，但该分支的注释（自称 INV-1）与实现效果不符，建议下一轮顺手收敛（不改行为）。
2. **INV-1（上游重生成不得覆盖已确认下游）**：确认 P1/P2/P3 后对 P1 做 `regenerate{scope:all}` → p2/p3 的条目与单元**逐字段未变**、`staleReason=p1:regenerated`、p1 回 review。**不变量成立**。
3. **stale 可见性（新缺陷来源）**：见 DEF-10/11/12。

### 9.4 本轮新增缺陷

#### DEF-10 [medium] 上游变更后「已确认的下游阶段」看不到任何 stale 提示，SPEC R1 的三个动作不可达

- 文件行号：`software/src/client/components/pipeline/PipelineBanner.tsx:114`（`if (stageStatus === 'review' && staleReason)`）；`software/src/server/pipeline/store.ts:179-185`（`markDownstreamStale` 只写 `stale=1` + `last_error.staleReason`，不改 status）。
- 症状（真浏览器取证）：确认 P1/P2/P3 后重生成 P1 → 服务端 `p2{status:confirmed, staleReason:"p1:regenerated"}`、`p3{status:confirmed, staleReason:"p1:regenerated"}`；打开 `?stage=p2` 与 `?stage=p3` 两个视图，`[data-testid="pipeline-banner"]` 数量 = **0**、页面文本无「上游已变更」、无「复核并保留/按上游重排/忽略」三个按钮。对照：同样场景下若 P2 尚未确认（`status=review`），横幅正常出现且三动作齐全。
- 依据：SPEC.md:356-361（**R1**「触发后：下游 `stale=true`，界面顶部横幅『上游已变更，建议复核』+ 三个动作：复核并保留 / 按上游重排 / 忽略」）；UX-SPEC.md §5 同样要求三选项横幅。
- 影响：最典型的真实序列就是「先把 P1–P3 一路确认、写到一半回去改设定」——此时三个下游全是 `confirmed`，用户界面上没有任何「大纲已过期」的直接提示，只能靠阶段轨道上 P1 变成「待确认」间接推断；三动作不可达，也无法「按上游重排」。不丢数据（INV-1 成立），但 SPEC 的红线机制在主要场景下失效。
- 建议修法：横幅条件改为 `staleReason && (stageStatus === 'review' || stageStatus === 'confirmed')`，文案在 confirmed 时用「上游已变更，建议复核后再确认」；「复核并保留」= 清 stale 保持 confirmed；「按上游重排」= 对该阶段 startStageJob(all)。
- 复现：`node /tmp/probe-stale-ui2.mjs`（探针已删，等效步骤：新建长篇 → 确认 P1 → 生成 P2 → 确认 P2 → 生成并确认 P3 → `POST /api/projects/:id/stages/p1/regenerate {scope:"all"}` → 打开 `/project/:id/pipeline?stage=p2`）。
- 证据：`evidence/ui-shots/qa-t14-stale-review.png`（review 态有横幅）、`evidence/ui-shots/qa-t14-stale-confirmed.png`、`evidence/ui-shots/qa-t14-stale-confirmed-p3.png`（confirmed 态无横幅）；`evidence/qa-t14-probes.json`。

#### DEF-11 [low] SPEC 约定的锚点 `stage-stale-banner` 在实现里不存在

- 依据：SPEC.md:257（P2 验收锚点含 `stage-stale-banner`）、SPEC.md:844（S8 断言「P2 顶部 `stage-stale-banner` 出现」）。
- 实测：review+stale 状态下页面只有 `[data-testid="pipeline-banner"][data-state="stale"]`，`[data-testid="stage-stale-banner"]` 恒为 0（两个阶段视图都查过）。
- 影响：按 SPEC/S8 字面写脚本的 QA 会直接判红；属于锚点契约与实现不一致，二选一收敛（改 SPEC 或加锚点）即可。

#### DEF-12 [low] 上游变更横幅把机器串直接给用户看

- 文件行号：`software/src/server/pipeline/steps.ts:439`（`markDownstreamStale(..., `${stageKey}:regenerated`)`）、`software/src/server/pipeline/actions.ts:437`（`${stageKey}:edited`）；`software/src/client/components/pipeline/PipelineBanner.tsx:119`（`<p>{staleReason}。本阶段内容没有自动改动…</p>`）。
- 症状（真浏览器取证）：横幅正文为「上游已变更 **p1:regenerated**。本阶段内容没有自动改动，你可以选择怎么处理。」用户看到的是内部枚举而不是「设定已重新生成」。
- 建议：前端把 `p1:edited` / `p1:regenerated` 映射成人话（或后端直接下发可读文案），未知值再回退原文。

### 9.5 验收标准逐条判定（第二轮）

| # | 验收标准 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 真实点击「新建作品 + AI 企划」能观察到加载→成功/失败/取消，不得无响应；失败与取消均有出路 | **PASS** | UI U1（无模型预检拦截、错误卡含「不会留下空壳」、项目数不变）、U2（进页 <5s、`plan-progress[data-elapsed]` 递增、取消后可删除）、U3（失联供应商给结构化 `plan-error` + `plan-retry`）；API A1/A2/A3（创建毫秒级、失败零写入、取消 ≤2s 且上游 ≤5s 释放、被取消步零写入、retry 可入） |
| 2 | 长篇完整走通五阶段；每阶段可编辑/重生成/确认 | **PASS** | UI U4（P1 生成→编辑人物→意见重生成→确认）、U5（P2 生成幕/节拍→单幕意见重生成→确认）、U6（P3 章数/字数/分配/偏差接受/确认）、U7/U8（P4 逐章生成与审阅）；API B1–B9（越阶 409、确认快照、分配两步、字数偏差、逐章字数落区间、通过/退回/重写/版本恢复） |
| 3 | 短篇完整走通无章节版本，场景/节拍结构可用，且没有空章节或错误导航 | **PASS** | UI U9（全程 `chapter-row=0`、P3 用 `beat-plan-row`、P4 `beat-row`、审阅队列可用）；API C1–C3（`chapters` 0 行、节拍单元、文案含「节拍」、逐节拍 approve/request_changes） |
| 4 | 逐章生成中暂停、继续、重写单章可用；刷新或重启后进度与内容保持；失败可重试且不丢已确认内容 | **PASS** | UI U7（暂停→`data-pause-pending`→落定 paused→继续→刷新后行数与已写不减→立即停止）、U8（单章重写只改目标章、审阅队列）；API D1（受理 ≤2s、本章写完再停、无半截章节）、D2（continue 202 且已写内容逐字节不变）、D4（stop ≤2s、丢弃当前章、continue 400、可重新开始）、D3（SIGKILL → `interrupted` → retry 续跑逐字节不变） |
| 5 | 旧项目迁移后正文、版本、设定可读；迁移失败有提示且旧数据仍可打开 | **PASS** | UI U10（legacy 横幅→升级→正文可读→回退后仍可读）；API E1–E4（正文/版本/人物/幕保留、九条校验对备份副本、可重入 `alreadyMigrated`、sql 回退、forceFail 后 `MIGRATION_CHECK_FAILED` 且旧数据可读可重试） |
| 6 | 无 API Key/无默认模型时明确报错，不能静默 mock 生成正文 | **PASS** | UI U1 + API F1/F2（precheck 与创建均 422、项目数不变、不落空壳）、F3（供应商失败时零正文、无 mock 特征文本「印刷厂的老机器停在原地」；显式 mock 才生成） |
| 7 | 所有发现写入 TEST.md，含通过/失败项、证据（截图/请求/日志）与复现步骤 | **PASS** | 本文件 §9（命令实跑、缺陷 file:line + 复现 + 证据路径、验收逐条判定） |

### 9.6 证据索引（第二轮）

- `team/inkquay-ai-first/evidence/qa-api-results.json` — 本轮 API 30 步逐条（30 passed / 0 failed / 0 defect）
- `team/inkquay-ai-first/evidence/qa-ui-results.json` — 本轮 UI 13 段逐条 + `consoleErrors` / `httpErrors` / `httpErrorDetail`（`>=400` 逐条带 at/status/method/path/page）
- `team/inkquay-ai-first/evidence/qa-api-server.log` / `qa-ui-server.log` — 两套件期间的服务端日志
- `team/inkquay-ai-first/evidence/ui-shots/*.png` — 本轮真点击截图（含 DEF-10 的三张对比图）
- `team/inkquay-ai-first/evidence/qa-t14-probes.json` — 4 个一次性探针（R2 语义 / INV-1 / stale 可见性对比）的原始输出
- 脚本：`software/scripts/qa-e2e-api.mjs`、`software/scripts/qa-e2e-ui.mjs`（第一轮新增，本轮保持并可重复运行）

### 9.7 本轮未覆盖与限制

1. 真实供应商仍未长跑：全部用假 OpenAI 兼容供应商注入延迟/故障；真 Key 只在 t1 做过单项取证。
2. 只验证单进程并发（V1 声明单进程），多实例未测；迁移只做单作品升级/回退，未做批量 sweep 压测。
3. 只在 macOS arm64 + 本机 Chromium 验证。
4. `test:ui` 与两套 QA 脚本运行期各出现 2 条 `404 GET /pipeline`（删除作品的竞态，OBS-1），已归入观察项而非缺陷。
5. 工作树：`software/screenshots/` 下的 `qa-*.png`、`95-98-*.png` 均为脚本产物（未跟踪、未提交）；未 `git checkout` 任何实现者文件，未 commit / 未 push。

---

## 10. 第三轮（t16）：复核 t15 + 新发现

### 10.1 验证命令与两套独立套件（全部我自己起 fresh 进程）

| 命令 | 结果 | 原始输出 |
| --- | --- | --- |
| `pnpm --dir software typecheck` | `tsc --noEmit` 无输出，**EXIT=0** | `evidence/qa-t16-commands.txt` |
| `pnpm --dir software test` | **34 组全 PASS**，末行 `All API tests passed.`，**EXIT=0**（含 t15 新增 `PASS an upstream edit marks the confirmed stage stale, and "keep" clears it without rolling back`） | 同上 |
| `pnpm --dir software test:ui` | **32 段全 PASS**，`All UI tests passed.`，**EXIT=0** | 同上 |
| `node software/scripts/qa-e2e-api.mjs`（我写的，30 步） | **30 通过 / 0 失败 / 0 缺陷**，`API_EXIT=0` | `evidence/qa-api-results.json`、`evidence/qa-api-server.log` |
| `node software/scripts/qa-e2e-ui.mjs`（我写的，14 段真点击） | **14 通过 / 0 失败 / 0 缺陷**，`UI_EXIT=0`（含 t15 加的 U13） | `evidence/qa-ui-results.json`、`evidence/qa-ui-server.log` |

UI 套件运行期 `>=400` 只有 3 条，逐条归因（`evidence/qa-ui-results.json` 的 `httpErrorDetail`）：

| 请求 | 归因 | 判定 |
| --- | --- | --- |
| `404 GET /api/projects/p_mvszew1z_gm7juc/pipeline` | 作品刚被删除、仍在飞的一次轮询 | 观察项 OBS-1，非缺陷 |
| `404 GET /api/projects/p_mvszez6n_zg7ukg/pipeline` | 同上 | 观察项 OBS-1 |
| `422 POST /api/projects/p_mvszf3li_iz2pt1/stages/p3/units/allocate/apply` | 脚本刻意复现 DEF-4（旧预览覆盖手改）的用例 | 预期失败，非缺陷 |

console 只有我自己 `setOffline(true)` 造成的 3 条 `Failed to load resource: net::ERR_INTERNET_DISCONNECTED`；`pageerror` 全程 0。

### 10.2 旧缺陷复核（我的断言，不看实现者用例）

| 缺陷 | 本轮实测 | 判定 |
| --- | --- | --- |
| DEF-10 medium（已确认下游看不到 stale） | 真浏览器：确认 P1/P2/P3 后编辑 P1 → `?stage=p2` 出现 `[data-testid=pipeline-banner][data-state=stale]` 且 `[data-testid=stage-stale-banner]` 存在；文案「上游已变更，建议复核后再确认…已经被确认的内容仍然按确认时的那一版保留。」；三键 visible+enabled；p2 仍 `confirmed`（INV-1 不回滚） | **已修** |
| DEF-11 low（锚点 `stage-stale-banner` 不存在） | 同上，锚点 count=1 | **已修** |
| DEF-12 low（横幅露 `p1:edited`） | 横幅文本含「设定已被编辑」、**不含** `p1:edited`；`staleReasonLabel` 覆盖 edited/regenerated，未知值回退原文 | **已修** |
| t15 附带的服务端孪生 bug（keep 后横幅不退） | 点「忽略」→ 横幅仍在、服务端 `staleReason` 仍 `p1:edited`；点「复核并保留」→ 横幅消失、`staleReason=null`、`status=confirmed` ⇒ `snapshot.ts:56` 判 `stale===1` 与 `actions.ts:201` 同清 `last_error` 两处都生效 | **已修** |

### 10.3 本轮探针（两个一次性脚本，原始输出已归档）

探针环境：临时 `PW_DATA_DIR` + 端口 8839/8841 + mock 供应商，Playwright 真点击。归档：`evidence/qa-t16-probes.json`、`evidence/qa-t16-probe-server.log`、`evidence/qa-t16b-probe-server.log`；截图 `evidence/ui-shots/qa-t16b-*.png`。

第一版探针 **25/31**，第二代聚焦探针 **13/15**。失败的断言只有以下两条真实缺陷（其余是我自己的场景构造错误，已更正，见 10.3.3）：

1. **DEF-13**：`C.stale-should-return` FAIL —— 序列「编辑 P1 → 复核并保留（P2 清 stale 且保持 confirmed）→ 再编辑 P1」后，`p2.staleReason=null`、`?stage=p2` 横幅 count=**0**。
2. **DEF-14**：`A.regenerate-works-in-banner-state` FAIL —— 横幅出现的那个状态里点「按上游重排」→ `409 POST /api/projects/<id>/stages/p2/stale/resolve`，toast 只显示「请先完成上一步」，25s 内没有 `regen-stage/p2` 的 job。

同时确认存在的出路（写进缺陷影响面，避免夸大）：**先回上游重新确认**，再回来点「按上游重排」→ `202`、job `regen-stage/p2`、完成后 `p2=review`（R2 正确）。

#### 10.3.1 DEF-13 [medium] 上游改动不总是标下游 stale：「复核并保留」之后再改上游，已确认下游永久失去提示

- 文件行号：`software/src/server/pipeline/actions.ts:432-440`
  ```ts
  function afterContentTouched(projectId: string, stageKey: StageKey) {
    const stage = getStage(projectId, stageKey);
    if (!stage) return;
    if (stage.status === 'confirmed') {
      updateStage(projectId, stageKey, { status: 'review' });
      markDownstreamStale(projectId, stageKey, `${stageKey}:edited`);
    }
    touchProject(projectId);
  }
  ```
  `markDownstreamStale` 被包在 `if (stage.status === 'confirmed')` 里；而 `confirmStage`（`actions.ts:144-181`）只清本阶段 `stale/last_error`、从不标记下游 ⇒ 一旦本阶段已经处于 `review`，后续任何编辑都不会再通知下游。
- 症状（真浏览器 + 服务端双取证）：
  1. P1/P2/P3 全 confirmed → 编辑 P1 → `p1=review`、`p2{confirmed, staleReason:'p1:edited'}`；
  2. 在 P2 点「复核并保留」→ `p2{confirmed, staleReason:null}`（这是 DEF-10 修复后的正常能力）；
  3. 再编辑一次 P1（此时 `p1` 已是 `review`）→ `p2.staleReason=null`、`p2` 横幅 count=0 ⇒ 用户改的是同一份设定，P2 却认为「上游没变」。
- 依据：SPEC.md:356-361（R1：上游结构性变更 → 下游 `stale=true` + 横幅 + 三动作）；SPEC.md:363（R2 只规定「本阶段回 review」，没有说「下游不再通知」）。
- 影响：这是一条**很容易走到**的真实路径（复核并保留 → 继续改设定 → 再复核）。之后的编辑对已确认下游完全静默：界面不提示、三动作不出现，用户会在过期的场景/大纲上继续写正文。数据不丢（正文还在），但守的是「别在过期设定上继续写」这条红线。
- 建议修法（最小改动）：
  ```ts
  function afterContentTouched(projectId: string, stageKey: StageKey) {
    const stage = getStage(projectId, stageKey);
    if (!stage) return;
    if (stage.status === 'confirmed') updateStage(projectId, stageKey, { status: 'review' });
    if (stage.status === 'confirmed' || stage.status === 'review') {
      markDownstreamStale(projectId, stageKey, `${stageKey}:edited`);
    }
    touchProject(projectId);
  }
  ```
  即「回不回 review」看本阶段状态，「标不标下游」只看内容是否变了。
- 复现：新建 novel → 确认 P1 → 生成并确认 P2 → 编辑一个 P1 人物 → `?stage=p2` 点「复核并保留」→ 再 `PATCH /api/projects/:id/items/:characterId` → `GET /api/projects/:id/pipeline` 看 `stages.p2.staleReason`（`null` 即复现）。

#### 10.3.2 DEF-14 [medium] 横幅上的「按上游重排」在横幅出现的那一刻必定 409

- 文件行号：`software/src/server/pipeline/actions.ts:196-199`（`resolveStale(action='regenerate')` 直接 `startStageJob(...{scope:'all', kind:'regen-stage'})`）+ `actions.ts:220-227`：
  ```ts
  if (stageKey !== 'p1') {
    const upstreamStage = getStage(projectId, STAGE_KEYS[STAGE_KEYS.indexOf(stageKey) - 1]);
    if (!upstreamStage || (upstreamStage.status !== 'confirmed' && upstreamStage.status !== 'skipped')) {
      if (stageKey !== 'p4') fail('STAGE_LOCKED', '请先确认上一阶段');
    }
  }
  ```
- 症状：stale 横幅**只在**「上游刚被编辑/重生成」时出现，而这两种动作必然把上游打成 `review`（R2）⇒ 此刻点「按上游重排」必得 `409 STAGE_LOCKED`。实测：`409 POST /api/projects/p_mvszltry_g9xrnk/stages/p2/stale/resolve`，界面 toast 只有「请先完成上一步 / 阶段要按「设定 → 大纲 → 章节计划 → 写作」的顺序推进。」（`software/src/client/lib/pipeline/format.ts:211-215` 的 `STAGE_LOCKED` 文案），没有一句说明「其实你得先回设定重新确认」。按钮 `enabled`、无前置说明。
- 依据：SPEC.md:356-361（R1 明确要求三动作可用）；UX-SPEC.md §5（三选一横幅）。
- 影响：横幅的主 CTA 是死路；用户唯一的出路（回上游重新确认再回来）全靠自己猜。属于「机制在但不闭环」，不丢数据。
- 建议修法（二选一，都要有可读反馈）：
  - 服务端：`resolveStale('regenerate')` 放宽为「允许上游处于 review 时用其当前内容重排」（regen 只读上游内容，不依赖确认标记），或
  - 前端：`stage-stale-regenerate` 在上游未确认时 `disabled` + 一句「先在设定里点『确认』，再回来按上游重排」，并在确认后自动恢复可用。
- 复现：确认 P1/P2 → 编辑 P1（P1 变 review、P2 confirmed+stale）→ `?stage=p2` 点「按上游重排」→ 409 + toast「请先完成上一步」。对照：先 `POST /stages/p1/confirm` 再点同一按钮 → 202 且 `regen-stage/p2` 正常。
- 证据：`evidence/ui-shots/qa-t16b-regenerate-blocked.png`、`evidence/qa-t16-probes.json` 的 `probe_t16b_v2.checks`（`A.regenerate-works-in-banner-state` FAIL / `B.regenerate-after-reconfirm` OK 两条对照）。

#### 10.3.3 我自己的判据错误（已更正，不计入缺陷）

- 第一版探针里 `ui.review-state-copy` 曾判红：我想验「review 态文案不带『建议复核后再确认』」但我当时 P2 实际是 `confirmed`，场景构造错。第二代探针用「先编辑 P2（回 review）→ 再编辑 P1（P1 confirmed→review、P2 stale 保留）」造出真正的 review+stale，实测文案「上游已变更 设定已被编辑。本阶段内容没有自动改动…复核并保留 / 按上游重排 / 忽略」——**不含** confirmed 那句，`D.review-copy` PASS。结论：review 态文案正确，不是缺陷。

#### 10.3.4 DEF-15 [medium] SPEC M3 的「条目增删 / 章节重排」是 V1 必须项，但实现里完全没有

- 依据：`SPEC.md:68`（M3「幕/节拍条目：编辑、**增删**、重排、反馈、重生成、确认」）、`SPEC.md:236`（P1「新增/删除条目」）、`SPEC.md:309`（P3「插入/删除/拆分/合并章节」）、`SPEC.md:845`（S8 步骤「回 P1，删除一个配角」）。
- 实测（真浏览器 + 真接口）：
  - `POST /api/projects/:id/items` → **404**；`DELETE /api/projects/:id/items/:id` → **404**；
  - `?stage=p2` 视图里匹配 `/新增|添加|删除|移除|上移|下移/` 的按钮 = `[]`；
  - `software/src/client/components/pipeline/ItemCard.tsx:258-273` 只有 `item-edit / item-regen / item-feedback / item-history / item-lock` 五个入口；
  - P3 只有「改章数 + 按目标分配」，没有插入/删除/拆分/合并单章（`P3PlanView` 的 count 控件是整表重算，减章遇正文会 422 `CONTENT_WOULD_BE_LOST`）。
- 归属判断：t8/t9 是评审、t10 是集成、t11 是文档，**没有任何在排任务覆盖这项**；`SPEC.md` 把它写成 V1 必须项（M3），`ARCHITECTURE.md` 也未把它列入「V1 非目标」。
- 影响：用户无法增删人物/幕/节拍，也无法在已生成的章节计划里插一章——「AI 主导 + 人工把关」里人工侧的编辑能力缺口。不阻塞主流程（可改内容、可改章数），但 SPEC 字面验收过不了。
- 建议：二选一 —— 补接口 + 入口（`POST/DELETE /items`、`POST /beats/:id/move`、P3 行内插入/删除），或由 pm 把 M3 降级到 V1.1 并在 SPEC 里写明（含 S8 步骤改写）。

### 10.4 验收标准逐条判定（第三轮）

| # | 验收标准 | 判定 | 依据（本轮实跑） |
| --- | --- | --- | --- |
| 1 | 真实点击「新建作品 + AI 企划」能观察到加载→成功/失败/取消，不得无响应；失败与取消均有出路 | **PASS** | UI U1/U2/U3 + API A1/A2/A3（同 §9.5 第 1 条，本轮 14/14 全绿复跑） |
| 2 | 长篇完整走通五阶段；每阶段可编辑/重生成/确认 | **PASS** | UI U4/U5/U6/U7/U8 + API B1–B9 本轮全绿；但「条目增删/章节重排」不在验收 7 条内，另记 DEF-15 |
| 3 | 短篇完整走通无章节版本，场景/节拍结构可用，且没有空章节或错误导航 | **PASS** | UI U9（全程 `chapter-row=0`）+ API C1–C3 |
| 4 | 逐章生成中暂停、继续、重写单章可用；刷新或重启后进度与内容保持；失败可重试且不丢已确认内容 | **PASS** | UI U7/U8 + API D1/D2/D3/D4（D3 SIGKILL 重启 `interrupted` → retry 逐字节不变） |
| 5 | 旧项目迁移后正文、版本、设定可读；迁移失败有提示且旧数据仍可打开 | **PASS** | UI U10 + API E1–E4（含 `MIGRATION_CHECK_FAILED` 后旧数据仍可读、可重试、可回退） |
| 6 | 无 API Key/无默认模型时明确报错，不能静默 mock 生成正文 | **PASS** | UI U1 + API F1/F2/F3（422 不落空壳；失败路径无 mock 特征文本） |
| 7 | 所有发现写入 TEST.md，含通过/失败项、证据与复现步骤 | **PASS** | 本节 + §10.5 证据索引（每条缺陷都带 file:line、复现步骤、证据路径） |

### 10.5 证据索引（第三轮）

- `evidence/qa-t16-commands.txt` — 五条命令的原始输出尾巴（typecheck / test / test:ui / 两个 QA 脚本）
- `evidence/qa-api-results.json`（30 条）/ `evidence/qa-ui-results.json`（14 条 + `httpErrorDetail`）—— 本轮实跑刷新
- `evidence/qa-t16-probes.json` — 两代探针原始输出（含 DEF-13/DEF-14 的 FAIL 与对照 PASS）
- `evidence/qa-t16-probe-server.log` / `evidence/qa-t16b-probe-server.log` — 探针期间服务端日志
- `evidence/ui-shots/qa-t16-stale-confirmed-p2.png`、`qa-t16-stale-kept-p2.png`、`qa-t16b-stale-lost-after-reedit.png`、`qa-t16b-stale-review-p2.png`、`qa-t16b-regenerate-blocked.png`

### 10.6 未覆盖与限制（第三轮）

1. 仍全部使用假 OpenAI 兼容供应商（mock/delay/hang/garbage/varying），未用真 Key 长跑；真 Key 只在 t1 单项取证。
2. 单进程、单作品并发（V1 声明）；多实例、批量迁移 sweep 未测。
3. 只在 macOS arm64 + 本机 Chromium 验证。
4. 运行期 2 条 `404 GET /pipeline`（删除作品竞态，OBS-1）仍归观察项。
5. 工作树：未改任何 `software/src/**`；`software/screenshots/` 下的 `qa-*.png` 是脚本产物（未跟踪、未提交）；未 commit / 未 push。

## 11. 第四轮（t18）：复核 t17 的 DEF-13/14/15 与 M3 条目能力

### 11.1 五条验证命令 + 自建探针的实跑结果

全部由我自己起 fresh 进程（`software/` 下 `tsx src/server/index.ts`，临时 `PW_DATA_DIR`），**不采信 t17 自测的 36/35/30/14 数字**。

| 命令 | 结果 | 观察到的原始输出 |
| --- | --- | --- |
| `pnpm --dir software typecheck` | exit 0 | `> tsc --noEmit` 之后无任何输出，`TC_EXIT=0` |
| `pnpm --dir software test` | exit 0 | `36` 行 `PASS …`，末行 `All API tests passed.`，`TEST_EXIT=0` |
| `pnpm --dir software test:ui` | exit 0 | `35` 行 `PASS …`，`All UI tests passed.`，`UI_EXIT=0` |
| `node software/scripts/qa-e2e-api.mjs` | exit 0 | `通过 30 / 30，失败 0，缺陷 0`，`API_EXIT=0` |
| `node software/scripts/qa-e2e-ui.mjs` | exit 0 | `通过 14 / 14，失败 0，缺陷 0`，`QAUI_EXIT=0`（含 U13 已确认阶段的 stale 横幅三键，之前是 U13 由实现者补的，本轮按当前字节重跑） |
| `node software/scripts/qa-e2e-r4.mjs`（本轮新写） | exit 0 | `19 通过 / 0 失败 / 1 缺陷（DEF-16 low）`（A1–A13 + U1–U6） |

### 11.2 DEF-13 复核：上游改动现在**每次都**标下游 stale

- 判定依据：SPEC §4 R1（§361「触发后：下游 `stale=true`，界面顶部横幅…三个动作」）、SPEC.md:852（S8 断言「P2 仍是 `confirmed`，且横幅文案为『上游已变更，建议复核后再确认』」）。
- 实现读数（我自己 grep）：`software/src/server/pipeline/actions.ts:442-448` 的 `afterContentTouched` 现在**先**无条件 `markDownstreamStale(projectId, stageKey, `${stageKey}:${action}`)`，**再**只在 `stage.status === 'confirmed'` 时把本阶段打回 `review` —— 与 SPEC R2（本阶段回 review）和 R1（下游 stale）分别对齐。
- 实测（`qa-e2e-r4.mjs` U1，真实浏览器点击「编辑」并保存两次）：
  - 第一次编辑 P1 → `p1=review`、`p2=confirmed` 且 `staleReason='p1:edited'`；P2 页面出现 `[data-testid="pipeline-banner"][data-state="stale"]`；
  - 点「复核并保留」（`stage-stale-keep`）→ `staleReason` 清空、P2 仍 `confirmed`；
  - **第三次操作（DEF-13 的关键路径）：P1 此时已是 review，再编辑一次 → `p2.staleReason` 重新变回 `'p1:edited'`，`?stage=p2` 的横幅重新出现（`data-state=stale`）**。
  - 结论：**DEF-13 关闭**。上一轮的现象（keep 之后再改上游 → 下游永久无提示）在本次实跑中不再出现。

### 11.3 DEF-14 复核：「按上游重排」不再是必 409 的死键

- 判定依据：SPEC.md:670（`stage-stale-regenerate-hint`「仅当上游未确认时出现，文案含『先确认上一阶段』」）。
- 实现读数：`software/src/client/components/pipeline/PipelineBanner.tsx:147-181` 用 `UPSTREAM_OF[stage]` 从快照读上游状态，`upstreamReady = 确认|跳过`，否则 `disabled={busy || !upstreamReady}`、`title` 与 `aria-describedby` 指向 `stage-stale-regenerate-hint`。
- 实测（U2，真点击）：
  - 上游 P1 处于 `review`（刚被编辑）时进入 `?stage=p2`：`button[data-testid=stage-stale-regenerate]` 的 `disabled=true`，提示元素 `stage-stale-regenerate-hint` 可见，文案 **「先确认上一阶段（设定）」**，`aria-describedby="stage-stale-regenerate-hint"`；
  - 回 `?stage=p1` 点 `stage-confirm` 确认后回 `?stage=p2`：按钮恢复可点；
  - 点击 → 起 `stage=p2` 的 `regen-stage` job，**期间没有出现任何 409**（本轮 HTTP≥400 计数为 0），job 完成后 `staleReason=null`、横幅消失（不带「重排成功后横幅仍挂着」的孪生 bug）。
  - 结论：**DEF-14 关闭**（采用「前端禁用 + 写明原因 + 服务端保留 409」的方案，与 SPEC.md:670 一致）。

### 11.4 DEF-15 复核：M3 的条目增删排序与章节/节拍排序真实可用

接口层（`qa-e2e-r4.mjs` A2–A8、A12）逐条实测：

| 能力 | 实测结果 |
| --- | --- |
| P1 新增 | `POST /stages/p1/items {kind:'character'}` → **201**；`{kind:'env'}` → **201**；重复 `{kind:'world'}` → **400「世界观只能有一条，直接编辑现有的那条」**；`{kind:'bogus'}` → **400** |
| P1 删除 | 锁定后 `DELETE /items/:id` → **409 `ITEM_LOCKED`「这一条已锁定，先解锁再删」**；解锁后 → **200**（`deleted` 含被删条目）；环境同样可删 |
| P1 排序 | `block=characters` 倒序 → **200** 且列表顺序真的变；少一条 → **400「排序要提交人物列表的全部条目（当前 3 条）」**；混入外来 id → **400**；`block=world` → **400**；p4 排序 → **400「正文按章节顺序排列，不支持单独排序」** |
| P2 新增 | `{kind:'act'}` → **201**；`{kind:'beat', parentId: act}` → **201**；无父节拍 → **400「节拍必须挂在某一幕下」**；未知 kind → **400** |
| P2 排序 | `block=acts` 倒序 → **200** 生效；`block=<幕 id>` 内节拍排序 → **200**；幕少一条 → **400**；缺 `block` → **400**；不存在的幕 → **404** |
| P2 删除 | 删幕 → **200** 并级联删掉幕内节拍（`deleted=2`） |
| P3 排序 | `POST /stages/p3/units/reorder` 倒序 → **200** 生效；少一条 → **400「排序要提交章节计划的全部条目（当前 10 条）」**；章节从条目接口删 → **400「章/节拍的增删请用『章节数』或『节拍计划』，这里只能改与排序」** |
| 短篇等价 | `type=short` 项目：`beat_group`/`beat` 可增、`act` 被 **400** 拒；`block=acts`（=节拍组）倒序 **200** 生效；幕内节拍排序 **200**；P3 节拍计划 8 条倒序 **200** 生效；全程 `project.chapters` **0 行** |

界面层（U3–U5，Playwright 真点击，不是调接口）：

- U3：P1 点 `stage-block-add-characters` → 新条目卡出现（服务端多一条，id 对得上）→ 点该卡 `item-move-up` → 服务端顺序变成「倒数第二」→ **刷新后 DOM 顺序与服务端逐项一致** → 点 `item-delete` + 确认弹窗 `confirm-ok` → 条目消失。
- U4：P2 点 `act-add` → 新幕卡出现 → 在该幕的 block 内点 `beat-add` → 新节拍挂在正确幕下 → **刷新后两张卡仍在**。
- U5：P3 计划表把第 2 行 `unit-move-up` 成第 1 行 → 服务端顺序变 → **刷新后 10 行的 `data-id` 顺序与刷新前一致**。

结论：**DEF-15 关闭**，且 P1/P2/P3 与短篇都有真实点击证据。

### 11.5 排序不动内容 / 刷新重启保持 / 旧作品迁移

- **正文逐字节不变（A9）**：给两章通过 `PATCH /api/chapters/:id` 写入含换行、引号、省略号与 emoji 的 190 字符正文，再倒序重排章节计划 → 两章内容与写入时**逐字节相同**（比较的是完整字符串，不是长度）。
- **SIGKILL 重启保持（A10）**：杀掉服务进程（`SIGKILL`，不是优雅退出）后用同一 `PW_DATA_DIR` 重启 → 人物 3 条与章节 10 条顺序与重启前**逐项一致**。
- **旧作品迁移（A11）**：建 legacy 作品 → 写正文 → 显式建两个版本快照（`POST /api/chapters/:id/versions`）→ `POST /migrate` → **迁移后**新增人物、人物排序、删条目 → 正文仍是原文（29 字符，逐字节相等）、版本 **2 → 2** 且**迁移后还能回退到「第一稿」再回退回「终稿」（两次都逐字节一致）**、旧的三幕标题（第一幕/第二幕/第三幕）全部可读。

### 11.6 本轮新增发现：DEF-16 [low] 章节重排后 `chapters.number` 不重排

- 现象（A13 自造重排取证）：长篇 10 章，`POST /stages/p3/units/reorder` 倒序后，`GET /api/projects/:id` 返回的顺序变成新的，但 `chapters[].number` 仍是旧值：**第10章 → 第9章 → 第8章 … → 第1章**；P3 计划表的「序号」列按 index 渲染 1..10，写作台左侧章号（`software/src/client/pages/StudioPage.tsx:1036`）与正文抬头（`:1151`、`:1383`）仍显示旧章号 ⇒ 同一本书两处编号不一致。
- 定位：`software/src/server/pipeline/actions.ts:710` —— `reorderUnits` 只写 `chapters.sort_order` 与 `updated_at`，没有重排 `number`（也不重排标题里内嵌的章号）。
- 影响面：只影响显示文案，不影响内容、顺序、版本；SPEC 对 P3 只要求「章数/字数/排序可用」，没有明写重排后是否重编号，**故按 low 登记**，建议下一轮统一为「重排后按位置重算 `number`」或「写作台改为按位置显示序号」。
- 复现：`node software/scripts/qa-e2e-r4.mjs`，看 A13 的证据行即可（脚本自身会重排再复原）。

### 11.7 本轮我自己的判据修正（避免把「我写错」当产品缺陷）

1. `PATCH /api/chapters/:id` **不建版本**（`software/src/server/repository.ts:204-221` 只更新正文/字数），版本由显式 `POST /api/chapters/:id/versions` 或 AI 生成写入。第一版探针以为「保存三次就有三个版本」→ A11 红；改成显式建版本快照后才是有意义的断言。
2. 短篇 `beat_group` 要能通过 P2 确认门槛，必须带 `payload.function` 且 `payload.summary` ≥ 15 字（`software/src/server/pipeline/actions.ts:88-96`）；不带时 `confirm` 返回 `CONFIRM_BLOCKED`，随后生成 P3 会 409 `STAGE_LOCKED`。是我的用例漏了业务前置条件，已按规范补齐并断言 `confirm` 响应码。
3. 全排列排序的 id 列表必须覆盖「当前全部条目」，新增之后再排序要把新条目算进去（否则 400，正是服务端的保护在起作用）。

### 11.8 t18 三条验收标准逐条判定

| 验收标准 | 判定 | 证据 |
| --- | --- | --- |
| ① 独立复验 DEF-13/14/15 全部关闭，且有真实 API/UI 证据 | **PASS** | §11.2（U1 两次编辑 + keep 后横幅重现）、§11.3（U2 disabled+hint+aria→确认上游→可点→无 409→横幅消失）、§11.4（A2–A8/A12 接口 + U3–U5 真点击）；`evidence/qa-r4-results.json` |
| ② 条目增删排序（P1/P2）与章节/节拍排序（P3）浏览器真点击可用；刷新后顺序保持；旧作品正文不变 | **PASS** | U3/U4/U5（含刷新后 DOM 与 `data-id` 顺序比对）、A9（正文逐字节）、A10（SIGKILL 重启顺序保持）、A11（迁移后正文/版本/旧幕可读）、A12（短篇章节 0 行） |
| ③ typecheck/test/test:ui 全绿，qa-e2e-api 与 qa-e2e-ui 全绿；无 pageerror；工作树截图噪声已还原 | **PASS** | §11.1 五条命令全 exit 0；U6 汇总 `pageerror/console 异常 0 条`、`HTTP≥400 共 0 条`；`git status --porcelain software/screenshots` 已无 `M`（`99-new-project-empty.png` 被 `test:ui` 重写后已 `git checkout` 还原，本轮我自己的 6 张 `qa-r4-*.png` 已移到 `evidence/ui-shots/`，不再留在 app 目录） |

### 11.9 证据索引（第四轮）

| 文件 | 内容 |
| --- | --- |
| `software/scripts/qa-e2e-r4.mjs` | 本轮自建探针（A1–A13 API + U1–U6 真点击），可重复运行：`node software/scripts/qa-e2e-r4.mjs`（默认 PORT 8841、临时数据目录，不污染既有库） |
| `team/inkquay-ai-first/evidence/qa-r4-results.json` | 19 步逐条结果、DEF-16 结构体、console/http 采集、`_meta`（端口/数据目录/耗时） |
| `team/inkquay-ai-first/evidence/ui-shots/qa-r4-u1-stale-confirmed.png` | 第一次编辑后 P2 已确认 + stale 横幅 |
| `team/inkquay-ai-first/evidence/ui-shots/qa-r4-u1-stale-again.png` | keep 之后再编辑上游，横幅重现（DEF-13 反证） |
| `team/inkquay-ai-first/evidence/ui-shots/qa-r4-u2-regen-disabled.png` | 「按上游重排」disabled + 「先确认上一阶段（设定）」提示（DEF-14 修复证据） |
| `team/inkquay-ai-first/evidence/ui-shots/qa-r4-u3-p1-items.png` / `qa-r4-u4-p2-items.png` / `qa-r4-u5-p3-order.png` | 条目增删/排序与计划表排序后的界面 |
| `team/inkquay-ai-first/evidence/qa-api-results.json`、`qa-ui-results.json` | 本轮重跑的两个独立套件结果（30/30、14/14） |
| `/tmp/qa-r4-server.log` | 探针起的服务端 stdout/stderr（临时文件，不进仓库） |

### 11.10 限制与未覆盖（如实登记）

1. 供应商全程用内置 `mock`（确定性文本）。t18 的目标是条目/排序/stale 语义，不涉及真实模型的文体质量；真实 Key 链路由第一轮 §1 的对照实验与 F 类用例覆盖。
2. 排序只验证了「↑↓ 单步」与接口级全排列重排；**拖拽**不在本轮（SPEC 允许按钮实现，`item-move-up/down` 与 `unit-move-up/down` 就是契约锚点）。
3. 短篇只验证到 P3 节拍计划排序与章节 0 行；短篇 P4 逐节拍写作由 `qa-e2e-ui.mjs` U9 覆盖（本轮重跑通过）。
4. DEF-16 只证明 API 层的 `number` 未重排；写作台界面的错位是从 DOM 渲染代码（`StudioPage.tsx:1036/1151/1383`）读出来的，没有单独截图。
