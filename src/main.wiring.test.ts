import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Runs the real bootstrap against a fake IRC socket. Covers the wiring in main.ts
 * that the module tests do not touch.
 */

// Exactly the line that came over the wire in the overlay.
const PRIVMSG =
  '@badge-info=subscriber/11;badges=broadcaster/1,subscriber/0,pichu/1;' +
  'client-nonce=9a03d2a0137f4e59bebdd6d694142bdd;color=#005FCC;display-name=derpierre65;' +
  'emotes=;first-msg=0;flags=;id=d3121d49-2e6a-449d-a1e2-0c31dce60be2;mod=0;' +
  'returning-chatter=0;room-id=18853937;subscriber=1;tmi-sent-ts=1787938942811;turbo=0;' +
  'user-id=18853937;user-type= ' +
  ':derpierre65!derpierre65@derpierre65.tmi.twitch.tv PRIVMSG #derpierre65 :test';

const VIEWER_PRIVMSG =
  '@badges=;color=;display-name=viewer;emotes=;id=v1;mod=0;room-id=1;tmi-sent-ts=1;user-id=2 ' +
  ':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #derpierre65 :delayed hello';

const ably = vi.hoisted(() => ({
  options: null as unknown,
  channel: null as string | null,
  listener: null as ((message: { name: string; data: unknown; clientId?: string }) => void) | null,
  published: [] as { name: string; data: unknown }[],
  present: false,
}));

const sound = vi.hoisted(() => ({ plays: 0 }));

vi.mock('./host/sound', () => ({
  createSoundPlayer: () => ({
    play: () => {
      sound.plays += 1;
    },
  }),
}));

