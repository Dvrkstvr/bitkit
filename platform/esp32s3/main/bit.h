/* PocketBit firmware: the pieces of hardware the main loop talks to. MIT License. */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

#define BIT_BAND 20                                   /* screen rows per DMA transfer */

esp_err_t bit_lcd_init(void);
uint16_t *bit_lcd_band(void);                         /* a free band buffer (waits for the panel if both are in flight) */
void bit_lcd_send(int y0, int y1, uint16_t *band);    /* send rows y0..y1-1 from that buffer */
void bit_lcd_backlight(int per_mille);

esp_err_t bit_audio_init(void);
void bit_audio_write(const int16_t *stereo, int frames);   /* blocks while the DMA queue is full: this paces the loop at 60 Hz */

esp_err_t bit_input_init(void);
uint16_t bit_input_read(uint8_t press[12]);           /* button mask (BK_LEFT..BK_SELECT) and pressure 0..255 */

typedef struct { int sd; char source[24]; } bit_storage;
esp_err_t bit_storage_init(bit_storage *st);          /* /flash (internal), /sdcard (if a card is in) */

void bit_clock_init(void);                            /* system time from the RTC chip, if there is one */
int bit_clock_set(int64_t unix_seconds);              /* set it (serial console "time <unix>") */

esp_err_t bit_radio_init(uint32_t *id);               /* ESP-NOW; id = this Bit's id from its MAC address */
int bit_radio_send(const void *data, int len);        /* broadcast one packet (at most 250 bytes) */
int bit_radio_poll(void (*fn)(const void *data, int len));   /* hand every packet that came in to fn; on the loop's thread */

void bit_bench(void);                                 /* menuconfig BIT_BENCH: measure every game, print a table (bench.c) */
