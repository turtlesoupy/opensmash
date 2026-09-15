import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BlobWriter, TextReader, ZipWriter} from '../web/node_modules/@zip.js/zip.js/index.js';
import {extractDiscZip} from '../web/lib/disc-archive.ts';

async function archive(names) {
 const writer = new ZipWriter(new BlobWriter(), {useWebWorkers:false});
 for (const name of names) await writer.add(name, new TextReader('not a disc'));
 return new File([await writer.close()], 'game.zip');
}
test('ZIP requires exactly one disc, including nested and uppercase names', async () => {
 for (const names of [[], ['readme.txt'], ['a.iso', 'b.GCM']]) {
  await assert.rejects(extractDiscZip(await archive(names), () => {}), /exactly one/);
 }
 await assert.rejects(extractDiscZip(await archive(['folder/GAME.ISO']), () => {}), /full, unmodified/);
});
test('corrupt archives fail before allocating storage', async () => {
 await assert.rejects(extractDiscZip(new File(['invalid'], 'game.zip'), () => {}));
});
