interface KV {
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
}

interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
	TRUST_KV: KV;
	OVERLAY_SECRET?: string;
	/** Optional: without the binding, requests are not limited. */
	RATE_LIMITER?: RateLimiter;
}

const MAX_BODY_BYTES = 512 * 1024;
// A shorter secret could be found by trying.
const MIN_SECRET_LENGTH = 32;
const METHODS = 'GET, PUT, PATCH, OPTIONS';
const CHANNEL_RE = /^[a-z0-9_]{1,25}$/;
const USER_ID_RE = /^\d{1,20}$/;
// Same rules as the overlay (src/approval/commands.ts), so its saves are never rejected.
const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_NAME_LENGTH = 100;

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': METHODS,
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
	'Access-Control-Max-Age': '86400',
};

function respond(status: number, body: string | null = null, extra: Record<string, string> = {}): Response {
	const headers: Record<string, string> = { ...CORS_HEADERS, ...extra };
	if (body !== null) {
		headers['Content-Type'] ??= 'application/json';
	}

	return new Response(body, { status, headers });
}

function error(status: number, message: string, extra: Record<string, string> = {}): Response {
	return respond(status, JSON.stringify({ error: message }), extra);
}

class HttpError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

// Hashing first makes the comparison independent of the token length.
async function isAuthorized(request: Request, secret: string): Promise<boolean> {
	const header = request.headers.get('Authorization') ?? '';
	const match = /^Bearer (.+)$/i.exec(header);
	if (!match) {
		return false;
	}

	const [a, b] = await Promise.all([sha256(match[1]), sha256(secret)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}

	return diff === 0;
}

// Content-Length may be missing (chunked), so the stream is counted too.
async function readBody(request: Request): Promise<string> {
	const declared = Number(request.headers.get('Content-Length'));
	if (declared > MAX_BODY_BYTES) {
		throw new HttpError(413, 'payload too large');
	}
	if (!request.body) {
		throw new HttpError(400, 'missing body');
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel();
			throw new HttpError(413, 'payload too large');
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new TextDecoder().decode(bytes);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLogin(value: unknown): value is string {
	return typeof value === 'string' && LOGIN_RE.test(value);
}

function isTimestamp(value: unknown): value is string {
	return typeof value === 'string' && TIMESTAMP_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function isName(value: unknown): value is string {
	return typeof value === 'string' && value.length <= MAX_NAME_LENGTH;
}

type TrustedUsers = Record<string, { login: string; trustedAt: string; trustedBy?: string }>;

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	}
	catch {
		throw new HttpError(400, 'invalid json');
	}
}

function parseUsers(entries: Record<string, unknown>): TrustedUsers {
	const users: TrustedUsers = {};
	for (const [userId, entry] of Object.entries(entries)) {
		if (!USER_ID_RE.test(userId)) {
			throw new HttpError(400, `invalid user id: ${userId.slice(0, 32)}`);
		}
		if (!isPlainObject(entry) || !isLogin(entry.login) || !isTimestamp(entry.trustedAt)) {
			throw new HttpError(400, `invalid entry for user ${userId}`);
		}
		if (entry.trustedBy !== undefined && !isName(entry.trustedBy)) {
			throw new HttpError(400, `invalid entry for user ${userId}`);
		}
		users[userId] = { login: entry.login, trustedAt: entry.trustedAt };
		if (entry.trustedBy) {
			users[userId].trustedBy = entry.trustedBy;
		}
	}

	return users;
}

function parseTrustedList(raw: string): TrustedUsers {
	const data = parseJson(raw);
	if (!isPlainObject(data) || !isPlainObject(data.users)) {
		throw new HttpError(400, 'body must be { "users": { ... } }');
	}

	return parseUsers(data.users);
}

function parsePatch(raw: string): { set: TrustedUsers; remove: string[] } {
	const data = parseJson(raw);
	const { set = {}, remove = [] } = isPlainObject(data) ? data : { set: null };
	if (!isPlainObject(set) || !Array.isArray(remove) || !remove.every((id) => typeof id === 'string' && USER_ID_RE.test(id))) {
		throw new HttpError(400, 'body must be { "set": { ... }, "remove": [ ... ] }');
	}

	return { set: parseUsers(set), remove };
}

function storedUsers(stored: string | null): TrustedUsers {
	const data: unknown = stored === null ? null : JSON.parse(stored);

	return isPlainObject(data) && isPlainObject(data.users) ? (data.users as TrustedUsers) : {};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);
		const route = /^\/trusted\/([^/]+)$/.exec(pathname);
		if (!route) {
			return error(404, 'not found');
		}

		if (request.method === 'OPTIONS') {
			return respond(204);
		}
		if (request.method !== 'GET' && request.method !== 'PUT' && request.method !== 'PATCH') {
			return error(405, 'method not allowed', { Allow: METHODS });
		}

		if (!env.OVERLAY_SECRET || env.OVERLAY_SECRET.length < MIN_SECRET_LENGTH) {
			return error(500, 'server not configured');
		}
		// Before the secret is compared, so guessing is limited as well.
		if (env.RATE_LIMITER) {
			const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
			if (!success) {
				return error(429, 'too many requests', { 'Retry-After': '60' });
			}
		}
		if (!(await isAuthorized(request, env.OVERLAY_SECRET))) {
			return error(401, 'unauthorized');
		}

		const channel = route[1].toLowerCase();
		if (!CHANNEL_RE.test(channel)) {
			return error(400, 'invalid channel');
		}
		const key = `trusted:${channel}`;

		try {
			if (request.method === 'GET') {
				const stored = await env.TRUST_KV.get(key);

				return respond(200, stored ?? '{"users":{}}', { 'Cache-Control': 'no-store' });
			}

			if (request.method === 'PUT') {
				const users = parseTrustedList(await readBody(request));
				await env.TRUST_KV.put(key, JSON.stringify({ users }));

				return respond(204);
			}

			// Only the named users change, so a client with a stale list cannot bring back
			// what another one removed. KV has no transactions: two patches at the same moment can still lose one.
			const patch = parsePatch(await readBody(request));
			if (Object.keys(patch.set).length === 0 && patch.remove.length === 0) {
				return respond(204);
			}
			const users = storedUsers(await env.TRUST_KV.get(key));
			for (const userId of patch.remove) {
				delete users[userId];
			}
			const value = JSON.stringify({ users: { ...users, ...patch.set } });
			if (new TextEncoder().encode(value).byteLength > MAX_BODY_BYTES) {
				throw new HttpError(413, 'list too large');
			}
			await env.TRUST_KV.put(key, value);

			return respond(204);
		}
		catch (e) {
			if (e instanceof HttpError) {
				return error(e.status, e.message);
			}

			return error(500, 'internal error');
		}
	},
};
