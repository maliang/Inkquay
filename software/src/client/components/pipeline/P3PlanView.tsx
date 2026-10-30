import { useEffect, useMemo, useState } from 'react';
import type { AllocationPreview, AllocationRow, StageViewStatus } from '../../../shared/pipeline.ts';
import type { PipelineUnit, PlanSummary } from '../../lib/pipeline/api.ts';
import { FUNCTION_OPTIONS, formatDeviation, formatWords, unitLabel, type ProjectKind } from '../../lib/pipeline/format.ts';

export type PresetKey = 'fast' | 'standard' | 'thick';
const PRESET_LABEL: Record<PresetKey, string> = { fast: '快', standard: '标准', thick: '厚重' };
const MIN_WORD = 300;
const MAX_WORD = 20000;

interface Draft {
  title?: string;
  function?: string;
  synopsis?: string;
  minWords?: number | null;
  targetWords?: number | null;
  maxWords?: number | null;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const WORD_FIELDS = ['minWords', 'targetWords', 'maxWords'] as const;
type WordField = (typeof WORD_FIELDS)[number];

const hasOwn = <T extends object, K extends string>(target: T, key: K): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const WORD_LABEL: Record<WordField, string> = { minWords: '最少字数', targetWords: '目标字数', maxWords: '最多字数' };

/**
 * U4：草稿里「这个字段被改过」与「没改过」必须区分开——
 * `draft.minWords ?? unit.minWords` 会让「清空」静默回落到旧值（用户以为改了、其实没发请求）。
 */
function resolveWords(unit: PipelineUnit, draft: Draft): Record<WordField, number | null> {
  const read = (field: WordField) => (hasOwn(draft, field) ? draft[field] ?? null : unit[field] ?? null);
  return { minWords: read('minWords'), targetWords: read('targetWords'), maxWords: read('maxWords') };
}

/** 阶段 3 · 章节计划（短篇：节拍计划）：可改章数、每章功能/大纲/字数范围。 */
export function P3PlanView({
  kind,
  status,
  units,
  summary,
  busy,
  onPatchUnit,
  onSetCount,
  onPreset,
  onAllocatePreview,
  onAllocateApply,
  onAcceptDeviation,
  onLockUnit,
  onConfirm,
  onReorderUnits,
}: {
  kind: ProjectKind;
  status: StageViewStatus;
  units: PipelineUnit[];
  summary: PlanSummary | null;
  busy: boolean;
  onPatchUnit: (unitId: string, patch: Draft) => Promise<void>;
  onSetCount: (count: number, archiveOrphans: boolean) => Promise<void>;
  onPreset: (preset: PresetKey) => Promise<void>;
  onAllocatePreview: (totalTarget: number) => Promise<AllocationPreview>;
  onAllocateApply: (rows: AllocationRow[]) => Promise<void>;
  onAcceptDeviation: (accepted: boolean) => Promise<void>;
  onLockUnit: (unitId: string, locked: boolean) => Promise<void>;
  onConfirm?: () => void;
  /** SPEC M3：章节/节拍可以排序（ids 是重排后的全部单元顺序）。 */
  onReorderUnits?: (ids: string[]) => Promise<void>;
}) {
  const label = unitLabel(kind);
  const isShort = kind === 'short';
  const [reorderBusy, setReorderBusy] = useState(false);
  const moveUnit = async (index: number, delta: -1 | 1) => {
    if (!onReorderUnits || reorderBusy) return;
    const next = index + delta;
    if (index < 0 || next < 0 || next >= units.length) return;
    const ids = units.map((unit) => unit.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(next, 0, moved);
    setReorderBusy(true);
    try {
      await onReorderUnits(ids);
      setLocalError(null);
    } catch (err) {
      // U3：排序失败必须让用户看到（原来 void 掉，失败是静默未处理的 rejection）。
      setLocalError(`排序失败：${err instanceof Error && err.message ? err.message : '请刷新后再试'}`);
    } finally {
      setReorderBusy(false);
    }
  };
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [countDraft, setCountDraft] = useState<string>(String(units.length));
  const [allocPreview, setAllocPreview] = useState<AllocationPreview | null>(null);
  const [countPreview, setCountPreview] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [countBusy, setCountBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState<PresetKey | null>(null);

  useEffect(() => {
    setCountDraft(String(units.length));
  }, [units.length]);

  const totalTarget = useMemo(() => summary?.totalTarget ?? units.reduce((sum, unit) => sum + (unit.targetWords || 0), 0), [summary, units]);
  const goalWords = summary?.goalWords ?? 0;
  const deviation = summary?.deviationPct ?? (goalWords ? ((totalTarget - goalWords) / goalWords) * 100 : 0);
  const overTolerance = summary?.overTolerance ?? Math.abs(deviation) > 25;
  const accepted = Boolean(summary?.accepted);
  const readOnly = status === 'generating' || busy;

  const patchRow = async (unit: PipelineUnit, draft: Draft) => {
    const words = resolveWords(unit, draft);
    const { minWords: min, targetWords: target, maxWords: max } = words;
    const problems: string[] = [];
    // 清空字数在服务端没有「取消设置」的语义（patchUnit 用 patch.x ?? 旧值），
    // 所以这里明确拦住并给出行内提示，而不是静默回落到旧值。
    for (const field of WORD_FIELDS) {
      if (hasOwn(draft, field) && words[field] === null) problems.push(`${WORD_LABEL[field]}不能留空`);
    }
    if (min !== null && min < MIN_WORD) problems.push(`最少字数不能小于 ${MIN_WORD}`);
    if (max !== null && max > MAX_WORD) problems.push(`最多字数不能大于 ${MAX_WORD}`);
    if (min !== null && target !== null && min > target) problems.push('最少字数不能大于目标字数');
    if (target !== null && max !== null && target > max) problems.push('目标字数不能大于最多字数');
    if (target === 0) problems.push('字数不能是 0');
    if (problems.length) {
      setRowError((prev) => ({ ...prev, [unit.id]: problems[0] }));
      return;
    }
    setRowError((prev) => {
      const next = { ...prev };
      delete next[unit.id];
      return next;
    });
    try {
      // 只回传用户真的改过的字段：把没改的字数一起发上去会把 targetManual 标脏（服务端行为）。
      const payload: Draft = { ...draft };
      for (const field of WORD_FIELDS) if (hasOwn(draft, field) && words[field] !== null) payload[field] = words[field];
      await onPatchUnit(unit.id, payload);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[unit.id];
        return next;
      });
    } catch (err) {
      setRowError((prev) => ({ ...prev, [unit.id]: err instanceof Error ? err.message : '保存失败' }));
    }
  };

  const commitCount = async (archiveOrphans: boolean) => {
    const value = Number(countDraft);
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError('章节数要填一个正整数');
      return;
    }
    setLocalError(null);
    setCountBusy(true);
    try {
      await onSetCount(value, archiveOrphans);
      setCountPreview(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '调整章节数失败');
    } finally {
      setCountBusy(false);
    }
  };

