import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { AppShell } from '../components/AppShell';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { NewProjectModal } from '../components/NewProjectModal';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import type { ProjectSummary } from '../../shared/types';

const typeLabel: Record<string, string> = { novel: '长篇小说', short: '短篇小说', screenplay: '电影剧本', series: '剧集大纲' };
const typeFilter: Record<string, string> = { novel: 'novel', short: 'short', screenplay: 'script', series: 'script' };

function formatNumber(n: number) {
  return n.toLocaleString('en-US');
}

export function LibraryPage() {
  const { projects, providers, loading, error, reload, settings } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [settingsProject, setSettingsProject] = useState<ProjectSummary | null>(null);
  const [newType, setNewType] = useState('novel');
  const [inspiration, setInspiration] = useState('如果访客带来的皮箱里，装的不是钱，而是一整箱从未寄出的信——故事会往哪里走？');

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) searchRef.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const totalWords = projects.reduce((sum, p) => sum + p.totalWords, 0);
  const totalChapters = projects.reduce((sum, p) => sum + p.chapterCount, 0);
  const connected = providers.filter((p) => p.configured && p.enabled).length;
  const totalGoal = projects.reduce((sum, p) => sum + p.goalWords, 0) || 1;
  const weeklyProgress = Math.max(1, Math.min(100, Math.round((totalWords / totalGoal) * 100)));
  const hero = projects[0];

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const matchesFilter = filter === 'all' || typeFilter[p.type] === filter;
      const text = `${p.title} ${p.description} ${p.genre}`.toLowerCase();
      return matchesFilter && (!query.trim() || text.includes(query.trim().toLowerCase()));
    });
  }, [projects, filter, query]);

  function openNew(type = 'novel') {
    setNewType(type);
    setNewOpen(true);
  }

  const topbar = (
    <>
      <div className="topbar-left">
        <div className="tb-crumb">
          <span className="tb-crumb__title">作品库</span>
          <span className="tb-crumb__sub">{projects.length} 部作品 · {(totalWords / 10000).toFixed(1)} 万字</span>
        </div>
      </div>
      <div className="topbar-tabs" />
      <div className="topbar-actions">
        <span className="tb-save"><i />本地数据库 · 已连接</span>
        <div className="tb-divider" />
        <button className="btn btn--primary btn--sm" type="button" onClick={() => openNew()}>
          <Icon name="plus" /> 新建作品
        </button>
      </div>
    </>
  );

  return (
    <AppShell active="library" topbar={topbar}>
      <section className="view view--library is-active">
        <div className="library">
          <header className="lib-head">
            <div className="lib-head__copy">
              <p className="eyebrow"><span className="eyebrow__dot" />{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
              <h1>下午好，{settings.profile?.name || '写作者'}<span>。</span></h1>
              <p className="lib-sub">{settings.profile?.signature || '故事还在雾里，但你已经知道它在哪。'}</p>
            </div>
            <div className="lib-head__actions">
              <label className="search-field">
                <Icon name="search" />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索作品、章节、人物" />
                <kbd>⌘ K</kbd>
              </label>
              <button className="btn btn--primary" type="button" onClick={() => openNew()}>
                <Icon name="plus" /> 新建作品
              </button>
            </div>
          </header>

          {loading && !projects.length ? <div className="empty-state"><strong>正在打开你的书房…</strong></div> : null}
          {error ? <div className="empty-state"><strong>无法连接本地服务</strong><p>{error}</p><button className="btn btn--ghost" type="button" onClick={() => void reload()}>重试</button></div> : null}

          {!loading && !error && projects.length === 0 && (
            <div className="first-run">
              <div className="first-run__seal">私</div>
              <p className="eyebrow"><span className="eyebrow__dot" />你的书房是空的</p>
              <h2>从一个念头开始。</h2>
              <p className="first-run__sub">先建一部作品，写下一句话；AI 会读着你的上下文，帮你往下写。</p>
              <div className="first-run__steps">
                <div><span>01</span><strong>新建第一部作品</strong><em>长篇、短篇或剧本，先有容器</em></div>
                <div><span>02</span><strong>让 AI 起个头</strong><em>默认本地演示模型，不需要 Key</em></div>
                <div><span>03</span><strong>你来删改与定稿</strong><em>AI 负责草稿，作者负责判断</em></div>
              </div>
              <div className="first-run__actions"><button className="btn btn--primary" type="button" onClick={() => openNew()}><Icon name="plus" /> 新建第一部作品</button><Link className="btn btn--ghost" to="/settings"><Icon name="server" /> 先配置模型</Link></div>
            </div>
          )}

          {!error && projects.length > 0 && (
            <>
              <div className="stat-row">
                <article className="stat-card">
                  <div className="stat-card__top"><span className="stat-card__label"><Icon name="book" /> 作品</span><span className="delta">本地数据库</span></div>
                  <div className="stat-card__value">{projects.length}<span>部</span></div>
                  <div className="stat-card__foot"><span>长篇小说 {projects.filter((p) => p.type === 'novel').length} 部</span><span>短篇 / 剧本 {projects.filter((p) => p.type !== 'novel').length} 部</span></div>
                </article>
                <article className="stat-card">
                  <div className="stat-card__top"><span className="stat-card__label"><Icon name="pen" /> 已写章节</span><span className="stat-card__badge">持续更新</span></div>
                  <div className="stat-card__value">{totalChapters}<span>章</span></div>
                  <div className="stat-card__foot"><span>所有作品合计</span><span>自动保存开启</span></div>
                </article>
                <article className="stat-card">
                  <div className="stat-card__top"><span className="stat-card__label"><Icon name="target" /> 总字数</span><span className="delta">{Math.round((totalWords / totalGoal) * 100)}%</span></div>
                  <div className="stat-card__value">{formatNumber(totalWords)}<span>字</span></div>
                  <div className="stat-card__foot"><div className="pbar pbar--wide"><i style={{ width: `${weeklyProgress}%` }} /></div></div>
                </article>
                <article className="stat-card">
                  <div className="stat-card__top"><span className="stat-card__label"><Icon name="spark" /> AI 供应商</span><span className="delta delta--up">已连接 {connected}</span></div>
                  <div className="stat-card__value">{providers.length}<span>个</span></div>
                  <div className="stat-card__foot"><span>含本地演示模型</span><Link className="text-btn" to="/settings">管理 <Icon name="arrow-right" /></Link></div>
                </article>
              </div>

              {hero && (
                <section className="continue-card">
                  <Cover project={hero} variant="hero" />
                  <div className="continue-card__body">
                    <span className="tag tag--live"><i />正在创作</span>
                    <h2>{hero.title}</h2>
                    <p className="continue-card__desc">{hero.description}</p>
                    <div className="continue-card__chapter">
                      <span>已写</span><strong>{hero.chapterCount} 章</strong><span className="muted">{formatNumber(hero.totalWords)} 字</span>
                    </div>
                    <blockquote>“门外的男人没有撑伞。雨水顺着他的帽檐往下滴，在门槛前积成一小片深色的海。”</blockquote>
                    <div className="continue-card__foot">
                      <div className="progress-block">
                        <div className="pbar pbar--wide"><i style={{ width: `${Math.max(1, Math.round((hero.totalWords / hero.goalWords) * 100))}%` }} /></div>
                        <span>{formatNumber(hero.totalWords)} / {formatNumber(hero.goalWords)} 字</span>
                      </div>
                      <button className="btn btn--primary" type="button" onClick={() => navigate(`/project/${hero.id}`)}>
                        继续写作 <Icon name="arrow-right" />
                      </button>
                    </div>
                  </div>
                  <div className="continue-card__aside">
                    <div className="progress-ring" style={{ '--progress': Math.max(1, Math.round((hero.totalWords / hero.goalWords) * 100)) } as CSSProperties}>
                      <div><strong>{Math.max(1, Math.round((hero.totalWords / hero.goalWords) * 100))}<span>%</span></strong><em>全书进度</em></div>
                    </div>
                    <div className="continue-card__mini"><span><b>{hero.chapterCount}</b> 章</span><span><b>{formatNumber(hero.totalWords)}</b> 字</span></div>
                    <span className="continue-card__hint">内容实时保存在本地数据库</span>
                  </div>
                </section>
              )}

              <div className="lib-cols">
                <div className="lib-main">
                  <div className="section-head">
                    <h2>我的作品 <span>{filtered.length}</span></h2>
                    <div className="filters">
                      {[['all', '全部'], ['novel', '长篇'], ['short', '短篇'], ['script', '剧本']].map(([id, label]) => (
                        <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="project-grid">
                    {filtered.map((project) => {
                      const progress = project.type === 'screenplay'
                        ? Math.round((project.totalWords / Math.max(project.goalWords, 1)) * 100)
                        : Math.max(1, Math.round((project.totalWords / Math.max(project.goalWords, 1)) * 100));
                      return (
                        <article key={project.id} className="project-card" role="button" tabIndex={0} onClick={() => navigate(project.type === 'screenplay' ? `/project/${project.id}/screenplay` : `/project/${project.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(project.type === 'screenplay' ? `/project/${project.id}/screenplay` : `/project/${project.id}`); }}>
                          <Cover project={project} />
                          <div className="project-card__body">
                            <div className="project-card__top"><h3>{project.title}</h3><span className={`tag${project.status === '连载中' ? ' tag--live' : ''}`}>{project.status}</span></div>
                            <p className="project-card__desc">{project.description}</p>
                            <div className="project-card__meta"><span>{typeLabel[project.type]}</span><i /><span>{formatNumber(project.totalWords)} {project.type === 'screenplay' ? '页' : '字'}</span><i /><span>{project.type === 'screenplay' ? `${project.chapterCount} 场` : `${project.chapterCount} 章`}</span></div>
                            <div className="project-card__progress"><div className={`pbar${project.type === 'screenplay' ? ' pbar--gold' : ''}`}><i style={{ width: `${Math.min(100, Math.max(1, progress))}%` }} /></div><span>{Math.min(100, Math.max(1, progress))}%</span></div>
                          </div>
                          <button className="icon-btn icon-btn--sm project-card__more" type="button" aria-label="作品设置" onClick={(e) => { e.stopPropagation(); setSettingsProject(project); }}><Icon name="more" /></button>
                        </article>
                      );
                    })}
                    <button className="project-card project-card--new" type="button" onClick={() => openNew()}>
                      <span className="new-project-icon"><Icon name="plus" /></span>
                      <strong>开始新的故事</strong>
                      <span>从一句话灵感，到完整大纲</span>
                    </button>
                  </div>
                  {!filtered.length && (
                    <div className="empty-state" style={{ marginTop: 12 }}>
                      <span className="empty-state__icon"><Icon name="search" /></span>
                      <strong>没有找到匹配的作品</strong>
                      <p>换个关键词，或清除筛选后再看看。</p>
                      <button className="btn btn--tiny btn--ghost" type="button" onClick={() => { setQuery(''); setFilter('all'); }}>清除搜索</button>
                    </div>
                  )}

                  <div className="section-head section-head--mt"><h2>让 AI 帮你开个头</h2><span className="section-head__hint">创建后会进入真正的写作台</span></div>
                  <div className="template-row">
                    {([
                      ['novel', 'book', '长篇小说', '世界观 · 人物弧光 · 分卷大纲', 'blue'],
                      ['short', 'feather', '短篇小说', '单一冲突 · 结尾反转 · 精炼语言', 'jade'],
                      ['screenplay', 'clapper', '电影剧本', '场次表 · 对白 · 分镜建议', 'gold'],
                      ['series', 'film', '剧集大纲', '多线叙事 · 分集钩子 · 人物关系', 'rose'],
                    ] as const).map(([type, icon, label, desc, color]) => (
                      <button key={type} className="template-card" type="button" onClick={() => openNew(type)}>
                        <span className={`template-card__icon template-card__icon--${color}`}><Icon name={icon} /></span>
                        <span className="template-card__body"><strong>{label}</strong><em>{desc}</em></span>
                        <Icon name="arrow-right" className="template-card__arrow" />
                      </button>
                    ))}
                  </div>
                </div>

                <aside className="lib-side">
                  <section className="side-card goal-card">
                    <div className="side-card__head"><h3>整体进度</h3><span className="tag">{projects.length} 部作品</span></div>
                    <div className="goal-card__body">
                      <div className="progress-ring progress-ring--lg" style={{ '--progress': weeklyProgress } as CSSProperties}>
                        <div><strong>{formatNumber(totalWords)}</strong><em>/ {formatNumber(totalGoal)} 字</em></div>
                      </div>
                      <div className="goal-card__note">
                        <span className="tag tag--accent">数据库已连接</span>
                        <p>所有章节改动都会自动保存到本地 SQLite。</p>
                      </div>
                    </div>
                  </section>
                  <section className="side-card">
                    <div className="side-card__head"><h3>最近更新</h3><span className="text-btn">本地</span></div>
                    <ul className="activity-list">
                      {projects.slice(0, 4).map((p) => (
                        <li key={p.id}>
                          <span className="activity-icon activity-icon--pen"><Icon name="pen" /></span>
                          <div><p><b>{p.title}</b> · {p.chapterCount} 章</p><span>{new Date(p.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="side-card inspiration-card">
                    <div className="inspiration-card__head"><span><Icon name="spark" /> 灵感胶囊</span><span className="inspiration-card__badge">AI</span></div>
                    <p className="inspiration-card__quote">{inspiration}</p>
                    <div className="inspiration-card__foot">
                      <button className="chip" type="button" onClick={() => setInspiration('让林雾在关键时刻说一句只有沈鹭才知道的暗号，但她坚持说那是巧合。')}><Icon name="refresh" /> 换一个</button>
                      <span className="text-btn">展开推演 <Icon name="arrow-right" /></span>
                    </div>
                  </section>
                </aside>
              </div>
            </>
          )}
        </div>
      </section>
      {newOpen && <NewProjectModal initialType={newType} onClose={() => setNewOpen(false)} />}
      {settingsProject && <ProjectSettingsModal project={settingsProject} onClose={() => setSettingsProject(null)} />}
    </AppShell>
  );
}
