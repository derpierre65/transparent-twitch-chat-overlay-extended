import { withLock } from './locks';
import {
  classifyFailure,
  clearTokens,
  parseTokenPair,
  readRefreshToken,
  readToken,
  writeTokens,
  type Check,
  type TokenPair,
} from './oauth';

export async function requestRefresh(
  clientId: string,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<Check<TokenPair>> {
  let response: Response;
  try {
    response = await fetchFn('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
  } catch {
    return { status: 'unreachable' };
  }
  if (!response.ok) return { status: classifyFailure(response.status) };

  try {
    const pair = parseTokenPair(await response.json());
    return pair ? { status: 'ok', value: pair } : { status: 'unreachable' };
  } catch {
    return { status: 'unreachable' };
  }
}

export interface TokenRefresher {
  /** `stale` is the access token the caller currently holds. */
  refresh(stale: string | null): Promise<Check<string>>;
}

export function createTokenRefresher(opts: {
  clientId: string;
  storage: Storage;
  fetchFn?: typeof fetch;
  locks?: LockManager;
}): TokenRefresher {
  let inflight: Promise<Check<string>> | null = null;

  async function run(stale: string | null): Promise<Check<string>> {
    // Another window already refreshed: adopt its token instead of redeeming the
    // now consumed refresh token again.
    const stored = readToken(opts.storage);
    if (stored && stored !== stale) return { status: 'ok', value: stored };

    const refreshToken = readRefreshToken(opts.storage);
    if (!refreshToken) return { status: 'rejected' };

    const result = await requestRefresh(opts.clientId, refreshToken, opts.fetchFn);
    if (result.status === 'ok') {
      writeTokens(opts.storage, result.value);
      return { status: 'ok', value: result.value.accessToken };
    }
    if (result.status === 'rejected') clearTokens(opts.storage);
    return result;
  }

  return {
    refresh(stale) {
      inflight ??= withLock('overlay.refresh', () => run(stale), undefined, opts.locks).finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
