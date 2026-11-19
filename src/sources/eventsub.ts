import { normalizeEventSub } from '../events/normalize-eventsub';
import type { OverlayEvent, StatusState } from '../events/types';
import { hostLog } from '../host/log';

const WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';
// Subscriptions can vanish without a revocation message, so verify them periodically.
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const KEEPALIVE_MARGIN_MS = 3000;
const RECONNECT_DELAY_MS = 5000;
const SEEN_LIMIT = 200;

export interface Topic {
  type: string;
  version: string;
  scope: string;
  condition(broadcasterId: string): Record<string, string>;
}

export const TOPICS: Topic[] = [
  {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    scope: 'channel:read:redemptions',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.follow',
    version: '2',
    scope: 'moderator:read:followers',
    condition: (id) => ({ broadcaster_user_id: id, moderator_user_id: id }),
  },
  {
    type: 'channel.hype_train.begin',
    version: '2',
    scope: 'channel:read:hype_train',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.hype_train.progress',
    version: '2',
    scope: 'channel:read:hype_train',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.hype_train.end',
    version: '2',
    scope: 'channel:read:hype_train',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.ad_break.begin',
    version: '1',
    scope: 'channel:read:ads',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.ban',
    version: '1',
    scope: 'channel:moderate',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.unban',
    version: '1',
    scope: 'channel:moderate',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
];

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface EventSubSource {
  connect(): void;
  close(): void;
}

interface Envelope {
  metadata?: { message_type?: string; message_id?: string; subscription_type?: string };
  payload?: {
    session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string };
    event?: Record<string, unknown>;
    subscription?: { type?: string };
  };
}

