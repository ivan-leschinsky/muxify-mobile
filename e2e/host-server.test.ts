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

import { createHostServer, type HostServer, type HostServerState, type OpenServerChannel } from '@/ssh/host-server';
import { shellQuote } from '@/tmux/commands';

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
  await runInShell('tmux -f /dev/null new-session -d -s 0');
});

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill();
  // Only the sandbox's own server: never one whose socket is outside root.
  const socket = (await runInShell("tmux display -p '#{socket_path}'")).stdout.trim();
  if (socket.startsWith(`${root}/`)) await runInShell('tmux kill-server');
  rmSync(root, { recursive: true, force: true });
});

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
});
