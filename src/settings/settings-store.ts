import { DEFAULT_SETTINGS, parseSettings, type Settings } from './settings';

export interface SettingsFile {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<Settings>;
}

export function createSettingsStore(file: SettingsFile): SettingsStore {
  let writes: Promise<void> = Promise.resolve();
  function ordered<T>(work: () => Promise<T>): Promise<T> {
    const result = writes.then(work);
    writes = result.then(() => {}, () => {});
    return result;
  }

  async function read(): Promise<Settings> {
    const contents = await file.read();
    if (contents === null) return DEFAULT_SETTINGS;
    const raw: unknown = JSON.parse(contents);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('Saved settings must be an object.');
    }
    return parseSettings(raw);
  }

  return {
    load() {
      return ordered(() => read().catch(() => DEFAULT_SETTINGS));
    },
    save(settings) {
      const clean = parseSettings(settings);
      return ordered(async () => {
        await file.write(JSON.stringify(clean));
        return clean;
      });
    },
  };
}
