# Inkquay / 私家写手 · 第二轮体验审计（t1）

- 基线：本地 `main` `4a43f42`（2026-10-27 11:18:26 +0800），**未 push、未改业务代码**。
- 审计方式：只读代码走查（服务端 `software/src/server/*`、渲染层 `software/src/client/*`、桌面壳 `desktop/*`、测试脚本 `software/scripts/*`）+ 已有 E2E 覆盖比对；未运行写操作，未改任何仓库文件（本文件除外）。
- 上一轮产物：`team/优化项目-查漏补缺-004044/`（PLAN/SPEC/TEST/RETRO 等），本文件用「上一轮已修 / 仍存在 / 新发现」标注继承关系。

---

## 0. 结论摘要

第二轮的真实问题已经从「会崩、会丢字」转向**「说了但没做」**与**「做了但没做完」**两类：

| 类别 | 数量 | 代表 |
| --- | --- | --- |
| blocker（会造成错误认知或数据不可恢复） | 2 | 未配置模型时静默用 mock 生成正文；作品删除是硬删除 |
| high（明显误导 / 功能死锁） | 8 | 记忆卡声称含伏笔但 prompt 不含；大纲/剧本页硬编码假数据；剧本导出被 exportScope 卡死；非写作台关窗卡 5 秒 |
| medium | 12 | 格式按钮保存后丢失；回收站空态=加载态；只有单本备份；默认模型被弹窗保存覆盖；无测试连接 |
| low | 12 | 死代码、写死百分比、硬编码「下午好」、滑块无 debounce |

一句话总结：**上一轮修的是「能不能用」，这一轮要修的是「说的和做的是不是一回事」。**

---

## 1. 上一轮已修（本轮复验通过，勿重复修）

| # | 事项 | 证据 | 复验结论 |
| --- | --- | --- | --- |
| F-1 | 停止生成时已生成内容不再丢 | `software/src/server/ai.ts:302-320`（catch 分支 `if (partial.trim())` 落库 `status:'aborted'`），`StudioPage.tsx:977` 显示「已停止 · 部分内容已保存」 | 通过 |
| F-2 | 切换章节前先保存，失败不切 | `StudioPage.tsx:263-277`（`clearTimeout` → `await saveNow()` → `if (!saved) return`） | 通过 |
| F-3 | 作品加载失败可重试 | `StudioPage.tsx:716-727`（`loadError` + `setLoadNonce` 重试 + 返回书房） | 通过 |
| F-4 | 桌面端关窗先 flush 再关 | `desktop/main.cjs:33-52` + `StudioPage.tsx:223-241`（`onCloseRequest` → `saveNow()` → `readyToClose`/`cancelClose`） | 通过（**但只在写作台生效**，见 H-1） |
| F-5 | 归档作品在「归档」筛选可见、可移出 | `LibraryPage.tsx:231`、`ProjectSettingsModal.tsx:44-46`，`ui-test.mjs:271,278` | 通过（入口仍深，见 D-4） |
| F-6 | 版本对比后恢复会关闭对比弹窗 | `StudioPage.tsx:458`，`ui-test.mjs:134` | 通过 |
| F-7 | 回收站恢复回原目录位置 | `StudioPage.tsx:611-634`，`ui-test.mjs:149-152` | 通过 |

---

## 2. blocker / high 级问题

### B-1【blocker / 新发现】未配置模型时**静默回退到 mock 演示模型**生成正文

- 证据：`software/src/server/ai.ts:239-241`
  ```ts
  const providerId = opts.providerId || settings.defaultModel?.providerId || 'mock';
  const modelId = opts.modelId || settings.defaultModel?.modelId || 'mock-writer';
  ```
  客户端把可能为 undefined 的默认模型原样上传：`StudioPage.tsx:332-333`（`providerId: settings.defaultModel?.providerId`）。
