/* Files: the internal flash is a FAT disk at /flash (built-in games, apps, the home screen, and saves when there
   is no card); a microSD card at /sdcard holds your own games (/sdcard/games, the studio's .bitkit files as they
   are) and saves (/sdcard/bitkit/saves). MIT License. */
#include "bit.h"
#include "esp_vfs_fat.h"
#include "driver/sdmmc_host.h"
#include "sdmmc_cmd.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include <string.h>
#include <sys/stat.h>

static const char *TAG = "storage";
static wl_handle_t wl = WL_INVALID_HANDLE;

esp_err_t bit_storage_init(bit_storage *st) {
  memset(st, 0, sizeof(*st));
  esp_vfs_fat_mount_config_t mc = { .format_if_mount_failed = false, .max_files = 6, .allocation_unit_size = 4096 };
  esp_err_t r = esp_vfs_fat_spiflash_mount_rw_wl("/flash", "storage", &mc, &wl);
  if (r != ESP_OK) { ESP_LOGE(TAG, "internal flash disk: %s (flash it with `idf.py flash`)", esp_err_to_name(r)); return r; }
  mkdir("/flash/saves", 0775);
#if CONFIG_BIT_SD
  sdmmc_host_t host = SDMMC_HOST_DEFAULT();
  host.max_freq_khz = SDMMC_FREQ_HIGHSPEED;
  sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
  slot.width = 1;
  slot.clk = CONFIG_BIT_SD_CLK; slot.cmd = CONFIG_BIT_SD_CMD; slot.d0 = CONFIG_BIT_SD_D0;
  slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
  esp_vfs_fat_sdmmc_mount_config_t smc = { .format_if_mount_failed = false, .max_files = 6, .allocation_unit_size = 16 * 1024 };
  sdmmc_card_t *card;
  if (esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &smc, &card) == ESP_OK) {
    st->sd = 1;
    strcpy(st->source, "SD card");
    mkdir("/sdcard/games", 0775); mkdir("/sdcard/bitkit", 0775); mkdir("/sdcard/bitkit/saves", 0775);
    ESP_LOGI(TAG, "SD card: %s, %llu MB", card->cid.name, ((unsigned long long)card->csd.capacity) * card->csd.sector_size / (1024 * 1024));
  } else ESP_LOGW(TAG, "no SD card: games from the internal flash, saves there too");
#endif
  return ESP_OK;
}
