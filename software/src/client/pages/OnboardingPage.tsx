import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ProviderInfo } from '../../shared/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { useApp } from '../context/AppContext';

export function OnboardingPage() {
  const { providers, settings, reload } = useApp();
  const { toast } = useToast();
  const available = useMemo(() => providers.filter((p) => p.id !== 'mock'), [providers]);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(settings.profile.name || '');
  const [signature, setSignature] = useState(settings.profile.signature || '');
  const [providerId, setProviderId] = useState('deepseek');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const provider = available.find((p) => p.id === providerId) || available[0];
  const model = provider?.models.find((m) => m.id === modelId) || provider?.models[0];

  useEffect(() => {
    if (!provider) return;
    setBaseUrl(provider.baseUrl);
    if (!provider.models.some((m) => m.id === modelId)) setModelId(provider.enabledModels[0] || provider.models[0]?.id || '');
  }, [providerId, provider, modelId]);

  const keyRequired = provider ? provider.id !== 'ollama' : true;
  const canContinue = name.trim().length > 0;
  const canFinish = canContinue && Boolean(model) && (!keyRequired || apiKey.trim().length > 0);

  async function finish() {
    if (!provider || !model) return;
    setBusy(true);
    setError('');
    try {
      await api.completeOnboarding({
        name: name.trim(), signature: signature.trim(), providerId: provider.id,
        apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), modelId: model.id,
      });
      await reload();
      toast('书房已准备好');
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败');
      setBusy(false);
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-shell">
        <aside className="onboarding-intro">
          <img className="onboarding-logo" src="/logo.svg" alt="私家写手" />
          <p className="eyebrow"><span className="eyebrow__dot" />INKQUAY · 本地优先 · AI 主笔</p>
          <h1>Inkquay</h1>
          <p className="onboarding-intro__cn">私家写手</p>
          <p className="onboarding-intro__lead">把一句灵感，写成一本书。AI 读着你的作品往下写，你负责删改与定稿。</p>
          <ul className="onboarding-points">
            <li><Icon name="shield" /><span><strong>作品留在本机</strong><em>SQLite 数据库，不上传云端</em></span></li>
            <li><Icon name="spark" /><span><strong>AI 持续共笔</strong><em>读人物、大纲与上一章</em></span></li>
            <li><Icon name="book" /><span><strong>写作、剧本、分镜</strong><em>一条创作链，而不是聊天窗口</em></span></li>
          </ul>
          <div className="onboarding-steps">
            <div className={step === 1 ? 'is-active' : 'is-done'}><span>1</span><div><strong>作者身份</strong><em>你的称呼</em></div></div>
            <i />
            <div className={step === 2 ? 'is-active' : ''}><span>2</span><div><strong>接入模型</strong><em>API Key</em></div></div>
          </div>
        </aside>

        <main className="onboarding-card">
          {step === 1 ? (
            <>
              <header className="onboarding-card__head"><p className="eyebrow">首次打开 · 1 / 2</p><h2>先告诉我，怎么称呼你。</h2><p>这个名字会出现在作品库问候、头像、封面作者和导出文档里。</p></header>
              <div className="onboarding-form">
                <div className="form-block"><label className="form-label">称呼 / 笔名 <b>*</b></label><input className="text-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：阿周" maxLength={24} /></div>
                <div className="form-block"><label className="form-label">一句话签名 <span>可选</span></label><input className="text-input" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="故事还在雾里，但你已经知道它在哪。" maxLength={80} /></div>
                <div className="onboarding-preview"><span className="avatar">{(name || '作').slice(0, 1)}</span><div><strong>下午好，{name || '写作者'}。</strong><em>{signature || '故事还在雾里，但你已经知道它在哪。'}</em></div></div>
              </div>
              <footer className="onboarding-card__foot"><span className="field-hint">没有登录系统，称呼只保存在本机。</span><button className="btn btn--primary" type="button" disabled={!canContinue} onClick={() => setStep(2)}>下一步 <Icon name="arrow-right" /></button></footer>
            </>
          ) : (
            <>
              <header className="onboarding-card__head"><p className="eyebrow">首次打开 · 2 / 2</p><h2>接入你的模型。</h2><p>选一个供应商，填写 API Key；至少填写后才能进入主界面。Key 会加密保存在本机。</p></header>
              <div className="onboarding-form">
                <div className="form-block"><label className="form-label">模型供应商 <b>*</b></label><div className="onboarding-providers">
                  {available.map((p) => <button key={p.id} type="button" className={`onboarding-provider${p.id === provider?.id ? ' is-active' : ''}`} onClick={() => setProviderId(p.id)}><span className="provider-logo" style={{ '--brand': p.brand } as CSSProperties}>{p.mark}</span><span><strong>{p.name}</strong><em>{p.family}</em></span><Icon name="check" /></button>)}
                </div></div>
                <div className="form-row">
                  <div className="form-block"><label className="form-label">模型 <b>*</b></label><select className="text-input" value={model?.id || ''} onChange={(e) => setModelId(e.target.value)}>{(provider?.models || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
                  <div className="form-block"><label className="form-label">API Key {keyRequired ? <b>*</b> : <span>本地模型可留空</span>}</label><input className="text-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider?.id === 'ollama' ? '本地 Ollama 不需要 Key' : 'sk-…'} /></div>
                </div>
                <details className="onboarding-advanced"><summary>高级：接口地址</summary><input className="text-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></details>
                {error ? <p className="onboarding-error"><Icon name="alert" /> {error}</p> : null}
                <p className="onboarding-note"><Icon name="lock" /> API Key 使用 AES-256-GCM 加密后写入本地 SQLite；只有发送给该供应商的提示词会离开本机。</p>
              </div>
              <footer className="onboarding-card__foot"><button className="btn btn--ghost" type="button" onClick={() => setStep(1)}>返回</button><div className="onboarding-foot__right"><span className="field-hint">完成后可在设置中修改</span><button className="btn btn--primary" type="button" disabled={!canFinish || busy} onClick={finish}>{busy ? '正在准备书房…' : '完成并进入书房'} <Icon name="arrow-right" /></button></div></footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
