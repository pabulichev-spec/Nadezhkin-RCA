cmake_minimum_required(VERSION 3.31.6)
project(appmodules LANGUAGES C CXX)

# React Native New Architecture requires libappmodules.so. This include builds
# the stock OnLoad.cpp and its core/autolinked TurboModule providers. Keep the
# AI JNI source below in a subdirectory: a *.cpp next to this CMakeLists would
# replace the stock OnLoad.cpp in ReactNative-application.cmake's source glob.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_SYSTEM_ARCH "ARM")
    set(GGML_CPU_KLEIDIAI ON)
elseif(ANDROID_ABI STREQUAL "x86_64")
    # Emulator-only build of the same real CPU backend; release remains arm64-only.
    set(GGML_SYSTEM_ARCH "X86")
    set(GGML_CPU_KLEIDIAI OFF)
else()
    message(FATAL_ERROR "Unsupported Android ABI: ${ANDROID_ABI}")
endif()
set(GGML_OPENMP ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
set(GGML_CPU ON CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/../../../../../native/llama.cpp)
get_filename_component(LLAMA_SRC ${LLAMA_SRC} ABSOLUTE)
add_subdirectory(${LLAMA_SRC} build-llama)
add_subdirectory(${LLAMA_SRC}/tools/mtmd build-mtmd)

add_library(ai-chat SHARED local-ai/vision_poc.cpp)
target_compile_definitions(ai-chat PRIVATE
    GGML_SYSTEM_ARCH=${GGML_SYSTEM_ARCH}
    GGML_CPU_KLEIDIAI=$<BOOL:${GGML_CPU_KLEIDIAI}>
    GGML_OPENMP=$<BOOL:${GGML_OPENMP}>
)
target_include_directories(ai-chat PRIVATE
    ${LLAMA_SRC}
    ${LLAMA_SRC}/common
    ${LLAMA_SRC}/include
    ${LLAMA_SRC}/ggml/include
    ${LLAMA_SRC}/ggml/src
    ${LLAMA_SRC}/tools/mtmd
)
target_link_libraries(ai-chat
    llama
    llama-common
    mtmd
    android
    log
)
