import type { RecentSession } from '@/storage/records';
import type { SessionPathRow } from '@/topics/session-paths';

import { goToRows, pathOpening, type GoToRow, type GoToSession } from './go-to';

const session = (name: string, topicLabel: string | null = null): GoToSession => ({ name, topicLabel });
const path = (name: string, over: Partial<SessionPathRow> = {}): SessionPathRow => ({
  kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: null, ...over,
});
const opened = (name: string, lastOpenedAt: string): RecentSession => ({ hostId: 'host', name, lastOpenedAt });

/** Each row as one word: a Session by its name, a path by its name, a typed folder by its text. */
const names = (rows: GoToRow[]) =>
  rows.map((row) => (row.kind === 'session' ? `■${row.name}` : row.kind === 'path' ? `□${row.path.name}` : `~${row.directory}`));

const SESSIONS = [session('gs-backend'), session('reward-drop/fix', 'Fix reward drop bug in GS'), session('notes')];
const PATHS = [path('gs-backend'), path('muxify-mobile'), path('gs-analytics', { kind: 'worktree', worktree: { path: '/work/gs-analytics', branch: 'analytics' } })];

describe('the Go to list', () => {
  it('lists the running Sessions, then the paths in the order the Host ranked them', () => {
    expect(names(goToRows({ query: '', mode: 'all', sessions: SESSIONS, paths: { query: '', rows: PATHS }, recent: [] })))
      .toEqual(['■gs-backend', '■reward-drop/fix', '■notes', '□gs-backend', '□muxify-mobile', '□gs-analytics']);
  });

  it('puts the Sessions this phone opened first, newest first, and the rest in the order of tmux', () => {
    const recent = [opened('notes', '2026-11-14T10:00:00Z'), opened('reward-drop/fix', '2026-11-15T10:00:00Z'), opened('gone', '2026-11-15T11:00:00Z')];
    expect(names(goToRows({ query: '', mode: 'all', sessions: [...SESSIONS, session('zeta')], paths: { query: '', rows: [] }, recent })))
      .toEqual(['■reward-drop/fix', '■notes', '■gs-backend', '■zeta']);
  });

  it('lists no running Session for New Session at a folder', () => {
    expect(names(goToRows({ query: '', mode: 'paths', sessions: SESSIONS, paths: { query: '', rows: PATHS }, recent: [] })))
      .toEqual(['□gs-backend', '□muxify-mobile', '□gs-analytics']);
  });

  it('matches the running Sessions on the phone, by name or by Topic, with the letters in order', () => {
    const rows = (query: string) => names(goToRows({ query, mode: 'all', sessions: SESSIONS, paths: { query, rows: [] }, recent: [] }));
    expect(rows('gsb')).toEqual(['■gs-backend']);
    expect(rows('REWARD')).toEqual(['■reward-drop/fix']);
    expect(rows('drop bug')).toEqual(['■reward-drop/fix']);
    expect(rows('xyz')).toEqual([]);
  });

  it('keeps every path the Host ranked for the text in the field, also one the phone would not match', () => {
    const ranked = [path('muxify-mobile'), path('gs-backend')];
    expect(names(goToRows({ query: ' mob ', mode: 'paths', sessions: [], paths: { query: 'mob', rows: ranked }, recent: [] })))
      .toEqual(['□muxify-mobile', '□gs-backend']);
  });

  it('keeps the matching paths on hand, in their order, until the Host answers for the new text', () => {
    expect(names(goToRows({ query: 'gs', mode: 'paths', sessions: [], paths: { query: '', rows: PATHS }, recent: [] })))
      .toEqual(['□gs-backend', '□gs-analytics']);
    expect(names(goToRows({ query: 'analytics', mode: 'paths', sessions: [], paths: { query: 'gs', rows: PATHS }, recent: [] })))
      .toEqual(['□gs-analytics']);
  });

  it('puts the last visited first when the field is emptied before the Host answers', () => {
    const rows = [path('old', { lastVisit: '2026-11-01T00:00:00Z' }), path('never'), path('new', { lastVisit: '2026-11-15T00:00:00Z' }), path('never-2')];
    expect(names(goToRows({ query: '', mode: 'paths', sessions: [], paths: { query: 'e', rows }, recent: [] })))
      .toEqual(['□new', '□old', '□never', '□never-2']);
  });

  it.each(['~/Dev/new', '/srv/app', '~'])('ends with the folder %s that the user typed', (typed) => {
    expect(goToRows({ query: ` ${typed} `, mode: 'all', sessions: SESSIONS, paths: { query: typed, rows: [path('found')] }, recent: [] }))
      .toEqual([{ kind: 'path', path: path('found') }, { kind: 'typed', directory: typed }]);
  });

  it('has no typed folder for text that is not a path', () => {
    expect(names(goToRows({ query: 'dev', mode: 'paths', sessions: [], paths: { query: 'dev', rows: [] }, recent: [] }))).toEqual([]);
  });
});

describe('what a pick of a folder does', () => {
  const row: GoToRow & { kind: 'path' } = { kind: 'path', path: path('gs-backend') };

  it('goes to the Session in no Topic that runs at the folder, which has the name of the Session Path', () => {
    expect(pathOpening(row, ['notes', 'gs-backend'], false)).toEqual({ kind: 'go', directory: '/work/gs-backend', session: 'gs-backend' });
  });

  it('makes the Session when none runs there: a Session of a Topic has another name', () => {
    expect(pathOpening(row, ['gs-backend/fix-login'], false)).toEqual({ kind: 'new', directory: '/work/gs-backend', name: 'gs-backend' });
  });

  it('makes one more with the next free name for New Session here', () => {
    expect(pathOpening(row, ['gs-backend'], true)).toEqual({ kind: 'new', directory: '/work/gs-backend', name: 'gs-backend+2' });
    expect(pathOpening(row, ['gs-backend', 'gs-backend+2'], true)).toMatchObject({ name: 'gs-backend+3' });
    expect(pathOpening(row, [], true)).toMatchObject({ name: 'gs-backend' });
  });

  it('names a Session at a typed folder as the Host names a Session Path', () => {
    expect(pathOpening({ kind: 'typed', directory: '~/Dev/my app.v2/' }, [], false))
      .toEqual({ kind: 'new', directory: '~/Dev/my app.v2/', name: 'myapp_v2' });
  });
});
