import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProjectDetail, Scene, Shot } from '../../shared/types';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';

const typeLabel: Record<string, string> = { novel: '长篇小说', short: '短篇小说', screenplay: '电影剧本', series: '剧集大纲' };

export function ScreenplayPage() {
  const { projectId = '' } = useParams();
  const { projects, rememberProject, settings } = useApp();
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [activeId, setActiveId] = useState('');
  const [editing, setEditing] = useState<Scene | null>(null);
  const [form, setForm] = useState({ heading: '', place: '', time: '日', content: '', status: '草稿', groupName: '第一幕' });
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<'script' | 'boards'>('script');
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [shotForm, setShotForm] = useState({ shotNo: '', shotType: '', camera: '', duration: '', description: '', notes: '' });

  useEffect(() => {
    const screenplay = projects.find((p) => p.type === 'screenplay');
    const target = projectId && projects.some((p) => p.id === projectId) ? projectId : screenplay?.id || projectId;
    api.project(target).then(({ project: next }) => {
      setProject(next);
      rememberProject(next.id);
      setActiveId(next.scenes[0]?.id || '');
    }).catch((err) => setLoadError(err instanceof Error ? err.message : '加载失败'));
  }, [projectId, projects, rememberProject]);

  const groups = useMemo(() => {
    const result: { name: string; items: Scene[] }[] = [];
    (project?.scenes || []).forEach((scene) => {
      const last = result[result.length - 1];
      if (!last || last.name !== scene.groupName) result.push({ name: scene.groupName, items: [scene] });
      else last.items.push(scene);
    });
    return result;
  }, [project?.scenes]);
  const active = project?.scenes.find((s) => s.id === activeId) || project?.scenes[0];

  function openEditor(scene: Scene) {
    setEditing(scene);
    setForm({ heading: scene.heading, place: scene.place, time: scene.time, content: scene.content, status: scene.status, groupName: scene.groupName });
  }

  async function saveScene() {
    if (!editing) return;
    setSaving(true);
    try {
      const { scene } = await api.updateScene(editing.id, { ...form });
      setProject((prev) => prev ? { ...prev, scenes: prev.scenes.map((s) => s.id === scene.id ? scene : s) } : prev);
      setEditing(null);
      toast('场次已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    } finally {
      setSaving(false);
    }
  }

  async function removeScene(scene: Scene) {
    if (!window.confirm(`确定删除场次「${scene.number} ${scene.place}」？该场分镜会一并删除，且不可恢复。`)) return;
    try {
      await api.deleteScene(scene.id);
      const remaining = (project?.scenes || []).filter((s) => s.id !== scene.id);
      setProject((prev) => prev ? { ...prev, scenes: remaining, shots: prev.shots.filter((s) => s.sceneId !== scene.id) } : prev);
      setActiveId(remaining[0]?.id || '');
      setEditing(null);
      toast('场次已删除');
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除场次失败', 'warn');
    }
  }

  async function removeShot(shot: Shot) {
    if (!window.confirm(`确定删除镜头 ${shot.shotNo}？此操作不可恢复。`)) return;
    try {
      await api.deleteShot(shot.id);
      setProject((prev) => prev ? { ...prev, shots: prev.shots.filter((s) => s.id !== shot.id) } : prev);
      setEditingShot(null);
      toast('镜头已删除');
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除镜头失败', 'warn');
    }
  }

  const sceneShots = project?.shots.filter((shot) => shot.sceneId === active?.id) || [];

  function openShot(shot: Shot) {
    setEditingShot(shot);
    setShotForm({
      shotNo: shot.shotNo, shotType: shot.shotType, camera: shot.camera, duration: shot.duration,
      description: shot.description, notes: shot.notes,
    });
  }

  async function saveShot() {
    if (!editingShot) return;
    setSaving(true);
    try {
      const { shot } = await api.updateShot(editingShot.id, { ...shotForm });
      setProject((prev) => prev ? { ...prev, shots: prev.shots.map((s) => s.id === shot.id ? shot : s) } : prev);
      setEditingShot(null);
      toast('分镜已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    } finally {
      setSaving(false);
    }
  }

  async function generateShots() {
    if (!active) return;
    if (sceneShots.length) {
      setMode('boards');
      toast('已打开本场分镜板');
      return;
    }
    try {
      const { shots } = await api.generateShots(active.id);
      setProject((prev) => prev ? { ...prev, shots: [...prev.shots, ...shots] } : prev);
      setMode('boards');
      toast('已生成本场分镜草案');
    } catch (err) {
      toast(err instanceof Error ? err.message : '生成分镜失败', 'warn');
    }
  }

  async function addScene() {
    if (!project) return;
    const maxNumber = project.scenes.reduce((max, s) => Math.max(max, Number(s.number) || 0), 0);
    const number = String(maxNumber + 1);
    try {
      const { scene } = await api.createScene(project.id, {
        number,
        groupName: project.scenes[project.scenes.length - 1]?.groupName || '第一幕',
        place: '未命名场景',
        time: '日',
        heading: `${number}. 内景 · 未命名场景 · 日`,
        content: '',
        status: '草稿',
      });
      setProject((prev) => prev ? { ...prev, scenes: [...prev.scenes, scene] } : prev);
      setActiveId(scene.id);
      openEditor(scene);
      toast('已添加场次');
    } catch (err) {
      toast(err instanceof Error ? err.message : '添加场次失败', 'warn');
    }
  }

  if (!project) return (
    <div className={`loading-screen${loadError ? ' loading-screen--error' : ''}`}>
      <span className="brand__seal">私</span>
      {loadError ? <><strong>打不开剧本工坊</strong><p>{loadError}</p><Link className="btn btn--ghost btn--sm" to="/">返回书房</Link></> : <p>正在打开剧本工坊…</p>}
    </div>
  );
  const writtenScenes = project.scenes.filter((scene) => scene.content.trim()).length;
  const sceneProgress = project.scenes.length ? Math.round((writtenScenes / project.scenes.length) * 100) : 0;
  const topbar = (
    <>
      <div className="topbar-left"><Link className="tb-crumb__back" to="/"><Icon name="arrow-left" /></Link><div className="tb-project"><Cover project={project} variant="mini" /><div className="tb-project__info"><div className="tb-project__title">{project.title}<span className="tb-tag">{typeLabel[project.type]}</span></div><span className="tb-project__meta">{project.genre}</span></div></div></div>
      <nav className="topbar-tabs"><Link to={`/project/${project.id}/screenplay`} className="is-active">剧本</Link><Link to={`/project/${project.id}/outline`}>大纲</Link><Link to={`/project/${project.id}/codex`}>设定</Link></nav>
      <div className="topbar-actions"><span className="tb-words"><b>{project.scenes.length}</b> 场</span><div className="tb-divider" /><button className="icon-btn tb-icon" type="button" onClick={() => { void api.downloadProjectDocx(project.id).catch((err) => toast(err instanceof Error ? err.message : '导出失败', 'warn')); }} title="导出 Word"><Icon name="book" /></button>
        <button className="icon-btn tb-icon" type="button" onClick={() => { void api.downloadProjectMarkdown(project.id).catch((err) => toast(err instanceof Error ? err.message : '导出失败', 'warn')); }} title="导出 Markdown"><Icon name="download" /></button><Link className="icon-btn tb-icon" to="/settings"><Icon name="settings" /></Link><button className="avatar" type="button">{(settings.profile?.name || '写作者').slice(0, 1)}</button></div>
    </>
  );
  const panel = (
    <>
      <div className="panel-project"><Cover project={project} variant="mini" /><div className="panel-project__info"><strong>{project.title}</strong><span>{typeLabel[project.type]} · 本地数据库</span></div><Link className="icon-btn icon-btn--sm" to={`/project/${project.id}/outline`}><Icon name="chevron-down" /></Link></div>
      <div className="panel-scroll">
        <div className="panel-section-head"><span>场次 <em>{project.scenes.length} 场</em></span><button className="icon-btn icon-btn--sm" type="button" onClick={addScene}><Icon name="plus" /></button></div>
        <div className="scene-tree">
          {groups.map((group) => (
            <div key={group.name}>
              <div className="scene-group">{group.name}</div>
              {group.items.map((scene) => (
                <button key={scene.id} type="button" className={`scene-item${scene.id === active?.id ? ' is-active' : ''}`} onClick={() => setActiveId(scene.id)}>
                  <span className="scene-item__no">{scene.number}</span>
                  <span className="scene-item__body"><strong>{scene.place}</strong><em>{scene.time}</em></span>
                  <span className="scene-item__page">{scene.status}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="panel-foot"><div className="goal-mini"><span>剧本进度</span><strong>{writtenScenes} / {project.scenes.length} <em>场有正文</em></strong><span className="goal-mini__pct">{project.status}</span></div><div className="pbar pbar--jade"><i style={{ width: `${sceneProgress}%` }} /></div><div className="screenplay-hint"><Icon name="film" /> {project.shots.length} 个分镜已保存</div></div>
    </>
  );

  return (
    <AppShell active="screenplay" projectId={project.id} topbar={topbar} panel={panel}>
      <section className="view view--screenplay is-active">
        <div className="screenplay">
          <div className="script-stage">
            <div className="script-modebar"><div className="segmented"><button className={mode === 'script' ? 'is-active' : ''} type="button" onClick={() => setMode('script')}><Icon name="type" /> 剧本正文</button><button className={mode === 'boards' ? 'is-active' : ''} type="button" onClick={() => setMode('boards')}><Icon name="grid" /> 分镜板</button></div><div className="script-modebar__meta"><span>场 {active?.number || '—'} · 共 {project.scenes.length} 场</span><button className="btn btn--tiny btn--ghost" type="button" title="按每场 3 分钟粗略估算，不是正文计时"><Icon name="clock" /> 估算 {Math.max(1, project.scenes.length * 3)} 分钟</button></div></div>
            {mode === 'script' ? (
              <div className="script-pane is-active">
                {active ? (
                  <div className="script-paper">
                    <div className="script-page-meta"><span>《{project.title}》</span><span>{project.status} · 本地数据库</span></div>
                    <div className="script-page">
                      <div className="scene-heading">{active.heading}</div>
                      {active.content.split(/\n{2,}/).filter(Boolean).map((block, i) => <p key={i} className="action">{block}</p>)}
                    </div>
                    <div className="script-page-foot"><span>{settings.profile?.name || '写作者'}</span><span className="page-no">{active.number}.</span></div>
                  </div>
                ) : (
                  <div className="empty-state"><span className="empty-state__icon"><Icon name="clapper" /></span><strong>这个项目还没有场次</strong><p>从左侧添加第一场戏，或新建一个电影剧本项目。</p><Link className="btn btn--tiny btn--primary" to="/">返回作品库</Link></div>
                )}
              </div>
            ) : (
              <div className="script-pane is-active">
                {active ? (
                  <>
                    <div className="board-head"><div><h2>场 {active.number} · {active.place}</h2><p>{sceneShots.length} 个镜头 · 点击卡片编辑 · 镜头草案保存在本地数据库</p></div><button className="btn btn--tiny btn--ghost" type="button" onClick={generateShots}><Icon name="refresh" /> {sceneShots.length ? '查看分镜' : '生成分镜'}</button></div>
                    {sceneShots.length ? (
                      <div className="board-grid">
                        {sceneShots.map((shot, i) => (
                          <article key={shot.id} className="shot-card" role="button" tabIndex={0} onClick={() => openShot(shot)} onKeyDown={(e) => { if (e.key === 'Enter') openShot(shot); }}>
                            <div className={`shot-frame shot-frame--${(i % 6) + 1}`}><span className="shot-frame__no">{shot.shotNo}</span><span className="shot-frame__label">{shot.shotType}</span></div>
                            <div className="shot-info"><strong>{shot.description || '未命名镜头'}</strong><p>{shot.camera} · {shot.duration}</p></div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state"><span className="empty-state__icon"><Icon name="film" /></span><strong>这一场还没有分镜</strong><p>先让 AI 生成一份 6 个镜头的草案，再逐个修改。</p><button className="btn btn--tiny btn--primary" type="button" onClick={generateShots}>生成 6 个分镜</button></div>
                    )}
                  </>
                ) : <div className="empty-state"><strong>先选择一场戏</strong></div>}
              </div>
            )}
          </div>
          <aside className="script-inspector">
            <div className="script-inspector__head"><span>本场分析</span><span className="tag tag--hint">示意</span></div>
            <h3>{active ? `场 ${active.number} · ${active.place}` : '未选择场次'}</h3>
            <p className="script-inspector__note">下面的评分与描述是界面示意，不来自本场正文分析，也不代表全书质量。</p>
            <div className="score-row"><div className="score"><strong>4.5</strong><span>张力</span></div><div className="score"><strong>4.0</strong><span>节奏</span></div><div className="score"><strong>3.5</strong><span>信息</span></div></div>
            <div className="script-inspector__section"><h4>本场功能 · 示例</h4><p>让观众先于人物感到不安，把“早已沉没”的事实变成可见的证据。</p></div>
            <div className="script-inspector__section"><h4>潜台词 · 示例</h4><p>人物说出口的每一句话，都在回避真正的问题。</p></div>
            <div className="script-inspector__section"><h4>人物在场</h4><div className="scene-cast">{project.characters.slice(0, 2).map((c) => <span key={c.id}><i className={`char-avatar char-avatar--${c.id.replace('char_', '')} char-avatar--xs`}>{c.avatar || c.name.slice(0, 1)}</i>{c.name}</span>)}</div></div>
            <div className="ai-tip ai-tip--panel"><Icon name="spark" /><p>本场已保存 {sceneShots.length} 个分镜镜头。分镜编辑会写回 SQLite。</p></div>
            <div className="inspector__actions"><button className="btn btn--ghost" type="button" onClick={() => active && openEditor(active)}><Icon name="pen" /> 编辑本场</button><button className="btn btn--ghost" type="button" onClick={generateShots}><Icon name="film" /> {sceneShots.length ? '查看分镜' : '生成分镜'}</button></div>
            <div className="script-inspector__foot">场次状态 · {active?.status || '—'}</div>
          </aside>
        </div>
      </section>
      {editing && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal modal--scene" role="dialog" aria-modal="true">
            <header className="modal__head"><div><p className="modal__eyebrow">剧本场次 · {editing.number}</p><h2>编辑场景</h2></div><button className="icon-btn" type="button" onClick={() => setEditing(null)}><Icon name="x" /></button></header>
            <div className="wizard-body">
              <div className="form-block"><label className="form-label">场景标题</label><input className="text-input" value={form.heading} onChange={(e) => setForm({ ...form, heading: e.target.value })} /></div>
              <div className="form-row"><div className="form-block"><label className="form-label">地点</label><input className="text-input" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} /></div><div className="form-block"><label className="form-label">时间</label><select className="text-input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}><option>日</option><option>夜</option><option>清晨</option><option>黄昏</option></select></div></div>
              <div className="form-row"><div className="form-block"><label className="form-label">幕</label><input className="text-input" value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} /></div><div className="form-block"><label className="form-label">状态</label><select className="text-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>草稿</option><option>初稿</option><option>定稿</option></select></div></div>
              <div className="form-block"><label className="form-label">正文 <span>动作、角色与对白，空行分段</span></label><textarea className="text-input text-input--area script-textarea" rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
            </div>
            <footer className="modal__foot"><span className="modal__hint">保存后会立即写入本地数据库。</span><div className="modal__foot-actions"><button className="btn btn--ghost insight-form__danger" type="button" onClick={() => void removeScene(editing)}><Icon name="trash" /> 删除场次</button><button className="btn btn--ghost" type="button" onClick={() => setEditing(null)}>取消</button><button className="btn btn--primary" type="button" disabled={saving} onClick={saveScene}>{saving ? '保存中…' : '保存场次'}</button></div></footer>
          </div>
        </div>
      )}
      {editingShot && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingShot(null); }}>
          <div className="modal modal--shot" role="dialog" aria-modal="true">
            <header className="modal__head"><div><p className="modal__eyebrow">分镜 · 镜头 {editingShot.shotNo}</p><h2>编辑分镜</h2></div><button className="icon-btn" type="button" onClick={() => setEditingShot(null)}><Icon name="x" /></button></header>
            <div className="wizard-body">
              <div className="form-row"><div className="form-block"><label className="form-label">镜头号</label><input className="text-input" value={shotForm.shotNo} onChange={(e) => setShotForm({ ...shotForm, shotNo: e.target.value })} /></div><div className="form-block"><label className="form-label">景别</label><select className="text-input" value={shotForm.shotType} onChange={(e) => setShotForm({ ...shotForm, shotType: e.target.value })}><option>远景</option><option>全景</option><option>中景</option><option>近景</option><option>特写</option><option>过肩</option></select></div></div>
              <div className="form-row"><div className="form-block"><label className="form-label">运镜</label><input className="text-input" value={shotForm.camera} onChange={(e) => setShotForm({ ...shotForm, camera: e.target.value })} /></div><div className="form-block"><label className="form-label">时长</label><input className="text-input" value={shotForm.duration} onChange={(e) => setShotForm({ ...shotForm, duration: e.target.value })} /></div></div>
              <div className="form-block"><label className="form-label">画面内容</label><input className="text-input" value={shotForm.description} onChange={(e) => setShotForm({ ...shotForm, description: e.target.value })} /></div>
              <div className="form-block"><label className="form-label">备注 / 声音</label><textarea className="text-input text-input--area" rows={3} value={shotForm.notes} onChange={(e) => setShotForm({ ...shotForm, notes: e.target.value })} /></div>
            </div>
            <footer className="modal__foot"><span className="modal__hint">分镜字段会保存到 SQLite。</span><div className="modal__foot-actions"><button className="btn btn--ghost insight-form__danger" type="button" onClick={() => void removeShot(editingShot)}><Icon name="trash" /> 删除镜头</button><button className="btn btn--ghost" type="button" onClick={() => setEditingShot(null)}>取消</button><button className="btn btn--primary" type="button" disabled={saving} onClick={saveShot}>{saving ? '保存中…' : '保存分镜'}</button></div></footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
