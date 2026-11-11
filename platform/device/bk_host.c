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
#include <time.h>

#define MAXSLOT 12
#define MAXGAMES 96
enum { MODE_HOME, MODE_GAME, MODE_ERROR, MODE_BOOT };
static const uint16_t START = 1u << BK_START, SELECT = 1u << BK_SELECT;

typedef struct {
  char path[200], name[64], sub[48], save_key[64];
  int is_app, has_icon, builtin;
  int info, net;                 /* info: fp and net worked out (lazily, from the file) */
  uint32_t fp;                   /* hash of the .bitkit file: linked Bits only play the very same game */
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
  int link_np;                   /* paused in a linked game of this many players (0 = played alone) */
  uint32_t link_token, link_ids[BK_MAX_PLAYERS];   /* that game's session, and who sat where */
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
static BK_BIG_BSS float abuf[2 * 2048];
static uint16_t err_last;

/* linked Bits (the section "linked Bits" below) */
static void link_home_rows(void);
static int  link_roster_n(void);
static int  link_launch(int n, int fresh);
static void link_end(int why);
static void link_leave(int pause);
static void link_frame(uint16_t mask, const uint8_t *press);
static void link_tick(void);
static void net_after_frame(void);
static int  link_wanted(int n);
static void link_start_info(int *players, int *me, const char **names, int *keep_save);
static int  link_on(void);
static uint32_t my_net_id(int n);
static void handle_requests(void);
static void capture_after_frame(uint16_t mask);
static void restart_game(int how);

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

/* game's paused copy: played alone (np 0 or 1), or linked with np players */
static slot *paused_slot_np(int game, int np) {
  if (np < 2) np = 0;
  for (int i = 0; i < nslots; i++) if (S[i].used && S[i].paused && S[i].game == game && S[i].link_np == np) return &S[i];
  return NULL;
}
static slot *paused_slot(int game) { return paused_slot_np(game, 0); }
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
  if (link_on()) link_end(3);  /* the other Bits can't go on without this one */
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
    len += (size_t)snprintf(bit + len, cap - len, "%s{name=%s, file=%s, studio=false, paused=%s, ", i ? "," : "", nm, file, paused_slot_np(i + 1, e->is_app ? 0 : link_roster_n()) ? "true" : "false");
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
    sel < 1 ? 1 : sel, C.radio_send ? "true" : "false", src, nm, bs.color, bn);
  theme_lua(bit + len, cap - len);
  len += strlen(bit + len);
  snprintf(bit + len, cap - len, " }");
  bk_lua_set_alloc(lua_alloc, s);
  BK->players = 1; BK->me = 0;
  link_home_rows();
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
  /* alone: one player, this Bit's owner. Linked: every Bit runs every player, draws its own (me), and only
     player 1's Bit keeps the save file (the others play from it but don't write it), like the studio. */
  int players = 1, me = 0, keep_save = 1;
  const char *link_names = NULL;
  link_start_info(&players, &me, &link_names, &keep_save);
  BK->players = players; BK->me = me; BK->net.id = (int32_t)my_net_id(n);
  BK->net.out_n = BK->net.in_n = BK->net.in_r = 0;
  snprintf(s->save_key, sizeof(s->save_key), "%s", !keep_save ? "" : e->save_key[0] ? e->save_key : s->cart.name);
  put_save(s->save_key);
  /* NAMES / NAME_COLORS (player_name()): on one Bit, player 1 is the owner; linked, every seat's owner */
  char names[400], nm[40];
  lua_str(nm, sizeof(nm), bs.name);
  if (link_names) snprintf(names, sizeof(names), "%s", link_names);
  else snprintf(names, sizeof(names), "NAMES = {%s}\nNAME_COLORS = {%d}\n", nm, bs.color);
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
  if (link_on()) { link_end(0); link_leave(0); return; }
  if (mode == MODE_GAME) pause_current();
  else if (cur && cur != home_slot) slot_close(cur);
  boot_home();
}

