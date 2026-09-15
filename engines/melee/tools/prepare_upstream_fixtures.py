"""Prepare local custom-character test data through the ordinary launcher API."""
import argparse
import json
from pathlib import Path
import urllib.parse
import urllib.request

ENGINE = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--url', default='http://127.0.0.1:5191')
p.add_argument('--output', type=Path, default=ENGINE / 'build/upstream-fixtures')
a = p.parse_args()
schema = json.loads((ENGINE / 'runtime/launch-options.json').read_text())

def request(path, body=None, method='GET'):
    req = urllib.request.Request(a.url.rstrip('/') + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=240) as response:
        return response.read()

def prepare(name, entries):
    folder = a.output / name
    folder.mkdir(parents=True, exist_ok=True)
    names = []
    def save(filename, contents):
        path = Path(filename)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Invalid fixture asset path')
        target = folder / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents)
        names.append(filename)
    for entry in entries:
        query = urllib.parse.urlencode(dict(target=entry['target'], color=entry['color'], skin='host', compact=1))
        asset = json.loads(request('/api/prepare/' + entry['character'] + '?' + query, method='POST'))
        save(entry['filename'], request(asset['url']))
    css = json.loads(request('/api/character-select', dict(costumes=entries), 'POST'))
    for asset in css['assets']:
        save(asset['filename'], request(asset['url']))
    (folder / 'manifest.json').write_text(json.dumps(names) + '\n')
    print(name, flush=True)

prepare('four-fixture', [dict(character=c, target=t, fighter=f, color=k, filename=n)
    for c,t,f,k,n in [('alanturing','mario',8,0,'PlMrNr.dat'),
        ('abrahamlincoln','fox',2,0,'PlFxNr.dat'),('stevejobs','mario',8,1,'PlMrYe.dat'),
        ('50cent','mario',8,2,'PlMrBk.dat')]])
for target in schema['targets']:
    fighter = target['fighter']
    entries = [dict(character='alanturing', target=target['slug'], fighter=fighter,
        color=0, filename=schema['costumes'][str(fighter)][0]['filename'])]
    companion = schema.get('companions', {}).get(target['slug'])
    if companion:
        entries.append(dict(character='alanturing', target=companion['slug'], fighter=companion['fighter'],
            color=0, filename=companion['costumes'][0]['filename'], companion=True))
    prepare('custom-target-' + target['slug'] + '-fixture', entries)
