import { isModerator } from '../events/chat-delay';
import type { ChatEvent, OverlayEvent } from '../events/types';
import { renderEvent, type RenderContext } from '../render/templates';
import type { ApprovalView } from './approval-view';

export type ModAction = 'trust' | 'approve' | 'delete' | 'timeout' | 'ban';

export interface ActionTarget {
  messageId: string;
  userId: string;
  login: string;
}

export interface ModLogState {
  view: ApprovalView;
  /** Ably is connected and the overlay is present. */
  approvalReady: boolean;
  /** Why approval clicks have no effect right now; empty if they do. */
  approvalNote: string;
  /** Why delete/timeout/ban are unavailable; empty if they are available. */
  moderationNote: string;
}

export interface ModLog {
  handle(event: OverlayEvent): void;
  /** Redraws the status of every line after the approval view or the login changed. */
  refresh(): void;
}

const MAX_LINES = 1000;
// Within this distance of the bottom, new lines keep the log scrolled down.
const STICK_PX = 40;

const ICONS: Record<ModAction, string> = {
  trust:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 9c-3.3 0-6 1.8-6 4v2h8.3A5.5 5.5 0 0 1 11 11.4 9 9 0 0 0 8 11z"/><path d="m18.7 12.7-4.2 4.2-2.7-2.7 1.4-1.4 1.3 1.3 2.8-2.8 1.4 1.4z"/></svg>',
  approve:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l-4 3v-3H4a2 2 0 0 1-2-2V4zm11.8 1.8-4.8 4.8-2.8-2.8-1.4 1.4 4.2 4.2 6.2-6.2-1.4-1.4z" clip-rule="evenodd"/></svg>',
  ban: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15 15 5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  timeout:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 6v4.5l3 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  delete:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 2h6l1 2h4v2H2V4h4l1-2zM4 7h12l-1 11H5L4 7z"/></svg>',
};

const TITLES: Record<ModAction, string> = {
  trust: 'Trust user',
  approve: 'Approve message',
  delete: 'Delete message',
  timeout: 'Timeout 10 minutes',
  ban: 'Ban user',
};

/** Twitch-like chat with approval and moderation buttons on every chat line. */
export function createModLog(
  root: HTMLElement,
  opts: {
    ctx: RenderContext;
    state: () => ModLogState;
    onAction: (action: ModAction, target: ActionTarget, button: HTMLButtonElement) => void;
  },
): ModLog {
  function button(action: ModAction): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'act';
    btn.dataset['action'] = action;
    btn.setAttribute('aria-label', TITLES[action]);
    btn.title = TITLES[action];
    // Static SVG only; message text is never set as HTML.
    btn.innerHTML = ICONS[action];
    return btn;
  }

  function decorate(el: HTMLElement, event: ChatEvent): void {
    el.classList.add('mod-line');
    el.dataset['userId'] = event.author.id;
    el.dataset['login'] = event.author.login;
    if (isModerator(event.author)) el.classList.add('is-exempt');

    const group = document.createElement('span');
    group.className = 'acts';
    // Twitch's order first, then the approval buttons.
    if (!event.author.badges.some((badge) => badge.setId === 'broadcaster')) {
      group.append(button('ban'), button('timeout'), button('delete'));
    }
    if (!isModerator(event.author)) group.append(button('trust'), button('approve'));
    el.prepend(group);

    const time = document.createElement('span');
    time.className = 'time';
    time.append(document.createTextNode(new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    el.prepend(time);
  }

  function by(entry: { by: string | null }): string {
    return entry.by ?? 'a mod';
  }

  function update(el: HTMLElement, state: ModLogState): void {
    const messageId = el.dataset['msgId'] ?? '';
    const userId = el.dataset['userId'] ?? '';
    const trusted = state.view.trusted.get(userId);
    const approved = state.view.approved.get(messageId);
    const exempt = el.classList.contains('is-exempt');
    const removed = el.classList.contains('is-deleted') || el.classList.contains('is-cleared');

    el.classList.toggle('is-held', !exempt && !trusted && !approved && !removed);
    el.classList.toggle('is-shown', exempt || !!trusted || !!approved);

    const note = state.approvalNote ? `\n${state.approvalNote}` : '';
    for (const btn of el.querySelectorAll<HTMLButtonElement>('button.act')) {
      if (btn.dataset['flash'] || btn.dataset['busy']) continue;
      const action = btn.dataset['action'] as ModAction;
      if (action === 'trust') {
        btn.classList.toggle('is-active', !!trusted);
        btn.classList.toggle('is-offline', !state.approvalReady);
        btn.title = (trusted ? `Trusted by ${by(trusted)} (click: untrust)` : TITLES.trust) + note;
      } else if (action === 'approve') {
        btn.classList.toggle('is-active', !!approved);
        btn.classList.toggle('is-implied', !approved && !!trusted);
        btn.classList.toggle('is-offline', !state.approvalReady);
        btn.title = (approved ? `Approved by ${by(approved)}` : trusted ? 'User is trusted' : TITLES.approve) + note;
      } else {
        btn.disabled = state.moderationNote !== '' || (action === 'delete' && removed);
        btn.title = state.moderationNote || TITLES[action];
      }
    }
  }

  root.addEventListener('click', (event) => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('button.act');
    const line = btn?.closest<HTMLElement>('.mod-line');
    if (!btn || !line || btn.disabled) return;
    opts.onAction(
      btn.dataset['action'] as ModAction,
      { messageId: line.dataset['msgId'] ?? '', userId: line.dataset['userId'] ?? '', login: line.dataset['login'] ?? '' },
      btn,
    );
  });

  function mark(predicate: (el: HTMLElement) => boolean, className: string): void {
    const state = opts.state();
    for (const el of root.querySelectorAll<HTMLElement>('.mod-line')) {
      if (!predicate(el)) continue;
      el.classList.add(className);
      update(el, state);
    }
  }

  return {
    handle(event) {
      // Marked instead of removed, so mods see what happened.
      if (event.type === 'delete') {
        mark((el) => el.dataset['msgId'] === event.targetId, 'is-deleted');
        return;
      }
      if (event.type === 'clear') {
        mark((el) => event.targetLogin === null || el.dataset['login'] === event.targetLogin, 'is-cleared');
        return;
      }

      const el = renderEvent(event, opts.ctx);
      if (!el) return;
      el.dataset['msgId'] = event.id;
      if (event.type === 'chat') {
        decorate(el, event);
        update(el, opts.state());
      }

      const stick = root.scrollHeight - root.scrollTop - root.clientHeight < STICK_PX;
      root.append(el);
      while (root.children.length > MAX_LINES) root.firstElementChild?.remove();
      if (stick) root.scrollTop = root.scrollHeight;
    },

    refresh() {
      const state = opts.state();
      for (const el of root.querySelectorAll<HTMLElement>('.mod-line')) update(el, state);
    },
  };
}
