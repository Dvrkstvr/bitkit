/* BitKit runtime: Lua 5.4 API bindings. MIT License. */
#include "bk.h"
#include "bk_prelude.h"
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

static lua_State *L = 0;
static char err_buf[1024];
static bk_log_fn logger = 0;
static int budget = 0;

#define HOOK_STEP 10000
#define FRAME_BUDGET 3000  /* x HOOK_STEP instructions per call (~30M) */

void bk_set_logger(bk_log_fn fn) { logger = fn; }
const char *bk_lua_error(void) { return err_buf; }

static void log_msg(const char *s, int is_err) { if (logger) logger(s, is_err); }

static int opti(lua_State *l, int i, int d) {
  if (lua_isnoneornil(l, i)) return d;
  return (int)floor(luaL_checknumber(l, i));
}
static double optn(lua_State *l, int i, double d) {
  return lua_isnoneornil(l, i) ? d : luaL_checknumber(l, i);
}
static int ci(lua_State *l, int i) { return (int)floor(luaL_checknumber(l, i)); }

/* ---- graphics ---- */
static int l_cls(lua_State *l) { bk_cls(opti(l, 1, 0)); return 0; }
static int l_pset(lua_State *l) { bk_pset(ci(l, 1), ci(l, 2), ci(l, 3)); return 0; }
static int l_pget(lua_State *l) { lua_pushinteger(l, bk_pget(ci(l, 1), ci(l, 2))); return 1; }
static int l_line(lua_State *l) { bk_line(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4), ci(l, 5)); return 0; }
static int l_rect(lua_State *l) { bk_rect(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4), ci(l, 5)); return 0; }
static int l_rectfill(lua_State *l) { bk_rectfill(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4), ci(l, 5)); return 0; }
static int l_circ(lua_State *l) { bk_circ(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4)); return 0; }
static int l_circfill(lua_State *l) { bk_circfill(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4)); return 0; }

static int l_text(lua_State *l) {
  int x = opti(l, 2, 0), y = opti(l, 3, 0), c = opti(l, 4, 13), sc = opti(l, 5, 1);
  const char *s = luaL_tolstring(l, 1, NULL);
  int w = bk_text(s, x, y, c, sc);
  lua_pushinteger(l, w);
  return 1;
}

static int l_spr(lua_State *l) {
  bk_spr(ci(l, 1), ci(l, 2), ci(l, 3), opti(l, 4, 1), opti(l, 5, 1),
         lua_toboolean(l, 6), lua_toboolean(l, 7), opti(l, 8, 1));
  return 0;
}

static int l_map(lua_State *l) {
  bk_map(opti(l, 1, 0), opti(l, 2, 0), opti(l, 3, 40), opti(l, 4, 30), opti(l, 5, 0), opti(l, 6, 0));
  return 0;
}

static int l_mget(lua_State *l) {
  int x = ci(l, 1), y = ci(l, 2);
  int v = (x < 0 || y < 0 || x >= BK_MAP_W || y >= BK_MAP_H) ? 0 : BK->map[y * BK_MAP_W + x];
  lua_pushinteger(l, v);
  return 1;
}

static int l_mset(lua_State *l) {
  int x = ci(l, 1), y = ci(l, 2), t = ci(l, 3);
  if (x >= 0 && y >= 0 && x < BK_MAP_W && y < BK_MAP_H) BK->map[y * BK_MAP_W + x] = (uint16_t)(t & 0x1FF);
  return 0;
}

static int l_fget(lua_State *l) {
  int n = ci(l, 1);
  int f = (n >= 0 && n < BK_TILES) ? BK->flags[n] : 0;
  if (lua_isnoneornil(l, 2)) lua_pushinteger(l, f);
  else lua_pushboolean(l, (f >> (ci(l, 2) & 7)) & 1);
  return 1;
}

static int l_fset(lua_State *l) {
  int n = ci(l, 1);
  if (n < 0 || n >= BK_TILES) return 0;
  if (lua_gettop(l) == 2) BK->flags[n] = (uint8_t)ci(l, 2);
  else {
    int b = ci(l, 2) & 7;
    if (lua_toboolean(l, 3)) BK->flags[n] |= (uint8_t)(1 << b);
    else BK->flags[n] &= (uint8_t)~(1 << b);
  }
  return 0;
}

static int l_camera(lua_State *l) { BK->cam_x = opti(l, 1, 0); BK->cam_y = opti(l, 2, 0); return 0; }

