import type { NextStep } from '../../../shared/pipeline.ts';

const HINTS: Record<string, string> = {
  migrate: '旧作品可以升级到 AI 流水线：正文、设定和版本都会原样保留。',
  'fix-provider': '没有可用的默认模型时，生成按钮点下去只会失败，先去把模型配好。',
  watch: '任务在后台跑，可以离开这一页；作品一直在本地保存。',
  'resume-writing': '上次停在断点，继续会从下一章接着写，不会重写已经完成的章。',
  'retry-failed': '上一次生成失败了：默认只继续没做完的那部分，不会整份重来。',
  'generate-p1': 'AI 会先给一版世界观、环境与人物初稿，你再逐条改。',
  'review-p1': '改到满意再确认；确认之后才轮到故事大纲。',
  'generate-p2': '把设定拆成一件件可写的事件。',
  'review-p2': '检查每一幕的冲突与节拍，确认后锁定下游。',
  'generate-p3': '决定每个章写什么、写多长。',
  'review-p3': '字数范围和总字数都确认后，才能开始逐章生成。',
  'start-writing': 'AI 会从第一章连续写到最后一章，中途可以随时暂停。',
  'fix-chapters': '有章节被退回重写，先按意见处理掉。',
  'review-chapters': '全部写完了，进写作台逐章审阅。',
  export: '所有章节都有终态了，可以导出成稿。',
};

/** 「下一步」卡（D7）：判定由服务端下发，前端只渲染文案与跳转。 */
export function NextStepCard({
  nextStep,
  onRun,
  busy,
}: {
  nextStep: NextStep;
  onRun: () => void;
  busy?: boolean;
}) {
  const hint = HINTS[nextStep.kind] || '';
  return (
    <section className="pipeline-next" data-testid="pipeline-next-step" data-kind={nextStep.kind} aria-label="下一步">
      <div className="pipeline-next__body">
        <span className="eyebrow">
          <i className="eyebrow__dot" aria-hidden="true" />
          下一步
        </span>
        <h3>{nextStep.label}</h3>
        {hint ? <p>{hint}</p> : null}
        {nextStep.blockers && nextStep.blockers.length ? (
          <ul className="pipeline-next__blockers">
            {nextStep.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        className={nextStep.kind === 'export' ? 'btn btn--ghost' : 'btn btn--primary'}
        data-testid="pipeline-next-action"
        onClick={onRun}
        disabled={busy}
      >
        {busy ? '正在开始…' : nextStep.label}
      </button>
    </section>
  );
}
