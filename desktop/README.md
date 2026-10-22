# Inkquay · 私家写手 · macOS 桌面版

Electron 外壳 + 内置本地写作服务，数据完全保存在本机。

## 运行 / 打包

```bash
cd ..
pnpm desktop         # 直接启动桌面版（开发态）
pnpm desktop:pack    # 生成 .app：desktop/release/mac-arm64/Inkquay.app
pnpm desktop:dmg     # 生成 DMG：desktop/release/Inkquay-0.1.0-arm64.dmg
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
- DMG 构建成功（115MB，macOS arm64）
- `pnpm desktop:test` 自动验证：启动 → 编辑 → 关闭 → 重启 → 内容保留

## 自动更新

- 主分支推送由 GitHub Actions 发布 DMG/ZIP 和 `latest-mac.yml`
- 应用启动后 8 秒检查一次，之后每 4 小时检查
- 发现新版本用原生弹窗提示；点「更新并重启」后自动下载并重启安装
- macOS 菜单「检查更新…」可手动触发
- 开发版本不检查更新
- 自动更新要求签名；正式发布请在 GitHub Secrets 配 `CSC_LINK`、`CSC_KEY_PASSWORD` 并做 notarization

## 限制

- 当前只构建了 macOS arm64
- 未做代码签名 / notarization；首次打开可能需要右键 → 打开，或执行：
  `xattr -dr com.apple.quarantine "/Applications/Inkquay.app"`
- Windows / Linux 需要补对应 electron-builder target 和图标
