# REVIEW-FRONTEND — t9 独立评审（AI-first 前端阶段工作台 + 新建企划链路）

- 评审对象：工作树（branch `main`，HEAD `ae75612`）中 t6 的前端改动；`software/src/` 全部为**未跟踪**文件，无 git 历史可 diff，评审依据是当前字节。
- 评审方式：逐文件通读 + 交叉回读后端契约（`software/src/server/pipeline/*`、`software/src/server/index.ts`）+ 复核测试脚本断言（`software/scripts/ui-test.mjs`、`api-test.mjs`、`qa-e2e-*.mjs`）。**没有使用截图或开发者的自测数字作为证据**；每条 finding 都给出 file:line 与触发条件。
- 范围：`software/src/client/**`、`software/scripts/ui-test.mjs`（只读）；未改动任何业务代码，未 commit / push。

## 结论

**verdict = needs_revision**

AI-first 的骨架是真的：新建即落库并在创建请求里起跑 P1 生成、阶段导航由服务端 `nextStep` 驱动（不是聊天框）、条目级编辑/反馈/锁定/修订历史/确认门槛都在、短篇走节拍不建章节行、旧作品仍进旧写作台。验收项 ①③④⑥ 基本达标。

但仍有 9 条 medium 需要修，其中三条属于「用户以为做了、其实没做」的静默失败，与本轮交付的核心承诺（每一步都有可见结果）直接冲突：

1. **U1 导出在流水线页不可达**：`nextStep.kind='export'` 的按钮被隐藏，而唯一的分支打开一个不存在的 URL。
2. **U3 排序 / 接受偏差失败时零反馈**：`void onReorderUnits()` / `void onAcceptDeviation()` 没有 catch，是 unhandled rejection。
3. **U13 审阅队列切换单元不 flush 未保存正文**：刚敲的字永久丢失，且残留的 debounce 定时器把**下一章**的内容再 PATCH 一次。
4. **U19 「重试」是假重试**：下一步卡上的「重试」只切阶段；错误卡的重试是整阶段重来，与文案「从失败的那一步接着来」相反，后端续跑能力（`resumeStepsFor`/`retryJob`）在失败路径上从未被使用。
5. **U15 快照请求没有超时**：一次挂起就让 `inFlight` 永久为 true，此后所有刷新静默返回 null，`offline` 也永不置位 → 页面永久停在旧状态、没有任何提示。

其余低危（U6–U11、U17、U20–U23）建议随本轮一并清掉，不单独阻塞。

findings 一览（详见下文逐条）：

