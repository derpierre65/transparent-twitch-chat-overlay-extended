/** What the overlay tells the mods' userscripts on connect and on `sync-request`. */
export interface StatePart {
  /** `true` on the first part: the receiver drops its old state. */
  reset: boolean;
  trusted: Record<string, { login: string; by: string | null }>;
  approved: Record<string, { login: string | null; by: string | null }>;
}

// Below Ably's 64 KiB message limit, with room for the envelope.
const MAX_PART_BYTES = 48_000;

/** Splits the state into parts that each fit into one Ably message. */
export function splitState(
  trusted: [string, { login: string; by: string | null }][],
  approved: [string, { login: string | null; by: string | null }][],
  maxBytes = MAX_PART_BYTES,
): StatePart[] {
  const parts: StatePart[] = [];
  let part: StatePart = { reset: true, trusted: {}, approved: {} };
  let size = JSON.stringify(part).length;

  const add = (key: 'trusted' | 'approved', id: string, value: object): void => {
    const entry = JSON.stringify(id).length + JSON.stringify(value).length + 2;
    if (size + entry > maxBytes && size > JSON.stringify({ reset: false, trusted: {}, approved: {} }).length) {
      parts.push(part);
      part = { reset: false, trusted: {}, approved: {} };
      size = JSON.stringify(part).length;
    }
    (part[key] as Record<string, object>)[id] = value;
    size += entry;
  };

  for (const [id, value] of trusted) add('trusted', id, value);
  for (const [id, value] of approved) add('approved', id, value);
  parts.push(part);
  return parts;
}

export interface ApprovalLog {
  /** `false` if the message was already approved. */
  add(messageId: string, entry: { login: string | null; by: string | null }): boolean;
  entries(): [string, { login: string | null; by: string | null }][];
}

/** Recent single-message approvals, so mods connecting later see them too. */
export function createApprovalLog(opts: { now?: () => number; maxAgeMs?: number; max?: number } = {}): ApprovalLog {
  const now = opts.now ?? Date.now;
  const maxAgeMs = opts.maxAgeMs ?? 30 * 60_000;
  const max = opts.max ?? 500;
  // Insertion order equals expiry order.
  const log = new Map<string, { login: string | null; by: string | null; at: number }>();

  function prune(): void {
    const at = now();
    for (const [id, entry] of log) {
      if (at - entry.at < maxAgeMs && log.size <= max) break;
      log.delete(id);
    }
  }

  return {
    add(messageId, entry) {
      prune();
      if (log.has(messageId)) return false;
      log.set(messageId, { ...entry, at: now() });
      prune();
      return true;
    },
    entries() {
      prune();
      return [...log].map(([id, { login, by }]) => [id, { login, by }]);
    },
  };
}