- 与文案直接冲突：`SettingsPage.tsx:292` 明确写「没有配置 Key 时会明确报错，**不会静默回退到演示模型**」。
- 复现：设置 → 模型与供应商 → 停用当前默认供应商（或无默认模型时直接进写作台）→ 点「AI 写第一段」→ 界面正常流出中文正文，消息 `providerId` 落库为 `mock`，可一键「插入正文」。
- 影响：用户以为是自己花钱的模型写的，实际是内置假文案；一旦插入正文，等于把演示内容当成作品。**这是本轮最需要先修的信任问题。**
- 建议方向：`providerId` 缺失或指向不可用供应商时直接返回明确错误；`mock` 只在显式选择「演示模型」时可用。

### B-2【blocker / 新发现】作品删除是硬删除，无回收站、无二次输入确认

- 证据：`ProjectSettingsModal.tsx:48-60`（一次 `window.confirm` 后 `api.deleteProject`）、`software/src/server/index.ts:131-134`、`repository.ts` 的 `deleteProject` 级联删除章节/设定/剧本章节/分镜/伏笔/AI 对话。
- 对比：章节删除有回收站（`index.ts:180-196`、`StudioPage.tsx:1067-1090`），作品删除什么都没有。
- 影响：一本书 + 全部历史版本一次点击永久消失；章节级已做安全网、作品级反而是最危险的一步。
- 建议方向：作品级回收站（软删除 + `deleted_at`），或至少要求输入书名确认。

### H-1【high / 新发现】设置页「长期记忆」与真实 prompt 不符：**伏笔根本没进上下文**

- 证据：`CodexPage.tsx:156` 写「人物、秘密与关系已经进入 AI 的写作上下文」+「已同步」；`StudioPage.tsx:951-958` 记忆卡列出「伏笔 N」chip；但 `software/src/server/repository.ts:436-450` `buildWritingContext()` 只拼：标题/类型/题材/偏好/简介/当前章尾 4000 字/人物前 8 位（`name/role/description/secret`）/大纲前 12 条/最近 3 章尾 500 字——**没有 foreshadows，没有 relations，没有 tags/quote**。
- 影响：作者按 UI 提示「伏笔会被自动引用」去埋线，AI 完全看不见；三项里两项是空承诺。
- 建议方向：要么把 foreshadows/relations 真正拼进 prompt（并给 token 预算），要么把文案改成事实。

### H-2【high / 新发现】大纲页核心图表是**硬编码假数据**

- 证据（`software/src/pages/…` 实为 `software/src/client/pages/OutlinePage.tsx`）：
  - `:197` 副标题「按章节场景数量与状态估算」
  - `:204-207` 张力曲线是写死的 SVG `path d="M0,168 C60,158 90,132 …"`，x 轴刻度写死「第 1 / 7 / 12 / 18 / 24 章」
  - `:172` 结构卡恒为「三幕式」+ 恒打勾
  - `:177` 幕列表 `i === 1 ? ' is-active' : ''` → **永远高亮第二幕**
  - `:183` 人物弧光 `width: ${[64, 47, 78][i]}%`、标记点 `left: ${[38, 24, 55][i]}%`
- 影响：作者以为自己看到的是作品结构分析；实际是设计稿残留。与 H-1 同属「假数据」家族，但这里连数据源都没有。

### H-3【high / 新发现】剧本页「本场分析」是硬编码分数

- 证据：`ScreenplayPage.tsx:243` `<strong>4.5</strong>张力 / 4.0 节奏 / 3.5 信息`；同区块的功能段落、潜台词、`ai-tip` 全是固定文案，且带「本地」标记暗示是分析结果。
- 影响：剧作者会把 4.5 当成工具对自己的评价。

### H-4【high / 新发现】`exportScope` 跨作品残留导致**剧本无法导出**

- 证据：`StudioPage.tsx:766-772` 只对非剧本显示「全书/本章」下拉；`StudioPage.tsx:654-660` `exportBook()` 在 `exportScope === 'chapter'` 且无 `activeChapter` 时直接 toast 返回。
- 关键机制：从小说切到剧本走的是同一路由 `/project/:projectId`（`Rail` 导航只换参数），`StudioPage` **不卸载**，`exportScope` 状态保留 → 剧本页隐藏了下拉，用户无法切回「全书」→ 导出按钮永远弹「当前没有可导出的章节」。
- 影响：剧本作品的 Word/Markdown 导出完全不可用（重启应用才恢复）。
- 建议方向：`exportScope` 用 `useMemo` 按项目类型收敛，或在 `projectId`/类型变化时重置。

