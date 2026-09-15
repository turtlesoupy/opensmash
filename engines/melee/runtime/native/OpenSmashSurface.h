// macOS desktop presentation. Three IOSurfaces bound outstanding GPU work.
// A slot is reusable only after Electron releases every GPU reference.
#pragma once
#include <IOSurface/IOSurface.h>
#include <chrono>
#include <cstdlib>
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <thread>

namespace OpenSmashSurface {
inline bool Enabled() {
  return std::getenv("OPENSMASH_SURFACE_SERVICE") != nullptr;
}
struct Message {
  mach_msg_header_t header;
  mach_msg_body_t body;
  mach_msg_port_descriptor_t surface;
};
struct Slot {
  IOSurfaceRef surface = nullptr;
  id<MTLTexture> texture = nil;
  bool busy = false;
};
inline Slot slots[3];
inline mach_port_t destination = MACH_PORT_NULL, replies = MACH_PORT_NULL;
inline int active = -1;
inline id<MTLTexture> Acquire(id<MTLDevice> device) {
  if (!destination) {
    if (bootstrap_look_up(bootstrap_port,
                          std::getenv("OPENSMASH_SURFACE_SERVICE"),
                          &destination) != KERN_SUCCESS)
      return nil;
    mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &replies);
    mach_port_insert_right(mach_task_self(), replies, replies,
                           MACH_MSG_TYPE_MAKE_SEND);
  }
  struct {
    mach_msg_header_t header;
    mach_msg_trailer_t trailer;
  } ack{};
  while (mach_msg(&ack.header, MACH_RCV_MSG | MACH_RCV_TIMEOUT, 0, sizeof(ack),
                  replies, 0, MACH_PORT_NULL) == KERN_SUCCESS)
    if (ack.header.msgh_id >= 0 && ack.header.msgh_id < 3)
      slots[ack.header.msgh_id].busy = false;
  active = -1;
  for (int i = 0; i < 3; i++)
    if (!slots[i].busy) {
      active = i;
      break;
    }
  if (active < 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return nil;
  }
  auto &slot = slots[active];
  if (!slot.surface) {
    NSDictionary *properties = @{
      (NSString *)kIOSurfaceWidth : @960,
      (NSString *)kIOSurfaceHeight : @720,
      (NSString *)kIOSurfaceBytesPerElement : @4,
      (NSString *)kIOSurfacePixelFormat : @(0x42475241)
    };
    slot.surface = IOSurfaceCreate((CFDictionaryRef)properties);
    MTLTextureDescriptor *descriptor = [MTLTextureDescriptor
        texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                     width:960
                                    height:720
                                 mipmapped:NO];
    descriptor.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
    descriptor.storageMode = MTLStorageModeShared;
    slot.texture = [device newTextureWithDescriptor:descriptor
                                          iosurface:slot.surface
                                              plane:0];
  }
  return slot.texture;
}
inline void Present(id<MTLCommandBuffer> command) {
  if (active < 0)
    return;
  const int index = active;
  slots[index].busy = true;
  [command addCompletedHandler:^(id<MTLCommandBuffer> completed) {
    Message msg{};
    msg.header.msgh_bits =
        MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, MACH_MSG_TYPE_COPY_SEND) |
        MACH_MSGH_BITS_COMPLEX;
    msg.header.msgh_size = sizeof(msg);
    msg.header.msgh_remote_port = destination;
    msg.header.msgh_local_port = replies;
    msg.header.msgh_id = index;
    msg.body.msgh_descriptor_count = 1;
    msg.surface.name = IOSurfaceCreateMachPort(slots[index].surface);
    msg.surface.disposition = MACH_MSG_TYPE_COPY_SEND;
    msg.surface.type = MACH_MSG_PORT_DESCRIPTOR;
    auto result = mach_msg(&msg.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT,
                           sizeof(msg), 0, MACH_PORT_NULL, 0, MACH_PORT_NULL);
    mach_port_deallocate(mach_task_self(), msg.surface.name);
    if (result != KERN_SUCCESS) {
      mach_msg_header_t ack{};
      ack.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
      ack.msgh_size = sizeof(ack);
      ack.msgh_remote_port = replies;
      ack.msgh_id = index;
      mach_msg(&ack, MACH_SEND_MSG | MACH_SEND_TIMEOUT, sizeof(ack), 0,
               MACH_PORT_NULL, 0, MACH_PORT_NULL);
    }
  }];
  active = -1;
}
} // namespace OpenSmashSurface
