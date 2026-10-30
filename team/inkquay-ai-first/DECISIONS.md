# DECISIONS — Inkquay AI-first 重构的架构决策记录（ADR）

日期：2026-10-29
作者：architect（team inkquay-ai-first）
配套：`ARCHITECTURE.md`（设计主体）、`MIGRATION.md`（迁移与回退）
需求基线：`SPEC.md` v1.0；交互基线：`UX-SPEC.md`；已拍板决策：`CAPTAIN-DECISIONS.md`（D1–D7）

**约定**

1. ADR 编号已被 `ARCHITECTURE.md` / `MIGRATION.md` 交叉引用（如 ADR-1、ADR-3、ADR-8、ADR-9、ADR-12、ADR-13、ADR-14），**不得重排、不得复用编号**；作废只能标 `superseded by ADR-x`。
2. 状态三种：`已确认`（用户或 CAPTAIN-DECISIONS 拍板，实现方不得改）、`提议`（本文作者决定，待 t5 评审/实施方挑战）、`待决策`（需用户拍板，见 §3）。
3. 效力顺序：**用户拍板 > CAPTAIN-DECISIONS > SPEC > UX-SPEC > 本文**。本文若与上级冲突，以上级为准并在 §5 登记。
4. 每条 ADR 都写"验证"——没有验证方式的决策等于没决策。

---

## 0. 一句话结论

在**现有工程内做增量重构**（同仓同栈、新增 `pipeline` 模块 + 7 张表、旧表只加列不搬行），因为 AUDIT 已证明 `plan` 调用链本身可用，坏的是生命周期编排；迁移采用"**只做新增**"，回退退化为"删新增行 + 复位新列"，旧正文与版本物理上永不移动。

---

## 1. 决策总览

| # | 决策 | 状态 | 影响面 | 被引用处 |
|---|---|---|---|---|
| ADR-1 | 采用"现有工程增量重构"（不走新建模块并存、不换栈） | 提议 | 全局 | ARCH §8、§1.4 |
| ADR-2 | 生成逻辑全部下沉 `server/pipeline/`，路由层只校验 + 入队 | 提议 | server | ARCH §1.3、§3.1 |
| ADR-3 | `characters/outline_acts/outline_beats/chapters` **不搬进** `stage_items`，用适配层统一 API | 提议 | server/迁移 | ARCH §3.3、MIG §1.4 |
| ADR-4 | job 保持 SPEC 的 6 态；"暂停"用 `pause_requested` + `stop_mode` 表达，不新增第 7 态 | 提议 | 状态机/QA | ARCH §3.2、§11 R-3 |
| ADR-5 | 长篇 P3 计划**直接存 `chapters`**，不建并行 `chapter_plan` 表 | 提议 | 数据模型 | ARCH §11 R-6 |
| ADR-6 | V1 是**单进程**架构（内存队列 + sqlite 单写者）；多进程/云化列为待决策 | 待决策 | 部署 | ARCH §3.5、§8.3 |
| ADR-7 | 阶段确认 = 写 `confirmed_revision_id` 快照，**不冻结/不复制表** | 提议 | 确认语义 | ARCH §3.3、§3.10 |
| ADR-8 | 迁移**只用新增表 + 新增列**，绝不移动/重写旧行 | 提议 | 迁移 | MIG §1.2、§2 |
| ADR-9 | 单作品迁移回退 = 删新增行 + 复位新列（不是整库还原） | 提议 | 回退 | MIG §8.1 |
| ADR-10 | `foreshadows` 不并入 `outline_beats.foreshadow` | 提议 | 迁移 | MIG §3.3 |
| ADR-11 | 修订保留策略：阶段快照留"全部确认快照 + 最近 50 条"，章节版本沿用现有 40 条裁剪 | 提议 | 数据量 | ARCH §3.3 |
| ADR-12 | 短篇正文写 `stage_items.body`，**同事务**回写 `chapters.content` | 提议 | 短篇/导出 | MIG §3.4、§10 M-R4 |
| ADR-13 | 短篇 P4 单位用 `stage_items(kind='beat_plan')`，不用 `scenes`/`outline_beats` | 提议 | 短篇 | MIG §11 D-6 |
| ADR-14 | **不新增运行时依赖**（无 zod / react-query / 状态库），校验器手写 | 已确认（项目惯例） | 全局 | ARCH §1.3 |
| ADR-15 | 进度通道 V1 = **轮询快照**，SSE 推迟到 V1.1（契约先锁定） | 提议 | 前端/后端 | ARCH §3.11、§11 R-9 |
| ADR-16 | `nextStep` 由服务端快照唯一下发，前端不重算 | 已确认（D6） | 前端/服务端 | ARCH §3.12、§11 R-10 |
| ADR-17 | 审阅四键只在写作台渲染，流水线页只给导航 | 已确认（D5） | 前端/QA | ARCH §3.13、§11 R-11 |
| ADR-18 | P3"按目标字数分配"拆"预览 + 应用"两步，默认跳过手改行 | 已确认（D7/D9） | 前端/后端 | ARCH §3.13、§11 R-12 |
| ADR-19 | 章节写入是**章级原子**（正文+版本+状态同事务、可 AP 追加），P4 job 连续循环 | 已确认（D4） | 后端 | ARCH §3.4、§3.8 |
| ADR-20 | D4 覆盖 SPEC §4.5 的"逐章停在 in_review"字面描述 | 已确认（D4） | 需求/排期 | ARCH §11 R-1 |
| ADR-21 | 错误码扩展 3 个（`CONFIRM_BLOCKED`/`TYPE_NOT_SUPPORTED`/`IDEMPOTENT_REPLAY`），失败必写 `lastError` + 日志 | 提议 | 契约/可观测性 | ARCH §11 R-5、§3.14 |
| ADR-22 | 回退时新写章节**归档**（`archived_at`）而非物理删除 | 提议 | 迁移/回退 | ARCH §11 R-4、MIG §8.1 |

