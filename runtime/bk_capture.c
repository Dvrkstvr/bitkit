/*
 * BitKit capture: photos (PNG) and clips (animated GIF) of the screen.
 * Plain C with no malloc, so the same code runs on the PocketBit (ESP32-S3, written to the SD card) and in the
 * browser studio (WASM, written to memory). It reads the indexed framebuffer and the palette (with the game's
 * colour grading from display{}), so a capture shows the game's own pixels, never the Bit-wide screen look.
 * Everything leaves through a writer callback; nothing is buffered beyond small fixed blocks.
 * Memory: ~77 KB for the previous clip frame + ~30 KB LZW table + 8 KB PNG block (put them in PSRAM on the S3).
 * MIT License - see LICENSE.
 */
#include "bk.h"
#include <string.h>

/* ------------------------------------------------------------------ shared helpers */

static uint32_t crc_tab[256];
static int crc_ready;
static uint32_t crc32_update(uint32_t c, const uint8_t *p, int n) {
  if (!crc_ready) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t k = i;
      for (int j = 0; j < 8; j++) k = (k & 1) ? 0xEDB88320u ^ (k >> 1) : k >> 1;
      crc_tab[i] = k;
    }
    crc_ready = 1;
  }
  c = ~c;
  while (n--) c = crc_tab[(c ^ *p++) & 0xFF] ^ (c >> 8);
  return ~c;
}

/* ------------------------------------------------------------------ PNG (indexed colour, real deflate) */
/* The pixel stream (each row: filter byte 0, then the pixels, scaled up) is compressed with fixed-Huffman deflate.
   Pixel art is runs and repeated rows, so two match candidates do almost all the work: the byte before
   (distance 1) and the same byte one row up (distance = row length). No window or hash table is needed,
   because any earlier byte can be computed again from the screen. */

typedef struct {
  bk_write_fn write; void *ctx; int err;
  int scale, w, h, rowlen;            /* output size; rowlen includes the filter byte */
  const uint8_t *scr;
  uint8_t blk[8192]; int blen;        /* compressed bytes waiting for their IDAT chunk */
  uint32_t bits; int nbits;
  uint32_t adl_a, adl_b;
} png_t;
static BK_BIG_BSS png_t P;

static void out_raw(bk_write_fn w, void *ctx, int *err, const void *d, int n) { if (!*err && w(ctx, d, n) != 0) *err = 1; }
static void be32(uint8_t *p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }
static void png_chunk(const char *type, const uint8_t *data, int n) {
  uint8_t hd[8]; be32(hd, (uint32_t)n); memcpy(hd + 4, type, 4);
  uint32_t c = crc32_update(0, (const uint8_t *)type, 4); c = crc32_update(c, data, n);
  uint8_t ft[4]; be32(ft, c);
  out_raw(P.write, P.ctx, &P.err, hd, 8);
  if (n) out_raw(P.write, P.ctx, &P.err, data, n);
  out_raw(P.write, P.ctx, &P.err, ft, 4);
}
static void png_byte(uint8_t b) { P.blk[P.blen++] = b; if (P.blen == (int)sizeof P.blk) { png_chunk("IDAT", P.blk, P.blen); P.blen = 0; } }
static void put_bits(uint32_t v, int n) {          /* LSB first, as deflate wants */
  P.bits |= v << P.nbits; P.nbits += n;
  while (P.nbits >= 8) { png_byte((uint8_t)P.bits); P.bits >>= 8; P.nbits -= 8; }
}
static void put_huff(uint32_t code, int n) {       /* Huffman codes go MSB first: reverse them */
  uint32_t r = 0; for (int i = 0; i < n; i++) r |= ((code >> i) & 1) << (n - 1 - i);
  put_bits(r, n);
}
static void lit(int v) {
  if (v < 144) put_huff(0x30 + v, 8); else if (v < 256) put_huff(0x190 + (v - 144), 9);
  else if (v < 280) put_huff(v - 256, 7); else put_huff(0xC0 + (v - 280), 8);
}
static const uint16_t len_base[29] = { 3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258 };
static const uint8_t len_extra[29] = { 0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0 };
static const uint16_t dist_base[30] = { 1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577 };
static const uint8_t dist_extra[30] = { 0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13 };
static void match(int len, int dist) {
  int i = 28; while (len_base[i] > len) i--;
  lit(257 + i); if (len_extra[i]) put_bits(len - len_base[i], len_extra[i]);
  int d = 29; while (dist_base[d] > dist) d--;
  put_huff(d, 5); if (dist_extra[d]) put_bits(dist - dist_base[d], dist_extra[d]);
}
static inline int px_at(int p) {                   /* byte p of the uncompressed stream */
  int row = p / P.rowlen, col = p - row * P.rowlen;
  if (col == 0) return 0;
  return P.scr[(row / P.scale) * BK_W + (col - 1) / P.scale];
}

