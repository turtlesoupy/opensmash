#pragma once
#include "InputCommon/ControllerInterface/CoreDevice.h"
#include "OpenSmashInput.h"
namespace OpenSmashInput {
class Keyboard final : public ciface::Core::Device {
  class KeyInput final : public Input {
    std::string name;
    unsigned code;

  public:
    KeyInput(const char *label, unsigned value) : name(label), code(value) {}
    std::string GetName() const override { return name; }
    ControlState GetState() const override { return Key(code) ? 1.0 : 0.0; }
  };

public:
  Keyboard() {
    // Every rebindable key (letters, digits, Return, Space, arrows) by macOS
    // virtual keycode, matching the desktop surface's DOM code table.
    for (auto entry : {std::pair{"A", 0u},
                       {"S", 1u},
                       {"D", 2u},
                       {"F", 3u},
                       {"H", 4u},
                       {"G", 5u},
                       {"Z", 6u},
                       {"X", 7u},
                       {"C", 8u},
                       {"V", 9u},
                       {"B", 11u},
                       {"Q", 12u},
                       {"W", 13u},
                       {"E", 14u},
                       {"R", 15u},
                       {"Y", 16u},
                       {"T", 17u},
                       {"1", 18u},
                       {"2", 19u},
                       {"3", 20u},
                       {"4", 21u},
                       {"6", 22u},
                       {"5", 23u},
                       {"9", 25u},
                       {"7", 26u},
                       {"8", 28u},
                       {"0", 29u},
                       {"O", 31u},
                       {"U", 32u},
                       {"I", 34u},
                       {"P", 35u},
                       {"Return", 36u},
                       {"L", 37u},
                       {"J", 38u},
                       {"K", 40u},
                       {"N", 45u},
                       {"M", 46u},
                       {"Space", 49u},
                       {"Left Arrow", 123u},
                       {"Right Arrow", 124u},
                       {"Down Arrow", 125u},
                       {"Up Arrow", 126u}})
      AddInput(new KeyInput(entry.first, entry.second));
  }
  std::string GetName() const override { return "Keyboard"; }
  std::string GetSource() const override { return "OpenSmash"; }
};
} // namespace OpenSmashInput
