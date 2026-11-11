/* The PocketBit host: everything the studio's emulated Bit does around the runtime, in portable C.
   Home screen, games and apps from the memory, save files, the Bit's settings (screen look, brightness, volume),
   level() maps, the game shell's restart, paused games (kept alive in memory) and Start+Select to go home.
   The ESP32-S3 firmware (platform/esp32s3) and the headless Linux build used in CI (platform/sim) both run it.
   MIT License. */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "../../runtime/bk.h"

typedef struct {
  const char *home_lua;          /* path of the home screen cart (sys/home.lua) */
  const char *boot_lua;          /* the theme's power-on animation (sys/boot.lua), or NULL */
  const char *game_dirs[4];      /* folders with .bitkit games, in order (first wins on equal names); NULL ends */
  const char *app_dirs[2];       /* folders with the Bit's apps */
  const char *save_dir;          /* save files: <save_dir>/<name>.sav */
  const char *captures_dir;      /* photos and clips (Select+L, Select+R) for the Share hub; NULL = off */
  const char *source;            /* shown on the home screen (e.g. "SD card"), may be "" */
  int max_paused;                /* games kept paused in memory (oldest goes first); 0 = default 4 */
  size_t game_mem_limit;         /* Lua memory per game in bytes; 0 = default 4 MB */
  /* memory for machines, carts and Lua: PSRAM on the device. NULL = realloc. Must accept realloc(p, 0) as free. */
  void *(*mem_realloc)(void *p, size_t n);
  size_t (*mem_free)(void);      /* free bytes in that memory, or NULL */
  void (*log)(const char *msg, int is_error);
  /* linked Bits (ESP-NOW on the device). NULL radio_send = no radio. The host's own packets are under 250 bytes. */
  int (*radio_send)(const void *pkt, int len);   /* broadcast one packet to every Bit in reach */
  uint32_t bit_id;               /* this Bit's id on the radio (from its MAC address); 0 = pick one */
  uint32_t (*millis)(void);      /* a clock in milliseconds for the radio's timeouts; NULL = count frames */
} bk_host_config;

typedef struct {
  char look[16];                 /* screen look over every game ("game" = the game's own, "theme" = the theme's) */
  int strength, bright, volume;  /* 0..10 */
  char name[16], bit[20];        /* the owner's name and the Bit's name (Settings app, USER page) */
  int color;                     /* the owner's colour, a palette index */
  char theme_look[16], theme_boot[12], boottext[24];   /* from the "Bit theme" save (docs/THEMES.md) */
} bk_bit_settings;

int  bk_host_init(const bk_host_config *cfg);       /* scan the games, read the settings, boot the home screen */
void bk_host_shutdown(void);                         /* close every cart (init calls it when run again) */
int  bk_host_eval(const char *lua);                  /* run Lua in the cart that runs now, then its host requests */
/* one 60 Hz tick: player 1's buttons (bit mask, BK_LEFT..BK_SELECT) and pressure 0..255 (NULL = digital) */
int  bk_host_frame(uint16_t mask, const uint8_t *press);
void bk_host_audio(int16_t *out, int frames);       /* stereo samples for the frame just run, after the volume */
void bk_host_present_begin(void);                    /* then bk_present_rgb565() in bands */
int  bk_host_backlight(void);                        /* 0..1000 duty per mille, from the Bit settings */
const bk_bit_settings *bk_host_settings(void);

/* state, for tests and the serial console */
const char *bk_host_playing(void);                   /* "boot", "home", a game's name, or "error" */
int  bk_host_games(void);                            /* entries on the home screen (games then apps) */
const char *bk_host_game_name(int i);
int  bk_host_paused_count(void);
size_t bk_host_lua_bytes(void);                      /* Lua memory of the cart that runs now */
size_t bk_host_lua_peak(void);                       /* most Lua memory it used */
const char *bk_host_last_error(void);
int  bk_host_recording(void);                        /* a clip is being recorded */
int  bk_host_launch(int n);                          /* as if picked on the home screen (1-based) */
void bk_host_go_home(void);                          /* as if Start+Select were held */
void bk_host_restart(int how);

/* Linked Bits (docs/DEVICE.md). Bits find each other by themselves; a game started on the home screen starts on
   every Bit that is on its home screen too, and they play it in lockstep (every Bit runs every frame with every
   player's buttons, sent a few frames ahead). Games that use net_send() run on their own and talk with events. */
void bk_host_radio_recv(const void *pkt, int len);   /* a packet from another Bit: call between frames, on the loop's thread */
int  bk_host_linked(void);                           /* Bits in reach, this one too (1 = alone) */
int  bk_host_link_ready(void);                       /* players a game started now would have (this Bit + Bits on their home screens) */
int  bk_host_link_players(void);                     /* players in the linked game running now, 0 = none */
int  bk_host_racing(void);                           /* 1 while this Bit plays its own run in a linked race */
void bk_host_set_race_pick(int on);                  /* Select on the home screen: race games that can also be played together */
uint32_t bk_host_link_sync(uint32_t *frame);         /* lockstep frames run and a hash of their buttons and rnd() state */
int  bk_host_net_heard(void);                        /* net_send() events from other Bits so far */                       /* the game shell's _restart(): 1 title, 2 new game, 3 play */
