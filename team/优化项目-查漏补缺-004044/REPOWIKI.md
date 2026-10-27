# REPOWIKI · Inkquay / 私家写手

> 本文件由研究员只读扫描仓库生成（2026-10-27，分支 `main`，HEAD `8e95e43`）。
> 所有命令都在仓库根 `/Users/maliang/Documents/develop/maliang/私家写手` 下可直接执行。
> 路径一律相对仓库根；行号对应当前 HEAD。

---

## 1. 产品定位

**Inkquay · 私家写手**：本地优先的中文长篇创作工作台（长篇 / 短篇 / 剧本 / 系列剧四类作品）。
定位是「AI 共笔 + 结构检查」，不是一键成稿：作者负责判断与落笔，AI 负责企划、续写、改写、找漏洞。

- 数据全部落本地 SQLite，API Key 本地加密存储，不依赖云端账号。
- 三类工作台共用一套数据：写作台（正文 + AI 对话）、大纲（幕/节拍/场景）、设定集（人物/伏笔）、剧本（场次/分镜）。
- 交付形态：浏览器（开发/自托管）+ Electron 桌面端（macOS / Windows / Linux，自动更新走 GitHub Releases）。

---

## 2. 技术栈（实际版本，取自 package.json / lockfile）

| 层 | 选型 | 版本 | 备注 |
| --- | --- | --- | --- |
| 前端框架 | React + React Router | 19.3.1 / 7.18.4 | 纯 SPA，无 SSR、无状态库，状态在 `AppContext` |
| 构建 | Vite | 8.3.5 | dev 端口 5180，`strictPort: true` |
| 语言 | TypeScript | 7.0.2 | `tsc --noEmit` 做类型检查，构建时不做类型检查 |
| 后端 | Express | 5.3.0 | 单个 `index.ts`，38 条路由 |
| 运行时 | Node + tsx | 本机 v26.11.1；CI Node 24 | 直接跑 `.ts`，无编译产物 |
| 数据库 | `node:sqlite`（`DatabaseSync`） | 内置模块 | WAL + `foreign_keys = ON`，无 ORM、无迁移框架 |
| 导出 | `docx` | 9.13.0 | 服务端生成 .docx |
| 桌面 | Electron + electron-builder + electron-updater | 45 / 26.15.3 / 6.8.9 | esbuild 把服务端打成 `desktop/server.cjs` |
| 测试 | Playwright + `node:assert` | 1.64.1 | API 级 + 浏览器级 + Electron 级 |
| 包管理 | pnpm | 10.34.7 | **根目录与 `software/` 各一套 lockfile，必须各装一次** |

---

## 3. 快速开始（可执行）

### 3.1 前置

- Node ≥ 24（`node:sqlite` 需要；本机 v26.11.1 已验证）
- pnpm 10.x（`packageManager: pnpm@10.34.7`）

### 3.2 安装（两套依赖，别只装根目录）

```bash
pnpm install                 # 根：electron / electron-builder / esbuild
pnpm -C software install     # software：react / express / vite / tsx / playwright
```

### 3.3 浏览器开发（日常主用）

```bash
pnpm dev
# = pnpm -C software dev
# = concurrently: tsx watch src/server/index.ts  +  vite
# API  http://127.0.0.1:8787   （PORT 环境变量可改）
# Web  http://127.0.0.1:5180   （vite 把 /api 代理到 8787）
```

打开 <http://127.0.0.1:5180>。首次进入会被强制送去 onboarding（需要填一个真实供应商的 API Key，见 §9 坑 9）。

### 3.4 生产模式本地预览

```bash
pnpm build     # = pnpm -C software build → software/dist
pnpm start     # = NODE_ENV=production tsx src/server/index.ts
# http://127.0.0.1:8787  （同一端口既发 API 也发 dist 静态文件）
```

### 3.5 桌面端

```bash
pnpm desktop          # 构建 dist + esbuild 打 server.cjs + 启动 Electron
pnpm desktop:pack     # electron-builder --mac dir → desktop/release/mac-arm64/私家写手.app
pnpm desktop:dmg      # 出 dmg
pnpm desktop:open     # open 已打好的 .app
```

### 3.6 其它命令

```bash
pnpm typecheck                    # tsc --noEmit
pnpm seed                         # 只写 providers + settings（不建作品），本地调试用
pnpm test                         # API 回归（起真服务，端口 8799，临时数据目录）
pnpm test:ui                      # 构建后跑 Playwright 全流程（端口 8798）
pnpm desktop:test                 # 起真 Electron，走 onboarding→建作品→重启验证数据留存
pnpm -C software exec playwright install chromium   # 首次跑 UI 测试前的一次性准备
```

