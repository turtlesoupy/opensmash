// Compare specialized entries with their retained generated originals.
#include "opensmash_entries_oracle.h"
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
static unsigned seed = 0x73114;
static unsigned rnd(void) {
  seed ^= seed << 13;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  return seed;
}
static u64 trace;
static void record(CPUState *c, u32 a, u64 v, u32 size) {
  trace = (trace ^ a ^ v ^ ((u64)size << 48)) * 1099511628211ull;
  const unsigned char *p = (const unsigned char *)c;
  for (unsigned i = 0; i < offsetof(CPUState, external_read); i++)
    trace = (trace ^ p[i]) * 1099511628211ull;
}
static u64 read_ext(CPUState *c, u32 a, u8 size) {
  record(c, a, 0, size);
  return ((u64)(a ^ 0x12345678) << 32) | (a ^ 0x87654321);
}
static void write_ext(CPUState *c, u32 a, u64 v, u8 size) {
  record(c, a, v, size);
}
static bool host(CPUState *c, u32 a) {
  record(c, a, 0, 99);
  return false;
}
static void fallback(CPUState *c, u32 raw, u32 cia) {
  record(c, cia, raw, 100);
}
static void journal(u32 a, u32 size, void *u) {
  record((CPUState *)u, a, 0, 200 + size);
}
int main(int argc, char **argv) {
  const unsigned total = sizeof(rows) / sizeof(rows[0]);
  const unsigned first = argc > 1 ? (unsigned)strtoul(argv[1], NULL, 10) : 0;
  const unsigned end = argc > 2 ? (unsigned)strtoul(argv[2], NULL, 10) : total;
  if (first >= end || end > total)
    return 2;
  unsigned char ra[65536], rb[65536], ea[65536], eb[65536];
  unsigned cases = 0;
  for (unsigned region = first; region < end; region++)
    for (unsigned entry = 0; entry < 256; entry++)
      for (unsigned scenario = 0; scenario < 14; scenario++) {
        CPUState a = {0}, b;
        for (unsigned i = 0; i < 65536; i++)
          ra[i] = ea[i] = (unsigned char)rnd();
        memcpy(rb, ra, 65536);
        memcpy(eb, ea, 65536);
        a.ram = ra;
        a.ram_size = 65536;
        a.exram = ea;
        a.exram_size = 65536;
        a.pc = rows[region].base + 4 * entry;
        a.lr = 0x80000000 | ((rnd() & 0x3ffffc));
        a.ctr = rnd() & 7;
        a.cr = rnd();
        a.xer = rnd();
        a.msr = (scenario == 0 || scenario == 13) ? 0 : PPC_MSR_FP;
        a.hid2 = scenario == 1 ? 0 : PPC_HID2_LSQE;
        a.fpscr = scenario == 12 ? rnd() : 0;
        a.downcount = 0;
        a.reserve_valid = (scenario & 1) || scenario == 10;
        a.exception = scenario == 11;
        a.reserve_addr = 0x80004000;
        for (unsigned i = 0; i < 32; i++) {
          a.gpr[i] = (scenario == 2                      ? 0xcc000000
                      : (scenario == 3 || scenario == 8) ? 0x90000000
                                                         : 0x80000000) |
                     (rnd() & 0xfffc);
          a.fpr[i] = (double)(int)rnd() / 65536;
          a.ps1[i] = (double)(int)rnd() / 32768;
        }
        if (scenario == 4)
          for (unsigned i = 0; i < 32; i++) {
            u64 bits = ((u64)rnd() << 32) | rnd();
            memcpy(&a.fpr[i], &bits, 8);
          }
        if (scenario == 5)
          for (unsigned i = 0; i < 8; i++)
            a.gqr[i] = rnd();
        a.external_read = read_ext;
        a.external_write = write_ext;
        a.host_call = host;
        a.instruction_fallback = fallback;
        b = a;
        b.ram = rb;
        b.exram = eb;
        g_mem_write_journal = scenario & 1 ? journal : NULL;
        trace = 0;
        g_mem_write_journal_user = &a;
        ppc_lazy_fp_set_enabled(scenario != 13);
        ppc_fpscr_updated(&a);
        rows[region].reference(&a);
        u64 expected = trace;
        trace = 0;
        g_mem_write_journal_user = &b;
        ppc_fpscr_updated(&b);
        rows[region].fast(&b);
        b.ram = ra;
        b.exram = ea;
        if (memcmp(&a, &b, sizeof(a)) || memcmp(ra, rb, 65536) ||
            memcmp(ea, eb, 65536) || expected != trace) {
          fprintf(stderr,
                  "mismatch region=%08x entry=%u scenario=%u trace=%llu/%llu\n",
                  rows[region].base, entry, scenario,
                  (unsigned long long)expected, (unsigned long long)trace);
          return 1;
        }
        cases++;
      }
  printf("{\"cases\":%u,\"fullCpu\":true,\"ramAndExram\":true,"
         "\"callbackStateAndOrder\":true}\n",
         cases);
  return 0;
}
