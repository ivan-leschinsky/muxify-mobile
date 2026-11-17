import { answered, refused, type Listing, type ListedSession } from '@/domain/host-listing';
import type { LiveListing } from '@/ssh/host-listing-feed';

import type { EnvironmentSnapshot } from './environment';
import type { HostCliState } from './host-cli-install';

/**
 * What the Host has to say about its Topics, once asked.
 *
 * Shaped like the Listing, and for the same reason: the Host Screen asks again
 * on every return to it, and a question in flight carries the last snapshot
 * so the asking is invisible.
 *
 * It differs from the Listing in one place, on purpose. A failed read keeps
 * the last snapshot. A Host that refuses to list its Sessions has no Sessions
 * to offer, but a failed Topics read means the Host is up and answered badly,
 * so the Topics already on screen are still the best account of its work, and
 * the error sits above them. An old Host CLI keeps it for the same reason.
 *
 * `installing` and `updating` are never read from the Host: they are what
 * `withHostCli` makes of `absent` and `old` while the Host CLI install runs.
 */
export type HostTopics =
  | { kind: 'loading'; last: EnvironmentSnapshot | null }
  /** No Host CLI on this Host. */
  | { kind: 'absent' }
  /** No Host CLI on this Host, and the install is putting one there. */
  | { kind: 'installing' }
  /**
   * A Host CLI with no `environment show`. `failure` is why the install could
   * not update it, once it has tried.
   */
  | { kind: 'old'; last: EnvironmentSnapshot | null; failure?: string }
  /** An old Host CLI, and the install is updating it. */
  | { kind: 'updating'; last: EnvironmentSnapshot | null }
  | { kind: 'failed'; error: string; last: EnvironmentSnapshot | null }
  | { kind: 'listed'; snapshot: EnvironmentSnapshot }
  /**
   * No Host Server can run on this Connection: the Host Screen shows Sessions
   * only and says "Topics are unavailable on <host>: <reason>".
   */
  | { kind: 'unavailable'; host: string; reason: string };

/** Before the Host has been asked anything. */
export const TOPICS_UNASKED: HostTopics = { kind: 'loading', last: null };

/** Asking again, without taking down the snapshot already on screen. */
export function loadingTopics(previous: HostTopics): HostTopics {
  return { kind: 'loading', last: lastSnapshot(previous) };
}

/** What one read of the Host came to. A failure here has not yet met the last snapshot. */
export type TopicsRead =
  | { kind: 'listed'; snapshot: EnvironmentSnapshot }
  | { kind: 'absent' }
  | { kind: 'old' }
  | { kind: 'failed'; error: string };

/** The state a read leaves behind. A failed one, or an old Host CLI, keeps what `previous` had. */
export function settled(previous: HostTopics, read: TopicsRead): HostTopics {
  switch (read.kind) {
    case 'failed':
    case 'old':
      return { ...read, last: lastSnapshot(previous) };
    case 'absent':
    case 'listed':
      return read;
  }
}

/**
 * The Topics as the Host CLI install on the Host's Connection leaves them: a
 * Host with none, or an old one, says the install is running, or why it
 * failed. Any other state of the install changes nothing, because one that
 * put a new Host CLI there has the Host read again.
 */
export function withHostCli(topics: HostTopics, hostCli: HostCliState): HostTopics {
  const failure =
    hostCli.kind === 'done' && hostCli.result.kind === 'failed' ? hostCli.result.text : null;
  switch (topics.kind) {
    case 'absent':
      if (hostCli.kind === 'running') return { kind: 'installing' };
      if (failure === null) return topics;
      return { kind: 'failed', error: `Could not install Muxify on this Host: ${failure}`, last: null };
    case 'old':
      if (hostCli.kind === 'running') return { kind: 'updating', last: topics.last };
      return failure === null ? topics : { ...topics, failure };
    case 'unavailable':
      // A Host CLI too old for a Host Server, which the install is updating.
      return hostCli.kind === 'running' ? { kind: 'updating', last: null } : topics;
    default:
      return topics;
  }
}

/** What the Host last said, or null before it has said anything. */
export function lastSnapshot(topics: HostTopics): EnvironmentSnapshot | null {
  switch (topics.kind) {
    case 'listed':
      return topics.snapshot;
    case 'loading':
    case 'failed':
    case 'old':
    case 'updating':
      return topics.last;
    case 'absent':
    case 'installing':
    case 'unavailable':
      return null;
  }
}

/**
 * The snapshot's Sessions as the Listing holds them, in the order the Mac's
 * Sessions mode shows them. The snapshot has no window counts.
 */
export function listedSessions(snapshot: EnvironmentSnapshot): ListedSession[] {
  return snapshot.sessions.map(({ name }) => ({ name, windowCount: undefined }));
}

/**
 * What the Host Screen draws of a Host whose Host Server pushes its Listing:
 *
 * - the latest push of this Connection, at once;
 * - before it, `last`, the Listing the screen last drew, so a new
 *   Connection shows no spinner over it; with none, the spinner;
 * - in Sessions only, and while the Host has no `muxify` yet, the Sessions
 *   that tmux lists, `sessions`, and the reason there are no Topics;
 * - `failure`, the Connection that could not be held, as a refusal.
 */
export function liveReading(input: {
  live: LiveListing | null;
  last: EnvironmentSnapshot | null;
  sessions: Listing;
  failure: string | null;
  host: string;
}): { listing: Listing; topics: HostTopics } {
  const { live, last, sessions, failure, host } = input;
  if (failure !== null) return { listing: refused(failure), topics: { kind: 'failed', error: failure, last } };
  if (live?.server.kind === 'sessions-only') {
    return { listing: sessions, topics: { kind: 'unavailable', host, reason: live.server.reason } };
  }
  if (live?.server.kind === 'installing') return { listing: sessions, topics: { kind: 'absent' } };
  const snapshot = live?.snapshot ?? null;
  if (snapshot !== null) return { listing: answered(listedSessions(snapshot)), topics: { kind: 'listed', snapshot } };
  return {
    listing: last === null ? { phase: 'reading' } : { phase: 'reading', sessions: listedSessions(last) },
    topics: { kind: 'loading', last },
  };
}
