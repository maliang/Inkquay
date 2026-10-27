# PLAN · 私家写手第二轮体验优化（前后端改动契约与验证方案）

基线：本地 main `4a43f42`　｜　输入：`team/inkquay-polish-2/SPEC.md`（A1–A6）、`AUDIT.md`　｜　不 push、不发版、本轮不产生 commit

本文件把 SPEC 落成**可并行施工的契约**：每个条目给出文件级改动清单、API/类型契约、失败路径、断言与验收命令，并划定 t4（实现）/ t5（验证）/ t6（评审）的写入边界。所有行号以 `4a43f42` 为准；实现时先用 `grep -n` 复核锚点，行号漂移不算改动依据。

---

## 1. 施工轨道与文件所有权（防冲突的硬约束）

| 轨道 | 文件（全部相对仓库根） | 条目 | 可并行 |
| --- | --- | --- | --- |
| **BE**（后端，1 人） | `software/src/server/ai.ts` | A1 | 是 |
| | `software/src/server/utils.ts` | A1（新增两条文案常量） | |
| | `software/src/server/plan.ts` | A1（引用同一常量） | |
| | `software/src/server/repository.ts` | A1（`providerModelIds`）、A3（`sceneCount`/`shotCount`） | |
| | `software/src/shared/types.ts` | A3（`ProjectSummary` 加字段） | |
| | `software/scripts/api-test.mjs` | T1/T2/T5 + A1-API + A3-导出 API | |
| **FE**（前端，**1 人一次改完**） | `software/src/client/pages/StudioPage.tsx` | A1-UI、A3、A4、A5 | 内部串行 |
| | `software/src/client/App.tsx` | A3 路由守卫、A5 单监听 | |
| | `software/src/client/lib/closeGuard.ts`（新增） | A5 | |
| | `software/src/client/pages/LibraryPage.tsx` | A3 | |
| | `software/src/client/pages/CodexPage.tsx` | A4 | |
| | `software/src/client/pages/SettingsPage.tsx` | A6/H-7 | |
| | `software/src/client/components/ProjectSettingsModal.tsx` | A2 | |
| | `software/src/client/api.ts` | A2（错误对象带 `status`） | |
| | `software/src/client/styles/app.css` | A2（危险确认区样式） | |
| | `software/scripts/ui-test.mjs` | A1-UI/A2/A3/A4/A6 | |
| **DT**（桌面测试，归 FE） | `scripts/desktop-test.mjs` | T3 | 与 FE 主改并行（不同文件） |
| **VERIFY**（t5） | 只读源码；可写 `team/inkquay-polish-2/VERIFY.md`；临时脚本只许放 `/tmp` | — | — |
| **REVIEW**（t6） | 只读源码；可写 `team/inkquay-polish-2/REVIEW.md` | — | — |

**禁止清单（写作用域越界即评审退回）**

1. BE **不得**触碰 `software/src/client/**`、`*.css`、`ui-test.mjs`、`desktop-test.mjs`。
2. FE **不得**触碰 `software/src/server/**`、`software/src/shared/types.ts`、`api-test.mjs`。
3. 谁都不许改 `db.ts`（本轮**零 schema 变更**）、`package.json`、`tsconfig.json`、`vite.config.ts`、`desktop/main.cjs`、`desktop/preload.cjs`。
4. `StudioPage.tsx` **只有一个 owner**（FE）。若 captain 拆出两个 FE，则 A1-UI/A3/A4/A5 必须同属一人，另一人不得打开该文件；BE 与 DT 一律不碰。
5. 本轮不 commit：`git status` 只允许出现 `software/src/**`、`software/scripts/**`、`scripts/desktop-test.mjs` 的修改，以及 `team/`、`.agent-teams/` 未跟踪。

**依赖顺序**：BE 先落 `shared/types.ts` + `repository.ts` 的 `sceneCount/shotCount`（FE 的 A3 展示依赖类型）；FE 的 A2/A5/A6 不依赖 BE，可立即开工。`api-test.mjs` 与 `ui-test.mjs` 由不同 track 拥有，天然无冲突。

---

## 2. 契约总表

| ID | 变更性质 | 对外契约变化 | 失败路径 | 断言位置 |
| --- | --- | --- | --- | --- |
| A1 | 行为收紧 | SSE `{type:'error'}` 新增三种拒绝（无默认模型 / 供应商不存在或未启用 / 模型不在可用列表）；HTTP 仍 200 | 抛错发生在 `saveMessage` 之前 → 零副作用 | `api-test.mjs`（T5）、`ui-test.mjs`（toast） |
| A2 | 交互加固 | 无 API 变化；前端 `request()` 抛出的 `Error` 增加只读属性 `status?: number` | 清单拉取失败 → 显示可重试，不阻塞（输入书名仍是主闸门）；404 → 提示 + 刷新列表 | `ui-test.mjs` |
| A3 | 新增只读字段 + 路由守卫 | `ProjectSummary` 增 `sceneCount: number`、`shotCount: number`（向后兼容，仅新增） | 摘要缺失时 StudioPage 内部二次兜底 | `ui-test.mjs`、`api-test.mjs`（导出） |
| A4 | 纯文案 | 无（不改 `buildWritingContext`） | 不适用 | `ui-test.mjs` 文本断言 |
| A5 | 新增内部模块 | 无（`window.inkquayDesktop` 契约不变，仍只 ack 一次） | guard 抛错/返回 false → `cancelClose()`，窗口不关 | `desktop-test.mjs` |
| A6 | 交互修正 | 无 API 变化；`PUT /api/settings {defaultModel}` 的**触发条件**收窄 | 保存失败仍 toast，默认模型保持原值 | `ui-test.mjs`（T4） |

