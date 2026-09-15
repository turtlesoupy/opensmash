#include "StaticRecompBackend.h"

// Windows offline sessions choose JIT when the runtime supplies one.
static_assert(UseJitForNativeGame(true, true, false, false, ""));
static_assert(!UseJitForNativeGame(false, true, false, false, ""));
static_assert(!UseJitForNativeGame(true, false, false, false, ""));
static_assert(!UseJitForNativeGame(true, true, true, false, ""));
static_assert(!UseJitForNativeGame(true, true, false, true, ""));
static_assert(!UseJitForNativeGame(true, true, false, false, "static"));
static_assert(!UseJitForNativeGame(true, true, false, false, "invalid"));
static_assert(UseJitForNativeGame(false, true, false, false, "jit"));
// An explicit override must never bypass parity or availability guards.
static_assert(!UseJitForNativeGame(true, false, false, false, "jit"));
static_assert(!UseJitForNativeGame(true, true, true, false, "jit"));
static_assert(!UseJitForNativeGame(true, true, false, true, "jit"));
constexpr int wrapper = 1, fallback = 2, other = 3;
static_assert(SelectJitProfilingTarget(&wrapper, &wrapper, &fallback) == &fallback);
static_assert(SelectJitProfilingTarget(&other, &wrapper, &fallback) == &other);
static_assert(SelectJitProfilingTarget(&wrapper, &wrapper, static_cast<const int*>(nullptr)) == &wrapper);
int main() {}
