import type { ReactNode } from 'react';
import { Rail } from './Rail';

export function AppShell({
  active, projectId, topbar, panel, children,
}: {
  active: 'library' | 'pipeline' | 'studio' | 'outline' | 'codex' | 'screenplay';
  projectId?: string | null;
  topbar: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`app${panel ? '' : ' no-panel'}`}>
      <Rail active={active} projectId={projectId} />
      {panel ? <aside className="panel" aria-label="项目导航">{panel}</aside> : null}
      <main className="main">
        <header className="topbar">{topbar}</header>
        <div className="viewport">{children}</div>
      </main>
    </div>
  );
}
