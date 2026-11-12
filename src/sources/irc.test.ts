import { describe, expect, it, vi } from 'vitest';
import { createIrcSource, type TmiLike } from './irc';
import type { OverlayEvent, StatusState } from '../events/types';

function fakeClient() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const client: TmiLike = {
    on: (event, handler) => void handlers.set(event, handler),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  return { client, fire: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args), handlers };
}

function setup() {
  const events: OverlayEvent[] = [];
  const status: StatusState[] = [];
  const fake = fakeClient();
  const source = createIrcSource({
    channel: 'derpierre65',
    emit: (e) => events.push(e),
    onStatus: (s) => status.push(s),
    clientFactory: () => fake.client,
  });
  return { events, status, fake, source };
}

describe('createIrcSource', () => {
  it('connects the client', async () => {
    const { fake, source } = setup();

    await source.connect();

    expect(fake.client.connect).toHaveBeenCalledOnce();
  });

  it('emits a chat event for a message', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('message', '#derpierre65', { id: 'a', username: 'u' }, 'hallo', false);

    expect(events[0]).toMatchObject({ type: 'chat', text: 'hallo' });
  });

  it('ignores its own echo', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('message', '#derpierre65', { id: 'a', username: 'u' }, 'hallo', true);

    expect(events).toHaveLength(0);
  });

  it('emits an action event for /me', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('action', '#derpierre65', { id: 'a', username: 'u' }, 'waves', false);

    expect(events[0]).toMatchObject({ type: 'chat', action: true });
  });

  it('emits a raid from a raw USERNOTICE', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('raw_message', {
      command: 'USERNOTICE',
      tags: { id: 'n1', 'msg-id': 'raid', 'msg-param-displayName': 'R', 'msg-param-viewerCount': '9' },
      params: ['#derpierre65'],
    });

    expect(events[0]).toMatchObject({ type: 'raid', viewers: 9 });
  });

  it('emits a notice for a msg-id tmi.js does not know', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('raw_message', {
      command: 'USERNOTICE',
      tags: { id: 'n2', 'msg-id': 'viewermilestone', 'system-msg': 'Milestone' },
      params: ['#derpierre65'],
    });

    expect(events[0]).toMatchObject({ type: 'notice', text: 'Milestone' });
  });

  it('ignores raw messages that are not USERNOTICE', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('raw_message', { command: 'PRIVMSG', tags: {}, params: ['#derpierre65'] });

    expect(events).toHaveLength(0);
  });

  it('emits delete and clear events', async () => {
    const { events, fake, source } = setup();
    await source.connect();

    fake.fire('messagedeleted', '#c', 'user', 'text', { 'target-msg-id': 'm1' });
    fake.fire('timeout', '#c', 'spammer', 'reason', 600);
    fake.fire('clearchat', '#c');

    expect(events[0]).toMatchObject({ type: 'delete', targetId: 'm1' });
    expect(events[1]).toMatchObject({ type: 'clear', targetLogin: 'spammer' });
    expect(events[2]).toMatchObject({ type: 'clear', targetLogin: null });
  });

  it('reports connection status', async () => {
    const { status, fake, source } = setup();
    await source.connect();

    fake.fire('connected');
    fake.fire('disconnected', 'closed');

    expect(status).toEqual(['ok', 'down']);
  });
});
