# REVIEW / spec-review

- 审查对象：`SPEC.md`（v1 草案，444 行）
- 审查方式：只读 + 代码抽查 + 与 `RESEARCH.md` / `POLICY.md` / `TASK.md` 口径比对
- 审查人：spec-review 独立审查员
- 结论：**CHANGES_REQUESTED**

> 本文件不修改任何业务代码，也不改 `PLAN.md` / `TASKS.json` / `DECISIONS.md`。

---

## 结论

SPEC 的问题清单质量整体高于平均：P0 五项（崩溃、停止丢字、404 死路、企划关闭、导航串台）在代码里都站得住，行号可查。但**本轮不可直接进入 implement**，原因有三：

1. `SPEC.md:391` 写「未拍板前实现方按推荐写」，与用户明确要求的「spec-review 后、implement 前必须用户确认，确认前不得改代码」以及 `POLICY.md:11` 的门禁直接冲突。
2. 决策 D2/D3 的两个核心承诺（删除前快照可救正文、下载 `studio.db` 副本即备份）在现 schema 下**技术不成立**，照做会给出「以为有备份、其实恢复不了」的假安全感。
3. 26 条验收把 RESEARCH 自己判定「下一轮 / 不建议本轮做」的编辑器级、归档级、交互重构项一并纳入必做，与用户优先级（新建与企划 → 写作与共笔 → 版本回退 → 导出备份 → 设置）不符，工作量与返工风险都不受控。

修完下面 8 条 must-fix、并由用户对 D1–D5 口头拍板后，本 SPEC 可以进入 implement。

---

## 证据核查（先给结论，避免把建议当需求）

**扎实、可复现（可直接作为验收依据）**

| SPEC 主张 | 代码证据 |
|---|---|
| A-1 老库崩溃 | `software/src/server/db.ts:166-170`（`count()` 为 0 才 seed）+ `software/src/server/seed.ts:9`（裸 `INSERT INTO providers`）+ `software/src/server/index.ts:49` 顶层 `migrate()` |
| A-2 停止丢字 | `software/src/server/ai.ts:66`（openai 适配器 `if (opts.signal.aborted) break;`）、`:291`（`if (streamOpts.signal.aborted) return;` → 什么都不写库） |
| A-4 只能删作品/拍点 | `software/src/server/index.ts:120`、`:183` 是全服务端仅有的两个 `app.delete` |
| A-5 导航串台 | `software/src/client/components/Rail.tsx:10-12`（`screenplayId = 第一本剧本 \|\| pid`、`writeId` 回退到第一本非剧本作品）、`:19` |
| B-8 文案与现实矛盾 | `software/src/client/pages/LibraryPage.tsx:115`「默认本地演示模型，不需要 Key」vs 首启强制 Key |

**不成立 / 需要撤回或改写**

| 位置 | 问题 |
|---|---|
| `SPEC.md:289`（R15） | 「client 与服务端字数算法可能不一致」——两份实现逐字相同（`software/src/client/pages/StudioPage.tsx:20-22` vs `software/src/server/utils.ts` 同一正则），**不存在缺陷**，这是重构建议被写成了业务规则 |
| `SPEC.md:221`（A19） | 「mock 点检查连接必须返回 400」与 `SPEC.md:47-54`（B-2「mock 是真能力、不是假绿」）自相矛盾；后端 `index.ts:303` 现在对 mock 返回 `ok:true`（`repository.testProviderConnection` 对 mock 直接返回成功），SPEC 若要求 400，等于把「演示模型可用」改成「演示模型检查必失败」 |
| `SPEC.md:401-407`（D2）/ `SPEC.md:277`（R3） | 「删除前自动快照可救正文」被 FK 抵消，见 must-fix M3 |
| `SPEC.md:391` | 把「用户拍板」降级为「实现方按推荐先写」，属擅自扩大自身权限 |

**把研究建议写成用户需求（建议降级）**：`SPEC.md:60-64`（C 层全部）、`SPEC.md:206`（A16 编辑器撤销栈）、`SPEC.md:233`（A21 八处假数据全量接线）、`SPEC.md:243`（A23 导航）——`RESEARCH.md §7` 已明确标注为「下一轮 / 不建议本轮」。

