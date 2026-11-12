import { clearTokens, readRefreshToken, readToken, validateToken, type Check, type Validation } from './oauth';
import type { TokenRefresher } from './refresh';

export interface Session {
  token: string;
  validation: Validation;
}

/** Boot: validate the stored token, refresh it once if Twitch rejects it. */
export async function authenticate(opts: {
  storage: Storage;
  refresher: TokenRefresher;
  fetchFn?: typeof fetch;
}): Promise<Check<Session>> {
  // Implicit grant token without refresh token: log in once now instead of when it
  // expires mid-stream.
  if (!readRefreshToken(opts.storage)) {
    clearTokens(opts.storage);
    return { status: 'rejected' };
  }

  const token = readToken(opts.storage);
  if (token) {
    const checked = await validateToken(token, opts.fetchFn);
    if (checked.status === 'ok') return { status: 'ok', value: { token, validation: checked.value } };
    if (checked.status === 'unreachable') return checked;
  }

  const refreshed = await opts.refresher.refresh(token);
  if (refreshed.status !== 'ok') return refreshed;

  const checked = await validateToken(refreshed.value, opts.fetchFn);
  if (checked.status !== 'ok') return checked;
  return { status: 'ok', value: { token: refreshed.value, validation: checked.value } };
}
