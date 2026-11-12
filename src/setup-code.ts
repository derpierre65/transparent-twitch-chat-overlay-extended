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
