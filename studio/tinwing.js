/* Demo cart "Tinwing": a story game in 2.5D about a teenager who builds RC planes in a flooded town.
   Original story, art and code. MIT License. */
(function () {
  const code = `-- Tinwing: a little story game in 2.5D.
-- Perch is a town on stilts, on a planet that is nearly all sea. Letters go by pigeon, people go by boat.
-- You are Pip, who builds radio-controlled planes in a shed by the water.
--
-- Town (level 1, "Perch"): D-pad walks, A talks to people or uses the workbench.
-- Workbench: pick wings, motor, battery and paint. Scrap from crates buys new parts.
-- Flying (level 2, "The Shallows"): left / right bank and turn, up / down climb and dive
--   (swap it in Settings). Hold A (or squeeze R) to run the motor. Let go to glide: gliding is free,
--   the motor drains the battery. Fly through warm air rings for a Tailwind.
--   To land, fly low over the yellow pad at Perch. A flat battery means a swim: Tobin fishes you out.
--
-- Everything on the maps is an entity you can move on the Map tab. The story is on the Cutscenes tab,
-- the Tailwind effect is on the Entities tab. The town and the sea are drawn with floor() and floorh(),
-- people, houses and crates are scaled sprites (sspr) and the plane is a little 3D model drawn from triangles.

TAU = math.pi * 2
TOWN, SKY = 1, 2
-- the town camera looks north over Pip's shoulder, like a diorama
T_FOC, T_H, T_BACK, T_HOR = 170, 96, 120, 14
-- the flight camera follows behind the plane
F_FOC, F_HOR, F_BACK, F_UP, STEP = 160, 92, 46, 12, 2
K_FLY = 2          -- world pixels per sprite pixel for buildings seen from the air
CEIL = 170         -- the radio doesn't reach higher than this
BASE_SPEED, BASE_TURN, BASE_DRAIN, SINK = 1.6, 0.032, 1 / 1500, 0.32

WINGS = {
  {name = "Kite", cost = 0, speed = 1.0, turn = 1.0, glide = 1.0, about = "Straight wings. Steady and easy."},
  {name = "Swift", cost = 8, speed = 1.2, turn = 1.35, glide = 0.8, about = "Swept back. Quick to turn."},
  {name = "Albatross", cost = 12, speed = 0.9, turn = 0.8, glide = 1.7, about = "Long wings. Glides for ages."},
}
MOTORS = {
  {name = "Hummer", cost = 0, speed = 1.0, drain = 1.0, about = "Quiet and easy on the battery."},
  {name = "Buzzer", cost = 6, speed = 1.3, drain = 1.4, about = "Fast, and thirsty."},
}
CELLS = {
  {name = "Single Cell", cost = 0, cap = 1.0, about = "Gets you to the Belltower and back."},
  {name = "Twin Cell", cost = -1, cap = 2.2, about = "Twice the range. Found, not bought."},
}
PAINTS = {   -- main colour, shade, trim
  {name = "Tin", cost = 0, c = {29, 28, 25}},
  {name = "Sunrise", cost = 0, c = {10, 9, 13}},
  {name = "Lagoon", cost = 0, c = {22, 21, 27}},
  {name = "Moss", cost = 3, c = {17, 16, 12}},
  {name = "Cherry", cost = 3, c = {26, 25, 13}},
  {name = "Plum", cost = 4, c = {5, 4, 27}},
}
ROWS = {{"Wings", WINGS, "w"}, {"Motor", MOTORS, "m"}, {"Battery", CELLS, "c"}, {"Paint", PAINTS, "p"}}

-- sprites: first tile, size in tiles, and how big they are in the world
DRAW = {
  house_a = {t = 160, w = 4, h = 5, k = 1.25}, house_b = {t = 164, w = 4, h = 5, k = 1.25},
  loft = {t = 168, w = 4, h = 5, k = 1.25}, shed = {t = 172, w = 4, h = 5, k = 1.25},
  tower = {t = 240, w = 3, h = 8, k = 1}, wreck = {t = 243, w = 3, h = 5, k = 1}, palm = {t = 246, w = 2, h = 3, k = 1},
  boat = {t = 248, w = 4, h = 2, k = 1.2}, buoy = {t = 252, w = 1, h = 2, k = 1},
  bench = {t = 118, w = 2, h = 2, k = 1}, crate = {t = 120, w = 2, h = 2, k = 1},
  coil = {t = 122, w = 2, h = 2, k = 1}, satchel = {t = 124, w = 2, h = 2, k = 1},
}
FACES = {pip = {down = 64, up = 68, side = 72}, mags = {down = 78, side = 112}, tobin = {down = 114, side = 116}}
-- how high pickups float above the ground in the air
PICK = {crate = true, coil = true, satchel = true, ring = true}

-- ------------------------------------------------------------------ the save
function new_state()
  return {scrap = 0, own = {w1 = true, m1 = true, c1 = true, p1 = true, p2 = true, p3 = true},
    sel = {w = 1, m = 1, c = 1, p = 2}, built = false, coil = false, coil_told = false, satchel = false, done = false,
    got = {}, flights = 0, swims = 0, tip = 0}
end
function copy(t)
  if type(t) ~= "table" then return t end
  local o = {}
  for k, v in pairs(t) do o[k] = copy(v) end
  return o
end
function save_progress() checkpoint(copy(S)) end

function _init()
  game{
    title = "Tinwing",
    goal = "Build an RC plane, find the mail satchel lost past the Drowned Belltower and fly it home to Perch.",
    help = {
      "Town: D-pad walks. A talks, and opens your workbench by the shed.",
      "Flying: left / right turn, up / down climb and dive. Hold A or squeeze R for the motor.",
      "Let go of the motor to glide: it saves battery. Warm air rings give you a Tailwind.",
      "Land by flying low over the yellow pad at Perch. Fly through crates for scrap.",
    },
    continue = function(cp)
      if cp then S = copy(cp) end
      INTRO = false
    end,
    pause = {{"Back to Perch", function() if MODE == "fly" then go_town("menu") end end}},
    settings = {{key = "pitch", name = "Up arrow", values = {"Climbs", "Dives"}, value = 1}},
  }
  S = new_state()
  INTRO, RETURN = true, nil
  gt, MSG, MSG_T = 0, nil, 0
  on("level", function(n) if n == TOWN then town_enter(RETURN) else sky_enter() end end)
  on("cutscene_end", function(name)
    if name == "rescue" and S.satchel and not S.done then deliver() end
  end)
  if LEVEL == SKY then sky_enter() else town_enter(nil) end
end

function msg(s, t) MSG, MSG_T = s, t or 150 end
function owned(key, i) return S.own[key .. i] == true end
function clamp(v, a, b) return math.max(a, math.min(b, v)) end
function ground(e) return e.x + e.w / 2, e.y + e.h / 2 end

-- what to do next, shown at the top of the screen
function objective()
  if S.done then return "Explore the Shallows. Scrap: " .. S.scrap end
  if not S.built then return "Build your plane at the workbench." end
  if S.satchel then return "Fly the satchel home to Perch!" end
  if not S.coil then return "Fly east, past the Drowned Belltower." end
  if S.sel.c ~= 2 then return "Fit the Twin Cell at your workbench." end
  return "Find the mail satchel out past the reef."
end

-- plane numbers from the parts on the bench
function plane_stats(sel)
  local w, m, c = WINGS[sel.w], MOTORS[sel.m], CELLS[sel.c]
  return {speed = w.speed * m.speed, turn = w.turn, glide = w.glide, drain = m.drain / c.cap, cap = c.cap}
end

-- ------------------------------------------------------------------ 3D helpers
-- VIEW is the camera that floor() / floorh() were given, so proj() lines up with the floor
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

-- the plane: points are {forward, right, up}; faces are {a, b, c, colour role}
-- roles: 1 paint, 2 trim, 3 dark (battery pods)
WING_SHAPES = {
  {{2.5, 1.6, 0.6}, {-1.5, 1.6, 0.6}, {-1, 12, 1.4}, {2, 12, 1.4}},       -- Kite: straight
  {{3.5, 1.6, 0.6}, {-1.5, 1.6, 0.6}, {-5.5, 10, 1.2}, {-3, 10, 1.2}},    -- Swift: swept back
  {{2.5, 1.6, 0.6}, {-1, 1.6, 0.6}, {-0.5, 16, 2.4}, {1.3, 16, 2.4}},     -- Albatross: long
}
function plane_model(sel)
  local V = {{9, 0, 0.3}, {2, 0, 2.3}, {2, 2, 0.2}, {2, 0, -1.6}, {2, -2, 0.2}, {-11, 0, 0.8}}
  local F = {{1, 2, 3, 1}, {1, 3, 4, 1}, {1, 4, 5, 1}, {1, 5, 2, 1}, {6, 3, 2, 1}, {6, 4, 3, 1}, {6, 5, 4, 1}, {6, 2, 5, 1}}
  local function quad(pts, role)
    for side = -1, 1, 2 do
      local n = #V
      for _, p in ipairs(pts) do V[#V + 1] = {p[1], p[2] * side, p[3]} end
      F[#F + 1] = {n + 1, n + 2, n + 3, role}
      F[#F + 1] = {n + 1, n + 3, n + 4, role}
    end
  end
  quad(WING_SHAPES[sel.w], 1)
  quad({{-8.5, 0.8, 0.8}, {-11, 0.8, 0.8}, {-11.6, 5, 1}, {-10, 5, 1}}, 2)     -- tailplane
  local n = #V
  V[n + 1], V[n + 2], V[n + 3] = {-7.5, 0, 1.4}, {-11.4, 0, 0.9}, {-12, 0, 5.6}  -- fin
  F[#F + 1] = {n + 1, n + 2, n + 3, 2}
  if sel.c == 2 then quad({{3, 4.2, 0.4}, {-2.5, 4.2, 0.4}, {-2, 4.2, -1.4}, {2.5, 4.2, -1.4}}, 3) end
  return {v = V, f = F}
end

-- draw a model at P = {x, y, z, h (heading), pitch, bank}, scaled sc, with paint p; spin turns the propeller
SUN = {-0.35, -0.45, 0.82}
function draw_model(M, P, sc, p, spin, fast)
  local ch, sh = math.cos(P.h), math.sin(P.h)
  local cp, sp = math.cos(P.pitch), math.sin(P.pitch)
  local cr, sr = math.cos(P.bank), math.sin(P.bank)
  local W, S2 = {}, {}
  local function place(v)
    local a, b, c = v[1] * sc, v[2] * sc, v[3] * sc
    local b1, c1 = b * cr + c * sr, c * cr - b * sr
    local a2, c2 = a * cp - c1 * sp, a * sp + c1 * cp
    return P.x + a2 * ch - b1 * sh, P.y + a2 * sh + b1 * ch, P.z + c2
  end
  for i, v in ipairs(M.v) do
    local x, y, z = place(v)
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
      elseif f[4] == 2 then col = lit > 0.45 and p[3] or 30
      else col = lit > 0.5 and 28 or 30 end
      list[#list + 1] = {d = a[3] + b[3] + c[3], a = a, b = b, c = c, col = col}
    end
  end
  table.sort(list, function(u, v) return u.d > v.d end)
  for _, t in ipairs(list) do tri(t.a[1], t.a[2], t.b[1], t.b[2], t.c[1], t.c[2], t.col) end
  -- propeller on the nose
  local nx, ny, nz = place({9.6, 0, 0.3})
  local px, py, k = proj(nx, ny, nz)
  if px then
    local r = 4.6 * sc * k
    if fast then circ(px, py, r, 29) end
    local bx, by = math.cos(spin) * r, math.sin(spin) * r * 0.9
    line(px - bx, py - by, px + bx, py + by, 30)
    circfill(px, py, math.max(1, 0.8 * sc * k), 31)
  end
end

-- ------------------------------------------------------------------ sky, water
function draw_sky(hor, off)
  local bands = {20, 21, 21, 22, 22, 23}
  local h = math.max(1, hor)
  for i = 0, 5 do rectfill(0, i * h // 6, 320, h // 6 + 1, bands[i + 1]) end
  for i = 0, 6 do            -- clouds drift slowly
    local cx = ((i * 157 - off + gt * 0.04) % 520) - 100
    local cy = 10 + (i * 41) % math.max(8, hor - 22)
    circfill(cx, cy, 8, 13); circfill(cx + 10, cy + 2, 6, 13); circfill(cx - 9, cy + 3, 5, 13)
    rectfill(cx - 12, cy + 4, 26, 4, 13)
  end
  for i = 0, 9 do            -- far-off islands on the horizon
    local x = ((i * 97 - off * 1.3) % 560) - 120
    local w = 12 + (i * 13) % 26
    rectfill(x, hor - 2 - (i % 3), w, 3 + (i % 3), 14)
  end
end
-- water tiles have glints in colours 22 / 23; swapping them makes the sea shimmer
function water_pal()
  local ph = (gt // 20) % 2
  if ph == 0 then pal(23, 20) else pal(22, 20) end
end

-- ------------------------------------------------------------------ town
function town_enter(reason)
  MODE = "town"
  pip, mags, tobin, bench = ents_get("pip"), ents_get("mags"), ents_get("tobin"), ents_get("bench")
  if pip then pip.face, pip.lx, pip.ly, pip.walk = "down", pip.x, pip.y, 0 end
  for _, e in ipairs(ents_all("pigeon")) do e.data.hx, e.data.hy, e.data.fly = e.x, e.y, 0 end
  RETURN = nil
  if reason == "land" then
    S.flights = S.flights + 1
    if S.satchel and not S.done then deliver() return end
    if S.coil and not S.coil_told then S.coil_told = true; cutscene("coil_home")
    else msg("Landed! " .. objective()) end
    save_progress()
  elseif reason == "swim" then
    S.swims = S.swims + 1
    cutscene("rescue")
    save_progress()
  elseif reason == "menu" then
    msg("Back in Perch.")
    save_progress()
  end
end

function deliver()
  S.done = true
  cutscene("ending")
  game_win("You flew the lost mail home to Perch.")
  save_progress()
end

function walk_ok(x, y)
  for _, p in ipairs({{-3, -2}, {3, -2}, {-3, 1}, {3, 1}}) do
    local t = mget((x + p[1]) // 8, (y + p[2]) // 8)
    if t == 0 or fget(t, 0) then return false end
  end
  return true
end

-- who is close enough to talk to (or the workbench)
function nearby()
  if not pip then return nil end
  local px, py = ground(pip)
  local best, bd = nil, 26
  for _, e in ipairs({mags, tobin, bench}) do
    if e and e.alive then
      local x, y = ground(e)
      local d = math.sqrt((x - px) ^ 2 + (y - py) ^ 2)
      if d < bd then best, bd = e, d end
    end
  end
  return best
end

TIPS = {"tobin_glide", "tobin_rings", "tobin_scrap", "tobin_land"}
function talk(e)
  if e == bench then open_bench() return end
  sfx("E5", 4, 0.2, 4)
  if e == mags then
    if S.done then cutscene("mags_thanks")
    elseif not S.built then cutscene("mags_build")
    elseif not S.coil then cutscene("mags_look")
    elseif S.sel.c ~= 2 then cutscene("mags_fit")
    else cutscene("mags_far") end
  else
    if not S.built then cutscene("tobin_hello")
    else S.tip = S.tip % #TIPS + 1; cutscene(TIPS[S.tip]) end
  end
end

function town_update()
  local was = cutscene_playing()     -- the A press that closes a cutscene shouldn't also talk
  ents_update()
  if MODE ~= "town" or not pip then return end
  local busy = was or cutscene_playing()
  if not busy and INTRO then INTRO = false; cutscene("intro"); save_progress() return end
  if not busy then
    local dx, dy = 0, 0
    if btn("left") then dx = -1 end
    if btn("right") then dx = dx + 1 end
    if btn("up") then dy = -1 end
    if btn("down") then dy = dy + 1 end
    local sp = (dx ~= 0 and dy ~= 0) and 0.85 or 1.2
    local gx, gy = ground(pip)
    if dx ~= 0 and walk_ok(gx + dx * sp, gy) then pip.x = pip.x + dx * sp end
    gx = ground(pip)
    if dy ~= 0 and walk_ok(gx, gy + dy * sp) then pip.y = pip.y + dy * sp end
    if btnp("a") then local e = nearby(); if e then talk(e) end end
  end
  -- which way Pip faces follows how Pip moved (cutscenes move Pip too)
  local mx, my = pip.x - pip.lx, pip.y - pip.ly
  if math.abs(mx) > 0.05 or math.abs(my) > 0.05 then
    if math.abs(mx) > math.abs(my) then pip.face, pip.dir = "side", mx > 0 and 1 or -1
    else pip.face = my > 0 and "down" or "up" end
    pip.walk = pip.walk + 1
  else pip.walk = 0 end
  pip.lx, pip.ly = pip.x, pip.y
  -- pigeons flutter off when Pip comes close, and land again later
  local px, py = ground(pip)
  for _, e in ipairs(ents_all("pigeon")) do
    local d = e.data
    if d.fly == 0 and math.abs(e.x - px) < 20 and math.abs(e.y - py) < 16 then d.fly = 1; sfx("A6", 3, 0.15, 6) end
    if d.fly > 0 then
      d.fly = d.fly + 1
      e.x = e.x + (d.hx > px and 1.4 or -1.4)
      e.y = e.y - 0.6
      if d.fly > 240 then d.fly, e.x, e.y = 0, d.hx, d.hy end
    end
  end
end

function town_draw()
  local fx, fy = 0, 0
  if pip then fx, fy = ground(pip) end
  setview(fx, fy + T_BACK, -math.pi / 2, T_H, T_HOR, T_FOC)
  draw_sky(T_HOR, fx * 0.4)
  water_pal()
  floor(VIEW.x, VIEW.y, VIEW.a, T_H, T_HOR, T_FOC, 20)
  pal()
  local list = {}
  for _, e in ipairs(ents_all()) do
    local gx, gy = ground(e)
    local z = 0
    if e.name == "pigeon" and e.data.fly and e.data.fly > 0 then z = math.min(60, e.data.fly * 0.7) end
    if e.name == "boat" then z = math.sin(gt * 0.05) * 1.2 end
    local sx, sy, k, d = proj(gx, gy, z)
    if sx and sx > -120 and sx < 440 then list[#list + 1] = {e = e, sx = sx, sy = sy, k = k, d = d} end
  end
  table.sort(list, function(a, b) return a.d > b.d end)
  for _, it in ipairs(list) do draw_town_thing(it) end
  -- hud
  rectfill(0, 0, 320, 12, 1)
  text(objective(), 4, 2, 13)
  if not cutscene_playing() then
    local e = nearby()
    if e then
      local x, y = ground(e)
      local sx, sy, k = proj(x, y, 0)
      local what = e == bench and "A workbench" or "A talk"
      if sx then
        local h = e == bench and 16 or 26
        rectfill(sx - #what * 4 - 2, sy - h * k - 14, #what * 8 + 4, 10, 1)
        text(what, sx - #what * 4, sy - h * k - 13, 27)
      end
    end
  end
  scrap_hud(4, 226)
  if MSG and MSG_T > 0 then
    rectfill(0, 196, 320, 12, 1)
    text(MSG, 160 - #MSG * 4, 198, 27)
  end
end

function scrap_hud(x, y)
  sspr(120, x, y - 2, 2, 2, 0.75)
  text("x" .. S.scrap, x + 14, y, 13)
end

function draw_town_thing(it)
  local e, k = it.e, it.k
  local face = FACES[e.name]
  if face then
    -- people: front, back or side frames; walking adds a step frame
    local f, flip = face.down, false
    if e == pip then
      f = face[pip.face] or face.down
      if pip.face == "side" then flip = pip.dir < 0 end
      if pip.walk > 0 and (pip.walk // 8) % 2 == 1 then f = f + 2 end
    elseif pip then
      local px, py = ground(pip)
      local gx, gy = ground(e)
      if math.abs(px - gx) < 48 and math.abs(px - gx) > math.abs(py - gy) and face.side then f, flip = face.side, px < gx end
    end
    ellipse(it.sx, it.sy, 6 * k, 30)
    sspr(f, it.sx - 8 * k, it.sy - 23 * k, 2, 3, k, flip)
    if e.say then bubble(e.say, it.sx, it.sy - 26 * k) end
    return
  end
  if e.name == "pigeon" then
    local fr = (e.data.fly or 0) > 0 and ((gt // 4) % 2 == 0 and 127 or 142) or 126
    sspr(fr, it.sx - 4 * k, it.sy - 7 * k, 1, 1, k, e.data.hx and e.data.hx > (pip and pip.x or 0))
    return
  end
  local d = DRAW[e.name]
  if not d then return end
  local s = k * d.k
  sspr(d.t, it.sx - d.w * 4 * s, it.sy - d.h * 8 * s + s, d.w, d.h, s)
end

function ellipse(x, y, w, c)
  local h = math.max(1, w * 0.3)
  for j = -h, h do
    local f = 1 - (j / (h + 0.5)) ^ 2
    local hw = w * math.sqrt(math.max(f, 0))
    rectfill(x - hw, y + j, hw * 2, 1, c)
  end
end

function bubble(s, x, y)
  local w = #s * 8 + 6
  rectfill(x - w / 2, y - 12, w, 11, 13)
  rect(x - w / 2, y - 12, w, 11, 31)
  text(s, x - w / 2 + 3, y - 10, 1)
end

-- ------------------------------------------------------------------ the workbench
function open_bench()
  MODE = "bench"
  sfx("C5", 1, 0.3, 6)
  B = {row = 1, view = {w = S.sel.w, m = S.sel.m, c = S.sel.c, p = S.sel.p}, spin = 0.6, note = nil, note_t = 0}
  if not S.built then B.note, B.note_t = "Pick your parts, then Fly!", 240 end
end
function close_bench(fly)
  local first = not S.built
  S.built = true
  save_progress()
  if fly then
    sfx("G5", 1, 0.3, 10)
    MODE = "wait"            -- the level switch happens in the next ents_update()
    level(SKY)
  else
    MODE = "town"
    if first then msg("Your first plane is ready! Fly it from the workbench.", 200) end
  end
end

function bench_update()
  B.spin = B.spin + 0.015
  if B.note_t > 0 then B.note_t = B.note_t - 1 end
  local n = #ROWS + 2
  if btnp("up") then B.row = (B.row - 2) % n + 1; sfx("E5", 4, 0.15, 3) end
  if btnp("down") then B.row = B.row % n + 1; sfx("E5", 4, 0.15, 3) end
  for _, r in ipairs(ROWS) do if r ~= ROWS[B.row] then B.view[r[3]] = S.sel[r[3]] end end
  local r = ROWS[B.row]
  if r then
    local key, list = r[3], r[2]
    local d = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
    if d ~= 0 then
      B.view[key] = (B.view[key] - 1 + d) % #list + 1
      if owned(key, B.view[key]) then S.sel[key] = B.view[key] end
      sfx("A5", 4, 0.15, 3)
    end
    if btnp("a") then
      local i = B.view[key]
      local part = list[i]
      if owned(key, i) then S.sel[key] = i
      elseif part.cost < 0 then B.note, B.note_t = "You'll have to find that one out there.", 150; sfx("C4", 2, 0.3, 8)
      elseif S.scrap >= part.cost then
        S.scrap = S.scrap - part.cost
        S.own[key .. i] = true
        S.sel[key] = i
        B.note, B.note_t = part.name .. " fitted!", 120
        sfx("C6", 1, 0.3, 10)
        save_progress()
      else B.note, B.note_t = "You need " .. part.cost .. " scrap for that.", 150; sfx("C4", 2, 0.3, 8) end
    end
  elseif btnp("a") then close_bench(B.row == #ROWS + 1) return end
  if btnp("b") then close_bench(false) end
end

function bench_draw()
  cls(6)
  for x = 0, 319, 16 do rectfill(x, 0, 1, 240, 7) end     -- plank wall
  rectfill(0, 150, 320, 90, 7)
  for y = 150, 239, 6 do rectfill(0, y, 320, 1, 6) end    -- the bench top
  rectfill(0, 0, 320, 14, 1)
  text("PIP'S WORKBENCH", 8, 3, 27)
  scrap_hud(250, 3)
  -- the plane on its stand, slowly turning
  rectfill(16, 24, 168, 120, 31)
  rect(16, 24, 168, 120, 30)
  setview(-46, 0, 0, 10, 40, 210, 100)
  local sel = B.view
  local P = {x = 0, y = 0, z = 0, h = B.spin, pitch = 0.12, bank = math.sin(B.spin * 2) * 0.15}
  local paint = PAINTS[sel.p].c
  draw_model(plane_model(sel), P, 1, paint, gt * 0.6, true)
  -- the part rows
  local y = 24
  for i, r in ipairs(ROWS) do
    local key, list = r[3], r[2]
    local v = B.view[key]
    local part = list[v]
    local on = B.row == i
    rectfill(192, y, 120, 26, on and 1 or 31)
    if on then rect(192, y, 120, 26, 27) end
    text(r[1], 198, y + 3, 29)
    local name = part.name
    local col = owned(key, v) and 13 or 28
    text("<", 194, y + 14, on and 27 or 30); text(">", 304, y + 14, on and 27 or 30)
    text(name, 252 - #name * 4, y + 14, col)
    if key == "p" then rectfill(198 + #r[1] * 8 + 6, y + 3, 8, 7, part.c[1]) end
    if not owned(key, v) then
      local c = part.cost < 0 and "find it" or (part.cost .. " scrap")
      text(c, 306 - #c * 8, y + 3, part.cost >= 0 and S.scrap >= part.cost and 17 or 26)
    end
    y = y + 28
  end
  for i, s in ipairs({"Fly!", "Back to town"}) do
    local on = B.row == #ROWS + i
    rectfill(192, y, 120, 12, on and 27 or 31)
    text(s, 252 - #s * 4, y + 2, on and 1 or 29)
    y = y + 14
  end
  -- what the parts do
  local st = plane_stats(B.view)
  local bars = {{"Speed", st.speed / 1.6}, {"Turning", st.turn / 1.4}, {"Range", st.cap / st.drain / 2.3}, {"Glide", st.glide / 1.8}}
  for i, b in ipairs(bars) do
    local by = 148 + i * 12
    text(b[1], 20, by, 12)
    rectfill(88, by, 96, 7, 31)
    rectfill(88, by, math.floor(96 * clamp(b[2], 0.05, 1)), 7, 17)
  end
  local r = ROWS[B.row]
  local about = r and r[2][B.view[r[3]]].about or (B.row == #ROWS + 1 and "Launch from the ramp behind the shed." or "Go back to the boardwalk.")
  if about then text(about, 20, 222, 29) end
  if B.note and B.note_t > 0 then
    rectfill(0, 206, 320, 12, 1)
    text(B.note, 160 - #B.note * 4, 208, 27)
  end
end

-- ------------------------------------------------------------------ flying
-- tile heights for the islands: base height, and how much it rises per tile away from the water
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
  hset(0, 0, 1)        -- marks the heights as built (that corner is open sea)
end

function pick_z(e)
  local gx, gy = ground(e)
  if e.name == "coil" then return 64 * K_FLY + 10 end           -- on top of the Belltower
  if e.name == "satchel" then return 40 * K_FLY + 4 end         -- snagged on the wreck's mast
  if e.name == "ring" then return 34 + (gx * 7 + gy * 3) % 46 end
  return hget(gx, gy) + 4 + math.sin((gt + gx) * 0.06) * 1.5
end
function key_of(e) return e.name .. math.floor(e.x) .. "," .. math.floor(e.y) end

function sky_enter()
  MODE = "fly"
  local L = LEVELS[SKY]
  WW, WH = L.w * 8, L.h * 8
  if hget(0.1, 0.1) < 0.5 then build_heights(L.w, L.h) end
  plane = ents_get("tinwing")
  local pad = ents_get("pad") or plane
  PAD = {}
  PAD.x, PAD.y = ground(pad)
  local st = plane_stats(S.sel)
  stat_set(plane, "speed", st.speed)
  MODEL = plane_model(S.sel)
  PAINT = PAINTS[S.sel.p].c
  local px, py = ground(plane)
  P = {x = px, y = py, z = hget(px, py) + 5, h = -math.pi / 4, pitch = 0.3, bank = 0, spd = 1.0, bat = 1, thr = 1,
    st = st, armed = false, launch = 50, t = 0, flat = false, out = 0, cd = 0, spin = 0, swim = 0, camp = 0.3}
  for _, e in ipairs(ents_all()) do
    if PICK[e.name] and e.name ~= "ring" and S.got[key_of(e)] then e.alive = false end
    if e.name == "coil" and S.coil then e.alive = false end
    if e.name == "satchel" and S.satchel then e.alive = false end
  end
  SPRAY = {}
  if S.flights == 0 and S.swims == 0 then msg("Hold A for the motor, let go to glide.", 240)
  else msg(objective(), 200) end
end

function go_town(why)
  RETURN = why
  stop(7)
  level(TOWN)
end

function spray(n)
  for i = 1, n do
    SPRAY[#SPRAY + 1] = {x = P.x, y = P.y, z = 2, vx = math.cos(i * 2.4) * 0.8, vy = math.sin(i * 2.4) * 0.8, vz = 1 + (i % 3) * 0.5, t = 0}
  end
  sfx("C3", 3, 0.4, 12)
end

function sky_update()
  ents_update()
  if MODE ~= "fly" or not P then return end
  P.t = P.t + 1
  if P.cd > 0 then P.cd = P.cd - 1 end
  for i = #SPRAY, 1, -1 do
    local s = SPRAY[i]
    s.x, s.y, s.z, s.vz, s.t = s.x + s.vx, s.y + s.vy, s.z + s.vz, s.vz - 0.12, s.t + 1
    if s.z < 0 then table.remove(SPRAY, i) end
  end
  if P.swim > 0 then          -- splashed down: bob on the water, then Tobin's boat comes
    P.swim = P.swim + 1
    P.z, P.spd, P.bank = 0.5 + math.sin(P.swim * 0.1) * 0.4, 0, math.sin(P.swim * 0.05) * 0.2
    P.pitch = -0.1
    if P.swim > 150 then go_town("swim") end
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
  P.thr = P.thr + (thr - P.thr) * 0.15
  P.bank = P.bank + (lr * 0.65 - P.bank) * 0.1
  P.pitch = P.pitch + (ud * 0.45 - P.pitch) * 0.08
  local spd_k = stat(plane, "speed")
  P.h = P.h + P.bank * BASE_TURN * st.turn * clamp(P.spd / BASE_SPEED, 0.5, 1.4)
  -- speed: the motor pulls towards cruise speed, diving speeds you up, climbing slows you down
  local want = BASE_SPEED * spd_k * (0.55 + 0.45 * P.thr) - P.pitch * 0.9
  P.spd = clamp(P.spd + (want - P.spd) * 0.03, 0.35, 4)
  local vz = math.sin(P.pitch) * P.spd
  if P.thr < 0.35 then vz = vz - SINK / st.glide * (1 - P.thr / 0.35) end
  if P.spd < 0.7 then vz = vz - (0.7 - P.spd) end      -- too slow: it stalls and drops
  P.x = P.x + math.cos(P.h) * math.cos(P.pitch) * P.spd
  P.y = P.y + math.sin(P.h) * math.cos(P.pitch) * P.spd
  P.z = math.min(CEIL, P.z + vz)
  if P.z >= CEIL and MSG ~= "The radio won't reach any higher." then msg("The radio won't reach any higher.", 90) end
  P.bat = math.max(0, P.bat - P.thr * BASE_DRAIN * st.drain)
  P.spin = P.spin + 0.3 + P.thr * 1.2
  if gt % 4 == 0 then tone(70 + P.thr * 90 + P.spd * 20, 2, 0.03 + P.thr * 0.05, 6, 7) end
  -- the edge of the map: the wind turns you back
  if P.x < 48 or P.y < 48 or P.x > WW - 48 or P.y > WH - 48 then
    local a = math.atan(WH / 2 - P.y, WW / 2 - P.x)
    local d = (a - P.h + math.pi) % TAU - math.pi
    P.h = P.h + clamp(d, -0.04, 0.04)
    if P.out == 0 then msg("Strong winds out here. Turn back!", 120) end
    P.out = 60
  elseif P.out > 0 then P.out = P.out - 1 end
  -- hitting the ground, the water or the Belltower
  local g = hget(P.x, P.y)
  if P.z < g + 3 then
    if g < 1.5 then
      if P.flat or P.spd < 0.6 then splash_down() return end
      P.z, P.pitch = 3.5, math.max(P.pitch, 0.25)
      P.bat = math.max(0, P.bat - 0.03)
      spray(6)
      msg("Splash! Keep the nose up.", 90)
    else
      P.z, P.pitch, P.spd = g + 6, 0.35, P.spd * 0.6
      P.bat = math.max(0, P.bat - 0.05)
      sfx("C2", 3, 0.5, 10)
      msg("Bonk! Climb over the islands.", 90)
    end
  end
  for _, e in ipairs(ents_all("tower")) do
    local gx, gy = ground(e)
    local dx, dy = P.x - gx, P.y - gy
    local d = math.sqrt(dx * dx + dy * dy)
    if d < 12 and P.z < 64 * K_FLY then
      P.x, P.y = gx + dx / (d + 0.01) * 13, gy + dy / (d + 0.01) * 13
      P.h, P.spd = P.h + math.pi * 0.8, P.spd * 0.5
      P.bat = math.max(0, P.bat - 0.04)
      sfx("C2", 3, 0.5, 10)
      msg("Clang! Fly over the tower, not into it.", 100)
    end
  end
  -- pickups
  for _, e in ipairs(ents_all()) do
    if PICK[e.name] then
      local gx, gy = ground(e)
      local dx, dy, dz = P.x - gx, P.y - gy, P.z - pick_z(e) - (e.name == "ring" and 0 or 9)
      local r = e.name == "ring" and 16 or 13
      if dx * dx + dy * dy + dz * dz < r * r then collect(e) end
    end
  end
  -- landing: low over the pad, after flying somewhere
  local dpx, dpy = P.x - PAD.x, P.y - PAD.y
  local dp = math.sqrt(dpx * dpx + dpy * dpy)
  if dp > 120 then P.armed = true end
  if P.armed and dp < 28 and P.z < hget(PAD.x, PAD.y) + 24 then
    sfx("C5", 1, 0.3, 8); sfx("G5", 1, 0.3, 12)
    go_town("land")
  end
  if MSG_T > 0 then MSG_T = MSG_T - 1 end
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
    msg("A TWIN CELL! Take it home to the workbench.", 300)
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

function sky_draw()
  if not P then return end
  local ch, sh = math.cos(P.h), math.sin(P.h)
  local camx, camy = P.x - ch * F_BACK, P.y - sh * F_BACK
  local camz = math.max(P.z + F_UP, hget(camx, camy) + 6)
  P.camp = P.camp + (P.pitch - P.camp) * 0.1
  local hor = F_HOR + math.floor(P.camp * 40)
  setview(camx, camy, P.h, camz, hor, F_FOC)
  draw_sky(hor, P.h * F_FOC)
  water_pal()
  floorh(camx, camy, P.h, camz, hor, F_FOC, 20, STEP)
  pal()
  -- the plane's shadow on the water or the ground
  local g = hget(P.x, P.y)
  local sx, sy, k = proj(P.x, P.y, g)
  if sx then ellipse(sx, sy, 9 * k, 19) end
  -- buildings, crates and everything else, far first
  local list = {}
  for _, e in ipairs(ents_all()) do
    local gx, gy = ground(e)
    local z = PICK[e.name] and pick_z(e) or hget(gx, gy)
    if e.name == "pigeon" then
      local a = gt * 0.02 + e.phase
      gx, gy, z = gx + math.cos(a) * 60, gy + math.sin(a) * 60, 50 + math.sin(a * 3) * 8
    end
    if e.name == "boat" then z = math.sin(gt * 0.05) end
    local px, py, kk, d = proj(gx, gy, z)
    if px and px > -200 and px < 520 and kk > 0.02 and e.name ~= "tinwing" and e.name ~= "pad" then
      list[#list + 1] = {e = e, sx = px, sy = py, k = kk, d = d}
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
  draw_model(MODEL, P, 1, PAINT, P.spin, P.thr > 0.2)
  sky_hud()
end

function draw_sky_thing(it)
  local e, k = it.e, it.k
  if e.name == "ring" then
    local r = 13 * k
    local on = fx_has(plane, "tailwind")
    circ(it.sx, it.sy, r, 27); circ(it.sx, it.sy, r - 1, on and 13 or 10)
    if r > 6 then circ(it.sx, it.sy, r + 1, 10) end
    return
  end
  if e.name == "pigeon" then
    sspr((gt // 5 + e.phase) % 2 == 0 and 127 or 142, it.sx - 4 * k, it.sy - 4 * k, 1, 1, k)
    return
  end
  local d = DRAW[e.name]
  if not d then return end
  local s = k * (PICK[e.name] and 1.3 or K_FLY)
  if e.name == "coil" or e.name == "satchel" then         -- glow so you can spot them from far away
    local r = 10 * k + math.sin(gt * 0.15) * 2 * k + 2
    circ(it.sx, it.sy - 8 * s, r, 27)
    sspr(d.t, it.sx - d.w * 4 * s, it.sy - d.h * 8 * s, d.w, d.h, s)
    return
  end
  sspr(d.t, it.sx - d.w * 4 * s, it.sy - d.h * 8 * s + s, d.w, d.h, s)
end

function sky_hud()
  -- battery
  rectfill(4, 4, 64, 20, 1)
  text("BATT", 8, 7, 29)
  local c = P.bat > 0.5 and 17 or (P.bat > 0.2 and 27 or 26)
  rect(8, 15, 56, 6, 29)
  rectfill(9, 16, math.floor(54 * P.bat), 4, (P.bat < 0.2 and gt % 30 < 15) and 13 or c)
  if fx_has(plane, "tailwind") then text(">>", 44, 7, 27) end
  -- height and scrap
  rectfill(4, 26, 64, 10, 1)
  text("ALT " .. math.floor(P.z), 8, 27, 13)
  scrap_hud(6, 42)
  -- the map: land, the pad, the Belltower and you
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
  if MODE == "fly" then sky_update()
  elseif MODE == "bench" then bench_update()
  elseif MODE == "wait" then ents_update()
  else
    town_update()
    if MSG_T > 0 then MSG_T = MSG_T - 1 end
  end
end

function _draw()
  if MODE == "fly" then sky_draw()
  elseif MODE == "bench" or MODE == "wait" then bench_draw()
  else town_draw() end
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

  function workbench() {
    const g = G(16, 16);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(0, 7, 16, 2, 7); R(1, 9, 2, 7, 6); R(13, 9, 2, 7, 6); R(1, 12, 14, 1, 6);
    R(1, 4, 3, 3, 28); R(2, 3, 1, 1, 30);
    R(6, 5, 8, 1, 10); R(9, 3, 2, 4, 10); R(8, 4, 1, 1, 13); R(12, 4, 2, 1, 9);
    R(4, 13, 3, 2, 25);
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
    const g = G(16, 24);
    const R = (x, y, w, h, c) => fill(g, x, y, w, h, c);
    R(7, 4, 2, 16, 10); R(6, 6, 4, 6, 10); R(0, 9, 16, 3, 10); R(0, 11, 16, 1, 9);
    R(4, 18, 8, 2, 13); R(7, 6, 2, 2, 22);
    R(5, 3, 6, 1, 28);
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
    [1, 2, 3, 14, 15, 22].forEach(t => { cart.flags[t] |= 1; });    // water and house footprints: can't walk there

    const pip = { skin: 11, hair: 8, top: 21, topDark: 20, legs: 7, shoe: 6, scarf: 10, goggles: true, blush: 26 };
    const mags = { skin: 11, hair: 29, top: 4, topDark: 3, legs: 3, shoe: 6, bun: true, bird: true, mouth: 24 };
    const tobin = { skin: 11, hair: 29, top: 27, topDark: 10, legs: 20, shoe: 6, cap: 19, capDark: 20, beard: 29 };
    blit(64, person(pip, 'down', 0)); blit(66, person(pip, 'down', 1));
    blit(68, person(pip, 'up', 0)); blit(70, person(pip, 'up', 1));
    blit(72, person(pip, 'side', 0)); blit(74, person(pip, 'side', 1));
    blit(76, planeIcon());
    blit(78, person(mags, 'down', 0)); blit(112, person(mags, 'side', 0));
    blit(114, person(tobin, 'down', 0)); blit(116, person(tobin, 'side', 0));
    blit(118, workbench()); blit(120, crate()); blit(122, coil()); blit(124, satchel());
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
    const talker = (name, frame, line) => Object.assign({}, base, { name, sh: 3, anims: [A('idle', [frame])],
      tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 34 }), N('face_player'), N('say', { text: line })])]) });
    cart.entities = {
      effects: [
        { name: 'tailwind', dur: 180, stack: 'refresh', hp: 0, every: 0, tick: 0, tint: -1, mods: [{ stat: 'speed', op: 'mul', value: 1.45 }] },
      ],
      types: [
        Object.assign({}, base, { name: 'pip', sh: 3, player: true, team: 'friend', hp: 3, anims: [A('launch', [76]), A('idle', [64]), A('back', [68]), A('side', [72])], tree: null }),
        talker('mags', 78, 'Pip!'),
        talker('tobin', 114, 'Ahoy'),
        thing('bench', 118, 2, 2),
        thing('house_a', 160, 4, 5), thing('house_b', 164, 4, 5), thing('loft', 168, 4, 5), thing('shed', 172, 4, 5),
        thing('boat', 248, 4, 2), thing('buoy', 252, 1, 2), thing('palm', 246, 2, 3),
        Object.assign({}, base, { name: 'pigeon', sw: 1, sh: 1, anims: [A('idle', [126]), A('fly', [127, 142], 4)],
          tree: N('selector', {}, [N('sequence', {}, [N('every', { frames: 90 }), N('chance', { pct: 30 }), N('turn')])]) }),
        thing('tower', 240, 3, 8), thing('wreck', 243, 3, 5),
        thing('crate', 120, 2, 2), thing('coil', 122, 2, 2), thing('satchel', 124, 2, 2),
        thing('ring', 27, 2, 2),
        Object.assign({}, base, { name: 'tinwing', anims: [A('idle', [76])], stats: [{ name: 'speed', value: 1 }], tree: null }),
        thing('pad', 18, 2, 2),
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
        S('move', { who: 'mags', x: 22.5, y: 20.5, speed: 1.2 }),
        say('mags', 'Pip! Pepper came home last night without her mail satchel.'),
        say('mags', 'The squall blew it off somewhere east, past the Drowned Belltower. Half the town\'s letters are in it.'),
        say('pip', 'The boats could look...'),
        say('mags', 'Tobin says the reef is too rough for boats this month. But a plane could fly over it.'),
        say('pip', 'Leave it to me! I just need to finish building her.'),
        S('move', { who: 'mags', x: 40, y: 20, speed: 1.2 }),
        say('', 'Use your workbench by the shed to build your plane.'),
      ] },
      { name: 'mags_build', level: 0, steps: [say('mags', 'A plane won\'t build itself, Pip. Your workbench is right by your shed.')] },
      { name: 'mags_look', level: 0, steps: [say('mags', 'East, past the Drowned Belltower. Pepper says the satchel smelled of reef weed.'),
        say('mags', 'The old tower used to keep spare parts up top, back when the lamp still worked.')] },
      { name: 'mags_fit', level: 0, steps: [say('mags', 'Tobin says that cell of yours doubles your range. Fit it on your workbench, then go!')] },
      { name: 'mags_far', level: 0, steps: [say('mags', 'The reef is far to the north-east. Glide when you can, and come back safe.')] },
      { name: 'mags_thanks', level: 0, steps: [say('mags', 'Every letter dry and delivered. Pepper wants to race your plane, you know.')] },
      { name: 'tobin_hello', level: 0, steps: [say('tobin', 'Morning, Pip. Building another flyer? Mind the gulls this time.')] },
      { name: 'tobin_glide', level: 0, steps: [say('tobin', 'Let go of the motor and she glides. Free distance, that is. Climb high, then glide far.')] },
      { name: 'tobin_rings', level: 0, steps: [say('tobin', 'See those glowing rings of warm air? Fly through and you\'ll get a Tailwind.')] },
      { name: 'tobin_scrap', level: 0, steps: [say('tobin', 'Crates float everywhere since the flood. Fly through them and keep the scrap for parts.')] },
      { name: 'tobin_land', level: 0, steps: [say('tobin', 'To land, come in low over the yellow pad. Low and slow, like a gull.')] },
      { name: 'coil_home', level: 0, steps: [
        S('move', { who: 'tobin', x: 23, y: 21, speed: 1.4 }),
        say('tobin', 'Is that a Twin Cell? Lighthouse stock, from before the water rose!'),
        say('pip', 'It was on top of the Belltower.'),
        say('tobin', 'Fit it on your bench. With that, you\'ll reach the reef and back.'),
        S('move', { who: 'tobin', x: 38, y: 30, speed: 1.4 }),
      ] },
      { name: 'rescue', level: 0, steps: [
        S('fade', { to: 'black', frames: 0 }), S('fade', { to: 'clear', frames: 40 }),
        say('tobin', 'Found her bobbing out there like a cork. Dried her off for you.'),
        say('tobin', 'Mind your battery, Pip. Glide when you can.'),
      ] },
      { name: 'ending', level: 0, steps: [
        S('move', { who: 'mags', x: 22.5, y: 20.5, speed: 1.4 }),
        say('mags', 'The satchel! And the letters are dry!'),
        say('pip', 'Snagged on an old mast out on the reef. Easy... mostly.'),
        say('mags', 'Pip, how would you like a job? Perch could use a mail plane.'),
        S('sound', { note: 'E6', wave: 4 }),
        say('', 'Thanks for playing Tinwing! Keep flying to find the rest of the scrap.'),
      ] },
    ];

    // ---- level 1: Perch, the town (64x48 tiles)
    const town = new Uint16Array(W * 128);
    const TW = 64, TH = 48;
    const set = (m, x, y, t) => { m[y * W + x] = t; };
    const rect = (m, x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(m, x, y, t); };
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) set(town, x, y, hash(x, y, 20) < 0.2 ? 2 : 1);
    rect(town, 14, 26, 50, 27, 8);         // main boardwalk
    rect(town, 31, 9, 32, 41, 9);          // north-south boardwalk
    rect(town, 16, 18, 24, 25, 10);        // Pip's shed
    rect(town, 37, 16, 46, 25, 10);        // the pigeon post
    rect(town, 35, 29, 46, 34, 10);        // Tobin's dock
    rect(town, 40, 35, 41, 39, 9);         // the pier
    rect(town, 16, 29, 24, 35, 10);        // houses
    rect(town, 24, 11, 30, 17, 10);
    rect(town, 34, 8, 40, 13, 10);
    rect(town, 28, 23, 35, 30, 13);        // the plaza
    rect(town, 51, 14, 57, 20, 3); rect(town, 52, 15, 56, 19, 4); rect(town, 53, 16, 55, 18, 5);   // a sand bar
    const tplaced = [];
    const footprint = (m, gx, gy) => rect(m, Math.floor(gx / 8) - 2, Math.floor(gy / 8) - 2, Math.floor(gx / 8) + 1, Math.floor(gy / 8) - 1, 22);
    const bldg = (type, tx, ty) => { footprint(town, tx * 8, ty * 8); at(tplaced, type, tx * 8, ty * 8); };
    bldg('shed', 20, 21); bldg('loft', 42, 20); bldg('house_a', 20, 32); bldg('house_b', 27, 15); bldg('house_a', 37, 11);
    at(tplaced, 'pip', 21 * 8, 24 * 8);
    at(tplaced, 'bench', 18 * 8, 23 * 8);
    at(tplaced, 'mags', 40 * 8 + 4, 23 * 8 + 4);
    at(tplaced, 'tobin', 39 * 8, 32 * 8);
    at(tplaced, 'boat', 44 * 8, 38 * 8);
    [[30, 27], [34, 24], [45, 24], [25, 27], [23, 34]].forEach(([x, y]) => at(tplaced, 'pigeon', x * 8, y * 8));
    [[12, 22], [50, 31], [46, 41], [27, 38]].forEach(([x, y]) => at(tplaced, 'buoy', x * 8, y * 8));
    at(tplaced, 'palm', 54 * 8, 17 * 8);

    // ---- level 2: the Shallows, the open sea (200x128 tiles)
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

    cart.map.set(town);
    cart.entities.placed = tplaced;
    cart.levels = [
      { name: 'Perch', w: TW, h: TH, map: cart.map, placed: tplaced },
      { name: 'The Shallows', w: SW, h: SH, map: sea, placed: splaced },
    ];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Tinwing', code, buildGfx,
    about: 'A story game in 2.5D: build RC planes in a flooded town on stilts and fly them out to find what the squall took.' });
})();
