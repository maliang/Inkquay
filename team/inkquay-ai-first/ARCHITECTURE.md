# ARCHITECTURE — Inkquay AI-first 目标架构

版本：v1.0（2026-10-28）  
作者：architect（team inkquay-ai-first，task t4）  
需求基线：`team/inkquay-ai-first/SPEC.md` v1.0（下称 SPEC）  
决策基线：`team/inkquay-ai-first/CAPTAIN-DECISIONS.md` D1–D5（下称 D1–D5）  
现状事实：`team/inkquay-ai-first/AUDIT.md`（下称 AUDIT）  
配套文档：`MIGRATION.md`（旧数据迁移与回退）、`DECISIONS.md`（ADR 与取舍记录）

本文只做设计，**不改 `software/` 任何文件**。文中的 `file:line` 都在本轮重新 grep/sed 复核过（复核命令见 §13）。  
**SPEC 与 D4 冲突时以 D4 为准**：P4 是「连续生成、全部写完后逐章审」，不是「每章停在 in_review 等前端确认才继续」。本文 §3.2 / §2.4 / §4 已按 D4 设计，SPEC §4.5 那句默认描述视为被 D4 覆盖（见 §11 R-1）。

---

## 0. 目标与三条硬约束

一句话：**新建作品 = 立即落库 + 进入流水线页 + 后台 job 跑**；AI 按 P1 设定 → P2 大纲 → P3 计划 → P4 正文分阶段产出，每一步都可编辑、可反馈、可重做、可回滚，人工只在阶段确认与章节审阅处把关。

三条硬约束（贯穿全部设计，测试可直接断言）：

1. **不许"无响应"**：任何长任务都必须有服务端真实进度、可见取消入口、失败可见可重试、刷新可恢复（SPEC §6）。判据是服务端数据驱动，不是前端定时器装出来的。
2. **不许"空壳"**：新建流程不得预写占位结构（`repository.ts:253` 现在会预写 3 空幕 + 1 空章，必须去掉，INV-6）；失败/取消后作品必须有出路（重试/继续/删除）。
3. **不许"冲掉人工成果"**：已确认阶段的内容与已写正文永不因上游变更或重生成被删除（INV-1）。现有 `repository.ts:910 applyProjectPlan` 的"全量 DELETE 重建"只能作为剧本兼容路径存在，novel/short 不得再走。

---

## 1. 架构总览

### 1.1 现状（AUDIT 已证实）

```
NewProjectModal ──POST /api/projects(建库+3空幕+1空章)──┐
       │                                               │
       └──await POST /api/projects/:id/plan (非流式, 90s 单次超时)
                 │            ▲ 无进度 / 无取消 / 502 不打日志
                 ▼
        PlanReviewModal 一次应用 acts+characters+chapter1（全量 DELETE 重建）
```
问题不在"请求没发"，而在三处：等待期零反馈（`NewProjectModal.tsx:191-193`）、失败留空壳（`repository.ts:253-273`）、失败无痕（`index.ts:102-111`）。

### 1.2 目标（本文设计）

```
┌──────────────────────── client（React 19, react-router 7）────────────────────────┐
│ LibraryPage(卡片带流水线状态)  PipelinePage(新)  StudioPage(P4 编辑器)  Outline/Codex │
│        │                          │                    │                          │
│        └── POST /api/projects ────┘                    │                          │
│              (Idempotency-Key)  ┌─ usePipeline: GET pipeline 轮询(2s) + 本地秒数插值 │
└─────────────────────────────────┼──────────────────────────────────────────────────┘
                                  │  202 {projectId, jobId}
┌─────────────────────────────────▼──────────────────────────────────────────────────┐
│ server（Express 5, 单进程）                                                         │
│  routes/index.ts   只做参数校验 + 权限/前置校验 + 调 runner（不在路由里跑生成）        │
│  pipeline/runner   JobRunner：队列(全局 3) · 单作品 1 · step 循环 · 取消/暂停/恢复    │
│  pipeline/steps    每步一次模型调用 + 结构校验 + 原子落库（P1/P2/P3/P4 分步）          │
│  pipeline/store    事务边界集中地（stages / stage_items / revisions / jobs）           │
│  pipeline/events   job_events 持久化（V1 排障；V1.1 供 SSE 重放）                     │
│  pipeline/snapshot 快照装配 + nextStep 唯一推导（D6）                                │
│  pipeline/legacy   旧作品迁移（见 MIGRATION.md）                                     │
│  provider/call     单步模型调用（120s 超时 / abort / reasoning 兼容 / usage 归一）     │
└─────────────────────────────────┬──────────────────────────────────────────────────┘
                                  ▼
                     data/studio.db（node:sqlite，WAL，同步 API，单写者）
```

### 1.3 模块边界（硬规定）

| 边界 | 规定 | 理由 |
|---|---|---|
| 路由层 | `index.ts` 只允许：解析参数、调 `store` 读、调 `runner.enqueue`、返回 202/409/422；**禁止**在路由体里 `await` 模型调用 | 现状 `index.ts:102-111` 把生成放在请求里，请求超时就丢上下文，且无法取消 |
| 生成层 | 全部在 `server/pipeline/`；只依赖 `provider/call`、`store`、`events` | 可单测、可注 fake provider |
| 数据层 | 写只经过 `pipeline/store.ts`（新表）+ `repository.ts`（旧表既有函数）；**禁止**在 steps 里手写 SQL | 事务边界与 INV-1 白名单集中在一处 |
| 客户端 | 页面不直接 `fetch`，全部走 `api.ts` 的新增方法；轮询只用 `usePipeline` 一个 hook | 现状 `api.ts` 已是唯一出口，沿用 |
| 依赖 | **不新增运行时依赖**（不引 zod、react-query、状态库）；校验手写 | Electron 打包体积与离线可用性；见 DECISIONS ADR-14 |

### 1.4 与现有代码的关系（一句话）

**增量重构**：现有 6 张内容表、StudioPage 编辑器、章节版本面板、AI 聊天 SSE 全部保留复用；新增 `stages / stage_items / revisions / generation_jobs / job_events / review_records / migrations` 七张表与 `pipeline` 模块；只替换"新建 → 一次性企划 → 全量应用"这一条链路。方案对比与备选见 §8、`DECISIONS.md` ADR-1。

---

## 2. 前端架构

### 2.1 路由表（SPEC R7：只增不改）

| 路由 | 页面 | 变化 | 说明 |
|---|---|---|---|
| `/` | `LibraryPage` | 改造 | 卡片新增流水线状态徽标与「继续企划 / 去审阅」入口（§2.7） |
| `/project/:projectId/pipeline` | `PipelinePage` **新增** | 新增 | P1–P4 阶段视图 + 长任务控制 |
| `/project/:projectId` | `StudioPage` | 保留、精简 | P4 编辑器视图（章节正文、AI 聊天、版本回滚）；删除内联企划逻辑 |
| `/project/:projectId/outline` | `OutlinePage` | 保留 | P2 的全量管理视图（幕/节拍表格） |
| `/project/:projectId/codex` | `CodexPage` | 保留 | P1 的全量管理视图（人物卡） |
| `/project/:projectId/screenplay` | `ScreenplayPage` | 不变 | 剧本不进流水线（SPEC §2.4） |
| `/settings` | `SettingsPage` | 不变 | 前置拦截的"去设置"落点 |

路由守卫（在 `App.tsx:13-19` 的 `StudioRoute` 旁边加同构守卫）：

- `screenplay|series` 作品访问 `/pipeline` → `<Navigate to="/project/:id/screenplay" />`；
- `pipelineStatus=legacy` 访问 `/pipeline` → 允许，但渲染 `LegacyBanner`（`migration-banner[data-state=legacy]`），主体只显示「升级 / 继续用编辑器」；
- 作品不存在 → `LibraryPage` + toast。

### 2.2 页面拆分与组件树

```
client/pages/PipelinePage.tsx                 壳：数据（轮询）、阶段切换、错误边界
├─ PipelineHeader.tsx        plan-progress / plan-cancel / plan-error / plan-retry
│                            / plan-continue / pipeline-banner / migration-banner
├─ StageNav.tsx              侧栏 P1→P4 状态点（阶段序号、状态、stale 点）
├─ p1/SettingStage.tsx       stage-p1：world / env / character 三组 item-card
├─ p2/OutlineStage.tsx       stage-p2：act → beat 两级
├─ p3/ChapterPlanStage.tsx   stage-p3：表格（长篇 chapter-plan-row / 短篇 beat-plan-row）
├─ p4/WritingStage.tsx       stage-p4：write-start/pause/stop/continue + 单元列表 + 审阅面板
└─ shared/
   ├─ ItemCard.tsx           item-card[data-kind][data-id] + item-edit/regen/feedback/history/lock
   ├─ FeedbackBox.tsx        stage-feedback + stage-feedback-submit
   ├─ ConfirmBar.tsx         stage-confirm + stage-confirm-blockers
   ├─ RevisionDrawer.tsx     阶段/条目修订历史（来源、意见、时间、恢复为当前）
   ├─ ErrorCard.tsx          plan-error[data-code] + plan-retry + 去设置 + plan-delete
   ├─ LegacyBanner.tsx       migration-banner / migration-upgrade / migration-rollback
   └─ UnitReviewPanel.tsx    chapter-approve / request-changes / rewrite / expand / shrink
                             / chapter-version-list（复用 StudioPage 的版本列表逻辑）
```

写作台（`StudioPage`）保持单页三栏不变，只做两处外科手术：

1. 删除 `planPreview`（`:52`）、`runPlan`（`:498`）、`cancelPlan`（`:514`）、`applyPlan`（`:520`）、「AI 企划这一本」按钮（`:888`）与 `PlanReviewModal` 挂载（`:1098`）——企划入口统一到流水线页，避免两条写入路径。
2. `aiTab` 的 `versions` 段（`:50`、`:951`、`:1043-1046`）抽成 `UnitReviewPanel` 的版本列表子组件，供长篇（读 `chapter_versions`）与短篇（读 `revisions`）共用。

### 2.3 客户端状态机（唯一真相来自服务端）

`PipelinePage` 不维护"业务状态"，只做派生。`viewState` 全部由 `GET /api/projects/:id/pipeline` + 当前 `activeJob` 计算：

| viewState | 判据（服务端字段） | 界面必须可见 |
|---|---|---|
| `loading` | 首个 GET 未返回 | 骨架 + 「正在读取作品…」（≤500ms 内出现，禁止空白） |
| `ready` | 无 activeJob，当前阶段可操作 | 阶段内容 + 确认条（门槛未满足时列出 blockers） |
| `generating` | `activeJob.status ∈ {queued, running}` | `plan-progress[data-state=running]` + 阶段名 + 已用秒数 + `plan-cancel`；`data-step` 取 job.step 映射 |
| `paused` | 最近 writing job `stop_mode=pause`，无 running job | `write-pause[data-state=paused]` + 「继续写作」+ 已完成章状态 |
| `failed` | `project.lastError` 存在且无 activeJob | `plan-error[data-code]` + 中文原因 + 影响范围 + 三个出路按钮 |
| `cancelled` | 最近 job `status=cancelled` 且 `stop_mode=stop` | `plan-progress[data-state=cancelled]` + `plan-continue` + 「先自己写」+ `plan-delete` |
| `interrupted` | 启动扫描后 job `status=interrupted` | `pipeline-banner[data-state=interrupted]` + 「恢复」+「放弃」（放弃只清 job，不删内容） |
| `legacy` | `project.pipelineStatus=legacy` | `migration-banner[data-state=legacy]` + 升级/继续用编辑器 |

