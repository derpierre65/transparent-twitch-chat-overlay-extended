import type { Fragment, TwitchEmoteRange } from '../events/types';

export interface Emote {
  code: string;
  url: string;
  zeroWidth: boolean;
}

export interface EmoteRegistry {
  get(code: string): Emote | undefined;
  readonly size: number;
}

export function createRegistry(sources: Emote[][]): EmoteRegistry {
  const byCode = new Map<string, Emote>();
  for (const source of sources) {
    for (const emote of source) {
      // First source wins: 7TV before BTTV before FFZ.
      if (!byCode.has(emote.code)) byCode.set(emote.code, emote);
    }
  }

  return {
    get: (code) => byCode.get(code),
    get size() {
      return byCode.size;
    },
  };
}

function twitchEmoteUrl(id: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;
}

function scanThirdParty(text: string, registry: EmoteRegistry): Fragment[] {
  if (text === '') return [];

  const out: Fragment[] = [];
  let buffer = '';

  for (const token of text.split(/(\s+)/)) {
    const emote = registry.get(token);
    if (!emote) {
      buffer += token;
      continue;
    }
    if (buffer !== '') {
      out.push({ kind: 'text', text: buffer });
      buffer = '';
    }
    out.push({ kind: 'emote', code: emote.code, url: emote.url, zeroWidth: emote.zeroWidth });
  }

  if (buffer !== '') out.push({ kind: 'text', text: buffer });
  return out;
}

export function buildFragments(
  text: string,
  twitchEmotes: TwitchEmoteRange[],
  registry: EmoteRegistry,
): Fragment[] {
  // Twitch indices count code points, not UTF-16 units.
  const points = Array.from(text);
  const ordered = [...twitchEmotes].sort((a, b) => a.start - b.start);

  const out: Fragment[] = [];
  let cursor = 0;

  for (const range of ordered) {
    if (range.start < cursor || range.end >= points.length) continue;
    out.push(...scanThirdParty(points.slice(cursor, range.start).join(''), registry));
    out.push({
      kind: 'emote',
      code: points.slice(range.start, range.end + 1).join(''),
      url: twitchEmoteUrl(range.id),
      zeroWidth: false,
    });
    cursor = range.end + 1;
  }

  out.push(...scanThirdParty(points.slice(cursor).join(''), registry));
  return out;
}

export function fragmentsToNodes(fragments: Fragment[]): DocumentFragment {
  const out = document.createDocumentFragment();

  for (const fragment of fragments) {
    if (fragment.kind === 'text') {
      out.append(document.createTextNode(fragment.text));
      continue;
    }
    const img = document.createElement('img');
    img.className = fragment.zeroWidth ? 'emote emote--zero' : 'emote';
    img.src = fragment.url;
    img.alt = fragment.code;
    out.append(img);
  }

  return out;
}
