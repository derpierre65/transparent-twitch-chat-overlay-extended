import { startDeviceLogin, type DeviceLogin } from '../auth/device';
import { clearTokens, readRefreshToken, readToken, validateToken } from '../auth/oauth';
import { createTokenRefresher } from '../auth/refresh';
import { authenticate, type Session } from '../auth/session';
import { emptyBadgeIndex, loadBadges } from '../badges/badges';
import { CLIENT_ID } from '../client-id';
import { loadEmotes } from '../emotes/providers';
import { createRegistry } from '../emotes/registry';
import type { StatusState } from '../events/types';
import { MESSAGES, parseLanguage } from '../i18n';
import { createLoginView } from '../render/login';
import type { RenderContext } from '../render/templates';
import { createIrcSource } from '../sources/irc';
import { connectModFeed, describeAblyError, type ModFeed, type ModFeedStatus } from './ably-mod';
import { createApprovalView } from './approval-view';
import { createModLog, type ActionTarget, type ModAction } from './mod-log';
import { MOD_PROFILE, createModerator, type Moderator } from './moderation';
import { createSetupStore, setupLabel } from './setups';

// Twitch requires apps to validate tokens hourly.
const VALIDATE_INTERVAL_MS = 60 * 60 * 1000;
const MESSAGE_MS = 6_000;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found as T;
}

function text(target: HTMLElement, content: string): void {
  target.replaceChildren(document.createTextNode(content));
}

