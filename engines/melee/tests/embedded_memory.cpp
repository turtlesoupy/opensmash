// Cross-platform shared mapping and keyboard pulse/reset checks.
#undef NDEBUG
#include "OpenSmashInput.h"
#include "OpenSmashLauncher.h"
#include <thread>
#include <cassert>
#include <fstream>
int main(int argc, char **argv) {
  if (argc != 2)
    return 2;
  {
    std::ofstream file(argv[1], std::ios::binary);
    std::array<char, 512> zeros{};
    file.write(zeros.data(), zeros.size());
  }
#ifdef _WIN32
  _putenv_s("OPENSMASH_INPUT_FILE", argv[1]);
#else
  setenv("OPENSMASH_INPUT_FILE", argv[1], 1);
#endif
  OpenSmashMemory::Mapping writer(argv[1], 512, true);
  auto *data = writer.data;
  assert(!OpenSmashInput::Key(38));
  OpenSmashMemory::Store(data + 128 + 38, 1);
  assert(OpenSmashInput::Key(38)); // preserve a brief press between polls
  assert(!OpenSmashInput::Key(38));
  OpenSmashMemory::Store(data + 38, 1);
  assert(OpenSmashInput::Key(38));
  assert(OpenSmashInput::Key(38)); // held keys stay held
  OpenSmashMemory::Store(data + 38, 0);
  OpenSmashMemory::Store(data + 128 + 38, 2);
  OpenSmashMemory::Store(data + 256, 1); // blur clears even an unread pulse
  assert(!OpenSmashInput::Key(38));
  assert(!OpenSmashInput::Key(128));
  const auto bridge=std::string(argv[1])+".launcher";
  std::array<unsigned char,80> packet{};
  packet[0]='O';packet[1]='S';packet[2]='I';packet[3]='1';packet[5]=1;
  packet[8]=3;packet[9]=1;packet[11]=1;packet[12]=176;packet[13]=255;
  const auto write=[&](){std::ofstream f(bridge,std::ios::binary);f.write(reinterpret_cast<const char*>(packet.data()),packet.size());};
  write();
#ifdef _WIN32
  _putenv_s("OPENSMASH_LAUNCHER_INPUT",bridge.c_str());
#else
  setenv("OPENSMASH_LAUNCHER_INPUT",bridge.c_str(),1);
#endif
  assert(OpenSmashLauncher::Read()[11]==1);
  assert(OpenSmashLauncher::Signed(OpenSmashLauncher::Read(),12)==-80);
  assert(!OpenSmashLauncher::Muted());
  packet[4]=1;packet[5]++;write();assert(OpenSmashLauncher::Muted());
  std::this_thread::sleep_for(std::chrono::milliseconds(550));
  assert(OpenSmashLauncher::Read()[9]==0); // stalled renderer releases controls
  return 0;
}
