# AUDIT — 「新建并让 AI 企划」无响应：复现、根因与现有链路盘点

- 审计对象：Inkquay（私家写手）基线 v0.1.12 / main `ae75612`
- 审计方式：只读。未修改 `software/` 下任何业务代码，未 commit / push。
- 工作树：`/Users/maliang/Documents/develop/maliang/私家写手`
- 证据目录：`team/inkquay-ai-first/evidence/`（截图，见 §1.2 / §1.3）
- 可复用复现脚本：`team/inkquay-ai-first/fake-provider.mjs`、`repro-plan-slow.mjs`、`repro-plan-matrix.mjs`

**一句话结论**：点击「创建并让 AI 企划」并不是没有发出请求——请求确实发出去了，但**等待期界面上不存在任何"正在企划"的可见状态**（主按钮被隐藏、无 spinner、无进度、无耗时、输入框全灰），
企划一慢（实测 40 s 级）用户看到的就是"点了没反应"；企划一失败（实测 90 s 超时 / 502），作品**已经落库成空壳**（3 个空幕 + 1 个空章、0 人物、0 场景、0 字），
而失败信息只存在客户端内存里，整页重载后**无任何痕迹**（服务端 `/plan` 只回 502，不写日志）。真正的产品级根因是这件事被串成了一条"同步阻塞、零反馈、失败留垃圾"的链路。

---

## 1. 复现

### 1.1 现场取证（最强证据：主人自己机器上的真实一次）

安装版 `/Applications/Inkquay.app`（`CFBundleShortVersionString = 0.1.12`）的用户数据目录
`/Users/maliang/Library/Application Support/Inkquay/`：`logs/server.log` + `data/studio.db`（WAL，只读取证）。

`logs/server.log` 原文摘录（时间已按 UTC 记录）：

```
[2026-10-28T07:38:45.135Z] [api] POST /api/providers/deepseek/models     ← 填 Key 后拉真实模型
[2026-10-28T07:39:22.972Z] [api] POST /api/onboarding                    ← 完成引导，默认模型=deepseek-flash
[2026-10-28T08:10:25.534Z] [api] POST /api/projects                      ← 新建作品
[2026-10-28T08:10:25.541Z] [api] GET  /api/bootstrap
[2026-10-28T08:10:25.545Z] [api] POST /api/projects/p_mvru40vy_yx8p3x/plan   ← 第 1 次 AI 企划
[2026-10-28T08:11:04.109Z] [api] POST /api/projects/p_mvru40vy_yx8p3x/plan   ← 39 s 后第 2 次（用户点了「重试 AI 企划」）
[2026-10-28T08:11:35.541Z] [api] GET  /api/bootstrap                       ← 31 s 后整页重载（放弃）
[2026-10-28T08:11:37.461Z] [api] GET  /api/projects/p_mvru40vy_yx8p3x     ← 手动点进写作台
```

同一时刻数据库（`sqlite3` 只读，`file:...studio.db?mode=ro`）里这个项目的状态：

```sql
-- projects: 1 行
p_mvru40vy_yx8p3x | 修仙日常 | novel | 草稿 | total_words=0 | created_at=2026-10-28T08:10:25.534Z
-- 各表行数：chapters 1 / characters 0 / outline_acts 3 / outline_beats 0 / chapter_versions 0 / ai_messages 0
-- chapters: ch_mvru40w0_677s0w | 第一卷 | 第一章 | 未命名章节 | words=0 | length(content)=0
-- outline_acts: 第一幕/第二幕/第三幕，summary 全为 ''
-- settings.defaultModel = {"providerId":"deepseek","modelId":"deepseek-flash"}，reasoningLevel = "default"
```

判定：
- **孤儿项目成立**：作品落库了，AI 企划从未落库（0 人物、0 场景、0 版本、0 对话），正文 0 字。用户拿到的是空壳。
- 两次 `/plan` 各约 **39 s / 31 s**、都无结果；用户先点重试、再整页重载放弃。
- `server.log` 里**没有任何一条 plan 失败的痕迹**——`/api/projects/:id/plan` 的 catch 只 `res.status(502)`，不打日志（`software/src/server/index.ts:102-111`），所以事后连错误原文都无从查证。