/* from the home screen: carry on with a paused game, or start it */
int bk_host_launch(int n) {
  if (n < 1 || n > nE) return 1;
  sel = n;
  if (link_wanted(n)) return link_launch(n, 0);   /* other Bits are on their home screens: play it together */
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

/* ------------------------------------------------------------ linked Bits (radio: ESP-NOW on the device) */
/* The same game plan as the studio's linked windows (studio.js, "multiplayer: linked Bits"):
   - every Bit says hello (HI) once a second with its number, name and what it is doing; a Bit not heard for 4 s is gone
   - the home screen shows them (map rows 0-1, see home.js); starting a game there starts it on every Bit that is on
     its home screen too, up to 8 (START, with the seats). The game must be the very same file on every Bit (fp).
   - lockstep: a frame runs only once every player's buttons for it are here. Each Bit sends its own DELAY frames
     ahead (IN, with the last few frames in every packet, so a lost packet costs nothing) and sends them again
     while it waits. Start+Select or home() by anyone pauses the game on every Bit on the same frame; picking it
     again with the same Bits carries on together (each Bit keeps its copy, matched by the session it was paused in).
   - games that use net_send() don't run in lockstep: each Bit plays on its own and the events go out as NET packets.
   Packets: 'B' 'K' version type, from id (u32), then the type's fields, little endian, at most 250 bytes. */
#define LK_VER 1
enum { LK_HI = 1, LK_START, LK_IN, LK_END, LK_NET };
#define LK_PEERS 16
#define LK_RING 32                     /* frames of buttons kept per player */
#define LK_SEND 10                     /* frames in each IN packet */
#define LK_DELAY 3                     /* frames of input delay (hides the radio's lag) */
#define LK_GONE_MS 4000
#define LK_PRESS BK_NUM_BUTTONS

typedef struct { uint32_t id, seen; uint8_t num, st, color; char name[11]; } lk_peer;
typedef struct { uint32_t f1; uint16_t m; uint8_t p[LK_PRESS]; } lk_in;   /* f1 = frame + 1 (0 = empty) */

static struct {
  uint32_t id, ticks, last_hi, sids;
  int npeers, home_n;
  lk_peer peer[LK_PEERS];
  /* the session: a linked game running now */
  int on, np, slot, game, waiting, banner, rep, hold;
  uint32_t sid, host, resume, at, f, sent, hash;
  uint32_t ids[BK_MAX_PLAYERS];
  uint8_t combo[BK_MAX_PLAYERS];
  char names[400];
  lk_in in[BK_MAX_PLAYERS][LK_RING];
  uint8_t under[BK_W * 12];            /* the game's pixels under the "waiting" bar */
  int heard;
} BK_BIG_BSS LK;                        /* PSRAM on the device */

static uint32_t lk_now(void) { return C.millis ? C.millis() : LK.ticks * 1000u / BK_FPS; }
static uint32_t fnv(uint32_t h, const void *d, size_t n) {
  const uint8_t *p = d;
  for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 16777619u; }
  return h;
}
static uint8_t my_num(void) { return (uint8_t)(1 + LK.id % 99); }
static int link_on(void) { return LK.on; }

/* packets */
typedef struct { uint8_t b[250]; int n; } lk_w;
static void w8(lk_w *w, uint32_t v) { if (w->n < 250) w->b[w->n++] = (uint8_t)v; }
static void w16(lk_w *w, uint32_t v) { w8(w, v); w8(w, v >> 8); }
static void w32(lk_w *w, uint32_t v) { w16(w, v); w16(w, v >> 16); }
static void wstr(lk_w *w, const char *s, int max) { int n = (int)strlen(s); if (n > max) n = max; w8(w, (uint32_t)n); for (int i = 0; i < n; i++) w8(w, (uint8_t)s[i]); }
static void whead(lk_w *w, int type) { w->n = 0; w8(w, 'B'); w8(w, 'K'); w8(w, LK_VER); w8(w, (uint32_t)type); w32(w, LK.id); }
static void wsend(lk_w *w) { if (C.radio_send && w->n <= 250) C.radio_send(w->b, w->n); }
typedef struct { const uint8_t *b; int n, i, bad; } lk_r;
static uint32_t r8(lk_r *r) { if (r->i >= r->n) { r->bad = 1; return 0; } return r->b[r->i++]; }
static uint32_t r16(lk_r *r) { uint32_t a = r8(r); return a | r8(r) << 8; }
static uint32_t r32(lk_r *r) { uint32_t a = r16(r); return a | r16(r) << 16; }
static void rstr(lk_r *r, char *out, int cap) {
  int n = (int)r8(r), j = 0;
  for (int i = 0; i < n; i++) { char c = (char)r8(r); if (j < cap - 1 && c >= 32 && c < 127) out[j++] = c; }
  out[j] = 0;
}

