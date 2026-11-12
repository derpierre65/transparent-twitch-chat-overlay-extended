import { startDeviceLogin } from './auth/device';
import { withLock } from './auth/locks';
import { SCOPES, TOKEN_KEY, clearLegacyKeys, readIdentity, validateToken, writeIdentity, type Identity } from './auth/oauth';
import { createTokenRefresher, type TokenRefresher } from './auth/refresh';
import { authenticate, type Session } from './auth/session';
import { emptyBadgeIndex, loadBadges, type BadgeIndex } from './badges/badges';
import { CLIENT_ID } from './client-id';
import type { ApprovalCommand } from './approval/commands';
import { createApprovalLog, splitState } from './approval/state';
import { createTrustStore } from './approval/trust-store';
import { parseConfig, type ApprovalConfig } from './config';
import { MESSAGES, type Messages } from './i18n';
import { playDemo } from './demo/fixtures';
import { createRegistry } from './emotes/registry';
import { loadEmotes } from './emotes/providers';
import { createApprovalGate, type ApprovalGate } from './events/approval-gate';
import { createBus } from './events/bus';
import { createChatDelay } from './events/chat-delay';
import type { OverlayEvent } from './events/types';
import { hostLog } from './host/log';
import { createSoundPlayer } from './host/sound';
import { createChatLog } from './render/chat-log';
import { createLoginView } from './render/login';
import { createStatusPill, type StatusPill } from './render/status';
import { fetchChatDelay } from './sources/chat-settings';
import { createEventSubSource } from './sources/eventsub';
import { createIrcSource } from './sources/irc';

const VALIDATE_INTERVAL_MS = 60 * 60 * 1000;
// Refresh before expiry so an EventSub reconnect never sees an expired token.
const REFRESH_MARGIN_S = 15 * 60;
const RETRY_MS = 30_000;
// Twitch does not report chat delay changes via EventSub, so poll.
const CHAT_DELAY_POLL_MS = 60_000;
const CHAT_DELAY_WAIT_MS = 3_000;
const TRUST_WAIT_MS = 3_000;