---

## 2. 决策详情

### ADR-1 采用"现有工程增量重构"（A 路径）

- **状态**：提议（推荐给 captain/用户；B/C 方案见 ARCH §8.1 对比表）
- **背景**：AUDIT 证明"新建并让 AI 企划"的故障是**生命周期编排缺陷**（无进度、无取消、无持久化、失败留空壳、全量重建冲掉手改），而不是模型/Key/prompt/DB 事务坏了——同一把 Key 原样重放 plan 请求 200/190ms/3108 字可 `JSON.parse`。
- **决策**：同仓同栈重构。新增 `server/pipeline/*`（约 2.5k 行）与 `client/pages/pipeline/*`（约 2k 行），改 6 个现有文件、删 1 个（`PlanReviewModal.tsx`），旧 6 张内容表与 Studio 编辑器/版本面板全部保留。
- **理由**：① 缺陷与栈无关，换栈只会把"6 类缺陷"变成"6 类缺陷 + 全量回归风险"；② `pipeline` 模块边界切在 store/runner 上，若 V1.1 要云化可整体抽出（架构不做死）；③ 旧作品零迁移即可用（`legacy` 形态），AUDIT 里那个孤儿空壳也能继续在旧编辑器里救。
- **代价**：`StudioPage`（1102 行）剥离内联企划逻辑需要有序；pipeline 与 Studio 共用同一批表，写路径纪律必须靠测试兜住（ADR-3/ADR-19）。
- **验证**：ARCH §12 文件清单逐项落地；`grep -n "planProject\|planPreview" src/client` 在改完后为 0（新流程不再在弹窗里等企划）。

### ADR-2 生成逻辑下沉 `server/pipeline/`，路由层只校验 + 入队

- **状态**：提议
- **背景**：现状 `index.ts:102-111` 在请求体里 `await generateProjectPlan(...)`，请求超时即丢上下文，且无法取消、无法恢复。
- **决策**：路由层允许的动作只有：解析参数、读 `store`、调 `runner.enqueue`、返回 `202/409/422`；任何 `await provider` 都不许出现在 `index.ts`。
- **理由**：把"请求生命周期"和"任务生命周期"解耦是 D2（关页面不取消）与 SPEC §7.3（断点恢复）的前提。
- **代价**：进程内 runner ⇒ 单进程限制（ADR-6）；需要自建队列与幂等（ARCH §3.5/§3.6）。
- **验证**：`grep -n "await .*callModel\|generateProjectPlan\|streamAssistant" src/server/index.ts` 只允许出现在 `/api/ai/stream`（聊天是同步流式，属既有能力）。

### ADR-3 旧内容表不搬进 `stage_items`，用适配层统一 API

- **状态**：提议
- **背景**：`characters` / `outline_acts` / `outline_beats` / `chapters` 已被 `CodexPage`、`OutlinePage`、`export`（md/docx）、`bundle` 导入导出、`getProjectDetail`（`repository.ts:170`）五条链路读取。
- **决策**：物理上原地不动，新增 `ItemStore` 适配层把 6 种 item kind（`world/env/character/act/beat/chapter/beat_plan`）统一成 `{listItems, patchItem, lockItem, itemRevisions}`；`stage_items` 只存没有旧表承载的两类（`world/env` 与短篇 `beat_plan`）。
- **理由**：搬表等于重写五条链路并制造"双真相"；适配层让 Codex/Outline/export/docx/bundle **零改动**继续工作。
- **代价**：item 的"锁定/stale/修订计数"要分流到不同表（ARCH §6.1 的 `locked` 列只对 `stage_items` 与 `outline_*` 各自存在）；跨表聚合查询要写在 `store` 里，不能散落。
- **验证**：迁移后 `CodexPage`/`OutlinePage` 保存路径不改一行仍可读写；`export`/`docx`/`bundle` 输出与迁移前逐字节一致（MIG §9.3）。

