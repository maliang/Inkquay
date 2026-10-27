# SPEC · 私家写手第二轮体验优化（可验收范围与契约）

基线：本地 main `4a43f42`　｜　不 push、不发版　｜　输入：`team/inkquay-polish-2/AUDIT.md`（t1，241 行，2 blocker + 8 high + 12 medium + 12 low）

本轮要解决的不是「能不能用」，而是**「说的和做的是不是一回事」**：界面承诺的东西与实现不符、危险操作没有安全网、流程会把人送进错误的工作台。范围严格收在本轮可验收的流程修复，不做全站重构。

---

## 1. 排序原则与范围结论

排序：**流程不通（写不下去/会丢东西）> 不人性化（多一步、看不懂）> 查漏补缺（展示/文案）**。

| 级别 | 条目 | 验收 ID | 成本估计 |
| --- | --- | --- | --- |
| P0 | B-1 未配置模型静默回退演示模型 | A1 | 后端 0.5h + 前端 0.5h + 测试 0.5h |
| P0 | B-2 删除作品无安全网（硬删） | A2 | 前端 1.5h + 测试 0.5h |
| P1 | H-4′ 剧本落进章节写作台 + 导出范围不复位（t1 原判已修正，见 §3） | A3 | 前端 1h + 测试 0.5h |
| P1 | H-1 写作上下文与「已进上下文」的说法不一致（D-2 决定方式） | A4 | 文案 0.5h / 真实现 3h |
| P1 | H-5 非写作台关窗固定卡 5 秒 | A5 | 前端 1h + 桌面测试 0.5h |
| P1 附带 | H-7 供应商弹窗保存静默覆盖默认模型（T4 的前置，见 §8 待确认项 ②） | A6 | 前端 0.5h |
| 决策项 | D-1 大纲页张力/三幕/弧光；D-2 剧本本场分析；D-3 设定页 72%/已同步/已索引 | 由主人拍板 | 0.5–8h/项 |
| 测试补口 | T1–T5（见 §7） | — | 2h |
| 不做 | H-6、D-4、展示类真算、重构、发版（见 §9） | — | — |

---

## 2. 本轮复验（实测结论，不是转述审计）

以下为 SPEC 定稿前自己跑出来的证据，用于校准验收标准（复现脚本都是临时文件，已删除；命令可在 `software/` 下照抄重跑）：

| 事项 | 复验方式 | 结果 |
| --- | --- | --- |
| B-1 | 临时 `PW_DATA_DIR` 起服务、不做 onboarding（`settings.defaultModel=null`），`POST /api/ai/stream {prompt:'继续写下去'}` | **复现**：HTTP 200，SSE `{"type":"meta","provider":"本地演示","model":"墨笔演示模型"}` 后持续 delta。→ 承诺「不会静默回退到演示模型」与实际相反 |
| B-2 | `DELETE /api/projects/:id` 后 `GET` 同 id | **复现**：DELETE 200 → GET 404，作品及级联数据消失；作品表无 `deleted_at`，而 chapters 有（db.ts:41/179-181） |
| H-1 | `node --import tsx` 直接调 `buildWritingContext`（先 `migrate()`），建伏笔「断线的怀表」 | **复现**：上下文 116 字，**不含**该伏笔名；`buildWritingContext(repository.ts:436-450)` 只含 作品/偏好/当前章 4000 字/人物前 8/节拍前 12/最近 3 章 |
| H-4 | 枚举所有进入 `/project/:id` 的链接 + Playwright 点英雄卡 | **原判不成立，真缺陷另有其事**：见 §3 |
| H-5 | 读 desktop/main.cjs:33-52 + 全仓搜 `onCloseRequest` | **确认**：只有 `StudioPage.tsx:223-241` 注册；其它页面必然等 5000ms 兜底；`scripts/desktop-test.mjs` 用 8s 超时，正好把这个 5s 掩盖成「通过」 |
| H-7 | 读 SettingsPage.tsx:130/148-150 + repository.ts:318 | **确认**：`ProviderInfo.defaultModel` 由 `enabledModels[0]` 推导（不是用户选择），保存供应商后无条件写回 `settings.defaultModel` |
| 三处硬编码 | 读 OutlinePage.tsx:172/177/183/197-207、ScreenplayPage.tsx:243、CodexPage 记忆卡 | **确认**：张力曲线 path、三幕卡、弧光百分比、本场 4.5/4.0/3.5、72%/已同步/已索引 均与真实数据无关 |