static int l_clip(lua_State *l) {
  if (lua_gettop(l) == 0) { BK->clip_x0 = BK->clip_y0 = 0; BK->clip_x1 = BK_W; BK->clip_y1 = BK_H; return 0; }
  int x = ci(l, 1), y = ci(l, 2), w = ci(l, 3), h = ci(l, 4);
  BK->clip_x0 = x < 0 ? 0 : x; BK->clip_y0 = y < 0 ? 0 : y;
  BK->clip_x1 = x + w > BK_W ? BK_W : x + w; BK->clip_y1 = y + h > BK_H ? BK_H : y + h;
  return 0;
}

static int l_pal(lua_State *l) {
  if (lua_gettop(l) == 0) { for (int i = 0; i < 256; i++) BK->draw_pal[i] = (uint8_t)i; return 0; }
  if (lua_gettop(l) == 1) { /* pal(c): draw every colour as c (flash / tint) */
    uint8_t c = (uint8_t)ci(l, 1);
    for (int i = 0; i < 256; i++) BK->draw_pal[i] = c;
    return 0;
  }
  BK->draw_pal[ci(l, 1) & 255] = (uint8_t)ci(l, 2);
  return 0;
}

/* palette(i) -> r,g,b   palette(i, r, g, b) sets the hardware colour */
static int l_palette(lua_State *l) {
  int i = ci(l, 1) & 255;
  if (lua_gettop(l) >= 4) {
    BK->palette[i * 3] = (uint8_t)ci(l, 2); BK->palette[i * 3 + 1] = (uint8_t)ci(l, 3); BK->palette[i * 3 + 2] = (uint8_t)ci(l, 4);
    return 0;
  }
  for (int k = 0; k < 3; k++) lua_pushinteger(l, BK->palette[i * 3 + k]);
  return 3;
}

static int l_palt(lua_State *l) {
  if (lua_gettop(l) == 0) { memset(BK->transparent, 0, 256); BK->transparent[0] = 1; return 0; }
  BK->transparent[ci(l, 1) & 255] = (uint8_t)lua_toboolean(l, 2);
  return 0;
}

/* ---- input ---- */
static const char *BTN_NAMES[BK_NUM_BUTTONS] = {
  "left", "right", "up", "down", "a", "b", "x", "y", "l", "r", "start", "select"
};

static int btn_index(lua_State *l, int i) {
  if (lua_type(l, i) == LUA_TSTRING) {
    const char *s = lua_tostring(l, i);
    for (int k = 0; k < BK_NUM_BUTTONS; k++) if (strcmp(s, BTN_NAMES[k]) == 0) return k;
    return luaL_error(l, "unknown button '%s'", s);
  }
  return ci(l, i);
}

static int l_btn(lua_State *l) {
  if (lua_isnoneornil(l, 1)) { lua_pushinteger(l, BK->btn); return 1; }
  lua_pushboolean(l, bk_btn(btn_index(l, 1)));
  return 1;
}
static int l_btnp(lua_State *l) { lua_pushboolean(l, bk_btnp(btn_index(l, 1))); return 1; }
static int l_btnr(lua_State *l) {
  int i = btn_index(l, 1);
  lua_pushboolean(l, i >= 0 && i < BK_NUM_BUTTONS && ((BK->btn_prev >> i) & 1) && !((BK->btn >> i) & 1));
  return 1;
}
static int l_press(lua_State *l) {
  int i = btn_index(l, 1);
  lua_pushinteger(l, (i >= 0 && i < BK_NUM_BUTTONS) ? BK->press[i] : 0);
  return 1;
}

/* ---- time / rng ---- */
static int l_t(lua_State *l) { lua_pushinteger(l, BK->frame); return 1; }
static int l_time(lua_State *l) { lua_pushnumber(l, BK->frame / (double)BK_FPS); return 1; }

/* rnd() -> float [0,1)   rnd(n) -> int 1..n   rnd(a,b) -> int a..b  (deterministic) */
static int l_rnd(lua_State *l) {
  int n = lua_gettop(l);
  if (n == 0) { lua_pushnumber(l, bk_rand32() / 4294967296.0); return 1; }
  lua_Integer a = 1, b;
  if (n == 1) b = luaL_checkinteger(l, 1);
  else { a = luaL_checkinteger(l, 1); b = luaL_checkinteger(l, 2); }
  if (b < a) return luaL_error(l, "rnd: empty range");
  lua_Unsigned span = (lua_Unsigned)(b - a) + 1;
  lua_pushinteger(l, a + (lua_Integer)(bk_rand32() % (span ? span : 1)));
  return 1;
}
static int l_srand(lua_State *l) { bk_srand((uint64_t)luaL_checkinteger(l, 1)); return 0; }

