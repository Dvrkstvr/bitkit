#!/usr/bin/env bash
# Builds the runtime natively (as the device firmware does, no WASM) and checks the emulators with the test cards.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${TMPDIR:-/tmp}/bitkit-emutest
mkdir -p "$OUT"
python3 tools/make_test_roms.py "$OUT/roms" > /dev/null
LUA=third_party/lua
LUA_SRC=$(ls $LUA/*.c | grep -v -e lua.c -e luac.c -e loadlib.c -e liolib.c -e loslib.c -e ldblib.c -e linit.c)
cc -O2 -std=gnu99 -Wall -I$LUA -Iruntime runtime/bk_core.c runtime/bk_lua.c runtime/bk_emu.c runtime/bk_emu_fs.c tools/emutest_native.c $LUA_SRC -lm -o "$OUT/emutest"
"$OUT/emutest" "$OUT/roms"
