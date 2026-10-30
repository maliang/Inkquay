import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MigrationView, PipelineItem, PrecheckResult, Revision, StageKey } from '../../shared/pipeline.ts';
import { api } from '../api.ts';
import { AppShell } from '../components/AppShell.tsx';
import { useToast } from '../components/Toast.tsx';
import { ErrorCard } from '../components/pipeline/ErrorCard.tsx';
import { FeedbackComposer } from '../components/pipeline/FeedbackComposer.tsx';
import { JobBar, STAGE_JOB_LABEL } from '../components/pipeline/JobBar.tsx';
import { NextStepCard } from '../components/pipeline/NextStepCard.tsx';
import { P1SettingView } from '../components/pipeline/P1SettingView.tsx';
import { P2OutlineView } from '../components/pipeline/P2OutlineView.tsx';
import { P3PlanView, type PresetKey } from '../components/pipeline/P3PlanView.tsx';
import { P4WritingView } from '../components/pipeline/P4WritingView.tsx';
import { PipelineBanner } from '../components/pipeline/PipelineBanner.tsx';
import { RevisionDrawer } from '../components/pipeline/RevisionDrawer.tsx';
import { StageConfirmBar } from '../components/pipeline/StageConfirmBar.tsx';
import { StageRail } from '../components/pipeline/StageRail.tsx';
import { useApp } from '../context/AppContext.tsx';
import { usePipeline } from '../hooks/usePipeline.ts';
import { pipelineApi } from '../lib/pipeline/api.ts';
import { errorCopy, formatWords, stageMeta, stageMetas, unitLabel, type ProjectKind } from '../lib/pipeline/format.ts';
import { errorBlockersOf, requiresConfirmOf } from '../lib/pipeline/http.ts';
import { isPipelineError } from '../lib/pipeline/http.ts';

const STAGE_KEYS: StageKey[] = ['p1', 'p2', 'p3', 'p4'];
const WORD_PRESETS: Record<PresetKey, { min: number; target: number; max: number }> = {
  fast: { min: 1500, target: 2000, max: 2500 },
  standard: { min: 2500, target: 3000, max: 4000 },
  thick: { min: 4000, target: 5000, max: 6000 },
};

type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** N1：覆盖手改内容的二次确认单独打点，UI 测试与用户都能一眼认出来。 */
  kind?: 'overwrite';
  onConfirm: () => void;
};
type FeedbackTarget = { stageKey: StageKey; scope: 'stage' | 'block' | 'item'; targetId?: string; title: string; scopeLabel: string };
type HistoryTarget = { stageKey: StageKey; targetId?: string; title: string };

function isStageKey(value: string | null): value is StageKey {
  return value !== null && (STAGE_KEYS as string[]).includes(value);
}

/**
 * 流水线页（UX-SPEC §3）：一条路由 + ?stage 切换，阶段判定完全来自服务端 nextStep。
 * 页面只负责编排：所有写操作 → 调接口 → 重新拉快照，不做本地乐观判定。
 */
