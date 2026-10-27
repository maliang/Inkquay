# 体验修复 · 第二轮（基线 `4a43f42`）

> **状态**：A1–A6、D-1/D-2/D-3 已完成实现、独立验收（t12）与两轮复审（t13/t14）；**尚未发布** —— 本轮不 push、不发版，改动仍在本地工作区（零 commit、零 schema 变更、零新依赖）。
> **F-1 已关闭**（t11 完成）：`pnpm desktop:test` 现在自带「非写作台关窗 < 2500ms」断言，写作台超时也从 8000ms 收紧到 4000ms。
> 这不是发版说明；发布前请按 §9 的下一轮候选继续。

## 0. 这一轮在修什么

上一轮解决的是「能不能用」，这一轮只做两件事：

1. **让界面说的和 AI 实际做的一致** —— A1（未配置模型却用演示模型代写）、A4（声称设定已进上下文）、A6（保存供应商时偷改默认模型）。
2. **给不可恢复的操作加安全网** —— A2（删除作品一次确认就永久删除）。

顺手修掉两个「把人带错地方」的问题：A3（剧本点「继续写作」却落进章节写作台）、A5（非写作台关窗固定等 5 秒）。

本轮同时收口了主人拍板的 D-1 / D-2 / D-3：大纲三幕卡改读真实 `acts`，张力曲线与人物弧光标「示意」；剧本「本场分析」保留但标「示意」；72% / 已同步 / 已索引等假指标删除。F-1 的关窗耗时回归已由 t11 补齐并关闭（见 §6）。不在本轮范围：作品级回收站、`server-exited` 白屏、富文本编辑器。

## 1. 用户可见变化

| 场景 | 修复前 | 现在 |
| --- | --- | --- |
| 没配默认模型时点「让 AI 续写」 | 静默用「墨笔演示模型」生成一整段，用户以为是自己选的模型写的，消息还照常入库 | 弹提示「还没有选择默认模型，请到设置中配置（右下角「管理供应商」）」；服务端直接返回错误，不写消息、不动正文。显式选择「本地演示」仍然可用 |
| 删除作品 | 一次系统确认框即永久删除；章节回收站救不了，历史版本一并消失 | 二次确认页列出 7 项真实计数，必须手输书名才能点「确认删除」；返回 / 取消 / 点遮罩都不发删除请求；作品已被别处删除时提示并刷新列表，不白屏 |
| 打开剧本 | 书架「继续写作」或直接访问 `/project/{剧本id}` 会落进章节写作台：目录 0 章、还能新建章节 | 自动进入剧本页；书架英雄卡与作品卡显示「N 场 · M 个分镜」，不再出现「0 章 0 页」；大纲 / 设定页仍可正常访问 |
| 设定页文案 | 「长期记忆 / 已同步」「人物、秘密与关系已经进入 AI 的写作上下文」「AI 已索引…自动引用」，外加一条 72% 进度条 | 统一为「设定索引 / 本地保存」，明确写「写作时可在共笔面板手动引用」；72% 假进度条已删除 |
| 关闭窗口 | 非写作台页面也要等满 5 秒兜底（实测 5164ms） | 任意页面关窗立即退出（实测 273ms）；写作台仍先落盘，保存失败则不关窗 |
| 供应商弹窗保存 | 保存任何供应商都会把默认模型改回该供应商的第一个启用模型 | 弹窗内单独选择「默认模型」（默认「不设为默认」）；不改就不写；停用当前默认供应商时清空无效默认模型 |

## 2. 逐项说明

### A1 · 未配置模型不再静默回退到演示模型

根因在 `software/src/server/ai.ts`：`providerId = opts.providerId || settings.defaultModel?.providerId || 'mock'`，没有默认模型时直接落到 `mock`，前端完全看不出。

现在的解析与校验（全部发生在写 `ai_messages` 之前，失败即零副作用）：

| 情况 | 返回的 SSE `error.message` |
| --- | --- |
| 没有默认模型，也没有显式指定 | 还没有选择默认模型，请到设置中配置 |
| 指定了供应商但没给模型（或反之） | 还没有选择模型，请到设置中配置（不借用另一半兜底） |
| 供应商不存在 | 供应商「x」不存在，请到设置中重新选择 |
| 供应商未在此工作台启用 | 「OpenAI」未在此工作台启用，请到设置中开启 |
| 模型不在该供应商的启用列表 | 模型 x 不在「DeepSeek」的可用列表里，请到设置中重新选择 |
| 供应商需要 Key 但没配 | 「供应商名」尚未配置 API Key，请先到设置中填写（既有行为） |

