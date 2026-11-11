#!/usr/bin/env bash
# Builds the headless PocketBit (the device host + runtime, for Linux/macOS) into build/bitsim.
# It runs the same carts as the ESP32-S3 firmware, so CI can play every game through the device code.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
python3 $ROOT/tools/embed_lua.py >/dev/null
LUA=$ROOT/third_party/lua
LUA_SRC=$(ls $LUA/*.c | grep -v -e '/lua.c' -e '/luac.c' -e loadlib.c -e liolib.c -e loslib.c -e ldblib.c -e linit.c)
mkdir -p build
${CC:-cc} -O2 -g -std=gnu99 -Wall -Wno-unused-function -Wno-misleading-indentation '-Dluai_makeseed(L)=0x2545F491u' -I$LUA -I$ROOT/runtime -I$ROOT/platform/device -I$ROOT/third_party \
  main_sim.c $ROOT/platform/device/*.c $ROOT/runtime/*.c $LUA_SRC -lm -o build/bitsim
echo "built platform/sim/build/bitsim"
