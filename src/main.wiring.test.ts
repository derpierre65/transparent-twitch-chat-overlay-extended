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
});
