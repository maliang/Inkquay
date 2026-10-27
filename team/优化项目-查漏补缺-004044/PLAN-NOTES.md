# 方案补充说明（PLAN-NOTES）· 优化项目-查漏补缺-004044

> architect 在写 PLAN/DECISIONS 过程中发现、但不宜塞进主线文档的额外风险、实现陷阱与待验证假设。实现角色开工前请通读；每条都给了「怎么验」。

---

## R1 章节删除会连带删除历史版本（已确认的技术事实）

- `software/src/server/db.ts:96-104`：`chapter_versions.chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE`。
- 结论：`DELETE FROM chapters` 会静默删掉该章**全部** `chapter_versions`；用户 D2 里「删除前自动生成版本快照」在当前 schema 下不成立（快照会被同一条语句删掉）。
- 处置：确认弹窗必须显式写「该章 N 条历史版本将一并删除」，并要求输入标题末两字（T27）。
- 验证：`sqlite3 data/studio.db "select count(*) from chapter_versions where chapter_id='<id>'"` 删除后应为 0。

## R2 `applyProjectPlan` 是破坏性的：人物与大纲整体替换

- `repository.ts:679-733`：`BEGIN` 后**先 `DELETE FROM outline_beats / outline_acts / characters`** 再插入。
- 也就是说「应用企划」会吞掉用户已手动编辑的人物与节拍，且人物/节拍**没有版本历史可回滚**（只有第一章有「企划前」快照）。
- 处置：`PlanReviewModal` 应用前必须二次确认并写明「将替换现有大纲与人物，且不可撤销」（T09）。
- 验证：手工加 2 个人物 → 应用企划 → 人数回到企划数量（预期），且弹窗文案已提示。

## R3 `ai_messages.chapter_id` 没有外键

- `db.ts` 建表里 `chapter_id TEXT`（无 REFERENCES）。删章节**不会**级联删消息；而修复前 `listMessages` 用 `chapter_id = ? OR chapter_id IS NULL`，孤儿消息还会继续出现在同项目其它章节。
- 处置：`deleteChapter` 必须在同一事务内 `DELETE FROM ai_messages WHERE chapter_id = ?`（T26），并在 T35 里断言删除后消息表无残留。
- 验证：`select count(*) from ai_messages where chapter_id='<deleted>'` 应为 0。

## R4 `crypto.ts` 的 secret 是**模块级常量**，恢复密钥后必须重启服务

- `crypto.ts:19`：`const secret = loadSecret();` 在模块加载时读一次 `.secret`，之后写文件不影响内存中的密钥。
- 结论：`POST /api/restore` 即使覆盖了 `.secret`，当前进程仍用旧密钥解密 → 已恢复的 `api_key_enc` 解不开。
- 处置（二选一，需用户拍板，见 DECISIONS Q3）：
  - A（推荐，成本低）：恢复密钥时返回 `requiresRestart: true`，前端提示「密钥已恢复，请重启应用后生效」，桌面端在 `before-quit` 之外提供「立即重启」按钮；
  - B（成本高）：把 `secret` 改成可重载（`getSecret()` 读文件并缓存 + 恢复后清缓存），影响 `encryptSecret/decryptSecret` 全部调用点。
- 本轮默认 A。
- 验证：恢复含密钥的备份后，`/api/providers` 的 key 掩码仍为新值，但发一次 AI 请求会 401 → 重启后正常。

## R5 备份/复制 `studio.db` 前必须 checkpoint WAL（**最容易踩的坑**）

- `db.ts:12` 开启了 `PRAGMA journal_mode = WAL`：最近写入可能只落在 `studio.db-wal`，不在主文件里。
- 直接 `fs.copyFile('studio.db', 'pre-restore-x.db')` 会拿到**缺最近若干次写入**的库；用户「恢复前自动备份」等于假备份。
- 处置：
  - 自动备份前执行 `db.exec("PRAGMA wal_checkpoint(TRUNCATE)")`，再复制 `studio.db`（此时 -wal 已清空）；
  - 或者直接 `db.exec("VACUUM INTO 'data/backups/pre-restore-<ts>.db'")`（SQLite ≥3.27，Node 24 自带版本满足），一步得到一致快照且体积更小。