  const previewCount = () => {
    const value = Number(countDraft);
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError('章节数要填一个正整数');
      return;
    }
    setLocalError(null);
    setCountPreview(value);
  };

  const applyPreset = async (preset: PresetKey) => {
    setPresetBusy(preset);
    setLocalError(null);
    try {
      await onPreset(preset);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '应用字数档失败');
    } finally {
      setPresetBusy(null);
    }
  };

  const runAllocate = async () => {
    setLocalError(null);
    try {
      const preview = await onAllocatePreview(goalWords || totalTarget);
      setAllocPreview(preview);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : '分配失败');
    }
  };

  const countDelta = countPreview === null ? 0 : countPreview - units.length;
  const removedUnits = countDelta < 0 ? units.slice(units.length + countDelta) : [];
  const removedWithContent = removedUnits.filter((unit) => unit.hasContent || unit.words > 0);
  const lockedCount = units.filter((unit) => unit.locked).length;

  return (
    <div className="pipeline-p3">
      <div className="pipeline-plan-controls">
        <label className="pipeline-count">
          <span>{label}数</span>
          <input
            type="number"
            className="text-input"
            data-testid="chapter-plan-count"
            value={countDraft}
            min={3}
            max={isShort ? 40 : 200}
            disabled={readOnly || countBusy}
            onChange={(event) => {
              setCountDraft(event.target.value);
              setCountPreview(null);
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="chapter-plan-count-preview-button"
            disabled={readOnly || countBusy}
            onClick={previewCount}
          >
            预览调整
          </button>
        </label>
        <div className="pipeline-presets" role="group" aria-label={`字数档`}>
          {(['fast', 'standard', 'thick'] as PresetKey[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip"
              data-testid="chapter-plan-preset"
              data-preset={preset}
              disabled={readOnly || presetBusy !== null}
              onClick={() => void applyPreset(preset)}
            >
              {presetBusy === preset ? '正在应用…' : isShort && preset === 'fast' ? '极短' : isShort && preset === 'thick' ? '舒展' : PRESET_LABEL[preset]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={readOnly} onClick={() => void runAllocate()}>
          按目标字数分配
        </button>
      </div>

      {countPreview !== null ? (
        <div className="pipeline-inline-panel" data-testid="chapter-plan-count-preview">
          {countDelta === 0 ? (
            <p>{label}数没有变化。</p>
          ) : countDelta > 0 ? (
            <p>
              将新增 {countDelta} {label}（第 {units.length + 1}–{countPreview} {label}），AI 会按大纲补写计划。
            </p>
          ) : (
            <p>
              将从末尾删除 {Math.abs(countDelta)} {label}
              {removedWithContent.length ? `，其中 ${removedWithContent.map((unit) => unit.title || `第 ${unit.ordinal} ${label}`).join('、')} 已有正文（共 ${formatWords(removedWithContent.reduce((sum, unit) => sum + unit.words, 0))}），不能通过减少${label}数删除。` : '。'}
            </p>
          )}
          <div className="pipeline-inline-panel__actions">
            {countDelta < 0 && removedWithContent.length ? (
              <button type="button" className="btn btn--ghost btn--sm" disabled={readOnly || countBusy} onClick={() => void commitCount(true)}>
                只删空白{label}
              </button>
            ) : null}
            {countDelta !== 0 ? (
              <button type="button" className="btn btn--primary btn--sm" data-testid="chapter-plan-count-apply" disabled={readOnly || countBusy} onClick={() => void commitCount(false)}>
                应用并生成
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCountPreview(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {allocPreview ? (
        <div className="pipeline-inline-panel" data-testid="chapter-plan-allocate-preview">
          <p>
            将把 {allocPreview.preview.length} {label}的目标字数合计调整为 {formatWords(allocPreview.totalAfter)}（目标 {formatWords(allocPreview.goalWords)}，偏差 {formatDeviation(allocPreview.deviationPct)}），已锁定或你手改过的{label}默认不动。
          </p>
          <div className="pipeline-inline-panel__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              data-testid="chapter-plan-allocate-apply"
              disabled={readOnly}
              onClick={() => {
                void (async () => {
                  try {
                    await onAllocateApply(allocPreview.preview);
                    setAllocPreview(null);
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : '应用分配失败');
                  }
                })();
              }}
            >
              确认应用
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAllocPreview(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="pipeline-total" data-testid="chapter-plan-total" data-over={overTolerance && !accepted ? 'true' : 'false'}>
        <strong>
          共 {units.length} {label} · 计划 {formatWords(totalTarget)} · 目标 {formatWords(goalWords)} · 偏差 {formatDeviation(deviation)}
          {overTolerance && !accepted ? ' ⚠' : ''}
        </strong>
        {overTolerance && !accepted ? (
          <span className="pipeline-total__warn">
            超出 ±25% 的容差，需要你先接受偏差才能确认计划。
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              data-testid="chapter-plan-accept-deviation"
              disabled={readOnly}
              onClick={() => {
                void onAcceptDeviation(true).catch((err: unknown) => {
                  setLocalError(err instanceof Error ? err.message : '接受偏差失败，请重试');
                });
              }}
            >
              接受偏差
            </button>
          </span>
        ) : null}
        {onConfirm ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="chapter-plan-confirm"
            data-state={status === 'confirmed' ? 'confirmed' : overTolerance && !accepted ? 'blocked' : 'ready'}
            disabled={readOnly || status === 'confirmed' || (overTolerance && !accepted)}
            onClick={onConfirm}
          >
            {status === 'confirmed' ? '计划已确认' : `确认这份${isShort ? '节拍' : '章节'}计划`}
          </button>
        ) : null}
        {accepted ? (
          <span className="pipeline-total__ok">
            偏差已被接受
            <button
              type="button"
              className="btn btn--ghost btn--tiny"
              disabled={readOnly}
              onClick={() => {
                void onAcceptDeviation(false).catch((err: unknown) => {
                  setLocalError(err instanceof Error ? err.message : '撤回偏差失败，请重试');
                });
              }}
            >
              撤回
            </button>
          </span>
        ) : null}
      </div>

      {localError ? <p className="pipeline-inline-error" data-testid="chapter-plan-error">{localError}</p> : null}

      {units.length === 0 ? (
        <div className="pipeline-empty">
          <strong>还没有{isShort ? '节拍' : '章节'}计划</strong>
          <p>{isShort ? '节拍计划决定每个节拍写什么、写多长。' : '章节计划决定每章写什么、写多长。'}</p>
        </div>
      ) : null}

      {units.length ? (
        <table className="pipeline-table" data-kind={isShort ? 'beat-plan' : 'chapter-plan'}>
          <thead>
            <tr>
              <th>#</th>
              <th>{label}标题</th>
              <th>功能</th>
              <th>大纲</th>
              <th>字数（最少 / 目标 / 最多）</th>
              <th>状态</th>
              <th>排序</th>
              <th>锁定</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit, index) => {
              const draft = drafts[unit.id] || {};
              const title = draft.title ?? unit.title;
              const fn = draft.function ?? unit.function ?? '';
              const synopsis = draft.synopsis ?? unit.synopsis ?? '';
              const words = resolveWords(unit, draft);
              const min = words.minWords;
              const target = words.targetWords;
              const max = words.maxWords;
              const testId = isShort ? 'beat-plan-row' : 'chapter-plan-row';
              return (
                <tr
                  key={unit.id}
                  data-testid={testId}
                  data-id={unit.id}
                  data-index={index + 1}
                  data-words-min={min ?? ''}
                  data-words-target={target ?? ''}
                  data-words-max={max ?? ''}
                  data-locked={unit.locked ? 'true' : 'false'}
                  data-words={unit.words}
                >
                  <td className="pipeline-table__no">{index + 1}</td>
                  <td>
                    <input
                      className="text-input"
                      value={title}
                      maxLength={40}
                      disabled={readOnly || unit.locked}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [unit.id]: { ...prev[unit.id], title: event.target.value } }))}
                      onBlur={() => {
                        if (title !== unit.title) void patchRow(unit, { title });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="text-input"
                      value={fn}
                      disabled={readOnly || unit.locked}
                      onChange={(event) => {
                        const next = event.target.value;
                        setDrafts((prev) => ({ ...prev, [unit.id]: { ...prev[unit.id], function: next } }));
                        void patchRow(unit, { function: next });
                      }}
                    >
                      <option value="">未标注</option>
                      {FUNCTION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <textarea
                      className="text-input pipeline-table__synopsis"
                      rows={2}
                      value={synopsis}
                      disabled={readOnly || unit.locked}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [unit.id]: { ...prev[unit.id], synopsis: event.target.value } }))}
                      onBlur={() => {
                        if (synopsis !== (unit.synopsis || '')) void patchRow(unit, { synopsis });
                      }}
                    />
                  </td>
                  <td>
                    <div className="pipeline-words">
                      {WORD_FIELDS.map((field) => {
                        const value = words[field];
                        return (
                          <input
                            key={field}
                            type="number"
                            className="text-input"
                            value={value ?? ''}
                            aria-label={`第 ${index + 1} ${label}${field === 'minWords' ? '最少字数' : field === 'targetWords' ? '目标字数' : '最多字数'}`}
                            disabled={readOnly || unit.locked}
                            onChange={(event) => {
                              const next = numberOrNull(event.target.value);
                              setDrafts((prev) => ({ ...prev, [unit.id]: { ...prev[unit.id], [field]: next } }));
                            }}
                            aria-invalid={rowError[unit.id] ? true : undefined}
                            onBlur={() => {
                              const current = words[field];
                              if (current === null) {
                                setRowError((prev) => ({ ...prev, [unit.id]: `${WORD_LABEL[field]}不能留空（${MIN_WORD}–${MAX_WORD}）` }));
                                return;
                              }
                              const changed =
                                (field === 'minWords' && current !== unit.minWords) ||
                                (field === 'targetWords' && current !== unit.targetWords) ||
                                (field === 'maxWords' && current !== unit.maxWords);
                              if (changed) void patchRow(unit, { [field]: current } as Draft);
                            }}
                          />
                        );
                      })}
                    </div>
                    {rowError[unit.id] ? <span className="pipeline-row-error" data-testid="chapter-plan-row-error">{rowError[unit.id]}</span> : null}
                  </td>
                  <td>
                    <span className="chip chip--static">{unit.hasContent ? '已有正文' : unit.locked ? '已锁定' : '待写'}</span>
                  </td>
                  <td>
                    <div className="pipeline-row-moves">
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        data-testid="unit-move-up"
                        title="上移"
                        aria-label="上移"
                        disabled={readOnly || reorderBusy || index === 0}
                        onClick={() => void moveUnit(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--tiny"
                        data-testid="unit-move-down"
                        title="下移"
                        aria-label="下移"
                        disabled={readOnly || reorderBusy || index === units.length - 1}
                        onClick={() => void moveUnit(index, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--tiny"
                      data-testid="chapter-plan-lock"
                      aria-pressed={unit.locked}
                      disabled={readOnly}
                      onClick={() => void onLockUnit(unit.id, !unit.locked)}
                    >
                      {unit.locked ? '🔒 已锁' : '锁定'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      <p className="pipeline-foot-note">
        锁定或已有正文的{label}不会被「字数档」与「按目标字数分配」改动；共 {lockedCount} {label}已锁定。
      </p>
    </div>
  );
}