| id | 级别 | 一句话 | 位置 |
| --- | --- | --- | --- |
| U1 | medium | 流水线页没有任何可用的导出入口，唯一分支打开不存在的 URL | `PipelinePage.tsx:599-601`、`NextStepCard.tsx:32` |
| U2 | medium | p2/p3 也给了「跳过…我自己写」，后端只允许 p1 | `StageConfirmBar.tsx:59-90`（`stage-skip` 在 :85、`stage-skip-confirm` 在 :76）、`actions.ts:185` |
| U3 | medium | 章节排序 / 接受偏差失败无任何提示（unhandled rejection） | `P3PlanView.tsx:68`、`:295`、`:315`；`PipelinePage.tsx:490-505` |
| U4 | medium | 清空字数输入框静默无效（值弹回旧值） | `P3PlanView.tsx:90-93`、`:414-437` |
| U5 | medium | 章节计划未确认时「开始写作」可点，只有服务端 409 兜底 | `P4WritingView.tsx:116`、`PipelinePage.tsx:514` |
| U9 | medium | 写操作后的 `refresh()` 撞上在飞轮询会静默返回 null | `usePipeline.ts:102` |
| U12 | medium | 4 个错误码缺文案，不可重试的原因被说成「可以重试一次」 | `format.ts:126-265` |
| U13 | medium | 审阅队列切换单元前不 flush 未保存正文（丢字 + 写错单元） | `StudioPage.tsx:265-317`、`:488-495` |
| U14 | medium | 无跨幕/跨节拍组移动节拍的入口（UX-SPEC §5 未落地） | `P2OutlineView.tsx:130-150`、`ItemCard.tsx`、`actions.ts:321-329` |
| U15 | medium | 快照请求无超时 + `inFlight` 永久闩锁 → 界面永久停旧且无提示 | `usePipeline.ts:72-75`、`:102`、`:128-131` |
| U18 | medium | 关键路径零覆盖：跳过 / 修订恢复 / 中断续写 / 人工通过 / 跳过章 / 锁定 / 导出 | `scripts/ui-test.mjs`（grep 计数 0） |
| U19 | medium | 「重试」语义与文案不一致，失败路径不走续跑 | `PipelinePage.tsx:590-592`、`:800-803`、`:833-836`；`NextStepCard.tsx:8` |
| U6 | low | 已确认时间硬编码 `null`，永不显示 | `PipelinePage.tsx:855` |
| U7 | low | `interrupted` 任务的进度条渲染成 `data-state=done` | `JobBar.tsx:23`、`:60` |
| U8 | low | 死变量 `stageKey`；`throw new Error('保存失败')` 丢结构化错误 | `PipelinePage.tsx:219-222` |
| U10 | low | 应用字数档串行 patch，无 catch：部分生效无提示 | `PipelinePage.tsx:379-396` |
| U11 | info | 锁定阶段仍可点进去，确认才由后端 409 兜底 | `StageRail.tsx:43-63` |
| U17 | low | 数字字段 `Number(value) || 0` 把空值写成 0 | `ItemCard.tsx:175` |
| U20 | low | 剧本作品可直接打开 `/pipeline`，无类型守卫 | `App.tsx:67` |
| U21 | low | 迁移横幅压过中断横幅；回退按钮不在前端二次确认 | `PipelineBanner.tsx:69-139` |
| U22 | low | 审阅一次连发两次 `units()` 请求 | `StudioPage.tsx:290-292` |
| U23 | low | ErrorCard 主按钮两个分支完全重复（死代码） | `ErrorCard.tsx:43-47` |
| U24 | low | `!snapshot` 兜底是纯空白页（无文案、无返回入口） | `PipelinePage.tsx:632` |

---

## 一、正向结论（先说成立的部分，避免把「能跑」当「正确」，也避免把「正确」当缺陷）

### 1.1 「新建 + AI 企划」点击后加载/成功/失败/取消都有可见结果（验收 ③ 通过）

- 弹窗只在长篇/短篇显示 `#np-ai-plan`，默认勾选：`software/src/client/components/NewProjectModal.tsx:233-244`、`:38`。
- 预检行三态（loading / ok / error）带 `data-state`、`data-code`：`NewProjectModal.tsx:246-268`。
- 提交前先预检，预检不通过**不创建作品**：`NewProjectModal.tsx:160-175`（`setPhase('edit')` + `new-project-error` + toast）。
- 创建中：按钮 `disabled` 且文案切「正在创建…」，关闭被拦并有 toast：`NewProjectModal.tsx:297-311`、`:87-93`。
- 成功：`toast('已创建，AI 正在企划')` + `navigate('/project/:id/pipeline')`：`NewProjectModal.tsx:123-150`。
- 失败：`phase='failed'` + `new-project-error`（带 `data-code`）+ toast，且 `requestId` 复用避免「以为没建其实建了」：`NewProjectModal.tsx:140-149`、`:124`、`:44`。
- 幂等与服务端起跑：`api.ts:194-216` 带 `Idempotency-Key` 且 body `start:'pipeline'`；`software/src/server/pipeline/create.ts:65-79` 建库后立刻 `startJob({stageKey:'p1'})`；重放返回 `replayed:true`（`create.ts:57-63`，`index.ts:118` 回 200）。→ **AI 企划不需要用户再点一次**，R1/R2 类「点了没反应」在产品路径上已被移除。
- 取消：`plan-cancel` → `JobBar` 取消 → 阶段回 `empty`，随后出现 `plan-delete`：`PipelinePage.tsx:806`、`:715-738`；`ui-test.mjs:177-185` 有真实点击断言（含删除后不留孤儿）。
- 无空 catch：写操作统一走 `run()`（`PipelinePage.tsx:119-147`），失败必置 `actionError` + toast；唯二例外见 U3/U10。

### 1.2 阶段导航是 AI-first，不是聊天框

