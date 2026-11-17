/**
 * The Host Server link, against a real `muxify server`.
 *
 * Not part of `pnpm test`, which is hermetic:
 *
 *   pnpm e2e:host-server
 *
 * It runs the Host CLI that `(cd ../muxify-shell && make host-cli)` builds, or
 * the one MUXIFY_HOST_CLI names, as the link would over SSH: one exec channel,
 * here a child shell whose stdin, stdout and stderr are the channel's. It
 * checks the handshake, a `ping`, the snapshot subscription's first item and a
 * clean close.
 *
 * Every command runs against a Muxify of its own: its Topic records, its Config
 * and its tmux server live in a temp folder, which is removed afterwards, the
 * way e2e/topics.test.ts and e2e/sandbox.sh do it.
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { join, resolve } from 'path';

import { createHostServer, HostServerError, type HostServer, type HostServerState, type OpenServerChannel } from '@/ssh/host-server';
import type { Host } from '@/storage/records';
import { shellQuote } from '@/tmux/commands';
import type { TopicId } from '@/topics/environment';
import { environmentRequest, firstPush, sendEnvironment, type EnvironmentCommand } from '@/topics/host-write-request';
import {
  actionCommand,
  addSessionCommand,
  changeCommand,
  createCommand,
  dropCommand,
  newSessionCommand,
  settleCommand,
  wakeCommand,
} from '@/topics/host-writes';
import { newRequestId, REQUEST_MISMATCH_ERROR } from '@/topics/request';

jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => { throw new Error('this suite gives its own Connections'); } }));

const MUXIFY =
  process.env.MUXIFY_HOST_CLI ??
  resolve(__dirname, '..', '..', 'muxify-shell', 'build', 'host-cli', `muxify-darwin-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`);

// /tmp, not os.tmpdir(): a tmux socket path must stay under 104 bytes.
const root = realpathSync(mkdtempSync('/tmp/muxify-e2e-host-server.'));
const { TMUX: _tmux, TMUX_PANE: _pane, ...inherited } = process.env;
const env = {
  ...inherited,
  MUXIFY_CONFIG: join(root, 'config.yaml'),
  XDG_STATE_HOME: join(root, 'state'),
  TMUX_TMPDIR: root,
};

function runInShell(command: string): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((done, fail) => {
    execFile('/bin/sh', ['-c', command], { env }, (error, stdout) => {
      if (error && typeof error.code !== 'number') return fail(error);
      done({ stdout, exitCode: typeof error?.code === 'number' ? error.code : 0 });
    });
  });
}

/** Every channel the link opened, so that none outlives the suite. */
const children: ChildProcess[] = [];

/** An exec channel over child-process pipes: stdout carries the frames, stderr stays apart. */
const openChannel: OpenServerChannel = (command, events) => {
  const child = spawn('/bin/sh', ['-c', command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const bytes = (chunk: Buffer) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
  child.stdout.on('data', (chunk: Buffer) => events.onData(bytes(chunk)));
  child.stderr.on('data', (chunk: Buffer) => events.onStderr(bytes(chunk)));
  child.on('close', (code) => events.onClosed(code ?? undefined));
  child.stdin.on('error', () => {});
  return Promise.resolve({
    write: (chunk) => {
      child.stdin.write(chunk);
    },
    close: async () => {
      child.stdin.end();
      child.kill();
    },
  });
};

function until(server: HostServer, kinds: HostServerState['kind'][]): Promise<HostServerState> {
  return new Promise((done) => {
    if (kinds.includes(server.state().kind)) return done(server.state());
    const stop = server.onState((state) => {
      if (!kinds.includes(state.kind)) return;
      stop();
      done(state);
    });
  });
}

beforeAll(async () => {
  if (!existsSync(MUXIFY)) throw new Error(`no Host CLI at ${MUXIFY}: run (cd ../muxify-shell && make host-cli)`);
  await runInShell(`printf 'topics:\\n  tags:\\n    work: {}\\n' > ${shellQuote(env.MUXIFY_CONFIG)}`);
  await runInShell('tmux -f /dev/null new-session -d -s 0');
});

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill();
  // Only the sandbox's own server: never one whose socket is outside root.
  const socket = (await runInShell("tmux display -p '#{socket_path}'")).stdout.trim();
  if (socket.startsWith(`${root}/`)) await runInShell('tmux kill-server');
  rmSync(root, { recursive: true, force: true });
});

function startServer(logged: string[] = []): HostServer {
  return createHostServer({
    open: openChannel,
    locate: () => Promise.resolve(MUXIFY),
    forget: () => {},
    version: async (path) => (await runInShell(`${shellQuote(path)} --version`)).stdout.trim(),
    connected: () => true,
    build: 'Muxify e2e build 1',
    say: (line) => logged.push(line),
  });
}

