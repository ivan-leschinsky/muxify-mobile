import { shellQuote } from '@/tmux/commands';
import type { TmuxTransport } from '@/tmux/transport';

type Exec = TmuxTransport['exec'];

const APP_BUNDLE_CLI = '/Applications/Muxify.app/Contents/Resources/bin/muxify';

/**
 * Where the Host CLI can be, in the order the probe asks. An SSH
 * exec runs `$SHELL -c` without a login shell, so its PATH can lack the
 * folder that holds `muxify`. The second and third steps are the places the
 * Mac app puts it.
 */
const PROBE_STEPS = [
  { step: 'PATH', command: 'command -v muxify' },
  {
    step: '~/.local/bin',
    command: 'test -x ~/.local/bin/muxify && echo ~/.local/bin/muxify',
  },
  // Only on a Mac: a Linux Host can see the Mac's own app through a shared
  // folder (OrbStack mounts /Applications), and that one is not this Host's.
  // The install script skips it there too.
  {
    step: 'app bundle',
    command: `uname -s | grep -qx Darwin && test -x ${shellQuote(APP_BUNDLE_CLI)} && echo ${shellQuote(APP_BUNDLE_CLI)}`,
  },
] as const;

/**
 * Where `muxify` is on one Connection's Host. The Host Server runs it as
 * `'<muxify>' server`. The phone runs no other `muxify` verb: every Topic
 * read and write goes over the Host Server. See ADR 0025.
 */
export interface MuxifyPath {
  /**
   * The path, or null when the Host has no `muxify`. The first call probes and
   * every later call reuses what it found. A call that throws, because the
   * Connection broke, finds nothing out and leaves the next one to probe.
   */
  locate(exec: Exec): Promise<string | null>;
  /**
   * Forgets the path, so the next call probes again. The Host Server link
   * calls it when the Host CLI install answers `installed` or `updated`, which
   * puts a new one in `~/.local/bin`.
   */
  forget(): void;
}

/** One per Connection. `log` hears where the probe found it, which the Log needs to say why a Host has Topics or not. */
export function createMuxifyPath(log: (line: string) => void = () => {}): MuxifyPath {
  let probed: Promise<string | null> | undefined;

  async function probe(exec: Exec): Promise<string | null> {
    for (const { step, command } of PROBE_STEPS) {
      const result = await exec(command);
      const path = result.stdout.trim().split('\n')[0] ?? '';
      // `command -v` also prints an alias or a function name, which is not
      // something to run with a path's quoting.
      if (result.exitCode === 0 && path.startsWith('/')) {
        log(`found muxify at ${path} by ${step}`);
        return path;
      }
    }
    log('muxify is not on this Host');
    return null;
  }

  return {
    locate(exec) {
      const asked = (probed ??= probe(exec));
      return asked.catch((error: unknown) => {
        if (probed === asked) probed = undefined;
        throw error;
      });
    },
    forget() {
      probed = undefined;
    },
  };
}
