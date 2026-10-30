# AI 主导创作流程重构 · 交付总结

> 面向：主人、后续接手的人、以及"要不要发布"这个决定。
> 一句话：把「新建并让 AI 企划」从**一次请求 + 界面静止 40 秒**改成**后台任务 + 五阶段工作台**，短篇同一套阶段，旧作品可升级可回退。
> 状态：代码在**工作树里、未 commit、未 push**（本轮任务明确禁止提交）。

---

## 1. 这次修的是什么

用户现场（v0.1.12 安装版）的现象是"点了没反应"。AUDIT 还原出来的真相不是没发请求，而是三层问题叠加：

| 层 | 事实 | 后果 |
| --- | --- | --- |
| 交互 | `NewProjectModal.tsx:191` 用 `!created` 同时隐藏主按钮，导致 `:193` 的「AI 正在企划…」**永远不可达**（实测 `busyText=false`） | 界面全灰、没有任何文字说明，看起来像死掉 |
| 链路 | 只有一次 `await api.planProject()`，非流式、无阶段、无计时；后端 `plan.ts` 单次 `AbortSignal.timeout(90000)`，失败只回 502 且不写日志 | 慢就是静默，失败就是无声 |
| 数据 | `repository.ts:253` 先落 3 个空幕 + 1 个空章再请求 AI；失败后这些空行留着 | 留下孤儿空壳项目（`p_mvru40vy_yx8p3x`「修仙日常」：3 空幕 / 0 人物 / 0 正文 / 0 消息） |

对照实验排除了"Key 坏了"：用同一把 DeepSeek Key 原样重放 plan 请求，200 / 190ms / 5609 completion tokens / 3108 字可解析 JSON——参数、Key、模型、prompt、解析器都没坏，坏的是**耗时级失败 + 零反馈 + 无痕**这一组合。

所以这轮不是打补丁，而是把"AI 辅助编辑器"改成"AI 主导流水线"，让每一步都可预期、可干预、可回退。

---

## 2. 交付了什么（用户可见）

五阶段，每阶段都要用户点头才往下走：

| 阶段 | AI 产出 | 用户能力 | 门槛 |
| --- | --- | --- | --- |
| P1 设定 | 世界观 / 环境 / 人物 | 逐条编辑、提意见重做、锁定、看修订历史、删除、排序 | 人物 ≥ 1、环境 ≥ 1、世界观有时代地点与规则（或勾选「本书不需要明确规则」）；**唯一可跳过**的阶段 |
| P2 故事大纲 | 幕 + 幕下节拍 | 同 P1，另加「上游有变更」三选项（保留 / 重生成 / 忽略） | 幕 ≥ 3（不足需显式确认） |
| P3 章节计划 | 章数 + 每章功能 / 大纲 / 出场人物 / 字数区间 | 改章数、改区间、套字数档、按目标字数分配（先预览再应用）、显式接受偏差 | 每章字段齐全；长篇 3–200 章、短篇 3–40 节拍；单章 300–20000 字 |
| P4 逐章写作 | 一篇接一篇写正文 | 开始 / 暂停 / 停止 / 继续、单章重写、逐章审阅（通过 / 退回 / 人工通过 / 跳过） | 章节计划已确认才能开写 |

短篇：P3 是「节拍计划」、P4 是「逐节拍写作」，其余完全相同，界面词表统一走 `unitLabel()`，短篇不产生章节行。

新建路径的四种可观察结果（这是本次缺陷的正面验收口径）：

| 情形 | 用户看到 | 数据后果 |
| --- | --- | --- |
| 配置缺失 | 弹窗内先预检：「还不能让 AI 企划：…」+「去设置里选模型」/「仍然创建（只能自己写）」 | **不创建作品**，不留空壳 |
| 加载中 | 弹窗关闭、跳到 `/project/:id/pipeline`，顶部任务条显示阶段与已用时（每秒递增），`data-state="running"` | 作品已保存，任务在后台跑 |
| 成功 | 阶段从 `generating` → `review`，条目出现在列表里，右侧「下一步」按钮亮起 | 产物落库，可逐条编辑 |
| 失败 | 阶段 `failed` + 人话说明（如「模型服务超时」）+ 「重试这一步」；作品仍在，不留空壳 | `lastError.code` 落库，重试从断点继续 |
| 取消 | 状态 `cancelled`，提示「这一步被取消了，可以重新开始」；≤5s 内上游请求真正被 abort | 不写半截数据 |

