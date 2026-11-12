import type { OverlayEvent } from '../events/types';
import { renderEvent, type RenderContext } from './templates';

const FADE_OUT_MS = 400; // must match the transition in styles.css

export interface ChatLog {
  handle(event: OverlayEvent): boolean;
}

export function createChatLog(
  root: HTMLElement,
  opts: {
    maxLines: number;
    fade: number;
    ctx: RenderContext;
    setTimeoutFn?: typeof setTimeout;
  },
): ChatLog {
  const schedule = opts.setTimeoutFn ?? setTimeout;

  function removeWhere(predicate: (el: Element) => boolean): void {
    for (const child of [...root.children]) {
      if (predicate(child)) child.remove();
    }
  }

  return {
    handle(event) {
      if (event.type === 'delete') {
        removeWhere((el) => el.getAttribute('data-msg-id') === event.targetId);
        return false;
      }

      if (event.type === 'clear') {
        const login = event.targetLogin;
        removeWhere((el) => login === null || el.getAttribute('data-login') === login);
        return false;
      }

      const el = renderEvent(event, opts.ctx);
      if (!el) return false;

      el.setAttribute('data-msg-id', event.id);
      if (event.type === 'chat') el.setAttribute('data-login', event.author.login);

      root.append(el);
      while (root.children.length > opts.maxLines) root.firstElementChild?.remove();

      // Trimmed, not scrolled: otherwise the newest line slides out at the bottom.
      while (root.children.length > 1 && root.scrollHeight > root.clientHeight) {
        root.firstElementChild?.remove();
      }

      if (opts.fade > 0) {
        schedule(() => {
          el.classList.add('is-fading');
          schedule(() => el.remove(), FADE_OUT_MS);
        }, opts.fade * 1000);
      }

      return true;
    },
  };
}
