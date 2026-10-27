# VERIFY · 独立验收（t12：当前字节）

> **本文替代 t6 的验收结论。** t6 通过后，t10 又改了 `ProjectSettingsModal.tsx` / `CodexPage.tsx` / `LibraryPage.tsx` / `StudioPage.tsx` /
> `OutlinePage.tsx` / `ScreenplayPage.tsx` / `ui-test.mjs`，t11 又改了 `scripts/desktop-test.mjs` —— **t6 的 verdict 已失效**。
> 本文件的所有数字与断言都是本轮在当前工作区字节上**重新跑出来**的，不引用 t6/t11 的结论。

环境：macOS 27.0.1 / Node v26.11.1 / pnpm 10.34.7｜未 push、未发版、未 commit（D-12）

**结论（当前字节）**：A1–A6 与 D-1/D-2/D-3 在真实运行路径上全部成立；T1–T5 全绿；四条验收命令实跑通过；旧库升级、空库首启、取消/重试、
未保存保护（保存失败拒绝关窗）、404 友好退出等边界均实测通过；改前红（B-1 静默 mock、设置页关窗 5s）在基线 `4a43f42` 上可复现。
**残留**：H-6 服务崩溃白屏（本轮明确不做，D-09）、F-2/F-3 两条既有低危显示项、ui-test 端口复用风险，详见 §7。

## 0. 验收对象（revision）

| 项 | 值 |
| --- | --- |
| 基线 commit | `4a43f428e197fc41c47062261551e49c51208174`（HEAD，main） |
| 工作区状态 | 未 commit（本轮零 commit，D-12）；`git status --porcelain` = 24 个 `M` + 4 个未跟踪项（`.agent-teams/`、`team/inkquay-polish-2/`、`software/src/client/lib/`、`docs/EXPERIENCE-FIXES-ROUND2.md`） |
| 变更规模 | `git diff --stat 4a43f42` = 23 files, +926 / −114 |
| 构建产物 | `software/dist/assets/index-DSqx5IT8.js`（447.57 kB）、`index-BbPE3ens.css`（156.42 kB）、`desktop/server.cjs`（2.0 mb） |

关键文件 SHA-256（验收时的确切字节；复跑前请先比对，不一致则本文结论不适用）：

| 文件 | SHA-256 |
| --- | --- |
| `software/src/server/ai.ts` | `1c274169bc90cfa2fec927198e20c671c103de5c92e6451c49c4a070d95865c3` |
| `software/src/server/repository.ts` | `feb1b978484bcedf763edc463fb57ceccf239ce3908e255ea7c93ec83e522a8d` |
| `software/src/server/utils.ts` | `0c68b95e479334b81f5e86627645dc610f0f39db6681b7bc86a6a723c94946bf` |
| `software/src/server/plan.ts` | `7db7e6258cc8c08440b2eb46890d398ab1551a0cbe4bb29d3278b5e99aefbaa6` |
| `software/src/shared/types.ts` | `0bfaaa8f25ad6848749e1b72a265092b29dc271e8d44f374f2e1813fb94479ea` |
| `software/src/client/App.tsx` | `e0f16c14eafee5329d56a1afe72df77ee80d787a9dd17e0bf14614b1e769841c` |
| `software/src/client/lib/closeGuard.ts` | `4e064b8c8fbcf4093c69d499afc06d7aee86ffb31132ff01f04543184db0fdf4` |
| `software/src/client/components/ProjectSettingsModal.tsx` | `2490a7849c537ab976ca72863b3f0d78abf17715395a695980eb342768f33b5c` |
| `software/src/client/pages/StudioPage.tsx` | `b3d0c5a43636fc0d82e755ad4e50e9c08ee835116d2caa91fd45712c9e077a30` |
| `software/src/client/pages/LibraryPage.tsx` | `227f6388fc8482016dd5e42888c01df324f12875f1e1bb3ccbb1b4bbd3068ddf` |
| `software/src/client/pages/OutlinePage.tsx` | `7058805cdbaab667181c0fa735851298f83b1b3b8287c57cdcaa6daa24a8c2f8` |
| `software/src/client/pages/ScreenplayPage.tsx` | `e7b17d283e0e2a0b4387c7f72b4a7d73954a917e09691b9709557d79cf154d59` |
| `software/src/client/pages/CodexPage.tsx` | `529b841bb533716fb645c70875b7ae1dfe060e0097198000265fd287d895f018` |
| `software/src/client/pages/SettingsPage.tsx` | `4ba189a05f1ad5ccc7e7060f244627037215f799bebb4cf50f7bb33bdc9515bc` |
| `software/scripts/api-test.mjs` | `ca5c59e378e4f68976b67a8e3fa08bae840395d41adbeb18d39e49663c5e4996` |
| `software/scripts/ui-test.mjs` | `9d4053092ed05af8e78cba47bac54b5e10b2565c2d53eeee3bb66a0dd5d8de2d` |
| `scripts/desktop-test.mjs` | `1a463b0c0494d22597351d14ec76aaff74858d88f903342188a3d8a990065f5e` |

