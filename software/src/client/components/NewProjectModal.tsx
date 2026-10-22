import { useEffect, useState } from 'react';
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

export function NewProjectModal({
  initialType = 'novel', onClose,
}: { initialType?: string; onClose: () => void }) {
  const { reload, rememberProject } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState(initialType);
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiPlan, setAiPlan] = useState(true);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function create() {
    if (!title.trim()) {
      toast('先给作品起个名字', 'warn');
      return;
    }
    setBusy(true);
    try {
      const genreMap: Record<string, string> = { novel: '悬疑 · 文学', short: '现实主义', screenplay: '犯罪 · 黑色电影', series: '悬疑 · 文学' };
      const result = await api.createProject({ title: title.trim(), type, genre: genreMap[type], description: premise.trim() });
      let preview: ProjectPlan | null = null;
      if (aiPlan && type !== 'screenplay') {
        setPlanning(true);
        try {
          const planned = await api.planProject(result.project.id);
          preview = planned.plan;
          toast('AI 企划完成：大纲、人物与第一章已生成');
        } catch (err) {
          toast(`作品已创建，但 AI 企划失败：${err instanceof Error ? err.message : '未知错误'}`, 'warn');
        } finally {
          setPlanning(false);
        }
      }
      await reload();
      rememberProject(result.project.id);
      toast(`《${result.project.title}》已创建`);
      const target = result.project.type === 'screenplay' ? `/project/${result.project.id}/screenplay` : `/project/${result.project.id}`;
      navigate(target, preview ? { state: { plan: preview } } : undefined);
    } catch (err) {
      toast(err instanceof Error ? err.message : '创建失败', 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal__head">
          <div>
            <p className="modal__eyebrow">新建作品</p>
            <h2>从一个念头开始</h2>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭"><Icon name="x" /></button>
        </header>
        <div className="wizard-body">
          <div className="form-block">
            <label className="form-label">选择体裁</label>
            <div className="type-options">
              {types.map((t) => (
                <button key={t.id} type="button" className={`type-option${type === t.id ? ' is-active' : ''}`} onClick={() => setType(t.id)}>
                  <Icon name={t.icon} />
                  <span><strong>{t.label}</strong><em>{t.desc}</em></span>
                  <Icon name="check" className="type-option__check" />
                </button>
              ))}
            </div>
          </div>
          <div className="form-block">
            <label className="form-label" htmlFor="np-title">作品名</label>
            <input id="np-title" className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：长夜将尽" autoFocus />
          </div>
          <div className="form-block">
            <label className="form-label" htmlFor="np-premise">一句话灵感 <span>可以稍后再补</span></label>
            <textarea id="np-premise" className="text-input text-input--area" rows={3} value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="一个替人写遗书的代笔人，收到了一封写给自己的遗书，落款日期是明天。" />
          </div>
        </div>
        {type !== 'screenplay' ? <label className="ai-plan-toggle"><input type="checkbox" checked={aiPlan} onChange={(e) => setAiPlan(e.target.checked)} /><span><Icon name="spark" /><div><strong>创建后让 AI 先做企划</strong><em>生成三幕大纲、主要人物和第一章初稿，你再删改</em></div></span></label> : null}
        <footer className="modal__foot">
          <span className="modal__hint">创建后会生成第一卷第一章，所有内容都可以之后继续修改。</span>
          <div className="modal__foot-actions">
            <button className="btn btn--ghost" type="button" onClick={onClose}>取消</button>
            <button className="btn btn--primary" type="button" onClick={create} disabled={busy}>
              {busy ? (planning ? 'AI 正在企划…' : '创建中…') : aiPlan && type !== 'screenplay' ? '创建并让 AI 企划' : '创建并开始写作'} <Icon name="arrow-right" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
