# Inkquay · 私家写手

[![Release Inkquay](https://github.com/maliang/Inkquay/actions/workflows/release.yml/badge.svg)](https://github.com/maliang/Inkquay/actions/workflows/release.yml)

> **Inkquay** = Ink + Quay（墨水与码头）。一个安静的私人写作码头，给长篇故事和它们的作者。中文名仍是「私家写手」。

<img src="software/public/logo.svg" width="76" height="76" alt="私家写手 logo" />

Inkquay（私家写手）是一个面向中文长篇小说、短篇小说与剧本作者的本地优先创作软件。目标不是「一键生成」，而是让作者始终掌握结构、人物、伏笔和文风：**AI 负责共笔与检查，作者负责判断。**

根目录现在是**全栈应用入口**；早期静态界面原型归档在 [`prototype/`](prototype/README.md)，不再作为主产品。

## 快速开始

```bash
# 安装依赖（只需一次）
pnpm -C software install

# 开发版
pnpm dev
```

- Web：**http://127.0.0.1:5180**
- API：http://127.0.0.1:8787
- 首次打开会强制填写 **称呼 + API Key**，不完成不能进入主界面
- 没有演示作品；安装后从空书房开始

生产构建：

```bash
pnpm build
pnpm start          # 默认 http://127.0.0.1:8787
```

也可以直接进入 [`software/`](software/README.md) 使用同样的命令。

## 首次启动

安装后第一次打开会进入两步引导，不能跳过：

1. **作者身份**：填写称呼 / 笔名，可选一句话签名。
2. **接入模型**：选择供应商、模型并填写 API Key；Ollama 本地模型可免 Key。

完成后才会进入主界面。称呼与签名会写入本地 SQLite，并用于问候、头像、封面作者和导出署名；API Key 加密保存。之后可以在「设置 → 个人资料 / 模型与供应商」修改。

Logo 为矢量 SVG：`software/public/logo.svg`，桌面图标也由它生成。

## 自动发布与升级

GitHub 仓库：[maliang/Inkquay](https://github.com/maliang/Inkquay)

- 推送到 `main` 自动触发 [Release Inkquay](.github/workflows/release.yml)，自动发布到 [GitHub Releases](https://github.com/maliang/Inkquay/releases/latest)
- 平台矩阵：macOS universal、Windows x64 NSIS、Linux x64 AppImage + deb
- 版本号：`0.1.<GitHub Run Number>`，自动生成 DMG + ZIP + `latest-mac.yml`
- 产物发布到 GitHub Releases；首次安装从 Releases 下载
- 应用启动后会检查更新，之后每 4 小时检查一次
- 发现新版本弹窗：点「更新并重启」→ 自动下载 → 下载完成自动重启安装
- macOS 菜单「检查更新…」可手动检查
- 开发版不检查更新
- 已验证：打包版启动 8 秒后检测到 GitHub 最新版；点击「更新并重启」会进入自动下载/安装流程

> macOS 的 Squirrel 自动更新要求 App 被签名。GitHub Actions 默认构建未签名版本（可通过 Release 手动安装）；要启用真正的自动升级，请在仓库 Secrets 配置 `CSC_LINK` / `CSC_KEY_PASSWORD`，并在需要时补 notarization。配置后 workflow 会自动签名；未签名版本的下载失败会回退到打开 Releases 下载页。

## 桌面版（macOS / Windows / Linux）

已经打包成独立 `.app` 和 `.dmg`，不需要用户安装 Node：

```bash
pnpm desktop         # 直接启动桌面版
pnpm desktop:pack    # 本机架构 .app
pnpm desktop:dmg     # 本机架构 .dmg

# 多平台发布由 GitHub Actions 矩阵完成
# macOS universal / Windows x64 NSIS / Linux x64 AppImage + deb
```

![桌面版](software/screenshots/91-desktop-studio.png)

- 数据：`~/Library/Application Support/Inkquay/data/studio.db`
- 日志：`~/Library/Application Support/Inkquay/logs/server.log`
- 已实测：启动、编辑、关闭、重启后内容保留
- GitHub Release 覆盖 macOS universal、Windows x64、Linux x64；未签名版本首次打开可能需右键/绕过 SmartScreen
- macOS 自动更新：`.zip` + `latest-mac.yml`
- Windows 自动更新：NSIS + `latest.yml`
- Linux 自动更新：AppImage + `latest-linux.yml`；deb 仅手动安装
- 详细说明：[desktop/README.md](desktop/README.md)

## 当前进度

**Milestone 12 · 长线写作与发布验收**

- 无演示数据；首次启动强制填写称呼与 API Key
- 作品库、新建作品、空书房引导、作品设置、归档筛选与移出归档、级联删除（删除前需手输书名并列出影响清单）
- 章节树、正文编辑、800ms 自动保存、⌘S / Ctrl+S 立即保存、字数统计
- 关闭窗口前先落盘再退出（Electron 主进程与渲染层握手，失败则取消关闭）；非写作台页面立即退出，不再空等 5 秒兜底
- AI 企划：一句灵感 → 预览 → 逐项确认 → 三幕大纲 / 人物 / 第一章；可取消、失败可重试
- 章节版本：AI 企划 / 插入 / 改写 / 自动保存 / 切换章节自动快照，左右对比与回退；可按章或按全书查看历史
- AI 流式共笔、重新生成、停止生成保留已生成部分、消息持久化、插入正文、模型切换
- 选中文本 → 改写 / 扩写 / 精简 / 换语气 → 精确替换原选区，不误伤同文其他位置
- 模型供应商：OpenAI 兼容 / Anthropic / Gemini / 本地 mock
- 供应商 Key 使用 AES-256-GCM 加密保存
- 大纲场景编辑 / 新增 / 上移下移 / 拖拽排序 / 删除
- 人物 CRUD、伏笔新增/编辑/删除
- 剧本场次编辑 / 新增 / 删除
- 分镜板：每场生成 6 个模板镜头，可编辑、删除并持久化
- 章节删除先移入回收站，可恢复；彻底删除前明确提示历史版本会一并清除
- 个人资料：称呼 / 笔名、签名、头像首字，贯穿问候与导出署名
- 四套主题、六种强调色、自定义颜色、字号与动效
- Markdown / Word（.docx）导出，可选全书或当前章；空作品/空章节给出中文错误，不再下载空文件
- 项目 JSON 备份 / 导入：含章节、版本历史、大纲、人物、场次、分镜与伏笔；**不含 API Key**，不是整库恢复
- 桌面版：独立 `.app/.dmg`、Windows NSIS、Linux AppImage/deb，内置本地服务，不依赖系统 Node
- 隔离 SQLite 的 API 集成测试 + Playwright 浏览器 E2E + Electron 桌面 E2E
- AI 企划先生成预览，支持逐项勾选/取消后再写入；失败不会丢作品
- 删光所有作品后重启不再触发首启 seed 崩溃；加载失败有错误页与重试，不会永久转圈

## 体验修复 · 第二轮（未发布）

基线 `4a43f42`。这一轮不新增功能，只修「界面说的和 AI 实际做的不一致」，以及几个会把人带错地方、或让不可恢复操作变得太容易的流程。零 schema 变更、零新依赖；尚未 push、未发版。完整说明与验证证据见 [docs/EXPERIENCE-FIXES-ROUND2.md](docs/EXPERIENCE-FIXES-ROUND2.md)。

| 修复 | 用户可见变化 |
| --- | --- |
| 未配置模型不再静默代写 | 以前会用「墨笔演示模型」照常生成并入库；现在弹提示并让服务端直接返回错误，不写消息、不动正文（显式选择「本地演示」仍可用） |
| 删除作品有安全网 | 二次确认页列出章节 / 回收站章节 / 场次 / 分镜 / 人物 / 伏笔 / 历史版本 7 项真实计数，必须手输书名才能删除；取消类操作不发请求 |
| 剧本不再落进章节写作台 | 点剧本卡的「继续写作」或直接访问 `/project/{剧本id}` 会自动进剧本页；书架显示「N 场 · M 个分镜」，不再出现「0 章 0 页」 |
| 设定页不再声称已进上下文 | 「长期记忆 / 已同步 / AI 已索引」改为「设定索引 / 本地保存」，并明确「写作时可在共笔面板手动引用」；72% 假进度条已删除 |
| 任意页面关窗立即退出 | 以前设置 / 大纲 / 设定页关窗要等满 5 秒（实测 5164ms），现在 273ms；写作台仍先落盘，保存失败则不关窗 |
| 保存供应商不再偷改默认模型 | 弹窗内单独选择「默认模型」（默认「不设为默认」），不改就不写；停用当前默认供应商时会清掉失效的默认值 |
| 大纲不再写死三幕 | 三幕卡 / 幕列表 / 分幕大纲读真实 `acts`；张力曲线与人物弧光保留但标「示意」，不再冒充精确计算 |
| 剧本分析不再冒充真实评分 | 「本场分析」保留并标「示意」；进度改为真实的「N / M 场有正文」 |

## 界面截图

> 以下截图中的作品为开发验收时的示例数据；正式安装没有演示作品，会从空书房开始。

| 首次启动 · 作者身份 | 首次启动 · 接入模型 |
| --- | --- |
| ![首次启动](software/screenshots/96-onboarding-identity.png) | ![接入模型](software/screenshots/97-onboarding-api.png) |

| 空书房 | 个人资料 |
| --- | --- |
| ![空书房](software/screenshots/98-first-run-after-onboarding.png) | ![个人资料](software/screenshots/94-profile-settings.png) |

| AI 企划：逐项确认 | 生成版本对比 |
| --- | --- |
| ![企划确认](software/screenshots/103-plan-review.png) | ![版本对比](software/screenshots/104-version-compare.png) |

| 选中文本改写 |
| --- |
| ![选区改写](software/screenshots/101-selection-toolbar.png) |

| 分镜板 | 桌面版 |
| --- | --- |
| ![分镜板](software/screenshots/85-storyboard-live.png) | ![桌面版](software/screenshots/91-desktop-studio.png) |

## 架构

```text
私家写手/
├── software/                 # 全栈应用
│   ├── src/client/           React 19 + Vite 8
│   ├── src/server/           Express 5 + node:sqlite
│   ├── src/shared/           前后端共享类型
│   ├── data/                 SQLite / 本地密钥（运行时生成）
│   ├── public/logo.svg       矢量 Logo
│   └── scripts/              API 测试 / UI E2E
├── desktop/                  # Electron 桌面壳（macOS / Windows / Linux）
├── prototype/                # 早期静态界面原型（归档）
└── package.json              # 根入口 / 桌面打包脚本
```

- 前端：React Router 7，复用原型 CSS 设计系统
- 后端：Express 5，SSE 流式输出
- 数据库：Node 内置 `node:sqlite`，WAL 模式
- 密钥：`software/data/.secret` + AES-256-GCM

## 真实供应商与跨平台验收

- 配置真实 Key 后运行 `cd software && pnpm test:providers`，会逐家检查连接并做一次极短真实流式生成；没有 Key 默认 SKIP。
- CI 平台冒烟见 `.github/workflows/platform-smoke.yml`；本机 Linux arm64 已用 Docker + Xvfb 验证启动与页面加载。
- Windows/Linux 桌面 E2E 走 GitHub Actions 的 `Platform smoke`（手动或相关 PR 触发），细节见 [docs/RELEASE-ACCEPTANCE.md](docs/RELEASE-ACCEPTANCE.md)。

## 测试

```bash
pnpm typecheck
pnpm test       # API 集成测试：临时目录 + 独立 SQLite
pnpm test:ui    # 构建后用独立 SQLite 启动生产服务，跑 Playwright
pnpm desktop:test  # 启动 Electron，验证编辑 → 关闭 → 重启后数据保留，并断言非写作台关窗 < 2500ms
```

覆盖首次初始化（强制称呼 / API Key）、作品、章节、自动保存、总字数、版本快照与回退、全书历史、章节回收站/恢复/彻底删除、大纲、人物、伏笔、剧本、分镜、归档筛选、设置、供应商 Key、AI SSE / 停止保留半截 / 重新生成、全书/本章 Markdown/Word 导出、空导出拦截、项目 JSON 备份导入、删光作品后重启不重复 seed。第二轮补充：剧本 Markdown/Word 导出与空剧本拦截、项目包（剧本）往返保留场次与分镜、未配置模型时拒绝而非静默演示、删除作品的书名闸门与影响清单、剧本路由与书架计数、设定页文案、供应商保存不改默认模型。

## 已知边界

- 分镜生成是模板草案，尚未接视觉模型
- 大纲跨幕拖拽暂未开放
- 富文本编辑器仍是 contentEditable
- 暂无账号系统、多用户、云同步；称呼和 API 只是本地设置
- AI 企划已支持逐项确认，章节版本可对比回退
- 章节回收站只覆盖章节；删除整部作品仍是级联硬删除，不能恢复（第二轮加了书名闸门与影响清单，仍没有作品级回收站）
- `pnpm desktop:test` 已断言「非写作台关窗 < 2500ms」（实测约 260ms），写作台用例超时收到 4000ms
- 设置页「默认模型」下拉在未配置时视觉上仍落在第一项（同页卡片正确显示「未配置」，实际请求也按未配置处理）
- 剧本作品卡仍显示「0 字」、侧栏「最近更新」按章节数显示「0 章」
- 本地服务异常退出（`server-exited`）时窗口没有提示，需要手动重开
- 大纲页张力曲线 / 人物弧光、剧本页「本场分析」仍是示意数据（第二轮正在加「示意」标注，并把三幕卡改为真实数据；实现已在工作区，随本轮一起复验）
- 伏笔与人物关系目前不会自动进入 AI 系统提示词，需要在共笔面板手动引用（设定页文案已按此修正）
- 项目包备份不含供应商 Key，也不提供整库恢复；换机后需重新填 Key
- 版本历史每章最多 40 条；暂无分支版本、版本命名与跨章合并
- macOS 默认未签名/未公证；Windows 默认未签名，Linux 默认未签名
- Windows/Linux 已有 CI 冒烟入口；本机只实际跑过 Linux arm64 的启动/页面加载，Windows 真机仍待 CI 或实机验证
- Linux 自动更新只对 AppImage 生效，deb 需要手动升级
- 静态原型已归档，但还没有正式删除

更详细的工程说明见 [software/README.md](software/README.md)。
