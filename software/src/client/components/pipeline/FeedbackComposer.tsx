import { useEffect, useRef, useState } from 'react';
import { isPipelineError } from '../../lib/pipeline/http.ts';

/**
 * 「向 AI 提意见」抽屉（UX-SPEC §4.5）：条目 / 块 / 整阶段 / 单章共用同一入口。
 * 后端最小 4 字，前端在 <6 字时给出提示并禁用主按钮（NOTE_TOO_SHORT）。
 */
export function FeedbackComposer({
  open,
  title,
  scopeLabel,
  placeholder,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  scopeLabel: string;
  placeholder?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      window.setTimeout(() => ref.current?.focus(), 30);
    }
  }, [open, scopeLabel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;
  const tooShort = note.trim().length < 6;
  const disabled = busy || submitting || tooShort;

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(note.trim());
      setNote('');
      onClose();
    } catch (err) {
      setError(isPipelineError(err) ? err.message : err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pipeline-drawer" role="dialog" aria-modal="true" aria-label={`给 AI 提意见：${title}`} data-testid="stage-feedback-drawer">
      <div className="pipeline-drawer__bg" onClick={onClose} aria-hidden="true" />
      <aside className="pipeline-drawer__panel">
        <header className="pipeline-drawer__head">
          <div>
            <span className="eyebrow">给 AI 提意见</span>
            <h3>{title}</h3>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="pipeline-drawer__scope">
          <span className="chip chip--static">范围：{scopeLabel}</span>
        </div>
        <label className="pipeline-field">
          <span>你想让 AI 怎么改</span>
          <textarea
            ref={ref}
            className="text-input"
            rows={6}
            value={note}
            placeholder={placeholder || '例如：把主角的动机写得更自私一点，他不想救人，只想拿到父亲留下的账本。'}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="pipeline-drawer__hint">
          {tooShort ? '说清楚一点，AI 才知道往哪改（至少 6 个字）' : `将只重做这一${scopeLabel.includes('阶段') ? '阶段' : '块'}，已锁定的条目不会动。`}
        </p>
        {error ? <p className="pipeline-drawer__error">{error}</p> : null}
        <footer className="pipeline-drawer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button type="button" className="btn btn--primary" data-testid="stage-feedback-submit" onClick={() => void submit()} disabled={disabled}>
            {submitting ? '正在提交…' : '让 AI 按这个改'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
