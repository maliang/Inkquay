import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AccentId, AppearanceSettings, ProviderInfo, ThemeId } from '../../shared/types';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { ACCENT_PRESETS, THEME_META, applyAppearance } from '../theme';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

const tabs = [
  { id: 'profile', label: '个人资料', sub: '称呼、头像与签名', icon: 'users' },
  { id: 'appearance', label: '外观', sub: '主题、色彩与阅读', icon: 'palette' },
  { id: 'models', label: '模型与供应商', sub: 'API、模型与生成参数', icon: 'server' },
  { id: 'writing', label: '写作偏好', sub: '视角、文风与目标', icon: 'pen' },
  { id: 'shortcuts', label: '快捷键', sub: '键盘操作一览', icon: 'type' },
  { id: 'data', label: '数据与隐私', sub: '本地存储与导出', icon: 'shield' },
] as const;

const tabMeta: Record<string, { title: string; sub: string }> = {
  profile: { title: '个人资料', sub: '你的称呼、头像与签名；会用于作品库问候、导出署名和界面头像。' },
  appearance: { title: '外观', sub: '主题、强调色与正文阅读体验，修改会立即生效。' },
  models: { title: '模型与供应商', sub: '连接不同厂商、管理模型与生成参数。配置会保存在服务端本地数据库。' },
  writing: { title: '写作偏好', sub: '视角、文风与 AI 续写习惯，会让每次共笔更接近你的写作方式。' },
  shortcuts: { title: '快捷键', sub: '写作时尽量不离开键盘。' },
  data: { title: '数据与隐私', sub: '作品、设置与供应商密钥分别存放在哪里。' },
};

const themeOptions: { id: ThemeId; label: string; sub: string }[] = [
  { id: 'ink', label: '墨夜', sub: '深夜书房' },
  { id: 'abyss', label: '雾蓝', sub: '港口夜航' },
  { id: 'moss', label: '苔青', sub: '山中清晨' },
  { id: 'paper', label: '宣纸', sub: '白日书房' },
];