- 「下一步」完全由服务端 `snapshot.nextStep` 驱动，前端只渲染文案与动作：`NextStepCard.tsx:21-63`、`PipelinePage.tsx:550-605`；`HINTS` 覆盖 15 种 kind。
- 阶段轨道 + 徽标 + 生成中耗时：`StageRail.tsx`；作业条 `plan-progress` 带 `data-state/data-step/data-elapsed` 且秒数只进不退：`JobBar.tsx`。
- 页面没有自由文本框聊天入口；写作台仍保留旧的「AI 企划这一本」逐条审核链路（`ui-test.mjs:458-469`），旧路径没有被新流程劫持（`ui-test.mjs:444-456`）。

### 1.3 每阶段可编辑 / 可反馈重生成 / 可确认

- P1：世界观 1 条 + 环境 + 人物，条目卡支持原地编辑保存、删除、上下移、锁定、修订历史、条目级反馈与块级重生成：`ItemCard.tsx`、`P1SettingView.tsx:69`（`readOnly = status === 'generating'`）。
- P2：幕/节拍组两级 + 新增幕/新增节拍 + 组级重生成 + 组级反馈：`P2OutlineView.tsx`。
- P3：表格编辑（标题/功能/大纲/字数三档/排序/锁定）、章数增减预览与「只删空白章」、Σtarget 偏差 >25% 时确认按钮 `blocked` 且必须显式「接受偏差」：`P3PlanView.tsx:172-173`、`:241`、`:287-319`；与后端 `blockersOf` 的偏差门槛一致。
- P4：连续写作 + 暂停（写完本章停）+ 立即停止（二次确认）+ 断点「继续」+ 单章重写 + 审阅入口：`P4WritingView.tsx`；审阅在写作台完成（D5 四键唯一），队列四键 + 版本列表齐全：`StudioPage.tsx:1064-1116`。

### 1.4 短篇不出现章节分支 / 旧项目可打开

- 短篇 `chapter-plan-row`、`chapter-row` 恒 0，节拍板条数 = 计划条数，`ui-test.mjs:412-442` 真断言。
- 写作台对短篇用 `readBeatBody` 只读预览 + `beat-preview`，不 PATCH 不存在的章节：`StudioPage.tsx:1199-1204`。
- 旧作品仍进写作台（`ui-test.mjs:444-456`），迁移入口在横幅（`PipelineBanner.tsx:69-116`）。

### 1.5 刷新后阶段与内容不丢

- `ui-test.mjs:406-410` 刷新后仍有 5 行章节板且 `stage-p3[data-status=confirmed]`。
- 断点续写由服务端 `interrupted` + `plan-continue` 承载（`PipelineBanner.tsx:118-139`）；**但 UI 侧零覆盖，见 U18。**

---

## 二、medium findings

### U1 流水线页没有任何可用的导出入口，唯一分支打开不存在的 URL

- 位置：`software/src/client/pages/PipelinePage.tsx:599-601`
  ```ts
  case 'export':
    window.open(`/api/projects/${projectId}/export/markdown`, '_blank');
  ```
- 问题：后端只有 `software/src/server/index.ts:446` 的 `GET /api/projects/:id/export` 与 `:411` 的 `/export.docx`，**没有 `export/markdown`**（全仓 grep 只命中这一处客户端代码）→ 点击必 404。
- 更严重的是这段代码根本不可达：`software/src/client/components/pipeline/NextStepCard.tsx:32` `const showButton = nextStep.kind !== 'export';` 不给 `export` 渲染按钮（README 的 `HINTS.export` 文案「可以导出成稿」照常显示），而 `nextStepAction` 只由该卡片的 `pipeline-next-action` 调用（`PipelinePage.tsx:840`）→ **全书写完的终态在流水线页看不到任何导出按钮**，用户只能自己摸到写作台（`software/src/client/api.ts:135` 的 docx 下载）。
- 触发条件：长篇/短篇在流水线页走到 `nextStep.kind === 'export'`。
- requiredFix：把 `showButton` 的 `export` 例外去掉，`case 'export'` 改走 `api.downloadFile('/api/projects/:id/export.docx', '作品.docx')`（与写作台同一入口，index.ts:452 的 hasBody 守卫会给出可读错误），或后端补 `export/markdown` 路由；补一条 `pipeline-next-step[data-kind="export"]` 的点击测试。

### U2 p2/p3 也给了「跳过…我自己写」，后端只允许 p1

