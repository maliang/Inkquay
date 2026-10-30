# SPEC — Inkquay AI-first 创作流程（长篇/短篇统一）与验收口径

- 版本：v1.0（2026-10-28）
- 作者：pm（产品 / 需求收敛）
- 基线：安装版 v0.1.12，main `ae75612`；缺陷现场与根因见 `team/inkquay-ai-first/AUDIT.md`（R1–R6，含 file:line）
- 读者与用途：t3(ux) 出界面规格、t4(architect) 出架构/迁移方案、t5(backend)/t6(frontend) 实现、t7(qa) 按第 12 章执行端到端验收、t8/t9 评审
- 硬约束：本文档只定义"要什么、怎么算做到"，不写业务代码；不修改 `software/`；不 commit/push
- 判定优先级：**功能行为 > 文案措辞**。文中给出的中文文案是"必须包含的关键词"，不是逐字终稿；但第 11 章测试锚点与状态值不得改名

> **2026-10-29 captain 注（与正文冲突时以本注为准）**
> 1. P4 不再“每章停在 in_review 等 REVIEW”。按 `CAPTAIN-DECISIONS.md` D4：连续生成到最后一章，全部写完后逐章审；暂停=当前章写完停，立即停止=丢弃当前章未完成正文。
> 2. V1 进度通道用轮询（2s/10s/5s，连续 3 次失败降级）；SSE 为 V1.1，预留 `job_events.seq` 不实现。
> 3. 迁移验收必须先造 `test/fixtures/legacy/{novel-full,short,orphan}.db`，现有安装库没有可迁移正样本；回退“丢失 N 章”是真实警告，不是自动删除。

---

## 0. 术语表（全团队统一用词，禁止混用同义词）

| 术语 | 定义 | 禁止说法 |
|---|---|---|
| 作品 Project | 一本长篇/短篇的容器，含阶段、正文章节、版本 | 项目、book、文档 |
| 阶段 Stage | 流水线的一步：P0 立项、P1 设定、P2 故事大纲、P3 章节计划、P4 逐章写作 | 步骤、step、phase |
| 设定 P1 | 世界观/环境、人物两类条目的集合 | 世界观（单指时易与"环境"混） |
| 故事大纲 P2 | 幕（长篇）/节拍组（短篇）及其下节拍条目 | 大纲、outline（代码层可用，界面必须写"故事大纲"） |
| 章节计划 P3 | 全书章节数量 + 每章功能/章节大纲/字数范围；短篇为"节拍计划"（数量+每节拍功能/大纲/字数范围） | 目录、章节表 |
| 逐章写作 P4 | 按已确认的 P3 连续生成正文，全部写完后逐章审阅；短篇为"逐节拍写作" | 批量生成、一键成书 |
| 生成任务 Job | 一次可取消、可恢复、可重试的 AI 生成过程（含多个步骤） | 请求、task（歧义） |
| 修订 Revision | 一次落库的阶段/条目内容版本，带来源与意见 | 版本（"版本"专指章节正文版本 chapter_versions） |
| 确认 Confirm | 用户显式点击的确认动作，产出不可被静默覆盖的确认快照 | 保存、提交 |
| 反馈 Feedback | 用户对某阶段/某条目给出的自然语言意见，触发 AI 重做 | 评论、留言 |
| 短篇节拍 Beat | 短篇的最小写作单元（等价于长篇的"章"），界面写"场景/节拍" | 段落（易误解为排版段落） |
| 已知冲突 | 上游阶段发生结构性变更后，下游阶段内容可能失效的状态标记 `stale` | 过期、作废（内容不删） |

---

## 1. 目标与成功判据

### 1.1 产品转向（一句话）

从"AI 辅助编辑器"转为**"AI 主导、人工把关"的流水线**：用户不再面对空白编辑器猜要写什么，而是对 AI 给出的每一阶段产物做**取舍**——编辑、给意见、重生成、确认。AI 从不静默推进到最后一步，每一阶段和每一章都必须有人工 REVIEW 门槛。

### 1.2 三条可观察的成功判据

1. **新建不再无响应**：点「创建并让 AI 企划」后 ≤500ms 有可见进度、全程可取消，成功/失败/取消三种结局都给出下一步，且都不留孤儿作品或白屏（第 6 章）。
2. **阶段可掌控**：P1→P4 每一步都能看到 AI 初稿、改它、让它按意见重做、回滚到旧版、显式确认后才进入下一步（第 4 章）。
3. **长任务不丢**：逐章生成可暂停/继续/重写单章；刷新、关页面、重启应用后进度与内容都还在；失败只影响失败的那一章（第 7、8 章）。

### 1.3 现有缺陷的修复承诺（对应 AUDIT 根因）

| 根因 | 现状（file:line） | 本 SPEC 的修复条款 |
|---|---|---|
| R1 主按钮与进度文案同时被隐藏，视觉上"灰掉但无解释" | `NewProjectModal.tsx:191`（`!created ?`）、`:193`（`AI 正在企划…` 不可达） | 6.1 时序、6.2 四态表、6.4 红线 R-1 |
| R2 一次性 await 无进度通道，plan 非流式 | `NewProjectModal.tsx:73-94`、`plan.ts:87-105` | 6.1（进度视图与 job 解耦）、7.5（可观测） |
| R3 单次 90s 超时、无重试、catch 只回 502 不落日志、取消只 abort 客户端 | `plan.ts:100/115/131`、`index.ts:102-111`（`:109`） | 7.1 错误分类、7.2 取消语义、7.4 重启恢复、7.5 日志 |
| R4 先落空壳结构再请求 AI；applyProjectPlan 全量 DELETE 重建 | `repository.ts:253-273`（`:260` 三空幕）、`:910-960`（`:916-917` DELETE） | 3.3 INV-3/INV-6、4.6 上游变更、第 9 章迁移 |
| R5 只取 `message.content`，推理模型 content 可能为空 | `plan.ts:104`、`:149-151` | 7.1 `EMPTY_OUTPUT` / `REASONING_UNSUPPORTED` |
| R6 失败无痕，planError 仅内存 | `NewProjectModal.tsx:31` | 7.5（job 表 + 结构化日志 + 项目级 lastError） |

---

## 2. 范围

### 2.1 首版必须（V1，本次重构的验收范围）

| 编号 | 必须项 | 说明 |
|---|---|---|
| M1 | 新建四态闭环 | 加载/成功/失败/取消均可见、可继续（第 6 章） |
| M2 | P1 设定（世界观/环境 + 人物） | 分块编辑、条目级反馈、单块/整份重生成、历史回滚、确认（4.2） |
| M3 | P2 故事大纲 | 幕/节拍条目的编辑、增删、重排、反馈、重生成、确认（4.3）；M3 接口：`POST /api/projects/:id/stages/:stage/items`（p1/p2 新增）、`DELETE /api/projects/:id/items/:itemId`、`POST /api/projects/:id/stages/:stage/items/reorder`（block=env/characters/acts/幕 id）、`POST /api/projects/:id/stages/p3/units/reorder`（章节/节拍计划排序） |
| M4 | P3 章节计划（短篇=节拍计划） | 章节数量、每章功能/大纲/字数范围、总字数校验、确认门槛（4.4 / 5.2） |
| M5 | P4 逐章写作 | 连续生成、暂停/继续/立即停止、重写单章、全部写完后逐章审阅（4.5 / 5.3，D4） |
| M6 | 生成任务可取消、可恢复、可重试 | 服务端真取消、断连不取消、重启可恢复（7.2 / 7.4） |
| M7 | 状态持久化 | 刷新/重启后阶段、修订、确认、进度都在（第 8 章） |
| M8 | 旧作品迁移 + 回退 | 旧作品不迁移也能打开；升级可回退；正文/版本/设定零丢失（第 9 章） |
| M9 | 错误边界 | 无默认模型/无 Key 不建作品、不静默 mock；错误分类给人话与下一步（7.1） |
| M10 | 测试锚点与 E2E | 第 11 章锚点 + 第 12 章场景可被 QA 直接执行（含慢/失败/取消，不得只跑 mock 瞬时） |

### 2.2 后续版本（V1.1+，本次明确不做，但不得把架构做死）

- 从旧正文**反推**设定/大纲（`reverse-engineer`）
- 全书一致性检查（人物动机漂移、伏笔回收、时间线）
- 章节计划模板库（三幕/七点/英雄之旅/悬疑双线）
- 自动连写（每章自动通过 REVIEW 的"托管模式"）
- bundle v2（含阶段与修订）、云备份、写作日历与目标进度
- 短篇上限放宽、系列作品（series）的流水线化

### 2.3 非目标（V1 明确不做，避免"重构"变无边界重写）

1. **不动 screenplay（电影剧本）与 series（剧集大纲）**：两者保持现状流程，只继承"新建无响应"修复与错误边界（`App.tsx:19-22` 的 screenplay 强跳不变）。
2. **不允许"一键成书"**：不得提供绕过 P3 确认或绕过“写完后逐章审阅”的入口。
3. **不重做视觉系统**：沿用现有 CSS 变量与组件语汇（`.modal`/`.btn--primary`/`.editor` 等），只新增流水线页与其组件。
4. **不换技术底座**：继续 SQLite（`node:sqlite`）+ 进程内 job；不引入外部队列/Redis/独立 worker 进程；不引入前端状态库。
5. **不改导出格式语义**：`export.md` / `export.docx` 的正文输出保持兼容；`bundle` 保持 `version: 1`，只允许追加可选字段（见 9.6）。
6. **不做多用户/协作/云同步/账号体系**。
7. **不自动修改已确认内容**：任何 AI 重生成不得静默覆盖 `confirmed` 的阶段或 `approved` 的章节。
8. **不做计费面板**：job 只记录 usage 数字，不展示成本曲线。

### 2.4 类型矩阵

| 类型 | 流水线 | P3 单元 | P4 单元 | 说明 |
|---|---|---|---|---|
| 长篇小说 novel | 完整 P0–P4 | 章 | 章 | 有卷/章结构 |
| 短篇小说 short | 完整 P0–P4 | 场景/节拍 | 场景/节拍 | **无章节**，不显示卷/章 UI，不建空章 |
| 电影剧本 screenplay | 不进流水线 | — | — | 现有剧本页保持；只修新建无响应与错误提示 |
| 剧集大纲 series | 不进流水线 | — | — | 同上 |

---

## 3. 产品模型与不变式

### 3.1 实体（语义层，字段命名由 architect 定）

