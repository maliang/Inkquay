# DECISIONS · 私家写手第二轮优化（t3 设计决策记录）

基线 `4a43f42`　｜　配套文档：`PLAN.md`（改动契约）、`SPEC.md`（范围与验收）、`AUDIT.md`（问题清单）

本文只记**有备选、需要留痕**的决策。每条给：结论 / 依据（实测优先）/ 被否决的备选 / 代价与风险 / 需谁确认。
标注 🔴 的为**与 SPEC 字面不同、需要 captain 明确认账**的偏差。

---

## D-01 🔴 关窗握手的唯一监听放 `App.tsx`，不放 SPEC 写的 `AppShell.tsx`

**结论**：A5 的 `bridge.onCloseRequest` 挂在 `software/src/client/App.tsx`；`AppShell.tsx` 不改。

**依据（实测，非推断）**
- `grep -rn "AppShell" software/src/client` 命中 5 处：`StudioPage.tsx:825`、`OutlinePage.tsx:191`、`ScreenplayPage.tsx:198`、`CodexPage.tsx:162`、`LibraryPage.tsx:131`。
- **`SettingsPage.tsx` 与 `OnboardingPage.tsx` 完全不渲染 AppShell** —— 而“非写作台关窗卡 5 秒”最刺眼的场景恰恰是设置页（用户改完供应商就关窗）。
- `AppShell` 只是在 `App` 的 `<Routes>` 内部被各页面调用，任何放在 `AppShell` 的 effect 都随页面挂载/卸载，且覆盖不到脱离 AppShell 的两页。

**否决的备选**
1. 挂 `AppShell`（SPEC 原文）：设置页仍走 5s 兜底，等于没修。
2. 每个页面各挂一次：`main.cjs` 里 `closeRequestWindow` 是**单值**，多监听者会先 ack 后保存 → 丢稿风险（比卡 5 秒严重得多）。
3. 改 `preload.cjs` / `main.cjs`：本轮冻结桌面主进程，避免与发版链路纠缠。

**代价与风险**
- 需要一个进程内单例注册表（`src/client/lib/closeGuard.ts`，约 25 行）。它是唯一“新模块”，评审需确认无全局状态泄漏（`registerCloseGuard` 返回卸载函数；`closeGuardCount()` 供断言）。
- App.tsx 的 effect 必须放在早退 `return` 之前（hooks 顺序），实现时注意。

**需确认**：captain 认账“SPEC 写的 AppShell 换成 App.tsx”。

---

## D-02 🔴 路由守卫只守 `/project/:id`（studio），**不**守 `/outline`、`/codex`

**结论**：`App.tsx` 里抽 `StudioRoute`，仅当 `projects.find(...).type === 'screenplay'` 时 `<Navigate replace to=".../screenplay">`；大纲页与设定页对剧本保持可访问。

**依据**
- `OutlinePage.tsx:163` 与 `CodexPage.tsx:143` 的顶栏 tab 含「大纲 / 设定」；`ScreenplayPage.tsx:168` 的 tab 是「剧本 / 大纲 / 设定」，两者互为入口。
- 若把 `/outline`、`/codex` 也按类型重定向回 `/screenplay`，剧本用户点「大纲」会被弹回剧本页 —— **tab 死循环**，比原来的问题更糟。
- SPEC 的原始缺陷（H-4′）就是“剧本项目落进章节写作台（目录 0 章、可新建章节）”，只有 studio 路由需要拦。

**否决的备选**：在 `OutlinePage`/`CodexPage` 里按类型切 tab href（改动面更大，且不解决手输 URL）。

**代价**：剧本从大纲页点「正文」tab（`OutlinePage.tsx:163` 硬编码 `/project/:id`）会先命中守卫再被替换到 `/screenplay`，多一次 replace 导航，可接受；`ui-test` 断言最终 URL。

**需确认**：无需额外确认，属实现细节，已在 PLAN §5.4 落断言。

---

