import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatDelay } from './chat-delay';
import type { OverlayEvent } from './types';

function chat(id: string, login: string, badges: string[] = []): OverlayEvent {
  return {
    id,
    ts: 0,
    type: 'chat',
    author: { id: login, login, displayName: login, color: null, badges: badges.map((setId) => ({ setId, version: '1' })) },
    text: 'hi',
    twitchEmotes: [],
    action: false,
    bits: 0,
  };
}

let emitted: string[];

beforeEach(() => {
  vi.useFakeTimers();
  emitted = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function gate(seconds: number) {
  const delay = createChatDelay({ emit: (e) => emitted.push(e.id) });
  delay.setSeconds(seconds);
  return delay;
}

describe('createChatDelay', () => {
  it('passes everything through without a delay', () => {
    gate(0).handle(chat('m1', 'viewer'));

    expect(emitted).toEqual(['m1']);
  });

  it('holds viewer messages for the configured time', () => {
    gate(6).handle(chat('m1', 'viewer'));

    vi.advanceTimersByTime(5999);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual(['m1']);
  });

  it('shows moderator and broadcaster messages immediately', () => {
    const delay = gate(6);
    delay.handle(chat('m1', 'mod', ['moderator']));
    delay.handle(chat('m2', 'streamer', ['broadcaster', 'subscriber']));

    expect(emitted).toEqual(['m1', 'm2']);
  });

  it('delays vip messages like any other viewer', () => {
    gate(2).handle(chat('m1', 'vip', ['vip']));

    expect(emitted).toEqual([]);
  });

  it('drops a held message that a mod deletes', () => {
    const delay = gate(6);
    delay.handle(chat('m1', 'viewer'));
    delay.handle({ id: 'del-m1', ts: 0, type: 'delete', targetId: 'm1' });

    vi.advanceTimersByTime(6000);
    expect(emitted).toEqual(['del-m1']);
  });

  it('drops held messages of a timed out user only', () => {
    const delay = gate(6);
    delay.handle(chat('m1', 'troll'));
    delay.handle(chat('m2', 'viewer'));
    delay.handle({ id: 'c1', ts: 0, type: 'clear', targetLogin: 'troll' });

    vi.advanceTimersByTime(6000);
    expect(emitted).toEqual(['c1', 'm2']);
  });

  it('drops all held messages when the chat is cleared', () => {
    const delay = gate(6);
    delay.handle(chat('m1', 'a'));
    delay.handle(chat('m2', 'b'));
    delay.handle({ id: 'c1', ts: 0, type: 'clear', targetLogin: null });

    vi.advanceTimersByTime(6000);
    expect(emitted).toEqual(['c1']);
  });

  it('passes non chat events through immediately', () => {
    gate(6).handle({ id: 'r1', ts: 0, type: 'raid', from: 'x', viewers: 1 });

    expect(emitted).toEqual(['r1']);
  });
});
