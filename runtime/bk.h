/*
 * BitKit runtime core (platform independent).
 * The same C code runs on the ESP32-S3 device and in the browser (WASM).
 * MIT License - see LICENSE.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>

/* big static arrays go in external RAM on the device (EXT_RAM_BSS_ATTR on the ESP32-S3); nothing on the web */
#ifndef BK_BIG_BSS
#define BK_BIG_BSS
#endif
#define BK_W 320
#define BK_H 240
#define BK_TILES 512          /* 8x8 tiles in the sprite sheet */
#define BK_TILE_BYTES 64      /* 1 byte per pixel (palette index) */
#define BK_MAP_W 256
#define BK_MAP_H 128
#define BK_CHANNELS 8
#define BK_SAMPLE_RATE 44100
#define BK_FPS 60
#define BK_SAVE_MAX 16384
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
  int held;        /* 1 = voice(): no decay, the volume follows vol smoothly (music player); 0 = sfx() */
  float gain;      /* held voices: the volume right now, gliding to vol */
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

  /* --- display shader: applied while the screen is turned into colours (bk_to_rgba / bk_to_rgb565), so it works
         in full colour, never changes screen[] and costs the game nothing. All zero = off. Set by display{} in Lua.
         Percent values: scan, vignette, curve, blur, grain 0..100; bright, contrast, sat, warm -100..100. split in pixels 0..4. --- */
  struct { int32_t scan, vignette, curve, split, blur, grain, bright, contrast, sat, warm; } display;

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
void bk_trifill(int x0, int y0, int x1, int y1, int x2, int y2, int c);
void bk_quadfill(int x0, int y0, int x1, int y1, int x2, int y2, int x3, int y3, int c);
void bk_shade(float k);   /* darken the screen inside the clip rectangle: 0 nothing, 1 black */
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
/* Screen shaders: run in _draw on what has been drawn so far, inside the clip rectangle (so split screens work).
   Colour ones go through the palette (results are palette colours); moving ones push pixels around. */
void bk_tint(int c, float k);                     /* blend toward palette colour c: 0 nothing, 1 all c */
void bk_fog(int c, int y0, int y1, float a0, float a1); /* tint by a0 at row y0 sliding to a1 at row y1; other rows untouched */
void bk_dither(int c, float k);                   /* ordered (Bayer 4x4) dissolve to colour c: 0 nothing, 1 all c */
void bk_remap(const uint8_t *lut);                /* every colour i becomes lut[i] */
void bk_wave(float amp, float len, float phase, int vertical); /* sine shift of rows (or columns) */
void bk_ripple(int x, int y, float r, float amp, float width); /* a ring shockwave around x,y (camera applies) */
void bk_pixelate(int size);                       /* mosaic blocks */
void bk_glitch(float k, uint32_t seed);           /* torn rows and colour slips; seed picks the pattern */
void bk_row_shift(int y, int dx);                 /* raster(): slide one row sideways */
void bk_row_tint(int y, int c, float k);          /* raster(): tint one row */

/* Sprite shaders: while on, every spr() and sspr() goes through them (set with sprfx{} in Lua, like pal()). */
typedef struct {
  int on;
  int outline;                 /* outline colour, -1 none */
  int flash; float flash_k;    /* blend toward colour flash by flash_k (0..1) */
  float light;                 /* 0..1: lit rim on the side facing the light, shade on the far side */
  float lx, ly;                /* direction the light comes from (screen), used when light_at is 0 */
  int light_at; float lpx, lpy;/* or: light comes from this world point (a torch), per sprite */
  float dissolve;              /* 0..1: Bayer dissolve */
  int silhouette;              /* draw every pixel in this colour, -1 none */
  int shadow, sdx, sdy;        /* drop shadow colour (-1 none) and offset in sprite pixels */
  int (*fn)(int x, int y, int c, int w, int h); /* your own shader: colour for sprite pixel x, y (c = -1 transparent); -1 hides */
} bk_sprfx_t;
extern bk_sprfx_t bk_sprfx;
void bk_sprfx_reset(void);