/* this Bit's state for the others: 1 on its home screen, 2 in a game, 3 neither (error screen) */
static uint8_t my_state(void) { return mode == MODE_HOME || mode == MODE_BOOT ? 1 : mode == MODE_GAME ? 2 : 3; }
static void send_hi(void) {
  lk_w w; whead(&w, LK_HI);
  w8(&w, my_num()); w8(&w, my_state()); w8(&w, (uint32_t)bs.color); wstr(&w, bs.name, 10);
  wsend(&w);
  LK.last_hi = lk_now();
}
static lk_peer *find_peer(uint32_t id) { for (int i = 0; i < LK.npeers; i++) if (LK.peer[i].id == id) return &LK.peer[i]; return NULL; }

/* every Bit (this one too), in number order: ids[], and which one is this Bit */
static int bits_sorted(uint32_t *ids, uint8_t *nums, uint8_t *st, int *mine) {
  int n = 0;
  ids[n] = LK.id; nums[n] = my_num(); st[n] = my_state(); n++;
  for (int i = 0; i < LK.npeers && n < LK_PEERS + 1; i++) { ids[n] = LK.peer[i].id; nums[n] = LK.peer[i].num; st[n] = LK.peer[i].st; n++; }
  for (int i = 1; i < n; i++)                       /* insertion sort by number, then id */
    for (int j = i; j > 0 && (nums[j] < nums[j - 1] || (nums[j] == nums[j - 1] && ids[j] < ids[j - 1])); j--) {
      uint32_t t = ids[j]; ids[j] = ids[j - 1]; ids[j - 1] = t;
      uint8_t u = nums[j]; nums[j] = nums[j - 1]; nums[j - 1] = u;
      u = st[j]; st[j] = st[j - 1]; st[j - 1] = u;
    }
  for (int i = 0; i < n; i++) if (ids[i] == LK.id) *mine = i;
  return n;
}
/* who plays when this Bit starts a game: itself first, then every Bit on its home screen (or idle) */
static int roster(uint32_t *out) {
  uint32_t ids[LK_PEERS + 1]; uint8_t nums[LK_PEERS + 1], st[LK_PEERS + 1]; int mine = 0;
  const int n = bits_sorted(ids, nums, st, &mine);
  int k = 0;
  out[k++] = LK.id;
  for (int i = 0; i < n && k < BK_MAX_PLAYERS; i++) if (ids[i] != LK.id && st[i] != 2) out[k++] = ids[i];
  return k;
}
static int link_roster_n(void) { uint32_t r[BK_MAX_PLAYERS]; return C.radio_send ? roster(r) : 1; }

/* the home screen reads the linked Bits from map rows 0-1: (0,0) how many, (1,0) which one is this Bit,
   (1+i,0) Bit i's number, (1+i,1) 1 home, 2 in a game, 3 idle */
static void link_home_rows(void) {
  if (!C.radio_send || mode != MODE_HOME) return;
  uint32_t ids[LK_PEERS + 1]; uint8_t nums[LK_PEERS + 1], st[LK_PEERS + 1]; int mine = 0;
  const int n = bits_sorted(ids, nums, st, &mine);
  BK->map[0] = (uint16_t)n; BK->map[1] = (uint16_t)(mine + 1);
  for (int i = 0; i < n; i++) { BK->map[2 + i] = nums[i]; BK->map[BK_MAP_W + 2 + i] = st[i]; }
}

/* a game's fingerprint (the file's bytes) and whether it talks with net_send(): worked out when first needed */
static void entry_info(entry *e) {
  if (e->info) return;
  e->info = 1;
  size_t len = 0;
  char *d = read_file(e->path, &len);
  if (!d) return;
  e->fp = fnv(2166136261u, d, len) | 1u;
  e->net = strstr(d, "net_send(") != NULL;
  free_(d);
}
static int link_wanted(int n) {
  if (!C.radio_send || n < 1 || n > nE || E[n - 1].is_app || link_roster_n() < 2) return 0;
  entry_info(&E[n - 1]);
  return !E[n - 1].net;   /* net_send games meet in their own lobby, like the studio's */
}
static uint32_t my_net_id(int n) {
  if (!C.radio_send || LK.on || n < 1 || n > nE) return 0;
  entry_info(&E[n - 1]);
  return E[n - 1].net ? 1 + LK.id % 65534 : 0;
}

static void link_start_info(int *players, int *me, const char **names, int *keep_save) {
  if (!LK.on) return;
  *players = LK.np; *me = LK.slot; *names = LK.names; *keep_save = LK.slot == 1;
}