| 实体 | 关键信息 | 说明 |
|---|---|---|
| Project | 标题、类型（novel/short）、题材、一句话灵感、目标字数、风格/禁区、pipelineStatus、stale 标记、lastError、migrationId | `pipelineStatus ∈ {draft, planning, reviewing, writing, completed, legacy}`（可由阶段推导，但必须可持久化以便列表展示） |
| Stage | projectId、stageKey（p1/p2/p3/p4）、status、stale、confirmedRevisionId、updatedAt | 每作品固定 4 条（P0 即 Project 本身，不单独建 Stage） |
| StageItem | stageKey、kind（world/character/act/beat/chapter/beat-plan）、序号、结构化字段、text | 编辑的最小单位；条目 id 必须稳定（供差异对比与回滚） |
| Revision | scope（stage/item）、targetId、source（`ai_initial`/`ai_feedback`/`ai_regen`/`manual`/`rollback`/`migration`）、note（用户意见原文）、content、createdAt | 历史留档；确认产生不可删快照 |
| GenerationJob | projectId、stageKey、kind（plan/writing）、status、step、progress（已完成/总数或阶段名）、providerId、modelId、usage、errorCode、startedAt/finishedAt、cancelRequested | 任务与页面生命周期解耦 |
| ReviewRecord | 章节 id、动作（approve/request_changes/manual_approve/skip）、意见、时间 | 章节 REVIEW 留痕 |

### 3.2 状态机（允许的转移，代码必须只接受这些）

**Stage.status**：`empty | generating | review | confirmed | failed | skipped`

```
empty      → generating (用户触发) | skipped (仅 P1，用户显式跳过)
generating → review (成功) | failed (失败/超时) | review (取消/失败时已有旧内容，回退展示旧内容)
review     → confirmed (用户确认) | generating (反馈/重生成) | review (编辑保存，不改变状态)
confirmed  → review (用户编辑该阶段或 AI 修改该阶段 → 必须重新确认)
failed     → generating (重试)
skipped    → review (用户改主意) 
```
`stale` 是**独立布尔标记**，不是状态：上游结构性变更时 `stale=true`，内容与 `confirmed` 均保留；用户复核/重生成后 `stale=false`。

**GenerationJob.status**：`queued | running | done | failed | cancelled | interrupted`

```
queued      → running | cancelled
running     → done | failed | cancelled | interrupted (进程崩溃/重启)
interrupted → running (恢复：只重跑未完成步骤/章节) | cancelled
failed      → (不复用，重试新建 job 并带 retryOfId)
```

**Chapter.reviewStatus**（P4 单元）：`pending | generating | in_review | approved | changes_requested | approved_manual | skipped`

```
pending           → generating | skipped
generating        → in_review | pending (失败/取消，正文不写入)
in_review         → approved | changes_requested | approved_manual (人工改后直接通过)
changes_requested → generating (按意见重写新版本)
approved          → in_review (用户显式"我要改")
```

### 3.3 不变式（INV，测试可直接断言）

- **INV-1 确认不可静默覆盖**：`confirmed` 阶段的条目、`approved` 章节的正文，只有用户显式操作（编辑/重生成/重写）才能变更；任何上游重生成不得改动它们（对应 AUDIT R4 的 `applyProjectPlan` 全量 DELETE 问题）。
- **INV-2 AI 输出先落为修订**：每次生成结果都写为 Revision，再作为"当前展示版本"；确认产生快照。历史至少保留：首版、每版确认快照、最近 10 个修订（超出可按策略裁剪，但确认快照永不清）。
- **INV-3 失败/取消不写半截**：一个生成步骤（一次模型调用）的产物**整体原子写入**；失败/取消时该步骤零写入。允许"步骤 A 成功、步骤 B 失败"，此时 A 的产物保留并标为未确认修订。
- **INV-4 无配置不产正文**：无默认模型、provider 未启用、缺 Key（非本地 baseUrl 覆盖）时，服务端必须返回明确错误码并在界面给出下一步；**禁止静默 mock**。唯一例外：用户显式选择 `providerId='mock'`，且界面必须常显「模拟模式」徽标（沿用 0f08e42 语义）。
- **INV-5 任务与页面解耦**：关闭/刷新页面、切换路由不中断 job；只有显式取消才中断（7.2）。
- **INV-6 不产生空壳**：新建不得预写"3 个空幕/1 个空章"这类占位结构（对应 AUDIT R4 的 `repository.ts:260`）；旧占位只在迁移时被显式标注，且不得计入进度。
- **INV-7 单作品单任务**：同一作品同时最多 1 个 running job；第二个请求返回可读提示而非并发执行。

### 3.4 孤儿作品的定义（QA 判失败用）

三条任一成立即"孤儿"，判失败：

1. 存在一个作品：**无任何 AI 产物、无阶段状态、且作品列表卡片没有「企划未完成」标识与继续入口**；
2. 作品里存在**由新建流程预建的占位结构**（空幕、空章、占位人物），进度又显示为 0；
3. 点击创建后**未跳转、无进度、无错误**，页面停在原状（"无响应"）。

---

## 4. 长篇主流程（P0–P4）

### 4.0 总表（一页看清每阶段）

| | P0 立项 | P1 设定 | P2 故事大纲 | P3 章节计划 | P4 逐章写作 |
|---|---|---|---|---|---|
| **进入条件** | 用户点「新建作品」 | 作品已创建（无论是否勾选 AI 企划） | P1 `confirmed` 或 `skipped`；首次企划带回的 P2 初稿可先预览/编辑，但**确认必须等 P1 先确认**（顺序不倒挂） | P2 `confirmed` | P3 `confirmed` |
| **用户可编辑** | 标题/类型/题材/灵感/目标字数/风格 | 世界观、环境、人物逐字段 | 幕、节拍逐字段；增删/重排 | 章节数、每章功能/大纲/字数范围 | 正文任意编辑 |
| **可给 AI 意见** | —（尚无内容） | 阶段级 + 条目级 | 阶段级 + 条目级 | 阶段级 + 条目级 | 章节级（重写意见） |
| **AI 可重做范围** | 无 | 单块 / 整份；仅 P1，不碰 P2+ | 单幕单节拍 / 整份；不碰 P1 | 单章计划 / 整份；不碰 P1/P2 | 单章 / 单章扩写精简；不碰 P3 |
| **确认门槛** | 标题非空 + 模型可用（否则不建作品） | 人物≥1（姓名/身份/动机非空）+ 环境≥1（名称非空）+ 无空占位 + 世界规则已填或显式勾选"不需要" | 幕≥3（不足需显式确认）且每幕功能/摘要非空；主线≥10 字；主角出现在≥1 幕 | 每章功能/大纲/范围齐全；章节数 3–200；总字数偏差已处理 | 每章人工通过（approve/manual/skip 显式） |
| **失败/取消** | 表单保留，不建作品 | job 失败保留旧内容，可重试 | 同左 | 同左 | 单章失败不影响其它章 |
| **刷新/重启** | 表单不跨刷新（V1.1） | 状态+修订+确认持久 | 同左 | 同左 | 进度持久，running→interrupted 可恢复 |

### 4.1 P0 立项（新建作品）

**入口**：作品库「新建作品」；AUDIT 现场用的同一入口（`StudioPage.tsx:888`）。

**字段（必填标 *）**

| 字段 | 类型 | 默认 | 校验 |
|---|---|---|---|
| 标题* | 单行 | — | 去空格后 1–80 字；重复标题允许（提醒不阻断） |
| 类型* | 长篇/短篇（+ 电影剧本/剧集大纲，走旧路径） | 长篇 | 选择短篇时目标字数默认 12000；长篇 300000 |
| 题材 | 单行/标签 | 空 | 最长 40 字 |
| 一句话灵感 | 多行 | 空 | 最长 500 字；短篇建议必填（提示不阻断） |
| 目标字数 | 数字 | 长篇 300000 / 短篇 12000 | 长篇 [1 万, 300 万]；短篇 [3000, 15000] |
| 风格与禁区 | 多行 | 空 | 最长 300 字（进 prompt） |
| 创建后立即 AI 企划 | 勾选 | 勾选（与现状一致） | 仅 novel/short 显示 |

**用户操作**：填写、切换类型、创建、取消（Esc/遮罩不丢失已填内容）。

**AI 可做**：无（P0 不调用模型）。

**确认门槛（创建前校验，不通过则不建作品）**：
- 标题非空；
- 若勾选"AI 企划"：默认模型存在且 provider 已启用且凭据可用（`ollama`/自定义 `baseUrl` 视为可用）。不满足时**不创建作品**，弹前置提示：`无法开始 AI 企划：未配置默认模型` + 「去设置」直达 + 「先创建，稍后企划」（后者创建后进 `draft` 状态）。

**失败**：DB/网络错误 → 弹窗保持打开、输入保留、显示可读错误与「重试」；不得半创建（标题已落库但阶段缺失）。

**取消**：关闭弹窗，无副作用（不建作品）。

**恢复**：P0 无生成任务，不涉及恢复；若创建请求已发出但客户端断网，重进作品库若已存在同名作品则直接进入，不重复创建（以服务端返回的项目 id 为准）。

**刷新/重启**：V1 不要求表单草稿跨刷新保持（列入 V1.1）。

**验收锚点**：`new-project-form`、`new-project-submit`、`new-project-precheck`（data-code）。

### 4.2 P1 设定（世界观/环境 + 人物）

**进入条件**：作品已创建（`draft` 且用户点「开始 AI 企划」，或创建时勾选 AI 企划自动开始）。

**内容结构（可编辑的最小单位）**

| 分组 | 条目字段 | 说明 |
|---|---|---|
| 世界观 | 时代/地点设定、世界规则（力量体系/科技/社会）、基调与母题、语言与称谓习惯 | 长篇建议必填规则与基调；短篇可只填基调 |
| 环境 | 名称、类型（城/村/机构/异境）、氛围关键词、出场理由 | ≥1 个（可由 AI 一次生成 2–4 个） |
| 人物 | 姓名、身份/职业、年龄、外形一句话、动机（想要什么）、缺陷/秘密、关系、口头禅（可选）、弧光（从…到…） | 主角 ≥1；配角 0–20 |

**用户可操作**
- 逐字段编辑任意条目；新增/删除条目；调整主角/配角标记；
- **条目级反馈**：在条目卡片上写意见（如"动机太弱，改成为了找妹妹"）→ AI 只重写该条目；
- **阶段级反馈**：阶段底部意见框（"整体更黑暗一点，去掉现代梗"）→ AI 重写整份 P1；
- **单块重生成**（世界观/环境/人物分别重生成，其它块不变）；
- **整份重生成**（保留旧修订可回滚）；
- **历史**：查看该阶段/条目所有修订（来源、意见、时间），可"恢复为当前"；
- **跳过本阶段**（仅 P1 允许，需二次确认，记录为 `skipped` 决策并进 INV 审计）；
- **确认**。

**AI 可重做范围**：只重做 P1（整份或指定条目/分组）。**禁止**：改写 P2 及之后；禁止在 P1 重生成时删除用户手改的其他条目（未参与重生成的条目原样保留）。

**确认门槛（全部满足才可确认）**
1. 至少 1 个人物，且 `name`、`role`、`motivation` 非空；
2. 环境 ≥1 条且名称非空；
3. 无空占位条目（名字为空/`未命名`/`角色A` 之类模板占位 → 阻断并高亮）；
4. 若世界观"世界规则"为空，需用户显式勾选"本书不需要明确规则"（短篇默认勾选）。

**失败/取消/恢复**：job 失败 → 保留已有内容，`status=failed` + 错误卡（可重试）；取消 → 保留旧内容，回到 `review`（若原本 empty 则回 `empty`）；重试只重跑失败步骤。

