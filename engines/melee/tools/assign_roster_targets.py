"""Assign expanded default movesets; preserve original costume cache identities.

These are gameplay/theme heuristics, not measured anatomical fit scores. Keep
choices stable across catalog reordering and reruns; review overrides here.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = {
    'mario': ('mario', 'dr-mario', 'ness', 'popo'),
    'luigi': ('luigi', 'ness', 'popo'),
    'captain-falcon': ('captain-falcon', 'ganondorf'),
    'fox': ('fox', 'falco', 'sheik', 'samus'),
    'marth': ('marth', 'roy'),
    'link': ('link', 'young-link'),
}
# Strong thematic matches take priority over the old broad moveset families.
MATCHES = {
    'donkey-kong': 'andrethegiant bigfoot bigshow theyeti tarzan',
    'bowser': 'cthulhu grendel krampus onidemon theminotaur',
    'ganondorf': 'theundertaker vladtheimpaler countdracula',
    'marth': 'kingarthur lancelot dartagnan zorro',
    'roy': 'achilles leonidas spartacus williamwallace',
    'link': 'robinhood williamtell',
    'young-link': 'jackthegiantkill',
    'sheik': 'brucelee hattorihanzo ipman donnieyen jetli',
    'samus': 'neilarmstrong buzzaldrin yurigagarin',
    'mewtwo': 'merlin prospero faust mephistopheles',
    'zelda': 'cleopatra nefertiti ladyjustice thetoothfairy',
    'peach': 'princessdiana marieantoinette botticellisvenus',
    'popo': 'jackfrost eddietheeagle shaunwhite tonyaharding',
    'ness': 'tomsawyer huckleberryfinn olivertwist tintin',
    'kirby': 'humptydumpty thecheshirecat',
    'jigglypuff': 'buddha cupid',
    'yoshi': 'thelochnessmonst kappatheyokai',
    'pikachu': 'tengu theeasterbunny',
    'pichu': 'leprechaun puckfromamidsumm',
    'game-watch': 'felixthecat bettyboop oliveoyl',
    'dr-mario': 'victorfrankenste drphil',
    'falco': 'anubis mothman',
}
OVERRIDES = {slug: target for target, slugs in MATCHES.items() for slug in slugs.split()}


def assign(rows):
    result = []
    for row in rows:
        original = row.get('original_target', row['target'])
        choices = FAMILIES.get(original, (original,))
        index = int.from_bytes(hashlib.sha256(row['slug'].encode()).digest()[:8], 'big')
        target = OVERRIDES.get(row['slug'], choices[index % len(choices)])
        result.append(dict(row, original_target=original, target=target))
    return result


if __name__ == '__main__':
    path = ROOT / 'web/public/catalog.json'
    path.write_text(json.dumps(assign(json.loads(path.read_text())), separators=(',', ':')) + '\n')