- 位置：`software/src/client/components/pipeline/StageConfirmBar.tsx:61-90`（`stage-skip` → `stage-skip-confirm` 无条件渲染）；`PipelinePage.tsx:861-872` 把 `onSkip` 传给所有非 p4 阶段。
- 问题：`software/src/server/pipeline/actions.ts:185` `if (stageKey !== 'p1') fail('BAD_REQUEST', '只有设定阶段可以跳过')` → 在 p2/p3 点跳过必失败，弹错误卡，且 `ErrorCard` 主文案只显示 `errorCopy('BAD_REQUEST').title`（`format.ts`），用户看不到「只有设定阶段可以跳过」（message 只进技术详情，`ErrorCard.tsx`）——典型的「点了没反应还看不懂」。
- 触发条件：p2/p3 点「⋯ → 跳过本阶段，我自己写 → 确认跳过」。
- requiredFix：`StageConfirmBar` 增加 `canSkip` prop，只在 `stage === 'p1'` 渲染跳过菜单；或后端放开 p2/p3 的 skip 并定义语义（下游如何解锁）。补测试（当前零覆盖，见 U18）。

### U3 章节排序 / 接受偏差失败时零反馈（unhandled rejection）

- 位置：`software/src/client/components/pipeline/P3PlanView.tsx:68` `void onReorderUnits(ids);`，`:295` `onClick={() => void onAcceptDeviation(true)}`，`:315` 撤回同理。
- 页面侧对应实现没有 catch：`PipelinePage.tsx:490-494`（`onAcceptDeviation` 直接 `await pipelineApi.acceptDeviation`）、`:501-505`（`onReorderUnits` 直接 `await pipelineApi.reorderUnits`）。
- 问题：任一请求失败（409 CONCURRENT_JOB / 400 非法排序 / 500）都变成 unhandled promise rejection：界面无变化、无 toast、无错误卡，只有 DevTools 控制台一行红字。与 `run()` 的约定（`PipelinePage.tsx:118` 注释「必须有失败反馈，禁止空 catch」）直接矛盾。
- 触发条件：生成中（后端并发 409）或排序 id 集合不合法时点 ↑/↓、点「接受偏差」。
- requiredFix：两端都收进 `run()`，或在这些回调里 `try/catch → setRowError / toast`。补一条「生成中排序失败要看到提示」的测试。

### U4 清空字数输入框静默无效

- 位置：`software/src/client/components/pipeline/P3PlanView.tsx:91-93`（`const min = draft.minWords ?? unit.minWords` 等）与 `:425-432`（onBlur 的 `changed` 判定）。
- 问题：`numberOrNull('')` 返回 `null` → `null ?? unit.minWords` 落回旧值；onBlur 里 `min !== unit.minWords` 也为 false → **不发请求、不提示，输入框显示回旧值**。用户以为「清空 = 用默认值/不设限」，实际什么都没发生。
- 触发条件：把某一章的最少/目标/最多字数删空后离开输入框。
- requiredFix：清空应显式映射为「不设该字段」（`undefined`）并 PATCH；若后端不接受，就在输入框 `aria-invalid` + 行内提示「这一项不能为空」。补测试。

### U5 章节计划未确认时「开始写作」可点，只有服务端 409 兜底

- 位置：`software/src/client/components/pipeline/P4WritingView.tsx:116` `disabled={busy || units.length === 0}`；`PipelinePage.tsx:512-527` 传给该组件的 `status` 是 **p4** 自己的状态（`:514`），拿不到 p3 是否 confirmed。
- 问题：p3 还是 `review` 时按钮可点，点下才由后端 `actions.ts:255-256` 的 `STAGE_LOCKED` 弹错误卡。这与同轮修好的 DEF-14（禁用 + `*-hint` 说明原因）范式不一致；验收项「章节计划确认前不能开始逐章生成」在界面上没有任何表达。
- 触发条件：p3 未确认 → 切到 p4 → 点「开始连续写作」。
- requiredFix：把 `snapshot.stages.p3.status === 'confirmed'`（或 `nextStep.kind !== 'start-writing'`）传进 P4WritingView，`disabled` + `write-start-hint`「先确认章节计划」。补测试（当前没有任何「未确认 p3 点开始」的用例）。

### U9 写操作后的 `refresh()` 撞上在飞轮询会静默返回 null

- 位置：`software/src/client/hooks/usePipeline.ts:99-103`
  ```ts
  if (inFlight.current) return null;
  ```