### H-5【high / 新发现】非写作台页面关闭窗口**必定卡 5 秒**

- 证据：`desktop/main.cjs:33-40` 关窗时 `send('inkquay:request-close')` 并起 5000ms 兜底；渲染层只有 `StudioPage.tsx:223-241` 注册了 `window.inkquayDesktop.onCloseRequest`（全仓库仅此一处，`desktop/preload.cjs:4-14` 暴露）。
- 复现：停在作品库 / 大纲 / 设定 / 剧本 / 设置页，点窗口红灯 → 界面冻结 5 秒后关闭。
- 影响：每次非写作台退出都像卡死；用户会以为应用挂了。
- 建议方向：在 `AppShell` 层统一注册握手（无待保存内容时立即 `readyToClose`），StudioPage 只负责自己的 flush。

### H-6【high / 新发现】`server-exited` 事件无人接收 → 本地服务崩溃时白屏

- 证据：`desktop/main.cjs:131-134` 在子进程退出时 `webContents.send('server-exited', code)`；渲染层全仓库无 `server-exited` 监听（`grep` 只命中打包产物）。
- 影响：服务崩了之后窗口保持原页面，后续所有操作静默失败，用户不知道该重启。

### H-7【medium-high / 新发现】供应商弹窗保存会**静默覆盖已选的默认模型**

- 证据：`SettingsPage.tsx:47,130,148-150`
  ```ts
  setProviderDefault(provider.defaultModel || provider.enabledModels[0] || …);   // 130
  if (providerEnabled && result.provider.configured && settings.defaultModel?.providerId === editing.id)
    await updateSettings({ defaultModel: { providerId: editing.id, modelId: providerDefault } });  // 148-150
  ```
  弹窗里**没有任何「设为默认模型」控件**，`providerDefault` 完全由代码推断。
- 复现：设置 → 生成参数 → 默认模型选「DeepSeek · deepseek-reasoner」（非第一个）→ 回到供应商卡片打开 DeepSeek →「保存配置」→ 默认模型被改回 `enabledModels[0]`。
- 影响：用户选好的模型被悄悄换掉，下一轮共笔质量莫名下降。

---

## 3. 分模块问题清单

### 3.1 新建作品 / AI 企划（NewProjectModal、PlanReviewModal）

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| P-1 | medium | 新发现 | 首跑用户勾着「创建后让 AI 先做企划」，但没配 Key 时**必然失败**：创建前不检查供应商可用性，失败后作品已建、只能点「先进写作台」 | `NewProjectModal.tsx:117-118,86-94`；`index.ts:99-108` 502 |
| P-2 | medium | 新发现 | 「AI 企划这一本」只在**空章 + 空大纲 + 空人物**时出现；已有正文（哪怕自己写了一段）就再也没有企划入口 | `StudioPage.tsx:880-887` |
| P-3 | medium | 新发现 | 剧本类型完全没有 AI 起稿路径：新建时 `aiPlan` 被禁用，剧本页无企划入口，只能手工加场次再「生成分镜」 | `NewProjectModal.tsx:117,166`；`ScreenplayPage.tsx` 无 plan 调用 |
| P-4 | low | 新发现 | 企划弹窗「重新生成」会重置所有勾选，无提示 | `PlanReviewModal.tsx:58-61` |
| P-5 | low | 新发现 | 取消企划后提示「作品已经创建」但两类文案不一致（关闭窗 vs 取消按钮），且都会留下一条 0 字章节 | `NewProjectModal.tsx:56-71` |

