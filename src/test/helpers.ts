import { vi } from 'vitest';

export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Fetch stub returning the responses in order; an `Error` is thrown. */
export function fetchSequence(...responses: (Response | Error | (() => Response))[]) {
  const queue = [...responses];
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
}

export function sentBody(fetchFn: ReturnType<typeof fetchSequence>, call = 0): URLSearchParams {
  return fetchFn.mock.calls[call]?.[1]?.body as URLSearchParams;
}
