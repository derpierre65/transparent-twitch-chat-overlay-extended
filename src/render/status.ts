import type { StatusKey, StatusState } from '../events/types';

const LABEL: Record<StatusKey, string> = {
  irc: 'Chat',
  eventsub: 'Events',
  token: 'Token',
};

export interface StatusPill {
  set(key: StatusKey, state: StatusState): void;
  onClick(handler: () => void): void;
}

export function createStatusPill(el: HTMLElement): StatusPill {
  const states = new Map<StatusKey, StatusState>();

  function render(): void {
    const broken = [...states.entries()]
      .filter(([, state]) => state === 'down')
      .map(([key]) => LABEL[key]);

    el.hidden = broken.length === 0;
    el.replaceChildren(document.createTextNode(broken.join(' · ')));
  }

  return {
    set(key, state) {
      states.set(key, state);
      render();
    },
    onClick(handler) {
      el.addEventListener('click', () => handler());
    },
  };
}
