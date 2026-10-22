import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Character, Foreshadow, ProjectDetail } from '../../shared/types';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';

const typeLabel: Record<string, string> = { novel: '长篇小说', short: '短篇小说', screenplay: '电影剧本', series: '剧集大纲' };

export function CodexPage() {
  const { projectId = '' } = useParams();
  const { rememberProject, settings } = useApp();
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<'characters' | 'foreshadow'>('characters');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Character | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', role: '', age: '', quote: '', description: '', secret: '', tags: '' });
  const [editingForeshadow, setEditingForeshadow] = useState<Foreshadow | 'new' | null>(null);
  const [foreshadowForm, setForeshadowForm] = useState({ name: '', planted: '', payoff: '', status: '待回收' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.project(projectId).then(({ project: next }) => {
      setProject(next);
      rememberProject(next.id);
      setSelectedId(next.characters[0]?.id || '');
    });
  }, [projectId, rememberProject]);

  function openEditor(character?: Character) {
    if (character) {
      setEditing(character);
      setForm({
        name: character.name, role: character.role, age: character.age, quote: character.quote,
        description: character.description, secret: character.secret, tags: character.tags.join(', '),
      });
    } else {
      setEditing('new');
      setForm({ name: '', role: '配角', age: '', quote: '', description: '', secret: '', tags: '' });
    }
  }

  function openForeshadow(item?: Foreshadow) {
    if (item) {
      setEditingForeshadow(item);
      setForeshadowForm({ name: item.name, planted: item.planted, payoff: item.payoff, status: item.status });
    } else {
      setEditingForeshadow('new');
      setForeshadowForm({ name: '', planted: '', payoff: '', status: '待回收' });
    }
  }

  async function saveForeshadow() {
    if (!project || !editingForeshadow) return;
    if (!foreshadowForm.name.trim()) { toast('伏笔名不能为空', 'warn'); return; }
    try {
      const { foreshadow } = editingForeshadow === 'new'
        ? await api.createForeshadow(project.id, foreshadowForm)
        : await api.updateForeshadow(editingForeshadow.id, foreshadowForm);
      setProject((prev) => {
        if (!prev) return prev;
        const exists = prev.foreshadows.some((f) => f.id === foreshadow.id);
        return { ...prev, foreshadows: exists ? prev.foreshadows.map((f) => f.id === foreshadow.id ? foreshadow : f) : [...prev.foreshadows, foreshadow] };
      });
      setEditingForeshadow(null);
      toast(editingForeshadow === 'new' ? '伏笔已创建' : '伏笔已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    }
  }

  async function saveCharacter() {
    if (!project || !editing) return;
    if (!form.name.trim()) { toast('人物名不能为空', 'warn'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), role: form.role, age: form.age, avatar: form.name.trim().slice(0, 1),
        quote: form.quote, description: form.description, secret: form.secret,
        tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      };
      const { character } = editing === 'new'
        ? await api.createCharacter(project.id, payload)
        : await api.updateCharacter(editing.id, payload);
      setProject((prev) => {
        if (!prev) return prev;
        const exists = prev.characters.some((c) => c.id === character.id);
        return { ...prev, characters: exists ? prev.characters.map((c) => c.id === character.id ? character : c) : [...prev.characters, character] };
      });
      setSelectedId(character.id);
      setEditing(null);
      toast(editing === 'new' ? '人物已创建' : '人物档案已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    } finally {
      setSaving(false);
    }
  }

  if (!project) return <div className="loading-screen"><span className="brand__seal">私</span><p>正在打开设定库…</p></div>;
  const selected = project.characters.find((c) => c.id === selectedId) || project.characters[0];
  const filtered = project.characters.filter((c) => !query || `${c.name}${c.role}${c.tags.join('')}`.includes(query));
  const topbar = (
    <>
      <div className="topbar-left"><Link className="tb-crumb__back" to={`/project/${project.id}`}><Icon name="arrow-left" /></Link><div className="tb-project"><Cover project={project} variant="mini" /><div className="tb-project__info"><div className="tb-project__title">{project.title}<span className="tb-tag">{typeLabel[project.type]}</span></div><span className="tb-project__meta">{project.genre}</span></div></div></div>
      <nav className="topbar-tabs"><Link to={`/project/${project.id}`}>正文</Link><Link to={`/project/${project.id}/outline`}>大纲</Link><Link to={`/project/${project.id}/codex`} className="is-active">设定</Link></nav>
      <div className="topbar-actions"><span className="tb-save"><i />本地数据库</span><div className="tb-divider" /><button className="btn btn--primary btn--sm" type="button" onClick={() => openEditor()}><Icon name="plus" /> 新增人物</button><button className="avatar" type="button">{(settings.profile?.name || '写作者').slice(0, 1)}</button></div>
    </>
  );
  const panel = (
    <>
      <div className="panel-project"><Cover project={project} variant="mini" /><div className="panel-project__info"><strong>{project.title}</strong><span>设定库 · {project.characters.length} 人物</span></div><Link className="icon-btn icon-btn--sm" to={`/project/${project.id}/outline`}><Icon name="chevron-down" /></Link></div>
      <div className="panel-scroll">
        <label className="panel-search"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索人物、伏笔…" /></label>
        <div className="codex-nav">
          <button className="codex-nav__item is-active" type="button" onClick={() => setTab('characters')}><Icon name="users" /><span>人物</span><em>{project.characters.length}</em></button>
          <button className="codex-nav__item" type="button" onClick={() => setTab('foreshadow')}><Icon name="flag" /><span>伏笔</span><em>{project.foreshadows.length}</em></button>
        </div>
        <div className="memory-index"><div className="memory-index__head"><span><Icon name="spark" /> 长期记忆</span><span className="sync-dot">已同步</span></div><p>人物、秘密与关系已经进入 AI 的写作上下文。</p><div className="pbar"><i style={{ width: '72%' }} /></div><span className="memory-index__meta">{project.characters.length} 人物 · {project.foreshadows.length} 条伏笔</span></div>
      </div>
      <div className="panel-foot panel-foot--note"><Icon name="clock" /><p>最近更新：{project.title} · 本地设定库</p></div>
    </>
  );
  return (
    <AppShell active="codex" projectId={project.id} topbar={topbar} panel={panel}>
      <section className="view view--codex is-active">
        <div className="codex-view">
          <header className="view-head"><div><p className="eyebrow"><span className="eyebrow__dot" />故事设定库</p><h1>人物与{project.title}</h1><p className="view-sub">AI 已索引 {project.characters.length} 位人物、{project.foreshadows.length} 条伏笔，写作时会自动引用。</p></div><div className="view-actions"><Link className="btn btn--ghost" to={`/project/${project.id}/outline`}><Icon name="map" /> 查看大纲</Link><Link className="btn btn--primary" to={`/project/${project.id}`}><Icon name="pen" /> 去写作</Link></div></header>
          <div className="codex-tabs"><button className={tab === 'characters' ? 'is-active' : ''} type="button" onClick={() => setTab('characters')}>人物 <span>{project.characters.length}</span></button><button className={tab === 'foreshadow' ? 'is-active' : ''} type="button" onClick={() => setTab('foreshadow')}>伏笔 <span>{project.foreshadows.length}</span></button></div>
          <div className={`codex-body${tab === 'foreshadow' ? ' is-wide' : ''}`}>
            <div className="codex-content">
              {tab === 'characters' ? (
                <div className="char-grid">
                  {filtered.map((c) => {
                    const key = c.id.replace('char_', '');
                    return (
                      <button key={c.id} type="button" className={`char-card${c.id === selected?.id ? ' is-active' : ''}`} onClick={() => setSelectedId(c.id)}>
                        <div className={`char-avatar char-avatar--${key}`}>{c.avatar || c.name.slice(0, 1)}</div>
                        <div className="char-card__info"><div className="char-card__name">{c.name} <span>{c.role.split('·')[0]}</span></div><p>{c.role} · {c.age} 岁</p><div className="char-tags">{c.tags.map((t) => <span key={t}>{t}</span>)}</div></div>
                        <span className="char-card__rel">{c.relations[0] ? `与${c.relations[0].name} ${c.relations[0].rel}` : '暂无关系'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="foreshadow-wrap">
                  <div className="foreshadow-head"><div><strong>伏笔台账</strong><p>AI 会追踪埋设与回收之间的距离，避免遗忘。</p></div><div className="settings-block__actions"><button className="btn btn--tiny btn--ghost" type="button" onClick={() => openForeshadow()}><Icon name="plus" /> 新增伏笔</button><span className="tag tag--accent">{project.foreshadows.length} 条进行中</span></div></div>
                  <div className="foreshadow-table">
                    <div className="foreshadow-row foreshadow-row--head"><span>伏笔</span><span>埋设</span><span>计划回收</span><span>状态</span></div>
                    {project.foreshadows.map((f) => <div key={f.id} className="foreshadow-row foreshadow-row--clickable" role="button" tabIndex={0} onClick={() => openForeshadow(f)} onKeyDown={(e) => { if (e.key === 'Enter') openForeshadow(f); }}><span><Icon name="flag" />{f.name}</span><span>{f.planted}</span><span>{f.payoff}</span><span className={`foreshadow-status ${f.status === '已回收' ? 'is-done' : f.status === '规划中' ? 'is-plan' : 'is-pending'}`}>{f.status}</span></div>)}
                  </div>
                </div>
              )}
            </div>
            {tab === 'characters' && selected && (
              <aside className="inspector">
                <div className="inspector__head"><span>人物档案</span><span className="sync-badge"><Icon name="check" /> 已同步</span></div>
                <div className="inspector__hero"><div className={`char-avatar char-avatar--${selected.id.replace('char_', '')} char-avatar--lg`}>{selected.avatar || selected.name.slice(0, 1)}</div><div><h2>{selected.name}</h2><p>{selected.role}</p><div className="char-tags">{selected.tags.map((t) => <span key={t}>{t}</span>)}</div></div></div>
                <blockquote className="inspector__quote">{selected.quote}</blockquote>
                <dl className="inspector__fields"><div><dt>年龄</dt><dd>{selected.age}</dd></div><div><dt>出场</dt><dd>{project.chapters.length} 章</dd></div><div><dt>视角</dt><dd>主视角</dd></div></dl>
                <div className="inspector__section"><h4>动机与底色</h4><p>{selected.description}</p></div>
                <div className="inspector__section"><h4>人物秘密 <Icon name="lock" /></h4><p className="inspector__secret">{selected.secret}</p></div>
                <div className="inspector__section"><h4>关系</h4><div className="rel-list">{selected.relations.map((r) => <div className="rel-row" key={r.name}><span className="char-avatar char-avatar--xs">{r.name.slice(0, 1)}</span><div><strong>{r.name}</strong><em>{r.rel}</em></div><span className="rel-tension">{r.tension}</span></div>)}</div></div>
                <div className="inspector__section"><h4>AI 写作提示</h4><div className="ai-tip"><Icon name="spark" /><p>{selected.name}的每句台词都应当带一点未说出口的信息。</p></div></div>
                <div className="inspector__actions"><button className="btn btn--ghost" type="button" onClick={() => openEditor(selected)}><Icon name="pen" /> 编辑人物</button></div>
              </aside>
            )}
          </div>
        </div>
      </section>
      {editing && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal modal--character" role="dialog" aria-modal="true">
            <header className="modal__head"><div><p className="modal__eyebrow">人物档案</p><h2>{editing === 'new' ? '新增人物' : `编辑 ${editing.name}`}</h2></div><button className="icon-btn" type="button" onClick={() => setEditing(null)}><Icon name="x" /></button></header>
            <div className="wizard-body">
              <div className="form-row"><div className="form-block"><label className="form-label">姓名</label><input className="text-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div className="form-block"><label className="form-label">身份 / 角色</label><input className="text-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div></div>
              <div className="form-row"><div className="form-block"><label className="form-label">年龄</label><input className="text-input" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></div><div className="form-block"><label className="form-label">关键词 <span>逗号分隔</span></label><input className="text-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div></div>
              <div className="form-block"><label className="form-label">人物引言</label><input className="text-input" value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} /></div>
              <div className="form-block"><label className="form-label">动机与底色</label><textarea className="text-input text-input--area" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="form-block"><label className="form-label">人物秘密</label><textarea className="text-input text-input--area" rows={2} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></div>
            </div>
            <footer className="modal__foot"><span className="modal__hint">人物会进入 AI 写作上下文。</span><div className="modal__foot-actions"><button className="btn btn--ghost" type="button" onClick={() => setEditing(null)}>取消</button><button className="btn btn--primary" type="button" disabled={saving} onClick={saveCharacter}>{saving ? '保存中…' : '保存人物'}</button></div></footer>
          </div>
        </div>
      )}
      {editingForeshadow && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingForeshadow(null); }}>
          <div className="modal modal--foreshadow" role="dialog" aria-modal="true">
            <header className="modal__head"><div><p className="modal__eyebrow">伏笔台账</p><h2>{editingForeshadow === 'new' ? '新增伏笔' : '编辑伏笔'}</h2></div><button className="icon-btn" type="button" onClick={() => setEditingForeshadow(null)}><Icon name="x" /></button></header>
            <div className="wizard-body">
              <div className="form-block"><label className="form-label">伏笔名</label><input className="text-input" value={foreshadowForm.name} onChange={(e) => setForeshadowForm({ ...foreshadowForm, name: e.target.value })} /></div>
              <div className="form-row"><div className="form-block"><label className="form-label">埋设位置</label><input className="text-input" value={foreshadowForm.planted} onChange={(e) => setForeshadowForm({ ...foreshadowForm, planted: e.target.value })} placeholder="第 7 章" /></div><div className="form-block"><label className="form-label">计划回收</label><input className="text-input" value={foreshadowForm.payoff} onChange={(e) => setForeshadowForm({ ...foreshadowForm, payoff: e.target.value })} placeholder="第 14 章" /></div></div>
              <div className="form-block"><label className="form-label">状态</label><select className="text-input" value={foreshadowForm.status} onChange={(e) => setForeshadowForm({ ...foreshadowForm, status: e.target.value })}><option>待回收</option><option>规划中</option><option>已回收</option><option>已放弃</option></select></div>
            </div>
            <footer className="modal__foot"><span className="modal__hint">伏笔会进入 AI 上下文，帮助模型避免遗忘。</span><div className="modal__foot-actions"><button className="btn btn--ghost" type="button" onClick={() => setEditingForeshadow(null)}>取消</button><button className="btn btn--primary" type="button" onClick={saveForeshadow}>保存伏笔</button></div></footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
