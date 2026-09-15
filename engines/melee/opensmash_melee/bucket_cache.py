"""Private bucket-backed files. Local directories remain a disposable hot cache."""
import hashlib,io,json,tarfile
from pathlib import Path,PurePosixPath

class Store:
    def __init__(self,bucket=None,local=None):
        self.local=Path(local) if local else None
        if not self.local:
            from google.cloud import storage
            self.bucket=storage.Client().bucket(bucket)
    def get(self,key):
        if self.local:
            try:return (self.local/key).read_bytes()
            except FileNotFoundError:return None
        from google.api_core.exceptions import NotFound
        try:return self.bucket.blob(key).download_as_bytes()
        except NotFound:return None
    def put(self,key,raw):
        if self.local:
            path=self.local/key;path.parent.mkdir(parents=True,exist_ok=True)
            from .__main__ import atomic_write
            atomic_write(path,raw)
        else:self.bucket.blob(key).upload_from_string(raw,content_type='application/octet-stream')
    def keys(self,prefix):
        if self.local:return [p.relative_to(self.local).as_posix() for p in (self.local/prefix).rglob('*') if p.is_file()]
        return [b.name for b in self.bucket.list_blobs(prefix=prefix)]

def pack(root,paths):
    stream=io.BytesIO();root=Path(root)
    # Level 1 preserves the coarse bundle while avoiding costly maximum compression.
    with tarfile.open(fileobj=stream,mode='w:gz',compresslevel=1) as archive:
        for relative in paths:
            path=root/relative
            files=sorted(path.rglob('*')) if path.is_dir() else [path]
            for item in files:
                if item.is_file() and not item.is_symlink():archive.add(item,arcname=item.relative_to(root).as_posix(),recursive=False)
    return stream.getvalue()

def unpack(raw,destination):
    """Accept only regular files under the destination, including on Python 3.11."""
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        for entry in archive:
            rel=PurePosixPath(entry.name)
            if not entry.isfile() or rel.is_absolute() or '..' in rel.parts:raise ValueError('Invalid Melee cache archive')
            path=destination.joinpath(*rel.parts)
            if not path.resolve().is_relative_to(destination.resolve()):raise ValueError('Invalid Melee cache path')
            path.parent.mkdir(parents=True,exist_ok=True)
            from .__main__ import atomic_write
            atomic_write(path,archive.extractfile(entry).read())

class BucketAccess:
    """Independent owner grants avoid shared JSON read/modify/write races."""
    def __init__(self,store):self.store=store;self.known=set()
    def key(self,owner,resource):
        import re
        if not re.fullmatch('[a-f0-9]{64}',owner):raise ValueError('Invalid owner')
        return 'melee/owners/'+owner+'/'+hashlib.sha256(resource.encode()).hexdigest()+'.json'
    def allows(self,owner,resource):
        key=self.key(owner,resource)
        if key in self.known:return True
        if self.store.get(key) is not None:self.known.add(key);return True
        return False
    def grant(self,owner,resource):
        key=self.key(owner,resource)
        if key not in self.known:self.store.put(key,json.dumps(resource).encode());self.known.add(key)
    def resources(self,owner):
        self.key(owner,'')
        return [json.loads(self.store.get(key)) for key in self.store.keys('melee/owners/'+owner+'/')]
