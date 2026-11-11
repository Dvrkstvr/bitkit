/* BitKit runtime: Lua 5.4 API bindings. MIT License. */
#include "bk.h"
#include "bk_prelude.h"
#include "bk_emu.h"
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
#include <string.h>
#include <time.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

static lua_State *L = 0;
static char err_buf[1024];
static bk_log_fn logger = 0;
static int budget = 0;
static bk_alloc_fn alloc_fn = 0;
static void *alloc_ud = 0;

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
static int l_shade(lua_State *l) { bk_shade((float)optn(l, 1, 0.5)); return 0; }
/* ---- screen shaders (bk_core.c) ---- */
static int l_tint(lua_State *l) { bk_tint(ci(l, 1), (float)optn(l, 2, 0.5)); return 0; }
static int l_fog(lua_State *l) {
  bk_fog(ci(l, 1), ci(l, 2), ci(l, 3), (float)optn(l, 4, 1), (float)optn(l, 5, 0));
  return 0;
}
static int l_dither(lua_State *l) { bk_dither(ci(l, 1), (float)optn(l, 2, 0.5)); return 0; }
/* remap({[from] = to, ...}) or remap(from, to, [from2, to2, ...]) */
static int l_remap(lua_State *l) {
  uint8_t lut[256];
  for (int i = 0; i < 256; i++) lut[i] = (uint8_t)i;
  if (lua_istable(l, 1)) {
    lua_pushnil(l);
    while (lua_next(l, 1)) {
      if (lua_isnumber(l, -2) && lua_isnumber(l, -1)) {
        lua_Integer k = lua_tointeger(l, -2);
        if (k >= 0 && k < 256) lut[k] = (uint8_t)(lua_tointeger(l, -1) & 255);
      }
      lua_pop(l, 1);
    }
  } else {
    int n = lua_gettop(l);
    for (int i = 1; i + 1 <= n; i += 2) { int k = ci(l, i); if (k >= 0 && k < 256) lut[k] = (uint8_t)(ci(l, i + 1) & 255); }
  }
  bk_remap(lut);
  return 0;
}
/* wave(amp, [len=32], [speed=1], [vertical]): speed in waves per second, driven by the frame count */
static int l_wave(lua_State *l) {
  float speed = (float)optn(l, 3, 1);
  bk_wave((float)luaL_checknumber(l, 1), (float)optn(l, 2, 32), (float)BK->frame * speed / BK_FPS, lua_toboolean(l, 4));
  return 0;
}
static int l_ripple(lua_State *l) {
  bk_ripple(ci(l, 1), ci(l, 2), (float)luaL_checknumber(l, 3), (float)optn(l, 4, 4), (float)optn(l, 5, 10));
  return 0;
}
static int l_pixelate(lua_State *l) { bk_pixelate(opti(l, 1, 4)); return 0; }
static int l_glitch(lua_State *l) { bk_glitch((float)optn(l, 1, 0.5), (uint32_t)opti(l, 2, (int)BK->frame)); return 0; }

/* sprfx{outline=, flash=, flash_amount=, light=, light_x=, light_y=, light_at={x, y}, dissolve=, silhouette=,
   shadow=, shadow_x=, shadow_y=, shader=function(x, y, c, w, h) return c end}   sprfx() turns them off */
