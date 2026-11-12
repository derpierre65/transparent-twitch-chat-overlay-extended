import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusPill } from './status';

let el: HTMLElement;

beforeEach(() => {
  el = document.createElement('div');
  el.hidden = true;
  document.body.replaceChildren(el);
});

describe('createStatusPill', () => {
  it('stays hidden while everything is ok', () => {
    const pill = createStatusPill(el);

    pill.set('irc', 'ok');
    pill.set('eventsub', 'ok');
    pill.set('token', 'ok');

    expect(el.hidden).toBe(true);
  });

  it('shows the failing parts', () => {
    const pill = createStatusPill(el);

    pill.set('irc', 'ok');
    pill.set('token', 'down');

    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain('Token');
  });

  it('hides again once everything recovers', () => {
    const pill = createStatusPill(el);
    pill.set('eventsub', 'down');

    pill.set('eventsub', 'ok');

    expect(el.hidden).toBe(true);
  });

  it('forwards clicks', () => {
    const pill = createStatusPill(el);
    const handler = vi.fn();
    pill.onClick(handler);

    el.dispatchEvent(new MouseEvent('click'));

    expect(handler).toHaveBeenCalledOnce();
  });
});
