import { describeError } from '@/lib/describe-error';
import { parseEnvironment, type EnvironmentSnapshot } from '@/topics/environment';

import type { HostServer, HostServerCall, HostServerState } from './host-server';

/** What the Host Server of one Connection says of its Host. */
export interface LiveListing {
  /** Where the link stands: live, starting, installing, Sessions only or closed. */
  server: HostServerState;
  /** The latest snapshot it pushed, with `sidebar`, or null before the first push of this Connection. */
  snapshot: EnvironmentSnapshot | null;
}

/** The Listing of one Connection, as its Host Server pushes it. */
export interface ListingFeed {
  /** The same object until something changes, so a reader that compares snapshots sees no change. */
  current(): LiveListing;
  /** Hears every change of `current()`. Answers the way to stop hearing. */
  onChange(listener: () => void): () => void;
}

/**
 * Holds one `snapshot` subscription on a Host Server for its life, and keeps
 * the latest snapshot as the Host's Listing. The existing snapshot parser is
 * the decoder.
 *
 * A server that starts again, after a stop or the Host CLI install, is
 * subscribed again, and the first item of the new subscription carries the
 * whole state: until it comes, the last snapshot stays.
 */
export function followListing(server: HostServer, say: (line: string) => void = () => {}): ListingFeed {
  const listeners = new Set<() => void>();
  let current: LiveListing = { server: server.state(), snapshot: null };
  let subscription: HostServerCall<unknown> | null = null;

  function publish(next: LiveListing): void {
    current = next;
    for (const listener of [...listeners]) listener();
  }

  function subscribe(): void {
    subscription?.cancel();
    const mine: HostServerCall<unknown> = server.subscribe({ snapshot: {} }, (item) => {
      if (subscription !== mine) return;
      try {
        publish({ ...current, snapshot: parseEnvironment(item) });
      } catch (error) {
        say(`a snapshot this phone cannot read: ${describeError(error)}`);
      }
    });
    subscription = mine;
    mine.then(
      () => {
        if (subscription === mine) subscription = null;
      },
      () => {
        if (subscription === mine) subscription = null;
      },
    );
  }

  server.onState((state) => {
    if (state.kind === 'live') subscribe();
    publish({ ...current, server: state });
  });
  if (current.server.kind === 'live') subscribe();

  return {
    current: () => current,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
