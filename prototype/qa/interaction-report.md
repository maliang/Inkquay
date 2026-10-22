# 私家写手 · 五视图交互 QA 报告（独立测试）

- 报告时间：2026-10-20 17:30–17:56（Asia/Shanghai）
- 测试对象：`http://127.0.0.1:4173/`（Python 静态服务器，未重启）
- 被测源码（测试期间哈希未变）：`index.html` `2c9840bc…` / `styles.css` `10387bee…` / `app.js` `095d9f9c…`
- 方式：Playwright + Chromium，1440×900 为主，1280×800 / 1024×800 复核；6 个脚本、207 条断言、76 张截图
- 产物：本报告 `qa/interaction-report.md`、截图 `qa/shots/`、脚本 `qa/pw/`、原始断言 `qa/logs/*.json`
- 写权限：仅写 `qa/`；`index.html`、`styles.css`、`app.js`、`README.md` 未做任何修改

## 1. 结论

**不通过。**

- **P0 × 1**：写作台「新建章节」会把当前章节的标题与正文复制进新章节，并丢弃这 800ms 内未自动保存的编辑（数据丢失），新章节卷号/章号也是错的。
- **P1 × 5**：作品卡「更多」按钮被筛选逻辑劫持（菜单永不出现且清空筛选态）；新建向导第 3 步「进入写作台」跳到作品库；AI 流式生成消息的操作区竖排错位并与正文重叠；剧本分镜板永远显示场 12；跨作品切换后 AI 面板上下文与章节状态错位。
- **P2 × 18**：Esc 无法关闭作品菜单、专注模式泄漏到作品库、设定库搜索不跨 tab/无空状态、大纲 tooltip 不随选中章节移动、向导换方案只换标题、弹窗缺少焦点陷阱、1024 窄屏断裂等。
- **控制台错误：0**（6 个脚本、全流程点击、5 个视图遍历均无 `console.error`、`pageerror`、失败请求或 ≥400 响应）。
- **宽度溢出：1440 / 1280 / 1024 均无横向溢出**（`document.documentElement.scrollWidth === innerWidth`，无元素越过右边界）；问题集中在 1024 下的挤压/裁切，按任务要求只记录不改。

## 2. 严重度定义

| 级别 | 含义 |
| --- | --- |
| P0 | 阻断主流程或造成数据丢失/错误数据 |
| P1 | 主要功能失效、状态错乱、关键反馈缺失 |
| P2 | 一致性问题、次要交互反馈、窄屏体验（1024 仅记录） |

## 3. 覆盖与结果总览

| 范围 | 覆盖项 | 结果 |
| --- | --- | --- |
| 作品库 | 3 张作品卡打开（fog→写作台、ferry→写作台、echo→剧本）、筛选 4 个标签、搜索、继续写作、4 个模板卡 | 基本通过；**卡片「更多」P1**；搜索范围 P2 |
| 写作台 · 目录 | 章节树切换（ch8/ch9/ch7）、新建章节、笔记/搜索按钮 | 切换通过；**新建章节 P0**；笔记/计数 P2 |
| 写作台 · 正文 | 标题/正文 contenteditable、字数与阅读时长联动、保存态（正在保存…→已保存）、工具栏 B/I/引用/列表/分隔线、批注角标 | 通过（工具栏 5 个命令均生效） |
| 写作台 · AI | 快捷提示、自由输入、⌘Enter、流式增长、禁用发送、插入正文、连续性检查 tab、重新检查、模型切换、面板收起/展开、清空/复制 | 功能通过；**流式消息操作区布局 P1** |
| 写作台 · 模式 | 专注模式、Esc 退出、幽灵建议 换一个/接受/Tab 接受 | 通过；退出按钮遮挡 P2；专注+⌘K 泄漏 P2 |
| 大纲 | beat 点击→右侧诊断、兜底诊断、AI 按钮、滚动、侧栏分幕 | 通过；tooltip 位置 P2；侧栏分幕死链 P2 |
| 设定 | 6 个 tab、8 位人物切换与档案同步、返回人物、搜索、导出设定集 | 通过；搜索跨 tab/空状态 P2；计数 P2 |
| 剧本 | 场次 10–14 切换、剧本/分镜 segmented、6 张分镜卡、返回作品库 | 切换通过；**分镜与场次不同步 P1** |
| 新建向导 | 4 类体裁、chips、loading→方案、返回、模板预选、步骤 3、Esc | 通过；**进入写作台 P1**；loading 点击/换方案/标题 P2 |
| 导出 / 批注 | 顶栏导出、内容与格式切换、导出提示、批注打开/Esc/标记已解决 | 通过 |
| 键盘 | ⌘K、⌘Enter、⌘S、⌘.、Esc（弹窗/模型/批注/专注） | 基本通过；作品菜单 Esc P2；焦点陷阱 P2 |
| 宽度 | 1440 / 1280 / 1024 × 5 视图 + 弹窗 | 无横向溢出；1024 有多处挤压（记录） |

