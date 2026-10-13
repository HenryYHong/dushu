// Timing that survives a busy machine: CPU time of this process instead of wall-clock time.

export interface Timing { wall: number; cpu: number }

/**
 * Speed budgets are set on a laptop. GitHub's shared CI machines are two to three times slower, so there the budgets get this
 * much room: a real regression still fails, a slow runner does not block a deploy.
 */
export const PERF_SLACK = process.env.CI ? 2.5 : 1;

/** Run `fn` and report both clocks in milliseconds. Tests assert on `cpu`; `wall` is for the log. */
export function measure<T>(fn: () => T): { result: T } & Timing {
  const c0 = process.cpuUsage();
  const w0 = performance.now();
  const result = fn();
  const wall = performance.now() - w0;
  const c = process.cpuUsage(c0);
  return { result, wall, cpu: (c.user + c.system) / 1000 };
}

export async function measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T } & Timing> {
  const c0 = process.cpuUsage();
  const w0 = performance.now();
  const result = await fn();
  const wall = performance.now() - w0;
  const c = process.cpuUsage(c0);
  return { result, wall, cpu: (c.user + c.system) / 1000 };
}
