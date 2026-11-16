import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { SessionPathRow } from '@/topics/session-paths';

import { useGoToPaths } from './use-go-to-paths';

const mockCached = jest.fn();
const mockSave = jest.fn();
const mockPaths = jest.fn();
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
  deviceGoToCache: () => ({ load: mockCached, save: mockSave }),
}));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({
  read: (_host: unknown, work: Function) => work({ exec: jest.fn() }, { rankedSessionPaths: mockPaths }),
}) }));

const row = (name: string): SessionPathRow => ({
  kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: null,
});
const listed = (...names: string[]) => ({ kind: 'listed', rows: names.map(row) });
const shown = () => ({ query: paths.paths.query, names: paths.paths.rows.map((each) => each.name) });

let renderer: ReactTestRenderer;
let paths: ReturnType<typeof useGoToPaths>;
async function mount(enabled = true, still = false) {
  function Screen({ still: now }: { still: boolean }) {
    paths = useGoToPaths('host', enabled, now);
    return null;
  }
  await act(async () => { renderer = create(<Screen still={still} />); });
  return (next: boolean) => act(async () => { renderer.update(<Screen still={next} />); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockCached.mockResolvedValue([]);
  mockSave.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  jest.useRealTimers();
});

it('shows the list the phone kept before the Host answers, and then the answer of the Host', async () => {
  mockCached.mockResolvedValue([row('kept')]);
  let answer!: (value: unknown) => void;
  mockPaths.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  await mount();
  await act(async () => { paths.ask(''); });

  expect(shown()).toEqual({ query: '', names: ['kept'] });
  expect(paths.reading).toEqual({ kind: 'reading' });

  await act(async () => { answer(listed('fresh', 'kept')); });
  expect(shown()).toEqual({ query: '', names: ['fresh', 'kept'] });
  expect(paths.reading).toEqual({ kind: 'idle' });
  expect(mockSave).toHaveBeenCalledWith('host', [row('fresh'), row('kept')]);
});

it('does not move the rows under the finger: a new answer for an empty field waits while the list is still', async () => {
  mockCached.mockResolvedValue([row('kept')]);
  mockPaths.mockResolvedValue(listed('fresh', 'kept'));
  const setStill = await mount(true, true);
  await act(async () => { paths.ask(''); });

  expect(shown().names).toEqual(['kept']);
  expect(mockSave).toHaveBeenCalled();

  await setStill(false);
  expect(shown().names).toEqual(['fresh', 'kept']);
});

it('shows the first answer at once when the phone kept no list', async () => {
  mockPaths.mockResolvedValue(listed('fresh'));
  await mount(true, true);
  await act(async () => { paths.ask(''); });

  expect(shown().names).toEqual(['fresh']);
});

it('asks the Host for the text when the field is still, and keeps no list for other text on the phone', async () => {
  mockPaths.mockResolvedValue(listed('gs-backend'));
  await mount();
  await act(async () => { paths.ask('g'); paths.ask('gs'); });
  expect(mockPaths).not.toHaveBeenCalled();

  await act(async () => { jest.runAllTimers(); });
  expect(mockPaths).toHaveBeenCalledTimes(1);
  expect(mockPaths.mock.calls[0][1]).toBe('gs');
  expect(shown()).toEqual({ query: 'gs', names: ['gs-backend'] });
  expect(mockSave).not.toHaveBeenCalled();
});

it('keeps the answer for the newest text when an older answer comes after it', async () => {
  const answers: ((value: unknown) => void)[] = [];
  mockPaths.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
  await mount();
  await act(async () => { paths.ask('a'); jest.runAllTimers(); });
  await act(async () => { paths.ask('ab'); jest.runAllTimers(); });

  await act(async () => { answers[1]!(listed('newest')); });
  await act(async () => { answers[0]!(listed('older')); });

  expect(shown()).toEqual({ query: 'ab', names: ['newest'] });
});

it('keeps the rows on show and says why when the Host cannot be read', async () => {
  mockCached.mockResolvedValue([row('kept')]);
  mockPaths.mockResolvedValue({ kind: 'failed', error: 'no Config' });
  await mount();
  await act(async () => { paths.ask(''); });

  expect(shown().names).toEqual(['kept']);
  expect(paths.reading).toEqual({ kind: 'failed', error: 'no Config' });
});

it('asks nothing of a Host CLI that has no Go to', async () => {
  await mount(false);
  await act(async () => { paths.ask(''); jest.runAllTimers(); });

  expect(mockCached).not.toHaveBeenCalled();
  expect(mockPaths).not.toHaveBeenCalled();
});
