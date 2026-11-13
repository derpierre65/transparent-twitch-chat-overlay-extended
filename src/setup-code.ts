export interface SetupCodeInput {
  twitchChannel: string;
  ablyChannel: string;
  ablyKey: string;
  /** Shown in the overlay and to other mods as the one who approved. */
  modName: string;
}

// Must match the checks in `chat-approval/userscript/twitch-chat-approval.user.js`.
const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/;
const ABLY_KEY = /^[\w-]+\.[\w-]+:[\x21-\x7e]+$/;

export function validateSetupCode(input: SetupCodeInput): string | null {
  if (!TWITCH_LOGIN.test(input.twitchChannel.trim().toLowerCase())) return 'Twitch channel is invalid.';
  if (!input.ablyChannel.trim()) return 'Ably channel is missing.';
  if (!ABLY_KEY.test(input.ablyKey.trim())) return 'Ably key is not in the format app.keyid:secret.';
  const name = input.modName.trim();
  if (!name || name.length > 50) return 'Mod name must be 1 to 50 characters.';
  // The overlay uses this Ably clientId itself.
  if (name.toLowerCase() === 'overlay') return 'Mod name "overlay" is reserved.';
  return null;
}

/** Base64 of UTF-8 JSON, as decoded by the userscript. */
export function encodeSetupCode(input: SetupCodeInput): string {
  const json = JSON.stringify({
    v: 1,
    twitchChannel: input.twitchChannel.trim().toLowerCase(),
    ablyChannel: input.ablyChannel.trim(),
    ablyKey: input.ablyKey.trim(),
    name: input.modName.trim(),
  });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

export interface SetupCode {
  twitchChannel: string;
  ablyChannel: string;
  ablyKey: string;
  /** Empty for older codes; the overlay then shows "a mod". */
  name: string;
}

/** Same checks as `decodeSetupCode` in the userscript. Throws with a readable message. */
export function decodeSetupCode(code: string): SetupCode {
  let b64 = code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  let cfg: Record<string, unknown> | null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    cfg = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> | null;
  } catch {
    throw new Error('Not a valid setup code (Base64/JSON).');
  }
  if (cfg?.['v'] !== 1) throw new Error('Unknown setup code version.');

  const field = (key: string): string => {
    const value = cfg[key];
    if (typeof value !== 'string' || !value) throw new Error(`Field "${key}" is missing.`);
    return value;
  };
  const ablyChannel = field('ablyChannel');
  const ablyKey = field('ablyKey');
  const twitchChannel = field('twitchChannel').trim().toLowerCase();
  if (!ABLY_KEY.test(ablyKey)) throw new Error('Ably key is not in the format app.keyid:secret.');
  if (!TWITCH_LOGIN.test(twitchChannel)) throw new Error('Twitch channel is invalid.');

  const name = typeof cfg['name'] === 'string' ? cfg['name'].trim().slice(0, 50) : '';
  if (name.toLowerCase() === 'overlay') throw new Error('Mod name "overlay" is reserved.');
  return { twitchChannel, ablyChannel, ablyKey, name };
}
