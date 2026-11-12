import type { Author, OverlayEvent } from '../events/types';

const author = (login: string, color: string | null = null): Author => ({
  id: login,
  login,
  displayName: login,
  color,
  badges: [
    { setId: 'moderator', version: '1' },
    { setId: 'subscriber', version: '12' },
  ],
});

const chat = (id: string, login: string, text: string, over: Partial<OverlayEvent> = {}): OverlayEvent =>
  ({
    id,
    ts: Date.now(),
    type: 'chat',
    author: author(login),
    text,
    twitchEmotes: [],
    action: false,
    bits: 0,
    ...over,
  }) as OverlayEvent;

export function demoEvents(): OverlayEvent[] {
  return [
    chat('d1', 'viewer_one', 'just a normal message'),
    chat('d2', 'whitename', 'white name on white', { author: { ...author('whitename'), color: '#ffffff' } }),
    chat('d3', 'emote_spam', Array(20).fill('catJAM').join(' ')),
    chat('d4', 'attacker', '<img src=x onerror=alert(1)>'),
    chat('d5', 'cheerer', 'cheer100 take the bits', { bits: 100 }),
    chat('d6', 'roleplay', 'waves briefly', { action: true }),
    { id: 'd7', ts: Date.now(), type: 'raid', from: 'BigStreamer', viewers: 1234 },
    { id: 'd8', ts: Date.now(), type: 'sub', user: 'Newcomer', tier: '1000', text: 'finally here' },
    { id: 'd9', ts: Date.now(), type: 'resub', user: 'Regular', tier: '2000', months: 42, streak: 12, text: null },
    { id: 'd10', ts: Date.now(), type: 'giftsub', gifter: 'Gifter', recipient: 'Recipient', tier: '1000' },
    { id: 'd11', ts: Date.now(), type: 'subbomb', gifter: 'Gifter', count: 50, tier: '1000' },
    { id: 'd12', ts: Date.now(), type: 'announcement', user: 'Moderator', text: 'Back in a minute' },
    {
      id: 'd13',
      ts: Date.now(),
      type: 'redemption',
      user: 'Redeemer',
      reward: 'Song Request',
      cost: 5000,
      input:
        'An intentionally very long request text that has to wrap over several lines so you can see how the layout behaves when someone uses the whole input.',
    },
    { id: 'd14', ts: Date.now(), type: 'follow', user: 'FreshFollower' },
    { id: 'd15', ts: Date.now(), type: 'hypetrain', phase: 'begin', level: 1 },
    { id: 'd16', ts: Date.now(), type: 'notice', text: 'Unknown USERNOTICE type as system text' },
    { id: 'd17', ts: Date.now(), type: 'moderation', action: 'timeout', user: 'Troublemaker', moderator: 'Moderator', reason: 'Caps', seconds: 600 },
    { id: 'd18', ts: Date.now(), type: 'moderation', action: 'ban', user: 'Spambot', moderator: 'Moderator', reason: null, seconds: null },
    { id: 'd19', ts: Date.now(), type: 'moderation', action: 'unban', user: 'Troublemaker', moderator: 'Moderator', reason: null, seconds: null },
  ];
}

export function playDemo(
  emit: (event: OverlayEvent) => void,
  setTimeoutFn: typeof setTimeout = setTimeout,
): void {
  demoEvents().forEach((event, index) => {
    setTimeoutFn(() => emit(event), index * 800);
  });
}