int bk_shot_png(int scale, bk_write_fn write, void *ctx) {
  if (scale < 1) scale = 1; if (scale > 4) scale = 4;
  memset(&P, 0, sizeof P);
  P.write = write; P.ctx = ctx; P.scale = scale; P.w = BK_W * scale; P.h = BK_H * scale; P.rowlen = P.w + 1;
  P.scr = BK->screen; P.adl_a = 1;
  static const uint8_t sig[8] = { 137, 80, 78, 71, 13, 10, 26, 10 };
  out_raw(write, ctx, &P.err, sig, 8);
  uint8_t ih[13]; be32(ih, P.w); be32(ih + 4, P.h); ih[8] = 8; ih[9] = 3; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  png_chunk("IHDR", ih, 13);
  uint8_t pal[768]; bk_graded_palette(pal);
  png_chunk("PLTE", pal, 768);
  static const uint8_t soft[] = "Software\0BitKit";
  png_chunk("tEXt", soft, sizeof soft - 1);
  png_byte(0x78); png_byte(0x01);                   /* zlib header: deflate, 32K window, fastest */
  put_bits(1, 1); put_bits(1, 2);                    /* one final block, fixed Huffman */
  const int total = P.rowlen * P.h;
  uint32_t a = 1, b = 0;
  for (int p = 0; p < total && !P.err;) {
    const int v = px_at(p);
    int best = 0, bd = 0;
    const int lim = total - p < 258 ? total - p : 258;
    if (p >= 1) { int n = 0; while (n < lim && px_at(p + n) == px_at(p + n - 1)) n++; if (n > best) { best = n; bd = 1; } }
    if (p >= P.rowlen && best < lim) { int n = 0; while (n < lim && px_at(p + n) == px_at(p + n - P.rowlen)) n++; if (n > best) { best = n; bd = P.rowlen; } }
    if (best >= 3) {
      match(best, bd);
      for (int k = 0; k < best; k++) { a = (a + (uint32_t)px_at(p + k)) % 65521u; b = (b + a) % 65521u; }
      p += best;
    } else {
      lit(v); a = (a + (uint32_t)v) % 65521u; b = (b + a) % 65521u; p++;
    }
  }
  lit(256);                                         /* end of block */
  if (P.nbits) put_bits(0, 8 - P.nbits);
  const uint32_t adl = (b << 16) | a;
  png_byte(adl >> 24); png_byte(adl >> 16); png_byte(adl >> 8); png_byte(adl);
  if (P.blen) png_chunk("IDAT", P.blk, P.blen);
  png_chunk("IEND", NULL, 0);
  return P.err ? -1 : 0;
}

/* ------------------------------------------------------------------ GIF clips */
/* Every frame is compared with the one before; only the rectangle that changed is written. Frames where
   nothing changed just make the previous one stay longer (a 1x1 frame carries the time). When the palette
   changes (fades, raster colours) the whole frame is written with its own colour table. */