export function SettingsPage() {
  const { settings, providers, projects, updateSettings, reload } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<string>('profile');
  const [appearance, setAppearance] = useState<AppearanceSettings>(settings.appearance);
  const [profileForm, setProfileForm] = useState(settings.profile);
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [providerKey, setProviderKey] = useState('');
  const [providerBase, setProviderBase] = useState('');
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [providerDefault, setProviderDefault] = useState('');
  const [testState, setTestState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; message: string }>({ kind: 'idle', message: '未测试' });
  const saveTimer = useRef<number | null>(null);

  useEffect(() => { setAppearance(settings.appearance); }, [settings.appearance]);
  useEffect(() => { setProfileForm(settings.profile); }, [settings.profile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editing) { setEditing(null); return; }
      navigate('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, navigate]);

  const connected = providers.filter((p) => p.configured).length;
  const modelEntries = useMemo(() => providers.flatMap((provider) => {
    if (!provider.enabled || !provider.configured) return [];
    return provider.enabledModels.map((id) => {
      const model = provider.models.find((m) => m.id === id);
      return model ? { provider, model } : null;
    }).filter(Boolean) as { provider: ProviderInfo; model: ProviderInfo['models'][number] }[];
  }), [providers]);
  const defaultEntry = modelEntries.find((e) => e.provider.id === settings.defaultModel?.providerId && e.model.id === settings.defaultModel?.modelId);

  function changeAppearance(next: AppearanceSettings, immediate = false) {
    setAppearance(next);
    applyAppearance(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const run = () => { void updateSettings({ appearance: next }).catch((err) => toast(err instanceof Error ? err.message : '设置保存失败', 'warn')); };
    if (immediate) run();
    else saveTimer.current = window.setTimeout(run, 450);
  }

  async function saveProfile() {
    const name = profileForm.name.trim();
    if (!name) { toast('称呼不能为空', 'warn'); return; }
    try {
      await updateSettings({ profile: { name, signature: profileForm.signature.trim() } });
      toast('个人资料已保存');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'warn');
    }
  }

  async function changeDefaultModel(value: string) {
    const entry = modelEntries.find((e) => `${e.provider.id}::${e.model.id}` === value);
    if (!entry) return;
    try {
      await updateSettings({ defaultModel: { providerId: entry.provider.id, modelId: entry.model.id } });
      toast(`默认模型：${entry.model.name}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '切换模型失败', 'warn');
    }
  }

  async function toggleProvider(provider: ProviderInfo) {
    if (!provider.configured) {
      openProvider(provider);
      return;
    }
    try {
      await api.updateProvider(provider.id, { enabled: !provider.enabled });
      const { providers: nextProviders } = await api.providers();
      if (settings.defaultModel?.providerId === provider.id && provider.enabled) {
        const fallback = nextProviders.find((p) => p.enabled && p.configured && p.enabledModels[0]);
        if (fallback) await updateSettings({ defaultModel: { providerId: fallback.id, modelId: fallback.enabledModels[0] } });
      }
      await reload();
      toast(`${provider.name} ${provider.enabled ? '已停用' : '已启用'}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '更新供应商失败', 'warn');
    }
  }

  function openProvider(provider: ProviderInfo) {
    setEditing(provider);
    setProviderEnabled(provider.configured ? provider.enabled : true);
    setProviderKey('');
    setProviderBase(provider.baseUrl);
    setProviderModels([...provider.enabledModels]);
    setProviderDefault(provider.defaultModel || provider.enabledModels[0] || provider.models[0]?.id || '');
    setTestState({ kind: 'idle', message: '未测试' });
  }

  async function saveProvider() {
    if (!editing) return;
    if (providerEnabled && !providerModels.length) {
      toast('至少启用一个模型', 'warn');
      return;
    }
    try {
      const willConfigure = editing.configured || Boolean(providerKey.trim()) || editing.kind === 'mock';
      const result = await api.updateProvider(editing.id, {
        enabled: willConfigure ? providerEnabled : false,
        enabledModels: providerModels,
        baseUrl: providerBase,
        ...(providerKey.trim() ? { apiKey: providerKey.trim() } : {}),
      });
      if (providerEnabled && result.provider.configured && settings.defaultModel?.providerId === editing.id) {
        await updateSettings({ defaultModel: { providerId: editing.id, modelId: providerDefault } });
      }
      await reload();
      setEditing(null);
      toast(`${editing.name} 配置已保存`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存供应商失败', 'warn');
    }
  }

  async function testProvider() {
    if (!editing) return;
    setTestState({ kind: 'loading', message: '检查中…' });
    try {
      if (editing.kind !== 'mock' && providerKey.trim()) {
        await api.updateProvider(editing.id, { apiKey: providerKey.trim(), baseUrl: providerBase });
      }
      const result = await api.testProvider(editing.id);
      setTestState({ kind: result.ok ? 'ok' : 'error', message: result.message });
    } catch (err) {
      setTestState({ kind: 'error', message: err instanceof Error ? err.message : '连接失败' });
    }
  }

  async function addCustomProvider() {
    try {
      const { provider } = await api.createProvider({ name: '自定义供应商', kind: 'openai', baseUrl: 'https://api.example.com/v1' });
      await reload();
      toast('已创建自定义供应商');
      setEditing(provider);
      setProviderEnabled(false);
      setProviderKey('');
      setProviderBase(provider.baseUrl);
      setProviderModels([]);
      setProviderDefault(provider.models[0]?.id || '');
    } catch (err) {
      toast(err instanceof Error ? err.message : '创建供应商失败', 'warn');
    }
  }

  function exportSettings() {
    const payload = { appearance: settings.appearance, prefs: settings.prefs, generation: settings.generation, defaultModel: settings.defaultModel, providers: providers.map((p) => ({ ...p, apiKeyMasked: '' })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'private-writer-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('设置已导出（不含密钥）');
  }

  const meta = tabMeta[tab];
  return (
    <div className="settings-route">
      <div className="settings-shell" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <aside className="settings-nav">
          <div className="settings-brand"><img className="brand__logo brand__logo--sm" src="/logo.svg" alt="" /><div><strong>Inkquay</strong><span>私家写手 · 本地工作区</span></div></div>
          <div className="settings-account"><span className="avatar avatar--settings">{(settings.profile.name || '作').slice(0, 1)}</span><div><strong>{settings.profile.name || '未命名作者'}</strong><span>Pro · 本地数据库</span></div><span className="sync-badge"><Icon name="check" /> 已连接</span></div>
          <nav className="settings-menu">
            {tabs.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} /><span><strong>{t.label}</strong><em>{t.sub}</em></span>{t.id === 'models' ? <i className="settings-menu__badge">{providers.length}</i> : null}</button>)}
          </nav>
          <div className="settings-navfoot"><Link className="text-btn" to="/"><Icon name="arrow-left" /> 返回工作区</Link><span>v0.1 · 全栈版</span></div>
        </aside>
        <main className="settings-main">
          <header className="settings-head"><div><p className="eyebrow">应用设置</p><h2 id="settings-title">{meta.title}</h2><p>{meta.sub}</p></div><Link className="icon-btn" to="/" aria-label="关闭设置"><Icon name="x" /></Link></header>
          <div className="settings-scroll">
            {tab === 'profile' && (
              <>
                <div className="settings-block">
                  <div className="settings-block__head"><div><h3>作者身份</h3><p>当前界面里的作者名都来自这里。</p></div><span className="settings-count">本地</span></div>
                  <div className="profile-editor">
                    <div className="profile-editor__avatar">{(profileForm.name || '马').trim().slice(0, 1)}</div>
                    <div className="profile-editor__fields">
                      <div className="form-block"><label className="form-label">称呼 / 笔名</label><input className="text-input" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} placeholder="例如：阿周" maxLength={24} /></div>
                      <div className="form-block"><label className="form-label">一句话签名 <span>显示在作品库问候下方</span></label><input className="text-input" value={profileForm.signature} onChange={(e) => setProfileForm({ ...profileForm, signature: e.target.value })} placeholder="故事还在雾里，但你已经知道它在哪。" maxLength={80} /></div>
                    </div>
                  </div>
                  <div className="profile-editor__foot"><span className="field-hint">头像暂时使用称呼首字；导出 Word 时会作为作者署名。</span><button className="btn btn--primary btn--sm" type="button" onClick={saveProfile}><Icon name="check" /> 保存资料</button></div>
                </div>
                <div className="settings-block"><div className="settings-block__head"><div><h3>关于称呼</h3><p>这个值最初来自演示数据，不是系统账号。</p></div></div><p className="settings-footnote" style={{ margin: 0 }}><Icon name="eye" /> 私家写手是单机本地应用，没有登录系统；称呼只保存在本地 SQLite 的 settings 表里。</p></div>
              </>
            )}
            {tab === 'appearance' && (
              <>
                <div className="settings-block">
                  <div className="settings-block__head"><div><h3>主题风格</h3><p>为长时间写作选择一套不刺眼的环境。</p></div><span className="settings-count">4 套</span></div>
                  <div className="theme-grid">
                    {themeOptions.map((theme) => (
                      <button key={theme.id} type="button" className={`theme-card${appearance.theme === theme.id ? ' is-active' : ''}`} onClick={() => changeAppearance({ ...appearance, theme: theme.id }, true)}>
                        <span className={`theme-shot theme-shot--${theme.id}`}><i className="theme-shot__rail" /><i className="theme-shot__side" /><span className="theme-shot__page"><b /><em /><em /><em /></span><i className="theme-shot__accent" /></span>
                        <span className="theme-card__meta"><span><strong>{theme.label}</strong><em>{theme.sub}</em></span><Icon name="check" /></span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-two-col">
                  <div className="settings-block">
                    <div className="settings-block__head"><div><h3>主题色</h3><p>按钮、当前章节与 AI 动作的强调色。</p></div></div>
                    <div className="accent-grid">
                      {(Object.entries(ACCENT_PRESETS) as [AccentId, typeof ACCENT_PRESETS[AccentId]][]).map(([id, preset]) => {
                        const paper = appearance.theme === 'paper';
                        const swatch = paper ? preset.light : preset.dark;
                        return <button key={id} type="button" className={`accent-swatch${!appearance.customAccent && appearance.accent === id ? ' is-active' : ''}`} style={{ '--swatch': swatch } as CSSProperties} onClick={() => changeAppearance({ ...appearance, accent: id, customAccent: null }, true)}><i /><span>{preset.name}</span><em>{swatch.toUpperCase()}</em></button>;
                      })}
                    </div>
                    <label className="custom-color"><span><Icon name="palette" /> 自定义颜色</span><span className="custom-color__right"><input type="color" value={appearance.customAccent || (appearance.theme === 'paper' ? ACCENT_PRESETS[appearance.accent].light : ACCENT_PRESETS[appearance.accent].dark)} onChange={(e) => changeAppearance({ ...appearance, customAccent: e.target.value }, true)} /><em>{appearance.customAccent?.toUpperCase() || '跟随主题色'}</em></span></label>
                  </div>
                  <div className="settings-block">
                    <div className="settings-block__head"><div><h3>正文阅读</h3><p>只影响写作台正文，不改变界面字号。</p></div></div>
                    <div className="setting-row setting-row--range"><div><strong>正文字号</strong><span>当前 <b>{appearance.editorSize.toFixed(1)} px</b></span></div><div className="range-wrap"><input type="range" min="15" max="22" step="0.5" value={appearance.editorSize} onChange={(e) => changeAppearance({ ...appearance, editorSize: Number(e.target.value) })} /><span className="range-ticks"><i>小</i><i>标准</i><i>大</i></span></div></div>
                    <div className="setting-row"><div><strong>减弱动态效果</strong><span>关闭流式光标与界面过渡</span></div><button className={`switch${appearance.reduceMotion ? ' is-on' : ''}`} type="button" role="switch" aria-checked={appearance.reduceMotion} onClick={() => changeAppearance({ ...appearance, reduceMotion: !appearance.reduceMotion }, true)}><i /></button></div>
                    <div className="setting-row"><div><strong>正文衬线字体</strong><span>宋体 / Songti SC</span></div><span className="setting-value">跟随系统</span></div>
                  </div>
                </div>
                <div className="appearance-preview"><div className="appearance-preview__head"><span><Icon name="eye" /> 实时预览</span><span><b>{THEME_META[appearance.theme].name}</b> · <b>{appearance.customAccent ? '自定义' : ACCENT_PRESETS[appearance.accent].name}</b></span></div><div className="preview-stage"><div className="preview-page"><span className="preview-kicker">第二卷 · 暗流 / 第七章</span><h3>雨夜的访客</h3><p>雨是傍晚开始的。起初只是几粒，敲在玻璃上，像有人用指甲试探一扇不肯开的门。</p><p>他听见楼下传来三声敲门。<mark>“她还活着，只是不在你记得的地方。”</mark></p><div className="preview-ai"><Icon name="spark" /><span>AI 建议：让访客的伞留在门外，作为第 14 章的物证。</span></div></div><div className="preview-ai-panel"><div className="preview-ai-panel__head"><Icon name="spark" /> AI 共笔</div><div className="preview-bubble">先不要揭晓访客身份，把紧张感拉满。</div><div className="preview-bubble preview-bubble--ai">门外的男人没有再敲。他把伞收得很慢。</div><div className="preview-input">告诉 AI 你想怎么写…</div></div></div></div>
              </>
            )}

            {tab === 'models' && (
              <>
                <div className="models-summary">
                  <div className="default-model-card"><span className="default-model-card__label">默认模型</span><div className="default-model-card__value"><span className="provider-dot" style={{ background: defaultEntry?.provider.brand || 'var(--jade)' }} /><strong>{defaultEntry?.model.name || '未配置'}</strong><em>{defaultEntry?.provider.name || '请连接供应商'}</em></div><span className="default-model-card__hint">写作台与 AI 共笔默认使用</span></div>
                  <div className="models-summary__stats"><div><strong>{connected}</strong><span>已连接供应商</span></div><div><strong>{modelEntries.length}</strong><span>可用模型</span></div><div><strong>{connected} / {providers.length}</strong><span>配置进度</span></div></div>
                </div>
                <div className="settings-block">
                  <div className="settings-block__head"><div><h3>模型供应商</h3><p>同一个工作台里管理云端、本地和 OpenAI 兼容接口。</p></div><div className="settings-block__actions"><button className="btn btn--ghost btn--sm" type="button" onClick={addCustomProvider}><Icon name="plus" /> 自定义供应商</button></div></div>
                  <div className="provider-grid">
                    {providers.map((provider) => (
                      <article key={provider.id} className={`provider-card${provider.configured && provider.enabled ? ' is-connected' : ''}${!provider.enabled ? ' is-off' : ''}`} role="button" tabIndex={0} onClick={() => openProvider(provider)} onKeyDown={(e) => { if (e.key === 'Enter') openProvider(provider); }}>
                        <div className="provider-card__head"><span className="provider-logo" style={{ '--brand': provider.brand } as CSSProperties}>{provider.mark}</span><div><h4>{provider.name}<span>{provider.family}</span></h4><p>{provider.baseUrl || '内置模型'} · {provider.models.length} 个模型</p></div><button className={`switch${provider.enabled ? ' is-on' : ''}`} type="button" role="switch" aria-checked={provider.enabled} onClick={(e) => { e.stopPropagation(); void toggleProvider(provider); }}><i /></button></div>
                        <div className="provider-card__status"><i />{provider.configured ? (provider.enabled ? '已连接' : '已停用') : '未配置'}<em>{provider.enabledModels.length} 个已启用</em></div>
                        <div className="provider-card__models">{provider.enabledModels.length ? provider.enabledModels.slice(0, 3).map((id) => <span key={id}>{provider.models.find((m) => m.id === id)?.name || id}</span>) : <span className="empty">配置 Key 后选择模型</span>}</div>
                        <div className="provider-card__foot"><span>{settings.defaultModel?.providerId === provider.id ? `默认 · ${defaultEntry?.model.name || ''}` : provider.configured ? provider.family : '尚未连接'}</span><button type="button" onClick={(e) => { e.stopPropagation(); openProvider(provider); }}>{provider.configured ? '配置' : '连接'}</button></div>
                      </article>
                    ))}
                  </div>
                  <p className="settings-footnote"><Icon name="lock" /> API Key 由服务端使用本地 AES-GCM 密钥加密后写入 SQLite，不会返回到浏览器。</p>
                </div>
                <div className="settings-block"><div className="settings-block__head"><div><h3>生成参数</h3><p>作用于写作台的默认生成行为。</p></div></div><div className="generation-grid">
                  <div className="setting-row setting-row--range"><div><strong>创造性</strong><span>越低越克制，越高越发散</span></div><div className="range-wrap"><input type="range" min="0" max="1.5" step="0.1" value={settings.generation.temperature} onChange={(e) => { void updateSettings({ generation: { ...settings.generation, temperature: Number(e.target.value) } }); }} /><b>{settings.generation.temperature.toFixed(1)}</b></div></div>
                  <div className="setting-row"><div><strong>流式输出</strong><span>AI 边生成边显示</span></div><button className={`switch${settings.generation.streaming ? ' is-on' : ''}`} type="button" onClick={() => { void updateSettings({ generation: { ...settings.generation, streaming: !settings.generation.streaming } }); }}><i /></button></div>
                  <div className="setting-row"><div><strong>默认模型</strong><span>切换后写作台同步更新</span></div><select className="text-input text-input--compact" value={settings.defaultModel ? `${settings.defaultModel.providerId}::${settings.defaultModel.modelId}` : ''} onChange={(e) => void changeDefaultModel(e.target.value)}>{modelEntries.map((entry) => <option key={`${entry.provider.id}::${entry.model.id}`} value={`${entry.provider.id}::${entry.model.id}`}>{entry.provider.name} · {entry.model.name}</option>)}</select></div>
                  <div className="setting-row"><div><strong>备用模型</strong><span>主模型不可用时提示切换</span></div><select className="text-input text-input--compact" value={settings.fallbackModel ? `${settings.fallbackModel.providerId}::${settings.fallbackModel.modelId}` : ''} onChange={(e) => { const value = e.target.value; const entry = modelEntries.find((x) => `${x.provider.id}::${x.model.id}` === value); void updateSettings({ fallbackModel: entry ? { providerId: entry.provider.id, modelId: entry.model.id } : null }); }}><option value="">不启用</option>{modelEntries.map((entry) => <option key={`${entry.provider.id}::${entry.model.id}`} value={`${entry.provider.id}::${entry.model.id}`}>{entry.provider.name} · {entry.model.name}</option>)}</select></div>
                </div></div>
                <div className="provider-note"><div className="provider-note__icon"><Icon name="shield" /></div><div><strong>实际请求由服务端转发</strong><p>供应商配置保存在本地 SQLite，密钥加密存储；OpenAI 兼容接口、Anthropic 和 Gemini 分别走各自的流式协议。没有配置 Key 时会自动回退到本地演示模型。</p></div></div>
              </>
            )}

            {tab === 'writing' && (
              <><div className="settings-block"><div className="settings-block__head"><div><h3>默认写作习惯</h3><p>新建章节与 AI 共笔会参考这些偏好。</p></div></div><div className="generation-grid">
                <div className="setting-row"><div><strong>默认视角</strong><span>新建项目时的叙事人称</span></div><select className="text-input text-input--compact" value={settings.prefs.pov} onChange={(e) => void updateSettings({ prefs: { ...settings.prefs, pov: e.target.value } })}><option>第三人称限知</option><option>第一人称</option><option>全知视角</option><option>多视角</option></select></div>
                <div className="setting-row"><div><strong>默认体裁</strong><span>新建向导的预选类型</span></div><select className="text-input text-input--compact" value={settings.prefs.genre} onChange={(e) => void updateSettings({ prefs: { ...settings.prefs, genre: e.target.value } })}><option>悬疑 · 文学</option><option>现实主义</option><option>科幻 · 近未来</option><option>犯罪 · 黑色电影</option></select></div>
                <div className="setting-row"><div><strong>AI 续写长度</strong><span>单次续写的目标字数</span></div><select className="text-input text-input--compact" value={settings.prefs.aiLength} onChange={(e) => void updateSettings({ prefs: { ...settings.prefs, aiLength: e.target.value } })}><option>短 · 约 300 字</option><option>中 · 约 500 字</option><option>长 · 约 800 字</option></select></div>
                <div className="setting-row"><div><strong>自动保存</strong><span>停止输入 800ms 后保存草稿</span></div><button className={`switch${settings.prefs.autoSave ? ' is-on' : ''}`} type="button" onClick={() => void updateSettings({ prefs: { ...settings.prefs, autoSave: !settings.prefs.autoSave } })}><i /></button></div>
              </div></div>
              <div className="settings-block"><div className="settings-block__head"><div><h3>AI 文风</h3><p>作为默认语气注入每一次共笔。</p></div></div><div className="style-picker">{['克制留白', '潮湿阴郁', '细腻感官', '冷峻对白', '口语叙事'].map((style) => <button key={style} type="button" className={settings.prefs.style === style ? 'is-active' : ''} onClick={() => void updateSettings({ prefs: { ...settings.prefs, style } })}>{style}</button>)}</div></div></>
            )}

            {tab === 'shortcuts' && (
              <div className="settings-block"><div className="settings-block__head"><div><h3>全局快捷键</h3><p>写作时尽量不离开键盘。</p></div></div><div className="shortcut-table">{[['发送 AI 指令', '⌘ ↵'], ['保存当前章节', '⌘ S'], ['返回作品库', 'G L'], ['关闭浮层 / 设置', 'Esc']].map(([label, key]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div></div>
            )}

            {tab === 'data' && (
              <><div className="settings-block"><div className="settings-block__head"><div><h3>本地数据</h3><p>作品与设置保存在这台机器的 SQLite 数据库。</p></div></div><div className="storage-card"><div className="storage-card__top"><span><Icon name="server" /> SQLite · data/studio.db</span><strong>{projects.length} 部作品</strong></div><div className="pbar pbar--accent"><i style={{ width: '22%' }} /></div><div className="storage-card__legend"><span>{projects.reduce((s, p) => s + p.totalWords, 0).toLocaleString()} 字</span><span>{providers.length} 个供应商</span><span>WAL 模式</span></div></div><div className="data-actions"><button className="btn btn--ghost" type="button" onClick={exportSettings}><Icon name="download" /> 导出设置</button><button className="btn btn--ghost" type="button" onClick={() => { void api.projects().then(() => toast('数据库连接正常')); }}><Icon name="shield" /> 检查连接</button></div></div>
              <div className="settings-block"><div className="settings-block__head"><div><h3>隐私说明</h3><p>本地优先架构。</p></div></div><ul className="privacy-list"><li><Icon name="check" /><div><strong>API Key 加密保存</strong><span>服务端使用本地 AES-GCM 密钥加密后写入数据库，不返回前端。</span></div></li><li><Icon name="check" /><div><strong>作品数据留在本地</strong><span>当前没有云同步；数据库文件位于 software/data/studio.db。</span></div></li><li><Icon name="check" /><div><strong>模型请求由服务端转发</strong><span>只有发送给所选供应商的提示词会离开本机。</span></div></li></ul></div></>
            )}
          </div>
        </main>
      </div>

      {editing && (
        <div className="provider-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="provider-dialog" role="dialog" aria-modal="true">
            <header className="provider-dialog__head"><span className="provider-logo provider-logo--lg" style={{ '--brand': editing.brand } as CSSProperties}>{editing.mark}</span><div className="provider-dialog__title"><p className="eyebrow">{editing.family} · {editing.kind === 'mock' ? '内置' : 'API'}</p><h3>{editing.name}</h3><span>{editing.baseUrl || '内置模型'}</span></div><span className={`conn-badge${testState.kind === 'ok' ? '' : ' is-off'}`}><i />{testState.kind === 'ok' ? '已连接' : testState.kind === 'error' ? '未连接' : '未测试'}</span><button className="icon-btn" type="button" onClick={() => setEditing(null)}><Icon name="x" /></button></header>
            <div className="provider-dialog__body">
              <div className="provider-switch-row"><div><strong>在此工作台启用</strong><span>关闭后不会出现在模型列表中</span></div><button className={`switch${providerEnabled ? ' is-on' : ''}`} type="button" onClick={() => setProviderEnabled((v) => !v)}><i /></button></div>
              {editing.kind !== 'mock' && <><div className="form-block"><label className="form-label">API Key <span>留空则保持原密钥</span></label><div className="secret-input"><Icon name="key" /><input type="password" value={providerKey} onChange={(e) => setProviderKey(e.target.value)} placeholder={editing.apiKeyMasked || 'sk-…'} /></div><p className="field-hint">密钥只在服务端解密用于请求，不会返回浏览器。</p></div><div className="form-block"><label className="form-label">Base URL <span>OpenAI 兼容接口地址</span></label><input className="text-input" value={providerBase} onChange={(e) => setProviderBase(e.target.value)} /></div></>}
              <div className="connection-row"><button className="btn btn--ghost" type="button" onClick={testProvider} disabled={testState.kind === 'loading'}><Icon name="plug" /> {testState.kind === 'loading' ? '检查中…' : '检查连接'}</button><span className={`connection-status${testState.kind === 'ok' ? ' is-ok' : testState.kind === 'error' ? ' is-error' : ''}`}><i />{testState.message}</span></div>
              <div className="provider-models-head"><div><h4>可用模型</h4><p>勾选后可在写作台切换。</p></div></div>
              <div className="provider-model-list">{editing.models.map((model) => { const enabled = providerModels.includes(model.id); return <label className={`provider-model-item${enabled ? ' is-enabled' : ''}`} key={model.id}><input type="checkbox" checked={enabled} onChange={() => setProviderModels((prev) => enabled ? prev.filter((id) => id !== model.id) : [...prev, model.id])} /><span className="provider-model-item__body"><strong>{model.name}</strong><span>{model.ctx} 上下文</span></span><span className="provider-model-item__tags">{model.tags.map((tag) => <span key={tag}>{tag}</span>)}</span></label>; })}</div>
            </div>
            <footer className="provider-dialog__foot"><span className="modal__hint">保存后立即生效。</span><div className="modal__foot-actions"><button className="btn btn--ghost" type="button" onClick={() => setEditing(null)}>取消</button><button className="btn btn--primary" type="button" onClick={saveProvider}><Icon name="check" /> 保存配置</button></div></footer>
          </div>
        </div>
      )}
    </div>
  );
}
