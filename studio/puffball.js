/* Demo cart "Puffball": beach volleyball with a pufferfish for 1-8 players. Original art and code. MIT License. */
(function () {
  const code = `-- Puffball: keep the puffer off your sand (1-8 players, on one screen or on linked Bits)
--   Left / right: run. A: jump. B: dive (a quick lunge along the sand).
--   Serve: the server carries the puffer above their head, walks to a good spot and jumps. A moment later
--   the puffer lets go. Nobody is frozen after a point, and the side that lost the point serves.
--   Match: two sides, the puffer lands on your sand and the other side scores. 3 touches a side at most.
--   Rally: everyone works together and passes the puffer over the net as often as they can.
-- Before the first serve a setup screen lets every player pick a colour and set the net and the puffer.
-- New match (pause menu, or A after a match) starts over with the same setup.
-- Every touch puffs the puffer up: it gets bigger and faster until somebody misses.
-- Odd players start on the left, even players on the right; crabs (CPU) fill the empty spots.
-- Linked Bits run in lockstep: the game only uses rnd() and the frame count, and drawing never calls rnd().

GROUND, NETX, NET_TOP, NET_W = 204, 160, 150, 3
GRAV, JUMP = tune("Gravity", 0.3, 0.1, 0.6, 0.01), -tune("Jump power", 5.6, 3, 8, 0.1)
SPEED, DIVE = tune("Run speed", 2.3, 1, 4, 0.1), tune("Dive speed", 5, 3, 8, 0.5)
BALL_G0, HIT = tune("Puffer gravity", 0.12, 0.05, 0.3, 0.01), tune("Hit power", 4.7, 3, 7, 0.1)
HEAT = tune("Speed-up per touch", 0.07, 0, 0.2, 0.01)
SERVE_T = tune("Serve timer (frames)", 10, 0, 40)   -- after the server jumps, how long until the puffer lets go
SERVE_WAIT = 300                            -- a server who never jumps: the puffer goes by itself after this long
CARRY = 36                                  -- how far above the server's feet the puffer is carried
RALLY_GOAL = 30
PR = 12                                     -- body radius of a player
PC = { 10, 21, 17, 5, 27, 26, 22, 13 }      -- the colours players pick from
PD = { 9, 20, 16, 4, 10, 25, 21, 29 }       -- and their shades
CNAME = { "SUNNY", "OCEAN", "LIME", "GRAPE", "LEMON", "CORAL", "SKY", "SNOW" }
-- the setup screen: each row is {name, values}; COLORS is every player's own colour
NETS = { { "Low", 164 }, { "Normal", 150 }, { "High", 134 } }       -- the top of the net
FLOAT = { { "Floaty", 0.7 }, { "Normal", 1 }, { "Heavy", 1.3 } }   -- times the puffer gravity
SIZES = { { "Small", 6 }, { "Normal", 8 }, { "Big", 11 } }          -- the puffer's size before it puffs up
MODES = { { "MATCH", "Two sides. Most points wins." }, { "RALLY", "Together: keep it flying." } }
KEYS = { "left", "right", "up", "down", "a", "b" }

function _init()
  game{
    title = "Puffball",
    players = {1, 8},
    goal = "Win a Match before the other side does, or pass the puffer " .. RALLY_GOAL .. " times in a row in a Rally.",
    help = {
      "Left / right: run. A: jump. B: dive.",
      "Serving: you carry the puffer. Walk to where you want to serve from and jump: it lets go a moment later.",
      "Match: if the puffer lands on your sand, the other side scores. A side may touch it 3 times in a row.",
      "Rally: everyone plays together. Every pass over the net counts; 3 drops end the run.",
      "Every touch puffs the puffer up and speeds it up.",
      "Before a game, everyone picks a colour, and you can set the net height and how floaty and big the puffer is.",
      "New match (in the pause menu, or A after a match) starts over with the same setup.",
      "Odd players are on the left, even players on the right. Crabs fill the empty spots.",
    },
    continue = function(cp) if cp and cp.mode then start(cp.mode, cp) end end,
    settings = {
      { key = "cpu", name = "Crabs (CPU)", values = { "Easy", "Normal", "Hard" }, value = 2 },
      { key = "points", name = "Points to win", min = 3, max = 15, value = 7 },
    },
    pause = {
      { "New match", function() start(mode) end },
      { "Change setup", function() go_setup() end },
    },
    title_draw = function(t) draw_title(t) end,   -- its own animated title screen (at the end of the code)
    look = { title = 13, shadow = 24, panel = 24, edge = 10, hi = 25, text = 12, pick = 27, goal = 12, footer = 11 },
  }
  NP = math.max(1, math.min(PLAYERS or 1, 8))
  gt, last_t, pick_t = 0, -9, 0
  pad, edge = {}, {}
  fx, best, won_rally = {}, 0, false
  sel, row = 1, 1
  col = {}
  for p = 1, 8 do col[p] = p end
  opt = { net = 2, float = 2, size = 2, points = setting("points") or 7 }
  start(1)
  state = "pick"
end

-- the setup screen's rows for the picked game (Points only in a Match)
function setup_rows()
  local r = { "COLORS", "NET", "PUFFER", "SIZE" }
  if mode == 1 then r[#r + 1] = "POINTS" end
  return r
end
function row_value(name)
  if name == "NET" then return NETS[opt.net][1]
  elseif name == "PUFFER" then return FLOAT[opt.float][1]
  elseif name == "SIZE" then return SIZES[opt.size][1]
  elseif name == "POINTS" then return tostring(opt.points) end
  return ""
end
function change_row(name, d)
  if name == "NET" then opt.net = mid(1, opt.net + d, #NETS)
  elseif name == "PUFFER" then opt.float = mid(1, opt.float + d, #FLOAT)
  elseif name == "SIZE" then opt.size = mid(1, opt.size + d, #SIZES)
  elseif name == "POINTS" then opt.points = mid(3, opt.points + d, 15) end
end
-- the next colour for player p that no other player has
function next_color(p, d)
  local c = col[p]
  for _ = 1, #PC do
    c = (c - 1 + d) % #PC + 1
    local free = true
    for q = 1, NP do if q ~= p and col[q] == c then free = false end end
    if free then col[p] = c; return true end
  end
  return false
end
function go_setup(m)
  mode = m or mode
  state, setup_t = "setup", 0
  row = math.min(row, #setup_rows())
end
function apply_opt()
  NET_TOP = NETS[opt.net][2]
  BALL_G = BALL_G0 * FLOAT[opt.float][2]
  R0 = SIZES[opt.size][2]
  if ball and ball.carry then ball.r = R0 end      -- the puffer behind the setup screen shows the new size
end

-- ---------------------------------------------------------------- helpers
function sgn(v) return v > 0 and 1 or (v < 0 and -1 or 0) end
function mid(a, v, b) return math.max(a, math.min(v, b)) end
function ctext(s, y, c, sc) sc = sc or 1 s = tr(s) text(s, 160 - #s * 4 * sc, y, c, sc) end   -- (tr: texts{} at the end)
function stext(s, y, c, sc) sc = sc or 1 s = tr(s) text(s, 161 - #s * 4 * sc, y + sc, 1, sc) ctext(s, y, c, sc) end
function pan(x) return mid(-1, (x - 160) / 160, 1) end

-- buttons going down this frame (btnp repeats while held, this does not)
function read_pads()
  local fresh = t() ~= last_t + 1          -- back from a menu: what is held now doesn't count as a new press
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

function burst(x, y, c, n, sp)
  for i = 1, n do
    fx[#fx + 1] = { x = x, y = y, vx = (rnd() * 2 - 1) * (sp or 1.5), vy = -rnd() * 2.4, t = 18 + rnd(20), c = c }
  end
end

-- ---------------------------------------------------------------- setting up
function start(m, cp)
  mode = m
  if cp and cp.opt then opt, col = cp.opt, cp.col or col end
  apply_opt()
  local k = math.max(1, (NP + 1) // 2)            -- players on each side
  P = {}
  for side = 1, 2 do
    local n = 0
    for p = 1, NP do
      if (p - 1) % 2 + 1 == side then n = n + 1; P[#P + 1] = new_player(side, n, k, p) end
    end
    while n < k do n = n + 1; P[#P + 1] = new_player(side, n, k, 0) end
  end
  score = { cp and cp.s1 or 0, cp and cp.s2 or 0 }
  best = cp and cp.best or best
  lives, streak, passes_total = 3, 0, 0
  target = opt.points
  if score[1] >= target or score[2] >= target then score = { 0, 0 } end
  state, state_t, winner = "play", 0, 0
  serves, banner_t = { 0, 0 }, 0
  serve(1)
end

function new_player(side, n, k, pl)
  local hx = 22 + (n - 0.5) / k * 120
  if side == 2 then hx = 320 - hx end
  return { side = side, pl = pl, home = hx, x = hx, y = GROUND, vx = 0, vy = 0, ground = true, face = side == 1 and 1 or -1,
           dive_t = 0, cd = 0, hit_cd = 0, err = 0, jump_ok = true, squash = 0 }
end

-- A serve: one player of the side carries the puffer above their head and walks to where they want to
-- serve from. Nobody is frozen. When the server jumps, a short timer runs and then the puffer lets go,
-- carrying on up and the way the server was moving. The players of a side take turns.
function serve(side)
  serves[side] = serves[side] + 1
  local team = {}
  for _, p in ipairs(P) do if p.side == side then team[#team + 1] = p end end
  local s = team[(serves[side] - 1) % #team + 1]
  ball = { x = s.x, y = s.y - CARRY, vx = 0, vy = 0, r = R0, spin = 0, carry = s, wait = 0, count = nil }
  touches, last_side, hits = 0, 0, 0
  for _, p in ipairs(P) do p.err, p.jump_ok = 0, true end
end

-- ---------------------------------------------------------------- the crabs (CPU)
-- where the puffer comes down to height y, and in how many frames
function predict(y)
  local x, by, vx, vy = ball.x, ball.y, ball.vx, ball.vy
  if ball.carry then return x, 60 end
  for n = 1, 240 do
    vy = vy + BALL_G
    x, by = x + vx, by + vy
    if x < ball.r then x, vx = ball.r, -vx elseif x > 320 - ball.r then x, vx = 320 - ball.r, -vx end
    if vy > 0 and by >= y then return x, n end
  end
  return x, 240
end

function cpu(p)
  local I = { mx = 0, jump = false, dive = false }
  local sk = setting("cpu") or 2
  local lx, lt = predict(GROUND - 34)
  local mine = (lx < NETX) == (p.side == 1)
  local tx = p.home
  if ball.carry == p then
    -- my serve: walk up towards the net, then jump
    tx = (p.side == 1 and 104 or 216) + p.err
    if p.ground and not ball.count and (math.abs(tx - p.x) <= 3 or ball.wait > 70) then I.jump = true end
  elseif ball.carry then
    -- somebody else's serve: back to my spot
  elseif mine then
    -- the one closest to the landing spot goes for it
    local go = true
    for _, o in ipairs(P) do
      if o ~= p and o.side == p.side and math.abs(o.x - lx) < math.abs(p.x - lx) - 4 then go = false end
    end
    if go then
      tx = lx + (p.side == 1 and -7 or 7) + p.err
      local bx = ball.x - p.x
      if p.ground and p.jump_ok and ball.vy > 0 and math.abs(bx) < 24 and ball.y > p.y - 84 and ball.y < p.y - 46 then I.jump = true end
      if sk > 1 and p.ground and lt < 22 and math.abs(tx - p.x) > 46 then I.dive = true end
    end
  end
  local dx = tx - p.x
  if math.abs(dx) > 3 then I.mx = sgn(dx) end
  if sk == 1 and gt % 4 == 0 then I.mx = 0 end      -- easy crabs are slower
  return I
end

function human(p)
  local n = p.pl
  return { mx = (pad[n].right and 1 or 0) - (pad[n].left and 1 or 0), jump = edge[n].a or edge[n].up, dive = edge[n].b }
end

-- ---------------------------------------------------------------- update
function move(p, I)
  if p.dive_t > 0 then p.dive_t = p.dive_t - 1 else p.vx = I.mx * SPEED end
  if p.cd > 0 then p.cd = p.cd - 1 end
  if p.hit_cd > 0 then p.hit_cd = p.hit_cd - 1 end
  if p.squash > 0 then p.squash = p.squash - 1 end
  if I.mx ~= 0 then p.face = I.mx end
  if I.dive and p.cd == 0 then
    p.vx, p.dive_t, p.cd = p.face * DIVE, 12, 45
    if p.ground then p.vy = -2.4; p.ground = false end
    sfx("C3", 3, 0.25, 6, nil, pan(p.x))
    burst(p.x, GROUND, 11, 5, 1.2)
  end
  p.jumped = false
  if I.jump and p.ground then p.vy, p.ground, p.jumped = JUMP, false, true; sfx("C4", 1, 0.2, 5, nil, pan(p.x), 500) end
  p.vy = p.vy + GRAV
  p.x, p.y = p.x + p.vx, p.y + p.vy
  if p.y >= GROUND then
    if not p.ground and p.vy > 2 then p.squash = 6 end
    p.y, p.vy, p.ground = GROUND, 0, true
  end
  if p.side == 1 then p.x = mid(PR, p.x, NETX - NET_W - PR) else p.x = mid(NETX + NET_W + PR, p.x, 320 - PR) end
end

function touch(p)
  if last_side == p.side then touches = touches + 1 else touches, last_side = 1, p.side end
  hits = hits + 1
  ball.r = math.min(R0 + 7, R0 + hits * 0.35)
  -- crabs get sloppier the longer a match rally lasts; in a Rally your crab partner is always a good one
  local sk = mode == 2 and 3 or (setting("cpu") or 2)
  local e = ({ 22, 12, 5 })[sk]
  if mode == 1 then e = math.floor(e * (1 + hits / 10)) end
  local jo = ({ 40, 70, 92 })[sk]
  for _, o in ipairs(P) do o.err, o.jump_ok = rnd(-e, e), rnd(100) <= jo end
  sfx(60 + math.min(hits, 24), 4, 0.45, 6, nil, pan(ball.x))
  burst(ball.x, ball.y, 27, 4, 1.4)
  if touches > 3 then fault(p.side, "4 TOUCHES!") end
end

function fault(side, why)
  why_text = why
  sfx("C3", 2, 0.4, 14, nil, 0, -60)
  if mode == 1 then
    score[3 - side] = score[3 - side] + 1
    checkpoint({ mode = 1, s1 = score[1], s2 = score[2], best = best, opt = opt, col = col })
    if score[3 - side] >= target then
      winner = 3 - side
      state, state_t = "over", 0
      sfx("C5", 1, 0.4, 8) sfx("E5", 1, 0.4, 16) sfx("G5", 1, 0.4, 30)
      if NP > 1 or winner == 1 then
        game_win(tr("%s won the match %d to %d!", tr(side_name(winner)), score[winner], score[side]))
      end
      checkpoint({ mode = 1, s1 = 0, s2 = 0, best = best, opt = opt, col = col })
      return
    end
  else
    lives = lives - 1
    streak = 0
    if lives <= 0 then state, state_t = "over", 0 return end
  end
  banner_t = 60
  serve(side)            -- the side that lost the point serves next, so it can't be scored on again right away
end

function side_name(s)
  if NP == 1 then return s == 1 and "You" or "The crab" end
  local names = {}
  for _, p in ipairs(P) do if p.side == s and p.pl > 0 then names[#names + 1] = player_name(p.pl, 8) end end
  if #names == 0 then return "The crabs" end
  return table.concat(names, " + ")
end

function ball_step()
  local b = ball
  if b.carry then
    local s = b.carry
    b.x, b.y = s.x, s.y - CARRY
    b.wait = b.wait + 1
    if s.jumped and not b.count then b.count = SERVE_T end
    if b.count then b.count = b.count - 1 end
    if (b.count and b.count <= 0) or b.wait > SERVE_WAIT then
      b.carry = nil
      b.vx, b.vy = s.vx * 1.4, math.min(s.vy, 0) - 2.2
      if not b.count then b.vy = -4 end
      sfx("E5", 4, 0.35, 6, nil, pan(b.x), 300)
    end
    return
  else
    b.vy = b.vy + BALL_G
    local ox = b.x
    b.x, b.y = b.x + b.vx, b.y + b.vy
    b.spin = b.spin + b.vx * 0.04
    if b.x < b.r then b.x, b.vx = b.r, math.abs(b.vx) elseif b.x > 320 - b.r then b.x, b.vx = 320 - b.r, -math.abs(b.vx) end
    if b.y < b.r - 60 then b.y, b.vy = b.r - 60, math.abs(b.vy) * 0.6 end
    -- the net: the closest point of its box pushes the puffer out
    local qx, qy = mid(NETX - NET_W, b.x, NETX + NET_W), mid(NET_TOP, b.y, GROUND)
    local dx, dy = b.x - qx, b.y - qy
    local d = math.sqrt(dx * dx + dy * dy)
    if d < b.r then
      if d < 0.01 then dx, dy, d = sgn(ox - NETX), 0, 1; if dx == 0 then dx = 1 end end
      local nx, ny = dx / d, dy / d
      b.x, b.y = qx + nx * b.r, qy + ny * b.r
      local dot = b.vx * nx + b.vy * ny
      if dot < 0 then b.vx, b.vy = (b.vx - 2 * dot * nx) * 0.8, (b.vy - 2 * dot * ny) * 0.8 end
      if gt % 6 == 0 then sfx("A2", 3, 0.15, 3) end
    end
    -- a pass over the net
    if (ox < NETX) ~= (b.x < NETX) and last_side ~= 0 then
      touches, last_side = 0, 0
      if mode == 2 then
        streak, passes_total = streak + 1, passes_total + 1
        if streak > best then best = streak; checkpoint({ mode = 2, best = best, opt = opt, col = col }) end
        if streak == RALLY_GOAL and not won_rally then
          won_rally = true
          game_win(RALLY_GOAL .. " passes without dropping the puffer!")
        end
      end
    end
  end
  for _, p in ipairs(P) do
    local cx, cy = p.x, p.y - PR
    local dx, dy = b.x - cx, b.y - cy
    local d = math.sqrt(dx * dx + dy * dy)
    local R = PR + b.r
    if d < R and p.hit_cd == 0 and state == "play" then
      if d < 0.01 then dx, dy, d = 0, -1, 1 end
      local nx, ny = dx / d, dy / d
      b.x, b.y = cx + nx * R, cy + ny * R
      local sp = HIT + math.min(hits, 24) * HEAT
      b.vx = nx * sp + p.vx * 0.45
      b.vy = math.min(ny * sp + p.vy * 0.3, -1.6)
      p.hit_cd = 10
      touch(p)
      if state ~= "play" then return end
    end
  end
  if b.y + b.r >= GROUND and state == "play" then
    b.y = GROUND - b.r
    burst(b.x, GROUND, 11, 10, 2)
    fault(b.x < NETX and 1 or 2, "SPLAT!")
  end
end

function _update()
  gt = gt + 1
  read_pads()
  for i = #fx, 1, -1 do
    local p = fx[i]
    p.x, p.y, p.vy, p.t = p.x + p.vx, p.y + p.vy, p.vy + 0.12, p.t - 1
    if p.t <= 0 then table.remove(fx, i) end
  end
  if state == "pick" then
    pick_t = pick_t + 1
    if any_edge("left") or any_edge("up") then sel = sel == 1 and #MODES or sel - 1; sfx("E5", 0, 0.15, 3) end
    if any_edge("right") or any_edge("down") then sel = sel % #MODES + 1; sfx("E5", 0, 0.15, 3) end
    if any_edge("a") and pick_t > 10 then
      sfx("C5", 4, 0.3, 6)
      go_setup(sel)
    end
    return
  end
  if state == "setup" then
    setup_t = setup_t + 1
    local rows = setup_rows()
    if any_edge("up") then row = row == 1 and #rows or row - 1; sfx("E5", 0, 0.15, 3) end
    if any_edge("down") then row = row % #rows + 1; sfx("E5", 0, 0.15, 3) end
    for p = 1, NP do
      local d = (edge[p].right and 1 or 0) - (edge[p].left and 1 or 0)
      if d ~= 0 then
        if rows[row] == "COLORS" then if next_color(p, d) then sfx(64 + col[p], 0, 0.15, 4, nil, 0) end
        else change_row(rows[row], d); apply_opt(); sfx("G5", 0, 0.15, 3) end
      end
    end
    if setup_t > 10 then
      if any_edge("a") then
        sfx("C5", 4, 0.3, 6)
        start(mode)
        checkpoint({ mode = mode, s1 = 0, s2 = 0, best = best, opt = opt, col = col })
      elseif any_edge("b") then state, pick_t = "pick", 0 end
    end
    return
  end
  state_t = state_t + 1
  if state == "over" then
    if state_t > 50 then
      if any_edge("a") then start(mode) elseif any_edge("b") then go_setup() end
    end
    return
  end
  if banner_t > 0 then banner_t = banner_t - 1 end
  for _, p in ipairs(P) do move(p, p.pl > 0 and human(p) or cpu(p)) end
  ball_step()
end

-- ---------------------------------------------------------------- drawing (never calls rnd)
function draw_beach()
  cls(22)
  rectfill(0, 0, 320, 40, 21)
  rectfill(0, 40, 320, 30, 22)
  rectfill(0, 70, 320, 60, 23)
  circfill(258, 46, 20, 12) circfill(258, 46, 17, 27)
  for i = 0, 2 do                                   -- clouds drift
    local x = (i * 130 + gt // 8) % 380 - 40
    local y = 20 + i * 17
    circfill(x, y, 7, 13) circfill(x + 9, y - 3, 9, 13) circfill(x + 20, y, 7, 13) rectfill(x, y, 20, 7, 13)
  end
  rectfill(0, 130, 320, 40, 21)                     -- sea
  for i = 0, 9 do
    local x = (i * 37 + (gt // 5)) % 340 - 20
    line(x, 136 + (i * 7) % 28, x + 12, 136 + (i * 7) % 28, 22)
  end
  rectfill(0, 166, 320, 2, 13)
  rectfill(0, 168, 320, 72, 11)                     -- sand
  rectfill(0, GROUND, 320, 36, 10)
  for i = 0, 15 do pset((i * 53) % 320, 172 + (i * 29) % 30, 10) pset((i * 71 + 20) % 320, 210 + (i * 13) % 26, 9) end
  -- the net
  rectfill(NETX - NET_W, NET_TOP, NET_W * 2, GROUND - NET_TOP, 29)
  rectfill(NETX - NET_W, NET_TOP, NET_W * 2, 3, 13)
  for y = NET_TOP + 8, GROUND - 4, 8 do line(NETX - NET_W, y, NETX + NET_W - 1, y, 30) end
  rectfill(NETX - 5, GROUND - 3, 10, 4, 30)
end

function draw_player(p, i)
  local c, d = 29, 30
  if p.pl > 0 then c, d = PC[col[p.pl]], PD[col[p.pl]] end
  local sq = p.squash > 0 and 2 or 0
  local cy = p.y - PR + sq
  rectfill(p.x - 10, GROUND + 1, 20, 3, 9)                          -- shadow
  rectfill(p.x - 8, p.y - 3, 5, 3, d) rectfill(p.x + 3, p.y - 3, 5, 3, d)   -- feet
  if p.pl == 0 then                                                 -- crab claws
    circfill(p.x - 13, cy - 4, 4, d) circfill(p.x + 13, cy - 4, 4, d)
  end
  circfill(p.x, cy, PR, d)
  circfill(p.x, cy - 1, PR - 1, c)
  circfill(p.x - 3, cy + 3, 6, c)
  -- eyes follow the puffer
  local ex, ey = sgn(ball.x - p.x), ball.y < cy - 10 and -1 or 0
  for s = -1, 1, 2 do
    circfill(p.x + s * 5, cy - 4, 3, 13)
    circfill(p.x + s * 5 + ex, cy - 4 + ey, 1, 1)
  end
  if p.dive_t > 0 then line(p.x - p.face * 14, cy, p.x - p.face * 22, cy, 13) line(p.x - p.face * 14, cy + 5, p.x - p.face * 19, cy + 5, 13) end
  if p.pl > 0 and (ME or 0) == p.pl then text("v", p.x - 4, cy - 26 + (gt // 12) % 2, 13) end
  if p.pl > 0 and NP > 1 then local nm = player_name(p.pl, 6) text(nm, p.x - #nm * 4 + 1, GROUND + 9, 8) text(nm, p.x - #nm * 4, GROUND + 8, 13) end
end

function draw_puffer(x, y, r, spin, face)
  for i = 0, 9 do                                                   -- spikes
    local a = spin + i * 0.628
    line(x + math.cos(a) * (r - 1), y + math.sin(a) * (r - 1), x + math.cos(a) * (r + 3), y + math.sin(a) * (r + 3), 9)
  end
  circfill(x, y, r, 10)
  circfill(x, y - 1, r - 1, 27)
  circfill(x, y + r * 0.35, r * 0.6, 12)
  local e = math.max(2, r // 4)
  circfill(x - r * 0.4, y - r * 0.25, e, 13) circfill(x + r * 0.4, y - r * 0.25, e, 13)
  pset(x - r * 0.4 + (face or 0), y - r * 0.25, 1) pset(x + r * 0.4 + (face or 0), y - r * 0.25, 1)
  rectfill(x - 1, y + 1, 3, 2, 26)
end

function draw_court()
  draw_beach()
  for i, p in ipairs(P) do draw_player(p, i) end
  local b = ball
  if b.y < -b.r then                                                -- above the screen: an arrow shows where
    text("^", mid(4, b.x - 4, 308), 2, 27)
  end
  local sw = mid(2, 9 - (GROUND - b.y) / 30, 9)
  rectfill(b.x - sw, GROUND + 1, sw * 2, 3, 9)
  draw_puffer(b.x, b.y, b.r, b.spin, sgn(b.vx))
  for _, p in ipairs(fx) do rectfill(p.x, p.y, 2, 2, p.c) end
end

function draw_hud()
  if mode == 1 then
    text(tostring(score[1]), 121 - #tostring(score[1]) * 24, 7, 1, 3) text(tostring(score[1]), 120 - #tostring(score[1]) * 24, 6, 13, 3)
    text(tostring(score[2]), 201, 7, 1, 3) text(tostring(score[2]), 200, 6, 13, 3)
    rectfill(136, 31, 48, 11, 1) ctext("to " .. target, 33, 13)
  else
    stext(tostring(streak), 6, 13, 3)
    local s = tr("passes  (best %d, goal %d)", best, RALLY_GOAL)
    rectfill(156 - #s * 4, 31, #s * 8 + 8, 11, 1) ctext(s, 33, 13)
    for i = 1, 3 do circfill(12 + i * 14, 14, 5, i <= lives and 26 or 30) end
  end
  if last_side ~= 0 and state == "play" then                        -- touches used on this side
    local x = last_side == 1 and 12 or 272
    for i = 1, 3 do circfill(x + i * 10, 226, 3, i <= touches and 27 or 9) end
  end
end

function _draw()
  draw_court()
  if state == "pick" then
    rectfill(40, 60, 240, 104, 1) rect(40, 60, 240, 104, 13)
    stext("PICK A GAME", 68, 27, 2)
    for i, m in ipairs(MODES) do
      local x = 60 + (i - 1) * 104
      rectfill(x, 94, 96, 26, i == sel and 20 or 2)
      rect(x, 94, 96, 26, i == sel and 13 or 30)
      local mn = tr(m[1]) text(mn, x + 48 - #mn * 4, 103, i == sel and 27 or 29)
    end
    ctext(MODES[sel][2], 128, 13)
    ctext(NP == 1 and "1 player, with a crab" or NP .. " players", 140, 29)
    ctext("left / right: pick    A: next", 152, 29)
    return
  end
  if state == "setup" then draw_setup() return end
  draw_hud()
  if state == "play" and banner_t > 0 then stext(why_text or "", 70, 27, 2) end
  local s = ball.carry
  if s and state == "play" then
    if ball.count then circ(ball.x, ball.y, ball.r + 3 + ball.count, 13)             -- the serve timer closing in
    elseif s.pl > 0 and (gt // 20) % 2 == 0 then
      local hint = tr("A: serve")
      text(hint, mid(2, ball.x - #hint * 4, 318 - #hint * 8), ball.y - ball.r - 14, 13)
    end
  end
  if state == "over" then
    rectfill(40, 70, 240, 80, 1) rect(40, 70, 240, 80, 13)
    if mode == 1 then
      local n = side_name(winner)
      local s = (n == "You" and tr("You win!")) or (n == "The crabs" and tr("The crabs win!")) or tr(n:find("+", 1, true) and "%s win!" or "%s wins!", tr(n))
      stext(s, 80, 27, #s > 14 and 1 or 2)
      ctext(score[1] .. " : " .. score[2], 104, 13)
    else
      stext("DROPPED!", 80, 26, 2)
      ctext(passes_total .. " passes this run, best streak " .. best, 104, 13)
    end
    if state_t > 50 then ctext("A: new match    B: setup", 128, 29) end
  end
end

-- the setup screen: every player's colour, then the net and the puffer
function blob(x, y, c, d, r)
  circfill(x, y, r, d) circfill(x, y - 1, r - 1, c)
  for s = -1, 1, 2 do circfill(x + s * r * 0.42, y - r * 0.33, math.max(1, r // 4), 13) pset(x + s * r * 0.42, y - r * 0.33, 1) end
end
function draw_setup()
  local rows = setup_rows()
  rectfill(20, 30, 280, 186, 1) rect(20, 30, 280, 186, 13)
  stext(mode == 1 and "SET UP THE MATCH" or "SET UP THE RALLY", 38, 27, 2)
  local y = 62
  for i, name in ipairs(rows) do
    local on = i == row
    local h = name == "COLORS" and 40 or 14
    if on then rectfill(26, y - 2, 268, h, 20) end
    text(name, 34, y + 2, on and 27 or 29)
    if name == "COLORS" then
      local w = 196 / NP
      for p = 1, NP do
        local x = 104 + (p - 0.5) * w
        local r = NP > 4 and 7 or 10
        blob(x, y + 13, PC[col[p]], PD[col[p]], r)
        if on and (gt // 15) % 2 == 0 and NP <= 4 then text("<", x - r - 10, y + 9, 13) text(">", x + r + 3, y + 9, 13) end
        local nm = NP == 1 and tr(CNAME[col[p]]) or player_name(p, NP > 4 and 3 or 6)
        text(nm, x - #nm * 4, y + 27, (ME or 0) == p and 27 or 13)
      end
    else
      local v = tr(row_value(name))
      text(v, 200 - #v * 4, y + 2, 13)
      if on then text("<", 200 - #v * 4 - 14, y + 2, 27) text(">", 200 + #v * 4 + 6, y + 2, 27) end
    end
    y = y + h + 4
  end
  ctext(row == 1 and "left / right: your own colour" or "up/down: choose  left/right: change", 186, 29)
  ctext("A: play    B: back", 200, 29)
end

-- the title screen (game{title_draw = ...}): two crabs keep the puffer flying over a sunset beach.
-- It only draws, from the frame count t it is given.
function title_crab(x, hop, c, d, look)
  local cy = GROUND - PR - hop
  rectfill(x - 10, GROUND + 1, 20, 3, 8)
  rectfill(x - 8, GROUND - 3 - hop, 5, 3, d) rectfill(x + 3, GROUND - 3 - hop, 5, 3, d)
  circfill(x - 13, cy - 4, 4, d) circfill(x + 13, cy - 4, 4, d)
  circfill(x, cy, PR, d) circfill(x, cy - 1, PR - 1, c)
  for s = -1, 1, 2 do circfill(x + s * 5, cy - 4, 3, 13) circfill(x + s * 5 + look, cy - 5, 1, 1) end
end

function draw_title(t)
  local bands = { 24, 25, 26, 9, 10, 27 }
  for i, c in ipairs(bands) do rectfill(0, (i - 1) * 24, 320, 24, c) end
  circfill(160, 150, 46, 12) circfill(160, 150, 42, 27)               -- the sun going down
  rectfill(0, 144, 320, 30, 20)                                       -- the sea
  for i = 0, 11 do
    local x = (i * 37 + t // 4) % 344 - 12
    line(x, 148 + (i * 7) % 24, x + 10, 148 + (i * 7) % 24, i % 3 == 0 and 27 or 21)
  end
  rectfill(0, 172, 320, 68, 9) rectfill(0, GROUND, 320, 36, 8)        -- sand in the evening
  rectfill(NETX - NET_W, 150, NET_W * 2, GROUND - 150, 29)
  rectfill(NETX - NET_W, 150, NET_W * 2, 3, 13)
  -- the puffer flies from crab to crab and back, a little bigger with every touch
  local n, f = t // 70, (t % 70) / 70
  local from, to = n % 2 == 0 and 40 or 280, n % 2 == 0 and 280 or 40
  local x = from + (to - from) * f
  local y = 172 - math.sin(f * 3.1416) * 52
  local hop = f > 0.86 and (f - 0.86) * 90 or (f < 0.14 and (0.14 - f) * 90 or 0)
  title_crab(40, n % 2 == 1 and f > 0.5 and hop or (n % 2 == 0 and f < 0.5 and hop or 0), 10, 9, sgn(x - 40))
  title_crab(280, n % 2 == 0 and f > 0.5 and hop or (n % 2 == 1 and f < 0.5 and hop or 0), 22, 21, sgn(x - 280))
  rectfill(x - 6, GROUND + 1, 12, 3, 8)
  draw_puffer(x, y, 9 + (n % 6), t / 12 * (to > from and 1 or -1), to > from and 1 or -1)
  if f < 0.12 then for i = 0, 5 do pset(from + math.cos(i) * f * 160, 168 + math.sin(i) * f * 120, 13) end end
end
-- this game's words in other languages (the Bit's language, LANGUAGE in Settings; runtime/bk_lang.lua)
texts{
  de = {
    ["Win a Match before the other side does, or pass the puffer # times in a row in a Rally."] = "Gewinn ein Match vor der anderen Seite, oder spiel dir den Kugelfisch in einer Rally #-mal hintereinander zu.",
    ["Left / right: run. A: jump. B: dive."] = "Links / rechts: laufen. A: springen. B: hechten.",
    ["Match: if the puffer lands on your sand, the other side scores. A side may touch it 3 times in a row."] = "Match: Landet der Kugelfisch auf deinem Sand, punktet die andere Seite. Jede Seite darf ihn 3-mal hintereinander berühren.",
    ["Rally: everyone plays together. Every pass over the net counts; 3 drops end the run."] = "Rally: Alle spielen zusammen. Jeder Pass übers Netz zählt; nach 3 Fehlern ist Schluss.",
    ["Every touch puffs the puffer up and speeds it up."] = "Jede Berührung bläst den Kugelfisch auf und macht ihn schneller.",
    ["Odd players are on the left, even players on the right. Crabs fill the empty spots."] = "Ungerade Spieler stehen links, gerade rechts. Krabben füllen freie Plätze.",
    ["Crabs (CPU)"] = "Krabben (Computer)",
    ["Points to win"] = "Punkte zum Sieg",
    ["MATCH"] = "MATCH",
    ["Two sides. Most points wins."] = "Zwei Teams. Wer mehr punktet.",
    ["RALLY"] = "RALLY",
    ["Together: keep it flying."] = "Halt ihn zusammen in der Luft.",
    ["%s won the match %d to %d!"] = "%s: Match gewonnen, %d zu %d!",
    ["You"] = "Du",
    ["The crab"] = "Die Krabbe",
    ["The crabs"] = "Die Krabben",
    ["# passes without dropping the puffer!"] = "# Pässe, ohne den Kugelfisch fallen zu lassen!",
    ["to #"] = "bis #",
    ["passes  (best %d, goal %d)"] = "Pässe  (Rekord %d, Ziel %d)",
    ["PICK A GAME"] = "WÄHL EIN SPIEL",
    ["1 player, with a crab"] = "1 Spieler, mit einer Krabbe",
    ["# players"] = "# Spieler",
    ["left / right: pick    A: play"] = "Wahl: links/rechts  A: spielen",
    ["READY"] = "BEREIT",
    ["You win!"] = "Du gewinnst!",
    ["The crabs win!"] = "Die Krabben gewinnen!",
    ["%s win!"] = "%s gewinnen!",
    ["%s wins!"] = "%s gewinnt!",
    ["DROPPED!"] = "RUNTERGEFALLEN!",
    ["# passes this run, best streak #"] = "# Pässe diesmal, beste Serie #",
    ["A: again    B: pick a game"] = "A: nochmal    B: anderes Spiel",
    ["4 TOUCHES!"] = "4 BERÜHRUNGEN!",
    ["SPLAT!"] = "PLATSCH!",
    ["Gravity"] = "Schwerkraft",
    ["Jump power"] = "Sprungkraft",
    ["Run speed"] = "Lauftempo",
    ["Dive speed"] = "Hechttempo",
    ["Puffer gravity"] = "Kugelfisch-Schwerkraft",
    ["Hit power"] = "Schlagkraft",
    ["Speed-up per touch"] = "Tempo pro Berührung",
    ["Serve timer (frames)"] = "Aufschlag-Zeit (Frames)",
    ["SUNNY"] = "SONNE",
    ["OCEAN"] = "OZEAN",
    ["LIME"] = "LIMETTE",
    ["GRAPE"] = "TRAUBE",
    ["LEMON"] = "ZITRONE",
    ["CORAL"] = "KORALLE",
    ["SKY"] = "HIMMEL",
    ["SNOW"] = "SCHNEE",
    ["Low"] = "Niedrig",
    ["High"] = "Hoch",
    ["Floaty"] = "Schwebend",
    ["Heavy"] = "Schwer",
    ["Serving: you carry the puffer. Walk to where you want to serve from and jump: it lets go a moment later."] = "Aufschlag: Du trägst den Kugelfisch. Lauf dahin, von wo du aufschlagen willst, und spring: Kurz danach lässt er los.",
    ["Before a game, everyone picks a colour, and you can set the net height and how floaty and big the puffer is."] = "Vor dem Spiel wählt jeder eine Farbe, und ihr könnt Netzhöhe, Schweben und Größe des Kugelfischs einstellen.",
    ["New match (in the pause menu, or A after a match) starts over with the same setup."] = "Neues Match (im Pausenmenü oder A nach einem Match) fängt mit denselben Einstellungen neu an.",
    ["New match"] = "Neues Match",
    ["Change setup"] = "Einstellungen ändern",
    ["COLORS"] = "FARBEN",
    ["NET"] = "NETZ",
    ["PUFFER"] = "FISCH",
    ["SIZE"] = "GRÖSSE",
    ["POINTS"] = "PUNKTE",
    ["left / right: pick    A: next"] = "links/rechts: wählen A: weiter",
    ["A: serve"] = "A: aufschlagen",
    ["A: new match    B: setup"] = "A: neues Match    B: Einstellungen",
    ["SET UP THE MATCH"] = "MATCH EINSTELLEN",
    ["SET UP THE RALLY"] = "RALLY EINSTELLEN",
    ["left / right: your own colour"] = "links / rechts: deine Farbe",
    ["up/down: choose  left/right: change"] = "hoch/runter: wählen  links/rechts: ändern",
    ["A: play    B: back"] = "A: spielen    B: zurück",
  },
}
`;

  // the icon: a puffed-up puffer
  const K = { '.': 0, o: 9, y: 27, w: 13, e: 1, b: 12, r: 26, s: 10 };
  const ICON = [
    '.....s....s.....',
    '..s..oooooo..s..',
    '...ooyyyyyyoo...',
    '..oyyyyyyyyyyo..',
    's.oywwyyyywwyo.s',
    '.oyyweyyyyweyyo.',
    '.oyywwyyyywwyyo.',
    '.oyyyyyrryyyyyo.',
    '.oyyyyyrryyyyyo.',
    's.oybbbbbbbbyo.s',
    '..oybbbbbbbbyo..',
    '...oobbbbbboo...',
    '..s..oooooo..s..',
    '.....s....s.....',
    '................',
    '................',
  ];

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    ICON.forEach((row, y) => [...row].forEach((ch, x) => {
      const t = 64 + (y >> 3) * 16 + (x >> 3);
      cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
    }));
    // Puffball draws everything itself. The puffer entity type is the game's icon on the Bit's home screen.
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'puffer', anims: [{ name: 'idle', frames: [64], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Beach', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Puffball', code, buildGfx,
    about: 'Beach volleyball with a pufferfish for 1-8 players: a Match against the other side, or a Rally together.' });
})();
