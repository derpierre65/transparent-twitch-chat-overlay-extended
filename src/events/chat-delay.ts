import type { Author, OverlayEvent } from './types';

const EXEMPT_BADGES = new Set(['broadcaster', 'moderator']);

export function isModerator(author: Author): boolean {
  return author.badges.some((badge) => EXEMPT_BADGES.has(badge.setId));
}

export interface ChatDelay {
  handle(event: OverlayEvent): void;
  setSeconds(seconds: number): void;
}

/**
 * Mirrors Twitch's non-mod chat delay: IRC delivers messages instantly, viewers only see
 * them after the delay. Whatever mods delete in the meantime never shows up.
 */
export function createChatDelay(opts: {
  emit: (event: OverlayEvent) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): ChatDelay {
  const schedule = opts.setTimeoutFn ?? setTimeout;
  const unschedule = opts.clearTimeoutFn ?? clearTimeout;
  const pending = new Map<string, { login: string; timer: ReturnType<typeof setTimeout> }>();
  let seconds = 0;

  function drop(predicate: (login: string, id: string) => boolean): void {
    for (const [id, entry] of pending) {
      if (!predicate(entry.login, id)) continue;
      unschedule(entry.timer);
      pending.delete(id);
    }
  }

  return {
    handle(event) {
      if (event.type === 'chat' && seconds > 0 && !isModerator(event.author)) {
        const timer = schedule(() => {
          pending.delete(event.id);
          opts.emit(event);
        }, seconds * 1000);
        pending.set(event.id, { login: event.author.login, timer });
        return;
      }

      if (event.type === 'delete') drop((_, id) => id === event.targetId);
      if (event.type === 'clear') drop((login) => event.targetLogin === null || login === event.targetLogin);
      opts.emit(event);
    },
    setSeconds(next) {
      seconds = Math.max(0, next);
    },
  };
}