export function createEventSubSource(opts: {
  clientId: string;
  getToken: () => string;
  broadcasterId: string;
  grantedScopes: string[];
  emit: (event: OverlayEvent) => void;
  onStatus: (state: StatusState) => void;
  socketFactory?: SocketFactory;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  fetchFn?: typeof fetch;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  log?: (message: string) => void;
}): EventSubSource {
  const makeSocket = opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const schedule = opts.setTimeoutFn ?? setTimeout;
  const unschedule = opts.clearTimeoutFn ?? clearTimeout;
  const fetchFn = opts.fetchFn ?? fetch;
  const every = opts.setIntervalFn ?? setInterval;
  const unevery = opts.clearIntervalFn ?? clearInterval;
  const log = opts.log ?? hostLog;
  const wanted = TOPICS.filter((topic) => opts.grantedScopes.includes(topic.scope));

  let current: SocketLike | null = null;
  let pending: SocketLike | null = null;
  let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let sessionId = '';
  let keepaliveSeconds = 10;
  let checking = false;
  let stopped = false;
  const seen = new Set<string>();

  function armKeepalive(seconds: number): void {
    if (keepaliveTimer !== null) unschedule(keepaliveTimer);
    keepaliveTimer = schedule(() => {
      opts.onStatus('down');
      restart();
    }, seconds * 1000 + KEEPALIVE_MARGIN_MS);
  }

  function headers(): Record<string, string> {
    return {
      'Client-Id': opts.clientId,
      Authorization: `Bearer ${opts.getToken()}`,
      'Content-Type': 'application/json',
    };
  }

  /** Returns the HTTP status of every topic that failed (0 = network error). */
  async function subscribe(topics: Topic[], forSession: string): Promise<number[]> {
    const failures: number[] = [];
    for (const topic of topics) {
      let status = 0;
      try {
        const res = await fetchFn(SUBSCRIPTIONS_URL, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            type: topic.type,
            version: topic.version,
            condition: topic.condition(opts.broadcasterId),
            transport: { method: 'websocket', session_id: forSession },
          }),
        });
        status = res.status;
      } catch {
        // One failed topic must not block the others.
      }
      // 409: already subscribed on this session.
      if ((status >= 200 && status < 300) || status === 409) continue;
      failures.push(status);
      log(`EventSub subscribe ${topic.type} failed: HTTP ${status}`);
    }
    if (forSession === sessionId) opts.onStatus(failures.length === 0 ? 'ok' : 'down');
    return failures;
  }

  /** Types enabled on the given session, or null if the list could not be read. */
  async function activeTypes(forSession: string): Promise<Set<string> | null> {
    const types = new Set<string>();
    let cursor = '';
    do {
      const url = `${SUBSCRIPTIONS_URL}?status=enabled${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
      let body: {
        data?: { type?: string; transport?: { session_id?: string } }[];
        pagination?: { cursor?: string };
      };
      try {
        const res = await fetchFn(url, { headers: headers() });
        if (!res.ok) {
          log(`EventSub subscription check failed: HTTP ${res.status}`);
          return null;
        }
        body = (await res.json()) as typeof body;
      } catch {
        return null;
      }
      for (const sub of body.data ?? []) {
        if (sub.transport?.session_id === forSession && sub.type) types.add(sub.type);
      }
      cursor = body.pagination?.cursor ?? '';
    } while (cursor);
    return types;
  }

  async function check(): Promise<void> {
    const forSession = sessionId;
    if (stopped || checking || !forSession) return;
    checking = true;
    try {
      const active = await activeTypes(forSession);
      if (!active || forSession !== sessionId) return;
      const missing = wanted.filter((topic) => !active.has(topic.type));
      if (missing.length === 0) return;

      log(`EventSub resubscribing: ${missing.map((topic) => topic.type).join(', ')}`);
      const failures = await subscribe(missing, forSession);
      // Twitch answers 400 when the session itself is gone; a fresh socket subscribes everything again.
      if (forSession === sessionId && failures.length === missing.length && failures.every((s) => s === 400)) {
        log('EventSub session looks dead, reconnecting');
        restart();
      }
    } finally {
      checking = false;
    }
  }

  function scheduleAdEnd(begin: Extract<OverlayEvent, { type: 'adbreak' }>): void {
    schedule(
      () => opts.emit({ ...begin, id: `${begin.id}-end`, ts: Date.now(), phase: 'end' }),
      Math.max(0, begin.endsAt - Date.now()),
    );
  }

  function remember(messageId: string): boolean {
    if (seen.has(messageId)) return false;
    seen.add(messageId);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
    return true;
  }

  function handle(socket: SocketLike, raw: string): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }

    const type = envelope.metadata?.message_type;
    const messageId = envelope.metadata?.message_id ?? '';

    if (type === 'session_welcome') {
      const session = envelope.payload?.session;
      keepaliveSeconds = session?.keepalive_timeout_seconds ?? 10;
      armKeepalive(keepaliveSeconds);
      sessionId = session?.id ?? '';

      if (socket === pending) {
        // Let the new socket be confirmed first, then close the old one.
        current?.close();
        current = pending;
        pending = null;
        return;
      }

      current = socket;
      void subscribe(wanted, sessionId);
      return;
    }

    if (type === 'session_keepalive') {
      armKeepalive(keepaliveSeconds);
      return;
    }

    if (type === 'session_reconnect') {
      const url = envelope.payload?.session?.reconnect_url;
      if (!url) return;
      pending = open(url);
      return;
    }

    if (type === 'revocation') {
      opts.onStatus('down');
      log(`EventSub revoked: ${envelope.payload?.subscription?.type ?? '?'}`);
      void check();
      return;
    }

    if (type === 'notification') {
      // Twitch skips keepalives while notifications flow.
      armKeepalive(keepaliveSeconds);
      if (!remember(messageId)) return;
      const event = normalizeEventSub(
        envelope.metadata?.subscription_type ?? '',
        envelope.payload?.event ?? {},
        messageId,
      );
      if (event) opts.emit(event);
      if (event?.type === 'adbreak') scheduleAdEnd(event);
    }
  }

  function open(url: string): SocketLike {
    const socket = makeSocket(url);
    socket.onmessage = (ev) => handle(socket, ev.data);
    socket.onclose = () => {
      if (stopped || socket !== current) return;
      opts.onStatus('down');
      schedule(restart, RECONNECT_DELAY_MS);
    };
    socket.onerror = () => opts.onStatus('down');
    return socket;
  }

  function restart(): void {
    if (stopped) return;
    sessionId = '';
    current?.close();
    current = open(WS_URL);
  }

  return {
    connect() {
      stopped = false;
      current = open(WS_URL);
      if (checkTimer === null) checkTimer = every(() => void check(), CHECK_INTERVAL_MS);
    },
    close() {
      stopped = true;
      if (keepaliveTimer !== null) unschedule(keepaliveTimer);
      if (checkTimer !== null) unevery(checkTimer);
      checkTimer = null;
      sessionId = '';
      current?.close();
      pending?.close();
      current = null;
      pending = null;
    },
  };
}