/* START: sid, np, fp, resume, game name, then per seat: id, number, colour, name */
static void send_start(uint32_t sid, int np, const uint32_t *ids, uint32_t fp, uint32_t resume, const char *game) {
  lk_w w; whead(&w, LK_START);
  w32(&w, sid); w8(&w, (uint32_t)np); w32(&w, fp); w32(&w, resume); wstr(&w, game, 40);
  for (int k = 0; k < np; k++) {
    const lk_peer *p = find_peer(ids[k]);
    w32(&w, ids[k]);
    w8(&w, ids[k] == LK.id ? my_num() : p ? p->num : 0);
    w8(&w, ids[k] == LK.id ? (uint32_t)bs.color : p ? p->color : 27);
    wstr(&w, ids[k] == LK.id ? bs.name : p ? p->name : "", 10);
  }
  wsend(&w);
}
static void link_end(int why) {   /* 0 left, 1 doesn't have the game, 2 no paused copy, 3 the game stopped */
  if (!LK.sid) return;
  lk_w w; whead(&w, LK_END); w32(&w, LK.sid); w8(&w, (uint32_t)why);
  wsend(&w);
}

static void enter(uint32_t from, uint32_t sid, int np, const uint32_t *ids, const uint8_t *cols, char names[][11], uint32_t fp, uint32_t resume, const char *game);
/* this Bit starts game n for itself and every Bit on its home screen */
static int link_launch(int n, int fresh) {
  uint32_t ids[BK_MAX_PLAYERS];
  int np = roster(ids);
  entry *e = &E[n - 1];
  entry_info(e);
  uint32_t resume = 0;
  slot *p = paused_slot_np(n, np);
  if (p && !fresh) {   /* carry on with the same Bits in the same seats, if they are all here */
    int all = 1;
    for (int k = 0; k < np && all; k++) {
      int found = 0;
      for (int j = 0; j < np; j++) found |= p->link_ids[k] == ids[j];
      all = found;
    }
    if (all) { memcpy(ids, p->link_ids, sizeof(uint32_t) * (size_t)np); resume = p->link_token; }
  } else if (p && fresh) slot_close(p);
  const uint32_t sid = fnv(fnv(2166136261u, &LK.id, 4), &(uint32_t){ lk_now() ^ ++LK.sids << 20 }, 4) | 1u;
  send_start(sid, np, ids, e->fp, resume, e->name);
  uint8_t cols[BK_MAX_PLAYERS]; char nm[BK_MAX_PLAYERS][11];
  for (int k = 0; k < np; k++) {
    const lk_peer *q = find_peer(ids[k]);
    cols[k] = ids[k] == LK.id ? (uint8_t)bs.color : q ? q->color : 27;
    snprintf(nm[k], 11, "%.10s", ids[k] == LK.id ? bs.name : q ? q->name : "");
  }
  enter(LK.id, sid, np, ids, cols, nm, e->fp, resume, e->name);
  return 0;
}

