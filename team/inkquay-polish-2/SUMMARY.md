# Inkquay 第二轮体验优化 · 交付汇总

- 基线：本地 `main` @ `4a43f42`（`feat: long-form polish (trash, book history, scoped export, release smoke)`）
- 本轮性质：只修「界面说的和 AI/数据实际做的不一致」与几处流程断点。**零 schema 变更、零新依赖、零 commit、不 push、不发版**，全部改动留在本地工作区。
- 用户向说明：[`docs/EXPERIENCE-FIXES-ROUND2.md`](../../docs/EXPERIENCE-FIXES-ROUND2.md)
- 交付状态（截至本文件）：A1–A6、D-1/D-2/D-3 已实现；t11 完成、F-1 关闭；t12 已对最终字节复验，t13/t14 两轮复审 `pass`；文档已同步，未发布、未 commit。

## 1. 任务与工件

| 任务 | 角色 | 产出 | 状态 |
| --- | --- | --- | --- |
| t1 审计流程断点 | researcher | `AUDIT.md`（241 行，2 blocker + 8 high + 12 medium + 12 low） | completed |
| t2 收敛范围 | pm | `SPEC.md`（274 行，P0=B-1/B-2、P1=H-4′/H-1/H-5、测试补口 T1–T5） | completed |
| t3 设计契约与验证 | architect | `PLAN.md`（583 行）、`DECISIONS.md`（191 行） | completed |
| t4 服务端/数据层实现 | backend | `ai.ts` / `utils.ts` / `plan.ts` / `repository.ts` / `types.ts` / `api-test.mjs` | completed |
| t5 客户端实现 | frontend | `App.tsx` / `closeGuard.ts`(新增) / `StudioPage` / `LibraryPage` / `CodexPage` / `SettingsPage` / `ProjectSettingsModal` / `api.ts` / `app.css` / `ui-test.mjs` | completed |
| t6 独立验收 | qa | `VERIFY.md`（231 行）+ `evidence/` 5 个可复跑探针 | completed |
| t7 服务端评审 | reviewer | verdict=pass，无 blocker | completed |
| t8 客户端评审 | reviewer | verdict=pass，4 条非阻塞观察 | completed |
| t9 文档与交付说明 | docs | 根 `README.md`、`software/README.md`、`desktop/README.md`、`docs/EXPERIENCE-FIXES-ROUND2.md`（新）、`docs/RELEASE-ACCEPTANCE.md`、本文件 | completed |
| t10 示意标记与三幕真值 | frontend | 按主人决策实现 D-1 / D-2，并补真实场数进度 | completed |
| t11 桌面关窗耗时回归 | qa | `scripts/desktop-test.mjs` 补 `< 2500ms` 断言 + 写作台超时 8000→4000ms | completed |
| t12 当前字节复验 | qa | 按 t10/t11 后的最终字节重跑 A1–A6、D-1/D-2/D-3 与桌面回归 | completed |
| t13 / t14 当前字节复审 | reviewer | 服务端 / 客户端复审，均 verdict=pass | completed |

工件索引（都在 `team/inkquay-polish-2/`）：

- `AUDIT.md` 审计原始清单（B/H/D 编号为审计自带，与 SPEC 的 D-1..D-3 不同名）
- `SPEC.md` 本轮范围与逐项验收断言
- `PLAN.md` 文件所有权、契约、改动面、验证方案
- `DECISIONS.md` 设计期决策与被否方案（D-01…D-13）
- `VERIFY.md` 独立验收记录、改前红数据、边界矩阵
- `evidence/qa-a1-probe.mjs`、`qa-a2-probe.mjs`、`qa-a6-probe.mjs`、`qa-close-probe.mjs`、`qa-settings-null.mjs`

## 2. 修复清单（A1–A6）

