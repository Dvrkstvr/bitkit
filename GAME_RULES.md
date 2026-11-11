# BitKit game rules

Every BitKit game has the same five things, whether it ships with BitKit or comes from the community. They make any game on a PocketBit feel finished: you can pick it up, see what to do, play it to an end, put it down and come straight back.

| # | Rule | In short |
|---|---|---|
| 1 | **Main menu** | A title screen with New game (Continue once there is a save file) and Settings. |
| 2 | **One playable level, start to end** | At least one level you can play from the start to a finish. |
| 3 | **Quick resume** | Continue puts you straight back into play, or at your last checkpoint. |
| 4 | **Pause menu with settings** | Start pauses. The pause menu has Resume, Settings (at least the volume) and Quit to title. |
| 5 | **A clear goal** | One sentence on the title screen tells you what you're trying to do. |

You don't have to build any of this yourself. One call to `game{}` in `_init` gives your game the title screen, the pause menu, the settings, checkpoints and the "goal complete" screen, with the same look and buttons as every other BitKit game. The studio's **Checklist** button (and its Game tab) checks your game against the list.

## The smallest game that meets the rules

This is what **New** in the studio starts you with:

```lua
function _init()
  game{
    title = "my game",
    goal = "Catch 10 stars.",
    help = {"D-pad: move. A: beep."},
    continue = function(cp) score = cp.score end,   -- Continue on the title screen
  }
  x, y, score = 152, 112, 0
  new_star()
end

function new_star() sx, sy = rnd(16, 296), rnd(32, 216) end

function _update()
  if btn("left") then x = x - 2 end
  if btn("right") then x = x + 2 end
  if btn("up") then y = y - 2 end
  if btn("down") then y = y + 2 end
  if math.abs(x + 8 - sx) < 12 and math.abs(y + 8 - sy) < 12 then
    score = score + 1
    new_star()
    checkpoint({score = score})         -- remember the progress for Continue
    if score == 10 then game_win("You caught all 10 stars!") end
  end
end

function _draw()
  cls(1)
  circfill(sx, sy, 4, 27)
  rectfill(x, y, 16, 16, 17)
  text("stars " .. score .. "/10", 8, 8, 13)
end
```

## The rules in detail

### 1. Main menu

The game opens on a title screen, not in the middle of the action. It shows the game's name and goal and offers:

- **New game** the very first time, or **Continue** once the game has a save file (see below). Never both.
- **Settings**, with **Delete save** when there is a save file.
- **How to play**, if you pass `help`.

`game{title = "...", goal = "..."}` draws all of it over your game's first frame, so the title screen looks like your game with no extra art.

### 2. One playable level, start to end

There is at least one level that a player can finish: from New game, through the level, to an ending. "Endless" games (idle games, high-score chasers) still need a goal you can reach, like "guide 100 ships home"; the game can carry on afterwards.

When the player reaches the goal, call `game_win("what they did")`. It shows the **Goal complete** screen (after any cutscene that is playing ends), lets them keep playing or go back to the title, and puts a star on the title screen from then on.

### 3. Quick resume

Picking the game up again takes one button press. Two things make that happen:

- **Pausing on the Bit.** Leaving a game with Start+Select (or the home screen) keeps it exactly where it was. Picking it again on the home screen carries on mid-jump. The Bit does this for every game; you don't need any code.
- **Continue from a checkpoint.** After a reload or a restart, Continue on the title screen goes straight back into play: call `checkpoint({...})` whenever the player reaches a safe spot (a new level, a checkpoint flag, a finished race), and give `game{}` a `continue = function(cp) ... end` that puts the player back there. Games that already keep their own `save()` pass `can_continue = function() return saved() ~= nil end` instead, plus `new_game` to reset the game.

Continue never goes through extra screens: no "press start", no level select, no garage. Straight into the game.

### Save files

Every game has a save file, kept by the shell. The first time the player starts playing (New game, or a level picked from a level select), the save file is made, and from then on the title screen shows **Continue** instead of **New game**. Continue goes back to the last checkpoint, or to the start of the game if the player never reached one.

To start over, the player opens **Settings** (from the title or the pause menu) and picks **Delete save**. It asks first ("Delete your save? Your progress in this game is gone for good."), then wipes the checkpoint, the goal star and everything the game keeps with `save()`, and goes back to the title screen with **New game**. Volume and the game's own settings stay. If the game was already running, the Bit loads it again so nothing from the old save is left in memory.

