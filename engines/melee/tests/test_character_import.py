import hashlib,json,tempfile,unittest
from pathlib import Path
import threading
from opensmash_melee.character_import import source_url,import_source,ImportManager,FILES
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'opensmash/pipeline/play/ui/alanturing'
BASE='https://smash.fun/engine/character-source/'+'a'*48+'/'
class SourceImportTests(unittest.TestCase):
 def test_rejects_legacy_links_credentials_and_arbitrary_hosts(self):
  for url in ['file:///etc/passwd','http://127.0.0.1/secret','https://smash.fun@evil.test/a',BASE+'manifest.json?secret=1','https://smash.fun/engine/bundles/foo.osb6']:
   with self.assertRaises(ValueError):source_url(url,{'https://smash.fun'})
  self.assertEqual(source_url(BASE+'manifest.json',{'https://smash.fun'}),BASE+'manifest.json')
 @unittest.skipUnless((SOURCE/'rigged.glb').exists(),'Local generated source required')
 def test_hash_validation_asset_scope_and_source_roundtrip(self):
  assets={name:(SOURCE/name).read_bytes() for name in FILES}
  manifest={'format':'opensmash-source-v1','name':'Imported Turing','short':'TURING','files':{name:{'url':BASE+name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)} for name,raw in assets.items()}}
  def fetch(url,limit):return json.dumps(manifest).encode() if url.endswith('manifest.json') else assets[url.rsplit('/',1)[1]]
  with tempfile.TemporaryDirectory() as directory:
   dest=Path(directory);row=import_source(BASE+'manifest.json',dest,{'https://smash.fun'},fetch)
   self.assertEqual(row['name'],'Imported Turing');self.assertEqual((dest/'rigged.glb').read_bytes(),assets['rigged.glb'])
   self.assertNotIn('url',row)
   self.assertEqual(json.loads((dest/'character.json').read_text())['display'],'Imported Turing')
   manifest['files']['rigged.glb']['url']='https://smash.fun/other/rigged.glb'
   with self.assertRaisesRegex(ValueError,'same character'):import_source(BASE+'manifest.json',dest,{'https://smash.fun'},fetch)
   manifest['files']['rigged.glb']['url']=BASE+'rigged.glb';manifest['files']['rigged.glb']['sha256']='0'*64
   with self.assertRaisesRegex(ValueError,'integrity'):import_source(BASE+'manifest.json',dest,{'https://smash.fun'},fetch)

 def test_remove_forgets_imported_fighter_and_deletes_its_files(self):
  with tempfile.TemporaryDirectory() as directory:
   workspace=Path(directory);slug='import-'+'b'*24;ident='web-v1-'+hashlib.sha256(slug.encode()).hexdigest()[:16]
   imports=workspace/'build/character-imports';imports.mkdir(parents=True)
   row={'slug':slug,'name':'Removable','short':'GONE','target':'fox','portrait':f'/api/imports/portraits/{slug}.webp','imported':True}
   (imports/'roster.json').write_text(json.dumps([row]));(imports/(slug+'.webp')).write_bytes(b'art')
   for folder in ['build/characters','assets/characters']:(workspace/folder/ident).mkdir(parents=True);(workspace/folder/ident/'file').write_bytes(b'x')
   catalog={'mario-fixture':{'slug':'mario-fixture','target':'mario'}}
   manager=ImportManager(catalog,threading.Lock(),workspace=workspace)
   self.assertIn(slug,catalog)
   with self.assertRaisesRegex(ValueError,'imported'):manager.remove('mario-fixture')
   with self.assertRaisesRegex(ValueError,'imported'):manager.remove('import-'+'c'*24)
   self.assertEqual(manager.remove(slug)['name'],'Removable')
   self.assertNotIn(slug,catalog);self.assertEqual(json.loads((imports/'roster.json').read_text()),[])
   self.assertFalse((imports/(slug+'.webp')).exists())
   for folder in ['build/characters','assets/characters']:self.assertFalse((workspace/folder/ident).exists())
   self.assertIn('mario-fixture',catalog)
