/* Demo cart "Kart Lab": a 2.5D kart racer. Original art and code. MIT License.
   Tracks are levels edited on the Track tab (see tracks.js): a smooth loop through control points, with
   boost pads, item crates, hills and painted elevation. The game builds the road and the hills from them
   when a race starts (this file pre-paints the built-in tracks the same way so the Map tab shows them).
   The road is made from a few "segment" tiles (road, kerbs, grass, start line, boost pad).
   The karts are tiny voxel models rendered here from 9 angles (the other 7 are mirror images). */
(function () {
  // Built-in tracks: control points of the loop (world pixels, the map is 2048 x 1024; the first point is
  // the start line; [x, y, road, kerb] gives a point its own width), plus items placed by [fraction of the lap,
  // offset to the right of the centre line].
  const TRACK_DEFS = [
    { name: 'Pinewood Loop',
      pts: [[360, 190], [900, 150], [1400, 170], [1760, 290], [1880, 520], [1730, 730], [1430, 690],
        [1180, 540], [950, 600], [990, 820], [790, 930], [440, 880], [230, 700], [200, 420]],
      boosts: [[0.13, -18], [0.36, 16], [0.6, 0], [0.85, -16]],
      crates: [0.22, 0.52, 0.78],
      hills: [['ramp', 0.07, 0], ['hill', 0.27, 0], ['dip', 0.62, 0], ['bump', 0.73, 0], ['hill', 0.93, 120]] },
    { name: 'Quarry Hills',
      pts: [[260, 560], [300, 230], [700, 140], [1100, 240], [1250, 470], [1500, 330, 30, 5], [1800, 260, 32, 5],
        [1910, 560], [1700, 870], [1220, 900], [920, 700], [620, 880], [330, 830]],
      boosts: [[0.1, 0], [0.47, -16], [0.8, 14]],
      crates: [0.18, 0.4, 0.66, 0.9],
      hills: [['hill', 0.14, 0], ['bump', 0.22, 0], ['dip', 0.33, 0], ['hill', 0.45, 60], ['bump', 0.56, 0],
        ['hill', 0.7, -40], ['bump', 0.77, 0], ['dip', 0.87, 0], ['bump', 0.96, 0]],
      raise: [[1500, 120, 60, 260], [250, 950, 40, 220]] },   // painted elevation: [x, y, height, radius]
  ];
  const TRACKS = TRACK_DEFS.map(d => ({
    name: d.name,
    track: { pts: d.pts.map(p => p.slice()), road: 44, kerb: 7, laps: 3,
      items: [].concat(d.boosts.map(([t, o]) => ({ k: 'boost', t, o })), d.crates.map(t => ({ k: 'crate', t, o: 0 })), d.hills.map(([k, t, o]) => ({ k, t, o }))) },
    raise: d.raise || [],
  }));
  // elevation grid for a track (flat, plus any painted mounds)
  function heights(def) {
    const T = window.BKTracks, g = T.newHeights();
    def.raise.forEach(([x, y, h, r]) => {
      for (let gy = 0; gy < T.HG_H; gy++) for (let gx = 0; gx < T.HG_W; gx++) {
        const d2 = ((gx * T.HG_CELL - x) ** 2 + (gy * T.HG_CELL - y) ** 2) / (r * r);
        if (d2 < 9) g[gy * T.HG_W + gx] = Math.max(0, Math.min(255, Math.round(g[gy * T.HG_W + gx] + h * Math.exp(-d2))));
      }
    });
    return g;
  }
  const luaVal = v => Array.isArray(v) ? '{' + v.map(luaVal).join(', ') + '}'
    : typeof v === 'object' ? '{' + Object.keys(v).map(k => `${k} = ${luaVal(v[k])}`).join(', ') + '}'
    : typeof v === 'string' ? JSON.stringify(v) : String(v);
  const luaTracks = 'DEFAULT_TRACKS = {  -- used when the cart has no tracks (the studio passes the Track tab levels instead)\n' +
    TRACKS.map(t => `  {name = ${JSON.stringify(t.name)}, track = ${luaVal(t.track)}, height = "${window.BKTracks.heightHex(heights(t))}"},`).join('\n') + '\n}';

  const code = `-- Kart Lab: a 2.5D kart racing demo for BitKit
-- It's all about the karts. Main menu: pick a mode (Race, Rumble or Time Trial), then the track or
-- arena and the rules (laps, rivals, rival skill, which items are in the pool, helmets), then build your
-- kart in the garage (body, engine, tyres, paint) and go.
-- Rumble: an arena fight. Every hit (or a boosting kart ramming you) knocks off a helmet; with none left
-- you're KO. The last kart driving wins, or the one with the most helmets when the time runs out.
-- Multiplayer: every player (PLAYERS) races in the same match. One screen splits into views; linked Bits
-- (ME > 0) each draw only their own kart's view. Game logic never uses rnd() in drawing, so Bits stay in step.
--   Throttle: R (analog: squeeze harder to go faster) or A     Brake / reverse: B
--   Steer: d-pad. Steering comes in 3 stages: a tap is gentle, holding turns harder,
--          keep holding for the sharpest turn. It blends smoothly between them.
--   Drift: hold L (or B while on the throttle) and steer. The sparks go white, amber,
--          violet: let go for a boost. The longer the drift, the bigger the boost.
--   Item: X uses what you got from a crate. You can hold two: Y swaps them. Hold down to look back;
--         hold down + X fires backwards.
-- Items: Nitro (boost), Oil Slick (dropped behind you: whoever hits it slides about with oil on the
--        camera), Bolt (fired straight ahead or back), Drone (homes in on the kart in front of you, or
--        behind), Shield (blocks one hit), Tire (rolls along the road and homes in on karts ahead),
--        Golden Tires (grass, kerbs and hills don't slow you for a while).
--        Every item's chance and numbers are under Items on the Game tab.
--
-- Tracks are made on the Track tab: each is a level with LEVELS[n].track = {pts, road, kerb,
-- laps, items}. The road is a smooth loop through the points (the first one is the start
-- line); items are boost pads, crate rows and hills placed round the lap. LEVELS[n].height
-- is the painted elevation. The road, kerbs and hills are built from them when a race
-- starts. The road is drawn with the "segment" tiles you paint on the Track tab.
-- Tile behaviours (sprite flags): road, kerb, grass, boost, start: fget(tile, "boost").
-- The floor is drawn with floorh() (a floor with hills), and karts, trees and items are
-- sprites placed with project() and drawn at any size with sspr().

TAU = math.pi * 2
LAPS = tune("Laps", 3, 1, 9)             -- tune(): a slider on the Game tab
ROADW, KERBW = 44, 7          -- half width of the road, kerb width (pixels)

-- camera (2.5D): height above the ground, horizon row, zoom, distance behind the kart
CAM_H, HORIZON, FOCAL, CAM_D = tune("Camera height", 22, 12, 40), 84, 170, tune("Camera distance", 40, 20, 80)
SPR_K = 0.6        -- sprite pixels per world pixel
STEP = 1           -- floor column step: 2 is chunkier but faster (handy on the device)
KARTS = tune("Karts in a race", 8, 2, 8)   -- karts in a race: the players, then rivals fill the grid (2 to 8)

-- steering stages: {how hard, frames held before this stage starts}
STEER = {{0.35, 0}, {0.7, 10}, {1.0, 26}}

__TRACKS__

-- ------------------------------------------------------------------ parts
-- Every part adds to the kart's stats: speed, accel, grip, weight, offroad, drift.
BODIES = {
  {name="Dart",   about="Slim and light. Quick off the line.",
   speed=3, accel=4, grip=3, weight=1, offroad=2, drift=4},
  {name="Brick",  about="Wide and heavy. Shoves others aside.",
   speed=4, accel=2, grip=3, weight=5, offroad=3, drift=2},
  {name="Hopper", about="Tall and bouncy. Loves the grass.",
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

-- items from crates. odds = chance by race position (front to back): leaders get defence, the back gets
-- speed. "Items/..." settings are grouped under Items on the Game tab (times are in seconds).
ITEMS = {
  {name="Nitro",        icon=469, odds={0, 25, 30, 35}, on=tune("Items/Nitro: how often", 1, 0, 3, 0.25)},
  {name="Oil Slick",    icon=471, odds={40, 20, 15, 10}, on=tune("Items/Oil Slick: how often", 1, 0, 3, 0.25)},
  {name="Bolt",         icon=473, odds={35, 30, 25, 20}, on=tune("Items/Bolt: how often", 1, 0, 3, 0.25)},
  {name="Drone",        icon=475, odds={0, 10, 15, 25}, on=tune("Items/Drone: how often", 1, 0, 3, 0.25)},
  {name="Shield",       icon=477, odds={25, 15, 15, 10}, on=tune("Items/Shield: how often", 1, 0, 3, 0.25)},
  {name="Tire",         icon=422, odds={15, 25, 25, 20}, on=tune("Items/Tire: how often", 1, 0, 3, 0.25)},
  {name="Golden Tires", icon=424, odds={0, 10, 20, 30}, on=tune("Items/Golden Tires: how often", 1, 0, 3, 0.25)},
}
NITRO_T  = tune("Items/Nitro: boost time", 1.25, 0.25, 4, 0.25) * 60
OIL_T    = tune("Items/Oil Slick: slippery time", 2.5, 0.5, 6, 0.25) * 60
OIL_GRIP = tune("Items/Oil Slick: grip left (%)", 12, 0, 100, 1) / 100
OIL_LENS = tune("Items/Oil Slick: oil on the camera", true)
BOLT_V   = tune("Items/Bolt: speed", 6, 2, 12, 0.5)
DRONE_V  = tune("Items/Drone: speed", 3, 1, 8, 0.5)
SHIELD_T = tune("Items/Shield: time", 7, 1, 20, 0.5) * 60
TIRE_V   = tune("Items/Tire: speed", 5, 2, 10, 0.5)
TIRE_HOME = tune("Items/Tire: homing", 0.35, 0, 1, 0.05)
TIRE_T   = tune("Items/Tire: rolls for", 6, 1, 15, 0.5) * 60
GOLD_T   = tune("Items/Golden Tires: time", 6, 1, 20, 0.5) * 60
CRATE_T  = tune("Items/Crates come back after", 4, 1, 15, 0.5) * 60
SPIN_T   = tune("Items/Spin-out time", 0.85, 0.25, 3, 0.05) * 60

function build_stats(b, e, ty)
  local s = {}
  for _, k in ipairs(STATS) do s[k] = BODIES[b][k] + ENGINES[e][k] + TYRES[ty][k] end
  return s
end

local function angdiff(a, b)
  local d = (a - b) % TAU
  if d > math.pi then d = d - TAU end
  return d
end
local function clamp(v, a, b) return v < a and a or (v > b and b or v) end
local function sgn(v) return v < 0 and -1 or (v > 0 and 1 or 0) end

-- ------------------------------------------------------------------ tracks
-- every level with a "start" entity is a track; without level data the built-in tracks are used
function track_list()
  local list = {}
  for i, L in ipairs(LEVELS or {}) do
    if L.track and L.track.pts then
      list[#list + 1] = {name = L.name, level = i, track = L.track, height = L.height}
    else
      for _, p in ipairs(L.placed or {}) do       -- older carts: a "start" entity and "node" entities
        if p[1] == "start" then list[#list + 1] = {name = L.name, level = i, placed = L.placed}; break end
      end
    end
  end
  if #list == 0 then
    for _, t in ipairs(DEFAULT_TRACKS) do list[#list + 1] = {name = t.name, track = t.track, height = t.height} end
  end
  return list
end

-- a track from the Track tab: the points are the loop, the items are placed once the curve is built
function spline_track(tk, height)
  local ctrl = {}
  for i, p in ipairs(tk.pts) do ctrl[i] = {p[1], p[2], p[3], p[4]} end   -- x, y and (optional) road and kerb width here
  if #ctrl < 3 then return nil end
  return {ctrl = ctrl, items = tk.items or {}, height = height, boosts = {}, crates = {}, hills = {}}
end

-- point and right-hand normal at distance s round the lap (after build_track)
function at_s(s)
  s = s % LEN
  local lo, hi = 1, #RAW
  while lo < hi do
    local m = (lo + hi + 1) // 2
    if RAWS[m] <= s then lo = m else hi = m - 1 end
  end
  local a, b = RAW[lo], RAW[lo % #RAW + 1]
  local seg = RAWS[lo + 1] - RAWS[lo]
  local f = seg > 0 and (s - RAWS[lo]) / seg or 0
  local dx, dy = (b[1] - a[1]) / (seg > 0 and seg or 1), (b[2] - a[2]) / (seg > 0 and seg or 1)
  return a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, -dy, dx
end

-- hills, bumps, dips and ramps: height, size (radius, or length for a ramp), shape (the Track tab has the same)
HILL_KINDS = {hill = {36, 360, "round"}, bump = {14, 88, "round"}, dip = {-26, 320, "round"}, ramp = {22, 72, "straight"}}
RAMP_W = 24                        -- half width of a ramp, unless the piece sets its own
-- a shape is 5 heights (0..1) from the top (the middle, or a ramp's lip) out to the edge
SHAPES = {round = {1, 0.78, 0.37, 0.1, 0}, dome = {1, 0.95, 0.75, 0.4, 0}, cone = {1, 0.75, 0.5, 0.25, 0},
  mesa = {1, 1, 0.95, 0.4, 0}, spike = {1, 0.35, 0.12, 0.03, 0}, straight = {1, 0.75, 0.5, 0.25, 0}, kicker = {1, 0.55, 0.25, 0.07, 0}}
function shape_at(c, u)            -- smooth curve through the 5 heights, u from 0 (top) to 1 (edge)
  if u >= 1 then return c[5] end
  local f = u * 4
  local i = math.floor(f)
  local t = f - i
  local p0, p1, p2, p3 = c[math.max(i, 1)], c[i + 1], c[i + 2], c[math.min(i + 3, 5)]
  return 0.5 * (2*p1 + (p2 - p0)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t*t + (3*p1 - p0 - 3*p2 + p3)*t*t*t)
end
function hill_h(hl, x, y)          -- what one piece adds to the ground at (x, y)
  local ex, ey = x - hl.x, y - hl.y
  if hl.ramp then
    local a, c = ex * hl.dx + ey * hl.dy, math.abs(ex * hl.nx + ey * hl.ny)
    if a < -hl.r or a > 8 or c > hl.w + 12 then return 0 end
    local side = c <= hl.w and 1 or 1 - (c - hl.w) / 12
    local v = a <= 0 and shape_at(hl.c, -a / hl.r) or hl.c[1] * (1 - a / 8)   -- up to the lip, then a sharp drop
    return hl.h * v * side * side * (3 - 2 * side)
  end
  local d2 = (ex * ex + ey * ey) / (hl.r * hl.r)
  if d2 >= 1 then return 0 end
  return hl.h * shape_at(hl.c, math.sqrt(d2))
end
-- ------------------------------------------------------------------ game modes and arenas
MODES = {
  {key = "race",  name = "Race",       about = "8 karts, items, first over the line."},
  {key = "rumble", name = "Rumble",    about = "Arena fight. Lose every helmet: KO!"},
  {key = "trial", name = "Time Trial", about = "Just you, two Nitros and the clock."},
}
-- arenas for Rumble: a paved area in the middle of the map, banked at the edge
ARENAS = {
  {name = "Quarry Bowl", kind = "bowl", w = 560, h = 330, r = 170},
  {name = "Donut Ring",  kind = "ring", r1 = 150, r2 = 440},
}
ACX, ACY = 1024, 512
ARENA_WALL = -4                      -- how far onto the kerb a kart's middle can go (the kerb is a wall)
function arena_d(A, x, y)            -- distance to the arena's edge: below 0 is inside the paved area
  if A.kind == "ring" then
    local d = math.sqrt((x - ACX)^2 + (y - ACY)^2)
    return math.max(A.r1 - d, d - A.r2)
  end
  local qx, qy = math.abs(x - ACX) - (A.w - A.r), math.abs(y - ACY) - (A.h - A.r)
  return math.sqrt(math.max(qx, 0)^2 + math.max(qy, 0)^2) + math.min(math.max(qx, qy), 0) - A.r
end

-- the arena's kerb is a wall: a kart that reaches it is put back and bounces off
function arena_wall(k)
  local d = arena_d(ARENA, k.x, k.y)
  if d > ARENA_WALL then
    local gx = arena_d(ARENA, k.x + 2, k.y) - arena_d(ARENA, k.x - 2, k.y)
    local gy = arena_d(ARENA, k.x, k.y + 2) - arena_d(ARENA, k.x, k.y - 2)
    local m = math.max(math.sqrt(gx*gx + gy*gy), 0.01)
    gx, gy = gx / m, gy / m
    k.x, k.y = k.x - gx * (d - ARENA_WALL), k.y - gy * (d - ARENA_WALL)
    local out = k.vx * gx + k.vy * gy
    if out > 0 then
      k.vx, k.vy = (k.vx - gx * out * 1.6) * 0.85, (k.vy - gy * out * 1.6) * 0.85
      if out > 0.8 and mine(k) then sfx("C2", 4, 0.12, 3, 2) end
    end
  end
end

-- builds an arena over several frames: banked ground, the paved floor, a ring of waypoints, crates
function build_arena(A, seed)
  local Y = coroutine.yield
  local KW = 8
  for cy = 0, 128 do
    for cx = 0, 256 do
      local x, y = cx * 8, cy * 8
      local d = arena_d(A, x, y)
      local h = 40
      if d > -70 then h = h + math.min((d + 70) * 0.28, 26) end           -- banked edge
      if d > 0 then h = h + math.min(d * 0.6, 50) end                        -- and a wall of earth
      if A.kind == "ring" then
        local r = math.sqrt((x - ACX)^2 + (y - ACY)^2)
        if r < A.r1 then h = h + (A.r1 - r) * 0.35 end                       -- an island hill in the middle
      else
        local r2 = ((x - ACX)^2 + (y - ACY)^2) / (110 * 110)
        if r2 < 1 then h = h + 22 * shape_at(SHAPES.dome, math.sqrt(r2)) end  -- a hump in the middle
      end
      hset(cx, cy, h + 0.5)
    end
    if cy % 16 == 0 then Y(0.4 * cy / 128) end
  end
  local CL = {}
  for cy = 0, 128 do
    for cx = 0, 256 do
      local d = arena_d(A, cx * 8, cy * 8)
      CL[cy * 257 + cx] = d < -KW and 0 or (d < 0 and 1 or 2)
    end
  end
  Y(0.6)
  for ty = 0, 127 do
    for tx = 0, 255 do
      local k00 = ty * 257 + tx
      local c00, c10, c01, c11 = CL[k00], CL[k00 + 1], CL[k00 + 257], CL[k00 + 258]
      local t
      if c00 + c10 + c01 + c11 == 0 then t = 1
      elseif c00 + c10 + c01 + c11 == 8 then t = grass_tile(tx, ty)
      else
        local s = math.floor((math.atan(ty * 8 - ACY, tx * 8 - ACX) + math.pi) * 60)
        t = 7 + (c00*27 + c10*9 + c01*3 + c11) * 2 + (s // 16) % 2
      end
      mset(tx, ty, t)
    end
    if ty % 32 == 0 then Y(0.6 + 0.3 * ty / 128) end
  end
  -- a ring of waypoints round the middle of the floor (rivals wander along it, the minimap draws it)
  WP = {}
  local rx, ry = (A.kind == "ring") and (A.r1 + A.r2) / 2 or A.w - 110, (A.kind == "ring") and (A.r1 + A.r2) / 2 or A.h - 110
  for i = 1, 48 do
    local a = (i - 1) / 48 * TAU
    WP[i] = {x = ACX + math.cos(a) * rx, y = ACY + math.sin(a) * ry, w = 60}
  end
  NWP = #WP
  for i = 1, NWP do
    local a, b = WP[(i - 2) % NWP + 1], WP[i % NWP + 1]
    local dx, dy = b.x - a.x, b.y - a.y
    local m = math.sqrt(dx*dx + dy*dy)
    WP[i].dx, WP[i].dy, WP[i].nx, WP[i].ny, WP[i].a = dx / m, dy / m, -dy / m, dx / m, math.atan(dy, dx)
  end
  MM = {x=228, y=196, s=88 / 2048}
  -- trees round the outside, crates spread over the floor
  srand(seed)
  TREES = {}
  local tries = 0
  while #TREES < 90 and tries < 3000 do
    tries = tries + 1
    local x, y = rnd(16, 2032), rnd(16, 1008)
    local d = arena_d(A, x, y)
    if d > 40 and d < 420 then TREES[#TREES + 1] = {x=x, y=y, z=hget(x, y), kind=(rnd(4) == 1) and 2 or 1} end
  end
  CRATES = {}
  for i = 1, 8 do
    local a = (i - 0.5) / 8 * TAU
    local f = (i % 2 == 0) and 0.55 or 0.85
    local x, y = ACX + math.cos(a) * rx * f, ACY + math.sin(a) * ry * f
    if A.kind == "ring" then x, y = ACX + math.cos(a) * rx, ACY + math.sin(a) * ry end
    for _, d in ipairs({-18, 0, 18}) do CRATES[#CRATES + 1] = {x = x - math.sin(a) * d, y = y + math.cos(a) * d, t = 0} end
  end
  for _, c in ipairs(CRATES) do c.z, c.t = hget(c.x, c.y), 0 end
end

function place_items(T)
  for _, it in ipairs(T.items or {}) do
    local x, y, nx, ny = at_s((it.t or 0) * LEN)
    local o = it.o or 0
    if it.k == "boost" then T.boosts[#T.boosts + 1] = {x + nx * o, y + ny * o}
    elseif it.k == "crate" then
      for _, d in ipairs({-22, 0, 22}) do T.crates[#T.crates + 1] = {x = x + nx * (o + d), y = y + ny * (o + d), t = 0} end
    elseif HILL_KINDS[it.k] then
      local d = HILL_KINDS[it.k]
      local c = type(it.c) == "table" and #it.c == 5 and it.c or SHAPES[it.c or d[3]] or SHAPES.round
      T.hills[#T.hills + 1] = {x = x + nx * o, y = y + ny * o, h = it.h or d[1], r = math.max(it.r or d[2], 8), c = c,
        ramp = it.k == "ramp", dx = ny, dy = -nx, nx = nx, ny = ny, w = it.w or RAMP_W}
    end
  end
end

-- turn the placed entities into a loop of control points plus pads, crates and hills
function read_track(placed)
  local start, nodes = nil, {}
  local T = {boosts = {}, crates = {}, hills = {}}
  for _, p in ipairs(placed) do
    local k, x, y = p[1], p[2] + 4, p[3] + 4
    if k == "start" then start = {x, y}
    elseif k == "node" then nodes[#nodes + 1] = {x, y}
    elseif k == "boost" then T.boosts[#T.boosts + 1] = {x, y}
    elseif k == "crate" then T.crates[#T.crates + 1] = {x = x, y = y, t = 0}
    elseif k == "hill" then T.hills[#T.hills + 1] = {x = x, y = y, h = 36, r = 360, c = SHAPES.round}
    elseif k == "bump" then T.hills[#T.hills + 1] = {x = x, y = y, h = 14, r = 88, c = SHAPES.round}
    elseif k == "dip" then T.hills[#T.hills + 1] = {x = x, y = y, h = -26, r = 320, c = SHAPES.round} end
  end
  if not start or #nodes < 3 then return nil end
  local ctrl, cur = {start}, start
  while #nodes > 0 do                       -- from the start, always on to the nearest node left
    local bi, bd = 1, 1e18
    for i, n in ipairs(nodes) do
      local d = (n[1] - cur[1])^2 + (n[2] - cur[2])^2
      if d < bd then bi, bd = i, d end
    end
    cur = table.remove(nodes, bi)
    ctrl[#ctrl + 1] = cur
  end
  T.ctrl = ctrl
  return T
end

-- Catmull-Rom through the control points: RAW is the fine curve (for painting), WP the waypoints
function build_track(ctrl)
  RAW = {}
  local n = #ctrl
  for i = 1, n do
    local p0, p1, p2, p3 = ctrl[(i - 2) % n + 1], ctrl[i], ctrl[i % n + 1], ctrl[(i + 1) % n + 1]
    for j = 0, 7 do
      local t = j / 8
      local t2, t3 = t * t, t * t * t
      local function cr(a, b, c, d) return 0.5 * (2*b + (c - a)*t + (2*a - 5*b + 4*c - d)*t2 + (3*b - a - 3*c + d)*t3) end
      RAW[#RAW + 1] = {cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])}
    end
  end
  RAWS = {0}
  for i = 1, #RAW do
    local a, b = RAW[i], RAW[i % #RAW + 1]
    RAWS[i + 1] = RAWS[i] + math.sqrt((b[1]-a[1])^2 + (b[2]-a[2])^2)
  end
  LEN = RAWS[#RAW + 1]
  -- road and kerb width at every sample: each point can set its own, blended smoothly to the next
  RW, KW = {}, {}
  for i = 1, n do
    local a, b = ctrl[i], ctrl[i % n + 1]
    local ra, rb, ka, kb = a[3] or ROADW, b[3] or ROADW, a[4] or KERBW, b[4] or KERBW
    for j = 0, 7 do
      local u = j / 8
      u = u * u * (3 - 2 * u)
      RW[#RW + 1], KW[#KW + 1] = ra + (rb - ra) * u, ka + (kb - ka) * u
    end
  end
  WP = {}
  local acc, SP = 0, 24
  WP[1] = {x=RAW[1][1], y=RAW[1][2], w=RW[1]}
  for i = 1, #RAW do
    local a, b = RAW[i], RAW[i % #RAW + 1]
    local d = RAWS[i + 1] - RAWS[i]
    local u = 0
    while d > 0 and acc + (d - u) >= SP do
      u = u + (SP - acc); acc = 0
      local f = u / d
      WP[#WP + 1] = {x=a[1] + (b[1]-a[1])*f, y=a[2] + (b[2]-a[2])*f, w=RW[i] + (RW[i % #RAW + 1] - RW[i]) * f}
    end
    acc = acc + (d - u)
  end
  local l = WP[#WP]
  if #WP > 2 and (l.x - WP[1].x)^2 + (l.y - WP[1].y)^2 < (SP * 0.5)^2 then WP[#WP] = nil end
  NWP = #WP
  for i = 1, NWP do
    local a, b = WP[(i - 2) % NWP + 1], WP[i % NWP + 1]
    local dx, dy = b.x - a.x, b.y - a.y
    local m = math.sqrt(dx*dx + dy*dy)
    WP[i].dx, WP[i].dy = dx / m, dy / m          -- direction of travel
    WP[i].nx, WP[i].ny = -dy / m, dx / m         -- to the right of it
    WP[i].a = math.atan(dy, dx)
  end
  MM = {x=228, y=196, s=88 / 2048}
end

function grass_tile(tx, ty)
  local v = (tx * 31 + ty * 17 + (tx * ty) % 7) % 40
  return v == 0 and 3 or (v < 3 and 4 or 2)
end

-- Builds the world for a track over several frames (it's a coroutine): heights, then the road.
-- Road tiles come from the classes of their 4 corners (road / kerb / grass), so edges run diagonally.
function build_world(T, seed)
  local Y = coroutine.yield
  build_track(T.ctrl)
  place_items(T)
  -- elevation: the painted grid (one height every 16 px, as hex), then a smooth bump per hill
  local G = nil
  if T.height and #T.height >= 129 * 65 * 2 then
    G = {}
    for i = 0, 129 * 65 - 1 do G[i] = tonumber(T.height:sub(i * 2 + 1, i * 2 + 2), 16) or 40 end
    Y(0.05)
  end
  for cy = 0, 128 do
    for cx = 0, 256 do
      local x, y, h = cx * 8, cy * 8, 40
      if G then
        local gx, gy = cx // 2, cy // 2
        local gx2, gy2 = math.min(gx + 1, 128), math.min(gy + 1, 64)
        local u, v = (cx % 2) * 0.5, (cy % 2) * 0.5
        h = (G[gy * 129 + gx] * (1 - u) + G[gy * 129 + gx2] * u) * (1 - v) + (G[gy2 * 129 + gx] * (1 - u) + G[gy2 * 129 + gx2] * u) * v
      end
      for _, hl in ipairs(T.hills) do h = h + hill_h(hl, x, y) end
      hset(cx, cy, h + 0.5)
    end
    if cy % 16 == 0 then Y(0.3 * cy / 128) end
  end
  -- clear the old road
  for ty = 0, 127 do
    for tx = 0, 255 do
      if mget(tx, ty) <= 168 then mset(tx, ty, grass_tile(tx, ty)) end
    end
    if ty % 32 == 0 then Y(0.3 + 0.2 * ty / 128) end
  end
  -- segments of the fine curve in 64-pixel buckets
  local n, CS, grid = #RAW, 64, {}
  for i = 1, n do
    local a, b = RAW[i], RAW[i % n + 1]
    for gx = math.min(a[1], b[1]) // CS - 1, math.max(a[1], b[1]) // CS + 1 do
      for gy = math.min(a[2], b[2]) // CS - 1, math.max(a[2], b[2]) // CS + 1 do
        local k = gx * 1000 + gy
        local l = grid[k]
        if not l then l = {}; grid[k] = l end
        l[#l + 1] = i
      end
    end
  end
  local function near(x, y)
    local list = grid[(x // CS) * 1000 + (y // CS)]
    if not list then return 1e9, 0, ROADW, KERBW end
    local best, s, rw, kw = 1e18, 0, ROADW, KERBW
    for _, i in ipairs(list) do
      local a, b = RAW[i], RAW[i % n + 1]
      local dx, dy = b[1] - a[1], b[2] - a[2]
      local l2 = dx*dx + dy*dy
      local f = l2 > 0 and ((x - a[1])*dx + (y - a[2])*dy) / l2 or 0
      f = f < 0 and 0 or (f > 1 and 1 or f)
      local ex, ey = x - (a[1] + dx*f), y - (a[2] + dy*f)
      local d = ex*ex + ey*ey
      if d < best then
        local j = i % n + 1
        best, s, rw, kw = d, RAWS[i] + f * (RAWS[i + 1] - RAWS[i]), RW[i] + (RW[j] - RW[i]) * f, KW[i] + (KW[j] - KW[i]) * f
      end
    end
    return math.sqrt(best), s, rw, kw
  end
  -- classify the tile corners near the road: 0 road, 1 kerb, 2 grass
  local mw = 0
  for i = 1, n do mw = math.max(mw, RW[i] + KW[i]) end
  local CL, CSV, M = {}, {}, mw + 4
  for i = 1, n do
    local a, b = RAW[i], RAW[i % n + 1]
    for cy = math.max(0, (math.min(a[2], b[2]) - M) // 8), math.min(128, (math.max(a[2], b[2]) + M) // 8 + 1) do
      for cx = math.max(0, (math.min(a[1], b[1]) - M) // 8), math.min(256, (math.max(a[1], b[1]) + M) // 8 + 1) do
        local k = cy * 257 + cx
        if not CL[k] then
          local d, s, rw, kw = near(cx * 8, cy * 8)
          CL[k] = d < rw and 0 or (d < rw + kw and 1 or 2)
          CSV[k] = s
        end
      end
    end
    if i % 24 == 0 then Y(0.5 + 0.4 * i / n) end
  end
  -- pick each tile from its corners
  local done = {}
  for k, c in pairs(CL) do
    if c < 2 then
      local cy, cx = k // 257, k % 257
      for ty = cy - 1, cy do
        for tx = cx - 1, cx do
          local tk = ty * 256 + tx
          if tx >= 0 and ty >= 0 and tx < 256 and ty < 128 and not done[tk] then
            done[tk] = true
            local k00 = ty * 257 + tx
            local c00, c10, c01, c11 = CL[k00] or 2, CL[k00 + 1] or 2, CL[k00 + 257] or 2, CL[k00 + 258] or 2
            local s = CSV[k00] or CSV[k00 + 1] or CSV[k00 + 257] or CSV[k00 + 258] or 0
            local t
            if c00 + c10 + c01 + c11 == 0 then
              t = (s < 7 or s > LEN - 7) and 5 or 1
            else
              t = 7 + (c00*27 + c10*9 + c01*3 + c11) * 2 + (s // 16) % 2
            end
            mset(tx, ty, t)
          end
        end
      end
    end
  end
  for _, b in ipairs(T.boosts) do
    for ty = b[2] // 8 - 2, b[2] // 8 + 2 do
      for tx = b[1] // 8 - 2, b[1] // 8 + 2 do
        if mget(tx, ty) == 1 and (tx*8 + 4 - b[1])^2 + (ty*8 + 4 - b[2])^2 < 14*14 then mset(tx, ty, 6) end
      end
    end
  end
  Y(0.95)
  -- trees off the road
  srand(seed)
  TREES = {}
  local tries = 0
  while #TREES < 110 and tries < 3000 do
    tries = tries + 1
    local x, y = rnd(16, 2032), rnd(16, 1008)
    local nearest = 1e9
    for i = 1, NWP, 2 do
      local w = WP[i]
      local d = (w.x - x)^2 + (w.y - y)^2
      if d < nearest then nearest = d end
    end
    if nearest > 78*78 and nearest < 400*400 then
      TREES[#TREES + 1] = {x=x, y=y, z=hget(x, y), kind=(rnd(4) == 1) and 2 or 1}
    end
  end
  CRATES = T.crates
  for _, c in ipairs(CRATES) do c.z, c.t = hget(c.x, c.y), 0 end
end

-- ------------------------------------------------------------------ karts
function new_kart(b, e, ty, p, ai)
  local s = build_stats(b, e, ty)
  local k = {body=b, eng=e, tyre=ty, paint=p, ai=ai, st=s,
    name=PAINTS[p].name .. " " .. BODIES[b].name,
    x=0, y=0, z=0, vz=0, air=false, fly=false, a=0, vx=0, vy=0, fwd=0, drift=0, charge=0, boost=0, steer_vis=0,
    steer=0, shold=0, sdir=0, stage=0, spin=0, shield=0, item=nil, item2=nil, roll=0, roll2=0, item_t=0, oil=0, gold=0,
    lap=0, wp=1, half=true, done=false, time=0, best=nil, lapt=0, bump=0, terr=1,
    skill=0.95, lane=0, lane_want=0}   -- the autopilot fields are used by rivals, and by your kart after the finish
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

function drift_tier(k)
  if k.drift == 0 then return 0 end
  if k.charge > 150 then return 3 elseif k.charge > 85 then return 2 elseif k.charge > 35 then return 1 end
  return 0
end

function popup(k, s, c) k.pop_s, k.pop_c, k.pop_t = s, c, 50 end
-- a kart someone plays (and, on linked Bits, the one this Bit plays: only its sounds play here)
function mine(k) return k.human and ((ME or 0) == 0 or k.pn == ME) end

function drive(k, thr, brk, steer, drift_btn)
  if k.spin > 0 then                        -- spun out: no control for a moment
    k.spin = k.spin - 1
    thr, brk, steer, drift_btn = 0, false, 0, false
    k.drift = 0
  end
  -- steering first: turning makes the kart point somewhere new, then grip decides how much
  -- of the old velocity follows (low grip = slides)
  local speed = math.sqrt(k.vx*k.vx + k.vy*k.vy)
  local dir = (k.fwd < -0.05) and -1 or 1
  local sp = clamp(speed / 1.3, 0, 1)
  local turn = steer * k.turn * sp * dir
  local grip = k.grip

  -- drift: hop into it while steering at speed, then steer to tighten or widen it
  if drift_btn and k.drift == 0 and steer ~= 0 and k.fwd > 1.4 and not k.fly then
    k.drift, k.charge, k.hop = sgn(steer), 0, 8
    if not k.ai then sfx("C4", 1, 0.3, 6, 3, 0, 400) end
  end
  if k.drift ~= 0 then
    if not drift_btn or k.fwd < 1.0 then
      local tier = drift_tier(k)
      if tier > 0 then                      -- a good drift pays out a boost
        k.boost = math.max(k.boost, ({35, 55, 80})[tier])
        if k.human then
          if mine(k) then sfx("G5", 2, 0.35, 16, 4, 0, -900) end
          popup(k, ({"BOOST!", "BIG BOOST!", "MEGA BOOST!"})[tier], ({13, 27, 5})[tier])
        end
      end
      k.drift, k.charge = 0, 0
    else
      -- +1 steering into the drift, -1 against. Full lock into it turns just a bit more than normal
      -- full steer (1.1x); steering against it opens the line up a lot (down to 0.3x)
      local into = steer * k.drift
      turn = k.drift * k.turn * (0.75 + (into > 0 and 0.35 or 0.45) * into) * sp
      k.charge = k.charge + k.driftc * (1 + 0.5 * math.max(into, 0))
      grip = grip * 0.3
    end
  end
  if k.spin > 0 then turn = 0.25 end
  if k.oil > 0 then                         -- oil: hardly any grip, and the back end wanders
    grip = grip * OIL_GRIP
    turn = turn * 1.25 + math.sin(gt * 0.11 + k.x * 0.01) * 0.012 * math.min(k.oil / 30, 1)
  end
  if k.fly then turn, grip = turn * 0.3, 0 end
  k.a = (k.a + turn) % TAU
  if k.hop and k.hop > 0 then k.hop = k.hop - 1 end

  local c, s = math.cos(k.a), math.sin(k.a)
  local fwd = k.vx*c + k.vy*s
  local lat = -k.vx*s + k.vy*c

  -- terrain
  local terr = terrain(k.x, k.y)
  k.terr = terr
  local top = k.top
  if not k.fly then
    if k.gold > 0 and (terr == 3 or terr == 2) then  -- golden tires: grass and kerbs don't slow you
    elseif terr == 3 then top = top * k.off
    elseif terr == 2 then top = top * 0.93
    elseif terr == 4 then
      if k.boost < 40 and not k.ai then sfx("E6", 5, 0.3, 14, 4, 0, 600) end
      k.boost = math.max(k.boost, 40)
    end
  end
  if k.boost > 0 then top = math.max(top, k.top) * 1.32; k.boost = k.boost - 1 end

  -- engine and brakes (nothing to push against in the air)
  if not k.fly then
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
    -- hills: uphill slows you, downhill speeds you up
    local slope = (hget(k.x + c*6, k.y + s*6) - hget(k.x - c*6, k.y - s*6)) / 12
    if k.gold <= 0 or slope < 0 then fwd = fwd - slope * 0.06 end   -- golden tires: no slowing uphill
  end
  if k.spin > 0 then fwd = fwd * 0.95 end

  -- grip: kill sideways speed (less while drifting, which also slides outward)
  lat = lat * (1 - grip)
  if k.drift ~= 0 then lat = lat - k.drift * 0.05 * clamp(fwd / k.top, 0, 1) end

  k.fwd = fwd
  k.vx, k.vy = c*fwd - s*lat, s*fwd + c*lat
  k.x = clamp(k.x + k.vx, 6, 2042)
  k.y = clamp(k.y + k.vy, 6, 1018)

  -- height: follow the ground, and leave it when it drops away faster than you fall (crests = jumps)
  local g = hget(k.x, k.y)
  if k.air then
    k.vz = k.vz - 0.2
    k.z = k.z + k.vz
    if k.z <= g then
      k.air, k.z = false, g
      if k.vz < -2 and k.human then k.shake = 4; if mine(k) then sfx("C2", 3, 0.4, 6, 6) end end
      k.vz = 0
    end
  else
    local vz = g - k.z
    if k.vz > 0.2 and vz < k.vz - 0.25 and k.fwd > 2 then      -- was climbing and the ground falls away: jump
      k.air, k.vz = true, k.vz - 0.2
      k.z = k.z + k.vz
    else
      k.z, k.vz = g, vz
    end
  end
  k.fly = k.air and k.z - g > 1.5          -- properly off the ground (not just a tiny hop)
  k.steer_vis = k.steer_vis + (steer - k.steer_vis) * 0.25
end

-- staged steering: how long you've held a direction picks the stage, and the actual steering
-- glides toward it, so a tap nudges, a hold turns, a long hold turns hard
function player_steer(k)
  local d = (btn("right", k.pn) and 1 or 0) - (btn("left", k.pn) and 1 or 0)
  if d ~= 0 and d == k.sdir then k.shold = k.shold + 1 else k.shold = 0 end
  k.sdir = d
  local target = 0
  k.stage = 0
  if d ~= 0 then
    for i, st in ipairs(STEER) do if k.shold >= st[2] then k.stage = i; target = d * st[1] end end
  end
  local rate = target == 0 and 0.15 or 0.07
  k.steer = k.steer + clamp(target - k.steer, -rate, rate)
  return k.steer
end

-- rivals follow the waypoints with their own lane and a little rubber band
function ai_input(k)
  local look = k.wp + 3 + math.floor(k.fwd * 1.4)
  local p = WP[(look - 1) % NWP + 1]
  local ln = k.lane * (p.w or ROADW) / 44             -- lanes spread with the road width
  local tx, ty = p.x + p.nx * ln, p.y + p.ny * ln
  local d = angdiff(math.atan(ty - k.y, tx - k.x), k.a)
  local steer = clamp(d * 3.5, -1, 1)
  local thr = k.skill
  local lead = 0                     -- rubber band against the player in front
  for _, h in ipairs(humans) do lead = math.max(lead, progress(h)) end
  local gap = lead - progress(k)
  if gap > NWP * 0.15 then thr = thr * 1.08 elseif gap < -NWP * 0.12 then thr = thr * 0.9 end
  if math.abs(d) > 0.7 then thr = thr * 0.6 end
  k.lane = k.lane + (k.lane_want - k.lane) * 0.02
  if rnd(240) == 1 then k.lane_want = rnd(-22, 22) end
  -- rivals use their items when it makes sense, after a short think
  if k.item and k.roll <= 0 then
    k.item_t = k.item_t + 1
    if k.item_t > 40 and rnd(30) == 1 then use_item(k) end
  end
  return clamp(thr, 0, 1.08), false, steer, false
end

-- Rumble rivals: grab a crate when empty-handed, otherwise chase the nearest kart and fire at it
function arena_ai(k)
  local tx, ty, target
  local best = 1e12
  for _, o in ipairs(karts) do
    if o ~= k and not o.ko then
      local d = (o.x - k.x)^2 + (o.y - k.y)^2
      if d < best then best, target = d, o end
    end
  end
  if not k.item then
    local bc = 1e12
    for _, c in ipairs(CRATES) do
      local d = (c.x - k.x)^2 + (c.y - k.y)^2
      if c.t <= 0 and d < bc then bc, tx, ty = d, c.x, c.y end
    end
  end
  if not tx and target then tx, ty = target.x, target.y end
  if not tx then local w = WP[k.wp % NWP + 1]; tx, ty = w.x, w.y end
  -- keep off the banks: steer for the middle when the edge is close ahead
  local c, s = math.cos(k.a), math.sin(k.a)
  if arena_d(ARENA, k.x + c * 50, k.y + s * 50) > -40 then tx, ty = ACX + (k.x - ACX) * 0.3, ACY + (k.y - ACY) * 0.3 end
  local d = angdiff(math.atan(ty - k.y, tx - k.x), k.a)
  local steer = clamp(d * 3, -1, 1)
  local thr = k.skill * (math.abs(d) > 1.6 and 0.6 or 1)
  if k.item and k.roll <= 0 and target then
    k.item_t = k.item_t + 1
    local ta = angdiff(math.atan(target.y - k.y, target.x - k.x), k.a)
    local i = k.item
    if k.item_t > 30 and ((i == 3 and math.abs(ta) < 0.15 and best < 220*220) or ((i == 4 or i == 6) and best < 300*300)
      or (i == 2 and math.abs(ta) > 2.6 and best < 90*90) or i == 1 or i == 7 or (i == 5 and k.helmets <= 2)) then use_item(k) end
  end
  return clamp(thr, 0, 1.05), false, steer, false
end

function progress(k) return k.lap * NWP + k.wp end

function track_kart(k)
  if GMODE == "rumble" then                          -- no laps in the arena: just the nearest waypoint
    local best, bi = 1e12, 1
    for i = 1, NWP do
      local w = WP[i]
      local d = (w.x - k.x)^2 + (w.y - k.y)^2
      if d < best then best, bi = d, i end
    end
    k.wp = bi
    return
  end
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
      if mine(k) then sfx("C6", 4, 0.4, 40, 5) end
    elseif mine(k) and k.lap > 1 then sfx("A5", 4, 0.3, 12, 5) end
  end
  if bi > NWP // 2 - 6 and bi < NWP // 2 + 6 then k.half = true end
  k.wp = bi
end

-- ------------------------------------------------------------------ items
function roll_item(k)
  local place = math.min(4, math.ceil((k.place or #karts) * 4 / math.max(#karts, 1)))   -- 1st .. last as 4 bands
  local total = 0
  local function w(i, it) return it.odds[place] * it.on * ((rules.pool[i] ~= false) and 1 or 0) end
  for i, it in ipairs(ITEMS) do total = total + w(i, it) end
  if total <= 0 then return nil end
  local r = rnd() * total
  for i, it in ipairs(ITEMS) do
    r = r - w(i, it)
    if r <= 0 and w(i, it) > 0 then return i end
  end
  return nil
end

function hit(k, by)
  if k.shield > 0 then
    k.shield = 0
    if mine(k) or mine(by) then sfx("E5", 4, 0.3, 10, 6) end
    return
  end
  if k.spin > 0 or k.ko then return end
  k.spin, k.hop = math.floor(SPIN_T), 8
  if GMODE == "rumble" then                           -- Rumble: every hit knocks off a helmet
    k.helmets = k.helmets - 1
    parts[#parts + 1] = {x = k.x, y = k.y, z = k.z + 14, vx = (rnd() - 0.5) * 2, vy = (rnd() - 0.5) * 2, vz = 2.5, life = 40, col = PAINTS[k.paint][1][2], helmet = true}
    if k.helmets <= 0 then
      k.ko, k.ko_t, k.item, k.item2 = true, race_t, nil, nil
      if k.human then popup(k, "KO!", 25) end
      if mine(k) or mine(by) then sfx("C2", 2, 0.5, 30, 6, 0, -300) end
    elseif k.human then popup(k, k.helmets .. (k.helmets == 1 and " HELMET LEFT" or " HELMETS LEFT"), 27) end
  end
  if mine(k) or mine(by) then sfx("A2", 2, 0.5, 20, 6, 0, -200) end
  if k.human then k.shake = 8 end
end

function use_item(k, back)                             -- back: fire it behind you (hold down)
  local i = k.item
  if not i or k.roll > 0 then return end
  k.item, k.item_t = k.item2, 0                         -- the second item moves up
  k.roll, k.item2, k.roll2 = k.roll2, nil, 0
  local c, s = math.cos(k.a), math.sin(k.a)
  if i == 1 then                                       -- Nitro
    k.boost = math.max(k.boost, math.floor(NITRO_T))
    if mine(k) then sfx("G5", 2, 0.4, 20, 4, 0, -900) end
    if k.human then popup(k, "NITRO!", 10) end
  elseif i == 2 then                                   -- Oil Slick, behind you
    hazards[#hazards + 1] = {kind = "oil", x = k.x - c*16, y = k.y - s*16, life = 1800, owner = k}
    if mine(k) then sfx("C3", 3, 0.3, 8) end
  elseif i == 3 then                                   -- Bolt, straight ahead (or straight back)
    local f = back and -1 or 1
    shots[#shots + 1] = {kind = "bolt", x = k.x + c*12*f, y = k.y + s*12*f, vx = c*BOLT_V*f + k.vx*0.5, vy = s*BOLT_V*f + k.vy*0.5, life = math.floor(660 / BOLT_V), owner = k}
    if mine(k) then sfx("E5", 0, 0.3, 6, 4, 0, 800) end
  elseif i == 4 then                                   -- Drone, after the kart in front (or behind)
    local target, f = nil, back and -1 or 1
    for _, o in ipairs(karts) do if o.place == (k.place or 1) - f then target = o end end
    shots[#shots + 1] = {kind = "drone", x = k.x, y = k.y, vx = c*DRONE_V*f, vy = s*DRONE_V*f, life = 600, owner = k, target = target}
    if mine(k) then sfx("B4", 5, 0.3, 14, 4, 0, 300) end
  elseif i == 5 then                                   -- Shield
    k.shield = math.floor(SHIELD_T)
    if mine(k) then sfx("C5", 4, 0.3, 14, 4, 0, 400) end
  elseif i == 6 then                                   -- Tire: rolls along the road and homes in on karts
    local f = back and -1 or 1
    shots[#shots + 1] = {kind = "tire", x = k.x + c*12*f, y = k.y + s*12*f, vx = c*TIRE_V*f + k.vx*0.3, vy = s*TIRE_V*f + k.vy*0.3,
      life = math.floor(TIRE_T), owner = k, wp = k.wp, dir = f, bounce = 0}
    if mine(k) then sfx("D3", 1, 0.35, 10, 4, 0, 200) end
  elseif i == 7 then                                   -- Golden Tires: no slowing down off the road or uphill
    k.gold = math.floor(GOLD_T)
    if mine(k) then sfx("C6", 4, 0.35, 24, 4, 0, -300) end
    if k.human then popup(k, "GOLDEN TIRES!", 27) end
  end
end

-- splats of oil on a player's camera lens: where they are is decided in the game update (the same on
-- every linked Bit), they are only drawn on that player's view
function oil_lens(k)
  k.lens = {}
  for i = 1, 5 + rnd(3) do
    local side = i % 2 == 0 and 0.62 or 0.04                   -- splats near the edges, the kart stays visible
    k.lens[i] = {x = side + rnd() * 0.34, y = rnd() * 0.8 + 0.1, r = 0.018 + rnd() * 0.035, drip = rnd() * 0.12}
  end
end

function update_items()
  -- crates: drive through one to get an item (if your slot is empty); they come back after 4 s
  for _, cr in ipairs(CRATES) do
    if cr.t > 0 then cr.t = cr.t - 1
    else
      for _, k in ipairs(karts) do
        if (k.x - cr.x)^2 + (k.y - cr.y)^2 < 12*12 and not k.air then
          cr.t = math.floor(CRATE_T)
          if k.ko then
          elseif not k.item then
            k.item, k.roll, k.item_t = roll_item(k), 40, 0
            if mine(k) then sfx("C5", 5, 0.25, 4, 5) end
          elseif not k.item2 then                     -- a second slot (Y swaps the two)
            k.item2, k.roll2 = roll_item(k), 40
            if mine(k) then sfx("C5", 5, 0.25, 4, 5) end
          end
          break
        end
      end
    end
  end
  for _, k in ipairs(karts) do
    if k.roll > 0 then
      k.roll = k.roll - 1
      if mine(k) and k.roll % 5 == 0 and k.roll > 0 then sfx("A5", 5, 0.12, 2, 5) end
    end
    if k.roll2 > 0 then k.roll2 = k.roll2 - 1 end
    if k.shield > 0 then k.shield = k.shield - 1 end
    if k.oil > 0 then k.oil = k.oil - 1 end
    if k.gold > 0 then k.gold = k.gold - 1 end
  end
  -- oil slicks make whoever drives over them slide about (and splash the camera)
  for i = #hazards, 1, -1 do
    local h = hazards[i]
    h.life = h.life - 1
    for _, k in ipairs(karts) do
      if (k.x - h.x)^2 + (k.y - h.y)^2 < 11*11 and not k.air and k.oil == 0 then
        if k.shield > 0 then k.shield = 0
        else
          k.oil = math.floor(OIL_T)
          if k.human and OIL_LENS then oil_lens(k) end
          if mine(k) or mine(h.owner) then sfx("F2", 3, 0.4, 14, 6, 0, -150) end
          if k.human then k.shake = 5; popup(k, "OIL!", 30) end
        end
        h.life = 0; break
      end
    end
    if h.life <= 0 then table.remove(hazards, i) end
  end
  -- bolts fly straight, drones chase their target
  for i = #shots, 1, -1 do
    local p = shots[i]
    p.life = p.life - 1
    if p.kind == "tire" then                         -- follows the road, steers at the nearest kart ahead
      local w = WP[(p.wp + (p.dir > 0 and 2 or -2) - 1) % NWP + 1]
      local tx, ty = w.x, w.y
      local best = 160 * 160
      for _, o in ipairs(karts) do
        if o ~= p.owner and not o.done then
          local dx, dy = o.x - p.x, o.y - p.y
          local d2 = dx*dx + dy*dy
          if d2 < best and dx * p.vx + dy * p.vy > 0 then best, tx, ty = d2, o.x, o.y end
        end
      end
      local dx, dy = tx - p.x, ty - p.y
      local d = math.max(math.sqrt(dx*dx + dy*dy), 0.1)
      local h = 0.15 + TIRE_HOME * 0.6
      p.vx, p.vy = p.vx * (1 - h) + dx / d * TIRE_V * h, p.vy * (1 - h) + dy / d * TIRE_V * h
      local bw = (p.dir > 0) and 1 or -1
      for j = 0, 3 do                                -- keep its waypoint up to date
        local q = WP[(p.wp + bw * j - 1) % NWP + 1]
        if (q.x - p.x)^2 + (q.y - p.y)^2 < 30*30 then p.wp = (p.wp + bw * j - 1) % NWP + 1 end
      end
      p.bounce = (p.bounce + 1) % 20
    elseif p.kind == "drone" then
      local tx, ty
      if p.target and not p.target.done then tx, ty = p.target.x, p.target.y
      else local w = WP[(p.wp or 1) % NWP + 1]; tx, ty = w.x, w.y end
      local dx, dy = tx - p.x, ty - p.y
      local d = math.max(math.sqrt(dx*dx + dy*dy), 0.1)
      p.vx, p.vy = p.vx * 0.9 + dx / d * 0.5, p.vy * 0.9 + dy / d * 0.5
    end
    p.x, p.y = p.x + p.vx, p.y + p.vy
    if p.x < 0 or p.y < 0 or p.x > 2048 or p.y > 1024 then p.life = 0 end
    for _, k in ipairs(karts) do
      if (k ~= p.owner or p.life < 90) and (k.x - p.x)^2 + (k.y - p.y)^2 < 11*11 then
        hit(k, p.owner); p.life = 0; break
      end
    end
    if p.kind == "bolt" or p.kind == "tire" then
      for _, t in ipairs(TREES) do
        if (t.x - p.x)^2 + (t.y - p.y)^2 < 8*8 then p.life = 0; break end
      end
    end
    if p.life <= 0 then table.remove(shots, i) end
  end
end

function collide()
  -- kart vs kart: heavier karts push lighter ones
  for i = 1, #karts do
    local a = karts[i]
    for j = i + 1, #karts do
      local b = karts[j]
      local dx, dy = b.x - a.x, b.y - a.y
      local d2 = dx*dx + dy*dy
      if d2 < 13*13 and d2 > 0.01 and math.abs(a.z - b.z) < 8 and not a.ko and not b.ko then
        if GMODE == "rumble" then                   -- ram someone while boosting to knock a helmet off
          if a.boost > 0 and b.boost <= 0 then hit(b, a) elseif b.boost > 0 and a.boost <= 0 then hit(a, b) end
        end
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
          if (a.human or b.human) and a.bump <= 0 then
            if mine(a) or mine(b) then sfx("C2", 3, 0.4, 6, 6) end
            if a.human then a.shake = 6 end
            if b.human then b.shake = 6 end
          end
          a.bump, b.bump = 10, 10
        end
      end
    end
    -- trees are solid
    for _, t in ipairs(TREES) do
      local dx, dy = a.x - t.x, a.y - t.y
      if dx*dx + dy*dy < 11*11 and a.z < t.z + 20 then
        local d = math.max(math.sqrt(dx*dx + dy*dy), 0.1)
        a.x, a.y = t.x + dx / d * 11, t.y + dy / d * 11
        a.vx, a.vy = a.vx * 0.3 + dx / d * 0.8, a.vy * 0.3 + dy / d * 0.8
        if a.human and a.bump <= 0 then a.shake = 8; if mine(a) then sfx("A1", 3, 0.5, 10, 6) end end
        a.bump = 10
      end
    end
    a.bump = a.bump - 1
  end
end

-- ------------------------------------------------------------------ game flow
-- the title screen (game{title_draw = ...}): three karts race down a winding road into the sunset
function draw_title(t)
  local HOR = 112
  local bands = { 3, 4, 5, 9, 10, 11 }
  for i = 0, 5 do rectfill(0, i * 19, 320, 19, bands[i + 1]) end
  circfill(236, HOR - 12, 26, 27) circfill(236, HOR - 12, 19, 11)   -- the sun
  for k = 0, 2 do rectfill(208, HOR - 10 - k * 7, 56, 2, 10) end
  for x = 0, 319, 2 do                                        -- mountains
    local h = math.sin(x / 37 + t / 500) * 6 + math.sin(x / 13 + 1) * 3 + 11
    rectfill(x, HOR - h, 2, h, 2)
    local h2 = math.sin(x / 23 + 1 + t / 300) * 5 + 8
    rectfill(x, HOR - h2, 2, h2, 14)
  end
  local curve = math.sin(t / 200) * 46
  local function road(y)                                      -- centre and half width of the road on row y
    local dy = y - HOR + 1
    local f = 1 - dy / 128
    return 104 + curve * f * f, dy * 1.2
  end
  for y = HOR, 239 do
    local dy = y - HOR + 1
    local z = 1200 / dy
    local stripe = math.floor((z + t * 6) / 40) % 2 == 0
    local cx, hw = road(y)
    local rw = hw * 0.14
    rectfill(0, y, 320, 1, stripe and 16 or 15)
    rectfill(cx - hw - rw, y, (hw + rw) * 2, 1, stripe and 25 or 13)
    rectfill(cx - hw, y, hw * 2, 1, stripe and 30 or 28)
    if stripe and dy > 6 then rectfill(cx - hw * 0.03, y, hw * 0.06 + 1, 1, 12) end
  end
  local KARTS = {                                             -- body, paint, tyre, engine, distance, lane
    { body = 2, paint = 2, tyre = 1, eng = 2, dy = 28, lane = -0.4 },
    { body = 3, paint = 5, tyre = 3, eng = 1, dy = 52, lane = 0.45 },
    { body = 1, paint = 1, tyre = 2, eng = 3, dy = 84, lane = -0.1 },
  }
  for i, k in ipairs(KARTS) do
    local dy = k.dy + math.sin(t / 80 + i * 2) * (6 + i * 3)
    local y = HOR + dy
    local cx, hw = road(y)
    local x = cx + (k.lane + math.sin(t / 60 + i) * 0.25) * hw
    local sc = dy / 34
    local idx = (k.body - 1) * 9
    kart_pal(k)
    sspr(176 + (idx // 5) * 48 + (idx % 5) * 3, x - 12 * sc, y - 21 * sc + ((t // 3 + i) % 2), 3, 3, sc)
    pal()
    for p = 0, 2 do                                            -- dust from the back wheels
      local q = (t + p * 7 + i * 5) % 21
      circfill(x + (p - 1) * 9 * sc, y + q * sc * 0.3, (1 + q / 6) * sc, q < 10 and 29 or 28)
    end
  end
  for i = 0, 9 do                                             -- speed lines at the edges
    local y = HOR + 20 + (i * 37) % 110
    local x = (i * 61 + t * 9) % 60
    if i % 2 == 0 then line(x, y, x + 12, y + 3, 13) else line(319 - x, y, 307 - x, y + 3, 13) end
  end
end

function _init()
  TRACKS = track_list()
  -- title screen, pause menu (Start) and settings: the game shell (see GAME_RULES.md)
  game{
    title = "Kart Lab",
    title_draw = draw_title,          -- its own animated title screen (above)
    look = { title = 27, shadow = 24, panel = 1, edge = 25, hi = 25, text = 13, pick = 27, goal = 11, footer = 11, menu = "right", name_y = 10 },
    goal = "Build a kart and finish 1st on every track.",
    help = {
      "R or A: throttle (squeeze R harder to go faster). B: brake. D-pad: steer.",
      "Hold L (or B on the throttle) and steer to drift; let go for a boost.",
      "X: use your item. Hold down to look back; down + X fires backwards.",
    },
    -- Continue goes straight into a race on your last track with your saved kart
    can_continue = function() local d = saved() return (PLAYERS or 1) == 1 and type(d) == "table" and d.sel ~= nil end,
    continue = function() load_track() end,
    new_game = function() save(nil); _init() end,
    pause = {
      {"Restart", function() if mode == "count" or mode == "race" then start_race() end end},
      {"Back to garage", function() mode, gt, ready = "garage", 0, {} end},
      {"Main menu", function() mode, gt, ready = "menu", 0, {} end},
    },
    settings = {{key = "rivals", name = "Rivals", values = {"Easy", "Normal", "Hard"}, value = 2}},
  }
  sel = {track=1, body=1, eng=2, tyre=1, paint=1}
  best, wins = {}, {}
  GMODE, menu_row, set_row, ARENA_I = "race", 1, 1, 1
  rules = {laps = LAPS, rivals = KARTS - 1, skill = setting and setting("rivals") or 2, pool = {}, helmets = 3, minutes = 3}
  if saved then
    local d = saved()
    -- with friends every Bit must start the same, so your saved kart only comes back when you play alone
    if d and d.sel and (PLAYERS or 1) == 1 then for k, v in pairs(d.sel) do sel[k] = v end end
    if d and type(d.best) == "table" then best = d.best end
    if d and type(d.wins) == "table" and (PLAYERS or 1) == 1 then wins = d.wins end
    if d and type(d.rules) == "table" and (PLAYERS or 1) == 1 then
      for k, v in pairs(d.rules) do if k ~= "pool" then rules[k] = v end end
      if type(d.rules.pool) == "table" then for i, v in pairs(d.rules.pool) do rules.pool[i] = v end end
    end
  end
  if sel.track > #TRACKS then sel.track = 1 end
  -- everyone playing gets a kart in the same race (rivals fill the grid up to KARTS).
  -- Each player builds their own kart; only player 1 picks the track.
  NH = math.max(1, math.min(PLAYERS or 1, (ME or 0) > 0 and 8 or 4))   -- linked Bits: up to 8, one screen: up to 4 views
  sels, rows, ready, humans = {sel}, {1}, {}, {}
  for p = 2, NH do sels[p] = {track = 1, body = (p - 1) % #BODIES + 1, eng = 2, tyre = 1, paint = p}; rows[p] = 1 end
  row, mode, gt = 1, "menu", 0
  shake, parts, pop_t = 0, {}, 0
  TREES, CRATES, hazards, shots = {}, {}, {}, {}
  if KART_QUICK then                   -- "race it" on the Track tab: straight onto that track
    game_play()
    for i, tr in ipairs(TRACKS) do
      if tr.level == KART_QUICK then sel.track, GMODE = i, "race"; rules.laps = (tr.track and tr.track.laps) or LAPS; load_track() end
    end
  end
end

function persist()
  if save then save({sel = sel, best = best, wins = wins, rules = rules}) end
end

-- load the track's level (if it is one), then build its world a little each frame
function load_track()
  local tr = TRACKS[sel.track]
  mode, gt, load_p = "loading", 0, 0
  if GMODE == "rumble" then
    ARENA = ARENAS[ARENA_I]
    loader = coroutine.create(function() ROADW, KERBW = 44, 8; build_arena(ARENA, ARENA_I * 13) end)
    return
  end
  loader = coroutine.create(function()
    if tr.level and tr.level ~= LEVEL then
      level(tr.level)                    -- the map arrives before the next frame
      coroutine.yield(0)
      ents_update()                      -- finishes the level switch
    end
    local tk = tr.track or {}
    ROADW, KERBW, LAPS = tk.road or 44, tk.kerb or 7, rules.laps or tk.laps or 3
    local T
    if tr.track then T = spline_track(tr.track, tr.height) else T = read_track(tr.placed) end
    if not T then load_err = tr.name .. " needs 3 or more points"; return end
    build_world(T, sel.track * 7)
    local any = false
    for i = 1, #ITEMS do if rules.pool[i] ~= false and ITEMS[i].on > 0 then any = true end end
    if GMODE == "trial" or not any then CRATES = {} end    -- no items: no crates
  end)
end

function start_race()
  karts, finished, hazards, shots, parts = {}, {}, {}, {}, {}
  humans, cams = {}, {}
  srand(t() + 3)
  local used = {}
  for p = 1, NH do
    local s = sels[p]
    local k = new_kart(s.body, s.eng, s.tyre, s.paint, false)
    k.human, k.pn, k.shake, k.pop_t = true, p, 0, 0
    if NH > 1 then k.name = "P" .. p .. " " .. k.name end
    humans[p], used[s.paint] = k, true
  end
  player = humans[1]
  -- rivals, each a different random build (never a player's paint)
  local paints = {}
  for i = 1, #PAINTS do if not used[i] then paints[#paints + 1] = i end end
  local field = math.max(NH, math.min(NH + (GMODE == "trial" and 0 or rules.rivals), #PAINTS))
  local grid = {}
  for i = 1, field do grid[i] = {NWP - 1 - ((i - 1) // 2) * 3, (i % 2 == 1) and -16 or 16} end   -- two by two
  local nr = field - NH
  for i = 1, nr do
    local p = table.remove(paints, rnd(#paints))
    local k = new_kart(rnd(#BODIES), rnd(#ENGINES), rnd(#TYRES), p, true)
    k.skill, k.lane, k.lane_want = (0.9 + 0.075 * i / nr) * ({0.9, 1, 1.07})[rules.skill or 2], rnd(-14, 14), 0
    karts[#karts + 1] = k
  end
  for p = 1, NH do table.insert(karts, rnd(NH == 1 and 2 or 1, #karts + 1), humans[p]) end   -- start somewhere in the pack
  for i, k in ipairs(karts) do
    if GMODE == "rumble" then                       -- round the arena, facing the middle
      local wi = ((i - 1) * NWP // #karts) % NWP + 1
      local w = WP[wi]
      k.x, k.y, k.wp = w.x, w.y, wi
      k.a = math.atan(ACY - k.y, ACX - k.x)
      k.helmets = rules.helmets
    else
      local g = grid[i]
      local w = WP[g[1]]
      local o = g[2] * math.min(1, (w.w or ROADW) / 30)
      k.x, k.y, k.a, k.wp = w.x + w.nx * o, w.y + w.ny * o, w.a, g[1]
    end
    k.z = hget(k.x, k.y)
    k.place = i
  end
  if GMODE == "trial" then for _, h in ipairs(humans) do h.item, h.item2 = 1, 1 end end   -- two Nitros
  for p, k in ipairs(humans) do cams[p] = {a = k.a, ta = k.a, back = false, x = k.x, y = k.y, z = k.z + CAM_H} end
  cam = cams[1]
  mode, gt, race_t = "count", 0, 0
end

function _update()
  gt = gt + 1
  if mode == "menu" then menu_update()
  elseif mode == "setup" then setup_update()
  elseif mode == "garage" then garage_update()
  elseif mode == "loading" then
    if load_err then
      if btnp("a") or btnp("b") then load_err, mode, gt = nil, "setup", 0 end
      return
    end
    local ok, p = coroutine.resume(loader)
    if not ok then error(p) end
    load_p = p or load_p
    if coroutine.status(loader) == "dead" and not load_err then start_race() end
  elseif mode == "count" or mode == "race" then race_update()
  elseif mode == "results" then
    race_update()
    local any_a = false
    for p = 1, NH do if btnp("a", p) then any_a = true end end
    if gt > 60 and any_a then mode, gt = "setup", 0 end
  end
end

-- on a shared screen the players take turns in the garage; linked Bits each show their own
function garage_turn()
  for p = 1, NH do if not ready[p] then return p end end
end

function garage_player(p)
  local keys = {"body", "eng", "tyre", "paint"}
  local lists = {BODIES, ENGINES, TYRES, PAINTS}
  local s = sels[p]
  if ready[p] then
    if btnp("b", p) then ready[p] = false; sfx("E4", 0, 0.2, 3) end
    return
  end
  if btnp("up", p) then rows[p] = (rows[p] - 2) % 5 + 1; sfx("E5", 0, 0.2, 3) end
  if btnp("down", p) then rows[p] = rows[p] % 5 + 1; sfx("E5", 0, 0.2, 3) end
  local r = rows[p]
  if btnp("b", p) and p == 1 then mode, gt = "setup", 0; sfx("E4", 0, 0.2, 3); return end   -- back to the track and rules
  if r <= 4 then
    local key, n = keys[r], #lists[r]
    if btnp("left", p) then s[key] = (s[key] - 2) % n + 1; sfx("A5", 0, 0.2, 3) end
    if btnp("right", p) then s[key] = s[key] % n + 1; sfx("A5", 0, 0.2, 3) end
  end
  if btnp("a", p) and gt > 10 then ready[p] = true; sfx("C5", 4, 0.3, 10)
  elseif btnp("b", p) and p > 1 and (ME or 0) == 0 then ready[p - 1] = false end   -- back to the previous player
end

function garage_update()
  if NH == 1 or (ME or 0) == 0 then
    local p = garage_turn()
    if p then garage_player(p) end
  else
    for p = 1, NH do garage_player(p) end
  end
  for p = 2, NH do sels[p].track = sels[1].track end
  if not garage_turn() then
    ready = {}
    persist(); load_track()
  end
end

-- ------------------------------------------------------------------ main menu and rules
-- Player 1 picks the mode, the track and the rules; everyone then builds a kart in the garage.
function menu_update()
  if btnp("up", 1) then menu_row = (menu_row - 2) % #MODES + 1; sfx("E5", 0, 0.2, 3) end
  if btnp("down", 1) then menu_row = menu_row % #MODES + 1; sfx("E5", 0, 0.2, 3) end
  if btnp("a", 1) and gt > 10 then
    GMODE, mode, gt, set_row = MODES[menu_row].key, "setup", 0, 1
    sfx("C5", 4, 0.3, 10)
  end
end

-- the rows of the rules screen for the picked mode: {label, value text, change(dir)}
function setup_rows()
  local r = {}
  local function add(label, val, change, about) r[#r + 1] = {label, val, change, about} end
  local function cyc(v, lo, hi, d) return (v - lo + d) % (hi - lo + 1) + lo end
  if GMODE == "rumble" then
    add("Arena", ARENAS[ARENA_I].name, function(d) ARENA_I = cyc(ARENA_I, 1, #ARENAS, d) end)
    add("Helmets", tostring(rules.helmets), function(d) rules.helmets = cyc(rules.helmets, 1, 5, d) end, "Hits each kart can take.")
    add("Time limit", rules.minutes > 0 and (rules.minutes .. " min") or "none", function(d) rules.minutes = cyc(rules.minutes, 0, 5, d) end)
  else
    local tr = TRACKS[sel.track]
    add("Track", tr.name, function(d)
      sel.track = cyc(sel.track, 1, #TRACKS, d)
      rules.laps = (TRACKS[sel.track].track and TRACKS[sel.track].track.laps) or rules.laps
    end, best[tr.name] and ("Best time " .. tstr(best[tr.name]) .. (wins[tr.name] and "  (won)" or "")) or "No time set yet.")
    add("Laps", tostring(rules.laps), function(d) rules.laps = cyc(rules.laps, 1, 9, d) end)
  end
  if GMODE ~= "trial" then
    add("Rivals", tostring(rules.rivals), function(d) rules.rivals = cyc(rules.rivals, 0, #PAINTS - NH, d) end)
    add("Rival skill", ({"Easy", "Normal", "Hard"})[rules.skill], function(d) rules.skill = cyc(rules.skill, 1, 3, d) end)
    for i, it in ipairs(ITEMS) do
      add(it.name, rules.pool[i] == false and "off" or "on", function() rules.pool[i] = rules.pool[i] == false end,
        it.on <= 0 and "Turned off on the Game tab." or "Item pool: left/right turns it on or off.")
    end
  end
  return r
end

function setup_update()
  local rows_ = setup_rows()
  local n = #rows_ + 1                               -- the last row is "Next"
  if btnp("up", 1) then set_row = (set_row - 2) % n + 1; sfx("E5", 0, 0.2, 3) end
  if btnp("down", 1) then set_row = set_row % n + 1; sfx("E5", 0, 0.2, 3) end
  if set_row > n then set_row = n end
  local r = rows_[set_row]
  if r then
    if btnp("left", 1) then r[3](-1); sfx("A5", 0, 0.2, 3) end
    if btnp("right", 1) then r[3](1); sfx("A5", 0, 0.2, 3) end
  end
  if btnp("b", 1) then mode, gt = "menu", 0; sfx("E4", 0, 0.2, 3) return end
  if btnp("a", 1) and gt > 10 and (set_row == n or not r) then
    for p = 2, NH do sels[p].track = sel.track end
    mode, gt, ready = "garage", 0, {}
    sfx("C5", 4, 0.3, 10)
  elseif btnp("a", 1) and gt > 10 then set_row = n end
end

function race_update()
  if mode == "count" then
    if gt % 60 == 0 and gt < 180 then sfx("C5", 0, 0.4, 14) end
    if gt == 180 then sfx("C6", 0, 0.5, 30); mode, gt = "race", 0 end
  else
    race_t = race_t + 1
  end
  local racing = mode ~= "count"
  standings()
  for _, k in ipairs(karts) do
    local thr, brk, steer, drift
    if k.ko then thr, brk, steer, drift = 0, true, 0, false      -- knocked out: rolls to a stop
    elseif k.done or not racing then
      if k.done then thr, brk, steer, drift = ai_input(k); thr = thr * 0.7
      else thr, brk, steer, drift = 0, false, 0, false end
    elseif k.ai then
      if GMODE == "rumble" then thr, brk, steer, drift = arena_ai(k) else thr, brk, steer, drift = ai_input(k) end
    else
      local pn = k.pn or 1
      thr = math.max(press("r", pn) / 255, btn("a", pn) and 1 or 0)
      local bdrift = btn("b", pn) and thr > 0.5           -- B while on the throttle drifts instead of braking
      brk = btn("b", pn) and not bdrift
      steer = player_steer(k)
      drift = btn("l", pn) or press("l", pn) > 100 or bdrift
      if btnp("x", pn) then use_item(k, btn("down", pn)) end
      if btnp("y", pn) and k.item2 and k.roll <= 0 and k.roll2 <= 0 then   -- Y swaps the two items
        k.item, k.item2 = k.item2, k.item
        if mine(k) then sfx("E5", 5, 0.15, 3, 5) end
      end
    end
    drive(k, thr, brk, steer, drift)
    if GMODE == "rumble" then arena_wall(k) end
    track_kart(k)
  end
  collide()
  if GMODE == "rumble" then for _, k in ipairs(karts) do arena_wall(k) end end   -- bumps can't push anyone through
  if racing then update_items() end
  -- the race ends once every player has crossed the line (finished players' karts drive themselves).
  -- A Rumble ends when one kart is left, every player is out, or the time runs out.
  local all_done = true
  for _, h in ipairs(humans) do if not h.done then all_done = false end end
  if GMODE == "rumble" then
    local alive, hl = 0, 0
    for _, k in ipairs(karts) do if not k.ko then alive = alive + 1; if k.human then hl = hl + 1 end end end
    all_done = alive <= 1 or hl == 0 or (rules.minutes > 0 and race_t >= rules.minutes * 3600)
  end
  if racing and all_done and mode ~= "results" then
    mode, gt = "results", 0
    local key = TRACKS[sel.track].name
    new_best = false
    if GMODE == "rumble" then key = "Rumble: " .. ARENA.name end
    for _, h in ipairs(humans) do
      if GMODE ~= "rumble" and h.done and (not best[key] or h.time < best[key]) then best[key] = h.time; new_best = true end
      if h.place == 1 then wins[key] = true end
    end
    persist()
    local won_all = true
    for _, tr in ipairs(TRACKS) do if not wins[tr.name] then won_all = false end end
    if GMODE ~= "race" then won_all = false end
    if won_all and not GAME.won then
      game_win("You won on every track! Try a harder Rivals setting, or build your own track on the Track tab.")
    end
  end
  track(player.x, player.y)        -- the Map tab shows your racing line
  -- each player's camera swings behind their kart, lagging a little in turns and more in drifts.
  -- Holding down looks back: the camera jumps in front of the kart, facing backwards.
  for p, k in ipairs(humans) do
    local c = cams[p]
    local lag = k.drift ~= 0 and 0.07 or 0.13
    c.ta = (c.ta + angdiff(k.a, c.ta) * lag) % TAU
    c.back = mode == "race" and not k.done and btn("down", p)
    c.a = c.back and (c.ta + math.pi) % TAU or c.ta
    local d = c.back and CAM_D or CAM_D + k.fwd * 2
    c.x, c.y = k.x - math.cos(c.a) * d, k.y - math.sin(c.a) * d
    local cz = math.max(k.z, hget(c.x, c.y) + 4) + CAM_H
    c.z = c.z + (cz - c.z) * 0.2
    if k.shake > 0 then k.shake = k.shake - 1 end
    if k.pop_t > 0 then k.pop_t = k.pop_t - 1 end
  end
  -- engine note follows your speed
  if gt % 4 == 0 then
    local ek = humans[ME or 0] or humans[1]
    local e = ENGINES[ek.eng]
    tone((55 + math.abs(ek.fwd) * 38) * e.pitch, 2, 0.10, 6, 0)
  end
  -- drift sparks and boost flames
  for _, k in ipairs(karts) do
    local tier = drift_tier(k)
    if (tier > 0 or k.boost > 0) and gt % 2 == 0 then
      local c, s = math.cos(k.a), math.sin(k.a)
      for side = -1, 1, 2 do
        parts[#parts + 1] = {x = k.x - c*7 - s*side*5, y = k.y - s*7 + c*side*5, z = k.z + 1 + rnd() * 2,
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
end

-- ------------------------------------------------------------------ drawing
-- The screen area a player's view is drawn in: the whole screen, or a half or quarter of it when
-- several players share one screen. VHOR is the horizon row and VFOC the zoom for that view.
function set_view(v)
  VX, VY, VW, VH = v.x, v.y, v.w, v.h
  if VH >= 200 then VHOR, VFOC = VY + HORIZON, FOCAL
  else VHOR, VFOC = VY + math.floor(HORIZON * VH / 240), FOCAL * VH / 240 end   -- the full view, scaled down
end
set_view({x = 0, y = 0, w = 320, h = 240})

function views()
  local n = #humans
  if (ME or 0) > 0 and humans[ME] then n = 1 end                     -- linked Bits: just your own view
  local me = ((ME or 0) > 0 and humans[ME]) and ME or 1
  if n <= 1 then return {{x = 0, y = 0, w = 320, h = 240, p = me}} end
  if n == 2 then return {{x = 0, y = 0, w = 320, h = 120, p = 1}, {x = 0, y = 120, w = 320, h = 120, p = 2}} end
  local v = {}
  for p = 1, n do v[p] = {x = ((p - 1) % 2) * 160, y = ((p - 1) // 2) * 120, w = 160, h = 120, p = p} end
  return v
end

local function mountains(off, amp, base, col, seed)
  -- one silhouette layer; 360 degrees of turning = TAU * VFOC pixels, so it lines up with the floor
  local per = TAU * VFOC
  for x = VX, VX + VW - 1, 2 do
    local u = (x - VX + off) % per / per * TAU
    local h = math.sin(u * 3 + seed) * 0.5 + math.sin(u * 7 + seed * 2) * 0.3 + math.sin(u * 13 + seed) * 0.2
    local top = math.floor(VHOR - base - h * amp)
    rectfill(x, top, 2, VHOR - top + 1, col)
  end
end

function draw_sky(a)
  local bands = {21, 21, 22, 22, 23}
  local hh = VHOR - VY
  for i = 0, 4 do rectfill(VX, VY + i * hh // 5, VW, hh // 5 + 1, bands[i + 1]) end
  local off, sc = a * VFOC, VFOC / FOCAL
  for i = 0, 5 do        -- clouds drift slowly
    local cx = VX + ((i * 211 - off * 0.5 + gt * 0.05) % 640 - 120) * sc
    local cy = VY + (14 + (i * 37) % 30) * hh / HORIZON
    circfill(cx, cy, 9 * sc, 13); circfill(cx + 10 * sc, cy + 2 * sc, 7 * sc, 13); circfill(cx - 10 * sc, cy + 3 * sc, 6 * sc, 13)
  end
  mountains(off * 0.6, 14 * sc, 18 * sc, 20, 1)
  mountains(off, 8 * sc, 6 * sc, 14, 4)
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
  if k.gold and k.gold > 0 and (k.gold > 60 or gt % 6 < 3) then r = (gt // 3) % 2 == 0 and {9, 27, 11} or {27, 11, 13} end   -- golden tires
  pal(3, r[1]); pal(4, r[2]); pal(5, r[3])
  local e = ENGINES[k.eng].pipe
  pal(6, e[1]); pal(7, e[2]); pal(8, e[3])
end

local function ellipse(x, y, w, c)
  local h = math.max(1, w * 0.22)
  for j = -h, h do
    local f = 1 - (j / (h + 0.5))^2
    local hw = w * math.sqrt(math.max(f, 0))
    rectfill(x - hw, y + j, hw * 2, 1, c)
  end
end

function draw_world()
  local sx = (player.shake or 0) > 0 and (gt * 7) % 5 - 2 or 0   -- not rnd(): drawing must not change the game
  draw_sky(cam.a)
  -- the track with its hills: one call draws the whole floor
  floorh(cam.x, cam.y, cam.a, cam.z, VHOR, VFOC, 15, STEP)

  local list = {}
  local function add(x, y, z, kind, obj)
    local px, py, sc, dist = project(x, y, z)
    if px and sc > 0.03 * VFOC / FOCAL and px > VX - 80 and px < VX + VW + 80 then
      list[#list + 1] = {px=px, py=py, sc=sc, dist=dist, kind=kind, o=obj}
    end
  end
  for _, t in ipairs(TREES) do add(t.x, t.y, t.z, t.kind) end
  for _, c in ipairs(CRATES) do if c.t <= 0 then add(c.x, c.y, c.z, 3, c) end end
  for _, k in ipairs(karts) do add(k.x, k.y, k.z, 4, k) end
  for _, p in ipairs(parts) do add(p.x, p.y, p.z, 5, p) end
  for _, h in ipairs(hazards) do add(h.x, h.y, hget(h.x, h.y), 7, h) end
  for _, p in ipairs(shots) do add(p.x, p.y, hget(p.x, p.y) + (p.kind == "drone" and 10 or 4), 8, p) end
  -- start gantry posts (not in a Rumble arena)
  if GMODE ~= "rumble" then
    local w = WP[1]
    local gw = (w.w or ROADW) + 6
    local gx1, gy1, gx2, gy2 = w.x + w.nx * gw, w.y + w.ny * gw, w.x - w.nx * gw, w.y - w.ny * gw
    add(gx1, gy1, hget(gx1, gy1), 6)
    add(gx2, gy2, hget(gx2, gy2), 6)
  end
  table.sort(list, function(a, b) return a.sc < b.sc end)   -- far first

  camera(-sx, 0)
  for _, d in ipairs(list) do
    local s = d.sc * SPR_K
    depth(d.dist)                -- hide what's behind a hill
    if d.kind == 1 then          -- pine, 16x24
      sspr(464, d.px - 8 * s * 2, d.py - 23 * s * 2, 2, 3, s * 2)
    elseif d.kind == 2 then      -- round tree, 16x24
      sspr(466, d.px - 8 * s * 2, d.py - 23 * s * 2, 2, 3, s * 2)
    elseif d.kind == 3 then      -- item crate, bobbing
      local b = math.sin((gt + d.o.x) * 0.08) * 2
      sspr(479, d.px - 8 * s, d.py - (17 + b) * s, 1, 1, s * 2)
    elseif d.kind == 6 then      -- gantry post
      local h = 46 * d.sc
      rectfill(d.px - d.sc * 1.5, d.py - h, math.max(1, d.sc * 3), h, 29)
      d.top = d.py - h
    elseif d.kind == 5 then      -- spark
      circfill(d.px, d.py, math.max(0, d.sc * 0.8), d.o.col)
    elseif d.kind == 7 then      -- oil slick
      ellipse(d.px, d.py, 9 * d.sc, 1)
      ellipse(d.px - d.sc * 2, d.py - 1, 3 * d.sc, 30)
    elseif d.kind == 8 then      -- bolt or drone
      if d.o.kind == "drone" then
        sspr(495, d.px - 4 * s * 1.5, d.py - 4 * s * 1.5, 1, 1, s * 1.5)
      elseif d.o.kind == "tire" then
        local b = math.abs(math.sin(d.o.bounce / 20 * math.pi)) * 5
        ellipse(d.px, d.py, 6 * s, 31)
        sspr(422, d.px - 8 * s * 0.9, d.py - (16 + b) * s * 0.9, 2, 2, s * 0.9, (gt // 4) % 2 == 0)
      else
        circfill(d.px, d.py, math.max(1, d.sc * 2), gt % 4 < 2 and 13 or 29)
      end
    else                         -- kart
      local k = d.o
      local rel = angdiff(k.a, cam.a) + (k.drift ~= 0 and k.drift * 0.5 or 0) + k.steer_vis * 0.12
      if k.spin > 0 then rel = rel + k.spin * 0.5 end
      local n, flip = kart_frame(k, rel)
      local hop = (k.hop or 0) > 0 and math.sin((8 - k.hop) / 8 * math.pi) * 3 or 0
      local bob = (k.terr == 3 or k.terr == 2) and not k.air and (gt % 4 < 2 and 0.6 or 0) or 0
      local gz = hget(k.x, k.y)
      local _, shy = project(k.x, k.y, gz)
      if shy then ellipse(d.px, shy, 10 * s, 31) end
      kart_pal(k)
      sspr(n, d.px - 12 * s, d.py - (19 + hop + bob) * s, 3, 3, s, flip)
      pal()
      if k.shield > 0 and (k.shield > 60 or gt % 4 < 2) then circ(d.px, d.py - 8 * s, 15 * s, 22) end
      if k.boost > 0 then circfill(d.px, d.py - 4 * s, 2.5 * s, gt % 4 < 2 and 10 or 27) end
      if GMODE == "rumble" then
        if k.ko then                                -- knocked out: smoke and a KO tag
          for j = 0, 2 do circfill(d.px + math.sin(gt * 0.05 + j * 2) * 4 * s, d.py - (22 + ((gt + j * 20) % 60) * 0.4) * s, (3 + j) * s, 30) end
          if d.sc > 0.25 then shadow_text("KO", d.px - 8, d.py - 34 * s - 8, 25) end
        elseif k ~= player or cam.back then         -- the helmets still on: little domes in its paint
          local n, c = k.helmets or 0, PAINTS[k.paint][1]
          for j = 1, n do
            local hx, hy = d.px + (j - (n + 1) / 2) * 7 * s, d.py - 30 * s
            circfill(hx, hy, 3 * s, c[2]); rectfill(hx - 3 * s, hy, 6 * s, 1.5 * s, c[1])
            if s > 0.4 then pset(hx - s, hy - s, 13) end
          end
        end
      end
    end
  end
  depth()
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

function place_str(n) return n .. ({"st", "nd", "rd", "th"})[math.min(n, 4)] end
function tstr(f)
  local s = f / 60
  return string.format("%d:%05.2f", math.floor(s / 60), s % 60)
end

function standings()
  local order = {}
  for _, k in ipairs(karts) do order[#order + 1] = k end
  table.sort(order, function(a, b)
    if GMODE == "rumble" then
      if a.ko ~= b.ko then return b.ko end
      if a.ko then return a.ko_t > b.ko_t end
      if a.helmets ~= b.helmets then return a.helmets > b.helmets end
      return (a.pn or 99) < (b.pn or 99)
    end
    if a.done and b.done then return a.time < b.time end
    if a.done ~= b.done then return a.done end
    return progress(a) > progress(b)
  end)
  for i, k in ipairs(order) do k.place = i end
  return order
end

function shadow_text(s, x, y, c, sc)
  text(s, x + 1, y + 1, 1, sc); text(s, x, y, c, sc)
end

-- oil on the camera lens: dark blobs that run down and fade as the oil wears off
function draw_lens(k)
  if not k.lens or k.oil <= 0 then return end
  local f = math.min(1, k.oil / 45)
  shade(0.18 * f)                                               -- a grimy film over the whole lens
  for _, b in ipairs(k.lens) do
    local r = b.r * VW * (0.4 + 0.6 * f)
    local x, y = VX + b.x * VW, VY + (b.y + b.drip * (1 - f)) * VH
    circfill(x, y, r, 1)
    circfill(x + r * 0.15, y + r * 0.6, r * 0.55, 1)
    rectfill(x - r * 0.15, y, math.max(1, r * 0.3), r * (0.8 + b.drip * 8), 1)
    circfill(x - r * 0.35, y - r * 0.35, math.max(1, r * 0.18), 30)
  end
end

function rumble_hud(x, y)
  local c = PAINTS[player.paint][1]
  for j = 1, rules.helmets do                       -- your helmets: filled while you still have them
    local hx = x + (j - 1) * 12 + 5
    if j <= (player.helmets or 0) then circfill(hx, y + 4, 4, c[2]); rectfill(hx - 4, y + 4, 9, 2, c[1]); pset(hx - 1, y + 2, 13)
    else circ(hx, y + 4, 4, 30) end
  end
  local alive = 0
  for _, k in ipairs(karts) do if not k.ko then alive = alive + 1 end end
  local left = rules.minutes > 0 and math.max(0, rules.minutes * 3600 - race_t) or race_t
  shadow_text(alive .. " left " .. tstr(left):sub(1, -4), x, y + 12, 12)
  if player.ko then shadow_text("KO!", VW // 2 - 24, VH // 2 - 30, 25, VH >= 200 and 4 or 2) end
end

function draw_hud()
  local order = standings()
  if VH < 200 then draw_hud_small(); return order end
  camera(-VX, -VY)
  -- place
  shadow_text(place_str(player.place), 8, 8, ({27, 29, 10})[player.place] or 13, 3)
  -- lap and time (Rumble: your helmets, karts left and the clock)
  if GMODE == "rumble" then
    rumble_hud(212, 8)
  else
    local lap = clamp(player.lap, 1, LAPS)
    shadow_text("LAP " .. lap .. "/" .. LAPS, 240, 8, 13)
    shadow_text(tstr(player.done and player.time or race_t), 240, 18, 12)
  end
  if cam.back then shadow_text("REAR VIEW", 136, 44, 13) end
  -- item slot
  rectfill(144, 6, 32, 30, 1); rect(144, 6, 32, 30, player.item and 13 or 30)
  if player.item then
    local icon = player.roll > 0 and ITEMS[(gt // 4) % #ITEMS + 1].icon or ITEMS[player.item].icon
    sspr(icon, 148, 9, 2, 2, 1.5)
    if player.roll <= 0 then text("X", 172, 28, 29) end
  end
  rectfill(179, 10, 22, 22, 1); rect(179, 10, 22, 22, player.item2 and 29 or 30)     -- second item (Y swaps)
  if player.item2 then
    local icon = player.roll2 > 0 and ITEMS[(gt // 4 + 3) % #ITEMS + 1].icon or ITEMS[player.item2].icon
    sspr(icon, 182, 13, 2, 2, 1)
    if player.roll2 <= 0 and player.roll <= 0 then text("Y", 196, 26, 29) end
  end
  -- speed, steering stage and drift charge
  local spd = clamp(player.fwd / (player.top * 1.32), 0, 1)
  rectfill(8, 222, 84, 10, 1)
  rectfill(10, 224, 80 * spd, 6, player.boost > 0 and 10 or 21)
  text(math.floor(math.abs(player.fwd) * 36) .. " km/h", 98, 223, 13)
  for i = 1, 3 do rectfill(8 + (i - 1) * 9, 202, 7, 4, i <= player.stage and ({17, 27, 25})[i] or 30) end
  local tier = drift_tier(player)
  if player.drift ~= 0 then
    rectfill(8, 212, 84, 6, 1)
    rectfill(9, 213, math.min(player.charge / 150, 1) * 82, 4, ({28, 13, 27, 5})[tier + 1])
  end
  if player.pop_t > 0 then
    local w = #player.pop_s * 16
    shadow_text(player.pop_s, 160 - w // 2, 150 - (50 - player.pop_t) // 3, player.pop_c, 2)
  end
  if player.done and mode == "race" then shadow_text("FINISHED " .. place_str(player.place), 80, 100, 27, 2) end
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
  camera()
  return order
end

-- the HUD for a half or quarter of the screen (several players on one screen)
function draw_hud_small()
  camera(-VX, -VY)
  local W, H = VW, VH
  shadow_text(place_str(player.place), 4, 4, ({27, 29, 10})[player.place] or 13, 2)
  if GMODE == "rumble" then rumble_hud(W - 60, 4)
  else
    local lap = clamp(player.lap, 1, LAPS)
    shadow_text("LAP " .. lap .. "/" .. LAPS, W - 52, 4, 13)
    shadow_text(tstr(player.done and player.time or race_t), W - 52, 13, 12)
  end
  if NH > 1 and (ME or 0) == 0 then shadow_text("P" .. player.pn, W - 18, H - 12, 13) end
  rectfill(W // 2 - 11, 3, 22, 22, 1); rect(W // 2 - 11, 3, 22, 22, player.item and 13 or 30)
  if player.item then
    local icon = player.roll > 0 and ITEMS[(gt // 4) % #ITEMS + 1].icon or ITEMS[player.item].icon
    sspr(icon, W // 2 - 8, 6, 2, 2, 1)
  end
  rectfill(W // 2 + 13, 5, 14, 14, 1); rect(W // 2 + 13, 5, 14, 14, player.item2 and 29 or 30)
  if player.item2 then
    local icon = player.roll2 > 0 and ITEMS[(gt // 4 + 3) % #ITEMS + 1].icon or ITEMS[player.item2].icon
    sspr(icon, W // 2 + 15, 7, 2, 2, 0.6)
  end
  if cam.back then shadow_text("REAR VIEW", W // 2 - 18, 28, 13) end
  local spd = clamp(player.fwd / (player.top * 1.32), 0, 1)
  rectfill(4, H - 10, 52, 6, 1)
  rectfill(5, H - 9, 50 * spd, 4, player.boost > 0 and 10 or 21)
  for i = 1, 3 do rectfill(4 + (i - 1) * 7, H - 16, 5, 3, i <= player.stage and ({17, 27, 25})[i] or 30) end
  if player.drift ~= 0 then
    rectfill(4, H - 22, 52, 4, 1)
    rectfill(5, H - 21, math.min(player.charge / 150, 1) * 50, 2, ({28, 13, 27, 5})[drift_tier(player) + 1])
  end
  if player.pop_t > 0 then
    shadow_text(player.pop_s, W // 2 - #player.pop_s * 4, H // 2 + 10 - (50 - player.pop_t) // 4, player.pop_c)
  end
  if player.done and mode == "race" then shadow_text("FINISHED " .. place_str(player.place), W // 2 - 40, H // 2 - 10, 27) end
  camera()
end

function _draw()
  if mode == "menu" then draw_menu() return end
  if mode == "setup" then draw_setup() return end
  if mode == "garage" then draw_garage() return end
  if mode == "loading" then
    cls(1)
    if load_err then
      text("Can't build this track:", 20, 100, 25)
      text(load_err, 20, 114, 13)
      text("A: back", 20, 140, 29)
      return
    end
    text("Building " .. (GMODE == "rumble" and ARENAS[ARENA_I].name or TRACKS[sel.track].name) .. "...", 60, 108, 13)
    rectfill(60, 124, 200, 6, 2)
    rectfill(60, 124, 200 * load_p, 6, 17)
    return
  end
  -- one view per player on this screen, each with its own camera and HUD
  local order
  local vs = views()
  for _, v in ipairs(vs) do
    set_view(v)
    player, cam = humans[v.p], cams[v.p]
    clip(VX, VY, VW, VH)
    draw_world()
    draw_lens(player)
    order = draw_hud()
    local big = VH >= 200
    if mode == "count" then
      local n = 3 - gt // 60
      local s = n > 0 and tostring(n) or "GO!"
      local sc = big and 4 or 2
      shadow_text(s, VX + VW // 2 - #s * 4 * sc, VY + (big and 80 or 34), n > 0 and 27 or 17, sc)
      if big then
        text("drift: hold L (or B) and steer", 40, 124, 13)
        text("X: item (hold down: fire back)", 40, 138, 13)
      end
    elseif mode == "race" and gt < 40 then
      shadow_text("GO!", VX + VW // 2 - (big and 48 or 24), VY + (big and 80 or 34), 17, big and 4 or 2)
    end
    clip()
  end
  player, cam = humans[1], cams[1]
  set_view({x = 0, y = 0, w = 320, h = 240})
  if #vs == 2 then rectfill(0, 119, 320, 2, 1) elseif #vs > 2 then rectfill(0, 119, 320, 2, 1); rectfill(159, 0, 2, 240, 1) end
  if mode == "results" then
    local n = #order
    local top = 112 - n * 6
    local ph = n * 12 + 56
    rectfill(56, top, 208, ph, 1); rect(56, top, 208, ph, 13)
    text(GMODE == "rumble" and "RUMBLE OVER" or "FINISH!", GMODE == "rumble" and 80 or 104, top + 6, 27, 2)
    for i, k in ipairs(order) do
      local y = top + 14 + i * 12
      local c = k.human and 27 or 13
      text(place_str(i), 64, y, c)
      text(k.name, 96, y, c)
      if GMODE == "rumble" then text(k.ko and "KO" or (k.helmets .. " helmet" .. (k.helmets == 1 and "" or "s")), 200, y, k.ko and 30 or c)
      else text(k.done and tstr(k.time) or "--", 200, y, c) end
    end
    if GMODE ~= "rumble" then
      local b = best[TRACKS[sel.track].name] or 0
      text(new_best and "New best time!" or ("Best " .. tstr(b)), 64, top + ph - 18, new_best and 17 or 29)
    end
    if gt > 60 then text("A: next", 128, top + ph - 8, 29) end
    if #humans > 1 then
      local p = humans[(ME or 0) > 0 and ME or 1]
      if (ME or 0) > 0 and p then text("You: " .. place_str(p.place), 200, top + ph - 18, 27) end
    end
  end
end

-- ------------------------------------------------------------------ menu screens
local function waiting_note()
  if (ME or 0) > 1 then text("Player 1 is choosing...", 92, 228, 30) end
end

function draw_menu()
  cls(1)
  for y = 0, 9 do rectfill(0, 140 + y * 10, 320, 1, 2) end
  shadow_text("KART LAB", 32, 22, 27, 4)
  -- a kart turning on the spot under the title
  local k = {body = sel.body, eng = sel.eng, tyre = sel.tyre, paint = sel.paint}
  local n, flip = kart_frame(k, (gt / 200 * TAU) % TAU)
  kart_pal(k); sspr(n, 160 - 12 * 2, 62, 3, 3, 2, flip); pal()
  for i, m in ipairs(MODES) do
    local y = 128 + (i - 1) * 24
    local on = menu_row == i
    if on then rectfill(60, y - 4, 200, 20, 2); rect(60, y - 4, 200, 20, 27) end
    shadow_text(m.name, 160 - #m.name * 8, y, on and 27 or 13, 2)
  end
  text(MODES[menu_row].about, 160 - #MODES[menu_row].about * 4, 206, 29)
  waiting_note()
end

-- a small outline of the picked track (from its points) or arena
local function draw_preview(x, y, w, h)
  rectfill(x, y, w, h, 2); rect(x, y, w, h, 30)
  local sx, sy = w / 2048, h / 1024
  if GMODE == "rumble" then
    local A = ARENAS[ARENA_I]
    for a = 0, 63 do
      for _, rr in ipairs(A.kind == "ring" and {A.r1, A.r2} or {0}) do
        local function pt(t)
          local c, s2 = math.cos(t), math.sin(t)
          if A.kind == "ring" then return ACX + c * rr, ACY + s2 * rr end
          local lo, hi = 0, 1200                          -- walk out to the bowl's edge
          for _ = 1, 14 do local m = (lo + hi) / 2; if arena_d(A, ACX + c * m, ACY + s2 * m) < 0 then lo = m else hi = m end end
          return ACX + c * lo, ACY + s2 * lo
        end
        local ax, ay = pt(a / 64 * TAU)
        local bx, by = pt((a + 1) / 64 * TAU)
        line(x + ax * sx, y + ay * sy, x + bx * sx, y + by * sy, 13)
      end
    end
    return
  end
  local tr = TRACKS[sel.track]
  local pts = tr.track and tr.track.pts
  if not pts then text("(map)", x + w // 2 - 10, y + h // 2 - 3, 30) return end
  for i = 1, #pts do
    local a, b = pts[i], pts[i % #pts + 1]
    line(x + a[1] * sx, y + a[2] * sy, x + b[1] * sx, y + b[2] * sy, 13)
  end
  circfill(x + pts[1][1] * sx, y + pts[1][2] * sy, 2, 25)
end

function draw_setup()
  cls(1)
  local m = MODES[menu_row]
  shadow_text(string.upper(m.name), 12, 8, 27, 2)
  text(GMODE == "rumble" and "arena and rules" or "track and rules", 12, 26, 29)
  draw_preview(228, 4, 84, 38)
  local rows_ = setup_rows()
  local top = 44
  local rh = #rows_ > 9 and 13 or 15
  for i, r in ipairs(rows_) do
    local y = top + (i - 1) * rh
    local on = set_row == i
    if on then rectfill(8, y - 2, 304, rh - 1, 2) end
    text(r[1], 16, y, on and 27 or 29)
    local v = r[2]
    local off = v == "off"
    text((on and "< " or "") .. v .. (on and " >" or ""), 150, y, off and 30 or 13)
    if i > (GMODE == "rumble" and 5 or 4) and GMODE ~= "trial" then   -- item rows get their icon
      local ii = i - (GMODE == "rumble" and 5 or 4)
      if ITEMS[ii] then
        if off then pal(); for c = 0, 31 do pal(c, 30) end end
        sspr(ITEMS[ii].icon, 128, y - 3, 2, 2, 0.6)
        pal()
      end
    end
  end
  local ny = top + #rows_ * rh + 2
  local on = set_row == #rows_ + 1
  rectfill(110, ny, 100, 14, on and 25 or 2)
  text("NEXT: KART >", 118, ny + 3, on and 27 or 13)
  local r = rows_[set_row]
  text(r and r[4] or "A: on to the garage. B: back.", 12, 230, 29)
  waiting_note()
end

-- ------------------------------------------------------------------ garage
function draw_garage()
  -- linked Bits show their own player's garage; a shared screen shows whose turn it is
  local v = ((ME or 0) > 0 and sels[ME]) and ME or (garage_turn() or 1)
  local keep_sel, keep_row = sel, row
  sel, row = sels[v], rows[v]
  draw_garage_for(v)
  sel, row = keep_sel, keep_row
end

function draw_garage_for(v)
  cls(1)
  for y = 0, 7 do rectfill(0, 150 + y * 12, 320, 1, 2) end
  text("KART LAB", 12, 10, 27, 2)
  text(NH > 1 and ("P" .. v .. ": build your kart") or "build your kart", 12, 28, NH > 1 and ({27, 22, 17, 10, 8, 3, 15, 25})[v] or 29)
  -- turntable
  local k = {body = sel.body, eng = sel.eng, tyre = sel.tyre, paint = sel.paint}
  ellipse(80, 150, 52, 31)
  circ(80, 150, 50, 3)
  local rel = (gt / 240 * TAU) % TAU
  local n, flip = kart_frame(k, rel)
  kart_pal(k)
  sspr(n, 80 - 12 * 4, 150 - 19 * 4, 3, 3, 4, flip)
  pal()
  -- pickers
  local items = {{"Body", BODIES[sel.body]}, {"Engine", ENGINES[sel.eng]}, {"Tyres", TYRES[sel.tyre]}, {"Paint", PAINTS[sel.paint]}}
  for i, it in ipairs(items) do
    local y = 50 + (i - 1) * 21
    local on = row == i
    if on then rectfill(158, y - 2, 156, 18, 2) end
    text(it[1], 164, y, on and 27 or 29)
    text((on and "< " or "") .. it[2].name .. (on and " >" or ""), 164, y + 8, 13)
  end
  local on = row == 5
  rectfill(158, 136, 156, 14, on and 25 or 2)
  text("GO!", 222, 139, on and 27 or 13)
  local where = GMODE == "rumble" and ARENAS[ARENA_I].name or TRACKS[sel.track].name
  text(MODES[menu_row].name .. ": " .. where, 164, 36, 30)
  local b = best[TRACKS[sel.track].name]
  local nw = 0
  for _, tr in ipairs(TRACKS) do if wins[tr.name] then nw = nw + 1 end end
  if GMODE == "race" then text("WINS " .. nw .. "/" .. #TRACKS, 248, 22, nw == #TRACKS and 17 or 29) end
  local about = row == 1 and BODIES[sel.body].about or row == 2 and ENGINES[sel.eng].about
    or row == 3 and TYRES[sel.tyre].about or row == 4 and "Looks only. Rivals never copy it."
    or (v == 1 and "A: go. B: back to the track and rules." or "A: ready.")
  text(about, 12, 196, 29)
  local s = build_stats(sel.body, sel.eng, sel.tyre)
  for i, key in ipairs(STATS) do
    local x, y = 12 + ((i - 1) % 3) * 104, 210 + ((i - 1) // 3) * 12
    text(key, x, y, 28)
    rectfill(x + 60, y + 1, 36, 5, 31)
    rectfill(x + 60, y + 1, math.min(s[key], 10) * 3.6, 5, ({21, 17, 22, 9, 16, 5})[i])
  end
  text(NH > 1 and "A: ready" or "A: go", 312 - (NH > 1 and 8 or 5) * 8, 10, 29)
  if ready[v] then
    rectfill(158, 136, 156, 14, 17)
    local wait = 0
    for p = 1, NH do if not ready[p] then wait = p; break end end
    text(wait > 0 and ("waiting for player " .. wait) or "READY!", 172, 139, 1)
  end
end
`.replace('__TRACKS__', luaTracks);

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

    // road segment tiles (the Track tab paints these): 1 road, 2-4 grass, 5 start line, 6 boost pad,
    // 169/170 kerb A/B. The road edge tiles 7-168 are built from them.
    const TT = window.BKTracks.TILE;
    putTile(TT.ROAD, roadPx);
    putTile(TT.GRASS, (x, y) => grassPx(x, y, 0));
    putTile(TT.GRASS2, (x, y) => (x === 2 && y === 3) || (x === 5 && y === 6) ? 27 : (x === 6 && y === 1) ? 13 : grassPx(x, y, 1));
    putTile(TT.GRASS3, (x, y) => (hash(x, y, 9) < 500 ? 15 : 16));
    putTile(TT.START, (x, y) => (((x >> 2) + (y >> 2)) & 1) ? 13 : 1);
    putTile(TT.BOOST, (x, y) => ((x + y) & 7) < 3 ? 27 : ((x + y) & 7) < 5 ? 10 : 9);
    putTile(TT.KERB_A, (x, y) => (hash(x, y, 5) < 120 ? 24 : 25));
    putTile(TT.KERB_B, (x, y) => (hash(x, y, 6) < 120 ? 29 : 13));
    window.BKTracks.genEdges(cart);
    cart.entities = cart.entities || { types: [], placed: [] };
    cart.entities.flagNames = window.BKTracks.FLAG_NAMES.slice();

    // karts: 3 bodies x 9 angles, 24x24 each, packed 5 per band of 3 tile rows from tile 176
    MODELS.forEach((vox, b) => {
      for (let d = 0; d <= 8; d++) {
        const img = renderKart(vox, d / 16 * Math.PI * 2);
        const idx = b * 9 + d, base = 176 + Math.floor(idx / 5) * 48 + (idx % 5) * 3;
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++)
          T[(base + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = img[y * 24 + x];
      }
    });

    // billboards, item icons and map markers (tiles 464-511)
    const sprite = (n, w, h, fn) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        T[(n + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = fn(x, y);
    };
    const disc = (x, y, cx, cy, r) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
    sprite(464, 16, 24, (x, y) => {                               // pine
      if (y >= 19) return (x >= 7 && x <= 8) ? (x === 7 ? 7 : 6) : 0;
      const layer = y < 7 ? y : y < 13 ? y - 5 : y - 10;
      const half = 1 + layer * 0.8, dx = x + 0.5 - 8;
      if (Math.abs(dx) > half) return 0;
      if (Math.abs(dx) > half - 1.2) return 1;
      return dx < -1 ? 16 : dx > 1.5 ? 14 : 15;
    });
    sprite(466, 16, 24, (x, y) => {                               // round tree
      if (y >= 17) return (x >= 7 && x <= 8) ? (x === 7 ? 7 : 6) : 0;
      const dx = x + 0.5 - 8, dy = y + 0.5 - 9, r = Math.hypot(dx, dy);
      if (r > 7.5) return 0;
      if (r > 6.5) return 1;
      return dx + dy < -4 ? 17 : (dx + dy > 4 ? 15 : (hash(x, y, 11) < 200 ? 17 : 16));
    });
    sprite(468, 8, 8, (x, y) => {                                 // cone
      if (y === 7) return x >= 1 && x <= 6 ? 30 : 0;
      const half = 0.5 + y * 0.45, dx = x + 0.5 - 4;
      if (Math.abs(dx) > half) return 0;
      return y === 3 || y === 4 ? 13 : (dx > 0 ? 9 : 10);
    });
    sprite(469, 16, 16, (x, y) => {                               // Nitro: a red canister
      if (x < 4 || x > 11 || y < 2 || y > 14) return 0;
      if (y < 4) return x >= 6 && x <= 9 ? 29 : 0;
      if (x === 4 || x === 11 || y === 14) return 1;
      if (y >= 7 && y <= 9) return 27;
      return x < 7 ? 26 : 25;
    });
    sprite(471, 16, 16, (x, y) => {                               // Oil Slick: a black drop
      const r = 5, cy = 9.5;
      const inside = (y + 0.5 >= cy ? disc(x, y, 8, cy, r) : Math.abs(x + 0.5 - 8) <= (y + 0.5 - 2) * r / (cy - 2));
      if (!inside || y < 2) return 0;
      return disc(x, y, 6.5, 9.5, 1.6) ? 28 : 31;
    });
    sprite(473, 16, 16, (x, y) => {                               // Bolt: a hex-head bolt
      if (y >= 2 && y <= 6 && x >= 4 && x <= 11) return y === 2 || y === 6 || x === 4 || x === 11 ? 1 : (y === 3 ? 13 : 29);
      if (y >= 7 && y <= 14 && x >= 6 && x <= 9) return (y % 2 === 0) ? 28 : (x === 6 ? 13 : 29);
      return 0;
    });
    sprite(475, 16, 16, (x, y) => {                               // Drone: four rotors and a red eye
      if ([[3.5, 3.5], [12.5, 3.5], [3.5, 12.5], [12.5, 12.5]].some(([a, b]) => disc(x, y, a, b, 2.6))) return 29;
      if ((x === y || x === 15 - y) && x > 3 && x < 12) return 30;
      if (disc(x, y, 8, 8, 3.2)) return disc(x, y, 8, 8, 1.4) ? 25 : 31;
      return 0;
    });
    sprite(477, 16, 16, (x, y) => {                               // Shield: a blue ring
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (r > 7) return 0;
      if (r > 5.5) return r > 6.4 ? 20 : 22;
      return disc(x, y, 6, 6, 1.5) ? 13 : 0;
    });
    // Tire and Golden Tires icons sit in the free tiles beside the last kart band (422-431)
    const tyre = (gold) => (x, y) => {
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8), a = Math.atan2(y + 0.5 - 8, x + 0.5 - 8);
      if (r > 7.4) return 0;
      if (r > 4.2) {                                               // the rubber, with tread notches
        const tread = r > 6.2 && Math.floor((a + Math.PI) / (Math.PI / 6)) % 2 === 0;
        return gold ? (tread ? 11 : (x + y < 14 ? 27 : 9)) : (tread ? 30 : (x + y < 14 ? 31 : 1));
      }
      if (r > 2.2) return gold ? 13 : (x + y < 15 ? 29 : 28);      // the rim
      return gold ? 27 : 30;
    };
    sprite(422, 16, 16, tyre(false));                             // Tire: rolls along and homes in
    sprite(424, 16, 16, (x, y) => {                               // Golden Tires: a gold tyre with a sparkle
      if ((x === 13 && y >= 0 && y <= 4) || (y === 2 && x >= 11 && x <= 15)) return 13;
      return tyre(true)(x, y);
    });
    sprite(479, 8, 8, (x, y) => {                                 // item crate: a wooden box with a bolt mark
      if (x === 0 || y === 0 || x === 7 || y === 7) return 7;
      if ((x === 3 || x === 4) && y >= 2 && y <= 5) return 27;
      if (y === 2 && x >= 2 && x <= 5) return 27;
      return (x + y) % 3 === 0 ? 9 : 10;
    });
    sprite(495, 8, 8, (x, y) => {                                 // drone in flight
      if ((x <= 1 || x >= 6) && (y <= 1 || y >= 6)) return 29;
      if (x >= 2 && x <= 5 && y >= 2 && y <= 5) return (x === 3 || x === 4) && (y === 3 || y === 4) ? 25 : 31;
      return 0;
    });
    // one level per track, the road painted the same way the game does it
    cart.levels = TRACKS.map(t => {
      const map = new Uint16Array(256 * 128), track = JSON.parse(JSON.stringify(t.track));
      window.BKTracks.paint(map, track);
      return { name: t.name, w: 256, h: 128, map, placed: [], track, height: heights(t) };
    });
    cart.map.set(cart.levels[0].map);
    cart.levels[0].map = cart.map;
    cart.entities = Object.assign(cart.entities || {}, { effects: [], types: [], placed: cart.levels[0].placed, cutscenes: [] });
  }

  const demo = { name: 'Kart Lab', code, buildGfx, about: 'A 2.5D kart racer with hills, items and two tracks you can edit on the Track tab.' };
  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push(demo);
})();
