import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectDetail, ProjectSummary } from '../../shared/types';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { Icon } from './Icon';

export function ProjectSettingsModal({
  project, onClose, onSaved,
}: {
  project: ProjectSummary | ProjectDetail;
  onClose: () => void;
  onSaved?: (project: ProjectDetail) => void;
}) {
  const { reload } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(project.title);
  const [genre, setGenre] = useState(project.genre);
  const [description, setDescription] = useState(project.description);
  const [goalWords, setGoalWords] = useState(project.goalWords);
  const [status, setStatus] = useState(project.status);
  const [busy, setBusy] = useState(false);

  async function save(nextStatus = status) {
    if (!title.trim()) { toast('作品名不能为空', 'warn'); return; }
    setBusy(true);
    try {
      const { project: updated } = await api.updateProject(project.id, {
        title: title.trim(), genre, description, goalWords: Number(goalWords) || project.goalWords, status: nextStatus,
      });
      await reload();
      onSaved?.(updated);
      toast('作品信息已保存');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    await save('已归档');
  }

  async function remove() {
    if (!window.confirm(`删除《${project.title}》？所有章节、人物、设定和 AI 对话都会一起删除。`)) return;
    setBusy(true);
    try {
      await api.deleteProject(project.id);
      await reload();
      toast('作品已删除');
      navigate('/');
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'warn');
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--project-settings" role="dialog" aria-modal="true">
        <header className="modal__head"><div><p className="modal__eyebrow">作品设置</p><h2>{project.title}</h2></div><button className="icon-btn" type="button" onClick={onClose}><Icon name="x" /></button></header>
        <div className="wizard-body">
          <div className="form-block"><label className="form-label">作品名</label><input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="form-row">
            <div className="form-block"><label className="form-label">题材</label><input className="text-input" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="悬疑 · 文学" /></div>
            <div className="form-block"><label className="form-label">目标字数</label><input className="text-input" type="number" min={1000} value={goalWords} onChange={(e) => setGoalWords(Number(e.target.value))} /></div>
          </div>
          <div className="form-block"><label className="form-label">状态</label><select className="text-input" value={status} onChange={(e) => setStatus(e.target.value)}><option>草稿</option><option>连载中</option><option>修改中</option><option>第二稿</option><option>已归档</option></select></div>
          <div className="form-block"><label className="form-label">故事梗概</label><textarea className="text-input text-input--area" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <p className="settings-footnote"><Icon name="shield" /> 删除作品会级联删除章节、设定、剧本场次、分镜、伏笔和 AI 对话，无法撤销。</p>
        </div>
        <footer className="modal__foot modal__foot--spread">
          <button className="btn btn--ghost btn--danger" type="button" disabled={busy} onClick={remove}><Icon name="trash" /> 删除作品</button>
          <div className="modal__foot-actions">
            <button className="btn btn--ghost" type="button" disabled={busy} onClick={archive}>归档</button>
            <button className="btn btn--ghost" type="button" onClick={onClose}>取消</button>
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => save()}>{busy ? '保存中…' : '保存信息'}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
