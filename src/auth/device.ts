import { OVERLAY_PROFILE, SCOPES, parseTokenPair, writeTokens, type AuthProfile, type TokenPair } from './oauth';

const DEFAULT_INTERVAL_S = 5;
const SLOW_DOWN_STEP_S = 5;
const RETRY_MS = 5_000;
const DEVICE_RETRY_MS = 10_000;
// A link the user just copied must not be invalidated right away by the next code.
const MIN_CODE_GAP_MS = 60_000;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { kind: 'ok'; pair: TokenPair }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'retry' };

export async function requestDeviceCode(
  clientId: string,
  fetchFn: typeof fetch = fetch,
  scopes: string[] = SCOPES,
): Promise<DeviceCode | null> {
  try {
    const response = await fetchFn('https://id.twitch.tv/oauth2/device', {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, scopes: scopes.join(' ') }),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
    };
    if (!data.device_code || !data.user_code || !data.verification_uri) return null;

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in ?? 1800,
      interval: data.interval ?? DEFAULT_INTERVAL_S,
    };
  } catch {
    return null;
  }
}

export async function pollDeviceToken(
  clientId: string,
  deviceCode: string,
  fetchFn: typeof fetch = fetch,
  scopes: string[] = SCOPES,
): Promise<PollResult> {
  let response: Response;
  try {
    response = await fetchFn('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        scopes: scopes.join(' '),
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
  } catch {
    return { kind: 'retry' };
  }

  const body = (await response.json().catch(() => null)) as { message?: string } | null;

  if (response.ok) {
    const pair = parseTokenPair(body);
    return pair ? { kind: 'ok', pair } : { kind: 'retry' };
  }
  if (body?.message === 'authorization_pending') return { kind: 'pending' };
  if (response.status === 429 || body?.message === 'slow_down') return { kind: 'slow_down' };
  if (response.status >= 500) return { kind: 'retry' };
  return { kind: 'expired' };
}

export type DeviceLoginStatus = 'waiting' | 'renewed' | 'unreachable';

export interface DeviceLogin {
  stop(): void;
}

/** Requests codes and polls until the user confirms or `stop()` is called. */
export function startDeviceLogin(opts: {
  clientId: string;
  storage: Storage;
  profile?: AuthProfile;
  onCode: (code: DeviceCode) => void;
  onStatus: (status: DeviceLoginStatus) => void;
  onSuccess: () => void;
  fetchFn?: typeof fetch;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => number;
}): DeviceLogin {
  const schedule = opts.setTimeoutFn ?? setTimeout;
  const unschedule = opts.clearTimeoutFn ?? clearTimeout;
  const now = opts.now ?? Date.now;
  const profile = opts.profile ?? OVERLAY_PROFILE;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let code: DeviceCode | null = null;
  let expiresAt = 0;
  let intervalS = DEFAULT_INTERVAL_S;
  let lastCodeAt = -Infinity;
  let renewing = false;

  function later(fn: () => Promise<void>, ms: number): void {
    if (stopped) return;
    timer = schedule(() => void fn(), ms);
  }

  async function requestCode(): Promise<void> {
    const next = await requestDeviceCode(opts.clientId, opts.fetchFn, profile.scopes);
    if (stopped) return;
    if (!next) {
      opts.onStatus('unreachable');
      later(requestCode, DEVICE_RETRY_MS);
      return;
    }

    code = next;
    lastCodeAt = now();
    expiresAt = lastCodeAt + next.expiresIn * 1000;
    intervalS = next.interval || DEFAULT_INTERVAL_S;
    opts.onCode(next);
    opts.onStatus(renewing ? 'renewed' : 'waiting');
    later(poll, intervalS * 1000);
  }

  function renew(): void {
    renewing = true;
    later(requestCode, Math.max(0, lastCodeAt + MIN_CODE_GAP_MS - now()));
  }

  async function poll(): Promise<void> {
    if (!code) return;
    if (now() >= expiresAt) {
      renew();
      return;
    }

    const result = await pollDeviceToken(opts.clientId, code.deviceCode, opts.fetchFn, profile.scopes);
    if (stopped) return;

    switch (result.kind) {
      case 'ok':
        stopped = true;
        writeTokens(opts.storage, result.pair, profile);
        opts.onSuccess();
        return;
      case 'pending':
        later(poll, intervalS * 1000);
        return;
      case 'slow_down':
        intervalS += SLOW_DOWN_STEP_S;
        later(poll, intervalS * 1000);
        return;
      case 'retry':
        later(poll, RETRY_MS);
        return;
      case 'expired':
        renew();
    }
  }

  void requestCode();

  return {
    stop() {
      stopped = true;
      if (timer !== null) unschedule(timer);
    },
  };
}
