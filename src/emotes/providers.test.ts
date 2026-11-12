import { describe, expect, it, vi } from 'vitest';
import { loadEmotes } from './providers';

const sevenTv = {
  emote_set: {
    emotes: [
      { name: 'catJAM', data: { host: { url: '//cdn.7tv.app/emote/1', files: [{ name: '2x.webp' }] }, flags: 0 } },
      { name: 'widepeepoHappy', data: { host: { url: '//cdn.7tv.app/emote/2', files: [{ name: '2x.webp' }] }, flags: 256 } },
    ],
  },
};
const bttv = { channelEmotes: [{ id: 'b1', code: 'monkaS' }], sharedEmotes: [] };
const ffz = { sets: { '1': { emoticons: [{ name: 'ZreknarF', urls: { '2': '//cdn.frankerfacez.com/2' } }] } } };

function fetchStub(map: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(map).find((k) => url.includes(k));
    if (key === undefined) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('loadEmotes', () => {
  it('returns one array per provider in priority order', async () => {
    const result = await loadEmotes('123', fetchStub({ '7tv.io': sevenTv, betterttv: bttv, frankerfacez: ffz }));

    expect(result).toHaveLength(3);
    expect(result[0]?.map((e) => e.code)).toContain('catJAM');
    expect(result[1]?.map((e) => e.code)).toContain('monkaS');
    expect(result[2]?.map((e) => e.code)).toContain('ZreknarF');
  });

  it('marks 7tv zero width emotes', async () => {
    const [seven] = await loadEmotes('123', fetchStub({ '7tv.io': sevenTv }));

    expect(seven?.find((e) => e.code === 'widepeepoHappy')?.zeroWidth).toBe(true);
    expect(seven?.find((e) => e.code === 'catJAM')?.zeroWidth).toBe(false);
  });

  it('yields an empty array for a provider that fails', async () => {
    const result = await loadEmotes('123', fetchStub({ betterttv: bttv }));

    expect(result[0]).toEqual([]);
    expect(result[1]?.length).toBe(1);
    expect(result[2]).toEqual([]);
  });

  it('yields empty arrays when fetch rejects entirely', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    expect(await loadEmotes('123', failing)).toEqual([[], [], []]);
  });
});