> `README.md`、`desktop/README.md`、`docs/RELEASE-ACCEPTANCE.md`、`software/README.md`、`docs/EXPERIENCE-FIXES-ROUND2.md`
> 也在工作区改动里，但属文档任务产物，不参与 A1–A6 的代码验收，本节不列其 hash。

## 1. 四条验收命令（本人实跑，原样记录）

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `pnpm -C software typecheck` | **0** | `tsc --noEmit` 无输出 |
| `pnpm -C software test` | **0** | 20 行 `PASS …`，末行 `All API tests passed.` |
| `pnpm -C software test:ui` | **0** | 23 行 `PASS …`，末行 `All UI tests passed.`（见 §1.1，首次跑失败是环境问题） |
| `pnpm desktop:test`（仓库根） | **0** | `PASS studio dirty close 273ms (<4000ms)` / `PASS T3 settings close 266ms (<2500ms)` / `Desktop E2E passed.` |

`pnpm test` 的 20 条（含本轮新增 T1/T2/T5）：
`clean install bootstrap` / `mandatory onboarding + encrypted provider key` / `create project + default acts` / `AI project plan preview + apply` /
`chapter save + version restore` / `beat create/update/reorder/delete` / `character create/update + foreshadow` / `screenplay scene + storyboard` /
`T1 screenplay markdown + docx export (and empty screenplay guard)` / `T2 screenplay bundle keeps scenes + shots` / `project delete cascade` /
`settings + profile` / `AI stream + regenerate` / `abort keeps partial assistant text` / `T5 unconfigured model refuses instead of silently mocking` /
`markdown + docx export (book + chapter)` / `project bundle export + import` / `chapter trash + restore + purge + project version list` /
`empty export guard` / `restart after empty library`。

`pnpm test:ui` 23 条中与本轮直接相关：`A3 screenplay routing + library counts + export scope reset`、`A4 context wording aligned`、
`A2 delete requires typed title + impact list`、`A6/T4 provider save keeps default model`、`A1-UI no default model prompt`、
`t10 D-1 outline acts are real + schematic markers`、`t10 D-2 screenplay scene analysis marked as schematic`、
`t10 D-3 codex wording stays local-only`、`t10 studio composer wording`、`t10 delete confirm closes on Esc without DELETE`。

### 1.1 `test:ui` 第一次跑失败的真实原因（环境，不是代码回归）

第一次 `pnpm -C software test:ui` **exit 1**：

```
page.waitForSelector: Timeout 30000ms exceeded.
  - waiting for locator('.onboarding') to be visible
    at software/scripts/ui-test.mjs:49:14
```

