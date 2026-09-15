"""Lazy conversion/source caches shared by ordinary website instances."""
import hashlib,json,threading,time
from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit,unquote,parse_qs
from .bucket_cache import pack,unpack
from .targets import cache_id

class ServiceCache:
    def __init__(self,base,store,manifest,version):
        self.base=base;self.store=store;self.manifest=manifest
        self.prefix='melee/cache/'+version+'/';self.loaded=set();self.locks={};self.lock=threading.Lock()
    def restore(self,key):
        if key in self.loaded:return True
        raw=self.store.get(key)
        if raw is None:return False
        unpack(raw,self.base.ROOT);self.loaded.add(key);return True
    def save(self,key,paths):
        self.store.put(key,pack(self.base.ROOT,paths));self.loaded.add(key)
    def source(self,slug):
        row=self.base.CATALOG.get(slug)
        if row and row.get('imported'):
            return self.restore('melee/imports/'+slug+'.tar.gz')
        entry=self.manifest.get('characters',{}).get(slug)
        if not entry:raise ValueError('Character source is not published: '+slug)
        if entry['key'] not in self.loaded:
            raw=self.store.get(entry['key'])
            if raw is None or hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Character source is unavailable: '+slug)
            unpack(raw,self.base.CHARACTERS/slug);self.loaded.add(entry['key'])
    def ident(self,slug,target=None):
        row=self.base.CATALOG[slug]
        return cache_id(slug,target or row['target'],row.get('original_target',row['target']))
    def variant(self,request):
        url=urlsplit(request.path);slug=unquote(url.path).rsplit('/',1)[1];q=parse_qs(url.query)
        ident=self.ident(slug,q.get('target',[None])[0])
        options=[ident,q.get('color',['0'])[0],q.get('skin',[''])[0],q.get('compact',['0'])[0]]
        return ident,self.prefix+'costumes/'+hashlib.sha256(json.dumps(options).encode()).hexdigest()+'.tar.gz'
    def request_lock(self,request):
        route=urlsplit(request.path).path
        if route.startswith(('/api/prepare/','/api/costume/')):
            ident,_=self.variant(request)
            with self.lock:return self.locks.setdefault(ident,threading.RLock())
        return nullcontext()
    def load_import(self,slug):
        raw=self.store.get('melee/import-rows/'+slug+'.json')
        if raw:
            row=json.loads(raw);self.base.CATALOG[slug]=row
            if not any(r['slug']==slug for r in self.base.IMPORTS.rows):self.base.IMPORTS.rows.append(row)
    def before_authorize(self,request,access):
        route=urlsplit(request.path).path
        # The grant is checked before importing any private catalog entries.
        if route=='/api/imports':
            for resource in access.resources(request.owner):
                if resource.startswith('fighter:'):self.load_import(resource[8:])
        elif route.startswith('/api/imports/') and not '/portraits/' in route:
            jobid=route.rsplit('/',1)[1]
            if access.allows(request.owner,'job:'+jobid) and jobid not in self.base.IMPORTS.jobs:
                raw=self.store.get('melee/jobs/'+jobid+'.json') or self.store.get('melee/jobs/'+jobid+'.pending.json')
                if raw:
                    job=json.loads(raw)
                    # A terminated instance cannot finish its old import.
                    if job['state'] in ('queued','working') and time.time()-job.get('created',0)>900:job.update(state='failed',message='Import was interrupted. Please retry.')
                    self.base.IMPORTS.jobs[jobid]=job if job['state'] in ('complete','failed') else dict(job)
                    if job.get('fighter'):self.load_import(job['fighter']['slug'])
                    # Keep pending remote jobs fresh on the next poll.
                    if job['state'] in ('queued','working'):self.base.IMPORTS.jobs.pop(jobid,None);request.remote_job=job
        else:
            slugs=[]
            if route.startswith(('/api/prepare/','/api/costume/','/api/announcer/','/api/imports/portraits/')):slugs=[route.rsplit('/',1)[1].removesuffix('.webp')]
            if route=='/api/character-select' and request.post_body:slugs=[c.get('character') for c in request.post_body.get('costumes',[]) if isinstance(c,dict)]
            for slug in slugs:
                if isinstance(slug,str) and slug.startswith('import-') and access.allows(request.owner,'fighter:'+slug):self.load_import(slug)
    def before_request(self,request):
        route=urlsplit(request.path).path
        if route.startswith(('/api/prepare/','/api/costume/')):
            ident,key=self.variant(request)
            if request.command=='POST':
                raw=self.store.get(key+'.json')
                if raw:request.cached_value=json.loads(raw);return
            self.restore(key)
            slug=route.rsplit('/',1)[1]
            if request.command=='POST':self.source(slug)
        elif route.startswith('/api/announcer/'):
            self.source(route.rsplit('/',1)[1])
        elif route.startswith('/api/imports/portraits/'):
            self.source(route.rsplit('/',1)[1].removesuffix('.webp'))
        elif route.startswith('/api/character-select/'):
            key=route.split('/')[3];self.restore(self.prefix+'selection/'+key+'.tar.gz')
        elif route=='/api/character-select':
            request.selection_key=self.prefix+'lineups/'+hashlib.sha256(json.dumps(request.post_body,sort_keys=True).encode()).hexdigest()+'.json'
            raw=self.store.get(request.selection_key)
            if raw:request.cached_value=json.loads(raw);return
            for entry in request.post_body['costumes']:
                slug=entry['character'];self.source(slug)
                ident=self.ident(slug,entry.get('target'))
                self.restore(self.prefix+'sources/'+ident+'.tar.gz')
    def response(self,request,value,status):
        if status>=300 or not isinstance(value,dict) or getattr(request,'cached_value',None):return
        route=urlsplit(request.path).path
        if route.startswith('/api/prepare/'):
            ident,key=self.variant(request)
            # zlib compression overlaps on one helper; publish metadata only
            # after both complete bundles have been stored successfully.
            with ThreadPoolExecutor(max_workers=1) as helper:
                source = helper.submit(pack,self.base.ROOT,['assets/characters/'+ident])
                self.save(key,['build/characters/'+ident,'assets/characters/'+ident])
                source_raw = source.result()
            source_key=self.prefix+'sources/'+ident+'.tar.gz'
            self.store.put(source_key,source_raw);self.loaded.add(source_key)
            self.store.put(key+'.json',json.dumps(value).encode())
        elif route=='/api/character-select' and value.get('assets'):
            key=value['assets'][0]['url'].split('/')[3]
            self.save(self.prefix+'selection/'+key+'.tar.gz',['build/character-select/'+key])
            self.store.put(request.selection_key,json.dumps(value).encode())
        elif route=='/api/imports' and value.get('id'):
            self.store.put('melee/jobs/'+value['id']+'.pending.json',json.dumps({**value,'created':time.time()}).encode())
    def install_import_cache(self):
        manager=self.base.IMPORTS;work=manager.work
        def cached_work(job,url,target):
            job.update(state='working',message='Preparing imported fighter…')
            result=dict(job)
            work(result,url,target)
            try:
                if result.get('fighter'):
                    row=result['fighter'];slug=row['slug'];ident=self.ident(slug)
                    if not (self.base.ROOT/'assets/characters'/ident).is_dir():self.source(slug)
                    self.save('melee/imports/'+slug+'.tar.gz',['assets/characters/'+ident,'build/character-imports/'+slug+'.webp'])
                    self.save(self.prefix+'sources/'+ident+'.tar.gz',['assets/characters/'+ident])
                    self.store.put('melee/import-rows/'+slug+'.json',json.dumps(row).encode())
                self.store.put('melee/jobs/'+job['id']+'.json',json.dumps(result).encode())
            except Exception:
                result.update(state='failed',message='Could not save the imported fighter. Please retry.');result.pop('fighter',None)
            job.update(result)
        manager.work=cached_work
