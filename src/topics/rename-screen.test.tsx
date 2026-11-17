import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, TextField } from '@expo/ui/swift-ui';

import RenameScreen, { type RenameParams } from '@/app/rename';
import { fakeHostServer, lost, refused, snapshotPush } from '@/test-support/fake-host-server';
import { toolbarButton } from '@/test-support/toolbar';

let mockServer = fakeHostServer();
let mockParams: RenameParams = { hostId: 'host', kind: 'session', id: '$1', name: 'api' };
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  ...require('@/test-support/toolbar').mockStack, useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: 'Button', Form: 'Form', Host: 'Host', HStack: 'HStack', ProgressView: 'ProgressView',
    Section: 'Section', Text: 'Text', TextField: 'TextField',
    useNativeState: (value: string) => React.useRef({ value }).current,
  };
});
jest.mock('@expo/ui/swift-ui/modifiers', () => new Proxy({}, { get: (_, name) => (value: unknown) => ({ name, value }) }));
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));
jest.mock('@/settings/settings-context', () => ({ useSettings: () => ({ appearance: 'dark', palette: require('@/constants/app-theme').AppPalettes.dark }) }));
jest.mock('@/tmux/ssh-connection', () => ({ appConnections: () => ({ onServer: mockServer.onServer }) }));

let renderer: ReactTestRenderer;
const save = () => toolbarButton(renderer, 'Save');
const texts = () => renderer.root.findAllByType('Text' as never).map((node) => node.props.children).join('\n');
const button = (label: string) => renderer.root.findAllByType(Button).find((node) => node.props.label === label)!;
const field = () => renderer.root.findByType(TextField);

beforeEach(() => {
  jest.clearAllMocks();
  mockServer = fakeHostServer();
  mockParams = { hostId: 'host', kind: 'session', id: '$1', name: 'api' };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => renderer?.unmount()); });

async function mount() {
  await act(async () => { renderer = create(<RenameScreen />); });
}

it('renames a Session as one Host Write on the Session, with its Request id, and reads nothing after it', async () => {
  await mount();
  expect(field().props.text.value).toBe('api');
  field().props.text.value = ' web ';
  await act(async () => { save().props.onPress(); });
  expect(mockServer.writes()).toEqual([
    { version: 2, command: { rename_session: { name: 'web' } }, target: { session: '$1' }, request: expect.any(String) },
  ]);
  expect(mockServer.requests).toHaveLength(1);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('renames a Window on the Window', async () => {
  mockParams = { hostId: 'host', kind: 'window', id: '@4', name: 'shell' };
  await mount();
  field().props.text.value = 'logs';
  await act(async () => { save().props.onPress(); });
  expect(mockServer.writes()).toEqual([
    { version: 2, command: { rename_window: { name: 'logs' } }, target: { window: '@4' }, request: expect.any(String) },
  ]);
});

it("sends nothing for an empty name or the same one, and shows the Host's refusal with Retry", async () => {
  await mount();
  field().props.text.value = '  ';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain('Give the Session a name.');
  field().props.text.value = 'api';
  await act(async () => { save().props.onPress(); });
  expect(mockServer.writes()).toEqual([]);
  expect(mockBack).toHaveBeenCalledTimes(1);

  mockBack.mockClear();
  mockServer.answer = () => { throw refused('A Session name cannot have a dot.', 'session_name_invalid'); };
  field().props.text.value = 'a.b';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain('A Session name cannot have a dot.');
  expect(button('Retry')).toBeDefined();
  expect(mockBack).not.toHaveBeenCalled();
});

it('checks a rename the Host did not answer in the pushed Listing, and closes when the Session has its new name', async () => {
  mockServer.answer = () => { throw lost(); };
  await mount();
  field().props.text.value = 'web';
  await act(async () => { save().props.onPress(); });
  expect(texts()).toContain('The Session may have its new name.');
  expect(save().props.disabled).toBe(true);
  const [first, again] = mockServer.writes();
  expect(again!.request).toBe(first!.request);

  mockServer.pushes.snapshot = snapshotPush({ sessions: [{ id: '$1', name: 'api' }] });
  await act(async () => { button('Check').props.onPress(); });
  expect(texts()).toContain('Dev Host has the old name. Save sends the new one.');
  expect(mockBack).not.toHaveBeenCalled();

  mockServer.answer = () => { throw lost(); };
  await act(async () => { save().props.onPress(); });
  mockServer.pushes.snapshot = snapshotPush({ sessions: [{ id: '$1', name: 'web+2' }] });
  await act(async () => { button('Check').props.onPress(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
});
