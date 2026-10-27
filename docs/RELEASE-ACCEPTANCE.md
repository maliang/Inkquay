# 发布验收清单

本文件对应「真实供应商 + Windows/Linux 发布验收」。能在本机自动跑的只有 macOS；Windows/Linux 交给 GitHub Actions 的 `Platform smoke` 手动触发或 PR 触发。

## 1. 真实供应商冒烟

不要把 Key 写进仓库或命令行历史。用环境变量：

```bash
cd software
DEEPSEEK_API_KEY=... pnpm test:providers
# 或
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... pnpm test:providers
```

覆盖供应商：DeepSeek / OpenAI / Anthropic / Google Gemini / 通义千问 / 智谱 / Moonshot。每个供应商会：

1. `POST /api/providers/:id/test` 检查 Base URL + Key + `/models`；
2. 创建临时短篇，发一次真实流式生成（只要求回复「收到」）；
3. 断言收到 `delta` 与 `done`，然后删除临时作品。

没有配置任何 Key 时默认 `SKIP`；发版门禁用：

```bash
PROVIDER_SMOKE_REQUIRED=1 DEEPSEEK_API_KEY=... pnpm test:providers
```

模型名可用 `DEEPSEEK_MODEL` / `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` / `QWEN_MODEL` / `ZHIPU_MODEL` / `MOONSHOT_MODEL` 覆盖，避免供应商下线旧模型导致假失败。

## 2. Windows / Linux 桌面 E2E

在 GitHub Actions 手动运行 `Platform smoke`，或对改动 `software/` / `desktop/` 的 PR 自动运行：

- Linux：Xvfb 下运行 `pnpm desktop:test`；
- Windows：原生 runner 运行 `pnpm desktop:test`；
- 覆盖引导、新建作品、编辑、原生关窗落盘、重启持久化；并断言非写作台页面（`/settings`）关窗 < 2500ms、写作台关窗 < 4000ms。

> **第二轮 F-1 已关闭**：`pnpm desktop:test` 现在自带这两条耗时断言（基线设置页约 5150ms，现约 260ms）。断言失败说明 5 秒兜底被错误引入，按缺陷处理，而不是放宽阈值。

本地 macOS 可先跑：

```bash
pnpm desktop:test
```

## 3. 安装包验收

```bash
pnpm desktop:pack   # macOS arm64 dir
pnpm desktop:dmg    # 需要签名/公证时才适合分发
```

- macOS 未签名/未公证时，自动更新只能回退下载页；不要把它当成可静默升级的正式包。
- Windows 未签名会被 SmartScreen 拦截；Linux 仅 AppImage 支持自动更新，deb 需手动升级。
- `Platform smoke` 只验证运行链路，不验证代码签名、公证、SmartScreen 或商店分发。

## 4. 通过标准

- 所有已配置供应商冒烟 PASS；
- Linux/Windows 两个 job 至少各绿一次；
- `pnpm typecheck`、`pnpm test`、`pnpm test:ui`、`pnpm desktop:test` 全绿；
- 第二轮 F-1 已关闭的判定：`pnpm desktop:test` 输出含 `PASS T3 settings close <N>ms (<2500ms)` 且通过。
- 记录失败供应商的 HTTP 状态、模型名与时间，不用「网络问题」一句带过。
