"""Verify the portable SHA-1 implementation and pitch-preserving audio adapter dependency."""
import ctypes,hashlib,json,subprocess,tempfile
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
PORT=ROOT/'runtime/direct-c'
def main():
 with tempfile.TemporaryDirectory() as tmp:
  tmp=Path(tmp);source=tmp/'check.c';library=tmp/'check.so'
  source.write_text('#include <mbedtls/sha256.h>\nvoid mbedtls_platform_zeroize(void* p,size_t n){volatile unsigned char* b=p;while(n--)*b++=0;}\nvoid check_sha256(const unsigned char* p,size_t n,unsigned char* out){mbedtls_sha256_context c;mbedtls_sha256_init(&c);mbedtls_sha256_starts_ret(&c,0);while(n){size_t k=n<53?n:53;mbedtls_sha256_update_ret(&c,p,k);p+=k;n-=k;}mbedtls_sha256_finish_ret(&c,out);mbedtls_sha256_free(&c);}\n#include '+json.dumps(str(PORT/'include/sha1.h'))+'\nvoid check_sha(const unsigned char* p,size_t n,unsigned char* out){direct_sha1(p,n,out);}\n')
  subprocess.run(['clang','-O2','-shared','-fPIC',str(source),'-I'+str(PORT/'vendor/mbedtls'),str(PORT/'vendor/mbedtls/sha256.c'),str(PORT/'vendor/sonic/sonic.c'),'-lm','-o',str(library)],check=True)
  lib=ctypes.CDLL(str(library));lib.check_sha.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p]
  vectors=[b'',b'abc',b'a'*55,b'a'*56,b'a'*64,b'a'*1000000]
  for value in vectors:
   output=ctypes.create_string_buffer(20);lib.check_sha(value,len(value),output);assert output.raw==hashlib.sha1(value).digest()
  lib.check_sha256.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p]
  for value in vectors:
   output=ctypes.create_string_buffer(32);lib.check_sha256(value,len(value),output);assert output.raw==hashlib.sha256(value).digest()
  lib.sonicCreateStream.argtypes=[ctypes.c_int,ctypes.c_int];lib.sonicCreateStream.restype=ctypes.c_void_p
  lib.sonicSetSpeed.argtypes=[ctypes.c_void_p,ctypes.c_float]
  lib.sonicWriteShortToStream.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int]
  lib.sonicReadShortFromStream.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int]
  lib.sonicFlushStream.argtypes=[ctypes.c_void_p];lib.sonicDestroyStream.argtypes=[ctypes.c_void_p]
  rate=32000;n=rate*2;t=np.arange(n)/rate;signal=np.column_stack([np.sin(2*np.pi*f*t) for f in (440,660)]);signal=np.asarray(signal*12000,dtype=np.int16)
  reports=[]
  for speed in (.9,1.,1.05):
   stream=lib.sonicCreateStream(rate,2);assert stream;lib.sonicSetSpeed(stream,speed)
   for start in range(0,n,160):assert lib.sonicWriteShortToStream(stream,signal[start:].ctypes.data,min(160,n-start))
   assert lib.sonicFlushStream(stream);output=np.empty((int(n/speed)+rate,2),dtype=np.int16)
   count=lib.sonicReadShortFromStream(stream,output.ctypes.data,len(output));lib.sonicDestroyStream(stream)
   assert abs(count-n/speed)<rate*.03
   crop=output[rate//4:count-rate//4].astype(float);frequencies=np.fft.rfftfreq(len(crop),1/rate)
   peaks=[float(frequencies[np.argmax(abs(np.fft.rfft(crop[:,c]*np.hanning(len(crop)))))]) for c in range(2)]
   assert all(abs(a-b)<3 for a,b in zip(peaks,(440,660)))
   reports.append(dict(speed=speed,inputFrames=n,outputFrames=count,peakFrequencies=peaks))
  report=dict(sha1Vectors=len(vectors),sha256Vectors=len(vectors),audio=reports,passed=True);out=ROOT/'build/direct-c/support-check.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
