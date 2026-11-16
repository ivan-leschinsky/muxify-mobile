import type { SessionPathRow } from '@/topics/session-paths';

import { createGoToCache } from './go-to-cache';
import type { JsonFile } from './store';

function memoryFile(initial: string | null = null) {
  let contents = initial;
  const file: JsonFile = { read: async () => contents, write: async (next) => { contents = next; } };
  return { file, contents: () => contents };
}

const row = (name: string): SessionPathRow => ({
  kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: '2026-11-14T09:00:00Z',
});

describe('the Go to paths the phone keeps for each Host', () => {
  it('gives back the rows of a Host in their order, after a restart too', async () => {
    const { file } = memoryFile();
    await createGoToCache(file).save('mac', [row('b'), row('a')]);

    expect(await createGoToCache(file).load('mac')).toEqual([row('b'), row('a')]);
  });

  it('keeps each Host its own rows', async () => {
    const { file } = memoryFile();
    const cache = createGoToCache(file);
    await cache.save('mac', [row('a')]);
    await cache.save('linux', [row('b')]);

    expect(await cache.load('mac')).toEqual([row('a')]);
    expect(await cache.load('linux')).toEqual([row('b')]);
    expect(await cache.load('other')).toEqual([]);
  });

  it('drops the rows of a Host that is no longer saved, and keeps the others', async () => {
    const { file } = memoryFile();
    const cache = createGoToCache(file);
    await cache.save('mac', [row('a')]);
    await cache.save('linux', [row('b')]);

    await cache.forget('mac');

    expect(await cache.load('mac')).toEqual([]);
    expect(await cache.load('linux')).toEqual([row('b')]);
  });

  it.each(['{ not json', '[]', JSON.stringify({ mac: { rows: [{ kind: 'session_path' }] } })])(
    'has no rows for a file it cannot read, and writes over it: %s',
    async (contents) => {
      const { file } = memoryFile(contents);
      const cache = createGoToCache(file);

      expect(await cache.load('mac')).toEqual([]);
      await cache.save('mac', [row('a')]);
      expect(await cache.load('mac')).toEqual([row('a')]);
    },
  );
});