/* a START (from another Bit, or this one): every Bit in its seats begins the game */
static void enter(uint32_t from, uint32_t sid, int np, const uint32_t *ids, const uint8_t *cols, char names[][11], uint32_t fp, uint32_t resume, const char *game) {
  int me = 0;
  for (int k = 0; k < np; k++) if (ids[k] == LK.id) me = k + 1;
  if (!me || np < 2 || np > BK_MAX_PLAYERS) return;
  if (from != LK.id) {
    if (LK.on && LK.sid == sid) return;
    if (LK.on) {
      int in = 0;
      for (int k = 0; k < LK.np; k++) in |= LK.ids[k] == from;
      if (!in) return;                                                     /* a Bit from outside this game */
      if (LK.host != from && lk_now() - LK.at < 300 && sid > LK.sid) return;   /* two Bits started at once: one wins */
    } else if (mode == MODE_GAME) return;                                  /* busy with a game of its own */
  }
  int n = 0;
  for (int i = 0; i < nE && !n; i++) if (!E[i].is_app) { entry_info(&E[i]); if (E[i].fp == fp) n = i + 1; }
  char m[160];
  /* leave whatever this Bit was doing */
  if (LK.on && mode == MODE_GAME) { if (cur) slot_close(cur); cur = NULL; }
  else if (mode == MODE_GAME) pause_current();
  LK.on = 0;
  if (!n) {
    snprintf(m, sizeof(m), "this Bit doesn't have \"%s\" (the same version), so the linked game can't start", game);
    say(m, 1);
    LK.sid = sid; link_end(1); LK.sid = 0;
    if (mode != MODE_HOME) boot_home();
    return;
  }
  memset(LK.in, 0, sizeof(LK.in)); memset(LK.combo, 0, sizeof(LK.combo));
  LK.on = 1; LK.sid = sid; LK.host = from; LK.np = np; LK.slot = me; LK.game = n; LK.resume = resume;
  LK.at = lk_now(); LK.f = LK.sent = 0; LK.waiting = LK.banner = LK.rep = 0; LK.hash = 2166136261u; LK.hold = 0;
  memcpy(LK.ids, ids, sizeof(uint32_t) * (size_t)np);
  /* NAMES / NAME_COLORS: every seat's owner */
  size_t o = (size_t)snprintf(LK.names, sizeof(LK.names), "NAMES = {");
  for (int k = 0; k < np; k++) { char q[40]; lua_str(q, sizeof(q), names[k]); o += (size_t)snprintf(LK.names + o, sizeof(LK.names) - o, "%s%s", k ? ", " : "", q); }
  o += (size_t)snprintf(LK.names + o, sizeof(LK.names) - o, "}\nNAME_COLORS = {");
  for (int k = 0; k < np; k++) o += (size_t)snprintf(LK.names + o, sizeof(LK.names) - o, "%s%d", k ? ", " : "", cols[k] ? cols[k] : 27);
  snprintf(LK.names + o, sizeof(LK.names) - o, "}\n");
  sel = n;
  if (home_slot) slot_close(home_slot);
  if (resume) {
    slot *p = NULL;
    for (int i = 0; i < nslots && !p; i++) if (S[i].used && S[i].paused && S[i].game == n && S[i].link_token == resume && S[i].link_np == np) p = &S[i];
    if (!p) {
      say("this Bit has no paused copy of that game, so the Bits can't carry on together", 1);
      link_end(2); LK.on = 0; LK.sid = 0; boot_home();
      return;
    }
    BK = p->m; bk_ctx_put(&p->ctx); memset(&p->ctx, 0, sizeof(p->ctx));
    p->paused = 0; p->link_np = 0; cur = p; mode = MODE_GAME;
    LK.hold = 1;                       /* the button that carried on is ignored until it is let go */
    snprintf(m, sizeof(m), "carrying on with \"%s\" on %d Bits: this Bit is player %d", E[n - 1].name, np, me);
    say(m, 0);
  } else {
    snprintf(m, sizeof(m), "linked game: \"%s\" on %d Bits, this Bit is player %d", E[n - 1].name, np, me);
    say(m, 0);
    if (start_game(n, NULL)) { LK.on = 0; return; }
  }
  send_hi();
}

/* everyone goes home together; pause = each Bit keeps its copy of the game, to carry on together later */
static void link_leave(int pause) {
  if (!LK.on) return;
  LK.on = 0;
  if (cur && cur != home_slot && mode == MODE_GAME) {
    if (pause) {
      slot *s = cur;
      pause_current();
      s->link_np = LK.np; s->link_token = LK.sid;
      memcpy(s->link_ids, LK.ids, sizeof(LK.ids));
    } else { take_save(); slot_close(cur); cur = NULL; }
  }
  LK.sid = 0;
  boot_home();
  send_hi();
}

/* IN: sid, seat, first frame, count, then per frame: buttons (u16) and pressure */
static void send_in(void) {
  lk_w w; whead(&w, LK_IN);
  const uint32_t first = LK.sent > LK_SEND ? LK.sent - LK_SEND : 0, cnt = LK.sent - first;
  w32(&w, LK.sid); w8(&w, (uint32_t)LK.slot); w32(&w, first); w8(&w, cnt);
  for (uint32_t f = first; f < LK.sent; f++) {
    const lk_in *e = &LK.in[LK.slot - 1][f % LK_RING];
    w16(&w, e->m);
    for (int i = 0; i < LK_PRESS; i++) w8(&w, e->p[i]);
  }
  wsend(&w);
}
static void put_in(int seat, uint32_t f, uint16_t m, const uint8_t *p) {
  if (seat < 1 || seat > LK.np || f < LK.f || f >= LK.f + LK_RING) return;
  lk_in *e = &LK.in[seat - 1][f % LK_RING];
  if (e->f1 == f + 1) return;
  e->f1 = f + 1; e->m = m;
  memcpy(e->p, p, LK_PRESS);
}

