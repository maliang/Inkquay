import { useEffect, useRef, useState } from 'react';
import type { ProjectPlan } from '../../shared/types';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon } from './Icon';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';

const types = [
  { id: 'novel', icon: 'book', label: '长篇小说', desc: '10 万字以上，多线叙事' },
  { id: 'short', icon: 'feather', label: '短篇小说', desc: '3,000–15,000 字，单一冲突' },
  { id: 'screenplay', icon: 'clapper', label: '电影剧本', desc: '90–120 分钟，场次与对白' },
  { id: 'series', icon: 'film', label: '剧集大纲', desc: '多集叙事，每集一个钩子' },
];

type CreatedProject = { id: string; title: string; type: string };

export function NewProjectModal({
  initialType = 'novel', initialPremise = '', onClose,
}: { initialType?: string; initialPremise?: string; onClose: () => void }) {
  const { settings, reload, rememberProject } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState(initialType);
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState(initialPremise);
  const [busy, setBusy] = useState(false);
  const [aiPlan, setAiPlan] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [planError, setPlanError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const createdRef = useRef<CreatedProject | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, planning]);

  function targetFor(project: CreatedProject) {
    return project.type === 'screenplay' ? `/project/${project.id}/screenplay` : `/project/${project.id}`;
  }

  function finish(project: CreatedProject, preview: ProjectPlan | null) {
    toast(`《${project.title}》已创建`);
    navigate(targetFor(project), preview ? { state: { plan: preview } } : undefined);
  }

  function handleClose() {
    if (busy && !planning) {
      toast('正在创建作品，请稍候', 'warn');
      return;
    }
    if (planning) {
      abortRef.current?.abort();
      setPlanning(false);
      setBusy(false);
      setPlanError('已取消 AI 企划。作品已经创建，可以进入写作台后点「AI 企划这一本」重试。');
      return;
    }
    onClose();
  }

  function cancelPlanning() {
    abortRef.current?.abort();
    setPlanning(false);
    setBusy(false);
    setPlanError('已取消 AI 企划。作品已经创建，正文里还没有 AI 生成内容。');
  }

  async function generatePlan(project: CreatedProject) {
    setPlanning(true);
    setBusy(true);
    setPlanError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const planned = await api.planProject(project.id, controller.signal);
      if (controller.signal.aborted) return;
      setPlanning(false);
      setBusy(false);
      toast('AI 企划完成：大纲、人物与第一章已生成，请逐项确认');
      finish(project, planned.plan);
    } catch (err) {
      if (controller.signal.aborted) return;
      setPlanning(false);
      setBusy(false);
      setPlanError(`AI 企划失败：${err instanceof Error ? err.message : '未知错误'}。作品已经创建，可以重试，或先进入写作台。`);
    } finally {
      abortRef.current = null;
    }
  }

  async function create() {
    if (busy) return;
    if (!title.trim()) {
      toast('先给作品起个名字', 'warn');
      return;
    }
    setBusy(true);
    setPlanError('');
    try {
      const genreMap: Record<string, string> = { novel: '悬疑 · 文学', short: '现实主义', screenplay: '犯罪 · 黑色电影', series: '悬疑 · 文学' };
      const result = await api.createProject({
        title: title.trim(),
        type,
        genre: type === 'novel' ? (settings.prefs.genre || genreMap[type]) : genreMap[type],
        description: premise.trim(),
      });
      const next = { id: result.project.id, title: result.project.title, type: result.project.type };
      setCreated(next);
      createdRef.current = next;
      rememberProject(result.project.id);
      await reload();
      if (aiPlan && type !== 'screenplay') {
        await generatePlan(next);
        return;
      }
      setBusy(false);
      finish(next, null);
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error ? err.message : '创建失败', 'warn');
    }
  }

  function retryPlan() {
    const project = createdRef.current;
    if (project) void generatePlan(project);
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal__head">
          <div>
            <p className="modal__eyebrow">新建作品</p>
            <h2>从一个念头开始</h2>
          </div>
          <button className="icon-btn" type="button" onClick={handleClose} aria-label="关闭"><Icon name="x" /></button>
        </header>
        <div className="wizard-body">
          <div className="form-block">
            <label className="form-label">选择体裁</label>
            <div className="type-options">
              {types.map((t) => (
                <button key={t.id} type="button" className={`type-option${type === t.id ? ' is-active' : ''}`} onClick={() => setType(t.id)} disabled={Boolean(created)}>
                  <Icon name={t.icon} />
                  <span><strong>{t.label}</strong><em>{t.desc}</em></span>
                  <Icon name="check" className="type-option__check" />
                </button>
              ))}
            </div>
          </div>
          <div className="form-block">
            <label className="form-label" htmlFor="np-title">作品名</label>
            <input id="np-title" className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：长夜将尽" autoFocus disabled={Boolean(created)} />
          </div>
          <div className="form-block">
            <label className="form-label" htmlFor="np-premise">一句话灵感 <span>可以稍后再补</span></label>
            <textarea id="np-premise" className="text-input text-input--area" rows={3} value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="一个替人写遗书的代笔人，收到了一封写给自己的遗书，落款日期是明天。" disabled={Boolean(created)} />
          </div>
        </div>
        {type !== 'screenplay' && !created ? <label className="ai-plan-toggle"><input type="checkbox" checked={aiPlan} onChange={(e) => setAiPlan(e.target.checked)} /><span><Icon name="spark" /><div><strong>创建后让 AI 先做企划</strong><em>生成三幕大纲、主要人物和第一章初稿，你再删改</em></div></span></label> : null}
        {planError ? (
          <div className="modal__notice" role="alert">
            <Icon name="alert" />
            <div>
              <strong>作品已创建，企划没有完成</strong>
              <p>{planError}</p>
            </div>
          </div>
        ) : null}
        <footer className="modal__foot">
          <span className="modal__hint">
            {created ? `《${created.title}》已经在书房里；关闭本窗口不会删除它。` : '创建后会生成第一卷第一章，所有内容都可以之后继续修改。'}
          </span>
          <div className="modal__foot-actions">
            {planning ? (
              <button className="btn btn--ghost" type="button" onClick={cancelPlanning}>取消企划</button>
            ) : created ? (
              <>
                <button className="btn btn--ghost" type="button" onClick={() => finish(created, null)}>先进写作台</button>
                {type !== 'screenplay' && planError ? <button className="btn btn--ghost" type="button" onClick={retryPlan} disabled={busy}><Icon name="refresh" /> 重试 AI 企划</button> : null}
              </>
            ) : (
              <button className="btn btn--ghost" type="button" onClick={handleClose}>取消</button>
            )}
            {!created ? (
              <button className="btn btn--primary" type="button" onClick={create} disabled={busy}>
                {busy ? (planning ? 'AI 正在企划…' : '创建中…') : aiPlan && type !== 'screenplay' ? '创建并让 AI 企划' : '创建并开始写作'} <Icon name="arrow-right" />
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
