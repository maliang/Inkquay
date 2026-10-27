# 调研报告（RESEARCH）

> 调研员：researcher｜2026-10-27｜分支 `main` @ `8e95e43`｜只读代码 + 实测，未改任何业务文件。
> 路径相对仓库根；行号为当前 HEAD 实际位置。配套文档：`REPOWIKI.md`（命令 / 目录 / 数据模型 / 坑）。

---

## 0. 一句话结论

产品**骨架完整**（四类作品、企划→写作→版本→导出闭环、三平台打包、三层测试都有），问题集中在**边界与失败路径**：

1. 删光作品后重启，服务端**直接崩溃**（已实测复现）；
2. 点「停止生成」后，已经生成的正文**全部丢弃**；
3. 章节 / 人物 / 场次 / 分镜 / 伏笔**一律删不掉**；
4. 「AI 企划」进行中按 Esc 或取消，**取消无效**，用户被拽进新作品；
5. 「版本回退」只在 AI 动作时才有快照，手动改稿等于没有历史；编辑器撤销栈被四处 `innerHTML` 重写摧毁。

这五条就是「流程不通 + 不人性化」的主干，其余是外围噪音。

---

## 1. 证据与复现方式（可直接跑）

### 1.1 P0-1 删空作品后重启崩溃（已实测，非推测）

```bash
cd software
export TMPD=/tmp/pw-reseed-check; rm -rf $TMPD; mkdir -p $TMPD
PORT=8791 PW_DATA_DIR=$TMPD ./node_modules/.bin/tsx src/server/index.ts &   # 起服务
curl -s -X POST http://127.0.0.1:8791/api/projects -H 'content-type: application/json' \
  -d '{"title":"重播测试","type":"novel"}'                                  # 建一本
curl -s -X DELETE http://127.0.0.1:8791/api/projects/<id>                   # 删掉唯一一本
lsof -ti tcp:8791 | xargs kill; sleep 1
PORT=8791 PW_DATA_DIR=$TMPD ./node_modules/.bin/tsx src/server/index.ts     # 再启动
```

实测输出（2026-10-27）：

```
software/src/server/seed.ts:9
  db.prepare(sql).run(...keys.map((k) => row[k] as any));
Error: UNIQUE constraint failed: providers.id
    at insert (seed.ts:9:19)
    at seedDatabase (seed.ts:63:5)
    at migrate (db.ts:168:5)
    at <anonymous> (index.ts:49:1)
EXIT=1
```

### 1.2 已排除的怀疑（别再去查，省时间）

| 怀疑 | 实测结论 |
| --- | --- |
| 中文标题导出会 500（Express header 编码） | **不会**。`GET /api/projects/<id>/export.docx` 返回 200，`Content-Disposition: attachment; filename*=UTF-8''%E9%9B%A8%E5%A4%9C…`，RFC 5987 编码正常；md 导出同理 |
| 每次自动保存都写一条版本，导致版本爆炸 | **不会**。`updateChapter`（`repository.ts:191-208`）不碰 `chapter_versions`，版本只在显式 POST 时产生——这反而是问题（见 P1-6） |
| 空作品导出会报错 | 不报错，但会导出一个 77 字节的 md（只有封面信息），无任何提示 |
| 「已归档」会从作品库消失 | 不会。`status` 只是标签，`LibraryPage` 没有归档筛选 |

---

## 2. 候选清单（15 条，P0 → P2）

### P0 —— 阻断或数据丢失，建议本轮必修

---

#### P0-1 删光作品库后重启，服务端启动即崩（桌面端表现为 App 打不开）

**证据**
- `software/src/server/db.ts:166-170`：`SELECT COUNT(*) FROM projects` → `if (!row || row.count === 0) { seedDatabase(db); console.log('[db] seeded demo data'); }`
- `software/src/server/seed.ts:9` / `:63`：写入使用**固定 id**（`mock` / `deepseek` / …）的 provider 行，非 upsert
- `software/src/server/index.ts:49`：`migrate();` 在模块顶层裸调用，无 try/catch
- 实测栈见 §1.1

**用户影响**
用户在作品库里删掉最后一本（清理试写作品是最常见的动作），下次打开 App 就永久打不开；桌面端只会弹「无法连接本地服务」，或白屏，用户完全无法理解「删一本作品把应用删坏了」。数据其实还在，但用户会认为丢了。