/* ---- audio ---- */
static double note_freq(lua_State *l, int i) {
  if (lua_type(l, i) == LUA_TSTRING) {
    const char *s = lua_tostring(l, i);
    static const int base[7] = {9, 11, 0, 2, 4, 5, 7}; /* A B C D E F G */
    char c = (char)(s[0] | 32);
    if (c < 'a' || c > 'g') return luaL_error(l, "bad note '%s'", s);
    int semi = base[c - 'a'], k = 1;
    if (s[k] == '#') { semi++; k++; } else if (s[k] == 'b') { semi--; k++; }
    int oct = s[k] ? atoi(s + k) : 4;
    int midi = (oct + 1) * 12 + semi;
    return 440.0 * pow(2.0, (midi - 69) / 12.0);
  }
  double m = luaL_checknumber(l, i);
  return 440.0 * pow(2.0, (m - 69) / 12.0);
}

/* sfx(note, [wave=0], [vol=0.8], [frames=8], [ch=auto], [pan=0], [slide=0 Hz/s]) */
static int l_sfx(lua_State *l) {
  double f = note_freq(l, 1);
  int ch = opti(l, 5, -1);
  if (ch < 0) {
    ch = 0;
    int best = 0x7fffffff;
    for (int c = 0; c < BK_CHANNELS; c++) {
      int left = BK->voice[c].len - BK->voice[c].pos;
      if (left < best) { best = left; ch = c; }
    }
  }
  bk_sfx(ch, (float)f, opti(l, 2, 0), (float)optn(l, 3, 0.8), opti(l, 4, 8), (float)optn(l, 6, 0), (float)optn(l, 7, 0));
  lua_pushinteger(l, ch);
  return 1;
}
/* tone(hz, ...) same as sfx but raw frequency */
static int l_tone(lua_State *l) {
  int ch = opti(l, 5, 0);
  bk_sfx(ch, (float)luaL_checknumber(l, 1), opti(l, 2, 0), (float)optn(l, 3, 0.8), opti(l, 4, 8), (float)optn(l, 6, 0), (float)optn(l, 7, 0));
  return 0;
}
static int l_stop(lua_State *l) {
  if (lua_isnoneornil(l, 1)) { for (int c = 0; c < BK_CHANNELS; c++) BK->voice[c].len = 0; }
  else { int c = ci(l, 1); if (c >= 0 && c < BK_CHANNELS) BK->voice[c].len = 0; }
  return 0;
}

/* track(x, y): report the player's position (world pixels) for the studio's route overlay.
   ents_player() calls it for you. */
static int l_track(lua_State *l) {
  BK->track[0] = ci(l, 1); BK->track[1] = ci(l, 2); BK->track[2] = 1;
  return 0;
}

/* launch(n, [edit]): ask the host to start game n from the Bit's library (the home screen uses this).
   With edit true the studio opens it for editing instead (command 3).
   home(): ask the host to go back to the home screen. The host acts after the frame. */
static int l_launch(lua_State *l) { BK->sys[0] = lua_toboolean(l, 2) ? 3 : 1; BK->sys[1] = ci(l, 1); return 0; }
static int l_home(lua_State *l) { (void)l; BK->sys[0] = 2; BK->sys[1] = 0; return 0; }

/* ---- print -> console ---- */
static int l_print(lua_State *l) {
  int n = lua_gettop(l);
  luaL_Buffer b;
  luaL_buffinit(l, &b);
  for (int i = 1; i <= n; i++) {
    luaL_tolstring(l, i, NULL);
    luaL_addvalue(&b);
    if (i < n) luaL_addchar(&b, '\t');
  }
  luaL_pushresult(&b);
  log_msg(lua_tostring(l, -1), 0);
  return 0;
}

static const luaL_Reg API[] = {
  {"cls", l_cls}, {"pset", l_pset}, {"pget", l_pget}, {"line", l_line},
  {"rect", l_rect}, {"rectfill", l_rectfill}, {"circ", l_circ}, {"circfill", l_circfill},
  {"text", l_text}, {"spr", l_spr}, {"map", l_map}, {"mget", l_mget}, {"mset", l_mset},
  {"fget", l_fget}, {"fset", l_fset}, {"camera", l_camera}, {"clip", l_clip},
  {"pal", l_pal}, {"palt", l_palt}, {"palette", l_palette},
  {"btn", l_btn}, {"btnp", l_btnp}, {"btnr", l_btnr}, {"press", l_press},
  {"t", l_t}, {"time", l_time}, {"rnd", l_rnd}, {"srand", l_srand},
  {"sfx", l_sfx}, {"tone", l_tone}, {"stop", l_stop},
  {"print", l_print}, {"track", l_track}, {"launch", l_launch}, {"home", l_home},
  {NULL, NULL}
};

