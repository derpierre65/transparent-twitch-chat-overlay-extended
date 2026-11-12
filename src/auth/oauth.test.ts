import { beforeEach, describe, expect, it } from 'vitest';
import { fetchSequence, json, memoryStorage } from '../test/helpers';
import {
  clearLegacyKeys,
  clearTokens,
  parseTokenPair,
  readIdentity,
  readRefreshToken,
  readToken,
  validateToken,
  writeIdentity,
  writeTokens,
} from './oauth';

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
});

describe('token and identity storage', () => {
  it('round trips the identity', () => {
    writeIdentity(storage, { login: 'derpierre65', userId: '123' });

    expect(readIdentity(storage)).toEqual({ login: 'derpierre65', userId: '123' });
  });

  it('returns null for corrupt identity json', () => {
    storage.setItem('overlay.identity', '{not json');

    expect(readIdentity(storage)).toBeNull();
  });

  it('stores and clears both tokens without touching the identity', () => {
    writeTokens(storage, { accessToken: 'a', refreshToken: 'r' });
    writeIdentity(storage, { login: 'a', userId: '1' });
    expect(readToken(storage)).toBe('a');
    expect(readRefreshToken(storage)).toBe('r');

    clearTokens(storage);

    expect(readToken(storage)).toBeNull();
    expect(readRefreshToken(storage)).toBeNull();
    expect(readIdentity(storage)).not.toBeNull();
  });

  it('removes keys of the old setup flow', () => {
    storage.setItem('overlay.state', 's');
    storage.setItem('overlay.setup', '1');

    clearLegacyKeys(storage);

    expect(storage.length).toBe(0);
  });
});

describe('parseTokenPair', () => {
  it('reads both tokens', () => {
    expect(parseTokenPair({ access_token: 'a', refresh_token: 'r' })).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('rejects a body without refresh token', () => {
    expect(parseTokenPair({ access_token: 'a' })).toBeNull();
    expect(parseTokenPair(null)).toBeNull();
  });
});

describe('validateToken', () => {
  it('maps a successful validation', async () => {
    const fetchFn = fetchSequence(json({ login: 'derpierre65', user_id: '123', scopes: ['a'], expires_in: 5000 }));

    expect(await validateToken('tok', fetchFn as unknown as typeof fetch)).toEqual({
      status: 'ok',
      value: { login: 'derpierre65', userId: '123', scopes: ['a'], expiresIn: 5000 },
    });
  });

  it('sends the OAuth authorization header', async () => {
    const fetchFn = fetchSequence(json({}));
    await validateToken('tok', fetchFn as unknown as typeof fetch);

    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('OAuth tok');
  });

  it('treats 401 as rejected', async () => {
    const fetchFn = fetchSequence(new Response('', { status: 401 }));

    expect(await validateToken('tok', fetchFn as unknown as typeof fetch)).toEqual({ status: 'rejected' });
  });

  it('treats network failures and 5xx as unreachable', async () => {
    const fetchFn = fetchSequence(new Error('offline'), new Response('', { status: 503 }));

    expect(await validateToken('tok', fetchFn as unknown as typeof fetch)).toEqual({ status: 'unreachable' });
    expect(await validateToken('tok', fetchFn as unknown as typeof fetch)).toEqual({ status: 'unreachable' });
  });
});
