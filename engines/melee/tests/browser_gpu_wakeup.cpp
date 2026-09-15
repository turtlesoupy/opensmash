#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdio>
#include <thread>
#include "Common/BlockingLoop.h"
using namespace std::chrono_literals;
int main() {
  unsigned notifications = 0;
  for (unsigned round = 0; round < 20; ++round) {
    Common::BlockingLoop loop;
    std::atomic<unsigned> sent[2]{}, seen[2]{};
    std::atomic<unsigned> unnotified{}, observed{};
    loop.Prepare();
    std::thread worker([&] {
      loop.Run([&, idle_polls = 0u]() mutable {
        if (loop.IsIdleButAwake() && (++idle_polls & 63u) != 0) return;
        idle_polls = 0;
        for (unsigned i = 0; i < 2; ++i) seen[i].store(sent[i].load());
        observed.store(unnotified.load());
      }, 5);
    });
    loop.Wait();
    auto produce = [&](unsigned slot) {
      for (unsigned group = 0; group < 50; ++group) {
        for (unsigned i = 0; i < 100; ++i) {
          sent[slot].fetch_add(1);
          loop.Wakeup();
        }
        loop.Wait();
        assert(seen[slot].load() == sent[slot].load());
      }
    };
    std::thread a(produce, 0), b(produce, 1);
    a.join(); b.join();
    notifications += sent[0].load() + sent[1].load();
    // A timeout must still check state even without a corresponding Wakeup.
    loop.Wait();
    unnotified.store(1);
    const auto deadline = std::chrono::steady_clock::now() + 1s;
    while (!observed.load() && std::chrono::steady_clock::now() < deadline)
      std::this_thread::sleep_for(1ms);
    assert(observed.load() == 1);
    loop.Stop();
    worker.join();
    loop.Wait();
  }
  std::printf("%u wakeups and 20 timed checks passed\n", notifications);
}