派生规则写成纯函数 `deriveViewState(project, stages, activeJob, lastJob)`（放 `client/pages/pipeline/derive.ts`），与 UI 分离，**单测可直接断言 7 个态**。

> **`nextStep` 不在这个函数里**（D6）：它由服务端在快照里下发，前端只渲染 `nextStep.label` 与跳转（`nextStep.kind` 决定行为）。`derive.ts` 只负责上表 7 个 viewState 与界面分支，**严禁**再写一套"下一步"判定——两处判定必然漂移（本项目踩过跨仓两套规则的坑）。

### 2.4 长任务：进度 / 取消 / 暂停 / 恢复

**数据来源**：`plan-progress[data-elapsed]` 的秒数来自 `JobView.elapsedMs`（服务端按 `startedAt` 算），前端只在两次轮询之间做本地秒数插值（每 ≤2s 刷新 DOM），**不插值百分比/剩余章数**。job 停止推进时秒数继续增长、阶段文案停在最后已知 `job.step`——这正是 SPEC §6.3 要求的"真实进度"。

**连接（V1 只有轮询，UX-SPEC §12.4）**：`usePipeline` 按 §10 的间隔轮询 `GET /api/projects/:id/pipeline`（一次拿全快照）。间隔与降级规则见 §3.11。SSE 是 V1.1 优化，本次不实现，契约已预留在 §3.11 末尾。

- 连续失败 3 次 → 控制条降级：`与后台失去联系，最后更新 12 秒前` + 「重试连接」（不显示假进度、不清空已有内容）。
- 页面隐藏时暂停轮询，回前台立即拉一次。

**取消（`plan-cancel` / `chat-stop`）**：`POST /api/jobs/:jobId/cancel {mode:'stop'}` → 202 `{job}`（`cancelRequested:true`）→ 按钮立即 disabled 文案「正在取消…」→ 服务端 ≤2s 置 `cancelled`、≤5s 释放上游（SPEC §7.2）→ 下一次轮询（≤2s）看到 `cancelled` → 视图转 `cancelled`。若 5s 后快照仍是 `running`，前端显示「取消请求已发送，正在等待模型返回」，**不重复发取消**（幂等键 + 服务端 `cancelRequested` 已是唯一状态）。

**暂停 / 立即停止 / 继续（P4，D4 + UX-SPEC §7.4）**：

- `write-pause`（暂停）→ `POST /api/projects/:id/writing/pause`：服务端置 `pause_requested=1`，**当前章写完才停**；界面立即显示「将在本章完成后暂停」（`data-pause-pending`），本章落库后 job → `cancelled` + `stop_mode='pause'`，`JobView.state='paused'`。
- `write-stop`（立即停止）→ 二次确认（文案含"当前章未完成的内容会被丢弃"）→ `POST /api/projects/:id/writing/stop`：abort 当前章上游请求，**当前章不落任何正文**（章级原子写入，§3.4，所以"丢弃"是自然结果），job → `cancelled` + `stop_mode='stop'`。
- `write-continue`（继续）→ `POST /api/projects/:id/writing/continue`：新建 job（`retry_of_id` 指向被暂停的 job），从第一个 `pending` 章继续；已有终态（`in_review/approved/...`）的章不动。
- `write-start`（开始）→ `POST /api/projects/:id/writing/start`：P3 confirmed 且无 active job 才允许。

**刷新/重启**：刷新后 `GET /pipeline` 一次拿全（阶段、计数、job、lastError、review、migration），若 `job.state=running` 继续按 2s 轮询；服务端已 `interrupted` 则显示恢复横幅。**任何情况下不把"进行中"渲染成空白页**（AUDIT R6 / SPEC R-6）。

### 2.5 阶段确认与反馈交互

| 交互 | 入口 | 行为 | 服务端校验 |
|---|---|---|---|
| 确认阶段 | `stage-confirm` | 门槛未满足时按钮 disabled + `stage-confirm-blockers` 列出未满足项与"去补"链接 | `POST /stages/:key/confirm` 二次校验门槛与顺序，失败 `422 CONFIRM_BLOCKED` / `409 STAGE_LOCKED` |
| 阶段反馈 | `stage-feedback` → 提交 | 必填意见（≥4 字）→ 202 job（`scope=stage`），按钮转"生成中"并显示 `plan-progress` | job 运行中拒绝同阶段再提交（`409 CONCURRENT_JOB`）；锁定条目跳过 |
| 条目反馈 | `item-feedback` | 条目卡内弹出意见框 → 202 job（`scope=items`，只重写该条目） | 条目 `locked` 时拒绝并提供"解锁" |
| 整份重生成 | `stage-regen-all` | 二次确认（提示"旧内容会保留为修订，可回滚"）→ 202 job | 已确认阶段 → 阶段回 `review` + 下游 stale（R2） |
| 条目编辑 | `item-edit` | 内联编辑 + ≥2s 防抖自动保存 → `PATCH /items/:id` 写 `revision(source=manual)` | 已确认阶段编辑 → 回 `review` + 下游 stale |
| 条目锁定 | `item-lock` | 切换 `locked` | 锁定条目不出现在阶段级重生成的目标集合里 |
| 跳过 P1 | `stage-skip` | 二次确认 + 记录决策 | 仅 p1 允许；`skipped` 视为满足下游进入条件 |
| 上游变更横幅 | `stage-stale-banner` | 三个动作：复核并保留 / 按上游重排 / 忽略 | `POST /stages/:key/stale/resolve {action}` |
| 章节审阅（D5：只在写作台） | `chapter-approve` / `chapter-request-changes` / `chapter-rewrite` / `chapter-expand` / `chapter-shrink` | 逐章终态；退回必填意见；重写/扩写/精简产生新版本。**流水线章节板只放「审阅」导航，不就地放四键** | `POST /api/chapters/:id/review {action, note}`（`rewrite/expand/shrink` 走同一入口，返回 202 job） |

**确认顺序**：P1 → P2 → P3 → P4 正向解锁；下游内容可提前生成/预览/编辑（首次企划一次带回 P1+P2 就是此列），但确认按钮按序解锁，服务端二次校验（R6）。前端只做"提前告诉用户"，不作为安全边界。

### 2.6 复用 / 替换清单（逐文件）

| 现有文件 | 处理 | 说明 |
|---|---|---|
| `client/pages/StudioPage.tsx`（1102 行） | **保留 + 精简** | 章节列表 / 正文编辑 / `saveState` / `closeGuard`（`:234`）/ AI 聊天 SSE / 版本列表全部复用；删 `planPreview`(:52)、`runPlan`(:498)、`cancelPlan`(:514)、`applyPlan`(:520)、企划按钮(:888)、`PlanReviewModal` 挂载(:1098) |
| `client/components/ChapterEditor.tsx`（61 行） | **完全复用** | 受控 `value/onChange`（`:16-24`）、`toHtml` 按空行切段；长篇章节与短篇节拍正文共用同一组件 |
| `client/components/PlanReviewModal.tsx`（137 行） | **替换（下线）** | 其"条目级 checkbox 选择 + 预览 + 汇总计数"（`:60-120`）交互范式迁到 P1/P2 的条目卡与阶段确认条；文件删除，路由不再引用 |
| `client/components/NewProjectModal.tsx`（201 行） | **重写** | 新流程：填表 → `new-project-precheck`（`GET /api/pipeline/precheck`）→ 提交 → **立即**导航到 `/project/:id/pipeline`；删除 `await api.planProject`（`:80`）与 `created` 分支（`:183-196`，即 AUDIT R1 的"主按钮消失且文案不可达"）；剧本类型走旧路径但保留进度/取消/错误可见 |
| `client/components/ProjectSettingsModal.tsx` | 保留 | 标题/封面/目标字数编辑；目标字数改动触发 P3 `stale` 提示（不自动改已确认计划） |
| `client/pages/OutlinePage.tsx` | 保留 | P2 全量视图；进入流水线后仍是同一批 `outline_acts/outline_beats` 行，保存后 `ctx.reload()` |
| `client/pages/CodexPage.tsx` | 保留 | P1 全量视图；写 `characters` 同一批行 |
| `client/pages/LibraryPage.tsx` | 改造 | 卡片加流水线状态 + 继续入口（§2.7） |
| `client/api.ts` | 扩展 | 新增 pipeline/stage/job/unit/migration 方法；沿用 `request<T>()` 的 `{data,error}` 解构范式 |
| `client/context/AppContext.tsx` | 微改 | 暴露 `reloadProjects()` 供 job 完成后刷新列表状态 |
| `client/styles/app.css` | 扩展 | 新增流水线页样式；现有 `.modal__notice`、`.ai-tab` 等继续用 |

**"哪些替换"一句话**：替换的是「新建 → 一次性企划 → 预览应用」这条链路（`NewProjectModal` + `PlanReviewModal` + `StudioPage` 内联企划）；编辑、版本、聊天、导出、大纲/设定页全部保留。

### 2.7 作品库列表：非孤儿的第一道防线

SPEC §3.4 判定孤儿的第一条就是"作品列表卡片没有『企划未完成』标识与继续入口"。因此 `LibraryPage` 卡片新增：

- 状态徽标：`企划中 n%`（有 running job）/ `企划未完成`（failed|cancelled|interrupted）/ `待审设定` / `待审大纲` / `待审章节计划` / `写作中 m/n` / `待审阅 k 章` / `已完成` / `旧版作品`；
- 主按钮按状态切换：`继续企划` / `查看进度` / `去审阅` / `继续写作` / `打开编辑器`；
- `legacy` 作品显示 `旧版作品` 且主按钮为 `打开编辑器`（默认不进流水线）。

徽标数据来自 `pipelineStatus` + `activeJob` + `pendingReviewCount`，由 `GET /api/projects` 的 `ProjectSummary` 扩展字段提供（只追加字段，旧字段不变）。

### 2.8 长短篇前端分支（一个组件，两个 profile）

不写两套页面。`client/pages/pipeline/kindProfile.ts`：

```ts
export const KIND_PROFILE = {
  novel: { unit: 'chapter', unitNoun: '章', rowTestId: 'chapter-row', planRowTestId: 'chapter-plan-row',
           planCount: 'chapter-plan-count', planTotal: 'chapter-plan-total',
           defaults: { goalWords: 300000, min: 2500, target: 3000, max: 4000 },
           presets: [ {id:'fast',label:'快节奏',min:1500,target:2000,max:2500},
                      {id:'standard',label:'标准',min:2500,target:3000,max:4000},
                      {id:'thick',label:'厚重',min:4000,target:5000,max:6000} ] },
  short: { unit: 'beat', unitNoun: '节拍', rowTestId: 'beat-row', planRowTestId: 'beat-plan-row',
           planCount: 'beat-plan-count', planTotal: 'beat-plan-total',
           defaults: { goalWords: 12000, min: 800, target: 1500, max: 2500 },
           presets: [ {id:'fast',label:'极短',min:500,target:900,max:1200},
                      {id:'standard',label:'标准',min:800,target:1500,max:2500},
                      {id:'thick',label:'舒展',min:1500,target:2500,max:3500} ] },
} as const;
```

规矩：**短篇绝不渲染 `chapter-row` / 卷 / 章 UI**（`beat-row` 计数 >0 且 `chapter-row` 计数 = 0，QA 直接断言）；`chapter-plan-confirm` / `chapter-plan-preset` 两个锚点按 SPEC §5.2 复用（语义为确认节拍计划），不另造新锚点。

---

## 3. 后端架构

### 3.1 模块划分