---

## 3. A1 · 未配置模型不得静默回退演示模型（P0，BE + FE 提示）

### 3.1 现状锚点

`software/src/server/ai.ts:239-252`（`streamAssistant` 选 provider/model 处；实现前用 `grep -n "mock-writer" software/src/server/ai.ts` 复核）

```ts
const providerId = opts.providerId || settings.defaultModel?.providerId || 'mock';
const modelId = opts.modelId || settings.defaultModel?.modelId || 'mock-writer';
```

`saveMessage(...)` 在 `:254-263`，即**任何在 239 之前完成的校验都天然零副作用**。`software/src/server/utils.ts` 目前只有 `countWords/now/uid`，适合放共享文案。`software/src/server/plan.ts:127-129` 已有正确态度：`if (!modelRef) throw new Error('还没有选择默认模型，请到设置中配置');`（`grep -n "还没有选择默认模型" software/src/server/*.ts` 复核）。

### 3.2 改动清单

**BE**

1. `software/src/server/utils.ts` —— 新增并导出：
   ```ts
   export const AI_NO_DEFAULT_MODEL = '还没有选择默认模型，请到设置中配置';
   export const AI_NO_MODEL_SELECTED = '还没有选择模型，请到设置中配置';
   ```
2. `software/src/server/plan.ts:127-129` —— 改抛 `new Error(AI_NO_DEFAULT_MODEL)`（仅统一文案，逻辑不动）。
3. `software/src/server/repository.ts`（`providerInfo`（`:300-321`）之后，紧邻 `:329` 的 `getProviderRow`）—— 新增（复用 `:35` 的私有 `parseJson`）：
   ```ts
   /** 供应商可用的模型 id：enabledModels 优先，未勾选过则回退全量 models */
   export function providerModelIds(id: string): string[] {
     const row = getProviderRow(id);
     if (!row) return [];
     const enabled = parseJson<string[]>(row.enabled_models, []);
     return enabled.length ? enabled : parseJson<ModelInfo[]>(row.models, []).map((m) => m.id);
   }
   ```
   （复用文件内已有的私有 `parseJson`，不新写解析。）
4. `software/src/server/ai.ts:239-252` —— 用下面这段**替换**原两行与后续 `row` 校验，顺序即执行顺序：
   ```ts
   const explicitProviderId = (opts.providerId || '').trim();
   const explicitModelId = (opts.modelId || '').trim();
   const hasOverride = Boolean(explicitProviderId || explicitModelId);
   const fallback = settings.defaultModel;
   const providerId = explicitProviderId || (hasOverride ? '' : fallback?.providerId || '');
   const modelId = explicitModelId || (hasOverride ? '' : fallback?.modelId || '');
   if (!providerId) throw new Error(AI_NO_DEFAULT_MODEL);
   if (!modelId) throw new Error(AI_NO_MODEL_SELECTED);
   const row = getProviderRow(providerId);
   if (!row) throw new Error(`供应商「${providerId}」不存在，请到设置中重新选择`);
   if (!row.enabled) throw new Error(`「${row.name}」未在此工作台启用，请到设置中开启`);
   const allowedModels = providerModelIds(providerId);
   if (allowedModels.length && !allowedModels.includes(modelId)) {
     throw new Error(`模型 ${modelId} 不在「${row.name}」的可用列表里，请到设置中重新选择`);
   }
   ```
   其后 `const key = decryptSecret(...)`、`useMock`、`effectiveProviderId/effectiveModelId`、`saveMessage` **保持原样**（mock 仍走 `streamMock`，`effectiveModelId` 仍是 `mock-writer`）。
   `index.ts` **不改**：SSE 头在 `:420` 之前已 flush，`catch` 分支（`:437-443`）本来就把异常转成 `{type:'error'}`，HTTP 200 是既定协议。

**FE（StudioPage，A1 只这部分）**

5. `software/src/client/pages/StudioPage.tsx` —— `sendPrompt`（`:313` 起，`grep -n "async function sendPrompt"`）在 `if (!prompt || streaming || !project) return;`（`:316`）之后加前置拦截：
   ```ts
   if (!settings.defaultModel) { toast('还没有选择默认模型，请到设置中配置（右下角「管理供应商」）', 'warn'); return; }
   ```
   服务端仍是唯一权威；这里只为「点了没反应」兜住体验。
6. 同文件 `currentModel`（`:77`）在无默认模型时显示 `未配置模型`（替换当前 `选择模型`），保证 UI 与 A1 的报错口径一致。

### 3.3 失败路径 / 边界

| 场景 | 期望 |
| --- | --- |
| `defaultModel === null`，请求不带 provider/model | `AI_NO_DEFAULT_MODEL`；无 delta、无 `ai_messages`、章节 `content` 不变 |
| 显式 `providerId:'mock', modelId:'mock-writer'` | 正常流式，`meta.provider === '本地演示'`（**不许误伤**，ui-test/desktop-test 全靠它） |
| `providerId` 指向已停用供应商（如用户停用了 DeepSeek 但默认模型仍指向它） | 「…未在此工作台启用…」；这是本轮**有意**的行为变更（原来会静默取 mock） |
| provider 存在但 `modelId` 不在 `enabledModels` | 「模型 … 不在 … 可用列表里」 |
| `hasOverride` 但只给了 provider 没给 model | `AI_NO_MODEL_SELECTED`；**不再**借用 fallback 的 modelId（修 provider/model 错配） |

### 3.4 验收

```bash
pnpm -C software typecheck
pnpm -C software test        # 期望日志：PASS A1/T5 ...
```

---

## 4. A2 · 删除作品的人工确认与清单（P0，FE only）

### 4.1 现状锚点

