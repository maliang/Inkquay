import { now, uid } from '../db.ts';
import { getProjectDetail } from '../repository.ts';
import type { ProjectDetail } from '../../shared/types.ts';
import { ensureStages, exec, oneRow, setPipelineStatus, withTx } from './store.ts';
import type { JobRow } from './store.ts';
import { fail, kindProfileOf } from './types.ts';
import { planStepsForStage } from './steps.ts';
import { startJob } from './runner.ts';
import { precheck } from './snapshot.ts';

/**
 * 创建即落库（ARCHITECTURE §3.4 事务①）：作品 + 4 个阶段行（+ 可选首个 job）。
 * 与旧 createProject 的差别：**不预写空幕、不预写空章**（INV-6），失败也不会留下孤儿空壳。
 */

export interface CreatePipelineInput {
  title: string;
  type: string;
  genre?: string;
  premise?: string;
  targetWords?: number;
  styleNotes?: string;
  /** true = 创建后立刻开始 AI 企划（同一次请求返回 job） */
  start?: boolean;
  clientRequestId?: string;
}

export interface CreatePipelineResult {
  project: ProjectDetail;
  job: JobRow | null;
  replayed?: boolean;
}

const COVER_BY_TYPE: Record<string, string> = { screenplay: 'echo', short: 'ferry', series: 'ink', novel: 'fog' };

export function createPipelineProject(input: CreatePipelineInput): CreatePipelineResult {
  const title = (input.title || '').trim();
  if (!title) fail('BAD_REQUEST', '作品名不能为空');
  if (title.length > 80) fail('BAD_REQUEST', '作品名最多 80 字');
  const type = input.type || 'novel';
  const profile = kindProfileOf(type);
  const target = Math.round(Number(input.targetWords) || profile.defaultGoalWords);
  if (target < profile.minGoalWords || target > profile.maxGoalWords) {
    fail('BAD_REQUEST', `目标字数需在 ${profile.minGoalWords}–${profile.maxGoalWords} 之间`);
  }
  if (input.clientRequestId) {
    const existing = oneRow('SELECT id FROM projects WHERE client_request_id = ?', input.clientRequestId);
    if (existing) {
      const job = oneRow('SELECT * FROM generation_jobs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1', existing.id) as JobRow | undefined;
      return { project: getProjectDetail(String(existing.id))!, job: job ?? null, replayed: true };
    }
  }

  if (input.start) {
    // 勾了「创建后立即 AI 企划」就必须真的能跑：配置不满足时直接拒绝，不留空壳（SPEC §4.1）
    const ready = precheck();
    if (!ready.ok) fail(ready.code || 'NO_DEFAULT_MODEL', ready.message);
  }

  const id = uid('p');
  const timestamp = now();
  withTx(() => {
    exec(
      `INSERT INTO projects (id, title, type, genre, description, cover, status, total_words, goal_words, created_at, updated_at, pipeline_status, stale, style_notes, schema_version, client_request_id)
       VALUES (?, ?, ?, ?, ?, ?, '草稿', 0, ?, ?, ?, ?, 0, ?, 2, ?)`,
      id,
      title,
      type,
      input.genre || '',
      input.premise || '',
      COVER_BY_TYPE[type] || 'fog',
      target,
      timestamp,
      timestamp,
      input.start ? 'planning' : 'draft',
      input.styleNotes || '',
      input.clientRequestId || null,
    );
    ensureStages(id);
  });

  let job: JobRow | null = null;
  if (input.start) {
    const steps = planStepsForStage(id, 'p1');
    job = startJob({
      projectId: id,
      stageKey: 'p1',
      kind: 'plan',
      steps,
      clientRequestId: input.clientRequestId ? `${input.clientRequestId}:p1` : undefined,
    });
  }
  console.log(`[create] project=${id} type=${type} start=${Boolean(input.start)} job=${job?.id || '-'}`);
  return { project: getProjectDetail(id)!, job };
}

export function pipelinesSupported(type: string): boolean {
  return type === 'novel' || type === 'short';
}

export { setPipelineStatus };
