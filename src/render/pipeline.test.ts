import { beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n';
import { emptyBadgeIndex } from '../badges/badges';
import { createRegistry } from '../emotes/registry';
import { normalizeChat, type IrcTags } from '../events/normalize-irc';
import { createChatLog } from './chat-log';

// Tags exactly as tmi.js passes them on for the broadcaster's own message.
const REAL_TAGS: IrcTags = {
  'badge-info': '',
  badges: 'broadcaster/1',
  color: '#FF0000',
  'display-name': 'derPierre65',
  emotes: '',
  'first-msg': 'false',
  flags: '',
  id: 'ec6f0d1f-1b58-4b0f-9a2d-000000000001',
  mod: 'false',
  'returning-chatter': 'false',
  'room-id': '123456',
  subscriber: 'false',
  'tmi-sent-ts': '1756400000000',
  turbo: 'false',
  'user-id': '123456',
  'user-type': '',
  username: 'derpierre65',
  'message-type': 'chat',
};

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('irc tags to dom', () => {
  it('renders a real chat message end to end', () => {
    const log = createChatLog(root, {
      maxLines: 50,
      fade: 60,
      ctx: { emotes: createRegistry([]), badges: emptyBadgeIndex, t: MESSAGES.en },
    });

    const inserted = log.handle(normalizeChat(REAL_TAGS, 'test', false));

    expect(inserted).toBe(true);
    expect(root.children).toHaveLength(1);
    expect(root.textContent).toContain('derPierre65');
    expect(root.textContent).toContain('test');
  });

  it('renders when the emotes tag is an empty string', () => {
    const log = createChatLog(root, {
      maxLines: 50,
      fade: 0,
      ctx: { emotes: createRegistry([]), badges: emptyBadgeIndex, t: MESSAGES.en },
    });

    log.handle(normalizeChat({ ...REAL_TAGS, emotes: '' }, 'hallo welt', false));

    expect(root.textContent).toContain('hallo welt');
  });

  it('keeps chat lines alongside a notice line', () => {
    const log = createChatLog(root, {
      maxLines: 50,
      fade: 0,
      ctx: { emotes: createRegistry([]), badges: emptyBadgeIndex, t: MESSAGES.en },
    });

    log.handle({ id: 'c1', ts: 0, type: 'notice', text: 'Connected to derpierre65' });
    log.handle(normalizeChat(REAL_TAGS, 'test', false));

    expect(root.children).toHaveLength(2);
    expect(root.children[1]?.textContent).toContain('test');
  });
});