`software/src/client/components/ProjectSettingsModal.tsx:48-60`（`remove()` 里一次 `window.confirm` → `api.deleteProject`）；脚注 `:74` 已经写「级联删除…无法撤销」（文案已正确，保留）。服务端硬删不改（`repository.ts:659-664`，级联由 FK 完成，`db.ts` 已确认 7 张子表全是 `ON DELETE CASCADE`）。

### 4.2 改动清单（FE）

1. `software/src/client/api.ts:16-27`（`request()`，抛错在 `:25`）—— 保留 message，附加状态码（向后兼容，其它调用点无需改）：
   ```ts
   if (!response.ok) {
     const error = new Error((data as any)?.error || `请求失败（${response.status}）`) as Error & { status?: number };
     error.status = response.status;
     throw error;
   }
   ```
2. `software/src/client/components/ProjectSettingsModal.tsx` —— 新 state：`confirmStep: 'idle' | 'confirm'`、`impact: DeleteImpact | null`、`impactError: string`、`typedTitle: string`。
   - 底部「删除作品」（`.modal__foot .btn--danger`，现有 `:83`）改为 `onClick={() => { setConfirmStep('confirm'); void loadImpact(); }}` —— **不弹 `window.confirm`**。
   - `loadImpact()`（客户端聚合，遵守 SPEC「服务端不变」）：
     ```ts
     const [{ project }, { chapters: trashed }, { versions }] = await Promise.all([
       api.project(project.id), api.trashChapters(project.id), api.versions(project.id),
     ]);
     // 列表接口只统计未删除章节的版本；回收站章节的版本仍会被级联删除 → 逐章补拉
     const trashedVersions = await Promise.all(trashed.map(async (c) => (await api.versions(project.id, c.id)).versions.length));
     setImpact({
       chapters: project.chapters.length, trashedChapters: trashed.length,
       scenes: project.scenes.length, shots: project.shots.length,
       characters: project.characters.length, foreshadows: project.foreshadows.length,
       versions: versions.length + trashedVersions.reduce((a, b) => a + b, 0),
     });
     ```
     `api.versions(projectId, chapterId)` 走 `listChapterVersions`，不按 `deleted_at` 过滤，回收站章节也能取到（`repository.ts:964-966`）。
   - 确认区（`confirmStep === 'confirm'` 时渲染在 `wizard-body` 之后、`modal__foot` 之前），**稳定 class 名供测试选择**：
     ```
     .danger-confirm            // 容器，内含 <h3>永久删除《书名》</h3>
     .danger-confirm ul li      // N 行清单：章节 / 回收站章节 / 场次 / 分镜 / 人物 / 伏笔 / 版本
     .danger-confirm input      // 输入作品名
     .danger-confirm .btn--danger  // 最终「永久删除」
     ```
   - 闸门：`const canDelete = confirmStep === 'confirm' && typedTitle.trim() === project.title.trim() && impact !== null && !busy;` → 最终按钮 `disabled={!canDelete}`。清单加载中按钮显「正在统计…」，失败显「清单暂时取不到，可重试」且**仍允许**（输入书名是主闸门）。
   - `remove()`（只在 `canDelete` 时可达）：
     ```ts
     try {
       await api.deleteProject(project.id);
       await reload();
       toast(`《${project.title}》已删除`);
       navigate('/');
     } catch (err) {
       const status = (err as { status?: number })?.status;
       if (status === 404) { toast('这部作品已经不存在了，已为你刷新列表', 'warn'); await reload(); navigate('/'); return; }
       toast(err instanceof Error ? err.message : '删除失败', 'warn');
       setBusy(false);
     }
     ```
   - Esc / 点遮罩 / 取消：只 `setConfirmStep('idle')` 或 `onClose()`，**任何路径都不得调用 `DELETE`**。
3. `software/src/client/styles/app.css`（文件尾部，跟随现有 `--accent` 等已有变量；**不要发明变量名**）—— `.danger-confirm` 区块：警示底色、清单两列、输入框与危险按钮间距。约 25-35 行。
4. 文案硬要求：确认区必须出现「不可恢复/无法撤销」；**禁止**出现「可在回收站恢复」。

### 4.3 失败路径

| 场景 | 期望 |
| --- | --- |
| 清单请求 500/超时 | 显示「清单暂时取不到，可重试」+ 重试按钮；删除按钮仍受书名闸门约束 |
| 作品已被别处删除（404） | toast + 刷新列表 + 回作品库，不白屏 |
| 名字前后空格 | `trim()` 后比较，允许 |
| 输入中按 Esc | 关闭确认区，零 DELETE 请求 |

### 4.4 验收

```bash
pnpm -C software test:ui
```

ui-test 新增（放在“归档可见性”用例之后，用**独立**的临时作品 `E2E 待删`，避免污染既有断言）：

1. 新建普通小说（不勾 AI 企划）→ 打开 `.modal--project-settings`（顶栏齿轮或卡片 `__more`）→ 点 `.modal__foot .btn--danger`。
2. `await expect(.danger-confirm).toBeVisible()`；断言 `.danger-confirm .btn--danger` 的 `disabled === true`。
3. `page.on('request')` 收集 method === 'DELETE' 的 URL；`.danger-confirm input` 填错名 → 仍 disabled；填 `E2E 待删` → 变 enabled；此时断言 DELETE 集合为空。
4. 点最终按钮 → 等 `waitForURL(base + '/')` → 断言 `.project-card` 里没有 `E2E 待删`；`page.request.get('/api/projects/{id}')` 状态 404。
5. 打印 `PASS A2 delete requires typed title + impact list`。

---

## 5. A3 · 剧本不进章节写作台 + 导出范围复位（P1，BE 字段 + FE 路由/展示）

