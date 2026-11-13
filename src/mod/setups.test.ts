import { beforeEach, describe, expect, it } from 'vitest';
import { encodeSetupCode } from '../setup-code';
import { memoryStorage } from '../test/helpers';
import { createSetupStore } from './setups';

const code = (twitchChannel: string, modName = 'Mod', ablyKey = 'app.key:secret') =>
  encodeSetupCode({ twitchChannel, ablyChannel: 'overlay-approval', ablyKey, modName });

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
});

describe('setup store', () => {
  it('saves several codes and selects the one added last', () => {
    const store = createSetupStore(storage);
    store.add(code('alice'));
    store.add(code('bob'));

    expect(store.list().map((s) => s.twitchChannel)).toEqual(['alice', 'bob']);
    expect(store.selected()?.twitchChannel).toBe('bob');
  });

  it('replaces a code for the same channel, Ably channel and name', () => {
    const store = createSetupStore(storage);
    store.add(code('alice', 'Mod', 'app.key:old'));
    store.add(code('alice', 'Mod', 'app.key:new'));

    expect(store.list()).toHaveLength(1);
    expect(store.selected()?.ablyKey).toBe('app.key:new');
  });

  it('falls back to the first code once the selected one is removed', () => {
    const store = createSetupStore(storage);
    store.add(code('alice'));
    const bob = store.add(code('bob'));
    store.remove(bob.id);

    expect(store.selected()?.twitchChannel).toBe('alice');
  });

  it('rejects invalid codes with a readable message', () => {
    const store = createSetupStore(storage);
    expect(() => store.add('nope')).toThrow(/setup code/);
    expect(() => store.add(code('alice', 'overlay'))).toThrow(/reserved/);
    expect(store.list()).toEqual([]);
  });

  it('ignores broken storage', () => {
    storage.setItem('mod.setups', '{oops');
    expect(createSetupStore(storage).list()).toEqual([]);
  });
});
