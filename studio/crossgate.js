/* Demo cart "Crossgate": a 1v1 crossbow duel across a little town. Original art and code. MIT License. */
(function () {
  const code = `-- Crossgate: a tug-of-war crossbow duel (1-2 players; with more, the winner stays on)
-- Wren (orange) fights east to the Sea Gate, Rook (blue) fights west to the Mill Gate.
-- Win a fight and you get the way: run for your gate. Your rival comes back ahead of you.
--   Left / right: walk. Hold down: crouch. A: jump. X: shoot.
--   Bolts drop as they fly and can't be blocked: jump over them or crouch under them.
--   Walk into your rival with a bolt loaded to stab.
--   You carry one bolt loaded and one spare in hand. Walk over bolts to pick them up.
-- One player fights the Rook (CPU). Linked Bits run in lockstep: game logic only uses
-- rnd() and the frame count, never clock(), and drawing never calls rnd().

GROUND, GRAV, JUMP = 200, tune("Gravity", 0.25, 0.1, 0.5, 0.01), -tune("Jump power", 4.3, 2, 7, 0.1)   -- tune(): sliders on the Game tab
SPEED, CROUCH_SPEED = tune("Run speed", 1.7, 0.8, 3, 0.1), 0.9
BOLT_V, BOLT_G, RELOAD = tune("Bolt speed", 6, 3, 10, 0.5), 0.03, tune("Reload time (frames)", 36, 10, 90)   -- bolt speed, how fast bolts drop, frames to crank the next bolt
STANCE_H = { 17, 17, 7 }          -- crossbow height above the feet: stance 2 standing, 3 crouched
BODY_H = { 24, 24, 14 }
SIDE = { "WREN", "ROOK" }
COL = { { 10, 9 }, { 21, 20 } }   -- cloak and shade colours of each side
LAST = 3                          -- rooms run from -3 (Mill Gate, Rook's goal) to 3 (Sea Gate, Wren's goal)

-- room shapes for rooms 0..3 (x, y, w, h); rooms -1..-3 are the same shapes mirrored, so the field is fair
GEOM = {
  [0] = { solids = { { 152, 192, 16, 8 } }, bolts = { 56, 264 } },
  [1] = { solids = { { 56, 192, 24, 8 }, { 80, 184, 160, 16 }, { 240, 192, 24, 8 } }, bolts = { 36, 160, 292 } },
  [2] = { solids = { { 120, 176, 16, 24 }, { 136, 192, 16, 8 } }, bolts = { 70, 210 } },
  [3] = { solids = { { 96, 192, 24, 8 }, { 216, 184, 16, 16 } }, bolts = { 150 } },
}
ROOMS = {
  [-3] = { name = "Mill Gate", deco = "millgate" }, [-2] = { name = "Windmill", deco = "mill" },
  [-1] = { name = "Orchard", deco = "orchard" },    [0] = { name = "Market", deco = "market" },
  [1] = { name = "Old Bridge", deco = "bridge" },   [2] = { name = "Rope Yard", deco = "ropes" },
  [3] = { name = "Sea Gate", deco = "seagate" },
}

function _init()
  game{
    title = "Crossgate",
    goal = "Fight your way through the town and out of your gate before your rival gets out of theirs.",
    help = {
      "Left / right: walk. Hold down: crouch. A: jump. X: shoot.",
      "Bolts drop as they fly and nothing stops them: jump over low ones, crouch under high ones.",
      "Walk into your rival with a bolt loaded to stab them.",
      "You hold one bolt loaded and one spare. Walk over bolts to pick them up.",
      "Win a fight to get the way, then run for your gate. Wren goes east, Rook goes west.",
    },
    continue = function(cp) start_match(cp) end,
    settings = { { key = "cpu", name = "Rook (CPU)", values = { "Easy", "Normal", "Hard" }, value = 2 } },
  }
  SOL, BOLTS0 = {}, {}
  for r = -LAST, LAST do
    local g = GEOM[math.abs(r)]
    SOL[r], BOLTS0[r] = {}, {}
    for _, s in ipairs(g.solids) do
      SOL[r][#SOL[r] + 1] = r >= 0 and { s[1], s[2], s[3], s[4] } or { 320 - s[1] - s[3], s[2], s[3], s[4] }
    end
    for _, x in ipairs(g.bolts) do BOLTS0[r][#BOLTS0[r] + 1] = r >= 0 and x or 320 - x end
  end
  NP = math.max(1, PLAYERS or 1)
  side_pl = { 1, NP >= 2 and 2 or 0 }      -- which player fights on each side (0 = the CPU)
  queue = {}
  for p = 3, NP do queue[#queue + 1] = p end
  wins = {}
  gt, shown_win = 0, false
  start_match(nil)
end

-- ---------------------------------------------------------------- helpers
function sgn(v) return v > 0 and 1 or (v < 0 and -1 or 0) end
function mid(a, v, b) return math.max(a, math.min(v, b)) end
function label(n)
  if NP == 1 then return n == 1 and "YOU" or "ROOK" end
  return "P" .. side_pl[n]
end
function banner(s, c, sub) msg, msg_c, msg_sub, msg_t = s, c or 13, sub, 100 end
function pan(x) return mid(-1, (x - 160) / 160, 1) end

function solid_at(x, y)
  if y >= GROUND then return true end
  for _, s in ipairs(SOL[room]) do
    if x >= s[1] and x < s[1] + s[3] and y >= s[2] and y < s[2] + s[4] then return true end
  end
  return false
end
-- the solid a body (8 wide, h tall, feet at y) would overlap at x
function box_hit(x, y, h)
  for _, s in ipairs(SOL[room]) do
    if x + 4 > s[1] and x - 4 < s[1] + s[3] and y > s[2] and y - h < s[2] + s[4] then return s end
  end
end
function floor_y(r, x)
  local top = GROUND
  for _, s in ipairs(SOL[r]) do if x >= s[1] and x < s[1] + s[3] and s[2] < top then top = s[2] end end
  return top
end

function burst(x, y, c, n, sp)
  for i = 1, n do
    fx[#fx + 1] = { x = x, y = y, vx = (rnd() * 2 - 1) * (sp or 1.5), vy = -rnd() * 2.2, t = 20 + rnd(25), c = c[rnd(#c)] }
  end
end

-- a bolt falls loose in this room (from a corpse, a wall or the ground)
function drop(x, y)
  x = mid(6, x, 314)
  for i = 1, 40 do if solid_at(x, y) then y = y - 1 end end
  loose[room][#loose[room] + 1] = { x = x, y = y, vy = -1.2, rest = false }
end

-- ---------------------------------------------------------------- a match
function new_fighter(n)
  local d = n == 1 and 1 or -1
  return { n = n, dir = d, x = n == 1 and 96 or 224, y = GROUND, vx = 0, vy = 0, face = d, stance = 2,
           loaded = true, hand = true, rl = 0, cd = 0, stun = 0, alive = true, ghost = false, dead_t = 0,
           onground = true, anim = 0, push = 0, blocked = false, cpu = side_pl[n] == 0, aim = nil, atk_t = 60 }
end

function start_match(cp)
  room = cp and mid(-LAST, cp.room or 0, LAST) or 0
  runner = cp and cp.run or 0
  if runner ~= 1 and runner ~= 2 then runner = 0 end
  loose, flying, fx = {}, {}, {}
  for r = -LAST, LAST do
    loose[r] = {}
    for _, x in ipairs(BOLTS0[r]) do loose[r][#loose[r] + 1] = { x = x, y = floor_y(r, x), vy = 0, rest = true } end
  end
  F = { new_fighter(1), new_fighter(2) }
  if runner ~= 0 then
    local r, o = F[runner], F[3 - runner]
    r.x = r.dir > 0 and 12 or 308
    o.alive, o.ghost, o.dead_t = false, true, 40
  end
  for _, f in ipairs(F) do f.y = floor_y(room, f.x) end
  mode, mode_t, over_t, wipe = "ready", 80, 0, 0
  banner(ROOMS[room].name, 13)
  tune = {}
end

function next_match()
  if #queue > 0 then
    local lose = 3 - winner
    queue[#queue + 1] = side_pl[lose]
    side_pl[lose] = table.remove(queue, 1)
  end
  checkpoint(nil)
  start_match(nil)
end

function play_tune(notes) tune = {} for i, n in ipairs(notes) do tune[#tune + 1] = { n[1], gt + n[2], n[3] or 10 } end end

-- ---------------------------------------------------------------- input
-- I.shoot / I.jump are presses, I.crouch is held
NOIN = { l = false, r = false, crouch = false, shoot = false, jump = false }
function human(p)
  return { l = btn("left", p), r = btn("right", p), crouch = btn("down", p), shoot = btnp("x", p), jump = btnp("a", p) }
end

-- the Rook, when you play alone
-- where a flying bolt will be (its height) when it reaches x
function bolt_y_at(b, x)
  local n = math.abs(x - b.x) / BOLT_V
  return b.y + b.vy * n + BOLT_G * n * (n + 1) / 2, n
end
function cpu(f, o)
  local I = { l = false, r = false, crouch = false, shoot = false, jump = false }
  local sk = setting("cpu") or 2
  local want = 0
  local dx = o.x - f.x
  local dist = math.abs(dx)
  f.atk_t = math.max(0, f.atk_t - 1)

  -- a bolt coming at me? jump over it or crouch under it
  local threat, ty, tn
  for _, b in ipairs(flying) do
    if b.owner ~= f and sgn(b.vx) == sgn(f.x - b.x) and math.abs(f.x - b.x) < 40 + sk * 25 then
      local y, n = bolt_y_at(b, f.x)
      if y <= f.y and y >= f.y - BODY_H[2] and (not tn or n < tn) then threat, ty, tn = b, y, n end
    end
  end
  if threat and threat ~= f.seen then f.seen, f.dodge = threat, rnd(100) <= ({ 30, 60, 85 })[sk] end
  local armed = f.loaded or f.rl > 0 or f.hand
  if threat and f.dodge then
    if ty < f.y - BODY_H[3] - 1 then I.crouch = true              -- high: duck under it
    elseif tn <= 9 and f.onground then I.jump = true end          -- low: jump it at the last moment
    if f.loaded and f.rl == 0 and o.alive and ty < f.y - BODY_H[3] - 1 and rnd(100) <= 10 * sk then I.shoot = true end
  elseif not armed then
    -- no bolts: fetch the nearest one, keeping away from a loaded rival
    local best, bd = nil, 9999
    for _, l in ipairs(loose[room]) do
      local d = math.abs(l.x - f.x)
      if d < bd then best, bd = l, d end
    end
    if best then want = sgn(best.x - f.x) elseif runner == f.n then want = f.dir
    elseif o.alive then want = -sgn(dx) end
  elseif o.alive then
    local ahead = sgn(dx) == f.dir
    if runner == f.n and (not ahead or (not o.loaded and o.rl == 0 and dist > 30)) then
      want = f.dir                                    -- the way is clear: run for the gate
    elseif f.loaded and f.rl == 0 then
      if not o.loaded and o.rl == 0 then
        want = sgn(dx)                                -- rival unarmed: walk in and stab
      else
        if dist > 150 then want = sgn(dx) elseif dist < 60 then want = -sgn(dx) end
        if f.atk_t == 0 and dist < 190 then
          -- crouched shots fly low (jump them), standing shots fly high (duck them)
          f.low = rnd(100) <= 35
          f.aim, f.atk_t = true, 0
        end
        if f.aim then
          I.crouch = f.low
          if f.stance == (f.low and 3 or 2) and f.cd == 0 then
            I.shoot = true
            f.aim, f.atk_t = false, ({ 100, 60, 34 })[sk] + rnd(40)
          end
        end
      end
    else
      want = -sgn(dx)                                 -- reloading: step back
    end
  elseif runner == f.n then
    want = f.dir
  end
  if want < 0 then I.l = true elseif want > 0 then I.r = true end
  if f.blocked and f.onground and want ~= 0 and not I.crouch then I.jump = true end
  return I
end

-- ---------------------------------------------------------------- update
function _update()
  gt = gt + 1
  for i = #tune, 1, -1 do
    local n = tune[i]
    if gt >= n[2] then mus(n[1], 1, 0.35, n[3]); table.remove(tune, i) end
  end
  for i = #fx, 1, -1 do
    local p = fx[i]
    p.x, p.y, p.vy, p.t = p.x + p.vx, p.y + p.vy, p.vy + 0.12, p.t - 1
    p.vx = p.vx * 0.96
    if p.t <= 0 or p.y > GROUND + 2 then table.remove(fx, i) end
  end
  if msg_t > 0 then msg_t = msg_t - 1 end
  if wipe > 0 then wipe = wipe - 1 end

  if mode == "over" then
    over_t = over_t + 1
    for _, f in ipairs(F) do if not f.ghost then physics(f) end end
    if over_t > 60 then
      for p = 1, NP do if btnp("a", p) then next_match() return end end
      if over_t > 900 then next_match() end
    end
    return
  end
  if mode == "ready" then
    mode_t = mode_t - 1
    if mode_t <= 0 then mode = "fight"; sfx("C5", 1, 0.4, 8) sfx("G5", 1, 0.4, 12) end
  end

  local ins = {}
  for i = 1, 2 do
    local f = F[i]
    if mode ~= "fight" or not f.alive then ins[i] = NOIN
    elseif f.cpu then ins[i] = cpu(f, F[3 - i])
    else ins[i] = human(side_pl[i]) end
  end
  for i = 1, 2 do fighter(F[i], ins[i], F[3 - i]) end
  stabs()
  bolts()
  for _, l in ipairs(loose[room]) do
    if not l.rest then
      l.vy = l.vy + GRAV
      local ny = l.y + l.vy
      local top = GROUND
      for _, s in ipairs(SOL[room]) do
        if l.x >= s[1] and l.x < s[1] + s[3] and s[2] >= l.y - 1 and s[2] < top then top = s[2] end
      end
      if ny >= top then l.y, l.vy, l.rest = top, 0, true else l.y = ny end
    end
  end
  respawns()
  exits()
end

function fighter(f, I, o)
  if f.alive then
    if f.stun > 0 then f.stun = f.stun - 1; I = NOIN end
    local st = I.crouch and f.onground and 3 or 2
    if st == 2 and f.stance == 3 and box_hit(f.x, f.y, BODY_H[2]) then st = 3 end   -- no room to stand up
    f.stance = st
    local mv = (I.r and 1 or 0) - (I.l and 1 or 0)
    f.push = mv
    local sp = f.stance == 3 and CROUCH_SPEED or SPEED
    if f.rl > 0 then sp = sp * 0.7 end
    if f.stun > 0 then f.vx = f.vx * 0.85 else f.vx = mv * sp end
    -- face the rival while they are close, otherwise the way you walk
    if o.alive and math.abs(o.x - f.x) < 170 then
      if o.x ~= f.x then f.face = sgn(o.x - f.x) end
    elseif mv ~= 0 then f.face = mv end
    if I.jump and f.onground then f.vy = JUMP; sfx("C4", 1, 0.2, 5, nil, pan(f.x), 400) end
    if I.shoot and f.loaded and f.rl == 0 and f.cd == 0 then shoot(f) end
    if not f.loaded and f.rl == 0 and f.hand then f.hand, f.rl = false, RELOAD end
    if f.rl > 0 then
      f.rl = f.rl - 1
      if f.rl % 12 == 6 then sfx("A5", 5, 0.12, 2) end
      if f.rl == 0 then f.loaded = true; sfx("D6", 5, 0.25, 3, nil, pan(f.x)) end
    end
    if f.cd > 0 then f.cd = f.cd - 1 end
    if not f.hand then
      local L = loose[room]
      for i = #L, 1, -1 do
        local l = L[i]
        if math.abs(l.x - f.x) < 10 and l.y <= f.y + 2 and l.y >= f.y - 22 then
          table.remove(L, i)
          f.hand = true
          sfx("A5", 1, 0.3, 4) sfx("E6", 1, 0.25, 4)
          break
        end
      end
    end
    f.anim = mv ~= 0 and f.anim + 1 or 0
  elseif not f.ghost then
    f.vx = f.vx * 0.92
  end
  if f.ghost then return end
  physics(f)
  local lo, hi = 4, 316
  if f.alive and runner == f.n then if f.dir > 0 then hi = 330 else lo = -10 end end
  f.x = mid(lo, f.x, hi)
end

function physics(f)
  local h = f.alive and BODY_H[f.stance] or 8
  f.blocked = false
  if f.vx ~= 0 then
    local nx = f.x + f.vx
    local s = box_hit(nx, f.y, h)
    if s then
      if f.onground and f.y - s[2] <= 8 and not box_hit(nx, s[2], h) then f.x, f.y = nx, s[2]
      else f.blocked = true; if not f.alive then f.vx = 0 end end
    else f.x = nx end
  end
  f.vy = math.min(f.vy + GRAV, 6)
  local ny = f.y + f.vy
  f.onground = false
  if f.vy >= 0 then
    local top = GROUND
    for _, s in ipairs(SOL[room]) do
      if f.x + 4 > s[1] and f.x - 4 < s[1] + s[3] and f.y <= s[2] and s[2] < top then top = s[2] end
    end
    if ny >= top then ny, f.vy, f.onground = top, 0, true end
  elseif box_hit(f.x, ny, h) then ny, f.vy = f.y, 0 end
  f.y = ny
end

function shoot(f)
  f.loaded, f.cd = false, 14
  flying[#flying + 1] = { x = f.x + f.face * 4, y = f.y - STANCE_H[f.stance], vx = f.face * BOLT_V, vy = -0.2, owner = f }
  f.vx = -f.face
  sfx("A3", 2, 0.45, 6, nil, pan(f.x), -500)
  sfx("E6", 3, 0.15, 2, nil, pan(f.x))
end

function kill(t, by, dir)
  t.alive, t.ghost, t.dead_t = false, false, 100
  t.vx, t.vy = dir * 2.2, -2.2
  if t.loaded then drop(t.x, t.y - 12) end
  if t.hand then drop(t.x - dir * 6, t.y - 16) end
  t.loaded, t.hand, t.rl, t.stun = false, false, 0, 0
  burst(t.x, t.y - 14, { COL[t.n][1], COL[t.n][2], 13 }, 18, 2)
  sfx("C3", 3, 0.6, 16, nil, pan(t.x), -200)
  sfx("G2", 2, 0.4, 12, nil, pan(t.x), -150)
  if by and by.alive then
    if runner ~= by.n then banner(SIDE[by.n] .. " HAS THE WAY", COL[by.n][1]) end
    runner = by.n
  end
end

function clash(a, b)
  local d = sgn(b.x - a.x)
  if d == 0 then d = a.face end
  a.vx, b.vx, a.stun, b.stun = -d * 3, d * 3, 12, 12
  local cx, cy = (a.x + b.x) / 2, a.y - STANCE_H[a.stance]
  burst(cx, cy, { 27, 13, 12 }, 10, 2.5)
  sfx("E6", 5, 0.4, 5, nil, pan(cx)) sfx("B6", 5, 0.3, 4, nil, pan(cx))
end

-- walking into your rival with a bolt loaded stabs them
function can_stab(a, o)
  if not (a.alive and o.alive and a.loaded and a.rl == 0 and a.stun == 0) then return false end
  local dx = o.x - a.x
  return math.abs(dx) < 16 and math.abs(o.y - a.y) < 18 and sgn(dx) == a.face and a.push == a.face
end
function stabs()
  local a, b = F[1], F[2]
  local sa, sb = can_stab(a, b), can_stab(b, a)
  if sa and sb then
    -- both walk in with a bolt loaded: at the same height the bolts clash, otherwise both are hit
    if a.stance == b.stance then clash(a, b)
    else
      kill(a, nil, sgn(a.x - b.x)) kill(b, nil, sgn(b.x - a.x))
      banner("DOUBLE HIT!", 27)
    end
  elseif sa or sb then
    local k, v = sa and a or b, sa and b or a
    kill(v, k, k.face); sfx("G2", 3, 0.5, 10)
  end
end

function bolts()
  for i = #flying, 1, -1 do
    local b = flying[i]
    local px, py = b.x, b.y
    b.vy = b.vy + BOLT_G
    b.x, b.y = b.x + b.vx, b.y + b.vy
    local gone = false
    for _, t in ipairs(F) do
      if not gone and t.alive and t ~= b.owner then
        local lo, hi = math.min(px, b.x) - 5, math.max(px, b.x) + 5
        if t.x >= lo and t.x <= hi then
          -- the bolt's height as it passes the rival's middle
          local y = py + (b.y - py) * mid(0, (t.x - px) / b.vx, 1)
          if y <= t.y and y >= t.y - BODY_H[t.stance] then kill(t, b.owner, sgn(b.vx)); gone = true end
        end
      end
    end
    if not gone then
      if b.x < -12 or b.x > 332 then gone = true
      elseif solid_at(b.x, b.y) then
        drop(b.x - sgn(b.vx) * 6, b.y - 1)
        sfx("C4", 3, 0.25, 3, nil, pan(b.x))
        gone = true
      end
    end
    if gone then table.remove(flying, i) end
  end
end

function spawn(f, x, keep)
  -- come back on the ground at the edge of the screen, walking in (never dropped from the sky)
  f.alive, f.ghost, f.x, f.y, f.vx, f.vy = true, false, x, floor_y(room, x), 0, 0
  f.stance, f.loaded, f.hand, f.rl, f.cd, f.stun = 2, true, keep and keep.hand or false, 0, 0, 0
  f.face, f.aim, f.atk_t, f.keep = f.dir, nil, 50, nil
  burst(x, f.y - 2, { 29, 28 }, 8, 1)
  sfx("G4", 1, 0.25, 8, nil, pan(x), -300)
end

function respawns()
  for _, f in ipairs(F) do
    if not f.alive then
      if f.dead_t > 0 then f.dead_t = f.dead_t - 1 end
      if f.dead_t == 0 then
        local r = runner ~= 0 and runner ~= f.n and F[runner] or nil
        if r and r.alive then
          local x = r.dir > 0 and 312 or 8           -- the far side of the screen, in the runner's way
          if math.abs(r.x - x) >= 90 then spawn(f, x, f.keep) end
        else
          spawn(f, f.dir > 0 and 8 or 312, f.keep)
        end
      end
    end
  end
end

function exits()
  if runner == 0 then return end
  local r = F[runner]
  if not r.alive or (r.dir > 0 and r.x < 318) or (r.dir < 0 and r.x > 2) then return end
  if room == LAST * r.dir then win(r) return end
  room = room + r.dir
  r.x = r.dir > 0 and 10 or 310
  r.y, r.vy = floor_y(room, r.x), 0
  local o = F[3 - runner]
  o.keep = o.alive and { hand = o.hand } or nil
  o.alive, o.ghost, o.dead_t = false, true, 20
  flying, fx = {}, {}
  wipe = 14
  banner(ROOMS[room].name, 13)
  sfx("C5", 1, 0.3, 6) sfx("E5", 1, 0.3, 6)
  checkpoint({ room = room, run = runner })
end

function win(r)
  mode, over_t, winner = "over", 0, r.n
  r.x = mid(4, r.x, 316)
  for _, f in ipairs(F) do f.vx = 0 end
  local pl = side_pl[r.n]
  wins[pl] = (wins[pl] or 0) + 1
  play_tune({ { "C5", 0 }, { "E5", 8 }, { "G5", 16 }, { "C6", 24, 30 } })
  local gate = r.dir > 0 and "the Sea Gate" or "the Mill Gate"
  checkpoint(nil)
  if NP == 1 then
    if r.n == 1 then game_win("You fought your way out of " .. gate .. " before the Rook got home.") end
  elseif not shown_win then
    shown_win = true
    game_win(label(r.n) .. " (" .. SIDE[r.n] .. ") fought out through " .. gate .. "!")
  end
end

-- ---------------------------------------------------------------- drawing
function _draw()
  local d = ROOMS[room].deco
  sky(d)
  if d == "market" then market() elseif d == "bridge" then bridge() elseif d == "ropes" then ropes()
  elseif d == "orchard" then orchard() elseif d == "mill" then mill() else gate(d == "seagate") end
  ground(d)
  for _, s in ipairs(SOL[room]) do
    if d == "bridge" then
      rectfill(s[1], s[2], s[3], s[4], 28)
      line(s[1], s[2], s[1] + s[3] - 1, s[2], 29)
      for y = s[2] + 4, s[2] + s[4] - 1, 6 do line(s[1], y, s[1] + s[3] - 1, y, 30) end
      for x = s[1] + 6, s[1] + s[3] - 2, 12 do line(x, s[2] + 1, x, s[2] + 3, 30) end
    else
      local tile = (d == "ropes" or d == "mill") and 50 or 49
      for y = s[2], s[2] + s[4] - 1, 8 do for x = s[1], s[1] + s[3] - 1, 8 do spr(tile, x, y) end end
    end
  end
  for _, l in ipairs(loose[room]) do
    local x, y = math.floor(l.x), math.floor(l.y)
    line(x - 4, y - 1, x + 3, y - 1, 28)
    pset(x + 4, y - 1, 13)
    pset(x - 4, y - 2, 25) pset(x - 5, y - 2, 25)
    if (gt // 6 + x) % 40 == 0 then pset(x, y - 2, 13) end
  end
  for _, f in ipairs(F) do if not f.alive then draw_fighter(f) end end
  for _, f in ipairs(F) do if f.alive then draw_fighter(f) end end
  for _, b in ipairs(flying) do
    local s, x, y = sgn(b.vx), math.floor(b.x), math.floor(b.y)
    local ty = math.floor(b.y - b.vy * 1.5 + 0.5)
    line(x - s * 9, ty, x, y, 29)
    pset(x, y, 13)
    pset(x - s * 9, ty - 1, COL[b.owner.n][1]) pset(x - s * 8, ty + 1, COL[b.owner.n][1])
  end
  for _, p in ipairs(fx) do pset(p.x, p.y, p.c) end
  hud()
  if wipe > 0 then
    local w = wipe * 24
    if F[runner] and F[runner].dir < 0 then rectfill(0, 14, w, 226, 1) else rectfill(320 - w, 14, w, 226, 1) end
  end
end

function draw_fighter(f)
  if f.ghost then return end
  local x, y = math.floor(f.x), math.floor(f.y)
  pal(10, COL[f.n][1]) pal(9, COL[f.n][2])
  local flip = f.face < 0
  if not f.alive then
    spr(13, x - 12, y - 16, 3, 2, flip)
    pal()
    return
  end
  local n = 1
  if not f.onground then n = 7 elseif f.stance == 3 then n = 9 elseif f.anim > 0 and (f.anim // 7) % 2 == 0 then n = 3 end
  if f.stun > 0 and f.stun % 4 < 2 then pal(13) end
  spr(n, x - 8, y - 24, 2, 3, flip)
  pal()
  local s = f.face
  local top = y - BODY_H[f.stance]
  if f.hand then                                   -- the spare bolt, over the shoulder
    local qx = x - s * 4
    line(qx, top + 2, qx - s * 3, top - 5, 28)
    pset(qx - s * 3, top - 6, 25) pset(qx - s * 4, top - 5, 25)
  end
  -- the crossbow
  local cy = y - STANCE_H[f.stance]
  if f.rl > 0 then                                 -- cranking the next bolt in
    line(x + s * 1, cy + 1, x + s * 9, cy + 6, 7)
    pset(x + s * 4, cy - 1 - (f.rl // 6) % 2, 29)
    pset(x + s * 2, cy + 1, 11)
    return
  end
  local x0 = x + s
  line(x0, cy + 1, x0 + s * 10, cy + 1, 7)
  pset(x0, cy + 2, 6)
  local px = x0 + s * 9
  line(px, cy - 3, px, cy + 4, 8)
  pset(px - s, cy - 4, 8) pset(px - s, cy + 5, 8)
  if f.loaded then
    line(px - s, cy - 3, x0 + s * 3, cy, 29) line(px - s, cy + 4, x0 + s * 3, cy + 1, 29)
    line(x0 + s * 2, cy, x0 + s * 12, cy, 29)
    pset(x0 + s * 13, cy, 13)
    pset(x0 + s * 2, cy - 1, COL[f.n][1])
  else
    line(px - s, cy - 3, px - s, cy + 4, 29)
  end
  pset(x + s * 2, cy + 1, 11)
end

function sky(d)
  rectfill(0, 14, 320, 50, 21)
  rectfill(0, 64, 320, 50, 22)
  rectfill(0, 114, 320, 90, 23)
  for i = 0, 3 do
    local cx = (i * 97 + gt // 8) % 380 - 30
    circfill(cx, 40 + (i * 23) % 40, 9, 13) circfill(cx + 10, 36 + (i * 23) % 40, 11, 13) circfill(cx + 22, 41 + (i * 23) % 40, 8, 13)
  end
  circfill(40, 230, 90, 22) circfill(170, 240, 110, 22) circfill(300, 230, 80, 22)
end

function ground(d)
  if d == "market" or d == "seagate" or d == "millgate" then
    rectfill(0, 200, 320, 40, 30)
    for y = 202, 238, 6 do
      local o = (y // 6) % 2 * 6
      for x = -o, 320, 12 do rect(x, y, 12, 6, 31) end
    end
    line(0, 200, 319, 200, 29)
  else
    rectfill(0, 200, 320, 40, 7)
    rectfill(0, 200, 320, 3, 16)
    for x = 0, 316, 7 do pset(x + (x * 7) % 5, 206 + (x * 13) % 30, 6) end
    for x = 2, 316, 11 do pset(x, 199, 17) pset(x + 1, 198, 16) end
  end
  if d == "bridge" then
    rectfill(80, 201, 160, 39, 20)
    for i = 0, 9 do
      local wx = 84 + (i * 37 + gt // 4) % 150
      line(wx, 206 + (i * 7) % 30, wx + 6, 206 + (i * 7) % 30, 22)
    end
    rectfill(72, 200, 8, 40, 7) rectfill(240, 200, 8, 40, 7)
  end
end

function house(x, w, h, c, roof)
  rectfill(x, 200 - h, w, h, c)
  for k = 0, 7 do rectfill(x - 4 + k * 2, 200 - h - 2 - k * 2, w + 8 - k * 4, 2, roof) end
  for wx = x + 6, x + w - 12, 16 do
    rectfill(wx, 200 - h + 10, 8, 10, 1) rectfill(wx + 1, 200 - h + 11, 6, 8, 27)
    line(wx + 4, 200 - h + 11, wx + 4, 200 - h + 18, 7)
  end
end

function market()
  house(8, 60, 64, 11, 25) house(84, 52, 80, 12, 8) house(184, 56, 70, 11, 24) house(256, 60, 60, 12, 25)
  for _, sx in ipairs({ 30, 250 }) do
    rectfill(sx, 168, 2, 32, 7) rectfill(sx + 38, 168, 2, 32, 7)
    for k = 0, 4 do rectfill(sx - 2 + k * 9, 162, 9, 8, k % 2 == 0 and 25 or 13) end
    rectfill(sx, 186, 40, 4, 7)
    for k = 0, 4 do circfill(sx + 6 + k * 7, 183, 2, ({ 25, 17, 27, 10, 16 })[k + 1]) end
  end
  -- a well in the middle of the square
  rectfill(144, 150, 2, 42, 7) rectfill(174, 150, 2, 42, 7) rectfill(140, 146, 40, 5, 8)
end

function bridge()
  rectfill(0, 170, 320, 30, 20)
  for i = 0, 11 do pset((i * 53 + gt // 6) % 320, 176 + (i * 5) % 20, 22) end
  rectfill(0, 160, 70, 40, 16) rectfill(250, 160, 70, 40, 16)
  for _, tx in ipairs({ 20, 290 }) do rectfill(tx - 2, 120, 5, 42, 6) circfill(tx, 116, 16, 15) circfill(tx - 7, 112, 10, 16) end
end

function ropes()
  for _, px in ipairs({ 40, 160, 280 }) do rectfill(px - 2, 96, 4, 104, 7) rectfill(px - 4, 94, 8, 3, 6) end
  for _, a in ipairs({ { 40, 160 }, { 160, 280 } }) do
    local x0, x1 = a[1], a[2]
    local last_x, last_y = x0, 98
    for k = 1, 12 do
      local tx = x0 + (x1 - x0) * k / 12
      local ty = 98 + math.sin(k / 12 * math.pi) * 18
      line(last_x, last_y, tx, ty, 29)
      last_x, last_y = tx, ty
    end
    for k = 2, 10, 3 do
      local cx = x0 + (x1 - x0) * k / 12
      local cy = 98 + math.sin(k / 12 * math.pi) * 18
      rectfill(cx - 5, cy, 10, 16, ({ 25, 21, 27, 17 })[k % 4 + 1])
    end
  end
  for k = 0, 2 do circfill(100 + k * 9, 194, 6, 8) circfill(100 + k * 9, 194, 3, 7) end
end

function orchard()
  for i, tx in ipairs({ 30, 110, 200, 285 }) do
    rectfill(tx - 3, 140, 6, 60, 6)
    circfill(tx, 132, 24, 15) circfill(tx - 10, 124, 15, 16) circfill(tx + 9, 128, 13, 16)
    for k = 0, 4 do pset(tx - 14 + (k * 11 + i * 3) % 28, 118 + (k * 7) % 26, 25) end
  end
  rectfill(0, 186, 320, 2, 7)
  for x = 4, 316, 16 do rectfill(x, 180, 2, 20, 7) end
end

function mill()
  for y = 150, 196, 6 do line(0, y, 320, y, (y // 6) % 2 == 0 and 18 or 17) end
  local mx = 92
  for k = 0, 9 do rectfill(mx - 8 - k, 100 + k * 10, 20 + k * 2, 10, 12) end
  rectfill(mx - 18, 92, 40, 10, 8)
  rectfill(mx, 170, 10, 30, 7)
  local a = gt / 90
  for k = 0, 3 do
    local ang = a + k * math.pi / 2
    local ex, ey = mx + 2 + math.cos(ang) * 48, 98 + math.sin(ang) * 48
    line(mx + 2, 98, ex, ey, 7)
    local sx, sy = mx + 2 + math.cos(ang) * 30, 98 + math.sin(ang) * 30
    circfill(sx, sy, 5, 13)
  end
  circfill(mx + 2, 98, 3, 6)
end

-- the end of the field: a town gate. The Sea Gate (east) is Wren's way out, the Mill Gate (west) Rook's.
function gate(east)
  local wx = east and 250 or 0
  local side = east and 1 or 2
  if east then rectfill(0, 150, 250, 50, 20) for i = 0, 8 do pset((i * 41 + gt // 5) % 250, 156 + (i * 9) % 40, 22) end end
  rectfill(wx, 50, 70, 150, 28)
  for y = 54, 196, 8 do
    local o = (y // 8) % 2 * 8
    for x = wx - o, wx + 70, 16 do rect(x, y, 16, 8, 30) end
  end
  for x = wx, wx + 66, 10 do rectfill(x, 42, 6, 8, 28) end
  local ax = east and 268 or 16
  rectfill(ax, 120, 36, 80, 1)
  circfill(ax + 17, 120, 18, 1)
  for x = ax + 4, ax + 32, 7 do line(x, 110, x, 199, 30) end
  for y = 130, 196, 12 do line(ax, y, ax + 35, y, 30) end
  local fx_ = east and 270 or 46
  line(fx_, 20, fx_, 50, 7)
  local wave = (gt // 10) % 2
  rectfill(fx_ + 1, 20, 14, 9, COL[side][1]) pset(fx_ + 15, 21 + wave, COL[side][1])
  rectfill(fx_ + 1, 25, 14, 2, COL[side][2])
end

function hud()
  rectfill(0, 0, 320, 14, 31)
  for n = 1, 2 do
    local f = F[n]
    local name = (NP == 1 and n == 2) and "ROOK" or SIDE[n]
    local w = wins[side_pl[n]] or 0
    local s = NP > 1 and (label(n) .. " " .. name) or name
    local x = n == 1 and 4 or 316 - #s * 8
    text(s, x, 3, COL[n][1])
    -- bolts: the loaded one and the spare
    local bx = n == 1 and x + #s * 8 + 6 or x - 30
    rectfill(bx, 5, 9, 3, (f.loaded and f.alive) and 13 or 30)
    pset(bx + (n == 1 and 9 or -1), 6, (f.loaded and f.alive) and 13 or 30)
    rectfill(bx + 14, 5, 7, 3, (f.hand and f.alive) and 28 or 30)
    if w > 0 then text(w, n == 1 and bx + 26 or bx - 12, 3, 27) end
  end
  -- the field, room by room, with each side's gate at the end
  for r = -LAST, LAST do
    local x = 160 + r * 11 - 4
    if r == room then rectfill(x, 4, 8, 6, 13) else rect(x, 4, 8, 6, 30) end
  end
  rectfill(160 - (LAST + 1) * 11 - 3, 3, 5, 8, COL[2][1])
  rectfill(160 + (LAST + 1) * 11 - 2, 3, 5, 8, COL[1][1])
  if runner ~= 0 and gt // 8 % 2 == 0 then
    local d = F[runner].dir
    text(d > 0 and ">" or "<", 160 + d * ((LAST + 2) * 11 + 2) - 4, 3, COL[runner][1])
  end
  if NP > 2 and #queue > 0 then
    local s = "NEXT P" .. queue[1]
    text(s, 160 - #s * 4, 228, 29)
  end
  -- GO arrow for the runner
  if mode == "fight" and runner ~= 0 and F[runner].alive and gt // 12 % 2 == 0 then
    local d, c = F[runner].dir, COL[runner][1]
    if d > 0 then text("GO >", 252, 26, c, 2) else text("< GO", 4, 26, c, 2) end
  end
  -- which one is you
  local me = ME or 0
  for _, f in ipairs(F) do
    local you = (me > 0 and side_pl[f.n] == me) or (NP == 1 and f.n == 1 and mode == "ready")
    if you and f.alive then
      local x, y = math.floor(f.x), math.floor(f.y - BODY_H[f.stance] - 8)
      for k = 0, 2 do line(x - k, y - k, x + k, y - k, 13) end
    end
  end
  if msg_t > 0 then
    local s = string.upper(msg)
    if #s * 16 < 300 then text(s, 160 - #s * 8 + 1, 47, 1, 2) text(s, 160 - #s * 8, 46, msg_c, 2)
    else text(s, 160 - #s * 4, 46, msg_c) end
  end
  if mode == "ready" then
    local a, b = SIDE[1] .. " >", "< " .. ((NP == 1) and "ROOK" or SIDE[2])
    text(a, 60, 76, COL[1][1]) text(b, 260 - #b * 8, 76, COL[2][1])
    if mode_t < 40 then text("DUEL!", 101, 101, 1, 3) text("DUEL!", 100, 100, 27, 3) end
  elseif mode == "over" then
    local r = F[winner]
    local l1 = label(winner) .. " WINS!"
    local l2 = SIDE[winner] .. " got out through the " .. (r.dir > 0 and "Sea Gate" or "Mill Gate")
    rectfill(30, 80, 260, 66, 31) rect(30, 80, 260, 66, COL[winner][1])
    text(l1, 160 - #l1 * 8, 88, COL[winner][1], 2)
    text(l2, 160 - #l2 * 4, 110, 13)
    if over_t > 60 then text("A: next duel", 112, 128, 29) end
  end
end
`;

  // Pixel art: one char per pixel, mapped to palette indices. c / C are the cloak colours (swapped per side).
  const K = { '.': 0, o: 31, c: 10, C: 9, s: 11, e: 1, l: 30, b: 7, B: 6, n: 7, N: 8, w: 29, Y: 13, r: 25, g: 28, G: 30 };
  const HEAD = [
    '................',
    '................',
    '......oooo......',
    '.....occcco.....',
    '....occccsso....',
    '....occcsseo....',
    '....oCccssso....',
    '.....oCcsso.....',
    '.....occcco.....',
    '....occccccso...',
    '....oCcccccso...',
    '....oCccccco....',
    '....oCccccco....',
    '....oCBBBBBo....',
    '....oCccccco....',
    '....oCccccco....',
    '.....oCcccco....',
  ];
  const ART = {
    1: HEAD.concat([                                   // standing
      '.....oll.llo....', '.....oll.llo....', '.....oll.llo....', '.....oll.llo....',
      '.....obb.bbo....', '....obbb.bbbo...', '....oooo.oooo...']),
    3: HEAD.concat([                                   // walking
      '.....olllllo....', '....olll.lllo...', '....oll...llo...', '...oll.....llo..',
      '...obb.....bbo..', '..obbb.....bbbo.', '..oooo.....oooo.']),
    7: HEAD.concat([                                   // jumping
      '.....olllllo....', '....ollllllo....', '...olll..lllo...', '...obb....bbo...',
      '...obbo..obbo...', '....oo....oo....', '................']),
    9: [                                                // crouching
      '................', '................', '................', '................', '................',
      '................', '................', '................', '................', '................',
      '......oooo......', '.....occcco.....', '....occccsso....', '....occcsseo....', '....oCccssso....',
      '....occcccco....', '...oCcccccccso..', '...oCcBBBBBco...', '...oCccccccco...', '...olllllllllo..',
      '..ollo...ollo...', '..obbo...obbbo..', '.obbbo...obbbo..', '.ooooo...ooooo..'],
    13: [                                               // down (24x16)
      '........................', '........................', '........................', '........................',
      '........................', '........................', '........................', '........................',
      '........................', '.............oooooo.....', '..ooo...ooooocccccccooo.', '.obbllllllCccccBccccosso',
      '.obbllllllCccccBccccoseo', '..ooo...ooooocccccccooo.', '.............oooooo.....', '........................'],
    49: ['oooooooo', 'onnnnnno', 'onNnnNno', 'onnNNnno', 'onnNNnno', 'onNnnNno', 'onnnnnno', 'oooooooo'],   // crate
    50: ['.oooooo.', 'onnnnnno', 'oggggggo', 'onnnnnno', 'onnnnnno', 'oggggggo', 'onnnnnno', '.oooooo.'],   // barrel
    64: [                                               // icon: a loaded crossbow
      '................', '...........oo...', '..........oNNo..', '..........oNo...',
      '...........oNo..', '.r.........oNo..', 'rrw..........oNo', 'wwwwwwwwwwwwwwwY',
      '.nnnnnnnnnnnnoNo', '.nBBBBBnnnnnoNo.', '.nn...nn...oNo..', '...........oNo..',
      '..........oNo...', '..........oNNo..', '...........oo...', '................'],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const t = +n + (y >> 3) * 16 + (x >> 3);
        cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
      }));
    // Crossgate draws everything itself. The crossbow entity type is there so the Bit's home screen
    // can use it as the game's icon.
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'crossbow', anims: [{ name: 'idle', frames: [64], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Town', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Crossgate', code, buildGfx,
    about: 'A crossbow duel for 1-2 players (more take turns): win a fight to get the way, then run for your gate.' });
})();
