/* Demo cart "Hedge Hogs": fence off land with hedges, together or against each other (1-8 players).
   Original art and code. MIT License. */
(function () {
  const code = `-- Hedge Hogs: hedgehogs that plant hedges (1-8 players, on one screen or on linked Bits)
--   D-pad: walk. On your own land you can stand still; off it you keep walking.
--   Walk off your land and you plant a hedge line behind you. Walk back onto your land to finish it:
--   everything you fenced off becomes yours.
--   Garden (together): fence off 75% of each garden. Moles dig about in the open ground, and a mole
--   that touches an unfinished line eats it and costs the team a heart.
--   Land Grab (against each other): walk across a rival's unfinished line to send them home.
--   Most land when the time runs out wins. CPU hogs fill the garden up to 4.
-- The ground is the map (one tile per cell), so the Bit draws it in one call.
-- Linked Bits run in lockstep: the game only uses rnd() and the frame count, and drawing never calls rnd().

W, H, TOP = 40, 26, 32                     -- the garden in cells (8x8 pixels each), and where it starts on screen
STEP = tune("Frames per step", 4, 2, 8)
MOLE_SPEED = tune("Mole speed", 1, 0.5, 2, 0.1)
NEED = tune("Garden: land needed (%)", 75, 50, 90)
GARDENS = 3
PC = { 10, 21, 17, 5, 27, 26, 22, 13 }     -- hog colours
DX, DY = { 1, 0, -1, 0 }, { 0, 1, 0, -1 }  -- directions: 1 right, 2 down, 3 left, 4 up
DIRKEY = { "right", "down", "left", "up" }
HOMES = { { 5, 4 }, { 34, 21 }, { 34, 4 }, { 5, 21 }, { 20, 4 }, { 20, 21 }, { 5, 13 }, { 34, 13 } }
MODES = { { "GARDEN", "Together: fence off the garden." }, { "LAND GRAB", "Everyone for themselves." } }
RING = 2 * W + 2 * H - 4

function _init()
  game{
    title = "Hedge Hogs",
    players = {1, 8},
    goal = "Fence off " .. NEED .. "% of all " .. GARDENS .. " gardens together, or end a Land Grab with the most land.",
    help = {
      "D-pad: walk. Off your own land you keep walking.",
      "Leave your land to plant a hedge line. Walk back onto your land and all you fenced off is yours.",
      "Garden: a mole that touches an unfinished line costs a heart. Land without moles in it fills in.",
      "Land Grab: cross a rival's unfinished line to send them home. Most land at the end wins.",
    },
    continue = function(cp) if cp and cp.mode then start(cp.mode, cp.lvl) end end,
    settings = {
      { key = "cpu", name = "CPU hogs", values = { "Easy", "Normal", "Hard" }, value = 2 },
      { key = "time", name = "Land Grab minutes", min = 1, max = 5, value = 2 },
    },
    title_draw = function(t) draw_title(t) end,   -- its own animated title screen (at the end of the code)
    look = { title = 18, shadow = 14, panel = 14, edge = 17, hi = 15, text = 12, pick = 27, goal = 12, footer = 18 },
  }
  NP = math.max(1, math.min(PLAYERS or 1, 8))
  gt, last_t, pick_t = 0, -9, 0
  held, want = {}, {}
  for p = 1, NP do held[p], want[p] = {}, 0 end
  fx, sel, won_garden = {}, 1, false
  start(1, 1)
  state = "pick"
end

-- ---------------------------------------------------------------- helpers
function sgn(v) return v > 0 and 1 or (v < 0 and -1 or 0) end
function mid(a, v, b) return math.max(a, math.min(v, b)) end
function ctext(s, y, c, sc) sc = sc or 1 text(s, 160 - #s * 4 * sc, y, c, sc) end
function stext(s, y, c, sc) sc = sc or 1 text(s, 161 - #s * 4 * sc, y + sc, 1, sc) ctext(s, y, c, sc) end
function idx(x, y) return y * W + x + 1 end
function inb(x, y) return x >= 0 and x < W and y >= 0 and y < H end
function opp(d) return (d + 1) % 4 + 1 end

-- which way each player wants to go: the direction pressed last that is still held
function read_pads()
  local fresh = t() ~= last_t + 1
  last_t = t()
  press_a, press_b, press_lr = false, false, 0
  for p = 1, NP do
    for d = 1, 4 do
      local now = btn(DIRKEY[d], p)
      if now and not held[p][d] then
        want[p] = d
        if not fresh then press_lr = (d == 1 or d == 2) and 1 or -1 end
      end
      held[p][d] = now
    end
    if want[p] ~= 0 and not held[p][want[p]] then
      want[p] = 0
      for d = 1, 4 do if held[p][d] then want[p] = d end end
    end
    local a, b = btn("a", p), btn("b", p)
    if a and not held[p].a and not fresh then press_a = true end
    if b and not held[p].b and not fresh then press_b = true end
    held[p].a, held[p].b = a, b
  end
end

function burst(x, y, c, n)
  for i = 1, n do
    fx[#fx + 1] = { x = x, y = y, vx = (rnd() * 2 - 1) * 1.6, vy = (rnd() * 2 - 1) * 1.6, t = 14 + rnd(16), c = c }
  end
end

-- ---------------------------------------------------------------- the garden
-- own[i]: whose land a cell is (0 = open ground). trail[i]: whose unfinished line is on it (0 = none).
function paint(i)
  local x, y = (i - 1) % W, (i - 1) // W
  local n
  if trail[i] ~= 0 then n = 48 + trail[i]
  elseif own[i] == 0 then n = 1 + (x + y) % 2
  elseif mode == 1 then
    local k = (x * 7 + y * 13 + x * y) % 23
    n = k < 3 and 33 + k or 32
  else n = 16 + own[i] end
  mset(x, y, n)
end

function give(i, team)
  if own[i] ~= team then
    if own[i] ~= 0 then land[own[i]] = land[own[i]] - 1 end
    own[i] = team
    land[team] = land[team] + 1
  end
  paint(i)
end

function start(m, l)
  mode, lvl = m, mid(1, l or 1, 99)
  own, trail, land, HOGS, MOLES = {}, {}, {}, {}, {}
  for i = 1, W * H do own[i], trail[i] = 0, 0 end
  for i = 1, 8 do land[i] = 0 end
  local n = mode == 1 and NP or math.max(NP, 4)
  for i = 1, n do
    local hx, hy = HOMES[i][1], HOMES[i][2]
    if mode == 1 then hx, hy = math.floor(W * (i - 0.5) / n), 0 end
    HOGS[i] = { id = i, pl = i <= NP and i or 0, team = mode == 1 and 1 or i, hx = hx, hy = hy, cx = hx, cy = hy, px = hx, py = hy,
                d = 0, face = 2, alive = true, dead_t = 0, path = {}, ai = nil, wait = 10 + i * 7 }
  end
  for i = 1, W * H do paint(i) end
  if mode == 1 then
    for x = 0, W - 1 do give(idx(x, 0), 1) give(idx(x, H - 1), 1) end
    for y = 0, H - 1 do give(idx(0, y), 1) give(idx(W - 1, y), 1) end
    for k = 1, lvl + 1 do
      MOLES[k] = { x = 80 + (k * 97) % 160, y = 60 + (k * 53) % 90, vx = (k % 2 == 0 and 1 or -1), vy = (k % 3 == 0 and -1 or 1) }
    end
    if lvl == 1 or not hearts or hearts <= 0 then hearts = 3 end
  else
    for _, h in ipairs(HOGS) do home_patch(h) end
    time_left = (setting("time") or 2) * 3600
  end
  state, state_t, winner, rank = "ready", 0, 0, nil
end

function home_patch(h)
  for y = h.hy - 1, h.hy + 1 do for x = h.hx - 1, h.hx + 1 do
    local i = idx(x, y)
    if trail[i] == 0 then give(i, h.team) end
  end end
end

function percent(team)
  if mode == 1 then return math.floor((land[1] - RING) * 100 / (W * H - RING)) end
  return math.floor(land[team] * 100 / (W * H))
end

-- after a line is finished: open ground the team has fenced off becomes theirs.
-- Garden: every patch with no mole in it. Land Grab: every patch but the biggest one.
function fill(team)
  local label, sizes, n = {}, {}, 0
  for i = 1, W * H do
    if own[i] ~= team and not label[i] then
      n = n + 1
      local q, at = { i }, 1
      label[i] = n
      while at <= #q do
        local c = q[at]
        at = at + 1
        local x = (c - 1) % W
        if x > 0 and own[c - 1] ~= team and not label[c - 1] then label[c - 1] = n; q[#q + 1] = c - 1 end
        if x < W - 1 and own[c + 1] ~= team and not label[c + 1] then label[c + 1] = n; q[#q + 1] = c + 1 end
        if c > W and own[c - W] ~= team and not label[c - W] then label[c - W] = n; q[#q + 1] = c - W end
        if c <= W * (H - 1) and own[c + W] ~= team and not label[c + W] then label[c + W] = n; q[#q + 1] = c + W end
      end
      sizes[n] = #q
    end
  end
  local keep = {}
  if mode == 1 then
    for _, m in ipairs(MOLES) do
      local l = label[idx(mid(0, m.x // 8, W - 1), mid(0, m.y // 8, H - 1))]
      if l then keep[l] = true end
    end
  else
    local big = 0
    for k = 1, n do if big == 0 or sizes[k] > sizes[big] then big = k end end
    keep[big] = true
  end
  local got = 0
  for i = 1, W * H do
    local l = label[i]
    if l and not keep[l] then give(i, team); got = got + 1 end
  end
  return got
end

function clear_path(h)
  for _, c in ipairs(h.path) do
    if trail[c] == h.id then trail[c] = 0; paint(c) end
  end
  h.path = {}
end

function finish(h)
  local cells = h.path
  h.path = {}
  for _, c in ipairs(cells) do
    if trail[c] == h.id then trail[c] = 0 end
    give(c, h.team)
  end
  local got = fill(h.team) + #cells
  sfx("C5", 1, 0.3, 5) sfx("E5", 1, 0.3, 9) if got > 30 then sfx("G5", 1, 0.3, 14) end
  burst(h.cx * 8 + 4, TOP + h.cy * 8 + 4, mode == 1 and 18 or PC[h.id], math.min(20, 4 + got // 6))
  h.gain, h.gain_t = got, 50
end

-- a hog loses its line and goes home
function send_home(h)
  burst(h.cx * 8 + 4, TOP + h.cy * 8 + 4, PC[h.id], 14)
  clear_path(h)
  h.alive, h.dead_t, h.d, h.ai = false, 80, 0, nil
  sfx("C3", 3, 0.4, 14)
end

-- ---------------------------------------------------------------- CPU hogs (Land Grab)
function blocked(h, d)
  local x, y = h.cx + DX[d], h.cy + DY[d]
  return not inb(x, y) or trail[idx(x, y)] == h.id
end

function cpu_dir(h)
  local sk = setting("cpu") or 2
  local on_own = own[idx(h.cx, h.cy)] == h.team
  -- a rival's line right ahead: go and cut it
  if #h.path < 4 + sk * 2 then
    for d = 1, 4 do
      for n = 1, 1 + sk do
        local x, y = h.cx + DX[d] * n, h.cy + DY[d] * n
        if not inb(x, y) then break end
        local tr = trail[idx(x, y)]
        if tr == h.id then break end
        if tr ~= 0 then return d end
      end
    end
  end
  local ai = h.ai
  if not ai then
    if not on_own then ai = { ph = "home" }; h.ai = ai
    else
      h.wait = h.wait - 1
      if h.wait > 0 then return nil end
      local d = rnd(4)
      ai = { ph = "exit", d = d, s = rnd(2) == 1 and d % 4 + 1 or (d + 2) % 4 + 1, len = rnd(3, 4 + sk * 2), side = rnd(2, 3 + sk * 2), n = 0 }
      h.ai = ai
    end
  end
  -- somebody close while my line is long: turn for home
  if (ai.ph == "out" or ai.ph == "side") and #h.path > 3 then
    for _, o in ipairs(HOGS) do
      if o ~= h and o.alive and math.abs(o.cx - h.cx) + math.abs(o.cy - h.cy) < 3 + sk then ai.ph, ai.n = "back", ai.len + 8 end
    end
  end
  if ai.ph == "exit" then
    if not on_own then ai.ph, ai.n = "out", ai.len
    elseif blocked(h, ai.d) then h.ai, h.wait = nil, 2 return nil
    else return ai.d end
  end
  if ai.ph == "out" then
    ai.n = ai.n - 1
    if ai.n <= 0 or blocked(h, ai.d) then
      ai.ph, ai.n = "side", ai.side
      if blocked(h, ai.s) then ai.s = opp(ai.s) end
    else return ai.d end
  end
  if ai.ph == "side" then
    if on_own then h.ai, h.wait = nil, rnd(4, 30 - sk * 6) return nil end
    ai.n = ai.n - 1
    if ai.n < 0 or blocked(h, ai.s) then ai.ph, ai.n = "back", ai.len + 8
    else return ai.s end
  end
  if ai.ph == "back" then
    if on_own then h.ai, h.wait = nil, rnd(4, 30 - sk * 6) return nil end
    ai.n = ai.n - 1
    local d = opp(ai.d)
    if ai.n < 0 or blocked(h, d) then ai.ph = "home" else return d end
  end
  -- home: any free step that gets closer to the home patch
  if on_own then h.ai, h.wait = nil, rnd(4, 30 - sk * 6) return nil end
  local best, bd = nil, 9999
  for d = 1, 4 do
    if not blocked(h, d) then
      local dist = math.abs(h.cx + DX[d] - h.hx) + math.abs(h.cy + DY[d] - h.hy)
      if dist < bd then best, bd = d, dist end
    end
  end
  return best
end

-- ---------------------------------------------------------------- update
function step_hog(h)
  h.px, h.py = h.cx, h.cy
  local on_own = own[idx(h.cx, h.cy)] == h.team
  local d
  if h.pl > 0 then d = want[h.pl] ~= 0 and want[h.pl] or nil else d = cpu_dir(h) end
  if d and blocked(h, d) then d = nil end
  if not d then
    if on_own and (h.pl > 0 or not h.ai) then h.d = 0 return end
    d = h.d
    if d == 0 or blocked(h, d) then return end
  end
  h.d, h.face = d, d
  h.cx, h.cy = h.cx + DX[d], h.cy + DY[d]
  local i = idx(h.cx, h.cy)
  local tr = trail[i]
  if tr ~= 0 and tr ~= h.id and HOGS[tr].team ~= h.team then send_home(HOGS[tr]) end
  if own[i] == h.team then
    if #h.path > 0 then finish(h) end
  else
    if trail[i] == 0 then trail[i] = h.id; paint(i) end
    h.path[#h.path + 1] = i
  end
end

function hurt(h)
  send_home(h)
  hearts = hearts - 1
  if hearts <= 0 then state, state_t = "over", 0 end
end

function moles()
  for _, m in ipairs(MOLES) do
    local sp = MOLE_SPEED * (1 + lvl * 0.12)
    local here = own[idx(mid(0, m.x // 8, W - 1), mid(0, m.y // 8, H - 1))] == 1
    local nx, ny = m.x + m.vx * sp, m.y + m.vy * sp
    if not here then
      local cx, cy = nx // 8, m.y // 8
      if not inb(cx, cy) or own[idx(cx, cy)] == 1 then m.vx = -m.vx; nx = m.x end
      cx, cy = m.x // 8, ny // 8
      if not inb(cx, cy) or own[idx(cx, cy)] == 1 then m.vy = -m.vy; ny = m.y end
    end
    m.x, m.y = mid(4, nx, W * 8 - 4), mid(4, ny, H * 8 - 4)
    local i = idx(mid(0, m.x // 8, W - 1), mid(0, m.y // 8, H - 1))
    if trail[i] ~= 0 and HOGS[trail[i]].alive then hurt(HOGS[trail[i]]) end
    for _, h in ipairs(HOGS) do
      if h.alive and #h.path > 0 and idx(h.cx, h.cy) == i then hurt(h) end
    end
    if state ~= "play" then return end
  end
end

function ranking()
  local r = {}
  for _, h in ipairs(HOGS) do r[#r + 1] = h end
  table.sort(r, function(a, b) if land[a.team] ~= land[b.team] then return land[a.team] > land[b.team] end return a.id < b.id end)
  return r
end

function hog_name(h)
  if h.pl == 0 then return "CPU " .. h.id end
  if NP == 1 then return "You" end
  return player_name(h.pl, 8)
end

function _update()
  gt = gt + 1
  read_pads()
  for i = #fx, 1, -1 do
    local p = fx[i]
    p.x, p.y, p.t = p.x + p.vx, p.y + p.vy, p.t - 1
    if p.t <= 0 then table.remove(fx, i) end
  end
  if state == "pick" then
    pick_t = pick_t + 1
    if press_lr ~= 0 then sel = (sel - 1 + press_lr) % #MODES + 1; sfx("E5", 0, 0.15, 3) end
    if press_a and pick_t > 10 then
      sfx("C5", 4, 0.3, 6)
      start(sel, 1)
      checkpoint({ mode = sel, lvl = 1 })
    end
    return
  end
  state_t = state_t + 1
  if state == "ready" then
    if state_t > 70 then state = "play"; sfx("G5", 1, 0.35, 10) end
    return
  end
  if state == "over" or state == "clear" then
    if state_t > 50 then
      if hold_btn("a") then
        if state == "clear" then start(1, lvl + 1) else start(mode, lvl) end
      elseif press_b then state, pick_t = "pick", 0 end
    end
    return
  end
  if mode == 1 then
    moles()
    if state ~= "play" then return end
  else
    time_left = time_left - 1
    if time_left <= 600 and time_left % 60 == 0 and time_left > 0 then sfx("A4", 0, 0.2, 4) end
  end
  for _, h in ipairs(HOGS) do
    if h.gain_t and h.gain_t > 0 then h.gain_t = h.gain_t - 1 end
    -- Land Grab: a hog with no land left goes home and gets its home patch back
    if mode == 2 and h.alive and land[h.team] == 0 then send_home(h) end
    if not h.alive then
      h.dead_t = h.dead_t - 1
      if h.dead_t <= 0 then
        h.alive, h.cx, h.cy, h.px, h.py, h.d = true, h.hx, h.hy, h.hx, h.hy, 0
        if mode == 2 then home_patch(h) end
      end
    end
  end
  if gt % STEP == 0 then
    for _, h in ipairs(HOGS) do if h.alive then step_hog(h) end end
  end
  if mode == 1 and percent(1) >= NEED then
    state, state_t = "clear", 0
    for _, h in ipairs(HOGS) do clear_path(h) end
    sfx("C5", 1, 0.4, 8) sfx("E5", 1, 0.4, 16) sfx("G5", 1, 0.4, 24) sfx("C6", 1, 0.4, 40)
    hearts = math.min(5, hearts + 1)
    checkpoint({ mode = 1, lvl = lvl + 1 })
    if lvl >= GARDENS and not won_garden then
      won_garden = true
      game_win("All " .. GARDENS .. " gardens are fenced off!")
    end
  elseif mode == 2 and time_left <= 0 then
    state, state_t = "over", 0
    rank = ranking()
    winner = rank[1].id
    sfx("C5", 1, 0.4, 8) sfx("E5", 1, 0.4, 16) sfx("G5", 1, 0.4, 30)
    if rank[1].pl > 0 then
      game_win(hog_name(rank[1]) .. (NP == 1 and " have" or " has") .. " the most land: " .. percent(rank[1].team) .. "% of the garden!")
    end
  end
end

-- ---------------------------------------------------------------- drawing (never calls rnd)
function draw_hog(h, x, y)
  local c = PC[h.id]
  circfill(x, y, 6, c)
  circfill(x, y, 5, 6)
  for k = 0, 5 do                                        -- spikes
    local a = k * 1.047 + 0.3
    pset(x + math.cos(a) * 3.5, y + math.sin(a) * 3.5, 9)
  end
  local fx_, fy_ = DX[h.face], DY[h.face]
  circfill(x + fx_ * 3, y + fy_ * 3, 2, 11)              -- face
  pset(x + fx_ * 5, y + fy_ * 5, 1)
  pset(x + fx_ * 3 - fy_ * 2, y + fy_ * 3 + fx_ * 2, 1) pset(x + fx_ * 3 + fy_ * 2, y + fy_ * 3 - fx_ * 2, 1)
end

function draw_field()
  cls(1)
  map(0, 0, W, H, 0, TOP)
  rect(0, TOP, 320, H * 8, 6)
  for _, m in ipairs(MOLES) do
    local x, y = m.x, TOP + m.y
    circfill(x, y + 1, 4, 6)
    circfill(x, y, 3, 30)
    circfill(x + m.vx * 2, y + m.vy * 2, 1, 5)
    pset(x - 1, y - 1, 13) pset(x + 1, y - 1, 13)
  end
  local f = (gt % STEP) / STEP
  if state ~= "play" then f = 1 end
  for _, h in ipairs(HOGS) do
    local x, y = (h.px + (h.cx - h.px) * f) * 8 + 4, TOP + (h.py + (h.cy - h.py) * f) * 8 + 4
    if h.alive then
      draw_hog(h, x, y)
      if h.pl > 0 and (ME or 0) == h.pl then text("v", x - 4, y - 16 + (gt // 12) % 2, 13)
      elseif h.pl > 0 and NP > 1 and state == "ready" then local nm = player_name(h.pl, 6) text(nm, x - #nm * 4, y + 8, 13) end
      if h.gain_t and h.gain_t > 0 then text("+" .. h.gain, x - 8, y - 14 - (50 - h.gain_t) // 5, 13) end
    elseif h.dead_t < 40 and (gt // 4) % 2 == 0 then
      circ(h.hx * 8 + 4, TOP + h.hy * 8 + 4, 6, PC[h.id])
    end
  end
  for _, p in ipairs(fx) do rectfill(p.x, p.y, 2, 2, p.c) end
end

function draw_hud()
  rectfill(0, 0, 320, TOP, 1)
  if mode == 1 then
    text("GARDEN " .. lvl, 8, 6, 17)
    for i = 1, 5 do if i <= hearts then circfill(12 + (i - 1) * 12, 23, 4, 26) elseif i <= 3 then circ(12 + (i - 1) * 12, 23, 4, 30) end end
    local p = mid(0, percent(1), 100)
    rectfill(100, 8, 152, 12, 30)
    rectfill(101, 9, p * 1.5, 10, 16)
    rectfill(101 + NEED * 1.5, 6, 2, 16, 27)
    text(p .. "%", 262, 10, 13)
    text("need " .. NEED .. "%", 232, 22, 29)
  else
    local s = time_left // 60
    text(string.format("%d:%02d", s // 60, s % 60), 8, 12, s <= 10 and 26 or 13)
    local n = #HOGS
    local w = math.min(64, 260 // n)
    for i, h in ipairs(HOGS) do
      local x = 52 + (i - 1) * w
      rectfill(x, 5, w - 4, 22, 2)
      rectfill(x, 5, 4, 22, PC[h.id])
      text(h.pl > 0 and player_name(h.pl, math.max(2, (w - 12) // 8)) or "CPU", x + 7, 7, (ME or 0) == h.pl and h.pl > 0 and 27 or 29)
      text(percent(h.team) .. "%", x + 7, 17, 13)
    end
  end
end

function _draw()
  draw_field()
  draw_hud()
  if state == "pick" then
    rectfill(32, 76, 256, 104, 1) rect(32, 76, 256, 104, 13)
    stext("PICK A GAME", 84, 27, 2)
    for i, m in ipairs(MODES) do
      local x = 52 + (i - 1) * 112
      rectfill(x, 110, 104, 26, i == sel and 15 or 2)
      rect(x, 110, 104, 26, i == sel and 13 or 30)
      text(m[1], x + 52 - #m[1] * 4, 119, i == sel and 27 or 29)
    end
    ctext(MODES[sel][2], 144, 13)
    ctext(NP == 1 and "1 player" or NP .. " players", 156, 29)
    ctext("left / right: pick    A: play", 168, 29)
  elseif state == "ready" then
    stext(mode == 1 and "GARDEN " .. lvl or "LAND GRAB", 100, 27, 2)
    ctext(mode == 1 and "Fence off " .. NEED .. "%. Mind the moles!" or "Most land wins!", 124, 13)
  elseif state == "clear" then
    rectfill(40, 86, 240, 70, 1) rect(40, 86, 240, 70, 13)
    stext("GARDEN " .. lvl .. " DONE!", 96, 17, 2)
    ctext(lvl >= GARDENS and "Every garden is in bloom." or "On to the next garden.", 120, 13)
    if state_t > 50 then ctext("hold A: next garden   B: pick a game", 136, 29) end
  elseif state == "over" then
    rectfill(40, 70, 240, 110, 1) rect(40, 70, 240, 110, 13)
    if mode == 1 then
      stext("THE MOLES WIN", 80, 26, 2)
      ctext("Garden " .. lvl .. ", " .. percent(1) .. "% fenced off", 106, 13)
    else
      stext(hog_name(rank[1]) .. (hog_name(rank[1]) == "You" and " win!" or " wins!"), 78, 27, 2)
      for i = 1, math.min(4, #rank) do
        local h = rank[i]
        rectfill(96, 100 + (i - 1) * 12, 6, 8, PC[h.id])
        text(hog_name(h), 108, 100 + (i - 1) * 12, 13)
        text(percent(h.team) .. "%", 192, 100 + (i - 1) * 12, 13)
      end
    end
    if state_t > 50 then ctext(mode == 1 and "hold A: try again   B: pick a game" or "hold A: again   B: pick a game", 164, 29) end
  end
end

-- the title screen (game{title_draw = ...}): a hog plants a hedge all the way round the screen, the
-- border bursts into flower, and a mole pops up to look. It only draws, from the frame count t.
function draw_title(t)
  local L = 2 * 38 + 2 * 28 - 4                       -- cells in the loop, one cell in from the edge
  local n = (t // 2) % (L + 100)
  local function cell(k)                              -- the k-th cell of the loop, and which way the hog faces
    if k < 38 then return 1 + k, 1, 1 end
    k = k - 38
    if k < 27 then return 38, 2 + k, 2 end
    k = k - 27
    if k < 37 then return 37 - k, 28, 3 end
    k = k - 37
    return 1, 27 - k, 4
  end
  for y = 0, 29 do for x = 0, 39 do spr(1 + (x + y) % 2, x * 8, y * 8) end end
  local done = n >= L
  if done then
    for y = 0, 29 do for x = 0, 39 do
      if x < 2 or x > 37 or y < 2 or y > 27 then
        local k = (x * 7 + y * 13 + x * y) % 23
        local grown = (n - L) * 2 > math.abs(x - 20) + math.abs(y - 15) - 16
        spr(grown and (k < 5 and 33 + k % 3 or 32) or (((x == 1 or x == 38) and y >= 1 and y <= 28 or (y == 1 or y == 28) and x >= 1 and x <= 38) and 49 or 1 + (x + y) % 2), x * 8, y * 8)
      end
    end end
  else
    for k = 0, n - 1 do local x, y = cell(k) spr(49, x * 8, y * 8) end
  end
  local hx, hy, face = cell(math.min(n, L - 1))
  if done then hx, hy, face = 1, 1, 1 end
  draw_hog({ id = 1, face = face }, hx * 8 + 4, hy * 8 + 4 - (done and (n // 6) % 2 or 0))
  -- the mole in the corner comes up when the hedge is nearly round
  local up = mid(0, (n - L * 0.6) / 20, 1) * (done and mid(0, 1 - (n - L - 60) / 20, 1) or 1)
  if up > 0 then
    local mx, my = 284, 150
    circfill(mx, my + 6, 9, 6)
    clip(mx - 10, my - 14, 20, 20)
    circfill(mx, my + 10 - up * 10, 7, 30)
    circfill(mx, my + 12 - up * 10, 2, 5)
    pset(mx - 3, my + 7 - up * 10, 13) pset(mx + 3, my + 7 - up * 10, 13)
    clip()
  end
end
`;

  // ---- tiles: the ground is drawn with the map, so every kind of cell is one 8x8 tile
  const PC = [10, 21, 17, 5, 27, 26, 22, 13], PD = [9, 20, 16, 4, 10, 25, 21, 29];
  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    const put = (n, fn) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cart.tiles[n * 64 + y * 8 + x] = fn(x, y); };
    const speck = (x, y, k) => ((x * 5 + y * 3 + k) % 11 === 0);
    put(1, (x, y) => speck(x, y, 0) ? 6 : 7);                                   // open ground
    put(2, (x, y) => speck(x, y, 4) ? 8 : 7);
    for (let k = 1; k <= 8; k++) {
      // land of hog k: a clipped hedge
      put(16 + k, (x, y) => (x === 0 || y === 0) ? PD[k - 1] : ((x + y * 2) % 5 === 0 ? PD[k - 1] : PC[k - 1]));
      // an unfinished line of hog k: saplings in a row
      put(48 + k, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5) ? ((x === 2 || y === 5) ? PD[k - 1] : PC[k - 1]) : (speck(x, y, 2) ? 6 : 7));
    }
    const grass = (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 15 : 16);
    put(32, grass);
    const flower = (c) => (x, y) => {
      if (x === 3 && y === 3) return 27;
      if ((Math.abs(x - 3) === 1 && y === 3) || (Math.abs(y - 3) === 1 && x === 3)) return c;
      return grass(x, y);
    };
    put(33, flower(13)); put(34, flower(5)); put(35, flower(11));
    // the icon (16x16 at tile 64): a hedgehog on grass
    const K = { '.': 0, o: 6, b: 7, s: 9, f: 11, e: 1, g: 16, G: 15, n: 26 };
    const ICON = [
      '................',
      '......s.s.s.....',
      '....s.ooooo.s...',
      '...sooobbbooo...',
      '..sobbsbbsbboo..',
      '..obsbbbsbbbsof.',
      '.sobbbsbbbsbbff.',
      '.obbsbbbsbbbfefn',
      '.obbbbsbbbsbffff',
      '.sobsbbbsbbbfff.',
      '..oobbbbbbboo...',
      '...ooo...ooo....',
      'gGgggGggggGgggGg',
      'ggggGgggGggggggg',
      '................',
      '................',
    ];
    ICON.forEach((row, y) => [...row].forEach((ch, x) => {
      const t = 64 + (y >> 3) * 16 + (x >> 3);
      cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
    }));
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'hog', anims: [{ name: 'idle', frames: [64], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Garden', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Hedge Hogs', code, buildGfx,
    about: 'Fence off land with hedges for 1-8 players: fill the garden together past the moles, or grab the most land.' });
})();