### 5.1 现状锚点（实测）

- 进入 `/project/:id` 的入口 5 处：`LibraryPage.tsx:211`（英雄卡「继续写作」）、`OutlinePage.tsx:162/223`、`CodexPage.tsx:142`、`StudioPage.tsx` 自身 tab；`LibraryPage.tsx:98/242` 已按类型分流。
- `exportScope` 是 `StudioPage.tsx:52` 的局部 state，初值 `'book'`，载入 effect（`:79-120`）没有复位它。
- `ProjectSummary`（`types.ts:75-87`）只有 `chapterCount`；剧本 `chapter_count` 恒 0 → 英雄卡「0 章 0 字」、卡片「0 页 · 0 场」。
- 导出后端**已支持剧本**：`index.ts:362-376/397-413` 与 `docx.ts:33-46` 都走 `scenes`。T1 只是补断言，不是补功能。

### 5.2 改动清单

**BE**

1. `software/src/shared/types.ts:75-87` —— `ProjectSummary` 增两个**必填**字段：
   ```ts
   sceneCount: number;
   shotCount: number;
   ```
   （`Project extends ProjectSummary`、`ProjectDetail extends Project`，因此 `getProjectDetail` 的返回也必须带上，见下条。）
2. `software/src/server/repository.ts` —— 新增共享 SQL 片段并让两处查询共用：
   ```ts
   const SUMMARY_COUNTS = `
     (SELECT COUNT(*) FROM chapters c WHERE c.project_id = p.id AND c.deleted_at IS NULL) AS chapter_count,
     (SELECT COUNT(*) FROM scenes s WHERE s.project_id = p.id) AS scene_count,
     (SELECT COUNT(*) FROM shots s WHERE s.project_id = p.id) AS shot_count`;
   ```
   - `listProjects()`（`:150-157`）与 `getProjectDetail()`（`:159-186`）的 `SELECT p.*, <旧子查询> FROM projects p ...` 换成 `SELECT p.*, ${SUMMARY_COUNTS} FROM projects p ...`（`getProjectDetail` 需保留 `WHERE p.id = ?`）。
   - `projectSummary()`（`:44-58`）增 `sceneCount: Number(row.scene_count || 0), shotCount: Number(row.shot_count || 0),`。

**FE**

3. `software/src/client/App.tsx` —— `/project/:projectId` 路由包一层守卫（覆盖手输 URL、历史前进后退、Rail「写作台」兜底）：
   ```tsx
   function StudioRoute() {
     const { projects } = useApp();
     const { projectId } = useParams();
     const target = projects.find((p) => p.id === projectId);
     if (target?.type === 'screenplay') return <Navigate replace to={`/project/${target.id}/screenplay`} />;
     return <StudioPage />;
   }
   ```
   **只守 studio 路由**：`/outline`、`/codex` 不重定向 —— 剧本页顶栏的「大纲 / 设定」tab 正指向它们，重定向会形成 tab 死循环（见 DECISIONS D-02）。
4. `software/src/client/pages/StudioPage.tsx` —— 三道改动：
   - 载入 effect（`:79-120`）里在 `const next = await api.project(projectId)` 之后加兜底（摘要过期/刚导入时的二次保险）：
     ```ts
     if (next.type === 'screenplay') { navigate(`/project/${next.id}/screenplay`, { replace: true }); return; }
     ```
     **必须在 `rememberProject(next.id)` 之前**，否则 `pw.lastProject` 会被写成剧本 id。需要新增 `useNavigate`（当前 imports 只有 `Link/useLocation/useParams`）。
   - 同一 effect 里 `setExportScope('book')`（与现有的 project/activeId/content 复位放一起）→ 防御「同一路由元素换 projectId 时状态串台」（正常操作不可达，见 §5.5）。
   - `exportBook`（`:654` 起）的 toast 文案保持 `${scope === 'chapter' ? '本章' : '全书'}`；剧本分支不再可达（被路由拦掉）。
5. `software/src/client/pages/LibraryPage.tsx`：
   - `:211` 英雄卡按钮改按类型：`navigate(hero.type === 'screenplay' ? `/project/${hero.id}/screenplay` : `/project/${hero.id}`)`。
   - `:203` 英雄卡计数：剧本 `<strong>{hero.sceneCount} 场</strong> <span className="muted">{hero.shotCount} 个分镜</span>`；小说保持原样。
   - `:213-216` 进度块 + `:220` mini：剧本不显示字数进度（`totalWords` 对剧本恒 0，显示「0 字」就是假话），改为 `<span>共 {hero.sceneCount} 场 · {hero.shotCount} 个分镜</span>`；小说分支不动。
   - `:247` 卡片 meta：剧本 `{project.sceneCount} 场 · {project.shotCount} 个分镜`；小说保持 `{totalWords} 字 · {chapterCount} 章`。
   - **不做**「页数」：数据模型没有页数，详见 DECISIONS D-03。
   - `:56` 统计卡「总章节」对剧本的计数保持现状（AUDIT L 级，本轮不动，记 known-bad K-2）。

### 5.3 失败路径

| 场景 | 期望 |
| --- | --- |
| 小说页点「正文」tab、大纲页「回到正文」、设定页「去写作」 | 仍进写作台，**无重定向循环**（回归断言） |
| 剧本页顶栏「大纲 / 设定」 | 正常进入 outline/codex（不被守卫拦截） |
| 作品摘要不在 `projects` 里（刚导入/被删） | 守卫放行，`StudioPage` 自己报「打不开这部作品」/二次兜底 |
| 剧本 `exportScope` | 不再可达（下拉本来就在 `project.type !== 'screenplay'` 时隐藏）；小说切作品复位为「全书」 |

### 5.4 验收

