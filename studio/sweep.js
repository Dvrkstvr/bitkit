/* Demo cart "Sweep Storm": a minesweeper battle royale for 1-20 Bits. Original art and code. MIT License. */
(function () {
  const code = `-- Sweep Storm: a minesweeper battle royale for up to 20 Bits (bots fill the empty spots)
-- One big round island, made from a shared random seed. Everyone digs at the same time.
-- The middle has more mines, more points and stronger power-ups. A storm closes in from the
-- shore, so sooner or later you have to dig your way to the middle.
--   D-pad: walk over dug ground and aim at the next cell     A: dig     B: flag
--   X: use your power-up     hold Y: map of the island     Start: pause
-- A mine costs a heart and stuns you. Lose all 3 hearts and you're out.
-- Multiplayer uses network events (net_send / net_recv), not lockstep: each Bit runs its own
-- player and tells the others what it dug, so 20 Bits can play together over ESP-NOW.

T0, TS = 64, 96                      -- tile bases: normal cells, cells in the storm
K_HID, K_FLAG, K_OPEN, K_BLOWN, K_WATER = 0, 3, 6, 15, 16
EV_HELLO, EV_START, EV_ROSTER, EV_OPEN, EV_STATE, EV_TRICK = 1, 2, 3, 4, 5, 7
MAXP = 20
PCOL = { 27, 22, 26, 18, 5, 10, 23, 13, 25, 16, 4, 11, 21, 17, 9, 12, 3, 29, 20, 8 }
DENS = { 16, 20, 25 }                -- mines per 100 cells: shore, middle ring, core
ITEMD = { 15, 25, 40 }               -- power-ups per 1000 safe cells
ZPTS = { 1, 2, 4 }                   -- points per cell you dig
ZNAME = { "shore", "middle", "core" }
ITEMS = {                            -- spr = tile number
  { name = "Shield", spr = 128, info = "the next mine can't hurt you" },
  { name = "Scan",   spr = 129, info = "flags every mine next to you" },
  { name = "Heart",  spr = 130, info = "+1 heart" },
  { name = "Sonar",  spr = 131, info = "flags mines in a wide circle" },
  { name = "Blast",  spr = 132, info = "digs every safe cell around you" },
  { name = "Confuse", spr = 133, info = "throw it: rivals there see wrong numbers" },
  { name = "Paint",   spr = 134, info = "throw it: hides the numbers there" },
}
POOL = { { 1, 1, 2, 3 }, { 1, 2, 3, 4, 4, 7 }, { 4, 5, 5, 6, 6, 7, 1 } }   -- power-ups found in each zone
-- Confuse and Paint are thrown at the nearest rival (or dropped where you stand) and leave a patch
-- on the island. Everyone but the thrower sees scrambled or hidden numbers there for a while.
TRICK = { [6] = { r = 4, len = 60 * 10 }, [7] = { r = 4, len = 60 * 18 } }
THROW = 12                           -- how far (cells) a trick flies to find a rival
MATCH_LEN = 60 * 60 * tune("Match length (minutes)", 4, 2, 10)   -- frames. tune(): a slider on the Game tab
STORM_AT, STORM_END = MATCH_LEN // 6, MATCH_LEN * 11 // 12   -- 0:40 and 3:40 of a four minute match
STORM_HIT = 150                      -- frames in the storm per lost heart
STUN = tune("Stun time (frames)", 100, 30, 300, 10)
DX = { -1, 0, 1, -1, 1, -1, 0, 1 }
DY = { -1, -1, -1, 0, 0, 1, 1, 1 }

-- the title screen (game{title_draw = ...}): the island seen from above, dug a little more every second
-- while the storm closes in, with rain and lightning
function draw_title(t)
  cls(19)
  local cyc = t % 720
  local sr = 10.5 - cyc / 720 * 7                             -- the storm's edge, in cells
  for gy = 0, 14 do for gx = 0, 19 do
    local dx, dy = gx - 9.5, gy - 7
    local d = math.sqrt(dx * dx + dy * dy)
    local n = 80                                               -- water
    if d < 8.3 + math.sin(gx * 1.3 + gy * 0.7) * 0.9 then
      local h = (gx * 7 + gy * 13 + gx * gy * 3) % 31
      if (h * 29) % 720 < cyc * 1.1 then                       -- dug: a number, or a blown mine
        local num = (gx * 3 + gy * 5 + gx * gy) % 5
        n = h == 3 and 79 or 70 + num
      else
        local z = d < 3 and 2 or (d < 5.5 and 1 or 0)
        n = (h % 9 == 4) and 67 + z or 64 + z                  -- hidden, or flagged
      end
    elseif ((gx + gy * 3 + t // 30) % 11) == 0 then n = 80 end
    if d > sr then n = n + 32 end                               -- in the storm
    spr(n, gx * 16, gy * 16, 1, 1, false, false, 2)
  end end
  circ(160, 120, sr * 16 + 4, 5) circ(160, 120, sr * 16 + 6, 3)
  local cols = { 26, 21, 17, 27, 5 }
  for k = 1, 5 do                                             -- diggers heading for the middle
    local a = t / (70 + k * 11) + k * 1.3
    local r = 16 + (k * 13) % 50 + math.sin(t / 50 + k) * 8
    local x = (160 + math.cos(a) * r) // 16 * 16
    local y = (120 + math.sin(a) * r * 0.8) // 16 * 16
    rect(x - 1, y - 1, 18, 18, cols[k])
    if (t // 8 + k) % 2 == 0 then rect(x - 2, y - 2, 20, 20, 13) end
  end
  for i = 0, 70 do                                            -- rain
    local x, y = (i * 53 + t * 2) % 340 - 10, (i * 97 + t * 6) % 260 - 10
    line(x, y, x - 2, y + 6, 22)
  end
  local fl = t % 300
  if fl < 10 then                                             -- lightning
    local x = 40 + (t // 300 * 97) % 240
    local y = 0
    while y < 150 do
      local nx, ny = x + ((y * 7 + t // 300) % 19) - 9, y + 14
      line(x, y, nx, ny, 13) line(x + 1, y, nx + 1, ny, 23)
      x, y = nx, ny
    end
    if fl < 3 then tint(13, 0.35) end
  end
end

function _init()
  game{
    title = "Sweep Storm",
    players = {1, 20},                -- net_send: every Bit plays its own copy
    title_draw = draw_title,          -- its own animated title screen (above)
    look = { title = 27, shadow = 1, panel = 1, edge = 5, hi = 3, text = 13, pick = 27, goal = 22, footer = 29 },
    goal = "Dig the most ground before the storm closes in. The middle is worth more.",
    help = {
      "D-pad: walk over dug ground and aim at the next cell. A: dig. B: flag a mine.",
      "Numbers tell how many mines touch that cell. A mine costs a heart and stuns you.",
      "X: use your power-up. Hold Y: island map.",
      "Confuse and Paint fly at the nearest rival: for a while they see wrong numbers or none there.",
      "Shore cells are worth 1, the middle ring 2, the core 4. Power-ups get stronger towards the middle.",
      "The storm shrinks the island. Standing in it costs hearts.",
      "Fog covers the island and you can only walk where you can see. Digging clears the fog around what you dig, and so does standing on dug ground.",
      "Up to 20 Bits nearby can join the same match. Bots fill the empty spots.",
    },
    settings = { { key = "skill", name = "Bot skill", values = { "Easy", "Normal", "Hard" }, value = 2 },
                 { key = "fog", name = "Fog of war", values = { "On", "Off" }, value = 1 } },
    continue = function(cp) if not (cp and resume(cp)) then to_lobby() end end,
    new_game = function() to_lobby() end,
  }
  scene = "lobby"
  to_lobby()
end

-- ============================================================ lobby
function to_lobby()
  scene = "lobby"
  peers, pending = {}, nil
  bots = bots or 11
  camera()
end

function lobby_ids()
  local ids = { NET_ID }
  for id, p in pairs(peers) do if t() - p.seen < 180 then ids[#ids + 1] = id end end
  table.sort(ids)
  return ids
end

function lobby_update()
  if NET_ID > 0 and t() % 30 == 0 then net_send(EV_HELLO) end
  local nh = NET_ID > 0 and #lobby_ids() or 1
  bots = math.max(0, math.min(MAXP - nh, bots))
  if btnp("left") then bots = math.max(0, bots - 1); sfx("E5", 0, 0.2, 3) end
  if btnp("right") then bots = math.min(MAXP - nh, bots + 1); sfx("E5", 0, 0.2, 3) end
  if btnp("up") then bots = math.min(MAXP - nh, bots + 5) end
  if btnp("down") then bots = math.max(0, bots - 5) end
  if btnp("a") then host_start() end
end

function host_start()
  local ids = NET_ID > 0 and lobby_ids() or { 0 }
  local seed = (clock() * 7919 + NET_ID * 131 + t() * 17) % 1000000000
  local token = (seed * 31 + NET_ID) % 999983
  if NET_ID > 0 then
    net_send(EV_START, token, seed, #ids, bots)
    for k = 1, #ids, 5 do
      net_send(EV_ROSTER, token, k, ids[k], ids[k + 1] or 0, ids[k + 2] or 0, ids[k + 3] or 0, ids[k + 4] or 0)
    end
  end
  start_match(seed, ids, bots, NET_ID)
end

function lobby_event(from, ev, a, b, c, d, e, f, g)
  if ev == EV_HELLO then
    peers[from] = { seen = t() }
  elseif ev == EV_START then
    pending = { token = a, seed = b, nh = c, nb = d, from = from, ids = {}, got = 0 }
  elseif ev == EV_ROSTER and pending and pending.token == a and from == pending.from then
    local list = { c, d, e, f, g }
    for k = 0, 4 do
      if b + k <= pending.nh and not pending.ids[b + k] then pending.ids[b + k] = list[k + 1]; pending.got = pending.got + 1 end
    end
    if pending.got >= pending.nh then
      local p = pending
      pending = nil
      for _, id in ipairs(p.ids) do
        if id == NET_ID then start_match(p.seed, p.ids, p.nb, p.from) return end
      end
    end
  end
end

-- ============================================================ the island
function idx(x, y) return y * S + x + 1 end
function onmap(x, y) return x >= 0 and y >= 0 and x < S and y < S end

function generate(seed, n)
  srand(seed)
  R = math.max(16, math.min(40, 14 + n * 13 // 10))
  S = 2 * R + 3
  C = R + 1
  land, mine, num, op, zone, item, flag = {}, {}, {}, {}, {}, {}, {}
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      local i, dx, dy = idx(x, y), x - C, y - C
      local d2 = dx * dx + dy * dy
      land[i] = d2 <= R * R + R
      zone[i] = d2 * 10000 < (34 * R) ^ 2 and 3 or (d2 * 10000 < (68 * R) ^ 2 and 2 or 1)
      mine[i] = land[i] and rnd(100) <= DENS[zone[i]]
      op[i], num[i] = 0, 0
      if land[i] and not mine[i] and rnd(1000) <= ITEMD[zone[i]] then
        local pool = POOL[zone[i]]
        item[i] = pool[rnd(#pool)]
      end
    end
  end
  -- spawn points: evenly round the shore, each with a mine-free patch
  spawns = {}
  local a0 = rnd(360)
  for k = 1, n do
    local a = (a0 + (k - 1) * 360 / n) * math.pi / 180
    local sx, sy = C + math.floor(math.cos(a) * (R - 3) + 0.5), C + math.floor(math.sin(a) * (R - 3) + 0.5)
    spawns[k] = { x = sx, y = sy }
    for y = sy - 2, sy + 2 do for x = sx - 2, sx + 2 do
      if onmap(x, y) then mine[idx(x, y)] = false end
    end end
  end
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      local i, c = idx(x, y), 0
      for k = 1, 8 do
        local nx, ny = x + DX[k], y + DY[k]
        if onmap(nx, ny) and mine[idx(nx, ny)] then c = c + 1 end
      end
      num[i] = c
    end
  end
  SR = R + 2
  for y = 0, 127 do for x = 0, 255 do mset(x, y, 0) end end
  for i = 1, S * S do settile(i) end
  for k = 1, n do open_cell(spawns[k].x, spawns[k].y, 0, true) end
end

function instorm(x, y)
  local dx, dy = x - C, y - C
  return dx * dx + dy * dy > SR * SR + SR
end

function settile(i)
  local x, y = (i - 1) % S, (i - 1) // S
  local k
  if not land[i] then k = K_WATER
  elseif op[i] == 0 then k = (flag[i] and K_FLAG or K_HID) + zone[i] - 1
  elseif op[i] == 2 then k = K_BLOWN
  else k = K_OPEN + num[i] end
  mset(x, y, (instorm(x, y) and TS or T0) + k)
end

-- dig a cell for player pid (0 = nobody, at the start). Returns cells dug and the points
-- (-1 = a mine). Power-ups go to that player's slot.
function open_cell(x, y, pid, quiet)
  if not onmap(x, y) then return 0, 0 end
  local i = idx(x, y)
  if op[i] ~= 0 or not land[i] then return 0, 0 end
  if diglog and not quiet then diglog[#diglog + 1] = string.char(35 + x, 35 + y) end
  flag[i] = nil
  if mine[i] then op[i] = 2; settile(i); return -1, 0 end
  local st, n, pts = { i }, 0, 0
  op[i] = 1
  while #st > 0 do
    local j = table.remove(st)
    n = n + 1
    pts = pts + ZPTS[zone[j]]
    flag[j] = nil
    settile(j)
    if not quiet and me and pid == me.k then reveal((j - 1) % S, (j - 1) // S, FOG_DIG) end
    if item[j] then
      local p = slots and slots[pid]
      if p and not quiet and mine_slot(p) then got_item(p, item[j]) end
      item[j] = nil
    end
    if num[j] == 0 then
      local jx, jy = (j - 1) % S, (j - 1) // S
      for k = 1, 8 do
        local nx, ny = jx + DX[k], jy + DY[k]
        if onmap(nx, ny) then
          local m = idx(nx, ny)
          if land[m] and op[m] == 0 and not mine[m] then op[m] = 1; st[#st + 1] = m end
        end
      end
    end
  end
  return n, pts
end

-- ============================================================ fog of war
-- Each Bit keeps its own: you see what's near ground you dug yourself, and you can only walk where
-- you can see. Digging clears fog, and so does standing on dug ground (anyone's), so ground another
-- player solved next to you lets you through. Undug ground doesn't, so the storm stays dangerous.
FOG_DIG, FOG_START = 2, 4
function fog_on() return setting("fog") ~= 2 and not (me and me.out) end
function reveal(x0, y0, r)
  for y = y0 - r, y0 + r do for x = x0 - r, x0 + r do
    if onmap(x, y) and (x - x0) ^ 2 + (y - y0) ^ 2 <= r * r + r then seen[idx(x, y)] = true end
  end end
end
-- at the start you see your own opening (the ground opened around your spawn) and a little more
function reveal_spawn(x0, y0)
  reveal(x0, y0, FOG_START)
  local st, done = { idx(x0, y0) }, {}
  while #st > 0 do
    local j = table.remove(st)
    if not done[j] then
      done[j] = true
      local x, y = (j - 1) % S, (j - 1) // S
      reveal(x, y, FOG_DIG)
      if num[j] == 0 then
        for k = 1, 8 do
          local nx, ny = x + DX[k], y + DY[k]
          if onmap(nx, ny) and op[idx(nx, ny)] == 1 then st[#st + 1] = idx(nx, ny) end
        end
      end
    end
  end
end
function fogged(x, y) return fog_on() and onmap(x, y) and not seen[idx(x, y)] end

function draw_fog(mx, my)
  if not fog_on() then return end
  for y = math.max(0, my), math.min(S - 1, my + 30) do
    for x = math.max(0, mx), math.min(S - 1, mx + 41) do
      local i = idx(x, y)
      if land[i] and not seen[i] then spr(138 + (x * 3 + y * 5) % 2, x * 8, y * 8) end
    end
  end
end

function touches_open(x, y)
  for k = 1, 8 do
    local nx, ny = x + DX[k], y + DY[k]
    if onmap(nx, ny) and op[idx(nx, ny)] > 0 then return true end
  end
  return false
end
-- a digger can stand on dug ground or on a cell next to it
function walkable(x, y)
  if not onmap(x, y) then return false end
  local i = idx(x, y)
  if not land[i] then return false end
  if fog_on() then return seen[i] == true end        -- fog: anywhere you can see, dug or not
  return op[i] > 0 or touches_open(x, y)
end

-- ============================================================ the match
function start_match(seed, ids, nb, host)
  local nh = #ids
  local n = nh + nb
  diglog = (nh == 1) and {} or nil
  slots = {}
  generate(seed, n)
  for k = 1, n do
    local human = k <= nh
    slots[k] = { k = k, id = human and ids[k] or 0, bot = not human, owner = human and ids[k] or host,
      x = spawns[k].x, y = spawns[k].y, score = 0, hearts = 3, out = false, stun = 0, shield = false,
      item = 0, storm = 0, col = PCOL[k], wait = 60 + k * 7, flags = {}, lastsent = -99 }
    slots[k].name = human and (net_name(ids[k], 8) or ("P" .. k)) or ("Bot " .. k)
    if (human and ids[k] == NET_ID) or (NET_ID == 0 and k == 1) then me = slots[k] end
  end
  match = { seed = seed, nh = nh, nb = nb, host = host, hosting = host == NET_ID, n = n, mt = 0, over = false }
  seen = {}
  reveal_spawn(me.x, me.y)
  outq, feed, tricks, splats = {}, {}, {}, {}
  cam_x, cam_y = me.x * 8 - 156, me.y * 8 - 108
  scene = "match"
  say("The storm comes in " .. STORM_AT // 60 .. "s. Dig towards the middle!", 13)
  sfx("C5", 4, 0.3, 10) sfx("G5", 4, 0.3, 14)
end

function mine_slot(p) return p.owner == NET_ID and (not p.bot or match.hosting) end

function queue(...) outq[#outq + 1] = { ... } end
function flush()
  local sent = 0
  while #outq > 0 and sent < 12 do
    local e = table.remove(outq, 1)
    if NET_ID > 0 then net_send(table.unpack(e)) end
    sent = sent + 1
  end
end

function say(s, c)
  s = tr(s)                       -- the Bit's language (texts{} at the end)
  table.insert(feed, 1, { s = s, c = c or 13, t = 240 })
  if #feed > 4 then feed[5] = nil end
end

function send_state(p)
  local fl = (p.out and 1 or 0) + (p.stun > 0 and 2 or 0) + (p.shield and 4 or 0) + p.item * 8
  queue(EV_STATE, p.k, p.x, p.y, p.score, p.hearts, fl, match.mt)
  p.lastsent = match.mt
end

function got_item(p, it)
  local def = ITEMS[it]
  if it == 3 then p.hearts = math.min(5, p.hearts + 1)
  elseif it == 1 then p.shield = true
  else
    if p.bot and TRICK[it] then use_item(p, it) else p.item = it end
  end
  if p == me then
    say(tr("Found %s: %s", tr(def.name), tr(def.info)), 27)
    sfx("E6", 4, 0.3, 6) sfx("B6", 4, 0.3, 10)
  end
end

function hurt(p, why)
  if p.out then return end
  p.hearts = p.hearts - 1
  p.stun = STUN
  if p.hearts <= 0 then
    p.hearts, p.out = 0, true
    say(p == me and "You're out! Watch the rest of the match." or tr("%s is out", p.name), p == me and 26 or 28)
  elseif p == me then say(why, 26) end
  send_state(p)
end

-- player p digs x, y (on its own Bit, or the host for bots)
function dig(p, x, y)
  local n, pts = open_cell(x, y, p.k)
  if n == 0 then return end
  queue(EV_OPEN, p.k, x, y)
  if n < 0 then
    boom(x, y, p)
    if p.shield then
      p.shield = false
      if p == me then say("Your shield took the blast", 22) end
      send_state(p)
    else hurt(p, "Boom! -1 heart") end
  else
    p.score = p.score + pts
    if p == me then
      if n > 6 then sfx("C4", 3, 0.25, 8, nil, 0, 400) else sfx("A5", 1, 0.25, 3) end
      pops[#pops + 1] = { x = x * 8 + 4, y = y * 8, s = "+" .. pts, t = 40 }
    end
  end
end

function boom(x, y, p)
  booms[#booms + 1] = { x = x * 8 + 4, y = y * 8 + 4, t = 20 }
  local dx, dy = x - me.x, y - me.y
  if dx * dx + dy * dy < 400 then sfx("C2", 3, p == me and 0.6 or 0.25, 24, nil, 0, -60) end
  if p == me then shake = 8 end
end

function flag_cells(p, r, x0, y0)
  local n = 0
  for y = y0 - r, y0 + r do for x = x0 - r, x0 + r do
    if onmap(x, y) and (x - x0) ^ 2 + (y - y0) ^ 2 <= r * r + r then
      local i = idx(x, y)
      if op[i] == 0 and mine[i] then
        if p == me then flag[i] = true; settile(i) else p.flags[i] = true end
        n = n + 1
      end
    end
  end end
  return n
end

function use_item(p, it)
  if it == 0 then return end
  p.item = 0
  if it == 2 then
    local n = flag_cells(p, 1, p.x, p.y)
    if p == me then say("Scan: " .. n .. " mines flagged", 22) end
  elseif it == 4 then
    local n = flag_cells(p, 5, p.x, p.y)
    if p == me then say("Sonar: " .. n .. " mines flagged", 22) end
  elseif it == 5 then
    local total = 0
    for y = p.y - 2, p.y + 2 do for x = p.x - 2, p.x + 2 do
      if onmap(x, y) then
        local i = idx(x, y)
        if land[i] and op[i] == 0 and not mine[i] and not instorm(x, y) then dig(p, x, y) end
      end
    end end
    if p == me then sfx("C3", 3, 0.5, 20, nil, 0, 200); shake = 6 end
  elseif TRICK[it] then
    local tx, ty, best = p.x, p.y, THROW + 1
    for _, q in ipairs(slots) do
      local d = math.max(math.abs(q.x - p.x), math.abs(q.y - p.y))
      if q ~= p and not q.out and d < best then best, tx, ty = d, q.x, q.y end
    end
    queue(EV_TRICK, p.k, it, tx, ty)
    add_trick(p, it, tx, ty)
  end
  if p == me then sfx("G5", 5, 0.3, 8) end
  send_state(p)
end

-- a Confuse or Paint patch: everyone but its thrower sees wrong (or no) numbers inside it until it wears off
function add_trick(by, it, x, y)
  local t = TRICK[it]
  tricks_seen = (tricks_seen or 0) + 1
  tricks[#tricks + 1] = { by = by, kind = it, x = x, y = y, r = t.r, left = t.len, len = t.len }
  splats[#splats + 1] = { fx = by.x * 8 + 4, fy = by.y * 8 + 4, x = x * 8 + 4, y = y * 8 + 4, t = 20, kind = it }
  local near = math.max(math.abs(me.x - x), math.abs(me.y - y)) <= t.r + 2
  if by == me then say(tr("%s thrown!", tr(ITEMS[it].name)), 22)
  elseif near then say(tr("%s hit you with %s!", by.name, tr(ITEMS[it].name)), it == 7 and 5 or 22); sfx("F3", 2, 0.4, 14, nil, 0, -80)
  else say(tr("%s threw %s", by.name, tr(ITEMS[it].name)), 28) end
end

-- the trick (if any) that hides cell x, y from player p: "confuse" or "paint"
function trick_at(p, x, y)
  for _, z in ipairs(tricks) do
    if z.by ~= p and (x - z.x) ^ 2 + (y - z.y) ^ 2 <= z.r * z.r + z.r then return z.kind end
  end
  return nil
end

function match_event(from, ev, a, b, c, d, e, f, g)
  local p = slots[a or 0]
  if not p or p.owner ~= from or mine_slot(p) then return end
  if ev == EV_OPEN then
    local n = open_cell(b, c, p.k)
    if n < 0 then boom(b, c, p); say(tr("%s hit a mine", p.name), 28) end
  elseif ev == EV_STATE then
    local was_out = p.out
    p.x, p.y, p.score, p.hearts = b, c, d, e
    p.out, p.stun, p.shield, p.item = f % 2 == 1, (f // 2) % 2 == 1 and 30 or 0, (f // 4) % 2 == 1, f // 8
    if p.out and not was_out then say(tr("%s is out", p.name), 28) end
    if g and g > match.mt and g < match.mt + 600 then match.mt = g end   -- clocks follow the furthest Bit
  elseif ev == EV_TRICK and TRICK[b] then
    add_trick(p, b, c, d)
  end
end

-- ============================================================ bots (run by the Bit that started the match)
function bot_skill() return setting("skill") or 2 end

function bot_think(b)
  if b.out then return end
  if b.stun > 0 then return end
  b.wait = b.wait - 1
  if b.wait > 0 then return end
  local sk = bot_skill()
  b.wait = ({ 70, 45, 28 })[sk] + rnd(40)
  if b.item > 0 then use_item(b, b.item) end
  -- head for the middle: look around a point a little closer to it than the bot
  local hx, hy = C - b.x, C - b.y
  local hd = math.max(1, math.sqrt(hx * hx + hy * hy))
  local lean = instorm(b.x, b.y) and 4 or 2
  local cx, cy = b.x + math.floor(hx / hd * lean + 0.5), b.y + math.floor(hy / hd * lean + 0.5)
  local guess = nil
  for try = 1, 40 do
    local x, y = cx + rnd(-5, 5), cy + rnd(-5, 5)
    if onmap(x, y) then
      local i = idx(x, y)
      if op[i] == 1 and num[i] > 0 and not trick_at(b, x, y) then
        local hid, fl, list = 0, 0, {}
        for k = 1, 8 do
          local nx, ny = x + DX[k], y + DY[k]
          if onmap(nx, ny) then
            local m = idx(nx, ny)
            if land[m] and op[m] == 0 then
              if b.flags[m] then fl = fl + 1 else hid = hid + 1; list[#list + 1] = m end
            elseif op[m] == 2 then fl = fl + 1 end
          end
        end
        if hid > 0 and fl == num[i] then         -- every mine here is known: the rest is safe
          for _, m in ipairs(list) do
            local mx, my = (m - 1) % S, (m - 1) // S
            if not instorm(mx, my) then
              if rnd(100) <= ({ 8, 3, 1 })[sk] then break end   -- a slip: the bot guesses instead
              b.idle = 0
              bot_dig(b, mx, my) return
            end
          end
        elseif hid > 0 and num[i] - fl == hid then   -- every hidden cell here is a mine
          for _, m in ipairs(list) do b.flags[m] = true end
        end
      elseif op[i] == 0 and land[i] and not b.flags[i] and not instorm(x, y) and touches_open(x, y) then
        local r = risk(b, x, y)
        if not guess or r < guess[3] then guess = { x, y, r } end
      end
    end
  end
  -- nothing certain: wait a little for others to open things up, then take the safest-looking guess
  b.idle = (b.idle or 0) + 1
  if guess and (b.idle > ({ 1, 2, 3 })[sk] or instorm(b.x, b.y)) then b.idle = 0; bot_dig(b, guess[1], guess[2]) end
end

-- how likely a hidden cell is a mine, from the numbers next to it (0..1)
function risk(b, x, y)
  local worst = 0.2
  for k = 1, 8 do
    local nx, ny = x + DX[k], y + DY[k]
    if onmap(nx, ny) then
      local i = idx(nx, ny)
      if op[i] == 1 then
        local hid, fl = 0, 0
        for q = 1, 8 do
          local mx, my = nx + DX[q], ny + DY[q]
          if onmap(mx, my) then
            local m = idx(mx, my)
            if land[m] and op[m] == 0 then if b.flags[m] then fl = fl + 1 else hid = hid + 1 end
            elseif op[m] == 2 then fl = fl + 1 end
          end
        end
        if hid > 0 then worst = math.max(worst, (num[i] - fl) / hid) end
        if num[i] == 0 then worst = 0.2 end
      end
    end
  end
  return worst
end

function bot_dig(b, x, y)
  b.x, b.y = x, y
  dig(b, x, y)
end

-- ============================================================ my digger
function step_me()
  local p = me
  if p.out then             -- spectating: fly the camera around
    local sp = 4
    if btn("left") then cam_x = cam_x - sp end
    if btn("right") then cam_x = cam_x + sp end
    if btn("up") then cam_y = cam_y - sp end
    if btn("down") then cam_y = cam_y + sp end
    return
  end
  if p.stun > 0 then return end
  local mx = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
  local my = (btnp("down") and 1 or 0) - (btnp("up") and 1 or 0)
  if mx ~= 0 or my ~= 0 then
    if walkable(p.x + mx, p.y + my) then p.x, p.y = p.x + mx, p.y + my
    elseif mx ~= 0 and walkable(p.x + mx, p.y) then p.x = p.x + mx
    elseif my ~= 0 and walkable(p.x, p.y + my) then p.y = p.y + my
    else bump = 6 end
    -- standing on dug ground (yours or anyone's) lets you see around it, so ground someone else
    -- solved next to you never walls you in
    if op[idx(p.x, p.y)] > 0 then reveal(p.x, p.y, FOG_DIG) end
  end
  local i = idx(p.x, p.y)
  if btnp("a") then
    if op[i] ~= 0 then bump = 6
    elseif flag[i] then say("Flagged: press B to take the flag off first", 29)
    elseif instorm(p.x, p.y) then say("Can't dig in the storm", 22); bump = 6
    else dig(p, p.x, p.y) end
  end
  if btnp("b") and op[i] == 0 then
    flag[i] = not flag[i] or nil
    settile(i)
    sfx(flag[i] and "D5" or "A4", 0, 0.2, 4)
  end
  if btnp("x") then
    if p.item > 0 then use_item(p, p.item) else say("No power-up. Dig to find one", 29) end
  end
end

function storm_update()
  local sr = R + 2
  if match.mt > STORM_AT then
    local f = math.min(1, (match.mt - STORM_AT) / (STORM_END - STORM_AT))
    sr = math.floor(R + 2 - f * (R - 1))
  end
  if sr ~= SR then
    local old = SR
    SR = sr
    if sr < old then
      for y = 0, S - 1 do for x = 0, S - 1 do
        local d2 = (x - C) ^ 2 + (y - C) ^ 2
        if d2 <= old * old + old and d2 > sr * sr + sr then settile(idx(x, y)) end
      end end
      if old == R + 2 then say("The storm is coming in!", 22); sfx("C3", 2, 0.3, 40, nil, 0, -20) end
    end
  end
end

function match_update()
  local m = match
  if not m.over then m.mt = m.mt + 1 end
  storm_update()
  for _, p in ipairs(slots) do
    if mine_slot(p) and not m.over then
      if p.stun > 0 then p.stun = p.stun - 1; if p.stun == 0 then send_state(p) end end
      if not p.out and instorm(p.x, p.y) then
        p.storm = p.storm + 1
        if p.storm >= STORM_HIT then p.storm = 0; hurt(p, "The storm hurts! Get to the middle") end
      else p.storm = 0 end
      if p.bot then bot_think(p) end
      if m.mt - p.lastsent >= (p.bot and 40 or 15) + p.k % 5 then send_state(p) end
    elseif p.stun > 0 then p.stun = p.stun - 1 end
  end
  if not m.over then step_me() end
  for k = #tricks, 1, -1 do
    local z = tricks[k]
    z.left = z.left - 1
    if z.left <= 0 then table.remove(tricks, k) end
  end
  -- the end: time's up, or one digger (or nobody) left
  local alive = 0
  for _, p in ipairs(slots) do if not p.out then alive = alive + 1 end end
  if not m.over and (m.mt >= MATCH_LEN or alive == 0 or (m.n > 1 and alive <= 1)) then
    m.over = true
    m.wait = 90
    if alive == 1 and m.n > 1 then
      for _, p in ipairs(slots) do if not p.out then p.score = p.score + 100; p.last = true end end
    end
    for _, p in ipairs(slots) do if mine_slot(p) then send_state(p) end end
    say(m.mt >= MATCH_LEN and "Time's up!" or "Last digger standing!", 27)
    sfx("C5", 4, 0.3, 12) sfx("E5", 4, 0.3, 12) sfx("G5", 4, 0.3, 20)
    checkpoint(nil)
  end
  if m.over then
    m.wait = m.wait - 1
    if m.wait <= 0 and hold_btn("a") then to_lobby() return end
    if m.wait == 0 then
      local r = rank_of(me)
      if r == 1 and m.n > 1 then game_win(tr("You won Sweep Storm with %d points!", me.score)) end
    end
  end
  flush()
  -- solo matches (just you and bots) keep a checkpoint for Continue
  if diglog and not m.over and m.mt % 600 == 300 and #diglog < 1800 then
    local bs = {}
    for _, p in ipairs(slots) do bs[#bs + 1] = { p.x, p.y, p.score, p.hearts, p.out and 1 or 0, p.item, p.shield and 1 or 0 } end
    checkpoint({ seed = m.seed, nb = m.nb, mt = m.mt, log = table.concat(diglog), p = bs })
  end
end

function resume(cp)
  if type(cp) ~= "table" or not cp.seed then return false end
  start_match(cp.seed, { NET_ID > 0 and NET_ID or 0 }, cp.nb or 0, NET_ID)
  local log = cp.log or ""
  for k = 1, #log - 1, 2 do
    local x, y = log:byte(k) - 35, log:byte(k + 1) - 35
    open_cell(x, y, 0, true)
    diglog[#diglog + 1] = log:sub(k, k + 1)
  end
  for k, v in ipairs(cp.p or {}) do
    local p = slots[k]
    if p then p.x, p.y, p.score, p.hearts, p.out, p.item, p.shield = v[1], v[2], v[3], v[4], v[5] == 1, v[6], v[7] == 1 end
  end
  match.mt = cp.mt or 0
  for i = 1, S * S do if op[i] ~= 0 then reveal((i - 1) % S, (i - 1) // S, FOG_DIG) end end   -- roughly what you had seen
  reveal_spawn(me.x, me.y)
  storm_update()
  cam_x, cam_y = me.x * 8 - 156, me.y * 8 - 108
  feed = {}
  say("Welcome back!", 27)
  return true
end

function ranking()
  local r = {}
  for _, p in ipairs(slots) do r[#r + 1] = p end
  table.sort(r, function(a, b)
    if a.score ~= b.score then return a.score > b.score end
    return a.k < b.k
  end)
  return r
end
function rank_of(p)
  for k, q in ipairs(ranking()) do if q == p then return k end end
  return #slots
end

-- ============================================================ update / draw
pops, booms, shake, bump = {}, {}, 0, 0

function _update()
  -- network events come in every frame, whatever screen we're on
  while true do
    local from, ev, a, b, c, d, e, f, g = net_recv()
    if not from then break end
    if scene == "lobby" then lobby_event(from, ev, a, b, c, d, e, f, g)
    elseif scene == "match" then match_event(from, ev, a, b, c, d, e, f, g) end
  end
  if scene == "lobby" then lobby_update() else match_update() end
  for k = #pops, 1, -1 do pops[k].t = pops[k].t - 1; pops[k].y = pops[k].y - 0.4; if pops[k].t <= 0 then table.remove(pops, k) end end
  for k = #(splats or {}), 1, -1 do splats[k].t = splats[k].t - 1; if splats[k].t <= 0 then table.remove(splats, k) end end
  for k = #booms, 1, -1 do booms[k].t = booms[k].t - 1; if booms[k].t <= 0 then table.remove(booms, k) end end
  if feed then for k = #feed, 1, -1 do feed[k].t = feed[k].t - 1; if feed[k].t <= 0 then table.remove(feed, k) end end end
  if shake > 0 then shake = shake - 1 end
  if bump > 0 then bump = bump - 1 end
end

function _draw()
  if scene == "lobby" then draw_lobby() else draw_match() end
end

function ctext(s, y, c) s = tr(s) text(s, 160 - #s * 4, y, c) end

function draw_lobby()
  cls(19)
  -- a little island in the background
  for k = 0, 11 do
    local a = t() / 120 + k * 0.52
    circfill(160 + math.cos(a) * 120, 132 + math.sin(a) * 70, 3, 20)
  end
  circfill(160, 132, 62, 15) circfill(160, 132, 40, 10) circfill(160, 132, 20, 4)
  spr(160, 152, 124, 2, 2)
  text("SWEEP STORM", 72, 14, 1, 2) text("SWEEP STORM", 72, 12, 27, 2)
  ctext("minesweeper battle royale", 32, 22)
  local ids = NET_ID > 0 and lobby_ids() or { 0 }
  rectfill(16, 46, 288, 30, 1) rect(16, 46, 288, 30, 13)
  if NET_ID > 0 then
    text("Bits here: " .. #ids, 24, 50, 13)
    for k, id in ipairs(ids) do
      local x = 24 + (k - 1) * 14
      if x < 290 then
        rectfill(x, 62, 10, 10, PCOL[k]) rect(x, 62, 10, 10, id == NET_ID and 13 or 1)
      end
    end
    if #ids == 1 then text("waiting for other Bits...", 136, 50, 29) end
  else
    text("No network on this Bit: you vs bots", 24, 50, 13)
    text("Open more studio windows to play together", 24, 62, 29)
  end
  rectfill(60, 182, 200, 40, 1) rect(60, 182, 200, 40, 13)
  local s = "< Bots: " .. bots .. " >"
  ctext(s, 188, 27)
  ctext((#ids + bots) .. " diggers on the island", 200, 13)
  if (t() // 20) % 3 ~= 0 then ctext("A: start the match", 212, 17) end
  ctext("left/right: bots  up/down: +-5", 228, 29)
end

function draw_match()
  local p = me
  if not p.out then
    local tx, ty = p.x * 8 + 4 - 160, p.y * 8 + 4 - 112
    cam_x = cam_x + (tx - cam_x) * 0.2
    cam_y = cam_y + (ty - cam_y) * 0.2
  end
  local cx = math.floor(cam_x + (shake > 0 and rnd(-2, 2) or 0))
  local cy = math.floor(cam_y + (shake > 0 and rnd(-2, 2) or 0))
  cls(19)
  camera(cx, cy - 16)
  clip(0, 16, 320, 224)
  local mx, my = cx // 8, cy // 8
  map(mx, my, 42, 30, mx * 8, my * 8)
  draw_tricks(mx, my)
  draw_fog(mx, my)
  -- the storm's edge
  circ(C * 8 + 4, C * 8 + 4, SR * 8 + 4, 5)
  circ(C * 8 + 4, C * 8 + 4, SR * 8 + 5, 3)
  -- other diggers
  for _, q in ipairs(slots) do
    if q ~= p then
      local x, y = q.x * 8, q.y * 8
      if x > cx - 16 and x < cx + 336 and y > cy - 32 and y < cy + 240 and not fogged(q.x, q.y) then
        local c = q.out and 28 or q.col
        rect(x - 1, y - 1, 10, 10, c)
        if q.stun > 0 and (t() // 4) % 2 == 0 then rect(x - 2, y - 2, 12, 12, 22) end
        local s = q.bot and ("B" .. q.k) or (net_name(q.id, 6) or ("P" .. q.k))
        text(s, x + 4 - #s * 2, y - 9, c)
      end
    end
  end
  -- me
  if not p.out then
    local x, y = p.x * 8, p.y * 8
    local c = p.stun > 0 and 22 or (bump > 0 and 26 or 13)
    if (t() // 8) % 2 == 0 or p.stun > 0 then rect(x - 2, y - 2, 12, 12, c) end
    rect(x - 1, y - 1, 10, 10, p.col)
    if p.shield then circ(x + 4, y + 4, 8, 22) end
  end
  for _, b in ipairs(booms) do circfill(b.x, b.y, (20 - b.t) // 2 + 2, b.t > 10 and 27 or 9) end
  for _, q in ipairs(pops) do text(q.s, q.x - #q.s * 2, q.y, 27) end
  camera() clip()
  if p.stun > 0 and not p.out then ctext("STUNNED", 40, (t() // 6) % 2 == 0 and 22 or 13) end
  if instorm(p.x, p.y) and not p.out and not match.over then
    ctext("IN THE STORM: go to the middle!", 52, (t() // 10) % 2 == 0 and 5 or 13)
  end
  draw_hud()
  if btn("y") then draw_minimap() end
  if match.over then draw_results() end
end

-- what Confuse and Paint do to the numbers you see
function draw_tricks(mx, my)
  for _, z in ipairs(tricks) do
    if z.by ~= me then
      local fade = z.left < 90 and (t() // 4) % 2 == 0
      for y = math.max(my, z.y - z.r), math.min(my + 30, z.y + z.r) do
        for x = math.max(mx, z.x - z.r), math.min(mx + 41, z.x + z.r) do
          if onmap(x, y) and (x - z.x) ^ 2 + (y - z.y) ^ 2 <= z.r * z.r + z.r then
            local i = idx(x, y)
            if op[i] == 1 and not fade then
              local base = instorm(x, y) and TS or T0
              if z.kind == 7 then spr(135 + (i * 7 + z.x) % 3, x * 8, y * 8)       -- paint blots
              else                                                                -- a random number, changing
                local n = (i * 7919 + (match.mt // 25) * 104729 + z.y) % 8 + 1
                spr(base + K_OPEN + n, x * 8, y * 8)
              end
            end
          end
        end
      end
    end
    -- the patch's edge, for everyone (the thrower sees where it landed)
    local c = z.kind == 7 and 5 or 22
    if z.left > 90 or (t() // 4) % 2 == 0 then circ(z.x * 8 + 4, z.y * 8 + 4, z.r * 8 + 6, c) end
  end
  for _, sp in ipairs(splats) do       -- the throw in flight
    local f = 1 - sp.t / 20
    local x, y = sp.fx + (sp.x - sp.fx) * f, sp.fy + (sp.y - sp.fy) * f - math.sin(f * math.pi) * 24
    spr(ITEMS[sp.kind].spr, x - 4, y - 4)
  end
end

function draw_hud()
  local p = me
  rectfill(0, 0, 320, 16, 1)
  for k = 1, 5 do
    if k <= p.hearts then spr(130, 2 + (k - 1) * 9, 4) elseif k <= 3 then rect(3 + (k - 1) * 9, 5, 6, 6, 30) end
  end
  if p.shield then spr(128, 48, 4) end
  text(tostring(p.score), 62, 4, 27)
  if p.item > 0 then spr(ITEMS[p.item].spr, 104, 4) text("X:" .. tr(ITEMS[p.item].name), 114, 4, 13) end
  local left = math.max(0, MATCH_LEN - match.mt) // 60
  local tm = string.format("%d:%02d", left // 60, left % 60)
  text(tm, 210, 4, match.mt > STORM_AT and 5 or 13)
  local alive = 0
  for _, q in ipairs(slots) do if not q.out then alive = alive + 1 end end
  text(alive .. "/" .. #slots, 252, 4, 29)
  text("#" .. rank_of(p), 292, 4, 27)
  -- what's happening
  for k, f in ipairs(feed) do
    local y = 230 - (k - 1) * 11
    rectfill(0, y - 2, #f.s * 8 + 6, 11, 1)
    text(f.s, 3, y, f.c)
  end
  -- zone under me
  if not p.out then
    local z = zone[idx(p.x, p.y)]
    local s = ZNAME[z] .. " x" .. ZPTS[z]
    rectfill(318 - #s * 8 - 4, 17, #s * 8 + 6, 11, 1)
    text(s, 318 - #s * 8, 19, ({ 17, 11, 5 })[z])
  end
end

function draw_minimap()
  local sc = S <= 56 and 3 or 2
  local w = S * sc
  local x0, y0 = 160 - w // 2, 128 - w // 2
  rectfill(x0 - 3, y0 - 3, w + 6, w + 6, 1)
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      local i = idx(x, y)
      if land[i] then
        local c
        if op[i] == 1 then c = 30 elseif op[i] == 2 then c = 26 else c = ({ 16, 10, 4 })[zone[i]] end
        if instorm(x, y) then c = 2 end
        if fog_on() and not seen[i] then c = (x + y) % 2 == 0 and 31 or 30 end
        rectfill(x0 + x * sc, y0 + y * sc, sc, sc, c)
      end
    end
  end
  for _, q in ipairs(slots) do
    if not q.out and not fogged(q.x, q.y) then rectfill(x0 + q.x * sc - 1, y0 + q.y * sc - 1, sc + 2, sc + 2, q.col) end
  end
  if (t() // 8) % 2 == 0 then rect(x0 + me.x * sc - 3, y0 + me.y * sc - 3, sc + 6, sc + 6, 13) end
end

function draw_results()
  local r = ranking()
  local n = math.min(#r, 10)
  local h = n * 11 + 44
  local y = 120 - h // 2
  rectfill(60, y, 200, h, 1) rect(60, y, 200, h, 13)
  ctext(match.mt >= MATCH_LEN and "TIME'S UP" or "MATCH OVER", y + 6, 27)
  for k = 1, n do
    local q = r[k]
    local yy = y + 20 + (k - 1) * 11
    if q == me then rectfill(64, yy - 2, 192, 10, 2) end
    text(k .. ".", 70, yy, 13)
    rectfill(92, yy, 7, 7, q.col)
    text(q.name .. (q.out and tr(" (out)") or "") .. (q.last and " *" or ""), 104, yy, q.out and 29 or 13)
    local s = tostring(q.score)
    text(s, 250 - #s * 8, yy, 27)
  end
  local mr = rank_of(me)
  if mr > n then ctext(tr("you: #%d  %d", mr, me.score), y + h - 22, 13) end
  if match.wait <= 0 then ctext("hold A: back to the lobby", y + h - 11, 17) end
end
-- this game's words in other languages (the Bit's language, LANGUAGE in Settings; runtime/bk_lang.lua)
texts{
  de = {
    ["Shield"] = "Schild",
    ["the next mine can't hurt you"] = "die nächste Mine tut dir nichts",
    ["Scan"] = "Scan",
    ["flags every mine next to you"] = "markiert jede Mine neben dir",
    ["Heart"] = "Herz",
    ["+1 heart"] = "+1 Herz",
    ["Sonar"] = "Sonar",
    ["flags mines in a wide circle"] = "markiert Minen in einem weiten Kreis",
    ["Blast"] = "Sprengung",
    ["digs every safe cell around you"] = "gräbt jedes sichere Feld um dich frei",
    ["Confuse"] = "Verwirrung",
    ["throw it: rivals there see wrong numbers"] = "werfen: Gegner dort sehen falsche Zahlen",
    ["Paint"] = "Farbe",
    ["throw it: hides the numbers there"] = "werfen: versteckt die Zahlen dort",
    ["Dig the most ground before the storm closes in. The middle is worth more."] = "Grab am meisten Boden frei, bevor der Sturm alles schließt. Die Mitte zählt mehr.",
    ["D-pad: walk over dug ground and aim at the next cell. A: dig. B: flag a mine."] = "Steuerkreuz: über gegrabenen Boden laufen und aufs nächste Feld zielen. A: graben. B: Mine markieren.",
    ["Numbers tell how many mines touch that cell. A mine costs a heart and stuns you."] = "Zahlen sagen, wie viele Minen das Feld berühren. Eine Mine kostet ein Herz und betäubt dich.",
    ["X: use your power-up. Hold Y: island map."] = "X: Power-up nutzen. Y halten: Inselkarte.",
    ["Confuse and Paint fly at the nearest rival: for a while they see wrong numbers or none there."] = "Verwirrung und Farbe fliegen zum nächsten Gegner: eine Weile sieht er dort falsche oder gar keine Zahlen.",
    ["Shore cells are worth 1, the middle ring 2, the core 4. Power-ups get stronger towards the middle."] = "Strandfelder zählen 1, der mittlere Ring 2, der Kern 4. Power-ups werden zur Mitte hin stärker.",
    ["The storm shrinks the island. Standing in it costs hearts."] = "Der Sturm macht die Insel kleiner. Wer drin steht, verliert Herzen.",
    ["Fog covers the island and you can only walk where you can see. Digging clears the fog around what you dig, and so does standing on dug ground."] = "Nebel liegt über der Insel, du läufst nur, wo du etwas siehst. Graben lichtet den Nebel um das Gegrabene, genauso das Stehen auf gegrabenem Boden.",
    ["Up to 20 Bits nearby can join the same match. Bots fill the empty spots."] = "Bis zu 20 Bits in der Nähe können mitspielen. Bots füllen freie Plätze.",
    ["Bot skill"] = "Bot-Können",
    ["Fog of war"] = "Nebel des Krieges",
    ["Bot #"] = "Bot #",
    ["The storm comes in #s. Dig towards the middle!"] = "Der Sturm kommt in #s. Grab dich zur Mitte!",
    ["Found %s: %s"] = "%s gefunden: %s",
    ["You're out! Watch the rest of the match."] = "Du bist raus! Schau dir den Rest an.",
    ["%s is out"] = "%s ist raus",
    ["Your shield took the blast"] = "Dein Schild hat die Explosion abgefangen",
    ["Scan: # mines flagged"] = "Scan: # Minen markiert",
    ["Sonar: # mines flagged"] = "Sonar: # Minen markiert",
    ["%s thrown!"] = "%s geworfen!",
    ["%s hit you with %s!"] = "%s hat dich mit %s getroffen!",
    ["%s threw %s"] = "%s warf %s",
    ["%s hit a mine"] = "%s trat auf eine Mine",
    ["Flagged: press B to take the flag off first"] = "Markiert: erst mit B die Fahne wegnehmen",
    ["Can't dig in the storm"] = "Im Sturm kann man nicht graben",
    ["No power-up. Dig to find one"] = "Kein Power-up. Grab, um eins zu finden",
    ["The storm is coming in!"] = "Der Sturm zieht auf!",
    ["Time's up!"] = "Die Zeit ist um!",
    ["Last digger standing!"] = "Der letzte Gräber steht!",
    ["You won Sweep Storm with %d points!"] = "Du hast Sweep Storm mit %d Punkten gewonnen!",
    ["Welcome back!"] = "Willkommen zurück!",
    ["minesweeper battle royale"] = "Minensuche-Battle-Royale",
    ["Bits here: #"] = "Bits hier: #",
    ["waiting for other Bits..."] = "warte auf andere Bits...",
    ["No network on this Bit: you vs bots"] = "Kein Netz: du gegen Bots",
    ["Open more studio windows to play together"] = "Mehr Studiofenster: zusammen spielen",
    ["< Bots: # >"] = "< Bots: # >",
    ["# diggers on the island"] = "# Gräber auf der Insel",
    ["A: start the match"] = "A: Spiel starten",
    ["left/right: bots  up/down: +-5"] = "links/rechts: Bots  oben/unten: +-5",
    ["STUNNED"] = "BETÄUBT",
    ["IN THE STORM: go to the middle!"] = "IM STURM: ab in die Mitte!",
    ["TIME'S UP"] = "ZEIT UM",
    ["MATCH OVER"] = "SPIEL VORBEI",
    [" (out)"] = " (raus)",
    ["you: #%d  %d"] = "du: #%d  %d",
    ["A: back to the lobby"] = "A: zurück zur Lobby",
    ["hold A: back to the lobby"] = "A halten: zur Lobby",
  },
}
`;

  // ---- pixel art (palette indices from the default palette)
  const K = { '.': 0, k: 1, w: 13, c: 12, r: 25, R: 26, Y: 27, o: 10, b: 21, B: 20, l: 22, g: 16, G: 17, p: 4, P: 5, s: 30, S: 31, d: 28 };
  const ICONS = {
    128: ['.llllll.', 'lwwllwwl', 'lwlllllb', 'lllllllb', '.lllllb.', '.llllbb.', '..lllb..', '...bb...'],   // shield
    129: ['..GGGG..', '.G....G.', 'G..GG..G', 'G.GwwG.G', 'G.GwwG.G', 'G..GG..G', '.G....G.', '..GGGG..'],   // scan
    130: ['.RR..RR.', 'RwRRRRRR', 'RwRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...RR...', '........'],   // heart
    131: ['...ll...', '.l....l.', 'l..ll..l', '..l..l..', '..l.wl..', '...ll...', '...BB...', '..BBBB..'],   // sonar
    132: ['.o..Y.o.', '..oYYo..', 'oYYwwYYo', '.YwwwwY.', '.YwwwwY.', 'oYYwwYYo', '..oYYo..', '.o..Y.o.'],   // blast
    133: ['..pppp..', '.p....p.', '....pp..', '...pP...', '...p....', '........', '...P....', '........'],   // confuse
    134: ['....k...', '...kRk..', '..kRRRk.', '.kRRRRRk', '.kwRRRRk', '.kRRRRRk', '..kRRRk.', '...kkk..'],   // paint
    138: ['SSSSSSSS', 'SSsSSSSS', 'SsssSSSS', 'SSSSSsSS', 'SSSSsssS', 'SSSSSSSS', 'SsSSSSSS', 'SSSSSSSS'],   // fog
    139: ['SSSSSSSS', 'SSSSSsSS', 'SSSSsssS', 'SSSSSSSS', 'SSsSSSSS', 'SsssSSSS', 'SSSSSSSS', 'SSSSSSsS'],
    135: ['.PP.....', 'PPPP..P.', 'PPPPPPP.', '.PPPPPP.', '.PPPPPPP', '..PPPPP.', 'P.PPPP..', '...PP...'],   // paint blots
    136: ['....PP..', '.PPPPPP.', 'PPPPPPP.', 'PPPPPPPP', '.PPPPPPP', 'PPPPPP..', '.PP.PPP.', '.....P..'],
    137: ['P..PPP..', '.PPPPPP.', '.PPPPPPP', 'PPPPPPP.', 'PPPPPPP.', '.PPPPPPP', '..PPPP.P', '.P......'],
  };
  const LOGO = ['................', '......kkkk......', '....kkrrrrkk....', '...krrrrrrrrk...', '..krrwwrrrrrrk..', '..krwwrrrrrrrk..',
    '.krrwrrrrrrrrrk.', '.krrrrrrrrrrrrk.', '.krrrrrrrrrrrrk.', '.krrrrrrrrrrrrk.', '..krrrrrrrrrrk..', '..krrrrrrrrrrk..',
    '...krrrrrrrrk...', '....kkrrrrkk....', '......kkkk......', '................'];
  // 3x5 digits for the number cells
  const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111'];
  const NUMC = [0, 21, 17, 26, 5, 10, 22, 27, 13];
  const ZONE = [[16, 17, 15], [10, 11, 9], [4, 5, 3]];   // hidden cell: fill, light edge, dark edge per zone
  // the storm darkens everything: colour -> storm colour
  const STORM = { 16: 2, 17: 3, 15: 1, 10: 7, 11: 8, 9: 6, 4: 2, 5: 3, 3: 1, 30: 2, 31: 1, 28: 3, 25: 24, 26: 24, 27: 8, 13: 29, 21: 3, 22: 4, 12: 29, 19: 1, 20: 2, 1: 1, 24: 6, 0: 0 };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    const put = (t, x, y, c) => { cart.tiles[t * 64 + y * 8 + x] = c; };
    const cell = (k, fn) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(64 + k, x, y, fn(x, y)); };
    for (let z = 0; z < 3; z++) {
      const [f, l, d] = ZONE[z];
      const hid = (x, y) => (x === 7 || y === 7) ? d : (x === 0 || y === 0) ? l : f;
      cell(z, hid);
      cell(3 + z, (x, y) => {                                     // flag
        if (x === 2 && y >= 1 && y <= 6) return 1;
        if (x >= 3 && x <= 5 && y >= 1 && y <= 3 && x - 3 <= 3 - Math.abs(y - 2) - 1 + 1) return 26;
        if (y === 6 && x >= 1 && x <= 4) return 1;
        return hid(x, y);
      });
    }
    const ground = (x, y) => (x === 7 || y === 7) ? 31 : 30;
    cell(6, ground);
    for (let n = 1; n <= 8; n++) cell(6 + n, (x, y) => {
      const dx = x - 2, dy = y - 1;
      if (dx >= 0 && dx < 3 && dy >= 0 && dy < 5 && DIG[n][dy * 3 + dx] === '1') return NUMC[n];
      return ground(x, y);
    });
    cell(15, (x, y) => {                                          // blown mine
      const dx = x - 3.5, dy = y - 3.5, r = dx * dx + dy * dy;
      if (r < 5) return (x === 3 && y === 3) ? 13 : 1;
      if ((x === 3 || x === 4 || y === 3 || y === 4) && r < 12) return 1;
      return (x === 7 || y === 7) ? 24 : 25;
    });
    cell(16, (x, y) => ((y === 2 && (x === 1 || x === 2)) || (y === 6 && (x === 5 || x === 6))) ? 20 : 19);   // water
    // storm copies
    for (let k = 0; k <= 16; k++) for (let i = 0; i < 64; i++) {
      const c = cart.tiles[(64 + k) * 64 + i];
      cart.tiles[(96 + k) * 64 + i] = STORM[c] ?? 2;
    }
    for (const [n, rows] of Object.entries(ICONS))
      rows.forEach((row, y) => [...row].forEach((ch, x) => put(+n, x, y, K[ch] ?? 0)));
    LOGO.forEach((row, y) => [...row].forEach((ch, x) => put(160 + (y >> 3) * 16 + (x >> 3), x & 7, y & 7, K[ch] ?? 0)));
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'mine', anims: [{ name: 'idle', frames: [160], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Island', w: 128, h: 128, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Sweep Storm', code, buildGfx,
    about: 'Minesweeper battle royale for 1-20 Bits: dig towards the dangerous middle before the storm closes in.' });
})();
