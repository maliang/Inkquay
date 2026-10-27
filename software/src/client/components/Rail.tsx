import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Icon } from './Icon';

export function Rail({ active, projectId }: { active: 'library' | 'studio' | 'outline' | 'codex' | 'screenplay'; projectId?: string | null }) {
  const { lastProjectId, projects, settings } = useApp();
  const name = settings.profile?.name || '写作者';
  const location = useLocation();
  const pid = projectId || lastProjectId || projects[0]?.id || '';
  const screenplayId = projects.find((p) => p.type === 'screenplay')?.id || pid;
  const writeId = projects.find((p) => p.id === pid && p.type !== 'screenplay')?.id
    || projects.find((p) => p.type !== 'screenplay')?.id
    || pid;
  const sections = [
    { key: 'library', label: '作品库', icon: 'book', to: '/' },
    { key: 'studio', label: '写作台', icon: 'pen', to: `/project/${writeId}` },
    { key: 'outline', label: '大纲', icon: 'map', to: `/project/${pid}/outline`, needsProject: true },
    { key: 'codex', label: '设定', icon: 'users', to: `/project/${pid}/codex`, needsProject: true },
    { key: 'screenplay', label: '剧本', icon: 'clapper', to: `/project/${screenplayId}/screenplay`, needsProject: true },
  ] as const;
  return (
    <aside className="rail" aria-label="主导航">
      <Link className="brand" to="/" aria-label="私家写手首页"><img className="brand__logo" src="/logo.svg" alt="Inkquay 私家写手" /></Link>
      <nav className="rail-nav">
        {sections.map((s) => ('needsProject' in s && s.needsProject && !projectId ? (
          <span key={s.key} className="rail-btn is-disabled" title={`先打开一本作品，再进入${s.label}`} aria-disabled="true">
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </span>
        ) : (
          <Link key={s.key} to={s.to} className={`rail-btn${active === s.key ? ' is-active' : ''}`} title={s.label}>
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </Link>
        )))}
      </nav>
      <div className="rail-foot">
        <Link className={`rail-btn rail-btn--quiet${location.pathname === '/settings' ? ' is-active' : ''}`} to="/settings" title="设置">
          <Icon name="settings" />
          <span>设置</span>
        </Link>
        <button className="avatar avatar--rail" type="button" title={`${name} · 本地工作区`}>{(name || '作').slice(0, 1)}</button>
      </div>
    </aside>
  );
}
