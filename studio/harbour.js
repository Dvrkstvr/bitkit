/* Demo cart "Beacon Keeper": original art and code. MIT License. */
/* Named harbour.js, not beacon.js: ad and tracker blockers block any script called beacon.js. */
(function () {
  const code = `-- Beacon Keeper: a tiny BitKit demo (idle + action, 1-4 players)
-- You are the lighthouse in the middle of the sea. The ships can't see the rocks:
-- only your beam shows them the way to the harbour.
--   Player 1, at the lamp: left / right turns the beam
--     Squeeze R: a brighter beam that reaches further (burns lamp oil)
--     Squeeze L: a narrow, long spotlight
--     B: foghorn, slows every ship for a moment      X: harbour shop
--     Y: hop into your rowboat (and Y again to go back to the lamp)
--   Players 2-4 row the little boats: d-pad to row, squeeze R to row harder.
--     Pick up the crates floating in the water and bring them to the lighthouse island.
--     Wrecked ships and sunk pirates drop crates. Hit a rock and you spill your cargo.
-- Day: a sea haze hides the rocks and the beam doesn't reach as far.
-- Night: pirates hunt ships and loaded rowboats. Keep your light on them to scare them off;
--   coast cannons (shop) fire at every pirate your beam reveals.
-- Goal: guide 100 ships safely into the harbour (you can keep playing after that).
-- The clockwork lens (shop) sweeps the light for you. With one player the game uses
-- save(), saved() and clock(), so the harbour keeps earning while the Bit is off.

W, H = 480, 360                           -- the sea is bigger than the screen
LX, LY = 240, 168                         -- the lamp
ISLE = { x = 240, y = 186, r = 21 }       -- the lighthouse island (small, so the beam isn't hidden)
DAYLEN, NIGHTLEN = 60 * tune("Day length (seconds)", 60, 20, 180, 10), 60 * tune("Night length (seconds)", 60, 20, 180, 10)   -- tune(): sliders on the Game tab
DOCKS = { { x = 40, y = 340 }, { x = 440, y = 340 } }
CANNONS = { { x = 224, y = 196 }, { x = 256, y = 196 }, { x = 230, y = 203 }, { x = 250, y = 203 } }
MOOR = { { x = 212, y = 204 }, { x = 268, y = 204 }, { x = 212, y = 170 }, { x = 268, y = 170 } }   -- close enough to count as docked
PCOL = { 17, 21, 26, 27 }                 -- boat colours for players 1-4
CAP = tune("Crates a rowboat carries", 6, 2, 12)                                   -- crates a rowboat can carry
KINDS = {
  { spr = 1, w = 1, speed = 0.30, toll = 3,  r = 5 },   -- dinghy
  { spr = 2, w = 1, speed = 0.36, toll = 8,  r = 5 },   -- trawler
  { spr = 3, w = 2, speed = 0.42, toll = 25, r = 8 },   -- freighter
}
SHOP = {
  { key = "tank",    name = "Oil tank",       max = 5, base = 20,  info = "Hold more lamp oil." },
  { key = "lens",    name = "Polished lens",  max = 5, base = 30,  info = "The beam reaches further." },
  { key = "pump",    name = "Oil pump",       max = 5, base = 25,  info = "Oil refills faster." },
  { key = "lantern", name = "Ship lanterns",  max = 4, base = 50,  info = "Captains see rocks themselves." },
  { key = "cannon",  name = "Coast cannon",   max = 4, base = 80,  info = "Shoots pirates in your light." },
  { key = "harbour", name = "Bigger harbour", max = 4, base = 70,  info = "More ships, and bigger ones." },
  { key = "auto",    name = "Clockwork lens", max = 3, base = 120, info = "Sweeps the beam while you rest." },
}

GOAL = tune("Ships to bring home", 100, 10, 300, 10)                                -- ships to bring home

-- the title screen (game{title_draw = ...}): a night sea, the lighthouse turning its beam, and ships that
-- only show up when the light reaches them
function draw_title(t)
  local HOR, LX0, LY0 = 132, 64, 104
  cls(1)
  for i = 0, 46 do                                            -- stars
    local x, y = (i * 73 + i * i) % 320, (i * 37) % 128
    if (i + t // 24) % 9 > 0 then pset(x, y, i % 3 == 0 and 13 or 29) end
  end
  circfill(262, 108, 11, 12) circfill(267, 104, 10, 1)       -- the moon
  rectfill(0, HOR, 320, 108, 19)
  for r = 0, 13 do                                            -- waves: nearer rows are bigger and faster
    local y = HOR + 2 + r * r * 0.55
    local gap = 16 + r * 4
    for x = -(t * (0.15 + r * 0.06)) % gap - gap, 320, gap do line(x, y, x + 3 + r, y, r % 3 == 0 and 21 or 20) end
  end
  for k = 0, 5 do line(244 + (k * 7) % 13, 140 + k * 9, 258 + (k * 5) % 9, 140 + k * 9, 22) end   -- moonlight on the water
  -- the beam turns round the tower: it reaches across the sea, and widens when it points at us
  local a = t / 150
  local reach, toward = math.cos(a) * 360, math.sin(a)
  local spread = 4 + math.max(0, toward) * 26
  local function beam(c1, c2)
    for k = -spread, spread, 2 do line(LX0, LY0, LX0 + reach, LY0 + 26 + k, c1) end
    for k = -spread * 0.3, spread * 0.3, 1 do line(LX0, LY0, LX0 + reach * 0.9, LY0 + 24 + k, c2) end
  end
  local function lit(x) return (reach > 0 and x > LX0 and x < LX0 + reach) or (reach < 0 and x < LX0 and x > LX0 + reach) end
  if toward < 0 then beam(20, 21) end                         -- pointing away: dim, behind the tower
  for i = 0, 2 do                                             -- ships: ghosts in the dark, in colour in the light
    local x = (i * 150 + t * (0.2 + i * 0.07)) % 440 - 60
    local y = HOR + 6 + i * 14
    local on = lit(x) and toward > -0.6
    local hull, sail = on and 8 or 31, on and 12 or 30
    rectfill(x - 12, y - 4, 24, 4, hull) rectfill(x - 9, y, 18, 2, hull)
    line(x, y - 22, x, y - 4, hull)
    for s = 0, 14 do line(x + 1, y - 21 + s, x + 1 + s * 0.6, y - 21 + s, sail) end
    if on then pset(x - 10, y - 6, 27) end
  end
  for i = 0, 3 do                                             -- rocks
    local x, y = 120 + i * 53, HOR + 26 + (i * 17) % 40
    circfill(x, y, 5 + i % 3, lit(x) and 28 or 31)
  end
  for k = 0, 9 do                                             -- the rock the lighthouse stands on
    local w = 14 + k * 5
    rectfill(LX0 - w + (k * 7) % 5, 140 + k * 2, w * 2, 2, k < 3 and 30 or 31)
  end
  for k = 0, 4 do pset(LX0 - 30 + k * 13, 146 + (k * 5) % 9, 28) end
  for y = 112, 140 do                                         -- the tower, red and white
    local hw = 6 + (y - 112) / 28 * 5
    rectfill(LX0 - hw, y, hw * 2, 1, ((y - 112) // 7) % 2 == 0 and 25 or 13)
  end
  rectfill(LX0 - 9, 108, 18, 4, 31)                           -- gallery and lamp room
  rectfill(LX0 - 5, 98, 10, 10, 27)
  for k = 0, 6 do rectfill(LX0 - 7 + k, 97 - k, 14 - k * 2, 1, 25) end
  circfill(LX0, LY0, 3 + (t // 10) % 2, 12)
  if toward >= 0 then beam(11, 12) end                        -- pointing at us: bright, in front
end

function _init()
  -- title screen, pause menu (Start) and settings: the game shell (see GAME_RULES.md).
  -- The harbour saves itself every few seconds, so Continue carries on right where you left it.
  game{
    title = "Beacon Keeper",
    title_draw = draw_title,          -- its own animated title screen (above)
    look = { title = 27, shadow = 24, panel = 1, edge = 20, hi = 20, text = 23, pick = 27, goal = 22, footer = 22, menu = "right" },
    goal = "Guide " .. GOAL .. " ships safely into the harbour.",
    help = {
      "Left / right turns the beam. Squeeze R for a brighter beam, L for a narrow spotlight.",
      "B: foghorn. X: harbour shop. Y: step down to your rowboat and fetch crates.",
      "Ships only see the rocks in your light. At night, light up the pirates to scare them off.",
      "One keeper at a time. Everyone else rows: d-pad to row, R to row harder.",
      "Dock at the island and press Y to go ashore: the lamp if it's free, then any coast cannon (Y again for the next one).",
      "Manning a cannon: left / right aims, A fires. You can only swap stations while docked.",
    },
    can_continue = function() return PLAYERS == 1 and saved() ~= nil end,
    new_game = function() save(nil); _init() end,
  }
  G = { coins = 0, tank = 0, lens = 0, pump = 0, lantern = 0, cannon = 0, harbour = 0, auto = 0,
        day = 1, clk = 300, docked = 0, lost = 0, best = 0, goal = false }
  local d = saved and saved()
  if type(d) == "table" then
    for k, v in pairs(d) do if G[k] ~= nil and type(v) == type(G[k]) then G[k] = v end end
    G.ts = d.ts
  end
  ships, pirates, balls, fx, floats, loot = {}, {}, {}, {}, {}, {}
  angle, oil, streak, idle, horn, horn_cd = -math.pi / 2, max_oil(), 0, 0, 0, 0
  spawn_t, pirate_t, loot_t, shop, sel, save_t = 60, 600, 300, false, 1, 0
  bhalf, brange, beam_r = 0.3, 100, 0
  cannon_cd, cannon_by, cannon_ang = { 0, 0, 0, 0 }, { 0, 0, 0, 0 }, {}
  for c = 1, 4 do cannon_ang[c] = math.atan(CANNONS[c].y - ISLE.y, CANNONS[c].x - ISLE.x) end
  hint_t = G.docked < 10 and 1200 or 0
  boats = {}
  for n = 1, 4 do boats[n] = { n = n, x = MOOR[n].x, y = MOOR[n].y, vx = 0, vy = 0, a = 0, cargo = 0, val = 0, stun = 0 } end
  -- one keeper at a time: player 1 starts in the lighthouse, everyone else in a rowboat at the island
  role, lamp_pn = {}, 1
  for n = 1, 4 do role[n] = n == 1 and "lamp" or "boat" end
  new_rocks()
  wisps, waves, stars = {}, {}, {}
  for i = 1, 110 do wisps[i] = { x = rnd(W + 60) - 30, y = rnd(H - 30) + 4, w = rnd(20, 70), s = rnd(3) * 0.06 } end
  for i = 1, 90 do waves[i] = { rnd(W) - 1, rnd(H - 20) } end
  for i = 1, 60 do stars[i] = { rnd(W) - 1, rnd(H - 20) } end
  cam_x, cam_y = LX - 160, LY - 120
  if is_night() then banner("NIGHT " .. G.day, "Pirates! Light them up.") else banner("DAY " .. G.day, "Guide the ships through the haze.") end
  if PLAYERS == 1 then away_report() end   -- linked Bits must start the same, so no offline payout with friends
end

-- ---------------------------------------------------------------- helpers
function is_night() return G.clk >= DAYLEN end
function max_oil() return 40 + G.tank * 25 end
function cost(it) return math.floor(it.base * 2.1 ^ G[it.key]) end
function dist2(ax, ay, bx, by) return (ax - bx) ^ 2 + (ay - by) ^ 2 end
function wrap(a) return (a + math.pi) % (2 * math.pi) - math.pi end
function mult() return 1 + math.min(streak // 5, 4) end
function spawn_every() return math.max(100, 280 - G.harbour * 40 - G.day * 6) end
function auto_on() return G.auto > 0 and idle > 120 end
function boat_on(b) return b.n <= PLAYERS and role[b.n] == "boat" end
function at_isle(b) return dist2(b.x, b.y, ISLE.x, ISLE.y) < (ISLE.r + 16) ^ 2 end
function station_of(pn) return role[pn] == "lamp" and 0 or role[pn] == "boat" and -1 or role[pn] end

function fmt(n)
  n = math.floor(n)
  if n < 10000 then return tostring(n) end
  if n < 1000000 then return string.format("%.1fK", n / 1000) end
  return string.format("%.1fM", n / 1000000)
end

function banner(s, sub) banner_s, banner_sub, banner_t = s, sub, 150 end
function float(x, y, s, c) floats[#floats + 1] = { x = x, y = y, s = s, c = c, t = 50 } end
function burst(x, y, c, n)
  for i = 1, n do fx[#fx + 1] = { x = x, y = y, vx = rnd() * 2 - 1, vy = -rnd() * 1.4, t = 20 + rnd(20), c = c } end
end
function drop_loot(x, y, n, v)
  for i = 1, n do
    if #loot < 30 then loot[#loot + 1] = { x = x + rnd(-10, 10), y = y + rnd(-10, 10), v = v, life = 5400, bob = rnd(60) } end
  end
end

function persist()
  if not save then return end
  G.ts = clock and clock() or nil
  save(G)
end

-- is a point inside the beam?
function lit(x, y)
  local dx, dy = x - LX, y - LY
  local d2 = dx * dx + dy * dy
  if d2 < 900 then return true end
  if d2 > brange * brange then return false end
  return math.abs(wrap(math.atan(dy, dx) - angle)) < bhalf
end

-- rocks for the day. The same day always gets the same rocks; new rocks never appear on a boat.
function new_rocks()
  srand(G.day * 7919 + 13)
  rocks = {}
  local n = math.min(14 + G.day, 26)
  for tries = 1, 800 do
    if #rocks >= n then break end
    local r = { x = rnd(16, W - 16), y = rnd(30, H - 50), r = rnd(4, 7 + math.min(G.day, 4)) }
    local ok = dist2(r.x, r.y, ISLE.x, ISLE.y) > (ISLE.r + r.r + 40) ^ 2
    for _, d in ipairs(DOCKS) do if dist2(r.x, r.y, d.x, d.y) < 50 * 50 then ok = false end end
    for _, o in ipairs(rocks) do if dist2(o.x, o.y, r.x, r.y) < (o.r + r.r + 18) ^ 2 then ok = false break end end
    for _, s in ipairs(ships) do if dist2(s.x, s.y, r.x, r.y) < (r.r + 24) ^ 2 then ok = false break end end
    for _, b in ipairs(boats) do if dist2(b.x, b.y, r.x, r.y) < (r.r + 20) ^ 2 then ok = false break end end
    if ok then
      r.b = { { rnd(-2, 2), rnd(-2, 2), r.r }, { rnd(-r.r, r.r) // 2, rnd(-2, 1), r.r * 2 // 3 } }
      rocks[#rocks + 1] = r
    end
  end
  srand(G.day * 31 + G.clk + G.docked)
end

function hit_rock(x, y, rr)
  for _, r in ipairs(rocks) do if dist2(x, y, r.x, r.y) < (r.r + rr) ^ 2 then return r end end
  if dist2(x, y, ISLE.x, ISLE.y) < (ISLE.r + rr) ^ 2 then return ISLE end
end

-- steering: head for (wx, wy) but go around the rocks this boat knows about
function avoid(o, wx, wy, sees_all, lamp)
  local ox, oy = wx, wy
  local function push(r, reach)
    local rx, ry = r.x - o.x, r.y - o.y
    local d = math.sqrt(rx * rx + ry * ry) + 0.001
    if d < reach and rx * ox + ry * oy > -r.r then
      local w = (reach - d) / reach * 3
      local px, py = -ry / d, rx / d
      if px * ox + py * oy < 0 then px, py = -px, -py end
      wx = wx + (px * 1.4 - rx / d) * w
      wy = wy + (py * 1.4 - ry / d) * w
    end
  end
  for _, r in ipairs(rocks) do
    if sees_all then push(r, r.r + 30)
    elseif lamp and dist2(o.x, o.y, r.x, r.y) < (r.r + 30) ^ 2 then push(r, r.r + 22) end
  end
  push(ISLE, ISLE.r + 24)                -- everyone can see the lighthouse island
  return wx, wy
end

function turn_to(o, wx, wy, rate)
  o.a = o.a + math.max(-rate, math.min(rate, wrap(math.atan(wy, wx) - o.a)))
end

-- ---------------------------------------------------------------- update
function _update()
  if report then
    if btnp("a") or btnp("b") then report = nil end
    return
  end
  if btnp("x") then shop = not shop; sfx("E5", 4, 0.2, 4) end
  if shop then update_shop() return end

  G.clk = G.clk + 1
  if G.clk == DAYLEN then
    banner("NIGHT " .. G.day, "Pirates! Light them up.")
    sfx("E3", 4, 0.4, 40) sfx("B2", 4, 0.3, 50)
  elseif G.clk >= DAYLEN + NIGHTLEN then
    G.clk = 0; G.day = G.day + 1
    new_rocks()
    banner("DAY " .. G.day, "The tide moved the rocks.")
    sfx("C5", 4, 0.3, 30) sfx("G5", 4, 0.2, 40)
    persist()
  end
  if hint_t > 0 then hint_t = hint_t - 1 end
  if banner_t > 0 then banner_t = banner_t - 1 end

  for pn = 1, PLAYERS do if btnp("y", pn) then swap_station(pn) end end
  aim()
  man_cannons()

  if horn > 0 then horn = horn - 1 end
  if horn_cd > 0 then horn_cd = horn_cd - 1 end
  if lamp_pn > 0 and btnp("b", lamp_pn) and horn_cd == 0 then
    horn, horn_cd = 180, 900
    sfx("A1", 5, 0.5, 80) sfx("E2", 5, 0.35, 80)
  end

  spawn_t = spawn_t - 1
  if spawn_t <= 0 and #ships < 7 + G.harbour then spawn_ship(); spawn_t = spawn_every() end
  if is_night() then
    pirate_t = pirate_t - 1
    if pirate_t <= 0 and #pirates < math.min(1 + G.day // 2 + PLAYERS // 2, 5) then
      spawn_pirate()
      pirate_t = math.max(300, 780 - G.day * 50)
    end
  end
  loot_t = loot_t - 1
  if loot_t <= 0 then
    loot_t = 420
    if #loot < 8 then
      local x, y = rnd(20, W - 20), rnd(30, H - 50)
      if not hit_rock(x, y, 8) then drop_loot(x, y, 1, rnd(2, 5)) end
    end
  end

  update_ships()
  update_pirates()
  update_cannons()
  for _, b in ipairs(boats) do if boat_on(b) then update_boat(b) end end
  for i = #loot, 1, -1 do
    local l = loot[i]
    l.life = l.life - 1
    l.x = l.x + math.sin((t() + l.bob * 10) / 90) * 0.05
    if l.life <= 0 then table.remove(loot, i) end
  end

  for i = #fx, 1, -1 do
    local p = fx[i]
    p.x, p.y, p.vy, p.t = p.x + p.vx, p.y + p.vy, p.vy + 0.05, p.t - 1
    if p.t <= 0 then table.remove(fx, i) end
  end
  for i = #floats, 1, -1 do
    local f = floats[i]
    f.y, f.t = f.y - 0.4, f.t - 1
    if f.t <= 0 then table.remove(floats, i) end
  end
  for _, w in ipairs(wisps) do
    w.x = w.x + w.s
    if w.x > W + 30 then w.x = -80 end
  end

  save_t = save_t + 1
  if save_t >= 300 then save_t = 0; persist() end
end

-- Y swaps stations, but only from a boat docked at the island (or back to it).
-- From the boat: the lamp if nobody keeps it, else the first free cannon. Y again moves on to the
-- next free station, and after the last one back down to the boat.
function swap_station(pn)
  local b = boats[pn]
  if role[pn] == "boat" and not at_isle(b) then
    float(b.x - 36, b.y - 22, "dock first", 30); sfx("C3", 1, 0.2, 6)
    return
  end
  local from = station_of(pn)   -- -1 boat, 0 lamp, c cannon
  if role[pn] == "lamp" then lamp_pn = 0 elseif type(role[pn]) == "number" then cannon_by[role[pn]] = 0 end
  role[pn] = "boat"
  local st = next_free(from)
  if st == 0 then role[pn], lamp_pn = "lamp", pn; idle = 0
  elseif st then role[pn], cannon_by[st] = st, pn end
  if role[pn] == "boat" then
    b.vx, b.vy = 0, 0
    if from == -1 then float(b.x - 36, b.y - 22, "all taken", 26) end
  end
  sfx(role[pn] == "boat" and "C4" or "G4", 1, 0.3, 8)
end

-- the next free station after from (0 is the lamp, 1-4 the cannons), or nil
function next_free(from)
  for st = from + 1, G.cannon do
    if (st == 0 and lamp_pn == 0) or (st > 0 and cannon_by[st] == 0) then return st end
  end
end

-- players at a cannon: left / right aims, A fires where it points
function man_cannons()
  for c = 1, G.cannon do
    local pn = cannon_by[c]
    if pn > 0 then
      if btn("left", pn) then cannon_ang[c] = cannon_ang[c] - 0.04 end
      if btn("right", pn) then cannon_ang[c] = cannon_ang[c] + 0.04 end
      cannon_ang[c] = wrap(cannon_ang[c])
      if btnp("a", pn) and cannon_cd[c] <= 0 then
        local C = CANNONS[c]
        local vx, vy = math.cos(cannon_ang[c]) * 2.6, math.sin(cannon_ang[c]) * 2.6
        balls[#balls + 1] = { x = C.x, y = C.y - 4, vx = vx, vy = vy, t = 80 }
        burst(C.x + vx * 3, C.y - 4 + vy * 3, 29, 4)
        sfx("C2", 3, 0.4, 10)
        cannon_cd[c] = 45
      end
    end
  end
end

function aim()
  local pn = lamp_pn
  local r, l = 0, 0
  local turning = false
  if pn > 0 then
    r, l = press("r", pn), press("l", pn)
    turning = btn("left", pn) or btn("right", pn)
  end
  local manual = turning or r > 8 or l > 8
  idle = manual and 0 or idle + 1
  if turning then
    if btn("left", pn) then angle = angle - 0.03 end
    if btn("right", pn) then angle = angle + 0.03 end
  end
  if auto_on() then auto_aim() end
  angle = wrap(angle)
  if oil <= 0 then r = 0 end
  bhalf = 0.3 - l / 255 * 0.18 + (auto_on() and G.auto == 3 and 0.05 or 0)
  brange = (105 + G.lens * 18) * (1 + r / 255 * 0.8) * (1 + l / 255 * 0.4) * (is_night() and 1 or 0.75)
  oil = math.max(0, math.min(max_oil(), oil - r / 255 * 2.6 / 60 + (0.5 + G.pump * 0.4) / 60))
  beam_r = r
end

-- how close a ship is to a rock it can't see (0 = safe)
function danger(s)
  if s.seen > 0 then return 0 end
  local m = 0
  for _, r in ipairs(rocks) do
    local d = math.sqrt(dist2(s.x, s.y, r.x, r.y)) - r.r
    if d < 50 then m = math.max(m, 50 - d) end
  end
  return m
end

-- the clockwork lens: sweeps round and round; level 2+ also follows pirates and ships in danger
function auto_aim()
  local tx
  if G.auto >= 2 then
    local best, bs = nil, 0
    for _, p in ipairs(pirates) do
      if not p.flee then
        local sc = 1000 - math.sqrt(dist2(p.x, p.y, LX, LY))
        if sc > bs then best, bs = p, sc end
      end
    end
    if not best then
      for _, s in ipairs(ships) do
        local sc = danger(s)
        if dist2(s.x, s.y, LX, LY) > 220 * 220 then sc = 0 end
        if sc > bs then best, bs = s, sc end
      end
    end
    if best then tx = math.atan(best.y - LY, best.x - LX) end
  end
  local sp = 0.008 + G.auto * 0.006
  if tx then angle = angle + math.max(-sp, math.min(sp, wrap(tx - angle)))
  else angle = angle + sp * 0.8 end
end

function spawn_ship()
  local k = KINDS[rnd(1 + math.min(G.harbour, 2))]
  local side, x, y = rnd(3)
  if side == 1 then x, y = rnd(30, W - 30), -8
  elseif side == 2 then x, y = -8, rnd(20, 220)
  else x, y = W + 8, rnd(20, 220) end
  local d = DOCKS[side == 2 and 2 or side == 3 and 1 or rnd(2)]   -- ships cross the sea, past the lighthouse
  ships[#ships + 1] = { k = k, x = x, y = y, dock = d, a = math.atan(d.y - y, d.x - x), seen = 0,
    lamp = rnd(100) <= G.lantern * 20, bob = rnd(60) }
end

function spawn_pirate()
  local side = rnd(3)
  local x, y = side == 1 and -8 or side == 2 and W + 8 or rnd(40, W - 40), side == 3 and -8 or rnd(30, 260)
  pirates[#pirates + 1] = { x = x, y = y, a = math.atan(ISLE.y - y, ISLE.x - x),
    hp = 2, fear = 0, flee = false, lit = false, bob = rnd(60) }
  sfx("D3", 5, 0.25, 20)
end

function update_ships()
  for i = #ships, 1, -1 do
    local s = ships[i]
    if lit(s.x, s.y) then s.seen = 50 elseif s.seen > 0 then s.seen = s.seen - 1 end
    local dx, dy = s.dock.x - s.x, s.dock.y - s.y
    local d = math.sqrt(dx * dx + dy * dy)
    if d < 6 then
      docked(s); table.remove(ships, i)
    else
      local wx, wy = avoid(s, dx / d, dy / d, s.seen > 0, s.lamp)
      turn_to(s, wx, wy, 0.05)
      local sp = s.k.speed * (horn > 0 and 0.35 or 1)
      s.x = math.max(-10, math.min(W + 10, s.x + math.cos(s.a) * sp))
      s.y = s.y + math.sin(s.a) * sp
      if hit_rock(s.x, s.y, s.k.r) then
        lost(s, "wrecked!"); burst(s.x, s.y, 7, 12); sfx("C2", 3, 0.5, 30, nil, 0, -2)
        drop_loot(s.x, s.y, 2 + rnd(0, 1), s.k.toll)
        table.remove(ships, i)
      end
    end
  end
end

function docked(s)
  streak = streak + 1
  G.best = math.max(G.best, streak)
  local c = s.k.toll * mult()
  G.coins = G.coins + c
  G.docked = G.docked + 1
  if G.docked >= GOAL and not G.goal then
    G.goal = true
    persist()
    game_win(GOAL .. " ships made it home thanks to your light. The harbour keeps going: play on!")
  end
  float(s.x - 8, s.y - 10, "+" .. c, 27)
  sfx("C6", 4, 0.3, 10) sfx("G6", 4, 0.2, 14)
end

function lost(s, why)
  streak = 0
  G.lost = G.lost + 1
  float(s.x - #why * 4, s.y - 10, why, 26)
end

-- a rowboat: d-pad rows, R rows harder; bump a rock and the cargo spills
function update_boat(b)
  local pn = b.n
  local ax, ay = 0, 0
  if b.stun > 0 then b.stun = b.stun - 1
  else
    if btn("left", pn) then ax = ax - 1 end
    if btn("right", pn) then ax = ax + 1 end
    if btn("up", pn) then ay = ay - 1 end
    if btn("down", pn) then ay = ay + 1 end
  end
  local pw = press("r", pn) / 255
  local acc = 0.05 + pw * 0.04
  if ax ~= 0 and ay ~= 0 then acc = acc * 0.7 end
  b.vx, b.vy = (b.vx + ax * acc) * 0.96, (b.vy + ay * acc) * 0.96
  if ax ~= 0 or ay ~= 0 then b.a = math.atan(ay, ax) end
  local nx = math.max(4, math.min(W - 4, b.x + b.vx))
  local ny = math.max(4, math.min(H - 18, b.y + b.vy))
  local r = hit_rock(nx, ny, 4)
  if r then
    local dx, dy = b.x - r.x, b.y - r.y
    local d = math.sqrt(dx * dx + dy * dy) + 0.001
    b.vx, b.vy = dx / d * 0.8, dy / d * 0.8
    if r ~= ISLE and b.cargo > 0 then
      drop_loot(b.x, b.y, b.cargo, b.val // b.cargo)
      float(b.x - 24, b.y - 14, "spilled!", 26)
      b.cargo, b.val, b.stun = 0, 0, 40
      sfx("E2", 3, 0.4, 16)
    elseif r ~= ISLE then
      b.stun = 20; sfx("C3", 3, 0.2, 6)
    end
  else
    b.x, b.y = nx, ny
  end
  -- pick up crates (not while dizzy from a bump, or the spilled ones come straight back)
  for i = #loot, 1, -1 do
    if b.stun > 0 then break end
    local l = loot[i]
    if b.cargo < CAP and dist2(l.x, l.y, b.x, b.y) < 121 then
      b.cargo, b.val = b.cargo + 1, b.val + l.v
      table.remove(loot, i)
      sfx("A5", 4, 0.25, 6)
    end
  end
  -- unload at the lighthouse island
  if b.cargo > 0 and dist2(b.x, b.y, ISLE.x, ISLE.y) < (ISLE.r + 14) ^ 2 then
    G.coins = G.coins + b.val
    float(b.x - 12, b.y - 14, "+" .. b.val, 27)
    b.cargo, b.val = 0, 0
    sfx("C6", 4, 0.3, 8) sfx("E6", 4, 0.25, 12)
  end
end

function update_pirates()
  for i = #pirates, 1, -1 do
    local p = pirates[i]
    p.lit = lit(p.x, p.y)
    if not p.flee then
      if p.lit then
        p.fear = p.fear + 1 + beam_r / 128
        if p.fear >= 100 then
          p.flee = true
          G.coins = G.coins + 4
          float(p.x - 24, p.y - 12, "scared!", 22)
          sfx("A5", 1, 0.3, 8) sfx("E5", 1, 0.3, 12)
        end
      elseif p.fear > 0 then p.fear = p.fear - 0.3 end
    end
    local tx, ty
    if p.flee then
      tx, ty = p.x < W / 2 and -60 or W + 60, p.y
    else
      local best, bd = nil, 1e9
      for _, s in ipairs(ships) do
        local d = dist2(s.x, s.y, p.x, p.y)
        if d < bd then best, bd = s, d end
      end
      for _, b in ipairs(boats) do          -- a loaded rowboat is worth chasing too
        if boat_on(b) and b.cargo > 0 then
          local d = dist2(b.x, b.y, p.x, p.y) * 0.8
          if d < bd then best, bd = b, d end
        end
      end
      if best then tx, ty = best.x, best.y else tx, ty = ISLE.x, ISLE.y - 60 end
    end
    local dx, dy = tx - p.x, ty - p.y
    local d = math.sqrt(dx * dx + dy * dy) + 0.001
    local wx, wy = avoid(p, dx / d, dy / d, true, false)   -- pirates know every rock
    turn_to(p, wx, wy, 0.05)
    local sp = (p.flee and 0.8 or 0.42) * (horn > 0 and 0.35 or 1)
    p.x, p.y = p.x + math.cos(p.a) * sp, p.y + math.sin(p.a) * sp
    if p.flee and (p.x < -20 or p.x > W + 20 or p.y < -20) then
      table.remove(pirates, i)
    elseif not p.flee then
      for j, s in ipairs(ships) do
        if dist2(s.x, s.y, p.x, p.y) < 144 then
          lost(s, "robbed!"); burst(s.x, s.y, 27, 8); sfx("F2", 2, 0.4, 20)
          table.remove(ships, j)
          p.flee = true
          break
        end
      end
      for _, b in ipairs(boats) do
        if not p.flee and boat_on(b) and b.cargo > 0 and dist2(b.x, b.y, p.x, p.y) < 144 then
          float(b.x - 24, b.y - 14, "robbed!", 26); sfx("F2", 2, 0.4, 20)
          b.cargo, b.val, b.stun = 0, 0, 30
          p.flee = true
        end
      end
    end
  end
end

-- each cannon fires at a pirate the beam reveals
function update_cannons()
  for c = 1, G.cannon do
    cannon_cd[c] = cannon_cd[c] - 1
    if cannon_cd[c] <= 0 and cannon_by[c] == 0 then
      local C = CANNONS[c]
      for _, p in ipairs(pirates) do
        if p.lit and not p.flee and dist2(p.x, p.y, C.x, C.y) < 190 * 190 then
          local dx, dy = p.x - C.x, p.y - C.y
          local d = math.sqrt(dx * dx + dy * dy)
          balls[#balls + 1] = { x = C.x, y = C.y - 4, vx = dx / d * 2.4, vy = dy / d * 2.4, t = d / 2.4 + 6 }
          burst(C.x, C.y - 4, 29, 4)
          sfx("C2", 3, 0.4, 10)
          cannon_cd[c] = 150
          break
        end
      end
    end
  end
  for i = #balls, 1, -1 do
    local b = balls[i]
    b.x, b.y, b.t = b.x + b.vx, b.y + b.vy, b.t - 1
    local hit = false
    for j, p in ipairs(pirates) do
      if dist2(b.x, b.y, p.x, p.y) < 81 then
        hit = true
        p.hp = p.hp - 1
        burst(p.x, p.y, 10, 8)
        if p.hp <= 0 then
          G.coins = G.coins + 12
          float(p.x - 16, p.y - 12, "+12", 27)
          burst(p.x, p.y, 7, 14)
          drop_loot(p.x, p.y, 3, 5)
          sfx("C2", 3, 0.6, 40, nil, 0, -1)
          table.remove(pirates, j)
        else sfx("G3", 3, 0.4, 12) end
        break
      end
    end
    if hit or b.t <= 0 then
      if not hit then burst(b.x, b.y, 23, 5) end
      table.remove(balls, i)
    end
  end
end

function update_shop()
  if btnp("up") then sel = (sel - 2) % #SHOP + 1; sfx("E5", 4, 0.15, 3) end
  if btnp("down") then sel = sel % #SHOP + 1; sfx("E5", 4, 0.15, 3) end
  if btnp("b") then shop = false end
  if btnp("a") then
    local it = SHOP[sel]
    local c = cost(it)
    if G[it.key] < it.max and G.coins >= c then
      G.coins = G.coins - c
      G[it.key] = G[it.key] + 1
      if it.key == "tank" then oil = max_oil() end
      sfx("G5", 1, 0.3, 10) sfx("C6", 1, 0.3, 14)
      persist()
    else
      sfx("C3", 0, 0.2, 6)
    end
  end
end

-- what happened while the Bit was off
function away_report()
  if not (clock and G.ts) then return end
  local away = clock() - G.ts
  if away < 60 then return end
  away = math.min(away, 8 * 3600)
  local n = math.floor(away * 60 / spawn_every() * 0.5)     -- fewer ships sail while you sleep
  local lit_share = G.auto > 0 and (0.35 + 0.15 * G.auto) or 0
  local safe = lit_share + (1 - lit_share) * (0.2 + G.lantern * 0.15)
  safe = math.max(0.05, math.min(0.95, safe - math.max(0, 0.15 - G.cannon * 0.04)))
  local ok = math.floor(n * safe)
  local nk, avg = 1 + math.min(G.harbour, 2), 0
  for i = 1, nk do avg = avg + KINDS[i].toll end
  local earned = math.floor(ok * avg / nk)
  G.coins = G.coins + earned
  G.docked = G.docked + ok
  G.lost = G.lost + n - ok
  report = { h = away // 3600, m = away % 3600 // 60, n = n, ok = ok, earned = earned }
  persist()
end

-- ---------------------------------------------------------------- draw
function shade(day)            -- ghost colours for things the beam doesn't reach
  local c = day and 29 or 30
  for i = 1, 31 do pal(i, c) end
end

function draw_beam(c1, c2)
  local a = angle - bhalf
  while a <= angle + bhalf do
    line(LX, LY, LX + math.cos(a) * brange, LY + math.sin(a) * brange, c1)
    a = a + 0.007
  end
  local core, rr = bhalf * 0.35, brange * 0.85
  a = angle - core
  while a <= angle + core do
    line(LX, LY, LX + math.cos(a) * rr, LY + math.sin(a) * rr, c2)
    a = a + 0.007
  end
end

-- the camera follows what this screen's player controls (everyone's things when sharing a screen)
function update_camera()
  local sx, sy, n = 0, 0, 0
  local function add(x, y) sx, sy, n = sx + x, sy + y, n + 1 end
  for pn = 1, PLAYERS do
    if ME == 0 or ME == pn then
      local r = role[pn]
      if r == "lamp" then
        local f = math.min(brange, 150) * 0.55
        add(LX + math.cos(angle) * f, LY + math.sin(angle) * f)
      elseif r == "boat" then add(boats[pn].x, boats[pn].y)
      else
        local C = CANNONS[r]
        add(C.x + math.cos(cannon_ang[r]) * 60, C.y + math.sin(cannon_ang[r]) * 60)
      end
    end
  end
  if n == 0 then add(LX, LY) end
  local tx = math.max(0, math.min(W - 320, sx / n - 160))
  local ty = math.max(0, math.min(H - 240, sy / n - 120))
  cam_x = cam_x + (tx - cam_x) * 0.08
  cam_y = cam_y + (ty - cam_y) * 0.08
end

function on_screen(x, y, m)
  return x > cam_x - m and x < cam_x + 320 + m and y > cam_y - m and y < cam_y + 240 + m
end

function _draw()
  local night = is_night()
  local day = not night
  update_camera()
  cls(night and 1 or 20)
  camera(cam_x // 1, cam_y // 1)
  if night then for _, s in ipairs(stars) do if (s[1] + t() // 30) % 7 > 0 and on_screen(s[1], s[2], 2) then pset(s[1], s[2], 30) end end end

  -- waves
  for i, w in ipairs(waves) do
    local x = (w[1] + t() // 4) % (W + 20) - 10
    if on_screen(x, w[2], 8) then line(x, w[2], x + 4, w[2], night and 19 or 21) end
  end
  -- day haze
  if day then
    for _, w in ipairs(wisps) do
      if on_screen(w.x + w.w / 2, w.y, w.w) then
        line(w.x, w.y, w.x + w.w, w.y, 29)
        line(w.x + 4, w.y + 1, w.x + w.w - 6, w.y + 1, 29)
        line(w.x + 10, w.y + 2, w.x + w.w - 14, w.y + 2, 28)
      end
    end
  end

  draw_island(night)
  if oil > 0 or t() % 6 < 3 then
    if night then draw_beam(19, beam_r > 120 and 21 or 20) else draw_beam(21, beam_r > 120 and 23 or 22) end
  end

  -- foghorn rings
  if horn > 0 then
    local r = (180 - horn) * 2
    circ(LX, LY, r, night and 30 or 23)
    if r > 30 then circ(LX, LY, r - 30, night and 30 or 23) end
  end

  -- rocks
  for _, r in ipairs(rocks) do
    if on_screen(r.x, r.y, 16) then
      local L = lit(r.x, r.y)
      local c1, c2, c3 = 31, 30, 19
      if L then c1, c2, c3 = 28, 29, 23 elseif day then c1, c2, c3 = 19, 21, 21 end
      circ(r.x, r.y, r.r + 1 + (t() // 20 + r.x) % 2, c3)
      for _, b in ipairs(r.b) do circfill(r.x + b[1], r.y + b[2], b[3], c1) end
      circfill(r.x - 1, r.y - 2, math.max(1, r.r // 2), c2)
    end
  end

  -- floating crates: they glint now and then, even in the dark
  for _, l in ipairs(loot) do
    if on_screen(l.x, l.y, 8) then
      local bob = (t() + l.bob) // 20 % 2
      if not lit(l.x, l.y) then shade(day) end
      spr(9, l.x - 4, l.y - 4 + bob)
      pal()
      if (t() + l.bob * 7) % 50 < 4 then pset(l.x + 2, l.y - 3 + bob, 27) end
    end
  end

  -- ships
  for _, s in ipairs(ships) do
    if on_screen(s.x, s.y, 20) then
      local L = s.seen > 0
      if not L then shade(day) end
      local fl = math.cos(s.a) < 0
      local bob = (t() + s.bob) // 30 % 2
      spr(s.k.spr, s.x - 8 * s.k.w, s.y - 10 + bob, s.k.w, 1, fl, false, 2)
      pal()
      if s.lamp then
        rectfill(s.x - 1, s.y - 13 + bob, 2, 2, 27)
        if night then circ(s.x, s.y - 2, 12 + t() // 10 % 2, 19) end
      elseif night then pset(s.x, s.y - 12 + bob, 11) end
    end
  end

  -- pirates
  for _, p in ipairs(pirates) do
    if on_screen(p.x, p.y, 20) then
      if not p.lit then shade(day) end
      local bob = (t() + p.bob) // 25 % 2
      spr(5, p.x - 8, p.y - 10 + bob, 1, 1, math.cos(p.a) < 0, false, 2)
      pal()
      if not p.lit then pset(p.x, p.y - 4 + bob, 25) end     -- a red glint in the dark
      if p.fear > 0 and not p.flee then
        rect(p.x - 7, p.y - 17, 14, 3, 30)
        rectfill(p.x - 6, p.y - 16, math.min(12, p.fear * 12 // 100), 1, 22)
      end
    end
  end
  for _, b in ipairs(balls) do circfill(b.x, b.y, 1, 31) pset(b.x, b.y, 28) end

  draw_tower()
  draw_coast()
  draw_boats()

  for _, p in ipairs(fx) do pset(p.x, p.y, p.c) end
  for _, f in ipairs(floats) do text(f.s, f.x, f.y, f.c) end

  camera()
  hud(night)
  minimap(night)
  if banner_t > 0 and not shop then
    rectfill(0, 84, 320, 34, 31)
    text(banner_s, 160 - #banner_s * 8, 88, night and 22 or 27, 2)
    text(banner_sub, 160 - #banner_sub * 4, 106, 29)
  end
  if shop then draw_shop() end
  if report then draw_report() end
end

function draw_boats()
  for _, b in ipairs(boats) do
    local on = boat_on(b)
    do
      local bob = (t() + b.n * 13) // 25 % 2
      pal(10, PCOL[b.n]) pal(8, 30)
      if b.stun > 0 and t() % 6 < 3 then pal(PCOL[b.n], 13) end
      spr(8, b.x - 8, b.y - 10 + bob, 1, 1, math.cos(b.a) < 0, false, 2)
      pal()
      if on then
        text(b.n, b.x - 3, b.y - 22, PCOL[b.n])
        if b.cargo > 0 then
          for i = 1, b.cargo do rectfill(b.x - 9 + i * 3, b.y + 6, 2, 2, 7) end
        end
      end
    end
  end
end

-- the island is drawn under the beam, the tower and cannons on top of it
function draw_island(night)
  circfill(ISLE.x, ISLE.y, ISLE.r + 3, night and 19 or 22)        -- surf
  circfill(ISLE.x, ISLE.y, ISLE.r, 11)                           -- sand
  circfill(ISLE.x - 2, ISLE.y + 2, ISLE.r - 5, 30)
  circfill(ISLE.x - 8, ISLE.y + 6, 8, 28) circfill(ISLE.x + 8, ISLE.y + 7, 7, 28)
  pset(ISLE.x - 11, ISLE.y + 3, 29) pset(ISLE.x + 6, ISLE.y + 10, 29)
  -- jetty where the rowboats unload
  rectfill(ISLE.x - 4, ISLE.y + ISLE.r - 2, 8, 12, 7)
end

function draw_tower()
  for c = 1, G.cannon do
    local C = CANNONS[c]
    local pn = cannon_by[c]
    if pn > 0 then                                   -- a manned cannon: dotted aim line in its player's colour
      local ca, sa = math.cos(cannon_ang[c]), math.sin(cannon_ang[c])
      for k = 2, 8 do rectfill(C.x + ca * k * 8 - 1, C.y - 5 + sa * k * 8, 2, 2, PCOL[pn]) end
    end
    spr(6, C.x - 4, C.y - 6, 1, 1, pn > 0 and math.cos(cannon_ang[c]) > 0 or (pn == 0 and C.x > ISLE.x))
  end
  spr(32, LX - 16, LY - 4, 2, 2, false, false, 2)
  circfill(LX, LY, 2 + (t() // 8) % 2 + beam_r // 128, oil > 0 and 27 or 10)
  if PLAYERS > 1 then
    if lamp_pn > 0 then text(lamp_pn, LX - 3, LY - 16, PCOL[lamp_pn]) end
    for c = 1, G.cannon do
      if cannon_by[c] > 0 then text(cannon_by[c], CANNONS[c].x - 3, CANNONS[c].y + 4, PCOL[cannon_by[c]]) end
    end
  end
end

function draw_coast()
  if cam_y + 240 < H - 24 then return end
  rectfill(0, H - 16, W, 16, 6)
  for x = 0, W - 2, 9 do pset(x + (x * 7) % 5, H - 15, 7) end
  for _, d in ipairs(DOCKS) do
    rectfill(d.x - 18, d.y + 2, 36, 4, 7)
    for x = d.x - 16, d.x + 16, 8 do rectfill(x, d.y + 6, 2, 4, 6) end
    pset(d.x - 18, d.y, 25) pset(d.x + 17, d.y, 17)
  end
end

function hud(night)
  rectfill(0, 0, 320, 12, 31)
  spr(7, 2, 2)
  text(fmt(G.coins), 12, 2, 27)
  text("OIL", 66, 2, 29)
  rect(92, 3, 52, 6, 29)
  rectfill(93, 4, math.floor(50 * oil / max_oil()), 4, oil < max_oil() / 4 and 26 or 10)
  local m = mult()
  text("ROW " .. streak, 152, 2, 13)
  if m > 1 then text("x" .. m, 210, 2, 27) end
  local dn = (night and "NIGHT " or "DAY ") .. G.day
  text(dn, 310 - #dn * 8, 2, night and 22 or 27)
  local f = G.clk / (DAYLEN + NIGHTLEN)
  rectfill(0, 12, math.floor(320 * f), 1, night and 20 or 27)

  rectfill(0, 230, 320, 10, 31)
  local me = ME == 0 and 1 or ME
  local r = role[me]
  if r == "lamp" then text(horn_cd == 0 and "B HORN" or "B ....", 4, 231, horn_cd == 0 and 12 or 30) text(next_free(station_of(me)) and "Y NEXT" or "Y BOAT", 64, 231, 12)
  elseif r == "boat" then
    if at_isle(boats[me]) then text("Y GO ASHORE", 4, 231, 12) else text("DOCK TO SWAP", 4, 231, 30) end
  else text(cannon_cd[r] <= 0 and "A FIRE" or "A ....", 4, 231, cannon_cd[r] <= 0 and 12 or 30) text(next_free(station_of(me)) and "Y NEXT" or "Y BOAT", 64, 231, 12) end
  text("X SHOP", 268, 231, 12)
  if auto_on() and t() // 30 % 2 == 0 then text("AUTO", 132, 231, 17)
  else
    local g = G.goal and ("HOME " .. G.docked) or ("HOME " .. G.docked .. "/" .. GOAL)
    text(g, 196 - #g * 4, 231, G.goal and 17 or 13)
  end
  if hint_t > 0 then
    rectfill(0, 13, 320, 11, 31)
    local h = PLAYERS > 1 and "ONE KEEPER, THE REST ROW. DOCK + Y" or "<> AIM  R BRIGHT  L NARROW  Y ROW"
    text(h, 160 - #h * 4, 15, 29)
  end
end

function minimap(night)
  local x0, y0, mw, mh = 262, 186, 56, 42
  rectfill(x0 - 1, y0 - 1, mw + 2, mh + 2, 29)
  rectfill(x0, y0, mw, mh, night and 1 or 19)
  local function P(x, y) return x0 + x * mw // W, y0 + y * mh // H end
  for _, r in ipairs(rocks) do local x, y = P(r.x, r.y) pset(x, y, 30) end
  local ix, iy = P(ISLE.x, ISLE.y) rectfill(ix - 1, iy - 1, 3, 3, 28)
  local ex, ey = P(LX + math.cos(angle) * brange, LY + math.sin(angle) * brange)
  line(ix, iy, ex, ey, night and 20 or 22)
  for _, l in ipairs(loot) do local x, y = P(l.x, l.y) pset(x, y, 11) end
  for _, s in ipairs(ships) do local x, y = P(s.x, s.y) pset(x, y, 13) end
  for _, p in ipairs(pirates) do local x, y = P(p.x, p.y) pset(x, y, 25) end
  for _, b in ipairs(boats) do if boat_on(b) then local x, y = P(b.x, b.y) rectfill(x, y, 2, 2, PCOL[b.n]) end end
  local vx, vy = P(cam_x, cam_y)
  rect(vx, vy, 320 * mw // W, 240 * mh // H, 29)
end

function draw_shop()
  rectfill(24, 26, 272, 186, 31)
  rect(24, 26, 272, 186, 29)
  text("HARBOUR SHOP", 112, 32, 27)
  for i, it in ipairs(SHOP) do
    local y = 50 + (i - 1) * 18
    local lv, c = G[it.key], cost(it)
    if i == sel then rectfill(28, y - 3, 264, 14, 19) end
    text(it.name, 36, y, i == sel and 13 or 29)
    for j = 1, it.max do
      if j <= lv then rectfill(160 + j * 7, y + 1, 5, 5, 17) else rect(160 + j * 7, y + 1, 5, 5, 30) end
    end
    if lv >= it.max then text("MAX", 252, y, 17)
    else
      local s = fmt(c)
      text(s, 286 - #s * 8, y, G.coins >= c and 27 or 26)
    end
  end
  text(SHOP[sel].info, 160 - #SHOP[sel].info * 4, 180, 22)
  text("A BUY   B CLOSE", 100, 198, 29)
end

function draw_report()
  rectfill(32, 60, 256, 112, 31)
  rect(32, 60, 256, 112, 27)
  text("WHILE YOU WERE AWAY", 84, 68, 27)
  local s = "You were gone " .. (report.h > 0 and report.h .. "h " or "") .. report.m .. "m"
  text(s, 160 - #s * 4, 88, 13)
  s = report.ok .. " ships docked, " .. (report.n - report.ok) .. " lost"
  text(s, 160 - #s * 4, 104, 29)
  s = "+" .. fmt(report.earned) .. " coins"
  text(s, 160 - #s * 4, 120, 27)
  if G.auto == 0 then text("A clockwork lens helps!", 68, 138, 22) end
  text("A OK", 144, 156, 29)
end
`;

  // Pixel art: one char per pixel, mapped to palette indices. Rows can be 8 or 16 pixels wide.
  const K = { '.': 0, k: 1, n: 7, N: 6, w: 13, c: 12, r: 25, R: 26, Y: 27, o: 10, O: 8, e: 28, E: 29,
              s: 30, S: 31, b: 21, B: 20, g: 16, h: 11 };
  const ART = {
    1: ['...w....', '...ww...', '...www..', '...wwww.', '...k....', 'nnnnnnnn', '.NnnnnN.', '........'],   // dinghy
    2: ['........', '..k.....', '..kccc..', '.kkccc..', '.k.ccc..', 'oooooooo', '.OooooO.', '........'],   // trawler
    3: ['................', '..........rr....', '.....EEE..ee....', '..eEEEEEEEeeE...',                      // freighter
        '.EeeeeeeeeeeeeE.', 'BBBBBBBBBBBBBBBB', '.BbbbbbbbbbbbbB.', '..BBBBBBBBBBBB..'],
    5: ['..r.....', '..kSSS..', '..kSwS..', '.kkSSS..', '..kSSS..', 'NNNNNNNN', '.NSSSSN.', '........'],   // pirate
    6: ['........', '.....eee', '...eeEEe', '..eEEee.', '.eEee...', '.nNNNn..', 'nNcnNc..', '.n..n...'],   // cannon
    8: ['........', '...cc...', '...ww...', '.N.ww.N.', 'oooooooo', '.OooooO.', '..OOOO..', '........'],   // rowboat (hull recoloured per player)
    9: ['........', '.nnnnnn.', '.nNnnNn.', '.nnNNnn.', '.nnNNnn.', '.nNnnNn.', '.nnnnnn.', '........'],   // crate
    7: ['..YYYY..', '.YYooYY.', 'YYoYYYYY', 'YYoYYYYY', 'YYoYYYYY', 'YYYooYYY', '.YYYYYY.', '..YYYY..'],   // coin
    32: ['......kkkk......', '.....kYYYYk.....', '.....kYwwYk.....', '....kkkkkkkk....',                   // lighthouse
         '.....krrrrk.....', '.....kwwwwk.....', '.....kwwwwk.....', '.....krrrrk.....',
         '....krrrrrrk....', '....kwwwwwwk....', '....kwwwwwwk....', '....krrrrrrk....',
         '...krrrrrrrrk...', '...kwwwkwwwwk...', '..eeeeeeeeeeee..', '.EeeEeeeEeeEeee.'],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const t = +n + (y >> 3) * 16 + (x >> 3);
        cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
      }));
    // Beacon Keeper draws everything itself. The lighthouse entity type is there so the
    // Bit's home screen can use it as the game's icon.
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'lighthouse', anims: [{ name: 'idle', frames: [32], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Harbour', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Beacon Keeper', code, buildGfx,
    about: 'An idle game for 1-4 players: light the ships past the rocks, scare off pirates and row out for loot.' });
})();
