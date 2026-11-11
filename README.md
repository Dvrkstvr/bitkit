<div align="center">

<img src="docs/media/logo.svg" width="96" alt="PocketBit pixel logo">

# BitKit

**Make tiny games in your browser. Play them on a handheld you built yourself.**

The game runtime and browser studio for **PocketBit**, a DIY ESP32-S3 handheld.

[![CI](https://github.com/Dvrkstvr/bitkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Dvrkstvr/bitkit/actions/workflows/ci.yml)
[![Deploy](https://github.com/Dvrkstvr/bitkit/actions/workflows/pages.yml/badge.svg)](https://github.com/Dvrkstvr/bitkit/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-6abe30.svg)](LICENSE)
![Lua 5.4](https://img.shields.io/badge/Lua-5.4-2C2D72?logo=lua&logoColor=white)
![WebAssembly](https://img.shields.io/badge/WebAssembly-runtime-654FF0?logo=webassembly&logoColor=white)
![ESP32-S3](https://img.shields.io/badge/ESP32--S3-target-E7352C?logo=espressif&logoColor=white)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-4aa3df.svg)](CONTRIBUTING.md)

### [▶ Open the studio](https://dvrkstvr.github.io/bitkit/) · [Offline version](dist/bitkit-studio.html) · [Hardware repo](https://github.com/Dvrkstvr/pocketbit)

<img src="docs/media/sprout-hop.gif" width="560" alt="Sprout Hop, the demo game, running in BitKit">

</div>

---

## ✨ Why BitKit?

- 🎮 **Plug in a controller and play.** Press Run and you're testing with a real gamepad straight away. Analog triggers come through as `press()` from 0 to 255.
- 🧠 **One runtime, two homes.** The same C code runs on PocketBit and, compiled to WebAssembly, in your browser. What you test is what ships.
- 👾 **Enemies without code.** Build entities with sprites, animations, stats and a visual behavior tree, then paint them onto the map.
- ⚡ **Fast to change.** Edit code, art or a level, press Run, and see the change right away. Everything autosaves.
- 🔓 **Open all the way down.** MIT software and open hardware. No accounts and no installs.

## 🖼️ The studio

<img src="docs/media/studio-entities.png" alt="BitKit Studio entity editor with behavior tree">

| Tab | What it does |
|---|---|
| **Code** | Lua editor with syntax highlighting, error-line markers and a console |
| **Sprites** | 512 tiles of 8×8 pixels; pen, fill, pick, flip, rotate and flags; a 256-colour palette editor |
| **Map** | 256×128 tile map with Tiles and Entities layers. A ghost of your last 3 play routes shows where the player actually goes |
| **Entities** | Sprites, animations, team, HP, stats, effects (heal, slow…) and a behavior tree with presets |
| **Cutscenes** | Dialog with portraits, camera pans, walks, fades and screen shake. Play them when a level starts, from a trigger zone on the map, or from code |
| **Controller** | Live view of every button, remapping, threshold and deadzone |
| **✨ AI** | Chat with Claude or Gemini to make your game. It reads and changes code, sprites, maps and entities, tests the game, and shows you the changes to apply or discard |
| **Help** | Full API reference |

<details>
<summary>📸 More screenshots</summary>

<img src="docs/media/studio-map.png" alt="Map editor with the player route overlay">

</details>

### ✨ AI helper

The **AI** tab is a chat that can build your game with you: *"add coins the player can collect"*, *"draw a 16×16 slime and make it patrol"*, *"why do I fall through the floor?"*. It works on a copy of your cart, runs the game to check its work, and then shows a **Proposed changes** card with a code diff and new sprites. Nothing changes until you press **Apply**, and **Undo** puts things back.

- **Claude** (Anthropic) or **Gemini** (Google), your pick of model.
- **Bring your own API key.** BitKit has no server, so the studio calls the provider straight from your browser. The key is stored only in this browser (or only for this tab) and is only sent to that provider. Get one at [platform.claude.com](https://platform.claude.com/settings/keys) or [Google AI Studio](https://aistudio.google.com/apikey).
- A Claude Pro/Max or Gemini app subscription can't be used as the login: those plans don't include API access for other apps.

## 🚀 Quick start

1. Open **[dvrkstvr.github.io/bitkit](https://dvrkstvr.github.io/bitkit/)** in Chrome, Edge or Firefox.
2. Plug in a controller and press any button on it.
3. The studio starts on the Bit's home screen with every demo (Sprout Hop, Beacon Keeper, Kart Lab). Pick one with ← → and press A (Z on the keyboard). Hold Start+Select to come back.
4. Press **Run** (or Ctrl+Enter) to play the cart that is open in the studio.
5. Change something and press Run again.

Want it offline? [`dist/bitkit-studio.html`](dist/bitkit-studio.html) is one self-contained file.

A cart is just three functions:

```lua
function _init()   x, y = 160, 120 end
function _update()
  if btn("left")  then x = x - 1 end
  if btn("right") then x = x + 1 end
end
function _draw()   cls(1) circfill(x, y, 4 + press("r") / 32, 9) end
```

## 🌱 The demos

Press **Demo** in the studio to pick one.

### Sprout Hop

A small platformer that shows off most of the engine:

- Analog run on **R** and pebbles on **B**. Stomp slugs and bees.
- Water drops heal you. Mud and sticky seeds slow you down.
- Stand next to a **sapling** while it grows and fight off the bees it attracts. Once it's a tree, it's your checkpoint.
- Talking NPCs, and a pressure button that opens a gate.
- Two levels, with cutscenes when each one starts and when you reach the gate.
- Two players: pick **2 players** under the screen (player 2 is the blue sprout), or **2 Bits, linked** to play from two windows.

### Beacon Keeper

<img src="docs/media/beacon-keeper.png" width="480" alt="Beacon Keeper: a lighthouse beam guiding ships past rocks">

An idle game for 1 to 4 players. Player 1 is the lighthouse in the middle of a sea bigger than the screen. Everything is drawn from code, without a map or entities.

- Ships can't see the rocks. Aim your beam at them and they steer around the rocks into the harbour.
- Squeeze **R** for a brighter beam that burns lamp oil. Squeeze **L** for a narrow, long spotlight. **B** sounds the foghorn.
- Each day brings a sea haze that hides the rocks and shortens the beam. At night, pirates hunt the merchant ships, so keep your light on them until they flee.
- Docked ships pay tolls. Spend them in the harbour shop (**X**) on oil, a better lens, ship lanterns, coast cannons, a bigger harbour, and a clockwork lens that aims the beam for you.
- Players 2 to 4 row little boats (player 1 can hop into one with **Y**). They pick up the crates floating in the water, including the ones wrecks and sunk pirates drop, and bring them to the island. If a boat hits a rock, it spills its cargo.
- With one player it uses `save()`, `saved()` and `clock()`, so the harbour keeps earning while the Bit is off.

## 🏎️ The demo: Kart Lab (2.5D)

A kart racer drawn SNES-style: the map becomes a floor seen in perspective, with real hills, and karts, trees and items are scaled sprites.

- **It's all about the karts.** In the garage, pick a body (Dart, Brick, Hopper), an engine (Buzz 2-stroke, Twin, V-Torque), tyres (Slicks, Knobbly, Softs) and a paint job. Every part changes speed, accel, grip, weight, offroad and drift.
- **Analog throttle** on R: squeeze harder to go faster. B brakes. Steering comes in 3 stages that blend as you hold a direction: a tap nudges, a hold turns, a long hold turns hard.
- **Drift** with L (or B while on the throttle). The sparks go white, amber, then violet; let go for a boost.
- **Items** from crates, used with X: Nitro, Oil Slick, Bolt, Drone (chases the kart in front) and Shield. Rivals use them too.
- **Hills and jumps**: the ground rises and falls, and fast karts leave the ground over crests.
- **Tracks are levels on the Map tab.** Each has a `start` entity and `node` entities along the middle of the road, plus optional `boost` pads, `crate`s and `hill`/`bump`/`dip` entities. Move them around or add a level with **+ level**, and the road and hills are rebuilt when the race starts. Two tracks are included: Pinewood Loop and Quarry Hills.

<img src="docs/media/kart-lab-race.png" width="400" alt="Kart Lab race"> <img src="docs/media/kart-lab-garage.png" width="400" alt="Kart Lab garage">

## 🕹️ Controls

| PocketBit | Gamepad (standard mapping) | Keyboard |
|---|---|---|
| D-pad | D-pad or left stick | Arrow keys |
| A / B / X / Y | South / East / West / North | Z / X / A / S |
| L / R | LB+LT / RB+RT (analog) | Q / W |
| Start / Select | Start / Back | Enter / Shift |

## 📚 Lua API at a glance

| Area | Functions |
|---|---|
| Callbacks | `_init` `_update` `_draw` |
| Graphics | `cls pset pget line rect rectfill circ circfill text spr map camera clip pal palt palette` |
| Map | `mget mset fget fset` |
| 2.5D | `floor floorh hset hget depth project sspr` (perspective floor from the map, hills, world-to-screen, scaled sprites) |
| Input | `btn btnp btnr press` |
| Sound | `sfx tone stop` (8-voice stereo synth) |
| Entities | `ents_update ents_draw ents_player ents_spawn ents_all ents_touch ents_kill ents_damage ents_on` |
| Stats & effects | `stat stat_set fx_apply fx_has fx_remove fx_clear` |
| Sensors & events | `raycast circlecast on emit` |
| Levels & cutscenes | `level LEVEL LEVELS cutscene cutscene_playing` |
| Multiplayer | `btn(b, p) press(b, p) PLAYERS ME ents_players ents_player_pal` |
| Save data | `save saved clock` |
| Misc | `t time rnd srand print` |

The full reference is in the studio's **Help** tab.

## 🧩 Specs

| | |
|---|---|
| Screen | 320×240, 256-colour palette |
| Graphics | 512 tiles of 8×8, 256×128 map |
| Input | 12 buttons, analog pressure 0–255 |
| Audio | 8 voices, 6 waveforms, stereo |
| Scripting | Lua 5.4 in a sandbox with a per-frame instruction budget |
| Target | 60 fps locked |

## 🛠️ Build from source

Needs [Emscripten](https://emscripten.org/docs/getting_started/downloads.html) and Node.

```sh
./build.sh                                     # -> studio/runtime.js (WASM inlined)
node tools/ci.cjs                              # runtime checks + 3000 frames of the demo
python3 tools/bundle.py dist/bitkit-studio.html
cd studio && python3 -m http.server 8000       # dev server
```

```
runtime/        C core shared by device and web (bk.h, bk_core.c, bk_lua.c, bk_entities.lua)
platform/web/   Emscripten host glue
studio/         Browser studio (plain HTML/JS, no build step)
third_party/    Lua 5.4.7
tools/          bundler and tests
docs/media/     README images
```

## 🗺️ Roadmap

- [x] C + Lua runtime in WebAssembly
- [x] Studio: code, sprites, map, controller
- [x] Entity maker with behavior trees, sensors and events
- [x] Stats, effects and checkpoints
- [x] Player route overlay in the map editor
- [x] Levels and cutscenes
- [x] Multiplayer in the studio: two players on one screen, or two linked Bit windows in lockstep
- [ ] Music tracker and SFX editor
- [ ] Animation timeline editor
- [ ] ESP32-S3 host (PocketBit firmware)
- [ ] Local multiplayer over ESP-NOW
- [ ] Launcher, save states and utility apps

## 🤝 Contributing

Ideas, bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 Credits and licences

MIT (see [LICENSE](LICENSE)). Lua 5.4 (MIT, PUC-Rio). CodeMirror 5 (MIT). 8×8 font: font8x8 by Daniel Hepper (public domain).
Inspired by fantasy consoles such as TIC-80 and PICO-8. No code is copied from GPL projects.

<div align="center"><sub>Made for tinkerers who want to hold their games in their hands.</sub></div>
