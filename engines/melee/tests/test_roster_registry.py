import json,re,unittest
from pathlib import Path
from opensmash_melee.targets import BY_SLUG,PLAYABLE,cache_id
ROOT=Path(__file__).resolve().parents[1]
class RosterRegistry(unittest.TestCase):
 def test_every_playable_fighter_and_partner(self):
  self.assertEqual({r['fighter'] for r in PLAYABLE.values()},set(range(26)))
  self.assertEqual(len(PLAYABLE),26)
  self.assertEqual(len(BY_SLUG['nana']['costumes']),len(BY_SLUG['popo']['costumes']))
 def test_costume_protocol_matches_native_and_browser(self):
  js=(ROOT/'runtime/web/local-files.mjs').read_text()
  slots=json.loads(re.search(r'COSTUME_SLOTS = (\[.*?\]);',js).group(1))
  native=(ROOT/'runtime/mods/launch_match.c').read_text()
  cslots=re.findall(r'"([^"]+)"',re.search(r'costume_names\[\] = \{(.*?)\};',native).group(1))
  self.assertEqual(slots,cslots)
  self.assertEqual(set(slots),{c['filename'] for t in BY_SLUG.values() for c in t['costumes']})
  self.assertTrue(all(re.fullmatch(r'Pl[A-Za-z0-9]+\.dat',n) for n in slots))
 def test_alternate_caches_do_not_alias(self):
  ids=[cache_id('abrahamlincoln',target,'mario') for target in BY_SLUG]
  self.assertEqual(len(set(ids)),27)
  with self.assertRaises(ValueError):cache_id('x','../bad','mario')
 def test_catalog_defaults_cover_expanded_roster_and_preserve_cache_identity(self):
  from tools.assign_roster_targets import assign
  rows=json.loads((ROOT/'web/public/catalog.json').read_text())
  self.assertEqual({r['target'] for r in rows},set(PLAYABLE))
  self.assertEqual(assign(rows),rows)
  self.assertEqual(assign(list(reversed(rows))),list(reversed(rows)))
  for row in rows:
   original=row['original_target']
   ids=[cache_id(row['slug'],target,original) for target in BY_SLUG]
   self.assertEqual(len(set(ids)),len(BY_SLUG))
   if row['target']!=original:
    self.assertNotEqual(cache_id(row['slug'],row['target'],original),cache_id(row['slug'],original,original))
