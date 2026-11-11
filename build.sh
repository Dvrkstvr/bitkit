#!/usr/bin/env bash
# Builds the WASM runtime into studio/runtime.js (+ runtime.wasm).
# Needs Emscripten (emcc) on PATH: https://emscripten.org/docs/getting_started/
set -euo pipefail
cd "$(dirname "$0")"
python3 tools/embed_lua.py
LUA=third_party/lua
# Emscripten 4+ embeds the wasm as raw bytes unless told not to (raw bytes break artifact hosts); older versions use base64 anyway
# Older Emscripten (Ubuntu's 3.1.6 package) lacks stringToNewUTF8: add a tiny shim.
V=$(emcc -dumpversion); MAJ=${V%%.*}; REST=${V#*.}; MIN=${REST%%.*}; PAT=${REST#*.}; PAT=${PAT%%[^0-9]*}
ENC=""; OLD=0
if [ "$MAJ" -ge 4 ]; then ENC="-sSINGLE_FILE_BINARY_ENCODE=0"
elif [ "$MAJ" -lt 3 ] || { [ "$MAJ" -eq 3 ] && [ "$MIN" -eq 1 ] && [ "$PAT" -lt 35 ]; }; then ENC="--post-js platform/web/compat_post.js"; OLD=1; fi
LUA_SRC=$(ls $LUA/*.c | grep -v -e lua.c -e luac.c -e loadlib.c -e liolib.c -e loslib.c -e ldblib.c -e linit.c)
emcc -O2 -std=gnu99 '-Dluai_makeseed(L)=0x2545F491u' -I$LUA -Iruntime \
  runtime/bk_core.c runtime/bk_lua.c platform/web/main_web.c $LUA_SRC \
  -sMODULARIZE=1 -sEXPORT_NAME=BitKitRuntime -sENVIRONMENT=web,node \
  -sALLOW_MEMORY_GROWTH=1 -sSINGLE_FILE=1 $ENC \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_bkw_init,_bkw_load,_bkw_load_ex,_bkw_stop,_bkw_frame,_bkw_render,_bkw_audio,_bkw_palette,_bkw_tiles,_bkw_flags,_bkw_map,_bkw_screen,_bkw_default_palette,_bkw_error,_bkw_track,_bkw_sys,_bkw_save,_bkw_input,_bkw_players,_bkw_net,_bkw_display \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPU32,HEAP32,HEAPF32,UTF8ToString$([ $OLD = 1 ] && echo ,lengthBytesUTF8,stringToUTF8 || echo ,stringToNewUTF8) \
  -o studio/runtime.js
echo "built studio/runtime.js ($(du -h studio/runtime.js | cut -f1))"