### ADR-4 job 保持 6 态；"暂停"用请求列 + `stop_mode` 表达

- **状态**：提议（对齐 SPEC §3.2 与 D4/UX §7.4）
- **背景**：SPEC §3.2 把 job 限定为 `queued/running/succeeded/failed/cancelled/interrupted` 6 态，但 D4 需要"暂停（本章写完才停）"。新增第 7 态会同时打崩 SPEC 状态机与 QA 枚举。
- **决策**：`generation_jobs` 增 `pause_requested`(0/1) 与 `stop_mode`(''|'pause'|'stop')；暂停语义 = 置 `pause_requested=1` → 本章写完 → `status='cancelled'` + `stop_mode='pause'`；**对外快照** `JobView.state` 派生 `pausing/paused`（`ARCH §3.2` 映射表）。
- **理由**：内部状态机只增列不增态，QA 的 `data-status`/`job.state` 断言集合不变；恢复就是普通新 job（`retry_of_id` 指向旧 job）。
- **代价**：`JobView.state` 与 `generation_jobs.status` 是两个概念，必须有单一映射函数（`pipeline/snapshot.ts:deriveJobView()`），并在 CODE REVIEW 时禁止别处手写映射。
- **验证**：单测对 `deriveJobView()` 做 6 组（含 pause_requested 或 0/1、stop_mode=''|'pause'|'stop'）真值表；E2E：暂停后 `write-continue` 能从第一个 `pending` 章续写。

### ADR-5 长篇 P3 计划直接存 `chapters`，不建 `chapter_plan` 表

- **状态**：提议
- **背景**：P3 的单元（章）与 P4 的单元（章）是同一个东西；若 P3 存 `chapter_plan` 表、P4 存 `chapters`，就必须双写并维护两张表的一致性。
- **决策**：`chapters` 增计划列（`plan_function/plan_synopsis/plan_characters/min|target|max_words/target_manual/plan_locked/current_version_id/review_status/stale/archived_at`），`content=''` 表示"只有计划、还没写"。`revisions.targetId` 直接指向章节 id。
- **理由**：单真相；现有 `recalculateProjectWords`（`repository.ts:248`，`SUM(words) FROM chapters`）、`export`、版本面板、StudioPage 章节列表**全部不用改口径**（计划章 words=0 自然不计入）。
- **代价**：P3 阶段"计划条目的排序"复用 `chapters.sort_order`（现有 `reorderChapters` 语义）；短篇不能走这条路（ADR-13）。
- **验证**：迁移后 `select count(*) from chapters where project_id=? and content=''` = P3 计划条数；长篇作品 `total_words` 迁移前后相等（MIG §9.3 第 5 条）。

### ADR-6 V1 是单进程架构，多进程/云化待用户决策

- **状态**：待决策（DQ-1）
- **背景**：`JobRunner` 的并发控制（全局 3、单作品 1）依赖进程内存 + `node:sqlite` 单写者；起两个 server 指向同一 `PW_DATA_DIR` 会出现双 runner + WAL 写冲突。
- **决策**：V1 明确单进程，并把这条写进运维文档（ARCH §3.5 已写"已知限制"）；同时保持架构不做死——`store.ts` 只用标准 SQLite 方言子集，`pipeline` 不依赖 Express。
- **理由**：Electron 桌面版本来就是单进程单用户；引入 Postgres/队列只会增加部署负担而无收益。
- **代价**：不能多开窗口跑两个库实例（同一 `PW_DATA_DIR`）；断电/崩溃后依赖启动扫描恢复（ARCH §3.9）。
- **验证**：启动时检测同库已有活跃 runner（`app_meta` 里的 `runner_lock`，带 pid+启动时间，3s 心跳），发现冲突则只允许只读并打 WARN。

### ADR-7 阶段确认 = 快照 revision，不冻结表

- **状态**：提议
- **背景**：SPEC INV-1 要求"已确认内容不可被静默覆盖"，但用户仍要能改已确认阶段（改完回 `review`）。若确认时复制整表，必然双写。
- **决策**：确认只做三件事：`stage.status='confirmed'`、`stage.confirmed_revision_id=<当前快照 revision>`、写一条 `revisions(kind='stage-snapshot')`（JSON 全量快照）。之后编辑/重生成只新增 revision，快照行永不清（除非用户显式回滚）。
- **理由**：一次写、可 diff、可回滚；不需要"确认副本表"，也不需要给每行加"已确认版本"。
- **代价**：快照 JSON 会随阶段体积增长（ADR-11 的保留策略兜底）；确认后编辑必须同步把 `stage.status` 打回 `review` 并给下游打 stale（ARCH §3.10 写白名单）。
- **验证**：迁移/确认后修改 P1 一条人物 → `stages.p2.stale=1` 且 `depends_on` 记原因、P2 内容逐字节未变；`stage.confirmed_revision_id` 指向的快照仍可读且 `JSON.parse` 成功。