定位与证据：
1. `lsof -nP -iTCP:8798 -sTCP:LISTEN` → PID 37997，`node --import tsx src/server/index.ts`，cwd = `software/`，
   `PW_DATA_DIR=/tmp/pw-debug-rbsQGl`，13:41 启动 —— **上一轮遗留的调试服务进程**。
2. ui-test 的 `waitForServer()` 只打 `/api/health`，不校验端口归属；8798 上已有旧服务，测试连到一个 onboarding 已完成的旧库，
   页面直接进书架，`.onboarding` 永远不出现。
3. 反证：同 `dist` 挂空闲端口（`evidence/qa-t12-onboarding-diag.mjs`，端口 8821、全新库）→ `.onboarding` 正常渲染，
   `GET /api/settings` 返回 `onboarding.completed=false`、`defaultModel=null`，无 console/pageerror。
4. `kill 37997` 后原样重跑 → exit 0、23 PASS。

结论：**不是本轮代码问题**。建议（不在 t12 范围）：`ui-test.mjs` 启动前探测端口占用并明确报错，失败时打印实际 `/api/bootstrap` 以便一眼看出连错库。

## 2. A1–A6 逐条核对（源码 + 独立实测）

证据来源：本人自写探针 `evidence/qa-t12-api-probe.mjs`（21 条断言）与 `evidence/qa-t12-ui-probe.mjs`（9 条断言），
**不调用 ui-test.mjs 的断言逻辑**，只复用其选择器知识，避免「用被测者自己的尺子量被测者」。

### 2.1 A1 未配置模型不得静默 mock（B-1）

源码：`software/src/server/ai.ts:241-256` —— 顺序为「显式 override → 无 provider 抛 `AI_NO_DEFAULT_MODEL` → 无 model 抛 `AI_NO_MODEL_SELECTED`
→ 供应商不存在 → 供应商未启用 → 模型不在 `providerModelIds()` 可用列表」，全部在 `saveMessage()` 之前；显式 `providerId=mock` 仍走 `streamMock`。
`software/src/server/utils.ts:13-17` 是两个文案常量；`repository.ts:338-352` 的 `providerModelIds()` 优先 `enabled_models`，为空回退全量 `models`。

独立实测（旧库，`defaultModel=null`；全部 HTTP 200 + 恰好 1 条 SSE `error` + 0 个 `delta`）：

| 输入 | 实际文案 |
| --- | --- |
| 无 override | `还没有选择默认模型，请到设置中配置` |
| 只给 `modelId=deepseek-chat` | `还没有选择默认模型，请到设置中配置`（不借用默认 provider） |
| 只给 `providerId=deepseek` | `还没有选择模型，请到设置中配置` |
| `providerId=ghost` | `供应商「ghost」不存在，请到设置中重新选择` |
| `providerId=openai`（未启用） | `「OpenAI」未在此工作台启用，请到设置中开启` |
| `deepseek-reasoner`（只勾了 deepseek-chat） | `模型 deepseek-reasoner 不在「DeepSeek」的可用列表里，请到设置中重新选择` |

零副作用：六次拒绝前后 `messages?chapterId=` 恒为 2 条，章节 `content` / `words` 逐字不变。
显式 mock（`providerId=mock, modelId=mock-writer`）仍产出 delta + `meta.provider=本地演示`；恢复默认 mock 后正常 delta + `done`。

前端：`StudioPage.tsx:77-78`（`未配置模型`）、`:317`（`sendPrompt` 前置 toast）、`:1021`（composer 提示）。
UI 实测：`.model-pill` 含「未配置模型」；点发送只弹 toast「还没有选择默认模型」，`.chat .msg` 数量不变，composer 无「由 未配置模型 提供」病句。

### 2.2 A2 删除作品必须有闸门与清单（B-2）

