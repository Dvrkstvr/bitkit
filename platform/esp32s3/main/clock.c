/* Wall-clock time for clock() in Lua (idle games count the time you were away). The ESP32-S3 keeps time through
   sleep and resets but not without power, so a PCF8563 on I2C (with a coin cell) gives the time at boot.
   Without one, "time <unix seconds>" on the serial console sets it. MIT License. */
#include "bit.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include <sys/time.h>
#include <time.h>
#if CONFIG_BIT_RTC
static const char *TAG = "clock";
#endif
#if CONFIG_BIT_RTC
#include "driver/i2c_master.h"
static i2c_master_dev_handle_t rtc;
static int bcd(uint8_t v) { return (v >> 4) * 10 + (v & 15); }
static uint8_t tobcd(int v) { return (uint8_t)(((v / 10) << 4) | (v % 10)); }
#endif

void bit_clock_init(void) {
  setenv("TZ", "UTC0", 1); tzset();
#if CONFIG_BIT_RTC
  i2c_master_bus_config_t bc = { .i2c_port = I2C_NUM_0, .sda_io_num = CONFIG_BIT_RTC_SDA, .scl_io_num = CONFIG_BIT_RTC_SCL,
    .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true };
  i2c_master_bus_handle_t bus;
  if (i2c_new_master_bus(&bc, &bus) != ESP_OK) return;
  i2c_device_config_t dc = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = 0x51, .scl_speed_hz = 100000 };
  if (i2c_master_bus_add_device(bus, &dc, &rtc) != ESP_OK) return;
  uint8_t reg = 0x02, v[7];
  if (i2c_master_transmit_receive(rtc, &reg, 1, v, 7, 100) != ESP_OK) { ESP_LOGW(TAG, "no PCF8563 answered"); return; }
  if (v[0] & 0x80) { ESP_LOGW(TAG, "the RTC lost power: set the time with `time <unix seconds>`"); return; }
  struct tm t = { .tm_sec = bcd(v[0] & 0x7F), .tm_min = bcd(v[1] & 0x7F), .tm_hour = bcd(v[2] & 0x3F), .tm_mday = bcd(v[3] & 0x3F),
    .tm_mon = bcd(v[5] & 0x1F) - 1, .tm_year = bcd(v[6]) + ((v[5] & 0x80) ? 0 : 100) };
  struct timeval tv = { .tv_sec = mktime(&t) };
  settimeofday(&tv, NULL);
  ESP_LOGI(TAG, "time from the RTC: %lld", (long long)tv.tv_sec);
#endif
}

int bit_clock_set(int64_t s) {
  struct timeval tv = { .tv_sec = (time_t)s };
  settimeofday(&tv, NULL);
#if CONFIG_BIT_RTC
  if (rtc) {
    time_t tt = (time_t)s; struct tm t; gmtime_r(&tt, &t);
    uint8_t w[8] = { 0x02, tobcd(t.tm_sec), tobcd(t.tm_min), tobcd(t.tm_hour), tobcd(t.tm_mday), tobcd(t.tm_wday),
      (uint8_t)(tobcd(t.tm_mon + 1) | (t.tm_year >= 100 ? 0 : 0x80)), tobcd(t.tm_year % 100) };
    return i2c_master_transmit(rtc, w, 8, 100) == ESP_OK ? 0 : 1;
  }
#endif
  return 0;
}