### 3.2 写作与 AI 共笔（StudioPage、ChapterEditor、ai.ts）

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| W-1 | high | 新发现 | 工具栏「加粗/斜体/引用/列表」产生的富文本**重新加载后全部丢失**：保存走 `innerText`（纯文本），重载走 `toHtml`（只产出 `<p>`） | `StudioPage.tsx:831-835`；`ChapterEditor.tsx:12-15,53-55` |
| W-2 | medium | 新发现 | 删除当前章节时未清除待触发的 800ms 自动保存定时器，定时器随后 `PATCH` 已删章节 → 404「章节不存在」toast + 状态回到「有未保存修改」 | `StudioPage.tsx:263` 与 `558-598` |
| W-3 | medium | 新发现 | 回收站弹窗**先打开再请求**，无 loading；请求慢或失败时展示「回收站是空的」，与被清空无法区分 | `StudioPage.tsx:600-609,1086` |
| W-4 | medium | 新发现 | 每次 AI 插入/改写各写 **2 条**快照（前/后），每章上限 40 条 → 10 次改写就挤掉全部早期版本 | `StudioPage.tsx:432,439,549,554`；`:1049` 文案 |
| W-5 | low | 新发现 | 恢复历史版本后不重算 `project.totalWords`，顶栏字数保持旧值直到刷新 | `StudioPage.tsx:445-466` |
| W-6 | low | 新发现 | `stopped` 状态恒为 false，`ghost-block` 的「已停止，内容可插入」分支不可达（死代码） | `StudioPage.tsx:484,901` |
| W-7 | low | 新发现 | 同一段流式内容同时渲染在「AI 建议续写」卡片和聊天区，视觉重复 | `StudioPage.tsx:902,995` |
| W-8 | low | 新发现 | 停止生成时本地插入一条 `stopped-<ts>` 消息，服务端也落库一条；刷新前若继续对话可见两条同内容 | `StudioPage.tsx:468-486`；`ai.ts:302-320` |
| W-9 | low | 新发现 | 对话只能「刷新/重新生成」，不能删除单条或清空本章对话 | `StudioPage.tsx:927` |

### 3.3 版本 / 回收站 / 作品生命周期

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| V-1 | blocker | 新发现 | 作品硬删除（见 B-2） | `ProjectSettingsModal.tsx:48-60` |
| V-2 | low | 仍存在 | 回收站无「清空」、无自动过期；作品级没有回收站粒度 | `StudioPage.tsx:1067-1090` |
| V-3 | low | 新发现 | 场景/分镜/人物/伏笔均为硬删除 + `window.confirm`，与章节回收站策略不一致 | `ScreenplayPage.tsx`（场次/镜头删除）、`CodexPage.tsx`（人物/伏笔删除） |

### 3.4 导出 / 备份 / 归档

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| E-1 | high | 新发现 | 剧本导出被 `exportScope` 卡死（见 H-4） | `StudioPage.tsx:654-660,766-772` |
| E-2 | medium | 新发现 | **只有单本备份，没有全库备份/还原**；换机要逐本导出、逐本导入 | `StudioPage.tsx:675-686`；`LibraryPage.tsx:120-122`；`SettingsPage.tsx:189-199` 仅导出设置 |
| E-3 | medium | 新发现 | 导入无预览、无同名冲突提示，直接把整包建成新作品；大包无进度 | `LibraryPage.tsx:92-104` |
| E-4 | low | 仍存在 | 归档入口藏在「作品设置」弹窗里；且点「归档」会连带保存其它未保存字段并立即关窗 | `LibraryPage.tsx:250`；`ProjectSettingsModal.tsx:26-46,79` |
| E-5 | low | 新发现 | 导出成功后只有 toast，桌面端无法「在文件夹中显示」，用户不知道文件落在 Downloads | `StudioPage.tsx:665-667` |