### ADR-8 迁移只用新增表 + 新增列，绝不移动旧行

- **状态**：提议（三条原则的实现化，SPEC §9.1）
- **背景**：旧作品有正文与版本，任何"搬表/重写行"都会让回退变复杂、让验收无法逐字节对账。
- **决策**：迁移只做 `CREATE TABLE/INDEX` 与 `ALTER TABLE ADD COLUMN`（全部可空或带默认）；`characters/outline_acts/outline_beats/chapters/chapter_versions/foreshadows` 的既有行**逐字节不变**。
- **理由**：回退退化为"删新增行 + 把新列复位"（ADR-9），可证可测；迁移失败也不会把旧作品写坏。
- **代价**：迁移后"旧表 + 新列"混存，读路径要区分 `review_status=''`（未进流水线）与 `'in_review'` 等状态（MIG §3.3 已列全）。
- **验证**：MIG §9.3 的九条逐字节校验（`count(*)` + `md5` 级对比 + `PRAGMA integrity_check`）。

### ADR-9 单作品迁移回退 = 删新增行 + 复位新列

- **状态**：提议
- **背景**：SPEC §9.4 要求"回退后旧流程能打开且内容不丢"。
- **决策**：回退按固定顺序：删 `generation_jobs/job_events/review_records/revisions` 中该作品的行 → 删 `stages/stage_items` 中该作品的行 → 把 `chapters.review_status/current_version_id/min|target|max_words/plan_*/stale/last_error/target_manual` 复位（`''`/NULL/0）→ 若迁移期间产生过新章节（迁移本身不新写正文，但用户可能在 P4 写过），**归档**（`archived_at`）而非删除（ADR-22）→ 删 `migrations` 行。
- **理由**：回退是"回到迁移前的那份数据"，而不是"把库还原"；不需要备份参与日常回退（备份只兜灾难）。
- **代价**：回退后新写内容只能归档不能消失，文案与 SPEC §9.4 的"丢失 N 章"有出入（ARCH §11 R-4 登记为偏差）。
- **验证**：MIG §8.3 的 MR1–MR4（打开/workbench 计数/legacy 横幅/可再次升级）。

### ADR-10 `foreshadows` 不并入 `outline_beats.foreshadow`

- **状态**：提议
- **背景**：P2 节拍有 `foreshadow`（预设伏笔）字段，现有 `foreshadows` 表是作品级伏笔清单。
- **决策**：V1 不合并。`outline_beats.foreshadow` 只放 P2 生成时写入的文本；`foreshadows` 保持独立，`CodexPage` 继续可编辑。
- **理由**：合并需要判断"哪条伏笔属于哪个节拍"，凭空推断会产出错误大纲（宁可留两个字段，也不静默错配）。
- **代价**：伏笔在两处出现，导出时都要带上（export 已同时读两处）。
- **验证**：迁移后 `foreshadows` 行数不变、`bundle` 导出字段不变。

### ADR-11 修订保留策略

- **状态**：提议
- **背景**：`revisions` 是全量存（每次生成/manual/迁移一行，含 JSON），P4 每次写章还有版本；长期会涨。
- **决策**：① `revisions` 中 `kind='stage-snapshot'`（确认快照）**永不清**；② 同阶段同目标的普通 revision 保留最近 50 条（超出按 `created_at` 删最旧，日志打印删了几条）；③ 章节版本沿用现有 40 条裁剪（`repository.ts:966-990` 已实现，不改）；④ 迁移产生的 revision `kind='migration'` 保留全部（审计需要）。
- **理由**：与现有 40 条策略一致，不引入第二种"保留几位"的概念；确认快照是回滚的锚，必须永久。
- **代价**：极端情况下单阶段 revision 会到 50+N（N=确认快照数），文件体积可控（每条约 1–5KB）。
- **验证**：单测：连写 60 条普通 revision → 剩 50 条且最旧 10 条被删、确认快照仍在；`chapter_versions` 仍保留 40。

### ADR-12 短篇正文存 `stage_items.body`，同事务回写 `chapters.content`