### 1.2 受控复现（本地 dev：`tsx src/server/index.ts` + `vite`，临时 `PW_DATA_DIR`）

同一个动作：`新建作品 → 勾选「创建后让 AI 先做企划」→ 点「创建并让 AI 企划」`，只换 provider 的响应速度/可用性。

| 场景 | 供应商 | 点击后 0–N 秒界面 | 结果 |
|---|---|---|---|
| mock（离线演示模型，瞬间返回） | `mock/mock-writer` | 1.3 s：`POST /plan` → 200 → 跳 `/project/p_xxx` 并弹出「AI 企划 · 逐项确认」 | ✅ 全流程正常 |
| 慢供应商 40 s | 本地假 OpenAI 兼容服务 `DELAY_MS=40000` | **0.5 s–45 s 界面完全静止**：主按钮消失、没有任何文字提示、输入框全灰，只剩一个「取消企划」 | 45.1 s 后弹出企划预览 |
| 供应商挂死 | 假服务 `HANG=1`（不回应） | 同上静止，**持续 90 s** | 95.2 s 才出现：`AI 企划失败：The operation was aborted due to timeout` |
| 未配置默认模型 | `defaultModel=null` | 1.3 s → 502 | `AI 企划失败：还没有选择默认模型，请到设置中配置` + 留下空壳项目 |
| 供应商没 Key | `openai` 无 Key | 1.3 s → 502 | `AI 企划失败：供应商未配置 API Key` + 留下空壳项目 |
| Key 无效 | `deepseek` + 假 Key | 1.5 s → 502 | `AI 企划失败：模型请求失败：HTTP 401 ...` + 留下空壳项目 |

慢供应商/挂死场景的界面取证（点击后 9 s、企划仍在进行中）：

![等待期界面](evidence/plan-wait-9s-frozen-modal.png)

DOM 文本实测（`MODAL_TEXT_AT_9s`）里**没有**"AI 正在企划"这几个字：

```
新建作品 从一个念头开始 选择体裁 … 作品名 一句话灵感 可以稍后再补
《审计-等待期无反馈》已经在书房里；关闭本窗口不会删除它。 取消企划
```

时间线快照（慢供应商 40 s，每 0.5 s 抓一次，只在变化时打印；`busyText` 取自 `document.body.innerText` 是否含"正在企划"）：

```
[0.6s] {"path":"/","modalOpen":true,"primary":null,"ghosts":["取消企划"],"inputsDisabled":true,"notice":null,"planReview":false,"spinner":null,"busyText":false}
[2.1s] …同上…
[5.1s] …同上…
[10.2s] …同上…
[20.0s] …同上…
[30.1s] …同上…
[45.0s] {"path":"/","modalOpen":true,"primary":null,"ghosts":["取消企划"],"inputsDisabled":true,…,"busyText":false}
[45.1s] plan 返回 200 → 跳转 /project/… 并出现 plan-review
```

挂死场景（90 s 硬超时）的失败态：

![90s 超时](evidence/plan-timeout-95s-error.png)

```
[95.2s] {"ghosts":["先进写作台","重试 AI 企划"],"notice":"作品已创建，企划没有完成 AI 企划失败：The operation was aborted due to timeout。作品已经创建，可以重试，或先进入写作台。"}
console: Failed to load resource: the server responded with a status of 502 (Bad Gateway)
```

失败/取消后的空壳项目（同一 modal，`作品已创建，企划没有完成`）：

![空壳项目](evidence/plan-failed-orphan-project.png)

Escape / 点遮罩 = 取消企划（**只 abort 客户端，服务端请求仍在跑**），8 s 时按下：

```
[10.2s] {"ghosts":["先进写作台","重试 AI 企划"],"notice":"作品已创建，企划没有完成 已取消 AI 企划。作品已经创建，可以进入写作台后点「AI 企划这一本」重试。"}
```

### 1.3 对照实验：同一台机器、同一个 Key、同一份 prompt，链路本身是通的

用主人库里那把 DeepSeek Key（`data/.secret` + `providers.api_key_enc`，按 `software/src/server/crypto.ts:29-40` 的 AES-256-GCM 解密，只读使用），把 `software/src/server/plan.ts:153-184` 的 system/prompt **原样**重放一次（项目「修仙日常」）：

