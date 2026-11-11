/*
 * BitKit runtime core (platform independent).
 * The same C code runs on the ESP32-S3 device and in the browser (WASM).
 * MIT License - see LICENSE.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>

#define BK_W 320
#define BK_H 240
#define BK_TILES 512          /* 8x8 tiles in the sprite sheet */
#define BK_TILE_BYTES 64      /* 1 byte per pixel (palette index) */
#define BK_MAP_W 256
#define BK_MAP_H 128
#define BK_CHANNELS 8
#define BK_SAMPLE_RATE 44100
#define BK_FPS 60
#define BK_SAVE_MAX 4096
#define BK_MAX_PLAYERS 8      /* players in one game: linked Bits, or several on one screen */
#define BK_NET_VALS 8         /* numbers in one network event */
#define BK_NET_OUT 16         /* events a cart can send per frame */
#define BK_NET_IN 64          /* events waiting to be read */

/* Buttons. Bit index in the button mask and index for btn()/press(). */
enum {
  BK_LEFT = 0, BK_RIGHT, BK_UP, BK_DOWN,
  BK_A, BK_B, BK_X, BK_Y,
  BK_L, BK_R, BK_START, BK_SELECT,
  BK_NUM_BUTTONS
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
} bk_voice;

typedef struct {
  /* --- cart memory (edited by the studio) --- */
  uint8_t palette[256 * 3];             /* RGB888 */
  uint8_t tiles[BK_TILES * BK_TILE_BYTES];
  uint8_t flags[BK_TILES];
  uint16_t map[BK_MAP_W * BK_MAP_H];
  uint8_t height[(BK_MAP_W + 1) * (BK_MAP_H + 1)]; /* floor height at each tile corner (pixels), for floorh(); cleared when a cart loads */

  /* --- video --- */
  uint8_t screen[BK_W * BK_H];          /* indexed framebuffer */

  /* --- draw state --- */
  int cam_x, cam_y;
  int clip_x0, clip_y0, clip_x1, clip_y1; /* inclusive-exclusive */
  uint8_t draw_pal[256];
  uint8_t transparent[256];

  /* --- input: one pad per player. In a linked game every device runs the same frames with everyone's input. --- */
  struct {
    uint16_t btn, btn_prev;
    uint8_t press[BK_NUM_BUTTONS];      /* analog 0..255 */
    uint16_t hold[BK_NUM_BUTTONS];      /* frames held, for btnp repeat */
    uint16_t ignore;                    /* buttons still held from before the cart started: ignored until released */
    uint8_t fresh;                      /* set at cart start: the first input decides what to ignore */
  } pad[BK_MAX_PLAYERS];
  int32_t players;                      /* players in this game, 1..8 */
  int32_t me;                           /* this device's player (1..8), or 0 when everyone shares this screen */

  /* --- player tracking (studio draws the route on the map) --- */
  int32_t track[3];                     /* x, y, set this frame */

  /* --- system requests to the host (launcher) --- */
  int32_t sys[2];                       /* command (0 none, 1 launch, 2 home, 3 edit, 4 load level map), argument; set this frame */

  /* --- network events (net_send/net_recv): for big games (10-20 Bits) that don't run in lockstep.
         Each slot is {from, count, v[BK_NET_VALS]}. The cart appends to out; the host sends them after the
         frame (ESP-NOW broadcast on the device) and sets out_n = 0. The host fills in[] before a frame;
         the cart reads them from in_r up to in_n. id is this Bit's network id (0 = no network). --- */
  struct {
    int32_t id, out_n, in_n, in_r;
    int32_t out[BK_NET_OUT][BK_NET_VALS + 2];
    int32_t in[BK_NET_IN][BK_NET_VALS + 2];
  } net;

  /* --- save data: the cart writes it with save(), the host keeps it per cart (browser storage / flash) --- */
  struct { int32_t len; int32_t dirty; char data[BK_SAVE_MAX]; } save;   /* len -1 = nothing saved */

  /* --- time / rng --- */
  uint32_t frame;
  uint64_t rng;

  /* --- audio --- */
  bk_voice voice[BK_CHANNELS];
  float master_vol;
} bk_machine;

extern bk_machine *BK;

/* core */
void bk_machine_init(bk_machine *m);
void bk_reset_draw_state(void);
void bk_default_palette(uint8_t *pal);

/* gfx */
void bk_cls(int c);
void bk_pset(int x, int y, int c);
int  bk_pget(int x, int y);
void bk_line(int x0, int y0, int x1, int y1, int c);
void bk_rect(int x, int y, int w, int h, int c);
void bk_rectfill(int x, int y, int w, int h, int c);
void bk_circ(int cx, int cy, int r, int c);
void bk_circfill(int cx, int cy, int r, int c);
int  bk_text(const char *s, int x, int y, int c, int scale);
void bk_spr(int n, int x, int y, int w, int h, int flipx, int flipy, int scale);
void bk_map(int cx, int cy, int cw, int ch, int sx, int sy);
/* 2.5D: a perspective floor drawn from the tile map (SNES-style ground plane) and scaled sprites.
   Camera: world position (pixels), heading angle (radians, 0 = +x, turning toward +y), height above
   the floor, horizon row on screen and focal length (pixels). bk_floor() fills the rows below the
   horizon inside the clip rect; bk_project() maps a world point with the same camera to the screen. */
typedef struct { float x, y, angle, height, focal, cx; int horizon; float c, s; int valid, hills; } bk_floor_cam;
void bk_floor(float x, float y, float angle, float height, int horizon, float focal, int outside, int step);
int  bk_project(float wx, float wy, float wz, float *sx, float *sy, float *scale, float *dist); /* 0 = behind the camera */
/* Hills: height[] holds a height per tile corner; bk_hget() blends them. bk_floorh() draws the floor with
   hills (column ray-marching, like voxel terrain) with the camera at absolute height camz. After it,
   bk_depth(z) makes bk_sspr() hide sprite pixels behind hills nearer than z (bk_depth(-1) turns it off). */
float bk_hget(float x, float y);
void bk_floorh(float x, float y, float angle, float camz, int horizon, float focal, int outside, int step);
void bk_depth(float z);
void bk_sspr(int n, float x, float y, int w, int h, float sc, int flipx, int flipy);
void bk_to_rgba(uint32_t *out);       /* for hosts that want RGBA8888 */
void bk_to_rgb565(uint16_t *out);     /* for the ST7789 on device */

/* input: call once per frame before update */
void bk_set_input(int player, uint16_t mask, const uint8_t *press);   /* player 0..3 */
int  bk_btn(int player, int i);
int  bk_btnp(int player, int i);

/* rng (deterministic, xorshift64*) */
void bk_srand(uint64_t seed);
uint32_t bk_rand32(void);

/* audio */
void bk_sfx(int ch, float freq, int wave, float vol, int frames, float pan, float slide);
void bk_audio_render(float *out, int frames); /* interleaved stereo */

/* lua glue */
typedef void (*bk_log_fn)(const char *msg, int is_error);
void bk_set_logger(bk_log_fn fn);
int  bk_lua_load(const char *code);   /* 0 ok, else error (see bk_lua_error) */
int  bk_lua_load_ex(const char *entity_data, const char *code); /* entity_data: Lua chunk from the studio, may be NULL */
int  bk_lua_frame(void);              /* runs _update + _draw. 0 ok */
const char *bk_lua_error(void);
void bk_lua_close(void);