- **状态**：提议
- **背景**：短篇的 P4 单位是"节拍"，但导出（md/docx）、字数统计（`SUM(words) FROM chapters`）与版本面板都以 `chapters` 为唯一来源。
- **决策**：节拍正文主存 `stage_items(kind='beat_plan').body`；每次写入在**同一事务**里回写 `chapters.content/words`（该作品迁移时保留的那行整篇记录）与 `projects.total_words`。写入方向单一：P4 只写 `stage_items.body`，`chapters` 是投影。
- **理由**：既满足"短篇不产生章节行"的 QA 断言（`chapter-row` 计数=0、`beat-row`>0），又不改导出/统计口径。
- **代价**：两处正文必须靠事务保证一致（MIG §10 M-R4 列为风险）；若有人直接改 `chapters.content` 会漂移——写路径白名单禁止。
- **验证**：短篇 P4 写完后 `select content from chapters` 与按 `ordinal` 拼接的 `stage_items.body` **逐字节相等**；`words` 与拼接后中文字数一致（±0）。

### ADR-13 短篇 P4 单位用 `stage_items(kind='beat_plan')`，不用 `scenes`/`outline_beats`

- **状态**：提议
- **背景**：派单说"短篇无 chapters 时用 scenes/beats 作等价结构"。
- **决策**：用 `stage_items(kind='beat_plan')`（含 `title/function/synopsis/body/words/min|target|max_words/ordinal`）。`scenes` 是剧本（场/分镜）语义、`outline_beats` 属 P2 大纲，两者都不需要"正文 + 字数"。
- **理由**：语义正确 + 不与剧本页抢表；`stage_items` 本来就是"没有旧表承载的阶段条目"的落点（ADR-3）。
- **代价**：短篇的 P3 → P4 是同一批行（计划阶段 body 为空），要保证"计划已确认才能写"（服务端 `STAGE_LOCKED`）。
- **验证**：短篇 E2E：P3 确认后 `beat-plan-row` 计数 = N，`beat-row` 计数 = 0（未写）；P4 后 `beat-row`=N、`chapter-row`=0、导出 md 连续可读。

### ADR-14 不新增运行时依赖

- **状态**：已确认（项目惯例：Electron 体积 + 离线优先）
- **决策**：不引 zod/react-query/状态库/UI 库；结构校验手写（`pipeline/schema.ts`），前端状态用现有 `useState` + `usePipeline` hook。
- **理由**：安装包体积与离线可用性是产品硬约束；本项目的既有代码风格也是零依赖。
- **代价**：校验器要自己写（约 300 行），错误信息自己拼（但换来可控的中文 code 与 `blockers`）。
- **验证**：`package.json` 的 `dependencies` 变更 diff 为空；`node_modules` 无新增顶层包。

### ADR-15 进度通道 V1 = 轮询快照，SSE 推迟到 V1.1

- **状态**：提议（对齐 UX-SPEC §12.4，替 SPEC §7.5 的"SSE 日志"留出实现空间）
- **背景**：SPEC §7.5 提到任务事件流；AUDIT 现场的失败是"没有通道"，不是带宽不足。`node:sqlite` 是同步 API，与 SSE 长连接共用事件循环需要额外小心。
- **决策**：`GET /api/projects/:id/pipeline` 返回全量快照，2s/10s/5s 分级轮询（ARCH §3.11）；`job_events` 照写（排障 + V1.1 重放），SSE 契约（事件名/心跳/`Last-Event-ID`）先在文档锁定，V1 不实现。
- **理由**：轮询没有半开连接/代理超时/重连语义三类坑；每次全量快照让前端不需要增量状态机（也是 D6 的前提）；生产上单用户 2s 一次 8 条 SELECT 完全可承受。
- **代价**：进度延迟上限 2s（可接受，SPEC 要求 ≤2s）；多窗口同时开着会乘以轮询量（V1 单窗口，可忽略）。
- **验证**：快照 p95 < 120ms（本地实测，MIG §9.2 同法）；E2E 断言 `plan-progress` 秒数 2s 内增长、job 结束后 3s 内视图切换。

### ADR-16 `nextStep` 由服务端唯一下发

- **状态**：已确认（CAPTAIN-DECISIONS D6）
- **决策**：`PipelineSnapshot.nextStep` = `{kind(封闭枚举 15 值), label(中文), stage?, blockers?, count?}`，由 `pipeline/snapshot.ts:deriveNextStep()` 纯函数算；前端只渲染与跳转。
- **理由**：两处判定必然漂移（本项目踩过跨仓两套规则的坑）；服务端才知道 `lastError`、review 计数、阻断原因。
- **代价**：文案改动要发版（不能前端热改）；`label` 里的数字由服务端拼（i18n 暂时不需要）。
- **验证**：单测 15 分支 + 3 个优先级冲突；前端 `derive.ts` 里 `grep -c "nextStep\|审阅并确认设定"` = 0。

### ADR-17 审阅四键只在写作台渲染

