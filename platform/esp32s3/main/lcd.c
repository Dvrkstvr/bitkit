/* ST7789 320x240 on the 8-bit i80 bus. The frame goes out in bands of BIT_BAND rows from two small DMA buffers in
   internal RAM: the CPU turns band k+1 into colours (bk_present_rgb565) while the DMA sends band k. MIT License. */
#include "bit.h"
#include "../../../runtime/bk.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "sdkconfig.h"

/* Kconfig leaves switched-off options undefined */
#ifndef CONFIG_BIT_LCD_INVERT
#define CONFIG_BIT_LCD_INVERT 0
#endif
#ifndef CONFIG_BIT_LCD_MIRROR_X
#define CONFIG_BIT_LCD_MIRROR_X 0
#endif
#ifndef CONFIG_BIT_LCD_MIRROR_Y
#define CONFIG_BIT_LCD_MIRROR_Y 0
#endif
#ifndef CONFIG_BIT_LCD_SWAP_XY
#define CONFIG_BIT_LCD_SWAP_XY 0
#endif

static const char *TAG = "lcd";
static esp_lcd_panel_handle_t panel;
static uint16_t *band[2];
static int next;
static SemaphoreHandle_t free_bufs;

static bool IRAM_ATTR on_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *e, void *ctx) {
  BaseType_t woke = pdFALSE;
  xSemaphoreGiveFromISR(free_bufs, &woke);
  return woke == pdTRUE;
}

esp_err_t bit_lcd_init(void) {
  free_bufs = xSemaphoreCreateCounting(2, 2);
  for (int i = 0; i < 2; i++) {
    band[i] = heap_caps_malloc(BK_W * BIT_BAND * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    if (!band[i]) return ESP_ERR_NO_MEM;
  }
  esp_lcd_i80_bus_handle_t bus;
  esp_lcd_i80_bus_config_t bc = {
    .clk_src = LCD_CLK_SRC_DEFAULT,
    .dc_gpio_num = CONFIG_BIT_LCD_DC,
    .wr_gpio_num = CONFIG_BIT_LCD_WR,
    .data_gpio_nums = { CONFIG_BIT_LCD_D0, CONFIG_BIT_LCD_D1, CONFIG_BIT_LCD_D2, CONFIG_BIT_LCD_D3,
                        CONFIG_BIT_LCD_D4, CONFIG_BIT_LCD_D5, CONFIG_BIT_LCD_D6, CONFIG_BIT_LCD_D7 },
    .bus_width = 8,
    .max_transfer_bytes = BK_W * BIT_BAND * 2,
  };
  esp_err_t r = esp_lcd_new_i80_bus(&bc, &bus);
  if (r != ESP_OK) return r;
  esp_lcd_panel_io_handle_t io;
  esp_lcd_panel_io_i80_config_t ic = {
    .cs_gpio_num = CONFIG_BIT_LCD_CS,
    .pclk_hz = CONFIG_BIT_LCD_PCLK_MHZ * 1000 * 1000,
    .trans_queue_depth = 4,
    .on_color_trans_done = on_done,
    .lcd_cmd_bits = 8,
    .lcd_param_bits = 8,
    .dc_levels = { .dc_idle_level = 0, .dc_cmd_level = 0, .dc_dummy_level = 0, .dc_data_level = 1 },
    .flags = { .swap_color_bytes = 1 },   /* RGB565 goes out high byte first */
  };
  if ((r = esp_lcd_new_panel_io_i80(bus, &ic, &io)) != ESP_OK) return r;
  esp_lcd_panel_dev_config_t pc = {
    .reset_gpio_num = CONFIG_BIT_LCD_RST,
#if CONFIG_BIT_LCD_BGR
    .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
#else
    .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
#endif
    .bits_per_pixel = 16,
  };
  if ((r = esp_lcd_new_panel_st7789(io, &pc, &panel)) != ESP_OK) return r;
  esp_lcd_panel_reset(panel);
  esp_lcd_panel_init(panel);
  esp_lcd_panel_invert_color(panel, CONFIG_BIT_LCD_INVERT);
  esp_lcd_panel_swap_xy(panel, CONFIG_BIT_LCD_SWAP_XY);
  esp_lcd_panel_mirror(panel, CONFIG_BIT_LCD_MIRROR_X, CONFIG_BIT_LCD_MIRROR_Y);
  esp_lcd_panel_disp_on_off(panel, true);

  if (CONFIG_BIT_LCD_BL >= 0) {
    ledc_timer_config_t t = { .speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_10_BIT, .timer_num = LEDC_TIMER_0, .freq_hz = 5000, .clk_cfg = LEDC_AUTO_CLK };
    ledc_timer_config(&t);
    ledc_channel_config_t c = { .gpio_num = CONFIG_BIT_LCD_BL, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0, .duty = 1023 };
    ledc_channel_config(&c);
  }
  ESP_LOGI(TAG, "ST7789 %dx%d on i80 at %d MHz", BK_W, BK_H, CONFIG_BIT_LCD_PCLK_MHZ);
  return ESP_OK;
}

uint16_t *bit_lcd_band(void) {
  xSemaphoreTake(free_bufs, portMAX_DELAY);
  uint16_t *b = band[next];
  next ^= 1;
  return b;
}

void bit_lcd_send(int y0, int y1, uint16_t *buf) {
  esp_lcd_panel_draw_bitmap(panel, 0, y0, BK_W, y1, buf);
}

void bit_lcd_backlight(int per_mille) {
  if (CONFIG_BIT_LCD_BL < 0) return;
  if (per_mille < 0) per_mille = 0;
  if (per_mille > 1000) per_mille = 1000;
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, (uint32_t)(per_mille * 1023 / 1000));
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}