## 4. 问题清单

### 速览

| ID | 级别 | 一句话 | 证据 |
| --- | --- | --- | --- |
| P0-1 | P0 | 新建章节复制当前章正文/标题并丢失未保存编辑 | `shots/BUG-newchapter-data-loss-1440.png` |
| P1-1 | P1 | 作品卡「更多」不弹菜单，还清空筛选选中态 | `shots/BUG-project-card-menu-hijacked-1440.png` |
| P1-2 | P1 | 向导「进入写作台」落到作品库，新作品未产生 | `shots/BUG-wizard-enter-studio-1440.png` |
| P1-3 | P1 | AI 流式消息操作区竖排挤压、与正文重叠 | `shots/BUG-ai-streamed-actions-layout-1440.png` |
| P1-4 | P1 | 分镜板永远显示场 12，与选中场次不同步 | `shots/BUG-boards-scene-mismatch-1440.png` |
| P1-5 | P1 | 跨作品切换后 AI 上下文/章节状态错位 | `shots/BUG-cross-project-ai-panel-1440.png` |
| P2-1 | P2 | 作品菜单 Esc 关不掉 | `shots/BUG-project-menu-esc-1440b.png` |
| P2-2 | P2 | 专注模式 + ⌘K 泄漏到作品库 | `shots/BUG-focus-cmdk-library-1440.png` |
| P2-3 | P2 | 设定库搜索不跨 tab | `shots/BUG-codex-search-tab-1440.png` |
| P2-4 | P2 | 设定库搜索无空状态 | `shots/codex-search-empty-1440.png` |
| P2-5 | P2 | 大纲 tooltip 常驻且不随 beat 移动 | `shots/outline-tooltip-beat19-1440.png` |
| P2-6 | P2 | 侧栏分幕条目可点但无反馈 | `shots/outline-panel-act-1440.png` |
| P2-7 | P2 | 作品库搜索不搜章节/人物 | `shots/keyboard-cmdk-1440.png` |
| P2-8 | P2 | 向导 loading 中「采用方案」静默无响应 | `shots/BUG-wizard-loading-click-1440.png` |
| P2-9 | P2 | 向导「换一个方案」只换标题 | `shots/wizard-reroll-1440.png` |
| P2-10 | P2 | 向导完成态标题写死，与用户标题不一致 | `shots/BUG-wizard-title-mismatch-1440.png` |
| P2-11 | P2 | 本章笔记/目录计数静态，新章节重复卷分组 | `shots/BUG-new-chapter-numbering-1440.png` |
| P2-12 | P2 | 刷新丢内容却显示「已保存/云同步」 | `shots/BUG-reload-lost-content-1440.png` |
| P2-13 | P2 | 向导弹窗无初始焦点/焦点陷阱 | `shots/BUG-wizard-focus-escape-1440.png` |
| P2-14 | P2 | 1024 窄屏多处断裂（仅记录） | `shots/BUG-1024-toolbar-wrap.png` |
| P2-15 | P2 | 专注模式退出按钮遮挡工具栏 | `shots/studio-focus-1440.png` |
| P2-16 | P2 | 设定库计数标签与渲染数量不符 | `shots/codex-timeline-1440.png` |
| P2-17 | P2 | AI 空输入发送无反馈 | — |
| P2-18 | P2 | beat 标题数字格式突变（第 8 章） | `shots/outline-beat8-1440.png` |

### P0 问题


### P0-1 新建章节复制当前章节正文/标题，并丢失未保存编辑

