import * as Ably from 'ably';
import { OVERLAY_CLIENT_ID } from '../approval/overlay-id';
import type { ApprovalView } from './approval-view';

export interface ModFeedStatus {
  connected: boolean;
  /** Readable reason, empty while everything works. */
  error: string;
}

export interface ModFeed {
  publish(name: 'trust-user' | 'untrust-user' | 'approve-message', data: Record<string, string>): Promise<void>;
  close(): void;
}

export function describeAblyError(error: unknown): string {
  const err = error as { code?: number; message?: string } | null;
  const code = err?.code ?? 0;
  if (code === 40160) return 'Ably key lacks a capability (needs publish and subscribe on the channel).';
  if (code >= 40100 && code < 40200) return 'Ably key invalid or revoked. Ask the streamer for a new setup code.';
  return err?.message ? `Ably error: ${err.message}` : 'Ably not reachable.';
}

/**
 * The mod's side of the approval channel, like the userscript. Echo stays on: a mod's own
 * clicks come back and update the view like everyone else's.
 */
export function connectModFeed(opts: {
  key: string;
  channel: string;
  name: string;
  view: ApprovalView;
  onChange: () => void;
  onStatus: (status: ModFeedStatus) => void;
}): ModFeed {
  const client = new Ably.Realtime({ key: opts.key, clientId: opts.name || undefined });
  const channel = client.channels.get(opts.channel);
  const status: ModFeedStatus = { connected: false, error: '' };
  const report = (): void => opts.onStatus({ ...status });

  const fail = (error: unknown): void => {
    status.error = describeAblyError(error);
    report();
  };

  client.connection.on((change) => {
    status.connected = change.current === 'connected';
    if (status.connected) status.error = '';
    else if (change.reason) status.error = describeAblyError(change.reason);
    report();
  });

  // The mod key has no presence capability: only read it, never enter.
  function readPresence(): void {
    channel.presence
      .get()
      .then((members) => {
        const overlays = members
          .filter((member) => member.clientId === OVERLAY_CLIENT_ID)
          .map((member) => member.connectionId);
        const isNew = opts.view.presence(overlays);
        opts.onChange();
        // The overlay answers with its full state.
        if (isNew) channel.publish('sync-request', {}).catch(fail);
      })
      .catch(fail);
  }

  channel.on('attached', () => {
    opts.view.attached();
    readPresence();
  });

  channel
    .subscribe((message) => {
      const changed = opts.view.apply({
        name: message.name,
        data: message.data,
        clientId: message.clientId,
        connectionId: message.connectionId,
      });
      if (changed) opts.onChange();
    })
    .catch(fail);
  channel.presence.subscribe(readPresence).catch(fail);

  return {
    async publish(name, data) {
      if (!status.connected) throw new Error('Not connected to Ably yet.');
      await channel.publish(name, data);
    },
    close: () => client.close(),
  };
}
