export type CloseGuard = () => boolean | Promise<boolean>;

const guards = new Set<CloseGuard>();
let running = false;

/** 注册当前页面的关窗守卫；返回注销函数。守卫返回 false 表示「先别关」。 */
export function registerCloseGuard(guard: CloseGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** 依次执行当前页 guard；任一失败或抛错 → false（调用方必须 cancelClose）。执行中重入直接 false。 */
export async function runCloseGuards(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    for (const guard of [...guards]) {
      if (!(await guard())) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    running = false;
  }
}

/** 调试/断言用：当前注册的 guard 数量，确保页面卸载后不泄漏。 */
export function closeGuardCount(): number {
  return guards.size;
}
