import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, Picker } from '@expo/ui/swift-ui';

import HostScreen from '@/app/hosts/[id]';
import { answered } from '@/domain/host-listing';
import { requestGoTo } from '@/keyboard/go-to-request';
import type { KeyboardHandlers } from '@/keyboard/key-commands';
import { searchBar, toolbarMenuActions } from '@/test-support/toolbar';
import type { EnvironmentSnapshot, SessionId, TopicId } from '@/topics/environment';
import type { HostTopics } from '@/topics/host-topics';

const mockRouter = { push: jest.fn() };
const mockRemember = jest.fn();
const mockOpenSession = jest.fn();
const mockOpen = jest.fn();
const mockPaths = jest.fn();
const mockNewSession = jest.fn();
const mockVisit = jest.fn();
const mockSearch = { focus: jest.fn(), cancelSearch: jest.fn() };
let mockKeys: KeyboardHandlers = {};
let mockFocused = true;
let mockSettings: { hostScreenTabs?: Record<string, string> } = {};
let mockReading: { listing: unknown; topics: HostTopics; read: jest.Mock };

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
jest.mock('@/hooks/use-host-reading', () => ({ useHostReading: () => mockReading }));
jest.mock('@/hooks/use-host-entry', () => ({ useHostEntry: (_host: string, entered: () => void) => ({
  openSession: (name: string) => { mockOpenSession(name); entered(); }, openTopic: jest.fn(), busyTopic: null,
}) }));
jest.mock('@/hooks/use-topic-card-writes', () => ({ useTopicCardWrites: () => ({ order: jest.fn(), writing: () => false }) }));
jest.mock('@/keyboard/key-commands', () => ({ useScreenKeyboardShortcuts: (handlers: KeyboardHandlers) => { mockKeys = handlers; } }));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({
  settings: mockSettings, appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark, rememberHostScreenTab: mockRemember,
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
  useOpenSession: () => mockOpen,
}));
jest.mock('@/tmux/ssh-connection', () => {
  const work = (_host: unknown, run: Function) =>
    run({ exec: jest.fn() }, { rankedSessionPaths: mockPaths, newSession: mockNewSession, visit: mockVisit });
  return { appConnections: () => ({ read: work, write: work }) };
});

const sid = (id: string) => id as SessionId;
const tid = (id: string) => id as TopicId;
const topicCard = (id: string, label: string) =>
  ({ kind: 'topic' as const, mark: null, sessions: [], topic: { id: tid(id), label, note: null, tags: [], state: 'live' as const } });
const snapshot = (capabilities: string[]): EnvironmentSnapshot => ({
  capabilities,
  sidebar: null,
  tags: [],
  sessions: [
    { id: sid('$1'), name: 'api', activity: 0, mark: null, topic: null, windows: null },
    { id: sid('$2'), name: 'api/fix-login', activity: 0, mark: null, topic: tid('t1'), windows: null },
  ],
  pinned: [],
  unpinned: { limit: 3, places: [topicCard('t1', 'Fix login')], guests: [], bench: [] },
  no_topic: [sid('$1')],
});
const path = (name: string) => ({ kind: 'session_path', name, label: name, directory: `/work/${name}`, worktree: null, alsoIn: [], lastVisit: null });

