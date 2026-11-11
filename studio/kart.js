/* Demo cart "Kart Lab": a 2.5D kart racer. Original art and code. MIT License.
   Tracks are levels edited on the Track tab (see tracks.js): a smooth loop through control points, with
   boost pads, item crates, hills and painted elevation. The game builds the road and the hills from them
   when a race starts (this file pre-paints the built-in tracks the same way so the Map tab shows them).
   The road is made from a few "segment" tiles (road, kerbs, grass, start line, boost pad).
   The karts are tiny voxel models rendered here from 9 angles (the other 7 are mirror images). */
(function () {
  // Built-in tracks: control points of the loop (world pixels, the map is 2048 x 1024; the first point is
  // the start line), plus items placed by [fraction of the lap, offset to the right of the centre line].
  const TRACK_DEFS = [
    { name: 'Pinewood Loop',
      pts: [[360, 190], [900, 150], [1400, 170], [1760, 290], [1880, 520], [1730, 730], [1430, 690],
        [1180, 540], [950, 600], [990, 820], [790, 930], [440, 880], [230, 700], [200, 420]],
      boosts: [[0.13, -18], [0.36, 16], [0.6, 0], [0.85, -16]],
      crates: [0.22, 0.52, 0.78],
      hills: [['hill', 0.27, 0], ['dip', 0.62, 0], ['bump', 0.73, 0], ['hill', 0.93, 120]] },
    { name: 'Quarry Hills',
      pts: [[260, 560], [300, 230], [700, 140], [1100, 240], [1250, 470], [1500, 330], [1800, 260],
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
-- It's all about the karts. Build one in the garage (body, engine, tyres, paint), pick a track,
-- then race three rival karts for 3 laps.
--   Throttle: R (analog: squeeze harder to go faster) or A     Brake / reverse: B
--   Steer: d-pad. Steering comes in 3 stages: a tap is gentle, holding turns harder,
--          keep holding for the sharpest turn. It blends smoothly between them.
--   Drift: hold L (or B while on the throttle) and steer. The sparks go white, amber,
--          violet: let go for a boost. The longer the drift, the bigger the boost.
--   Item: X uses what you got from a crate. Hold down to look back; hold down + X fires backwards.
-- Items: Nitro (boost), Oil Slick (dropped behind you), Bolt (fired straight ahead or back),
--        Drone (homes in on the kart in front of you, or behind), Shield (blocks one hit).
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
LAPS = 3
ROADW, KERBW = 44, 7          -- half width of the road, kerb width (pixels)

-- camera (2.5D): height above the ground, horizon row, zoom, distance behind the kart
CAM_H, HORIZON, FOCAL, CAM_D = 22, 84, 170, 40
SPR_K = 0.6        -- sprite pixels per world pixel
STEP = 1           -- floor column step: 2 is chunkier but faster (handy on the device)

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

-- items from crates. odds = chance by race position (1st .. 4th): leaders get defence, the back gets speed
ITEMS = {
  {name="Nitro",     icon=469, odds={0, 25, 30, 35}},
  {name="Oil Slick", icon=471, odds={40, 20, 15, 10}},
  {name="Bolt",      icon=473, odds={35, 30, 25, 20}},
  {name="Drone",     icon=475, odds={0, 10, 15, 25}},
  {name="Shield",    icon=477, odds={25, 15, 15, 10}},
}

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
  for i, p in ipairs(tk.pts) do ctrl[i] = {p[1], p[2]} end
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

HILL_KINDS = {hill = {36, 180}, bump = {14, 44}, dip = {-26, 160}}   -- height, radius (same as the Track tab)
function place_items(T)
  for _, it in ipairs(T.items or {}) do
    local x, y, nx, ny = at_s((it.t or 0) * LEN)
    local o = it.o or 0
    if it.k == "boost" then T.boosts[#T.boosts + 1] = {x + nx * o, y + ny * o}
    elseif it.k == "crate" then
      for _, d in ipairs({-22, 0, 22}) do T.crates[#T.crates + 1] = {x = x + nx * (o + d), y = y + ny * (o + d), t = 0} end
    elseif HILL_KINDS[it.k] then
      local h = HILL_KINDS[it.k]
      T.hills[#T.hills + 1] = {x + nx * o, y + ny * o, h[1], h[2]}
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
    elseif k == "hill" then T.hills[#T.hills + 1] = {x, y, 36, 180}
    elseif k == "bump" then T.hills[#T.hills + 1] = {x, y, 14, 44}
    elseif k == "dip" then T.hills[#T.hills + 1] = {x, y, -26, 160} end
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
  WP = {}
  local acc, SP = 0, 24
  WP[1] = {x=RAW[1][1], y=RAW[1][2]}
  for i = 1, #RAW do
    local a, b = RAW[i], RAW[i % #RAW + 1]
    local d = RAWS[i + 1] - RAWS[i]
    local u = 0
    while d > 0 and acc + (d - u) >= SP do
      u = u + (SP - acc); acc = 0
      local f = u / d
      WP[#WP + 1] = {x=a[1] + (b[1]-a[1])*f, y=a[2] + (b[2]-a[2])*f}
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
      for _, hl in ipairs(T.hills) do
        local d2 = ((x - hl[1])^2 + (y - hl[2])^2) / (hl[4] * hl[4])
        if d2 < 9 then h = h + hl[3] * math.exp(-d2) end
      end
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
    if not list then return 1e9, 0 end
    local best, s = 1e18, 0
    for _, i in ipairs(list) do
      local a, b = RAW[i], RAW[i % n + 1]
      local dx, dy = b[1] - a[1], b[2] - a[2]
      local l2 = dx*dx + dy*dy
      local f = l2 > 0 and ((x - a[1])*dx + (y - a[2])*dy) / l2 or 0
      f = f < 0 and 0 or (f > 1 and 1 or f)
      local ex, ey = x - (a[1] + dx*f), y - (a[2] + dy*f)
      local d = ex*ex + ey*ey
      if d < best then best, s = d, RAWS[i] + f * (RAWS[i + 1] - RAWS[i]) end
    end
    return math.sqrt(best), s
  end
  -- classify the tile corners near the road: 0 road, 1 kerb, 2 grass
  local CL, CSV, M = {}, {}, ROADW + KERBW + 4
  for i = 1, n do
    local a, b = RAW[i], RAW[i % n + 1]
    for cy = math.max(0, (math.min(a[2], b[2]) - M) // 8), math.min(128, (math.max(a[2], b[2]) + M) // 8 + 1) do
      for cx = math.max(0, (math.min(a[1], b[1]) - M) // 8), math.min(256, (math.max(a[1], b[1]) + M) // 8 + 1) do
        local k = cy * 257 + cx
        if not CL[k] then
          local d, s = near(cx * 8, cy * 8)
          CL[k] = d < ROADW and 0 or (d < ROADW + KERBW and 1 or 2)
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
    steer=0, shold=0, sdir=0, stage=0, spin=0, shield=0, item=nil, roll=0, item_t=0,
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

function popup(s, c) pop_s, pop_c, pop_t = s, c, 50 end

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
        if not k.ai then
          sfx("G5", 2, 0.35, 16, 4, 0, -900)
          popup(({"BOOST!", "BIG BOOST!", "MEGA BOOST!"})[tier], ({13, 27, 5})[tier])
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
    if terr == 3 then top = top * k.off
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
    fwd = fwd - slope * 0.06
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
      if k.vz < -2 and not k.ai then sfx("C2", 3, 0.4, 6, 6); shake = 4 end
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
  local d = (btn("right") and 1 or 0) - (btn("left") and 1 or 0)
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
  local tx, ty = p.x + p.nx * k.lane, p.y + p.ny * k.lane
  local d = angdiff(math.atan(ty - k.y, tx - k.x), k.a)
  local steer = clamp(d * 3.5, -1, 1)
  local thr = k.skill
  local gap = progress(player) - progress(k)
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

-- ------------------------------------------------------------------ items
function roll_item(k)
  local place = math.min(k.place or 4, 4)
  local total = 0
  for _, it in ipairs(ITEMS) do total = total + it.odds[place] end
  local r = rnd(total)
  for i, it in ipairs(ITEMS) do
    r = r - it.odds[place]
    if r <= 0 then return i end
  end
  return 1
end

function hit(k, by)
  if k.shield > 0 then
    k.shield = 0
    if k == player or by == player then sfx("E5", 4, 0.3, 10, 6) end
    return
  end
  if k.spin > 0 then return end
  k.spin, k.hop = 50, 8
  if k == player or by == player then sfx("A2", 2, 0.5, 20, 6, 0, -200) end
  if k == player then shake = 8 end
end

function use_item(k, back)                             -- back: fire it behind you (hold down)
  local i = k.item
  if not i or k.roll > 0 then return end
  k.item, k.item_t = nil, 0
  local c, s = math.cos(k.a), math.sin(k.a)
  if i == 1 then                                       -- Nitro
    k.boost = math.max(k.boost, 75)
    if k == player then sfx("G5", 2, 0.4, 20, 4, 0, -900); popup("NITRO!", 10) end
  elseif i == 2 then                                   -- Oil Slick, behind you
    hazards[#hazards + 1] = {kind = "oil", x = k.x - c*16, y = k.y - s*16, life = 1800, owner = k}
    if k == player then sfx("C3", 3, 0.3, 8) end
  elseif i == 3 then                                   -- Bolt, straight ahead (or straight back)
    local f = back and -1 or 1
    shots[#shots + 1] = {kind = "bolt", x = k.x + c*12*f, y = k.y + s*12*f, vx = c*6*f + k.vx*0.5, vy = s*6*f + k.vy*0.5, life = 110, owner = k}
    if k == player then sfx("E5", 0, 0.3, 6, 4, 0, 800) end
  elseif i == 4 then                                   -- Drone, after the kart in front (or behind)
    local target, f = nil, back and -1 or 1
    for _, o in ipairs(karts) do if o.place == (k.place or 1) - f then target = o end end
    shots[#shots + 1] = {kind = "drone", x = k.x, y = k.y, vx = c*3*f, vy = s*3*f, life = 600, owner = k, target = target}
    if k == player then sfx("B4", 5, 0.3, 14, 4, 0, 300) end
  elseif i == 5 then                                   -- Shield
    k.shield = 420
    if k == player then sfx("C5", 4, 0.3, 14, 4, 0, 400) end
  end
end

function update_items()
  -- crates: drive through one to get an item (if your slot is empty); they come back after 4 s
  for _, cr in ipairs(CRATES) do
    if cr.t > 0 then cr.t = cr.t - 1
    else
      for _, k in ipairs(karts) do
        if (k.x - cr.x)^2 + (k.y - cr.y)^2 < 12*12 and not k.air then
          cr.t = 240
          if not k.item then
            k.item, k.roll, k.item_t = roll_item(k), 40, 0
            if k == player then sfx("C5", 5, 0.25, 4, 5) end
          end
          break
        end
      end
    end
  end
  for _, k in ipairs(karts) do
    if k.roll > 0 then
      k.roll = k.roll - 1
      if k == player and k.roll % 5 == 0 and k.roll > 0 then sfx("A5", 5, 0.12, 2, 5) end
    end
    if k.shield > 0 then k.shield = k.shield - 1 end
  end
  -- oil slicks spin out whoever drives over them
  for i = #hazards, 1, -1 do
    local h = hazards[i]
    h.life = h.life - 1
    for _, k in ipairs(karts) do
      if (k.x - h.x)^2 + (k.y - h.y)^2 < 10*10 and not k.air and k.spin == 0 then
        hit(k, h.owner); h.life = 0; break
      end
    end
    if h.life <= 0 then table.remove(hazards, i) end
  end
  -- bolts fly straight, drones chase their target
  for i = #shots, 1, -1 do
    local p = shots[i]
    p.life = p.life - 1
    if p.kind == "drone" then
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
    if p.kind == "bolt" then
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
      if d2 < 13*13 and d2 > 0.01 and math.abs(a.z - b.z) < 8 then
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
      if dx*dx + dy*dy < 11*11 and a.z < t.z + 20 then
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
  TRACKS = track_list()
  sel = {track=1, body=1, eng=2, tyre=1, paint=1}
  best = {}
  if saved then
    local d = saved()
    if d and d.sel then for k, v in pairs(d.sel) do sel[k] = v end end
    if d and type(d.best) == "table" then best = d.best end
  end
  if sel.track > #TRACKS then sel.track = 1 end
  row, mode, gt = 1, "garage", 0
  shake, parts, pop_t = 0, {}, 0
  TREES, CRATES, hazards, shots = {}, {}, {}, {}
  if KART_QUICK then                   -- "race it" on the Track tab: straight onto that track
    for i, tr in ipairs(TRACKS) do if tr.level == KART_QUICK then sel.track = i; load_track() end end
  end
end

function persist()
  if save then save({sel = sel, best = best}) end
end

-- load the track's level (if it is one), then build its world a little each frame
function load_track()
  local tr = TRACKS[sel.track]
  mode, gt, load_p = "loading", 0, 0
  loader = coroutine.create(function()
    if tr.level and tr.level ~= LEVEL then
      level(tr.level)                    -- the map arrives before the next frame
      coroutine.yield(0)
      ents_update()                      -- finishes the level switch
    end
    local tk = tr.track or {}
    ROADW, KERBW, LAPS = tk.road or 44, tk.kerb or 7, tk.laps or 3
    local T
    if tr.track then T = spline_track(tr.track, tr.height) else T = read_track(tr.placed) end
    if not T then load_err = tr.name .. " needs 3 or more points"; return end
    build_world(T, sel.track * 7)
  end)
end

function start_race()
  karts, finished, hazards, shots, parts = {}, {}, {}, {}, {}
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
    k.z = hget(k.x, k.y)
    k.place = i
  end
  cam = {a = player.a, ta = player.a, back = false, x = player.x, y = player.y, z = player.z + CAM_H}
  mode, gt, race_t = "count", 0, 0
end

function _update()
  gt = gt + 1
  if mode == "garage" then garage_update()
  elseif mode == "loading" then
    if load_err then
      if btnp("a") or btnp("b") then load_err, mode, gt = nil, "garage", 0 end
      return
    end
    local ok, p = coroutine.resume(loader)
    if not ok then error(p) end
    load_p = p or load_p
    if coroutine.status(loader) == "dead" and not load_err then start_race() end
  elseif mode == "count" or mode == "race" then race_update()
  elseif mode == "results" then
    race_update()
    if gt > 60 and btnp("a") then mode, gt = "garage", 0 end
  end
end

function garage_update()
  local rows = {"track", "body", "eng", "tyre", "paint"}
  local lists = {TRACKS, BODIES, ENGINES, TYRES, PAINTS}
  if btnp("up") then row = (row - 2) % 6 + 1; sfx("E5", 0, 0.2, 3) end
  if btnp("down") then row = row % 6 + 1; sfx("E5", 0, 0.2, 3) end
  if row <= 5 then
    local key, n = rows[row], #lists[row]
    if btnp("left") then sel[key] = (sel[key] - 2) % n + 1; sfx("A5", 0, 0.2, 3) end
    if btnp("right") then sel[key] = sel[key] % n + 1; sfx("A5", 0, 0.2, 3) end
  end
  if btnp("a") and gt > 10 then
    persist()
    sfx("C5", 4, 0.3, 10); load_track()
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
  standings()
  for _, k in ipairs(karts) do
    local thr, brk, steer, drift
    if k.done or not racing then
      if k.done then thr, brk, steer, drift = ai_input(k); thr = thr * 0.7
      else thr, brk, steer, drift = 0, false, 0, false end
    elseif k.ai then thr, brk, steer, drift = ai_input(k)
    else
      thr = math.max(press("r") / 255, btn("a") and 1 or 0)
      local bdrift = btn("b") and thr > 0.5           -- B while on the throttle drifts instead of braking
      brk = btn("b") and not bdrift
      steer = player_steer(k)
      drift = btn("l") or press("l") > 100 or bdrift
      if btnp("x") then use_item(k, btn("down")) end
    end
    drive(k, thr, brk, steer, drift)
    track_kart(k)
  end
  collide()
  if racing then update_items() end
  if racing and player.done and mode ~= "results" then
    mode, gt = "results", 0
    local key = TRACKS[sel.track].name
    if not best[key] or player.time < best[key] then best[key] = player.time; new_best = true else new_best = false end
    persist()
  end
  track(player.x, player.y)        -- the Map tab shows your racing line
  -- camera swings behind the kart, lagging a little in turns and more in drifts.
  -- Holding down looks back: the camera jumps in front of the kart, facing backwards.
  local lag = player.drift ~= 0 and 0.07 or 0.13
  cam.ta = (cam.ta + angdiff(player.a, cam.ta) * lag) % TAU
  cam.back = mode == "race" and not player.done and btn("down")
  cam.a = cam.back and (cam.ta + math.pi) % TAU or cam.ta
  local d = cam.back and CAM_D or CAM_D + player.fwd * 2
  cam.x, cam.y = player.x - math.cos(cam.a) * d, player.y - math.sin(cam.a) * d
  local cz = math.max(player.z, hget(cam.x, cam.y) + 4) + CAM_H
  cam.z = cam.z + (cz - cam.z) * 0.2
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
  if shake > 0 then shake = shake - 1 end
  if pop_t > 0 then pop_t = pop_t - 1 end
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

local function ellipse(x, y, w, c)
  local h = math.max(1, w * 0.22)
  for j = -h, h do
    local f = 1 - (j / (h + 0.5))^2
    local hw = w * math.sqrt(math.max(f, 0))
    rectfill(x - hw, y + j, hw * 2, 1, c)
  end
end

function draw_world()
  local sx = shake > 0 and rnd(-2, 2) or 0
  draw_sky(cam.a)
  -- the track with its hills: one call draws the whole floor
  floorh(cam.x, cam.y, cam.a, cam.z, HORIZON, FOCAL, 15, STEP)

  local list = {}
  local function add(x, y, z, kind, obj)
    local px, py, sc, dist = project(x, y, z)
    if px and sc > 0.03 and px > -80 and px < 400 then
      list[#list + 1] = {px=px, py=py, sc=sc, dist=dist, kind=kind, o=obj}
    end
  end
  for _, t in ipairs(TREES) do add(t.x, t.y, t.z, t.kind) end
  for _, c in ipairs(CRATES) do if c.t <= 0 then add(c.x, c.y, c.z, 3, c) end end
  for _, k in ipairs(karts) do add(k.x, k.y, k.z, 4, k) end
  for _, p in ipairs(parts) do add(p.x, p.y, p.z, 5, p) end
  for _, h in ipairs(hazards) do add(h.x, h.y, hget(h.x, h.y), 7, h) end
  for _, p in ipairs(shots) do add(p.x, p.y, hget(p.x, p.y) + (p.kind == "drone" and 10 or 4), 8, p) end
  -- start gantry posts
  local w = WP[1]
  local gx1, gy1, gx2, gy2 = w.x + w.nx * (ROADW + 6), w.y + w.ny * (ROADW + 6), w.x - w.nx * (ROADW + 6), w.y - w.ny * (ROADW + 6)
  add(gx1, gy1, hget(gx1, gy1), 6)
  add(gx2, gy2, hget(gx2, gy2), 6)
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

local function shadow_text(s, x, y, c, sc)
  text(s, x + 1, y + 1, 1, sc); text(s, x, y, c, sc)
end

function draw_hud()
  local order = standings()
  -- place
  shadow_text(place_str(player.place), 8, 8, ({27, 29, 10, 13})[player.place], 3)
  -- lap and time
  local lap = clamp(player.lap, 1, LAPS)
  shadow_text("LAP " .. lap .. "/" .. LAPS, 240, 8, 13)
  shadow_text(tstr(player.done and player.time or race_t), 240, 18, 12)
  if cam.back then shadow_text("REAR VIEW", 136, 44, 13) end
  -- item slot
  rectfill(144, 6, 32, 30, 1); rect(144, 6, 32, 30, player.item and 13 or 30)
  if player.item then
    local icon = player.roll > 0 and ITEMS[(gt // 4) % #ITEMS + 1].icon or ITEMS[player.item].icon
    sspr(icon, 148, 9, 2, 2, 1.5)
    if player.roll <= 0 then text("X", 172, 28, 29) end
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
  if pop_t > 0 then
    local w = #pop_s * 16
    shadow_text(pop_s, 160 - w // 2, 150 - (50 - pop_t) // 3, pop_c, 2)
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
  if mode == "loading" then
    cls(1)
    if load_err then
      text("Can't build this track:", 20, 100, 25)
      text(load_err, 20, 114, 13)
      text("A: back", 20, 140, 29)
      return
    end
    text("Building " .. TRACKS[sel.track].name .. "...", 60, 108, 13)
    rectfill(60, 124, 200, 6, 2)
    rectfill(60, 124, 200 * load_p, 6, 17)
    return
  end
  draw_world()
  local order = draw_hud()
  if mode == "count" then
    local n = 3 - gt // 60
    local s = n > 0 and tostring(n) or "GO!"
    local w = #s * 32
    shadow_text(s, 160 - w // 2, 80, n > 0 and 27 or 17, 4)
    text("drift: hold L (or B) and steer", 40, 124, 13)
    text("X: item (hold down: fire back)", 40, 138, 13)
  elseif mode == "race" and gt < 40 then
    shadow_text("GO!", 112, 80, 17, 4)
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
    local b = best[TRACKS[sel.track].name] or 0
    text(new_best and "New best time!" or ("Best " .. tstr(b)), 64, 154, new_best and 17 or 29)
    if gt > 60 then text("A: back to garage", 104, 164, 29) end
  end
end

-- ------------------------------------------------------------------ garage
function draw_garage()
  cls(1)
  for y = 0, 7 do rectfill(0, 150 + y * 12, 320, 1, 2) end
  text("KART LAB", 12, 10, 27, 2)
  text("build your kart", 12, 28, 29)
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
  local items = {
    {"Track", TRACKS[sel.track]}, {"Body", BODIES[sel.body]}, {"Engine", ENGINES[sel.eng]},
    {"Tyres", TYRES[sel.tyre]}, {"Paint", PAINTS[sel.paint]}}
  for i, it in ipairs(items) do
    local y = 40 + (i - 1) * 19
    local on = row == i
    if on then rectfill(158, y - 2, 156, 18, 2) end
    text(it[1], 164, y, on and 27 or 29)
    text((on and "< " or "") .. it[2].name .. (on and " >" or ""), 164, y + 8, 13)
  end
  local on = row == 6
  rectfill(158, 136, 156, 14, on and 25 or 2)
  text("RACE!", 214, 139, on and 27 or 13)
  local b = best[TRACKS[sel.track].name]
  local about = row == 1 and (b and ("Best time " .. tstr(b)) or "No time set yet.")
    or row == 2 and BODIES[sel.body].about or row == 3 and ENGINES[sel.eng].about
    or row == 4 and TYRES[sel.tyre].about or row == 5 and "Looks only. Rivals never copy it." or "3 laps. Crates hold items (X)."
  text(about, 12, 196, 29)
  local s = build_stats(sel.body, sel.eng, sel.tyre)
  for i, key in ipairs(STATS) do
    local x, y = 12 + ((i - 1) % 3) * 104, 210 + ((i - 1) // 3) * 12
    text(key, x, y, 28)
    rectfill(x + 60, y + 1, 36, 5, 31)
    rectfill(x + 60, y + 1, math.min(s[key], 10) * 3.6, 5, ({21, 17, 22, 9, 16, 5})[i])
  end
  text("A: race", 260, 10, 29)
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
