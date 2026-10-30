# REVIEW-FRONTEND-ROUND2 — t22 独立复验（复审 t21 repair-round-2）

- 评审对象：工作树（branch `main`，HEAD `ae75612`）中 t21 对前端流水线的修复；`software/src/` 的流水线文件全部**未跟踪**，无 git 历史可 diff，评审依据是当前字节（复核时 `PipelinePage.tsx` mtime 13:38、`P4WritingView.tsx` 13:23、`usePipeline.ts` 13:34、`format.ts` 13:19、`ui-test.mjs` 13:23，均早于本次复验，未被后续改动覆盖）。
- 评审方式：**逐条 grep + 通读**当前代码验证 t21 自述的 23 条修复（不采信自述、不看截图）；独立跑 `pnpm typecheck` / `pnpm test` / `pnpm test:ui`；交叉回读后端契约确认前端调用的 URL、错误码、语义与后端一致。
- 范围：`software/src/client/**`、`software/scripts/ui-test.mjs`（只读）；未改动任何业务代码，未 commit / push。交付物本文件（+ 前一轮 `REVIEW-FRONTEND.md`）。

## 结论

**verdict = pass**

t9 的 23 条 findings 里 **18 条已确认修好**（代码字节可证、且多数有真实点击测试守门），**4 条为「修得比原来窄」的残留**（U5/U6/U9+U15/U12，最高 low），**1 条是诚实的能力降级**（U14 跨幕移动：明说不支持并给替代做法，不是假按钮）。上一轮判定阻塞整个交付的三条「用户以为做了、其实没做」的静默失败（U1 导出不可达、U3 排序/偏差 unhandled rejection、U13 审阅切章丢字）都已真正修好，并且新增的 E2E 能守住（导出真下载 `.md`、注入 409 后行内报错、改字后立刻切篇再回服务端查正文）。

按验收六条逐条判定：①逐文件审查 ✅ ②findings 带 file:line ✅ ③新建+AI 企划四态可见、无空 catch、无空白页 ✅ ④每阶段可编辑/可反馈重生成/可确认 ✅ ⑤章节计划确认前不能开始逐章生成 ✅（主按钮禁用+说明，服务端 409 兜底；行内「立即写本章」是残留 R1）⑥短篇无章节分支/旧项目可用/刷新与崩溃恢复真实可用/UI 测试覆盖关键路径 ✅。

残留 5 条（R1–R5，全部 low）建议作为**收尾补丁**处理，不需要再开一轮 review 卡住交付：

| id | 级别 | 一句话 | 位置 |
| --- | --- | --- | --- |
| R1 | low | 行内「立即写本章」未受 planConfirmed 约束（主按钮已修） | `P4WritingView.tsx:263-272` |
| R2 | low | 「已确认」时间显示的是阶段行 `updated_at`，非确认时刻 | `PipelinePage.tsx:947` |
| R3 | low | 详情请求（3 个 GET）仍无超时：挂起时 `inFlight` 仍永久闩锁 | `usePipeline.ts:95-107`、`:138` |
| R4 | low（文档） | 跨幕移动节拍 V1 未实现，UX-SPEC §5 承诺未登记为偏差 | `P2OutlineView.tsx:39-42`、`:160-186` |
| R5 | low | 仍有 5 个后端错误码无专属文案（其中 `NOT_MIGRATABLE_EMPTY` 可达） | `format.ts:254-284` |

## 一、24 条 findings 逐条复验

### 1.1 已确认修好（18 条，代码字节 + 测试守门）

