import type { ReactNode } from 'react';
import type { PipelineItem, StageViewStatus } from '../../../shared/pipeline.ts';
import type { ProjectKind } from '../../lib/pipeline/format.ts';
import { ItemCard } from './ItemCard.tsx';

function Block({
  title,
  hint,
  count,
  actions,
  children,
  id,
}: {
  title: string;
  hint?: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="pipeline-block" id={id} data-block={title}>
      <header className="pipeline-block__head">
        <div>
          <h3>
            {title}
            {typeof count === 'number' ? <em>{count}</em> : null}
          </h3>
          {hint ? <p>{hint}</p> : null}
        </div>
        {actions ? <div className="pipeline-block__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export interface StageItemActions {
  onSave: (item: PipelineItem, patch: { title?: string; payload?: Record<string, unknown> }) => Promise<void>;
  onRegen: (item: PipelineItem) => void;
  onFeedback: (item: PipelineItem) => void;
  onHistory: (item: PipelineItem) => void;
  onLock: (item: PipelineItem, locked: boolean) => void;
  onBlockRegen: (block: 'world' | 'env' | 'characters') => void;
  onBlockFeedback: (block: 'world' | 'env' | 'characters') => void;
  /** SPEC M3：条目新增 / 删除 / 排序 */
  onAdd: (block: 'env' | 'characters') => void;
  onDelete: (item: PipelineItem) => void;
  onMove: (item: PipelineItem, block: 'env' | 'characters', delta: -1 | 1) => void;
  regeneratingId?: string | null;
  busy?: boolean;
}

/** 阶段 1 · 设定：世界观（1 条）+ 环境 + 人物。 */
export function P1SettingView({
  kind,
  items,
  status,
  actions,
}: {
  kind: ProjectKind;
  items: PipelineItem[];
  status: StageViewStatus;
  actions: StageItemActions;
}) {
  const world = items.find((item) => item.kind === 'world');
  const envs = items.filter((item) => item.kind === 'env');
  const characters = items.filter((item) => item.kind === 'character');
  const readOnly = status === 'generating';

  const card = (item: PipelineItem, move?: { block: 'env' | 'characters'; index: number; total: number }) => (
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
      onDelete={move ? () => actions.onDelete(item) : undefined}
      onMoveUp={move ? () => actions.onMove(item, move.block, -1) : undefined}
      onMoveDown={move ? () => actions.onMove(item, move.block, 1) : undefined}
      canMoveUp={Boolean(move && move.index > 0)}
      canMoveDown={Boolean(move && move.index < move.total - 1)}
    />
  );

  const addButton = (block: 'env' | 'characters', labelText: string) => (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      data-testid={`stage-block-add-${block}`}
      disabled={actions.busy || readOnly}
      onClick={() => actions.onAdd(block)}
    >
      {labelText}
    </button>
  );

  const blockAction = (block: 'world' | 'env' | 'characters', label: string) => (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid={`stage-block-regen-${block}`}
        disabled={actions.busy}
        onClick={() => actions.onBlockRegen(block)}
      >
        {label}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" disabled={actions.busy} onClick={() => actions.onBlockFeedback(block)}>
        提意见
      </button>
    </>
  );

  return (
    <div className="pipeline-p1">
      <Block
        id="block-world"
        title={kind === 'short' ? '世界观（短篇可留空）' : '世界观'}
        count={world ? 1 : 0}
        hint="时代地点、基调母题、语言习惯和世界规则；整块保存为一条修订。"
        actions={blockAction('world', '重生成世界观')}
      >
        {world ? (
          card(world)
        ) : (
          <div className="pipeline-empty pipeline-empty--inline">
            <strong>还没有世界观</strong>
            <p>AI 会根据书名和简介先给一版，你再改。</p>
          </div>
        )}
      </Block>

      <Block
        id="block-env"
        title="环境"
        count={envs.length}
        hint="故事发生的具体场所，写细节用得上。"
        actions={
          <>
            {addButton('env', '新增环境')}
            {blockAction('env', '重生成环境')}
          </>
        }
      >
        {envs.length ? (
          envs.map((item, index) => card(item, { block: 'env', index, total: envs.length }))
        ) : (
          <p className="pipeline-empty--line">还没有环境。</p>
        )}
      </Block>

      <Block
        id="block-characters"
        title="人物"
        count={characters.length}
        hint="主角带 ★；锁定的人物不会被整份重生成覆盖。"
        actions={
          <>
            {addButton('characters', '新增人物')}
            {blockAction('characters', '重生成人物')}
          </>
        }
      >
        {characters.length ? (
          characters.map((item, index) => card(item, { block: 'characters', index, total: characters.length }))
        ) : (
          <p className="pipeline-empty--line">还没有人物。AI 生成后会出现在这里。</p>
        )}
      </Block>
    </div>
  );
}
