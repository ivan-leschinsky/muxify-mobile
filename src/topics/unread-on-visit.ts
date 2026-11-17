import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeError } from '@/lib/describe-error';
import type { HostServer } from '@/ssh/host-server';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';

const say = speakingAs(deviceLog(), 'topic');

/** The part of the Connections that Unread on visit uses: the Host Server of a Host's open Connection. */
export type VisitConnections = { hostServer(hostId: string): HostServer | null };

/**
 * Unread on visit: `mark_read { topics: [id] }` on the Host Server of the
 * Host's open Connection, as the Mac sends when it shows a Session of the
 * Topic. It is not a Host Write: nothing waits for it, it shows nothing, and a
 * failure is only logged. With no Host Server, or in Sessions only, nothing is
 * sent. The Host Server pushes the Listing and the Topic without the Unread.
 */
export function markTopicRead(hostId: string, topicId: TopicId, connections: VisitConnections = appConnections()): void {
  const server = connections.hostServer(hostId);
  if (!server || server.state().kind === 'sessions-only') return;
  void Promise.resolve()
    .then(() => server.request({ mark_read: { topics: [topicId] } }))
    .catch((error: unknown) => say(`the Host did not mark Topic ${topicId} read on the visit: ${describeError(error)}`));
}
