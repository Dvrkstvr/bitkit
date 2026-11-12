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
BASE_SPEED, BASE_TURN, BASE_DRAIN = 1.6, 0.034, 1 / 1330

-- materials: what parts cost. Scrap comes in crates, balsa in driftwood bundles on the palm islands,
-- silk from balloons you pop, copper from boxes on the wrecks out on the Reef
MATS = {{"scrap", "S", 29}, {"balsa", "B", 12}, {"silk", "K", 26}, {"copper", "C", 10}}

-- parts: size of the box they need inside the body (length, height, width), what they do, and what they cost
-- (a table of materials; cost = -1: can't be bought, you have to find it)
MOTORS = {
  {name = "Hummer", len = 3, h = 1.8, w = 2.0, power = 1.0, weight = 0.6, prop = 4.6, cost = {}, about = "Small and quiet."},
  {name = "Whirr", len = 3.2, h = 2.2, w = 2.4, power = 1.2, weight = 0.75, prop = 5.0, cost = {scrap = 3}, about = "A little faster. A little fatter."},
  {name = "Buzzer", len = 3.5, h = 2.6, w = 2.8, power = 1.4, weight = 0.9, prop = 5.4, cost = {scrap = 6, copper = 1}, about = "Faster. Needs a fatter nose."},
  {name = "Zinger", len = 4, h = 3.0, w = 3.2, power = 1.65, weight = 1.1, prop = 5.8, cost = {scrap = 8, copper = 3}, about = "Quick off the ramp, thirsty."},
  {name = "Roarer", len = 4.5, h = 3.4, w = 3.6, power = 1.9, weight = 1.3, prop = 6.2, cost = {scrap = 12, copper = 5}, about = "Very fast, and big."},
}
CELLS = {
  {name = "Single Cell", len = 4, h = 1.8, w = 1.8, cap = 1.0, weight = 0.5, cost = {}, about = "Gets you to the Belltower and back."},
  {name = "Double Cell", len = 4.5, h = 1.9, w = 2.4, cap = 1.35, weight = 0.55, cost = {scrap = 4}, about = "A bit more range for a bit more width."},
  {name = "Twin Cell", len = 4, h = 1.8, w = 4.0, cap = 1.75, weight = 0.6, cost = -1, about = "Lighthouse stock. Reaches the Reef."},
  {name = "Brick Cell", len = 6, h = 2.8, w = 2.8, cap = 2.2, weight = 0.7, cost = {scrap = 8, copper = 2}, about = "Long and tall. Good range."},
  {name = "Deep Cell", len = 5, h = 2.6, w = 3.6, cap = 2.7, weight = 0.75, cost = {scrap = 10, copper = 4, silk = 2}, about = "Reaches the far end of the Reef."},
  {name = "Storm Cell", len = 5.5, h = 3.0, w = 4.2, cap = 3.4, weight = 0.8, cost = -1, about = "Glows faintly. Huge range."},
}
-- toy cannons, one on each wing: B fires them. weight is for the pair; rate = frames between shots
CANNONS = {
  {name = "No cannons", weight = 0, cost = {}, about = "Clean wings, nothing to carry."},
  {name = "Cork Popper", weight = 0.25, cost = {scrap = 4}, rate = 12, speed = 4.5, r = 10, about = "B fires: pops balloons, shoos hawks."},
  {name = "Puff Mortar", weight = 0.55, cost = {scrap = 6, copper = 2}, rate = 28, speed = 3.5, r = 20, about = "Heavy, slow, and pops anything near it."},
}
-- what the plane is covered in: dens = how heavy the body and wings are, shove = how far hawks,
-- gusts and storms push her about
SKINS = {
  {name = "Tin", dens = 1.0, shove = 0.6, cost = {}, about = "Heavy, but hard to push around.", c = 29},
  {name = "Balsa", dens = 0.6, shove = 1.0, cost = {balsa = 5}, about = "Lighter: glides and climbs better.", c = 12},
  {name = "Silk", dens = 0.35, shove = 1.45, cost = {balsa = 3, silk = 4}, about = "Featherweight. Hawks toss her about.", c = 26},
}
PAINTS = {   -- main colour, shade, trim
  {name = "Tin", cost = {}, c = {29, 28, 25}},
  {name = "Sunrise", cost = {}, c = {10, 9, 13}},
  {name = "Lagoon", cost = {}, c = {22, 21, 27}},
  {name = "Moss", cost = {silk = 1}, c = {17, 16, 12}},
  {name = "Cherry", cost = {silk = 1}, c = {26, 25, 13}},
  {name = "Plum", cost = {silk = 2}, c = {5, 4, 27}},
}
PARTS = {{"Motor", MOTORS, "m"}, {"Battery", CELLS, "c"}, {"Cannons", CANNONS, "g"}, {"Skin", SKINS, "k"}, {"Paint", PAINTS, "p"}}
TABS = {"SIDE", "TOP", "PARTS", "FLY"}
SNAME = {"Front", "Middle", "Back"}

-- sprites seen from the air: first tile, size in tiles
DRAW = {
  house_a = {t = 160, w = 4, h = 5}, house_b = {t = 164, w = 4, h = 5}, loft = {t = 168, w = 4, h = 5}, shed = {t = 172, w = 4, h = 5},
  tower = {t = 240, w = 3, h = 8}, wreck = {t = 243, w = 3, h = 5}, palm = {t = 246, w = 2, h = 3},
  boat = {t = 248, w = 4, h = 2}, buoy = {t = 252, w = 1, h = 2},
  crate = {t = 120, w = 2, h = 2}, coil = {t = 122, w = 2, h = 2}, satchel = {t = 124, w = 2, h = 2},
  balloon = {t = 70, w = 2, h = 3}, log = {t = 72, w = 2, h = 2}, cbox = {t = 74, w = 2, h = 2}, scell = {t = 78, w = 2, h = 2},
}
PICK = {crate = true, log = true, cbox = true, coil = true, scell = true, satchel = true, ring = true}
FLOAT = {balloon = true}
-- the world: three seas side by side, one level each. Fly off an edge with a neighbour and you're in the next one
REG = {
  {name = "The Shallows", e = 2, n = 3},
  {name = "The Reef", w = 1},
  {name = "Thunderhead", s = 1},
}
STORM_R = 72            -- a thunder cell's radius; its cloud sits from STORM_LO up past the radio's ceiling
STORM_LO = 60   -- drawn up in the air like the pickups, but you pop them with the cannons

-- ------------------------------------------------------------------ the save
-- the blueprint: body stations from front to back {x, top, bottom, half width}, the nose and tail points,
-- and the right wing seen from above (root front / back, tip front / back, half span)
function default_shape()
  return {nose = 11, tail = -13, st = {{6, 1.5, -1.3, 1.5}, {1, 1.6, -1.4, 1.6}, {-5, 1.0, -0.6, 0.9}},
    rf = 3, rb = -1.5, tf = 1.8, tb = -0.6, span = 12}
end
-- where the parts sit: the middle of the motor and of the battery along the body, and how far out on each
-- wing the cannons are
function default_place() return {m = 5.7, c = 1, g = 6} end
function new_state()
  return {v = 2, mat = {scrap = 0, balsa = 0, silk = 0, copper = 0},
    own = {m1 = true, c1 = true, g1 = true, k1 = true, p1 = true, p2 = true, p3 = true}, sel = {m = 1, c = 1, g = 1, k = 1, p = 2},
    shape = default_shape(), place = default_place(), coil = false, coil_told = false, storm = false, satchel = false, done = false,
    got = {}, flights = 0, swims = 0}
end
-- saves from older versions: parts that move, cannons, materials, and the longer lists of motors and batteries
function upgrade_save(s)
  s.place = s.place or default_place()
  s.sel.g, s.sel.k = s.sel.g or 1, s.sel.k or 1
  s.own.g1, s.own.k1 = true, true
  if not s.v then
    s.v = 2
    s.mat = {scrap = s.scrap or 0, balsa = 0, silk = 0, copper = 0}
    local mm, cm = {1, 3, 5}, {1, 3, 4}         -- old Hummer/Buzzer/Roarer, Single/Twin/Brick
    local own = {}
    for k, v in pairs(s.own) do
      local key, i = k:sub(1, 1), tonumber(k:sub(2))
      if key == "m" then own["m" .. mm[i]] = v elseif key == "c" then own["c" .. cm[i]] = v else own[k] = v end
    end
    s.own = own
    s.sel.m, s.sel.c = mm[s.sel.m] or 1, cm[s.sel.c] or 1
  end
  return s
end
-- material costs: can you pay, pay, and say it short ("6S 1C")
function can_pay(cost) for k, n in pairs(cost) do if (S.mat[k] or 0) < n then return false end end return true end
function pay(cost) for k, n in pairs(cost) do S.mat[k] = S.mat[k] - n end end
function cost_text(cost)
  local t = ""
  for _, m in ipairs(MATS) do if cost[m[1]] then t = t .. (t == "" and "" or " ") .. cost[m[1]] .. m[2] end end
  return t == "" and "free" or t
end
function give(kind, n, why)
  S.mat[kind] = S.mat[kind] + n
  msg(tr(why or "") .. tr(kind:sub(1, 1):upper() .. kind:sub(2)) .. " +" .. n, 70)
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
    players = 1,
    race = "time",                    -- linked Bits: each flies their own plane, first to bring the mail home wins
    title_draw = draw_title,          -- its own animated title screen (above)
    look = { title = 12, shadow = 19, panel = 19, edge = 22, hi = 20, text = 23, pick = 27, goal = 22, footer = 22, menu = "left" },
    goal = "Build an RC plane, find the mail satchel lost past the Drowned Belltower and fly it home to Perch.",
    help = {
      "Hangar: pick a corner with the D-pad, A grabs it, move it, A drops it. L / R or X: next page.",
      "Make the body big enough for your motor and battery, and grab M or B to move them. The motor stays in the front.",
      "More wing glides, short wings turn quick. Cannons go on the wings: B fires them at balloons.",
      "Flying: left / right turn, up / down climb and dive (Settings: Invert up/down). Hold A or squeeze R for the motor.",
      "Let go of the motor to glide for free. Fly low over the yellow pad at Perch to land.",
    },
    continue = function(cp)
      if cp then S = upgrade_save(copy(cp)) end
      INTRO = false
      hangar_enter(nil)
    end,
    pause = {{"Back to the hangar", function() if MODE == "fly" then hangar_enter("menu") end end},
      {"Reset the blueprint", function() if MODE == "hangar" then S.shape, S.place = default_shape(), default_place(); H.hold = nil end end}},
    settings = {{key = "pitch", name = "Invert up/down", values = {"Off", "On"}, value = 1}},
  }
  S = new_state()
  INTRO = true
  gt, MSG, MSG_T = 0, nil, 0
  on("cutscene_end", function(name)
    if name == "rescue" and S.satchel and not S.done then deliver() end
  end)
  HLEVEL = nil
  region_heights()
  hangar_enter(nil)
