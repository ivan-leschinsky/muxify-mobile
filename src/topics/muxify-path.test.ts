import type { TmuxExecResult, TmuxTransport } from '@/tmux/transport';

import { createMuxifyPath } from './muxify-path';

type Answer = Partial<TmuxExecResult>;
const NOT_FOUND: Answer = { exitCode: 1 };
const PATH_FOUND: Answer = { exitCode: 0, stdout: '/opt/bin/muxify\n' };

/** A Host that answers each command by the first rule that matches it, and records them all. */
function fakeHost(rules: [match: string, answer: Answer][]) {
  const ran: string[] = [];
  const exec: TmuxTransport['exec'] = async (command) => {
    ran.push(command);
    const rule = rules.find(([match]) => command.includes(match));
    return { stdout: '', stderr: '', exitCode: 127, ...rule?.[1] };
  };
  return { exec, ran };
}

describe('finding muxify on a Host', () => {
  it('stops at the first place that has it', async () => {
    const host = fakeHost([['command -v', PATH_FOUND]]);

    expect(await createMuxifyPath().locate(host.exec)).toBe('/opt/bin/muxify');

    expect(host.ran).toEqual(['command -v muxify']);
  });

  it('asks the shell to expand ~ and uses the path it gets back', async () => {
    const host = fakeHost([
      ['command -v', NOT_FOUND],
      ['~/.local/bin', { exitCode: 0, stdout: '/Users/me/.local/bin/muxify\n' }],
    ]);

    expect(await createMuxifyPath().locate(host.exec)).toBe('/Users/me/.local/bin/muxify');

    expect(host.ran).toEqual(['command -v muxify', 'test -x ~/.local/bin/muxify && echo ~/.local/bin/muxify']);
  });

  it('falls back to the app bundle', async () => {
    const bundle = '/Applications/Muxify.app/Contents/Resources/bin/muxify';
    const host = fakeHost([
      ['command -v', NOT_FOUND],
      ['~/.local/bin', NOT_FOUND],
      [`test -x '${bundle}'`, { exitCode: 0, stdout: `${bundle}\n` }],
    ]);

    expect(await createMuxifyPath().locate(host.exec)).toBe(bundle);
    expect(host.ran).toHaveLength(3);
  });

  it('asks for the app bundle only on a Mac, as the install does', async () => {
    const host = fakeHost([]);

    await createMuxifyPath().locate(host.exec);

    expect(host.ran[2]).toMatch(/^uname -s \| grep -qx Darwin && test -x /);
  });

  it('does not take a shell alias for a path', async () => {
    const host = fakeHost([['command -v', { exitCode: 0, stdout: "alias muxify='x'\n" }]]);

    expect(await createMuxifyPath().locate(host.exec)).toBeNull();
  });

  it('is absent when no place has it, and says so once', async () => {
    const host = fakeHost([]);
    const log: string[] = [];
    const path = createMuxifyPath((line) => log.push(line));

    expect(await path.locate(host.exec)).toBeNull();
    expect(await path.locate(host.exec)).toBeNull();

    expect(host.ran).toHaveLength(3);
    expect(log).toEqual(['muxify is not on this Host']);
  });

  it('remembers where it found muxify, so a later call runs nothing', async () => {
    const host = fakeHost([['command -v', PATH_FOUND]]);
    const path = createMuxifyPath();

    await path.locate(host.exec);
    host.ran.length = 0;

    expect(await path.locate(host.exec)).toBe('/opt/bin/muxify');
    expect(host.ran).toEqual([]);
  });

  it('probes again once told to forget, and finds the Host CLI that was just installed', async () => {
    let installed = false;
    const ran: string[] = [];
    const exec: TmuxTransport['exec'] = async (command) => {
      ran.push(command);
      if (command.startsWith('test -x ~/.local/bin') && installed) {
        return { stdout: '/home/me/.local/bin/muxify\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    };
    const path = createMuxifyPath();

    expect(await path.locate(exec)).toBeNull();
    installed = true;
    expect(await path.locate(exec)).toBeNull();
    path.forget();
    ran.length = 0;

    expect(await path.locate(exec)).toBe('/home/me/.local/bin/muxify');
    expect(ran).toEqual(['command -v muxify', 'test -x ~/.local/bin/muxify && echo ~/.local/bin/muxify']);
  });

  it('probes again after an exec that threw, because it found nothing out', async () => {
    let calls = 0;
    const host = fakeHost([['command -v', PATH_FOUND]]);
    const exec: TmuxTransport['exec'] = (command) => {
      if (calls++ === 0) return Promise.reject(new Error('connection lost'));
      return host.exec(command);
    };
    const path = createMuxifyPath();

    await expect(path.locate(exec)).rejects.toThrow('connection lost');
    expect(await path.locate(exec)).toBe('/opt/bin/muxify');
  });

  it('logs where it found muxify', async () => {
    const host = fakeHost([['command -v', PATH_FOUND]]);
    const log: string[] = [];

    await createMuxifyPath((line) => log.push(line)).locate(host.exec);

    expect(log).toEqual(['found muxify at /opt/bin/muxify by PATH']);
  });
});
