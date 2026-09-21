"""Bounded source-link import for the local Melee web launcher."""
import hashlib,json,os,re,shutil,stat,tempfile,threading,uuid
from pathlib import Path
from urllib.parse import urlsplit,urljoin
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
from urllib.error import HTTPError
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from .__main__ import atomic_write
from .glb import GLB
from .character_build import archive_previous_build,run_stage
ROOT=Path(__file__).resolve().parents[1]
FILES={'rigged.glb':64<<20,'portrait_raw.png':16<<20,'stock_raw.png':8<<20,'emblem_raw.png':8<<20,'announcer.wav':16<<20}
OPTIONAL_FILES={'emblem_stencil.png':8<<20,'melee-source.json':32<<20,'melee-source.rgba8':4<<20,'melee-source.identity.dat':4<<20,'melee-source-ready.json':4096}
from .targets import PLAYABLE
TARGETS=set(PLAYABLE)
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Import links must point directly to the source export.')

def source_url(value,origins):
    if not isinstance(value,str) or len(value)>4096:raise ValueError('Paste a Melee import URL from your character’s download panel.')
    url=urlsplit(value.strip())
    if url.username or url.password or url.query or url.fragment or f'{url.scheme}://{url.netloc}' not in origins:
        raise ValueError('Use a Melee import URL from smash.fun.')
    if not re.fullmatch(r'/engine/character-source/[a-f0-9]{48}/manifest.json',url.path):
        raise ValueError('That is not a Melee source link. In the creator, choose “Copy Melee import URL”; the Smash 64 bundle URL cannot be retargeted directly.')
    return url.geturl()

def download(url,limit):
    opener=build_opener(ProxyHandler({}),NoRedirect())
    try:
        with opener.open(Request(url,headers={'User-Agent':'OpenSmash-Melee-Import/1'}),timeout=30) as response:
            size=response.headers.get('Content-Length')
            if size and int(size)>limit:raise ValueError('Character asset exceeds the import size limit.')
            raw=response.read(limit+1)
    except ValueError:raise
    except HTTPError as error:
        if error.code in (404,410):
            raise ValueError('This import link is no longer available. Copy a new Melee import URL from smash.fun.') from None
        raise ValueError(f'Could not download {Path(urlsplit(url).path).name} (HTTP {error.code}). Try again shortly.') from None
    except Exception:raise ValueError('Could not download the character. Check your connection and retry.') from None
    if len(raw)>limit:raise ValueError('Character asset exceeds the import size limit.')
    return raw

def import_source(link,destination,origins,fetch=download):
    link=source_url(link,origins)
    manifest=json.loads(fetch(link,64<<10))
    optional=manifest.get('nativeSource',{})
    if not isinstance(optional,dict) or not set(optional)<=set(OPTIONAL_FILES):raise ValueError('Invalid native source manifest.')
    manifest['files']={**manifest.get('files',{}),**optional}
    names=set(manifest['files'])
    if manifest.get('format')!='opensmash-source-v1' or not set(FILES)<=names or not names<=set(FILES)|set(OPTIONAL_FILES):raise ValueError('Unsupported character source manifest.')
    name=manifest.get('name');short=manifest.get('short')
    if not isinstance(name,str) or not 1<=len(name)<=120 or not isinstance(short,str) or not 1<=len(short)<=120:raise ValueError('Invalid character name.')
    for filename,limit in {**FILES,**{n:limit for n,limit in OPTIONAL_FILES.items() if n in names}}.items():
        entry=manifest['files'][filename]
        if type(entry.get('bytes')) is not int or not 0<entry['bytes']<=limit or not re.fullmatch('[a-f0-9]{64}',entry.get('sha256','')):raise ValueError('Invalid source asset metadata.')
        url=urljoin(link,entry.get('url',''))
        if url!=urljoin(link,filename):raise ValueError('Source assets must belong to the same character export.')
        raw=fetch(url,entry['bytes'])
        if len(raw)!=entry['bytes'] or hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Character integrity check failed. Copy a fresh import link.')
        (destination/filename).write_bytes(raw)
    mesh=GLB(destination/'rigged.glb').mesh()
    if len(mesh['positions'])>65535 or len(mesh['triangles'])>100000 or len(mesh['names'])>256:raise ValueError('This mesh is too large for the character importer.')
    for filename in ['portrait_raw.png','stock_raw.png','emblem_raw.png']:
        with Image.open(destination/filename) as im:
            if im.format!='PNG' or im.width*im.height>16_777_216:raise ValueError('Invalid character art.')
            im.verify()
    # ASCII-escaped JSON also reads correctly in older Windows locale encodings.
    (destination/'character.json').write_text(json.dumps({'name':name,'display':name,'short':short})+'\n',encoding='utf-8')
    # Identity is content-based. Never persist the bearer URL in the public roster.
    signature=json.dumps({'name':name,'short':short,'files':{n:e['sha256'] for n,e in manifest['files'].items() if n in FILES or n=='emblem_stencil.png'}},sort_keys=True)
    return {'name':name,'short':short,'signature':hashlib.sha256(signature.encode()).hexdigest()}

