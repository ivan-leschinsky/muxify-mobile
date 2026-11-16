import { topicId } from './environment';
import { parseSessionPathRows, parseSessionPaths, sessionPathRowsJson, sessionPathSections } from './session-paths';

const id = topicId('topic', 'id');
const row = {
  kind: 'session_path', name: 'project', label: 'Project', directory: '/work/project',
  worktree: null, in_this_topic: false, also_in: [], last_visit: null,
};
const response = (rows: unknown[]) => ({ topic: { id, label: 'Topic' }, rows, sessions: null });

it('keeps kind independent of nullable Worktree metadata and ignores unused fields', () => {
  expect(parseSessionPaths(response([
    { ...row, worktree: { path: '/work/project', branch: null } },
    { ...row, kind: 'worktree', last_visit: 'unused' },
  ]), id)).toEqual([
    { kind: 'session_path', name: 'project', label: 'Project', directory: '/work/project',
      worktree: { path: '/work/project', branch: null }, inThisTopic: false, alsoIn: [] },
    { kind: 'worktree', name: 'project', label: 'Project', directory: '/work/project',
      worktree: null, inThisTopic: false, alsoIn: [] },
  ]);
});

it.each([
  [{ ...row, kind: 'other' }, 'rows[0].kind'],
  [{ ...row, in_this_topic: 1 }, 'rows[0].in_this_topic'],
  [{ ...row, worktree: { path: '/x', branch: 3 } }, 'rows[0].worktree.branch'],
  [{ ...row, also_in: [{ id: 'x', label: null }] }, 'rows[0].also_in[0].label'],
])('rejects a malformed used field', (value, path) => {
  expect(() => parseSessionPaths(response([value]), id)).toThrow(path);
});

it('rejects another Topic response', () => {
  expect(() => parseSessionPaths({ ...response([]), topic: { id: 'other' } }, id)).toThrow('topic.id');
});

const choices = () => parseSessionPaths(response([
  { ...row, name: 'first', label: 'First alias', also_in: [{ id: 'other', label: 'Other work' }] },
  { ...row, name: 'branch', kind: 'worktree', worktree: { path: '/tree', branch: 'fix/login' } },
  { ...row, name: 'in-topic', kind: 'worktree', in_this_topic: true },
  { ...row, name: 'second', worktree: { path: '/bare/main', branch: null } },
]), id);

it('puts every choice in one section with Topic membership first and source order intact', () => {
  expect(sessionPathSections(choices(), '').map((section) => [section.title, section.choices.map((choice) => choice.name)]))
    .toEqual([['In this Topic', ['in-topic']], ['Session Paths', ['first', 'second']], ['Worktrees', ['branch']]]);
});

it.each(['FIRST', 'alias', '/work/project', 'FIX/LOGIN', 'OTHER WORK'])('searches %s without case', (query) => {
  expect(sessionPathSections(choices(), query).flatMap((section) => section.choices).length).toBeGreaterThan(0);
});

it('omits empty sections and does not change a selected directory', () => {
  const value = parseSessionPaths(response([{ ...row, directory: ' /exact folder/ ' }]), id);
  expect(sessionPathSections(value, 'exact')[0].choices[0].directory).toBe(' /exact folder/ ');
  expect(sessionPathSections(value, 'missing')).toEqual([]);
});

describe('the rows of `session-paths`, which has no Topic', () => {
  const { in_this_topic: _, ...ranked } = row;
  const visited = { ...ranked, kind: 'worktree', worktree: { path: '/work/project', branch: 'fix' },
    also_in: [{ id: 't1', label: 'Fix login' }], last_visit: '2026-11-14T09:00:00Z' };

  it('keeps the order of the Host, the last visit, and needs no in_this_topic', () => {
    expect(parseSessionPathRows({ rows: [visited, ranked] })).toEqual([
      { kind: 'worktree', name: 'project', label: 'Project', directory: '/work/project',
        worktree: { path: '/work/project', branch: 'fix' }, alsoIn: [{ id: 't1', label: 'Fix login' }], lastVisit: '2026-11-14T09:00:00Z' },
      { kind: 'session_path', name: 'project', label: 'Project', directory: '/work/project',
        worktree: null, alsoIn: [], lastVisit: null },
    ]);
  });

  it.each([
    [{ ...ranked, last_visit: 3 }, 'rows[0].last_visit'],
    [{ ...ranked, last_visit: undefined }, 'rows[0].last_visit'],
    [{ ...ranked, directory: null }, 'rows[0].directory'],
  ])('rejects a malformed used field', (value, path) => {
    expect(() => parseSessionPathRows({ rows: [value] })).toThrow(path);
  });

  it('writes the rows so that the same parse reads them back', () => {
    const rows = parseSessionPathRows({ rows: [visited, ranked] });
    expect(parseSessionPathRows(JSON.parse(JSON.stringify(sessionPathRowsJson(rows))))).toEqual(rows);
  });
});
