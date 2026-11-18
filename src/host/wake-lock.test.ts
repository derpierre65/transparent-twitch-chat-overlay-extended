import { describe, expect, it, vi } from 'vitest';
import { keepScreenAwake } from './wake-lock';

function fakeNavigator(request: ReturnType<typeof vi.fn>): Navigator {
  return { wakeLock: { request } } as unknown as Navigator;
}

describe('keepScreenAwake', () => {
  it('requests a screen lock and again when the page becomes visible', () => {
    const request = vi.fn().mockResolvedValue({});
    keepScreenAwake(document, fakeNavigator(request));
    expect(request).toHaveBeenCalledWith('screen');

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('swallows a denied request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied'));
    expect(() => keepScreenAwake(document, fakeNavigator(request))).not.toThrow();
    await Promise.resolve();
  });

  it('does nothing without the API', () => {
    expect(() => keepScreenAwake(document, {} as Navigator)).not.toThrow();
  });
});
