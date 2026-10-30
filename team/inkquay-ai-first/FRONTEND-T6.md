# 前端实现说明 —— AI 主导的五阶段创作工作台（t6）

范围：`software/src/client/`、`software/src/shared/`、`software/scripts/ui-test.mjs`。后端、desktop、.github 零改动；未 commit / push。

## 1. 新作品默认进 AI 企划（修复“新建并让 AI 企划”无响应）

链路（`src/client/components/NewProjectModal.tsx`）：

1. 打开弹窗即 `GET /api/pipeline/precheck`，结果显示在 `new-project-precheck[data-state=loading|ok|error][data-code]`：通过是「✓ 将使用 X · Y」，不通过是「⚠ 还不能让 AI 企划：…」。
2. 点 `new-project-submit` 时**再校验一次** precheck；不通过就直接在弹窗里给 `new-project-error[data-code]`，**不发创建请求**，因此不会留下空壳作品（文案里写明「不会留下空壳」），并允许「仍然创建（只能自己写）」。
3. 通过后 `POST /api/projects`（`start:'pipeline'` + `Idempotency-Key`）→ **立刻关闭弹窗并 push `/project/:id/pipeline`**（D2：不在弹窗里等整份企划）。
4. 企划页首屏立刻渲染阶段轨道 + `plan-progress`：`data-state=running`、`data-step`（setting/outline/chapter-plan/writing）、`data-elapsed` 每秒递增，`plan-cancel` 一直可见；≥15s 追加「生成通常需要 20–60 秒 · 可以先离开，作品已保存」。
5. 失败：阶段内 `plan-error[data-code]`（四段式错误卡 + 技术详情折叠 + `plan-retry`），刷新后仍在（读服务端持久化的 `lastError`）。
6. 取消：`plan-cancel` → 阶段回 `empty`，出现 `plan-delete`（仅在没有任何正文时渲染），删除后回作品库 —— 取消/失败都不留孤儿空白页。

审计根因 R1（`NewProjectModal.tsx:191-196` 的 `!created` 把主按钮连同文案一起隐藏）已不可能重现：表单在创建期间只禁用不消失，提交按钮始终渲染、文案随 phase 变化（`创建中…`），错误固定落在 `new-project-error` 里。

## 2. 阶段导航与页面结构

`src/client/pages/PipelinePage.tsx` 单路由 `/project/:projectId/pipeline` + `?stage`，`AppShell active="pipeline"`，Rail 新增「企划」。

- 左栏 `StageRail`：`stage-p1`…`stage-p4`，`data-status=empty|generating|review|confirmed|failed|skipped`，副文案给量化摘要（`3 条世界规则 · 2 环境 · 12 人物` / `3 幕 · 14 节拍` / `共 5 章 · 4.0 千字`）。
- 「下一步」卡 `pipeline-next-step`：**只用服务端 `nextStep`**（D6），前端不重算阶段判定；主按钮 `pipeline-next-action`。
- P1 设定 = 世界观（1 条 4 字段原子保存）/ 环境 / 人物三块，块头 `stage-block-regen-world|env|characters` 做块级重生成与块级意见。
- P2 故事大纲 = 幕（长篇）/ 节拍组（短篇）两级，幕头 `act-regen` 可只重做这一幕。
- P3 章节计划 = `P3PlanView`；P4 逐章写作 = `P4WritingView`；短篇所有「章」字走 `unitLabel()`（`节拍`、`节拍组`、`逐节拍写作`）。

## 3. 可编辑 + 可反馈 + 修改历史

- 每个产物都是 `item-card[data-kind][data-id]`：`item-edit` 原地展开编辑（整卡原子保存）、`item-regen` 单条重生成、`item-feedback` 提意见、`item-history` 修订历史、`item-lock` 锁定（锁定后块级/整份重生成会跳过它，服务端保证）。
- 意见抽屉 `stage-feedback`（条目/块/阶段三个作用域共用一个 composer，提交按钮 `stage-feedback-submit`，<6 字禁用并提示「说清楚一点」）。
- 修订历史抽屉 `item-history-drawer`：每条含来源徽标（AI 初稿/你修改/按意见重做/整份重生成/回滚/确认快照）、时间、`item-history-restore` 恢复（二次确认 `item-history-restore-confirm`，恢复是新增一条修订，不删历史）。
- 刷新/重开：`usePipeline` 每 2s（运行中）/10s（暂停）/5s（待确认）轮询快照，页面隐藏时暂停轮询；刷新后阶段、条目、job 进度全部来自服务端。

