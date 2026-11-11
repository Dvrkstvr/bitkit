/*
 * BitKit emulators: Game Boy, Game Boy Color and NES (see bk_emu.h).
 * This file pulls the cores in (one translation unit, so a firmware build only has to add bk_emu.c),
 * maps their pictures onto the Bit's 320x240 indexed screen, mixes their sound into the Bit's audio,
 * keeps save states and battery saves, and gives the Lua app its emu_* functions.
 * The NES sound chip (2 pulses, triangle, noise, DMC) is BitKit's own code.
 * MIT License - see LICENSE.
 */
#include "bk.h"
#include "bk_emu.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "lua.h"
#include "lauxlib.h"

/* ------------------------------------------------------------------ sound: one ring of stereo samples */
#define RING 8192                                   /* stereo frames, a power of two */
static int16_t ring[RING * 2];
static volatile uint32_t ring_w, ring_r;            /* the emulator writes, the audio side reads */
static int ring_mute;                               /* fast-forward frames make no sound */

static void ring_push(int16_t l, int16_t r) {
  if (ring_mute) return;
  uint32_t w = ring_w;
  if (w - ring_r >= RING - 1) return;
  ring[(w & (RING - 1)) * 2] = l; ring[(w & (RING - 1)) * 2 + 1] = r;
  ring_w = w + 1;
}
/* The consoles run at 59.7 (GB) and 60.1 (NES) frames a second and the Bit at 60, and the sound is read at
   its own pace: make a little less sound when much is waiting and a little more when little is, so the delay
   stays small (about 1600 samples) and never runs dry. 1.0 = as made; the range is +-1%. */
#define RING_AIM 1600
static float ring_rate(void) {
  float d = ((float)(ring_w - ring_r) - RING_AIM) / RING_AIM;
  if (d > 1) d = 1;
  if (d < -1) d = -1;
  return 1.f - 0.01f * d;
}
/* one frame of stereo sound, stretched to the rate above (linear) */
static void ring_push_frame(const int16_t *in, int n) {
  int out = (int)(n * ring_rate() + 0.5f);
  if (out < 2 || n < 2) return;
  for (int i = 0; i < out; i++) {
    float p = (float)i * (float)(n - 1) / (float)(out - 1);
    int k = (int)p; float f = p - (float)k;
    if (k >= n - 1) { k = n - 2; f = 1; }
    ring_push((int16_t)(in[k * 2] + (in[k * 2 + 2] - in[k * 2]) * f), (int16_t)(in[k * 2 + 1] + (in[k * 2 + 3] - in[k * 2 + 1]) * f));
  }
}

void bk_emu_audio_mix(float *out, int frames) {
  uint32_t r = ring_r, avail = ring_w - r;
  int n = frames < (int)avail ? frames : (int)avail;
  for (int i = 0; i < n; i++, r++) {
    out[i * 2] += ring[(r & (RING - 1)) * 2] * (1.f / 65536.f);
    out[i * 2 + 1] += ring[(r & (RING - 1)) * 2 + 1] * (1.f / 65536.f);
  }
  ring_r = r;
}

/* the cores are kept as their authors wrote them: their own warnings stay quiet */
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wtype-limits"
#pragma GCC diagnostic ignored "-Wsign-compare"
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-variable"
#pragma GCC diagnostic ignored "-Wimplicit-fallthrough"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#endif
#if defined(__clang__)
#pragma clang diagnostic ignored "-Wtypedef-redefinition"
#endif
/* ------------------------------------------------------------------ Game Boy / Game Boy Color: Walnut-CGB */
#define ENABLE_SOUND 1
#define ENABLE_LCD 1
#define MINIGB_APU_AUDIO_FORMAT_S16SYS
#define AUDIO_SAMPLE_RATE 44100
#include "../third_party/walnut_cgb/minigb_apu.h"
static struct minigb_apu_ctx gb_apu;
uint8_t audio_read(uint16_t addr) { return minigb_apu_audio_read(&gb_apu, addr); }
void audio_write(uint16_t addr, uint8_t val) { minigb_apu_audio_write(&gb_apu, addr, val); }
struct gb_s;   /* walnut_cgb.h names it in prototypes before defining it */
#include "../third_party/walnut_cgb/walnut_cgb.h"
#undef MAX
#undef MIN
#include "../third_party/walnut_cgb/minigb_apu.c"

/* ------------------------------------------------------------------ NES: agnes + BitKit's sound chip */
struct agnes;
static void nes_apu_write(struct agnes *ag, uint16_t addr, uint8_t val);
static uint8_t nes_apu_read(struct agnes *ag, uint16_t addr);
#define AGNES_APU_WRITE(ag, addr, val) nes_apu_write((ag), (addr), (val))
#define AGNES_APU_READ(ag, addr) nes_apu_read((ag), (addr))
#include "../third_party/agnes/agnes.c"

#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

/* ------------------------------------------------------------------ the emulator's state */
typedef struct {
  int kind;                       /* BK_EMU_* */
  char name[96];                  /* the host's name for the game (saves go by it) */
  char title[20];                 /* the title in the ROM header */
  uint8_t *rom; uint32_t rom_len;
  int battery;                    /* the cartridge keeps its RAM */
  uint8_t *sram; uint32_t sram_len;
  int sram_dirty, sram_quiet;     /* written since the last send; frames since the last write */
  uint32_t sram_hash;             /* NES: no write hook, so the RAM is hashed now and then */
  int failed;
  int dmg_pal;
  struct gb_s *gb;
  uint8_t gbfb[144][160];         /* Game Boy picture: palette slot per pixel (0..63) */
  agnes_t *nes;
  uint8_t *state; uint32_t state_len;
} emu_t;
static emu_t E;
static bk_emu_host host;
static char err[96];

