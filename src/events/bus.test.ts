import { describe, expect, it, vi } from 'vitest';
import { createBus } from './bus';
import type { OverlayEvent } from './types';

const follow = (user: string): OverlayEvent => ({ id: user, ts: 0, type: 'follow', user });

describe('createBus', () => {
  it('delivers events to every listener', () => {
    const bus = createBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on(a);
    bus.on(b);

    bus.emit(follow('kappa'));

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = createBus();
    const fn = vi.fn();
    const off = bus.on(fn);

    off();
    bus.emit(follow('kappa'));

    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps delivering when one listener throws', () => {
    const bus = createBus();
    const boom = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    bus.on(boom);
    bus.on(ok);

    bus.emit(follow('kappa'));

    expect(ok).toHaveBeenCalledOnce();
  });
});
