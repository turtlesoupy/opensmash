#ifndef MELEE_PORT_FIFO_H
#define MELEE_PORT_FIFO_H
#include <dolphin/types.h>
void port_fifo_u8(u8);void port_fifo_s8(s8);
void port_fifo_u16(u16);void port_fifo_s16(s16);
void port_fifo_u32(u32);void port_fifo_s32(s32);
void port_fifo_f32(f32);void port_fifo_reset(void);void port_fifo_flush(void);
#endif