| id | 复验依据 |
| --- | --- |
| U1 导出不可达 | `lib/pipeline/api.ts:132-133` 新增 `downloadProjectMarkdown` 指向真实路由 `GET /api/projects/:id/export`（后端 `server/index.ts:446`）；`PipelinePage.tsx:659` `case 'export'` 调它；`NextStepCard.tsx:32-56` 删掉 `showButton = kind !== 'export'` 例外，export 时按钮降级为 ghost 但仍渲染。E2E `ui-test.mjs:503-524` 用 `waitForEvent('download')` 断言文件名 `/\.md$/i`。 |
| U2 p2/p3 跳过死键 | `StageConfirmBar.tsx:42` `const canSkip = stage === 'p1';`，`:66`（菜单项）与 `:94`（⋯ 触发）都以 canSkip 为条件。E2E `:428` 断言 p3 `stage-skip` count=0、`:609` 断言 p1 count=1。 |
| U3 排序/偏差 unhandled rejection | `P3PlanView.tsx:78` `reorderBusy`、`:79-97` `moveUnit` 改 async 并 catch → `setLocalError('排序失败：…')`、`:375` 渲染 `data-testid="chapter-plan-error"`；`:335`/`:364` 接受/撤回偏差都加 `.catch(...)`。E2E `:453-454` 用 route 注入 409 后断言行内文案。 |
| U4 清空字数静默无效 | `P3PlanView.tsx:38-42` `resolveWords()` 用 `hasOwn` 区分「没动」与「清空」；`:118-156` `patchRow` 汇总 problems（留空/越界/min>target/target>max/target<=0）只写行内错误、不发请求；`:479-489` onBlur 对 `null` 直接写「X字数不能留空（300–20000）」；`:499-500` `data-testid="chapter-plan-row-error"`。E2E `:438-440` 断言含「不能留空」。 |
| U7 JobBar 中断态 | `JobBar.tsx:19-25` `stateOf(job: JobView \| null)` 把 `interrupted` 映射成 `failed`（注释说明「不是完成」），死参数删除，全文件无 `stateOf(job, false)`。 |
| U8 丢结构化错误 | `PipelinePage.tsx:124-152` `run()` 支持 `{ throwOnError }`：先 `setActionError`+toast，再 `throw err` 原样抛出（保留 code/blockers）；`:233-238` `patchItem` 传 `{ throwOnError: true }`；死变量 `stageKey` 与 `throw new Error('保存失败')` 已删。 |
| U10 字数档部分失败 | `PipelinePage.tsx:409-447` 逐条 try/catch 记 `failed[]`，汇总成 `PRESET_PARTIAL`（N 成功 / M 失败 + 前三条原因 + 「再点一次只改没改成的」）并 toast，最后 `throw` 让行内也显示；`finally` 里 `await pipe.refresh(...)`。 |
| U11 锁定阶段可点 | `StageRail.tsx:40-52` `const locked = Boolean(stage?.locked) && !isCurrent;` + `disabled={locked}` + `title="先确认上一阶段，才能进入这里"` + `data-locked`。 |
| U12 错误码缺文案（部分，见 R5） | `format.ts:254-272` 补了 TARGET_EDITED / ITEM_LOCKED / MIGRATION_CHECK_FAILED / IDEMPOTENT_REPLAY，均 `retryable: false`；兜底文案带 code（`:276-284`）。**但仍有 5 个码没补**，见 R5。 |
| U13 审阅切章丢字 | `StudioPage.tsx` `showReviewChapter`：先 `if (saveTimer.current) { window.clearTimeout(...); saveTimer.current = null; }`，再 `const saved = await saveNow();`，保存失败则 `toast('这一篇还没保存成功，先别切走…','warn')` 并 return（不切单元）。`saveNow` 对短篇节拍走「无 chapters 行 → saved=true」，不会 PATCH 404。E2E `:495-501` 改字后点「下一篇」再从服务端 `/api/projects/:id` 断言正文含刚打的标记。 |
| U17 数字空值写 0 | `ItemCard.tsx:174-183` `const raw = String(value).trim(); if (!raw) continue;`（空值不进 payload）；`Number.isFinite` 失败则 `setError('「X」要填数字')` 并 abort。 |
| U19 假重试 | `PipelinePage.tsx:650-660` `case 'retry-failed'` 先 `pipelineApi.retryJob(projectId, job.id)`（后端 `resumeStepsFor` 真续跑），只有它失败才回落 `generate(stage)`；注释写明「只补没做完的步骤」。 |
| U20 剧本作品混进流水线 | `PipelinePage.tsx:54-58` `unsupportedType` + screenplay 直接 `navigate('/project/:id/screenplay', {replace:true})`；`:668-684` 其它不支持的形态渲染 `pipeline-unsupported` 空态并给回写作台入口（不是白屏）。 |
| U21 横幅优先级 / 回退确认 | `PipelineBanner.tsx:85-113` 迁移横幅改 `banners.push(...)`；`:121-139` 中断横幅 `banners.unshift(...)` 后 `return <>{banners}</>` ⇒ 中断优先；回退按钮的二次确认在前端补上（`PipelinePage.tsx:866-875`，「回退这次升级？」，danger）。 |
| U22 重复 units() | `StudioPage.tsx:221` 与 `:291` 各只有一次 `pipelineApi.units(project.id)`。 |
| U23 ErrorCard 死分支 | `ErrorCard.tsx:40-48` 改互斥 `effective` 链（settings → continue → retry），重复分支删除。 |
| U24 空白兜底 | `PipelinePage.tsx:431-447` 新增 `data-testid="pipeline-fallback"`（「暂时读不到这个作品的企划状态」+ 重试 + 返回作品库）。 |
| U18 关键路径零覆盖 | `ui-test.mjs` 新增 9 段真实点击：p3 无跳过键（`:428`）、字数清空报错（`:438-440`）、排序失败提示（`:453-454`）、改字后切篇不丢（`:495-501`）、导出的真下载（`:503-524`）、修订恢复写新修订（`:526-537`）、短篇无 chapter-row（`:552-586`）、p1 保留跳过（`:609`）、计划未确认禁写（`:615-625`）、SIGKILL 重启后续写（`:628-664`）。全文 45 处 `console.log('PASS`。 |

