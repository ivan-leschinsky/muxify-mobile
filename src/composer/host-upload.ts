import { bytesToBase64 } from '@/lib/base64';
import { HostServerError, type HostServer, type HostServerCall } from '@/ssh/host-server';

import { abortable, checkAborted, type Upload } from './types';
import { attachmentName, checkedHostPath } from './upload';

/** The most raw bytes of one `upload` chunk: MuxifyCore's `HostProtocol.maxChunkBytes`. */
export const CHUNK_BYTES = 64 * 1024;
/** The most chunks that wait for their `end` at one time. */
export const IN_FLIGHT = 8;

/**
 * Uploads an Attachment through the Host Server of the Connection, as a
 * pipelined run of `upload { name, offset, data, last }` chunks: base64 of at
 * most 64 KiB of the file each, with at most 8 waiting for their `end`. The
 * answer to the last chunk names the file's path on the Host.
 *
 * A failed chunk fails the upload with the Host's message; the chunks still
 * waiting are cancelled, and the Host deletes the partial file.
 */
export function uploadOnHostServer(server: HostServer): Upload {
  return async (file, signal, progress) => {
    checkAborted(signal);
    const name = attachmentName(file.name);
    const reader = file.open();
    const waiting: { call: HostServerCall<unknown>; size: number }[] = [];
    const cancelWaiting = () => {
      for (const chunk of waiting.splice(0)) chunk.call.cancel();
    };
    signal.addEventListener('abort', cancelWaiting);
    try {
      let offset = 0;
      let sent = 0;
      let path: unknown;
      let last = false;
      progress({ sent, total: file.size });
      while (!last) {
        checkAborted(signal);
        const count = Math.min(CHUNK_BYTES, file.size - offset);
        const bytes = count > 0 ? reader.readBytes(count) : new Uint8Array(0);
        if (bytes.length !== count) throw new Error('The local attachment could not be read.');
        last = offset + count >= file.size;
        const call = server.request({ upload: { name, offset, data: bytesToBase64(bytes), last } });
        // Each call is awaited in turn; one that fails while an earlier one waits is not unhandled.
        call.catch(() => {});
        waiting.push({ call, size: count });
        offset += count;
        while (waiting.length >= IN_FLIGHT || (last && waiting.length > 0)) {
          const answer = await abortable(waiting[0]!.call, signal);
          sent += waiting.shift()!.size;
          path = (answer as { path?: unknown } | null)?.path;
          progress({ sent, total: file.size });
        }
      }
      checkAborted(signal);
      return checkedHostPath(path);
    } catch (error) {
      cancelWaiting();
      if (error instanceof HostServerError) throw new Error(`Upload failed on the Host: ${error.message}. Draft kept.`);
      throw error;
    } finally {
      signal.removeEventListener('abort', cancelWaiting);
      reader.close();
    }
  };
}

/**
 * A Connection's upload: through its Host Server, or with the upload script
 * on its own channel (`script`) only when the link's verdict is Sessions
 * only, or the Connection runs no Host Server. A Host Server that comes to
 * Sessions only while the upload waits for it hands the upload to the script.
 */
export function attachmentUpload(server: () => HostServer | null, script: Upload | undefined): Upload {
  return async (file, signal, progress) => {
    const onScript = () => {
      if (!script) throw new Error('This Connection cannot upload attachments.');
      return script(file, signal, progress);
    };
    const live = server();
    if (!live || live.state().kind === 'sessions-only') return onScript();
    try {
      return await uploadOnHostServer(live)(file, signal, progress);
    } catch (error) {
      if (!signal.aborted && live.state().kind === 'sessions-only') return onScript();
      throw error;
    }
  };
}