---

## 必须修改（按严重度，8 条）

### M1 [P0·流程门禁] 撤回「未拍板按推荐实现」，恢复用户确认门禁
- 位置：`SPEC.md:391`
- 现状原文：「未拍板前实现方按「推荐」写，但需在 `DECISIONS.md` 留痕。」
- 冲突：用户口径「计划门禁：spec-review 后、implement 前必须用户确认；确认前不得改代码」；`POLICY.md:11`；`TASK.md` 交付纪律。D1 直接决定首启是否强制 Key、D5 决定持久化范围——按推荐先写会产出**可能整段推翻**的代码与测试。
- 要求：改为「D1–D5 未拍板前，本轮只允许产出 `PLAN.md` / `DECISIONS.md` / 验收清单；不得改 `software/` 任何文件」。并在「用户拍板」一段写明拍板方式（口头接受推荐即可，逐项记录到 `DECISIONS.md`）。

### M2 [P0·数据安全] D3 备份方案在 WAL + 加密 Key 下会产出「假备份」
- 位置：`SPEC.md:409-415`（D3-A「下载 `data/studio.db` 的副本」）、`SPEC.md:322-341`（安全/边界）、待确认清单「备份是否包含加密后的 Key」
- 代码事实：
  - `software/src/server/db.ts:11-13` 开启 WAL → 直接拷贝 `studio.db` 会丢掉尚未 checkpoint 的 `-wal` 内容，恢复后少最近若干次保存；
  - API Key 用 AES 加密存库，密钥来自 `data/.secret`（`software/src/server/crypto.ts`），**`.secret` 不在 `studio.db` 里** → 只恢复 db 后所有供应商都为「已配置但解密失败」，且 `providers.api_key` 非空会被判定为已配置（`software/src/server/repository.ts:302`），用户看到的是「填了 Key 但 AI 永远报错」；
  - 恢复流程要求「替换 db 文件」，但服务进程正在持有该库（`node:sqlite` 长连接），热替换在 macOS 上会拿到旧句柄或直接写坏。
- 要求：把 D3-A 改成「导出 zip（一致性快照 + `.secret`）」，快照用 `VACUUM INTO` 或「停写 + checkpoint 后拷贝 `studio.db` + `-wal` + `-shm`」；恢复流程写成「停服务 → 自动备份现有库 → 替换 → 重启 → 校验供应商可用」；待确认清单里「是否包含加密后的 Key」必须与「是否包含 `.secret`」一起问，不能只问前者。

### M3 [P0·数据] D2-A「删除前自动快照」被 CASCADE 抵消，属「看似修了根因还在」
- 位置：`SPEC.md:401-407`（D2-A）、`SPEC.md:277`（R3 章节删除）
- 代码事实：`software/src/server/db.ts:95-104`，`chapter_versions.chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE`，且 `project_id REFERENCES projects(id) ON DELETE CASCADE`。删除章节/作品时，同一事务里的版本快照会被**一并级联删除**——「删除前写入快照」写得再早也留不下来。
- 要求：三选一并写进 SPEC，不能含糊：
  - (a) 改 FK 为 `ON DELETE SET NULL`（`chapter_versions` 已冗余存 `title`/`content`/`words`，技术上可行，但需要迁移脚本，与 H4「不做迁移框架」冲突→需单独加 `PRAGMA user_version` 最小迁移）；
  - (b) 明确「删除即不可恢复」，删除前**强制/建议导出**，不做快照承诺（推荐，成本最低且诚实）；
  - (c) 做软删（`deleted_at`），但这会牵动所有读路径，超出「避免大重构」。
- 无论选哪个，D2 的文案不能出现「删除可救回正文」，否则是本轮最容易翻车的体验承诺。