### 1.2 修得比原来窄（残留，见第二节）

- **U5 部分**：主按钮 `write-start`/`write-restart` 已按 `planConfirmed` 禁用并给 `write-start-hint`，**但行内「立即写本章」没有**（R1）。
- **U6 近似**：`confirmedAt` 用 `stageView.updatedAt` 顶替（wire 的 `StageView` 没这个字段），语义漂移（R2）。
- **U9/U15 部分**：快照请求有 15s 超时并排队一次重跑，**但 `loadDetails()` 的 3 个详情 GET 仍无超时**（R3）。
- **U12 部分**：补了 4 条，仍有 5 条缺（R5）。

### 1.3 诚实降级（不算缺陷，但需登记偏差）

- **U14 跨幕移动节拍**：`P2OutlineView.tsx:39-42` 注释说明服务端 `reorderItems` 只接受同组完整排列、beat 白名单无 `actId`/`groupId`；`:160-186` 的「移动到…」只展开一段说明（`beat-move-hint`），明确写「V1 还不支持跨幕移动节拍」，并给出「在目标幕新增节拍抄内容再删」的替代做法。**没有假按钮、没有静默失败**，属于对 UX-SPEC §5 的诚实降级；建议把 §5 的这一条标成 V1 未实现（R4）。

## 二、残留 findings（全部 low，建议随收尾补丁处理）

### R1 [low] 行内「立即写本章」未受 planConfirmed 约束

- 位置：`software/src/client/components/pipeline/P4WritingView.tsx:263-272`
- 问题：`disabled={busy || running}` 只看了通用忙碌态。章节计划（p3）未确认时，`?stage=p4` 仍可直接进入（`StageRail` 只禁用 `locked`，URL 与「下一步」都不拦），章节板会渲染出已存在的计划单元，行内「立即写本章」可点，点下必得 409 `STAGE_LOCKED` 错误卡。U5 修的是顶部 CTA，同一个门槛没有覆盖行内按钮。
- requiredFix：把 `!planConfirmed` 加进该按钮的 `disabled`（并复用 `write-start-hint` 的文案思路，例如 title/`aria-describedby` 指向同一提示）；或当 `!planConfirmed` 时整块章节板只渲染只读视图。

### R2 [low] 「已确认」时间用的是阶段行 `updated_at`

