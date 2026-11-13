# Transparent Twitch Chat Overlay Extended

Chat plus raids, subs, gift subs, announcements, channel point redemptions, bits,
follows, hype trains, ad breaks and moderation actions (bans, timeouts, unbans) — as a Custom URL for
[Transparent-Twitch-Chat-Overlay](https://github.com/baffler/Transparent-Twitch-Chat-Overlay).

## Development

```bash
npm install
cp .env.example .env   # then fill in VITE_TWITCH_CLIENT_ID
npm run dev            # http://localhost:5173
npm test
npm run build
```

## Setup in the overlay app

1. Settings → Chat → Chat Type: **Custom URL**
2. Custom URL: `https://extended-twitch-overlay.pages.dev/`
3. Settings → Chat → Chat Sound: pick a sound (the overlay calls the app's
   `playSound()`, it ships no sound of its own).
4. Make the overlay **Interactable** (tray menu or hotkey), otherwise the login view
   cannot be used.

## Login

The app runs WebView2 with its own profile, so your browser's Twitch login does not
apply there. That is why the login uses a device code (Twitch Device Code Flow):

1. Start the overlay. Without a valid login it shows *Connect with Twitch*, a code and a
   link.
2. Click *Copy link* (or copy the link from the text field) and open it in your own
   browser, where you are logged in to Twitch.
3. Confirm the code there. The overlay notices by itself and reloads.

The link already contains the code. If the code expires (~30 minutes), the overlay
requests a new one; the link then has to be copied again.

Afterwards the overlay renews its token by itself using the refresh token. A new login is
only needed if the overlay has not run for more than 30 days. If the login is lost while
running, the view does not pop up by itself — click the status pill in the bottom right
corner instead.

Chat and events always run for the account you connected with.

## URL parameters

All parameters are optional and can be combined, e.g.
`https://extended-twitch-overlay.pages.dev/?language=de&fade=30&maxLines=20`.
[`/generator.html`](https://extended-twitch-overlay.pages.dev/generator.html) builds the URL
from a form, including the chat approval parameters.

| Parameter | Values | Default | Effect |
|---|---|---|---|
| `language` | `en`, `de` | `en` | Language of all overlay texts (event lines, login view, connection notice). Case-insensitive; unknown values fall back to English. |
| `fade` | seconds, `0`–`3600`, decimals allowed | `60`, `5` in demo mode | Time after which a line fades out. `0` disables fading. |
| `maxLines` | `1`–`500` | `50` | Maximum number of visible lines. When another one arrives, the oldest is removed, even before `fade` has passed. |
| `demo` | `1` | off | Plays synthetic chat lines and events without login or Twitch connection. Handy for styling. |
| `ablyKey` | Ably API key | off | Turns on [message approval](#message-approval) together with `ablyChannel`. |
| `ablyChannel` | Ably channel name | off | Channel the mods' userscript publishes to. |
| `trustUrl` | `https://…` | off | Base URL of the trust worker. Without it (or without `trustSecret`) trusted users are kept in memory only and are lost on reload. |
| `trustSecret` | string | off | Bearer secret of the trust worker. |

Invalid values (e.g. `fade=abc` or negative numbers) fall back to the default, values that
are too large are capped at the maximum. The channel cannot be chosen by parameter: chat
and events always run for the connected account.

## Styling

All colors and sizes are CSS custom properties on `:root` in `src/styles.css`. To tweak
them without a redeploy, use Settings → Chat → Custom CSS in the host app, e.g.

```css
:root { --font-size: 26px; --raid: rgba(255, 0, 0, 0.5); }
```

Moderation lines use `--ban`, `--timeout` and `--unban`. Ad break lines use `--adbreak`
(start) and `--adbreak-end`. Twitch only reports the start of an ad break; the end line
is shown after the announced duration and is an estimate.

## Client ID

The Twitch app's client ID is set as `VITE_TWITCH_CLIENT_ID`:

- `.env.production` (committed) for production builds, including Cloudflare Pages.
- `.env` (gitignored, template: `.env.example`) for local development.

The value is not a secret: Vite replaces `import.meta.env.VITE_TWITCH_CLIENT_ID` with the
literal value at build time, so the ID ships in the bundle anyway. That is intended for a
public client.

After changing an env file, rebuild (`npm run build`) or restart the dev server.

## Token

Device Code Flow for public clients. Scopes: `channel:read:redemptions`,
`moderator:read:followers`, `channel:read:hype_train`, `moderator:read:chat_settings`,
`channel:read:ads` and `channel:moderate`. Twitch requires the last one for ban, timeout and unban events; there
is no read-only scope for them. The overlay itself never performs moderation actions. The
Twitch app must have the client type **Public** in the developer console; no redirect URLs
are needed.

If a stored token lacks a scope (e.g. after an update that needs a new one), the overlay
shows the login view once at startup. Until you confirm, everything keeps running with the
old token, only the new events are missing.

## Chat delay

If a non-mod chat delay is set on Twitch (2, 4 or 6 seconds), the overlay holds chat
messages back for the same time. Over IRC they would otherwise arrive instantly. If a mod
deletes a message during that time or bans the user, it never shows up. Messages from mods
and the broadcaster appear immediately; VIPs are delayed like other viewers. Events (subs,
raids, etc.) are never delayed.

The overlay reads the setting at startup and then every minute via the Helix API
(`moderator:read:chat_settings`). Twitch does not report changes to it via EventSub.
Without a valid token there is no delay.

## Message approval

Optional. With `ablyKey` and `ablyChannel` set, chat messages of viewers are held back until
a mod either trusts the user or approves the single message, either via a userscript in the
Twitch chat or on the mod page `/mod.html`. Released messages still go through the
[chat delay](#chat-delay).

Setup (Ably, worker, overlay URL, userscript, setup codes), behavior and protocol:
[chat-approval/README.md](chat-approval/README.md).

## Token storage

Access and refresh tokens are stored in the page's `localStorage`. The chat connects
**anonymously** (`justinfan`), independent of the token. If the token is invalid, the
chat of the last connected account keeps running and only the EventSub events are
missing.

The mod page (`/mod.html`) keeps its own tokens under `mod.token`/`mod.refresh`, so a mod
login in the same browser never replaces the overlay's.
