import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PipelineItem } from '../../../shared/pipeline.ts';
import { ACT_FUNCTIONS, ENV_TYPES, unitLabel, type ProjectKind } from '../../lib/pipeline/format.ts';

type FieldType = 'text' | 'textarea' | 'select' | 'tags' | 'number';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  rows?: number;
}

function fieldsFor(kind: string): FieldDef[] {
  switch (kind) {
    case 'world':
      return [
        { key: 'era', label: '时代地点', type: 'text' },
        { key: 'tone', label: '基调母题', type: 'text' },
        { key: 'language', label: '语言习惯', type: 'text' },
        { key: 'worldRules', label: '世界规则', type: 'textarea', rows: 5 },
      ];
    case 'env':
      return [
        { key: 'name', label: '环境名', type: 'text' },
        { key: 'type', label: '类型', type: 'select', options: ENV_TYPES },
        { key: 'mood', label: '一句话气质', type: 'text' },
        { key: 'reason', label: '为什么需要它', type: 'textarea', rows: 3 },
      ];
    case 'character':
      return [
        { key: 'name', label: '姓名', type: 'text' },
        { key: 'role', label: '身份', type: 'text' },
        { key: 'age', label: '年龄', type: 'text' },
        { key: 'motivation', label: '想要什么', type: 'textarea', rows: 3 },
        { key: 'personality', label: '性格', type: 'textarea', rows: 3 },
        { key: 'secret', label: '秘密', type: 'textarea', rows: 3 },
        { key: 'tags', label: '标签', type: 'tags' },
      ];
    case 'act':
    case 'beat_group':
      return [
        { key: 'title', label: '标题', type: 'text' },
        { key: 'function', label: '功能', type: 'select', options: ACT_FUNCTIONS },
        { key: 'summary', label: '这一段发生什么', type: 'textarea', rows: 4 },
        { key: 'characters', label: '出场人物（逗号分隔）', type: 'tags' },
      ];
    case 'beat':
      return [
        { key: 'title', label: '节拍标题', type: 'text' },
        { key: 'function', label: '功能', type: 'text' },
        { key: 'summary', label: '这一段发生什么', type: 'textarea', rows: 4 },
        { key: 'plannedChapters', label: '预计占几章', type: 'number' },
        { key: 'foreshadow', label: '埋的伏笔', type: 'text' },
      ];
    default:
      return [];
  }
}

function summaryLine(item: PipelineItem, kind: ProjectKind): string {
  const payload = item.payload || {};
  const text = (key: string) => (typeof payload[key] === 'string' ? String(payload[key]) : '');
  switch (item.kind) {
    case 'world':
      return [text('era'), text('tone')].filter(Boolean).join(' · ');
    case 'env':
      return [text('type'), text('mood')].filter(Boolean).join(' · ');
    case 'character':
      return [text('role'), text('age')].filter(Boolean).join(' · ');
    case 'act':
    case 'beat_group':
      return [text('function'), text('summary').slice(0, 60)].filter(Boolean).join(' · ');
    case 'beat':
      return [text('function'), text('summary').slice(0, 60)].filter(Boolean).join(' · ');
    default:
      return text('summary').slice(0, 60) || unitLabel(kind);
  }
}

function chipsOf(item: PipelineItem): string[] {
  const payload = item.payload || {};
  if (Array.isArray(payload.tags)) return payload.tags.map(String).filter(Boolean).slice(0, 4);
  if (Array.isArray(payload.characters)) return payload.characters.map(String).filter(Boolean).slice(0, 4);
  return [];
}

/**
 * 条目卡（P1/P2 通用）：摘要态 ↔ 编辑态原地切换，整卡原子保存。
 * 锁定后块级/整份重生成会跳过它（服务端保证），所以锁定按钮放在卡片操作里。
 */