- **复现 A（数据丢失）**：
  1. 作品库 →「继续写作」进入写作台（第七章）；
  2. 在正文末尾输入任意文字（例如“未保存的新句子XYZ”）；
  3. 800ms 自动保存窗口内，点击目录底部「新建章节」（`#chapterTree [data-action="newChapter"]` 或 `.panel-foot [data-action="newChapter"]`）；
  4. 再点回第七章 `[data-chapter="ch7"]`。
- **预期**：第七章保留刚输入的内容；新章节为空、标题「未命名章节」、卷「第二卷 · 暗流」、章号「第十章」。
- **实际**：
  - 新章节标题 =「雨夜的访客」、字数 =「483 字」、卷 =「第一卷 · 潮声」、章号 =「第6章」，正文完整复制第七章；
  - 返回第七章后输入内容消失（字数回到 456）；
  - 章节目录出现第二个「第一卷 · 潮声 3 章」分组；目录计数仍为「18 / 24 章」。
- **选择器**：`#chapterTree [data-action="newChapter"]`、`.panel-foot [data-action="newChapter"]`、`#chapterTitle`、`#editor`、`#chapterVol`、`#chapterNo`、`#statusWords`、`#chapterCount`、`.chapter-item.is-active`
- **证据**：
  - `shots/studio-new-chapter-1440.png`（新章节显示「第一卷 · 潮声 · 第6章」+ 上一章全文 + 483 字）
  - `shots/BUG-new-chapter-numbering-1440.png`（目录尾部重复卷分组、「6 雨夜的访客」）
  - `shots/BUG-newchapter-data-loss-1440.png`（回到第七章，输入内容已丢失）
- **线索（供开发定位，未修改源码）**：`handleAction` 的 `newChapter` 分支在 `state.chapter = ch.id` 之后才调用 `syncEditor()`，`syncEditor()` 会把当前编辑器 HTML 与标题写进“新章节”（app.js:1638–1657 与 777–784）。章号取 `p.chapters.length + 1`、卷取 `p.chapters[0].vol`，也会导致「第6章 / 第一卷」。
- **影响**：核心写作路径的破坏性数据丢失 + 错误章节数据，任何“写几段就建新章”的用户都会触发。

## 5. P1 问题

### P1-1 作品卡「更多」按钮不打开菜单，反而清空筛选选中态

- **复现**：
  1. 作品库点「长篇」筛选（此时仅《雾港来信》可见）；
  2. 点《雾港来信》卡片右上角「⋯」按钮；
- **预期**：弹出作品菜单（作品信息 / 导出作品 / 归档作品），筛选保持「长篇」。
- **实际**：菜单不出现（无 toast、无任何反馈）；「全部/长篇/短篇/剧本」4 个标签全部失去选中态，3 张作品卡重新全部显示。默认「全部」选中时点它也会把「全部」高亮清掉。
- **选择器**：`.project-card[data-project="fog"] [data-action="projectMenu"]`、`#libFilters`、`.popover`
- **证据**：`shots/BUG-project-card-menu-hijacked-1440.png`
- **线索**：卡片自身带 `data-filter="novel"`，文档 click 处理器中 `[data-filter]` 分支（app.js:1558–1563）先于 `[data-action]` 分支命中并 `return`，导致 `handleAction('projectMenu')` 永不执行。左侧面板的项目菜单（`[data-panel="studio"] [data-action="projectMenu"]`）正常。
- **影响**：作品卡上的导出/归档入口不可达；筛选状态被无声改坏（属于任务关注的“active 错位”）。

### P1-2 向导步骤 3「进入写作台」实际回到作品库，新作品未创建

- **复现**：作品库 →「新建作品」→ 填标题「自定义书名甲」→「AI 生成创作方案」→ 等方案 →「采用方案，开始写作」→ 步骤 3 点「进入写作台」。
- **预期**：进入写作台（工作区），新作品出现在作品库/可继续写作。
- **实际**：停留在作品库；作品卡仍为 3 张（无新作品）；toast 却提示「《自定义书名甲》已创建，开始写第一句话吧」，与“已进入写作台”的承诺和作品库数据都不一致。
- **选择器**：`#wizardNext`、`#newProjectModal`、`.view.is-active`、`#toastRoot`
- **证据**：`shots/wizard-step3-1440.png`（按钮文案「进入写作台」）、`shots/BUG-wizard-enter-studio-1440.png`（落地作品库 + 创建 toast）
- **线索**：`#wizardNext` 步骤 3 分支执行 `closeModal()` 后 `setTimeout(() => setView('library'), 300)`（app.js:1918–1931），与按钮文案相反。
- **影响**：新建作品流程的终点与承诺不符，用户找不到新作品。