static int sfx_ref = LUA_NOREF;
static int sfx_call(int x, int y, int c, int w, int h) {
  lua_rawgeti(L, LUA_REGISTRYINDEX, sfx_ref);
  lua_pushinteger(L, x); lua_pushinteger(L, y);
  if (c < 0) lua_pushnil(L); else lua_pushinteger(L, c);
  lua_pushinteger(L, w); lua_pushinteger(L, h);
  lua_call(L, 5, 1);
  int r = lua_isinteger(L, -1) || lua_isnumber(L, -1) ? (int)lua_tointeger(L, -1) : -1;
  lua_pop(L, 1);
  return r;
}
static void sfx_clear(lua_State *l) {
  if (sfx_ref != LUA_NOREF && l) luaL_unref(l, LUA_REGISTRYINDEX, sfx_ref);
  sfx_ref = LUA_NOREF;
  bk_sprfx_reset();
}
static float fieldn(lua_State *l, const char *k, float d) {
  float v = d;
  if (lua_getfield(l, 1, k) == LUA_TNUMBER) v = (float)lua_tonumber(l, -1);
  else if (lua_isboolean(l, -1) && !lua_toboolean(l, -1)) v = d;
  lua_pop(l, 1);
  return v;
}
static int l_sprfx(lua_State *l) {
  sfx_clear(l);
  if (lua_isnoneornil(l, 1)) return 0;
  luaL_checktype(l, 1, LUA_TTABLE);
  bk_sprfx_t *f = &bk_sprfx;
  f->outline = (int)fieldn(l, "outline", -1);
  f->flash = (int)fieldn(l, "flash", -1);
  f->flash_k = fieldn(l, "flash_amount", 1);
  f->light = fieldn(l, "light", 0);
  f->lx = fieldn(l, "light_x", -1); f->ly = fieldn(l, "light_y", -1);
  if (lua_getfield(l, 1, "light_at") == LUA_TTABLE) {
    lua_rawgeti(l, -1, 1); lua_rawgeti(l, -2, 2);
    f->light_at = 1; f->lpx = (float)luaL_optnumber(l, -2, 0); f->lpy = (float)luaL_optnumber(l, -1, 0);
    lua_pop(l, 2);
    if (f->light <= 0) f->light = 0.6f;
  }
  lua_pop(l, 1);
  f->dissolve = fieldn(l, "dissolve", 0);
  f->silhouette = (int)fieldn(l, "silhouette", -1);
  f->shadow = (int)fieldn(l, "shadow", -1);
  f->sdx = (int)fieldn(l, "shadow_x", 1); f->sdy = (int)fieldn(l, "shadow_y", 1);
  if (lua_getfield(l, 1, "shader") == LUA_TFUNCTION) { sfx_ref = luaL_ref(l, LUA_REGISTRYINDEX); f->fn = sfx_call; }
  else lua_pop(l, 1);
  f->on = f->outline >= 0 || (f->flash >= 0 && f->flash_k > 0) || f->light > 0 || f->dissolve > 0 || f->silhouette >= 0 || f->shadow >= 0 || f->fn;
  return 0;
}

/* raster(fn): fn(y) for every row of the clip rectangle; it returns dx (slide the row), and optionally c, amount
   to tint the row. Your own scanline shader: 240 calls a frame at most, cheap enough for the device. */
static int l_raster(lua_State *l) {
  luaL_checktype(l, 1, LUA_TFUNCTION);
  const int y0 = BK->clip_y0, y1 = BK->clip_y1;
  for (int y = y0; y < y1; y++) {
    lua_pushvalue(l, 1); lua_pushinteger(l, y);
    lua_call(l, 1, 3);
    if (lua_isnumber(l, -3)) bk_row_shift(y, (int)lround(lua_tonumber(l, -3)));
    if (lua_isnumber(l, -2) && lua_isnumber(l, -1)) bk_row_tint(y, (int)lua_tointeger(l, -2), (float)lua_tonumber(l, -1));
    lua_pop(l, 3);
  }
  return 0;
}

/* display() off | display("crt") a preset | display{scanlines=0.4, curve=0.3, ..., look="crt"} */
static int l_display(lua_State *l) {
  if (lua_isnoneornil(l, 1)) { bk_display_reset(); return 0; }
  if (lua_type(l, 1) == LUA_TSTRING) {
    if (!bk_display_preset(lua_tostring(l, 1))) luaL_error(l, "display: no look called \"%s\" (try off, crt, arcade, old tv, handheld, sepia, night, vivid)", lua_tostring(l, 1));
    return 0;
  }
  luaL_checktype(l, 1, LUA_TTABLE);
  bk_display_reset();
  if (lua_getfield(l, 1, "look") == LUA_TSTRING && !bk_display_preset(lua_tostring(l, -1)))
    luaL_error(l, "display: no look called \"%s\"", lua_tostring(l, -1));
  lua_pop(l, 1);
  static const char *F[] = { "scanlines", "vignette", "curve", "split", "blur", "grain", "bright", "contrast", "saturation", "warm" };
  int32_t *v = &BK->display.scan;
  for (int i = 0; i < 10; i++) {
    if (lua_getfield(l, 1, F[i]) == LUA_TNUMBER) {
      double x = lua_tonumber(l, -1);
      if (i == 3) v[i] = (int32_t)(x < 0 ? 0 : x > 4 ? 4 : x);                  /* split: pixels */
      else { double lo = i >= 6 ? -1 : 0; x = x < lo ? lo : x > 1 ? 1 : x; v[i] = (int32_t)lround(x * 100); }
    }
    lua_pop(l, 1);
  }
  return 0;
}
static int l_circ(lua_State *l) { bk_circ(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4)); return 0; }
static int l_circfill(lua_State *l) { bk_circfill(ci(l, 1), ci(l, 2), ci(l, 3), ci(l, 4)); return 0; }

