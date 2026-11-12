export interface Badge {
  setId: string;
  version: string;
}

export interface Author {
  /** Twitch user ID from the IRC `user-id` tag; empty if missing. */
  id: string;
  login: string;
  displayName: string;
  color: string | null;
  badges: Badge[];
}

/** Indices refer to the raw text, not to already replaced text. */
export interface TwitchEmoteRange {
  id: string;
  start: number;
  end: number;
}

export type Fragment =
  | { kind: 'text'; text: string }
  | { kind: 'emote'; code: string; url: string; zeroWidth: boolean };

interface BaseEvent {
  id: string;
  ts: number;
}

export type ChatEvent = BaseEvent & {
  type: 'chat';
  author: Author;
  text: string;
  twitchEmotes: TwitchEmoteRange[];
  action: boolean;
  bits: number;
};

export type OverlayEvent =
  | ChatEvent
  | (BaseEvent & { type: 'raid'; from: string; viewers: number })
  | (BaseEvent & { type: 'sub'; user: string; tier: string; text: string | null })
  | (BaseEvent & {
      type: 'resub';
      user: string;
      tier: string;
      months: number;
      streak: number | null;
      text: string | null;
    })
  | (BaseEvent & { type: 'giftsub'; gifter: string; recipient: string; tier: string })
  | (BaseEvent & { type: 'subbomb'; gifter: string; count: number; tier: string })
  | (BaseEvent & { type: 'announcement'; user: string; text: string })
  | (BaseEvent & {
      type: 'redemption';
      user: string;
      reward: string;
      cost: number;
      input: string | null;
    })
  | (BaseEvent & { type: 'follow'; user: string })
  | (BaseEvent & { type: 'hypetrain'; phase: 'begin' | 'progress' | 'end'; level: number })
  | (BaseEvent & {
      type: 'moderation';
      action: 'ban' | 'timeout' | 'unban';
      user: string;
      moderator: string;
      reason: string | null;
      /** Only set for `timeout`. */
      seconds: number | null;
    })
  /** `silent`: shown without the sound, e.g. for the overlay's own hints. */
  | (BaseEvent & { type: 'notice'; text: string; silent?: boolean })
  | (BaseEvent & { type: 'delete'; targetId: string })
  | (BaseEvent & { type: 'clear'; targetLogin: string | null });

export type StatusKey = 'irc' | 'eventsub' | 'token' | 'approval';
export type StatusState = 'ok' | 'down';