```bash
pnpm -C software typecheck
pnpm -C software test        # T1：剧本 md/docx 导出；空剧本 400
pnpm -C software test:ui     # A3a：英雄卡/直链 → /screenplay；A3b：切书回“全书”
```

### 5.5 关于 exportScope 复位：诚实标注为“防御性修复”

实测后确认：当前**没有任何 A 作品写作台 → B 作品写作台的直达链接**（Rail 的「写作台」总是回到当前 `pid`；`writeId` 只在当前项目是剧本时才切到第一部小说，且那条路径跨了 `/screenplay` 与 `/project/:id` 两个路由、StudioPage 会重新挂载）。所以跨作品残留**在正常操作下不可达**，`setExportScope('book')` 是防御性一行，用来保证“同一路由元素换 `projectId` 时状态不串”（浏览器前进/后退将来接上直达链接就会触发）。

因此 A3b **不作为改前必红项**：它在改前也会通过（因为切换时组件重新挂载）。t5 记录时应写明“回归保护通过”，不得伪称已取到红证据。


---

## 6. A4 · 上下文说法对齐（方案 B，纯文案；FE only）

### 6.1 现状锚点（全文检索结果，`grep -rn "已同步\|已进入\|自动引用\|已索引\|已启用记忆" software/src/client`）

- `CodexPage.tsx:156`：`长期记忆` + `已同步` 徽标 + `人物、秘密与关系已经进入 AI 的写作上下文。` + `<div className="pbar"><i style={{width:'72%'}}/></div>`
- `CodexPage.tsx:165`：`AI 已索引 N 位人物、M 条伏笔，写作时会自动引用。`
- `CodexPage.tsx:194`：`人物档案` + `已同步` 徽标
- `CodexPage.tsx` 伏笔弹窗提示：`伏笔会进入 AI 上下文，帮助模型避免遗忘。`；人物弹窗提示：`人物会进入 AI 写作上下文。`
- `StudioPage.tsx:952`：记忆卡 `已启用记忆` + chips（本章正文 / 人物 / 书名 / `伏笔 N`）

`buildWritingContext`（`repository.ts:436-454`）实际只注入：作品/类型/题材、写作偏好、梗概、当前章节标题、当前正文尾 4000 字、人物前 8、节拍前 12、最近 3 章。**不含伏笔、不含关系**。本轮不改它。

### 6.2 改动清单（逐句 before → after，测试按 after 断言）

| 位置 | before | after |
| --- | --- | --- |
| `CodexPage.tsx:156` 卡头 | `长期记忆` + `已同步` | `设定索引` + `本地保存`（`sync-dot` 保留样式，文案改，或换成 `local-dot`） |
| `CodexPage.tsx:156` 说明 | `人物、秘密与关系已经进入 AI 的写作上下文。` | `人物、秘密与关系保存在本地，写作时可在共笔面板引用。` |
| `CodexPage.tsx:156` 进度条 | `72%` 假完成度 | **删除该 `pbar`**（完整度算法不在本轮） |
| `CodexPage.tsx:165` | `AI 已索引 N 位人物、M 条伏笔，写作时会自动引用。` | `已记录 N 位人物、M 条伏笔；写作时可在共笔面板手动引用。` |
| `CodexPage.tsx:194` | `已同步` 徽标 | `本地` |
| 伏笔弹窗提示 | `伏笔会进入 AI 上下文，帮助模型避免遗忘。` | `伏笔保存在设定里，写作时可手动引用。` |
| 人物弹窗提示 | `人物会进入 AI 写作上下文。` | `人物设定保存在本地，写作时可引用。` |
| `StudioPage.tsx:952` 卡头 | `已启用记忆` | `写作上下文` |
| `StudioPage.tsx` 伏笔 chip | `伏笔 {n}` | `伏笔 {n} · 手动引用` |

禁用词（ui-test 断言页面文本不含）：`进入 AI 的写作上下文`、`已进入上下文`、`已同步`、`自动引用`、`已索引`。

### 6.3 验收

`pnpm -C software test:ui` 新增：进 `/project/{novelId}/codex` → 断言上述禁用词 `locator('body').innerText()` 全不出现，且 `设定索引`、`手动引用` 出现；进写作台 AI 面板 → 断言 `写作上下文` 与 `手动引用` 出现。

---

## 7. A5 · 非写作台关窗不再固定等 5 秒（P1，FE + DT）

### 7.1 现状锚点

`desktop/main.cjs:34-40`（`requestWindowClose`）关窗发 `inkquay:request-close` 并挂 5000ms 兜底；`:26-32`（`approveWindowClose`）清定时器；`:44-56` 两个 IPC 分支。唯一监听在 `StudioPage.tsx:224-247`（`grep -n "onCloseRequest"` 命中 `:227`）。`grep -rn "AppShell" software/src/client` 证明 **`SettingsPage` 与 `OnboardingPage` 不渲染 AppShell** —— 所以 SPEC 里「监听挂 AppShell」不足以覆盖设置页，必须上移到 `App.tsx`（DECISIONS D-01）。

### 7.2 改动清单

1. 新增 `software/src/client/lib/closeGuard.ts`：
   ```ts
   export type CloseGuard = () => boolean | Promise<boolean>;
   const guards = new Set<CloseGuard>();
   let running = false;

   export function registerCloseGuard(guard: CloseGuard): () => void {
     guards.add(guard);
     return () => { guards.delete(guard); };
   }

   /** 依次执行当前页 guard；任一失败或抛错 → false（调用方必须 cancelClose）。重入直接 false。 */
   export async function runCloseGuards(): Promise<boolean> {
     if (running) return false;
     running = true;
     try {
       for (const guard of [...guards]) {
         if (!(await guard())) return false;
       }
       return true;
     } catch {
       return false;
     } finally {
       running = false;
     }
   }

   export function closeGuardCount(): number { return guards.size; } // 调试/断言零泄漏
   ```
