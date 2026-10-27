# 计划（PLAN）· 优化项目-查漏补缺-004044

> 作者：architect（Lee）｜版本：v2（覆盖 lead v1 草案，保留其中与本方案一致的部分：Rail 串项目、企划二次确认、切章中断生成、保存失败常驻、40 版上限标注、搜索 placeholder）
> 依据：`REPOWIKI.md`、`RESEARCH.md`（main@8e95e43）、`SPEC.md`、用户已确认口径（D1–D5 见 `DECISIONS.md`）
> 状态：**方案待用户确认**。本文件只描述「改什么、怎么改、怎么验证、怎么回滚」，不含实现代码。
> 红线：不 push、不动 `release.yml`、不新增第三方依赖、不做大重构、不丢本地作品。

---

## 0. 一页摘要

| 维度 | 结论 |
|---|---|
| 性质 | 存量体验修复，不扩张创作能力。按 T 编号独立 commit，可单条回滚。 |
| P0（先过） | ① 删空作品后重启崩溃（seed 非幂等）② 停止生成丢已生成文本 ③ 页面加载失败永久转圈（四页） |
| P1（用户优先级） | 新建作品/AI 企划 → 写作与共笔 → 版本/回退 → 导出/备份 → 设置/供应商/更新；删除家族贯穿其中 |
| 明确不做 | 富文本框架替换、迁移框架、回收站、云同步、多窗口、新增 AI 能力、onboarding 免 Key（见 §2） |
| 新增依赖 | 0。备份用单 JSON 文件（不引 zip），导出用原生 `fetch`+`Blob` |
| 最大数据风险 | 删除章节会连带删除该章全部历史版本（`chapter_versions.chapter_id` FK CASCADE），不可逆 → 靠「输入标题确认 + 明示 N 条版本一并删除 + 完整备份」兜底（PLAN-NOTES R1） |
| 验收 | `pnpm typecheck` / `pnpm test` / `pnpm test:ui` / `pnpm desktop:test` + 5 条手动 smoke |
| 改动面 | server ≈ +570/−65；client ≈ +1 370/−180（含 5 个新文件）；desktop +45；测试脚本 +440；合计 ≈ +2 500 行 / 30 文件 |
| 工时 | 合计 ≈ 128 人时（16 人日）；2–3 角色并行约 5–7 个工作日，关键路径 T01→T26→T27、T21→T22、T35→T37 |

---

## 1. 目标

1. **不丢字**：关闭、停止、刷新、崩溃、切章任一路径下，已看到/已输入的正文都能找回。
2. **不假成功**：界面上写的状态（已连接/已保存/已同步/快捷键/版本/更新）必须与代码一致；做不到就移除或标注。
3. **不留死路**：每个失败（404、服务未起、AI 报错、导出失败、企划失败）都有可点的下一步与明确落点。
4. **不炸启动**：数据库可清空、可旧库升级、可二次启动，服务必须起得来，并给出可读原因。
5. **闭环**：新建 → 企划 → 写作 → 版本 → 导出/备份 → 设置，每环有入口、落点、回退。

## 2. 非目标（明确不做 + 理由）

| 不做 | 理由 |
|---|---|
| 换富文本编辑器（TipTap/Lexical） | 引依赖 + 全站回归，与「避免大重构」冲突；本轮只修撤销栈与外部同步，UI 标注「格式为视图效果」 |
| 引入数据库迁移框架 | 单文件 SQLite + `CREATE TABLE IF NOT EXISTS` 够用；只追加幂等补丁（`app_meta` + `ensureColumn`） |
| 回收站 / 软删除 / 归档只读 | 用户口径 D2/D4 已定：硬删 + 确认；归档只补筛选与取消归档 |
| 章节「孤儿快照」 | `chapter_versions.chapter_id NOT NULL ... ON DELETE CASCADE`，保留需重建表 + 新增「已删除章节」入口 = 半个回收站，与 D2 冲突（DECISIONS D2 备选 B） |
| 云同步 / 协作 / 多窗口 / 遥测 | 与本地单机定位冲突 |
| 新增 AI 能力（新润色形态、自动大纲） | 用户口径 D5：只修正确性、可取消、可恢复、上下文污染 |
| onboarding 跳过 / 匿名模式 | 用户口径 D1：保持强制 API Key，只修文案矛盾 |
| 大纲「幕」的增删改、章节排序/分卷、跨章版本总览 | SPEC C-2/C-4 已列为不做；本轮只修 beat 归属与草稿守卫 |
| 全库文件级恢复（覆盖 studio.db 并重启） | 需关 DB handle + 重启子进程，桌面端风险高；改为事务内重灌（T21），等价效果且失败可回滚 |
| 搜索升级全文检索（章节/人物正文） | 需 FTS5 与索引维护；本轮把 placeholder 收窄到真实能力 |
| 单作品 JSON 导入（bundle import） | 用户口径 D3：本轮做整库备份/恢复；bundle 导入列二期（DECISIONS D3 备选 B） |

---

## 3. 优先级映射

| 用户优先级 | 阶段 | 任务 |
|---|---|---|
| 全站底线（研究新发现，置于最前） | P0 | T01–T06 |
| ① 新建作品与 AI 企划 | P1-A | T07–T09 |
| ② 写作编辑与 AI 共笔 | P1-B | T10–T16 |
| ③ 版本 / 历史 / 回退 | P1-C | T17–T18 |
| ④ 导出 / 备份 / 导入 | P1-D | T19–T22 |
| ⑤ 设置 / 供应商 / 更新 | P1-E | T23–T25 |
| 删除家族（P1-8） | P1-F | T26–T28 |
| 归档 / 导航 / 文案 / 大纲守卫 | P2 | T29–T32 |
| 桌面（P2-13） | P2 | T33–T34 |
| 回归与交付 | 交付 | T35–T38 |

