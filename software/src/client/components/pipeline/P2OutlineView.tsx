import { useState } from 'react';
import type { PipelineItem, StageViewStatus } from '../../../shared/pipeline.ts';
import { actLabel, type ProjectKind } from '../../lib/pipeline/format.ts';
import { ItemCard } from './ItemCard.tsx';

export interface OutlineActions {
  busy?: boolean;
  regeneratingId?: string | null;
  onSave: (item: PipelineItem, patch: { title?: string; payload?: Record<string, unknown> }) => Promise<void>;
  onRegen: (item: PipelineItem) => void;
  onFeedback: (item: PipelineItem) => void;
  onHistory: (item: PipelineItem) => void;
  onLock: (item: PipelineItem, locked: boolean) => void;
  onDelete: (item: PipelineItem) => void;
  /** 新增一幕/节拍组，或给某一幕新增节拍（SPEC M3） */
  onAddGroup: () => void;
  onAddBeat: (group: PipelineItem) => void;
  /** 排序：同一层内上移/下移。 */
  onMoveGroup: (group: PipelineItem, delta: -1 | 1) => void;
  onMoveBeat: (beat: PipelineItem, group: PipelineItem, delta: -1 | 1) => void;
  onActRegen: (act: PipelineItem) => void;
  onActFeedback: (act: PipelineItem) => void;
}

/** 阶段 2 · 故事大纲：幕/节拍组 → 节拍两级（短篇把「幕」换成「节拍组」）。 */
export function P2OutlineView({
  kind,
  items,
  status,
  premise,
  actions,
}: {
  kind: ProjectKind;
  items: PipelineItem[];
  status: StageViewStatus;
  premise: string;
  actions: OutlineActions;
}) {
  // U14：节拍「移动到另一幕/节拍组」在 V1 是明确降级的能力——
  // 服务端 reorderItems 只接受「同一幕内节拍 id 的完整排列」（assertPermutation），
  // 节拍的 payload 里也没有可改写的 actId/groupId 白名单字段。
  // 所以这里不做假按钮：点开只说清楚为什么不能、以及现在怎么做。
  const [moveHintFor, setMoveHintFor] = useState<string | null>(null);
  const groupKind = kind === 'short' ? 'beat_group' : 'act';
  const groups = items.filter((item) => item.kind === groupKind);
  const beats = items.filter((item) => item.kind === 'beat');
  const readOnly = status === 'generating';

  const card = (
    item: PipelineItem,
    options: {
      depth?: number;
      children?: React.ReactNode;
      extra?: React.ReactNode;
      move?: { index: number; total: number; onUp: () => void; onDown: () => void };
    },
  ) => (
    <ItemCard
      key={item.id}
      item={item}
      kind={kind}
      busy={actions.busy || readOnly}
      regenerating={actions.regeneratingId === item.id}
      onSave={(patch) => actions.onSave(item, patch)}
      onRegen={() => actions.onRegen(item)}
      onFeedback={() => actions.onFeedback(item)}
      onHistory={() => actions.onHistory(item)}
      onLock={(locked) => actions.onLock(item, locked)}
      onDelete={() => actions.onDelete(item)}
      onMoveUp={options.move ? options.move.onUp : undefined}
      onMoveDown={options.move ? options.move.onDown : undefined}
      canMoveUp={Boolean(options.move && options.move.index > 0)}
      canMoveDown={Boolean(options.move && options.move.index < options.move.total - 1)}
      depth={options.depth}
    >
      {options.children}
      {options.extra}
    </ItemCard>
  );

  return (
    <div className="pipeline-p2">
      <div className="pipeline-mainline">
        <span className="eyebrow">主线一句话</span>
        <p>{premise || '还没有写简介。可以回到作品设置里补一句，AI 会用它来对齐大纲。'}</p>
      </div>

      <div className="pipeline-block__actions pipeline-outline-toolbar">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="act-add"
          disabled={actions.busy || readOnly}
          onClick={actions.onAddGroup}
        >
          新增一{actLabel(kind)}
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="pipeline-empty">
          <strong>还没有大纲</strong>
          <p>大纲会把设定拆成一件件可写的事件。也可以手动新增一{actLabel(kind)}，再往里加节拍。</p>
        </div>
      ) : null}

      {groups.map((group, index) => {
        const children = beats.filter((beat) => (kind === 'short' ? beat.payload?.groupId === group.id : beat.payload?.actId === group.id));
        return (
          <section key={group.id} className="pipeline-block" data-block={`${groupKind}-${index + 1}`}>
            <header className="pipeline-block__head">
              <div>
                <h3>
                  第 {index + 1} {actLabel(kind)}
                  <em>{children.length} 个节拍</em>
                </h3>
              </div>
              <div className="pipeline-block__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="beat-add"
                  disabled={actions.busy || readOnly}
                  onClick={() => actions.onAddBeat(group)}
                >
                  新增节拍
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="act-regen"
                  disabled={actions.busy}
                  onClick={() => actions.onActRegen(group)}
                >
                  重生成这一{actLabel(kind)}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={actions.busy} onClick={() => actions.onActFeedback(group)}>
                  {actLabel(kind)}意见
                </button>
              </div>
            </header>
            {card(group, {
              depth: 1,
              move: {
                index,
                total: groups.length,
                onUp: () => actions.onMoveGroup(group, -1),
                onDown: () => actions.onMoveGroup(group, 1),
              },
              children: children.length ? (
                <div className="pipeline-beats">
                  {children.map((beat, beatIndex) =>
                    card(beat, {
                      depth: 2,
                      move: {
                        index: beatIndex,
                        total: children.length,
                        onUp: () => actions.onMoveBeat(beat, group, -1),
                        onDown: () => actions.onMoveBeat(beat, group, 1),
                      },
                      extra:
                        groups.length > 1 ? (
                          <div className="pipeline-beat-move">
                            <button
                              type="button"
                              className="btn btn--tiny btn--ghost"
                              data-testid="beat-move-menu"
                              aria-expanded={moveHintFor === beat.id}
                              onClick={() => setMoveHintFor(moveHintFor === beat.id ? null : beat.id)}
                            >
                              移动到…
                            </button>
                            {moveHintFor === beat.id ? (
                              <p className="pipeline-hint" data-testid="beat-move-hint">
                                V1 还不支持跨{actLabel(kind)}移动节拍：服务端排序只接受同一{actLabel(kind)}内的完整节拍集合，
                                节拍的归属字段也还没开放改写。现在可以这样做：在目标{actLabel(kind)}里「新增节拍」把内容抄过去，
                                再删掉这一条（历史会留在这一条上）。
                              </p>
                            ) : null}
                          </div>
                        ) : null,
                    }),
                  )}
                </div>
              ) : (
                <p className="pipeline-empty--line">这一{actLabel(kind)}还没有节拍，点上面的「新增节拍」补一个。</p>
              ),
            })}
          </section>
        );
      })}
    </div>
  );
}
