/* PocketBit radio: linked Bits over ESP-NOW broadcasts (no Wi-Fi network or pairing needed).
   The Wi-Fi task hands received packets to a queue; the game loop takes them between frames, so the host
   (platform/device/bk_host.c, "linked Bits") only ever runs on the loop's thread. MIT License. */
#include "bit.h"
#include "sdkconfig.h"
#include <string.h>

#if CONFIG_BIT_LINK
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "nvs_flash.h"

static const char *TAG = "radio";
static const uint8_t BCAST[6] = { 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };
typedef struct { uint8_t len; uint8_t d[250]; } pkt;
static QueueHandle_t rx;
static int up;

static void on_recv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len <= 0 || len > 250) return;
  pkt p; p.len = (uint8_t)len; memcpy(p.d, data, (size_t)len);
  xQueueSend(rx, &p, 0);          /* full: dropped, like a lost packet (the link sends everything again) */
}

esp_err_t bit_radio_init(uint32_t *id) {
  esp_err_t e = nvs_flash_init();
  if (e == ESP_ERR_NVS_NO_FREE_PAGES || e == ESP_ERR_NVS_NEW_VERSION_FOUND) { nvs_flash_erase(); e = nvs_flash_init(); }
  if (e) return e;
  rx = xQueueCreate(48, sizeof(pkt));
  if (!rx) return ESP_ERR_NO_MEM;
  if ((e = esp_netif_init())) return e;
  e = esp_event_loop_create_default();
  if (e && e != ESP_ERR_INVALID_STATE) return e;
  wifi_init_config_t wc = WIFI_INIT_CONFIG_DEFAULT();
  if ((e = esp_wifi_init(&wc))) return e;
  esp_wifi_set_storage(WIFI_STORAGE_RAM);
  esp_wifi_set_mode(WIFI_MODE_STA);
  if ((e = esp_wifi_start())) return e;
  esp_wifi_set_ps(WIFI_PS_NONE);                     /* no power save: packets every frame, low lag */
  esp_wifi_set_channel(CONFIG_BIT_LINK_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if ((e = esp_now_init())) return e;
  esp_now_register_recv_cb(on_recv);
  esp_now_peer_info_t peer = { 0 };
  memcpy(peer.peer_addr, BCAST, 6);
  peer.channel = 0; peer.ifidx = WIFI_IF_STA; peer.encrypt = false;
  if ((e = esp_now_add_peer(&peer))) return e;
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  *id = (uint32_t)mac[2] << 24 | (uint32_t)mac[3] << 16 | (uint32_t)mac[4] << 8 | mac[5];
  up = 1;
  ESP_LOGI(TAG, "ESP-NOW on channel %d, Bit id %08lx", CONFIG_BIT_LINK_CHANNEL, (unsigned long)*id);
  return ESP_OK;
}
int bit_radio_send(const void *data, int len) {
  if (!up || len <= 0 || len > 250) return 1;
  return esp_now_send(BCAST, data, (size_t)len) != ESP_OK;
}
int bit_radio_poll(void (*fn)(const void *data, int len)) {
  if (!up) return 0;
  pkt p; int n = 0;
  while (xQueueReceive(rx, &p, 0) == pdTRUE) { fn(p.d, p.len); n++; }
  return n;
}
#else
esp_err_t bit_radio_init(uint32_t *id) { (void)id; return ESP_ERR_NOT_SUPPORTED; }
int bit_radio_send(const void *data, int len) { (void)data; (void)len; return 1; }
int bit_radio_poll(void (*fn)(const void *data, int len)) { (void)fn; return 0; }
#endif
