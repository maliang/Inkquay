import type { ReactNode } from 'react';
import type { MigrationView, PipelineSnapshot, PrecheckResult, StageKey } from '../../../shared/pipeline.ts';
import { errorCopy, stageMeta, type ProjectKind } from '../../lib/pipeline/format.ts';

/**
 * 上游变更原因码 → 人话。
 * 服务端 `markDownstreamStale(projectId, stageKey, `${stageKey}:edited|regenerated`)` 只存内部码，
 * 文案在展示层收口；未知值原样回退，既不把内部码怼给用户，也不吞掉将来新增的码。
 */
const STALE_STAGE_LABEL: Record<StageKey, string> = {
  p1: '设定',
  p2: '故事大纲',
  p3: '章节计划',
  p4: '正文',
};

const STALE_ACTION_LABEL: Record<string, string> = {
  edited: '已被编辑',
  regenerated: '已重新生成',
};

/** 阶段的上游（p1 没有上游）：确认顺序决定「按上游重排」能不能直接跑。 */
const UPSTREAM_OF: Record<StageKey, StageKey | null> = { p1: null, p2: 'p1', p3: 'p2', p4: 'p3' };

export function staleReasonLabel(reason: string, kind: ProjectKind = 'novel'): string {
  const [head, action] = reason.split(':');
  const stageLabel = head === 'p3' && kind === 'short' ? '节拍计划' : STALE_STAGE_LABEL[head as StageKey];
  const actionLabel = action ? STALE_ACTION_LABEL[action] : undefined;
  if (stageLabel && actionLabel) return `${stageLabel}${actionLabel}`;
  return reason;
}

/**
 * 页面级横幅：旧作品迁移、上游变更、写作中断、模型不可用。
 * 优先级：写作中断 > 上游变更 > 模型不可用；迁移横幅是「信息/可回退」性质的，与它们并列渲染
 * （U21：以前迁移横幅会直接把中断横幅顶掉，用户看不到「从断点继续」）。
 */