end

function msg(s, t) MSG, MSG_T = s, t or 150 end
function owned(key, i) return S.own[key .. i] == true end
function clamp(v, a, b) return math.max(a, math.min(b, v)) end
function ground(e) return e.x + e.w / 2, e.y + e.h / 2 end
function angdiff(a, b) return (a - b + math.pi) % TAU - math.pi end

-- what to do next
function objective()
  if S.done then return "Explore! Storms north, hawks east." end
  if S.satchel then return "Fly the satchel home to Perch!" end
  if not S.coil then return "Find the Twin Cell on the Belltower." end
  if S.sel.c < 3 then return "Widen the body and fit the Twin Cell." end
  if CELLS[S.sel.c].cap < 2.4 then return "Need range: Deep Cell or Storm Cell." end
  return "Find the satchel at the Reef's far end."
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
-- where a part's box is along the body: front and back x
function slot(key, part, pl)
  local c = (pl or S.place)[key]
  return c + part.len / 2, c - part.len / 2
end
-- does the part's box fit inside the body? returns ok, the box's centre height and, when it doesn't, why:
-- "out" (past the nose or tail), "tall", "wide", "front" (a motor behind the middle) or "overlap".
-- The body is straight lines between its corners, so checking both ends of the box and every corner in
-- between is exact: what you see on the blueprint is what fits. The box sits as high or low as it needs to.
function fits(s, key, part, pl)
  pl = pl or S.place
  local x0, x1 = slot(key, part, pl)
  if x0 > s.nose - 0.01 or x1 < s.tail + 0.01 then return false, 0, "out" end
  local lo, hi, wmin = -99, 99, 99
  local function at(x)
    local t, b, w = section(s, x)
    lo, hi, wmin = math.max(lo, b), math.min(hi, t), math.min(wmin, w)
  end
  at(x0); at(x1)
  for _, p in ipairs(body_points(s)) do if p[1] < x0 and p[1] > x1 then at(p[1]) end end
  local mid = (lo + hi) / 2
  if hi - lo < part.h - 0.001 then return false, mid, "tall" end
  if wmin * 2 < part.w - 0.001 then return false, mid, "wide" end
  if key == "m" and x1 < s.st[2][1] - 0.001 then return false, mid, "front" end
  local other = key == "m" and "c" or "m"
  local o0, o1 = slot(other, other == "m" and MOTORS[S.sel.m] or CELLS[S.sel.c], pl)
  if x1 < o0 - 0.001 and o1 < x0 - 0.001 then return false, mid, "overlap" end
  return true, mid
end
-- the cannons: on the wing, at u out from the middle. Returns the wing's front and back x there
function wing_chord(s, u)
  local r = wing_root(s)
  local t = clamp((u - r) / math.max(0.1, s.span - r), 0, 1)
  return s.rf + (s.tf - s.rf) * t, s.rb + (s.tb - s.rb) * t, 0.3 + s.span * 0.05 * t
end
function guns_fit(s, pl)
  if S.sel.g == 1 then return true end
  local u = (pl or S.place).g
  return u >= wing_root(s) + 0.5 and u <= s.span - 0.5
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
  local m, c, g, k = MOTORS[sel.m], CELLS[sel.c], CANNONS[sel.g or 1], SKINS[sel.k or 1]
  local area = wing_area(s)
  local weight = 1 + m.weight + c.weight + g.weight + (body_volume(s) * 0.004 + area * 0.004) * k.dens
  -- cannons far out on the wings make her roll (and so turn) a little slower
  local swing = 1 - g.weight * clamp((S.place.g or 0) / math.max(1, s.span), 0, 1) * 0.35
  local lift = area / weight / 25.6                   -- 1 is a plain, nice wing
  local sweep = ((s.rf + s.rb) - (s.tf + s.tb)) / 2  -- how far back the tips sit
  return {
    speed = (m.power / weight * 2.85) ^ 0.6,
    turn = clamp((1.3 - (s.span - 12) * 0.045) * clamp(lift, 0.7, 1.15) * (1 + clamp(sweep, 0, 6) * 0.03) * swing, 0.5, 1.8),
    glide = clamp(lift, 0.3, 2.2),
    drain = m.power ^ 0.8 * weight / 2.85 / c.cap,
    cap = c.cap, lift = lift, weight = weight, prop = m.prop, shove = k.shove,
  }
