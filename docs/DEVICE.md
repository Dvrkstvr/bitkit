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
| Apps: Hexbeat, Loopbox, Game Boy, GBC, NES, Settings, Themes, Share | ✅ | ✅ | `device` CI job |
| Emulator apps: Game Boy, Game Boy Color, NES | ROMs in the browser | ✅ same C cores; your ROMs in `/sdcard/roms`, battery saves and states next to them | `device` CI job (test cards) |
| Bit themes: boot animation, themed home screen, owner's name in games (`player_name`) | ✅ | ✅ "Bit theme" save, same Lua (docs/THEMES.md) | `device` CI job |
| Save files, Continue, Delete save | ✅ | ✅ `<card>/bitkit/saves/<game>.sav` (or the internal flash) | `device` CI job |
| Bit settings: screen look, strength, brightness, volume, language | ✅ | ✅ look over every game, backlight PWM, volume, `lang` in the "Bit settings" save | `device` CI job |
| Languages: English, Deutsch, Français, Español (`lang()`, `tr()`, `texts{}`), accented letters in the font | ✅ | ✅ same runtime and font; host screens ("THE GAME STOPPED") translated in `bk_host.c` | `device` CI job, `tools/langtest.cjs` |
| Title screens, game shell, pause menu, `_restart()` | ✅ | ✅ (Lua, in the runtime) | `device` CI job |
| `level()` maps, cutscenes, entities | ✅ | ✅ | `device` CI job |
| Paused games (Start+Select, pick again to carry on) | heap snapshot | ✅ the game stays alive in PSRAM (up to 4; not kept through power off) | `device` CI job |
| Shaders, `sprfx`, `display{}` looks | ✅ | ✅ same C; full looks cost CPU, see below | `device` CI job |
| `music()` player | ✅ | ✅ (Lua) | `device` CI job |
| Photos and clips (Select+L, Select+R) | ✅ | ✅ PNG/GIF to `/sdcard/captures` | `device` CI job |
| `clock()` for idle games (Windrow's time away) | ✅ | ✅ PCF8563 RTC, or `time <unix>` on the console | build only |
| Analog `press()` | gamepad triggers | ✅ optional MCP3208 + Hall sensors, else 0/255 | build only |
| Linked play (lockstep, up to 8 Bits) and `net_send` events | ✅ BroadcastChannel | ✅ ESP-NOW broadcasts, see [Linked Bits](#linked-bits) | `device` CI job: two Bits over a socket, 15% packets lost |
| Share app: games, apps, photos and clips Bit to Bit | ✅ BroadcastChannel | ✅ ESP-NOW, see [Linked Bits](#linked-bits) | `device` CI job: `bitsim --share`, 15% packets lost |
| Frame-time budget per game | | ⚠️ estimated, see [Frame budget](#frame-budget); a benchmark build measures it on a board | `device` CI job (host times) |

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
8 MB PSRAM. Internal RAM keeps the DMA band buffers, stacks, the sprite-shader buffers and the radio (Wi-Fi's code stays in
flash, its buffers go to PSRAM where they can).
Each game may use 4 MB of Lua memory (menuconfig); past that it stops with "not enough memory" instead of crashing.

## Linked Bits

Like the studio's linked windows, PocketBits find each other by themselves: no pairing, no Wi-Fi network. Each Bit
broadcasts a hello over ESP-NOW once a second (its number, owner's name and colour, and whether it is on its home
screen), and the home screen shows every Bit in reach. A Bit not heard for 4 seconds is gone.

- **Lockstep games.** Picking a game on the home screen while other Bits are on theirs starts it on all of them (up to
  8; the Bit that picked it is player 1, and only player 1's Bit keeps the save file). Every Bit runs every frame with
  every player's buttons; each Bit sends its own 3 frames ahead, and every packet carries its last 10 frames, so a
  lost packet costs nothing. A Bit that is still waiting sends its buttons again every 4 frames. After a second of
  waiting a bar says which Bit is late; Start+Select then leaves the game for everyone.
- **Pause together.** Start+Select (or the pause menu's Home) by any player pauses the game on every Bit on the
  same frame. Each Bit keeps its copy in PSRAM; picking the game again with the same Bits carries on together.
- **Same game, same file.** The Bits check that they have the very same `.bitkit` file (a hash of it). A Bit
  without it says so and the game doesn't start (the studio sends the cart along). To get it over: the **Share** app below.
- **Player counts.** A game starts on no more Bits than its `game{players = ...}` takes (read from the cart's code
  when the memory card is scanned, `bk_cart_players`, the same rules as the studio). A one-player game plays alone,
  unless it has `race = "time"` or `"score"`: then START (flagged as a race, sent three times) starts it on every Bit
  on its home screen, each Bit playing its own run with `RACE` set, and the game shell sends its progress as `net_send`
  events under the race's own key. Leaving a race ends that Bit's run (it isn't kept paused).
- **`net_send` games** (Sweep Storm) never run in lockstep: each Bit plays its own copy, and the events go out
  as broadcasts, many to a packet, to every Bit playing a game with the same name.

- **The Share app** (Utilities row) sends games, utility apps, photos and clips to a Bit in reach. Both Bits open
  Share (it shows each Bit in reach as READY once it has Share open). OFFER (name, kind, size, hash) goes out every
  500 ms until the other Bit says yes or no; then DATA, 200 bytes a packet, up to 32 packets ahead of the last ACK.
  The receiver acknowledges every 8 packets, every 200 ms, and at once when one went missing, and the sender goes
  back to what is missing. The file is checked with its hash; a game must load as a cart. Games land in `games/`
  and on the home screen at once, photos and clips in `captures/`. Up to 4 MB.
  `bitsim --share` plays it between two Bits with 15% of the packets lost.

Packets are at most 250 bytes: `'B' 'K' 1 type from-id`, then HI, START (session, seats), IN (buttons and
pressure per frame), END, NET or SH_* (sharing) fields (`platform/device/bk_host.c`, "linked Bits"). Every Bit must be on the
same Wi-Fi channel (menuconfig, default 1).

Not handled yet: a Bit that drops out can't take its seat back (the studio can, from the host's checkpoints;
on the device the game ends for everyone when a player's Bit is gone), and games are only in step if their logic
uses `rnd()`, `t()` and buttons; `clock()` and `pairs()` over tables keyed by tables (whose order depends on memory
addresses, which differ between Bits) can drift. The CI test checks that two Bits stay in step frame by frame
(a hash of every frame's buttons and `rnd()` state) with 15% of packets lost.

## Frame budget

At 60 fps a frame has 16.7 ms: 4.0 million cycles of one 240 MHz core. The loop spends them on the Lua frame (the
game and the host), mixing the sound, and turning the screen into RGB565 (the DMA sends each band while the next
is converted, so sending is mostly free). Sound is cheap; the picture costs about 1-2 ms with no screen look.

**Measured on a board: not yet.** There is no PocketBit to run it on, and Espressif's QEMU for the S3 that
ESP-IDF 5.3 ships doesn't emulate PSRAM, which every game needs. So there are two things:

1. **Estimates** from the `device` CI job, which runs the same C and Lua on the CI machine (an x86 server core).
   The ESP32-S3 is roughly 30-60 times slower than that for this kind of work: it runs at 240 MHz, does about one
   instruction a cycle, has no hardware for Lua's double-precision numbers (only single precision), and Lua's
   memory is in PSRAM behind a 64 KB cache. The factor is a rule of thumb, not a measurement: treat the table as a
   ranking of which games are at risk. Numbers from one run (CI prints fresh ones in every run's summary):

| Game | CI host avg ms | estimate on the S3 (×30–60) | 60 fps? | Lua peak |
|---|---:|---:|---|---:|
| Sprout Hop | 0.83 | 25–50 ms | unlikely | 0.8 MB |
| Windrow | 1.08 | 32–65 ms | unlikely | 1.0 MB |
| Beacon Keeper | 0.23 | 7–14 ms | borderline | 0.7 MB |
| Sweep Storm | 1.15 | 34–69 ms | unlikely | 1.3 MB |
| Kart Lab | 2.94 | 88–177 ms | unlikely | 3.1 MB |
| Crossgate | 0.09 | 3–5 ms | likely | 0.6 MB |
| Tinwing | 1.80 | 54–108 ms | unlikely | 1.8 MB |
| Deepglow | 0.56 | 17–34 ms | unlikely | 0.5 MB |
| Puffball | 0.06 | 2–3 ms | likely | 0.5 MB |
| Hedge Hogs | 0.15 | 5–9 ms | likely | 0.6 MB |
| Cauldron Crew | 0.13 | 4–8 ms | likely | 0.5 MB |
| Mind Laps | 0.03 | 1–2 ms | likely | 0.5 MB |
| Hexbeat | 0.15 | 4–9 ms | likely | 0.5 MB |
| Loopbox | 0.15 | 5–9 ms | likely | 0.5 MB |
| Game Boy | 0.19 | 6–11 ms | likely (C core; the ×30–60 rule is pessimistic for C) | 0.4 MB |
| Game Boy Color | 0.21 | 6–13 ms | likely (C core; the ×30–60 rule is pessimistic for C) | 0.4 MB |
| NES | 1.08 | 32–65 ms | unlikely (C core; the ×30–60 rule is pessimistic for C) | 0.4 MB |
| Settings | 0.08 | 2–5 ms | likely | 0.3 MB |
| Themes | 0.09 | 3–6 ms | likely | 0.6 MB |

| Screen look | CI host ms | estimate on the S3 (×30–60) |
|---|---:|---:|
| off | 0.03 | 1–2 ms |
| sepia | 0.51 | 15–30 ms |
| vivid | 0.38 | 11–23 ms |
| night | 0.63 | 19–38 ms |
| handheld | 0.50 | 15–30 ms |
| arcade | 0.62 | 19–37 ms |
| crt | 0.76 | 23–45 ms |

   What it says: the small games and the apps fit. The big Lua games (Kart Lab, Tinwing, Sweep Storm, Windrow,
   Sprout Hop) probably run at 15-40 fps as they are. The full-screen looks (everything but "off") probably cost
   more than a whole frame by themselves: on the device they need a cheaper path (e.g. colour-only looks, or a
   look drawn at half resolution) before the Settings app should offer them there.

2. **The benchmark build**, for the real numbers. `sdkconfig.bench` turns on `BIT_BENCH`: at boot the firmware
   plays every built-in game for 600 frames with random buttons (no screen, sound card or radio needed, so a bare
   DevKit works) and prints a table of millions of cycles per frame (average, 95th percentile, worst) for the Lua
   frame, the sound and the picture, then the picture with every screen look:

   ```sh
   idf.py -B build-bench -DSDKCONFIG=build-bench/sdkconfig -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.bench" flash monitor
   ```

   CI builds it too: `benchmark/pocketbit.bin` in the **pocketbit-firmware** artifact (`FLASHING.txt` says how).
   Divide by 4.0 for the share of a 60 fps frame.

Ways to win the time back, once the board says how much is missing: draw the picture on the other core while
Lua runs the next frame (worth the picture's 1-2 ms, more with a look); keep Lua's interpreter loop in internal
RAM; let heavy games run their logic at 30 fps; or give the device build 32-bit float numbers (hardware FPU),
which would make it differ slightly from the studio and needs care for linked games.

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
platform/sim/build/bitsim --link build/flash build/link --loss 15    # two linked Bits as two processes
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
- How fast Lua runs from PSRAM: that decides which games reach 60 fps. Estimated in [Frame budget](#frame-budget);
  the benchmark build measures it on the first board.
- Analog buttons and the PCF8563.
- ESP-NOW between real Bits: range, lag (the 3-frame input delay assumes a few ms) and packet loss next to Wi-Fi,
  and whether internal RAM is enough with the radio on (the build leaves about 90 KB of internal RAM unused by
  static data; Wi-Fi takes some of that at run time, the rest is the game loop's 48 KB stack and the DMA bands).