| # | 问题 | 修复要点 | 主要文件 |
| --- | --- | --- | --- |
| A1 | 未配置默认模型时静默用 `mock` 生成并入库 | 解析后六步校验（无默认模型 / 只给一半 / 供应商不存在 / 未启用 / 模型不在启用列表），全部在 `saveMessage` 之前抛，零副作用；拒绝文案统一由 `utils.ts` 导出；前端发送前先 toast；显式 mock 仍可用 | `server/ai.ts`、`server/utils.ts`、`server/plan.ts`、`server/repository.ts`（`providerModelIds`）、`client/pages/StudioPage.tsx` |
| A2 | 删除作品一次 `window.confirm` 即硬删 | 两步式确认页：7 项真实影响计数（章节 / 回收站章节 / 场次 / 分镜 / 人物 / 伏笔 / 历史版本）、必须手输书名、清单失败可重试不阻塞、404 友好刷新、取消类操作不发 `DELETE` | `client/components/ProjectSettingsModal.tsx`、`client/api.ts`（`error.status`）、`client/styles/app.css` |
| A3 | 剧本卡点「继续写作」落进章节写作台；书架「0 章 0 页」 | `StudioRoute` 仅对 `/project/:id` 且 `type==='screenplay'` 重定向到 `/screenplay`（outline/codex 放行防死循环）；`StudioPage` 载入兜底在 `rememberProject` 之前；书架按类型显示场次 / 分镜，计数来自服务端 `sceneCount` / `shotCount` | `client/App.tsx`、`client/pages/StudioPage.tsx`、`client/pages/LibraryPage.tsx`、`shared/types.ts`、`server/repository.ts`（`SUMMARY_COUNTS`） |
| A4 | 设定页声称「已进入 AI 写作上下文」，另有 72% 假进度条 | 统一改为「设定索引 / 本地保存 + 写作时手动引用」；删除假进度条；写作台伏笔 chip 加「手动引用」。**不改** `buildWritingContext` 注入逻辑 | `client/pages/CodexPage.tsx`、`client/pages/StudioPage.tsx` |
| A5 | 非写作台关窗固定等 5 秒兜底；多处监听有双 ack 丢稿风险 | 新增 `closeGuard.ts` 注册表单例；`App.tsx` 挂全应用唯一 `onCloseRequest`；`StudioPage` 只注册 guard（落盘失败 → 不关窗）；主进程 5 秒兜底保留 | `client/lib/closeGuard.ts`(新增)、`client/App.tsx`、`client/pages/StudioPage.tsx` |
| A6 | 保存任何供应商都会把默认模型改回该供应商第一个启用模型 | 弹窗内显式 `providerDefaultChoice`（默认「不设为默认」，仅当前默认属于该供应商时回显）；只在「用户显式选择」或「当前默认失效」时写 `defaultModel` | `client/pages/SettingsPage.tsx` |

未改：`server/db.ts`（建表与轻量自愈迁移都在这里）、`seed.ts`（零 schema 变更）、`software/package.json`（零依赖）、`desktop/`。根 `scripts/` 仅 `desktop-test.mjs` 被 t11 改动。

## 3. 验证

四条命令在 macOS / Node v26.11.1 / pnpm 10.34.7 上实跑（t12 对 t10 收口后的最终字节复验；t13/t14 分别重跑对应门禁）：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0，20 条 PASS，末行 `All API tests passed.` |
| `pnpm test:ui` | exit 0，23 条 PASS，末行 `All UI tests passed.` |
| `pnpm desktop:test` | exit 0，`PASS studio dirty close 273ms (<4000ms)` / `PASS T3 settings close 266ms (<2500ms)` / `Desktop E2E passed.` |

桌面回归的两条耗时断言由 t11 补进 `scripts/desktop-test.mjs`（+22/−1）：非写作台页面 `/settings` 关窗 < 2500ms，写作台用例超时从 8000ms 收紧到 4000ms（8000ms 会掩盖 `main.cjs` 的 5 秒兜底）。改前红：t11 在 `4a43f42` 上实测设置页关窗 5152ms。

新增测试：

- API：`T1 screenplay markdown + docx export (and empty screenplay guard)`、`T2 screenplay bundle keeps scenes + shots`、`T5 unconfigured model refuses instead of silently mocking`
- UI：`A3 screenplay routing + library counts + export scope reset`、`A4 context wording aligned`、`A2 delete requires typed title + impact list`、`A6/T4 provider save keeps default model`、`A1-UI no default model prompt`

改前红（在 `4a43f42` 的真实构建上实测）：

| 事项 | 改前 | 改后 |
| --- | --- | --- |
| 未配置模型静默 mock | HTTP 200 + `meta.provider=本地演示` + 51 delta + 0 error + 消息落库 | 200 + 1 条 error + 0 delta + 消息数不变 |
| 非写作台关窗 | `/settings` 5164ms（t11 在基线复测 5152ms） | 273ms（guard 失败场景窗口 7s 仍存活）；`desktop:test` 现断言 < 2500ms |
| 剧本落进写作台 | `/project/{剧本id}` 渲染章节写作台（目录 0 章、可新建章节） | 自动跳 `/screenplay`，`.doc-title-input` 计数 0 |
| 删除作品 | 一次确认即硬删 | 手输书名 + 7 项清单；Esc / 取消 / 遮罩 / 返回的 DELETE 计数恒 0 |
| 保存供应商 | 无条件写回 `enabledModels[0]` | 保存无关供应商 `defaultModel` 不变；停用默认供应商 → `null` |

边界实测：旧库升级（基线建库 → 新代码启动，作品 / 正文 / 场次 / 分镜 / 密钥全保留，导出与备份往返正常）、空库首启、清单失败重试、并发删除 404、未保存保护（dirty 关窗落盘；保存失败强制不关窗）。探针复跑命令见 `VERIFY.md`。

