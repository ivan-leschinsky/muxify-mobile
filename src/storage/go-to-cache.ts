import { parseSessionPathRows, sessionPathRowsJson, type SessionPathRow } from '@/topics/session-paths';

import type { JsonFile } from './store';

/**
 * The last Session Paths each Host listed for an empty Go to field, so that
 * Go to has a list to show before the Host answers. It is a copy and not a
 * record: a file that cannot be read is an empty list, and the next answer of
 * the Host writes it again.
 */
export interface GoToCache {
  /** The rows the Host last listed, in its order, or none. */
  load(hostId: string): Promise<SessionPathRow[]>;
  save(hostId: string, rows: readonly SessionPathRow[]): Promise<void>;
  /** Drops a Host's rows, for a Host that is no longer saved. */
  forget(hostId: string): Promise<void>;
}

export function createGoToCache(file: JsonFile): GoToCache {
  async function read(): Promise<Record<string, unknown>> {
    try {
      const parsed: unknown = JSON.parse((await file.read()) ?? '{}');
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
    } catch {
      return {};
    }
  }

  return {
    async load(hostId) {
      const byHost = await read();
      try {
        return Object.hasOwn(byHost, hostId) ? parseSessionPathRows(byHost[hostId]) : [];
      } catch {
        return [];
      }
    },
    async save(hostId, rows) {
      await file.write(JSON.stringify({ ...(await read()), [hostId]: sessionPathRowsJson(rows) }));
    },
    async forget(hostId) {
      const { [hostId]: dropped, ...rest } = await read();
      if (dropped !== undefined) await file.write(JSON.stringify(rest));
    },
  };
}
