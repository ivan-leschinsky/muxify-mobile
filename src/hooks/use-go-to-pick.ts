import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { PathOpening } from '@/domain/go-to';
import type { Host } from '@/storage/records';
import { useAttachHolder, useOpenSession } from '@/tmux/attach-context';
import { captureAttachOrigin } from '@/tmux/attach-holder';
import { execCommandRunner } from '@/tmux/exec-runner';
import { appConnections } from '@/tmux/ssh-connection';
import { TmuxClient } from '@/tmux/tmux-client';
import { intentAfter, intentFor, type Intent } from '@/topics/request';
import { recordVisit } from '@/topics/visit';

import { useHostWrite, type HostWriteRun } from './use-host-write';

type NewSession = Extract<PathOpening, { kind: 'new' }>;

/**
 * The Host Write of a Go to pick that makes a Session: `session new` at the
 * folder, then the Attach, then the visit. A second try at the same folder
 * and name is the same Request, so it makes no second Session.
 *
 * A pick that waits for the Connection goes only while the screen has the
 * focus. After the user leaves, it sends nothing.
 */
export function useGoToPick(hostId: string, onOpened: () => void) {
  const holder = useAttachHolder();
  const openSession = useOpenSession();
  const { write, hostName, send, check } = useHostWrite(hostId);
  const held = useRef<Intent | null>(null);
  const [picked, setPicked] = useState<NewSession | null>(null);
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; };
  }, []));

  const attach = async (session: string, folder: string, host: Host, step: HostWriteRun['step']) => {
    if (!focused.current) return undefined;
    step('attaching');
    await openSession({ hostId, destination: { sessionName: session, topic: null }, origin: captureAttachOrigin(holder.current()) });
    recordVisit(host, folder);
    return true as const;
  };
  const opened = (done: true | undefined) => { if (done && focused.current) onOpened(); };

  const make = (opening: NewSession) => {
    setPicked(opening);
    const intent = intentFor(held.current, JSON.stringify([opening.directory, opening.name]));
    held.current = intent;
    void send(async ({ host, step, refuse, unsure }) => {
      const added = await appConnections().write(host, (transport, muxify) => {
        if (!focused.current) return refuse('You left the Host Screen before the Connection was up.');
        step('sending');
        return muxify.newSession((command) => transport.exec(command), opening.directory, opening.name, intent.request);
      });
      held.current = intentAfter(intent, added);
      if (added.kind === 'failed') return refuse(added.error);
      if (added.kind === 'unknown') return unsure(added.message);
      return attach(added.session, opening.directory, host, step);
    }).then(opened);
  };

  return {
    write,
    hostName,
    /** The Session that the last pick makes, for the words of its Host Write. */
    picked,
    make,
    retry: () => { if (picked) make(picked); },
    /** Reads the Host's Sessions for the one an unanswered pick asked for, and opens it. */
    check: () => {
      const opening = picked;
      if (!opening) return;
      void check(async ({ host, step, refuse }) => {
        const sessions = await appConnections().read(host, (transport) =>
          new TmuxClient(execCommandRunner(transport, host.tmuxExecutablePath)).listSessions());
        if (!sessions.some((session) => session.name === opening.name)) {
          return refuse(`${opening.name} is not on ${host.displayName}. Pick the folder again to make it.`);
        }
        return attach(opening.name, opening.directory, host, step);
      }).then(opened);
    },
  };
}