```
server/
  index.ts            ← 改：路由只做校验/转发；plan 路由降级为剧本兼容路径；新增 pipeline 路由
  provider/call.ts    ← 新增：单步模型调用（从 plan.ts/ai.ts 抽出的公共部分）
  pipeline/
    types.ts          ← 枚举与 payload 类型（StageKey / ItemKind / JobStatus / UnitStatus / ErrorCode）
    schema.ts         ← 手写结构校验（每步一个 validator）
    context.ts        ← 上下文装配与预算截断
    prompts/p1.ts p2.ts p3.ts p4.ts
    steps/            ← 每步一个 run(ctx)：buildPrompt → call → validate → 返回待写产物
    store.ts          ← 全部新表读写 + 事务边界
    runner.ts         ← JobRunner：队列、claim、step 循环、取消、暂停、恢复
    snapshot.ts       ← 快照装配 + nextStep 唯一推导（D6，纯函数）
    events.ts         ← job_events 写入（V1 只落库，V1.1 供 SSE 重放）
    precheck.ts       ← 默认模型/Key 前置校验（复用 models.ts 的解析逻辑）
    legacy.ts         ← 旧作品迁移（详见 MIGRATION.md）
  repository.ts       ← 改：createProject 去掉预写空幕/空章；其余保持
  db.ts               ← 改：migrate() 追加新表与补列（幂等，见 MIGRATION.md §2）
```

**复用**：`plan.ts:13 extractJson` 的反围栏解析、`models.ts` 的 provider/model 解析与能力判定、`utils.ts` 的 `countWords/now/uid`、`ai.ts:248` 的"模型解析在副作用之前"纪律、`ai.ts` 的三种家族适配器（openai/anthropic/gemini）。  
**移出**：`plan.ts` 的"一次生成三幕+人物+第一章"入口（`generateProjectPlan`）保留但降级为剧本兼容路径（`@deprecated`），novel/short 不再调用。

### 3.2 作业生命周期与状态机

**Job 状态**（严格按 SPEC §3.2，不新增状态）：

```
queued ──claim──> running ──done / failed / cancelled / interrupted
   └──cancel────> cancelled
   interrupted ──resume(新 job 带 retryOfId)──> running
   failed ──retry(新 job 带 retryOfId)─────────> running     （failed 本身不复用）
```

- **pause 不是 job 状态**（SPEC 只给 6 个 job 状态）。实现：`generation_jobs.pause_requested=1` → runner 在两个单元之间检查 → `status=cancelled`, `stop_mode='pause'`；前端 `paused` 由「最近 writing job 被 pause 停下 + 无 running job」派生。好处：状态机不多一个态，恢复逻辑与 cancelled 共用。
- `stop_mode ∈ {'pause','stop','user_cancel',NULL}`——区分"暂停""立即停止""取消企划"，取消态与暂停态的文案/出路因此不同。

**Step 模型**：一个 job 由有序 step 列表构成，`step_index` 持久化，**重试从失败 step 续跑**。

| job.kind | stage | steps（顺序） | 每次模型调用 | step 落库 |
|---|---|---|---|---|
| `plan` | p1 | `world` → `env` → `characters` | 1 次/步 | 该步条目 + 条目 revision + 阶段 revision |
| `plan` | p2 | `acts` → `beats:act[i]`（每幕一步） | 1 次/步 | 同上 |
| `plan` | p3 | `plan:batch[i]`（每批 ≤20 章/节拍） | 1 次/步 | 计划行（chapters 或 stage_items） |
| `writing` | p4 | `write:unit[i]`（每单元一步） | 1 次/步 | 该章正文 + 版本 + `review_status` |

`job.step` 是给前端看的值，只允许四个：`setting | outline | chapter-plan | writing`（对应 SPEC `plan-progress[data-step]`）；`step_index/step_total` 是内部真实进度。

**P4 是连续循环**（D4）：

```
for unit in units where review_status = 'pending' order by ordinal:
    if job.cancel_requested: break                     # 暂停：本轮写完才看这个标志
    unit.review_status = 'generating'  (记 job.current_unit_id)
    正文 = call(provider, buildChapterPrompt(unit))
    if job.cancel_requested: 丢弃正文, unit.review_status='pending', break   # 立即停止
    原子写: chapters.content + chapter_versions + words + review_status='in_review'
    写 job_events: unit {status:'in_review', words}（V1：前端 2s 轮询看到，不推送）
job.status = done            # 全部 pending 转 in_review，等用户逐章审
```

**章节状态**沿用 SPEC `pending|generating|in_review|approved|changes_requested|approved_manual|skipped`。D4 要求"生成中为 generating/queued，写完后统一转 in_review"：**不新增 `queued` 取值**（QA 按 SPEC 枚举断言），未开始的章保持 `pending`，前端在 running job 期间给 `pending` 行加"排队中"标签（`data-queued` 可选属性，不影响 `data-status` 枚举）。见 §11 R-4。

### 3.3 阶段产物模型

**三层结构**：`stages`（状态与指针）→ items（内容，物理表按类型分散）→ `revisions`（历史）。

```
projects(id) ──1:4── stages(stage_key p1..p4: status/stale/confirmed_revision_id)
                         │
                         └─ items（"编辑的最小单位"，id 稳定）：
                              p1: stage_items(kind=world|env) + characters
                              p2: outline_acts + outline_beats
                              p3: chapters（长篇，复用计划列）/ stage_items(kind=beat_plan)（短篇）
                              p4: chapters（长篇正文）/ stage_items(kind=beat_plan).body（短篇正文）
                         └─ revisions(scope=stage|item, target_id, source, note, content)
```

**为什么 items 不统一进 `stage_items`**（DECISIONS ADR-3）：`characters / outline_acts / outline_beats` 已被 `CodexPage`、`OutlinePage`、`export`（md/docx）、`bundle` 导入导出、`getProjectDetail` 读取；搬进新表等于重写这四条链路并制造双写。改为**统一 API + 适配层**：

```ts
// pipeline/store.ts —— 五个适配器实现同一个形状
interface ItemStore {
  list(projectId, stageKey): Item[]
  patch(projectId, itemId, patch, actor): Item        // 写 revision(source=manual)
  lock(projectId, itemId, locked): Item
  revisions(projectId, itemId): Revision[]
}
type Item = { id; kind; stageKey; ordinal; title; payload: Record<string, unknown>;
              locked; source; stale; revisionCount; updatedAt;
              unit?: { reviewStatus; words; min; max; target } }
```

API 对外只暴露 `Item`，前端与 prompt 装配都只认它；物理表差异被适配器吃掉。

**Revision 与确认快照**（INV-2）：

- 每次生成写一条 `revisions(source=ai_initial|ai_feedback|ai_regen)`，`content` 是该阶段/条目的完整快照（`content_kind=json|text`）；
- 每次人工编辑写 `source=manual`（`note` 记"人工编辑"）；
- 回滚写 `source=rollback`（`note` 记 "恢复自 rev_xxx"）；
- 确认时 `stages.confirmed_revision_id` 指向当前 revision，**该快照永不清**；阶段级快照保留**全部确认快照 + 最近 50 条**（超出裁剪，ADR-11）；
- `stages` 只存指针，不存内容——避免"两处真相"。

**已确认内容变更（R2）**：编辑/重生成 `confirmed` 阶段 → 内容即时更新（写新 revision）→ `stages.status` 回 `review`、`confirmed_revision_id` 保留（旧确认快照仍在历史里）→ 下游 `stale=1`。

### 3.4 事务边界（逐个写操作）

`node:sqlite` 的 `DatabaseSync` 是同步 API，单进程天然串行；封装 `withTx(fn)`（`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`，失败必须回滚）。

| 写操作 | 事务范围 | 原子性要求 |
|---|---|---|
| 创建作品 + 4 条 stages + 首个 job | 单事务 | 要么三样都有，要么都没有（禁止"落库了但没 job"→ 空壳） |
| 创建作品（不企划，`draft`） | 单事务（作品 + 4 stages，status=empty） | — |
| job claim | 单语句 `UPDATE generation_jobs SET status='running', started_at=? WHERE id=? AND status='queued'` + `changes===1` 判定 | 抢到才算 |
| 一个 step 落库（如 `characters`） | 单事务：items(增/改) + item revisions + stage revision + stage.status/updated_at + job.step_index/progress + job_events 行 | **步骤级原子**（INV-3）：失败/取消该步零写入 |
| P4 一章落库 | 单事务：`chapters.content/words/review_status` + `chapter_versions` 插入 + `current_version_id` + `projects.total_words` 回写 | **章级原子**：绝无半截正文 |
| 阶段确认 | 单事务：`stages.status=confirmed` + `confirmed_revision_id` + `confirmed_at` + 确认快照 revision + （若触发）下游 `stale` | 确认与 stale 传播同生同死 |
| 手工编辑条目 | 单事务：内容列 + revision(source=manual) + （若 confirmed）stage 回 review + 下游 stale | 同上 |
| 章节审阅动作 | 单事务：`review_status` + `review_records` + （rewrite）新版本 | — |
| 暂停/停止/取消 | 两条语句（`cancel_requested=1` 先落，abort 后置 job 终态）**不放进业务事务** | 让 UI ≤2s 看到"取消中" |
| 迁移 | 单事务（MIGRATION.md §4），失败整体 ROLLBACK | 9 条校验任一不等即回滚 |

**禁止**：在事务里做网络调用。所以 step 的形态恒为「事务外调用模型 → 事务内提交产物」。

### 3.5 并发与队列

- **单作品最多 1 个 running job**（INV-7）：`POST .../generate` 先查 `SELECT id FROM generation_jobs WHERE project_id=? AND status IN ('queued','running')`，有则 `409 {code:'CONCURRENT_JOB', jobId}`（前端给「查看进度」）。
- **全局并发 3**：`JobRunner` 内存信号量；`queued` 的 job 按 `created_at` FIFO 出队，`progress.queuePosition` 由队列快照算出（前端卡片显示"排队第 2 位"）。
- **不同作品可并行**，共享 sqlite 写锁（同步 API，毫秒级事务，不构成瓶颈）。
- **已知限制（必须写进 README 级文档）**：本架构是**单进程**设计，`JobRunner` 的并发控制依赖进程内存 + sqlite 单写者。**不要**起两个 server 进程指向同一 `PW_DATA_DIR`（会出现双 runner + WAL 写冲突）。要多进程/云端，必须先换 Postgres + 外部队列——列为待用户决策（§8、DECISIONS ADR-6）。

### 3.6 幂等

| 场景 | 机制 | 行为 |
|---|---|---|
| 重复点"创建" / 网络重发 | `projects.client_request_id` + 唯一索引（partial where not null），值来自请求头 `Idempotency-Key` | 命中已有行 → `200 {project, job}`（不新建） |
| 重复点"生成" | 请求体 `clientRequestId` → `generation_jobs(project_id, client_request_id)` 唯一索引 | 命中 → 返回同一 jobId（`200`），不重复烧 token |
| 重试 | 新 job `retry_of_id` 指向旧 job，`step_index` 从失败步开始 | 已成功步骤不重跑；产物按 revision 覆盖"当前展示"，不产生重复条目（INV-2） |
| step 重放（崩溃后 resume） | 每步写入前先查"该步是否已有产物"（按 step 语义键，如 `kind=characters` 的 revision） | 已有则跳过（幂等），避免重复条目 |
| 迁移升级 | `migrations` 表唯一 `done` 行 + 每步 `INSERT ... ON CONFLICT DO NOTHING` | 二次点升级 = 无操作（SPEC §9.5 第 9 条） |

### 3.7 取消 / 暂停 / 停止 / 上游释放