void bk_emu_set_host(const bk_emu_host *h) { if (h) host = *h; else memset(&host, 0, sizeof(host)); }
const char *bk_emu_error(void) { return err; }
int bk_emu_kind(void) { return E.kind; }
const char *bk_emu_name(void) { return E.name; }

/* ------------------------------------------------------------------ Game Boy glue */
static uint8_t gb_rom_read(struct gb_s *gb, const uint_fast32_t a) { (void)gb; return a < E.rom_len ? E.rom[a] : 0xFF; }
static uint16_t gb_rom_read_16bit(struct gb_s *gb, const uint_fast32_t a) {
  (void)gb;
  if (a + 1 >= E.rom_len) return (uint16_t)(gb_rom_read(gb, a) | (gb_rom_read(gb, a + 1) << 8));
  const uint8_t *s = E.rom + a;
  return (uint16_t)(s[0] | (s[1] << 8));
}
static uint32_t gb_rom_read_32bit(struct gb_s *gb, const uint_fast32_t a) {
  (void)gb;
  if (a + 3 >= E.rom_len) return (uint32_t)gb_rom_read_16bit(gb, a) | ((uint32_t)gb_rom_read_16bit(gb, a + 2) << 16);
  const uint8_t *s = E.rom + a;
  return (uint32_t)s[0] | ((uint32_t)s[1] << 8) | ((uint32_t)s[2] << 16) | ((uint32_t)s[3] << 24);
}
static uint8_t gb_cart_ram_read(struct gb_s *gb, const uint_fast32_t a) { (void)gb; return a < E.sram_len ? E.sram[a] : 0xFF; }
static void gb_cart_ram_write(struct gb_s *gb, const uint_fast32_t a, const uint8_t v) {
  (void)gb;
  if (a < E.sram_len && E.sram[a] != v) { E.sram[a] = v; E.sram_dirty = 1; E.sram_quiet = 0; }
}
static void gb_error(struct gb_s *gb, const enum gb_error_e e, const uint16_t addr) {
  (void)gb; (void)addr;
  if (e == GB_INVALID_OPCODE) E.failed = 1;    /* reads and writes to odd places are harmless */
}
static void gb_line(struct gb_s *gb, const uint8_t *px, const uint_fast8_t line) {
  if (line >= 144) return;
  uint8_t *d = E.gbfb[line];
  if (gb->cgb.cgbMode) { for (int x = 0; x < 160; x++) d[x] = px[x] & 63; }
  else for (int x = 0; x < 160; x++) { int layer = (px[x] >> 4) & 3; d[x] = (uint8_t)((layer > 2 ? 2 : layer) * 4 + (px[x] & 3)); }
}

