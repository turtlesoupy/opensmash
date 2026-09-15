"""Validate an uncompressed Melee 1.02 disc against published identifiers."""
import hashlib
from pathlib import Path
import struct
import zlib

KNOWN_MD5='0e63d4223b01d9aba596259dc155a174'
KNOWN_SIZE=1459978240
SOURCES=['https://github.com/UnclePunch/Training-Mode',
         'https://github.com/akaneia/akaneia-build']


def validate_iso(path):
    path=Path(path).resolve()
    before=path.stat()
    hashes={name:hashlib.new(name) for name in ('md5','sha1','sha256')}
    crc=0
    with path.open('rb') as f:
        header=f.read(0x440)
        if len(header)!=0x440 or struct.unpack_from('>I',header,0x1c)[0]!=0xc2339f3d:
            raise ValueError('Not an uncompressed GameCube disc image')
        f.seek(0)
        while chunk:=f.read(8*1024*1024):
            for h in hashes.values(): h.update(chunk)
            crc=zlib.crc32(chunk,crc)
    after=path.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
        raise ValueError('Disc changed during hashing')
    result=dict(path=str(path),size=before.st_size,game_id=header[:6].decode('ascii'),
                revision=header[7],crc32=f'{crc:08x}',**{name:h.hexdigest() for name,h in hashes.items()})
    result['known_md5_match']=result['md5']==KNOWN_MD5
    result['expected_md5']=KNOWN_MD5
    result['known_md5_sources']=SOURCES
    result['sha1_reference_match']=None  # Recorded fingerprint, no fetched reference.
    result['valid_for_project']=(result['known_md5_match'] and result['size']==KNOWN_SIZE
                                 and result['game_id']=='GALE01' and result['revision']==2)
    return result
