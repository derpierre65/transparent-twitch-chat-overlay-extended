/**
 * Reads Twitch's non-mod chat delay in seconds (0 = off). `null` if the setting cannot be
 * read; the last known value then stays in effect.
 *
 * EventSub does not help here: `channel.chat_settings.update` has no delay field.
 */
export async function fetchChatDelay(opts: {
  clientId: string;
  token: string;
  broadcasterId: string;
  fetchFn?: typeof fetch;
}): Promise<number | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const params = new URLSearchParams({ broadcaster_id: opts.broadcasterId, moderator_id: opts.broadcasterId });

  try {
    const response = await fetchFn(`https://api.twitch.tv/helix/chat/settings?${params.toString()}`, {
      headers: { 'Client-Id': opts.clientId, Authorization: `Bearer ${opts.token}` },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      data?: { non_moderator_chat_delay?: boolean; non_moderator_chat_delay_duration?: number | null }[];
    };
    const settings = body.data?.[0];
    // Missing field means the token lacks `moderator:read:chat_settings`.
    if (typeof settings?.non_moderator_chat_delay !== 'boolean') return null;

    return settings.non_moderator_chat_delay ? (settings.non_moderator_chat_delay_duration ?? 0) : 0;
  } catch {
    return null;
  }
}
