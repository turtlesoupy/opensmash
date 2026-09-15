// One chained dispatch must equal the run loop's sequence of single-region
// dispatches under the same continuation rule (tools/chain_browser_chunks.py).
#include "opensmash_chain.h"
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
static unsigned seed = 0x5eed1;
static unsigned rnd(void) {
  seed ^= seed << 13;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  return seed;
}
static u64 trace;
static void record(CPUState *c, u32 a, u64 v, u32 size) {
  trace = (trace ^ a ^ v ^ ((u64)size << 48)) * 1099511628211ull;
  // Registers and control state; the locked-cache tags are compared at the end.
  const unsigned char *p = (const unsigned char *)c;
  for (unsigned i = 0; i < offsetof(CPUState, locked_cache_tag); i++)
    trace = (trace ^ p[i]) * 1099511628211ull;
}
static u64 read_ext(CPUState *c, u32 a, u8 size) {
  record(c, a, 0, size);
  return ((u64)(a ^ 0x12345678) << 32) | (a ^ 0x87654321);
}
static void write_ext(CPUState *c, u32 a, u64 v, u8 size) { record(c, a, v, size); }
static void fallback(CPUState *c, u32 raw, u32 cia) { record(c, cia, raw, 100); }
static void journal(u32 a, u32 size, void *u) { record((CPUState *)u, a, 0, 200 + size); }
static u64 hook_bits[0x00400000u / 4 / 64];
static u8 chunk_state[OPENSMASH_CHAIN_CHUNKS];
static u8 chunk_forced[OPENSMASH_CHAIN_CHUNKS];
// Actual Melee call/return into OSGetTime: exercise static and dynamic chains,
// every sub-tick remainder, and the low-word rollover read through mftbu/mftb.
static unsigned check_timebase(void) {
  static u8 ram[65536];
  unsigned cases = 0;
  memset(chunk_state, 1, sizeof(chunk_state));
  memset(chunk_forced, 0, sizeof(chunk_forced));
  memset(hook_bits, 0, sizeof(hook_bits));
  const u32 stop = 0x8001C904u - 0x80000000u;
  hook_bits[stop >> 8] |= (u64)1 << ((stop >> 2) & 63);
  opensmash_chain_hook_bits = hook_bits;
  opensmash_chain_chunk_state = chunk_state;
  opensmash_chain_chunk_forced = chunk_forced;
  for (unsigned dynamic = 0; dynamic < 2; ++dynamic)
    for (unsigned rollover = 0; rollover < 2; ++rollover)
      for (unsigned remainder = 0; remainder < 12; ++remainder) {
        CPUState a = {0}, b;
        a.ram = ram;
        a.ram_size = sizeof(ram);
        a.pc = dynamic ? 0x8001C54Cu : 0x8001C900u;
        a.lr = 0x8034C3F0u;
        a.timebase = rollover ? 0xFFFFFFFFull : 100;
        b = a;
        opensmash_chain_tb_base = a.timebase;
        opensmash_chain_tb_cycles = remainder;
        opensmash_chain_budget = dynamic ? 2 : 256;
        opensmash_chain_mark = 0;
        opensmash_chain_ctx = &a;
        if (!dolrecomp_call_original(&a, a.pc)) abort();
        opensmash_chain_ctx = NULL;
        if (!dolrecomp_call_original(&b, b.pc)) abort();
        // Independently model RunImpl's post-dispatch charge and TB update.
        const u64 charge = b.downcount < 0 ? (u64)-b.downcount : 1;
        b.downcount = 0;
        b.timebase += (remainder + charge) / 12;
        if (!dolrecomp_call_original(&b, b.pc)) abort();
        if (a.pc != b.pc || a.gpr[3] != b.gpr[3] || a.gpr[4] != b.gpr[4] ||
            a.gpr[5] != b.gpr[5] || (u64)-a.downcount != charge + (u64)-b.downcount) {
          fprintf(stderr, "timebase mismatch dynamic=%u rollover=%u remainder=%u r4=%u/%u\n",
                  dynamic, rollover, remainder, a.gpr[4], b.gpr[4]);
          return 0;
        }
        ++cases;
      }
  return cases;
}

