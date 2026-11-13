import { normalizeEventSub } from '../events/normalize-eventsub';
import type { OverlayEvent, StatusState } from '../events/types';

const WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
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
    version: '1',
    scope: 'channel:read:hype_train',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.hype_train.progress',
    version: '1',
    scope: 'channel:read:hype_train',
    condition: (id) => ({ broadcaster_user_id: id }),
  },
  {
    type: 'channel.hype_train.end',
    version: '1',
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
}): EventSubSource {
  const makeSocket = opts.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const schedule = opts.setTimeoutFn ?? setTimeout;
  const unschedule = opts.clearTimeoutFn ?? clearTimeout;
  const fetchFn = opts.fetchFn ?? fetch;
  const wanted = TOPICS.filter((topic) => opts.grantedScopes.includes(topic.scope));

  let current: SocketLike | null = null;
  let pending: SocketLike | null = null;
  let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const seen = new Set<string>();

  function armKeepalive(seconds: number): void {
    if (keepaliveTimer !== null) unschedule(keepaliveTimer);
    keepaliveTimer = schedule(() => {
      opts.onStatus('down');
      restart();
    }, seconds * 1000 + KEEPALIVE_MARGIN_MS);
  }

  async function subscribe(sessionId: string): Promise<void> {
    for (const topic of wanted) {
      try {
        await fetchFn('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: {
            'Client-Id': opts.clientId,
            Authorization: `Bearer ${opts.getToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: topic.type,
            version: topic.version,
            condition: topic.condition(opts.broadcasterId),
            transport: { method: 'websocket', session_id: sessionId },
          }),
        });
      } catch {
        // One failed topic must not block the others.
      }
    }
    opts.onStatus('ok');
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
      armKeepalive(session?.keepalive_timeout_seconds ?? 10);

      if (socket === pending) {
        // Let the new socket be confirmed first, then close the old one.
        current?.close();
        current = pending;
        pending = null;
        return;
      }

      current = socket;
      void subscribe(session?.id ?? '');
      return;
    }

    if (type === 'session_keepalive') {
      armKeepalive(10);
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
      return;
    }

    if (type === 'notification') {
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
    current?.close();
    current = open(WS_URL);
  }

  return {
    connect() {
      stopped = false;
      current = open(WS_URL);
    },
    close() {
      stopped = true;
      if (keepaliveTimer !== null) unschedule(keepaliveTimer);
      current?.close();
      pending?.close();
      current = null;
      pending = null;
    },
  };
}
