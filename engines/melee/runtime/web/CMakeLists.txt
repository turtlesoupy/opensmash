# Included by the patched ModernGekko root, after its runtime targets exist.
target_link_libraries(moderngekko PRIVATE mbedcrypto)
set(OPENSMASH_WEB_SOURCE "${CMAKE_CURRENT_LIST_DIR}")
if(NOT OPENSMASH_RECOMPILED_GAME)
  message(FATAL_ERROR "Set OPENSMASH_RECOMPILED_GAME to the verified generated Melee directory")
endif()
file(SHA256 "${OPENSMASH_RECOMPILED_GAME}/main.dol" OPENSMASH_DOL_HASH)
if(NOT OPENSMASH_DOL_HASH STREQUAL "dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646")
  message(FATAL_ERROR "Expected verified USA 1.02 game code")
endif()
set(OPENSMASH_DOLPHIN "${CMAKE_CURRENT_SOURCE_DIR}/vendor/dolphin")
set(OPENSMASH_MODULE_TABLES "${CMAKE_CURRENT_BINARY_DIR}/opensmash-module/module_tables.inc")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/opensmash-module")
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_custom_command(OUTPUT "${OPENSMASH_MODULE_TABLES}"
  COMMAND Python3::Interpreter "${OPENSMASH_DOLPHIN}/module-template/gen_module_tables.py"
    "${OPENSMASH_RECOMPILED_GAME}/generated.h"
    "${OPENSMASH_RECOMPILED_GAME}/generated_smc.txt"
    "${OPENSMASH_RECOMPILED_GAME}/main.dol" "${OPENSMASH_MODULE_TABLES}"
  DEPENDS "${OPENSMASH_RECOMPILED_GAME}/generated.h"
    "${OPENSMASH_RECOMPILED_GAME}/generated_smc.txt" "${OPENSMASH_RECOMPILED_GAME}/main.dol")
file(GLOB OPENSMASH_CHUNKS CONFIGURE_DEPENDS "${OPENSMASH_RECOMPILED_GAME}/chunks/*.c")
include("${OPENSMASH_RECOMPILED_GAME}/opensmash_entries.cmake")
# Region chaining rewrites every region (tools/chain_browser_chunks.py); the
# chained copies replace the generated and entry-specialized sources.
include("${OPENSMASH_RECOMPILED_GAME}/opensmash_chained.cmake")
add_library(opensmash-game STATIC
  "${OPENSMASH_DOLPHIN}/module-template/module_export.c"
  "${OPENSMASH_MODULE_TABLES}"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu.c"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu_exception.c"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu_interpreter.c"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu_interpreter_table.c"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu_interpreter_float.c"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu_interpreter_integer.c"
  ${OPENSMASH_CHUNKS})
target_include_directories(opensmash-game PRIVATE
  "${OPENSMASH_RECOMPILED_GAME}" "${OPENSMASH_DOLPHIN}/GXRuntime/include"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/PowerPC/StaticRecomp"
  "${CMAKE_CURRENT_BINARY_DIR}/opensmash-module")
target_compile_definitions(opensmash-game PRIVATE MODULE_GAME_ID="GALE01")
target_compile_options(opensmash-game PRIVATE -O2 -ffp-contract=off -fno-fast-math)
# Link-time optimization lets hot matrix calls inline the exact PPC helpers.
# Keep the rest of the 3,792 game regions as objects to bound link memory/time.
if(NOT OPENSMASH_HOT_GAME_CHUNKS)
  set(OPENSMASH_HOT_GAME_CHUNKS
    "${OPENSMASH_RECOMPILED_GAME}/chunks/chunk_3320_text1_80341140.c"
    "${OPENSMASH_RECOMPILED_GAME}/chunks/chunk_3324_text1_80342140.c"
    "${OPENSMASH_RECOMPILED_GAME}/chunks/chunk_3546_text1_80379940.c"
    "${OPENSMASH_RECOMPILED_GAME}/chunks/chunk_3549_text1_8037A540.c")
endif()
set(OPENSMASH_HOT_ENTRY_CHUNKS)
foreach(chunk IN LISTS OPENSMASH_HOT_GAME_CHUNKS)
  get_filename_component(chunk_name "${chunk}" NAME)
  foreach(kind entries deferred chunks)
    set(chained_chunk "${OPENSMASH_RECOMPILED_GAME}/chained/${kind}/${chunk_name}")
    if(EXISTS "${chained_chunk}")
      list(APPEND OPENSMASH_HOT_ENTRY_CHUNKS "${chained_chunk}")
      break()
    endif()
  endforeach()
endforeach()
set_source_files_properties(
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu.c"
  "${OPENSMASH_DOLPHIN}/GXRuntime/src/core/cpu_interpreter_float.c"
  ${OPENSMASH_HOT_ENTRY_CHUNKS}
  PROPERTIES COMPILE_OPTIONS "-flto")