```
POST /api/jobs/:id/cancel
  → job.cancel_requested = 1                      （先落，UI 立即可见"取消中"）
  → AbortController.abort()                        （signal 一路传到 provider fetch）
  → 上游 fetch 抛 AbortError → 该步 catch 后零写入
  → job.status='cancelled', stop_mode='user_cancel', finished_at
  → 写 job_events(cancelled) + 结构化日志 status=cancel
```

- **要求 ≤5s 释放上游**：`provider/call.ts` 的 `fetch` 必须挂 job 的 `signal`，且 abort 后 `await` 结束（不吞异常、不重试）。AUDIT 实测现状"客户端 10.2s 取消、假服务跑到 40s"：因为 `plan.ts` 的 `AbortSignal.timeout(90000)` 是**内部超时**，与外部的"用户取消"无关。新设计里 `AbortSignal.any([AbortSignal.timeout(120000), jobSignal])`。
- **页面关闭/轮询断开 ≠ 取消**：轮询是前端单向请求，没有"连接"可断；`res.on('close')` 只对聊天 SSE 有意义，**不得** abort job（现状 `index.ts:451-453` 的 `onClose → controller.abort()` 对聊天是合理的，对 job 是错的）。这是 INV-5 的关键实现点。
- **暂停**：`pause_requested=1`，只在单元边界检查；界面立刻显示"将在本章完成后暂停"，本章完成事件到来后转 `paused`。
- **立即停止**：`stop_mode=stop` + abort 当前步；因为正文是章级原子写入，被中断的章自然停在 `pending`（已写部分从未落库）。

### 3.8 失败处理（不烧钱、不静默）

- **超时**：单步 120000ms（SPEC §10.1）。不再用"全局 90s 一次调用"（现状 `plan.ts:100/115/131`）。
- **自动重试**：仅 `429`/网络抖动（`ECONNRESET`/DNS）自动重试 **1 次**，退避 1s；其余一律失败等用户（R5）。
- **错误码**：严格用 SPEC §7.1 的 18 个 code；本文仅追加 3 个**非冲突**扩展码（QA 可忽略、不可混用）：`CONFIRM_BLOCKED`（422，确认门槛未满足，另有 `blockers[]`）、`TYPE_NOT_SUPPORTED`（422，剧本进流水线）、`IDEMPOTENT_REPLAY`（200 语义标记，可只做日志）。
- **reasoning 模型兼容**（AUDIT R5）：`provider/call.ts` 取 `message.content`；若为空而 `reasoning_content`/`reasoning` 非空 → `EMPTY_OUTPUT`（附"该模型是推理模型，正文在 reasoning_content 里/未产出正文"），**不得**抛 `INVALID_JSON` 混淆。
- **失败幂等**：job 失败后 `stages.status` 按 SPEC 回退（原本 empty → `empty`；有旧内容 → `review`），`project.lastError` 写入，日志写 fail 行。

### 3.9 重启恢复

1. **启动扫描**（`index.ts` 里 `migrate()` 之后、`listen` 之前）：`UPDATE generation_jobs SET status='interrupted', finished_at=now WHERE status IN ('queued','running')`，并逐条写日志。
2. 恢复按钮 → `POST /api/projects/:id/writing/continue`（P4）或 `POST /api/projects/:id/stages/:stage/regenerate {scope:'all', resume:true}`（P1–P3）：新 job，`retry_of_id` 指向被中断的 job；P1–P3 从"未完成 step"续跑（已写产物保留），P4 从第一个 `pending` 章续跑。
3. **不重写已完成章**：resume 的单元集合恒为 `review_status='pending'`；`in_review/approved/...` 一律跳过。
4. **关页面不取消**：轮询停止只影响前端刷新，job 继续；回来重新拉快照即可看到最新进度（SPEC §7.2 / INV-5）。

### 3.10 不回滚已确认阶段（写路径白名单）

INV-1 的实现靠"写路径白名单"，不靠口头约定。允许改动 `confirmed` 阶段内容的路径**只有三条**：

1. 用户显式 `PATCH /items/:id`（人工编辑）；
2. 用户显式 `POST /stages/:key/generate`（反馈/重生成）；
3. 迁移回退（`POST .../migrate/rollback`，带确认词）。

`runner` 里的任何 step **不得**写入非本阶段目标之外的阶段；P2 生成不得删除 P1 条目；P3 生成不得改动已有正文的章（SPEC §4.4：锁定章与已有正文的章默认保留，除非用户显式勾选）；P4 不改 P3 计划。测试用"阶段级写白名单"断言：跑一遍 P2 生成后，对 P1 所有行做逐字节 diff。

### 3.11 进度通道：轮询为主（V1），SSE 为 V1.1

**V1 只有一个进度通道**：前端轮询 `GET /api/projects/:id/pipeline`，每次拿**全量快照**（`PipelineSnapshot`，含当前 job 的 `JobView`）。这与 UX-SPEC §12.4 一致（那里把 SSE 明确列为 V1.1 优化），本文按此收口。三条理由：

1. `JobRunner` 用同步 `node:sqlite` 在单进程里跑；SSE 的长连接与同步写库共用事件循环，做不好会互相拖慢。AUDIT 现场的"40s 静止"根本不是通道太慢，而是**根本没有通道**；
2. 轮询没有半开连接、代理超时、`EventSource` 重连语义这三类坑，Electron 主进程重启也不会留下悬挂连接；
3. 每次轮询返回全量快照 ⇒ 前端不需要维护增量状态机，也不必自己推导"下一步"（D6 的前提）。

| 场景 | 间隔 | 依据 |
|---|---|---|
| `job.state ∈ {running, pausing}` | 2000ms | UX-SPEC §12.4；同时满足 SPEC §6.1「≤2s 更新」与 R-3「15s 无变化」 |
| `job.state = 'paused'` 且用户停留本页 | 10000ms | 上下文不变，只防"别处推进了" |
| 无 job、当前阶段 `review` | 5000ms | 感知其它窗口/后台变更（V1 可关） |
| 连续失败 3 次 | 停止轮询 → 控制条降级「与后台失去联系 · 最后更新 N 秒前」+「重试连接」 | 禁止无限重试刷爆日志 |
| 页面隐藏（`visibilitychange`） | 暂停轮询；回前台立即拉一次 | 省电 |

**单次快照必须快**：`GET /pipeline` 是 8 条左右的 `SELECT`（阶段 4 行 + 计数聚合 + 当前 job + review 计数 + lastError + migration），目标 p95 < 120ms；超过 300ms 说明有 N+1（例如逐章查版本数），必须改成聚合子查询。这是"≤2s 更新"能成立的前提。

**本地插值只允许"秒数"**：`JobView.elapsedMs` 由服务端按 `startedAt` 给出，前端在两次轮询之间本地递增显示；**不得**插值百分比、剩余章数、预计完成时间。阶段文案停在 `job.step` 上不动。

**`job_events` 表仍然写入**（每个 step / unit / error / done 一行，`seq` 单调）：V1 前端不读它，它承担三件事——① 事后排障（AUDIT R6 的"失败无痕"）；② V1.1 上 SSE 时按 `seq` 重放，表结构不用改；③ job 历史面板可展开明细。

**V1.1 的 SSE 契约（本次不实现，只锁定）**：`GET /api/jobs/:jobId/stream`，事件 `open / progress / unit / done / error / cancelled`，心跳 2000ms，`Last-Event-ID` 按 `job_events.seq` 重放，job 结束后保留最近 200 条、`done/error` 之后 10 分钟清理。届时前端在轮询之上叠加 SSE，轮询退化为降级通道——**契约在此锁定，避免 V1.1 重新设计事件格式**。

### 3.12 `PipelineSnapshot` 读取契约（D6：`nextStep` 由服务端唯一下发）

`GET /api/projects/:id/pipeline` 一次返回下文结构（字段名照 UX-SPEC §12.1/12.2，语义不可删；本文只补 `locked`/`blockedBy`/`unit` 三处扩展）。

```ts
interface PipelineSnapshot {
  project: ProjectSummary;                       // 复用现有 summary（LibraryPage 已在用）
  stages: Record<'p1'|'p2'|'p3'|'p4', StageView>;
  nextStep: NextStep;                            // 服务端唯一下发（D6）
  job: JobView | null;                           // 当前 active job（queued/running/pausing）
  lastJob: JobView | null;                        // 最近一条已终态 job（用于 paused/cancelled 展示）
  review: { pending: number; approved: number; changesRequested: number; manual: number; skipped: number };
  progress: { unitsDone: number; unitsTotal: number; words: number; plannedWords: number };
  lastError: PipelineError | null;                // 刷新后仍能渲染 plan-error
  migration?: { state: 'legacy'|'failed'|'done'; at?: string };
}

interface StageView {
  status: 'empty'|'generating'|'review'|'confirmed'|'failed'|'skipped';   // UX-SPEC §10.1 的 6 值，不改
  locked: boolean;            // 新增：上游未确认，操作被服务端拒绝（409 STAGE_LOCKED）
  blockedBy?: 'p1'|'p2'|'p3'; // 新增：locked 的原因（用于文案"先确认设定"）
  counts: { items: number; locked: number; words?: number; units?: number; unitsDone?: number };
  updatedAt: string | null;
  staleReason?: string | null;
}

interface NextStep {
  kind: NextStepKind;         // 封闭枚举，见下表
  label: string;              // 中文文案，服务端给（唯一文案源）
  stage?: 'p1'|'p2'|'p3'|'p4';
  blockers?: string[];        // 与 kind 组合使用（如 'stage-blocked'）
  count?: number;             // 用于"25 章待审"这类文案
}

interface JobView {
  id: string;
  kind: 'plan'|'regen-stage'|'regen-item'|'chapter-plan'|'writing'|'chapter-rewrite';
  stage: 'p1'|'p2'|'p3'|'p4';
  step?: 'setting'|'outline'|'chapter-plan'|'writing';   // plan-progress[data-step]
  state: 'running'|'pausing'|'paused'|'done'|'failed'|'cancelled'|'interrupted';
  startedAt: string; elapsedMs: number;
  unit?: 'chapter'|'beat';
  currentUnitNo?: number; currentUnitId?: string; currentUnitTitle?: string;
  currentUnitWords?: number;                              // 拿不到就不给，UI 不编
  unitsDone: number; unitsTotal: number; wordsTotal: number;
  pausePending?: boolean;
  failedUnitNo?: number;
  avgUnitMs?: number;                                     // ≥2 个单元完成才有
  error?: PipelineError;
}
```

**`StageView.status` 的映射（内部 5 态 → UX 6 值）**：

| 内部 `stages.status` / `skipped` | `counts.items` | 快照 `status` | `locked` |
|---|---|---|---|
| `locked`（上游未确认） | 0 | `empty` | `true` |
| `locked`（上游未确认但已有预览内容） | >0 | `review` | `true` |
| `generating` | — | `generating` | `false` |
| `review` | — | `review` | `false` |
| `confirmed` / `skipped=1` | — | `confirmed` / `skipped` | `false` |
| `failed` | — | `failed` | `false` |

> `locked` + 有内容 → 显示「待确认」但确认按钮 disabled + 「先完成 P1」。这样既不改 UX 的 6 值枚举，也不让用户在顺序倒挂时点到一个必然 409 的按钮（SPEC R6 的"提前告知"）。

**`nextStep` 推导表（服务端 `pipeline/snapshot.ts` 的纯函数 `deriveNextStep()`）**：按序取第一个命中，前 5 行是"异常态优先"，后 10 行是 UX-SPEC §3.3 的正常路径。

