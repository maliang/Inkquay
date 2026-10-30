import { useEffect, useRef, useState } from 'react';
import type { JobView, StageKey } from '../../../shared/pipeline.ts';
import { formatElapsed } from '../../lib/pipeline/format.ts';

export const STEP_BY_STAGE: Record<StageKey, string> = {
  p1: 'setting',
  p2: 'outline',
  p3: 'chapter-plan',
  p4: 'writing',
};

export const STAGE_JOB_LABEL: Record<StageKey, string> = {
  p1: '正在生成设定…',
  p2: '正在生成故事大纲…',
  p3: '正在生成章节计划…',
  p4: '正在写作…',
};

/**
 * U7：job 的真实状态映射到进度条的四态（SPEC §11 只认 running|done|failed|cancelled）。
 * interrupted 不是「完成」——它需要用户从断点继续，所以归到 failed 并在文案里说明。
 */
function stateOf(job: JobView | null): 'running' | 'done' | 'failed' | 'cancelled' {
  if (!job) return 'done';
  if (job.state === 'failed' || job.state === 'interrupted') return 'failed';
  if (job.state === 'cancelled') return 'cancelled';
  if (job.state === 'done') return 'done';
  return 'running';
}

/**
 * 企划/生成的进度条（SPEC §11 `plan-progress`）。
 * 计时本地每秒递增，服务端每 2 秒对账；只允许前进、不倒退（UX-SPEC §7.4）。
 */
export function JobBar({
  job,
  label,
  onCancel,
  cancelling,
  compact,
}: {
  job: JobView | null;
  label?: string;
  onCancel?: () => void;
  cancelling?: boolean;
  compact?: boolean;
}) {
  const startedAt = job?.startedAt ? new Date(job.startedAt.includes('T') ? job.startedAt : job.startedAt.replace(' ', 'T')).getTime() : 0;
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  const shown = useRef(elapsed);

  useEffect(() => {
    const base = startedAt || Date.now();
    const tick = () => {
      const next = Math.max(shown.current, Date.now() - base);
      shown.current = next;
      setElapsed(next);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const state = stateOf(job);
  const stage = job?.stage;
  const step = stage ? STEP_BY_STAGE[stage] : undefined;
  const seconds = Math.round(elapsed / 1000);
  const slow = state === 'running' && seconds >= 60;
  const primary =
    job?.state === 'interrupted'
      ? '上次的生成被中断了，可以继续'
      : job?.state === 'cancelled'
        ? '已取消这一步'
        : label || (stage ? STAGE_JOB_LABEL[stage] : '正在生成…');

  const detail =
    job && state === 'running'
      ? stage === 'p4' && job.unitsTotal
        ? `第 ${Math.min(job.unitsDone + 1, job.unitsTotal)}/${job.unitsTotal} ${job.unit === 'beat' ? '个节拍' : '章'} · ${formatElapsed(elapsed)}`
        : job.stepTotal
          ? `${job.stepIndex}/${job.stepTotal} 步 · ${formatElapsed(elapsed)}`
          : formatElapsed(elapsed)
      : '';

  return (
    <div
      className={`pipeline-jobbar${compact ? ' pipeline-jobbar--compact' : ''}${slow ? ' is-slow' : ''}`}
      data-testid="plan-progress"
      data-state={state}
      data-step={step || (stage === 'p4' ? 'writing' : 'setting')}
      data-elapsed={seconds}
    >
      <div className="pipeline-jobbar__dot" aria-hidden="true" />
      <div className="pipeline-jobbar__text" role="status" aria-live="polite">
        <strong>{primary}</strong>
        {detail ? <span className="pipeline-jobbar__meta" aria-hidden="true"> · {detail}</span> : null}
        {slow ? <span className="pipeline-jobbar__warn"> · 比平时久，还在等（模型可能较慢）</span> : null}
      </div>
      <div className="pipeline-jobbar__actions">
        {onCancel ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="plan-cancel"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? '正在取消…' : '取消'}
          </button>
        ) : null}
      </div>
      {seconds >= 15 && state === 'running' ? (
        <p className="pipeline-hint">生成通常需要 20–60 秒 · 可以先离开，作品已经保存</p>
      ) : null}
    </div>
  );
}
