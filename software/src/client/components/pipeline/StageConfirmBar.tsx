import { useState } from 'react';
import type { StageKey, StageViewStatus } from '../../../shared/pipeline.ts';
import { formatClock, stageMeta, type ProjectKind } from '../../lib/pipeline/format.ts';

/**
 * 阶段确认条（UX-SPEC §4.6）：确认是唯一的「进入下一阶段」闸门。
 * 门槛不满足时按钮仍然渲染（disabled），并把原因列出来，点击 blocker 可滚到对应块。
 */
export function StageConfirmBar({
  stage,
  kind,
  status,
  locked,
  blockedBy,
  blockers,
  busy,
  confirmedAt,
  onConfirm,
  onSkip,
  onJumpBlocker,
}: {
  stage: StageKey;
  kind: ProjectKind;
  status: StageViewStatus;
  locked: boolean;
  blockedBy?: string;
  blockers: string[];
  busy?: boolean;
  confirmedAt?: string | null;
  onConfirm: () => void;
  onSkip: () => void;
  onJumpBlocker?: (blocker: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [skipArmed, setSkipArmed] = useState(false);
  const meta = stageMeta(kind, stage);
  const disabled = locked || busy || status === 'generating' || status === 'failed';
  const confirmed = status === 'confirmed';
  const skipped = status === 'skipped';
  // U2：服务端只允许跳过设定阶段（actions.skipStage 对 p2/p3 直接 400），
  // 所以这里也只在该阶段渲染菜单，避免露出一个点下去必然失败的键。
  const canSkip = stage === 'p1';

  return (
    <div className="pipeline-confirm" data-stage={stage}>
      <div className="pipeline-confirm__status">
        {confirmed ? (
          <>
            <strong>已确认{confirmedAt ? ` · ${formatClock(confirmedAt)}` : ''}</strong>
            <span>改动内容会重新回到「待确认」，不会自动放行。</span>
          </>
        ) : skipped ? (
          <>
            <strong>已跳过这一阶段</strong>
            <span>你可以随时回来补内容。</span>
          </>
        ) : (
          <>
            <strong>{locked ? blockedBy || '请先确认上一阶段' : `确认${meta.title}`}</strong>
            <span>{locked ? '阶段要按顺序解锁。' : '确认后进入下一阶段；之后的修改只会把下游标记为待复核。'}</span>
          </>
        )}
      </div>

      <div className="pipeline-confirm__actions">
        {canSkip && menuOpen ? (
          <div className="pipeline-confirm__menu">
            {skipArmed ? (
              <div className="pipeline-confirm__menu-row">
                <span>跳过{meta.title}，我自己写？</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setSkipArmed(false);
                    setMenuOpen(false);
                    onSkip();
                  }}
                  data-testid="stage-skip-confirm"
                >
                  确认跳过
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSkipArmed(false)}>
                  取消
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm" data-testid="stage-skip" onClick={() => setSkipArmed(true)}>
                跳过{meta.title}，我自己写
              </button>
            )}
          </div>
        ) : null}
        {canSkip ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm pipeline-confirm__more"
            aria-label="更多阶段操作"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            ⋯
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          data-testid="stage-confirm"
          aria-disabled={disabled}
          disabled={disabled}
          onClick={onConfirm}
        >
          {busy ? '正在确认…' : confirmed ? '已确认' : `确认${meta.title}`}
        </button>
      </div>

      {blockers.length ? (
        <ul className="pipeline-confirm__blockers" data-testid="stage-confirm-blockers">
          {blockers.map((blocker) => (
            <li key={blocker}>
              <button type="button" className="pipeline-confirm__blocker" onClick={() => onJumpBlocker?.(blocker)}>
                {blocker}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