2. `software/src/client/App.tsx` —— 在 `App()` 顶部 hooks 区（**必须在任何 `return` 之前**）挂**唯一**监听：
   ```tsx
   useEffect(() => {
     const bridge = window.inkquayDesktop;
     if (!bridge) return;
     return bridge.onCloseRequest(() => {
       void (async () => { (await runCloseGuards()) ? bridge.readyToClose() : bridge.cancelClose(); })();
     });
   }, []);
   ```
   失败提示由各 guard 自己 toast（StudioPage 保留原文案），App 层不重复提示。
3. `software/src/client/pages/StudioPage.tsx` —— **删除** `bridge.onCloseRequest` 那个 effect，替换为 guard 注册：
   ```tsx
   useEffect(() => registerCloseGuard(async () => {
     if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
     const ok = await saveNow();
     if (!ok) toast('保存失败，窗口先不关闭，请重试', 'warn');
     return ok;
   }), [saveNow, toast]);
   ```
   （`saveNow` 是 `useCallback`，依赖 `[refreshVersions, toast]`，重注册频率可控。**禁止**两处监听并存：`main.cjs` 只有一个 `closeRequestWindow`，先 ack 会让窗口在保存完成前关闭。）
4. 其它页面不注册 guard：无 guard 时 `runCloseGuards()` 立即 `true` → 立刻 `readyToClose()` → 关窗 <1s。

### 7.3 失败路径

| 场景 | 期望 |
| --- | --- |
| 设置页/大纲页/设定页/剧本页关窗 | 立即 ack，不触发 5s 兜底 |
| 写作台 dirty 时关窗 | 先 `saveNow()` 落盘再 ack（现有行为不回退） |
| 保存失败 | `cancelClose()`，窗口不关，toast 原文案 |
| 连点两次关闭 | `running` 重入保护 → 第二次 `cancelClose()`（窗口保持） |
| 渲染层卡死 | `main.cjs` 的 5s 兜底仍在（**不改**），保证能退出 |

### 7.4 验收

```bash
pnpm desktop:test
```

