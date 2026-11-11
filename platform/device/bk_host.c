/* The PocketBit host (see bk_host.h). Mirrors what studio.js does for the emulated Bit: bootHome, playCart,
   bitRequest, suspendGame/resumeGame, restartGame, takeSave/putSave and loadBitSettings. MIT License. */
#include "bk_host.h"
#include "bk_cart.h"
#include "lua.h"
#include "lauxlib.h"
#include <dirent.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXSLOT 12
#define MAXGAMES 96
enum { MODE_HOME, MODE_GAME, MODE_ERROR, MODE_BOOT };
static const uint16_t START = 1u << BK_START, SELECT = 1u << BK_SELECT;

typedef struct {
  char path[200], name[64], sub[48], save_key[64];
  int is_app, has_icon, builtin;
  uint8_t icon[256];
} entry;

typedef struct {
  int used, game, paused, hold, level;
  bk_machine *m;
  bk_ctx ctx;
  bk_cart cart;
  int has_cart;
  char save_key[64];
  size_t mem, peak, limit;
  uint32_t stamp;
} slot;

static bk_host_config C;
static entry *E;
static int nE;
static slot S[MAXSLOT];
static slot *cur, *home_slot;
static bk_machine *sysm;                 /* the error screen */
static int mode = MODE_HOME, sel = 1, combo_held, nslots;
static uint32_t stamp;
static char *home_code;
static char errmsg[600];
static bk_bit_settings bs;
static char *theme_raw;   /* the "Bit theme" save, checked to be a Lua table, for the home screen and boot */
static char *boot_code;
static float abuf[2 * 2048];
static uint16_t err_last;

/* ------------------------------------------------------------ memory */
static void *mrealloc(void *p, size_t n) {
  if (C.mem_realloc) return C.mem_realloc(p, n);
  if (!n) { free(p); return NULL; }
  return realloc(p, n);
}
static void *malloc_(size_t n) { return mrealloc(NULL, n); }
static void free_(void *p) { if (p) mrealloc(p, 0); }
static const bk_cart_mem CM = { malloc_, free_ };

static void say(const char *m, int err) { if (C.log) C.log(m, err); }

/* Lua's allocator: every game counts its own bytes and stops at its limit (a memory error in Lua, not a crash) */
static void *lua_alloc(void *ud, void *p, size_t osize, size_t nsize) {
  slot *s = ud;
  size_t old = p ? osize : 0;
  if (!nsize) { if (p) { free_(p); s->mem -= old; } return NULL; }
  if (nsize > old && s->mem + (nsize - old) > s->limit) return NULL;
  void *q = mrealloc(p, nsize);
  if (!q) return NULL;
  s->mem = s->mem - old + nsize;
  if (s->mem > s->peak) s->peak = s->mem;
  return q;
}

/* ------------------------------------------------------------ slots: carts alive at once (home + paused games) */
static void slot_close(slot *s) {
  if (!s || !s->used) return;
  if (s == cur) { if (s->m) { BK = s->m; bk_lua_close(); } cur = NULL; }
  else if (s->ctx.L) {             /* a paused cart: bring its Lua state in just to close it */
    bk_ctx keep; bk_machine *km = BK;
    bk_ctx_take(&keep);
    BK = s->m; bk_ctx_put(&s->ctx); bk_lua_close();
    BK = km; bk_ctx_put(&keep);
  }
  if (s->has_cart) bk_cart_free(&s->cart, &CM);
  free_(s->m);
  if (s == home_slot) home_slot = NULL;
  memset(s, 0, sizeof(*s));
}