export function PipelineBanner({
  snapshot,
  kind,
  stage,
  precheck,
  migration,
  busy,
  onMigrate,
  onRollback,
  onResolveStale,
  onFixProvider,
  onResumeWriting,
  onDiscardInterrupted,
}: {
  snapshot: PipelineSnapshot;
  kind: ProjectKind;
  stage: StageKey;
  precheck: PrecheckResult | null;
  migration: MigrationView | null;
  busy?: boolean;
  onMigrate: () => void;
  onRollback: () => void;
  onResolveStale: (action: 'keep' | 'regenerate' | 'ignore') => void;
  onFixProvider: () => void;
  onResumeWriting: () => void;
  onDiscardInterrupted: () => void;
}) {
  const stageStatus = snapshot.stages[stage]?.status;
  const staleReason = snapshot.stages[stage]?.staleReason;
  const legacy = migration?.state === 'legacy' || snapshot.migration?.state === 'legacy';
  const banners: ReactNode[] = [];

  // 1. 旧作品：还没升级到流水线
  if (legacy) {
    banners.push(
      <div className="pipeline-banner pipeline-banner--legacy" data-testid="migration-banner" data-state="legacy" role="status" key="legacy">
        <div>
          <strong>这是升级前的旧作品</strong>
          <p>可以继续在原编辑器里写；也可以升级到 AI 流水线，正文、设定与历史版本都会保留。</p>
        </div>
        <div className="pipeline-banner__actions">
          <button type="button" className="btn btn--primary btn--sm" data-testid="migration-upgrade" onClick={onMigrate} disabled={busy}>
            {busy ? '正在升级…' : '升级到流水线'}
          </button>
        </div>
      </div>,
    );
  } else if (migration && (migration.state === 'failed' || migration.state === 'done')) {
    // 2. 迁移失败 / 可回退（与中断横幅并列，不再互相顶掉）
    const failed = migration.state === 'failed';
    banners.push(
      <div
        className={`pipeline-banner ${failed ? 'pipeline-banner--danger' : 'pipeline-banner--ok'}`}
        data-testid="migration-banner"
        data-state={failed ? 'failed' : 'done'}
        role="status"
        key="migration"
      >
        <div>
          <strong>{failed ? '旧作品升级失败，已回滚' : '已升级到 AI 流水线'}</strong>
          <p>
            {failed
              ? migration.error || '数据已经回到升级前的状态，可以重试或继续用原来的编辑器。'
              : '正文、设定和版本都保留着；需要时可以回退到升级前（已有新内容时会先确认）。'}
          </p>
        </div>
        <div className="pipeline-banner__actions">
          {failed ? (
            <button type="button" className="btn btn--primary btn--sm" data-testid="migration-upgrade" onClick={onMigrate} disabled={busy}>
              重新升级
            </button>
          ) : (
            <button type="button" className="btn btn--ghost btn--sm" data-testid="migration-rollback" onClick={onRollback} disabled={busy}>
              回退到升级前
            </button>
          )}
        </div>
      </div>,
    );
  }

  // 3. 写作被中断（进程被杀 / 崩溃）：最高优先级，先于迁移横幅出现
  const job = snapshot.job || snapshot.lastJob;
  if (job && job.state === 'interrupted') {
    banners.unshift(
      <div className="pipeline-banner pipeline-banner--warn" data-testid="pipeline-banner" data-state="interrupted" role="status" key="interrupted">
        <div>
          <strong>上次写作被中断了</strong>
          <p>
            写到第 {job.currentUnitNo || job.unitsDone + 1} {job.unit === 'beat' ? '个节拍' : '章'} · 已完成的 {job.unitsDone} 章都保留着。
          </p>
        </div>
        <div className="pipeline-banner__actions">
          <button type="button" className="btn btn--primary btn--sm" data-testid="plan-continue" onClick={onResumeWriting}>
            从断点继续
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onDiscardInterrupted}>
            放弃这次
          </button>
        </div>
      </div>,
    );
    return <>{banners}</>;
  }

  // 4. 上游变更：下游内容未自动改动
  // 出现在两种情形：还没确认（review，要用户复核后确认）；已经确认（confirmed，上游又变了 → 建议复核后再确认）。
  // 已确认阶段不因为 stale 被服务端打回 review（INV-1），所以这里必须自己放开条件，否则用户永远看不到这条提示。
  if (staleReason && (stageStatus === 'review' || stageStatus === 'confirmed')) {
    const reasonLabel = staleReasonLabel(staleReason, kind);
    const confirmed = stageStatus === 'confirmed';
    // 「按上游重排」会起 regen-stage job，服务端要求上游已确认（否则 409 STAGE_LOCKED）。
    // 所以上游还在 review/editing 时把这个键禁掉并说明原因，避免它变成必 409 的死键。
    const upstreamKey = UPSTREAM_OF[stage];
    const upstreamStatus = upstreamKey ? snapshot.stages[upstreamKey].status : null;
    const upstreamReady = !upstreamKey || upstreamStatus === 'confirmed' || upstreamStatus === 'skipped';
    const upstreamLabel = upstreamKey ? stageMeta(kind, upstreamKey).title : '';
    banners.push(
      <div className="pipeline-banner pipeline-banner--stale" data-testid="pipeline-banner" data-state="stale" role="status" key="stale">
        <div data-testid="stage-stale-banner">
          <strong>{confirmed ? '上游已变更，建议复核后再确认' : '上游已变更'}</strong>
          <p>
            {reasonLabel}。本阶段内容没有自动改动，你可以选择怎么处理
            {confirmed ? '；已经被确认的内容仍然按确认时的那一版保留。' : '。'}
          </p>
        </div>
        <div className="pipeline-banner__actions">
          <button type="button" className="btn btn--sm" data-testid="stage-stale-keep" onClick={() => onResolveStale('keep')} disabled={busy}>
            复核并保留
          </button>
          <button
            type="button"
            className="btn btn--sm"
            data-testid="stage-stale-regenerate"
            onClick={() => onResolveStale('regenerate')}
            disabled={busy || !upstreamReady}
            title={upstreamReady ? '按上游的新内容重做这一阶段' : `先确认上一阶段（${upstreamLabel}），再按上游重排`}
            aria-describedby={upstreamReady ? undefined : 'stage-stale-regenerate-hint'}
          >
            按上游重排
          </button>
          {upstreamReady ? null : (
            <span className="pipeline-banner__hint" id="stage-stale-regenerate-hint" data-testid="stage-stale-regenerate-hint">
              先确认上一阶段（{upstreamLabel}）
            </span>
          )}
          <button type="button" className="btn btn--ghost btn--sm" data-testid="stage-stale-ignore" onClick={() => onResolveStale('ignore')} disabled={busy}>
            忽略
          </button>
        </div>
      </div>,
    );
    return <>{banners}</>;
  }

  // 5. 模型不可用
  if (precheck && !precheck.ok) {
    const copy = errorCopy(precheck.code || 'NO_DEFAULT_MODEL');
    banners.push(
      <div className="pipeline-banner pipeline-banner--danger" data-testid="pipeline-banner" data-state="failed" role="status" key="precheck">
        <div>
          <strong>{copy.title}</strong>
          <p>{copy.hint}</p>
        </div>
        <div className="pipeline-banner__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={onFixProvider}>
            去设置
          </button>
        </div>
      </div>,
    );
    return <>{banners}</>;
  }

  // 上次失败交给阶段内的 ErrorCard 呈现（带技术详情与重试），这里不再重复出卡，
  // 避免同一屏出现两个 plan-retry 锚点。
  return banners.length ? <>{banners}</> : null;
}
