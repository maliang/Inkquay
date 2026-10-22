import type { ProjectSummary } from '../../shared/types';
import { useApp } from '../context/AppContext';

export function Cover({
  project, variant = 'card', mark,
}: { project: Pick<ProjectSummary, 'cover' | 'title'>; variant?: 'card' | 'hero' | 'mini'; mark?: string }) {
  const { settings } = useApp();
  const author = settings.profile?.name || '写作者';
  const coverClass = `cover cover--${project.cover} cover--${variant}`;
  if (variant === 'hero') {
    return (
      <div className={coverClass}>
        <span className="cover__title">{project.title.slice(0, 2)}<br />{project.title.slice(2, 4)}</span>
        <span className="cover__author">{author}</span>
        <span className="cover__lighthouse" aria-hidden="true" />
        <span className="cover__beam" aria-hidden="true" />
        <span className="cover__fogline" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={coverClass}>
      <span className="cover__mark">{mark || project.title.slice(0, 1)}</span>
    </div>
  );
}
