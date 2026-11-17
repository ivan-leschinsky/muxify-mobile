import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeConnectionFailure } from '@/ssh/connect-host';
import { followTopic } from '@/ssh/topic-feed';
import { deviceHostStore } from '@/storage/device-store';
import { appConnections } from '@/tmux/ssh-connection';

import type { TopicId } from './environment';
import type { TopicRead } from './topic-detail';

const say = speakingAs(deviceLog(), 'topic');

/**
 * One read of a Topic from its Host, on the Host's Connection.
 *
 * The Topic entry path asks this. It
 * never throws: a Host that is no longer saved, a Host that refuses and a
 * Topic the Host cannot show are each a failed read that carries its reason.
 */
export async function readTopic(hostId: string, topicId: TopicId): Promise<TopicRead> {
  const host = (await deviceHostStore().load()).hosts.find((candidate) => candidate.id === hostId);
  if (!host) return { kind: 'failed', error: 'This Host is no longer saved.' };
  try {
    const read = await appConnections().read(host, (transport, muxify) =>
      muxify.show((command) => transport.exec(command), topicId),
    );
    say(
      read.kind === 'shown'
        ? `${host.displayName} showed a Topic`
        : `${host.displayName} could not show a Topic: ${read.error}`,
    );
    return read;
  } catch (error) {
    const message = describeConnectionFailure(error);
    say(`${host.displayName} refused the Topic: ${message}`);
    return { kind: 'failed', error: message };
  }
}

/**
 * The Attach's `topic` subscription, on the Host Server of the Host's open
 * Connection, until the answer is called. With no Host Server on that
 * Connection there is no Topic detail, and the read fails with the reason.
 */
export function followHostTopic(hostId: string, topicId: TopicId, onRead: (read: TopicRead) => void): () => void {
  const server = appConnections().hostServer(hostId);
  if (!server) {
    onRead({ kind: 'failed', error: 'Topics are unavailable on this Host: no Host Server runs on its Connection.' });
    return () => {};
  }
  return followTopic(server, topicId, onRead, (line) => say(`Host Server: ${line}`));
}