```
PROBE   model=deepseek-flash max_tokens=1 → 200
        {"…","message":{"content":"","reasoning_content":"The"},"finish_reason":"length",
         "usage":{"completion_tokens":1,"completion_tokens_details":{"reasoning_tokens":1}}}
PLAN    → 200，耗时 190 ms，finish_reason=stop
        completion_tokens 5609（其中 reasoning_tokens 3725），content 3108 字符，可直接 JSON.parse
```

结论：**参数、Key、模型、prompt、解析器都没有坏**。主人 08:10 那次是"耗时级失败 + 等待期零反馈 + 失败无痕"三者叠加，不是代码路径不通。
（顺带证明一件事：`deepseek-flash` 是**推理模型**，思考内容走 `reasoning_content`、正文走 `content`，见 §2-R5。）

---

## 2. 根因（按可修性排序，均给文件行号）

### R1（直接根因，前端）企划进行中，主按钮与"AI 正在企划…"文案被同一个条件一起隐藏

`software/src/client/components/NewProjectModal.tsx:176-197`：

```tsx
{planning ? (                                  // 181
  <button className="btn btn--ghost" onClick={cancelPlanning}>取消企划</button>   // 182
) : created ? ( "先进写作台" / "重试 AI 企划" ) : ( "取消" )}                        // 183-190
{!created ? (                                  // 191  ← 关键
  <button className="btn btn--primary" onClick={create} disabled={busy}>           // 192
    {busy ? (planning ? 'AI 正在企划…' : '创建中…') : …}                            // 193  ← 永远走不到 planning
  </button> : null}                            // 195
```

`created` 在 `create()` 里 `setCreated(next)`（:113）之后立刻为真，而 `generatePlan()`（:73-94）紧接着把 `planning=true`。
于是第 193 行的 `AI 正在企划…` 分支**不可达**：`!created` 为假 → 整颗主按钮 `null`。
实测证据就是 §1.2 的 `primary: null` 且 `busyText: false`——**界面上没有任何一个字能证明"AI 在干活"**。
同样的 `!created` 还让 `:166` 的勾选框消失，`inputsDisabled: true`（:149/:159/:163 用 `Boolean(created)` 禁用），整块表单变灰但不给原因。

> 对照：写作台内的「AI 企划这一本」按钮是**有**反馈的——`software/src/client/pages/StudioPage.tsx:888` 在 `planningProject` 时把文案切成「取消企划」，按钮本身留着。同一个能力，两处两套观感。

### R2（前端）没有进度通道：无 spinner、无阶段、无耗时、无 SSE

`NewProjectModal.tsx:73-94` 只是一次 `await api.planProject(...)`；整个组件里没有任何 spinner/timer/阶段轮播（`grep -n "spinner\|setInterval\|progress" NewProjectModal.tsx` 无命中）。
后端 `/plan` 是非流式一次性返回（`software/src/server/plan.ts:87-105`，`stream:false`），而 `/api/ai/stream` 那条 SSE 通道（`software/src/server/ai.ts:79-136`、`software/src/server/index.ts:439`）**没有被企划复用**。
→ 40 s 级的真实任务，产品上呈现为"死屏"。

### R3（后端）单次 90 s 硬超时、无重试、无降级、失败不写日志

- `software/src/server/plan.ts:100`（`callOpenAI`）、`:115`（`callAnthropic`）、`:131`（`callGoogle`）：`signal: AbortSignal.timeout(90000)`，一次不成即失败；`deepseek` 这类推理模型一次企划实测就要 5609 个 completion token（3725 个是思考），慢网络下 40 s+ 是常态，90 s 并不宽裕。
- `software/src/server/index.ts:102-111`：catch 里只有 `res.status(502).json({ error })`，**没有 `console.error`/写盘**。全局错误中间件 `:490-493` 只兜 500，企划的 502 走不到它。→ 生产事故不可回溯（§1.1 的日志里两次 plan 一片空白）。
- 取消只是客户端 `AbortController`（`NewProjectModal.tsx:77-78`、`:35`）：服务端 `generateProjectPlan` 不感知断开，仍在向供应商计费跑完（`fake-provider.mjs` 实测：客户端 10 s abort 后假服务仍按 40 s 完成并输出 `已回应，耗时 40006ms`）。