- 位置：`software/src/client/pages/PipelinePage.tsx:947`（消费端 `StageConfirmBar`）
- 问题：`confirmedAt={stageView?.status === 'confirmed' ? stageView.updatedAt : null}`。`StageView` 的 wire 契约里没有 `confirmedAt`，`updated_at` 会在确认之后被 stale 标记、`last_error` 清空、条目编辑等任何阶段行更新推动 ⇒ 显示「已确认 · <某个更新的时刻>」，与真实确认时间无关。
- requiredFix：二选一——① 在 `shared/pipeline.ts` 的 `StageView` 加 `confirmedAt`（由 `stages.confirmed_at` 直出，append-only 不破坏契约），前端只用它；② 若本版不加字段，就把文案改成「最近更新 · …」，不要叫「已确认」。

### R3 [low] 详情请求无超时，`inFlight` 仍可能永久闩锁

- 位置：`software/src/client/hooks/usePipeline.ts:95-107`（`loadDetails`）、`:138`（`await loadDetails(projectId)` 在 try 内、finally 之前）
- 问题：t21 给快照请求加了 `SNAPSHOT_TIMEOUT_MS = 15000`（`:43`、`:122-126`），但 `loadDetails` 里的三个 GET（items p1/p2、units）只挂组件卸载的 `signal`，没有超时。任一个详情请求挂起时，`fetchSnapshot` 卡在 `await` 上，`finally` 不执行 ⇒ `inFlight` 永远为 true、`failures` 不增长、`offline` 不置位，界面停在旧状态且无提示——正是 U15 描述的失效模式，只是从「快照挂起」缩窄成「详情挂起」。
- requiredFix：给 `loadDetails` 的请求也加同一个超时（或把三个 GET 并入快照那次 `AbortController`），超时按 NETWORK 计入 `failures`。

### R4 [low·文档] 跨幕移动节拍仍未实现，UX-SPEC §5 未登记偏差

- 位置：`software/src/client/components/pipeline/P2OutlineView.tsx:39-42`、`:160-186`；文档 `team/inkquay-ai-first/UX-SPEC.md` §5
- 问题：能力本身是**诚实降级**（说清不支持 + 给替代做法），但 UX-SPEC §5 仍把「重排与跨幕移动」当作已设计能力，没有「V1 未实现」的登记，后续 QA 按文档验收会判失败。
- requiredFix：在 UX-SPEC §5 或 DEVIATIONS 里加一行「跨幕移动 V1 未实现（服务端 reorderItems 仅同组；beat 白名单无 actId/groupId），替代做法见 P2 提示文案」，并在 SPEC 的非目标/V1.1 清单里挂上。

### R5 [low] 仍有 5 个后端错误码没有专属文案

- 位置：`software/src/client/lib/pipeline/format.ts:254-284`
- 问题：`format.ts` 的 `ERROR_COPY` 覆盖 34 个码中的 29 个，缺 `NOTE_REQUIRED`、`NOT_MIGRATABLE_EMPTY`、`BACKUP_FAILED`、`DISK_WRITE_FAILED`、`INTERNAL`。其中 **`NOT_MIGRATABLE_EMPTY` 可达**（旧作品什么都没有时点「升级」，后端 `legacy.ts:86` 返回 422），用户看到的是兜底「出了点问题（NOT_MIGRATABLE_EMPTY）… 可以先重试一次」——把一个「这本书没内容可升级」的确定性原因说成可重试。`BACKUP_FAILED`/`DISK_WRITE_FAILED`（`legacy.ts:100`/`:141`）同理。`NOTE_REQUIRED` 因写作台已在前端拦住（`StudioPage.tsx:267`、`:1121`）暂不可达。
- requiredFix：补这 5 条（`NOT_MIGRATABLE_EMPTY` 给「这本还没有可升级的内容」并 `retryable:false`；`BACKUP_FAILED`/`DISK_WRITE_FAILED` 给「本地备份没写成，已取消，请检查磁盘空间/权限」并指向技术详情；`INTERNAL` 与 `NOTE_REQUIRED` 各给一条短文案）。

## 三、6 条验收判定

