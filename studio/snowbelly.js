/* Demo cart "Snowbelly": a downhill belly-slide race for penguins and seals, 1-8 players. Original art and code. MIT License. */
(function () {
  const code = `
-- Snowbelly: belly-slide down a mountain as a penguin or a seal (1-8 players, split screen or linked Bits)
--   Left / right: steer (in a half pipe: pump from wall to wall). Down: tuck (faster, but you steer less). Up: brake.
--   A: jump. Press it right at the lip of a ramp or the top of a hill for a PERFECT POP / APEX POP (more height, points).
--   Hold down as you land on a steep slope and you keep the push downhill: a SLOPE LANDING boost.
--   B: trick, in the air. Hold B to keep turning, let go and the trick finishes its turn. Land only once it's done!
--      B alone or with left / right: Twirl (a spin). B + up: Flipper (a front flip). B + down: Backflop.
--   X: use what you got from a crate: Snowballs (3 throws), Fish (a burst of speed), Magnet (pulls in rings).
--   A Guard from a crate saves your next bad landing or snowball hit by itself.
-- Points: rings in the air, flag gates, tricks (more turns and mixed tricks in one jump score more, a landing
-- right after the trick finishes is PERFECT) and the finish place. Most points wins; the podium shows the top 3.
-- The slope is drawn as segments, far to near, with trifill / quadfill: cheap enough for the ESP32-S3.
-- Linked Bits run in lockstep: only update code calls rnd(), drawing never changes the game.

SL = 2                                      -- segment length (m)
W = 6                                       -- half width of a normal slope
PFLAT, POUT, LIP = 3, 7.5, 3.4              -- half pipe: flat floor half width, lip, lip height
G = tune("Gravity", 0.0075, 0.003, 0.015, 0.0005)
PULL = tune("Downhill pull", 0.0085, 0.003, 0.02, 0.0005)
DRAG = tune("Air drag", 0.016, 0.005, 0.04, 0.001)
POP = tune("Jump", 0.085, 0.03, 0.15, 0.005)
PERFECT_POP = tune("Perfect pop extra", 0.06, 0, 0.15, 0.005)
STEER = tune("Steering", 0.13, 0.05, 0.3, 0.01)
SPIN_RATE = tune("Twirl turns per frame", 1 / 30, 0.01, 0.08, 0.001)
FLIP_RATE = tune("Flip turns per frame", 1 / 38, 0.01, 0.08, 0.001)
PERFECT_WIN = 12                            -- land within this many frames of the trick finishing: PERFECT
CAMD, CAMH, FOCAL = 6.5, 2.6, 165
RING_R = 1.5
NEAR = 0.6
PLACE_PTS = { 1000, 700, 500, 350, 250, 180, 120, 80 }
TRICKS = { { "TWIRL", 80 }, { "FLIPPER", 120 }, { "BACKFLOP", 120 } }
ITEMS = { "SNOWBALLS", "GUARD", "FISH", "MAGNET" }
SPECIES = { "PENGUIN", "SEAL" }
-- the two ways to ride: penguins are light and nimble, seals are heavy and fast
STYLE = {
  { steer = 1.25, top = 0.58, pull = 0.95, spin = 1.18, pump = 1.2, pop = 1.1, knock = 1.0, push = 0.6,
    about = { "LIGHT + NIMBLE", "quick turns+tricks" } },
  { steer = 0.8, top = 0.7, pull = 1.12, spin = 0.84, pump = 0.85, pop = 0.9, knock = 0.5, push = 1.6,
    about = { "HEAVY + FAST", "hits barely hurt" } },
}
-- body colours per species: three shades swapped into 240, 241, 242 of the sprites
COATS = {
  { { "INK", { 1, 31, 30 } }, { "NIGHT BLUE", { 19, 20, 21 } }, { "PLUM", { 2, 3, 4 } }, { "COCOA", { 6, 7, 8 } } },
  { { "GREY", { 30, 28, 29 } }, { "BROWN", { 6, 7, 8 } }, { "PALE", { 28, 29, 13 } }, { "SOOT", { 31, 30, 28 } } },
}
-- scarf colours: three shades each (dark, mid, light) swapped into 24, 25, 26 of the sprites
SCARVES = { { 24, 25, 26 }, { 19, 20, 21 }, { 14, 15, 16 }, { 9, 27, 27 }, { 2, 3, 4 }, { 7, 8, 10 }, { 4, 5, 12 }, { 31, 30, 29 } }
SCARF_NAMES = { "RED", "BLUE", "GREEN", "GOLD", "PURPLE", "RUST", "PINK", "SLATE" }
CPU_NAMES = { "PIP", "MOSS", "TUFT", "ROE", "BRAN", "KELP", "DUNE" }
KEYS = { "left", "right", "up", "down", "a", "b", "x" }

-- the three slopes: sections are {kind, length, curve, slope, extras}
COURSES = {
  { name = "FROSTPINE RUN", about = "Gentle pines, two kickers and a short pipe.", sky = { 21, 22, 23, 211 }, hill = { 169, 205 },
    snow = { 13, 247 }, track = { 211, 23 }, wall = { 211, 205, 169, 162 }, far = 211, night = false,
    secs = {
      { "run", 40, 0, -0.18 },
      { "run", 60, 0.0016, -0.24, gates = 4 },
      { "kick", 2.6 },
      { "run", 50, -0.0018, -0.26, rings = 4 },
      { "run", 30, 0, -0.2, crates = true },
      { "pipe", 110, 0.0008, -0.2 },
      { "run", 40, -0.0014, -0.26, gates = 3 },
      { "kick", 3.2 },
      { "run", 50, 0.0018, -0.27, rings = 5 },
      { "rollers", 40, 0, -0.24 },
      { "run", 30, 0, -0.22, crates = true },
      { "kick", 2.8 },
      { "run", 60, -0.0012, -0.25, gates = 4 },
      { "finish" },
    } },
  { name = "GLACIER GULLY", about = "Long half pipes in blue ice. Air out over the lips!", sky = { 9, 10, 11, 12 }, hill = { 162, 169 },
    snow = { 12, 13 }, track = { 23, 211 }, wall = { 211, 169, 162, 126 }, far = 12, night = false,
    secs = {
      { "run", 40, 0, -0.2 },
      { "pipe", 130, 0.0012, -0.22 },
      { "run", 30, 0, -0.24, crates = true },
      { "kick", 3 },
      { "run", 40, -0.002, -0.26, gates = 3 },
      { "pipe", 150, -0.001, -0.21 },
      { "drop", 6 },
      { "run", 40, 0.0015, -0.25, rings = 4 },
      { "run", 20, 0, -0.22, crates = true },
      { "pipe", 120, 0.0015, -0.23 },
      { "kick", 3.4 },
      { "run", 50, 0, -0.26, gates = 4 },
      { "finish" },
    } },
  { name = "AURORA DROP", about = "Night run under the lights. Big cliffs, big air.", sky = { 1, 19, 19, 2 }, hill = { 126, 20 },
    snow = { 205, 169 }, track = { 211, 205 }, wall = { 205, 169, 162, 126 }, far = 162, night = true,
    secs = {
      { "run", 40, 0, -0.22 },
      { "kick", 3.4 },
      { "run", 40, 0.002, -0.3, gates = 3 },
      { "drop", 8 },
      { "run", 30, 0, -0.26, crates = true },
      { "pipe", 120, -0.0016, -0.24 },
      { "kick", 3.8 },
      { "run", 40, -0.0018, -0.3, rings = 5 },
      { "rollers", 40, 0.001, -0.28 },
      { "drop", 9 },
      { "run", 20, 0, -0.24, crates = true },
      { "kick", 4 },
      { "run", 50, 0.0015, -0.3, gates = 4 },
      { "finish" },
    } },
}

function _init()
  game{
    title = "Snowbelly",
    in_menu = function() return state == "yard" or state == "pick" end,   -- rider and slope pick: no pause
    players = { 1, 8 },
    goal = "Win the Snowbelly Cup: the most points after all three slopes.",
    help = {
      "Left / right: steer. Down: tuck (faster, steers less). Up: brake.",
      "A: jump. Right at the lip of a ramp it's a PERFECT POP, right at the top of a hill an APEX POP.",
      "Hold down as you land on a steep slope for a SLOPE LANDING speed boost.",
      "B in the air: trick. Hold to keep turning, let go and it finishes the turn. Land only once it's done!",
      "B: Twirl. B + up: Flipper. B + down: Backflop. Mix them in one jump for more.",
      "Fly through rings and between flags. Crates give Snowballs, Fish, Magnet or a Guard. X uses them.",
      "Tricks, rings, flags and your finish place all add up. Most points wins.",
      "Penguins are light: sharp turns and quick tricks. Seals are heavy: faster at the top, and hits barely slow them.",
    },
    continue = function(cp) resume(cp) end,
    settings = {
      { key = "rivals", name = "CPU rivals", values = { "Off", "On" }, value = 2 },
      { key = "cpu", name = "CPU skill", values = { "Easy", "Normal", "Hard" }, value = 2 },
    },
    title_draw = function(t) draw_title(t) end,
    look = { title = 13, shadow = 20, panel = 19, edge = 22, hi = 20, text = 23, pick = 27, goal = 13, footer = 22 },
  }
  NP = math.max(1, math.min(PLAYERS or 1, 8))
  NV = ((ME or 0) > 0) and 1 or math.min(NP, 4)     -- views on this screen
  gt, last_t = 0, -9
  pad, edge = {}, {}
  looks = {}
  for p = 1, NP do looks[p] = { sp = (p - 1) % 2 + 1, sc = (p - 1) % #SCARVES + 1, co = 1 } end
  cup = nil
  course_n = 1
  build_course(1)
  riders, cams, balls, fx = {}, {}, {}, {}
  yard_row, ready, sel = {}, {}, 1
  for p = 1, NP do yard_row[p], ready[p] = 1, false end
  state, state_t = "yard", 0
end

-- what Continue does: straight back into the cup run you were on (or the slope you last played)
function resume(cp)
  if type(cp) ~= "table" then return end
  if NP == 1 and cp.look then looks[1] = { sp = cp.look.sp or 1, sc = cp.look.sc or 1, co = cp.look.co or 1 } end
  if cp.cup and NP == 1 then
    cup = { run = cp.cup, total = cp.total or {} }
    start_run(cp.cup)
  else
    cup = nil
    start_run(cp.course or 1)
  end
end

-- ---------------------------------------------------------------- helpers
function sgn(v) return v > 0 and 1 or (v < 0 and -1 or 0) end
function mid(a, v, b) return math.max(a, math.min(v, b)) end
function lerp(a, b, f) return a + (b - a) * f end
function ctext(s, y, c, sc) sc = sc or 1 text(s, VCX - #s * 4 * sc, y, c, sc) end
function stext(s, x, y, c, sc) sc = sc or 1 text(s, x + sc, y + sc, 1, sc) text(s, x, y, c, sc) end
function sctext(s, y, c, sc) sc = sc or 1 stext(s, VCX - #s * 4 * sc, y, c, sc) end
function ord(n) return n .. ((n % 100 >= 11 and n % 100 <= 13) and "TH" or ({ "ST", "ND", "RD" })[n % 10] or "TH") end

function read_pads()
  local fresh = t() ~= last_t + 1
  last_t = t()
  for p = 1, NP do
    local now, was = {}, pad[p] or {}
    edge[p] = {}
    for _, k in ipairs(KEYS) do
      now[k] = btn(k, p)
      edge[p][k] = now[k] and not was[k] and not fresh
    end
    pad[p] = now
  end
end
function any_edge(k) for p = 1, NP do if edge[p][k] then return p end end end

-- a little random number generator of our own for the scenery, so building a slope never touches rnd()
function lcg(s) local v = s return function() v = (v * 1103515245 + 12345) % 2147483648 return v / 2147483648 end end

-- ---------------------------------------------------------------- building a slope
function build_course(n)
  course_n = n
  local C = COURSES[n]
  TH = C
  Y, CX, PP, SLP, RMP, OBJ, CREST = {}, {}, {}, {}, {}, {}, {}
  RINGS, GATES, CRATES = {}, {}, {}
  local R = lcg(n * 7919)
  local y, cx, dcx, slope, curve, s = 0, 0, 0, -0.15, 0, 1
  local function push(sl, cv, pipe, ramp)
    slope = lerp(slope, sl, 0.12)
    curve = lerp(curve, cv, 0.08)
    dcx = mid(-0.35, dcx + curve, 0.35)
    Y[s], CX[s], PP[s], SLP[s], RMP[s], OBJ[s] = y, cx, pipe, slope, ramp or 0, OBJ[s] or {}
    y, cx, s = y + slope * SL, cx + dcx * SL, s + 1
  end
  local function obj(at, o) OBJ[at] = OBJ[at] or {} local l = OBJ[at] l[#l + 1] = o o.s = o.s or at return o end
  local start = s
  for _, sec in ipairs(C.secs) do
    local k = sec[1]
    local s0 = s
    if k == "run" or k == "rollers" then
      for i = 1, sec[2] do
        push(sec[4], sec[3], 0)
        if k == "rollers" then
          y = y + math.sin(i / 5) * 0.55
          if math.sin((i - 1) / 5) > 0 and math.sin(i / 5) <= 0 then CREST[s] = true end   -- the top of a roller
        end
      end
    elseif k == "pipe" then
      local len = sec[2]
      for i = 1, len do
        local p = mid(0, math.min(i / 14, (len - i) / 14), 1)
        push(sec[4], sec[3], p)
      end
      -- rings over the lips and a line down the middle
      for i = 24, len - 24, 18 do
        local side = ((i // 18) % 2 == 0) and 1 or -1
        RINGS[#RINGS + 1] = obj(s0 + i, { k = "ring", s = s0 + i, x = side * (POUT - 0.3), h = 1.6 + ((i // 36) % 2) * 0.6 })
      end
    elseif k == "kick" then
      local H, K = sec[2], 7
      for j = 1, K do
        push(slope, curve, 0, j)
        y = y + H * ((j / K) ^ 2 - ((j - 1) / K) ^ 2)
      end
      local lip_s = s                                     -- the lip is where this segment starts
      push(slope, curve, 0, 99)
      y = y - H
      -- rings along the flight: worked out with the same physics a rider at a good speed would fly
      local v, vy = 0.42, 0.42 * (2 * H / (K * SL) + slope) + POP * 0.7
      local h, z = Y[lip_s], 0
      for f = 1, 200 do
        z, h, vy = z + v, h + vy, vy - G
        local at = lip_s + math.floor(z / SL)
        local base = y + slope * (z - SL)
        if f % 14 == 0 and f <= 56 and h - base > 1.4 then
          RINGS[#RINGS + 1] = obj(at, { k = "ring", s = at, x = 0, h = h - base, zf = (z % SL) / SL })
        end
        if h < base then break end
      end
    elseif k == "drop" then
      for i = 1, 4 do push(slope, curve, 0) y = y - sec[2] / 4 * (i < 4 and 1 or 1) end
      RMP[s - 5] = 98
    elseif k == "finish" then
      FIN = s + 6
      obj(FIN, { k = "arch", t = "FINISH" })
      for i = 1, 90 do push(-0.06, 0, 0) end
    end
    -- extras along the section
    local len = s - s0
    if sec.gates then
      for g = 1, sec.gates do
        local at = s0 + math.floor(len * g / (sec.gates + 1))
        GATES[#GATES + 1] = obj(at, { k = "gate", s = at, x = ((g % 2 == 0) and 1 or -1) * (1.5 + R() * 2), w = 3.4, c = (g % 2 == 0) and 25 or 20 })
      end
    end
    if sec.rings then
      for g = 1, sec.rings do
        local at = s0 + 8 + math.floor((len - 12) * g / (sec.rings + 1))
        RINGS[#RINGS + 1] = obj(at, { k = "ring", s = at, x = math.sin(g * 1.3 + n) * 3.5, h = 1.4 })
      end
    end
    if sec.crates then
      local at = s0 + len // 2
      for i = -1, 1 do CRATES[#CRATES + 1] = obj(at, { k = "crate", s = at, x = i * 3.4, back = 0 }) end
    end
  end
  for i = 1, 4 do push(0, 0, 0) end
  N = s - 1
  -- hill tops: wherever the slope suddenly gets steeper (a drop, the end of a flat bit) a jump right there is an APEX POP
  for i = 2, N - 1 do
    local d1, d2 = (Y[i] - Y[i - 1]) / SL, (Y[i + 1] - Y[i]) / SL
    if d1 - d2 > 0.12 and RMP[i] ~= 99 and RMP[i - 1] ~= 99 and PP[i] < 0.1 then CREST[i] = true end
  end
  obj(start + 4, { k = "arch", t = "START" })
  -- pine trees and rocks beside the slope (not in the pipes: the deck is bare)
  for i = 2, N - 1, 3 do
    if PP[i] < 0.05 and R() < 0.75 then
      local side = R() < 0.5 and -1 or 1
      obj(i, { k = "tree", x = side * (W + 2.5 + R() * 14), h = 3 + R() * 4, rock = R() < 0.18 })
    end
  end
end

-- the slope at distance z: height of the base line, centre, pipe amount (interpolated)
function seg_at(z)
  local si = z / SL
  local s = math.floor(si) + 1
  if s < 1 then return 1, 0 end
  if s >= N then return N - 1, 1 end
  return s, si - (s - 1)
end
function base_y(z) local s, f = seg_at(z) return Y[s] + (Y[s + 1] - Y[s]) * f end
function pipe_at(z) local s, f = seg_at(z) return PP[s] + (PP[s + 1] - PP[s]) * f end
-- height of the snow at (z, x) and how steep the pipe wall is there (dh/dx)
function ground(z, x)
  local s, f = seg_at(z)
  local by = Y[s] + (Y[s + 1] - Y[s]) * f
  local p = PP[s] + (PP[s + 1] - PP[s]) * f
  if p <= 0 then return by, 0, W, W end
  local fl, out = lerp(W, PFLAT, p), lerp(W, POUT, p)
  local ax = math.abs(x)
  if ax <= fl then return by, 0, fl, out end
  local span = out - fl
  if ax >= out then return by + LIP * p, 0, fl, out end
  local u = (ax - fl) / span
  return by + LIP * p * u * u, sgn(x) * 2 * LIP * p * u / span, fl, out
end

-- ---------------------------------------------------------------- starting a run
function start_run(n)
  build_course(n)
  if NP == 1 then checkpoint({ course = n, cup = cup and cup.run or nil, total = cup and cup.total or nil, look = looks[1] }) end
  riders, balls, fx = {}, {}, {}
  local rivals = (setting("rivals") or 2) == 2
  local total = rivals and math.max(4, NP) or NP
  local used = {}
  for p = 1, NP do used[looks[p].sc] = true end
  for i = 1, total do
    local r = new_rider(i)
    if i <= NP then
      r.pn, r.sp, r.sc, r.co, r.name = i, looks[i].sp, looks[i].sc, looks[i].co or 1, player_name(i, 6):upper()
    else
      r.pn, r.sp = 0, (i % 2) + 1
      local c = 1
      while used[c] and c < #SCARVES do c = c + 1 end
      used[c] = true
      r.sc, r.co, r.name = c, (i + n) % 4 + 1, CPU_NAMES[(i - NP - 1 + n * 2) % #CPU_NAMES + 1]
      r.skill = ({ 0.55, 0.78, 0.95 })[setting("cpu") or 2] + (i % 3) * 0.03
    end
    riders[i] = r
  end
  for p = 1, NP do cams[p] = { z = riders[p].z - CAMD, x = riders[p].x, y = Y[1] + CAMH, hd = 0, pt = -0.15 } end
  race_t, fin_count, end_t = 0, 0, nil
  for _, c in ipairs(CRATES) do c.back = 0 end
  state, state_t = "count", 0
end

function new_rider(i)
  local row, col = (i - 1) // 4, (i - 1) % 4
  return { i = i, z = 6 - row * 3, x = (col - 1.5) * 2.6, h = 0, vx = 0, vy = 0, v = 0, air = false,
           tk = nil, combo = {}, done_t = 99, tumble = 0, item = nil, ammo = 0, guard = false, boost = 0, magnet = 0,
           pts = 0, ring_n = 0, gate_n = 0, trick_pts = 0, place = i, fin = nil, pops = {}, got = {}, lean = 0,
           pump = 1, aim = 0, plan = 0, jump_cd = 0, bump = 0, air_t = 0, chain = 0 }
end

-- ---------------------------------------------------------------- input: people and CPU riders
function human_input(r)
  local n = r.pn
  local P, E = pad[n], edge[n]
  local d = nil
  if P.up then d = "u" elseif P.down then d = "d" elseif P.left then d = "l" elseif P.right then d = "r" end
  return { steer = (P.right and 1 or 0) - (P.left and 1 or 0), tuck = P.down and not P.b, brake = P.up and not P.b,
           jump = E.a, trick = P.b, trick_new = E.b, dir = d, use = E.x }
end

function cpu_input(r)
  local I = { steer = 0, tuck = true, brake = false, jump = false, trick = false, trick_new = false, use = false }
  local sk = r.skill or 0.8
  local s = seg_at(r.z)
  if gt % 8 == r.i % 8 then
    -- the next thing worth aiming at: a ring low enough, a gate, a crate when empty-handed
    local best, bz = nil, 1e9
    for j = s + 2, math.min(N, s + 22) do
      for _, o in ipairs(OBJ[j] or {}) do
        local want = (o.k == "gate") or (o.k == "ring" and o.h < 2.6 and not r.got[o]) or (o.k == "crate" and not r.item and gt >= o.back)
        if want and j < bz then best, bz = o, j end
      end
      if best then break end
    end
    r.aim = best and best.x or r.aim * 0.9
    r.aim = r.aim + (rnd() - 0.5) * (1 - sk) * 4
  end
  local p = pipe_at(r.z)
  local tx = r.aim
  if p > 0.6 and not r.air then
    -- pump from wall to wall
    local _, _, fl, out = ground(r.z, r.x)
    if r.x * r.pump > out * 0.85 then r.pump = -r.pump end
    tx = r.pump * out
  end
  I.steer = mid(-1, (tx - r.x) * 0.9, 1)
  I.tuck = math.abs(tx - r.x) < 1.2           -- tucked riders steer less, so only tuck when on line
  -- jump at the lip: good riders time it well
  if not r.air and RMP[s] >= 3 and RMP[s] < 98 then
    local lip_z = 0
    for j = s, s + 8 do if RMP[j] == 99 then lip_z = (j - 1) * SL break end end
    local dist = lip_z - r.z
    if dist > 0 and dist < r.v * (2 + (1 - sk) * 10 + r.i % 3) then I.jump = true end
  end
  -- tricks: decide how many turns fit in the air
  if r.air then
    if not r.tk and #r.combo == 0 and r.plan == 0 then
      local _, _, fl = ground(r.z, r.x)
      local hb = r.h - ground(r.z + r.v * 20, r.x)
      local vy = r.vy
      local air = (vy + math.sqrt(math.max(0, vy * vy + 2 * G * math.max(0, hb)))) / G
      local turns = math.floor(air * SPIN_RATE * STYLE[r.sp].spin * (0.55 + sk * 0.4) + (rnd() - 0.5) * (1.2 - sk))
      r.plan = turns > 0 and turns or -1
      r.plan_kind = rnd(1, 3)
    end
    if r.plan > 0 then
      if not r.tk then
        I.trick, I.trick_new = true, true
        I.dir = ({ "r", "u", "d" })[r.plan_kind]
      elseif not r.tk.target and r.tk.rot < r.plan - 0.6 then
        I.trick = true
      else
        r.plan = -1
      end
    end
  else
    r.plan = 0
  end
  if r.item then
    if r.item == 1 then
      local tgt = target_ahead(r)
      if tgt and rnd() < 0.05 then I.use = true end
    elseif rnd() < 0.02 then I.use = true end
  end
  if sk < 0.7 and gt % 90 < 30 then I.tuck = false end
  return I
end

function target_ahead(r)
  local best, bd = nil, 45
  for _, o in ipairs(riders) do
    local d = o.z - r.z
    if o ~= r and d > 2 and d < bd and not o.fin then best, bd = o, d end
  end
  return best
end

-- ---------------------------------------------------------------- the riders
function pop_text(r, s, c) r.pops[#r.pops + 1] = { s = s, c = c or 27, t = 0 } if #r.pops > 3 then table.remove(r.pops, 1) end end

function crash(r, why)
  if r.guard then
    r.guard = false
    pop_text(r, "GUARD SAVED YOU", 22)
    sfx("E5", 4, 0.3, 8, nil, 0, 200)
    return false
  end
  r.tumble, r.tk, r.combo = 50, nil, {}
  r.v = r.v * 0.45
  pop_text(r, why or "WIPEOUT!", 26)
  if r.pn > 0 then sfx("C2", 2, 0.5, 18, nil, 0, -40) end
  for i = 1, 8 do fx[#fx + 1] = { z = r.z, x = r.x + (rnd() - 0.5) * 2, h = r.h + rnd() * 0.5, vx = (rnd() - 0.5) * 0.08, vy = rnd() * 0.08, t = 30 } end
  return true
end

function land(r, I)
  local was_air = r.air_t or 0
  r.air, r.air_t = false, 0
  if r.tk then
    local f = r.tk.rot - math.floor(r.tk.rot)
    if (f < 0.12 or f > 0.88) and r.tk.rot > 0.6 then
      r.combo[#r.combo + 1] = { k = r.tk.kind, n = math.floor(r.tk.rot + 0.5) }
      r.tk = nil
      score_tricks(r, 0.5, "SKETCHY ")
    else
      if crash(r, "WIPEOUT!") then return end
      r.tk = nil
      score_tricks(r, 1, "")
    end
  elseif #r.combo > 0 then
    if r.done_t <= PERFECT_WIN then score_tricks(r, 1.5, "PERFECT ") r.boost = math.max(r.boost, 40)
    else score_tricks(r, 1, "") end
  end
  if was_air > 20 and r.pn > 0 then sfx("C3", 3, 0.3, 4) end
  r.combo = {}
  -- holding down (tucked) as you land on a steep slope keeps the fall going downhill
  local sl = ground(r.z + 1, r.x) - ground(r.z, r.x)
  if I and I.tuck and was_air > 15 and sl < -0.2 and r.tumble == 0 then
    local add = math.min(0.12, 0.03 + (-sl - 0.2) * 0.35 + was_air * 0.0008)
    r.v = r.v + add
    r.boost = math.max(r.boost, 20)
    pop_text(r, "SLOPE LANDING", 17)
    if r.pn > 0 then sfx("G4", 1, 0.25, 8, nil, 0, 500) end
  end
end

function score_tricks(r, mul, label)
  if #r.combo == 0 then return end
  local pts, kinds, names = 0, {}, {}
  for _, c in ipairs(r.combo) do
    pts = pts + TRICKS[c.k][2] * c.n
    kinds[c.k] = true
    names[#names + 1] = (c.n > 1 and (c.k == 1 and (c.n * 360 .. " ") or (c.n == 2 and "DOUBLE " or c.n .. "X ")) or "") .. TRICKS[c.k][1]
  end
  local mix = 0
  for _ in pairs(kinds) do mix = mix + 1 end
  pts = math.floor(pts * mul * (1 + (mix - 1) * 0.5))
  r.pts, r.trick_pts = r.pts + pts, r.trick_pts + pts
  pop_text(r, label .. table.concat(names, "+"), mul >= 1.5 and 27 or 13)
  pop_text(r, "+" .. pts, 17)
  if r.pn > 0 then sfx(mul >= 1.5 and "G5" or "E5", 1, 0.35, 8, nil, 0, 300) end
end

function step(r, I)
  local ST = STYLE[r.sp] or STYLE[1]
  if r.fin then I = { steer = -sgn(r.x) * 0.3, tuck = false, brake = true } end
  if r.tumble > 0 then
    r.tumble = r.tumble - 1
    I = { steer = 0 }
  end
  local s = seg_at(r.z)
  local g, dhx, fl, out = ground(r.z, r.x)
  local pipe = pipe_at(r.z)
  if r.jump_cd > 0 then r.jump_cd = r.jump_cd - 1 end
  if r.boost > 0 then r.boost = r.boost - 1 end
  if r.magnet > 0 then r.magnet = r.magnet - 1 end
  -- speed along the slope
  if not r.air then
    local ahead = base_y(r.z + 1) - base_y(r.z)
    local drag = DRAG * (I.tuck and 0.6 or 1) * (I.brake and 3 or 1)
    if math.abs(r.x) > W + 0.5 and pipe < 0.1 then drag = drag * 3 end    -- deep snow beside the slope
    r.v = r.v - ahead * PULL * 2 * ST.pull - drag * r.v * r.v - 0.0004
    if r.boost > 0 then r.v = r.v + 0.004 end
    if r.v < 0.04 and race_t > 0 then r.v = 0.04 end
    r.v = mid(0, r.v, ST.top + (I.tuck and 0.05 or 0) + (r.boost > 0 and 0.13 or 0))
  else
    r.v = r.v * 0.9995
  end
  -- steering (on a pipe wall it's pumping: gravity pulls you back to the middle)
  local s2 = math.min(s, N - 2)
  local cv = (CX[s2 + 2] - 2 * CX[s2 + 1] + CX[s2]) / (SL * SL)        -- how much the slope bends here
  if r.air then
    r.vx = r.vx * 0.99
  elseif pipe > 0.3 then
    r.vx = r.vx + (I.steer or 0) * 0.012 * ST.pump - dhx * G * 1.6
    r.vx = r.vx * 0.985
  else
    local tgt = (I.steer or 0) * STEER * ST.steer * (I.tuck and 0.45 or 1)
    r.vx = lerp(r.vx, tgt, 0.12 + 0.06 * ST.steer)
  end
  if not r.air then r.vx = r.vx - cv * r.v * r.v * 18 end
  r.lean = lerp(r.lean, I.steer or 0, 0.2)
  r.x = r.x + r.vx
  -- the walls of the slope: deep snow on a normal slope, the lip in a pipe
  if pipe > 0.3 then
    if math.abs(r.x) >= out - 0.05 and not r.air then
      if r.vx * sgn(r.x) > 0.05 then
        -- air out over the lip!
        r.air, r.air_t = true, 0
        r.vy = math.min(math.abs(r.vx) * 1.1, 0.19)
        r.x = sgn(r.x) * (out - 0.1)
        r.vx = -sgn(r.x) * 0.012
        r.done_t, r.combo = 99, {}
      else
        r.x = sgn(r.x) * (out - 0.05)
        r.vx = -r.vx * 0.3
      end
    end
  else
    if math.abs(r.x) > W + 5 then r.x = sgn(r.x) * (W + 5) r.vx = 0 end
  end
  -- up and down
  local oz = r.z
  r.z = r.z + r.v
  local g1 = ground(r.z, r.x)
  if r.air then
    r.air_t = r.air_t + 1
    r.vy = r.vy - G
    r.h = r.h + r.vy
    if r.h <= g1 then
      -- land moving with the snow: down a slope the ground falls away every frame, and a vertical speed of 0
      -- here would launch the rider again on the next frame, bouncing forever
      r.h = g1
      r.vy = g1 - ground(oz, r.x)
      land(r, I)
    end
  else
    local ballistic = r.h + r.vy - G
    if g1 < ballistic - 0.04 then
      r.air, r.air_t = true, 0
      r.h, r.vy = ballistic, r.vy - G
      r.done_t, r.combo = 99, {}
    else
      r.vy = g1 - r.h
      r.h = g1
    end
    if I.jump and r.jump_cd == 0 and r.tumble == 0 then
      local lip, apex = false, false
      for j = s, s + 3 do
        local d = (j - 1) * SL - r.z
        if d < r.v * 6 + 0.5 and d > -0.3 then
          if RMP[j] == 99 then lip = true elseif CREST[j] then apex = true end
        end
      end
      r.vy = r.vy + POP * ST.pop + (lip and PERFECT_POP or 0) + (apex and not lip and PERFECT_POP * 0.7 or 0)
      r.air, r.air_t, r.jump_cd = true, 0, 20
      r.done_t, r.combo = 99, {}
      if lip then r.pts = r.pts + 50 pop_text(r, "PERFECT POP +50", 27)
      elseif apex then r.pts = r.pts + 30 pop_text(r, "APEX POP +30", 27) end
      if r.pn > 0 then sfx((lip or apex) and "A4" or "E4", 1, 0.25, 5, nil, 0, 400) end
    end
  end
  -- tricks in the air
  if r.air and r.tumble == 0 then
    r.done_t = r.done_t + 1
    if not r.tk and I.trick_new then
      local k, d = 1, 1
      if I.dir == "u" then k = 2 elseif I.dir == "d" then k = 3 elseif I.dir == "l" then d = -1 end
      r.tk = { kind = k, dir = d, rot = 0, target = nil }
    end
    local tk = r.tk
    if tk then
      local rate = (tk.kind == 1 and SPIN_RATE or FLIP_RATE) * ST.spin
      if not tk.target and not I.trick then tk.target = math.max(1, math.ceil(tk.rot - 0.05)) end
      tk.rot = tk.rot + rate
      if tk.target and tk.rot >= tk.target then
        r.combo[#r.combo + 1] = { k = tk.kind, n = tk.target }
        r.tk, r.done_t = nil, 0
        if r.pn > 0 then sfx("C5", 0, 0.15, 3) end
      end
    end
  end
  -- rings, gates and crates in this stretch
  local s0, s1 = seg_at(oz), seg_at(r.z)
  for j = s0 - 1, s1 + 1 do
    for _, o in ipairs(OBJ[j] or {}) do
      local oz2 = (o.s - 1 + (o.zf or 0.5)) * SL
      if oz < oz2 and r.z >= oz2 then touch(r, o, oz2) end
    end
  end
  -- finish
  if not r.fin and FIN and r.z >= (FIN - 1) * SL then
    fin_count = fin_count + 1
    r.fin, r.fin_t = fin_count, race_t
    local b = PLACE_PTS[fin_count] or 50
    r.pts, r.place_pts = r.pts + b, b
    pop_text(r, ord(fin_count) .. " PLACE +" .. b, 27)
    if r.pn > 0 then sfx("C5", 1, 0.4, 8) sfx("G5", 1, 0.4, 16) end
  end
  for i = #r.pops, 1, -1 do local p = r.pops[i] p.t = p.t + 1 if p.t > 70 then table.remove(r.pops, i) end end
  -- items
  if I.use and r.item and r.tumble == 0 then use_item(r) end
end

function touch(r, o, oz)
  if o.k == "ring" then
    if r.got[o] then return end
    local gy = ground(oz, o.x) + o.h
    local dx, dy = r.x - o.x, (r.h + 0.5) - gy
    local reach = r.magnet > 0 and 3.4 or RING_R
    if dx * dx + dy * dy <= reach * reach then
      r.got[o] = true
      r.ring_n = r.ring_n + 1
      r.chain = (r.chain or 0) + 1
      local pts = 100 + math.min(r.chain - 1, 4) * 25
      r.pts = r.pts + pts
      pop_text(r, "RING +" .. pts, 27)
      if r.pn > 0 then sfx(72 + math.min(r.chain, 6) * 2, 0, 0.3, 6, nil, 0, 200) end
    else
      r.chain = 0
    end
  elseif o.k == "gate" then
    if math.abs(r.x - o.x) <= o.w / 2 then
      r.gate_n = r.gate_n + 1
      r.pts = r.pts + 50
      pop_text(r, "FLAGS +50", 21)
      if r.pn > 0 then sfx("E5", 4, 0.2, 4) end
    else
      pop_text(r, "MISSED FLAGS", 29)
    end
  elseif o.k == "crate" then
    if gt < o.back or math.abs(r.x - o.x) > 1.4 or r.h - ground(oz, o.x) > 2.4 then return end
    o.back = gt + 180
    if not r.item and r.tumble == 0 then
      local roll = rnd(1, 100)
      local last = r.place >= math.max(2, #riders - 1)
      local it = roll <= (last and 45 or 35) and 1 or roll <= 60 and 2 or roll <= (last and 85 or 80) and 3 or 4
      if it == 2 then
        r.guard = true
        pop_text(r, "GUARD!", 22)
      else
        r.item, r.ammo = it, it == 1 and 3 or 1
        pop_text(r, ITEMS[it] .. "!", 22)
      end
      if r.pn > 0 then sfx("C5", 4, 0.3, 4) sfx("E5", 4, 0.3, 8) end
    end
    for i = 1, 6 do fx[#fx + 1] = { z = oz, x = o.x + (rnd() - 0.5) * 1.5, h = ground(oz, o.x) + 0.6, vx = (rnd() - 0.5) * 0.1, vy = rnd() * 0.1, t = 25, c = 22 } end
  end
end

function use_item(r)
  local it = r.item
  if it == 1 then
    local tgt = target_ahead(r)
    balls[#balls + 1] = { z = r.z + 0.8, x = r.x, h = r.h + 0.8, v = r.v + 0.3, owner = r, tgt = tgt, life = 150 }
    if r.pn > 0 then sfx("A3", 2, 0.3, 4) end
    r.ammo = r.ammo - 1
    if r.ammo <= 0 then r.item = nil end
  elseif it == 3 then
    r.boost, r.item = 140, nil
    pop_text(r, "FISH BOOST!", 10)
    if r.pn > 0 then sfx("C4", 1, 0.3, 20, nil, 0, 600) end
  elseif it == 4 then
    r.magnet, r.item = 420, nil
    pop_text(r, "MAGNET ON", 21)
    if r.pn > 0 then sfx("G4", 0, 0.25, 10) end
  end
end

function step_balls()
  for i = #balls, 1, -1 do
    local b = balls[i]
    b.life = b.life - 1
    b.z = b.z + b.v
    local tgt = b.tgt
    if tgt then
      b.x = b.x + mid(-0.12, tgt.x - b.x, 0.12)
      b.h = lerp(b.h, tgt.h + 0.6, 0.1)
    else
      b.h = lerp(b.h, ground(b.z, b.x) + 0.6, 0.1)
    end
    local hit = false
    for _, r in ipairs(riders) do
      if r ~= b.owner and math.abs(r.z - b.z) < 1.2 and math.abs(r.x - b.x) < 1.1 and math.abs(r.h + 0.5 - b.h) < 1.3 and r.tumble == 0 then
        hit = true
        if crash(r, "SNOWBALLED!") then
          local ST = STYLE[r.sp]
          r.tumble = math.floor(35 * ST.knock)
          if ST.knock < 1 then r.v = r.v / 0.45 * 0.75 pop_text(r, "SHRUGGED IT OFF", 23) end
        end
        if b.owner.pn > 0 then pop_text(b.owner, "HIT " .. r.name .. "!", 23) end
        break
      end
    end
    if hit or b.life <= 0 or b.h < ground(b.z, b.x) - 0.5 then
      for k = 1, 5 do fx[#fx + 1] = { z = b.z, x = b.x, h = b.h, vx = (rnd() - 0.5) * 0.1, vy = rnd() * 0.08, t = 20, c = 13 } end
      table.remove(balls, i)
    end
  end
end

-- riders that bump into each other get nudged apart
function bumps()
  for i = 1, #riders do
    local a = riders[i]
    for j = i + 1, #riders do
      local b = riders[j]
      if math.abs(a.z - b.z) < 1.1 and math.abs(a.x - b.x) < 0.9 and math.abs(a.h - b.h) < 1 then
        local d = (a.x < b.x) and -1 or 1
        local pa, pb = STYLE[b.sp].push, STYLE[a.sp].push      -- a seal shoves a penguin aside
        a.x, b.x = a.x + d * 0.06 * pa, b.x - d * 0.06 * pb
        a.vx, b.vx = a.vx + d * 0.025 * pa, b.vx - d * 0.025 * pb
      end
    end
  end
end

function places()
  local order = {}
  for i, r in ipairs(riders) do order[i] = r end
  table.sort(order, function(a, b)
    if a.fin and b.fin then return a.fin < b.fin end
    if a.fin or b.fin then return a.fin ~= nil end
    if a.z ~= b.z then return a.z > b.z end
    return a.i < b.i
  end)
  for i, r in ipairs(order) do r.place = i end
end

-- ---------------------------------------------------------------- update
function _update()
  gt = gt + 1
  read_pads()
  state_t = state_t + 1
  if state == "yard" then return update_yard() end
  if state == "pick" then return update_pick() end
  if state == "count" then
    if state_t == 1 or state_t == 61 or state_t == 121 then sfx("C4", 0, 0.3, 8) end
    if state_t == 181 then sfx("C5", 0, 0.4, 16) end
    if state_t > 180 then state, state_t = "race", 0 end
    update_cams()
    return
  end
  if state == "race" then
    race_t = race_t + 1
    for _, r in ipairs(riders) do step(r, r.pn > 0 and human_input(r) or cpu_input(r)) end
    step_balls()
    bumps()
    places()
    for i = #fx, 1, -1 do
      local f = fx[i]
      f.x, f.h, f.vy, f.t = f.x + f.vx, f.h + f.vy, f.vy - 0.006, f.t - 1
      if f.t <= 0 then table.remove(fx, i) end
    end
    update_cams()
    -- the run ends when every person is down (CPU riders get a moment more), or 20 s after the first person
    local humans_done, first = true, false
    for _, r in ipairs(riders) do
      if r.pn > 0 and not r.fin then humans_done = false end
      if r.pn > 0 and r.fin then first = true end
    end
    if first and not end_t then end_t = race_t + (humans_done and 120 or 1200) end
    if humans_done and end_t and end_t > race_t + 120 then end_t = race_t + 120 end
    if end_t and race_t >= end_t then finish_run() end
    return
  end
  if state == "results" then
    update_cams()
    local mid_cup = cup and cup.run < 3
    -- between cup runs A (held) goes on to the next slope; after the last run the podium comes up by itself
    if (state_t > 60 and hold_btn("a")) or (not mid_cup and state_t > 240) then
      if mid_cup then
        cup.run = cup.run + 1
        start_run(cup.run)
      else
        state, state_t = "podium", 0
        sfx("C5", 1, 0.4, 10) sfx("E5", 1, 0.4, 20) sfx("G5", 1, 0.4, 30) sfx("C6", 1, 0.4, 45)
      end
    end
    return
  end
  if state == "podium" then
    -- the after-match menu (game shell)
    if state_t > 90 and GAME.state == "play" then
      local n, was_cup = course_n, cup ~= nil
      game_over({
        { "Ride again", function()
            if was_cup then cup = { run = 1, total = {} } start_run(1) else cup = nil start_run(n) end
          end },
        { "Change slope", function() cup = nil state, state_t = "pick", 0 end },
        { "Change rider", function()
            cup = nil
            for p = 1, NP do ready[p] = false end
            state, state_t = "yard", 0
          end },
      })
    end
  end
end

function finish_run()
  -- people still on the slope are placed by how far they got
  places()
  for _, r in ipairs(riders) do
    if not r.fin then
      fin_count = fin_count + 1
      r.fin = fin_count
      local b = math.floor((PLACE_PTS[fin_count] or 50) / 2)
      r.pts, r.place_pts = r.pts + b, b
    end
  end
  places()
  board = {}
  for _, r in ipairs(riders) do
    local key = r.pn > 0 and ("p" .. r.pn) or r.name
    local tot = r.pts
    if cup then
      cup.total[key] = (cup.total[key] or 0) + r.pts
      tot = cup.total[key]
    end
    board[#board + 1] = { r = r, run = r.pts, total = tot }
  end
  table.sort(board, function(a, b) if a.total ~= b.total then return a.total > b.total end return a.r.i < b.r.i end)
  state, state_t = "results", 0
  local won = board[1].r.pn > 0
  if cup then
    if cup.run >= 3 then
      if NP == 1 then checkpoint({ course = 1, look = looks[1] }) end
      if won then game_win(board[1].r.name .. " won the Snowbelly Cup with " .. board[1].total .. " points!") end
    elseif NP == 1 then
      checkpoint({ course = cup.run + 1, cup = cup.run + 1, total = cup.total, look = looks[1] })
    end
  end
end

function update_cams()
  for p = 1, NP do
    local r, c = riders[p], cams[p]
    if r and c then
      local tz = r.z - CAMD
      c.z = lerp(c.z, tz, 0.5)
      c.x = lerp(c.x, r.x * 0.8, 0.12)
      local gy = math.max(base_y(r.z) + LIP * pipe_at(r.z) * 0.85, r.h - 1.0)
      c.y = lerp(c.y, gy + CAMH - (base_y(r.z) - base_y(c.z)) * 0.0, 0.18)
      local s = seg_at(c.z)
      local s2 = math.min(N, s + 6)
      c.hd = lerp(c.hd, (CX[s2] - CX[s]) / ((s2 - s) * SL), 0.12)
      c.pt = lerp(c.pt, SLP[s] or -0.2, 0.08)
    end
  end
end

-- ---------------------------------------------------------------- the yard (pick your rider) and the slope picker
function update_yard()
  for p = 1, NP do
    local E = edge[p]
    if not ready[p] then
      if E.up then yard_row[p] = (yard_row[p] + 1) % 3 + 1 sfx("E5", 0, 0.12, 3) end
      if E.down then yard_row[p] = yard_row[p] % 3 + 1 sfx("E5", 0, 0.12, 3) end
      local d = (E.right and 1 or 0) - (E.left and 1 or 0)
      if d ~= 0 then
        local L = looks[p]
        if yard_row[p] == 1 then L.sp = (L.sp - 1 + d) % #SPECIES + 1
        elseif yard_row[p] == 2 then L.co = ((L.co or 1) - 1 + d) % #COATS[L.sp] + 1
        else L.sc = (L.sc - 1 + d) % #SCARVES + 1 end
        sfx("G5", 0, 0.12, 3)
      end
      if E.a and state_t > 10 then ready[p] = true sfx("C5", 4, 0.3, 6) end
    elseif E.b then ready[p] = false end
  end
  local all = true
  for p = 1, NP do if not ready[p] then all = false end end
  if all then state, state_t = "pick", 0 end
end

PICKS = { "SNOWBELLY CUP", "FROSTPINE RUN", "GLACIER GULLY", "AURORA DROP" }
function update_pick()
  local E = edge[1]
  if E.up then sel = sel == 1 and #PICKS or sel - 1 sfx("E5", 0, 0.12, 3) end
  if E.down then sel = sel % #PICKS + 1 sfx("E5", 0, 0.12, 3) end
  if E.b then
    for p = 1, NP do ready[p] = false end
    state, state_t = "yard", 0
    return
  end
  if E.a and state_t > 10 then
    sfx("C5", 4, 0.3, 6)
    if sel == 1 then cup = { run = 1, total = {} } start_run(1) else cup = nil start_run(sel - 1) end
  end
end

-- ================================================================ drawing (never calls rnd, never changes the game)
function set_view(x, y, w, h)
  VX, VY, VW, VH = x, y, w, h
  VCX = x + w // 2
  VHOR = y + math.floor(h * 0.36)
  VF = FOCAL * math.min(w / 320, h / 240) * (h < 200 and 1.25 or 1)
  clip(x, y, w, h)
end

function draw_sky(cam)
  local sk = TH.sky
  local h = VHOR - VY
  rectfill(VX, VY, VW, h // 3, sk[1])
  rectfill(VX, VY + h // 3, VW, h // 3, sk[2])
  rectfill(VX, VY + 2 * (h // 3), VW, h - 2 * (h // 3) + 2, sk[3])
  if TH.night then
    for i = 0, 1 do                              -- the aurora: two slow green curtains
      for x = VX + i * 3, VX + VW, 7 do
        local u = (x - VX) / 40 + i * 2.1
        local yy = VY + 8 + i * 14 + math.sin(u + gt / 70) * 6
        local hh = 4 + 5 * math.sin(u * 1.7 + gt / 50 + i)
        if hh > 1 then
          pset(x, yy, 17)
          line(x, yy + 1, x, yy + hh, i == 0 and 16 or 15)
        end
      end
    end
    for i = 0, 14 do pset(VX + (i * 83) % VW, VY + (i * 29) % (h - 10), 13) end
  else
    circfill(VX + VW * 0.78, VY + h * 0.35, 9, 12)
  end
  -- mountains, sliding sideways as the slope turns
  local off = (cam and cam.x or 0) * 2 + (cam and cam.mx or 0)
  for layer = 1, 2 do
    local c = TH.hill[layer]
    local base = VHOR + 1
    local amp = layer == 1 and 30 or 16
    local step = layer == 1 and 26 or 18
    local ox = math.floor(off * (layer == 1 and 0.5 or 1)) % (step * 4)
    for x = VX - step * 4 - ox, VX + VW, step do
      local i = math.floor((x + ox) / step)
      local hh = amp * (0.55 + 0.45 * math.sin(i * 1.7 + layer))
      trifill(x, base, x + step, base - hh, x + step * 2, base, c)
      if layer == 1 then trifill(x + step * 0.7, base - hh * 0.7, x + step, base - hh, x + step * 1.3, base - hh * 0.7, 13) end
    end
  end
end

-- reused tables for the projected points
PX, PY, PK, PFL, POU, PLH, PS = {}, {}, {}, {}, {}, {}, {}
DYN = {}

-- project the slope edge at distance z into point j
function proj_point(j, z, cam)
  local s, f = seg_at(z)
  local dz = z - cam.z
  local k = VF / dz
  local by = Y[s] + (Y[s + 1] - Y[s]) * f
  local cx = CX[s] + (CX[s + 1] - CX[s]) * f
  local p = PP[s] + (PP[s + 1] - PP[s]) * f
  local camx = CX0 + cam.x + cam.hd * dz
  PX[j] = VCX + (cx - camx) * k
  PY[j] = VHOR - (by - cam.y - cam.pt * dz) * k
  PK[j] = k
  PFL[j] = lerp(W, PFLAT, p) * k
  POU[j] = lerp(W, POUT, p) * k
  PLH[j] = LIP * p * k
  PS[j] = s
end

-- screen position of a point on the slope (z, x across, h height above the world zero)
function to_screen(cam, z, x, h)
  local dz = z - cam.z
  if dz < NEAR then return nil end
  local s, f = seg_at(z)
  local k = VF / dz
  local cx = CX[s] + (CX[s + 1] - CX[s]) * f
  return VCX + (cx + x - CX0 - cam.x - cam.hd * dz) * k, VHOR - (h - cam.y - cam.pt * dz) * k, k
end

function draw_world(cam, me)
  local cs = seg_at(cam.z)
  CX0 = CX[cs] + (CX[cs + 1] - CX[cs]) * select(2, seg_at(cam.z))
  draw_sky(cam)
  -- the points: the near edge, then segment ends, closer together near the camera
  local z0 = cam.z + NEAR
  local n = 0
  proj_point(0, z0, cam)
  local s = math.floor(z0 / SL) + 2
  local step, far = 1, math.min(N - 1, s + 150)
  while s <= far do
    n = n + 1
    proj_point(n, (s - 1) * SL, cam)
    if n > 40 then step = 2 end
    if n > 70 then step = 3 end
    s = s + step
  end
  -- riders and snowballs go into the segment they're on
  for k in pairs(DYN) do DYN[k] = nil end
  for _, r in ipairs(riders) do local rs = seg_at(r.z) DYN[rs] = DYN[rs] or {} table.insert(DYN[rs], r) end
  for _, b in ipairs(balls) do local bs = seg_at(b.z) DYN[bs] = DYN[bs] or {} table.insert(DYN[bs], b) end
  for _, f in ipairs(fx) do local fs = seg_at(f.z) DYN[fs] = DYN[fs] or {} table.insert(DYN[fs], f) end
  -- far to near
  local TA, TB, SA, SB = TH.track[1], TH.track[2], TH.snow[1], TH.snow[2]
  for j = n, 1, -1 do
    local a, b = j - 1, j                        -- a is nearer
    local ya, yb = PY[a], PY[b]
    local xa, xb = PX[a], PX[b]
    local sg = PS[b] - 1
    local alt = (PS[a] // 2) % 2 == 0
    local farj = j > 40
    -- the ground beside the slope (at lip height in a pipe)
    local la, lb = ya - PLH[a], yb - PLH[b]
    if la >= lb - 0.5 then
      local c = farj and TH.far or (alt and SA or SB)
      local oa, ob = POU[a], POU[b]
      quadfill(VX, la, xa - oa, la, xb - ob, lb, VX, lb, c)
      quadfill(xa + oa, la, VX + VW, la, VX + VW, lb, xb + ob, lb, c)
    end
    -- pipe walls
    local fa, fb = PFL[a], PFL[b]
    local oa, ob = POU[a], POU[b]
    if oa - fa > 0.5 then
      local ma, mb = (fa + oa) / 2, (fb + ob) / 2
      local qa, qb = ya - PLH[a] * 0.25, yb - PLH[b] * 0.25
      -- left wall faces the sun: lighter; the upper half of each wall is lighter than the lower
      local w = TH.wall
      quadfill(xa - oa, la, xa - ma, qa, xb - mb, qb, xb - ob, lb, w[1])
      quadfill(xa - ma, qa, xa - fa, ya, xb - fb, yb, xb - mb, qb, w[2])
      quadfill(xa + fa, ya, xa + ma, qa, xb + mb, qb, xb + fb, yb, w[3])
      quadfill(xa + ma, qa, xa + oa, la, xb + ob, lb, xb + mb, qb, w[2])
      if alt and not farj then line(xa - ma, qa, xa - fa, ya, w[3]) line(xa + fa, ya, xa + ma, qa, w[4]) end
      if not farj then line(xa - oa, la, xb - ob, lb, 20) line(xa + oa, la, xb + ob, lb, 20) end
    end
    -- the groomed slope
    if ya >= yb - 0.5 then
      local rm = RMP[PS[a]]
      local c = farj and TH.far or (alt and TA or TB)
      if RMP[PS[b]] == 99 and rm ~= 99 then c = 25 elseif rm > 0 and rm < 98 then c = alt and 22 or 23 end
      quadfill(xa - fa, ya, xa + fa, ya, xb + fb, yb, xb - fb, yb, c)
      if not farj and oa - fa < 0.5 and alt then
        local e = PK[a] * 0.3
        local e2 = PK[b] * 0.3
        quadfill(xa - fa, ya, xa - fa + e, ya, xb - fb + e2, yb, xb - fb, yb, 21)
        quadfill(xa + fa - e, ya, xa + fa, ya, xb + fb, yb, xb + fb - e2, yb, 21)
      end
    end
    -- things standing on this stretch, far ones first
    for sx = PS[b] - 1, PS[a], -1 do
      local l = OBJ[sx]
      if l and j < 75 then for _, o in ipairs(l) do draw_obj(cam, o, me, j) end end
      local d = DYN[sx]
      if d then
        if #d > 1 then table.sort(d, function(p, q) return p.z > q.z end) end
        for _, o in ipairs(d) do draw_dyn(cam, o, me) end
      end
    end
  end
end

function draw_obj(cam, o, me, j)
  local oz = (o.s and (o.s - 1 + (o.zf or 0.5)) or 0) * SL
  if o.k == "ring" then
    local g = ground(oz, o.x)
    local sx, sy, k = to_screen(cam, oz, o.x, g + o.h)
    if not sx then return end
    local r = RING_R * k
    local got = me and me.got[o]
    if r < 1 then pset(sx, sy, 27) return end
    local c1, c2 = 27, 10
    if got then c1, c2 = 23, 22 end
    if me and me.magnet > 0 and not got then c1 = 13 end
    circ(sx, sy, r, c2)
    circ(sx, sy, r - 1, c1)
    if r > 6 then circ(sx, sy, r - 2, c1) circ(sx, sy, r + 1, 1) end
  elseif o.k == "gate" then
    local g = ground(oz, o.x)
    for side = -1, 1, 2 do
      local px = o.x + side * o.w / 2
      local sx, sy, k = to_screen(cam, oz, px, g)
      if not sx then return end
      local hh = 2.2 * k
      line(sx, sy, sx, sy - hh, 29)
      if k > 4 then line(sx + 1, sy, sx + 1, sy - hh, 28) end
      local fw = 0.9 * k * -side
      local wv = math.sin((gt + o.s * 9) / 8) * k * 0.15
      trifill(sx, sy - hh, sx + fw, sy - hh + 0.4 * k + wv, sx, sy - hh + 0.8 * k, o.c)
    end
  elseif o.k == "crate" then
    if gt < o.back then return end
    local g = ground(oz, o.x)
    local sx, sy, k = to_screen(cam, oz, o.x, g)
    if not sx then return end
    local bob = math.sin((gt + o.x * 20) / 12) * 0.15 * k
    local w = 0.65 * k
    local top = sy - 1.2 * k - 0.4 * k + bob
    rectfill(sx - w, top + 0.25 * k, w * 2, w * 2, 21)
    quadfill(sx - w, top + 0.25 * k, sx + w, top + 0.25 * k, sx + w * 0.8, top, sx - w * 0.8, top, 23)
    rect(sx - w, top + 0.25 * k, w * 2, w * 2, 20)
    if w > 7 then text("?", sx - 3, top + 0.25 * k + w - 3, 13) elseif w > 2 then pset(sx, top + 0.25 * k + w, 13) end
    rectfill(sx - w, sy - 1, w * 2, 2, 162)
  elseif o.k == "tree" then
    local oz2 = (seg_of(o) - 0.5) * SL
    local g = base_y(oz2)
    local sx, sy, k = to_screen(cam, oz2, o.x, g)
    if not sx then return end
    local h = o.h * k
    if o.rock then
      local w = o.h * 0.25 * k
      quadfill(sx - w, sy, sx - w * 0.6, sy - w * 0.9, sx + w * 0.5, sy - w, sx + w, sy, 28)
      quadfill(sx - w * 0.6, sy - w * 0.9, sx - w * 0.2, sy - w * 1.1, sx + w * 0.5, sy - w, sx, sy - w * 0.7, 13)
      return
    end
    local w = h * 0.38
    rectfill(sx - math.max(1, w * 0.12), sy - h * 0.2, math.max(1, w * 0.24), h * 0.2, 7)
    local dark = TH.night and 14 or 15
    trifill(sx - w, sy - h * 0.18, sx, sy - h * 0.7, sx + w, sy - h * 0.18, dark)
    trifill(sx - w * 0.75, sy - h * 0.48, sx, sy - h, sx + w * 0.75, sy - h * 0.48, dark)
    if h > 10 then
      trifill(sx - w * 0.4, sy - h * 0.62, sx, sy - h * 0.7, sx + w * 0.4, sy - h * 0.62, 13)
      trifill(sx - w * 0.3, sy - h * 0.9, sx, sy - h, sx + w * 0.3, sy - h * 0.9, 13)
    end
  elseif o.k == "arch" then
    local z = (seg_of(o) - 1) * SL
    local g = base_y(z)
    local lx, ly, k = to_screen(cam, z, -W - 0.8, g)
    if not lx then return end
    local rx = to_screen(cam, z, W + 0.8, g)
    local top = ly - 4.5 * k
    rectfill(lx - 0.2 * k, top, 0.4 * k + 1, 4.5 * k, 29)
    rectfill(rx - 0.2 * k, top, 0.4 * k + 1, 4.5 * k, 29)
    local bh = 0.9 * k
    rectfill(lx, top, rx - lx, bh, o.t == "FINISH" and 25 or 20)
    if k > 6 then
      local cw = math.max(2, (rx - lx) / 24)
      for i = 0, 23 do if i % 2 == 0 then rectfill(lx + i * cw, top, cw, 2, 13) rectfill(lx + i * cw + cw, top + bh - 2, cw, 2, 13) end end
    end
    local sc = math.floor(mid(1, bh / 9, 4))
    if bh > 7 then text(o.t, (lx + rx) / 2 - #o.t * 4 * sc, top + bh / 2 - 4 * sc, 13, sc) end
  end
end

-- which segment a scenery object sits on (trees and arches keep it the first time it's asked)
function seg_of(o)
  if o.s then return o.s end
  for s2, l in pairs(OBJ) do for _, q in ipairs(l) do if q == o then o.s = s2 return s2 end end end
  return 1
end

-- sprite number for a rider: species, pitch (0 lying, 1 nose up, 2 upside down) and turn (0-7)
function rider_sprite(sp, pitch, yaw)
  local idx = (sp - 1) * 24 + pitch * 8 + (yaw % 8)
  return (idx // 5) * 48 + (idx % 5) * 3
end

function rider_pose(r)
  local pitch, yaw, fy = 0, 0, false
  if r.tumble > 0 then
    local q = (r.tumble // 4) % 4
    pitch, yaw, fy = ({ 0, 1, 2, 1 })[q + 1], (r.tumble // 3) % 8, q == 3
  elseif r.tk then
    local tk = r.tk
    if tk.kind == 1 then yaw = math.floor(tk.rot * 8 + 0.5) * tk.dir
    else
      local q = math.floor(tk.rot * 4 + 0.5) % 4
      if tk.kind == 3 then q = (4 - q) % 4 end
      pitch, fy = ({ 0, 1, 2, 1 })[q + 1], q == 1
      if q == 1 then pitch = 1 end
    end
  elseif r.lean > 0.5 and not r.air then yaw = 7
  elseif r.lean < -0.5 and not r.air then yaw = 1
  end
  return pitch, yaw % 8, fy
end

function rider_pal(sp, co, sc)
  local L = SCARVES[sc] or SCARVES[1]
  pal(24, L[1]) pal(25, L[2]) pal(26, L[3])
  local C = (COATS[sp][co or 1] or COATS[sp][1])[2]
  pal(240, C[1]) pal(241, C[2]) pal(242, C[3])
end
function reset_pal() pal(24, 24) pal(25, 25) pal(26, 26) pal(240, 240) pal(241, 241) pal(242, 242) end

function draw_rider_at(r, sx, sy, k, pitch, yaw, fy)
  local sc = k * 1.9 / 24
  local sz = 24 * sc
  rider_pal(r.sp, r.co, r.sc)
  sspr(rider_sprite(r.sp, pitch, yaw), sx - sz / 2, sy - sz * 0.78, 3, 3, sc, false, fy)
  reset_pal()
end

function draw_dyn(cam, o, me)
  if o.owner ~= nil or o.life then                 -- a snowball
    local sx, sy, k = to_screen(cam, o.z, o.x, o.h)
    if sx then circfill(sx, sy, math.max(1, 0.3 * k), 13) if k > 8 then circ(sx, sy, 0.3 * k, 29) end end
    return
  end
  if o.t and not o.i then                           -- a puff of snow
    local sx, sy, k = to_screen(cam, o.z, o.x, o.h)
    if sx then local w = math.max(1, 0.18 * k) rectfill(sx - w / 2, sy - w / 2, w, w, o.c or 13) end
    return
  end
  local r = o
  local g = ground(r.z, r.x)
  local sx, sy, k = to_screen(cam, r.z, r.x, r.h)
  if not sx then return end
  if r.air then                                      -- shadow on the snow
    local gx, gy, gk = to_screen(cam, r.z, r.x, g)
    if gx then local w = 0.6 * gk rectfill(gx - w, gy - 1, w * 2, 2, TH.night and 126 or 169) end
  else
    local w = 0.55 * k
    rectfill(sx - w, sy - 1, w * 2, math.max(1, 0.15 * k), TH.night and 126 or 169)
  end
  if r.guard and k < 60 then circ(sx, sy - 0.8 * k, 1.1 * k, gt % 8 < 4 and 22 or 23) end
  if r.boost > 0 and gt % 4 < 2 then
    for i = 1, 3 do pset(sx - 0.4 * k + i * 0.2 * k, sy + 1 + i, 10) end
  end
  local p, y, fy = rider_pose(r)
  draw_rider_at(r, sx, sy, k, p, y, fy)
  if r ~= me and k > 3 and (NP > 1 or r.pn == 0) then
    local nm = r.name
    local c = r.pn > 0 and 27 or 13
    text(nm, sx - #nm * 2, sy - 2.3 * k - 8, 1)
    text(nm, sx - #nm * 2 - 1, sy - 2.3 * k - 9, c)
  end
end

function draw_hud(r)
  local big = VH >= 200
  local x0, y0 = VX + 4, VY + 4
  local pl = ord(r.place)
  stext(pl, x0, y0, r.place == 1 and 27 or 13, big and 2 or 1)
  text("/" .. #riders, x0 + #pl * (big and 16 or 8) + 2, y0 + (big and 8 or 0), 13)
  local ps = tostring(r.pts)
  stext(ps, VX + VW - 4 - #ps * (big and 16 or 8), y0, 13, big and 2 or 1)
  if big then text("POINTS", VX + VW - 52, y0 + 18, 23) end
  -- item box
  local bx, by = VCX - 12, VY + 4
  if r.item or r.guard then
    rectfill(bx, by, 24, 16, 1) rect(bx, by, 24, 16, 22)
    if r.item == 1 then for i = 1, r.ammo do circfill(bx + i * 6, by + 8, 2, 13) end
    elseif r.item == 3 then trifill(bx + 4, by + 8, bx + 16, by + 4, bx + 16, by + 12, 10) trifill(bx + 16, by + 8, bx + 21, by + 4, bx + 21, by + 12, 10)
    elseif r.item == 4 then rect(bx + 6, by + 3, 12, 10, 25) rectfill(bx + 9, by + 6, 6, 8, 1) rectfill(bx + 6, by + 11, 3, 2, 13) rectfill(bx + 15, by + 11, 3, 2, 13)
    elseif r.guard then circ(bx + 12, by + 8, 5, 22) end
    if big and r.item then text("X", bx + 26, by + 4, 29) end
  end
  -- speed bar
  if big then
    local w = math.floor(mid(0, r.v / 0.62, 1) * 60)
    rectfill(VX + 4, VY + VH - 10, 62, 6, 1)
    rectfill(VX + 5, VY + VH - 9, w, 4, r.boost > 0 and 10 or 21)
  end
  -- the trick meter: a ring that fills as the trick turns, white when it's done
  if r.tk then
    local tk = r.tk
    local f = tk.rot - math.floor(tk.rot)
    local s = TRICKS[tk.kind][1] .. " " .. (tk.kind == 1 and (math.floor(tk.rot * 360 / 180 + 0.5) * 180) or string.format("%.1f", tk.rot))
    sctext(s, VY + VH - (big and 40 or 22), tk.target and 13 or 27, 1)
    local cx, cy = VCX, VY + VH - (big and 20 or 8)
    for i = 0, 15 do
      local a = i / 16
      local on = a <= f
      pset(cx + math.cos(a * 6.283 - 1.57) * 7, cy + math.sin(a * 6.283 - 1.57) * 7, on and 27 or 30)
    end
  elseif #r.combo > 0 and r.air then
    sctext(r.done_t <= PERFECT_WIN and "LAND NOW!" or "DONE", VY + VH - (big and 40 or 22), 17)
  end
  -- what just happened
  local py = VY + (big and 44 or 18)
  for i, p in ipairs(r.pops) do
    local c = p.t > 55 and 29 or p.c
    sctext(p.s, py + (i - 1) * 10, c)
  end
  if r.tumble > 0 and not big then sctext("OOF", VY + VH // 2, 26) end
  if r.fin then
    sctext(ord(r.fin) .. "!", VY + VH // 2 - 30, 27, big and 3 or 2)
  end
end

function views()
  local v = {}
  if (ME or 0) > 0 then v[1] = { p = ME, x = 0, y = 0, w = 320, h = 240 } return v end
  local n = math.min(NP, 4)
  if n == 1 then v[1] = { p = 1, x = 0, y = 0, w = 320, h = 240 }
  elseif n == 2 then v[1] = { p = 1, x = 0, y = 0, w = 320, h = 119 } v[2] = { p = 2, x = 0, y = 121, w = 320, h = 119 }
  else
    for p = 1, n do v[p] = { p = p, x = ((p - 1) % 2) * 161, y = ((p - 1) // 2) * 121, w = 159, h = 119 } end
  end
  return v
end

function _draw()
  if state == "yard" then return draw_yard() end
  if state == "pick" then return draw_pick() end
  if state == "podium" then return draw_podium() end
  cls(1)
  for _, v in ipairs(views()) do
    set_view(v.x, v.y, v.w, v.h)
    local r, c = riders[v.p], cams[v.p]
    if r and c then
      draw_world(c, r)
      if state == "race" or state == "count" then draw_hud(r) end
      if state == "count" then
        local n = 3 - (state_t - 1) // 60
        sctext(n > 0 and tostring(n) or "GO!", VY + VH // 3, 27, VH >= 200 and 4 or 2)
      end
    end
    clip()
  end
  if NP > 4 and (ME or 0) == 0 then
    rectfill(0, 228, 320, 12, 1) set_view(0, 0, 320, 240) clip()
    ctext("5-8 riders: link more Bits to see everyone", 230, 29)
  end
  if state == "results" then draw_results() end
end

function draw_results()
  set_view(0, 0, 320, 240)
  clip()
  rectfill(30, 20, 260, 200, 19) rect(30, 20, 260, 200, 22)
  local title = cup and ("CUP RUN " .. cup.run .. " OF 3") or COURSES[course_n].name
  sctext(title, 30, 27, 2)
  text("RIDER", 42, 52, 22) text("RUN", 182, 52, 22) text(cup and "TOTAL" or "", 230, 52, 22)
  for i, b in ipairs(board) do
    local y = 64 + (i - 1) * 16
    local r = b.r
    local c = r.pn > 0 and 13 or 23
    if (ME or 0) > 0 and r.pn == ME then c = 27 end
    text(i .. ".", 42, y, 22)
    local sx = 70
    rider_pal(r.sp, r.co, r.sc)
    sspr(rider_sprite(r.sp, 0, 0), sx - 2, y - 6, 3, 3, 0.6)
    reset_pal()
    text(r.name, 88, y, c)
    text(tostring(b.run), 182, y, c)
    if cup then text(tostring(b.total), 230, y, 27) end
  end
  if state_t > 60 then
    ctext(cup and cup.run < 3 and "hold A: next slope" or "hold A: to the podium", 206, 29)
  end
end

-- ---------------------------------------------------------------- yard, picker, podium screens
function draw_snowfield(tt)
  cls(22)
  rectfill(0, 0, 320, 40, 21)
  rectfill(0, 40, 320, 40, 22)
  for i = 0, 7 do
    local x = i * 48 - 20
    local hh = 30 + (i * 37) % 30
    trifill(x, 120, x + 40, 120 - hh, x + 80, 120, 169)
    trifill(x + 28, 120 - hh * 0.7, x + 40, 120 - hh, x + 52, 120 - hh * 0.7, 13)
  end
  rectfill(0, 120, 320, 120, 13)
  rectfill(0, 120, 320, 3, 211)
  for i = 0, 40 do
    local x = (i * 71 + tt // 3 * ((i % 3) + 1)) % 330 - 5
    local y = (i * 53 + tt * ((i % 2) + 1) // 2) % 250 - 5
    pset(x, y, 13)
  end
end

function draw_yard()
  VCX = 160
  draw_snowfield(gt)
  sctext("PICK YOUR RIDER", 8, 27, 2)
  local n = NP
  local cols = n <= 2 and n or (n <= 4 and 2 or 4)
  local rows = (n + cols - 1) // cols
  local cw, ch = math.floor(300 / cols), math.floor(196 / rows)
  for p = 1, n do
    local cx = 10 + ((p - 1) % cols) * cw
    local cy = 30 + ((p - 1) // cols) * ch
    local mine = (ME or 0) == 0 or ME == p
    rectfill(cx + 2, cy + 2, cw - 4, ch - 4, ready[p] and 15 or 19)
    rect(cx + 2, cy + 2, cw - 4, ch - 4, mine and 13 or 20)
    local nm = player_name(p, 8):upper()
    text(nm, cx + cw // 2 - #nm * 4, cy + 6, 27)
    local L = looks[p]
    local sc = math.min(cw, ch - 40) / 34
    local r = { sp = L.sp, sc = L.sc }
    local yaw = ((gt // 10) + p) % 8
    rider_pal(L.sp, L.co, L.sc)
    sspr(rider_sprite(L.sp, 1, (yaw + 4) % 8), cx + cw // 2 - 12 * sc, cy + 16, 3, 3, sc)
    reset_pal()
    local ty = cy + ch - 40
    local function row(i, label)
      local on = yard_row[p] == i and not ready[p]
      local s = (on and "< " or "  ") .. label .. (on and " >" or "  ")
      text(s, cx + cw // 2 - #s * 4, ty + (i - 1) * 10, on and 27 or 23)
    end
    if ready[p] then
      text("READY!", cx + cw // 2 - 24, ty + 4, 17)
    else
      row(1, SPECIES[L.sp])
      row(2, (COATS[L.sp][L.co or 1] or COATS[L.sp][1])[1])
      row(3, SCARF_NAMES[L.sc] .. " SCARF")
      if ch >= 150 then
        local ab = STYLE[L.sp].about
        text(ab[1], cx + cw // 2 - #ab[1] * 4, cy + ch - 62, 17)
        text(ab[2], cx + cw // 2 - #ab[2] * 4, cy + ch - 52, 13)
      end
    end
  end
  ctext("<> change   up/down: row   A: ready", 230, 20)
end

function draw_pick()
  VCX = 160
  draw_snowfield(gt)
  sctext("WHERE TO?", 14, 27, 2)
  for i, nm in ipairs(PICKS) do
    local y = 50 + (i - 1) * 30
    local on = i == sel
    rectfill(50, y, 220, 24, on and 20 or 19)
    rect(50, y, 220, 24, on and 13 or 21)
    text(nm, 160 - #nm * 4, y + 4, on and 27 or 23)
    local sub = i == 1 and "All three slopes. Points add up." or COURSES[i - 1].about
    if on then text(sub, 160 - #sub * 2, y + 14, 13) end
  end
  ctext(#riders > 0 and "" or "", 170, 1)
  local who = NP == 1 and (((setting("rivals") or 2) == 2) and "You and 3 CPU riders" or "Just you") or (NP .. " riders")
  ctext(who, 176, 1)
  ctext("up/down: pick   A: go   B: back to riders", 212, 1)
  if (ME or 0) > 1 then ctext(player_name(1, 8) .. " is choosing...", 196, 25) end
end

function draw_podium()
  VCX = 160
  draw_snowfield(state_t)
  sctext(cup and "SNOWBELLY CUP" or COURSES[course_n].name, 8, 27, 2)
  local spots = { { 160, 150, 50 }, { 98, 168, 32 }, { 222, 180, 20 } }
  local cols = { 27, 29, 10 }
  for i = 3, 1, -1 do
    local b = board[i]
    local x, top, h = spots[i][1], spots[i][2], spots[i][3]
    rectfill(x - 30, top, 60, 230 - top, i == 1 and 20 or 21)
    rect(x - 30, top, 60, 230 - top, 19)
    stext(tostring(i), x - 6, top + 8, cols[i], 2)
    if b then
      local r = b.r
      local hop = (state_t > 30 and i == 1) and math.abs(math.sin(state_t / 10)) * 8 or 0
      rider_pal(r.sp, r.co, r.sc)
      sspr(rider_sprite(r.sp, 1, 4), x - 24, top - 46 - hop, 3, 3, 2)
      reset_pal()
      local nm = r.name
      stext(nm, x - #nm * 4, top - 64 - hop, 13)
      text(b.total .. "", x - #tostring(b.total) * 4, top + 26, 13)
    end
  end
  -- confetti
  for i = 0, 50 do
    local x = (i * 37 + state_t * (1 + i % 3)) % 320
    local y = (i * 91 + state_t * (2 + i % 2)) % 240
    if state_t > 20 then rectfill(x, y, 2, 2, ({ 27, 25, 20, 16, 10 })[i % 5 + 1]) end
  end
  for i = 4, #board do
    local b = board[i]
    local s = i .. "." .. b.r.name .. " " .. b.total
    stext(s, i <= 6 and 4 or 316 - #s * 8, 36 + ((i - 4) % 3) * 10, 13)
  end
end

-- ---------------------------------------------------------------- the title screen: a penguin rides the first slope
function draw_title(tt)
  if course_n ~= 1 or not N then build_course(1) end
  local saved_gt = gt
  gt = tt
  local len = (FIN - 30) * SL
  local z = 30 + (tt * 0.35) % len
  local cam = { z = z - CAMD, x = math.sin(tt / 90) * 1.5, hd = 0, pt = -0.2 }
  local s = seg_at(cam.z)
  local s2 = math.min(N, s + 6)
  cam.hd = (CX[s2] - CX[s]) / ((s2 - s) * SL)
  cam.pt = SLP[s]
  cam.y = base_y(z) + CAMH + 1
  set_view(0, 0, 320, 240)
  local saved_r = riders
  local hop_f = (tt % 150) / 60
  local hop = hop_f < 1 and math.sin(hop_f * 3.1416) * 3 or 0
  local px = math.sin(tt / 60) * 2.5
  local demo = { i = 1, pn = 0, sp = 1 + (tt // 600) % 2, sc = 1 + (tt // 300) % #SCARVES, z = z, x = px, h = ground(z, px) + hop, air = hop > 0,
                 tumble = 0, lean = 0, guard = false, got = {}, pops = {}, boost = 0, magnet = 0, tk = hop > 0 and { kind = 1, dir = 1, rot = hop_f * 2 } or nil, name = "", combo = {} }
  riders = { demo }
  local sb, sf = balls, fx
  balls, fx = {}, {}
  draw_world(cam, demo)
  riders, balls, fx = saved_r, sb, sf
  clip()
  gt = saved_gt
end
`;

  // ---------------------------------------------------------------- the riders: little 3D models of ellipsoids,
  // ray-cast into 24x24 sprites from behind and above, 8 turns x 3 pitches (lying, nose up, upside down) per species.
  // Body colours are 240-242 and scarf colours 24-26: the game swaps them with pal() for each rider's look.
  const RAMP = { B: [240, 241, 242], C: [240, 241, 242], L: [241, 242, 242], W: [29, 12, 13], O: [9, 10, 11], S: [24, 25, 26], E: [1, 1, 1], H: [13, 13, 13] };
  const E = (c, r, tag, rule) => ({ c, r, tag, rule });
  const PENGUIN = [
    E([0, 0.42, 0], [0.5, 0.38, 0.95], 'B', p => (p[1] < 0.24 ? 'W' : null)),
    E([0, 0.56, 0.95], [0.36, 0.34, 0.36], 'B', p => (p[2] > 1.12 && p[1] < 0.56 ? 'W' : null)),
    E([0.16, 0.66, 1.2], [0.09, 0.09, 0.09], 'H'), E([-0.16, 0.66, 1.2], [0.09, 0.09, 0.09], 'H'),
    E([0.17, 0.67, 1.27], [0.05, 0.05, 0.05], 'E'), E([-0.17, 0.67, 1.27], [0.05, 0.05, 0.05], 'E'),
    E([0, 0.52, 1.36], [0.1, 0.08, 0.2], 'O'),
    E([0.58, 0.33, 0.15], [0.3, 0.07, 0.32], 'B'), E([-0.58, 0.33, 0.15], [0.3, 0.07, 0.32], 'B'),
    E([0.2, 0.25, -1.0], [0.15, 0.06, 0.2], 'O'), E([-0.2, 0.25, -1.0], [0.15, 0.06, 0.2], 'O'),
    E([0, 0.52, 0.66], [0.5, 0.44, 0.14], 'S'), E([0.22, 0.8, 0.3], [0.12, 0.05, 0.38], 'S'),
  ];
  const SEAL = [
    E([0, 0.4, -0.05], [0.52, 0.38, 1.05], 'C', p => (p[1] < 0.2 ? 'L' : null)),
    E([0, 0.52, 1.0], [0.38, 0.34, 0.38], 'C'),
    E([0, 0.45, 1.32], [0.2, 0.15, 0.15], 'L'),
    E([0, 0.5, 1.46], [0.07, 0.06, 0.05], 'E'),
    E([0.17, 0.64, 1.24], [0.08, 0.08, 0.08], 'E'), E([-0.17, 0.64, 1.24], [0.08, 0.08, 0.08], 'E'),
    E([0.56, 0.25, 0.45], [0.28, 0.06, 0.18], 'C'), E([-0.56, 0.25, 0.45], [0.28, 0.06, 0.18], 'C'),
    E([0.22, 0.3, -1.15], [0.22, 0.06, 0.2], 'C'), E([-0.22, 0.3, -1.15], [0.22, 0.06, 0.2], 'C'),
    E([0, 0.5, 0.7], [0.52, 0.44, 0.13], 'S'), E([0.24, 0.78, 0.36], [0.12, 0.05, 0.38], 'S'),
  ];
  const PIVOT = [0, 0.45, 0.1];

  // rotate v by pitch a (about x) then yaw b (about y)
  function rot(v, a, b) {
    const y1 = v[1] * Math.cos(a) - v[2] * Math.sin(a), z1 = v[1] * Math.sin(a) + v[2] * Math.cos(a);
    return [v[0] * Math.cos(b) + z1 * Math.sin(b), y1, -v[0] * Math.sin(b) + z1 * Math.cos(b)];
  }
  function unrot(v, a, b) {
    const x1 = v[0] * Math.cos(b) - v[2] * Math.sin(b), z1 = v[0] * Math.sin(b) + v[2] * Math.cos(b);
    return [x1, v[1] * Math.cos(a) + z1 * Math.sin(a), -v[1] * Math.sin(a) + z1 * Math.cos(a)];
  }
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const LIGHT = norm([0.55, 0.8, -0.35]);

  // one view of a model into an n x n grid of colours (0 = empty)
  function render(model, pitch, yaw, n, ppu) {
    const el = 0.38, d = [0, -Math.sin(el), Math.cos(el)], up = [0, Math.cos(el), Math.sin(el)];
    const out = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const sx = (i + 0.5 - n / 2) / ppu, sy = (n * 0.55 - j - 0.5) / ppu;
      const o = [sx + up[0] * sy - d[0] * 8, up[1] * sy - d[1] * 8, up[2] * sy - d[2] * 8];
      const ro = unrot(o, pitch, yaw), rd = unrot(d, pitch, yaw);
      let best = 1e9, hit = null;
      for (const e of model) {
        const oc = [(ro[0] + PIVOT[0] - e.c[0]) / e.r[0], (ro[1] + PIVOT[1] - e.c[1]) / e.r[1], (ro[2] + PIVOT[2] - e.c[2]) / e.r[2]];
        const dd = [rd[0] / e.r[0], rd[1] / e.r[1], rd[2] / e.r[2]];
        const A = dd[0] * dd[0] + dd[1] * dd[1] + dd[2] * dd[2], B = 2 * (oc[0] * dd[0] + oc[1] * dd[1] + oc[2] * dd[2]);
        const C = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - 1, D = B * B - 4 * A * C;
        if (D < 0) continue;
        const t = (-B - Math.sqrt(D)) / (2 * A);
        if (t > 0 && t < best) { best = t; hit = e; }
      }
      if (!hit) continue;
      const p = [ro[0] + PIVOT[0] + rd[0] * best, ro[1] + PIVOT[1] + rd[1] * best, ro[2] + PIVOT[2] + rd[2] * best];
      const nm = rot(norm([(p[0] - hit.c[0]) / (hit.r[0] ** 2), (p[1] - hit.c[1]) / (hit.r[1] ** 2), (p[2] - hit.c[2]) / (hit.r[2] ** 2)]), pitch, yaw);
      const l = nm[0] * LIGHT[0] + nm[1] * LIGHT[1] + nm[2] * LIGHT[2];
      const tag = (hit.rule && hit.rule(p)) || hit.tag;
      out[j * n + i] = RAMP[tag][l > 0.5 ? 2 : l > 0.05 ? 1 : 0];
    }
    // a dark outline keeps the riders readable on white snow
    const res = out.slice();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (out[j * n + i]) continue;
      const nb = (x, y) => x >= 0 && y >= 0 && x < n && y < n && out[y * n + x];
      if (nb(i - 1, j) || nb(i + 1, j) || nb(i, j - 1) || nb(i, j + 1)) res[j * n + i] = 1;
    }
    return res;
  }

  function put(cart, tile, img, n) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = tile + (y >> 3) * 16 + (x >> 3);
      cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = img[y * n + x];
    }
  }

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    [PENGUIN, SEAL].forEach((model, sp) => {
      for (let pitch = 0; pitch < 3; pitch++) for (let yaw = 0; yaw < 8; yaw++) {
        const idx = sp * 24 + pitch * 8 + yaw;
        const tile = Math.floor(idx / 5) * 48 + (idx % 5) * 3;
        put(cart, tile, render(model, -pitch * Math.PI / 2, yaw * Math.PI / 4, 24, 8.2), 24);
      }
    });
    // the icon: a penguin standing up, facing you, in its red scarf (tile 480)
    const icon = render(PENGUIN, -Math.PI / 2, Math.PI, 16, 5.6).map(c => ({ 240: 1, 241: 31, 242: 30 }[c] ?? c));
    put(cart, 480, icon, 16);
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'penguin', anims: [{ name: 'idle', frames: [480], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Mountain', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Snowbelly', code, buildGfx,
    about: 'Belly-slide down a mountain as a penguin or a seal, 1-8 players: ramps, half pipes, rings, flags, tricks and a podium.' });
})();
