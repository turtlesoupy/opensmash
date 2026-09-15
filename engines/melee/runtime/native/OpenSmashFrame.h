// Portable native presentation. Pixels stay local and uncompressed. A slot is
// not reused until Electron copies it; only one renderer message is in flight.
#pragma once
#include "OpenSmashMemory.h"
#include "VideoCommon/AbstractFramebuffer.h"
#include "VideoCommon/AbstractGfx.h"
#include "VideoCommon/AbstractStagingTexture.h"
#include "VideoCommon/AbstractTexture.h"
#include <cstring>
#include <memory>
namespace OpenSmashFrame {
inline bool Enabled() { return std::getenv("OPENSMASH_FRAME_FILE") != nullptr; }
constexpr unsigned Width = 960, Height = 720, Bytes = Width * Height * 4,
                   SlotSize = Bytes + 64;
class Output {
  std::unique_ptr<OpenSmashMemory::Mapping> memory;
  std::unique_ptr<AbstractTexture> texture;
  std::unique_ptr<AbstractStagingTexture> staging;
  std::unique_ptr<AbstractFramebuffer> framebuffer;
  unsigned char *current = nullptr;
  uint32_t sequence = 0;

public:
  bool Bind(AbstractGfx &gfx, const ClearColor &clear) {
    if (!memory) {
      memory = std::make_unique<OpenSmashMemory::Mapping>(
          OpenSmashMemory::EnvironmentPath("OPENSMASH_FRAME_FILE").c_str(), 3 * SlotSize, true);
      TextureConfig config(Width, Height, 1, 1, 1, AbstractTextureFormat::RGBA8,
                           AbstractTextureFlag_RenderTarget,
                           AbstractTextureType::Texture_2DArray);
      texture = gfx.CreateTexture(config, "Electron backbuffer");
      staging = gfx.CreateStagingTexture(StagingTextureType::Readback, config);
      if (!texture || !staging) {
        std::fprintf(stderr, "Cannot create Electron backbuffer\n");
        std::abort();
      }
      framebuffer = gfx.CreateFramebuffer(texture.get(), nullptr, {});
      if (!framebuffer) {
        std::fprintf(stderr, "Cannot create Electron framebuffer\n");
        std::abort();
      }
    }
    current = nullptr;
    for (unsigned i = 0; i < 3; i++) {
      auto *slot = memory->data + i * SlotSize;
      if (OpenSmashMemory::Load(slot) == 0) {
        current = slot;
        break;
      }
    }
    if (!current)
      return false;
    gfx.SetAndClearFramebuffer(framebuffer.get(), clear);
    return true;
  }
  void Present() {
    if (!current)
      return;
    staging->CopyFromTexture(texture.get());
    staging->ReadTexels(staging->GetRect(), current + 64, Width * 4);
    ++sequence;
    std::memcpy(current + 4, &sequence, sizeof(sequence));
    OpenSmashMemory::Store(current, 1);
    current = nullptr;
  }
};
} // namespace OpenSmashFrame