### P1-3 AI 流式生成的消息，操作区/元信息竖排挤压并与正文重叠

- **复现**：写作台 → 点任意 AI 快捷提示（如「先写气氛」）→ 等待生成完成（约 2–3s）→ 观察新生成的 AI 消息底部。
- **预期**：与页面预置消息一致：气泡下方一行横排「插入正文 / 替换选中 / 更克制 / 复制」，元信息在下方。
- **实际**：新消息的 `.msg__actions`（宽 58px、高 103px）与 `.msg__meta`（宽 42px、高 54px）被直接追加为 `.msg` 的子元素，而不是 `.msg__main` 内；按钮逐字竖排（「插入正/文」「替换选中」「更克/制」），元信息「生成于刚/刚·使用/DeepSeek/V3.2」逐字换行并与按钮重叠，正文气泡被压到 180px（面板宽 360px）。
- **选择器**：`#chat .msg--ai[data-msg-id] > .msg__actions`、`#chat .msg--ai > .msg__meta`、`#chat .msg__bubble`
- **证据**：`shots/BUG-ai-streamed-actions-layout-1440.png`（AI 面板局部特写）、`shots/studio-ai-done-1440.png`（整页）
- **线索**：`sendAIPrompt` 完成回调里 `msg.appendChild(actions)`、`msg.appendChild(meta)`（app.js:976–987），而预置消息把它们放在 `.msg__main` 内（app.js:895–901）。
- **影响**：每次 AI 生成后的关键操作（插入正文）可读性/可点性显著下降；功能仍可点击（实测插入成功），但属于明显布局回归。

### P1-4 剧本分镜板与当前场次不同步（永远显示场 12）

- **复现**：作品卡《回声》→ 剧本工坊 → 场次树点「14 沈砚家」→ 点右侧「生成这一场分镜」（或先切「分镜板」再选场 13）。
- **预期**：分镜板板头与 6 张分镜卡对应当前场次（场 13/14）。
- **实际**：板头始终为「场 12 · 渡轮底舱」，6 张卡仍是场 12 的镜头；右侧检查器却显示「场 14 · 沈砚家」；「重新生成」也不改变。
- **选择器**：`#scriptModes [data-script-mode="boards"]`、`.board-head h2`、`[data-action="generateBoards"]`、`[data-action="regenerateBoards"]`、`#sceneName`
- **证据**：`shots/BUG-boards-scene-mismatch-1440.png`（场 14 选中 + 板头场 12）、`shots/screenplay-boards-1440.png`（场 13 选中 + 板头场 12）
- **线索**：分镜板 HTML 为静态内容，`setScriptMode('boards')` 不渲染当前场景（app.js:1257–1266）。
- **影响**：剧本核心的“场次 → 分镜”工作流给出错误内容，且无任何"暂不支持其他场次"的提示。

### P1-5 跨作品切换后，AI 面板上下文与章节状态错位

- **复现**：作品库 →《最后一班渡轮》→ 左侧「大纲」→ 左侧「写作台」。
- **预期**：写作台属于《雾港来信》：AI 欢迎语/记忆 chips 为雾港内容，章节回到上次章节（第七章）。
- **实际**：顶栏与目录已是《雾港来信》，但 AI 欢迎语仍是「我已通读《最后一班渡轮》全文与人物设定…」，记忆 chips 仍是「全文 / 老周 / 末班渡轮 / 三年前的船票」；正文落在第五章《被撕掉的一页》（`state.chapter` 仍是 ferry 的 `f1`，回退到 fog 的第一章），目录激活项随之落到第五章。
- **选择器**：`.tb-project__title`、`#chat .msg__bubble`、`#memoryChips .memory-chip`、`#chapterTitle`、`.chapter-item.is-active`
- **证据**：`shots/BUG-cross-project-ai-panel-1440.png`
- **线索**：`setView()` 切回 studio 时只调用 `renderChapter()`，不调用 `resetAIPanelForProject()`，也不校正失效的 `state.chapter`（app.js:657–684）；AI 面板重置只发生在 `openProject` / 「继续写作」（app.js:686–699、1468–1473）。
- **影响**：两个项目的上下文混在同一面板，容易被误当作当前作品设定；章节错位会直接影响继续写作的落点。