---

## 4. 里程碑

| 里程碑 | 内容 | 出口条件 |
|---|---|---|
| M0 基线 | 现跑 `typecheck`/`test`/`test:ui` 记录基线（含已知 flaky：`api-test.mjs:217` 旧断言） | 三条命令绿，截图留档 |
| M1 P0 止血 | T01–T06 | 删空重启 200；停止生成保留文本；四页 404 有出口；无白屏 |
| M2 主流程闭合 | T07–T13 | 新建→企划（可取消）→写作→⌘S→⌘Z→选区精确改写 全链路可演示 |
| M3 数据资产 | T17–T22 | 手写稿有自动版本；导出可选范围；备份/恢复可用且恢复前自动备份 |
| M4 收尾与桌面 | T23–T34 | 设置不再撒谎；五种删除齐备；打包冒烟通过 |
| M5 交付 | T35–T38 | 测试矩阵全绿 + 独立审查 pass + 本地 commit（不 push） |

---

## 5. 设计

### 5.1 模块边界

```
shared/types.ts            ← 只加字段（AiStreamRequest.regenerateOf、ChatMessage.status、AppMeta）
server/db.ts               ← app_meta + ensureColumn + 幂等 seed 判定 + 迁移容错（不重建业务表）
server/seed.ts             ← INSERT OR IGNORE
server/repository.ts       ← 查询范围修复、五种删除、自动快照、导出范围、备份/恢复、分镜 force、状态保护
server/ai.ts               ← onDelta 累计、中止持久化、fallback 重试、prefs 注入 system prompt
server/index.ts            ← 新路由、plan 可中止、启动容错、restore 大 body、health
server/crypto.ts           ← 导出 .secret 原文（仅供备份）
server/docx.ts             ← 接受范围过滤后的子集
client/api.ts              ← delete*/backup/restore/blob 下载/regenerateOf
client/lib/*.ts【新】       ← useProjectDetail、selection 偏移、草稿存储（零依赖）
client/components/【新】    ← LoadError、ErrorBoundary、ConfirmDelete、ExportDialog
desktop/main.cjs           ← 窗口尺寸记忆、生产菜单、server 退出弹窗
```

### 5.2 接口契约（新增/变更，精确到错误语义）

```json
{
  "DELETE /api/chapters/:id": {
    "input": "path id=chapter id",
    "output": { "ok": true, "deletedChapterId": "string", "projectId": "string", "nextChapterId": "string|null", "totalWords": "number" },
    "errors": { "404": "章节不存在", "503": "本地数据库未就绪" },
    "副作用": "同事务：DELETE ai_messages WHERE chapter_id=? → DELETE chapter（chapter_versions 走 FK CASCADE）→ 重算 projects.total_words"
  },
  "DELETE /api/characters/:id | /api/foreshadows/:id | /api/shots/:id": {
    "output": { "ok": true, "deletedId": "string" },
    "errors": { "404": "人物不存在 / 伏笔不存在 / 分镜不存在" }
  },
  "DELETE /api/scenes/:id": {
    "output": { "ok": true, "deletedId": "string", "deletedShots": "number" },
    "errors": { "404": "场次不存在" },
    "备注": "shots 走 FK CASCADE；场次号不重排，避免剧本引用错位"
  },
  "DELETE /api/messages/:id": {
    "output": { "ok": true, "deletedId": "string" },
    "errors": { "404": "消息不存在" },
    "用途": "丢弃「已中止」的半截消息"
  },
  "GET /api/projects/:id/export（.md）": {
    "input": { "scope": "'book'|'chapter'|'volume'，缺省 book", "chapterId": "scope=chapter 必填", "volume": "scope=volume 必填" },
    "output": "200 text/markdown; attachment",
    "errors": { "400": "这部作品还没有正文可导出", "404": "作品不存在 / 章节不存在" }
  },
  "GET /api/projects/:id/export.docx": {
    "input": "同 export.md",
    "output": "200 docx 二进制",
    "errors": { "400": "这部作品还没有正文可导出", "404": "作品不存在 / 章节不存在" }
  },
  "GET /api/backup": {
    "output": {
      "format": "'inkquay-backup'", "formatVersion": 1, "createdAt": "ISO8601",
      "app": { "name": "string", "version": "string" },
      "data": { "projects": "array", "chapters": "array", "chapter_versions": "array", "characters": "array",
                "outline_acts": "array", "outline_beats": "array", "scenes": "array", "shots": "array",
                "foreshadows": "array", "ai_messages": "array", "settings": "array", "providers": "array" },
      "secrets": { "algorithm": "'aes-256-gcm'", "keyBase64": "string(.secret 原文) | null" }
    },
    "headers": { "Content-Disposition": "attachment; filename*=UTF-8''inkquay-backup-<YYYYMMDD-HHmmss>.json", "X-Backup-Contains-Secrets": "1" },
    "备注": "api_key_enc 是密文；keyBase64 决定能否跨机解密。不含密钥也能恢复，但已存 Key 需重填"
  },
  "POST /api/restore": {
    "input": { "body": "备份 JSON 全文（本路由独立 express.json({limit:'256mb'})）", "query": { "force": "'1' 才允许覆盖非空库", "secret": "'1' 时一并恢复 .secret" } },
    "output": { "ok": true, "counts": { "projects": "number", "chapters": "number", "messages": "number" }, "preRestoreBackup": "data/backups/pre-restore-<ts>.db", "requiresRestart": "boolean（恢复了 secrets 时为 true）" },
    "errors": { "400": "备份文件格式不正确：缺少 data.projects / 不支持的 formatVersion", "409": "已有作品数据，需要确认后才能覆盖 / 正在恢复中" },
    "副作用": "① VACUUM INTO 或先 wal_checkpoint(TRUNCATE) 做一致的 pre-restore 备份 ② 事务内清表并写入（不动 app_meta）③ 写入前 normalizeSettings() 规整 ④ （可选）覆盖 .secret → requiresRestart:true ⑤ 不自动重启（crypto secret 是模块级常量，见 PLAN-NOTES R4）"
  },
  "POST /api/ai/stream": {
    "input": { "projectId": "string", "chapterId": "string|null", "prompt": "string 非空", "providerId": "string?", "modelId": "string?",
               "mode": "'continue'|'rewrite'|'outline'|'check'?", "regenerate": "boolean?", "regenerateOf": "string?（被替换的 assistant 消息 id）" },
    "output": "SSE: meta / delta / done{messageId, words, aborted?} / error{message}",
    "语义": "regenerateOf 存在时先删除该 assistant 再插入新消息（总数不变）；abort 且已有文本时以 status='aborted' 落库"
  },
  "POST /api/scenes/:id/shots/generate": {
    "input": { "regenerate": "boolean?（true 覆盖已有分镜）" },
    "output": { "shots": "Shot[]（固定 6 条模板）" },
    "errors": { "404": "场次不存在" }
  },
  "GET /api/health": {
    "output": { "ok": "boolean", "db": { "ready": "boolean", "schemaVersion": "number", "seededAt": "string|null" }, "app": { "version": "string" } }
  },
  "GET /api/bootstrap": { "变更": "新增 app:{version, packaged}，供设置页显示真实版本" },
  "POST /api/projects/:id/plan": { "变更": "res.on('close')→AbortController.abort()；100s 超时 → 504 {error:'企划生成超时，请重试'}" },
  "GET /api/projects/:id/messages": { "变更": "chapterId 存在时严格 chapter_id = ?（去掉 OR chapter_id IS NULL）；缺省仍返回项目全部" }
}
```

