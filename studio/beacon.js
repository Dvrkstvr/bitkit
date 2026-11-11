/* Demo cart "Beacon Keeper": original art and code. MIT License. */
(function () {
  const code = `-- Beacon Keeper: a tiny BitKit demo (idle + action)
-- You are the lighthouse. The ships can't see the rocks: only your beam shows them the way.
--   Aim the beam: d-pad / stick left and right
--   Squeeze R: a brighter beam that reaches further (burns lamp oil)
--   Squeeze L: a narrow, long spotlight
--   B: foghorn, slows every ship for a moment      X: harbour shop
-- Day: a sea haze hides the rocks and the beam doesn't reach as far.
-- Night: pirates hunt the merchant ships. Keep your light on them and they get scared off.
--   Coast cannons (shop) fire at every pirate your beam reveals.
-- Every ship that docks pays a toll; dock ships in a row for a bonus.
-- Ship lanterns (shop) let captains spot nearby rocks by themselves.
-- The clockwork lens (shop) sweeps the light for you. The game uses save(), saved() and
-- clock(), so the harbour keeps earning while the Bit is off.

LX, LY = 160, 192                         -- the lamp
DAYLEN, NIGHTLEN = 3600, 3600             -- one minute of day, one minute of night
DOCKS = { { x = 22, y = 220 }, { x = 298, y = 220 } }
CANNONS = { { x = 102, y = 226 }, { x = 218, y = 226 }, { x = 64, y = 229 }, { x = 256, y = 229 } }
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

function _init()
  G = { coins = 0, tank = 0, lens = 0, pump = 0, lantern = 0, cannon = 0, harbour = 0, auto = 0,
        day = 1, clk = 300, docked = 0, lost = 0, best = 0 }
  local d = saved and saved()
  if type(d) == "table" then
    for k, v in pairs(d) do if G[k] ~= nil and type(v) == type(G[k]) then G[k] = v end end
    G.ts = d.ts
  end
  ships, pirates, balls, fx, floats = {}, {}, {}, {}, {}
  angle, oil, streak, idle, horn, horn_cd = -math.pi / 2, max_oil(), 0, 0, 0, 0
  spawn_t, pirate_t, shop, sel, save_t = 60, 600, false, 1, 0
  bhalf, brange, beam_r = 0.3, 80, 0
  cannon_cd = { 0, 0, 0, 0 }
  hint_t = G.docked < 10 and 1200 or 0
  new_rocks()
  wisps = {}
  for i = 1, 70 do wisps[i] = { x = rnd(380) - 40, y = rnd(196) + 14, w = rnd(20, 70), s = rnd(3) * 0.06 } end
  stars = {}
  for i = 1, 30 do stars[i] = { rnd(320) - 1, rnd(150) + 14 } end
  if is_night() then banner("NIGHT " .. G.day, "Pirates! Light them up.") else banner("DAY " .. G.day, "Guide the ships through the haze.") end
  away_report()
end

-- ---------------------------------------------------------------- helpers
function is_night() return G.clk >= DAYLEN end
function max_oil() return 40 + G.tank * 25 end
function cost(it) return math.floor(it.base * 2.1 ^ G[it.key]) end
function dist2(ax, ay, bx, by) return (ax - bx) ^ 2 + (ay - by) ^ 2 end
function wrap(a) return (a + math.pi) % (2 * math.pi) - math.pi end
function mult() return 1 + math.min(streak // 5, 4) end
function spawn_every() return math.max(110, 300 - G.harbour * 40 - G.day * 6) end
function auto_on() return G.auto > 0 and idle > 120 end

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

function persist()
  if not save then return end
  G.ts = clock and clock() or nil
  save(G)
end

-- is a point inside the beam?
function lit(x, y)
  local dx, dy = x - LX, y - LY
  local d2 = dx * dx + dy * dy
  if d2 < 400 then return true end
  if d2 > brange * brange then return false end
  return math.abs(wrap(math.atan(dy, dx) - angle)) < bhalf
end

-- rocks for the day. The same day always gets the same rocks; new rocks never appear on a ship.
function new_rocks()
  srand(G.day * 7919 + 13)
  rocks = {}
  local n = math.min(7 + G.day, 15)
  for tries = 1, 500 do
    if #rocks >= n then break end
    local r = { x = rnd(16, 304), y = rnd(46, 176), r = rnd(4, 7 + math.min(G.day, 4)) }
    local ok = true
    for _, o in ipairs(rocks) do if dist2(o.x, o.y, r.x, r.y) < (o.r + r.r + 16) ^ 2 then ok = false break end end
    for _, s in ipairs(ships) do if dist2(s.x, s.y, r.x, r.y) < (r.r + 24) ^ 2 then ok = false break end end
    if ok then
      r.b = { { rnd(-2, 2), rnd(-2, 2), r.r }, { rnd(-r.r, r.r) // 2, rnd(-2, 1), r.r * 2 // 3 } }
      rocks[#rocks + 1] = r
    end
  end
  srand(G.day * 31 + G.clk + G.docked)
end
CLIFF = { x = 160, y = 248, r = 50 }

function hit_rock(x, y, rr)
  for _, r in ipairs(rocks) do if dist2(x, y, r.x, r.y) < (r.r + rr) ^ 2 then return r end end
  if dist2(x, y, CLIFF.x, CLIFF.y) < (CLIFF.r + rr) ^ 2 then return CLIFF end
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
  push(CLIFF, CLIFF.r + 20)                -- everyone can see the lighthouse cliff
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

  aim()

  if horn > 0 then horn = horn - 1 end
  if horn_cd > 0 then horn_cd = horn_cd - 1 end
  if btnp("b") and horn_cd == 0 then
    horn, horn_cd = 180, 900
    sfx("A1", 5, 0.5, 80) sfx("E2", 5, 0.35, 80)
  end

  spawn_t = spawn_t - 1
  if spawn_t <= 0 and #ships < 6 + G.harbour then spawn_ship(); spawn_t = spawn_every() end
  if is_night() then
    pirate_t = pirate_t - 1
    if pirate_t <= 0 and #pirates < math.min(1 + G.day // 2, 4) then
      spawn_pirate()
      pirate_t = math.max(300, 780 - G.day * 50)
    end
  end

  update_ships()
  update_pirates()
  update_cannons()

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
    if w.x > 330 then w.x = -50 end
  end

  save_t = save_t + 1
  if save_t >= 300 then save_t = 0; persist() end
end

function aim()
  local r, l = press("r"), press("l")
  local manual = btn("left") or btn("right") or r > 8 or l > 8
  idle = manual and 0 or idle + 1
  if btn("left") then angle = angle - 0.03 end
  if btn("right") then angle = angle + 0.03 end
  if auto_on() then auto_aim() end
  angle = math.max(-math.pi + 0.1, math.min(-0.1, angle))
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

-- the clockwork lens: sweeps back and forth; level 2+ also follows pirates and ships in danger
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
        if sc > bs then best, bs = s, sc end
      end
    end
    if best then tx = math.atan(best.y - LY, best.x - LX) end
  end
  if not tx then tx = -math.pi / 2 + math.sin(t() * 0.012) * 1.25 end
  local sp = 0.008 + G.auto * 0.006
  angle = angle + math.max(-sp, math.min(sp, wrap(tx - angle)))
end

function spawn_ship()
  local k = KINDS[rnd(1 + math.min(G.harbour, 2))]
  local d = DOCKS[rnd(2)]
  local x = rnd(30, 290)
  ships[#ships + 1] = { k = k, x = x, y = -6, dock = d, a = math.atan(d.y + 6, d.x - x), seen = 0,
    lamp = rnd(100) <= G.lantern * 20, bob = rnd(60) }
end

function spawn_pirate()
  local left = rnd(2) == 1
  pirates[#pirates + 1] = { x = left and -8 or 328, y = rnd(40, 150), a = left and 0 or math.pi,
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
      s.x = math.max(4, math.min(316, s.x + math.cos(s.a) * sp))
      s.y = s.y + math.sin(s.a) * sp
      if hit_rock(s.x, s.y, s.k.r) then
        lost(s, "wrecked!"); burst(s.x, s.y, 7, 12); sfx("C2", 3, 0.5, 30, nil, 0, -2)
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
  float(s.x - 8, s.y - 10, "+" .. c, 27)
  sfx("C6", 4, 0.3, 10) sfx("G6", 4, 0.2, 14)
end

function lost(s, why)
  streak = 0
  G.lost = G.lost + 1
  float(s.x - #why * 4, s.y - 10, why, 26)
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
      tx, ty = p.x < 160 and -60 or 380, p.y
    else
      local best, bd = nil, 1e9
      for _, s in ipairs(ships) do
        local d = dist2(s.x, s.y, p.x, p.y)
        if d < bd then best, bd = s, d end
      end
      if best then tx, ty = best.x, best.y else tx, ty = 160, 100 end
    end
    local dx, dy = tx - p.x, ty - p.y
    local d = math.sqrt(dx * dx + dy * dy) + 0.001
    local wx, wy = avoid(p, dx / d, dy / d, true, false)   -- pirates know every rock
    turn_to(p, wx, wy, 0.05)
    local sp = (p.flee and 0.8 or 0.42) * (horn > 0 and 0.35 or 1)
    p.x, p.y = p.x + math.cos(p.a) * sp, p.y + math.sin(p.a) * sp
    if p.flee and (p.x < -20 or p.x > 340) then
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
    end
  end
end

-- each cannon fires at a pirate the beam reveals
function update_cannons()
  for c = 1, G.cannon do
    cannon_cd[c] = cannon_cd[c] - 1
    if cannon_cd[c] <= 0 then
      local C = CANNONS[c]
      for _, p in ipairs(pirates) do
        if p.lit and not p.flee and dist2(p.x, p.y, C.x, C.y) < 180 * 180 then
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

function _draw()
  local night = is_night()
  local day = not night
  cls(night and 1 or 20)
  if night then for _, s in ipairs(stars) do if (s[1] + t() // 30) % 7 > 0 then pset(s[1], s[2], 30) end end end

  -- waves
  for i = 0, 40 do
    local x = (i * 83 + t() // 4) % 330 - 10
    local y = 16 + (i * 47) % 200
    line(x, y, x + 4, y, night and 19 or 21)
  end
  -- day haze
  if day then
    for _, w in ipairs(wisps) do
      line(w.x, w.y, w.x + w.w, w.y, 29)
      line(w.x + 4, w.y + 1, w.x + w.w - 6, w.y + 1, 29)
      line(w.x + 10, w.y + 2, w.x + w.w - 14, w.y + 2, 28)
    end
  end

  if oil > 0 or t() % 6 < 3 then
    if night then draw_beam(19, beam_r > 120 and 21 or 20) else draw_beam(21, beam_r > 120 and 23 or 22) end
  end

  -- foghorn rings
  if horn > 0 then
    local r = (180 - horn) * 1.5
    circ(LX, LY, r, night and 30 or 23)
    if r > 30 then circ(LX, LY, r - 30, night and 30 or 23) end
  end

  -- rocks
  for _, r in ipairs(rocks) do
    local L = lit(r.x, r.y)
    local c1, c2, c3 = 31, 30, 19
    if L then c1, c2, c3 = 28, 29, 23 elseif day then c1, c2, c3 = 19, 21, 21 end
    circ(r.x, r.y, r.r + 1 + (t() // 20 + r.x) % 2, c3)
    for _, b in ipairs(r.b) do circfill(r.x + b[1], r.y + b[2], b[3], c1) end
    circfill(r.x - 1, r.y - 2, math.max(1, r.r // 2), c2)
  end

  -- ships
  for _, s in ipairs(ships) do
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

  -- pirates
  for _, p in ipairs(pirates) do
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
  for _, b in ipairs(balls) do circfill(b.x, b.y, 1, 31) pset(b.x, b.y, 28) end

  draw_coast(night)

  for _, p in ipairs(fx) do pset(p.x, p.y, p.c) end
  for _, f in ipairs(floats) do text(f.s, f.x, f.y, f.c) end

  hud(night)
  if banner_t > 0 and not shop then
    rectfill(0, 84, 320, 34, 31)
    text(banner_s, 160 - #banner_s * 8, 88, night and 22 or 27, 2)
    text(banner_sub, 160 - #banner_sub * 4, 106, 29)
  end
  if shop then draw_shop() end
  if report then draw_report() end
end

function draw_coast(night)
  -- shore and piers
  rectfill(0, 230, 320, 10, 6)
  for x = 0, 318, 9 do pset(x + (x * 7) % 5, 231, 7) end
  rectfill(0, 224, 36, 3, 7) rectfill(284, 224, 36, 3, 7)
  for x = 3, 33, 8 do rectfill(x, 227, 2, 3, 6) end
  for x = 287, 317, 8 do rectfill(x, 227, 2, 3, 6) end
  pset(35, 222, 25) pset(284, 222, 17)
  -- the cliff
  circfill(CLIFF.x, CLIFF.y, CLIFF.r, 30)
  circfill(140, 236, 18, 28) circfill(184, 238, 16, 28) circfill(160, 222, 12, 28)
  pset(132, 228, 29) pset(176, 231, 29) pset(152, 214, 29)
  -- cannons
  for c = 1, G.cannon do
    local C = CANNONS[c]
    spr(6, C.x - 4, C.y - 6, 1, 1, C.x > 160)
  end
  -- the lighthouse and its lamp
  spr(32, LX - 16, LY - 4, 2, 2, false, false, 2)
  local glow = oil > 0 and 27 or 10
  circfill(LX, LY, 2 + (t() // 8) % 2 + beam_r // 128, glow)
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
  -- time of day: a thin line under the bar
  local f = G.clk / (DAYLEN + NIGHTLEN)
  rectfill(0, 12, math.floor(320 * f), 1, night and 20 or 27)

  -- bottom line, on the shore
  text(horn_cd == 0 and "B HORN" or "B ....", 4, 232, horn_cd == 0 and 12 or 7)
  text("X SHOP", 268, 232, 12)
  if auto_on() and t() // 30 % 2 == 0 then text("AUTO", 4, 214, 17) end
  if hint_t > 0 then
    rectfill(0, 13, 320, 11, 31)
    text("<> AIM  R BRIGHT  L NARROW  B HORN", 24, 15, 29)
  end
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
    about: 'An idle game: light the ships past the rocks, scare off pirates and grow your harbour.' });
})();