### M4 [P0·范围] 26 条验收过载，必须按用户优先级切三档并砍单
- 位置：`SPEC.md:114-265`（A1–A26）、`SPEC.md:60-64`（C 层）、`SPEC.md:66-74`（D 层）
- 问题：用户优先级是「新建作品与 AI 企划 → 写作编辑与 AI 共笔 → 版本/历史/回退 → 导出/备份/导入 → 设置/供应商/更新」。现状 A1–A26 平铺同级，其中 **A13（大纲脏守卫）、A14（幕 CRUD）、A16（编辑器撤销栈）、A17（⌘S/⌘G-L 快捷键）、A21（八处假数据全量接线）、A23（导航串台全修）、D4（归档全套）** 都不在前三级，且 A16/A14 属编辑器与结构重构，与「避免大重构」冲突。
- 要求：验收表加「档位」列（P0/P1/P2），并**本轮只承诺 P0+P1，总数 ≤16**：
  - P0（本轮必做）：A1–A12、A15、A20、A22
  - P1（本轮必做，只做最小修复）：A18（开关生效）、A19（去掉假绿，按 M6 改法）、A24/A25/A26（导出、重启、桌面冒烟）
  - P2（移出本轮）：A13 脏守卫、A14 幕 CRUD、A16 撤销栈、A17 快捷键、A21 全量接线、A23 全修
- 附：`SPEC.md:118` 已写「不看构建通过」，但 A21/A13 的「验证方式」是人工走查，P2 项留人工走查会拖垮本轮验收节奏。

### M5 [P1·AI 流程] 停止/断流/重复回答三件事没有统一口径，且现状是「两套行为」
- 位置：`SPEC.md:70-74`（D-5）、`SPEC.md:164`（A8 重生成）
- 代码事实：
  - mock 适配器在 abort 时**会把半截文本写库**，真实供应商在 `software/src/server/ai.ts:66` / `:291` 直接 `break`/`return` → **什么都不存**。同一操作（点停止）在演示模型和真实 Key 下结果相反；
  - 重生成时用户消息被跳过（`software/src/server/ai.ts:244-253`），旧 assistant 回答**不删除**（`software/src/server/repository.ts:407-410` 只读 `listMessages`），连点两次「重生成」会留下两条重复回答，且都进入下次上下文（`software/src/server/repository.ts:424-440` 取最近 3 章消息）。
- 要求：在 SPEC 写死三条规则并各自给验收——(1) 停止后是否保留已生成内容（建议：保留并标注「已中断」）；(2) 重生成前删除或标记该轮旧回答（建议物理删除同 turn 的 assistant 消息）；(3) 断网导致的中断与 (1) 处置一致。

### M6 [P1·AI] A19「mock 必须 400」与 B-2 自相矛盾，且会造新断点
- 位置：`SPEC.md:221`（A19）vs `SPEC.md:47-54`（B-2）
- 冲突后果：B-2 的立论是「mock 是真实可用的本地模型，前端却把它打扮成假绿」；解法应是**把 mock 作为一等供应商呈现**（`repository.testProviderConnection` 已返回「本地演示模型无需连接」），而不是把后端改成 400。若按 A19 改为 400，则 D1-A（用演示模型免 Key 进入）的用户点「检查连接」永远失败，首启体验从「假绿」变成「必红」。
- 要求：A19 改为「未填 Key 的真实供应商 → 明确失败文案；mock → 显示『本地演示模型，无需联网』且不显示成功/失败二态」；后端接口语义保持 `ok:true` 或改为 `{ok:null, message}`，不得返回 400。

### M7 [P1·一致性] R14「超 4 幕直接 400」与 plan.ts / apply 的静默截断并存，口径混乱
- 位置：`SPEC.md:288`（R14）、`SPEC.md:300-309`（边界族）
- 代码事实：`software/src/server/plan.ts:21`（`raw.acts.slice(0, 4)`）、`:24`（每幕 `beats.slice(0, 8)`）、`:32`（`characters.slice(0, 8)`）已在解析层静默裁剪；`repository.applyProjectPlan` 应用时又裁一次。也就是说 AI 返回 6 幕时，用户看到的就是 4 幕，**不知道被裁**；而 SPEC 又要求「超过上限直接 400 拒绝」。
- 要求：二选一并统一三层（plan 解析 / 企划面板 / apply）：(a) 解析层裁剪 + 在企划面板显式提示「已按上限保留 4 幕」；(b) 不裁剪、超限 400 并让用户重新生成（不推荐，AI 输出不可控会打断流程）。推荐 (a)，同时删掉 apply 的重复裁剪。