## D-03 🔴 剧本作品卡用「N 场 · M 个分镜」，**不**实现 SPEC 写的“页数”

**结论**：英雄卡与作品卡对剧本显示 `{sceneCount} 场 · {shotCount} 个分镜`；不引入“页”这个量纲。

**依据**
- `projects` 表无页数字段；`scenes`（`types.ts` 与 `db.ts`）只有 `heading/content/place/time/status/sortOrder`，**没有 words/页数**。
- 现有代码 `LibraryPage.tsx:247` 的 `{totalWords} 页` 对剧本恒为 0（`total_words` 只统计 chapters）—— 也就是说“页”现在是个**假数字**，本轮主题正是“说的和做的一致”。
- 要真显示页数，只能：① 约定 `1 场 ≈ 1 页`（假精度）；② 按字符数除以常数换算（凭空造常数，且与写作台 `countWords` 口径不一致）；③ 加 `scenes.words` 列并维护（超出 SPEC 的“零 schema 变更”）。

**否决的备选**：① 删掉剧本卡片上的字数区（丢信息）；② 由前端 `scenes.reduce(countWords)` 现算（列表接口不返回 scenes，会变成 N 次请求）。

**代价**：SPEC 文字里的“场/页”落地为“场/分镜”。若主人坚持“页”，那是**新数据模型决策**（加 `scenes.words` 或导出时统计），量级为一次独立小迭代，不该塞进本轮。

**需确认**：captain 若认为必须“页”，现在否决，我改回三选一方案再由主人拍板。

---

## D-04 删除清单在**客户端聚合**，服务端零改动

**结论**：`ProjectSettingsModal` 在确认步骤并发拉 `api.project(id)` / `api.trashChapters(id)` / `api.versions(id)`（+ 回收站章节逐章补版本数），拼出清单。

**依据**
- SPEC §4.1 允许“前端聚合或新接口二选一”。
- `listProjectVersions`（`repository.ts:968-974`）是 `chapter_versions JOIN chapters ... c.deleted_at IS NULL` → **只算活章节的版本**；回收站章节的版本仍会被级联删除。若直接用它，清单会少算。逐章补拉 `listChapterVersions`（`:964-966`，不过滤 `deleted_at`）才准确。
- 新接口要占 BE 写作用域、要加 API 测试、要在评审里再定义一次契约；收益仅是少 2 个请求。本地 SQLite，可忽略。

**否决的备选**：新增 `GET /api/projects/:id/delete-impact`（更“正规”，但扩大本轮 diff 与验证面）。

**代价与风险**
- 回收站章节很多时是 N+1 请求；本地单机、章节数上限很低，可接受。若将来变慢，再收进服务端（记为下一轮候选）。
- 清单失败**不能**阻塞删除（否则网络异常时用户永远删不掉作品）——已定：清单失败只降级提示，真正的闸门是“手输作品名”。

---

## D-05 H-7 用“客户端条件写入”，不在服务端强行约束默认模型

**结论**：改 `SettingsPage.saveProvider()` 的写入条件（只在「用户显式选了默认模型」或「当前默认指向本供应商且该模型已不可用」两种情况下写 `defaultModel`）；`PUT /api/settings` 与服务端 `saveSettings` 一行不改。

**依据**
- 根因在前端：`providerInfo.defaultModel` 是**推导值**（`repository.ts:318`：`enabledModels[0] || models[0]?.id`），弹窗把它当“用户选择”回写。
- 服务端若强行“默认模型必须指向已启用模型”，会与 A1 的报错设计重复且互相掩盖。

**风险**：任何**第三方**客户端仍可写入不一致的 `defaultModel`（比如指向已停用供应商）。缓解：A1 在服务端做了 `row.enabled` 与 `allowedModels` 校验，最终不会静默用错模型；显示层由 A6 的 `toggleProvider` 空分支兜住（`defaultModel = null`）。

