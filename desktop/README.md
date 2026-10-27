# Inkquay · 私家写手 · 桌面版

Electron 外壳 + 内置本地写作服务，数据完全保存在本机。

## 运行 / 打包

```bash
cd ..
pnpm desktop         # 直接启动桌面版（开发态）
pnpm desktop:pack    # 本机架构 .app
pnpm desktop:dmg     # 本机架构 .dmg
```

## 结构

```text
desktop/
├── main.cjs          Electron 主进程：选空闲端口、启动服务、开窗口
├── server.cjs        由 esbuild 打包的 Express + SQLite 服务
├── build/            应用图标、截图
└── release/          打包产物（不入库）
```

- Electron 通过 `ELECTRON_RUN_AS_NODE=1` 启动同一份 Electron 二进制里的 Node 来跑 `server.cjs`，不需要用户安装 Node。
- 前端由内置 Express 服务提供，随机绑定 `127.0.0.1` 端口。
- 数据目录：`~/Library/Application Support/Inkquay/data/studio.db`
- 日志：`~/Library/Application Support/Inkquay/logs/server.log`

## 已验证

- 开发态启动、作品库加载
- 打包后的 `.app` 启动、页面渲染
- 编辑正文 → 关闭 → 重新打开，内容保留
- 关窗时渲染层先通过 preload/IPC 落盘，主进程收到确认后才真正关闭；保存失败会取消关闭
- 关窗监听在渲染层只有一处（`software/src/client/App.tsx`，配合 `src/client/lib/closeGuard.ts`）：设置 / 大纲 / 设定等非写作台页面立即 ack 退出（实测 273ms，旧实现固定等满 5 秒兜底、实测 5164ms），只有写作台先落盘
- 若渲染层 5 秒内无响应，主进程兜底退出（极端卡死时优先保证能关机）
- 多平台 Release：macOS universal、Windows x64 NSIS、Linux x64 AppImage + deb
- `pnpm desktop:test` 自动验证：启动 → 编辑 → 打字后立即关窗 → 重启 → 内容保留；并断言非写作台页面（`/settings`）关窗 < 2500ms、写作台关窗 < 4000ms

## 自动更新

- 主分支推送由 GitHub Actions 发布 DMG/ZIP 和 `latest-mac.yml`
- 应用启动后 8 秒检查一次，之后每 4 小时检查
- 发现新版本用原生弹窗提示；点「更新并重启」后自动下载并重启安装
- macOS 菜单「检查更新…」可手动触发；Windows/Linux 在「帮助」菜单
- 开发版本不检查更新
- 已验证自动检查：启动 8 秒后检测到 GitHub 最新版
- 自动更新要求签名；正式发布请在 GitHub Secrets 配 `CSC_LINK`、`CSC_KEY_PASSWORD` 并做 notarization
- 未签名构建会提示更新，但安装可能失败，此时会自动打开 Releases 下载页作为回退

## 限制

- 未做代码签名 / notarization；首次打开可能需要右键 → 打开，或执行：
  `xattr -dr com.apple.quarantine "/Applications/Inkquay.app"`
