#!/usr/bin/env bash
# Builds the WASM runtime into studio/runtime.js (+ runtime.wasm).
# Needs Emscripten (emcc) on PATH: https://emscripten.org/docs/getting_started/
set -euo pipefail
cd "$(dirname "$0")"
LUA=third_party/lua
LUA_SRC=$(ls $LUA/*.c | grep -v -e lua.c -e luac.c -e loadlib.c -e liolib.c -e loslib.c -e ldblib.c -e linit.c)
emcc -O2 -std=gnu99 -I$LUA -Iruntime \
  runtime/mb_core.c runtime/mb_lua.c platform/web/main_web.c $LUA_SRC \
  -sMODULARIZE=1 -sEXPORT_NAME=MiniBoiRuntime -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sSINGLE_FILE=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_mbw_init,_mbw_load,_mbw_stop,_mbw_frame,_mbw_render,_mbw_audio,_mbw_palette,_mbw_tiles,_mbw_flags,_mbw_map,_mbw_screen,_mbw_default_palette,_mbw_error \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPU32,HEAPF32,stringToNewUTF8,UTF8ToString \
  -o studio/runtime.js
echo "built studio/runtime.js ($(du -h studio/runtime.js | cut -f1))"
