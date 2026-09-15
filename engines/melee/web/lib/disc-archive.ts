import {BlobReader, ZipReader} from '@zip.js/zip.js';

const ISO_SIZE = 1459978240;
// A separate temporary file per selection avoids invalidating a running game's File.
export async function extractDiscZip(archive: File, progress: (value: number) => void) {
 const reader = new ZipReader(new BlobReader(archive), {useWebWorkers: false});
 let cleanup = async () => {};
 try {
  const entries = (await reader.getEntries()).filter(entry => !entry.directory && /\.(iso|gcm)$/i.test(entry.filename));
  if (entries.length !== 1) throw Error('Choose a ZIP containing exactly one Melee ISO or GCM.');
  const entry = entries[0];
  if (entry.directory) throw Error('The ZIP does not contain a disc.');
  if (entry.encrypted) throw Error('Password-protected ZIPs are not supported. Extract the ISO first.');
  if (entry.uncompressedSize !== ISO_SIZE) throw Error('The ZIP must contain a full, unmodified Melee USA 1.02 disc (1,459,978,240 bytes).');
  if (!navigator.storage?.getDirectory) throw Error('This browser cannot extract ZIPs to temporary storage. Unzip the file and choose the ISO instead.');
  const root = await navigator.storage.getDirectory();
  // Reclaim files left by a closed/crashed tab; live tabs hold a matching lock.
  if (navigator.locks) {
   for await (const key of (root as FileSystemDirectoryHandle & {keys(): AsyncIterableIterator<string>}).keys()) {
    if (/^melee-disc-.*\.iso$/.test(key)) await navigator.locks.request(key, {ifAvailable: true}, async lock => {
     if (lock) await root.removeEntry(key).catch(() => {});
    });
   }
  }
  const name = `melee-disc-${crypto.randomUUID()}.iso`;
  let release = () => {};
  if (navigator.locks) {
   await new Promise<void>((resolve, reject) => {
    void navigator.locks.request(name, () => new Promise<void>(done => {release = done;resolve();})).catch(reject);
   });
  }
  cleanup = async () => {await root.removeEntry(name).catch(() => {});release();};
  const handle = await root.getFileHandle(name, {create: true});
  const output = await handle.createWritable();
  let written = 0;
  try {
   await entry.getData(new WritableStream({
    async write(chunk: Uint8Array) {
     written += chunk.byteLength;
     if (written > ISO_SIZE) throw Error('The ZIP contains an oversized disc.');
     await output.write(chunk as Uint8Array<ArrayBuffer>);
     progress(written / ISO_SIZE);
    },
   }), {checkSignature: true});
   if (written !== ISO_SIZE) throw Error('The ZIP contains an incomplete disc.');
   await output.close();
  } catch (error) { await output.abort().catch(() => {}); throw error; }
  return {file: await handle.getFile(), cleanup};
 } catch (error) {
  await cleanup();
  if (error instanceof DOMException && error.name === 'QuotaExceededError') throw Error('Not enough browser storage to extract this ZIP. Free space or unzip it and choose the ISO.');
  throw error;
 } finally { await reader.close(); }
}