/* the bar at the bottom while a Bit's buttons are late; the game's own pixels under it are put back first */
static void banner_off(void) {
  if (!LK.banner) return;
  memcpy(&BK->screen[(BK_H - 12) * BK_W], LK.under, sizeof(LK.under));
  LK.banner = 0;
}
static void banner_on(void) {
  if (!LK.banner) memcpy(LK.under, &BK->screen[(BK_H - 12) * BK_W], sizeof(LK.under));
  LK.banner = 1;
  /* drawn straight into the pixels (not with the game's draw state, which must stay as the game left it) */
  memset(&BK->screen[(BK_H - 12) * BK_W], 1, sizeof(LK.under));
  char t[64]; int miss = 0;
  for (int k = 0; k < LK.np && !miss; k++) if (LK.in[k][LK.f % LK_RING].f1 != LK.f + 1) miss = k + 1;
  const lk_peer *p = miss ? find_peer(LK.ids[miss - 1]) : NULL;
  snprintf(t, sizeof(t), "WAITING FOR BIT %d   START+SELECT LEAVES", p ? p->num : 0);
  bk_machine *keep = BK;
  BK = sysm;                           /* draw the text on the error screen's machine, then copy its pixels */
  bk_reset_draw_state();
  memset(&BK->screen[(BK_H - 12) * BK_W], 1, sizeof(LK.under));
  bk_text(t, 4, BK_H - 10, 7, 1);
  memcpy(&keep->screen[(BK_H - 12) * BK_W], &BK->screen[(BK_H - 12) * BK_W], sizeof(LK.under));
  BK = keep;
}

static void link_frame(uint16_t mask, const uint8_t *press) {
  static const uint8_t NOP[LK_PRESS];
  uint8_t pr[LK_PRESS];
  if (press) memcpy(pr, press, LK_PRESS); else for (int i = 0; i < LK_PRESS; i++) pr[i] = (mask >> i) & 1 ? 255 : 0;
  if (LK.hold) { if (mask) { mask = 0; memcpy(pr, NOP, LK_PRESS); } else LK.hold = 0; }
  /* this Bit's buttons, DELAY frames ahead */
  int fresh = 0;
  while (LK.sent <= LK.f + LK_DELAY) { put_in(LK.slot, LK.sent, mask, pr); LK.sent++; fresh = 1; }
  if (fresh || (LK.waiting && ++LK.rep % 4 == 0)) send_in();
  /* run the frames whose buttons are all here: one, or two to catch up when the others are ahead */
  for (int step = 0; step < 2; step++) {
    int ready = 1, ahead = 1;
    for (int k = 0; k < LK.np; k++) {
      ready &= LK.in[k][LK.f % LK_RING].f1 == LK.f + 1;
      ahead &= LK.in[k][(LK.f + 1) % LK_RING].f1 == LK.f + 2;
    }
    if (!ready) break;
    if (step && !ahead) break;
    banner_off();
    LK.waiting = 0;
    int leave = 0;
    for (int k = 0; k < LK.np; k++) {
      const lk_in *e = &LK.in[k][LK.f % LK_RING];
      bk_set_input(k, e->m, e->p);
      const int both = (e->m & (START | SELECT)) == (START | SELECT);   /* Start+Select by anyone: home on this frame */
      if (both && !LK.combo[k]) leave = 1;
      LK.combo[k] = (uint8_t)both;
      LK.hash = fnv(LK.hash, &e->m, 2);
    }
    if (leave) { link_leave(1); return; }
    LK.f++;
    if (bk_lua_frame() != 0) { show_error(bk_lua_error()); return; }
    LK.hash = fnv(LK.hash, &BK->rng, sizeof(BK->rng));
    take_save();
    if (!step) capture_after_frame(mask);
    if (BK->sys[0] == 5) { BK->sys[0] = 0; restart_game(BK->sys[1]); continue; }   /* the same frame on every Bit */
    handle_requests();
    if (!LK.on || mode != MODE_GAME) return;
  }
  int ready = 1;
  for (int k = 0; k < LK.np; k++) ready &= LK.in[k][LK.f % LK_RING].f1 == LK.f + 1;
  if (ready) return;
  LK.waiting++;
  if (LK.waiting > BK_FPS) banner_on();
  /* stuck: Start+Select on this Bit leaves the game for everyone */
  if (LK.waiting > BK_FPS && (mask & (START | SELECT)) == (START | SELECT) && !combo_held) {
    say("left the linked game", 0);
    link_end(0); link_leave(0);
  }
}

