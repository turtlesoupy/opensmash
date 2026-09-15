#include <cstdio>
#include <cstdint>
#include <emscripten/emscripten.h>
#include <mbedtls/sha256.h>

// Runs before game startup in the frontend worker. Streaming keeps the 1.4 GB
// disc outside Wasm memory; WORKERFS reads only this fixed-size buffer at a time.
extern "C" EMSCRIPTEN_KEEPALIVE const char* opensmash_hash_file(const char* path)
{
  static char result[65];
  static unsigned char buffer[1024 * 1024];
  auto* file = std::fopen(path, "rb");
  if (!file) return nullptr;
  mbedtls_sha256_context context;
  mbedtls_sha256_init(&context);
  int error = mbedtls_sha256_starts_ret(&context, 0);
  std::uint64_t total = 0;
  while (!error) {
    const auto count = std::fread(buffer, 1, sizeof(buffer), file);
    if (!count) break;
    error = mbedtls_sha256_update_ret(&context, buffer, count);
    total += count;
    if (total % (64 * 1024 * 1024) == 0)
      EM_ASM({ Module['onVerifyProgress']?.($0); }, static_cast<double>(total));
  }
  if (std::ferror(file)) error = -1;
  std::fclose(file);
  unsigned char hash[32];
  if (!error) error = mbedtls_sha256_finish_ret(&context, hash);
  mbedtls_sha256_free(&context);
  if (error) return nullptr;
  for (unsigned i = 0; i < 32; ++i) std::sprintf(result + i * 2, "%02x", hash[i]);
  return result;
}