async function main(): Promise<void> {
  const config = parseConfig(window.location.search);
  const t = MESSAGES[config.language];
  document.documentElement.lang = config.language;
  const storage = window.localStorage;
  const root = document.getElementById('log');
  const statusEl = document.getElementById('status');
  if (!root || !statusEl) throw new Error('overlay markup missing');

  if (!CLIENT_ID) hostLog('VITE_TWITCH_CLIENT_ID is empty — login and EventSub stay off.');

  clearLegacyKeys(storage);
  // Do not leave old handoff URLs (#token=…) in the address bar.
  if (window.location.hash !== '') {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  const status = createStatusPill(statusEl);
  const refresher = createTokenRefresher({ clientId: CLIENT_ID, storage });

  let loginOpen = false;
  const openLogin = (): void => {
    if (loginOpen) return;
    loginOpen = true;

    const view = createLoginView(document.body, t.login);
    if (!CLIENT_ID) {
      view.setStatus(t.login.missingClientId);
      return;
    }
    view.setStatus(t.login.requesting);

    // If another overlay window completes the login, its token applies here too.
    window.addEventListener('storage', (event) => {
      if (event.key === TOKEN_KEY && event.newValue) window.location.reload();
    });

    void withLock(
      'overlay.device',
      // Lock is held until reload so only one window requests codes.
      () =>
        new Promise<void>(() => {
          startDeviceLogin({
            clientId: CLIENT_ID,
            storage,
            onCode: (code) => view.showCode(code),
            onStatus: (state) => view.setStatus(t.login[state]),
            onSuccess: () => window.location.reload(),
          });
        }),
      () => view.setStatus(t.login.busy),
    );
  };
  status.onClick(openLogin);

  const auth = await authenticate({ storage, refresher });
  const session = auth.status === 'ok' ? auth.value : null;
  if (session) writeIdentity(storage, { login: session.validation.login, userId: session.validation.userId });
  status.set('token', session ? 'ok' : 'down');

  // Before badges and emotes: their services can be slow and must not hold up the login.
  if (!config.demo) {
    // New scopes need consent once; until then everything keeps running on the old token.
    const missingScope = session !== null && SCOPES.some((scope) => !session.validation.scopes.includes(scope));
    if (auth.status === 'rejected' || missingScope) openLogin();
    if (auth.status === 'unreachable') retryAuthentication(storage, refresher, openLogin);
  }

  // The channel always comes from the token; offline from the cached last login.
  const identity: Identity | null = session
    ? { login: session.validation.login, userId: session.validation.userId }
    : readIdentity(storage);
  const channel = identity?.login || null;

  const badges: BadgeIndex = session
    ? await loadBadges({ clientId: CLIENT_ID, token: session.token, broadcasterId: session.validation.userId })
    : emptyBadgeIndex;

  const emotes = createRegistry(identity?.userId ? await loadEmotes(identity.userId) : []);

  const bus = createBus();
  const sound = createSoundPlayer();
  const log = createChatLog(root, { maxLines: config.maxLines, fade: config.fade, ctx: { emotes, badges, t } });

  bus.on((event: OverlayEvent) => {
    try {
      if (log.handle(event) && !(event.type === 'notice' && event.silent)) sound.play();
    } catch (error) {
      hostLog(`render failed for ${event.type}: ${String(error)}`);
    }
  });

  if (config.demo) {
    playDemo((event) => bus.emit(event));
    return;
  }

  const chatDelay = createChatDelay({ emit: (event) => bus.emit(event) });
  // Gate before the delay, so released messages still wait out Twitch's chat delay.
  const notifyApproval = (text: string): void =>
    bus.emit({ id: `approval-${Date.now()}-${Math.random()}`, ts: Date.now(), type: 'notice', text, silent: true });
  const approval =
    config.approval && channel
      ? startApproval(config.approval, channel, status, t, (event) => chatDelay.handle(event), notifyApproval)
      : null;
  const intake = approval?.gate ?? chatDelay;

  if (session) {
    const getToken = startEventSub(session, refresher, status, bus.emit);
    const syncChatDelay = async (): Promise<void> => {
      const seconds = await fetchChatDelay({
        clientId: CLIENT_ID,
        token: getToken(),
        broadcasterId: session.validation.userId,
      });
      if (seconds !== null) chatDelay.setSeconds(seconds);
    };
    // Before connecting to chat, otherwise the first messages slip through undelayed.
    await Promise.race([syncChatDelay(), new Promise((resolve) => window.setTimeout(resolve, CHAT_DELAY_WAIT_MS))]);
    window.setInterval(() => void syncChatDelay(), CHAT_DELAY_POLL_MS);
  }

  if (channel) {
    // Otherwise messages of already trusted users wait in the gate until the list arrives.
    if (approval) await Promise.race([approval.ready, new Promise((resolve) => window.setTimeout(resolve, TRUST_WAIT_MS))]);

    const irc = createIrcSource({
      channel,
      emit: (event) => intake.handle(event),
      onStatus: (state) => {
        status.set('irc', state);
        // Visible confirmation in the overlay, also after every reconnect.
        if (state === 'ok') {
          bus.emit({
            id: `connected-${Date.now()}`,
            ts: Date.now(),
            type: 'notice',
            text: t.connected(channel),
          });
        }
      },
    });
    await irc.connect();
  }
}

function startApproval(
  approval: ApprovalConfig,
  channel: string,
  status: StatusPill,
  t: Messages,
  emit: (event: OverlayEvent) => void,
  notify: (text: string) => void,
): { gate: ApprovalGate; ready: Promise<boolean> } {
  if (!approval.trust) hostLog('trustUrl/trustSecret not set — trusted users are kept in memory only.');

  const trust = createTrustStore({
    endpoint: approval.trust,
    channel,
    onLoaded: () => gate.releaseTrusted(),
  });
  const gate = createApprovalGate({ emit, trust });
  const approvals = createApprovalLog();
  const ready = trust.load();
  trust.start();
  window.addEventListener('pagehide', () => void trust.flush({ keepalive: true }));

  const state = () =>
    splitState(
      trust.entries().map(([id, user]) => [id, { login: user.login, by: user.trustedBy ?? null }]),
      approvals.entries(),
    );

  function onCommand(command: ApprovalCommand, publishState: () => void): void {
    if (command.type === 'sync-request') {
      void ready.then(publishState);
      return;
    }

    const wasTrusted = command.type !== 'approve-message' && trust.has(command.userId);
    gate.command(command);
    if (command.type === 'trust-user' && !wasTrusted) notify(t.approvalTrusted(command.login, command.by));
    if (command.type === 'untrust-user' && wasTrusted) notify(t.approvalUntrusted(command.login, command.by));
    if (command.type === 'approve-message' && approvals.add(command.messageId, command)) {
      notify(t.approvalApproved(command.login, command.by));
    }
  }

  // Loaded on demand so overlays without the feature do not download the Ably client.
  import('./approval/ably')
    .then(({ connectApprovalFeed }) => {
      const feed = connectApprovalFeed({
        key: approval.ablyKey,
        channel: approval.ablyChannel,
        onCommand: (command) => onCommand(command, () => feed.publishState(state())),
        onStatus: (connection) => {
          status.set('approval', connection);
          if (connection !== 'ok') return;
          // Also after every reconnect: confirms the feature is on and resyncs connected mods.
          void ready.then((loaded) => {
            notify(t.approvalActive(trust.logins(), !approval.trust ? 'memory' : loaded ? 'saved' : 'unloaded'));
            feed.publishState(state());
          });
        },
      });
    })
    .catch((error: unknown) => {
      hostLog(`approval feed failed: ${String(error)}`);
      status.set('approval', 'down');
    });

  return { gate, ready };
}

/** Twitch was unreachable at boot: keep trying, reload on success. */
function retryAuthentication(
  storage: Storage,
  refresher: TokenRefresher,
  openLogin: () => void,
): void {
  window.setTimeout(() => {
    void authenticate({ storage, refresher }).then((result) => {
      if (result.status === 'ok') window.location.reload();
      else if (result.status === 'rejected') openLogin();
      else retryAuthentication(storage, refresher, openLogin);
    });
  }, RETRY_MS);
}

function startEventSub(
  session: Session,
  refresher: TokenRefresher,
  status: StatusPill,
  emit: (event: OverlayEvent) => void,
): () => string {
  let token = session.token;

  const eventsub = createEventSubSource({
    clientId: CLIENT_ID,
    getToken: () => token,
    broadcasterId: session.validation.userId,
    grantedScopes: session.validation.scopes,
    emit,
    onStatus: (state) => status.set('eventsub', state),
  });
  eventsub.connect();

  const schedule = (ms: number): void => {
    window.setTimeout(() => void check(), ms);
  };
  const untilRefresh = (expiresIn: number): number =>
    Math.max(RETRY_MS, Math.min(VALIDATE_INTERVAL_MS, (expiresIn - REFRESH_MARGIN_S) * 1000));

  // Twitch requires hourly validation; on rejection drop only EventSub, chat keeps running.
  async function check(): Promise<void> {
    const checked = await validateToken(token);
    if (checked.status === 'ok' && checked.value.expiresIn > REFRESH_MARGIN_S) {
      schedule(untilRefresh(checked.value.expiresIn));
      return;
    }
    if (checked.status === 'unreachable') {
      schedule(RETRY_MS);
      return;
    }

    const refreshed = await refresher.refresh(token);
    if (refreshed.status === 'ok') {
      token = refreshed.value;
      status.set('token', 'ok');
      schedule(RETRY_MS);
      return;
    }
    if (refreshed.status === 'unreachable') {
      schedule(RETRY_MS);
      return;
    }

    eventsub.close();
    status.set('token', 'down');
    status.set('eventsub', 'down');
  }

  schedule(untilRefresh(session.validation.expiresIn));
  return () => token;
}

void main().catch((error: unknown) => hostLog(`bootstrap failed: ${String(error)}`));
