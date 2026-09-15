// N-API bridge: transfer IOSurfaces over a private Mach service, never pixel
// copies.
#include <IOSurface/IOSurface.h>
#include <cstring>
#include <fcntl.h>
#include <mach/mach.h>
#include <map>
#include <node_api.h>
#include <servers/bootstrap.h>
#include <string>
#include <sys/mman.h>
#include <unistd.h>

struct FrameMessage {
  mach_msg_header_t header;
  mach_msg_body_t body;
  mach_msg_port_descriptor_t surface;
};
struct Held {
  IOSurfaceRef surface;
  mach_port_t reply;
  int slot;
};
static mach_port_t receiver = MACH_PORT_NULL;
static std::map<unsigned, Held> held;
static unsigned serial = 0;
static unsigned char *keys = nullptr;
static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}
static std::string stringArg(napi_env env, napi_value value) {
  size_t size = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::string result(size + 1, 0);
  napi_get_value_string_utf8(env, value, result.data(), result.size(), &size);
  result.resize(size);
  return result;
}
static void acknowledge(Held frame) {
  mach_msg_header_t ack{};
  ack.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  ack.msgh_size = sizeof(ack);
  ack.msgh_remote_port = frame.reply;
  ack.msgh_id = frame.slot;
  mach_msg(&ack, MACH_SEND_MSG | MACH_SEND_TIMEOUT, sizeof(ack), 0,
           MACH_PORT_NULL, 0, MACH_PORT_NULL);
  mach_port_deallocate(mach_task_self(), frame.reply);
  CFRelease(frame.surface);
}
static napi_value start(napi_env env, napi_callback_info info) {
  napi_value args[2];
  size_t count = 2;
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (receiver)
    return fail(env, "Surface receiver already started");
  auto name = stringArg(env, args[0]);
  auto file = stringArg(env, args[1]);
  int fd = open(file.c_str(), O_RDWR | O_CREAT | O_EXCL, 0600);
  if (fd < 0)
    return fail(env, "Cannot create input bridge");
  if (ftruncate(fd, 512)) {
    close(fd);
    return fail(env, "Cannot size input bridge");
  }
  keys = static_cast<unsigned char *>(
      mmap(nullptr, 512, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0));
  close(fd);
  if (keys == MAP_FAILED) {
    keys = nullptr;
    return fail(env, "Cannot map input bridge");
  }
  if (mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE,
                         &receiver) != KERN_SUCCESS ||
      mach_port_insert_right(mach_task_self(), receiver, receiver,
                             MACH_MSG_TYPE_MAKE_SEND) != KERN_SUCCESS ||
      bootstrap_register(bootstrap_port, name.data(), receiver) != KERN_SUCCESS)
    return fail(env, "Cannot register surface bridge");
  return nullptr;
}
static napi_value poll(napi_env env, napi_callback_info) {
  struct {
    FrameMessage frame;
    mach_msg_trailer_t trailer;
  } message{};
  auto result = mach_msg(&message.frame.header, MACH_RCV_MSG | MACH_RCV_TIMEOUT,
                         0, sizeof(message), receiver, 0, MACH_PORT_NULL);
  napi_value value;
  napi_get_null(env, &value);
  if (result != KERN_SUCCESS)
    return value;
  auto &frame = message.frame;
  if (!(frame.header.msgh_bits & MACH_MSGH_BITS_COMPLEX) ||
      frame.body.msgh_descriptor_count != 1 ||
      frame.surface.type != MACH_MSG_PORT_DESCRIPTOR) {
    mach_msg_destroy(&frame.header);
    return value;
  }
  IOSurfaceRef surface = IOSurfaceLookupFromMachPort(frame.surface.name);
  mach_port_deallocate(mach_task_self(), frame.surface.name);
  if (!surface) {
    mach_port_deallocate(mach_task_self(), frame.header.msgh_remote_port);
    return value;
  }
  unsigned id = ++serial;
  held[id] = {surface, frame.header.msgh_remote_port, frame.header.msgh_id};
  napi_create_object(env, &value);
  napi_value pointer;
  napi_create_buffer_copy(env, sizeof(surface), &surface, nullptr, &pointer);
  napi_set_named_property(env, value, "ioSurface", pointer);
  for (auto entry : {std::pair{"id", id},
                     {"width", unsigned(IOSurfaceGetWidth(surface))},
                     {"height", unsigned(IOSurfaceGetHeight(surface))}}) {
    napi_value number;
    napi_create_uint32(env, entry.second, &number);
    napi_set_named_property(env, value, entry.first, number);
  }
  return value;
}
static napi_value release(napi_env env, napi_callback_info info) {
  napi_value arg;
  size_t count = 1;
  napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
  unsigned id = 0;
  napi_get_value_uint32(env, arg, &id);
  auto it = held.find(id);
  if (it != held.end()) {
    acknowledge(it->second);
    held.erase(it);
  }
  return nullptr;
}
static napi_value input(napi_env env, napi_callback_info info) {
  napi_value args[2];
  size_t count = 2;
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  int code = -1;
  bool down = false;
  napi_get_value_int32(env, args[0], &code);
  napi_get_value_bool(env, args[1], &down);
  if (!keys)
    return nullptr;
  if (code == -1) {
    for (int i = 0; i < 128; i++)
      __atomic_store_n(keys + i, 0, __ATOMIC_RELEASE);
    __atomic_add_fetch(keys + 256, 1, __ATOMIC_RELEASE);
  } else if (code >= 0 && code < 128) {
    if (down && !keys[code])
      __atomic_add_fetch(keys + 128 + code, 1, __ATOMIC_RELEASE);
    __atomic_store_n(keys + code, down, __ATOMIC_RELEASE);
  }
  return nullptr;
}
static napi_value init(napi_env env, napi_value exports) {
  for (auto entry : {std::pair<const char *, napi_callback>{"start", start},
                     {"poll", poll},
                     {"release", release},
                     {"input", input}}) {
    napi_value function;
    napi_create_function(env, entry.first, NAPI_AUTO_LENGTH, entry.second,
                         nullptr, &function);
    napi_set_named_property(env, exports, entry.first, function);
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