源码：`ProjectSettingsModal.tsx:65-141` —— `loadImpact()` 并发取 `api.project` + `api.trashChapters` + `api.versions`，再逐条回收站章节补版本（单项失败按 0 计）；
失败只置 `impactError`、不阻塞；`canDelete = confirmStep==='confirm' && typedOk && !impactLoading && !busy`；`normalizeTitle()` 去空白与《》；
`remove()` 的 404 分支 toast「这部作品已经不存在了，已为你刷新列表」+ `reload()` + `navigate('/')`；`:110-121` 的 Esc 只 `backToEdit()`。

UI 实测（当前字节）：
- 未输入书名 → `.danger-confirm .btn--danger` disabled；输入 `旧库小` 仍 disabled；输入 `《旧库小说》` → enabled。
- 清单 7 项：章节 / 回收站中的章节 / 剧本场次 / 分镜 / 人物 / 伏笔 / 历史版本。
- 取消、Esc（确认区消失、弹窗仍在）、点遮罩 —— 三种关闭方式 **DELETE 请求计数均不变**。
- 清单失败：`page.route` abort `/api/projects/**` → 「清单暂时取不到，可重试」+ 重试按钮、0 项半截清单；解除 abort 点重试 → 恢复 7 项。
- 404：面板打开、书名已填、期间作品被 API 删除 → 点「确认删除」→ toast 命中「这部作品已经不存在了」，URL 回 `/`，卡片消失。
- 后端语义未变（设计如此，非回归）：`DELETE /api/projects/:id` 仍级联删除并随后 404。

### 2.3 A3 剧本不进章节写作台 + 卡片计数（H-4′）

源码：`App.tsx:17-21`（`StudioRoute`，仅 `type==='screenplay'` 时 `<Navigate replace>` 到 `/screenplay`；`:65` 挂路由）；
`StudioPage.tsx` 载入 effect 的剧本分支在 `rememberProject` 之前跳转；`LibraryPage.tsx:98/204-232/258-266` 按类型分流。

UI 实测：`goto /project/{剧本id}` → 自动落到 `/project/{剧本id}/screenplay`，`.doc-title-input` 数量 0（没落进章节写作台）。
书架（把剧本 PATCH 顶到最前成为英雄卡）：`.continue-card` 文本含「2 场」「6 个分镜」，无「页」，`.progress-ring` / `.pbar` 数量均为 0；
项目卡文本含「2 场 · 6 个分镜」。`sceneCount/shotCount` 由 `repository.ts:152-157` 的 `SUMMARY_COUNTS` 与列表共用同一份 SQL。

### 2.4 A4 不再声称「设定已进上下文」（H-1 方案 B）

源码：`CodexPage.tsx`（记忆卡「设定索引 / 本地保存」、view-sub「已记录 …；写作时可在共笔面板手动引用」、删除 72% 进度条、
inspector「本地」、人物/伏笔弹窗 hint 改本地保存）、`StudioPage` 记忆卡「写作上下文」+ 伏笔 chip「· 手动引用」。

UI 实测：设定页正文对 `已同步` / `已索引` / `自动引用` / `已经进入 AI` / `长期记忆` / `72%` **零命中**；
`.memory-index__head` 含「本地保存」，`.memory-index .pbar` 数量 0；伏笔台账含「记录埋设位置」。
全仓 grep（`software/src/client`）同样零命中禁用词。

### 2.5 A5 非写作台关窗不再固定等 5 秒（H-5）

源码：`software/src/client/lib/closeGuard.ts`（注册表 + 重入拒绝 + 抛错即拒绝）；`App.tsx:29-37` 在早退 return 之前挂唯一 `onCloseRequest`；
`StudioPage.tsx:234` 只注册 guard（`saveNow()` 失败 → toast + `return false`）；`desktop/main.cjs:33-52` 的 5s 兜底未改。

独立实测（`evidence/qa-close-probe.mjs`，当前构建）：

