import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineItem, PipelineSnapshot, StageKey } from '../../shared/pipeline.ts';
import { PlanSummary, PipelineUnit, pipelineApi } from '../lib/pipeline/api.ts';
import { isPipelineError, PipelineRequestError } from '../lib/pipeline/http.ts';

type Details = {
  p1: PipelineItem[];
  p2: PipelineItem[];
  units: PipelineUnit[];
  summary: PlanSummary | null;
};

const EMPTY_DETAILS: Details = { p1: [], p2: [], units: [], summary: null };

const STAGE_KEYS: StageKey[] = ['p1', 'p2', 'p3', 'p4'];

function signatureOf(snapshot: PipelineSnapshot | null): string {
  if (!snapshot) return '';
  const stages = STAGE_KEYS.map((key) => `${key}:${snapshot.stages[key]?.status}:${snapshot.stages[key]?.counts?.items}:${snapshot.stages[key]?.updatedAt}`).join('|');
  const job = snapshot.job ? `${snapshot.job.id}:${snapshot.job.state}:${snapshot.job.stepIndex}:${snapshot.job.unitsDone}` : `last:${snapshot.lastJob?.id}:${snapshot.lastJob?.state}`;
  return `${snapshot.project.pipelineStatus}|${stages}|${job}|${snapshot.progress.unitsDone}/${snapshot.progress.unitsTotal}|${snapshot.lastError?.code || ''}`;
}

function intervalFor(snapshot: PipelineSnapshot | null): number | null {
  if (!snapshot) return null;
  const job = snapshot.job;
  if (job) {
    if (job.state === 'running' || job.state === 'pausing' || job.state === 'queued') return 2000;
    if (job.state === 'paused') return 10000;
    return 3000;
  }
  return 5000;
}

/** offline 后的自愈探测节奏：失败降级不是终点，低频探一次，成功一次就恢复。 */
export const OFFLINE_PROBE_MS = 5000;

/**
 * 单次快照请求的硬超时（U15）。
 * 没有它，一次挂起的连接会让 inFlight 永久为 true：后续 refresh 全部静默返回 null、
 * 失败次数永远不增长，界面看起来「点了没反应」，轮询也不再发生。
 */
export const SNAPSHOT_TIMEOUT_MS = 15000;

export interface UsePipelineResult {
  snapshot: PipelineSnapshot | null;
  items: { p1: PipelineItem[]; p2: PipelineItem[] };
  units: PipelineUnit[];
  summary: PlanSummary | null;
  loading: boolean;
  error: PipelineRequestError | null;
  /** 连续轮询失败 ≥3 次：界面只降级为「与后台失去联系」，不切错误卡 */
  offline: boolean;
  lastUpdatedAt: number;
  refresh: (options?: { details?: boolean; silent?: boolean }) => Promise<PipelineSnapshot | null>;
  reloadDetails: () => Promise<void>;
  applySnapshot: (snapshot: PipelineSnapshot) => void;
}

/**
 * 流水线数据源：快照 + 条目 + 章节计划，轮询策略按 UX-SPEC §12.4。
 * 所有写操作由页面调用接口后 `refresh()`，这里不缓存乐观结果，避免与服务端口径打架。
 */