**下一轮候选**：在 `PUT /api/settings` 增加一次软校验（不一致时把 `defaultModel` 归零并回传 `warning`）。本轮不做 —— 会牵动 api-test 的 onboarding 断言。

---

## D-06 A3 的“导出范围复位”用**同项目内复位**，不做“按作品隔离 scope”

**结论**：`StudioPage` 载入 effect 里 `setExportScope('book')`。

**依据**：`exportScope` 是 `:52` 的局部 state，初值 `'book'`；载入 effect（`:79-120`）已经统一复位 `project/activeId/content/messages/versions/saveState`，多一行即可闭合。拆组件（把写作台按 projectId 加 `key`）会重建编辑器、丢 AI 面板状态，副作用大于收益。

**风险**：同一作品内从“本章”切到别的章，scope 仍是“本章”（这是**期望**行为，不是残留）。

**诚实标注**：实测后确认当前**没有** A 作品写作台 → B 作品写作台 的直达链接（Rail「写作台」恒回当前 `pid`；`writeId` 只在当前是剧本时才切到第一部小说，且跨了不同路由会重新挂载）。所以这条复位是**防御性一行**，不是可复现缺陷修复 —— `PLAN §10` 把它列为回归保护（A3b），t5 不得声称取到改前红证据。保留它的价值：同一个 `<Route>` 元素换 `projectId` 时状态不串，将来若加“最近打开的作品”直达入口即刻生效。

---

## D-07 A1 修好之后，`plan.ts` 的文案一并统一到 `utils.ts` 常量

**结论**：`ai.ts` 与 `plan.ts` 共用 `AI_NO_DEFAULT_MODEL`；不改变两条链路的逻辑。

**依据**：`plan.ts:127-129` 早已是正确行为（`if (!modelRef) throw ...`），只是文案散落。统一常量能让 ui-test 只断言一处字符串，也让“同一件事两种说法”不再复发。

---

## D-08 D-1 / D-2 / D-3 三组硬编码：本轮**不代主人决策**，只给选项与成本

**结论**：`OutlinePage`（张力曲线 `:172`、三幕卡 `:177`、人物弧光 `:183`、`197-207`）、`ScreenplayPage`（本场分析 `4.5/4.0/3.5` `:243`、进度 `38%`）本轮保持原样。

**给主人的三个选项（等回复，不预选）**

| 选项 | 做法 | 成本 | 风险 |
| --- | --- | --- | --- |
| 删 | 去掉这些模块，页面留空态 | 每个模块 0.5h | 少三块“看起来高级”的展示，但不骗人 |
| 真算 | 张力/弧光由 AI 分析生成并落库（新增表或复用 `settings`），分析分由 `beats`+正文统计 | 每个模块 1–2 天 + 一次 schema 变更 + 新的失败路径 | AI 不稳定、成本、缓存与陈旧问题 |
| 标注示意 | 统一加「示意数据」徽标 + 文案 | 0.5h/页 | 最诚实但界面更“素” |

**已做的例外**：D-3 的“人物/伏笔已进入上下文”不是“数据不对”而是“事实说错”，用 A4 的文案修复覆盖；**完整度 72% 的进度条直接删除**（假百分比无法用文案救，标注示意也不值得为一个装饰元素加徽标）。这一处属于 A4 范围内的小删减，不算替主人拍 D-3。

---

## D-09 H-6（`server-exited` 白屏）本轮不做，但留明确交接

**结论**：不实现 `preload.cjs` 的 `onServerExit`。记入 `PLAN.md §12` 与 known-bad。

**依据**：SPEC 已把它列为下一轮（≤1h 工作量）；本轮若加，会触碰被冻结的 `preload.cjs` 与桌面主进程，扩大 T3 的验证面，且与 A5 的关窗逻辑在“进程将死”状态下互相干扰。

**补偿**：T3 的关窗用例会覆盖“正常退出”；崩溃白屏仍存在，写进 release note 的 known issues。

---

