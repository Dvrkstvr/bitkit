/* Stereo sound: I2S to two MAX98357A amplifiers (one set to left, one to right). 44.1 kHz, 16 bit.
   The DMA holds about two frames of sound; writing a frame's 735 samples blocks while it is full, which keeps the
   game loop at exactly 60 frames a second without a timer. MIT License. */
#include "bit.h"
#include "../../../runtime/bk.h"
#include "driver/i2s_std.h"
#include "esp_log.h"
#include "sdkconfig.h"

static i2s_chan_handle_t tx;

esp_err_t bit_audio_init(void) {
  i2s_chan_config_t cc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  cc.dma_desc_num = 6;
  cc.dma_frame_num = BK_SAMPLE_RATE / BK_FPS / 3;    /* 245 samples: 6 of them are two frames of sound */
  cc.auto_clear = true;                               /* a late frame plays silence, not a stutter */
  esp_err_t r = i2s_new_channel(&cc, &tx, NULL);
  if (r != ESP_OK) return r;
  i2s_std_config_t sc = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(BK_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
    .gpio_cfg = { .mclk = I2S_GPIO_UNUSED, .bclk = CONFIG_BIT_I2S_BCLK, .ws = CONFIG_BIT_I2S_WS, .dout = CONFIG_BIT_I2S_DOUT, .din = I2S_GPIO_UNUSED },
  };
  if ((r = i2s_channel_init_std_mode(tx, &sc)) != ESP_OK) return r;
  return i2s_channel_enable(tx);
}

void bit_audio_write(const int16_t *stereo, int frames) {
  size_t done = 0;
  i2s_channel_write(tx, stereo, (size_t)frames * 4, &done, 100);
}
