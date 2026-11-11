/*
 * BitKit emulators: Game Boy, Game Boy Color and NES, for the emulator apps on the Bit's Utilities row.
 * Portable C like the rest of the runtime: the same code runs in the browser (WASM) and on the ESP32-S3.
 *
 * Cores (all MIT, see third_party/):
 *   Game Boy / Color: Walnut-CGB by Mr-PauI, based on Peanut-GB by Mahyar Koshkouei (third_party/walnut_cgb)
 *   Game Boy sound:   minigb_apu by Alex Baines and Mahyar Koshkouei
 *   NES:              agnes by Krzysztof Gabis (third_party/agnes); the NES sound chip is BitKit's own (bk_emu.c)
 *
 * The emulator is a native part of the runtime that a Lua app drives (emu_* functions, see bk_emu.c).
 * The host (studio or device firmware) owns the files through bk_emu_host: it lists the ROMs, loads the one
 * the app asks for, and keeps battery saves and save states. bk_emu_fs.c is a host for devices (an SD card).
 * MIT License - see LICENSE.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>

enum { BK_EMU_NONE = 0, BK_EMU_GB = 1, BK_EMU_GBC = 2, BK_EMU_NES = 3 };

/* Console buttons, as one mask (emu_run in Lua takes the same bits). */
enum { BK_EMU_A = 1, BK_EMU_B = 2, BK_EMU_SELECT = 4, BK_EMU_START = 8,
       BK_EMU_RIGHT = 16, BK_EMU_LEFT = 32, BK_EMU_UP = 64, BK_EMU_DOWN = 128 };

/* Palette entries the emulators use for their colours (the app's own drawing uses the low ones). */
#define BK_EMU_PAL0 192

/* What the host does for the emulator. Any of these may be NULL. Calls come from inside a Lua frame. */
typedef struct {
  /* The games the app can offer, as a Lua table constructor (a string from malloc; the runtime frees it):
     {{name = "Tetris", kind = "gb", size = 32768, save = true, states = {[1] = true}}, ...}
     kind is "gb", "gbc" or "nes"; the app asks for one kind (an empty kind = all). */
  char *(*roms)(const char *kind);
  /* The app picked entry index (1-based) of the last list: load it now or later with bk_emu_rom_alloc() +
     bk_emu_start(), then tell the app with bk_emu_notify("open", ok). */
  void (*open)(int index);
  /* Battery-backed cartridge RAM changed (sent at most every few seconds) or the game is closing: keep it. */
  void (*sram)(const char *name, const uint8_t *data, uint32_t len);
  /* A save state to keep in slot 1..9 (data is only valid during the call: copy it). */
  void (*state_save)(const char *name, int slot, const uint8_t *data, uint32_t len);
  /* Load slot 1..9: now or later with bk_emu_state_load(), then bk_emu_notify("load", ok). */
  void (*state_load)(const char *name, int slot);
} bk_emu_host;

void bk_emu_set_host(const bk_emu_host *h);

/* --- loading a game (host side) --- */
uint8_t *bk_emu_rom_alloc(uint32_t len);   /* a buffer for the ROM file; fill it, then bk_emu_start */
int  bk_emu_start(const char *name);       /* name: the file's name, used for saves. Returns the kind, 0 = failed */
const char *bk_emu_error(void);            /* why the last start failed */
uint8_t *bk_emu_sram(uint32_t *len);       /* after start: put the battery save in here (len = its size, 0 = none) */
void bk_emu_sram_loaded(void);             /* call after filling it */
int  bk_emu_state_load(const uint8_t *data, uint32_t len);   /* 1 ok, 0 not a state of this game */
void bk_emu_close(void);                   /* sends the battery save to the host first */
void bk_emu_notify(const char *what, int ok);   /* tells the app (it reads these with emu_poll()): "open", "load", "roms" */

/* --- running (the Lua app does this; exposed for tests) --- */
int  bk_emu_kind(void);
const char *bk_emu_name(void);
int  bk_emu_run(int mask, int frames);     /* 0 = the core stopped (bad opcode) */
void bk_emu_draw(int x, int y, int w, int h, int crop_top, int crop_bottom);
void bk_emu_dmg_palette(int n);            /* 0..BK_EMU_DMG_PALETTES-1 */
#define BK_EMU_DMG_PALETTES 6
int  bk_emu_save_state(int slot);          /* 1 sent to the host */

/* --- glue (runtime internal) --- */
void bk_emu_audio_mix(float *out, int frames);   /* adds the emulator's sound (bk_audio_render calls this) */
struct lua_State;
void bk_emu_lua_open(struct lua_State *L);       /* registers emu_* (bk_lua_load_ex calls this) */

/* --- bk_emu_fs.c: a host for devices, ROMs and saves as files in one folder (e.g. "/sdcard/roms") --- */
void bk_emu_fs_init(const char *root);
