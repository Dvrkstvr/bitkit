/* Demo cart "Windrow": the flagship farming game. You start with bare hands, a digging stick and a leaky
   bucket on an overgrown plot, forage in the woods for your first coins, and rebuild the valley's old windmill.
   Original world, art and code. MIT License. */
(function () {
  const code = `-- Windrow: a farming game. So far: the farm, hand work, foraging and animals.
-- You arrive with a digging stick, a leaky bucket and four radish seeds. The plot is overgrown: pull the
-- weeds, dig the soil, plant, water and sell at the crate. Forage in Bramble Woods (west) for your first
-- coins. Marrow's wagon sells seeds, tools and the deeds to more land.
--   D-pad: walk     A: use your hands (dig, plant, pick, pull, talk)     B: water (fill up at a pond)
--   L / R: pick seeds     X: your bag     Y: look at what is in front of you     Start: pause
-- South of the fields lies the pasture. Mend the hen house and the goat shed with wood, fibre and stone, buy
-- hens and goats from Marrow, fill the trough from your bag, pet them, gather eggs and milk the goats by hand.
-- The old mine in the woods opens with a pickaxe. Its floors are new every day: break rocks for stone and ore,
-- find the ladder down. From floor 4 things live in the dark. The mill's stone lies at the very bottom.
-- The farm is kept with save(). clock() tells how long the Bit was off: the farm lives on while you are
-- away (a few days at most), and anything you watered keeps growing.

DAY_FRAMES = tune("Day length (minutes)", 5, 1, 20) * 3600
AWAY_DAY = tune("Away: minutes per farm day", 20, 1, 120) * 60
AWAY_MAX = tune("Away: most days that pass", 3, 0, 14)
WALK = tune("Walking speed", 1.3, 0.8, 3, 0.1)
C = 16
SEASON = { "Spring", "Summer", "Autumn", "Winter" }

-- days to grow, seed price, selling price, the seasons it grows in, and how it is drawn
CROPS = {
  { key = "radish", name = "Radish", days = 2, seed = 6, sell = 14, seasons = { 1, 3 }, shape = "root", col = 25 },
  { key = "barley", name = "Barley", days = 3, seed = 10, sell = 26, seasons = { 1, 3 }, shape = "grain", col = 27, stalk = 11, grain = true },
  { key = "pea", name = "Sweet pea", days = 4, regrow = 2, seed = 24, sell = 12, seasons = { 1 }, shape = "vine", col = 18 },
  { key = "tomato", name = "Tomato", days = 4, regrow = 2, seed = 30, sell = 16, seasons = { 2 }, shape = "vine", col = 26 },
  { key = "corn", name = "Corn", days = 5, seed = 22, sell = 62, seasons = { 2 }, shape = "grain", col = 27, stalk = 16, tall = true, grain = true },
  { key = "sunmelon", name = "Sunmelon", days = 7, seed = 45, sell = 150, seasons = { 2 }, shape = "ground", col = 10, hi = 27 },
  { key = "pumpkin", name = "Pumpkin", days = 6, seed = 38, sell = 120, seasons = { 3 }, shape = "ground", col = 9, hi = 10 },
  { key = "snowleek", name = "Snowleek", days = 4, seed = 18, sell = 48, seasons = { 4 }, shape = "leek", col = 22 },
  { key = "frostcap", name = "Frostcap", days = 3, seed = 12, sell = 30, seasons = { 4 }, shape = "cap", col = 21 },
}
-- things you find: food sells at the crate, materials are kept for building
FOUND = {
  { key = "garlic", name = "Wild garlic", sell = 7, spr = 98 },
  { key = "berry", name = "Brambleberry", sell = 9, spr = 96 },
  { key = "mushroom", name = "Pennybun", sell = 12, spr = 100 },
  { key = "cone", name = "Pine cone", sell = 6, spr = 102 },
  { key = "egg", name = "Egg", sell = 18, spr = 110 },
  { key = "bigegg", name = "Big egg", sell = 42, spr = 164 },
  { key = "milk", name = "Goat milk", sell = 34, spr = 166 },
  { key = "cream", name = "Creamy milk", sell = 70, spr = 168 },
  { key = "copper", name = "Copper ore", sell = 16, spr = 266 },
  { key = "iron", name = "Iron ore", sell = 38, spr = 268 },
  { key = "glow", name = "Glowstone", sell = 110, spr = 270 },
  { key = "dust", name = "Gloom dust", sell = 14, spr = 288 },
  { key = "millstone", name = "Millstone", spr = 290, mat = true },
  { key = "wood", name = "Wood", spr = 104, mat = true },
  { key = "stone", name = "Stone", spr = 106, mat = true },
  { key = "fibre", name = "Fibre", spr = 108, mat = true },
}
FOUND_BY = {}
for i, f in ipairs(FOUND) do FOUND_BY[f.key] = f end
CROP_BY = {}
for i, c in ipairs(CROPS) do CROP_BY[c.key] = i end

HOE = { { name = "Digging stick", hits = 3 }, { name = "Hoe", hits = 1 } }
CAN = { { name = "Leaky bucket", n = 5 }, { name = "Watering can", n = 14 }, { name = "Big can", n = 36 } }
BAG = { 16, 40, 100 }
MILL = {
  { name = "Raise the frame", coins = 250, need = { wood = 16, stone = 12 }, crops = 0 },
  { name = "Sew the sails", coins = 1200, need = { fibre = 40 }, crops = 40 },
  { name = "Set the millstone", coins = 4000, need = { stone = 30, millstone = 1 }, crops = 120 },
}

-- what you can mend in the pasture, and who lives there
BUILD = {
  coop = { name = "Hen house", coins = 60, need = { wood = 10, fibre = 6 }, about = "Room for 4 hens. Fed hens lay an egg a day." },
  shed = { name = "Goat shed", coins = 200, need = { wood = 20, stone = 10 }, about = "Room for 2 goats. Milk them by hand." },
}
HEN_NAMES = { "Pip", "Dot", "Clover", "Bean" }
GOAT_NAMES = { "Thistle", "Burr" }
PASTURE = { x = 4, y = 22, w = 14, h = 4 }

-- ---------------------------------------------------------------- the world
-- . grass  : path  ~ water  T tree  B brambles  1-3 plots  h hut  c crate  W wagon  N Marrow  m mill
-- X washed-out road  t tin box  M old mine  o standing stone  S fallen pine
-- p pasture  k hen house  g goat shed  r feeding trough
FARM = {
  "BBBBBBBBBBBBBBXXBBBBBBBBBBBBBB",
  "B.T....hhh....::.....T...mmm.B",
  "B......hhh....::.........mmm.B",
  "B..~~..hhh..c.::.WW......mmm.B",
  "B..~~...:.....::.WWN......:..B",
  ":::::::::::::::::::::::::::..B",
  "B............................B",
  "B............................B",
  "B..1111111111....2222222222..B",
  "B..1111111111....2222222222..B",
  "B..1111111111....2222222222..B",
  "B..1111111111....2222222222..B",
  "B..1111111111....2222222222..B",
  "B..1111111111....2222222222..B",
  "B.T..........................B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B.T.......................t..B",
  "B............................B",
  "B...pppppppppppppp.kk.gg.....B",
  "B...pppppppppppppp.kk.gg.....B",
  "B...pppppppppppppp...........B",
  "B...pppppppppppppp.r.........B",
  "B..........................T.B",
  "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
}
WOODS = {
  "TTTTTTTTTTTTTTTTTTTTTTTTTT",
  "TT....TTT..M..TTTT.....TTT",
  "T..o.o.TT.....TTT...t...TT",
  "T.......T..TT..T........TT",
  "T..o.o.....TT.....TT....TT",
  "T..TT...~~.......TTT.....T",
  "TT.....~~~~...T...T......T",
  "T......~~~~..TT..........T",
  "T..T....~~.......TT...TT.T",
  "T..........T.............T",
  "T...TT.........:::::::::::",
  "T...TT...T.....:....T....T",
  "TT.......T..~~.:...TTT...T",
  "T....T......~~.:....T....T",
  "T...TTT........:.........T",
  "T....T....TT...:..TT.....T",
  "T.........TT...:...T..T..T",
  "TT..T..........:......TT.T",
  "T..............:.T.......T",
  "TTTTTTTTTTTTTTTSTTTTTTTTTT",
}
AREAS = { { name = "Windrow", map = FARM }, { name = "Bramble Woods", map = WOODS }, { name = "The Old Mine", w = 20, h = 15, free = {} } }
MINE_FLOORS = 10
-- rocks in the mine: hits to break, what falls out, and from which floor on they turn up
ROCKS = {
  R = { hits = 2, spr = 228 },
  C = { hits = 3, spr = 230, drop = "copper", from = 1 },
  I = { hits = 4, spr = 232, drop = "iron", from = 4 },
  Q = { hits = 5, spr = 234, drop = "glow", from = 7 },
}
PLOTS = {
  { x = 3, y = 8, w = 10, h = 6, name = "Home plot" },
  { x = 17, y = 8, w = 10, h = 6, name = "East meadow", cost = 350 },
  { x = 4, y = 15, w = 22, h = 5, name = "Long acre", cost = 1200 },
}
SOLID = "TB~hcWNmXMoStFkgr#RCIQ<>H"

function hash(x, y, s)
  local n = (x * 374761393 + y * 668265263 + s * 982451653) & 0x7fffffff
  n = ((n ~ (n >> 13)) * 1274126177) & 0x7fffffff
  return (n ~ (n >> 16)) % 1000
end
function clamp(v, a, b) if v < a then return a elseif v > b then return b end return v end
function fl(v) return math.floor(v) end

function build_world()
  for ai, A in ipairs(AREAS) do
    if not A.map then break end
    A.h, A.w = #A.map, #A.map[1]
    A.free = {}
    for y = 0, A.h - 1 do
      if #A.map[y + 1] ~= A.w then error("map row " .. y .. " of " .. A.name .. " has the wrong length") end
      for x = 0, A.w - 1 do
        if A.map[y + 1]:sub(x + 1, x + 1) == "." then A.free[#A.free + 1] = { x, y } end
      end
    end
  end
end
function tile(a, x, y)
  if a == 3 then return MINE and MINE[y] and MINE[y][x] or "#" end
  local A = AREAS[a]
  if y < 0 or y >= A.h then return "B" end
  x = clamp(x, 0, A.w - 1)                      -- the road runs off the edge of the map
  return A.map[y + 1]:sub(x + 1, x + 1)
end
-- the field cell at a farm cell: returns the cell and its plot number
function cell(x, y)
  for p, P in ipairs(PLOTS) do
    if x >= P.x and y >= P.y and x < P.x + P.w and y < P.y + P.h then
      return FIELD[p][(y - P.y) * P.w + (x - P.x) + 1], p
    end
  end
end
function solid(a, x, y)
  local ch = tile(a, x, y)
  if SOLID:find(ch, 1, true) then return true end
  if a == 1 then
    local f = cell(x, y)
    if f and (f.k == 2 or f.k == 3) then return true end
  end
  return false
end

-- a fresh, overgrown plot. k: 0 grass, 1 weeds, 2 stone, 3 stump, 4 dug soil
function wild_plot(p)
  local P, f = PLOTS[p], {}
  for i = 1, P.w * P.h do
    local r, k = hash(i, p, 7), 0
    if r < 480 then k = 1 elseif r < 600 then k = 2 elseif r < 690 then k = 3 end
    if p == 1 and (i - 1) % P.w < 3 and (i - 1) // P.w < 2 then k = 0 end      -- a little clearing to start on
    f[i] = { k = k, c = 0, age = 0, wet = false, hits = 0 }
  end
  return f
end
-- the field is packed into strings for save(): 3 characters a cell
function pack_plot(f)
  local out = {}
  for i, c in ipairs(f) do out[i] = string.char(48 + c.k, 48 + c.c, 48 + c.age * 2 + (c.wet and 1 or 0)) end
  return table.concat(out)
end
function unpack_plot(p, s)
  local f, n = {}, PLOTS[p].w * PLOTS[p].h
  if type(s) ~= "string" or #s ~= n * 3 then return wild_plot(p) end
  for i = 1, n do
    local a, b, c = s:byte(i * 3 - 2, i * 3)
    f[i] = { k = clamp(a - 48, 0, 4), c = clamp(b - 48, 0, #CROPS), age = (c - 48) // 2, wet = (c - 48) % 2 == 1, hits = 0 }
  end
  return f
end

-- ---------------------------------------------------------------- the calendar
function season(d) return ((d or G.day) - 1) // 7 % 4 + 1 end
function day_of(d) return ((d or G.day) - 1) % 7 + 1 end
function year(d) return ((d or G.day) - 1) // 28 + 1 end
function hour() return 6 + G.clk / DAY_FRAMES * 16 end
function in_season(ci, s)
  for _, v in ipairs(CROPS[ci].seasons) do if v == (s or season()) then return true end end
  return false
end
function ripe(f) return f.c > 0 and f.age >= CROPS[f.c].days end
function each_cell(fn)
  for p = 1, #PLOTS do
    if G.plots[p] then for i, f in ipairs(FIELD[p]) do fn(f, p, i) end end
  end
end

function is_egg(o) return o.k == "egg" or o.k == "bigegg" end
function grow_forage()
  local old = FORAGE or {}
  FORAGE = {}
  for _, o in ipairs(old) do if is_egg(o) then FORAGE[#FORAGE + 1] = o end end       -- eggs wait for you
  local s, eat = season(), ({ "garlic", "berry", "mushroom", "cone" })[season()]
  local function put(a, n, seed)
    local A, used = AREAS[a], {}
    for i = 1, n do
      local k = hash(G.day, i, seed) % #A.free + 1
      if not used[k] then
        used[k] = true
        local r, kind = hash(i, G.day, seed + 1), eat
        if r < 220 then kind = "wood" elseif r < 380 then kind = "stone" elseif r < 540 then kind = "fibre" end
        FORAGE[#FORAGE + 1] = { a = a, x = A.free[k][1], y = A.free[k][2], k = kind }
      end
    end
  end
  put(2, 14, 31)
  put(1, 3, 57)
end

-- a night passes. Watered crops (or everything, after rain) grow a day.
function new_day()
  local grew = 0
  each_cell(function(f)
    if f.c > 0 and f.wet and in_season(f.c) and not ripe(f) then f.age = f.age + 1; grew = grew + 1 end
    f.wet = false
  end)
  G.day = G.day + 1
  G.clk = 0
  G.rain = hash(G.day, 3, 11) < ({ 280, 120, 240, 220 })[season()]
  local list = {}
  for i = 1, #CROPS do if in_season(i) then list[#list + 1] = i end end
  G.demand = list[hash(G.day, 5, 13) % #list + 1]
  each_cell(function(f, p, i)
    if G.rain and f.k == 4 then f.wet = true end
    local r = hash(i + p * 400, G.day, 17)
    if f.k == 0 and r < 25 then f.k = 1                         -- weeds creep back
    elseif f.k == 4 and f.c == 0 and r < 60 then f.k = 0 end    -- bare soil grasses over
  end)
  grow_forage()
  animals_night()
  return grew
end

-- ---------------------------------------------------------------- the mine
-- A floor is 20 x 15 and new every day. Pillars (#) only stand on even cells, so they never wall anything in;
-- everything else in the way can be broken. The ladder down hides under one of the rocks.
function mine_floor(n)
  MINE, MOBS, mine_n = {}, {}, n
  local seed = n * 31 + G.day * 7
  local far, fx, fy = -1, 10, 7
  for y = 0, 14 do
    MINE[y] = {}
    for x = 0, 19 do
      local r, ch = hash(x, y, seed), "."
      if x == 0 or y == 0 or x == 19 or y == 14 then ch = "#"
      elseif x % 2 == 0 and y % 2 == 0 and r < 260 then ch = "#"
      elseif x + y <= 4 then ch = "."
      elseif r < 420 then ch = "R"
      elseif r < 420 + 70 then ch = "C"
      elseif r < 490 + 45 and n >= ROCKS.I.from then ch = "I"
      elseif r < 535 + 25 and n >= ROCKS.Q.from then ch = "Q" end
      MINE[y][x] = ch
      if ch == "R" then
        local d = x + y + hash(x, y, seed + 1) % 9
        if d > far then far, fx, fy = d, x, y end
      end
    end
  end
  MINE[1][1] = "<"
  mine_down = n < MINE_FLOORS and { x = fx, y = fy } or nil
  if n == MINE_FLOORS then MINE[7][10] = "H" end
  -- the things that live below floor 3
  for i = 1, math.max(0, n - 3) do
    for try = 1, 20 do
      local x, y = 4 + hash(i, try, seed + 2) % 15, 3 + hash(try, i, seed + 3) % 11
      if MINE[y][x] == "." then
        MOBS[#MOBS + 1] = { x = x * C + 8, y = y * C + 12, hp = n >= 8 and 3 or 2, bat = (i + n) % 3 == 0, hit = 0 }
        break
      end
    end
  end
  G.deep = math.max(G.deep, n)
  px, py, dx, dy = 2 * C + 8, 1 * C + 14, 0, 1
end
function enter_mine(n)
  fade, fade_fn = 1, function()
    G.area, mine_hp, hurt_t = 3, 3, 0
    mine_floor(n)
  end
end
function leave_mine()
  fade, fade_fn = 1, function() G.area, px, py, dx, dy = 2, 11 * C + 8, 2 * C + 14, 0, 1 end
end
function mob_at(x, y)
  local cx, cy = x * C + 8, y * C + 10
  for i, m in ipairs(MOBS) do
    if (m.x - cx) ^ 2 + (m.y - 4 - cy) ^ 2 < 14 * 14 then return i end
  end
end
function mine_hands(x, y)
  local i = mob_at(x, y) or mob_at(fl(px / C), fl((py - 4) / C))
  if i then
    local m = MOBS[i]
    m.hp, m.hit = m.hp - 1, 12
    if not blocked(m.x + dx * 10, m.y + dy * 10) then m.x, m.y = m.x + dx * 10, m.y + dy * 10 end
    swing("chop")
    sfx("A2", 3, 0.3, 5)
    if m.hp <= 0 then
      table.remove(MOBS, i)
      if give("dust", 1) then float("+1 Gloom dust") end
      sfx("C4", 2, 0.3, 10, -1, 0, -400)
    end
    return
  end
  local ch = tile(3, x, y)
  local R = ROCKS[ch]
  if R then
    mine_hits = (mine_at == x + y * 20) and mine_hits + 1 or 1
    mine_at = x + y * 20
    swing("chop")
    sfx(R.drop and "C4" or "A3", 3, 0.3, 5)
    if mine_hits >= R.hits then
      if R.drop and not give(R.drop, 1) then mine_hits = R.hits - 1 return end
      if R.drop then float("+1 " .. FOUND_BY[R.drop].name)
      elseif hash(x, y, G.day) < 350 then give("stone", 1) float("+1 Stone") end
      MINE[y][x] = (mine_down and mine_down.x == x and mine_down.y == y) and ">" or "."
      if MINE[y][x] == ">" then say("A ladder, leading down!") sfx("E5", 1, 0.3, 6) sfx("A5", 1, 0.3, 12) end
      mine_at = nil
    end
  elseif ch == "<" then
    if mine_n == 1 then leave_mine() else enter_floor(mine_n - 1) end
  elseif ch == ">" then enter_floor(mine_n + 1)
  elseif ch == "H" then
    if G.gotms == 1 then say("The chest is empty. You already carried the millstone home.") return end
    G.gotms = 1
    give("millstone", 1)
    give("glow", 2)
    say("The old millstone of Windrow! And two glowstones beside it. Take it to the mill.")
    sfx("C5", 1, 0.3, 8) sfx("E5", 1, 0.3, 14) sfx("G5", 1, 0.3, 22)
    persist()
  elseif ch == "#" then say("Solid rock. No pickaxe gets through this.") end
end
function enter_floor(n)
  fade, fade_fn = 1, function() mine_floor(n) end
end
function update_mobs()
  if hurt_t > 0 then hurt_t = hurt_t - 1 end
  local reach = (G.lamp == 1 and 7 or 5) * C
  for i, m in ipairs(MOBS) do
    if m.hit > 0 then m.hit = m.hit - 1 end
    local ex, ey = px - m.x, py - m.y
    local d = math.sqrt(ex * ex + ey * ey)
    if d < reach and d > 1 and m.hit == 0 then
      local sp = (m.bat and 0.75 or 0.45) + mine_n * 0.02
      local nx, ny = m.x + ex / d * sp, m.y + ey / d * sp
      if m.bat then m.x, m.y = nx, ny
      else
        if not blocked(nx, m.y) then m.x = nx end
        if not blocked(m.x, ny) then m.y = ny end
      end
    end
    if d < 9 and hurt_t == 0 then
      mine_hp, hurt_t = mine_hp - 1, 90
      sfx("E3", 2, 0.4, 12, -1, 0, -200)
      float("ouch!", 26)
      if not blocked(px - ex / d * 8, py - ey / d * 8) and d > 0 then px, py = px - ex / d * 8, py - ey / d * 8 end
      if mine_hp <= 0 then
        -- you come round in your own bed, lighter by half the ore you carried
        for _, k in ipairs({ "copper", "iron", "glow", "dust" }) do
          if have(k) > 0 then G.inv[k] = have(k) - have(k) // 2 end
        end
        sleep()
        say("Everything went dark. Marrow carried you home. Half your ore is gone.")
        return
      end
    end
  end
end
function mine_door()
  if G.mine == 0 then
    if G.pick == 0 then say("The old mine. Boarded up, and the boards are nailed fast. A pickaxe might pry them off.") return end
    G.mine = 1
    say("You pry the boards off with the pickaxe. Cold air blows out of the dark.")
    sfx("E3", 3, 0.3, 8) sfx("C3", 3, 0.3, 14)
    persist()
    return
  end
  if G.deep >= 5 then ui, ui_sel = "lift", 1 else enter_mine(1) end
end
function lift_floors()
  local L = { 1 }
  if G.deep >= 5 then L[#L + 1] = 5 end
  if G.deep >= 9 then L[#L + 1] = 9 end
  return L
end

-- ---------------------------------------------------------------- animals
function herd(k)
  local n = 0
  for _, a in ipairs(G.an) do if a.k == k then n = n + 1 end end
  return n
end
function animal_name(a) return (a.k == "h" and HEN_NAMES or GOAT_NAMES)[a.n] or "Friend" end
-- every animal eats one helping from the trough. Fed hens lay, fed goats have milk; hungry ones lose heart.
function animals_night()
  local eggs = 0
  for _, o in ipairs(FORAGE) do if is_egg(o) then eggs = eggs + 1 end end
  for i, a in ipairs(G.an) do
    a.p = 0
    if G.feed > 0 then
      G.feed = G.feed - 1
      if a.k == "g" then a.m = 1
      elseif eggs < herd("h") * 2 then
        local big = hash(G.day, i, 71) < a.love * 5
        local x = PASTURE.x + hash(G.day, i, 73) % PASTURE.w
        local y = PASTURE.y + hash(G.day, i, 79) % PASTURE.h
        if not forage_at(1, x, y) then
          FORAGE[#FORAGE + 1] = { a = 1, x = x, y = y, k = big and "bigegg" or "egg" }
          eggs = eggs + 1
        end
      end
    else
      a.m = 0
      a.love = math.max(0, a.love - 8)
    end
  end
end
function add_animal(k)
  local n = herd(k) + 1
  G.an[#G.an + 1] = { k = k, n = n, love = 10, p = 0, m = 0 }
  place_animals()
end
-- where they stand is not saved: they wander the pasture
function place_animals()
  local old = ANIM or {}
  ANIM = {}
  for i, a in ipairs(G.an) do
    ANIM[i] = old[i] or { x = (PASTURE.x + rnd(PASTURE.w) - 1) * C + 8, y = (PASTURE.y + rnd(PASTURE.h) - 1) * C + 12, tx = 0, ty = 0, wait = rnd(120), face = 1, step = 0 }
  end
end
function update_animals()
  for i, m in ipairs(ANIM) do
    if m.wait > 0 then
      m.wait = m.wait - 1
      if m.wait == 0 then
        m.tx = (PASTURE.x + rnd(PASTURE.w) - 1) * C + 8
        m.ty = (PASTURE.y + rnd(PASTURE.h) - 1) * C + 12
      end
    else
      local ex, ey = m.tx - m.x, m.ty - m.y
      local d = math.sqrt(ex * ex + ey * ey)
      if d < 1 then m.wait = 60 + rnd(240)
      else
        local sp = G.an[i].k == "h" and 0.5 or 0.35
        m.x, m.y, m.step = m.x + ex / d * sp, m.y + ey / d * sp, m.step + 1
        if math.abs(ex) > 1 then m.face = ex < 0 and -1 or 1 end
      end
    end
  end
end
function animal_at(x, y)
  local cx, cy, best, bd = x * C + 8, y * C + 10, nil, 15 * 15
  for i, m in ipairs(ANIM) do
    local d = (m.x - cx) ^ 2 + (m.y - 4 - cy) ^ 2
    if d < bd then best, bd = i, d end
  end
  return best
end
function tend(i)
  local a, m = G.an[i], ANIM[i]
  m.wait = math.max(m.wait, 90)
  if a.k == "g" and a.m == 1 then
    if G.pail == 0 then say(animal_name(a) .. " has milk for you, but you need a pail. Marrow has one.") return end
    local k = a.love >= 60 and "cream" or "milk"
    if give(k, 1) then
      a.m = 0
      float("+1 " .. FOUND_BY[k].name)
      sfx("G4", 4, 0.25, 8) sfx("C5", 4, 0.25, 12)
      swing("pick")
    end
  elseif a.p == 0 then
    a.p, a.love = 1, math.min(100, a.love + 6)
    float(animal_name(a) .. " <3", 26)
    sfx(a.k == "h" and "A5" or "D4", a.k == "h" and 1 or 2, 0.2, 6)
    swing("pick")
  else
    say(animal_name(a) .. " is content. " .. hearts(a) .. " of 10 hearts.")
  end
end
function hearts(a) return a.love // 10 end
-- the trough takes the cheapest food in your bag
function fill_trough()
  local best, bv = nil, 1e9
  for k, v in pairs(G.inv) do
    local f = FOUND_BY[k]
    local food = CROP_BY[k] or (f and not f.mat and k ~= "egg" and k ~= "bigegg" and k ~= "milk" and k ~= "cream")
    if v > 0 and food and price(k) < bv then best, bv = k, price(k) end
  end
  if not best then say("The trough holds " .. G.feed .. " helpings. Crops and wild food from your bag go in here.") return end
  if G.feed >= 30 then say("The trough is full.") return end
  G.inv[best] = have(best) - 1
  if G.inv[best] == 0 then G.inv[best] = nil end
  G.feed = G.feed + (CROP_BY[best] and 2 or 1)
  float("trough " .. G.feed, 17)
  sfx("E4", 3, 0.2, 4)
  swing("plant")
end
function update_build()
  local Bd = BUILD[ui_kind]
  if btnp("b") then ui = nil return end
  if not btnp("a") then return end
  local ok = G.coins >= Bd.coins
  for k, n in pairs(Bd.need) do if have(k) < n then ok = false end end
  if not ok then sfx("C3", 0, 0.2, 6) return end
  G.coins = G.coins - Bd.coins
  for k, n in pairs(Bd.need) do G.inv[k] = have(k) - n end
  G[ui_kind] = 1
  ui = nil
  sfx("C5", 1, 0.3, 8) sfx("E5", 1, 0.3, 14) sfx("G5", 1, 0.3, 22)
  say("The " .. Bd.name:lower() .. " stands! Marrow can bring you " .. (ui_kind == "coop" and "hens." or "goats and a pail."))
  persist()
end

-- ---------------------------------------------------------------- start, save, load
function fresh()
  return { v = 1, coins = 0, day = 1, clk = 0, area = 1, px = 8 * C + 8, py = 4 * C + 14, sel = 1,
    seeds = { 4, 0, 0, 0, 0, 0, 0, 0, 0 }, inv = {}, bag = 1, hoe = 1, can = 1, water = 5, pick = 0, axe = 0,
    plots = { true, false, false }, mill = 0, millc = 0, rain = false, demand = 1, tins = "00",
    sold = 0, picked = 0, grown = 0, mine = 0, deep = 0, lamp = 0, gotms = 0, coop = 0, shed = 0, pail = 0, feed = 0, an = {} }
end

function persist()
  if PLAYERS > 1 then return end
  G.px, G.py = fl(px), fl(py)
  local in_mine = G.area == 3
  if in_mine then G.area, G.px, G.py = 2, 11 * C + 8, 2 * C + 14 end      -- a save made underground wakes at the mine door
  G.f = {}
  for p = 1, #PLOTS do G.f[p] = pack_plot(FIELD[p]) end
  local out = {}
  for i, o in ipairs(FORAGE) do out[i] = o.a .. "," .. o.x .. "," .. o.y .. "," .. o.k end
  G.forage = table.concat(out, ";")
  G.ts = clock()
  save(G)
  if in_mine then G.area = 3 end
end

function load_farm()
  G = fresh()
  local d = PLAYERS == 1 and saved() or nil
  if type(d) == "table" and d.v == 1 then
    for k, v in pairs(d) do
      if G[k] == nil or type(G[k]) == type(v) then G[k] = v end
    end
  else
    d = nil
  end
  FIELD = {}
  for p = 1, #PLOTS do FIELD[p] = d and unpack_plot(p, d.f and d.f[p]) or wild_plot(p) end
  FORAGE = {}
  if d and type(d.forage) == "string" then
    for a, x, y, k in d.forage:gmatch("(%d+),(%d+),(%d+),(%a+)") do
      if FOUND_BY[k] then FORAGE[#FORAGE + 1] = { a = tonumber(a), x = tonumber(x), y = tonumber(y), k = k } end
    end
  else
    grow_forage()
  end
  G.area = clamp(G.area, 1, 2)
  px, py = G.px, G.py
  MINE, MOBS, mine_n, mine_hp, hurt_t, mine_hits, mine_at = nil, {}, 0, 3, 0, 0, nil
  ANIM = nil
  place_animals()
  -- while the Bit was off: the farm carries on, a few days at most
  report = nil
  if d and d.ts then
    local away = clock() - d.ts
    local n = math.min(AWAY_MAX, away // AWAY_DAY)
    if n >= 1 then
      local grew, rain = 0, 0
      for i = 1, n do
        grew = grew + new_day()
        if G.rain then rain = rain + 1 end
      end
      local ready = 0
      each_cell(function(f) if ripe(f) then ready = ready + 1 end end)
      report = { days = n, grew = grew, rain = rain, ready = ready, h = away // 3600, m = away % 3600 // 60 }
      G.area, px, py = 1, 8 * C + 8, 4 * C + 14
      persist()
    end
  end
end

function _init()
  build_world()
  game{
    title = "Windrow",
    goal = "Rebuild the old windmill of Windrow.",
    title_draw = draw_title,
    look = { title = 27, shadow = 7, panel = 6, edge = 10, hi = 8, text = 12, pick = 27, goal = 12, footer = 11, menu = "left" },
    help = {
      "A: use your hands on what is in front of you. Pull weeds, dig, plant, pick and talk.",
      "B: water. Fill up at a pond. L / R: pick seeds. X: your bag. Y: look closer.",
      "Watered crops grow overnight. Sleep in the hut, sell at the crate, shop at the wagon.",
      "Bramble Woods lies west along the road. Bring what the mill needs to the ruin.",
      "The mine in the woods opens with a pickaxe. Break rocks for ore, find the ladder down. A also hits.",
      "The pasture is south of the fields. Fill the trough from your bag, pet your animals every day.",
    },
    music = true,
    can_continue = function() return PLAYERS == 1 and saved() ~= nil end,
    new_game = function() save(nil); _init() end,
  }
  load_farm()
  dx, dy, walk, act, act_kind, hold, ui_kind = 0, 1, 0, 0, "", 0, "coop"
  ui, ui_sel, ui_scroll, toast, toast_t, fade, fade_fn = report and "report" or nil, 1, 0, nil, 0, 0, nil
  floats, save_t, tune_i = {}, 0, 0
  if G.mill >= 3 then won_told = true else won_told = false end
end

-- ---------------------------------------------------------------- helpers
function say(s) toast, toast_t = s, 60 + #s * 3 end
function float(s, c) floats[#floats + 1] = { x = px, y = py - 20, s = s, c = c or 13, t = 45 } end
function count_bag()
  local n = 0
  for k, v in pairs(G.inv) do
    if not (FOUND_BY[k] and FOUND_BY[k].mat) then n = n + v end
  end
  return n
end
function have(k) return G.inv[k] or 0 end
function give(k, n)
  local mat = FOUND_BY[k] and FOUND_BY[k].mat
  if not mat and count_bag() + n > BAG[G.bag] then
    say("Your bag is full. Sell at the crate by the hut.")
    sfx("C3", 0, 0.2, 6)
    return false
  end
  G.inv[k] = have(k) + n
  return true
end
function crops_in_bag()
  local n = 0
  for i, c in ipairs(CROPS) do n = n + have(c.key) end
  return n
end
function price(k)
  local ci = CROP_BY[k]
  if not ci then return FOUND_BY[k].sell or 0 end
  local v = CROPS[ci].sell
  if ci == G.demand then v = v * 3 // 2 end
  if CROPS[ci].grain and G.mill >= 2 then v = v * 2 end       -- the mill grinds it to flour
  return v
end
function pick_seed(dir)
  for i = 1, #CROPS do
    G.sel = (G.sel - 1 + dir) % #CROPS + 1
    if G.seeds[G.sel] > 0 then return end
  end
end
function facing()
  return fl(px / C) + dx, fl((py - 4) / C) + dy
end
function forage_at(a, x, y)
  for i, o in ipairs(FORAGE) do if o.a == a and o.x == x and o.y == y then return o, i end end
end

function sell_all()
  local total, n = 0, 0
  for k, v in pairs(G.inv) do
    if v > 0 and not (FOUND_BY[k] and FOUND_BY[k].mat) then
      total = total + price(k) * v
      n = n + v
      G.inv[k] = nil
    end
  end
  if n == 0 then say("The crate is for crops and wild food. Your bag is empty.") return end
  G.coins = G.coins + total
  G.sold = G.sold + n
  say("Sold " .. n .. (n == 1 and " thing" or " things") .. " for " .. total .. " coins.")
  float("+" .. total, 27)
  sfx("E5", 1, 0.3, 6) sfx("A5", 1, 0.3, 10)
  persist()
end

function sleep()
  fade, fade_fn = 1, function()
    new_day()
    G.area, px, py, dx, dy = 1, 8 * C + 8, 4 * C + 14, 0, 1
    persist()
    say(SEASON[season()] .. " " .. day_of() .. ". " .. (G.rain and (season() == 4 and "Snow is falling: the soil is wet." or "It is raining: the soil is wet.") or "A clear morning."))
  end
end

-- ---------------------------------------------------------------- your hands (A) and the bucket (B)
function swing(kind) act, act_kind = 14, kind end

function use_hands()
  local x, y = facing()
  local a = G.area
  if a == 3 then mine_hands(x, y) return end
  local o, oi = forage_at(a, x, y)
  if not o then o, oi = forage_at(a, fl(px / C), fl((py - 4) / C)) end
  if o then
    if give(o.k, 1) then
      table.remove(FORAGE, oi)
      G.picked = G.picked + 1
      float("+1 " .. FOUND_BY[o.k].name)
      sfx("G5", 1, 0.25, 5)
      swing("pick")
    end
    return
  end
  local ch = tile(a, x, y)
  if a == 1 then
    local an = animal_at(x, y) or animal_at(fl(px / C), fl((py - 4) / C))
    if an then tend(an) return end
  end
  if ch == "k" or ch == "g" then
    local kind = ch == "k" and "coop" or "shed"
    if G[kind] == 0 then ui, ui_kind = "build", kind
    elseif kind == "coop" then say("The hen house. " .. herd("h") .. " of 4 hens live here.")
    else say("The goat shed. " .. herd("g") .. " of 2 goats live here.") end
    return
  end
  if ch == "r" then fill_trough() return end
  if ch == "h" then ui, ui_sel = "sleep", 1 return end
  if ch == "c" then sell_all() return end
  if ch == "W" or ch == "N" then ui, ui_sel, ui_scroll = "shop", 1, 0 return end
  if ch == "m" then ui, ui_sel = "mill", 1 return end
  if ch == "X" then say("The road to Tallow Bridge is washed out. Maybe one day.") return end
  if ch == "M" then mine_door() return end
  if ch == "S" then say("A fallen pine blocks the path down to the shore.") return end
  if ch == "o" then say("A standing stone, older than the valley. It hums a little.") return end
  if ch == "t" then
    local n = a
    if G.tins:sub(n, n) == "1" then say("An empty tin box.") return end
    G.tins = G.tins:sub(1, n - 1) .. "1" .. G.tins:sub(n + 1)
    G.coins = G.coins + 40
    G.seeds[2] = G.seeds[2] + 6
    say("A rusty tin box! Inside: 40 coins and 6 barley seeds.")
    sfx("C5", 1, 0.3, 6) sfx("G5", 1, 0.3, 12)
    persist()
    return
  end
  if ch == "~" then say("Water. Press B to fill your " .. CAN[G.can].name:lower() .. ".") return end
  if ch == "T" then say("A tall pine.") return end
  if a ~= 1 then return end
  local f, p = cell(x, y)
  if not f then return end
  if not G.plots[p] then say(PLOTS[p].name .. " is not yours yet. Marrow sells the deed.") return end
  if f.k == 1 then
    f.hits = f.hits + 1
    swing("pull")
    sfx("D4", 3, 0.2, 4)
    if f.hits >= 2 then
      f.k, f.hits = 0, 0
      give("fibre", 1)
      float("+1 Fibre")
    end
  elseif f.k == 2 or f.k == 3 then
    local stone = f.k == 2
    if (stone and G.pick or G.axe) == 0 then
      say(stone and "A stone, too heavy to move. A pickaxe would break it." or "An old stump. You would need an axe.")
      return
    end
    f.hits = f.hits + 1
    swing("chop")
    sfx(stone and "A3" or "E3", 3, 0.3, 5)
    if f.hits >= (stone and 3 or 4) then
      f.k, f.hits = 0, 0
      give(stone and "stone" or "wood", 2)
      float(stone and "+2 Stone" or "+2 Wood")
    end
  elseif f.k == 0 then
    f.hits = f.hits + 1
    swing("dig")
    sfx("C3", 3, 0.25, 4)
    if f.hits >= HOE[G.hoe].hits then f.k, f.hits = 4, 0 end
  elseif f.c == 0 then
    if G.seeds[G.sel] <= 0 then pick_seed(1) end
    if G.seeds[G.sel] <= 0 then say("No seeds. Marrow's wagon by the road sells them.") return end
    if not in_season(G.sel) then say(CROPS[G.sel].name .. " does not grow in " .. SEASON[season()]:lower() .. ".") return end
    G.seeds[G.sel] = G.seeds[G.sel] - 1
    f.c, f.age = G.sel, 0
    swing("plant")
    sfx("E4", 1, 0.2, 4)
  elseif ripe(f) then
    local c = CROPS[f.c]
    if give(c.key, 1) then
      G.grown = G.grown + 1
      float("+1 " .. c.name)
      sfx("C5", 1, 0.25, 4) sfx("E5", 1, 0.25, 8)
      swing("pick")
      if c.regrow then f.age = c.days - c.regrow else f.c, f.age = 0, 0 end
    end
  else
    look()
  end
end

function use_water()
  local x, y = facing()
  if tile(G.area, x, y) == "~" then
    G.water = CAN[G.can].n
    swing("fill")
    sfx("C4", 4, 0.3, 10, -1, 0, 300)
    return
  end
  local f, p = nil, nil
  if G.area == 1 then f, p = cell(x, y) end
  if not f or not G.plots[p] or f.k ~= 4 then return end
  if f.wet then return end
  if G.water <= 0 then
    say("Your " .. CAN[G.can].name:lower() .. " is empty. Fill it at the pond.")
    sfx("C3", 0, 0.2, 6)
    hold = -30
    return
  end
  G.water = G.water - 1
  f.wet = true
  swing("water")
  sfx("G4", 3, 0.15, 6)
end

-- Y: what is this?
function look()
  local x, y = facing()
  local f, p = nil, nil
  if G.area == 1 then f, p = cell(x, y) end
  if f and G.plots[p] and f.c > 0 then
    local c = CROPS[f.c]
    if ripe(f) then say(c.name .. ": ready to pick.")
    elseif not in_season(f.c) then say(c.name .. ": waiting for " .. SEASON[c.seasons[1]]:lower() .. ".")
    else
      local left = c.days - f.age
      say(c.name .. ": " .. left .. (left == 1 and " more day" or " more days") .. (f.wet and "." or ". It needs water."))
    end
  elseif f and G.plots[p] and f.k == 4 then say(f.wet and "Dug soil, watered." or "Dug soil. A plants a seed.")
  elseif G.area == 1 and animal_at(x, y) then
    local an = G.an[animal_at(x, y)]
    say(animal_name(an) .. " the " .. (an.k == "h" and "hen" or "goat") .. ". " .. hearts(an) .. " of 10 hearts." .. (an.p == 0 and " Wants a pat." or ""))
  elseif tile(G.area, x, y) == "r" then say("The trough holds " .. G.feed .. " helpings. Each animal eats one a night.")
  elseif forage_at(G.area, x, y) then say(FOUND_BY[forage_at(G.area, x, y).k].name .. ". A picks it up.")
  else say(AREAS[G.area].name .. ", " .. SEASON[season()]:lower() .. " " .. day_of() .. " of year " .. year() .. ".") end
end

-- ---------------------------------------------------------------- Marrow's wagon
function shop_items()
  local L = {}
  for i, c in ipairs(CROPS) do
    if in_season(i) then
      L[#L + 1] = { name = c.name .. " seed", cost = c.seed, own = G.seeds[i],
        about = c.days .. " days. Sells for " .. c.sell .. (c.regrow and ", and keeps bearing." or "."),
        buy = function() G.seeds[i] = G.seeds[i] + 1 end }
    end
  end
  local function once(name, cost, about, ok, buy)
    if ok then L[#L + 1] = { name = name, cost = cost, about = about, buy = buy, once = true } end
  end
  once("Hoe", 80, "Digs a cell in one go, not three.", G.hoe == 1, function() G.hoe = 2 end)
  once("Watering can", 60, "Holds 14 splashes. The bucket holds 5.", G.can == 1, function() G.can = 2; G.water = 14 end)
  once("Big can", 350, "Holds 36 splashes.", G.can == 2, function() G.can = 3; G.water = 36 end)
  once("Basket", 120, "Carry 40 things, not 16.", G.bag == 1, function() G.bag = 2 end)
  once("Pack", 600, "Carry 100 things.", G.bag == 2, function() G.bag = 3 end)
  once("Pickaxe", 150, "Breaks the stones on your land.", G.pick == 0, function() G.pick = 1 end)
  once("Axe", 150, "Splits the old stumps on your land.", G.axe == 0, function() G.axe = 1 end)
  once("Lantern", 180, "Lights more of the mine around you.", G.mine == 1 and G.lamp == 0, function() G.lamp = 1 end)
  once("Hen", 120, "Lays an egg a day when fed. Pet her for bigger eggs.", G.coop == 1 and herd("h") < 4, function() add_animal("h") end)
  once("Goat", 350, "Gives milk every day when fed. Loved goats give creamy milk.", G.shed == 1 and herd("g") < 2, function() add_animal("g") end)
  once("Milk pail", 50, "You can't milk a goat into your hat.", G.shed == 1 and G.pail == 0, function() G.pail = 1 end)
  for p = 2, #PLOTS do
    once("Deed: " .. PLOTS[p].name, PLOTS[p].cost, PLOTS[p].w * PLOTS[p].h .. " cells of wild land to clear.",
      not G.plots[p] and G.plots[p - 1], function() G.plots[p] = true end)
  end
  return L
end

function update_shop()
  local L = shop_items()
  if btnp("up") then ui_sel = (ui_sel - 2) % #L + 1 end
  if btnp("down") then ui_sel = ui_sel % #L + 1 end
  ui_sel = clamp(ui_sel, 1, #L)
  if ui_sel - ui_scroll > 7 then ui_scroll = ui_sel - 7 end
  if ui_sel <= ui_scroll then ui_scroll = ui_sel - 1 end
  local go = btnp("a")
  if btn("a") then hold = hold + 1 else hold = 0 end
  if hold > 24 and hold % 4 == 0 and not L[ui_sel].once then go = true end
  if go then
    local it = L[ui_sel]
    if G.coins >= it.cost then
      G.coins = G.coins - it.cost
      it.buy()
      sfx("E5", 1, 0.25, 4)
      if it.once then say("Marrow: \\"" .. it.name .. ". Look after it.\\"") persist() end
    else
      sfx("C3", 0, 0.2, 6)
    end
  end
  if btnp("b") or btnp("x") then ui = nil; persist() end
end

-- ---------------------------------------------------------------- the mill
function mill_ready()
  local M = MILL[G.mill + 1]
  if not M then return false end
  if G.coins < M.coins or G.millc < M.crops then return false end
  for k, n in pairs(M.need) do if have(k) < n then return false end end
  return true
end
function update_mill()
  local M = MILL[G.mill + 1]
  if btnp("b") or not M then ui = nil return end
  if not btnp("a") then return end
  if G.millc < M.crops and crops_in_bag() > 0 then
    local n = 0
    for i, c in ipairs(CROPS) do
      local take = math.min(have(c.key), M.crops - G.millc - n)
      if take > 0 then G.inv[c.key] = have(c.key) - take; n = n + take end
    end
    G.millc = G.millc + n
    say("You hand over " .. n .. (n == 1 and " crop" or " crops") .. " for the builders.")
    sfx("E5", 1, 0.25, 6)
    persist()
  elseif mill_ready() then
    G.coins = G.coins - M.coins
    for k, n in pairs(M.need) do G.inv[k] = have(k) - n end
    G.mill, G.millc = G.mill + 1, 0
    sfx("C5", 1, 0.3, 8) sfx("E5", 1, 0.3, 14) sfx("G5", 1, 0.3, 22)
    ui = nil
    persist()
    if G.mill >= #MILL then
      game_win("The sails of Windrow turn again!")
    else
      say(G.mill == 1 and "The frame stands! Next: the sails." or "The sails are up! Grain now sells for double. Next: the millstone.")
    end
  else
    sfx("C3", 0, 0.2, 6)
  end
end

-- ---------------------------------------------------------------- update
function blocked(nx, ny)
  local a = G.area
  for _, o in ipairs({ { -4, -1 }, { 4, -1 }, { -4, -7 }, { 4, -7 } }) do
    if solid(a, fl((nx + o[1]) / C), fl((ny + o[2]) / C)) then return true end
  end
  return false
end

function play_tune()
  tune_i = tune_i + 1
  if tune_i % 22 ~= 0 then return end
  local n = tune_i // 22
  local mel = ({ "C4", "E4", "G4", "", "A4", "G4", "E4", "", "D4", "F4", "A4", "", "G4", "E4", "D4", "",
                 "C4", "E4", "G4", "C5", "A4", "", "G4", "", "F4", "E4", "D4", "", "C4", "", "", "" })[(n - 1) % 32 + 1]
  if mel ~= "" then mus(mel, 1, 0.16, 18) end
  if n % 8 == 1 then mus(({ "C3", "F3", "G3", "C3" })[(n // 8) % 4 + 1], 4, 0.14, 60) end
end

function _update()
  play_tune()
  if toast_t > 0 then toast_t = toast_t - 1 end
  for i = #floats, 1, -1 do
    local f = floats[i]
    f.t, f.y = f.t - 1, f.y - 0.4
    if f.t <= 0 then table.remove(floats, i) end
  end
  if fade > 0 then
    fade = fade + 1
    if fade == 30 and fade_fn then fade_fn(); fade_fn = nil end
    if fade >= 60 then fade = 0 end
    return
  end
  if ui == "shop" then update_shop() return end
  if ui == "mill" then update_mill() return end
  if ui == "build" then update_build() return end
  if ui == "lift" then
    local L = lift_floors()
    if btnp("up") then ui_sel = (ui_sel - 2) % #L + 1 end
    if btnp("down") then ui_sel = ui_sel % #L + 1 end
    if btnp("a") then ui = nil; enter_mine(L[ui_sel]) elseif btnp("b") then ui = nil end
    return
  end
  if ui == "bag" then if btnp("b") or btnp("x") or btnp("a") then ui = nil end return end
  if ui == "report" then if btnp("a") or btnp("b") then ui = nil end return end
  if ui == "sleep" then
    if btnp("a") then ui = nil; sleep() elseif btnp("b") then ui = nil end
    return
  end

  -- the day goes by; at ten at night you nod off
  G.clk = G.clk + 1
  if G.clk >= DAY_FRAMES then
    sleep()
    say("You fell asleep on your feet.")
    return
  end
  if G.area == 1 then update_animals() end
  if G.area == 3 then
    update_mobs()
    if fade > 0 then return end
  end
  save_t = save_t + 1
  if save_t >= 1200 then save_t = 0; persist() end

  if act > 0 then act = act - 1 return end
  local mx, my = 0, 0
  if btn("left") then mx = -1 elseif btn("right") then mx = 1 end
  if btn("up") then my = -1 elseif btn("down") then my = 1 end
  if mx ~= 0 or my ~= 0 then
    if mx ~= 0 and my ~= 0 then
      if dx == 0 and dy == 0 then dx, dy = mx, 0 end
    end
    if my ~= 0 and mx == 0 then dx, dy = 0, my elseif mx ~= 0 and my == 0 then dx, dy = mx, 0 end
    local sp = (mx ~= 0 and my ~= 0) and WALK * 0.75 or WALK
    if not blocked(px + mx * sp, py) then px = px + mx * sp end
    if not blocked(px, py + my * sp) then py = py + my * sp end
    walk = walk + 1
    if walk % 16 == 0 and G.area == 2 then sfx("C2", 3, 0.05, 2) end
  else
    walk = 0
  end
  -- the road west leads to the woods, and back
  local A = AREAS[G.area]
  if G.area == 1 and px < 3 then G.area, px, py = 2, AREAS[2].w * C - 8, 10 * C + 12; fade = 31; persist()
  elseif G.area == 2 and px > A.w * C - 3 then G.area, px, py = 1, 8, 5 * C + 12; fade = 31; persist() end
  px, py = clamp(px, 2, AREAS[G.area].w * C - 2), clamp(py, 8, AREAS[G.area].h * C - 1)

  if btn("a") or btn("b") then hold = hold + 1 else hold = 0 end
  local again = hold > 0 and hold % 16 == 0
  if btnp("a") or (btn("a") and again) then use_hands()
  elseif btnp("b") or (btn("b") and again) then use_water()
  elseif btnp("y") then look()
  elseif btnp("x") then ui = "bag"
  elseif btnp("l") then pick_seed(-1) sfx("E4", 1, 0.15, 3)
  elseif btnp("r") then pick_seed(1) sfx("E4", 1, 0.15, 3) end
end

-- ---------------------------------------------------------------- drawing: crops, buildings, the world
function crop_stage(f)
  local c = CROPS[f.c]
  if f.age >= c.days then return 3 end
  if f.age == 0 then return 0 end
  if f.age * 2 < c.days then return 1 end
  return 2
end

function draw_crop(ci, s, x, y, ph)
  local c = CROPS[ci]
  local cx, by = x + 8, y + 13
  local sw = fl(math.sin((t() + (ph or 0) * 9) / 25) * 1.5 + 0.5)
  if s == 0 then pset(cx - 3, by - 2, 11) pset(cx + 2, by - 3, 11) pset(cx, by, 11) return end
  if s == 1 then
    line(cx, by, cx, by - 3, 16)
    pset(cx - 1, by - 4, 17) pset(cx + 1, by - 4, 17) pset(cx - 2, by - 5, 17) pset(cx + 2, by - 5, 17)
    return
  end
  local sh = c.shape
  if sh == "root" then
    for i = -2, 2 do line(cx + i, by - 1, cx + i * 2 + sw, by - 6 - (s == 3 and 2 or 0) + math.abs(i), i % 2 == 0 and 16 or 17) end
    if s == 3 then circfill(cx, by, 3, c.col) pset(cx - 1, by - 1, 13) end
  elseif sh == "grain" then
    local hgt = (c.tall and 13 or 9) - (s == 2 and 4 or 0)
    for i = -1, 1 do
      local bx = cx + i * 4
      line(bx, by, bx + sw, by - hgt, s == 3 and c.stalk or 16)
      if s == 3 then rectfill(bx + sw - 1, by - hgt - 1, 3, c.tall and 5 or 4, c.col) else pset(bx + sw + 1, by - hgt + 2, 17) end
    end
  elseif sh == "vine" then
    line(cx, by, cx, by - 13, 8)
    for i = 0, (s == 3 and 5 or 3) do circfill(cx + ((i % 2) * 2 - 1) * 2, by - 2 - i * 2, 2, i % 2 == 0 and 16 or 15) end
    if s == 3 then circfill(cx - 3, by - 5, 1, c.col) circfill(cx + 3, by - 8, 1, c.col) circfill(cx - 2, by - 11, 1, c.col) end
  elseif sh == "ground" then
    circfill(cx - 4, by - 2, 3, 15) circfill(cx + 4, by - 3, 3, 16) circfill(cx, by - 5, 3, 16)
    if s == 3 then circfill(cx, by - 3, 5, c.col) circfill(cx - 2, by - 5, 1, c.hi) line(cx, by - 9, cx + 1, by - 8, 15) end
  elseif sh == "leek" then
    for i = -1, 1 do line(cx + i * 3, by, cx + i * 4 + sw, by - (s == 3 and 11 or 6), c.col) end
    if s == 3 then for i = -1, 1 do line(cx + i * 3, by, cx + i * 3, by - 3, 13) end end
  else
    for i = -1, 1, 2 do
      local bx = cx + i * 3
      line(bx, by, bx, by - 3, 12)
      if s == 3 then rectfill(bx - 3, by - 6, 7, 3, c.col) pset(bx - 1, by - 5, 13) else rectfill(bx - 1, by - 4, 3, 2, c.col) end
    end
  end
end

function draw_icon(k, x, y)
  if CROP_BY[k] then draw_crop(CROP_BY[k], 3, x, y, 0) else spr(FOUND_BY[k].spr, x, y, 2, 2) end
end

function draw_hut(x, y)             -- 48 x 48, a one-room hut with a thatched roof
  rectfill(x + 6, y + 22, 36, 26, 12) rect(x + 6, y + 22, 36, 26, 7)
  for i = 0, 22 do line(x + 24 - i - 2, y + 4 + i, x + 24 + i + 1, y + 4 + i, i % 4 < 2 and 27 or 10) end
  line(x + 1, y + 26, x + 24, y + 3, 8) line(x + 46, y + 26, x + 24, y + 3, 8)
  rectfill(x + 20, y + 32, 9, 16, 8) rect(x + 20, y + 32, 9, 16, 6) pset(x + 26, y + 40, 27)
  rectfill(x + 32, y + 30, 7, 7, hour() > 18 and 27 or 21) rect(x + 32, y + 30, 7, 7, 7)
  rectfill(x + 10, y + 8, 5, 10, 28) rect(x + 10, y + 8, 5, 10, 30)
  if t() % 40 < 20 then circfill(x + 12, y + 4 - t() % 40 // 4, 2, 29) end
end
function draw_crate(x, y)
  rectfill(x + 1, y + 3, 14, 12, 9) rect(x + 1, y + 3, 14, 12, 6)
  line(x + 1, y + 7, x + 14, y + 7, 7) line(x + 1, y + 11, x + 14, y + 11, 7)
  rectfill(x + 4, y + 1, 8, 3, 8) text("$", x + 5, y + 5, 27)
end
function draw_wagon(x, y)           -- 32 x 32
  rectfill(x + 2, y + 14, 28, 10, 8) rect(x + 2, y + 14, 28, 10, 6)
  for i = 0, 5 do rectfill(x + 2 + i * 5, y + 2, 5, 12, i % 2 == 0 and 25 or 12) end
  rect(x + 2, y + 2, 29, 12, 6)
  circfill(x + 8, y + 26, 5, 6) circfill(x + 8, y + 26, 3, 9) circfill(x + 24, y + 26, 5, 6) circfill(x + 24, y + 26, 3, 9)
  rectfill(x + 6, y + 16, 5, 4, 26) rectfill(x + 13, y + 16, 5, 4, 27) rectfill(x + 20, y + 16, 5, 4, 17)
end
function sails(cx, cy, a, len, cloth)
  for k = 0, 3 do
    local c, s = math.cos(a + k * math.pi / 2), math.sin(a + k * math.pi / 2)
    line(cx, cy, cx + c * len, cy + s * len, 7)
    if cloth then
      for j = 6, len - 1, 2 do
        line(cx + c * j, cy + s * j, cx + c * j - s * 5, cy + s * j + c * 5, j % 4 == 0 and 12 or 13)
      end
    end
  end
  circfill(cx, cy, 2, 6)
end
function draw_mill(x, y, stage)     -- 48 x 48: a ruin, a frame, then sails, then turning sails
  for i = 0, 3 do circfill(x + 8 + i * 10, y + 44 - (i % 2), 5, 28) end
  rectfill(x + 6, y + 40, 36, 8, 28) rect(x + 6, y + 40, 36, 8, 30)
  if stage == 0 then
    line(x + 12, y + 40, x + 20, y + 18, 7) line(x + 13, y + 40, x + 21, y + 18, 8)
    line(x + 30, y + 40, x + 34, y + 28, 7) circfill(x + 38, y + 38, 3, 29)
    return
  end
  for i = 0, 34 do
    local w = 10 + i * 8 // 34
    rectfill(x + 24 - w, y + 6 + i, w * 2, 1, stage == 1 and (i % 6 == 0 and 8 or 0) or (i % 8 < 4 and 12 or 11))
  end
  line(x + 14, y + 6, x + 6, y + 40, 7) line(x + 33, y + 6, x + 41, y + 40, 7)
  if stage == 1 then line(x + 14, y + 6, x + 41, y + 40, 8) line(x + 33, y + 6, x + 6, y + 40, 8) end
  for i = 0, 6 do line(x + 24 - 11 + i, y + 6 - i, x + 24 + 10 - i, y + 6 - i, 9) end
  if stage >= 2 then
    rectfill(x + 20, y + 30, 8, 11, 8) rectfill(x + 21, y + 16, 5, 5, 20)
    sails(x + 24, y + 10, stage >= 3 and t() / 50 or 0.5, 22, true)
  end
end
function draw_coop(x, y, built)     -- 32 x 32
  if not built then
    rectfill(x + 3, y + 26, 26, 5, 7) line(x + 5, y + 26, x + 9, y + 12, 8) line(x + 24, y + 26, x + 22, y + 16, 8)
    line(x + 9, y + 12, x + 18, y + 20, 7) rectfill(x + 12, y + 22, 9, 3, 9)
    return
  end
  rectfill(x + 3, y + 14, 26, 16, 10) rect(x + 3, y + 14, 26, 16, 7)
  for i = 0, 9 do line(x + 16 - i - 5, y + 4 + i, x + 16 + i + 4, y + 4 + i, i % 3 == 0 and 8 or 25) end
  rectfill(x + 12, y + 21, 7, 9, 6) line(x + 10, y + 31, x + 20, y + 31, 8)
  rectfill(x + 22, y + 18, 4, 4, 27)
end
function draw_shed(x, y, built)     -- 32 x 32
  if not built then
    rectfill(x + 2, y + 27, 28, 4, 28) rect(x + 2, y + 27, 28, 4, 30)
    line(x + 4, y + 27, x + 4, y + 14, 8) line(x + 27, y + 27, x + 27, y + 20, 8)
    return
  end
  rectfill(x + 2, y + 12, 28, 19, 8) rect(x + 2, y + 12, 28, 19, 6)
  for i = 0, 5 do line(x + 1, y + 11 - i, x + 30, y + 7 - i, i % 2 == 0 and 30 or 28) end
  rectfill(x + 10, y + 18, 12, 13, 6) rectfill(x + 10, y + 24, 12, 1, 9)
  line(x + 10, y + 18, x + 21, y + 30, 9)
end
function draw_trough(x, y)
  rectfill(x + 1, y + 7, 14, 6, 8) rect(x + 1, y + 7, 14, 6, 6)
  rectfill(x + 2, y + 13, 2, 2, 6) rectfill(x + 12, y + 13, 2, 2, 6)
  if G.feed > 0 then rectfill(x + 2, y + 8, clamp(G.feed, 2, 12), 2, 27) end
end
function draw_animal(i)
  local a, m = G.an[i], ANIM[i]
  local x, y = fl(m.x), fl(m.y)
  local n = (a.k == "h" and 170 or 194) + ((m.wait == 0 and m.step % 16 < 8) and 2 or 0)
  circfill(x, y - 1, a.k == "h" and 3 or 5, 15)
  spr(n, x - 8, y - 15, 2, 2, m.face < 0)
  if a.k == "g" and a.m == 1 and t() % 60 < 40 then circfill(x, y - 20, 3, 13) circ(x, y - 20, 3, 22) end
  if a.p == 0 and G.clk > 0 and t() % 90 < 12 then pset(x + 5, y - 16, 26) pset(x + 6, y - 17, 26) pset(x + 7, y - 16, 26) pset(x + 6, y - 15, 26) end
end

function draw_mine(x, y)
  circfill(x + 8, y + 9, 8, 30) rectfill(x, y + 9, 16, 7, 30) circfill(x + 8, y + 10, 5, 1) rectfill(x + 3, y + 10, 10, 6, 1)
  line(x + 2, y + 8, x + 14, y + 12, 8) line(x + 2, y + 13, x + 14, y + 7, 9)
end

function draw_farmer(x, y)          -- x, y: the feet
  local n = 128
  if dy < 0 then n = 132 elseif dx ~= 0 then n = 136 end
  if walk % 20 >= 10 then n = n + 2 end
  local bob = act > 0 and (act > 7 and -1 or 1) or 0
  circfill(x, y, 4, 15)
  spr(n, x - 8, y - 15 + bob, 2, 2, dx < 0)
  if act > 0 then
    local ax, ay = x + dx * 9, y - 6 + dy * 8
    if act_kind == "water" or act_kind == "fill" then
      for i = 0, 2 do pset(ax + i * 2 - 2, ay + (14 - act) // 2 + i % 2, 22) end
    elseif act_kind == "dig" or act_kind == "chop" then
      line(x + dx * 3, y - 9, ax, ay + (act > 7 and -6 or 2), 8)
    else
      pset(ax, ay, 13) pset(ax + 1, ay - 2, 13)
    end
  end
end

function season_pal(tree)
  local s = season()
  if s == 3 then
    if tree then pal(16, 9) pal(17, 10) pal(15, 8) else pal(17, 27) pal(18, 10) end
  elseif s == 4 then
    pal(16, 23) pal(17, 13) pal(15, 22) pal(18, 13) pal(14, 21)
  elseif s == 2 and not tree then
    pal(18, 27)
  end
end

-- the mine fits the screen. You only see what your lamp reaches.
function draw_cave()
  camx, camy = 0, 0
  camera(0, 0)
  local R = G.lamp == 1 and 7.5 or 5
  local pcx, pcy = px / C - 0.5, (py - 6) / C - 0.5
  local prow = fl((py - 1) / C)
  for y = 0, 14 do
    for x = 0, 19 do
      local d = math.sqrt((x - pcx) ^ 2 + (y - pcy) ^ 2)
      if d < R then
        local ch, sx, sy = MINE[y][x], x * C, y * C
        if d > R - 1.6 then pal(29, 28) pal(28, 30) pal(30, 31) pal(31, 1) pal(7, 6) pal(8, 7) pal(9, 7) pal(27, 9) pal(10, 8) pal(22, 20) pal(23, 21) pal(13, 28) pal(17, 15) pal(16, 14) end
        spr(ch == "#" and 226 or 224, sx, sy, 2, 2)
        if ROCKS[ch] then
          local sh = (mine_at == x + y * 20 and act > 7) and 1 or 0
          spr(ROCKS[ch].spr, sx + sh, sy, 2, 2)
        elseif ch == "<" then spr(236, sx, sy, 2, 2)
        elseif ch == ">" then spr(238, sx, sy, 2, 2)
        elseif ch == "H" then spr(256, sx, sy, 2, 2) end
        pal()
      end
    end
    for _, m in ipairs(MOBS) do
      if fl((m.y - 1) / C) == y and math.sqrt((m.x / C - 0.5 - pcx) ^ 2 + (m.y / C - 1 - pcy) ^ 2) < R then
        local bob = m.bat and fl(math.sin(t() / 6) * 3) - 6 or (t() // 12 % 2)
        if m.hit > 0 then pal(13) end
        circfill(fl(m.x), fl(m.y) - 1, 4, 1)
        spr(m.bat and (260 + t() // 8 % 2 * 2) or 258, fl(m.x) - 8, fl(m.y) - 15 + bob, 2, 2, px < m.x)
        pal()
      end
    end
    if y == prow and (hurt_t == 0 or t() % 6 < 3) then draw_farmer(fl(px), fl(py)) end
  end
  local fx, fy = facing()
  if not ui and fade == 0 and ROCKS[tile(3, fx, fy)] then rect(fx * C, fy * C, 16, 16, 27) end
  for _, f in ipairs(floats) do text(f.s, fl(f.x - #f.s * 4), fl(f.y), f.c) end
end

function draw_world()
  if G.area == 3 then draw_cave() return end
  local a, A = G.area, AREAS[G.area]
  camx = fl(clamp(px - 160, 0, A.w * C - 320))
  camy = fl(clamp(py - 128, -12, A.h * C - 240))
  camera(camx, camy)
  local x0, y0 = camx // C, fl(camy / C)
  local x1, y1 = math.min(A.w - 1, x0 + 20), math.min(A.h - 1, y0 + 16)
  y0 = math.max(0, y0)
  local wf = t() // 30 % 2
  -- the ground
  season_pal(false)
  for y = y0, y1 do
    for x = x0, x1 do
      local ch, n = tile(a, x, y), 32
      if ch == ":" or ch == "X" then n = 40
      elseif ch == "p" then n = 72
      elseif ch == "~" then n = 42 + wf * 2
      elseif hash(x, y, a) < 140 then n = 34 end
      if a == 1 then
        local f, p = cell(x, y)
        if f then
          if not G.plots[p] then n = 46 elseif f.k == 4 then n = f.wet and 38 or 36 else n = 32 end
        end
      end
      spr(n, x * C, y * C, 2, 2)
    end
  end
  pal()
  -- everything that stands on it, row by row so things overlap the right way
  local rows = {}
  for i, o in ipairs(FORAGE) do
    if o.a == a then rows[o.y] = rows[o.y] or {}; rows[o.y][#rows[o.y] + 1] = o end
  end
  local arows = {}
  if a == 1 then
    for i, m in ipairs(ANIM) do
      local r = fl((m.y - 1) / C)
      arows[r] = arows[r] or {}; arows[r][#arows[r] + 1] = i
    end
  end
  local prow = fl((py - 1) / C)
  for y = y0, math.min(A.h - 1, y1 + 2) do
    for x = x0, x1 do
      local ch, sx, sy = tile(a, x, y), x * C, y * C
      if ch == "T" then season_pal(true) spr(160, sx, sy - 16, 2, 4) pal()
      elseif ch == "B" then season_pal(false) spr(70, sx, sy, 2, 2) pal()
      elseif ch == "o" then spr(74, sx, sy - 4, 2, 2)
      elseif ch == "t" then spr(76, sx, sy, 2, 2)
      elseif ch == "N" then spr(140, sx, sy - 4, 2, 2)
      elseif ch == "M" then draw_mine(sx, sy)
      elseif ch == "S" then rectfill(sx - 6, sy + 5, 28, 6, 8) rect(sx - 6, sy + 5, 28, 6, 6) circfill(sx - 6, sy + 8, 3, 10)
      elseif ch == "X" then rectfill(sx + 2, sy + 6, 12, 3, 9) rectfill(sx + 4, sy + 4, 2, 10, 7) rectfill(sx + 10, sy + 4, 2, 10, 7)
      elseif a == 1 then
        if ch == "h" and x == 7 and y == 3 then draw_hut(sx, sy - 32)
        elseif ch == "c" then draw_crate(sx, sy)
        elseif ch == "k" and x == 19 and y == 23 then draw_coop(sx, sy - 16, G.coop == 1)
        elseif ch == "g" and x == 22 and y == 23 then draw_shed(sx, sy - 16, G.shed == 1)
        elseif ch == "r" then draw_trough(sx, sy)
        elseif ch == "W" and x == 17 and y == 4 then draw_wagon(sx, sy - 16)
        elseif ch == "m" and x == 25 and y == 3 then draw_mill(sx, sy - 32, G.mill)
        else
          local f, p = cell(x, y)
          if f and G.plots[p] then
            if f.k == 1 then spr(64, sx, sy, 2, 2)
            elseif f.k == 2 then spr(66, sx, sy, 2, 2)
            elseif f.k == 3 then spr(68, sx, sy, 2, 2)
            elseif f.c > 0 then
              draw_crop(f.c, crop_stage(f), sx, sy, x + y * 3)
              if ripe(f) and t() % 60 < 30 then pset(sx + 13, sy + 2, 13) pset(sx + 12, sy + 2, 27) pset(sx + 13, sy + 1, 27) end
            end
          end
        end
      end
    end
    if rows[y] then for _, o in ipairs(rows[y]) do spr(FOUND_BY[o.k].spr, o.x * C, o.y * C, 2, 2) end end
    if arows[y] then for _, i in ipairs(arows[y]) do draw_animal(i) end end
    if y == prow then draw_farmer(fl(px), fl(py)) end
  end
  -- the cell your hands reach
  local fx, fy = facing()
  if not ui and fade == 0 then
    local c = 13
    if a == 1 then
      local f, p = cell(fx, fy)
      if f and G.plots[p] then c = 27 end
    end
    do
      local k = t() // 20 % 2
      for i = 0, 1 do
        for j = 0, 1 do
          local cx, cy = fx * C + i * 15, fy * C + j * 15
          line(cx, cy, cx + (i == 0 and 3 or -3) - (i == 0 and k or -k), cy, c)
          line(cx, cy, cx, cy + (j == 0 and 3 or -3) - (j == 0 and k or -k), c)
        end
      end
    end
  end
  for _, f in ipairs(floats) do text(f.s, fl(f.x - #f.s * 4), fl(f.y), f.c) end
  camera()
end

function draw_weather()
  if G.area == 3 then return end
  local h = hour()
  if G.rain then
    local snow = season() == 4
    for i = 1, 40 do
      local x, y = (i * 53 + t() * (snow and 1 or 3)) % 340 - 10, (i * 97 + t() * (snow and 2 or 7)) % 240
      if snow then pset(x, y, 13) else line(x, y, x - 2, y + 5, 22) end
    end
    shade(0.12)
  end
  if h > 17.5 then tint(3, clamp((h - 17.5) / 4.5, 0, 1) * 0.3) shade(clamp((h - 17.5) / 4.5, 0, 1) * 0.42)
  elseif h < 7 then tint(10, (7 - h) * 0.18) end
end

-- ---------------------------------------------------------------- drawing: the HUD and the screens
function panel(x, y, w, h, title)
  rectfill(x, y, w, h, 6) rect(x, y, w, h, 10) rect(x + 1, y + 1, w - 2, h - 2, 7)
  if title then rectfill(x + 2, y + 2, w - 4, 12, 7) text(title, x + 6, y + 4, 27) end
end
function wrap(s, n)
  local out, ln = {}, ""
  for w in s:gmatch("%S+") do
    if #ln + #w + 1 > n and ln ~= "" then out[#out + 1] = ln; ln = w else ln = ln == "" and w or ln .. " " .. w end
  end
  if ln ~= "" then out[#out + 1] = ln end
  return out
end

function next_step()
  if G.area == 3 then return nil end
  if G.day > 4 or G.grown >= 6 then return nil end
  local dug, planted, dry, ready = 0, 0, 0, 0
  for i, f in ipairs(FIELD[1]) do
    if f.k == 4 then dug = dug + 1 end
    if f.c > 0 then planted = planted + 1; if not f.wet and not ripe(f) then dry = dry + 1 end end
    if ripe(f) then ready = ready + 1 end
  end
  local seeds = 0
  for i = 1, #CROPS do if in_season(i) then seeds = seeds + G.seeds[i] end end
  if ready > 0 then return "Pick what is ripe (A) and sell it at the crate." end
  if count_bag() >= 6 then return "Sell what you carry at the crate by the hut." end
  if seeds > 0 and dug == planted then return "Dig a cell on your plot: press A three times." end
  if seeds > 0 and dug > planted then return "Stand at dug soil: A plants a seed." end
  if dry > 0 and G.water > 0 then return "B waters. Wet crops grow overnight." end
  if dry > 0 then return "Fill the bucket at the pond: face it, press B." end
  if seeds == 0 and G.coins >= 6 then return "Buy seeds from Marrow's wagon on the road." end
  if seeds == 0 then return "Forage in the woods: follow the road west." end
  if hour() > 12 then return "All done? Sleep in the hut (A at the door)." end
  return "Pull weeds (A) to clear more of your plot."
end

function draw_hud()
  rectfill(0, 0, 320, 12, 6) line(0, 12, 320, 12, 7)
  text(SEASON[season()] .. " " .. day_of(), 4, 2, 12)
  local h = hour()
  text(string.format("%02d:%02d", fl(h), fl(h % 1 * 6) * 10), 92, 2, h > 20 and 26 or 13)
  if G.rain then text(season() == 4 and "snow" or "rain", 144, 2, 22) end
  if G.area == 2 then text("Woods", 190, 2, 17) end
  if G.area == 3 then
    text("Mine " .. mine_n, 152, 2, 29)
    for i = 1, 3 do spr(292, 204 + i * 12, -2, 2, 2) if i > mine_hp then rectfill(208 + i * 12, 2, 8, 8, 6) rect(209 + i * 12, 3, 6, 6, 30) end end
  end
  local cs = tostring(G.coins)
  circfill(308 - #cs * 8 - 8, 6, 3, 27) circ(308 - #cs * 8 - 8, 6, 3, 10)
  text(cs, 312 - #cs * 8, 2, 27)
  -- seeds, water, bag
  rectfill(0, 226, 320, 14, 6) line(0, 226, 320, 226, 7)
  local c = CROPS[G.sel]
  text("<L", 2, 229, 28) text(c.name .. " x" .. G.seeds[G.sel], 22, 229, G.seeds[G.sel] > 0 and (in_season(G.sel) and 13 or 26) or 28)
  text("R>", 22 + (#c.name + 5) * 8, 229, 28)
  local n = CAN[G.can].n
  for i = 0, 9 do rectfill(196 + i * 4, 229, 3, 8, i < math.ceil(G.water / n * 10) and 21 or 30) end
  local b = count_bag()
  text("bag " .. b .. "/" .. BAG[G.bag], 320 - (#tostring(b) + #tostring(BAG[G.bag]) + 5) * 8 - 2, 229, b >= BAG[G.bag] and 26 or 12)
  local s = toast_t > 0 and toast or next_step()
  if s and not ui then
    local L = wrap(s, 37)
    local y = 222 - #L * 10
    rectfill(8, y - 4, 304, #L * 10 + 6, 1) rect(8, y - 4, 304, #L * 10 + 6, toast_t > 0 and 10 or 20)
    for i, l in ipairs(L) do text(l, 14, y + (i - 1) * 10, toast_t > 0 and 13 or 22) end
  end
end

function draw_shop()
  local L = shop_items()
  panel(20, 18, 280, 204, "Marrow's wagon")
  text(G.coins .. " coins", 292 - (#tostring(G.coins) + 6) * 8, 22, 12)
  text("Paying extra today: " .. CROPS[G.demand].name, 28, 36, 17)
  for i = 1, 8 do
    local it = L[i + ui_scroll]
    if it then
      local y = 36 + i * 14
      if i + ui_scroll == ui_sel then rectfill(24, y - 2, 272, 12, 8) end
      text(it.name, 30, y, G.coins >= it.cost and 13 or 28)
      if it.own then text("x" .. it.own, 196, y, 11) end
      text(tostring(it.cost), 288 - #tostring(it.cost) * 8, y, G.coins >= it.cost and 27 or 28)
    end
  end
  if #L > 8 then text(ui_scroll + 8 < #L and "more below" or "more above", 120, 164, 28) end
  local it = L[ui_sel]
  for i, l in ipairs(wrap(it.about, 33)) do text(l, 28, 168 + i * 10, 12) end
  text("A: buy   B: leave", 28, 208, 11)
end

function draw_bag()
  panel(20, 18, 280, 204, "Your bag")
  text(SEASON[season()] .. " " .. day_of() .. ", year " .. year(), 28, 36, 12)
  text(CAN[G.can].name .. ", " .. HOE[G.hoe].name:lower(), 28, 48, 12)
  text((G.pick > 0 and "Pickaxe" or "No pickaxe") .. ", " .. (G.axe > 0 and "axe" or "no axe"), 28, 58, 12)
  local x, y = 28, 74
  local function row(k, name, n, c)
    draw_icon(k, x, y - 4)
    text(name:sub(1, 10), x + 20, y, c or 13) text("x" .. n, x + 104, y + 8 - 8, 27)
    y = y + 16
    if y > 186 then x, y = 164, 74 end
  end
  for i, c in ipairs(CROPS) do if have(c.key) > 0 then row(c.key, c.name, have(c.key)) end end
  for i, f in ipairs(FOUND) do if have(f.key) > 0 then row(f.key, f.name, have(f.key), f.mat and 11 or 13) end end
  if x == 28 and y == 74 then text("Nothing yet. Pick, pull and forage.", 28, 74, 28) end
  if #G.an > 0 then text(herd("h") .. " hens, " .. herd("g") .. " goats. Trough: " .. G.feed, 28, 196, 17) end
  text("Mill: " .. (MILL[G.mill + 1] and MILL[G.mill + 1].name:lower() or "rebuilt") .. "   B: close", 28, 208, 11)
end

function draw_mill_ui()
  local M = MILL[G.mill + 1]
  panel(30, 40, 260, 160, "The old windmill")
  if not M then text("It turns again.", 40, 70, 13) return end
  text("Step " .. (G.mill + 1) .. " of " .. #MILL .. ": " .. M.name, 40, 60, 13)
  local y = 80
  local function need(name, got, n)
    text(name, 40, y, 12)
    text(math.min(got, n) .. "/" .. n, 200, y, got >= n and 17 or 26)
    y = y + 14
  end
  need("Coins", G.coins, M.coins)
  for _, f in ipairs(FOUND) do if M.need[f.key] then need(f.name, have(f.key), M.need[f.key]) end end
  if M.crops > 0 then need("Crops for the builders", G.millc, M.crops) end
  local s = "B: back"
  if G.millc < M.crops and crops_in_bag() > 0 then s = "A: hand over crops   B: back"
  elseif mill_ready() then s = "A: build it!   B: back" end
  text(s, 40, 182, 11)
  if G.mill == 2 and have("millstone") == 0 then text("The millstone is lost somewhere", 40, 146, 28) text("at the bottom of the old mine.", 40, 156, 28) end
  if G.mill == 0 then text("Wood: stumps and sticks.", 40, 146, 28) text("Stone: stones and pebbles.", 40, 156, 28) end
end

function draw_build()
  local Bd = BUILD[ui_kind]
  panel(30, 50, 260, 140, "Mend the " .. Bd.name:lower())
  for i, l in ipairs(wrap(Bd.about, 29)) do text(l, 40, 60 + i * 10, 12) end
  local y, ok = 96, G.coins >= Bd.coins
  text("Coins", 40, y, 12) text(math.min(G.coins, Bd.coins) .. "/" .. Bd.coins, 200, y, ok and 17 or 26)
  for _, f in ipairs(FOUND) do
    local n = Bd.need[f.key]
    if n then
      y = y + 14
      text(f.name, 40, y, 12) text(math.min(have(f.key), n) .. "/" .. n, 200, y, have(f.key) >= n and 17 or 26)
      if have(f.key) < n then ok = false end
    end
  end
  text(ok and "A: build it!   B: back" or "B: back", 40, 172, 11)
end

function draw_report()
  panel(30, 50, 260, 140, "While you were away")
  local r = report
  text((r.h > 0 and (r.h .. " h ") or "") .. r.m .. " min went by.", 40, 72, 12)
  text(r.days .. (r.days == 1 and " day" or " days") .. " passed on the farm.", 40, 88, 13)
  text(r.rain > 0 and ("It rained on " .. r.rain .. (r.rain == 1 and " of them." or " of them.")) or "No rain fell.", 40, 102, 22)
  text(r.grew > 0 and "Your watered crops grew." or "Nothing grew: dry soil.", 40, 116, 17)
  text(r.ready .. (r.ready == 1 and " crop is" or " crops are") .. " ready to pick.", 40, 130, 27)
  text("A: good morning", 40, 170, 11)
end

function _draw()
  cls(1)
  draw_world()
  draw_weather()
  draw_hud()
  if ui == "shop" then draw_shop()
  elseif ui == "bag" then draw_bag()
  elseif ui == "mill" then draw_mill_ui()
  elseif ui == "build" then draw_build()
  elseif ui == "lift" then
    local L = lift_floors()
    panel(70, 70, 180, 100, "The old mine")
    text("The winch still works.", 80, 88, 12)
    for i, n in ipairs(L) do
      if i == ui_sel then rectfill(76, 98 + i * 12, 168, 12, 8) end
      text("Floor " .. n, 84, 100 + i * 12, i == ui_sel and 27 or 13)
    end
    text("A: go down   B: back", 80, 156, 11)
  elseif ui == "report" then draw_report()
  elseif ui == "sleep" then
    panel(60, 90, 200, 60, "The hut")
    text("Sleep until morning?", 72, 110, 13) text("A: sleep   B: not yet", 72, 130, 11)
  end
  if fade > 0 then shade(fade <= 30 and fade / 30 or (60 - fade) / 30) end
end

-- the title screen: dawn over the valley, the mill turning, windrows of crops running to the horizon
function draw_title(t)
  local sky = { 19, 20, 3, 9, 10, 11 }
  for i = 0, 5 do rectfill(0, i * 22, 320, 22, sky[i + 1]) end
  circfill(236, 128 - fl(math.sin(t / 240) * 10), 22, 27) circfill(236, 128 - fl(math.sin(t / 240) * 10), 17, 12)
  for x = 0, 319, 2 do
    local h = 118 + math.sin(x / 47) * 10 + math.sin(x / 19 + 2) * 4
    rectfill(x, h, 2, 240 - h, 15)
  end
  draw_mill(36, 92, 3)
  rectfill(0, 132, 320, 108, 16)
  for i = -12, 12 do
    local c = i % 2 == 0 and 8 or 7
    for y = 134, 239, 2 do
      local k = (y - 120) / 110
      rectfill(160 + i * 46 * k - 9 * k, y, 18 * k + 1, 2, c)
    end
  end
  for i = -5, 5 do
    for j = 0, 5 do
      local z = ((j * 20 + t / 2) % 120) / 120
      local k = z * z
      local x, y = 160 + i * 46 * (0.14 + k) * 1.05, 136 + k * 104
      if z > 0.08 then draw_crop((i + j) % 7 + 1, z > 0.5 and 3 or 2, fl(x) - 8, fl(y) - 12, i + j) end
    end
  end
  for i = 0, 4 do
    local bx = (t * 0.4 + i * 70) % 380 - 30
    local by = 30 + i * 9 + fl(math.sin(t / 30 + i) * 3)
    line(bx - 3, by - 2, bx, by, 1) line(bx, by, bx + 3, by - 2, 1)
  end
end
`;

  /* ---- art ---- */
  const K = { '.': 0, 1: 1, e: 14, g: 15, G: 16, l: 17, y: 18, n: 6, b: 7, B: 8, o: 9, O: 10, s: 11, w: 12, W: 13,
    m: 24, r: 25, R: 26, Y: 27, a: 28, A: 29, d: 30, k: 31, u: 20, U: 21, c: 22, C: 23, p: 4, P: 5 };
  const ART = {
    64: ['................', '................', '................', '.....l..........', '....lG....l.....', '.l..G.G..lG.....',
         '.Gl.G.G..G.G.l..', '..G.GgG.lG.g.G..', '..GgGgG.GgGgG...', '...GgGgGgGgGl...', '.l.gGgGgGgGg.l..', '.GlgGgGgGgGgG...',
         '..GgGgGgGgGgG...', '...gggGgGggg....', '....eeegeee.....', '................'],   // weeds
    66: ['................', '................', '................', '.....dddd.......', '...ddAAAAdd.....', '..dAAAAAAaad....',
         '.dAAWAAAaaaad...', '.dAAAAAaaaaad...', 'dAAAAAaaaaaaad..', 'dAAAaaaaaaakad..', 'daaaaaaaakkaad..', 'daaaaaakkaaaad..',
         '.daaaaaaaaaad...', '..dddaaaaddd....', '.....dddd.......', '................'],   // stone
    68: ['................', '................', '................', '....nnnnnnn.....', '...nOOOOOOOn....', '..nOOoOOoOOOn...',
         '..nOoOOoOOoOn...', '..nOOOooOOOOn...', '..nBOOOOOOOBn...', '..nBBnBBBnBBn...', '..nBbBBnBBbBn...', '..nBBBBBBBBBn...',
         '.nBBnBBBBnBBBn..', 'nBBn.nBBn.nBBBn.', '.nn...nn...nnn..', '................'],   // stump
    74: ['................', '.....dddd.......', '....dAAAAd......', '...dAAAAaad.....', '...dAWAaaad.....', '...dAAAaaad.....',
         '...dAAaaaad.....', '...dAAaakad.....', '...dAaaaaad.....', '...dAaakaad.....', '...daaaaaad.....', '...daaaaaad.....',
         '..gdaaakaadg....', '.gGdaaaaaadGg...', '..gGddddddGg....', '................'],   // standing stone
    76: ['................', '................', '................', '................', '................', '................',
         '...dddddddddd...', '..dAAAAAAAAAAd..', '..daaaaYYaaaad..', '..dddddYYddddd..', '..daaaaaaaaaad..', '..daoaaaaaaoad..',
         '..daaaaaaaaaad..', '..dddddddddddd..', '................', '................'],   // tin box
    96: ['................', '................', '................', '....g...g.......', '...gGg.gGg..g...', '..gGlGgGlGggGg..',
         '.gGpGGGGGGpGlG..', '.gGGGGpGGGGGGg..', '..gGGGGGGpGGg...', '.gGpGGGGGGGGGg..', '.gGGGGpGGGpGGg..', '..gGGGGGGGGGg...',
         '...ggGGGGGgg....', '.....ggggg......', '................', '................'],   // brambleberry
    98: ['................', '................', '................', '................', '......l...l.....', '.....lG..lG.....',
         '..l..G.G.G.G....', '..Gl.G.GGG.G.l..', '...G.GgG.GgGlG..', '...GgGgGgGgGG...', '....GgWgGgWG....', '.....WWWgWWW....',
         '.....WwW.WwW....', '......W...W.....', '................', '................'],   // wild garlic
    100: ['................', '................', '................', '................', '......BBBB......', '....BBooooBB....',
          '...BooOoooooB...', '...BoooooOooB...', '...BBooooooBB...', '.....BwwwwB.....', '......wwww......', '......wWww......',
          '.....wwWwww.....', '.....wwwwww.....', '......gggg......', '................'],   // pennybun
    102: ['................', '................', '................', '................', '................', '.......bb.......',
          '......bBBb......', '.....bBoBBb.....', '.....bBBoBb.....', '....bBoBBoBb....', '....bBBoBBBb....', '.....bBBoBb.....',
          '......bBBb......', '.......bb.......', '................', '................'],   // pine cone
    104: ['................', '................', '................', '................', '................', '............b...',
          '...........bB...', '..b......bbBb...', '..bBbbbbbBBb....', '...bBBBBBBb.b...', '....bbbBBbbBb...', '.......bBBBb....',
          '........bbb.....', '................', '................', '................'],   // stick
    106: ['................', '................', '................', '................', '................', '................',
          '................', '......ddd.......', '....ddAAAd..dd..', '...dAAAaaad.dAd.', '...dAaaaaad.dad.', '....daaaad...d..',
          '.....dddd.......', '................', '................', '................'],   // pebbles
    108: ['................', '......B.........', '......B....B....', '..B...B....B....', '..B...l..l.B....', '..B..lG..G.l....',
          '..l..G.l.G.G....', '..G.lG.G.GlG....', '..G.G..G.GG..l..', '..GlG..GlG..lG..', '...GG..GG...G...', '...G...G...lG...',
          '...G...G...G....', '..gGg.gGg.gGg...', '................', '................'],   // reeds
    128: ['................', '.....YYYYYY.....', '....YYYYYYYY....', '..OYYYYYYYYYYO..', '..1OOrrrrrrOO1..', '....ssssssss....',
          '....s1ssss1s....', '....ssssssss....', '.....ssmmss.....', '....wUUUUUUw....', '...swUUuuUUws...', '...s.UUUUUU.s...',
          '.....UUUUUU.....', '.....UU..UU.....', '.....nn..nn.....', '................'],   // farmer, facing you
    130: ['................', '.....YYYYYY.....', '....YYYYYYYY....', '..OYYYYYYYYYYO..', '..1OOrrrrrrOO1..', '....ssssssss....',
          '....s1ssss1s....', '....ssssssss....', '.....ssmmss.....', '....wUUUUUUw....', '...swUUuuUUws...', '...s.UUUUUU.s...',
          '.....UUUUUU.....', '.....UU..nn.....', '.....nn.........', '................'],
    132: ['................', '.....YYYYYY.....', '....YYYYYYYY....', '..OYYYYYYYYYYO..', '..1OOYYYYYYOO1..', '....rrrrrrrr....',
          '....bbbbbbbb....', '....bbbbbbbb....', '.....ssssss.....', '....wUwwwwUw....', '...swUUwwUUws...', '...s.UUUUUU.s...',
          '.....UUUUUU.....', '.....UU..UU.....', '.....nn..nn.....', '................'],   // farmer, from behind
    134: ['................', '.....YYYYYY.....', '....YYYYYYYY....', '..OYYYYYYYYYYO..', '..1OOYYYYYYOO1..', '....rrrrrrrr....',
          '....bbbbbbbb....', '....bbbbbbbb....', '.....ssssss.....', '....wUwwwwUw....', '...swUUwwUUws...', '...s.UUUUUU.s...',
          '.....UUUUUU.....', '.....nn..UU.....', '.........nn.....', '................'],
    136: ['................', '.....YYYYYY.....', '....YYYYYYYY....', '...OYYYYYYYYYOO.', '...1OrrrrrrOOO1.', '.....bsssssss...',
          '.....bssss1ss...', '.....bsssssss...', '......sssssm....', '.....wwUUUw.....', '.....wUUUUws....', '.....wUUUUUs....',
          '.....UUUUUU.....', '.....UU..UU.....', '.....nn..nnn....', '................'],   // farmer, side on
    138: ['................', '.....YYYYYY.....', '....YYYYYYYY....', '...OYYYYYYYYYOO.', '...1OrrrrrrOOO1.', '.....bsssssss...',
          '.....bssss1ss...', '.....bsssssss...', '......sssssm....', '.....wwUUUw.....', '....swUUUUw.....', '....sUUUUUU.....',
          '.....UUUUUU.....', '......UUUU......', '......nnnn......', '................'],
    110: ['................', '................', '................', '................', '................', '.......bb.......',
          '......bwwb......', '.....bwWwwb.....', '.....bwWwwb.....', '.....bwwwwb.....', '.....bwwwsb.....', '......bssb......',
          '.......bb.......', '................', '................', '................'],   // egg
    164: ['................', '................', '................', '......bbb.......', '.....bOOOb......', '....bOYOOOb.....',
          '....bOYOOOb.....', '...bOOOOOOOb....', '...bOOOOOOOb....', '...bOOOOOOob....', '....bOOOOob.....', '.....boooob.....',
          '......bbbb......', '................', '................', '................'],   // big egg
    166: ['................', '................', '................', '......dddd......', '......dAAd......', '.....dAAAAd.....',
          '....dWWWWWWd....', '....dWWWWWAd....', '....dWWWWWAd....', '....dWWWWWAd....', '....dWWWWWAd....', '....dWWWWAAd....',
          '.....dddddd.....', '................', '................', '................'],   // goat milk
    168: ['................', '................', '................', '......dddd......', '......dYYd......', '.....dAAAAd.....',
          '....dwwwwwwd....', '....dwwwwwOd....', '....dwYwwwOd....', '....dwwwwwOd....', '....dwwwYwOd....', '....dwwwwOOd....',
          '.....dddddd.....', '................', '................', '................'],   // creamy milk
    170: ['................', '................', '................', '.......rr.......', '......rWWW......', '......WW1WO.....',
          '......WWWW......', '..W..WWWWr......', '..WWWWWWWW......', '..WWWAWWWW......', '...WWWAAWW......', '....WWWWW.......',
          '.....O..O.......', '.....O..O.......', '....OO.OO.......', '................'],   // hen
    172: ['................', '................', '................', '.......rr.......', '......rWWW......', '......WW1WO.....',
          '......WWWW......', '..W..WWWWr......', '..WWWWWWWW......', '..WWWAWWWW......', '...WWWAAWW......', '....WWWWW.......',
          '.....O...O......', '....O....O......', '...OO...OO......', '................'],
    194: ['................', '................', '...........d.d..', '..........dAAAd.', '..........A1AAA.', '.........AAAAAs.',
          '..AAAAAAAAAAA...', '.AAWWWWWWAAA....', '.AWWWWWWWWAw....', '.AWWWWWWWWA.....', '.AAWWWWWWAA.....', '..AAAAAAAA......',
          '..d.d...d.d.....', '..d.d...d.d.....', '..n.n...n.n.....', '................'],   // goat
    196: ['................', '................', '...........d.d..', '..........dAAAd.', '..........A1AAA.', '.........AAAAAs.',
          '..AAAAAAAAAAA...', '.AAWWWWWWAAA....', '.AWWWWWWWWAw....', '.AWWWWWWWWA.....', '.AAWWWWWWAA.....', '..AAAAAAAA......',
          '..d..d..d..d....', '.d...d.d...d....', '.n...n.n...n....', '................'],
    256: ['................', '................', '................', '................', '..nnnnnnnnnnnn..', '.nBBBBBBBBBBBBn.',
          '.nBOOOOOOOOOOBn.', '.nBBBBBYYBBBBBn.', '.nnnnnnYYnnnnnn.', '.nBBBBBYYBBBBBn.', '.nBOBBBBBBBBOBn.', '.nBBBBBBBBBBBBn.',
          '.nBBBBBBBBBBBBn.', '.nnnnnnnnnnnnnn.', '................', '................'],   // chest
    258: ['................', '................', '................', '................', '.....pppppp.....', '....pPPPPPPp....',
          '...pPPPPPPPPp...', '...pPWWPPWWPp...', '..pPPW1PPW1PPp..', '..pPPPPPPPPPPp..', '..pPPP1111PPPp..', '..pPPPPPPPPPPp..',
          '..ppPPPPPPPPpp..', '..p.pp.pp.pp.p..', '................', '................'],   // gloomling
    260: ['................', '................', '................', '.1............1.', '.11....11....11.', '.1p1..1pp1..1p1.',
          '.1pp11pppp11pp1.', '..1ppppRpRppp1..', '...1pppppppp1...', '....11pppp11....', '......1pp1......', '.......11.......',
          '................', '................', '................', '................'],   // bat, wings up
    262: ['................', '................', '................', '................', '.......11.......', '......1pp1......',
          '..1111pRpR1111..', '.1ppppppppppp1..', '.1pp11pppp11pp1.', '.1p1..1pp1..1p1.', '.11....11....11.', '.1............1.',
          '................', '................', '................', '................'],   // bat, wings down
    292: ['................', '................', '................', '................', '....rr..rr......', '...rRRrrRRr.....',
          '...rRWRRRRr.....', '...rRRRRRRr.....', '....rRRRRr......', '.....rRRr.......', '......rr........', '................',
          '................', '................', '................', '................'],   // heart
    140: ['................', '.....pppppp.....', '....pPPPPPPp....', '....pPppppPp....', '....psssssss....', '....ps1ss1ss....',
          '....pssssss.....', '.....ssmmss.....', '....RRRRRRRR....', '...sRRwRRwRRs...', '...sRRRRRRRRs...', '....RRRRRRRR....',
          '....RRRRRRRR....', '...RRRRRRRRRR...', '.....nn..nn.....', '................'],   // Marrow the trader
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    const put = (n, x, y, c) => { cart.tiles[(n + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = c; };
    const rnd = (x, y, s) => { let n = (x * 374761393 + y * 668265263 + s * 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) % 1000; };
    for (const [n, rows] of Object.entries(ART)) {
      if (rows.length !== 16 || rows.some(r => r.length !== 16)) throw new Error('Windrow art ' + n + ' is not 16x16');
      rows.forEach((row, y) => [...row].forEach((ch, x) => put(+n, x, y, K[ch] ?? 0)));
    }
    // ground: 16x16 each, painted from noise so it tiles without seams
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = rnd(x, y, 1), r2 = rnd(x, y, 2);
      put(32, x, y, r < 60 ? 17 : r < 130 ? 15 : 16);                                              // grass
      put(34, x, y, r < 60 ? 17 : r < 130 ? 15 : 16);                                              // grass with flowers
      put(36, x, y, (y % 5 === 4) ? (r < 500 ? 6 : 7) : r < 120 ? 9 : r < 240 ? 7 : 8);            // dug soil
      put(38, x, y, (y % 5 === 4) ? 1 : r < 120 ? 8 : r < 420 ? 6 : 7);                           // watered soil
      put(40, x, y, r < 90 ? 10 : r < 200 ? 12 : 11);                                              // path
      put(42, x, y, ((x + y * 2) % 8 === 0 && r2 < 700) ? 23 : r < 100 ? 22 : 21);                 // water
      put(44, x, y, ((x + y * 2 + 4) % 8 === 0 && r2 < 700) ? 23 : r < 100 ? 22 : 21);
      put(46, x, y, ((x + (y >> 2)) % 4 === 0 && y % 4 !== 3) ? 17 : r < 250 ? 14 : 15);           // wild grass, not yours yet
      put(72, x, y, r < 70 ? 18 : r < 420 ? 17 : 16);                    // pasture
      put(70, x, y, r < 30 ? 4 : r < 200 ? 16 : ((x ^ y) & 3) === 0 ? 14 : r < 600 ? 15 : 14);     // brambles
    }
    // the mine: floor, wall, rocks with ore, ladders, and what you carry out
    const blob = (n, speck, hi) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, (y - 8.5) * 1.15) + (rnd(x >> 1, y >> 1, n) % 3) * 0.5;
      if (d > 7.2) continue;
      let c = d > 6.2 ? 31 : (x + y < 13 ? 29 : y > 11 ? 30 : 28);
      if (speck && rnd(x >> 1, y >> 1, n + 9) < 230 && d < 5.5) c = ((x + y) & 1) ? speck : hi;
      put(n, x, y, c);
    } };
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = rnd(x, y, 21);
      put(224, x, y, r < 60 ? 30 : r < 130 ? 6 : 31);                                              // cave floor
      put(226, x, y, (y % 8 === 7 || (x + (y >> 3) * 4) % 8 === 7) ? 1 : r < 150 ? 30 : 28);       // wall
      put(236, x, y, 0); { const d = Math.hypot(x - 7.5, y - 8); put(238, x, y, d < 6 ? 0 : d < 7.5 ? 29 : 0); if (d < 6) put(238, x, y, 1); }
    }
    blob(228); blob(230, 9, 10); blob(232, 11, 29); blob(234, 22, 23);
    for (const n of [236, 238]) for (let y = 1; y < 15; y++) {
      put(n, 4, y, 8); put(n, 11, y, 8); put(n, 5, y, 7); put(n, 12, y, 7);
      if (y % 3 === 1) for (let x = 5; x < 12; x++) put(n, x, y, 9);
    }
    const nugget = (n, c, hi) => [[5, 9, 3], [10, 8, 3.2], [8, 11, 2.6]].forEach(([cx, cy, rr]) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rr) put(n, x, y, d > rr - 1 ? 31 : (x < cx && y < cy) ? hi : c);
      }
    });
    nugget(266, 9, 10); nugget(268, 28, 29); nugget(270, 21, 23); nugget(288, 3, 5);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {                                    // the millstone
      const d = Math.hypot(x - 7.5, y - 8);
      if (d < 7) put(290, x, y, d > 6 ? 30 : d < 1.5 ? 1 : (Math.abs(x - 7.5) < 0.6 || Math.abs(y - 8) < 0.6) ? 28 : 29);
    }
    [[3, 4, 13], [4, 3, 27], [4, 5, 27], [5, 4, 27], [4, 4, 10], [11, 10, 13], [12, 9, 26], [12, 11, 26], [13, 10, 26], [12, 10, 27]]
      .forEach(([x, y, c]) => put(34, x, y, c));
    // a pine, 16x32
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
      let c = 0;
      if (y >= 24 && y < 31 && x >= 6 && x <= 9) c = x === 6 ? 6 : x === 9 ? 7 : 8;
      if (y < 27) {
        const tier = Math.floor(y / 9), ty = y - tier * 8;
        const half = Math.min(7.5, 1 + ty * (0.55 + tier * 0.1) + tier * 1.2);
        const d = Math.abs(x - 7.5);
        if (y >= 1 && d <= half) c = d > half - 1 ? 14 : (x < 7 && rnd(x, y, 5) < 420) ? 17 : rnd(x, y, 6) < 300 ? 15 : 16;
      }
      put(160, x, y, c);
    }
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    // Windrow draws everything itself. The farmer entity type is there so the Bit's home screen can use it as the icon.
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'farmer', anims: [{ name: 'idle', frames: [128], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Windrow', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Windrow', code, buildGfx,
    about: 'A farming game. Start with a digging stick and a leaky bucket on an overgrown plot, forage in the woods, grow crops through four seasons and rebuild the old windmill. The farm lives on while the Bit is off.' });
})();
