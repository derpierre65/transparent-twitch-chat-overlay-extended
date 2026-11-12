import { describe, expect, it, vi } from 'vitest';
import { createSoundPlayer } from './sound';

function fakeHost() {
  return { playSound: vi.fn(() => Promise.resolve()), logMessage: vi.fn() };
}

describe('createSoundPlayer', () => {
  it('does nothing when the host bridge is missing', () => {
    const player = createSoundPlayer({ host: null });
    expect(() => player.play()).not.toThrow();
  });

  it('plays once per call when calls are far apart', () => {
    const host = fakeHost();
    let t = 0;
    const player = createSoundPlayer({ host, now: () => t });

    player.play();
    t = 1000;
    player.play();

    expect(host.playSound).toHaveBeenCalledTimes(2);
  });

  it('swallows bursts inside the 150ms window', () => {
    const host = fakeHost();
    let t = 0;
    const player = createSoundPlayer({ host, now: () => t });

    player.play();
    t = 10;
    player.play();
    t = 149;
    player.play();
    t = 150;
    player.play();

    expect(host.playSound).toHaveBeenCalledTimes(2);
  });

  it('survives a rejecting host promise', async () => {
    const host = { playSound: vi.fn(() => Promise.reject(new Error('no device'))), logMessage: vi.fn() };
    const player = createSoundPlayer({ host, now: () => 0 });

    player.play();
    await Promise.resolve();

    expect(host.playSound).toHaveBeenCalledOnce();
  });

  it('survives a host that throws synchronously', () => {
    const host = {
      playSound: vi.fn(() => {
        throw new Error('gone');
      }),
      logMessage: vi.fn(),
    };
    const player = createSoundPlayer({ host, now: () => 0 });

    expect(() => player.play()).not.toThrow();
  });
});