static void hook(lua_State *l, lua_Debug *ar) {
  (void)ar;
  if (--budget <= 0) luaL_error(l, "script ran too long without finishing a frame (infinite loop?)");
}

static int traceback(lua_State *l) {
  const char *msg = lua_tostring(l, 1);
  luaL_traceback(l, l, msg ? msg : "(error)", 1);
  return 1;
}

static int pcall_budget(int nargs) {
  int base = lua_gettop(L) - nargs;
  lua_pushcfunction(L, traceback);
  lua_insert(L, base);
  budget = FRAME_BUDGET;
  int r = lua_pcall(L, nargs, 0, base);
  lua_remove(L, base);
  if (r != LUA_OK) {
    snprintf(err_buf, sizeof(err_buf), "%s", lua_tostring(L, -1));
    lua_pop(L, 1);
    log_msg(err_buf, 1);
  }
  return r;
}

void bk_lua_close(void) { if (L) lua_close(L); L = 0; }

static int run_chunk(const char *src, const char *name) {
  if (luaL_loadbufferx(L, src, strlen(src), name, "t") != LUA_OK) {
    snprintf(err_buf, sizeof(err_buf), "%s", lua_tostring(L, -1));
    log_msg(err_buf, 1);
    return 1;
  }
  return pcall_budget(0) != LUA_OK;
}

int bk_lua_load(const char *code) { return bk_lua_load_ex(0, code); }

int bk_lua_load_ex(const char *data, const char *code) {
  bk_lua_close();
  err_buf[0] = 0;
  L = luaL_newstate();
  /* Only safe, deterministic libs: no io/os/package/debug. */
  luaL_requiref(L, LUA_GNAME, luaopen_base, 1);
  luaL_requiref(L, LUA_TABLIBNAME, luaopen_table, 1);
  luaL_requiref(L, LUA_STRLIBNAME, luaopen_string, 1);
  luaL_requiref(L, LUA_MATHLIBNAME, luaopen_math, 1);
  luaL_requiref(L, LUA_COLIBNAME, luaopen_coroutine, 1);
  luaL_requiref(L, LUA_UTF8LIBNAME, luaopen_utf8, 1);
  lua_settop(L, 0);
  /* math.random -> deterministic engine rng */
  lua_getglobal(L, "math");
  lua_pushcfunction(L, l_rnd); lua_setfield(L, -2, "random");
  lua_pushcfunction(L, l_srand); lua_setfield(L, -2, "randomseed");
  lua_pop(L, 1);
  lua_pushnil(L); lua_setglobal(L, "dofile");
  lua_pushnil(L); lua_setglobal(L, "loadfile");
  lua_pushglobaltable(L);
  luaL_setfuncs(L, API, 0);
  lua_pop(L, 1);
  lua_sethook(L, hook, LUA_MASKCOUNT, HOOK_STEP);

  bk_reset_draw_state();
  BK->frame = 0;
  for (int c = 0; c < BK_CHANNELS; c++) BK->voice[c].len = 0;

  if (run_chunk(bk_prelude_lua, "=entities-runtime")) return 1;
  if (data && data[0] && run_chunk(data, "=entities")) return 1;
  if (luaL_loadbufferx(L, code, strlen(code), "=cart", "t") != LUA_OK) {
    snprintf(err_buf, sizeof(err_buf), "%s", lua_tostring(L, -1));
    log_msg(err_buf, 1);
    return 1;
  }
  if (pcall_budget(0) != LUA_OK) return 1;
  lua_getglobal(L, "_init");
  if (lua_isfunction(L, -1)) { if (pcall_budget(0) != LUA_OK) return 1; }
  else lua_pop(L, 1);
  return 0;
}

int bk_lua_frame(void) {
  if (!L) return 1;
  BK->track[2] = 0;
  BK->sys[0] = 0;
  lua_getglobal(L, "_update");
  if (lua_isfunction(L, -1)) { if (pcall_budget(0) != LUA_OK) return 1; }
  else lua_pop(L, 1);
  lua_getglobal(L, "_draw");
  if (lua_isfunction(L, -1)) { if (pcall_budget(0) != LUA_OK) return 1; }
  else lua_pop(L, 1);
  BK->frame++;
  return 0;
}
