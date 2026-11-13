import { decodeSetupCode, type SetupCode } from '../setup-code';

const SETUPS_KEY = 'mod.setups';
const SELECTED_KEY = 'mod.selected';

export interface SavedSetup extends SetupCode {
  id: string;
}

export interface SetupStore {
  list(): SavedSetup[];
  /** Throws on an invalid code. A code for the same channel, Ably channel and name replaces the old one. */
  add(code: string): SavedSetup;
  remove(id: string): void;
  selected(): SavedSetup | null;
  select(id: string): void;
}

function idOf(setup: SetupCode): string {
  return `${setup.twitchChannel}|${setup.ablyChannel}|${setup.name}`;
}

export function setupLabel(setup: SetupCode): string {
  return `#${setup.twitchChannel} — ${setup.ablyChannel} (${setup.name || 'no name'})`;
}

export function createSetupStore(storage: Storage): SetupStore {
  function read(): SavedSetup[] {
    try {
      const parsed = JSON.parse(storage.getItem(SETUPS_KEY) ?? '[]') as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is SavedSetup =>
          typeof entry?.id === 'string' &&
          typeof entry.twitchChannel === 'string' &&
          typeof entry.ablyChannel === 'string' &&
          typeof entry.ablyKey === 'string' &&
          typeof entry.name === 'string',
      );
    } catch {
      return [];
    }
  }

  function write(setups: SavedSetup[]): void {
    storage.setItem(SETUPS_KEY, JSON.stringify(setups));
  }

  const list = (): SavedSetup[] => read().sort((a, b) => a.id.localeCompare(b.id));

  return {
    list,
    add(code) {
      const decoded = decodeSetupCode(code);
      const setup = { id: idOf(decoded), ...decoded };
      write([...read().filter((entry) => entry.id !== setup.id), setup]);
      storage.setItem(SELECTED_KEY, setup.id);
      return setup;
    },
    remove(id) {
      write(read().filter((entry) => entry.id !== id));
      if (storage.getItem(SELECTED_KEY) === id) storage.removeItem(SELECTED_KEY);
    },
    selected() {
      const setups = list();
      const id = storage.getItem(SELECTED_KEY);
      return setups.find((entry) => entry.id === id) ?? setups[0] ?? null;
    },
    select(id) {
      storage.setItem(SELECTED_KEY, id);
    },
  };
}