describe('the Host Server link against a real muxify server', () => {
  it('gets hello, a ping answer and the first snapshot, and closes cleanly', async () => {
    const logged: string[] = [];
    const server = createHostServer({
      open: openChannel,
      locate: () => Promise.resolve(MUXIFY),
      forget: () => {},
      version: async (path) => (await runInShell(`${shellQuote(path)} --version`)).stdout.trim(),
      connected: () => true,
      build: 'Muxify e2e build 1',
      say: (line) => logged.push(line),
    });

    const state = await until(server, ['live', 'sessions-only']);
    const version = (await runInShell(`${shellQuote(MUXIFY)} --version`)).stdout.trim();
    console.log(`Host Server: ${logged.join('; ')}`);
    expect(state).toEqual({ kind: 'live', build: version, protocol: 1 });
    expect(logged).toEqual([`${version}, protocol 1`]);

    await expect(server.request({ ping: {} })).resolves.toEqual({});

    const first = await new Promise<unknown>((done, fail) => {
      const subscription = server.subscribe({ snapshot: {} }, (item) => {
        done(item);
        subscription.cancel();
      });
      subscription.catch(fail);
    });
    expect(first).toMatchObject({ sidebar: expect.any(Object), sessions: [expect.objectContaining({ name: '0' })] });

    const pending = server.request({ snapshot: {} });
    server.close();
    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    expect(server.state()).toEqual({ kind: 'closed' });
  }, 30_000);

  it('takes every Host Write of the phone as MuxifyCore decodes it, once per Request id', async () => {
    const server = startServer();
    await until(server, ['live']);
    const HOST = { id: 'sandbox', displayName: 'Sandbox' } as Host;
    const connections = { onServer: <T,>(_host: Host, work: (on: HostServer) => Promise<T>) => work(server) };
    /** One write: its `ok`, or the code and the TopicFailure kind it ended with. A bad shape ends `invalid`. */
    const write = async (command: EnvironmentCommand | { error: string }, topic?: TopicId) => {
      if ('error' in command) throw new Error(String(command.error));
      try {
        return { ok: await server.request(environmentRequest({ command, topic, request: newRequestId() })) };
      } catch (error) {
        if (!(error instanceof HostServerError)) throw error;
        return { code: error.code, kind: (error.topic_failure as { kind?: string } | undefined)?.kind, message: error.message };
      }
    };
    const decoded = (result: { code?: string; kind?: string }) => {
      expect(result.code).not.toBe('invalid');
      expect(result.code).not.toBe('unsupported');
      expect(result.kind).not.toBe('unsupported');
    };

    // New Topic: a second send of the same id makes no second Topic; other arguments with it clash.
    const request = newRequestId();
    const create = { command: createCommand('Live Writes', ['work']), request };
    const made = await sendEnvironment(HOST, create, () => {}, connections);
    expect(made).toEqual({ kind: 'answered', answer: { changed: expect.objectContaining({ created: true, topic_id: request }) } });
    await expect(sendEnvironment(HOST, create, () => {}, connections)).resolves.toEqual(made);
    await expect(sendEnvironment(HOST, { command: createCommand('Live Other', []), request }, () => {}, connections))
      .resolves.toEqual({ kind: 'failed', error: REQUEST_MISMATCH_ERROR });
    const topic = request as unknown as TopicId;
    const listed = (await firstPush(server, { snapshot: {} })) as { unpinned: { bench: { topic?: { label: string } }[] } };
    expect(JSON.stringify(listed).match(/"label":"Live Writes"/g)).toHaveLength(1);

    // Edit Topic.
    for (const change of [
      { field: 'title' as const, title: 'Live Writes 2' },
      { field: 'note' as const, note: 'a note' },
      { field: 'note' as const, note: null },
      { field: 'tags' as const, tags: [] },
    ]) {
      expect(await write(changeCommand(change), topic)).toMatchObject({ ok: expect.anything() });
    }

    // Add a Session, with its exact name, and a Go to pick's Session in no Topic.
    expect(await write(addSessionCommand({ directory: root, worktree: null }, { chosenName: 'live' }), topic))
      .toEqual({ ok: { changed: expect.objectContaining({ session_name: expect.stringMatching(/^live\//) }) } });
    expect(await write(newSessionCommand(root, 'live-free')))
      .toEqual({ ok: { changed: expect.objectContaining({ session_name: 'live-free' }) } });

    // The card's menu orders and drops: each decodes, though the Host may refuse one where the card is.
    for (const action of ['mark-read', 'mark-unread', 'move-up', 'move-down', 'make-guest', 'bench'] as const) {
      decoded(await write(actionCommand(action), topic));
    }
    const lock = '$0' as never;
    for (const drop of [
      { kind: 'place' as const, side: 'before' as const, anchor: { kind: 'open-place' as const, id: 'open-place-1' } },
      { kind: 'place' as const, side: 'after' as const, anchor: { kind: 'locked-session' as const, session: lock, name: '0' } },
      { kind: 'trade' as const, with: { kind: 'topic' as const, id: topic } },
      { kind: 'fill' as const, place: 1 },
    ]) {
      decoded(await write(dropCommand(drop), topic));
    }

    // Settle with the Sessions the Host offers, then the wakes.
    const choices = (await server.request({ topic_choices: { action: 'settle', target: { topic: { id: topic } } } })) as { sessions: object[] };
    expect(choices.sessions).toHaveLength(1);
    expect(await write(settleCommand(choices.sessions, false), topic)).toMatchObject({ ok: expect.anything() });
    expect(await write(wakeCommand('reopen'), topic)).toMatchObject({ ok: expect.anything() });
    decoded(await write(wakeCommand('start-fresh'), topic));

    server.close();
  }, 60_000);
});
