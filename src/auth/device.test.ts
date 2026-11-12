import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSequence, json, memoryStorage, sentBody } from '../test/helpers';
import { readRefreshToken, readToken } from './oauth';
import { startDeviceLogin, type DeviceCode } from './device';

function code(n: number, extra: Record<string, unknown> = {}) {
  return json({
    device_code: `dev${n}`,
    user_code: `USER${n}`,
    verification_uri: `https://www.twitch.tv/activate?public=true&device-code=USER${n}`,
    expires_in: 1800,
    interval: 5,
    ...extra,
  });
}

const PENDING = () => json({ status: 400, message: 'authorization_pending' }, 400);
const TOKENS = () => json({ access_token: 'acc', refresh_token: 'ref', scope: [], token_type: 'bearer' });

let storage: Storage;
let codes: DeviceCode[];
let statuses: string[];
let onSuccess: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  storage = memoryStorage();
  codes = [];
  statuses = [];
  onSuccess = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function start(fetchFn: ReturnType<typeof fetchSequence>) {
  return startDeviceLogin({
    clientId: 'cid',
    storage,
    fetchFn: fetchFn as unknown as typeof fetch,
    onCode: (c) => codes.push(c),
    onStatus: (s) => statuses.push(s),
    onSuccess,
  });
}

describe('startDeviceLogin', () => {
  it('shows the code, polls until confirmed and stores both tokens', async () => {
    const fetchFn = fetchSequence(code(1), PENDING(), TOKENS());
    start(fetchFn);

    await vi.advanceTimersByTimeAsync(0);
    expect(codes[0]?.verificationUri).toBe('https://www.twitch.tv/activate?public=true&device-code=USER1');
    expect(statuses).toEqual(['waiting']);
    expect(sentBody(fetchFn, 0).get('scopes')).toContain('channel:read:redemptions');

    await vi.advanceTimersByTimeAsync(5000);
    expect(onSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(readToken(storage)).toBe('acc');
    expect(readRefreshToken(storage)).toBe('ref');

    const poll = sentBody(fetchFn, 2);
    expect(poll.get('device_code')).toBe('dev1');
    expect(poll.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
  });

  it('requests a new code after a rejection, but at most one per minute', async () => {
    const fetchFn = fetchSequence(code(1), json({ status: 400, message: 'invalid device code' }, 400), code(2));
    start(fetchFn);

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(54_999);
    expect(codes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(codes.map((c) => c.userCode)).toEqual(['USER1', 'USER2']);
    expect(statuses).toEqual(['waiting', 'renewed']);
  });

  it('requests a new code once the old one expired without polling it again', async () => {
    const fetchFn = fetchSequence(code(1, { expires_in: 8 }), PENDING(), code(2));
    start(fetchFn);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(codes.map((c) => c.userCode)).toEqual(['USER1', 'USER2']);
  });

  it('backs off on slow_down without a new code', async () => {
    const fetchFn = fetchSequence(code(1), json({ message: 'slow_down' }, 429), TOKENS());
    start(fetchFn);

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(codes).toHaveLength(1);
  });

  it('retries a failed poll with the same code', async () => {
    const fetchFn = fetchSequence(code(1), new Error('offline'), TOKENS());
    start(fetchFn);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(sentBody(fetchFn, 2).get('device_code')).toBe('dev1');
  });

  it('reports an unreachable device endpoint and retries', async () => {
    const fetchFn = fetchSequence(new Error('offline'), code(1));
    start(fetchFn);

    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(['unreachable']);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(codes).toHaveLength(1);
    expect(statuses).toEqual(['unreachable', 'waiting']);
  });

  it('stops polling after stop()', async () => {
    const fetchFn = fetchSequence(code(1));
    const login = start(fetchFn);

    await vi.advanceTimersByTimeAsync(0);
    login.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
