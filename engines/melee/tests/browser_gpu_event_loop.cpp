// Regressions: omitted pthread entry frames lose arguments during rewind;
// blocking the worker prevents transferred-frame release callbacks from running.
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <emscripten.h>
#include <pthread.h>

struct Payload
{
  unsigned marker;
  unsigned completed;
};

__attribute__((noinline)) static void RunBatches(Payload* payload)
{
  assert(payload->marker == 0xC0FFEE);
  const char* sdl_async = std::getenv("SDL_EMSCRIPTEN_ASYNCIFY");
  assert(sdl_async && std::strcmp(sdl_async, "0") == 0);
  for (unsigned i = 0; i < 20; ++i)
  {
    EM_ASM({
      setTimeout(() => {
        globalThis.releasedFrames = (globalThis.releasedFrames || 0) + 1;
      }, 0);
    });
    emscripten_sleep(1);
    assert(EM_ASM_INT({ return globalThis.releasedFrames || 0; }) == i + 1);
    ++payload->completed;
  }
}

static void* ThreadMain(void* argument)
{
  RunBatches(static_cast<Payload*>(argument));
  return nullptr;
}

int main()
{
  Payload payload{0xC0FFEE, 0};
  pthread_t thread;
  assert(pthread_create(&thread, nullptr, ThreadMain, &payload) == 0);
  void* result = nullptr;
  assert(pthread_join(thread, &result) == 0);
  assert(result == nullptr && payload.completed == 20);
  std::puts("20 worker callbacks, preserved arguments, SDL mode and joined shutdown passed");
}