- 建议用 `VACUUM INTO`（T21 采纳），并对 `GET /api/backup` 的 JSON 导出先 checkpoint 再读表（读表本身走事务一致，问题只在文件级复制）。
- 验证：写一段正文 → 立即备份 → 打开备份库查该章内容非空。

## R6 SQLite 是单写者：restore 与并发写会 `SQLITE_BUSY`

- `DatabaseSync` 默认无 busy 等待；restore 事务 + 同时的 `PATCH /api/chapters` 会直接抛 `database is locked`。
- 处置：`db.exec('PRAGMA busy_timeout = 5000')`（migrate 里加一行），restore 用 `BEGIN IMMEDIATE` 提前拿写锁，并在 restore 期间返回 409 的幂等保护（T21）。
- 验证：并发脚本（一个 restore + 10 个 PATCH）跑 20 轮无 `database is locked` 未捕获异常。

## R7 db 打开失败仍然会崩进程（诚实标注的已知限制）

- `db.ts:11` `new DatabaseSync(dbPath)` 在**模块 import 期**执行；ESM 静态 import 无法 try/catch。
- 因此 T02 的「启动容错」只覆盖 **migrate()/seed() 失败**；若 data 目录不可写或文件被占用，进程仍会在 import 阶段退出。
- 处置：本轮不改初始化形态（会牵动全部 import），写入 PLAN §10 已知限制；若后续要做，需把 `db` 改成 `getDb()` 惰性单例（成本 ≈ 全仓 import 改动，不建议本轮做）。

## R8 `streamMock` 的中止返回与 partial 累计会重复

- `ai.ts:58-73`：mock 在 `signal.aborted` 时 `break`，但仍 `return { text }`（已发文本全量）。
- T03 引入 `onDelta` 累计后，如果又在 catch 里把 `result.text` 追加一次，就会「部分 + 全量」翻倍。
- 处置：abort 分支只用 `partial`，忽略返回值；正常分支只用返回值，不叠加 partial。

## R9 Express 5 的 `res.on('close')` 在正常结束时也会触发

- 现有 `index.ts:341-342` 直接 `controller.abort()`。正常完成时 `close` 也会来一次（连接关闭），把 `signal.aborted` 置真，T03 的「中止落库」逻辑就会在**成功路径**上误写一条 `status='aborted'`。
- 处置：abort 判定加 `&& !res.writableEnded`；`finally` 里先 `res.off('close', onClose)`（现有代码已做）。T03 验收补一条：正常完成时不得出现 aborted 消息。
- 验证：跑一次完整 mock 流，查库 `select count(*) from ai_messages where status='aborted'` 应为 0。

## R10 备份 JSON 不含 `app_meta`（有意为之）

- 12 表清单里没有 `app_meta`；restore 的清表范围也不含它 → 恢复后 `schema_version`/`seeded` 保持当前值，避免「恢复旧备份把 schema 版本降级」。
- 需要显式写进 T21 的实现说明与 T38 的文档，否则实现角色容易顺手把 `app_meta` 也 dump 进去。

## R11 `settings` 是单行 JSON + 分层浅合并，恢复时形状可能缺字段

- `repository.ts:269` `getSettings()` 只对 `profile/onboarding/appearance/prefs/generation` 做 `{...DEFAULT, ...stored}`；`defaultModel`、`fallbackModel` 直接取 `stored`。
- 备份来自旧版本时可能缺 `prefs.autoSave` 或 `defaultModel` 为 `undefined` → 下游 `settings.defaultModel?.providerId` 尚可容错，但 `prefs.autoSave===undefined` 会让「自动保存」判断走 falsy，用户会以为保存坏了。
- 处置：restore 写入前用 `normalizeSettings()`（同 `getSettings` 的合并规则）规整；T21 增加一条断言「恢复缺字段的备份后设置仍有默认值」。

## R12 `docx.ts` 接收的是 `ProjectDetail`

- `index.ts:308-315` 传整个 project；加 scope 后要构造「只含选中章节/卷」的 ProjectDetail（`outline/characters/scenes/shots/foreshadows` 传空数组或原样但 docx 只渲染 chapters），并保证 `totalWords` 与导出内容一致，否则文档页脚字数会撒谎。
- 处置：T19 明确「docx 渲染只读 chapters，标题取 project.title + 范围后缀（如《书名》· 第 3 章）」。