## 6. P2 问题

### P2-1 作品菜单浮层无法用 Esc 关闭

- 复现：写作台 → 左侧项目名右侧「⌄」（`[data-panel="studio"] [data-action="projectMenu"]`）→ 按 Esc。
- 预期：关闭浮层（模型菜单、导出弹窗、批注浮层都支持 Esc）。
- 实际：菜单保持打开，并覆盖正文标题；只能点其他区域/切换视图关闭。
- 证据：`shots/BUG-project-menu-esc-1440b.png`
- 线索：Esc 处理器只覆盖 `#overlay`、`#modelPopover`、`#annotationPop`、专注模式（app.js:1942–1960）。

### P2-2 专注模式叠加 ⌘K：进入作品库但导航仍被隐藏（模式泄漏）

- 复现：写作台按 ⌘. 进入专注 → 按 ⌘K。
- 预期：⌘K 应先退出专注再聚焦搜索，或不允许跳到作品库。
- 实际：视图切到作品库，但 `.focus-mode` 仍在：侧栏、顶栏、上下文面板全部 `display:none`，只剩右上角「退出专注」，作品库处于“无导航”状态。
- 证据：`shots/BUG-focus-cmdk-library-1440.png`
- 线索：`focusLibrarySearch()` 只调用 `setView('library')`（app.js:1398–1401），未 `toggleFocus(false)`。

### P2-3 设定库搜索不跨 tab 生效

- 复现：设定 → 搜索框输入「不存在的角色」→ 切「地点」tab。
- 预期：地点列表继续被过滤（0 条）或清空搜索词。
- 实际：搜索词保留，但地点 6 条全部显示；过滤只对当时激活的 pane 生效；切回「人物」又恢复旧过滤（0 条）。
- 选择器：`#codexSearch`、`.codex-tabs [data-codex-tab]`、`#locationGrid .entity-card`
- 证据：`shots/BUG-codex-search-tab-1440.png`
- 线索：`setCodexTab` 未调用 `filterCodex`；过滤只在 input 事件触发（app.js:1939）。

### P2-4 设定库搜索无空状态

- 复现：设定 → 搜索「不存在的角色」。
- 预期：显示「无匹配人物/清除搜索」空状态。
- 实际：人物区完全空白，无任何提示；右侧档案栏仍显示上次人物（阿荻）。
- 证据：`shots/codex-search-empty-1440.png`

### P2-5 大纲图表 tooltip 常驻且位置不随选中 beat 移动

- 复现：大纲 → 记录 tooltip 位置 → 点第 19 章 beat。
- 预期：tooltip 定位到对应章节点（或改为 hover 显示）。
- 实际：tooltip 文案更新为「第 19 章 · 回港」，但 left/top 仍为 793/288（第 7 章附近），从首屏起就常驻并遮挡曲线；1280/1024 下遮挡更明显。
- 证据：`shots/outline-tooltip-beat19-1440.png`、`shots/outline-1280.png`

### P2-6 大纲侧栏分幕条目可点击但没有反馈

- 复现：大纲 → 点侧栏「II 暗流」/「III 退潮」。
- 预期：切换幕或滚动定位到对应分幕，并有 active 态。
- 实际：`cursor:pointer`，但选中态、滚动、toast 全无（`.act-item` 未绑定任何处理器）。
- 证据：`shots/outline-panel-act-1440.png`

### P2-7 作品库搜索范围与占位文案不符

- 复现：作品库搜索「雨夜」（章节名）、「沈砚」（人物名）。
- 预期：按占位文案「搜索作品、章节、人物」命中《雾港来信》。
- 实际：两次均为 0 条（`filterLibraryProjects` 只匹配卡片可见文本）。搜「渡轮」能命中 2 条只是因为卡片简介里出现了该词。
- 证据：`shots/keyboard-cmdk-1440.png`（搜索框文案）