## D-10 关窗 guard 的失败语义：默认**拒绝关窗**，而不是“尽量放行”

**结论**：`runCloseGuards()` 任一 guard 返回 false 或抛错 → `cancelClose()`，窗口不关，由 guard 自己 toast 原因；重入（用户连点两次关闭）直接 false。

**依据**：宁可让用户再点一次，也不能静默丢稿。`main.cjs` 的 5s 兜底仍然存在（渲染层真卡死时窗口能关），所以“拒绝关窗”不会变成关不掉。重入保护是必须的：用户在保存慢时容易连点，第二次直接放行会造成“第一次保存还没落盘窗口就没了”。

**否决的备选**：guard 抛错时 `readyToClose()`（对用户更“顺”，但异常路径恰恰是可能丢稿的路径）。

---

## D-11 “改前红”取证用 `git stash push -u -- software/src`，不建 worktree

**结论**：t5 验证流程里，先 stash 源码（保留新测试脚本），跑三条验收命令记录失败，再 `git stash pop`。

**依据**：新测试脚本与源码在**不同目录**（`software/scripts` vs `software/src`，`scripts/` 在根），`git stash -- software/src` 精确只藏源码；worktree 要重装依赖（`pnpm install`），成本高且可能改动 lockfile。

**风险与约束**：`git stash pop` 必须在同一轮内完成并 `git status` 核对；若冲突，允许 `git checkout stash@{0} -- software/src` 兜底。**不许**用 `git checkout -- .`（会连新测试一起丢）。这也是本轮坚持“不 commit”的原因之一：stash 恢复的容错依赖未提交状态清晰。

---

## D-12 本轮零 schema 变更、零新依赖、零 commit

**结论**：`db.ts`、`package.json`、`tsconfig.json`、`vite.config.ts` 不动；不加 npm 包（`closeGuard.ts` 手写，不引 zustand 之类）；不 commit、不 push、不发版。

**依据**
- 无新增表/列 → 老 `data/studio.db` 直接可用，`migrate()` 的补列机制不需要新分支。
- 新依赖会牵动 `pnpm-lock.yaml`，与“不 push”前提冲突（lockfile 漂移）。
- 不 commit 让 t5 的 stash 取证与 t6 的 `git diff main` 评审都最简单；captain 若要落 commit，评审通过后统一做。

---

## D-13 测试断言只用**稳定选择器与稳定文案**，不靠 nth-child 与中文模糊匹配

**结论**：A2 的确认区用 `.danger-confirm` / `.danger-confirm input` / `.danger-confirm .btn--danger`；A4 用 `body innerText` 的禁用词表；A3 用 `URL.endsWith('/screenplay')` 与 `.export-scope` 的 `value`。

**依据**：项目已有教训 —— 选择器脆弱会让“功能没坏、测试先坏”，最后被人为放宽阈值掩盖真问题（桌面测试的 8000ms 超时就是这样把 5s 兜底藏了一整轮）。本轮把 T3 的阈值从 8000 收紧到 4000，也是同一原因。

---

## 待 captain 确认清单（阻塞项标 ⛔，其余为知情项）

| # | 事项 | 类型 |
| --- | --- | --- |
| 1 | D-01 监听改挂 `App.tsx`（SPEC 写 AppShell） | 🔴 需认账 |
| 2 | D-03 剧本卡片显示“场/分镜”而非“页” | 🔴 需认账（若否决，本轮 A3 只做路由 + 导出复位，卡片数字留到页数决策后） |
| 3 | D-09 H-6 继续不做，写 known issues | 知情 |
| 4 | D-05 服务的默认模型一致性校验下一轮再做 | 知情 |
| 5 | t4 拆几条 task（建议 BE 1 条 + FE 1 条 + DT 测试并入 FE，按 PLAN §14 W1/W2 排） | 排期 |
| 6 | 若主人已回 D-1/D-2，本轮是否追加（不建议追加，会破坏“一轮一验收”） | 排期 |
