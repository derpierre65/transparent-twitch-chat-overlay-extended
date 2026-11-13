import type { ChatEvent } from '../events/types';

/** One notice per user per cooldown, so a spammer cannot push real chat off the overlay. */
export function createHeldNotice(opts: {
  notify: (login: string) => void;
  now?: () => number;
  cooldownMs?: number;
  max?: number;
}): (event: ChatEvent) => void {
  const now = opts.now ?? Date.now;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const max = opts.max ?? 500;
  // Insertion order equals expiry order.
  const last = new Map<string, number>();

  return (event) => {
    const at = now();
    for (const [key, time] of last) {
      if (at - time < cooldownMs && last.size < max) break;
      last.delete(key);
    }

    const key = event.author.id || event.author.login;
    if (last.has(key)) return;
    last.set(key, at);
    opts.notify(event.author.login);
  };
}
