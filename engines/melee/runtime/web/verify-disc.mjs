import manifest from './disc-chunks.mjs';
import {ISO_SIZE, ISO_SHA256} from './disc.mjs';

// WebCrypto uses the browser's native SHA-256 (including ARM acceleration).
// Checking independently pinned chunk digests authenticates the entire image
// without copying a 1.46 GB buffer into WebCrypto or the game's Wasm heap.
// Keep reads sequential: at most one 64 MB input and its native digest copy.
export async function verifyDiscChunks(file, trusted, onProgress = () => {}) {
  const {size, chunkBytes, chunks} = trusted;
  if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 ||
      !Array.isArray(chunks) || chunks.length !== Math.ceil(size / chunkBytes) ||
      chunks.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Invalid disc verification data.');
  if (file.size !== size) throw Error('Choose the full USA 1.02 Melee ISO. This image has an unexpected size.');
  onProgress(0);
  for (let index = 0, offset = 0; offset < size; index++, offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes, size);
    const bytes = await file.slice(offset, end).arrayBuffer();
    if (bytes.byteLength !== end - offset) throw Error('The selected disc could not be read completely.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    // Release each 64 MiB input immediately instead of waiting for a browser
    // collection after loading the renderer and its GPU resources.
    if (typeof bytes.transfer === 'function') bytes.transfer(0);
    if (hash !== chunks[index]) throw Error('This image does not match the known USA 1.02 Melee disc hash.');
    onProgress(end);
  }
}

export function verifyDisc(file, onProgress) {
  if (manifest.size !== ISO_SIZE || manifest.isoSha256 !== ISO_SHA256) throw Error('Invalid disc verification data.');
  return verifyDiscChunks(file, manifest, onProgress);
}