end
-- what still stops the plane from flying
function problems()
  local s, l = S.shape, {}
  local said = {}
  for _, it in ipairs({{"m", MOTORS[S.sel.m]}, {"c", CELLS[S.sel.c]}}) do
    local ok, _, why = fits(s, it[1], it[2])
    local n = it[2].name
    local t = ok and nil or ({out = tr("%s sticks out of the body.", tr(n)), tall = tr("%s: too tall. Raise it on SIDE.", tr(n)),
      wide = tr("%s: too wide. Widen it on TOP.", tr(n)), front = "The motor must sit in the front half.",
      overlap = "Motor and battery overlap. Move one."})[why]
    if t and not said[t] then said[t] = true; l[#l + 1] = t end
  end
  if not guns_fit(s) then l[#l + 1] = "Cannons must sit on the wings (TOP)." end
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
  local g = S and S.sel.g or 1
  if g > 1 then
    -- a barrel under each wing: a cross of two plates, so it shows from the side and from above
    local u = S.place.g
    local f, b, wz = wing_chord(s, u)
    local len, fat = g == 2 and 1.0 or 1.6, g == 2 and 0.35 or 0.6
    for side = -1, 1, 2 do
      local y, z = u * side, wz - fat - 0.1
      quad(v(f + len, y, z + fat), v(b, y, z + fat), v(b, y, z - fat), v(f + len, y, z - fat), 2)
      quad(v(f + len, y - fat, z), v(b, y - fat, z), v(b, y + fat, z), v(f + len, y + fat, z), 2)
    end
  end
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
  -- the propeller on the nose goes into the same depth order as the triangles, so from the chase camera
  -- (behind the plane) it is drawn first and the body covers it; seen from the front it is drawn on top
  local px, py, k, pd = proj(body_to_world(P, M.nose + 0.6, 0, 0.2))
  if px then list[#list + 1] = {d = pd * 3, prop = true} end
  table.sort(list, function(u, v) return u.d > v.d end)
  for _, t in ipairs(list) do
    if t.prop then
      -- a bigger motor turns a bigger prop; the blur ring only shows when it faces you
      local r = (prop or 4.6) * k
      local _, _, _, td = proj(body_to_world(P, M.nose - 6, 0, 0.2))
      if fast and td and td > pd then circ(px, py, r, 29) end
      local bx, by = math.cos(spin) * r, math.sin(spin) * r * 0.9
      line(px - bx, py - by, px + bx, py + by, 30)
      circfill(px, py, math.max(1, 0.8 * k), 31)
    else tri(t.a[1], t.a[2], t.b[1], t.b[2], t.c[1], t.c[2], t.col) end
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
      if b and x % 5 == 0 and y % 5 == 0 then MINI[#MINI + 1] = {x // 5, y // 5, (t == 7) and 28 or ((t == 11 or t == 12) and 25 or 16)} end
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
  if LEVEL ~= 1 then level(1) end     -- home is in the Shallows
  stop(7)
  H = H or {tab = 1, sel = {1, 1}, hold = nil, rep = 0, view = {m = S.sel.m, c = S.sel.c, g = S.sel.g, k = S.sel.k, p = S.sel.p}, spin = 0.6, note = nil, note_t = 0}
  H.view = {m = S.sel.m, c = S.sel.c, g = S.sel.g, k = S.sel.k, p = S.sel.p}
  H.hold = nil
  H.row = H.row or 1
  if reason == "land" then
    S.flights = S.flights + 1
    if S.satchel and not S.done then deliver() return end
    if S.coil and not S.coil_told then S.coil_told = true; cutscene("coil_home")
    else note(tr("Landed! %s", tr(objective()))) end
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
    part_handles(add, function(du, dv) return du end, false)
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
    part_handles(add, function(du, dv) return dv end, true)
    if S.sel.g > 1 then
      add("Cannons", function() local f, b = wing_chord(s, S.place.g) return S.place.g, (f + b) / 2 end,
        function(du) S.place.g = clamp(S.place.g + du, 0.5, s.span) end)
    end
  end
  return L
end
-- the motor (M) and battery (B) slide along the body; along() picks the move along it from (du, dv).
-- The motor can't go behind the middle of the plane: its back end stays ahead of the Middle corners.
function part_handles(add, along, top)
  local s = S.shape
  for _, it in ipairs({{"m", "Motor", MOTORS[S.sel.m]}, {"c", "Battery", CELLS[S.sel.c]}}) do
    local key, part = it[1], it[3]
    add(it[2], function()
      if top then return 0, S.place[key] end
      local _, mid = fits(s, key, part) return S.place[key], mid end,
      function(du, dv)
        local hi = s.nose - part.len / 2
        local lo = key == "m" and s.st[2][1] + part.len / 2 or s.tail + part.len / 2
        local want = S.place[key] + along(du, dv)
        S.place[key] = clamp(want, math.min(lo, hi), hi)
        if key == "m" and want < lo - 0.01 then note("The motor has to stay in the front.", 90) end
      end)
  end
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
    H.view = {m = S.sel.m, c = S.sel.c, g = S.sel.g, k = S.sel.k, p = S.sel.p}
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
        note(tr("%s fitted.", tr(part.name)), 90); sfx("C6", 1, 0.25, 6)
      elseif part.cost == -1 then note("You'll have to find that one out there.", 150); sfx("C4", 2, 0.3, 8)
      elseif can_pay(part.cost) then
        pay(part.cost)
        S.own[key .. i] = true
        S.sel[key] = i
        note(tr("Built and fitted: %s!", tr(part.name)), 120); sfx("C6", 1, 0.3, 10)
      else note(tr("You need %s for that.", cost_text(part.cost)), 150); sfx("C4", 2, 0.3, 8) end
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
  -- the parts' boxes: green when they fit, red when the body is too small (BOX: where each was drawn, by handle name)
  BOX = {}
  for _, it in ipairs({{"m", MOTORS[S.sel.m], "M", "Motor"}, {"c", CELLS[S.sel.c], "B", "Battery"}}) do
    local part = it[2]
    local ok, mid = fits(s, it[1], part)
    local x0, x1 = slot(it[1], part)
    local col = ok and 17 or (gt % 20 < 12 and 26 or 25)
    local ax, ay, bx, by
    if view == 1 then ax, ay = bp_xy(1, x1, mid + part.h / 2) bx, by = bp_xy(1, x0, mid - part.h / 2)
    else ax, ay = bp_xy(2, -part.w / 2, x0) bx, by = bp_xy(2, part.w / 2, x1) end
    rect(ax, ay, bx - ax + 1, by - ay + 1, col)
    text(it[3], (ax + bx) / 2 - 3, (ay + by) / 2 - 3, col)
    BOX[it[4]] = {ax, ay, bx, by}
  end
  if S.sel.g > 1 then
    local u = S.place.g
    local f, b, wz = wing_chord(s, u)
    local col = guns_fit(s) and 13 or (gt % 20 < 12 and 26 or 25)
    if view == 1 then
      local ax, ay = bp_xy(1, b, wz - 0.2) local bx, by = bp_xy(1, f + 1, wz - 1)
      rectfill(ax, ay, bx - ax + 1, by - ay + 1, col)
    else
      for side = -1, 1, 2 do
        local ax, ay = bp_xy(2, u * side - 0.4, f + 1) local bx, by = bp_xy(2, u * side + 0.4, b)
        rectfill(ax, ay, bx - ax + 1, by - ay + 1, col)
        if side == 1 then BOX.Cannons = {ax, ay, bx, by} end
      end
    end
  end
  -- the corners
  local L = handles(view)
  for i, h in ipairs(L) do
    local x, y = bp_xy(view, h.get())
    local on = H.sel[view] == i
    local box = BOX[h.name]
    if view == 2 and h.name:find("width") then local mx = bp_xy(2, -h.get(), 0) rect(mx - 1, y - 1, 3, 3, 29) end
    if box then
      -- a part: picked, its whole box gets a frame (blinking while you move it)
      if on and not (H.hold and gt % 20 >= 10) then rect(box[1] - 2, box[2] - 2, box[3] - box[1] + 5, box[4] - box[2] + 5, H.hold and 27 or 13) end
    elseif on then
      local c = H.hold and 27 or 13
      rect(x - 3, y - 3, 7, 7, c)
      if H.hold and gt % 20 < 10 then rect(x - 4, y - 4, 9, 9, 10) end
    else rectfill(x - 1, y - 1, 3, 3, 27) end
  end
  clip()
  local h = L[math.min(H.sel[view], #L)]
  if h then text((H.hold and tr("Moving: ") or "") .. tr(h.name), BP.x + 4, BP.y + BP.h - 10, H.hold and 27 or 29) end
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

-- the materials you have: a coloured letter and a number each
function mats_bar(x, y)
  for _, m in ipairs(MATS) do
    rectfill(x, y, 7, 7, m[3]); text(m[2], x + 1, y, 1)
    text(S.mat[m[1]], x + 9, y, 13)
    x = x + 9 + #tostring(S.mat[m[1]]) * 8 + 4
  end
end

function hangar_draw()
  cls(6)
  for x = 0, 319, 16 do rectfill(x, 0, 1, 240, 7) end
  rectfill(0, 0, 320, 13, 1)
  text("PIP'S HANGAR", 6, 3, 27)
  mats_bar(166, 3)
  -- page tabs
  for i, t in ipairs(TABS) do
    local x = 6 + (i - 1) * 51
    local on = H.tab == i
    rectfill(x, 16, 49, 11, on and 27 or 31)
    t = tr(t)
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
    draw_model(plane_model(S.shape), P, PAINTS[(H.tab == 3 and PARTS[H.row][3] == "p") and H.view.p or S.sel.p].c, gt * 0.6, true, MOTORS[S.sel.m].prop)
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
  local hint = ({"D-pad: pick a corner or part. A: grab.", "D-pad: pick a corner or part. A: grab.",
    "Up / down: part. Left / right: browse. A: fit.", "A: launch from the ramp!"})[H.tab]
  if H.tab == 3 then local r = PARTS[H.row] hint = r[2][H.view[r[3]]].about or hint end
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
  local y = 31
  for i, r in ipairs(PARTS) do
    local key, list = r[3], r[2]
    local v = H.view[key]
    local part = list[v]
    local on = H.row == i
    rectfill(214, y, 102, 26, on and 1 or 31)
    if on then rect(214, y, 102, 26, 27) end
    text(r[1], 218, y + 1, 29)
    local col = owned(key, v) and 13 or 28
    text(part.name, 218, y + 9, S.sel[key] == v and 27 or col)
    if key == "p" then rectfill(298, y + 1, 12, 7, part.c[1])
    elseif key == "k" then rectfill(298, y + 1, 12, 7, part.c)
    elseif key == "g" then
      if v > 1 then local ok = guns_fit(S.shape) text(ok and "fits" or "off!", 280, y + 1, ok and 17 or 26) end
    else
      local ok, _, why = fits(S.shape, key, part)
      text(ok and "fits" or ((why == "tall" or why == "wide" or why == "out") and "big!" or "move"), 280, y + 1, ok and 17 or 26)
    end
    local tag, tcol = nil, 29
    if S.sel[key] == v then tag, tcol = "fitted", 17
    elseif owned(key, v) then tag = "A: fit"
    elseif part.cost == -1 then tag = "find it"
    else tag = cost_text(part.cost); if not can_pay(part.cost) then tcol = 26 end end
    text(tag, 218, y + 17, tcol)
    y = y + 26
  end
  local r = PARTS[H.row]
  local part = r[2][H.view[r[3]]]
  if part.len then text(string.format("needs %.1f long, %.1f tall, %.1f wide", part.len, part.h, part.w), 10, 164, 29) end
end

function draw_fly()
  local p = problems()
  local y = 40
  text("PRE-FLIGHT", 218, y, 27)
  local checks = {
    {"Motor", fits(S.shape, "m", MOTORS[S.sel.m])}, {"Battery", fits(S.shape, "c", CELLS[S.sel.c])},
    {"Wings", plane_stats(S.shape, S.sel).lift >= 0.55},
  }
  if S.sel.g > 1 then checks[#checks + 1] = {"Cannons", guns_fit(S.shape)} end
  for i, c in ipairs(checks) do
    text((c[2] and "+ " or "x ") .. tr(c[1]), 218, y + 6 + i * 12, c[2] and 17 or 26)
  end
  if #p == 0 then
    rectfill(218, 106, 92, 16, gt % 30 < 20 and 27 or 10)
    text("A: FLY!", 236, 110, 1)
  end
  stat_bars(214, 128)
end

-- ------------------------------------------------------------------ flying
function pick_z(e)
  local gx, gy = ground(e)
  if e.name == "coil" or e.name == "scell" then return 64 * K_FLY + 10 end   -- on top of a tower
  if e.name == "satchel" then return 40 * K_FLY + 4 end         -- snagged on the wreck's mast
  if e.name == "ring" then return 34 + (gx * 7 + gy * 3) % 46 end
  if e.name == "balloon" then return 40 + (gx * 5 + gy * 3) % 50 + math.sin((gt + gx) * 0.03) * 3 end
  return hget(gx, gy) + 4 + math.sin((gt + gx) * 0.06) * 1.5
end
function key_of(e) return (LEVEL > 1 and LEVEL .. ":" or "") .. e.name .. math.floor(e.x) .. "," .. math.floor(e.y) end

-- the heights and the minimap belong to the level on screen; rebuilt when the level changes
function region_heights()
  if HLEVEL == LEVEL then return end
  HLEVEL = LEVEL
  local L = LEVELS[LEVEL]
  WW, WH = L.w * 8, L.h * 8
  build_heights(L.w, L.h)
end
-- after arriving in a region: its plane entity (for the speed stat), what's been collected, hawks and storms
function region_setup()
  region_heights()
  plane = ents_get("tinwing")
  stat_set(plane, "speed", P.st.speed)
  for _, e in ipairs(ents_all()) do
    if (PICK[e.name] or FLOAT[e.name]) and e.name ~= "ring" and S.got[key_of(e)] then e.alive = false end
    if (e.name == "coil" and S.coil) or (e.name == "scell" and S.storm) or (e.name == "satchel" and S.satchel) then e.alive = false end
    if e.name == "hawk" then
      local gx, gy = ground(e)
      e.data = {nx = gx, ny = gy, x = gx, y = gy, z = 70, vx = 0, vy = 0, vz = 0, a = gx * 0.01, mode = "circle", t = 0}
    end
    if e.name == "storm" then e.data = {next = gt + 60 + rnd(200), bolt = 0} end
  end
  SHOTS, POPS = {}, {}
  REGION_T = 150
end
-- fly off an edge into the next region (applied next frame, when the level has been swapped in)
function warp(n, x, y)
  if P.warp or not level(n) then return end
  P.warp = {n, x, y}
end

function fly_start()
  MODE = "fly"
  region_heights()
  local pad = ents_get("pad")
  PAD = {}
  PAD.x, PAD.y = ground(pad)
  local st = plane_stats(S.shape, S.sel)
  MODEL = plane_model(S.shape)
  PAINT = PAINTS[S.sel.p].c
  local px, py = PAD.x, PAD.y
  P = {x = px, y = py, z = hget(px, py) + 5, h = -math.pi / 4, pitch = 0.3, bank = 0, bv = 0, pv = 0, spd = 1.0, bat = 1, thr = 1,
    st = st, armed = false, launch = 50, t = 0, flat = false, out = 0, spin = 0, swim = 0, camp = 0.3, kx = 0, ky = 0}
  P.cam, P.cz, P.foc = P.h, P.z + F_UP, F_FOC
  region_setup()
  fx_clear(plane)
  REGION_T = 0
  SPRAY, TRAIL, SHOTS, POPS = {}, {}, {}, {}
  FLASH = 0
  GUN = S.sel.g > 1 and CANNONS[S.sel.g] or nil
  P.gun_cd = 0
  if S.flights == 0 and S.swims == 0 then msg("Hold A for the motor, let go to glide.", 240)
  elseif GUN and not S.shot_told then S.shot_told = true; msg("B fires the cannons. Pop the balloons!", 240)
  else msg(objective(), 200) end
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
  if P.warp then
    if LEVEL ~= P.warp[1] then return end
    P.x, P.y = P.warp[2], P.warp[3]
    P.warp = nil
    region_setup()
    P.cam = P.h
  end
  P.t = P.t + 1
  if MSG_T > 0 then MSG_T = MSG_T - 1 end
  if REGION_T > 0 then REGION_T = REGION_T - 1 end
  if FLASH > 0 then FLASH = FLASH - 1 end
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
  P.x = P.x + math.cos(P.h) * math.cos(P.pitch) * P.spd + P.kx
  P.y = P.y + math.sin(P.h) * math.cos(P.pitch) * P.spd + P.ky
  P.kx, P.ky = P.kx * 0.93, P.ky * 0.93       -- a shove from a hawk or a gust fades out
  P.z = math.min(CEIL, P.z + vz)
  if P.z >= CEIL and MSG ~= "The radio won't reach any higher." then msg("The radio won't reach any higher.", 90) end
  P.bat = math.max(0, P.bat - P.thr * BASE_DRAIN * st.drain)
  P.spin = P.spin + 0.3 + P.thr * 1.2
  if gt % 4 == 0 then tone(70 + P.thr * 90 + P.spd * 20, 2, 0.03 + P.thr * 0.05, 6, 7) end
  -- the edges: into the next region where there is one, otherwise the wind turns you back, gently
  local R = REG[LEVEL]
  if R.e and P.x > WW - 4 then warp(R.e, 6, P.y) elseif R.w and P.x < 4 then warp(R.w, WW - 6, P.y)
  elseif R.n and P.y < 4 then warp(R.n, P.x, WH - 6) elseif R.s and P.y > WH - 4 then warp(R.s, P.x, 6) end
  P.x, P.y = clamp(P.x, 2, WW - 2), clamp(P.y, 2, WH - 2)
  if (P.x < 48 and not R.w) or (P.y < 48 and not R.n) or (P.x > WW - 48 and not R.e) or (P.y > WH - 48 and not R.s) then
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
  hawks_update()
  storms_update()
  -- wingtip trails: a short ribbon of puffs that shows off every turn
  orient(P)
  shoot_update()
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
  if dp > 120 or LEVEL ~= 1 then P.armed = true end
  if LEVEL == 1 and P.armed and dp < 30 and P.z < hget(PAD.x, PAD.y) + 26 then
    sfx("C5", 1, 0.3, 8); sfx("G5", 1, 0.3, 12)
    hangar_enter("land")
  end
end

-- the wing cannons: B fires a ball from each wing, straight ahead; balloons pop when one comes close
function shoot_update()
  if P.gun_cd > 0 then P.gun_cd = P.gun_cd - 1 end
  if GUN and btn("b") and P.gun_cd == 0 and P.launch == 0 then
    P.gun_cd = GUN.rate
    local u = S.place.g
    local f, _, wz = wing_chord(S.shape, u)
    local fx, fy, fz = math.cos(P.h) * P.cp, math.sin(P.h) * P.cp, P.sp
    local v = P.spd + GUN.speed
    for side = -1, 1, 2 do
      local x, y, z = body_to_world(P, f + 1, u * side, wz - 0.6)
      SHOTS[#SHOTS + 1] = {x = x, y = y, z = z, vx = fx * v, vy = fy * v, vz = fz * v, t = 0}
    end
    sfx(S.sel.g == 2 and "C6" or "G3", 3, 0.25, 3, nil, 0, -200)
  end
  for i = #SHOTS, 1, -1 do
    local b = SHOTS[i]
    b.x, b.y, b.z, b.vz, b.t = b.x + b.vx, b.y + b.vy, b.z + b.vz, b.vz - 0.03, b.t + 1
    local gone = b.t > 45 or b.z < hget(b.x, b.y)
    for _, e in ipairs(ents_all("balloon")) do
      local gx, gy = ground(e)
      local dx, dy, dz = b.x - gx, b.y - gy, b.z - pick_z(e) - 20
      if dx * dx + dy * dy + dz * dz < GUN.r * GUN.r + 100 then pop(e) gone = true end
    end
    for _, e in ipairs(ents_all("hawk")) do
      local h = e.data
      if h.x then
        local dx, dy, dz = b.x - h.x, b.y - h.y, b.z - h.z
        if dx * dx + dy * dy + dz * dz < GUN.r * GUN.r + 64 then
          if h.mode ~= "flee" or h.t < 300 then msg("Shoo! The hawk flaps off.", 70); sfx("A6", 3, 0.2, 4, nil, 0, 500) end
          h.mode, h.t = "flee", 400
          gone = true
        end
      end
    end
    if gone then table.remove(SHOTS, i) end
  end
  for i = #POPS, 1, -1 do
    local p = POPS[i]
    p.x, p.y, p.z, p.vz, p.t = p.x + p.vx, p.y + p.vy, p.z + p.vz, p.vz - 0.08, p.t + 1
    if p.t > 30 then table.remove(POPS, i) end
  end
end
function pop(e)
  if not e.alive then return end
  e.alive = false
  S.got[key_of(e)] = true
  local gx, gy = ground(e)
  local z = pick_z(e) + 20
  for i = 1, 12 do
    POPS[#POPS + 1] = {x = gx, y = gy, z = z, vx = math.cos(i * 0.52) * 1.2, vy = math.sin(i * 0.52) * 1.2, vz = 0.6 + (i % 3) * 0.4, t = 0,
      c = ({26, 27, 13})[i % 3 + 1]}
  end
  give("silk", 1, "Pop! ")
  sfx("E6", 3, 0.3, 4, nil, 0, -600); sfx("A5", 1, 0.3, 6)
end

-- ------------------------------------------------------------------ hawks
-- they circle their nest; when you come close one dives at you, and a hit shoves the plane off course
-- (how far depends on the skin). Then it flies off for a while. A cannon ball scares it away.
function hawks_update()
  for _, e in ipairs(ents_all("hawk")) do
    local h = e.data
    if h.x then
      local dx, dy, dz = P.x - h.x, P.y - h.y, P.z - h.z
      local d = math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01
      local tx, ty, tz, sp, turn
      if h.mode == "circle" then
        h.a = h.a + 0.018
        tx, ty, tz, sp, turn = h.nx + math.cos(h.a) * 56, h.ny + math.sin(h.a) * 56, 70 + math.sin(h.a * 2) * 6, 1.3, 0.08
        if h.t > 0 then h.t = h.t - 1 end
        if d < 230 and h.t == 0 and P.swim == 0 then h.mode, h.t = "dive", 0; sfx("E6", 3, 0.35, 10, nil, 0, -900) end
      elseif h.mode == "dive" then
        h.t = h.t + 1
        tx, ty, tz, sp, turn = P.x + math.cos(P.h) * P.spd * 8, P.y + math.sin(P.h) * P.spd * 8, P.z, 2.5, 0.07
        if d < 11 then
          -- hit! a shove the way the hawk was flying, a kick to the bank and the heading
          local k = P.st.shove
          local hv = math.sqrt(h.vx * h.vx + h.vy * h.vy) + 0.01
          P.kx, P.ky = P.kx + h.vx / hv * 2.4 * k, P.ky + h.vy / hv * 2.4 * k
          local side = (h.vx * math.sin(P.h) - h.vy * math.cos(P.h)) > 0 and -1 or 1
          P.bv, P.h, P.pv = P.bv + side * 0.13 * k, P.h + side * 0.22 * k, P.pv - 0.03 * k
          msg("A hawk! Knocked off course!", 90)
          sfx("C3", 3, 0.4, 6); sfx("F6", 3, 0.25, 4)
          h.mode, h.t = "flee", 240
        elseif h.t > 200 then h.mode, h.t = "flee", 120 end
      else
        h.t = h.t - 1
        tx, ty, tz, sp, turn = h.x - dx * 3, h.y - dy * 3, 140, 2.0, 0.05
        if h.t <= 0 then h.mode, h.t = "circle", 120 end
      end
      local ex, ey, ez = tx - h.x, ty - h.y, tz - h.z
      local el = math.sqrt(ex * ex + ey * ey + ez * ez) + 0.01
      h.vx = h.vx + (ex / el * sp - h.vx) * turn
      h.vy = h.vy + (ey / el * sp - h.vy) * turn
      h.vz = h.vz + (ez / el * sp - h.vz) * turn
      h.x, h.y, h.z = h.x + h.vx, h.y + h.vy, h.z + h.vz
    end
  end
end

-- ------------------------------------------------------------------ thunder cells
-- inside one the air is rough; every few seconds lightning strikes, and if it hits the plane the battery charges
function storms_update()
  P.inside = nil
  for _, e in ipairs(ents_all("storm")) do
    local c = e.data
    if c.next then
      local gx, gy = ground(e)
      local dx, dy = P.x - gx, P.y - gy
      local d = math.sqrt(dx * dx + dy * dy)
      local inside = d < STORM_R and P.z > STORM_LO - 25
      if inside then
        P.inside = e
        local a = (1 - d / STORM_R) * 0.6 + 0.4
        local k = a * P.st.shove
        P.bv = P.bv + (rnd() - 0.5) * 0.06 * k
        P.pv = P.pv + (rnd() - 0.5) * 0.035 * k
        P.z = P.z + (rnd() - 0.5) * 1.2 * k
        P.kx, P.ky = P.kx + (rnd() - 0.5) * 0.25 * k, P.ky + (rnd() - 0.5) * 0.25 * k
      end
      if c.bolt > 0 then c.bolt = c.bolt - 1 end
      if gt >= c.next then
        c.next = gt + 120 + rnd(180)
        c.bolt = 8
        if inside and rnd() < 0.6 then
          -- struck! the motor's coils soak it up
          c.bx, c.by, c.bz = P.x, P.y, P.z
          P.bat = math.min(1, P.bat + 0.3)
          P.flat = false
          P.bv, P.pv = P.bv + (rnd() - 0.5) * 0.3, P.pv - 0.05
          FLASH = 4
          msg("ZAP! Lightning charged the battery!", 120)
          sfx("C2", 3, 0.5, 30, nil, 0, -200); sfx("C7", 3, 0.3, 6, nil, 0, -2000)
        else
          local a, r = rnd() * TAU, rnd() * STORM_R * 0.8
          c.bx, c.by, c.bz = gx + math.cos(a) * r, gy + math.sin(a) * r, 0
          if d < STORM_R * 3 then sfx("C2", 3, 0.3 * (1 - d / (STORM_R * 3)) + 0.05, 24, nil, 0, -100) end
        end
      end
    end
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
  if e.name == "crate" or e.name == "log" or e.name == "cbox" then
    give(({crate = "scrap", log = "balsa", cbox = "copper"})[e.name], 2)
    sfx("A5", 1, 0.3, 4); sfx("E6", 1, 0.3, 6)
  elseif e.name == "coil" then
    S.coil = true
    S.own.c3 = true
    msg("A TWIN CELL! Take it home to the hangar.", 300)
    sfx("C5", 4, 0.4, 10); sfx("E5", 4, 0.4, 14); sfx("G5", 4, 0.4, 18)
  elseif e.name == "scell" then
    S.storm = true
    S.own.c6 = true
    msg("A STORM CELL! It hums. Take it home.", 300)
    sfx("C5", 4, 0.4, 10); sfx("G5", 4, 0.4, 14); sfx("C6", 4, 0.4, 18)
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
  if P.warp then cls(20) text(REG[P.warp[1]].name, 160 - #REG[P.warp[1]].name * 4, 116, 13) return end
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
  -- inside a thunder cell the light goes grey
  local dark = P.inside ~= nil
  if dark then pal(20, 19); pal(21, 19); pal(22, 20); pal(23, 21); pal(13, 29); pal(14, 28) end
  draw_sky(hor, P.cam * foc)
  if not dark then water_pal() end
  floorh(camx, camy, P.cam, camz, hor, foc, 20, STEP)
  pal()
  local g = hget(P.x, P.y)
  local sx, sy, k = proj(P.x, P.y, g)
  if sx then ellipse(sx, sy, 9 * k, 19) end
  local list = {}
  for _, e in ipairs(ents_all()) do
    if e.name == "hawk" and e.data.x then
      local px, py, kk, d = proj(e.data.x, e.data.y, e.data.z)
      if px and kk > 0.02 then list[#list + 1] = {e = e, sx = px, sy = py, k = kk, d = d} end
    elseif e.name == "storm" and e.data.next then
      local gx, gy = ground(e)
      local px, py, kk, d = proj(gx, gy, STORM_LO + 50)
      if px and kk > 0.02 and kk < 2.2 then list[#list + 1] = {e = e, sx = px, sy = py, k = kk, d = d} end
    elseif DRAW[e.name] or e.name == "ring" or e.name == "pigeon" then
      local gx, gy = ground(e)
      local z = (PICK[e.name] or FLOAT[e.name]) and pick_z(e) or hget(gx, gy)
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
  -- lightning: a jagged line from the cloud down to where it struck
  for _, e in ipairs(ents_all("storm")) do
    local c = e.data
    if c.bolt and c.bolt > 0 and c.bx then
      local x0, y0 = proj(c.bx, c.by, STORM_LO + 10)
      local x1, y1 = proj(c.bx, c.by, c.bz)
      if x0 and x1 then
        local px, py = x0, y0
        for i = 1, 6 do
          local nx, ny = x0 + (x1 - x0) * i / 6 + (i < 6 and (rnd() - 0.5) * 14 or 0), y0 + (y1 - y0) * i / 6
          line(px, py, nx, ny, c.bolt > 4 and 13 or 27)
          px, py = nx, ny
        end
      end
    end
  end
  if P.inside then
    for i = 0, 39 do      -- rain
      local x = (i * 37 + gt * 3) % 330 - 5
      local y = (i * 53 + gt * 9) % 250 - 10
      line(x, y, x - 2, y + 7, 28)
    end
  end
  for _, s in ipairs(SPRAY) do
    local x, y, k = proj(s.x, s.y, s.z)
    if x then circfill(x, y, math.max(1, k * 1.2), 23) end
  end
  for _, p in ipairs(POPS) do
    local x, y, k = proj(p.x, p.y, p.z)
    if x then rectfill(x, y, math.max(1, k * 1.5), math.max(1, k), p.c) end
  end
  for _, b in ipairs(SHOTS) do
    local x, y, k = proj(b.x, b.y, b.z)
    if x then circfill(x, y, math.max(1, k * (S.sel.g == 2 and 0.8 or 1.4)), 31); if k > 1 then pset(x - k * 0.3, y - k * 0.3, 29) end end
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
  if e.name == "storm" then
    -- a heap of dark puffs; it lights up when lightning strikes
    local lit = e.data.bolt > 5
    local c1, c2 = lit and 13 or 30, lit and 29 or 31
    local r = STORM_R * k
    for i = 0, 6 do
      local a = i * 0.9 + gt * 0.004
      circfill(it.sx + math.cos(a) * r * 0.55, it.sy - 10 * k + math.sin(a * 1.3) * r * 0.22, r * (0.38 + (i % 3) * 0.06), i % 2 == 0 and c1 or c2)
    end
    circfill(it.sx, it.sy - 26 * k, r * 0.45, c1)
    return
  end
  if e.name == "hawk" then
    local fr = (e.data.mode == "dive") and 106 or (((gt // 6) % 2 == 0) and 104 or 106)
    sspr(fr, it.sx - 8 * k * 1.3, it.sy - 4 * k * 1.3, 2, 1, k * 1.3)
    return
  end
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
  local s = k * ((PICK[e.name] or FLOAT[e.name]) and 1.3 or K_FLY)
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
  rectfill(4, 38, 64, 10, 1)
  text(S.mat.scrap .. "S " .. S.mat.copper .. "C", 6, 39, 13)
  local mx, my = 264, 4
  rectfill(mx - 1, my - 1, 54, 28, 1)
  rectfill(mx, my, 52, 26, 19)
  for _, p in ipairs(MINI or {}) do pset(mx + p[1], my + p[2], p[3]) end
  if LEVEL == 1 then pset(mx + PAD.x // 40, my + PAD.y // 40, 27) end
  for _, e in ipairs(ents_all("tower")) do local x, y = ground(e) rectfill(mx + x // 40, my + y // 40 - 1, 1, 2, 13) end
  if S.coil and not S.satchel then
    for _, e in ipairs(ents_all("wreck")) do local x, y = ground(e) if gt % 40 < 26 then pset(mx + x // 40, my + y // 40, 26) end end
  end
  if gt % 20 < 14 then
    local x, y = mx + P.x // 40, my + P.y // 40
    pset(x, y, 13); pset(x + math.cos(P.h) * 2, y + math.sin(P.h) * 2, 13)
  end
  if P.launch > 20 then text("LAUNCH!", 132, 60, 27) end
  text(REG[LEVEL].name, 316 - #REG[LEVEL].name * 8, my + 32, 29)
  if REGION_T > 0 and REGION_T < 140 then text(REG[LEVEL].name, 160 - #REG[LEVEL].name * 4, 70, 13) end
  for _, e in ipairs(ents_all("hawk")) do
    if e.data.mode == "dive" and gt % 16 < 10 then text("HAWK!", 140, 50, 26) break end
  end
  if FLASH > 0 then rectfill(0, 0, 320, 240, FLASH > 2 and 13 or 27) end
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
-- this game's words in other languages (the Bit's language, LANGUAGE in Settings; runtime/bk_lang.lua)
texts{
  de = {
    ["Hummer"] = "Summer",
    ["Small and quiet."] = "Klein und leise.",
    ["Buzzer"] = "Brummer",
    ["Faster. Needs a fatter nose."] = "Schneller. Braucht eine dickere Nase.",
    ["Roarer"] = "Dröhner",
    ["Very fast, and big."] = "Sehr schnell, und groß.",
    ["Single Cell"] = "Einzelzelle",
    ["Gets you to the Belltower and back."] = "Reicht bis zum Glockenturm und zurück.",
    ["Twin Cell"] = "Zwillingszelle",
    ["Twice the range, twice as wide."] = "Doppelte Reichweite, doppelt so breit.",
    ["Brick Cell"] = "Ziegelzelle",
    ["Long and tall. A bit more range."] = "Lang und hoch. Etwas mehr Reichweite.",
    ["Tin"] = "Blech",
    ["Sunrise"] = "Morgenrot",
    ["Lagoon"] = "Lagune",
    ["Moss"] = "Moos",
    ["Cherry"] = "Kirsche",
    ["Plum"] = "Pflaume",
    ["Motor"] = "Motor",
    ["Battery"] = "Akku",
    ["Paint"] = "Farbe",
    ["SIDE"] = "SEITE",
    ["TOP"] = "OBEN",
    ["PARTS"] = "TEILE",
    ["FLY"] = "FLIEG",
    ["Front"] = "Vorne",
    ["Middle"] = "Mitte",
    ["Back"] = "Hinten",
    ["Front top"] = "Vorne oben",
    ["Front bottom"] = "Vorne unten",
    ["Front width"] = "Vorne Breite",
    ["Middle top"] = "Mitte oben",
    ["Middle bottom"] = "Mitte unten",
    ["Middle width"] = "Mitte Breite",
    ["Back top"] = "Hinten oben",
    ["Back bottom"] = "Hinten unten",
    ["Back width"] = "Hinten Breite",
    ["Build an RC plane, find the mail satchel lost past the Drowned Belltower and fly it home to Perch."] = "Bau ein RC-Flugzeug, finde die Posttasche hinter dem Versunkenen Glockenturm und flieg sie heim nach Perch.",
    ["Hangar: pick a corner with the D-pad, A grabs it, move it, A drops it. L / R or X: next page."] = "Hangar: Wähl eine Ecke mit dem Steuerkreuz, A packt sie, bewegen, A lässt los. L / R oder X: nächste Seite.",
    ["Make the body big enough for your motor and battery. More wing glides, short wings turn quick."] = "Mach den Rumpf groß genug für Motor und Akku. Mehr Flügel gleitet, kurze Flügel wenden schnell.",
    ["Flying: left / right turn, up / down climb and dive (Settings: Invert up/down). Hold A or squeeze R for the motor."] = "Fliegen: links / rechts lenken, hoch / runter steigen und sinken (Einstellungen: Hoch/runter tauschen). A halten oder R drücken für den Motor.",
    ["Let go of the motor to glide for free. Fly low over the yellow pad at Perch to land."] = "Lass den Motor los, um gratis zu gleiten. Flieg tief über die gelbe Fläche in Perch, um zu landen.",
    ["Back to the hangar"] = "Zurück zum Hangar",
    ["Reset the blueprint"] = "Bauplan zurücksetzen",
    ["Invert up/down"] = "Hoch/runter tauschen",
    ["Explore the Shallows. Scrap: #"] = "Untiefen erkunden. Schrott: #",
    ["Fly the satchel home to Perch!"] = "Flieg die Tasche heim nach Perch!",
    ["Fly east, past the Drowned Belltower."] = "Nach Osten, am Glockenturm vorbei.",
    ["Widen the body and fit the Twin Cell."] = "Rumpf breiter, Doppelzelle rein.",
    ["Find the mail satchel out past the reef."] = "Finde die Posttasche hinterm Riff.",
    ["The %s doesn't fit in the nose."] = "%s passt nicht in die Nase.",
    ["The %s doesn't fit in the body."] = "%s passt nicht in den Rumpf.",
    ["The wings are too small to lift her."] = "Die Flügel sind zu klein zum Tragen.",
    ["Landed! %s"] = "Gelandet! %s",
    ["You flew the lost mail home to Perch."] = "Die Post ist heil zurück in Perch.",
    ["Nose"] = "Nase",
    ["Nose top"] = "Nase oben",
    ["Nose bottom"] = "Nase unten",
    ["Nose width"] = "Nase Breite",
    ["Tail"] = "Heck",
    ["Tail top"] = "Heck oben",
    ["Tail bottom"] = "Heck unten",
    ["Tail width"] = "Heck Breite",
    ["Wing root, front"] = "Flügelansatz, vorne",
    ["Wing root, back"] = "Flügelansatz, hinten",
    ["Wing tip, front"] = "Flügelspitze, vorne",
    ["Wing tip, back"] = "Flügelspitze, hinten",
    ["%s fitted."] = "%s eingebaut.",
    ["You'll have to find that one out there."] = "Das musst du draußen finden.",
    ["Bought and fitted the %s!"] = "%s gekauft und eingebaut!",
    ["You need %d scrap for that."] = "Dafür brauchst du %d Schrott.",
    ["Moving: "] = "Bewegen: ",
    ["Speed"] = "Tempo",
    ["Turning"] = "Wenden",
    ["Glide"] = "Gleiten",
    ["Range"] = "Weite",
    ["PIP'S HANGAR"] = "PIPS HANGAR",
    ["Pick a corner: D-pad. A: grab / drop."] = "Ecke: Kreuz. A: packen / loslassen",
    ["Up / down: part. Left / right: browse. A: fit."] = "Teil: hoch/runter. Wahl: links/rechts.",
    ["A: launch from the ramp!"] = "A: von der Rampe starten!",
    ["She's ready to fly."] = "Sie ist startklar.",
    ["fits"] = "passt",
    ["big!"] = "groß!",
    ["fitted"] = "drin",
    ["A: fit"] = "A: einbauen",
    ["find it"] = "finden",
    ["# scrap"] = "# Schrott",
    ["needs # long, # tall, # wide"] = "braucht # lang, # hoch, # breit",
    ["PRE-FLIGHT CHECK"] = "VORFLUG-CHECK",
    ["Motor fits"] = "Motor passt",
    ["Battery fits"] = "Akku passt",
    ["Wings lift"] = "Flügel tragen",
    ["A: FLY!"] = "A: FLIEG!",
    ["Hold A for the motor, let go to glide."] = "A halten: Motor. Loslassen: gleiten.",
    ["Battery flat! Glide home if you can..."] = "Akku leer! Gleite heim, wenn's geht...",
    ["The radio won't reach any higher."] = "Höher reicht der Funk nicht.",
    ["Strong winds out here. Turn back!"] = "Starker Wind hier. Kehr um!",
    ["Skimming the waves! Nose up."] = "Du streifst die Wellen! Nase hoch.",
    ["Bump! Climb over the islands."] = "Rumms! Flieg über die Inseln.",
    ["Clang! Fly over the tower, not into it."] = "Klong! Über den Turm, nicht rein.",
    ["Tailwind!"] = "Rückenwind!",
    ["Scrap +2"] = "Schrott +2",
    ["A TWIN CELL! Take it home to the hangar."] = "DOPPELZELLE! Bring sie zum Hangar.",
    ["THE MAIL SATCHEL! Fly it home to Perch."] = "DIE POSTTASCHE! Flieg sie nach Perch.",
    ["Sploosh. Tobin will fish you out..."] = "Platsch. Tobin fischt dich raus...",
    ["BATT"] = "AKKU",
    ["ALT #"] = "HÖHE #",
    ["LAUNCH!"] = "START!",
    ["Perch. A town on stilts, on a world that is nearly all sea. Letters go by pigeon. People go by boat."] = "Perch. Eine Stadt auf Stelzen, auf einer Welt, die fast nur Meer ist. Briefe reisen per Taube. Menschen per Boot.",
    ["And one day, everything will go by plane. My planes."] = "Und eines Tages reist alles per Flugzeug. Mit meinen Flugzeugen.",
    ["Pip! Pepper came home last night without her mail satchel."] = "Pip! Pepper kam gestern Nacht ohne ihre Posttasche heim.",
    ["The squall blew it off somewhere east, past the Drowned Belltower. Half the town's letters are in it."] = "Die Bö hat sie nach Osten geweht, hinter den Versunkenen Glockenturm. Die halbe Post der Stadt ist drin.",
    ["The reef is too rough for boats this month. But a plane could fly right over it."] = "Das Riff ist diesen Monat zu rau für Boote. Aber ein Flugzeug könnte einfach drüberfliegen.",
    ["Leave it to me! She just needs a body that fits her motor and battery."] = "Überlass das mir! Sie braucht nur einen Rumpf, in den Motor und Akku passen.",
    ["Shape the plane on the blueprint: grab a corner with A, move it, drop it with A. Then FLY."] = "Form das Flugzeug auf dem Bauplan: Ecke mit A packen, bewegen, mit A loslassen. Dann FLIEG.",
    ["Is that a Twin Cell? Lighthouse stock, from before the water rose!"] = "Ist das eine Doppelzelle? Leuchtturm-Ware, von bevor das Wasser stieg!",
    ["It was on top of the Belltower. But it's twice as wide as my old battery..."] = "Sie lag oben auf dem Glockenturm. Aber sie ist doppelt so breit wie mein alter Akku...",
    ["Then make her body wider. With that, you'll reach the reef and back."] = "Dann mach ihren Rumpf breiter. Damit schaffst du es zum Riff und zurück.",
    ["Found her bobbing out there like a cork. Dried her off for you."] = "Hab sie da draußen treiben sehen wie einen Korken. Ich hab sie dir abgetrocknet.",
    ["Mind your battery, Pip. Climb high, then glide: gliding is free."] = "Achte auf den Akku, Pip. Steig hoch, dann gleite: Gleiten kostet nichts.",
    ["The satchel! And the letters are dry!"] = "Die Tasche! Und die Briefe sind trocken!",
    ["Snagged on an old mast out on the reef. Easy... mostly."] = "Hing an einem alten Mast draußen am Riff. Ganz leicht... meistens.",
    ["Pip, how would you like a job? Perch could use a mail plane."] = "Pip, wie wär's mit einem Job? Perch könnte ein Postflugzeug brauchen.",
    ["Thanks for playing Tinwing! Keep flying to find the rest of the scrap."] = "Danke fürs Spielen von Tinwing! Flieg weiter, um den restlichen Schrott zu finden.",
    ["No cannons"] = "Keine Kanonen",
    ["Clean wings, nothing to carry."] = "Freie Flügel, nichts zu tragen.",
    ["Cork Popper"] = "Korkknaller",
    ["Toy cannons for the wings. B: pop balloons!"] = "Spielzeugkanonen für die Flügel. B: Ballons knallen!",
    ["Puff Mortar"] = "Puffmörser",
    ["Heavy, slow, and pops anything near it."] = "Schwer, langsam, und knallt alles in der Nähe.",
    ["Cannons"] = "Kanonen",
    ["Make the body big enough for your motor and battery, and grab M or B to move them. The motor stays in the front."] = "Mach den Rumpf groß genug für Motor und Akku, und pack M oder B, um sie zu verschieben. Der Motor bleibt vorne.",
    ["More wing glides, short wings turn quick. Cannons go on the wings: B fires them at balloons."] = "Mehr Flügel gleitet, kurze Flügel wenden schnell. Kanonen kommen auf die Flügel: B schießt auf Ballons.",
    ["%s sticks out of the body."] = "%s ragt aus dem Rumpf.",
    ["%s: too tall. Raise it on SIDE."] = "%s: zu hoch. Auf SEITE erhöhen.",
    ["%s: too wide. Widen it on TOP."] = "%s: zu breit. Auf OBEN verbreitern.",
    ["The motor must sit in the front half."] = "Der Motor muss vorne sitzen.",
    ["Motor and battery overlap. Move one."] = "Motor und Akku überlappen. Schieb einen.",
    ["Cannons must sit on the wings (TOP)."] = "Kanonen gehören auf die Flügel (OBEN).",
    ["The motor has to stay in the front."] = "Der Motor muss vorne bleiben.",
    ["D-pad: pick a corner or part. A: grab."] = "Kreuz: Ecke oder Teil wählen. A: packen.",
    ["off!"] = "daneben!",
    ["PRE-FLIGHT"] = "VORFLUG",
    ["Wings"] = "Flügel",
    ["B fires the cannons. Pop the balloons!"] = "B feuert die Kanonen. Knall die Ballons!",
    ["Pop! Scrap +#"] = "Plopp! Schrott +#",
    ["Whirr"] = "Surrer",
    ["A little faster. A little fatter."] = "Etwas schneller. Etwas dicker.",
    ["Zinger"] = "Flitzer",
    ["Quick off the ramp, thirsty."] = "Schnell von der Rampe, durstig.",
    ["Double Cell"] = "Doppelzelle",
    ["A bit more range for a bit more width."] = "Etwas mehr Reichweite für etwas mehr Breite.",
    ["Lighthouse stock. Reaches the Reef."] = "Leuchtturm-Ware. Reicht bis zum Riff.",
    ["Long and tall. Good range."] = "Lang und hoch. Gute Reichweite.",
    ["Deep Cell"] = "Tiefzelle",
    ["Reaches the far end of the Reef."] = "Reicht bis ans Ende des Riffs.",
    ["Storm Cell"] = "Sturmzelle",
    ["Glows faintly. Huge range."] = "Glüht leicht. Riesige Reichweite.",
    ["B fires: pops balloons, shoos hawks."] = "B feuert: knallt Ballons, verscheucht Falken.",
    ["Heavy, but hard to push around."] = "Schwer, aber kaum zu schubsen.",
    ["Balsa"] = "Balsa",
    ["Lighter: glides and climbs better."] = "Leichter: gleitet und steigt besser.",
    ["Silk"] = "Seide",
    ["Featherweight. Hawks toss her about."] = "Federleicht. Falken werfen sie herum.",
    ["Skin"] = "Bespannung",
    ["The Shallows"] = "Die Untiefen",
    ["The Reef"] = "Das Riff",
    ["Thunderhead"] = "Gewitterturm",
    ["Scrap"] = "Schrott",
    ["Copper"] = "Kupfer",
    ["Explore! Storms north, hawks east."] = "Erkunde! Stürme im Norden, Falken im Osten.",
    ["Find the Twin Cell on the Belltower."] = "Finde die Zelle auf dem Glockenturm.",
    ["Need range: Deep Cell or Storm Cell."] = "Mehr Reichweite: Tief- oder Sturmzelle.",
    ["Find the satchel at the Reef's far end."] = "Finde die Tasche am Ende des Riffs.",
    ["Built and fitted: %s!"] = "Gebaut und eingebaut: %s!",
    ["You need %s for that."] = "Dafür brauchst du %s.",
    ["free"] = "gratis",
    ["Shoo! The hawk flaps off."] = "Husch! Der Falke flattert davon.",
    ["Pop! "] = "Plopp! ",
    ["A hawk! Knocked off course!"] = "Ein Falke! Vom Kurs gestoßen!",
    ["ZAP! Lightning charged the battery!"] = "ZACK! Der Blitz lädt den Akku!",
    ["A STORM CELL! It hums. Take it home."] = "EINE STURMZELLE! Sie summt. Bring sie heim.",
    ["HAWK!"] = "FALKE!",
  },
}
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

  // a party balloon with a little bag of scrap hanging under it: the cannons' targets
  function balloon() {
    const g = G(16, 24);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 6.5, dy = (y - 6.5) / 6.8;
      if (dx * dx + dy * dy <= 1) g[y][x] = (dx > 0.35 || dy > 0.55) ? 25 : 26;
    }
    R(4, 3, 2, 3, 13); px(g, 6, 2, 13);
    R(7, 13, 2, 2, 25);
    for (let y = 15; y < 18; y++) px(g, 8 - (y & 1), y, 29);
    R(5, 18, 6, 5, 7); R(5, 18, 6, 1, 6); R(7, 20, 2, 1, 28);
    return outline(g);
  }

  // driftwood: a bundle of balsa logs tied with rope
  function logs() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    for (const [y, x0, x1] of [[6, 2, 13], [9, 1, 14], [12, 3, 12]]) { R(x0, y, x1 - x0, 3, 12); R(x0, y, x1 - x0, 1, 13); R(x1 - 1, y, 1, 3, 11); px(g, x1 - 1, y + 1, 7); }
    R(5, 5, 1, 10, 7); R(10, 5, 1, 10, 7);
    return outline(g);
  }
  // a salvage box of copper wire from the wrecks
  function copperBox() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(2, 6, 12, 8, 20); R(2, 6, 12, 1, 21); R(2, 13, 12, 1, 19);
    for (let i = 0; i < 4; i++) { R(4 + i * 2, 3 + (i % 2), 2, 4, 10); px(g, 4 + i * 2, 3 + (i % 2), 13); }
    R(6, 9, 4, 2, 10);
    return outline(g);
  }
  // the Storm Cell: a glowing jar
  function stormCell() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(4, 2, 8, 2, 29); R(3, 4, 10, 10, 22); R(4, 5, 8, 8, 23); R(3, 13, 10, 2, 29);
    for (const [x, y] of [[7, 5], [6, 6], [8, 7], [7, 8], [6, 9], [8, 10], [7, 11]]) px(g, x, y, 13);
    return outline(g);
  }
  // a hawk seen from behind, wings up (f 0) or swept back in a dive (f 1)
  function hawk(f) {
    const g = G(16, 8);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(7, 2, 2, 5, 7); px(g, 7, 1, 6); px(g, 8, 1, 6);
    if (f === 0) { R(1, 1, 6, 2, 6); R(9, 1, 6, 2, 6); R(0, 0, 2, 1, 29); R(14, 0, 2, 1, 29); }
    else { R(3, 4, 4, 2, 6); R(9, 4, 4, 2, 6); }
    px(g, 7, 7, 8); px(g, 8, 7, 8);
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
    blit(120, crate()); blit(122, coil()); blit(124, satchel()); blit(70, balloon());
    blit(72, logs()); blit(74, copperBox()); blit(78, stormCell()); blit(104, hawk(0)); blit(106, hawk(1));
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
        thing('crate', 120, 2, 2), thing('coil', 122, 2, 2), thing('satchel', 124, 2, 2), thing('balloon', 70, 2, 3),
        thing('log', 72, 2, 2), thing('cbox', 74, 2, 2), thing('scell', 78, 2, 2),
        Object.assign({}, base, { name: 'hawk', sw: 2, sh: 1, anims: [A('idle', [104, 106], 6)], tree: null }),
        thing('storm', 27, 2, 2),
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
        say('mags', 'The squall blew it far out east, past the Belltower, over the Reef. Half the town\'s letters are in it.'),
        say('tobin', 'The reef is too rough for boats this month. But a plane could fly right over it.'),
        say('pip', 'Leave it to me! She\'ll need a much bigger battery for that, though. And scrap. And copper.'),
        say('', 'Shape the plane on the blueprint: grab a corner with A, move it, drop it with A. Then FLY.'),
      ] },
      { name: 'coil_home', level: 0, steps: [
        say('tobin', 'Is that a Twin Cell? Lighthouse stock, from before the water rose!'),
        say('pip', 'It was on top of the Belltower. But it\'s twice as wide as my old battery...'),
        say('tobin', 'Make her body wider. It reaches the near Reef. For the far end, build a Deep Cell: copper from the wrecks, silk from balloons.'),
        say('tobin', 'Watch for hawks out there. And the thunder cells up north: rough air, but a lightning bolt tops the battery up.'),
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
        say('', 'Thanks for playing Tinwing! Keep flying: the Storm Cell is still out there, somewhere in Thunderhead.'),
      ] },
    ];

    const set = (m, x, y, t) => { m[y * W + x] = t; };
    const rect = (m, x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(m, x, y, t); };

    // ---- the world: three seas of 256x128 tiles, side by side (REG in the Lua): the Shallows with Perch in the
    // south-west, the Reef to the east of it, and Thunderhead to the north. Each is a level with its own map.
    const RW = 256, RH = 128;
    const newSea = (seed, deep) => {
      const m = new Uint16Array(W * 128);
      for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) set(m, x, y, hash(x, y, seed) < 0.2 ? 2 : (hash(x, y, seed + 1) < deep ? 15 : 1));
      return m;
    };
    const isle = (m, cx, cy, r, rocky) => {
      for (let y = cy - r - 3; y <= cy + r + 3; y++) for (let x = cx - r - 3; x <= cx + r + 3; x++) {
        if (x < 0 || y < 0 || x >= RW || y >= RH) continue;
        const a = Math.atan2(y - cy, x - cx);
        const rr = r * (1 + 0.22 * Math.sin(a * 3 + cx) + 0.12 * Math.sin(a * 5 + cy));
        const d = Math.hypot(x - cx, y - cy);
        if (d < rr - 2.2) set(m, x, y, rocky && d < rr * 0.4 ? 7 : (hash(x, y, 23) < 0.12 ? 6 : 5));
        else if (d < rr) set(m, x, y, 4);
        else if (d < rr + 1.6) set(m, x, y, 3);
      }
    };
    const reef = (m, x0, y0, x1, y1, f) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = Math.sin(x * 0.21 * f + y * 0.13) + Math.sin(y * 0.31 - x * 0.07 * f);
        if (v > 0.9) set(m, x, y, 14); else if (v > 0.3) set(m, x, y, 3);
      }
    };
    // every region has the plane's entity (its speed stat) and the people (their faces in the speech boxes)
    const common = (list, x, y) => {
      at(list, 'tinwing', x, y);
      at(list, 'pip', x + 24, y + 24); at(list, 'mags', x + 40, y + 24); at(list, 'tobin', x + 56, y + 24);
    };
    const palms = (list, islands) => islands.forEach(([cx, cy, r]) => {
      if (r < 5) return;
      [[-2, -1], [2, 1]].slice(0, r >= 7 ? 2 : 1).forEach(([dx, dy]) => at(list, 'palm', (cx + dx) * 8 + 4, (cy + dy) * 8 + 4));
    });
    const put = (list, type, pts) => pts.forEach(([x, y]) => at(list, type, x * 8, y * 8));

    // 1. the Shallows: home. Crates of scrap, driftwood on the palm islands, the Drowned Belltower with the Twin Cell
    const sea = newSea(21, 0.04);
    const islands = [[50, 92, 5, 0], [64, 74, 7, 1], [40, 50, 6, 0], [104, 106, 6, 0], [124, 44, 8, 1], [150, 84, 7, 0],
      [182, 104, 5, 1], [76, 22, 6, 0], [24, 22, 5, 1], [140, 118, 4, 0], [168, 60, 4, 0], [118, 80, 3, 0],
      [206, 30, 6, 0], [222, 76, 7, 1], [200, 112, 5, 0], [240, 104, 4, 0], [238, 46, 5, 0]];
    islands.forEach(i => isle(sea, ...i));
    // the drowned district: rooftops poking out of the water around the Belltower
    for (let by = 0; by < 5; by++) for (let bx = 0; bx < 5; bx++) {
      if (hash(bx, by, 24) < 0.22) continue;
      const x0 = 80 + bx * 6, y0 = 56 + by * 5;
      rect(sea, x0 - 1, y0 - 1, x0 + 4, y0 + 3, 3);
      rect(sea, x0, y0, x0 + 3, y0 + 2, hash(bx, by, 25) < 0.5 ? 11 : 12);
    }
    rect(sea, 91, 66, 95, 69, 13);
    // Perch, seen from the air: decks and the landing pad
    rect(sea, 18, 102, 36, 117, 3);
    rect(sea, 20, 104, 34, 106, 10); rect(sea, 26, 104, 28, 116, 8); rect(sea, 20, 112, 34, 115, 10); rect(sea, 30, 107, 34, 111, 10);
    rect(sea, 25, 107, 29, 110, 10);
    set(sea, 26, 108, 18); set(sea, 27, 108, 19); set(sea, 26, 109, 20); set(sea, 27, 109, 21);
    const splaced = [];
    const padx = 27 * 8, pady = 109 * 8;
    at(splaced, 'pad', padx, pady);
    common(splaced, padx, pady);
    at(splaced, 'house_a', 21 * 8, 106 * 8); at(splaced, 'house_b', 21 * 8, 111 * 8);
    at(splaced, 'loft', 33 * 8, 113 * 8); at(splaced, 'shed', 22 * 8, 114 * 8); at(splaced, 'house_a', 30 * 8, 116 * 8);
    at(splaced, 'boat', 37 * 8, 114 * 8);
    at(splaced, 'tower', 93 * 8, 68 * 8);
    at(splaced, 'coil', 93 * 8, 68 * 8);
    put(splaced, 'crate', [[40, 100], [56, 86], [72, 62], [44, 40], [86, 54], [102, 78], [110, 100], [128, 34], [146, 90], [162, 62], [80, 28], [186, 98],
      [96, 62], [20, 26], [214, 92], [232, 60], [196, 14]]);
    put(splaced, 'log', [[64, 70], [124, 40], [150, 80], [222, 72], [40, 46]]);
    put(splaced, 'ring', [[42, 96], [62, 86], [84, 74], [118, 62], [140, 48], [160, 36], [70, 40], [130, 96], [200, 70], [236, 90], [178, 20]]);
    put(splaced, 'pigeon', [[30, 98], [34, 100], [24, 100], [36, 104]]);
    put(splaced, 'balloon', [[48, 92], [66, 100], [52, 70], [92, 90], [76, 50], [112, 70], [124, 50], [138, 74], [152, 44], [166, 80], [172, 34], [58, 30],
      [210, 50], [244, 70]]);
    put(splaced, 'buoy', [[40, 106], [58, 98], [88, 84], [150, 60], [250, 64]]);
    put(splaced, 'storm', [[150, 12]]);
    palms(splaced, islands);

    // 2. the Reef: shallow water and coral, rock spires with hawks' nests, wrecks with copper aboard, and the
    // satchel snagged on the mast of the last wreck, far to the east
    const reefMap = newSea(31, 0.02);
    reef(reefMap, 0, 0, RW, RH, 1);
    const rocks = [[30, 30, 5, 1], [70, 90, 6, 1], [118, 40, 5, 1], [160, 100, 6, 1], [196, 50, 5, 1], [236, 98, 4, 1], [20, 110, 4, 0], [96, 70, 4, 0]];
    rocks.forEach(i => isle(reefMap, ...i));
    const rplaced = [];
    common(rplaced, 16 * 8, 64 * 8);
    put(rplaced, 'wreck', [[24, 70], [52, 50], [110, 104], [150, 24], [212, 64]]);
    at(rplaced, 'satchel', 212 * 8, 64 * 8);
    put(rplaced, 'cbox', [[22, 74], [50, 54], [60, 20], [108, 100], [130, 66], [152, 28], [180, 84], [200, 116]]);
    put(rplaced, 'crate', [[40, 100], [84, 30], [140, 60], [170, 10], [230, 30], [12, 20]]);
    put(rplaced, 'hawk', [[70, 90], [118, 40], [160, 100], [196, 50]]);
    put(rplaced, 'ring', [[40, 60], [90, 50], [140, 80], [186, 70], [226, 80]]);
    put(rplaced, 'balloon', [[60, 40], [100, 90], [176, 40], [220, 110]]);
    put(rplaced, 'buoy', [[10, 64], [64, 64], [128, 64]]);
    palms(rplaced, rocks);

    // 3. Thunderhead: dark water under thunder cells. Balloons (silk) drift between them, hawks nest on the
    // cliffs, and the Storm Cell sits on top of the old lighthouse in the far north
    const north = newSea(41, 0.18);
    const cliffs = [[40, 96, 6, 1], [100, 70, 7, 1], [168, 104, 5, 0], [210, 60, 6, 1], [60, 30, 5, 0], [150, 26, 6, 1], [236, 20, 4, 0]];
    cliffs.forEach(i => isle(north, ...i));
    rect(north, 125, 10, 131, 15, 3); rect(north, 126, 11, 130, 14, 13);
    const nplaced = [];
    common(nplaced, 128 * 8, 120 * 8);
    at(nplaced, 'tower', 128 * 8, 12 * 8);
    at(nplaced, 'scell', 128 * 8, 12 * 8);
    put(nplaced, 'storm', [[70, 100], [130, 90], [190, 80], [40, 60], [110, 44], [176, 40], [230, 100], [86, 14]]);
    put(nplaced, 'balloon', [[70, 112], [96, 96], [140, 106], [160, 76], [200, 92], [56, 76], [120, 60], [186, 58], [30, 40], [146, 40], [220, 36], [96, 24]]);
    put(nplaced, 'log', [[40, 92], [100, 66], [210, 56]]);
    put(nplaced, 'crate', [[20, 110], [120, 100], [236, 70], [80, 50], [170, 16]]);
    put(nplaced, 'hawk', [[100, 70], [210, 60], [150, 26]]);
    put(nplaced, 'ring', [[60, 104], [150, 96], [100, 30]]);
    palms(nplaced, cliffs);

    cart.map.set(sea);
    cart.entities.placed = splaced;
    cart.levels = [
      { name: 'The Shallows', w: RW, h: RH, map: cart.map, placed: splaced },
      { name: 'The Reef', w: RW, h: RH, map: reefMap, placed: rplaced },
      { name: 'Thunderhead', w: RW, h: RH, map: north, placed: nplaced },
    ];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Tinwing', code, buildGfx,
    about: 'A story game in 2.5D: shape your own RC plane on a blueprint so its parts fit, then fly it over a flooded world.' });
})();