**建议方向**
1. 首启判断改为「库文件是否存在」而不是「projects 为空」：`fs.existsSync(dbPath)` → 仅在首次建库时播种；
2. `seedDatabase` 改用 `INSERT ... ON CONFLICT(id) DO NOTHING`（providers/settings 都是幂等数据，天然适合 upsert）；
3. `migrate()` 包 try/catch，失败时输出可读中文错误 + 日志路径，并以非 0 退出码让桌面端能区分；
4. 桌面端在主进程捕获子进程退出，弹「本地服务未能启动：重试 / 打开日志 / 重建数据库」；
5. 补测试：`api-test.mjs` 增加「删最后一个作品 → 重启 → /api/health 200」。

**验收**：删除最后一件作品后重启，`GET /api/health` 返回 200，`/api/bootstrap` 返回 `projects: []`、`providers: 9`、`onboarding.completed` 保持 true。

---

#### P0-2 点「停止」= 已生成的正文全部丢失，且留下一条无回答的提问

**证据**
- `software/src/server/ai.ts:244-253`：请求开始即 `saveMessage({role:'user'})`（**先落库**）
- `software/src/server/ai.ts:275-285`：整段流结束后才 `saveMessage({role:'assistant'})`
- `software/src/server/ai.ts:290-292`：`catch { if (streamOpts.signal.aborted) return; … }` → 中止时**不写回复、不写错误**
- `software/src/client/pages/StudioPage.tsx:329-333`：`stopStreaming()` = `abortRef.current?.abort()` + `setStreamText('')` → 前端也清空

**用户影响**
写正文时 AI 已经开始吐字，用户觉得跑偏了点停止 —— 已经写出来的三百字当场消失，历史里只剩自己那句提问（下次进这一章还会看到这条无回答的提问，污染上下文）。用户的直觉是「停止=停在这里，把已有的给我」，现在的行为是「停止=这次白跑」。这是最容易被用户骂的一条。

**建议方向**
1. 服务端在 abort 分支把已累积的 `sent` / `result.text` 落库为 assistant 消息，并加 `truncated` 标记（新列或 `source` 字段）；
2. 前端 `stopStreaming` 不清空 `streamText`，改为保留并 toast「已停止，保留 N 字，可插入正文 / 丢弃」；
3. `listMessages` 过滤或弱化 truncated 消息的上下文注入权重；
4. 验收：流式过程中停止 → 刷新页面 → 该段文字仍在，且标记「已中止」。

---

#### P0-3 作品不存在时，三个页面永久停在「正在打开…」，无任何出路

**证据**
- `software/src/client/pages/StudioPage.tsx:65-88`：`api.project(id).then(...).catch(() => toast('…'))` —— catch 里没有 `setLoading(false)` / 错误态；`:408` 渲染条件 `if (loading || !project) return <div className="loading-screen">正在打开写作台…</div>`
- `software/src/client/pages/OutlinePage.tsx:24-30`（无 catch）与 `:152`（同样加载条件）
- `software/src/client/pages/CodexPage.tsx:27-33`（无 catch）与 `:105`
- `software/src/client/pages/ScreenplayPage.tsx:26-34`：更糟——id 不是剧本时**静默换成库里第一个剧本作品**

**用户影响**
删掉作品后，浏览器历史 / 收藏 / 桌面端上次打开的路由仍指向旧 id：点进去就永远转圈，只能手动改地址或重启；剧本页则会打开**别人的作品**，用户可能在错误的作品里改场景、写正文。

**建议方向**
1. 三个页面统一 `try/catch` → `setError('作品不存在或已被删除')` + 「返回作品库」按钮 + 「新建作品」；
2. `App.tsx` 增加路由级 404（`/studio/:projectId` 校验不存在时重定向 + toast）；
3. ScreenplayPage 删掉静默 fallback，明确提示「这不是剧本作品，是否转为剧本？」；
4. 补 E2E：删除作品后直接访问旧 URL。

---

### P1 —— 高频路径上的「不人性化 / 流程不通」，建议本轮至少修 4 条

---

#### P1-4 编辑器撤销失效：AI 插入后 ⌘Z 无反应，且没有 ⌘S

