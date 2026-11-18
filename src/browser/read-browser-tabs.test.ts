import { fakeHostServer, refused } from '@/test-support/fake-host-server';

import { readBrowserTabs, readTabRestore } from './read-browser-tabs';

/**
 * A Window's Browser Tabs through a fake Host Server: the request the Title
 * Sheet and a Topic Place's restore send, and the Tabs they get back.
 */

let mockServer = fakeHostServer();
let mockSessionsOnly = false;
jest.mock('@/diagnostics/device-log', () => ({ deviceLog: () => ({ record: () => {} }) }));
jest.mock('@/storage/device-store', () => ({
  deviceHostStore: () => ({ load: async () => ({ hosts: [{ id: 'host', displayName: 'Dev Host' }] }) }),
}));
jest.mock('@/tmux/ssh-connection', () => ({
  appConnections: () => ({
    onServer: (host: unknown, work: never) => mockSessionsOnly
      ? Promise.reject(new Error('Topics are unavailable on Dev Host: the Host Server did not answer.'))
      : mockServer.onServer(host, work),
  }),
}));

/** The Tabs as desktop Muxify stored them: a title only once the page had one. */
const STORED = [
  { active: false, id: '00000000-0000-0000-0000-000000000000', title: '', url: 'http://localhost:3000/' },
  { active: true, id: '00000000-0000-0000-0000-000000000001', title: '', url: 'http://100.101.102.103:8080/' },
  { active: false, id: '00000000-0000-0000-0000-000000000002', title: '', url: 'http://mac.tail1234.ts.net:3000/' },
  { active: false, id: '00000000-0000-0000-0000-000000000003', title: '', url: 'https://github.com/' },
  { active: false, id: '00000000-0000-0000-0000-000000000004', title: '', url: 'http://192.168.1.10:8080/' },
];

beforeEach(() => {
  mockServer = fakeHostServer();
  mockServer.on.browser_tabs = () => STORED;
  mockSessionsOnly = false;
});

describe('the Title Sheet', () => {
  it('asks `browser_tabs` for the Window by its tmux id, and lists only the Tabs the phone can reach', async () => {
    const read = await readBrowserTabs('host', '@12');

    expect(mockServer.requests).toEqual([{ browser_tabs: { window: '@12' } }]);
    expect(read).toEqual({ kind: 'listed', tabs: [STORED[1], STORED[2], STORED[3]] });
  });

  it('lists no Tabs for a Window whose Browser has none', async () => {
    mockServer.on.browser_tabs = () => [];

    expect(await readBrowserTabs('host', '@12')).toEqual({ kind: 'listed', tabs: [] });
  });

  it('fails with what the Host Server said, as for a Window that no longer exists', async () => {
    mockServer.on.browser_tabs = () => { throw refused("no tmux Window or Pane '@12'", 'failed'); };

    expect(await readBrowserTabs('host', '@12')).toEqual({ kind: 'failed', error: "no tmux Window or Pane '@12'" });
  });

  it('fails in Sessions only, and asks nothing', async () => {
    mockSessionsOnly = true;

    const read = await readBrowserTabs('host', '@12');

    expect(read).toEqual({ kind: 'failed', error: 'Topics are unavailable on Dev Host: the Host Server did not answer.' });
    expect(mockServer.requests).toEqual([]);
  });

  it('fails for a Host that is no longer saved', async () => {
    expect(await readBrowserTabs('gone', '@12')).toEqual({ kind: 'failed', error: 'This Host is no longer saved.' });
    expect(mockServer.requests).toEqual([]);
  });
});

describe("a Topic Place's restore", () => {
  it('shows the Tab when the Host Server still lists it, from the Window the Topic opened on', async () => {
    expect(await readTabRestore('host', '@3', 'https://github.com/')).toEqual({ kind: 'show', unread: null });
    expect(mockServer.requests).toEqual([{ browser_tabs: { window: '@3' } }]);
  });

  it('leaves the Pane on top when the Host Server lists the Tab no more', async () => {
    mockServer.on.browser_tabs = () => [STORED[3]];

    expect(await readTabRestore('host', '@3', 'http://mac.tail1234.ts.net:3000/')).toEqual({ kind: 'gone' });
  });

  it('leaves the Pane on top for a Tab the phone cannot reach, which the filter leaves out', async () => {
    expect(await readTabRestore('host', '@3', 'http://localhost:3000/')).toEqual({ kind: 'gone' });
  });

  it('shows the Tab anyway, with the reason, when the read fails', async () => {
    mockSessionsOnly = true;

    expect(await readTabRestore('host', '@3', 'https://github.com/')).toEqual({
      kind: 'show', unread: 'Topics are unavailable on Dev Host: the Host Server did not answer.',
    });
  });

  it('asks nothing with no active Window', async () => {
    expect(await readTabRestore('host', undefined, 'https://github.com/')).toEqual({ kind: 'show', unread: 'no active Window' });
    expect(mockServer.requests).toEqual([]);
  });
});
