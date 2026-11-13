import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../events/types';
import { createHeldNotice } from './held-notice';

function chat(userId: string, login = `user${userId}`): ChatEvent {
  return {
    id: `m-${Math.random()}`,
    ts: 0,
    type: 'chat',
    author: { id: userId, login, displayName: login, color: null, badges: [] },
    text: 'secret text',
    twitchEmotes: [],
    action: false,
    bits: 0,
  };
}

describe('createHeldNotice', () => {
  it('notifies once per user within the cooldown', () => {
    let clock = 0;
    const notified: string[] = [];
    const held = createHeldNotice({ notify: (login) => notified.push(login), now: () => clock, cooldownMs: 1000 });

    held(chat('1'));
    held(chat('1'));
    held(chat('2'));
    clock = 999;
    held(chat('1'));
    clock = 1000;
    held(chat('1'));

    expect(notified).toEqual(['user1', 'user2', 'user1']);
  });

  it('forgets the oldest users above the limit', () => {
    const notified: string[] = [];
    const held = createHeldNotice({ notify: (login) => notified.push(login), now: () => 0, max: 2 });

    held(chat('1'));
    held(chat('2'));
    held(chat('3'));
    held(chat('1'));

    expect(notified).toEqual(['user1', 'user2', 'user3', 'user1']);
  });
});
