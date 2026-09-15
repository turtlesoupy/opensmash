#include "moderngekko/mod_loader.hpp"
#undef NDEBUG
#include <cassert>
#include <cstring>

namespace {
int entries = 0, returns = 0, starts = 0;
void Patch(CPUState* state) { moderngekko_mod_return_u32(state, 77); }
void Entry(CPUState* state) { ++entries; state->gpr[3] = 999; }
void Return(CPUState* state) { ++returns; state->gpr[3] = 999; }
void Start(CPUState*) { ++starts; }
}

int main() {
  const ModernGekkoModPatch patches[] = {RECOMP_PATCH(0x80002000u, Patch)};
  const ModernGekkoModHook hooks[] = {
      RECOMP_HOOK(0x80003000u, Entry), RECOMP_HOOK_RETURN(0x80003000u, Return)};
  const ModernGekkoModCallback callbacks[] = {RECOMP_CALLBACK("*", "runtime_start", Start)};
  ModernGekkoModDesc mod{};
  mod.abi_version = MODERNGEKKO_MOD_ABI_VERSION;
  mod.cpu_abi_version = MODERNGEKKO_CPU_ABI_VERSION;
  mod.cpu_state_size = sizeof(CPUState);
  std::memcpy(mod.game_id, "TEST01", 7);
  mod.id = "dispatch_test"; mod.version = "1.0.0"; mod.display_name = "Dispatch test";
  mod.patches = patches; mod.num_patches = 1;
  mod.hooks = hooks; mod.num_hooks = 2;
  mod.callbacks = callbacks; mod.num_callbacks = 1;
  moderngekko::ModManager manager;
  auto load = [&] { return manager.Load({moderngekko::ModSource::AttachedDescriptor(&mod)}, "TEST01"); };
  assert(load());
  CPUState state{};
  state.lr = 0x80004000u; state.gpr[1] = 0x81000000u; state.gpr[3] = 5;
  // An ordinary call must still trigger runtime_start exactly once.
  assert(manager.HandlesAddress(0x80008000u));
  assert(!manager.HandlesRange(0x80008000u, 0x80008004u));
  assert(!manager.Dispatch(&state, 0x80008000u));
  assert(!manager.HandlesAddress(0x80008000u));
  assert(starts == 1);
  assert(manager.HandlesAddress(0x80002000u));
  assert(manager.Dispatch(&state, 0x80002000u));
  assert(state.gpr[3] == 77 && state.pc == state.lr);
  // Filter collisions must never become false hook hits.
  assert(!manager.HandlesAddress(0x80042000u));
  assert(!manager.Dispatch(&state, 0x80042000u));
  assert(!manager.HandlesAddress(0x80002001u));
  assert(!manager.Dispatch(&state, 0x80003000u));
  assert(entries == 1 && state.gpr[3] == 77);
  assert(manager.HandlesAddress(state.lr));
  // A return hook only runs for the matching stack frame.
  state.gpr[1] -= 16;
  assert(!manager.Dispatch(&state, state.lr));
  assert(returns == 0 && manager.HandlesAddress(state.lr));
  state.gpr[1] += 16;
  assert(!manager.Dispatch(&state, state.lr));
  assert(returns == 1 && state.gpr[3] == 77);
  assert(!manager.HandlesAddress(state.lr));
  manager.Unload();
  assert(!manager.HandlesAddress(0x80002000u));
  assert(!manager.HandlesAddress(0x80003000u));
  assert(load());
  assert(manager.Dispatch(&state, 0x80002000u));
  assert(starts == 2);
}
