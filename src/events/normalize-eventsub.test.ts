import { describe, expect, it } from 'vitest';
import { normalizeEventSub } from './normalize-eventsub';

describe('normalizeEventSub', () => {
  it('maps a channel point redemption', () => {
    const event = normalizeEventSub(
      'channel.channel_points_custom_reward_redemption.add',
      {
        user_name: 'Viewer',
        user_input: 'play something',
        reward: { title: 'Song Request', cost: 500 },
      },
      'm1',
    );

    expect(event).toMatchObject({
      type: 'redemption',
      user: 'Viewer',
      reward: 'Song Request',
      cost: 500,
      input: 'play something',
    });
  });

  it('reports an empty user input as null', () => {
    const event = normalizeEventSub(
      'channel.channel_points_custom_reward_redemption.add',
      { user_name: 'Viewer', user_input: '', reward: { title: 'Hydrate', cost: 10 } },
      'm2',
    );

    expect(event).toMatchObject({ input: null });
  });

  it('maps a follow', () => {
    expect(normalizeEventSub('channel.follow', { user_name: 'Newbie' }, 'm3')).toMatchObject({
      type: 'follow',
      user: 'Newbie',
    });
  });

  it('maps the three hype train phases', () => {
    expect(normalizeEventSub('channel.hype_train.begin', { level: 1 }, 'm4')).toMatchObject({
      type: 'hypetrain',
      phase: 'begin',
      level: 1,
    });
    expect(normalizeEventSub('channel.hype_train.progress', { level: 3 }, 'm5')).toMatchObject({ phase: 'progress' });
    expect(normalizeEventSub('channel.hype_train.end', { level: 5 }, 'm6')).toMatchObject({ phase: 'end' });
  });

  it('uses the message id so duplicates stay identifiable', () => {
    expect(normalizeEventSub('channel.follow', { user_name: 'x' }, 'm7')?.id).toBe('m7');
  });

  it('returns null for a subscription type we do not render', () => {
    expect(normalizeEventSub('channel.cheer', { user_name: 'x' }, 'm8')).toBeNull();
  });

  it('survives a payload with missing fields', () => {
    expect(normalizeEventSub('channel.follow', {}, 'm9')).toMatchObject({ type: 'follow', user: '' });
  });

  it('maps a permanent ban', () => {
    const event = normalizeEventSub(
      'channel.ban',
      { user_name: 'Troll', moderator_user_name: 'Mod', reason: 'spam', is_permanent: true, ends_at: null },
      'm10',
    );

    expect(event).toMatchObject({ type: 'moderation', action: 'ban', user: 'Troll', moderator: 'Mod', reason: 'spam', seconds: null });
  });

  it('maps a timeout with its duration', () => {
    const event = normalizeEventSub(
      'channel.ban',
      {
        user_name: 'Troll',
        moderator_user_name: 'Mod',
        reason: '',
        is_permanent: false,
        banned_at: '2026-11-12T10:00:00.123Z',
        ends_at: '2026-11-12T10:10:00.123Z',
      },
      'm11',
    );

    expect(event).toMatchObject({ action: 'timeout', reason: null, seconds: 600 });
  });

  it('maps an unban', () => {
    expect(
      normalizeEventSub('channel.unban', { user_name: 'Troll', moderator_user_name: 'Mod' }, 'm12'),
    ).toMatchObject({ type: 'moderation', action: 'unban', user: 'Troll', moderator: 'Mod' });
  });
});
