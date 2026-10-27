import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OutlineBeat, ProjectDetail } from '../../shared/types';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';

const typeLabel: Record<string, string> = { novel: '长篇小说', short: '短篇小说', screenplay: '电影剧本', series: '剧集大纲' };

export function OutlinePage() {
  const { projectId = '' } = useParams();
  const { rememberProject, settings } = useApp();
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [selected, setSelected] = useState<OutlineBeat | null>(null);
  const [draft, setDraft] = useState({ title: '', chapterNo: 1, status: '待写', summary: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);

  useEffect(() => {
    api.project(projectId).then(({ project: next }) => {
      setProject(next);
      rememberProject(next.id);
      setSelected(next.outline.beats.find((b) => b.status === '初稿') || next.outline.beats[0] || null);
    }).catch((err) => setLoadError(err instanceof Error ? err.message : '加载失败'));
  }, [projectId, rememberProject]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      title: selected.title,
      chapterNo: selected.chapterNo,
      status: selected.status,
      summary: selected.summary,
      tags: selected.tags.join(', '),
    });
  }, [selected]);

  async function saveBeat() {
    if (!selected || !project) return;
    setSaving(true);
    try {
      const tags = draft.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      const { beat } = await api.updateBeat(selected.id, {
        title: draft.title.trim() || selected.title,
        chapterNo: Number(draft.chapterNo) || selected.chapterNo,
        status: draft.status,
        summary: draft.summary,
        tags,
      });
      setProject((prev) => prev ? { ...prev, outline: { ...prev.outline, beats: prev.outline.beats.map((b) => b.id === beat.id ? beat : b) } } : prev);
      setSelected(beat);
      toast('场景已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    } finally {
      setSaving(false);
    }
  }

  async function moveBeat(direction: -1 | 1) {
    if (!selected || !project) return;
    const beats = [...project.outline.beats].sort((a, b) => a.sortOrder - b.sortOrder);
    const actBeats = beats.filter((b) => b.actId === selected.actId);
    const actIndex = actBeats.findIndex((b) => b.id === selected.id);
    const target = actBeats[actIndex + direction];
    if (!target) return;
    const a = beats.findIndex((b) => b.id === selected.id);
    const bIndex = beats.findIndex((b) => b.id === target.id);
    [beats[a], beats[bIndex]] = [beats[bIndex], beats[a]];
    try {
      const { beats: updated } = await api.reorderBeats(project.id, beats.map((b) => b.id));
      setProject((prev) => prev ? { ...prev, outline: { ...prev.outline, beats: updated } } : prev);
      setSelected(updated.find((b) => b.id === selected.id) || selected);
      toast('场景顺序已更新');
    } catch (err) {
      toast(err instanceof Error ? err.message : '排序失败', 'warn');
    }
  }

  async function moveBeatTo(targetId: string) {
    const sourceId = draggingRef.current || draggingId;
    if (!project || !sourceId || sourceId === targetId) return;
    const beats = [...project.outline.beats].sort((a, b) => a.sortOrder - b.sortOrder);
    const from = beats.findIndex((b) => b.id === sourceId);
    const target = beats.find((b) => b.id === targetId);
    if (from < 0 || !target) return;
    if (beats[from].actId !== target.actId) {
      toast('先在同一幕内拖动；跨幕移动下一步再做', 'warn');
      return;
    }
    const originalTargetIndex = beats.findIndex((b) => b.id === targetId);
    const moved = beats.splice(from, 1)[0];
    const targetIndex = beats.findIndex((b) => b.id === targetId);
    const insertAt = targetIndex < 0 ? beats.length : targetIndex + (from < originalTargetIndex ? 1 : 0);
    beats.splice(insertAt, 0, moved);
    try {
      const { beats: updated } = await api.reorderBeats(project.id, beats.map((b) => b.id));
      setProject((prev) => prev ? { ...prev, outline: { ...prev.outline, beats: updated } } : prev);
      setSelected(updated.find((b) => b.id === moved.id) || moved);
      toast('场景顺序已更新');
    } catch (err) {
      toast(err instanceof Error ? err.message : '排序失败', 'warn');
    }
  }

  async function deleteBeat() {
    if (!selected || !project) return;
    if (!window.confirm(`删除场景「${selected.title}」？`)) return;
    try {
      await api.deleteBeat(selected.id);
      const remaining = project.outline.beats.filter((b) => b.id !== selected.id);
      setProject((prev) => prev ? { ...prev, outline: { ...prev.outline, beats: remaining } } : prev);
      setSelected(remaining[0] || null);
      toast('场景已删除');
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'warn');
    }
  }

  async function addBeat() {
    if (!project) return;
    const act = project.outline.acts[1] || project.outline.acts[0];
    if (!act) return;
    const chapterNo = project.outline.beats.reduce((max, b) => Math.max(max, b.chapterNo), 0) + 1;
    try {
      const { beat } = await api.createBeat(project.id, {
        actId: act.id,
        title: '新场景',
        chapterNo,
        summary: '还没有展开。',
        tags: [],
        status: '待写',
      });
      setProject((prev) => prev ? { ...prev, outline: { ...prev.outline, beats: [...prev.outline.beats, beat] } } : prev);
      setSelected(beat);
      toast('已添加场景');
    } catch (err) {
      toast(err instanceof Error ? err.message : '添加场景失败', 'warn');
    }
  }

  const grouped = useMemo(() => (project?.outline.acts || []).map((act) => ({
    act,
    beats: project?.outline.beats.filter((b) => b.actId === act.id) || [],
  })), [project]);

  if (!project) return (
    <div className={`loading-screen${loadError ? ' loading-screen--error' : ''}`}>
      <span className="brand__seal">私</span>
      {loadError ? <><strong>打不开故事结构</strong><p>{loadError}</p><Link className="btn btn--ghost btn--sm" to="/">返回书房</Link></> : <p>正在打开故事结构…</p>}
    </div>
  );
  const written = project.chapters.filter((c) => c.content).length;
  const topbar = (
    <>
      <div className="topbar-left"><Link className="tb-crumb__back" to={`/project/${project.id}`}><Icon name="arrow-left" /></Link><div className="tb-project"><Cover project={project} variant="mini" /><div className="tb-project__info"><div className="tb-project__title">{project.title}<span className="tb-tag">{typeLabel[project.type]}</span></div><span className="tb-project__meta">{project.genre}</span></div></div></div>
      <nav className="topbar-tabs"><Link to={`/project/${project.id}`}>正文</Link><Link to={`/project/${project.id}/outline`} className="is-active">大纲</Link><Link to={`/project/${project.id}/codex`}>设定</Link></nav>
      <div className="topbar-actions"><span className="tb-save"><i />本地数据库</span><div className="tb-divider" /><Link className="btn btn--ghost btn--sm" to={`/project/${project.id}/codex`}><Icon name="users" /> 人物与设定</Link><button className="avatar" type="button">{(settings.profile?.name || '写作者').slice(0, 1)}</button></div>
    </>
  );
  const panel = (
    <>
      <div className="panel-project"><Cover project={project} variant="mini" /><div className="panel-project__info"><strong>{project.title}</strong><span>{project.outline.acts.length} 幕 · {project.outline.beats.length} 个场景</span></div><Link className="icon-btn icon-btn--sm" to={`/project/${project.id}`}><Icon name="chevron-down" /></Link></div>
      <div className="panel-scroll">
        <div className="panel-section-head"><span>结构</span><span className="panel-hint">已完成 {written}</span></div>
        <div className="structure-card"><div className="structure-card__icon"><Icon name="route" /></div><div><strong>三幕式</strong><span>{project.outline.beats.length} 个场景 · 目标 {Math.round(project.goalWords / 10000)} 万字</span></div><Icon name="check" className="structure-card__check" /></div>
        <div className="act-list">
          {project.outline.acts.map((act, i) => {
            const beats = project.outline.beats.filter((b) => b.actId === act.id);
            const done = beats.filter((b) => b.status === '初稿' || b.status === '已定稿').length;
            return <div key={act.id} className={`act-item${i === 1 ? ' is-active' : ''}`}><span className="act-item__no">{['I', 'II', 'III'][i] || i + 1}</span><span className="act-item__body"><strong>{act.title}</strong><em>{beats[0]?.chapterNo ? `第 ${beats[0].chapterNo}–${beats[beats.length - 1]?.chapterNo} 章` : act.summary}</em></span><span className="act-item__status">{done}/{beats.length}</span></div>;
          })}
        </div>
        <div className="panel-section-head panel-section-head--spaced"><span>人物弧光</span><span className="panel-hint">数据来自设定库</span></div>
        <div className="arc-list">
          {project.characters.slice(0, 3).map((c, i) => (
            <div key={c.id} className="arc-row"><div className="arc-row__top"><span>{c.name}</span><em>{c.role.split('·')[0]}</em></div><div className={`arc-track${i === 1 ? ' arc-track--jade' : i === 2 ? ' arc-track--gold' : ''}`}><i style={{ width: `${[64, 47, 78][i]}%` }} /><b style={{ left: `${[38, 24, 55][i]}%` }} /></div></div>
          ))}
        </div>
      </div>
      <div className="panel-foot panel-foot--note"><Icon name="spark" /><p>大纲和章节现在由本地数据库驱动，修改会持久化到 SQLite。</p></div>
    </>
  );
  return (
    <AppShell active="outline" projectId={project.id} topbar={topbar} panel={panel}>
      <section className="view view--outline is-active">
        <div className="outline-view">
          <header className="view-head"><div><p className="eyebrow"><span className="eyebrow__dot" />故事结构 · 三幕式</p><h1>{project.outline.acts.length} 幕，{project.outline.beats.length} 个场景</h1><p className="view-sub">{project.description}</p></div><div className="view-actions"><Link className="btn btn--primary" to={`/project/${project.id}`}><Icon name="pen" /> 回到正文</Link></div></header>
          <section className="tension-grid">
            <div className="tension-card">
              <div className="tension-card__head"><div><h2>情绪张力曲线</h2><p>按章节场景数量与状态估算</p></div><div className="legend"><span><i />张力</span><span><i className="is-act" />幕间转折</span></div></div>
              <div className="tension-chart">
                <div className="chart-y"><span>9</span><span>7</span><span>5</span><span>3</span></div>
                <svg viewBox="0 0 820 220" preserveAspectRatio="none">
                  <defs><linearGradient id="tf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".25" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient><linearGradient id="ts" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--gold)" /><stop offset="55%" stopColor="var(--accent)" /><stop offset="100%" stopColor="var(--accent-hi)" /></linearGradient></defs>
                  <g className="chart-grid"><line x1="0" y1="40" x2="820" y2="40" /><line x1="0" y1="90" x2="820" y2="90" /><line x1="0" y1="140" x2="820" y2="140" /><line x1="0" y1="190" x2="820" y2="190" /></g>
                  <rect x="340" y="0" width="10" height="220" className="chart-act" /><rect x="680" y="0" width="10" height="220" className="chart-act" />
                  <path d="M0,168 C60,158 90,132 140,138 S240,102 300,112 S400,70 470,82 S570,48 650,58 S760,26 820,30 L820,220 L0,220 Z" fill="url(#tf)" />
                  <path d="M0,168 C60,158 90,132 140,138 S240,102 300,112 S400,70 470,82 S570,48 650,58 S760,26 820,30" fill="none" stroke="url(#ts)" strokeWidth="2" strokeLinecap="round" />
                  <g className="chart-points">{[[90, 138], [180, 120], [300, 112], [430, 88], [560, 60], [690, 48], [790, 34]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 2 ? 6 : 3.5} className={i === 2 ? 'is-active' : ''} />)}</g>
                  <g className="chart-labels"><text x="8" y="212">第 1 章</text><text x="292" y="212">第 7 章</text><text x="500" y="212">第 12 章</text><text x="660" y="212">第 18 章</text><text x="784" y="212">第 24 章</text></g>
                </svg>
                {selected && <div className="chart-tooltip" style={{ left: '34%', top: '5%' }}><span>第 {selected.chapterNo} 章 · {selected.title}</span><strong>{selected.status}</strong><em>{selected.summary}</em></div>}
              </div>
            </div>
            <aside className="insight-card insight-card--edit">
              <div className="insight-card__head"><span>场景编辑</span><span className="tag tag--accent">本地</span></div>
              {selected ? (
                <div className="insight-form">
                  <label><span>场景标题</span><input className="text-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                  <div className="insight-form__row">
                    <label><span>章节</span><input className="text-input" type="number" min={1} value={draft.chapterNo} onChange={(e) => setDraft({ ...draft, chapterNo: Number(e.target.value) })} /></label>
                    <label><span>状态</span><select className="text-input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option>待写</option><option>草稿</option><option>初稿</option><option>写作中</option><option>已定稿</option></select></label>
                  </div>
                  <label><span>场景摘要</span><textarea className="text-input text-input--area" rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></label>
                  <label><span>标签 <em>逗号分隔</em></span><input className="text-input" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="钩子, 线索" /></label>
                  <div className="insight-form__actions"><button className="btn btn--primary btn--sm" type="button" disabled={saving} onClick={saveBeat}>{saving ? '保存中…' : '保存场景'}</button><Link className="btn btn--ghost btn--sm" to={`/project/${project.id}`}>去写这一章</Link></div>
                  <div className="insight-form__tools"><button className="text-btn" type="button" onClick={() => moveBeat(-1)}><Icon name="arrow-up" /> 上移</button><button className="text-btn" type="button" onClick={() => moveBeat(1)}><Icon name="arrow-up" style={{ transform: 'rotate(180deg)' }} /> 下移</button><button className="text-btn insight-form__danger" type="button" onClick={deleteBeat}><Icon name="trash" /> 删除</button></div>
                </div>
              ) : <p className="insight-card__text">选择左侧任意场景开始编辑。</p>}
              <div className="insight-card__tip"><Icon name="spark" /><p>场景会进入 AI 写作上下文；下一步可以接 AI 诊断与拖拽排序。</p></div>
            </aside>
          </section>
          <div className="acts-head"><h2>分幕大纲 <span className="acts-head__hint">拖动卡片可排序</span></h2><div className="acts-head__tools"><button className="chip" type="button" onClick={addBeat}><Icon name="plus" /> 添加场景</button></div></div>
          <div className="acts">
            {grouped.map(({ act, beats }, actIndex) => (
              <article key={act.id} className={`act${actIndex === 1 ? ' act--current' : ''}`}>
                <header className="act__head"><div className="act__no">{['I', 'II', 'III'][actIndex] || actIndex + 1}</div><div className="act__title"><h3>{act.title}</h3><p>{act.summary}</p></div><span className="act__count">{beats.filter((b) => b.status === '初稿' || b.status === '已定稿').length} / {beats.length}</span></header>
                <div className="beats">
                  {beats.map((beat) => (
                    <button
                      key={beat.id}
                      type="button"
                      draggable
                      className={`beat${beat.id === selected?.id ? ' is-active' : ''}${beat.status === '待写' ? ' is-draft' : ''}${draggingId === beat.id ? ' is-dragging' : ''}`}
                      onClick={() => setSelected(beat)}
                      onDragStart={(e) => { draggingRef.current = beat.id; setDraggingId(beat.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', beat.id); }}
                      onDragEnd={() => { draggingRef.current = null; setDraggingId(null); }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || draggingRef.current; if (id) void moveBeatTo(beat.id); draggingRef.current = null; setDraggingId(null); }}
                    >
                      <span className="beat__no">{String(beat.chapterNo).padStart(2, '0')}</span>
                      <span className="beat__body"><strong>{beat.title}</strong><em>{beat.summary}</em></span>
                      {beat.status !== '待写' && <span className={`beat__tag${beat.status === '初稿' ? ' beat__tag--live' : ''}`}>{beat.status}</span>}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