---

## 4. 目录职责

```
私家写手/
├── README.md                     产品说明 / 功能清单 / 已知限制（人类入口）
├── package.json                  根：electron 打包配置 + desktop:* 脚本
├── scripts/                      桌面端构建与测试脚本（ESM，.mjs）
│   ├── build-desktop.mjs         esbuild: software/src/server/index.ts → desktop/server.cjs
│   ├── launch-desktop.mjs        清掉 ELECTRON_RUN_AS_NODE 后 spawn electron
│   └── desktop-test.mjs          Playwright _electron 冒烟（重启后数据是否还在）
├── desktop/
│   ├── main.cjs (298行)          主进程：单实例锁 / 找空闲端口 / spawn 内嵌 server / 菜单 / 自动更新
│   ├── server.cjs (≈2.0MB)       构建产物（gitignored），改服务端代码必须重跑 desktop:prepare
│   ├── build/                    icon.icns / icon.ico / icon.png 等打包资源
│   └── release/                  electron-builder 输出（gitignored）
├── software/
│   ├── package.json              独立包 inkquay-studio（自己的 lockfile）
│   ├── vite.config.ts            port 5180 + strictPort + proxy /api → 8787
│   ├── scripts/api-test.mjs (246行)   API 级集成测试（真服务 + 临时 PW_DATA_DIR）
│   ├── scripts/ui-test.mjs  (255行)   Playwright 浏览器全流程 + 截图
│   ├── data/                     默认数据库目录（gitignored；当前只有 .secret，库文件按需生成）
│   └── src/
│       ├── shared/types.ts (268行)    前后端共用的全部类型（唯一契约）
│       ├── server/                   Express + SQLite（2005 行总计）
│       │   ├── index.ts (385)        路由 + 静态托管 + 错误包装
│       │   ├── repository.ts (766)   全部 SQL 与业务规则（最大文件，改逻辑先看这里）
│       │   ├── db.ts (173)           建表 + 首启播种 + PRAGMA
│       │   ├── seed.ts (80)          9 个内置供应商 + 默认 settings
│       │   ├── plan.ts (167)         AI 企划（prompt 构造 + 输出解析）
│       │   ├── ai.ts (296)           四类供应商流式适配（openai/anthropic/google/mock）
│       │   ├── docx.ts (79)          docx 导出（含人物附录）
│       │   ├── crypto.ts (46)        API Key 加密（.secret 做密钥）
│       │   └── utils.ts (13)         uid / now / countWords
│       └── client/                   纯 SPA（3063 行）
│           ├── main.tsx              StrictMode + Router + AppProvider + ToastProvider（无 ErrorBoundary）
│           ├── App.tsx               路由表 + loading/onboarding/error 兜底
│           ├── api.ts (136)          25 个 API 方法 + SSE 流式封装
│           ├── theme.ts (77)         主题/强调色 → CSS 变量
│           ├── context/AppContext.tsx (91)   /api/bootstrap 单次拉取 + settings 更新
│           ├── pages/                LibraryPage(280) StudioPage(738) OutlinePage(255)
│           │                         CodexPage(206) ScreenplayPage(251) SettingsPage(337) OnboardingPage(106)
│           └── components/           AppShell(23) Rail(41) ChapterEditor(60) Toast(30)
│                                     NewProjectModal(114) PlanReviewModal(131) ProjectSettingsModal(87)
│                                     Cover / Icon
├── prototype/                    早期静态原型（index.html + screenshots），不参与构建
└── .github/workflows/release.yml 三平台矩阵发布
```

---

## 5. 核心数据模型

库文件：`software/data/studio.db`（开发，`PW_DATA_DIR` 可覆盖）／桌面端 `app.getPath('userData')/data/studio.db`。
加密密钥：同目录 `.secret`（首次自动生成）。12 张表，全部 `id TEXT PRIMARY KEY`，时间戳为 ISO 字符串。