/* NET: key (the game's name), then events: count, values */
static uint32_t net_key(void) { return cur && cur->game ? fnv(2166136261u, E[cur->game - 1].name, strlen(E[cur->game - 1].name)) : 0; }
static void net_after_frame(void) {
  int n = BK->net.out_n;
  BK->net.out_n = 0;
  if (!C.radio_send || !BK->net.id || mode != MODE_GAME || n <= 0) return;
  if (n > BK_NET_OUT) n = BK_NET_OUT;
  lk_w w; whead(&w, LK_NET); w32(&w, net_key());
  for (int i = 0; i < n; i++) {
    int c = BK->net.out[i][1];
    if (c < 0) c = 0;
    if (c > BK_NET_VALS) c = BK_NET_VALS;
    if (w.n + 1 + 4 * c > 250) { wsend(&w); whead(&w, LK_NET); w32(&w, net_key()); }
    w8(&w, (uint32_t)c);
    for (int k = 0; k < c; k++) w32(&w, (uint32_t)BK->net.out[i][2 + k]);
  }
  wsend(&w);
}
static void net_recv(uint32_t from, lk_r *r) {
  if (mode != MODE_GAME || !cur || !BK->net.id || r32(r) != net_key()) return;
  /* keep what the game hasn't read yet at the front, then add these */
  int nn = BK->net.in_n, rd = BK->net.in_r < 0 ? 0 : BK->net.in_r > nn ? nn : BK->net.in_r, w = 0;
  for (; rd < nn; rd++, w++) if (w != rd) memcpy(BK->net.in[w], BK->net.in[rd], sizeof(BK->net.in[0]));
  BK->net.in_n = w; BK->net.in_r = 0;
  while (r->i < r->n && !r->bad) {
    int c = (int)r8(r);
    if (c > BK_NET_VALS) { r->bad = 1; break; }
    int32_t v[BK_NET_VALS];
    for (int k = 0; k < c; k++) v[k] = (int32_t)r32(r);
    if (r->bad || BK->net.in_n >= BK_NET_IN) break;
    int32_t *o = BK->net.in[BK->net.in_n++];
    o[0] = (int32_t)(1 + from % 65534); o[1] = c;
    memcpy(o + 2, v, sizeof(int32_t) * (size_t)c);
    LK.heard++;
  }
}

void bk_host_radio_recv(const void *pkt, int len) {
  lk_r r = { pkt, len, 0, 0 };
  if (!C.radio_send || r8(&r) != 'B' || r8(&r) != 'K' || r8(&r) != LK_VER) return;
  const int type = (int)r8(&r);
  const uint32_t from = r32(&r);
  if (r.bad || from == LK.id) return;
  lk_peer *p = find_peer(from);
  if (type == LK_HI) {
    const int isnew = !p;
    if (!p) {
      if (LK.npeers >= LK_PEERS) return;
      p = &LK.peer[LK.npeers++];
      memset(p, 0, sizeof(*p)); p->id = from;
    }
    p->num = (uint8_t)r8(&r); p->st = (uint8_t)r8(&r); p->color = (uint8_t)r8(&r);
    rstr(&r, p->name, sizeof(p->name));
    p->seen = lk_now();
    if (isnew) {
      char m[64]; snprintf(m, sizeof(m), "linked with Bit %d%s%s", p->num, p->name[0] ? ": " : "", p->name); say(m, 0);
      send_hi();   /* answer straight away, so both know each other */
    }
    return;
  }
  if (p) p->seen = lk_now();
  if (type == LK_START) {
    uint32_t ids[BK_MAX_PLAYERS]; uint8_t cols[BK_MAX_PLAYERS]; char names[BK_MAX_PLAYERS][11]; char game[48];
    const uint32_t sid = r32(&r); const int np = (int)r8(&r); const uint32_t fp = r32(&r), resume = r32(&r);
    rstr(&r, game, sizeof(game));
    if (np < 2 || np > BK_MAX_PLAYERS) return;
    for (int k = 0; k < np; k++) { ids[k] = r32(&r); r8(&r); cols[k] = (uint8_t)r8(&r); rstr(&r, names[k], 11); }
    if (!r.bad) enter(from, sid, np, ids, cols, names, fp, resume, game);
  } else if (type == LK_IN) {
    const uint32_t sid = r32(&r); const int seat = (int)r8(&r); const uint32_t first = r32(&r); const int cnt = (int)r8(&r);
    if (!LK.on || sid != LK.sid || seat == LK.slot) return;
    for (int i = 0; i < cnt && !r.bad; i++) {
      uint16_t m = (uint16_t)r16(&r); uint8_t pr[LK_PRESS];
      for (int k = 0; k < LK_PRESS; k++) pr[k] = (uint8_t)r8(&r);
      if (!r.bad) put_in(seat, first + (uint32_t)i, m, pr);
    }
  } else if (type == LK_END) {
    const uint32_t sid = r32(&r); const int why = (int)r8(&r);
    if (!LK.on || sid != LK.sid || r.bad) return;
    static const char *W[4] = { "left the game", "doesn't have this game", "has no paused copy of it", "stopped with an error" };
    char m[96]; snprintf(m, sizeof(m), "Bit %d %s, so the linked game ended", p ? p->num : 0, W[why & 3]); say(m, 1);
    link_leave(0);
  } else if (type == LK_NET) net_recv(from, &r);
}

