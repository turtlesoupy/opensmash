#include "meshoptimizer.h"
#include <cstddef>
// Build-time only: the ROM receives ordered triangles, never this host code.
extern "C" void skin_order(unsigned int *out, const unsigned int *in,
                           size_t count, size_t vertices, unsigned int capacity,
                           int adaptive) {
    if (adaptive) meshopt_optimizeVertexCache(out, in, count, vertices);
    else meshopt_optimizeVertexCacheFifo(out, in, count, vertices, capacity);
}
