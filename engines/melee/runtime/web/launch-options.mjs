// Shared numeric protocol for the browser worker and GALE01 launch mod.
export function planLaunch(schema, settings, selected, roster, random = Math.random) {
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!schema.modes.some(m => m.id === settings.mode) ||
      !schema.stages.some(s => s.id === settings.stage) ||
      !integer(settings.level, 1, 9) || !integer(settings.stocks, 1, 99) || !integer(settings.minutes, 0, 99) ||
      !Array.isArray(settings.ports) || settings.ports.length !== 4) throw Error('Invalid launch settings.');
  const kinds = Object.fromEntries(schema.targets.map(t => [t.slug,t.fighter]));
  const devices = new Set(), used = new Map(), costumes = [], taken = new Set([selected.slug]);
  const pick = list => list[Math.min(list.length-1, Math.floor(random()*list.length))];
  // A random custom opponent never repeats the player's fighter or another random pick.
  // Game & Watch shares one DAT: random lineups must avoid incompatible occupants.
  const gameWatchOccupants = new Set(settings.ports.filter(p => p.device !== 'off').flatMap(p => {
    const character = p.character === 'selected' ? selected.slug : p.character;
    const row = roster.find(f => f.slug === character);
    const target = p.target && p.target !== 'auto' ? p.target : row?.target;
    return !character.startsWith('random') && (character === 'vanilla:3' || kinds[target] === 3) ? [character] : [];
  }));
  const randomCustom = (override) => {
    const compatible = roster.filter(f => kinds[f.target] !== undefined &&
      (kinds[override && override !== 'auto' ? override : f.target] !== 3 || !gameWatchOccupants.size ||
       (gameWatchOccupants.size === 1 && gameWatchOccupants.has(f.slug))));
    const pool = compatible.filter(f => !taken.has(f.slug));
    const row = pool.length ? pick(pool) : compatible[0];
    if (!row) return 'vanilla:' + pick(schema.fighters.filter(f => f.id !== 3 || !gameWatchOccupants.size)).id;
    taken.add(row.slug);return row.slug;
  };
  const ports = settings.ports.map(p => {
    if (!['keyboard','gamepad0','gamepad1','gamepad2','gamepad3','cpu','off'].includes(p.device)) throw Error('Invalid input device.');
    if (!['cpu','off'].includes(p.device)) {
      if (devices.has(p.device)) throw Error('Assign each keyboard or gamepad to only one player.');
      devices.add(p.device);
    }
    const character = p.character === 'selected' ? selected.slug
      : p.device === 'off' ? (p.character.startsWith('random') ? 'vanilla:2' : p.character)
      : p.character === 'random:vanilla' ? 'vanilla:' + pick(schema.fighters.filter(f => f.id !== 3 || !gameWatchOccupants.size)).id
      : p.character === 'random' ? randomCustom(p.target) : p.character;
    const row = roster.find(f => f.slug === character);
    const target = p.target && p.target !== 'auto' ? p.target : row?.target;
    const fighter = character.startsWith('vanilla:') ? Number(character.slice(8)) : kinds[target];
    if (fighter === 3 && p.device !== 'off') gameWatchOccupants.add(character);
    if (!integer(fighter, 0, 25)) throw Error('Choose a valid fighter for every player.');
    return {device:p.device, character, target, fighter, color:0, custom:!!row && p.device !== 'off'};
  });
  const slotGroup = fighter => [18,19].includes(fighter) ? 'zelda-sheik' : fighter;
  // Keep the unmodified first costume available when the lineup uses a stock fighter.
  for (const p of ports) if (!p.custom && p.device !== 'off') used.set(slotGroup(p.fighter), new Map([['vanilla',0]]));
  for (const p of ports) if (p.custom) {
    const slots = used.get(slotGroup(p.fighter)) || new Map();used.set(slotGroup(p.fighter), slots);
    if (!slots.has(p.character)) {
      const color = slots.size, costume = schema.costumes[p.fighter]?.[color];
      if (!costume) throw Error('This lineup has more custom characters than available costumes.');
      slots.set(p.character, color);
    }
    p.color = slots.get(p.character);
    if (!costumes.some(c=>c.fighter===p.fighter && c.color===p.color))
      costumes.push({character:p.character,target:p.target,fighter:p.fighter,color:p.color,filename:schema.costumes[p.fighter][p.color].filename});
  }
  // Game & Watch colors share a single DAT, unlike ordinary costume slots.
  for(const c of costumes) {
    const shared = schema.costumes[c.fighter].filter(slot=>slot.filename===c.filename).length>1;
    if(shared && ports.some(p=>p.device!=='off' && p.fighter===c.fighter && p.character!==c.character))
      throw Error('Game & Watch shares one costume file. Use the same custom character for its players, or choose another moveset.');
  }
  if (settings.mode === 0 && ports.filter(p => p.device !== 'off').length < 2) throw Error('Free-for-All needs at least two active players.');
  if (settings.mode === 3 && ['cpu','off'].includes(ports[0].device)) throw Error('1P Character Select needs a human on player 1.');
  for (const c of [...costumes]) {
    const companion=schema.companions?.[c.target];
    if(companion && !costumes.some(other=>other.target===companion.slug && other.color===c.color))
      costumes.push({...c,target:companion.slug,fighter:companion.fighter,filename:companion.costumes[c.color].filename,companion:true});
  }
  const stages = schema.stages.filter(s => s.id !== -1);
  const stage = settings.stage === -1 ? stages[Math.min(stages.length-1,Math.floor(random()*stages.length))].id : settings.stage;
  return {...settings,stage,ports,costumes,packedPorts:ports.map(p => p.fighter | ((p.device==='off'?3:p.device==='cpu'?1:0)<<8) | (p.color<<16))};
}