**刷新/重启**：阶段状态、条目、修订、确认快照全部持久；生成中刷新 → 页面重连进度（7.4）。

**验收锚点**：`stage-p1`（data-status）、`item-card[data-kind=world|env|character]`、`item-edit`、`item-regen`、`item-feedback`、`item-history`、`stage-feedback`、`stage-regen-all`、`stage-skip`、`stage-confirm`、`stage-stale-banner`。

### 4.3 P2 故事大纲

**进入条件**：P1 `confirmed` 或 `skipped`。首次企划 job 会用刚生成的 P1 作为上下文一并带回 P2 初稿；此时 P2 可**预览与编辑**，但确认按钮 disabled（文案「请先确认设定」），保证确认顺序不倒挂。

**内容结构**

| 长篇 | 短篇 |
|---|---|
| 主线一句话（logline） | 主线一句话 |
| 幕（默认 3，范围 2–12）：标题、功能（钩子/推进/转折/揭示/高潮/收束）、摘要（2–5 句）、涉及人物 | 节拍组（可选，默认单组"全篇"） |
| 幕下节拍（每幕 2–12 条）：标题、功能、摘要、预计章节（可空）、伏笔/回收标记 | 节拍（6–40 条）：标题、功能、摘要（1–3 句） |

**用户可操作**：编辑任意字段；增删幕/节拍；拖拽重排；**条目级反馈**（"第三幕转折太晚，提前到第二幕中段"）；**阶段级反馈**；单幕/单节拍重生成；整份重生成；历史回滚；确认。

**AI 可重做范围**：只重做 P2；不得改动 P1（若用户想改设定，必须回 P1，走 4.6 的 stale 机制）。

**确认门槛**
1. 长篇：幕 ≥2 且 ≤12（V1 默认要求 ≥3，少于 3 需用户显式"我只要短三幕/双幕"）；短篇：节拍 ≥3 且 ≤40；
2. 每幕/每节拍：功能非空、摘要非空（≥15 字）；
3. 主线一句话非空（≥10 字）；
4. 主角（P1 中 role=主角的人）至少出现在 1 个幕/节拍；
5. 通过后点击「确认故事大纲」。

**失败/取消/恢复**：job 失败 → 保留既有幕/节拍，`status=failed` + 错误卡 + 重试（只重跑未完成步骤，已有内容不重复写入）；取消 → 保留旧内容回到 `review`（原本 `empty` 则回 `empty`）；恢复 → 重启后 `interrupted` 可继续。

**刷新/重启**：幕/节拍的编辑、修订、确认状态持久；生成中刷新重连进度；重新排序后序号连续且不丢条目。

**验收锚点**：`stage-p2`、`act-card`/`beat-card`（data-kind=act|beat）、`outline-logline`、`act-add`、`act-reorder`、`stage-confirm`。

### 4.4 P3 章节计划（长篇）

**进入条件**：P2 `confirmed`（且 P1 `confirmed`/`skipped`）。

**生成方式**：用户点「生成章节计划」→ AI 给出**章节数量建议**、每章**功能**、**章节大纲**（2–5 句）、**建议字数范围**、涉及人物。生成后进入可编辑的表格/卡片视图。**首次企划不自动生成 P3**（必须先由用户确认设定与大纲，见 4.0 与 6.2）。

**字段**

| 字段 | 说明 | 默认/规则 |
|---|---|---|
| 章节数 | 全书章数（含卷归属可选） | AI 建议值 = clamp(round(目标字数 / 3000), 3, 200)；用户可改 |
| 卷 | 卷名/卷号（可选，长篇） | 单卷默认"第一卷" |
| 章标题 | 每章标题 | AI 生成，可改 |
| 章功能 | 钩子/推进/转折/揭示/高潮/收束/缓冲（可多选） | 必填 |
| 章节大纲 | 2–5 句 | 必填 |
| 字数范围 | min–max + 目标 target | 默认 min 2500 / max 4000 / target 3000；三档预设：快节奏 1500–2500（t 2000）、标准 2500–4000（t 3000）、厚重 4000–6000（t 5000） |
| 涉及人物 | 从 P1 引用 | 可选 |
| 锁定 | 用户锁定后不被"按比例重算/批量应用"改动 | 默认未锁 |

**用户可操作**
- 改章节数（输入框；减少时**凡是已有正文的章不得被删除**——必须让用户选择"保留为待归档章节"或取消本次调整）；
- 插入/删除/拆分/合并章节（拆分/合并需用户确认，**不自动合并已写正文**）；
- 编辑任一字段；批量应用字数预设；锁定/解锁单章；
- 单章计划重生成、整份重生成、阶段级/条目级反馈、历史回滚；
- 确认章节计划。

**校验（界面实时显示，阻断确认）**
1. 每章：功能非空、大纲非空（≥15 字）、`300 ≤ min ≤ target ≤ max ≤ 20000`；
2. 章节数 3–200；
3. `Σtarget` 与目标字数偏差 ≤25% 才允许确认；超出时显示"总目标 27.5 万字 / 全书目标 30 万字（-8.3%）"并给两种处理：调整字数范围 / 勾选"接受偏差"；
4. 未确认前，P4 的「开始写作」入口 disabled，并显示原因文案（"请先确认章节计划"）。

**AI 可重做范围**：只重做 P3；不得改动 P1/P2；重生成时若某章已锁定或已有正文，默认**保留该章**，只重做其余章（用户可显式选择"连锁定章一起重做"）。

**失败/取消/恢复**：同 4.2；生成中用户改章节数 → 不打断 job，但 job 完成后以"新计划"呈现并提示"生成期间你改过章节数，已按最新设置为准"。

**刷新/重启**：草稿式编辑需自动保存（≥2s 防抖或失焦保存），刷新不丢。

**验收锚点**：`stage-p3`、`chapter-plan-row`（data-id, data-words-min, data-words-max, data-words-target, data-locked）、`chapter-plan-count`、`chapter-plan-total`、`chapter-plan-preset`、`chapter-plan-confirm`、`stage-regen-all`。

### 4.5 P4 逐章写作

**进入条件**：P3 `confirmed`。

**单元状态**：见 3.2 `Chapter.reviewStatus`。界面每章显示：状态、字数、当前版本、上一版本可回滚。

**用户可操作**
- **生成本章** / **连续生成**（从第一个 `pending` 起逐章生成到最后一章，全部写完后统一进入逐章审阅；不要求每章 approved 才写下一章）；
- **暂停**：当前章写完后暂停（默认，安全）；**立即停止**：中断当前章并丢弃未完成正文（二次确认，正文不写入）；
- **继续**：从下一个 `pending` 继续；`interrupted` 后可恢复；
- **重写本章**：可带意见（"对话太多，压缩到 1500 字，结尾加钩子"）→ 新版本，旧版本保留可回滚；
- **扩写/精简**：当字数不在范围内，一键按范围重写（同样留旧版本）；
- **编辑正文**（人工改）→ 改后可直接「通过（人工）」；
- **通过** / **退回重写**（必填意见）/ **跳过本章**（显式，计入完成度但不写正文）；
- 调整**后续章**计划（会触发后续 `stale` 提示，不得改已 approved 章）。

**AI 可重做范围**：单章、单章扩写/精简。**禁止**：改动已 `approved` 的章（除用户显式重写）、改动 P3 计划、跨章批量改写未获用户确认。

**确认门槛**：每章必须人工 `approved` / `approved_manual` / `skipped`。全书 `completed` 的判据：**所有章都处于终态**（approved/approved_manual/skipped），且没有 `in_review`/`changes_requested`。

**失败/取消/恢复**：单章失败只影响该章（其余章状态不变），错误卡提供「重试本章」；暂停/取消不写半截正文（INV-3）；重启后 job → `interrupted`，恢复从下一 `pending` 开始，已完成章不重写。

**刷新/重启**：进度、每章状态、每章版本持久；页面上「继续写作」按钮位置与状态一致。

**验收锚点**：`stage-p4`、`write-start`、`write-continue`、`write-pause`、`write-stop`、`chapter-row`（data-status, data-words）、`chapter-approve`、`chapter-request-changes`、`chapter-rewrite`、`chapter-expand`、`chapter-shrink`、`chapter-version-list`。

### 4.6 跨阶段规则

**R1 上游结构性变更 → 下游标 `stale`，内容不删。**
"结构性变更"清单：
- P1：增删人物、改主角、改世界规则核心条款；
- P2：增删幕/节拍、改主线一句话；
- P3：改章节数、拆分/合并章节、调整章序。
触发后：下游 `stale=true`，界面顶部横幅"上游已变更，建议复核" + 三个动作：`复核并保留`（清 stale）/ `按上游重排`（生成新修订）/ `忽略`（保留 stale 标记 7 天或直到用户再次操作）。**已写正文永不因上游变更被删**；已 `approved` 章不受影响。

**R1a `stale` 不 gate（V1 定案）。** `stale` 只做提示，不阻断确认、开始写作与审阅：`nextStep` 仍返回原动作，但附带 `hint`（文案「上游阶段有变更尚未复核，建议先处理再继续写作」）与 `blockers: ["<stage>:stale"]`；用户点「复核并保留」/「按上游重排」/「忽略」之一即清掉该提示。这样既不丢提示，也不会把用户锁在半成品状态里；要改成强制 gate 需另开需求。

**R2 已确认内容变更路径。** 用户编辑或 AI 重生成 `confirmed` 阶段 → 该阶段回到 `review`（内容即时更新，确认快照仍在），并触发 R1 对其下游的 `stale`。

**R3 并发。** 同作品同时只允许 1 个 running job（INV-7）：第二个操作返回 `409` 语义，界面提示"当前有生成任务进行中（设定/大纲），请先取消或等待完成"并给「查看进度」。不同作品可并行，全局并发上限 3，超出排队并在卡片显示队列位置。

**R4 反馈的生效范围。** 条目级反馈只重写该条目；阶段级反馈重写该阶段全部条目（但用户已"锁定"的条目除外——锁定是 P1/P2 的可选能力，默认未锁）。每次反馈都写 Revision（note = 用户原文），界面显示"AI 做了哪些修改"的摘要（至少：改了 N 个条目 + 每条一句话 diff）。

**R5 不做自动重试烧钱。** 除 429/网络抖动允许自动重试 1 次外，其余错误一律停下等用户。取消必须真停（服务端释放上游连接，≤5s）。

**R6 确认顺序不倒挂。** 只允许 P1→P2→P3→P4 的正向确认；下游内容可以提前生成/预览/编辑（首次企划一次带回 P1+P2 即属此列），但**确认按钮必须按序解锁**，且服务端在确认接口上二次校验上游已 `confirmed` 或 `skipped`（否则返回 `STAGE_LOCKED`）。

**R7 路由只增不改。** 新增 `/project/:projectId/pipeline`（流水线页）；`/project/:projectId` 保持为写作台（P4 的编辑器视图）；`/outline`、`/codex`、`/screenplay`、`/settings` 不变。旧作品默认仍落在写作台。

---

## 5. 短篇等价结构

### 5.0 复用声明（避免短篇被实现成"另一套流程"）