| 表 | 关键字段 | 关系 / 约束 |
| --- | --- | --- |
| `projects` | id, title, type(`novel`/`short`/`screenplay`/`series`), genre, description, cover, status, total_words, goal_words(默认 300000), created_at, updated_at | 根实体 |
| `chapters` | id, project_id, volume, number, title, content, status, sort_order, words, updated_at | → projects **CASCADE** |
| `characters` | id, project_id, name, role, age, avatar, tags(JSON), quote, description, secret, relations(JSON), sort_order | → projects CASCADE |
| `outline_acts` | id, project_id, title, summary, sort_order | → projects CASCADE |
| `outline_beats` | id, project_id, act_id, chapter_no, title, summary, tags(JSON), status, sort_order | → acts **CASCADE**（删幕连带删节拍） |
| `scenes` | id, project_id, number, group_name, place, time, heading, content, status, sort_order | 剧本场次 → projects CASCADE |
| `shots` | id, project_id, scene_id, shot_no, shot_type, camera, duration, description, notes, sort_order | → scenes CASCADE |
| `chapter_versions` | id, project_id, chapter_id, source, title, content, words, created_at | → chapters CASCADE，按 (chapter_id, created_at DESC) 索引 |
| `foreshadows` | id, project_id, name, planted, payoff, status | → projects CASCADE |
| `providers` | id, name, family, kind(`openai`/`anthropic`/`google`/`mock`), mark, brand, base_url, api_key_enc, models(JSON), enabled_models(JSON), enabled, is_default, created_at, updated_at | 9 条内置（mock/deepseek/anthropic/openai/google/qwen/zhipu/moonshot/ollama） |
| `settings` | key TEXT PRIMARY KEY, value TEXT(JSON) | **单行 `key='app'`**，整份 AppSettings 存这一个 JSON |
| `ai_messages` | id, project_id, chapter_id(可空=项目级), role(`user`/`assistant`), content, provider_id, model_id, created_at | → projects CASCADE |

`AppSettings`（`software/src/shared/types.ts:65-73`）形状：
`{ profile{name,signature}, onboarding{completed}, appearance{theme,accent,customAccent,editorSize,reduceMotion}, prefs{pov,genre,aiLength,autoSave,style}, generation{temperature,streaming}, defaultModel{providerId,modelId}|null, fallbackModel|null }`

聚合读模型：`ProjectDetail = Project + chapters + characters + outline{acts,beats} + scenes + shots + foreshadows`（`types.ts:182-189`），一次 `GET /api/projects/:id` 返回整本书。

---

## 6. HTTP API（38 条，全部前缀 `/api`）

| 模块 | 路由 |
| --- | --- |
| 基础 | `GET /health` `GET /bootstrap`（projects+settings+providers+count） |
| 作品 | `GET /projects` `POST /projects` `GET /projects/:id` `PATCH /projects/:id` `DELETE /projects/:id` |
| 企划 | `POST /projects/:id/plan`（只预览不落库） `POST /projects/:id/plan/apply`（**覆盖式**写入） |
| 章节 | `POST /projects/:id/chapters` `PATCH /chapters/:id` `GET /projects/:id/versions` `POST /chapters/:id/versions` `POST /chapters/:id/versions/:versionId/restore` |
| 大纲 | `POST /projects/:id/beats` `PATCH /beats/:id` `DELETE /beats/:id` `PATCH /projects/:id/outline/reorder` |
| 人物 | `POST /projects/:id/characters` `PATCH /characters/:id` |
| 剧本 | `POST /projects/:id/scenes` `PATCH /scenes/:id` `POST /projects/:id/shots` `PATCH /shots/:id` `POST /scenes/:id/shots/generate` |
| 伏笔 | `POST /projects/:id/foreshadows` `PATCH /foreshadows/:id` |
| AI | `GET /projects/:id/messages` `POST /ai/stream`（SSE：`meta`/`delta`/`done`/`error`） |
| 设置 | `GET /settings` `PUT /settings` `GET /providers` `PATCH /providers/:id` `POST /providers` `POST /providers/:id/test` `POST /onboarding` |
| 导出 | `GET /projects/:id/export.docx` `GET /projects/:id/export`（Markdown） |

⚠️ 只有两个 DELETE：`/projects/:id` 和 `/beats/:id`。章节、人物、场次、分镜、伏笔**都没有删除接口**（见 RESEARCH P1-8）。

---

## 7. 关键用户旅程（onboarding → 新建 → 企划 → 写作 → 版本 → 导出 → 更新）

1. **Onboarding**（`pages/OnboardingPage.tsx`）
   `GET /bootstrap` → 若 `settings.onboarding.completed === false`，`App.tsx:31` 拦下所有路由只渲染 OnboardingPage。
   用户填笔名 + 选供应商 + 填 Key + 选模型 → `POST /onboarding`（服务端校验 key 是否可用/格式）→ `reload()` 放行。