**DB 变更（幂等、旧库原地升级、不重建业务表）**

```sql
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE ai_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'done';   -- 执行前 PRAGMA table_info 守卫；'done'|'aborted'
INSERT OR IGNORE INTO app_meta(key,value) VALUES ('schema_version','2');
-- seeded 标记在 seedDatabase 成功后写入，避免「以 projects 数量判首启」
```

### 5.3 数据流

**A. 启动（P0-1）**

```
index.ts: migrate() ─try→ db.exec(CREATE IF NOT EXISTS) → ensureColumn(ai_messages.status) → 记账 schema_version
                                └失败→ dbReady=false，打印可读原因，进程继续监听 → /api/* 返回 503
                     seed 判定：app_meta.seeded 存在？ ─是→ 跳过（永不再 seed）
                                └否 → providers 已有行？ ─是→ 只记账（旧库升级）
                                                        └否 → seedDatabase()（INSERT OR IGNORE ×9 + settings OR IGNORE，事务包裹）→ 写 seeded
```

**B. AI 流（P0-2、P1-B）**

```
client streamChat ──signal──▶ /api/ai/stream ──res close──▶ controller.abort()
               每 delta：partial += text; writeEvent(delta)
   正常 → saveMessage(assistant, status:'done') → done{messageId}
   中止 → partial 非空 → saveMessage(assistant, status:'aborted')（不发事件，客户端自行收口）
   报错 → error 事件 + partial 同样落库
client stop：已收文本转「已中止」卡片（插入正文 / 重新生成 / 丢弃），不再 setStreamText('')
```

**C. 保存与草稿（P1-B）**

```
onInput → setContent + localStorage['pw.draft.<chapterId>']={content,title,at}（同步，无网络）
        → scheduleSave 800ms（prefs.autoSave=false 时完全不自动写库）→ PATCH /api/chapters/:id
visibilitychange:hidden / pagehide → fetch(...,{keepalive:true}) best effort flush
打开章节 → draft.at > chapter.updatedAt 且内容不同 → 横幅「检测到未保存草稿 [恢复][丢弃]」
切章 → await saveNow() 完成后才切换；生成中切章 → abort
保存失败 → saveState='dirty' + 常驻条「保存失败，点击重试」，不覆盖本地草稿
```

**D. 版本（P1-C）**

```
PATCH chapter → updateChapter → maybeSnapshotChapter(source='自动存档')，满足任一：
   ① 距最近版本 ≥10 分钟 且 字数变化 ≥200 ② 距最近版本 ≥30 分钟（兜底）
   ③ 原文 ≥500 字且新内容为空（疑似误清空，强制留档）
裁剪：总数 >40 时先删最旧的 source='自动存档'，再删最旧任意；手动/AI 版本优先保留
恢复：restoreChapterVersion 先写「回退前」快照（已实现）→ 前端 toast「已恢复，恢复前内容已存为一条版本」
```

**E. 备份/恢复（P1-D）**

```
GET /api/backup → 读 12 表 + .secret → JSON → fetch+Blob 下载（不走 <a href>）；不含 app_meta
POST /api/restore → 校验 format/formatVersion/表齐全
  → 一致性备份：VACUUM INTO 'data/backups/pre-restore-<ts>.db'（或 wal_checkpoint(TRUNCATE) 后复制，否则 WAL 里未落盘写入会丢）
  → BEGIN IMMEDIATE → DELETE FROM 12 表（子表先）→ 按备份 INSERT → COMMIT
  → （可选）覆盖 .secret → 返回 counts + requiresRestart → 前端提示「重启后密钥生效」并 location.reload()
失败 → ROLLBACK，库原样，400/500，且不删任何文件；并发第二请求 409（PRAGMA busy_timeout=5000 已在 migrate 里设）
```