### M8 [P1·验收可执行性] 失败路径测试缺口与不可执行的验收项
- 位置：`SPEC.md:233`（A21「人工走查确认无假数据」）、`SPEC.md:189`（A13）、`SPEC.md:345-370`（测试计划）
- 问题：测试计划只写了「api-test 扩展 / ui-test 扩展 / desktop-test 真实启动」三类，用户点名的六类失败路径**没有一条落到具体断言**：重启、断流、关窗、重复文本、并发保存、恢复备份。A21 与 A13 的验证方式是无法客观判定的「人工确认」。
- 要求：按文末「验收补强清单」补齐 T1–T12，并且 A21 改成可 grep 的删除断言（如「全仓 `grep -r "72%" src/client` 为空」这种程度），不要用「人工走查」。

---

## 建议修改（8 条）

- **S1｜R11 恢复流程需要停服与兼容处理**（`SPEC.md:283`）：恢复后旧库可能缺新列（H4 只承诺 `.secret` 兼容，没承诺 schema 演进），建议至少加 `PRAGMA user_version` 最小迁移（约 30 行），或在验收里明确「本版本只支持恢复到同版本库」。
- **S2｜R15 降为 P2 或删除**（`SPEC.md:289`）：两份字数算法已逐字一致，迁移到 `shared/` 是零收益重构。保留一条「两处正则必须一致」的注释 + 一个单测即可。
- **S3｜R6 删除供应商建议移出本轮**（`SPEC.md:281`）：需要同时处理 `models`、`settings.defaultProvider/fallbackProvider`、作品绑定的 `provider_id` 三处引用，成本高于其优先级（供应商删除不在用户前三级），且删错会直接让既有作品无法续写。
- **S4｜R16 的「last-write-wins」不可验证**（`SPEC.md:290`）：建议改成客户端 `saveSeq` 单调递增 + 服务端仅在 `seq >= last_seq` 时写库，并把「两次 PATCH 后以最后一次为准」写成可断言结果；否则并发场景根本无法自动化（见 T5）。
- **S5｜A23 只测了串台，漏了更常见的「不存在 id 永久 loading」**（`SPEC.md:243`）：`software/src/client/pages/OutlinePage.tsx:24-30`、`software/src/client/pages/CodexPage.tsx:27-33` 的 `api.project(...)` 没有 catch，项目不存在或已删时页面永远空转。建议 A23 扩为「点剧本串台 + URL 带不存在 id → 明确空态 + 可返回」，两处都要断言。
- **S6｜A18 若只验「开关写进了数据库」会假通过**（`SPEC.md:216`）：`software/src/server/ai.ts:80` / `:189` 只读 temperature（anthropic 适配器甚至不传 temperature），`repository.buildWritingContext` 完全没读 `pov/genre/style/aiLength`。验收必须断言「请求体里出现视角/文风片段」或 mock 回显，而不是查 settings 表。
- **S7｜企划失败的可见性不一致 + 超时不匹配**（`SPEC.md:135` A3）：企划 90s 服务端超时（`software/src/server/index.ts:88`），而前端 `software/src/client/api.ts` 的 `request()` **无任何超时/取消**；新建流程失败只在 toast 里一闪，`PlanReviewModal` 却给了页内常驻 error + 重试。建议统一为页内错误 + 重试，并在等待期显示「最长 90 秒」。
- **S8｜文案治理方向应统一为「演示模式是一等公民」**（`SPEC.md:135`/`:233`）：`LibraryPage.tsx:115` 承诺「不需要 Key」，首启却强制 Key。D1-A 落地后这条矛盾自动消失；若 D1 选 B，则必须同时改 `LibraryPage.tsx:115` 与 onboarding 文案。建议把这条写进 D1 的「影响」列，避免两处文案各改各的。

---

## 可以不做 / 二期（明确清单）

