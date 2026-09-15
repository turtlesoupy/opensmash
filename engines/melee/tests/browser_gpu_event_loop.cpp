// Regressions: omitted pthread entry frames lose arguments during rewind;
// blocking the worker prevents transferred-frame release callbacks from running.
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <emscripten.h>
#include <pthread.h>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>

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

static void* FileThread(void* path)
{
  int file = open(static_cast<const char*>(path), O_CREAT | O_RDWR, 0600);
  assert(file >= 0 && write(file, "saved", 5) == 5);
  assert(fsync(file) == 0 && fsync(file) == 0);
  assert(lseek(file, 0, SEEK_SET) == 0);
  char saved[6]{};
  assert(read(file, saved, 5) == 5 && std::strcmp(saved, "saved") == 0);
  assert(close(file) == 0);
  assert(fsync(-1) == -1 && errno == EBADF);
  return nullptr;
}

int main()
{
  // IDBFS-style asynchronous persistence must not make proxied fsync suspend.
  MAIN_THREAD_EM_ASM({
    globalThis.unexpectedSyncs = 0;
    FS.root.mount.type.syncfs = (mount, populate, callback) => {
      ++globalThis.unexpectedSyncs;
      setTimeout(() => callback(null), 0);
    };
  });
  pthread_t writers[2];
  char first[] = "/sync-first", second[] = "/sync-second";
  assert(pthread_create(&writers[0], nullptr, FileThread, first) == 0);
  assert(pthread_create(&writers[1], nullptr, FileThread, second) == 0);
  assert(pthread_join(writers[0], nullptr) == 0);
  assert(pthread_join(writers[1], nullptr) == 0);
  assert(MAIN_THREAD_EM_ASM_INT({ return globalThis.unexpectedSyncs; }) == 0);
  Payload payload{0xC0FFEE, 0};
  pthread_t thread;
  assert(pthread_create(&thread, nullptr, ThreadMain, &payload) == 0);
  void* result = nullptr;
  assert(pthread_join(thread, &result) == 0);
  assert(result == nullptr && payload.completed == 20);
  std::puts("20 worker callbacks, preserved arguments, SDL mode, synchronous file writes and joined shutdown passed");
}
