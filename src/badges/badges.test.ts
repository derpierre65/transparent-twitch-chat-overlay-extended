import { describe, expect, it, vi } from 'vitest';
import { emptyBadgeIndex, loadBadges } from './badges';

const globalSets = {
  data: [
    { set_id: 'moderator', versions: [{ id: '1', image_url_2x: 'https://badge/mod' }] },
    { set_id: 'subscriber', versions: [{ id: '0', image_url_2x: 'https://badge/sub-global' }] },
  ],
};
const channelSets = {
  data: [{ set_id: 'subscriber', versions: [{ id: '0', image_url_2x: 'https://badge/sub-channel' }] }],
};

function fetchStub(status = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (status !== 200) return new Response('nope', { status });
    const body = url.includes('broadcaster_id') ? channelSets : globalSets;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('loadBadges', () => {
  it('resolves a global badge', async () => {
    const index = await loadBadges({ clientId: 'c', token: 't', broadcasterId: '1', fetchFn: fetchStub() });

    expect(index.get('moderator', '1')).toBe('https://badge/mod');
  });

  it('lets channel badges override global ones', async () => {
    const index = await loadBadges({ clientId: 'c', token: 't', broadcasterId: '1', fetchFn: fetchStub() });

    expect(index.get('subscriber', '0')).toBe('https://badge/sub-channel');
  });

  it('sends client id and bearer token', async () => {
    const fetchFn = fetchStub();
    await loadBadges({ clientId: 'c', token: 't', broadcasterId: '1', fetchFn });

    const init = (fetchFn as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['Client-Id']).toBe('c');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
  });

  it('returns an empty index when helix rejects the token', async () => {
    const index = await loadBadges({ clientId: 'c', token: 't', broadcasterId: '1', fetchFn: fetchStub(401) });

    expect(index.get('moderator', '1')).toBeUndefined();
  });
});

describe('emptyBadgeIndex', () => {
  it('never resolves anything', () => {
    expect(emptyBadgeIndex.get('moderator', '1')).toBeUndefined();
  });
});
