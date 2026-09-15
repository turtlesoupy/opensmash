#ifndef OPENSMASH_DIRECT_HOST_COMPAT_H
#define OPENSMASH_DIRECT_HOST_COMPAT_H
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <unistd.h>
#include <emscripten.h>
#include <setjmp.h>
#define __jmp_buf melee_jmp_buf
typedef struct { int64_t QuadPart; } LARGE_INTEGER;
typedef int64_t LONGLONG;
static inline int QueryPerformanceFrequency(LARGE_INTEGER* p) { p->QuadPart=1000000; return 1; }
static inline int QueryPerformanceCounter(LARGE_INTEGER* p) { p->QuadPart=(int64_t)(emscripten_get_now()*1000); return 1; }
#define _stricmp strcasecmp
#define _strnicmp strncasecmp
#define _fseeki64 fseeko
#define _ftelli64 ftello
#define _stat64 stat
#define _S_IFREG S_IFREG
#define _S_IFDIR S_IFDIR
#define _mkdir(p) mkdir(p,0700)
#define _putenv _putenv_compat
static inline int _putenv_compat(const char* s) { return putenv(strdup(s)); }
#define MAX_PATH 4096
#define CreateDirectoryA(p,unused) (mkdir(p,0700)==0)
#define __declspec(x) __attribute__((x))
#endif
