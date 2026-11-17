import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Picker } from '@expo/ui/swift-ui';

import HostScreen from '@/app/hosts/[id]';
import { followListing, type ListingFeed } from '@/ssh/host-listing-feed';
import type { HostServer, HostServerState } from '@/ssh/host-server';
import { searchBar, toolbarMenuActions } from '@/test-support/toolbar';
import type { HostCliState } from '@/topics/host-cli-install';

/**
 * The Host Screen through a fake Host Server: the real Listing feed and the
 * real hook, on a registry that the test drives.
 */

const mockRouter = { push: jest.fn() };
const mockSend = jest.fn();
const mockRelease = jest.fn();
let mockFocused = true;
let mockConnections: Record<string, unknown>;

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    ...require('@/test-support/toolbar').mockStack,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: 'host' }),
    useIsFocused: () => mockFocused,
    useFocusEffect: (effect: () => void) => {
      const focused = mockFocused;
      React.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
    },
  };
});
// Native views: the strip shows the tab on show, as the accessibility tree does.
jest.mock('@/components/tab-swipe', () => ({
  TabSwipe: ({ tab, header, renderTab }: {
    tab: string;
    header: (shown: string) => React.ReactNode;
    renderTab: (each: string) => React.ReactNode;
  }) => [header(tab), renderTab(tab)],
}));
jest.mock('@/navigation/use-back-swipe', () => ({ useBackSwipe: () => {} }));
jest.mock('@expo/ui/swift-ui', () => {
  const through = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', VStack: 'VStack', Picker: 'Picker', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', Image: 'Image', Spacer: 'Spacer',
    ContextMenu: Object.assign(through, { Items: through, Trigger: through }),
    SwipeActions: Object.assign(through, { Actions: through }),
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/components/tappable-row', () => ({ TAPPABLE_ROW: {} }));
jest.mock('@/components/topic-marks', () => ({ MarkImage: () => null, TagMarks: () => null }));
jest.mock('@/components/fill-place-sheet', () => ({ FillPlaceSheet: () => null }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/hooks/use-host-entry', () => ({ useHostEntry: () => ({ openSession: jest.fn(), openTopic: jest.fn(), busyTopic: null }) }));
jest.mock('@/hooks/use-go-to-paths', () => ({ useGoToPaths: () => ({ paths: { query: '', rows: [] }, reading: { kind: 'idle' }, ask: () => {} }) }));
jest.mock('@/topics/act-on-topic', () => ({
  ...jest.requireActual('@/topics/act-on-topic'),
  sendTopicOrder: (...args: unknown[]) => mockSend(...args),
}));
jest.mock('@/keyboard/key-commands', () => ({ useScreenKeyboardShortcuts: () => {} }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({
  settings: {}, appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark, rememberHostScreenTab: jest.fn(),
}) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({
    load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }),
    recentSessionsFor: async () => [],
  }),
  deviceGoToCache: () => ({ load: async () => [], save: async () => {} }),
}));
jest.mock('@/tmux/attach-context', () => ({
  useAttachHolder: () => ({ current: () => null, disconnect: jest.fn() }),
  useCurrentAttach: () => null,
  useAttachState: () => null,
  useOpenSession: jest.fn(),
}));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => mockConnections }));

