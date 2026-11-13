import { beforeEach, describe, expect, it } from 'vitest';
import { fetchSequence, json, memoryStorage, sentBody } from '../test/helpers';
import { readRefreshToken, readToken, writeTokens } from './oauth';
import { createTokenRefresher } from './refresh';

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  writeTokens(storage, { accessToken: 'old', refreshToken: 'r1' });
});

function refresher(fetchFn: ReturnType<typeof fetchSequence>) {
  return createTokenRefresher({ clientId: 'cid', storage, fetchFn: fetchFn as unknown as typeof fetch });
}

describe('createTokenRefresher', () => {
  it('stores the new pair and returns the access token', async () => {
    const fetchFn = fetchSequence(json({ access_token: 'new', refresh_token: 'r2' }));

    expect(await refresher(fetchFn).refresh('old')).toEqual({ status: 'ok', value: 'new' });
    expect(readToken(storage)).toBe('new');
    expect(readRefreshToken(storage)).toBe('r2');

    const body = sentBody(fetchFn);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r1');
    expect(body.has('client_secret')).toBe(false);
  });

  it('clears both tokens when twitch rejects the refresh token', async () => {
    const fetchFn = fetchSequence(json({ status: 400, message: 'Invalid refresh token' }, 400));

    expect(await refresher(fetchFn).refresh('old')).toEqual({ status: 'rejected' });
    expect(readToken(storage)).toBeNull();
    expect(readRefreshToken(storage)).toBeNull();
  });

  it('keeps the tokens when twitch is unreachable', async () => {
    const fetchFn = fetchSequence(new Error('offline'));

    expect(await refresher(fetchFn).refresh('old')).toEqual({ status: 'unreachable' });
    expect(readRefreshToken(storage)).toBe('r1');
  });

  it('sends one request for concurrent calls', async () => {
    const fetchFn = fetchSequence(json({ access_token: 'new', refresh_token: 'r2' }));
    const r = refresher(fetchFn);

    const [a, b] = await Promise.all([r.refresh('old'), r.refresh('old')]);

    expect(a).toEqual({ status: 'ok', value: 'new' });
    expect(b).toEqual(a);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('adopts a token another window already renewed', async () => {
    writeTokens(storage, { accessToken: 'fromOtherWindow', refreshToken: 'r2' });
    const fetchFn = fetchSequence();

    expect(await refresher(fetchFn).refresh('old')).toEqual({ status: 'ok', value: 'fromOtherWindow' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is rejected without a refresh token', async () => {
    storage.clear();
    const fetchFn = fetchSequence();

    expect(await refresher(fetchFn).refresh(null)).toEqual({ status: 'rejected' });
  });

  it('keeps another profile apart from the overlay tokens', async () => {
    const profile = { scopes: [], tokenKey: 'mod.token', refreshKey: 'mod.refresh', lockPrefix: 'mod' };
    writeTokens(storage, { accessToken: 'mod-old', refreshToken: 'mod-r1' }, profile);
    const fetchFn = fetchSequence(json({ access_token: 'mod-new', refresh_token: 'mod-r2' }));
    const modRefresher = createTokenRefresher({ clientId: 'cid', storage, profile, fetchFn: fetchFn as unknown as typeof fetch });

    expect(await modRefresher.refresh('mod-old')).toEqual({ status: 'ok', value: 'mod-new' });
    expect(sentBody(fetchFn).get('refresh_token')).toBe('mod-r1');
    expect(readToken(storage)).toBe('old');
    expect(readToken(storage, profile)).toBe('mod-new');
  });
});
