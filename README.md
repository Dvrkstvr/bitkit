# MiniBoi

A DIY handheld game console (ESP32-S3, 320x240) with a browser studio for making games in Lua.
The same C runtime runs on the device and, compiled to WebAssembly, in the browser.

> "MiniBoi" is a working name. To rename, change `APP` in `studio/studio.js` and the titles in `studio/index.html`.

## Try it

Open `dist/miniboi-studio.html` in Chrome, Edge or Firefox. It is one self-contained file and works offline.
Plug in a controller and press any button on it so the browser sees it.

For development, serve the `studio/` folder:

```sh
cd studio && python3 -m http.server 8000   # then open http://localhost:8000
```

## What's in v0.1

- **Runtime** (`runtime/`): portable C. 320x240 framebuffer with a 256-colour palette, 512 tiles of 8x8,
  a 256x128 tile map, 12 buttons with analog `press()` 0-255, 8-channel stereo synth, deterministic RNG.
  Lua 5.4 with only safe libraries (no io/os), and a per-frame instruction budget so an infinite loop shows an error instead of freezing.
- **Studio** (`studio/`): code editor (CodeMirror) with Run and error-line highlighting, sprite editor
  (pen/fill/pick, 8/16/32 px, flip/rotate/copy/paste, flags, palette editing), map editor (paint/fill/pick, pan, screen guides),
  controller page (live `btn()`/`press()` view, remapping, threshold and deadzone), API help.
  Carts autosave in the browser and save/load as `.mboi` files (JSON).
- **Entities**: an Entities tab to make enemies, NPCs, projectiles, buttons and doors: sprite size, animations
  (idle/walk/jump play automatically), team, HP, touch damage, and a behavior tree (flow, checks, sensors, actions) with presets.
  Place them on the map's Entities layer. The entity system is Lua built into the runtime (`runtime/mb_entities.lua`), so it runs the same on the device.
- **Sensors and events**: `raycast`, `circlecast`, touch events, damage with teams and i-frames, `on`/`emit` events
  that behavior trees can send and hear.
- **Demo cart**: "Sprout Hop", a small platformer: analog run on R, pebbles on B, stompable slugs and bees, a seed-shooting flower, talking NPCs, and a pressure button that opens a gate.

## Controls

| MiniBoi | Gamepad (standard mapping) | Keyboard |
|---|---|---|
| D-pad | D-pad or left stick | Arrow keys |
| A / B / X / Y | South / East / West / North face buttons | Z / X / A / S |
| L / R | LB+LT / RB+RT (triggers are analog) | Q / W |
| Start / Select | Start / Back | Enter / Shift |

## Lua API (short)

`_init()`, `_update()`, `_draw()`; `cls pset pget line rect rectfill circ circfill text spr map mget mset fget fset camera clip pal palt palette`;
`btn btnp btnr press`; `sfx tone stop`; `t time rnd srand`;
`ents_update ents_draw ents_player ents_spawn ents_all ents_touch ents_kill ents_damage ents_reset ents_on`; `on emit raycast circlecast`; `print` writes to the console. Full reference in the studio's Help tab.

## Build the runtime

Needs [Emscripten](https://emscripten.org/docs/getting_started/downloads.html).

```sh
./build.sh                      # -> studio/runtime.js (WASM inlined)
node tools/smoke.mjs            # headless runtime test
python3 tools/bundle.py dist/miniboi-studio.html
```

## Layout

```
runtime/        C core shared by device and web (mb.h, mb_core.c, mb_lua.c, mb_font.h)
platform/web/   Emscripten host glue
studio/         Browser studio (plain HTML/JS, no build step)
third_party/    Lua 5.4.7 (MIT)
tools/          bundler and tests
```

## Credits and licences

MIT (see LICENSE). Lua 5.4 (MIT, PUC-Rio). CodeMirror 5 (MIT). 8x8 font: font8x8 by Daniel Hepper (public domain).
Inspired by fantasy consoles such as TIC-80 and PICO-8; no code copied from GPL projects.