| # | 条件 | `kind` | `label` |
|---|---|---|---|
| 1 | `migration.state='legacy'` | `migrate` | 升级到流水线 |
| 2 | 前置校验未过（无 Key/无默认模型） | `fix-provider` | 去配置模型 |
| 3 | `job.state ∈ {running, pausing}` | `watch` | 正在企划… / 正在写作（`count = unitsDone/unitsTotal`） |
| 4 | `lastJob.state='paused'` | `resume-writing` | 继续写作 |
| 5 | `lastError` 存在且无 active job | `retry-failed` | 重试（`blockers=[code]`） |
| 6 | P1 `empty` | `generate-p1` | 让 AI 生成设定 |
| 7 | P1 `review` | `review-p1` | 审阅并确认设定 |
| 8 | P2 `empty` | `generate-p2` | 生成故事大纲 |
| 9 | P2 `review` | `review-p2` | 审核故事大纲 |
| 10 | P3 `empty` | `generate-p3` | 生成章节计划 / 生成节拍计划 |
| 11 | P3 `review` | `review-p3` | 检查章节字数并确认 |
| 12 | P4 未开始（全 `pending`） | `start-writing` | 开始连续写作 / 开始逐节拍写作 |
| 13 | P4 有 `changes_requested` | `fix-chapters` | 修改被退回的章（`count`） |
| 14 | P4 有 `in_review` | `review-chapters` | 开始逐章审阅（`count` 待审） |
| 15 | P4 全终态（无 pending/in_review/changes_requested） | `export` | 导出成稿 |

- `NextStepKind` 就是上表 15 个值，**封闭枚举**（前端 `switch` 穷尽，新增值必须同时改类型与文案表）。
- 该函数是**纯函数**（入参 = 快照内部状态，出参 = NextStep），单测必须覆盖 15 个分支 + 3 个优先级冲突用例（如"job running 且 P2 review"必须给 `watch`）。
- 前端**不重算**：`nextStep.kind` 只决定点击行为（启动 job / 切 `?stage=` / 跳写作台 / 打开导出），`label` 直接渲染。

### 3.13 动作接口（对齐 UX-SPEC §12.3 + D5/D6/D9）

所有写接口：① 可选 `Idempotency-Key` 头（缺失时服务端用 `projectId+action+body 摘要` 兜底，不因此报错）；② 失败一律 `{code, message?, blockers?, unitIds?}`；③ 任何写操作成功后，前端**只重拉一次快照**，不做本地增量修改（避免与服务端状态漂移）。

| 方法 | 路径 | 请求体 | 成功 | 失败码 |
|---|---|---|---|---|
| GET | `/api/pipeline/precheck` | — | `200 {ok:true}` | `200 {ok:false, code:'NO_DEFAULT_MODEL'\|'NO_API_KEY'}` |
| POST | `/api/projects` | `{title,type,premise,targetWords,styleNotes,start:'pipeline'\|'none'}`（`premise`→`projects.description`，`targetWords`→`goal_words`） | `201 {project, job}`（`start='pipeline'` 时同事务建 job）；幂等重放 `200` | `422`（校验）/`409 CONCURRENT_JOB` |
| GET | `/api/projects/:id/pipeline` | — | `200 PipelineSnapshot` | `404` |
| POST | `/api/projects/:id/pipeline/start` | `{kind:'plan', stage?:'p1'\|'p2'\|'p3'\|'p4'}` | `202 {job:JobView}` | `409 STAGE_LOCKED` / `409 CONCURRENT_JOB` / `422` / `502`+code |
| POST | `/api/jobs/:jobId/cancel` | `{mode:'pause'\|'stop'}` | `202 {job}` | `404` / `409`（已终态，幂等返回 `200`+当前 job） |
| POST | `/api/projects/:id/writing/start` | `{mode:'continuous'\|'single', unitId?}` | `202 {job}` | `409 STAGE_LOCKED`（P3 未确认）/`409 CONCURRENT_JOB` |
| POST | `/api/projects/:id/writing/pause` | — | `202 {job}`（`pausePending:true`） | `409`（无 running job） |
| POST | `/api/projects/:id/writing/continue` | — | `202 {job}`（新 job，`retryOfId`=旧） | `409` |
| POST | `/api/projects/:id/writing/stop` | `{confirm:true}` | `202 {job}`（`stopMode:'stop'`） | `409` |
| POST | `/api/projects/:id/stages/:stage/regenerate` | `{scope:'all'\|'block'\|'item', targetId?, note?}` | `202 {job}` | `409 CONCURRENT_JOB` / `409 STAGE_LOCKED`（regenerate 下游阶段时） |
| POST | `/api/projects/:id/stages/:stage/feedback` | `{scope, targetId?, note}`（`note` ≥4 字） | `202 {job}` | `422 NOTE_TOO_SHORT` |
| POST | `/api/projects/:id/stages/:stage/confirm` | `{}` | `200 {stage, snapshotRevisionId}` | `422 {code:'CONFIRM_BLOCKED', blockers}` / `409 STAGE_LOCKED` |
| POST | `/api/projects/:id/stages/:stage/skip` | `{reason?}` | `200 {stage}` | `422`（仅 p1 可跳过） |
| POST | `/api/projects/:id/stages/:stage/stale/resolve` | `{action:'keep'\|'regenerate'\|'ignore'}` | `200 {stage}` | `422` |
| PATCH | `/api/projects/:id/stages/p3/units/:unitId` | `{title?, function?, synopsis?, characters?, minWords?, targetWords?, maxWords?, acceptDeviation?}` | `200 {unit, summary}` | `422 {code:'DEVIATION_NOT_ACCEPTED', deltaPct}` / `409 STAGE_LOCKED` |
| POST | `/api/projects/:id/stages/p3/units/count` | `{count, archiveOrphans?}` | `200 {summary}` | `422 {code:'CONTENT_WOULD_BE_LOST', units:[...]}` |
| POST | `/api/projects/:id/stages/p3/units/allocate` | `{totalTarget}` | `200 {preview:[{unitId,targetWords,minWords,maxWords,manuallyEdited}], totalBefore, totalAfter, deviationPct, overTolerance}`（**纯计算，不落库**） | `422`（无单元） |
| POST | `/api/projects/:id/stages/p3/units/allocate/apply` | `{rows:[{unitId,targetWords}], includeEdited?:false, acceptDeviation?}` | `200 {summary}` | `422 {code:'TARGET_EDITED', unitIds}`（默认跳过手改行，需显式 `includeEdited`）/ `409 STAGE_LOCKED` |
| PATCH | `/api/projects/:id/items/:itemId` | `{title?, payload?}` | `200 {item, stage}` | `409`（locked/版本冲突） |
| POST | `/api/projects/:id/items/:itemId/lock` | `{locked:boolean}` | `200 {item}` | `404` |
| GET | `/api/projects/:id/stages/:stage/revisions?targetId=` | — | `200 {revisions}` | — |
| GET | `/api/projects/:id/units/:unitId/versions` | — | `200 {versions, currentVersionId}` | — |
| POST | `/api/chapters/:id/review` | `{action:'approve'\|'request_changes'\|'manual_approve'\|'skip'\|'rewrite'\|'expand'\|'shrink', note?, mode?}` | `200 {unit, nextPendingChapterId?}`；`rewrite/expand/shrink` → `202 {job}` | `422 {code:'NOTE_REQUIRED'}`（request_changes）/`409`（非 in_review） |
| GET | `/api/projects/:id/jobs` | — | `200 {jobs}`（最近 20） | — |
| POST | `/api/projects/:id/migrate` | `{}` | `200 {migration}` | 见 MIGRATION §4.4 |
| POST | `/api/projects/:id/migrate/rollback` | `{mode:'sql'\|'file', confirm}` | `200` | `409` |
| GET | `/api/projects/:id/migration` | — | `200 {migration}` | `404` |

**D5（审阅四键只在写作台）的接口侧落点**：

- `POST /api/chapters/:id/review` 是审阅动作的**唯一**写入口（写 `review_records` + 改 `review_status`），只从 `StudioPage` 调用；
- 流水线章节板**不调用**它，只在行内渲染 `data-testid="chapter-row"` + 「审阅」导航（跳 `/project/:id?chapter=<id>&review=1`）；
- 因此 `chapter-approve` / `chapter-request-changes` / `chapter-manual-approve` / `chapter-skip` 四个锚点在任一页面最多出现一次，QA 不需要 `.first()` 兜底；
- 快照侧只需给 `review` 计数与每行的 `reviewStatus`，**不**给"四键是否可用"的布尔数组（那是把 UI 判定塞进数据契约）。

**D9（P3 按目标字数分配）的接口侧落点**：`allocate` 与 `allocate/apply` 拆成两步——前者**纯计算**返回预览（含每行 `manuallyEdited` 标记与总偏差），后者按用户确认的行写库。`PATCH .../units/:unitId` 写入手改的行时置 `chapters.target_manual=1`（MIGRATION §2.2），`apply` 默认跳过这些行（`422 TARGET_EDITED` 提示"这 3 章的字数你手改过，是否一起覆盖"），**禁止静默重算用户手改过的字数**（CAPTAIN-DECISIONS D7）。

**保留但降级**：`POST /api/projects/:id/plan`（`index.ts:102-111`）保留给 `screenplay/series` 旧路径，改动仅三点：120s 超时、`AbortSignal` 挂在客户端断开上（修 R3）、失败返回结构化 code + 写日志（修 R6）。`POST .../plan/apply`（全量 DELETE 重建，`repository.ts:910`）标注 `@deprecated`，novel/short 不再调用，V1.1 移除。

### 3.14 可观测性

1. **job 持久化 + 最近 20 条**（SPEC §7.5）：流水线页可展开 job 历史（时间、阶段、模型、耗时、usage、错误码）。
2. **结构化日志**（沿用现有 `logs/server.log` 一行一条，字段固定）：

```
[job] id=job_01H.. project=p_.. stage=p1 step=world status=start provider=deepseek model=deepseek-chat
[job] id=job_01H.. project=p_.. stage=p1 step=env   status=ok dur=8213ms completion=812
[job] id=job_01H.. project=p_.. stage=p4 unit=ch_003 status=ok words=3140 version=v_01H..
[job] id=job_01H.. project=p_.. stage=p1 step=env   status=fail code=EMPTY_OUTPUT dur=120034ms
[job] id=job_01H.. project=p_.. stage=p4 unit=ch_003 status=cancel
[stage] project=p_.. stage=p2 action=confirm revision=rev_01H..
[stage] project=p_.. stage=p2 action=stale reason=p1:character_deleted
[migrate] project=p_.. id=mig_01H.. status=ok dur=1204ms chapters=12 versions=31
```

3. **项目级 `lastError`**：`projects.last_error` 存 `{code,message,at,stageKey,unitId?}` JSON，界面 `plan-error` 与作品库徽标都读它；刷新/重启仍在。
4. **"失败必写 / 取消必写 / 成功必写（含 usage）"** 三条在代码评审时作为硬检查项（对应 AUDIT R6 零日志）。

---

## 4. 生成策略（分阶段 prompt 与结构校验）

### 4.1 分步生成矩阵

**铁律：一次模型调用只产一个阶段的一个块/一批，绝不一次生成整本。** 现状 `plan.ts:138-185` 一次调用产"3 幕 + 3–5 人物 + 第一章 300–500 字"已经不满足拆分要求（D1），更不允许把 P3 200 章或 P4 全书塞进一个 prompt。

