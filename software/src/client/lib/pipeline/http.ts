/**
 * 流水线接口的请求封装。
 *
 * 与旧的 `api.ts` 的 request 不同，流水线错误体是结构化的：
 * `{ code, message?, blockers?, detail?, retryable }`，前端只认 `code`，
 * 不解析 `message`（文案由本地的错误词表给，见 ./format.ts）。
 */
export class PipelineRequestError extends Error {
  code: string;
  status: number;
  blockers: string[];
  detail?: string;
  /** 服务端原始 `detail`（可能是对象，例如 `{ requiresConfirm: 'overwrite' }`）。 */
  detailRaw?: unknown;
  retryable: boolean;

  constructor(input: { code: string; message?: string; status?: number; blockers?: string[]; detail?: string; detailRaw?: unknown; retryable?: boolean }) {
    super(input.message || input.code);
    this.name = 'PipelineRequestError';
    this.code = input.code;
    this.status = input.status ?? 0;
    this.blockers = input.blockers ?? [];
    this.detail = input.detail;
    this.detailRaw = input.detailRaw;
    this.retryable = input.retryable ?? false;
  }
}

export function isPipelineError(error: unknown): error is PipelineRequestError {
  return error instanceof PipelineRequestError;
}

export function errorCodeOf(error: unknown): string {
  if (isPipelineError(error)) return error.code;
  return 'NETWORK';
}

/**
 * 服务端用 `detail.requiresConfirm === 'overwrite'` 表示「这件事只有一个补救动作：确认覆盖」。
 * 前端必须据此给出二次确认（N1：以前只有 API 直连能带上 confirmOverwrite，界面上是死路）。
 */
export function requiresConfirmOf(error: unknown): 'overwrite' | null {
  if (!isPipelineError(error)) return null;
  const raw = error.detailRaw;
  if (raw && typeof raw === 'object' && (raw as { requiresConfirm?: unknown }).requiresConfirm === 'overwrite') return 'overwrite';
  return null;
}

export function errorBlockersOf(error: unknown): string[] {
  if (isPipelineError(error)) return error.blockers;
  return [];
}

/** 只读接口的轮询失败不应该每次都变成红条，调用方可以据此忽略瞬时错误。 */
export async function pipelineRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
  } catch (error) {
    throw new PipelineRequestError({
      code: 'NETWORK',
      message: error instanceof Error ? error.message : '无法连接本地服务',
      status: 0,
      retryable: true,
    });
  }
  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    throw new PipelineRequestError({
      code: typeof data?.code === 'string' ? data.code : `HTTP_${response.status}`,
      message: typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : undefined,
      status: response.status,
      blockers: Array.isArray(data?.blockers) ? data.blockers.map(String) : undefined,
      detail: typeof data?.detail === 'string' ? data.detail : undefined,
      detailRaw: data?.detail,
      retryable: typeof data?.retryable === 'boolean' ? data.retryable : undefined,
    });
  }
  return data as T;
}

export function withIdempotencyKey(key?: string): Record<string, string> {
  if (!key) return {};
  return { 'Idempotency-Key': key };
}