---

## 3. 改动范围

后端（新增，未改动旧端点语义）：

- `software/src/server/pipeline/` 13 个文件：`types` / `schema` / `store` / `validate` / `prompts` / `context` / `steps` / `runner` / `snapshot` / `actions` / `create` / `routes` / `legacy`
- `software/src/server/provider/call.ts`：统一模型调用（重试、120s 步超时、错误分类、推理能力校验、`EMPTY_OUTPUT` 与 `INVALID_JSON` 区分）
- `software/src/shared/pipeline.ts`：阶段 / 状态 / 错误码 / 字数与章数上下限的唯一契约
- 改动：`db.ts`（`ensurePipelineSchema`，迁移包在事务里）、`index.ts`（挂载流水线路由、启动时 `recoverInterruptedJobs()`、导出按 kind 取正文）

新增 7 张表：`stages` / `stage_items` / `revisions` / `generation_jobs` / `job_events` / `review_records` / `migrations`，旧表只做幂等补列。

前端：

- 新增 `pages/PipelinePage.tsx`、`components/pipeline/*`、`hooks/usePipeline.ts`、`lib/pipeline/{api,http,format,guards}.ts`、`styles/pipeline.css`
- 改动 `App.tsx`（`/project/:id/pipeline`）、`main.tsx`、`AppShell` / `Rail`（新增「企划」入口）、`NewProjectModal`（预检 + 立即跳转）、`StudioPage`（流水线作品自动跳工作台，保留「回企划工作台」入口）
- 前端只按错误 `code` 渲染文案（`lib/pipeline/format.ts`），不解析后端 message——后端改话术不会把前端搞挂

测试与脚本：

- `scripts/api-test.mjs` +1012 行、`scripts/ui-test.mjs` +768 行
- 新增 `scripts/qa-e2e-api.mjs`、`qa-e2e-ui.mjs`、`qa-e2e-r4.mjs`、`provider-smoke.mjs`
- 迁移用例不依赖夹具文件：在临时数据目录里用旧接口现造旧作品（`POST /api/projects` + `PATCH /api/chapters`），跑完即弃

文档：

- 新建 [docs/AI-FIRST-WORKFLOW.md](../../docs/AI-FIRST-WORKFLOW.md)（用户向：怎么走完五个阶段、怎么提意见、暂停与恢复、旧作品迁移、错误码对照、FAQ）
- 更新根 `README.md`（当前进度、新增「AI 主导创作流程（v1）」整节、技术栈、测试、已知边界）
- 更新 `software/README.md`（已实现、目录树、API 摘要、测试、已知边界）
- 本目录另有 `SPEC.md`（验收口径）、`UX-SPEC.md`、`ARCHITECTURE.md`、`MIGRATION.md`、`DECISIONS.md`、`INTEGRATION.md`、`TEST.md` 与五份评审记录

---

## 4. 验证结果

