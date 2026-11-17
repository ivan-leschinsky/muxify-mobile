import { fakeHostServer, snapshotPush, topicPush } from '@/test-support/fake-host-server';
import type { Host } from '@/storage/records';

import { sendTopicOrder, type TopicOrder } from './act-on-topic';
import type { SessionId, TopicId } from './environment';
import {
  addSession,
  addSessionCommand,
  changeTopic,
  createTopic,
  newSession,
  pushedListing,
  pushedTopic,
} from './host-writes';
import { newRequestId } from './request';

let mockServer = fakeHostServer();
const mockExecs: string[] = [];
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/tmux/ssh-connection', () => ({
  appConnections: () => ({
    onServer: mockServer.onServer,
    read: (_host: unknown, run: Function) => run({
      exec: async (command: string) => {
        mockExecs.push(command);
        return { stdout: '/Users/me\n', stderr: '', exitCode: 0 };
      },
    }),
  }),
}));

const HOST: Host = { id: 'h1', displayName: 'Mac', address: '10.0.0.1', port: 22, identityId: 'i1' };
const TOPIC = 't1' as TopicId;

beforeEach(() => {
  mockServer = fakeHostServer();
  mockExecs.length = 0;
});

/** The one write the Host Server got: its command, and the Topic it targets. */
function sent() {
  const writes = mockServer.writes();
  expect(writes).toHaveLength(1);
  return { command: writes[0]!.command, target: writes[0]!.target };
}

describe('the writes of the sheets', () => {
  it('New Topic sends `create`, with the Tags only when there are some, and answers the new Topic', async () => {
    mockServer.answer = () => ({ changed: { created: true, topic_id: 'made' } });
    const request = newRequestId();

    await expect(createTopic(HOST, 'Fix login', ['work'], request)).resolves.toEqual({ kind: 'created', topic: 'made' });
    expect(mockServer.writes()).toEqual([{ version: 2, command: { create: { title: 'Fix login', tags: ['work'] } }, request }]);

    mockServer = fakeHostServer();
    mockServer.answer = () => ({ changed: { created: true, topic_id: 'made' } });
    await createTopic(HOST, 'Fix login', [], newRequestId());
    expect(sent().command).toEqual({ create: { title: 'Fix login' } });
  });

  it.each([
    [{ field: 'title' as const, title: 'Fix the login' }, { rename: { title: 'Fix the login' } }],
    [{ field: 'note' as const, note: 'Bisect it' }, { note: { text: 'Bisect it' } }],
    [{ field: 'note' as const, note: null }, { note: {} }],
    [{ field: 'tags' as const, tags: ['work', 'personal'] }, { tags: { change: { set: { tags: ['work', 'personal'] } } } }],
  ])('Edit Topic sends %j as %j, on the Topic', async (change, command) => {
    await expect(changeTopic(HOST, TOPIC, change, newRequestId())).resolves.toEqual({ kind: 'changed' });
    expect(sent()).toEqual({ command, target: { topic: { id: 't1' } } });
  });

  it('Add a Session sends `add_session` in the checkout of its row, and answers the Session', async () => {
    mockServer.answer = () => ({ changed: { session_name: 'api/fix-login' } });

    const made = await addSession(
      HOST, TOPIC, { directory: '/work/api', worktree: { path: '/work/api' }, name: 'api' }, { chosenName: 'api+2' }, newRequestId(),
    );

    expect(made).toEqual({ kind: 'added', session: 'api/fix-login' });
    expect(sent()).toEqual({
      command: { add_session: { directory: '/work/api', working_copy: { worktree: { path: '/work/api' } }, name: 'api', chosen_name: 'api+2' } },
      target: { topic: { id: 't1' } },
    });
  });

  it('Add a Session from a Worktree sends a new Worktree from the row’s checkout, with no exact name', () => {
    expect(addSessionCommand({ directory: '/work/api-fix', worktree: { path: '/work/api-fix' }, name: 'api-fix' }, { newWorktree: true }))
      .toEqual({ add_session: { directory: '/work/api-fix', working_copy: { new_worktree: { from: '/work/api-fix' } }, name: 'api-fix' } });
    expect(addSessionCommand({ directory: '/work/notes', worktree: null }, { newWorktree: true }))
      .toEqual({ error: 'A new Worktree needs a git repository, and /work/notes is not one.' });
  });

  it('makes a folder that starts with ~ the Host’s home, which the Host Server needs', async () => {
    mockServer.answer = () => ({ changed: { session_name: 'notes' } });

    await addSession(HOST, TOPIC, { directory: '~/notes', worktree: null }, {}, newRequestId());

    expect(mockExecs).toEqual(['printf %s "$HOME"']);
    expect(sent().command).toEqual({ add_session: { directory: '/Users/me/notes', working_copy: { directory: {} } } });
  });

  it('a Go to pick sends `new_session` with no Topic', async () => {
    mockServer.answer = () => ({ changed: { session_name: 'web+2' } });

    await expect(newSession(HOST, '/work/web', 'web', newRequestId())).resolves.toEqual({ kind: 'added', session: 'web+2' });
    expect(sent()).toEqual({ command: { new_session: { directory: '/work/web', name: 'web' } }, target: undefined });
    expect(mockExecs).toEqual([]);
  });
});