| # | 验收 | 判定 | 依据 |
| --- | --- | --- | --- |
| ① | 逐文件审查、不以截图代替流程 | **通过** | 13 个流水线组件 + `PipelinePage`/`StudioPage`/`usePipeline`/`http`/`api`/`format` + `ui-test.mjs` 全部按行阅读；每条结论都给了 file:line，未用任何截图作为证据。 |
| ② | findings 带 file:line / 问题 / requiredFix | **通过** | 第一节逐条带坐标；第二节 R1–R5 均为「位置 / 问题 / requiredFix」三段式。 |
| ③ | 新建+AI 企划：加载/成功/失败/取消都有可见结果，无空 catch、不导空白页 | **通过** | `NewProjectModal.tsx:249`（`new-project-precheck` 三态）、`:271`（`new-project-error` + `data-code`）、`:288`/`:305`（创建中文案）、`:89`（创建中关窗被 toast 拦）；`api.ts:194-216` 带幂等键 + `start:'pipeline'`；`create.ts:65-79` 建库即起跑。所有写操作走 `run()`（`PipelinePage.tsx:124-152`），失败必置 `actionError`+toast，**全仓无空 catch**（`void …` 的残留调用已在 U3 里补 catch）；`!snapshot` 兜底为 `pipeline-fallback`（有文案/重试/返回），不再是白纸。取消：`JobBar.tsx:104` `plan-cancel` → 阶段回 `empty` → `PipelinePage.tsx:815` `plan-delete`。 |
| ④ | 每阶段可编辑/可反馈重生成/可确认 | **通过** | P1 `ItemCard` 原地编辑 + 条目/块级重生成 + 意见 + 修订历史 + 锁定（`readOnly = status==='generating'`）；P2 幕/节拍组两级 + 新增/重排/组级重生成 + 意见；P3 表格编辑（标题/功能/大纲/三档字数/排序/锁定）+ 章数增减预览 + 偏差显式接受；P4 连续写作/暂停/立即停止/继续 + 单章重写 + 审阅入口；每阶段 `StageConfirmBar` 确认 + blocker 可点跳转。E2E 覆盖 P1 编辑/历史/意见、P2+P3 编辑、P3 排序。 |
| ⑤ | 章节计划确认前不能开始逐章生成 | **通过（残留 R1）** | 前端主 CTA：`P4WritingView.tsx:128`/`:156` `disabled={… || !planConfirmed}` + `:118-119` `write-start-hint`（「先确认章节计划」），`PipelinePage.tsx:575` 由 `snapshot.stages.p3.status === 'confirmed'` 供给；E2E `:615-625` 断言未确认时 disabled + 提示含「先确认」、确认后可用。服务端兜底：`actions.ts` 起写校验 + 409 `STAGE_LOCKED`。**残留**：行内「立即写本章」未同步（R1），点下得到可见错误卡而非静默。 |
| ⑥ | 短篇无章节分支 / 旧项目打开 / 长任务刷新与恢复 / UI 测试覆盖关键路径 | **通过** | 短篇：`P3PlanView` 走 `beat-plan-row`、`P4WritingView` 走 `beat-row`，E2E `:552-586` 断言 `chapter-plan-row`=0、`chapter-row`=0 且 `beat-row` 数=计划条数；旧项目：E2E `:666-680` 不勾 AI 企划仍进空白编辑器、旧「AI 企划这一本」逐条审核链路保留（`:682-700`）；刷新：E2E 刷新后 5 行 chapter-row + `stage-p3[data-status=confirmed]`；崩溃恢复：E2E `:628-664` 慢供应商拖住写作 → `server.kill('SIGKILL')` → 重启 → 断言 `pipeline-banner[data-state="interrupted"]` 含「中断」→ 点 `plan-continue` → 服务端 `job.state === 'running'`。测试覆盖：上一轮 7 条关键路径零覆盖，本轮新增 9 段真实点击（跳过归属/字数清空/排序失败/切篇不丢字/导出下载/修订恢复/计划未确认禁写/崩溃续写/短篇），不再是只测渲染。 |

