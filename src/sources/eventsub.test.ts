import { describe, expect, it, vi } from 'vitest';
import { TOPICS, createEventSubSource, type RetryInfo, type SocketLike } from './eventsub';
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
  const intervals: { fn: () => void; ms: number }[] = [];
  const events: OverlayEvent[] = [];
  const status: StatusState[] = [];
  // What the GET endpoint reports as enabled.
  const active: { type: string; session: string }[] = [];
  const posts: { type: string; session: string }[] = [];
  const retries: RetryInfo[] = [];
  let postStatus = fetchOk ? 202 : 403;

  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { type: string; transport: { session_id: string } };
      posts.push({ type: body.type, session: body.transport.session_id });
      return new Response('{}', { status: postStatus });
    }
    return new Response(
      JSON.stringify({
        data: active.map((a) => ({ type: a.type, transport: { session_id: a.session } })),
        pagination: {},
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

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
    setIntervalFn: ((fn: () => void, ms: number) => {
      intervals.push({ fn, ms });
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval,
    clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
    fetchFn,
    log: () => {},
    onRetry: (info) => retries.push(info),
  });

  const setPostStatus = (code: number): void => {
    postStatus = code;
  };

  return { source, sockets, timers, intervals, events, status, fetchFn, active, posts, setPostStatus, retries };
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

  it('emits an ad break end once the announced duration has passed', () => {
    const { source, sockets, events, timers } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });
    const startedAt = new Date().toISOString();

    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'notification', message_id: 'ad1', subscription_type: 'channel.ad_break.begin' },
        payload: { event: { duration_seconds: 60, started_at: startedAt } },
      }),
    });

    expect(events).toEqual([expect.objectContaining({ type: 'adbreak', phase: 'begin' })]);
    const end = timers.at(-1)!;
    expect(end.ms).toBeGreaterThan(55_000);
    expect(end.ms).toBeLessThanOrEqual(60_000);

    end.fn();
    expect(events[1]).toMatchObject({ type: 'adbreak', phase: 'end', id: 'ad1-end' });
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

  it('reports down when a subscription request is rejected', async () => {
    const { source, sockets, status } = setup(undefined, false);
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome() });

    await vi.waitFor(() => expect(status).toContain('down'));
    expect(status).not.toContain('ok');
  });

  it('re-arms the keepalive on notifications', () => {
    const { source, sockets, timers } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1', 30) });
    const before = timers.length;

    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'notification', message_id: 'n1', subscription_type: 'channel.follow' },
        payload: { event: { user_name: 'Newbie' } },
      }),
    });

    expect(timers[before]?.ms).toBe(33000);
  });

  it('checks subscriptions every two minutes', () => {
    const { source, intervals } = setup();
    source.connect();
    expect(intervals).toEqual([expect.objectContaining({ ms: 120_000 })]);
  });

  it('resubscribes only the topics missing from the session', async () => {
    const { source, sockets, intervals, active, posts } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });
    await vi.waitFor(() => expect(posts).toHaveLength(TOPICS.length));
    posts.length = 0;

    for (const topic of TOPICS.slice(1)) active.push({ type: topic.type, session: 's1' });
    // Same type on an old session must not count.
    active.push({ type: TOPICS[0]!.type, session: 'old' });
    intervals[0]!.fn();

    await vi.waitFor(() => expect(posts).toEqual([{ type: TOPICS[0]!.type, session: 's1' }]));
  });

  it('does nothing when every topic is still active', async () => {
    const { source, sockets, intervals, active, posts, fetchFn } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });
    await vi.waitFor(() => expect(posts).toHaveLength(TOPICS.length));
    posts.length = 0;

    for (const topic of TOPICS) active.push({ type: topic.type, session: 's1' });
    intervals[0]!.fn();

    const calls = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls;
    await vi.waitFor(() => expect(calls.length).toBe(TOPICS.length + 1));
    expect(posts).toHaveLength(0);
  });

  it('checks against the new session after a reconnect', async () => {
    const { source, sockets, intervals, active, posts } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });
    await vi.waitFor(() => expect(posts).toHaveLength(TOPICS.length));
    posts.length = 0;

    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'session_reconnect', message_id: 'r1' },
        payload: { session: { reconnect_url: 'wss://new' } },
      }),
    });
    sockets[1]!.onmessage?.({ data: welcome('s2') });

    for (const topic of TOPICS) active.push({ type: topic.type, session: 's2' });
    intervals[0]!.fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toHaveLength(0);
  });

  it('reconnects when the session rejects every resubscribe', async () => {
    const { source, sockets, intervals, posts, setPostStatus } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });
    await vi.waitFor(() => expect(posts).toHaveLength(TOPICS.length));

    setPostStatus(400);
    intervals[0]!.fn();

    await vi.waitFor(() => expect(sockets).toHaveLength(2));
  });

  it('checks right away on revocation', async () => {
    const { source, sockets, active, posts } = setup();
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });
    await vi.waitFor(() => expect(posts).toHaveLength(TOPICS.length));
    posts.length = 0;

    for (const topic of TOPICS) if (topic.type !== 'channel.follow') active.push({ type: topic.type, session: 's1' });
    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        metadata: { message_type: 'revocation', message_id: 'x2' },
        payload: { subscription: { type: 'channel.follow', status: 'authorization_revoked' } },
      }),
    });

    await vi.waitFor(() => expect(posts).toEqual([{ type: 'channel.follow', session: 's1' }]));
  });

  it('retries failed topics with backoff and reports recovery', async () => {
    const { source, sockets, timers, posts, retries, setPostStatus } = setup(['channel:read:redemptions']);
    setPostStatus(429);
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });

    await vi.waitFor(() => expect(retries).toHaveLength(1));
    expect(retries[0]).toEqual({ types: [TOPICS[0]!.type], statuses: [429], delayMs: 5000 });
    const first = timers.at(-1)!;
    expect(first.ms).toBe(5000);

    first.fn();
    await vi.waitFor(() => expect(retries).toHaveLength(2));
    expect(retries[1]?.delayMs).toBe(15000);

    setPostStatus(202);
    timers.at(-1)!.fn();
    await vi.waitFor(() => expect(retries).toHaveLength(3));
    expect(retries[2]).toBeNull();
    expect(posts).toHaveLength(3);
  });

  it('does not retry after close()', async () => {
    const { source, sockets, timers, posts, retries, setPostStatus } = setup(['channel:read:redemptions']);
    setPostStatus(500);
    source.connect();
    sockets[0]!.onmessage?.({ data: welcome('s1') });
    await vi.waitFor(() => expect(retries).toHaveLength(1));

    source.close();
    timers.at(-1)!.fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toHaveLength(1);
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
