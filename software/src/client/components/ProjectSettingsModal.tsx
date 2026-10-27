import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectDetail, ProjectSummary } from '../../shared/types';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { Icon } from './Icon';

type DeletionImpact = {
  chapters: number;
  trashedChapters: number;
  scenes: number;
  shots: number;
  characters: number;
  foreshadows: number;
  versions: number;
};

const normalizeTitle = (value: string) => value.trim().replace(/^《/, '').replace(/》$/, '');

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
  const [confirmStep, setConfirmStep] = useState<'idle' | 'confirm'>('idle');
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [impactError, setImpactError] = useState('');
  const [impactLoading, setImpactLoading] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');

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

  async function toggleArchive() {
    await save(status === '已归档' ? '连载中' : '已归档');
  }

  /** 删除前的真实影响清单：接口临时不可用只降级展示，不阻塞（书名输入才是真正的闸门）。 */
  async function loadImpact() {
    setImpactLoading(true);
    setImpactError('');
    try {
      const [{ project: detail }, trash, bookVersions] = await Promise.all([
        api.project(project.id),
        api.trashChapters(project.id),
        api.versions(project.id),
      ]);
      const trashed = trash.chapters || [];
      const perChapter = await Promise.all(
        trashed.map((chapter) => api.versions(project.id, chapter.id).then((r) => r.versions.length).catch(() => 0)),
      );
      setImpact({
        chapters: detail.chapters.length,
        trashedChapters: trashed.length,
        scenes: detail.scenes.length,
        shots: detail.shots.length,
        characters: detail.characters.length,
        foreshadows: detail.foreshadows.length,
        versions: bookVersions.versions.length + perChapter.reduce((sum, n) => sum + n, 0),
      });
    } catch (err) {
      setImpact(null);
      setImpactError(err instanceof Error ? err.message : '清单加载失败');
    } finally {
      setImpactLoading(false);
    }
  }

  function openConfirm() {
    setConfirmStep('confirm');
    setTypedTitle('');
    void loadImpact();
  }

  function backToEdit() {
    setConfirmStep('idle');
    setTypedTitle('');
  }

  const typedOk = normalizeTitle(typedTitle) === normalizeTitle(project.title);
  const canDelete = confirmStep === 'confirm' && typedOk && !impactLoading && !busy;

  /** 确认区里按 Esc 只退回编辑态，绝不触发 DELETE（删除只能点「确认删除」）。 */
  useEffect(() => {
    if (confirmStep !== 'confirm') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      backToEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmStep]);

  async function remove() {
    if (!canDelete) return;
    setBusy(true);
    try {
      await api.deleteProject(project.id);
      await reload();
      toast(`《${project.title}》已删除`);
      navigate('/');
    } catch (err) {
      if ((err as Error & { status?: number }).status === 404) {
        toast('这部作品已经不存在了，已为你刷新列表', 'warn');
        await reload();
        navigate('/');
        return;
      }
      toast(err instanceof Error ? err.message : '删除失败', 'warn');
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--project-settings" role="dialog" aria-modal="true">
        <header className="modal__head"><div><p className="modal__eyebrow">作品设置</p><h2>{project.title}</h2></div><button className="icon-btn" type="button" onClick={onClose}><Icon name="x" /></button></header>
        {confirmStep === 'confirm' ? (
          <div className="wizard-body danger-body">
            <div className="danger-confirm">
              <h3 className="danger-confirm__title"><Icon name="trash" /> 永久删除《{project.title}》，不可恢复</h3>
              {impactLoading && <p className="danger-confirm__note">正在统计…</p>}
              {impactError && (
                <p className="danger-confirm__note">
                  清单暂时取不到，可重试
                  <button className="btn btn--ghost btn--tiny" type="button" onClick={() => void loadImpact()} disabled={impactLoading}>重试</button>
                </p>
              )}
              {impact && (
                <>
                  <p className="danger-confirm__note">以下内容会一并永久删除，回收站里也找不回来（章节回收站只保护单章删除）：</p>
                  <ul>
                    <li><span>章节</span><b>{impact.chapters}</b></li>
                    <li><span>回收站中的章节</span><b>{impact.trashedChapters}</b></li>
                    <li><span>剧本场次</span><b>{impact.scenes}</b></li>
                    <li><span>分镜</span><b>{impact.shots}</b></li>
                    <li><span>人物</span><b>{impact.characters}</b></li>
                    <li><span>伏笔</span><b>{impact.foreshadows}</b></li>
                    <li><span>历史版本</span><b>{impact.versions}</b></li>
                  </ul>
                </>
              )}
              <label className="danger-confirm__gate">
                <span>请输入书名 <b>{project.title}</b> 以确认：</span>
                <input
                  className="text-input"
                  value={typedTitle}
                  onChange={(e) => setTypedTitle(e.target.value)}
                  placeholder={project.title}
                  autoFocus
                />
              </label>
              <div className="danger-confirm__actions">
                <button className="btn btn--danger" type="button" disabled={!canDelete} onClick={() => void remove()}>
                  <Icon name="trash" /> {busy ? '删除中…' : '确认删除'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="wizard-body">
            <div className="form-block"><label className="form-label">作品名</label><input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="form-row">
              <div className="form-block"><label className="form-label">题材</label><input className="text-input" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="悬疑 · 文学" /></div>
              <div className="form-block"><label className="form-label">目标字数</label><input className="text-input" type="number" min={1000} value={goalWords} onChange={(e) => setGoalWords(Number(e.target.value))} /></div>
            </div>
            <div className="form-block"><label className="form-label">状态</label><select className="text-input" value={status} onChange={(e) => setStatus(e.target.value)}><option>草稿</option><option>连载中</option><option>修改中</option><option>第二稿</option><option>已归档</option></select></div>
            <div className="form-block"><label className="form-label">故事梗概</label><textarea className="text-input text-input--area" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <p className="settings-footnote"><Icon name="shield" /> 删除作品会级联删除章节、设定、剧本场次、分镜、伏笔和 AI 对话，无法撤销。章节回收站只保护单章删除。</p>
          </div>
        )}
        <footer className="modal__foot modal__foot--spread">
          {confirmStep === 'confirm' ? (
            <>
              <span className="settings-footnote"><Icon name="shield" /> 此操作不可恢复</span>
              <div className="modal__foot-actions">
                <button className="btn btn--ghost" type="button" disabled={busy} onClick={backToEdit}>返回</button>
                <button className="btn btn--ghost" type="button" disabled={busy} onClick={onClose}>取消</button>
              </div>
            </>
          ) : (
            <>
              <button className="btn btn--ghost btn--danger" type="button" disabled={busy} onClick={openConfirm}><Icon name="trash" /> 删除作品</button>
              <div className="modal__foot-actions">
                <button className="btn btn--ghost" type="button" disabled={busy} onClick={toggleArchive}>{status === '已归档' ? '移出归档' : '归档'}</button>
                <button className="btn btn--ghost" type="button" onClick={onClose}>取消</button>
                <button className="btn btn--primary" type="button" disabled={busy} onClick={() => save()}>{busy ? '保存中…' : '保存信息'}</button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
