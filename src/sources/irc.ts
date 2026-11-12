import tmi from 'tmi.js';
import { normalizeChat, normalizeUserNotice, type IrcTags } from '../events/normalize-irc';
import type { OverlayEvent, StatusState } from '../events/types';

export interface TmiLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

export type ClientFactory = (channel: string) => TmiLike;

// Without identity tmi.js connects anonymously as justinfan<random>.
const defaultFactory: ClientFactory = (channel) =>
  new tmi.Client({
    channels: [channel],
    connection: { reconnect: true, secure: true },
    options: { skipUpdatingEmotesets: true },
  }) as unknown as TmiLike;

export interface IrcSource {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export function createIrcSource(opts: {
  channel: string;
  emit: (event: OverlayEvent) => void;
  onStatus: (state: StatusState) => void;
  clientFactory?: ClientFactory;
}): IrcSource {
  const client = (opts.clientFactory ?? defaultFactory)(opts.channel);

  const emitChat = (tags: IrcTags, message: string, self: boolean, isAction: boolean): void => {
    if (self) return;
    opts.emit(normalizeChat(tags, message, isAction));
  };

  client.on('message', (...args) => {
    const [, tags, message, self] = args as [string, IrcTags, string, boolean];
    emitChat(tags, message, self, false);
  });

  client.on('action', (...args) => {
    const [, tags, message, self] = args as [string, IrcTags, string, boolean];
    emitChat(tags, message, self, true);
  });

  // All USERNOTICEs raw so msg-ids unknown to tmi.js 1.8.5 arrive too.
  client.on('raw_message', (...args) => {
    const [raw] = args as [{ command?: string; tags?: IrcTags; params?: string[] }];
    if (raw?.command !== 'USERNOTICE') return;
    const event = normalizeUserNotice(raw.tags ?? {}, raw.params?.[1]);
    if (event) opts.emit(event);
  });

  client.on('messagedeleted', (...args) => {
    const [, , , tags] = args as [string, string, string, IrcTags];
    const targetId = tags['target-msg-id'];
    if (typeof targetId === 'string' && targetId !== '') {
      opts.emit({ id: `del-${targetId}`, ts: Date.now(), type: 'delete', targetId });
    }
  });

  const emitClear = (login: string | null): void => {
    opts.emit({ id: `clear-${Date.now()}`, ts: Date.now(), type: 'clear', targetLogin: login });
  };

  client.on('timeout', (...args) => emitClear((args[1] as string).toLowerCase()));
  client.on('ban', (...args) => emitClear((args[1] as string).toLowerCase()));
  client.on('clearchat', () => emitClear(null));

  client.on('connected', () => opts.onStatus('ok'));
  client.on('disconnected', () => opts.onStatus('down'));

  return {
    async connect() {
      await client.connect();
    },
    async disconnect() {
      await client.disconnect();
    },
  };
}