**证据**
- 四处手动重写 DOM：`StudioPage.tsx:303`（替换选区）、`:318`（回滚版本）、`:360`（应用企划）、`:374`（AI 插入）
- `ChapterEditor.tsx:28-34`：只在 `lastId.current !== chapter.id` 时同步 innerHTML，其余靠调用方硬写
- 无自定义 undo 栈；`SettingsPage.tsx:309` 的快捷键表宣称「⌘S 保存当前章节」「G L 返回作品库」——**代码里不存在**（StudioPage 只有 `⌘↵` 发送，`:678`）

**用户影响**
AI 插了 800 字，想撤销 → 按 ⌘Z 什么都不会发生（`innerHTML =` 会把原生撤销栈清空）；只能去版本面板找回，而版本面板在 AI 动作之外根本没有记录（P1-6）。用户对编辑器的信任一次就没了。设置页还明确写着有 ⌘S，属于「文档骗人」。

**建议方向**
1. 编辑器改为「受控 + 最小 diff」：内容变化时只 patch 变化的段落节点，不全量赋值；
2. 或实现字符串级 undo 栈（`{content, selectionStart}` 快照，栈深 100），绑定 ⌘Z / ⇧⌘Z / ⌘Y；
3. 真正实现 ⌘S（立即 `saveNow()`）；做不到就把设置页那两行删掉；
4. AI 插入/替换前已打快照（现有逻辑）→ 把快照接到「撤销」而不是只放在版本面板；
5. 验收：Playwright 里 AI 插入后按 Meta+Z，正文回到插入前。

---

#### P1-5 关窗/刷新会丢最后 800ms 的输入，Electron 关窗直接退出

**证据**
- `StudioPage.tsx:164-169` 防抖 800ms；`:90-98` 的 flush 只在**路由卸载**时触发（依赖 `[projectId]`）
- 无 `beforeunload`、无 `visibilitychange`、无 `sendBeacon` / `keepalive`
- `desktop/main.cjs:296-298`：`window-all-closed` → `app.quit()`（macOS 上关窗即退出进程）

**用户影响**
打完最后一句、习惯性按 ⌘W 或点红点 → 最后一次防抖还没发出去，进程已退出。用户下次打开发现少了一段，且没有任何「未保存」提醒。写作用户对丢字是零容忍的。

**建议方向**
1. 编辑器加 `beforeunload` + `visibilitychange === 'hidden'` 时同步 flush；
2. flush 用 `fetch(..., {keepalive: true})` 或 `navigator.sendBeacon`；
3. 主进程 `window.on('close')` 先 `preventDefault`，通过 IPC 让渲染进程 flush 后再 `destroy()`；macOS 遵循 `window-all-closed` 不 quit 的惯例；
4. 加 ⌘S（与 P1-4 合并做）。

---

#### P1-6 「版本回退」形同虚设：只有 AI 动作才有快照

**证据**
- `repository.ts:191-208`：`updateChapter` 只更新 chapters + projects.updated_at + 重算字数，**不写 chapter_versions**
- `StudioPage.tsx:293-309`（改写前后）、`:368-378`（插入前后）是唯一自动建版本的时机
- `StudioPage.tsx:114-124`：`refreshVersions` 失败被静默吞掉（注释「version history is non-critical」）
- 版本回滚是直接重写 `editorRef.current.innerHTML`（`:318`），不产生「回滚前」快照，误点回滚无法撤销

**用户影响**
用户手写 5000 字、反复自动保存覆盖，版本面板永远是空的；只有「AI 改写过」的章节才有历史。这直接把「版本回退」这一卖点废掉。加上 P1-4 撤销失效，用户误删一段就只能干瞪眼。

**建议方向**
1. 保存时按策略快照：距上次快照 > 5 分钟且 `words` 变化 > 50 才写一条，避免每 800ms 一条；
2. 保留最近 N 条（如 30）+ 手动「打标记」按钮（命名版本）；
3. 版本列表展示 `source`、字数差、时间，支持并排 diff；回滚前自动存一条当前版本；
4. 失败不再静默：至少 toast 一次「版本历史暂时不可用」。

---

#### P1-7 新建作品时取消 AI 企划 = 取消无效，还会被拽进新作品

**证据**
- `NewProjectModal.tsx:35-67`：`create()` 先 `POST /projects`，再 `await api.planProject(id)`（服务端 `index.ts:88`，最长 90s）
- `:30`：Esc 直接 `onClose()`；`:105` 取消按钮在企划中仍可点 → 但请求不可中止
- `:60-61`：`create()` 完成后无条件 `navigate('/studio/' + id)` —— 即使弹窗已被关闭