### P2-8 向导 loading 期间「采用方案，开始写作」可点但静默无响应

- 复现：向导步骤 1 →「AI 生成创作方案」→ 1.3s loading 内再点同一按钮。
- 预期：按钮禁用/显示生成中，或提示“正在生成，请稍候”。
- 实际：按钮保持可点、文案已是「采用方案，开始写作」、无 disabled、无 toast，点击被 `if (state.wizardLoading) return;` 静默吞掉。
- 证据：`shots/BUG-wizard-loading-click-1440.png`

### P2-9 向导「换一个方案」只换标题

- 复现：方案步骤点「换一个方案」（`[data-action="rerollProposal"]`）。
- 预期：人物、三幕结构、候选进度一起变化。
- 实际：仅 `.proposal__head h3` 标题在 3 个固定文案里轮换，人物/三幕/简介不变；候选计数始终「候选 1/3」。
- 证据：`shots/wizard-reroll-1440.png`

### P2-10 向导步骤 3 完成态标题写死，与用户标题不一致

- 复现：新建作品 → 标题填「自定义书名甲」→ 生成 → 采用 → 步骤 3。
- 预期：完成态显示《自定义书名甲》已创建。
- 实际：`.created-state p` 固定为「《潮汐表上没有的名字》已创建」；而下一步 toast 使用的是另一份 `state.wizardTitle`（先后出现「雾中灯塔测试」「潮汐表上没有的名字」等不同标题）。
- 证据：`shots/BUG-wizard-title-mismatch-1440.png`

### P2-11 本章笔记 / 目录计数不随上下文更新；新章节产生重复卷分组

- 复现：切到第八章/第九章，或新建章节。
- 预期：「本章笔记」显示当前章节笔记；目录计数随新建章节变化；卷分组唯一。
- 实际：「本章笔记」始终是第七章的「访客的伞留在门外…」；`#chapterCount` 始终「18 / 24 章」；新建章节被追加到首卷 vol，目录尾部出现第二个「第一卷 · 潮声」分组。
- 证据：`shots/BUG-new-chapter-numbering-1440.png`、`shots/studio-new-chapter-1440.png`

### P2-12 刷新后内容丢失，界面却显示「已保存 / 云同步 · 刚刚」

- 复现：写作台追加一段文字 → 等保存态变「已保存」→ 刷新页面 → 重新进入写作台。
- 预期：至少本次会话的“已保存”内容应能恢复（原型也应有 localStorage 或明确提示不同步）。
- 实际：追加内容消失，字数回到 456；侧栏仍显示「已保存」，作品库顶栏「云同步 · 刚刚」。
- 证据：`shots/BUG-reload-lost-content-1440.png`

### P2-13 新建向导弹窗无初始焦点、无焦点陷阱

- 复现：作品库点「新建作品」→ 观察 `document.activeElement` → 按 Tab。
- 预期：焦点进入弹窗并循环在弹窗内。
- 实际：焦点仍停留在背景的「新建作品」按钮；第一次 Tab 直接落到背景其他按钮（不在 `#newProjectModal` 内），键盘用户可操作被遮罩的背景。
- 证据：`shots/BUG-wizard-focus-escape-1440.png`

### P2-14 1024 窄屏多处显示断裂（按任务要求仅记录）

- 写作台：`.doc-toolbar` 被裁切，「约 2 分钟阅读」被压成 10px 宽 / 91px 高（约 6 行竖排），右侧图标贴边。
- 设定库：人物卡姓名/角色竖排换行（「沈 / 砚」「主 / 角」），简介出现省略号截断，卡片信息不可读。
- 作品库：`.continue-card__aside` 被断点隐藏，全书进度 42% / 章数信息完全消失（属断点设计，但 1024 下信息缺失）。
- 大纲：tooltip 覆盖约 1/3 图表。
- 证据：`shots/BUG-1024-toolbar-wrap.png`、`shots/BUG-1024-char-cards.png`、`shots/BUG-1024-continue-card.png`、`shots/studio-1024.png`、`shots/codex-1024.png`、`shots/outline-1024.png`

### P2-15 专注模式「退出专注」按钮遮住工具栏右侧

