#ifndef DIRECT_INTRIN_H
#define DIRECT_INTRIN_H
#include <stdint.h>
#define _byteswap_ulong __builtin_bswap32
#define _byteswap_ushort __builtin_bswap16
#define _byteswap_uint64 __builtin_bswap64
static inline unsigned char _BitScanReverse(unsigned long* out,unsigned long v){if(!v)return 0;*out=31-__builtin_clz(v);return 1;}
#endif