async function main(): Promise<void> {
  const storage = window.localStorage;
  const t = MESSAGES[parseLanguage(new URLSearchParams(window.location.search).get('language'))];
  const store = createSetupStore(storage);

  const select = el<HTMLSelectElement>('setup');
  const remove = el<HTMLButtonElement>('remove');
  const addForm = el<HTMLFormElement>('add');
  const codeInput = el<HTMLInputElement>('code');
  const twitchEl = el<HTMLElement>('twitch');
  const loginBtn = el<HTMLButtonElement>('login');
  const logoutBtn = el<HTMLButtonElement>('logout');
  const stateEl = el<HTMLElement>('state');
  const messageEl = el<HTMLElement>('message');
  const chat = el<HTMLElement>('chat');

  let messageTimer: number | undefined;
  const say = (content: string, error = true): void => {
    window.clearTimeout(messageTimer);
    text(messageEl, content);
    messageEl.classList.toggle('is-error', error);
    messageTimer = window.setTimeout(() => text(messageEl, ''), MESSAGE_MS);
  };

  /* ---------- Setup codes ---------- */

  const setup = store.selected();
  for (const entry of store.list()) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.append(document.createTextNode(setupLabel(entry)));
    select.append(option);
  }
  if (setup) select.value = setup.id;
  select.disabled = !setup;
  remove.disabled = !setup;

  // Switching reconnects everything; a reload is the simplest clean way.
  select.addEventListener('change', () => {
    store.select(select.value);
    window.location.reload();
  });
  remove.addEventListener('click', () => {
    if (!setup || !window.confirm(`Remove the setup code for ${setupLabel(setup)} from this browser?`)) return;
    store.remove(setup.id);
    window.location.reload();
  });
  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      store.add(codeInput.value);
      window.location.reload();
    } catch (error) {
      say(`Invalid setup code: ${(error as Error).message}`);
    }
  });

  if (!setup) {
    text(stateEl, '');
    text(chat, 'Paste the setup code you got from the streamer above to start.');
    chat.classList.add('is-empty');
    return;
  }
  document.title = `#${setup.twitchChannel} – mod view`;

  /* ---------- Twitch login (optional, for delete/timeout/ban) ---------- */

  const refresher = createTokenRefresher({ clientId: CLIENT_ID, storage, profile: MOD_PROFILE });
  let session: Session | null = null;
  let token = '';
  let authNote = '';

  const loggedOut = (note: string): void => {
    session = null;
    moderator = null;
    authNote = note;
    renderTwitch();
    log.refresh();
  };

  let moderator: Moderator | null = null;
  if (CLIENT_ID && readRefreshToken(storage, MOD_PROFILE)) {
    const auth = await authenticate({ storage, refresher, profile: MOD_PROFILE });
    if (auth.status === 'ok') {
      if (MOD_PROFILE.scopes.every((scope) => auth.value.validation.scopes.includes(scope))) {
        session = auth.value;
        token = auth.value.token;
      } else {
        authNote = 'Permissions missing: log in again.';
      }
    } else if (auth.status === 'unreachable') {
      authNote = 'Twitch not reachable: reload the page to try again.';
    } else {
      authNote = 'Twitch login expired: log in again.';
    }
  }

  if (session) {
    const moderatorId = session.validation.userId;
    moderator = createModerator({
      clientId: CLIENT_ID,
      moderatorId,
      getToken: () => token,
      refresh: async (stale) => {
        const result = await refresher.refresh(stale);
        if (result.status === 'ok') {
          token = result.value;
          return token;
        }
        if (result.status === 'rejected') loggedOut('Twitch login expired: log in again.');
        return null;
      },
    });

    window.setInterval(() => {
      void validateToken(token).then(async (checked) => {
        if (checked.status !== 'rejected') return;
        const result = await refresher.refresh(token);
        if (result.status === 'ok') token = result.value;
        else if (result.status === 'rejected') loggedOut('Twitch login expired: log in again.');
      });
    }, VALIDATE_INTERVAL_MS);
  }

  function renderTwitch(): void {
    loginBtn.hidden = !!session;
    logoutBtn.hidden = !session && !readToken(storage, MOD_PROFILE);
    loginBtn.disabled = !CLIENT_ID;
    if (!CLIENT_ID) text(twitchEl, 'Twitch login unavailable in this build.');
    else if (session) text(twitchEl, `Logged in as ${session.validation.login}`);
    else text(twitchEl, authNote || 'Log in to delete messages, time out and ban.');
  }
  renderTwitch();

  let deviceLogin: DeviceLogin | null = null;
  loginBtn.addEventListener('click', () => {
    if (deviceLogin) return;
    const view = createLoginView(
      document.body,
      {
        ...t.login,
        intro: 'Open the link and confirm with the Twitch account you moderate with. This page signs in by itself afterwards.',
      },
      {
        openLabel: 'Open in new tab',
        cancel: {
          label: 'Cancel',
          onClick: () => {
            deviceLogin?.stop();
            deviceLogin = null;
            view.close();
          },
        },
      },
    );
    view.setStatus(t.login.requesting);
    deviceLogin = startDeviceLogin({
      clientId: CLIENT_ID,
      storage,
      profile: MOD_PROFILE,
      onCode: (code) => view.showCode(code),
      onStatus: (state) => view.setStatus(t.login[state]),
      onSuccess: () => window.location.reload(),
    });
  });

  logoutBtn.addEventListener('click', () => {
    const stale = readToken(storage, MOD_PROFILE);
    clearTokens(storage, MOD_PROFILE);
    // Best effort: the token stops working at Twitch too.
    if (stale) {
      void fetch('https://id.twitch.tv/oauth2/revoke', {
        method: 'POST',
        body: new URLSearchParams({ client_id: CLIENT_ID, token: stale }),
      }).catch(() => undefined);
    }
    window.location.reload();
  });

  // A login or logout in another tab applies here too; refreshes (token to token) do not reload.
  window.addEventListener('storage', (event) => {
    if (event.key === MOD_PROFILE.tokenKey && !event.oldValue !== !event.newValue) window.location.reload();
  });

  /* ---------- Chat log ---------- */

  const ctx: RenderContext = { emotes: createRegistry([]), badges: emptyBadgeIndex, t };
  const view = createApprovalView();
  let feedStatus: ModFeedStatus = { connected: false, error: '' };
  let ircState: StatusState | null = null;
  let roomId: string | null = null;

  const approvalNote = (): string => {
    if (feedStatus.error) return feedStatus.error;
    if (!feedStatus.connected) return 'Connecting to Ably …';
    return view.overlayOnline ? '' : 'Overlay is offline: clicks have no effect until it is open.';
  };

  const moderationNote = (): string => {
    if (!moderator) return CLIENT_ID ? 'Log in with Twitch to delete, time out or ban.' : 'Twitch login unavailable in this build.';
    if (!roomId) return 'Waiting for the chat …';
    return '';
  };

  const log = createModLog(chat, {
    ctx,
    state: () => ({
      view,
      approvalReady: feedStatus.connected && view.overlayOnline,
      approvalNote: approvalNote(),
      moderationNote: moderationNote(),
    }),
    onAction: (action, target, button) => void act(action, target, button),
  });

  function renderState(): void {
    const parts: [string, boolean, string][] = [
      ['Chat', ircState === 'ok', ircState === 'ok' ? `Connected to #${setup!.twitchChannel}` : 'Connecting to Twitch chat …'],
      ['Ably', feedStatus.connected && !feedStatus.error, feedStatus.error || (feedStatus.connected ? 'Connected' : 'Connecting …')],
      ['Overlay', view.overlayOnline, view.overlayOnline ? 'Overlay is open' : 'Overlay is offline'],
    ];
    stateEl.replaceChildren(
      ...parts.map(([label, ok, title]) => {
        const span = document.createElement('span');
        span.className = ok ? 'dot is-ok' : 'dot';
        span.title = title;
        span.append(document.createTextNode(label));
        return span;
      }),
    );
  }
  renderState();

  /* ---------- Actions ---------- */

  function flash(button: HTMLButtonElement, ok: boolean, message: string): void {
    button.dataset['flash'] = '1';
    button.classList.remove('is-ok', 'is-error');
    button.classList.add(ok ? 'is-ok' : 'is-error');
    button.title = message;
    window.setTimeout(
      () => {
        delete button.dataset['flash'];
        button.classList.remove('is-ok', 'is-error');
        log.refresh();
      },
      ok ? 2000 : 5000,
    );
  }

  let feed: ModFeed | null = null;

  async function act(action: ModAction, target: ActionTarget, button: HTMLButtonElement): Promise<void> {
    let run: () => Promise<void>;
    let done: string;

    if (action === 'trust' || action === 'approve') {
      if (!feed || !target.userId) {
        flash(button, false, 'Not connected to Ably.');
        return;
      }
      const ably = feed;
      if (action === 'approve') {
        run = () => ably.publish('approve-message', { messageId: target.messageId, userId: target.userId, login: target.login });
        done = 'Message approved';
      } else if (view.trusted.has(target.userId)) {
        run = () => ably.publish('untrust-user', { userId: target.userId, login: target.login });
        done = `${target.login} untrusted`;
      } else {
        run = () => ably.publish('trust-user', { userId: target.userId, login: target.login });
        done = `${target.login} trusted`;
      }
    } else {
      const mod = moderator;
      const room = roomId;
      if (!mod || !room) {
        flash(button, false, moderationNote());
        return;
      }
      if (action === 'ban' && !window.confirm(`Ban ${target.login} from #${setup!.twitchChannel}?`)) return;
      run = {
        delete: () => mod.deleteMessage(room, target.messageId),
        timeout: () => mod.timeout(room, target.userId),
        ban: () => mod.ban(room, target.userId),
      }[action];
      done = { delete: 'Message deleted', timeout: `${target.login} timed out`, ban: `${target.login} banned` }[action];
    }

    // Keeps refreshes from re-enabling it, so a slow request is not sent twice.
    button.dataset['busy'] = '1';
    button.disabled = true;
    try {
      await run();
      const note = action === 'trust' || action === 'approve' ? approvalNote() : '';
      flash(button, true, note ? `${done}\n${note}` : done);
    } catch (error) {
      const message = action === 'trust' || action === 'approve' ? describeAblyError(error) : (error as Error).message;
      flash(button, false, message);
      say(message);
    } finally {
      delete button.dataset['busy'];
      button.disabled = false;
    }
  }

  /* ---------- Connections ---------- */

  feed = connectModFeed({
    key: setup.ablyKey,
    channel: setup.ablyChannel,
    name: setup.name,
    view,
    onChange: () => {
      log.refresh();
      renderState();
    },
    onStatus: (status) => {
      feedStatus = status;
      log.refresh();
      renderState();
    },
  });

  const irc = createIrcSource({
    channel: setup.twitchChannel,
    emit: (event) => log.handle(event),
    onStatus: (state) => {
      ircState = state;
      renderState();
      if (state === 'ok') {
        log.handle({ id: `connected-${Date.now()}`, ts: Date.now(), type: 'notice', text: t.connected(setup.twitchChannel) });
      }
    },
    onRoomId: (id) => {
      if (roomId === id) return;
      roomId = id;
      log.refresh();
      // Lines from before keep their plain text; later ones get emotes and badges.
      void loadEmotes(id).then((sources) => {
        ctx.emotes = createRegistry(sources);
      });
      if (session) {
        void loadBadges({ clientId: CLIENT_ID, token, broadcasterId: id }).then((badges) => {
          ctx.badges = badges;
        });
      }
    },
  });
  await irc.connect().catch((error: unknown) => say(`Chat connection failed: ${String(error)}`));
}

void main().catch((error: unknown) => {
  console.error(error);
  document.body.append(document.createTextNode(`Mod view failed to start: ${String(error)}`));
});
