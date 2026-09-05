"""Character selection and offline staging contracts; no live network or engine."""
import contextlib
import gzip
import io
import http.server
import threading
import wave
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


def voice():
    data = io.BytesIO()
    with wave.open(data, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(32000)
        w.writeframes(struct.pack('<4h', 100, -100, 200, -200))
    return data.getvalue()


def custom_manifest():
    return dict(protocolVersion=1, character=dict(slug='mine', name='My Custom Fighter', short='CUSTOM'),
                artifacts={key: dict(url=None) for key in ('bundle', 'ui', 'announcer', 'portrait')})


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

    def test_private_download_discovers_companion_capability_urls(self):
        url = 'https://smash.fun/engine/bundles/mine-AbCd012345678901.osb6'
        with patch.object(c, 'fetch', return_value=json.dumps(custom_manifest()).encode()) as fetch:
            result = c.from_url(url)
        fetch.assert_called_once_with('https://smash.fun/engine/fighters/mine-AbCd012345678901/manifest.json')
        self.assertEqual(result['uiUrl'], url[:-5]+'.osbui')
        self.assertEqual(result['voiceUrl'], url[:-5]+'.wav')
        self.assertEqual(result['name'], 'My Custom Fighter')
        self.assertTrue(result['requireExtras'])

    def test_public_download_uses_version_manifest_and_explicit_asset_urls(self):
        root = 'https://storage.googleapis.com/bucket/characters/mine/versions/job-1'
        manifest = custom_manifest()
        manifest['artifacts']['announcer']['url'] = 'https://cdn.test/audio.wav'
        with patch.object(c, 'fetch', return_value=json.dumps(manifest).encode()) as fetch:
            result = c.from_url(root+'/injection/mine.osb6')
        fetch.assert_called_once_with(root+'/manifest.json')
        self.assertEqual(result['uiUrl'], root+'/injection/mine.osbui')
        self.assertEqual(result['voiceUrl'], 'https://cdn.test/audio.wav')
        self.assertEqual(result['portrait'], root+'/portrait.png')

    def test_bad_manifest_does_not_silently_import_only_mesh(self):
        for manifest in [dict(protocolVersion=2,character=dict(slug='mine')), custom_manifest()]:
            manifest['character']['slug'] = 'someoneelse'
            with patch.object(c, 'fetch', return_value=json.dumps(manifest).encode()):
                with self.assertRaisesRegex(ValueError, 'manifest'):
                    c.from_url('https://smash.fun/engine/bundles/mine-AbCd012345678901.osb6')

    def test_voice_and_emblem_validation(self):
        c.validate_voice(voice())
        with self.assertRaisesRegex(ValueError, 'Truncated'):
            c.validate_voice(voice()[:-1])
        with self.assertRaises(ValueError):
            c.validate_voice(b'RIFF'+bytes(50))
        self.assertFalse(c.has_emblem(b'OSBV'+bytes(c.OSBV_EMBLEM_OFFSET+2304)))
        self.assertTrue(c.has_emblem(b'OSBV'+bytes(c.OSBV_EMBLEM_OFFSET-4)+bytes([255])*2304))

    def test_http_custom_download_stages_audio_and_embedded_emblem(self):
        token = 'mine-AbCd012345678901'
        root = '/engine/fighters/'+token
        bundle_path = '/engine/bundles/'+token
        ui = b'OSBV'+bytes(c.OSBV_EMBLEM_OFFSET-4)+bytes([127])*2304
        files = {root+'/manifest.json':json.dumps(custom_manifest()).encode(),
                 bundle_path+'.osb6':bundle(), bundle_path+'.osbui':ui,
                 bundle_path+'.wav':voice(), root+'/portrait.png':b'\x89PNG'+bytes(20)}
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(200 if self.path in files else 404)
                self.end_headers()
                self.wfile.write(files.get(self.path,b'missing'))
            def log_message(self, *args): pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                site = 'http://127.0.0.1:'+str(server.server_port)
                args = type('Args',(),dict(target='native',output=Path(tmp),catalog='unused',
                    site=site,characters=['none'],character_url=[site+bundle_path+'.osb6']))()
                with contextlib.redirect_stdout(io.StringIO()): c.prepare(args)
                entry = (Path(tmp)/'roster.txt').read_text().strip().split('|')
                self.assertEqual((Path(tmp)/entry[3]).read_bytes(),ui)
                self.assertEqual((Path(tmp)/entry[4]).read_bytes(),voice())
                report = json.loads((Path(tmp)/'characters.json').read_text())['characters'][0]
                self.assertTrue(report['announcer'])
                self.assertTrue(report['emblem'])
                self.assertEqual(set(requests),set(files))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

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