## 4. 章节计划

`P3PlanView`（长篇 `chapter-plan-row`，短篇 `beat-plan-row`）：

- `chapter-plan-count` + 预览（`chapter-plan-count-preview`「将新增 3 章（第 38–40 章）」/「将从末尾删除 7 章」）+ `chapter-plan-count-apply`；有正文时走「只删空白章」（`archiveOrphans`），后端 `CONTENT_WOULD_BE_LOST` 的 blockers 会列章名 —— 不静默删正文。
- 每章可改标题、功能（预设 chips/select）、大纲、`min/target/max` 三档字数（`data-words-min|target|max`），行级校验（min ≥300、max ≤20000、min≤target≤max）。
- 合计条 `chapter-plan-total[data-over]`：`共 N 章 · 计划 x 万字 · 目标 y 万字 · 偏差 -63.0%`，超 ±25% 需显式 `接受偏差`（写库持久）。
- `chapter-plan-preset[data-preset=fast|standard|thick]` 只作用未锁定行；`按目标字数分配` 是「预览 → 应用」两步。
- `chapter-plan-confirm` 是**唯一**开始逐章写作的入口；未确认时 p4 不出现 `write-start`（服务端 `STAGE_LOCKED` 兜底）。

## 5. 逐章写作（D4 连写）

`P4WritingView` 控制条 `write-control[data-state=idle|running|paused|interrupted][data-phase=…][data-pause-pending][data-failed-chapter]`：

- `write-start` 连续写到最后一章；`write-pause` 当前章写完再停；`write-stop` 立即停止（二次确认，丢当前章未完成正文）；`write-continue` 继续；`write-review` 全部写完后进入逐章审阅；`write-retry-failed` 重试失败章。
- 章节板 `chapter-row[data-status|data-words|data-failed|data-error]`（短篇 `beat-row`），行操作只有「审阅」导航（`chapter-review-link`，D5/D6）与单章重写/只写这一章；进度条 `role=progressbar` 显示 `已完成 N/M 章`。
- 审阅四键只在写作台：`/project/:id?review=1&chapter=<id>` 顶部 `review-bar`，含 `review-queue-count`、`chapter-approve` / `chapter-request-changes` / `chapter-manual-approve` / `chapter-skip` / `chapter-rewrite` / `chapter-version-list`（版本抽屉 `chapter-version-restore`）。
- 短篇：写作台同样可审阅，`beat-row` 计数 = 计划节拍数，`chapter-row` 全站 0。

## 6. 旧项目与迁移

- 旧作品（`pipeline_status='legacy'`）从作品库点开仍然进原来的写作台，编辑器、AI 聊天、版本、导出、供应商/推理设置一行未改。
- 流水线作品的快照检测到 `migration.state='legacy'` 时，页面顶部 `migration-banner[data-state=legacy]` + `migration-upgrade`（显式迁移，失败给 `migration-banner[data-state=failed]` + 回滚入口，不自动迁移）。
- 从作品库打开流水线作品：写作台会探测快照，非 legacy 时自动跳到 `/pipeline`（避免掉进空编辑器），但带 `?review=1` / `?chapter=` 的审阅链接仍留在写作台。
- 写作台顶部新增 `.pipeline-inline-panel`「回企划工作台 / 逐章写作进度」；旧「AI 企划这一本」按钮与 `PlanReviewModal` 保留（`ui-test` 仍在跑这条旧链路，证明旧能力没丢）。

## 7. UI E2E 覆盖（`software/scripts/ui-test.mjs`，全部真实点击）

