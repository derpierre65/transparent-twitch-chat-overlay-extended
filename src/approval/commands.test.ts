import { describe, expect, it } from 'vitest';
import { parseApprovalCommand } from './commands';

describe('parseApprovalCommand', () => {
  it('reads trust-user and untrust-user', () => {
    expect(parseApprovalCommand('trust-user', { userId: '123', login: 'Name' })).toEqual({
      type: 'trust-user',
      userId: '123',
      login: 'name',
      by: null,
    });
    expect(parseApprovalCommand('untrust-user', { userId: '123', login: 'name' })?.type).toBe('untrust-user');
  });

  it('reads approve-message', () => {
    expect(
      parseApprovalCommand('approve-message', { messageId: 'd3121d49-2e6a', userId: '1', login: 'x' }),
    ).toEqual({ type: 'approve-message', messageId: 'd3121d49-2e6a', login: 'x', by: null });
  });

  it('takes the sender from the Ably clientId', () => {
    expect(parseApprovalCommand('trust-user', { userId: '1', login: 'a' }, 'ModName')).toMatchObject({ by: 'ModName' });
    expect(parseApprovalCommand('approve-message', { messageId: 'm' }, 'ModName')).toEqual({
      type: 'approve-message',
      messageId: 'm',
      login: null,
      by: 'ModName',
    });
    expect(parseApprovalCommand('trust-user', { userId: '1', login: 'a' }, 'x'.repeat(101))).toMatchObject({ by: null });
  });

  it('reads sync-request without data', () => {
    expect(parseApprovalCommand('sync-request', undefined)).toEqual({ type: 'sync-request' });
  });

  it('accepts data sent as a JSON string', () => {
    expect(parseApprovalCommand('trust-user', '{"userId":"1","login":"a"}')?.type).toBe('trust-user');
  });

  it('ignores unknown names and broken data', () => {
    expect(parseApprovalCommand('ban-user', { userId: '1', login: 'a' })).toBeNull();
    expect(parseApprovalCommand(undefined, { userId: '1', login: 'a' })).toBeNull();
    expect(parseApprovalCommand('trust-user', '{nope')).toBeNull();
    expect(parseApprovalCommand('trust-user', null)).toBeNull();
    expect(parseApprovalCommand('trust-user', ['1'])).toBeNull();
  });

  it('requires user ids as numeric strings', () => {
    expect(parseApprovalCommand('trust-user', { userId: 123, login: 'a' })).toBeNull();
    expect(parseApprovalCommand('trust-user', { userId: 'abc', login: 'a' })).toBeNull();
    expect(parseApprovalCommand('trust-user', { userId: '', login: 'a' })).toBeNull();
    expect(parseApprovalCommand('trust-user', { userId: '1' })).toBeNull();
  });

  it('requires the login of a trusted user to be a Twitch login', () => {
    expect(parseApprovalCommand('trust-user', { userId: '1', login: 'not a login' })).toBeNull();
    expect(parseApprovalCommand('trust-user', { userId: '1', login: '<img src=x>' })).toBeNull();
    expect(parseApprovalCommand('untrust-user', { userId: '1', login: 'a'.repeat(26) })).toBeNull();
    expect(parseApprovalCommand('trust-user', { userId: '1', login: 'A'.repeat(25) })).toMatchObject({
      login: 'a'.repeat(25),
    });
  });

  it('approves a message without naming a login that is not a Twitch login', () => {
    expect(parseApprovalCommand('approve-message', { messageId: 'm', login: 'not a login' })).toEqual({
      type: 'approve-message',
      messageId: 'm',
      login: null,
      by: null,
    });
  });

  it('requires a message id as string', () => {
    expect(parseApprovalCommand('approve-message', { messageId: 5 })).toBeNull();
    expect(parseApprovalCommand('approve-message', { messageId: '' })).toBeNull();
    expect(parseApprovalCommand('approve-message', { messageId: 'x'.repeat(101) })).toBeNull();
  });
});