| 阶段 | step | 单次调用产出 | 结构约束（校验失败 → `INVALID_JSON`） | prompt 必含 |
|---|---|---|---|---|
| P1 | `world` | 1 条 world（时代地点/世界规则/基调母题/语言习惯） | 4 个字段均非空字符串（短篇允许"世界规则"为空但要显式 `worldRulesNotNeeded:true`） | 题材、一句话灵感、目标字数、风格与禁区、类型（长篇/短篇） |
| P1 | `env` | 2–4 条 env（名称/类型/氛围关键词/出场理由） | 条目数 2–4；`name` 非空、`type ∈ {城,村,机构,异境}` | world 摘要（≤300 字） |
| P1 | `characters` | 1–20 条 character | 主角 ≥1；`name/role/motivation` 非空；去重名；禁占位（`角色A`/`未命名`） | world + env 摘要；"至少 1 位主角、其余 0–20" |
| P2 | `acts` | 2–12 幕（标题/功能/摘要/涉及人物） | 幕数 2–12；功能 ∈ {钩子,推进,转折,揭示,高潮,收束,缓冲}；摘要 2–5 句 | P1 压缩摘要（人物名+动机+关系）+ logline + 目标字数 |
| P2 | `beats:act[i]` | 该幕 2–12 节拍（标题/功能/摘要/预计章节/伏笔回收） | 每幕 2–12；`plannedChapters ≥1`；ΣplannedChapters 与 P3 章数偏差提示（不阻断） | 该幕摘要 + 前后幕各一句（保证衔接）+ 人物表 |
| P3 | `plan:batch[i]` | ≤20 章（标题/功能/大纲/字数范围/涉及人物） | 章数 3–200；`300≤min≤target≤max≤20000`；大纲 ≥15 字 | 全书目标字数、章数建议、三档预设、**上一批最后一章的摘要**（保持连贯） |
| P4 | `write:unit[i]` | 1 章正文 | `words` 与范围比对（见 §4.3）；`finish_reason≠length` | 见 §4.2 上下文装配 + 本章计划 + 字数指令 |

短篇把上表的"幕/章"读作"节拍组/节拍"，参数换成 §2.8 的 `KIND_PROFILE.short`，其余各列不变。

### 4.2 上下文装配与预算（`pipeline/context.ts`）

按层装配，**总预算 12000 字符**（约 6–8K token，给输出留足空间），超预算按下列顺序截断并记录 `truncated[]`（写入 job.progress 与日志，便于解释"AI 怎么忘了设定"）：

| 层 | 内容 | 预算 | 截断策略 |
|---|---|---|---|
| L0 作品元信息 | 标题、类型、题材、一句话灵感、目标字数、风格与禁区 | 800 | 不截断 |
| L1 世界观 | world 4 字段（可压缩为规则要点） | 1200 | 先截"语言与称谓" |
| L2 人物 | 主角全量 + 配角 `name/role/motivation`；上限 20 人 | 2500 | 先砍配角弧光，再砍配角出场 |
| L3 大纲 | 当前章所在幕摘要 + 前后各一幕一句话 | 1500 | 砍前后幕 |
| L4 计划 | 本章计划（功能/大纲/字数范围/涉及人物） | 600 | 不截断 |
| L5 前文 | 上一章末尾 500 字 + 前 2 章各 1 句摘要 | 2000 | 先砍第 2 章摘要 |
| L6 反馈 | 用户本次意见（阶段级或条目级） | 800 | 不截断 |
| 预留 | 系统指令 + 输出格式说明 | 2600 | — |

**禁止**把全书正文塞进上下文（现在 StudioPage 的 AI 面板就是这么做的，P4 不走那条路）。

### 4.3 字数范围如何进入 prompt 与验收

**进 prompt**（每章都写，不允许只写"约 3000 字"）：

```
本章目标 3000 字，可接受范围 2500–4000 字。
请写足情节与场景，不要为凑字数灌水，不要写"（未完）""待续"之类占位。
结尾必须留一个让读者想看下一章的钩子。
```

**验收**（服务端判、前端展示、`review` 不阻断但必须可见，SPEC §10.2）：

| 判定 | 条件（`countWords` 口径：非空白字符数，沿用 `utils.ts`） | 标记 | 给的修复动作 |
|---|---|---|---|
| 正常 | `min*0.9 ≤ words ≤ max*1.1` | — | — |
| 偏短 | `words < min*0.9` | `short` | 「扩写」（`rewrite mode=expand`，新版本） |
| 偏长 | `words > max*1.1` | `long` | 「精简」（`mode=shrink`） |
| 被截断 | `finish_reason='length'` | `truncated` | 「续写」；**不得**把截断文本当完成品通过（按钮 disabled + 原因） |

超范围**不阻断** approve（用户可通过），但 `chapter-row[data-words]`、`data-flags` 必须可见。P3 侧的总量校验（Σtarget 与目标字数偏差 ±25%）见 SPEC §4.4 第 3 条，服务端在 confirm 时二次校验。

### 4.4 结构校验（`pipeline/schema.ts`）

手写校验器（不引 zod），每条返回 `{ok, errors:[{path, message}]}`：

```ts
validateWorld(json)      validateEnvList(json)     validateCharacters(json)
validateActs(json)       validateBeats(json, act)  validateChapterPlan(json, batch)
validateChapterText(text, unit)                    ← 只做非空/最小长度/占位检测，不做文学评判
```

规则要点：

- **严格裁剪而非宽容修补**：现状 `plan.ts:21 normalizePlan` 会 `slice(0,4)` 静默丢内容——新代码对超量数据报 `INVALID_JSON`（附"模型多给了 N 条"），由重试解决，避免用户拿到被悄悄砍掉一半的大纲；
- **占位检测**：`/^(未命名|角色[A-Z]|待定|TODO|\.\.\.)$/` 命中即视为空；正文出现 `（未完）`/`待续`/`[续]` 视为截断；
- **错误详情落库**：校验失败时把模型原始输出存 `revisions(content_kind='text', source='ai_rejected')`，便于复盘；界面只说"模型输出格式不对"，不把原始 JSON 甩给用户。

### 4.5 推理模型与会话级兼容（AUDIT R5）

- `provider/call.ts` 统一返回 `{text, reasoning, finishReason, usage, raw}`；`text` 空而 `reasoning` 非空 → `EMPTY_OUTPUT`（提示"该模型未产出正文，可能只做了推理；换非推理模型或降低推理等级"）。
- 推理等级与模型能力不匹配不再直接 502：先按 `models.ts` 的能力判定**降级到模型支持的档位并写日志**（`[provider] reasoning=high unsupported by model → fallback medium`），只有完全无法调用才 `REASONING_UNSUPPORTED`。这一条比现状 `plan.ts:147-152` 的硬 502 更符合"不让用户卡死"。

---

## 5. 长短篇分支

### 5.1 差异清单（后端）

| 维度 | 长篇 | 短篇 | 实现位置 |
|---|---|---|---|
| P0 目标字数 | 300000 / [1e4, 3e6] | 12000 / [3000, 15000] | `KIND_PROFILE`（前后端同源常量，服务端为准） |
| P1 世界规则 | 必填（否则显式勾选"不需要"） | 默认"不需要" | `pipeline/schema.ts` |
| P2 结构 | 幕 2–12 + 幕下节拍 2–12 | 节拍组 + 节拍 6–40，不出现"幕"字 | `p3/acts` 的 `kind` 参数 |
| P3 单元 | `chapters`（计划列） | `stage_items(kind=beat_plan)` | `store.ts` 适配器 |
| P3 单元数 | 3–200，默认 `clamp(round(goal/3000),3,200)` | 3–40，默认 `clamp(round(goal/1500),3,40)` | `p3/plan` |
| P4 正文 | `chapters.content` + `chapter_versions` | `stage_items.body` + `revisions(content_kind='text')` | 两个单元适配器 |
| 正文组织 | 卷/章 | 单一正文流（节拍按序拼接） | 导出时拼接 |
| 章节记录 | 有 | **不得有**（`chapters` 无该作品行） | `store.createUnits` 按 profile 分支 |
| 导出 md | 按卷/章 | 整篇连续正文 | `export` 分支 |

### 5.2 短篇正文的存储与边界（SPEC §5.3 的实现）

要求是"正文按整篇保存，但每个节拍必须有稳定边界，重写一个节拍不影响其他节拍"。实现：

- **每节拍正文存 `stage_items.body`**（节拍 = 稳定边界，天然满足"重写不影响其他节拍"）；
- 整篇 = 按 `ordinal` 拼接 `body`（分隔 `\n\n`），由 `GET /api/projects/:id/pipeline` 与导出接口派生；**不额外维护一份整篇副本**（避免两处真相与拼接漂移）；
- 字数：每节拍 `stage_items.words`；整篇 = Σ，导出时显示"整篇 N 字"并逐节拍显示偏移（SPEC 要求）；
- 版本：`revisions(scope='item', target_id=节拍id, content_kind='text')`，`restore` 写新 revision（`source='rollback'`），与长篇 `chapter_versions` 语义对齐（`restoreChapterVersion` 的"先存回退前"纪律照抄，见 `repository.ts:994`）；
- UI：`WritingStage` 用 `KIND_PROFILE.short` 渲染 `beat-row`，正文编辑器仍用 `ChapterEditor`（受控值 = 当前节拍 body）。

### 5.3 剧本/剧集（不进流水线）

`screenplay|series`：`pipelineStatus` 恒为 `legacy`，`/pipeline` 重定向到 `/screenplay`；新建时勾选 AI 企划走旧 `plan` 路由（已按 §3.13 修好超时/取消/错误可见），**不建 stages**，不做迁移候选。

---

## 6. 数据模型

> **DDL 的权威版本在 `MIGRATION.md` §2**（含 `ALTER TABLE` 语句、索引、幂等升级写法）。本节只讲模型与约束映射，避免两份 DDL 漂移。

### 6.1 新增 7 表（职责一句话）

| 表 | 职责 | 关键列 | 与现有表的关系 |
|---|---|---|---|
| `stages` | 每作品 4 行，管阶段状态与确认指针 | `project_id, stage_key(p1..p4), status, stale, confirmed_revision_id, confirmed_at, updated_at`；`UNIQUE(project_id, stage_key)` | 新主线；`projects.pipeline_status` 由它推导后冗余落库供列表用 |
| `stage_items` | 无旧表归宿的条目：P1 的 `world/env`、短篇 P3/P4 的 `beat_plan`（含正文 `body`） | `id, project_id, stage_key, kind, ordinal, title, payload(json), body, words, locked, review_status, current_revision_id, error_code, archived_at, source, updated_at` | 短篇正文块；长篇不参与 |
| `revisions` | 阶段/条目修订历史（INV-2） | `id, project_id, stage_key, scope(stage\|item), target_id, source, note, content, content_kind, job_id, created_at` | `target_id` 指向 stage_items/characters/outline_acts/outline_beats/chapters 的 id |
| `generation_jobs` | 任务（与页面解耦） | `id, project_id, stage_key, kind(plan\|writing), status, step, step_index, step_total, progress(json), provider_id, model_id, usage(json), error_code, error_message, cancel_requested, pause_requested, stop_mode, current_unit_id, retry_of_id, client_request_id, started_at, finished_at, heartbeat_at` | `stop_mode`/`current_unit_id` 是本文新增（不改 SPEC 枚举） |
| `job_events` | 任务事件持久化（V1 排障，V1.1 供 SSE 重放） | `job_id, seq, type, payload(json), created_at`；`PRIMARY KEY(job_id, seq)` | — |
| `review_records` | 章节/节拍审阅留痕 | `id, project_id, unit_kind, unit_id, action, note, version_id, job_id, created_at` | 与 `chapter_versions` 互补（一个记内容版本，一个记审阅动作） |
| `migrations` | 旧作品升级记录与校验结果 | `id, project_id, kind, from_schema, to_schema, status, backup_path, bundle_path, checks(json), error, started_at, finished_at` | 与 `app_meta.schema_version` 配合（见 MIGRATION.md） |

