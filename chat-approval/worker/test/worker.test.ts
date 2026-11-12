import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';

const SECRET = 'test-secret-0123456789abcdefghijklmnopqrs';
const BASE = 'https://trust.example.workers.dev';
const AT = '2026-11-12T10:00:00.000Z';
const METHODS = 'GET, PUT, PATCH, OPTIONS';

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

function makeEnv(secret: string | undefined | null = SECRET, limiter?: Limiter) {
	const store = new Map<string, string>();
	const calls = { get: 0, put: 0 };
	const env = {
		OVERLAY_SECRET: secret ?? undefined,
		RATE_LIMITER: limiter,
		TRUST_KV: {
			async get(key: string) {
				calls.get++;
				return store.get(key) ?? null;
			},
			async put(key: string, value: string) {
				calls.put++;
				store.set(key, value);
			},
		},
	};

	return { env, store, calls };
}

function req(method: string, path: string, opts: { auth?: string | null; body?: BodyInit; headers?: Record<string, string> } = {}) {
	const headers: Record<string, string> = { ...(opts.headers ?? {}) };
	const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
	if (auth !== null) {
		headers.Authorization = auth;
	}
	const init: RequestInit & { duplex?: string } = { method, headers };
	if (opts.body !== undefined) {
		init.body = opts.body;
		init.duplex = 'half';
	}

	return new Request(BASE + path, init);
}

const validBody = {
	users: {
		'12345': { login: 'alice', trustedAt: '2026-11-12T10:00:00.000Z' },
		'67890': { login: 'bob', trustedAt: '2026-11-12T11:00:00.000Z' },
	},
};

function assertCors(res: Response) {
	assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
}

test('OPTIONS preflight without auth -> 204 with CORS', async () => {
	const { env, calls } = makeEnv();
	const res = await worker.fetch(req('OPTIONS', '/trusted/foo', { auth: null }), env);
	assert.equal(res.status, 204);
	assertCors(res);
	assert.equal(res.headers.get('Access-Control-Allow-Methods'), METHODS);
	assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
	assert.equal(calls.get + calls.put, 0);
});

test('GET on empty key -> {"users":{}}', async () => {
	const { env } = makeEnv();
	const res = await worker.fetch(req('GET', '/trusted/foo'), env);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('Content-Type'), 'application/json');
	assert.equal(res.headers.get('Cache-Control'), 'no-store');
	assertCors(res);
	assert.deepEqual(await res.json(), { users: {} });
});

test('PUT then GET round-trip, uppercase channel stored lowercase, one put', async () => {
	const { env, store, calls } = makeEnv();
	const put = await worker.fetch(req('PUT', '/trusted/FooBar_1', {
		body: JSON.stringify(validBody),
		headers: { 'Content-Type': 'application/json' },
	}), env);
	assert.equal(put.status, 204);
	assertCors(put);
	assert.equal(await put.text(), '');
	assert.equal(calls.put, 1);
	assert.equal(calls.get, 0);
	assert.ok(store.has('trusted:foobar_1'));

	const get = await worker.fetch(req('GET', '/trusted/foobar_1'), env);
	assert.equal(get.status, 200);
	assert.deepEqual(await get.json(), validBody);
	assert.equal(calls.put, 1);
});

test('PUT strips extra fields from entries', async () => {
	const { env, store } = makeEnv();
	const body = { users: { '1': { login: 'x', trustedAt: AT, evil: 'y' }, '2': { login: 'z', trustedAt: AT, trustedBy: 'Mod' } }, extra: true };
	const res = await worker.fetch(req('PUT', '/trusted/foo', { body: JSON.stringify(body) }), env);
	assert.equal(res.status, 204);
	assert.deepEqual(JSON.parse(store.get('trusted:foo')!), {
		users: { '1': { login: 'x', trustedAt: AT }, '2': { login: 'z', trustedAt: AT, trustedBy: 'Mod' } },
	});
});