static slot *paused_slot(int game) {
  for (int i = 0; i < nslots; i++) if (S[i].used && S[i].paused && S[i].game == game) return &S[i];
  return NULL;
}
static int paused_count(void) { int n = 0; for (int i = 0; i < nslots; i++) n += S[i].used && S[i].paused; return n; }
static slot *oldest_paused(void) {
  slot *o = NULL;
  for (int i = 0; i < nslots; i++) if (S[i].used && S[i].paused && (!o || S[i].stamp < o->stamp)) o = &S[i];
  return o;
}
/* keep at most max_paused games, and leave room in memory for the next one */
static void trim_paused(size_t want) {
  slot *o;
  while (paused_count() > C.max_paused && (o = oldest_paused())) { say("forgot the oldest paused game", 0); slot_close(o); }
  while (C.mem_free && C.mem_free() < want && (o = oldest_paused())) { say("low memory: forgot the oldest paused game", 0); slot_close(o); }
}
static slot *new_slot(int game) {
  trim_paused(C.game_mem_limit / 2 + sizeof(bk_machine));
  for (int i = 0; i < nslots; i++)
    if (!S[i].used) {
      slot *s = &S[i];
      memset(s, 0, sizeof(*s));
      s->used = 1; s->game = game; s->limit = C.game_mem_limit; s->stamp = ++stamp;
      s->m = malloc_(sizeof(bk_machine));
      if (!s->m) { memset(s, 0, sizeof(*s)); return NULL; }
      bk_machine_init(s->m);   /* BK = s->m */
      return s;
    }
  return NULL;
}

/* ------------------------------------------------------------ files */
static void save_path(char *out, size_t n, const char *key) {
  char k[80]; size_t j = 0;
  for (const char *p = key; *p && j < sizeof(k) - 1; p++) {
    unsigned char c = (unsigned char)*p;
    k[j++] = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ' || c == '-' || c == '_' || c == '.' ? (char)c : '_';
  }
  k[j] = 0;
  snprintf(out, n, "%s/%s.sav", C.save_dir, k);
}
static char *read_file(const char *path, size_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  if (n < 0) { fclose(f); return NULL; }
  char *b = malloc_((size_t)n + 1);
  if (!b) { fclose(f); return NULL; }
  size_t got = fread(b, 1, (size_t)n, f);
  fclose(f);
  b[got] = 0;
  if (len) *len = got;
  return b;
}
static void put_save(const char *key) {
  char p[260];
  BK->save.dirty = 0; BK->save.len = -1;
  if (!key || !key[0] || !C.save_dir) return;
  save_path(p, sizeof(p), key);
  FILE *f = fopen(p, "rb");
  if (!f) return;
  size_t n = fread(BK->save.data, 1, BK_SAVE_MAX, f);
  fclose(f);
  BK->save.len = (int32_t)n;
}

static void read_settings(const char *data, size_t len);
static void read_theme(const char *data, size_t len);
static void take_save(void) {
  if (!cur || !BK->save.dirty) return;
  BK->save.dirty = 0;
  if (!cur->save_key[0] || !C.save_dir) return;
  char p[260];
  save_path(p, sizeof(p), cur->save_key);
  if (BK->save.len < 0) { remove(p); return; }
  char tmp[264];
  snprintf(tmp, sizeof(tmp), "%s.new", p);
  FILE *f = fopen(tmp, "wb");
  if (!f) { say("could not write a save file", 1); return; }
  size_t n = fwrite(BK->save.data, 1, (size_t)BK->save.len, f);
  int ok = fclose(f) == 0 && n == (size_t)BK->save.len;
  if (ok) { remove(p); ok = rename(tmp, p) == 0; }   /* a half-written save never replaces a good one */
  if (!ok) say("could not write a save file", 1);
  if (!strcmp(cur->save_key, "Bit settings")) read_settings(BK->save.data, (size_t)BK->save.len);
  if (!strcmp(cur->save_key, "Bit theme")) read_theme(BK->save.data, (size_t)BK->save.len);
}

