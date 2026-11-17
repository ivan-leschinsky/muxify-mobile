import { describeError } from '@/lib/describe-error';
import type { TopicId } from '@/topics/environment';
import { parseTopicDetail, TOPIC_GONE, type TopicRead } from '@/topics/topic-detail';

import { HostServerError, type HostServer, type HostServerCall } from './host-server';

/**
 * Holds one `topic` subscription on a Host Server until the answer is called,
 * and hears each push as a read of the Topic. The existing Topic detail parser
 * is the decoder. A null item means that the Topic is gone.
 *
 * A server that starts again on the same Connection is subscribed again once
 * it is live, and its first item carries the whole Topic. In Sessions only
 * there is no Topic detail, and the read fails with the reason. A Connection
 * that closes ends it: the next Connection's Host Server is followed afresh.
 */
export function followTopic(
  server: HostServer,
  topic: TopicId,
  onRead: (read: TopicRead) => void,
  say: (line: string) => void = () => {},
): () => void {
  let ended = false;
  let call: HostServerCall<unknown> | null = null;

  function subscribe(): void {
    const mine: HostServerCall<unknown> = server.subscribe({ topic: { id: topic } }, (item) => {
      if (ended || call !== mine) return;
      if (item === null) {
        onRead({ kind: 'failed', error: TOPIC_GONE });
        return;
      }
      try {
        onRead({ kind: 'shown', topic: parseTopicDetail(item) });
      } catch (error) {
        say(`a Topic this phone cannot read: ${describeError(error)}`);
        onRead({ kind: 'failed', error: `This phone cannot read the Topic: ${describeError(error)}` });
      }
    });
    call = mine;
    mine.then(
      () => {
        if (call === mine) call = null;
      },
      (error: unknown) => {
        if (ended || call !== mine) return;
        call = null;
        const state = server.state();
        if (state.kind === 'closed') return;
        if (state.kind === 'sessions-only') {
          onRead({ kind: 'failed', error: `Topics are unavailable on this Host: ${state.reason}` });
          return;
        }
        const stopped = error instanceof HostServerError && error.code === 'unavailable';
        // The server stopped: the next live server on this Connection is asked again.
        if (stopped && state.kind === 'live') subscribe();
        else if (!stopped) onRead({ kind: 'failed', error: error instanceof HostServerError ? error.message : describeError(error) });
      },
    );
  }

  const stopHearing = server.onState((state) => {
    if (!ended && call === null && state.kind === 'live') subscribe();
  });
  subscribe();

  return () => {
    if (ended) return;
    ended = true;
    stopHearing();
    const mine = call;
    call = null;
    mine?.cancel();
  };
}
