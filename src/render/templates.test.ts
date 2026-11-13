import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n';
import { createRegistry } from '../emotes/registry';
import { renderEvent, type RenderContext } from './templates';
import type { Author, OverlayEvent } from '../events/types';

const ctx: RenderContext = {
  emotes: createRegistry([[{ code: 'catJAM', url: 'https://7tv/catjam.webp', zeroWidth: false }]]),
  badges: { get: (setId, version) => (setId === 'moderator' && version === '1' ? 'https://badge/mod' : undefined) },
  t: MESSAGES.en,
};

const author: Author = {
  id: '18853937',
  login: 'derpierre65',
  displayName: 'derPierre65',
  color: '#ff0000',
  badges: [{ setId: 'moderator', version: '1' }],
};

const chat = (over: Partial<Extract<OverlayEvent, { type: 'chat' }>> = {}): OverlayEvent => ({
  id: '1',
  ts: 0,
  type: 'chat',
  author,
  text: 'hello catJAM',
  twitchEmotes: [],
  action: false,
  bits: 0,
  ...over,
});

describe('renderEvent — chat', () => {
  it('renders badge, name and message', () => {
    const el = renderEvent(chat(), ctx)!;

    expect(el.className).toBe('line line--chat');
    expect(el.querySelector('.badge')?.getAttribute('src')).toBe('https://badge/mod');
    expect(el.querySelector('.user')?.textContent).toBe('derPierre65');
    expect(el.querySelector('.msg img')?.getAttribute('alt')).toBe('catJAM');
  });

  it('applies the author color to the name only', () => {
    const el = renderEvent(chat(), ctx)!;

    expect((el.querySelector('.user') as HTMLElement).style.color).toBe('rgb(255, 0, 0)');
  });

  it('skips unknown badges instead of rendering a broken image', () => {
    const el = renderEvent(chat({ author: { ...author, badges: [{ setId: 'nope', version: '9' }] } }), ctx)!;

    expect(el.querySelector('.badge')).toBeNull();
  });

  it('marks /me messages', () => {
    const el = renderEvent(chat({ action: true }), ctx)!;

    expect(el.className).toContain('line--action');
  });

  it('marks messages carrying bits', () => {
    const el = renderEvent(chat({ bits: 100 }), ctx)!;

    expect(el.className).toContain('line--bits');
    expect(el.textContent).toContain('100');
  });

  it('never interprets a display name as markup', () => {
    const el = renderEvent(chat({ author: { ...author, displayName: '<b>x</b>' } }), ctx)!;

    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('.user')?.textContent).toBe('<b>x</b>');
  });
});

describe('renderEvent — events', () => {
  const cases: { event: OverlayEvent; cls: string; contains: string }[] = [
    { event: { id: '2', ts: 0, type: 'raid', from: 'someone', viewers: 42 }, cls: 'line--raid', contains: '42' },
    { event: { id: '3', ts: 0, type: 'sub', user: 'a', tier: '1000', text: null }, cls: 'line--sub', contains: 'a' },
    {
      event: { id: '4', ts: 0, type: 'resub', user: 'b', tier: '1000', months: 12, streak: 3, text: null },
      cls: 'line--resub',
      contains: '12',
    },
    {
      event: { id: '5', ts: 0, type: 'giftsub', gifter: 'c', recipient: 'd', tier: '1000' },
      cls: 'line--giftsub',
      contains: 'd',
    },
    { event: { id: '6', ts: 0, type: 'subbomb', gifter: 'e', count: 50, tier: '1000' }, cls: 'line--subbomb', contains: '50' },
    { event: { id: '7', ts: 0, type: 'announcement', user: 'f', text: 'hi' }, cls: 'line--announcement', contains: 'hi' },
    {
      event: { id: '8', ts: 0, type: 'redemption', user: 'g', reward: 'Hydrate', cost: 500, input: null },
      cls: 'line--redemption',
      contains: 'Hydrate',
    },
    { event: { id: '9', ts: 0, type: 'follow', user: 'h' }, cls: 'line--follow', contains: 'h' },
    { event: { id: '10', ts: 0, type: 'hypetrain', phase: 'begin', level: 2 }, cls: 'line--hypetrain', contains: '2' },
    {
      event: { id: '10a', ts: 0, type: 'adbreak', phase: 'begin', seconds: 90, endsAt: 0 },
      cls: 'line--adbreak-begin',
      contains: '90',
    },
    { event: { id: '11', ts: 0, type: 'notice', text: 'unknown notice' }, cls: 'line--notice', contains: 'unknown notice' },
  ];

  for (const { event, cls, contains } of cases) {
    it(`renders ${event.type}`, () => {
      const el = renderEvent(event, ctx)!;

      expect(el.className).toContain(cls);
      expect(el.textContent).toContain(contains);
    });
  }

  it('renders the redemption user input as text', () => {
    const el = renderEvent(
      { id: '12', ts: 0, type: 'redemption', user: 'g', reward: 'Song', cost: 1, input: '<script>x</script>' },
      ctx,
    )!;

    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>x</script>');
  });

  it('returns null for control events', () => {
    expect(renderEvent({ id: '13', ts: 0, type: 'delete', targetId: 'x' }, ctx)).toBeNull();
    expect(renderEvent({ id: '14', ts: 0, type: 'clear', targetLogin: null }, ctx)).toBeNull();
  });

  it('renders moderation actions with their own class and the reason as text', () => {
    const timeout: OverlayEvent = {
      id: '16',
      ts: 0,
      type: 'moderation',
      action: 'timeout',
      user: 'Troll',
      moderator: 'Mod',
      reason: '<b>spam</b>',
      seconds: 600,
    };
    const el = renderEvent(timeout, ctx)!;

    expect(el.className).toContain('line--timeout');
    expect(el.textContent).toBe('Troll was timed out for 10 minutes by Mod — <b>spam</b>');
    expect(el.querySelector('b')).toBeNull();

    const unban = renderEvent({ ...timeout, action: 'unban', reason: null, seconds: null }, ctx)!;
    expect(unban.className).toContain('line--unban');
    expect(unban.textContent).toBe('Troll was unbanned by Mod');
  });

  it('renders event text in the configured language', () => {
    const raid: OverlayEvent = { id: '15', ts: 0, type: 'raid', from: 'someone', viewers: 42 };

    expect(renderEvent(raid, ctx)!.textContent).toBe('someone is raiding with 42 viewers');
    expect(renderEvent(raid, { ...ctx, t: MESSAGES.de })!.textContent).toBe('someone raidet mit 42 Zuschauern');
  });
});
