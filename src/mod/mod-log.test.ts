import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBadgeIndex } from '../badges/badges';
import { createRegistry } from '../emotes/registry';
import type { ChatEvent } from '../events/types';
import { MESSAGES } from '../i18n';
import { createApprovalView } from './approval-view';
import { createModLog, type ModLogState } from './mod-log';

function chat(id: string, login: string, badges: string[] = [], text = 'hi'): ChatEvent {
  return {
    id,
    ts: 0,
    type: 'chat',
    author: { id: `u-${login}`, login, displayName: login, color: null, badges: badges.map((setId) => ({ setId, version: '1' })) },
    text,
    twitchEmotes: [],
    action: false,
    bits: 0,
  };
}

let root: HTMLElement;
let state: ModLogState;
const onAction = vi.fn();

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  state = { view: createApprovalView(), approvalReady: true, approvalNote: '', moderationNote: '' };
  onAction.mockReset();
});

function log() {
  return createModLog(root, {
    ctx: { emotes: createRegistry([]), badges: emptyBadgeIndex, t: MESSAGES.en },
    state: () => state,
    onAction,
  });
}

const line = (id: string) => root.querySelector<HTMLElement>(`[data-msg-id="${id}"]`)!;
const actions = (id: string) => [...line(id).querySelectorAll<HTMLButtonElement>('button.act')].map((b) => b.dataset['action']);

describe('mod log', () => {
  it('offers approval buttons only for messages the overlay holds back', () => {
    const l = log();
    l.handle(chat('1', 'viewer'));
    l.handle(chat('2', 'mod', ['moderator']));
    l.handle(chat('3', 'streamer', ['broadcaster']));

    expect(actions('1')).toEqual(['ban', 'timeout', 'delete', 'trust', 'approve']);
    expect(actions('2')).toEqual(['ban', 'timeout', 'delete']);
    expect(actions('3')).toEqual([]);
    expect(line('1').classList.contains('is-held')).toBe(true);
    expect(line('2').classList.contains('is-shown')).toBe(true);
  });

  it('marks a line as shown once the user is trusted', () => {
    const l = log();
    l.handle(chat('1', 'viewer'));
    state.view.apply({ name: 'trust-user', data: { userId: 'u-viewer', login: 'viewer' }, clientId: 'Mod', connectionId: 'c' });
    l.refresh();

    const trust = line('1').querySelector<HTMLButtonElement>('[data-action="trust"]')!;
    expect(line('1').classList.contains('is-shown')).toBe(true);
    expect(trust.classList.contains('is-active')).toBe(true);
    expect(trust.title).toContain('Trusted by Mod');
  });

  it('disables moderation until it is available and says why', () => {
    state.moderationNote = 'Log in with Twitch to delete, time out or ban.';
    log().handle(chat('1', 'viewer'));

    const ban = line('1').querySelector<HTMLButtonElement>('[data-action="ban"]')!;
    expect(ban.disabled).toBe(true);
    expect(ban.title).toBe(state.moderationNote);
  });

  it('keeps deleted and cleared lines, marked', () => {
    const l = log();
    l.handle(chat('1', 'viewer'));
    l.handle(chat('2', 'spammer'));
    l.handle({ id: 'd', ts: 0, type: 'delete', targetId: '1' });
    l.handle({ id: 'c', ts: 0, type: 'clear', targetLogin: 'spammer' });

    expect(line('1').classList.contains('is-deleted')).toBe(true);
    expect(line('1').classList.contains('is-held')).toBe(false);
    expect(line('2').classList.contains('is-cleared')).toBe(true);
  });

  it('passes the clicked target on', () => {
    log().handle(chat('m1', 'viewer'));
    line('m1').querySelector<HTMLButtonElement>('[data-action="approve"]')!.click();

    expect(onAction).toHaveBeenCalledWith(
      'approve',
      { messageId: 'm1', userId: 'u-viewer', login: 'viewer' },
      expect.any(HTMLButtonElement),
    );
  });

  it('renders message text as text', () => {
    log().handle(chat('1', 'viewer', [], '<img src=x onerror=alert(1)>'));
    expect(line('1').querySelector('.msg img')).toBeNull();
    expect(line('1').querySelector('.msg')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
