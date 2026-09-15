#include "../runtime/web/hook_index.h"
#include <cassert>

int main() {
  BrowserHookIndex empty;
  empty.finish();
  assert(!empty.contains(0x80000000u));
  assert(!empty.intersects(0, 0xffffffffu));
  BrowserHookIndex index;
  const std::vector<uint32_t> hooks{0x80000000u, 0x800000fcu, 0x80000100u,
    0x803ffffcu, 0x80400000u, 0x100u, 0xffffffffu, 0x80000001u, 0x80000100u};
  for (auto h : hooks) index.add(h);
  index.finish();
  // Check every instruction slot, including both bitmap boundaries and a hole
  // between adjacent words. Also retain exact lookup outside the dense region.
  for (uint32_t a = 0x7ffffffcu; a <= 0x80400004u; a += 4)
    assert(index.contains(a) == (std::find(hooks.begin(), hooks.end(), a) != hooks.end()));
  for (auto h : hooks) assert(index.contains(h));
  assert(!index.contains(0));
  assert(!index.contains(0x80000002u));
  assert(index.intersects(0x800000fcu, 0x80000100u));
  assert(!index.intersects(0x80000004u, 0x800000fcu));
  assert(!index.intersects(0x80000100u, 0x80000100u));
  assert(!index.intersects(0x80000104u, 0x80000100u));
  assert(index.intersects(0x803ffffcu, 0x80400001u));
}
