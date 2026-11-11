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

int bk_text(const char *s, int x, int y, int c, int scale) {
  if (scale < 1) scale = 1;
  int x0 = x, maxw = 0;
  for (; *s; s++) {
    unsigned ch = (unsigned char)*s;
    if (ch == '\n') { if (x - x0 > maxw) maxw = x - x0; x = x0; y += 8 * scale; continue; }
    if (ch > 127) ch = '?';
    const uint8_t *g = bk_font8x8[ch];
    for (int j = 0; j < 8; j++)
      for (int i = 0; i < 8; i++)
        if (g[j] & (1 << i)) {
          if (scale == 1) px(x + i, y + j, c);
          else bk_rectfill(x + i * scale, y + j * scale, scale, scale, c);
        }
    x += 8 * scale;
  }
  if (x - x0 > maxw) maxw = x - x0;
  return maxw;
}

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
static int16_t occ[BK_W][OCC_N];   /* per column: lowest floor row drawn once the ray passed occ_z[k] */
static float occ_z[OCC_N];
static float depth_z = -1;

void bk_depth(float z) { depth_z = z; }

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

void bk_to_rgba(uint32_t *out) {
  uint32_t lut[256];
  for (int i = 0; i < 256; i++) {
    const uint8_t *p = &BK->palette[i * 3];
    lut[i] = 0xFF000000u | ((uint32_t)p[2] << 16) | ((uint32_t)p[1] << 8) | p[0];
  }
  for (int i = 0; i < BK_W * BK_H; i++) out[i] = lut[BK->screen[i]];
}

void bk_to_rgb565(uint16_t *out) {
  uint16_t lut[256];
  for (int i = 0; i < 256; i++) {
    const uint8_t *p = &BK->palette[i * 3];
    lut[i] = (uint16_t)(((p[0] & 0xF8) << 8) | ((p[1] & 0xFC) << 3) | (p[2] >> 3));
  }
  for (int i = 0; i < BK_W * BK_H; i++) out[i] = lut[BK->screen[i]];
}

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
  if (!v->noise) v->noise = 0x1234567u + (uint32_t)ch;
}

void bk_audio_render(float *out, int frames) {
  memset(out, 0, sizeof(float) * 2 * (size_t)frames);
  for (int c = 0; c < BK_CHANNELS; c++) {
    bk_voice *v = &BK->voice[c];
    if (v->freq <= 0 || v->pos >= v->len) continue;
    float gl = v->vol * (v->pan <= 0 ? 1.f : 1.f - v->pan);
    float gr = v->vol * (v->pan >= 0 ? 1.f : 1.f + v->pan);
    for (int i = 0; i < frames && v->pos < v->len; i++, v->pos++) {
      float env = 1.f - (float)v->pos / (float)v->len;          /* linear decay */
      if (v->pos < 64) env *= (float)v->pos / 64.f;             /* tiny attack, no click */
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
