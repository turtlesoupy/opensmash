#include "moderngekko/runtime.hpp"
#include "moderngekko/mod_abi.h"
#include <algorithm>
#include <cstdio>
#include <iterator>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <atomic>
#include <chrono>
#include <emscripten.h>
#include "VideoCommon/VideoEvents.h"
#include "Core/Config/MainSettings.h"
#include "Common/Config/Config.h"
#include "Core/Core.h"
#include "hook_index.h"
static BrowserHookIndex hook_index;
static std::atomic<unsigned> frame_count{0};
static std::atomic<unsigned> intervals[4096]{};
extern "C" int opensmash_destination_ready();
static bool combat_pacing_restored = false;
extern "C" EMSCRIPTEN_KEEPALIVE unsigned opensmash_frame_count() { return frame_count.load(); }
extern "C" EMSCRIPTEN_KEEPALIVE unsigned opensmash_frame_interval(unsigned n) { return intervals[n % 4096].load(); }

extern "C" const ModernGekkoModuleDesc* staticrecomp_get_module();
extern "C" const ModernGekkoModDesc* moderngekko_get_mod();
extern "C" bool opensmash_skinning(CPUState*);
// Generated regions chain through this table (tools/chain_browser_chunks.py).
extern "C" uint64_t* opensmash_chain_hook_bits;
static uint64_t chain_stop_bits[0x00400000u / 4 / 64];

int main(int argc, char** argv)
{
  moderngekko::RuntimeConfig config;
  config.game_root = argc > 1 ? argv[1] : "/game";
  config.user_directory = argc > 3 ? argv[3] : "/user";
  config.graphics.backend = argc > 2 ? argv[2] : "OGL";
  config.headless = config.graphics.backend == "Null";
  config.input.background_input = true;
  config.graphics.internal_resolution_scale = 1;
  config.show_fps_in_title = false;
  config.audio.backend = "Browser";
  config.module = moderngekko::ModuleSource::AttachedDescriptor(staticrecomp_get_module());
  const auto* mod = moderngekko_get_mod();
  setenv("OPENSMASH_MATCH", "1", 1);
  if (argc > 4) setenv("OPENSMASH_FIGHTER", argv[4], 1);
  if (argc > 5) setenv("OPENSMASH_VERIFIED_ASSET_IDENTITY", argv[5], 1);
  if (argc > 6 && std::string(argv[6]) != "0") {
    if (std::string(argv[6]) == "skin") setenv("OPENSMASH_SKIN_VERIFY", "1", 1);
    else setenv("MELEEPAD_FRAME_PHASE_LOG", "/tmp/frame-phases.csv", 1);
    if (std::string(argv[6]) == "dispatch") {
      setenv("STATICRECOMP_DISPATCH_TIME_LOG", "/tmp/dispatch.csv", 1);
      setenv("STATICRECOMP_DISPATCH_SAMPLE_INTERVAL", "1024", 1);
    }
  }
  if (argc > 7 && std::string(argv[7]) == "1") {
    setenv("OPENSMASH_STOCKS", "20", 1);
    setenv("OPENSMASH_P1_CPU", "1", 1);
  }
  if (argc > 8 && std::string(argv[8]) == "1") setenv("OPENSMASH_WAIT_SELECTION", "1", 1);
  mod->on_load(nullptr);
  hook_index.add(0x8036E83Cu);
  hook_index.add(0x80074048u);
  for (unsigned i = 0; i < mod->num_patches; ++i) hook_index.add(mod->patches[i].address);
  for (unsigned i = 0; i < mod->num_hooks; ++i) hook_index.add(mod->hooks[i].address);
  hook_index.finish();
  if (const uint64_t* bits = hook_index.dense_bits()) {
    std::copy(bits, bits + std::size(chain_stop_bits), chain_stop_bits);
    opensmash_chain_hook_bits = chain_stop_bits;  // the core adds idle-loop addresses
  }
  config.module.host_call_user = const_cast<ModernGekkoModDesc*>(mod);
  config.module.host_call = [](CPUState* state, unsigned address, void* user) {
    if (address == 0x8036E83Cu || address == 0x80074048u) return opensmash_skinning(state);
    const auto* desc = static_cast<ModernGekkoModDesc*>(user);
    if (hook_index.contains(address)) {
      for (unsigned i = 0; i < desc->num_patches; ++i)
        if (desc->patches[i].address == address) {
          desc->patches[i].function(state);
          return true;
        }
      for (unsigned i = 0; i < desc->num_hooks; ++i)
        if (desc->hooks[i].address == address) {
          CPUState saved = *state;
          desc->hooks[i].function(state);
          *state = saved;
        }
    }
    if (!combat_pacing_restored && opensmash_destination_ready()) {
      Core::SetIsThrottlerTempDisabled(false);
      combat_pacing_restored = true;
      std::fprintf(stderr, "[opensmash] normal destination pacing restored\n");
    }
    return false;
  };
  config.module.host_call_contains = [](unsigned address, void* user) {
    return hook_index.contains(address);
  };
  config.module.host_call_range_contains = [](unsigned begin, unsigned end, void* user) {
    return hook_index.intersects(begin, end);
  };
  std::error_code error;
  std::filesystem::create_directories(config.user_directory / "Config", error);
  if (error) { std::fprintf(stderr, "%s\n", error.message().c_str()); return 1; }
  const auto settings = config.user_directory / "Config/Dolphin.ini";
  if (!std::filesystem::exists(settings)) {
    std::ofstream file(settings);
    file << "[Core]\nCPUThread = True\nEnableCheats = False\n"
            "[DSP]\nBackend = Browser\n"
            "[Interface]\nConfirmStop = False\nOnScreenDisplayMessages = False\n";
  }
  {
    std::ofstream graphics(config.user_directory / "Config/GFX.ini");
    graphics << "[Settings]\nShaderCompilerThreads = 0\nShaderPrecompilerThreads = 0\n";
  }
  auto created = moderngekko::Runtime::Create(std::move(config));
  if (!created) { std::fprintf(stderr, "%s\n", created.error->message.c_str()); return 1; }
  // Local files do not need simulated optical-drive seek/transfer delays.
  Config::SetBase(Config::MAIN_FAST_DISC_SPEED, true);
  Core::SetIsThrottlerTempDisabled(true);
  auto previous = std::chrono::steady_clock::now();
  auto frame_hook = GetVideoEvents().after_frame_event.Register([&previous](Core::System&) {
    auto now = std::chrono::steady_clock::now();
    unsigned micros = std::chrono::duration_cast<std::chrono::microseconds>(now - previous).count();
    previous = now;
    unsigned n = frame_count.load();
    intervals[n % 4096].store(micros);
    frame_count.store(n + 1);
  });
  const auto result = created.runtime->Run();
  if (result.error) { std::fprintf(stderr, "%s\n", result.error->message.c_str()); return 1; }
  return 0;
}
