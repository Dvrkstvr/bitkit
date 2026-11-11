/* Reads .bitkit cart files: JSON with base64 palette, RLE+base64 tiles, flags and level maps (see studio.js
   serialize()). The entity data is already Lua (entities_lua), so the device runs exactly what the studio runs.
   MIT License. */
#include "bk_cart.h"
#include "../../runtime/bk.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *def_alloc(size_t n) { return malloc(n); }
static void def_release(void *p) { free(p); }

static int b64v(int c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62;
  if (c == '/' || c == '_') return 63;
  return -1;
}

size_t bk_b64_decode(const char *in, size_t inlen, uint8_t *out, size_t outmax) {
  uint32_t acc = 0; int bits = 0; size_t o = 0;
  for (size_t i = 0; i < inlen; i++) {
    int v = b64v((unsigned char)in[i]);
    if (v < 0) { if (in[i] == '=') break; continue; }
    acc = (acc << 6) | (uint32_t)v; bits += 6;
    if (bits >= 8) { bits -= 8; if (o < outmax) out[o] = (uint8_t)(acc >> bits); o++; }
  }
  return o;
}

/* [count, value] byte pairs, base64'd. tmp holds the decoded pairs (needs ~3/4 of strlen(in)). */
size_t bk_unrle_b64(const char *in, uint8_t *out, size_t outlen, uint8_t *tmp, size_t tmpmax) {
  size_t n = bk_b64_decode(in, strlen(in), tmp, tmpmax), o = 0;
  if (n > tmpmax) n = tmpmax;
  for (size_t i = 0; i + 1 < n && o < outlen; i += 2)
    for (int k = 0; k < tmp[i] && o < outlen; k++) out[o++] = tmp[i + 1];
  return o;
}

static int unrle_field(const bk_json *s, uint8_t *out, size_t len, const bk_cart_mem *m) {
  memset(out, 0, len);
  if (!s || s->type != BJ_STR) return 0;
  size_t tmax = s->len * 3 / 4 + 4;
  uint8_t *tmp = m->alloc(tmax);
  if (!tmp) return -1;
  bk_unrle_b64(s->str, out, len, tmp, tmax);
  m->release(tmp);
  return 0;
}

/* the game's icon: the player's (or first entity's) first frame, else tile 1, scaled into 16x16 (studio iconFor) */
static void make_icon(bk_cart *c) {
  const bk_json *ents = bk_json_get(c->root, "entities"), *types = bk_json_get(ents, "types"), *t = NULL;
  if (types && types->type == BJ_ARR) {
    for (const bk_json *x = types->child; x; x = x->next) if (bk_json_bool(x, "player", 0)) { t = x; break; }
    if (!t) t = types->child;
  }
  int f = 1, w = 1, h = 1;
  const bk_json *anims = bk_json_get(t, "anims");
  if (anims && anims->type == BJ_ARR)
    for (const bk_json *a = anims->child; a; a = a->next) {
      const bk_json *fr = bk_json_get(a, "frames");
      if (fr && fr->type == BJ_ARR && fr->child) {
        f = (int)fr->child->num;
        w = (int)bk_json_num(t, "sw", 1); h = (int)bk_json_num(t, "sh", 1);
        if (w < 1) w = 1;
        if (w > 4) w = 4;
        if (h < 1) h = 1;
        if (h > 4) h = 4;
        break;
      }
    }
  const int sw = w * 8, sh = h * 8, sz = sw > sh ? sw : sh, ox = (sz - sw) >> 1, oy = (sz - sh) >> 1;
  int any = 0;
  for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
    const int px = x * sz / 16 - ox, py = y * sz / 16 - oy;
    uint8_t v = 0;
    if (px >= 0 && py >= 0 && px < sw && py < sh) {
      const int tile = f + (py >> 3) * 16 + (px >> 3);
      v = tile >= 0 && tile < BK_TILES ? c->tiles[tile * 64 + (py & 7) * 8 + (px & 7)] : 0;
    }
    c->icon[y * 16 + x] = v;
    if (v) any = 1;
  }
  c->has_icon = any;
}

