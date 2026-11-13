import type { AuthProfile } from '../auth/oauth';

export const MOD_PROFILE: AuthProfile = {
  scopes: ['moderator:manage:chat_messages', 'moderator:manage:banned_users'],
  tokenKey: 'mod.token',
  refreshKey: 'mod.refresh',
  lockPrefix: 'mod',
};

export const TIMEOUT_SECONDS = 600;

export interface Moderator {
  deleteMessage(broadcasterId: string, messageId: string): Promise<void>;
  timeout(broadcasterId: string, userId: string, seconds?: number): Promise<void>;
  ban(broadcasterId: string, userId: string): Promise<void>;
}

const HELIX = 'https://api.twitch.tv/helix';

/** Helix moderation calls as the logged-in mod. Throws with Twitch's message on failure. */
export function createModerator(opts: {
  clientId: string;
  moderatorId: string;
  getToken: () => string;
  /** Returns a new token, or `null` if the login is gone. */
  refresh: (stale: string) => Promise<string | null>;
  fetchFn?: typeof fetch;
}): Moderator {
  const fetchFn = opts.fetchFn ?? fetch;

  async function call(method: string, path: string, params: Record<string, string>, body?: object): Promise<void> {
    const url = `${HELIX}${path}?${new URLSearchParams({ ...params, moderator_id: opts.moderatorId })}`;
    const send = (token: string): Promise<Response> =>
      fetchFn(url, {
        method,
        headers: {
          'Client-Id': opts.clientId,
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

    let token = opts.getToken();
    let response: Response;
    try {
      response = await send(token);
      if (response.status === 401) {
        const fresh = await opts.refresh(token);
        if (!fresh) throw new Error('Twitch login expired. Log in again.');
        token = fresh;
        response = await send(token);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Twitch login')) throw error;
      throw new Error('Twitch not reachable.');
    }
    if (response.ok) return;

    const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof data?.message === 'string' && data.message ? data.message : `HTTP ${response.status}`;
    throw new Error(`Twitch: ${message}`);
  }

  return {
    deleteMessage: (broadcasterId, messageId) =>
      call('DELETE', '/moderation/chat', { broadcaster_id: broadcasterId, message_id: messageId }),
    timeout: (broadcasterId, userId, seconds = TIMEOUT_SECONDS) =>
      call('POST', '/moderation/bans', { broadcaster_id: broadcasterId }, { data: { user_id: userId, duration: seconds } }),
    ban: (broadcasterId, userId) =>
      call('POST', '/moderation/bans', { broadcaster_id: broadcasterId }, { data: { user_id: userId } }),
  };
}
