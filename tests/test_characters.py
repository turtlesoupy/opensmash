"""Character selection and offline staging contracts; no live network or engine."""
import contextlib
import gzip
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from targets import characters as c


def mesh():
    return b'OSB5'+struct.pack('<5I',1,3,1,1,1)+struct.pack('<I',4)+b'\xff\xff'+bytes(3*28)+struct.pack('<4H',0,1,2,0)


def bundle(fkinds=(0,4)):
    m=mesh()
    payload=m[:16]+bytes(8)+m[24:28]+m[30:]
    return b'OSB6'+struct.pack('<3I',1,1,len(fkinds))+b'\xff\xff'+b''.join(struct.pack('<2I',fk,len(payload))+payload for fk in fkinds)


def row(slug, **kw):
    return dict(slug=slug, name='Name '+slug, fkind=0, bundleUrl='https://assets.test/'+slug+'.osb6', **kw)


class CharacterTests(unittest.TestCase):
    def test_private_build_link_and_unicode(self):
        raw=row('mine', ownerId='must-not-be-copied')
        raw['name']='私の fighter'
        url='https://smash.fun/#'+urlencode({'opensmash-character':json.dumps(raw)})
        self.assertEqual(c.from_url(url)['name'], raw['name'])
        self.assertEqual(c.from_url(url)['bundleUrl'], raw['bundleUrl'])

    def test_existing_engine_launch_link(self):
        url='https://smash.fun/engine/?'+urlencode(dict(inject='bundles/mine-AbCd012345678901.osb6',
            inject_ui='bundles/mine-AbCd012345678901.osbui',fkind=4,inject_name='Private Fighter'))
        result=c.from_url(url)
        self.assertEqual(result['fkind'],4)
        self.assertEqual(result['bundleUrl'],'https://smash.fun/engine/bundles/mine-AbCd012345678901.osb6')

    def test_selection_order_missing_and_private_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog=Path(tmp)/'catalog.json'
            catalog.write_text(json.dumps({'characters':[row('first'),row('second')]}))
            rows=c.resolve(str(catalog),'https://smash.fun',['second,first'],[])
            self.assertEqual([r['slug'] for r in rows],['second','first'])
            with self.assertRaisesRegex(ValueError,'Unknown character'):
                c.resolve(str(catalog),'https://smash.fun',['third'],[])
        with patch.object(c,'fetch',side_effect=AssertionError('unexpected catalog request')):
            rows=c.resolve('unused','https://smash.fun',['none'],['https://assets.test/private.osb6'])
            self.assertEqual(rows[0]['slug'],'private')

    def test_osb6_extraction_preserves_texture_and_target(self):
        self.assertEqual(c.extract(bundle(),4),mesh())
        with self.assertRaisesRegex(ValueError,'no fox'):
            c.extract(bundle(),1)

    def test_truncated_duplicate_and_bad_indices_fail(self):
        for data in [bundle()[:-1],bundle((0,0)),b'OSB6'+bytes(12)]:
            with self.assertRaises(ValueError): c.extract(data,0)
        bad=bytearray(mesh());struct.pack_into('<H',bad,len(bad)-8,3)
        with self.assertRaisesRegex(ValueError,'triangle'): c.extract(bad,0)

    def test_slot_assignment_can_reassign_a_flexible_fighter(self):
        self.assertEqual(c.assign_rom([[0,4],[0]],[0,0]),{0:4,1:0})
        with self.assertRaisesRegex(ValueError,'distinct ROM'):
            c.assign_rom([[0],[0]],[0,0])

    def test_path_traversal_slug_rejected(self):
        for slug in ['../escape','x/y','x|y','x\nx']:
            with self.assertRaises(ValueError):c.clean_character(row(slug),'https://smash.fun')

    def test_c_field_limits_are_bytes_and_no_delimiters(self):
        value=c.field('é'*20+'|\n',10)
        self.assertEqual(len(value.encode()),10)
        self.assertNotIn('|',c.field('name|injected\nrow',47))

    def test_native_stages_two_pages_and_no_private_urls_in_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=type('Args',(),dict(target='native',output=Path(tmp),catalog='unused',site='https://smash.fun',characters=None,character_url=[]))()
            with patch.object(c,'resolve',return_value=[c.clean_character(row('c'+str(i)),'https://smash.fun') for i in range(13)]), \
                 patch.object(c,'fetch',return_value=bundle()), contextlib.redirect_stdout(io.StringIO()):
                c.prepare(args)
            rows=(Path(tmp)/'roster.txt').read_text().splitlines()
            self.assertEqual(len(rows),13)
            self.assertEqual(len({r.split('|')[1] for r in rows[:12]}),12)
            self.assertEqual(rows[0].split('|')[1],rows[12].split('|')[1])
            self.assertTrue((Path(tmp)/'Play.command').stat().st_mode & 0o100)
            self.assertNotIn('https://',(Path(tmp)/'characters.json').read_text())
            compile((Path(tmp)/'play.py').read_text(),'play.py','exec')

    def test_rom_full_catalog_fails_before_downloading_or_creating_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'not-created'
            args=type('Args',(),dict(target='rom',output=output,catalog='unused',site='https://smash.fun',characters=None,character_url=[]))()
            with patch.object(c,'resolve',return_value=[row('c'+str(i)) for i in range(13)]), \
                 patch.object(c,'fetch') as fetch, self.assertRaisesRegex(ValueError,'12 fixed slots'):
                c.prepare(args)
            fetch.assert_not_called()
            self.assertFalse(output.exists())

    def test_http_gzip_and_error_redaction(self):
        response=io.BytesIO(gzip.compress(b'content'))
        response.headers={'Content-Encoding':'gzip'}
        with patch.object(c.urllib.request,'urlopen',return_value=response):
            self.assertEqual(c.fetch('https://assets.test/private-token'),b'content')
        error=c.urllib.error.HTTPError('https://assets.test/private-token',403,'denied',{},None)
        with patch.object(c.urllib.request,'urlopen',side_effect=error):
            with self.assertRaises(ValueError) as caught:c.fetch('https://assets.test/private-token')
        self.assertNotIn('private-token',str(caught.exception))
        self.assertIn('403',str(caught.exception))

    def test_content_addressed_hash_is_verified(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(c,'fetch',return_value=b'bad'):
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                c.cached_asset('https://assets.test/objects/'+'0'*64+'/file.osb6',Path(tmp))

    def test_javascript_export_is_importable_in_python(self):
        script="import {characterBuildLink} from './web-prototype/shared/character-build-link.js'; console.log(characterBuildLink({slug:'mine',name:'私',bundleUrl:'/private.osb6'},'https://smash.fun'));"
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True,check=True)
        self.assertEqual(c.from_url(result.stdout.strip())['name'],'私')


if __name__=='__main__':unittest.main()