### 6.2 现有表补列（全部为"追加可空/带默认"，不动既有列语义）

| 表 | 新列 | 用途 |
|---|---|---|
| `projects` | `pipeline_status`（默认 `'legacy'`）、`stale`、`last_error`、`migration_id`、`schema_version`（默认 1）、`style_notes`、`client_request_id` | 流水线状态、错误可见、幂等创建、迁移标记。**`premise` 不新增列**：一句话灵感早已落在 `projects.description`（`NewProjectModal.tsx:110`），API 的 `premise` 字段直接映射到它，避免同一语义两张列 |
| `chapters` | `review_status`（默认 `''`）、`plan_function`、`plan_synopsis`、`plan_characters`、`min_words`、`target_words`、`max_words`、`target_manual`、`plan_locked`、`current_version_id`、`stale`、`archived_at`、`last_error` | 长篇 P3 计划列 + P4 单元状态；`''` 表示"未进流水线"，旧作品语义不变；`target_manual=1` 标记用户手改过的目标字数（D7：分配不得静默覆盖） |
| `characters` | `motivation`、`arc`、`is_protagonist`、`locked`、`source` | P1 人物字段（SPEC §4.2）+ 锁定/来源 |
| `outline_acts` | `act_function`、`characters`、`locked`、`source` | P2 幕功能与涉及人物 |
| `outline_beats` | `beat_function`、`planned_chapters`、`foreshadow`、`locked`、`source` | P2 节拍功能/预计章节/伏笔 |

### 6.3 索引（每个都对应一个真实查询）

| 索引 | 支撑的查询 |
|---|---|
| `UNIQUE(project_id, stage_key)` on `stages` | 阶段读写、`GET /pipeline` 一次拿 4 行 |
| `(project_id, stage_key, kind, ordinal)` on `stage_items` | P1 分组渲染、短篇节拍顺序 |
| `(project_id, target_id, created_at DESC)` on `revisions` | 条目修订历史抽屉 |
| `(project_id, stage_key, created_at DESC)` on `revisions` | 阶段级历史 / 确认快照查找 |
| `(project_id, status)` + `partial(status IN ('queued','running'))` on `generation_jobs` | 单作品并发检查、启动扫描 interrupted、队列排序 |
| `UNIQUE(project_id, client_request_id) partial(not null)` on `generation_jobs` | 生成幂等 |
| `UNIQUE(client_request_id) partial(not null)` on `projects` | 创建幂等 |
| `PRIMARY KEY(job_id, seq)` on `job_events` | 事件重放（V1.1 SSE 按 `seq > lastEventId`） |
| `(project_id, unit_id, created_at DESC)` on `review_records` | 章节审阅历史 |
| `UNIQUE(project_id) partial(status='done')` on `migrations` | 迁移幂等（二次升级=无操作） |

### 6.4 不变式 → 约束/校验的落点

| 不变式 | 落点 |
|---|---|
| INV-1 确认不可静默覆盖 | 写路径白名单（§3.10）+ `stages.confirmed_revision_id` 快照永不清 + 测试：P2 生成后 P1 全行 diff 为空 |
| INV-2 输出先落修订 | step 落库事务里先插 `revisions` 再改"当前指针"；无 revision 的内容不存在 |
| INV-3 失败/取消不写半截 | 步骤级/章级事务（§3.4）+ abort 后 catch 里零写入 |
| INV-4 无配置不产正文 | `pipeline/precheck.ts` 在创建前校验；`provider/call.ts` 无 provider 直接抛 `NO_DEFAULT_MODEL`；`mock` 徽标沿用 0f08e42 语义 |
| INV-5 任务与页面解耦 | job 表驱动 + 页面关闭不 abort（§3.7）；前端轮询停止不影响 job |
| INV-6 不产生空壳 | `createProject` 不再预写空幕/空章；创建+stages+job 同事务 |
| INV-7 单作品单任务 | `POST generate` 前置查询 + `409 CONCURRENT_JOB`；claim 用条件 UPDATE |

---

## 7. 测试边界（可注入的接缝）

### 7.1 接缝清单（哪里能替身、哪里必须真的）

| 接缝 | 形态 | 测试怎么用 |
|---|---|---|
| provider | `provider/call.ts` 导出 `callJson(opts) / callStream(opts)`，内部按 `provider.family` 分派 | 单测替身直接返回预设 JSON/错误；集成测接 AUDIT 的 `fake-provider.mjs`（延迟/HANG/401/429/空 content/`finish_reason=length`） |
| 时钟 | 注入 `now()`（默认 `utils.now`） | 断言 120s 超时、心跳 ≤2s、7 天 stale 忽略 |
| abort | 每个 job 一个 `AbortController`，`signal` 显式传参 | 单测直接 abort 断言"零写入 + ≤50ms 结束" |
| DB | `store.ts` 全部走 `db` 单例 + `PW_DATA_DIR` | 迁移/事务测试用 fixture 库副本（`cp studio.db /tmp/...`），绝不碰真实库 |
| 事件写入 | `events.ts` 的 `emit(jobId, type, payload)` 可换 `MemorySink` | 断言事件序列与 `job_events` 行一一对应（V1 无推送，断言的是落库） |
| 前端状态 | `deriveViewState()` 纯函数 | 7 个视图态直接单测，不启动浏览器 |

### 7.2 必须覆盖的用例（按层）

**API/单元**（`pnpm test`，node 直跑，沿用现有 `api-test.mjs` 风格）

1. 状态机穷举：Stage 6 态 × 允许转移 → 非法转移返回 `409/422`（用表驱动，读 SPEC §3.2）；
2. job 生命周期：queued→running→done；queued→cancelled；running→interrupted（模拟重启扫描）；
3. 取消：注入 40s 慢 provider，调 cancel，断言 ≤2s 变 cancelled、≤5s 收到 abort、无半截条目（前后行数相等）；
4. 超时：HANG provider，断言 120s 后 `PROVIDER_TIMEOUT` + `lastError` 落库 + 日志 fail 行；
5. `EMPTY_OUTPUT`（reasoning-only）与 `INVALID_JSON`（坏 JSON/结构不符）分别可区分；
6. 429 自动重试 1 次后仍失败 → `RATE_LIMIT`，且**只**发生 2 次请求（断言 provider 计数）；
7. 并发：同作品第二次 generate → `409 CONCURRENT_JOB` 且返回 jobId；不同作品 4 个 → 第 4 个 `queued` 且 `queuePosition=1`；
8. 幂等：同 `clientRequestId` 两次 generate → 同一 jobId；同 `Idempotency-Key` 两次创建 → 一个作品；
9. 重试只重跑失败步：第 2 步失败 → retry 后第 1 步不产生新 revision（数量断言）；
10. 写白名单：P2 生成前后 P1 全行 diff 为空；P3 重生成不动已写正文的章。

**UI**（`pnpm test:ui`，Playwright，沿用现有 23 组用例范式）

11. 四态：`plan-progress[data-state]` 在 500ms/15s/完成/失败/取消各点取值正确（S3/S4/S5）；
12. R-3 红线：慢供应商 40s，脚本每 2s 采样 DOM 快照，断言"任意 15s 内至少 1 处变化"（秒数即可）；
13. 刷新恢复：生成中 reload → `plan-progress` 仍在且秒数继续（S9）；
14. 暂停/立即停止：pause 后本章写完才停；stop 后当前章无正文（对比前后字数）；
15. 单章失败恢复：第 3 章注入 500 → 第 4 章继续（D4 连续生成不中断）、第 3 章可重试；
16. 短篇：`chapter-row` 计数 = 0、`beat-row` 计数 = 节拍数、导出整篇字数 = Σ节拍；
17. 孤儿三判据（SPEC §3.4）：失败/取消后卡片有标识与出路；无占位结构；点击必跳转。

**迁移**（`pnpm test:migration`，用真实旧库副本 fixture）

18. 9 条校验逐条断言（逐字节比对 content/versions，非"预期常量"）；
19. 幂等：连点两次升级，第二次 `200 无操作`，行数不变；
20. 失败回滚：`MIGRATION_FORCE_FAIL=1` → 作品仍可打开、行数不变、备份存在；
21. 成功后回退两种分支（无新内容 / 有新内容→警告+确认词+另存）；
22. 零模型调用：迁移期间 fake provider 收到 0 请求。

**断网/崩溃**（脚本级）

23. `kill -9` server 于 P4 第 2 章生成中 → 重启 → job `interrupted`、第 1 章 `in_review` 保留、恢复从第 3 章继续（第 3 章仍是 `pending`）；
24. 前端断网（Playwright `route.abort` 拦截 `GET /pipeline`）→ 轮询失败 3 次后控制条降级为「与后台失去联系 · 最后更新 N 秒前」+「重试连接」，恢复后一次拉取补齐进度（不重放动画、不给自己编阶段）。

### 7.3 不做的测试（明确划界）

- 不做模型输出质量的语义断言（文学好坏不可判）；
- 不做"AI 生成内容与 prompt 完全一致"的断言（不确定）；
- 视频/图片/语音场景不存在，不涉及。

---

## 8. 方案对比与推荐

### 8.1 三条路径

| | **A 现有工程增量重构（推荐）** | **B 新建 AI-first 模块并迁移** | **C 换栈大重写（记录为待用户决策）** |
|---|---|---|---|
| 形态 | 同仓、同栈（React 19/Express 5/sqlite）；新增 `pipeline` 模块 + 7 表；Studio/Outline/Codex 保留 | 新包 `packages/ai-pipeline`（前后端独立）与旧编辑器并存，逐步替换入口 | 前端换框架/后端换 Postgres + 独立 worker/消息队列 |
| 改动面 | 新增约 4.5k 行（server 2.5k + client 2k），改 6 个现有文件（`db.ts`/`index.ts`/`repository.ts`/`App.tsx`/`NewProjectModal`/`StudioPage`），删 1 个（`PlanReviewModal`） | 新增约 6k 行 + 双写/桥接层 + 两套路由与构建 | 全量重写，改动面 ≈ 100% |
| 估时 | 12–18 人日（对齐 SPEC §14.3 四阶段 M1–M10） | 20–30 人日（含并存期维护成本） | 6–10 周 |
| 风险 | 中低：`StudioPage` 1102 行剥离要有序；写路径需纪律（白名单 + 测试兜底） | 中高：两套 UI/两套导出/docx/bundle 实现，用户容易迷路；接口漂移 | 高：Electron 打包、离线 sqlite、单进程假设全部要重验；收益只在云化多端 |
| 收益 | 直击 AUDIT 六根因；旧作品零迁移可用；后续想升级 B/C 时 `pipeline` 模块可整体抽出（边界已切好） | 边界最干净，适合"AI 流水线也要给别端复用" | 只有"多进程/云同步/多用户"才需要 |
| 结论 | ✅ 采用 | 备选（若 V1.1 要做云同步/多端，再按此演进） | ❌ 本次不做；**需要用户拍板**（见 §8.3） |

### 8.2 为什么不是"推翻重来"

AUDIT 已证明现有 `plan` 调用链本身可用（同一把 Key、同一 prompt，实测 200/190ms/3108 字可解析）。缺陷在**生命周期编排**（无进度、无取消、无持久化、失败留空壳），这三件事都可以在现有栈内解决，不需要换框架。反过来，换栈会把"6 类缺陷"变成"6 类缺陷 + 全量回归风险"。