- 文案由 `software/src/server/utils.ts` 的 `AI_NO_DEFAULT_MODEL` / `AI_NO_MODEL_SELECTED` 统一导出，AI 共笔与 AI 企划共用，避免同一问题两种说法。
- 前端在 `software/src/client/pages/StudioPage.tsx` 发送前先拦一次并 toast；模型胶囊与输入框提示在未配置时显示「未配置模型」。
- 显式 `providerId=mock` 仍走演示流（自测与 `ui-test` / `desktop:test` 依赖它），没有被误伤。

### A2 · 删除作品：清单 + 书名闸门

`software/src/client/components/ProjectSettingsModal.tsx` 去掉 `window.confirm`，改为两步式确认：

1. 点「删除作品」→ 进入确认页，并发拉取 `GET /api/projects/:id`、`GET /api/projects/:id/trash`、`GET /api/projects/:id/versions`，并对回收站章节逐章补拉版本数，拼出 **7 项真实计数**：章节、回收站中的章节、剧本场次、分镜、人物、伏笔、历史版本。
2. 必须输入作品名（自动忽略首尾空白与书名号）才能点「确认删除」；空输入、错名一律禁用。

失败与异常路径：

- 清单接口失败 → 显示「清单暂时取不到，可重试」+ 重试按钮，**不阻塞删除**（真正的闸门是手输书名）；`finally` 保证不会永久卡在 loading。
- 作品已被别处删除 → toast「这部作品已经不存在了，已为你刷新列表」并回书架，不报白屏。
- 返回 / 取消 / 点遮罩 / Esc 都不会发出 `DELETE`（Esc 在确认页不会关闭面板）。

服务端删除语义**没有改**：仍是级联硬删除。作品级回收站（D-4）是下一轮候选，所以文案只承诺「不可恢复」，并说明「章节回收站只保护单章删除」。

### A3 · 剧本不再落进章节写作台

- `software/src/client/App.tsx` 新增 `StudioRoute`：只有 `/project/:projectId` 命中 `type === 'screenplay'` 时 `<Navigate replace>` 到 `/project/:id/screenplay`；`/outline`、`/codex` 放行，否则剧本页的 tab 会来回弹。
- `StudioPage` 载入 effect 里再兜一层（重定向发生在 `rememberProject` 之前，避免「上次打开的作品」被记成剧本 id）。
- 书架按类型分流：英雄卡剧本显示「N 场」+「N 个分镜」、进度环改场次、不再画对剧本恒为 0 的字数进度条，「继续写作」直接进剧本页；作品卡 meta 对剧本显示「N 场 · M 个分镜」。
- 计数来自服务端 `ProjectSummary.sceneCount` / `shotCount`（`listProjects()` 与 `getProjectDetail()` 共用同一份 SQL），不是前端猜的。

残留：作品卡仍会显示「0 字」、侧栏「最近更新」仍按章节数显示「0 章」（见 §5 F-3）。

### A4 · 设定页不再声称「已经进入上下文」

`buildWritingContext()` 实际注入的是：作品与写作偏好、故事梗概、当前章节标题、当前正文节选（末 4000 字）、主要人物前 8、大纲节拍前 12、最近 3 章。**不含伏笔与人物关系**。本轮只改说法（方案 B），不改注入逻辑：

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| 设定页记忆卡 | 长期记忆 / 已同步 | 设定索引 / 本地保存 |
| 记忆卡正文 | 人物、秘密与关系已经进入 AI 的写作上下文 | 人物、秘密与关系保存在本地，写作时可在共笔面板引用 |
| 记忆卡进度条 | 完整度 72% | 已删除 |
| 设定页副标题 | AI 已索引 N 位人物…自动引用 | 已记录 N 位人物、M 条伏笔；写作时可在共笔面板手动引用 |
| 人物档案 inspector | 已同步 | 本地 |
| 人物 / 伏笔弹窗 | 进入上下文相关措辞 | 人物设定保存在本地，写作时可引用 / 伏笔保存在设定里，写作时可手动引用 |
| 写作台记忆卡 | 已启用记忆；伏笔 N | 写作上下文；伏笔 N · 手动引用 |