---

## 3. 对 t1 审计的修正：H-4 → H-4′（需 captain 确认，见 §8-①）

t1 判「exportScope 跨作品残留导致剧本导出死锁（StudioPage 同路由不卸载）」，复验后**机制不成立**：

- 进入 `/project/:id` 的入口只有 5 处：`LibraryPage.tsx:211`（英雄卡「继续写作」）、`OutlinePage.tsx:162`（返回）、`OutlinePage.tsx:223`（去写这一章）、`CodexPage.tsx:142`（返回）、`StudioPage.tsx:757`（自身 tab）。其余入口对剧本一律走 `/project/:id/screenplay`（`LibraryPage.tsx:98/242`）。
- `exportScope` 是 StudioPage 的局部 state，初值恒为 `'book'`；而「同一路由只换参数不卸载」的转换只可能发生在 **StudioPage → StudioPage**（如小说 A → 小说 B），Rail「写作台」的 `writeId` 永远优先非剧本项目（Rail.tsx:12-14）。**不存在**「scope=chapter + 剧本项目」的组合，所谓死锁不可达（`:656-660` 的 toast 与 `:765-772` 隐藏下拉，实际都碰不到）。

但同一片代码有**真实可复现的流程断裂**（Playwright 实测）：

- 剧本项目成为作品库英雄卡时，卡片写「已写 **0 章** 0 字」，点「继续写作」落到 `/project/{剧本id}` —— 渲出的是**章节写作台**：`目录 0 章`、`新建章节`、`导出全书 Word`、`本章 0 字`，而剧本真正的入口是场次表 `/screenplay`。
- 从大纲页/设定页顶栏返回（OutlinePage.tsx:162/223、CodexPage.tsx:142）同样把剧本送进章节写作台；此时导出范围下拉被静默隐藏，用户不知道导出的是什么口径。
- 次要残留：小说 A（scope=本章）经 Rail 切到小说 B 时 StudioPage 不卸载，范围状态残留，容易只导出 B 的一章。

**H-4′ 定义**（本轮 P1，按此验收，不按 t1 原文）：`a)` 剧本项目不得进入章节写作台，所有入口一律重定向到场次表；`b)` 英雄卡对剧本显示「N 场 / 页」而不是「N 章 / 字」；`c)` 导出范围随作品切换复位为「全书」。

---

## 4. P0-1 / A1：未配置模型不得静默用演示模型代写

**现状证据**：`ai.ts:239-241` `providerId = opts.providerId || settings.defaultModel?.providerId || 'mock'`；`seed.ts:14-16` 预置 mock 供应商；`settings.defaultModel` 初始 null（`repository.ts:31`）；`plan.ts:127-132` 已正确抛「还没有选择默认模型，请到设置中配置」——同一产品里两套态度；`SettingsPage.tsx:292` 承诺「不会静默回退到演示模型」。

**目标行为**
1. 未显式指定 provider/model 且 `settings.defaultModel` 为空 → **抛可读错误**，文案与 plan.ts 一致：`还没有选择默认模型，请到设置中配置`；经现有 SSE error 通道下发（`index.ts:437-443` 已是 `{type:'error'}`），HTTP 仍 200（保持流式协议不变）。
2. **显式选择「本地演示」仍然可用**（`providerId='mock'` 或模型选择器选中 mock）——ui-test / desktop-test 依赖它，防止把功能改坏。
3. `providerId` 指向不存在或未启用供应商 → 明确报错，不再静默替换为别的模型/供应商。
4. 失败路径零副作用：不写 `ai_messages`、不改章节 `content`。
5. 前端：AI 面板显示当前模型名；未配置时点「让 AI 续写」→ toast 引导「去设置」，不出现「点了没反应」。

**验收 A1**
- `pnpm -C software test`（api-test 新增）：临时库 + 空 `defaultModel` → `POST /api/ai/stream` 响应体含 `"type":"error"` 且含 `默认模型`，不含任何 `"type":"delta"`；`GET /api/projects/:id/messages` 长度为 0；章节 content 未变。
- 同用例后半：`PUT /api/settings {defaultModel:{providerId:'mock',modelId:'mock-writer'}}` 后同请求 → 有 delta，`meta.provider` 为演示供应商（显式 mock 未被误伤）。
- `pnpm -C software test:ui`（新增 case）：未配置模型进入写作台点「让 AI 续写」→ toast 含「设置」→ 编辑器文本不变。

