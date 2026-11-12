import type { TrustList } from '../events/approval-gate';
import { hostLog } from '../host/log';
import { LOGIN_RE } from './commands';

export interface TrustedUser {
  login: string;
  trustedAt: string;
  /** Mod name from the setup code, if the mod had one. */
  trustedBy?: string;
}

export interface TrustStore extends TrustList {
  /** Never rejects; `false` if the stored list could not be loaded. */
  load(): Promise<boolean>;
  /** Saves pending changes; `keepalive` lets the request outlive the page. */
  flush(opts?: { keepalive?: boolean }): Promise<void>;
  /** Starts the periodic save (and load retry while the list is not loaded). */
  start(): void;
  /** Logins of all trusted users, sorted. */
  logins(): string[];
  entries(): [userId: string, user: TrustedUser][];
}

const USER_ID_RE = /^\d{1,20}$/;
// Same rules as the trust worker: an entry it rejects would fail every save that contains it.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_NAME_LENGTH = 100;

function parseUsers(data: unknown): Map<string, TrustedUser> | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as { users?: unknown }).users;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const users = new Map<string, TrustedUser>();
  for (const [userId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!USER_ID_RE.test(userId) || typeof entry !== 'object' || entry === null) continue;
    const { login, trustedAt, trustedBy } = entry as Record<string, unknown>;
    if (typeof login !== 'string' || !LOGIN_RE.test(login)) continue;
    if (typeof trustedAt !== 'string' || !TIMESTAMP_RE.test(trustedAt) || Number.isNaN(Date.parse(trustedAt))) continue;
    const named = typeof trustedBy === 'string' && trustedBy.length <= MAX_NAME_LENGTH;
    users.set(userId, named ? { login, trustedAt, trustedBy } : { login, trustedAt });
  }
  return users;
}

/**
 * Trusted users of one channel. With an endpoint, the list is loaded once and its changes are
 * saved at most once per interval; without one it lives in memory only.
 */
export function createTrustStore(opts: {
  endpoint: { url: string; secret: string } | null;
  channel: string;
  /** Called after the stored list has loaded, so held messages of those users can go out. */
  onLoaded?: () => void;
  intervalMs?: number;
  fetchFn?: typeof fetch;
  setIntervalFn?: typeof setInterval;
  now?: () => number;
  log?: (message: string) => void;
}): TrustStore {
  const fetchFn = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const every = opts.setIntervalFn ?? setInterval;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? hostLog;
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  const endpoint = opts.endpoint;
  const url = endpoint ? `${endpoint.url}/trusted/${encodeURIComponent(opts.channel.toLowerCase())}` : '';
  const headers: Record<string, string> = endpoint ? { Authorization: `Bearer ${endpoint.secret}` } : {};

  let users = new Map<string, TrustedUser>();
  let loaded = endpoint === null;
  let loading: Promise<boolean> | null = null;
  // Unsaved change per user (`null`: removed). Replayed on top of the loaded list and saved as a
  // delta, so an overlay with an outdated list cannot bring back users another one removed.
  const unsaved = new Map<string, TrustedUser | null>();
  let saving = false;

  function apply(userId: string, user: TrustedUser | null): void {
    if (user) users.set(userId, user);
    else users.delete(userId);
  }

  function change(userId: string, user: TrustedUser | null): void {
    apply(userId, user);
    if (endpoint) unsaved.set(userId, user);
  }

  async function fetchList(): Promise<boolean> {
    try {
      const response = await fetchFn(url, { headers, cache: 'no-store' });
      if (!response.ok) {
        log(`trusted users: load failed with HTTP ${response.status}`);
        return false;
      }
      const remote = parseUsers(await response.json());
      if (!remote) {
        log('trusted users: load returned an unexpected body');
        return false;
      }

      users = remote;
      for (const [userId, user] of unsaved) apply(userId, user);
      loaded = true;
      opts.onLoaded?.();
      return true;
    } catch (error) {
      log(`trusted users: load failed: ${String(error)}`);
      return false;
    }
  }

  const store: TrustStore = {
    has(userId) {
      return users.has(userId);
    },

    add(userId, login, by) {
      const current = users.get(userId);
      if (current?.login === login) return;
      const user: TrustedUser = { login, trustedAt: current?.trustedAt ?? new Date(now()).toISOString() };
      const trustedBy = current?.trustedBy ?? by;
      if (trustedBy) user.trustedBy = trustedBy;
      change(userId, user);
    },

    remove(userId) {
      if (!users.has(userId) && loaded) return;
      change(userId, null);
    },

    load() {
      if (loaded) return Promise.resolve(true);
      loading ??= fetchList().finally(() => {
        loading = null;
      });
      return loading;
    },

    async flush({ keepalive = false } = {}) {
      if (!endpoint || !loaded || saving || unsaved.size === 0) return;
      const sent = new Map(unsaved);
      const set: Record<string, TrustedUser> = {};
      const remove: string[] = [];
      for (const [userId, user] of sent) {
        if (user) set[userId] = user;
        else remove.push(userId);
      }
      saving = true;
      try {
        const response = await fetchFn(url, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ set, remove }),
          keepalive,
        });
        if (!response.ok) {
          log(`trusted users: save failed with HTTP ${response.status}`);
          return;
        }
        // A user changed again during the request stays unsaved.
        for (const [userId, user] of sent) {
          if (unsaved.get(userId) === user) unsaved.delete(userId);
        }
      } catch (error) {
        log(`trusted users: save failed: ${String(error)}`);
      } finally {
        saving = false;
      }
    },

    entries() {
      return [...users.entries()];
    },

    logins() {
      return [...users.values()].map((user) => user.login).sort((a, b) => a.localeCompare(b));
    },

    start() {
      if (!endpoint) return;
      every(() => {
        if (loaded) void store.flush();
        else void store.load();
      }, intervalMs);
    },
  };

  return store;
}