/* ------------------------------------------------------------ the Bit's settings ("Bit settings") and theme ("Bit theme") */
static void str_field(lua_State *l, const char *k, char *out, size_t n) {
  if (lua_getfield(l, -1, k) == LUA_TSTRING) snprintf(out, n, "%s", lua_tostring(l, -1));
  lua_pop(l, 1);
}
/* a save file's text as a Lua table on top of l's stack; 0 when it isn't one */
static int lua_table_of(lua_State *l, const char *data, size_t len) {
  luaL_Buffer b;
  luaL_buffinit(l, &b);
  luaL_addstring(&b, "return ");
  luaL_addlstring(&b, data, len);
  luaL_pushresult(&b);
  const char *src = lua_tostring(l, -1);
  return luaL_loadbufferx(l, src, strlen(src), "=save", "t") == LUA_OK && lua_pcall(l, 0, 1, 0) == LUA_OK && lua_istable(l, -1);
}
static void read_settings(const char *data, size_t len) {
  bk_bit_settings n = bs;
  snprintf(n.look, sizeof(n.look), "theme"); n.strength = n.bright = n.volume = 10; n.color = 27; n.name[0] = n.bit[0] = 0;
  lua_State *l = luaL_newstate();
  if (l && data && lua_table_of(l, data, len)) {
    str_field(l, "look", n.look, sizeof(n.look));
    str_field(l, "name", n.name, sizeof(n.name));
    str_field(l, "bit", n.bit, sizeof(n.bit));
    const char *k[4] = { "strength", "bright", "volume", "color" };
    int *v[4] = { &n.strength, &n.bright, &n.volume, &n.color };
    for (int i = 0; i < 4; i++) {
      if (lua_getfield(l, -1, k[i]) == LUA_TNUMBER) { int x = (int)lua_tointeger(l, -1); *v[i] = x < 0 ? 0 : x > (i == 3 ? 255 : 10) ? (i == 3 ? 255 : 10) : x; }
      lua_pop(l, 1);
    }
    if (!n.color) n.color = 27;
  }
  if (l) lua_close(l);
  bs = n;
}
static void read_theme(const char *data, size_t len) {
  snprintf(bs.theme_look, sizeof(bs.theme_look), "game"); snprintf(bs.theme_boot, sizeof(bs.theme_boot), "rise"); bs.boottext[0] = 0;
  free_(theme_raw); theme_raw = NULL;
  lua_State *l = luaL_newstate();
  if (l && data && lua_table_of(l, data, len)) {
    if (lua_getfield(l, -1, "theme") == LUA_TTABLE) {
      str_field(l, "look", bs.theme_look, sizeof(bs.theme_look));
      str_field(l, "boot", bs.theme_boot, sizeof(bs.theme_boot));
      str_field(l, "boottext", bs.boottext, sizeof(bs.boottext));
      if ((theme_raw = malloc_(len + 1))) { memcpy(theme_raw, data, len); theme_raw[len] = 0; }
    }
  }
  if (l) lua_close(l);
}
static void load_file_save(const char *key, void (*fn)(const char *, size_t)) {
  char p[260]; size_t len = 0;
  save_path(p, sizeof(p), key);
  char *d = read_file(p, &len);
  fn(d, d ? len : 0);
  free_(d);
}
static void load_settings(void) { load_file_save("Bit settings", read_settings); load_file_save("Bit theme", read_theme); }

/* `theme = ...` for the home screen and boot data: the saved theme (theme_fix() in the cart fills in the rest) */
static void theme_lua(char *out, size_t n) {
  if (!theme_raw) { snprintf(out, n, "nil"); return; }
  snprintf(out, n, "(%s).theme", theme_raw);
}
/* the screen look the Bit puts over games: the Settings app's, or the theme's */
static const char *bit_look(void) { return strcmp(bs.look, "theme") ? bs.look : bs.theme_look; }
static void upper(char *s) { for (; *s; s++) if (*s >= 'a' && *s <= 'z') *s = (char)(*s - 32); }

