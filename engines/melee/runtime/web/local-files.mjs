/* Sized, read-only local files. Avoid a HEAD per file and byte-wise FS copies. */
export const COSTUME_SLOT_SIZE = 2 * 1024 * 1024;
export const COSTUME_SLOTS = ["PlMrNr.dat", "PlMrYe.dat", "PlMrBk.dat", "PlMrBu.dat", "PlMrGr.dat", "PlFxNr.dat", "PlFxOr.dat", "PlFxLa.dat", "PlFxGr.dat", "PlCaNr.dat", "PlCaGy.dat", "PlCaRe.dat", "PlCaWh.dat", "PlCaGr.dat", "PlCaBu.dat", "PlDkNr.dat", "PlDkBk.dat", "PlDkRe.dat", "PlDkBu.dat", "PlDkGr.dat", "PlKbNr.dat", "PlKbYe.dat", "PlKbBu.dat", "PlKbRe.dat", "PlKbGr.dat", "PlKbWh.dat", "PlKpNr.dat", "PlKpRe.dat", "PlKpBu.dat", "PlKpBk.dat", "PlLkNr.dat", "PlLkRe.dat", "PlLkBu.dat", "PlLkBk.dat", "PlLkWh.dat", "PlSkNr.dat", "PlSkRe.dat", "PlSkBu.dat", "PlSkGr.dat", "PlSkWh.dat", "PlNsNr.dat", "PlNsYe.dat", "PlNsBu.dat", "PlNsGr.dat", "PlPeNr.dat", "PlPeYe.dat", "PlPeWh.dat", "PlPeBu.dat", "PlPeGr.dat", "PlPpNr.dat", "PlPpGr.dat", "PlPpOr.dat", "PlPpRe.dat", "PlNnNr.dat", "PlNnYe.dat", "PlNnAq.dat", "PlNnWh.dat", "PlPkNr.dat", "PlPkRe.dat", "PlPkBu.dat", "PlPkGr.dat", "PlSsNr.dat", "PlSsPi.dat", "PlSsBk.dat", "PlSsGr.dat", "PlSsLa.dat", "PlYsNr.dat", "PlYsRe.dat", "PlYsBu.dat", "PlYsYe.dat", "PlYsPi.dat", "PlYsAq.dat", "PlPrNr.dat", "PlPrRe.dat", "PlPrBu.dat", "PlPrGr.dat", "PlPrYe.dat", "PlMtNr.dat", "PlMtRe.dat", "PlMtBu.dat", "PlMtGr.dat", "PlLgNr.dat", "PlLgWh.dat", "PlLgAq.dat", "PlLgPi.dat", "PlMsNr.dat", "PlMsRe.dat", "PlMsGr.dat", "PlMsBk.dat", "PlMsWh.dat", "PlZdNr.dat", "PlZdRe.dat", "PlZdBu.dat", "PlZdGr.dat", "PlZdWh.dat", "PlClNr.dat", "PlClRe.dat", "PlClBu.dat", "PlClWh.dat", "PlClBk.dat", "PlDrNr.dat", "PlDrRe.dat", "PlDrBu.dat", "PlDrGr.dat", "PlDrBk.dat", "PlFcNr.dat", "PlFcRe.dat", "PlFcBu.dat", "PlFcGr.dat", "PlPcNr.dat", "PlPcRe.dat", "PlPcBu.dat", "PlPcGr.dat", "PlGwNr.dat", "PlGnNr.dat", "PlGnRe.dat", "PlGnBu.dat", "PlGnGr.dat", "PlGnLa.dat", "PlFeNr.dat", "PlFeRe.dat", "PlFeBu.dat", "PlFeGr.dat", "PlFeYe.dat"];
export function costumeSlot(bytes) {
  if (bytes.length < 32 || bytes.length > COSTUME_SLOT_SIZE ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) !== bytes.length)
    throw Error('Invalid or oversized costume archive');
  // DAT pointers are relative to their existing sections; trailing symbol-table
  // padding changes none of them. Keep archive and FST file lengths identical.
  const slot = new Uint8Array(COSTUME_SLOT_SIZE);
  slot.set(bytes);new DataView(slot.buffer).setUint32(0,slot.length);
  return slot;
}
export function mountSizedFile(FS, parent, name, url, size, readRange = xhrRange) {
  if (!Number.isSafeInteger(size) || size < 0) throw Error('Invalid file length');
  const chunkSize = 1024 * 1024, chunks = new Map();
  function chunk(index) {
    if (!chunks.has(index)) {
      const start = index * chunkSize, end = Math.min(size, start + chunkSize);
      const bytes = readRange(url, start, end - 1, size);
      if (bytes.length !== end - start) throw Error(`Incomplete local asset: ${name}`);
      chunks.set(index, bytes);
    }
    return chunks.get(index);
  }
  // Retain Emscripten's stream/seek/mmap plumbing. Its lazy contents are replaced
  // before anyone requests their length, so no metadata XHR is performed.
  const node = FS.createLazyFile(parent, name, url, true, false);
  node.contents = {length:size, get(index) {
    if (index < 0 || index >= size) return undefined;
    return chunk(Math.floor(index / chunkSize))[index % chunkSize];
  }};
  node.stream_ops = {...node.stream_ops, read(stream, buffer, offset, length, position) {
    const count = Math.max(0, Math.min(length, size - position));
    for (let copied = 0; copied < count;) {
      const at = position + copied, bytes = chunk(Math.floor(at / chunkSize));
      const from = at % chunkSize, n = Math.min(bytes.length - from, count - copied);
      buffer.set(bytes.subarray(from, from + n), offset + copied);
      copied += n;
    }
    return count;
  }};
  return node;
}

function xhrRange(url, start, end, size) {
  const request = new XMLHttpRequest();
  request.open('GET', url, false);
  request.responseType = 'arraybuffer';
  if (start !== 0 || end !== size - 1) request.setRequestHeader('Range', `bytes=${start}-${end}`);
  request.send(null);
  if (request.status !== 200 && request.status !== 206) throw Error(`Could not read local asset (${request.status})`);
  return new Uint8Array(request.response);
}

export function mountSystemBundle(FS, buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) throw Error('Truncated system bundle');
  const headerLength = new DataView(buffer).getUint32(0), start = 4 + headerLength;
  if (start > bytes.length) throw Error('Truncated system manifest');
  const entries = JSON.parse(new TextDecoder().decode(bytes.subarray(4, start)));
  for (const {name, offset, length} of entries) {
    if (!name || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') ||
        !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || start + offset + length > bytes.length)
      throw Error('Invalid system bundle entry');
    const path = '/sys/' + name;
    FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    FS.writeFile(path, bytes.subarray(start + offset, start + offset + length));
  }
}