test('PUT empty users list is allowed', async () => {
	const { env, store } = makeEnv();
	const res = await worker.fetch(req('PUT', '/trusted/foo', { body: '{"users":{}}' }), env);
	assert.equal(res.status, 204);
	assert.equal(store.get('trusted:foo'), '{"users":{}}');
});

test('auth: missing / wrong / wrong scheme / empty token -> 401 with CORS, no KV access', async () => {
	for (const auth of [null, 'Bearer wrong', `Basic ${SECRET}`, 'Bearer ', SECRET, `Bearer ${SECRET}x`]) {
		const { env, calls } = makeEnv();
		for (const method of ['GET', 'PUT', 'PATCH']) {
			const res = await worker.fetch(req(method, '/trusted/foo', {
				auth,
				body: method === 'GET' ? undefined : JSON.stringify(validBody),
			}), env);
			assert.equal(res.status, 401, `${method} auth=${auth}`);
			assertCors(res);
		}
		assert.equal(calls.get + calls.put, 0);
	}
});

test('auth: bearer scheme is case-insensitive', async () => {
	const { env } = makeEnv();
	const res = await worker.fetch(req('GET', '/trusted/foo', { auth: `bearer ${SECRET}` }), env);
	assert.equal(res.status, 200);
});

test('missing OVERLAY_SECRET never authorizes', async () => {
	for (const secret of [null, '']) {
		const { env, calls } = makeEnv(secret);
		for (const auth of [null, 'Bearer ', 'Bearer undefined', 'Bearer x']) {
			const res = await worker.fetch(req('GET', '/trusted/foo', { auth }), env);
			assert.equal(res.status, 500);
			assertCors(res);
		}
		assert.equal(calls.get, 0);
	}
});

test('a secret shorter than 32 characters counts as not configured', async () => {
	const short = 'x'.repeat(31);
	const { env, calls } = makeEnv(short);
	const res = await worker.fetch(req('GET', '/trusted/foo', { auth: `Bearer ${short}` }), env);
	assert.equal(res.status, 500);
	assert.equal(calls.get, 0);

	const long = 'x'.repeat(32);
	const ok = await worker.fetch(req('GET', '/trusted/foo', { auth: `Bearer ${long}` }), makeEnv(long).env);
	assert.equal(ok.status, 200);
});

test('rate limiter: a client over the limit gets 429, even with the right secret', async () => {
	const keys: string[] = [];
	const limiter = {
		async limit({ key }: { key: string }) {
			keys.push(key);
			return { success: keys.length <= 2 };
		},
	};
	const { env, calls } = makeEnv(SECRET, limiter);
	const from = { headers: { 'CF-Connecting-IP': '203.0.113.7' } };

	assert.equal((await worker.fetch(req('GET', '/trusted/foo', { ...from, auth: 'Bearer wrong' }), env)).status, 401);
	assert.equal((await worker.fetch(req('GET', '/trusted/foo', from), env)).status, 200);
	const limited = await worker.fetch(req('GET', '/trusted/foo', from), env);
	assert.equal(limited.status, 429);
	assert.equal(limited.headers.get('Retry-After'), '60');
	assertCors(limited);
	assert.deepEqual(keys, ['203.0.113.7', '203.0.113.7', '203.0.113.7']);
	assert.equal(calls.get, 1);
});

test('rate limiter: preflight requests are not counted', async () => {
	let count = 0;
	const limiter = {
		async limit() {
			count++;
			return { success: false };
		},
	};
	const { env } = makeEnv(SECRET, limiter);
	const res = await worker.fetch(req('OPTIONS', '/trusted/foo', { auth: null }), env);
	assert.equal(res.status, 204);
	assert.equal(count, 0);
});

test('invalid channel -> 400', async () => {
	const { env, calls } = makeEnv();
	for (const ch of ['a'.repeat(26), 'foo-bar', 'foo.bar', '%C3%A4', 'foo%20bar']) {
		const res = await worker.fetch(req('GET', `/trusted/${ch}`), env);
		assert.equal(res.status, 400, ch);
		assertCors(res);
	}
	assert.equal(calls.get, 0);
});

