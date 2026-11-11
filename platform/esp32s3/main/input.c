/* Buttons: one GPIO each, pulled up, pressed = low. With BIT_ANALOG, A B X Y L R are Hall-effect sensors read by an
   MCP3208 (12-bit ADC on SPI, channels 0-5): each one gives press() 0..255 and is down past the threshold.
   Every sensor calibrates itself: its resting value and the deepest press seen so far are 0 and 255. MIT License. */
#include "bit.h"
#include "../../../runtime/bk.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include <string.h>

static const int PINS[BK_NUM_BUTTONS] = {
  CONFIG_BIT_BTN_LEFT, CONFIG_BIT_BTN_RIGHT, CONFIG_BIT_BTN_UP, CONFIG_BIT_BTN_DOWN,
  CONFIG_BIT_BTN_A, CONFIG_BIT_BTN_B, CONFIG_BIT_BTN_X, CONFIG_BIT_BTN_Y,
  CONFIG_BIT_BTN_L, CONFIG_BIT_BTN_R, CONFIG_BIT_BTN_START, CONFIG_BIT_BTN_SELECT,
};

#if CONFIG_BIT_ANALOG
static spi_device_handle_t adc;
static int rest[6], deep[6];
static const int ANALOG_BTN[6] = { BK_A, BK_B, BK_X, BK_Y, BK_L, BK_R };
static int adc_read(int ch) {
  spi_transaction_t t = { .flags = SPI_TRANS_USE_RXDATA | SPI_TRANS_USE_TXDATA, .length = 24 };
  t.tx_data[0] = (uint8_t)(0x06 | (ch >> 2)); t.tx_data[1] = (uint8_t)((ch & 3) << 6); t.tx_data[2] = 0;
  if (spi_device_polling_transmit(adc, &t) != ESP_OK) return 0;
  return ((t.rx_data[1] & 15) << 8) | t.rx_data[2];
}
#endif

esp_err_t bit_input_init(void) {
  uint64_t mask = 0;
  for (int i = 0; i < BK_NUM_BUTTONS; i++) if (PINS[i] >= 0) mask |= 1ULL << PINS[i];
  gpio_config_t c = { .pin_bit_mask = mask, .mode = GPIO_MODE_INPUT, .pull_up_en = GPIO_PULLUP_ENABLE };
  esp_err_t r = mask ? gpio_config(&c) : ESP_OK;
#if CONFIG_BIT_ANALOG
  spi_bus_config_t bc = { .mosi_io_num = CONFIG_BIT_ADC_MOSI, .miso_io_num = CONFIG_BIT_ADC_MISO, .sclk_io_num = CONFIG_BIT_ADC_SCK, .quadwp_io_num = -1, .quadhd_io_num = -1 };
  if ((r = spi_bus_initialize(SPI2_HOST, &bc, SPI_DMA_DISABLED)) != ESP_OK) return r;
  spi_device_interface_config_t dc = { .clock_speed_hz = 1000000, .mode = 0, .spics_io_num = CONFIG_BIT_ADC_CS, .queue_size = 1 };
  if ((r = spi_bus_add_device(SPI2_HOST, &dc, &adc)) != ESP_OK) return r;
  for (int i = 0; i < 6; i++) { rest[i] = adc_read(i); deep[i] = rest[i]; }
#endif
  return r;
}

uint16_t bit_input_read(uint8_t press[12]) {
  uint16_t m = 0;
  for (int i = 0; i < BK_NUM_BUTTONS; i++) {
    int down = PINS[i] >= 0 && gpio_get_level(PINS[i]) == 0;
    if (down) m |= (uint16_t)(1u << i);
    press[i] = down ? 255 : 0;
  }
#if CONFIG_BIT_ANALOG
  for (int i = 0; i < 6; i++) {
    const int v = adc_read(i), b = ANALOG_BTN[i];
    /* the magnet can move the reading up or down: measure the distance from rest, whichever way */
    const int d = v > rest[i] ? v - rest[i] : rest[i] - v, full = deep[i] > rest[i] ? deep[i] - rest[i] : rest[i] - deep[i];
    if (d > full) deep[i] = v;
    int p = full > 40 ? d * 255 / (full > d ? full : d) : 0;
    if (p < 8) p = 0;                                   /* dead zone at rest */
    press[b] = (uint8_t)(p > press[b] ? p : press[b]);  /* a digital button wired too still counts */
    if (press[b] >= CONFIG_BIT_ADC_THRESHOLD) m |= (uint16_t)(1u << b);
  }
#endif
  return m;
}
