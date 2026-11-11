/* PocketBit benchmark (menuconfig: BIT_BENCH): plays every built-in game and app for a while with random buttons,
   without screen, sound card or radio, and prints what each frame cost in CPU cycles: the Lua frame (with the
   host), mixing the sound, and turning the screen into RGB565 (with each screen look on one game).
   Build it with sdkconfig.bench (docs/DEVICE.md, "Frame budget"), flash it and read the table on the serial monitor.
   MIT License. */
#include "bit.h"
#include "bk_host.h"
#include "esp_cpu.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

#if CONFIG_BIT_BENCH
static uint64_t rs = 88172645463325252ull;
static uint32_t rnd(void) { rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17; return (uint32_t)rs; }
static uint16_t band[BK_W * BIT_BAND];

/* cycles, wrapping counter: 32 bits is 17 s at 240 MHz, plenty for a frame */
static inline uint32_t cyc(void) { return (uint32_t)esp_cpu_get_cycle_count(); }
static uint32_t present(void) {
  const uint32_t t = cyc();
  bk_host_present_begin();
  for (int y = 0; y < BK_H; y += BIT_BAND) bk_present_rgb565(band, y, y + BIT_BAND);
  return cyc() - t;
}

void bit_bench(void) {
  static int16_t snd[BK_SAMPLE_RATE / BK_FPS * 2];
  const int frames = CONFIG_BIT_BENCH_FRAMES;
  const int n = bk_host_games();
  printf("BENCH begin: %d games and apps, %d frames each, CPU %d MHz\n", n, frames, CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ);
  printf("BENCH | game | Lua+host avg | Lua+host p95 | Lua+host max | sound avg | picture avg | Lua KB |\n");
  for (int g = 1; g <= n; g++) {
    bk_host_go_home();
    for (int i = 0; i < 3; i++) bk_host_frame(0, NULL);
    bk_host_launch(g);
    static uint32_t t[4096];
    uint64_t lua = 0, au = 0, pic = 0; uint32_t mx = 0;
    const int nf = frames > 4096 ? 4096 : frames;
    uint16_t held = 0;
    for (int f = 0; f < nf; f++) {
      if (f % 8 == 0) held = (uint16_t)(rnd() & 0x3FF);       /* random buttons, never Start or Select */
      const uint32_t t0 = cyc();
      bk_host_frame(held, NULL);
      const uint32_t t1 = cyc();
      bk_host_audio(snd, BK_SAMPLE_RATE / BK_FPS);
      const uint32_t t2 = cyc();
      const uint32_t p = present();
      t[f] = t1 - t0; lua += t[f]; au += t2 - t1; pic += p;
      if (t[f] > mx) mx = t[f];
    }
    /* 95th percentile: a partial selection is plenty here */
    uint32_t p95 = 0;
    { int k = nf / 20; for (int i = 0; i <= k; i++) { int m = i; for (int j = i + 1; j < nf; j++) if (t[j] > t[m]) m = j; uint32_t x = t[i]; t[i] = t[m]; t[m] = x; } p95 = t[k]; }
    printf("BENCH | %s | %.2f | %.2f | %.2f | %.2f | %.2f | %u |\n", bk_host_game_name(g),
      lua / (double)nf / 1e6, p95 / 1e6, mx / 1e6, au / (double)nf / 1e6, pic / (double)nf / 1e6, (unsigned)(bk_host_lua_peak() / 1024));
    if (!strcmp(bk_host_playing(), "error")) printf("BENCH note: %s stopped: %s\n", bk_host_game_name(g), bk_host_last_error());
  }
  /* the screen looks over a game (they cost the same on every game: they work on pixels, not on what is drawn) */
  static const char *looks[] = { "off", "sepia", "vivid", "night", "handheld", "arcade", "crt" };
  printf("BENCH looks | look | picture avg |\n");
  for (size_t i = 0; i < sizeof(looks) / sizeof(looks[0]); i++) {
    __typeof__(BK->display) keep = BK->display;
    bk_display_preset(looks[i]);
    uint64_t pic = 0;
    for (int f = 0; f < 30; f++) {
      const uint32_t t = cyc();
      bk_present_begin();
      for (int y = 0; y < BK_H; y += BIT_BAND) bk_present_rgb565(band, y, y + BIT_BAND);
      pic += cyc() - t;
    }
    BK->display = keep;
    printf("BENCH looks | %s | %.2f |\n", looks[i], pic / 30.0 / 1e6);
  }
  printf("BENCH end: PSRAM free %u KB, internal free %u KB (budget: %.2f M cycles per frame at 60 fps)\n",
    (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024), (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024),
    CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ / 60.0);
  fflush(stdout);
}
#else
void bit_bench(void) {}
#endif
