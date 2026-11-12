export interface BadgeIndex {
  get(setId: string, version: string): string | undefined;
}

export const emptyBadgeIndex: BadgeIndex = { get: () => undefined };

interface HelixBadgeResponse {
  data?: { set_id: string; versions: { id: string; image_url_2x: string }[] }[];
}

async function fetchSets(
  url: string,
  clientId: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<HelixBadgeResponse['data']> {
  try {
    const response = await fetchFn(url, {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return ((await response.json()) as HelixBadgeResponse).data ?? [];
  } catch {
    return [];
  }
}

export async function loadBadges(opts: {
  clientId: string;
  token: string;
  broadcasterId: string;
  fetchFn?: typeof fetch;
}): Promise<BadgeIndex> {
  const fetchFn = opts.fetchFn ?? fetch;
  const [globalSets, channelSets] = await Promise.all([
    fetchSets('https://api.twitch.tv/helix/chat/badges/global', opts.clientId, opts.token, fetchFn),
    fetchSets(
      `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${opts.broadcasterId}`,
      opts.clientId,
      opts.token,
      fetchFn,
    ),
  ]);

  const byKey = new Map<string, string>();
  // Channel sets last so they override the global ones.
  for (const set of [...(globalSets ?? []), ...(channelSets ?? [])]) {
    for (const version of set.versions) {
      byKey.set(`${set.set_id}/${version.id}`, version.image_url_2x);
    }
  }

  return { get: (setId, version) => byKey.get(`${setId}/${version}`) };
}