2. **新建作品**（`components/NewProjectModal.tsx`）
   标题 + 类型 + 一句话 premise（可选）→ `POST /projects`（服务端同时建 1 个空章节 + 3 个空幕）→ 勾选「AI 企划」时 `POST /projects/:id/plan`（最长 90s）→ 进入 3。
3. **AI 企划预览**（`components/PlanReviewModal.tsx`）
   plan 只在内存里；逐项勾选幕/节拍/人物/首章 → `POST /projects/:id/plan/apply` → 服务端事务内**删光**该作品的 beats/acts/characters 再写入（`repository.ts:679-708`）。
4. **写作**（`pages/StudioPage.tsx`，738 行，最核心）
   `GET /projects/:id` → 左栏章节列表 + 中栏 contentEditable 正文 + 右栏 AI（流式对话 / 选区改写 / 插入正文）。
   输入 → 800ms 防抖 `PATCH /chapters/:id` → 顶部「已保存」状态；切章先 flush 再切。
5. **版本**（右侧「版本」面板）
   `GET /projects/:id/versions`；只有**手动** `POST /chapters/:id/versions` 才产生快照（当前实现：AI 改写/插入前后各打一次）→ 对比、`restore` 回滚（会重写编辑器 innerHTML）。
6. **导出**（顶栏两个 `<a href>`）
   `export.docx`（docx：封面 + 章节/场次 + 人物附录）或 `export`（Markdown：整本）。文件名走 RFC 5987 `filename*=UTF-8''`，中文标题正常。
7. **更新**（仅桌面端，`desktop/main.cjs:108-174`）
   启动 8s 后 `electron-updater` 查 GitHub Releases → 有新版弹「更新并重启 / 稍后」→ 下载进度只写日志 → `quitAndInstall`。开发版直接提示「不检查更新」。

---

## 8. 测试入口

| 层次 | 命令 | 做了什么 | 端口/数据 |
| --- | --- | --- | --- |
| 类型 | `pnpm typecheck` | `tsc --noEmit` 全量 | — |
| API 集成 | `pnpm test` | spawn 真服务，断言 clean install / onboarding 校验 / 建作品 / 企划预览不落库 / apply / 章节保存与字数 / 版本 ≥2 / restore / 节拍增删排序 / 人物编辑 / 伏笔状态 / 剧本 6 个分镜 / 删作品后 404 | 8799，`mkdtemp` 临时库 |
| 浏览器 E2E | `pnpm test:ui` | `pnpm build` 后跑 Playwright chromium：onboarding → first-run → 新建 → 逐项企划 → 自动保存 → 选区改写 → 版本对比恢复 → AI 流式/重新生成/插入 → 主题持久化 → 大纲拖拽 → 人物 → 剧本 → 作品设置；截图落 `software/screenshots/` | 8798，1440×900 |
| 桌面冒烟 | `pnpm desktop:test` | 起真 Electron（临时 `PW_DESKTOP_DATA_DIR`），写完文字关掉重开，断言内容还在、onboarding 不再出现 | 真 userData |
| CI | `.github/workflows/release.yml` | push main（忽略纯文档改动）→ 三平台矩阵构建 → 单点发布 `v0.1.<run_number>` | macos-14 / windows-latest / ubuntu-latest |

**测试覆盖缺口**（写 RESEARCH/实现时必须知道）：删除最后一个作品后重启、删除章节/人物/场次、导出文件名与空作品导出、服务端崩溃时的前端表现，都没有用例。

---

## 9. 已知约束与坑（代码级，非文档级）