#define GIF_HSIZE 5003
typedef struct {
  bk_write_fn write; void *ctx; int err, on;
  uint8_t prev[BK_W * BK_H];
  uint8_t gpal[768], lpal[768];           /* global table, and the palette of the last frame */
  int frames;                             /* frames written (not counting held ones) */
  uint32_t t60;                           /* time so far in 1/60 s */
  uint32_t cs_done;                       /* time written so far in 1/100 s */
  uint32_t hold60;                        /* time the last frame has been held without a change */
  /* LZW */
  int32_t htab[GIF_HSIZE]; uint16_t ctab[GIF_HSIZE];
  int nbits, maxcode, free_ent, clear_code, eof_code;
  uint32_t acc; int accn;
  uint8_t blk[256]; int blen;
} gif_t;
static BK_BIG_BSS gif_t G;

static void gw(const void *d, int n) { out_raw(G.write, G.ctx, &G.err, d, n); }
static void gb(int v) { uint8_t c = (uint8_t)v; gw(&c, 1); }
static void gw16(int v) { gb(v & 0xFF); gb((v >> 8) & 0xFF); }

static void blk_byte(uint8_t c) { G.blk[1 + G.blen++] = c; if (G.blen == 255) { G.blk[0] = 255; gw(G.blk, 256); G.blen = 0; } }
static void blk_flush(void) { if (G.blen) { G.blk[0] = (uint8_t)G.blen; gw(G.blk, G.blen + 1); G.blen = 0; } }
static void code_out(int code) {
  G.acc |= (uint32_t)code << G.accn; G.accn += G.nbits;
  while (G.accn >= 8) { blk_byte((uint8_t)G.acc); G.acc >>= 8; G.accn -= 8; }
}
static void lzw_clear(void) {
  for (int i = 0; i < GIF_HSIZE; i++) G.htab[i] = -1;
  G.free_ent = G.clear_code + 2; G.nbits = 9; G.maxcode = 511;
}
/* pixels of the rectangle x,y,w,h of screen s, row by row */
static void lzw_rect(const uint8_t *s, int x, int y, int w, int h) {
  gb(8);                                  /* minimum code size */
  G.clear_code = 256; G.eof_code = 257; G.acc = 0; G.accn = 0; G.blen = 0;
  lzw_clear(); code_out(G.clear_code);
  int ent = s[y * BK_W + x], first = 1;
  for (int r = 0; r < h; r++) {
    const uint8_t *row = s + (y + r) * BK_W + x;
    for (int c = 0; c < w; c++) {
      if (first) { first = 0; continue; }
      const int k = row[c];
      const int32_t fcode = ((int32_t)k << 12) + ent;
      int i = (k << 4) ^ ent; if (i >= GIF_HSIZE) i %= GIF_HSIZE;
      int found = 0;
      if (G.htab[i] == fcode) found = 1;
      else if (G.htab[i] >= 0) {
        const int disp = i == 0 ? 1 : GIF_HSIZE - i;
        do { i -= disp; if (i < 0) i += GIF_HSIZE; if (G.htab[i] == fcode) { found = 1; break; } } while (G.htab[i] >= 0);
      }
      if (found) { ent = G.ctab[i]; continue; }
      code_out(ent);
      ent = k;
      if (G.free_ent < 4096) {
        if (G.free_ent > G.maxcode) { G.nbits++; G.maxcode = G.nbits == 12 ? 4096 : (1 << G.nbits) - 1; }
        G.ctab[i] = (uint16_t)G.free_ent++; G.htab[i] = fcode;
      } else { code_out(G.clear_code); lzw_clear(); }
    }
  }
  code_out(ent);
  if (G.free_ent > G.maxcode && G.nbits < 12) G.nbits++;
  code_out(G.eof_code);
  if (G.accn > 0) { blk_byte((uint8_t)G.acc); G.acc = 0; G.accn = 0; }
  blk_flush(); gb(0);                     /* block terminator */
}
static void gce(int delay_cs) {
  gb(0x21); gb(0xF9); gb(4); gb(0x04);   /* disposal 1: leave the frame in place, no transparency */
  gw16(delay_cs); gb(0); gb(0);
}
static int delay_until(uint32_t t60) {    /* centiseconds from what is written so far to time t60 */
  const uint32_t cs = (t60 * 100 + 30) / 60;
  int d = (int)(cs - G.cs_done); if (d < 1) d = 1;
  return d;
}
static void write_hold(void) {            /* the last frame stays for hold60 more: a 1x1 frame of an unchanged pixel */
  if (!G.hold60) return;
  const int d = delay_until(G.t60); G.cs_done += d;
  gce(d);
  gb(0x2C); gw16(0); gw16(0); gw16(1); gw16(1); gb(0);
  lzw_rect(G.prev, 0, 0, 1, 1);
  G.hold60 = 0;
}

