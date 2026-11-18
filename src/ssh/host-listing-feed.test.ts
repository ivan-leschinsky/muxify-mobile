import type { HostServer, HostServerState } from './host-server';
import { followListing } from './host-listing-feed';

const LIVE: HostServerState = { kind: 'live', build: 'muxify 1', protocol: 1 };

/** A Host Server whose state and subscriptions the test drives. */
function fakeServer(initial: HostServerState) {
  let state = initial;
  const listeners = new Set<(state: HostServerState) => void>();
  const subscriptions: { payload: object; onItem: (item: unknown) => void; cancelled: boolean }[] = [];
  const server: HostServer = {
    state: () => state,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: () => Object.assign(new Promise<unknown>(() => {}), { cancel: () => {} }),
    subscribe: (payload, onItem) => {
      const entry = { payload, onItem, cancelled: false };
      subscriptions.push(entry);
      return Object.assign(new Promise<unknown>(() => {}), { cancel: () => { entry.cancelled = true; } });
    },
    installAnswered: () => {},
    close: () => {},
  };
  return {
    server,
    subscriptions,
    become(next: HostServerState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

const snapshot = (...labels: string[]) => ({
  no_topic: [],
  pinned: [],
  sessions: [],
  sidebar: { sessions: true, topics: false },
  tags: [],
  unpinned: {
    bench: [], guests: [], kind: 'in_play', limit: 3,
    places: labels.map((label, index) => ({
      kind: 'topic', mark: null, sessions: [],
      topic: { id: `t${index}`, label, note: null, state: 'empty', tags: [] },
    })),
  },
});
const labelsOf = (feed: ReturnType<typeof followListing>) =>
  feed.current().snapshot?.unpinned.places.map((card) => (card.kind === 'topic' ? card.topic.label : card.kind));

describe('the Listing of a Host Server', () => {
  it('subscribes once the server is live, and keeps the newest push, with its sidebar', () => {
    const fake = fakeServer({ kind: 'starting' });
    const feed = followListing(fake.server);
    const heard = jest.fn();
    feed.onChange(heard);
    expect(fake.subscriptions).toEqual([]);
    expect(feed.current()).toEqual({ server: { kind: 'starting' }, snapshot: null });

    fake.become(LIVE);
    expect(fake.subscriptions.map((entry) => entry.payload)).toEqual([{ snapshot: {} }]);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    fake.subscriptions[0]!.onItem(snapshot('Ship', 'Docs'));

    expect(labelsOf(feed)).toEqual(['Ship', 'Docs']);
    expect(feed.current().snapshot?.sidebar).toEqual({ topics: false, sessions: true });
    expect(feed.current().server).toEqual(LIVE);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('subscribes again on a server that starts again, and keeps the last push until the new first item', () => {
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server);
    fake.subscriptions[0]!.onItem(snapshot('Ship'));

    fake.become({ kind: 'starting' });
    fake.become(LIVE);
    expect(fake.subscriptions).toHaveLength(2);
    expect(fake.subscriptions[0]!.cancelled).toBe(true);
    expect(labelsOf(feed)).toEqual(['Ship']);

    // The old server, shutting down, pushes no more.
    fake.subscriptions[0]!.onItem(snapshot('Old'));
    expect(labelsOf(feed)).toEqual(['Ship']);
    fake.subscriptions[1]!.onItem(snapshot('Docs'));
    expect(labelsOf(feed)).toEqual(['Docs']);
  });

  it('keeps the last snapshot over one it cannot read, and says so', () => {
    const fake = fakeServer(LIVE);
    const said: string[] = [];
    const feed = followListing(fake.server, (line) => said.push(line));
    fake.subscriptions[0]!.onItem(snapshot('Ship'));
    fake.subscriptions[0]!.onItem({ sessions: 'nope' });

    expect(labelsOf(feed)).toEqual(['Ship']);
    expect(said).toEqual([expect.stringContaining('a snapshot this phone cannot read')]);
  });

  it('says when the server falls to Sessions only', () => {
    const fake = fakeServer(LIVE);
    const feed = followListing(fake.server);
    fake.become({ kind: 'sessions-only', reason: 'the Host Server did not answer' });

    expect(feed.current().server).toEqual({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
  });
});
