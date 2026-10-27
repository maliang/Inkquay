# 任务

> 目标：优化项目，查漏补缺，调整不人性化的部分，修改流程不通的地方

- 模式：one-shot
- 交付：code+artifacts
- 固定角色：pm, architect, researcher, ui, backend, frontend, dba, sec, reviewer, qa, devops, docs
- 档位：标准档（standard）· 角色 ≤6 · 验收项 ≤30 · 有独立审查

- runId：优化项目-查漏补缺-004044
- 创建于：2026-10-27T00:40:44.797Z

## 完成标准

1. 用户确认 `PLAN.md` 范围后才开始改业务代码。
2. P0：删光作品重启不崩；生成停止/重生成/归属正确；导出失败不丢稿；加载失败有错误态；首启准入与文案一致。
3. P1：切章保存可靠、⌘S、未保存拦截、保存失败可重试；选区精确替换；企划可取消/失败可重试；删除级联；版本自动快照；Rail 不串项目；假数据清理。
4. `pnpm typecheck`、`pnpm test`、`pnpm test:ui` 全绿；桌面启动/新建/保存/重启 smoke 通过。
5. 交付代码 + 更新 `REVIEW.md`/`TEST.md`/`SUMMARY.md`/`RETRO.md`；本地 commit，不 push。

## 禁止操作

- 不 push、不触发 GitHub release、不改 `.github/workflows`。
- 不删用户 `data/`、不静默重置数据库、不覆盖用户正文。
- 不重写编辑器、不引入新运行时依赖、不做整库恢复（本轮）。
- 不拆除 onboarding 强制门；不把 mock 作为免 Key 入口。
- 不修改 `prototype/`、签名/公证/CI 发布流程。

## 状态

**deliver / completed**：用户已拍板「方案 A + 保留强制 onboarding + 项目 JSON bundle」，方案确认门已过。代码、测试、打包烟测与 run 工件已完成；本地 commit，**未 push**。

用户口径记录：
- 范围：方案 A（P0 + P1 日常体验），不做大重构。
- 首启：保留强制填写称呼与云 API Key；不把 mock 改成免 Key 入口。
- 备份：项目 JSON bundle，不含 `.secret`，不做整库恢复。
- 交付：工作区 + 本地 commit，不 push。