真正把伏笔 / 关系拼进系统提示词（方案 A）留给下一轮。

### A5 · 非写作台关窗不再固定等 5 秒

- 新增 `software/src/client/lib/closeGuard.ts`：一份 guard 注册表（`registerCloseGuard` 返回注销函数）、`runCloseGuards()` 依次执行、执行中重入直接拒绝、guard 抛错按「不关窗」处理。
- `software/src/client/App.tsx` 在最外层（提前 return 之前）挂**全应用唯一**的 `onCloseRequest` 监听：没有 guard 立即 ack，有 guard 先跑完再 ack。桌面主进程只有一个 `closeRequestWindow`，多处监听会双 ack 丢稿，所以这里必须是单点。
- `StudioPage` 删掉自建监听，只注册 guard：清掉防抖定时器 → `saveNow()`；失败 toast「保存失败，窗口先不关闭，请重试」并 `cancelClose`。
- `desktop/main.cjs` 的 5 秒兜底保留，用于渲染层真卡死的极端情况。

实测：设置页关窗 5164ms → 273ms（真实 Electron + 真实主进程；`pnpm desktop:test` 已含 <2500ms 断言）。

### A6 · 供应商弹窗保存不再偷改默认模型

- 弹窗里的「默认模型」从推导值（`enabledModels[0]`）改为显式选择 `providerDefaultChoice`：`''` 表示「不设为默认」，只有当前默认本就属于该供应商时才回显。
- 只有两条路径会写 `defaultModel`：用户在弹窗里显式选择；或当前默认指向的供应商 / 模型已失效。
- 停用当前默认供应商：有可用备选则切到备选，没有则置空（写作台显示「未配置模型」，不会留一个指向已停用供应商的默认值）。
- `api.ts` 的请求错误会带上 `error.status`，A2 的 404 分支依赖它。

残留：设置页顶部那个「默认模型」下拉在 `defaultModel=null` 时视觉上仍落在第一项（见 §5 F-2）。

## 3. 改动范围（文件级）

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 服务端 | `software/src/server/ai.ts` | 替换 mock 兜底为六步校验，全部在写消息之前 |
| 服务端 | `software/src/server/utils.ts` | 新增两条统一拒绝文案常量 |
| 服务端 | `software/src/server/plan.ts` | AI 企划共用同一常量 |
| 服务端 | `software/src/server/repository.ts` | `providerModelIds()`；`SUMMARY_COUNTS` 共享计数字段 |
| 共享 | `software/src/shared/types.ts` | `ProjectSummary` 增加 `sceneCount` / `shotCount` |
| 客户端 | `software/src/client/App.tsx` | `StudioRoute`；全应用唯一关窗监听 |
| 客户端 | `software/src/client/lib/closeGuard.ts` | 新增 guard 注册表 |
| 客户端 | `software/src/client/pages/StudioPage.tsx` | A1-UI 提示；A3 载入兜底与导出范围复位；A4 文案；A5 改为注册 guard |
| 客户端 | `software/src/client/components/ProjectSettingsModal.tsx` | A2 两步式删除确认与影响清单 |
| 客户端 | `software/src/client/pages/LibraryPage.tsx` | 剧本按类型显示场次 / 分镜，去掉假字数进度 |
| 客户端 | `software/src/client/pages/CodexPage.tsx` | A4 文案与删除假进度条 |
| 客户端 | `software/src/client/pages/SettingsPage.tsx` | A6 默认模型语义 |
| 客户端 | `software/src/client/api.ts` | 错误附带 HTTP 状态 |
| 客户端 | `software/src/client/styles/app.css` | `.danger-confirm` 样式体系（只用既有 CSS 变量） |
| 测试 | `software/scripts/api-test.mjs` | 新增 T1 / T2 / T5 |
| 测试 | `software/scripts/ui-test.mjs` | 新增 A3 / A4 / A2 / A6-T4 / A1-UI |
| 测试 | `scripts/desktop-test.mjs` | t11：非写作台关窗 < 2500ms 断言；写作台超时 8000 → 4000ms |
| 客户端 | `software/src/client/pages/OutlinePage.tsx` | t10：三幕卡改真实 `acts`，张力曲线与人物弧光加「示意」标注 |
| 客户端 | `software/src/client/pages/ScreenplayPage.tsx` | t10：「本场分析」加「示意」标注，进度改真实场数 |