let renderer: ReactTestRenderer;
async function mount(capabilities = ['request', 'session-paths']) {
  mockReading = {
    listing: answered([{ name: 'api', windowCount: 1 }, { name: 'api/fix-login', windowCount: 2 }]),
    topics: { kind: 'listed', snapshot: snapshot(capabilities) },
    read: jest.fn(async () => {}),
  };
  await act(async () => { renderer = create(<HostScreen />); });
  const field = searchBar(renderer);
  if (field) field.props.ref.current = mockSearch;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = {};
  mockKeys = {};
  mockFocused = true;
  mockPaths.mockResolvedValue({ kind: 'listed', rows: [path('api'), path('web')] });
  mockNewSession.mockImplementation(async (_exec, _folder, name) => ({ kind: 'added', session: name }));
  mockVisit.mockResolvedValue({ kind: 'changed' });
  mockOpen.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

/** What VoiceOver calls each button on screen, in order. */
const labels = () => renderer.root.findAllByType(Button).flatMap((node) =>
  (node.props.modifiers ?? []).flatMap((modifier: { name: string; value: unknown }) => (modifier.name === 'accessibilityLabel' ? [modifier.value as string] : [])));
const row = (label: string) => renderer.root.findAllByType(Button)
  .find((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === label))!;
const menu = () => [...toolbarMenuActions(renderer).keys()];
const tabs = () => renderer.root.findAllByType(Picker);
const focusGoTo = () => act(async () => { searchBar(renderer)!.props.onFocus(); });
const type = (text: string) => act(async () => { searchBar(renderer)!.props.onChangeText({ nativeEvent: { text } }); });

describe('the tabs', () => {
  it('opens on Topics, and remembers Sessions for this Host on a tap and on ⌥⌘T', async () => {
    await mount();

    expect(labels()).toEqual(expect.arrayContaining(['Topic Fix login', 'No Topic']));
    await act(async () => { tabs()[0]!.props.onSelectionChange('sessions'); });
    await act(async () => { mockKeys['switch-tab']!(); });

    expect(mockRemember.mock.calls).toEqual([['host', 'sessions'], ['host', 'sessions']]);
  });

  it('shows every running Session on the Sessions tab that the user last chose', async () => {
    mockSettings = { hostScreenTabs: { host: 'sessions' } };
    await mount();

    expect(labels()).toEqual(['Session api', 'Session api/fix-login']);
  });
});

describe('on a Host CLI with no Go to', () => {
  it('has no bar, and keeps New Session and New Topic in Options with the sheets of today', async () => {
    await mount(['request']);

    expect(searchBar(renderer)).toBeUndefined();
    expect(menu()).toEqual(['New Session', 'New Topic', 'Configure chooser']);
    expect(mockKeys['go-to']).toBeUndefined();

    toolbarMenuActions(renderer).get('New Topic')!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/topic-form', params: { hostId: 'host' } });
  });
});

describe('the bar at the bottom', () => {
  it('has Go to and ＋, and moves New Topic and New Session out of Options', async () => {
    await mount();

    expect(searchBar(renderer)!.props.placeholder).toBe('Go to');
    expect(menu()).toEqual(['Configure chooser', 'New Topic', 'New Session at a folder']);

    toolbarMenuActions(renderer).get('New Topic')!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/new-topic', params: { hostId: 'host' } });
  });

  it('puts the keys in the Go to field for ⌘P', async () => {
    await mount();
    await act(async () => { mockKeys['go-to']!(); });

    expect(mockSearch.focus).toHaveBeenCalled();
  });

  it('is gone while another screen has the focus, and takes ⌘P from the Terminal when it comes back', async () => {
    await mount();
    mockFocused = false;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(searchBar(renderer)).toBeUndefined();

    requestGoTo('host');
    mockFocused = true;
    await act(async () => { renderer.update(<HostScreen />); });

    expect(searchBar(renderer)).toBeDefined();
    expect(mockSearch.focus).toHaveBeenCalledTimes(1);
  });

  it('goes away while a Topic card moves', async () => {
    await mount();
    await act(async () => { row('Move…').props.onPress(); });

    expect(searchBar(renderer)).toBeUndefined();
    expect(mockKeys['go-to']).toBeUndefined();
  });
});

describe('Go to', () => {
  it('shows one list in place of the tab: the running Sessions with their Topic, then the folders', async () => {
    await mount();
    await focusGoTo();

    expect(tabs()).toEqual([]);
    expect(labels().filter((label) => label !== 'New Session here')).toEqual(['Session api', 'Session api/fix-login', 'Folder /work/api', 'Folder /work/web']);
  });

  it('matches the running Sessions by the text in the field, and asks the Host for the folders', async () => {
    jest.useFakeTimers();
    await mount();
    await focusGoTo();
    mockPaths.mockResolvedValue({ kind: 'listed', rows: [path('web')] });
    await type('login');
    await act(async () => { jest.runAllTimers(); });
    jest.useRealTimers();

    expect(mockPaths).toHaveBeenLastCalledWith(expect.any(Function), 'login');
    expect(labels().filter((label) => label !== 'New Session here')).toEqual(['Session api/fix-login', 'Folder /work/web']);
  });

  it('goes to a running Session, and shows the tab again', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { row('Session api/fix-login').props.onPress(); });

    expect(mockOpenSession).toHaveBeenCalledWith('api/fix-login');
    expect(mockRouter.push).toHaveBeenCalledWith('/terminal');
    expect(mockSearch.cancelSearch).toHaveBeenCalled();
    expect(tabs()).toHaveLength(1);
  });

  it('goes to the Session in no Topic that runs at a folder, makes none, and records the visit', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { row('Folder /work/api').props.onPress(); });

    expect(mockOpenSession).toHaveBeenCalledWith('api');
    expect(mockNewSession).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith(expect.any(Function), '/work/api', expect.any(String));
  });

  it('makes a Session at a folder where none runs, opens it, and records the visit', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { row('Folder /work/web').props.onPress(); });

    expect(mockNewSession).toHaveBeenCalledWith(expect.any(Function), '/work/web', 'web', expect.any(String));
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ destination: { sessionName: 'web', topic: null } }));
    expect(mockVisit).toHaveBeenCalledWith(expect.any(Function), '/work/web', expect.any(String));
    expect(mockRouter.push).toHaveBeenCalledWith('/terminal');
  });

  it('makes one more Session with a +2 name for New Session here, and for ⌘↩ on the row', async () => {
    await mount();
    await focusGoTo();
    const [here] = renderer.root.findAllByType(Button).filter((node) => node.props.label === 'New Session here');
    await act(async () => { here!.props.onPress(); });

    expect(mockNewSession).toHaveBeenCalledWith(expect.any(Function), '/work/api', 'api+2', expect.any(String));

    await focusGoTo();
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['new-session-here']!(); });
    expect(mockNewSession).toHaveBeenLastCalledWith(expect.any(Function), '/work/web', 'web', expect.any(String));
  });

  it('picks the row that ↓ moved to on Return, from a hardware keyboard and from the software one', async () => {
    await mount();
    await focusGoTo();
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-pick']!(); });
    expect(mockOpenSession).toHaveBeenLastCalledWith('api/fix-login');

    await focusGoTo();
    await act(async () => { searchBar(renderer)!.props.onSearchButtonPress(); });
    expect(mockOpenSession).toHaveBeenLastCalledWith('api');
  });

  it('has the List Keys only while the list is on show, and closes on Escape', async () => {
    await mount();
    expect(mockKeys['list-pick']).toBeUndefined();

    await focusGoTo();
    await act(async () => { mockKeys['list-close']!(); });

    expect(tabs()).toHaveLength(1);
    expect(mockKeys['list-pick']).toBeUndefined();
  });

  it('keeps the list and says why when the Host refuses the folder, and sends a new Request on Retry', async () => {
    mockNewSession.mockResolvedValueOnce({ kind: 'failed', error: 'No folder at /work/web.' });
    await mount();
    await focusGoTo();
    await act(async () => { row('Folder /work/web').props.onPress(); });

    expect(renderer.root.findAllByType('Text' as never).map((node) => node.props.children)).toContain('No folder at /work/web.');
    expect(mockRouter.push).not.toHaveBeenCalled();

    await act(async () => { renderer.root.findAllByType(Button).find((node) => node.props.label === 'Retry')!.props.onPress(); });
    expect(mockNewSession).toHaveBeenCalledTimes(2);
    expect(mockNewSession.mock.calls[1][3]).not.toBe(mockNewSession.mock.calls[0][3]);
  });
});

describe('New Session at a folder', () => {
  it('lists the folders only, and always makes a Session, with a free name', async () => {
    await mount();
    await act(async () => { toolbarMenuActions(renderer).get('New Session at a folder')!.props.onPress(); });

    expect(mockSearch.focus).toHaveBeenCalled();
    expect(searchBar(renderer)!.props.placeholder).toBe('New Session at a folder');
    expect(labels()).toEqual(['Folder /work/api', 'Folder /work/web']);

    await act(async () => { row('Folder /work/api').props.onPress(); });
    expect(mockNewSession).toHaveBeenCalledWith(expect.any(Function), '/work/api', 'api+2', expect.any(String));
    expect(mockOpenSession).not.toHaveBeenCalled();
  });
});
