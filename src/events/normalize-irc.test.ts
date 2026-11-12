import { describe, expect, it } from 'vitest';
import { normalizeChat, normalizeUserNotice, parseAuthor, parseTwitchEmotes } from './normalize-irc';

describe('parseTwitchEmotes', () => {
  it('returns an empty list for missing tags', () => {
    expect(parseTwitchEmotes(undefined)).toEqual([]);
    expect(parseTwitchEmotes('')).toEqual([]);
  });

  it('parses a single range', () => {
    expect(parseTwitchEmotes('25:0-4')).toEqual([{ id: '25', start: 0, end: 4 }]);
  });

  it('parses several ids with several ranges each', () => {
    expect(parseTwitchEmotes('25:0-4,12-16/1902:6-10')).toEqual([
      { id: '25', start: 0, end: 4 },
      { id: '25', start: 12, end: 16 },
      { id: '1902', start: 6, end: 10 },
    ]);
  });
});

describe('parseTwitchEmotes — pre-parsed by tmi.js', () => {
  it('accepts the object shape tmi.js produces', () => {
    expect(parseTwitchEmotes({ '25': ['0-4', '12-16'], '1902': ['6-10'] })).toEqual([
      { id: '25', start: 0, end: 4 },
      { id: '25', start: 12, end: 16 },
      { id: '1902', start: 6, end: 10 },
    ]);
  });

  it('ignores the empty placeholder tmi.js builds from an empty emotes tag', () => {
    expect(parseTwitchEmotes({ '': null })).toEqual([]);
  });

  it('ignores a null tag', () => {
    expect(parseTwitchEmotes(null)).toEqual([]);
  });
});

describe('parseAuthor', () => {
  it('reads name, color and badges', () => {
    const author = parseAuthor({
      'display-name': 'derPierre65',
      username: 'derpierre65',
      color: '#FF0000',
      badges: 'moderator/1,subscriber/12',
    });

    expect(author).toEqual({
      login: 'derpierre65',
      displayName: 'derPierre65',
      color: '#FF0000',
      badges: [
        { setId: 'moderator', version: '1' },
        { setId: 'subscriber', version: '12' },
      ],
    });
  });

  it('falls back to the login when no display name is set', () => {
    expect(parseAuthor({ username: 'someone' }).displayName).toBe('someone');
  });

  it('reports a missing color as null', () => {
    expect(parseAuthor({ username: 'someone', color: '' }).color).toBeNull();
  });
});

describe('parseAuthor — pre-parsed by tmi.js', () => {
  it('reads badges from the object shape', () => {
    const author = parseAuthor({
      username: 'derpierre65',
      badges: { broadcaster: '1', subscriber: '0', pichu: '1' },
    });

    expect(author.badges).toEqual([
      { setId: 'broadcaster', version: '1' },
      { setId: 'subscriber', version: '0' },
      { setId: 'pichu', version: '1' },
    ]);
  });

  it('prefers badges-raw when tmi.js kept the original string', () => {
    const author = parseAuthor({
      username: 'u',
      badges: { broadcaster: '1' },
      'badges-raw': 'moderator/1',
    });

    expect(author.badges).toEqual([{ setId: 'moderator', version: '1' }]);
  });

  it('survives the empty placeholder in the badges object', () => {
    expect(parseAuthor({ username: 'u', badges: { '': null } }).badges).toEqual([]);
  });
});

describe('normalizeChat', () => {
  it('maps a plain message', () => {
    const event = normalizeChat({ id: 'abc', username: 'someone', 'tmi-sent-ts': '1700000000000' }, 'hi', false);

    expect(event).toMatchObject({ type: 'chat', id: 'abc', text: 'hi', action: false, bits: 0, ts: 1700000000000 });
  });

  it('carries bits as a number', () => {
    const event = normalizeChat({ id: 'abc', username: 'someone', bits: '100' }, 'cheer100', false);

    expect(event).toMatchObject({ type: 'chat', bits: 100 });
  });

  it('reads the emote ranges tmi.js already parsed', () => {
    const event = normalizeChat(
      { id: 'a', username: 'u', emotes: { '25': ['3-7'] }, 'emotes-raw': '25:3-7' },
      'hi Kappa there',
      false,
    );

    expect(event).toMatchObject({ twitchEmotes: [{ id: '25', start: 3, end: 7 }] });
  });

  it('marks an action message', () => {
    expect(normalizeChat({ id: 'a', username: 'u' }, 'waves', true)).toMatchObject({ action: true });
  });
});

describe('normalizeUserNotice', () => {
  it('maps a raid', () => {
    const event = normalizeUserNotice(
      { id: 'n1', 'msg-id': 'raid', 'msg-param-displayName': 'Raider', 'msg-param-viewerCount': '42' },
      undefined,
    );

    expect(event).toMatchObject({ type: 'raid', from: 'Raider', viewers: 42 });
  });

  it('maps a first time sub with its message', () => {
    const event = normalizeUserNotice(
      { id: 'n2', 'msg-id': 'sub', 'display-name': 'Newbie', 'msg-param-sub-plan': '1000' },
      'freut mich',
    );

    expect(event).toMatchObject({ type: 'sub', user: 'Newbie', tier: '1000', text: 'freut mich' });
  });

  it('maps a resub with months and streak', () => {
    const event = normalizeUserNotice(
      {
        id: 'n3',
        'msg-id': 'resub',
        'display-name': 'Loyal',
        'msg-param-sub-plan': '1000',
        'msg-param-cumulative-months': '12',
        'msg-param-streak-months': '3',
      },
      undefined,
    );

    expect(event).toMatchObject({ type: 'resub', months: 12, streak: 3 });
  });

  it('maps a single gift sub', () => {
    const event = normalizeUserNotice(
      {
        id: 'n4',
        'msg-id': 'subgift',
        'display-name': 'Santa',
        'msg-param-recipient-display-name': 'Lucky',
        'msg-param-sub-plan': '1000',
      },
      undefined,
    );

    expect(event).toMatchObject({ type: 'giftsub', gifter: 'Santa', recipient: 'Lucky' });
  });

  it('maps a sub bomb', () => {
    const event = normalizeUserNotice(
      {
        id: 'n5',
        'msg-id': 'submysterygift',
        'display-name': 'Santa',
        'msg-param-mass-gift-count': '50',
        'msg-param-sub-plan': '1000',
      },
      undefined,
    );

    expect(event).toMatchObject({ type: 'subbomb', count: 50 });
  });

  it('maps an announcement', () => {
    const event = normalizeUserNotice({ id: 'n6', 'msg-id': 'announcement', 'display-name': 'Mod' }, 'Achtung');

    expect(event).toMatchObject({ type: 'announcement', user: 'Mod', text: 'Achtung' });
  });

  it('falls back to system-msg for msg-ids tmi.js does not know', () => {
    const event = normalizeUserNotice(
      { id: 'n7', 'msg-id': 'viewermilestone', 'system-msg': 'Watched\\s10\\sstreams\\sin\\sa\\srow' },
      undefined,
    );

    expect(event).toMatchObject({ type: 'notice', text: 'Watched 10 streams in a row' });
  });

  it('drops an unknown msg-id without a system message', () => {
    expect(normalizeUserNotice({ id: 'n8', 'msg-id': 'somethingnew' }, undefined)).toBeNull();
  });
});
