import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { answered, asking, refused, UNASKED, type Listing } from '@/domain/host-listing';
import { describeConnectionFailure } from '@/ssh/failures';
import { deviceHostStore } from '@/storage/device-store';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import type { EnvironmentSnapshot } from '@/topics/environment';
import { liveReading, withHostCli } from '@/topics/host-topics';

/** The screens' own voice in the Log: what the Host answered when asked. */
const say = speakingAs(deviceLog(), 'host');

/**
 * The Host Screen's account of one Host: the Listing that its Host Server
 * pushes, drawn as it arrives. Nothing is read on focus or after a write: the
 * push brings the change.
 *
 * While the screen is focused it holds the Host's Connection, as an Attach
 * does, so its Host Server stays and the Listing stays live. Leaving it starts
 * the idle minute. A Connection that closes while the screen is focused, such
 * as one a return from the background drops, is held again.
 *
 * In Sessions only, and while the Host CLI install puts a first `muxify` on
 * the Host, tmux lists the Sessions as it did before the Host Server, on
 * focus and when that state begins.
 *
 * `retry` holds the Connection again after it could not be held, and lists the
 * Sessions again.
 */
export function useHostListing(hostId: string) {
  const connections = appConnections();
  const live = useSyncExternalStore(
    useCallback((changed: () => void) => connections.subscribeListing((which) => {
      if (which === hostId) changed();
    }), [connections, hostId]),
    () => connections.listing(hostId),
  );
  const hostCli = useSyncExternalStore(
    useCallback((changed: () => void) => connections.subscribeHostCli(changed), [connections]),
    () => connections.hostCli(hostId),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Listing>(UNASKED);
  const [hostName, setHostName] = useState('this Host');
  const [attempt, setAttempt] = useState(0);
  /** The latest push, which stays on screen until the next Connection's first push. */
  const [last, setLast] = useState<EnvironmentSnapshot | null>(null);
  const pushed = live?.snapshot ?? null;
  if (pushed !== null && pushed !== last) setLast(pushed);

  const focused = useIsFocused();
  const closed = live?.server.kind === 'closed';
  // `closed` and `attempt` are here to hold the Connection again.
  useEffect(() => {
    if (!focused) return;
    let release: (() => void) | null = null;
    let left = false;
    void (async () => {
      const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
      if (left) return;
      if (!host) {
        setFailure('This Host is no longer saved.');
        return;
      }
      setHostName(host.displayName);
      try {
        const held = await appConnections().hold(host);
        if (left) held();
        else {
          release = held;
          setFailure(null);
        }
      } catch (error) {
        const message = describeConnectionFailure(error);
        say(`${host.displayName} could not be reached: ${message}`);
        if (!left) setFailure(message);
      }
    })();
    return () => {
      left = true;
      release?.();
    };
  }, [focused, hostId, closed, attempt]);

  const fallback = live?.server.kind === 'sessions-only' || live?.server.kind === 'installing';
  useEffect(() => {
    if (!focused || !fallback) return;
    let left = false;
    void (async () => {
      setSessions(asking);
      const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
      if (!host) {
        if (!left) setSessions(refused('This Host is no longer saved.'));
        return;
      }
      try {
        // A Host with no tmux server is a Host with no Sessions, which the
        // client already forgives: it must not read as a failure here.
        const listed = await appConnections().read(host, (transport) =>
          new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).listSessions());
        say(`${host.displayName} listed ${listed.length} Sessions`);
        if (!left) setSessions(answered(listed));
      } catch (error) {
        const message = describeConnectionFailure(error);
        say(`${host.displayName} refused the listing: ${message}`);
        if (!left) setSessions(refused(message));
      }
    })();
    return () => {
      left = true;
    };
  }, [focused, hostId, fallback, attempt]);

  const reading = liveReading({ live, last, sessions, failure, host: hostName });

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return {
    listing: reading.listing,
    topics: withHostCli(reading.topics, hostCli),
    /** No Host Server runs: Topic Actions, Go to and New Topic are hidden. */
    sessionsOnly: live?.server.kind === 'sessions-only',
    retry,
  };
}
