/** `by` is the publisher's Ably `clientId` (the mod name from the setup code), if any. */
export type ApprovalCommand =
  | { type: 'trust-user'; userId: string; login: string; by: string | null }
  | { type: 'untrust-user'; userId: string; login: string; by: string | null }
  | { type: 'approve-message'; messageId: string; login: string | null; by: string | null }
  /** A mod's userscript connected and wants the current state. */
  | { type: 'sync-request' };

// Same rule as the trust worker, so a save with this ID is never rejected.
const USER_ID_RE = /^\d{1,20}$/;
/** Twitch login. Same rule as the trust worker, see `USER_ID_RE`. */
export const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const MAX_LENGTH = 100;

function record(data: unknown): Record<string, unknown> | null {
  // Depending on how the publisher encodes it, `data` arrives as object or JSON string.
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function shortString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value.length <= MAX_LENGTH ? value : null;
}

function loginOf(value: unknown): string | null {
  const login = typeof value === 'string' ? value.toLowerCase() : '';
  return LOGIN_RE.test(login) ? login : null;
}

/** Returns `null` for anything that does not match the shared contract. */
export function parseApprovalCommand(name: unknown, data: unknown, clientId?: unknown): ApprovalCommand | null {
  if (name === 'sync-request') return { type: name };

  const body = record(data);
  if (!body) return null;
  const by = shortString(clientId);

  if (name === 'trust-user' || name === 'untrust-user') {
    const userId = body['userId'];
    const login = loginOf(body['login']);
    if (typeof userId !== 'string' || !USER_ID_RE.test(userId) || !login) return null;
    return { type: name, userId, login, by };
  }

  if (name === 'approve-message') {
    // The message ID alone identifies it; the login is only for the notice.
    const messageId = shortString(body['messageId']);
    return messageId ? { type: name, messageId, login: loginOf(body['login']), by } : null;
  }

  return null;
}