export function ItemCard({
  item,
  kind,
  busy,
  regenerating,
  onSave,
  onRegen,
  onFeedback,
  onHistory,
  onLock,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  children,
  depth,
}: {
  item: PipelineItem;
  kind: ProjectKind;
  busy?: boolean;
  regenerating?: boolean;
  onSave: (patch: { title?: string; payload?: Record<string, unknown> }) => Promise<void>;
  onRegen: () => void;
  onFeedback: () => void;
  onHistory: () => void;
  onLock: (locked: boolean) => void;
  /** SPEC M3：条目可删、可排序。没传回调的条目（例如世界观单条）不显示按钮。 */
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  children?: ReactNode;
  depth?: number;
}) {
  const fields = useMemo(() => fieldsFor(item.kind), [item.kind]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft({});
  }, [editing, item.id, item.updatedAt]);

  const openEditor = () => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const value = item.payload?.[field.key];
      next[field.key] =
        value === undefined || value === null
          ? field.key === 'title'
            ? item.title || ''
            : ''
          : Array.isArray(value)
            ? value.join('、')
            : String(value);
    }
    if (item.kind === 'character') {
      // 服务端 characters 表把性格存在 description 列，编辑表单里叫「性格」。
      next.personality = String(item.payload?.personality ?? item.payload?.description ?? '');
    }
    setDraft(next);
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.key === 'title') continue;
      const value = draft[field.key] ?? '';
      if (field.type === 'tags') {
        payload[field.key] = value
          .split(/[、,，\s]+/)
          .map((entry) => entry.trim())
          .filter(Boolean);
      } else if (field.type === 'number') {
        // U17：空输入 ≠ 0。“预计占几章”留空时，以前会写进一个 0（还悄悄覆盖 AI 的判断）；
        // 现在留空就不提交这个字段，让服务端保留原值。
        const raw = String(value).trim();
        if (!raw) continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          setError(`「${field.label}」要填数字`);
          setSaving(false);
          return;
        }
        payload[field.key] = parsed;
      } else {
        payload[field.key] = value;
      }
    }
    // 人物的 payload 用 personality 存性格（服务端 whitelist 的名字是这个），读取时字段是 description。
    if (item.kind === 'character' && item.payload?.description !== undefined) {
      payload.personality = draft.personality ?? String(item.payload.description || '');
    }
    if (item.kind === 'world' && payload.worldRules === '') payload.worldRulesNotNeeded = true;
    try {
      await onSave({ title: draft.title || item.title, payload });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const chips = chipsOf(item);
  const protagonist = item.kind === 'character' && Boolean(item.payload?.isProtagonist);

  return (
    <div
      className={`pipeline-item${editing ? ' is-editing' : ''}${item.locked ? ' is-locked' : ''}${regenerating ? ' is-regenerating' : ''}${protagonist ? ' is-protagonist' : ''}`}
      data-testid="item-card"
      data-kind={item.kind}
      data-id={item.id}
      data-locked={item.locked ? 'true' : 'false'}
      data-regenerating={regenerating ? 'true' : undefined}
      style={depth ? { marginLeft: 0 } : undefined}
    >
      {regenerating ? <div className="pipeline-item__progress" aria-hidden="true" /> : null}
      {editing ? (
        <div className="pipeline-item__editor">
          <div className="pipeline-item__editor-head">
            <strong>编辑{kind === 'short' && item.kind === 'beat' ? '节拍' : ''}条目</strong>
            {error ? <span className="pipeline-item__error">{error}</span> : null}
          </div>
          <div className="pipeline-item__fields">
            {fields.map((field) => (
              <label key={field.key} className={`pipeline-field pipeline-field--${field.type}`}>
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    className="text-input"
                    rows={field.rows || 3}
                    value={draft[field.key] ?? ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  />
                ) : field.type === 'select' ? (
                  <select
                    className="text-input"
                    value={draft[field.key] ?? ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  >
                    <option value="">未选择</option>
                    {(field.options || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="text-input"
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={draft[field.key] ?? ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="pipeline-item__editor-actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void commit()} disabled={saving} data-testid="item-edit-save">
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)} disabled={saving} data-testid="item-edit-cancel">
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pipeline-item__head">
            <div className="pipeline-item__title">
              {protagonist ? <span className="pipeline-item__star" aria-label="主角">★</span> : null}
              <strong>{item.title || '未命名'}</strong>
              {item.locked ? <span className="pipeline-item__lock" aria-label="已锁定">🔒</span> : null}
              {item.revisionCount > 1 ? <span className="pipeline-item__rev">{item.revisionCount} 个版本</span> : null}
            </div>
            <div className="pipeline-item__actions">
              {onMoveUp ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--tiny"
                  data-testid="item-move-up"
                  title="上移"
                  aria-label="上移"
                  onClick={onMoveUp}
                  disabled={busy || !canMoveUp}
                >
                  ↑
                </button>
              ) : null}
              {onMoveDown ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--tiny"
                  data-testid="item-move-down"
                  title="下移"
                  aria-label="下移"
                  onClick={onMoveDown}
                  disabled={busy || !canMoveDown}
                >
                  ↓
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost btn--tiny" data-testid="item-edit" onClick={openEditor} disabled={busy || item.locked}>
                编辑
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" data-testid="item-regen" onClick={onRegen} disabled={busy || item.locked}>
                重生成
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" data-testid="item-feedback" onClick={onFeedback} disabled={busy}>
                提意见
              </button>
              <button type="button" className="btn btn--ghost btn--tiny" data-testid="item-history" onClick={onHistory}>
                历史
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--tiny"
                data-testid="item-lock"
                data-locked={item.locked ? 'true' : 'false'}
                onClick={() => onLock(!item.locked)}
                disabled={busy}
              >
                {item.locked ? '解锁' : '锁定'}
              </button>
              {onDelete ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--tiny"
                  data-testid="item-delete"
                  onClick={onDelete}
                  disabled={busy || item.locked}
                  title={item.locked ? '已锁定，先解锁再删' : '删除这一条'}
                >
                  删除
                </button>
              ) : null}
            </div>
          </div>
          <p className="pipeline-item__summary">{summaryLine(item, kind)}</p>
          {chips.length ? (
            <div className="pipeline-item__chips">
              {chips.map((chip) => (
                <span key={chip} className="chip chip--static">
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
      {children}
    </div>
  );
}
