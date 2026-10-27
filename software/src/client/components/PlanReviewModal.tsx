import { useMemo, useState } from 'react';
import type { ProjectDetail, ProjectPlan } from '../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { useToast } from './Toast';

export function PlanReviewModal({
  projectId, plan, onClose, onApplied,
}: {
  projectId: string;
  plan: ProjectPlan;
  onClose: () => void;
  onApplied: (project: ProjectDetail) => void;
}) {
  const { toast } = useToast();
  const [current, setCurrent] = useState(plan);
  const [selectedBeats, setSelectedBeats] = useState<Set<string>>(() => new Set(plan.acts.flatMap((act, i) => act.beats.map((_, j) => `${i}-${j}`))));
  const [selectedCharacters, setSelectedCharacters] = useState<Set<number>>(() => new Set(plan.characters.map((_, i) => i)));
  const [includeChapter, setIncludeChapter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');

  function close() {
    if (busy || regenerating) return;
    onClose();
  }

  const counts = useMemo(() => ({
    beats: selectedBeats.size,
    characters: selectedCharacters.size,
    chapter: includeChapter ? 1 : 0,
  }), [selectedBeats, selectedCharacters, includeChapter]);

  function toggleBeat(key: string) {
    setSelectedBeats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAct(index: number) {
    const keys = current.acts[index].beats.map((_, j) => `${index}-${j}`);
    const all = keys.every((key) => selectedBeats.has(key));
    setSelectedBeats((prev) => {
      const next = new Set(prev);
      keys.forEach((key) => { if (all) next.delete(key); else next.add(key); });
      return next;
    });
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    try {
      const { plan: next } = await api.planProject(projectId);
      setCurrent(next);
      setSelectedBeats(new Set(next.acts.flatMap((act, i) => act.beats.map((_, j) => `${i}-${j}`))));
      setSelectedCharacters(new Set(next.characters.map((_, i) => i)));
      setIncludeChapter(true);
      toast('已生成新一版企划');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新生成失败');
    } finally {
      setRegenerating(false);
    }
  }

  async function apply() {
    const acts = current.acts
      .map((act, i) => ({ ...act, beats: act.beats.filter((_, j) => selectedBeats.has(`${i}-${j}`)) }))
      .filter((act) => act.beats.length > 0);
    const characters = current.characters.filter((_, i) => selectedCharacters.has(i));
    if (!acts.length && !characters.length && !includeChapter) {
      setError('至少保留一项内容');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { project } = await api.applyPlan(projectId, {
        acts, characters,
        chapter: includeChapter ? current.chapter : { title: '', content: '' },
      });
      onApplied(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用企划失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay plan-review-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal plan-review" role="dialog" aria-modal="true" aria-label="确认 AI 企划">
        <header className="modal__head plan-review__head">
          <div><p className="modal__eyebrow">AI 企划 · 逐项确认</p><h2>先看一遍，再决定写什么。</h2><p>取消勾选不需要的条目；应用后仍可以在大纲和设定里继续改。</p></div>
          <button className="icon-btn" type="button" onClick={close} aria-label="关闭" disabled={busy || regenerating}><Icon name="x" /></button>
        </header>
        <div className="plan-review__body">
          <section className="plan-review__section">
            <div className="plan-review__section-head"><div><h3>三幕大纲</h3><p>{current.acts.length} 幕 · {current.acts.reduce((n, a) => n + a.beats.length, 0)} 个场景</p></div><button className="text-btn" type="button" onClick={() => setSelectedBeats(new Set(current.acts.flatMap((act, i) => act.beats.map((_, j) => `${i}-${j}`))))}>全选</button><button className="text-btn" type="button" onClick={() => setSelectedBeats(new Set())}>全不选</button></div>
            <div className="plan-review__acts">
              {current.acts.map((act, i) => {
                const keys = act.beats.map((_, j) => `${i}-${j}`);
                const all = keys.length > 0 && keys.every((key) => selectedBeats.has(key));
                return <div className="plan-act" key={`${act.title}-${i}`}>
                  <label className="plan-check plan-act__head"><input type="checkbox" checked={all} onChange={() => toggleAct(i)} /><span><strong>{act.title}</strong><em>{act.summary}</em></span><span className="plan-count">{keys.filter((key) => selectedBeats.has(key)).length}/{keys.length}</span></label>
                  <div className="plan-beats">{act.beats.map((beat, j) => <label className="plan-check plan-beat" key={`${i}-${j}`}><input type="checkbox" checked={selectedBeats.has(`${i}-${j}`)} onChange={() => toggleBeat(`${i}-${j}`)} /><span><strong>{beat.chapterNo}. {beat.title}</strong><em>{beat.summary}</em></span><span className="plan-badge">{beat.tags[0] || '场景'}</span></label>)}</div>
                </div>;
              })}
            </div>
          </section>

          <section className="plan-review__section">
            <div className="plan-review__section-head"><div><h3>主要人物</h3><p>{current.characters.length} 位</p></div></div>
            <div className="plan-review__characters">
              {current.characters.length === 0 ? <p className="plan-review__empty">这次没有生成人物，可以先只应用大纲和第一章，之后再在设定里补。</p> : null}
              {current.characters.map((character, i) => <label className={`plan-check plan-character${selectedCharacters.has(i) ? ' is-on' : ''}`} key={`${character.name}-${i}`}><input type="checkbox" checked={selectedCharacters.has(i)} onChange={() => setSelectedCharacters((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; })} /><span className="plan-character__avatar">{character.name.slice(0, 1)}</span><span><strong>{character.name}</strong><em>{character.role} · {character.age || '年龄未定'}</em><p>{character.description}</p></span></label>)}
            </div>
          </section>

          <section className="plan-review__section">
            <div className="plan-review__section-head"><div><h3>第一章初稿</h3><p>{current.chapter.content.length} 字</p></div><label className="plan-check plan-chapter-toggle"><input type="checkbox" checked={includeChapter} onChange={(e) => setIncludeChapter(e.target.checked)} /><span>写入第一章</span></label></div>
            <div className="plan-chapter-preview"><strong>{current.chapter.title || '未命名第一章'}</strong><div>{current.chapter.content ? current.chapter.content.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>) : <p className="muted">这次没有生成第一章正文，可以进入写作台后自己写或让 AI 续写。</p>}</div></div>
          </section>
        </div>
        <footer className="plan-review__foot">
          <span className="plan-review__summary">已选 <b>{counts.beats}</b> 个场景 · <b>{counts.characters}</b> 位人物 · {counts.chapter ? '第一章' : '不写第一章'}</span>
          <div className="plan-review__actions"><button className="btn btn--ghost" type="button" onClick={close} disabled={busy || regenerating}>取消</button><button className="btn btn--ghost" type="button" onClick={regenerate} disabled={busy || regenerating}><Icon name="refresh" /> {regenerating ? '重新生成中…' : '重新生成'}</button><button className="btn btn--primary" type="button" onClick={apply} disabled={busy}>{busy ? '正在写入…' : '应用选中内容'}</button></div>
        </footer>
        {error ? <p className="plan-review__error"><Icon name="alert" /> {error}</p> : null}
      </div>
    </div>
  );
}