| 场景 | 结果 |
| --- | --- |
| 设置页关窗 | **272ms**（阈值 <2500ms） |
| 书架页关窗 | **293ms** |
| 保存失败（把非 GET 的 `/chapters/` 请求 reject）后关窗 | 7s 后窗口仍存活（`getAllWindows().length === 1`）→ 拒绝关窗；reload 后再关窗 **275ms** 退出 |
| `pnpm desktop:test` 内置断言 | `PASS studio dirty close 273ms (<4000ms)`、`PASS T3 settings close 266ms (<2500ms)` |

### 2.6 A6 / T4 供应商弹窗不得偷改默认模型（H-7）

源码：`SettingsPage.tsx:132` 回显、`:152-162` 条件写入、`:342` 的 `.provider-default-select`（`''` = 不设为默认）。

UI 实测：默认模型为 `deepseek/deepseek-chat` 时打开 OpenAI 弹窗，`.provider-default-select` 值为 `''`；直接保存 →
`GET /api/settings` 的 `defaultModel` 仍为 `{deepseek, deepseek-chat}`（provider 与 model 均未变）。

## 3. D-1 / D-2 / D-3（t10 的「示意」改造）逐条核对

重点核查「标注示意之后有没有引入新的假精确」。

### 3.1 D-1 大纲（OutlinePage.tsx）

源码：`acts = project.outline.acts`，幕序号按真实顺序生成（`actNumerals`），`is-active` 由 `selected?.actId || acts[0]?.id` 决定（不再写死索引 1）；
张力分隔线与「第 X–Y 章」标签由 `chapterSpans`（真实 beats 的 `chapterNo`）+ `chapterToX()` 计算；结构卡在 `acts.length===3` 时才写「三幕式」，
否则写「N 幕结构」；张力曲线与人物弧光各带 `.tag--hint`「示意」，文案为「曲线不按正文计算」「弧线是界面示意，不来自正文」，
并删掉了「按章节场景数量与状态估算」「数据来自设定库」。

独立实测：小说应用 AI 企划后 `acts=3 / beats=11`；`.act` 数量 = 3；`.structure-card` 含「3 幕」；`.chart-labels text` 三条全部匹配
`^第 \d+–\d+ 章$`（真实区间）；`.tag--hint` ≥2；`.act-item.is-active` 恰好 1 个；页面文本不再出现「按章节场景数量与状态估算」「数据来自设定库」。
**判断**：标注示意后，幕数/幕序号/章节区间/当前幕都来自真实数据，剩余硬编码只有曲线形状本身且已声明为示意 → 不构成新的假精确。

### 3.2 D-2 剧本（ScreenplayPage.tsx）

源码：本场分析标签 `tag--hint`「示意」+ `.script-inspector__note`「下面的评分与描述是界面示意，不来自本场正文分析，也不代表全书质量。」；
小节标题「本场功能 · 示例 / 潜台词 · 示例」；`writtenScenes = scenes.filter(content.trim()).length`，进度条宽度为真实比例；
模式栏「估算 N 分钟」并带 title 说明按每场 3 分钟粗估。

独立实测：`.script-inspector__head .tag--hint` 文本 =「示意」；`.script-inspector__note` 含「不来自本场正文分析」；
`.goal-mini strong` 匹配 `^\d+ / \d+ 场有正文$`；页面不再出现「数据来自」式措辞。
**判断**：4.5/4.0/3.5 三个写死分数仍在，但被「示意 + 示例」双重标注，进度条与场次改为真实数据 → 假精确被限制在「已声明是示意」范围内。

### 3.3 D-3 设定页（CodexPage.tsx）

源码：伏笔台账说明改「记录埋设位置与计划回收位置，写作时可在共笔面板手动引用」；检查器字段 `<dt>出场</dt>` → `<dt>全书</dt>`。
独立实测：见 §2.4（禁用词零命中、`.memory-index .pbar` 数量 0、伏笔说明含「记录埋设位置」）。

