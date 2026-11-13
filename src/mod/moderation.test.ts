import { describe, expect, it, vi } from 'vitest';
import { fetchSequence, json } from '../test/helpers';
import { createModerator } from './moderation';

function moderator(fetchFn: ReturnType<typeof fetchSequence>, refresh = vi.fn(async (_stale: string): Promise<string | null> => 'fresh')) {
  let token = 'tok';
  const mod = createModerator({
    clientId: 'cid',
    moderatorId: '99',
    getToken: () => token,
    refresh: async (stale) => {
      const next = await refresh(stale);
      if (next) token = next;
      return next;
    },
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { mod, refresh };
}

function call(fetchFn: ReturnType<typeof fetchSequence>, i = 0) {
  const [url, init] = fetchFn.mock.calls[i]!;
  return { url: new URL(url), init: init! };
}

describe('createModerator', () => {
  it('deletes a message as the logged-in mod', async () => {
    const fetchFn = fetchSequence(new Response(null, { status: 204 }));
    await moderator(fetchFn).mod.deleteMessage('1', 'msg-1');

    const { url, init } = call(fetchFn);
    expect(init.method).toBe('DELETE');
    expect(url.pathname).toBe('/helix/moderation/chat');
    expect(Object.fromEntries(url.searchParams)).toEqual({ broadcaster_id: '1', message_id: 'msg-1', moderator_id: '99' });
    expect(init.headers).toMatchObject({ 'Client-Id': 'cid', Authorization: 'Bearer tok' });
  });

  it('sends a duration for timeouts and none for bans', async () => {
    const fetchFn = fetchSequence(json({ data: [] }), json({ data: [] }));
    const { mod } = moderator(fetchFn);
    await mod.timeout('1', '5');
    await mod.ban('1', '5');

    expect(JSON.parse(call(fetchFn, 0).init.body as string)).toEqual({ data: { user_id: '5', duration: 600 } });
    expect(JSON.parse(call(fetchFn, 1).init.body as string)).toEqual({ data: { user_id: '5' } });
    expect(call(fetchFn, 1).url.pathname).toBe('/helix/moderation/bans');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchFn = fetchSequence(json({ message: 'Invalid OAuth token' }, 401), new Response(null, { status: 204 }));
    const { mod, refresh } = moderator(fetchFn);
    await mod.deleteMessage('1', 'm');

    expect(refresh).toHaveBeenCalledWith('tok');
    expect(call(fetchFn, 1).init.headers).toMatchObject({ Authorization: 'Bearer fresh' });
  });

  it('reports an expired login when the refresh fails', async () => {
    const fetchFn = fetchSequence(json({}, 401));
    const { mod } = moderator(fetchFn, vi.fn(async () => null));
    await expect(mod.ban('1', '5')).rejects.toThrow('Twitch login expired. Log in again.');
  });

  it('passes on the error message from Twitch', async () => {
    const fetchFn = fetchSequence(json({ message: 'The user is not a moderator' }, 403));
    await expect(moderator(fetchFn).mod.timeout('1', '5')).rejects.toThrow('Twitch: The user is not a moderator');
  });

  it('reports network errors', async () => {
    const fetchFn = fetchSequence(new Error('offline'));
    await expect(moderator(fetchFn).mod.ban('1', '5')).rejects.toThrow('Twitch not reachable.');
  });
});