短篇的 **P0/P1/P2 与长篇完全同规则**：第 4.1/4.2/4.3 的进入条件、用户可操作、AI 可重做范围、确认门槛、失败/取消/恢复、刷新与重启保持**逐条适用**，差异只有 5.1 表里的字段与文案（目标字数、世界规则可空、幕→节拍组）。因此短篇不存在"少一阶段"或"跳过 REVIEW"。

### 5.1 差异总表

| | 长篇 | 短篇 |
|---|---|---|
| P0 目标字数 | 默认 300000，[1 万, 300 万] | 默认 12000，[3000, 15000] |
| P1 设定 | 世界观 + 环境 + 人物 | 同结构，但"世界规则"可空（默认勾"不需要"）；环境 ≥1 |
| P2 故事大纲 | 幕（2–12）+ 幕下节拍 | 节拍组 + 节拍（6–40），UI 不显示"幕"字 |
| P3 | 章节计划（章数 3–200） | **节拍计划**：节拍数（3–40，默认 8）、每节拍功能/大纲/字数范围（默认 800–2500，target 1500） |
| P4 | 逐章写作 | **逐节拍写作**（同一状态机与 REVIEW 门槛） |
| 正文组织 | 卷/章 | 单一正文流（节拍按序拼接，导出为一个章节/一篇） |
| 界面 | 章节列表 | 节拍列表；**不显示卷/章 UI，不创建空章**（断言 `chapter-row` 计数 = 0） |

短篇的 `beats` 与长篇 `outline_beats` 可共用存储，但**必须**能区分"P2 大纲节拍"与"P3 节拍计划单元"（不同 kind），避免混用。

### 5.2 短篇 P3（节拍计划）

- **进入条件**：P2 `confirmed`（同 4.4 的顺序门槛；P1 已 `confirmed`/`skipped`）。
- **内容结构**：节拍列表，每节拍含：序号、标题、功能（钩子/推进/转折/揭示/高潮/收束/缓冲）、节拍大纲（1–3 句）、字数范围（min–max）+ target、涉及人物（可选）、锁定开关。
- **用户可操作**：改节拍数（默认由 AI 建议 = clamp(round(目标字数 / 1500), 3, 40)）；插入/删除/拆分/合并/重排节拍；编辑任一字段；批量应用字数预设（极短 500–1200/t900、标准 800–2500/t1500、舒展 1500–3500/t2500）；单节拍重生成、整份重生成、阶段级/条目级反馈、历史回滚；确认节拍计划。
- **AI 可重做范围**：只重做 P3；不碰 P1/P2；重做时锁定节拍与**已写正文的节拍**默认保留。
- **确认门槛**：① 节拍数 3–40；② 每节拍功能非空、大纲非空（≥15 字）、`300 ≤ min ≤ target ≤ max ≤ 20000`；③ `Σtarget` 与目标字数偏差 ≤25%（超出需显式"接受偏差"）；④ 确认前 P4 入口 disabled 并显示"请先确认节拍计划"。
- **失败/取消/恢复**：同 4.2/4.4（job 失败保留既有内容可重试；取消回退到旧内容；重试只重跑未完成步骤）。
- **刷新/重启**：未确认的编辑自动保存（≥2s 防抖），刷新不丢；生成中刷新重连进度。
- **合并/拆分的特例**：短篇正文按整篇组织，所以拆分/合并不涉及"正文如何合并"；但**已写正文的节拍不能从计划里消失**——若用户删除，必须选择"归档该节拍"（正文保留在归档区可查看/导出）。
- **验收锚点**：`stage-p3`、`beat-plan-row`（data-id, data-words-min/max/target, data-locked）、`beat-plan-count`、`beat-plan-total`、`chapter-plan-preset`（复用同一锚点）、`chapter-plan-confirm`（复用，语义为确认节拍计划）。

### 5.3 短篇 P4（逐节拍写作）

- **进入条件**：P3（节拍计划）`confirmed`。
- **单元与状态**：节拍即写作单元，`reviewStatus` 状态机与 3.2 完全一致（`pending|generating|in_review|approved|changes_requested|approved_manual|skipped`）。
- **用户可操作**：生成单个节拍 / 连续生成（逐节拍停）、暂停（写完当前节拍）、立即停止（丢弃当前节拍未完成内容，二次确认）、继续、重写单节拍（可带意见）、扩写/精简到字数范围、编辑正文、通过/退回/跳过、调整后续节拍计划（触发下游 stale）。
- **AI 可重做范围**：单节拍、单节拍扩写/精简；不改已 `approved` 节拍、不改节拍计划。
- **确认门槛**：每节拍人工终态（approved / approved_manual / skipped）；全篇 `completed` = 所有节拍终态。
- **失败/取消/恢复**：单节拍失败不影响其他节拍；不写半截正文；重启后 `interrupted` 可恢复，从下一 `pending` 节拍继续。
- **刷新/重启**：同 4.5（进度、每节拍状态、版本持久）。
- **存储与导出（实现约束，不指定字段名）**：正文按整篇保存，但每个节拍必须有稳定的边界（边界标记或独立段落块），保证"重写某一节拍不影响其他节拍"；导出 `export.md` 输出整篇连续正文，字数统计以整篇为准并逐节拍显示偏移；短篇**不产生章节记录**（断言 `chapters` 无该作品行或 `chapter-row` 计数 = 0）。
- **验收锚点**：`stage-p4`、`write-start`/`write-continue`/`write-pause`/`write-stop`、`beat-row`（data-status, data-words；短篇不渲染 `chapter-row`）、`chapter-approve`/`chapter-request-changes`/`chapter-rewrite`/`chapter-expand`/`chapter-shrink`（复用锚点，作用对象为节拍）。

---

## 6. 「新建并让 AI 企划」的四态验收（缺陷核心）

### 6.1 交互时序（硬性）

```
t=0ms      用户点击「创建并让 AI 企划」
t≤300ms    按钮 → disabled，文案变「正在创建…」；防重复提交（再点无效）
t≤500ms    作品已落库 + 关闭弹窗 + 进入流水线页 /project/:projectId/pipeline
           （新增路由；/project/:projectId 仍是写作台，作为 P4 的编辑器视图，既有路由不改）
           ★ 页面必须已有可见进度视图（不是空白、不是 spinner-only）
t=0.5–15s  进度显示：阶段名（正在生成设定…）+ 已用秒数（每 ≤2s 更新）+「取消企划」
t≈15s      追加提示条：「正在生成，通常需要 20–60 秒 · 可先离开，作品已保存」+「取消企划」
t=完成     ① 成功：进入 P1 设定视图（data-status=review），顶部「AI 企划完成，请审核设定」，
              同时 P2 已生成待确认；② 失败：错误卡；③ 取消：已取消态
任意时刻   页面顶部必须有可见状态（运行中/失败/已完成/已取消），刷新后从持久化状态重建
```

**为什么不在弹窗里等待**：AUDIT 证明现有弹窗在 40s 等待期完全静止（`primary=null`、`busyText=false`），且重载即丢状态。改为"创建即落库 + 跳转流水线页 + job 后台跑"后，等待有进度、可离开、可回来，`Escape`/刷新都不再是"放弃"。

### 6.2 四态契约表（QA 按此断言）

| 态 | 触发 | 必须可见（≤1s 内） | 必须可做 | 数据要求 | 禁止 |
|---|---|---|---|---|---|
| **加载** | 点击后至 job 结束 | `plan-progress[data-state=running]`、阶段名、已用秒数、`plan-cancel` 可点 | 取消；离开页面（job 继续）；随时回来看到进度 | 作品已落库；stage=p1 generating；job.status=running | 主按钮消失且无文案；整屏灰掉无解释；15s 内无任何界面变化 |
| **成功** | job done | P1 视图（`stage-p1[data-status=review]`）+ 「AI 企划完成」+ 人物≥1/环境≥1 + P2 初稿已生成（`stage-p2[data-status=review]`，确认按钮在 P1 确认前 disabled） | 编辑 P1、反馈、重生成、确认；P1 确认后审阅并确认 P2 | P1/P2 有修订；job=done；日志有 ok 行 | 自动生成 P3；自动写正文；把内容直接标为 confirmed；P1 未确认就允许确认 P2 |
| **失败** | 超时/供应商错/内容非法 | `plan-error[data-code]` + 中文原因 + `plan-retry` + 「去设置」+ `plan-delete`（删作品） | 重试（只重跑失败步骤）；改设置；删作品；进入作品手动写 | job=failed + errorCode + `lastError` 持久化；日志有 fail 行 | 空白页；只吐 502 无文案；失败后仍显示"企划中"；失败留空壳结构 |
| **取消** | 点「取消企划」 | `plan-progress[data-state=cancelled]` + 「已取消企划」+ `plan-continue` + 「先自己写」 | 继续企划（新 job）；进入 P1 手动填；删除作品 | job=cancelled；上游连接 ≤5s 释放；已成功步骤的产物保留为未确认修订 | 半截条目落库；取消后仍烧 token；取消后无出路 |

**四态之外的第零态（前置拦截）**：无默认模型/无 Key 时不进入任何态——不创建作品，弹前置提示（见 4.1 与 7.1 `NO_DEFAULT_MODEL`）。

### 6.3 进度真实性的要求

- 进度**必须来自 job 状态**（DB/服务端），不能是前端定时器假装。判据：job 停止推进时（如供应商挂死），已用秒数继续增长但阶段文案停在最后已知步骤，且 120s 超时后转失败；
- 步骤名必须对应真实步骤："正在生成设定…"→"正在生成故事大纲…"→ 完成；不得显示并不存在的步骤；
- 如可获取，显示 `已生成 3/4 个人物` 这类计数；不可获取时**不要编造百分比**（禁止假的 37%）。

### 6.4 红线（QA 一条不满足即判缺陷，对应"无响应"）

- **R-1**：点击后 >500ms 仍无任何进度可见元素 → 缺陷；
- **R-2**：等待期间任一时刻（>1s 后）没有可见的「取消」入口 → 缺陷；
- **R-3**：任意连续 15s 内界面无任何变化（无秒数变化、无文案变化、无 spinner）→ 缺陷（这就是"无响应"的定义）；
- **R-4**：失败/取消后界面无出路（无重试、无继续、无删除、无法进入作品）→ 缺陷；
- **R-5**：失败/取消后留下孤儿作品或占位结构（第 3.4 定义）→ 缺陷；
- **R-6**：刷新后丢失"企划进行中/失败"状态，回到空白页 → 缺陷；
- **R-7**：双击提交产生 2 个作品 → 缺陷。

---

## 7. 失败 / 取消 / 恢复可观测性

### 7.1 错误分类表（服务端必须给出 code，界面必须给中文与下一步）

