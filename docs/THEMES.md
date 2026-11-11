# Bit themes

A theme is how a PocketBit's own screens look and sound: the home screen, the boot animation and the Themes app.
Games keep their own look. Everything that draws a theme is Lua, in `studio/themes.js` (`BKThemes.LIB`), so the
studio and the ESP32-S3 run the same code.

## The theme

```lua
{
  name = "MEADOW",                 -- up to 16 letters
  c = {                            -- 16 colours, "rrggbb", put in palette slots 232-247 in this order
    bg, wall, wall2, card, edge, shade, accent, text, dim, bar, bartext, p1, p2, p3, p4, p5 },
  wall = "hills",    -- stars hills waves grid bubbles rain checks aurora plain picture
  speed = 3,         -- wallpaper motion 0 (still) - 10
  pic = "",          -- the picture wallpaper (see below)
  font = "bold",     -- classic bold slant heavy   (font() in the runtime)
  outline = false,   -- letters outlined in the bar colour
  card = "round",    -- frame round shadow outline ticket
  bar = "float",     -- solid line float none       (the top and bottom system bars)
  sound = "soft",    -- blip soft chime retro clack mute
  boot = "bounce",   -- rise pixels scan bounce type none
  boottext = "",     -- the boot title; empty = the Bit's name
  look = "game",     -- the screen look (display()): game off crt arcade "old tv" handheld sepia night vivid
}
```

Anything missing or wrong is taken from the first preset (`theme_fix()` in Lua, `BKThemes.fix()` in JS).

**Picture wallpapers** are 80x60 pixels, each 0-15 (an index into the 16 colours, so changing a colour changes the
picture). They are run-length coded: a hex digit is a pixel, and letters `g`-`z` after it are how many times it
repeats, in base 20 (`g` = 0 ... `z` = 19). `"1"` is one pixel of colour 1, `"1ih"` is 41 of them. The home screen
keeps the picture in the tile sheet (x 0-79, y 192-251, tiles 384-463, written with `sset`) and draws it with one
`spr(384, x, 0, 10, 8, false, false, 4)` per frame.

## Where it is kept

The save file **"Bit theme"** holds `{theme = <the theme in use>, mine = {<up to 4 of the owner's themes>}}`, written
by the Themes app (`save()`) and the studio's My Bit tab. The owner's profile is in **"Bit settings"** (the Settings
app): `name` (up to 10 letters), `color` (a palette index), `bit` (the Bit's name, up to 14), next to `look`
(`"theme"` = the theme's look), `strength`, `bright`, `volume`.

## Sharing: `.bittheme` files

JSON: `{"format": "bitkit-theme", "version": 1, "theme": {...the table above...}}`. Export and Import are on the
studio's My Bit tab (`BKThemes.exportText` / `importText`).

## What the launcher (firmware) does

The studio is the reference: `studio/studio.js` (`bootBit`, `bootHome`, `namesLua`).

1. **Power on:** run the boot cart `BKThemes.LIB + BKThemes.BOOT` with
   `BOOT = {theme = <theme>, title = <boottext or Bit name or "PocketBit">, sub = "<NAME>'S BIT"}` in the data chunk.
   It calls `home()` when it is done (about 2.5 s) or a button is pressed. Skip it when `theme.boot == "none"`.
2. **Home screen:** run `BKThemes.LIB + BK_HOME` (studio/home.js) with the default palette and
   `BIT = {games = ..., theme = <theme>, me = {name = , color = , bit = }}`.
3. **Every game:** put `NAMES = {...}` and `NAME_COLORS = {...}` at the front of the data chunk: the owner's name alone,
   or in a lockstep linked game every seat's owner in seat order (the Bit that starts the game sends them with the
   roster, so every Bit has the same list). `player_name(n)` reads them. For network event games, the prelude sends
   the owner's name as a reserved event (`-7700`, 3 letters per number) every 2 seconds; `net_recv()` keeps those to
   itself and `net_name(id)` returns the name.
4. **The screen look:** `display()` with the Settings app's look, or the theme's when that is `"theme"`.

Runtime calls the theme code needs (all in `runtime/`, portable C): `font(style, [outline colour])`, `sget(x, y)`,
`sset(x, y, c)`, `palette(i, r, g, b)`, `display()`.
