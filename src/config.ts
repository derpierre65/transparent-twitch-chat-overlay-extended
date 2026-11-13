import { parseLanguage, type Language } from './i18n';

export interface ApprovalConfig {
  ablyKey: string;
  ablyChannel: string;
  /** `null`: trusted users live in memory only. */
  trust: { url: string; secret: string } | null;
  /** Shows a notice when a message is held. */
  heldNotice: boolean;
}

export interface OverlayConfig {
  maxLines: number;
  fade: number;
  demo: boolean;
  language: Language;
  /** `null` unless `ablyKey` and `ablyChannel` are both set. */
  approval: ApprovalConfig | null;
}

const MAX_LINES_CAP = 500;

function positiveNumber(raw: string | null, fallback: number, cap: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, cap);
}

function text(params: URLSearchParams, name: string): string | null {
  return params.get(name)?.trim() || null;
}

function httpUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function parseApproval(params: URLSearchParams): ApprovalConfig | null {
  const ablyKey = text(params, 'ablyKey');
  const ablyChannel = text(params, 'ablyChannel');
  if (!ablyKey || !ablyChannel) return null;

  const url = httpUrl(text(params, 'trustUrl'));
  const secret = text(params, 'trustSecret');
  return {
    ablyKey,
    ablyChannel,
    trust: url && secret ? { url, secret } : null,
    heldNotice: params.get('heldNotice') === '1',
  };
}

export function parseConfig(search: string): OverlayConfig {
  const params = new URLSearchParams(search);
  const demo = params.get('demo') === '1';

  return {
    maxLines: positiveNumber(params.get('maxLines'), 50, MAX_LINES_CAP) || 50,
    // Short in demo mode so fading is visible right away while styling.
    fade: positiveNumber(params.get('fade'), demo ? 5 : 60, 3600),
    demo,
    language: parseLanguage(params.get('language')),
    approval: parseApproval(params),
  };
}
