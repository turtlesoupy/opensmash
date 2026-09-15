#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <vector>

// Dense instruction membership for Melee's text, with a sorted fallback for
// other addresses. Build once before the emulation thread starts; then read only.
class BrowserHookIndex {
  static constexpr uint32_t base = 0x80000000u, size = 0x00400000u;
  std::array<uint64_t, size / 4 / 64> bits{};
  std::vector<uint32_t> addresses;
  bool dense = true;
public:
  void add(uint32_t address) {
    addresses.push_back(address);
    const uint32_t offset = address - base;
    if (offset < size && !(offset & 3)) bits[offset / 256] |= uint64_t{1} << ((offset / 4) % 64);
    else dense = false;
  }
  // The dense table alone, when it answers contains() for every registered
  // address; null otherwise so callers fall back to the full lookup.
  const uint64_t* dense_bits() const { return dense ? bits.data() : nullptr; }
  void finish() {
    std::sort(addresses.begin(), addresses.end());
    addresses.erase(std::unique(addresses.begin(), addresses.end()), addresses.end());
  }
  bool contains(uint32_t address) const {
    const uint32_t offset = address - base;
    if (offset < size && !(offset & 3)) return (bits[offset / 256] >> ((offset / 4) % 64)) & 1;
    return !addresses.empty() && address >= addresses.front() && address <= addresses.back() &&
      std::binary_search(addresses.begin(), addresses.end(), address);
  }
  bool intersects(uint32_t begin, uint32_t end) const {
    const auto entry = std::lower_bound(addresses.begin(), addresses.end(), begin);
    return entry != addresses.end() && *entry < end;
  }
};
