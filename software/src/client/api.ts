import type {
  AiStreamRequest,
  AppSettings,
  BootstrapResponse,
  Chapter,
  ChatMessage,
  ModelInfo,
  ProjectBundle,
  ProjectDetail,
  ProjectSummary,
  ProviderInfo,
} from '../shared/types.ts';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // 保留人话错误信息，同时带上状态码，方便调用方区分「404 已经不存在」和瞬时失败。
    const error = new Error((data as any)?.error || `请求失败（${response.status}）`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export const api = {
  bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),
  project: (id: string) => request<{ project: ProjectDetail }>(`/api/projects/${id}`),
  createProject: (input: { title: string; type: string; genre?: string; description?: string; goalWords?: number }) =>
    request<{ project: ProjectDetail }>('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
  updateProject: (id: string, patch: { title?: string; genre?: string; description?: string; status?: string; goalWords?: number }) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  updateChapter: (id: string, patch: { title?: string; content?: string; status?: string; volume?: string; number?: string }) =>
    request<{ chapter: Chapter }>(`/api/chapters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createChapter: (projectId: string, input: { title?: string; volume?: string; number?: string }) =>
    request<{ chapter: Chapter }>(`/api/projects/${projectId}/chapters`, { method: 'POST', body: JSON.stringify(input) }),
  deleteChapter: (id: string) =>
    request<{ ok: boolean; trashed?: boolean; versions: number }>(`/api/chapters/${id}`, { method: 'DELETE' }),
  trashChapters: (projectId: string) =>
    request<{ chapters: Chapter[] }>(`/api/projects/${projectId}/trash`),
  restoreChapter: (id: string) =>
    request<{ ok: boolean; chapter: Chapter; project: ProjectDetail }>(`/api/chapters/${id}/restore`, { method: 'POST' }),
  purgeChapter: (id: string) =>
    request<{ ok: boolean; versions: number }>(`/api/chapters/${id}/purge`, { method: 'DELETE' }),
  flushChapter: (id: string, patch: { content?: string; title?: string }) => {
    // pagehide 时普通 await 已来不及，用 keepalive 把最后一段输入发出去。
    try {
      void fetch(`/api/chapters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        keepalive: true,
      });
    } catch {
      // 页面正在关闭，失败也只能交给下次自动保存
    }
  },
  completeOnboarding: (input: {
    name: string; signature?: string; providerId: string; apiKey: string; baseUrl?: string; modelId: string;
  }) => request<{ settings: AppSettings; provider: ProviderInfo }>('/api/onboarding', { method: 'POST', body: JSON.stringify(input) }),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  providers: () => request<{ providers: ProviderInfo[] }>('/api/providers'),
  updateProvider: (id: string, patch: {
    name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean; enabledModels?: string[]; models?: ModelInfo[];
  }) => request<{ provider: ProviderInfo }>(`/api/providers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createProvider: (input: { name: string; kind?: string; baseUrl?: string; apiKey?: string; models?: ModelInfo[]; enabledModels?: string[] }) =>
    request<{ provider: ProviderInfo }>('/api/providers', { method: 'POST', body: JSON.stringify(input) }),
  testProvider: (id: string) => request<{ ok: boolean; message: string; models?: string[] }>(`/api/providers/${id}/test`, { method: 'POST' }),
  planProject: (id: string, signal?: AbortSignal) =>
    request<{ plan: import('../shared/types').ProjectPlan }>(`/api/projects/${id}/plan`, { method: 'POST', signal }),
  applyPlan: (id: string, plan: import('../shared/types').ProjectPlan) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}/plan/apply`, { method: 'POST', body: JSON.stringify({ plan }) }),
  versions: (projectId: string, chapterId?: string) =>
    request<{ versions: import('../shared/types').ChapterVersion[] }>(
      `/api/projects/${projectId}/versions${chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : ''}`,
    ),
  snapshotChapter: (chapterId: string, source: string, content?: string, title?: string) =>
    request<{ version: import('../shared/types').ChapterVersion }>(`/api/chapters/${chapterId}/versions`, { method: 'POST', body: JSON.stringify({ source, content, title }) }),
  restoreVersion: (chapterId: string, versionId: string) =>
    request<{ chapter: Chapter; versions: import('../shared/types').ChapterVersion[] }>(`/api/chapters/${chapterId}/versions/${versionId}/restore`, { method: 'POST' }),
  updateCharacter: (id: string, patch: Record<string, unknown>) =>
    request<{ character: import('../shared/types').Character }>(`/api/characters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCharacter: (id: string) =>
    request<{ ok: boolean }>(`/api/characters/${id}`, { method: 'DELETE' }),
  createCharacter: (projectId: string, input: Record<string, unknown>) =>
    request<{ character: import('../shared/types').Character }>(`/api/projects/${projectId}/characters`, { method: 'POST', body: JSON.stringify(input) }),
  updateBeat: (id: string, patch: Record<string, unknown>) =>
    request<{ beat: import('../shared/types').OutlineBeat }>(`/api/beats/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createBeat: (projectId: string, input: Record<string, unknown>) =>
    request<{ beat: import('../shared/types').OutlineBeat }>(`/api/projects/${projectId}/beats`, { method: 'POST', body: JSON.stringify(input) }),
  deleteBeat: (id: string) =>
    request<{ ok: boolean }>(`/api/beats/${id}`, { method: 'DELETE' }),
  reorderBeats: (projectId: string, beatIds: string[]) =>
    request<{ beats: import('../shared/types').OutlineBeat[] }>(`/api/projects/${projectId}/outline/reorder`, { method: 'PATCH', body: JSON.stringify({ beatIds }) }),
  updateScene: (id: string, patch: Record<string, unknown>) =>
    request<{ scene: import('../shared/types').Scene }>(`/api/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createScene: (projectId: string, input: Record<string, unknown>) =>
    request<{ scene: import('../shared/types').Scene }>(`/api/projects/${projectId}/scenes`, { method: 'POST', body: JSON.stringify(input) }),
  deleteScene: (id: string) =>
    request<{ ok: boolean }>(`/api/scenes/${id}`, { method: 'DELETE' }),
  updateShot: (id: string, patch: Record<string, unknown>) =>
    request<{ shot: import('../shared/types').Shot }>(`/api/shots/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createShot: (projectId: string, input: Record<string, unknown>) =>
    request<{ shot: import('../shared/types').Shot }>(`/api/projects/${projectId}/shots`, { method: 'POST', body: JSON.stringify(input) }),
  deleteShot: (id: string) =>
    request<{ ok: boolean }>(`/api/shots/${id}`, { method: 'DELETE' }),
  generateShots: (sceneId: string) =>
    request<{ shots: import('../shared/types').Shot[] }>(`/api/scenes/${sceneId}/shots/generate`, { method: 'POST' }),
  updateForeshadow: (id: string, patch: Record<string, unknown>) =>
    request<{ foreshadow: import('../shared/types').Foreshadow }>(`/api/foreshadows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createForeshadow: (projectId: string, input: Record<string, unknown>) =>
    request<{ foreshadow: import('../shared/types').Foreshadow }>(`/api/projects/${projectId}/foreshadows`, { method: 'POST', body: JSON.stringify(input) }),
  deleteForeshadow: (id: string) =>
    request<{ ok: boolean }>(`/api/foreshadows/${id}`, { method: 'DELETE' }),
  messages: (projectId: string, chapterId?: string | null) =>
    request<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/messages${chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : ''}`),
  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects'),
  downloadProjectMarkdown: (id: string, chapterId?: string | null) =>
    api.downloadFile(`/api/projects/${id}/export${chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : ''}`, '作品.md'),
  downloadProjectDocx: (id: string, chapterId?: string | null) =>
    api.downloadFile(`/api/projects/${id}/export.docx${chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : ''}`, '作品.docx'),
  downloadProjectBundle: (id: string) =>
    api.downloadFile(`/api/projects/${id}/bundle`, '作品.inkquay.json'),
  projectBundle: (id: string) => request<ProjectBundle>(`/api/projects/${id}/bundle`),
  importProject: (bundle: ProjectBundle) =>
    request<{ project: ProjectDetail }>('/api/projects/import', { method: 'POST', body: JSON.stringify({ bundle }) }),
  downloadFile: async (url: string, fallbackName: string) => {
    const response = await fetch(url);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as any)?.error || `下载失败（${response.status}）`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const name = encoded ? decodeURIComponent(encoded) : plain || fallbackName;
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  },
};

export interface StreamHandlers {
  onMeta?: (payload: { provider: string; model: string }) => void;
  onDelta: (text: string) => void;
  onDone?: (payload: { messageId?: string; provider?: string; model?: string; words?: number }) => void;
  onError?: (message: string) => void;
}

export async function streamChat(input: AiStreamRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `AI 请求失败（${response.status}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw);
        if (event.type === 'meta') handlers.onMeta?.(event);
        else if (event.type === 'delta') handlers.onDelta(event.text || '');
        else if (event.type === 'done') handlers.onDone?.(event);
        else if (event.type === 'error') handlers.onError?.(event.message || 'AI 请求失败');
      } catch {
        // ignore malformed event
      }
    }
  }
}
