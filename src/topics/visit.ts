import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { describeError } from '@/lib/describe-error';
import type { Host } from '@/storage/records';
import { appConnections } from '@/tmux/ssh-connection';

import { newRequestId } from './request';

const say = speakingAs(deviceLog(), 'visit');

/**
 * Tells the Host that the user opened a Session at this folder. Nothing waits
 * for it and a failure changes nothing on screen: the visit only ranks the
 * folder in the next Go to list, on the Mac and on the phone.
 */
export function recordVisit(host: Host, folder: string): void {
  const request = newRequestId();
  void appConnections()
    .write(host, (transport, muxify) => muxify.visit((command) => transport.exec(command), folder, request))
    .then(
      (result) => { if (result.kind !== 'changed') say(`${host.displayName} did not record the visit of ${folder}: ${result.kind === 'failed' ? result.error : result.message}`); },
      (error: unknown) => say(`${host.displayName} did not record the visit of ${folder}: ${describeError(error)}`),
    );
}
