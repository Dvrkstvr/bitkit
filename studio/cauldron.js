/* Demo cart "Cauldron Crew": a potion kitchen for 1-8 players, together or in two teams.
   Original art and code. MIT License. */
(function () {
  const code = `-- Cauldron Crew: brew what the customers order before they lose patience (1-8 players)
--   D-pad: walk. A: pick up / put down / use what you face. Hold X at a bubbling cauldron: stir (brews faster).
--   B: dash.
--   A potion is 3 ingredients in one cauldron. When it has brewed, take it out (A) and carry it to the
--   window. Leave it on the fire too long and it burns: carry the sludge to the bin.
--   One kitchen (alone or together): earn the shift's target in coins.
--   Teams (2 players or more): two kitchens, the same orders, most coins wins.
-- Linked Bits run in lockstep: the game only uses rnd() and the frame count, and drawing never calls rnd().

TOP, GW, GH = 32, 20, 13                    -- the kitchen is 20 x 13 tiles of 16 pixels, under the order cards
SPEED, DASH = tune("Walk speed", 1.8, 1, 3, 0.1), tune("Dash speed", 4.4, 2, 7, 0.2)
BREW = tune("Brew time (frames)", 300, 120, 600, 10)
BURN = tune("Time before it burns (frames)", 540, 180, 1200, 30)
STIR = tune("Stirring bonus", 1.5, 0, 4, 0.1)
PATIENCE = tune("Customer patience (frames)", 2700, 900, 5400, 60)
PC = { 10, 21, 17, 5, 27, 26, 22, 13 }      -- hat colours
PD = { 9, 20, 16, 4, 10, 25, 21, 29 }
ING = { "mushroom", "herb", "berry" }
ICOL = { 26, 17, 21 }                       -- potion colours by main ingredient
MODES = { { "ONE KITCHEN", "Together: earn the target." }, { "TEAMS", "Two kitchens. Most coins wins." } }
KITCHEN = {
  { "####M#M##H#H##B#B###",
    "#..................#",
    "#..................#",
    "#..................W",
    "#....ccc....ccc....W",
    "#..................#",
    "#..................#",
    "X..................#",
    "#....ccc....ccc....#",
    "#..................#",
    "#..................#",
    "#..................#",
    "###C#####C#####C####" },
  -- teams: the left half, mirrored for the right half. Both reach the berry crates in the middle wall.
  { "##M##H####", "#........#", "#........#", "W........#", "W...cc...#", "#........#", "#........B",
    "X........#", "#........#", "#...cc...#", "#........#", "#........#", "##C###C###" },
}

function _init()
  game{
    title = "Cauldron Crew",
    players = {1, 8},
    goal = "Earn the shift's target in coins, or out-brew the other team's kitchen.",
    help = {
      "D-pad: walk. A: pick up, put down or use what you face. B: dash.",
      "Put 3 ingredients in a cauldron. Hold X next to it to stir: it brews faster.",
      "Take the finished potion (A) to the window. It must match an order card.",
      "Potions left on the fire burn. Burnt or wrong potions go in the bin.",
      "Fast service tips more, and a streak of right orders adds a bonus.",
    },
    continue = function(cp) if cp and cp.mode then start(cp.mode, cp) end end,
    settings = { { key = "mins", name = "Shift minutes", min = 2, max = 5, value = 3 } },
    title_draw = function(t) draw_title(t) end,   -- its own animated title screen (at the end of the code)
    look = { title = 17, shadow = 1, panel = 1, edge = 5, hi = 3, text = 12, pick = 27, goal = 12, footer = 29, menu = "right" },
  }
  NP = math.max(1, math.min(PLAYERS or 1, 8))
  gt, last_t, pick_t = 0, -9, 0
  held, edge = {}, {}
  fx, sel, best = {}, 1, 0
  start(1)
  if NP > 1 then state = "pick" end
end

-- ---------------------------------------------------------------- helpers
function sgn(v) return v > 0 and 1 or (v < 0 and -1 or 0) end
function mid(a, v, b) return math.max(a, math.min(v, b)) end
function ctext(s, y, c, sc) sc = sc or 1 s = tr(s) text(s, 160 - #s * 4 * sc, y, c, sc) end   -- (tr: texts{} at the end)
function stext(s, y, c, sc) sc = sc or 1 s = tr(s) text(s, 161 - #s * 4 * sc, y + sc, 1, sc) ctext(s, y, c, sc) end
function pan(x) return mid(-1, (x - 160) / 160, 1) end

function read_pads()
  local fresh = t() ~= last_t + 1
  last_t = t()
  for p = 1, NP do
    local was = held[p] or {}
    local now = { a = btn("a", p), b = btn("b", p), left = btn("left", p), right = btn("right", p) }
    edge[p] = {}
    for k, v in pairs(now) do edge[p][k] = v and not was[k] and not fresh end   -- (order doesn't matter here)
    held[p] = now
  end
end
function any_edge(k) for p = 1, NP do if edge[p][k] then return p end end end

function burst(x, y, c, n)
  for i = 1, n do
    fx[#fx + 1] = { x = x, y = y, vx = (rnd() * 2 - 1) * 1.4, vy = -rnd() * 2, t = 16 + rnd(18), c = c }
  end
end
function float(x, y, s, c) fl[#fl + 1] = { x = x, y = y, s = s, c = c, t = 50 } end

-- ---------------------------------------------------------------- the kitchen
function tile(tx, ty)
  if tx < 0 or ty < 0 or tx >= GW or ty >= GH then return "#" end
  return G[ty * GW + tx + 1]
end
function solid(x, y) return tile(x // 16, y // 16) ~= "." end

function start(m, cp)
  mode = m
  G, ST, CAULS = {}, {}, {}
  for y = 0, GH - 1 do
    local row = KITCHEN[m][y + 1]
    if m == 2 then row = row .. row:reverse() end
    for x = 0, GW - 1 do
      local ch = row:sub(x + 1, x + 1)
      local i = y * GW + x + 1
      G[i] = ch
      if ch ~= "." and ch ~= "#" then
        local s = { ch = ch, tx = x, ty = y, team = (m == 2 and x >= GW // 2) and 2 or 1 }
        if ch == "C" then s.items, s.prog, s.over, s.stir = {}, 0, 0, 0; CAULS[#CAULS + 1] = s end
        ST[i] = s
      end
    end
  end
  teams = m == 2 and 2 or 1
  size = { 0, 0 }
  P = {}
  for p = 1, NP do
    local tm = m == 2 and (p - 1) % 2 + 1 or 1
    size[tm] = size[tm] + 1
    local n = size[tm]
    local x = m == 2 and (tm == 1 and 40 or 280) + ((n - 1) % 2) * 24 * (tm == 1 and 1 or -1) or 80 + ((p - 1) % 4) * 48
    local y = m == 2 and 40 + ((n - 1) // 2) * 30 or 40 + ((p - 1) // 4) * 100
    P[p] = { pl = p, team = tm, x = x, y = y, fx = 0, fy = 1, hold = nil, dash_t = 0, cd = 0, walk = 0, stir = false }
  end
  -- every team gets the same orders at the same moments
  SEQ = {}
  for n = 1, 80 do
    local a, b, c = rnd(3), rnd(3), rnd(3)
    if n <= 2 then b, c = a, a elseif n <= 6 then c = a end
    local r = { a, b, c }
    table.sort(r)
    SEQ[n] = r
  end
  ORD = {}
  for tm = 1, teams do ORD[tm] = { list = {}, n = 0, wait = 1, served = 0, streak = 0 } end
  score = { cp and cp.s1 or 0, cp and cp.s2 or 0 }
  time_left = cp and cp.time or (setting("mins") or 3) * 3600
  best = cp and cp.best or best
  target = 150 + 60 * (math.max(size[1], 1) - 1)
  fl, shake = {}, 0
  state, state_t, winner = "ready", 0, 0
end

function key(r) return r[1] * 100 + r[2] * 10 + r[3] end
function potion_col(r) return ICOL[r[2]] end      -- the middle of the sorted three is the main ingredient

function save_point()
  checkpoint({ mode = mode, s1 = score[1], s2 = score[2], time = time_left, best = best })
end

-- ---------------------------------------------------------------- using things
function facing(p)
  local tx, ty = (p.x + p.fx * 12) // 16, (p.y + p.fy * 12) // 16
  return ST[ty * GW + tx + 1]
end

function use(p)
  local s = facing(p)
  if not s then return end
  local h = p.hold
  local px, py = s.tx * 16 + 8, TOP + s.ty * 16 + 8
  local ok = false
  if s.ch == "M" or s.ch == "H" or s.ch == "B" then
    local t = s.ch == "M" and 1 or (s.ch == "H" and 2 or 3)
    if not h then p.hold = { k = "ing", t = t }; ok = true
    elseif h.k == "ing" and h.t == t then p.hold = nil; ok = true end
  elseif s.ch == "c" then
    p.hold, s.item = s.item, h
    ok = h ~= nil or p.hold ~= nil
  elseif s.ch == "X" then
    if h then p.hold = nil; ok = true; burst(px, py, 30, 6) end
  elseif s.ch == "C" then
    if h and h.k == "ing" and #s.items < 3 and s.over == 0 then
      s.items[#s.items + 1] = h.t
      p.hold = nil
      ok = true
      if #s.items == 3 then table.sort(s.items); sfx("C3", 3, 0.3, 10, nil, pan(px)) end
      burst(px, py - 4, ICOL[h.t], 5)
    elseif not h and #s.items > 0 and (#s.items < 3 or s.prog >= BREW) then
      -- brewed: a potion. Not full yet, or burnt: sludge for the bin.
      p.hold = { k = "pot", r = s.items, bad = #s.items < 3 or s.over >= BURN }
      s.items, s.prog, s.over = {}, 0, 0
      ok = true
    end
  elseif s.ch == "W" then
    if h and h.k == "pot" then
      p.hold = nil
      ok = true
      serve(p, h, px, py)
    end
  end
  if ok then sfx("A4", 4, 0.25, 4, nil, pan(px)) else sfx("C3", 0, 0.12, 4, nil, pan(px)) end
end

function serve(p, pot, px, py)
  local o = ORD[p.team]
  local hit
  if not pot.bad then
    for i, c in ipairs(o.list) do
      if key(c.r) == key(pot.r) and (not hit or c.t < o.list[hit].t) then hit = i end   -- the most impatient match
    end
  end
  if not hit then
    score[p.team] = math.max(0, score[p.team] - 5)
    o.streak = 0
    float(px, py - 10, "-5", 26)
    sfx("C3", 2, 0.35, 12, nil, pan(px), -80)
    return
  end
  local c = table.remove(o.list, hit)
  local pay = 20 + math.floor(10 * c.t / PATIENCE) + 5 * math.min(o.streak, 4)
  o.streak, o.served = o.streak + 1, o.served + 1
  score[p.team] = score[p.team] + pay
  float(px, py - 10, "+" .. pay, 27)
  burst(px, py, 27, 10)
  sfx("E5", 1, 0.35, 5) sfx("A5", 1, 0.35, 10)
  save_point()
end

-- ---------------------------------------------------------------- update
function walk(p)
  local n = p.pl
  local mx = (btn("right", n) and 1 or 0) - (btn("left", n) and 1 or 0)
  local my = (btn("down", n) and 1 or 0) - (btn("up", n) and 1 or 0)
  if p.cd > 0 then p.cd = p.cd - 1 end
  if edge[n].b and p.cd == 0 and (mx ~= 0 or my ~= 0) then
    p.dash_t, p.cd = 9, 34
    sfx("C4", 3, 0.2, 5, nil, pan(p.x))
  end
  local sp = SPEED
  if p.dash_t > 0 then p.dash_t = p.dash_t - 1; sp = DASH end
  if mx ~= 0 and my ~= 0 then sp = sp * 0.75 end
  local bx, by = false, false
  if mx ~= 0 then
    local nx = p.x + mx * sp
    local ex = nx + mx * 5
    if solid(ex, p.y - 5) or solid(ex, p.y + 5) then bx = true else p.x = nx end
  end
  if my ~= 0 then
    local ny = p.y + my * sp
    local ey = ny + my * 5
    if solid(p.x - 5, ey) or solid(p.x + 5, ey) then by = true else p.y = ny end
  end
  -- face the way you walk; walking into something turns you to it
  if mx ~= 0 and (my == 0 or bx) then p.fx, p.fy = mx, 0
  elseif my ~= 0 and (mx == 0 or by) then p.fx, p.fy = 0, my end
  p.walk = (mx ~= 0 or my ~= 0) and p.walk + 1 or 0
  if edge[n].a then use(p) end
  p.stir = false
  if btn("x", n) and not p.hold then
    local s = facing(p)
    if s and s.ch == "C" and #s.items == 3 and s.prog < BREW then s.stir = s.stir + 1; p.stir = true end
  end
end

function cauldrons()
  for _, s in ipairs(CAULS) do
    local px, py = s.tx * 16 + 8, TOP + s.ty * 16 + 8
    if #s.items == 3 then
      if s.prog < BREW then
        s.prog = s.prog + 1 + s.stir * STIR
        if s.prog >= BREW then s.prog = BREW; sfx("G5", 4, 0.35, 8, nil, pan(px)) sfx("C6", 4, 0.3, 14, nil, pan(px)) end
      elseif s.over < BURN then
        s.over = s.over + 1
        if s.over > BURN - 180 and s.over % 20 == 0 then sfx("A5", 0, 0.15, 3, nil, pan(px)) end
        if s.over == BURN then sfx("C3", 3, 0.4, 20, nil, pan(px)) burst(px, py - 4, 30, 10) end
      end
    end
    s.stirred, s.stir = s.stir > 0, 0
  end
end

function orders()
  local most = mode == 2 and 3 or 4
  for tm = 1, teams do
    local o = ORD[tm]
    for i = #o.list, 1, -1 do
      local c = o.list[i]
      c.t = c.t - 1
      if c.t <= 0 then
        table.remove(o.list, i)
        score[tm] = math.max(0, score[tm] - 10)
        o.streak = 0
        shake = 10
        sfx("C3", 2, 0.35, 14, nil, 0, -40)
        float(mode == 2 and (tm == 1 and 50 or 270) or 100, TOP + 6, "-10", 26)
      end
    end
    o.wait = o.wait - 1
    if o.wait <= 0 and #o.list < most and o.n < #SEQ then
      o.n = o.n + 1
      o.list[#o.list + 1] = { r = SEQ[o.n], t = PATIENCE }
      -- the next one comes sooner as the shift goes on, and sooner for bigger crews
      local k = math.max(1, mode == 2 and math.min(size[1], size[2]) or size[1])
      o.wait = math.floor(math.max(420, 900 - o.n * 24) / (0.6 + 0.4 * k))
      sfx("E5", 4, 0.2, 5)
    elseif o.wait <= 0 then o.wait = 30 end
  end
end

function _update()
  gt = gt + 1
  read_pads()
  for i = #fx, 1, -1 do
    local p = fx[i]
    p.x, p.y, p.vy, p.t = p.x + p.vx, p.y + p.vy, p.vy + 0.1, p.t - 1
    if p.t <= 0 then table.remove(fx, i) end
  end
  for i = #fl, 1, -1 do
    local f = fl[i]
    f.y, f.t = f.y - 0.4, f.t - 1
    if f.t <= 0 then table.remove(fl, i) end
  end
  if shake > 0 then shake = shake - 1 end
  if state == "pick" then
    pick_t = pick_t + 1
    if any_edge("left") then sel = sel == 1 and #MODES or sel - 1; sfx("E5", 0, 0.15, 3) end
    if any_edge("right") then sel = sel % #MODES + 1; sfx("E5", 0, 0.15, 3) end
    if any_edge("a") and pick_t > 10 then
      sfx("C5", 4, 0.3, 6)
      start(sel)
      save_point()
    end
    return
  end
  state_t = state_t + 1
  if state == "ready" then
    if state_t > 80 then state = "play"; sfx("G5", 1, 0.35, 10) end
    return
  end
  if state == "over" then
    if state_t > 60 then
      if any_edge("a") then start(mode); save_point()
      elseif any_edge("b") and NP > 1 then state, pick_t = "pick", 0 end
    end
    return
  end
  for _, p in ipairs(P) do walk(p) end
  cauldrons()
  orders()
  time_left = time_left - 1
  if time_left <= 600 and time_left % 60 == 0 and time_left > 0 then sfx("A4", 0, 0.2, 4) end
  if time_left <= 0 then
    state, state_t = "over", 0
    sfx("C5", 1, 0.4, 8) sfx("E5", 1, 0.4, 16) sfx("G5", 1, 0.4, 30)
    if mode == 1 then
      if score[1] > best then best = score[1] end
      if score[1] >= target then game_win("The crew earned " .. score[1] .. " coins in one shift (target " .. target .. ")!") end
    else
      winner = score[1] > score[2] and 1 or (score[2] > score[1] and 2 or 0)
      if winner ~= 0 then game_win(tr(winner == 1 and "The left kitchen wins, %d coins to %d!" or "The right kitchen wins, %d coins to %d!", score[winner], score[3 - winner])) end
    end
    checkpoint({ mode = mode, best = best })
  end
end

function team_name(tm) return tm == 1 and "The left" or "The right" end

-- ---------------------------------------------------------------- drawing (never calls rnd)
function draw_item(it, x, y)
  if it.k == "ing" then spr(it.t, x - 4, y - 4)
  else
    pal(5, it.bad and 30 or potion_col(it.r))
    spr(4, x - 4, y - 4)
    pal()
    if not it.bad then for i = 1, 3 do rectfill(x - 5 + (i - 1) * 4, y - 8, 3, 3, ICOL[it.r[i]]) end end
  end
end

function draw_kitchen()
  for ty = 0, GH - 1 do
    for tx = 0, GW - 1 do
      local ch = G[ty * GW + tx + 1]
      local x, y = tx * 16, TOP + ty * 16
      local cool = mode == 2 and tx >= GW // 2
      if ch == "." then
        rectfill(x, y, 16, 16, (tx + ty) % 2 == 0 and (cool and 20 or 8) or (cool and 19 or 7))
      elseif ch == "#" then
        rectfill(x, y, 16, 16, 30) rectfill(x, y, 16, 3, 28) rectfill(x, y + 15, 16, 1, 31)
      else
        local s = ST[ty * GW + tx + 1]
        rectfill(x, y, 16, 16, 8) rectfill(x + 1, y + 1, 14, 13, 9)
        if ch == "c" then
          rectfill(x + 1, y + 1, 14, 13, 10) rectfill(x + 1, y + 1, 14, 2, 11)
          if s.item then draw_item(s.item, x + 8, y + 9) end
        elseif ch == "M" or ch == "H" or ch == "B" then
          rectfill(x + 2, y + 2, 12, 11, 7)
          spr(ch == "M" and 1 or (ch == "H" and 2 or 3), x + 4, y + 4)
        elseif ch == "X" then
          rectfill(x + 1, y + 1, 14, 13, 28) rectfill(x + 4, y + 4, 8, 8, 1) rect(x + 3, y + 3, 10, 10, 29)
        elseif ch == "W" then
          local c = mode == 2 and (s.team == 1 and 10 or 21) or 27
          rectfill(x + 1, y + 1, 14, 14, 12) rect(x, y, 16, 16, c)
          circfill(x + 8, y + 8, 3, 27) rectfill(x + 5, y + 11, 7, 2, 10)      -- the bell
        elseif ch == "C" then
          rectfill(x, y, 16, 16, 28) rectfill(x, y, 16, 2, 29)
          if #s.items == 3 and (gt // 5) % 2 == 0 then rectfill(x + 3, y + 13, 10, 3, s.over >= BURN and 30 or 10) rectfill(x + 5, y + 14, 6, 2, 27) end
          circfill(x + 8, y + 7, 7, 31) circ(x + 8, y + 7, 7, 1)
          if #s.items > 0 then
            local c = s.over >= BURN and 30 or (#s.items == 3 and ICOL[s.items[2]] or 29)
            circfill(x + 8, y + 7, 5, c)
            if #s.items == 3 and s.over < BURN then                              -- bubbles
              pset(x + 6 + (gt // 7) % 5, y + 5 + (gt // 11) % 4, 13)
              if s.stirred then line(x + 8, y + 7, x + 8 + math.cos(gt / 4) * 5, y + 7 + math.sin(gt / 4) * 4, 12) end
            end
          else circfill(x + 8, y + 7, 5, 1) end
        end
      end
    end
  end
  -- what is in each cauldron, and how far along it is
  for _, s in ipairs(CAULS) do
    local x, y = s.tx * 16, TOP + s.ty * 16
    local up = s.ty > 6 and -1 or 1                    -- cards sit on the kitchen side of the cauldron
    local cy = y + (up < 0 and -13 or 17)
    if #s.items > 0 then
      rectfill(x - 6, cy, 28, 11, 1)
      for i, t in ipairs(s.items) do spr(t, x - 5 + (i - 1) * 9, cy + 1) end
      if #s.items == 3 then
        local by = cy + (up < 0 and -4 or 12)
        rectfill(x - 6, by, 28, 3, 1)
        if s.prog < BREW then rectfill(x - 5, by + 1, 26 * s.prog / BREW, 1, 27)
        elseif s.over >= BURN then rectfill(x - 5, by + 1, 26, 1, 30)
        else
          rectfill(x - 5, by + 1, 26 * (1 - s.over / BURN), 1, s.over > BURN - 180 and ((gt // 6) % 2 == 0 and 26 or 13) or 17)
          if (gt // 20) % 2 == 0 then text("!", x + 4, cy + (up < 0 and -14 or 16), s.over > BURN - 180 and 26 or 17) end
        end
      end
    end
  end
end

function draw_cook(p)
  local x, y = p.x, TOP + p.y
  local s = facing(p)
  if s and state == "play" then rect(s.tx * 16, TOP + s.ty * 16, 16, 16, PC[p.pl]) end
  rectfill(x - 5, y + 5, 10, 2, 1)
  pal(4, PC[p.pl]) pal(3, PD[p.pl])
  local bob = p.walk > 0 and (p.walk // 6) % 2 or 0
  spr(16, x - 8, y - 11 - bob, 2, 2, p.fx < 0)
  pal()
  if p.dash_t > 0 then line(x - p.fx * 8, y, x - p.fx * 14, y, 13) line(x - p.fy * 0, y - p.fy * 8, x, y - p.fy * 14, 13) end
  if p.hold then draw_item(p.hold, x + p.fx * 7, y - 2 + p.fy * 5 - (p.fy == 0 and 3 or 0)) end
  if p.stir then text("~", x - 4, y - 22 + (gt // 5) % 2, 13) end
  if (ME or 0) == p.pl then text("v", x - 4, y - 24 + (gt // 12) % 2, 13)
  elseif NP > 1 and state == "ready" then local nm = player_name(p.pl, 6) text(nm, x - #nm * 4, y - 22, PC[p.pl]) end
end

function draw_card(c, x, w)
  rectfill(x, 2, w, 26, 12) rect(x, 2, w, 26, 9)
  local step = w >= 40 and 12 or 9
  for i = 1, 3 do spr(c.r[i], x + (w - step * 3) // 2 + (i - 1) * step + (step - 8) // 2, 6) end
  local f = c.t / PATIENCE
  rectfill(x + 3, 19, w - 6, 5, 30)
  rectfill(x + 3, 19, (w - 6) * f, 5, f > 0.5 and 16 or (f > 0.25 and 27 or 26))
end

function draw_hud()
  rectfill(0, 0, 320, TOP, 1)
  local s = math.max(0, time_left) // 60
  local clock = string.format("%d:%02d", s // 60, s % 60)
  if mode == 1 then
    for i, c in ipairs(ORD[1].list) do draw_card(c, 3 + (i - 1) * 46, 43) end
    text(clock, 276, 4, s <= 10 and 26 or 13)
    local sc = score[1] .. "/" .. target
    text(sc, 316 - #sc * 8, 14, score[1] >= target and 17 or 27)
    text("coins", 276, 23, 29)
    if ORD[1].streak > 1 then text("x" .. ORD[1].streak, 196, 12, 10) end
  else
    for i, c in ipairs(ORD[1].list) do draw_card(c, 2 + (i - 1) * 32, 30) end
    for i, c in ipairs(ORD[2].list) do draw_card(c, 288 - (i - 1) * 32, 30) end
    ctext(clock, 3, s <= 10 and 26 or 13)
    text(tostring(score[1]), 156 - #tostring(score[1]) * 8, 15, 10) text(":", 156, 15, 13) text(tostring(score[2]), 166, 15, 21)
  end
end

function _draw()
  cls(1)
  if shake > 0 then camera((gt % 2) * 2 - 1, 0) end
  draw_kitchen()
  -- cooks further down the screen are drawn over the ones further up
  local order = {}
  for i, p in ipairs(P) do order[i] = p end
  table.sort(order, function(a, b) if a.y ~= b.y then return a.y < b.y end return a.pl < b.pl end)
  for _, p in ipairs(order) do draw_cook(p) end
  for _, p in ipairs(fx) do rectfill(p.x, p.y, 2, 2, p.c) end
  for _, f in ipairs(fl) do text(f.s, f.x - #f.s * 4 + 1, f.y + 1, 1) text(f.s, f.x - #f.s * 4, f.y, f.c) end
  camera()
  draw_hud()
  if state == "pick" then
    rectfill(32, 76, 256, 104, 1) rect(32, 76, 256, 104, 13)
    stext("PICK A GAME", 84, 27, 2)
    for i, m in ipairs(MODES) do
      local x = 48 + (i - 1) * 116
      rectfill(x, 110, 108, 26, i == sel and 8 or 2)
      rect(x, 110, 108, 26, i == sel and 13 or 30)
      local mn = tr(m[1]) text(mn, x + 54 - #mn * 4, 119, i == sel and 27 or 29)
    end
    ctext(MODES[sel][2], 144, 13)
    ctext(NP .. " players", 156, 29)
    ctext("left / right: pick    A: play", 168, 29)
  elseif state == "ready" then
    stext(mode == 1 and "SHIFT STARTS" or "KITCHEN DUEL", 100, 27, 2)
    ctext(mode == 1 and "Earn " .. target .. " coins!" or "Most coins wins!", 124, 13)
  elseif state == "over" then
    rectfill(40, 76, 240, 88, 1) rect(40, 76, 240, 88, 13)
    if mode == 1 then
      stext(score[1] >= target and "GREAT SHIFT!" or "SHIFT OVER", 86, score[1] >= target and 17 or 27, 2)
      ctext(score[1] .. " coins (target " .. target .. ", best " .. best .. ")", 112, 13)
      ctext(ORD[1].served .. " potions served", 124, 29)
    else
      stext(winner == 0 and "A DRAW!" or (winner == 1 and "LEFT KITCHEN WINS" or "RIGHT KITCHEN WINS"), 86, 27, winner == 0 and 2 or 1)
      ctext(score[1] .. " : " .. score[2], 108, 13, 2)
    end
    if state_t > 60 then ctext(NP > 1 and "A: again   B: pick a game" or "A: another shift", 146, 29) end
  end
end

-- the title screen (game{title_draw = ...}): ingredients drop into a big cauldron, and the brew
-- changes colour with every third one. It only draws, from the frame count t.
function draw_title(t)
  cls(2)
  for y = 0, 11 do for x = 0, 10 do                                  -- the stone wall
    rect(x * 32 - (y % 2) * 16, y * 16, 33, 17, 1)
  end end
  rectfill(0, 196, 320, 44, 6) rectfill(0, 196, 320, 2, 7)           -- the floor
  local cx, cy = 74, 158
  local n = t // 50                                                  -- one ingredient every 50 frames
  local c = ICOL[(n // 3) % 3 + 1]
  for i = 0, 4 do                                                    -- the fire
    local h = 8 + ((t // 4 + i * 3) % 5) * 3
    rectfill(cx - 30 + i * 13, 204 - h, 9, h, i % 2 == 0 and 10 or 27)
  end
  circfill(cx, cy, 47, 30) circfill(cx, cy, 45, 1)
  rectfill(cx - 47, cy - 47, 95, 23, 2)                              -- cut the top off: the cauldron's mouth
  for x = 0, 10 do rect(x * 32 - 16, 112, 33, 17, 1) end
  rectfill(cx - 44, cy - 26, 89, 8, 30) rectfill(cx - 40, cy - 24, 81, 5, c)
  circfill(cx - 22, cy + 4, 5, 31) rectfill(cx - 26, cy - 4, 3, 9, 31)   -- a shine on its belly
  for i = 0, 4 do                                                    -- bubbles rise and pop
    local life = (t + i * 17) % 60
    circ(cx - 32 + i * 16 + math.sin((t + i * 40) / 12) * 3, cy - 30 - life * 0.9, 2 + i % 3, life > 50 and 13 or c)
  end
  -- the next ingredient falls in with a splash
  local f = (t % 50) / 50
  local kind = n % 3 + 1
  if f < 0.6 then spr(kind, cx - 12, 60 + f * f * 200, 1, 1, false, false, 3)
  else for i = 0, 5 do pset(cx + (i - 2.5) * (f - 0.6) * 60, cy - 28 - math.sin((f - 0.6) * 7.85) * (10 + i * 2), ICOL[kind]) end end
  -- a cook waits with the next order
  pal(4, PC[(n // 3) % 8 + 1]) pal(3, PD[(n // 3) % 8 + 1])
  spr(16, 110, 150 - (t // 20) % 2, 2, 2, true, false, 2)
  pal()
end
-- this game's words in other languages (the Bit's language, LANGUAGE in Settings; runtime/bk_lang.lua)
texts{
  de = {
    ["Earn the shift's target in coins, or out-brew the other team's kitchen."] = "Verdien das Münzziel der Schicht, oder braue mehr als die Küche des anderen Teams.",
    ["D-pad: walk. A: pick up, put down or use what you face. B: dash."] = "Steuerkreuz: laufen. A: aufheben, ablegen oder benutzen, was vor dir ist. B: sprinten.",
    ["Put 3 ingredients in a cauldron. Hold X next to it to stir: it brews faster."] = "Leg 3 Zutaten in einen Kessel. Halt X daneben zum Umrühren: dann braut es schneller.",
    ["Take the finished potion (A) to the window. It must match an order card."] = "Bring den fertigen Trank (A) zum Fenster. Er muss zu einer Bestellkarte passen.",
    ["Potions left on the fire burn. Burnt or wrong potions go in the bin."] = "Tränke auf dem Feuer brennen an. Verbrannte oder falsche kommen in den Eimer.",
    ["Fast service tips more, and a streak of right orders adds a bonus."] = "Schneller Service bringt mehr Trinkgeld, und eine Serie richtiger Bestellungen einen Bonus.",
    ["Shift minutes"] = "Minuten pro Schicht",
    ["ONE KITCHEN"] = "EINE KÜCHE",
    ["Together: earn the target."] = "Zusammen: erreicht das Ziel.",
    ["TEAMS"] = "TEAMS",
    ["Two kitchens. Most coins wins."] = "Zwei Küchen im Duell.",
    ["The crew earned # coins in one shift (target #)!"] = "Die Crew hat in einer Schicht # Münzen verdient (Ziel #)!",
    ["The left kitchen wins, %d coins to %d!"] = "Die linke Küche gewinnt, %d zu %d Münzen!",
    ["The right kitchen wins, %d coins to %d!"] = "Die rechte Küche gewinnt, %d zu %d Münzen!",
    ["coins"] = "Münzen",
    ["PICK A GAME"] = "WÄHL EIN SPIEL",
    ["# players"] = "# Spieler",
    ["left / right: pick    A: play"] = "Wahl: links/rechts  A: spielen",
    ["SHIFT STARTS"] = "SCHICHTBEGINN",
    ["KITCHEN DUEL"] = "KÜCHENDUELL",
    ["Earn # coins!"] = "Verdient # Münzen!",
    ["Most coins wins!"] = "Die meisten Münzen gewinnen!",
    ["GREAT SHIFT!"] = "SUPER SCHICHT!",
    ["SHIFT OVER"] = "SCHICHT VORBEI",
    ["# coins (target #, best #)"] = "# Münzen (Ziel #, Rekord #)",
    ["# potions served"] = "# Tränke serviert",
    ["A DRAW!"] = "UNENTSCHIEDEN!",
    ["LEFT KITCHEN WINS"] = "LINKE KÜCHE GEWINNT",
    ["RIGHT KITCHEN WINS"] = "RECHTE KÜCHE GEWINNT",
    ["A: again   B: pick a game"] = "A: nochmal   B: anderes Spiel",
    ["A: another shift"] = "A: noch eine Schicht",
  },
}
`;

  // ---- sprites: 1 mushroom, 2 herb, 3 berry, 4 flask (colour 5 = the potion), 16 the cook (4 / 3 = hat colours)
  const K = { '.': 0, o: 1, r: 26, R: 25, w: 13, s: 12, g: 17, G: 15, b: 21, B: 20, l: 23, p: 5, h: 4, H: 3, f: 11, e: 1, n: 29, y: 27, k: 31, t: 7 };
  const ART = {
    1: ['..rrrr..', '.rrwrrr.', 'rrrrrwrr', 'rwrrrrrr', '.RRRRRR.', '...ss...', '...ss...', '..ssss..'],
    2: ['...g....', '..ggg.g.', '.gGgggg.', '..gGgGg.', '.gggGg..', '..gGgg..', '...G....', '...G....'],
    3: ['....G...', '...G.G..', '..bb.bb.', '.bblbblb', '.bbbbbbb', '..bbbBb.', '...bbB..', '....B...'],
    4: ['...nn...', '...ww...', '...ww...', '..wllw..', '.wppppw.', '.wppppw.', '.wppppw.', '..wwww..'],
    16: [
      '.......hh.......',
      '......hhhh......',
      '.....hhhhH......',
      '.....hhhhH......',
      '....hhhhhHH.....',
      '....yyyyyyy.....',
      '..hhhhhhhhHHH...',
      '.hhhhhhhhhhHHH..',
      '....ffffff......',
      '....fefffe......',
      '....ffffff......',
      '...hhhhhhHH.....',
      '..fhhhhyhHHf....',
      '...hhhhhhHH.....',
      '...hhhhhhHH.....',
      '....tt..tt......',
    ],
    64: [   // the icon: a bubbling cauldron
      '.....b......r...',
      '...g....b.......',
      '......g....g....',
      '..kkkkkkkkkkkk..',
      '.kkggggggggggkk.',
      '..kkkkkkkkkkkk..',
      '..kkkkkkkkkkkk..',
      '.kkknkkkkkkkkkk.',
      '.kknkkkkkkkkkkk.',
      '.kknkkkkkkkkkkk.',
      '.kkkkkkkkkkkkkk.',
      '..kkkkkkkkkkkk..',
      '...kkkkkkkkkk...',
      '..k.ryyrryyr.k..',
      '....rryyyyrr....',
      '................',
    ],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const t = +n + (y >> 3) * 16 + (x >> 3);
        cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
      }));
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'cauldron', anims: [{ name: 'idle', frames: [64], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Kitchen', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Cauldron Crew', code, buildGfx,
    about: 'A potion kitchen for 1-8 players: fill the orders together in one kitchen, or race another team\'s kitchen.' });
})();