int bk_clip_begin(bk_write_fn write, void *ctx) {
  memset(&G, 0, sizeof G);
  G.write = write; G.ctx = ctx; G.on = 1;
  bk_graded_palette(G.gpal); memcpy(G.lpal, G.gpal, 768);
  gw("GIF89a", 6);
  gw16(BK_W); gw16(BK_H); gb(0xF7); gb(0); gb(0);       /* global colour table, 256 entries */
  gw(G.gpal, 768);
  static const uint8_t loop[19] = { 0x21, 0xFF, 11, 'N','E','T','S','C','A','P','E','2','.','0', 3, 1, 0, 0, 0 };
  gw(loop, 19);
  return G.err ? -1 : 0;
}

/* Add the screen as the next frame. frames60 = how long this frame stays, in 60ths of a second
   (the host captures every 2nd frame at 60 fps and passes 2). */
int bk_clip_frame(int frames60) {
  if (!G.on) return -1;
  if (frames60 < 1) frames60 = 1;
  uint8_t pal[768]; bk_graded_palette(pal);
  const uint8_t *s = BK->screen;
  const int pal_changed = memcmp(pal, G.lpal, 768) != 0;
  int x0 = 0, y0 = 0, x1 = BK_W - 1, y1 = BK_H - 1;
  if (G.frames && !pal_changed) {
    x0 = BK_W; y0 = BK_H; x1 = -1; y1 = -1;
    for (int y = 0; y < BK_H; y++) {
      const uint8_t *a = s + y * BK_W, *b = G.prev + y * BK_W;
      if (!memcmp(a, b, BK_W)) continue;
      int l = 0; while (a[l] == b[l]) l++;
      int r = BK_W - 1; while (a[r] == b[r]) r--;
      if (l < x0) x0 = l; if (r > x1) x1 = r; if (y < y0) y0 = y; y1 = y;
    }
    if (x1 < 0) { G.hold60 += frames60; G.t60 += frames60; return G.err ? -1 : 0; }   /* nothing changed */
  }
  write_hold();
  G.t60 += frames60;
  const int d = delay_until(G.t60); G.cs_done += d;
  gce(d);
  const int w = x1 - x0 + 1, h = y1 - y0 + 1;
  const int local = memcmp(pal, G.gpal, 768) != 0;
  gb(0x2C); gw16(x0); gw16(y0); gw16(w); gw16(h); gb(local ? 0x87 : 0);
  if (local) gw(pal, 768);
  lzw_rect(s, x0, y0, w, h);
  for (int y = y0; y <= y1; y++) memcpy(G.prev + y * BK_W + x0, s + y * BK_W + x0, w);
  memcpy(G.lpal, pal, 768);
  G.frames++;
  return G.err ? -1 : 0;
}

int bk_clip_end(void) {
  if (!G.on) return -1;
  write_hold();
  gb(0x3B);
  G.on = 0;
  return G.err ? -1 : G.frames;
}
int bk_clip_recording(void) { return G.on; }
int bk_clip_seconds(void) { return (int)(G.t60 / 60); }