- **状态**：已确认（CAPTAIN-DECISIONS D5）
- **决策**：`chapter-approve/chapter-request-changes/chapter-manual-approve/chapter-skip` 只存在于 `StudioPage`；流水线章节行只渲染 `chapter-row` + 「审阅」导航（跳 `/project/:id?chapter=<id>&review=1`）。四键的唯一写入口是 `POST /api/chapters/:id/review`。
- **理由**：锚点全站同页唯一，QA 不用 `.first()` 兜底；也避免两套审阅 UI 的行为漂移。
- **代价**：用户要审章必须走一次页面跳转（D4 下这是"批量审阅"的一部分，UX §7.9 已设计流程）。
- **验证**：任一页面 `document.querySelectorAll('[data-testid=chapter-approve]').length <= 1`；流水线页 = 0。

### ADR-18 P3"按目标字数分配"拆两步

- **状态**：已确认（CAPTAIN-DECISIONS D7 / D9）
- **决策**：`POST .../units/allocate {totalTarget}` **纯计算**返回预览（每行 `targetWords/min/max/manuallyEdited` + 总偏差 + 是否超 ±25%）；用户确认后走 `POST .../units/allocate/apply {rows, includeEdited?}` 落库。手改过的行置 `chapters.target_manual=1`，`apply` 默认跳过并返回 `422 TARGET_EDITED`。
- **理由**：禁止静默重算用户手改过的字数；偏差超阈值必须显式接受（SPEC §10.2）。
- **代价**：多一次往返；预览态要保留（用户改一行后重新预览）。
- **验证**：E2E：手改 1 章 target → 点分配 → 预览里该行标 `manuallyEdited` → 应用后该行 target 不变、其余行按比例变；总偏差 >25% 时出现"接受偏差"复选。

### ADR-19 章级原子写入 + P4 连续循环

- **状态**：已确认（D4 + Spec §4.5 其余条款）
- **决策**：每章一个事务：`chapters.content/words` + `chapter_versions` insert + `current_version_id` + `review_status='in_review'` + `recalculateProjectWords` + `job_events` 一行 + `job.units_done`；job 循环内直接写下一章（不再等 `approved`）。追加模式（"继续写"）也走同一函数，基于 `currentVersionId` 做 AP 追加。
- **理由**：连续写必须"要么整章落库要么不落"，否则 D4 的"立即停止丢弃未完成正文"无法成立。
- **代价**：长章（3000–6000 字）单次事务写 ~50KB，sqlite 同步写 ~几 ms，可接受；`total_words` 全量重算在 500 章时也要 ~10ms（可接受，若变慢改增量）。
- **验证**：模拟 abort：在 `createChapterVersion` 前抛错 → 该章 `content` 仍为空、`units_done` 未增、无孤儿版本行。

### ADR-20 D4 覆盖 SPEC §4.5 的逐章 REVIEW 字面描述

- **状态**：已确认（用户 2026-10-28 拍板，见 CAPTAIN-DECISIONS D4）
- **决策**：P4 是"连续生成到最后一章 → 全部写完 → 逐章审"，不做"每章等 `approved` 才写下一章"的阻塞状态机；暂停/停止/单章失败恢复/版本回滚/字数校验全部保留。
- **理由**：用户对节奏的明确选择；阻塞式逐章会让人盯着 40s 一章的空转（正是 AUDIT 现场的体验问题）。
- **代价**：必须显式修订 SPEC §4.5 那句（ARCH §11 R-1 已登记，建议 pm 加一行"以 D4 为准"）；QA 的 S1 黄金路径要按 D5 的改写执行（UX-SPEC §7.9）。
- **验证**：E2E 连续写作：从 `write-start` 到全部 `in_review` 一次跑完（不点任何审批）；随后逐章审阅 4 个动作各生效一次。

### ADR-21 错误码扩展 3 个 + 失败必写 lastError/日志

- **状态**：提议
- **背景**：SPEC §7.1 列了 18 个"必须给 code"的场景，但新交互引入了 3 类新失败：门槛未满足、类型不支持、幂等重放。
- **决策**：新增 `CONFIRM_BLOCKED`(422，带 `blockers`)、`TYPE_NOT_SUPPORTED`(409，剧本/剧集进流水线)、`IDEMPOTENT_REPLAY`(200，带原结果)；**不替代**任何既有 18 个 code。所有失败写 `projects.last_error` + 一行结构化日志（`ARCH §3.14`）。
- **理由**：新场景必须有明确 code，否则前端只能显示"未知错误"；但改写既有 code 会让 QA 的断言失效。
- **代价**：前端错误映射表要多 3 行；QA 的 18 个 code 断言不受影响。
- **验证**：`grep -o "code: '\?[A-Z_]\+" src/server | sort -u` 覆盖 18+3；E2E 每个 code 至少触发一次（MIG/ARCH 的测试清单）。

### ADR-22 回退时新写章节归档而非物理删除

