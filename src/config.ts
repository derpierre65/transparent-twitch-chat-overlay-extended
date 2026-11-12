import { parseLanguage, type Language } from './i18n';

export interface OverlayConfig {
  maxLines: number;
  fade: number;
  demo: boolean;
  language: Language;
}

const MAX_LINES_CAP = 500;

function positiveNumber(raw: string | null, fallback: number, cap: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, cap);
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
  };
}