- 问题：`running` 阶段轮询间隔 2s（`:28`），一次快照 + 三份详情往返可能与之重叠；`run()`（`PipelinePage.tsx:131`）在写操作成功后 `await pipe.refresh({ details: true, silent: true })`，若此时 `inFlight` 为 true 则**立即返回 null 且不发请求**——确认/删除/排序后的界面最多要等一个轮询周期才更新，用户看到的是「点了没变化」。
- 触发条件：在 `running/queued/pausing` 阶段（2s 轮询）执行任意写操作。
- requiredFix：`inFlight` 时排队一次（`pendingRefresh = true`，在 `finally` 里补跑），或对 `refresh()` 用独立的请求通道；另 `refresh` 默认 `details:true`（`:173-176`）让每次写操作固定多发 3 个 GET，建议写操作后只刷快照、签名变化时再拉详情。

### U12 4 个错误码缺文案，不可重试的原因被说成「可以重试一次」

- 位置：`software/src/client/lib/pipeline/format.ts:126-253`（`ERROR_COPY` 表）与兜底 `:255-265`。
- 缺失：`TARGET_EDITED`、`ITEM_LOCKED`、`MIGRATION_CHECK_FAILED`、`IDEMPOTENT_REPLAY`。它们在后端都有真实语义与触发路径：`software/src/server/pipeline/types.ts:40-46`（码表）、`actions.ts:619/626/635`（ITEM_LOCKED）、`actions.ts:943`（TARGET_EDITED）、`legacy.ts`（MIGRATION_*）。
- 后果：用户手动改过字数后再点「按目标分配」、或删一条已锁定条目时，看到的是兜底文案「出了点问题 / 可以重试一次」，而这两件事**重试一万次也不会成功**——正是本产品被投诉的「点了没反应还不说原因」的同族问题。
- requiredFix：补齐四个码的 title/hint，并把 `retryable` 标成 `false`（`ErrorCard` 据此不渲染「重试」）；兜底文案改成「出了点问题（错误码 X）」以便用户报障。

### U13 审阅队列切换单元前不 flush 未保存正文（丢字 + 写错单元）

- 位置：`software/src/client/pages/StudioPage.tsx:265-317`（`runReview`），配合 `:488-495`（`scheduleSave` 800ms debounce）、`:380-381`（`saveNow` 在调用时读 `activeRef`）、`:464`/`:479`/`:501`（只有关窗、Cmd+S、切章时清 timer）。
- 问题：`runReview` 通过、退回、跳过、人工通过之后直接 `reloadProject()` 并把 `activeRef.current` 换成下一单元（`:304-309`），**既不清 `saveTimer` 也不 `await saveNow()`**：
  1. 刚敲的字（不足 800ms）永远不会 PATCH，被 `reloadProject()` 的返回值覆盖 → 丢字；
  2. 残留的定时器在 `activeRef` 已被替换后触发，`saveNow()` 读到的是**新单元**的内容 → 对旧单元一次多余写（`switchChapter` 之所以看起来没这个问题，是因为它在 `:501` 清了 timer）。
- 触发条件：在被审章节里改字后 800ms 内点「通过 / 退回 / 跳过 / 人工通过」。
- requiredFix：切换前 `if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; } await saveNow();`，失败则中止切换并提示。补一条「改字后立刻通过，字要落库」的测试。

### U14 无跨幕/跨节拍组移动节拍的入口（UX-SPEC §5 未落地）

- 位置：`software/src/client/components/pipeline/P2OutlineView.tsx:130-150`（只有 `onMoveGroup` / `onMoveBeat` 同级上下移）；`PipelinePage.tsx:322-331`（`onMoveBeat` 只在同一 group 的 id 列表内换位）。
- 后端也不支持：`software/src/server/pipeline/actions.ts:321-329` 的 `ITEM_FIELD_WHITELIST.beat` 只有 `title/summary/function/plannedChapters/foreshadow`，没有 `actId`/`groupId` → 用 `patchItem` 也搬不动。
- 后果：节拍放错幕时，用户只能删掉重建（`summary` 全丢）并触发下游 p3/p4 stale；UX-SPEC §5「重排与跨幕移动」在实现里没有对应能力。
- requiredFix：要么在 P2 给每个节拍一个「移动到…」菜单（调用 `reorderItems` 时带上目标 group），要么在文档里明确降级并去掉 UX-SPEC 的承诺；两条都要有测试。