### 5.4 技术选型与理由

| 选择 | 备选 | 理由 |
|---|---|---|
| `app_meta` 表做 seed/schema 标记 | `PRAGMA user_version`；`settings` 行 | user_version 只能存整数；settings 会被用户操作写脏；app_meta 可扩展、可人工排查 |
| `INSERT OR IGNORE` + 事务包 seed | try/catch 吞异常 | 幂等是根因修复，捕获异常只是掩盖 |
| `ensureColumn`（PRAGMA table_info） | 建表脚本版本分支 | 无框架下最省事，且对「手工改过的库」同样安全 |
| 中止时持久化 partial + `status` 列 | 只在客户端保留 | 刷新即丢，等于没修；且 regenerate 需要 DB 里能看到半截消息 |
| localStorage 草稿 + keepalive flush | beforeunload 同步 XHR | 同步 XHR 已废弃；localStorage 写入同步且必然成功 |
| `execCommand('insertText')` 保撤销 | 自研 undo 栈 | 原生撤销只与 execCommand 一致；自研栈成本高且与 IME 冲突 |
| JSON 单文件备份 | zip（新依赖） | 零依赖、可读、可手工修 |
| 恢复走「事务内清表重灌」 | 关库换文件重启 | 换文件需关 handle + 重启子进程，桌面端风险高；事务失败即回滚 |
| 导出 fetch+Blob | 保留 `<a href>` 加 onerror | `<a>` 失败会整页跳走并丢未保存内容，无法可靠拦截 |
| 版本裁剪按 source 优先级 | 简单按时间裁 40 | 自动版本会挤掉手动版本，等于毁掉重要历史 |
| 章节删除「输入标题确认」 | 二次 confirm | 章节正文不可撤销（版本随 CASCADE 消失），必须提高摩擦 |
| plan 失败不阻塞落地 | 失败回滚删除作品 | 回滚删除会让用户丢已填标题/梗概；保留作品 + 可重试更符合「不留死路」 |

### 5.5 风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| 章节删除连带历史版本（R1） | 误删永久丢稿 | 弹窗显示「字数 / 首段 100 字 / N 条历史版本一并删除」+ 输入标题末两字；建议先备份 |
| 事务内全库重灌 | 大库锁表数秒 | 路由级 256mb body、单飞锁、恢复前自动备份、失败回滚 |
| ai_messages 严格分章 | 旧库里的项目级消息不再出现在章节中 | 默认严格；UI 标注「仅本章」；项目级消息仍可用 `chapterId` 缺省查询 |
| execCommand 兼容性 | 目标只有 Electron/Chromium，稳定 | 选区丢失时回退 innerHTML + toast「该步不可撤销，可用版本记录回退」 |
| 自动快照写入放大 | 每 10 分钟 × 章节数 | 阈值 + 40 上限 + 内容相同不写 |
| plan abort 后模型仍计费 | 只断流 | 文案「取消后本次生成不计入作品」；不做计费承诺 |
| 桌面关窗 best effort | 极端强杀仍丢最后几百毫秒 | 双保险：visibilitychange + pagehide + 打开时草稿对比 + `before-quit` 600ms 宽限 |
| 旧断言冲突 | `api-test.mjs:217` 要求 regenerate 后 +1 | T14 同步改为「数量不变 + 新 id」，`ui-test` 现有 `.msg--user` 断言本身正确 |
| 两套 lockfile | 装错依赖导致 CI/本地不一致 | 不新增依赖；如需装包必须 `pnpm install` + `pnpm -C software install` |

---

## 6. 分阶段实施（文件级）

### P0 · 止血（T01–T06）

**T01 数据库幂等与旧库升级**（dba｜`db.ts`、`seed.ts`）
- `migrate()`：建 `app_meta`；`ensureColumn('ai_messages','status',"TEXT NOT NULL DEFAULT 'done'")`；写 `schema_version=2`。
- `db.ts:166-170` 首启判定改为 `app_meta.seeded`：缺失时若 `providers` 已有行 → 只记账；否则 `BEGIN → seedDatabase() → COMMIT → 写 seeded`。
- `seed.ts:insert()` → `INSERT OR IGNORE`；settings 行同样 OR IGNORE（不覆盖用户已改设置）。
- 失败路径：seed 抛错 → ROLLBACK、`console.error('[db] 初始化失败：<原因>')`、不写 seeded（下次重试）。
- 回滚：仅这两文件，revert 即回到原判定（旧库仍可读）。
- 验收：删光作品 → 重启 → `/api/health` 200、`providers=9`、`projects=0`；连启两次无 UNIQUE。

**T02 启动容错 + /api/health**（backend｜`index.ts`）
- `:49` `migrate()` 包 try/catch → `dbReady`；`/api/*` 前置 503 守卫（错误中间件之前）。
- `GET /api/health` 返回 db 状态 + `app.version`（`PW_APP_VERSION || package.json.version`）。
- 验收：把 `studio.db` 改成坏文件 → 进程不退出、health 报 not ready、UI 显示可读错误。

**T03 中止持久化（服务端）**（backend｜`ai.ts`、`repository.ts`、`types.ts`）
- 4 个 `stream*` 增加 `onDelta` 回调；`streamAssistant` 累计 `partial`。
- `catch`：`if (signal.aborted) { if (partial.trim()) saveMessage({role:'assistant', content:partial, status:'aborted'}); return }`
- `saveMessage` 支持 `status`（默认 `'done'`）；`messageFromRow` 映射 `status`。
- `regenerateOf`：先 `deleteMessage(id)`（校验 assistant + 属于该 project），再落新消息 → 总数不变。
- 回滚：`status` 有默认值，旧代码不受影响。
- 验收：mock 流中途 abort → 库中一条 `status='aborted'` 且非空。