/* ------------------------------------------------------------ the library */
static int cmp_str(const void *a, const void *b) { return strcmp(*(char *const *)a, *(char *const *)b); }
static void scan_dir(const char *dir, int apps) {
  DIR *d = opendir(dir);
  if (!d) return;
  char *names[MAXGAMES]; int n = 0;
  struct dirent *de;
  while ((de = readdir(d)) && n < MAXGAMES) {
    const char *nm = de->d_name; size_t l = strlen(nm);
    if (l > 7 && (!strcmp(nm + l - 7, ".bitkit") || !strcmp(nm + l - 7, ".BITKIT")) && nm[0] != '.') names[n++] = strdup(nm);
  }
  closedir(d);
  qsort(names, (size_t)n, sizeof(char *), cmp_str);
  for (int i = 0; i < n; i++) {
    if (nE < MAXGAMES) {
      entry *e = &E[nE];
      memset(e, 0, sizeof(*e));
      snprintf(e->path, sizeof(e->path), "%s/%s", dir, names[i]);
      bk_cart c; char err[200];
      if (bk_cart_load(&c, e->path, BK_CART_INFO, &CM, err, sizeof(err))) { say(err, 1); }
      else {
        int dup = 0;
        for (int k = 0; k < nE; k++) if (!strcmp(E[k].name, c.name) && E[k].is_app == c.is_app) dup = 1;
        if (!dup) {
          snprintf(e->name, sizeof(e->name), "%s", c.name);
          snprintf(e->sub, sizeof(e->sub), "%s", c.sub ? c.sub : "");
          snprintf(e->save_key, sizeof(e->save_key), "%s", c.save_key ? c.save_key : c.name);
          e->is_app = apps || c.is_app;
          e->has_icon = c.has_icon;
          e->builtin = c.builtin;
          memcpy(e->icon, c.icon, 256);
          nE++;
        }
        bk_cart_free(&c, &CM);
      }
    }
    free(names[i]);
  }
}

/* ------------------------------------------------------------ errors */
static void show_error(const char *msg) {
  snprintf(errmsg, sizeof(errmsg), "%s", msg && msg[0] ? msg : "the game stopped");
  say(errmsg, 1);
  if (cur) slot_close(cur);   /* a broken game is not kept paused */
  cur = NULL;
  err_last = 0xFFFF;          /* the button that was down when it broke has to be let go first */
  BK = sysm;
  bk_reset_draw_state();
  bk_cls(1);
  bk_rectfill(0, 0, BK_W, 18, 8);
  bk_text("THE GAME STOPPED", 8, 5, 7, 1);
  int y = 28, col = 0; char line[41];
  for (const char *p = errmsg; *p && y < BK_H - 24; p++) {
    if (*p == '\n' || col == 38) { line[col] = 0; bk_text(line, 8, y, 6, 1); y += 10; col = 0; if (*p == '\n') continue; }
    line[col++] = *p == '\t' ? ' ' : *p;
  }
  if (col && y < BK_H - 24) { line[col] = 0; bk_text(line, 8, y, 6, 1); }
  bk_text("A: back to the home screen", 8, BK_H - 14, 13, 1);
  for (int c = 0; c < BK_CHANNELS; c++) BK->voice[c].len = 0;
  mode = MODE_ERROR;
}

/* ------------------------------------------------------------ home screen */
static void lua_str(char *o, size_t n, const char *s) {
  size_t j = 0;
  if (n < 3) return;
  o[j++] = '"';
  for (; *s && j + 3 < n; s++) {
    if (*s == '\\' || *s == '"') o[j++] = '\\';
    o[j++] = *s == '\n' ? ' ' : *s;
  }
  o[j++] = '"'; o[j] = 0;
}

