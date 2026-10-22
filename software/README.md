# Inkquay · 私家写手 · 全栈开发版

<img src="public/logo.svg" width="68" height="68" alt="私家写手 logo" />

**Inkquay（私家写手）**：本地优先的 AI 长篇 / 短篇 / 剧本创作工作台。

当前为第五个可运行里程碑（Milestone 5）：作品库、写作台、真实 SQLite 持久化、自动保存、AI 流式共笔、模型供应商管理、主题设置、大纲 / 人物 / 剧本 / 伏笔的创建编辑与排序、作品设置/归档/删除、分镜板、Markdown / Word 导出，以及 API 集成测试与浏览器端 E2E。仓库根目录已切换为全栈入口。

> 根目录现在是全栈应用入口；早期静态原型归档在 `../prototype/`。本目录是实际软件工程。

## 快速开始

```bash
cd software
pnpm install
pnpm dev
```

- Web：http://127.0.0.1:5180
- API：http://127.0.0.1:8787

生产构建：

```bash
pnpm build
pnpm start          # 默认 http://127.0.0.1:8787，由 Express 同时提供 API 与前端
```

## 界面

| 作品库 | 写作台 |
| --- | --- |
| ![作品库](screenshots/70-library-final.png) | ![写作台](screenshots/71-studio-final.png) |

| 大纲 | 人物设定 |
| --- | --- |
| ![大纲](screenshots/72-outline-final.png) | ![人物设定](screenshots/73-codex-final.png) |

| 剧本 | 分镜板 |
| --- | --- |
| ![剧本](screenshots/74-screenplay-final.png) | ![分镜板](screenshots/85-storyboard-live.png) |

| 作品设置 | 模型与供应商 |
| --- | --- |
| ![作品设置](screenshots/86-project-settings-live.png) | ![模型与供应商](screenshots/76-settings-models-final.png) |

## 桌面版

macOS 桌面壳位于 [`../desktop/`](../desktop/README.md)，Electron 内置同一套 Express + SQLite 服务，不依赖用户安装 Node。

