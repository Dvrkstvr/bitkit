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