### U15 快照请求无超时 + `inFlight` 永久闩锁 → 界面永久停旧且无提示

- 位置：`software/src/client/hooks/usePipeline.ts:72-75`（`signal()` 只复用 `abortRef`，**只在组件卸载时 abort**）、`:102`（`if (inFlight.current) return null`）、`:128-131`（`finally` 复位，但进不到 `finally` 就意味着永远锁住）。
- 问题：`/api/projects/:id/pipeline` 若挂起（服务端卡在生成、半开连接、系统挂起后恢复），`inFlight` 永久为 true：此后轮询与 `refresh()` 全部**静默返回 null**，`failures` 不增长 → `offline` 永不置位（`:124-126`）→ 用户看到的是一个永远不更新的页面，且「与后台失去联系」的降级提示也不会出现。这类「界面卡住但什么都不说」的体验正是 R1/R2 要消灭的形态。
- 触发条件：任一次快照请求长时间不返回（不是失败，是不返回）。`ui-test` 只测了刷新，没有测这个。
- requiredFix：给 `pipelineApi.snapshot/items/units` 的 fetch 加 `AbortSignal.timeout(15000)`（或 `Promise.race`），超时视为 `NETWORK` 失败并计入 `failures`；`inFlight` 的复位放进 `finally` 之外再加一层保险；`refresh()` 在 `inFlight` 时排队一次（与 U9 同一处修）。

### U18 关键路径零覆盖：跳过 / 修订恢复 / 中断续写 / 人工通过 / 跳过章 / 锁定 / 导出

- 证据（对 `software/scripts/ui-test.mjs`、`api-test.mjs`、`qa-e2e-{api,ui,r4}.mjs` grep testid/关键词计数）：

  | 路径 | 出现次数 | 说明 |
  | --- | --- | --- |
  | `stage-skip` / `stage-skip-confirm` | 0 / 0 | 阶段跳过全仓零覆盖（且 U2 会让 p2/p3 必失败） |
  | `item-history-restore` | 0 | 修订历史**只测了打开抽屉**（`ui-test.mjs:260-266`），恢复按钮从未点击；而后端 `restoreItemRevision` 对章节计划恒 500（后端评审 F1）——UI 侧完全测不出 |
  | `plan-continue` | 0 | 中断恢复横幅零覆盖；「刷新恢复」只证了 `page.reload()`，没证进程重启/interrupted |
  | `chapter-manual-approve` / `chapter-skip` | 0 / 0 | 审阅四键只测了「通过」 |
  | `chapter-request-changes` | 1（仅 `isVisible()`，`ui-test.mjs:387`） | 从未点击，退回→重写→再生成闭环未验证 |
  | `chapter-plan-lock` | 0 | 锁定章节计划无覆盖 |
  | `pipeline-next-step[data-kind="export"]` | 0 | 导出（U1）无断言 |
  | `write-stop` | 1（`qa-e2e-ui.mjs`） | 主测试套件里零覆盖「立即停止」的二次确认与丢弃语义 |

- 结论：35 条 UI PASS 覆盖了 happy path（创建/预检/取消/失败重试/P1–P4/刷新/短篇/旧项目/stale），但**失败与恢复路径基本没测**，与验收「UI 测试覆盖关键路径而不是只测渲染」只算部分达成。测试本身是真交互（`ui-test.mjs:369-397` 点完写作还回查 `/api/projects/:id/units` 的 `reviewStatus`），这一点是达标的。
- requiredFix：至少补 5 条——① p3 未确认点开始写作（U5）；② 生成期间排序失败要看到提示（U3）；③ 改字后立即通过不丢字（U13）；④ 修订恢复（章节计划，会直接暴露后端 F1 的 500）；⑤ 进程 SIGKILL 后 `plan-continue` 续写。

### U19 「重试」语义与文案不一致，失败路径不走续跑

