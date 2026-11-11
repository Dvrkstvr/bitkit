# BitKit on the PocketBit (ESP32-S3)

The same runtime that plays games in the studio runs on the PocketBit. This page is what the firmware does,
how to build and flash it, and what has and hasn't been tried on real hardware.

> **Status:** the firmware builds in CI and every built-in game and app plays through the device code in CI
> (headless, on Linux). **Nothing here has run on a real ESP32-S3 yet.** Drivers (screen, sound, buttons, SD card,
> clock) are written against ESP-IDF 5.3 and compile, but pins, timings and speed need a breadboard to confirm.

## What runs where

| | Studio's Bit | PocketBit firmware | Checked by |
|---|---|---|---|
| Home screen with games, icons and the Utilities row | ✅ | ✅ same `home.js` cart | `device` CI job |
| Built-in games (all demos) | ✅ | ✅ exported by `tools/export_device.cjs` into the internal flash | `device` CI job |
| Your own games | memory card folder | ✅ `.bitkit` files in `/sdcard/games` (the studio's own file, as is) | `device` CI job |
| Apps: Hexbeat, Loopbox, Settings | ✅ | ✅ | `device` CI job |
| Save files, Continue, Delete save | ✅ | ✅ `<card>/bitkit/saves/<game>.sav` (or the internal flash) | `device` CI job |
| Bit settings: screen look, strength, brightness, volume | ✅ | ✅ look over every game, backlight PWM, volume | `device` CI job |
| Title screens, game shell, pause menu, `_restart()` | ✅ | ✅ (Lua, in the runtime) | `device` CI job |
| `level()` maps, cutscenes, entities | ✅ | ✅ | `device` CI job |
| Paused games (Start+Select, pick again to carry on) | heap snapshot | ✅ the game stays alive in PSRAM (up to 4; not kept through power off) | `device` CI job |
| Shaders, `sprfx`, `display{}` looks | ✅ | ✅ same C; full looks cost CPU, see below | `device` CI job |
| `music()` player | ✅ | ✅ (Lua) | `device` CI job |
| Photos and clips (Select+L, Select+R) | ✅ | ✅ PNG/GIF to `/sdcard/captures` | `device` CI job |
| `clock()` for idle games (Windrow's time away) | ✅ | ✅ PCF8563 RTC, or `time <unix>` on the console | build only |
| Analog `press()` | gamepad triggers | ✅ optional MCP3208 + Hall sensors, else 0/255 | build only |
| Linked play (lockstep) and `net_send` events | ✅ BroadcastChannel | ⏳ ESP-NOW, next PR | |
| Frame-time budget per game | | ⏳ measured next PR | |

## How it fits together

```
runtime/              the C runtime + Lua (the same files the studio compiles to WebAssembly)
platform/device/      the PocketBit host in portable C: home screen, launching, pausing, saves, settings,
                      level maps, captures (bk_host.c), .bitkit files (bk_cart.c, bk_json.c)
platform/esp32s3/     ESP-IDF project: drivers + the 60 Hz loop (main/main.c), pins in menuconfig
platform/sim/         the same host on Linux without a screen; CI plays every game through it
tools/export_device.cjs   writes every built-in game and app as .bitkit files + the home screen cart
```

The frame on the device (core 1): read the buttons → `bk_host_frame` (one Lua frame and the host's requests) →
mix 735 samples of sound → turn the screen into RGB565 in 20-row bands, each band sent by DMA while the next is
converted → hand the sound to I2S. The I2S write waits while its two-frame buffer is full, so the sound card's clock
keeps the loop at 60 frames a second. Every 5 seconds the serial console prints where the time went, in this form:

```
bit: <game>: <fps> fps, frame <ms> (Lua+host <ms>, picture <ms>, idle <ms>), <n> late, Lua <KB>, PSRAM free <KB>, internal free <KB>
```

Memory: Lua, every cart's machine (~230 KB each: screen, tiles, map, heights, save) and the cart data live in the
8 MB PSRAM. Internal RAM keeps the DMA band buffers, stacks, the sprite-shader buffers and (later) the radio.
Each game may use 4 MB of Lua memory (menuconfig); past that it stops with "not enough memory" instead of crashing.

## Build and flash

```sh
node tools/export_device.cjs          # built-in games, apps and home screen -> platform/esp32s3/flash/
cd platform/esp32s3
idf.py set-target esp32s3             # ESP-IDF 5.3
idf.py menuconfig                     # PocketBit hardware: pins, SD card, RTC, analog buttons
idf.py flash monitor
```

No ESP-IDF? Every CI run keeps the flashable files as the **pocketbit-firmware** artifact (Actions → a run →
Artifacts); `FLASHING.txt` inside says how to flash them with `esptool.py`.

Test the device host on your computer without hardware:

```sh
node tools/export_device.cjs build/flash
platform/sim/build.sh
platform/sim/build/bitsim --test build/flash build/data --shots build/shots
```

## Prototype pins (ESP32-S3-DevKitC-1 N16R8)

All of them can be changed in `idf.py menuconfig` → *PocketBit hardware*. These are a starting point for a
breadboard, not the final board (that lives in the [pocketbit](https://github.com/Dvrkstvr/pocketbit) repo).

| Part | Pins |
|---|---|
| Screen ST7789, 8-bit parallel | D0-D7: 8 9 10 11 12 13 14 21, WR 15, DC 16, RESET 17, backlight 18, CS tied low, RD tied high |
| Sound, I2S to 2× MAX98357A | BCLK 4, LRCLK 5, DIN 6 (one amp set to left, one to right) |
| Buttons (to GND) | Left 42, Right 41, Up 1, Down 2, A 40, B 39, X 38, Y 7, L 47, R 48, Start 0 (the BOOT button), Select 46 |
| microSD, 1-bit SDMMC | CLK 43, CMD 44, D0 3 (the console uses the USB port, so the UART pins are free) |
| PCF8563 clock, analog-button ADC | off by default: there are no pins left on the DevKit; the real board needs an I/O expander or fewer direct buttons |

GPIO 26-37 are taken by the flash and the octal PSRAM. GPIO 45 is a strapping pin and is left alone.

## Not tried on hardware yet

- The panel init (ST7789 orientation, colour inversion, BGR), the 20 MHz write clock and tearing (no TE sync yet).
- I2S levels and the left/right split on the two amplifiers.
- SD card in 1-bit mode on those pins, and FAT write speed for clips while a game runs.
- How fast Lua runs from PSRAM: that decides which games reach 60 fps (next PR measures it).
- Analog buttons and the PCF8563.