**T04 停止生成不丢文本（客户端）**（frontend｜`StudioPage.tsx`、`api.ts`）
- `stopStreaming():329-333` 不再清空；`streamText` 转本地「已中止」卡片：`插入正文 / 重新生成 / 丢弃`。
- 收到 `done{aborted,messageId}` 时用真实 id 替换临时项；`丢弃` → `api.deleteMessage`（临时项直接移除）。
- 验收：停止后立即可插入；刷新后仍在（来自 DB）。

**T05 加载失败统一出口**（frontend｜新增 `lib/useProjectDetail.ts`、`components/LoadError.tsx`；改四页）
- hook 区分 404（作品不存在）与网络/服务未起；`{project,loading,error,reload}`。
- 四页渲染统一：`loading → 骨架`；`error → <LoadError retry onBack/>`（`返回作品库`+`重试`）；消除 `Studio:408`、`Outline:152`、`Codex:105`、`Screenplay:132` 的无限转圈。
- `Screenplay:27-28` 不再静默换作品：id 有效但不存在 → 错误态；缺 id 且有剧本 → 显式导航 + toast「已打开最近剧本」。
- 验收：`/project/not-exist` 四页 1 秒内出错误卡并可返回。

**T06 全局错误边界**（frontend｜`main.tsx`、新增 `components/ErrorBoundary.tsx`）
- 卡片「界面出错」+ `重新加载` + `复制错误详情`。
- 验收：注入临时 throw 的测试组件 → 不白屏。

### P1-A · 新建作品与 AI 企划（T07–T09）

**T07 新建作品状态机**（frontend｜`NewProjectModal.tsx`）
- `idle → creating → planning → review → done|failed`；creating/planning 期间禁用 Esc、遮罩点击与关闭按钮。
- planning 中提供 `跳过企划，直接写作`（abort + navigate）与（failed 时）`重试企划`。
- 关闭/卸载：已创建 project → 必须 `navigate(target)`，不留孤儿；请求中先 `abort()`。
- failed：弹窗内显示原因 + `重试企划` / `先进入写作`。
- 体裁默认取 `settings.prefs.genre`（无则回退硬映射）。
- 验收：planning 中 Esc → 请求中止且进入作品页；断网 → 项目存在可直接写。

**T08 plan 可中止 + 超时**（backend｜`index.ts`、`plan.ts`）
- `:88` `res.on('close') → abort`；100s → 504 `{error:'企划生成超时，请重试'}`。
- 验收：abort 后 2s 内释放；超时走 504 而非 90s 静默。

**T09 企划评审出口**（frontend｜`PlanReviewModal.tsx`）
- Esc 关闭（preview 无破坏）；`跳过，直接写作`；`apply` 失败 → 弹窗内红色错误 + 保留勾选；`regenerate` 失败 → toast 且按钮恢复。
- 应用前二次确认「将替换现有大纲与人物」（`applyProjectPlan` 是破坏性先删，见 R4）。
- 验收：Esc / 跳过 / 应用三出口都到写作台，无「点了没反应」。

### P1-B · 写作与 AI 共笔（T10–T16）

**T10 关窗/刷新不丢字 + autoSave 生效**（frontend｜`StudioPage.tsx`、新增 `lib/draft.ts`）
- onInput 同步写草稿；`visibilitychange(hidden)`/`pagehide` → `saveNow({keepalive:true})`。
- 打开章节对比草稿时间戳 → 横幅 `恢复草稿 / 丢弃`。
- `prefs.autoSave=false` 时跳过防抖，状态区显示「自动保存已关闭」。
- 验收：输入后 200ms 内关窗 → 重开内容在；Playwright 覆盖（UI-05）。

**T11 快捷键与承诺一致**（frontend｜`StudioPage.tsx`、`SettingsPage.tsx`）
- 全局 keydown：`⌘/Ctrl+S` 保存 + toast；`⌘/Ctrl+Enter` 发送（保留）；其余交给原生。
- `SettingsPage:309` 快捷键表列真实实现并注「写作台内生效」。
- 验收：⌘S 触发 PATCH 且状态变 `saved`；表内每条可实测。

**T12 插入/替换保撤销 + 编辑器外部同步**（frontend｜`StudioPage.tsx`、`ChapterEditor.tsx`、新增 `lib/editorCommands.ts`）
- `insertAtCursor(text)` / `replaceRange(range,text)` 基于 `execCommand('insertText')`。
- `insertText():368-378`、`replaceSelection():293-309` 改走命令；选区丢失回退 innerHTML + toast「该步不可撤销，可用版本记录回退」。
- `ChapterEditor:28-34` 用 `lastSyncedContent` 判定：外部内容变化且编辑器未聚焦才回灌（修复恢复版本后正文不更新）。
- 验收：AI 插入后 ⌘Z 可撤销；恢复版本后正文立刻变化且不覆盖正在输入。

**T13 选区改写精确定位**（frontend｜`StudioPage.tsx`、新增 `lib/selection.ts`）
- 存 `{start,end,text}`（Range 克隆计文本偏移）；替换前校验 `content.slice(start,end)===text`，失败退化为第 N 次出现定位，再失败 toast「正文已变化，请重新选择」。
- 验收：同句 3 次，改第 3 处只变第 3 处（UI-08）。

