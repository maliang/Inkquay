import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PrecheckResult } from '../../shared/pipeline';
import { api } from '../api';
import { Icon } from './Icon';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { pipelineApi } from '../lib/pipeline/api';
import { errorCopy } from '../lib/pipeline/format';
import { isPipelineError } from '../lib/pipeline/http';

const types = [
  { id: 'novel', icon: 'book', label: '长篇小说', desc: '10 万字以上，多线叙事' },
  { id: 'short', icon: 'feather', label: '短篇小说', desc: '3,000–15,000 字，单一冲突' },
  { id: 'screenplay', icon: 'clapper', label: '电影剧本', desc: '90–120 分钟，场次与对白' },
  { id: 'series', icon: 'film', label: '剧集大纲', desc: '多集叙事，每集一个钩子' },
];

type Phase = 'edit' | 'creating' | 'failed';

/** AI 企划支持的作品类型（剧本/剧集走旧编辑器，不进流水线）。 */
const PIPELINE_TYPES = ['novel', 'short'];

function newRequestId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  return `np-${random}`;
}

export function NewProjectModal({
  initialType = 'novel', initialPremise = '', onClose,
}: { initialType?: string; initialPremise?: string; onClose: () => void }) {
  const { settings, reload, rememberProject } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState(initialType);
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState(initialPremise);
  const [aiPlan, setAiPlan] = useState(true);
  const [phase, setPhase] = useState<Phase>('edit');
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(true);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  /** 已发出创建请求但还没拿到响应：此时关闭弹窗要避免「用户以为没建，其实建了」 */
  const [requestId, setRequestId] = useState<string>('');
  const aliveRef = useRef(true);

  const usesPipeline = PIPELINE_TYPES.includes(type);
  const pipelineMode = usesPipeline && aiPlan;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadPrecheck = async () => {
    setPrecheckLoading(true);
    try {
      const result = await pipelineApi.precheck();
      if (aliveRef.current) setPrecheck(result);
    } catch (err) {
      if (aliveRef.current) {
        setPrecheck({
          ok: false,
          message: isPipelineError(err) ? errorCopy(err.code).title : '无法连接本地服务，先确认后台是否还在运行。',
        });
      }
    } finally {
      if (aliveRef.current) setPrecheckLoading(false);
    }
  };

  useEffect(() => {
    if (pipelineMode) void loadPrecheck();
    else setPrecheckLoading(false);
  }, [pipelineMode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function handleClose() {
    if (phase === 'creating') {
      toast('正在创建作品，请稍等一两秒', 'warn');
      return;
    }
    onClose();
  }

  /** 旧路径（自己写）落点：小说/短篇进写作台，剧本进剧本页——绝不进流水线。 */
  function legacyTargetFor(id: string, kind: string) {
    return kind === 'screenplay' ? `/project/${id}/screenplay` : `/project/${id}`;
  }

  /** 旧路径（不勾 AI 企划 / 剧本 / 剧集）：保留原有的空白编辑器体验。 */
  async function createLegacy() {
    const genreMap: Record<string, string> = { novel: '悬疑 · 文学', short: '现实主义', screenplay: '犯罪 · 黑色电影', series: '悬疑 · 文学' };
    try {
      const result = await api.createProject({
        title: title.trim(),
        type,
        genre: type === 'novel' ? settings.prefs.genre || genreMap[type] : genreMap[type],
        description: premise.trim(),
      });
      rememberProject(result.project.id);
      await reload();
      toast(`《${result.project.title}》已创建`);
      onClose();
      navigate(legacyTargetFor(result.project.id, result.project.type));
      return true;
    } catch (err) {
      setPhase('failed');
      setSubmitError({ code: isPipelineError(err) ? err.code : 'BAD_REQUEST', message: err instanceof Error ? err.message : '创建失败，请重试' });
      return false;
    }
  }

  async function createWithPipeline() {
    const id = requestId || newRequestId();
    setRequestId(id);
    try {
      const result = await pipelineApi.createProject({
        title: title.trim(),
        type,
        genre: type === 'novel' ? settings.prefs.genre || '悬疑 · 文学' : '现实主义',
        premise: premise.trim(),
        clientRequestId: id,
      });
      rememberProject(result.project.id);
      await reload();
      toast(`《${result.project.title}》已创建，AI 正在企划`);
      onClose();
      navigate(`/project/${result.project.id}/pipeline`, { replace: false });
      return true;
    } catch (err) {
      const code = isPipelineError(err) ? err.code : 'NETWORK';
      setPhase('failed');
      setSubmitError({
        code,
        message: isPipelineError(err) ? err.message : err instanceof Error ? err.message : '创建失败，请重试',
      });
      toast(errorCopy(code).title, 'warn');
      return false;
    }
  }

  async function submit() {
    if (phase === 'creating') return;
    if (!title.trim()) {
      toast('先给作品起个名字', 'warn');
      return;
    }
    setSubmitError(null);
    setPhase('creating');
    if (pipelineMode) {
      // 前置拦截：没有默认模型/Key 时不创建作品，不留下空壳。
      const check = precheck || (await pipelineApi.precheck().catch(() => null));
      if (check) setPrecheck(check);
      if (!check || !check.ok) {
        setPhase('edit');
        setSubmitError({
          code: check?.code || 'NO_DEFAULT_MODEL',
          message: check?.message || '还不能让 AI 企划：没有可用的默认模型',
        });
        toast('还不能让 AI 企划，先配置模型或改为自己写', 'warn');
        return;
      }
      await createWithPipeline();
      return;
    }
    await createLegacy();
  }

  /** 前置拦截后的降级：仍然创建，但只用于自己写（旧编辑器）。 */
  async function createAnyway() {
    setAiPlan(false);
    setSubmitError(null);
    setPhase('creating');
    await createLegacy();
  }

  const precheckLine = useMemo(() => {
    if (!pipelineMode) return null;
    if (precheckLoading) return { state: 'loading' as const, text: '正在检查模型配置…' };
    if (precheck?.ok) {
      return { state: 'ok' as const, text: `✓ 将使用 ${precheck.providerId || '默认供应商'} · ${precheck.modelId || '默认模型'}` };
    }
    return {
      state: 'error' as const,
      code: precheck?.code || 'NO_DEFAULT_MODEL',
      text: `⚠ 还不能让 AI 企划：${precheck?.message || '没有可用的默认模型'}`,
    };
  }, [pipelineMode, precheck, precheckLoading]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" data-testid="new-project-form">
        <header className="modal__head">
          <div>
            <p className="modal__eyebrow">新建作品</p>
            <h2>从一个念头开始</h2>
          </div>
          <button className="icon-btn" type="button" onClick={handleClose} aria-label="关闭" disabled={phase === 'creating'}><Icon name="x" /></button>
        </header>
        <div className="wizard-body">
          <div className="form-block">
            <label className="form-label">选择体裁</label>
            <div className="type-options">
              {types.map((t) => (
                <button key={t.id} type="button" className={`type-option${type === t.id ? ' is-active' : ''}`} onClick={() => setType(t.id)} disabled={phase === 'creating'}>
                  <Icon name={t.icon} />
                  <span><strong>{t.label}</strong><em>{t.desc}</em></span>
                  <Icon name="check" className="type-option__check" />
                </button>
              ))}
            </div>
          </div>
          <div className="form-block">
            <label className="form-label" htmlFor="np-title">作品名</label>
            <input id="np-title" className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：长夜将尽" autoFocus disabled={phase === 'creating'} />
          </div>
          <div className="form-block">
            <label className="form-label" htmlFor="np-premise">一句话灵感 <span>可以稍后再补</span></label>
            <textarea id="np-premise" className="text-input text-input--area" rows={3} value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="一个替人写遗书的代笔人，收到了一封写给自己的遗书，落款日期是明天。" disabled={phase === 'creating'} />
          </div>
        </div>

        {usesPipeline ? (
          <label className="ai-plan-toggle">
            <input type="checkbox" id="np-ai-plan" checked={aiPlan} onChange={(e) => setAiPlan(e.target.checked)} disabled={phase === 'creating'} />
            <span>
              <Icon name="spark" />
              <div>
                <strong>创建后让 AI 先做企划</strong>
                <em>AI 先写设定与故事大纲，你审核确认后，再生成章节计划与正文</em>
              </div>
            </span>
          </label>
        ) : null}

        {precheckLine ? (
          <div
            className={`modal__notice${precheckLine.state === 'error' ? ' modal__notice--error' : ''}`}
            data-testid="new-project-precheck"
            data-code={precheckLine.state === 'error' ? precheckLine.code : undefined}
            data-state={precheckLine.state}
            role={precheckLine.state === 'error' ? 'alert' : 'status'}
          >
            <Icon name={precheckLine.state === 'error' ? 'alert' : precheckLine.state === 'ok' ? 'check' : 'clock'} />
            <div>
              <strong>{precheckLine.text}</strong>
              {precheckLine.state === 'error' ? (
                <p>
                  可以先到设置里选一个默认模型，或者改为自己写。
                  <button type="button" className="btn btn--ghost btn--tiny" onClick={() => navigate('/settings')}>去设置里选模型</button>
                  <button type="button" className="btn btn--ghost btn--tiny" data-testid="new-project-create-anyway" onClick={() => void createAnyway()}>
                    仍然创建（只能自己写）
                  </button>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div className="modal__notice modal__notice--error" role="alert" data-testid="new-project-error" data-code={submitError.code}>
            <Icon name="alert" />
            <div>
              <strong>{errorCopy(submitError.code).title}</strong>
              <p>{submitError.code === 'NO_DEFAULT_MODEL' || submitError.code === 'NO_API_KEY' ? '还没有可用的模型，AI 无法开始企划。作品没有创建，不会留下空壳。' : submitError.message}</p>
              <p className="modal__notice-hint">
                {submitError.code === 'NO_DEFAULT_MODEL' || submitError.code === 'NO_API_KEY'
                  ? '配置好模型后重试即可；也可以改为自己写。'
                  : `code=${submitError.code} · 可以重试，不会重复创建作品（已带幂等键）。`}
              </p>
            </div>
          </div>
        ) : null}

        <footer className="modal__foot">
          <span className="modal__hint">
            {phase === 'creating'
              ? '正在创建作品…（作品会立即保存，AI 企划在后台跑，可以随时离开）'
              : pipelineMode
                ? '创建后直接进入企划工作台：设定 → 故事大纲 → 章节计划 → 逐章写作。'
                : '创建后进入空白编辑器，你可以自己写，也可以随时让 AI 企划。'}
          </span>
          <div className="modal__foot-actions">
            <button className="btn btn--ghost" type="button" onClick={handleClose} disabled={phase === 'creating'}>
              取消
            </button>
            <button
              className="btn btn--primary"
              type="button"
              data-testid="new-project-submit"
              onClick={() => void submit()}
              disabled={phase === 'creating' || (pipelineMode && precheckLoading)}
            >
              {phase === 'creating'
                ? '正在创建…'
                : pipelineMode
                  ? '创建并让 AI 企划'
                  : '创建并开始写作'}{' '}
              <Icon name="arrow-right" />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