- 复现：写作台按 ⌘. 进入专注模式（1440）。
- 预期：退出按钮不遮挡阅读时长/专注/AI 图标。
- 实际：`.focus-exit` 固定 `top:18 right:20`，与工具栏右侧的「约 2 分钟阅读」及两个图标重叠，文字被切。
- 证据：`shots/studio-focus-1440.png`

### P2-16 设定库计数标签与实际渲染数量不符

- 复现：设定库各 tab 查看。
- 预期：标签数量 = 渲染条目数。
- 实际：人物标签「12」但只有 8 张卡；地点标签「8」但只渲染 6 条；组织 4/4、道具 6/6、时间线 10/10、伏笔 5/5 正常。
- 证据：`shots/codex-timeline-1440.png`、`shots/codex-foreshadow-1440.png`

### P2-17 AI 空输入点发送无任何反馈

- 复现：写作台 AI 输入框留空 → 点发送按钮（`#aiSend`）。
- 预期：提示「请输入内容」或按钮禁用。
- 实际：不发消息、无 toast、无输入框高亮，完全静默。
- 证据：无（断言 `#chat .msg` 数量不变、toast=0）

### P2-18 beat 诊断标题数字格式突变

- 复现：大纲点第 8 章 beat。
- 预期：标题维持「第八章 · 被撕掉的一页」。
- 实际：`updateInsight` 强制改写为「第 8 章 · 被撕掉的一页」；tooltip 也是「第 8 章」，与卡片「08」、默认「第七章」的中文数字风格不一致。
- 证据：`shots/outline-beat8-1440.png`

## 7. 通过项（抽查证据）

- 视图切换、侧栏 rail active、返回作品库复位：`shots/screenplay-back-library-1440.png`
- 作品库筛选 4 个标签、空搜索结果保留「开始新的故事」入口：`shots/lib-filter-short-1440.png`、`shots/lib-search-empty-1440.png`
- 章节切换：标题/正文/字数/目录 active/AI 建议块显隐同步（ch8、ch9）：`shots/studio-draft-chapter-1440.png`
- 编辑联动：字数、章节树字数、阅读时长、保存态「正在保存…→已保存」；标题同步目录
- 工具栏：加粗/斜体/引用/列表/分隔线/AI 提示均生效：`shots/studio-toolbar-bold-1440.png`、`shots/studio-toolbar-quote-1440.png`
- 幽灵建议：换一个、接受写入正文、Tab 接受：`shots/studio-ghost-accepted-1440.png`
- AI：流式文本递增、发送禁用/恢复、用户消息、插入正文（字数 456→535、「已插入正文」禁用）、⌘Enter 发送：`shots/studio-ai-streaming-1440.png`、`shots/studio-insert-ai-1440.png`
- 连续性检查：tab 切换时 body/composer 同步隐藏、3 条问题、重新检查 loading、切回恢复：`shots/studio-ai-check-1440.png`
- 模型切换：菜单不越界、pill 文案更新、菜单关闭：`shots/studio-model-menu-1440.png`、`shots/studio-model-switched-1440.png`
- AI 面板收起：文档区 710→1070px，可再次展开：`shots/studio-ai-collapsed-1440.png`
- 专注模式：隐藏 rail/panel/AI、显示退出按钮、Esc 退出
- 批注：角标/正文 mark 打开浮层、Esc 关闭、标记已解决移除下划线：`shots/studio-annotation-1440.png`
- 导出：弹窗、内容/格式切换、导出 toast、Esc 关闭：`shots/export-modal-1440.png`
- 大纲：beat 7/8/11/12 诊断同步、兜底文案、4 个 AI 按钮 toast、内部滚动
- 设定：人物切换（林雾/阿荻）档案全字段同步、6 tab 单 pane 可见、返回人物保留选中：`shots/codex-lin-1440.png`、`shots/codex-back-characters-1440.png`
- 剧本：场次 13 正文/页脚/评分/出场人物同步、segmented 无残留、返回作品库复位：`shots/screenplay-s13-1440.png`
- 向导：4 类体裁单选、语气/体量 chips 单选、loading→方案、标题/灵感回填、返回保留输入、模板卡预选体裁、Esc 关闭：`shots/wizard-step1-1440.png`、`shots/wizard-proposal-1440.png`
- 键盘：⌘K 聚焦、⌘S toast、⌘. 专注、⌘Enter 发送、Esc 关闭弹窗/批注/模型/专注