未改：`db.ts`（建表 + 轻量自愈迁移都在这里）、`seed.ts`（零 schema 变更）、`software/package.json`（零依赖）、`desktop/`。最终字节以 t12 复验时的 `git diff` 为准。

## 4. 验证

四条命令均在本机实跑（macOS / Node v26.11.1 / pnpm 10.34.7）：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0，20 条 PASS，末行 `All API tests passed.` |
| `pnpm test:ui` | exit 0，23 条 PASS，末行 `All UI tests passed.` |
| `pnpm desktop:test` | exit 0，`PASS studio dirty close 273ms (<4000ms)` / `PASS T3 settings close 266ms (<2500ms)` / `Desktop E2E passed.` |

t11 落地后 `pnpm desktop:test` 的输出（本机实跑，含新增耗时断言）：

```text
PASS studio dirty close 273ms (<4000ms)
PASS T3 settings close 266ms (<2500ms)
Desktop E2E passed.
```

> 上表是 t12 对当前字节（t10 收口后）的最终复验结果；t13/t14 复审也分别重跑了对应门禁。

新增测试（顺序即实现顺序）：

- `PASS T1 screenplay markdown + docx export (and empty screenplay guard)`
- `PASS T2 screenplay bundle keeps scenes + shots`
- `PASS T5 unconfigured model refuses instead of silently mocking`
- `PASS A3 screenplay routing + library counts + export scope reset`
- `PASS A4 context wording aligned`
- `PASS A2 delete requires typed title + impact list`
- `PASS A6/T4 provider save keeps default model`
- `PASS A1-UI no default model prompt`

改前红（在 `4a43f42` 的真实构建上实测，不是推断）：

| 事项 | 改前 | 改后 |
| --- | --- | --- |
| 未配置模型静默 mock | HTTP 200、`meta.provider=本地演示`、51 个 delta、0 个 error，消息落库 | 200、1 条 error、0 delta、消息数不变 |
| 删除无安全网 | 一次 `window.confirm` 即硬删 | 手输书名 + 7 项清单；取消类操作 0 次 DELETE |
| 剧本落进写作台 | 英雄卡「0 章 0 字」，`/project/{剧本id}` 渲染章节写作台 | 自动跳 `/screenplay`，`.doc-title-input` 计数 0 |
| 非写作台关窗 5s | `/settings` 关窗 5164ms（t11 在基线上复测得 5152ms） | 273ms；`desktop:test` 现断言 < 2500ms |
| 保存偷改默认模型 | 无条件写回 `enabledModels[0]` | 仅在显式选择或默认失效时写 |

独立验收还覆盖了：旧库升级（基线建库 → 新代码启动，作品 / 正文 / 场次 / 分镜全保留）、空库首启、清单失败重试、取消与 404、未保存保护（dirty 关窗落盘；保存失败强制不关窗）。全部证据与可复跑探针在 `team/inkquay-polish-2/VERIFY.md` 与 `team/inkquay-polish-2/evidence/`。

## 5. 仍未解决 / 已知边界

| 编号 | 内容 | 影响 | 计划 |
| --- | --- | --- | --- |
| F-2 | 设置页「默认模型」下拉在 `defaultModel=null` 时视觉上仍选中第一项（同页卡片正确显示「未配置」） | 显示不一致，不影响实际请求 | 下一轮给 `<select>` 加一个空值占位项 |
| F-3 | 剧本作品卡仍显示「0 字」；侧栏「最近更新」仍按章节数显示「0 章」 | 噪声，不再是「页」的假数字 | 下一轮按类型隐藏 / 换口径 |
| H-6 | 本地服务异常退出（`server-exited`）无人接收，窗口白屏 | 崩溃时无提示 | 下一轮（≤1h） |
| O-1 | 剧本「生成分镜」是 6 条写死模板，不经模型却写入真实分镜表 | 文案像 AI 生成，未配置模型也能“生成” | 下一轮接真 AI 或改「示例模板」文案 |
| D-1 | 大纲页三幕卡改真实 `acts`；张力曲线、人物弧光标注「示意」 | 展示口径按主人决策统一 | **已完成（t10；t12/t13/t14 复验）** |
| D-2 | 剧本页「本场分析」保留，标注「示意」 | 同上 | **已完成（t10；t12/t13/t14 复验）** |
| D-3 | 72% / 已同步 / 已索引等假指标删除，改「本地保存」 | 已在 A4 完成 | — |
| D-4 | 删除作品仍是硬删除，没有作品级回收站 | 误删不可恢复（现有书名闸门 + 清单降低概率） | 下一轮候选 |
| — | 伏笔与人物关系仍未真正进入系统提示词（A4 只改了说法） | 用户手动引用才生效 | 下一轮「方案 A」 |
| D-06 | A3 的导出范围复位当前无可达路径，是防御性代码 | 无用户影响 | 保留，未来加入口后生效 |
| D-05 | `PUT /api/settings` 仍允许第三方写入不一致的 `defaultModel` | A1 在请求时兜底，不会真的用错模型 | 下一轮加软校验 |
| K-1 / K-3 | 剧本没有页数量纲；剧本导出入口只在剧本页 | 剧本作者需多一步 | 下一轮（需 schema 决策） |

