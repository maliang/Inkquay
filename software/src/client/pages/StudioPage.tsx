import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { Chapter, ChapterVersion, ChatMessage, ProjectDetail, ProjectPlan, ProviderInfo } from '../../shared/types';
import { api, streamChat } from '../api';
import { AppShell } from '../components/AppShell';
import { ChapterEditor } from '../components/ChapterEditor';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { PlanReviewModal } from '../components/PlanReviewModal';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';

const typeLabel: Record<string, string> = { novel: '长篇小说', short: '短篇小说', screenplay: '电影剧本', series: '剧集大纲' };

function formatNumber(n: number) {
  return n.toLocaleString('en-US');
}

function countWords(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length + (text.match(/[A-Za-z0-9]+/g) || []).length;
}

function modelLabel(provider: ProviderInfo | undefined, modelId: string | undefined) {
  const model = provider?.models.find((m) => m.id === modelId);
  return model?.name || '选择模型';
}

export function StudioPage() {
  const { projectId = '' } = useParams();
  const location = useLocation();
  const { settings, providers, rememberProject, updateSettings } = useApp();
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [activeId, setActiveId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [aiTab, setAiTab] = useState<'write' | 'check' | 'versions'>('write');
  const [planningProject, setPlanningProject] = useState(false);
  const [planPreview, setPlanPreview] = useState<ProjectPlan | null>(null);
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [compareVersion, setCompareVersion] = useState<ChapterVersion | null>(null);
  const [selectionText, setSelectionText] = useState('');
  const [rewriteSource, setRewriteSource] = useState('');
  const [rewriteMessageId, setRewriteMessageId] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<{ id: string; title: string; content: string }>({ id: '', title: '', content: '' });

  const activeChapter = useMemo(() => project?.chapters.find((c) => c.id === activeId) || null, [project, activeId]);
  const currentProvider = providers.find((p) => p.id === settings.defaultModel?.providerId);
  const currentModel = modelLabel(currentProvider, settings.defaultModel?.modelId);
  const words = countWords(content);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.project(projectId)
      .then(({ project: next }) => {
        if (!alive) return;
        setProject(next);
        rememberProject(next.id);
        const remembered = localStorage.getItem(`pw.chapter.${next.id}`);
        const preferred = next.chapters.find((c) => c.id === remembered)
          || next.chapters.find((c) => c.status === '初稿' && c.content)
          || [...next.chapters].reverse().find((c) => c.content)
          || next.chapters[0];
        if (preferred) {
          setActiveId(preferred.id);
          setTitle(preferred.title);
          setContent(preferred.content);
          activeRef.current = { id: preferred.id, title: preferred.title, content: preferred.content };
        }
      })
      .catch((err) => toast(err instanceof Error ? err.message : '作品加载失败', 'warn'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, rememberProject, toast]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const active = activeRef.current;
      if (active.id) {
        void api.updateChapter(active.id, { title: active.title, content: active.content }).catch(() => {});
      }
    };
  }, [projectId]);

  useEffect(() => {
    const incoming = (location.state as { plan?: ProjectPlan } | null)?.plan;
    if (incoming) {
      setPlanPreview(incoming);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    chat.scrollTo({ top: chat.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
  }, [messages, streamText, streaming]);

  const refreshVersions = useCallback(async () => {
    if (!project || !activeId) return;
    try {
      const { versions: rows } = await api.versions(project.id, activeId);
      setVersions(rows);
    } catch {
      // version history is non-critical
    }
  }, [project?.id, activeId]);

  useEffect(() => { void refreshVersions(); }, [refreshVersions]);

  useEffect(() => {
    if (!project || !activeId) return;
    let alive = true;
    api.messages(project.id, activeId)
      .then(({ messages: rows }) => { if (alive) setMessages(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, [project?.id, activeId]);

  useEffect(() => {
    if (!activeChapter) return;
    const timer = window.setTimeout(() => {
      const saved = project?.chapters.find((c) => c.id === activeChapter.id);
      if (saved && saved.title !== title) {
        setProject((prev) => prev ? { ...prev, chapters: prev.chapters.map((c) => c.id === saved.id ? { ...c, title } : c) } : prev);
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [title, activeChapter, project?.chapters]);

  const saveNow = useCallback(async () => {
    const active = activeRef.current;
    if (!active.id) return;
    setSaveState('saving');
    try {
      const { chapter } = await api.updateChapter(active.id, { title: active.title, content: active.content });
      setProject((prev) => {
        if (!prev) return prev;
        const chapters = prev.chapters.map((c) => c.id === chapter.id ? chapter : c);
        return { ...prev, chapters, totalWords: chapters.reduce((sum, c) => sum + c.words, 0) };
      });
      setSaveState('saved');
    } catch (err) {
      setSaveState('dirty');
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    }
  }, [toast]);

  const scheduleSave = useCallback((nextTitle = title, nextContent = content) => {
    activeRef.current = { id: activeId, title: nextTitle, content: nextContent };
    setSaveState('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void saveNow(); }, 800);
  }, [activeId, content, saveNow, title]);

  function switchChapter(chapter: Chapter) {
    if (chapter.id === activeId) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    void saveNow();
    setActiveId(chapter.id);
    setTitle(chapter.title);
    setContent(chapter.content);
    activeRef.current = { id: chapter.id, title: chapter.title, content: chapter.content };
    setSaveState('saved');
    localStorage.setItem(`pw.chapter.${projectId}`, chapter.id);
  }

  async function addChapter() {
    if (!project) return;
    try {
      const last = project.chapters[project.chapters.length - 1];
      const n = project.chapters.length + 1;
      const { chapter } = await api.createChapter(project.id, {
        title: '未命名章节',
        volume: last?.volume || '第一卷',
        number: `第${n}章`,
      });
      setProject((prev) => prev ? { ...prev, chapters: [...prev.chapters, chapter] } : prev);
      switchChapter(chapter);
    } catch (err) {
      toast(err instanceof Error ? err.message : '新建章节失败', 'warn');
    }
  }

  async function sendPrompt(text = input, regenerate = false, onAssistantDone?: (id: string) => void) {
    const prompt = text.trim();
    if (!prompt || streaming || !project) return;
    setInput('');
    setStreaming(true);
    setStreamText('');
    if (!regenerate) {
      const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, projectId: project.id, chapterId: activeId, role: 'user', content: prompt, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, optimistic]);
    }
    const controller = new AbortController();
    abortRef.current = controller;
    let assistant = '';
    try {
      await streamChat({
        projectId: project.id,
        chapterId: activeId || null,
        prompt,
        providerId: settings.defaultModel?.providerId,
        modelId: settings.defaultModel?.modelId,
        regenerate,
      }, {
        onMeta: () => {},
        onDelta: (delta) => {
          assistant += delta;
          setStreamText(assistant);
        },
        onDone: (done) => {
          const id = done?.messageId || `ai-${Date.now()}`;
          setMessages((prev) => [...prev, {
            id,
            projectId: project.id,
            chapterId: activeId,
            role: 'assistant',
            content: assistant,
            createdAt: new Date().toISOString(),
          }]);
          setStreamText('');
          setStreaming(false);
          onAssistantDone?.(id);
        },
        onError: (message) => {
          toast(message, 'warn');
          setStreaming(false);
          setStreamText('');
        },
      }, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) toast(err instanceof Error ? err.message : 'AI 请求失败', 'warn');
      setStreaming(false);
      setStreamText('');
    } finally {
      abortRef.current = null;
    }
  }

  function regenerate(message: ChatMessage) {
    if (!project || streaming) return;
    const index = messages.findIndex((m) => m.id === message.id);
    if (index < 0) return;
    const previousUser = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user');
    if (!previousUser) return;
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    void sendPrompt(previousUser.content, true);
  }

  async function refreshMessages() {
    if (!project) return;
    try {
      const { messages: rows } = await api.messages(project.id, activeId || null);
      setMessages(rows);
      setStreamText('');
      toast('已刷新本章对话');
    } catch (err) {
      toast(err instanceof Error ? err.message : '刷新失败', 'warn');
    }
  }

  function rewriteSelection(kind: '改写' | '扩写' | '精简' | '换语气') {
    if (!selectionText || streaming) return;
    const source = selectionText;
    setRewriteSource(source);
    setRewriteMessageId('');
    const instructions: Record<typeof kind, string> = {
      '改写': '保持原意、人物语气和叙事视角，改写下面这段文字。只输出改写后的正文，不要解释。',
      '扩写': '扩写下面这段文字，增加动作、感官或环境细节，不要新增关键情节。只输出扩写后的正文。',
      '精简': '精简下面这段文字，保留必要信息和语气，删掉重复与多余修饰。只输出精简后的正文。',
      '换语气': '保持信息不变，换一种更克制、更文学的中文语气重写下面这段。只输出改写后的正文。',
    };
    setSelectionText('');
    void sendPrompt(`${instructions[kind]}\n\n${source}`, false, (id) => setRewriteMessageId(id));
  }

  function replaceSelection(message: ChatMessage) {
    if (!rewriteSource || !message.content) return;
    if (!content.includes(rewriteSource)) {
      toast('原文已变化，找不到刚才选中的段落', 'warn');
      return;
    }
    const next = content.replace(rewriteSource, message.content.trim());
    if (activeId) void api.snapshotChapter(activeId, '改写前', content, title).then(refreshVersions);
    setContent(next);
    activeRef.current = { id: activeId, title, content: next };
    if (editorRef.current) editorRef.current.innerHTML = htmlFromContent(next);
    scheduleSave(title, next);
    if (activeId) void api.snapshotChapter(activeId, 'AI 改写', next, title).then(refreshVersions);
    setRewriteSource('');
    setRewriteMessageId('');
    toast('已替换选中段落');
  }

  async function restoreVersion(version: ChapterVersion) {
    if (!activeId) return;
    try {
      const result = await api.restoreVersion(activeId, version.id);
      setContent(result.chapter.content);
      setTitle(result.chapter.title);
      activeRef.current = { id: activeId, title: result.chapter.title, content: result.chapter.content };
      if (editorRef.current) editorRef.current.innerHTML = htmlFromContent(result.chapter.content);
      setProject((prev) => prev ? { ...prev, chapters: prev.chapters.map((c) => c.id === result.chapter.id ? result.chapter : c) } : prev);
      setVersions(result.versions);
      setCompareVersion(null);
      setSaveState('saved');
      toast('已恢复这一版');
    } catch (err) {
      toast(err instanceof Error ? err.message : '恢复失败', 'warn');
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamText('');
  }

  function htmlFromContent(text: string) {
    return text.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('');
  }

  async function runPlan() {
    if (!project || planningProject) return;
    setPlanningProject(true);
    try {
      const { plan } = await api.planProject(project.id);
      setPlanPreview(plan);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'AI 企划失败', 'warn');
    } finally {
      setPlanningProject(false);
    }
  }

  function applyPlan(updated: ProjectDetail) {
    setProject(updated);
    const first = updated.chapters[0];
    if (first) {
      setActiveId(first.id);
      setTitle(first.title);
      setContent(first.content);
      activeRef.current = { id: first.id, title: first.title, content: first.content };
      if (editorRef.current) editorRef.current.innerHTML = htmlFromContent(first.content);
    }
    setSaveState('saved');
    setPlanPreview(null);
    void refreshVersions();
    toast('已应用选中的企划内容');
  }

  function insertText(text: string) {
    if (!text) return;
    const next = content ? `${content}\n\n${text}` : text;
    if (activeId) void api.snapshotChapter(activeId, 'AI 插入前', content, title).then(refreshVersions);
    setContent(next);
    activeRef.current = { id: activeId, title, content: next };
    if (editorRef.current) editorRef.current.innerHTML = htmlFromContent(next);
    scheduleSave(title, next);
    if (activeId) void api.snapshotChapter(activeId, 'AI 插入', next, title).then(refreshVersions);
    toast('已插入正文');
  }

  async function selectModel(providerId: string, modelId: string) {
    try {
      await updateSettings({ defaultModel: { providerId, modelId } });
      setModelOpen(false);
      toast('默认模型已切换');
    } catch (err) {
      toast(err instanceof Error ? err.message : '切换模型失败', 'warn');
    }
  }

  const modelOptions = providers.flatMap((provider) => {
    if (!provider.configured || !provider.enabled) return [];
    return provider.enabledModels.map((id) => {
      const model = provider.models.find((m) => m.id === id);
      return model ? { providerId: provider.id, providerName: provider.name, model } : null;
    }).filter(Boolean) as { providerId: string; providerName: string; model: { id: string; name: string; ctx: string } }[];
  });

  const groupedChapters = useMemo(() => {
    const groups: { volume: string; items: Chapter[] }[] = [];
    (project?.chapters || []).forEach((chapter) => {
      const last = groups[groups.length - 1];
      if (!last || last.volume !== chapter.volume) groups.push({ volume: chapter.volume, items: [chapter] });
      else last.items.push(chapter);
    });
    return groups;
  }, [project?.chapters]);

  if (loading || !project) {
    return <div className="loading-screen"><span className="brand__seal">私</span><p>正在打开写作台…</p></div>;
  }

  const pendingForeshadows = project.foreshadows.filter((f) => f.status !== '已回收' && f.status !== '已放弃');
  const emptyChapters = project.chapters.filter((c) => !c.content.trim());
  const localChecks = [
    !content.trim() ? { tone: 'check-item--warn', title: '本章还没有正文', level: '开始', body: '先写或让 AI 生成一段正文，再做连续性判断。', meta: `当前：${activeChapter?.number || '本章'}` } : null,
    project.characters.length === 0 ? { tone: 'check-item--warn', title: '人物库为空', level: '高', body: 'AI 仍可写，但会使用通用称呼，人物语气容易漂移。建议先补 1–2 个主要人物。', meta: '设定库' } : null,
    pendingForeshadows.length > 0 ? { tone: 'check-item--flag', title: `${pendingForeshadows.length} 条伏笔待回收`, level: '低', body: `包括「${pendingForeshadows[0].name}」等；在设定页可以修改状态或计划回收章节。`, meta: '伏笔台账' } : null,
    emptyChapters.length > 1 ? { tone: '', title: `${emptyChapters.length} 个章节还没有正文`, level: '中', body: '这些章节会拉低整体进度，也会让 AI 难以理解前后文。', meta: '目录' } : null,
  ].filter(Boolean) as { tone: string; title: string; level: string; body: string; meta: string }[];

  const topbar = (
    <>
      <div className="topbar-left">
        <Link className="tb-crumb__back" to="/" title="返回作品库"><Icon name="arrow-left" /></Link>
        <div className="tb-project">
          <Cover project={project} variant="mini" />
          <div className="tb-project__info">
            <div className="tb-project__title">{project.title}<span className="tb-tag">{typeLabel[project.type] || project.type}</span></div>
            <span className="tb-project__meta">{project.genre}</span>
          </div>
          <button className="icon-btn icon-btn--sm" type="button" title="作品设置" onClick={() => setProjectSettingsOpen(true)}><Icon name="more" /></button>
        </div>
      </div>
      <nav className="topbar-tabs">
        <Link to={`/project/${project.id}`} className="is-active">正文</Link>
        <Link to={`/project/${project.id}/outline`}>大纲</Link>
        <Link to={`/project/${project.id}/codex`}>设定</Link>
      </nav>
      <div className="topbar-actions">
        <span className={`tb-save`}><i style={{ background: saveState === 'saved' ? 'var(--jade)' : 'var(--gold)' }} />{saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '有未保存修改'}</span>
        <span className="tb-words"><b>{formatNumber(project.totalWords)}</b> 字</span>
        <div className="tb-divider" />
        <a className="icon-btn tb-icon" href={api.exportProjectDocx(project.id)} title="导出 Word"><Icon name="book" /></a>
        <a className="icon-btn tb-icon" href={api.exportProject(project.id)} title="导出 Markdown"><Icon name="download" /></a>
        <Link className="icon-btn tb-icon" to="/settings" title="设置"><Icon name="settings" /></Link>
        <button className="avatar" type="button" title={settings.profile?.name || '写作者'}>{(settings.profile?.name || '写作者').slice(0, 1)}</button>
      </div>
    </>
  );

  const panel = (
    <>
      <div className="panel-project">
        <Cover project={project} variant="mini" />
        <div className="panel-project__info"><strong>{project.title}</strong><span>{typeLabel[project.type]} · 本地数据库</span></div>
        <Link className="icon-btn icon-btn--sm" to={`/project/${project.id}/codex`} title="人物设定"><Icon name="chevron-down" /></Link>
      </div>
      <div className="panel-scroll">
        <div className="panel-section-head">
          <span>目录 <em>{project.chapters.length} 章</em></span>
          <div className="panel-section-tools">
            <button className="icon-btn icon-btn--sm" type="button" onClick={addChapter} aria-label="新建章节"><Icon name="plus" /></button>
          </div>
        </div>
        <div className="chapter-tree">
          {groupedChapters.map((group) => (
            <div key={group.volume}>
              <div className="tree-volume"><Icon name="book" />{group.volume}<em>{group.items.length} 章</em></div>
              {group.items.map((chapter) => (
                <button key={chapter.id} type="button" className={`chapter-item${chapter.id === activeId ? ' is-active' : ''}${!chapter.content ? ' is-draft' : ''}`} onClick={() => switchChapter(chapter)}>
                  <span className="chapter-item__no">{chapter.number.replace('第', '').replace('章', '')}</span>
                  <span className="chapter-item__title">{chapter.title}</span>
                  <span className="chapter-item__meta">{formatNumber(chapter.words)} 字</span>
                </button>
              ))}
            </div>
          ))}
          <button className="chapter-item chapter-item--add" type="button" onClick={addChapter}><Icon name="plus" /> 新建章节</button>
        </div>
        <div className="panel-note">
          <div className="panel-note__head"><span><Icon name="bookmark" /> 本地保存</span><span className="sync-dot">自动</span></div>
          <p>自动保存已开启。所有修改会写入本地 SQLite，刷新后仍然保留。</p>
          <div className="panel-note__foot"><span># 本地优先</span><span># 自动保存</span><em>刚刚</em></div>
        </div>
      </div>
      <div className="panel-foot">
        <div className="goal-mini"><span>本书进度</span><strong>{formatNumber(project.totalWords)} <em>/ {formatNumber(project.goalWords)} 字</em></strong><span className="goal-mini__pct">{Math.max(1, Math.round((project.totalWords / project.goalWords) * 100))}%</span></div>
        <div className="pbar pbar--accent"><i style={{ width: `${Math.max(1, Math.min(100, (project.totalWords / project.goalWords) * 100))}%` }} /></div>
        <button className="btn btn--ghost btn--block" type="button" onClick={addChapter}><Icon name="plus" /> 新建章节</button>
      </div>
    </>
  );

  return (
    <AppShell active="studio" projectId={project.id} topbar={topbar} panel={panel}>
      <section className="view view--studio is-active">
        <div className="studio">
          <div className="doc-pane">
            <div className="doc-toolbar">
              <div className="doc-toolbar__group">
                <button className="tool-btn" type="button" title="加粗" onClick={() => document.execCommand('bold')}><Icon name="bold" /></button>
                <button className="tool-btn" type="button" title="斜体" onClick={() => document.execCommand('italic')}><Icon name="italic" /></button>
                <button className="tool-btn" type="button" title="引用" onClick={() => document.execCommand('formatBlock', false, 'blockquote')}><Icon name="blockquote" /></button>
                <span className="tool-sep" />
                <button className="tool-btn" type="button" title="列表" onClick={() => document.execCommand('insertUnorderedList')}><Icon name="list" /></button>
                <button className="tool-btn" type="button" title="插入分隔线" onClick={() => {
                  if (!editorRef.current) return;
                  document.execCommand('insertHTML', false, '<p>＊　＊　＊</p>');
                  const next = editorRef.current.innerText;
                  setContent(next);
                  scheduleSave(title, next);
                }}><Icon name="columns" /></button>
                <button className="tool-btn tool-btn--ai" type="button" title="让 AI 续写" onClick={() => sendPrompt('续写下一段，保持当前文风。')}><Icon name="spark" /><span>AI</span></button>
              </div>
              <div className="doc-toolbar__group doc-toolbar__group--right">
                <span className="tool-meta">约 {Math.max(1, Math.ceil(words / 400))} 分钟阅读</span>
                <button className="tool-btn" type="button" title="专注模式" onClick={() => document.querySelector('.app')?.classList.toggle('focus-mode')}><Icon name="focus" /></button>
              </div>
            </div>
            <div className="doc-scroll">
              <article className="doc">
                <div className="doc-kicker"><span>{activeChapter?.volume}</span><i /><span>{activeChapter?.number}</span></div>
                <input
                  className="doc-title doc-title-input"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); scheduleSave(e.target.value, content); }}
                  onBlur={() => saveNow()}
                />
                <div className="doc-meta">
                  <span className="save-state"><i style={{ background: saveState === 'saved' ? 'var(--jade)' : 'var(--gold)' }} />{saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '有未保存修改'}</span>
                  <span>·</span><span>{formatNumber(words)} 字</span><span>·</span><span>{activeChapter?.status}</span>
                </div>
                {selectionText ? (
                  <div className="selection-toolbar">
                    <span className="selection-toolbar__label">已选中 {countWords(selectionText)} 字</span>
                    <div className="selection-toolbar__actions">
                      {(['改写', '扩写', '精简', '换语气'] as const).map((kind) => <button key={kind} type="button" disabled={streaming} onClick={() => rewriteSelection(kind)}>{kind}</button>)}
                      <button type="button" className="selection-toolbar__cancel" onClick={() => setSelectionText('')}>取消</button>
                    </div>
                  </div>
                ) : null}
                {activeChapter && !content.trim() ? (
                  <div className="draft-start">
                    <span className="draft-start__label">这一章还没有字</span>
                    <h3>让 AI 起个头，或者自己写第一句。</h3>
                    <p>AI 会读取当前作品的人物、大纲和上一章，不会凭空乱写。</p>
                    <div className="draft-start__actions">
                      {project.outline.beats.length === 0 && project.characters.length === 0 ? (
                        <>
                          <button className="btn btn--primary btn--sm" type="button" disabled={planningProject || streaming} onClick={runPlan}><Icon name="map" /> {planningProject ? 'AI 正在企划…' : 'AI 企划这一本'}</button>
                          <button className="btn btn--ghost btn--sm" type="button" disabled={planningProject || streaming} onClick={() => sendPrompt('写这一章的开头。先用一个具体的动作或环境细节把读者带进来，不要解释背景。')}>跳过企划，直接写</button>
                        </>
                      ) : (
                        <button className="btn btn--primary btn--sm" type="button" disabled={streaming} onClick={() => sendPrompt('写这一章的开头。先用一个具体的动作或环境细节把读者带进来，不要解释背景。')}><Icon name="spark" /> AI 写第一段</button>
                      )}
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => editorRef.current?.focus()}>自己写第一句</button>
                    </div>
                  </div>
                ) : null}
                {activeChapter ? (
                  <ChapterEditor
                    chapter={{ ...activeChapter, title, content }}
                    editorRef={editorRef}
                    onChange={(next) => { setSelectionText(''); setContent(next); scheduleSave(title, next); }}
                    onSelectionChange={setSelectionText}
                  />
                ) : null}
                <div className="ghost-block">
                  <div className="ghost-block__head"><span><Icon name="spark" /> AI 建议续写</span><span className="ghost-block__hint">来自本地演示模型</span></div>
                  <p>{streaming ? (streamText || '正在生成…') : '选中一段正文，或直接告诉 AI 你想推进什么。'}</p>
                  <div className="ghost-block__actions">
                    <button className="btn btn--tiny btn--primary" type="button" disabled={streaming || !streamText} onClick={() => insertText(streamText)}>接受</button>
                    <button className="btn btn--tiny btn--ghost" type="button" onClick={() => sendPrompt('换一个方向：让当前场景里的来客更不确定，不要解释原因。')}>换一个</button>
                    <button className="btn btn--tiny btn--ghost" type="button" onClick={() => setStreamText('')}>忽略</button>
                  </div>
                </div>
                <div className="editor-end"><span /><Icon name="pen" /><span /></div>
              </article>
            </div>
            <footer className="doc-statusbar">
              <div className="doc-statusbar__left"><span className="status-dot" /><span>{saveState === 'saved' ? '已自动保存' : '保存中…'}</span><i /><span>本章 <b>{formatNumber(words)}</b> 字</span></div>
              <div className="doc-statusbar__right"><span>本地 SQLite</span><i /><span>自动保存</span></div>
            </footer>
          </div>

          <aside className="ai-panel">
            <header className="ai-head">
              <div className="ai-head__title">
                <span className="ai-badge"><Icon name="spark" /></span><strong>AI 共笔</strong>
                <button className="model-pill" type="button" onClick={() => setModelOpen((v) => !v)}>
                  {currentModel} <Icon name="chevron-down" />
                </button>
              </div>
              <div className="ai-head__actions">
                <button className="icon-btn icon-btn--sm" type="button" onClick={refreshMessages} title="刷新本章对话"><Icon name="refresh" /></button>
              </div>
            </header>
            {modelOpen && (
              <div className="model-menu">
                <div className="popover__head">选择默认模型</div>
                {modelOptions.map((option) => (
                  <button key={`${option.providerId}-${option.model.id}`} className={`popover__item${settings.defaultModel?.providerId === option.providerId && settings.defaultModel?.modelId === option.model.id ? ' is-active' : ''}`} type="button" onClick={() => selectModel(option.providerId, option.model.id)}>
                    <span><strong>{option.model.name}</strong><em>{option.providerName} · {option.model.ctx}</em></span>
                    <Icon name="check" />
                  </button>
                ))}
                <div className="popover__foot"><Link to="/settings" className="text-btn">管理供应商 <Icon name="arrow-right" /></Link></div>
              </div>
            )}
            <div className="ai-tabs">
              <button className={`ai-tab${aiTab === 'write' ? ' is-active' : ''}`} type="button" onClick={() => setAiTab('write')}>共笔</button>
              <button className={`ai-tab${aiTab === 'check' ? ' is-active' : ''}`} type="button" onClick={() => setAiTab('check')}>本地检查 <span className="ai-tab__badge">{localChecks.length}</span></button>
              <button className={`ai-tab${aiTab === 'versions' ? ' is-active' : ''}`} type="button" onClick={() => { setAiTab('versions'); void refreshVersions(); }}>版本 <span className="ai-tab__badge">{versions.length}</span></button>
            </div>

            {aiTab === 'write' ? (
              <>
                <div className="ai-body">
                  <div className="memory-card">
                    <div className="memory-card__head"><span><Icon name="layers" /> 已启用记忆</span><span className="memory-card__tokens">{project.characters.length} 人物 · {project.chapters.length} 章</span></div>
                    <div className="memory-chips">
                      <span className="memory-chip"><Icon name="type" />本章正文</span>
                      {project.characters.slice(0, 2).map((c) => <span className="memory-chip" key={c.id}><Icon name="users" />{c.name}</span>)}
                      <span className="memory-chip"><Icon name="pin" />{project.title}</span>
                      <span className="memory-chip"><Icon name="flag" />伏笔 {project.foreshadows.length}</span>
                    </div>
                  </div>
                  <div className="chat" ref={chatRef}>
                    <div className="msg msg--ai">
                      <div className="msg__avatar"><Icon name="spark" /></div>
                      <div className="msg__main">
                        <div className="msg__name">共笔助手 <span>读完作品设定后</span></div>
                        <div className="msg__bubble">我在《{project.title}》的本地工作区里。当前是「{activeChapter?.number} {activeChapter?.title}」，你想续写气氛、补对白，还是推进一个线索？</div>
                        <div className="msg__quick">
                          <button type="button" onClick={() => sendPrompt('先写气氛：用环境、声音和光线压住节奏，不要揭晓来客身份。')}>先写气氛</button>
                          <button type="button" onClick={() => sendPrompt('推进当前来客的身份，但只给一个不可靠的线索。')}>推进身份</button>
                          <button type="button" onClick={() => sendPrompt('给主角加一个下意识的动作，暗示他认识这个人。')}>加一个暗示</button>
                        </div>
                      </div>
                    </div>
                    {messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((message) => (
                      <div key={message.id} className={`msg msg--${message.role === 'user' ? 'user' : 'ai'}`}>
                        {message.role === 'assistant' && <div className="msg__avatar"><Icon name="spark" /></div>}
                        <div className="msg__main">
                          {message.role === 'assistant' && <div className="msg__name">共笔助手 <span>已保存到本地</span></div>}
                          <div className={`msg__bubble${message.role === 'assistant' ? ' msg__bubble--prose' : ''}`}>
                            {message.content.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
                          </div>
                          {message.role === 'assistant' && (
                            <div className="msg__actions">
                              <button className="msg-action" type="button" disabled={streaming} onClick={() => regenerate(message)}><Icon name="refresh" /> 重新生成</button>
                              {rewriteMessageId === message.id ? <button className="msg-action" type="button" onClick={() => replaceSelection(message)}><Icon name="insert" /> 替换选中</button> : null}
                              <button className="msg-action" type="button" onClick={() => insertText(message.content)}><Icon name="insert" /> 插入正文</button>
                              <button className="msg-action" type="button" onClick={() => navigator.clipboard?.writeText(message.content)}><Icon name="copy" /> 复制</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {streamText && (
                      <div className="msg msg--ai">
                        <div className="msg__avatar"><Icon name="spark" /></div>
                        <div className="msg__main"><div className="msg__name">共笔助手 <span>正在生成…</span></div><div className="msg__bubble msg__bubble--prose"><p>{streamText}</p></div></div>
                      </div>
                    )}
                  </div>
                  <div className="quick-actions">
                    {['续写下一段', '加强氛围', '补一段对白', '埋一个伏笔'].map((label) => (
                      <button key={label} type="button" onClick={() => {
                        const cast = project.characters.slice(0, 2).map((c) => c.name).join('和') || '主角和来客';
                        sendPrompt(label === '续写下一段' ? '续写下一段，保持当前的人称、节奏和压迫感。' : label === '加强氛围' ? '加强这一段的氛围，多用听觉和触觉，不要增加新情节。' : label === '补一段对白' ? `写一段${cast}的对话，每句话都不超过十五个字。` : `在下一个场景里埋一条与《${project.title}》核心秘密有关的伏笔。`);
                      }}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="ai-composer">
                  <div className="composer-box">
                    <textarea id="ai-input" rows={2} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void sendPrompt(); } }} placeholder="告诉 AI 你想怎么写…" />
                    <div className="composer-tools">
                      <div className="composer-tools__left"><button className="icon-btn icon-btn--sm" type="button" title="引用当前章节"><Icon name="layers" /></button><button className="icon-btn icon-btn--sm" type="button" title="引用人物"><Icon name="quote" /></button></div>
                      <button className="send-btn" type="button" onClick={() => { if (streaming) stopStreaming(); else void sendPrompt(); }} aria-label={streaming ? '停止' : '发送'}><Icon name={streaming ? 'x' : 'arrow-up'} /></button>
                    </div>
                  </div>
                  <div className="composer-hint"><span>⌘ ↵ 发送</span><span>由 {currentProvider?.name || '本地演示'} 提供</span></div>
                </div>
              </>
            ) : aiTab === 'check' ? (
              <div className="ai-check">
                <div className="check-summary"><div className="check-ring"><strong>{localChecks.length}</strong><span>待处理</span></div><div><strong>本地检查</strong><p>基于当前作品数据，不调用模型</p></div></div>
                <div className="check-list">
                  {localChecks.length ? localChecks.map((item) => (
                    <article key={item.title} className={`check-item ${item.tone}`}>
                      <div className="check-item__head"><Icon name={item.level === '低' ? 'flag' : 'alert'} /><span>{item.title}</span><em>{item.level}</em></div>
                      <p>{item.body}</p>
                      <div className="check-item__foot"><span>{item.meta}</span></div>
                    </article>
                  )) : (
                    <article className="check-item"><div className="check-item__head"><Icon name="check" /><span>没有发现明显问题</span><em>好</em></div><p>本章有正文、人物库与伏笔状态都正常。可以继续写，或者让 AI 读一遍当前章节。</p><div className="check-item__foot"><span>本地数据库</span></div></article>
                  )}
                </div>
                <div className="check-foot"><span>检查范围 · 当前作品</span><span>刷新页面后重新计算</span></div>
              </div>
            ) : (
              <div className="ai-check version-pane">
                <div className="check-summary"><div className="check-ring"><strong>{versions.length}</strong><span>个版本</span></div><div><strong>生成版本</strong><p>AI 插入、改写和企划都会留下快照</p></div></div>
                <div className="version-list">
                  {versions.length ? versions.map((version) => (
                    <button key={version.id} type="button" className="version-item" onClick={() => setCompareVersion(version)}>
                      <span className="version-item__dot" />
                      <span className="version-item__body"><strong>{version.source}</strong><em>{version.title} · {new Date(version.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em></span>
                      <span className="version-item__words">{formatNumber(version.words)} 字</span>
                      <Icon name="chevron-right" />
                    </button>
                  )) : <div className="empty-state version-empty"><span className="empty-state__icon"><Icon name="clock" /></span><strong>还没有版本</strong><p>插入 AI 文本、选区改写或应用企划后，这里会留下可回退的快照。</p></div>}
                </div>
                <div className="check-foot"><span>最多保留 40 个版本</span><span>回退前会自动保存当前稿</span></div>
              </div>
            )}
          </aside>
        </div>
      </section>
      {compareVersion && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCompareVersion(null); }}>
          <div className="modal version-compare" role="dialog" aria-modal="true" aria-label="版本对比">
            <header className="modal__head"><div><p className="modal__eyebrow">版本对比 · {compareVersion.source}</p><h2>{compareVersion.title}</h2></div><button className="icon-btn" type="button" onClick={() => setCompareVersion(null)}><Icon name="x" /></button></header>
            <div className="version-compare__body">
              <section><header>这一版 <span>{formatNumber(compareVersion.words)} 字</span></header><div className="version-text">{compareVersion.content || '（空章节）'}</div></section>
              <section><header>当前正文 <span>{formatNumber(words)} 字</span></header><div className="version-text">{content || '（空章节）'}</div></section>
            </div>
            <footer className="modal__foot"><span className="modal__hint">恢复会覆盖当前正文；覆盖前会自动保存当前稿。</span><div className="modal__foot-actions"><button className="btn btn--ghost" type="button" onClick={() => setCompareVersion(null)}>关闭</button><button className="btn btn--primary" type="button" onClick={() => restoreVersion(compareVersion)}>恢复这一版</button></div></footer>
          </div>
        </div>
      )}
      {planPreview && <PlanReviewModal projectId={project.id} plan={planPreview} onClose={() => setPlanPreview(null)} onApplied={applyPlan} />}
      {projectSettingsOpen && <ProjectSettingsModal project={project} onClose={() => setProjectSettingsOpen(false)} onSaved={(updated) => setProject((prev) => prev ? { ...prev, ...updated } : prev)} />}
    </AppShell>
  );
}