**改动面**：`software/src/server/ai.ts`、`software/src/server/plan.ts`（仅统一文案）、`software/src/client/pages/StudioPage.tsx`（提示与模型名展示）、`software/scripts/api-test.mjs`、`software/scripts/ui-test.mjs`。

---

## 5. P0-2 / A2：删除作品必须有人工确认与清单

**现状证据**：`ProjectSettingsModal.tsx:48-60` 一次 `window.confirm` 即调 `api.deleteProject`；服务端 `repository.ts:659-663` 硬删，`index.ts:131-134` 直接 DELETE；章节有回收站（`repository.ts:665-700`、`index.ts:154/186/192`），作品层没有——安全网刚好漏掉最危险的一步。

**目标行为（本轮最小可信安全网，必做）**
1. 删除改为模态二次确认：必须**输入作品名**（`trim()` 后与标题完全一致）才启用「永久删除」按钮，否则禁用；同时列出将被删除的真实计数：章节 N、场次 N、人物 N、伏笔 N、版本 N、回收站中章节 N。
2. 文案必须准确：写「不可恢复」；**若日后做 D-4 软删除，才允许改口**。禁止出现「可在回收站恢复」而实际硬删。
3. 在输入框空、输错、按 Esc、点取消/遮罩 的情况下**不得调用** `DELETE /api/projects/:id`。
4. 删除成功：回作品库、toast 书名；作品已不存在（404）：友好提示 + 刷新列表，不白屏。
5. 服务端保持不变（除 D-4 被采纳）。

**验收 A2**
- `pnpm -C software test:ui`（新增 case）：新建作品 → 作品设置 → 点「删除作品」→ 断言按钮 `disabled`；输入错名仍 `disabled`；输入正确书名 → 按钮可用 → 点删除 → 回到作品库 → 榜单无该书；再 `GET /api/projects/{id}` 断言 404。
- 断言拦截：删除前监听 network，确认输入阶段没有任何 DELETE 请求。

**改动面**：`software/src/client/components/ProjectSettingsModal.tsx`（+ 必要样式）、`software/scripts/ui-test.mjs`。

**风险**：本轮删除仍无回滚（软删除见 D-4）；因此第 2 条文案准确性是验收硬条件。

---

## 6. P1：H-4′ / H-1 / H-5

### 6.1 H-4′ / A3：剧本不进章节写作台 + 导出范围复位

**目标**
1. `LibraryPage.tsx:211` 英雄卡按类型导航：剧本 → `/project/:id/screenplay`；英雄卡对剧本项目显示「N 场 / N 页」（现为 `chapterCount` 章的错位）。
2. StudioPage 载入后若 `project.type === 'screenplay'` → `<Navigate replace to={/project/:id/screenplay}>`，覆盖 大纲/设定顶栏返回、手输 URL、历史前进后退。
3. `exportScope` 以 projectId 复位为 `'book'`（切换作品不残留「本章」）；剧本导出继续走剧本工坊顶部按钮（`ScreenplayPage.tsx:169-170`），不新造导出入口。

**验收 A3**
- `test:ui` 新增：建剧本 → 作品库英雄卡点「继续写作」→ URL 以 `/screenplay` 结尾、出现场次表、不出现「新建章节」。
- `test:ui` 新增：小说 A 写作台把导出范围切到「本章」→ 经 Rail 切到小说 B → 范围回「全书」。
- 回归：小说返回正文（OutlinePage/CodexPage → `/project/:id`）仍然正常，不产生重定向循环。
- `test`（api）：剧本项目 `GET /api/projects/:id/export` 与 `export.docx` 均 200 且内容含场次标题；空剧本返回 400 文案 `这本还没有可导出的正文`（现有 `index.ts:365-368`）。

**改动面**：`software/src/client/pages/LibraryPage.tsx`、`software/src/client/pages/StudioPage.tsx`、`software/scripts/ui-test.mjs`、`software/scripts/api-test.mjs`。

---

### 6.2 H-1 / A4：写作上下文与「已进上下文」说法对齐（D-2 决定实现方式）

**现状**：`buildWritingContext(repository.ts:436-450)` 不含 `foreshadows`/`relations`；而 `CodexPage.tsx:156/165` 写「人物、秘密与关系已经进入 AI 的写作上下文」、`StudioPage.tsx:952-958` 记忆卡 chips 含「伏笔 N」。