## 8. 控制台与网络

- 6 个脚本全程监听 `console`（error/warning）、`pageerror`、`requestfailed`、HTTP ≥400：
  - **无 `console.error` / `pageerror`**
  - **无失败请求、无 4xx/5xx**（包括静态资源）
- 未观察到 404（页面未请求 favicon）、未捕获 `execCommand` 相关告警。
- 备注：`navigator.clipboard.writeText` 的失败被 `.catch(() => {})` 静默吞掉；无 toast 外的错误暴露。

## 9. 宽度与响应式结论

| 视口 | 结果 | 关键数据 |
| --- | --- | --- |
| 1440×900 | 通过 | `scrollWidth = innerWidth = 1440`，无元素越界 |
| 1280×800 | 通过 | `scrollWidth = 1280`；写作台文档区 608 / AI 面板 322；工具栏 608/608 不溢出；向导弹窗 280–1000 × 63–737 完整可见 |
| 1024×800 | 无横向溢出，但多处挤压（记录，不要求修） | `scrollWidth = 1024`；工具栏裁切、阅读时长竖排 10×91px；人物卡姓名 46px 两行；continue-card aside 隐藏 |

说明：1280 下各视图无溢出、无文字重叠；1024 的问题来自 1180 断点后仍强制「人物列表 + 300px 档案」与「文档 + 320px AI 面板」并排，属布局取舍问题。

## 10. 未覆盖项与限制

- **真实导出产物**：只验证弹窗与 toast，未校验 Word/PDF/Markdown/TXT 文件内容（原型无后端）。
- **剪贴板内容**：只验证 toast，未读取系统剪贴板校验文本。
- **附件/引用选中文本**（paperclip、quoteSelection、addMemory）：只有 toast，未验证真实数据流。
- **AI 网络异常**：未模拟超时、断流、429、重试；流式输出为本地模拟。
- **持久化与多标签**：未验证刷新/多标签/协作同步（已记录刷新丢内容）。
- **移动端 < 1024**：任务仅要求记录 1024；未测 780、768、375 及触屏手势。
- **跨浏览器**：仅 Chromium（Playwright 缓存版本）；未测 Safari/Firefox。
- **可访问性全量审计**：只发现焦点陷阱问题，未做对比度/屏幕阅读器/ARIA 完整审计。
- **性能**：未做长列表/大文档输入性能、内存与首屏指标。
- **设置/账号/归档/卡片视图/拖拽排序**：页面仅 toast 占位，未验证实际功能。
- **角色扮演式内容质量**：AI 文案质量、连贯性不在本次交互测试范围。

## 11. 复现与产物

```bash
cd /Users/maliang/Documents/develop/maliang/私家写手
NODE_PATH=/tmp/pw/node_modules node qa/pw/a-library-studio.cjs        # 作品库 + 写作台 + AI + 批注 + 导出
NODE_PATH=/tmp/pw/node_modules node qa/pw/b-outline-codex-screenplay.cjs # 大纲 + 设定 + 剧本 + 跨项目
NODE_PATH=/tmp/pw/node_modules node qa/pw/c-wizard-keyboard-layout.cjs   # 向导 + 键盘 + 1440/1280/1024
NODE_PATH=/tmp/pw/node_modules node qa/pw/d-extra.cjs                  # 状态一致性补充
NODE_PATH=/tmp/pw/node_modules node qa/pw/e-extra2.cjs                 # 持久化/焦点/复制
NODE_PATH=/tmp/pw/node_modules node qa/pw/f-toolbar-crops.cjs          # 工具栏命令与局部特写
```

- 原始断言：`qa/logs/a-library-studio.json`、`b-outline-codex-screenplay.json`、`c-wizard-keyboard-layout.json`、`d-extra.json`、`e-extra2.json`、`f-toolbar-crops.json`
- 截图：`qa/shots/`（76 张；`BUG-*` 为问题证据，`probe-*` 为五视图基线，`*-1280` / `*-1024` 为宽度复核）
- 所有操作均为真实浏览器点击/输入，未调用页面内部函数修改状态（仅用 `evaluate` 读取 DOM/尺寸与定位光标）。
