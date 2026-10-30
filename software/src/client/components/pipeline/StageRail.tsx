import type { PipelineSnapshot, StageKey } from '../../../shared/pipeline.ts';
import { STAGE_STATUS_LABEL, formatElapsed, stageMetas, type ProjectKind } from '../../lib/pipeline/format.ts';

/**
 * 左侧阶段轨道（UX-SPEC §3.3）：阶段状态 + 量化摘要 + 当前行。
 * 轨道只做导航，不做阶段判定（下一步由服务端 nextStep 下发）。
 */
export function StageRail({
  snapshot,
  kind,
  current,
  subtitles,
  onSelect,
}: {
  snapshot: PipelineSnapshot;
  kind: ProjectKind;
  current: StageKey;
  subtitles: Partial<Record<StageKey, string>>;
  onSelect: (stage: StageKey) => void;
}) {
  const metas = stageMetas(kind);
  const confirmed = metas.filter((meta) => snapshot.stages[meta.key]?.status === 'confirmed' || snapshot.stages[meta.key]?.status === 'skipped').length;
  return (
    <div className="pipeline-rail" aria-label="企划进度">
      <div className="pipeline-rail__head">
        <span className="eyebrow">
          <i className="eyebrow__dot" aria-hidden="true" />
          企划进度
        </span>
        <strong>
          {confirmed}/{metas.length} 已确认
        </strong>
      </div>
      <ol className="pipeline-rail__list">
        {metas.map((meta) => {
          const stage = snapshot.stages[meta.key];
          const status = stage?.status || 'empty';
          const running = snapshot.job?.stage === meta.key && (snapshot.job.state === 'running' || snapshot.job.state === 'pausing');
          const isCurrent = current === meta.key;
          // U11：锁定阶段点了也进不去（确认顺序由服务端把关），直接 disabled 并给出原因。
          const locked = Boolean(stage?.locked) && !isCurrent;
          const subtitle = subtitles[meta.key] || meta.subtitle;
          return (
            <li key={meta.key}>
              <button
                type="button"
                className={`pipeline-rail__row${isCurrent ? ' is-current' : ''}${status === 'confirmed' ? ' is-confirmed' : ''}`}
                data-testid={`stage-${meta.key}`}
                data-status={status}
                data-locked={locked ? 'true' : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                disabled={locked}
                title={locked ? '先确认上一阶段，才能进入这里' : undefined}
                onClick={() => onSelect(meta.key)}
              >
                <span className="pipeline-rail__no" aria-hidden="true">
                  {status === 'confirmed' ? '✓' : status === 'skipped' ? '–' : status === 'failed' ? '!' : meta.index}
                </span>
                <span className="pipeline-rail__body">
                  <span className="pipeline-rail__title">
                    {meta.title}
                    <em className={`pipeline-rail__badge pipeline-rail__badge--${status}`}>{STAGE_STATUS_LABEL[status]}</em>
                  </span>
                  <span className="pipeline-rail__sub">
                    {running && snapshot.job ? `生成中 · ${formatElapsed(snapshot.job.elapsedMs)}` : subtitle}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="pipeline-rail__foot">
        阶段按顺序解锁：上游确认后才能确认下一阶段，内容永远可以回来再改。
      </p>
    </div>
  );
}