**方案 A（真实现，需主人选 D-2=A）**
- 在上下文预算内注入：伏笔（名称/状态/埋设章/回收章，待回收优先，≤8 条）、人物关系（from→to·类型，≤20 行）；新增总量 ≤ 现有上下文字符的 15%，超限截断并可断言。
- 记忆卡 chips 计数改为与上下文一致的真实值。
- 新增 `software/scripts/context-test.mjs`（`node --import tsx` 直连模块、临时 `PW_DATA_DIR`、动态 import 前设 env）：建伏笔与关系 → 断言上下文含其名称/状态；超 8 条伏笔 → 断言只出现 8 条；断言总长度上限。并入 `pnpm -C software test` 串行执行。

**方案 B（默认，只保证不说假话）**
- 文案改为「已记录（写作时可在共笔面板引用）」；记忆卡不再声称自动进入上下文，chips 保留事实计数。
- 验收：跑通 `test:ui` 设定页 case，断言页面文本不再出现「进入 AI 的写作上下文」「已进入上下文」。

**验收 A4**：二选一，都必须用测试证明「说的和做的一致」；不允许改了文案但 chips 仍显示「已进入」。

**改动面**：方案 A → `repository.ts`、`CodexPage.tsx`、`StudioPage.tsx`、新增 `software/scripts/context-test.mjs`、`software/package.json`（test 串接）；方案 B → `CodexPage.tsx`、`StudioPage.tsx`、`ui-test.mjs`。

---

### 6.3 H-5 / A5：非写作台关窗不再固定等 5 秒

**现状**：`desktop/main.cjs:33-52` 关窗发 `inkquay:request-close` + 5000ms 兜底；只有 `StudioPage.tsx:223-241` 注册；设置页/大纲页/设定页/剧本页必然走兜底 → 每次关窗卡 5 秒。

**目标（单点 ack）**
1. 新增 `software/src/client/lib/closeGuard.ts`：`registerCloseGuard(fn: () => Promise<boolean> | boolean): () => void`；AppShell 持有**唯一** `onCloseRequest` 监听：依次执行当前页注册的 guard（无 guard 也立即 ack）→ 全部成功才 `readyToClose()`，任一失败 `cancelClose()` + toast。
2. `StudioPage` 删除自己的监听，改为注册 guard（保存逻辑、`saveTimer` 清理、失败 toast 原样保留）。
3. **禁止多监听并存**：`main.cjs:34-56` 只有单个 `closeRequestWindow`，提前 ack 会让窗口在保存未完成时关闭 → 丢稿。

**验收 A5**
- `pnpm desktop:test`：现有「写作台立即关窗仍落盘」用例必须继续通过；新增「设置页关窗」用例：从 `BrowserWindow.close()` 到进程退出的耗时 **< 2500ms**（现状约 5000ms，改前应在同一断言下红过）。
- 手工：大纲/设定/剧本页关窗无 5 秒空等；写作台 dirty 状态关窗仍落盘。

**改动面**：新增 `software/src/client/lib/closeGuard.ts`、`software/src/client/components/AppShell.tsx`、`software/src/client/pages/StudioPage.tsx`、`scripts/desktop-test.mjs`。

---

## 7. 测试补口 T1–T5（缺口是真缺口，不是重复劳动）

| ID | 补什么 | 位置 | 现状 |
| --- | --- | --- | --- |
| T1 | 导出：小说本章 + **剧本**（md/docx）；UI 侧剧本工坊顶部导出产生下载 | `software/scripts/api-test.mjs:244-260` 已有小说全书/本章，**缺剧本** | 新增剧本用例 |
| T2 | 项目包备份 → 导入：导入后章节/场次/人物/伏笔计数与正文一致 | api-test:278 已有 export+import 往返，缺完整性断言 | 加断言 |
| T3 | 桌面关窗 flush：现有写作台落盘 **+ 非写作台 <2500ms** | `scripts/desktop-test.mjs` 只有写作台，且 8s 超时掩盖 5s | 加耗时断言 |
| T4 | 供应商弹窗保存对默认模型的影响 | 无 | 新增（需 H-7，见 §8-②） |
| T5 | 未配置模型时的 AI 行为：SSE error、无 delta、无 ai_messages、章节不变；显式 mock 仍流式 | 无 | 新增（A1 的测试落地） |