其余长期边界（富文本编辑器、多用户、云同步、备份不含 Key 等）见根目录 README「已知边界」。

## 6. F-1 已关闭（t11）

F-1 原指：`pnpm desktop:test` 只验证写作台关窗落盘，没有「非写作台关窗 < 2500ms」断言，写作台用例仍是 8000ms 超时——5 秒兜底一旦被引回来，测试照样绿。

t11 已在 `scripts/desktop-test.mjs` 补齐：

- 启动 → 打开 `/settings` → 挂进程 exit 监听 → `BrowserWindow.close()` → 断言从 `close()` 到进程退出 **< 2500ms**，输出 `PASS T3 settings close <N>ms (<2500ms)`；
- 写作台用例超时 8000ms → **4000ms**，输出 `PASS studio dirty close <N>ms (<4000ms)`；
- 改前红：同一条断言在基线上实测 **5152ms**，直接变红。

本机实跑（`pnpm desktop:test`）：`PASS studio dirty close 273ms (<4000ms)` / `PASS T3 settings close 266ms (<2500ms)` / `Desktop E2E passed.`。这条缺口不再是「已知边界」，已经进回归网。

## 7. 展示类假数据的处理（已拍板）

主人已就 D-1 / D-2 / D-3 拍板，结论如下（由任务 t10 实施，已随本轮完成）：

| 编号 | 模块 | 决策 |
| --- | --- | --- |
| D-1 | 大纲页 | 三幕卡改为读真实 `acts`；张力曲线、人物弧光保留但标注「示意」 |
| D-2 | 剧本页 | 「本场分析」保留，标注「示意」 |
| D-3 | 全局 | 删除 72% 完整度、已同步、已索引等假指标，统一改「本地保存」（**已随 A4 完成**） |

也就是说：不再删功能、也不做真算，而是「能真算的真算，算不出来的明确标注示意」。这与本轮 A4 的思路一致——界面上不出现无法兑现的承诺。

## 8. 数据兼容与回滚

- **零 schema 变更**：没有新增表 / 列，旧 `data/studio.db` 直接用；已用基线代码建库、再用新代码启动实测（作品、正文、场次、分镜、密钥全保留，可继续写与导出）。
- **回滚**：本轮没有 commit，所有改动都在工作区；确认没有未提交的其它改动后，`git checkout -- software` 即可回到 `4a43f42` 的代码。若只想回滚某一项，按 §3 的文件清单粒度回退。
- **截图**：`software/screenshots/91-desktop-studio.png`、`99-new-project-empty.png` 曾被 `test:ui` 刷新，收尾时已 `git checkout --` 还原，不进入本轮 diff。

## 9. 下一轮候选（按性价比排序）

1. H-6 接收 `server-exited` 并给出可重试提示（≤1h）。
2. O-1 剧本分镜接真 AI，或先改「示例模板」文案。
3. 作品级回收站（D-4）。
4. 伏笔 / 关系真正进入提示词（A4 方案 A）。
5. 剧本页数量纲（`scenes.words` 或导出时统计）与剧本导出入口前移。
6. `PUT /api/settings` 的默认模型一致性软校验；A2 影响清单收进服务端（去掉 N+1 请求）。
7. 设置页默认模型下拉加空值占位项（F-2）、剧本卡「0 字」口径（F-3）；`repository.ts:154` 的 shot_count 索引（P-1）。