/* Game Boy screens: 4 shades from light to dark, for the background, sprites 0 and sprites 1 */
static const uint32_t DMG[BK_EMU_DMG_PALETTES][12] = {
  /* pea green */ {0xe0f8d0, 0x88c070, 0x346856, 0x081820, 0xe0f8d0, 0x88c070, 0x346856, 0x081820, 0xe0f8d0, 0x88c070, 0x346856, 0x081820},
  /* pocket */    {0xc4cfa1, 0x8b956d, 0x4d533c, 0x1f1f1f, 0xc4cfa1, 0x8b956d, 0x4d533c, 0x1f1f1f, 0xc4cfa1, 0x8b956d, 0x4d533c, 0x1f1f1f},
  /* grey */      {0xf4f4f4, 0xa8a8a8, 0x545454, 0x0c0c0c, 0xf4f4f4, 0xa8a8a8, 0x545454, 0x0c0c0c, 0xf4f4f4, 0xa8a8a8, 0x545454, 0x0c0c0c},
  /* colour */    {0xf8f8f8, 0xf8a060, 0xa84030, 0x201010, 0xf8f8f8, 0x70b8f8, 0x3058a8, 0x101828, 0xf8f8f8, 0xa8d870, 0x487848, 0x182018},
  /* amber */     {0xfff0c8, 0xf0b048, 0x9c5418, 0x2c1004, 0xfff0c8, 0xf0b048, 0x9c5418, 0x2c1004, 0xfff0c8, 0xf0b048, 0x9c5418, 0x2c1004},
  /* night */     {0x1c1c30, 0x50508c, 0x9c9cd0, 0xecebff, 0x1c1c30, 0x50508c, 0x9c9cd0, 0xecebff, 0x1c1c30, 0x50508c, 0x9c9cd0, 0xecebff},
};
static void set_rgb(int i, uint32_t c) {
  uint8_t *p = &BK->palette[(BK_EMU_PAL0 + i) * 3];
  p[0] = (uint8_t)(c >> 16); p[1] = (uint8_t)(c >> 8); p[2] = (uint8_t)c;
}
void bk_emu_dmg_palette(int n) {
  if (n < 0 || n >= BK_EMU_DMG_PALETTES) n = 0;
  E.dmg_pal = n;
  if (E.kind == BK_EMU_GB) for (int i = 0; i < 12; i++) set_rgb(i, DMG[n][i]);
}
static void gbc_palette(void) {   /* the colours this frame used (RGB565 in Walnut) */
  for (int i = 0; i < 64; i++) {
    uint16_t c = E.gb->cgb.fixPalette[i];
    int r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    uint8_t *p = &BK->palette[(BK_EMU_PAL0 + i) * 3];
    p[0] = (uint8_t)(r * 255 / 31); p[1] = (uint8_t)(g * 255 / 63); p[2] = (uint8_t)(b * 255 / 31);
  }
}
static int gb_has_battery(uint8_t t) {
  switch (t) { case 0x03: case 0x06: case 0x09: case 0x0D: case 0x0F: case 0x10: case 0x13: case 0x1B: case 0x1E: case 0x22: case 0xFF: return 1; }
  return 0;
}
static int gb_start(void) {
  if (E.rom_len < 0x150) { strcpy(err, "too small for a Game Boy ROM"); return 0; }
  if (E.rom[0x148] > 8 || E.rom[0x149] > 5) { strcpy(err, "the ROM header is broken"); return 0; }
  E.gb = (struct gb_s *)calloc(1, sizeof(struct gb_s));
  if (!E.gb) { strcpy(err, "not enough memory"); return 0; }
  enum gb_init_error_e r = gb_init(E.gb, gb_rom_read, gb_rom_read_16bit, gb_rom_read_32bit, gb_cart_ram_read, gb_cart_ram_write, gb_error, NULL);
  if (r == GB_INIT_INVALID_CHECKSUM) { strcpy(err, "the ROM header checksum is wrong"); return 0; }
  if (r != GB_INIT_NO_ERROR) { strcpy(err, "this cartridge type is not supported"); return 0; }
  size_t ram = 0;
  gb_get_save_size_s(E.gb, &ram);
  E.battery = gb_has_battery(E.rom[0x147]);
  E.sram_len = (uint32_t)ram;
  if (ram) { E.sram = (uint8_t *)calloc(1, ram); if (!E.sram) { strcpy(err, "not enough memory"); return 0; } }
  gb_init_lcd(E.gb, gb_line);
  minigb_apu_audio_init(&gb_apu);
  { time_t t = time(NULL); struct tm *tm = localtime(&t); if (tm) gb_set_rtc(E.gb, tm); }
  gb_get_rom_name(E.gb, E.title);
  E.kind = E.gb->cgb.cgbMode ? BK_EMU_GBC : BK_EMU_GB;
  memset(E.gbfb, 0, sizeof(E.gbfb));
  bk_emu_dmg_palette(E.dmg_pal);
  return E.kind;
}

