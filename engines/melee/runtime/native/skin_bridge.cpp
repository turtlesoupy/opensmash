// Native adapter for the same custom skinning implementation used by the browser.
#include "core/cpu.h"
#include "moderngekko/module_abi.h"
#include <cstdio>
#include <cstdlib>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif
extern "C" {
PPCMemWriteJournal g_mem_write_journal = nullptr;
void* g_mem_write_journal_user = nullptr;
bool ppc_fp_available(CPUState* s, unsigned pc) {
    if (s->msr & PPC_MSR_FP) return true;
    ppc_take_exception(s, PPC_EXC_FP_UNAVAILABLE, PPC_VECTOR_FP_UNAVAILABLE, pc, 0);
    return false;
}
const ModernGekkoModuleDesc* staticrecomp_get_module() {
    static const ModernGekkoModuleDesc* module = [] {
#ifdef _WIN32
        const wchar_t* path = _wgetenv(L"OPENSMASH_NATIVE_MODULE");
        HMODULE handle = path ? LoadLibraryW(path) : nullptr;
        auto get = handle ? reinterpret_cast<ModernGekkoGetModuleFn>(GetProcAddress(handle, "staticrecomp_get_module")) : nullptr;
#else
        const char* path = std::getenv("OPENSMASH_NATIVE_MODULE");
        void* handle = path ? dlopen(path, RTLD_LAZY | RTLD_LOCAL) : nullptr;
        auto get = handle ? reinterpret_cast<ModernGekkoGetModuleFn>(dlsym(handle, "staticrecomp_get_module")) : nullptr;
#endif
        if (!get) { std::fprintf(stderr, "[opensmash] native skin module unavailable\n"); std::abort(); }
        // Keep the library alive while the shared skinning path calls its dispatcher.
        return get();
    }();
    return module;
}
}
