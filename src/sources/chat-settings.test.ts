import { describe, expect, it } from 'vitest';
import { fetchSequence, json } from '../test/helpers';
import { fetchChatDelay } from './chat-settings';

function run(fetchFn: ReturnType<typeof fetchSequence>) {
  return fetchChatDelay({ clientId: 'cid', token: 'tok', broadcasterId: '42', fetchFn: fetchFn as unknown as typeof fetch });
}

describe('fetchChatDelay', () => {
  it('returns the delay in seconds and asks as the broadcaster', async () => {
    const fetchFn = fetchSequence(json({ data: [{ non_moderator_chat_delay: true, non_moderator_chat_delay_duration: 6 }] }));

    expect(await run(fetchFn)).toBe(6);

    const url = new URL(fetchFn.mock.calls[0]![0]);
    expect(url.searchParams.get('broadcaster_id')).toBe('42');
    expect(url.searchParams.get('moderator_id')).toBe('42');
    expect((fetchFn.mock.calls[0]![1]!.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('returns 0 when the delay is off', async () => {
    const fetchFn = fetchSequence(json({ data: [{ non_moderator_chat_delay: false, non_moderator_chat_delay_duration: null }] }));

    expect(await run(fetchFn)).toBe(0);
  });

  it('returns null when the token cannot read the delay', async () => {
    expect(await run(fetchSequence(json({ data: [{ slow_mode: false }] })))).toBeNull();
  });

  it('returns null on errors', async () => {
    expect(await run(fetchSequence(new Response('', { status: 401 })))).toBeNull();
    expect(await run(fetchSequence(new Error('offline')))).toBeNull();
  });
});