- **状态**：提议（登记为对 SPEC §9.4 的实现偏差，见 ARCH §11 R-4）
- **决策**：迁移后用户在 P4 写出的章节，回退时置 `archived_at`（列表/导出/字数统计过滤掉），物理行保留，直到下次成功升级或用户显式"清理归档"。
- **理由**：`DELETE` 之后只能靠备份文件找回，而备份恢复要退 App、覆盖整库（MIG §6.3），对用户是重操作；归档让"回退"可逆。
- **代价**：与 SPEC §9.4 文案"丢失 N 章正文"不完全一致——文案照说，但数据可找回；需要 QA 知情（否则会断言 `count(*)=0`）。
- **验证**：回退后 `select count(*) from chapters where project_id=? and archived_at is null` = 迁移前基线；`archived_at is not null` 的行数 = 回退前新增章数。

---

## 3. 待用户决策（**不擅自实施**，实现方遇此六项按"V1 现状"处理）

| # | 决策点 | 选项 | 默认（未拍板前） | 影响 |
|---|---|---|---|---|
| DQ-1 | 是否要多端 / 云同步（决定 Postgres + 独立 worker） | ① 不做 ② 做 | 不做（ADR-6 单进程） | 做则 `store.ts` 与 runner 需重写，估时 +2–3 周 |
| DQ-2 | 是否接受单进程限制（同 `PW_DATA_DIR` 只一个 server） | 接受 / 不接受 | 接受（写进运维文档） | 不接受需外部队列或文件锁 + 只读降级 |
| DQ-3 | V1.1 是否要"AI 自动通过所有章"托管模式 | 不要 / 要 | **不要**（D4 已否） | 要则新增审阅策略配置，且 `completed` 语义变化 |
| DQ-4 | 是否要"只导出大纲/设定"（D5 里的 V1 可选） | 要 / 不要 | 不要（不阻塞） | 要则 export 增一个入口，工作量 ~0.5 人日 |
| DQ-5 | 迁移是否提供"全部一键升级"给普通用户 | 提供 / 仅提供单作品 | 单作品（批量 sweep 属隐藏能力，MIG §5） | 提供则需额外确认弹窗与进度页 |
| DQ-6 | 回退时新写章节是归档还是按 SPEC 字面物理删除 | 归档（ADR-22）/ 删除 | 归档 | 删除则失去可逆性，QA 断言以 `count(*)=0` 为准 |

> 这六项都不阻塞 V1 开工；任一被用户拍反，需回改的只有 `store.ts` 的 SQL 方言、`runner` 的锁、`export` 入口与 `migrations` 的回退分支，不涉及数据模型。

---

## 4. 已否决的方案（记录原因，避免后人重走）

| 方案 | 否决理由 |
|---|---|
| 在新流程里复用现有 `POST /api/projects/:id/plan` 的"一次生成三幕+人物+第一章" | 与 D1 直接冲突（首次企划只产 P1+P2）；且单次调用 40s~90s，无法做阶段确认与逐章计划（SPEC §4.1–4.4 的阶段契约无法满足） |
| 把 `characters/outline_acts/outline_beats/chapters` 全搬进 `stage_items` | 要重写 Codex/Outline/export/docx/bundle 五条链路并双写（ADR-3） |
| 在弹窗里等企划完成再跳转（现状） | AUDIT R1/R2 的根因；D2 明确否掉 |
| 用 SSE 作为 V1 唯一进度通道 | 单进程 + 同步 sqlite 下收益不抵复杂度；UX-SPEC §12.4 已把 SSE 列为 V1.1（ADR-15） |
| 每章 `approved` 才写下一章 | 用户已拍板 D4 连续写（ADR-20） |
| 阶段确认时复制整表做"冻结副本" | 双写 + 体积膨胀；改为快照 revision（ADR-7） |
| 迁移时把旧作品"顺手"转成阶段数据 | 违反 SPEC §9.1"不自动迁移"；旧作品必须能在旧流程原样打开（ADR-8） |
| 回退用"整库还原备份"作为默认路径 | 要退 App、覆盖整库、丢迁移后的新内容；备份只兜灾难（MIG §8.1 vs §8.2） |

---

## 5. 文档一致性核对

### 5.1 上级决策 → 本文档落点

