import type { Author, Badge, OverlayEvent, TwitchEmoteRange } from './types';

/**
 * Tags as tmi.js passes them on. Not always strings: `client.js:116` replaces
 * `badges`, `badge-info` and `emotes` with objects and keeps the originals under
 * `<key>-raw`. Via `raw_message` the same tags arrive as strings.
 */
export type IrcTags = Record<string, unknown>;

/** IRCv3 escapes spaces, semicolons and backslashes in tag values. */
function unescapeTag(value: string): string {
  return value
    .replace(/\\s/g, ' ')
    .replace(/\\:/g, ';')
    .replace(/\\r/g, '')
    .replace(/\\n/g, '')
    .replace(/\\\\/g, '\\');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(str(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ts(tags: IrcTags): number {
  return num(tags['tmi-sent-ts'], Date.now());
}

function id(tags: IrcTags): string {
  return str(tags['id']) ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseBadges(raw: unknown): Badge[] {
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .filter((entry) => entry !== '')
      .map((entry) => {
        const [setId, version] = entry.split('/');
        return { setId: setId ?? '', version: version ?? '' };
      });
  }

  if (raw !== null && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => entry[0] !== '' && typeof entry[1] === 'string')
      .map(([setId, version]) => ({ setId, version }));
  }

  return [];
}

export function parseTwitchEmotes(raw: unknown): TwitchEmoteRange[] {
  const out: TwitchEmoteRange[] = [];

  const pushRange = (emoteId: string, range: string): void => {
    const [start, end] = range.split('-');
    if (start === undefined || end === undefined) return;
    out.push({ id: emoteId, start: Number(start), end: Number(end) });
  };

  if (typeof raw === 'string') {
    for (const chunk of raw.split('/')) {
      const [emoteId, ranges] = chunk.split(':');
      if (!emoteId || !ranges) continue;
      for (const range of ranges.split(',')) pushRange(emoteId, range);
    }
    return out;
  }

  if (raw !== null && typeof raw === 'object') {
    for (const [emoteId, ranges] of Object.entries(raw as Record<string, unknown>)) {
      if (emoteId === '' || !Array.isArray(ranges)) continue;
      for (const range of ranges) {
        if (typeof range === 'string') pushRange(emoteId, range);
      }
    }
  }

  return out;
}

export function parseAuthor(tags: IrcTags): Author {
  const login = (str(tags['username']) ?? '').toLowerCase();

  return {
    login,
    displayName: str(tags['display-name']) || login,
    color: str(tags['color']) || null,
    badges: parseBadges(tags['badges-raw'] ?? tags['badges']),
  };
}

export function normalizeChat(tags: IrcTags, message: string, isAction: boolean): OverlayEvent {
  return {
    id: id(tags),
    ts: ts(tags),
    type: 'chat',
    author: parseAuthor(tags),
    text: message,
    twitchEmotes: parseTwitchEmotes(tags['emotes-raw'] ?? tags['emotes']),
    action: isAction,
    bits: num(tags['bits']),
  };
}

export function normalizeUserNotice(tags: IrcTags, message: string | undefined): OverlayEvent | null {
  const base = { id: id(tags), ts: ts(tags) };
  const user = str(tags['display-name']) || str(tags['login']) || '';
  const tier = str(tags['msg-param-sub-plan']) ?? '1000';
  const text = message && message.trim() !== '' ? message : null;

  switch (str(tags['msg-id'])) {
    case 'raid':
      return {
        ...base,
        type: 'raid',
        from: str(tags['msg-param-displayName']) || str(tags['msg-param-login']) || user,
        viewers: num(tags['msg-param-viewerCount']),
      };

    case 'sub':
      return { ...base, type: 'sub', user, tier, text };

    case 'resub':
      return {
        ...base,
        type: 'resub',
        user,
        tier,
        months: num(tags['msg-param-cumulative-months']),
        streak: tags['msg-param-streak-months'] ? num(tags['msg-param-streak-months']) : null,
        text,
      };

    case 'subgift':
    case 'anonsubgift':
      return {
        ...base,
        type: 'giftsub',
        gifter: user || 'Anonym',
        recipient:
          str(tags['msg-param-recipient-display-name']) || str(tags['msg-param-recipient-user-name']) || '',
        tier,
      };

    case 'submysterygift':
    case 'anonsubmysterygift':
      return {
        ...base,
        type: 'subbomb',
        gifter: user || 'Anonym',
        count: num(tags['msg-param-mass-gift-count']),
        tier,
      };

    case 'announcement':
      return { ...base, type: 'announcement', user, text: text ?? '' };

    default: {
      // msg-ids unknown to tmi.js 1.8.5 end up as plain system text.
      const systemMsg = str(tags['system-msg']);
      if (!systemMsg) return null;
      return { ...base, type: 'notice', text: unescapeTag(systemMsg) };
    }
  }
}