/* ------------------------------------------------------------------ the NES sound chip */
static const uint8_t LEN[32] = {10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30};
static const uint8_t DUTY[4][8] = {{0, 1, 0, 0, 0, 0, 0, 0}, {0, 1, 1, 0, 0, 0, 0, 0}, {0, 1, 1, 1, 1, 0, 0, 0}, {1, 0, 0, 1, 1, 1, 1, 1}};
static const uint8_t TRI[32] = {15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
static const uint16_t NOISE[16] = {4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068};
static const uint16_t DMCR[16] = {428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54};
#define NES_CPU_HZ 1789773.0

typedef struct { uint8_t start, loop, constant, vol, div, decay; } env_t;
typedef struct {
  uint8_t on, duty, seq, halt, len, sw_on, sw_per, sw_neg, sw_shift, sw_div, sw_reload;
  uint16_t timer; int32_t cnt; env_t env;
} pulse_t;
typedef struct {
  uint8_t on, control, lin_load, lin, lin_reload, len, seq;
  uint16_t timer; int32_t cnt;
} tri_t;
typedef struct {
  uint8_t on, halt, mode, len; uint16_t period, shift; int32_t cnt; env_t env;
} noise_t;
typedef struct {
  uint8_t on, loop, level, buf, buf_full, bits, sh, silent; uint16_t rate, addr, cur, len, left; int32_t cnt;
} dmc_t;
typedef struct {
  pulse_t p[2]; tri_t t; noise_t n; dmc_t d;
  uint8_t mode5, fstep; int32_t fc;   /* frame counter: its step and CPU cycles into the sequence */
  uint64_t cyc;                       /* CPU cycle the sound has been made up to */
  double acc;                         /* CPU cycles toward the next sample */
  float hp_x, hp_y, lp;               /* filters */
} apu_t;
static apu_t A;

static void env_clock(env_t *e) {
  if (e->start) { e->start = 0; e->decay = 15; e->div = e->vol; return; }
  if (e->div) { e->div--; return; }
  e->div = e->vol;
  if (e->decay) e->decay--; else if (e->loop) e->decay = 15;
}
static int env_out(const env_t *e) { return e->constant ? e->vol : e->decay; }
static int sweep_target(const pulse_t *p, int ch) {
  int c = p->timer >> p->sw_shift;
  return p->sw_neg ? p->timer - c - (ch == 0 ? 1 : 0) : p->timer + c;
}
static int pulse_muted(const pulse_t *p, int ch) { return p->timer < 8 || (!p->sw_neg && sweep_target(p, ch) > 0x7FF); }
static void quarter(void) {
  env_clock(&A.p[0].env); env_clock(&A.p[1].env); env_clock(&A.n.env);
  if (A.t.lin_reload) A.t.lin = A.t.lin_load; else if (A.t.lin) A.t.lin--;
  if (!A.t.control) A.t.lin_reload = 0;
}
static void half(void) {
  for (int i = 0; i < 2; i++) {
    pulse_t *p = &A.p[i];
    if (!p->halt && p->len) p->len--;
    if (p->sw_div == 0 && p->sw_on && p->sw_shift && !pulse_muted(p, i)) {
      int t = sweep_target(p, i);
      if (t >= 0) p->timer = (uint16_t)t;
    }
    if (p->sw_div == 0 || p->sw_reload) { p->sw_div = p->sw_per; p->sw_reload = 0; } else p->sw_div--;
  }
  if (!A.t.control && A.t.len) A.t.len--;
  if (!A.n.halt && A.n.len) A.n.len--;
}
static void dmc_restart(void) { A.d.cur = A.d.addr; A.d.left = A.d.len; }
static void advance(int n) {           /* run the channels n CPU cycles */
  for (int i = 0; i < 2; i++) {
    pulse_t *p = &A.p[i];
    int per = (p->timer + 1) * 2;
    p->cnt -= n;
    if (p->cnt <= 0) { int k = (-p->cnt) / per + 1; p->cnt += k * per; p->seq = (uint8_t)((p->seq + k) & 7); }
  }
  if (A.t.timer >= 2 && A.t.len && A.t.lin) {
    int per = A.t.timer + 1;
    A.t.cnt -= n;
    if (A.t.cnt <= 0) { int k = (-A.t.cnt) / per + 1; A.t.cnt += k * per; A.t.seq = (uint8_t)((A.t.seq + k) & 31); }
  }
  A.n.cnt -= n;
  while (A.n.cnt <= 0) {
    A.n.cnt += A.n.period;
    int fb = (A.n.shift & 1) ^ ((A.n.shift >> (A.n.mode ? 6 : 1)) & 1);
    A.n.shift = (uint16_t)((A.n.shift >> 1) | (fb << 14));
  }
  A.d.cnt -= n;
  while (A.d.cnt <= 0) {
    A.d.cnt += A.d.rate;
    if (!A.d.buf_full && A.d.left && E.nes) {          /* fetch the next sample byte */
      A.d.buf = cpu_read8(&E.nes->cpu, A.d.cur); A.d.buf_full = 1;
      A.d.cur = (uint16_t)(A.d.cur == 0xFFFF ? 0x8000 : A.d.cur + 1);
      if (--A.d.left == 0 && A.d.loop) dmc_restart();
    }
    if (A.d.bits == 0) {
      A.d.bits = 8;
      if (A.d.buf_full) { A.d.sh = A.d.buf; A.d.buf_full = 0; A.d.silent = 0; } else A.d.silent = 1;
    }
    if (!A.d.silent) {
      if (A.d.sh & 1) { if (A.d.level <= 125) A.d.level += 2; } else if (A.d.level >= 2) A.d.level -= 2;
    }
    A.d.sh >>= 1; A.d.bits--;
  }
  A.fc += n;
  static const int32_t Q4[4] = {7457, 14913, 22371, 29829}, Q5[5] = {7457, 14913, 22371, 29829, 37281};
  const int32_t *q = A.mode5 ? Q5 : Q4;
  int steps = A.mode5 ? 5 : 4;
  while (A.fstep < steps && A.fc >= q[A.fstep]) {
    int s = A.fstep;
    if (!(A.mode5 && s == 3)) quarter();
    if (s == 1 || s == steps - 1) half();
    if (++A.fstep == steps) { A.fc -= q[steps - 1]; A.fstep = 0; }
  }
}
static float apu_sample(void) {
  int p[2];
  for (int i = 0; i < 2; i++) {
    const pulse_t *c = &A.p[i];
    p[i] = (c->len && !pulse_muted(c, i) && DUTY[c->duty][c->seq]) ? env_out(&c->env) : 0;
  }
  int t = TRI[A.t.seq];
  int nz = (A.n.len && !(A.n.shift & 1)) ? env_out(&A.n.env) : 0;
  float po = (p[0] + p[1]) ? 95.88f / (8128.f / (float)(p[0] + p[1]) + 100.f) : 0.f;
  float tnd = t / 8227.f + nz / 12241.f + A.d.level / 22638.f;
  float to = tnd > 0 ? 159.79f / (1.f / tnd + 100.f) : 0.f;
  float x = po + to;
  A.hp_y = x - A.hp_x + 0.996f * A.hp_y; A.hp_x = x;   /* no DC */
  A.lp += (A.hp_y - A.lp) * 0.6f;                      /* a little softer */
  return A.lp;
}
static double apu_per = NES_CPU_HZ / BK_SAMPLE_RATE;   /* CPU cycles per sample, set once a frame from ring_rate() */
static void apu_catch_up(uint64_t to) {
  const double per = apu_per;
  while (A.cyc < to) {
    double need = per - A.acc;
    uint64_t left = to - A.cyc;
    if ((double)left < need) { advance((int)left); A.acc += (double)left; A.cyc = to; break; }
    int k = (int)need; if (k < 1) k = 1;
    advance(k); A.cyc += (uint64_t)k; A.acc += k - per;
    float s = apu_sample() * 30000.f;
    int16_t v = (int16_t)(s > 32767 ? 32767 : s < -32768 ? -32768 : s);
    ring_push(v, v);
  }
}
static void apu_reset(void) {
  memset(&A, 0, sizeof(A));
  A.n.shift = 1; A.n.period = NOISE[0]; A.d.rate = DMCR[0]; A.d.bits = 8; A.d.silent = 1;
  if (E.nes) A.cyc = E.nes->cpu.cycles;
}
static void nes_apu_write(struct agnes *ag, uint16_t addr, uint8_t v) {
  apu_catch_up(((agnes_t *)ag)->cpu.cycles);
  if (addr < 0x4008) {
    pulse_t *p = &A.p[(addr >> 2) & 1];
    switch (addr & 3) {
      case 0: p->duty = v >> 6; p->halt = p->env.loop = (v >> 5) & 1; p->env.constant = (v >> 4) & 1; p->env.vol = v & 15; break;
      case 1: p->sw_on = v >> 7; p->sw_per = (v >> 4) & 7; p->sw_neg = (v >> 3) & 1; p->sw_shift = v & 7; p->sw_reload = 1; break;
      case 2: p->timer = (uint16_t)((p->timer & 0x700) | v); break;
      case 3: p->timer = (uint16_t)((p->timer & 0xFF) | ((v & 7) << 8)); if (p->on) p->len = LEN[v >> 3]; p->seq = 0; p->env.start = 1; break;
    }
    return;
  }
  switch (addr) {
    case 0x4008: A.t.control = v >> 7; A.t.lin_load = v & 0x7F; break;
    case 0x400A: A.t.timer = (uint16_t)((A.t.timer & 0x700) | v); break;
    case 0x400B: A.t.timer = (uint16_t)((A.t.timer & 0xFF) | ((v & 7) << 8)); if (A.t.on) A.t.len = LEN[v >> 3]; A.t.lin_reload = 1; break;
    case 0x400C: A.n.halt = A.n.env.loop = (v >> 5) & 1; A.n.env.constant = (v >> 4) & 1; A.n.env.vol = v & 15; break;
    case 0x400E: A.n.mode = v >> 7; A.n.period = NOISE[v & 15]; break;
    case 0x400F: if (A.n.on) A.n.len = LEN[v >> 3]; A.n.env.start = 1; break;
    case 0x4010: A.d.loop = (v >> 6) & 1; A.d.rate = DMCR[v & 15]; break;
    case 0x4011: A.d.level = v & 0x7F; break;
    case 0x4012: A.d.addr = (uint16_t)(0xC000 + v * 64); break;
    case 0x4013: A.d.len = (uint16_t)(v * 16 + 1); break;
    case 0x4015:
      A.p[0].on = v & 1; A.p[1].on = (v >> 1) & 1; A.t.on = (v >> 2) & 1; A.n.on = (v >> 3) & 1; A.d.on = (v >> 4) & 1;
      if (!A.p[0].on) A.p[0].len = 0;
      if (!A.p[1].on) A.p[1].len = 0;
      if (!A.t.on) A.t.len = 0;
      if (!A.n.on) A.n.len = 0;
      if (!A.d.on) A.d.left = 0; else if (!A.d.left) dmc_restart();
      break;
    case 0x4017: A.mode5 = v >> 7; A.fc = 0; A.fstep = 0; if (A.mode5) { quarter(); half(); } break;
  }
}
static uint8_t nes_apu_read(struct agnes *ag, uint16_t addr) {
  if (addr != 0x4015) return 0;
  apu_catch_up(((agnes_t *)ag)->cpu.cycles);
  return (uint8_t)((A.p[0].len ? 1 : 0) | (A.p[1].len ? 2 : 0) | (A.t.len ? 4 : 0) | (A.n.len ? 8 : 0) | (A.d.left ? 16 : 0));
}

/* ------------------------------------------------------------------ NES glue */
static uint8_t *nes_prg_ram(void) {
  if (!E.nes) return NULL;
  switch (E.nes->gamepack.mapper) { case 1: return E.nes->mapper.m1.prg_ram; case 4: return E.nes->mapper.m4.prg_ram; }
  return NULL;
}
static uint32_t hash(const uint8_t *p, uint32_t n) { uint32_t h = 2166136261u; while (n--) { h ^= *p++; h *= 16777619u; } return h; }
static int nes_start(void) {
  E.nes = agnes_make();
  if (!E.nes) { strcpy(err, "not enough memory"); return 0; }
  if (!agnes_load_ines_data(E.nes, E.rom, E.rom_len)) {
    int m = E.rom_len >= 8 ? ((E.rom[6] >> 4) | (E.rom[7] & 0xF0)) : -1;
    if (m != 0 && m != 1 && m != 2 && m != 4) snprintf(err, sizeof(err), "mapper %d is not supported (0, 1, 2 and 4 are)", m);
    else strcpy(err, "the ROM file is broken");
    return 0;
  }
  E.battery = (E.rom[6] >> 1) & 1;
  uint8_t *ram = nes_prg_ram();
  E.sram = ram; E.sram_len = ram ? 8192 : 0;
  if (!ram) E.battery = 0;
  apu_reset();
  E.kind = BK_EMU_NES;
  for (int i = 0; i < 64; i++) { agnes_color_t c = g_colors[i]; set_rgb(i, ((uint32_t)c.r << 16) | ((uint32_t)c.g << 8) | c.b); }
  snprintf(E.title, sizeof(E.title), "%s", "");
  return E.kind;
}

/* ------------------------------------------------------------------ loading and closing */
static void sram_send(void) {
  if (E.battery && E.sram && E.sram_len && host.sram) host.sram(E.name, E.sram, E.sram_len);
  E.sram_dirty = 0;
  if (E.kind == BK_EMU_NES && E.sram) E.sram_hash = hash(E.sram, E.sram_len);
}
void bk_emu_close(void) {
  if (E.kind && E.sram_dirty) sram_send();
  if (E.kind == BK_EMU_NES) {
    uint32_t h = E.sram ? hash(E.sram, E.sram_len) : 0;
    if (E.sram && h != E.sram_hash) sram_send();
  }
  free(E.gb);
  if (E.kind != BK_EMU_NES) free(E.sram);   /* the NES keeps its RAM inside agnes */
  if (E.nes) agnes_destroy(E.nes);
  free(E.rom); free(E.state);
  int pal = E.dmg_pal;
  memset(&E, 0, sizeof(E));
  E.dmg_pal = pal;
  ring_r = ring_w;
}
uint8_t *bk_emu_rom_alloc(uint32_t len) {
  bk_emu_close();
  E.rom = (uint8_t *)malloc(len ? len : 1);
  E.rom_len = E.rom ? len : 0;
  return E.rom;
}
int bk_emu_start(const char *name) {
  err[0] = 0;
  if (!E.rom) { strcpy(err, "no ROM loaded"); return 0; }
  snprintf(E.name, sizeof(E.name), "%s", name ? name : "game");
  int k = (E.rom_len >= 4 && memcmp(E.rom, "NES\x1a", 4) == 0) ? nes_start() : gb_start();
  if (!k) { char keep[sizeof(err)]; memcpy(keep, err, sizeof(err)); bk_emu_close(); memcpy(err, keep, sizeof(err)); return 0; }
  if (E.kind == BK_EMU_NES && E.sram) E.sram_hash = hash(E.sram, E.sram_len);
  return k;
}
uint8_t *bk_emu_sram(uint32_t *len) {
  if (len) *len = E.battery ? E.sram_len : 0;
  return E.battery ? E.sram : NULL;
}
void bk_emu_sram_loaded(void) { if (E.kind == BK_EMU_NES && E.sram) E.sram_hash = hash(E.sram, E.sram_len); E.sram_dirty = 0; }

/* ------------------------------------------------------------------ save states */
typedef struct { char magic[4]; uint32_t version, kind, size, rom_hash, core, sram; } state_head;
#define STATE_VERSION 1
static uint32_t rom_hash(void) { return hash(E.rom, E.rom_len < 65536 ? E.rom_len : 65536) ^ E.rom_len; }
int bk_emu_save_state(int slot) {
  if (!E.kind || slot < 1 || slot > 9) return 0;
  uint32_t core = E.kind == BK_EMU_NES ? (uint32_t)sizeof(agnes_state_t) : (uint32_t)sizeof(struct gb_s);
  uint32_t extra = E.kind == BK_EMU_NES ? (uint32_t)sizeof(apu_t) : (uint32_t)sizeof(gb_apu) + E.sram_len;
  uint32_t len = (uint32_t)sizeof(state_head) + core + extra;
  if (len > E.state_len) { free(E.state); E.state = (uint8_t *)malloc(len); E.state_len = E.state ? len : 0; if (!E.state) return 0; }
  state_head h = {{'B', 'K', 'E', 'S'}, STATE_VERSION, (uint32_t)E.kind, len, rom_hash(), core, E.sram_len};
  uint8_t *p = E.state;
  memcpy(p, &h, sizeof(h)); p += sizeof(h);
  if (E.kind == BK_EMU_NES) {
    agnes_dump_state(E.nes, (agnes_state_t *)p); p += core;
    memcpy(p, &A, sizeof(A));
  } else {
    memcpy(p, E.gb, core); p += core;
    memcpy(p, &gb_apu, sizeof(gb_apu)); p += sizeof(gb_apu);
    if (E.sram_len) memcpy(p, E.sram, E.sram_len);
  }
  if (host.state_save) host.state_save(E.name, slot, E.state, len);
  return host.state_save != NULL;
}
int bk_emu_state_load(const uint8_t *data, uint32_t len) {
  state_head h;
  if (!E.kind || !data || len < sizeof(h)) return 0;
  memcpy(&h, data, sizeof(h));
  if (memcmp(h.magic, "BKES", 4) || h.version != STATE_VERSION || h.kind != (uint32_t)E.kind || h.size != len || h.rom_hash != rom_hash()) return 0;
  const uint8_t *p = data + sizeof(h);
  if (E.kind == BK_EMU_NES) {
    if (h.core != sizeof(agnes_state_t) || len != sizeof(h) + h.core + sizeof(apu_t)) return 0;
    agnes_state_t *st = (agnes_state_t *)malloc(sizeof(agnes_state_t));
    if (!st) return 0;
    memcpy(st, p, sizeof(*st));
    if (st->agnes.gamepack.mapper != E.nes->gamepack.mapper) { free(st); return 0; }
    agnes_restore_state(E.nes, st); free(st);
    memcpy(&A, p + h.core, sizeof(A));
    A.cyc = E.nes->cpu.cycles;
    E.sram = nes_prg_ram();
  } else {
    if (h.core != sizeof(struct gb_s) || h.sram != E.sram_len || len != sizeof(h) + h.core + sizeof(gb_apu) + h.sram) return 0;
    struct gb_s keep = *E.gb;                       /* the callbacks stay this build's */
    memcpy(E.gb, p, h.core);
    E.gb->gb_rom_read = keep.gb_rom_read; E.gb->gb_rom_read_16bit = keep.gb_rom_read_16bit; E.gb->gb_rom_read_32bit = keep.gb_rom_read_32bit;
    E.gb->gb_cart_ram_read = keep.gb_cart_ram_read; E.gb->gb_cart_ram_write = keep.gb_cart_ram_write; E.gb->gb_error = keep.gb_error;
    E.gb->gb_serial_tx = keep.gb_serial_tx; E.gb->gb_serial_rx = keep.gb_serial_rx; E.gb->gb_bootrom_read = keep.gb_bootrom_read;
    E.gb->display.lcd_draw_line = keep.display.lcd_draw_line; E.gb->direct.priv = keep.direct.priv;
    memcpy(&gb_apu, p + h.core, sizeof(gb_apu));
    if (h.sram) { memcpy(E.sram, p + h.core + sizeof(gb_apu), h.sram); E.sram_dirty = 1; E.sram_quiet = 0; }
  }
  E.failed = 0;
  ring_r = ring_w;
  return 1;
}

/* ------------------------------------------------------------------ running and drawing */
int bk_emu_run(int mask, int frames) {
  if (!E.kind || E.failed) return 0;
  if (frames < 1) frames = 1;
  if (frames > 8) frames = 8;
  for (int f = 0; f < frames; f++) {
    ring_mute = f < frames - 1;
    if (E.kind == BK_EMU_NES) {
      agnes_input_t in = {(mask & BK_EMU_A) != 0, (mask & BK_EMU_B) != 0, (mask & BK_EMU_SELECT) != 0, (mask & BK_EMU_START) != 0,
                          (mask & BK_EMU_UP) != 0, (mask & BK_EMU_DOWN) != 0, (mask & BK_EMU_LEFT) != 0, (mask & BK_EMU_RIGHT) != 0};
      agnes_set_input(E.nes, &in, NULL);
      apu_per = NES_CPU_HZ / BK_SAMPLE_RATE / ring_rate();
      if (!agnes_next_frame(E.nes)) E.failed = 1;
      apu_catch_up(E.nes->cpu.cycles);
    } else {
      E.gb->direct.joypad = (uint8_t)~mask;
      gb_run_frame_dualfetch(E.gb);
      if (!ring_mute) {
        static int16_t buf[2048];   /* AUDIO_SAMPLES_TOTAL is 1476 at 44100 Hz */
        minigb_apu_audio_callback(&gb_apu, buf);
        ring_push_frame(buf, (int)AUDIO_SAMPLES);
      }
    }
    if (E.failed) break;
  }
  ring_mute = 0;
  if (E.kind == BK_EMU_GBC) gbc_palette();
  /* battery saves: send them once the game has stopped writing for two seconds */
  if (E.battery) {
    if (E.kind == BK_EMU_NES && (BK->frame % 60) == 0 && E.sram && hash(E.sram, E.sram_len) != E.sram_hash) { E.sram_dirty = 1; E.sram_quiet = 0; E.sram_hash = hash(E.sram, E.sram_len); }
    if (E.sram_dirty && ++E.sram_quiet > 120) sram_send();
  }
  return !E.failed;
}
void bk_emu_draw(int x, int y, int w, int h, int ct, int cb) {
  if (!E.kind || w <= 0 || h <= 0) return;
  const uint8_t *src; int sw, sh;
  if (E.kind == BK_EMU_NES) { src = E.nes->ppu.screen_buffer; sw = 256; sh = 240; } else { src = &E.gbfb[0][0]; sw = 160; sh = 144; }
  if (ct < 0) ct = 0;
  if (cb < 0) cb = 0;
  int rows = sh - ct - cb; if (rows < 1) return;
  uint32_t xs = ((uint32_t)sw << 16) / (uint32_t)w, ys = ((uint32_t)rows << 16) / (uint32_t)h;
  int x0 = x < 0 ? 0 : x, x1 = x + w > BK_W ? BK_W : x + w;
  int y0 = y < 0 ? 0 : y, y1 = y + h > BK_H ? BK_H : y + h;
  for (int dy = y0; dy < y1; dy++) {
    const uint8_t *row = src + (ct + (int)(((uint32_t)(dy - y) * ys) >> 16)) * sw;
    uint8_t *d = BK->screen + dy * BK_W;
    uint32_t sx = (uint32_t)(x0 - x) * xs;
    for (int dx = x0; dx < x1; dx++, sx += xs) d[dx] = (uint8_t)(BK_EMU_PAL0 + (row[sx >> 16] & 63));
  }
}
static struct { char what[8]; int ok; } events[8];
static int nevents;
void bk_emu_notify(const char *what, int ok) {
  if (nevents == 8) { memmove(events, events + 1, sizeof(events[0]) * 7); nevents--; }
  snprintf(events[nevents].what, sizeof(events[0].what), "%s", what);
  events[nevents++].ok = ok;
}

/* ------------------------------------------------------------------ Lua: emu_* for the emulator apps */
static const char *KIND_NAME[] = {NULL, "gb", "gbc", "nes"};
static int l_emu_roms(lua_State *l) {
  const char *kind = luaL_optstring(l, 1, "");
  char *src = host.roms ? host.roms(kind) : NULL;
  if (!src) { lua_newtable(l); return 1; }
  size_t n = strlen(src);
  char *chunk = (char *)malloc(n + 8);
  if (!chunk) { free(src); lua_newtable(l); return 1; }
  memcpy(chunk, "return ", 7); memcpy(chunk + 7, src, n + 1);
  free(src);
  int bad = luaL_loadbufferx(l, chunk, n + 7, "=roms", "t") != LUA_OK || lua_pcall(l, 0, 1, 0) != LUA_OK;
  free(chunk);
  if (bad || !lua_istable(l, -1)) { lua_pop(l, 1); lua_newtable(l); }
  return 1;
}
static int l_emu_poll(lua_State *l) {
  if (!nevents) return 0;
  lua_pushstring(l, events[0].what); lua_pushboolean(l, events[0].ok);
  memmove(events, events + 1, sizeof(events[0]) * (size_t)(--nevents));
  return 2;
}
static int l_emu_kind(lua_State *l) { if (E.kind) lua_pushstring(l, KIND_NAME[E.kind]); else lua_pushnil(l); return 1; }
static int l_emu_name(lua_State *l) { lua_pushstring(l, E.name); lua_pushstring(l, E.title); return 2; }
static int l_emu_open(lua_State *l) {
  int i = (int)luaL_checkinteger(l, 1);
  if (!host.open) { lua_pushboolean(l, 0); return 1; }
  host.open(i);
  lua_pushboolean(l, 1);
  return 1;
}
static int l_emu_close(lua_State *l) { (void)l; bk_emu_close(); return 0; }
static int l_emu_run(lua_State *l) { lua_pushboolean(l, bk_emu_run((int)luaL_optinteger(l, 1, 0), (int)luaL_optinteger(l, 2, 1))); return 1; }
static int l_emu_draw(lua_State *l) {
  bk_emu_draw((int)luaL_checkinteger(l, 1), (int)luaL_checkinteger(l, 2), (int)luaL_checkinteger(l, 3), (int)luaL_checkinteger(l, 4),
              (int)luaL_optinteger(l, 5, 0), (int)luaL_optinteger(l, 6, 0));
  return 0;
}
static int l_emu_size(lua_State *l) {
  lua_pushinteger(l, E.kind == BK_EMU_NES ? 256 : E.kind ? 160 : 0);
  lua_pushinteger(l, E.kind == BK_EMU_NES ? 240 : E.kind ? 144 : 0);
  return 2;
}
static int l_emu_palette(lua_State *l) { bk_emu_dmg_palette((int)luaL_checkinteger(l, 1) - 1); return 0; }
static int l_emu_reset(lua_State *l) {
  (void)l;
  if (E.kind == BK_EMU_NES) {
    uint8_t keep[8192]; int has = E.sram != NULL;
    if (has) memcpy(keep, E.sram, 8192);
    agnes_load_ines_data(E.nes, E.rom, E.rom_len);
    E.sram = nes_prg_ram();
    if (has && E.sram) memcpy(E.sram, keep, 8192);
    apu_reset();
  } else if (E.gb) { gb_reset(E.gb); minigb_apu_audio_init(&gb_apu); }
  E.failed = 0;
  return 0;
}
static int l_emu_save_state(lua_State *l) { lua_pushboolean(l, bk_emu_save_state((int)luaL_checkinteger(l, 1))); return 1; }
static int l_emu_load_state(lua_State *l) {
  int slot = (int)luaL_checkinteger(l, 1);
  if (!E.kind || !host.state_load || slot < 1 || slot > 9) { lua_pushboolean(l, 0); return 1; }
  host.state_load(E.name, slot);
  lua_pushboolean(l, 1);
  return 1;
}
static int l_emu_battery(lua_State *l) { lua_pushboolean(l, E.battery && E.sram_len); return 1; }
static int l_emu_error(lua_State *l) { lua_pushstring(l, E.failed ? "the game stopped (the emulator met something it cannot run)" : err); return 1; }

static const luaL_Reg EMU[] = {
  {"emu_kind", l_emu_kind}, {"emu_name", l_emu_name}, {"emu_open", l_emu_open}, {"emu_close", l_emu_close},
  {"emu_run", l_emu_run}, {"emu_draw", l_emu_draw}, {"emu_size", l_emu_size}, {"emu_palette", l_emu_palette},
  {"emu_reset", l_emu_reset}, {"emu_save_state", l_emu_save_state}, {"emu_load_state", l_emu_load_state},
  {"emu_battery", l_emu_battery}, {"emu_error", l_emu_error}, {"emu_roms", l_emu_roms}, {"emu_poll", l_emu_poll},
  {NULL, NULL}
};
void bk_emu_lua_open(lua_State *l) {
  nevents = 0;
  lua_pushglobaltable(l);
  luaL_setfuncs(l, EMU, 0);
  lua_pop(l, 1);
}