| code | 触发 | 界面文案要点 | 可重试 | 下一步按钮 |
|---|---|---|---|---|
| `NO_DEFAULT_MODEL` | settings 无 defaultModel | 未配置默认模型 | 否（先配置） | 去设置 |
| `NO_API_KEY` | provider 需 Key 但为空 | 该供应商未填写 API Key | 否 | 去设置 |
| `AUTH_FAILED` | 401/403 | API Key 无效或无权限 | 否 | 去设置 |
| `MODEL_NOT_FOUND` | 404 | 模型不存在或未开通 | 否 | 换模型 |
| `REASONING_UNSUPPORTED` | 推理等级与模型能力不匹配（`plan.ts:149-151`） | 模型不支持该推理等级 | 否 | 重置推理等级 |
| `RATE_LIMIT` | 429 | 请求过于频繁/额度不足 | 是（自动 1 次） | 重试 |
| `PROVIDER_TIMEOUT` | 单步超 120s | 供应商超时（已等 N 秒） | 是 | 重试 / 换模型 |
| `PROVIDER_ERROR` | 5xx | 供应商返回错误（状态码） | 是 | 重试 |
| `NETWORK` | 连接失败/DNS | 无法连接供应商 | 是（自动 1 次） | 重试 / 去设置 |
| `EMPTY_OUTPUT` | content 为空（推理模型只回 reasoning，`plan.ts:104`） | 模型未返回正文内容 | 是 | 重试 / 换模型 |
| `INVALID_JSON` | 解析失败/结构不符 | 模型输出格式不对 | 是 | 重试 |
| `CONTENT_BLOCKED` | 内容策略拦截 | 内容被供应商拦截 | 否 | 调整设定/换模型 |
| `QUOTA_EXCEEDED` | 余额不足 | 账户余额不足 | 否 | 去供应商充值 |
| `CANCELLED` | 用户取消 | 已取消 | — | 继续企划 |
| `INTERRUPTED` | 进程重启/崩溃 | 生成被中断（已保留已完成部分） | 是 | 恢复 |
| `STAGE_LOCKED` | 未满足进入条件 | 请先确认上一阶段 | 否 | 跳到上一阶段 |
| `CONCURRENT_JOB` | 同作品已有 job | 当前有生成任务进行中 | — | 查看进度 |
| `MIGRATION_FAILED` | 旧作品升级失败 | 升级失败，已回到升级前状态 | 是 | 重试 / 回退 |

**文案规则**：错误必须包含 ①发生了什么（一句人话）②影响范围（哪一阶段/哪一章没完成）③下一步（按钮）。禁止只显示 `502 Bad Gateway` 或一句英文异常。

### 7.2 取消语义（AUDIT R3 修复）

| 动作 | 语义 |
|---|---|
| 点「取消企划」/「停止写作」 | 显式取消：服务端把 job 置 `cancelRequested` 并 **abort 上游请求**，≤2s 界面转为 cancelled，≤5s 上游连接关闭；已成功步骤的产物保留（未确认修订） |
| 关闭页面 / 刷新 / 切路由 | **不取消**：job 继续跑，页面回来从持久化状态重建进度（INV-5） |
| 关闭应用 / 进程崩溃 | job → `interrupted`；重启后可「恢复」，只重跑未完成步骤/章节 |
| 暂停（P4） | 当前章写完后停，状态 `paused`；与"立即停止"区分（后者丢弃当前章未完成正文） |

判据（QA 可测）：取消后 `fake-provider` 日志显示请求连接被关闭（`req.on('close')`），且服务端在 ≤5s 内不再收到上游响应；项目/章节里没有半截内容（比对请求前后条目数）。

### 7.3 重试与幂等

- 重试**新建 job**（`retryOfId` 指向原 job），不复用原 job id；已成功步骤不重跑（只重跑失败步骤）；
- 重试不得产生重复条目/重复章节：同一 stage 的"当前版本"由 revision 指向，重试覆盖当前展示版本而不新增重复条目；
- 单章重写产生新版本；`chapter_versions` 保留旧版本，可回滚。

### 7.4 重启恢复

- 服务启动时扫描 `running` job → 置 `interrupted` 并写日志；
- 流水线页/写作台顶部横幅："上次生成被中断（设定/第 3 章）"+「恢复」+「放弃」（放弃只清 job，不删内容）；
- 恢复语义：P1/P2/P3 重跑未完成步骤；P4 从下一个 `pending` 章继续，不重写已完成章。

### 7.5 可观测性（AUDIT R6 修复）

必须落地的三件事：

1. **job 表持久化**（见 3.1），页面可查最近 20 条；
2. **结构化日志**（`logs/server.log`，一行一条，便于 grep）：
   ```
   [job] id=job_xxx project=p_xxx stage=p2 step=outline status=start provider=deepseek model=deepseek-chat
   [job] id=job_xxx project=p_xxx stage=p2 step=outline status=fail code=PROVIDER_TIMEOUT dur=120034ms
   [job] id=job_xxx project=p_xxx stage=p4 chapter=ch_xxx status=cancel
   ```
   要求：失败必写（当前 `index.ts:109` 只回 502，日志为零）；取消必写；成功必写（含 usage）。
3. **项目级 `lastError`**：`{code, message, at, stage, chapterId?}` 持久化到项目，界面"作品详情/流水线页"可见，刷新/重启后仍在。

---

## 8. 刷新 / 重启后的状态保持（逐项断言）

| 状态 | 刷新页面 | 关页面再回 | 重启服务/应用 | 断言方式 |
|---|---|---|---|---|
| 阶段内容与修订历史 | 保留 | 保留 | 保留 | `GET /api/projects/:id/pipeline` 前后 diff 相等 |
| 阶段确认状态（confirmed/skipped） | 保留 | 保留 | 保留 | 同上 |
| `stale` 标记 | 保留 | 保留 | 保留 | 同上 |
| 运行中 job | 重连进度（轮询/SSE 均可） | 继续跑，回来可见 | `running`→`interrupted`，可恢复 | job 状态 + 进度元素 |
| 章节计划未确认的编辑 | 自动保存，刷新不丢 | 保留 | 保留 | 编辑后刷新读取相同值 |
| 章节正文 | 保留（每章原子） | 保留 | 保留 | 字数与内容全等 |
| 章节审核状态（approved 等） | 保留 | 保留 | 保留 | 同上 |
| 逐章生成进度（已完成到第 N 章） | 保留 | 保留 | 保留（job interrupted 可恢复） | 第 N+1 章仍 `pending` |
| 失败错误卡 | 保留（来自 lastError） | 保留 | 保留 | 刷新后 `plan-error` 仍在 |
| 新建表单草稿 | **不要求（V1.1）** | — | — | — |

---

## 9. 旧作品迁移与回退

### 9.1 三条原则

1. **不迁移也能用**：旧作品默认继续走现有写作台（`StudioPage`），打开不报错、正文/版本/设定全在。流水线页对旧作品显示 `legacy` 横幅：`这是旧版作品，升级后可分阶段使用 AI 企划` + 「升级」+「继续用编辑器」。
2. **升级是显式动作**：不自动迁移，不在后台偷偷跑；升级前必须备份。
3. **可回退**：升级失败自动回滚；成功后也可手动回退（有代价，见 9.4）。

### 9.2 升级流程（必须按序，任一步失败整体回滚）

```
S1 前置检查：作品可读、无其它 running job、磁盘可写
S2 备份：数据目录内 studio.db → studio.db.bak-<migrationId>（migrationId 落库），
        并另存一份 bundle JSON 到 <dataDir>/backups/<projectId>-<ts>.json
S3 结构补齐：在单个事务内创建 stages/stage_items/revisions 等记录，做 9.3 映射
S4 校验：逐项比对（9.5），任一不等 → ROLLBACK
S5 提交：写 migrationId 到项目 + migration 记录（时间、旧 schema 版本、结果）
S6 界面：升级完成提示 + 「查看阶段视图」；旧入口仍保留（兼容入口）
```

### 9.3 旧数据 → 阶段映射表

| 阶段 | 来源 | 映射规则 |
|---|---|---|
| P0 立项 | Project | 已 confirmed（沿用标题/类型/目标字数） |
| P1 设定 | `characters` | 每条 → 人物条目；`role`/`quote`/`secret`/`description` 原样带上；标 `source=migration`，状态 `confirmed` |
| P1 环境/世界观 | 无旧字段 | 不造占位内容。characters 非空 → P1 `confirmed`（**迁移特例**：允许环境为空，UI 提示"旧作品没有环境设定，可补充"；一旦用户编辑 P1，则回到 `review` 并按 4.2 完整门槛校验）。characters 为空 → P1=`empty` |
| P2 故事大纲 | `outline_acts` + `outline_beats` | 幕/节拍一一映射，`summary`/`tags` 原样；状态 `confirmed`；为空则 `empty` |
| P3 章节计划 | `chapters`（含卷/序/标题/words） | 每章 → 计划条目：标题保留；功能 = `迁移（未标注）`；大纲 = 匹配 `chapterNo` 的 beat 摘要，否则空；字数范围 = `[max(300, words), max(words+1500, 3000)]`，target = `max(words, 3000)` |
| P4 逐章 | `chapters.content` 非空 → `approved_manual`；空内容 → `pending`（UI 标"空章"，**允许用户一键删除，但迁移不删**） | 正文零改动 |
| 版本 | `chapter_versions` | 原样保留；最新的作为"当前版本"，其余在历史里可回滚 |

### 9.4 回退

- **升级失败**：自动 ROLLBACK（DB 事务）+ 保留备份文件 + 提示 `MIGRATION_FAILED`，作品仍可打开（旧数据未变）。
- **升级成功后手动回退**：设置/作品菜单「回退到升级前」。
  - 若升级后**没有**新增正文/版本/确认（比对时间戳与行数）→ 直接恢复 `studio.db.bak-<migrationId>`，无损耗；
  - 若升级后**有**新内容 → 明确警告："回退将丢失升级后产生的 N 章正文 / M 条修改"，需输入确认词，并把当前库先另存 `studio.db.pre-rollback-<ts>` 以便再找回。ADR-22 的归档口径是“不删行、降级时归档”，不是自动清理；回退警告中的 N/M 必须按真实行数计算。
  - 回退后旧流程仍可打开（与 9.1 一致）。

### 9.5 升级校验清单（QA 逐条断言，见 S6）

1. 章节数相等；
2. 每章 `content` 字符串**逐字节相等**（含空行/空白）；
3. 每章 `words` 相等；
4. `chapter_versions` 行数相等，且每条版本 content **逐字节相等**（最新版本与 `chapters.content` 一致）；
5. `characters` / `outline_acts` / `outline_beats` 行数相等，且关键字段（name/title/summary）相等；
6. `scenes` / `foreshadows` 行数相等（短篇/剧本相关数据不得丢）；
7. 项目标题/类型/目标字数/封面等元数据相等；
8. 升级**未调用任何模型**（QA 用假 provider 观测零请求）；
9. 二次升级幂等（再次点升级不重复插入条目）。

### 9.6 导入/导出与备份

- `GET /api/projects/:id/bundle` 保持 `format: 'inkquay.project'`, `version: 1`，**追加可选字段** `pipeline`（阶段/条目/修订/确认）；旧客户端忽略未知字段。
- 导入：v1 缺 `pipeline` 或旧导出 → 按旧作品处理（`legacy`，可升级）；含 `pipeline` → 直接进新流程。
- 迁移前备份必须是**整库文件副本**，不能只导出 bundle（bundle 不含所有表）。

---

## 10. 字数与配额规则（数字都在这里，实现与测试照抄）

