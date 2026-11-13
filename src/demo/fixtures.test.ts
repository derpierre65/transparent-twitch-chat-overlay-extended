import { describe, expect, it, vi } from 'vitest';
import { demoEvents, playDemo } from './fixtures';

describe('demoEvents', () => {
  it('covers every rendered event type', () => {
    const types = new Set(demoEvents().map((e) => e.type));

    for (const type of [
      'chat',
      'raid',
      'sub',
      'resub',
      'giftsub',
      'subbomb',
      'announcement',
      'redemption',
      'follow',
      'hypetrain',
      'adbreak',
      'notice',
    ]) {
      expect(types).toContain(type);
    }
  });

  it('includes a hostile message to test escaping', () => {
    const hostile = demoEvents().find((e) => e.type === 'chat' && e.text.includes('<img'));

    expect(hostile).toBeDefined();
  });

  it('includes a long redemption input', () => {
    const long = demoEvents().find((e) => e.type === 'redemption' && (e.input?.length ?? 0) > 100);

    expect(long).toBeDefined();
  });
});

describe('playDemo', () => {
  it('schedules every event', () => {
    const setTimeoutFn = vi.fn() as unknown as typeof setTimeout;

    playDemo(() => {}, setTimeoutFn);

    expect((setTimeoutFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(
      demoEvents().length,
    );
  });
});