```bash
cd ..
pnpm desktop
pnpm desktop:pack
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + React Router 7 + Vite 8 + TypeScript |
| 后端 | Node.js 26 + Express 5 + TypeScript（tsx 运行） |
| 数据库 | Node 内置 `node:sqlite`（SQLite，WAL 模式） |
| AI | 服务端转发的流式适配器：OpenAI 兼容 / Anthropic / Gemini / 本地演示 |
| 样式 | 复用原型的 CSS 设计系统，四套主题 + 强调色 |

没有引入 ORM、UI 组件库或 Tailwind，保持本地优先和小依赖。

## 已实现

### 首次启动
- 两步引导：作者身份 → 模型接入
- 不填写称呼 / API Key 不能进入主界面
- 称呼、签名写入 SQLite，贯穿问候、头像、封面与导出署名

### 作品与写作
- 作品库从 SQLite 读取作品、章节数、总字数
- 新建作品（长篇 / 短篇 / 电影剧本 / 剧集）
- 写作台：章节树、正文编辑、标题编辑、字数 / 阅读时长
- 800ms 防抖自动保存，刷新后内容保留
- 新建章节，写入数据库
- 导出作品为 Markdown（`/api/projects/:id/export`）
- 导出 Word `.docx`（`/api/projects/:id/export.docx`）

### AI 共笔
- `POST /api/ai/stream` SSE 流式输出
- 上下文自动注入：当前章节、主要人物、秘密、关系、大纲节拍
- 首次启动强制接入真实供应商；本地 mock 仅作为后续可选备用
- OpenAI 兼容供应商：DeepSeek / OpenAI / 通义 / 智谱 / Moonshot / Ollama / OpenRouter 等
- Anthropic Messages 原生 SSE 适配
- Google Gemini `streamGenerateContent` SSE 适配
- 无 Key 时明确报错，不会假装调用成功
- 消息持久化到 `ai_messages`，刷新后可重新加载
- 插入正文、复制、停止生成

### 设置
- 四套主题：墨夜 / 雾蓝 / 苔青 / 宣纸
- 六种主题色 + 自定义颜色
- 正文字号、减弱动态效果
- 供应商配置：启用开关、API Key、Base URL、真实「检查连接」、模型启用列表
- 默认模型 / 备用模型 / temperature / 流式输出
- 供应商密钥在服务端用 AES-256-GCM 加密后保存，前端只拿到掩码
- 设置写入 SQLite，刷新后保留

### 作品管理
- 无演示数据，安装后空书房
- 作品库卡片可打开作品设置
- 编辑作品名、题材、目标字数、状态、故事梗概
- 归档作品
- 删除作品并级联清理章节、设定、场次、分镜、伏笔与 AI 消息

### 大纲 / 设定 / 剧本
- 大纲：三幕、场景列表；右侧表单可编辑标题、章节号、状态、摘要、标签；支持新增、上移 / 下移、拖拽排序、删除并持久化
- 设定：人物卡、人物档案、秘密与关系；支持新增人物、编辑档案；伏笔台账展示
- 剧本：场次列表、剧本纸面；支持编辑场景标题 / 地点 / 时间 / 正文 / 状态，新增场次
- 分镜板：每场可生成 6 个镜头草案，分镜卡可编辑景别、运镜、时长、画面与备注，保存到 SQLite
- 分镜生成目前是模板草案，不调用视觉模型

## 目录

```text
software/
├── src/
│   ├── client/              React 前端
│   │   ├── pages/           作品库 / 写作台 / 大纲 / 设定 / 剧本 / 设置
│   │   ├── components/      AppShell、Rail、Cover、编辑器、Toast
│   │   ├── context/         App 数据与设置上下文
│   │   ├── api.ts           REST + SSE 客户端
│   │   ├── theme.ts         主题 / 强调色应用
│   │   └── styles/          原型设计系统 + 应用补丁
│   ├── server/              Express API
│   │   ├── index.ts         路由
│   │   ├── repository.ts    业务查询
│   │   ├── ai.ts            AI 适配与流式响应
│   │   ├── crypto.ts        API Key 加密
│   │   ├── db.ts            schema / migration
│   │   └── seed.ts          供应商与默认设置（无演示作品）
│   └── shared/types.ts      前后端共享类型
├── data/                    SQLite 与本地密钥（运行时生成，不入库）
├── public/icons.svg         原型图标 sprite
└── README.md
```

## 数据与安全

- 数据库：`software/data/studio.db`
- 本地加密密钥：`software/data/.secret`（首次启动生成）
- API Key 加密后入库；接口只返回 `••••••••1234`
- 服务默认只监听 `127.0.0.1`，没有账号系统，适合单机使用
- 当前没有多用户、鉴权、云同步

## 测试

```bash
pnpm test       # API 集成测试：临时目录 + 独立 SQLite
pnpm test:ui    # 浏览器 E2E：构建后用独立 SQLite 启动生产服务
```

API 测试覆盖：bootstrap、创建/删除作品、章节保存与总字数回算、大纲场景创建/编辑/排序/删除、人物 CRUD、伏笔、剧本场次、分镜生成/编辑、设置持久化、供应商 Key 加密、AI SSE 与消息持久化、Markdown 导出。

UI E2E 覆盖：作品库、写作台自动保存刷新恢复、AI 流式生成 / 重新生成 / 插入正文、个人资料、主题刷新持久化、大纲编辑与拖拽、人物编辑、剧本编辑、分镜编辑、作品设置。

## API 摘要

```text
GET    /api/health
GET    /api/bootstrap
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
POST   /api/projects/:id/chapters
PATCH  /api/chapters/:id
POST   /api/projects/:id/beats
PATCH  /api/beats/:id
POST   /api/projects/:id/characters
PATCH  /api/characters/:id
POST   /api/projects/:id/scenes
PATCH  /api/scenes/:id
POST   /api/scenes/:id/shots/generate
POST   /api/projects/:id/shots
PATCH  /api/shots/:id
POST   /api/projects/:id/foreshadows
PATCH  /api/foreshadows/:id
GET    /api/projects/:id/messages?chapterId=
GET    /api/projects/:id/export
GET    /api/projects/:id/export.docx
GET    /api/settings
PUT    /api/settings
GET    /api/providers
POST   /api/providers
PATCH  /api/providers/:id
POST   /api/providers/:id/test
POST   /api/ai/stream            (SSE)
```

## 已知边界 / 下一阶段

- 大纲支持上移 / 下移 / 拖拽排序 / 删除；跨幕拖拽暂未开放
- 伏笔已支持新增和状态编辑
- 分镜生成为模板草案，尚未接视觉模型 / 镜头拖拽排序
- 还没有鉴权、多用户、云同步
- 富文本编辑器目前基于 contentEditable，后续可换 ProseMirror / Tiptap
- 供应商目录 / 自动获取模型列表仍是基础版
- 已有 API 集成测试；还缺 Playwright E2E、数据库迁移版本管理

## 参考

- [LobeHub · 界面外观](https://lobehub.com/zh/docs/usage/user-interface/appearance)
- [LobeHub · 使用模型服务商](https://lobehub.com/zh/docs/usage/providers)
- [Cherry Studio](https://cherryai.com/)