/* ---- languages ----
   texts{de = {["Start"] = "Los"}, fr = {...}} adds a cart's words (kept in _TEXTS); _SYSTEXT holds the Bit's own (game shell,
   bk_lang.lua). A word is looked up as written, then with its numbers swapped for # ("SCORE 120" finds "SCORE #"). */
static char cur_lang[8] = "en";
void bk_lang_set(const char *code) {
  char t[8]; size_t n = 0;
  for (; code && code[n] && n < sizeof(t) - 1; n++) {
    char ch = code[n];
    if (ch >= 'A' && ch <= 'Z') ch = (char)(ch + 32);
    if (!((ch >= 'a' && ch <= 'z') || ch == '-' || ch == '_')) { n = 0; break; }
    t[n] = ch;
  }
  t[n] = 0;
  snprintf(cur_lang, sizeof(cur_lang), "%s", n ? t : "en");
}
const char *bk_lang_get(void) { return cur_lang; }

/* t[lang][key] for the table at index t (absolute); pushes the word and returns 1, or returns 0 */
static int tx_in(lua_State *l, int t, int key) {
  if (lua_type(l, t) != LUA_TTABLE) return 0;
  if (lua_getfield(l, t, cur_lang) != LUA_TTABLE) { lua_pop(l, 1); return 0; }
  lua_pushvalue(l, key);
  if (lua_rawget(l, -2) == LUA_TSTRING) { lua_remove(l, -2); return 1; }
  lua_pop(l, 2);
  return 0;
}
/* the word for the key at index key in the cart's texts (and the Bit's own when sys): pushes it, or returns 0 */
static int tx_key(lua_State *l, int key, int sys) {
  int found = 0;
  if (lua_getglobal(l, "_TEXTS") == LUA_TTABLE) {
    int list = lua_gettop(l);
    for (lua_Integer i = (lua_Integer)lua_rawlen(l, list); i >= 1 && !found; i--) {
      lua_rawgeti(l, list, i);
      found = tx_in(l, lua_gettop(l), key);
      if (found) lua_remove(l, -2); else lua_pop(l, 1);
    }
  }
  if (found) { lua_remove(l, -2); return 1; }
  lua_pop(l, 1);
  if (!sys) return 0;
  lua_getglobal(l, "_SYSTEXT");
  found = tx_in(l, lua_gettop(l), key);
  lua_remove(l, found ? -2 : -1);
  return found;
}
static int is_dig(char c) { return c >= '0' && c <= '9'; }
/* s translated for the current language: pushes it and returns 1, or returns 0 (no words for it) */
static int tx_find(lua_State *l, const char *s, size_t len, int sys) {
  lua_pushlstring(l, s, len);
  int k = lua_gettop(l);
  if (tx_key(l, k, sys)) { lua_remove(l, k); return 1; }
  lua_pop(l, 1);
  /* numbers -> #: "LAP 2/3" finds "LAP #/#", and the numbers go back in order */
  size_t nd = 0;
  for (size_t i = 0; i < len; i++) if (is_dig(s[i])) { nd = 1; break; }
  if (!nd || len > 200) return 0;
  char tpl[208]; const char *num[16]; size_t nlen[16]; int nn = 0; size_t o = 0;
  for (size_t i = 0; i < len;) {
    if (is_dig(s[i])) {
      size_t j = i;
      while (j < len && (is_dig(s[j]) || (s[j] == '.' && j + 1 < len && is_dig(s[j + 1]) && j > i))) j++;
      if (nn < 16) { num[nn] = s + i; nlen[nn] = j - i; nn++; }
      tpl[o++] = '#'; i = j;
    } else tpl[o++] = s[i++];
  }
  lua_pushlstring(l, tpl, o);
  k = lua_gettop(l);
  if (!tx_key(l, k, sys)) { lua_pop(l, 1); return 0; }
  size_t rl; const char *r = lua_tolstring(l, -1, &rl);
  luaL_Buffer b; luaL_buffinit(l, &b);
  int ni = 0;
  for (size_t i = 0; i < rl; i++) {
    if (r[i] == '#' && ni < nn) { luaL_addlstring(&b, num[ni], nlen[ni]); ni++; }
    else luaL_addchar(&b, r[i]);
  }
  luaL_pushresult(&b);
  lua_replace(l, k);
  lua_settop(l, k);
  return 1;
}
/* the string at the top of the stack in the Bit's one-byte encoding (UTF-8 letters -> Windows-1252), so #s counts letters */
static void to_1252(lua_State *l) {
  size_t n; const char *s = lua_tolstring(l, -1, &n);
  int multi = 0;
  for (size_t i = 0; i < n; i++) if ((unsigned char)s[i] >= 0xC2) { multi = 1; break; }
  if (!multi) return;
  luaL_Buffer b; luaL_buffinit(l, &b);
  const char *p = s; int c;
  while ((c = bk_glyph_next(&p))) luaL_addchar(&b, (char)c);
  luaL_pushresult(&b);
  lua_remove(l, -2);
}
/* _texts_auto(on): text() translating on its own (texts(false) in bk_lang.lua) */
static int l_texts_auto(lua_State *l) {
  if (lua_toboolean(l, 1)) lua_pushnil(l); else lua_pushboolean(l, 1);
  lua_setfield(l, LUA_REGISTRYINDEX, "bk_tx_off");
  return 0;
}
/* lang() -> "en", "de", ... the language picked in the Bit's Settings */
static int l_lang(lua_State *l) { lua_pushstring(l, cur_lang); return 1; }
/* tr("Start") -> the word for the Bit's language (from texts{} or the Bit's own), else the string as it is.
   tr("%d coins", n) translates, then formats. tr{en = "Start", de = "Los"} picks one (en when there's none). */