### R4（数据库/生命周期）作品先落库、企划后补，失败即留空壳；应用企划是全量替换

- `software/src/server/repository.ts:253-273` `createProject`：建项目的同时插入 **3 个空幕**（`summary=''`）+ 1 个空章「未命名章节」（`createChapter`），**再**才去请求 AI。→ 任何一次企划失败/取消都留下一个"看起来有骨架、里面全空"的作品（主人库里 `p_mvru40vy_yx8p3x` 就是这个形态）。
- `software/src/server/repository.ts:910-960` `applyProjectPlan`：`BEGIN` → `DELETE outline_beats / outline_acts / characters` → 重新插入，并 `UPDATE` 第一个章节的标题与正文（覆盖前先 `createChapterVersion(..., '企划前', ...)`，:945）。→ 企划是「整本重写」，不支持增量、不支持只补设定、不保留人工改过的大纲。
- 事务本身没问题（`BEGIN/COMMIT/ROLLBACK` 齐全，异常会回滚），问题在"创建"与"企划"分成两次用户可见的写入。

### R5（provider/模型）推理模型的两个哑点

1. `software/src/server/plan.ts:104`：`return data.choices?.[0]?.message?.content || '';` —— 只取 `content`。§1.3 实测 `deepseek-flash` 会把思考放 `reasoning_content`、正文放 `content`；一旦思考把预算吃满（`finish_reason=length`）或供应商只回 `reasoning_content`，`content` 为空串 → `extractJson('')`（:13-19）抛 `模型没有返回有效 JSON`，用户只看到一句莫名报错。
2. `software/src/server/plan.ts:147-152`：`reasoningLevel` 是**全局**设置，只要它 ≠ `default` 且当前模型没在 `models[].reasoning` 里声明该档位，就直接 502 `模型 X 不支持「high」推理等级`。换一次默认模型就会踩到，且这个开关在设置页里不显眼。

### R6（可观测性）失败信息只活在内存里

`planError` 只在 `NewProjectModal` 的 state（:31）里；`finish()/reload/navigate` 之后即消失，`server.log` 不记（R3），DB 里也没有"上次企划失败"字段。→ 用户说"没反应"，工程侧拿不到任何现场，正因如此这次才只能靠数据库行数和日志时间差来倒推。

---

## 3. 可能原因甄别表

| 假设 | 结论 | 证据 |
|---|---|---|
| 前端状态被吞 / 按钮失效 | **不成立**，点击链路正常 | 每次点击都产生 `POST /api/projects` + `POST /api/projects/:id/plan`（§1.2 network 日志）；无 `pageerror`，仅 502 的 `console: Failed to load resource` |
| 前端异常被 `catch` 吞掉 | **部分成立**（表现为"没反应"的直接原因之一） | 企划失败只写进 `planError`（:31/:90），无 toast、无日志、无重试入口（重试按钮在 failed 前不存在）；成功/失败/取消三种状态共用一个灰掉的面板 |
| 导航/路由问题 | **不成立** | mock 场景 1.3 s 即 `navigate('/project/p_xxx', { state: { plan } })` 并弹出 `PlanReviewModal`（`StudioPage.tsx:159-165` 消费 `location.state`），URL/路由/预览都对 |
| 后端 plan 端点不存在/报错 | **不成立** | `software/src/server/index.ts:102-111` 正常返回 200/502；`software/src/server/plan.ts` 逻辑可跑通（§1.3 190 ms 出合法 JSON） |
| provider/模型配置错 | **部分是**，但不是本次现场的主因 | 主人库 `defaultModel=deepseek/deepseek-flash`、Key 有效（探针 200）；这是"慢 + 推理模型"的场景，落在 R3/R5 |
| 数据库/事务 | **不成立（事务正确）**，但生命周期设计是帮凶 | `applyProjectPlan` 有完整 `BEGIN/COMMIT/ROLLBACK`；空壳来自 `createProject` 先落 3 空幕 + 1 空章（R4） |
| 样式缺失导致提示看不见 | **不成立** | `.modal__notice/.ai-plan-toggle/.plan-review*` 均存在于 `software/src/client/styles/app.css`；失败 notice 在 1.3 s 场景里确实可见 |
| 构建产物/安装包过期 | **不成立** | 安装版 = 0.1.12 = main `ae75612`；受控复现直接用工作树源码 + vite dev |