- 位置：
  - `software/src/client/pages/PipelinePage.tsx:590-592` `case 'retry-failed': selectStage(next.stage || stage); return;` —— **只切阶段，不重试**；
  - `NextStepCard.tsx:8` `'retry-failed': '上一次生成失败了，重试会从失败的那一步接着来。'`，按钮文案取 `nextStep.label`（`:58`）——文案与行为相反；
  - `PipelinePage.tsx:800-803`（横幅 `onRetryError`）与 `:833-836`（阶段错误卡 `onRetry`）都调 `generate(stage)` / `startWriting()` → `POST /pipeline/start` 会让后端按 `planStepsForStage` **从第一步重来**（`actions.ts:217-249`），而不是续跑；
  - 后端的续跑能力 `resumeStepsFor`（`software/src/server/pipeline/runner.ts:285-296`，按 `plan.slice(step_index)`）对应的 `retryJob` 接口，在前端只被 `continueWriting` 的兜底用到（`PipelinePage.tsx:347-362`），**失败重试从未使用**。
- 后果：p3 有 20/30 两批时，第 2 批失败后点「重试」会把第 1 批也重做（与后端 F2 的批量多删叠加，可能吃掉已生成的计划）；p1/p2 重来还会触发破坏性删除。用户以为「接着来」，实际「从头再来」。
- requiredFix：`retry-failed` 分支调 `pipelineApi.retryJob(projectId, lastJob.id)`（后端已支持从 `step_index` 续跑），错误卡的「重试」同改；只有在没有可续 job 时才退回 `generate(stage)`，并在文案里区分「继续未完成的部分 / 整份重来」。

---

## 三、low findings

- **U6 已确认时间永不显示**：`PipelinePage.tsx:855` `confirmedAt={null}` 硬编码，而 `software/src/shared/pipeline.ts:209` 的 `StageView.confirmedAt` 有值；`StageConfirmBar.tsx:44` 已经实现了「已确认 · HH:MM」分支，永远走不到。
- **U7 中断任务的进度条渲染成 done**：`JobBar.tsx:23` 把 `interrupted` 映射成 `'done'`，`:60` 的 `stateOf(job, false)` 第二参恒为 false（该分支是死代码）→ 中断任务的 `data-state=done`，与真实语义相反（页面别处的「中断」横幅是对的）。
- **U8 死变量 + 丢结构化错误**：`PipelinePage.tsx:219-220` `const stageKey = …; void stageKey;`；`:222` `if (!ok) throw new Error('保存失败')` 把 `PipelineRequestError` 的 code/blockers 丢掉，`ItemCard` 只能显示原始 message（其他写操作都走 `actionError`）。
- **U10 应用字数档部分生效无提示**：`PipelinePage.tsx:379-396` 串行 `patchUnit`，只有 `finally` 清 `presetText`，中途失败会留一半已改一半未改，且没有汇总提示（`P3PlanView` 的 catch 只把错误渲染成行内文本）。
- **U11 锁定阶段仍可点进**：`StageRail.tsx:43-63` 只渲染状态不做禁用；点进去后确认才由后端 409 兜底。建议 `disabled` + `title` 说明（与 U5/U2 同一族）。
- **U17 数字字段把空值写成 0**：`ItemCard.tsx:175` `Number(value) || 0` → 清空「年龄/计划章数」会变成 0 并落库（与 U4 同源，都是「空 ≠ 0」）。
- **U20 剧本作品可直接打开 `/pipeline`**：`App.tsx:67` 的 pipeline 路由没有 `StudioRoute` 那样的类型守卫（`App.tsx:18-24` 只拦写作台）；剧本作品进流水线页会看到「生成设定」等入口，逻辑上应由后端拒绝，但界面没有前置说明。
- **U21 横幅优先级与确认**：`PipelineBanner.tsx:69-139` 迁移横幅优先于中断横幅（「已升级 + 有中断写作」只显示回退入口）；回退按钮直接调 `rollbackMigration(projectId,'sql')`（`api.ts` 固定 `confirm:true`），前端无二次确认（`PipelinePage.tsx:770-781` 有自定义弹窗，但 Banner 自带的回退按钮没有）。
- **U22 审阅一次连发两次 units 请求**：`StudioPage.tsx:290-292` 连续两次 `pipelineApi.units(project.id)`（第二行覆盖第一行），多余一次往返。
- **U23 ErrorCard 重复分支**：`ErrorCard.tsx:43-47` 两个 `onRetry && canRetry` 分支代码完全相同（复制粘贴残留）。
- **U24 快照为空时是纯空白页**：`PipelinePage.tsx:632` `if (!snapshot) return null;` —— 与 `:619-630` 的 ErrorCard 分支相比，任何「加载已结束、无 error、快照为空」的路径都会渲染一张什么都没有的页面（无文案、无「回作品库」）。验收③要求「不导航到空白页」，建议兜底渲染 ErrorCard/空态卡 + 返回入口。

