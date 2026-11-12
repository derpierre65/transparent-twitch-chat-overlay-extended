import { describe, expect, it, vi } from 'vitest';
import { TOPICS, createEventSubSource, type SocketLike } from './eventsub';
import type { OverlayEvent, StatusState } from '../events/types';

function fakeSocket(): SocketLike & { sent: string[]; closed: boolean } {
  return {
    sent: [],
    closed: false,
    send(data) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
}

function welcome(sessionId = 's1', keepalive = 10) {
  return JSON.stringify({
    metadata: { message_type: 'session_welcome', message_id: 'w1' },
    payload: { session: { id: sessionId, keepalive_timeout_seconds: keepalive } },
  });
}

function setup(
  grantedScopes: string[] = TOPICS.map((t) => t.scope),
  fetchOk = true,
) {
  const sockets: (SocketLike & { sent: string[]; closed: boolean })[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const events: OverlayEvent[] = [];
  const status: StatusState[] = [];

  const fetchFn = vi.fn(async () =>
    fetchOk ? new Response('{}', { status: 202 }) : new Response('nope', { status: 403 }),
  ) as unknown as typeof fetch;

  const source = createEventSubSource({
    clientId: 'c',
    getToken: () => 't',
    broadcasterId: '123',
    grantedScopes,
    emit: (e) => events.push(e),
    onStatus: (s) => status.push(s),
    socketFactory: () => {
      const socket = fakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimeoutFn: ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
    fetchFn,
  });

  return { source, sockets, timers, events, status, fetchFn };
}

describe('createEventSubSource', () => {
  it('subscribes to every granted topic after welcome', async () => {
    const { source, sockets, fetchFn } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });
    await vi.waitFor(() =>
      expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(TOPICS.length),
    );

    const body = JSON.parse(
      ((fetchFn as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]![1].body as string),
    ) as { transport: { session_id: string } };
    expect(body.transport.session_id).toBe('s1');
  });

  it('skips topics whose scope was not granted', async () => {
    const { source, sockets, fetchFn } = setup(['channel:read:redemptions']);
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });
    await vi.waitFor(() =>
      expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1),
    );
  });

  it('emits a normalized notification', () => {
    const { source, sockets, events } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'notification', message_id: 'n1', subscription_type: 'channel.follow' },
        payload: { event: { user_name: 'Newbie' } },
      }),
    });

    expect(events[0]).toMatchObject({ type: 'follow', user: 'Newbie' });
  });

  it('ignores a duplicate message id', () => {
    const { source, sockets, events } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    const message = JSON.stringify({
      metadata: { message_type: 'notification', message_id: 'n1', subscription_type: 'channel.follow' },
      payload: { event: { user_name: 'Newbie' } },
    });
    sockets[0]!.onmessage?.({ data: message });
    sockets[0]!.onmessage?.({ data: message });

    expect(events).toHaveLength(1);
  });

  it('arms a keepalive timer with a safety margin', () => {
    const { source, sockets, timers } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1', 10) });

    expect(timers.at(-1)?.ms).toBe(13000);
  });

  it('reconnects when keepalive expires', () => {
    const { source, sockets, timers, status } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    timers.at(-1)!.fn();

    expect(status).toContain('down');
    expect(sockets).toHaveLength(2);
  });

  it('closes the old socket only after the new one welcomes', () => {
    const { source, sockets } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });

    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'session_reconnect', message_id: 'r1' },
        payload: { session: { reconnect_url: 'wss://new' } },
      }),
    });
    expect(sockets[0]!.closed).toBe(false);
    expect(sockets).toHaveLength(2);

    sockets[1]!.onmessage?.({ data: welcome('s2') });
    expect(sockets[0]!.closed).toBe(true);
  });

  it('reports down on revocation', () => {
    const { source, sockets, status } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'revocation', message_id: 'x1' },
        payload: { subscription: { type: 'channel.follow', status: 'authorization_revoked' } },
      }),
    });

    expect(status).toContain('down');
  });

  it('reports ok once subscriptions are placed', async () => {
    const { source, sockets, status } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    await vi.waitFor(() => expect(status).toContain('ok'));
  });

  it('stops reconnecting after close() was called', () => {
    const { source, sockets } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    source.close();
    sockets[0]!.onclose?.({});

    expect(sockets).toHaveLength(1);
  });
});
