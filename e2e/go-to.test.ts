/**
 * The Host CLI calls of Go to, against the real `muxify` on this machine.
 *
 * Not part of `pnpm test`, which is hermetic:
 *
 *   pnpm e2e:go-to
 *
 * It needs a `muxify` with the `session-paths` capability first on the PATH.
 * The ranked rows, a Topic's rows and the visits go through the Host Server:
 * `pnpm e2e:host-server` runs them against a real `muxify server`.
 *
 * Every command runs against a Muxify of its own, as in e2e/topics.test.ts:
 * its records, its Config and its tmux server live in a temp folder, which is
 * removed afterwards.
 */
import { execFile } from 'child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { join } from 'path';

import { hostScreenTabs } from '@/domain/host-screen';
import { settled, TOPICS_UNASKED } from '@/topics/host-topics';
import { createMuxifyCli } from '@/topics/muxify-cli';
import { newRequestId, SESSION_PATHS_CAPABILITY } from '@/topics/request';
import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';

// /tmp, not os.tmpdir(): a tmux socket path must stay under 104 bytes.
const root = realpathSync(mkdtempSync('/tmp/muxify-e2e-go-to.'));
const { TMUX: _tmux, TMUX_PANE: _pane, ...inherited } = process.env;
const env = {
  ...inherited,
  MUXIFY_CONFIG: join(root, 'config.yaml'),
  XDG_STATE_HOME: join(root, 'state'),
  TMUX_TMPDIR: root,
};

function runInShell(command: string): Promise<TmuxExecResult> {
  return new Promise((resolve, reject) => {
    execFile(process.env.SHELL ?? '/bin/sh', ['-c', command], { env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
    });
  });
}

const exec: TmuxTransport['exec'] = runInShell;
const folder = join(root, 'go to folder');

beforeAll(async () => {
  mkdirSync(folder);
  await runInShell('tmux -f /dev/null new-session -d -s 0');
});

afterAll(async () => {
  const socket = (await runInShell("tmux display -p '#{socket_path}'")).stdout.trim();
  if (socket.startsWith(`${root}/`)) await runInShell('tmux kill-server');
  rmSync(root, { recursive: true, force: true });
});

describe('Go to against the real muxify', () => {
  const cli = createMuxifyCli();

  it('says that it has Go to, and which views the Sidebar shows', async () => {
    const read = await cli.read(exec);

    if (read.kind !== 'listed') throw new Error(`expected listed, got ${JSON.stringify(read)}`);
    expect(read.snapshot.capabilities).toContain(SESSION_PATHS_CAPABILITY);
    expect(read.snapshot.sidebar).toEqual({ topics: true, sessions: true });
    expect(hostScreenTabs(settled(TOPICS_UNASKED, read))).toEqual(['topics', 'sessions']);
  });

  it('makes one Session in no Topic at a folder for two sends of one Request', async () => {
    const request = newRequestId();

    const first = await cli.newSession(exec, folder, 'e2e-go-to', request);
    const second = await cli.newSession(exec, folder, 'e2e-go-to', request);

    expect(first).toEqual({ kind: 'added', session: 'e2e-go-to' });
    expect(second).toEqual(first);
    const sessions = (await runInShell("tmux list-sessions -F '#{session_name} #{session_path}'")).stdout.trim().split('\n');
    expect(sessions.filter((line) => line.startsWith('e2e-go-to'))).toEqual([`e2e-go-to ${folder}`]);
  });

  it('gives the next free name to a second Session at the folder', async () => {
    expect(await cli.newSession(exec, folder, 'e2e-go-to', newRequestId())).toEqual({ kind: 'added', session: 'e2e-go-to+2' });
  });
});