export function PipelinePage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [search, setSearch] = useSearchParams();

  const pipe = usePipeline(projectId);
  const { projects } = useApp();
  const { snapshot, units, summary, loading, offline } = pipe;
  // 剧本/剧集不走流水线（U20）：bootstrap 里已经有作品列表，不用额外请求就能判类型。
  const projectSummary = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]);
  const unsupportedType = projectSummary && projectSummary.type !== 'novel' && projectSummary.type !== 'short' ? projectSummary.type : null;
  useEffect(() => {
    if (unsupportedType === 'screenplay') navigate(`/project/${projectId}/screenplay`, { replace: true });
  }, [navigate, projectId, unsupportedType]);
  // 长短篇只能从快照得知；轮询刷新会短暂没有快照，此时必须沿用上一次的判定，
  // 否则短篇页面会在一瞬间按长篇渲染（章节行替代节拍行，锚点与文案全错）。
  const [kind, setKindState] = useState<ProjectKind>('novel');
  useEffect(() => {
    if (snapshot?.kind && snapshot.kind !== kind) setKindState(snapshot.kind);
  }, [snapshot?.kind, kind]);

  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [migration, setMigration] = useState<MigrationView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ code: string; message?: string; blockers?: string[] } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [feedback, setFeedback] = useState<FeedbackTarget | null>(null);
  const [history, setHistory] = useState<HistoryTarget | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [presetText, setPresetText] = useState<string | null>(null);
  const startedRef = useRef(false);

  const stageParam = search.get('stage');
  const nextStage = (snapshot?.nextStep?.stage as StageKey | undefined) ?? 'p1';
  const stage: StageKey = isStageKey(stageParam) ? stageParam : nextStage;
  const stageMetaInfo = stageMeta(kind, stage);
  const stageView = snapshot?.stages?.[stage] ?? null;
  const label = unitLabel(kind);

  const selectStage = useCallback(
    (next: StageKey) => {
      const params = new URLSearchParams(search);
      params.set('stage', next);
      setSearch(params, { replace: true });
    },
    [search, setSearch],
  );

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void (async () => {
      try {
        const result = await pipelineApi.precheck();
        if (alive) setPrecheck(result);
      } catch (err) {
        const code = isPipelineError(err) && (err.code === 'NO_DEFAULT_MODEL' || err.code === 'NO_API_KEY') ? err.code : undefined;
        if (alive) setPrecheck({ ok: false, code, message: code ? undefined : '无法连接本地服务' });
      }
      try {
        const view = await pipelineApi.migration(projectId);
        if (alive) setMigration(view.migration);
      } catch {
        /* 迁移状态取不到不影响主流程：按快照里的 migration 显示 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const refreshMigration = useCallback(async () => {
    try {
      const view = await pipelineApi.migration(projectId);
      setMigration(view.migration);
    } catch {
      /* 迁移状态取不到不影响主流程：下一次快照刷新会带上 */
    }
  }, [projectId]);

  /** 统一的写操作封装：必须有失败反馈，禁止空 catch。 */
  const run = useCallback(
    async (
      key: string,
      fn: () => Promise<unknown>,
      successText?: string,
      options?: {
        stage?: StageKey;
        silentToast?: boolean;
        onDone?: (value: unknown) => void;
        throwOnError?: boolean;
        /** 服务端说「只有确认覆盖这一条路」时的接管方：由它弹二次确认，不要报成普通失败。 */
        onOverwrite?: (err: unknown) => void;
      },
    ) => {
      setBusy(key);
      setActionError(null);
      try {
        const value = await fn();
        options?.onDone?.(value);
        await pipe.refresh({ details: true, silent: true });
        if (successText && !options?.silentToast) toast(successText);
        if (options?.stage) selectStage(options.stage);
        return true;
      } catch (err) {
        if (options?.onOverwrite && requiresConfirmOf(err) === 'overwrite') {
          options.onOverwrite(err);
          return false;
        }
        const nextError = isPipelineError(err)
          ? { code: err.code, message: err.message, blockers: err.blockers }
          : { code: 'NETWORK', message: err instanceof Error ? err.message : '操作失败，请重试' };
        setActionError(nextError);
        toast(isPipelineError(err) ? errorCopy(err.code).title : nextError.message || '操作失败，请重试', 'warn');
        // 需要上抛的调用方（例如条目卡保存）拿到的必须是原错误：code/blockers 不能丢。
        if (options?.throwOnError) throw err;
        return false;
      } finally {
        setBusy(null);
      }
    },
    [pipe, selectStage, toast],
  );

  /**
   * 升级/回退成功后必须立刻刷新 migration（先用响应里带回的那份，再取一次）：
   * 否则横幅仍按旧的 legacy 状态渲染，点完像没生效。
   */
  const runMigration = useCallback(
    (key: 'migrate' | 'rollback', successText: string) =>
      run(
        key,
        () => (key === 'migrate' ? pipelineApi.migrate(projectId) : pipelineApi.rollbackMigration(projectId, 'sql')),
        successText,
        {
          onDone: (value) => {
            const result = value as { migration?: MigrationView } | undefined;
            if (result?.migration) setMigration(result.migration);
            void refreshMigration();
          },
        },
      ),
    [projectId, refreshMigration, run],
  );

  const generate = useCallback(
    (stageKey: StageKey) => {
      const meta = stageMeta(kind, stageKey);
      void run(`generate-${stageKey}`, () => pipelineApi.startStage(projectId, stageKey), `已开始生成${meta.title}`, { stage: stageKey });
    },
    [kind, projectId, run],
  );

  /**
   * N1：整阶段重建（含横幅的「按上游重排」）。手改过条目时服务端只接受 `confirmOverwrite: true`，
   * 先按不带确认发一次、被 422 挡回来再弹二次确认重发 —— 让「手改会丢」这件事由用户点头，
   * 而不是把功能做成只能 curl 调的半成品。
   */
  const regenerateAll = useCallback(
    (stageKey: StageKey, viaStale = false) => {
      const meta = stageMeta(kind, stageKey);
      const call = (confirmOverwrite: boolean) =>
        viaStale
          ? pipelineApi.resolveStale(projectId, stageKey, 'regenerate', { confirmOverwrite })
          : pipelineApi.regenerate(projectId, stageKey, { scope: 'all', confirmOverwrite });
      const successText = viaStale ? '已按上游重排' : `已开始重新生成${meta.title}`;
      const askOverwrite = (err: unknown) => {
        const blockers = errorBlockersOf(err);
        const copy = errorCopy('CONFIRM_BLOCKED', { requiresConfirm: 'overwrite' });
        setConfirm({
          title: viaStale ? '按上游重排会覆盖手改内容' : `重新生成${meta.title}会覆盖手改内容`,
          kind: 'overwrite',
          body: `${copy.hint}${blockers.length ? ` 影响：${blockers.join('、')}。` : ''}`,
          confirmLabel: copy.action?.label || '确认覆盖',
          onConfirm: () => {
            setConfirm(null);
            void run(`regen-${stageKey}`, () => call(true), successText, { stage: stageKey });
          },
        });
      };
      return run(`regen-${stageKey}`, () => call(false), successText, { stage: stageKey, onOverwrite: askOverwrite });
    },
    [kind, projectId, run],
  );

  const refreshRevisionList = useCallback(
    async (target: HistoryTarget) => {
      setRevisionsLoading(true);
      try {
        const result = await pipelineApi.revisions(projectId, target.stageKey, target.targetId);
        setRevisions(result.revisions ?? []);
      } catch (err) {
        setRevisions([]);
        toast(isPipelineError(err) ? errorCopy(err.code).title : '读取修订历史失败', 'warn');
      } finally {
        setRevisionsLoading(false);
      }
    },
    [projectId, toast],
  );

  const openHistory = useCallback(
    (target: HistoryTarget) => {
      setHistory(target);
      setRevisions([]);
      void refreshRevisionList(target);
    },
    [refreshRevisionList],
  );

  const submitFeedback = useCallback(
    async (note: string) => {
      if (!feedback) return;
      await pipelineApi.feedback(projectId, feedback.stageKey, {
        scope: feedback.scope === 'stage' ? 'all' : feedback.scope,
        targetId: feedback.scope === 'stage' ? undefined : feedback.targetId,
        note,
      });
      toast('已按你的意见开始重做', 'ok');
      await pipe.refresh({ details: true, silent: true });
    },
    [feedback, pipe, projectId, toast],
  );

  const patchItem = useCallback(
    async (item: PipelineItem, patch: { title?: string; payload?: Record<string, unknown> }) => {
      // throwOnError：保存失败时把原始 PipelineRequestError 抛回条目卡，
      // 让卡片保持编辑态并显示 code/blockers，而不是一句丢掉原因的「保存失败」。
      await run(`save-${item.id}`, () => pipelineApi.patchItem(projectId, item.id, patch), '已保存', { throwOnError: true });
    },
    [projectId, run],
  );

  const addItem = (stage: StageKey, input: { kind?: string; title?: string; parentId?: string }) =>
    void run(`add-${stage}`, () => pipelineApi.createItem(projectId, stage, input), '已新增一条，接着补充内容', { stage });

  const removeItem = (item: PipelineItem) =>
    setConfirm({
      title: `删除「${item.title || '这一条'}」？`,
      body: item.locked ? '这一条已锁定，先解锁再删。' : '删除后不能恢复；下游阶段会被标记为需要复核。',
      confirmLabel: '删除',
      danger: true,
      onConfirm: () => {
        setConfirm(null);
        void run(`delete-${item.id}`, () => pipelineApi.deleteItem(projectId, item.id), '已删除');
      },
    });

  const moveItems = (stage: StageKey, block: string, ids: string[], itemId: string, delta: -1 | 1) => {
    const index = ids.indexOf(itemId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ids.length) return;
    const order = [...ids];
    order.splice(index, 1);
    order.splice(next, 0, itemId);
    void run(`move-${itemId}`, () => pipelineApi.reorderItems(projectId, stage, { block, ids: order }), '顺序已更新');
  };

  const itemActions = useMemo(
    () => ({
      busy: busy !== null,
      regeneratingId: null as string | null,
      onSave: patchItem,
      onRegen: (item: PipelineItem) => {
        const stageKey = (item.stageKey as StageKey) || 'p1';
        void run(`regen-${item.id}`, () => pipelineApi.regenerate(projectId, stageKey, { scope: 'item', targetId: item.id }), '已开始重写这一条', {
          stage: stageKey,
        });
      },
      onFeedback: (item: PipelineItem) => {
        const stageKey = (item.stageKey as StageKey) || 'p1';
        setFeedback({ stageKey, scope: 'item', targetId: item.id, title: item.title || '这一条', scopeLabel: '这一条' });
      },
      onHistory: (item: PipelineItem) => {
        const stageKey = (item.stageKey as StageKey) || 'p1';
        openHistory({ stageKey, targetId: item.id, title: item.title || '这一条' });
      },
      onLock: (item: PipelineItem, locked: boolean) => {
        void run(`lock-${item.id}`, () => pipelineApi.lockItem(projectId, item.id, locked), locked ? '已锁定，整份重生成会跳过它' : '已解锁');
      },
      onBlockRegen: (block: 'world' | 'env' | 'characters') => {
        const blockLabel = block === 'world' ? '世界观' : block === 'env' ? '环境' : '人物';
        setConfirm({
          title: `重生成${blockLabel}？`,
          body: `AI 会重做这一块的每一条内容，已锁定的不会被覆盖，其余会被新内容替换（旧内容可在修改历史里找回）。`,
          confirmLabel: '重生成',
          onConfirm: () => {
            setConfirm(null);
            void run(`regen-block-${block}`, () => pipelineApi.regenerate(projectId, 'p1', { scope: 'block', targetId: block }), `已开始重生成${blockLabel}`, {
              stage: 'p1',
            });
          },
        });
      },
      onBlockFeedback: (block: 'world' | 'env' | 'characters') => {
        const blockLabel = block === 'world' ? '世界观' : block === 'env' ? '环境' : '人物';
        setFeedback({ stageKey: 'p1', scope: 'block', targetId: block, title: blockLabel, scopeLabel: blockLabel });
      },
      onAdd: (block: 'env' | 'characters') => addItem('p1', { kind: block === 'env' ? 'env' : 'character' }),
      onDelete: removeItem,
      onMove: (item: PipelineItem, block: 'env' | 'characters', delta: -1 | 1) =>
        moveItems('p1', block, pipe.items.p1.filter((row) => row.kind === (block === 'env' ? 'env' : 'character')).map((row) => row.id), item.id, delta),
    }),
    [addItem, busy, moveItems, openHistory, patchItem, pipe.items.p1, projectId, removeItem, run],
  );

  const outlineActions = useMemo(
    () => ({
      ...itemActions,
      onActRegen: (act: PipelineItem) => {
        setConfirm({
          title: `重生成这一${kind === 'short' ? '节拍组' : '幕'}？`,
          body: '这一块里的节拍会被重做，已锁定的不动。',
          confirmLabel: '重生成',
          onConfirm: () => {
            setConfirm(null);
            const actIndex = pipe.items.p2.filter((item) => item.kind === (kind === 'short' ? 'beat_group' : 'act')).findIndex((item) => item.id === act.id);
            void run(`regen-act-${act.id}`, () => pipelineApi.regenerate(projectId, 'p2', { scope: 'block', targetId: String(Math.max(0, actIndex)) }), '已开始重做这一块', { stage: 'p2' });
          },
        });
      },
      onActFeedback: (act: PipelineItem) => {
        setFeedback({ stageKey: 'p2', scope: 'item', targetId: act.id, title: act.title || '这一幕', scopeLabel: '这一幕' });
      },
      onAddGroup: () => addItem('p2', { kind: kind === 'short' ? 'beat_group' : 'act' }),
      onAddBeat: (group: PipelineItem) => addItem('p2', { kind: 'beat', parentId: group.id }),
      onMoveGroup: (group: PipelineItem, delta: -1 | 1) =>
        moveItems('p2', 'acts', pipe.items.p2.filter((item) => item.kind === (kind === 'short' ? 'beat_group' : 'act')).map((item) => item.id), group.id, delta),
      onMoveBeat: (beat: PipelineItem, group: PipelineItem, delta: -1 | 1) =>
        moveItems(
          'p2',
          group.id,
          pipe.items.p2
            .filter((item) => item.kind === 'beat' && (kind === 'short' ? item.payload?.groupId === group.id : item.payload?.actId === group.id))
            .map((item) => item.id),
          beat.id,
          delta,
        ),
    }),
    [addItem, itemActions, kind, moveItems, pipe.items.p2, projectId, run],
  );

  const writing = snapshot?.job?.stage === 'p4' ? snapshot.job : null;
  const lastWriting = snapshot?.lastJob?.stage === 'p4' ? snapshot.lastJob : null;

  const startWriting = () =>
    void run('write-start', () => pipelineApi.startWriting(projectId, { mode: 'continuous' }), 'AI 已开始连续写作', { stage: 'p4', silentToast: true });
  const startSingle = (unitId: string) =>
    void run('write-one', () => pipelineApi.startWriting(projectId, { mode: 'single', unitId }), `已开始写这一${label}`, { stage: 'p4', silentToast: true });
  const pauseWriting = () => void run('write-pause', () => pipelineApi.pauseWriting(projectId), '会在当前这一' + label + '写完后暂停', { silentToast: true });
  // 继续写作：正常走 /writing/continue；若后端没有可续的暂停点（例如暂停正好落在
  // 某一章的写作中途，服务端会先把这一章回滚成待写、job 记为 cancelled），
  // 就退回到「重跑这个 job 剩下的步骤」，保证按钮任何情况下都有下一步可用。
  const continueWriting = () =>
    void run(
      'write-continue',
      async () => {
        try {
          return await pipelineApi.continueWriting(projectId);
        } catch (error) {
          const retryable = isPipelineError(error) && (error.code === 'BAD_REQUEST' || error.code === 'CONCURRENT_JOB');
          const fallbackJob = snapshot?.lastJob;
          if (!retryable || !fallbackJob) throw error;
          return await pipelineApi.retryJob(projectId, fallbackJob.id);
        }
      },
      '已继续写作',
      { silentToast: true },
    );
  const stopWriting = () =>
    setConfirm({
      title: '立即停止写作？',
      body: `当前这一${label}正在写，已生成的部分不会保存；已经写完的${label}都保留。`,
      confirmLabel: '立即停止',
      danger: true,
      onConfirm: () => {
        setConfirm(null);
        void run('write-stop', () => pipelineApi.stopWriting(projectId, true), '已停止写作', { silentToast: true });
      },
    });

  const reviewUnit = (unitId: string) => navigate(`/project/${projectId}?review=1&chapter=${unitId}`);
  const rewriteUnit = (unitId: string) =>
    void run(`rewrite-${unitId}`, () => pipelineApi.reviewChapter(unitId, { action: 'rewrite' }), `已开始重写这一${label}`, { silentToast: true });

  const preset = async (key: PresetKey) => {
    const range = WORD_PRESETS[key];
    const targets = units.filter((unit) => !unit.locked && !unit.hasContent);
    if (!targets.length) {
      toast(`没有可应用字数档的${label}（都已锁定或已有正文）`, 'warn');
      return;
    }
    setPresetText(`正在对 ${targets.length} ${label}应用字数档…`);
    let applied = 0;
    const failed: { title: string; reason: string }[] = [];
    try {
      for (const unit of targets) {
        try {
          await pipelineApi.patchUnit(projectId, unit.id, { minWords: range.min, targetWords: range.target, maxWords: range.max });
          applied += 1;
        } catch (error) {
          // 单章失败不该让整批静默停在中途：记下原因，最后汇总告诉用户并保留重试入口。
          failed.push({
            title: unit.title || `${label} ${unit.ordinal}`,
            reason: isPipelineError(error) ? errorCopy(error.code).title : error instanceof Error ? error.message : '未知原因',
          });
        }
      }
    } finally {
      setPresetText(null);
      await pipe.refresh({ details: true, silent: true }).catch(() => undefined);
    }
    if (!failed.length) {
      toast(`已对 ${applied} ${label}应用字数档`, 'ok');
      return;
    }
    const sample = failed.slice(0, 3).map((row) => `${row.title}（${row.reason}）`).join('、');
    setActionError({
      code: 'PRESET_PARTIAL',
      message: `${applied} ${label}已应用，${failed.length} ${label}没改成：${sample}${failed.length > 3 ? ' 等' : ''}。再点一次同一个字数档只会改还没改成的。`,
    });
    toast(`${applied} ${label}成功 / ${failed.length} ${label}失败，可再点一次重试`, 'warn');
    throw new Error(`${failed.length} ${label}没改成`);
  };

  const stageContent = () => {
    if (!snapshot) {
    // 兜底：既不在加载中、也没有可展示的错误（例如被卸载/竞态），不能留一张白纸。
    return (
      <AppShell active="pipeline" projectId={projectId} topbar={<div className="topbar__crumbs">企划</div>}>
        <div className="pipeline-empty" data-testid="pipeline-fallback">
          <strong>暂时读不到这个作品的企划状态</strong>
          <p>可能是网络抖动或本地服务刚重启。可以重试，或先回作品库。</p>
          <div className="pipeline-empty__actions">
            <button type="button" className="btn btn--primary" onClick={() => void pipe.refresh({ details: true })}>
              重试
            </button>
            <Link className="btn btn--ghost" to="/">
              返回作品库
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }
    // 只有「首次生成、还没有任何产物」时才用骨架占位；已经有内容（含逐章写作进行中）
    // 时保持内容与进度条可见，否则用户会在写作过程中丢掉进度、暂停按钮与章节板。
    const hasStageContent =
      stage === 'p1' ? pipe.items.p1.length > 0 : stage === 'p2' ? pipe.items.p2.length > 0 : units.length > 0;
    if (stageView?.status === 'generating' && !hasStageContent) {
      return (
        <div className="pipeline-skeleton" aria-hidden="true">
          <div className="pipeline-skeleton__row" />
          <div className="pipeline-skeleton__row" />
          <div className="pipeline-skeleton__row pipeline-skeleton__row--short" />
        </div>
      );
    }

    if (stage === 'p1') {
      const hasItems = pipe.items.p1.length > 0;
      if (!hasItems) {
        return (
          <div className="pipeline-empty">
            <strong>还没有设定</strong>
            <p>让 AI 先给一版初稿，世界观、环境与人物就有了骨架，你再改。</p>
            <button type="button" className="btn btn--primary" data-testid="stage-generate" disabled={busy !== null} onClick={() => generate('p1')}>
              让 AI 生成设定
            </button>
          </div>
        );
      }
      return <P1SettingView kind={kind} items={pipe.items.p1} status={stageView?.status || 'review'} actions={itemActions} />;
    }

    if (stage === 'p2') {
      if (!pipe.items.p2.length) {
        return (
          <div className="pipeline-empty">
            <strong>还没有故事大纲</strong>
            <p>大纲会把设定拆成一件件可写的事件。</p>
            <button type="button" className="btn btn--primary" data-testid="stage-generate" disabled={busy !== null} onClick={() => generate('p2')}>
              生成故事大纲
            </button>
          </div>
        );
      }
      return <P2OutlineView kind={kind} items={pipe.items.p2} status={stageView?.status || 'review'} premise={snapshot.project.premise} actions={outlineActions} />;
    }

    if (stage === 'p3') {
      if (!units.length) {
        return (
          <div className="pipeline-empty">
            <strong>还没有{kind === 'short' ? '节拍' : '章节'}计划</strong>
            <p>{kind === 'short' ? '节拍计划决定每个节拍写什么、写多长。' : '章节计划决定每章写什么、写多长。'}</p>
            <button type="button" className="btn btn--primary" data-testid="stage-generate" disabled={busy !== null} onClick={() => generate('p3')}>
              生成{kind === 'short' ? '节拍' : '章节'}计划
            </button>
          </div>
        );
      }
      return (
        <>
          {presetText ? <p className="pipeline-inline-hint">{presetText}</p> : null}
          <P3PlanView
            kind={kind}
            status={stageView?.status || 'review'}
            units={units}
            summary={summary}
            busy={busy !== null}
            onPatchUnit={async (unitId, patch) => {
              await pipelineApi.patchUnit(projectId, unitId, {
                title: patch.title,
                function: patch.function,
                synopsis: patch.synopsis,
                minWords: patch.minWords ?? undefined,
                targetWords: patch.targetWords ?? undefined,
                maxWords: patch.maxWords ?? undefined,
                acceptDeviation: false,
              });
              await pipe.refresh({ details: true, silent: true });
            }}
            onSetCount={async (count, archiveOrphans) => {
              await pipelineApi.setUnitCount(projectId, count, archiveOrphans);
              await pipe.refresh({ details: true, silent: true });
              toast(`已调整为 ${count} ${label}`, 'ok');
            }}
            onPreset={preset}
            onAllocatePreview={(totalTarget) => pipelineApi.allocate(projectId, totalTarget)}
            onAllocateApply={async (rows) => {
              await pipelineApi.applyAllocation(projectId, rows);
              await pipe.refresh({ details: true, silent: true });
              toast('已按目标字数重新分配', 'ok');
            }}
            onAcceptDeviation={async (accepted) => {
              await pipelineApi.acceptDeviation(projectId, accepted);
              await pipe.refresh({ details: true, silent: true });
              toast(accepted ? '已接受字数偏差' : '已撤回偏差接受', 'ok');
            }}
            onConfirm={() =>
              void run('confirm-p3', () => pipelineApi.confirmStage(projectId, 'p3'), '已确认章节计划，可以开始逐章写作', { stage: 'p4' })
            }
            onLockUnit={async (unitId, locked) => {
              await run(`lock-unit-${unitId}`, () => pipelineApi.lockItem(projectId, unitId, locked), locked ? '已锁定' : '已解锁');
            }}
            onReorderUnits={async (ids) => {
              await pipelineApi.reorderUnits(projectId, ids);
              await pipe.refresh({ details: true, silent: true });
              toast('顺序已更新', 'ok');
            }}
          />
        </>
      );
    }

    return (
      <P4WritingView
        kind={kind}
        status={stageView?.status || 'empty'}
        units={units}
        job={writing ? (snapshot.job as never) : null}
        lastJob={lastWriting ? (snapshot.lastJob as never) : null}
        busy={busy !== null}
        onStart={startWriting}
        onStartSingle={startSingle}
        onContinue={continueWriting}
        onPause={pauseWriting}
        onStop={stopWriting}
        onRewrite={rewriteUnit}
        onReview={reviewUnit}
        onRetry={startSingle}
        planConfirmed={snapshot.stages.p3?.status === 'confirmed'}
      />
    );
  };

  const subtitles = useMemo(() => {
    if (!snapshot) return {};
    const p1 = snapshot.stages.p1?.counts;
    const p2 = snapshot.stages.p2?.counts;
    return {
      p1: `${p1?.items ?? 0} 条设定`,
      p2: `${p2?.items ?? 0} 条大纲`,
      p3: `${units.length} ${label} · ${formatWords(summary?.totalTarget ?? 0)}`,
      p4: snapshot.progress.unitsTotal ? `${snapshot.progress.unitsDone}/${snapshot.progress.unitsTotal} ${label}` : `${label}还没开始`,
    } as Partial<Record<StageKey, string>>;
  }, [label, snapshot, summary?.totalTarget, units.length]);

  const interceptError = precheck && !precheck.ok ? precheck.code || 'NO_DEFAULT_MODEL' : null;
  const lastError = snapshot?.lastError;
  const interrupted = snapshot?.lastJob?.state === 'interrupted' || snapshot?.lastError?.code === 'INTERRUPTED';
  const showStageError = Boolean(lastError) && !snapshot?.job && !interrupted && stageView?.status !== 'generating';
  const hasWriting = (snapshot?.progress.unitsTotal ?? 0) > 0 || units.length > 0;
  const firstWrittenUnit = units.find((unit) => unit.hasContent) || null;

  const nextStepAction = () => {
    const next = snapshot?.nextStep;
    if (!next) return;
    switch (next.kind) {
      case 'migrate':
        setConfirm({
          title: '升级到 AI 流水线？',
          body: '会先备份数据库，再在事务里把现有正文、设定和大纲映射到新结构；失败会回滚。',
          confirmLabel: '开始升级',
          onConfirm: () => {
            setConfirm(null);
            void runMigration('migrate', '升级完成');
          },
        });
        return;
      case 'fix-provider':
        navigate('/settings');
        return;
      case 'generate-p1':
      case 'generate-p2':
      case 'generate-p3':
        generate(next.stage || 'p1');
        return;
      case 'review-p1':
      case 'review-p2':
      case 'review-p3':
        selectStage(next.stage || 'p1');
        window.setTimeout(() => document.querySelector('[data-testid="stage-confirm"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
        return;
      case 'start-writing':
        selectStage('p4');
        startWriting();
        return;
      case 'resume-writing':
        selectStage('p4');
        continueWriting();
        return;
      case 'watch':
        selectStage(next.stage || 'p1');
        return;
      case 'retry-failed':
        selectStage(next.stage || stage);
        // 真的续跑：先按 job 续（服务端 resumeStepsFor 只补没做完的步骤），
        // 没有可续的 job / 续跑失败才退回「整份重来」。
        if (lastWriting || (snapshot.lastJob && snapshot.lastJob.stage === (next.stage || stage))) {
          const job = snapshot.lastJob!;
          void run('retry-job', () => pipelineApi.retryJob(projectId, job.id), '已继续上次没做完的部分').then((ok) => {
            if (!ok) generate((next.stage || stage) as StageKey);
          });
        } else {
          generate((next.stage || stage) as StageKey);
        }
        return;
      case 'review-chapters': {
        const first = units.find((unit) => unit.reviewStatus === 'in_review');
        selectStage('p4');
        if (first) reviewUnit(first.id);
        return;
      }
      case 'export':
        void run('export', () => api.downloadProjectMarkdown(projectId), '已导出 Markdown', { silentToast: false });
        return;
      default:
        selectStage(nextStage);
    }
  };

  if (!projectId) return null;

  if (unsupportedType && unsupportedType !== 'screenplay') {
    return (
      <AppShell active="pipeline" projectId={projectId} topbar={<div className="topbar__crumbs">企划</div>}>
        <div className="pipeline-empty" data-testid="pipeline-unsupported">
          <strong>「{projectSummary?.title || '这个作品'}」是{unsupportedType === 'series' ? '剧集大纲' : '剧本'}，不进 AI 流水线</strong>
          <p>流水线的「设定 → 大纲 → 章节计划 → 逐章写作」只针对长篇与短篇；剧本有自己的分镜工作台。</p>
          <div className="pipeline-empty__actions">
            <button type="button" className="btn btn--primary" onClick={() => navigate(`/project/${projectId}`)}>
              回到写作台
            </button>
            <Link className="btn btn--ghost" to="/">
              返回作品库
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (loading && !snapshot) {
    return (
      <AppShell active="pipeline" projectId={projectId} topbar={<div className="topbar__crumbs">企划</div>}>
        <div className="pipeline-loading" role="status" aria-live="polite">
          正在读取企划进度…
        </div>
      </AppShell>
    );
  }

  if (pipe.error && !snapshot) {
    return (
      <AppShell active="pipeline" projectId={projectId} topbar={<div className="topbar__crumbs">企划</div>}>
        <ErrorCard
          code={pipe.error.code || 'NETWORK'}
          message={pipe.error.message}
          onRetry={() => void pipe.refresh({ details: true })}
          onSettings={() => navigate('/settings')}
        />
      </AppShell>
    );
  }

  if (!snapshot) {
    // 兜底：既不在加载中、也没有可展示的错误（例如被卸载/竞态），不能留一张白纸。
    return (
      <AppShell active="pipeline" projectId={projectId} topbar={<div className="topbar__crumbs">企划</div>}>
        <div className="pipeline-empty" data-testid="pipeline-fallback">
          <strong>暂时读不到这个作品的企划状态</strong>
          <p>可能是网络抖动或本地服务刚重启。可以重试，或先回作品库。</p>
          <div className="pipeline-empty__actions">
            <button type="button" className="btn btn--primary" onClick={() => void pipe.refresh({ details: true })}>
              重试
            </button>
            <Link className="btn btn--ghost" to="/">
              返回作品库
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      active="pipeline"
      projectId={projectId}
      panel={
        <StageRail
          snapshot={snapshot}
          kind={kind}
          current={stage}
          subtitles={subtitles}
          onSelect={selectStage}
        />
      }
      topbar={
        <div className="pipeline-topbar">
          <div className="topbar__crumbs">
            <Link to="/">作品库</Link>
            <span aria-hidden="true">/</span>
            <strong>{snapshot.project.title}</strong>
            <span className="tag">{kind === 'short' ? '短篇' : '长篇'}</span>
          </div>
          <div className="pipeline-topbar__actions">
            {offline ? <span className="pipeline-offline">· 与后台失去联系</span> : null}
            <span className="pipeline-topbar__words">{formatWords(snapshot.progress.words)} 已写</span>
            <Link
              className="btn btn--ghost btn--sm"
              to={`/project/${projectId}${firstWrittenUnit ? `?chapter=${firstWrittenUnit.id}` : ''}`}
              title={firstWrittenUnit ? '打开正文编辑器' : '还没有正文，先在阶段 4 写作'}
            >
              写作台
            </Link>
            <Link className="btn btn--ghost btn--sm" to={`/project/${projectId}/outline`}>
              大纲
            </Link>
          </div>
        </div>
      }
    >
      <div className="pipeline-page">
        <div className="pipeline-page__head">
          <div>
            <span className="eyebrow">
              <i className="eyebrow__dot" aria-hidden="true" />
              阶段 {STAGE_KEYS.indexOf(stage) + 1} · {stageMetaInfo.title}
            </span>
            <h1>{stageMetaInfo.title}</h1>
            <p className="pipeline-page__sub">{stageMetaInfo.subtitle}</p>
          </div>
          <div className="pipeline-page__actions">
            {stage !== 'p4' ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="stage-regen-all"
                  disabled={busy !== null || snapshot.job !== null}
                  onClick={() =>
                    setConfirm({
                      title: `整份重新生成${stageMetaInfo.title}？`,
                      body: 'AI 会重做这一阶段的全部内容；已锁定的条目和人工改过的正文不会被覆盖，旧内容仍可在修改历史里找回。',
                      confirmLabel: '整份重生成',
                      onConfirm: () => {
                        setConfirm(null);
                        void regenerateAll(stage);
                      },
                    })
                  }
                >
                  整份重新生成
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="stage-feedback"
                  disabled={busy !== null || snapshot.job !== null}
                  onClick={() => setFeedback({ stageKey: stage, scope: 'stage', title: stageMetaInfo.title, scopeLabel: `${stageMetaInfo.title}整份` })}
                >
                  给 AI 提意见
                </button>
              </>
            ) : null}
            {!hasWriting && (snapshot.progress.words ?? 0) === 0 ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="plan-delete"
                disabled={busy !== null}
                onClick={() =>
                  setConfirm({
                    title: `删除「${snapshot.project.title}」？`,
                    body: '这个作品还没有任何正文和企划内容，删除后不可恢复；如果只是暂时不想做，可以留在作品库里。',
                    confirmLabel: '删除作品',
                    danger: true,
                    onConfirm: () => {
                      setConfirm(null);
                      void run('delete-project', () => api.deleteProject(projectId), '作品已删除').then((ok) => {
                        if (ok) navigate('/');
                      });
                    },
                  })
                }
              >
                删除这个作品
              </button>
            ) : null}
            {stage !== 'p4' ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="stage-history"
                onClick={() => openHistory({ stageKey: stage, title: stageMetaInfo.title })}
              >
                修订历史
              </button>
            ) : null}
          </div>
        </div>

        <PipelineBanner
          snapshot={snapshot}
          kind={kind}
          stage={stage}
          precheck={precheck}
          migration={migration}
          busy={busy !== null}
          onMigrate={() =>
            setConfirm({
              title: '升级到 AI 流水线？',
              body: '会先备份数据库，再在事务里把现有正文、设定和大纲映射到新结构；失败会回滚，正文逐字节不变。',
              confirmLabel: '开始升级',
              onConfirm: () => {
                setConfirm(null);
                void runMigration('migrate', '升级完成');
              },
            })
          }
          onRollback={() =>
            setConfirm({
              title: '回退这次升级？',
              body: '回退会删除升级时新增的流水线数据；升级后新写的章节会被归档。',
              confirmLabel: '回退',
              danger: true,
              onConfirm: () => {
                setConfirm(null);
                void runMigration('rollback', '已回退');
              },
            })
          }
          onResolveStale={(action) =>
            action === 'regenerate'
              ? void regenerateAll(stage, true)
              : void run('stale', () => pipelineApi.resolveStale(projectId, stage, action), action === 'keep' ? '已复核并保留' : '已忽略这次变更')
          }
          onFixProvider={() => navigate('/settings')}
          onResumeWriting={() => {
            selectStage('p4');
            continueWriting();
          }}
          onDiscardInterrupted={() =>
            setConfirm({
              title: '放弃这次中断的写作？',
              body: '只会清掉任务记录，已写完的章节内容都保留。',
              confirmLabel: '放弃任务',
              danger: true,
              onConfirm: () => {
                setConfirm(null);
                void run('discard', () => pipelineApi.stopWriting(projectId, true), '已放弃这次任务');
              },
            })
          }
        />

        {snapshot.job ? <JobBar job={snapshot.job} label={STAGE_JOB_LABEL[snapshot.job.stage] || '正在生成'} onCancel={() => void run('cancel', () => pipelineApi.cancelJob(snapshot.job!.id, 'stop'), '已取消这次生成')} cancelling={busy === 'cancel'} /> : null}

        {interceptError ? (
          <ErrorCard
            code={interceptError}
            message={precheck?.message}
            context={precheck?.providerId ? `供应商 ${precheck.providerId} · 模型 ${precheck.modelId || ''}` : undefined}
            onSettings={() => navigate('/settings')}
          />
        ) : null}

        {actionError ? (
          <ErrorCard
            code={actionError.code}
            message={actionError.message}
            blockers={actionError.blockers}
            onRetry={() => setActionError(null)}
            retryLabel="知道了"
            retryable
          />
        ) : null}

        {showStageError && lastError ? (
          <ErrorCard
            code={lastError.code}
            message={lastError.message}
            context={`阶段 ${stage}`}
            onRetry={() => {
              if (stage === 'p4') startWriting();
              else generate(stage);
            }}
          />
        ) : null}

        <NextStepCard nextStep={snapshot.nextStep} onRun={nextStepAction} busy={busy !== null} />

        <div className="pipeline-stage" data-stage={stage}>
          {stageContent()}
        </div>

        {stage !== 'p4' ? (
          <StageConfirmBar
            stage={stage}
            kind={kind}
            status={stageView?.status || 'empty'}
            locked={Boolean(stageView?.locked)}
            blockedBy={stageView?.blockedBy}
            blockers={snapshot.nextStep?.stage === stage ? snapshot.nextStep.blockers ?? [] : []}
            busy={busy !== null}
            confirmedAt={stageView?.status === 'confirmed' ? stageView.updatedAt : null}
            onConfirm={() =>
              void run(`confirm-${stage}`, () => pipelineApi.confirmStage(projectId, stage), `已确认${stageMetaInfo.title}`, {
                stage: stage === 'p1' ? 'p2' : stage === 'p2' ? 'p3' : 'p4',
              })
            }
            onSkip={() => {
              setConfirm({
                title: `跳过${stageMetaInfo.title}？`,
                body: '跳过之后，这一阶段不会拦住后面的流程；你随时可以回来重做。',
                confirmLabel: '跳过',
                danger: true,
                onConfirm: () => {
                  setConfirm(null);
                  void run(`skip-${stage}`, () => pipelineApi.skipStage(projectId, stage, '用户选择跳过'), `已跳过${stageMetaInfo.title}`);
                },
              });
            }}
            onJumpBlocker={(blocker) => {
              const target =
                blocker.includes('人物') ? 'block-characters' : blocker.includes('环境') ? 'block-env' : blocker.includes('世界') ? 'block-world' : null;
              if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          />
        ) : null}

        <footer className="pipeline-foot">
          <span>
            {kind === 'short' ? '短篇' : '长篇'} · 目标 {formatWords(snapshot.project.targetWords)} · 已写 {formatWords(snapshot.progress.words)}
          </span>
          <span>
            {stageMetas(kind)
              .map((meta) => `${meta.title} ${snapshot.stages[meta.key]?.status || 'empty'}`)
              .join(' · ')}
          </span>
        </footer>
      </div>

      <FeedbackComposer
        open={Boolean(feedback)}
        title={feedback?.title || ''}
        scopeLabel={feedback?.scopeLabel || ''}
        busy={busy !== null}
        onClose={() => setFeedback(null)}
        onSubmit={submitFeedback}
      />

      <RevisionDrawer
        open={Boolean(history)}
        title={history?.title || ''}
        revisions={revisions}
        loading={revisionsLoading}
        busy={busy !== null}
        onClose={() => setHistory(null)}
        onRestore={(revisionId) => {
          if (!history) return;
          if (history.targetId) {
            void run(
              'restore',
              () => pipelineApi.restoreItemRevision(projectId, history.targetId!, revisionId),
              '已恢复到这一版（会生成一条新修订）',
            ).then((ok) => {
              if (ok) void refreshRevisionList(history);
            });
          } else {
            toast('阶段级快照暂不支持一键恢复，可以在条目里恢复单条修订', 'warn');
          }
        }}
      />

      {confirm ? (
        <div
          className="pipeline-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={confirm.title}
          data-testid={confirm.kind === 'overwrite' ? 'confirm-overwrite' : 'confirm-dialog'}
        >
          <div className="pipeline-dialog__bg" aria-hidden="true" onClick={() => setConfirm(null)} />
          <div className="pipeline-dialog__panel">
            <h3>{confirm.title}</h3>
            <p>{confirm.body}</p>
            <div className="pipeline-dialog__actions">
              <button type="button" className="btn btn--ghost" data-testid="confirm-cancel" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button type="button" className={`btn ${confirm.danger ? 'btn--danger' : 'btn--primary'}`} data-testid="confirm-ok" onClick={confirm.onConfirm}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