### 3.5 设置 / 供应商（SettingsPage、OnboardingPage）

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| S-1 | medium | 新发现 | 「数据与隐私」写死的数据库路径与桌面端实际目录不符：UI 说 `data/studio.db` / `software/data/studio.db`，桌面端是 `userData/data/studio.db` | `SettingsPage.tsx:311-312`；`desktop/main.cjs:105-110` |
| S-2 | medium | 新发现 | 首次引导**没有「测试连接」**，Key 写错也能「完成并进入书房」，直到第一次共笔才报错（设置页里有这个能力） | `OnboardingPage.tsx:52-53,84-95`；`SettingsPage.tsx:159-171` |
| S-3 | medium | 新发现 | 停用默认供应商且找不到 fallback 时，`defaultModel` 仍指向已停用供应商 → 写作台显示「选择模型」，叠加 B-1 变成静默 mock | `SettingsPage.tsx:113-116` |
| S-4 | medium | 新发现 | 无「删除供应商」，自定义供应商只增不减；服务端也没有 DELETE 路由 | `SettingsPage.tsx:173-187`；`index.ts` 无 `delete('/api/providers/…')` |
| S-5 | medium | 新发现 | 设置页任意位置按 Esc **直接退出设置并丢弃未保存输入**（供应商弹窗里正在填的 Key 一并丢失），无确认 | `SettingsPage.tsx:54-62` |
| S-6 | low | 新发现 | 生成参数「创造性」滑块每次 `onChange` 都 PATCH 设置（外观那套有 450ms debounce，这里没有） | `SettingsPage.tsx:289` vs `74-81` |
| S-7 | low | 新发现 | 存储卡进度条写死 `22%` | `SettingsPage.tsx:311` |
| S-8 | low | 新发现 | 引导页 `useEffect` 依赖 `provider` 对象，`providers` 刷新会覆盖用户手填的接口地址 | `OnboardingPage.tsx:25-29` |
| S-9 | low | 新发现 | 快捷键页只列 3 条，且与实际行为不符（设置页 Esc 是「退出设置」而非「关闭浮层」） | `SettingsPage.tsx:307` vs `:54-62` |
| S-10 | low | 新发现 | 「下午好」写死，任何时段都显示下午好（引导预览 + 作品库 + 空态） | `OnboardingPage.tsx:92`；`LibraryPage.tsx:137` |

### 3.6 大纲 / 设定（OutlinePage、CodexPage）

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| O-1 | high | 新发现 | 张力曲线 / 三幕卡 / 人物弧光全是硬编码（见 H-2） | `OutlinePage.tsx:172,177,183,197-207` |
| O-2 | medium | 新发现 | 新增场景**只能加进第二幕**（`acts[1] || acts[0]`），且跨幕拖动根本不支持 → 新场景永远进不了第一/三幕 | `OutlinePage.tsx:126-129`；`:94` |
| O-3 | medium | 新发现 | 半成品提示直接暴露给用户：「跨幕移动下一步再做」「下一步可以接 AI 诊断与拖拽排序」 | `OutlinePage.tsx:94,227` |
| O-4 | medium | 新发现 | 设定页假状态：长期记忆 `72%` + 「已同步」（无同步机制）；「AI 已索引 N 位人物、M 条伏笔」（prompt 不含伏笔）；人物「出场 {chapters.length} 章」「视角 主视角」；「AI 写作提示」是固定模板 | `CodexPage.tsx:156,165,197,201` |
| O-5 | low | 新发现 | 设定页左侧导航 `is-active` 写死在「人物」，切到伏笔后仍高亮人物 | `CodexPage.tsx:153` |
| O-6 | low | 新发现 | 人物关系（relations）只读展示，编辑表单没有该字段 → 手工新建的人物永远无关系 | `CodexPage.tsx:219` 区域；`repository.ts:483-505` 支持写入但 UI 无入口 |

### 3.7 剧本（ScreenplayPage）

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| R-1 | high | 新发现 | 「本场分析」硬编码 4.5/4.0/3.5（见 H-3） | `ScreenplayPage.tsx:243-247` |
| R-2 | medium | 新发现 | 剧本正文不可直接编辑，只能开「编辑本场」弹窗；正文渲染把所有块都当 `action`，对白没有独立样式 | `ScreenplayPage.tsx:205-212` |
| R-3 | low | 新发现 | 剧本进度条写死 `38%` | `ScreenplayPage.tsx:193` |
| R-4 | low | 新发现 | 「约 N 分钟」= `scenes.length * 3`，且是个没有 onClick 的按钮 | `ScreenplayPage.tsx:202` |
| R-5 | low | 新发现 | 「生成分镜」无 loading/防重入，网络慢时像没反应 | `ScreenplayPage.tsx` generateShots 调用处 |

