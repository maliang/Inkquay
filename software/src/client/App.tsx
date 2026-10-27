import { useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { runCloseGuards } from './lib/closeGuard';
import { LibraryPage } from './pages/LibraryPage';
import { StudioPage } from './pages/StudioPage';
import { OutlinePage } from './pages/OutlinePage';
import { CodexPage } from './pages/CodexPage';
import { ScreenplayPage } from './pages/ScreenplayPage';
import { SettingsPage } from './pages/SettingsPage';
import { OnboardingPage } from './pages/OnboardingPage';

/**
 * 剧本项目不能落在章节写作台（那是「0 章 0 字」的空壳）。
 * 只在 studio 路由上拦截，outline/codex 必须放行 —— 剧本页顶栏的「大纲 / 设定」正指向它们。
 */
function StudioRoute() {
  const { projects } = useApp();
  const { projectId } = useParams();
  const target = projects.find((p) => p.id === projectId);
  if (target?.type === 'screenplay') return <Navigate replace to={`/project/${target.id}/screenplay`} />;
  return <StudioPage />;
}

export function App() {
  const { loading, initialized, error, reload, settings } = useApp();

  // 全应用唯一的关窗监听：桌面端只有一个 closeRequestWindow，多处监听会双 ack 丢稿。
  // 各页面通过 registerCloseGuard 注册自己的保存逻辑；没有守卫时立刻放行。
  useEffect(() => {
    const bridge = window.inkquayDesktop;
    if (!bridge) return;
    return bridge.onCloseRequest(() => {
      void (async () => {
        if (await runCloseGuards()) bridge.readyToClose();
        else bridge.cancelClose();
      })();
    });
  }, []);

  if (loading && !initialized) {
    return (
      <div className="loading-screen">
        <img className="loading-logo" src="/logo.svg" alt="私家写手" />
        <p>正在打开你的书房…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="loading-screen">
        <img className="loading-logo" src="/logo.svg" alt="私家写手" />
        <p>无法连接本地服务</p>
        <p style={{ fontSize: 10, color: 'var(--dim)' }}>{error}</p>
        <button className="btn btn--ghost" type="button" onClick={() => void reload()}>重试</button>
      </div>
    );
  }
  if (!settings.onboarding?.completed) {
    return <OnboardingPage />;
  }
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/project/:projectId" element={<StudioRoute />} />
      <Route path="/project/:projectId/outline" element={<OutlinePage />} />
      <Route path="/project/:projectId/codex" element={<CodexPage />} />
      <Route path="/project/:projectId/screenplay" element={<ScreenplayPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<LibraryPage />} />
    </Routes>
  );
}