# Inline the hot dispatcher and CPU-state/memory helpers across their C++ files.
set_source_files_properties(
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/PowerPC/StaticRecomp/StaticRecompCore.cpp"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/PowerPC/StaticRecomp/StaticRecompCore_Run.cpp"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/PowerPC/StaticRecomp/StaticRecompCore_SMC.cpp"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/PowerPC/StaticRecomp/StaticRecompCore_Hooks.cpp"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/PowerPC/StaticRecomp/StaticRecompCore_Sync.cpp"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/HW/GPFifo.cpp"
  "${OPENSMASH_DOLPHIN}/Source/Core/Core/HW/Memmap.cpp"
  TARGET_DIRECTORY core PROPERTIES COMPILE_OPTIONS "-flto")
# Retained originals of the deferred-store regions, for the differential oracle
# only: the game module does not carry them.
file(GLOB OPENSMASH_REFERENCES CONFIGURE_DEPENDS "${OPENSMASH_RECOMPILED_GAME}/references/*.c")
add_library(opensmash-game-reference STATIC EXCLUDE_FROM_ALL ${OPENSMASH_REFERENCES})
target_include_directories(opensmash-game-reference PRIVATE
  "${OPENSMASH_RECOMPILED_GAME}" "${OPENSMASH_DOLPHIN}/GXRuntime/include")
target_compile_options(opensmash-game-reference PRIVATE -O2 -ffp-contract=off -fno-fast-math)
add_executable(opensmash-web "${OPENSMASH_WEB_SOURCE}/main.cpp" "${OPENSMASH_WEB_SOURCE}/skin_runtime.cpp" "${OPENSMASH_WEB_SOURCE}/verify_image.cpp"
  "${OPENSMASH_WEB_SOURCE}/../mods/launch_match.c")
target_link_libraries(opensmash-web PRIVATE moderngekko opensmash-game mbedcrypto fmt::fmt)
target_include_directories(opensmash-web PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/include" "${OPENSMASH_DOLPHIN}/Source/Core")
set_target_properties(opensmash-web PROPERTIES SUFFIX ".js")
if(OPENSMASH_WEB_OUTPUT_DIRECTORY)
  set_target_properties(opensmash-web PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${OPENSMASH_WEB_OUTPUT_DIRECTORY}")
endif()
set_property(TARGET opensmash-web APPEND PROPERTY LINK_DEPENDS
  "${OPENSMASH_WEB_SOURCE}/register_canvas.js"
  "${OPENSMASH_WEB_SOURCE}/synchronous-filesystem.js")
set(OPENSMASH_WASM_LINK_OPT "-O1" CACHE STRING "Wasm optimization for development links")
target_link_options(opensmash-web PRIVATE
  ${OPENSMASH_WASM_LINK_OPT}
  --emit-symbol-map
  "SHELL:--pre-js ${OPENSMASH_WEB_SOURCE}/register_canvas.js"
  -pthread -sPROXY_TO_PTHREAD=1 -sPTHREAD_POOL_SIZE=8
  -sINITIAL_MEMORY=536870912 -sMAXIMUM_MEMORY=2147483648 -sALLOW_MEMORY_GROWTH=1
  -sSTACK_SIZE=2097152 -sDEFAULT_PTHREAD_STACK_SIZE=2097152
  # The GPU worker must yield to reclaim transferred ImageBitmap resources.
  # Infer direct suspension paths; dynCall_ii is the outer pthread entry wrapper.
  -sASYNCIFY=1 -sASYNCIFY_IGNORE_INDIRECT=1 "-sASYNCIFY_ADD=['dynCall_ii']"
  -sASYNCIFY_STACK_SIZE=16384
  "SHELL:--js-library ${OPENSMASH_WEB_SOURCE}/synchronous-filesystem.js"
  -sUSE_WEBGL2=1 -sFULL_ES3=1 -sGL_ENABLE_GET_PROC_ADDRESS=1
  -sOFFSCREEN_FRAMEBUFFER=1 -sOFFSCREENCANVAS_SUPPORT=1 "-sOFFSCREENCANVASES_TO_PTHREAD=#canvas"
  -sFORCE_FILESYSTEM=1 -lworkerfs.js -lnodefs.js -lidbfs.js
  -sMODULARIZE=1 -sEXPORT_NAME=createMelee -sINVOKE_RUN=0
  "-sEXPORTED_RUNTIME_METHODS=['FS','callMain','ccall','WORKERFS','NODEFS','IDBFS']"
  "-sENVIRONMENT=web,worker,node")

target_include_directories(opensmash-web PRIVATE "${OPENSMASH_DOLPHIN}/GXRuntime/include")
set_source_files_properties("${OPENSMASH_WEB_SOURCE}/skin_runtime.cpp" PROPERTIES COMPILE_OPTIONS "-ffp-contract=off;-fno-fast-math")
