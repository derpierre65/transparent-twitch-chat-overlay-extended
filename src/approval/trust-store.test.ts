import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrustStore } from './trust-store';

const ENDPOINT = { url: 'https://trust.example', secret: 's3cret' };
const LIST_URL = 'https://trust.example/trusted/derpierre65';
const STORED_AT = '2026-01-01T00:00:00.000Z';
const NOW = '2026-11-12T00:00:00.000Z';

let fetchFn: ReturnType<typeof vi.fn>;
let logs: string[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function store(over: Partial<Parameters<typeof createTrustStore>[0]> = {}) {
  return createTrustStore({
    endpoint: ENDPOINT,
    channel: 'derpierre65',
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => Date.UTC(2026, 10, 12),
    log: (m) => logs.push(m),
    ...over,
  });
}

function saves(): [url: unknown, init: RequestInit][] {
  return fetchFn.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== undefined) as [
    unknown,
    RequestInit,
  ][];
}

function patches(): unknown[] {
  return saves()
    .filter(([, init]) => init.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init.body)));
}

beforeEach(() => {
  vi.useFakeTimers();
  logs = [];
  fetchFn = vi.fn(async () => json({ users: {} }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTrustStore', () => {
  it('loads the stored list with the secret', async () => {
    fetchFn.mockResolvedValueOnce(json({ users: { '1': { login: 'a', trustedAt: STORED_AT } } }));
    const s = store();

    expect(await s.load()).toBe(true);
    expect(s.has('1')).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(LIST_URL);
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer s3cret' });
  });

  it('skips invalid entries of the stored list', async () => {
    fetchFn.mockResolvedValueOnce(
      json({
        users: {
          '1': { login: 'a', trustedAt: STORED_AT },
          abc: { login: 'b', trustedAt: STORED_AT },
          '2': 'nope',
        },
      }),
    );
    const s = store();
    await s.load();

    expect(s.has('1')).toBe(true);
    expect(s.has('abc')).toBe(false);
    expect(s.has('2')).toBe(false);
  });

  it('skips stored entries the worker would reject in a save', async () => {
    fetchFn.mockResolvedValueOnce(
      json({
        users: {
          '1': { login: 'Not A Login', trustedAt: STORED_AT },
          '2': { login: 'b', trustedAt: 'yesterday' },
          '3': { login: 'c', trustedAt: '2026-13-45T00:00:00.000Z' },
          '4': { login: 'd', trustedAt: STORED_AT, trustedBy: 'x'.repeat(101) },
        },
      }),
    );
    const s = store();
    await s.load();

    expect(s.entries()).toEqual([['4', { login: 'd', trustedAt: STORED_AT }]]);
  });

  it('saves changes at most once per interval and only when changed', async () => {
    const s = store();
    await s.load();
    s.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(saves()).toEqual([]);

    s.add('1', 'a');
    s.add('2', 'b');
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(saves()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(patches()).toEqual([
      { set: { '1': { login: 'a', trustedAt: NOW }, '2': { login: 'b', trustedAt: NOW } }, remove: [] },
    ]);
    const [url, init] = saves()[0]!;
    expect(url).toBe(LIST_URL);
    expect(init.headers).toEqual({ Authorization: 'Bearer s3cret', 'Content-Type': 'application/json' });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(saves()).toHaveLength(1);
  });

  it('saves only what changed, so a user removed elsewhere is not written back', async () => {
    fetchFn.mockResolvedValueOnce(
      json({ users: { '1': { login: 'a', trustedAt: STORED_AT }, '2': { login: 'b', trustedAt: STORED_AT } } }),
    );
    const s = store();
    await s.load();
    s.add('3', 'c');
    await s.flush();

    expect(saves().map(([, init]) => [init.method, JSON.parse(String(init.body))])).toEqual([
      ['PATCH', { set: { '3': { login: 'c', trustedAt: NOW } }, remove: [] }],
    ]);
  });

  it('saves a removal', async () => {
    fetchFn.mockResolvedValueOnce(json({ users: { '1': { login: 'a', trustedAt: STORED_AT } } }));
    const s = store();
    await s.load();
    s.remove('1');
    await s.flush();

    expect(s.has('1')).toBe(false);
    expect(patches()).toEqual([{ set: {}, remove: ['1'] }]);
  });

  it('retries a failed save in the next interval', async () => {
    const s = store();
    await s.load();
    s.start();
    s.add('1', 'a');
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 500 }));

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(logs.some((m) => m.includes('HTTP 500'))).toBe(true);

    fetchFn.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(logs.some((m) => m.includes('offline'))).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(patches()).toEqual(Array(3).fill({ set: { '1': { login: 'a', trustedAt: NOW } }, remove: [] }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(saves()).toHaveLength(3);
  });

  it('keeps a change made during a running save for the next one', async () => {
    const s = store();
    await s.load();
    let finish: (r: Response) => void = () => {};
    fetchFn.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));

    s.add('1', 'a');
    const saving = s.flush();
    s.add('2', 'b');
    finish(new Response(null, { status: 204 }));
    await saving;
    await s.flush();

    expect(patches()).toEqual([
      { set: { '1': { login: 'a', trustedAt: NOW } }, remove: [] },
      { set: { '2': { login: 'b', trustedAt: NOW } }, remove: [] },
    ]);
  });

  it('saves a user again who changed during a running save', async () => {
    const s = store();
    await s.load();
    let finish: (r: Response) => void = () => {};
    fetchFn.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));

    s.add('1', 'a');
    const saving = s.flush();
    s.remove('1');
    finish(new Response(null, { status: 204 }));
    await saving;
    await s.flush();

    expect(patches()).toEqual([
      { set: { '1': { login: 'a', trustedAt: NOW } }, remove: [] },
      { set: {}, remove: ['1'] },
    ]);
  });

  it('never saves before the stored list has loaded', async () => {
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const s = store();
    expect(await s.load()).toBe(false);

    s.add('9', 'new');
    await s.flush();
    expect(saves()).toEqual([]);
  });

  it('retries a failed load in the next interval and merges changes made meanwhile', async () => {
    const onLoaded = vi.fn();
    fetchFn.mockRejectedValueOnce(new Error('offline'));
    const s = store({ onLoaded });
    await s.load();
    s.start();

    s.add('9', 'new');
    s.remove('1');
    expect(s.has('9')).toBe(true);

    fetchFn.mockResolvedValueOnce(
      json({ users: { '1': { login: 'a', trustedAt: STORED_AT }, '2': { login: 'b', trustedAt: STORED_AT } } }),
    );
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(s.has('1')).toBe(false);
    expect(s.has('2')).toBe(true);
    expect(s.has('9')).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(patches()).toEqual([{ set: { '9': { login: 'new', trustedAt: NOW } }, remove: ['1'] }]);
  });

  it('does not save a loaded list without changes', async () => {
    fetchFn.mockResolvedValueOnce(json({ users: { '1': { login: 'a', trustedAt: STORED_AT } } }));
    const s = store();
    await s.load();
    s.add('1', 'a');
    await s.flush();

    expect(saves()).toEqual([]);
  });

  it('can save with keepalive when the page goes away', async () => {
    const s = store();
    await s.load();
    s.add('1', 'a');
    await s.flush({ keepalive: true });

    expect(saves().map(([, init]) => init.keepalive)).toEqual([true]);
  });

  it('keeps who trusted a user, also through a save', async () => {
    fetchFn.mockResolvedValueOnce(json({ users: { '1': { login: 'a', trustedAt: STORED_AT, trustedBy: 'Old' } } }));
    const trust = store();
    await trust.load();
    trust.add('2', 'b', 'Mod');
    trust.add('3', 'c', null);
    expect(trust.entries()).toEqual([
      ['1', { login: 'a', trustedAt: STORED_AT, trustedBy: 'Old' }],
      ['2', { login: 'b', trustedAt: NOW, trustedBy: 'Mod' }],
      ['3', { login: 'c', trustedAt: NOW }],
    ]);
  });

  it('lists the trusted logins sorted', async () => {
    fetchFn.mockResolvedValueOnce(
      json({ users: { '1': { login: 'zed', trustedAt: STORED_AT }, '2': { login: 'amy', trustedAt: STORED_AT } } }),
    );
    const trust = store();
    await trust.load();
    trust.add('3', 'bob');
    expect(trust.logins()).toEqual(['amy', 'bob', 'zed']);
  });

  it('keeps the list in memory without an endpoint', async () => {
    const s = store({ endpoint: null });
    expect(await s.load()).toBe(true);
    s.start();
    s.add('1', 'a');
    await s.flush();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(s.has('1')).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
