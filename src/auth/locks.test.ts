import { describe, expect, it, vi } from 'vitest';
import { withLock } from './locks';

/** Minimal LockManager: exclusive locks, `ifAvailable` yields `null` while held. */
function fakeLocks(): LockManager {
  const held = new Map<string, Promise<unknown>>();
  return {
    async request(name: string, optsOrFn: unknown, maybeFn?: unknown) {
      const opts = (typeof optsOrFn === 'function' ? {} : optsOrFn) as LockOptions;
      const fn = (typeof optsOrFn === 'function' ? optsOrFn : maybeFn) as (lock: Lock | null) => Promise<unknown>;
      if (held.has(name) && opts.ifAvailable) return fn(null);
      while (held.has(name)) await held.get(name);
      const run = fn({ name, mode: 'exclusive' } as Lock);
      held.set(name, run);
      try {
        return await run;
      } finally {
        held.delete(name);
      }
    },
  } as unknown as LockManager;
}

describe('withLock', () => {
  it('runs directly without a lock manager', async () => {
    expect(await withLock('x', async () => 1, undefined, undefined)).toBe(1);
  });

  it('reports a busy lock and runs once it is free', async () => {
    const locks = fakeLocks();
    let release!: () => void;
    const first = withLock('x', () => new Promise<string>((r) => (release = () => r('a'))), undefined, locks);

    const onBusy = vi.fn();
    const second = withLock('x', async () => 'b', onBusy, locks);
    await vi.waitFor(() => expect(onBusy).toHaveBeenCalledOnce());

    release();
    expect(await first).toBe('a');
    expect(await second).toBe('b');
  });
});