## R13 中文文件名已经正确（别顺手改坏）

- `index.ts:312/323` 用 `filename*=UTF-8''${encodeURIComponent(...)}`；RESEARCH 已排除「中文导出 200 异常」的怀疑。T19/T20 只动 blob 化与 scope，不要改 Content-Disposition 形态。

## R14 UI 测试现有的 plan 断言依赖弹窗交互

- `ui-test.mjs` 有 `planDetail.project.outline.beats.length === previewBeatCount-1` 这类断言，且依赖「勾选后直接应用」。
- T09 加了「应用前二次确认」会改变交互 → T36 必须同步改脚本，否则 M2 一落地 `pnpm test:ui` 就会红。
- 处置：T09 与 T36 同批交付；T09 实现时给确认弹窗加稳定 `data-testid`。

## R15 自动快照与「AI 插入前/后」双快照会互相挤占 40 条配额

- 现有 `createChapterVersion` 每 40 条按 `created_at DESC` 裁剪；加了自动快照后，用户手动/AI 快照可能被挤掉。
- 处置：T17 的裁剪顺序必须是「先删 `source='自动存档'` 最旧 → 再删任意最旧」；T35 用「造 45 条含手动」验证手动版本存活。

## R16 双击「新建章节」有三个入口

- `StudioPage.tsx:462/:478/:489` 三处都调 `addChapter()`，只锁按钮不够（键盘/不同入口都能触发）。
- 处置：T28 用 `creatingChapter` 状态锁在函数入口处 `if (creatingChapter) return`。

## R17 `desktop/server.cjs` 是构建产物

- 由 `pnpm desktop:prepare`（`scripts/build-desktop.mjs`）从 `software/src/server` 打包生成；**改 server 源码后必须重新 prepare**，否则桌面冒烟跑的还是旧逻辑。
- 处置：T34 的脚本入口固定走 `pnpm desktop:test`（内含 prepare），不要直接 `node desktop/main.cjs`。
- 另：仓库根与 `software/` 各有一套 lockfile，装包必须两次；本轮不新增依赖，理论上不需要装包。

## R18 端口与数据目录

- API 8787（`software`）/ 8798（ui-test）/ 8799（api-test）；dev 走 5180（strictPort）。
- 桌面端数据在 `app.getPath('userData')/data`，`PW_DATA_DIR` 注入；测试清理务必按 `PW_DATA_DIR` 精确 pkill，别误杀用户正在跑的实例（R18 与 T34 相关）。

## R19 未验证的假设（实现前 5 分钟可验证）

| 假设 | 验证方式 |
|---|---|
| `execCommand('insertText')` 在 Electron 45 的 contentEditable 中保留原生 undo | 起 dev，输入后 `insertText` 再 ⌘Z，看是否只撤销插入 |
| `pagehide` 在 Electron `window.close()` 时触发 | 在 `pagehide` 里 `console.log`，关闭窗口看终端 |
| `fetch(..., {keepalive:true})` 在关闭窗口时能发出 PATCH | 同上，抓服务端日志是否收到 PATCH |
| `PRAGMA wal_checkpoint(TRUNCATE)` 在 `DatabaseSync` 上可用 | `node -e` 连库执行一次 |
| Playwright 能捕获 `download` 事件（Blob 下载） | 在 ui-test 里加一个最小用例先试 |
| Express 5 正常完成时 `res.on('close')` 是否触发 | 打日志跑一次流 |

任何一条被证伪，对应任务的实现方式要调整（尤其是 R19-1 与 R19-2，决定 T12 与 T10 的降级路径）。

## R20 交付前的「不得出现」清单（给 reviewer/T37 当 checklist）

1. `data/` 被删除或静默重建。
2. API Key 以明文出现在日志、备份以外的响应或前端 state。
3. 仍有 `<a href={api.export...}>` 形式的导出入口。
4. 仍有 `setStreamText('')`。
5. 仍有 `chapter_id = ? OR chapter_id IS NULL`。
6. 仍有 `i===1` 的假「当前幕」高亮、写死的章节号/引文/百分比。
7. 快捷键表里出现未实现的条目。
8. `projects` 计数判首启（`SELECT COUNT(*) AS count FROM projects`）残留。