**用户影响**
用户等 30 秒不耐烦 → 按 Esc 以为取消了 → 其实作品已建好，而且页面会被突然跳到写作台；如果他接着又新建一次，就多出两本空作品（再叠加 P0-1 的删除崩溃风险）。90 秒没有任何进度与「取消这次企划」的出口，也是典型的「不人性化」。

**建议方向**
1. `AbortController` 贯穿 plan 请求；取消时 abort + 不 navigate；
2. 把企划改成「后台任务」：立刻进写作台，右栏显示「企划生成中…（可离开）」，完成后 toast + 一键应用；
3. 服务端 plan 增加超时（如 45s）与「部分结果」返回；
4. 取消时若作品已创建，保留它并在作品库标「待企划」，而不是塞给用户一个跳转。

---

#### P1-8 章节 / 人物 / 场次 / 分镜 / 伏笔 —— 全都删不掉

**证据**
- 全仓 DELETE 只有两条：`index.ts:120`（`DELETE /api/projects/:id`）、`index.ts:183`（`DELETE /api/beats/:id`）
- `CodexPage.tsx:112`（新增人物）/ `:170`（编辑人物）——没有删除按钮；伏笔 `:191-203` 同
- `OutlinePage.tsx:125-145`：只能 `addBeat`；`StudioPage` 无删章入口
- `ScreenplayPage`：无删场次、无删分镜
- `software/src/client/api.ts` 的 25 个方法里没有 deleteChapter / deleteCharacter / deleteScene / deleteShot / deleteForeshadow

**用户影响**
写废了一章、AI 企划生成了 8 个没用的人物、场次建错——都只能留着。用户的解法是「新建一本作品重来」，于是越堆越多，最终触发 P0-1。这是「流程不通」里最直观、最常被抱怨的一条。

**建议方向**
1. 补 `DELETE /api/chapters|characters|scenes|shots|foreshadows/:id`（CASCADE 已就绪）；
2. 章节删除后重排 `sort_order`，并处理「删的是当前章」→ 切到相邻章 / 空态；
3. UI 用应用内二次确认（不用 `window.confirm`），危险操作给 5 秒撤销；
4. 删除人物前提示引用它的节拍数量；
5. 补 API 测试用例。

---

#### P1-9 分镜「生成」第二次点了没反应，也无法重新生成

**证据**
- `ScreenplayPage.tsx:92-107`：已有镜头时 `generateShots` 只切到分镜板，按钮文案变「查看分镜」
- `repository.generateShotsForScene`：已有 shots 直接返回旧数据（不重新生成）
- 无 `DELETE /api/shots`，也无「重新生成」参数

**用户影响**
第一次生成的 6 个镜头不理想，用户再点一次 —— 什么都不发生（连 toast 都没有），只能以为按钮坏了。分镜功能实际上是一次性的。

**建议方向**
1. 按钮分「生成 / 重新生成（覆盖前确认）」；重新生成先删后建（事务内）；
2. 支持逐条编辑、删除、手动新增镜头（`POST /projects/:id/shots` 已有）；
3. 生成中显示 loading 与失败原因（模型没配 / 场次为空）。

---

#### P1-10 导出只有「整本」，没有单章、没有进度、没有失败提示

**证据**
- `StudioPage.tsx:443-444`：两个裸 `<a href>` 指向 `api.exportProjectDocx` / `api.exportProject`
- `index.ts:308-326`：只有整本 docx / md，无 `?chapter=` 之类参数
- 空作品也照样导出（实测 md 仅 77 字节）

**用户影响**
作者改完一章想发给编辑，只能导出整本 30 万字；导出失败（磁盘满、浏览器拦截下载）没有任何反馈；空作品导出一个空文件，用户以为功能坏了。

**建议方向**
1. 导出菜单：整本 / 当前章 / 勾选章节 / 仅人物设定；
2. 改为 `fetch` + Blob 下载，带 loading 与失败 toast（顺便能显示「正在生成 docx…」）；
3. 空内容时禁止导出并提示；
4. 记住上次导出格式。

---

#### P1-11 AI 消息串章 + 「重新生成」不清理旧回答