describe('the orders of a Topic card', () => {
  const LOCK = '$4' as SessionId;
  it.each<[TopicOrder, object]>([
    [{ kind: 'action', action: 'mark-read' }, { mark_read: { change: 'read', scope: 'topic' } }],
    [{ kind: 'action', action: 'mark-unread' }, { mark_read: { change: 'unread', scope: 'topic_mark' } }],
    [{ kind: 'action', action: 'move-up' }, { move_card: { move: { up: {} } } }],
    [{ kind: 'action', action: 'move-down' }, { move_card: { move: { down: {} } } }],
    [{ kind: 'action', action: 'bench' }, { bench_topic: {} }],
    [{ kind: 'action', action: 'make-guest' }, { make_guest: {} }],
    [{ kind: 'action', action: 'pin' }, { pin: {} }],
    [{ kind: 'action', action: 'unpin' }, { unpin: {} }],
    [
      { kind: 'drop', drop: { kind: 'place', side: 'before', anchor: { kind: 'topic', id: 't2' as TopicId } } },
      { move_card: { move: { before: { card: { topic: { ref: { id: 't2' } } } } } } },
    ],
    [
      { kind: 'drop', drop: { kind: 'place', side: 'after', anchor: { kind: 'locked-session', session: LOCK, name: 'scratch' } } },
      { move_card: { move: { after: { card: { lock: { session: '$4' } } } } } },
    ],
    [
      { kind: 'drop', drop: { kind: 'place', side: 'before', anchor: { kind: 'open-place', id: 'open-place-2' } } },
      { move_card: { move: { before: { card: { openPlace: { id: 'open-place-2' } } } } } },
    ],
    [
      { kind: 'drop', drop: { kind: 'trade', with: { kind: 'locked-session', session: LOCK, name: 'scratch' } } },
      { move_card: { move: { trade: { card: { lock: { session: '$4' } } } } } },
    ],
    [{ kind: 'drop', drop: { kind: 'fill', place: 2 } }, { fill_open_place: { place: 2 } }],
    [{ kind: 'wake', wake: 'reopen' }, { reopen: {} }],
    [{ kind: 'wake', wake: 'start-fresh' }, { start_fresh: {} }],
  ])('%j sends %j on the Topic, and nothing else', async (order, command) => {
    await expect(sendTopicOrder(HOST, TOPIC, order, () => {})).resolves.toEqual({ kind: 'changed' });
    expect(mockServer.requests).toEqual([{ environment: { version: 2, command, target: { topic: { id: 't1' } }, request: expect.any(String) } }]);
  });

  it.each([
    ['settle', 'keep'],
    ['settle-stopping-sessions', 'kill'],
  ] as const)('%s asks the Host which Sessions it offers, then keeps or stops each: %s', async (action, disposition) => {
    const offered = { id: '$1', name: 'api/fix', disposition: 'kill', worktree: null, remove_worktree: false };
    mockServer.answer = (payload) => ('topic_choices' in payload ? { sessions: [offered] } : { changed: { topic_id: 't1' } });

    await sendTopicOrder(HOST, TOPIC, { kind: 'action', action }, () => {});

    expect(mockServer.requests[0]).toEqual({ topic_choices: { action: 'settle', target: { topic: { id: 't1' } } } });
    expect(mockServer.writes()).toEqual([{
      version: 2,
      command: { settle: { choices: [{ ...offered, disposition, remove_worktree: false }] } },
      target: { topic: { id: 't1' } },
      request: expect.any(String),
    }]);
  });

  it.each([
    ['forget', 'keep'],
    ['forget-stopping-sessions', 'kill'],
  ] as const)('%s asks the Host which Sessions Forget offers, then keeps or stops each, and removes no Worktree: %s', async (action, disposition) => {
    const offered = { id: '$1', name: 'api/fix', disposition: 'keep', worktree: { repository_path: '/r', path: '/w', branch: 'b' }, remove_worktree: false };
    mockServer.answer = (payload) => ('topic_choices' in payload ? { sessions: [offered] } : { changed: { topic_id: 't1' } });

    await expect(sendTopicOrder(HOST, TOPIC, { kind: 'action', action }, () => {})).resolves.toEqual({ kind: 'changed' });

    expect(mockServer.requests[0]).toEqual({ topic_choices: { action: 'forget', target: { topic: { id: 't1' } } } });
    expect(mockServer.writes()).toEqual([{
      version: 2,
      command: { forget: { choices: [{ ...offered, disposition, remove_worktree: false }], worktrees: [] } },
      target: { topic: { id: 't1' } },
      request: expect.any(String),
    }]);
  });

  it('has its own Request id for each tap', async () => {
    await sendTopicOrder(HOST, TOPIC, { kind: 'action', action: 'move-up' }, () => {});
    await sendTopicOrder(HOST, TOPIC, { kind: 'action', action: 'move-up' }, () => {});

    const [first, second] = mockServer.writes();
    expect(first!.request).not.toBe(second!.request);
  });
});

describe('the checks of an unsure sheet', () => {
  it('read the Listing and the Topic from the Host Server’s first push', async () => {
    mockServer.pushes.snapshot = snapshotPush({ topics: [{ id: 'made', label: 'Fix login' }] });
    mockServer.pushes.topic = topicPush('t1', 'Fix login', [{ id: '$1', name: 'api/fix-login' }]);

    await expect(pushedListing(HOST)).resolves.toMatchObject({ unpinned: { bench: [expect.objectContaining({ topic: expect.objectContaining({ id: 'made' }) })] } });
    await expect(pushedTopic(HOST, TOPIC)).resolves.toMatchObject({ label: 'Fix login', sessions: [{ name: 'api/fix-login' }] });
    expect(mockServer.writes()).toEqual([]);
  });

  it('fail with the reason when the Topic is gone', async () => {
    mockServer.pushes.topic = null;

    await expect(pushedTopic(HOST, TOPIC)).rejects.toEqual(new Error('This Topic no longer exists on the Host.'));
  });
});