要求：每条断言输出可读日志（不能只靠 exit 0）；新增用例必须在**改前红、改后绿**，verifier 按此复查。

---

## 8. 需要主人拍板 / 需要 captain 对齐

### ① 与 t1 审计的出入（请 captain 确认）
H-4 原判「剧本导出死锁」不可达（§3 证据）。若 captain 坚持原判，请给出可复现步骤；否则本轮按 H-4′ 验收。这条影响下游任务描述与评审口径，需明确回执。

### ② H-7 是否并入本轮（请 captain 定）
T4 的合理断言是「保存供应商弹窗不得偷改默认模型」，而当前代码确实会偷改（`SettingsPage.tsx:148-150`）。**要让 T4 有意义，必须同步做 H-7 的最小修复**（约 20 行前端：仅当 `defaultModel` 为空或用户显式勾选「设为默认」时才写回；并给一个真实可选默认的控件/选择而非 `enabledModels[0]` 推导）。
- 若允许：H-7 列为 P1 附带（A6），T4 断言「默认模型在保存其它供应商后不变；默认模型永远指向存在且已启用的模型」。
- 若不允许：T4 降级为弱断言「保存后默认模型仍指向存在且已启用的模型」，并在 SPEC 记一条 known-bad。

### ③ 用户决策项（不得代拍，未答复时的默认见每项末）

**D-1 大纲页：张力曲线 / 三幕卡 / 人物弧光**（`OutlinePage.tsx:172/177/183/197-207`，含固定 SVG path、`i===1` 高亮、`64%/47%/78%`、`38%/24%/55%`、章节刻度「第1/7/12/18/24章」）

| 选项 | 做法 | 成本 | 风险 |
| --- | --- | --- | --- |
| 删除展示 | 去掉张力曲线 + 弧光 + 三幕卡，仅留真实 beats/acts 列表 | 0.5h | 低；损失视觉引导 |
| 改为真实计算 | 三幕卡可用 acts.sortOrder/summary 真值（便宜）；张力曲线需先定口径（章节字数/节拍位置/关键词密度）；弧光缺数据模型 | 4–8h + 口径讨论 | 中高：容易变成「看起来科学」的假精度 |
| 暂时保留并标注 | 卡片加「示意」徽标 + tooltip「按三幕式模板展示，未接入本书数据」 | 0.5h | 低 |

参考建议（不代拍）：三幕卡改真值，张力/弧光先标注示意，算法留待下一轮。**未答复默认：现状不动，仅记录。**

**D-2 剧本「本场分析」**（`ScreenplayPage.tsx:243`：4.5/4.0/3.5 与固定「本场功能/潜台词」）

| 选项 | 成本 | 风险 |
| --- | --- | --- |
| 删除分析区 | 0.5h | 低；少一块「专业感」 |
| 规则真算（场次字数、对白比、出场人物数、伏笔钩子数） | 3–6h | 中；指标含义要能解释 |
| 保留 + 标注示意 | 0.5h | 低 |
| AI 分析（调用模型） | 4h+ | 高：与 B-1 联动（未配模型时该区域必须降级），token 成本 |

**未答复默认：现状不动。**

**D-3 设定页：记忆索引 72% / 已同步 / 已索引 N 人物 M 伏笔**（`CodexPage.tsx`）

| 选项 | 成本 | 风险 |
| --- | --- | --- |
| 删百分比与「已同步」，改「本地保存」 | 0.5h | 低 |
| 真算完整度（有描述的人物比、有回收点的伏笔比）并与 buildWritingContext 实际对齐 | 2–3h | 中；与 H-1 强耦合，必须同步 |
| 保留 + 标注示意 | 0.5h | 低 |

**未答复默认：只做「去假承诺」的最小改动（删百分比/已同步文案），不新增算法** —— 因为「已同步」「已进入上下文」是事实性错误，继续留着等于继续误导。

### ④ D-4（本轮不做，供主人决定是否排下一轮）
作品级回收站：`projects` 加 `deleted_at`、列表过滤、恢复/彻底删除、作品库回收站入口，级联保留 chapters/scenes/characters/foreshadows/shots/versions。成本 3–4h 后端 + 2h 前端；风险中（要改全部列表查询）。**未答复默认：不做**，靠 A2 的输入书名确认兜住。

---

## 9. 用户旅程（修复前后对照，验收即断言）

