import { describe, expect, it } from 'vitest';
import { createApprovalLog, splitState } from './state';

describe('splitState', () => {
  it('sends a small state as one resetting part', () => {
    expect(splitState([['1', { login: 'a', by: 'Mod' }]], [['m', { login: 'b', by: null }]])).toEqual([
      { reset: true, trusted: { '1': { login: 'a', by: 'Mod' } }, approved: { m: { login: 'b', by: null } } },
    ]);
  });

  it('splits a large state, only the first part resets', () => {
    const trusted = Array.from({ length: 50 }, (_, i): [string, { login: string; by: string | null }] => [
      String(i),
      { login: `user${i}`, by: 'Mod' },
    ]);
    const parts = splitState(trusted, [], 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.reset)).toEqual([true, ...parts.slice(1).map(() => false)]);
    expect(parts.every((p) => JSON.stringify(p).length <= 500)).toBe(true);
    expect(Object.assign({}, ...parts.map((p) => p.trusted))).toEqual(Object.fromEntries(trusted));
  });
});

describe('createApprovalLog', () => {
  it('reports duplicates and forgets old approvals', () => {
    let time = 0;
    const log = createApprovalLog({ now: () => time, maxAgeMs: 1000 });
    expect(log.add('m1', { login: 'a', by: 'Mod' })).toBe(true);
    expect(log.add('m1', { login: 'a', by: 'Other' })).toBe(false);
    time = 500;
    log.add('m2', { login: null, by: null });
    time = 1200;
    expect(log.entries()).toEqual([['m2', { login: null, by: null }]]);
  });

  it('keeps at most max entries', () => {
    const log = createApprovalLog({ max: 2 });
    log.add('a', { login: null, by: null });
    log.add('b', { login: null, by: null });
    log.add('c', { login: null, by: null });
    expect(log.entries().map(([id]) => id)).toEqual(['b', 'c']);
  });
});