---

## 4. 现有链路盘点（可复用 / 与「AI 主导分阶段流程」冲突）

### 4.1 AI 企划

| 资产 | 位置 | 复用判断 |
|---|---|---|
| `generateProjectPlan()`：三幕 + 人物 + 第一章一次产出，含 mock 分支、三种 provider 协议、推理档位 | `software/src/server/plan.ts:138-185` | **可复用**（拆成"企划/设定/大纲"三次调用即可），但需删掉"一次产全部"的耦合 |
| 契约类型 `ProjectPlan { acts, characters, chapter }`、`PlannedAct`、`PlannedCharacter` | `software/src/shared/types.ts:257-280` | **可复用**，是分阶段流程的天然中间态（缺"章节计划/逐章生成"字段） |
| 逐项确认 UI（幕/场景/人物/第一章四个 checkbox 组 + 重新生成 + 应用选中） | `software/src/client/components/PlanReviewModal.tsx:94-137`，apply `:70-92` | **可复用做 REVIEW 门槛**，但目前是"一次审一坨"，与分阶段（先审设定、再审大纲）冲突；`regenerate`（:53-68）不带 `signal`，无法取消 |
| 应用企划（全量替换 acts/characters/第一章 + 版本快照） | `software/src/server/repository.ts:910-960` | **冲突**：全量 `DELETE` 后重建，人工改过的大纲会被冲掉；分阶段必须改成"按阶段 upsert + 保留人工条目" |
| 入口：新建弹窗里的"创建后让 AI 先做企划" | `NewProjectModal.tsx:166`、`:117-120` | **冲突**：把"建项目"和"跑完整企划"绑在一次点击里（R1/R4 都源于此）。AI 主导流程应该是"建项目 → 进流水线页 → 阶段推进" |
| 入口：写作台「AI 企划这一本」 | `StudioPage.tsx:498-512`、按钮 `:888` | **可复用**（反馈形态比弹窗好），但同样是整本重写 |
| 后端端点 `POST /api/projects/:id/plan` + `/plan/apply` | `software/src/server/index.ts:102-127` | **可复用**（需加进度/流式与日志） |

### 4.2 StudioPage（写作台）

`software/src/client/pages/StudioPage.tsx`（1102 行，单文件承载全部写作交互）：

- 加载与选择章节 `:81-129`（剧本类型兜底跳转 `:100-103`；记忆上次章节 `localStorage pw.chapter.<id>` :107）
- 自动保存 `:131-157` + `closeGuard` `:234-246`（关窗守卫，保存失败不关窗，`Cmd+S` 手动保存 `:248-259`）
- 章节增删/切换 `:266-312`、回收站 `:564-658`
- 版本：`refreshVersions :173-183`、恢复 `:451-470`（覆盖前自动留档）、对比弹窗 `:1069`
- AI 共笔：`sendPrompt :313-389` → `streamChat`（SSE，`software/src/server/ai.ts:248+`）
- 导出/备份/切模型 `:660-694`
- 企划入口 `runPlan :498-512`、应用 `applyPlan :520-537`、预览挂载 `:1098`

判断：**UI 骨架可复用**（编辑器、自动保存、版本、SSE 共笔、导出都在），但它是"编辑器中心"的信息架构——章节是主线，大纲/设定是侧栏。
AI 主导流程需要"阶段主线 + 编辑器作为阶段产物视图"，这与现有 `AppShell`（`:1-4` 的 Rail 主导航）+ `StudioPage` 的布局是结构性冲突，不是加个按钮能解决的。

### 4.3 章节与版本

- 表：`chapters`（`volume/number/title/content/status/sort_order/words`，`deleted_at` 软删除）、`chapter_versions`（`source` 标签：`企划前`/`AI 企划`/`手动`/`AI 插入` 等）。
- `createChapterVersion` `software/src/server/repository.ts:966-981`（含版本上限裁剪）、`listChapterVersions :982-985`、`listProjectVersions :986-993`、`restoreChapterVersion :994-1009`。
- 版本是**快照式**（整章 content），适合"逐章生成 → 人工改 → REVIEW → 保留可回退"的目标，**可直接复用**；缺的是"版本 → 通过/驳回"的评审状态位（现在没有 `review_status` 概念）。

