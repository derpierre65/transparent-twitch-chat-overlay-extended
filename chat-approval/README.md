# Chat approval

Optional add-on for the overlay: chat messages of viewers are held back until a mod either
trusts the user or approves the single message. Mods click buttons in the Twitch chat
(Tampermonkey userscript), which publish to an Ably channel. The overlay subscribes to it,
shows who approved what, and stores the list of trusted users in a Cloudflare Worker. The
mods' userscripts stay connected too, so every mod sees what the others already approved.

```
Mods (Twitch chat + userscript) <--Ably Realtime--> Ably channel <--Realtime--> Overlay --GET/PUT--> Worker (KV)
```

- `userscript/` – Tampermonkey script for the mods (native Twitch chat only; FFZ/7TV/BTTV
  are not supported).
- `worker/` – Cloudflare Worker that stores the trusted users per channel.
- `/token.html` of the overlay – creates the setup codes for the mods.
- `/mod.html` of the overlay – mod page with the same buttons, no Tampermonkey needed (see
  [Mod page](#mod-page)).

Approvals of single messages are not stored anywhere. Clicks made while the overlay is
closed are lost.

## Setup

### 1. Ably

1. Create an app at [ably.com](https://ably.com). Only **Pub/Sub** is needed (no Chat,
   LiveSync, LiveObjects or Spaces). The free plan is enough.
2. Pick a channel name, e.g. `overlay-approval`.
3. Under **API Keys**, create the **overlay key**: capabilities `subscribe`, `publish` and
   `presence`, restricted to that channel.
4. Create one **mod key per mod**: capabilities `subscribe` and `publish`, restricted to the
   same channel. Revoke a mod's key to take away their access. Never give a mod key
   `presence`: the userscripts take the overlay's state only from a connection that is present
   as `overlay`.
5. Never hand out the default root key. No channel rules or persistence are needed.

### 2. Worker

Run in `chat-approval/worker/`:

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create TRUST_KV
```

Copy `wrangler.toml.example` to `wrangler.toml` (git-ignored) and put the printed `id` there
instead of `REPLACE_WITH_KV_NAMESPACE_ID`. The `[[ratelimits]]` block limits each client IP to 30
requests per minute; its `namespace_id` only has to be unique within your Cloudflare account.

Create a long random secret (the worker answers `500` while it is shorter than 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```bash
npx wrangler secret put OVERLAY_SECRET
```

```bash
npx wrangler deploy
```

Wrangler prints the worker URL, e.g. `https://twitch-overlay-trust.<subdomain>.workers.dev`.

The worker is optional: without it, trusted users are kept in memory only and are lost
when the overlay reloads.

### 3. Overlay

Build the URL with `/generator.html` of the overlay (e.g.
`https://extended-twitch-overlay.pages.dev/generator.html`), or add the parameters by hand:

```
https://extended-twitch-overlay.pages.dev/?ablyKey=OVERLAY_KEY&ablyChannel=overlay-approval&trustUrl=https://twitch-overlay-trust.<subdomain>.workers.dev&trustSecret=OVERLAY_SECRET
```

| Parameter | Value |
|---|---|
| `ablyKey` | Overlay key (subscribe, publish, presence) |
| `ablyChannel` | Ably channel name |
| `trustUrl` | Worker URL (optional) |
| `trustSecret` | `OVERLAY_SECRET` of the worker (optional) |

The URL contains secrets: do not show it on stream. Once Ably is connected (and after every
reconnect), the overlay shows a line like `Chat approval active — 2 trusted: alice, bob`
(up to 20 names). Every trust, untrust and approval shows up as a line without sound,
e.g. `alice trusted by ModName` or `Message from bob approved by ModName`. If the Ably
connection drops, the status pill shows **Approval**.

### 4. Mods

1. Open `/token.html` of the overlay (e.g.
   `https://extended-twitch-overlay.pages.dev/token.html`), enter the Twitch channel, the
   Ably channel, the mod's key and the mod's name, and copy the setup code. The page sends
   nothing. The name is shown in the overlay and to the other mods.
2. The mod installs [Tampermonkey](https://www.tampermonkey.net/) and
   `userscript/twitch-chat-approval.user.js`.
3. Tampermonkey menu → **Add setup code** → paste the code.
4. In the channel's chat, each message now has two buttons next to the mod icons:
   - **Trust user** – all held and future messages of this user are shown. Shift+click
     untrusts.
   - **Approve message** – shows this single message.

After a click the button flashes green or red; hover it for the message. Afterwards:

- **Trust user** stays green while the user is trusted; the tooltip says by whom.
- **Approve message** stays green once the message is approved (tooltip: by whom), and is
  dimmed green for messages of trusted users.
- Both buttons are dimmed while the overlay is offline or Ably is not connected; the tooltip
  says why. Clicks made while the overlay is offline have no effect.

Instead of steps 2 and 3, a mod can use the [mod page](#mod-page).

The userscript keeps one Ably connection per tab with a chat of a configured channel. Use
Ably's **Dev Console** (attach to the channel) to watch the messages.

The script works on `/<channel>`, `/popout/<channel>/chat`, `/embed/<channel>/chat` and
`/moderator/<channel>`, and only for channels with a setup code. It works in Chrome and
Firefox: it loads the Ably library (pinned version, integrity-checked) into the Twitch page
and talks to it through `window.postMessage` with plain strings, ignoring messages from other
windows. The mod key is therefore in the page's memory, as it would be with any Ably client on
that page.

## Mod page

`/mod.html` of the overlay (e.g. `https://extended-twitch-overlay.pages.dev/mod.html`) shows
the channel's chat with the same **Trust user** and **Approve message** buttons, without
Tampermonkey or a userscript to keep up to date.

1. Paste the setup code from `/token.html` at the top and click **Add**. Codes are kept in this
   browser's `localStorage`; several can be saved and switched with the dropdown. **Remove**
   deletes the selected one from this browser.
2. Optional: **Log in with Twitch** with the account you moderate with. Each message then also
   gets **Delete message**, **Timeout 10 minutes** and **Ban user** (ban asks first). The page
   asks only for `moderator:manage:chat_messages` and `moderator:manage:banned_users`, and keeps
   this login apart from the overlay's. Twitch decides whether the account may moderate the
   channel; its error shows on the button and at the top.

Behavior:

- Messages of mods and the broadcaster have no approval buttons, as the overlay never holds
  them. The broadcaster's messages have no moderation buttons.
- The left edge shows what the overlay does: yellow = held, green = shown (mod, trusted or
  approved). Deleted messages are struck through, those of banned or timed-out users dimmed.
- **Trust user** toggles: a click on a trusted user untrusts them.
- The dots at the top show the chat, Ably and whether the overlay is open. Hover a button for
  details, as in the userscript.
- Badges need the Twitch login; without it messages show without badges. 7TV, BTTV and FFZ
  emotes always work.
- Messages from other channels in a shared chat session show up too, as in the overlay.
- The mod key and Twitch tokens are in this browser's `localStorage`. Use the page only in your
  own browser profile.

## Troubleshooting

| Tooltip / symptom | Cause |
|---|---|
| "Overlay is offline" although it is open | Ably's Dev Console → channel → **Presence** shows no `overlay`: the overlay key lacks `presence` (the overlay logs `ably presence failed`), or the overlay runs an old build. Without presence the userscript also ignores the overlay's state, so it shows nothing as trusted or approved. |
| "Ably key lacks a capability" | The mod key needs `subscribe` and `publish` on the channel. |
| "Ably key invalid or revoked" | Wrong key in the setup code, or the key was revoked. Create a new setup code. |
| "Could not load the Ably library" | `cdn.ably.com` is blocked, e.g. by a content blocker. |
| No buttons and no Tampermonkey menu entries | The script did not start: check the Tampermonkey dashboard and the browser console. |
| Buttons do not change in a background tab | Updates are drawn once the tab is visible again. |

## Overlay behavior

- Messages of mods, the broadcaster and trusted users appear right away; VIPs are held like
  other viewers. Released messages still go through the chat delay.
- Trusting a user releases all their held messages in order. Untrusting only affects new
  messages.
- Held messages are kept for up to 30 minutes, at most 500; the oldest is dropped first.
  Messages a mod deletes or that belong to a banned/timed-out user are dropped.
- The overlay keeps the single-message approvals of the last 30 minutes (at most 500) in
  memory, so mods who connect later see them too.
- The overlay loads the trusted list at startup and saves its changes at most every 5 minutes,
  plus one best-effort attempt when the page closes. It sends only the users that changed, so
  an overlay with an outdated list cannot bring back users another one removed. It never saves
  before the list has loaded.

## Protocol

### Ably messages (`name` → `data`)

| Name | Data |
|---|---|
| `trust-user` | `{ "userId": "123", "login": "name" }` |
| `untrust-user` | `{ "userId": "123", "login": "name" }` |
| `approve-message` | `{ "messageId": "<IRC id tag>", "userId": "123", "login": "name" }` |
| `sync-request` | `{}` – sent by a userscript when the overlay shows up in presence |
| `state` | `{ "reset": true, "trusted": { "<userId>": { "login": "name", "by": "ModName" } }, "approved": { "<messageId>": { "login": "name", "by": "ModName" } } }` |

`messageId` is the Twitch message ID (IRC tag `id`), `userId` the Twitch user ID (IRC tag
`user-id`). `data` may be a JSON object or a JSON string; anything else is ignored.

- The mods' messages carry the mod name as Ably `clientId`; the overlay uses `overlay`.
  Ably does not tell which key sent a message, so any mod key could claim any name.
- The overlay sends `state` when it connects and in answer to `sync-request`. A large
  state is split into several messages; only the first has `"reset": true`. `by` is `null`
  if unknown.
- The overlay enters presence as `overlay`; userscripts use it to show whether the overlay
  is open, and accept `state` only from a connection that is present as `overlay`. A mod key
  has no `presence` capability, so it cannot fake the overlay's state.

### Setup code

Base64 of UTF-8 JSON:

```json
{ "v": 1, "twitchChannel": "login", "ablyChannel": "overlay-approval", "ablyKey": "app.keyid:secret", "name": "ModName" }
```

`name` is optional (older codes); without it the overlay shows "a mod".

### Worker API

- `GET /trusted/<channel>` → `200` `{ "users": { "<userId>": { "login": "name", "trustedAt": "<ISO>", "trustedBy": "ModName" } } }`
  (empty: `{ "users": {} }`; `trustedBy` is optional)
- `PUT /trusted/<channel>` with the same body → `204`, replaces the whole list
- `PATCH /trusted/<channel>` with
  `{ "set": { "<userId>": { "login": "name", "trustedAt": "<ISO>" } }, "remove": ["<userId>"] }`
  → `204`, changes only these users (`remove` first, then `set`; both are optional). The overlay
  saves this way.
- `login` must be a Twitch login (`a-z`, `0-9`, `_`, up to 25 characters), `trustedAt` a UTC
  timestamp like `2026-11-12T10:00:00.000Z`, `trustedBy` at most 100 characters.
- All of them need `Authorization: Bearer <OVERLAY_SECRET>`, otherwise `401`.
- KV key `trusted:<channel lowercase>`; one KV write per valid PUT, and per PATCH that names a
  user.
- `400` invalid channel/body, `404` unknown route, `405` wrong method, `413` body or resulting
  list > 512 KB, `429` more than 30 requests per minute from one IP, `500` secret not set or
  shorter than 32 characters. CORS is open.
- The request limit is counted per Cloudflare location and is approximate. Rejected requests
  still count towards the Workers request quota.

`<channel>` is the login of the account connected in the overlay.

Test with curl (PowerShell: `curl.exe`). `body.json`:

```json
{ "users": { "12345": { "login": "alice", "trustedAt": "2026-11-12T10:00:00.000Z" } } }
```

```bash
curl.exe -i -X PUT -H "Authorization: Bearer YOUR_SECRET" -H "Content-Type: application/json" --data-binary "@body.json" https://twitch-overlay-trust.<subdomain>.workers.dev/trusted/yourchannel
```

```bash
curl.exe -i -H "Authorization: Bearer YOUR_SECRET" https://twitch-overlay-trust.<subdomain>.workers.dev/trusted/yourchannel
```

Expected: `204`, then `200` with the body. Without the header: `401`.

Worker tests, in `chat-approval/worker/`:

```bash
npm test
```

```bash
npm run typecheck
```