You don't need any code for this. Runs started from an editor (▶ play level, ▶ race it) don't make a save file, and linked Bits ignore it (see Multiplayer).

### 4. Pause menu with settings

**Start** pauses the game (Start+Select still goes to the home screen, and Start still skips a cutscene). The pause menu has:

- **Resume** (B does the same).
- Anything game-specific you add with `pause = {{"Restart race", restart}}`.
- **Settings**: **Volume** always (it scales every `sfx()` and `tone()`), **Music** if you pass `music = true` and play music with `mus()`, and your own settings from `settings = {...}`. Read them with `setting("key")`. They are saved with the game.
- **How to play**, if you pass `help`.
- **Quit to title**.

Because Start belongs to the pause menu, don't use it for anything else in your game.

### 5. A clear goal

One sentence, shown on the title screen and in How to play, that says what winning means: "Reach the red flag at the end of Mossy Cave", "Finish 1st on every track". Show progress towards it while playing when you can (drops 3/10, ships home 37/100, wins 1/2).

## Multiplayer

Linked Bits run the same game in lockstep, so the shell keeps every Bit identical: menus are driven by the players' buttons only, saved checkpoints, save files and game settings are ignored while linked (volume still applies on each Bit), and Continue, Delete save and Quit to title are hidden. Your game should do the same: when `ME > 0`, don't let one Bit's save change the game.

Games for more Bits than lockstep can carry (10 to 20) use network events instead (`net_send`, `net_recv`, `NET_ID`; see the studio's Help tab). Those Bits aren't kept identical, so the shell treats them like single-player games: each Bit has its own menus, and the pause menu doesn't stop the match for the others. Sweep Storm is the example.

## `game{}` reference

```lua
game{
  title = "Sprout Hop",                        -- name on the title screen
  goal  = "Reach the red flag.",               -- one sentence
  help  = {"D-pad: move", "A: jump"},          -- How to play page (optional)
  continue = function(cp) ... end,             -- put the player back at checkpoint cp
  can_continue = function() return ... end,    -- Continue for games that keep their own save (optional)
  new_game = function() ... end,               -- reset such a game (optional)
  pause = {{"Back to checkpoint", fn}},        -- extra pause menu items (optional)
  menu = {{"Levels", fn}},                     -- extra title screen items, after New game / Continue (optional)
  settings = {                                 -- extra settings (optional)
    {key = "laps", name = "Laps", min = 1, max = 5, value = 3},
    {key = "ai", name = "Rivals", values = {"Easy", "Normal", "Hard"}, value = 2},
  },
  music = true,                                -- adds the Music level, for notes played with mus()
}
```

| Call | What it does |
|---|---|
| `checkpoint(t)` | Remember where to carry on. `t` is any table `save()` can store. `checkpoint(nil)` forgets it. |
| `game_win(text)` | The goal is reached: the Goal complete screen, and a star on the title. |
| `setting(key)` | A settings value. `"volume"` and `"music"` are 0 to 10. |
| `mus(note, ...)` | Same as `sfx()`, but also follows the Music level. |
| `game_play()` | Skip the menus and go straight into play (for example when a level is started from the editor). |
| `game_screen()` | Hand the screen to your own menu, like a level select: `_update` and `_draw` run, the shell draws nothing and Start does nothing. It isn't gameplay yet, so Continue on the title still works. Leave with `game_play()` or `game_title()`. |
| `game_title()` | Back to the title screen. |
| `GAME.state` | `"title"`, `"play"`, `"screen"`, `"pause"`, `"settings"`, `"help"`, `"confirm"` or `"won"`. |
| `GAME.items` | The names in the menu on screen, top to bottom (handy for tests). |

Sprout Hop shows how the pieces fit together for a level select: **Levels** on the title (`menu`) and in the pause menu (`pause`) opens a `game_screen()` that lists the levels you have reached with your stats for each (kept with `save()`), and starting one calls `game_play()`. Continue still skips it and goes straight back to the checkpoint.

The checkpoint and settings are stored in the game's save next to (not inside) what you keep with `save()`, so `save()` and `saved()` keep working as before.

The studio skips the title screen when you start a level, a cutscene or a track from an editor (▶ play level, ▶ race it). **Run** shows the title screen, like the Bit does.

The shell lives in [`runtime/bk_game.lua`](runtime/bk_game.lua), part of the runtime on both the web and the PocketBit.
