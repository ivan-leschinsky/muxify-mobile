import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeError } from '@/lib/describe-error';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import { onHost } from './host-writes';
import type { ServerConnections } from './host-write-request';

const say = speakingAs(deviceLog(), 'visit');

/**
 * Tells the Host that the user opened a Session at this folder:
 * `visit_session_path { folder }` on its Host Server. Nothing waits for it
 * and a failure changes nothing on screen: the visit only ranks the folder in
 * the next Go to list, on the Mac and on the phone. A folder that starts with
 * `~` is the Host's home, as the Host Server takes only absolute folders.
 */
export function recordVisit(host: Host, folder: string, connections: ServerConnections = appConnections()): void {
  void onHost(host, folder)
    .then((absolute) => connections.onServer(host, (server) => server.request({ visit_session_path: { folder: absolute } })))
    .catch((error: unknown) => say(`${host.displayName} did not record the visit of ${folder}: ${describeError(error)}`));
}