/** A Host Server that the test moves and pushes snapshots from. */
function fakeServer(initial: HostServerState) {
  let state = initial;
  const listeners = new Set<(state: HostServerState) => void>();
  const items: ((item: unknown) => void)[] = [];
  const subscriptions: object[] = [];
  const never = () => Object.assign(new Promise<unknown>(() => {}), { cancel: () => {} });
  const server: HostServer = {
    state: () => state,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: never,
    subscribe: (payload, onItem) => {
      subscriptions.push(payload);
      items.push(onItem);
      return never();
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
    push: (item: unknown) => act(async () => { items[items.length - 1]!(item); }),
  };
}

/** A snapshot as the Host Server pushes it: one Session in a Topic In Play for each label. */
const snapshotItem = (...labels: string[]) => ({
  no_topic: [],
  pinned: [],
  sessions: labels.map((label, index) => ({
    activity: 1763100000, id: `$${index}`, mark: null, name: label.toLowerCase(), topic: `t${index}`,
    windows: [{ active: true, id: `@${index}`, index: 0, mark: null, name: 'shell' }],
  })),
  sidebar: { sessions: true, topics: true },
  tags: [],
  unpinned: {
    bench: [], guests: [], kind: 'in_play', limit: 3,
    places: labels.map((label, index) => ({
      kind: 'topic', mark: null, sessions: [`$${index}`],
      topic: { id: `t${index}`, label, note: null, state: 'live', tags: [] },
    })),
  },
});

let renderer: ReactTestRenderer;
let feed: ListingFeed;
let hostCli: HostCliState;
let read: jest.Mock;
const listingListeners = new Set<(hostId: string) => void>();
const listingChanged = () => { for (const listener of [...listingListeners]) listener('host'); };

/** A new Connection, whose Host Server the registry follows from now on. */
function connect(initial: HostServerState) {
  const fake = fakeServer(initial);
  const mine = followListing(fake.server);
  feed = mine;
  mine.onChange(() => { if (feed === mine) listingChanged(); });
  listingChanged();
  return fake;
}

async function mount() {
  await act(async () => { renderer = create(<HostScreen />); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  hostCli = { kind: 'idle' };
  read = jest.fn(async () => [{ name: 'api', windowCount: 1 }]);
  mockSend.mockResolvedValue({ kind: 'changed' });
  mockConnections = {
    hold: jest.fn(async () => mockRelease),
    listing: () => feed.current(),
    subscribeListing: (listener: (hostId: string) => void) => {
      listingListeners.add(listener);
      return () => listingListeners.delete(listener);
    },
    hostCli: () => hostCli,
    subscribeHostCli: () => () => {},
    read,
    write: jest.fn(),
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

const labels = () => renderer.root.findAllByType(Button).flatMap((node) =>
  (node.props.modifiers ?? []).flatMap((modifier: { name: string; value: unknown }) => (modifier.name === 'accessibilityLabel' ? [modifier.value as string] : [])));
const button = (label: string) => renderer.root.findAllByType(Button)
  .find((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === label))!;
const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children);
const topics = () => labels().filter((label) => label.startsWith('Topic '));

describe('a live Host Screen', () => {
  it('holds its Connection while focused, draws each pushed snapshot, and reads nothing on focus', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();

    expect(mockConnections.hold).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }));
    expect(server.subscriptions).toEqual([{ snapshot: {} }]);
    expect(texts()).toContain('Reading Dev Host…');

    await server.push(snapshotItem('Ship'));
    expect(topics()).toEqual(['Topic Ship']);

    // Made on the Host, with no focus and no read.
    await server.push(snapshotItem('Ship', 'Docs'));
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);
    expect(texts()).not.toContain('Reading Dev Host…');

    mockFocused = false;
    await act(async () => { renderer.update(<HostScreen />); });
    expect(mockRelease).toHaveBeenCalledTimes(1);
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(read).not.toHaveBeenCalled();
    expect(mockConnections.hold).toHaveBeenCalledTimes(2);
  });

  it('reads nothing after a card write or on a Move start: the push brings the change', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(snapshotItem('Ship', 'Docs'));

    await act(async () => { button('Move Down').props.onPress(); });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ id: 'host' }), 't0', { kind: 'action', action: 'move-down' }, expect.any(Function));
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);

    await server.push(snapshotItem('Docs', 'Ship'));
    expect(topics()).toEqual(['Topic Docs', 'Topic Ship']);

    await act(async () => { button('Move…').props.onPress(); });
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps the last Listing on screen, with no spinner, while a new Connection waits for its first push', async () => {
    const first = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await first.push(snapshotItem('Ship'));

    await act(async () => { first.become({ kind: 'closed' }); });
    expect(mockConnections.hold).toHaveBeenCalledTimes(2);
    let second!: ReturnType<typeof connect>;
    await act(async () => { second = connect({ kind: 'starting' }); });

    expect(topics()).toEqual(['Topic Ship']);
    expect(texts()).not.toContain('Reading Dev Host…');
    await act(async () => { second.become({ kind: 'live', build: 'muxify 1', protocol: 1 }); });
    await second.push(snapshotItem('Ship', 'Docs'));
    expect(topics()).toEqual(['Topic Ship', 'Topic Docs']);
  });
});

describe('Sessions only', () => {
  it('shows the Sessions tab from tmux, says why there are no Topics, and hides the Topic Actions, Go to and New Topic', async () => {
    connect({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
    await mount();

    expect(read).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('Topics are unavailable on Dev Host: the Host Server did not answer');
    expect(labels()).toEqual(['Session api']);
    expect(renderer.root.findAllByType(Picker)).toEqual([]);
    expect(searchBar(renderer)).toBeUndefined();
    expect([...toolbarMenuActions(renderer).keys()]).toEqual(['New Session', 'Configure chooser']);

    toolbarMenuActions(renderer).get('New Session')!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/session-form', params: { hostId: 'host' } });
  });

  it('falls to Sessions only from a live Host Server that keeps stopping', async () => {
    const server = connect({ kind: 'live', build: 'muxify 1', protocol: 1 });
    await mount();
    await server.push(snapshotItem('Ship'));

    await act(async () => { server.become({ kind: 'sessions-only', reason: 'the Host Server stopped 3 times in a minute (boom)' }); });

    expect(topics()).toEqual([]);
    expect(labels()).toEqual(['Session api']);
    expect(texts()).toContain('Topics are unavailable on Dev Host: the Host Server stopped 3 times in a minute (boom)');
  });
});

describe('the Host CLI install', () => {
  it('says Muxify is being installed on a Host with no muxify', async () => {
    hostCli = { kind: 'running' };
    connect({ kind: 'installing' });
    await mount();

    expect(texts()).toContain('Installing Muxify on this Host…');
    expect(labels()).toEqual(['Session api']);
  });

  it('says Muxify is being updated on a Host whose muxify is too old for a Host Server', async () => {
    hostCli = { kind: 'running' };
    connect({ kind: 'sessions-only', reason: "the Host's muxify is too old (muxify 0)" });
    await mount();

    expect(texts()).toContain('Updating Muxify on this Host…');
  });
});
