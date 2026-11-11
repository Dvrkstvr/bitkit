/* Cart files (.bitkit, the studio's own format) on the device. MIT License. */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "bk_json.h"

typedef struct {
  char *text;                 /* the file; strings below point into it */
  bk_json *root;
  const char *name, *code, *entities_lua;
  uint8_t *palette, *tiles, *flags;     /* 768, BK_TILES * 64, BK_TILES bytes */
  int nlevels;
  uint16_t **maps;            /* one BK_MAP_W x BK_MAP_H map per level */
  int is_app, settings;       /* an app on the home screen's second row (Hexbeat, Settings...) */
  const char *sub, *save_key; /* app: its line under the name and its save file */
  uint8_t icon[256];          /* 16x16 palette indices for the home screen */
  int has_icon;
  int builtin;                /* came with the firmware: the home screen shows no file name */
} bk_cart;

typedef struct {
  void *(*alloc)(size_t);     /* where cart data goes (PSRAM on the device); NULL = malloc */
  void (*release)(void *);
} bk_cart_mem;

/* what = BK_CART_INFO: only name, app details and icon (for the home screen); BK_CART_ALL: everything to play it */
enum { BK_CART_INFO = 0, BK_CART_ALL = 1 };
int  bk_cart_load(bk_cart *c, const char *path, int what, const bk_cart_mem *mem, char *err, size_t errlen);
void bk_cart_free(bk_cart *c, const bk_cart_mem *mem);
/* helpers, also used by tests */
size_t bk_b64_decode(const char *in, size_t inlen, uint8_t *out, size_t outmax);
size_t bk_unrle_b64(const char *in, uint8_t *out, size_t outlen, uint8_t *tmp, size_t tmpmax);
