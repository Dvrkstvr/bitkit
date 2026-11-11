/* Demo cart "Kart Lab": a 2.5D kart racer. Original art and code. MIT License.
   The track is painted into the map from a few control points, the karts are tiny voxel models
   rendered here from 9 angles (the other 7 are mirror images), and the game draws it all with
   floor() + project() + sspr(). */
(function () {
  // Track centre line (world pixels; the map is 2048 x 1024). A closed loop, smoothed with Catmull-Rom.
  const CTRL = [
    [360, 190], [900, 150], [1400, 170], [1760, 290], [1880, 520], [1730, 730], [1430, 690],
    [1180, 540], [950, 600], [990, 820], [790, 930], [440, 880], [230, 700], [200, 420]
  ];
  const ROAD = 44, KERB = 7;               // half width of the road, kerb width (pixels)
  const BOOSTS = [[620, -18], [1720, 16], [2900, 0], [4100, -16]]; // [distance along the track, side offset]

  const code = `-- Kart Lab: a 2.5D kart racing demo for BitKit
-- It's all about the karts. Build one in the garage (body, engine, tyres, paint),
-- then race three rival karts for 3 laps.
--   Throttle: R (analog: squeeze harder to go faster) or A     Brake / reverse: B
--   Steer: d-pad or stick
--   Drift: hold L while turning. Sparks go white, amber, violet: let go for a boost.
-- The track is the map (look at the Map tab), drawn in perspective with floor().
-- Karts and trees are sprites placed with project() and drawn at any size with sspr().
-- Tile flags: 0 road, 1 kerb, 2 grass, 3 boost pad, 4 start line.

TAU = math.pi * 2
LAPS = 3
CTRL = {${CTRL.map(p => `{${p[0]},${p[1]}}`).join(',')}}

-- camera (2.5D): height above the floor, horizon row, zoom, distance behind the kart
CAM_H, HORIZON, FOCAL, CAM_D = 20, 84, 170, 40
SPR_K = 0.6        -- sprite pixels per world pixel
STEP = 1           -- floor() column step: 2 is chunkier but faster (handy on the device)

-- ------------------------------------------------------------------ parts
-- Every part adds to the kart's stats: speed, accel, grip, weight, offroad, drift.
BODIES = {
  {name="Dart",   about="Slim and light. Quick off the line.",  spr=0,
   speed=3, accel=4, grip=3, weight=1, offroad=2, drift=4},
  {name="Brick",  about="Wide and heavy. Shoves others aside.",   spr=1,
   speed=4, accel=2, grip=3, weight=5, offroad=3, drift=2},
  {name="Hopper", about="Tall and bouncy. Loves the grass.",      spr=2,
   speed=3, accel=3, grip=2, weight=3, offroad=4, drift=4},
}
ENGINES = {
  {name="Buzz 2-stroke", about="Revs high, pulls hard, tops out early.", pipe={7,8,10}, pitch=1.5,
   speed=1, accel=4, grip=0, weight=0, offroad=0, drift=1},
  {name="Twin",          about="Smooth all-rounder.",                   pipe={28,29,13}, pitch=1.0,
   speed=3, accel=2, grip=0, weight=1, offroad=0, drift=0},
  {name="V-Torque",      about="Huge top speed, slow to wind up.",      pipe={24,25,26}, pitch=0.7,
   speed=5, accel=1, grip=0, weight=2, offroad=0, drift=0},
}
TYRES = {
  {name="Slicks",  about="Best on tarmac, hopeless on grass.", rim={28,29,13},
   speed=1, accel=0, grip=4, weight=0, offroad=0, drift=0},
  {name="Knobbly", about="Barely slow down off the road.",     rim={8,9,10},
   speed=0, accel=0, grip=2, weight=0, offroad=5, drift=0},
  {name="Softs",   about="Slidey and fun: drift charges fast.", rim={3,4,5},
   speed=0, accel=1, grip=1, weight=0, offroad=1, drift=4},
}
PAINTS = {
  {name="Red",{24,25,26}}, {name="Blue",{19,20,21}}, {name="Teal",{53,60,103}}, {name="Gold",{9,27,11}},
  {name="Lime",{15,16,17}}, {name="Grape",{2,3,4}}, {name="Snow",{28,29,13}}, {name="Ink",{1,31,30}},
}
STATS = {"speed","accel","grip","weight","offroad","drift"}

function build_stats(b, e, ty)
  local s = {}
  for _, k in ipairs(STATS) do s[k] = BODIES[b][k] + ENGINES[e][k] + TYRES[ty][k] end
  return s
end

-- ------------------------------------------------------------------ track
-- Same Catmull-Rom curve the map was painted with, resampled to evenly spaced waypoints.
function build_track()
  local raw, n = {}, #CTRL
  for i = 1, n do
    local p0, p1, p2, p3 = CTRL[(i - 2) % n + 1], CTRL[i], CTRL[i % n + 1], CTRL[(i + 1) % n + 1]
    for j = 0, 19 do
      local t = j / 20
      local t2, t3 = t * t, t * t * t
      local function cr(a, b, c, d) return 0.5 * (2*b + (c - a)*t + (2*a - 5*b + 4*c - d)*t2 + (3*b - a - 3*c + d)*t3) end
      raw[#raw + 1] = {cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])}
    end
  end
  WP, LEN = {}, 0
  local acc, SP = 0, 24
  WP[1] = {x=raw[1][1], y=raw[1][2], s=0}
  for i = 1, #raw do
    local a, b = raw[i], raw[i % #raw + 1]
    local d = math.sqrt((b[1]-a[1])^2 + (b[2]-a[2])^2)
    local u = 0
    while acc + (d - u) >= SP do
      u = u + (SP - acc); acc = 0
      local f = u / d
      WP[#WP + 1] = {x=a[1] + (b[1]-a[1])*f, y=a[2] + (b[2]-a[2])*f}
    end
    acc = acc + (d - u)
    LEN = LEN + d
  end
  if #WP > 2 then
    local l = WP[#WP]
    if (l.x - WP[1].x)^2 + (l.y - WP[1].y)^2 < (SP * 0.5)^2 then WP[#WP] = nil end
  end
  NWP = #WP
  for i = 1, NWP do
    local a, b = WP[(i - 2) % NWP + 1], WP[i % NWP + 1]
    local dx, dy = b.x - a.x, b.y - a.y
    local l = math.sqrt(dx*dx + dy*dy)
    WP[i].dx, WP[i].dy = dx / l, dy / l          -- direction of travel
    WP[i].nx, WP[i].ny = -dy / l, dx / l         -- to the right of it
    WP[i].a = math.atan(dy, dx)
  end
  -- minimap scale
  MM = {x=228, y=196, s=88 / 2048}
end

function plant_trees()
  srand(7)
  TREES = {}
  local tries = 0
  while #TREES < 110 and tries < 4000 do
    tries = tries + 1
    local x, y = rnd(16, 2032), rnd(16, 1008)
    local near = 1e9
    for i = 1, NWP, 2 do
      local w = WP[i]
      local d = (w.x - x)^2 + (w.y - y)^2
      if d < near then near = d end
    end
    if near > 78*78 and near < 400*400 then
      TREES[#TREES + 1] = {x=x, y=y, kind=(rnd(4) == 1) and 2 or 1}
    end
  end
  -- cones on both sides at a few corners
  CONES = {}
  for _, i in ipairs({math.floor(NWP*0.30), math.floor(NWP*0.47), math.floor(NWP*0.66)}) do
    local w = WP[i]
    for k = -1, 1 do
      CONES[#CONES + 1] = {x=w.x + w.nx*(ROADW+10) + w.dx*k*10, y=w.y + w.ny*(ROADW+10) + w.dy*k*10}
      CONES[#CONES + 1] = {x=w.x - w.nx*(ROADW+10) + w.dx*k*10, y=w.y - w.ny*(ROADW+10) + w.dy*k*10}
    end
  end
end
ROADW = ${ROAD}

-- ------------------------------------------------------------------ karts
function new_kart(b, e, ty, p, ai)
  local s = build_stats(b, e, ty)
  local k = {body=b, eng=e, tyre=ty, paint=p, ai=ai, st=s,
    name=PAINTS[p].name .. " " .. BODIES[b].name,
    x=0, y=0, a=0, vx=0, vy=0, fwd=0, drift=0, charge=0, boost=0, steer_vis=0,
    lap=0, wp=1, half=true, done=false, time=0, best=nil, lapt=0, bump=0, terr=1}
  k.top    = 2.35 + s.speed * 0.105
  k.acc    = 0.018 + s.accel * 0.007
  k.grip   = 0.07 + s.grip * 0.03
  k.turn   = 0.038 + s.grip * 0.0018
  k.mass   = 1 + s.weight * 0.22
  k.off    = 0.42 + s.offroad * 0.075
  k.driftc = 0.6 + s.drift * 0.18
  return k
end

function terrain(x, y)
  local f = fget(mget(x // 8, y // 8))
  if f & 8 ~= 0 then return 4 end      -- boost pad
  if f & 1 ~= 0 then return 1 end      -- road (and start line)
  if f & 2 ~= 0 then return 2 end      -- kerb
  return 3                             -- grass
end

local function angdiff(a, b)
  local d = (a - b) % TAU
  if d > math.pi then d = d - TAU end
  return d
end
local function clamp(v, a, b) return v < a and a or (v > b and b or v) end
local function sgn(v) return v < 0 and -1 or (v > 0 and 1 or 0) end

function drive(k, thr, brk, steer, drift_btn)
  -- steering first: turning makes the kart point somewhere new, then grip decides how much
  -- of the old velocity follows (low grip = slides)
  local speed = math.sqrt(k.vx*k.vx + k.vy*k.vy)
  local dir = (k.fwd < -0.05) and -1 or 1
  local sp = clamp(speed / 1.3, 0, 1)
  local turn = steer * k.turn * sp * dir
  local grip = k.grip

  -- drift: hop into it with L while steering at speed, steer to tighten or widen
  if drift_btn and k.drift == 0 and steer ~= 0 and k.fwd > 1.4 then
    k.drift, k.charge, k.hop = sgn(steer), 0, 8
    if not k.ai then sfx("C4", 1, 0.3, 6, 3, 0, 400) end
  end
  if k.drift ~= 0 then
    if not drift_btn or k.fwd < 1.0 then
      local tier = drift_tier(k)
      if tier > 0 then
        k.boost = math.max(k.boost, ({28, 48, 72})[tier])
        if not k.ai then sfx("G5", 2, 0.35, 16, 4, 0, -900) end
      end
      k.drift, k.charge = 0, 0
    else
      local into = steer * k.drift          -- +1 steering into the drift, -1 against
      turn = k.drift * k.turn * (0.95 + 0.45 * into) * sp
      k.charge = k.charge + k.driftc * (1 + 0.5 * math.max(into, 0))
      grip = grip * 0.3
    end
  end
  k.a = (k.a + turn) % TAU
  if k.hop and k.hop > 0 then k.hop = k.hop - 1 end

  local c, s = math.cos(k.a), math.sin(k.a)
  local fwd = k.vx*c + k.vy*s
  local lat = -k.vx*s + k.vy*c

  -- terrain
  local terr = terrain(k.x, k.y)
  k.terr = terr
  local top = k.top
  if terr == 3 then top = top * k.off
  elseif terr == 2 then top = top * 0.93
  elseif terr == 4 then
    if k.boost < 40 and not k.ai then sfx("E6", 5, 0.3, 14, 4, 0, 600) end
    k.boost = math.max(k.boost, 40)
  end
  if k.boost > 0 then top = math.max(top, k.top) * 1.32; k.boost = k.boost - 1 end

  -- engine and brakes
  if thr > 0 then
    local target = top * thr
    if fwd < target then fwd = math.min(target, fwd + k.acc * (1.25 - 0.6 * math.max(fwd, 0) / k.top))
    else fwd = math.max(target, fwd - 0.045) end
  else
    fwd = fwd * 0.986
  end
  if brk then
    if fwd > 0.05 then fwd = math.max(0, fwd - 0.09) else fwd = math.max(fwd - 0.03, -1.1) end
  end
  if k.boost > 0 then fwd = math.max(fwd, top * 0.95) end

  -- grip: kill sideways speed (less while drifting, which also slides outward)
  lat = lat * (1 - grip)
  if k.drift ~= 0 then lat = lat - k.drift * 0.05 * clamp(fwd / k.top, 0, 1) end

  k.fwd = fwd
  k.vx, k.vy = c*fwd - s*lat, s*fwd + c*lat
  k.x = clamp(k.x + k.vx, 6, 2042)
  k.y = clamp(k.y + k.vy, 6, 1018)
  k.steer_vis = k.steer_vis + (steer - k.steer_vis) * 0.25
end

function drift_tier(k)
  if k.drift == 0 then return 0 end
  if k.charge > 150 then return 3 elseif k.charge > 85 then return 2 elseif k.charge > 35 then return 1 end
  return 0
end

-- rivals follow the waypoints with their own lane and a little rubber band
function ai_input(k)
  local look = k.wp + 3 + math.floor(k.fwd * 1.4)
  local p = WP[(look - 1) % NWP + 1]
  local tx, ty = p.x + p.nx * k.lane, p.y + p.ny * k.lane
  local d = angdiff(math.atan(ty - k.y, tx - k.x), k.a)
  local steer = clamp(d * 3.5, -1, 1)
  local thr = k.skill
  local gap = progress(player) - progress(k)
  if gap > NWP * 0.15 then thr = thr * 1.08 elseif gap < -NWP * 0.12 then thr = thr * 0.9 end
  if math.abs(d) > 0.7 then thr = thr * 0.6 end
  k.lane = k.lane + (k.lane_want - k.lane) * 0.02
  if rnd(240) == 1 then k.lane_want = rnd(-22, 22) end
  return clamp(thr, 0, 1.08), false, steer, false
end

function progress(k) return k.lap * NWP + k.wp end

function track_kart(k)
  local best, bi = 1e12, k.wp
  for j = -3, 8 do
    local i = (k.wp + j - 1) % NWP + 1
    local w = WP[i]
    local d = (w.x - k.x)^2 + (w.y - k.y)^2
    if d < best then best, bi = d, i end
  end
  if k.wp > NWP - 12 and bi < 12 and k.half then     -- crossed the line going forward
    k.lap, k.half = k.lap + 1, false
    if k.lap > 1 then
      local lt = race_t - k.lapt
      if not k.best or lt < k.best then k.best = lt end
    end
    k.lapt = race_t
    if k.lap > LAPS and not k.done then
      k.done, k.time = true, race_t
      finished[#finished + 1] = k
      if k == player then sfx("C6", 4, 0.4, 40, 5) end
    elseif k == player and k.lap > 1 then sfx("A5", 4, 0.3, 12, 5) end
  end
  if bi > NWP // 2 - 6 and bi < NWP // 2 + 6 then k.half = true end
  k.wp = bi
end

function collide()
  -- kart vs kart: heavier karts push lighter ones
  for i = 1, #karts do
    local a = karts[i]
    for j = i + 1, #karts do
      local b = karts[j]
      local dx, dy = b.x - a.x, b.y - a.y
      local d2 = dx*dx + dy*dy
      if d2 < 13*13 and d2 > 0.01 then
        local d = math.sqrt(d2)
        local nx, ny = dx / d, dy / d
        local push = 13 - d
        local ma, mb = a.mass, b.mass
        a.x, a.y = a.x - nx * push * mb / (ma + mb), a.y - ny * push * mb / (ma + mb)
        b.x, b.y = b.x + nx * push * ma / (ma + mb), b.y + ny * push * ma / (ma + mb)
        local rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if rel < 0 then
          local imp = -1.5 * rel / (1/ma + 1/mb)
          a.vx, a.vy = a.vx - nx * imp / ma, a.vy - ny * imp / ma
          b.vx, b.vy = b.vx + nx * imp / mb, b.vy + ny * imp / mb
          if (a == player or b == player) and a.bump <= 0 then sfx("C2", 3, 0.4, 6, 6); shake = 6 end
          a.bump, b.bump = 10, 10
        end
      end
    end
    -- trees are solid
    for _, t in ipairs(TREES) do
      local dx, dy = a.x - t.x, a.y - t.y
      if dx*dx + dy*dy < 11*11 then
        local d = math.max(math.sqrt(dx*dx + dy*dy), 0.1)
        a.x, a.y = t.x + dx / d * 11, t.y + dy / d * 11
        a.vx, a.vy = a.vx * 0.3 + dx / d * 0.8, a.vy * 0.3 + dy / d * 0.8
        if a == player and a.bump <= 0 then sfx("A1", 3, 0.5, 10, 6); shake = 8 end
        a.bump = 10
      end
    end
    a.bump = a.bump - 1
  end
end

-- ------------------------------------------------------------------ game flow
function _init()
  build_track()
  plant_trees()
  sel = {body=1, eng=2, tyre=1, paint=1}
  if saved then
    local d = saved()
    if d and d.sel then sel = d.sel end
    best_time = d and d.best
  end
  row, mode, gt = 1, "garage", 0
  shake, parts = 0, {}
end

function start_race()
  karts, finished = {}, {}
  player = new_kart(sel.body, sel.eng, sel.tyre, sel.paint, false)
  -- three rivals, each a different random build (never your paint)
  srand(t() + 3)
  local paints = {}
  for i = 1, #PAINTS do if i ~= sel.paint then paints[#paints + 1] = i end end
  local grid = {{NWP - 1, -16}, {NWP - 1, 16}, {NWP - 4, -16}, {NWP - 4, 16}}
  for i = 1, 3 do
    local p = table.remove(paints, rnd(#paints))
    local k = new_kart(rnd(#BODIES), rnd(#ENGINES), rnd(#TYRES), p, true)
    k.skill, k.lane, k.lane_want = 0.9 + i * 0.025, rnd(-14, 14), 0
    karts[#karts + 1] = k
  end
  table.insert(karts, rnd(2, 4), player)       -- start somewhere in the pack
  for i, k in ipairs(karts) do
    local g = grid[i]
    local w = WP[g[1]]
    k.x, k.y, k.a, k.wp = w.x + w.nx * g[2], w.y + w.ny * g[2], w.a, g[1]
  end
  cam = {a = player.a, x = player.x, y = player.y}
  mode, gt, race_t = "count", 0, 0
end

function _update()
  gt = gt + 1
  if mode == "garage" then garage_update()
  elseif mode == "count" or mode == "race" then race_update()
  elseif mode == "results" then
    race_update()
    if gt > 60 and btnp("a") then mode, gt = "garage", 0 end
  end
end

function garage_update()
  local rows = {"body", "eng", "tyre", "paint"}
  local lists = {BODIES, ENGINES, TYRES, PAINTS}
  if btnp("up") then row = (row - 2) % 5 + 1; sfx("E5", 0, 0.2, 3) end
  if btnp("down") then row = row % 5 + 1; sfx("E5", 0, 0.2, 3) end
  if row <= 4 then
    local key, n = rows[row], #lists[row]
    if btnp("left") then sel[key] = (sel[key] - 2) % n + 1; sfx("A5", 0, 0.2, 3) end
    if btnp("right") then sel[key] = sel[key] % n + 1; sfx("A5", 0, 0.2, 3) end
  end
  if btnp("a") and (row == 5 or gt > 10) then
    if save then save({sel = sel, best = best_time}) end
    sfx("C5", 4, 0.3, 10); start_race()
  end
end

function race_update()
  if mode == "count" then
    if gt % 60 == 0 and gt < 180 then sfx("C5", 0, 0.4, 14) end
    if gt == 180 then sfx("C6", 0, 0.5, 30); mode, gt = "race", 0 end
  else
    race_t = race_t + 1
  end
  local racing = mode ~= "count"
  for _, k in ipairs(karts) do
    local thr, brk, steer, drift
    if k.done or not racing then
      if k.done then thr, brk, steer, drift = ai_input(k); thr = thr * 0.7
      else thr, brk, steer, drift = 0, false, 0, false end
    elseif k.ai then thr, brk, steer, drift = ai_input(k)
    else
      thr = math.max(press("r") / 255, btn("a") and 1 or 0)
      brk = btn("b")
      steer = (btn("right") and 1 or 0) - (btn("left") and 1 or 0)
      drift = btn("l") or press("l") > 100
    end
    drive(k, thr, brk, steer, drift)
    track_kart(k)
  end
  collide()
  if racing and player.done and mode ~= "results" then
    mode, gt = "results", 0
    if not best_time or player.time < best_time then best_time = player.time; new_best = true else new_best = false end
    if save then save({sel = sel, best = best_time}) end
  end
  track(player.x, player.y)        -- the Map tab shows your racing line
  -- camera swings behind the kart, lagging a little in turns and more in drifts
  local lag = player.drift ~= 0 and 0.07 or 0.13
  cam.a = (cam.a + angdiff(player.a, cam.a) * lag) % TAU
  local d = CAM_D + player.fwd * 2
  cam.x, cam.y = player.x - math.cos(cam.a) * d, player.y - math.sin(cam.a) * d
  -- engine note follows your speed
  if gt % 4 == 0 then
    local e = ENGINES[player.eng]
    tone((55 + math.abs(player.fwd) * 38) * e.pitch, 2, 0.10, 6, 0)
  end
  -- drift sparks and boost flames
  for _, k in ipairs(karts) do
    local tier = drift_tier(k)
    if (tier > 0 or k.boost > 0) and gt % 2 == 0 then
      local c, s = math.cos(k.a), math.sin(k.a)
      for side = -1, 1, 2 do
        parts[#parts + 1] = {x = k.x - c*7 - s*side*5, y = k.y - s*7 + c*side*5, z = 1 + rnd() * 2,
          vx = -c * 0.5 + (rnd() - 0.5) * 0.6, vy = -s * 0.5 + (rnd() - 0.5) * 0.6, vz = 0.4 + rnd() * 0.4,
          life = 12, col = k.boost > 0 and (rnd(2) == 1 and 10 or 27) or ({13, 27, 5})[tier]}
      end
    end
  end
  for i = #parts, 1, -1 do
    local p = parts[i]
    p.x, p.y, p.z, p.vz, p.life = p.x + p.vx, p.y + p.vy, p.z + p.vz, p.vz - 0.08, p.life - 1
    if p.life <= 0 then table.remove(parts, i) end
  end
  if shake > 0 then shake = shake - 1 end
end

-- ------------------------------------------------------------------ drawing
local function mountains(off, amp, base, col, seed)
  -- one silhouette layer; 360 degrees of turning = TAU * FOCAL pixels, so it lines up with the floor
  local per = TAU * FOCAL
  for x = 0, 319, 2 do
    local u = (x + off) % per / per * TAU
    local h = math.sin(u * 3 + seed) * 0.5 + math.sin(u * 7 + seed * 2) * 0.3 + math.sin(u * 13 + seed) * 0.2
    local top = math.floor(HORIZON - base - h * amp)
    rectfill(x, top, 2, HORIZON - top + 1, col)
  end
end

function draw_sky(a)
  local bands = {21, 21, 22, 22, 23}
  for i = 0, 4 do rectfill(0, i * HORIZON // 5, 320, HORIZON // 5 + 1, bands[i + 1]) end
  local off = a * FOCAL
  for i = 0, 5 do        -- clouds drift slowly
    local cx = (i * 211 - off * 0.5 + gt * 0.05) % 640 - 120
    local cy = 14 + (i * 37) % 30
    circfill(cx, cy, 9, 13); circfill(cx + 10, cy + 2, 7, 13); circfill(cx - 10, cy + 3, 6, 13)
  end
  mountains(off * 0.6, 14, 18, 20, 1)
  mountains(off, 8, 6, 14, 4)
end

-- kart sprite for a kart seen from the camera: 16 directions, 9 drawn + 7 mirrored
local function kart_frame(k, rel)
  local d = math.floor(rel / TAU * 16 + 0.5) % 16
  local flip = d > 8
  if flip then d = 16 - d end
  local idx = (k.body - 1) * 9 + d                  -- 27 frames, 5 per band of 3 tile rows
  return 176 + (idx // 5) * 48 + (idx % 5) * 3, flip
end

function kart_pal(k)
  local p = PAINTS[k.paint][1]
  pal(24, p[1]); pal(25, p[2]); pal(26, p[3])
  local r = TYRES[k.tyre].rim
  pal(3, r[1]); pal(4, r[2]); pal(5, r[3])
  local e = ENGINES[k.eng].pipe
  pal(6, e[1]); pal(7, e[2]); pal(8, e[3])
end

local function shadow(x, y, w)
  local h = math.max(1, w * 0.22)
  for j = -h, h do
    local f = 1 - (j / (h + 0.5))^2
    local hw = w * math.sqrt(math.max(f, 0))
    rectfill(x - hw, y + j, hw * 2, 1, 31)
  end
end

function draw_world()
  local sx = shake > 0 and rnd(-2, 2) or 0
  draw_sky(cam.a)
  -- the track: one call draws every floor row below the horizon
  floor(cam.x, cam.y, cam.a, CAM_H, HORIZON, FOCAL, 15, STEP)
  -- far haze line
  rectfill(0, HORIZON + 1, 320, 1, 23)

  local list = {}
  local function add(x, y, kind, obj)
    local px, py, sc = project(x, y)
    if px and sc > 0.03 and px > -80 and px < 400 then list[#list + 1] = {px=px, py=py, sc=sc, kind=kind, o=obj} end
  end
  for _, t in ipairs(TREES) do add(t.x, t.y, t.kind) end
  for _, c in ipairs(CONES) do add(c.x, c.y, 3) end
  for _, k in ipairs(karts) do add(k.x, k.y, 4, k) end
  for _, p in ipairs(parts) do add(p.x, p.y, 5, p) end
  -- start gantry posts
  local w = WP[1]
  add(w.x + w.nx * (ROADW + 6), w.y + w.ny * (ROADW + 6), 6)
  add(w.x - w.nx * (ROADW + 6), w.y - w.ny * (ROADW + 6), 6)
  table.sort(list, function(a, b) return a.sc < b.sc end)   -- far first

  camera(-sx, 0)
  for _, d in ipairs(list) do
    local s = d.sc * SPR_K
    if d.kind == 1 then          -- pine, 16x24
      sspr(464, d.px - 8 * s * 2, d.py - 23 * s * 2, 2, 3, s * 2)
    elseif d.kind == 2 then      -- round tree, 16x24
      sspr(466, d.px - 8 * s * 2, d.py - 23 * s * 2, 2, 3, s * 2)
    elseif d.kind == 3 then      -- cone, 8x8
      sspr(468, d.px - 4 * s, d.py - 7 * s, 1, 1, s)
    elseif d.kind == 6 then      -- gantry post + banner
      local h = 46 * d.sc
      rectfill(d.px - d.sc * 1.5, d.py - h, math.max(1, d.sc * 3), h, 29)
      d.top = d.py - h
    elseif d.kind == 5 then      -- spark
      local _, sy2 = project(d.o.x, d.o.y, d.o.z)
      if sy2 then circfill(d.px, sy2, math.max(0, d.sc * 0.8), d.o.col) end
    else                         -- kart
      local k = d.o
      local rel = angdiff(k.a, cam.a) + (k.drift ~= 0 and k.drift * 0.5 or 0) + k.steer_vis * 0.12
      local n, flip = kart_frame(k, rel)
      local hop = (k.hop or 0) > 0 and math.sin((8 - k.hop) / 8 * math.pi) * 3 or 0
      local bob = (k.terr == 3 or k.terr == 2) and (gt % 4 < 2 and 0.6 or 0) or 0
      shadow(d.px, d.py, 10 * s)
      kart_pal(k)
      sspr(n, d.px - 12 * s, d.py - (19 + hop + bob) * s, 3, 3, s, flip)
      pal()
      if k.boost > 0 then circfill(d.px, d.py - 4 * s, 2.5 * s, gt % 4 < 2 and 10 or 27) end
    end
  end
  -- banner between the two gantry posts
  local posts = {}
  for _, d in ipairs(list) do if d.kind == 6 then posts[#posts + 1] = d end end
  if #posts == 2 then
    local a, b = posts[1], posts[2]
    if a.px > b.px then a, b = b, a end
    local th = math.max(2, (a.sc + b.sc) * 3)
    for i = 0, 7 do
      local x0 = a.px + (b.px - a.px) * i / 8
      local y0 = a.top + (b.top - a.top) * i / 8
      rectfill(x0, y0, (b.px - a.px) / 8 + 1, th, i % 2 == 0 and 13 or 1)
    end
  end
  camera()
end

local function place_str(n) return n .. ({"st", "nd", "rd", "th"})[math.min(n, 4)] end
local function tstr(f)
  local s = f / 60
  return string.format("%d:%05.2f", math.floor(s / 60), s % 60)
end

function standings()
  local order = {}
  for _, k in ipairs(karts) do order[#order + 1] = k end
  table.sort(order, function(a, b)
    if a.done and b.done then return a.time < b.time end
    if a.done ~= b.done then return a.done end
    return progress(a) > progress(b)
  end)
  for i, k in ipairs(order) do k.place = i end
  return order
end

function draw_hud()
  local order = standings()
  -- place
  local pc = ({27, 29, 10, 13})[player.place]
  text(place_str(player.place), 9, 9, 1, 3); text(place_str(player.place), 8, 8, pc, 3)
  -- lap and time
  local lap = clamp(player.lap, 1, LAPS)
  text("LAP " .. lap .. "/" .. LAPS, 241, 9, 1); text("LAP " .. lap .. "/" .. LAPS, 240, 8, 13)
  local tm = player.done and player.time or race_t
  text(tstr(tm), 241, 19, 1); text(tstr(tm), 240, 18, 12)
  -- speed + drift charge
  local spd = clamp(player.fwd / (player.top * 1.32), 0, 1)
  rectfill(8, 222, 84, 10, 1)
  rectfill(10, 224, 80 * spd, 6, player.boost > 0 and 10 or 21)
  text(math.floor(math.abs(player.fwd) * 36) .. " km/h", 98, 223, 13)
  local tier = drift_tier(player)
  if player.drift ~= 0 then
    rectfill(8, 212, 84, 6, 1)
    rectfill(9, 213, math.min(player.charge / 150, 1) * 82, 4, ({28, 13, 27, 5})[tier + 1])
  end
  -- minimap
  rectfill(MM.x - 2, MM.y - 2, 92, 48, 1)
  for i = 1, NWP, 2 do
    local a, b = WP[i], WP[(i + 1) % NWP + 1]
    line(MM.x + a.x * MM.s, MM.y + a.y * MM.s, MM.x + b.x * MM.s, MM.y + b.y * MM.s, 28)
  end
  for i = #order, 1, -1 do
    local k = order[i]
    local c = PAINTS[k.paint][1][2]
    circfill(MM.x + k.x * MM.s, MM.y + k.y * MM.s, k == player and 2 or 1, k == player and 13 or c)
  end
  return order
end

function _draw()
  if mode == "garage" then draw_garage() return end
  draw_world()
  local order = draw_hud()
  if mode == "count" then
    local n = 3 - gt // 60
    local s = n > 0 and tostring(n) or "GO!"
    local w = #s * 32
    text(s, 162 - w // 2, 82, 1, 4); text(s, 160 - w // 2, 80, n > 0 and 27 or 17, 4)
  elseif mode == "race" and gt < 40 then
    text("GO!", 113, 82, 1, 4); text("GO!", 112, 80, 17, 4)
  elseif mode == "results" then
    rectfill(56, 60, 208, 112, 1); rect(56, 60, 208, 112, 13)
    text("FINISH!", 104, 66, 27, 2)
    for i, k in ipairs(order) do
      local y = 86 + i * 14
      local c = k == player and 27 or 13
      text(place_str(i), 64, y, c)
      text(k.name, 96, y, c)
      text(k.done and tstr(k.time) or "--", 200, y, c)
    end
    text(new_best and "New best time!" or ("Best " .. tstr(best_time or 0)), 64, 154, new_best and 17 or 29)
    if gt > 60 then text("A: back to garage", 104, 164, 29) end
  end
end

-- ------------------------------------------------------------------ garage
function draw_garage()
  cls(1)
  -- floor grid of the workshop
  for y = 0, 7 do rectfill(0, 150 + y * 12, 320, 1, 2) end
  text("KART LAB", 12, 10, 27, 2)
  text("build your kart", 12, 28, 29)
  -- turntable
  local k = {body = sel.body, eng = sel.eng, tyre = sel.tyre, paint = sel.paint}
  shadow(80, 150, 52)
  circ(80, 150, 50, 3)
  local rel = (gt / 240 * TAU) % TAU
  local n, flip = kart_frame(k, rel)
  kart_pal(k)
  sspr(n, 80 - 12 * 4, 150 - 19 * 4, 3, 3, 4, flip)
  pal()
  -- part pickers
  local items = {
    {"Body", BODIES[sel.body]}, {"Engine", ENGINES[sel.eng]}, {"Tyres", TYRES[sel.tyre]},
    {"Paint", PAINTS[sel.paint]}}
  for i, it in ipairs(items) do
    local y = 44 + (i - 1) * 22
    local on = row == i
    if on then rectfill(158, y - 3, 156, 20, 2) end
    text(it[1], 164, y, on and 27 or 29)
    local s = it[2].name
    text((on and "< " or "") .. s .. (on and " >" or ""), 164, y + 9, 13)
  end
  local on = row == 5
  rectfill(158, 134, 156, 16, on and 25 or 2)
  text("RACE!", 214, 138, on and 27 or 13)
  local about = row == 1 and BODIES[sel.body].about or row == 2 and ENGINES[sel.eng].about
    or row == 3 and TYRES[sel.tyre].about or row == 4 and "Looks only. Rivals never copy it." or "3 laps around Pinewood Loop."
  text(about, 12, 196, 29)
  -- stats
  local s = build_stats(sel.body, sel.eng, sel.tyre)
  for i, key in ipairs(STATS) do
    local x, y = 12 + ((i - 1) % 3) * 104, 210 + ((i - 1) // 3) * 12
    text(key, x, y, 28)
    rectfill(x + 60, y + 1, 36, 5, 31)
    rectfill(x + 60, y + 1, math.min(s[key], 10) * 3.6, 5, ({21, 17, 22, 9, 16, 5})[i])
  end
  if best_time then text("best " .. tstr(best_time), 220, 28, 29) end
  text("A: race", 260, 10, 29)
end
`;

  // ---------------------------------------------------------------- art
  // Kart models: voxels in a 16 (long) x 14 (wide) x 10 (tall) grid, nose toward +x.
  // Material ramps [dark, mid, light]. The game swaps the paint (24-26), rim (3-5) and pipe (6-8) colours with pal().
  const MAT = {
    P: [24, 25, 26], A: [29, 12, 13], T: [1, 31, 30], R: [3, 4, 5], M: [30, 28, 29], X: [6, 7, 8],
    S: [31, 30, 28], H: [28, 29, 13], V: [1, 19, 20], D: [1, 1, 31]
  };
  function model(build) {
    const v = new Map();
    const box = (x0, x1, y0, y1, z0, z1, m) => {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        if (m) v.set(x + ',' + y + ',' + z, m); else v.delete(x + ',' + y + ',' + z);
      }
    };
    const sym = (x0, x1, y0, y1, z0, z1, m) => { box(x0, x1, y0, y1, z0, z1, m); box(x0, x1, 13 - y1, 13 - y0, z0, z1, m); };
    build(box, sym);
    // generic driver: same for every kart, the kart is the star
    box(5, 6, 5, 8, 2, 3, 'D');          // seat
    box(6, 7, 5, 8, 3, 4, 'S');          // body
    box(6, 8, 5, 8, 5, 7, 'H');          // helmet
    box(8, 8, 6, 7, 6, 6, 'V');          // visor
    box(9, 9, 6, 7, 4, 4, 'D');          // steering wheel
    return v;
  }
  const wheels = (box, sym, rear, front) => {
    sym(1, 4, 0, 1, 0, rear, 'T'); sym(2, 3, 0, 0, 1, rear - 1, 'R');
    sym(11, 13, 0, 1, 0, front, 'T'); sym(12, 12, 0, 0, 1, front - 1, 'R');
  };
  const MODELS = [
    model((box, sym) => {                  // Dart: slim, low, pointed, rear wing
      wheels(box, sym, 3, 2);
      box(1, 14, 3, 10, 1, 1, 'P');
      box(3, 13, 4, 9, 2, 2, 'P');
      box(13, 15, 5, 8, 1, 2, 'P'); box(15, 15, 5, 5, 1, 2, null); box(15, 15, 8, 8, 1, 2, null);
      sym(4, 9, 2, 3, 1, 2, 'P'); sym(5, 8, 2, 2, 2, 2, 'A');
      box(1, 3, 5, 8, 2, 3, 'M'); box(0, 0, 5, 5, 2, 2, 'X'); box(0, 0, 8, 8, 2, 2, 'X');
      sym(1, 1, 3, 3, 3, 4, 'A'); box(0, 1, 2, 11, 5, 5, 'P');
      box(10, 12, 6, 7, 3, 3, 'A');
    }),
    model((box, sym) => {                  // Brick: wide and boxy, big bumpers
      wheels(box, sym, 4, 3);
      box(2, 13, 2, 11, 1, 3, 'P');
      box(9, 13, 3, 10, 4, 4, 'P');
      box(14, 15, 1, 12, 1, 2, 'A'); box(0, 1, 1, 12, 1, 2, 'A');
      box(2, 4, 4, 9, 4, 5, 'M'); box(0, 1, 4, 4, 3, 5, 'X'); box(0, 1, 9, 9, 3, 5, 'X');
      box(3, 4, 2, 2, 4, 4, 'A'); box(3, 4, 11, 11, 4, 4, 'A');
      box(5, 8, 3, 3, 4, 4, 'P'); box(5, 8, 10, 10, 4, 4, 'P');
    }),
    model((box, sym) => {                  // Hopper: rounded, raised, tall tail fin
      wheels(box, sym, 4, 3);
      box(2, 13, 3, 10, 2, 4, 'P');
      sym(2, 2, 3, 3, 2, 4, null); sym(13, 13, 3, 3, 2, 4, null);
      box(1, 14, 4, 9, 1, 1, 'P'); box(14, 15, 5, 8, 2, 3, 'P');
      box(10, 13, 4, 9, 5, 5, 'P'); sym(10, 13, 4, 4, 5, 5, null);
      box(1, 4, 6, 7, 5, 8, 'P'); box(1, 3, 6, 7, 9, 9, 'A'); box(4, 4, 6, 7, 8, 8, null);
      box(0, 1, 4, 9, 2, 3, 'M'); box(0, 0, 5, 5, 4, 4, 'X'); box(0, 0, 8, 8, 4, 4, 'X');
      sym(6, 11, 2, 2, 2, 3, 'A');
    }),
  ];

  // Ray-march each model from 16 yaw angles, slightly from above, into a 24x24 sprite.
  function renderKart(vox, theta) {
    const W = 24, S = 1.1, p = 0.42;               // size, pixels per voxel, camera pitch (rad)
    const F = [Math.cos(p), 0, -Math.sin(p)], U = [Math.sin(p), 0, Math.cos(p)];
    const ct = Math.cos(theta), st = Math.sin(theta);
    const out = new Uint8Array(W * W);
    const get = (x, y, z) => vox.get(x + ',' + y + ',' + z);
    for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
      const u = (px + 0.5 - 12) / S, w = (19 - (py + 0.5)) / S + 1.2;
      let prev = null;
      for (let t = -24; t < 30; t += 0.2) {
        const xc = U[0] * w + F[0] * t, yc = u, zc = U[2] * w + F[2] * t;
        // camera space -> model space (undo the yaw)
        const mx = xc * ct + yc * st, my = -xc * st + yc * ct;
        const X = Math.floor(mx + 8), Y = Math.floor(my + 7), Z = Math.floor(zc);
        const cell = [X, Y, Z];
        const m = (X >= 0 && X < 16 && Y >= 0 && Y < 14 && Z >= 0 && Z < 10) ? get(X, Y, Z) : null;
        if (m) {
          let shade = 1;
          if (prev) {
            const nx = prev[0] - X, ny = prev[1] - Y, nz = prev[2] - Z;
            if (nz > 0) shade = 2;
            else {
              const cy2 = nx * st + ny * ct;            // normal's sideways part in camera space
              const cx2 = nx * ct - ny * st;
              shade = cy2 > 0.3 ? 0 : (cy2 < -0.3 ? 1 : (cx2 < 0 ? 1 : 0));
              if (nz < 0) shade = 0;
            }
          }
          out[py * W + px] = MAT[m][shade];
          break;
        }
        prev = cell;
      }
    }
    // outline
    const o = out.slice();
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (out[y * W + x]) continue;
      if ((x > 0 && out[y * W + x - 1]) || (x < W - 1 && out[y * W + x + 1]) ||
          (y > 0 && out[(y - 1) * W + x]) || (y < W - 1 && out[(y + 1) * W + x])) o[y * W + x] = 1;
    }
    return o;
  }

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    const T = cart.tiles;
    const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) % 1000; };
    const roadPx = (x, y) => { const h = hash(x, y, 1); return h < 90 ? 31 : h < 170 ? 28 : 30; };
    const grassPx = (x, y, v) => { const h = hash(x, y, 2 + v); return h < 140 ? 15 : h < 200 ? 17 : 16; };
    const putTile = (n, fn) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) T[n * 64 + y * 8 + x] = fn(x, y); };

    // fixed floor tiles
    const ROADT = 1, GRASS = [2, 3, 4], CHECK = 5, BOOST = 6;
    putTile(ROADT, roadPx);
    putTile(2, (x, y) => grassPx(x, y, 0));
    putTile(3, (x, y) => (x === 2 && y === 3) || (x === 5 && y === 6) ? 27 : (x === 6 && y === 1) ? 13 : grassPx(x, y, 1));
    putTile(4, (x, y) => (hash(x, y, 9) < 500 ? 15 : 16));
    putTile(CHECK, (x, y) => (((x >> 2) + (y >> 2)) & 1) ? 13 : 1);
    putTile(BOOST, (x, y) => ((x + y) & 7) < 3 ? 27 : ((x + y) & 7) < 5 ? 10 : 9);
    const ROADF = 1, KERBF = 2, GRASSF = 4, BOOSTF = 8, STARTF = 16;
    cart.flags[ROADT] = ROADF; GRASS.forEach(g => cart.flags[g] = GRASSF);
    cart.flags[CHECK] = ROADF | STARTF; cart.flags[BOOST] = ROADF | BOOSTF;

    // the centre line, sampled finely
    const pts = [];
    const n = CTRL.length;
    for (let i = 0; i < n; i++) {
      const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
      for (let j = 0; j < 20; j++) {
        const t = j / 20, t2 = t * t, t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
        pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const segS = [0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      segS.push(segS[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const LEN = segS[pts.length];
    // spatial buckets of segments
    const CS = 64, grid = new Map();
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CS) - 2, x1 = Math.floor(Math.max(a[0], b[0]) / CS) + 2;
      const y0 = Math.floor(Math.min(a[1], b[1]) / CS) - 2, y1 = Math.floor(Math.max(a[1], b[1]) / CS) + 2;
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
    });
    // distance, arc length and signed side of the nearest point on the centre line
    function near(x, y) {
      const list = grid.get(Math.floor(x / CS) + ',' + Math.floor(y / CS));
      let best = 1e9, s = 0, side = 0;
      if (!list) return { d: 1e9, s: 0, side: 0 };
      for (const i of list) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        let f = ((x - a[0]) * dx + (y - a[1]) * dy) / l2; f = f < 0 ? 0 : f > 1 ? 1 : f;
        const ex = x - (a[0] + dx * f), ey = y - (a[1] + dy * f), d = Math.hypot(ex, ey);
        if (d < best) { best = d; s = segS[i] + f * Math.sqrt(l2); side = Math.sign(dx * ey - dy * ex); }
      }
      return { d: best, s, side };
    }
    const MW = 256, MH = 128;
    const cls = d => (d < ROAD ? 0 : d < ROAD + KERB ? 1 : 2);
    const corner = new Uint8Array((MW + 1) * (MH + 1));
    for (let y = 0; y <= MH; y++) for (let x = 0; x <= MW; x++) corner[y * (MW + 1) + x] = cls(near(x * 8, y * 8).d);

    // edge tiles: the corner classes are blended across the tile (marching-squares style), so road
    // edges run diagonally instead of in 8-pixel stairs. Identical tiles are shared.
    let next = 7;
    const edge = new Map();
    let overflow = false;
    for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
      const c00 = corner[ty * (MW + 1) + tx], c10 = corner[ty * (MW + 1) + tx + 1];
      const c01 = corner[(ty + 1) * (MW + 1) + tx], c11 = corner[(ty + 1) * (MW + 1) + tx + 1];
      const nr = near(tx * 8 + 4, ty * 8 + 4);
      let t;
      if (c00 === 0 && c10 === 0 && c01 === 0 && c11 === 0) {
        const s = ((nr.s % LEN) + LEN) % LEN;
        if (s < 7 || s > LEN - 7) t = CHECK;
        else if (BOOSTS.some(([bs, bo]) => s >= bs && s < bs + 26 && Math.abs(nr.side * nr.d - bo) < 12)) t = BOOST;
        else t = ROADT;
      } else if (c00 === 2 && c10 === 2 && c01 === 2 && c11 === 2) {
        const h = hash(tx, ty, 5);
        t = h < 25 ? 3 : h < 70 ? 4 : 2;
      } else {
        const stripe = Math.floor(nr.s / 16) & 1;
        const key = c00 + '' + c10 + c01 + c11 + stripe;
        if (!edge.has(key)) {
          if (next >= 176) { overflow = true; t = cls(nr.d) === 0 ? ROADT : 2; }
          else {
            const id = next++;
            edge.set(key, id);
            putTile(id, (x, y) => {
              const u = (x + 0.5) / 8, v = (y + 0.5) / 8;
              const val = c00 * (1 - u) * (1 - v) + c10 * u * (1 - v) + c01 * (1 - u) * v + c11 * u * v;
              const k = val < 0.5 ? 0 : val < 1.5 ? 1 : 2;
              return k === 0 ? roadPx(x, y) : k === 1 ? (stripe ? 13 : 25) : grassPx(x, y, 0);
            });
            const val = (c00 + c10 + c01 + c11) / 4;
            cart.flags[id] = val < 0.5 ? ROADF : val < 1.5 ? KERBF : GRASSF;
          }
        }
        if (edge.has(key)) t = edge.get(key);
      }
      cart.map[ty * MW + tx] = t;
    }
    if (overflow && typeof console !== 'undefined') console.warn('Kart Lab: ran out of edge tiles');

    // karts: 3 bodies x 9 angles, 24x24 each, packed 5 per band of 3 tile rows from tile 176
    MODELS.forEach((vox, b) => {
      for (let d = 0; d <= 8; d++) {
        const img = renderKart(vox, d / 16 * Math.PI * 2);
        const idx = b * 9 + d, base = 176 + Math.floor(idx / 5) * 48 + (idx % 5) * 3;
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++)
          T[(base + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = img[y * 24 + x];
      }
    });

    // billboards from tile 464: pine (2x3 tiles), round tree (2x3), cone (1x1)
    const sprite = (n, w, h, fn) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        T[(n + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = fn(x, y);
    };
    sprite(464, 16, 24, (x, y) => {
      if (y >= 19) return (x >= 7 && x <= 8) ? (x === 7 ? 7 : 6) : 0;
      const layer = y < 7 ? y : y < 13 ? y - 5 : y - 10;
      const half = 1 + layer * 0.8;
      const dx = x + 0.5 - 8;
      if (Math.abs(dx) > half) return 0;
      if (Math.abs(dx) > half - 1.2) return 1;
      return dx < -1 ? 16 : dx > 1.5 ? 14 : 15;
    });
    sprite(466, 16, 24, (x, y) => {
      if (y >= 17) return (x >= 7 && x <= 8) ? (x === 7 ? 7 : 6) : 0;
      const dx = x + 0.5 - 8, dy = y + 0.5 - 9, r = Math.hypot(dx, dy);
      if (r > 7.5) return 0;
      if (r > 6.5) return 1;
      const h = hash(x, y, 11);
      return dx + dy < -4 ? 17 : (dx + dy > 4 ? 15 : (h < 200 ? 17 : 16));
    });
    sprite(468, 8, 8, (x, y) => {
      if (y === 7) return x >= 1 && x <= 6 ? 30 : 0;
      const half = 0.5 + y * 0.45, dx = x + 0.5 - 4;
      if (Math.abs(dx) > half) return 0;
      return y === 3 || y === 4 ? 13 : (dx > 0 ? 9 : 10);
    });
  }

  const demo = { name: 'Kart Lab', code, buildGfx, about: 'A 2.5D kart racer: build a kart in the garage, then race three rivals.' };
  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push(demo);
})();
