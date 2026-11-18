import { base64ToBytes } from '@/lib/base64';
import type { HostServerState } from '@/ssh/host-server';
import { fakeHostServer, lost, refused } from '@/test-support/fake-host-server';
import type { MessageId } from '@/tmux/input-lane';

import { createComposer } from './composer';
import { attachmentUpload, CHUNK_BYTES, IN_FLIGHT } from './host-upload';
import type { AttachmentFile, Upload } from './types';

/**
 * An Attachment through a fake Host Server: the `upload` chunks the Composer
 * sends, and the Host path it pastes. The upload script is used only in
 * Sessions only.
 */

interface Chunk { name: string; offset: number; data: string; last: boolean }

const HOST_PATH = '/tmp/muxify-paste.AbCdEfGh/shot one.png';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function source(data: Uint8Array, name = 'shot one.png'): AttachmentFile {
  return {
    id: 'attachment-1', uri: `file:///${name}`, name, size: data.length, image: true, dispose: () => {},
    open: () => {
      let at = 0;
      return {
        readBytes: (length: number) => {
          const part = data.subarray(at, at + length);
          at += part.length;
          return part;
        },
        close: () => {},
      };
    },
  };
}

function bytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 7) % 256);
}

/**
 * A fake Host Server that takes `upload` chunks as MuxifyCore does: each
 * answers with the file's path, a tick later, so the phone can pipeline.
 */
function hostServer() {
  const fake = fakeHostServer();
  const chunks: Chunk[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  fake.on.upload = (value) => {
    const chunk = value as Chunk;
    chunks.push(chunk);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    return tick().then(() => {
      inFlight -= 1;
      return { path: HOST_PATH };
    });
  };
  let state: HostServerState = { kind: 'live', build: 'muxify test', protocol: 1 };
  fake.server.state = () => state;
  return {
    fake,
    chunks,
    mostInFlight: () => mostInFlight,
    setState: (next: HostServerState) => { state = next; },
    received: () => {
      const all = chunks.map((chunk) => base64ToBytes(chunk.data));
      const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of all) { out.set(part, at); at += part.length; }
      return out;
    },
  };
}

/** The Composer of one Pane whose Connection uploads as `attachmentUpload` does. */
async function composerSending(upload: Upload, file: AttachmentFile) {
  const deliver = jest.fn((_text: string, _id: MessageId) => {});
  const composer = createComposer(() => ({ upload, deliver }));
  composer.edit('%1', 'look at this');
  composer.add('%1', file.name, async () => file);
  await tick();
  await composer.send('%1');
  return { composer, deliver };
}

it('sends an Attachment as `upload` chunks of at most 64 KiB, at most 8 in flight, and pastes its Host path', async () => {
  const host = hostServer();
  const script = jest.fn<Promise<string>, Parameters<Upload>>();
  const data = bytes(20 * CHUNK_BYTES + 123);

  const { deliver } = await composerSending(attachmentUpload(() => host.fake.server, script), source(data));

  expect(host.chunks).toHaveLength(21);
  expect(host.chunks.every((chunk) => chunk.name === 'shot one.png')).toBe(true);
  expect(host.chunks.map((chunk) => chunk.offset)).toEqual(host.chunks.map((_, index) => index * CHUNK_BYTES));
  expect(host.chunks.map((chunk) => base64ToBytes(chunk.data).length).every((size) => size <= CHUNK_BYTES)).toBe(true);
  expect(host.chunks.map((chunk) => chunk.last)).toEqual([...Array(20).fill(false), true]);
  expect(host.received()).toEqual(data);
  expect(host.mostInFlight()).toBe(IN_FLIGHT);
  expect(script).not.toHaveBeenCalled();
  expect(deliver.mock.calls[0]![0]).toBe("look at this\n'/tmp/muxify-paste.AbCdEfGh/shot one.png'");
});

it('reports progress as the Host answers each chunk', async () => {
  const host = hostServer();
  const progress: number[] = [];
  const data = bytes(3 * CHUNK_BYTES);

  const path = await attachmentUpload(() => host.fake.server, undefined)(source(data), new AbortController().signal,
    ({ sent }) => progress.push(sent));

  expect(path).toBe(HOST_PATH);
  expect(progress).toEqual([0, CHUNK_BYTES, 2 * CHUNK_BYTES, 3 * CHUNK_BYTES]);
});

