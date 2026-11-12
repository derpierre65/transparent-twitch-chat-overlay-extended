import type { Emote } from './registry';

/** 7TV flag for zero-width emotes. */
const SEVENTV_ZERO_WIDTH = 1 << 8;

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown | null> {
  try {
    const response = await fetchFn(url);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // An emote outage must never take down the chat.
    return null;
  }
}

async function loadSevenTv(userId: string, fetchFn: typeof fetch): Promise<Emote[]> {
  const data = (await getJson(`https://7tv.io/v3/users/twitch/${userId}`, fetchFn)) as {
    emote_set?: { emotes?: { name?: string; data?: { host?: { url?: string; files?: { name?: string }[] }; flags?: number } }[] };
  } | null;

  const emotes = data?.emote_set?.emotes ?? [];
  const out: Emote[] = [];

  for (const entry of emotes) {
    const name = entry.name;
    const host = entry.data?.host?.url;
    if (!name || !host) continue;
    const file = entry.data?.host?.files?.find((f) => f.name?.endsWith('2x.webp'))?.name ?? '2x.webp';
    out.push({
      code: name,
      url: `https:${host}/${file}`,
      zeroWidth: ((entry.data?.flags ?? 0) & SEVENTV_ZERO_WIDTH) !== 0,
    });
  }

  return out;
}

async function loadBttv(userId: string, fetchFn: typeof fetch): Promise<Emote[]> {
  const data = (await getJson(
    `https://api.betterttv.net/3/cached/users/twitch/${userId}`,
    fetchFn,
  )) as { channelEmotes?: { id: string; code: string }[]; sharedEmotes?: { id: string; code: string }[] } | null;

  const all = [...(data?.channelEmotes ?? []), ...(data?.sharedEmotes ?? [])];
  return all.map((e) => ({
    code: e.code,
    url: `https://cdn.betterttv.net/emote/${e.id}/2x`,
    zeroWidth: false,
  }));
}

async function loadFfz(userId: string, fetchFn: typeof fetch): Promise<Emote[]> {
  const data = (await getJson(`https://api.frankerfacez.com/v1/room/id/${userId}`, fetchFn)) as {
    sets?: Record<string, { emoticons?: { name: string; urls?: Record<string, string> }[] }>;
  } | null;

  const out: Emote[] = [];
  for (const set of Object.values(data?.sets ?? {})) {
    for (const emoticon of set.emoticons ?? []) {
      const url = emoticon.urls?.['2'] ?? emoticon.urls?.['1'];
      if (!url) continue;
      out.push({ code: emoticon.name, url: url.startsWith('http') ? url : `https:${url}`, zeroWidth: false });
    }
  }
  return out;
}

export async function loadEmotes(userId: string, fetchFn: typeof fetch = fetch): Promise<Emote[][]> {
  return Promise.all([
    loadSevenTv(userId, fetchFn),
    loadBttv(userId, fetchFn),
    loadFfz(userId, fetchFn),
  ]);
}