## 四、测试证据（本轮独立跑，未采信 t21 自述）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm typecheck`（tsc --noEmit） | **EXIT 0** | `/tmp/r3-typecheck.log` 末行 `EXIT:0`，当前工作树（含前端全部修复）类型自洽。 |
| `pnpm test`（`node scripts/api-test.mjs`，端口 8799） | **失败（非前端范围）** | `/tmp/r3-apitest.log`：`AssertionError [ERR_ASSERTION]: rolling back over new content is refused without confirmation`，断言在 `scripts/api-test.mjs:1216`（该段注释 `// F4：升级后已有新内容时，回退必须显式确认`，由后端 t19 新增）。同一轮里 F1（章节计划修订恢复不再撞嵌套事务，`api-test.mjs:1088-1103`）、F8（生成期间写/删/排序 409 CONCURRENT_JOB，`:1139-1148`）、F9/F10（短篇 reorder 后正文归位、短篇导出 200，`:1187-1209`）都已通过。⇒ 该红属**后端 t19 的在改范围**（回退的 `confirm` 校验顺序），不是本轮前端修复的回归，不构成对 t22 的阻塞。 |
| `pnpm test:ui`（`pnpm build && node scripts/ui-test.mjs`，端口 8798，独占运行） | **46 段 PASS / EXIT 0** | `/tmp/r3-uitest.log`：`grep -c '^PASS'` = 46，末两行 `All UI tests passed.` + `EXIT:0`。覆盖含本轮新增 9 段：`PASS repair: switching review unit saves the edit first`、`PASS repair: export button downloads the manuscript`（真 `waitForEvent('download')` + `/\.md$/`）、`PASS repair: revision restore writes a new revision instead of deleting history`、`PASS repair: p1 keeps the skip action`、`PASS repair: write-start is gated on plan confirmation`、`PASS repair: crash recovery offers plan-continue and resumes writing`（SIGKILL 重启后断言服务端 `job.state='running'`）、短篇节拍段落 `PASS pipeline short story uses beats (no chapter tree)`，以及既有的 cancel/无孤儿、NETWORK 错误卡可重试、P1 编辑+历史、P3 排序、P2+P3 编辑、写作暂停/继续/写作台审阅、刷新不丢、旧作品空白编辑器、旧企划逐条审核。 |

**关于 api-test 红的补充说明（避免下游误读）**：管网关断言 `api-test.mjs:1213-1216` 期望「升级后有新内容 + `confirm:false`」回 409 `CONFIRM_BLOCKED`；当前后端 `legacy.ts` 先判 `!confirm` 回 400 `BAD_REQUEST`（正是 t8 后端评审 F4 指出的「死守卫」顺序问题），t19 正在改。这是**后端**语义，与前端 `api.rollbackMigration`（固定 `confirm:true`）无关。

## 五、未验证项与风险

1. **并发/多进程**：仍是单进程设计（V1 既定），我没有验证两个桌面端实例同时打开同一作品的互斥（超出本轮前端范围，属架构已知边界）。
2. **真实供应商**：E2E 用 mock 与本地假 OpenAI 兼容服务；真实 15 家供应商的 reasoning 降级、长响应超时行为未在本轮复验（后端 t19 在改）。
3. **UI 套件的端口**：`ui-test.mjs`/`api-test.mjs` 用固定端口 8798/8799 + 临时 dataDir，多 agent 并发跑会互相踩端口；本轮已独占运行，日志见 `/tmp/r3-uitest.log`、`/tmp/r3-apitest.log`。
4. **api-test 当前红**属后端 t19 范围（见第四节），前端验收不以它为门槛；集成前需要后端把该断言跑绿。

## 六、结论

- 前端 AI-first 工作台本轮把上一轮所有「静默失败」类问题都修成了「可见结果 + 可重试」，并且**用真实点击测试守住**了其中 9 条关键路径（含崩溃恢复、导出下载、审阅切篇不丢字）。不是改文案敷衍：每条都能在代码里找到对应分支与守卫。
- 残留 5 条全部 low，且都属于「更细的耦合/文案/超时覆盖」层面，不影响用户走完「企划 → 设定 → 大纲 → 章节计划 → 逐章生成 → 审阅 → 导出」的主干流程，也不产生数据丢失或静默失败。
- 因此 **verdict = pass**；建议把 R1–R5 作为收尾补丁排进 t10 之后的清理项（R1/R3 是代码级小改，R2/R4/R5 各一到两行），不需要再开一轮 review 阻塞交付。
