/* BitKit runtime: machine state, graphics, input, rng, audio. MIT License. */
#include "bk.h"
#include "bk_font.h"
#include <string.h>
#include <math.h>
#include <stdlib.h>

bk_machine *BK = 0;
static bk_floor_cam fcam;   /* camera of the last floor() call, used by project() */

static const char *BASE_PAL[32] = {
  "000000","1b1b2f","3a2e5c","5e3a8c","8e4fb0","c06bd0",
  "2d1e1e","5a2f2a","8f3f2e","c75b39","f08a4b","ffc07a",
  "fff3d6","ffffff",
  "1d3b2a","2f6b3a","4fa04a","8ad35a","d5f07a",
  "0f2a4a","1f4f8a","3a86d0","6ec3f0","bff0ff",
  "6b1d2e","b02a3a","e8504a","ffd23f","7a7a8a","a8a8b8","4a4a5a","2a2a36"
};

static int hexv(char c) { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; }

void bk_default_palette(uint8_t *pal) {
  int i = 0;
  for (; i < 32; i++)
    for (int k = 0; k < 3; k++)
      pal[i * 3 + k] = (uint8_t)(hexv(BASE_PAL[i][k * 2]) * 16 + hexv(BASE_PAL[i][k * 2 + 1]));
  /* 32..247: 6x6x6 colour cube */
  for (int r = 0; r < 6; r++)
    for (int g = 0; g < 6; g++)
      for (int b = 0; b < 6; b++, i++) {
        pal[i * 3 + 0] = (uint8_t)(r * 51);
        pal[i * 3 + 1] = (uint8_t)(g * 51);
        pal[i * 3 + 2] = (uint8_t)(b * 51);
      }
  /* 248..255: greys */
  for (int g = 0; i < 256; i++, g++) {
    uint8_t v = (uint8_t)(16 + g * 32);
    pal[i * 3] = pal[i * 3 + 1] = pal[i * 3 + 2] = v;
  }
}

void bk_reset_draw_state(void) {
  BK->cam_x = BK->cam_y = 0;
  BK->clip_x0 = BK->clip_y0 = 0;
  BK->clip_x1 = BK_W; BK->clip_y1 = BK_H;
  for (int i = 0; i < 256; i++) { BK->draw_pal[i] = (uint8_t)i; BK->transparent[i] = 0; }
  BK->transparent[0] = 1;
  fcam.valid = 0;
  bk_depth(-1);
}

void bk_machine_init(bk_machine *m) {
  memset(m, 0, sizeof(*m));
  BK = m;
  bk_default_palette(m->palette);
  bk_reset_draw_state();
  m->rng = 0x9E3779B97F4A7C15ull;
  m->master_vol = 0.5f;
  m->save.len = -1;
  m->players = 1;
  m->me = 0;
  bk_sprfx_reset();
}

/* ---------------- graphics ---------------- */

static inline void px(int x, int y, int c) {
  x -= BK->cam_x; y -= BK->cam_y;
  if (x < BK->clip_x0 || y < BK->clip_y0 || x >= BK->clip_x1 || y >= BK->clip_y1) return;
  BK->screen[y * BK_W + x] = BK->draw_pal[c & 255];
}

void bk_cls(int c) { memset(BK->screen, c & 255, sizeof(BK->screen)); }
void bk_pset(int x, int y, int c) { px(x, y, c); }

int bk_pget(int x, int y) {
  x -= BK->cam_x; y -= BK->cam_y;
  if (x < 0 || y < 0 || x >= BK_W || y >= BK_H) return 0;
  return BK->screen[y * BK_W + x];
}