test('unknown routes -> 404', async () => {
	const { env } = makeEnv();
	for (const path of ['/', '/trusted', '/trusted/', '/trusted/foo/bar', '/other/foo', '/trusted/foo/']) {
		const res = await worker.fetch(req('GET', path), env);
		assert.equal(res.status, 404, path);
		assertCors(res);
	}
});

test('wrong method -> 405 with Allow header', async () => {
	const { env } = makeEnv();
	for (const method of ['POST', 'DELETE']) {
		const res = await worker.fetch(req(method, '/trusted/foo', { body: method === 'DELETE' ? undefined : '{}' }), env);
		assert.equal(res.status, 405, method);
		assert.equal(res.headers.get('Allow'), METHODS);
		assertCors(res);
	}
});

const entry = (fields: object) => JSON.stringify({ login: 'a', trustedAt: AT, ...fields });

// Entries that neither PUT nor PATCH may store.
const badEntries = [
	'null',
	'[]',
	'{"login":"a"}',
	`{"trustedAt":"${AT}"}`,
	entry({ login: 1 }),
	entry({ login: 'Alice' }),
	entry({ login: 'a b' }),
	entry({ login: '<img>' }),
	entry({ login: 'a'.repeat(26) }),
	entry({ trustedAt: 123 }),
	entry({ trustedAt: 't' }),
	entry({ trustedAt: '2026-13-45T10:00:00.000Z' }),
	entry({ trustedAt: `${AT} and more` }),
	entry({ trustedBy: 5 }),
	entry({ trustedBy: 'x'.repeat(101) }),
];

test('invalid PUT bodies -> 400, no KV write', async () => {
	const { env, calls } = makeEnv();
	const bad = [
		'',
		'not json',
		'null',
		'[]',
		'"x"',
		'{}',
		'{"users":null}',
		'{"users":[]}',
		'{"users":"x"}',
		`{"users":{"abc":${entry({})}}}`,
		`{"users":{"-1":${entry({})}}}`,
		`{"users":{"__proto__":${entry({})}}}`,
		...badEntries.map((bad) => `{"users":{"1":${bad}}}`),
	];
	for (const body of bad) {
		const res = await worker.fetch(req('PUT', '/trusted/foo', { body }), env);
		assert.equal(res.status, 400, `body=${body}`);
		assertCors(res);
	}
	const noBody = await worker.fetch(req('PUT', '/trusted/foo'), env);
	assert.equal(noBody.status, 400);
	assert.equal(calls.put, 0);
});

test('PUT accepts a mod name of 100 characters', async () => {
	const { env } = makeEnv();
	const body = `{"users":{"1":${entry({ trustedBy: 'x'.repeat(100) })}}}`;
	const res = await worker.fetch(req('PUT', '/trusted/foo', { body }), env);
	assert.equal(res.status, 204);
});

test('PATCH changes only the named users', async () => {
	const { env, store, calls } = makeEnv();
	store.set('trusted:foo', JSON.stringify(validBody));
	const patch = { set: { '3': { login: 'carol', trustedAt: AT, trustedBy: 'Mod', evil: 'y' } }, remove: ['12345', '999'] };
	const res = await worker.fetch(req('PATCH', '/trusted/Foo', { body: JSON.stringify(patch) }), env);
	assert.equal(res.status, 204);
	assertCors(res);
	assert.deepEqual(JSON.parse(store.get('trusted:foo')!), {
		users: {
			'67890': { login: 'bob', trustedAt: '2026-11-12T11:00:00.000Z' },
			'3': { login: 'carol', trustedAt: AT, trustedBy: 'Mod' },
		},
	});
	assert.deepEqual(calls, { get: 1, put: 1 });
});

test('PATCH on a channel without a list creates it', async () => {
	const { env, store } = makeEnv();
	const res = await worker.fetch(req('PATCH', '/trusted/foo', { body: `{"set":{"1":${entry({})}}}` }), env);
	assert.equal(res.status, 204);
	assert.deepEqual(JSON.parse(store.get('trusted:foo')!), { users: { '1': { login: 'a', trustedAt: AT } } });
});