1. **C-1 幕增删改拖拽**（`SPEC.md:60`）——结构编辑，改动面覆盖大纲页 + 服务端 acts 路由（当前服务端没有 acts 的写路由），二期。
2. **C-5 跨幕拖动**（`SPEC.md:64`）——本就标了「下一步再做」，本轮维持 toast 提示即可。
3. **D4 归档全套**（`SPEC.md:417-423`）——牵动 `status` 语义、全部写接口的 409 校验、库页筛选三处；与本轮「避免大重构」冲突。本轮最多做「已归档作品只读展示 + 库页筛选」，不做写保护。
4. **A16 编辑器撤销栈 / A17 ⌘S、⌘G-L**（`SPEC.md:206`、`:211`）——本轮只做「设置页快捷键表改为『暂未支持』或实现 ⌘S 一项」，不做自建 undo 栈。
5. **A21 八处假数据的全量接线**（`SPEC.md:233`）——本轮只做「删除误导性假数据」（人数、72%、写死视角、假记忆状态），**不做**真实统计接线（那是新功能）。
6. **R15 字数算法迁移到 shared/**（`SPEC.md:289`）——零收益重构。
7. **单作品导入、一句话反馈/风格样本采样**（C 层）——不在用户前五优先级内。
8. **.env 加载、局域网访问**（`SPEC.md:322-341` 已列「先询问」/「不做」）——维持不做。
9. **R6 删除供应商**（详见 S3）。
10. **富文本编辑器**——本轮不承诺，SPEC 应显式写「只支持纯文本」。

---

## 验收补强清单（可直接落成脚本）

> 落点：`software/scripts/api-test.mjs`、`software/scripts/ui-test.mjs`、`software/scripts/desktop-test.mjs`；T1/T6 建议新增 `software/scripts/crash-restore-test.mjs`（独立 `PW_DATA_DIR`，不污染 `data/`）。

| 编号 | 失败路径 | 建议断言 | 落点 |
|---|---|---|---|
| T1 | 崩溃/`kill -9` 后重启 | 强杀服务进程 → 重启 → 正文、章节数、版本数完整，且不重复 seed | 新 crash 脚本 |
| T2 | 断流（真实供应商中途断开） | 本地起一个「发 3 个 chunk 后断连」的假 SSE 服务 → 断言半截内容按 M5 规则处置，且不再追加 | api-test + Playwright route abort |
| T3 | 关窗（生成中） | `desktop-test` 增加「生成中 300ms 关窗」→ 重开 → 已保存正文与 M5 口径一致 | desktop-test |
| T4 | 重复文本（连点重生成） | 连点 3 次重生成 → assistant 消息数 == 1，且上下文只含一条 | api-test |
| T5 | 并发保存 | 同一章两次 PATCH 交错（带 `saveSeq`）→ 最终内容 = 最后一次，版本不重复写入 | api-test |
| T6 | 恢复备份 | 导出 zip → 删 `data/` → 恢复 → 停服重启 → 作品可打开 **且供应商 Key 可用**（验证 `.secret` 一并恢复） | 新 restore 脚本 |
| T7 | 双击新建章节 | 连点 5 次「新建章节」→ 只新增 1 章（当前 `StudioPage.tsx:183` 无 busy 守卫，每点一次发一次请求） | ui-test |
| T8 | 不存在 id | 直接访问 `/project/does-not-exist`、`/project/x/outline` → 空态 + 可返回，不永久 loading | ui-test |
| T9 | 首启无 Key（按 D1） | 全新数据目录 → 选演示模型 → 进书房 → 新建作品成功 | api-test + ui-test |
| T10 | 企划失败 | mock 服务返回 500 → 页内错误 + 重试可用（不是 toast 一闪） | ui-test |
| T11 | 超大文本 | 粘贴 > 3MB 正文（`software/src/server/index.ts:51` `express.json({ limit: '3mb' })`）→ 返回 413 且前端给出人话提示 | api-test |
| T12 | 空作品导出 | 无章节/无场景的作品导出 → 409 + 中文提示，不是 500 | api-test |

补充：`SPEC.md:345-370` 的测试计划里应写明**每个脚本跑在临时 `PW_DATA_DIR`**，否则 `api-test` 会污染开发者本地库（当前脚本已有此意识，需在 SPEC 固化）。

---

## 对 5 个默认决策的意见

| 决策 | 意见 | 理由 |
|---|---|---|
| **D1 首启准入** | **需用户拍板**；技术上强烈建议 A（演示模型免 Key） | 服务端已经支持 mock 免 Key（`software/src/server/repository.ts` 的 `completeOnboarding` 对 mock/ollama 跳过 Key 校验），改动只有 `OnboardingPage.tsx` 的供应商过滤 + 两处文案；而 B 会让 `LibraryPage.tsx:115` 的既有承诺变成谎话。这不是成本问题，是产品定位问题，必须用户点头。 |
| **D2 删除策略** | **反对 A 的「删除前快照」承诺**，建议「确认 + 导出后可删」，不承诺可恢复 | 见 M3：快照被 FK CASCADE 一起删掉，承诺了也做不到。若用户坚持要「可恢复」，则必须走软删，成本翻倍，应单独立项。 |
| **D3 备份/恢复** | **反对 A 的裸拷贝 `studio.db`**；建议 A′：zip(一致性快照 + `.secret`)，恢复前自动备份现有库，恢复后重启 | 见 M2。这是本轮唯一可能造成「用户数据永久丢失」的决策，不能按「下载一个文件」的轻量口径定。 |
| **D4 归档** | **建议本轮不做**（最多只读展示 + 筛选） | 写接口 409 校验要铺到 12+ 路由，且与 `SPEC.md:24-28`「不改写已有实体表」自相矛盾；优先级不在用户前三级。 |
| **D5 位置记忆** | **反对 A（摸过几页就记住进度）**；建议改为「记住上次打开的作品 + 上次选中章节」 | 「翻过整本书」不可观测也不可测；若做，只能在切章时回写 `settings`，与「settings 单写入入口」冲突且高频写库。缩到「上次作品 + 上次章节」两条 localStorage 值即可，能测、不会误判。 |

---

## 计划门禁（必须写进流程）

1. 本 REVIEW 结论为 **CHANGES_REQUESTED** → 架构师按 M1–M8 修订 `SPEC.md`，不进入 implement。
2. 修订后由用户**口头确认 D1–D5**（不必逐条开会，接受推荐即可），逐项记入 `DECISIONS.md`。
3. `PLAN.md` 与 `AUTHORITY.md` 目前仍是空模板/仅示例行（`AUTHORITY.md` 只有示例表格行，未登记 `SPEC.md`），与自身「单一事实来源」规则不符，需在 implement 前补齐。
4. 上述 1–3 完成前，不得修改 `software/` 下任何文件、不得提交 commit。


---

# 实施复审（2026-10-27，方案 A）

## 结论

**PASS（范围 A）**。P0 三条与 P1 日常体验均已实现并有自动化覆盖；用户已拍板的三个口径（A、强制 onboarding、项目 JSON bundle）全部遵守。

## 已关闭的评审问题

- 删光作品重启崩溃：已用 `app_meta` + 幂等 seed 修复；API 覆盖删光后重启。
- 停止生成丢文本：partial 增量落库为 `status='aborted'`，前端停止后保留可插入内容；正常完成用 `!res.writableEnded` 区分，不再误判 aborted。
- 加载失败永久转圈：四页均有错误态与重试/返回。
- 关窗丢稿：渲染层 `saveNow` → preload/IPC `inkquay:close-ready` → 主进程 `destroy()`；5 秒无响应兜底；Desktop E2E 用原生 `BrowserWindow.close()` 验证。
- 选区误替换：`ChapterEditor` 回传 DOM Range，替换按 Range 执行；无 Range 才回退首次出现。
- 企划取消/孤儿：AbortController + 已创建项目保留 + 失败重试。
- 导出裸 `<a>` / 空文件：fetch+Blob，Markdown/Word 均对空正文返回 400 中文提示。
- 假数据/假开关：本地库演示人物、引文、未实现设置与快捷键已清理。

## 遗留风险（不阻塞交付）

- 真实 OpenAI/Anthropic/Gemini Key 未做端到端验证。
- Windows/Linux 真机安装、自动更新未验证；macOS 仍未签名/公证。
- 章节删除不可恢复；bundle 不含 Key；章节版本上限 40，无跨章总览。
- `importProjectBundle` 对缺 `act.id` 的旧 bundle 会丢节拍归属；当前只导出自家 bundle，风险低。
- 打包版只做了启动/关闭烟测，未做完整数据流烟测（数据流由 Desktop E2E 覆盖）。