## 4. T1–T5 结果

| 用例 | 载体 | 本轮独立复核 |
| --- | --- | --- |
| T1 剧本导出 | api-test | 独立断言：md 200 且含两场 heading + 两段正文；docx 200、`PK` 头、>1000B；空剧本 400「…还没有可导出的正文」 |
| T2 项目包 | api-test | 独立断言：小说包 import 后章节正文逐字一致；剧本包 import 后 2 场 / 6 分镜 / heading / `sceneCount+shotCount` 一致 |
| T3 桌面设置页关窗 | desktop-test | `PASS T3 settings close 266ms (<2500ms)`；改前红见 §6 |
| T4 = A6 | ui-test | 见 §2.6（独立探针复测） |
| T5 未配置模型 | api-test | 见 §2.1（六分支全量独立复测） |

## 5. 边界矩阵（SPEC 之外的独立核查）

| 边界 | 方法 | 结果 |
| --- | --- | --- |
| 旧库升级（基线代码建的库 → 当前代码打开） | 基线 `/tmp/qa-base`（`git archive 4a43f42`）建库：小说 1 章 + 剧本 2 场 6 分镜并写正文 → 当前代码同 `PW_DATA_DIR` 启动 | 两本作品都在；章节标题/正文逐字一致；剧本 2 场、`1. 内景 · 旧公寓 · 夜`、场景正文、6 分镜全在；`sceneCount=2 / shotCount=6`，小说 `0/0`；旧库仍可继续写（PATCH 成功、words 增加） |
| 旧库导出/备份 | 同一旧库 | 剧本 md/docx 200；小说 bundle 导出→import 正文一致；删除作品后 `GET` 404 |
| 空库首次启动 | 全新 `mkdtemp` 启动当前服务 | `/api/bootstrap` → `projects: []`、`onboarding.completed=false`、`defaultModel=null`；`/api/projects` → `{"projects":[]}`；api-test 的 `clean install bootstrap` 同时 PASS |
| 零 schema / 零新依赖 | `git diff 4a43f42 -- software/src/server/db.ts seed.ts migrate.ts software/package.json package.json pnpm-lock.yaml` | **输出为空** |
| 取消 / 重试 | 删除面板的取消、Esc、遮罩；清单失败后的「重试」 | 三种取消均 0 DELETE；重试后 7 项清单恢复 |
| 未保存保护 | 关窗 guard 在保存失败时 | 拒绝关窗（窗口 7s 后仍存活），reload 后正常关闭（275ms） |
| 404 友好退出（删除） | 面板打开期间作品被别处删除 | toast 提示 + 回书架，无白屏、无 pageerror |

## 6. 改前红（在基线 `4a43f42` 上实测，不是推断）

| 项 | 复现方式 | 基线结果 | 当前结果 |
| --- | --- | --- | --- |
| B-1 静默 mock | 基线代码 + 基线建的库，`defaultModel=null` 直接 `POST /api/ai/stream` | `status=200, meta.provider=本地演示, model=墨笔演示模型, deltas=51, errors=0`（正文被生成，可落库） | 200 + 1 条 error「还没有选择默认模型」+ 0 delta，消息数不变 |
| H-5 设置页关窗卡 5s | 同一份 `evidence/qa-close-probe.mjs` 指向基线构建 | 设置页关窗 **5164ms**（5s 兜底）；`AssertionError: settings 页关窗不得等 5s 兜底：实际 5152ms，要求 <2500ms`（exit 1）；同次工作室用例 PASS 276ms | 272ms / 293ms；`PASS T3 settings close 266ms` |

## 7. 未覆盖项与残留风险

1. **H-6 服务崩溃白屏（本轮明确不做，D-09）**：`desktop/main.cjs:133` 仍 `webContents.send('server-exited', code)`，渲染进程无人监听。
   服务进程异常退出时界面仍是白屏，无提示、无重启引导。**未覆盖，属已知取舍**。
