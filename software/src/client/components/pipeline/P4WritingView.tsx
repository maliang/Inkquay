import { useMemo, useState } from 'react';
import type { JobView, StageViewStatus } from '../../../shared/pipeline.ts';
import type { PipelineUnit } from '../../lib/pipeline/api.ts';
import { errorCopy, formatElapsed, formatWords, reviewStatusLabel, unitLabel, type ProjectKind } from '../../lib/pipeline/format.ts';

type Phase = 'idle' | 'running' | 'pause-requested' | 'paused' | 'stopping' | 'stopped' | 'done' | 'failed';

const TERMINAL = ['approved', 'approved_manual', 'skipped', 'in_review'];

/** 阶段 4 · 逐章写作（短篇：逐节拍写作）：连续写作 + 进度 + 暂停/继续 + 单章重写。 */
export function P4WritingView({
  kind,
  status,
  units,
  job,
  lastJob,
  busy,
  planConfirmed,
  onStart,
  onStartSingle,
  onContinue,
  onPause,
  onStop,
  onRewrite,
  onReview,
  onRetry,
}: {
  kind: ProjectKind;
  status: StageViewStatus;
  units: PipelineUnit[];
  job: JobView | null;
  lastJob: JobView | null;
  busy: boolean;
  /** U5：上一步（章节计划/节拍计划）是否已确认——没确认时开始写作必然被服务端拒绝，前端先挡住。 */
  planConfirmed: boolean;
  onStart: () => void;
  onStartSingle: (unitId: string) => void;
  onContinue: () => void;
  onPause: () => void;
  onStop: () => void;
  onRewrite: (unitId: string) => void;
  onReview: (unitId: string) => void;
  onRetry: (unitId: string) => void;
}) {
  const label = unitLabel(kind);
  const isShort = kind === 'short';
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_review' | 'approved' | 'changes_requested'>('all');
  const active = job || lastJob;
  const running = active?.state === 'running' || active?.state === 'pausing' || active?.state === 'queued';
  const doneUnits = units.filter((unit) => ['approved', 'approved_manual', 'skipped'].includes(unit.reviewStatus));
  const inReviewUnits = units.filter((unit) => unit.reviewStatus === 'in_review');
  const pendingUnits = units.filter((unit) => !TERMINAL.includes(unit.reviewStatus));
  const words = units.reduce((sum, unit) => sum + (unit.words || 0), 0);

  const phase: Phase = useMemo(() => {
    if (running) return active?.state === 'pausing' ? 'pause-requested' : 'running';
    if (active?.state === 'paused') return 'paused';
    if (active?.state === 'interrupted') return 'paused';
    if (active?.state === 'cancelled') return 'stopped';
    if (units.length > 0 && pendingUnits.length === 0) return 'done';
    if (active?.state === 'done' && inReviewUnits.length > 0) return 'done';
    return 'idle';
  }, [active, inReviewUnits.length, pendingUnits.length, running, units.length]);

  const dataState: 'idle' | 'running' | 'paused' | 'interrupted' =
    phase === 'running' || phase === 'pause-requested'
      ? 'running'
      : active?.state === 'interrupted'
        ? 'interrupted'
        : phase === 'paused' || phase === 'stopped'
          ? 'paused'
          : 'idle';

  const interruptedJob = lastJob && lastJob.state === 'interrupted' ? lastJob : null;
  const failedUnit = active?.failedUnitNo ? units.find((unit) => unit.ordinal === active.failedUnitNo) : null;
  const percent = units.length ? Math.round(((active?.unitsDone ?? doneUnits.length) / units.length) * 100) : 0;

  const rows = units.filter((unit) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return !TERMINAL.includes(unit.reviewStatus);
    return unit.reviewStatus === filter;
  });

  return (
    <div className="pipeline-p4">
      <div className="pipeline-writebar" data-testid="write-control" data-state={dataState} data-phase={phase} data-pause-pending={active?.pausePending ? 'true' : 'false'} data-failed-chapter={failedUnit ? String(failedUnit.ordinal) : ''}>
        <div className="pipeline-writebar__status">
          {phase === 'running' ? (
            <>
              <strong>
                {active?.currentUnitNo ? `正在写第 ${active.currentUnitNo}/${units.length} ${label}` : '正在写作'}
                {active?.currentUnitTitle ? `《${active.currentUnitTitle}》` : ''}
              </strong>
              <span>
                {active?.currentUnitWords ? `已 ${formatWords(active.currentUnitWords)} · ` : ''}已用 {formatElapsed(active?.elapsedMs ?? 0)}
              </span>
            </>
          ) : phase === 'pause-requested' ? (
            <strong>本章写完后暂停</strong>
          ) : phase === 'paused' ? (
            <strong>{interruptedJob ? '上次写作被中断' : '已暂停'} · {doneUnits.length}/{units.length} {label}已完成</strong>
          ) : phase === 'stopped' ? (
            <strong>已停止 · 当前{label}未完成正文已丢弃</strong>
          ) : phase === 'done' ? (
            <strong>全部 {units.length} {label}已写完 · 待审阅 {inReviewUnits.length} {label}</strong>
          ) : (
            <strong>{units.length ? `待写 ${pendingUnits.length} ${label}，AI 会连续写到最后` : `还没有可写的${label}`}</strong>
          )}
          <div className="pbar pbar--accent" role="progressbar" aria-valuemin={0} aria-valuemax={units.length} aria-valuenow={active?.unitsDone ?? doneUnits.length}>
            <i style={{ width: `${percent}%` }} />
          </div>
          <span className="pipeline-writebar__meta">
            {active?.unitsDone ?? doneUnits.length}/{units.length} {label} · {formatWords(words)} 已写
            {active?.avgUnitMs && doneUnits.length >= 2 ? ` · 平均每${label} ${formatElapsed(active.avgUnitMs)}` : ''}
          </span>
        </div>
        <div className="pipeline-writebar__actions">
          {!planConfirmed && phase === 'idle' ? (
            <span className="pipeline-writebar__hint" data-testid="write-start-hint">
              先确认{isShort ? '节拍计划' : '章节计划'}
            </span>
          ) : null}
          {phase === 'idle' ? (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="write-start"
              disabled={busy || units.length === 0 || !planConfirmed}
              title={!planConfirmed ? `先确认${isShort ? '节拍计划' : '章节计划'}` : undefined}
              onClick={onStart}
            >
              开始连续写作
            </button>
          ) : null}
          {phase === 'running' ? (
            <button type="button" className="btn btn--ghost" data-testid="write-pause" disabled={busy || active?.pausePending} onClick={onPause}>
              {active?.pausePending ? '本章写完后暂停' : '暂停'}
            </button>
          ) : null}
          {phase === 'running' && !active?.pausePending ? (
            <button type="button" className="btn btn--danger" data-testid="write-stop" disabled={busy} onClick={onStop}>
              立即停止
            </button>
          ) : null}
          {phase === 'paused' ? (
            <button type="button" className="btn btn--primary" data-testid="write-continue" disabled={busy} onClick={onContinue}>
              继续写作
            </button>
          ) : null}
          {phase === 'stopped' ? (
            // 停止（user_cancel）之后不能「继续」：那是另一条语义，只能重新开始写作。
            <button
              type="button"
              className="btn btn--primary"
              data-testid="write-restart"
              disabled={busy || units.length === 0 || !planConfirmed}
              onClick={onStart}
            >
              重新开始写作
            </button>
          ) : null}
          {phase === 'done' && inReviewUnits.length ? (
            <button type="button" className="btn btn--primary" data-testid="write-review" onClick={() => onReview(inReviewUnits[0].id)}>
              开始逐{label}审阅
            </button>
          ) : null}
          {failedUnit ? (
            <button type="button" className="btn btn--ghost" data-testid="write-retry-failed" onClick={() => onRetry(failedUnit.id)}>
              重试第 {failedUnit.ordinal} {label}
            </button>
          ) : null}
        </div>
      </div>

      {interruptedJob && phase === 'paused' ? (
        <div className="pipeline-banner" data-state="interrupted" data-testid="write-interrupted">
          <div>
            <strong>上次{isShort ? '逐节拍' : '逐章'}写作被中断</strong>
            <p>
              已完成 {doneUnits.length} {label}的内容都保留着，可以从断点继续，不会从头重写。
            </p>
          </div>
          <div className="pipeline-banner__actions">
            {/* 锚点与 PipelineBanner 的中断横幅分开，避免 plan-continue 全站重复 */}
            <button type="button" className="btn btn--primary btn--sm" data-testid="write-resume" disabled={busy} onClick={onContinue}>
              恢复写作
            </button>
          </div>
        </div>
      ) : null}

      {active?.error && phase !== 'running' ? (
        <div className="pipeline-inline-error">
          {errorCopy(active.error.code || 'PROVIDER_ERROR').title}
          {failedUnit ? `：第 ${failedUnit.ordinal} ${label}没写成，其余${label}可以继续。` : ''}
        </div>
      ) : null}

      <div className="pipeline-filters">
        {(
          [
            ['all', `全部 ${units.length}`],
            ['pending', `待写 ${pendingUnits.length}`],
            ['in_review', `待审阅 ${inReviewUnits.length}`],
            ['approved', `已通过 ${doneUnits.filter((unit) => unit.reviewStatus !== 'skipped').length}`],
            ['changes_requested', `需修改 ${units.filter((unit) => unit.reviewStatus === 'changes_requested').length}`],
          ] as Array<[typeof filter, string]>
        ).map(([key, text]) => (
          <button key={key} type="button" className="chip" data-active={filter === key} onClick={() => setFilter(key)}>
            {text}
          </button>
        ))}
      </div>

      {units.length === 0 ? (
        <div className="pipeline-empty">
          <strong>还没有{isShort ? '节拍' : '章节'}</strong>
          <p>{status === 'confirmed' ? `先在上一阶段确认${label}计划，再回到这里开始写。` : `先确认${label}计划，才能开始写。`}</p>
        </div>
      ) : null}

      <ol className="pipeline-units">
        {rows.map((unit) => {
          const isCurrent = active?.currentUnitId === unit.id;
          const failed = active?.failedUnitNo === unit.ordinal && !unit.hasContent && unit.reviewStatus === 'pending';
          return (
            <li
              key={unit.id}
              className={`pipeline-unit${isCurrent ? ' is-current' : ''}${failed ? ' is-failed' : ''}`}
              data-testid={isShort ? 'beat-row' : 'chapter-row'}
              data-id={unit.id}
              data-index={unit.ordinal}
              data-status={unit.reviewStatus || 'pending'}
              data-words={unit.words}
              data-queued={running && !isCurrent && unit.reviewStatus === 'pending' ? 'true' : 'false'}
              data-failed={failed ? 'true' : 'false'}
              data-error={failed && active?.error ? active.error.code : undefined}
            >
              <span className="pipeline-unit__no">{unit.ordinal}</span>
              <div className="pipeline-unit__main">
                <strong>{unit.title || `未命名第 ${unit.ordinal} ${label}`}</strong>
                <span className="pipeline-unit__meta">
                  {unit.function || '未标注功能'}
                  {unit.words ? ` · ${formatWords(unit.words)}` : ''}
                  {unit.targetWords ? ` / 目标 ${formatWords(unit.targetWords)}` : ''}
                  {unit.words && unit.minWords && unit.words < unit.minWords ? ' · 偏短' : ''}
                  {unit.words && unit.maxWords && unit.words > unit.maxWords ? ' · 偏长' : ''}
                </span>
              </div>
              <span className={`pipeline-status pipeline-status--${unit.reviewStatus || 'pending'}`} data-status={unit.reviewStatus || 'pending'}>
                {reviewStatusLabel(unit.reviewStatus, kind)} {failed ? '· 失败' : ''}
              </span>
              <div className="pipeline-unit__actions">
                {unit.reviewStatus === 'in_review' ? (
                  <button type="button" className="btn btn--ghost btn--tiny" data-testid="chapter-review-link" onClick={() => onReview(unit.id)}>
                    审阅
                  </button>
                ) : null}
                {unit.hasContent ? (
                  <button type="button" className="btn btn--ghost btn--tiny" data-testid="chapter-rewrite-row" disabled={busy} onClick={() => onRewrite(unit.id)}>
                    重写
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--tiny"
                    data-testid="chapter-write-one"
                    disabled={busy || running}
                    onClick={() => onStartSingle(unit.id)}
                  >
                    {failed ? `重试本${label}` : `立即写本${label}`}
                  </button>
                )}
                {unit.reviewStatus === 'changes_requested' ? (
                  <button type="button" className="btn btn--ghost btn--tiny" disabled={busy} onClick={() => onRewrite(unit.id)}>
                    按意见重写
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {units.length ? <p className="pipeline-foot-note">审阅只在本{label}的写作台里做：流水线这里只提供入口，避免同一按钮出现两处。</p> : null}
    </div>
  );
}