## 4. 需要认账的偏离（均已由 captain 认账）

| 编号 | SPEC 原文 | 实际实现与理由 |
| --- | --- | --- |
| D-01 | 关窗监听挂 `AppShell` | 改挂 `App.tsx` 最外层：`SettingsPage` / `OnboardingPage` 不渲染 `AppShell`，挂 `AppShell` 等于设置页没修；且主进程只有一个 `closeRequestWindow`，多监听会双 ack 丢稿 |
| D-03 | 剧本卡显示「N 场 · M 页」 | 改为「N 场 · M 个分镜」：`scenes` 没有字数 / 页数字段，旧 `{totalWords} 页` 对剧本恒为 0（假数字）；真要页数需新增 schema，超出本轮 |

其他设计期决策见 `DECISIONS.md`：D-02 只守 studio 路由、D-04 影响清单客户端聚合（服务端 `listProjectVersions` 过滤 `deleted_at`，会漏回收站章节）、D-05 A6 只做客户端条件写入、D-06 导出范围复位属防御性（当前无可达路径）、D-09 H-6 本轮不做、D-12 零 schema / 零依赖 / 零 commit。

## 5. 仍存在的边界与已知问题

第一轮验收发现的 F-1（`desktop:test` 缺非写作台关窗耗时断言）已由 t11 关闭，见 §3；下表是仍未解决的项。

| 编号 | 内容 | 计划 |
| --- | --- | --- |
| F-2 | 设置页「默认模型」下拉在 `defaultModel=null` 时视觉上仍选中第一项（卡片与请求都正确） | 下一轮加空值占位项 |
| F-3 | 剧本作品卡仍显示「0 字」；侧栏「最近更新」按章节数显示「0 章」 | 下一轮按类型隐藏 / 换口径 |
| H-6 | 本地服务异常退出（`server-exited`）无人接收，窗口白屏 | 下一轮（≤1h） |
| D-4 | 删除作品仍是级联硬删除，没有作品级回收站 | 下一轮候选 |
| — | 伏笔与人物关系未真正进入系统提示词（A4 只改说法） | 下一轮「方案 A」 |
| D-1 / D-2 | 大纲张力曲线 / 人物弧光、剧本「本场分析」原为硬编码示意数据 | 已完成（t10；t12/t13/t14 复验）：三幕卡改真实 `acts`，其余标「示意」 |
| O-1 | 剧本「生成分镜」是写死 6 条模板，不经模型却写真实数据 | 下一轮接真 AI 或改「示例模板」文案 |
| K-1 / K-3 | 剧本没有页数量纲；剧本导出入口只在剧本页 | 下一轮（需 schema 决策） |
| — | `theme.ts` 等未涉及；渲染层仍有 contentEditable、无鉴权 / 多用户 / 云同步等长期边界 | 见根 README「已知边界」 |

## 6. 交付状态与注意事项

- **未发布**：本轮不 push、不发版；工作区零 commit，`git log` 仍停在 `4a43f42`。
- **截图**：`software/screenshots/91-desktop-studio.png`、`99-new-project-empty.png` 曾被 `test:ui` 刷新，收尾时已 `git checkout --` 还原，不进入本轮 diff。
- **代码改动范围**（截至本文件，`git diff --stat 4a43f42`）：22 个已跟踪文件 `+926 / −114`（截图噪声已还原），另有 4 个未跟踪项：`software/src/client/lib/closeGuard.ts`、`docs/EXPERIENCE-FIXES-ROUND2.md`、`team/inkquay-polish-2/`、`.agent-teams/`。拆分看——A1–A6 + t11 的业务与测试改动 17 个文件 `+675 / −75`（评审时点口径），t10 的 D-1/D-2/D-3 与文档是后加的；t10 已由 t12/t13/t14 覆盖当前字节。
- **回滚**：`git checkout -- software` 即回到 `4a43f42`；按文件粒度回退见 `docs/EXPERIENCE-FIXES-ROUND2.md` §3。
- **发版前置**：t12 已按最终字节重跑四条验收命令；发版前确认 `pnpm desktop:test` 输出含 `PASS T3 settings close <N>ms (<2500ms)`。

## 7. 下一轮候选（按性价比）

1. H-6：接收 `server-exited`，给出可重试提示（≤1h）
2. F-2 / F-3：设置页默认模型空值占位、剧本卡字数与侧栏统计口径
3. 作品级回收站（D-4）
4. 伏笔 / 关系真正进入提示词（A4 方案 A）
5. 剧本页数量纲与导出入口前移（K-1 / K-3）
6. `PUT /api/settings` 的默认模型一致性软校验；A2 影响清单收进服务端（去掉 N+1 请求）