int main(int argc, char **argv) {
  const unsigned total = OPENSMASH_CHAIN_CHUNKS;
  const unsigned first = argc > 1 ? (unsigned)strtoul(argv[1], NULL, 10) : 0;
  const unsigned end = argc > 2 ? (unsigned)strtoul(argv[2], NULL, 10) : total;
  if (first >= end || end > total)
    return 2;
  if (opensmash_chain_chunk_count != total)
    return 3;
  const unsigned timebase_cases = check_timebase();
  if (timebase_cases != 48) return 7;
  static unsigned char ra[65536], rb[65536], ea[65536], eb[65536];
  unsigned cases = 0, chained = 0, longest = 0;
  double chained_ms = 0, unchained_ms = 0;
  for (unsigned region = first; region < end; region++)
    for (unsigned entry = 0; entry < 4; entry++)
      for (unsigned scenario = 0; scenario < 6; scenario++) {
        const u32 base = opensmash_chain_chunk_base[region];
        const u32 limit = region + 1 < total ? opensmash_chain_chunk_base[region + 1] : base + 0x100;
        CPUState a = {0}, b;
        for (unsigned i = 0; i < 65536; i++)
          ra[i] = ea[i] = (unsigned char)rnd();
        memcpy(rb, ra, 65536);
        memcpy(eb, ea, 65536);
        a.ram = ra;
        a.ram_size = 65536;
        a.exram = ea;
        a.exram_size = 65536;
        a.pc = base + 4 * (rnd() % ((limit - base) / 4));
        // Short regions before a gap: keep the entry inside generated code.
        if (opensmash_chain_index(a.pc) != (int)region)
          a.pc = base;
        a.lr = 0x80000000 | (rnd() & 0x3ffffc);
        a.ctr = scenario == 4 ? 0x80000000 | (rnd() & 0x3ffffc) : rnd() & 7;
        a.cr = rnd();
        a.xer = rnd();
        a.msr = (scenario == 0 ? 0 : PPC_MSR_FP) | ((scenario == 3 || (rnd() & 1)) ? 0x8000u : 0u);
        a.hid2 = scenario == 1 ? 0 : PPC_HID2_LSQE;
        a.fpscr = scenario == 4 ? rnd() : 0;
        a.downcount = scenario == 5 ? -(s64)DOLRECOMP_C_LOOP_CYCLE_BUDGET + (s64)(rnd() % 64) : 0;
        a.reserve_valid = scenario & 1;
        a.reserve_addr = 0x80004000;
        for (unsigned i = 0; i < 32; i++) {
          a.gpr[i] = (scenario == 2 ? 0xcc000000 : scenario == 3 ? 0x90000000 : 0x80000000) |
                     (rnd() & 0xfffc);
          a.fpr[i] = (double)(int)rnd() / 65536;
          a.ps1[i] = (double)(int)rnd() / 32768;
        }
        for (unsigned i = 0; i < 8; i++)
          a.gqr[i] = scenario == 4 ? rnd() : 0;
        a.external_read = read_ext;
        a.external_write = write_ext;
        a.instruction_fallback = fallback;
        // Sparse host-call addresses and a few unverified/failed regions.
        memset(hook_bits, 0, sizeof(hook_bits));
        for (unsigned i = 0; i < 64; i++) {
          u32 offset = rnd() & 0x3ffffc;
          hook_bits[offset >> 8] |= (u64)1 << ((offset >> 2) & 63);
        }
        for (unsigned i = 0; i < total; i++) {
          chunk_state[i] = (rnd() & 63) ? 1 : (rnd() & 1) ? 0 : 2;
          chunk_forced[i] = (rnd() & 127) == 0;
        }
        const u64 tb_base = 0xFFFFFFF0ull;
        const u64 tb_cycles = 1024 + (rnd() & 31);
        a.timebase = tb_base + (tb_cycles - (u64)a.downcount) / 12;
        b = a;
        b.ram = rb;
        b.exram = eb;
        g_mem_write_journal = scenario & 1 ? journal : NULL;
        opensmash_chain_hook_bits = hook_bits;
        opensmash_chain_budget = 128 + (s64)(rnd() & 127);
        opensmash_chain_chunk_state = chunk_state;
        opensmash_chain_chunk_forced = chunk_forced;
        // Chained: one run-loop dispatch.
        trace = 0;
        g_mem_write_journal_user = &a;
        ppc_fpscr_updated(&a);
        opensmash_chain_ctx = &a;
        opensmash_chain_mark = a.downcount;
        opensmash_chain_tb_base = tb_base;
        opensmash_chain_tb_cycles = tb_cycles;
        double t0 = emscripten_get_now();
        if (!dolrecomp_call_original(&a, a.pc))
          return 4;
        chained_ms += emscripten_get_now() - t0;
        opensmash_chain_ctx = NULL;
        u64 expected = trace;
        // Unchained: repeat single-region dispatches while the run loop would.
        trace = 0;
        g_mem_write_journal_user = &b;
        ppc_fpscr_updated(&b);
        unsigned steps = 0;
        s64 mark = b.downcount;
        u64 reference_tb_cycles = tb_cycles - (u64)b.downcount;
        double t1 = emscripten_get_now();
        for (;;) {
          opensmash_chain_last = 0xFFFFFFFFu;
          if (!dolrecomp_call_original(&b, b.pc))
            return 5;
          if (++steps > 4096) {
            fprintf(stderr, "runaway chain region=%08x pc=%08x scenario=%u\n", base, a.pc, scenario);
            return 6;
          }
          const u32 target = opensmash_chain_last;
          if (target == 0xFFFFFFFFu || target != b.pc)
            break;
          // The run loop charges at least one cycle per region transfer.
          if (b.downcount == mark)
            b.downcount -= 1;
          reference_tb_cycles += (u64)(mark - b.downcount);
          mark = b.downcount;
          if (!opensmash_chain_would(&b, target, opensmash_chain_index(target)))
            break;
          if (!dolrecomp_find_original(target))
            break;
          b.timebase = tb_base + reference_tb_cycles / 12;
        }
        unchained_ms += emscripten_get_now() - t1;
        if (steps > 1)
          chained++;
        if (steps > longest)
          longest = steps;
        b.ram = ra;
        b.exram = ea;
        if (memcmp(&a, &b, sizeof(a)) || memcmp(ra, rb, 65536) || memcmp(ea, eb, 65536) ||
            expected != trace) {
          fprintf(stderr, "mismatch region=%08x pc=%08x scenario=%u steps=%u trace=%llu/%llu\n",
                  base, a.pc, scenario, steps, (unsigned long long)expected,
                  (unsigned long long)trace);
          return 1;
        }
        cases++;
      }
  printf("{\"timebaseCases\":%u,\"cases\":%u,\"chainedCases\":%u,\"longestChain\":%u,\"chainedMs\":%.1f,\"unchainedMs\":%.1f}\n",
         timebase_cases, cases, chained, longest, chained_ms, unchained_ms);
  return 0;
}
