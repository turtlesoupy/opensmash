import { loadStoredRom } from '../shared/rom-store.js';
import { restoreCachedDisc } from '../../engines/melee/web/lib/disc-cache';

export async function loadSharedRom(game = 'ssb64') {
  if (game === 'melee') {
    const file = await restoreCachedDisc();
    if (!file) throw new Error('No Melee disc is saved in this browser. Add it under ROM Management first.');
    return { file, name: file.name, game };
  }
  if (game !== 'ssb64') throw new Error('The other device requested an unsupported game.');
  return loadStoredRom();
}
