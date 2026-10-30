import { useState } from 'react';
import { errorCopy } from '../../lib/pipeline/format.ts';

/**
 * 错误卡（UX-SPEC §9.2）：标题说人话 → 影响 → 上下文 → 动作 + 技术详情折叠。
 * 主文案永远不用 502 / The operation was aborted 这类原始信息。
 */
export function ErrorCard({
  code,
  message,
  detail,
  blockers,
  context,
  onRetry,
  onSettings,
  onContinue,
  retryLabel,
  retryable,
}: {
  code: string;
  message?: string;
  detail?: string;
  blockers?: string[];
  context?: string;
  onRetry?: () => void;
  onSettings?: () => void;
  onContinue?: () => void;
  retryLabel?: string;
  retryable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = errorCopy(code);
  const canRetry = retryable ?? copy.retryable;
  const technical = `code=${code}${message ? `\nmessage=${message}` : ''}${context ? `\ncontext=${context}` : ''}${detail ? `\ndetail=${detail}` : ''}`;

  const action = copy.action;
  // 三个分支互斥：先去设置 → 从断点继续 → 原地重试（U23：不再重复两个完全相同的 onRetry 分支）。
  const effective =
    action?.kind === 'settings' && onSettings
      ? { label: action.label, run: onSettings }
      : action?.kind === 'continue' && onContinue
        ? { label: action.label, run: onContinue }
        : onRetry && canRetry
          ? { label: retryLabel || action?.label || '重试这一步', run: onRetry }
          : null;

  const copyTechnical = async () => {
    try {
      await navigator.clipboard.writeText(technical);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="pipeline-error" role="alert" data-testid="plan-error" data-code={code}>
      <div className="pipeline-error__head">
        <span className="pipeline-error__mark" aria-hidden="true">
          !
        </span>
        <div>
          <strong>{copy.title}</strong>
          <p>{copy.hint}</p>
        </div>
      </div>
      {blockers && blockers.length ? (
        <ul className="pipeline-error__blockers">
          {blockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {context ? <p className="pipeline-error__context">{context}</p> : null}
      <div className="pipeline-error__actions">
        {effective ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid={
              action?.kind === 'settings' ? 'plan-error-settings' : code === 'INTERRUPTED' ? 'plan-continue' : 'plan-retry'
            }
            onClick={effective.run}
          >
            {effective.label}
          </button>
        ) : null}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? '收起技术详情' : '技术详情'}
        </button>
        {open ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copyTechnical()}>
            {copied ? '已复制' : '复制诊断信息'}
          </button>
        ) : null}
      </div>
      {open ? <pre className="pipeline-error__detail">{technical}</pre> : null}
    </div>
  );
}