vi.mock('ably', () => ({
  Realtime: class {
    connection = { on: (cb: (change: { current: string }) => void) => cb({ current: 'connected' }) };
    channels = {
      get: (name: string) => {
        ably.channel = name;
        return {
          subscribe: async (cb: typeof ably.listener) => {
            ably.listener = cb;
            return null;
          },
          publish: async (name: string, data: unknown) => {
            ably.published.push({ name, data });
          },
          presence: {
            enter: async () => {
              ably.present = true;
            },
          },
        };
      },
    };
    constructor(options: unknown) {
      ably.options = options;
    }
    close(): void {}
  },
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  static privmsg = PRIVMSG;

  readyState = 1;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onopen: ((ev: unknown) => void) | null = null;

  constructor() {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.({}));
  }

  send(data: string): void {
    if (data.startsWith('NICK')) {
      this.push(':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!');
      this.push(':tmi.twitch.tv 376 justinfan12345 :>');
      return;
    }
    if (data.startsWith('JOIN')) {
      this.push(':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #derpierre65');
      this.push(FakeSocket.privmsg);
    }
  }

  push(line: string): void {
    queueMicrotask(() => this.onmessage?.({ data: `${line}\r\n` }));
  }

  close(): void {
    this.readyState = 3;
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeSocket.last = null;
  FakeSocket.privmsg = PRIVMSG;
  ably.options = null;
  ably.channel = null;
  ably.listener = null;
  ably.published = [];
  ably.present = false;
  localStorage.clear();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="log" class="log"></div><div id="status" class="status" hidden></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrap wiring', () => {
  it('runs the chat of the cached identity under the login view', async () => {
    // No token but an earlier login: chat runs, login view on top.
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '' }));
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('Connected to derpierre65'), { timeout: 4000 });
    await vi.waitFor(() => expect(log?.textContent).toContain('test'), { timeout: 4000 });

    expect(log?.querySelector('.line--chat')?.textContent).toContain('derpierre65');
    expect(document.querySelector('.login')).not.toBeNull();
  });

  it('shows the login view without waiting for emote providers', async () => {
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '18853937' }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    await import('./main');

    await vi.waitFor(() => expect(document.querySelector('.login')).not.toBeNull(), { timeout: 1000 });
  });

  it('switches the overlay to german with language=de', async () => {
    window.history.replaceState({}, '', '/?language=de');
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '' }));
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('Verbunden mit derpierre65'), { timeout: 4000 });
    expect(document.querySelector('.login__title')?.textContent).toBe('Mit Twitch verbinden');
    expect(document.documentElement.lang).toBe('de');
  });

  it('asks for a new login when the token lacks a newer scope', async () => {
    localStorage.setItem('overlay.token', 'tok');
    localStorage.setItem('overlay.refresh', 'ref');
    const validation = { login: 'derpierre65', user_id: '1', scopes: ['channel:read:redemptions'], expires_in: 9000 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/oauth2/validate') ? new Response(JSON.stringify(validation)) : new Response('{}'),
      ),
    );
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('Connected to derpierre65'), { timeout: 4000 });
    expect(document.querySelector('.login')).not.toBeNull();
  });

  it('shows no login view for a token with every scope', async () => {
    const { SCOPES } = await import('./auth/oauth');
    localStorage.setItem('overlay.token', 'tok');
    localStorage.setItem('overlay.refresh', 'ref');
    const validation = { login: 'derpierre65', user_id: '1', scopes: SCOPES, expires_in: 9000 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/oauth2/validate') ? new Response(JSON.stringify(validation)) : new Response('{}'),
      ),
    );
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('Connected to derpierre65'), { timeout: 4000 });
    expect(document.querySelector('.login')).toBeNull();
  });

  it('holds viewer messages for the chat delay set on twitch', async () => {
    const { SCOPES } = await import('./auth/oauth');
    localStorage.setItem('overlay.token', 'tok');
    localStorage.setItem('overlay.refresh', 'ref');
    FakeSocket.privmsg = VIEWER_PRIVMSG;
    const validation = { login: 'derpierre65', user_id: '1', scopes: SCOPES, expires_in: 9000 };
    const settings = { data: [{ non_moderator_chat_delay: true, non_moderator_chat_delay_duration: 2 }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/oauth2/validate')) return new Response(JSON.stringify(validation));
        if (url.includes('/helix/chat/settings')) return new Response(JSON.stringify(settings));
        return new Response('{}');
      }),
    );
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('Connected to derpierre65'), { timeout: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(log?.textContent).not.toContain('delayed hello');

    await vi.waitFor(() => expect(log?.textContent).toContain('delayed hello'), { timeout: 4000 });
  });

  it('ignores a channel query parameter', async () => {
    window.history.replaceState({}, '', '/?channel=someoneelse');
    await import('./main');

    await vi.waitFor(() => expect(document.querySelector('.login')).not.toBeNull(), { timeout: 4000 });
    expect(FakeSocket.last).toBeNull();
  });

  it('holds viewer messages until a mod approves them via ably', async () => {
    window.history.replaceState({}, '', '/?ablyKey=app.key:sub&ablyChannel=mods');
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '' }));
    FakeSocket.privmsg = VIEWER_PRIVMSG;
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('Connected to derpierre65'), { timeout: 4000 });
    await vi.waitFor(() => expect(ably.listener).not.toBeNull(), { timeout: 4000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(log?.textContent).not.toContain('delayed hello');
    expect(ably.options).toMatchObject({ key: 'app.key:sub' });
    expect(ably.channel).toBe('mods');
    expect(log?.textContent).toContain('Chat approval active — no trusted users yet (not saved)');

    ably.listener!({ name: 'approve-message', data: { messageId: 'v1', userId: '2', login: 'viewer' } });
    await vi.waitFor(() => expect(log?.textContent).toContain('delayed hello'), { timeout: 4000 });
  });

  it('announces mod actions silently and answers sync requests with the state', async () => {
    window.history.replaceState({}, '', '/?ablyKey=app.key:sub&ablyChannel=mods');
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '' }));
    FakeSocket.privmsg = VIEWER_PRIVMSG;
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(ably.listener).not.toBeNull(), { timeout: 4000 });
    await vi.waitFor(() => expect(ably.published.some((m) => m.name === 'state')).toBe(true), { timeout: 4000 });
    expect(ably.present).toBe(true);

    await vi.waitFor(() => expect(log?.textContent).toContain('Chat approval active'), { timeout: 4000 });
    const playsBefore = sound.plays;

    ably.listener!({ name: 'approve-message', data: { messageId: 'x1', login: 'someone' } });
    await vi.waitFor(() => expect(log?.textContent).toContain('Message from someone approved by a mod'), { timeout: 4000 });
    expect(sound.plays).toBe(playsBefore);
    ably.listener!({ name: 'trust-user', data: { userId: '2', login: 'viewer' }, clientId: 'ModName' });
    await vi.waitFor(() => expect(log?.textContent).toContain('viewer trusted by ModName'), { timeout: 4000 });

    ably.published = [];
    ably.listener!({ name: 'sync-request', data: null, clientId: 'Other' });
    await vi.waitFor(() => expect(ably.published).toHaveLength(1), { timeout: 4000 });
    expect(ably.published[0]).toEqual({
      name: 'state',
      data: {
        reset: true,
        trusted: { '2': { login: 'viewer', by: 'ModName' } },
        approved: { x1: { login: 'someone', by: null } },
      },
    });
  });

  it('shows messages of users from the stored trust list right away', async () => {
    window.history.replaceState(
      {},
      '',
      '/?ablyKey=k&ablyChannel=mods&trustUrl=https://trust.example&trustSecret=s',
    );
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '' }));
    FakeSocket.privmsg = VIEWER_PRIVMSG;
    const fetchFn = vi.fn(async (url: string) =>
      url === 'https://trust.example/trusted/derpierre65'
        ? new Response(JSON.stringify({ users: { '2': { login: 'viewer', trustedAt: '2026-01-01T00:00:00.000Z' } } }))
        : new Response('{}'),
    );
    vi.stubGlobal('fetch', fetchFn);
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('delayed hello'), { timeout: 4000 });
    await vi.waitFor(() => expect(log?.textContent).toContain('Chat approval active — 1 trusted: viewer'), { timeout: 4000 });
  });

  it('does not load ably without the approval parameters', async () => {
    localStorage.setItem('overlay.identity', JSON.stringify({ login: 'derpierre65', userId: '' }));
    FakeSocket.privmsg = VIEWER_PRIVMSG;
    await import('./main');

    const log = document.getElementById('log');
    await vi.waitFor(() => expect(log?.textContent).toContain('delayed hello'), { timeout: 4000 });
    expect(ably.options).toBeNull();
  });
});
