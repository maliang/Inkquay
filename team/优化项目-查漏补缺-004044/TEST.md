# 测试（TEST）

## 结论

**通过（方案 A 范围 + 项目 JSON bundle）**。所有本轮改动的自动化回归均通过；打包版只做了启动/关闭烟测，未在 Windows / Linux 真机运行。

## 命令与结果

| 命令 | 结果 |
|---|---|
| `cd software && pnpm typecheck` | 通过（无输出） |
| `cd software && pnpm test` | **17 组 API 集成测试全部 PASS** |
| `cd software && pnpm test:ui` | 构建通过；**10 组 Playwright UI E2E 全部 PASS** |
| `pnpm desktop:test` | **通过**：编辑 → 打字后立即关窗 → 重启 → 内容保留；onboarding 不重复 |
| `pnpm desktop:pack` | 通过；生成 `desktop/release/mac-arm64/Inkquay.app` |
| 打包版烟测 | 通过：包内 `preload.cjs` 存在，启动进入 onboarding，窗口可关闭退出 |

## 覆盖

- 首启 / 强制 onboarding / API Key 加密
- 删光作品后重启：不重复 seed、不崩
- 作品创建、默认三幕、AI 企划预览/逐项应用/取消
- 章节保存、字数回算、版本快照/对比/回退
- 停止生成保留半截并写入 `ai_messages.status='aborted'`
- 重新生成替换旧回复
- 消息按章节隔离；项目级消息只读 `chapter_id IS NULL`
- 大纲节拍、人物、伏笔、剧本场次、分镜
- 章节/人物/场次/镜头/伏笔删除
- Markdown / Word 导出；空正文导出返回 400 中文提示
- 项目 bundle 导出/导入；版本历史随包迁移
- 设置持久化；自动保存开关；写作偏好注入 AI 上下文
- 桌面端关窗落盘握手（preload + IPC + 5s 兜底）

## 未覆盖 / 未验证

- 真实 OpenAI / Anthropic / Gemini Key 的企划与流式请求（无可用 Key）
- Windows x64 / Linux x64 真机安装与升级
- macOS 签名/公证后的自动更新
- bundle 导入的 UI 全流程（API 已覆盖）
- 章节删除后的“不可恢复”没有回收站，这是有意边界
