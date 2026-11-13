import { describe, expect, it } from 'vitest';
import { createApprovalView } from './approval-view';

const msg = (name: string, data: unknown, clientId: unknown = 'Mod', connectionId: unknown = 'c-mod') => ({
  name,
  data,
  clientId,
  connectionId,
});

describe('approval view', () => {
  it('tracks trust, untrust and approvals with the mod name', () => {
    const view = createApprovalView();
    view.apply(msg('trust-user', { userId: '1', login: 'alice' }));
    view.apply(msg('approve-message', { messageId: 'm1', userId: '2', login: 'bob' }, 'Other'));

    expect(view.trusted.get('1')).toEqual({ login: 'alice', by: 'Mod' });
    expect(view.approved.get('m1')).toEqual({ login: 'bob', by: 'Other' });

    view.apply(msg('untrust-user', { userId: '1', login: 'alice' }));
    expect(view.trusted.has('1')).toBe(false);
  });

  it('accepts state only from a present overlay connection', () => {
    const view = createApprovalView();
    const state = { reset: true, trusted: { '1': { login: 'alice', by: 'Mod' } }, approved: {} };

    expect(view.apply(msg('state', state, 'overlay', 'c-fake'))).toBe(false);
    expect(view.presence(['c-overlay'])).toBe(true);
    expect(view.apply(msg('state', state, 'overlay', 'c-fake'))).toBe(false);
    expect(view.apply(msg('state', state, 'overlay', 'c-overlay'))).toBe(true);
    expect(view.trusted.get('1')).toEqual({ login: 'alice', by: 'Mod' });
  });

  it('drops the old state on reset', () => {
    const view = createApprovalView();
    view.presence(['c-overlay']);
    view.apply(msg('trust-user', { userId: '1', login: 'alice' }));
    view.apply(
      msg('state', { reset: true, trusted: { '2': { login: 'bob', by: null } }, approved: {} }, 'overlay', 'c-overlay'),
    );

    expect([...view.trusted.keys()]).toEqual(['2']);
  });

  it('asks for the state only when a new overlay connection shows up, and again after re-attach', () => {
    const view = createApprovalView();
    expect(view.overlayOnline).toBe(false);
    expect(view.presence(['a'])).toBe(true);
    expect(view.presence(['a'])).toBe(false);
    expect(view.overlayOnline).toBe(true);

    view.attached();
    expect(view.presence(['a'])).toBe(true);
    expect(view.presence([])).toBe(false);
    expect(view.overlayOnline).toBe(false);
  });

  it('does not report the overlay as the approving mod', () => {
    const view = createApprovalView();
    view.apply(msg('trust-user', JSON.stringify({ userId: '1', login: 'alice' }), 'overlay'));
    expect(view.trusted.get('1')?.by).toBeNull();
  });
});