class ImportManager:
    def __init__(self,catalog,lock,origins=None,workspace=ROOT,queue_limit=1):
        self.queue_limit=queue_limit
        self.catalog=catalog;self.lock=lock;self.origins=set(origins or ['https://smash.fun','https://www.smash.fun'])
        self.workspace=Path(workspace);self.root=self.workspace/'build/character-imports';self.root.mkdir(parents=True,exist_ok=True)
        self.index=self.root/'roster.json';self.jobs={};self.pool=ThreadPoolExecutor(max_workers=1);self.state_lock=threading.Lock()
        self.rows=json.loads(self.index.read_text()) if self.index.exists() else []
        self.catalog.update({r['slug']:r for r in self.rows})
    def start(self,url,target,source_only=False):
        url=source_url(url,self.origins)
        if target not in TARGETS:raise ValueError('Choose one of the supported Melee targets.')
        with self.state_lock:
            if sum(j['state'] in ['queued','working'] for j in self.jobs.values())>=self.queue_limit:raise ValueError('The character conversion queue is full. Try again shortly.')
            token=uuid.uuid4().hex;job={'id':token,'state':'queued','message':'Waiting to import…'};self.jobs[token]=job
        self.pool.submit(self.work,job,url,target,source_only);return dict(job)
    def remove(self,slug):
        """Forget an imported fighter and delete its converted costume, retained source and portrait."""
        with self.state_lock:
            if any(j['state'] in ['queued','working'] for j in self.jobs.values()):raise ValueError('Wait for the current character import to finish first.')
        with self.lock:
            row=self.catalog.get(slug)
            if not isinstance(slug,str) or not row or not row.get('imported'):raise ValueError('Only characters you imported can be removed.')
            self.rows=[r for r in self.rows if r['slug']!=slug]
            atomic_write(self.index,(json.dumps(self.rows,indent=2)+'\n').encode());del self.catalog[slug]
            ident='web-v1-'+hashlib.sha256(slug.encode()).hexdigest()[:16]
            for folder in [self.workspace/'build/characters'/ident,self.workspace/'assets/characters'/ident]:
                # Windows refuses to delete files with open handles or the read-only bit; clear the bit, then park anything left over.
                def retry(fn,path,exc):
                    try:os.chmod(path,stat.S_IWRITE);fn(path)
                    except OSError:pass
                shutil.rmtree(folder,onexc=retry)
                if folder.exists():folder.rename(self.root/(folder.parent.name+'-'+ident+'-removed-'+uuid.uuid4().hex))
            (self.root/(slug+'.webp')).unlink(missing_ok=True)
        return row
    def work(self,job,url,target,source_only=False):
        def progress(message):job.update(state='working',message=message)
        try:
            progress('Downloading and checking your character…')
            with tempfile.TemporaryDirectory(prefix='source-',dir=self.root) as temp:
                source=Path(temp);info=import_source(url,source,self.origins)
                slug='import-'+hashlib.sha256((info['signature']+('' if source_only else target)).encode()).hexdigest()[:24]
                with self.lock:
                    existing=self.catalog.get(slug)
                    ident='web-v1-'+hashlib.sha256(slug.encode()).hexdigest()[:16]
                    retained=self.workspace/'assets/characters'/ident
                    if existing and all((retained/name).is_file() for name in [*FILES,'character.json']):
                        if source_only and existing['target']!=target:
                            existing['target']=target
                            atomic_write(self.index,(json.dumps(self.rows,indent=2)+'\n').encode())
                        job.update(state='complete',message='Character is ready.',fighter=existing);return
                    archive_previous_build(self.workspace,ident)
                    commands=[('Fitting character',['tools/build_character.py',str(source),'--id',ident,'--target',target]),
                              ('Preparing textures and artwork',['tools/upgrade_character_surfaces.py',ident]),
                              ('Building playable costume',['tools/build_browser_skin_costume.py',ident])]
                    try:
                        if source_only:
                            from .__main__ import import_character
                            progress('Preparing character source…')
                            import_character(source,self.workspace/'assets/characters'/ident)
                        for stage,args in ([] if source_only else commands):
                            progress(stage+'…');job['stage']=stage
                            run_stage(args,self.workspace,self.root/(job['id']+'.log'),stage,target)
                    except Exception:
                        shutil.copytree(source,self.root/('failed-source-'+job['id']),dirs_exist_ok=True)
                        raise
                    art=self.root/(slug+'.webp')
                    with Image.open(source/'portrait_raw.png') as im:im.thumbnail((180,172));im.convert('RGB').save(art,'WEBP',quality=90)
                    row={'slug':slug,'name':info['name'],'short':info['short'],'target':target,'portrait':f'/api/imports/portraits/{slug}.webp','imported':True}
                    self.rows=[r for r in self.rows if r['slug']!=slug]
                    self.rows.append(row);atomic_write(self.index,(json.dumps(self.rows,indent=2)+'\n').encode());self.catalog[slug]=row
                job.update(state='complete',message='Character is ready.',fighter=row)
        except Exception as error:
            job.update(state='failed',message=str(error) if isinstance(error,ValueError) else 'Import failed. Check the local import log and try again.')