**T14 消息分章 + regenerate 替换**（backend+frontend｜`repository.ts`、`index.ts`、`ai.ts`、`types.ts`、`api.ts`、`StudioPage.tsx`）
- `listMessages`：`AND chapter_id = ?`。
- `regenerate` 传 `regenerateOf`；客户端去掉 `:256-264` 的前端 filter hack，改为乐观替换。
- 验收：切章对话为空；重新生成后消息数不变、内容变化；同步改 `api-test.mjs:217` 断言。

**T15/T16 分镜二次生成**（frontend `ScreenplayPage.tsx` + backend `repository.generateShotsForScene`）
- 已有分镜时按钮文案 `重新生成分镜`，带 `regenerate:true`；服务端 force 时事务内删旧再生成。
- 修正 `shots.length===0` 误报「场次不存在」的 404。
- 验收：连点两次，第二次内容变化且仍 6 条。

### P1-C · 版本（T17–T18）

**T17 自动快照 + 按来源裁剪**（backend｜`repository.ts`）
- `updateChapter` 末尾调 `maybeSnapshotChapter(id,'自动存档')`（阈值见 §5.3 D；同内容跳过）。
- 裁剪先删最旧 `自动存档`，再删最旧任意，直到 40。
- 验收：连续写 3 分钟产生 ≤1 条自动版本；手动版本在裁剪后仍在。

**T18 版本面板可用性**（frontend｜`StudioPage.tsx`）
- `保存一个版本`（手动）、自动版本 `自动` 徽章、`refreshVersions` 失败不静默（toast + 重试）。
- 恢复后 toast「已恢复到 <时间>，恢复前内容已存为一条版本」；版本 tab 标注「仅保留最近 40 版」。
- 验收：手写 300 字后出现自动版本；恢复后能看到「回退前」条目。

### P1-D · 导出 / 备份（T19–T22）

**T19 导出范围**（backend｜`index.ts`、`repository.ts`、`docx.ts`）
- 两个导出路由支持 `scope`；空正文 → 400 可读错误。
- 验收：单章导出只含该章；空作品 400。

**T20 导出前端**（frontend｜`StudioPage.tsx`、`ScreenplayPage.tsx`、`api.ts`、新增 `ExportDialog.tsx`）
- `api.exportBlob()`：fetch → `!ok` 解析 `{error}` 抛错 → `createObjectURL` 下载 → `revoke`。
- 弹窗选 `整本 / 当前卷 / 当前章`（无正文禁用并提示）。
- 失败：toast 显示原因，页面不跳转、不丢未保存内容。
- 验收：断网导出停留原页 + 可读错误；成功导出文件名含书名（UI-10）。

**T21 备份/恢复后端**（backend｜`index.ts`、`repository.ts`、`crypto.ts`）
- `GET /api/backup`；`POST /api/restore`（校验 + 预备份 + 事务重灌 + 单飞锁 409）。
- 验收：备份 → 清库 → 恢复 → 作品/章节/版本/消息/设置齐全；坏 JSON 400 且库不变（API-09）。

**T22 备份/恢复 UI**（frontend｜`SettingsPage.tsx`、`api.ts`）
- `立即备份`（下载 + 「包含加密密钥」勾选与提示）、`从备份恢复`（选文件 → 预览 counts → 输入「恢复」确认 → 上传 → 成功后 `location.reload()`）。
- 验收：Playwright 走完下载与恢复（UI-11）。

### P1-E · 设置 / 供应商 / 更新（T23–T25）

**T23 设置页真实化**（frontend｜`SettingsPage.tsx`、`AppContext.tsx`、`api.ts`）
- 版本号取 `bootstrap.app.version`（桌面传 `app.getVersion()`），删 `v0.1 · 全栈版`。
- 「检查连接」改真实 `GET /api/health`（数据库/静态资源/版本三项），删假进度条。
- 开关去留：`autoSave`、`streaming` 接线；`pov/genre/aiLength/style` 注入 prompt；`fallbackModel` 若 T24 未落地则移除并说明。
- 验收：每项开关都能观察到行为差异；删掉的项在 UI 不存在。

**T24 供应商/模型状态 + prompt 注入 + fallback**（backend｜`repository.ts`、`ai.ts`、`index.ts`、`types.ts`）
- `testProviderConnection('mock')` → `{ok:true, kind:'mock', message:'内置演示模型：不发起网络请求'}`；前端 mock 用中性徽章「内置」。
- 非 mock 失败保留真实原因（HTTP 状态/10s 超时）。
- `buildWritingContext` 注入 `prefs.pov/genre/aiLength/style`（当前完全未用）。
- `fallbackModel`：主供应商在首个 delta 前失败 → 备选重试一次；成本超预期则降级为移除该项并记 DECISIONS。
- 验收：切设置后 prompt 含该值（单测或 mock meta 断言）；mock 检查连接不再假绿。

**T25 假数据清理**（ui｜`LibraryPage.tsx`、`CodexPage.tsx`、`OutlinePage.tsx`、`StudioPage.tsx`）
- `LibraryPage:159` 写死引文 → `hero.description`（无则整块不渲染）；`:124` 读 `prefs.autoSave`；`:111-119` 文案改「需先连接模型供应商」。
- `CodexPage:124/133/165/169`：`已同步/已索引 N 位/AI 写作提示` → 真实或中性；`:162` 视角取 `prefs.pov`；出场数改真实或 `—`。
- `OutlinePage`：张力曲线、弧光百分比、`第 1/7/12/18/24 章` 标注「示意」或按真实数据渲染。
- `StudioPage` ghost-block「来自本地演示模型」→ 显示当前 provider/model。
- 验收：grep 硬编码文案 0 命中（ui-test 文本断言）。

