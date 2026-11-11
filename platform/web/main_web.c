/* BitKit browser host: exposes the runtime to JavaScript. MIT License. */
#include "../../runtime/bk.h"
#include "../../runtime/bk_emu.h"
#include <emscripten.h>
#include <string.h>

static bk_machine machine;
static uint32_t rgba[BK_W * BK_H];
static float audio_buf[4096 * 2];

EM_JS(void, js_log, (const char *msg, int is_err), {
  if (Module.onLog) Module.onLog(UTF8ToString(msg), !!is_err);
});

static void logger(const char *msg, int is_err) { js_log(msg, is_err); }

/* emulator apps: the studio keeps the ROMs and saves (studio/roms.js); these reach it through Module.emu* */
EM_JS(char *, js_emu_roms, (const char *kind), {
  var s = Module.emuRoms ? Module.emuRoms(UTF8ToString(kind)) : null;
  return s ? Module.stringToNewUTF8(s) : 0;
});
EM_JS(void, js_emu_open, (int index), { if (Module.emuOpen) Module.emuOpen(index); });
EM_JS(void, js_emu_sram, (const char *name, const uint8_t *data, uint32_t len), {
  if (Module.emuSram) Module.emuSram(UTF8ToString(name), HEAPU8.slice(data, data + len));
});
EM_JS(void, js_emu_state_save, (const char *name, int slot, const uint8_t *data, uint32_t len), {
  if (Module.emuStateSave) Module.emuStateSave(UTF8ToString(name), slot, HEAPU8.slice(data, data + len));
});
EM_JS(void, js_emu_state_load, (const char *name, int slot), { if (Module.emuStateLoad) Module.emuStateLoad(UTF8ToString(name), slot); });
static const bk_emu_host web_emu = {js_emu_roms, js_emu_open, js_emu_sram, js_emu_state_save, js_emu_state_load};

EMSCRIPTEN_KEEPALIVE void bkw_init(void) { bk_machine_init(&machine); bk_set_logger(logger); bk_emu_set_host(&web_emu); }
EMSCRIPTEN_KEEPALIVE uint8_t *bkw_emu_rom_alloc(uint32_t len) { return bk_emu_rom_alloc(len); }
EMSCRIPTEN_KEEPALIVE int bkw_emu_start(const char *name) { return bk_emu_start(name); }
EMSCRIPTEN_KEEPALIVE const char *bkw_emu_error(void) { return bk_emu_error(); }
/* the battery save: its pointer, and its size in *len (0 = this game has none) */
EMSCRIPTEN_KEEPALIVE uint8_t *bkw_emu_sram(uint32_t *len) { return bk_emu_sram(len); }
EMSCRIPTEN_KEEPALIVE void bkw_emu_sram_loaded(void) { bk_emu_sram_loaded(); }
EMSCRIPTEN_KEEPALIVE int bkw_emu_state_load(const uint8_t *data, uint32_t len) { return bk_emu_state_load(data, len); }
EMSCRIPTEN_KEEPALIVE void bkw_emu_notify(const char *what, int ok) { bk_emu_notify(what, ok); }
EMSCRIPTEN_KEEPALIVE int bkw_emu_kind(void) { return bk_emu_kind(); }
EMSCRIPTEN_KEEPALIVE void bkw_emu_close(void) { bk_emu_close(); }
EMSCRIPTEN_KEEPALIVE int bkw_load(const char *code) { return bk_lua_load(code); }
EMSCRIPTEN_KEEPALIVE int bkw_load_ex(const char *data, const char *code) { return bk_lua_load_ex(data, code); }
EMSCRIPTEN_KEEPALIVE int bkw_eval(const char *code) { return bk_lua_eval(code); }
EMSCRIPTEN_KEEPALIVE void bkw_stop(void) { bk_lua_close(); for (int c = 0; c < BK_CHANNELS; c++) machine.voice[c].len = 0; }
/* player 1's input comes with the frame; set the others first with bkw_input */
EMSCRIPTEN_KEEPALIVE int bkw_frame(int mask, uint8_t *press) {
  bk_set_input(0, (uint16_t)mask, press);
  return bk_lua_frame();
}
EMSCRIPTEN_KEEPALIVE void bkw_input(int player, int mask, uint8_t *press) { bk_set_input(player - 1, (uint16_t)mask, press); }
/* players in the game and this window's player (0 = everyone shares this screen); set before loading a cart */
EMSCRIPTEN_KEEPALIVE void bkw_players(int n, int me) {
  machine.players = n < 1 ? 1 : (n > BK_MAX_PLAYERS ? BK_MAX_PLAYERS : n);
  machine.me = me < 0 ? 0 : (me > machine.players ? machine.players : me);
}
EMSCRIPTEN_KEEPALIVE uint32_t *bkw_render(void) { bk_to_rgba(rgba); return rgba; }
EMSCRIPTEN_KEEPALIVE float *bkw_audio(int frames) {
  if (frames > 4096) frames = 4096;
  bk_audio_render(audio_buf, frames);
  return audio_buf;
}
EMSCRIPTEN_KEEPALIVE uint8_t *bkw_palette(void) { return machine.palette; }
/* save data block: int32 len (-1 none), int32 dirty, char data[BK_SAVE_MAX] */
EMSCRIPTEN_KEEPALIVE int32_t *bkw_save(void) { return &machine.save.len; }
EMSCRIPTEN_KEEPALIVE uint8_t *bkw_tiles(void) { return machine.tiles; }
EMSCRIPTEN_KEEPALIVE uint8_t *bkw_flags(void) { return machine.flags; }
EMSCRIPTEN_KEEPALIVE uint16_t *bkw_map(void) { return machine.map; }
EMSCRIPTEN_KEEPALIVE uint8_t *bkw_screen(void) { return machine.screen; }
EMSCRIPTEN_KEEPALIVE void bkw_default_palette(void) { bk_default_palette(machine.palette); }
EMSCRIPTEN_KEEPALIVE int32_t *bkw_track(void) { return machine.track; }
EMSCRIPTEN_KEEPALIVE int32_t *bkw_sys(void) { return machine.sys; }
/* network events: int32 id, out_n, in_n, in_r, out[16][10], in[64][10] (see bk_machine.net) */
EMSCRIPTEN_KEEPALIVE int32_t *bkw_net(void) { return &machine.net.id; }
/* display shader: int32 scan, vignette, curve, split, blur, grain, bright, contrast, sat, warm (see bk_machine.display) */
EMSCRIPTEN_KEEPALIVE int32_t *bkw_display(void) { return &machine.display.scan; }
EMSCRIPTEN_KEEPALIVE const char *bkw_error(void) { return bk_lua_error(); }
