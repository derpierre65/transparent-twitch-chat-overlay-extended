/**
 * Several overlay windows of the host app share one WebView2 profile and thus one
 * `localStorage`. Refresh tokens are single-use, so only one window may use them at a time.
 */
export async function withLock<T>(
  name: string,
  fn: () => Promise<T>,
  onBusy?: () => void,
  locks: LockManager | undefined = globalThis.navigator?.locks,
): Promise<T> {
  if (!locks) return fn();

  let ran = false;
  let result: T | undefined;
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    result = await fn();
  });
  if (ran) return result as T;

  onBusy?.();
  return locks.request(name, fn) as Promise<T>;
}
