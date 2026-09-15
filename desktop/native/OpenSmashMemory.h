#pragma once
#include <atomic>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <string>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <string>
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
namespace OpenSmashMemory {
static_assert(std::atomic_ref<unsigned char>::is_always_lock_free);
inline std::string EnvironmentPath(const char* name) {
#ifdef _WIN32
  const std::string key(name);
  const std::wstring wideKey(key.begin(), key.end());
  const wchar_t* value = _wgetenv(wideKey.c_str());
  if (!value) return {};
  int length = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  std::string result(length, 0);
  WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), length, nullptr, nullptr);
  if (!result.empty()) result.pop_back();
  return result;
#else
  const char* value = std::getenv(name);
  return value ? value : "";
#endif
}
class Mapping {
public:
  unsigned char *data = nullptr;
  size_t size;
  Mapping(const char *path, size_t bytes, bool writable) : size(bytes) {
#ifdef _WIN32
    int length = MultiByteToWideChar(CP_UTF8, 0, path, -1, nullptr, 0);
    std::wstring wide(length, 0);
    MultiByteToWideChar(CP_UTF8, 0, path, -1, wide.data(), length);
    HANDLE file =
        CreateFileW(wide.c_str(), GENERIC_READ | (writable ? GENERIC_WRITE : 0),
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    LARGE_INTEGER actual{};
    if (file != INVALID_HANDLE_VALUE && GetFileSizeEx(file, &actual) &&
        actual.QuadPart >= bytes) {
      HANDLE mapping = CreateFileMappingW(
          file, nullptr, writable ? PAGE_READWRITE : PAGE_READONLY, 0, 0,
          nullptr);
      if (mapping) {
        data = static_cast<unsigned char *>(MapViewOfFile(
            mapping, writable ? FILE_MAP_WRITE : FILE_MAP_READ, 0, 0, bytes));
        CloseHandle(mapping);
      }
    }
    if (file != INVALID_HANDLE_VALUE)
      CloseHandle(file);
#else
    int file = open(path, writable ? O_RDWR : O_RDONLY);
    struct stat info{};
    if (file >= 0 && fstat(file, &info) == 0 && size_t(info.st_size) >= bytes) {
      void *memory =
          mmap(nullptr, bytes, PROT_READ | (writable ? PROT_WRITE : 0),
               MAP_SHARED, file, 0);
      if (memory != MAP_FAILED)
        data = static_cast<unsigned char *>(memory);
    }
    if (file >= 0)
      close(file);
#endif
    if (!data) {
      std::fprintf(stderr, "Cannot open Electron shared memory bridge\n");
      std::abort();
    }
  }
  ~Mapping() {
#ifdef _WIN32
    if (data)
      UnmapViewOfFile(data);
#else
    if (data)
      munmap(data, size);
#endif
  }
  Mapping(const Mapping &) = delete;
  Mapping &operator=(const Mapping &) = delete;
};
inline unsigned char Load(const unsigned char *value) {
  return std::atomic_ref<unsigned char>(*const_cast<unsigned char *>(value))
      .load(std::memory_order_acquire);
}
inline void Store(unsigned char *value, unsigned char byte) {
  std::atomic_ref<unsigned char>(*value).store(byte, std::memory_order_release);
}
} // namespace OpenSmashMemory