static void boot_home(void) {
  if (home_slot) slot_close(home_slot);
  slot *s = new_slot(-1);
  if (!s) { show_error("out of memory for the home screen"); return; }
  home_slot = s; cur = s; mode = MODE_HOME;
  static const int COLORS[8] = { 3, 8, 15, 20, 25, 4, 9, 16 };
  size_t cap = 1024 + (size_t)nE * 220 + (theme_raw ? strlen(theme_raw) : 0), len = 0;
  char *bit = malloc_(cap);
  if (!bit) { show_error("out of memory for the home screen"); return; }
  len += (size_t)snprintf(bit + len, cap - len, "BIT = { games = {");
  for (int i = 0; i < nE && i < 96; i++) {
    entry *e = &E[i];
    const int slotTile = (i / 8) * 32 + (i % 8) * 2;
    if (e->has_icon)
      for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++)
        BK->tiles[(slotTile + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = e->icon[y * 16 + x];
    char nm[140], file[220], sub[110];
    lua_str(nm, sizeof(nm), e->name);
    const char *base = strrchr(e->path, '/');
    lua_str(file, sizeof(file), e->builtin ? "" : base ? base + 1 : e->path);
    lua_str(sub, sizeof(sub), e->sub);
    len += (size_t)snprintf(bit + len, cap - len, "%s{name=%s, file=%s, studio=false, paused=%s, ", i ? "," : "", nm, file, paused_slot(i + 1) ? "true" : "false");
    if (e->has_icon || e->is_app) len += (size_t)snprintf(bit + len, cap - len, "icon=%d", slotTile);
    else len += (size_t)snprintf(bit + len, cap - len, "color=%d", COLORS[i % 8]);
    if (e->is_app) len += (size_t)snprintf(bit + len, cap - len, ", app=true, sub=%s", sub);
    len += (size_t)snprintf(bit + len, cap - len, "}");
  }
  char src[80];
  lua_str(src, sizeof(src), C.source ? C.source : "");
  if (sel > nE) sel = 1;
  char nm[40], bn[48];
  lua_str(nm, sizeof(nm), bs.name); lua_str(bn, sizeof(bn), bs.bit);
  len += (size_t)snprintf(bit + len, cap - len, "}, sel = %d, studio = false, link = %s, source = %s, me = {name = %s, color = %d, bit = %s}, theme = ",
    sel < 1 ? 1 : sel, C.link ? "true" : "false", src, nm, bs.color, bn);
  theme_lua(bit + len, cap - len);
  len += strlen(bit + len);
  snprintf(bit + len, cap - len, " }");
  bk_lua_set_alloc(lua_alloc, s);
  BK->players = 1; BK->me = 0;
  int rc = bk_lua_load_ex(bit, home_code ? home_code : "function _draw() cls(1) text(\"no home screen\", 8, 8, 7) end");
  free_(bit);
  if (rc) show_error(bk_lua_error());
}

/* the theme's power-on animation; it calls home() when it is done or a button is pressed */
static void boot_anim(void) {
  if (!boot_code || !strcmp(bs.theme_boot, "none")) { boot_home(); return; }
  slot *s = new_slot(-1);
  if (!s) { boot_home(); return; }
  home_slot = s; cur = s; mode = MODE_BOOT;
  char title[48], sub[48], t[64], u[64];
  snprintf(t, sizeof(t), "%s", bs.boottext[0] ? bs.boottext : bs.bit[0] ? bs.bit : "PocketBit"); upper(t);
  if (bs.name[0]) { snprintf(u, sizeof(u), "%s'S BIT", bs.name); upper(u); } else u[0] = 0;
  lua_str(title, sizeof(title), t); lua_str(sub, sizeof(sub), u);
  size_t cap = 256 + (theme_raw ? strlen(theme_raw) : 0);
  char *data = malloc_(cap);
  if (!data) { boot_home(); return; }
  int n = snprintf(data, cap, "BOOT = { title = %s, sub = %s, theme = ", title, sub);
  theme_lua(data + n, cap - (size_t)n);
  strncat(data, " }", cap - strlen(data) - 1);
  bk_lua_set_alloc(lua_alloc, s);
  int rc = bk_lua_load_ex(data, boot_code);
  free_(data);
  if (rc) { say(bk_lua_error(), 1); slot_close(s); boot_home(); }
}

/* ------------------------------------------------------------ games */
static int start_game(int n, const char *extra) {
  if (n < 1 || n > nE) return 1;
  entry *e = &E[n - 1];
  slot *s = new_slot(n);
  if (!s) { show_error("not enough memory to start the game"); return 1; }
  char err[220];
  if (bk_cart_load(&s->cart, e->path, BK_CART_ALL, &CM, err, sizeof(err))) { cur = s; show_error(err); return 1; }
  s->has_cart = 1;
  cur = s; mode = MODE_GAME;
  memcpy(BK->palette, s->cart.palette, sizeof(BK->palette));
  memcpy(BK->tiles, s->cart.tiles, sizeof(BK->tiles));
  memcpy(BK->flags, s->cart.flags, sizeof(BK->flags));
  memcpy(BK->map, s->cart.maps[0], sizeof(BK->map));
  BK->players = 1; BK->me = 0; BK->net.id = 0;
  snprintf(s->save_key, sizeof(s->save_key), "%s", e->save_key[0] ? e->save_key : s->cart.name);
  put_save(s->save_key);
  /* NAMES / NAME_COLORS (player_name()): on one Bit, player 1 is the owner */
  char names[96], nm[40];
  lua_str(nm, sizeof(nm), bs.name);
  snprintf(names, sizeof(names), "NAMES = {%s}\nNAME_COLORS = {%d}\n", nm, bs.color);
  size_t el = strlen(s->cart.entities_lua), xl = extra ? strlen(extra) : 0, nl = strlen(names);
  char *data = malloc_(el + xl + nl + 1);
  if (!data) { show_error("not enough memory to start the game"); return 1; }
  memcpy(data, names, nl); memcpy(data + nl, extra ? extra : "", xl); memcpy(data + nl + xl, s->cart.entities_lua, el + 1);
  bk_lua_set_alloc(lua_alloc, s);
  char m[100]; snprintf(m, sizeof(m), "playing \"%s\"", e->name); say(m, 0);
  int rc = bk_lua_load_ex(data, s->cart.code);
  free_(data);
  if (rc) { show_error(bk_lua_error()); return 1; }
  return 0;
}

static void pause_current(void) {
  if (!cur || cur == home_slot || mode != MODE_GAME) return;
  take_save();
  bk_ctx_take(&cur->ctx);
  for (int c = 0; c < BK_CHANNELS; c++) BK->voice[c].len = 0;   /* a paused game is silent */
  cur->paused = 1; cur->stamp = ++stamp;
  char m[100]; snprintf(m, sizeof(m), "paused \"%s\"", E[cur->game - 1].name); say(m, 0);
  cur = NULL;
}

void bk_host_go_home(void) {
  if (mode == MODE_GAME) pause_current();
  else if (cur && cur != home_slot) slot_close(cur);
  boot_home();
}

/* from the home screen: carry on with a paused game, or start it */
int bk_host_launch(int n) {
  if (n < 1 || n > nE) return 1;
  sel = n;
  if (home_slot) slot_close(home_slot);
  slot *p = paused_slot(n);
  if (p) {
    BK = p->m; bk_ctx_put(&p->ctx); memset(&p->ctx, 0, sizeof(p->ctx));
    p->paused = 0; p->hold = 1; cur = p; mode = MODE_GAME;
    char m[100]; snprintf(m, sizeof(m), "carrying on with \"%s\"", E[n - 1].name); say(m, 0);
    return 0;
  }
  return start_game(n, NULL);
}

void bk_host_restart(int how);
static void restart_game(int how) {
  if (!cur || cur == home_slot) return;
  int n = cur->game;
  slot_close(cur);
  char extra[32]; snprintf(extra, sizeof(extra), "GAME_BOOT = %d\n", how);
  start_game(n, extra);
}

/* ------------------------------------------------------------ photos and clips (runtime/bk_capture.c) */
/* Hold Select and press L for a photo (PNG) or R to start/stop a clip (GIF, 30 fps, up to 60 s), like the studio's
   Bit. They go to captures/<game>-<n>.png|gif on the memory card, where the studio's Share hub finds them. */
static struct { int rec, n; FILE *f; char path[260]; } cap;
static uint16_t cap_combo;
static int cap_write(void *ctx, const void *d, int len) { return fwrite(d, 1, (size_t)len, (FILE *)ctx) == (size_t)len ? 0 : 1; }
static FILE *cap_open(const char *ext) {
  char base[64]; size_t j = 0; int dash = 0;
  const char *g = mode == MODE_HOME ? "home" : bk_host_playing();
  for (const char *p = g; *p && j < sizeof(base) - 1; p++) {
    char c = *p >= 'A' && *p <= 'Z' ? (char)(*p + 32) : *p;
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { base[j++] = c; dash = 0; }
    else if (j && !dash) { base[j++] = '-'; dash = 1; }
  }
  while (j && base[j - 1] == '-') j--;
  base[j] = 0;
  if (!j) snprintf(base, sizeof(base), "bit");
  for (int n = 1; n < 10000; n++) {
    snprintf(cap.path, sizeof(cap.path), "%s/%s-%d.%s", C.captures_dir, base, n, ext);
    FILE *t = fopen(cap.path, "rb");
    if (t) { fclose(t); continue; }
    return fopen(cap.path, "wb");
  }
  return NULL;
}
static void take_photo(void) {
  FILE *f = cap_open("png");
  if (!f) { say("could not save a photo", 1); return; }
  int r = bk_shot_png(1, cap_write, f);
  fclose(f);
  if (r) { remove(cap.path); say("could not save a photo", 1); return; }
  char m[300]; snprintf(m, sizeof(m), "photo saved: %s", cap.path); say(m, 0);
}
static void toggle_clip(void) {
  if (!cap.rec) {
    if (!(cap.f = cap_open("gif")) || bk_clip_begin(cap_write, cap.f)) { if (cap.f) { fclose(cap.f); remove(cap.path); cap.f = NULL; } say("could not start a clip", 1); return; }
    cap.rec = 1; cap.n = 0;
    bk_clip_frame(2);
    say("recording a clip (Select + R stops it, 60 s at most)", 0);
  } else {
    cap.rec = 0;
    int n = bk_clip_end();
    fclose(cap.f); cap.f = NULL;
    char m[300]; snprintf(m, sizeof(m), n > 0 ? "clip saved: %s (%.1f s)" : "could not finish the clip %s", cap.path, cap.n / 60.0);
    if (n <= 0) remove(cap.path);
    say(m, n <= 0);
  }
}
static void capture_after_frame(uint16_t mask) {
  if (!C.captures_dir) return;
  const uint16_t L = 1u << BK_L, R = 1u << BK_R;
  const uint16_t now = (mask & SELECT) && !(mask & START) ? mask & (L | R) : 0;
  if (cap.rec && ++cap.n % 2 == 0) { bk_clip_frame(2); if (cap.n >= 60 * 60) toggle_clip(); }
  if ((now & L) && !(cap_combo & L)) take_photo();
  if ((now & R) && !(cap_combo & R)) toggle_clip();
  cap_combo = now;
}
int bk_host_recording(void) { return cap.rec; }

/* ------------------------------------------------------------ the frame */
static void handle_requests(void);
int bk_host_frame(uint16_t mask, const uint8_t *press) {
  const int both = (mask & (START | SELECT)) == (START | SELECT);
  if (mode == MODE_ERROR) {
    uint16_t down = mask & ~err_last; err_last = mask;
    if (down & ((1u << BK_A) | (1u << BK_B) | START)) { cur = NULL; boot_home(); }
    combo_held = both;
    return 0;
  }
  if (both && !combo_held && mode == MODE_GAME) { combo_held = both; bk_host_go_home(); return 0; }
  combo_held = both;
  if (!cur) { boot_home(); return 0; }
  if (cur->hold) {                   /* a resumed game sees no buttons until the one that resumed it is let go */
    if (mask) { mask = 0; press = NULL; } else cur->hold = 0;
  }
  bk_set_input(0, mask, press);
  if (bk_lua_frame() != 0) { show_error(bk_lua_error()); return 1; }
  take_save();
  capture_after_frame(mask);
  if (mode == MODE_HOME && BK->track[2] && BK->track[0] < 0) {   /* -1: start game n over, -2: n is selected */
    const int k = BK->track[0], n = BK->track[1];
    BK->track[2] = 0;
    if (k == -2) sel = n;
    else if (k == -1) { slot *p = paused_slot(n); if (p) slot_close(p); bk_host_launch(n); return 0; }
  }
  handle_requests();
  return 0;
}

/* what the cart asked of the host this frame: launch(), home(), level() maps, the game shell's _restart() */
static void handle_requests(void) {
  const int cmd = BK->sys[0], arg = BK->sys[1];
  BK->sys[0] = 0;
  switch (cmd) {
    case 1: if (mode == MODE_HOME) bk_host_launch(arg); break;
    case 2: if (mode == MODE_GAME) bk_host_go_home(); else if (mode == MODE_BOOT) boot_home(); break;
    case 3: say("Y edits a game in the studio, not on the Bit", 0); break;
    case 4: if (mode == MODE_GAME && cur->has_cart && arg >= 1 && arg <= cur->cart.nlevels) { memcpy(BK->map, cur->cart.maps[arg - 1], sizeof(BK->map)); cur->level = arg - 1; } break;
    case 5: if (mode == MODE_GAME) restart_game(arg); break;
    default: break;
  }
}

/* run Lua in the cart that runs now (the serial console, tests), then do what it asked of the host */
int bk_host_eval(const char *lua) {
  if (mode == MODE_ERROR || !cur) return 1;
  BK->sys[0] = 0;
  int r = bk_lua_eval(lua);
  handle_requests();
  return r;
}

void bk_host_audio(int16_t *out, int frames) {
  if (frames > 2048) frames = 2048;
  if (mode == MODE_ERROR || !BK) { memset(out, 0, sizeof(int16_t) * 2 * (size_t)frames); return; }
  bk_audio_render(abuf, frames);
  const float g = (float)bs.volume / 10.f * 32767.f;
  for (int i = 0; i < frames * 2; i++) out[i] = (int16_t)lrintf(abuf[i] * g);
}

void bk_host_present_begin(void) {
  if (strcmp(bit_look(), "game") && mode != MODE_ERROR) {   /* the Bit's look goes over the game's own, only while drawing */
    __typeof__(BK->display) keep = BK->display;
    if (bk_display_preset(bit_look())) {
      int32_t *v = &BK->display.scan;
      for (int i = 0; i < 10; i++) v[i] = (int32_t)lround(v[i] * (bs.strength / 10.0));
    }
    bk_present_begin();
    BK->display = keep;
    return;
  }
  bk_present_begin();
}

void bk_host_restart(int how) { if (mode == MODE_GAME) restart_game(how); }
int bk_host_backlight(void) { return (int)lround((0.35 + bs.bright * 0.065) * 1000); }
const bk_bit_settings *bk_host_settings(void) { return &bs; }
const char *bk_host_playing(void) { return mode == MODE_BOOT ? "boot" : mode == MODE_ERROR ? "error" : mode == MODE_HOME ? "home" : cur ? E[cur->game - 1].name : "?"; }
int bk_host_games(void) { return nE; }
const char *bk_host_game_name(int i) { return i >= 1 && i <= nE ? E[i - 1].name : NULL; }
int bk_host_paused_count(void) { return paused_count(); }
size_t bk_host_lua_bytes(void) { return cur ? cur->mem : 0; }
size_t bk_host_lua_peak(void) { return cur ? cur->peak : 0; }
const char *bk_host_last_error(void) { return errmsg; }

void bk_host_shutdown(void) {
  if (cap.rec) toggle_clip();
  for (int i = 0; i < MAXSLOT; i++) if (S[i].used && &S[i] != cur) slot_close(&S[i]);
  if (cur) slot_close(cur);
  BK = sysm; bk_lua_close();
  free_(E); free_(sysm); free_(home_code); free_(boot_code); free_(theme_raw);
  E = NULL; sysm = NULL; home_code = NULL; boot_code = NULL; theme_raw = NULL; nE = 0; cur = home_slot = NULL;
}

int bk_host_init(const bk_host_config *cfg) {
  if (sysm) bk_host_shutdown();
  C = *cfg;
  bk_set_logger(C.log);   /* print() from games goes to the console (USB serial on the device) */
  if (C.max_paused <= 0) C.max_paused = 4;
  if (C.max_paused > MAXSLOT - 2) C.max_paused = MAXSLOT - 2;
  nslots = C.max_paused + 2;
  if (!C.game_mem_limit) C.game_mem_limit = 4u << 20;
  memset(S, 0, sizeof(S));
  cur = home_slot = NULL;
  E = malloc_(sizeof(entry) * MAXGAMES);
  sysm = malloc_(sizeof(bk_machine));
  if (!E || !sysm) return 1;
  bk_machine_init(sysm);
  nE = 0;
  for (int i = 0; i < 4 && C.game_dirs[i]; i++) scan_dir(C.game_dirs[i], 0);
  for (int i = 0; i < 2 && C.app_dirs[i]; i++) scan_dir(C.app_dirs[i], 1);
  home_code = C.home_lua ? read_file(C.home_lua, NULL) : NULL;
  if (!home_code) say("no home screen cart (sys/home.lua)", 1);
  boot_code = C.boot_lua ? read_file(C.boot_lua, NULL) : NULL;
  load_settings();
  char m[80]; snprintf(m, sizeof(m), "%d games and apps", nE); say(m, 0);
  boot_anim();
  return 0;
}