static int l_tr(lua_State *l) {
  int n = lua_gettop(l);
  if (lua_type(l, 1) == LUA_TTABLE) {
    if (lua_getfield(l, 1, cur_lang) != LUA_TSTRING) { lua_pop(l, 1); lua_getfield(l, 1, "en"); }
    if (!lua_isstring(l, -1)) { lua_pop(l, 1); lua_rawgeti(l, 1, 1); }
    if (!lua_isstring(l, -1)) { lua_pop(l, 1); lua_pushliteral(l, ""); }
  } else {
    size_t len; const char *s = luaL_tolstring(l, 1, &len);
    if (!tx_find(l, s, len, 1)) lua_pushvalue(l, -1);
    lua_remove(l, -2);
  }
  if (n > 1) {
    lua_getglobal(l, "string"); lua_getfield(l, -1, "format"); lua_remove(l, -2);
    lua_insert(l, -2);
    for (int i = 2; i <= n; i++) lua_pushvalue(l, i);
    lua_call(l, n, 1);
  }
  to_1252(l);
  return 1;
}
/* textw(s, [scale]) -> how wide text(s) is in pixels (the widest line) */
static int l_textw(lua_State *l) {
  int sc = opti(l, 2, 1);
  const char *s = luaL_tolstring(l, 1, NULL);
  lua_pushinteger(l, bk_text_len(s, NULL) * 8 * (sc < 1 ? 1 : sc));
  return 1;
}

/* text() draws a cart's own words in the Bit's language when texts{} has them (texts(false) turns that off). A word
   that gets longer or shorter keeps its place: centred on the screen stays centred, at the right edge stays there. */
static int l_text(lua_State *l) {
  int x = opti(l, 2, 0), y = opti(l, 3, 0), c = opti(l, 4, 13), sc = opti(l, 5, 1);
  size_t len;
  const char *s = luaL_tolstring(l, 1, &len);
  if (sc < 1) sc = 1;
  int on = 0;
  if (lua_type(l, 1) == LUA_TSTRING) { on = lua_getfield(l, LUA_REGISTRYINDEX, "bk_tx_off") == LUA_TNIL; lua_pop(l, 1); }
  if (on) {
    if (tx_find(l, s, len, 0)) {
      int lines, lines2;
      int n0 = bk_text_len(s, &lines);
      const char *t = lua_tostring(l, -1);
      int n1 = bk_text_len(t, &lines2);
      if (n1 != n0 && lines == 1 && lines2 == 1) {
        int sx = x - BK->cam_x, w0 = n0 * 8 * sc, mid = sx + w0 / 2;
        if (sx > 8 && mid >= 156 && mid <= 164) x -= (n1 - n0) * 4 * sc;
        else if (sx >= 160 && sx + w0 >= 300) x -= (n1 - n0) * 8 * sc;
        if (x - BK->cam_x < 0 && sx >= 0) x = BK->cam_x;
      }
      s = t;
    }
  }
  int w = bk_text(s, x, y, c, sc);
  lua_pushinteger(l, w);
  return 1;
}