void bk_display_reset(void);
void bk_font(int style, int outline);           /* text style: 0 classic 1 bold 2 slant 3 slant bold; outline colour or -1 */
int  bk_display_preset(const char *name);         /* 0 = unknown name */
void bk_to_rgba(uint32_t *out);       /* for hosts that want RGBA8888 */
void bk_to_rgb565(uint16_t *out);     /* for the ST7789 on device */
void bk_graded_palette(uint8_t *rgb); /* the palette with display{} colour grading (bright, contrast, sat, warm) */
/* capture (bk_capture.c): photos and clips of screen[], for the Share hub. Output goes through write(ctx, data, len),
   which returns 0 when it worked (an fwrite to the SD card on the device, a growing buffer in the browser). */
typedef int (*bk_write_fn)(void *ctx, const void *data, int len);
int  bk_shot_png(int scale, bk_write_fn write, void *ctx);  /* PNG photo, scale 1..4. 0 ok */
int  bk_clip_begin(bk_write_fn write, void *ctx);          /* start an animated GIF clip. 0 ok */
int  bk_clip_frame(int frames60);     /* add the screen; it stays frames60 sixtieths of a second (host passes 2 at 30 fps) */
int  bk_clip_end(void);               /* finish the GIF: frames written, or -1 */
int  bk_clip_recording(void);
int  bk_clip_seconds(void);
/* The same in bands, for a panel fed from small DMA buffers: bk_present_begin() once per frame (after any change to
   BK->display or the palette), then bk_present_rgb565(out, y0, y1) for rows y0..y1-1 into out[0..]. */
void bk_present_begin(void);
void bk_present_rgb565(uint16_t *out, int y0, int y1);

/* input: call once per frame before update */
void bk_set_input(int player, uint16_t mask, const uint8_t *press);   /* player 0..3 */
int  bk_btn(int player, int i);
int  bk_btnp(int player, int i);

/* rng (deterministic, xorshift64*) */
void bk_srand(uint64_t seed);
uint32_t bk_rand32(void);

/* audio */
void bk_sfx(int ch, float freq, int wave, float vol, int frames, float pan, float slide);
void bk_voice_set(int ch, float freq, int wave, float vol, float pan);
void bk_audio_render(float *out, int frames); /* interleaved stereo */

/* lua glue */
typedef void (*bk_log_fn)(const char *msg, int is_error);
void bk_set_logger(bk_log_fn fn);
int  bk_lua_load(const char *code);   /* 0 ok, else error (see bk_lua_error) */
int  bk_lua_load_ex(const char *entity_data, const char *code); /* entity_data: Lua chunk from the studio, may be NULL */
int  bk_lua_frame(void);              /* runs _update + _draw. 0 ok */
const char *bk_lua_error(void);
int  bk_lua_eval(const char *code);    /* run a chunk in the loaded cart's state (editors talk to their player). 0 ok */
void bk_lua_close(void);

/* Several carts at once (the device keeps a paused game alive in PSRAM while the home screen runs).
   bk_lua_set_alloc picks the allocator for Lua states made from now on (NULL = realloc/free).
   bk_ctx_take moves the running cart out of the runtime (its Lua state stays alive) and leaves the runtime empty;
   bk_ctx_put closes whatever runs now and brings a taken cart back. Point BK at the cart's own machine around these. */
typedef void *(*bk_alloc_fn)(void *ud, void *ptr, size_t osize, size_t nsize);
void bk_lua_set_alloc(bk_alloc_fn fn, void *ud);
typedef struct { void *L; int sfx_ref; bk_sprfx_t sprfx; bk_floor_cam fcam; float depth_z; } bk_ctx;
void bk_ctx_take(bk_ctx *c);
void bk_ctx_put(const bk_ctx *c);
void bk_core_ctx_take(bk_ctx *c);     /* the graphics part (bk_core.c); bk_ctx_take calls it */
void bk_core_ctx_put(const bk_ctx *c);