void bk_line(int x0, int y0, int x1, int y1, int c) {
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  int dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  for (int guard = 0; guard < 4096; guard++) {
    px(x0, y0, c);
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

static void hline(int x0, int x1, int y, int c) {
  if (x0 > x1) { int t = x0; x0 = x1; x1 = t; }
  int sy = y - BK->cam_y;
  if (sy < BK->clip_y0 || sy >= BK->clip_y1) return;
  int a = x0 - BK->cam_x, b = x1 - BK->cam_x;
  if (a < BK->clip_x0) a = BK->clip_x0;
  if (b >= BK->clip_x1) b = BK->clip_x1 - 1;
  if (a > b) return;
  memset(&BK->screen[sy * BK_W + a], BK->draw_pal[c & 255], (size_t)(b - a + 1));
}

void bk_rectfill(int x, int y, int w, int h, int c) {
  for (int j = 0; j < h; j++) hline(x, x + w - 1, y + j, c);
}

/* ---------------- screen shaders ---------------- */
/* Colour shaders blend every colour on screen toward a target and snap the result to the nearest palette colour.
   The answer for each colour is worked out the first time it shows up and kept in a small cache (cleared when the
   palette changes), so after the first frame a colour shader costs one table read per pixel. */

typedef struct { uint32_t rgb; int32_t m; uint8_t lut[256], done[256]; } blend_lut;
#define BLEND_N 40
static blend_lut blends[BLEND_N];
static int blend_used, blend_next;
static uint8_t pal_seen[256 * 3];

static int nearest(int r, int g, int b) {
  int best = 0; long bd = 0x7fffffffL;
  for (int j = 0; j < 256; j++) {
    const uint8_t *q = &BK->palette[j * 3];
    const long dr = q[0] - r, dg = q[1] - g, db = q[2] - b, d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

/* the blend table for "m/256 of the way toward colour rgb" (24-bit) */
static blend_lut *blend_rgb(uint32_t rgb, int m) {
  if (memcmp(pal_seen, BK->palette, sizeof(pal_seen))) { memcpy(pal_seen, BK->palette, sizeof(pal_seen)); blend_used = 0; blend_next = 0; }
  rgb &= 0xFFFFFF;
  for (int i = 0; i < blend_used; i++) if (blends[i].rgb == rgb && blends[i].m == m) return &blends[i];
  blend_lut *b = &blends[blend_next];
  blend_next = (blend_next + 1) % BLEND_N;
  if (blend_used < BLEND_N) blend_used++;
  b->rgb = rgb; b->m = m;
  memset(b->done, 0, sizeof(b->done));   /* each colour is worked out the first time it is used (blend_px) */
  return b;
}
static inline uint32_t pal_rgb(int c) { const uint8_t *p = &BK->palette[(c & 255) * 3]; return ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2]; }

static inline uint8_t blend_px(blend_lut *b, int col, int m) {
  if (!b->done[col]) {
    const uint32_t t = b->rgb;
    const int tr = (int)(t >> 16) & 255, tg = (int)(t >> 8) & 255, tb = (int)t & 255;
    const uint8_t *p = &BK->palette[col * 3];
    b->lut[col] = (uint8_t)nearest((p[0] * (256 - m) + tr * m) >> 8, (p[1] * (256 - m) + tg * m) >> 8, (p[2] * (256 - m) + tb * m) >> 8);
    b->done[col] = 1;
  }
  return b->lut[col];
}

static void blend_rows_rgb(uint32_t rgb, int m, int y0, int y1) {
  if (m <= 0) return;
  if (m > 256) m = 256;
  if (y0 < BK->clip_y0) y0 = BK->clip_y0;
  if (y1 > BK->clip_y1) y1 = BK->clip_y1;
  if (y0 >= y1) return;
  blend_lut *b = blend_rgb(rgb, m);
  for (int y = y0; y < y1; y++) {
    uint8_t *row = &BK->screen[y * BK_W];
    for (int x = BK->clip_x0; x < BK->clip_x1; x++) row[x] = blend_px(b, row[x], m);
  }
}
static void blend_rows(int c, int m, int y0, int y1) { blend_rows_rgb(pal_rgb(c), m, y0, y1); }

static int amount(float k) { return !(k > 0) ? 0 : k >= 1 ? 256 : (int)(k * 256); }

/* Darken what is on the screen (inside the clip rectangle): every colour becomes the palette colour nearest to
   itself made k darker (0 = no change, 1 = black). A real dim for menus and night scenes, with no dither pattern. */
void bk_shade(float k) {
  if (!(k > 0)) return;
  if (k > 1) k = 1;
  blend_rows_rgb(0, 256 - (int)((1 - k) * 256), BK->clip_y0, BK->clip_y1);   /* toward real black, whatever colour 0 is */
}

void bk_tint(int c, float k) { blend_rows(c, amount(k), BK->clip_y0, BK->clip_y1); }

/* raster effects (raster() in Lua): one row of the screen, inside the clip rectangle */
void bk_row_shift(int y, int dx) {
  if (y < BK->clip_y0 || y >= BK->clip_y1 || !dx) return;
  const int x0 = BK->clip_x0, w = BK->clip_x1 - BK->clip_x0;
  if (w <= 0) return;
  uint8_t line[BK_W], *row = &BK->screen[y * BK_W];
  memcpy(line, row + x0, (size_t)w);
  for (int i = 0; i < w; i++) { int j = i - dx; j = j < 0 ? 0 : j >= w ? w - 1 : j; row[x0 + i] = line[j]; }
}
void bk_row_tint(int y, int c, float k) { blend_rows(c, amount(k), y, y + 1); }

/* Fog / gradient tint between rows y0 and y1: amount a0 at y0 sliding to a1 at y1, in 32 bands so it stays cheap.
   Rows outside y0..y1 are left alone. */
void bk_fog(int c, int y0, int y1, float a0, float a1) {
  if (y1 < y0) { int t = y0; y0 = y1; y1 = t; float u = a0; a0 = a1; a1 = u; }
  const int span = y1 - y0 > 0 ? y1 - y0 : 1;
  int y = y0 > BK->clip_y0 ? y0 : BK->clip_y0, hi = y1 + 1 < BK->clip_y1 ? y1 + 1 : BK->clip_y1;
  while (y < hi) {
    const int m = amount(a0 + (a1 - a0) * (float)(y - y0) / (float)span) & ~7;   /* 32 steps */
    int e = y + 1;                                                                 /* run of rows on the same step */
    while (e < hi && (amount(a0 + (a1 - a0) * (float)(e - y0) / (float)span) & ~7) == m) e++;
    blend_rows(c, m, y, e);
    y = e;
  }
}

/* Ordered dither: a 4x4 Bayer pattern decides which pixels turn into colour c, so k = 0.5 is a checkerboard.
   The classic retro fade, wipe and fog. Pattern is fixed to the screen, so it doesn't crawl with the camera. */
static const uint8_t BAYER[16] = { 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };
void bk_dither(int c, float k) {
  int n = !(k > 0) ? 0 : k >= 1 ? 16 : (int)(k * 16 + 0.5f);
  if (!n) return;
  uint8_t col = BK->draw_pal[c & 255];
  for (int y = BK->clip_y0; y < BK->clip_y1; y++) {
    uint8_t *row = &BK->screen[y * BK_W];
    const uint8_t *b = &BAYER[(y & 3) * 4];
    for (int x = BK->clip_x0; x < BK->clip_x1; x++) if (b[x & 3] < n) row[x] = col;
  }
}

void bk_remap(const uint8_t *lut) {
  for (int y = BK->clip_y0; y < BK->clip_y1; y++) {
    uint8_t *row = &BK->screen[y * BK_W];
    for (int x = BK->clip_x0; x < BK->clip_x1; x++) row[x] = lut[row[x]];
  }
}

BK_BIG_BSS static uint8_t scratch[BK_W * BK_H];   /* copy of the screen for shaders that move pixels */

/* Sine wave: each row slides sideways by amp * sin(2pi * (y / len + phase)) (or each column up and down).
   Edges repeat the last pixel so nothing tears open. Heat haze, underwater, dream sequences. */
void bk_wave(float amp, float len, float phase, int vertical) {
  if (len < 1) len = 1;
  const int x0 = BK->clip_x0, x1 = BK->clip_x1, y0 = BK->clip_y0, y1 = BK->clip_y1, w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  if (!vertical) {
    uint8_t line[BK_W];
    for (int y = y0; y < y1; y++) {
      int sh = (int)lroundf(amp * sinf(6.2831853f * ((float)y / len + phase)));
      if (!sh) continue;
      uint8_t *row = &BK->screen[y * BK_W];
      memcpy(line, row + x0, (size_t)w);
      for (int i = 0; i < w; i++) { int j = i - sh; j = j < 0 ? 0 : j >= w ? w - 1 : j; row[x0 + i] = line[j]; }
    }
  } else {
    for (int y = y0; y < y1; y++) memcpy(&scratch[y * BK_W + x0], &BK->screen[y * BK_W + x0], (size_t)w);
    for (int x = x0; x < x1; x++) {
      int sh = (int)lroundf(amp * sinf(6.2831853f * ((float)x / len + phase)));
      if (!sh) continue;
      for (int i = 0; i < h; i++) { int j = i - sh; j = j < 0 ? 0 : j >= h ? h - 1 : j; BK->screen[(y0 + i) * BK_W + x] = scratch[(y0 + j) * BK_W + x]; }
    }
  }
}

/* Shockwave ring: pixels within width of radius r are pushed outward (amp > 0) or pulled in, most at the ring's
   middle. Costs only the ring's box. */
void bk_ripple(int x, int y, float r, float amp, float width) {
  if (width < 1) width = 1;
  const int cx = x - BK->cam_x, cy = y - BK->cam_y;
  const float outer = r + width;
  int bx0 = (int)floorf(cx - outer), bx1 = (int)ceilf(cx + outer) + 1, by0 = (int)floorf(cy - outer), by1 = (int)ceilf(cy + outer) + 1;
  if (bx0 < BK->clip_x0) bx0 = BK->clip_x0;
  if (by0 < BK->clip_y0) by0 = BK->clip_y0;
  if (bx1 > BK->clip_x1) bx1 = BK->clip_x1;
  if (by1 > BK->clip_y1) by1 = BK->clip_y1;
  if (bx0 >= bx1 || by0 >= by1) return;
  for (int yy = by0; yy < by1; yy++) memcpy(&scratch[yy * BK_W + bx0], &BK->screen[yy * BK_W + bx0], (size_t)(bx1 - bx0));
  const float inner = r - width > 0 ? r - width : 0, in2 = inner * inner, out2 = outer * outer;
  for (int yy = by0; yy < by1; yy++) {
    const float dy = yy + 0.5f - cy;
    for (int xx = bx0; xx < bx1; xx++) {
      const float dx = xx + 0.5f - cx, d2 = dx * dx + dy * dy;
      if (d2 < in2 || d2 > out2 || d2 < 0.25f) continue;
      const float d = sqrtf(d2), t = (d - r) / width;           /* -1..1 across the ring */
      const float push = amp * cosf(t * 1.5707963f);            /* 0 at the edges, amp in the middle */
      int sx = (int)lroundf(xx + 0.5f - dx / d * push - 0.5f), sy = (int)lroundf(yy + 0.5f - dy / d * push - 0.5f);
      sx = sx < BK->clip_x0 ? BK->clip_x0 : sx >= BK->clip_x1 ? BK->clip_x1 - 1 : sx;
      sy = sy < BK->clip_y0 ? BK->clip_y0 : sy >= BK->clip_y1 ? BK->clip_y1 - 1 : sy;
      BK->screen[yy * BK_W + xx] = (sx >= bx0 && sx < bx1 && sy >= by0 && sy < by1) ? scratch[sy * BK_W + sx] : BK->screen[sy * BK_W + sx];
    }
  }
}

/* Mosaic: size x size blocks take the colour of their middle pixel. Blocks line up with the clip corner. */
void bk_pixelate(int size) {
  if (size < 2) return;
  if (size > 64) size = 64;
  for (int by = BK->clip_y0; by < BK->clip_y1; by += size) {
    int ey = by + size > BK->clip_y1 ? BK->clip_y1 : by + size, my = (by + ey) / 2;
    for (int bx = BK->clip_x0; bx < BK->clip_x1; bx += size) {
      int ex = bx + size > BK->clip_x1 ? BK->clip_x1 : bx + size;
      uint8_t c = BK->screen[my * BK_W + (bx + ex) / 2];
      for (int yy = by; yy < ey; yy++) memset(&BK->screen[yy * BK_W + bx], c, (size_t)(ex - bx));
    }
  }
}

static inline uint32_t hash32(uint32_t x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }

/* Glitch: bands of rows torn sideways and a few rows slipped to a neighbouring colour. Uses its own hash of seed,
   never the game's rnd(), so linked games stay in step. Pass the frame (t()) as seed for a fresh pattern each frame. */
void bk_glitch(float k, uint32_t seed) {
  if (!(k > 0)) return;
  if (k > 1) k = 1;
  const int x0 = BK->clip_x0, w = BK->clip_x1 - BK->clip_x0;
  if (w <= 0) return;
  uint8_t line[BK_W];
  int y = BK->clip_y0;
  uint32_t h = hash32(seed * 2654435761u + 1);
  while (y < BK->clip_y1) {
    h = hash32(h + (uint32_t)y);
    int band = 1 + (int)(h % 12);
    int torn = (h >> 8) % 1000 < (uint32_t)(k * 260);
    int e = y + band > BK->clip_y1 ? BK->clip_y1 : y + band;
    if (torn) {
      int sh = (int)((h >> 16) % (uint32_t)(1 + (int)(k * 48))) * (((h >> 30) & 1) ? 1 : -1);
      int slip = ((h >> 4) & 7) == 0 ? 1 + (int)((h >> 12) & 3) : 0;   /* now and then the colours slip too */
      for (int yy = y; yy < e; yy++) {
        uint8_t *row = &BK->screen[yy * BK_W];
        memcpy(line, row + x0, (size_t)w);
        for (int i = 0; i < w; i++) { int j = i - sh; j = ((j % w) + w) % w; row[x0 + i] = (uint8_t)(line[j] + slip); }
      }
    }
    y = e;
  }
}

void bk_rect(int x, int y, int w, int h, int c) {
  if (w <= 0 || h <= 0) return;
  hline(x, x + w - 1, y, c);
  hline(x, x + w - 1, y + h - 1, c);
  for (int j = 1; j < h - 1; j++) { px(x, y + j, c); px(x + w - 1, y + j, c); }
}

void bk_circ(int cx, int cy, int r, int c) {
  int x = r, y = 0, err = 1 - r;
  while (x >= y) {
    px(cx + x, cy + y, c); px(cx - x, cy + y, c); px(cx + x, cy - y, c); px(cx - x, cy - y, c);
    px(cx + y, cy + x, c); px(cx - y, cy + x, c); px(cx + y, cy - x, c); px(cx - y, cy - x, c);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
}

void bk_circfill(int cx, int cy, int r, int c) {
  int x = r, y = 0, err = 1 - r;
  while (x >= y) {
    hline(cx - x, cx + x, cy + y, c); hline(cx - x, cx + x, cy - y, c);
    hline(cx - y, cx + y, cy + x, c); hline(cx - y, cx + y, cy - x, c);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
}

/* font(style, [outline]): 0 classic, 1 bold, 2 slant, 3 slant bold; outline colour drawn around each letter (-1 none).
   Every style is made from the one 8x8 font, so the widths stay 8 pixels a letter (bold and slant spill a pixel right). */
static int font_style = 0, font_outline = -1;
void bk_font(int style, int outline) {
  font_style = style < 0 || style > 3 ? 0 : style;
  font_outline = outline < 0 || outline > 255 ? -1 : outline;
}
static void text_px(int x, int y, int c, int scale) {
  if (scale == 1) px(x, y, c); else bk_rectfill(x, y, scale, scale, c);
}
int bk_text(const char *s, int x, int y, int c, int scale) {
  if (scale < 1) scale = 1;
  int x0 = x, maxw = 0;
  for (; *s; s++) {
    unsigned ch = (unsigned char)*s;
    if (ch == '\n') { if (x - x0 > maxw) maxw = x - x0; x = x0; y += 8 * scale; continue; }
    if (ch > 127) ch = '?';
    const uint8_t *g = bk_font8x8[ch];
    uint16_t r[10] = {0};               /* rows -1..8, bit k = pixel k-1 (room for the outline and the spill) */
    for (int j = 0; j < 8; j++) {
      uint16_t v = (uint16_t)(g[j] << 1);
      if (font_style & 2) v = (uint16_t)(v << ((7 - j) / 3));
      if (font_style & 1) v |= (uint16_t)(v << 1);
      r[j + 1] = v;
    }
    if (font_outline >= 0) {
      for (int j = 0; j < 10; j++) {
        uint16_t d = 0;
        for (int k = j - 1; k <= j + 1; k++) if (k >= 0 && k < 10) d |= r[k] | (uint16_t)(r[k] << 1) | (uint16_t)(r[k] >> 1);
        d &= (uint16_t)~r[j];
        for (int i = 0; i < 12; i++) if (d & (1 << i)) text_px(x + (i - 1) * scale, y + (j - 1) * scale, font_outline, scale);
      }
    }
    for (int j = 1; j < 9; j++)
      for (int i = 1; i < 12; i++)
        if (r[j] & (1 << i)) text_px(x + (i - 1) * scale, y + (j - 1) * scale, c, scale);
    x += 8 * scale;
  }
  if (x - x0 > maxw) maxw = x - x0;
  return maxw;
}

static void spr_fx(int n, float x, float y, int w, int h, float sc, int flipx, int flipy, int use_depth);

static void tile_draw(int n, int x, int y, int flipx, int flipy, int scale) {
  if (n < 0 || n >= BK_TILES) return;
  const uint8_t *t = &BK->tiles[n * BK_TILE_BYTES];
  for (int j = 0; j < 8; j++)
    for (int i = 0; i < 8; i++) {
      uint8_t c = t[(flipy ? 7 - j : j) * 8 + (flipx ? 7 - i : i)];
      if (BK->transparent[c]) continue;
      if (scale == 1) px(x + i, y + j, c);
      else bk_rectfill(x + i * scale, y + j * scale, scale, scale, c);
    }
}

/* Sprite n is the top-left tile; w,h in tiles, taken from the 16-tile-wide sheet. */
void bk_spr(int n, int x, int y, int w, int h, int flipx, int flipy, int scale) {
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  if (scale < 1) scale = 1;
  if (bk_sprfx.on) { spr_fx(n, (float)x, (float)y, w, h, (float)scale, flipx, flipy, 0); return; }
  int s = 8 * scale;
  for (int ty = 0; ty < h; ty++)
    for (int tx = 0; tx < w; tx++) {
      int dx = flipx ? (w - 1 - tx) : tx;
      int dy = flipy ? (h - 1 - ty) : ty;
      tile_draw(n + ty * 16 + tx, x + dx * s, y + dy * s, flipx, flipy, scale);
    }
}

void bk_map(int cx, int cy, int cw, int ch, int sx, int sy) {
  for (int j = 0; j < ch; j++) {
    int my = cy + j;
    if (my < 0 || my >= BK_MAP_H) continue;
    for (int i = 0; i < cw; i++) {
      int mx = cx + i;
      if (mx < 0 || mx >= BK_MAP_W) continue;
      int t = BK->map[my * BK_MAP_W + mx];
      if (t) tile_draw(t, sx + i * 8, sy + j * 8, 0, 0, 1);
    }
  }
}

/* ---------------- 2.5D floor ---------------- */

#define FLOOR_FAR 4096.f   /* world pixels: anything further is drawn in the outside colour */

/* For each screen row below the horizon the floor distance is z = height * focal / (row - horizon).
   The row is a straight line across the map, so it is walked with 16.16 fixed-point steps:
   two adds, a map read and a tile read per pixel. step 2 or 4 draws every 2nd/4th column and
   repeats it (cheaper, chunkier). */
void bk_floor(float x, float y, float angle, float height, int horizon, float focal, int outside, int step) {
  if (step < 1) step = 1;
  if (focal < 1) focal = 1;
  if (height < 0.01f) height = 0.01f;
  float c = cosf(angle), s = sinf(angle);
  float cx = (BK->clip_x0 + BK->clip_x1) * 0.5f;
  fcam.x = x; fcam.y = y; fcam.angle = angle; fcam.height = height; fcam.focal = focal;
  fcam.horizon = horizon; fcam.c = c; fcam.s = s; fcam.valid = 1; fcam.hills = 0;
  fcam.cx = cx;
  const int mw = BK_MAP_W * 8, mh = BK_MAP_H * 8;
  uint8_t out = BK->draw_pal[outside & 255];
  int y0 = horizon + 1 > BK->clip_y0 ? horizon + 1 : BK->clip_y0;
  for (int sy = y0; sy < BK->clip_y1; sy++) {
    uint8_t *row = &BK->screen[sy * BK_W];
    float z = height * focal / (float)(sy - horizon);
    if (z > FLOOR_FAR) {
      if (outside >= 0) memset(row + BK->clip_x0, out, (size_t)(BK->clip_x1 - BK->clip_x0));
      continue;
    }
    float k = z / focal;                       /* world pixels per screen pixel on this row */
    float off = (BK->clip_x0 + 0.5f - cx) * k;
    float wx = x + c * z - s * off, wy = y + s * z + c * off;
    int32_t fx = (int32_t)(wx * 65536.f), fy = (int32_t)(wy * 65536.f);
    int32_t dx = (int32_t)(-s * k * 65536.f) * step, dy = (int32_t)(c * k * 65536.f) * step;
    for (int sx = BK->clip_x0; sx < BK->clip_x1; sx += step, fx += dx, fy += dy) {
      int px = fx >> 16, py = fy >> 16;
      int col = -1;
      if ((unsigned)px < (unsigned)mw && (unsigned)py < (unsigned)mh) {
        int t = BK->map[(py >> 3) * BK_MAP_W + (px >> 3)];
        if (t > 0 && t < BK_TILES) col = BK->draw_pal[BK->tiles[t * BK_TILE_BYTES + (py & 7) * 8 + (px & 7)]];
      }
      if (col < 0) { if (outside < 0) continue; col = out; }
      if (step == 1) row[sx] = (uint8_t)col;
      else {
        int e = sx + step > BK->clip_x1 ? BK->clip_x1 : sx + step;
        memset(row + sx, col, (size_t)(e - sx));
      }
    }
  }
}

/* World point (wz = height above the floor) to screen with the camera of the last bk_floor()/bk_floorh().
   scale = screen pixels per world pixel at that distance, dist = distance along the view (for bk_depth). */
int bk_project(float wx, float wy, float wz, float *sx, float *sy, float *scale, float *dist) {
  if (!fcam.valid) return 0;
  float dx = wx - fcam.x, dy = wy - fcam.y;
  float z = dx * fcam.c + dy * fcam.s;
  if (z < 1.f) return 0;
  float lat = -dx * fcam.s + dy * fcam.c;
  float k = fcam.focal / z;
  *sx = fcam.cx + lat * k;
  *sy = fcam.horizon + (fcam.height - wz) * k;
  *scale = k;
  if (dist) *dist = z;
  return 1;
}

/* ---------------- hills ---------------- */

float bk_hget(float x, float y) {
  float u = x * 0.125f, v = y * 0.125f;
  if (u < 0) u = 0;
  if (v < 0) v = 0;
  if (u > BK_MAP_W - 0.001f) u = BK_MAP_W - 0.001f;
  if (v > BK_MAP_H - 0.001f) v = BK_MAP_H - 0.001f;
  int i = (int)u, j = (int)v;
  float fu = u - i, fv = v - j;
  const uint8_t *h = &BK->height[j * (BK_MAP_W + 1) + i];
  float top = h[0] + (h[1] - h[0]) * fu;
  float bot = h[BK_MAP_W + 1] + (h[BK_MAP_W + 2] - h[BK_MAP_W + 1]) * fu;
  return top + (bot - top) * fv;
}

#define OCC_N 40
BK_BIG_BSS static int16_t occ[BK_W][OCC_N];   /* per column: lowest floor row drawn once the ray passed occ_z[k] */
static float occ_z[OCC_N];
static float depth_z = -1;

void bk_depth(float z) { depth_z = z; }

void bk_core_ctx_take(bk_ctx *c) { c->sprfx = bk_sprfx; c->fcam = fcam; c->depth_z = depth_z; }
void bk_core_ctx_put(const bk_ctx *c) { bk_sprfx = c->sprfx; fcam = c->fcam; depth_z = c->depth_z; }

static inline int texel(float wx, float wy) {
  int px = (int)wx, py = (int)wy;
  if (wx < 0 || wy < 0 || px >= BK_MAP_W * 8 || py >= BK_MAP_H * 8) return -1;
  int t = BK->map[(py >> 3) * BK_MAP_W + (px >> 3)];
  if (t <= 0 || t >= BK_TILES) return -1;
  return BK->draw_pal[BK->tiles[t * BK_TILE_BYTES + (py & 7) * 8 + (px & 7)]];
}

/* For each screen column a ray walks away from the camera in growing steps. At each step the floor
   height there is projected to a screen row; if that row is above everything drawn so far in the
   column, the rows in between are filled, sampling the map along the stretch of ray they cover.
   Near hills therefore hide far ones. Cost: about 300 steps per column (step 2 halves the columns). */
#define HILL_FAR 2048.f
void bk_floorh(float x, float y, float angle, float camz, int horizon, float focal, int outside, int step) {
  if (step < 1) step = 1;
  if (focal < 1) focal = 1;
  if (occ_z[1] == 0) for (int k = 0; k < OCC_N; k++) occ_z[k] = 6.f * powf(1.16f, (float)k);
  float c = cosf(angle), s = sinf(angle);
  float cx = (BK->clip_x0 + BK->clip_x1) * 0.5f;
  fcam.x = x; fcam.y = y; fcam.angle = angle; fcam.height = camz; fcam.focal = focal;
  fcam.horizon = horizon; fcam.c = c; fcam.s = s; fcam.valid = 1; fcam.hills = 1; fcam.cx = cx;
  uint8_t out = BK->draw_pal[outside & 255];
  int top = BK->clip_y0, bottom = BK->clip_y1;
  for (int sx = BK->clip_x0; sx < BK->clip_x1; sx += step) {
    int ex = sx + step > BK->clip_x1 ? BK->clip_x1 : sx + step;
    float rx = (sx + step * 0.5f - cx) / focal;
    float dx = c - s * rx, dy = s + c * rx;       /* world step per unit of depth */
    int ybuf = bottom, k = 0;
    float z = 2.f;
    float pwx = x + dx * z, pwy = y + dy * z;
    float psy = horizon + (camz - bk_hget(pwx, pwy)) * focal / z;
    while (z < HILL_FAR && ybuf > top) {
      z += 0.3f + z * 0.015f;
      float wx = x + dx * z, wy = y + dy * z;
      float sy = horizon + (camz - bk_hget(wx, wy)) * focal / z;
      int iy = (int)ceilf(sy);
      if (iy < top) iy = top;
      if (iy < ybuf) {
        float span = psy - sy;
        for (int row = iy; row < ybuf; row++) {
          float t = span > 0.001f ? (psy - row) / span : 1.f;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          int col = texel(pwx + (wx - pwx) * t, pwy + (wy - pwy) * t);
          if (col < 0) { if (outside < 0) continue; col = out; }
          uint8_t *d = &BK->screen[row * BK_W + sx];
          for (int i = sx; i < ex; i++) *d++ = (uint8_t)col;
        }
        ybuf = iy;
      }
      pwx = wx; pwy = wy; psy = sy;
      while (k < OCC_N && occ_z[k] <= z) { for (int i = sx; i < ex; i++) occ[i][k] = (int16_t)ybuf; k++; }
    }
    if (outside >= 0) {
      int r0 = horizon + 1 > top ? horizon + 1 : top;
      for (int row = r0; row < ybuf; row++) memset(&BK->screen[row * BK_W + sx], out, (size_t)(ex - sx));
    }
    for (; k < OCC_N; k++) for (int i = sx; i < ex; i++) occ[i][k] = (int16_t)(ybuf < horizon + 1 ? ybuf : horizon + 1);
  }
}

/* bk_sspr helper: with bk_depth(z) set after bk_floorh, is screen pixel (x, y) behind a nearer hill? */
static int occ_k = -1;
static inline int hidden_px(int x, int y) {
  if (occ_k < 0 || x < 0 || x >= BK_W) return 0;
  return y >= occ[x][occ_k];
}

/* Scaled sprite: tiles n.. (w x h tiles from the sheet) drawn sc times bigger, nearest-neighbour,
   top-left at x, y (camera applies), transparent colours skipped. */
void bk_sspr(int n, float x, float y, int w, int h, float sc, int flipx, int flipy) {
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  if (sc <= 0.f) return;
  if (bk_sprfx.on) { if (sc * w * 8 <= 4096 && sc * h * 8 <= 4096) spr_fx(n, x, y, w, h, sc, flipx, flipy, 1); return; }
  int sw = w * 8, sh = h * 8;
  int x0 = (int)floorf(x) - BK->cam_x, y0 = (int)floorf(y) - BK->cam_y;
  int dw = (int)(sw * sc + 0.5f), dh = (int)(sh * sc + 0.5f);
  if (dw < 1 || dh < 1 || dw > 4096 || dh > 4096) return;
  int32_t step = (int32_t)(65536.f / sc);
  occ_k = -1;
  if (depth_z > 0 && fcam.valid && fcam.hills) {
    for (int k = 0; k < OCC_N && occ_z[k] < depth_z * 0.97f; k++) occ_k = k;
  }
  int ya = y0 < BK->clip_y0 ? BK->clip_y0 : y0, yb = y0 + dh > BK->clip_y1 ? BK->clip_y1 : y0 + dh;
  int xa = x0 < BK->clip_x0 ? BK->clip_x0 : x0, xb = x0 + dw > BK->clip_x1 ? BK->clip_x1 : x0 + dw;
  for (int py = ya; py < yb; py++) {
    int v = (int)(((int64_t)(py - y0) * step) >> 16);
    if (v >= sh) v = sh - 1;
    if (flipy) v = sh - 1 - v;
    int trow = n + (v >> 3) * 16;
    uint8_t *dst = &BK->screen[py * BK_W];
    for (int px = xa; px < xb; px++) {
      int u = (int)(((int64_t)(px - x0) * step) >> 16);
      if (u >= sw) u = sw - 1;
      if (flipx) u = sw - 1 - u;
      int t = trow + (u >> 3);
      if (t < 0 || t >= BK_TILES) continue;
      uint8_t c = BK->tiles[t * BK_TILE_BYTES + (v & 7) * 8 + (u & 7)];
      if (BK->transparent[c] || hidden_px(px, py)) continue;
      dst[px] = BK->draw_pal[c];
    }
  }
}

/* ---------------- sprite shaders ---------------- */
/* With sprfx{} on, a sprite is first copied out of the sheet into a small buffer (with a 1 pixel border for the
   outline), shaded there in sprite pixels, then drawn at its scale. Cost is per sprite pixel, so a 16x16 sprite is
   256 pixels of work however big it is drawn. The light rim uses the sprite's own shape as a height map: a pixel
   with empty space toward the light is an edge that catches it, one with empty space away from the light is in shade. */
bk_sprfx_t bk_sprfx;
void bk_sprfx_reset(void) {
  memset(&bk_sprfx, 0, sizeof(bk_sprfx));
  bk_sprfx.outline = bk_sprfx.flash = bk_sprfx.silhouette = bk_sprfx.shadow = -1;
  bk_sprfx.lx = -1; bk_sprfx.ly = -1;
}

#define SFX_MAX 128
static int16_t sfx_a[(SFX_MAX + 2) * (SFX_MAX + 2)], sfx_b[(SFX_MAX + 2) * (SFX_MAX + 2)];

static void spr_fx(int n, float x, float y, int w, int h, float sc, int flipx, int flipy, int use_depth) {
  const bk_sprfx_t *f = &bk_sprfx;
  int sw = w * 8, sh = h * 8;
  if (sw > SFX_MAX) sw = SFX_MAX;
  if (sh > SFX_MAX) sh = SFX_MAX;
  const int bw = sw + 2, bh = sh + 2;
  for (int i = 0; i < bw * bh; i++) sfx_a[i] = -1;
  for (int v = 0; v < sh; v++)
    for (int u = 0; u < sw; u++) {
      const int su = flipx ? sw - 1 - u : u, sv = flipy ? sh - 1 - v : v;
      const int t = n + (sv >> 3) * 16 + (su >> 3);
      if (t < 0 || t >= BK_TILES) continue;
      const uint8_t c = BK->tiles[t * BK_TILE_BYTES + (sv & 7) * 8 + (su & 7)];
      if (!BK->transparent[c]) sfx_a[(v + 1) * bw + u + 1] = BK->draw_pal[c];
    }
  /* 1. your own shader */
  if (f->fn)
    for (int v = 0; v < sh; v++)
      for (int u = 0; u < sw; u++) {
        int16_t *p = &sfx_a[(v + 1) * bw + u + 1];
        const int c = f->fn(u, v, *p, sw, sh);
        *p = (int16_t)(c < 0 ? -1 : c & 255);
      }
  /* 2. dissolve */
  if (f->dissolve > 0) {
    const int k = f->dissolve >= 1 ? 16 : (int)(f->dissolve * 16 + 0.5f);
    for (int v = 0; v < sh; v++) for (int u = 0; u < sw; u++) if (BAYER[(v & 3) * 4 + (u & 3)] < k) sfx_a[(v + 1) * bw + u + 1] = -1;
  }
  /* 3. light: rim toward the light, shade away from it */
  if (f->light > 0) {
    float dx = f->lx, dy = f->ly;
    if (f->light_at) { dx = f->lpx - (x + sw * sc * 0.5f); dy = f->lpy - (y + sh * sc * 0.5f); }
    const float len = sqrtf(dx * dx + dy * dy);
    if (len > 0.001f) {
      dx /= len; dy /= len;
      /* bevel 3 pixels deep, strongest at the edge: a sprite with a dark 1 pixel outline still gets a lit rim inside it */
      int ox[3], oy[3];
      for (int d = 0; d < 3; d++) { ox[d] = (int)lroundf(dx * (d + 1)); oy[d] = (int)lroundf(dy * (d + 1)); }
      const int k = f->light >= 1 ? 256 : (int)(f->light * 256);
      blend_lut *hi[3] = { blend_rgb(0xFFFFFF, k * 6 / 10), blend_rgb(0xFFFFFF, k * 4 / 10), blend_rgb(0xFFFFFF, k * 2 / 10) };
      blend_lut *lo[3] = { blend_rgb(0, k / 2), blend_rgb(0, k / 3), blend_rgb(0, k / 6) };
      memcpy(sfx_b, sfx_a, sizeof(int16_t) * (size_t)(bw * bh));
      #define SOLID(uu, vv) ((uu) >= 0 && (vv) >= 0 && (uu) < bw && (vv) < bh && sfx_b[(vv) * bw + (uu)] >= 0)
      for (int v = 1; v <= sh; v++)
        for (int u = 1; u <= sw; u++) {
          int16_t *p = &sfx_a[v * bw + u];
          if (*p < 0) continue;
          for (int d = 0; d < 3; d++) {
            if (!SOLID(u + ox[d], v + oy[d])) { *p = blend_px(hi[d], *p, hi[d]->m); break; }
            if (!SOLID(u - ox[d], v - oy[d])) { *p = blend_px(lo[d], *p, lo[d]->m); break; }
          }
        }
      #undef SOLID
    }
  }
  /* 4. flash and 5. silhouette */
  if (f->flash >= 0 && f->flash_k > 0) {
    blend_lut *fl = blend_rgb(pal_rgb(f->flash), amount(f->flash_k));
    for (int i = 0; i < bw * bh; i++) if (sfx_a[i] >= 0) sfx_a[i] = blend_px(fl, sfx_a[i], fl->m);
  }
  if (f->silhouette >= 0) for (int i = 0; i < bw * bh; i++) if (sfx_a[i] >= 0) sfx_a[i] = (int16_t)(f->silhouette & 255);
  /* 6. outline around what is left */
  if (f->outline >= 0) {
    memcpy(sfx_b, sfx_a, sizeof(int16_t) * (size_t)(bw * bh));
    for (int v = 0; v < bh; v++)
      for (int u = 0; u < bw; u++) {
        if (sfx_b[v * bw + u] >= 0) continue;
        if ((u > 0 && sfx_b[v * bw + u - 1] >= 0) || (u < bw - 1 && sfx_b[v * bw + u + 1] >= 0) ||
            (v > 0 && sfx_b[(v - 1) * bw + u] >= 0) || (v < bh - 1 && sfx_b[(v + 1) * bw + u] >= 0))
          sfx_a[v * bw + u] = (int16_t)(f->outline & 255);
      }
  }
  /* draw: the shadow first, then the sprite, each at scale sc with the border pixel around it */
  occ_k = -1;
  if (use_depth && depth_z > 0 && fcam.valid && fcam.hills)
    for (int k = 0; k < OCC_N && occ_z[k] < depth_z * 0.97f; k++) occ_k = k;
  const int32_t step = (int32_t)(65536.f / sc);
  for (int pass = f->shadow >= 0 ? 0 : 1; pass < 2; pass++) {
    const float ox = pass ? 0 : f->sdx * sc, oy = pass ? 0 : f->sdy * sc;
    const int x0 = (int)floorf(x - sc + ox) - BK->cam_x, y0 = (int)floorf(y - sc + oy) - BK->cam_y;
    const int dw = (int)(bw * sc + 0.5f), dh = (int)(bh * sc + 0.5f);
    const int ya = y0 < BK->clip_y0 ? BK->clip_y0 : y0, yb = y0 + dh > BK->clip_y1 ? BK->clip_y1 : y0 + dh;
    const int xa = x0 < BK->clip_x0 ? BK->clip_x0 : x0, xb = x0 + dw > BK->clip_x1 ? BK->clip_x1 : x0 + dw;
    for (int py = ya; py < yb; py++) {
      int v = (int)(((int64_t)(py - y0) * step) >> 16);
      if (v >= bh) v = bh - 1;
      uint8_t *dst = &BK->screen[py * BK_W];
      for (int px = xa; px < xb; px++) {
        int u = (int)(((int64_t)(px - x0) * step) >> 16);
        if (u >= bw) u = bw - 1;
        const int c = sfx_a[v * bw + u];
        if (c < 0 || hidden_px(px, py)) continue;
        dst[px] = (uint8_t)(pass ? c : f->shadow);
      }
    }
  }
  occ_k = -1;
}

/* ---------------- display shader ---------------- */
/* Applied while the indexed screen becomes real colours for the panel, so it works in full colour (soft scanlines,
   a vignette, colour grading) and never touches screen[]: game logic, pget() and linked games don't see it.
   Colour grading is folded into the 256-entry colour table (free); the rest is per pixel, integer only.
   With everything at 0 it is the plain table lookup it always was. */

void bk_display_reset(void) { memset(&BK->display, 0, sizeof(BK->display)); }

static const struct { const char *name; int32_t v[10]; } PRESETS[] = {
  /*                 scan vig curve split blur grain bright contrast sat warm */
  { "off",         {   0,   0,   0,   0,   0,   0,    0,   0,    0,   0 } },
  { "crt",         {  45,  35,  30,   1,  35,   6,    8,  10,   10,   0 } },
  { "arcade",      {  60,  20,  12,   0,  20,   0,   12,  15,   25,   0 } },
  { "old tv",      {  50,  60,  45,   2,  60,  35,    0,  -5,  -60,  15 } },
  { "handheld",    {  15,   0,   0,   0,  25,   0,   -5, -15,  -35,  10 } },
  { "sepia",       {   0,  40,   0,   0,   0,  10,    0,   0, -100,  55 } },
  { "night",       {  20,  55,   0,   0,  10,  25,  -10,  10,  -70, -45 } },
  { "vivid",       {   0,  15,   0,   0,   0,   0,    5,  20,   45,   0 } },
};

int bk_display_preset(const char *name) {
  for (size_t i = 0; i < sizeof(PRESETS) / sizeof(PRESETS[0]); i++)
    if (!strcmp(name, PRESETS[i].name)) { memcpy(&BK->display, PRESETS[i].v, sizeof(BK->display)); return 1; }
  return 0;
}

static inline int clamp255(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/* palette colour table after brightness, contrast, saturation and warmth */
static void graded_palette(uint8_t *rgb) {
  const int br = BK->display.bright, co = BK->display.contrast, sa = BK->display.sat, wa = BK->display.warm;
  for (int i = 0; i < 256; i++) {
    int r = BK->palette[i * 3], g = BK->palette[i * 3 + 1], b = BK->palette[i * 3 + 2];
    if (sa) {
      const int y = (r * 77 + g * 150 + b * 29) >> 8, f = 100 + sa;      /* 0 = grey, 200 = twice as colourful */
      r = y + (r - y) * f / 100; g = y + (g - y) * f / 100; b = y + (b - y) * f / 100;
    }
    if (wa) { r += wa * 40 / 100; g += wa * 10 / 100; b -= wa * 40 / 100; }
    if (co) { const int f = 100 + co; r = 128 + (r - 128) * f / 100; g = 128 + (g - 128) * f / 100; b = 128 + (b - 128) * f / 100; }
    if (br) { r += br * 128 / 100; g += br * 128 / 100; b += br * 128 / 100; }
    rgb[i * 3] = (uint8_t)clamp255(r); rgb[i * 3 + 1] = (uint8_t)clamp255(g); rgb[i * 3 + 2] = (uint8_t)clamp255(b);
  }
}

void bk_graded_palette(uint8_t *rgb) { graded_palette(rgb); }

static int spatial_on(void) {
  const __typeof__(BK->display) *d = &BK->display;
  return d->scan || d->vignette || d->curve || d->split || d->blur || d->grain;
}

/* Tables for one frame through the display shader (bk_present_begin), then rows of pixels (PRESENT_ROWS). */
static struct {
  uint8_t rgb[256 * 3];
  uint16_t lut565[256];
  int spatial, vig, curve, split, blur, grain;
  uint32_t fseed;
  int32_t colv[BK_W], rowv[BK_H], colA[BK_W], colB[BK_W], rowA[BK_H], rowB[BK_H], nx2[BK_W], ny2[BK_H];
} pv;

void bk_present_begin(void) {
  graded_palette(pv.rgb);
  for (int i = 0; i < 256; i++)
    pv.lut565[i] = (uint16_t)(((pv.rgb[i * 3] & 0xF8) << 8) | ((pv.rgb[i * 3 + 1] & 0xFC) << 3) | (pv.rgb[i * 3 + 2] >> 3));
  pv.spatial = spatial_on();
  if (!pv.spatial) return;
  const __typeof__(BK->display) *d = &BK->display;
  const int cx2 = BK_W, cy2 = BK_H;                     /* the middle, in half pixels */
  const int vig = pv.vig = d->vignette < 0 ? 0 : d->vignette > 100 ? 100 : d->vignette;
  const int curve = pv.curve = d->curve < 0 ? 0 : d->curve > 100 ? 100 : d->curve;
  for (int x = 0; x < BK_W; x++) {
    const int n = (2 * x + 1 - cx2) * 256 / cx2;      /* -256..256 */
    pv.nx2[x] = n * n >> 8;                            /* 0..256 */
    pv.colv[x] = 256 - vig * pv.nx2[x] * 7 / 1000;
    pv.colA[x] = (int32_t)((2 * x + 1 - cx2) * 32768) + (int32_t)((int64_t)(2 * x + 1 - cx2) * 32768 * curve * pv.nx2[x] / 85333);
    pv.colB[x] = (int32_t)((int64_t)(2 * x + 1 - cx2) * 32768 * curve * 3 / 1000);
  }
  for (int y = 0; y < BK_H; y++) {
    const int n = (2 * y + 1 - cy2) * 256 / cy2;
    pv.ny2[y] = n * n >> 8;
    pv.rowv[y] = (256 - vig * pv.ny2[y] * 7 / 1000) * ((y & 1) ? 256 - d->scan * 160 / 100 : 256) >> 8;
    pv.rowA[y] = (int32_t)((2 * y + 1 - cy2) * 32768) + (int32_t)((int64_t)(2 * y + 1 - cy2) * 32768 * curve * pv.ny2[y] / 85333);
    pv.rowB[y] = (int32_t)((int64_t)(2 * y + 1 - cy2) * 32768 * curve * 3 / 1000);
  }
  pv.split = d->split < 0 ? 0 : d->split > 4 ? 4 : d->split;
  pv.blur = (d->blur < 0 ? 0 : d->blur > 100 ? 100 : d->blur) * 128 / 100;
  pv.grain = (d->grain < 0 ? 0 : d->grain > 100 ? 100 : d->grain) * 60 / 100;
  pv.fseed = hash32(BK->frame * 0x9E3779B9u);
}

/* rows y0..y1-1 through the shader; PUT(i, r, g, b) stores pixel i, counted from the first row asked for */
#define PRESENT_ROWS(PUT, Y0, Y1)                                                                                 \
  for (int y = (Y0); y < (Y1); y++) {                                                                             \
    int pr = -1, pg = 0, pb = 0;                                                                                  \
    const int o = (y - (Y0)) * BK_W;                                                                              \
    for (int x = 0; x < BK_W; x++) {                                                                              \
      int sx = x, sy = y, r, g, b;                                                                                \
      if (pv.curve) {                                                                                             \
        /* barrel: the source point is pushed out from the middle by how far the pixel is from the middle */    \
        const int32_t fx = pv.colA[x] + (int32_t)((int64_t)pv.colB[x] * pv.ny2[y] >> 8);   /* from the middle, 16.16 */ \
        const int32_t fy = pv.rowA[y] + (int32_t)((int64_t)pv.rowB[y] * pv.nx2[x] >> 8);                         \
        sx = (fx + ((BK_W / 2) << 16) - 32768) >> 16; sy = (fy + ((BK_H / 2) << 16) - 32768) >> 16;              \
        if (sx < 0 || sy < 0 || sx >= BK_W || sy >= BK_H) { PUT(o + x, 0, 0, 0); pr = 0; pg = pb = 0; continue; } \
      }                                                                                                           \
      const uint8_t *row = &BK->screen[sy * BK_W];                                                                \
      if (pv.split) {                                                                                             \
        const int a = sx - pv.split < 0 ? 0 : sx - pv.split, c = sx + pv.split >= BK_W ? BK_W - 1 : sx + pv.split; \
        r = pv.rgb[row[a] * 3]; g = pv.rgb[row[sx] * 3 + 1]; b = pv.rgb[row[c] * 3 + 2];                          \
      } else { const uint8_t *p = &pv.rgb[row[sx] * 3]; r = p[0]; g = p[1]; b = p[2]; }                          \
      if (pv.blur && pr >= 0) { r = (r * (256 - pv.blur) + pr * pv.blur) >> 8; g = (g * (256 - pv.blur) + pg * pv.blur) >> 8; b = (b * (256 - pv.blur) + pb * pv.blur) >> 8; } \
      pr = r; pg = g; pb = b;                                                                                     \
      const int v = pv.colv[x] * pv.rowv[y] >> 8;                                                                 \
      r = r * v >> 8; g = g * v >> 8; b = b * v >> 8;                                                             \
      if (pv.grain) { const int n = (int)(hash32(pv.fseed ^ (uint32_t)(y * BK_W + x)) & 255) - 128; const int e = n * pv.grain >> 7; r += e; g += e; b += e; } \
      PUT(o + x, clamp255(r), clamp255(g), clamp255(b));                                                          \
    }                                                                                                             \
  }

void bk_to_rgba(uint32_t *out) {
  bk_present_begin();
  if (!pv.spatial) {
    uint32_t lut[256];
    for (int i = 0; i < 256; i++) lut[i] = 0xFF000000u | ((uint32_t)pv.rgb[i * 3 + 2] << 16) | ((uint32_t)pv.rgb[i * 3 + 1] << 8) | pv.rgb[i * 3];
    for (int i = 0; i < BK_W * BK_H; i++) out[i] = lut[BK->screen[i]];
    return;
  }
#define PUT_RGBA(i, r, g, b) out[i] = 0xFF000000u | ((uint32_t)(b) << 16) | ((uint32_t)(g) << 8) | (uint32_t)(r)
  PRESENT_ROWS(PUT_RGBA, 0, BK_H)
#undef PUT_RGBA
}

void bk_present_rgb565(uint16_t *out, int y0, int y1) {
  if (y0 < 0) y0 = 0;
  if (y1 > BK_H) y1 = BK_H;
  if (!pv.spatial) {
    const uint8_t *src = &BK->screen[y0 * BK_W];
    for (int i = 0, n = (y1 - y0) * BK_W; i < n; i++) out[i] = pv.lut565[src[i]];
    return;
  }
#define PUT_565(i, r, g, b) out[i] = (uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3))
  PRESENT_ROWS(PUT_565, y0, y1)
#undef PUT_565
}

void bk_to_rgb565(uint16_t *out) { bk_present_begin(); bk_present_rgb565(out, 0, BK_H); }

/* ---------------- input ---------------- */

void bk_set_input(int player, uint16_t mask, const uint8_t *press) {
  if (player < 0 || player >= BK_MAX_PLAYERS) return;
  __typeof__(BK->pad[0]) *p = &BK->pad[player];
  /* a button held while a cart starts (Start from the launcher, say) counts only after it is let go */
  if (p->fresh) { p->ignore = mask; p->fresh = 0; }
  p->ignore &= mask;
  mask &= (uint16_t)~p->ignore;
  p->btn_prev = p->btn;
  p->btn = mask;
  for (int i = 0; i < BK_NUM_BUTTONS; i++) {
    p->press[i] = ((p->ignore >> i) & 1) ? 0 : press ? press[i] : ((mask >> i) & 1 ? 255 : 0);
    if ((mask >> i) & 1) { if (p->hold[i] < 65535) p->hold[i]++; }
    else p->hold[i] = 0;
  }
}

int bk_btn(int player, int i) {
  return player >= 0 && player < BK_MAX_PLAYERS && i >= 0 && i < BK_NUM_BUTTONS && ((BK->pad[player].btn >> i) & 1);
}

/* pressed this frame, then auto-repeat after 15 frames every 4 frames */
int bk_btnp(int player, int i) {
  if (player < 0 || player >= BK_MAX_PLAYERS || i < 0 || i >= BK_NUM_BUTTONS) return 0;
  int h = BK->pad[player].hold[i];
  if (h == 1) return 1;
  return h > 15 && ((h - 15) % 4) == 0;
}

/* ---------------- rng ---------------- */

void bk_srand(uint64_t seed) { BK->rng = seed ? seed : 0x9E3779B97F4A7C15ull; }

uint32_t bk_rand32(void) {
  uint64_t x = BK->rng;
  x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
  BK->rng = x;
  return (uint32_t)((x * 0x2545F4914F6CDD1Dull) >> 32);
}

/* ---------------- audio ---------------- */

void bk_sfx(int ch, float freq, int wave, float vol, int frames, float pan, float slide) {
  if (ch < 0 || ch >= BK_CHANNELS) return;
  bk_voice *v = &BK->voice[ch];
  v->freq = freq;
  v->wave = wave;
  v->vol = vol < 0 ? 0 : vol > 1 ? 1 : vol;
  v->pan = pan < -1 ? -1 : pan > 1 ? 1 : pan;
  v->len = frames * (BK_SAMPLE_RATE / BK_FPS);
  v->pos = 0;
  v->slide = slide / (float)BK_SAMPLE_RATE;
  v->held = 0;
  if (!v->noise) v->noise = 0x1234567u + (uint32_t)ch;
}

/* A held voice (the music player): it sounds until its volume reaches 0, with no decay of its own.
   Calling it again on a sounding voice only moves pitch, volume and pan, so notes glide without clicks. */
void bk_voice_set(int ch, float freq, int wave, float vol, float pan) {
  if (ch < 0 || ch >= BK_CHANNELS) return;
  bk_voice *v = &BK->voice[ch];
  int sounding = v->held && v->pos < v->len;
  if (!sounding && vol <= 0) return;
  if (!sounding) { v->gain = 0; v->pos = 0; v->held = 1; v->len = 0x7fffffff; }
  v->freq = freq > 1 ? freq : 1;
  v->wave = wave;
  v->vol = vol < 0 ? 0 : vol > 1 ? 1 : vol;
  v->pan = pan < -1 ? -1 : pan > 1 ? 1 : pan;
  v->slide = 0;
  if (!v->noise) v->noise = 0x1234567u + (uint32_t)ch;
}

void bk_audio_render(float *out, int frames) {
  memset(out, 0, sizeof(float) * 2 * (size_t)frames);
  for (int c = 0; c < BK_CHANNELS; c++) {
    bk_voice *v = &BK->voice[c];
    if (v->freq <= 0 || v->pos >= v->len) continue;
    float gl = v->vol * (v->pan <= 0 ? 1.f : 1.f - v->pan);
    float gr = v->vol * (v->pan >= 0 ? 1.f : 1.f + v->pan);
    if (v->held) { gl = v->pan <= 0 ? 1.f : 1.f - v->pan; gr = v->pan >= 0 ? 1.f : 1.f + v->pan; }
    for (int i = 0; i < frames && v->pos < v->len; i++, v->pos++) {
      float env;
      if (v->held) {                                             /* glide to the asked volume over ~3 ms */
        v->gain += (v->vol - v->gain) * 0.008f;
        env = v->gain;
        if (v->vol <= 0 && v->gain < 0.0005f) { v->len = 0; v->held = 0; break; }
      } else {
        env = 1.f - (float)v->pos / (float)v->len;              /* linear decay */
        if (v->pos < 64) env *= (float)v->pos / 64.f;           /* tiny attack, no click */
      }
      float p = v->phase, s;
      switch (v->wave) {
        case 1: s = 4.f * fabsf(p - 0.5f) - 1.f; break;          /* triangle */
        case 2: s = 2.f * p - 1.f; break;                        /* saw */
        case 3: s = (v->noise & 1) ? 1.f : -1.f; break;          /* noise */
        case 4: s = sinf(p * 6.2831853f); break;                 /* sine */
        case 5: s = p < 0.25f ? 1.f : -1.f; break;               /* pulse 25% */
        default: s = p < 0.5f ? 1.f : -1.f; break;               /* square */
      }
      s *= env * 0.25f;
      out[i * 2] += s * gl;
      out[i * 2 + 1] += s * gr;
      float np = p + v->freq / (float)BK_SAMPLE_RATE;
      if (np >= 1.f) {
        np -= (float)(int)np;
        uint32_t x = v->noise; x ^= x << 13; x ^= x >> 17; x ^= x << 5; v->noise = x;
      }
      v->phase = np;
      v->freq += v->slide;
      if (v->freq < 1) v->freq = 1;
    }
  }
  for (int i = 0; i < frames * 2; i++) {
    float s = out[i] * BK->master_vol * 2.f;
    out[i] = s > 1 ? 1 : s < -1 ? -1 : s;
  }
}