test('PATCH without changes does not write', async () => {
	const { env, calls } = makeEnv();
	for (const body of ['{}', '{"set":{},"remove":[]}']) {
		const res = await worker.fetch(req('PATCH', '/trusted/foo', { body }), env);
		assert.equal(res.status, 204, body);
	}
	assert.equal(calls.put, 0);
});

test('invalid PATCH bodies -> 400, no KV write', async () => {
	const { env, calls } = makeEnv();
	const bad = [
		'',
		'not json',
		'null',
		'[]',
		'{"set":[]}',
		'{"set":null}',
		'{"remove":{}}',
		'{"remove":"1"}',
		'{"remove":[1]}',
		'{"remove":["abc"]}',
		`{"set":{"abc":${entry({})}}}`,
		...badEntries.map((bad) => `{"set":{"1":${bad}}}`),
	];
	for (const body of bad) {
		const res = await worker.fetch(req('PATCH', '/trusted/foo', { body }), env);
		assert.equal(res.status, 400, `body=${body}`);
		assertCors(res);
	}
	assert.equal(calls.put, 0);
});

test('PATCH that grows the list past the size limit -> 413, no KV write', async () => {
	const { env, store, calls } = makeEnv();
	const user = (i: number) => ({ login: `user${i}`, trustedAt: AT, trustedBy: 'x'.repeat(60) });
	const users: Record<string, object> = {};
	let size = '{"users":{}}'.length;
	let next = 0;
	for (; ; next++) {
		const add = `"${next}":${JSON.stringify(user(next))},`.length;
		if (size + add > 512 * 1024) {
			break;
		}
		users[String(next)] = user(next);
		size += add;
	}
	const stored = JSON.stringify({ users });
	assert.ok(stored.length > 512 * 1024 - 200 && stored.length <= 512 * 1024, `fixture is ${stored.length} bytes`);
	store.set('trusted:foo', stored);

	const set = { [String(next)]: user(next), [String(next + 1)]: user(next + 1) };
	const res = await worker.fetch(req('PATCH', '/trusted/foo', { body: JSON.stringify({ set }) }), env);
	assert.equal(res.status, 413);
	assert.equal(calls.put, 0);
});

test('oversized body via Content-Length -> 413', async () => {
	const { env, calls } = makeEnv();
	const res = await worker.fetch(req('PUT', '/trusted/foo', {
		body: '{}',
		headers: { 'Content-Length': String(512 * 1024 + 1) },
	}), env);
	assert.equal(res.status, 413);
	assertCors(res);
	assert.equal(calls.put, 0);
});

test('oversized streamed body without Content-Length -> 413', async () => {
	const { env, calls } = makeEnv();
	const chunk = new Uint8Array(64 * 1024).fill(0x20);
	let sent = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent >= 10) {
				controller.close();
				return;
			}
			sent++;
			controller.enqueue(chunk);
		},
	});
	const request = req('PUT', '/trusted/foo', { body: stream });
	assert.equal(request.headers.get('Content-Length'), null);
	const res = await worker.fetch(request, env);
	assert.equal(res.status, 413);
	assert.equal(calls.put, 0);
});

test('body just under the limit is accepted', async () => {
	const { env } = makeEnv();
	const entry = (i: number) => `"${i}":{"login":"user${i}","trustedAt":"2026-11-12T10:00:00.000Z"}`;
	const parts: string[] = [];
	let size = '{"users":{}}'.length;
	for (let i = 0; ; i++) {
		const add = entry(i).length + (i > 0 ? 1 : 0);
		if (size + add > 512 * 1024) {
			break;
		}
		parts.push(entry(i));
		size += add;
	}
	const body = `{"users":{${parts.join(',')}}}`;
	assert.ok(body.length > 512 * 1024 - 100 && body.length <= 512 * 1024);
	const res = await worker.fetch(req('PUT', '/trusted/foo', { body }), env);
	assert.equal(res.status, 204);
});
