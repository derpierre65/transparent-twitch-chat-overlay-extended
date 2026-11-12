import type { Language } from './i18n';

export const DEFAULT_OVERLAY_URL = 'https://extended-twitch-overlay.pages.dev/';

export interface OverlayUrlInput {
  baseUrl: string;
  language: Language;
  /** Empty = default. */
  fade: string;
  /** Empty = default. */
  maxLines: string;
  demo: boolean;
  ablyKey: string;
  ablyChannel: string;
  trustUrl: string;
  trustSecret: string;
}

export type OverlayUrlResult = { url: string } | { error: string };

function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Only sets parameters that differ from the overlay's defaults. */
export function buildOverlayUrl(input: OverlayUrlInput): OverlayUrlResult {
  const baseUrl = input.baseUrl.trim();
  if (!isHttpUrl(baseUrl)) return { error: 'Overlay URL must start with https:// or http://.' };

  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  const set = (name: string, value: string): void => url.searchParams.set(name, value);

  if (input.language !== 'en') set('language', input.language);

  const fade = input.fade.trim();
  if (fade) {
    const value = Number(fade);
    if (!Number.isFinite(value) || value < 0 || value > 3600) return { error: 'Fade must be between 0 and 3600 seconds.' };
    set('fade', String(value));
  }

  const maxLines = input.maxLines.trim();
  if (maxLines) {
    const value = Number(maxLines);
    if (!Number.isInteger(value) || value < 1 || value > 500) return { error: 'Max lines must be a whole number from 1 to 500.' };
    set('maxLines', String(value));
  }

  if (input.demo) set('demo', '1');

  const ablyKey = input.ablyKey.trim();
  const ablyChannel = input.ablyChannel.trim();
  const trustUrl = input.trustUrl.trim();
  const trustSecret = input.trustSecret.trim();
  if (!ablyKey !== !ablyChannel) return { error: 'Chat approval needs both the Ably key and the Ably channel.' };
  if (!trustUrl !== !trustSecret) return { error: 'The worker needs both its URL and its secret.' };
  if (trustUrl && !ablyKey) return { error: 'The worker only works together with the Ably key and channel.' };
  if (trustUrl && !isHttpUrl(trustUrl)) return { error: 'Worker URL must start with https:// or http://.' };

  if (ablyKey) {
    set('ablyKey', ablyKey);
    set('ablyChannel', ablyChannel);
  }
  if (trustUrl) {
    set('trustUrl', trustUrl);
    set('trustSecret', trustSecret);
  }

  return { url: url.href };
}