1. **没有迁移框架**：`db.ts:15-165` 全是 `CREATE TABLE IF NOT EXISTS`。改字段名/加列对**已有库**不生效，必须手写 `ALTER TABLE` 或删库重建。
2. **首启播种的判断是错的**：`db.ts:166-170` 用「projects 表为空」当首启条件 → 用户删光所有作品后重启，`seedDatabase()` 会对固定的 provider id 再插一遍 → `UNIQUE constraint failed: providers.id`，而 `migrate()` 在 `index.ts:49` 是顶层无 try/catch 调用 → **进程直接退出**（已实测，见 RESEARCH P0-1）。日志还会骗人：只播种 providers/settings，却打印 `[db] seeded demo data`。
3. **两个 lockfile**：根目录没有 workspace 配置，`pnpm install` 不会装 `software/` 的依赖；CI 里也是 `pnpm install` + `pnpm -C software install` 两次。
4. **端口硬编码**：API 8787（`PORT` 可覆盖），Vite 5180 且 `strictPort: true` → 被占用直接启动失败，不自动换端口。
5. **dev 与 prod 的入口不同**：dev 必须开 5180（vite 提供页面 + 代理 API）；直接开 8787 会 404，因为 `PW_STATIC_DIR` 指向的 `software/dist` 只在 build 后存在。
6. **保存走 `innerText`**：`ChapterEditor.tsx:52-54` 保存的是纯文本，工具栏的加粗/斜体/引用/列表（`execCommand`）**不会被持久化**，刷新即丢。
7. **版本不随保存产生**：`repository.ts:191-208` 的 `updateChapter` 不写 `chapter_versions`，只有显式 `POST /chapters/:id/versions` 才快照。
8. **AI 流式的落库时机不对称**：用户消息在请求开始时写库（`ai.ts:245-253`），回复要等整段完成才写（`ai.ts:275-285`）；中止会在 `ai.ts:290-292` 直接 return → 已生成文本蒸发、只留一条无回答的提问。
9. **onboarding 是硬门槛**：`OnboardingPage.tsx:11` 过滤掉 `mock` 供应商，`:33` 要求非 ollama 必须有 API Key，`App.tsx:31` 未完成时连 `/settings` 都进不去 → 没有 Key 的人看不到界面。
10. **桌面端数据目录与仓库无关**：`main.cjs:75-77` 用 `app.getPath('userData')/data`，所以「换克隆目录」不会换库；想隔离测试要传 `PW_DATA_DIR`（`desktop-test.mjs` 就是这么做的）。
11. **`desktop/server.cjs` 是产物**：改任何 `software/src/server/*.ts` 后都必须 `pnpm desktop:prepare`（或 `pnpm desktop`），否则桌面端跑的是旧代码（约 2MB 的 bundle，时间戳可判断）。
12. **签名/公证缺失**：CI 默认 `CSC_IDENTITY_AUTO_DISCOVERY=false`，mac 包未签名 → 首次打开需右键「打开」；electron-updater 在未签名/未公证的 mac 上只能退化成下载重装。Windows 未签名，Linux 只有 AppImage 支持自动更新。
13. **`window-all-closed` 直接 `app.quit()`**（`main.cjs:296-298`）：macOS 上关窗即退出，不符合平台习惯，且**不会**给未落盘的 800ms 防抖保存任何机会。
14. **渲染进程没有 preload/IPC**：`main.cjs:98-103` 的 `server-exited` 消息没有任何监听者（`webPreferences` 只有 contextIsolation/sandbox），服务端崩溃时界面只能等下一次请求失败。
15. **无 ErrorBoundary**：`main.tsx` 只用 Provider 包裹，任一组件渲染抛错 → 整页白屏，用户无任何提示。

---

## 10. 发布与自动更新

- 触发：push `main`（`paths-ignore` 排除 README / desktop README / screenshots / prototype）或手动 `workflow_dispatch`。
- 版本号：`RELEASE_VERSION=0.1.${run_number}`，工作流里 `npm version` 写进两个 package.json。
- 三平台：macOS universal（dmg+zip）、Windows x64（nsis）、Linux x64（AppImage+deb），`electron-builder --publish never` 后由 `softprops/action-gh-release` 统一发 `v${version}`。
- 更新通道文件：`latest-mac.yml` / `latest.yml` / `latest-linux.yml` 必须一并上传，否则 updater 拉不到。
- 桌面端 `autoDownload = false`：发现新版先弹窗问，用户点「更新并重启」才下载。

---

## 11. 排错速查

| 症状 | 先看 |
| --- | --- |
| 页面打不开 / 白屏 | 开 8787 而不是 5180；console 报错（无 ErrorBoundary 会直接白） |
| 「无法连接本地服务」 | `desktop/main.cjs` 的 spawn 是否成功；`userData/logs/server.log`；`PORT` 被占用 |
| 桌面端数据「丢了」 | 看的是 `~/Library/Application Support/Inkquay/data/studio.db`，不是仓库 `software/data/` |
| 改了服务端桌面端没生效 | 忘了 `pnpm desktop:prepare`（`desktop/server.cjs` 是产物） |
| 启动就崩 `UNIQUE constraint failed: providers.id` | 命中坑 2：删库重来或先修 seed 逻辑 |
| UI 测试起不来 | `pnpm -C software exec playwright install chromium`；`dist/index.html` 是否已 build |
| AI 报「尚未配置 API Key」 | 设置 → 模型，供应商 `configured=false`；mock 供应商只能手动启用（onboarding 里看不到） |