`scripts/desktop-test.mjs` 改动：
- 现有“写作台输入后立即关窗仍落盘”用例：把 `setTimeout(..., 8000)` 收紧到 **4000**（否则 5s 兜底仍能假通过），并记录耗时打印。
- 新增（放在“重启后断言正文持久”之后，复用已启动的 `second`）：
  ```js
  const port = new URL(second.window.url()).port;               // 现有 :69 同款写法
  await second.window.goto(`http://127.0.0.1:${port}/settings`); // 整页加载 → 只有设置页，无写作台 guard
  await second.window.waitForSelector('.settings-route');       // SettingsPage 根节点 :203
  const exitPromise = second.app.process().once('exit');         // 先挂监听再关窗
  const t0 = Date.now();
  await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exitPromise;
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2500, `设置页关窗耗时 ${elapsed}ms，超过 2500ms（5s 兜底未修好？）`);
  console.log(`PASS T3 settings close ${elapsed}ms (<2500)`);
  ```
- 断言前先打印一行 `[改前基线] 设置页关窗约 5000ms`，供 verifier 对照“改前红”。

---

## 8. A6 · 供应商弹窗保存不得偷改默认模型（P1，FE only）

### 8.1 现状锚点

`SettingsPage.tsx:124-132`（`openProvider`，初始化在 `:130`）`setProviderDefault(provider.defaultModel || provider.enabledModels[0] || ...)` —— `provider.defaultModel` 是**服务端推导值**（`repository.ts:318`：`enabledModels[0] || models[0]?.id`），不是用户选择。`saveProvider()`（`:134-159`）在「当前默认供应商」被保存时无条件写回 `providerDefault`（`:148-150`） → 用户把默认模型选成 `deepseek-reasoner` 后，只要打开 DeepSeek 弹窗点保存，就被打回 `deepseek-chat`。

### 8.2 改动清单（FE）

1. `SettingsPage.tsx` —— `providerDefault` 改语义为 `providerDefaultChoice: string`（`''` = 不设为默认）：
   - `openProvider`（`:124-132`）：`setProviderDefaultChoice(settings.defaultModel?.providerId === provider.id ? settings.defaultModel.modelId : '')`。
   - 弹窗新增 `<select className="text-input provider-default-select">`（放在「可用模型」列表之后）：选项 `''` =「不设为默认」+ 每个 `providerModels` 里的模型。`disabled={!providerEnabled}`。
2. `saveProvider()`（`:134-159`）写回规则（**只在两种情况下动 `defaultModel`**）：
   ```ts
   const saved = result.provider;
   const isCurrent = settings.defaultModel?.providerId === saved.id;
   const allowed = saved.enabledModels;
   if (!saved.enabled || !saved.configured) {
     if (isCurrent) await updateSettings({ defaultModel: null });
   } else if (providerDefaultChoice && allowed.includes(providerDefaultChoice)) {
     if (!isCurrent || settings.defaultModel?.modelId !== providerDefaultChoice) {
       await updateSettings({ defaultModel: { providerId: saved.id, modelId: providerDefaultChoice } });
     }
   } else if (isCurrent) {
     const nextModel = allowed[0];
     await updateSettings({ defaultModel: nextModel ? { providerId: saved.id, modelId: nextModel } : null });
   }
   // 保存的不是默认供应商，且用户没显式选 → 一个字都不写
   ```
3. `toggleProvider()`（`:105-122`）补齐空分支：找不到 fallback 时 `await updateSettings({ defaultModel: null })`（否则默认模型指向已停用供应商，A1 会报错但 UI 仍显示旧模型）。

### 8.3 失败路径

| 场景 | 期望 |
| --- | --- |
| 保存非默认供应商（不动模型） | `settings.defaultModel` 完全不变 |
| 保存默认供应商、用户没改选择 | 维持原 `modelId`（不再回落到 `enabledModels[0]`） |
| 用户勾掉当前默认模型但仍勾了别的 | 默认模型切到 `enabledModels[0]`（保证「指向存在且已启用」） |
| 停用当前默认供应商且无 fallback | `defaultModel = null`，AI 面板显示「未配置模型」，点续写给引导 toast |
| 供应商弹窗全部模型被取消勾选 | 现有「至少启用一个模型」toast 拦住，不写默认模型 |

### 8.4 验收（T4，ui-test）

1. `page.evaluate` 读 `/api/settings` → 记 `baseline = defaultModel`（应为 mock/mock-writer）。
2. 打开 DeepSeek 供应商弹窗（已配置、非默认），勾上 `deepseek-reasoner` + 保存 → 断言 `defaultModel` 仍等于 `baseline`（**旧代码此处不动，属于回归保护**）。
3. 通过 API 把默认模型设为 `deepseek/deepseek-reasoner`（`PUT /api/settings`）→ reload。
4. 再打开 DeepSeek 弹窗、**什么都不改**直接「保存配置」→ 断言 `defaultModel.modelId === 'deepseek-reasoner'`（**旧代码此处变 `deepseek-chat`，改前必红**）。
5. 在同一弹窗里取消勾选 `deepseek-reasoner`（保留 `deepseek-chat`）→ 保存 → 断言 `defaultModel.modelId ∈ provider.enabledModels` 且等于 `deepseek-chat`。
6. 收尾把默认模型恢复为 mock/mock-writer（后续/A1-UI 用例依赖）；打印 `PASS A6/T4 provider save keeps default model`。

---

## 9. 数据、迁移与兼容策略

1. **零 schema 变更**：不新增表/列/索引，不写迁移。`db.ts` 不动 → 老库（含 `main` 上任意历史 `data/studio.db`）直接可用，无需 `pnpm seed`。
2. `ProjectSummary` 新增字段是**只增不改**：旧客户端读不到也无害；服务端所有构造点只有 `projectSummary()`（唯一），加字段不会漏。
3. `request()` 抛出的 Error 增加 `status`：纯增量属性，现有 `catch (err)` 分支只读 `message`，无需改。
4. AI 协议的 HTTP 状态不变（200 + SSE error）：前端 `streamChat` 的解析路径不变，只多一种 `error` 文案。
5. **有意改变的行为**（写进 release note 素材，不属回归）：
   - 未配置默认模型时 AI 生成从「静默演示模型」变为「明确报错」；
   - 默认模型的 provider 被停用/模型被取消勾选时，不再静默取别的模型，而是报错或切到同供应商其它已启用模型（A6）。
6. **回滚粒度**：每个 A 项都是独立文件集合；A1（`ai.ts/utils.ts/plan.ts/repository.ts` 的 `providerModelIds`）可单独 `git checkout --` 回滚，不影响 A2–A6。
7. 桌面端：`main.cjs` 的 5s 兜底与 `preload.cjs` 的接口**不改**，渲染层改动对老版本 Electron 主进程向后兼容（同一 IPC 契约）。

---

## 10. 测试矩阵 T1–T5

| ID | 文件 | 用例 | 断言（必须打印可读日志） | 改前红？ |
| --- | --- | --- | --- | --- |
| T1 | `api-test.mjs` | 剧本导出 | 新建剧本 + 2 场（含 heading）→ `GET /export` 200 含 `## 场景标题`；`/export.docx` 200、`PK` 开头、>1000 字节；空剧本 → 400 `这本还没有可导出的正文` | 否（补测） |
| T2 | `api-test.mjs` | 项目包完整性 | `bundle` → `import` 后：`chapters.length`、`scenes.length`、`characters.length`、`foreshadows.length`、`shots.length` 与源一致；导入作品正文首段一致 | 否（补测） |
| T3 | `scripts/desktop-test.mjs` | 关窗 flush | 写作台 dirty 关窗 → 进程退出 < 4000ms 且重启后正文含两段；设置页关窗 → < 2500ms | **是**（设置页 5s） |
| T4 | `ui-test.mjs` | 供应商保存 | §8.4 的 6 步 | **是**（默认模型被打回） |
| T5 | `api-test.mjs` | 未配置模型 AI | 空 `defaultModel`：200 + `"type":"error"` + 含「默认模型」+ 无 `"type":"delta"`；`messages` 0 条；章节 `content` 不变；恢复 mock 后正常 delta 且 `meta.provider === "本地演示"` | **是**（现在出 delta） |
| A2 | `ui-test.mjs` | 删除闸门 | §4.4 的 5 步（含“输入阶段零 DELETE 请求”） | **是**（现在一次 confirm 就删） |
| A3a | `ui-test.mjs` | 剧本路由 | 建剧本 → 作品库英雄卡 `继续写作` → URL `endsWith('/screenplay')`；`.panel` 含「场」不含「新建章节」；直接 `goto /project/{id}` → 同样落在 `/screenplay`；小说项目 `goto /project/{小说id}` 仍进写作台 | **是** |
| A3b | `ui-test.mjs` | 导出范围复位 | 写作台切「本章」→ 回作品库 → 打开另一部小说 → `.export-scope` 值 `book` | **否**（回归保护，见 §5.5） |
| A4 | `ui-test.mjs` | 文案一致性 | 禁用词不出现 + 新文案出现 | **是** |
| A6 | `ui-test.mjs` | 默认模型不被偷改 | 见 T4 | **是** |
| A1-UI | `ui-test.mjs` | 未配置模型点续写 | `PUT /api/settings {defaultModel:null}` → reload → 点「让 AI 续写」→ `.toast` 含「设置」→ `.editor` 文本不变 → 恢复 mock | **是** |

