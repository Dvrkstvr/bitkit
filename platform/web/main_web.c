/* MiniBoi browser host: exposes the runtime to JavaScript. MIT License. */
#include "../../runtime/mb.h"
#include <emscripten.h>
#include <string.h>

static mb_machine machine;
static uint32_t rgba[MB_W * MB_H];
static float audio_buf[4096 * 2];

EM_JS(void, js_log, (const char *msg, int is_err), {
  if (Module.onLog) Module.onLog(UTF8ToString(msg), !!is_err);
});

static void logger(const char *msg, int is_err) { js_log(msg, is_err); }

EMSCRIPTEN_KEEPALIVE void mbw_init(void) { mb_machine_init(&machine); mb_set_logger(logger); }
EMSCRIPTEN_KEEPALIVE int mbw_load(const char *code) { return mb_lua_load(code); }
EMSCRIPTEN_KEEPALIVE int mbw_load_ex(const char *data, const char *code) { return mb_lua_load_ex(data, code); }
EMSCRIPTEN_KEEPALIVE void mbw_stop(void) { mb_lua_close(); for (int c = 0; c < MB_CHANNELS; c++) machine.voice[c].len = 0; }
EMSCRIPTEN_KEEPALIVE int mbw_frame(int mask, uint8_t *press) {
  mb_set_input((uint16_t)mask, press);
  return mb_lua_frame();
}
EMSCRIPTEN_KEEPALIVE uint32_t *mbw_render(void) { mb_to_rgba(rgba); return rgba; }
EMSCRIPTEN_KEEPALIVE float *mbw_audio(int frames) {
  if (frames > 4096) frames = 4096;
  mb_audio_render(audio_buf, frames);
  return audio_buf;
}
EMSCRIPTEN_KEEPALIVE uint8_t *mbw_palette(void) { return machine.palette; }
EMSCRIPTEN_KEEPALIVE uint8_t *mbw_tiles(void) { return machine.tiles; }
EMSCRIPTEN_KEEPALIVE uint8_t *mbw_flags(void) { return machine.flags; }
EMSCRIPTEN_KEEPALIVE uint16_t *mbw_map(void) { return machine.map; }
EMSCRIPTEN_KEEPALIVE uint8_t *mbw_screen(void) { return machine.screen; }
EMSCRIPTEN_KEEPALIVE void mbw_default_palette(void) { mb_default_palette(machine.palette); }
EMSCRIPTEN_KEEPALIVE const char *mbw_error(void) { return mb_lua_error(); }