| # | 旅程 | 现在会怎样 | 修复后 | 验收 |
| --- | --- | --- | --- | --- |
| J1 | 新装用户打开新书点「让 AI 续写」 | 演示模型的文字流出来，接受后落进正文，用户以为是自己配的模型写的 | 明确提示「还没有选择默认模型」+ 去设置；正文一字不落 | A1 |
| J2 | 作者删一本写废的长篇 | 一次 confirm，书、章、版本、伏笔全没，无恢复入口 | 输入书名 + 看到将被删的清单 + 明确不可恢复；取消不产生任何请求 | A2 |
| J3 | 剧本作者在作品库点「继续写作」 | 落进章节写作台：目录 0 章 / 新建章节，看不到场次 | 直接进场次表，卡片显示 N 场 | A3 |
| J4 | 作者埋了伏笔，回设定页看到「已进入上下文」 | 上下文里其实没有伏笔与关系 | 真注入（A）或文案不再承诺（B） | A4 |
| J5 | 任何页面点窗口关闭 | 设置/大纲/设定/剧本页必卡 5 秒 | <1 秒退出；写作台未保存内容仍先落盘 | A5 |

---

## 10. 非目标（本轮明确不做）

1. 全站重构 / 状态管理替换 / 新增运行时依赖。
2. 跨幕拖拽、剧本 AI 企划、云同步、发版与签名、自动更新。
3. **H-6**（`server-exited` 无人接收 → 服务崩溃白屏）：确认存在，但不在本轮；建议下一轮 <1h 处理（preload 增监听 + 全局横幅）。
4. **D-1/D-2/D-3 的「真算」实现**：等主人拍板，不擅自选方案。
5. **D-4 作品级回收站**。
6. 设置页/供应商体系重构（H-7 只做最小修复，见 §8-②）。
7. 任何 push、发版、改动基线提交。

---

## 11. 交付顺序与协作边界

- **轨道 A（后端）**：B-1（`ai.ts`、`plan.ts`）+ H-1 方案 A（`repository.ts`）——两者不同文件，可同一人顺序做。
- **轨道 B（前端）**：B-2（`ProjectSettingsModal`）、H-4′（`LibraryPage`/`StudioPage`）、H-5（`AppShell` + `closeGuard` + `StudioPage`）、H-7 微修（`SettingsPage`）。
- **冲突面**：`StudioPage.tsx` 被 B-1 提示、H-4′ 重定向、H-5 guard 三处触碰 → **必须由同一人一次改完**，避免并行冲突。
- **验证**：独立 verifier 跑 §12 命令 + A1–A5/A6 断言，逐条给日志；reviewer 只审契约与「不做清单」是否被越界。
- 若决策项未答复：A 轨道与 B 轨道不被阻塞（H-1 走方案 B、D-1/D-2/D-3 不动）。

---

## 12. 验收命令（必须全绿且带可读日志）

```bash
pnpm -C software typecheck
pnpm -C software test              # api-test（含 A1/A3/T1/T2/T5）
pnpm -C software test:ui           # build + ui-test（含 A2/A3/A4/A6 的 UI 断言）
pnpm desktop:test                  # 写入 Enter 后关窗落盘 + 非写作台 <2500ms（A5）
```

补充约定：本轮默认**不产生 git commit**，保留工作区 diff 供评审（禁止 push）；`git status` 除 `team/` 与 `.agent-teams/` 外不应有未跟踪垃圾（临时脚本、截图需清理）。

---

## 13. 风险与回滚

| 风险 | 控制 |
| --- | --- |
| H-5 双 ack 提前关窗丢稿 | 单监听 + StudioPage 同批移除旧监听 + desktop-test 覆盖 dirty 落盘 |
| B-1 误伤显式 mock，把「本地演示」也禁掉 | T5 断言显式 mock 仍流式；ui-test/desktop-test 全绿 |
| B-2 硬删无回滚 | 文案只承诺不可恢复；D-4 单列；输入书名确认 |
| H-4′ 重定向与大纲/设定返回冲突 | 只对 `type==='screenplay'` 生效；ui-test 覆盖小说返回正文 |
| H-1 方案 A 拉长提示词影响生成 | 硬上限 + context-test 断言长度；超限截断 |
| 决策项拖延 | 默认路径（H-1→B、D-1/D-2/D-3→不动）保证本轮仍可交付与验收 |
