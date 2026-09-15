#ifndef PORT_PLATFORM_H
#define PORT_PLATFORM_H
void port_defer(void (*callback)(void*),void* argument);
void port_pump(void);
#endif