### 3.8 桌面端（desktop/main.cjs、preload.cjs）

| # | 严重度 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| D-1 | high | 新发现 | 非写作台关窗卡 5 秒（见 H-5） | `main.cjs:33-40`；仅 `StudioPage.tsx:223-241` 监听 |
| D-2 | high | 新发现 | `server-exited` 无接收方，服务崩溃后白屏无提示（见 H-6） | `main.cjs:131-134` |
| D-3 | low | 新发现 | `freePort()` 探测与 `spawn` 之间存在端口竞态（低概率启动失败，已有 20s 健康检查兜底） | `main.cjs:79-96,117` |
| D-4 | low | 仍存在 | 开发模式下 `PW_STATIC_DIR` 指向 `software/dist`，未构建时只提示「前端由 Vite 提供」，桌面窗口会白屏 | `main.cjs:104-107`、`index.ts:456-458` |

---

## 4. 测试覆盖比对（`software/scripts/*`）

已覆盖（`ui-test.mjs`，仅列关键断言）：
- 引导门禁（`:46-57`）、空书房（`:69`）、企划预览不落库 + 只应用勾选项（`:77-85`）、自动保存（`:94`）、AI 流式（`:99`）、停止不增消息（`:103`）、选区改写（`:126`）、版本列表与恢复后关闭对比（`:129-134`）、回收站恢复（`:149-152`）、主题切换（`:157-168`）、大纲编辑与拖动排序（`:181-200`）、设定编辑（`:203-213`）、剧本正文与分镜（`:223-244`）、归档/取消归档（`:258-278`）、全程浏览器错误为空（`:281`）。
- `api-test.mjs`：引导校验（`:45-69`）、企划预览/应用（`:81-99`）、章节更新与字数（`:106-109`）、版本与回滚（`:111-114`）、场景编辑/重排/删除（`:125-134`）。

**未覆盖（本轮新增风险点，建议补）**：
1. Word / Markdown 导出（含剧本类型与「本章」范围）——正是 E-1 的死锁区。
2. 项目包备份 → 导入 → 数据一致。
3. 桌面端关窗 flush（当前只有代码路径，无脚本验证）。
4. 供应商弹窗「保存配置」对默认模型的影响（H-7）。
5. 未配置模型时的 AI 行为（B-1），现在没有任何断言保护。

---

## 5. 收敛建议（第二轮范围建议）

**建议本轮只做「说的和做的一致」+「不可恢复操作上保险」两件事**，其余硬编码假数据统一按「删掉/改成真实统计」二选一处理，不做新功能：

- P0（必须先修，改完用户体验立刻不同）
  1. B-1 去掉 mock 静默回退，改为明确报错。
  2. B-2 作品删除加软删除/输入书名确认。
  3. H-4 `exportScope` 按项目类型收敛，修剧本导出。
  4. H-1 记忆卡与 prompt 对齐（拼伏笔 + relations，或改文案）。
  5. H-5 关窗握手下沉到 `AppShell`。
- P1（本轮内做掉）
  6. W-1 富文本要么真存 HTML，要么去掉工具栏按钮（不建议保留假格式）。
  7. H-2 / H-3 / O-4 / O-5 假数据：张力曲线与人物弧光改由 `beats/chapters` 真实计算，本场分析改由章节数据计算或直接删除；`72%`、`已同步`、`已索引` 文案改成事实。
  8. H-7 供应商弹窗加「设为默认模型」或保存时不覆盖默认模型。
  9. S-2 引导页加「测试连接」。
  10. S-1 数据页显示真实数据库路径（由服务端下发）。
  11. O-2 新场景可选择幕（或至少加到当前选中幕）。
  12. D-2 接收 `server-exited` 并给出可重试提示。
- P2（可下轮，先记录）
  - E-2 全库备份、E-3 导入预览、W-3 回收站 loading、W-4 快照策略、S-4 删除供应商、S-5 Esc 确认、R-2 剧本正文直接编辑。

**明确不在本轮范围**：跨幕拖拽、剧本 AI 企划、多用户/权限、云同步、自动更新签名（属发版事项，本轮不 push 不发版）。
