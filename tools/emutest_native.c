/* CI check for the emulators, built natively with a plain C compiler (like the device firmware, not WASM):
   the device host (bk_emu_fs.c) lists the test-card ROMs in a folder, each card is loaded and played with the
   D-pad and A, and the picture, sound, save states and the emu_* Lua functions are checked.
   Build and run: tools/emutest_native.sh   MIT License. */
#include "bk.h"
#include "bk_emu.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bk_machine m;
static int fails;
#define FAIL(...) do { printf("FAIL "); printf(__VA_ARGS__); printf("\n"); fails++; } while (0)
static void logger(const char *msg, int is_err) { if (is_err) FAIL("lua: %s", msg); else printf("  lua: %s\n", msg); }

/* where the test card's block is: the average x of the pixels in its colour */
static int block_x(int colour) {
  long sx = 0, n = 0;
  for (int y = 0; y < BK_H; y++) for (int x = 0; x < BK_W; x++) if (m.screen[y * BK_W + x] == colour) { sx += x; n++; }
  return n ? (int)(sx / n) : -1;
}
static float loudness(void) {
  static float buf[8192 * 2];
  bk_audio_render(buf, 8192);
  float e = 0; for (int i = 0; i < 8192 * 2; i++) e += buf[i] * buf[i];
  return e;
}

static void card(const char *kind, int index, int draw_w, int block_colour) {
  printf("%s test card\n", kind);
  char lua[512];
  snprintf(lua, sizeof(lua),
    "local r = emu_roms('%s') print('roms', #r, r[1] and r[1].name, r[1] and r[1].kind)\n"
    "assert(#r == 1 and r[1].name == 'bitkit-test')\n"
    "assert(emu_open(%d))\n"
    "local ev, ok = emu_poll() assert(ev == 'open' and ok, 'open failed: ' .. tostring(emu_error()))\n"
    "assert(emu_kind() == '%s', 'kind ' .. tostring(emu_kind()))\n"
    "function _update() emu_run(PAD or 0) end\n"
    "function _draw() cls(1) local w, h = emu_size() emu_draw((320 - %d) // 2, 0, %d, 240) end\n",
    kind, index, kind, draw_w, draw_w);
  if (bk_lua_load(lua)) { FAIL("%s: app did not load", kind); return; }
  for (int f = 0; f < 30; f++) bk_lua_frame();
  int x0 = block_x(block_colour);
  if (x0 < 0) { FAIL("%s: the block is not on screen", kind); return; }
  bk_lua_eval("PAD = 16");                                /* hold right */
  for (int f = 0; f < 40; f++) bk_lua_frame();
  int x1 = block_x(block_colour);
  printf("  block x %d -> %d\n", x0, x1);
  if (x1 <= x0 + 10) FAIL("%s: the block did not move right with the D-pad (%d -> %d)", kind, x0, x1);
  loudness();                                             /* empty the sound ring */
  bk_lua_eval("PAD = 1");                                 /* press A: a beep */
  for (int f = 0; f < 8; f++) bk_lua_frame();
  float e = loudness();
  printf("  sound energy after A: %.3f\n", e);
  if (e < 0.5f) FAIL("%s: no sound after pressing A", kind);
  bk_lua_eval("PAD = 0");
  /* save state, move, load state: the block is back */
  bk_lua_frame();
  int xs = block_x(block_colour);
  if (bk_lua_eval("assert(emu_save_state(2))")) FAIL("%s: save state", kind);
  bk_lua_eval("PAD = 32");                                /* hold left */
  for (int f = 0; f < 30; f++) bk_lua_frame();
  int xm = block_x(block_colour);
  bk_lua_eval("PAD = 0");
  if (bk_lua_eval("assert(emu_load_state(2)) local ev, ok = emu_poll() assert(ev == 'load' and ok, 'load state failed')")) FAIL("%s: load state", kind);
  snprintf(lua, sizeof(lua), "local r = emu_roms('%s') assert(r[1].states[2], 'slot 2 not listed')", kind);
  if (bk_lua_eval(lua)) FAIL("%s: state not listed", kind);
  bk_lua_frame();
  int xl = block_x(block_colour);
  printf("  state: saved at x %d, moved to %d, loaded back to %d\n", xs, xm, xl);
  if (xm >= xs - 5 || abs(xl - xs) > 3) FAIL("%s: save state did not bring the block back", kind);
}

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "roms";
  bk_machine_init(&m);
  bk_set_logger(logger);
  bk_emu_fs_init(dir);
  /* the block is colour 3 of sprite palette 0; on screen that is palette entry 192 + slot */
  card("gb", 1, 267, BK_EMU_PAL0 + 3);                  /* DMG sprite palette 0 = slots 0..3 */
  card("gbc", 1, 267, BK_EMU_PAL0 + 32 + 3);           /* CGB: sprite palettes start at slot 32 */
  card("nes", 1, 256, BK_EMU_PAL0 + 0x30);             /* NES: the block is colour $30, only it uses it */
  bk_lua_load("function _draw() end");                   /* another cart starting ends the emulated game */
  if (bk_emu_kind() != BK_EMU_NONE) FAIL("emulator still running after close");
  printf(fails ? "%d FAILED\n" : "emulator checks passed\n", fails);
  return fails != 0;
}
