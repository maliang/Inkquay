import type { Express, NextFunction, Request, Response } from 'express';
import type { StageKey } from '../../shared/pipeline.ts';
import {
  acceptDeviation,
  allocate,
  applyAllocation,
  confirmStage,
  continueWriting,
  createItem,
  deleteItem,
  reorderItems,
  reorderUnits,
  jobHistory,
  lockItem,
  patchItem,
  patchUnit,
  pauseWriting,
  planSummary,
  resolveStale,
  restoreItemRevision,
  restoreUnitVersion,
  retryJob,
  reviewUnit,
  setUnitCount,
  skipStage,
  stageRevisions,
  startStageJob,
  startWriting,
  stopWriting,
  unitVersions,
} from './actions.ts';
import { buildJobView, buildSnapshot, precheck } from './snapshot.ts';
import { listItems, listJobs, listUnits, oneRow, requireJob, requireProject } from './store.ts';
import type { JobRow } from './store.ts';
import { STAGE_KEYS, PipelineErrorException, fail } from './types.ts';
import { migrateProject, migrationView, precheckMigration, rollbackMigration } from './legacy.ts';
import { requestCancel } from './runner.ts';

/**
 * 流水线 HTTP 面（ARCHITECTURE §3.13：24 条动作接口）。
 * 约定：写接口可选 Idempotency-Key；失败一律 `{code,message?,blockers?}`；成功后前端只重拉一次快照。
 */

function stageParam(raw: string): StageKey {
  const key = raw as StageKey;
  if (!STAGE_KEYS.includes(key)) fail('BAD_REQUEST', `未知阶段：${raw}`);
  return key;
}

function projectIdOf(req: Request): string {
  const id = String(req.params.id || '');
  requireProject(id);
  return id;
}

function idempotencyKey(req: Request): string | undefined {
  const header = req.get('Idempotency-Key') || req.get('idempotency-key');
  return header && header.trim() ? header.trim() : undefined;
}

