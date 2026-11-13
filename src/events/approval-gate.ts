import type { ApprovalCommand } from '../approval/commands';
import { isModerator } from './chat-delay';
import type { ChatEvent, OverlayEvent } from './types';

export interface TrustList {
  has(userId: string): boolean;
  add(userId: string, login: string, by?: string | null): void;
  remove(userId: string): void;
}

export interface ApprovalGate {
  handle(event: OverlayEvent): void;
  command(command: ApprovalCommand): void;
  /** For users that became trusted without a command, e.g. once the stored list has loaded. */
  releaseTrusted(): void;
}

/**
 * Holds chat from non-mods until a mod trusts the user or approves the single message.
 * Approvals are not stored anywhere: a held message that ages out is gone.
 */
export function createApprovalGate(opts: {
  emit: (event: OverlayEvent) => void;
  trust: TrustList;
  onHeld?: (event: ChatEvent) => void;
  now?: () => number;
  maxHeld?: number;
  maxAgeMs?: number;
  /** How long an approval waits for a message that has not arrived yet. */
  earlyApprovalMs?: number;
  maxEarlyApprovals?: number;
}): ApprovalGate {
  const now = opts.now ?? Date.now;
  const maxHeld = opts.maxHeld ?? 500;
  const maxAgeMs = opts.maxAgeMs ?? 30 * 60_000;
  const earlyApprovalMs = opts.earlyApprovalMs ?? 2 * 60_000;
  const maxEarlyApprovals = opts.maxEarlyApprovals ?? 500;

  let held: { event: ChatEvent; at: number }[] = [];
  // Insertion order equals expiry order, so pruning can stop at the first live entry.
  const earlyApprovals = new Map<string, number>();

  function prune(): void {
    const at = now();
    while (held.length > 0 && at - held[0]!.at >= maxAgeMs) held.shift();
    for (const [id, expires] of earlyApprovals) {
      if (expires > at) break;
      earlyApprovals.delete(id);
    }
  }

  function trusted(event: ChatEvent): boolean {
    return event.author.id !== '' && opts.trust.has(event.author.id);
  }

  function release(predicate: (event: ChatEvent) => boolean): void {
    const out = held.filter((entry) => predicate(entry.event));
    if (out.length === 0) return;
    held = held.filter((entry) => !predicate(entry.event));
    for (const entry of out) opts.emit(entry.event);
  }

  function drop(predicate: (event: ChatEvent) => boolean): void {
    held = held.filter((entry) => !predicate(entry.event));
  }

  return {
    handle(event) {
      prune();

      if (event.type === 'chat') {
        if (isModerator(event.author) || trusted(event)) {
          opts.emit(event);
        } else if (earlyApprovals.delete(event.id)) {
          opts.emit(event);
        } else {
          held.push({ event, at: now() });
          if (held.length > maxHeld) held.shift();
          opts.onHeld?.(event);
        }
        return;
      }

      if (event.type === 'delete') drop((chat) => chat.id === event.targetId);
      if (event.type === 'clear') {
        drop((chat) => event.targetLogin === null || chat.author.login === event.targetLogin);
      }
      opts.emit(event);
    },

    command(command) {
      prune();

      switch (command.type) {
        case 'trust-user':
          opts.trust.add(command.userId, command.login, command.by);
          release((chat) => chat.author.id === command.userId);
          break;
        case 'untrust-user':
          opts.trust.remove(command.userId);
          break;
        case 'approve-message': {
          const before = held.length;
          release((chat) => chat.id === command.messageId);
          if (held.length !== before) break;
          earlyApprovals.delete(command.messageId);
          earlyApprovals.set(command.messageId, now() + earlyApprovalMs);
          if (earlyApprovals.size > maxEarlyApprovals) {
            earlyApprovals.delete(earlyApprovals.keys().next().value!);
          }
          break;
        }
        case 'sync-request':
          break;
      }
    },

    releaseTrusted() {
      prune();
      release(trusted);
    },
  };
}