| 场景 | 断言要点 |
| --- | --- |
| S5 前置拦截 | 无默认模型时 `new-project-precheck[data-code=NO_DEFAULT_MODEL]`，提交后 `new-project-error`，作品数仍为 0 |
| 新建无响应（慢供应商） | <5s 进入 `/pipeline`、`plan-progress[data-state=running]`、`data-elapsed` 递增、`plan-cancel` 可点 |
| 取消不留孤儿 | 取消后 `stage-p1[data-status=empty]`、`plan-delete` → 作品数归 0 |
| 失败可读 + 可重试 | 失联供应商 → `plan-error[data-code]`，主文案不含底层报文，`plan-retry` 可见 |
| P1 编辑 + 意见 + 历史 | 角色卡 `item-edit` 保存生效、`item-history` ≥2 条；`item-feedback` 提交后该条历史再增加 |
| 阶段确认 | `stage-confirm` → `stage-p1[data-status=confirmed]`，依次 P2、P3 |
| 章节计划 | 行数 ≥3、改章数为 5、改单章 target=2000、三档预设批量生效、`chapter-plan-total` 含偏差、确认后才出现 `write-start` |
| 逐章写作 | `write-start` → `write-control[data-state=running]` → `write-pause` → `write-continue` → `write-review`，`chapter-row`=5、`beat-row`=0 |
| 写作台审阅 | `chapter-approve` 后服务端 `units` 出现 approved；版本抽屉可开 |
| 刷新保持 | 重新进 `/pipeline?stage=p4` 后 `chapter-row`=5、p3 仍 confirmed |
| 短篇 | `beat-plan-row` → `beat-row`，`chapter-row` 与 `chapter-plan-row` 全为 0 |
| 旧项目 | 不勾 AI 企划 → 直接进 `.doc-title-input`（URL 不含 /pipeline），写作台里「AI 企划这一本」仍可逐条审核应用 |

## 8. 已知边界

- V1 用轮询（2s/10s/5s），没有 SSE；页面隐藏时暂停轮询，回到页面即补齐。
- 阶段条目没有「新增/删除单条」接口（后端未提供），所以条目卡只做编辑/重生成/锁定，新增走重生成作用域。
- 迁移是显式动作（`migration-upgrade`），不做自动迁移；回退走 `migration-rollback`。
- 旧 `PlanReviewModal` 链路保留未删（legacy 作品可用），新流程作品不再使用它。
- **「继续写作」的兜底（后端偏差，前端已兼容）**：`software/src/server/pipeline/runner.ts:182` 的 catch 分支把任何在飞中断都记成 `finishCancelled(..., 'user_cancel', ...)`，包括「暂停」；而 `actions.ts:279 continueWriting` 只认 `status='cancelled' AND stop_mode='pause'`。结果是在某一章写到一半时点「暂停」→ 该章被立刻 abort（不是 D4 规定的「写完这章再停」）→ job 记为 `user_cancel` → `POST /writing/continue` 返回 400「没有可继续的写作任务」。前端因此改成：先调 `/writing/continue`，若抛 `BAD_REQUEST`/`CONCURRENT_JOB` 且存在 `lastJob`，退回 `POST /projects/:id/jobs/:jobId/retry`（服务端 `resumeStepsFor` 会从第一个待写单元续跑），保证「继续写作」任何情况下都有下一步。建议后端把 catch 分支改成 `pause_requested ? 'pause' : 'user_cancel'`，让暂停真正只停在本章结束。
- 逐章写作期间阶段状态是 `generating`：`PipelinePage` 只在「generating 且该阶段还没有任何产物」时才用骨架占位，否则保留控制条/章节板（否则写作中会丢掉暂停按钮与进度）。