### 10.1 默认值

| 项 | 长篇 | 短篇 |
|---|---|---|
| 目标字数默认 | 300000 | 12000 |
| 目标字数范围 | 10000–3000000 | 3000–15000 |
| P3 单元数默认 | clamp(round(goal/3000), 3, 200) | clamp(round(goal/1500), 3, 40) |
| 每单元 target 默认 | 3000 | 1500 |
| 每单元范围默认 | [2500, 4000] | [800, 2500] |
| 范围硬边界 | min ≥ 300，max ≤ 20000，min ≤ target ≤ max | 同 |
| 三档预设 | 快 1500–2500/t2000；标准 2500–4000/t3000；厚重 4000–6000/t5000 | 极短 500–1200/t900；标准 800–2500/t1500；舒展 1500–3500/t2500 |
| 总字数偏差阈值 | ±25%（超出需显式"接受偏差"） | 同 |
| 单步模型超时 | 120000ms | 同 |
| 进度更新间隔 | ≤2000ms | 同 |
| 取消响应 | 界面 ≤2s，上游释放 ≤5s | 同 |

### 10.2 生成时如何用范围

- prompt 中写入 `目标 3000 字，范围 2500–4000 字`，并要求模型**不要为凑字数灌水**；
- 生成后按实际字数判定（汉字按字符数，不含空白；沿用现有 `words` 口径）：
  - `words < min*0.9` → 标"偏短"，给「扩写」；
  - `words > max*1.1` → 标"偏长"，给「精简」；
  - `min*0.9 ≤ words ≤ max*1.1` → 正常；
  - `finish_reason=length` → 标"未完成（被截断）"，给「续写」，**不得**把截断文本当完成品通过。
- 超范围**不阻断 REVIEW**（用户可通过），但必须可见并有修一键。

---

## 11. 测试锚点契约（前端必须实现，QA 只用这些断言）

约定：`data-testid` 为新增属性；现有 BEM 类名可继续用，但**本章锚点与状态值不得改名/删减**。新增锚点需与 QA 对齐后追加。

| testid | 出现在 | 属性/取值 | 用途 |
|---|---|---|---|
| `plan-progress` | 流水线页顶部/写作台顶部 | `data-state=running\|done\|failed\|cancelled`；`data-step=setting\|outline\|chapter-plan\|writing`；`data-elapsed`（秒，每 ≤2s 更新） | 四态主断言 |
| `plan-cancel` | 同上 | 可见且 enabled（running 时） | 取消入口 |
| `plan-error` | 同上 | `data-code=<7.1 code>` | 失败态 |
| `plan-retry` | 错误卡 | — | 重试 |
| `plan-continue` | 取消态 | — | 继续企划 |
| `plan-delete` | 错误/取消态 | — | 删除作品（二次确认） |
| `pipeline-banner` | 流水线页顶部 | `data-state=legacy\|stale\|interrupted\|failed` | 迁移/中断/上游变更提示 |
| `stage-stale-banner` | 同上横幅的正文区（`pipeline-banner[data-state=stale]` 内） | 与 `pipeline-banner` 同一元素组，两处锚点等价；上游变更时**阶段为 `review` 与 `confirmed` 都渲染** | 上游变更主断言（S8）；三键 `stage-stale-keep` / `stage-stale-regenerate` / `stage-stale-ignore` |
| `stage-p1` / `stage-p2` / `stage-p3` / `stage-p4` | 各阶段视图根 | `data-status=empty\|generating\|review\|confirmed\|failed\|skipped` | 阶段状态 |
| `stage-confirm` | 各阶段底部 | disabled 当门槛未满足 | 确认门槛 |
| `stage-confirm-blockers` | 同上 | 文本列出未满足项 | 门槛可解释 |
| `stage-regen-all` / `stage-feedback` / `stage-feedback-submit` / `stage-skip` | 各阶段 | — | 反馈/整份重生成/跳过 |
| `item-card` | P1/P2 条目 | `data-kind=world\|env\|character\|act\|beat`，`data-id` | 条目级操作 |
| `item-edit` / `item-regen` / `item-feedback` / `item-history` | 条目卡内 | — | 条目级能力 |
| `item-lock` | 条目卡内 | `data-locked=true\|false` | 锁定后不被阶段级重生成覆盖 |
| `item-delete` | 条目卡内（P1/P2） | disabled 当 `item-locked` | 删除条目（M3）；服务端 409 `ITEM_LOCKED` 兜底 |
| `item-move-up` / `item-move-down` | 条目卡内（P1/P2 同层） | disabled 当已在首/末位 | 条目排序（M3） |
| `stage-block-add-env` / `stage-block-add-characters` | P1 环境/人物块头 | — | 新增条目（M3） |
| `act-add` / `beat-add` | P2 工具条 / 每幕块头 | — | 新增一幕（短篇：节拍组）/ 新增节拍（M3） |
| `unit-move-up` / `unit-move-down` | P3 计划表「排序」列 | disabled 当已在首/末位 | 章节/节拍计划排序（M3） |
| `stage-stale-regenerate-hint` | 上游变更横幅内 | 仅当上游未确认时出现，文案含「先确认上一阶段」 | 「按上游重排」被禁用时的原因（DEF-14） |
| `confirm-overwrite` | 流水线页确认弹层（覆盖手改内容时） | 服务端回 `CONFIRM_BLOCKED` 且 `detail.requiresConfirm='overwrite'` 时弹；正文必须写明「会覆盖手改内容」并列出 blockers | N1：手改后整份重生成/按上游重排的唯一出路是「确认覆盖」，界面必须可达 |
| `confirm-dialog` | 流水线页通用确认弹层 | 与 `confirm-overwrite` 同结构但语义为普通确认（删除作品、放弃中断等） | 区分「普通确认」与「覆盖确认」 |
| `partialAt`（数据字段，非 testid） | `StageView.partialAt` / 阶段行 `stages.partial_at` | 整阶段重建跑到一半被取消或失败时写入时间戳；`nextStep.hint` 附「这次重建只完成了一部分，可以再点一次继续」；跑完或重新起跑即清空 | N4：半新半旧的重建必须留痕，不得当完整结果呈现 |
| `chapter-plan-row` | P3 | `data-id`、`data-words-min`、`data-words-max`、`data-words-target`、`data-locked` | 章节计划 |
| `chapter-plan-count` | P3 顶部 | input | 章节数 |
| `chapter-plan-total` | P3 汇总 | 文本含 Σtarget 与偏差 | 总字数校验 |
| `chapter-plan-preset` | P3 | `data-preset=fast\|standard\|thick` | 三档字数 |
| `chapter-plan-confirm` | P3 底部 | 同 `stage-confirm` | 确认门槛 |
| `write-start` / `write-continue` / `write-pause` / `write-stop` | P4 顶部 | `data-state=running\|paused\|idle\|interrupted` | 长任务控制 |
| `chapter-row` | P4 列表 | `data-status=pending\|generating\|in_review\|approved\|changes_requested\|approved_manual\|skipped`；`data-words` | 逐章状态（短篇断言计数=0） |
| `beat-row` | P4 列表（短篇） | `data-status` 同上；`data-words`；`data-index` | 逐节拍状态（长篇不渲染） |
| `beat-plan-row` | P3（短篇） | `data-id`、`data-words-min`、`data-words-max`、`data-words-target`、`data-locked` | 节拍计划 |
| `chapter-approve` / `chapter-request-changes` / `chapter-rewrite` / `chapter-expand` / `chapter-shrink` / `chapter-version-list` | P4 章内 | — | REVIEW 门槛 |
| `migration-banner` / `migration-upgrade` / `migration-rollback` | 旧作品 | `data-state=legacy\|failed\|done` | 迁移 |
| `mock-badge` | 全局 | 仅 providerId=mock 时可见 | 防静默 mock |
| `new-project-form` / `new-project-submit` / `new-project-precheck` | 新建弹窗 | precheck `data-code` | P0 |

---

## 12. QA 可执行 E2E 场景（照做即可，无需猜测）

### 12.0 环境准备（每条场景前执行）

```bash
# A. 代码与构建（工作目录 = 仓库根）
pnpm --dir software typecheck && pnpm --dir software test && pnpm --dir software build

# B. 干净数据目录（每条场景独立，避免互相污染）
export PW_DATA_DIR=$(mktemp -d /tmp/inkq-spec-XXXXXX)

# C. 启动开发服务器（vite :5180，/api 已代理到本地服务）
pnpm --dir software dev &
# 等待：curl -sf http://127.0.0.1:5180/api/settings >/dev/null && echo ready

# D. 假供应商（两个不同端口，避免互抢；team/ 下已有脚本）
( cd team/inkquay-ai-first
  PORT=8899 DELAY_MS=40000 node fake-provider.mjs &   # 慢：40s 后返回（S4/S11 用 8899）
  PORT=8900 HANG=1         node fake-provider.mjs & ) # 挂死：永不返回（S3 用 8900）
# 用完统一清理：pkill -f fake-provider.mjs

# E. 完成 onboarding（所有场景都要，否则被 onboarding 页挡住）
curl -s -X PUT http://127.0.0.1:5180/api/settings -H 'content-type: application/json' \
  -d '{"profile":{"name":"QA","signature":"spec"},"onboarding":{"completed":true}}'

# E1. 快速档：默认模型 = 内置 mock（S1/S2/S8/S9/S12 用）
curl -s -X PUT http://127.0.0.1:5180/api/settings -H 'content-type: application/json' \
  -d '{"defaultModel":{"providerId":"mock","modelId":"mock-writer"}}'

# E2. 慢/失败档：默认模型 = 假供应商（S3/S4/S11 用）
curl -s -X PATCH http://127.0.0.1:5180/api/providers/ollama -H 'content-type: application/json' \
  -d '{"enabled":true,"apiKey":"fake-key","baseUrl":"http://127.0.0.1:8899/v1","enabledModels":["llama4-70b"]}'
curl -s -X PUT http://127.0.0.1:5180/api/settings -H 'content-type: application/json' \
  -d '{"defaultModel":{"providerId":"ollama","modelId":"llama4-70b"}}'
```

`PUT /api/settings` 是浅合并补丁（`repository.ts:305`，只覆盖传入字段），所以只传 `defaultModel` 不会清掉 profile/onboarding。

**mock provider 的扩展要求（t5 必做）**：内置 mock 必须能按新契约返回**四类产物**——P1 设定、P2 大纲、P3 章节计划、P4 章节正文——且输出**确定**（固定人物数/章节数/字数，便于断言）；否则 S1/S2 无法执行。原 mock 分支在 `plan.ts:138-185`。

**短篇与截断的假数据**：QA 需要的"极短章节"（S10）与"截断"（`finish_reason=length`）用 `team/inkquay-ai-first/fake-provider.mjs` 的环境变量变体实现（如 `SHORT=1`、`FINISH=length`），脚本在 team/ 下，QA 可自行扩展。

