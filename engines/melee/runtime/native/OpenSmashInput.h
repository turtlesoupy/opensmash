#pragma once
#include "OpenSmashMemory.h"
#include <array>
#include <mutex>
namespace OpenSmashInput {
inline bool Enabled() { return std::getenv("OPENSMASH_INPUT_FILE") != nullptr; }
inline bool Key(unsigned code) {
  static std::mutex mutex;
  std::lock_guard lock(mutex);
  static OpenSmashMemory::Mapping mapping(OpenSmashMemory::EnvironmentPath("OPENSMASH_INPUT_FILE").c_str(),
                                          512, false);
  const auto *keys = mapping.data;
  if (code >= 128)
    return false;
  static auto snapshot = [] {
    std::array<unsigned char, 128> result{};
    for (unsigned i = 0; i < 128; i++)
      result[i] = OpenSmashMemory::Load(mapping.data + 128 + i);
    return result;
  };
  static auto seen = snapshot();
  static auto epoch = OpenSmashMemory::Load(mapping.data + 256);
  auto currentEpoch = OpenSmashMemory::Load(keys + 256);
  if (epoch != currentEpoch) {
    seen = snapshot();
    epoch = currentEpoch;
  }
  auto sequence = OpenSmashMemory::Load(keys + 128 + code);
  bool pending = seen[code] != sequence;
  seen[code] = sequence;
  return pending || OpenSmashMemory::Load(keys + code);
}
} // namespace OpenSmashInput