2. **F-2（low，既有）**：`defaultModel=null` 时设置页默认模型下拉视觉上仍显示第一项（受控 select 无匹配 option 时 `selectedIndex=0`），
   同页头部卡片显示「未配置 / 请连接供应商」。服务端确为 `null`（`PUT {defaultModel:null}` → `GET` 返回 `null`），写作台显示「未配置模型」，仅下拉框视觉不一致。非本轮引入。
3. **F-3（low，既有）**：剧本项目卡 meta 仍带 `{totalWords} 字`，对剧本恒为「0 字」。本轮只保证不出现「页」与假百分比；
   彻底去掉需改卡片布局，超出本轮范围。
4. **测试基础设施**：`ui-test.mjs` 固定端口 8798 且 `waitForServer()` 不校验端口归属，机器上有遗留服务时会误报 `.onboarding` 超时（§1.1）。
5. **未在真实 Windows/Linux 上跑桌面端**：本轮 `pnpm desktop:test` 在 macOS 本机通过；跨平台签名/更新链路仍未验。
6. **剧本导出路由忽略 `scope/format`**：`GET /api/projects/:id/export?scope=book&format=md` 实际只认 `chapterId`（导出行为正确，参数被忽略）。
   属既有实现，本轮未改；仅记录，避免下游误以为参数生效。

## 8. 未做 / 未改声明

- 本任务**没有修改任何业务代码**：`software/src/**`、`software/scripts/**`、`scripts/**`、`desktop/**` 均由 t4/t5/t10/t11 改好，t12 只读取与运行。
- t12 产出只有：本文件 + `team/inkquay-polish-2/evidence/` 下的探针脚本（含复跑说明）。
- 未 push、未发版、未 commit（D-12）。

## 9. 复跑方法

```bash
cd <repo>
# 1) 四条验收命令
pnpm -C software typecheck
pnpm -C software test
pnpm -C software test:ui      # 先在 lsof -nP -iTCP:8798 -sTCP:LISTEN 确认端口空闲，见 §1.1
pnpm desktop:test

# 2) 旧库升级 + A1/A3/T1/T2/D-1 数据面（会重建 /tmp/qa-t12lib，需要基线构建副本 /tmp/qa-base）
node team/inkquay-polish-2/evidence/qa-t12-api-probe.mjs baseline   # 基线建库 + 复现 B-1 静默 mock
node team/inkquay-polish-2/evidence/qa-t12-api-probe.mjs current    # 当前字节验收（21 条断言）

# 3) 界面侧 A1-UI/A2/A3/D-1/D-2/D-3/A6（依赖上一步的 /tmp/qa-t12lib 与 /tmp/qa-t12-state.json）
node team/inkquay-polish-2/evidence/qa-t12-ui-probe.mjs             # 9 条断言

# 4) 桌面关窗耗时与保存失败拒绝关窗（需先 pnpm desktop:prepare）
node team/inkquay-polish-2/evidence/qa-close-probe.mjs "$PWD" settings
node team/inkquay-polish-2/evidence/qa-close-probe.mjs "$PWD" library
node team/inkquay-polish-2/evidence/qa-close-probe.mjs "$PWD" guardfail

# 5) 基线副本（/tmp/qa-base 被清理后重建，用于改前红对照）
rm -rf /tmp/qa-base && mkdir -p /tmp/qa-base && git archive 4a43f42 | tar -x -C /tmp/qa-base
ln -s "$PWD/node_modules" /tmp/qa-base/node_modules
ln -s "$PWD/software/node_modules" /tmp/qa-base/software/node_modules
(cd /tmp/qa-base/software && npx vite build && cd /tmp/qa-base && node scripts/build-desktop.mjs)
```

> `/tmp/qa-t12lib` 是探针创建的一次性数据库，可随时 `rm -rf`。探针只读业务代码、只写各自临时目录。