**证据**
- `repository.ts:407-410`：`WHERE project_id = ? AND (chapter_id = ? OR chapter_id IS NULL)` —— 项目级消息出现在**每一章**
- `StudioPage.tsx:256-264`：`regenerate` 只从前端 state 过滤掉旧 assistant 消息，然后 `sendPrompt(previousUser.content, true)`
- `ai.ts:244`：`regenerate` 时跳过保存 user，但 assistant 每次都新增一条

**用户影响**
第 3 章的历史里冒出第 1 章的项目级提问；「重新生成」后刷新页面，新旧两条回答并排出现，用户分不清哪条是最终的。

**建议方向**
1. 记忆卡按章节分组，项目级消息单独折叠成「作品级对话」；
2. regenerate 带上 `replaceMessageId`，服务端先删该 assistant 消息再写新的；
3. 或给 `ai_messages` 加 `superseded_by`，保留但默认隐藏。

---

### P2 —— 体验与信任，可与 P1 一起排期

---

#### P2-12 首次启动是硬门槛：没有 API Key 就看不到任何界面

**证据**
- `OnboardingPage.tsx:11`：`providers.filter(p => p.id !== 'mock')` —— 唯一不需要 Key 的供应商被过滤掉
- `:33`：`canFinish` 要求 name + model + （非 ollama 时）apiKey
- `:15`：`providerId` 默认硬编码 `'deepseek'`
- `App.tsx:31`：`onboarding.completed === false` 时**所有路由**都渲染 OnboardingPage（连 `/settings` 都进不去）

**用户影响**
想先看看界面、先写两笔再配 Key 的用户被挡死；没有 Key 的人连「这个 App 长什么样」都不知道，直接卸载。而内置的 mock 供应商本来就是为了这个场景准备的。

**建议方向**
1. onboarding 只要求笔名，供应商/模型可跳过（标「稍后配置」）；
2. 提供「先用本地演示模型」，把 mock 放进列表并注明「离线示例，不需要 Key」；
3. 允许 onboarding 期间进入 `/settings`。

---

#### P2-13 桌面端不像桌面应用：没有写作菜单、不记窗口、服务挂了不自愈

**证据**
- `desktop/main.cjs:183-227`：菜单只有 App / 编辑 / 视图（含 `toggleDevTools`，生产可用）/ 窗口，**没有「保存 / 导出 / 最近打开」**
- `:230-234`：固定 1480×940，最小 1180×760，不记忆尺寸与位置
- `:296-298`：`window-all-closed → app.quit()`（macOS 关闭即退出）
- `:98-103`：`webContents.send('server-exited')` —— 渲染进程没有任何 preload/IPC 监听（工程内无 preload 文件），**死代码**

**用户影响**
长文写作场景却缺 ⌘S 菜单项与「最近打开」；小屏笔记本上 1480 宽窗口超出屏幕；本地服务崩了界面只会在下一次请求时抛「无法连接本地服务」，且不会自动重启，用户只能强退重开。

**建议方向**
1. 加 preload + IPC：`server-exited` 时弹「重试 / 打开日志 / 退出」并自动重启一次（限 2 次）；
2. 窗口尺寸位置写入本地配置，启动恢复；
3. 菜单加「文件 → 保存 / 导出 / 最近打开」，`toggleDevTools` 只在 `!app.isPackaged` 时可见；
4. macOS 关闭窗口不退出（`window-all-closed` 里判断 `process.platform !== 'darwin'`）。

---

#### P2-14 页面里有大量写死的「假数据」，看起来像分析结论

**证据**
- `LibraryPage.tsx:157`：继续写作卡的引文是固定的一句「门外的男人没有撑伞…」；`:190-192` 进度条屏 1%；`:46-47` `totalGoal || 1`
- `ScreenplayPage.tsx:161` 剧本进度 38% 写死；`:211-213`「本场分析 4.5 / 4.0 / 3.5」与「本场功能 / 潜台词」全写死
- `OutlinePage.tsx:171` 第二幕永远高亮；`:177` 人物弧光宽度 `[64,47,78]%`；`:193-203` 情绪张力曲线是固定 SVG path + 固定刻度 第1/7/12/18/24 章
- `CodexPage.tsx:165`「出场 N 章」用章节总数冒充；「视角 主视角」写死
- `SettingsPage.tsx:211` 版本号 `v0.1 · 全栈版`；`:313` 数据路径 `data/studio.db`（桌面端实际在 userData）+ 存储条 22% 写死
- `StudioPage.tsx:487-488` `Math.max(1, …)` → 0 字也显示 1%；`goalWords = 0` 时是 NaN%

