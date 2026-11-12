import { getHost, hostLog, type HostCallbacks } from './log';

const MIN_GAP_MS = 150;

export interface SoundPlayer {
  play(): void;
}

export function createSoundPlayer(
  deps: { host?: HostCallbacks | null; now?: () => number } = {},
): SoundPlayer {
  const host = deps.host === undefined ? getHost() : deps.host;
  const now = deps.now ?? (() => Date.now());
  let last = Number.NEGATIVE_INFINITY;

  return {
    play() {
      if (!host) return;
      const t = now();
      // Otherwise a sub bomb fires 50 overlapping sounds.
      if (t - last < MIN_GAP_MS) return;
      last = t;

      try {
        void Promise.resolve(host.playSound()).catch((error: unknown) =>
          hostLog(`playSound failed: ${String(error)}`),
        );
      } catch (error) {
        hostLog(`playSound threw: ${String(error)}`);
      }
    },
  };
}
