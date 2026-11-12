import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n';
import { createRegistry } from '../emotes/registry';
import { emptyBadgeIndex } from '../badges/badges';
import { createChatLog } from './chat-log';
import type { OverlayEvent } from '../events/types';

const ctx = { emotes: createRegistry([]), badges: emptyBadgeIndex, t: MESSAGES.en };

const chat = (id: string, login = 'user'): OverlayEvent => ({
  id,
  ts: 0,
  type: 'chat',
  author: { login, displayName: login, color: null, badges: [] },
  text: id,
  twitchEmotes: [],
  action: false,
  bits: 0,
});

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('createChatLog', () => {
  it('appends so the newest line is last', () => {
    const log = createChatLog(root, { maxLines: 10, fade: 0, ctx });

    log.handle(chat('one'));
    log.handle(chat('two'));

    expect(root.children).toHaveLength(2);
    expect(root.children[0]?.textContent).toContain('one');
    expect(root.children[1]?.textContent).toContain('two');
  });

  it('trims the oldest line at the top', () => {
    const log = createChatLog(root, { maxLines: 2, fade: 0, ctx });

    log.handle(chat('one'));
    log.handle(chat('two'));
    log.handle(chat('three'));

    expect(root.children).toHaveLength(2);
    expect(root.textContent).not.toContain('one');
  });

  it('reports whether a line was inserted', () => {
    const log = createChatLog(root, { maxLines: 2, fade: 0, ctx });

    expect(log.handle(chat('one'))).toBe(true);
    expect(log.handle({ id: 'x', ts: 0, type: 'delete', targetId: 'one' })).toBe(false);
  });

  it('removes a single deleted message', () => {
    const log = createChatLog(root, { maxLines: 10, fade: 0, ctx });
    log.handle(chat('one'));
    log.handle(chat('two'));

    log.handle({ id: 'x', ts: 0, type: 'delete', targetId: 'one' });

    expect(root.children).toHaveLength(1);
    expect(root.textContent).toContain('two');
  });

  it('removes every message of a timed out user', () => {
    const log = createChatLog(root, { maxLines: 10, fade: 0, ctx });
    log.handle(chat('one', 'spammer'));
    log.handle(chat('two', 'other'));
    log.handle(chat('three', 'spammer'));

    log.handle({ id: 'x', ts: 0, type: 'clear', targetLogin: 'spammer' });

    expect(root.children).toHaveLength(1);
    expect(root.textContent).toContain('two');
  });

  it('clears everything when no login is given', () => {
    const log = createChatLog(root, { maxLines: 10, fade: 0, ctx });
    log.handle(chat('one'));

    log.handle({ id: 'x', ts: 0, type: 'clear', targetLogin: null });

    expect(root.children).toHaveLength(0);
  });

  it('does not schedule a fade when fade is 0', () => {
    const setTimeoutFn = vi.fn() as unknown as typeof setTimeout;
    const log = createChatLog(root, { maxLines: 10, fade: 0, ctx, setTimeoutFn });

    log.handle(chat('one'));

    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it('schedules a fade after the configured seconds', () => {
    const setTimeoutFn = vi.fn() as unknown as typeof setTimeout;
    const log = createChatLog(root, { maxLines: 10, fade: 5, ctx, setTimeoutFn });

    log.handle(chat('one'));

    expect((setTimeoutFn as unknown as { mock: { calls: [unknown, number][] } }).mock.calls[0]?.[1]).toBe(5000);
  });
});
