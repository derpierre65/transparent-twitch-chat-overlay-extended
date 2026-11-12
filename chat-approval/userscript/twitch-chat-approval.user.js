// ==UserScript==
// @name         Twitch Chat Approval (Ably)
// @namespace    https://github.com/derpierre65
// @version      1.0.0
// @description  Adds "Trust user" and "Approve message" buttons to the Twitch chat, publishes them via Ably and shows what other mods already approved.
// @match        https://www.twitch.tv/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @sandbox      JavaScript
// @run-at       document-idle
// ==/UserScript==

(function () {
	'use strict';

	const STORAGE_KEY = 'setups';
	const MARK = 'tco-actions';
	// The overlay's Ably clientId (presence and `state` messages).
	const OVERLAY_CLIENT_ID = 'overlay';
	// Same rule as the setup page (src/setup-code.ts).
	const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/;
	// Not via @require: its UMD wrapper writes to `this`, which breaks inside Tampermonkey.
	const ABLY_URL = 'https://cdn.ably.com/lib/ably.min-2.30.0.js';
	const ABLY_SRI = 'sha256-8/67gU6QPnQBWNU6ong/VGyKlLcwBS/fgmthcNO0yH8=';
	// First path segments that are Twitch pages, not channels.
	const RESERVED = new Set([
		'directory', 'downloads', 'drops', 'friends', 'inventory', 'jobs', 'login', 'messages', 'p', 'payments',
		'prime', 'privacy', 'search', 'settings', 'signup', 'subscriptions', 'turbo', 'u', 'user', 'videos',
		'wallet', 'store', 'bits', 'following', 'broadcast', 'creatorcamp', 'team', 'collections',
	]);

	/* ---------- Setup codes ---------- */

	// Without a prototype, so a channel named "constructor" or "__proto__" is just a key.
	function toSetups(value) {
		return Object.assign(Object.create(null), value);
	}

	let setups = toSetups(GM_getValue(STORAGE_KEY, {}));
	if (typeof GM_addValueChangeListener === 'function') {
		GM_addValueChangeListener(STORAGE_KEY, (_k, _o, value) => {
			setups = toSetups(value);
			rescan(true);
		});
	}

	function saveSetups() {
		GM_setValue(STORAGE_KEY, { ...setups });
		rescan(true);
	}

	function decodeSetupCode(code) {
		let b64 = String(code).trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
		while (b64.length % 4) {
			b64 += '=';
		}
		let cfg;
		try {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			cfg = JSON.parse(new TextDecoder().decode(bytes));
		}
		catch {
			throw new Error('Not a valid setup code (Base64/JSON).');
		}
		if (cfg?.v !== 1) {
			throw new Error('Unknown setup code version.');
		}
		for (const field of ['twitchChannel', 'ablyChannel', 'ablyKey']) {
			if (typeof cfg[field] !== 'string' || !cfg[field]) {
				throw new Error(`Field "${field}" is missing.`);
			}
		}
		if (!/^[\w-]+\.[\w-]+:[\x21-\x7e]+$/.test(cfg.ablyKey)) {
			throw new Error('Ably key is not in the format app.keyid:secret.');
		}
		const twitchChannel = cfg.twitchChannel.trim().toLowerCase();
		if (!TWITCH_LOGIN.test(twitchChannel)) {
			throw new Error('Twitch channel is invalid.');
		}
		// Older codes have no name; the overlay then shows "a mod".
		const name = typeof cfg.name === 'string' ? cfg.name.trim().slice(0, 50) : '';
		if (name.toLowerCase() === OVERLAY_CLIENT_ID) {
			throw new Error('Mod name "overlay" is reserved.');
		}
		return {
			twitchChannel,
			ablyChannel: cfg.ablyChannel,
			ablyKey: cfg.ablyKey,
			name,
		};
	}

	function addSetupCode() {
		const code = prompt('Paste setup code:');
		if (!code) {
			return;
		}
		try {
			const cfg = decodeSetupCode(code);
			const replaced = !!setups[cfg.twitchChannel];
			setups[cfg.twitchChannel] = cfg;
			saveSetups();
			alert(`Setup code for #${cfg.twitchChannel} ${replaced ? 'replaced' : 'saved'}.`);
		}
		catch (e) {
			alert(`Invalid setup code: ${e.message}`);
		}
	}

	function manageSetupCodes() {
		const channels = Object.keys(setups).sort();
		if (!channels.length) {
			alert('No setup codes saved.');
			return;
		}
		const list = channels
			.map((c, i) => `${i + 1}. #${c}  (name: ${setups[c].name || '-'}, Ably channel: ${setups[c].ablyChannel}, key: ${setups[c].ablyKey.split(':')[0]})`)
			.join('\n');
		const input = prompt(`Saved setup codes:\n\n${list}\n\nEnter a number or channel to remove it (empty = cancel):`);
		if (!input) {
			return;
		}
		const value = input.trim().replace(/^#/, '').toLowerCase();
		const channel = /^\d+$/.test(value) ? channels[Number(value) - 1] : value;
		if (!channel || !setups[channel]) {
			alert(`"${input}" not found.`);
			return;
		}
		if (confirm(`Remove setup code for #${channel}?`)) {
			delete setups[channel];
			saveSetups();
		}
	}

	// Embed chat runs in iframes; avoid duplicate menu entries.
	if (window.top === window.self) {
		GM_registerMenuCommand('Add setup code', addSetupCode);
		GM_registerMenuCommand('Show/remove setup codes', manageSetupCodes);
	}

	/* ---------- Channel & message data ---------- */

	function channelFromPath(pathname) {
		const parts = pathname.split('/').filter(Boolean).map((p) => p.toLowerCase());
		if ((parts[0] === 'popout' || parts[0] === 'embed') && parts[1] && parts[2] === 'chat') {
			return parts[1];
		}
		if (parts[0] === 'moderator' && parts[1]) {
			return parts[1];
		}
		if (parts[0] && !RESERVED.has(parts[0]) && /^[a-z0-9_]{2,25}$/.test(parts[0])) {
			return parts[0];
		}
		return null;
	}

	let warnedNoFiber = false;

	// Single fiber walk for the line; depth varies between Twitch builds.
	function getLineData(line) {
		const el = line.wrappedJSObject || line;
		const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
		if (!key) {
			if (!warnedNoFiber) {
				warnedNoFiber = true;
				console.warn('[Chat Approval] No React fiber on .chat-line__message - is the script running in the page context (@sandbox JavaScript)?');
			}
			return null;
		}
		let message = null;
		let channelID = null;
		let channelLogin = null;
		for (let f = el[key], i = 0; f && i < 40; i++, f = f.return) {
			const p = f.memoizedProps;
			if (!p) {
				continue;
			}
			if (!message && p.message?.id) {
				message = p.message;
			}
			if (channelID == null && p.channelID != null) {
				channelID = String(p.channelID);
			}
			if (channelLogin == null && typeof p.channelLogin === 'string') {
				channelLogin = p.channelLogin.toLowerCase();
			}
			if (message && channelID != null && channelLogin != null) {
				break;
			}
		}
		if (!message?.user?.userID) {
			return null;
		}
		return {
			messageId: String(message.id),
			userId: String(message.user.userID),
			login: String(message.user.userLogin || '').toLowerCase(),
			sourceRoomID: message.sourceRoomID != null ? String(message.sourceRoomID) : null,
			channelID,
			channelLogin,
		};
	}

	function setupForLine(data) {
		const channel = data.channelLogin || currentChannel;
		return channel ? setups[channel] || null : null;
	}

	function isSharedChatForeign(data) {
		return !!(data.sourceRoomID && data.channelID && data.sourceRoomID !== data.channelID);
	}

	/* ---------- Ably connection & shared state ---------- */

	// One connection per frame, for the setup of the chat shown in it.
	let conn = null;

	function emptyState() {
		return {
			trusted: new Map(), // userId -> { login, by }
			approved: new Map(), // messageId -> { login, by }
			connected: false,
			overlayOnline: false,
			// Ably connection IDs of the overlay, taken from presence.
			overlayConnections: new Set(),
			error: '',
		};
	}

	let state = emptyState();

	function byName(clientId) {
		return typeof clientId === 'string' && clientId && clientId !== OVERLAY_CLIENT_ID ? clientId : null;
	}

	function describeAblyError(err) {
		const code = err?.code;
		if (code === 40160) {
			return 'Ably key lacks a capability (needs publish and subscribe on the channel).';
		}
		if (code >= 40100 && code < 40200) {
			return 'Ably key invalid or revoked. Ask the streamer for a new setup code.';
		}
		return err?.message ? `Ably error: ${err.message}` : 'Ably not reachable.';
	}

	function applyMessage(message) {
		const data = message.data && typeof message.data === 'object' ? message.data : null;
		if (!data) {
			return;
		}
		const by = byName(message.clientId);
		switch (message.name) {
			case 'state': {
				// Any mod key can claim the overlay's clientId, but only the overlay key can be present.
				if (message.clientId !== OVERLAY_CLIENT_ID || !state.overlayConnections.has(message.connectionId)) {
					return;
				}
				if (data.reset) {
					state.trusted.clear();
					state.approved.clear();
				}
				for (const [id, entry] of Object.entries(data.trusted || {})) {
					state.trusted.set(id, { login: String(entry?.login || ''), by: byName(entry?.by) });
				}
				for (const [id, entry] of Object.entries(data.approved || {})) {
					state.approved.set(id, { login: entry?.login ? String(entry.login) : null, by: byName(entry?.by) });
				}
				break;
			}
			case 'trust-user':
				if (typeof data.userId === 'string') {
					state.trusted.set(data.userId, { login: String(data.login || ''), by });
				}
				break;
			case 'untrust-user':
				if (typeof data.userId === 'string') {
					state.trusted.delete(data.userId);
				}
				break;
			case 'approve-message':
				if (typeof data.messageId === 'string' && !state.approved.has(data.messageId)) {
					state.approved.set(data.messageId, { login: data.login ? String(data.login) : null, by });
				}
				break;
			default:
				return;
		}
		scheduleRefresh();
	}

	/*
	 * Ably runs in the page, the script talks to it via string messages. In Firefox the script
	 * lives in its own compartment: Ably objects there break on the page's WebSocket data, and
	 * page objects are not accessible from here. Strings cross both ways.
	 */
	function pageBridge(ablyUrl, ablySri, prefix, overlayClientId) {
		let client = null;
		let channel = null;
		let gen = 0;
		const send = (msg) => window.postMessage(prefix + 'evt:' + JSON.stringify({ ...msg, gen }), window.location.origin);
		const error = (err) => ({ code: err?.code ?? null, message: err?.message ?? String(err) });

		function presence() {
			channel?.presence
				.get()
				.then((members) => send({
					type: 'presence',
					connections: members.filter((m) => m.clientId === overlayClientId).map((m) => m.connectionId),
				}))
				.catch((err) => send({ type: 'error', error: error(err) }));
		}

		function close() {
			client?.close();
			client = null;
			channel = null;
		}

		function connect(cmd) {
			close();
			gen = cmd.gen;
			const own = new window.Ably.Realtime({ key: cmd.key, clientId: cmd.clientId || undefined });
			client = own;
			channel = own.channels.get(cmd.channel);
			own.connection.on((change) => {
				if (client === own) {
					send({ type: 'connection', current: change.current, reason: change.reason ? error(change.reason) : null });
				}
			});
			channel.on('attached', () => {
				send({ type: 'attached' });
				presence();
			});
			channel
				.subscribe((m) => send({
					type: 'message',
					name: m.name,
					data: m.data,
					clientId: m.clientId ?? null,
					connectionId: m.connectionId ?? null,
				}))
				.catch((err) => send({ type: 'error', error: error(err) }));
			channel.presence.subscribe(presence).catch((err) => send({ type: 'error', error: error(err) }));
		}

		window.addEventListener('message', (event) => {
			// Other windows (an embedding page, extension frames) can post here as well.
			if (event.source !== window || event.origin !== window.location.origin) {
				return;
			}
			if (typeof event.data !== 'string' || !event.data.startsWith(prefix + 'cmd:')) {
				return;
			}
			let cmd;
			try {
				cmd = JSON.parse(event.data.slice(prefix.length + 4));
			}
			catch {
				return;
			}
			if (cmd?.type === 'connect') {
				connect(cmd);
			}
			else if (cmd?.type === 'close') {
				close();
			}
			else if (cmd?.type === 'publish' && channel && cmd.gen === gen) {
				channel
					.publish(cmd.name, cmd.data)
					.then(() => send({ type: 'published', id: cmd.id }))
					.catch((err) => send({ type: 'published', id: cmd.id, error: error(err) }));
			}
		});

		if (window.Ably) {
			send({ type: 'ready' });
			return;
		}
		const script = document.createElement('script');
		script.src = ablyUrl;
		script.integrity = ablySri;
		script.crossOrigin = 'anonymous';
		script.onload = () => send({ type: 'ready' });
		script.onerror = () => send({ type: 'load-error' });
		document.head.append(script);
	}

	const BRIDGE_PREFIX = 'tco-ably-bridge:';
	let bridge = null;
	let bridgeResolve = null;
	let bridgeReject = null;
	let generation = 0;
	let nextPublishId = 1;
	const pendingPublishes = new Map();

	function bridgeSend(cmd) {
		window.postMessage(BRIDGE_PREFIX + 'cmd:' + JSON.stringify(cmd), window.location.origin);
	}

	function startBridge() {
		bridge ??= new Promise((resolve, reject) => {
			bridgeResolve = resolve;
			bridgeReject = reject;
			const args = [ABLY_URL, ABLY_SRI, BRIDGE_PREFIX, OVERLAY_CLIENT_ID].map((v) => JSON.stringify(v)).join(', ');
			const script = document.createElement('script');
			script.textContent = '(' + pageBridge + ')(' + args + ');';
			(document.head || document.documentElement).append(script);
			script.remove();
		});
		return bridge;
	}

	window.addEventListener('message', (event) => {
		// Other windows (an embedding page, extension frames) can post here as well.
		if (event.origin !== window.location.origin) {
			return;
		}
		if (typeof event.data !== 'string' || !event.data.startsWith(BRIDGE_PREFIX + 'evt:')) {
			return;
		}
		let msg;
		try {
			msg = JSON.parse(event.data.slice(BRIDGE_PREFIX.length + 4));
		}
		catch {
			return;
		}
		if (!msg) {
			return;
		}
		if (msg.type === 'ready') {
			bridgeResolve?.();
			return;
		}
		if (msg.type === 'load-error') {
			bridge = null;
			bridgeReject?.(new Error('Could not load the Ably library.'));
			return;
		}
		if (msg.type === 'published') {
			const pending = pendingPublishes.get(msg.id);
			pendingPublishes.delete(msg.id);
			if (pending) {
				if (msg.error) {
					pending.reject(msg.error);
				}
				else {
					pending.resolve();
				}
			}
			return;
		}
		if (!conn || msg.gen !== conn.gen) {
			return;
		}
		switch (msg.type) {
			case 'connection':
				state.connected = msg.current === 'connected';
				if (state.connected) {
					state.error = '';
				}
				else if (msg.reason) {
					state.error = describeAblyError(msg.reason);
				}
				break;
			case 'attached':
				// Messages may have been missed: the presence update that follows asks for the state again.
				state.overlayConnections = new Set();
				return;
			case 'message':
				applyMessage(msg);
				return;
			case 'presence': {
				const known = state.overlayConnections;
				state.overlayConnections = new Set(msg.connections);
				state.overlayOnline = msg.connections.length > 0;
				// The overlay answers with its full state.
				if (msg.connections.some((id) => !known.has(id))) {
					publish('sync-request', {}).catch((err) => {
						state.error = describeAblyError(err);
						scheduleRefresh();
					});
				}
				break;
			}
			case 'error':
				state.error = describeAblyError(msg.error);
				break;
			default:
				return;
		}
		scheduleRefresh();
	});

	function publish(name, data) {
		if (!conn?.ready) {
			return Promise.reject(new Error('Not connected to Ably yet.'));
		}
		const id = nextPublishId++;
		return new Promise((resolve, reject) => {
			pendingPublishes.set(id, { resolve, reject });
			setTimeout(() => {
				if (pendingPublishes.delete(id)) {
					reject(new Error('Ably did not answer.'));
				}
			}, 10000);
			bridgeSend({ type: 'publish', gen: conn.gen, id, name, data });
		});
	}

	function closeConnection() {
		if (conn) {
			bridgeSend({ type: 'close' });
			conn = null;
		}
		state = emptyState();
	}

	function ensureConnection(cfg) {
		if (conn?.cfg === cfg) {
			return;
		}
		closeConnection();
		// Buttons publish on the current connection, so those of the previous chat must go.
		document.querySelectorAll(`.${MARK}`).forEach((el) => el.remove());
		if (!cfg) {
			return;
		}
		const own = { cfg, gen: ++generation, ready: false };
		conn = own;
		startBridge()
			.then(() => {
				if (conn !== own) {
					return;
				}
				own.ready = true;
				bridgeSend({ type: 'connect', gen: own.gen, key: cfg.ablyKey, clientId: cfg.name, channel: cfg.ablyChannel });
			})
			.catch((err) => {
				state.error = err.message;
				scheduleRefresh();
			});
	}

	/* ---------- UI ---------- */

	GM_addStyle(`
		.${MARK} { display: inline-flex; gap: 2px; margin-right: 4px; vertical-align: middle; }
		.${MARK} button {
			display: inline-flex; align-items: center; justify-content: center;
			width: 20px; height: 20px; padding: 0; border: 0; border-radius: 2px;
			background: transparent; color: var(--color-text-alt-2, #adadb8); cursor: pointer;
			transition: background-color .15s, color .15s, opacity .15s;
		}
		.${MARK} button:hover { color: var(--color-text-base, #efeff1); background: var(--color-background-button-text-hover, rgba(83,83,95,.48)); }
		.${MARK} button:disabled { opacity: .5; cursor: progress; }
		.${MARK} button.tco-active { color: #00c26b; }
		.${MARK} button.tco-implied { color: #00c26b; opacity: .5; }
		.${MARK}.tco-offline button { opacity: .45; }
		.${MARK} button.tco-ok { color: #fff; background: #00a35c; opacity: 1; }
		.${MARK} button.tco-error { color: #fff; background: #eb0400; opacity: 1; }
		.${MARK} svg { width: 14px; height: 14px; fill: currentColor; pointer-events: none; }
	`);

	const ICONS = {
		trust: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 9c-3.3 0-6 1.8-6 4v2h8.3A5.5 5.5 0 0 1 11 11.4 9 9 0 0 0 8 11z"/><path d="m18.7 12.7-4.2 4.2-2.7-2.7 1.4-1.4 1.3 1.3 2.8-2.8 1.4 1.4z"/></svg>',
		approve: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l-4 3v-3H4a2 2 0 0 1-2-2V4zm11.8 1.8-4.8 4.8-2.8-2.8-1.4 1.4 4.2 4.2 6.2-6.2-1.4-1.4z" clip-rule="evenodd"/></svg>',
	};

	const TITLES = {
		trust: 'Trust user (Shift+click: untrust)',
		approve: 'Approve message',
	};

	function by(entry) {
		return entry.by || 'a mod';
	}

	function connectionNote() {
		if (state.error) {
			return `\n${state.error}`;
		}
		if (!state.connected) {
			return '\nConnecting to Ably …';
		}
		return state.overlayOnline ? '' : '\nOverlay is offline: clicks have no effect until it is open.';
	}

	function updateGroup(group) {
		const { userId, messageId } = group.dataset;
		const trust = group.querySelector('[data-tco-action="trust"]');
		const approve = group.querySelector('[data-tco-action="approve"]');
		const trusted = state.trusted.get(userId);
		const approved = state.approved.get(messageId);
		const note = connectionNote();

		group.classList.toggle('tco-offline', !state.connected || !state.overlayOnline);
		if (!trust._tcoTimer) {
			trust.classList.toggle('tco-active', !!trusted);
			trust.title = (trusted ? `Trusted by ${by(trusted)} (Shift+click: untrust)` : TITLES.trust) + note;
		}
		if (!approve._tcoTimer) {
			approve.classList.toggle('tco-active', !!approved);
			approve.classList.toggle('tco-implied', !approved && !!trusted);
			approve.title = (approved ? `Approved by ${by(approved)}` : trusted ? 'User is trusted' : TITLES.approve) + note;
		}
	}

	let refreshQueued = false;

	function scheduleRefresh() {
		if (refreshQueued) {
			return;
		}
		refreshQueued = true;
		requestAnimationFrame(() => {
			refreshQueued = false;
			document.querySelectorAll(`.${MARK}`).forEach(updateGroup);
		});
	}

	function flash(btn, ok, message) {
		clearTimeout(btn._tcoTimer);
		btn.classList.remove('tco-ok', 'tco-error');
		btn.classList.add(ok ? 'tco-ok' : 'tco-error');
		btn.title = message;
		btn._tcoTimer = setTimeout(() => {
			btn._tcoTimer = null;
			btn.classList.remove('tco-ok', 'tco-error');
			const group = btn.closest(`.${MARK}`);
			if (group) {
				updateGroup(group);
			}
		}, ok ? 2000 : 5000);
	}

	function swallow(e) {
		e.stopPropagation();
		if (e.type !== 'pointerdown' && e.type !== 'mousedown') {
			e.preventDefault();
		}
	}

	async function onClick(e) {
		swallow(e);
		const btn = e.currentTarget;
		const group = btn.closest(`.${MARK}`);
		const { userId, messageId, login } = group?.dataset || {};
		if (!conn || !userId) {
			flash(btn, false, 'Not connected or setup code missing.');
			return;
		}

		let name;
		let payload;
		if (btn.dataset.tcoAction === 'approve') {
			name = 'approve-message';
			payload = { messageId, userId, login };
		}
		else {
			name = e.shiftKey ? 'untrust-user' : 'trust-user';
			payload = { userId, login };
		}

		btn.disabled = true;
		try {
			await publish(name, payload);
			flash(btn, true, {
				'trust-user': `${login} trusted`,
				'untrust-user': `${login} untrusted`,
				'approve-message': 'Message approved',
			}[name] + connectionNote());
		}
		catch (err) {
			const message = describeAblyError(err);
			flash(btn, false, message);
			console.warn('[Chat Approval]', message, err);
		}
		finally {
			btn.disabled = false;
		}
	}

	function createButton(action) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.dataset.tcoAction = action;
		btn.title = TITLES[action];
		btn.setAttribute('aria-label', TITLES[action]);
		btn.innerHTML = ICONS[action];
		btn.addEventListener('click', onClick);
		for (const type of ['mousedown', 'pointerdown', 'mouseup', 'dblclick']) {
			btn.addEventListener(type, swallow);
		}
		return btn;
	}

	// Mod icons are buttons before the username that are neither badges nor our own.
	function findModIconSlot(line, username) {
		const buttons = [...line.querySelectorAll('button')].filter((b) => !b.closest(`[data-a-target="chat-badge"], .chat-line__username, .chat-line__icons, [data-a-target="chat-line-message-body"], .${MARK}`)
			&& (b.compareDocumentPosition(username) & Node.DOCUMENT_POSITION_FOLLOWING));
		if (!buttons.length) {
			return null;
		}
		let el = buttons[buttons.length - 1];
		while (el.parentElement && !el.parentElement.contains(username)) {
			el = el.parentElement;
		}
		return el;
	}

	function decorate(line) {
		if (line.querySelector(`.${MARK}`)) {
			return;
		}
		const data = getLineData(line);
		const cfg = data && setupForLine(data);
		if (!cfg || isSharedChatForeign(data)) {
			return;
		}
		ensureConnection(cfg);

		const group = document.createElement('span');
		group.className = MARK;
		// Stored on the group so state updates need no fiber walk.
		group.dataset.userId = data.userId;
		group.dataset.messageId = data.messageId;
		group.dataset.login = data.login;
		group.append(createButton('trust'), createButton('approve'));
		updateGroup(group);

		const username = line.querySelector('.chat-line__username');
		const modSlot = username && findModIconSlot(line, username);
		const container = line.querySelector('.chat-line__username-container');
		if (modSlot) {
			modSlot.after(group);
		}
		else if (container) {
			container.prepend(group);
		}
		else if (username) {
			username.before(group);
		}
	}

	function rescan(reset = false) {
		if (reset) {
			document.querySelectorAll(`.${MARK}`).forEach((el) => el.remove());
			const cfg = currentChannel ? setups[currentChannel] : null;
			if (!cfg || conn?.cfg !== cfg) {
				closeConnection();
			}
		}
		document.querySelectorAll('.chat-line__message').forEach(decorate);
	}

	/* ---------- SPA navigation & new lines ---------- */

	let currentPath = location.pathname;
	let currentChannel = channelFromPath(currentPath);

	function checkNavigation() {
		if (location.pathname === currentPath) {
			return;
		}
		currentPath = location.pathname;
		currentChannel = channelFromPath(currentPath);
		rescan(true);
	}

	new MutationObserver((mutations) => {
		checkNavigation();
		for (const m of mutations) {
			for (const node of m.addedNodes) {
				if (node.nodeType !== 1 || node.classList.contains(MARK)) {
					continue;
				}
				if (node.matches('.chat-line__message')) {
					decorate(node);
				}
				else if (node.querySelector) {
					node.querySelectorAll('.chat-line__message').forEach(decorate);
				}
			}
		}
	}).observe(document.body, { childList: true, subtree: true });

	window.addEventListener('popstate', checkNavigation);
	setInterval(checkNavigation, 1000);
	rescan();
})();