it('sends an empty file as one last chunk', async () => {
  const host = hostServer();

  const path = await attachmentUpload(() => host.fake.server, undefined)(source(new Uint8Array(0)), new AbortController().signal, () => {});

  expect(path).toBe(HOST_PATH);
  expect(host.chunks).toEqual([{ name: 'shot one.png', offset: 0, data: '', last: true }]);
});

it('names the file on the Host with one path component', async () => {
  const host = hostServer();

  await attachmentUpload(() => host.fake.server, undefined)(source(bytes(3), '../a/b.png'), new AbortController().signal, () => {});

  expect(host.chunks[0]!.name).toBe('.._a_b.png');
});

it('shows the upload failure with the Host\'s message when a chunk fails, and pastes nothing', async () => {
  const host = hostServer();
  const answer = host.fake.on.upload!;
  host.fake.on.upload = (value) => (value as Chunk).offset === 2 * CHUNK_BYTES
    ? Promise.reject(refused('a chunk of shot one.png could not be written: No space left on device', 'failed'))
    : answer(value);

  const { composer, deliver } = await composerSending(attachmentUpload(() => host.fake.server, undefined), source(bytes(5 * CHUNK_BYTES)));

  expect(deliver).not.toHaveBeenCalled();
  expect(composer.draft('%1')).toMatchObject({
    text: 'look at this',
    phase: { kind: 'idle' },
    message: 'Upload failed on the Host: a chunk of shot one.png could not be written: No space left on device. Draft kept.',
  });
  expect(composer.draft('%1').attachments).toHaveLength(1);
});

it('refuses a path that is not absolute', async () => {
  const host = hostServer();
  host.fake.on.upload = () => ({ path: 'relative.png' });

  await expect(attachmentUpload(() => host.fake.server, undefined)(source(bytes(3)), new AbortController().signal, () => {}))
    .rejects.toThrow('The Host returned an invalid attachment path.');
});

it('stops sending chunks when the Send is cancelled', async () => {
  const host = hostServer();
  host.fake.on.upload = (value) => { host.chunks.push(value as Chunk); return new Promise(() => {}); };
  const controller = new AbortController();

  const upload = attachmentUpload(() => host.fake.server, undefined)(source(bytes(20 * CHUNK_BYTES)), controller.signal, () => {});
  await tick();
  controller.abort();

  await expect(upload).rejects.toThrow('Send cancelled. Draft kept.');
  expect(host.chunks).toHaveLength(IN_FLIGHT);
});

describe('in Sessions only', () => {
  it('uploads with the upload script, and asks the Host Server nothing', async () => {
    const host = hostServer();
    host.setState({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
    const script = jest.fn<Promise<string>, Parameters<Upload>>(async () => '/home/me/.cache/muxify/attachments/attachment-1/shot one.png');

    const { deliver } = await composerSending(attachmentUpload(() => host.fake.server, script), source(bytes(10)));

    expect(script).toHaveBeenCalledTimes(1);
    expect(host.fake.requests).toEqual([]);
    expect(deliver.mock.calls[0]![0]).toBe("look at this\n'/home/me/.cache/muxify/attachments/attachment-1/shot one.png'");
  });

  it('uploads with the upload script when the Host Server comes to Sessions only while the upload waits', async () => {
    const host = hostServer();
    host.fake.on.upload = () => {
      host.setState({ kind: 'sessions-only', reason: 'the Host Server did not answer' });
      return Promise.reject(lost());
    };
    const script = jest.fn<Promise<string>, Parameters<Upload>>(async () => '/home/me/shot.png');

    const path = await attachmentUpload(() => host.fake.server, script)(source(bytes(10)), new AbortController().signal, () => {});

    expect(path).toBe('/home/me/shot.png');
    expect(script).toHaveBeenCalledTimes(1);
  });

  it('uploads with the upload script on a Connection that runs no Host Server', async () => {
    const script = jest.fn<Promise<string>, Parameters<Upload>>(async () => '/home/me/shot.png');

    expect(await attachmentUpload(() => null, script)(source(bytes(10)), new AbortController().signal, () => {})).toBe('/home/me/shot.png');
  });

  it('fails a Host Server upload that the channel loses while the server is still live', async () => {
    const host = hostServer();
    host.fake.on.upload = () => Promise.reject(lost());
    const script = jest.fn<Promise<string>, Parameters<Upload>>();

    await expect(attachmentUpload(() => host.fake.server, script)(source(bytes(10)), new AbortController().signal, () => {}))
      .rejects.toThrow('Upload failed on the Host: the connection to the Host Server ended. Draft kept.');
    expect(script).not.toHaveBeenCalled();
  });
});