```bash
# F. 断言工具（QA 直接复制；ID=<作品 id>）
curl -s "http://127.0.0.1:5180/api/projects/$ID/pipeline" | python3 -m json.tool   # 阶段/任务/lastError
sqlite3 "$PW_DATA_DIR/studio.db" "select count(*) from projects"                 # 作品数（S5/S12a 用）
sqlite3 "$PW_DATA_DIR/studio.db" "select count(*) from chapters where project_id='$ID'"   # 长篇>0；短篇必须=0
# 迁移/不冲数据的逐字节快照（hex 保证空白与换行可比）
sqlite3 "$PW_DATA_DIR/studio.db" \
  "select id, words, hex(content) from chapters where project_id='$ID' order by sort_order" > /tmp/ch-before.txt
# ……升级/重生成之后……
sqlite3 "$PW_DATA_DIR/studio.db" \
  "select id, words, hex(content) from chapters where project_id='$ID' order by sort_order" > /tmp/ch-after.txt
diff /tmp/ch-before.txt /tmp/ch-after.txt && echo '正文逐字节一致'
```

### 12.1 场景清单

#### S1 长篇黄金路径（mock，全流程）

**前置**：12.0 A/B/C/E1（onboarding + defaultModel=mock）。
**步骤**
1. 打开 `http://127.0.0.1:5180` → 点「新建作品」→ 标题 `S1-长篇`、类型长篇、灵感"雨夜收到未来来信的人"→ 勾选 AI 企划 → 点「创建并让 AI 企划」。
2. 断言 `plan-progress[data-state=running]` 在 500ms 内出现；等待 `data-state=done`。
3. 在 P1：改一个角色的 `motivation`；对另一个角色写意见"改成她的妹妹"并提交；等新修订；`item-history` 至少 2 条。
4. 点 `stage-confirm`；断言 `stage-p1[data-status=confirmed]`。
5. 在 P2：给第三幕写阶段级意见"提前到第二幕"→ 提交 → 断言幕/节拍被重排或修改且旧修订可回滚；确认 P2。
6. 点「生成章节计划」→ 断言 `chapter-plan-row` ≥3；改 `chapter-plan-count` 为 5；把第 2 章 `data-words-target` 改为 2000；点预设 `data-preset=fast` 批量应用（未锁章变化、已锁章不变）。
7. 断言 `chapter-plan-total` 显示 Σtarget 与偏差；点 `chapter-plan-confirm`。
8. P4：点 `write-start` → 生成第 1 章 → `chapter-row[data-index=1][data-status=in_review]`；点 `write-pause` → 状态 `paused`；点 `write-continue` → 第 2 章完成。
9. 对第 1 章 `chapter-approve`；对第 2 章 `chapter-request-changes` 填意见 → 断言 `changes_requested` → `chapter-rewrite` → 新版本 → `chapter-version-list` ≥2。
10. 刷新页面 → 断言所有状态与字数保持；全部章置终态后 `pipelineStatus=completed`。
**证据**：每步截图；`/api/projects/:id/pipeline` JSON；`logs/server.log` 中 `[job]` 行。
**通过标准**：全部断言成立，无 JS 报错，无 500。

#### S2 短篇黄金路径（mock）

**前置**：同 S1。
**步骤**：新建类型=短篇（目标字数 12000，弹窗描述为 3,000–15,000 字）→ AI 企划 → 依次确认 P1/P2 → 生成节拍计划（断言节拍数 3–40、无 `chapter-row`：`chapter-row` 计数 = 0）→ 改两个节拍的字数范围 → 确认 → 逐节拍写作 2 个节拍 → 通过 1 个、退回 1 个 → 导出 `export.md`。
**断言**
- 全程无卷/章 UI；`chapter-row` 计数 = 0；
- 每节拍 `data-words` 在其 `[min,max]*[0.9,1.1]` 内或显示"偏短/偏长"标记；
- 导出 md 的正文包含两个节拍内容，总字数 = 各节拍之和；
- 短篇不出现空章节：`chapters` 表该作品的章节数必须为 **0**（不是"没有未命名章节"，是一条都不该有）。
**证据**：截图 + 导出的 md 文件 + pipeline JSON。

#### S3 失败态（HANG，120s 超时）

**前置**：12.0 A/B/C/D（含 8900 端口的挂死假服务）+ 把默认模型指到它：
```bash
curl -s -X PATCH http://127.0.0.1:5180/api/providers/ollama -H 'content-type: application/json' \
  -d '{"enabled":true,"apiKey":"fake-key","baseUrl":"http://127.0.0.1:8900/v1","enabledModels":["llama4-70b"]}'
curl -s -X PUT http://127.0.0.1:5180/api/settings -H 'content-type: application/json' \
  -d '{"defaultModel":{"providerId":"ollama","modelId":"llama4-70b"}}'
```
**步骤**：新建 `S3-失败` 勾选 AI 企划 → 点创建 → 等 120s。
**断言**
- 等待期间：`plan-progress[data-state=running]` 持续可见，`data-elapsed` 单调递增，`plan-cancel` 可见；
- ≤1s（相对失败时刻）出现 `plan-error[data-code=PROVIDER_TIMEOUT]`，含中文原因、`plan-retry`、`plan-delete`；
- 刷新页面 → `plan-error` 与 code 仍在（来自 lastError）；
- `grep 'status=fail' logs/server.log` 有该 job 行，含 `code=PROVIDER_TIMEOUT` 与 dur；
- 作品列表该作品卡片显示「企划未完成」+ 可进入，且**无**空幕/空章（`outline_acts`、`chapters` 对该作品为 0）。
**证据**：0.5s/60s/121s 截图；server.log 行；`GET /api/projects/:id` 的结构计数。

#### S4 取消态 + 上游真取消

**前置**：12.0 A/B/C/E2 + 慢供应商 `DELAY_MS=40000`。
**步骤**：新建 `S4-取消` → 点创建 → 5s 后点 `plan-cancel`。
**断言**
- ≤2s：`plan-progress[data-state=cancelled]`，出现 `plan-continue` 与「先自己写」；
- 假供应商日志在 ≤5s 内出现请求关闭（需在 `fake-provider.mjs` 里加 `req.on('close')` 打点，QA 可改 `team/` 下脚本）；
- 请求前后条目数相同（无半截人物/幕/章）；
- 点 `plan-continue` → 新 job 启动（`data-state=running`）→ 最终 done。
**证据**：fake-provider 日志、截图、pipeline JSON 前后对比。

#### S5 前置拦截（无模型 / 无 Key）

**前置**：12.0 A/B/C/E（onboarding）；再 `curl -s -X PUT .../api/settings -d '{"defaultModel": null}'`。
**步骤**：记下 `GET /api/projects` 数量 N → 打开新建弹窗 → 填标题 → 勾选 AI 企划 → 点创建。
**断言**
- 出现 `new-project-precheck[data-code=NO_DEFAULT_MODEL]`，含「去设置」；
- `GET /api/projects` 数量仍为 N（**未建作品**）；
- 无 mock 生成：`grep 'provider=mock' logs/server.log` 无新增；
- 选「先创建，稍后企划」→ 作品创建且 `pipelineStatus=draft`，流水线页有「开始 AI 企划」入口（不是空白页）。
**证据**：请求/响应日志、项目列表前后、截图。
**变体**：`providerId=openai` 且 apiKey 为空 → `NO_API_KEY`，同样不建作品。

#### S6 旧作品迁移（真实库副本）

**前置**：12.0 A（构建）+ 一份真实旧数据目录（只读复制，绝不动原库）。**顺序很重要**：先准备好数据目录，再起服务。
```bash
# 1) 干净数据目录
export PW_DATA_DIR=$(mktemp -d /tmp/inkq-spec-migrate-XXXXXX)
# 2) 复制旧库（含 -wal/-shm，缺了会丢最近写入；若 WAL 未合并，必须先让旧进程退出或用 sqlite3 做 checkpoint）
cp '<旧数据目录>/studio.db'     "$PW_DATA_DIR/studio.db"
cp '<旧数据目录>/studio.db-wal' "$PW_DATA_DIR/" 2>/dev/null || true
cp '<旧数据目录>/studio.db-shm' "$PW_DATA_DIR/" 2>/dev/null || true
# 3) 再起服务（此时服务读到的是旧库）
pnpm --dir software dev &
# 4) 完成 onboarding（不覆盖作品数据）
curl -s -X PUT http://127.0.0.1:5180/api/settings -H 'content-type: application/json' \
  -d '{"profile":{"name":"QA","signature":"spec"},"onboarding":{"completed":true}}'
```
**步骤**：打开旧作品（断言正文可见、字数正确）→ 记录升级前各项计数（`sqlite3 "$PW_DATA_DIR/studio.db" "select count(*) from chapters; ..."` 或导出 dump）→ 点 `migration-upgrade` → 等完成 → 再记录一次并逐项比对。
**断言（9.5 全部）**
- 章节数、每章 content 逐字节、words、版本数、人物/幕/节拍数、scenes/foreshadows 数与升级前相等；
- 升级期间假供应商零请求（若指向假供应商，日志无访问）；
- `migration-banner[data-state=done]`；阶段视图有内容且 P1/P2 为 `confirmed`；
- 二次点升级幂等（条目不翻倍）。
**证据**：升级前后各表的 dump/计数、截图、备份文件存在（`studio.db.bak-*`）。

#### S7 迁移失败与回退

**前置**：同 S6，并构造一个会失败的输入（例如把某章 `words` 改成与 content 明显不符、或临时把 `chapters.content` 改成非法 BLOB——由 QA 与本轮 t5 约定注入点；若实现提供 `MIGRATION_FORCE_FAIL=1` 环境开关，直接用它）。
**断言**
- 出现 `MIGRATION_FAILED` 提示，作品仍可打开（旧流程）；
- DB 中无部分迁移（stages/stage_items 该作品为 0）；
- 备份文件存在；
- 修复输入后再次升级成功。
**变体（成功后回退）**：升级 → 不改任何内容 → `migration-rollback` → 恢复备份 → 逐项等值断言（9.5）；再升级 → 写 1 章正文 → 回退 → 必须出现"将丢失 1 章"的警告并要求确认，且当前库另存 `studio.db.pre-rollback-*`。

#### S8 上游变更不冲数据

**前置**：12.0 A/B/C/E1；作品已确认 P1/P2/P3，写完 1 章（approved）。
**步骤**：回 P1，删除一个配角 → 断言 P2 顶部 `stage-stale-banner` 出现、P3 `stale`、已 approved 章内容不变（before/after 逐字节）。
### `CONFIRM_BLOCKED` 的两种语义（必须能区分）

| 场景 | 响应 | 前端处理 |
| --- | --- | --- |
| 条件没满足（如计划里有空大纲） | `code=CONFIRM_BLOCKED`，`blockers` 列出待补齐项，**无** `detail.requiresConfirm` | 渲染清单，让用户去补 |
| 会覆盖手改内容（整阶段重生成、按上游重排） | `code=CONFIRM_BLOCKED`，`blockers` 列出手改项，`detail.requiresConfirm='overwrite'` | 弹 `confirm-overwrite` 二次确认；确认后带 `confirmOverwrite:true` 重发 |

