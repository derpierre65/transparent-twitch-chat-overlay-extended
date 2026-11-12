import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSequence, json, memoryStorage } from '../test/helpers';
import { readToken, writeTokens } from './oauth';
import { authenticate } from './session';
import type { TokenRefresher } from './refresh';

const VALID = { login: 'derpierre65', user_id: '1', scopes: [], expires_in: 9000 };

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
});

function run(fetchFn: ReturnType<typeof fetchSequence>, refresher: TokenRefresher) {
  return authenticate({ storage, refresher, fetchFn: fetchFn as unknown as typeof fetch });
}

describe('authenticate', () => {
  it('accepts a valid stored token without refreshing', async () => {
    writeTokens(storage, { accessToken: 'tok', refreshToken: 'r' });
    const refresh = vi.fn();

    const result = await run(fetchSequence(json(VALID)), { refresh });

    expect(result).toMatchObject({ status: 'ok', value: { token: 'tok', validation: { login: 'derpierre65' } } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes a rejected token and validates the new one', async () => {
    writeTokens(storage, { accessToken: 'tok', refreshToken: 'r' });
    const refresh = vi.fn(async () => ({ status: 'ok', value: 'fresh' }) as const);

    const result = await run(fetchSequence(new Response('', { status: 401 }), json(VALID)), { refresh });

    expect(refresh).toHaveBeenCalledWith('tok');
    expect(result).toMatchObject({ status: 'ok', value: { token: 'fresh' } });
  });

  it('refreshes when only a refresh token is stored', async () => {
    storage.setItem('overlay.refresh', 'r');
    const refresh = vi.fn(async () => ({ status: 'ok', value: 'fresh' }) as const);

    const result = await run(fetchSequence(json(VALID)), { refresh });

    expect(refresh).toHaveBeenCalledWith(null);
    expect(result.status).toBe('ok');
  });

  it('drops a token without refresh token even while it is still valid', async () => {
    storage.setItem('overlay.token', 'implicitGrantToken');
    const fetchFn = fetchSequence();
    const refresh = vi.fn();

    expect(await run(fetchFn, { refresh })).toEqual({ status: 'rejected' });
    expect(readToken(storage)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps everything when twitch is unreachable', async () => {
    writeTokens(storage, { accessToken: 'tok', refreshToken: 'r' });
    const refresh = vi.fn();

    expect(await run(fetchSequence(new Error('offline')), { refresh })).toEqual({ status: 'unreachable' });
    expect(readToken(storage)).toBe('tok');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('is rejected with an empty storage', async () => {
    expect(await run(fetchSequence(), { refresh: vi.fn() })).toEqual({ status: 'rejected' });
  });
});
