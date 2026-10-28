import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { applyAppearance } from '../theme';
import type { AppSettings, ProjectSummary, ProviderInfo } from '../../shared/types';

interface AppContextValue {
  loading: boolean;
  initialized: boolean;
  error: string | null;
  projects: ProjectSummary[];
  settings: AppSettings;
  providers: ProviderInfo[];
  reload: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  setProviders: (providers: ProviderInfo[]) => void;
  rememberProject: (id: string) => void;
  lastProjectId: string | null;
}

const fallbackSettings: AppSettings = {
  profile: { name: '', signature: '' },
  onboarding: { completed: false },
  appearance: { theme: 'ink', accent: 'cinnabar', customAccent: null, editorSize: 17.5, reduceMotion: false },
  prefs: { pov: '第三人称限知', genre: '悬疑 · 文学', aiLength: '中 · 约 500 字', autoSave: true, style: '克制留白' },
  generation: { temperature: 0.8, streaming: true },
  defaultModel: null,
  fallbackModel: null,
  reasoningLevel: 'default',
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [lastProjectId, setLastProjectId] = useState<string | null>(() => {
    try { return localStorage.getItem('pw.lastProject'); } catch { return null; }
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.bootstrap();
      setProjects(data.projects);
      setSettings(data.settings);
      setProviders(data.providers);
      applyAppearance(data.settings.appearance);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接本地服务');
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!loading) applyAppearance(settings.appearance);
  }, [settings.appearance, loading]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const result = await api.updateSettings(patch);
    setSettings(result.settings);
    applyAppearance(result.settings.appearance);
    return result.settings;
  }, []);

  const rememberProject = useCallback((id: string) => {
    setLastProjectId(id);
    try { localStorage.setItem('pw.lastProject', id); } catch { /* ignore */ }
  }, []);

  return (
    <AppContext.Provider value={{
      loading, initialized, error, projects, settings, providers, reload, updateSettings, setProviders, rememberProject, lastProjectId,
    }}>
      {children}
    </AppContext.Provider>
  );
}