### 4.4 schema（SQLite，`node:sqlite`，WAL）

`software/src/server/db.ts:7-13`（`PW_DATA_DIR` → `studio.db`，`:12-13` 是 `PRAGMA journal_mode=WAL; foreign_keys=ON`）。实测 13 张表：
`projects / chapters / characters / outline_acts / outline_beats / scenes / chapter_versions / shots / foreshadows / providers / settings / ai_messages / app_meta`。

- `settings` 是单行 JSON 大字段（`key='app'`，`repository.ts:282-343`）；`defaultModel / fallbackModel / reasoningLevel` 都在里面 → 分阶段流程要加"阶段状态机"的话，建议新表而不是继续塞 JSON。
- `outline_acts.summary` / `outline_beats` 结构与「企划 → 大纲 → 章节计划」高度吻合，**可复用**；`characters` 表已有 `relations/secret/quote`，可直接当"设定"层。
- 缺：阶段/任务表（如 `pipeline_stages`、`generation_jobs`），没有"进行中/待审核/已通过"，也没有后台任务与重试记录。

### 4.5 路由

- 前端（`software/src/client/App.tsx:63-71`）：`/`（书房）、`/project/:projectId`（写作台，`:17-23` 对 screenplay 强跳 `/screenplay`）、`/project/:projectId/outline`、`/codex`、`/screenplay`、`/settings`，未匹配落 `/`。**没有流水线/阶段页**。
- 后端 49 个端点（`software/src/server/index.ts`，`grep -c "^app\.\(get\|post\|put\|patch\|delete\)"` = 49）：项目 CRUD `:85-145`、企划 `:102-127`、章节/版本/回收站 `:145-199`、人物/大纲/场景/分镜/伏笔 `:201-304`、settings/providers `:310-384`、导出/导入 `:386-437`、AI 流式 `:439-488`。
- 一个已知易错点：`StudioRoute` 用 `projects`（bootstrap 列表）判断剧本类型，列表里没有的类型会在写作台闪一下再跳（`App.tsx:19-22` vs `StudioPage.tsx:100-103` 双保险）。

### 4.6 测试现状

| 入口 | 命令 | 覆盖 | 与本次缺陷的关系 |
|---|---|---|---|
| API 契约 | `pnpm test`（`software/scripts/api-test.mjs`，20 组 PASS） | 干净安装、强制 onboarding、建项目、**AI 企划预览 + 应用**、章节保存/版本、大纲/人物/伏笔、剧本、导出 md/docx、bundle 导入、回收站、settings、AI 流式、abort 保留半截文本、未配置模型必须拒绝 | 只跑 **mock** 供应商（瞬时返回），**等待窗口为零**，看不见本次缺陷 |
| UI 端到端 | `pnpm test:ui`（`software/scripts/ui-test.mjs`，23 组 PASS） | 含「create project + per-item AI plan review」 | 同上：`defaultModel` 先被改成 `mock/mock-writer` 再点，1 s 内就出预览 |
| Provider 冒烟 | `pnpm test:providers` | 真实供应商连通性 | 不覆盖 `/plan` |
| 类型 | `pnpm typecheck` | tsc --noEmit | 与运行时无关 |

→ **这正是缺陷逃逸的原因**：现有 E2E 用 mock 供应商，永远测不到"慢企划"的界面状态；而真实用户的供应商必然是秒级到几十秒。

---

## 5. 建议的最小复现测试入口 + 验证命令

### 5.1 建议落进 `software/scripts/ui-test.mjs` 的最小断言（3 条，用现有假服务模式即可）

1. **点击后 500 ms 内必须存在可见的"正在进行企划"provenance**：`document.querySelector('.modal')` 内匹配 `/企划中|正在企划|取消企划/` 且主按钮区域不是空（修 R1）。
2. **等待期必须有进度元素**（spinner 或 stage 文案或已耗时秒数），断言 `!== null`（修 R2）。
3. **失败后作品不可为空壳**：`GET /api/projects/:id` 断言 `characters.length + beats + words` 至少一项非 0，或项目带 `status='企划失败'`/`needsPlanning` 标记，且失败信息在重载后仍可见（修 R4/R6）。