/* ------------------------------------------------------------ players = ..., race = ... */
static int is_word(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_'; }
static int is_space(int c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }
/* a comment or a string at i: where it ends, or -1 when there is none */
static long skip_cs(const char *s, long n, long i) {
  const char c = s[i];
  if (c == '-' && i + 1 < n && s[i + 1] == '-') {
    if (i + 3 < n && s[i + 2] == '[' && s[i + 3] == '[') { const char *e = strstr(s + i + 4, "]]"); return e ? (long)(e - s) + 2 : n; }
    while (i < n && s[i] != '\n') i++;
    return i;
  }
  if (c == '"' || c == '\'') { i++; while (i < n && s[i] != c && s[i] != '\n') i += s[i] == '\\' ? 2 : 1; return i + 1 > n ? n : i + 1; }
  if (c == '[' && i + 1 < n && s[i + 1] == '[') { const char *e = strstr(s + i + 2, "]]"); return e ? (long)(e - s) + 2 : n; }
  return -1;
}
/* name = in body (not after a word character, a dot or a quote): where its value starts, or -1 */
static long field_at(const char *b, long n, const char *name) {
  const long k = (long)strlen(name);
  for (long i = 0; i + k <= n; i++) {
    if (memcmp(b + i, name, (size_t)k)) continue;
    if (i > 0 && (is_word((unsigned char)b[i - 1]) || b[i - 1] == '.' || b[i - 1] == '"' || b[i - 1] == '\'')) continue;
    long j = i + k;
    while (j < n && is_space((unsigned char)b[j])) j++;
    if (j < n && b[j] == '=' && (j + 1 >= n || b[j + 1] != '=')) { j++; while (j < n && is_space((unsigned char)b[j])) j++; return j; }
  }
  return -1;
}
static int read_int(const char *b, long n, long *j) {
  int v = 0, any = 0;
  while (*j < n && b[*j] >= '0' && b[*j] <= '9') { if (v < 10000) v = v * 10 + (b[*j] - '0'); (*j)++; any = 1; }
  return any ? v : -1;
}
void bk_cart_players(const char *s, int *pmin, int *pmax, int *race) {
  int mn = 1, mx = 1, rc = 0, sees = 0;
  long body = -1, bodyn = 0;
  const long n = s ? (long)strlen(s) : 0;
  char last = 0; int last_fn = 0;     /* the last thing outside comments: a character ('a' for a word); after "function" */
  for (long i = 0; i < n;) {
    const long e = skip_cs(s, n, i);
    if (e >= 0) { if (s[i] != '-') { last = '"'; last_fn = 0; } i = e; continue; }
    if (is_word((unsigned char)s[i])) {
      long j = i;
      while (j < n && is_word((unsigned char)s[j])) j++;
      const long len = j - i;
      if (len == 7 && !memcmp(s + i, "PLAYERS", 7)) sees = 1;
      if (len == 4 && !memcmp(s + i, "game", 4) && body < 0 && last != '.' && last != ':' && !last_fn) {
        long q = j;
        while (q < n && is_space((unsigned char)s[q])) q++;
        if (q < n && s[q] == '(') { q++; while (q < n && is_space((unsigned char)s[q])) q++; }
        if (q < n && s[q] == '{') {     /* the table given to game{}: up to its closing brace */
          int d = 1; long r = q + 1;
          while (r < n && d > 0) {
            const long e2 = skip_cs(s, n, r);
            if (e2 >= 0) { r = e2; continue; }
            if (s[r] == '{') d++; else if (s[r] == '}') d--;
            r++;
          }
          body = q + 1; bodyn = r - 1 - body;
          if (bodyn < 0) bodyn = 0;
        }
      }
      last = 'a'; last_fn = len == 8 && !memcmp(s + i, "function", 8);
      i = j;
      continue;
    }
    if (!is_space((unsigned char)s[i])) { last = s[i]; last_fn = 0; }
    i++;
  }
  int declared = 0;
  if (body >= 0) {
    const char *b = s + body;
    long j = field_at(b, bodyn, "players");
    if (j >= 0) {
      if (j < bodyn && b[j] == '{') {
        j++; while (j < bodyn && is_space((unsigned char)b[j])) j++;
        const int a = read_int(b, bodyn, &j);
        while (j < bodyn && is_space((unsigned char)b[j])) j++;
        if (a >= 0 && j < bodyn && b[j] == ',') {
          j++; while (j < bodyn && is_space((unsigned char)b[j])) j++;
          const int c2 = read_int(b, bodyn, &j);
          while (j < bodyn && is_space((unsigned char)b[j])) j++;
          if (c2 >= 0 && j < bodyn && b[j] == '}') { mn = a; mx = c2; declared = 1; }
        }
      } else { const int a = read_int(b, bodyn, &j); if (a >= 0) { mn = mx = a; declared = 1; } }
    }
    j = field_at(b, bodyn, "race");
    if (j >= 0 && j < bodyn && (b[j] == '"' || b[j] == '\'')) {
      if (j + 5 < bodyn && !memcmp(b + j + 1, "time", 4) && b[j + 5] == b[j]) rc = 1;
      if (j + 6 < bodyn && !memcmp(b + j + 1, "score", 5) && b[j + 6] == b[j]) rc = 2;
    }
  }
  if (!declared && sees) mx = 8;
  if (mx > 99) mx = 99;
  if (mx < 1) mx = 1;
  if (mn > mx) mn = mx;
  if (mn < 1) mn = 1;
  *pmin = mn; *pmax = mx; *race = rc;
}

int bk_cart_load(bk_cart *c, const char *path, int what, const bk_cart_mem *mem, char *err, size_t errlen) {
  bk_cart_mem m = { def_alloc, def_release };
  if (mem && mem->alloc) m = *mem;
  memset(c, 0, sizeof(*c));
  FILE *f = fopen(path, "rb");
  if (!f) { snprintf(err, errlen, "can't open %s", path); return 1; }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (n <= 0 || n > 8 * 1024 * 1024) { fclose(f); snprintf(err, errlen, "%s: bad size", path); return 1; }
  c->text = m.alloc((size_t)n + 1);
  if (!c->text) { fclose(f); snprintf(err, errlen, "not enough memory for %s", path); return 1; }
  size_t got = fread(c->text, 1, (size_t)n, f);
  fclose(f);
  c->text[got] = 0;
  c->root = bk_json_parse(c->text, got, m.alloc);
  const char *fmt = bk_json_str(c->root, "format", "");
  if (!c->root || (strcmp(fmt, "bitkit-cart") && strcmp(fmt, "miniboi-cart"))) {
    snprintf(err, errlen, "%s is not a cart file", path);
    bk_cart_free(c, &m);
    return 1;
  }
  c->name = bk_json_str(c->root, "name", "untitled");
  c->code = bk_json_str(c->root, "code", "");
  c->entities_lua = bk_json_str(c->root, "entities_lua", "");
  c->builtin = bk_json_bool(c->root, "builtin", 0);
  bk_cart_players(c->code, &c->pmin, &c->pmax, &c->race);
  c->net = strstr(c->code, "net_send(") != NULL;
  const bk_json *app = bk_json_get(c->root, "app");
  if (app && app->type == BJ_OBJ) {
    c->is_app = 1;
    c->sub = bk_json_str(app, "sub", "");
    c->save_key = bk_json_str(app, "saveKey", c->name);
    c->settings = bk_json_bool(app, "settings", 0);
    const char *ic = bk_json_str(app, "icon", NULL);
    if (ic) { bk_b64_decode(ic, strlen(ic), c->icon, sizeof(c->icon)); c->has_icon = 1; }
  } else c->save_key = c->name;

  c->palette = m.alloc(256 * 3);
  c->tiles = m.alloc(BK_TILES * 64);
  c->flags = m.alloc(BK_TILES);
  if (!c->palette || !c->tiles || !c->flags) { snprintf(err, errlen, "not enough memory for %s", c->name); bk_cart_free(c, &m); return 1; }
  const char *pal = bk_json_str(c->root, "palette", NULL);
  if (pal) bk_b64_decode(pal, strlen(pal), c->palette, 768);
  else bk_default_palette(c->palette);
  if (unrle_field(bk_json_get(c->root, "tiles"), c->tiles, BK_TILES * 64, &m)) goto oom;
  if (!c->is_app) make_icon(c);
  if (what == BK_CART_INFO) return 0;

  if (unrle_field(bk_json_get(c->root, "flags"), c->flags, BK_TILES, &m)) goto oom;
  const bk_json *levels = bk_json_get(c->root, "levels"), *L;
  int nl = 0;
  if (levels && levels->type == BJ_ARR) for (L = levels->child; L; L = L->next) nl++;
  c->nlevels = nl ? nl : 1;
  c->maps = m.alloc(sizeof(uint16_t *) * (size_t)c->nlevels);
  if (!c->maps) goto oom;
  memset(c->maps, 0, sizeof(uint16_t *) * (size_t)c->nlevels);
  for (int i = 0; i < c->nlevels; i++) if (!(c->maps[i] = m.alloc(BK_MAP_W * BK_MAP_H * 2))) goto oom;
  if (nl) { int i = 0; for (L = levels->child; L; L = L->next, i++) if (unrle_field(bk_json_get(L, "map"), (uint8_t *)c->maps[i], BK_MAP_W * BK_MAP_H * 2, &m)) goto oom; }
  else if (unrle_field(bk_json_get(c->root, "map"), (uint8_t *)c->maps[0], BK_MAP_W * BK_MAP_H * 2, &m)) goto oom;
  return 0;
oom:
  snprintf(err, errlen, "not enough memory for %s", c->name ? c->name : path);
  bk_cart_free(c, &m);
  return 1;
}

void bk_cart_free(bk_cart *c, const bk_cart_mem *mem) {
  bk_cart_mem m = { def_alloc, def_release };
  if (mem && mem->alloc) m = *mem;
  if (c->maps) { for (int i = 0; i < c->nlevels; i++) if (c->maps[i]) m.release(c->maps[i]); m.release(c->maps); }
  if (c->palette) m.release(c->palette);
  if (c->tiles) m.release(c->tiles);
  if (c->flags) m.release(c->flags);
  if (c->root) bk_json_free(c->root, m.release);
  if (c->text) m.release(c->text);
  memset(c, 0, sizeof(*c));
}