**用户影响**
这是**信任问题**，比缺功能更伤：用户真会拿「本场分析 4.5」判断自己这场写得行不行，而那个数字跟他的剧本毫无关系。第一次发现是假的，之后所有检查结果（包括 `localChecks` 的真空检）都会被怀疑。

**建议方向**
1. 能算的接真实数据（进度、字数、出场章节数、存储占用）；
2. 算不了的**明确标注「示例 / 占位」**或直接删掉；
3. 版本号从 `package.json` 注入。

---

#### P2-15 大纲编辑的三个高频动作都卡住

**证据**
- `OutlinePage.tsx:125-145`：没有「新增幕」入口；新增节拍默认塞进 `acts[1]`（第二幕）
- `:32-41`：切换场景时 `setDraft` 直接覆盖未保存的编辑，无脏标记、无提示
- `:92-95`：跨幕拖拽明确不支持（toast「先在同一幕内拖动；跨幕移动下一步再做」）
- `:217`：修改场景必须手动点「保存场景」

**用户影响**
调结构最常用的三件事（加一幕、把节拍挪到别的幕、改完场景直接切走）全部有坑，其中「切走丢编辑」是静默数据丢失。

**建议方向**
1. 幕支持新增/重命名/删除（删除时提示连带节拍）；
2. 场景编辑器改防抖自动保存或离开前确认；
3. 支持跨幕拖拽（`PATCH /projects/:id/outline/reorder` 已存在，只需带 `actId`）。

---

## 3. 相关文件与调用链（改代码前先看这张表）

| 需求 | 调用链 |
| --- | --- |
| 保存正文 | `StudioPage.tsx:146-169` → `api.updateChapter` → `index.ts:158` → `repository.ts:191-208`（不建版本） |
| 切章 | `StudioPage.tsx:171-181` → flush → `GET /projects/:id` |
| 版本 | `StudioPage.tsx:114-124`（读）/ `:293-327`（写/回滚）→ `index.ts:137-156` |
| AI 流式 | `StudioPage.tsx:200-254` → `api.streamChat`（`api.ts:100-136`）→ `index.ts:328` → `ai.ts:228-296` |
| AI 企划 | `NewProjectModal.tsx:48` / `StudioPage.tsx:343` / `PlanReviewModal.tsx:52` → `index.ts:88` → `plan.ts`；apply 走 `repository.ts:679-708`（**先删后写，覆盖式**） |
| 启动 | `main.cjs:84-95` spawn → `index.ts:49 migrate()` → `db.ts:166-170 seed` |
| 导出 | `StudioPage.tsx:443-444` → `index.ts:308-326` → `docx.ts:13-79` |

---

## 4. 关键依赖 / 环境现状

- 本机：Node v26.11.1，pnpm 10.34.7，`software/node_modules` 已安装（tsx / vite / playwright 可用）。
- `software/data/` 目录当前**只有 `.secret`，没有 `studio.db`** —— 该克隆还没跑过服务，任何「删库重来」的验证都不会碰到真实数据。
- 数据库无迁移框架（`db.ts:15-165` 全是 `CREATE TABLE IF NOT EXISTS`），**任何 schema 改动都必须同时处理老库**（`ALTER TABLE` 或版本号表）。
- 三层测试都可跑，但覆盖缺口明确：删空作品重启、删章节/人物/场次、导出边界、服务崩溃时前端表现，**没有用例**。
- 桌面端打包未签名（CI 默认 `CSC_IDENTITY_AUTO_DISCOVERY=false`），macOS 自动更新实际不可用，改 updater 逻辑前先确认这一点。

---

## 5. 存量约束 / 历史坑（实现者必读）