/* font() classic | font("bold") | font("slant", outline_colour) | font(n) */
static int l_font(lua_State *l) {
  static const char *N[] = { "classic", "bold", "slant", "heavy" };
  int st = 0;
  if (lua_type(l, 1) == LUA_TSTRING) {
    const char *n = lua_tostring(l, 1); st = -1;
    for (int i = 0; i < 4; i++) if (!strcmp(n, N[i])) st = i;
    if (st < 0) return luaL_error(l, "font: no font called \"%s\" (try classic, bold, slant, heavy)", n);
  } else st = opti(l, 1, 0);
  bk_font(st, opti(l, 2, -1));
  return 0;
}

/* sget(x, y) / sset(x, y, c): one pixel of the tile sheet (16 tiles = 128 pixels wide, 256 tall),
   so a cart can paint a picture once and then draw it every frame with one spr() */
static int sheet_at(int x, int y) {
  if (x < 0 || x >= 128 || y < 0 || y >= (BK_TILES / 16) * 8) return -1;
  return ((y >> 3) * 16 + (x >> 3)) * BK_TILE_BYTES + (y & 7) * 8 + (x & 7);
}
static int l_sget(lua_State *l) { int o = sheet_at(ci(l, 1), ci(l, 2)); lua_pushinteger(l, o < 0 ? 0 : BK->tiles[o]); return 1; }
static int l_sset(lua_State *l) { int o = sheet_at(ci(l, 1), ci(l, 2)); if (o >= 0) BK->tiles[o] = (uint8_t)ci(l, 3); return 0; }

static int l_spr(lua_State *l) {
  bk_spr(ci(l, 1), ci(l, 2), ci(l, 3), opti(l, 4, 1), opti(l, 5, 1),
         lua_toboolean(l, 6), lua_toboolean(l, 7), opti(l, 8, 1));
  return 0;
}

static int l_map(lua_State *l) {
  bk_map(opti(l, 1, 0), opti(l, 2, 0), opti(l, 3, 40), opti(l, 4, 30), opti(l, 5, 0), opti(l, 6, 0));
  return 0;
}

/* floor(x, y, angle, height, horizon, [focal=160], [outside=-1], [step=1]) */
static int l_floorplane(lua_State *l) {
  bk_floor((float)luaL_checknumber(l, 1), (float)luaL_checknumber(l, 2), (float)luaL_checknumber(l, 3),
           (float)luaL_checknumber(l, 4), ci(l, 5), (float)optn(l, 6, 160), opti(l, 7, -1), opti(l, 8, 1));
  return 0;
}
/* project(x, y, [z=0]) -> sx, sy, scale, dist   (nil when behind the camera) */
static int l_project(lua_State *l) {
  float sx, sy, sc, d;
  if (!bk_project((float)luaL_checknumber(l, 1), (float)luaL_checknumber(l, 2), (float)optn(l, 3, 0), &sx, &sy, &sc, &d)) {
    lua_pushnil(l); return 1;
  }
  lua_pushnumber(l, sx); lua_pushnumber(l, sy); lua_pushnumber(l, sc); lua_pushnumber(l, d);
  return 4;
}
/* floorh(x, y, angle, camz, horizon, [focal=160], [outside=-1], [step=1]): floor with hills, camera at height camz */
static int l_floorh(lua_State *l) {
  bk_floorh((float)luaL_checknumber(l, 1), (float)luaL_checknumber(l, 2), (float)luaL_checknumber(l, 3),
            (float)luaL_checknumber(l, 4), ci(l, 5), (float)optn(l, 6, 160), opti(l, 7, -1), opti(l, 8, 1));
  return 0;
}
/* hset(cx, cy, h): height (0-255 pixels) of tile corner cx 0..256, cy 0..128.  hget(x, y): blended height at a world pixel */
static int l_hset(lua_State *l) {
  int x = ci(l, 1), y = ci(l, 2), h = ci(l, 3);
  if (x >= 0 && y >= 0 && x <= BK_MAP_W && y <= BK_MAP_H) BK->height[y * (BK_MAP_W + 1) + x] = (uint8_t)(h < 0 ? 0 : h > 255 ? 255 : h);
  return 0;
}
static int l_hget(lua_State *l) { lua_pushnumber(l, bk_hget((float)luaL_checknumber(l, 1), (float)luaL_checknumber(l, 2))); return 1; }
/* depth(dist): sprites drawn after this are hidden behind hills nearer than dist (from project). depth() turns it off. */
static int l_depth(lua_State *l) { bk_depth(lua_isnoneornil(l, 1) ? -1.f : (float)luaL_checknumber(l, 1)); return 0; }