export function usePipeline(projectId: string | undefined): UsePipelineResult {
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PipelineRequestError | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);

  const failures = useRef(0);
  const signature = useRef('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  /** 组件卸载时中止在飞的请求：否则删除作品后残留的轮询会打出 404。 */
  const abortRef = useRef<AbortController | null>(null);
  /** 撞上 inFlight 的一次请求排队到本轮结束后补跑（U9）。 */
  const pending = useRef<{ details?: boolean; silent?: boolean } | null>(null);
  const fetchRef = useRef<((options?: { details?: boolean; silent?: boolean }) => Promise<PipelineSnapshot | null>) | null>(null);

  const signal = useCallback(() => {
    if (!abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController();
    return abortRef.current.signal;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const loadDetails = useCallback(
    async (id: string) => {
      const current = signal();
      const [p1, p2, units] = await Promise.all([
        pipelineApi.items(id, 'p1', current),
        pipelineApi.items(id, 'p2', current),
        pipelineApi.units(id, current),
      ]);
      if (!mounted.current) return;
      setDetails({ p1: p1.items, p2: p2.items, units: units.units, summary: units.summary });
    },
    [signal],
  );

  const fetchSnapshot = useCallback(
    async (options?: { details?: boolean; silent?: boolean }): Promise<PipelineSnapshot | null> => {
      if (!projectId) return null;
      if (inFlight.current) {
        // 写操作成功后的 refresh 不能因为正好撞上 2s 轮询就被丢掉：
        // 合并成一次「待补跑」，本轮结束后立刻执行（details 取并集）。
        pending.current = {
          details: Boolean(pending.current?.details) || Boolean(options?.details),
          silent: options?.silent ?? pending.current?.silent,
        };
        return null;
      }
      inFlight.current = true;
      const external = signal();
      const controller = new AbortController();
      const abortFromOutside = () => controller.abort();
      external.addEventListener('abort', abortFromOutside);
      const timer = window.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
      try {
        const next = await pipelineApi.snapshot(projectId, controller.signal);
        if (!mounted.current) return next;
        failures.current = 0;
        setOffline(false);
        setSnapshot(next);
        setLastUpdatedAt(Date.now());
        setError(null);
        const nextSignature = signatureOf(next);
        if (options?.details || signature.current !== nextSignature) {
          signature.current = nextSignature;
          await loadDetails(projectId);
        }
        return next;
      } catch (err) {
        if (!mounted.current) return null;
        const pipelineError = isPipelineError(err)
          ? err
          : new PipelineRequestError({ code: 'NETWORK', message: err instanceof Error ? err.message : undefined, retryable: true });
        // 轮询的瞬时失败不覆盖已有画面：连续失败 3 次才降级。
        failures.current += 1;
        if (failures.current >= 3) setOffline(true);
        if (!options?.silent) setError(pipelineError);
        return null;
      } finally {
        window.clearTimeout(timer);
        external.removeEventListener('abort', abortFromOutside);
        inFlight.current = false;
        if (mounted.current) setLoading(false);
        const queued = pending.current;
        pending.current = null;
        // 保险：即使上面某条路径提前 return，也一定会把排队的刷新跑掉。
        if (queued && mounted.current) void fetchRef.current?.(queued);
      }
    },
    [loadDetails, projectId, signal],
  );

  useEffect(() => {
    fetchRef.current = fetchSnapshot;
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!projectId) return;
    signature.current = '';
    pending.current = null;
    failures.current = 0;
    setOffline(false);
    setLoading(true);
    void fetchSnapshot({ details: true });
  }, [fetchSnapshot, projectId]);

  // 轮询：按当前 job 状态决定节奏；页面不可见时暂停（回到前台立即补一次）。
  // offline 不是终点：降级后仍以低频探测，任一次成功即清 offline 并回到正常节奏。
  useEffect(() => {
    if (!projectId) return;
    const interval = offline ? OFFLINE_PROBE_MS : intervalFor(snapshot);
    if (!interval) return;
    let timer: number | undefined;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchSnapshot({ silent: true });
    };
    timer = window.setInterval(tick, interval);
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) void fetchSnapshot({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    // 浏览器从断网恢复时立刻探测一次，不必等下一个 tick。
    const onOnline = () => {
      void fetchSnapshot({ silent: true });
    };
    window.addEventListener('online', onOnline);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [fetchSnapshot, offline, projectId, snapshot]);

  const refresh = useCallback(
    (options?: { details?: boolean; silent?: boolean }) => fetchSnapshot({ details: options?.details ?? true, silent: options?.silent }),
    [fetchSnapshot],
  );

  const reloadDetails = useCallback(async () => {
    if (!projectId) return;
    try {
      await loadDetails(projectId);
    } catch {
      // 详情刷新失败不打断主流程，下一轮轮询会补上。
    }
  }, [loadDetails, projectId]);

  const applySnapshot = useCallback((next: PipelineSnapshot) => {
    signature.current = '';
    setSnapshot(next);
    setLastUpdatedAt(Date.now());
  }, []);

  return {
    snapshot,
    items: { p1: details.p1, p2: details.p2 },
    units: details.units,
    summary: details.summary,
    loading,
    error,
    offline,
    lastUpdatedAt,
    refresh,
    reloadDetails,
    applySnapshot,
  };
}