### 8.3 需要用户拍板的点（不擅自实施）

1. 是否需要**多端/云同步**（决定要不要 Postgres + 独立 worker；V1 明确不做，但架构不做死：`pipeline` 模块不依赖 Express、`store.ts` 的 SQL 保持标准 SQLite 方言子集，便于迁移）；
2. 是否接受**单进程**限制（同 `PW_DATA_DIR` 只能一个 server 进程）；
3. 是否要 **V1.1 的"AI 自动通过"托管模式**（D4 已否，此处只记录：若要，必须新增 REVIEW 策略配置，不默认开）。

---

## 9. 分阶段实施映射（供 captain 排期）

| 阶段 | 里程碑（SPEC §14.3） | 本文对应章节 | 独立演示判据（每阶段结束必须能演示） |
|---|---|---|---|
| 一 | M1 新建四态 + M9 错误边界 + M6/M7（job/取消/持久化） | §2.1–2.4、§3.2–3.9、§3.11–3.14 | 点"创建并让 AI 企划"→ 500ms 内进流水线页有进度 → 15s 有提示 → 可取消 → 失败有错误卡可重试 → 刷新能恢复 |
| 二 | M2/M3/M4（P1–P3 可编辑、反馈、确认、字数范围） | §2.5、§4.1–4.4、§6 | P1 编辑/反馈/确认 → P2 解锁确认 → P3 生成计划、改字数、看 Σtarget 偏差、确认 |
| 三 | M5（P4 逐章连续生成、暂停/停止/重写、REVIEW） | §2.4、§3.2（P4 循环）、§5、§4.3 | 连续写完 5 章 → 中途暂停/停止各验一次 → 逐章通过/退回/重写 → 版本回滚 |
| 四 | M8 迁移与回退 + M10 全量 E2E 收口 | `MIGRATION.md` + §7 | 真实旧库副本升级 → 9 条校验 → 回退两种分支 → S1–S12 全绿 |

---

## 10. 数字常量（单一真相表）

> 权威值来自 SPEC §10.1；实现必须集中定义在 `shared/pipeline-constants.ts`（前后端共用），**禁止散落魔法数字**。

| 常量 | 值 | 用在哪 |
|---|---|---|
| `STEP_TIMEOUT_MS` | 120000 | 单步模型调用（prompt、read timeout） |
| `PROGRESS_TICK_MS` | 2000 | 前端秒数刷新（本地插值，≤2s 更新 DOM）；轮询间隔另见 `POLL_*` 三项 |
| `POLL_RUNNING_MS` | 2000 | `job.state ∈ {running, pausing}` 的轮询间隔 |
| `POLL_PAUSED_MS` | 10000 | `paused` 态停留轮询 |
| `POLL_IDLE_MS` | 5000 | 无 job、阶段 `review` 的轮询 |
| `POLL_MAX_FAILURES` | 3 | 连续失败即降级，不许无限重试 |
| `CREATE_NAV_DEADLINE_MS` | 500 | 创建→跳转上限（R-1 红线） |
| `BUTTON_DISABLE_MS` | 300 | 点击→按钮 disabled |
| `IDLE_REDLINE_MS` | 15000 | 连续 15s 无变化 = 无响应（R-3） |
| `UPSTREAM_RELEASE_MS` | 5000 | 取消后上游释放上限 |
| `MAX_RUNNING_PER_PROJECT` | 1 | INV-7 |
| `MAX_RUNNING_GLOBAL` | 3 | 队列上限 |
| `VERSIONS_KEEP` | 40 | `chapter_versions` 现有策略（`repository.ts:966` 之后裁剪） |
| `REVISIONS_KEEP` | 50 | 每阶段非确认修订保留数（确认快照永不清） |
| `JOBS_LIST_LIMIT` | 20 | job 历史 |
| `P3_BATCH_SIZE` | 20 | P3 每批章/节拍数 |
| `CONTEXT_BUDGET_CHARS` | 12000 | 上下文装配预算 |
| `WORD_TOLERANCE` | 0.10 / 1.10 | 偏短/偏长阈值（`min*0.9`、`max*1.1`） |
| `TOTAL_TARGET_DEVIATION` | 0.25 | Σtarget 偏差阈值（需显式接受） |
| `STALE_IGNORE_DAYS` | 7 | "忽略"下游 stale 的保留期 |
| 目标字数/范围/预设 | 见 §2.8 `KIND_PROFILE` 与 SPEC §10.1 | 三档预设、默认值 |

---

## 11. 与 SPEC 的偏差与已知取舍（必须让评审看见）

| 编号 | 偏差 | 依据 | 影响与处理 |
|---|---|---|---|
| R-1 | P4 改为"连续生成 + 全部写完再逐章审" | CAPTAIN-DECISIONS **D4**（用户拍板） | 覆盖 SPEC §4.5 "逐章停在 in_review 等 REVIEW"的字面描述；暂停/停止/逐章审阅/失败恢复仍按 SPEC 其余条款。**SPEC 该句需同步修订**，建议由 pm 在 SPEC 里加一行"以 D4 为准" |
| R-2 | 章节 `data-status` **不新增 `queued`** 取值 | SPEC §11 枚举是 QA 契约 | D4 要求的"排队中"用 `pending` + 前端 `data-queued` 可选属性表达，避免改枚举打崩 QA |
| R-3 | `pause` 不作为 job 第 7 个状态 | SPEC §3.2 只给 6 个 job 状态 | 用 `pause_requested` + `stop_mode='pause'` + 派生 `paused` 表达；恢复/取消逻辑复用 cancelled 通路 |
| R-4 | 迁移回退时，新写章节**归档而非删除** | SPEC §9.4 说"丢失 N 章正文" | 文案照 SPEC（"将不再出现在旧流程，共 N 章"），但数据 `archived_at` 保留、备份文件可找回，比物理删除更可逆。若 QA 要求字面"丢失"，以本条为偏差记录 |
| R-5 | 新增 3 个扩展错误码 `CONFIRM_BLOCKED` / `TYPE_NOT_SUPPORTED` / `IDEMPOTENT_REPLAY` | SPEC §7.1 列了 18 个"必须给 code"的场景 | 扩展码只用于新增场景，不替代任何既有 code；QA 断言既有 18 个时不受影响 |
| R-6 | 长篇 P3 计划直接存 `chapters`，不建并行 `chapter_plan` 表 | SPEC §3.1 的 StageItem 语义 | 避免"计划表 vs 章节表"双真相；`revisions.target_id` 直接指向章节 id；短篇仍用 `stage_items(kind=beat_plan)`（因为短篇禁止 chapters 行） |
| R-7 | `characters/outline_acts/outline_beats` 不迁入 `stage_items` | 同上 | 用 `ItemStore` 适配层统一 API；避免重写 Codex/Outline/export/docx/bundle 五条链路 |
| R-8 | 不新增运行时依赖 | 项目现有"零依赖优先"惯例（Electron 体积/离线） | 校验器手写、状态管理用现有 `useState`+hook；若后续要 zod/react-query，属 V1.1 讨论 |
| R-9 | 进度通道 V1 = **轮询**，SSE 推迟到 V1.1 | UX-SPEC §12.4；AUDIT 现场缺的是通道而非带宽 | `job_events` 照写，SSE 契约在 §3.11 末尾锁定；QA 断言基于快照，不依赖推流 |
| R-10 | `nextStep` 由服务端唯一下发，前端不重算 | CAPTAIN-DECISIONS **D6** | 快照给 `kind/label/stage/count/blockers`；前端 `derive.ts` 只算 viewState；单测覆盖 15 分支 |
| R-11 | 审阅四键只在写作台渲染 | CAPTAIN-DECISIONS **D5** | 流水线章节行只给「审阅」导航；`POST /api/chapters/:id/review` 是唯一写入口；锚点全站同页唯一 |
| R-12 | P3「按目标字数分配」拆两步（预览 + 应用），默认跳过手改行 | CAPTAIN-DECISIONS **D7/D9** | `allocate` 纯计算不落库；`apply` 需显式 `includeEdited`；`chapters.target_manual=1` 标记手改 |
| R-13 | `nextStep` 比 UX-SPEC §3.3 多 5 个前置行与 `fix-chapters` 行 | UX §3.3 只列正常路径，未覆盖 legacy/job/暂停/失败/退回 | 服务端优先级：异常态在前、正常路径在后；顺序在 §3.12 表固化，单测锁定 |

---

## 12. 文件级改动清单（实施方照此拆单，本轮不改）

**新增（server，约 2.5k 行）**：`provider/call.ts`、`pipeline/{types,schema,context,store,runner,events,snapshot,precheck,legacy}.ts`、`pipeline/prompts/{p1,p2,p3,p4}.ts`、`pipeline/steps/*.ts`、`shared/pipeline-constants.ts`。  
**新增（client，约 2k 行）**：`pages/PipelinePage.tsx`、`pages/pipeline/{usePipeline,derive,kindProfile}.ts(x)`、`pages/pipeline/{PipelineHeader,StageNav}.tsx`、`pages/pipeline/{p1/SettingStage,p2/OutlineStage,p3/ChapterPlanStage,p4/WritingStage}.tsx`、`pages/pipeline/shared/{ItemCard,FeedbackBox,ConfirmBar,RevisionDrawer,ErrorCard,LegacyBanner,UnitReviewPanel}.tsx`。  
**修改**：`server/db.ts`（加表/补列，幂等）、`server/index.ts`（路由瘦身 + 新路由 + 启动扫描）、`server/repository.ts`（`createProject` 去预写；新增 pipeline 所需读函数）、`server/plan.ts`（降级为剧本路径 + 复用 `provider/call`）、`client/App.tsx`（路由 + 守卫）、`client/api.ts`（新方法）、`client/components/NewProjectModal.tsx`（重写）、`client/pages/StudioPage.tsx`（剥离企划）、`client/pages/LibraryPage.tsx`（状态徽标）、`client/context/AppContext.tsx`（`reloadProjects`）、`client/styles/app.css`（流水线样式）。  
**删除**：`client/components/PlanReviewModal.tsx`（其交互范式迁入 P1/P2 条目卡）。  
**测试新增**：`scripts/pipeline-api-test.mjs`、`scripts/migration-test.mjs`、`scripts/ui-pipeline-test.mjs`（含慢/失败/取消场景，满足 SPEC §13 第 5 条）。

---

## 13. 本轮事实复核方式（可重复执行）

```bash
cd software
# 路由与端点
grep -n "app\.\(get\|post\|put\|delete\|patch\)" src/server/index.ts | head -50
sed -n '100,115p' src/server/index.ts          # plan 路由：无日志、无 abort、单次调用
sed -n '439,462p' src/server/index.ts          # SSE 头与 onClose→abort
# 现有生命周期缺陷
sed -n '253,275p' src/server/repository.ts     # createProject 预写 3 空幕 + 1 空章
sed -n '905,965p' src/server/repository.ts     # applyProjectPlan 全量 DELETE 重建
sed -n '966,1000p' src/server/repository.ts    # 版本保留 40 条 / restore 先存回退前
# 企划链路
grep -n "AbortSignal.timeout\|stream:|message.content" src/server/plan.ts
grep -n "planProject\|created\|AI 正在企划" src/client/components/NewProjectModal.tsx
grep -n "runPlan\|cancelPlan\|applyPlan\|planPreview\|PlanReviewModal" src/client/pages/StudioPage.tsx
# schema 现状（哪些表/列已存在，避免重复建）
grep -n "CREATE TABLE\|ALTER TABLE" src/server/db.ts
```