macOS 27.0.1 arm64 / node v26.11.1 / pnpm 10.34.7；下表六条为写文档当天（2026-10-29 17:2x–17:5x）在本机逐条实跑（不是转抄历史记录）：

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir software typecheck` | exit 0（`tsc --noEmit` 无输出） |
| `pnpm --dir software build` | exit 0（`✓ built in 192ms`；仅有 chunk >500 kB 的提示，无错误） |
| `pnpm --dir software test` | exit 0，**48 组 PASS**（`All API tests passed.`） |
| `pnpm --dir software test:ui` | exit 0，**47 组 PASS**（`All UI tests passed.`） |
| `node software/scripts/qa-e2e-api.mjs` | **30/30**，0 缺陷，exit 0（临时 `PW_DATA_DIR`、端口 8831） |
| `node software/scripts/qa-e2e-ui.mjs` | **14/14**，0 缺陷，exit 0（端口 8832） |

覆盖的关键路径：配置门禁（无默认模型 / 无 Key → 拒绝且零副作用）、P1 条目增删改与按意见重生成、P2 幕与节拍、P3 章数与字数两步分配、P4 连续写作 + 暂停 / 停止 / 继续 + 逐章审阅、短篇节拍路径（章节行 = 0）、旧作品迁移（可重入 / 覆盖确认 / 失败回滚 / 回退）、刷新与 SIGKILL 后从断点续写、创建幂等。

两个 QA 脚本会把结果写成 JSON + 服务端日志存到 `team/inkquay-ai-first/evidence/`（`qa-api-results.json` / `qa-api-server.log` / `qa-ui-results.json`），可复核。它们日志里出现的 4xx 属于负向用例的**预期**响应（例如未确认计划时申请开写、越界分配），不是缺陷。

跑测试前先 `pkill -f "src/server/index.ts"`——残留服务会占端口，导致"对着旧进程假通过"。

---

## 5. 残余风险（如实记录，不美化）

1. **真实供应商未全量验证**：主链路用本地假 OpenAI 兼容供应商 + 显式 mock；AUDIT 阶段只用真实 DeepSeek Key 重放过一次企划请求（200 / 190ms / 3108 字可解析）。15 家逐家验证没做，`provider-smoke.mjs` 留给有 Key 时手动跑。
2. **只在 macOS arm64 验证**：Windows / Linux 桌面端没跑过这轮改动。
3. **单进程假设**：任务控制表在进程内存 + DB 状态，没有分布式锁；同一份 `studio.db` 只能被一个进程使用。
4. **P3 整阶段重生成 + 用户确认覆盖后，按目标字数的分配记录会清零**（已有正文或已锁定的单元会跳过，可从修订历史找回）。
5. **跨幕移动节拍 V1 不支持**：只能同幕重排，界面给降级提示。
6. **`partialAt` 只覆盖取消 / 失败 / 崩溃恢复**；真正的"卡死"靠 `STEP_TIMEOUT_MS=120s` 兜底。
7. **迁移账本行仍在项目包里**（`revisions.note='迁移前章节清单'`，只是不在修订历史显示）。
8. **迁移没有真实正样本**：安装版库里唯一的旧长篇本身就是空壳孤儿，验收是在临时目录里用旧接口现造旧作品。
9. **`software/screenshots/*.png` 里有 3 张 `qa-fail-*` 历史失败截图**（缺陷已修，保留为追溯证据）。
10. 一处已知瑕疵未修：写作页章节行内的「立即写本章」按钮没跟「章节计划未确认」一起禁用（整条写作控制条是对的；服务端会 409 拒绝，但按钮该更早置灰）。

---

## 6. 下一步建议

- 用真实 Key 跑一遍 `pnpm test:providers` 与一次真机五阶段走查（尤其推理模型的 `reasoning_content` 分离场景）。
- 决定是否发布：本轮改动动了 schema（新增 7 表），旧数据靠 `ensurePipelineSchema` 幂等补列，**发布前应在安装版数据副本上跑一次"启动 → 旧作品可打开 → 迁移预检"**。
- 发布前补：Windows / Linux 桌面 E2E（走 `Platform smoke`），以及把 `qa-fail-*` 截图清出发布包。
- 若要继续收敛产品：跨幕移动、写作页详情请求超时、`chapter-write-one` 置灰这三件是明确的欠账。

---

## 7. 复现与回归

```bash
pnpm --dir software typecheck
pnpm --dir software build
pnpm --dir software test
pnpm --dir software test:ui
node software/scripts/qa-e2e-api.mjs
node software/scripts/qa-e2e-ui.mjs
# 有 Key 时（逐家真实连通 + 极短生成）
node software/scripts/provider-smoke.mjs
```

缺陷现场复现（AUDIT 阶段的工具，保留在本目录）：`fake-provider.mjs`（含 `DELAY_MS` / `HANG`）、`repro-plan-slow.mjs`、`repro-plan-matrix.mjs`。
