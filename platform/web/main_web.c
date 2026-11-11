/* BitKit browser host: exposes the runtime to JavaScript. MIT License. */
#include "../../runtime/bk.h"
#include <emscripten.h>
#include <string.h>

static bk_machine machine;
static uint32_t rgba[BK_W * BK_H];
static float audio_buf[4096 * 2];

EM_JS(void, js_log, (const char *msg, int is_err), {
  if (Module.onLog) Module.onLog(UTF8ToString(msg), !!is_err);
});

static void logger(const char *msg, int is_err) { js_log(msg, is_err); }

EMSCRIPTEN_KEEPALIVE void bkw_init(void) { bk_machine_init(&machine); bk_set_logger(logger); }
EMSCRIPTEN_KEEPALIVE int bkw_load(const char *code) { return bk_lua_load(code); }
EMSCRIPTEN_KEEPALIVE int bkw_load_ex(const char *data, const char *code) { return bk_lua_load_ex(data, code); }
EMSCRIPTEN_KEEPALIVE void bkw_stop(void) { bk_lua_close(); for (int c = 0; c < BK_CHANNELS; c++) machine.voice[c].len = 0; }
EMSCRIPTEN_KEEPALIVE int bkw_frame(int mask, uint8_t *press) {
  bk_set_input((uint16_t)mask, press);
  return bk_lua_frame();
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
EMSCRIPTEN_KEEPALIVE const char *bkw_error(void) { return bk_lua_error(); }