**改前红取证方法**（t5 执行，不动工作区历史）：

```bash
cd "$(git rev-parse --show-toplevel)"
git stash push -u -- software/src        # 只藏源码，保留新测试脚本
pnpm -C software test ; pnpm -C software test:ui ; pnpm desktop:test   # 期望红，逐条记录失败日志
git stash pop                            # 立刻恢复，并 git status 核对
```

---

## 11. 验收命令与期望输出

```bash
pnpm -C software typecheck                 # 0 error
pnpm -C software test                      # 末行 "All API tests passed."；含 PASS T1/T2/T5
pnpm -C software test:ui                   # 末行 "All UI tests passed."；含 PASS A1/A2/A3/A4/A6
pnpm desktop:test                          # "Desktop E2E passed."；含 PASS T3 settings close ...ms <2500
git status --porcelain                     # 只允许 §1 列出的路径 + team/ + .agent-teams/
```

verifier 需在 `VERIFY.md` 中逐条记录：命令、退出码、关键日志行、改前红证据、残留风险。

---

## 12. 本轮明确不修（写清楚，评审据此判越界）

| 编号 | 事项 | 理由 / 归属 |
| --- | --- | --- |
| H-2 / D-1 | 大纲页张力曲线、三幕卡、人物弧光（`OutlinePage.tsx:172/177/183/197-207`） | 等主人拍板「删 / 真算 / 标注示意」，本轮不动 |
| H-3 / D-2 | 剧本「本场分析」4.5/4.0/3.5（`ScreenplayPage.tsx:243`）+ 场次进度 38% | 同上，D-2 决策未回 |
| D-3 算法部分 | 记忆完整度真算（72% → 真实百分比） | 只做“去假承诺”文案（A4 已覆盖），不新增算法 |
| H-6 | `server-exited` 无人接收 → 服务崩溃白屏 | SPEC §10.3 明列下一轮（preload 监听 + 全局横幅，<1h） |
| H-1 方案 A | 真注入伏笔/关系进 `buildWritingContext` | captain 定本轮只走方案 B；真注入 + 预算上限列下一轮 |
| D-4 | 作品级回收站（`projects.deleted_at`、恢复/彻底删除、列表过滤） | 本轮删除**仍为硬删**；靠 A2 书名闸门兜住，文案只承诺「不可恢复」 |
| — | 跨幕拖拽、剧本 AI 企划、云同步、发版/签名、自动更新 | SPEC §10 非目标 |
| — | 全站重构、状态管理替换、新增运行时依赖、上下文预算算法 | 同上 |
| K-1 | 剧本「页数」 | 数据模型无页数，改用真实 `场 / 分镜`（D-03） |
| K-2 | 作品库「总章节」对剧本仍计 0 章；头部「下午好」硬编码 | AUDIT L 级，不在本轮验收面 |
| K-3 | 剧本导出仍只有剧本页顶部两个按钮（不在写作台加剧本入口） | SPEC §6.1-3 明确不新增入口 |

---

## 13. 风险与回滚

| 风险 | 控制 | 回滚 |
| --- | --- | --- |
| A5 双 ack 提前关窗丢稿 | 监听只在 `App.tsx` 一处；FE 在同一批删掉 StudioPage 旧监听；T3 覆盖 dirty 落盘 | 恢复 StudioPage 的 bridge effect + 删 App.tsx effect |
| A1 误伤显式 mock | `providerModelIds('mock')` 返回 `['mock-writer']`（`seed.ts:14-16`）；T5 断言显式 mock 仍流式；ui/desktop 全量回归 | 只回滚 `ai.ts` |
| A3 守卫造成小说跳转异常 | 守卫条件只看 `type === 'screenplay'`；ui-test 断言小说「返回正文」链路 | 删 `StudioApp` 守卫 + StudioPage 兜底 |
| A2 清单接口慢/失败 | 清单失败不阻塞；书名闸门本地即时可用 | 回滚 modal 到单 confirm（保留 api.ts status 亦无害） |
| A6 改坏出厂默认 | 只在「用户显式选择 / 当前默认失效」两条路径写；T4 三段断言 + 收尾恢复 mock | 回滚 `SettingsPage.tsx` 一个文件 |
| 决策项阻塞 | H-1→B、D-1/D-2/D-3→不动，本轮仍可完整验收 | — |

---

## 14. 执行顺序（给 captain 排 task 用）

1. **W1（BE）**：`types.ts` + `repository.ts`（`SUMMARY_COUNTS`/`sceneCount`/`shotCount`/`providerModelIds`）→ 立刻通知 FE 类型已就绪。
2. **W1（FE，可与 BE 并行）**：A2 → A5 → A6（都不依赖 BE）。
3. **W2（FE）**：A3（依赖 W1 的类型）+ A4 + A1-UI（StudioPage 同一批完成）。
4. **W2（BE）**：`ai.ts` + `utils.ts` + `plan.ts` + `api-test.mjs`（A1/T1/T2/T5）。
5. **W2（DT）**：`scripts/desktop-test.mjs`（T3）。
6. **W3（t5 验证）**：`typecheck` → `test` → `test:ui` → `desktop:test` + 改前红取证 → `VERIFY.md`。
7. **W4（t6 评审）**：只审契约、越界与“不做清单”，写 `REVIEW.md`（reviewer 不改代码）。
