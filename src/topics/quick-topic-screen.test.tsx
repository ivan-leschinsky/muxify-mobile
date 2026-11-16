import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import NewTopicScreen from '@/app/new-topic';
import type { KeyboardHandlers } from '@/keyboard/key-commands';
import { ExecDeadlineError } from '@/ssh/host-connections';
import { toolbarButton, toolbarSide } from '@/test-support/toolbar';

const mockLoad = jest.fn();
const mockRead = jest.fn();
const mockCreate = jest.fn();
const mockPaths = jest.fn();
const mockAdd = jest.fn();
const mockAddWorktree = jest.fn();
const mockShow = jest.fn();
const mockVisit = jest.fn();
const mockOpen = jest.fn();
const mockRouter = { back: jest.fn(), dismissTo: jest.fn() };
let mockKeys: KeyboardHandlers = {};
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ hostId: 'host' }),
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  const through = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', VStack: 'VStack', ScrollView: 'ScrollView', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', TextField: 'TextField', Image: 'Image', Spacer: 'Spacer',
    ContextMenu: Object.assign(through, { Items: through, Trigger: through }),
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/components/tappable-row', () => ({ TAPPABLE_ROW: {} }));
jest.mock('@/components/tag-choice', () => ({ TagChoice: 'TagChoice' }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/keyboard/key-commands', () => ({ useScreenKeyboardShortcuts: (handlers: KeyboardHandlers) => { mockKeys = handlers; } }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: mockLoad }),
  deviceGoToCache: () => ({ load: async () => [], save: async () => {} }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/attach-context', () => ({ useOpenSession: () => mockOpen }));
jest.mock('@/tmux/ssh-connection', () => {
  const muxify = () => ({
    read: mockRead, create: mockCreate, rankedSessionPaths: mockPaths, addSession: mockAdd,
    addWorktreeSession: mockAddWorktree, show: mockShow, visit: mockVisit,
  });
  const work = (_host: unknown, run: Function) => run({ exec: jest.fn() }, muxify());
  return { appConnections: () => ({ read: work, write: work }) };
});

const path = (name: string, directory: string) => ({ kind: 'session_path', name, label: name, directory, worktree: null, alsoIn: [], lastVisit: null });
let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ hosts: [{ id: 'host', displayName: 'Dev Host' }] });
  mockRead.mockResolvedValue({ kind: 'listed', snapshot: { tags: [{ name: 'work', color: { light: null, dark: null } }] } });
  mockCreate.mockResolvedValue({ kind: 'created', topic: 'new' });
  mockPaths.mockResolvedValue({ kind: 'listed', rows: [path('mobile', '/work/muxify mobile'), path('api', '/work/api')] });
  mockAdd.mockResolvedValue({ kind: 'added', session: 'mobile/quick-topic' });
  mockAddWorktree.mockResolvedValue({ kind: 'added', session: 'mobile-quick-topic/quick-topic' });
  mockVisit.mockResolvedValue({ kind: 'changed' });
  mockOpen.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

const text = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label);
const folder = (directory: string) => renderer.root.findAllByType(Button)
  .find((node) => node.props.modifiers?.some((modifier: { name: string; value: unknown }) => modifier.name === 'accessibilityLabel' && modifier.value === `Folder ${directory}`))!;
const field = () => renderer.root.findByType(TextField);
/** Return on the keyboard, which the field takes through its onSubmit modifier. */
const pressReturn = () => field().props.modifiers.find((modifier: { name: string }) => modifier.name === 'onSubmit').value();

async function mount(title: string) {
  await act(async () => { renderer = create(<NewTopicScreen />); });
  field().props.text.value = title;
}
async function toAddSession() {
  await mount('Quick topic');
  await act(async () => { pressReturn(); });
}