### P1-F · 删除家族（T26–T28）

**T26 五种删除 API**（backend｜`repository.ts`、`index.ts`）
- `deleteChapter`（事务：删 ai_messages → 删 chapter → 重算字数 → 返回 nextChapterId）、`deleteCharacter`、`deleteForeshadow`、`deleteShot`、`deleteScene`（CASCADE shots，返回 deletedShots，场次号不重排）。
- 所有删除做归属校验：不属于 URL 里的 project → 404（不泄露存在性）。
- 验收：API-07 全绿；二次删除 404；`total_words` 正确。

**T27 删除 UI 与确认**（frontend｜`StudioPage.tsx`、`CodexPage.tsx`、`ScreenplayPage.tsx`、新增 `ConfirmDelete.tsx`）
- 章节：目录项 hover 菜单 + 作品设置入口；弹窗展示 `字数 / 首段 100 字 / N 条历史版本将一并删除`，需输入章节标题末两字。
- 人物/伏笔/分镜：普通二次确认；场次：提示「连带 N 条分镜」。
- 删除后：当前章被删 → 跳下一章；最后一章 → 空态引导；列表现时更新。
- 验收：五种删除走 UI 完成，刷新后不复活（UI-09）。

**T28 建章防重入**（frontend｜`StudioPage.tsx`）
- `creatingChapter` 锁 + 按钮 disabled（`:462/:478/:489` 三处入口共用）。
- 验收：快速双击只 +1 章。

### P2 · 归档 / 导航 / 文案 / 大纲守卫（T29–T32）

**T29 归档可见可撤销**（frontend｜`LibraryPage.tsx`、`ProjectSettingsModal.tsx`）
- 默认显示「创作中 + 已完结」；新增「显示已归档」开关（localStorage 持久化）；归档卡片打灰标。
- 已归档作品设置里按钮变 `取消归档`；归档 toast 提示找回路径。
- 验收：归档 → 列表消失 → 开开关可见 → 取消归档恢复（UI-11 子场景）。

**T30 Rail 不串作品**（frontend｜`Rail.tsx`）
- 以当前路由 projectId 为准；写作台仅对本项目可用（剧本项目不跳别的作品），无对应项目时显示禁用态 + 提示。
- 验收：在剧本项目里点「写作台」不再跳到别的作品。

**T31 onboarding 文案一致性**（ui｜`LibraryPage.tsx`、`OnboardingPage.tsx`、`SettingsPage.tsx`）
- 统一「首次需连接供应商并填 Key；内置演示模型仅体验用，不能作为首次配置」。
- 删除「没有 Key 也能用」承诺；`OnboardingPage` 错误提示给出下一步（哪里拿 Key）。
- 验收：三处文案与 `canFinish` 一致；grep「不需要 Key」0 命中。

**T32 大纲草稿守卫 + 节拍落当前幕**（frontend｜`OutlinePage.tsx`）
- `selected` 切换前若 dirty → 确认；新增节拍落当前选中的幕（不再固定 `acts[1]`）；`i===1` 假高亮改为真实选中态。
- 不做幕的增删改（§2）。
- 验收：切换场景不静默丢改动；新增节拍进当前幕。

### P2 · 桌面（T33–T34）

**T33 桌面最小修复**（devops｜`desktop/main.cjs`）
- 窗口尺寸/位置记忆（`data/window-state.json`，越界回退默认）。
- 生产包隐藏 `toggleDevTools`；菜单加「关于（版本）」。
- `serverProcess.on('exit')` 非预期退出 → `dialog` 提供 `重启服务 / 退出`；删除无监听者的 `server-exited` 死代码。
- 保留 `before-quit` SIGTERM→1200ms→SIGKILL；不加 preload/IPC（关窗落盘由 T10 兜底，列为已知限制）。
- 验收：`pnpm desktop:test` 通过；手工杀子进程出现弹窗。

**T34 打包冒烟扩展**（devops｜`scripts/desktop-test.mjs`）
- 断言：进程启动、health 200、窗口标题、退出后无残留 node 进程（按 PW_DATA_DIR pkill 兜底）、失败信息指明环节。
- 验收：本机与 CI 均可跑。

### 交付（T35–T38）

T35 `api-test` 扩展、T36 `ui-test` 扩展、T37 独立审查、T38 文档/REPOWIKI 更新（见 §7）。

---

## 7. 测试矩阵

### 7.1 API（`software/scripts/api-test.mjs`，端口 8799，mkdtemp 临时库）

| 编号 | 断言 | 对应 |
|---|---|---|
| API-01 | 空库首启：providers=9、projects=0、`health.db.ready=true` | P0-1 |
| API-02 | 删光 projects → 重启同 dataDir → 200、无 UNIQUE、`seeded` 不变 | P0-1 / A4 |
| API-03 | 旧库升级：删 `app_meta`、老 schema 的 ai_messages → migrate 后列存在且默认 `done` | H4 |
| API-04 | mock 流中止 → assistant `status='aborted'` 且内容非空 | P0-2 / A2 |
| API-05 | regenerate + `regenerateOf` → 总数不变、目标 id 被替换 | A10 |
| API-06 | messages 分章：A 章 2 条、B 章 0 条 | P1-11 |
| API-07 | 五种删除 200 + 二次 404 + `total_words` 重算 | A7/A8 |
| API-08 | 导出整本/单章/卷；空作品 400 | A5/A6 |
| API-09 | 备份→清库→恢复→counts 一致；坏 JSON 400 且库不变 | A24 |
| API-10 | 自动快照：两次达阈值 PATCH → 版本 +1；同内容不新增 | P1-6 |
| API-11 | 造 45 条（含手动）→ 手动版本仍在 | P1-6 |
| API-12 | 跨项目删除/归属校验一律 404 | 安全 |
| API-13 | plan 超时 504；abort 2s 内释放 | P1-7 |
| API-14 | 字数口径 client/server 一致（`productionPipeline`/shared） | R15 |

