/* Demo cart "Deepglow": dive a dark sea cave for glowing pearls. Shows off BitKit's shaders. Original art and code. MIT License. */
(function () {
  const code = `-- Deepglow: dive a dark sea cave for glowing pearls. A tour of BitKit's shaders.
-- The deeper you swim the darker it gets, and pearls only shine when your sonar finds them.
-- Carry pearls up to the boat to keep them. Run out of air and you lose the ones you carry.
--   D-pad: swim     A: sonar ping     B: dash     Start: pause
-- Shaders used (called in _draw after the world and before the HUD; see the Help tab):
--   wave()      the water wobbles below the surface, heat shimmers over the vents
--   tint()      a red flash when a vent burns you
--   fog()       the water gets darker the deeper you go
--   ripple()    the sonar ping pushes the picture outward as it spreads
--   remap()     the jellyfish glow cycles through colours
--   glitch()    a jellyfish sting scrambles the picture
--   pixelate() and dither()   blacking out, and coming round again
--   raster()    our own scanline shader: the shimmer just under the surface
--   display()   Settings > Screen gives the whole game a look (CRT, Old TV, Sepia...)
-- Sprite shaders (sprfx{}): the diver is lit from above with an outline, flashes when hurt and
-- dissolves when blacking out; pearls are lit by the diver's lamp.
-- The title screen has a Shader gallery to try each one with a slider.

W, BOTTOM, SURF = 320, 1840, 40               -- world width, sea floor, surface (pixels)
AIR_MAX = tune("Air (seconds)", 30, 10, 90) * 60
SWIM = tune("Swim speed", 1.6, 0.8, 3, 0.1)
PING_SHOW = tune("Sonar shows pearls for (frames)", 200, 60, 600, 10)
GOAL = 5
LOOKS = { "off", "crt", "arcade", "old tv", "handheld", "sepia", "night", "vivid" }
LOOK_NAMES = { "Clear", "CRT", "Arcade", "Old TV", "Handheld", "Sepia", "Night", "Vivid" }
JELLY_GLOW = { 4, 5, 22, 23, 22, 5 }          -- remap() colour cycle for the jellyfish

-- ---------------------------------------------------------------- the cave
-- Walls are smooth sine curves, so they cost nothing to store. Near the surface the sea is open.
function walls(y)
  if y < SURF + 20 then return 0, W end
  local k = math.min(1, (y - SURF - 20) / 120)
  local l = 18 + 34 * (1 + math.sin(y * 0.011)) + 16 * math.sin(y * 0.031 + 1)
  local r = 18 + 34 * (1 + math.sin(y * 0.0093 + 2)) + 16 * math.sin(y * 0.027 + 4)
  return l * k, W - r * k
end
function mid(y) local l, r = walls(y) return (l + r) / 2 end

PEARL_AT = { { 330, -40 }, { 560, 50 }, { 790, -30 }, { 1020, 40 }, { 1250, -50 }, { 1480, 30 }, { 1730, 0 } }
VENT_AT = { { 470, "l" }, { 900, "r" }, { 1180, "l" }, { 1400, "r" }, { 1640, "l" } }
JELLY_AT = { { 640, 30 }, { 980, -40 }, { 1320, 20 }, { 1560, -30 }, { 1780, 40 } }
POCKET_AT = { { 760, "r" }, { 1350, "l" } }   -- air pockets in the wall: stay inside to breathe

function build()
  pearls = {}
  for i, p in ipairs(PEARL_AT) do pearls[i] = { x = mid(p[1]) + p[2], y = p[1], got = false, carried = false, seen = 0 } end
  vents = {}
  for i, v in ipairs(VENT_AT) do
    local l, r = walls(v[1])
    vents[i] = { x = v[2] == "l" and l + 10 or r - 10, y = v[1] }
  end
  jellies = {}
  for i, j in ipairs(JELLY_AT) do jellies[i] = { ax = mid(j[1]) + j[2], ay = j[1], x = 0, y = 0, ph = i * 1.7 } end
  pockets = {}
  for i, p in ipairs(POCKET_AT) do
    local l, r = walls(p[1])
    pockets[i] = { x = p[2] == "l" and l + 14 or r - 14, y = p[1] }
  end
end

function reset_diver()
  px, py, vx, vy, face = 170, SURF + 4, 0, 0, 1
  air, dash_cd, ping, burn, sting, out = AIR_MAX, 0, nil, 0, 0, 0
end

function banked()
  local n = 0
  for _, p in ipairs(pearls) do if p.got and not p.carried then n = n + 1 end end
  return n
end
function carried()
  local n = 0
  for _, p in ipairs(pearls) do if p.carried then n = n + 1 end end
  return n
end

function _init()
  game{
    title = "Deepglow",
    goal = "Bring " .. GOAL .. " glowing pearls up from the deep cave to your boat.",
    help = {
      "D-pad: swim. B: dash. A: sonar ping.",
      "It is dark down there. A sonar ping lights up pearls for a few seconds.",
      "Swim up to the boat to keep the pearls you carry, and to fill up on air.",
      "Air pockets in the cave walls let you breathe too.",
      "Vents burn and jellyfish sting: both cost air. Run out and you drop what you carry.",
      "Settings > Screen gives the game an old CRT or TV look.",
    },
    settings = { { key = "screen", name = "Screen", values = LOOK_NAMES, value = 1 } },
    menu = { { "Shader gallery", function() gallery_open() end } },
    continue = function(cp)
      build(); reset_diver()
      for _, i in ipairs(cp.got or {}) do if pearls[i] then pearls[i].got = true end end
    end,
    new_game = function() build(); reset_diver() end,
  }
  build(); reset_diver()
  look = nil
end

-- the Screen setting picks a display() look. "Clear" leaves whatever the studio's Game tab set alone.
function apply_look()
  local l = setting("screen") or 1
  if l ~= look then
    if look ~= nil or l > 1 then display(LOOKS[l]) end
    look = l
  end
end

-- ---------------------------------------------------------------- playing
function hurt(kind, dx)
  if out > 0 then return end
  if kind == "burn" then
    if burn > 20 then return end
    burn, air = 40, air - 4 * 60
    sfx(40, 3, 0.5, 14)
  else
    if sting > 20 then return end
    sting, air = 45, air - 5 * 60
    sfx("C3", 2, 0.4, 20, nil, 0, -200)
  end
  vx = vx + dx * 2.5; vy = vy - 1
end

function _update()
  apply_look()
  if GAME.state == "screen" then gallery_update() return end
  if burn > 0 then burn = burn - 1 end
  if sting > 0 then sting = sting - 1 end
  for _, j in ipairs(jellies) do
    j.x = j.ax + math.sin(t() / 70 + j.ph) * 30
    j.y = j.ay + math.sin(t() / 45 + j.ph * 2) * 18
  end
  if ping then
    ping.r = ping.r + 4
    for _, p in ipairs(pearls) do
      local d = math.sqrt((p.x - ping.x) ^ 2 + (p.y - ping.y) ^ 2)
      if not p.got and d < ping.r and d > ping.r - 6 then p.seen = PING_SHOW; sfx("A6", 4, 0.25, 6) end
    end
    if ping.r > 220 then ping = nil end
  end
  for _, p in ipairs(pearls) do if p.seen > 0 then p.seen = p.seen - 1 end end

  if out > 0 then                                    -- blacked out: fade away, wake up at the boat
    out = out + 1
    if out == 70 then
      for _, p in ipairs(pearls) do if p.carried then p.carried, p.got = false, false end end
      reset_diver(); out = -60
    end
    return
  end
  if out < 0 then out = out + 1 end

  local ax, ay = 0, 0
  if btn("left") then ax = -1; face = -1 end
  if btn("right") then ax = 1; face = 1 end
  if btn("up") then ay = -1 end
  if btn("down") then ay = 1 end
  vx = vx + ax * 0.14; vy = vy + ay * 0.14 - 0.008
  if dash_cd > 0 then dash_cd = dash_cd - 1 end
  if btnp("b") and dash_cd == 0 then
    local dx, dy = ax, ay
    if dx == 0 and dy == 0 then dx = face end
    local n = math.sqrt(dx * dx + dy * dy)
    vx, vy, dash_cd = vx + dx / n * 3.5, vy + dy / n * 3.5, 40
    sfx("G3", 3, 0.25, 8, nil, 0, 400)
  end
  if btnp("a") and not ping then ping = { x = px, y = py, r = 0 }; sfx("C6", 4, 0.35, 40, nil, 0, -600) end
  local sp = math.sqrt(vx * vx + vy * vy)
  local top = SWIM * (dash_cd > 25 and 2.6 or 1)
  if sp > top then vx, vy = vx / sp * top, vy / sp * top end
  vx, vy = vx * 0.95, vy * 0.95
  px, py = px + vx, py + vy

  -- walls, floor and surface
  local l, r = walls(py)
  if px < l + 7 then px, vx = l + 7, math.abs(vx) * 0.3 end
  if px > r - 7 then px, vx = r - 7, -math.abs(vx) * 0.3 end
  if py > BOTTOM - 8 then py, vy = BOTTOM - 8, 0 end
  if py < SURF then py, vy = SURF, math.max(vy, 0) end

  -- air
  local breathing = py <= SURF + 3
  for _, k in ipairs(pockets) do if math.abs(px - k.x) < 16 and math.abs(py - k.y) < 14 then breathing = true end end
  if breathing then air = math.min(AIR_MAX, air + 6) else air = air - 1 end
  if air <= 0 then air = 0; out = 1; sfx("C2", 1, 0.5, 60, nil, 0, -50) return end

  -- pearls
  for i, p in ipairs(pearls) do
    if not p.got and math.abs(px - p.x) < 10 and math.abs(py - p.y) < 10 then
      p.got, p.carried = true, true
      sfx("E6", 1, 0.4, 10); sfx("B6", 1, 0.3, 14)
    end
  end
  -- the boat: keep what you carry
  if py <= SURF + 3 and math.abs(px - 170) < 34 and carried() > 0 then
    local got = {}
    for i, p in ipairs(pearls) do if p.carried then p.carried = false end; if p.got then got[#got + 1] = i end end
    checkpoint({ got = got })
    sfx("C5", 1, 0.4, 10); sfx("G5", 1, 0.4, 16)
    if banked() >= GOAL then game_win("You brought " .. banked() .. " glowing pearls up from the deep!") end
  end
  -- vents and jellyfish
  for _, v in ipairs(vents) do
    if math.abs(px - v.x) < 12 and py < v.y and py > v.y - 90 then hurt("burn", px < v.x and -1 or 1) end
  end
  for _, j in ipairs(jellies) do
    if math.abs(px - j.x) < 11 and math.abs(py - j.y - 4) < 13 then hurt("sting", px < j.x and -1 or 1) end
  end
end

-- ---------------------------------------------------------------- drawing
function cam_y() return math.max(0, math.min(BOTTOM + 8 - 240, math.floor(py - 110))) end
function darkness(y) return math.max(0, math.min(1, (y - SURF - 40) / 1100)) end

function draw_world(cy)
  camera(0, cy)
  rectfill(0, cy, W, 240, 21)                                    -- water
  if cy < SURF then
    rectfill(0, 0, W, SURF, 23)                                  -- sky
    circfill(270, 16, 9, 27)
    for i = 0, 7 do line(i * 44 + (t() // 4) % 44 - 20, SURF, i * 44 + (t() // 4) % 44, SURF, 22) end
    -- the boat
    rectfill(140, SURF - 8, 62, 8, 8); rectfill(146, SURF - 2, 50, 4, 7)
    line(170, SURF - 30, 170, SURF - 8, 7); rectfill(171, SURF - 28, 16, 12, 13)
  end
  -- cave walls, two rows at a time
  for sy = 0, 239, 2 do
    local y = cy + sy
    local l, r = walls(y)
    if l > 0 then rectfill(0, y, l, 2, 30); pset(l - 1, y, 28) end
    if r < W then rectfill(r, y, W - r, 2, 30); pset(r, y, 28) end
  end
  if cy + 240 > BOTTOM then rectfill(0, BOTTOM, W, 40, 31) end
  -- seaweed on the walls
  for y = (cy // 60) * 60, cy + 240, 60 do
    if y > SURF + 60 then
      local l, r = walls(y)
      for k = 0, 5 do
        local s = math.sin(t() / 30 + y + k * 0.6) * k * 1.4
        pset(l + k * 3 + s, y - k * 2, 16); pset(r - k * 3 - s, y + 20 - k * 2, 15)
      end
    end
  end
  for _, k in ipairs(pockets) do                                 -- air pockets: shimmering bubbles
    for i = 0, 4 do circ(k.x + math.sin(t() / 20 + i) * 6, k.y - ((t() + i * 9) % 26) + 12, 1 + i % 2, 23) end
    circ(k.x, k.y, 14, 22)
  end
  for _, v in ipairs(vents) do                                   -- vents: a hot crack and rising bubbles
    rectfill(v.x - 6, v.y - 2, 13, 4, 9); rectfill(v.x - 3, v.y - 3, 7, 2, 27)
    for i = 0, 5 do pset(v.x + math.sin(t() / 6 + i * 2) * 5, v.y - ((t() * 2 + i * 15) % 90), 11) end
  end
end

function draw_glow(cy)
  camera(0, cy)
  for _, p in ipairs(pearls) do
    local near = math.abs(px - p.x) < 34 and math.abs(py - p.y) < 34
    if not p.got and (p.seen > 0 or near) then
      local pulse = 9 + math.sin(t() / 8) * 2
      if p.seen > 0 and p.seen < 40 and (p.seen // 4) % 2 == 0 then else
        circ(p.x, p.y, pulse, 23)
        sprfx{ light_at = { px, py }, light = 0.8 }    -- lit from the diver's lamp
        spr(66, p.x - 4, p.y - 4)
        sprfx()
      end
    end
  end
  for _, j in ipairs(jellies) do                                  -- jellyfish, drawn in colour 4; remap() cycles it
    circfill(j.x, j.y, 7, 4); circfill(j.x - 2, j.y - 2, 3, 5)
    for k = -2, 2 do
      local s = math.sin(t() / 10 + k) * 2
      line(j.x + k * 3, j.y + 5, j.x + k * 3 + s, j.y + 14, 4)
    end
  end
  -- the diver: lit from the surface, outlined so it reads in the dark, a flash when hurt, dissolving when out of air
  sprfx{ outline = 1, light = 0.7, light_x = 0, light_y = -1,
         flash = burn > 0 and 26 or (sting > 0 and 23 or nil), flash_amount = math.max(burn, sting) / 50,
         dissolve = out > 0 and out / 50 or (out < 0 and -out / 60 or 0) }
  spr(64, px - 8, py - 8, 2, 2, face < 0)
  sprfx{ light_at = { px, py }, light = 0.8 }          -- pearls you carry, lit by your lamp
  for _, p in ipairs(pearls) do if p.carried then spr(66, px - 4 + (face < 0 and 8 or -8), py - 2) end end
  sprfx()
end

function _draw()
  if GAME.state == "screen" then gallery_draw() return end
  local cy = cam_y()
  draw_world(cy)
  -- under water: the shaders work in screen space, inside clip()
  camera()
  local top = math.max(0, SURF - cy)
  if top < 240 then
    clip(0, top, W, 240 - top)
    wave(1.2, 70, 0.35)                                           -- gentle wobble
    -- our own scanline shader: a bright shimmer that fades out in the first rows under the surface
    raster(function(y)
      local d = y - top
      if d > 24 then return 0 end
      return math.sin(d * 0.9 + t() / 5) * (24 - d) / 10, 23, (24 - d) / 80
    end)
    fog(19, top, 239, darkness(cy + top), darkness(cy + 239))     -- darker with depth (toward deep navy)
    clip()
  end
  for _, v in ipairs(vents) do                                    -- heat shimmer over each vent
    local sy = v.y - cy
    if sy > -10 and sy - 90 < 240 then clip(v.x - 12, sy - 90, 24, 92) wave(2, 9, 3) clip() end
  end
  draw_glow(cy)                                                   -- glowing things go on top of the dark
  camera()
  remap(4, JELLY_GLOW[(t() // 8) % #JELLY_GLOW + 1])
  if ping then camera(0, cy) circ(ping.x, ping.y, ping.r, 22) ripple(ping.x, ping.y, ping.r, 5, 14) camera() end
  if burn > 0 then tint(26, burn / 70) end
  if sting > 0 then glitch(sting / 50, t() // 3) end
  if out > 0 then pixelate(1 + out // 5) dither(0, out / 60) end  -- blacking out
  if out < 0 then dither(0, -out / 60) pixelate(1 - out // 8) end -- coming round at the boat
  -- HUD
  rectfill(6, 6, 104, 10, 1); rectfill(8, 8, 100 * air // AIR_MAX, 6, air < AIR_MAX / 4 and (t() // 8 % 2 == 0 and 26 or 25) or 22)
  text("AIR", 112, 7, 13)
  for i = 1, GOAL do
    local n = banked()
    if i <= n then spr(66, 200 + i * 11, 6) else circ(204 + i * 11, 10, 3, 29) end
  end
  if carried() > 0 then text("+" .. carried(), 270, 7, 23) end
  text(math.floor(math.max(0, py - SURF) / 8) .. "m", 8, 226, 29)
  if out > 20 then text("out of air...", 110, 116, 13) end
end

-- ---------------------------------------------------------------- shader gallery (title screen menu)
GALLERY = {   -- name, screen shader (amount), code to show, sprite shader for the diver (amount)
  { "tint", function(a) tint(25, a) end, function(a) return "tint(25, " .. a .. ")" end },
  { "fog", function(a) fog(0, 40, 239, 0, a) end, function(a) return "fog(0, 40, 239, 0, " .. a .. ")" end },
  { "dither", function(a) dither(1, a) end, function(a) return "dither(1, " .. a .. ")" end },
  { "remap", function(a) if a > 0 then remap(27, 26, 21, 17, 30, 3) end end, function(a) return a > 0 and "remap(27, 26, 21, 17, 30, 3)" or "(amount 0: off)" end },
  { "wave", function(a) wave(a * 10, 40, 1) end, function(a) return "wave(" .. a * 10 .. ", 40, 1)" end },
  { "wave (vertical)", function(a) wave(a * 10, 50, 1, true) end, function(a) return "wave(" .. a * 10 .. ", 50, 1, true)" end },
  { "ripple", function(a) ripple(160, 120, (t() * 3) % 200, a * 10, 16) end, function(a) return "ripple(160, 120, r, " .. a * 10 .. ", 16)" end },
  { "pixelate", function(a) pixelate(1 + a * 15 // 1) end, function(a) return "pixelate(" .. 1 + a * 15 // 1 .. ")" end },
  { "glitch", function(a) glitch(a, t() // 4) end, function(a) return "glitch(" .. a .. ")" end },
  { "shade", function(a) shade(a) end, function(a) return "shade(" .. a .. ")" end },
  { "raster (your own)", function(a) raster(function(y) return math.sin(y / 9 + t() / 10) * a * 8, 1, a * y / 300 end) end,
    function(a) return "raster(fn): row slide + tint" end },
  { "sprite: outline", nil, function() return "sprfx{outline = 27}" end, function(a) sprfx{ outline = 27 } end },
  { "sprite: light", nil, function(a) return "sprfx{light = " .. a .. "}" end, function(a) sprfx{ light = a } end },
  { "sprite: torch", nil, function(a) return "sprfx{light_at = {sun}, light = " .. a .. "}" end,
    function(a) sprfx{ light_at = { 160 + math.cos(t() / 40) * 150, 110 + math.sin(t() / 40) * 100 }, light = a } end },
  { "sprite: flash", nil, function(a) return "sprfx{flash = 13, flash_amount = " .. a .. "}" end, function(a) sprfx{ flash = 13, flash_amount = a } end },
  { "sprite: dissolve", nil, function(a) return "sprfx{dissolve = " .. a .. "}" end, function(a) sprfx{ dissolve = a } end },
  { "sprite: silhouette", nil, function() return "sprfx{silhouette = 1, outline = 27}" end, function(a) sprfx{ silhouette = 1, outline = 27 } end },
  { "sprite: shadow", nil, function() return "sprfx{shadow = 1, shadow_x = 2, shadow_y = 2}" end, function(a) sprfx{ shadow = 1, shadow_x = 2, shadow_y = 2 } end },
  { "sprite: your own", nil, function() return "sprfx{shader = function(x, y, c) ...}" end,
    function(a) sprfx{ shader = function(x, y, c, w, h)       -- a scan bar sweeping down the sprite
      if c and math.abs(y - (t() // 3) % h) < 2 then return 23 end
      return c
    end } end },
}
for i = 2, #LOOKS do
  local name = LOOKS[i]
  GALLERY[#GALLERY + 1] = { "display: " .. name, nil, function() return 'display("' .. name .. '")' end, look = name }
end

function gallery_open() gal, gal_amt = 1, 0.5; game_screen() end
function gallery_update()
  if btnp("left") then gal = (gal - 2) % #GALLERY + 1 end
  if btnp("right") then gal = gal % #GALLERY + 1 end
  if btnp("up") then gal_amt = math.min(1, gal_amt + 0.1) end
  if btnp("down") then gal_amt = math.max(0, gal_amt - 0.1) end
  gal_amt = math.floor(gal_amt * 10 + 0.5) / 10
  local g = GALLERY[gal]
  display(g.look or LOOKS[setting("screen") or 1])
  if btnp("b") then look = nil; display(LOOKS[setting("screen") or 1]); game_title() end
end
function gallery_draw()
  local g = GALLERY[gal]
  -- a test picture: sky, sea, the diver, a pearl, colour bars
  cls(21)
  rectfill(0, 0, W, 40, 23); circfill(270, 18, 10, 27)
  for i = 0, 15 do rectfill(i * 20, 172, 20, 20, 32 + i * 13) end
  for i = 0, 15 do rectfill(i * 20, 192, 20, 6, i) end
  rectfill(0, 142, 60, 30, 30); rectfill(260, 122, 60, 50, 30)
  circfill(100, 110, 26, 27); circfill(100, 110, 16, 11)
  if g[4] then g[4](gal_amt) end
  spr(64, 200, 96, 2, 2, false, false, 3); spr(66, 160, 120, 1, 1, false, false, 2)
  sprfx()
  if g[1] == "sprite: torch" then circfill(160 + math.cos(t() / 40) * 150, 110 + math.sin(t() / 40) * 100, 4, 27) end
  text("BITKIT", 128, 60, 13, 2)
  if g[2] then g[2](gal_amt) end
  rectfill(0, 200, W, 40, 1)
  text("< " .. gal .. "/" .. #GALLERY .. " " .. g[1] .. " >", 8, 203, 27)
  text(g[3](gal_amt), 8, 215, 13)
  text((g[2] or g[4]) and "</>: shader  up/down: amount  B: back" or "</>: shader  B: back", 8, 228, 29)
end
`;

  const K = { '.': 0, 1: 1, 7: 27, 6: 22, 3: 13, 9: 29, a: 10, b: 25, d: 12, e: 23 };
  const ART = {
    64: ['................',
         '......1111......',
         '.....177771.....',
         '....17666671....',
         '....17636671....',
         '....17666671....',
         '.....177771.....',
         '...99aaaaaa1....',
         '..9aaaaaaaaa1...',
         '..9aaaaaaaaaa1..',
         '...1aaaaaaaa1...',
         '....1aa11aa1....',
         '....bbb..bbb....',
         '...bbbb..bbbb...',
         '..bbbb....bbbb..',
         '................'],
    66: ['..1111..',
         '.1dddd1.',
         '1dd33dd1',
         '1d3dddd1',
         '1dddded1',
         '1ddddde1',
         '.1edde1.',
         '..1111..'],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const t = +n + (y >> 3) * 16 + (x >> 3);
        cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
      }));
    // Deepglow draws everything itself. The diver entity type is there so the Bit's home screen can use it as the icon.
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'diver', anims: [{ name: 'idle', frames: [64], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Sea cave', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Deepglow', code, buildGfx,
    about: 'Dive a dark sea cave for glowing pearls. A tour of the shaders: water wobble, depth fog, sonar ripples, glitches and CRT looks, plus a Shader gallery.' });
})();
