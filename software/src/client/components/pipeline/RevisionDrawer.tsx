import { useMemo, useState } from 'react';
import type { Revision } from '../../../shared/pipeline.ts';
import { formatDateTime, revisionSourceLabel } from '../../lib/pipeline/format.ts';

function previewOf(revision: Revision): string {
  if (revision.contentKind === 'text') return revision.content.slice(0, 600);
  try {
    const parsed = JSON.parse(revision.content);
    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => value !== '' && value !== null && value !== undefined && !Array.isArray(value))
        .slice(0, 8)
        .map(([key, value]) => `${key}：${String(value).slice(0, 80)}`);
      if (entries.length) return entries.join('\n');
    }
    return JSON.stringify(parsed, null, 2).slice(0, 600);
  } catch {
    return revision.content.slice(0, 600);
  }
}

/** 修订历史（UX-SPEC §4.7）：只看不改，恢复会生成一条新修订，不删历史。 */
export function RevisionDrawer({
  open,
  title,
  revisions,
  loading,
  busy,
  onClose,
  onRestore,
}: {
  open: boolean;
  title: string;
  revisions: Revision[];
  loading?: boolean;
  busy?: boolean;
  onClose: () => void;
  onRestore: (revisionId: string) => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useMemo(() => revisions.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [revisions]);

  if (!open) return null;

  return (
    <div className="pipeline-drawer" role="dialog" aria-modal="true" aria-label={`修订历史：${title}`} data-testid="item-history-drawer">
      <div className="pipeline-drawer__bg" onClick={onClose} aria-hidden="true" />
      <aside className="pipeline-drawer__panel">
        <header className="pipeline-drawer__head">
          <div>
            <span className="eyebrow">修订历史</span>
            <h3>{title}</h3>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        {loading ? (
          <p className="pipeline-drawer__hint">正在读取历史…</p>
        ) : list.length === 0 ? (
          <div className="pipeline-empty">
            <strong>还没有修改记录</strong>
            <p>AI 生成、你编辑或确认后，这里会记录每一条修订。</p>
          </div>
        ) : (
          <ol className="pipeline-history">
            {list.map((revision) => (
              <li key={revision.id} className="pipeline-history__row">
                <div className="pipeline-history__head">
                  <span className={`tag ${revision.source === 'manual' ? 'tag--accent' : ''}`}>{revisionSourceLabel(revision.source)}</span>
                  <span className="pipeline-history__time">{formatDateTime(revision.createdAt)}</span>
                  {revision.note ? <span className="pipeline-history__note">{revision.note}</span> : null}
                </div>
                <button
                  type="button"
                  className="pipeline-history__toggle"
                  onClick={() => setExpanded((value) => (value === revision.id ? null : revision.id))}
                  aria-expanded={expanded === revision.id}
                >
                  {expanded === revision.id ? '收起内容' : '看这一版写了什么'}
                </button>
                {expanded === revision.id ? <pre className="pipeline-history__content">{previewOf(revision)}</pre> : null}
                <div className="pipeline-history__actions">
                  {armed === revision.id ? (
                    <>
                      <span className="pipeline-history__warn">恢复会用这一版覆盖当前内容，并记一条新修订。</span>
                      <button
                        type="button"
                        className="btn btn--primary btn--tiny"
                        data-testid="item-history-restore-confirm"
                        disabled={busy}
                        onClick={() => {
                          setArmed(null);
                          onRestore(revision.id);
                        }}
                      >
                        确认恢复
                      </button>
                      <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setArmed(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--ghost btn--tiny" data-testid="item-history-restore" onClick={() => setArmed(revision.id)}>
                      恢复到此版本
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
