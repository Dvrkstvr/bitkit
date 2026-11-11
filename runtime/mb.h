/*
 * MiniBoi runtime core (platform independent).
 * The same C code runs on the ESP32-S3 device and in the browser (WASM).
 * MIT License - see LICENSE.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>

#define MB_W 320
#define MB_H 240
#define MB_TILES 512          /* 8x8 tiles in the sprite sheet */
#define MB_TILE_BYTES 64      /* 1 byte per pixel (palette index) */
#define MB_MAP_W 256
#define MB_MAP_H 128
#define MB_CHANNELS 8
#define MB_SAMPLE_RATE 44100
#define MB_FPS 60

/* Buttons. Bit index in the button mask and index for btn()/press(). */
enum {
  MB_LEFT = 0, MB_RIGHT, MB_UP, MB_DOWN,
  MB_A, MB_B, MB_X, MB_Y,
  MB_L, MB_R, MB_START, MB_SELECT,
  MB_NUM_BUTTONS
};

typedef struct {
  float freq;      /* Hz, 0 = silent */
  float phase;
  float vol;       /* 0..1 */
  float pan;       /* -1..1 */
  int wave;        /* 0 square, 1 triangle, 2 saw, 3 noise, 4 sine, 5 pulse25 */
  int len;         /* samples total */
  int pos;         /* samples played */
  float slide;     /* Hz per sample */
  uint32_t noise;
} mb_voice;

typedef struct {
  /* --- cart memory (edited by the studio) --- */
  uint8_t palette[256 * 3];             /* RGB888 */
  uint8_t tiles[MB_TILES * MB_TILE_BYTES];
  uint8_t flags[MB_TILES];
  uint16_t map[MB_MAP_W * MB_MAP_H];

  /* --- video --- */
  uint8_t screen[MB_W * MB_H];          /* indexed framebuffer */

  /* --- draw state --- */
  int cam_x, cam_y;
  int clip_x0, clip_y0, clip_x1, clip_y1; /* inclusive-exclusive */
  uint8_t draw_pal[256];
  uint8_t transparent[256];

  /* --- input --- */
  uint16_t btn, btn_prev;
  uint8_t press[MB_NUM_BUTTONS];        /* analog 0..255 */
  uint16_t hold[MB_NUM_BUTTONS];        /* frames held, for btnp repeat */

  /* --- time / rng --- */
  uint32_t frame;
  uint64_t rng;

  /* --- audio --- */
  mb_voice voice[MB_CHANNELS];
  float master_vol;
} mb_machine;

extern mb_machine *MB;

/* core */
void mb_machine_init(mb_machine *m);
void mb_reset_draw_state(void);
void mb_default_palette(uint8_t *pal);

/* gfx */
void mb_cls(int c);
void mb_pset(int x, int y, int c);
int  mb_pget(int x, int y);
void mb_line(int x0, int y0, int x1, int y1, int c);
void mb_rect(int x, int y, int w, int h, int c);
void mb_rectfill(int x, int y, int w, int h, int c);
void mb_circ(int cx, int cy, int r, int c);
void mb_circfill(int cx, int cy, int r, int c);
int  mb_text(const char *s, int x, int y, int c, int scale);
void mb_spr(int n, int x, int y, int w, int h, int flipx, int flipy, int scale);
void mb_map(int cx, int cy, int cw, int ch, int sx, int sy);
void mb_to_rgba(uint32_t *out);       /* for hosts that want RGBA8888 */
void mb_to_rgb565(uint16_t *out);     /* for the ST7789 on device */

/* input: call once per frame before update */
void mb_set_input(uint16_t mask, const uint8_t *press);
int  mb_btn(int i);
int  mb_btnp(int i);

/* rng (deterministic, xorshift64*) */
void mb_srand(uint64_t seed);
uint32_t mb_rand32(void);

/* audio */
void mb_sfx(int ch, float freq, int wave, float vol, int frames, float pan, float slide);
void mb_audio_render(float *out, int frames); /* interleaved stereo */

/* lua glue */
typedef void (*mb_log_fn)(const char *msg, int is_error);
void mb_set_logger(mb_log_fn fn);
int  mb_lua_load(const char *code);   /* 0 ok, else error (see mb_lua_error) */
int  mb_lua_frame(void);              /* runs _update + _draw. 0 ok */
const char *mb_lua_error(void);
void mb_lua_close(void);