/* once per frame: say hello, notice Bits that are gone, keep the home screen's list up to date */
static void link_tick(void) {
  LK.ticks++;
  if (!C.radio_send) return;
  const uint32_t now = lk_now();
  if (now - LK.last_hi >= 1000) send_hi();
  for (int i = 0; i < LK.npeers; i++)
    if (now - LK.peer[i].seen > LK_GONE_MS) {
      char m[48]; snprintf(m, sizeof(m), "lost Bit %d", LK.peer[i].num); say(m, 0);
      const uint32_t id = LK.peer[i].id;
      LK.peer[i] = LK.peer[--LK.npeers]; i--;
      if (LK.on) for (int k = 0; k < LK.np; k++) if (LK.ids[k] == id) { say("a player's Bit is gone, so the linked game ended", 1); link_leave(0); break; }
    }
  /* the paused badges depend on how many Bits would play: draw the home screen again when that changes */
  const int n = link_roster_n();
  if (mode == MODE_HOME && n != LK.home_n && LK.ticks > 2) { LK.home_n = n; boot_home(); }
  LK.home_n = n;
}

int bk_host_linked(void) { return 1 + LK.npeers; }
int bk_host_link_players(void) { return LK.on ? LK.np : 0; }
uint32_t bk_host_link_sync(uint32_t *frame) { if (frame) *frame = LK.f; return LK.hash; }
int bk_host_net_heard(void) { return LK.heard; }

static void link_init(void) {
  memset(&LK, 0, sizeof(LK));
  LK.id = C.bit_id ? C.bit_id : (uint32_t)(uintptr_t)&LK ^ (uint32_t)time(NULL) ^ 0x5bd1e995u;
  if (!LK.id) LK.id = 1;
  LK.last_hi = lk_now() - 1000;
}

/* ------------------------------------------------------------ the frame */
static void handle_requests(void);
int bk_host_frame(uint16_t mask, const uint8_t *press) {
  link_tick();
  const int both = (mask & (START | SELECT)) == (START | SELECT);
  if (mode == MODE_ERROR) {
    uint16_t down = mask & ~err_last; err_last = mask;
    if (down & ((1u << BK_A) | (1u << BK_B) | START)) { cur = NULL; boot_home(); }
    combo_held = both;
    return 0;
  }
  if (!cur) { combo_held = both; boot_home(); return 0; }
  if (link_on() && mode == MODE_GAME) { link_frame(mask, press); combo_held = both; return 0; }   /* lockstep */
  if (both && !combo_held && mode == MODE_GAME) { combo_held = both; bk_host_go_home(); return 0; }
  combo_held = both;
  if (mode == MODE_HOME) link_home_rows();
  if (cur->hold) {                   /* a resumed game sees no buttons until the one that resumed it is let go */
    if (mask) { mask = 0; press = NULL; } else cur->hold = 0;
  }
  bk_set_input(0, mask, press);
  if (bk_lua_frame() != 0) { show_error(bk_lua_error()); return 1; }
  net_after_frame();
  take_save();
  capture_after_frame(mask);
  if (mode == MODE_HOME && BK->track[2] && BK->track[0] < 0) {   /* -1: start game n over, -2: n is selected */
    const int k = BK->track[0], n = BK->track[1];
    BK->track[2] = 0;
    if (k == -2) sel = n;
    else if (k == -1) {
      if (link_wanted(n)) { sel = n; link_launch(n, 1); return 0; }
      slot *p = paused_slot(n); if (p) slot_close(p); bk_host_launch(n); return 0;
    }
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
    case 2: if (mode == MODE_GAME && link_on()) link_leave(1); else if (mode == MODE_GAME) bk_host_go_home(); else if (mode == MODE_BOOT) boot_home(); break;
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
  link_init();
  char m[80]; snprintf(m, sizeof(m), "%d games and apps", nE); say(m, 0);
  boot_anim();
  return 0;
}