**断言**：P2 条目数不变；P3 章数不变；chapter 1 content 全等；**P2 仍是 `confirmed`（stale 不是状态，不回滚已确认阶段）且横幅文案为「上游已变更，建议复核后再确认」，原因码翻成人话（如「设定已被编辑」，不得直接出现 `p1:edited`）**；横幅三个动作（`stage-stale-keep` / `stage-stale-regenerate` / `stage-stale-ignore`）都可见可点；点「复核并保留」后 stale 清除且阶段仍 `confirmed`；点「忽略」后 stale 保留；点「按上游重排」对该阶段起 `regen-stage` job。

#### S9 刷新/重启恢复（逐章生成中断）

**前置**：12.0 A/B/C/E1；P3 已确认；开始连写 5 章。
**步骤**：第 2 章生成中 `kill` 服务进程 → 重启服务 → 打开作品。
**断言**
- `pipeline-banner[data-state=interrupted]`；`write-start` 变 `write-continue`；
- 已完成章状态保持（第 1 章 `approved` 或 `in_review`），不重写；不产生重复版本；
- 点 `write-continue` → 从第 3 章继续（不是从第 1 章重跑）；
- 页面刷新多次进度一致。

#### S10 字数超范围处理

**前置**：12.0 A/B/C/E1 + 假供应商返回极短章节（QA 用 `fake-provider.mjs` 的 `SHORT=1` 变体或改返回 body），P3 该章范围 2500–4000。
**断言**
- 生成后该章 `data-words < 2475`，显示「偏短」标记与 `chapter-expand`；
- 点 `chapter-expand` → 新版本字数增加（可能仍偏短需再点），旧版本可在 `chapter-version-list` 回滚；
- 截断场景（`finish_reason=length`）显示「未完成」，且"通过"按钮存在但通过后状态标 `approved` 同时保留"曾截断"标记（不得静默当正常）。

#### S11 「新建并让 AI 企划」无响应回归（核心验收）

**前置**：12.0 A/B/C/E2 + 慢供应商 `DELAY_MS=40000`。
**步骤**：用 Playwright（复用 `team/inkquay-ai-first/repro-plan-slow.mjs` 的采样逻辑，断言换成 testid）点击创建，0.5s 起每 500ms 采样到 45s。
**断言**
- 500ms 内 `plan-progress` 可见，`data-state=running`，`body.innerText.length > 50`（非白屏）；
- 0.5–40s 每个采样点：`plan-progress` 可见、`plan-cancel` 可见且 enabled；
- 相邻采样（间隔 ≤2s）之间 `data-elapsed` 必变（R-3）；
- 40s 后 `data-state=done`，`stage-p1[data-status=review]`，人物 ≥1、环境 ≥1、`plan-error` 不存在；
- `stage-p3` 尚未生成（断言 `chapter-plan-row` 计数 = 0，证明首次企划不写正文也不越阶）；
- 控制台无 `pageerror`。
**证据**：时间线快照日志 + 各时刻截图 + pipeline JSON。
**失败判据**：第 6 章 R-1～R-7 任一成立。

#### S12 双击/离开页面/并发

- **S12a 双击**：缓慢双击 `new-project-submit` → 断言只创建 1 个作品（列表计数 +1）；
- **S12b 离开页面**：慢企划中导航回作品库再点回作品 → `data-state=running` 且 `data-elapsed` 继续增长；job 未 cancelled；
- **S12c 并发**：job 运行中在 P1 点重生成 → 出现 `CONCURRENT_JOB` 提示，不启动第二个 job（日志只有一条 start）。

### 12.2 验收矩阵（AC ↔ 场景）

| AC | 描述 | 场景 |
|---|---|---|
| AC-01 | 点击后 ≤500ms 有进度，非白屏 | S11, S12a |
| AC-02 | 等待期持续有进度与取消，无 15s 静默 | S11, S3 |
| AC-03 | 失败可读、可重试、刷新/重启仍在、有日志 | S3 |
| AC-04 | 取消 ≤2s、上游 ≤5s 释放、可继续 | S4 |
| AC-05 | 无模型/无 Key 不建作品、不 mock | S5 |
| AC-06 | 首次企划只产 P1+P2，不写正文、不越阶 | S11 |
| AC-07 | P1 条目级编辑/反馈/单块与整份重生成/历史 | S1 |
| AC-08 | P2 幕/节拍编辑/增删/重排/反馈/历史 | S1 |
| AC-09 | P3 章节数/功能/大纲/字数范围可编辑，总字数校验，未确认不可写 | S1 |
| AC-10 | P4 逐章/暂停/继续/重写单章/每章 REVIEW | S1, S9 |
| AC-11 | 刷新/重启状态与进度保持、可恢复 | S1, S9 |
| AC-12 | 短篇无章节、节拍结构、导出正确 | S2 |
| AC-13 | 上游重生成不冲已确认内容（stale 而非删除） | S8 |
| AC-14 | 旧作品可打开、迁移逐字节保真、失败可回退 | S6, S7 |
| AC-15 | 无静默 mock（mock 显式徽标） | S5, S1 |
| AC-16 | 字数范围执行与超范围处理 | S10 |
| AC-17 | 双击只建 1 个作品 | S12a |
| AC-18 | 离开页面不中断 job | S12b |
| AC-19 | `typecheck` / `test` / `build` / `test:ui` 通过 | 门禁命令 |

---

## 13. 验收标准（逐条可判定，供 t5/t6/t7 自检与评审）

1. 第 12 章全部场景按"通过标准"实跑通过；每条结论附证据（截图/请求响应/日志/DB 计数）。
2. 第 11 章锚点全部存在，状态值取值正确。
3. 第 7.1 错误分类中，`NO_DEFAULT_MODEL`/`NO_API_KEY`/`PROVIDER_TIMEOUT`/`EMPTY_OUTPUT`/`CANCELLED`/`INTERRUPTED` 六类必须有自动化覆盖（单测或 E2E）。
4. 第 9.5 迁移校验 9 条逐条有断言，且断言基于"升级前后 dump 对比"而非常量预期。
5. 新增测试不得只跑 mock 瞬时：`pnpm test` 与 `test:ui` 必须包含至少一个**慢/失败/取消**场景（这是本次缺陷逃逸的直接原因，见 AUDIT §4.6 测试现状）。
6. 不满足第 6.4 红线 R-1～R-7 任一条，视为本次重构未达标。

---

## 14. 风险、待决与分期

### 14.1 主要风险（及本 SPEC 的应对）

| 风险 | 应对 |
|---|---|
| 双入口状态分裂（流水线页 vs 现有写作台 `StudioPage`） | 规定单一数据源：阶段/章节状态存 DB；写作台作为 P4 的编辑器视图被流水线页复用；不迁移的作品仍走旧视图（`legacy`） |
| 真实用户库迁移不可逆 | 备份 + 事务 + 校验 + 演练；`MIGRATION_FORCE_FAIL` 可注入；回退双保险（备份 + pre-rollback 副本） |
| 长任务烧钱 | 每次生成显式触发；取消真停；仅 429/网络自动重试 1 次；prompt 里限制输出长度 |
| 推理模型空 content 复发（AUDIT R5） | `EMPTY_OUTPUT` 分类 + 重试 + 换模型提示；必要时兼容 reasoning_content 兜底（由 architect 决定） |
| 旧 E2E 全 mock ⇒ 慢/失败永远测不到 | 第 12 章强制含慢/挂死/取消；第 13 章第 5 条列为门禁 |
| 范围膨胀 | 第 2.3 非目标清单 + 分期表；新增需求一律进 V1.1 |

### 14.2 待决问题（已给建议答案，不阻塞实现；若 captain/用户否决再改）

| # | 问题 | 建议（默认执行） |
|---|---|---|
| Q1 | P1 能否跳过？ | 允许，仅 P1，需二次确认并留痕（4.2） |
| Q2 | 能否关闭逐章 REVIEW（自动连写）？ | V1 不提供；V1.1 作为显式开关 |
| Q3 | 短篇上限是否放宽到 3 万字？ | 保持 15,000，超出引导用长篇 |
| Q4 | 是否允许只导出大纲/设定（不写正文）？ | 允许（导出 `export.outline.md`），列为 V1 可选实现 |
| Q5 | 默认每章 3000 字是否合适？ | 保留，但提供三档预设并在 P0/P3 可改 |
| Q6 | 系列（series）是否进流水线？ | V1 不进，只修无响应与错误提示 |
| Q7 | 章节计划 `Σtarget` 偏差 25% 是否过严？ | 先按 25%，若真实用户频繁触发，V1.1 放宽到 40% 并允许"锁总量" |

### 14.3 分期建议（供 captain 排期）

- **第一阶段（必须）**：M1 新建四态 + M9 错误边界 + M6/M7（job、取消、持久化）→ 交付"不再无响应"。
- **第二阶段**：M2/M3/M4（P1–P3 可编辑、反馈、确认、字数范围）。
- **第三阶段**：M5（P4 逐章、暂停/继续/重写、REVIEW）。
- **第四阶段**：M8 迁移与回退 + M10 全部 E2E 收口。
每阶段结束都要能独立演示（不允许"到最后才第一次能点"）。

---

## 15. 附录：现状 → 目标差距（实现时逐条对照）

| # | 现状（AUDIT 证据） | 目标（本 SPEC） |
|---|---|---|
| A1 | 新建弹窗内单次 `await`，40s 无反馈（`NewProjectModal.tsx:73-94`） | 创建即落库 + 跳转流水线页 + 后台 job + 进度（6.1） |
| A2 | 主按钮与进度文案互斥隐藏（`:191`/`:193`） | 进度态下按钮存在且为「取消企划」（6.2） |
| A3 | 失败只存内存 `planError`（`:31`） | job + lastError 持久化 + 日志（7.5） |
| A4 | plan 非流式、单次 90s 超时、无重试（`plan.ts:100-131`） | 120s/步 + 错误分类 + 手动重试（7.1/7.3） |
| A5 | 取消只 abort 客户端（AUDIT R3） | 服务端真取消并释放上游（7.2） |
| A6 | 先建 3 空幕 + 1 空章再请求 AI（`repository.ts:253-273`） | 不预建占位；孤儿定义与红线（3.4/6.4） |
| A7 | `applyProjectPlan` 全量 DELETE 重建（`repository.ts:910-960`） | 阶段化增量写入 + 确认快照 + stale（3.3/4.6） |
| A8 | 只读 `message.content`，推理模型空 → 无内容（`plan.ts:104`） | `EMPTY_OUTPUT` 分类与提示（7.1） |
| A9 | 一次 plan 同时产出设定/大纲/第一章正文 | 首次只产 P1+P2；P3 另起；正文只在 P4（4.4/6.2） |
| A10 | 无 stage/job 表、无 review 状态 | 新增阶段/任务/修订/审核留痕（3.1/3.2） |
| A11 | 旧 E2E 只跑 mock 瞬时 | 强制慢/失败/取消场景（12/13） |
| A12 | 旧作品与导入包无迁移路径 | legacy 兼容 + 显式升级 + 回退（第 9 章） |

---

*本文档为需求基线：t3/t4 的分歧以本文为准；如需变更范围（尤其第 2 章），必须回到 captain 走需求变更，不得在实现阶段自行扩张。*