1. **`desktop/server.cjs` 是构建产物**：改服务端代码后不跑 `pnpm desktop:prepare`，桌面端跑的还是旧 bundle。验证方法：看文件时间戳。
2. **两个 package.json / 两套 lockfile**：根目录没有 workspace 配置，`pnpm install` 不装 `software/`。
3. **端口写死**：8787 / 5180（`strictPort`）。起第二个实例会失败——本地验证多实例必须显式传 `PORT` + `PW_DATA_DIR`（测试脚本就是这么做的）。
4. **dev 与 prod 入口不同**：dev 走 5180（vite），prod 走 8787（express 托管 dist）。别拿 8787 当 dev 用。
5. **保存的是 `innerText`**（`ChapterEditor.tsx:52-54`）：所有富文本（加粗/斜体/引用/列表）都不持久化。想加格式化必须连同存储格式一起改，否则刷新即丢。
6. **`settings` 是单行 JSON（key='app'）**：加字段只需改 `AppSettings` 类型 + 默认值合并，但要考虑老库缺字段（`getSettings` 是否做了 deep merge，需实现者确认）。
7. **`applyProjectPlan` 是破坏性的**：`repository.ts:685-687` 先 `DELETE` 三类数据。任何「再企划一次」的入口都必须先提示会覆盖。
8. **`listMessages` 的 `chapter_id IS NULL` 语义**：项目级消息会出现在每一章，改 AI 记忆展示时别踩。
9. **无 ErrorBoundary**（`main.tsx`）：任何渲染异常直接白屏，调试时先看 console 而不是怀疑网络。

---

## 6. 给 architect / 实现者的约束与建议

### 6.1 本轮建议的改动边界

- **必修（P0）**：P0-1（崩溃）、P0-2（停止丢字）、P0-3（404 死路）。三条都不大，但都是「用户会骂」的量级。
- **强烈建议同轮做**：P1-8（删除缺失）、P1-7（取消不中止）、P1-6（版本快照）。这三条构成「写得下去 / 退得回来」的闭环。
- **可以下一轮**：P1-4 / P1-5 需要动编辑器架构（受控 + diff + undo 栈），改动面最大，建议单独一轮并配 Playwright 用例；P2 全部延后。

### 6.2 硬约束

1. 不改供应商协议层（`ai.ts` 的四类适配）；P0-2 只改「落库时机」，不动流式解析。
2. 尽量不改表结构解决 P0-1（用「库文件是否存在」判断首启即可，零迁移成本）；若必须加列（P0-2 的 truncated），要同时写 `ALTER TABLE ... ADD COLUMN` 的兼容逻辑。
3. 所有前端改动必须用 Playwright 真点一遍（本项目反复踩：`import` 漏了导致 `ReferenceError` 被 Promise 吞掉、模板没绑状态变量、`request` 返回 `{data,error}` 忘记解构）。构建通过不代表能用。
4. 新增删除接口要连 CASCADE 一起验证：删章节后 `chapter_versions` 应一起消失，删作品后 `shots` 应一起消失。
5. 破坏性确认别再用 `window.confirm`（桌面端体验差且阻塞）；用应用内确认弹窗 + 5 秒撤销。

### 6.3 建议的验收口径（可直接写进 SPEC）

| 编号 | 验收动作 | 期望 |
| --- | --- | --- |
| A1 | 删光作品 → 重启服务 | `/api/health` 200；作品库空态；onboarding 不被重置 |
| A2 | 流式中途点停止 | 已生成文字保留在界面与 `ai_messages`，标「已中止」；刷新后仍在 |
| A3 | 删除作品后访问旧 URL | 显示「作品不存在 + 返回作品库」，不转圈 |
| A4 | AI 插入 500 字后 ⌘Z | 正文回到插入前 |
| A5 | 输入后立刻 ⌘W | 重开应用，文字仍在 |
| A6 | 手写 10 分钟后看版本面板 | 至少 1 条自动快照，可对比、可回滚 |
| A7 | 新建作品 → Esc 取消企划 | 不被导航；作品库可见「待企划」作品 |
| A8 | 删除章节 / 人物 / 场次 / 分镜 | 均成功，列表刷新正确，引用提示到位 |
| A9 | 重新生成分镜 | 覆盖前有确认，生成后数量正确 |
| A10 | 导出当前章 | 只含该章；失败有 toast |

---

## 7. 不建议本轮做（避免范围爆炸）

- 编辑器换 TipTap / ProseMirror 类富文本框架：收益大但牵动保存格式、版本 diff、一致性测试，应单独立项。
- 数据库迁移框架（Drizzle / Kysely）：当前单用户、单库文件，收益低于成本。
- 多窗口 / 多作品并行编辑：`AppContext` 是全局单例，改动面巨大。
- 云同步 / 账号体系：与「本地优先」定位冲突，不在本轮范围。
