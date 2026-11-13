import { OVERLAY_CLIENT_ID } from '../approval/overlay-id';

export interface ApprovalEntry {
  login: string | null;
  /** Mod name; `null` if unknown. */
  by: string | null;
}

export interface IncomingMessage {
  name: unknown;
  data: unknown;
  clientId: unknown;
  connectionId: unknown;
}

/**
 * What the mod page knows about trusted users and approved messages. Same rules as the
 * userscript: `state` counts only from a connection that is present as the overlay.
 */
export interface ApprovalView {
  readonly trusted: ReadonlyMap<string, ApprovalEntry>;
  readonly approved: ReadonlyMap<string, ApprovalEntry>;
  readonly overlayOnline: boolean;
  /** `true` if the view changed. */
  apply(message: IncomingMessage): boolean;
  /** Messages may have been missed: the next presence update asks for the state again. */
  attached(): void;
  /** `true` if a new overlay connection showed up and the state should be requested. */
  presence(overlayConnections: string[]): boolean;
}

function byName(clientId: unknown): string | null {
  return typeof clientId === 'string' && clientId !== '' && clientId !== OVERLAY_CLIENT_ID ? clientId : null;
}

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

function entries(value: unknown): [string, Record<string, unknown> | null][] {
  const map = record(value);
  return map ? Object.entries(map).map(([id, entry]) => [id, record(entry)]) : [];
}

export function createApprovalView(): ApprovalView {
  const trusted = new Map<string, ApprovalEntry>();
  const approved = new Map<string, ApprovalEntry>();
  let overlayConnections = new Set<string>();

  return {
    trusted,
    approved,
    get overlayOnline() {
      return overlayConnections.size > 0;
    },

    apply(message) {
      const data = record(message.data);
      if (!data) return false;
      const by = byName(message.clientId);

      switch (message.name) {
        case 'state': {
          // Any mod key can claim the overlay's clientId, but only the overlay key can be present.
          if (
            message.clientId !== OVERLAY_CLIENT_ID ||
            typeof message.connectionId !== 'string' ||
            !overlayConnections.has(message.connectionId)
          ) {
            return false;
          }
          if (data['reset']) {
            trusted.clear();
            approved.clear();
          }
          for (const [id, entry] of entries(data['trusted'])) {
            trusted.set(id, { login: String(entry?.['login'] ?? ''), by: byName(entry?.['by']) });
          }
          for (const [id, entry] of entries(data['approved'])) {
            const login = entry?.['login'];
            approved.set(id, { login: login ? String(login) : null, by: byName(entry?.['by']) });
          }
          return true;
        }
        case 'trust-user':
          if (typeof data['userId'] !== 'string') return false;
          trusted.set(data['userId'], { login: String(data['login'] ?? ''), by });
          return true;
        case 'untrust-user':
          if (typeof data['userId'] !== 'string') return false;
          return trusted.delete(data['userId']);
        case 'approve-message': {
          const id = data['messageId'];
          if (typeof id !== 'string' || approved.has(id)) return false;
          approved.set(id, { login: data['login'] ? String(data['login']) : null, by });
          return true;
        }
        default:
          return false;
      }
    },

    attached() {
      overlayConnections = new Set();
    },

    presence(connections) {
      const known = overlayConnections;
      overlayConnections = new Set(connections);
      return connections.some((id) => !known.has(id));
    },
  };
}
