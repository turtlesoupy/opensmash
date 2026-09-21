import io,json,tarfile,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from opensmash_melee.bucket_cache import Store,BucketAccess,pack,unpack
from opensmash_melee.hosted_cache import ServiceCache

class CacheTests(unittest.TestCase):
 def test_archive_rejects_links_and_parent_paths(self):
  with tempfile.TemporaryDirectory() as root:
   for name,kind in [('../escaped',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
    raw=io.BytesIO()
    with tarfile.open(fileobj=raw,mode='w:gz') as t:
     item=tarfile.TarInfo(name);item.type=kind;t.addfile(item,io.BytesIO())
    with self.assertRaises(ValueError):unpack(raw.getvalue(),root)
 def test_owner_grants_survive_instances_without_overwriting_each_other(self):
  with tempfile.TemporaryDirectory() as root:
   store=Store(local=root);a=BucketAccess(store);b=BucketAccess(store)
   a.grant('a'*64,'fighter:one');b.grant('a'*64,'fighter:two')
   self.assertTrue(b.allows('a'*64,'fighter:one'))
   self.assertFalse(b.allows('b'*64,'fighter:one'))
   self.assertEqual(set(BucketAccess(store).resources('a'*64)),{'fighter:one','fighter:two'})
 def test_cold_instance_serves_cached_conversion_without_sources_or_rebuild(self):
  with tempfile.TemporaryDirectory() as root:
   root=Path(root);store=Store(local=root/'bucket')
   def cache(folder,version='v1'):
    base=SimpleNamespace(ROOT=root/folder,CHARACTERS=root/folder/'library',CATALOG={'test':{'target':'mario'}},IMPORTS=SimpleNamespace(rows=[],jobs={}))
    return ServiceCache(base,store,{},version)
   one=cache('one');request=SimpleNamespace(path='/api/prepare/test?skin=host&target=mario&color=0',command='POST')
   ident,key=one.variant(request)
   output=one.base.ROOT/'build/characters'/ident/'browser/PlMrNr.dat';output.parent.mkdir(parents=True);output.write_bytes(b'costume')
   source=one.base.ROOT/'assets/characters'/ident/'rigged.glb';source.parent.mkdir(parents=True);source.write_bytes(b'original')
   value={'url':'/api/costume/test?skin=host&target=mario&color=0','filename':'PlMrNr.dat'}
   one.response(request,value,200)
   two=cache('two');post=SimpleNamespace(path=request.path,command='POST');two.before_request(post)
   self.assertEqual(post.cached_value,value)
   get=SimpleNamespace(path=value['url'],command='GET');two.before_request(get)
   self.assertEqual((two.base.ROOT/'build/characters'/ident/'browser/PlMrNr.dat').read_bytes(),b'costume')
   self.assertNotEqual(cache('three','v2').variant(request)[1],key)
 def test_lineup_cache_survives_instance_change(self):
  with tempfile.TemporaryDirectory() as root:
   root=Path(root);store=Store(local=root/'bucket');base=SimpleNamespace(ROOT=root/'one',CATALOG={})
   first=ServiceCache(base,store,{},'v1');body={'costumes':[]};req=SimpleNamespace(path='/api/character-select',command='POST',post_body=body)
   first.before_request(req);key='a'*64
   path=base.ROOT/'build/character-select'/key/'0.bin';path.parent.mkdir(parents=True);path.write_bytes(b'menu')
   value={'assets':[{'url':'/api/character-select/'+key+'/0.bin'}]};first.response(req,value,200)
   second=ServiceCache(SimpleNamespace(ROOT=root/'two',CATALOG={}),store,{},'v1');other=SimpleNamespace(path=req.path,command='POST',post_body=body)
   second.before_request(other);self.assertEqual(other.cached_value,value)
   second.before_request(SimpleNamespace(path=value['assets'][0]['url'],command='GET'))
   self.assertEqual((root/'two/build/character-select'/key/'0.bin').read_bytes(),b'menu')

 def test_import_completion_is_durable_before_other_instance_observes_it(self):
  with tempfile.TemporaryDirectory() as root:
   root=Path(root);store=Store(local=root/'bucket');owner='a'*64;access=BucketAccess(store)
   slug='import-'+'b'*24;row={'slug':slug,'target':'mario','imported':True}
   manager=SimpleNamespace(rows=[],jobs={});base=SimpleNamespace(ROOT=root/'one',CATALOG={},IMPORTS=manager)
   first=ServiceCache(base,store,{},'v1')
   def work(job,url,target,source_only=False):
    self.assertTrue(source_only)
    base.CATALOG[slug]=row;ident=first.ident(slug)
    source=base.ROOT/'assets/characters'/ident/'rigged.glb';source.parent.mkdir(parents=True);source.write_bytes(b'imported model')
    portrait=base.ROOT/'build/character-imports'/f'{slug}.webp';portrait.parent.mkdir(parents=True);portrait.write_bytes(b'portrait')
    job.update(state='complete',fighter=row)
   manager.work=work;first.install_import_cache();job={'id':'c'*32,'state':'queued'}
   manager.work(job,'https://unused.invalid','mario',True);access.grant(owner,'job:'+job['id'])
   second_base=SimpleNamespace(ROOT=root/'two',CATALOG={},IMPORTS=SimpleNamespace(rows=[],jobs={}))
   second=ServiceCache(second_base,store,{},'v1')
   req=SimpleNamespace(path='/api/imports/'+job['id'],owner='d'*64)
   second.before_authorize(req,access);self.assertFalse(second_base.IMPORTS.jobs)
   req.owner=owner;second.before_authorize(req,access)
   self.assertEqual(second_base.IMPORTS.jobs[job['id']]['state'],'complete')
   second.source(slug)
   self.assertEqual((second_base.ROOT/'assets/characters'/second.ident(slug)/'rigged.glb').read_bytes(),b'imported model')

 def test_native_source_assets_survive_a_cold_instance(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);store=Store(local=root/'bucket');revision='a'*64
   first=ServiceCache(SimpleNamespace(ROOT=root/'one'),store,{},'v1')
   folder=first.base.ROOT/'build/native-fit/local/revisions'/revision/'sources';folder.mkdir(parents=True)
   (folder/'custom.json').write_bytes(b'geometry')
   value={'base':'/api/native-fit/assets/'+revision+'/sources/custom'}
   first.response(SimpleNamespace(path='/api/native-fit/source/custom'),value,200)
   second=ServiceCache(SimpleNamespace(ROOT=root/'two'),store,{},'v1')
   request=SimpleNamespace(path=value['base']+'.json',command='GET')
   self.assertIs(second.request_lock(request),second.request_lock(SimpleNamespace(path=value['base']+'.rgba8')))
   second.before_request(request)
   self.assertEqual((second.base.ROOT/'build/native-fit/local/revisions'/revision/'sources/custom.json').read_bytes(),b'geometry')

 def test_import_source_restores_after_overlapping_cache_eviction(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);store=Store(local=root/'bucket');slug='import-'+'b'*24
   base=SimpleNamespace(ROOT=root/'workspace',CATALOG={slug:{'target':'mario','imported':True}})
   cache=ServiceCache(base,store,{},'v1');ident=cache.ident(slug)
   relative='assets/characters/'+ident
   source=base.ROOT/relative/'rigged.glb';source.parent.mkdir(parents=True);source.write_bytes(b'model')
   imported='melee/imports/'+slug+'.tar.gz';variant=cache.prefix+'sources/'+ident+'.tar.gz'
   cache.save(imported,[relative]);cache.save(variant,[relative])
   # Both archives own the same directory; evicting one leaves the other loaded.
   cache.entries[variant]['used']=0;cache.budget=5;cache.evict()
   self.assertFalse(source.exists())
   cache.source(slug)
   self.assertEqual(source.read_bytes(),b'model')

 def test_missing_cache_input_cannot_silently_publish_partial_archive(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'portrait.webp').write_bytes(b'portrait')
   with self.assertRaises(FileNotFoundError):pack(root,['missing-source','portrait.webp'])

 def test_repaired_import_is_restored_even_if_portrait_only_archive_was_loaded(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);store=Store(local=root/'bucket');slug='import-'+'b'*24
   base=SimpleNamespace(ROOT=root/'workspace',CATALOG={slug:{'target':'mario','imported':True}})
   cache=ServiceCache(base,store,{},'v1');key='melee/imports/'+slug+'.tar.gz'
   portrait=f'build/character-imports/{slug}.webp'
   art=base.ROOT/portrait;art.parent.mkdir(parents=True);art.write_bytes(b'portrait')
   cache.save(key,[portrait])
   repaired=root/'repaired';source=repaired/'assets/characters'/cache.ident(slug)/'rigged.glb'
   source.parent.mkdir(parents=True);source.write_bytes(b'recovered model')
   store.put(key,pack(repaired,['assets/characters/'+cache.ident(slug)]))
   cache.source(slug)
   self.assertEqual((base.ROOT/source.relative_to(repaired)).read_bytes(),b'recovered model')