function handle(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

function jobPayload(job: JobRow | null) {
  return job ? { job: buildJobView(job) } : { job: null };
}

export function registerPipelineRoutes(app: Express) {
  // ---- 前置校验 ----
  app.get(
    '/api/pipeline/precheck',
    handle((_req, res) => {
      res.json(precheck());
    }),
  );

  // ---- 快照 / 条目 / 任务 ----
  app.get(
    '/api/projects/:id/pipeline',
    handle((req, res) => {
      res.json(buildSnapshot(projectIdOf(req)));
    }),
  );

  app.get(
    '/api/projects/:id/stages/:stage/items',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json({ items: listItems(projectId, stageParam(String(req.params.stage))) });
    }),
  );

  app.get(
    '/api/projects/:id/units',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const units = listUnits(projectId).map((unit) => ({
        id: unit.id,
        kind: unit.kind,
        ordinal: unit.ordinal,
        title: unit.title,
        function: unit.planFunction,
        synopsis: unit.planSynopsis,
        characters: unit.planCharacters,
        minWords: unit.minWords,
        targetWords: unit.targetWords,
        maxWords: unit.maxWords,
        targetManual: unit.targetManual,
        locked: unit.locked,
        words: unit.words,
        reviewStatus: unit.reviewStatus,
        hasContent: Boolean(unit.content.trim()),
      }));
      res.json({ units, summary: planSummary(projectId) });
    }),
  );

  app.post(
    '/api/projects/:id/pipeline/start',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const stage = stageParam(String(req.body?.stage || 'p1'));
      const job = startStageJob(projectId, stage, { scope: 'all', kind: 'plan' });
      res.status(202).json(jobPayload(job));
    }),
  );

  app.get(
    '/api/projects/:id/jobs',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json({ jobs: listJobs(projectId, 20).map((job) => buildJobView(job)) });
    }),
  );

  app.post(
    '/api/projects/:id/jobs/:jobId/retry',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const job = retryJob(projectId, String(req.params.jobId));
      res.status(202).json(jobPayload(job));
    }),
  );

  app.post(
    '/api/jobs/:jobId/cancel',
    handle((req, res) => {
      const job = requireJob(String(req.params.jobId));
      const mode = req.body?.mode === 'pause' ? 'pause' : 'stop';
      const terminal = ['done', 'failed', 'cancelled', 'interrupted'].includes(job.status);
      const next = requestCancel(job.id, mode);
      res.status(terminal ? 200 : 202).json(jobPayload(next));
    }),
  );

  // ---- 阶段：确认 / 跳过 / 生成 / 反馈 / stale ----
  app.post(
    '/api/projects/:id/stages/:stage/confirm',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(confirmStage(projectId, stageParam(String(req.params.stage))));
    }),
  );

  app.post(
    '/api/projects/:id/stages/:stage/skip',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(skipStage(projectId, stageParam(String(req.params.stage)), req.body?.reason ? String(req.body.reason) : undefined));
    }),
  );

  app.post(
    '/api/projects/:id/stages/:stage/regenerate',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const stage = stageParam(String(req.params.stage));
      const scope = req.body?.scope === 'item' ? 'item' : req.body?.scope === 'block' ? 'block' : 'all';
      const job = startStageJob(projectId, stage, {
        scope,
        targetId: req.body?.targetId ? String(req.body.targetId) : undefined,
        note: req.body?.note ? String(req.body.note) : '',
        // F12：整阶段重做才叫 regen-stage；单条/整块重做是 regen-item，收尾时不要撤销本阶段的确认。
        kind: scope === 'all' ? 'regen-stage' : 'regen-item',
        confirmOverwrite: req.body?.confirmOverwrite === true,
      });
      res.status(202).json({ job: buildJobView(job) });
    }),
  );

  app.post(
    '/api/projects/:id/stages/:stage/feedback',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const stage = stageParam(String(req.params.stage));
      const note = String(req.body?.note || '').trim();
      if (note.length < 4) fail('NOTE_TOO_SHORT', '请把修改意见写清楚一点（至少 4 个字）');
      const scope = req.body?.scope === 'item' ? 'item' : req.body?.scope === 'block' ? 'block' : 'all';
      const job = startStageJob(projectId, stage, {
        scope,
        targetId: req.body?.targetId ? String(req.body.targetId) : undefined,
        note,
        // F12：整阶段重做才叫 regen-stage；单条/整块重做是 regen-item，收尾时不要撤销本阶段的确认。
        kind: scope === 'all' ? 'regen-stage' : 'regen-item',
        confirmOverwrite: req.body?.confirmOverwrite === true,
      });
      res.status(202).json({ job: buildJobView(job) });
    }),
  );

  app.post(
    '/api/projects/:id/stages/:stage/stale/resolve',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const action = req.body?.action === 'regenerate' ? 'regenerate' : req.body?.action === 'ignore' ? 'ignore' : 'keep';
      // N1：横幅上的「重新生成」必须和直连 regenerate 一样能带确认，否则手改过任何一条就永久 422。
      res.json(resolveStale(projectId, stageParam(String(req.params.stage)), action, { confirmOverwrite: req.body?.confirmOverwrite === true }));
    }),
  );

  app.get(
    '/api/projects/:id/stages/:stage/revisions',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const targetId = typeof req.query.targetId === 'string' ? req.query.targetId : undefined;
      res.json({ revisions: stageRevisions(projectId, stageParam(String(req.params.stage)), targetId) });
    }),
  );

  // ---- 条目：编辑 / 锁定 / 恢复历史 ----
  app.patch(
    '/api/projects/:id/items/:itemId',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const patch = { title: req.body?.title === undefined ? undefined : String(req.body.title), payload: req.body?.payload };
      const hint = req.body?.stage === 'p3' || req.body?.stage === 'p4' ? (String(req.body.stage) as 'p3' | 'p4') : undefined;
      res.json(patchItem(projectId, String(req.params.itemId), patch, hint));
    }),
  );

  app.post(
    '/api/projects/:id/items/:itemId/lock',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json({ item: lockItem(projectId, String(req.params.itemId), Boolean(req.body?.locked)) });
    }),
  );

  app.post(
    '/api/projects/:id/items/:itemId/revisions/:revisionId/restore',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const item = restoreItemRevision(projectId, String(req.params.revisionId));
      res.json({ item, stage: buildSnapshot(projectId).stages[item.stageKey] });
    }),
  );

  // ---- 条目：新增 / 删除 / 排序（SPEC M3，DEF-15）----
  app.post(
    '/api/projects/:id/stages/:stage/items',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const body = req.body || {};
      const result = createItem(projectId, stageParam(String(req.params.stage)), {
        kind: body.kind === undefined ? undefined : String(body.kind),
        title: body.title === undefined ? undefined : String(body.title),
        payload: body.payload && typeof body.payload === 'object' ? body.payload : undefined,
        parentId: body.parentId === undefined ? undefined : String(body.parentId),
      });
      res.status(201).json(result);
    }),
  );

  app.post(
    '/api/projects/:id/stages/:stage/items/reorder',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      res.json(reorderItems(projectId, stageParam(String(req.params.stage)), { block: req.body?.block, ids }));
    }),
  );

  app.delete(
    '/api/projects/:id/items/:itemId',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(deleteItem(projectId, String(req.params.itemId)));
    }),
  );

  // ---- 章节计划（p3）----
  app.post(
    '/api/projects/:id/stages/p3/units/allocate',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(allocate(projectId, Number(req.body?.totalTarget) || 0, req.body?.rows));
    }),
  );

  app.post(
    '/api/projects/:id/stages/p3/units/allocate/apply',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      res.json({ summary: applyAllocation(projectId, rows, Boolean(req.body?.includeEdited)) });
    }),
  );

  app.post(
    '/api/projects/:id/stages/p3/units/count',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const summary = setUnitCount(projectId, Number(req.body?.count) || 0, Boolean(req.body?.archiveOrphans));
      res.json({ summary });
    }),
  );

  app.post(
    '/api/projects/:id/stages/p3/units/reorder',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      res.json(reorderUnits(projectId, ids));
    }),
  );

  app.patch(
    '/api/projects/:id/stages/p3/units/:unitId',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const body = req.body || {};
      res.json(
        patchUnit(projectId, String(req.params.unitId), {
          title: body.title === undefined ? undefined : String(body.title),
          function: body.function === undefined ? undefined : String(body.function),
          synopsis: body.synopsis === undefined ? undefined : String(body.synopsis),
          characters: Array.isArray(body.characters) ? body.characters.map(String) : undefined,
          minWords: body.minWords === undefined ? undefined : Number(body.minWords),
          targetWords: body.targetWords === undefined ? undefined : Number(body.targetWords),
          maxWords: body.maxWords === undefined ? undefined : Number(body.maxWords),
          acceptDeviation: Boolean(body.acceptDeviation),
        }),
      );
    }),
  );

  app.post(
    '/api/projects/:id/pipeline/accept-deviation',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      acceptDeviation(projectId, Boolean(req.body?.accepted));
      res.json({ summary: planSummary(projectId) });
    }),
  );

  // ---- 逐章写作（p4）----
  app.post(
    '/api/projects/:id/writing/start',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const mode = req.body?.mode === 'single' ? 'single' : 'continuous';
      const job = startWriting(projectId, mode, req.body?.unitId ? String(req.body.unitId) : undefined);
      res.status(202).json({ job: buildJobView(job) });
    }),
  );

  app.post(
    '/api/projects/:id/writing/pause',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.status(202).json({ job: buildJobView(pauseWriting(projectId)) });
    }),
  );

  app.post(
    '/api/projects/:id/writing/continue',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.status(202).json({ job: buildJobView(continueWriting(projectId)) });
    }),
  );

  app.post(
    '/api/projects/:id/writing/stop',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.status(202).json({ job: buildJobView(stopWriting(projectId, Boolean(req.body?.confirm))) });
    }),
  );

  app.post(
    '/api/chapters/:id/review',
    handle((req, res) => {
      const unitId = String(req.params.id);
      // D5 唯一审阅写入口，按作品 kind 分流：长篇查 chapters，短篇查 stage_items(kind='beat_plan')。
      const chapter = oneRow('SELECT * FROM chapters WHERE id = ?', unitId);
      const beat = chapter
        ? undefined
        : oneRow("SELECT * FROM stage_items WHERE id = ? AND kind = 'beat_plan' AND archived_at IS NULL", unitId);
      const projectId = chapter ? String(chapter.project_id) : beat ? String(beat.project_id) : '';
      if (!projectId) fail('NOT_FOUND', '找不到这一章');
      const action = String(req.body?.action || '');
      const allowed = ['approve', 'request_changes', 'manual_approve', 'skip', 'rewrite', 'expand', 'shrink'];
      if (!allowed.includes(action)) fail('BAD_REQUEST', '未知的审阅动作');
      const result = reviewUnit(projectId, unitId, {
        action: action as any,
        note: req.body?.note ? String(req.body.note) : '',
        mode: req.body?.mode === 'single' ? 'single' : 'continuous',
      });
      res.status(result.status).json(result);
    }),
  );

  // ---- 单位版本 ----
  app.get(
    '/api/projects/:id/units/:unitId/versions',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(unitVersions(projectId, String(req.params.unitId)));
    }),
  );

  app.post(
    '/api/projects/:id/units/:unitId/versions/:versionId/restore',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(restoreUnitVersion(projectId, String(req.params.unitId), String(req.params.versionId)));
    }),
  );

  // ---- 旧作品迁移 ----
  app.get(
    '/api/projects/:id/migration',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json({ migration: migrationView(projectId) });
    }),
  );

  app.post(
    '/api/projects/:id/migrate/precheck',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      res.json(precheckMigration(projectId));
    }),
  );

  app.post(
    '/api/projects/:id/migrate',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      // F18：forceFail 是测试后门，只在「显式打开 env 开关」或「dev 构建」下接受，生产环境一律忽略。
      const devBuild = process.env.NODE_ENV !== 'production';
      const forceFail = Boolean(req.body?.forceFail) && (devBuild || process.env.PW_MIGRATION_FORCE_FAIL === '1');
      const result = migrateProject(projectId, { forceFail });
      res.json({ migration: result, ok: true, viewUrl: `/project/${projectId}/pipeline` });
    }),
  );

  app.post(
    '/api/projects/:id/migrate/rollback',
    handle((req, res) => {
      const projectId = projectIdOf(req);
      const mode = req.body?.mode === 'file' ? 'file' : 'sql';
      res.json({ migration: rollbackMigration(projectId, mode, Boolean(req.body?.confirm)) });
    }),
  );


  // 流水线错误 → 结构化响应（结构与 PipelineError 一致）
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof PipelineErrorException) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
        ...(error.blockers ? { blockers: error.blockers } : {}),
        ...(error.detail ? { detail: error.detail } : {}),
        retryable: error.retryable,
      });
    }
    // F1：任何非 PipelineError 异常（例如约束冲突、解析失败）也必须回统一形状，
    // 否则调用方拿到的是 Express 默认的 HTML / 裸 {error}，前端整块解析不了。
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pipeline] unhandled error: ${message}`);
    return res.status(500).json({ code: 'INTERNAL', message: '服务端处理失败，请重试或查看日志', retryable: true, detail: { reason: message.slice(0, 300) } });
  });
}
