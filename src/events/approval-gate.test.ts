import { beforeEach, describe, expect, it } from 'vitest';
import { createApprovalGate, type TrustList } from './approval-gate';
import type { OverlayEvent } from './types';

function chat(id: string, userId: string, login = `user${userId}`, badges: string[] = []): OverlayEvent {
  return {
    id,
    ts: 0,
    type: 'chat',
    author: { id: userId, login, displayName: login, color: null, badges: badges.map((setId) => ({ setId, version: '1' })) },
    text: 'hi',
    twitchEmotes: [],
    action: false,
    bits: 0,
  };
}

let emitted: string[];
let clock: number;
let trusted: Map<string, string>;

const trust: TrustList = {
  has: (userId) => trusted.has(userId),
  add: (userId, login) => void trusted.set(userId, login),
  remove: (userId) => void trusted.delete(userId),
};

beforeEach(() => {
  emitted = [];
  clock = 0;
  trusted = new Map();
});

function gate(over: Partial<Parameters<typeof createApprovalGate>[0]> = {}) {
  return createApprovalGate({ emit: (e) => emitted.push(e.id), trust, now: () => clock, ...over });
}

describe('createApprovalGate', () => {
  it('holds messages of unknown viewers', () => {
    gate().handle(chat('m1', '1'));

    expect(emitted).toEqual([]);
  });

  it('passes moderator and broadcaster messages through', () => {
    const g = gate();
    g.handle(chat('m1', '1', 'mod', ['moderator']));
    g.handle(chat('m2', '2', 'streamer', ['broadcaster']));

    expect(emitted).toEqual(['m1', 'm2']);
  });

  it('reports only held messages', () => {
    const held: string[] = [];
    trusted.set('2', 'friend');
    const g = gate({ onHeld: (e) => held.push(e.id) });
    g.command({ type: 'approve-message', messageId: 'm4', login: null, by: null });

    g.handle(chat('m1', '1'));
    g.handle(chat('m2', '2'));
    g.handle(chat('m3', '3', 'mod', ['moderator']));
    g.handle(chat('m4', '4'));

    expect(held).toEqual(['m1']);
  });

  it('holds vip messages like any other viewer', () => {
    gate().handle(chat('m1', '1', 'vip', ['vip']));

    expect(emitted).toEqual([]);
  });

  it('passes messages of trusted users through', () => {
    trusted.set('1', 'friend');
    gate().handle(chat('m1', '1'));

    expect(emitted).toEqual(['m1']);
  });

  it('never treats a message without user id as trusted', () => {
    trusted.set('', 'nobody');
    gate().handle(chat('m1', ''));

    expect(emitted).toEqual([]);
  });

  it('releases all held messages of a newly trusted user in order', () => {
    const g = gate();
    g.handle(chat('m1', '1'));
    g.handle(chat('m2', '2'));
    g.handle(chat('m3', '1'));

    g.command({ type: 'trust-user', userId: '1', login: 'user1', by: null });

    expect(emitted).toEqual(['m1', 'm3']);
    expect(trusted.get('1')).toBe('user1');
    g.handle(chat('m4', '1'));
    expect(emitted).toEqual(['m1', 'm3', 'm4']);
  });

  it('holds messages again after untrust', () => {
    trusted.set('1', 'user1');
    const g = gate();
    g.command({ type: 'untrust-user', userId: '1', login: 'user1', by: null });
    g.handle(chat('m1', '1'));

    expect(trusted.has('1')).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('releases a single approved message', () => {
    const g = gate();
    g.handle(chat('m1', '1'));
    g.handle(chat('m2', '1'));

    g.command({ type: 'approve-message', messageId: 'm2', login: null, by: null });

    expect(emitted).toEqual(['m2']);
    expect(trusted.size).toBe(0);
  });

  it('lets a message through that was approved before it arrived', () => {
    const g = gate();
    g.command({ type: 'approve-message', messageId: 'm1', login: null, by: null });
    clock = 119_999;
    g.handle(chat('m1', '1'));

    expect(emitted).toEqual(['m1']);
  });

  it('forgets an early approval after two minutes', () => {
    const g = gate();
    g.command({ type: 'approve-message', messageId: 'm1', login: null, by: null });
    clock = 120_000;
    g.handle(chat('m1', '1'));

    expect(emitted).toEqual([]);
  });

  it('uses an early approval only once', () => {
    const g = gate();
    g.command({ type: 'approve-message', messageId: 'm1', login: null, by: null });
    g.handle(chat('m1', '1'));
    g.handle(chat('m1', '1'));

    expect(emitted).toEqual(['m1']);
  });

  it('bounds the number of early approvals', () => {
    const g = gate({ maxEarlyApprovals: 2 });
    g.command({ type: 'approve-message', messageId: 'a', login: null, by: null });
    g.command({ type: 'approve-message', messageId: 'b', login: null, by: null });
    g.command({ type: 'approve-message', messageId: 'c', login: null, by: null });
    for (const id of ['a', 'b', 'c']) g.handle(chat(id, '1'));

    expect(emitted).toEqual(['b', 'c']);
  });

  it('drops the oldest held message when the buffer is full', () => {
    const g = gate({ maxHeld: 2 });
    g.handle(chat('m1', '1'));
    g.handle(chat('m2', '1'));
    g.handle(chat('m3', '1'));

    g.command({ type: 'trust-user', userId: '1', login: 'user1', by: null });
    expect(emitted).toEqual(['m2', 'm3']);
  });

  it('drops held messages after 30 minutes', () => {
    const g = gate();
    g.handle(chat('m1', '1'));
    clock = 10 * 60_000;
    g.handle(chat('m2', '1'));
    clock = 30 * 60_000;

    g.command({ type: 'trust-user', userId: '1', login: 'user1', by: null });
    expect(emitted).toEqual(['m2']);
  });

  it('removes a deleted message and passes the delete on', () => {
    const g = gate();
    g.handle(chat('m1', '1'));
    g.handle({ id: 'del', ts: 0, type: 'delete', targetId: 'm1' });
    g.command({ type: 'approve-message', messageId: 'm1', login: null, by: null });

    expect(emitted).toEqual(['del']);
  });

  it('removes held messages of a timed out user only', () => {
    const g = gate();
    g.handle(chat('m1', '1', 'troll'));
    g.handle(chat('m2', '2', 'viewer'));
    g.handle({ id: 'c1', ts: 0, type: 'clear', targetLogin: 'troll' });
    g.command({ type: 'trust-user', userId: '1', login: 'troll', by: null });
    g.command({ type: 'trust-user', userId: '2', login: 'viewer', by: null });

    expect(emitted).toEqual(['c1', 'm2']);
  });

  it('removes all held messages when the chat is cleared', () => {
    const g = gate();
    g.handle(chat('m1', '1'));
    g.handle({ id: 'c1', ts: 0, type: 'clear', targetLogin: null });
    g.command({ type: 'trust-user', userId: '1', login: 'user1', by: null });

    expect(emitted).toEqual(['c1']);
  });

  it('passes non chat events through', () => {
    gate().handle({ id: 'r1', ts: 0, type: 'raid', from: 'x', viewers: 1 });

    expect(emitted).toEqual(['r1']);
  });

  it('releases messages of users trusted by a later loaded list', () => {
    const g = gate();
    g.handle(chat('m1', '1'));
    g.handle(chat('m2', '2'));
    trusted.set('2', 'user2');

    g.releaseTrusted();
    expect(emitted).toEqual(['m2']);
  });
});