/* sspr(n, x, y, [w=1], [h=1], [scale=1], [flipx], [flipy]): sprite at any (fractional) scale */
static int l_sspr(lua_State *l) {
  bk_sspr(ci(l, 1), (float)luaL_checknumber(l, 2), (float)luaL_checknumber(l, 3), opti(l, 4, 1), opti(l, 5, 1),
          (float)optn(l, 6, 1), lua_toboolean(l, 7), lua_toboolean(l, 8));
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

/* the optional last argument is the player (1..4, default 1) */
static int player_arg(lua_State *l, int i) { return (int)luaL_optinteger(l, i, 1) - 1; }
static int l_btn(lua_State *l) {
  if (lua_isnoneornil(l, 1)) { lua_pushinteger(l, BK->pad[0].btn); return 1; }
  lua_pushboolean(l, bk_btn(player_arg(l, 2), btn_index(l, 1)));
  return 1;
}
static int l_btnp(lua_State *l) { lua_pushboolean(l, bk_btnp(player_arg(l, 2), btn_index(l, 1))); return 1; }
static int l_btnr(lua_State *l) {
  int i = btn_index(l, 1), p = player_arg(l, 2);
  int ok = i >= 0 && i < BK_NUM_BUTTONS && p >= 0 && p < BK_MAX_PLAYERS;
  lua_pushboolean(l, ok && ((BK->pad[p].btn_prev >> i) & 1) && !((BK->pad[p].btn >> i) & 1));
  return 1;
}
static int l_press(lua_State *l) {
  int i = btn_index(l, 1), p = player_arg(l, 2);
  lua_pushinteger(l, (i >= 0 && i < BK_NUM_BUTTONS && p >= 0 && p < BK_MAX_PLAYERS) ? BK->pad[p].press[i] : 0);
  return 1;
}
/* PLAYERS (how many play) and ME (this device's player, 0 = shared screen) as Lua globals */
static void set_player_globals(lua_State *l) {
  lua_pushinteger(l, BK->players < 1 ? 1 : BK->players); lua_setglobal(l, "PLAYERS");
  lua_pushinteger(l, BK->me); lua_setglobal(l, "ME");
  lua_pushinteger(l, BK->net.id); lua_setglobal(l, "NET_ID");
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
/* voice(ch, hz, vol, [wave=0], [pan=0]): a held note for the music player. It keeps sounding until
   voice(ch, hz, 0) (or stop(ch)); calling it again changes pitch, volume and pan without restarting. */
static int l_voice(lua_State *l) {
  bk_voice_set(ci(l, 1), (float)luaL_checknumber(l, 2), opti(l, 4, 0), (float)luaL_checknumber(l, 3), (float)optn(l, 5, 0));
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
/* _level_map(n): ask the host to copy level n's map into map memory before the next frame (used by level()). */
static int l_level_map(lua_State *l) { BK->sys[0] = 4; BK->sys[1] = ci(l, 1); return 0; }
/* _restart(mode): ask the host to load this cart again (game shell "New game" after playing).
   The host sets GAME_BOOT = mode before _init: 1 title, 2 new game, 3 straight into play. */
static int l_restart(lua_State *l) { BK->sys[0] = 5; BK->sys[1] = ci(l, 1); return 0; }
/* share(op, a, b): the Share app asks the host (command 6): op 0 "send me the state" (SHARE table), 1 send item a
   to nearby Bit b, 2 answer the offer (a = 1 yes, 0 no), 3 stop the transfer. Packed: op<<24 | a<<12 | b. */
static int l_share(lua_State *l) {
  BK->sys[0] = 6;
  BK->sys[1] = (int32_t)(((uint32_t)ci(l, 1) & 0xFF) << 24 | ((uint32_t)luaL_optinteger(l, 2, 0) & 0xFFF) << 12 | ((uint32_t)luaL_optinteger(l, 3, 0) & 0xFFF));
  return 0;
}
/* _save_raw(str or nil): the host persists BK->save when dirty is set */
static int l_save_raw(lua_State *l) {
  size_t n = 0;
  const char *s = lua_isnil(l, 1) ? NULL : luaL_checklstring(l, 1, &n);
  if (n > BK_SAVE_MAX) return luaL_error(l, "save: %d bytes is too big (max %d)", (int)n, BK_SAVE_MAX);
  if (s) memcpy(BK->save.data, s, n);
  BK->save.len = s ? (int32_t)n : -1;
  BK->save.dirty = 1;
  return 0;
}
static int l_load_raw(lua_State *l) {
  if (BK->save.len < 0) { lua_pushnil(l); return 1; }
  lua_pushlstring(l, BK->save.data, (size_t)BK->save.len);
  return 1;
}
/* net_send(v1, ..., v8): broadcast an event of up to 8 integers to every other Bit playing this cart.
   Returns false if the cart already sent BK_NET_OUT events this frame. Events can arrive late or (rarely)
   not at all, and other Bits are not frame-synced: keep game state owned by whoever sends it. */
static int l_net_send(lua_State *l) {
  int n = lua_gettop(l);
  if (n > BK_NET_VALS) return luaL_error(l, "net_send: at most %d numbers", BK_NET_VALS);
  if (BK->net.out_n >= BK_NET_OUT) { lua_pushboolean(l, 0); return 1; }
  int32_t *e = BK->net.out[BK->net.out_n];
  e[0] = BK->net.id; e[1] = n;
  for (int i = 0; i < n; i++) e[2 + i] = (int32_t)luaL_checknumber(l, i + 1);
  BK->net.out_n++;
  lua_pushboolean(l, 1);
  return 1;
}
/* net_recv() -> from, v1, ... (the next event from another Bit) or nil when there is none */
static int l_net_recv(lua_State *l) {
  if (BK->net.in_r >= BK->net.in_n || BK->net.in_r < 0) { lua_pushnil(l); return 1; }
  int32_t *e = BK->net.in[BK->net.in_r++];
  int n = e[1] < 0 ? 0 : (e[1] > BK_NET_VALS ? BK_NET_VALS : e[1]);
  lua_pushinteger(l, e[0]);
  for (int i = 0; i < n; i++) lua_pushinteger(l, e[2 + i]);
  return n + 1;
}

/* clock(): wall-clock unix seconds (RTC on the device). Not deterministic: don't use it inside multiplayer game logic. */
static int l_clock(lua_State *l) { lua_pushinteger(l, (lua_Integer)time(NULL)); return 1; }

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
  {"rect", l_rect}, {"rectfill", l_rectfill}, {"shade", l_shade}, {"tint", l_tint}, {"fog", l_fog}, {"dither", l_dither}, {"remap", l_remap}, {"wave", l_wave}, {"ripple", l_ripple}, {"pixelate", l_pixelate}, {"glitch", l_glitch}, {"display", l_display}, {"sprfx", l_sprfx}, {"raster", l_raster}, {"circ", l_circ}, {"circfill", l_circfill},
  {"text", l_text}, {"textw", l_textw}, {"lang", l_lang}, {"tr", l_tr}, {"_texts_auto", l_texts_auto}, {"font", l_font}, {"sget", l_sget}, {"sset", l_sset}, {"spr", l_spr}, {"map", l_map}, {"floor", l_floorplane}, {"floorh", l_floorh}, {"hset", l_hset}, {"hget", l_hget}, {"depth", l_depth}, {"project", l_project}, {"sspr", l_sspr}, {"mget", l_mget}, {"mset", l_mset},
  {"fget", l_fget}, {"fset", l_fset}, {"camera", l_camera}, {"clip", l_clip},
  {"pal", l_pal}, {"palt", l_palt}, {"palette", l_palette},
  {"btn", l_btn}, {"btnp", l_btnp}, {"btnr", l_btnr}, {"press", l_press},
  {"t", l_t}, {"time", l_time}, {"rnd", l_rnd}, {"srand", l_srand},
  {"sfx", l_sfx}, {"tone", l_tone}, {"voice", l_voice}, {"stop", l_stop},
  {"print", l_print}, {"track", l_track}, {"launch", l_launch}, {"home", l_home}, {"_level_map", l_level_map}, {"_restart", l_restart}, {"share", l_share},
  {"net_send", l_net_send}, {"net_recv", l_net_recv},
  {"_save_raw", l_save_raw}, {"_load_raw", l_load_raw}, {"clock", l_clock},
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

void bk_lua_close(void) { if (L) lua_close(L); L = 0; sfx_ref = LUA_NOREF; bk_sprfx_reset(); }

void bk_lua_set_alloc(bk_alloc_fn fn, void *ud) { alloc_fn = fn; alloc_ud = ud; }

void bk_ctx_take(bk_ctx *c) {
  c->L = L; c->sfx_ref = sfx_ref;
  bk_core_ctx_take(c);
  L = 0; sfx_ref = LUA_NOREF; bk_sprfx_reset();
}

void bk_ctx_put(const bk_ctx *c) {
  bk_lua_close();
  L = (lua_State *)c->L; sfx_ref = c->sfx_ref;
  bk_core_ctx_put(c);
}

static int at_panic(lua_State *l) {
  snprintf(err_buf, sizeof(err_buf), "PANIC: %s", lua_tostring(l, -1));
  log_msg(err_buf, 1);
  return 0;
}

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
  bk_emu_close();   /* a cart starting ends any emulated game (its battery save goes to the host first) */
  err_buf[0] = 0;
  L = alloc_fn ? lua_newstate((lua_Alloc)alloc_fn, alloc_ud) : luaL_newstate();
  if (!L) { snprintf(err_buf, sizeof(err_buf), "not enough memory to start the game"); log_msg(err_buf, 1); return 1; }
  if (alloc_fn) lua_atpanic(L, at_panic);
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
  bk_emu_lua_open(L);
  lua_sethook(L, hook, LUA_MASKCOUNT, HOOK_STEP);

  bk_reset_draw_state();
  bk_display_reset();
  bk_font(0, -1);
  sfx_clear(NULL);
  memset(BK->height, 0, sizeof(BK->height));
  BK->frame = 0;
  for (int c = 0; c < BK_CHANNELS; c++) BK->voice[c].len = 0;
  /* every device in a linked game must start from the same state */
  bk_srand(0);
  memset(BK->pad, 0, sizeof(BK->pad));
  for (int i = 0; i < BK_MAX_PLAYERS; i++) BK->pad[i].fresh = 1;
  set_player_globals(L);

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

/* Run a chunk in the loaded cart's Lua state, e.g. an editor telling its player cart what changed. */
int bk_lua_eval(const char *code) {
  if (!L) return 1;
  if (luaL_loadbufferx(L, code, strlen(code), "=eval", "t") != LUA_OK) {
    snprintf(err_buf, sizeof(err_buf), "%s", lua_tostring(L, -1));
    lua_pop(L, 1);
    log_msg(err_buf, 1);
    return 1;
  }
  return pcall_budget(0) != LUA_OK;
}

int bk_lua_frame(void) {
  if (!L) return 1;
  BK->track[2] = 0;
  BK->sys[0] = 0;
  set_player_globals(L);
  lua_getglobal(L, "_update");
  if (lua_isfunction(L, -1)) { if (pcall_budget(0) != LUA_OK) return 1; }
  else lua_pop(L, 1);
  lua_getglobal(L, "_draw");
  if (lua_isfunction(L, -1)) { if (pcall_budget(0) != LUA_OK) return 1; }
  else lua_pop(L, 1);
  /* built-in overlay (cutscene bars, dialog, fades), drawn in screen space on top of the cart */
  lua_getglobal(L, "_bk_overlay");
  if (lua_isfunction(L, -1)) {
    int cx = BK->cam_x, cy = BK->cam_y, x0 = BK->clip_x0, y0 = BK->clip_y0, x1 = BK->clip_x1, y1 = BK->clip_y1;
    uint8_t dp[256], tr[256];
    memcpy(dp, BK->draw_pal, 256); memcpy(tr, BK->transparent, 256);
    bk_sprfx_t fx = bk_sprfx;                  /* the menus draw plain sprites; the cart's sprfx{} comes back after */
    bk_reset_draw_state();
    bk_sprfx_reset();
    int r = pcall_budget(0);
    BK->cam_x = cx; BK->cam_y = cy; BK->clip_x0 = x0; BK->clip_y0 = y0; BK->clip_x1 = x1; BK->clip_y1 = y1;
    memcpy(BK->draw_pal, dp, 256); memcpy(BK->transparent, tr, 256);
    bk_sprfx = fx;
    if (r != LUA_OK) return 1;
  } else lua_pop(L, 1);
  BK->frame++;
  return 0;
}
