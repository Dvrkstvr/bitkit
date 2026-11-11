#!/usr/bin/env bash
# Builds the WASM runtime into studio/runtime.js (+ runtime.wasm).
# Needs Emscripten (emcc) on PATH: https://emscripten.org/docs/getting_started/
set -euo pipefail
cd "$(dirname "$0")"
python3 tools/embed_lua.py
LUA=third_party/lua
LUA_SRC=$(ls $LUA/*.c | grep -v -e lua.c -e luac.c -e loadlib.c -e liolib.c -e loslib.c -e ldblib.c -e linit.c)
emcc -O2 -std=gnu99 -I$LUA -Iruntime \
  runtime/bk_core.c runtime/bk_lua.c platform/web/main_web.c $LUA_SRC \
  -sMODULARIZE=1 -sEXPORT_NAME=BitKitRuntime -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sSINGLE_FILE=1 -sSINGLE_FILE_BINARY_ENCODE=0 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_bkw_init,_bkw_load,_bkw_load_ex,_bkw_stop,_bkw_frame,_bkw_render,_bkw_audio,_bkw_palette,_bkw_tiles,_bkw_flags,_bkw_map,_bkw_screen,_bkw_default_palette,_bkw_error,_bkw_track,_bkw_sys,_bkw_save \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPU32,HEAP32,HEAPF32,stringToNewUTF8,UTF8ToString \
  -o studio/runtime.js
echo "built studio/runtime.js ($(du -h studio/runtime.js | cut -f1))"
