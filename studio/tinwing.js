/* Demo cart "Tinwing": a story game in 2.5D about a teenager who builds RC planes in a flooded world.
   Original story, art and code. MIT License. */
(function () {
  const code = `-- Tinwing: a little story game in 2.5D.
-- Perch is a town on stilts, on a planet that is nearly all sea. Letters go by pigeon, people go by boat.
-- You are Pip, who builds radio-controlled planes in a hangar by the water.
--
-- Hangar: build the plane yourself. SIDE and TOP show the plane as a blueprint: pick a corner with the
--   D-pad, A grabs it, the D-pad moves it, A drops it. Make the body big enough for the motor and battery
--   you fit on the PARTS page, and shape the wings: more wing glides further, shorter wings turn quicker.
--   L / R (or X) switch pages. FLY launches when everything fits.
-- Flying: left / right bank and turn, up / down climb and dive (swap it in Settings). Hold A (or squeeze R)
--   for the motor; let go to glide, which costs no battery. Warm air rings give a Tailwind.
--   Fly low over the yellow pad at Perch to land. A flat battery means a swim: Tobin fishes you out.
--
-- Everything on the map is an entity you can move on the Map tab. The story is on the Cutscenes tab and
-- the Tailwind is an effect on the Entities tab. The sea is drawn with floorh(), houses and crates are
-- scaled sprites (sspr), and the plane is a 3D model built from your blueprint and drawn with triangles.

TAU = math.pi * 2
F_FOC, F_HOR, F_BACK, F_UP, STEP = 160, 92, 46, 12, 2
K_FLY = 2          -- world pixels per sprite pixel for buildings seen from the air
CEIL = 170         -- the radio doesn't reach higher than this
BASE_SPEED, BASE_TURN, BASE_DRAIN = 1.6, 0.034, 1 / 1500

-- parts: size of the box they need inside the body (length, height, width), what they do, and what they cost
-- (cost -1: can't be bought, you have to find it)
MOTORS = {
  {name = "Hummer", len = 3, h = 1.8, w = 2.0, power = 1.0, weight = 0.6, prop = 4.6, cost = 0, about = "Small and quiet."},
  {name = "Buzzer", len = 3.5, h = 2.6, w = 2.8, power = 1.4, weight = 0.9, prop = 5.4, cost = 6, about = "Faster. Needs a fatter nose."},
  {name = "Roarer", len = 4.5, h = 3.4, w = 3.6, power = 1.9, weight = 1.3, prop = 6.2, cost = 14, about = "Very fast, and big."},
}
CELLS = {
  {name = "Single Cell", len = 4, h = 1.8, w = 1.8, cap = 1.0, weight = 0.5, cost = 0, about = "Gets you to the Belltower and back."},
  {name = "Twin Cell", len = 4, h = 1.8, w = 4.0, cap = 2.2, weight = 0.8, cost = -1, about = "Twice the range, twice as wide."},
  {name = "Brick Cell", len = 6, h = 2.8, w = 2.8, cap = 1.6, weight = 1.0, cost = 10, about = "Long and tall. A bit more range."},
}
PAINTS = {   -- main colour, shade, trim
  {name = "Tin", cost = 0, c = {29, 28, 25}},
  {name = "Sunrise", cost = 0, c = {10, 9, 13}},
  {name = "Lagoon", cost = 0, c = {22, 21, 27}},
  {name = "Moss", cost = 3, c = {17, 16, 12}},
  {name = "Cherry", cost = 3, c = {26, 25, 13}},
  {name = "Plum", cost = 4, c = {5, 4, 27}},
}
PARTS = {{"Motor", MOTORS, "m"}, {"Battery", CELLS, "c"}, {"Paint", PAINTS, "p"}}
TABS = {"SIDE", "TOP", "PARTS", "FLY"}
SNAME = {"Front", "Middle", "Back"}

-- sprites seen from the air: first tile, size in tiles
DRAW = {
  house_a = {t = 160, w = 4, h = 5}, house_b = {t = 164, w = 4, h = 5}, loft = {t = 168, w = 4, h = 5}, shed = {t = 172, w = 4, h = 5},
  tower = {t = 240, w = 3, h = 8}, wreck = {t = 243, w = 3, h = 5}, palm = {t = 246, w = 2, h = 3},
  boat = {t = 248, w = 4, h = 2}, buoy = {t = 252, w = 1, h = 2},
  crate = {t = 120, w = 2, h = 2}, coil = {t = 122, w = 2, h = 2}, satchel = {t = 124, w = 2, h = 2},
}
PICK = {crate = true, coil = true, satchel = true, ring = true}

-- ------------------------------------------------------------------ the save
-- the blueprint: body stations from front to back {x, top, bottom, half width}, the nose and tail points,
-- and the right wing seen from above (root front / back, tip front / back, half span)
function default_shape()
  return {nose = 11, tail = -13, st = {{6, 1.5, -1.3, 1.5}, {1, 1.6, -1.4, 1.6}, {-5, 1.0, -0.6, 0.9}},
    rf = 3, rb = -1.5, tf = 1.8, tb = -0.6, span = 12}
end
function new_state()
  return {scrap = 0, own = {m1 = true, c1 = true, p1 = true, p2 = true, p3 = true}, sel = {m = 1, c = 1, p = 2},
    shape = default_shape(), coil = false, coil_told = false, satchel = false, done = false,
    got = {}, flights = 0, swims = 0}
end
function copy(t)
  if type(t) ~= "table" then return t end
  local o = {}
  for k, v in pairs(t) do o[k] = copy(v) end
  return o
end
function save_progress() checkpoint(copy(S)) end

-- the title screen (game{title_draw = ...}): your plane circles over the sea, with the Drowned Belltower on
-- the horizon. It is the plane from your save, in your paint, so it changes as you build.
local TITLE_M = nil
function draw_title(t)
  local g0 = gt
  gt = t * 3
  draw_sky(96, t * 0.2)
  gt = g0
  rectfill(0, 96, 320, 144, 20)
  for r = 0, 15 do                                            -- the sea
    local y = 98 + r * r * 0.55
    local gap = 18 + r * 5
    for x = -(t * (0.1 + r * 0.05)) % gap - gap, 320, gap do line(x, y, x + 2 + r, y, r % 2 == 0 and 21 or 22) end
  end
  sspr(240, 196, 96 - 40, 3, 8, 0.62)                         -- the Drowned Belltower, far away
  for i = 0, 2 do                                             -- pigeons
    local x = (i * 140 + t * 0.6) % 420 - 50
    local y = 40 + i * 13 + math.sin(t / 20 + i) * 3
    local w = (t // 6 + i) % 2 == 0 and 2 or -1
    line(x - 3, y - w, x, y, 1) line(x, y, x + 3, y - w, 1)
  end
  local s = S or new_state()
  if not TITLE_M then TITLE_M = plane_model(s.shape or default_shape()) end
  local paint = PAINTS[(s.sel and s.sel.p) or 2].c
  local v0 = {}
  for k, v in pairs(VIEW) do v0[k] = v end
  setview(0, 0, 0, 50, 96, 160, 160)
  local u = t / 170
  local P = { x = 52 + math.cos(u) * 10, y = 12 + math.sin(u) * 16, z = 36 + math.sin(u * 2) * 4,
              h = u + math.pi / 2, pitch = math.cos(u * 2) * 0.06, bank = 0.5 }
  local sx, sy, k = proj(P.x, P.y, 0)                         -- its shadow on the water
  if sx then for j = -2, 2 do rectfill(sx - (10 - j * j) * k, sy + j, (20 - j * j * 2) * k, 1, 19) end end
  draw_model(TITLE_M, P, paint, t * 0.9, true, 4.6)
  for k2, v in pairs(v0) do VIEW[k2] = v end
end

function _init()
  game{
    title = "Tinwing",
    title_draw = draw_title,          -- its own animated title screen (above)
    look = { title = 12, shadow = 19, panel = 19, edge = 22, hi = 20, text = 23, pick = 27, goal = 22, footer = 22, menu = "left" },
    goal = "Build an RC plane, find the mail satchel lost past the Drowned Belltower and fly it home to Perch.",
    help = {
      "Hangar: pick a corner with the D-pad, A grabs it, move it, A drops it. L / R or X: next page.",
      "Make the body big enough for your motor and battery. More wing glides, short wings turn quick.",
      "Flying: left / right turn, up / down climb and dive. Hold A or squeeze R for the motor.",
      "Let go of the motor to glide for free. Fly low over the yellow pad at Perch to land.",
    },
    continue = function(cp)
      if cp then S = copy(cp) end
      INTRO = false
      hangar_enter(nil)
    end,
    pause = {{"Back to the hangar", function() if MODE == "fly" then hangar_enter("menu") end end},
      {"Reset the blueprint", function() if MODE == "hangar" then S.shape = default_shape(); H.hold = nil end end}},
    settings = {{key = "pitch", name = "Up arrow", values = {"Climbs", "Dives"}, value = 1}},
  }
  S = new_state()
  INTRO = true
  gt, MSG, MSG_T = 0, nil, 0
  on("cutscene_end", function(name)
    if name == "rescue" and S.satchel and not S.done then deliver() end
  end)
  local L = LEVELS[LEVEL]
  WW, WH = L.w * 8, L.h * 8
  build_heights(L.w, L.h)
  hangar_enter(nil)
end

function msg(s, t) MSG, MSG_T = s, t or 150 end
function owned(key, i) return S.own[key .. i] == true end
function clamp(v, a, b) return math.max(a, math.min(b, v)) end
function ground(e) return e.x + e.w / 2, e.y + e.h / 2 end
function angdiff(a, b) return (a - b + math.pi) % TAU - math.pi end

-- what to do next
function objective()
  if S.done then return "Explore the Shallows. Scrap: " .. S.scrap end
  if S.satchel then return "Fly the satchel home to Perch!" end
  if not S.coil then return "Fly east, past the Drowned Belltower." end
  if S.sel.c ~= 2 then return "Widen the body and fit the Twin Cell." end
  return "Find the mail satchel out past the reef."
end

-- ------------------------------------------------------------------ the blueprint
-- the body's cross-section at x: {top, bottom, half width}, blended between the stations
function body_points(s)
  local l = {{s.nose, 0.35, 0.05, 0}}
  for _, st in ipairs(s.st) do l[#l + 1] = st end
  l[#l + 1] = {s.tail, 0.9, 0.5, 0.15}
  return l
end
function section(s, x)
  local l = body_points(s)
  if x >= l[1][1] or x <= l[#l][1] then return 0, 0, 0 end
  for i = 1, #l - 1 do
    local a, b = l[i], l[i + 1]
    if x <= a[1] and x >= b[1] then
      local t = (a[1] - x) / math.max(0.01, a[1] - b[1])
      return a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t
    end
  end
  return 0, 0, 0
end
-- where a part sits: the motor just behind the nose, the battery in the middle of the body
function slot(s, key, part)
  if key == "m" then local f = s.st[1][1] + 1.2 return f, f - part.len end
  local m = s.st[2][1]
  return m + part.len / 2, m - part.len / 2
end
-- does the part's box fit inside the body? returns ok, and the box's centre height
function fits(s, key, part)
  local x0, x1 = slot(s, key, part)
  local mid = 0
  for i = 0, 4 do local t, b = section(s, x0 + (x1 - x0) * i / 4) mid = mid + (t + b) / 10 end
  for i = 0, 4 do
    local t, b, w = section(s, x0 + (x1 - x0) * i / 4)
    if t < mid + part.h / 2 or b > mid - part.h / 2 or w * 2 < part.w then return false, mid end
  end
  return true, mid
end
function wing_root(s) local _, _, w = section(s, (s.rf + s.rb) / 2) return math.max(w, 0.5) end
function wing_area(s)
  local r = wing_root(s)
  return math.max(0, (s.span - r)) * ((s.rf - s.rb) + (s.tf - s.tb)) -- both wings: 2 x half span x mean chord
end
function body_volume(s)
  local l, v = body_points(s), 0
  for i = 1, #l - 1 do
    local a, b = l[i], l[i + 1]
    v = v + ((a[2] - a[3]) * a[4] + (b[2] - b[3]) * b[4]) * (a[1] - b[1])
  end
  return v
end

-- the numbers that make it fly
function plane_stats(s, sel)
  local m, c = MOTORS[sel.m], CELLS[sel.c]
  local area = wing_area(s)
  local weight = 1 + m.weight + c.weight + body_volume(s) * 0.004 + area * 0.004
  local lift = area / weight / 25.6                   -- 1 is a plain, nice wing
  local sweep = ((s.rf + s.rb) - (s.tf + s.tb)) / 2  -- how far back the tips sit
  return {
    speed = (m.power / weight * 2.85) ^ 0.6,
    turn = clamp((1.3 - (s.span - 12) * 0.045) * clamp(lift, 0.7, 1.15) * (1 + clamp(sweep, 0, 6) * 0.03), 0.5, 1.8),
    glide = clamp(lift, 0.3, 2.2),
    drain = m.power ^ 0.8 * weight / 2.85 / c.cap,
    cap = c.cap, lift = lift, weight = weight, prop = m.prop,
  }
end
-- what still stops the plane from flying
function problems()
  local s, l = S.shape, {}
  if not fits(s, "m", MOTORS[S.sel.m]) then l[#l + 1] = "The " .. MOTORS[S.sel.m].name .. " doesn't fit in the nose." end
  if not fits(s, "c", CELLS[S.sel.c]) then l[#l + 1] = "The " .. CELLS[S.sel.c].name .. " doesn't fit in the body." end
  if plane_stats(s, S.sel).lift < 0.55 then l[#l + 1] = "The wings are too small to lift her." end
  return l
end

-- ------------------------------------------------------------------ 3D helpers
-- VIEW is the camera floorh() was given, so proj() lines up with the floor
VIEW = {x = 0, y = 0, a = 0, z = 50, hor = 40, foc = 160, c = 1, s = 0, cx = 160}
function setview(x, y, a, z, hor, foc, cx)
  local v = VIEW
  v.x, v.y, v.a, v.z, v.hor, v.foc, v.cx = x, y, a, z, hor, foc, cx or 160
  v.c, v.s = math.cos(a), math.sin(a)
end
function proj(x, y, z)
  local v = VIEW
  local dx, dy = x - v.x, y - v.y
  local d = dx * v.c + dy * v.s
  if d < 1 then return nil end
  local k = v.foc / d
  return v.cx + (-dx * v.s + dy * v.c) * k, v.hor + (v.z - z) * k, k, d
end

-- a filled triangle, one rectfill per screen row
function tri(x1, y1, x2, y2, x3, y3, c)
  if y1 > y2 then x1, y1, x2, y2 = x2, y2, x1, y1 end
  if y1 > y3 then x1, y1, x3, y3 = x3, y3, x1, y1 end
  if y2 > y3 then x2, y2, x3, y3 = x3, y3, x2, y2 end
  if y3 - y1 < 0.5 then return end
  local ya, yb = math.max(math.ceil(y1 - 0.5), 0), math.min(math.floor(y3 - 0.5), 239)
  for y = ya, yb do
    local py = y + 0.5
    local xa = x1 + (x3 - x1) * (py - y1) / (y3 - y1)
    local xb
    if py < y2 then xb = x1 + (x2 - x1) * (py - y1) / (y2 - y1)
    elseif y3 > y2 then xb = x2 + (x3 - x2) * (py - y2) / (y3 - y2)
    else xb = x2 end
    if xa > xb then xa, xb = xb, xa end
    local l, r = math.ceil(xa - 0.5), math.floor(xb - 0.5)
    if r >= l then rectfill(l, y, r - l + 1, 1, c) end
  end
end

-- the 3D model, built from the blueprint. Points are {forward, right, up}; faces {a, b, c, role}
-- roles: 1 paint, 2 trim
function plane_model(s)
  local V, F = {}, {}
  local function v(a, b, c) V[#V + 1] = {a, b, c} return #V end
  local function quad(a, b, c, d, role) F[#F + 1] = {a, b, c, role}; F[#F + 1] = {a, c, d, role} end
  local nose = v(s.nose, 0, 0.2)
  local rings = {}
  for _, st in ipairs(s.st) do
    local mid = (st[2] + st[3]) / 2
    rings[#rings + 1] = {v(st[1], 0, st[2]), v(st[1], st[4], mid), v(st[1], 0, st[3]), v(st[1], -st[4], mid)}
  end
  local tail = v(s.tail, 0, 0.7)
  for k = 1, 4 do
    local r1, k2 = rings[1], k % 4 + 1
    F[#F + 1] = {nose, r1[k], r1[k2], 1}
    for i = 1, #rings - 1 do quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k], 1) end
    local rl = rings[#rings]
    F[#F + 1] = {tail, rl[k2], rl[k], 1}
  end
  local r, z, dz = wing_root(s), 0.3, s.span * 0.05
  for side = -1, 1, 2 do
    quad(v(s.rf, r * side, z), v(s.rb, r * side, z), v(s.tb, s.span * side, z + dz), v(s.tf, s.span * side, z + dz), 1)
    quad(v(s.tail + 3.5, 0.5 * side, 0.8), v(s.tail + 0.6, 0.5 * side, 0.8), v(s.tail + 0.2, 4.6 * side, 1), v(s.tail + 1.8, 4.6 * side, 1), 2)
  end
  F[#F + 1] = {v(s.tail + 4.5, 0, 1.0), v(s.tail + 0.5, 0, 0.8), v(s.tail - 0.1, 0, 5), 2}
  return {v = V, f = F, nose = s.nose}
end

-- a point on the plane {forward, right, up} to the world, with the plane at P = {x, y, z, h, pitch, bank}
function body_to_world(P, a, b, c)
  local b1, c1 = b * P.cr + c * P.sr, c * P.cr - b * P.sr
  local a2, c2 = a * P.cp - c1 * P.sp, a * P.sp + c1 * P.cp
  return P.x + a2 * P.ch - b1 * P.sh, P.y + a2 * P.sh + b1 * P.ch, P.z + c2
end
function orient(P)
  P.ch, P.sh = math.cos(P.h), math.sin(P.h)
  P.cp, P.sp = math.cos(P.pitch), math.sin(P.pitch)
  P.cr, P.sr = math.cos(P.bank), math.sin(P.bank)
end

SUN = {-0.35, -0.45, 0.82}
function draw_model(M, P, p, spin, fast, prop)
  orient(P)
  local W, S2 = {}, {}
  for i, v in ipairs(M.v) do
    local x, y, z = body_to_world(P, v[1], v[2], v[3])
    W[i] = {x, y, z}
    local sx, sy, k, d = proj(x, y, z)
    S2[i] = sx and {sx, sy, d} or false
  end
  local list = {}
  for _, f in ipairs(M.f) do
    local a, b, c = S2[f[1]], S2[f[2]], S2[f[3]]
    if a and b and c then
      local A, B, C = W[f[1]], W[f[2]], W[f[3]]
      local ux, uy, uz = B[1] - A[1], B[2] - A[2], B[3] - A[3]
      local vx, vy, vz = C[1] - A[1], C[2] - A[2], C[3] - A[3]
      local nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
      local l = math.sqrt(nx * nx + ny * ny + nz * nz) + 0.0001
      local lit = math.abs((nx * SUN[1] + ny * SUN[2] + nz * SUN[3]) / l)
      local col
      if f[4] == 1 then col = lit > 0.55 and p[1] or p[2]
      else col = lit > 0.45 and p[3] or 30 end
      list[#list + 1] = {d = a[3] + b[3] + c[3], a = a, b = b, c = c, col = col}
    end
  end
  table.sort(list, function(u, v) return u.d > v.d end)
  for _, t in ipairs(list) do tri(t.a[1], t.a[2], t.b[1], t.b[2], t.c[1], t.c[2], t.col) end
  -- the propeller on the nose: a bigger motor turns a bigger prop
  local px, py, k = proj(body_to_world(P, M.nose + 0.6, 0, 0.2))
  if px then
    local r = (prop or 4.6) * k
    if fast then circ(px, py, r, 29) end
    local bx, by = math.cos(spin) * r, math.sin(spin) * r * 0.9
    line(px - bx, py - by, px + bx, py + by, 30)
    circfill(px, py, math.max(1, 0.8 * k), 31)
  end
end

-- ------------------------------------------------------------------ sky and sea
function draw_sky(hor, off)
  local bands = {20, 21, 21, 22, 22, 23}
  local h = math.max(1, hor)
  for i = 0, 5 do rectfill(0, i * h // 6, 320, h // 6 + 1, bands[i + 1]) end
  for i = 0, 6 do
    local cx = ((i * 157 - off + gt * 0.04) % 520) - 100
    local cy = 10 + (i * 41) % math.max(8, hor - 22)
    circfill(cx, cy, 8, 13); circfill(cx + 10, cy + 2, 6, 13); circfill(cx - 9, cy + 3, 5, 13)
    rectfill(cx - 12, cy + 4, 26, 4, 13)
  end
  for i = 0, 9 do
    local x = ((i * 97 - off * 1.3) % 560) - 120
    local w = 12 + (i * 13) % 26
    rectfill(x, hor - 2 - (i % 3), w, 3 + (i % 3), 14)
  end
end
-- water tiles have glints in colours 22 / 23; swapping them makes the sea shimmer
function water_pal()
  if (gt // 20) % 2 == 0 then pal(23, 20) else pal(22, 20) end
end

-- island heights from the tiles: base height, and how much it rises per tile away from the water
LANDH = {[4] = 2, [5] = 6, [6] = 6, [7] = 10, [8] = 3, [9] = 3, [10] = 3, [11] = 4, [12] = 4, [13] = 3, [18] = 3, [19] = 3, [20] = 3, [21] = 3}
RISE = {[5] = 3, [6] = 3, [7] = 6}
function build_heights(W, H)
  local d = {}
  for y = 0, H - 1 do
    for x = 0, W - 1 do d[y * W + x] = LANDH[mget(x, y)] and 99 or 0 end
  end
  for y = 1, H - 1 do
    for x = 1, W - 1 do
      local i = y * W + x
      if d[i] > 0 then d[i] = math.min(d[i], d[i - 1] + 1, d[i - W] + 1) end
    end
  end
  for y = H - 2, 0, -1 do
    for x = W - 2, 0, -1 do
      local i = y * W + x
      if d[i] > 0 then d[i] = math.min(d[i], d[i + 1] + 1, d[i + W] + 1) end
    end
  end
  local th = {}
  MINI = {}
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local i = y * W + x
      local t = mget(x, y)
      local b = LANDH[t]
      th[i] = b and (b + math.min(d[i] - 1, 7) * (RISE[t] or 0)) or 0
      if b and x % 4 == 0 and y % 4 == 0 then MINI[#MINI + 1] = {x // 4, y // 4, (t == 7) and 28 or ((t == 11 or t == 12) and 25 or 16)} end
    end
  end
  for cy = 0, H do
    for cx = 0, W do
      local s = 0
      if cx > 0 and cy > 0 then s = s + th[(cy - 1) * W + cx - 1] end
      if cx < W and cy > 0 then s = s + th[(cy - 1) * W + cx] end
      if cx > 0 and cy < H then s = s + th[cy * W + cx - 1] end
      if cx < W and cy < H then s = s + th[cy * W + cx] end
      hset(cx, cy, math.floor(s / 4 + 0.5))
    end
  end
end

-- ------------------------------------------------------------------ the hangar
function hangar_enter(reason)
  MODE = "hangar"
  stop(7)
  H = H or {tab = 1, sel = {1, 1}, hold = nil, rep = 0, view = {m = S.sel.m, c = S.sel.c, p = S.sel.p}, spin = 0.6, note = nil, note_t = 0}
  H.view = {m = S.sel.m, c = S.sel.c, p = S.sel.p}
  H.hold = nil
  H.row = H.row or 1
  if reason == "land" then
    S.flights = S.flights + 1
    if S.satchel and not S.done then deliver() return end
    if S.coil and not S.coil_told then S.coil_told = true; cutscene("coil_home")
    else note("Landed! " .. objective()) end
    save_progress()
  elseif reason == "swim" then
    S.swims = S.swims + 1
    cutscene("rescue")
    save_progress()
  elseif reason == "menu" then
    save_progress()
  end
end
function note(s, t) H.note, H.note_t = s, t or 180 end

function deliver()
  S.done = true
  cutscene("ending")
  game_win("You flew the lost mail home to Perch.")
  save_progress()
end

-- blueprint views: 1 side (x right, height up), 2 top (forward up, sideways right)
BP = {x = 6, y = 30, w = 202, h = 140, cx = 107, cy = 100}
function bp_xy(view, u, v)
  if view == 1 then return BP.cx + (u + 1) * 7, BP.cy - v * 7 end
  return BP.cx + u * 5.5, BP.cy - (v + 1) * 5.5
end

-- the corners you can grab in each view: get() gives (u, v), set(du, dv) moves it, staying sensible
function handles(view)
  local s, L = S.shape, {}
  local function add(name, get, set) L[#L + 1] = {name = name, get = get, set = set} end
  local function limits(i)
    local lo = i < 3 and s.st[i + 1][1] + 1.5 or s.tail + 2
    local hi = i > 1 and s.st[i - 1][1] - 1.5 or s.nose - 1.5
    return lo, hi
  end
  if view == 1 then
    add("Nose", function() return s.nose, 0.2 end, function(du) s.nose = clamp(s.nose + du, s.st[1][1] + 1.5, 17) end)
    for i, st in ipairs(s.st) do
      add(SNAME[i] .. " top", function() return st[1], st[2] end,
        function(du, dv) local lo, hi = limits(i) st[1] = clamp(st[1] + du, lo, hi); st[2] = clamp(st[2] + dv, st[3] + 0.6, 4.5) end)
      add(SNAME[i] .. " bottom", function() return st[1], st[3] end,
        function(du, dv) local lo, hi = limits(i) st[1] = clamp(st[1] + du, lo, hi); st[3] = clamp(st[3] + dv, -4.5, st[2] - 0.6) end)
    end
    add("Tail", function() return s.tail, 0.8 end, function(du) s.tail = clamp(s.tail + du, -18, s.st[3][1] - 2) end)
  else
    for i, st in ipairs(s.st) do
      add(SNAME[i] .. " width", function() return st[4], st[1] end,
        function(du, dv) local lo, hi = limits(i) st[4] = clamp(st[4] + du, 0.5, 4.5); st[1] = clamp(st[1] + dv, lo, hi) end)
    end
    add("Wing root, front", function() return wing_root(s), s.rf end, function(du, dv) s.rf = clamp(s.rf + dv, s.rb + 1, s.nose - 1) end)
    add("Wing root, back", function() return wing_root(s), s.rb end, function(du, dv) s.rb = clamp(s.rb + dv, s.tail + 3, s.rf - 1) end)
    add("Wing tip, front", function() return s.span, s.tf end,
      function(du, dv) s.span = clamp(s.span + du, 5, 20); s.tf = clamp(s.tf + dv, s.tb + 0.6, s.rf + 6) end)
    add("Wing tip, back", function() return s.span, s.tb end,
      function(du, dv) s.span = clamp(s.span + du, 5, 20); s.tb = clamp(s.tb + dv, s.rb - 9, s.tf - 0.6) end)
  end
  return L
end

-- move the selection to the nearest corner in a direction on screen
function pick_dir(view, L, cur, dx, dy)
  local ax, ay = bp_xy(view, L[cur].get())
  local best, bs = cur, 1e9
  for i, h in ipairs(L) do
    if i ~= cur then
      local x, y = bp_xy(view, h.get())
      local ex, ey = x - ax, y - ay
      local along = ex * dx + ey * dy
      local side = math.abs(ex * dy - ey * dx)
      if along > 0.5 then
        local score = along + side * 2
        if score < bs then best, bs = i, score end
      end
    end
  end
  return best
end

function dirs()
  local dx = (btn("right") and 1 or 0) - (btn("left") and 1 or 0)
  local dy = (btn("down") and 1 or 0) - (btn("up") and 1 or 0)
  return dx, dy
end

function hangar_update()
  local was = cutscene_playing()
  ents_update()                    -- runs the cutscenes
  if MODE ~= "hangar" then return end
  H.spin = H.spin + 0.012
  if H.note_t > 0 then H.note_t = H.note_t - 1 end
  if INTRO and not was then INTRO = false; cutscene("intro"); save_progress() return end
  if was or cutscene_playing() then return end
  local tab = H.tab
  local next_tab = (btnp("r") or btnp("x")) and 1 or (btnp("l") and -1 or 0)
  if next_tab ~= 0 then
    H.tab, H.hold, H.note_t = (tab - 1 + next_tab) % #TABS + 1, nil, 0
    H.view = {m = S.sel.m, c = S.sel.c, p = S.sel.p}
    sfx("E5", 4, 0.2, 4)
    return
  end
  if tab <= 2 then
    local L = handles(tab)
    local cur = math.min(H.sel[tab], #L)
    local dx, dy = dirs()
    if H.hold then
      -- a grabbed corner moves a quarter step per press, faster while held
      if dx ~= 0 or dy ~= 0 then H.rep = H.rep + 1 else H.rep = 0 end
      if H.rep == 1 or (H.rep > 12 and H.rep % 2 == 0) then
        L[cur].set(dx * 0.25, -dy * 0.25)
        if H.rep % 6 == 1 then sfx("A4", 4, 0.08, 2) end
      end
      if btnp("a") or btnp("b") then H.hold = nil; sfx("C5", 1, 0.2, 4); save_progress() end
    else
      local mx = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
      local my = (btnp("down") and 1 or 0) - (btnp("up") and 1 or 0)
      if mx ~= 0 or my ~= 0 then
        local n = pick_dir(tab, L, cur, mx, my)
        if n ~= cur then sfx("E5", 4, 0.12, 3) end
        cur = n
      end
      if btnp("a") then H.hold = true; H.rep = 2; sfx("G5", 1, 0.2, 4) end
    end
    H.sel[tab] = cur
  elseif tab == 3 then
    H.row = H.row or 1
    if btnp("up") then H.row = (H.row - 2) % #PARTS + 1; sfx("E5", 4, 0.15, 3) end
    if btnp("down") then H.row = H.row % #PARTS + 1; sfx("E5", 4, 0.15, 3) end
    local r = PARTS[H.row]
    local key, list = r[3], r[2]
    local d = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
    if d ~= 0 then
      H.view[key] = (H.view[key] - 1 + d) % #list + 1
      sfx("A5", 4, 0.15, 3)
    end
    if btnp("a") then
      local i = H.view[key]
      local part = list[i]
      if owned(key, i) then
        S.sel[key] = i
        note(part.name .. " fitted.", 90); sfx("C6", 1, 0.25, 6)
      elseif part.cost < 0 then note("You'll have to find that one out there.", 150); sfx("C4", 2, 0.3, 8)
      elseif S.scrap >= part.cost then
        S.scrap = S.scrap - part.cost
        S.own[key .. i] = true
        S.sel[key] = i
        note("Bought and fitted the " .. part.name .. "!", 120); sfx("C6", 1, 0.3, 10)
      else note("You need " .. part.cost .. " scrap for that.", 150); sfx("C4", 2, 0.3, 8) end
      save_progress()
    end
  else
    if btnp("a") then
      local p = problems()
      if #p > 0 then note(p[1], 180); sfx("C4", 2, 0.3, 8)
      else save_progress(); fly_start() end
    end
  end
end

-- the blueprint drawing: body, wings, the boxes the parts need and the corners you can grab
function draw_blueprint(view)
  local s = S.shape
  rectfill(BP.x, BP.y, BP.w, BP.h, 19)
  clip(BP.x, BP.y, BP.w, BP.h)
  for x = BP.cx % 10, BP.x + BP.w, 10 do rectfill(x, BP.y, 1, BP.h, 20) end
  for y = BP.cy % 10, BP.y + BP.h, 10 do rectfill(BP.x, y, BP.w, 1, 20) end
  local paint = PAINTS[S.sel.p].c
  local l = body_points(s)
  if view == 1 then
    -- the wing seen from the side, then the body as quads between the stations
    local x1, y1 = bp_xy(1, s.rf, 0.3) local x2, y2 = bp_xy(1, s.rb, 0.3)
    rectfill(x2, y1 - 1, x1 - x2, 3, paint[2])
    local fx1, fy1 = bp_xy(1, s.tail + 4.5, 1) local fx2, fy2 = bp_xy(1, s.tail - 0.1, 5) local fx3, fy3 = bp_xy(1, s.tail + 0.5, 0.8)
    tri(fx1, fy1, fx2, fy2, fx3, fy3, paint[3])
    for i = 1, #l - 1 do
      local a, b = l[i], l[i + 1]
      local ax, at = bp_xy(1, a[1], a[2]) local _, ab = bp_xy(1, a[1], a[3])
      local bx, bt = bp_xy(1, b[1], b[2]) local _, bb = bp_xy(1, b[1], b[3])
      tri(ax, at, bx, bt, bx, bb, paint[1]); tri(ax, at, bx, bb, ax, ab, paint[1])
      line(ax, at, bx, bt, 13); line(ax, ab, bx, bb, 13)
    end
  else
    local r = wing_root(s)
    for side = -1, 1, 2 do
      local p1x, p1y = bp_xy(2, r * side, s.rf) local p2x, p2y = bp_xy(2, r * side, s.rb)
      local p3x, p3y = bp_xy(2, s.span * side, s.tb) local p4x, p4y = bp_xy(2, s.span * side, s.tf)
      tri(p1x, p1y, p2x, p2y, p3x, p3y, paint[2]); tri(p1x, p1y, p3x, p3y, p4x, p4y, paint[2])
      line(p1x, p1y, p4x, p4y, 13); line(p4x, p4y, p3x, p3y, 13); line(p3x, p3y, p2x, p2y, 13)
      local t1x, t1y = bp_xy(2, 0.5 * side, s.tail + 3.5) local t2x, t2y = bp_xy(2, 4.6 * side, s.tail + 1.8)
      local t3x, t3y = bp_xy(2, 4.6 * side, s.tail + 0.2)
      tri(t1x, t1y, t2x, t2y, t3x, t3y, paint[3])
    end
    for i = 1, #l - 1 do
      local a, b = l[i], l[i + 1]
      local arx, ay = bp_xy(2, a[4], a[1]) local alx = bp_xy(2, -a[4], a[1])
      local brx, by = bp_xy(2, b[4], b[1]) local blx = bp_xy(2, -b[4], b[1])
      tri(alx, ay, arx, ay, brx, by, paint[1]); tri(alx, ay, brx, by, blx, by, paint[1])
      line(arx, ay, brx, by, 13); line(alx, ay, blx, by, 13)
    end
  end
  -- the parts' boxes: green when they fit, red when the body is too small
  for _, it in ipairs({{"m", MOTORS[S.sel.m], "M"}, {"c", CELLS[S.sel.c], "B"}}) do
    local part = it[2]
    local ok, mid = fits(s, it[1], part)
    local x0, x1 = slot(s, it[1], part)
    local col = ok and 17 or (gt % 20 < 12 and 26 or 25)
    local ax, ay, bx, by
    if view == 1 then ax, ay = bp_xy(1, x1, mid + part.h / 2) bx, by = bp_xy(1, x0, mid - part.h / 2)
    else ax, ay = bp_xy(2, -part.w / 2, x0) bx, by = bp_xy(2, part.w / 2, x1) end
    rect(ax, ay, bx - ax + 1, by - ay + 1, col)
    text(it[3], (ax + bx) / 2 - 3, (ay + by) / 2 - 3, col)
  end
  -- the corners
  local L = handles(view)
  for i, h in ipairs(L) do
    local x, y = bp_xy(view, h.get())
    local on = H.sel[view] == i
    if view == 2 and h.name:find("width") then local mx = bp_xy(2, -h.get(), 0) rect(mx - 1, y - 1, 3, 3, 29) end
    if on then
      local c = H.hold and 27 or 13
      rect(x - 3, y - 3, 7, 7, c)
      if H.hold and gt % 20 < 10 then rect(x - 4, y - 4, 9, 9, 10) end
    else rectfill(x - 1, y - 1, 3, 3, 27) end
  end
  clip()
  local h = L[math.min(H.sel[view], #L)]
  if h then text((H.hold and "Moving: " or "") .. h.name, BP.x + 4, BP.y + BP.h - 10, H.hold and 27 or 29) end
end

-- bars for what the plane is like; cols = 2 lays them out in two columns
function stat_bars(x, y, cols)
  local st = plane_stats(S.shape, S.sel)
  local bars = {{"Speed", st.speed / 1.6}, {"Turning", st.turn / 1.6}, {"Glide", st.glide / 1.8}, {"Range", st.cap / st.drain / 2.4}}
  for i, b in ipairs(bars) do
    local bx, by = x, y + (i - 1) * 11
    if cols == 2 then bx, by = x + ((i - 1) % 2) * 150, y + ((i - 1) // 2) * 11 end
    text(b[1], bx, by, 12)
    rectfill(bx + 58, by, 40, 7, 31)
    rectfill(bx + 58, by, math.floor(40 * clamp(b[2], 0.04, 1)), 7, b[2] < 0.35 and 26 or 17)
  end
end

function hangar_draw()
  cls(6)
  for x = 0, 319, 16 do rectfill(x, 0, 1, 240, 7) end
  rectfill(0, 0, 320, 13, 1)
  text("PIP'S HANGAR", 6, 3, 27)
  sspr(120, 268, 1, 2, 2, 0.75)
  text("x" .. S.scrap, 282, 3, 13)
  -- page tabs
  for i, t in ipairs(TABS) do
    local x = 6 + (i - 1) * 51
    local on = H.tab == i
    rectfill(x, 16, 49, 11, on and 27 or 31)
    text(t, x + 25 - #t * 4, 18, on and 1 or 29)
  end
  text("L/R", 212, 18, 29)
  if H.tab <= 2 then draw_blueprint(H.tab)
  else
    -- the plane, slowly turning on its stand
    rectfill(BP.x, BP.y, BP.w, BP.h, 31)
    clip(BP.x, BP.y, BP.w, BP.h)
    setview(-48, 0, 0, 9, 44, 190, BP.cx)
    local P = {x = 0, y = 0, z = 0, h = H.spin, pitch = 0.1, bank = math.sin(H.spin * 2) * 0.12}
    draw_model(plane_model(S.shape), P, PAINTS[(H.tab == 3 and H.row == 3) and H.view.p or S.sel.p].c, gt * 0.6, true, MOTORS[S.sel.m].prop)
    clip()
    if H.tab == 3 then draw_parts() else draw_fly() end
  end
  -- right column: a small 3D view (on the blueprint pages) and the numbers
  if H.tab <= 2 then
    rectfill(214, 30, 100, 70, 31)
    clip(214, 30, 100, 70)
    setview(-60, -40, 0.6, 22, 40, 170, 264)
    local P = {x = 0, y = 0, z = 0, h = H.spin * 2, pitch = 0.05, bank = 0}
    draw_model(plane_model(S.shape), P, PAINTS[S.sel.p].c, gt * 0.6, false, MOTORS[S.sel.m].prop)
    clip()
    text(MOTORS[S.sel.m].name, 216, 104, fits(S.shape, "m", MOTORS[S.sel.m]) and 17 or 26)
    text(CELLS[S.sel.c].name, 216, 114, fits(S.shape, "c", CELLS[S.sel.c]) and 17 or 26)
    stat_bars(216, 128)
  end
  rectfill(0, 174, 320, 66, 1)
  local hint = ({"Pick a corner: D-pad. A: grab / drop.", "Pick a corner: D-pad. A: grab / drop.",
    "Up / down: part. Left / right: browse. A: fit.", "A: launch from the ramp!"})[H.tab]
  text(objective(), 6, 178, 27)
  if H.note and H.note_t > 0 then text(H.note, 6, 190, 13) else text(hint, 6, 190, 29) end
  if H.tab == 3 then stat_bars(6, 206, 2)
  else
    local p = problems()
    for i = 1, math.min(3, #p) do text(p[i], 6, 192 + i * 11, 26) end
    if #p == 0 then text("She's ready to fly.", 6, 203, 17) end
  end
end

function draw_parts()
  local y = 34
  for i, r in ipairs(PARTS) do
    local key, list = r[3], r[2]
    local v = H.view[key]
    local part = list[v]
    local on = H.row == i
    rectfill(214, y, 102, 34, on and 1 or 31)
    if on then rect(214, y, 102, 34, 27) end
    text(r[1], 218, y + 3, 29)
    local col = owned(key, v) and 13 or 28
    text(part.name, 218, y + 13, S.sel[key] == v and 27 or col)
    if key == "p" then rectfill(298, y + 3, 12, 7, part.c[1])
    else
      local ok = fits(S.shape, key, part)
      text(ok and "fits" or "big!", 280, y + 3, ok and 17 or 26)
    end
    local tag
    if S.sel[key] == v then tag = "fitted"
    elseif owned(key, v) then tag = "A: fit"
    elseif part.cost < 0 then tag = "find it"
    else tag = part.cost .. " scrap" end
    text(tag, 218, y + 23, tag == "fitted" and 17 or (part.cost and part.cost > S.scrap and not owned(key, v) and 26 or 29))
    y = y + 38
  end
  local r = PARTS[H.row]
  local part = r[2][H.view[r[3]]]
  if part.about then text(part.about, 10, 150, 13) end
  if part.len then text(string.format("needs %.1f long, %.1f tall, %.1f wide", part.len, part.h, part.w), 10, 160, 29) end
end

function draw_fly()
  local p = problems()
  local y = 40
  text("PRE-FLIGHT CHECK", 218, y, 27)
  local checks = {
    {"Motor fits", fits(S.shape, "m", MOTORS[S.sel.m])}, {"Battery fits", fits(S.shape, "c", CELLS[S.sel.c])},
    {"Wings lift", plane_stats(S.shape, S.sel).lift >= 0.55},
  }
  for i, c in ipairs(checks) do
    text((c[2] and "+ " or "x ") .. c[1], 218, y + 6 + i * 12, c[2] and 17 or 26)
  end
  if #p == 0 then
    rectfill(218, 110, 92, 16, gt % 30 < 20 and 27 or 10)
    text("A: FLY!", 236, 114, 1)
  end
  stat_bars(214, 136)
end

-- ------------------------------------------------------------------ flying
function pick_z(e)
  local gx, gy = ground(e)
  if e.name == "coil" then return 64 * K_FLY + 10 end           -- on top of the Belltower
  if e.name == "satchel" then return 40 * K_FLY + 4 end         -- snagged on the wreck's mast
  if e.name == "ring" then return 34 + (gx * 7 + gy * 3) % 46 end
  return hget(gx, gy) + 4 + math.sin((gt + gx) * 0.06) * 1.5
end
function key_of(e) return e.name .. math.floor(e.x) .. "," .. math.floor(e.y) end

function fly_start()
  MODE = "fly"
  plane = ents_get("tinwing")
  local pad = ents_get("pad") or plane
  PAD = {}
  PAD.x, PAD.y = ground(pad)
  local st = plane_stats(S.shape, S.sel)
  stat_set(plane, "speed", st.speed)
  fx_clear(plane)
  MODEL = plane_model(S.shape)
  PAINT = PAINTS[S.sel.p].c
  local px, py = ground(plane)
  P = {x = px, y = py, z = hget(px, py) + 5, h = -math.pi / 4, pitch = 0.3, bank = 0, bv = 0, pv = 0, spd = 1.0, bat = 1, thr = 1,
    st = st, armed = false, launch = 50, t = 0, flat = false, out = 0, spin = 0, swim = 0, camp = 0.3}
  P.cam, P.cz, P.foc = P.h, P.z + F_UP, F_FOC
  for _, e in ipairs(ents_all()) do
    if PICK[e.name] and e.name ~= "ring" and S.got[key_of(e)] then e.alive = false end
    if e.name == "coil" and S.coil then e.alive = false end
    if e.name == "satchel" and S.satchel then e.alive = false end
  end
  SPRAY, TRAIL = {}, {}
  if S.flights == 0 and S.swims == 0 then msg("Hold A for the motor, let go to glide.", 240) else msg(objective(), 200) end
end

function spray(n)
  for i = 1, n do
    SPRAY[#SPRAY + 1] = {x = P.x, y = P.y, z = 2, vx = math.cos(i * 2.4) * 0.8, vy = math.sin(i * 2.4) * 0.8, vz = 1 + (i % 3) * 0.5}
  end
  sfx("C3", 3, 0.4, 12)
end

function fly_update()
  ents_update()
  if MODE ~= "fly" or not P then return end
  P.t = P.t + 1
  if MSG_T > 0 then MSG_T = MSG_T - 1 end
  for i = #SPRAY, 1, -1 do
    local s = SPRAY[i]
    s.x, s.y, s.z, s.vz = s.x + s.vx, s.y + s.vy, s.z + s.vz, s.vz - 0.12
    if s.z < 0 then table.remove(SPRAY, i) end
  end
  if P.swim > 0 then          -- splashed down: bob on the water, then Tobin's boat comes
    P.swim = P.swim + 1
    P.z, P.spd, P.bank, P.pitch = 0.5 + math.sin(P.swim * 0.1) * 0.4, 0, math.sin(P.swim * 0.05) * 0.2, -0.1
    if P.swim > 150 then hangar_enter("swim") end
    return
  end
  local st = P.st
  local inv = setting("pitch") == 2 and -1 or 1
  local lr = (btn("right") and 1 or 0) - (btn("left") and 1 or 0)
  local ud = ((btn("up") and 1 or 0) - (btn("down") and 1 or 0)) * inv
  local thr = btn("a") and 1 or press("r") / 255
  if P.launch > 0 then         -- off the ramp: full power, nose up
    P.launch = P.launch - 1
    lr, ud, thr = 0, 0.6, 1
    if P.launch == 49 then sfx("G4", 2, 0.3, 30, nil, 0, 400) end
  end
  if P.bat <= 0 then
    thr = 0
    if not P.flat then P.flat = true; msg("Battery flat! Glide home if you can...", 240); sfx("C4", 2, 0.4, 30, nil, 0, -300) end
  end
  -- springs on bank and pitch: the stick eases the plane in and out of turns, never a snap
  P.thr = P.thr + (thr - P.thr) * 0.12
  P.bv = (P.bv + (lr * 0.75 - P.bank) * 0.018) * 0.86
  P.bank = P.bank + P.bv
  P.pv = (P.pv + (ud * 0.5 - P.pitch) * 0.014) * 0.86
  P.pitch = P.pitch + P.pv
  local spd_k = stat(plane, "speed")      -- the parts' speed, times the Tailwind effect
  P.h = P.h + P.bank * BASE_TURN * st.turn * clamp(P.spd / BASE_SPEED, 0.6, 1.3)
  local want = BASE_SPEED * spd_k * (0.55 + 0.45 * P.thr) - P.pitch * 0.9
  P.spd = clamp(P.spd + (want - P.spd) * 0.025, 0.4, 4)
  local vz = math.sin(P.pitch) * P.spd
  if P.thr < 0.35 then vz = vz - 0.3 / st.glide * (1 - P.thr / 0.35) end
  if P.spd < 0.7 then vz = vz - (0.7 - P.spd) * 0.8 end
  P.x = P.x + math.cos(P.h) * math.cos(P.pitch) * P.spd
  P.y = P.y + math.sin(P.h) * math.cos(P.pitch) * P.spd
  P.z = math.min(CEIL, P.z + vz)
  if P.z >= CEIL and MSG ~= "The radio won't reach any higher." then msg("The radio won't reach any higher.", 90) end
  P.bat = math.max(0, P.bat - P.thr * BASE_DRAIN * st.drain)
  P.spin = P.spin + 0.3 + P.thr * 1.2
  if gt % 4 == 0 then tone(70 + P.thr * 90 + P.spd * 20, 2, 0.03 + P.thr * 0.05, 6, 7) end
  -- the edge of the map: the wind turns you back, gently
  if P.x < 48 or P.y < 48 or P.x > WW - 48 or P.y > WH - 48 then
    local a = math.atan(WH / 2 - P.y, WW / 2 - P.x)
    P.h = P.h + clamp(angdiff(a, P.h), -0.03, 0.03)
    if P.out == 0 then msg("Strong winds out here. Turn back!", 120) end
    P.out = 60
  elseif P.out > 0 then P.out = P.out - 1 end
  -- the water, the islands and the Belltower push you back up instead of stopping you dead
  local g = hget(P.x, P.y)
  if P.z < g + 3 then
    if g < 1.5 then
      if P.flat or P.spd < 0.6 then splash_down() return end
      P.z, P.pv = 3.5, P.pv + 0.04
      P.bat = math.max(0, P.bat - 0.02)
      if P.t % 20 == 0 then spray(5) end
      if MSG_T <= 0 then msg("Skimming the waves! Nose up.", 90) end
    else
      P.z, P.pv, P.spd = g + 4, P.pv + 0.06, P.spd * 0.9
      P.bat = math.max(0, P.bat - 0.02)
      if MSG_T <= 0 then sfx("C2", 3, 0.4, 8); msg("Bump! Climb over the islands.", 90) end
    end
  end
  for _, e in ipairs(ents_all("tower")) do
    local gx, gy = ground(e)
    local dx, dy = P.x - gx, P.y - gy
    local d = math.sqrt(dx * dx + dy * dy)
    if d < 12 and P.z < 64 * K_FLY then
      P.x, P.y = gx + dx / (d + 0.01) * 12.5, gy + dy / (d + 0.01) * 12.5
      P.h = P.h + clamp(angdiff(math.atan(dy, dx), P.h), -0.2, 0.2)
      if MSG_T <= 0 then sfx("C2", 3, 0.4, 8); msg("Clang! Fly over the tower, not into it.", 100) end
    end
  end
  -- pickups
  for _, e in ipairs(ents_all()) do
    if PICK[e.name] then
      local gx, gy = ground(e)
      local dx, dy, dz = P.x - gx, P.y - gy, P.z - pick_z(e) - (e.name == "ring" and 0 or 9)
      local r = e.name == "ring" and 16 or 14
      if dx * dx + dy * dy + dz * dz < r * r then collect(e) end
    end
  end
  -- wingtip trails: a short ribbon of puffs that shows off every turn
  orient(P)
  if P.t % 2 == 0 then
    local span = S.shape.span
    for side = -1, 1, 2 do
      local x, y, z = body_to_world(P, S.shape.tb, span * side, 0.3 + span * 0.05)
      TRAIL[#TRAIL + 1] = {x, y, z, P.t}
    end
    while #TRAIL > 28 do table.remove(TRAIL, 1) end
  end
  -- landing: low over the pad, after flying somewhere
  local dpx, dpy = P.x - PAD.x, P.y - PAD.y
  local dp = math.sqrt(dpx * dpx + dpy * dpy)
  if dp > 120 then P.armed = true end
  if P.armed and dp < 30 and P.z < hget(PAD.x, PAD.y) + 26 then
    sfx("C5", 1, 0.3, 8); sfx("G5", 1, 0.3, 12)
    hangar_enter("land")
  end
end

function collect(e)
  if e.name == "ring" then
    if e.data.cd and gt < e.data.cd then return end
    e.data.cd = gt + 90
    fx_apply(plane, "tailwind")
    msg("Tailwind!", 60)
    sfx("E6", 4, 0.3, 8, nil, 0, 400)
    return
  end
  e.alive = false
  S.got[key_of(e)] = true
  if e.name == "crate" then
    S.scrap = S.scrap + 2
    msg("Scrap +2", 60)
    sfx("A5", 1, 0.3, 4); sfx("E6", 1, 0.3, 6)
  elseif e.name == "coil" then
    S.coil = true
    S.own.c2 = true
    msg("A TWIN CELL! Take it home to the hangar.", 300)
    sfx("C5", 4, 0.4, 10); sfx("E5", 4, 0.4, 14); sfx("G5", 4, 0.4, 18)
  elseif e.name == "satchel" then
    S.satchel = true
    msg("THE MAIL SATCHEL! Fly it home to Perch.", 300)
    sfx("C5", 4, 0.4, 10); sfx("F5", 4, 0.4, 14); sfx("A5", 4, 0.4, 18)
  end
end

function splash_down()
  P.swim = 1
  spray(10)
  msg("Sploosh. Tobin will fish you out...", 200)
  stop(7)
end

function fly_draw()
  if not P then return end
  -- the camera sits right behind the plane and pulls back as you speed up
  P.cam = P.cam + angdiff(P.h, P.cam) * 0.35   -- locked behind the plane, with just a touch of give
  P.cz = P.cz + (P.z + F_UP - P.cz) * 0.14
  P.foc = P.foc + (F_FOC / (1 + clamp(P.spd - BASE_SPEED, -0.6, 2) * 0.16) - P.foc) * 0.05
  P.camp = P.camp + (P.pitch - P.camp) * 0.1
  local ch, sh = math.cos(P.cam), math.sin(P.cam)
  local camx, camy = P.x - ch * F_BACK, P.y - sh * F_BACK
  local camz = math.max(P.cz, hget(camx, camy) + 6)
  local hor = F_HOR + math.floor(P.camp * 40)
  local foc = P.foc
  setview(camx, camy, P.cam, camz, hor, foc)
  draw_sky(hor, P.cam * foc)
  water_pal()
  floorh(camx, camy, P.cam, camz, hor, foc, 20, STEP)
  pal()
  local g = hget(P.x, P.y)
  local sx, sy, k = proj(P.x, P.y, g)
  if sx then ellipse(sx, sy, 9 * k, 19) end
  local list = {}
  for _, e in ipairs(ents_all()) do
    if DRAW[e.name] or e.name == "ring" or e.name == "pigeon" then
      local gx, gy = ground(e)
      local z = PICK[e.name] and pick_z(e) or hget(gx, gy)
      if e.name == "pigeon" then
        local a = gt * 0.02 + e.phase
        gx, gy, z = gx + math.cos(a) * 60, gy + math.sin(a) * 60, 50 + math.sin(a * 3) * 8
      end
      if e.name == "boat" then z = math.sin(gt * 0.05) end
      local px, py, kk, d = proj(gx, gy, z)
      if px and px > -200 and px < 520 and kk > 0.02 then list[#list + 1] = {e = e, sx = px, sy = py, k = kk, d = d} end
    end
  end
  table.sort(list, function(a, b) return a.d > b.d end)
  for _, it in ipairs(list) do
    depth(it.d)
    draw_sky_thing(it)
  end
  depth()
  for _, s in ipairs(SPRAY) do
    local x, y, k = proj(s.x, s.y, s.z)
    if x then circfill(x, y, math.max(1, k * 1.2), 23) end
  end
  for i, t in ipairs(TRAIL) do
    local x, y, k = proj(t[1], t[2], t[3])
    local age = P.t - t[4]
    if x and age < 28 then
      local c = age < 8 and 13 or (age < 18 and 23 or 22)
      if math.abs(P.bank) > 0.25 or P.spd > 1.9 or age < 6 then pset(x, y, c); if k > 1.5 then pset(x + 1, y, c) end end
    end
  end
  draw_model(MODEL, P, PAINT, P.spin, P.thr > 0.2, P.st.prop)
  -- speed lines at the edges when you're really moving
  local fast = P.spd - 1.75
  if fast > 0 then
    for i = 0, 13 do
      local a = i * 0.4488 + 0.2
      local r = 120 + ((gt * (5 + fast * 6) + i * 53) % 90)
      local len = 6 + fast * 14
      local cx, cy = 160 + math.cos(a) * r, hor + 30 + math.sin(a) * r * 0.75
      line(cx, cy, cx + math.cos(a) * len, cy + math.sin(a) * len * 0.75, i % 3 == 0 and 13 or 23)
    end
  end
  sky_hud()
end

function ellipse(x, y, w, c)
  local h = math.max(1, w * 0.3)
  for j = -h, h do
    local f = 1 - (j / (h + 0.5)) ^ 2
    local hw = w * math.sqrt(math.max(f, 0))
    rectfill(x - hw, y + j, hw * 2, 1, c)
  end
end

function draw_sky_thing(it)
  local e, k = it.e, it.k
  if e.name == "ring" then
    local r = 13 * k
    circ(it.sx, it.sy, r, 27); circ(it.sx, it.sy, r - 1, fx_has(plane, "tailwind") and 13 or 10)
    if r > 6 then circ(it.sx, it.sy, r + 1, 10) end
    return
  end
  if e.name == "pigeon" then
    sspr((gt // 5 + e.phase) % 2 == 0 and 127 or 142, it.sx - 4 * k, it.sy - 4 * k, 1, 1, k)
    return
  end
  local d = DRAW[e.name]
  local s = k * (PICK[e.name] and 1.3 or K_FLY)
  if e.name == "coil" or e.name == "satchel" then         -- a glow so you can spot them from far away
    local r = 10 * k + math.sin(gt * 0.15) * 2 * k + 2
    circ(it.sx, it.sy - 8 * s, r, 27)
    sspr(d.t, it.sx - d.w * 4 * s, it.sy - d.h * 8 * s, d.w, d.h, s)
    return
  end
  sspr(d.t, it.sx - d.w * 4 * s, it.sy - d.h * 8 * s + s, d.w, d.h, s)
end

function sky_hud()
  rectfill(4, 4, 64, 20, 1)
  text("BATT", 8, 7, 29)
  local c = P.bat > 0.5 and 17 or (P.bat > 0.2 and 27 or 26)
  rect(8, 15, 56, 6, 29)
  rectfill(9, 16, math.floor(54 * P.bat), 4, (P.bat < 0.2 and gt % 30 < 15) and 13 or c)
  if fx_has(plane, "tailwind") then text(">>", 44, 7, 27) end
  rectfill(4, 26, 64, 10, 1)
  text("ALT " .. math.floor(P.z), 8, 27, 13)
  sspr(120, 6, 40, 2, 2, 0.75)
  text("x" .. S.scrap, 20, 42, 13)
  local mx, my = 262, 4
  rectfill(mx - 1, my - 1, 52, 34, 1)
  rectfill(mx, my, 50, 32, 19)
  for _, p in ipairs(MINI or {}) do pset(mx + p[1], my + p[2], p[3]) end
  pset(mx + PAD.x // 32, my + PAD.y // 32, 27)
  for _, e in ipairs(ents_all("tower")) do local x, y = ground(e) rectfill(mx + x // 32, my + y // 32 - 1, 1, 2, 13) end
  if S.coil and not S.satchel then
    for _, e in ipairs(ents_all("wreck")) do local x, y = ground(e) if gt % 40 < 26 then pset(mx + x // 32, my + y // 32, 26) end end
  end
  if gt % 20 < 14 then
    local x, y = mx + P.x // 32, my + P.y // 32
    pset(x, y, 13); pset(x + math.cos(P.h) * 2, y + math.sin(P.h) * 2, 13)
  end
  if P.launch > 20 then text("LAUNCH!", 132, 60, 27) end
  if MSG and MSG_T > 0 then
    rectfill(0, 206, 320, 12, 1)
    text(MSG, 160 - #MSG * 4, 208, 27)
  end
end

-- ------------------------------------------------------------------ the frame
function _update()
  gt = gt + 1
  if MODE == "fly" then fly_update() else hangar_update() end
end

function _draw()
  if MODE == "fly" then fly_draw() else hangar_draw() end
end
`;

  // ------------------------------------------------------------------ pixel art, drawn in code
  // A grid is rows of palette colours (0 = see-through); outline() rings the shape in colour 31.
  const G = (w, h) => Array.from({ length: h }, () => new Array(w).fill(0));
  const fill = (g, x, y, w, h, c) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i >= 0 && i < g[j].length) g[j][i] = c;
  };
  const px = (g, x, y, c) => { if (g[y] && x >= 0 && x < g[y].length) g[y][x] = c; };
  function outline(g, col = 31) {
    const h = g.length, w = g[0].length, o = g.map(r => r.slice());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (g[y][x]) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx] && g[y + dy][x + dx] !== col);
      if (n) o[y][x] = col;
    }
    return o;
  }

  // people, 16x24, facing down / up / side (right), with an optional step frame
  function person(s, face, step) {
    const g = G(16, 24);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    if (face === 'side') {
      if (step) { R(4, 18, 2, 4, s.legs); R(10, 18, 2, 4, s.legs); R(3, 22, 3, 1, s.shoe); R(10, 22, 3, 1, s.shoe); R(6, 18, 4, 1, s.legs); }
      else { R(6, 18, 4, 4, s.legs); R(6, 22, 5, 1, s.shoe); }
    } else {
      const l = step ? 1 : 0;
      R(5, 18, 2, 4 - l, s.legs); R(9, 18, 2, 4, s.legs);
      R(5, 22 - l, 2, 1, s.shoe); R(9, 22, 2, 1, s.shoe);
    }
    R(4, 11, 8, 7, s.top); R(4, 16, 8, 2, s.topDark);
    if (face === 'side') {
      if (step) { R(8, 12, 2, 4, s.topDark); R(9, 16, 2, 1, s.skin); } else { R(7, 12, 2, 5, s.topDark); R(7, 17, 2, 1, s.skin); }
    } else {
      R(3, 12, 1, 5, s.topDark); R(12, 12, 1, 5, s.topDark); px(g, 3, 17, s.skin); px(g, 12, 17, s.skin);
    }
    // head
    R(4, 3, 8, 8, s.skin); [[4, 3], [11, 3], [4, 10], [11, 10]].forEach(([x, y]) => px(g, x, y, 0));
    if (face === 'down') {
      R(4, 2, 8, 3, s.hair); px(g, 4, 2, 0); px(g, 11, 2, 0); R(4, 5, 1, 3, s.hair); R(11, 5, 1, 3, s.hair);
      px(g, 6, 6, 1); px(g, 9, 6, 1); px(g, 7, 9, s.mouth || 7); px(g, 8, 9, s.mouth || 7);
      if (s.blush) { px(g, 5, 8, s.blush); px(g, 10, 8, s.blush); }
    } else if (face === 'up') {
      R(4, 2, 8, 9, s.hair); px(g, 4, 2, 0); px(g, 11, 2, 0); px(g, 4, 10, 0); px(g, 11, 10, 0);
    } else {
      R(4, 2, 8, 3, s.hair); px(g, 4, 2, 0); px(g, 11, 2, 0); R(4, 5, 3, 4, s.hair);
      px(g, 10, 6, 1); px(g, 12, 7, s.skin); px(g, 10, 9, s.mouth || 7);
    }
    if (s.scarf) {
      R(4, 11, 8, 2, s.scarf);
      if (face === 'down') R(9, 13, 2, 2, s.scarf); else if (face === 'up') R(6, 13, 2, 3, s.scarf); else R(3, 12, 2, 3, s.scarf);
    }
    if (s.goggles) {
      R(4, 4, 8, 1, 28);
      if (face === 'down') { R(5, 3, 2, 2, 22); R(9, 3, 2, 2, 22); }
      else if (face === 'side') R(9, 3, 3, 2, 22);
    }
    if (s.bun) R(face === 'side' ? 4 : 6, 0, 4, 2, s.hair);
    if (s.cap) {
      R(3, 1, 10, 3, s.cap); px(g, 3, 1, 0); px(g, 12, 1, 0);
      if (face === 'down') R(3, 4, 10, 1, s.capDark); else if (face === 'side') R(8, 4, 6, 1, s.capDark);
    }
    if (s.beard) {
      if (face === 'down') { R(4, 8, 8, 4, s.beard); px(g, 4, 11, 0); px(g, 11, 11, 0); px(g, 7, 9, 7); px(g, 8, 9, 7); }
      else if (face === 'side') R(8, 8, 4, 3, s.beard);
    }
    if (s.bird && face === 'down') { R(12, 9, 3, 2, 29); px(g, 14, 8, 30); px(g, 15, 8, 10); }
    return outline(g);
  }

  // houses on stilts, 32x40
  function house(o) {
    const g = G(32, 40);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (const x of [4, 15, 26]) R(x, 31, 2, 9, 6);
    R(3, 35, 26, 1, 6);
    R(3, 15, 26, 16, o.wall);
    for (let y = 17; y < 31; y += 3) R(3, y, 26, 1, o.wallDark);
    R(7, 19, 7, 6, 12); R(8, 20, 5, 4, 22); R(10, 20, 1, 4, 12); px(g, 9, 21, 23);
    R(19, 20, 6, 11, 6); px(g, 23, 25, 27);
    for (let y = 3; y <= 15; y++) {
      const inset = Math.round((15 - y) * 0.9);
      R(1 + inset, y, 30 - inset * 2, 1, (y % 3 === 0) ? o.roofDark : o.roof);
    }
    if (o.chimney) { R(22, 0, 3, 6, 28); R(22, 0, 3, 1, 30); }
    if (o.kind === 'loft') {
      for (const x of [9, 14, 19, 24]) { R(x - 1, 10, 3, 3, 31); }
      R(11, 1, 3, 2, 13); px(g, 13, 0, 30); R(18, 2, 3, 2, 29); px(g, 20, 1, 30);
      R(5, 15, 22, 4, 12); R(13, 16, 6, 2, 13); px(g, 15, 16, 25);
    }
    if (o.kind === 'shed') {
      R(16, 18, 10, 13, 31); R(17, 22, 8, 1, 29); R(20, 20, 2, 4, 10); R(16, 18, 10, 1, 6);
      R(6, 1, 1, 7, 30); R(3, 1, 7, 1, 28); R(3, 0, 2, 1, 10); R(8, 2, 2, 1, 10);
    }
    return outline(g);
  }

  function belltower() {
    const g = G(24, 64);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(4, 14, 16, 50, 29);
    for (let y = 16; y < 64; y += 4) { R(4, y, 16, 1, 28); px(g, (y / 4) % 2 ? 9 : 14, y + 2, 28); px(g, (y / 4) % 2 ? 9 : 14, y + 1, 28); }
    R(8, 18, 8, 12, 31); px(g, 8, 18, 29); px(g, 15, 18, 29);
    R(10, 21, 4, 5, 27); R(9, 25, 6, 1, 27); R(11, 26, 2, 1, 10); px(g, 11, 21, 13);
    R(10, 36, 4, 6, 31);
    for (let y = 0; y < 14; y++) { const w = 2 + Math.round(y * 1.45); R(12 - (w >> 1), y, w, 1, y % 3 === 2 ? 2 : 3); }
    R(11, 0, 2, 1, 27);
    for (let x = 4; x < 20; x++) { const top = 50 + ((x * 7) % 5); R(x, top, 1, 64 - top, (x % 3) ? 15 : 14); }
    return outline(g);
  }

  function wreck() {
    const g = G(24, 40);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(11, 0, 2, 34, 7); R(3, 6, 18, 2, 7);
    for (let y = 8; y < 26; y++) { const a = 4 + ((y * 5) % 3), b = 19 - ((y * 3) % 4); R(a, y, Math.max(0, b - a), 1, (y % 5 === 0) ? 29 : 12); }
    R(8, 14, 3, 3, 0); R(15, 20, 2, 2, 0); R(11, 8, 2, 18, 7);
    for (let y = 30; y < 40; y++) { const s = y - 30; R(1 + s, y, 22 - s * 1.2, 1, y < 33 ? 8 : 6); }
    R(4, 31, 16, 1, 7);
    return outline(g);
  }

  function palm() {
    const g = G(16, 24);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (let y = 9; y < 24; y++) { const x = 7 + Math.round(Math.sin(y * 0.25) * 1.5); R(x, y, 2, 1, (y % 3) ? 7 : 6); }
    const fronds = [[-7, 1], [-5, -2], [0, -4], [5, -2], [7, 1], [-4, 4], [4, 4]];
    for (const [dx, dy] of fronds) for (let t = 0; t <= 1; t += 0.12) {
      const x = Math.round(8 + dx * t), y = Math.round(8 + dy * t + t * t * 3);
      px(g, x, y, t > 0.5 ? 16 : 15); px(g, x, y + 1, 15);
    }
    R(7, 8, 3, 2, 8);
    return outline(g);
  }

  function boat() {
    const g = G(32, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (let y = 8; y < 15; y++) { const s = Math.max(0, y - 11); R(1 + s * 2, y, 30 - s * 4, 1, y === 8 ? 13 : (y < 11 ? 25 : 24)); }
    R(9, 3, 11, 5, 12); R(11, 4, 3, 2, 22); R(16, 4, 2, 2, 22); R(8, 2, 13, 1, 7);
    R(17, 0, 2, 2, 30);
    R(24, 4, 1, 4, 7); R(22, 4, 5, 1, 7);
    return outline(g);
  }

  function crate() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(2, 4, 12, 10, 7); R(2, 4, 12, 1, 6); R(2, 13, 12, 1, 6); R(2, 4, 1, 10, 6); R(13, 4, 1, 10, 6);
    for (let i = 0; i < 10; i++) px(g, 3 + i, 4 + i, 6);
    R(4, 2, 2, 2, 28); R(9, 1, 1, 3, 29); R(11, 3, 2, 1, 28);
    px(g, 3, 5, 29); px(g, 12, 5, 29); px(g, 3, 12, 29); px(g, 12, 12, 29);
    return outline(g);
  }

  function coil() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (const x of [3, 9]) {
      R(x, 4, 4, 10, 16); R(x, 4, 1, 10, 17); R(x + 3, 4, 1, 10, 15); R(x, 3, 4, 1, 29); R(x + 1, 2, 2, 1, 28);
      R(x, 9, 4, 1, 15); px(g, x + 2, 6, 27); px(g, x + 1, 7, 27); px(g, x + 2, 7, 27); px(g, x + 1, 8, 27);
    }
    R(7, 6, 2, 1, 25); R(7, 11, 2, 1, 25);
    return outline(g);
  }

  function satchel() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (let x = 3; x <= 12; x++) px(g, x, Math.round(6 - Math.sin((x - 3) / 9 * Math.PI) * 5), 6);
    R(9, 3, 5, 4, 13); px(g, 10, 4, 28); px(g, 11, 5, 28); px(g, 12, 4, 28);
    R(2, 6, 12, 8, 8); R(2, 6, 12, 4, 7); R(2, 9, 12, 1, 6); R(7, 9, 2, 2, 27);
    return outline(g);
  }

  function buoy() {
    const g = G(8, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(2, 6, 4, 8, 25); R(2, 9, 4, 2, 13); R(1, 13, 6, 2, 24); R(3, 3, 2, 3, 30); R(3, 1, 2, 2, 27);
    return outline(g);
  }

  function pigeon(f) {
    const g = G(8, 8);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(1, 3, 5, 3, 29); R(5, 2, 2, 2, 30); px(g, 7, 3, 10); px(g, 0, 4, 28); px(g, 6, 2, 1);
    if (f === 0) { R(2, 3, 3, 1, 28); px(g, 3, 6, 26); px(g, 4, 6, 26); }
    if (f === 1) R(2, 0, 3, 3, 28);
    if (f === 2) R(0, 2, 7, 1, 28);
    return outline(g);
  }

  // the home screen icon: a little plane seen from above
  function planeIcon() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(7, 1, 2, 14, 10); R(6, 3, 4, 5, 10); R(0, 5, 16, 3, 10); R(0, 7, 16, 1, 9);
    R(4, 13, 8, 2, 13); R(7, 3, 2, 2, 22); R(5, 0, 6, 1, 28);
    return outline(g);
  }

  // 8x8 floor tiles
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const TILES = {
    1: (x, y) => (x === 2 && y === 2) || (x === 6 && y === 6) ? 22 : (hash(x, y, 1) < 0.12 ? 21 : 20),
    2: (x, y) => (x === 5 && y === 1) || (x === 1 && y === 5) ? 23 : (hash(x, y, 2) < 0.12 ? 21 : 20),
    3: (x, y) => (x === 3 && y === 4) ? 23 : (hash(x, y, 3) < 0.2 ? 22 : 21),
    4: (x, y) => hash(x, y, 4) < 0.15 ? 12 : (hash(x, y, 5) < 0.1 ? 10 : 11),
    5: (x, y) => hash(x, y, 6) < 0.15 ? 17 : (hash(x, y, 7) < 0.15 ? 15 : 16),
    6: (x, y) => (x === 2 && y === 3) ? 27 : (x === 6 && y === 6) ? 13 : (hash(x, y, 8) < 0.15 ? 17 : 16),
    7: (x, y) => hash(x, y, 9) < 0.2 ? 29 : (hash(x, y, 10) < 0.2 ? 30 : 28),
    8: (x, y) => (y === 3 || y === 7) ? 6 : ((x === 1 || x === 6) && (y === 1 || y === 5) && hash(x, y, 11) < 0.5 ? 6 : 7),
    9: (x, y) => (x === 3 || x === 7) ? 6 : 7,
    10: (x, y) => (x === 0 || y === 0) ? 6 : (hash(x, y, 12) < 0.1 ? 6 : 8),
    11: (x, y) => (y % 3 === 2) ? 24 : (x % 4 === 1 && y % 3 === 0 ? 24 : 25),
    12: (x, y) => (y % 3 === 2) ? 19 : 21,
    13: (x, y) => (x === 0 || y === 0 || (y === 4 && x === 4)) ? 28 : 29,
    14: (x, y) => hash(x, y, 13) < 0.25 ? 28 : (hash(x, y, 14) < 0.12 ? 26 : 21),
    15: (x, y) => hash(x, y, 15) < 0.1 ? 20 : 19,
    22: (x, y) => (x === 0 || y === 0) ? 6 : 8,
  };
  // the landing pad: 16x16 with a yellow H, as four tiles 18 19 / 20 21
  const padPx = (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return ((x + y) % 4 < 2) ? 13 : 30;
    if ((x >= 4 && x <= 5 || x >= 10 && x <= 11) && y >= 4 && y <= 11) return 27;
    if (y >= 7 && y <= 8 && x >= 4 && x <= 11) return 27;
    return 30;
  };

  const W = 256;   // map stride
  function buildGfx(cart) {
    const T = cart.tiles;
    T.fill(0); cart.flags.fill(0); cart.map.fill(0);
    const blit = (n, g) => g.forEach((row, y) => row.forEach((c, x) => {
      const t = n + (y >> 3) * 16 + (x >> 3);
      T[t * 64 + (y & 7) * 8 + (x & 7)] = c;
    }));
    for (const [n, f] of Object.entries(TILES)) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) T[+n * 64 + y * 8 + x] = f(x, y);
    [18, 19, 20, 21].forEach((t, i) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) T[t * 64 + y * 8 + x] = padPx(x + (i & 1) * 8, y + (i >> 1) * 8); });
    [1, 2, 3, 14, 15].forEach(t => { cart.flags[t] |= 1; });    // water

    const pip = { skin: 11, hair: 8, top: 21, topDark: 20, legs: 7, shoe: 6, scarf: 10, goggles: true, blush: 26 };
    const mags = { skin: 11, hair: 29, top: 4, topDark: 3, legs: 3, shoe: 6, bun: true, bird: true, mouth: 24 };
    const tobin = { skin: 11, hair: 29, top: 27, topDark: 10, legs: 20, shoe: 6, cap: 19, capDark: 20, beard: 29 };
    // people only appear in the story's speech boxes
    blit(64, person(pip, 'down', 0)); blit(66, person(mags, 'down', 0)); blit(68, person(tobin, 'down', 0));
    blit(76, planeIcon());
    blit(120, crate()); blit(122, coil()); blit(124, satchel());
    blit(126, pigeon(0)); blit(127, pigeon(1)); blit(142, pigeon(2));
    blit(160, house({ wall: 7, wallDark: 6, roof: 25, roofDark: 24, chimney: true }));
    blit(164, house({ wall: 12, wallDark: 11, roof: 21, roofDark: 19 }));
    blit(168, house({ wall: 29, wallDark: 28, roof: 20, roofDark: 19, kind: 'loft' }));
    blit(172, house({ wall: 8, wallDark: 7, roof: 28, roofDark: 30, kind: 'shed' }));
    blit(240, belltower()); blit(243, wreck()); blit(246, palm()); blit(248, boat()); blit(252, buoy());

    // ---- entities (the Entities tab)
    const N = (t, p, c) => { const n = { t, p: p || {} }; if (c) n.c = c; return n; };
    const A = (name, frames, speed) => ({ name, frames, speed: speed || 8 });
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    const thing = (name, frame, sw, sh, extra) => Object.assign({}, base, { name, sw, sh, anims: [A('idle', [frame])], tree: null }, extra || {});
    cart.entities = {
      effects: [
        { name: 'tailwind', dur: 180, stack: 'refresh', hp: 0, every: 0, tick: 0, tint: -1, mods: [{ stat: 'speed', op: 'mul', value: 1.45 }] },
      ],
      types: [
        // the plane: where it launches from, its speed stat and the Tailwind effect (and the home screen icon)
        Object.assign({}, base, { name: 'tinwing', anims: [A('idle', [76])], stats: [{ name: 'speed', value: 1 }], tree: null }),
        thing('pad', 18, 2, 2),
        // the people in the story: hidden, they only lend their faces to the speech boxes
        thing('pip', 64, 2, 3, { hidden: true }), thing('mags', 66, 2, 3, { hidden: true }), thing('tobin', 68, 2, 3, { hidden: true }),
        thing('house_a', 160, 4, 5), thing('house_b', 164, 4, 5), thing('loft', 168, 4, 5), thing('shed', 172, 4, 5),
        thing('boat', 248, 4, 2), thing('buoy', 252, 1, 2), thing('palm', 246, 2, 3),
        Object.assign({}, base, { name: 'pigeon', sw: 1, sh: 1, anims: [A('idle', [126]), A('fly', [127, 142], 4)], tree: null }),
        thing('tower', 240, 3, 8), thing('wreck', 243, 3, 5),
        thing('crate', 120, 2, 2), thing('coil', 122, 2, 2), thing('satchel', 124, 2, 2),
        thing('ring', 27, 2, 2),
      ],
      placed: [],
    };
    const sizes = Object.fromEntries(cart.entities.types.map(t => [t.name, [t.sw * 8, t.sh * 8]]));
    // entities are placed by the middle of their box: that is where they stand on the floor
    const at = (list, type, gx, gy) => { const [w, h] = sizes[type]; list.push({ type, x: Math.round(gx - w / 2), y: Math.round(gy - h / 2) }); };

    // ---- cutscenes (the Cutscenes tab); the game plays them from code
    const S = (t, p) => ({ t, p });
    const say = (who, text) => S('say', { who, text });
    cart.entities.cutscenes = [
      { name: 'intro', level: 0, steps: [
        S('fade', { to: 'black', frames: 0 }), S('fade', { to: 'clear', frames: 50 }),
        say('', 'Perch. A town on stilts, on a world that is nearly all sea. Letters go by pigeon. People go by boat.'),
        say('pip', 'And one day, everything will go by plane. My planes.'),
        say('mags', 'Pip! Pepper came home last night without her mail satchel.'),
        say('mags', 'The squall blew it off somewhere east, past the Drowned Belltower. Half the town\'s letters are in it.'),
        say('tobin', 'The reef is too rough for boats this month. But a plane could fly right over it.'),
        say('pip', 'Leave it to me! She just needs a body that fits her motor and battery.'),
        say('', 'Shape the plane on the blueprint: grab a corner with A, move it, drop it with A. Then FLY.'),
      ] },
      { name: 'coil_home', level: 0, steps: [
        say('tobin', 'Is that a Twin Cell? Lighthouse stock, from before the water rose!'),
        say('pip', 'It was on top of the Belltower. But it\'s twice as wide as my old battery...'),
        say('tobin', 'Then make her body wider. With that, you\'ll reach the reef and back.'),
      ] },
      { name: 'rescue', level: 0, steps: [
        S('fade', { to: 'black', frames: 0 }), S('fade', { to: 'clear', frames: 40 }),
        say('tobin', 'Found her bobbing out there like a cork. Dried her off for you.'),
        say('tobin', 'Mind your battery, Pip. Climb high, then glide: gliding is free.'),
      ] },
      { name: 'ending', level: 0, steps: [
        say('mags', 'The satchel! And the letters are dry!'),
        say('pip', 'Snagged on an old mast out on the reef. Easy... mostly.'),
        say('mags', 'Pip, how would you like a job? Perch could use a mail plane.'),
        S('sound', { note: 'E6', wave: 4 }),
        say('', 'Thanks for playing Tinwing! Keep flying to find the rest of the scrap.'),
      ] },
    ];

    const set = (m, x, y, t) => { m[y * W + x] = t; };
    const rect = (m, x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(m, x, y, t); };

    // ---- the Shallows, the open sea (200x128 tiles), with Perch in the south-west
    const sea = new Uint16Array(W * 128);
    const SW = 200, SH = 128;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) set(sea, x, y, hash(x, y, 21) < 0.2 ? 2 : (hash(x, y, 22) < 0.04 ? 15 : 1));
    const islands = [[50, 92, 5, 0], [64, 74, 7, 1], [40, 50, 6, 0], [104, 106, 6, 0], [124, 44, 8, 1], [150, 84, 7, 0],
      [182, 104, 5, 1], [76, 22, 6, 0], [24, 22, 5, 1], [140, 118, 4, 0], [168, 60, 4, 0], [118, 80, 3, 0]];
    const isle = (cx, cy, r, rocky) => {
      for (let y = cy - r - 3; y <= cy + r + 3; y++) for (let x = cx - r - 3; x <= cx + r + 3; x++) {
        if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
        const a = Math.atan2(y - cy, x - cx);
        const rr = r * (1 + 0.22 * Math.sin(a * 3 + cx) + 0.12 * Math.sin(a * 5 + cy));
        const d = Math.hypot(x - cx, y - cy);
        if (d < rr - 2.2) set(sea, x, y, rocky && d < rr * 0.4 ? 7 : (hash(x, y, 23) < 0.12 ? 6 : 5));
        else if (d < rr) set(sea, x, y, 4);
        else if (d < rr + 1.6) set(sea, x, y, 3);
      }
    };
    islands.forEach(i => isle(...i));
    // the drowned district: rooftops poking out of the water around the Belltower
    for (let by = 0; by < 5; by++) for (let bx = 0; bx < 5; bx++) {
      if (hash(bx, by, 24) < 0.22) continue;
      const x0 = 80 + bx * 6, y0 = 56 + by * 5;
      rect(sea, x0 - 1, y0 - 1, x0 + 4, y0 + 3, 3);
      rect(sea, x0, y0, x0 + 3, y0 + 2, hash(bx, by, 25) < 0.5 ? 11 : 12);
    }
    rect(sea, 91, 66, 95, 69, 13);
    // the reef in the north-east, with the wreck
    for (let y = 6; y < 40; y++) for (let x = 156; x < 198; x++) {
      const v = Math.sin(x * 0.21 + y * 0.13) + Math.sin(y * 0.31 - x * 0.07);
      if (v > 0.9) set(sea, x, y, 14); else if (v > 0.3) set(sea, x, y, 3);
    }
    // Perch, seen from the air: decks and the landing pad
    rect(sea, 18, 102, 36, 117, 3);
    rect(sea, 20, 104, 34, 106, 10); rect(sea, 26, 104, 28, 116, 8); rect(sea, 20, 112, 34, 115, 10); rect(sea, 30, 107, 34, 111, 10);
    rect(sea, 25, 107, 29, 110, 10);
    set(sea, 26, 108, 18); set(sea, 27, 108, 19); set(sea, 26, 109, 20); set(sea, 27, 109, 21);
    const splaced = [];
    const padx = 27 * 8, pady = 109 * 8;
    at(splaced, 'pad', padx, pady);
    at(splaced, 'tinwing', padx, pady);
    at(splaced, 'pip', padx + 24, pady + 24); at(splaced, 'mags', padx + 40, pady + 24); at(splaced, 'tobin', padx + 56, pady + 24);
    at(splaced, 'house_a', 21 * 8, 106 * 8); at(splaced, 'house_b', 21 * 8, 111 * 8);
    at(splaced, 'loft', 33 * 8, 113 * 8); at(splaced, 'shed', 22 * 8, 114 * 8); at(splaced, 'house_a', 30 * 8, 116 * 8);
    at(splaced, 'boat', 37 * 8, 114 * 8);
    at(splaced, 'tower', 93 * 8, 68 * 8);
    at(splaced, 'coil', 93 * 8, 68 * 8);
    at(splaced, 'wreck', 178 * 8, 20 * 8);
    at(splaced, 'satchel', 178 * 8, 20 * 8);
    [[40, 100], [56, 86], [72, 62], [44, 40], [86, 54], [102, 78], [110, 100], [128, 34], [146, 90], [162, 62], [80, 28], [186, 98],
      [96, 62], [20, 26]].forEach(([x, y]) => at(splaced, 'crate', x * 8, y * 8));
    [[42, 96], [62, 86], [84, 74], [118, 62], [140, 48], [160, 36], [70, 40], [130, 96]].forEach(([x, y]) => at(splaced, 'ring', x * 8, y * 8));
    [[30, 98], [34, 100], [24, 100], [36, 104]].forEach(([x, y]) => at(splaced, 'pigeon', x * 8, y * 8));
    [[40, 106], [58, 98], [88, 84], [150, 60]].forEach(([x, y]) => at(splaced, 'buoy', x * 8, y * 8));
    islands.forEach(([cx, cy, r], i) => {
      if (r < 5) return;
      [[-2, -1], [2, 1], [0, 2], [-1, 2]].slice(0, r >= 7 ? 4 : 2).forEach(([dx, dy]) => at(splaced, 'palm', (cx + dx) * 8 + 4, (cy + dy) * 8 + 4));
    });

    cart.map.set(sea);
    cart.entities.placed = splaced;
    cart.levels = [{ name: 'The Shallows', w: SW, h: SH, map: cart.map, placed: splaced }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Tinwing', code, buildGfx,
    about: 'A story game in 2.5D: shape your own RC plane on a blueprint so its parts fit, then fly it over a flooded world.' });
})();