| 上级结论 | 落点 |
|---|---|
| D1 首次企划只产 P1+P2 | ARCH §3.2（step 表无 `chapter_plan`、无 `writing`）、§4.1（job 只跑 setting/outline 步） |
| D2 创建即落库 + 跳 `/pipeline` + 关页面不取消 | ARCH §2.1（路由）、§3.4（创建事务含 job）、§3.7（断开不 abort）、§3.9（重启恢复） |
| D3 顺序确认 + stale 不删内容 | ARCH §3.10（写白名单）、§3.13（confirm 二次校验 `409/422`）、§6（`stages.depends_on`） |
| D4 连续写 + 暂停/立即停止 + 全部写完再逐章审 | ARCH §3.2（job 循环）、§3.4（章级原子）、§3.8（单章失败隔离）、§11 R-1、本文 ADR-19/20 |
| D5 四键只在写作台 | ARCH §2.6（StudioPage 保留四键）、§3.13（唯一写入口）、§11 R-11、本文 ADR-17 |
| D6 `nextStep` 服务端下发 | ARCH §3.12（`deriveNextStep` + 15 行推导表）、§2.3（前端不重算）、本文 ADR-16 |
| D7 分配须显式预览、不静默改手改值 | ARCH §3.13（`allocate`/`apply` 两步 + `TARGET_EDITED`）、§2.5、本文 ADR-18 |
| SPEC §9.1 三原则 | MIG §1.2（逐条实现约束）、§2（只新增）、§8（回退） |
| SPEC §7.2 取消 ≤5s 释放上游 | ARCH §3.7（abort 传播 + 孤儿账本 + `stop_mode`） |
| UX §12.1/12.2/12.3、§3.3、§10.1/10.2 | ARCH §3.11（轮询）、§3.12（快照字段）、§3.13（动作表）、§2.8（kind profile）；字段名与锚点不改 |

### 5.2 本轮发现的下游文档问题（转给 captain / pm / t3）

1. **`CAPTAIN-DECISIONS.md` 的编号有重复与缺口**：文件里出现两个 `## D5`（一个是"SPEC §14.2 默认答案"，一个是"REVIEW 四键只在写作台"，后者才是被引用的 D5）；`D7` 正文引用了 `D9`（"接受 D9"），但该文件没有 D8/D9 条目。**不影响实现**（被引用的语义已在 ARCH 落点），但后续文档引用 `D5/D9` 时会指到错行。建议 captain 把后者改为 **D8**、把"按目标字数分配"记为 **D9** 并在文件里补齐。本文按"四键=D5、分配=D7/D9"引用，与 ARCH 一致。
2. **SPEC §4.5 与 D4 冲突**：SPEC 仍写"逐章停在 `in_review` 等 REVIEW"。已在 ARCH §11 R-1 登记为偏差，**需要 pm 在 SPEC 里加一行"以 CAPTAIN-DECISIONS D4 为准"**，否则 QA 按 SPEC 字面执行会判 D4 行为失败。
3. **SPEC §7.5 与 UX-SPEC §12.4 的通道口径不同**：前者提"事件流/SSE"，后者明确"V1 轮询、SSE 为 V1.1"。本文采纳 UX 口径（ADR-15），建议 pm 同步 SPEC 一句。
4. **SPEC §9.4 与 ADR-22 的"丢失"口径**：见 ARCH §11 R-4，需 pm/QA 知情（归档 ≠ 物理删除）。
5. **短篇"等价结构"的派单措辞**（scenes/beats）与 ADR-13 的落点不同：已按语义正确性选择 `stage_items(kind='beat_plan')` 并在 MIG §11 D-6 登记，**若 captain 坚持用 `scenes`，需回改 P3/P4 的短篇落点与三个 QA 断言**。

---

## 6. 复核方式（本文每条断言怎么验的）

```bash
# ADR 编号与文档引用是否一致（应无"引用了不存在的 ADR"）
grep -o "ADR-[0-9]\+" ARCHITECTURE.md MIGRATION.md | sort -u
grep -o "^### ADR-[0-9]\+" DECISIONS.md | sort -u

# ADR-14：零新增运行时依赖（本任务未改 software/，应为空 diff）
git -C /Users/maliang/Documents/develop/maliang/私家写手 diff --stat -- software/

# ADR-3 / ADR-5：旧表仍是 P1/P2/P3 的物理落点（读代码确认，不是凭印象）
grep -n "FROM characters\|FROM outline_acts\|FROM outline_beats\|FROM chapters" software/src/server/repository.ts

# ADR-16：前端不得自带"下一步"判定（实现完成后应只出现在 snapshot.ts）
grep -rn "nextStep" software/src/server/pipeline/ software/src/client/pages/pipeline/ 2>/dev/null | head -20

# ADR-17：四键锚点在流水线页为 0（实现完成后）
grep -rn "chapter-approve" software/src/client/pages/ | sort

# D1：首次企划的 job 里不得出现 p3/p4 的 step（实现完成后）
grep -n "chapter_plan\|writing" software/src/server/pipeline/steps/index.ts 2>/dev/null

# 迁移只新增（实现完成后）：db.ts 里只允许 CREATE TABLE / ADD COLUMN，不允许 UPDATE/DELETE 旧表
grep -n "ALTER TABLE\|CREATE TABLE" software/src/server/db.ts | head -40
grep -n "UPDATE characters\|UPDATE outline_\|DELETE FROM characters\|DELETE FROM outline_" software/src/server/db.ts
```

**本文档不写的三类东西**：① 具体代码（属实施方）；② 排期承诺（属 captain）；③ 竞品/远期功能设想（属 pm）。
