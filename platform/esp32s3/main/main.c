/* PocketBit firmware: boots into the home screen and runs the BitKit runtime at 60 frames a second.
   Core 1 runs the game loop (buttons → Lua frame → sound → picture); core 0 has the USB console and the radio.
   The loop is the same one platform/sim runs in CI (platform/device/bk_host.c). MIT License. */
#include "bit.h"
#include "bk_emu.h"
#include "bk_host.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static const char *TAG = "bit";
static QueueHandle_t console_q;           /* Lua lines from the serial console, run between frames */

static void *psram_realloc(void *p, size_t n) {
  if (!n) { heap_caps_free(p); return NULL; }
  return heap_caps_realloc(p, n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}
static size_t psram_free(void) { return heap_caps_get_free_size(MALLOC_CAP_SPIRAM); }
static void logger(const char *m, int err) { if (err) ESP_LOGE(TAG, "%s", m); else printf("%s\n", m); }

/* frame timing, printed every 5 seconds: where the 16.7 ms go */
static struct { int64_t lua, present, wait; int frames, late; } st;

static void game_loop(void *arg) {
  static int16_t snd[BK_SAMPLE_RATE / BK_FPS * 2];
  uint8_t press[BK_NUM_BUTTONS];
  int light = -1;
  int64_t report = esp_timer_get_time() + 5000000;
  for (;;) {
    char *line;
    while (xQueueReceive(console_q, &line, 0) == pdTRUE) { bk_host_eval(line); free(line); }

    const int64_t t0 = esp_timer_get_time();
    const uint16_t mask = bit_input_read(press);
    bk_host_frame(mask, press);
    const int64_t t1 = esp_timer_get_time();

    bk_host_audio(snd, BK_SAMPLE_RATE / BK_FPS);
    /* the picture, in bands: each band is turned into colours while the one before it is on its way */
    bk_host_present_begin();
    for (int y = 0; y < BK_H; y += BIT_BAND) {
      uint16_t *b = bit_lcd_band();
      bk_present_rgb565(b, y, y + BIT_BAND);
      bit_lcd_send(y, y + BIT_BAND, b);
    }
    const int64_t t2 = esp_timer_get_time();
    bit_audio_write(snd, BK_SAMPLE_RATE / BK_FPS);    /* waits for the sound card: the 60 Hz beat */
    const int64_t t3 = esp_timer_get_time();

    const int bl = bk_host_backlight();
    if (bl != light) { bit_lcd_backlight(bl); light = bl; }
    st.lua += t1 - t0; st.present += t2 - t1; st.wait += t3 - t2; st.frames++;
    if (t2 - t0 > 1000000 / BK_FPS) st.late++;
    if (t3 >= report) {
      const int n = st.frames ? st.frames : 1;
      ESP_LOGI(TAG, "%s: %d fps, frame %.2f ms (Lua+host %.2f, picture %.2f, idle %.2f), %d late, Lua %u KB, PSRAM free %u KB, internal free %u KB",
        bk_host_playing(), st.frames / 5, (st.lua + st.present) / 1000.0 / n, st.lua / 1000.0 / n, st.present / 1000.0 / n, st.wait / 1000.0 / n, st.late,
        (unsigned)(bk_host_lua_bytes() / 1024), (unsigned)(psram_free() / 1024), (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024));
      memset(&st, 0, sizeof(st));
      report = t3 + 5000000;
    }
  }
}

/* USB serial console: "time <unix seconds>", "lua <code>" (runs in the game that is playing), "home" */
static void console_task(void *arg) {
  char buf[512]; int n = 0;
  for (;;) {
    int c = fgetc(stdin);
    if (c == EOF) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }
    if (c != '\n' && c != '\r') { if (n < (int)sizeof(buf) - 1) buf[n++] = (char)c; continue; }
    buf[n] = 0; n = 0;
    if (!strncmp(buf, "time ", 5)) { bit_clock_set(strtoll(buf + 5, NULL, 10)); printf("time set\n"); }
    else if (!strncmp(buf, "lua ", 4)) { char *l = strdup(buf + 4); if (l && xQueueSend(console_q, &l, 0) != pdTRUE) free(l); }
    else if (!strcmp(buf, "home")) { char *l = strdup("home()"); if (l && xQueueSend(console_q, &l, 0) != pdTRUE) free(l); }
    else if (buf[0]) printf("commands: time <unix seconds> | lua <code> | home\n");
  }
}

void app_main(void) {
  ESP_LOGI(TAG, "PocketBit: BitKit runtime, %d KB PSRAM free", (int)(psram_free() / 1024));
  bit_clock_init();
  static bit_storage stor;
  ESP_ERROR_CHECK(bit_storage_init(&stor));
  ESP_ERROR_CHECK(bit_lcd_init());
  ESP_ERROR_CHECK(bit_audio_init());
  ESP_ERROR_CHECK(bit_input_init());

  static bk_host_config cfg;
  cfg.home_lua = "/flash/sys/home.lua";
  cfg.boot_lua = "/flash/sys/boot.lua";
  int g = 0;
  if (stor.sd) cfg.game_dirs[g++] = "/sdcard/games";   /* your games first: one with the same name as a built-in wins */
  cfg.game_dirs[g++] = "/flash/carts";
  cfg.app_dirs[0] = "/flash/apps";
  cfg.save_dir = stor.sd ? "/sdcard/bitkit/saves" : "/flash/saves";
  cfg.captures_dir = stor.sd ? "/sdcard/captures" : "/flash/captures";   /* Select+L photo, Select+R clip */
  mkdir(cfg.captures_dir, 0775);
  cfg.source = stor.source;
  cfg.max_paused = CONFIG_BIT_MAX_PAUSED;
  cfg.game_mem_limit = (size_t)CONFIG_BIT_GAME_MEM_KB * 1024;
  cfg.mem_realloc = psram_realloc;
  cfg.mem_free = psram_free;
  cfg.log = logger;
  /* the emulator apps (Game Boy, GBC, NES) find your ROMs here; battery saves and states go next to them */
  const char *roms = stor.sd ? "/sdcard/roms" : "/flash/roms";
  mkdir(roms, 0775);
  bk_emu_fs_init(roms);
  if (bk_host_init(&cfg)) { ESP_LOGE(TAG, "the host did not start (out of memory?)"); return; }

  console_q = xQueueCreate(4, sizeof(char *));
  xTaskCreatePinnedToCore(console_task, "console", 4096, NULL, 3, NULL, 0);
  /* Lua's parser recurses in C: the game loop gets a big stack in internal RAM */
  xTaskCreatePinnedToCore(game_loop, "game", 48 * 1024, NULL, 5, NULL, 1);
}