### 7.2 UI（`software/scripts/ui-test.mjs`，端口 8798，截图 `screenshots/NN-*.png`）

| 编号 | 场景 |
|---|---|
| UI-01 | 不存在作品 → 四页错误卡（含「返回作品库」），无无限转圈 |
| UI-02 | 新建（勾选企划）→ planning 中 Esc → 进入写作台且作品存在 |
| UI-03 | 企划失败（注入错误）→ 弹窗留驻 + 重试可用 + 可直接进入 |
| UI-04 | 写作 → ⌘S → 「已保存」；刷新内容在 |
| UI-05 | 输入后立刻关闭页面 → 新页有「草稿恢复」横幅且内容正确 |
| UI-06 | AI 续写 → 停止 → 「已中止」卡片 → 插入正文成功 |
| UI-07 | AI 插入后 ⌘Z 撤销成功 |
| UI-08 | 同句 3 次，改第 3 处只变第 3 处 |
| UI-09 | 删除章节（输入标题确认）→ 跳下一章；历史版本一并消失（弹窗已提示） |
| UI-10 | 导出当前章 → download 事件 + 文件名；断网导出 → 错误 toast 且停留原页 |
| UI-11 | 归档筛选/取消归档、备份下载、恢复后数据一致 |
| UI-12 | 重新生成分镜 → 内容变化且仍 6 条 |

### 7.3 桌面冒烟

`pnpm desktop:test`：启动 → health 200 → 窗口标题 → 退出无残留；`pnpm desktop:pack` 产物存在（不发布）。

### 7.4 手动 smoke（交付前开发者执行）

1. 全新 data 目录首启 → onboarding 强制 Key 文案一致。
2. 删光作品 → 重启 → 健康、空态正常。
3. 断网写作 → 保存失败可重试、内容不丢。
4. 旧库（改动前备份的 `studio.db`）升级 → 作品/版本/消息都在。
5. docx 用 Word/WPS 打开正常；备份 JSON 手工可读。

---

## 8. 回滚与风险控制

| 层级 | 手段 |
|---|---|
| 单任务 | 每 T 一个本地 commit（`fix(p0-1): seed 幂等`），按编号 revert |
| 分组 | P0 / P1-A…P2 各自 squash commit，可整体回退 |
| 数据 | 动手前手动备份 `data/studio.db` + `.secret`；T21 自带 `pre-restore-<ts>.db` |
| 迁移 | 新列带默认值、新表 `CREATE IF NOT EXISTS`；回滚代码不删列 |
| 门禁 | M1 未过不合并 P1；任一 P0 不过不得进入 M2 |

---

## 9. 改动面与工时

| 区域 | 文件 | 行数 |
|---|---|---|
| server | `db.ts` +40、`seed.ts` ±10、`index.ts` +180、`repository.ts` +260、`ai.ts` +60、`crypto.ts` +6、`docx.ts` +15 | +570 / −65 |
| client | `api.ts` +120、`StudioPage.tsx` +260、`SettingsPage.tsx` +180、`ScreenplayPage.tsx` +80、`CodexPage.tsx` +90、`LibraryPage.tsx` +60、`NewProjectModal.tsx` +90、`PlanReviewModal.tsx` +40、`ProjectSettingsModal.tsx` +50、`ChapterEditor.tsx` +40、`Rail.tsx` +15、`OutlinePage.tsx` +45、`App.tsx` +20、`main.tsx` +8、新增 6 文件 +380 | +1 480 / −180 |
| desktop | `desktop/main.cjs` +45 | +45 |
| tests | `api-test.mjs` +220、`ui-test.mjs` +190、`desktop-test.mjs` +30 | +440 |
| 合计 | ≈ 32 文件（含 6 个新文件） | ≈ +2 500 行 |

工时合计 ≈ 128 人时（16 人日）。2–3 角色并行约 5–7 个工作日；串行依赖点见 `TASKS.json` 的 `deps`，关键路径：T01→T26→T27、T21→T22、T35/T36→T37。

---

## 10. 已知限制（交付时须在 SUMMARY 如实列出）

1. 章节删除不可逆（历史版本随 CASCADE 删除），只有备份能救。
2. 富文本（加粗/斜体）仍是视图效果，落库走 `innerText`；本轮不修，UI 标注。
3. 恢复备份后需重启服务才让新 `.secret` 生效（crypto 的 secret 是模块级常量）；恢复含密钥的备份时返回 `requiresRestart`，桌面端提示「重启应用」。未勾选「一并恢复密钥」时，已存 API Key 解不开需重填。
4. 桌面关窗落盘是 best effort（`pagehide` + keepalive），强杀进程仍可能丢最后几百毫秒。
5. 未签名构建的自动更新仍会失败并回退下载页（不改发布策略）。
6. 旧库中的项目级 AI 消息（`chapter_id IS NULL`）不再出现在章节对话里。
7. 单作品 JSON 导入（bundle）列二期，本轮只做整库备份/恢复。
8. `db.ts` 在 **import 期**就 `new DatabaseSync()`，data 目录不可写/文件被占用时进程仍在启动阶段退出，`migrate()` 容错覆盖不到；彻底修需把 db 改成惰性单例（牵动全仓 import），本轮不做。
9. 章节删除的「版本快照」实际随 `ON DELETE CASCADE` 一并销毁（schema 事实），确认弹窗已写明「N 条历史版本将一并删除」。