describe('the title step', () => {
  it('refuses an empty title, and sends nothing', async () => {
    await mount('   ');
    await act(async () => { pressReturn(); });

    expect(text()).toContain('Give the Topic a title.');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(toolbarSide(renderer, 'left').props.children).toBe('Cancel');
  });

  it('sends the title and the chosen Tags on Return, and becomes Add a Session with the list already there', async () => {
    await mount(' Quick topic ');
    await act(async () => { renderer.root.findByType('TagChoice' as never).props.onPress(); });
    await act(async () => { pressReturn(); });

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Function), 'Quick topic', ['work'], expect.any(String));
    expect(toolbarSide(renderer, 'left').props.children).toBe('Add later');
    expect(folder('/work/muxify mobile')).toBeDefined();
    expect(folder('/work/api')).toBeDefined();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('reads the folders when the sheet opens, before the title is sent', async () => {
    await mount('Quick topic');

    expect(mockPaths).toHaveBeenCalledWith(expect.any(Function), '');
  });

  it('stays on the title with the reason when the Host refuses, and creates on Retry', async () => {
    mockCreate.mockResolvedValueOnce({ kind: 'failed', error: 'The Config is locked.' });
    await mount('Quick topic');
    await act(async () => { toolbarButton(renderer, 'Create').props.onPress(); });

    expect(text()).toContain('The Config is locked.');
    expect(toolbarSide(renderer, 'left').props.children).toBe('Cancel');

    await act(async () => { button('Retry')!.props.onPress(); });
    expect(toolbarSide(renderer, 'left').props.children).toBe('Add later');
  });

  it('checks a create the Host did not answer, and goes on with the Topic the Host has', async () => {
    mockCreate.mockRejectedValueOnce(new ExecDeadlineError());
    await mount('Quick topic');
    await act(async () => { pressReturn(); });
    expect(text()).toContain('The Topic may exist.');

    mockRead.mockResolvedValue({ kind: 'listed', snapshot: { tags: [], pinned: [], unpinned: { limit: 3, places: [], guests: [], bench: [
      { kind: 'topic', mark: null, sessions: [], topic: { id: 'made', label: 'Quick topic', note: null, tags: [], state: 'empty' } },
    ] } } });
    await act(async () => { button('Check')!.props.onPress(); });
    await act(async () => { folder('/work/api').props.onPress(); });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][1]).toBe('made');
  });
});

describe('the Add a Session step', () => {
  it('adds a Session at the folder with the name of its Session Path, opens it in the Topic, and records the visit', async () => {
    await toAddSession();
    await act(async () => { folder('/work/muxify mobile').props.onPress(); });

    expect(mockAdd).toHaveBeenCalledWith(expect.any(Function), 'new', '/work/muxify mobile', expect.any(String), 'mobile');
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host',
      destination: { sessionName: 'mobile/quick-topic', topic: expect.objectContaining({ id: 'new' }) },
    }));
    expect(mockVisit).toHaveBeenCalledWith(expect.any(Function), '/work/muxify mobile', expect.any(String));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/terminal');
  });

  it('picks the first row on Return, and the row that ↓ moved to', async () => {
    await toAddSession();
    await act(async () => { mockKeys['list-down']!(); });
    await act(async () => { mockKeys['list-pick']!(); });

    expect(mockAdd.mock.calls[0][2]).toBe('/work/api');
  });

  it('adds the Session in a new Worktree for ⌥↩ and for the item of the long-press menu', async () => {
    await toAddSession();
    await act(async () => { mockKeys['list-worktree']!(); });

    expect(mockAddWorktree).toHaveBeenCalledWith(expect.any(Function), 'new', '/work/muxify mobile', expect.any(String));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(button('In a new Worktree')).toBeDefined();
  });

  it('uses a folder the user typed, named as the Host names a Session Path', async () => {
    mockPaths.mockResolvedValue({ kind: 'listed', rows: [] });
    await toAddSession();
    await act(async () => { field().props.onTextChange('~/Dev/new app'); });
    await act(async () => { folder('~/Dev/new app').props.onPress(); });

    expect(mockAdd).toHaveBeenCalledWith(expect.any(Function), 'new', '~/Dev/new app', expect.any(String), 'newapp');
  });

  it('keeps the Empty Topic and adds nothing on Add later, also with Escape', async () => {
    await toAddSession();
    await act(async () => { toolbarSide(renderer, 'left').props.onPress(); });
    await act(async () => { mockKeys['list-close']!(); });

    expect(mockRouter.back).toHaveBeenCalledTimes(2);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('sends the same Request on a Retry after no answer, so the Host makes one Session', async () => {
    mockAdd.mockRejectedValueOnce(new ExecDeadlineError());
    mockShow.mockResolvedValue({ kind: 'shown', topic: { label: 'Quick topic', sessions: [] } });
    await toAddSession();
    await act(async () => { folder('/work/api').props.onPress(); });
    expect(text()).toContain('The Session may exist.');
    await act(async () => { button('Check')!.props.onPress(); });
    await act(async () => { button('Retry')!.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(mockAdd.mock.calls[1].slice(1)).toEqual(mockAdd.mock.calls[0].slice(1));
  });

  it('opens the Session that a check finds, and sends no second add', async () => {
    mockAdd.mockRejectedValueOnce(new ExecDeadlineError());
    mockShow.mockResolvedValue({ kind: 'shown', topic: { label: 'Quick topic', sessions: [{ id: '$1', name: 'api/quick-topic', windows: null }] } });
    await toAddSession();
    await act(async () => { folder('/work/api').props.onPress(); });
    await act(async () => { button('Check')!.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockOpen.mock.calls[0][0].destination.sessionName).toBe('api/quick-topic');
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/terminal');
  });

  it('attaches again on Retry Attach, and sends no second add', async () => {
    mockOpen.mockRejectedValueOnce(new Error('no route'));
    await toAddSession();
    await act(async () => { folder('/work/api').props.onPress(); });
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();

    await act(async () => { button('Retry Attach')!.props.onPress(); });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/terminal');
  });
});