## 9. 验证记录（本机实跑）

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir software build` | exit 0，`✓ built in 189ms` |
| `pnpm --dir software typecheck` | exit 0（无输出） |
| `pnpm --dir software test:ui` | exit 0，32 段 `PASS`，末行 `All UI tests passed.` |

`test:ui` 里 `HTTP >=400 during run` 只剩允许清单内的两条（负向用例故意制造）：`404 GET /api/projects/:id/pipeline`（删除作品瞬间在飞的轮询，已加 AbortSignal 收敛）、`400 POST /api/projects/:id/writing/continue`（继续写作的兜底探测）。允许清单之外任何 4xx/5xx 都会判红。

## 10. repair-round-2（t21）：t9 评审 23 条整改

t9（`REVIEW-FRONTEND.md`）给了 23 条 findings，逐条落地如下；每条都对应 `scripts/ui-test.mjs` 里的真实点击断言或明确的降级说明。

| # | 评审问题 | 整改 | 对应验证 |
| --- | --- | --- | --- |
| U1 | 导出按钮被 `showButton` 例外藏掉，且 `case 'export'` 打的是不存在的 `/export/markdown` | `NextStepCard` 去掉例外；`case 'export'` 改调 `api.downloadProjectMarkdown` → `GET /api/projects/:id/export`（后端本就支持长短篇） | 全部章进入终态后点 `pipeline-next-step[data-kind=export]`，`waitForEvent('download')` 断言拿到 `.md` |
| U2 | `stage-skip` 无条件渲染，但服务端只允许跳 P1 | `StageConfirmBar` 加 `canSkip = stage === 'p1'`，⋯ 菜单与 `stage-skip`/`stage-skip-confirm` 只在 P1 出现 | p3/p2 打开 ⋯ 菜单断言 `stage-skip` 计数 0；P1 断言 1 |
| U3 | `void onReorderUnits()` / `void onAcceptDeviation()` 无 catch（unhandled rejection） | `moveUnit` 改 async + `reorderBusy` + `catch → setLocalError('排序失败：…')`；偏差接受/撤回改 `.catch(setLocalError)` | 用 route 注入 409 点下移，断言 `chapter-plan-error` 出现且含原因 |
| U4 | 清空字数输入框静默无效（回落旧值） | `resolveWords()` 区分「没动」与「清空」：清空 → 行内 `不能留空` + `aria-invalid`，不发请求；服务端 `patchUnit` 对 null 用旧值，所以不能真清空（已在文档写明） | 清空后断言 `chapter-plan-row-error` 与 `aria-invalid=true`，再填回原值 |
| U5 | `write-start` 只看 p4 自身状态，计划没确认也能点（撞 409） | `P4WritingView` 新增 `planConfirmed`，`write-start`/`write-restart` disabled + `write-start-hint`「先确认章节计划」 | 计划未确认时断言 disabled + hint 文案；确认后断言可点 |
| U9/U15 | `refresh()` 撞 inFlight 静默丢弃；快照请求无超时会让 `inFlight` 永久闩锁 | `usePipeline` 排队一次在 finally 补跑；每次快照带 `AbortSignal.timeout(15000)`，超时按 NETWORK 计入 failures；`projectId` 变化清空排队 | 全量 E2E 依赖该轮询不回退（长任务/暂停/中断恢复段均通过） |
| U12 | 错误文案缺 TARGET_EDITED/ITEM_LOCKED/MIGRATION_CHECK_FAILED/IDEMPOTENT_REPLAY | `ERROR_COPY` 补四条并标 `retryable:false`；兜底标题带 `code` | 类型检查 + 代码审阅（不可重试原因不再引导「重试一次」） |
| U13 | 审阅里切下一篇不清 saveTimer、不等保存 → 丢字 | `showReviewChapter` 先 `clearTimeout(saveTimer)`，`await saveNow()` 失败则不切并提示 | 改字后立刻点「下一篇」，再查服务端章节正文包含刚打的标记 |
| U14 | 没有跨幕移动节拍入口 | P2 节拍卡给「移动到…」+ 降级说明（服务端 `reorderItems` 只接受同组完整排列，`beat` 白名单无 `actId/groupId`），文案给出替代做法 | 多幕作品点 `beat-move-menu`，断言 `beat-move-hint` 含「还不支持跨幕移动」 |
| U17 | `Number(value) \|\| 0` 把空数字写成 0 | `ItemCard.commit()` 空串跳过该字段，非数字才报错 | 类型检查 + 代码审阅（不再把空年龄/空章数写 0） |
| U18 | 关键路径零覆盖 | 新增 8 段：跳过键归属、字数清空报错、排序失败提示、改字不丢、导出可下载、修订恢复、未确认不许写、SIGKILL 后断点续写 | 见 §7 表与 `PASS repair: …` 输出 |
| U19 | 「重试」只切阶段，错误卡重试从头生成 | `retry-failed` 先 `retryJob(lastJob.id)`（服务端 `resumeStepsFor` 续跑），无 job 才 `generate(stage)`；文案区分「只继续没做完的那部分」 | 类型检查 + 中断续写段（`plan-continue` 走同一路径） |
| U6 | `confirmedAt` 硬编码 null | 传 `stageView.status==='confirmed' ? stageView.updatedAt : null`（wire 上 `StageView` 没有 `confirmedAt` 字段，只有确认时刻的 `updatedAt`） | 类型检查 |
| U7 | JobBar 把 interrupted 映射成 done | `stateOf()` 返回 `running/done/failed/cancelled`，interrupted→failed 且文案「上次的生成被中断了，可以继续」；删掉死的第二参数 | 中断段横幅与 job 条不再显示「已完成」 |
| U8 | 死变量 + `throw new Error('保存失败')` 丢结构化错误 | 删除 `stageKey`；`run()` 加 `throwOnError`，`patchItem` 透传原始 `PipelineRequestError` | 类型检查 |
| U10 | 批量字数档部分失败无提示 | 逐条 try/catch，汇总「N 成功 / M 失败（前三条原因）」，保留再点一次的重试入口 | 全量 E2E 的字数档段 |
| U11 | 锁定阶段仍可点进 rail | `StageRail` 行 `disabled` + `title` 说明（当前阶段仍可点） | 全量 E2E 的 openStage 辅助 |
| U20 | 剧本作品可直接打开 `/pipeline` | 按作品类型重定向到 `/screenplay`（与写作台一致），series 给 `pipeline-unsupported` 空态卡 + 返回入口 | 类型检查 + 代码审阅 |
| U21 | 迁移横幅压过中断横幅；回退无二次确认 | `PipelineBanner` 改「并列渲染 + interrupted unshift 最高优先」；回退走 `setConfirm`（标题「回退这次升级？」默认焦点在取消） | 类型检查 + 代码审阅 |
| U22 | 审阅一次连发两次 `units()` | 合并为一次请求复用结果 | 中断/审阅段请求数观察 |
| U23 | ErrorCard 主按钮两个完全相同的分支 | 合并为单个 `effective` 计算，顺序 settings → continue → retry | 类型检查 |
| U24 | `if (!snapshot) return null` 纯空白页 | 换 `pipeline-fallback` 兜底卡（重试 + 返回作品库） | 类型检查 + 代码审阅 |

两处「不改前端伪装成改好」的说明：
- **U4 清空字数**：服务端 `patchUnit` 用 `patch.minWords ?? unit.minWords`，null/undefined 一律沿用旧值，没有「取消设置」语义；后端不在本任务 inScope，所以前端选择「明确拦住 + 行内提示」而不是假装修好了。
- **U14 跨幕移动**：服务端 `reorderItems` 用 `assertPermutation` 只接受同一幕内节拍的完整排列，`ITEM_FIELD_WHITELIST.beat` 也没有 `actId/groupId`；前端给到「移动到…」入口并说明限制与替代做法（在目标幕新增节拍抄过去再删），不伪造能力。

另外顺手修掉一个自己引入的锚点重复：`P4WritingView` 的中断横幅与 `PipelineBanner` 同时用 `pipeline-banner[data-state=interrupted]` 和 `plan-continue`，会让 `getByTestId` 多匹配（D5/D6 的锚点唯一性要求）。已把写作台内的改为 `write-interrupted` / `write-resume`。

### 验证记录（repair-round-2）

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir software build` | exit 0 |
| `pnpm --dir software typecheck` | exit 0（无输出） |
| `pnpm --dir software test:ui` | exit 0，46 段 `PASS`，末行 `All UI tests passed.`；`HTTP >=400` 只剩三条允许项：`404 GET /api/projects/:id/pipeline`（删除瞬间在飞轮询）、`400 POST /api/projects/:id/writing/continue`（继续写作兜底探测）、`409 POST /api/projects/:id/stages/p3/units/reorder`（排序失败提示的注入用例） |