配套（后端）：`/plan` 的 catch 必须打日志（`console.error('[plan] project=%s %s')`），并让 `POST /api/projects` 支持 `deferPlan` 语义。

### 5.2 可复用复现脚本（已放在 team 目录，不进 `software/`）

```bash
# 0) 起被测服务（临时数据目录，别碰真实库）
cd software
rm -rf /tmp/inkq-audit/dataA && mkdir -p /tmp/inkq-audit/dataA
PORT=8787 PW_DATA_DIR=/tmp/inkq-audit/dataA node --import tsx src/server/index.ts &
npx vite --port 5180 &

# 1) 慢供应商：40 s 后返回一份合法企划（复现"点了没反应"）
cd team/inkquay-ai-first && PORT=8899 DELAY_MS=40000 node fake-provider.mjs &
cd ../../software && OBSERVE_MS=60000 node ../team/inkquay-ai-first/repro-plan-slow.mjs

# 2) 挂死：永不回应，复现 90 s 超时
pkill -f fake-provider.mjs && cd ../team/inkquay-ai-first && PORT=8899 HANG=1 node fake-provider.mjs &
cd ../../software && OBSERVE_MS=98000 node ../team/inkquay-ai-first/repro-plan-slow.mjs

# 3) 现场/取消/异常矩阵（mock / 无默认模型 / 无 Key / 假 Key）
cd software
node ../team/inkquay-ai-first/repro-plan-matrix.mjs mock
node ../team/inkquay-ai-first/repro-plan-matrix.mjs noModel
node ../team/inkquay-ai-first/repro-plan-matrix.mjs nokey
node ../team/inkquay-ai-first/repro-plan-matrix.mjs badKey

# 4) 现场取证（主人机器上那一次的可复现读法，只读）
sqlite3 -readonly "$HOME/Library/Application Support/Inkquay/data/studio.db" \
  "select id,title,total_words,created_at from projects;
   select project_id,count(*) from characters group by 1;
   select project_id,count(*) from outline_beats group by 1;
   select project_id,count(*) from chapter_versions group by 1;"
grep -n '/plan' "$HOME/Library/Application Support/Inkquay/logs/server.log"
```

`repro-plan-slow.mjs` 打印的是**逐秒界面快照**（`primary / ghosts / inputsDisabled / notice / planReview / spinner / busyText`），
这正是"没反应"的可判定形态；`fake-provider.mjs` 支持 `DELAY_MS` 与 `HANG=1` 两种故障注入。

### 5.3 回归验证命令（改完之后必须一起绿）

```bash
cd software
pnpm typecheck
pnpm test          # API 20 组
pnpm build && pnpm test:ui   # UI 23 组（含新建 + 逐项企划确认）
# 新增：慢供应商场景必须在前 500ms 内出现可见进度（见 §5.1）
OBSERVE_MS=60000 node ../team/inkquay-ai-first/repro-plan-slow.mjs | head -20
```

---

## 6. 附录：本次审计的原始材料

- 截图：`evidence/plan-wait-9s-frozen-modal.png`（等待期无反馈，核心证据）、`evidence/plan-timeout-95s-error.png`（90 s 超时）、`evidence/plan-failed-orphan-project.png`（空壳项目 + 失败提示）
- 脚本：`fake-provider.mjs`（假 OpenAI 兼容服务，`DELAY_MS`/`HANG`）、`repro-plan-slow.mjs`（慢/挂死时间线取证）、`repro-plan-matrix.mjs`（mock/无模型/无 Key/假 Key 四态）
- 关键网络记录（mock 成功路径，`vite` dev 代理 `→` 客户端、`←` 服务端）：
  `POST /api/projects 201` → `POST /api/projects/p_xxx/plan 200` → `GET /api/projects/p_xxx` → 预览出现
- 关键网络记录（挂死路径）：`POST /api/projects/:id/plan` 在浏览器里挂起 90 s，最终 `502`，`console: Failed to load resource: the server responded with a status of 502`
- 未改动清单确认：`git status --porcelain` 在审计前后一致——`M desktop/build/icon.{icns,png}` 与三个 `*.bak-20261028` 是审计前就存在的改动（非本次产生），新增的 `?? team/inkquay-ai-first/` 就是本报告与证据目录；**`software/` 零改动**