---

## 四、验收项判定

| # | 验收标准 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 逐文件审查前端阶段工作台，不以截图代替流程正确 | **pass** | 通读 `PipelinePage.tsx`(944)、13 个 `components/pipeline/*`、`hooks/usePipeline.ts`、`lib/pipeline/{http,api,format}.ts`、`NewProjectModal.tsx`、`StudioPage.tsx` 审阅部分、`App/AppShell/Rail`、`scripts/ui-test.mjs`；所有结论均回读后端契约核对 |
| 2 | findings 带 file:line、问题、requiredFix | **pass** | 见上 23 条 |
| 3 | 新建 + AI 企划点击后加载/成功/失败/取消都有可见结果，无空 catch、不导空白页 | **pass（有 1 条 low）** | 1.1 全链路；`run()` 统一错误出口；预检不落空壳；取消后可删除孤儿（`ui-test.mjs:142/185/216`）；low 兜底见 U24 |
| 4 | 每阶段内容可编辑、可反馈重生成、可确认 | **pass（有保留）** | 1.3；保留项：U14 跨幕移动缺失、U2 p2/p3 跳过入口是死键 |
| 5 | 章节计划确认前不能开始逐章生成 | **partial** | 服务端强制成立（`actions.ts:255-256`），界面未禁用且无原因（U5），且该路径零测试 |
| 6 | 短篇无章节分支、旧项目打开、长任务刷新恢复真实可用、UI 测试覆盖关键路径 | **partial** | 短篇/旧项目/刷新 pass（1.4/1.5）；中断续写 `plan-continue` 零 UI 覆盖、失败/恢复路径无测试（U18），`fetchSnapshot` 无超时会让「恢复」变成永久停旧（U15） |

---

## 五、我明确没有验证 / 无法验证的部分（避免下游把「没测」当「没问题」）

1. **真实模型/provider 的 UI 路径**：`ui-test.mjs` 用本地假 OpenAI 兼容服务（`:342-364`）与内置 mock；reasoning 降级、429 重试、超时（`PW_STEP_TIMEOUT_MS`）在 UI 层没有任何断言，只有后端代码可读。
2. **桌面端（Electron）内的实际表现**：`window.inkquayDesktop` 关窗守卫（`App.tsx:31-40`）与 `closeGuard` 只做了代码审查；关窗时若有未保存正文/正在生成，行为未实测。
3. **多标签页/多实例并发**：`usePipeline` 的轮询与 `StudioPage` 的自动保存没有跨页协调，两个标签同编一章的行为未测。
4. **无障碍**：只核对了 `aria-live`/`aria-current`/`aria-describedby` 的存在，没有用读屏实测。
5. **样式/视觉**：按要求不以截图判断；`pipeline.css` 1167 行未逐条评审（不在功能验收范围）。
6. **后端缺陷对 UI 的连带影响**（如章节计划修订恢复 500、短篇导出 400）只在后端报告 `REVIEW-BACKEND.md` 里定性，未在本报告中重复计数。

---

## 六、给 backend / pm 的越界提醒（只提一次，不在本报告范围）

- 前端「重试」想续跑，依赖后端的 `retryJob` 语义（`runner.ts:285-296`）在 p1–p3 上可用；请 backend 在修 F2（批量多删）时一并确认 `resumeStepsFor` 对 p3 批次的可续性，否则 U19 修完仍可能从头再来。
- U1 的修法二选一（前端改走 `export.docx` 或后端补 markdown 路由）需要 pm 定；若补后端路由，`index.ts:452` 的 `hasBody` 守卫对短篇流水线作品仍会 400（后端 F10），导出对短篇仍不可用。

---

## 七、评审产物与清理

- 本文件：`team/inkquay-ai-first/REVIEW-FRONTEND.md`（唯一新增文件）。
- 未改动 `software/src/`、`software/scripts/`、`desktop/`；未 commit / push；未起后台服务、未留临时文件（本轮只读代码与脚本）。
- 造数据/探针：本轮无（后端评审的探针脚本在 `team/inkquay-ai-first/evidence/backend-review-*.mjs`，与本轮无关）。
