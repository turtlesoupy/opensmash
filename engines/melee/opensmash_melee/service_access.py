"""Owner grants for the private hosted converter; paths never imply ownership."""
import json,re,threading
from pathlib import Path
from .__main__ import atomic_write
class Access:
    def __init__(self,path):
        self.path=Path(path);self.lock=threading.RLock()
        self.grants=json.loads(self.path.read_text()) if self.path.exists() else {}
    def allows(self,owner,key):
        with self.lock:return owner in self.grants.get(key,[])
    def grant(self,owner,key):
        if not re.fullmatch('[a-f0-9]{64}',owner):raise ValueError('Invalid owner')
        with self.lock:
            owners=set(self.grants.get(key,[]));owners.add(owner);self.grants[key]=sorted(owners)
            atomic_write(self.path,(json.dumps(self.grants)+'\n').encode())

def route_allowed(method,path):
    if method in ('GET','HEAD'):
        return bool(re.fullmatch(r'/api/native-fit/assets/[a-f0-9]{64}/sources/[a-z0-9_-]+\.(?:json|rgba8|identity\.dat)|/engine/[a-zA-Z0-9_./-]+|/api/(costume|announcer)/[a-zA-Z0-9_-]+|/api/imports(/[a-f0-9]+|/portraits/import-[a-f0-9]{24}\.webp)?|/api/character-select/[a-f0-9]{64}/[0-3]\.bin',path))
    return method=='POST' and bool(re.fullmatch(r'/api/(imports|character-select|native-fit/source/[a-z0-9_-]+|prepare/[a-zA-Z0-9_-]+)',path))
