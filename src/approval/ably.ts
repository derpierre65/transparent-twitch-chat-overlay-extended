import * as Ably from 'ably';
import type { StatusState } from '../events/types';
import { hostLog } from '../host/log';
import { parseApprovalCommand, type ApprovalCommand } from './commands';
import type { StatePart } from './state';

/** Presence and `state` messages carry this clientId, so userscripts can tell the overlay apart. */
export const OVERLAY_CLIENT_ID = 'overlay';

export interface ApprovalFeed {
  publishState(parts: StatePart[]): void;
  close(): void;
}

/**
 * Subscribes to the mods' clicks, answers their sync requests and is present on the channel
 * while open. The key needs `subscribe`, `publish` and `presence` on the channel.
 */
export function connectApprovalFeed(opts: {
  key: string;
  channel: string;
  onCommand: (command: ApprovalCommand) => void;
  onStatus: (state: StatusState) => void;
  log?: (message: string) => void;
}): ApprovalFeed {
  const log = opts.log ?? hostLog;
  const client = new Ably.Realtime({ key: opts.key, clientId: OVERLAY_CLIENT_ID, echoMessages: false });
  const channel = client.channels.get(opts.channel);

  client.connection.on((change) => {
    if (change.current === 'connected') opts.onStatus('ok');
    if (change.current === 'disconnected' || change.current === 'suspended' || change.current === 'failed') {
      opts.onStatus('down');
      if (change.reason) log(`ably ${change.current}: ${change.reason.message}`);
    }
  });

  channel
    .subscribe((message) => {
      const command = parseApprovalCommand(message.name, message.data, message.clientId);
      if (command) opts.onCommand(command);
      else if (message.name !== 'state') log(`ably: ignored message ${String(message.name)}`);
    })
    .catch((error: unknown) => log(`ably subscribe failed: ${String(error)}`));

  // Ably re-enters presence by itself after a reconnect.
  channel.presence.enter().catch((error: unknown) => log(`ably presence failed (key needs presence): ${String(error)}`));

  return {
    publishState(parts) {
      for (const part of parts) {
        channel
          .publish('state', part)
          .catch((error: unknown) => log(`ably publish failed (key needs publish): ${String(error)}`));
      }
    },
    close: () => client.close(),
  };
}
