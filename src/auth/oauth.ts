export const SCOPES = [
  'channel:read:redemptions',
  'moderator:read:followers',
  'channel:read:hype_train',
  // Required for channel.ban/unban; Twitch offers no read-only scope for them.
  'channel:moderate',
  'moderator:read:chat_settings',
];

export const TOKEN_KEY = 'overlay.token';
const REFRESH_KEY = 'overlay.refresh';
const IDENTITY_KEY = 'overlay.identity';
// Leftovers of the old implicit grant and setup flow.
const LEGACY_KEYS = ['overlay.state', 'overlay.setup'];

export interface Identity {
  login: string;
  userId: string;
}

export interface Validation extends Identity {
  scopes: string[];
  expiresIn: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Only `rejected` may delete tokens. `unreachable` (network, 5xx, 429) must not,
 * otherwise a short Wi-Fi drop costs the refresh token.
 */
export type Check<T> = { status: 'ok'; value: T } | { status: 'rejected' } | { status: 'unreachable' };

export function readToken(storage: Storage): string | null {
  return storage.getItem(TOKEN_KEY);
}

export function readRefreshToken(storage: Storage): string | null {
  return storage.getItem(REFRESH_KEY);
}

export function writeTokens(storage: Storage, pair: TokenPair): void {
  storage.setItem(TOKEN_KEY, pair.accessToken);
  storage.setItem(REFRESH_KEY, pair.refreshToken);
}

export function clearTokens(storage: Storage): void {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(REFRESH_KEY);
}

export function clearLegacyKeys(storage: Storage): void {
  for (const key of LEGACY_KEYS) storage.removeItem(key);
}

export function writeIdentity(storage: Storage, identity: Identity): void {
  storage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function readIdentity(storage: Storage): Identity | null {
  const raw = storage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (typeof parsed.login !== 'string' || typeof parsed.userId !== 'string') return null;
    return { login: parsed.login, userId: parsed.userId };
  } catch {
    return null;
  }
}

export function classifyFailure(status: number): 'rejected' | 'unreachable' {
  return status === 400 || status === 401 ? 'rejected' : 'unreachable';
}

export async function validateToken(token: string, fetchFn: typeof fetch = fetch): Promise<Check<Validation>> {
  let response: Response;
  try {
    response = await fetchFn('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` },
    });
  } catch {
    return { status: 'unreachable' };
  }
  if (!response.ok) return { status: classifyFailure(response.status) };

  try {
    const data = (await response.json()) as {
      login?: string;
      user_id?: string;
      scopes?: string[];
      expires_in?: number;
    };

    return {
      status: 'ok',
      value: {
        login: data.login ?? '',
        userId: data.user_id ?? '',
        scopes: data.scopes ?? [],
        expiresIn: data.expires_in ?? 0,
      },
    };
  } catch {
    return { status: 'unreachable' };
  }
}

/** Reads `access_token`/`refresh_token` from an `/oauth2/token` response. */
export function parseTokenPair(data: unknown): TokenPair | null {
  const body = data as { access_token?: unknown; refresh_token?: unknown } | null;
  if (typeof body?.access_token !== 'string' || typeof body.refresh_token !== 'string') return null;
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}
