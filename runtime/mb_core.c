/* MiniBoi runtime: machine state, graphics, input, rng, audio. MIT License. */
#include "mb.h"
#include "mb_font.h"
#include <string.h>
#include <math.h>
#include <stdlib.h>

mb_machine *MB = 0;

static const char *BASE_PAL[32] = {
  "000000","1b1b2f","3a2e5c","5e3a8c","8e4fb0","c06bd0",
  "2d1e1e","5a2f2a","8f3f2e","c75b39","f08a4b","ffc07a",
  "fff3d6","ffffff",
  "1d3b2a","2f6b3a","4fa04a","8ad35a","d5f07a",
  "0f2a4a","1f4f8a","3a86d0","6ec3f0","bff0ff",
  "6b1d2e","b02a3a","e8504a","ffd23f","7a7a8a","a8a8b8","4a4a5a","2a2a36"
};

static int hexv(char c) { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; }

void mb_default_palette(uint8_t *pal) {
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

void mb_reset_draw_state(void) {
  MB->cam_x = MB->cam_y = 0;
  MB->clip_x0 = MB->clip_y0 = 0;
  MB->clip_x1 = MB_W; MB->clip_y1 = MB_H;
  for (int i = 0; i < 256; i++) { MB->draw_pal[i] = (uint8_t)i; MB->transparent[i] = 0; }
  MB->transparent[0] = 1;
}

void mb_machine_init(mb_machine *m) {
  memset(m, 0, sizeof(*m));
  MB = m;
  mb_default_palette(m->palette);
  mb_reset_draw_state();
  m->rng = 0x9E3779B97F4A7C15ull;
  m->master_vol = 0.5f;
}

/* ---------------- graphics ---------------- */

static inline void px(int x, int y, int c) {
  x -= MB->cam_x; y -= MB->cam_y;
  if (x < MB->clip_x0 || y < MB->clip_y0 || x >= MB->clip_x1 || y >= MB->clip_y1) return;
  MB->screen[y * MB_W + x] = MB->draw_pal[c & 255];
}

void mb_cls(int c) { memset(MB->screen, c & 255, sizeof(MB->screen)); }
void mb_pset(int x, int y, int c) { px(x, y, c); }

int mb_pget(int x, int y) {
  x -= MB->cam_x; y -= MB->cam_y;
  if (x < 0 || y < 0 || x >= MB_W || y >= MB_H) return 0;
  return MB->screen[y * MB_W + x];
}

void mb_line(int x0, int y0, int x1, int y1, int c) {
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
  int sy = y - MB->cam_y;
  if (sy < MB->clip_y0 || sy >= MB->clip_y1) return;
  int a = x0 - MB->cam_x, b = x1 - MB->cam_x;
  if (a < MB->clip_x0) a = MB->clip_x0;
  if (b >= MB->clip_x1) b = MB->clip_x1 - 1;
  if (a > b) return;
  memset(&MB->screen[sy * MB_W + a], MB->draw_pal[c & 255], (size_t)(b - a + 1));
}

void mb_rectfill(int x, int y, int w, int h, int c) {
  for (int j = 0; j < h; j++) hline(x, x + w - 1, y + j, c);
}

void mb_rect(int x, int y, int w, int h, int c) {
  if (w <= 0 || h <= 0) return;
  hline(x, x + w - 1, y, c);
  hline(x, x + w - 1, y + h - 1, c);
  for (int j = 1; j < h - 1; j++) { px(x, y + j, c); px(x + w - 1, y + j, c); }
}

void mb_circ(int cx, int cy, int r, int c) {
  int x = r, y = 0, err = 1 - r;
  while (x >= y) {
    px(cx + x, cy + y, c); px(cx - x, cy + y, c); px(cx + x, cy - y, c); px(cx - x, cy - y, c);
    px(cx + y, cy + x, c); px(cx - y, cy + x, c); px(cx + y, cy - x, c); px(cx - y, cy - x, c);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
}

void mb_circfill(int cx, int cy, int r, int c) {
  int x = r, y = 0, err = 1 - r;
  while (x >= y) {
    hline(cx - x, cx + x, cy + y, c); hline(cx - x, cx + x, cy - y, c);
    hline(cx - y, cx + y, cy + x, c); hline(cx - y, cx + y, cy - x, c);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
}

int mb_text(const char *s, int x, int y, int c, int scale) {
  if (scale < 1) scale = 1;
  int x0 = x, maxw = 0;
  for (; *s; s++) {
    unsigned ch = (unsigned char)*s;
    if (ch == '\n') { if (x - x0 > maxw) maxw = x - x0; x = x0; y += 8 * scale; continue; }
    if (ch > 127) ch = '?';
    const uint8_t *g = mb_font8x8[ch];
    for (int j = 0; j < 8; j++)
      for (int i = 0; i < 8; i++)
        if (g[j] & (1 << i)) {
          if (scale == 1) px(x + i, y + j, c);
          else mb_rectfill(x + i * scale, y + j * scale, scale, scale, c);
        }
    x += 8 * scale;
  }
  if (x - x0 > maxw) maxw = x - x0;
  return maxw;
}

static void tile_draw(int n, int x, int y, int flipx, int flipy, int scale) {
  if (n < 0 || n >= MB_TILES) return;
  const uint8_t *t = &MB->tiles[n * MB_TILE_BYTES];
  for (int j = 0; j < 8; j++)
    for (int i = 0; i < 8; i++) {
      uint8_t c = t[(flipy ? 7 - j : j) * 8 + (flipx ? 7 - i : i)];
      if (MB->transparent[c]) continue;
      if (scale == 1) px(x + i, y + j, c);
      else mb_rectfill(x + i * scale, y + j * scale, scale, scale, c);
    }
}

/* Sprite n is the top-left tile; w,h in tiles, taken from the 16-tile-wide sheet. */
void mb_spr(int n, int x, int y, int w, int h, int flipx, int flipy, int scale) {
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

void mb_map(int cx, int cy, int cw, int ch, int sx, int sy) {
  for (int j = 0; j < ch; j++) {
    int my = cy + j;
    if (my < 0 || my >= MB_MAP_H) continue;
    for (int i = 0; i < cw; i++) {
      int mx = cx + i;
      if (mx < 0 || mx >= MB_MAP_W) continue;
      int t = MB->map[my * MB_MAP_W + mx];
      if (t) tile_draw(t, sx + i * 8, sy + j * 8, 0, 0, 1);
    }
  }
}

void mb_to_rgba(uint32_t *out) {
  uint32_t lut[256];
  for (int i = 0; i < 256; i++) {
    const uint8_t *p = &MB->palette[i * 3];
    lut[i] = 0xFF000000u | ((uint32_t)p[2] << 16) | ((uint32_t)p[1] << 8) | p[0];
  }
  for (int i = 0; i < MB_W * MB_H; i++) out[i] = lut[MB->screen[i]];
}

void mb_to_rgb565(uint16_t *out) {
  uint16_t lut[256];
  for (int i = 0; i < 256; i++) {
    const uint8_t *p = &MB->palette[i * 3];
    lut[i] = (uint16_t)(((p[0] & 0xF8) << 8) | ((p[1] & 0xFC) << 3) | (p[2] >> 3));
  }
  for (int i = 0; i < MB_W * MB_H; i++) out[i] = lut[MB->screen[i]];
}

/* ---------------- input ---------------- */

void mb_set_input(uint16_t mask, const uint8_t *press) {
  MB->btn_prev = MB->btn;
  MB->btn = mask;
  for (int i = 0; i < MB_NUM_BUTTONS; i++) {
    MB->press[i] = press ? press[i] : ((mask >> i) & 1 ? 255 : 0);
    if ((mask >> i) & 1) { if (MB->hold[i] < 65535) MB->hold[i]++; }
    else MB->hold[i] = 0;
  }
}

int mb_btn(int i) { return i >= 0 && i < MB_NUM_BUTTONS && ((MB->btn >> i) & 1); }

/* pressed this frame, then auto-repeat after 15 frames every 4 frames */
int mb_btnp(int i) {
  if (i < 0 || i >= MB_NUM_BUTTONS) return 0;
  int h = MB->hold[i];
  if (h == 1) return 1;
  return h > 15 && ((h - 15) % 4) == 0;
}

/* ---------------- rng ---------------- */

void mb_srand(uint64_t seed) { MB->rng = seed ? seed : 0x9E3779B97F4A7C15ull; }

uint32_t mb_rand32(void) {
  uint64_t x = MB->rng;
  x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
  MB->rng = x;
  return (uint32_t)((x * 0x2545F4914F6CDD1Dull) >> 32);
}

/* ---------------- audio ---------------- */

void mb_sfx(int ch, float freq, int wave, float vol, int frames, float pan, float slide) {
  if (ch < 0 || ch >= MB_CHANNELS) return;
  mb_voice *v = &MB->voice[ch];
  v->freq = freq;
  v->wave = wave;
  v->vol = vol < 0 ? 0 : vol > 1 ? 1 : vol;
  v->pan = pan < -1 ? -1 : pan > 1 ? 1 : pan;
  v->len = frames * (MB_SAMPLE_RATE / MB_FPS);
  v->pos = 0;
  v->slide = slide / (float)MB_SAMPLE_RATE;
  if (!v->noise) v->noise = 0x1234567u + (uint32_t)ch;
}

void mb_audio_render(float *out, int frames) {
  memset(out, 0, sizeof(float) * 2 * (size_t)frames);
  for (int c = 0; c < MB_CHANNELS; c++) {
    mb_voice *v = &MB->voice[c];
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
      float np = p + v->freq / (float)MB_SAMPLE_RATE;
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
    float s = out[i] * MB->master_vol * 2.f;
    out[i] = s > 1 ? 1 : s < -1 ? -1 : s;
  }
}
