# 任务总结（优化项目-查漏补缺-004044）

## 结论

**已交付（方案 A）**：完成 P0 全部修复 + P1 日常体验修复，代码、测试、打包与 run 工件均已落盘；本地 commit，**未 push、未触发 release**。

## 各任务交付

- **P0 数据与启动**：删光作品后重启不再二次 seed；`app_meta` 标记 + `INSERT OR IGNORE` 自愈；旧库可平滑启动。
- **P0 AI 流式**：停止生成保留已生成部分（`ai_messages.status='aborted'`）；重新生成替换旧回复；消息按章节严格隔离。
- **P0 加载失败**：写作台/大纲/设定/剧本加载失败显示错误页与重试，不再永久转圈。
- **P1 保存与关窗**：⌘S / Ctrl+S；切章前保存并阻止失败切换；关窗时渲染层先落盘、主进程收到 IPC 确认后再关闭，失败取消关闭。
- **P1 编辑体验**：选区改写按 DOM Range 精确替换，不再误伤同文首次出现；插入/替换保留原生撤销；自动保存与切章生成章节版本。
- **P1 AI 企划**：创建后可取消企划、失败可重试；取消/失败保留已创建作品；空项目可取消“AI 企划这一本”。
- **P1 删除与导出**：章节/人物/场次/镜头/伏笔删除；章节删除明示历史版本一并删除；导出改用 fetch+Blob，空作品返回中文错误。
- **P1 备份**：项目 JSON bundle 导出/导入，含章节、版本历史、大纲、人物、场次、分镜、伏笔；不含 API Key，不做整库恢复。
- **P1 文案与假数据**：清理作品库硬编码人物/引文/“本地演示模型”承诺；移除未实现的备用模型、流式输出开关和 G L 快捷键；mock 检查连接明确为“本地演示模型无需连接”。

## 关键改动

- `software/src/server/db.ts`、`seed.ts`：`app_meta`、`ai_messages.status`、幂等初始化。
- `software/src/server/ai.ts`、`repository.ts`、`index.ts`：半截落库、替换重生成、严格消息查询、五类删除、导出空守卫、bundle（含 versions）。
- `software/src/client/api.ts`、`StudioPage.tsx`、`ChapterEditor.tsx`、`NewProjectModal.tsx`、`PlanReviewModal.tsx`：保存/关窗/选区/企划/导出/备份。
- `software/src/client/pages/LibraryPage.tsx`、`CodexPage.tsx`、`OutlinePage.tsx`、`ScreenplayPage.tsx`、`SettingsPage.tsx`：导入、删除、错误态、假开关清理。
- `desktop/main.cjs`、`desktop/preload.cjs`、`package.json`：关闭握手 + preload 打包。
- `software/scripts/api-test.mjs`、`software/scripts/ui-test.mjs`、`scripts/desktop-test.mjs`：新增回归覆盖。

## 评审与测试结论

- spec-review 最初 CHANGES_REQUESTED；用户拍板 **A + 保留强制 onboarding + 项目 JSON bundle** 后实施。
- 实施后测试：`typecheck` 通过；API 17 组、UI 10 组、Desktop E2E 全过；`desktop:pack` 与打包版启动烟测通过。
- 详见 `TEST.md`；实施复审见 `REVIEW.md` 末尾。

## 与 PLAN 的差异（以用户拍板为准）

- 用户选择 **项目 JSON bundle**，因此 PLAN 中“整库 JSON + `.secret` / 恢复”未实施；bundle **不含 Key**，但保留章节版本历史。
- 章节删除采用**硬删 + 明确告知**，不承诺可恢复（FK CASCADE 下无法保留快照）。
- 保留强制 onboarding；没有把 mock 改成免 Key 入口。
- 备用模型、流式输出开关、G L 快捷键未实现，已从 UI 移除而不是保留假开关。

## 下一步

- 真实供应商 Key 的端到端验证、Windows/Linux 真机安装与更新验证。
- 项目 bundle 的 UI 导入回归（当前 API 覆盖）。
- 若需要“删除可恢复”，单独立项做软删/回收站。
