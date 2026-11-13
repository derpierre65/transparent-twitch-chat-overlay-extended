import type { OverlayEvent } from './types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function int(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Twitch documents numbers, but its example payload sends strings.
function looseInt(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return int(n);
}

function timeoutSeconds(start: unknown, end: unknown): number {
  const ms = Date.parse(str(end)) - Date.parse(str(start));
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
}

export function normalizeEventSub(
  subscriptionType: string,
  event: Record<string, unknown>,
  messageId: string,
): OverlayEvent | null {
  const base = { id: messageId, ts: Date.now() };

  switch (subscriptionType) {
    case 'channel.channel_points_custom_reward_redemption.add': {
      const reward = (event['reward'] ?? {}) as Record<string, unknown>;
      const input = str(event['user_input']);
      return {
        ...base,
        type: 'redemption',
        user: str(event['user_name']),
        reward: str(reward['title']),
        cost: int(reward['cost']),
        input: input === '' ? null : input,
      };
    }

    case 'channel.follow':
      return { ...base, type: 'follow', user: str(event['user_name']) };

    case 'channel.hype_train.begin':
    case 'channel.hype_train.progress':
    case 'channel.hype_train.end': {
      const phase = subscriptionType.split('.').pop() as 'begin' | 'progress' | 'end';
      return { ...base, type: 'hypetrain', phase, level: int(event['level']) };
    }

    case 'channel.ad_break.begin': {
      const seconds = looseInt(event['duration_seconds']);
      const started = Date.parse(str(event['started_at']));
      const start = Number.isFinite(started) ? started : base.ts;
      return { ...base, type: 'adbreak', phase: 'begin', seconds, endsAt: start + seconds * 1000 };
    }

    case 'channel.ban': {
      const permanent = event['is_permanent'] === true;
      const reason = str(event['reason']);
      return {
        ...base,
        type: 'moderation',
        action: permanent ? 'ban' : 'timeout',
        user: str(event['user_name']),
        moderator: str(event['moderator_user_name']),
        reason: reason === '' ? null : reason,
        seconds: permanent ? null : timeoutSeconds(event['banned_at'], event['ends_at']),
      };
    }

    case 'channel.unban':
      return {
        ...base,
        type: 'moderation',
        action: 'unban',
        user: str(event['user_name']),
        moderator: str(event['moderator_user_name']),
        reason: null,
        seconds: null,
      };

    default:
      return null;
  }
}
