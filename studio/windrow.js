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
-- Mid game: the rusted tractor by the Long acre. Mend it with iron and copper from the mine, climb on with A,
-- hold A to work three cells at once with the implement you picked (L), and hop off with Y.
-- Very late game, once the mill turns: build the silo, buy the clockwork driver, and teach the tractor a
-- route by driving it once (Y at the parked tractor). It then drives the route by itself, every morning if you
-- like, working as you did, unloading at the silo and filling its tank at the pond as it passes them.
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
  -- from the wider valley (drawn from code: see draw_found)
  { key = "shell", name = "Whelk shell", sell = 14, icon = "shell" },
  { key = "seaweed", name = "Sea lettuce", sell = 8, icon = "leaf", col = 15 },
  { key = "pearl", name = "Pearl", sell = 120, icon = "gem", col = 13 },
  { key = "bogberry", name = "Bogberry", sell = 15, icon = "berry", col = 25 },
  { key = "marshcap", name = "Marsh cap", sell = 21, icon = "cap", col = 20 },
  { key = "thyme", name = "Hill thyme", sell = 11, icon = "leaf", col = 17 },
  { key = "flint", name = "Flint", sell = 18, icon = "gem", col = 30 },
  { key = "dates", name = "Dates", sell = 22, icon = "berry", col = 8 },
  { key = "pricklefig", name = "Prickle fig", sell = 27, icon = "cap", col = 24 },
  { key = "amber", name = "Amber", sell = 150, icon = "gem", col = 27 },
}
FISH_BY = {}
FOUND_BY = {}
function index_found()
  for i, f in ipairs(FISH) do
    if not FISH_BY[f.key] then FISH_BY[f.key] = f; f.icon = "fish"; FOUND[#FOUND + 1] = f end
  end
  for i, f in ipairs(FOUND) do FOUND_BY[f.key] = f end
end
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
  silo = { name = "Silo", coins = 1500, need = { wood = 30, stone = 30, iron = 10 }, about = "Holds 600 crops. A tractor on a route unloads here as it passes." },
  trac = { name = "Tractor", coins = 800, need = { iron = 12, copper = 10, wood = 6 }, about = "Rusted solid, but all there. Iron and copper come from the mine." },
  coop = { name = "Hen house", coins = 60, need = { wood = 10, fibre = 6 }, about = "Room for 4 hens. Fed hens lay an egg a day." },
  shed = { name = "Goat shed", coins = 200, need = { wood = 20, stone = 10 }, about = "Room for 2 goats. Milk them by hand." },
}
-- the tractor's implements work the three cells it drives across
IMPL = {
  { key = "plough", name = "Plough", cost = 400, about = "Turns grass and weeds into dug soil, three cells wide." },
  { key = "drill", name = "Seed drill", cost = 600, about = "Sows the seed you picked (R) into dug soil as you drive." },
  { key = "tank", name = "Water tank", cost = 500, about = "Waters three cells at once. 90 splashes; fill it at the pond with B." },
  { key = "reaper", name = "Reaper", cost = 900, about = "Picks every ripe crop you drive across." },
}
TRAC_SPEED = tune("Tractor speed", 2, 1, 4, 0.1)
TANK = 90
ROUTE_MAX, SILO_MAX, HOPPER_MAX = 400, 600, 200
SILO_AT = { x = 13, y = 20 }
HEN_NAMES = { "Pip", "Dot", "Clover", "Bean" }
GOAT_NAMES = { "Thistle", "Burr" }
PASTURE = { x = 4, y = 22, w = 14, h = 4 }

-- ---------------------------------------------------------------- the world
-- . grass  : path  ~ water  T tree  B brambles  1-3 plots  h hut  c crate  W wagon  N Marrow  m mill
-- X the north road to the neighbours  t tin box  M old mine  o standing stone  S fallen pine
-- V the rusted tractor  Z the silo
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
  "B.T........................V.B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B...3333333333333333333333...B",
  "B.T..........Z............t..B",
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
  ":..........T.............T",
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
-- The wider valley. , is a second kind of ground (grass by the shore, mud in the fen, bare rock in the hills)
-- P palm  D dead tree  E reeds  K cactus  U boulder  A old bones  J jetty  R C I rocks to break with the pickaxe
SHORE = {
  "TTTTTTTTTTTTT:TTTTTTTTTTTTTT",
  "U,,,,,,,,,T,,:,,,,,,,,T,T,,U",
  "U,,,,,,,,,,,,:,,T,,T,,,,,,,U",
  "U,,,,,,,,,,,,:,,,,,,,,,,,,,U",
  "U............:.............U",
  "U............:.............U",
  "U..tP........:...UP..P.....U",
  "U............:...P.P......UU",
  "U............:::::::::::::::",
  "U..P..U...............U..P.U",
  "U...........P........U.....U",
  "U~..~.~.J~~.~.~~.~..~~..~~~U",
  "~~~~~~~~J~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~J~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~J~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~J~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
}
FEN = {
  "DDDDDD:DDDDDDDDDDDDDDDDDDD",
  "D.....:.E................D",
  "D....E:.......DE....D....D",
  "DD....:....EE....~D......D",
  "D...E.~~.......~~~~~.....D",
  "D....~~~~~.E...~~~~~...D.D",
  "D...~~~~~~.....~~~~~.....D",
  "D..E~~~~~~.......~.......D",
  "D....E~~~,,,,............D",
  "D.......,,EE,,E..,,,..D..D",
  "D....,,,,,,,,.::::::::::::",
  "DE..,E,,...~~~..,,,,.....D",
  "D..D.,,D.~~~~~~~E..~~~..DD",
  "D......E.~~~~~~~..~~~~~.ED",
  "D.E~~~E..~~~~~~...~~~~~..D",
  "D..~~~.....~~~~.D.~~~~~..D",
  "D..~~~...E....D....~~~.D.D",
  "D.........D....ED.....t..D",
  "D.....................E..D",
  "DDDDDDDDDDDDDDDDDDDDDDDDDD",
}
HILLS = {
  "UUUUUUUUUUUUUUUUUUUUUUUUUUUU",
  "U....T.....................U",
  "U.Uo.o........U.........t..U",
  "U...o............T,,I,U....U",
  "U.....,,,R,.......,R,,R....U",
  "U....,,,,,RC.....,,C,,R,...U",
  "UT...,,,,I,,,.....,,,R,,...U",
  "U....RC,,R,C.......,,,....TU",
  "U.....,C,C..T..........T...U",
  "U............~~~..........TU",
  "U...........~~~~~..........U",
  "U.T.....U....~~~...II,,C...U",
  "U.................,,,,,C,..U",
  "U.......,R,R....U,R,RR,,,..U",
  "U......,,,,,.....TR,R,I,,.UU",
  "UT....:.,,,,........,,,R...U",
  "U.....:.......U............U",
  "U.....:............U.......U",
  "U.....:....................U",
  "UUUUUU:UUUUUUUUUUUUUUUUUUUUU",
}
DRY = {
  "UUUUUUUUUUUUUUUUUUUUUUUUUUUUUU",
  "U.......................K....U",
  "U..U.....K...............U...U",
  "U............................U",
  "U.......U....K..A......K.....U",
  "U.....................A......U",
  "U......U.............K.......U",
  "U...............U......KK.K..U",
  "::::::...........KK.,PP......U",
  "U....K.......A....,,,~~,,....U",
  "U.................P,~~~,,....U",
  "U.................P,~~~,,..U.U",
  "U...................P,,,.....U",
  "U........................K.K.U",
  "U........A..................KU",
  "UA.........................U.U",
  "U.....................K...t..U",
  "U................K....K......U",
  "U.....A......U........K......U",
  "UUUUUUUUUUUUUUUUUUUUUUUUUUUUUU",
}
AREAS = { { name = "Windrow", map = FARM }, { name = "Bramble Woods", map = WOODS }, { name = "The Old Mine", w = 20, h = 15, free = {} },
  { name = "Gull Shore", map = SHORE, biome = "shore", short = "Shore", ground2 = 32 },
  { name = "Sedge Fen", map = FEN, biome = "fen", short = "Fen", ground2 = 36 },
  { name = "Flint Hills", map = HILLS, biome = "hills", short = "Hills", ground2 = 224 },
  { name = "The Dry Reach", map = DRY, biome = "dry", short = "Desert", ground2 = 32 } }
-- the ways between them: leave area a by that side and arrive at that cell of the other
EXITS = {
  { a = 1, side = "w", to = 2, x = 25, y = 10 }, { a = 2, side = "e", to = 1, x = 0, y = 5 },
  { a = 2, side = "s", to = 4, x = 13, y = 0 }, { a = 4, side = "n", to = 2, x = 15, y = 19 },
  { a = 2, side = "w", to = 5, x = 25, y = 10 }, { a = 5, side = "e", to = 2, x = 0, y = 9 },
  { a = 5, side = "n", to = 6, x = 6, y = 19 }, { a = 6, side = "s", to = 5, x = 6, y = 0 },
  { a = 4, side = "e", to = 7, x = 0, y = 8, need = "skin", no = "The Dry Reach lies that way. Without a waterskin the sun turns you back." },
  { a = 7, side = "w", to = 4, x = 27, y = 8 },
}
-- what grows wild out there, and what the old tin boxes hold
WILD = {
  [4] = { n = 9, kinds = { "shell", "shell", "seaweed", "seaweed", "wood", "pearl" } },
  [5] = { n = 10, kinds = { "bogberry", "bogberry", "marshcap", "fibre", "fibre", "mushroom" } },
  [6] = { n = 8, kinds = { "thyme", "thyme", "flint", "stone", "cone" } },
  [7] = { n = 7, kinds = { "dates", "pricklefig", "pricklefig", "stone", "amber" } },
}
TIN = {
  [4] = { coins = 60, k = "pearl", n = 1 }, [5] = { coins = 80, k = "marshcap", n = 5 },
  [6] = { coins = 100, k = "glow", n = 2 }, [7] = { coins = 150, k = "amber", n = 2 },
}
-- fish: where they bite (area), how hard they pull (1 to 3), how often (w), and their colours
FISH = {
  { key = "minnow", name = "Minnow", sell = 8, a = 1, str = 1, w = 6, col = 29, belly = 13 },
  { key = "carp", name = "Mirror carp", sell = 24, a = 1, str = 2, w = 3, col = 9, belly = 27 },
  { key = "perch", name = "Bramble perch", sell = 20, a = 2, str = 1, w = 5, col = 16, belly = 27 },
  { key = "trout", name = "Brook trout", sell = 34, a = 2, str = 2, w = 3, col = 8, belly = 25 },
  { key = "sardine", name = "Sardine", sell = 12, a = 4, str = 1, w = 6, col = 21, belly = 13 },
  { key = "mackerel", name = "Mackerel", sell = 28, a = 4, str = 2, w = 4, col = 20, belly = 29 },
  { key = "flatfish", name = "Sand dab", sell = 44, a = 4, str = 2, w = 2, col = 10, belly = 12 },
  { key = "sunray", name = "Lantern ray", sell = 170, a = 4, str = 3, w = 1, col = 27, belly = 25 },
  { key = "eel", name = "Fen eel", sell = 46, a = 5, str = 2, w = 4, col = 14, belly = 17 },
  { key = "catfish", name = "Whisker cat", sell = 58, a = 5, str = 2, w = 3, col = 7, belly = 11 },
  { key = "pike", name = "Bog pike", sell = 110, a = 5, str = 3, w = 1, col = 15, belly = 18 },
  { key = "loach", name = "Stone loach", sell = 36, a = 6, str = 1, w = 4, col = 30, belly = 28 },
  { key = "char", name = "Tarn char", sell = 66, a = 6, str = 3, w = 2, col = 24, belly = 26 },
  { key = "sandperch", name = "Oasis perch", sell = 52, a = 7, str = 2, w = 4, col = 10, belly = 27 },
  { key = "koi", name = "Golden koi", sell = 260, a = 7, str = 3, w = 1, col = 27, belly = 13 },
}
index_found()
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
SOLID = "TB~hcWNmXMoStFkgr#RCIQ<>HZPDKUA"

function hash(x, y, s)
  local n = (x * 374761393 + y * 668265263 + s * 982451653) & 0x7fffffff
  n = ((n ~ (n >> 13)) * 1274126177) & 0x7fffffff
  return (n ~ (n >> 16)) % 1000
end
function clamp(v, a, b) if v < a then return a elseif v > b then return b end return v end
function fl(v) return math.floor(v) end

function build_world()
  for ai, A in ipairs(AREAS) do
    if A.map then
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
  BROKE = {}
end
function tile(a, x, y)
  if a == 3 then return MINE and MINE[y] and MINE[y][x] or "#" end
  local A = AREAS[a]
  x, y = clamp(x, 0, A.w - 1), clamp(y, 0, A.h - 1)        -- the road runs off the edge of the map
  local ch = A.map[y + 1]:sub(x + 1, x + 1)
  if a >= 4 and BROKE[a * 4096 + y * 64 + x] then return "," end      -- a rock you broke today
  return ch
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
  if ch == "S" and G.pine == 1 then return false end
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
  for a, W in pairs(WILD) do
    local A, used = AREAS[a], {}
    for i = 1, W.n do
      local k = hash(G.day, i, a * 13) % #A.free + 1
      if not used[k] then
        used[k] = true
        local kind = W.kinds[hash(i, G.day, a * 17) % #W.kinds + 1]
        if (kind == "pearl" or kind == "amber") and hash(i, G.day, a) > 250 then kind = W.kinds[1] end      -- treasures are rare
        FORAGE[#FORAGE + 1] = { a = a, x = A.free[k][1], y = A.free[k][2], k = kind }
      end
    end
  end
end

-- a night passes. Watered crops (or everything, after rain) grow a day.
function new_day(away)
  local grew = 0
  route_finish()
  each_cell(function(f)
    if f.c > 0 and f.wet and in_season(f.c) and not ripe(f) then f.age = f.age + 1; grew = grew + 1 end
    f.wet = false
  end)
  G.day = G.day + 1
  G.clk = 0
  BROKE = {}
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
  -- the clockwork driver's morning round. While the Bit is off it happens in one go.
  if G.daily == 1 and G.auto == 1 and route_len() > 0 and not riding then
    if away then route_all() else route_start() end
  end
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
      if R.drop then float("+1 " .. tr(FOUND_BY[R.drop].name))
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

-- ---------------------------------------------------------------- the tractor
function near_tractor()
  if G.area ~= 1 or G.trac == 0 or riding then return false end
  local x, y = facing()
  local cx, cy = x * C + 8, y * C + 10
  return (G.tx - cx) ^ 2 + (G.ty - 4 - cy) ^ 2 < 18 * 18 or (G.tx - px) ^ 2 + (G.ty - py) ^ 2 < 14 * 14
end
function mount()
  auto_i = nil
  riding, px, py, work_t = true, G.tx, G.ty, 0
  sfx("C2", 2, 0.3, 20, -1, 0, 60)
  if G.impsel == 0 then say("The engine coughs and catches. Y hops off. Marrow sells implements for it.") end
end
function dismount()
  riding, G.tx, G.ty = false, fl(px), fl(py)
  if teaching then
    teaching = false
    say(route_len() > 1 and ("The tractor remembers the route: " .. route_len() .. " cells. Press Y beside it to send it round.") or "Too short to be a route.")
    if route_len() <= 1 then G.route = "" end
    persist()
  end
  -- step off to a free side
  for _, d in ipairs({ { 0, 14 }, { 14, 0 }, { -14, 0 }, { 0, -14 } }) do
    if not blocked(px + d[1], py + d[2]) then px, py = px + d[1], py + d[2] break end
  end
  sfx("C2", 2, 0.2, 10, -1, 0, -60)
end
function next_impl()
  for i = 1, #IMPL do
    G.impsel = G.impsel % #IMPL + 1
    if G.imp[G.impsel] == 1 then return end
  end
  G.impsel = 0
end
-- One implement working the cell (cx, cy) and the one on either side of the heading (hx, hy).
-- With a seed number it sows that seed and what it reaps goes in the tractor's own hopper (the route);
-- without, it uses the seed you picked and your bag (you are driving).
function work_at(cx, cy, hx, hy, ii, seed)
  local imp, did = IMPL[ii], false
  if not imp or G.imp[ii] ~= 1 then return false end
  for i = -1, 1 do
    local x, y = cx + (hx == 0 and i or 0), cy + (hy == 0 and i or 0)
    local f, p = cell(x, y)
    if f and G.plots[p] then
      if imp.key == "plough" then
        if f.k == 0 or f.k == 1 then f.k, f.hits, did = 4, 0, true end
      elseif imp.key == "drill" then
        if f.k == 4 and f.c == 0 then
          local sd = seed or G.sel
          if not seed and G.seeds[sd] <= 0 then pick_seed(1); sd = G.sel end
          if G.seeds[sd] > 0 and in_season(sd) then
            G.seeds[sd] = G.seeds[sd] - 1
            f.c, f.age, did = sd, 0, true
          end
        end
      elseif imp.key == "tank" then
        if f.k == 4 and not f.wet and G.tank > 0 then G.tank, f.wet, did = G.tank - 1, true, true end
      elseif ripe(f) then
        local c, ok = CROPS[f.c], false
        if seed then
          if hopper_count() < HOPPER_MAX then G.hop[c.key] = (G.hop[c.key] or 0) + 1; ok = true end
        else
          ok = give(c.key, 1)
        end
        if ok then
          G.grown, did = G.grown + 1, true
          if c.regrow then f.age = c.days - c.regrow else f.c, f.age = 0, 0 end
        end
      end
    end
  end
  return did
end

-- ---- the route: taught by driving it once, then driven by the clockwork driver
function hopper_count() local n = 0 for _, v in pairs(G.hop) do n = n + v end return n end
function silo_count() local n = 0 for _, v in pairs(G.silo) do n = n + v end return n end
function route_len() return #G.route // 4 end
function route_step(i)
  local a, b, c, d = G.route:byte(i * 4 - 3, i * 4)
  return a - 48, b - 48, (c - 48) % 2 == 1, (c - 48) // 2, d - 48
end
function teach_start()
  mount()
  G.route, teaching, teach_last = "", true, nil
  say("Drive the route once, working as you go. Y hops off and the tractor remembers it.")
end
function teach_step()
  local cx, cy = fl(px / C), fl((py - 4) / C)
  if teach_last == cx + cy * 64 then
    -- still in the same cell: remember if you started working here
    if btn("a") and route_len() > 0 then
      local n = #G.route
      local c = G.route:byte(n - 1) - 48
      if c % 2 == 0 then G.route = G.route:sub(1, n - 2) .. string.char(48 + c + 1) .. G.route:sub(n) end
    end
    return
  end
  if route_len() >= ROUTE_MAX then
    teaching = false
    say("That is as long a route as the clockwork can hold: " .. ROUTE_MAX .. " cells.")
    return
  end
  teach_last = cx + cy * 64
  G.route = G.route .. string.char(48 + cx, 48 + cy, 48 + (btn("a") and 1 or 0) + G.impsel * 2, 48 + G.sel)
end
-- what the tractor does when it reaches step i of its route
function route_arrive(i)
  local x, y, work, ii, sd = route_step(i)
  local hx, hy = 1, 0
  if i > 1 then
    local ox, oy = route_step(i - 1)
    if x ~= ox or y ~= oy then hx, hy = x - ox, y - oy end
  elseif route_len() > 1 then
    local nx, ny = route_step(2)
    hx, hy = nx - x, ny - y
  end
  hx, hy = clamp(hx, -1, 1), clamp(hy, -1, 1)
  if hx ~= 0 then hy = 0 end
  auto_hx, auto_hy, auto_imp = hx, hy, ii
  if work and work_at(x, y, hx, hy, ii, sd) then work_t = 8 end
  -- passing the silo it unloads, passing water it fills the tank
  if G.silo_b == 1 and math.abs(x - SILO_AT.x) <= 3 and math.abs(y - SILO_AT.y) <= 3 then
    for k, v in pairs(G.hop) do
      local take = math.min(v, SILO_MAX - silo_count())
      if take > 0 then G.silo[k] = (G.silo[k] or 0) + take; G.hop[k] = v - take end
      if G.hop[k] == 0 then G.hop[k] = nil end
    end
  end
  if G.imp[3] == 1 and G.tank < TANK then
    for oy = -2, 2 do for ox = -2, 2 do
      if tile(1, x + ox, y + oy) == "~" then G.tank = TANK end
    end end
  end
  G.tx, G.ty = x * C + 8, y * C + 12
end
function route_start()
  if route_len() == 0 or G.trac == 0 or G.auto == 0 or riding then return false end
  auto_i, auto_hx, auto_hy, auto_imp = 1, 1, 0, 0
  local x, y = route_step(1)
  G.tx, G.ty = x * C + 8, y * C + 12
  route_arrive(1)
  return true
end
-- the rest of the route in one go: at night, or on days that pass while the Bit is off
function route_finish()
  if not auto_i then return end
  for i = auto_i + 1, route_len() do route_arrive(i) end
  auto_i = nil
end
function route_all() if route_start() then route_finish() end end
function update_route()
  if not auto_i then return end
  if work_t > 0 then work_t = work_t - 1 end
  local n = auto_i + 1
  if n > route_len() then
    auto_i = nil
    if G.area == 1 then say("The tractor has finished its round.") end
    persist()
    return
  end
  local x, y = route_step(n)
  local tx, ty = x * C + 8, y * C + 12
  local ex, ey = tx - G.tx, ty - G.ty
  local d = math.max(math.abs(ex), math.abs(ey))
  local sp = TRAC_SPEED * 0.75
  if d <= sp then
    auto_i = n
    route_arrive(n)
  else
    G.tx, G.ty = G.tx + clamp(ex, -sp, sp), G.ty + clamp(ey, -sp, sp)
    if math.abs(ex) > math.abs(ey) then auto_hx, auto_hy = ex > 0 and 1 or -1, 0 else auto_hx, auto_hy = 0, ey > 0 and 1 or -1 end
  end
end
function auto_items()
  local L = { "Teach it a route" }
  if route_len() > 0 then
    L[#L + 1] = auto_i and "Stop it" or "Send it round now"
    L[#L + 1] = tr("Every morning: %s", tr(G.daily == 1 and "yes" or "no"))
    L[#L + 1] = "Forget the route"
  end
  return L
end
function update_auto()
  local L = auto_items()
  if btnp("up") then ui_sel = (ui_sel - 2) % #L + 1 end
  if btnp("down") then ui_sel = ui_sel % #L + 1 end
  ui_sel = clamp(ui_sel, 1, #L)
  if btnp("b") then ui = nil return end
  if not btnp("a") then return end
  local it = L[ui_sel]
  if it == "Teach it a route" then auto_i = nil; ui = nil; teach_start()
  elseif it == "Send it round now" then ui = nil; route_start()
  elseif it == "Stop it" then auto_i = nil
  elseif it == "Forget the route" then G.route, G.daily, auto_i, ui_sel = "", 0, nil, 1
  else G.daily = 1 - G.daily end
  sfx("E5", 1, 0.2, 4)
  persist()
end
function silo_sell()
  local total, n = 0, 0
  for k, v in pairs(G.silo) do total, n = total + price(k) * v, n + v end
  if n == 0 then sfx("C3", 0, 0.2, 6) return end
  G.silo = {}
  G.coins, G.sold = G.coins + total, G.sold + n
  ui = nil
  say("Marrow's cart takes " .. n .. " crops from the silo for " .. total .. " coins.")
  float("+" .. total, 27)
  sfx("E5", 1, 0.3, 6) sfx("A5", 1, 0.3, 10)
  persist()
end

-- ---------------------------------------------------------------- neighbours: other Bits in reach
-- Every Bit keeps its own farm. Linked Bits talk with network events (net_send / net_recv): the north road
-- leads to a neighbour's farm, where you can walk about, water their crops and leave gifts at their crate.
-- Each farm has a wish a day (a gift of it is paid back), and everything the valley reaps fills one fair basket.
EV_HI, EV_GET, EV_INFO, EV_ROW, EV_POS, EV_WATER, EV_GIFT, EV_THANK, EV_FAIR = 4101, 4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109
WIRE, WIRE_BY = {}, {}
for i, c in ipairs(CROPS) do WIRE[#WIRE + 1] = c.key end
for i, f in ipairs(FOUND) do WIRE[#WIRE + 1] = f.key end
for i, k in ipairs(WIRE) do WIRE_BY[k] = i end
CELLS = {}
for p = 1, #PLOTS do for i = 1, PLOTS[p].w * PLOTS[p].h do CELLS[#CELLS + 1] = { p, i } end end
NCH = (#CELLS + 9) // 10            -- the fields travel ten cells to an event
FAIR_EACH = 25                      -- crops per farm that fill the fair basket
function item_name(k) return CROP_BY[k] and CROPS[CROP_BY[k]].name or FOUND_BY[k].name end
function net_reset()
  NEAR, GUESTS, visiting, HOME, fetch, outbox, seen_gift, VG, VF = {}, {}, nil, nil, nil, {}, {}, nil, nil
  fair_cool, fair_echo, net_t, water_note, refresh_i = 0, 0, 0, 0, 0
  nonce = (clock() * 31 + (NET_ID or 0)) % 100000
end
function who(id) return net_name(id, 8) or ("Bit " .. id % 1000) end
function mine() return HOME and HOME.G or G end                -- my own farm, also while I am away visiting
function my_field() return HOME and HOME.FIELD or FIELD end
function near_ids()
  local L = {}
  for id in pairs(NEAR) do L[#L + 1] = id end
  table.sort(L)
  return L
end
function my_wish()
  local me = mine()
  if me.wishday == me.day then return 0 end
  return ((NET_ID or 0) + me.day * 7) % #CROPS + 1
end
function fair_count() local me = mine() return clamp(me.grown - me.fair0, 0, 999) end
function fair_total()
  local n, sum = 1, fair_count()
  for id, o in pairs(NEAR) do n, sum = n + 1, sum + o.fair end
  return sum, n * FAIR_EACH, n
end
function has_guest()
  for id, o in pairs(NEAR) do if o.at == NET_ID then return true end end
  return false
end

-- one piece of my farm for a visitor: piece 0 is the yard, the others ten field cells each
function send_chunk(to, ch)
  local me, F = mine(), my_field()
  if ch == 0 then
    local flags, hens, goats = 0, 0, 0
    for p = 1, 3 do if me.plots[p] then flags = flags | (1 << (p - 1)) end end
    flags = flags | me.coop * 8 | me.shed * 16 | me.silo_b * 32 | me.trac * 64 | (me.rain and 128 or 0) | me.mill * 256
    for _, a in ipairs(me.an) do if a.k == "h" then hens = hens + 1 else goats = goats + 1 end end
    net_send(EV_INFO, to, me.day, me.clk, flags, hens * 16 + goats, fl(me.tx / C) + fl(me.ty / C) * 64, me.feed)
    return
  end
  local v = {}
  for j = 0, 4 do
    local w = 0
    for h = 0, 1 do
      local cm = CELLS[(ch - 1) * 10 + j * 2 + h + 1]
      if cm then
        local f = F[cm[1]][cm[2]]
        w = w | (f.k | f.c << 3 | math.min(f.age, 15) << 7 | (f.wet and 1 or 0) << 11) << (h * 12)
      end
    end
    v[j + 1] = w
  end
  net_send(EV_ROW, to, ch, v[1], v[2], v[3], v[4], v[5])
end
function apply_info(day, clk, flags, herd_n, tr, feed)
  local g = VG
  g.day, g.clk, g.feed = day, clamp(clk, 0, DAY_FRAMES - 1), feed
  for p = 1, 3 do g.plots[p] = flags & (1 << (p - 1)) ~= 0 end
  g.coop, g.shed, g.silo_b, g.trac = flags >> 3 & 1, flags >> 4 & 1, flags >> 5 & 1, flags >> 6 & 1
  g.rain, g.mill = flags & 128 ~= 0, flags >> 8 & 3
  g.tx, g.ty = tr % 64 * C + 8, tr // 64 * C + 12
  local hens, goats = clamp(herd_n >> 4, 0, 4), clamp(herd_n & 15, 0, 2)
  if #g.an ~= hens + goats then
    g.an = {}
    for i = 1, hens do g.an[#g.an + 1] = { k = "h", n = i, love = 10, p = 0, m = 0 } end
    for i = 1, goats do g.an[#g.an + 1] = { k = "g", n = i, love = 10, p = 0, m = 0 } end
    if G == g then place_animals() end
  end
end
function apply_row(ch, ...)
  local v = { ... }
  for j = 0, 4 do
    for h = 0, 1 do
      local cm = CELLS[(ch - 1) * 10 + j * 2 + h + 1]
      if cm and v[j + 1] then
        local w = v[j + 1] >> (h * 12) & 4095
        local f = VF[cm[1]][cm[2]]
        f.k, f.c, f.age, f.wet = clamp(w & 7, 0, 4), clamp(w >> 3 & 15, 0, #CROPS), w >> 7 & 15, w >> 11 & 1 == 1
        if f.c > 0 and f.age == 15 then f.age = 99 end
      end
    end
  end
end

function start_visit(id)
  VG, VF = fresh(), {}
  for p = 1, #PLOTS do
    VF[p] = {}
    for i = 1, PLOTS[p].w * PLOTS[p].h do VF[p][i] = { k = 0, c = 0, age = 0, wet = false, hits = 0 } end
  end
  fetch = { id = id, got = {}, t = 0, at = 0 }
  ui = "fetch"
end
function enter_visit()
  local id = fetch.id
  fetch, ui = nil, nil
  if riding then dismount() end
  persist()
  HOME = { G = G, FIELD = FIELD, FORAGE = FORAGE, ANIM = ANIM, px = px, py = py, auto_i = auto_i }
  local H = G
  VG.inv, VG.seeds, VG.sel, VG.bag, VG.can, VG.water, VG.hoe, VG.coins, VG.pick, VG.axe = H.inv, H.seeds, H.sel, H.bag, H.can, H.water, H.hoe, H.coins, H.pick, H.axe
  G, FIELD, FORAGE, visiting, auto_i, GUESTS = VG, VF, {}, id, nil, {}
  ANIM = nil
  place_animals()
  px, py, dx, dy, fade, refresh_i = 14 * C + 8, 1 * C + 14, 0, 1, 31, 0
  say(tr("This is %s's farm. B waters their crops, the crate takes gifts, the north road leads home.", who(id)))
  sfx("C5", 1, 0.25, 6) sfx("G5", 1, 0.25, 10)
end
function leave_visit(msg)
  local H = HOME
  H.G.water, H.G.sel, H.G.coins = G.water, G.sel, G.coins
  G, FIELD, FORAGE, ANIM, px, py, auto_i = H.G, H.FIELD, H.FORAGE, H.ANIM, H.px, H.py, H.auto_i
  HOME, visiting, VG, VF, GUESTS = nil, nil, nil, nil, {}
  dx, dy, fade, ui = 0, 1, 31, nil
  say(msg or "Home again.")
  persist()
end
function visit_hands()
  local x, y = facing()
  local ch = tile(1, x, y)
  if ch == "X" then leave_visit()
  elseif ch == "c" then ui, ui_sel = "gift", 1
  else say(tr("%s's farm. B waters their crops, the crate takes gifts, the north road leads home.", who(visiting))) end
end
function visit_water()
  local x, y = facing()
  local f = cell(x, y)
  local was = f and f.wet
  use_water()
  if f and f.wet and not was then net_send(EV_WATER, visiting, x, y) net_send(EV_WATER, visiting, x, y) end
end
function gift_items()
  local L = {}
  for i, k in ipairs(WIRE) do if have(k) > 0 then L[#L + 1] = k end end
  return L
end
function update_gift()
  local L = gift_items()
  if btnp("b") or #L == 0 and btnp("a") then ui = nil return end
  if #L == 0 then return end
  if btnp("up") then ui_sel = (ui_sel - 2) % #L + 1 end
  if btnp("down") then ui_sel = ui_sel % #L + 1 end
  ui_sel = clamp(ui_sel, 1, #L)
  if btnp("a") and #outbox < 8 then
    local k = L[ui_sel]
    G.inv[k] = have(k) > 1 and have(k) - 1 or nil
    nonce = nonce + 1
    outbox[#outbox + 1] = { to = visiting, nonce = nonce, k = k, t = 0, tries = 0 }
    sfx("E5", 1, 0.2, 4)
  end
end
-- what the neighbours left for me goes in the bag when there is room
function deliver_post()
  local me, got = mine(), 0
  for k, n in pairs(me.post) do
    local mat = FOUND_BY[k] and FOUND_BY[k].mat
    local room = mat and n or math.min(n, BAG[me.bag] - count_bag())
    if room > 0 then
      me.inv[k] = (me.inv[k] or 0) + room
      me.post[k] = n > room and n - room or nil
      got = got + room
    end
  end
  return got
end
function fair_prize()
  local me = mine()
  me.fair0 = me.grown
  G.coins = G.coins + 150
  for p, F in ipairs(my_field()) do for i, f in ipairs(F) do if f.k == 4 then f.wet = true end end end
  for id, o in pairs(NEAR) do o.fair = 0 end
  fair_cool = 900
  say("The valley fair! The farms filled the basket together: 150 coins each, and every field is watered.")
  float("+150", 27)
  sfx("C5", 1, 0.3, 8) sfx("E5", 1, 0.3, 14) sfx("G5", 1, 0.3, 20) sfx("C6", 1, 0.3, 30)
end

function net_event(from, ev, a, b, c, d, e, f)
  if ev == EV_HI then
    local o = NEAR[from] or { fair = 0 }
    if e == NET_ID and o.at ~= NET_ID and not visiting then say(tr("%s has come to visit your farm.", who(from))) sfx("G5", 1, 0.2, 6) end
    o.t, o.day, o.mill, o.wish, o.at = 0, a or 1, b or 0, c or 0, e or 0
    if fair_cool == 0 then o.fair = d or 0 end
    NEAR[from] = o
  elseif ev == EV_POS then
    if a == (visiting or NET_ID) and (visiting or G.area == 1) then
      local g = GUESTS[from] or { x = b, y = c }
      g.tx, g.ty, g.d, g.t = b, c, d, 0
      GUESTS[from] = g
    end
  elseif ev == EV_FAIR then
    if fair_cool == 0 then fair_prize() end
  elseif a ~= NET_ID then
    return                                -- the rest is addressed to one Bit
  elseif ev == EV_GET then
    send_chunk(from, b)
  elseif ev == EV_INFO then
    if VG and from == (fetch and fetch.id or visiting) then
      apply_info(b, c, d, e, f, net_row5 or 0)
      if fetch then fetch.got[0] = true end
    end
  elseif ev == EV_ROW then
    if VF and from == (fetch and fetch.id or visiting) and b >= 1 and b <= NCH then
      apply_row(b, c, d, e, f, net_row5)
      if fetch then fetch.got[b] = true end
    end
  elseif ev == EV_WATER then
    local F = my_field()
    for p, P in ipairs(PLOTS) do
      if b >= P.x and c >= P.y and b < P.x + P.w and c < P.y + P.h then
        local fc = F[p][(c - P.y) * P.w + (b - P.x) + 1]
        if fc.k == 4 then fc.wet = true end
      end
    end
    if water_note == 0 then water_note = 900 say(tr("%s is watering your crops.", who(from))) end
  elseif ev == EV_GIFT then
    local key, k = from .. ":" .. b, WIRE[c]
    if k and seen_gift[key] == nil then
      local me, coins = mine(), 0
      if c == my_wish() then coins, me.wishday = 40 + price(k) * 4, me.day end
      me.post[k] = (me.post[k] or 0) + 1
      deliver_post()
      seen_gift[key] = coins
      say(tr("%s left you a gift: %s.", who(from), tr(item_name(k))) .. (coins > 0 and tr(" Just what you wished for!") or ""))
      sfx("E5", 1, 0.25, 6) sfx("A5", 1, 0.25, 10)
    end
    if seen_gift[key] then net_send(EV_THANK, from, b, seen_gift[key]) end
  elseif ev == EV_THANK then
    for i, o in ipairs(outbox) do
      if o.nonce == b and o.to == from then
        table.remove(outbox, i)
        if c > 0 then
          G.coins = G.coins + c
          float("+" .. c, 27)
          say(tr("It was %s's wish for today! The valley pays you %d coins.", who(from), c))
          sfx("E5", 1, 0.3, 6) sfx("A5", 1, 0.3, 10)
        end
        break
      end
    end
  end
end

function update_net()
  if not NET_ID or NET_ID == 0 then return end
  net_t = net_t + 1
  if fair_cool > 0 then fair_cool = fair_cool - 1 end
  if water_note > 0 then water_note = water_note - 1 end
  local me = mine()
  if net_t % 60 == 1 then net_send(EV_HI, me.day, me.mill, my_wish(), fair_count(), visiting or 0) end
  for id, o in pairs(NEAR) do o.t = o.t + 1 if o.t > 400 then NEAR[id] = nil end end
  for id, g in pairs(GUESTS) do
    g.t, g.x, g.y = g.t + 1, g.x + (g.tx - g.x) * 0.3, g.y + (g.ty - g.y) * 0.3
    if g.t > 90 then GUESTS[id] = nil end
  end
  while true do
    local from, ev, a, b, c, d, e, f, g = net_recv()
    if not from then break end
    net_row5 = g
    net_event(from, ev, a, b, c, d, e, f)
  end
  -- where I stand, for those on the same farm
  local farm = visiting or (G.area == 1 and has_guest() and NET_ID) or nil
  if farm and net_t % 8 == 0 then
    net_send(EV_POS, farm, fl(px), fl(py), (dx < 0 and 1 or dx > 0 and 2 or dy < 0 and 3 or 0) + (walk > 0 and 4 or 0) + (riding and 8 or 0))
  end
  -- on the way over: ask for the pieces of the farm until all have arrived
  if fetch then
    fetch.t = fetch.t + 1
    local left = 0
    for ch = 0, NCH do if not fetch.got[ch] then left = left + 1 end end
    if left == 0 then enter_visit()
    elseif fetch.t > 600 or not NEAR[fetch.id] then
      fetch, ui, VG, VF = nil, nil, nil, nil
      say("You lost the way. The neighbour's farm is out of reach.")
    elseif fetch.t % 3 == 0 then
      for i = 1, NCH + 1 do
        fetch.at = (fetch.at + 1) % (NCH + 1)
        if not fetch.got[fetch.at] then net_send(EV_GET, fetch.id, fetch.at) break end
      end
    end
  elseif visiting then
    G.clk = math.min(G.clk + 1, DAY_FRAMES - 1)
    if not NEAR[visiting] then leave_visit("You lost sight of the neighbour's farm and walked home.")
    elseif net_t % 12 == 0 then
      refresh_i = (refresh_i + 1) % (NCH + 1)
      net_send(EV_GET, visiting, refresh_i)       -- the farm you stand on keeps changing
    end
  end
  -- gifts on their way are sent again until the neighbour thanks you
  for i = #outbox, 1, -1 do
    local o = outbox[i]
    if o.t % 20 == 0 then
      o.tries = o.tries + 1
      if o.tries > 15 then
        table.remove(outbox, i)
        me.inv[o.k] = (me.inv[o.k] or 0) + 1
        say("Your gift did not arrive. It is back in your bag.")
      else net_send(EV_GIFT, o.to, o.nonce, WIRE_BY[o.k], 1) end
    end
    o.t = o.t + 1
  end
  -- the fair: when the valley's basket is full, everyone in reach wins
  if fair_echo > 0 then
    fair_echo = fair_echo - 1
    if fair_echo % 10 == 0 then net_send(EV_FAIR) end
  elseif fair_cool == 0 and net_t % 30 == 0 and fair_count() > 0 then
    local sum, want, n = fair_total()
    if n > 1 and sum >= want then fair_echo = 30 net_send(EV_FAIR) fair_prize() end
  end
end
function update_near()
  local L = near_ids()
  if btnp("b") or #L == 0 then ui = nil return end
  if btnp("up") then ui_sel = (ui_sel - 2) % #L + 1 end
  if btnp("down") then ui_sel = ui_sel % #L + 1 end
  ui_sel = clamp(ui_sel, 1, #L)
  if btnp("a") then start_visit(L[ui_sel]) sfx("E5", 1, 0.2, 4) end
end
function draw_guest(g, id)
  local x, y, d = fl(g.x), fl(g.y), g.d
  local dir = d & 3
  if d & 8 ~= 0 then
    draw_tractor(x, y, dir == 1 and -1 or dir == 2 and 1 or 0, dir == 3 and -1 or dir == 0 and 1 or 0, false, false)
  else
    circfill(x, y, 4, 15)
  end
  local n = dir == 3 and 132 or (dir == 1 or dir == 2) and 136 or 128
  if d & 4 ~= 0 and t() % 20 >= 10 then n = n + 2 end
  local lift = d & 8 ~= 0 and 9 or 0
  pal(26, 21) pal(24, 20)
  spr(n, x - 8, y - 15 - lift, 2, 2, dir == 1)
  pal()
  local nm = who(id)
  text(nm, x - #nm * 4 + 1, y - 25 - lift, 1) text(nm, x - #nm * 4, y - 26 - lift, 13)
end
function draw_near()
  local L = near_ids()
  panel(20, 30, 280, 180, "The north road")
  local sum, want = fair_total()
  text("Fair basket: " .. math.min(sum, want) .. " of " .. want .. " crops reaped", 28, 48, 12)
  for i, id in ipairs(L) do
    local o, y = NEAR[id], 46 + i * 22
    if i <= 5 then
      if i == ui_sel then rectfill(24, y - 2, 272, 21, 8) end
      text(tr("%s's farm", who(id)), 30, y, i == ui_sel and 27 or 13)
      text(SEASON[season(o.day)] .. " " .. day_of(o.day), 220, y, 12)
      text(o.wish > 0 and CROPS[o.wish] and tr("Wishes for: %s", tr(CROPS[o.wish].name)) or "Wish granted today", 30, y + 10, 17)
      text("mill " .. o.mill .. "/" .. #MILL, 220, y + 10, 11)
    end
  end
  text("A: walk over   B: back", 28, 196, 11)
end
function draw_gift()
  local L = gift_items()
  local o = NEAR[visiting]
  panel(40, 30, 240, 180, tr("A gift for %s", who(visiting)))
  text(o and o.wish > 0 and CROPS[o.wish] and tr("Their wish today: %s", tr(CROPS[o.wish].name)) or "No wish left today.", 48, 48, 17)
  if #L == 0 then text("Your bag is empty.", 48, 70, 28) end
  local first = math.max(1, clamp(ui_sel, 1, math.max(#L, 1)) - 7)
  for i = first, math.min(#L, first + 7) do
    local y = 50 + (i - first + 1) * 15
    if i == ui_sel then rectfill(44, y - 3, 232, 14, 8) end
    draw_icon(L[i], 48, y - 5)
    text(tr(item_name(L[i])), 68, y, i == ui_sel and 27 or 13) text("x" .. have(L[i]), 236, y, 27)
  end
  text(#outbox > 0 and "On its way..." or "A: give one   B: back", 48, 196, 11)
end

-- hold A while driving: the implement works the cell under the tractor and the one on either side
function tractor_work()
  local imp = IMPL[G.impsel]
  if not imp or G.imp[G.impsel] ~= 1 then
    if btnp("a") then say("No implement on the hitch. Marrow sells a plough, a seed drill, a water tank and a reaper.") end
    return
  end
  local did = work_at(fl(px / C), fl((py - 4) / C), dx, dy, G.impsel, nil)
  if did then
    work_t = 8
    sfx(imp.key == "tank" and "G4" or "C3", 3, 0.2, 4)
  elseif btnp("a") then
    if imp.key == "tank" and G.tank <= 0 then say("The water tank is empty. Drive up to the pond and press B.")
    elseif imp.key == "drill" and G.seeds[G.sel] <= 0 then say("The seed drill is empty: no seeds.") end
  end
end
function update_riding()
  if work_t > 0 then work_t = work_t - 1 end
  if teaching then teach_step() end
  if btn("a") then tractor_work() end
  if btnp("y") then dismount()
  elseif btnp("l") then next_impl() sfx("E4", 1, 0.15, 3)
  elseif btnp("r") then pick_seed(1) sfx("E4", 1, 0.15, 3)
  elseif btnp("x") then ui = "bag"
  elseif btnp("b") then
    local x, y = facing()
    if tile(1, x, y) == "~" and G.imp[3] == 1 then
      G.tank = TANK
      sfx("C4", 4, 0.3, 10, -1, 0, 300)
      float("tank full", 22)
    else
      sfx("A3", 0, 0.25, 10) sfx("A3", 0, 0.25, 10, -1, 0, 0)     -- honk
    end
  end
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
    if G.feed == 0 then
      -- an empty trough is topped up from the silo, cheapest crop first
      local best, bv = nil, 1e9
      for k, v in pairs(G.silo) do if v > 0 and price(k) < bv then best, bv = k, price(k) end end
      if best then
        G.silo[best] = G.silo[best] - 1
        if G.silo[best] == 0 then G.silo[best] = nil end
        G.feed = 2
      end
    end
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
    if G.pail == 0 then say(tr("%s has milk for you, but you need a pail. Marrow has one.", animal_name(a))) return end
    local k = a.love >= 60 and "cream" or "milk"
    if give(k, 1) then
      a.m = 0
      float("+1 " .. tr(FOUND_BY[k].name))
      sfx("G4", 4, 0.25, 8) sfx("C5", 4, 0.25, 12)
      swing("pick")
    end
  elseif a.p == 0 then
    a.p, a.love = 1, math.min(100, a.love + 6)
    float(animal_name(a) .. " <3", 26)
    sfx(a.k == "h" and "A5" or "D4", a.k == "h" and 1 or 2, 0.2, 6)
    swing("pick")
  else
    say(tr("%s is content. %d of 10 hearts.", animal_name(a), hearts(a)))
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
  if ui_kind ~= "silo" then G[ui_kind] = 1 end
  ui = nil
  sfx("C5", 1, 0.3, 8) sfx("E5", 1, 0.3, 14) sfx("G5", 1, 0.3, 22)
  if ui_kind == "silo" then G.silo_b = 1 say("The silo stands! Marrow now has a clockwork driver for your tractor.")
  elseif ui_kind == "trac" then say("It runs! A climbs on, Y hops off. Marrow sells implements for it.")
  else say(ui_kind == "coop" and "The hen house stands! Marrow can bring you hens." or "The goat shed stands! Marrow can bring you goats and a pail.") end
  persist()
end

-- ---------------------------------------------------------------- start, save, load
function fresh()
  return { v = 1, coins = 0, day = 1, clk = 0, area = 1, px = 8 * C + 8, py = 4 * C + 14, sel = 1,
    seeds = { 4, 0, 0, 0, 0, 0, 0, 0, 0 }, inv = {}, bag = 1, hoe = 1, can = 1, water = 5, pick = 0, axe = 0,
    plots = { true, false, false }, mill = 0, millc = 0, rain = false, demand = 1, tins = "00",
    sold = 0, picked = 0, grown = 0, mine = 0, deep = 0, lamp = 0, gotms = 0,
    silo_b = 0, silo = {}, hop = {}, auto = 0, route = "", daily = 0, post = {}, wishday = 0, fair0 = 0,
    rod = 0, skin = 0, pine = 0, fishn = {}, caught = 0, seen = {},
    trac = 0, tx = 27 * C + 8, ty = 14 * C + 14, imp = { 0, 0, 0, 0 }, impsel = 0, tank = 0, coop = 0, shed = 0, pail = 0, feed = 0, an = {} }
end

function persist()
  if PLAYERS > 1 or visiting then return end
  G.px, G.py = fl(px), fl(py)
  if riding then G.tx, G.ty = G.px, G.py end
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
  net_reset()
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
  if G.area == 3 or not AREAS[G.area] then G.area = 2 end
  while #G.tins < #AREAS do G.tins = G.tins .. "0" end
  BROKE, FISHING, fish_rest = {}, nil, nil
  px, py = G.px, G.py
  MINE, MOBS, mine_n, mine_hp, hurt_t, mine_hits, mine_at = nil, {}, 0, 3, 0, 0, nil
  riding, work_t, teaching, teach_last, auto_i, auto_hx, auto_hy, auto_imp = false, 0, false, nil, nil, 1, 0, 0
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
        grew = grew + new_day(true)
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
    players = {1, 8},                 -- your own farm on every Bit; linked Bits visit each other (net_send)
    goal = "Rebuild the old windmill of Windrow.",
    title_draw = draw_title,
    look = { title = 27, shadow = 7, panel = 6, edge = 10, hi = 8, text = 12, pick = 27, goal = 12, footer = 11, menu = "left" },
    help = {
      "A: use your hands on what is in front of you. Pull weeds, dig, plant, pick and talk.",
      "B: water. Fill up at a pond. L / R: pick seeds. X: your bag. Y: look closer.",
      "Watered crops grow overnight. Sleep in the hut, sell at the crate, shop at the wagon.",
      "Bramble Woods lies west along the road. Bring what the mill needs to the ruin.",
      "The mine in the woods opens with a pickaxe. Break rocks for ore, find the ladder down. A also hits.",
      "The valley is wide: the fen west of the woods, hills beyond it, the shore south (bring an axe), a desert east of that.",
      "Fishing: A at water with a rod. Strike on the bite, reel while the fish rests, ease off when it runs.",
      "Other Bits in reach are neighbours: the north road leads to their farms. Water for them, leave gifts.",
      "After the mill: build the silo, buy the clockwork driver, press Y by the tractor and teach it a route.",
      "The rusted tractor by the Long acre can be mended. On it: hold A to work, L changes implement, Y hops off.",
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
function low(s) if lang() == "en" then return s:lower() end return s end
function say(s) s = tr(s) toast, toast_t = s, 60 + #s * 3 end
function float(s, c) s = tr(s) floats[#floats + 1] = { x = px, y = py - 20, s = s, c = c or 13, t = 45 } end
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
  if riding then riding, G.tx, G.ty = false, fl(px), fl(py) end
  if teaching then teaching = false; if route_len() <= 1 then G.route = "" end end
  fade, fade_fn = 1, function()
    new_day()
    G.area, px, py, dx, dy = 1, 8 * C + 8, 4 * C + 14, 0, 1
    persist()
    say(SEASON[season()] .. " " .. day_of() .. ". " .. (G.rain and (season() == 4 and "Snow is falling: the soil is wet." or "It is raining: the soil is wet.") or "A clear morning."))
  end
end

-- ---------------------------------------------------------------- the wider valley
-- walking off the edge of an area along a road
function try_exit()
  local a, A = G.area, AREAS[G.area]
  local side = px < 3 and "w" or px > A.w * C - 3 and "e" or py < 10 and "n" or py > A.h * C - 3 and "s" or nil
  if not side then return end
  for _, e in ipairs(EXITS) do
    if e.a == a and e.side == side then
      if e.need and G[e.need] ~= 1 then
        px, py = clamp(px, 6, A.w * C - 6), clamp(py, 12, A.h * C - 6)
        if toast_t == 0 then say(e.no) end
        return
      end
      local T = AREAS[e.to]
      G.area = e.to
      px = e.x == 0 and 8 or e.x == T.w - 1 and T.w * C - 8 or e.x * C + 8
      py = e.y == 0 and 14 or e.y == T.h - 1 and T.h * C - 6 or e.y * C + 12
      fade = 31
      if e.to >= 4 and not G.seen[T.short] then
        G.seen[T.short] = 1
        say(tr("You found %s!", tr(T.name)))
        sfx("C5", 1, 0.25, 6) sfx("E5", 1, 0.25, 10) sfx("G5", 1, 0.25, 16)
      end
      persist()
      return
    end
  end
end
-- rocks above ground: the pickaxe breaks them, and they are back the next morning
function quarry_hands(a, x, y, ch)
  local R = ROCKS[ch]
  if G.pick == 0 then say("Solid rock. A pickaxe would break it.") return end
  local at = a * 4096 + y * 64 + x
  mine_hits = (mine_at == at) and mine_hits + 1 or 1
  mine_at = at
  swing("chop")
  sfx(R.drop and "C4" or "A3", 3, 0.3, 5)
  if mine_hits < R.hits + 1 then return end
  local drop = R.drop or (hash(x, y, G.day) < 400 and "flint" or "stone")
  if not give(drop, 1) then mine_hits = R.hits return end
  float("+1 " .. FOUND_BY[drop].name)
  BROKE[at] = true
  mine_at = nil
end

-- ---------------------------------------------------------------- fishing
-- A at water casts. Wait for the bite, strike with A, then bring it in: hold A to reel while the fish rests
-- and ease off while it runs, or the line snaps. A light press reels gently on a Bit with analog buttons.
function fish_rand(n, salt) return hash(t(), G.caught + salt, n + G.day) % n end
function start_fishing(x, y)
  if fish_rest then return end       -- a held button does not cast again: let go of A first
  if count_bag() >= BAG[G.bag] then say("Your bag is full. No room for a fish.") return end
  FISHING = { phase = "wait", t = 50 + fish_rand(170, 1), x = x, y = y, dist = 0, ten = 0, run = false, runt = 0, age = 0 }
  ui = "fish"
  sfx("G4", 4, 0.2, 6, -1, 0, -200)
end
function pick_fish(a)
  local L, sum = {}, 0
  for _, f in ipairs(FISH) do if f.a == a then L[#L + 1] = f; sum = sum + f.w end end
  if #L == 0 then for _, f in ipairs(FISH) do if f.a == 1 then L[#L + 1] = f; sum = sum + f.w end end end
  local r = fish_rand(sum, 7)
  for _, f in ipairs(L) do
    if r < f.w then return f end
    r = r - f.w
  end
  return L[1]
end
function end_fishing(msg, good)
  FISHING, ui, act, fish_rest = nil, nil, 12, true
  if msg then say(msg) end
  if good then sfx("C5", 1, 0.3, 6) sfx("E5", 1, 0.3, 10) sfx("G5", 1, 0.3, 16) else sfx("C3", 0, 0.2, 8) end
end
function update_fishing()
  local F = FISHING
  F.age = F.age + 1
  if btnp("b") then end_fishing() return end
  if F.phase == "wait" then
    F.t = F.t - 1
    if F.t <= 0 then F.phase, F.t = "bite", 40; sfx("A5", 1, 0.35, 4) end
  elseif F.phase == "bite" then
    F.t = F.t - 1
    if btnp("a") then
      F.f = pick_fish(G.area)
      F.phase, F.dist, F.ten, F.run, F.runt = "reel", 55 + F.f.str * 12, 25, false, 50
      sfx("E4", 3, 0.3, 6)
    elseif F.t <= 0 then end_fishing("Too slow. It took the bait and left.") end
  else
    local f = F.f
    local pr = press("a")
    if btn("a") and pr == 0 then pr = 255 end
    local r = btn("a") and pr / 255 or 0
    F.runt = F.runt - 1
    if F.runt <= 0 then
      F.run = not F.run
      F.runt = F.run and (25 + fish_rand(30 + f.str * 25, 3)) or (45 + fish_rand(60, 5))
      if F.run then sfx("C4", 3, 0.3, 8, -1, 0, 300) end
    end
    if F.run then
      F.dist = F.dist + 0.16 * f.str - r * 0.12
      F.ten = F.ten + r * (1.5 + 0.5 * f.str) - 0.5
    else
      F.dist = F.dist - r * 0.7
      F.ten = F.ten + r * 0.3 - 0.8
    end
    if r == 0 then F.ten = F.ten - 1 end
    F.ten = math.max(0, F.ten)
    F.reel = r
    if r > 0 and F.age % 6 == 0 then sfx(F.run and "E3" or "A3", 3, 0.12, 2) end
    if F.ten >= 100 then end_fishing("Snap! The line broke. Ease off when the fish runs.")
    elseif F.dist >= 130 then end_fishing("It swam too far and slipped the hook.")
    elseif F.dist <= 0 then
      if give(f.key, 1) then
        local new = not G.fishn[f.key]
        G.fishn[f.key] = 1
        G.caught = G.caught + 1
        float("+1 " .. f.name, 27)
        end_fishing(new and tr("A %s! A new kind: %d of %d caught.", tr(f.name), fish_kinds(), #FISH) or tr("You land a %s.", tr(f.name)), true)
        persist()
      else end_fishing() end
    end
  end
end
function fish_kinds() local n = 0 for k in pairs(G.fishn) do n = n + 1 end return n end
function draw_fish(x, y, f, flip)         -- about 14 x 8, x,y the middle
  local d = flip and -1 or 1
  for i = -5, 4 do
    local h = i < -3 and 1 or i > 2 and 2 or 3
    line(x + i * d, y - h, x + i * d, y + h, f.col)
    pset(x + i * d, y + h, f.belly)
  end
  line(x + 5 * d, y - 1, x + 5 * d, y + 1, f.col)
  line(x + 6 * d, y - 3, x + 6 * d, y + 3, f.col) line(x + 7 * d, y - 4, x + 7 * d, y + 4, f.col)
  pset(x - 3 * d, y - 1, 1)
  line(x - 1 * d, y - 4, x + 1 * d, y - 4, f.col)
end
function draw_fishing()
  local F = FISHING
  if not F then return end
  panel(40, 150, 240, 70, F.phase == "reel" and "On the line" or "Fishing")
  if F.phase == "wait" then
    text("Wait for the bite" .. string.rep(".", F.age // 20 % 4), 52, 172, 13)
    text("B: pull in", 52, 200, 11)
  elseif F.phase == "bite" then
    text("A bite! Press A!", 52, 172, t() % 8 < 4 and 27 or 26, 2)
  else
    -- the water between you and the fish
    rectfill(52, 168, 216, 14, 20) rect(52, 168, 216, 14, 1)
    local fx = 56 + clamp(F.dist, 0, 130) * 200 // 130
    line(54, 175, fx, 175, F.ten > 75 and 26 or 13)
    draw_fish(fx + 4, 175, F.f, false)
    if F.run and t() % 6 < 3 then pset(fx + 12, 171, 13) pset(fx + 14, 178, 13) end
    rectfill(52, 164, 3, 22, 8)
    -- how tight the line is
    text("line", 52, 190, 12)
    rectfill(90, 190, 130, 8, 7) rectfill(90, 190, clamp(F.ten, 0, 100) * 130 // 100, 8, F.ten > 75 and 26 or F.ten > 45 and 27 or 17)
    rect(90, 190, 130, 8, 1)
    text(F.run and "It runs! Ease off" or "Reel! Hold A", 52, 204, F.run and 26 or 17)
  end
end

-- ---------------------------------------------------------------- your hands (A) and the bucket (B)
function swing(kind) act, act_kind = 14, kind end

function use_hands()
  if visiting then visit_hands() return end
  local x, y = facing()
  local a = G.area
  if a == 3 then mine_hands(x, y) return end
  local o, oi = forage_at(a, x, y)
  if not o then o, oi = forage_at(a, fl(px / C), fl((py - 4) / C)) end
  if o then
    if give(o.k, 1) then
      table.remove(FORAGE, oi)
      G.picked = G.picked + 1
      float("+1 " .. tr(FOUND_BY[o.k].name))
      sfx("G5", 1, 0.25, 5)
      swing("pick")
    end
    return
  end
  local ch = tile(a, x, y)
  if near_tractor() then mount() return end
  if ch == "Z" then
    if G.silo_b == 0 then
      if G.mill < #MILL then say("Footings for a silo. The builders will not start before the mill turns again.")
      else ui, ui_kind = "build", "silo" end
    else ui = "silo" end
    return
  end
  if ch == "V" and G.trac == 0 then ui, ui_kind = "build", "trac" return end
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
  if ch == "c" then
    if next(G.post) then
      local got = deliver_post()
      say(got > 0 and "You take the neighbours' gifts out of the crate." or "Gifts from the neighbours wait here. Your bag is full.")
    else sell_all() end
    return
  end
  if ch == "W" or ch == "N" then ui, ui_sel, ui_scroll = "shop", 1, 0 return end
  if ch == "m" then ui, ui_sel = "mill", 1 return end
  if ch == "X" then
    if next(NEAR) then ui, ui_sel = "near", 1
    else say("The north road leads to the neighbours' farms. No other farm is in reach just now.") end
    return
  end
  if ch == "M" then mine_door() return end
  if ch == "S" then
    if G.pine == 1 then return end
    if G.axe == 0 then say("A fallen pine blocks the path down to the shore. An axe would clear it.") return end
    G.pine = 1
    give("wood", 4)
    swing("chop")
    say("You chop through the fallen pine. The path to Gull Shore is open!")
    sfx("A2", 3, 0.3, 6) sfx("C5", 1, 0.3, 8) sfx("G5", 1, 0.3, 14)
    persist()
    return
  end
  if a >= 4 and ROCKS[ch] then quarry_hands(a, x, y, ch) return end
  if ch == "o" then say("A standing stone, older than the valley. It hums a little.") return end
  if ch == "t" then
    local n = a
    if G.tins:sub(n, n) == "1" then say("An empty tin box.") return end
    G.tins = G.tins:sub(1, n - 1) .. "1" .. G.tins:sub(n + 1)
    local T = TIN[a]
    if T then
      G.coins = G.coins + T.coins
      G.inv[T.k] = have(T.k) + T.n
      say(tr("A rusty tin box! Inside: %d coins and %d %s.", T.coins, T.n, low(tr(FOUND_BY[T.k].name))))
    else
      G.coins = G.coins + 40
      G.seeds[2] = G.seeds[2] + 6
      say("A rusty tin box! Inside: 40 coins and 6 barley seeds.")
    end
    sfx("C5", 1, 0.3, 6) sfx("G5", 1, 0.3, 12)
    persist()
    return
  end
  if ch == "~" then
    if G.rod == 1 then start_fishing(x, y)
    else say(tr("Water. B fills your %s. With a rod from Marrow you could fish here.", low(tr(CAN[G.can].name)))) end
    return
  end
  if ch == "T" then say("A tall pine.") return end
  if ch == "P" then say("A palm, bent by the wind.") return end
  if ch == "D" then say("A drowned tree, long dead.") return end
  if ch == "K" then say("A cactus. Mind the spines.") return end
  if ch == "A" then say("Old bones, bleached by the sun.") return end
  if ch == "U" then say("A boulder.") return end
  if a ~= 1 then return end
  local f, p = cell(x, y)
  if not f then return end
  if not G.plots[p] then say(tr("%s is not yours yet. Marrow sells the deed.", tr(PLOTS[p].name))) return end
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
    if not in_season(G.sel) then say(tr("%s does not grow in %s.", tr(CROPS[G.sel].name), low(tr(SEASON[season()])))) return end
    G.seeds[G.sel] = G.seeds[G.sel] - 1
    f.c, f.age = G.sel, 0
    swing("plant")
    sfx("E4", 1, 0.2, 4)
  elseif ripe(f) then
    local c = CROPS[f.c]
    if give(c.key, 1) then
      G.grown = G.grown + 1
      float("+1 " .. tr(c.name))
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
    say(tr("Your %s is empty. Fill it at the pond.", low(tr(CAN[G.can].name))))
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
    if ripe(f) then say(tr("%s: ready to pick.", tr(c.name)))
    elseif not in_season(f.c) then say(tr("%s: waiting for %s.", tr(c.name), low(tr(SEASON[c.seasons[1]]))))
    else
      local left = c.days - f.age
      say(tr((left == 1 and "%s: %d more day" or "%s: %d more days") .. (f.wet and "." or ". It needs water."), tr(c.name), left))
    end
  elseif f and G.plots[p] and f.k == 4 then say(f.wet and "Dug soil, watered." or "Dug soil. A plants a seed.")
  elseif G.area == 1 and animal_at(x, y) then
    local an = G.an[animal_at(x, y)]
    say(tr(an.k == "h" and "%s the hen. %d of 10 hearts." or "%s the goat. %d of 10 hearts.", animal_name(an), hearts(an)) .. (an.p == 0 and tr(" Wants a pat.") or ""))
  elseif tile(G.area, x, y) == "r" then say("The trough holds " .. G.feed .. " helpings. Each animal eats one a night.")
  elseif forage_at(G.area, x, y) then say(tr("%s. A picks it up.", tr(FOUND_BY[forage_at(G.area, x, y).k].name)))
  else say(tr("%s, %s %d of year %d.", tr(AREAS[G.area].name), low(tr(SEASON[season()])), day_of(), year())) end
end

-- ---------------------------------------------------------------- Marrow's wagon
function shop_items()
  local L = {}
  for i, c in ipairs(CROPS) do
    if in_season(i) then
      L[#L + 1] = { name = tr("%s seed", tr(c.name)), cost = c.seed, own = G.seeds[i],
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
  once("Axe", 150, "Splits the old stumps on your land, and fallen trees.", G.axe == 0, function() G.axe = 1 end)
  once("Fishing rod", 150, "A at any water casts the line. Every water has its own fish.", G.rod == 0, function() G.rod = 1 end)
  once("Waterskin", 120, "Lets you cross into the Dry Reach, east of Gull Shore.", G.skin == 0, function() G.skin = 1 end)
  for i, it in ipairs(IMPL) do
    once(it.name, it.cost, it.about, G.trac == 1 and G.imp[i] == 0, function() G.imp[i] = 1; if G.impsel == 0 then G.impsel = i end; if it.key == "tank" then G.tank = TANK end end)
  end
  once("Clockwork driver", 2500, "Drives the tractor along a route you teach it, and unloads at the silo.", G.silo_b == 1 and G.trac == 1 and G.auto == 0, function() G.auto = 1 end)
  once("Lantern", 180, "Lights more of the mine around you.", G.mine == 1 and G.lamp == 0, function() G.lamp = 1 end)
  once("Hen", 120, "Lays an egg a day when fed. Pet her for bigger eggs.", G.coop == 1 and herd("h") < 4, function() add_animal("h") end)
  once("Goat", 350, "Gives milk every day when fed. Loved goats give creamy milk.", G.shed == 1 and herd("g") < 2, function() add_animal("g") end)
  once("Milk pail", 50, "You can't milk a goat into your hat.", G.shed == 1 and G.pail == 0, function() G.pail = 1 end)
  for p = 2, #PLOTS do
    once(tr("Deed: %s", tr(PLOTS[p].name)), PLOTS[p].cost, PLOTS[p].w * PLOTS[p].h .. " cells of wild land to clear.",
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
      if it.once then say(tr("Marrow: \\"%s. Look after it.\\"", tr(it.name))) persist() end
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
  update_net()
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
  if ui == "auto" then update_auto() return end
  if ui == "near" then update_near() return end
  if ui == "fish" then update_fishing() return end
  if ui == "gift" then update_gift() return end
  if ui == "fetch" then if btnp("b") then fetch, ui, VG, VF = nil, nil, nil, nil end return end
  if ui == "silo" then
    if btnp("a") then silo_sell() elseif btnp("b") then ui = nil end
    return
  end
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
  if not visiting then
    G.clk = G.clk + 1
    if G.clk >= DAY_FRAMES then
      sleep()
      say("You fell asleep on your feet.")
      return
    end
    update_route()
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
    if riding then
      if mx ~= 0 and my ~= 0 then if dx ~= 0 then my = 0 else mx = 0 end end      -- a tractor drives straight
      sp = TRAC_SPEED
    end
    if not blocked(px + mx * sp, py) then px = px + mx * sp end
    if not blocked(px, py + my * sp) then py = py + my * sp end
    walk = walk + 1
    if walk % 16 == 0 and G.area == 2 then sfx("C2", 3, 0.05, 2) end
  else
    walk = 0
  end
  -- the road west leads to the woods, and back
  local A = AREAS[G.area]
  if riding and px < 12 then px = 12; if toast_t == 0 then say("The tractor stays on the farm. Hop off with Y.") end end
  if visiting and px < 3 then px = 3; if toast_t == 0 then say("The north road leads home.") end
  elseif G.area ~= 3 then try_exit() end
  px, py = clamp(px, 2, AREAS[G.area].w * C - 2), clamp(py, 8, AREAS[G.area].h * C - 1)

  if riding then update_riding() return end
  if btn("a") or btn("b") then hold = hold + 1 else hold = 0 end
  if not btn("a") then fish_rest = nil end
  local again = hold > 0 and hold % 16 == 0
  if btnp("a") or (btn("a") and again) then use_hands()
  elseif btnp("b") or (btn("b") and again) then if visiting then visit_water() else use_water() end
  elseif btnp("y") then
    if G.auto == 1 and near_tractor() then ui, ui_sel = "auto", 1 else look() end
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
  if CROP_BY[k] then draw_crop(CROP_BY[k], 3, x, y, 0) else draw_found(k, x, y) end
end
function draw_found(k, x, y)          -- a 16 x 16 picture of something found: a sprite, or drawn from code
  local f = FOUND_BY[k]
  if f.spr then spr(f.spr, x, y, 2, 2) return end
  local cx, cy, c = x + 8, y + 9, f.col or 13
  if f.icon == "fish" then draw_fish(cx - 1, cy, f, false)
  elseif f.icon == "shell" then
    circfill(cx, cy, 5, 12) circ(cx, cy, 5, 10)
    line(cx - 3, cy - 3, cx + 3, cy + 3, 10) line(cx, cy - 5, cx, cy + 5, 10) line(cx + 3, cy - 3, cx - 3, cy + 3, 10)
    pset(cx - 2, cy - 2, 13)
  elseif f.icon == "leaf" then
    for i = -2, 2 do line(cx + i * 2, cy + 5, cx + i * 3, cy - 4 + math.abs(i), i % 2 == 0 and c or c - 1) end
    pset(cx - 3, cy - 2, 27) pset(cx + 4, cy - 1, 27)
  elseif f.icon == "gem" then
    circfill(cx, cy, 4, c) circ(cx, cy, 4, 1)
    pset(cx - 1, cy - 2, 13) pset(cx - 2, cy - 1, 13)
  elseif f.icon == "berry" then
    line(cx, cy - 6, cx, cy - 2, 16) line(cx, cy - 4, cx + 3, cy - 6, 16)
    circfill(cx - 3, cy + 1, 2, c) circfill(cx + 3, cy + 1, 2, c) circfill(cx, cy + 3, 2, c)
    pset(cx - 4, cy, 13) pset(cx + 2, cy, 13)
  else
    rectfill(cx - 1, cy, 3, 5, 12)
    circfill(cx, cy - 1, 5, c) rectfill(cx - 5, cy, 11, 2, c) pset(cx - 2, cy - 3, 13) pset(cx + 2, cy - 2, 13)
  end
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

-- the tractor, drawn from code so it can rust, puff and bounce. x, y: the middle of its rear axle on the ground
function draw_tractor(x, y, hx, hy, on, rusty, alone, ii)
  local body, dark, tyre = rusty and 8 or 26, rusty and 7 or 24, rusty and 30 or 1
  local bob = (on and t() % 8 < 4) and 1 or 0
  local imp = on and IMPL[ii or G.impsel] or nil
  if hx ~= 0 then
    local s = hx
    if imp then
      rectfill(x - s * 16 - 3, y - 6, 6, 4, 30)
      rectfill(x - s * 19 - 2, y - 3 + (work_t > 0 and 1 or 0), 4, 4, imp.key == "tank" and 21 or imp.key == "reaper" and 27 or 28)
    end
    rectfill(x - 9, y - 15 + bob, 20, 9, body) rect(x - 9, y - 15 + bob, 20, 9, dark)
    rectfill(x + s * 3 - 3, y - 13 + bob, 14 * 1, 3, body)
    rectfill(x + (s > 0 and 4 or -11), y - 13 + bob, 8, 7, body) rect(x + (s > 0 and 4 or -11), y - 13 + bob, 8, 7, dark)
    rectfill(x + s * 9 - 1, y - 20 + bob, 2, 6, 30)
    if on and t() % 12 < 6 then circfill(x + s * 9, y - 23 - t() % 12, 2, 29) end
    circfill(x - s * 5, y - 5, 6, tyre) circfill(x - s * 5, y - 5, 3, rusty and 9 or 27)
    circfill(x + s * 8, y - 3, 4, tyre) circfill(x + s * 8, y - 3, 1, rusty and 9 or 27)
  else
    if imp and hy > 0 then rectfill(x - 22, y - 20, 44, 3, 30) end
    rectfill(x - 12, y - 13, 5, 13, tyre) rectfill(x + 8, y - 13, 5, 13, tyre)
    rectfill(x - 7, y - 17 + bob, 15, 14, body) rect(x - 7, y - 17 + bob, 15, 14, dark)
    if hy > 0 then rectfill(x - 4, y - 8 + bob, 9, 4, 30) pset(x - 5, y - 10 + bob, 27) pset(x + 5, y - 10 + bob, 27)
    else rectfill(x - 5, y - 15 + bob, 11, 4, dark) end
    rectfill(x + 4, y - 22 + bob, 2, 6, 30)
    if on and t() % 12 < 6 then circfill(x + 5, y - 25 - t() % 12, 2, 29) end
    if imp and hy < 0 then
      rectfill(x - 22, y - 2 + (work_t > 0 and 1 or 0), 44, 3, 30)
      for i = -2, 2 do rectfill(x + i * 9 - 1, y + 1, 3, 3, imp.key == "tank" and 21 or imp.key == "reaper" and 27 or 28) end
    end
  end
  if on and alone then
    -- the clockwork driver: a brass box with a turning key
    rectfill(x - 3, y - 21 + bob, 6, 5, 27) rect(x - 3, y - 21 + bob, 6, 5, 9)
    if t() % 20 < 10 then line(x - 2, y - 23 + bob, x + 2, y - 23 + bob, 10) else line(x, y - 25 + bob, x, y - 22 + bob, 10) end
  elseif on then
    local n = hy < 0 and 132 or hx ~= 0 and 136 or 128
    clip(0, 0, 320, y - 14 + bob - camy)
    spr(n, x - 8 - hx * 2, y - 27 + bob, 2, 2, hx < 0)
    clip()
  end
end

function draw_silo(x, y, built)     -- 16 wide, 40 tall when it stands
  if not built then
    rectfill(x + 1, y + 10, 14, 5, 28) rect(x + 1, y + 10, 14, 5, 30) rectfill(x + 4, y + 7, 2, 4, 8) rectfill(x + 10, y + 5, 2, 6, 8)
    return
  end
  for i = 0, 5 do line(x + 7 - i, y - 24 + i, x + 8 + i, y - 24 + i, i % 2 == 0 and 25 or 24) end
  rectfill(x + 1, y - 18, 14, 33, 29) rect(x + 1, y - 18, 14, 33, 30)
  for i = 0, 3 do line(x + 2, y - 12 + i * 8, x + 13, y - 12 + i * 8, 28) end
  rectfill(x + 3, y - 17, 2, 31, 13)
  local n = silo_count()
  if n > 0 then rectfill(x + 11, y + 13 - n * 28 // SILO_MAX, 2, n * 28 // SILO_MAX + 1, 27) end
  rectfill(x + 6, y + 7, 5, 8, 6)
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
  local bio, cur = A.biome, nil
  local function mode(m)             -- the colours of this kind of ground
    if m == cur then return end
    cur = m
    pal()
    if m == "season" then season_pal(false)
    elseif m == "shore" then pal(16, 12) pal(15, 11) pal(17, 13)
    elseif m == "dry" then pal(16, 11) pal(15, 10) pal(17, 12)
    elseif m == "fen" then pal(16, 15) pal(15, 14) pal(17, 16)
    elseif m == "mud" then pal(8, 7) pal(9, 8) pal(7, 6) pal(6, 14)
    elseif m == "bog" then pal(21, 15) pal(22, 16) pal(20, 14) pal(23, 17) pal(19, 14) end
  end
  for y = y0, y1 do
    for x = x0, x1 do
      local ch, n = tile(a, x, y), 32
      local m = "season"
      if ch == ":" or ch == "X" then n = 40
      elseif ch == "p" then n = 72
      elseif ch == "~" or ch == "J" then n = 42 + wf * 2; m = bio == "fen" and "bog" or "plain"
      elseif bio and (ch == "," or ROCKS[ch]) then n = A.ground2; m = bio == "hills" and "plain" or bio == "fen" and "mud" or "season"
      elseif bio and bio ~= "hills" then m = bio
      elseif hash(x, y, a) < 140 then n = 34 end
      mode(m)
      if a == 1 then
        local f, p = cell(x, y)
        if f then
          if not G.plots[p] then n = 46 elseif f.k == 4 then n = f.wet and 38 or 36 else n = 32 end
        end
      end
      spr(n, x * C, y * C, 2, 2)
      if ch == "J" then
        mode("plain")
        rectfill(x * C + 2, y * C, 12, 16, 9) line(x * C + 2, y * C + 5, x * C + 13, y * C + 5, 7) line(x * C + 2, y * C + 11, x * C + 13, y * C + 11, 7)
        rectfill(x * C + 1, y * C + 13, 2, 3, 6) rectfill(x * C + 13, y * C + 13, 2, 3, 6)
      end
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
      elseif ch == "U" then spr(66, sx, sy, 2, 2)
      elseif ROCKS[ch] then spr(ROCKS[ch].spr, sx, sy, 2, 2)
      elseif ch == "D" then pal(14, 6) pal(15, 7) pal(16, 7) pal(17, 8) pal(18, 8) spr(160, sx, sy - 16, 2, 4) pal()
      elseif ch == "P" then
        for i = 0, 17 do rectfill(sx + 7 + i * i // 110, sy + 13 - i, 3, 1, i % 4 == 0 and 7 or 9) end
        local tx, ty, sw = sx + 10, sy - 5, fl(math.sin((t() + x * 20) / 30) * 1.5)
        for i = -2, 2 do
          line(tx, ty, tx + i * 6 + sw, ty - 3 + math.abs(i) * 4, 16) line(tx, ty - 1, tx + i * 6 + sw, ty - 4 + math.abs(i) * 4, 17)
        end
        circfill(tx, ty + 1, 1, 8)
      elseif ch == "K" then
        rectfill(sx + 6, sy - 4, 5, 18, 16) rectfill(sx + 7, sy - 5, 3, 1, 16) line(sx + 7, sy - 3, sx + 7, sy + 12, 17)
        rectfill(sx + 2, sy + 2, 4, 3, 16) rectfill(sx + 2, sy - 2, 3, 5, 16) rectfill(sx + 11, sy + 5, 4, 3, 16) rectfill(sx + 12, sy + 1, 3, 5, 16)
        if (x + y) % 3 == 0 then pset(sx + 8, sy - 6, 25) pset(sx + 3, sy - 3, 25) end
      elseif ch == "A" then
        line(sx + 2, sy + 12, sx + 13, sy + 12, 12) circfill(sx + 3, sy + 10, 2, 13)
        for i = 0, 3 do line(sx + 6 + i * 2, sy + 11, sx + 6 + i * 2, sy + 5 + i % 2, 13) end
      elseif ch == "E" then
        local sw = fl(math.sin((t() + x * 31 + y * 17) / 22) * 1.5)
        for i = 0, 3 do
          line(sx + 3 + i * 3, sy + 14, sx + 3 + i * 3 + sw, sy + 2 + i % 2 * 3, 16)
          rectfill(sx + 2 + i * 3 + sw, sy + i % 2 * 3, 2, 4, i % 2 == 0 and 8 or 7)
        end
      elseif ch == "t" then spr(76, sx, sy, 2, 2)
      elseif ch == "N" then spr(140, sx, sy - 4, 2, 2)
      elseif ch == "M" then draw_mine(sx, sy)
      elseif ch == "S" and G.pine == 1 then
      elseif ch == "S" then rectfill(sx - 6, sy + 5, 28, 6, 8) rect(sx - 6, sy + 5, 28, 6, 6) circfill(sx - 6, sy + 8, 3, 10)
      elseif ch == "X" then rectfill(sx + 2, sy + 6, 12, 3, 9) rectfill(sx + 4, sy + 4, 2, 10, 7) rectfill(sx + 10, sy + 4, 2, 10, 7)
      elseif a == 1 then
        if ch == "h" and x == 7 and y == 3 then draw_hut(sx, sy - 32)
        elseif ch == "c" then draw_crate(sx, sy)
        elseif ch == "Z" then draw_silo(sx, sy, G.silo_b == 1)
        elseif ch == "V" and G.trac == 0 then draw_tractor(sx + 8, sy + 14, 1, 0, false, true)
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
    if rows[y] then for _, o in ipairs(rows[y]) do draw_found(o.k, o.x * C, o.y * C) end end
    if arows[y] then for _, i in ipairs(arows[y]) do draw_animal(i) end end
    if a == 1 and G.trac == 1 and not riding and fl((G.ty - 1) / C) == y then
      if auto_i then draw_tractor(fl(G.tx), fl(G.ty), auto_hx, auto_hy, true, false, true, auto_imp)
      else draw_tractor(fl(G.tx), fl(G.ty), 1, 0, false, false) end
    end
    if a == 1 and next(GUESTS) then
      for id, g in pairs(GUESTS) do if fl((g.y - 1) / C) == y then draw_guest(g, id) end end
    end
    if y == prow then
      if riding then draw_tractor(fl(px), fl(py), dx, dy, true, false) else draw_farmer(fl(px), fl(py)) end
    end
  end
  if FISHING then            -- the float on the water
    local F = FISHING
    local bx, by = F.x * C + 8, F.y * C + 8 + (F.phase == "bite" and 2 or fl(math.sin(F.age / 9) * 1.5))
    line(fl(px) + dx * 6, fl(py) - 14, bx, by, 13)
    circfill(bx, by, 2, 26) pset(bx, by - 2, 13)
    if F.phase ~= "wait" and t() % 8 < 4 then circ(bx, by, 5, 13) end
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
  if G.area == 5 and h > 16 then           -- fireflies over the fen
    for i = 1, 14 do
      if (t() + i * 23) % 90 < 50 then pset((i * 71 + fl(math.sin((t() + i * 40) / 37) * 14)) % 320, 30 + (i * 53 + fl(math.cos((t() + i * 9) / 29) * 10)) % 180, 27) end
    end
  end
  if G.rain and G.area ~= 7 then
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
  s = tr(s)
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
  text(tr(SEASON[season()]) .. " " .. day_of(), 4, 2, 12)
  local h = hour()
  text(string.format("%02d:%02d", fl(h), fl(h % 1 * 6) * 10), 92, 2, h > 20 and 26 or 13)
  if G.rain then text(season() == 4 and "snow" or "rain", 144, 2, 22) end
  if G.area == 2 then text("Woods", 190, 2, 17) end
  if AREAS[G.area].short then text(AREAS[G.area].short, 190, 2, 12) end
  if visiting then text(tr("at %s", who(visiting)), 152, 2, 21)
  elseif G.area == 1 and next(NEAR) and G.coins < 100000 and not G.rain then
    local sum, want = fair_total()
    text("Fair " .. math.min(sum, want) .. "/" .. want, 152, 2, 17)
  end
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
  local n, w = CAN[G.can].n, G.water
  if riding then
    local nm = tr(IMPL[G.impsel] and IMPL[G.impsel].name or "No implement")
    text("L:" .. nm, 2, 229, 27)
    if teaching and t() % 40 < 28 then text("REC " .. route_len(), 140, 229, 26) end
    if G.impsel == 2 then text(tr(c.name):sub(1, 6) .. " x" .. G.seeds[G.sel], 2 + (#nm + 3) * 8, 229, G.seeds[G.sel] > 0 and 13 or 28) end
    n, w = TANK, G.impsel == 3 and G.tank or 0
  else
    text("<L", 2, 229, 28) text(tr(c.name) .. " x" .. G.seeds[G.sel], 22, 229, G.seeds[G.sel] > 0 and (in_season(G.sel) and 13 or 26) or 28)
    text("R>", 22 + (#tr(c.name) + 5) * 8, 229, 28)
  end
  for i = 0, 9 do rectfill(196 + i * 4, 229, 3, 8, i < math.ceil(w / n * 10) and 21 or 30) end
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
  text(tr("Paying extra today: %s", tr(CROPS[G.demand].name)), 28, 36, 17)
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
  local it = L[clamp(ui_sel, 1, #L)]
  for i, l in ipairs(wrap(it.about, 33)) do text(l, 28, 168 + i * 10, 12) end
  text("A: buy   B: leave", 28, 208, 11)
end

function draw_bag()
  panel(20, 18, 280, 204, "Your bag")
  text(tr("%s %d, year %d", tr(SEASON[season()]), day_of(), year()), 28, 36, 12)
  text(tr(CAN[G.can].name) .. ", " .. low(tr(HOE[G.hoe].name)), 28, 48, 12)
  text(tr(G.pick > 0 and "Pickaxe" or "No pickaxe") .. ", " .. tr(G.axe > 0 and "axe" or "no axe"), 28, 58, 12)
  local x, y = 28, 74
  local function row(k, name, n, c)
    draw_icon(k, x, y - 4)
    text(tr(name):sub(1, 10), x + 20, y, c or 13) text("x" .. n, x + 104, y + 8 - 8, 27)
    if x > 164 then return end
    y = y + 16
    if y > 186 then x, y = x + 136, 74 end
  end
  for i, c in ipairs(CROPS) do if have(c.key) > 0 then row(c.key, c.name, have(c.key)) end end
  for i, f in ipairs(FOUND) do if have(f.key) > 0 then row(f.key, f.name, have(f.key), f.mat and 11 or 13) end end
  if x == 28 and y == 74 then text("Nothing yet. Pick, pull and forage.", 28, 74, 28) end
  if G.rod == 1 then text(tr("Fish: %d/%d kinds", fish_kinds(), #FISH), 196, 36, 21) end
  if #G.an > 0 then text(herd("h") .. " hens, " .. herd("g") .. " goats. Trough: " .. G.feed, 28, 196, 17) end
  text(tr("Mill: %s   B: close", MILL[G.mill + 1] and low(tr(MILL[G.mill + 1].name)) or tr("rebuilt")), 28, 208, 11)
end

function draw_mill_ui()
  local M = MILL[G.mill + 1]
  panel(30, 40, 260, 160, "The old windmill")
  if not M then text("It turns again.", 40, 70, 13) return end
  text(tr("Step %d of %d: %s", G.mill + 1, #MILL, tr(M.name)), 40, 60, 13)
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
  panel(30, 50, 260, 140, tr("Mend the %s", low(tr(Bd.name))))
  for i, l in ipairs(wrap(Bd.about, 29)) do text(l, 40, 60 + i * 10, 12) end
  local y, ok = 96, G.coins >= Bd.coins
  text("Coins", 40, y, 12) text(math.min(G.coins, Bd.coins) .. "/" .. Bd.coins, 200, y, ok and 17 or 26)
  for _, f in ipairs(FOUND) do
    local n = Bd.need[f.key]
    if n then
      y = y + 14
      text(tr(f.name), 40, y, 12) text(math.min(have(f.key), n) .. "/" .. n, 200, y, have(f.key) >= n and 17 or 26)
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
  elseif ui == "near" then draw_near()
  elseif ui == "fish" then draw_fishing()
  elseif ui == "gift" then draw_gift()
  elseif ui == "fetch" then
    panel(60, 96, 200, 48, "The north road")
    local got = 0
    for ch = 0, NCH do if fetch and fetch.got[ch] then got = got + 1 end end
    text(tr("Walking over to %s", who(fetch and fetch.id or 0)), 68, 114, 13)
    rectfill(68, 128, 184, 6, 7) rectfill(68, 128, 184 * got // (NCH + 1), 6, 27)
  elseif ui == "auto" then
    local L = auto_items()
    panel(50, 60, 220, 120, "The clockwork driver")
    text(route_len() > 0 and ("Route: " .. route_len() .. " cells") or "It knows no route yet.", 60, 78, 12)
    for i, it in ipairs(L) do
      if i == ui_sel then rectfill(56, 88 + i * 12, 208, 12, 8) end
      text(it, 64, 90 + i * 12, i == ui_sel and 27 or 13)
    end
    if hopper_count() > 0 then text("In its hopper: " .. hopper_count() .. " crops", 60, 152, 12) end
    text("A: choose   B: back", 60, 164, 11)
  elseif ui == "silo" then
    panel(30, 40, 260, 160, "The silo")
    text(silo_count() .. " of " .. SILO_MAX .. " crops", 40, 58, 12)
    local y, total = 74, 0
    for i, c in ipairs(CROPS) do
      local v = G.silo[c.key] or 0
      total = total + v * price(c.key)
      if v > 0 and y < 170 then
        draw_icon(c.key, 40, y - 4) text(c.name, 60, y, 13) text("x" .. v, 160, y, 27) text(tostring(v * price(c.key)), 276 - #tostring(v * price(c.key)) * 8, y, 12)
        y = y + 14
      end
    end
    if total == 0 then text("Empty. A tractor on a route unloads", 40, 78, 28) text("here when it drives past.", 40, 88, 28) end
    text(total > 0 and ("A: sell it all for " .. total .. "   B: back") or "B: back", 40, 184, 11)
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
-- this game's words in other languages (the Bit's language, LANGUAGE in Settings; runtime/bk_lang.lua)
texts{
  de = {
    ["Day length (minutes)"] = "Tageslänge (Minuten)",
    ["Away: minutes per farm day"] = "Weg: Minuten pro Farmtag",
    ["Away: most days that pass"] = "Weg: höchstens vergehende Tage",
    ["Walking speed"] = "Lauftempo",
    ["Spring"] = "Frühling",
    ["Summer"] = "Sommer",
    ["Autumn"] = "Herbst",
    ["Winter"] = "Winter",
    ["Radish"] = "Radieschen",
    ["Barley"] = "Gerste",
    ["Sweet pea"] = "Zuckererbse",
    ["Tomato"] = "Tomate",
    ["Corn"] = "Mais",
    ["Sunmelon"] = "Sonnenmelone",
    ["Pumpkin"] = "Kürbis",
    ["Snowleek"] = "Schneelauch",
    ["Frostcap"] = "Frosthut",
    ["Wild garlic"] = "Bärlauch",
    ["Brambleberry"] = "Brombeere",
    ["Pennybun"] = "Steinpilz",
    ["Pine cone"] = "Kiefernzapfen",
    ["Egg"] = "Ei",
    ["Big egg"] = "Großes Ei",
    ["Goat milk"] = "Ziegenmilch",
    ["Creamy milk"] = "Rahmmilch",
    ["Copper ore"] = "Kupfererz",
    ["Iron ore"] = "Eisenerz",
    ["Glowstone"] = "Glühstein",
    ["Gloom dust"] = "Dämmerstaub",
    ["Millstone"] = "Mühlstein",
    ["Wood"] = "Holz",
    ["Stone"] = "Stein",
    ["Fibre"] = "Faser",
    ["Digging stick"] = "Grabstock",
    ["Hoe"] = "Hacke",
    ["Leaky bucket"] = "Löchriger Eimer",
    ["Watering can"] = "Gießkanne",
    ["Big can"] = "Große Kanne",
    ["Raise the frame"] = "Gerüst aufstellen",
    ["Sew the sails"] = "Segel nähen",
    ["Set the millstone"] = "Mühlstein einsetzen",
    ["Silo"] = "Silo",
    ["Holds 600 crops. A tractor on a route unloads here as it passes."] = "Fasst 600 Ernten. Ein Traktor auf seiner Route lädt hier im Vorbeifahren ab.",
    ["Tractor"] = "Traktor",
    ["Rusted solid, but all there. Iron and copper come from the mine."] = "Festgerostet, aber vollständig. Eisen und Kupfer gibt's in der Mine.",
    ["Hen house"] = "Hühnerstall",
    ["Room for 4 hens. Fed hens lay an egg a day."] = "Platz für 4 Hühner. Satte Hühner legen ein Ei am Tag.",
    ["Goat shed"] = "Ziegenstall",
    ["Room for 2 goats. Milk them by hand."] = "Platz für 2 Ziegen. Gemolken wird von Hand.",
    ["Plough"] = "Pflug",
    ["Turns grass and weeds into dug soil, three cells wide."] = "Macht aus Gras und Unkraut umgegrabene Erde, drei Felder breit.",
    ["Seed drill"] = "Sämaschine",
    ["Sows the seed you picked (R) into dug soil as you drive."] = "Sät beim Fahren das gewählte Saatgut (R) in umgegrabene Erde.",
    ["Water tank"] = "Wassertank",
    ["Waters three cells at once. 90 splashes; fill it at the pond with B."] = "Gießt drei Felder auf einmal. 90 Güsse; am Teich mit B füllen.",
    ["Reaper"] = "Mähwerk",
    ["Picks every ripe crop you drive across."] = "Erntet alles Reife, über das du fährst.",
    ["Tractor speed"] = "Traktortempo",
    ["Friend"] = "Freund",
    ["Bramble Woods"] = "Brombeerwald",
    ["The Old Mine"] = "Die alte Mine",
    ["Home plot"] = "Hausbeet",
    ["East meadow"] = "Ostwiese",
    ["Long acre"] = "Langer Acker",
    ["+# Gloom dust"] = "+# Dämmerstaub",
    ["+# Stone"] = "+# Stein",
    ["+# Wood"] = "+# Holz",
    ["+# Fibre"] = "+# Faser",
    ["A ladder, leading down!"] = "Eine Leiter nach unten!",
    ["The chest is empty. You already carried the millstone home."] = "Die Truhe ist leer. Den Mühlstein hast du schon heimgetragen.",
    ["The old millstone of Windrow! And two glowstones beside it. Take it to the mill."] = "Der alte Mühlstein von Windrow! Und zwei Glühsteine daneben. Bring ihn zur Mühle.",
    ["Solid rock. No pickaxe gets through this."] = "Massiver Fels. Da kommt keine Spitzhacke durch.",
    ["ouch!"] = "autsch!",
    ["Everything went dark. Marrow carried you home. Half your ore is gone."] = "Alles wurde dunkel. Marrow hat dich heimgetragen. Dein halbes Erz ist weg.",
    ["The old mine. Boarded up, and the boards are nailed fast. A pickaxe might pry them off."] = "Die alte Mine. Mit Brettern vernagelt. Eine Spitzhacke könnte sie aufhebeln.",
    ["You pry the boards off with the pickaxe. Cold air blows out of the dark."] = "Du hebelst die Bretter mit der Spitzhacke ab. Kalte Luft weht aus dem Dunkel.",
    ["The engine coughs and catches. Y hops off. Marrow sells implements for it."] = "Der Motor hustet und springt an. Y steigt ab. Marrow verkauft Anbaugeräte dafür.",
    ["The tractor remembers the route: # cells. Press Y beside it to send it round."] = "Der Traktor merkt sich die Route: # Felder. Drück Y neben ihm, um ihn loszuschicken.",
    ["Too short to be a route."] = "Zu kurz für eine Route.",
    ["Drive the route once, working as you go. Y hops off and the tractor remembers it."] = "Fahr die Route einmal ab und arbeite dabei. Y steigt ab, und der Traktor merkt sie sich.",
    ["That is as long a route as the clockwork can hold: # cells."] = "Länger kann sich das Uhrwerk keine Route merken: # Felder.",
    ["The tractor has finished its round."] = "Der Traktor hat seine Runde beendet.",
    ["Teach it a route"] = "Route beibringen",
    ["Stop it"] = "Anhalten",
    ["Send it round now"] = "Jetzt losschicken",
    ["Every morning: %s"] = "Jeden Morgen: %s",
    ["yes"] = "ja",
    ["no"] = "nein",
    ["Forget the route"] = "Route vergessen",
    ["Marrow's cart takes # crops from the silo for # coins."] = "Marrows Karren holt # Ernten aus dem Silo, für # Münzen.",
    ["No implement on the hitch. Marrow sells a plough, a seed drill, a water tank and a reaper."] = "Kein Gerät angehängt. Marrow verkauft Pflug, Sämaschine, Wassertank und Mähwerk.",
    ["The water tank is empty. Drive up to the pond and press B."] = "Der Wassertank ist leer. Fahr zum Teich und drück B.",
    ["The seed drill is empty: no seeds."] = "Die Sämaschine ist leer: kein Saatgut.",
    ["tank full"] = "Tank voll",
    ["%s has milk for you, but you need a pail. Marrow has one."] = "%s hat Milch für dich, aber du brauchst einen Melkeimer. Marrow hat einen.",
    ["%s is content. %d of 10 hearts."] = "%s ist zufrieden. %d von 10 Herzen.",
    ["The trough holds # helpings. Crops and wild food from your bag go in here."] = "Im Trog sind # Portionen. Ernte und Wildes aus deiner Tasche kommen hier rein.",
    ["The trough is full."] = "Der Trog ist voll.",
    ["trough #"] = "Trog #",
    ["The silo stands! Marrow now has a clockwork driver for your tractor."] = "Das Silo steht! Marrow hat jetzt einen Uhrwerk-Fahrer für deinen Traktor.",
    ["It runs! A climbs on, Y hops off. Marrow sells implements for it."] = "Er läuft! A steigt auf, Y steigt ab. Marrow verkauft Anbaugeräte dafür.",
    ["The hen house stands! Marrow can bring you hens."] = "Der Hühnerstall steht! Marrow kann dir Hühner bringen.",
    ["The goat shed stands! Marrow can bring you goats and a pail."] = "Der Ziegenstall steht! Marrow kann dir Ziegen und einen Melkeimer bringen.",
    ["Rebuild the old windmill of Windrow."] = "Bau die alte Windmühle von Windrow wieder auf.",
    ["A: use your hands on what is in front of you. Pull weeds, dig, plant, pick and talk."] = "A: Hand anlegen an das, was vor dir ist. Unkraut ziehen, graben, pflanzen, ernten und reden.",
    ["B: water. Fill up at a pond. L / R: pick seeds. X: your bag. Y: look closer."] = "B: gießen. Am Teich auffüllen. L / R: Saatgut wählen. X: deine Tasche. Y: genauer ansehen.",
    ["Watered crops grow overnight. Sleep in the hut, sell at the crate, shop at the wagon."] = "Gegossenes wächst über Nacht. Schlaf in der Hütte, verkauf an der Kiste, kauf am Wagen.",
    ["Bramble Woods lies west along the road. Bring what the mill needs to the ruin."] = "Der Brombeerwald liegt westlich die Straße entlang. Bring, was die Mühle braucht, zur Ruine.",
    ["The mine in the woods opens with a pickaxe. Break rocks for ore, find the ladder down. A also hits."] = "Die Mine im Wald öffnet sich mit einer Spitzhacke. Brich Felsen für Erz, finde die Leiter nach unten. A schlägt auch zu.",
    ["After the mill: build the silo, buy the clockwork driver, press Y by the tractor and teach it a route."] = "Nach der Mühle: Bau das Silo, kauf den Uhrwerk-Fahrer, drück Y am Traktor und bring ihm eine Route bei.",
    ["The rusted tractor by the Long acre can be mended. On it: hold A to work, L changes implement, Y hops off."] = "Der rostige Traktor am Langen Acker lässt sich reparieren. Darauf: A halten zum Arbeiten, L wechselt das Gerät, Y steigt ab.",
    ["The pasture is south of the fields. Fill the trough from your bag, pet your animals every day."] = "Die Weide liegt südlich der Felder. Füll den Trog aus deiner Tasche und streichle deine Tiere jeden Tag.",
    ["Your bag is full. Sell at the crate by the hut."] = "Deine Tasche ist voll. Verkauf an der Kiste bei der Hütte.",
    ["The crate is for crops and wild food. Your bag is empty."] = "Die Kiste ist für Ernte und Wildes. Deine Tasche ist leer.",
    ["Sold # thing for # coins."] = "# Sache für # Münzen verkauft.",
    ["Sold # things for # coins."] = "# Sachen für # Münzen verkauft.",
    ["Snow is falling: the soil is wet."] = "Es schneit: Der Boden ist nass.",
    ["It is raining: the soil is wet."] = "Es regnet: Der Boden ist nass.",
    ["A clear morning."] = "Ein klarer Morgen.",
    ["Footings for a silo. The builders will not start before the mill turns again."] = "Fundament für ein Silo. Die Bauleute fangen erst an, wenn sich die Mühle wieder dreht.",
    ["The hen house. # of # hens live here."] = "Der Hühnerstall. # von # Hühnern wohnen hier.",
    ["The goat shed. # of # goats live here."] = "Der Ziegenstall. # von # Ziegen wohnen hier.",
    ["The road to Tallow Bridge is washed out. Maybe one day."] = "Die Straße nach Tallow Bridge ist weggespült. Vielleicht eines Tages.",
    ["A fallen pine blocks the path down to the shore."] = "Eine umgestürzte Kiefer versperrt den Weg zum Ufer.",
    ["A standing stone, older than the valley. It hums a little."] = "Ein Menhir, älter als das Tal. Er summt ein wenig.",
    ["An empty tin box."] = "Eine leere Blechdose.",
    ["A rusty tin box! Inside: # coins and # barley seeds."] = "Eine rostige Blechdose! Darin: # Münzen und # Gerstensamen.",
    ["Water. Press B to fill your %s."] = "Wasser. Drück B, um deine %s zu füllen.",
    ["A tall pine."] = "Eine hohe Kiefer.",
    ["%s is not yours yet. Marrow sells the deed."] = "%s gehört dir noch nicht. Marrow verkauft die Urkunde.",
    ["A stone, too heavy to move. A pickaxe would break it."] = "Ein Stein, zu schwer zum Bewegen. Eine Spitzhacke würde ihn zerbrechen.",
    ["An old stump. You would need an axe."] = "Ein alter Baumstumpf. Du bräuchtest eine Axt.",
    ["No seeds. Marrow's wagon by the road sells them."] = "Kein Saatgut. Marrows Wagen an der Straße verkauft welches.",
    ["%s does not grow in %s."] = "%s wächst nicht im %s.",
    ["Your %s is empty. Fill it at the pond."] = "Deine %s ist leer. Füll sie am Teich.",
    ["%s: ready to pick."] = "%s: reif zum Ernten.",
    ["%s: waiting for %s."] = "%s: wartet auf den %s.",
    ["Dug soil, watered."] = "Umgegrabene Erde, gegossen.",
    ["Dug soil. A plants a seed."] = "Umgegrabene Erde. A pflanzt einen Samen.",
    ["%s the hen. %d of 10 hearts."] = "%s, das Huhn. %d von 10 Herzen.",
    ["%s the goat. %d of 10 hearts."] = "%s, die Ziege. %d von 10 Herzen.",
    [" Wants a pat."] = " Will gestreichelt werden.",
    ["The trough holds # helpings. Each animal eats one a night."] = "Im Trog sind # Portionen. Jedes Tier frisst eine pro Nacht.",
    ["%s. A picks it up."] = "%s. A hebt es auf.",
    ["%s, %s %d of year %d."] = "%s, %s, Tag %d von Jahr %d.",
    ["%s seed"] = "%s-Samen",
    ["# days. Sells for #."] = "# Tage. Bringt #.",
    ["# days. Sells for #, and keeps bearing."] = "# Tage. Bringt #, und trägt weiter.",
    ["Digs a cell in one go, not three."] = "Gräbt ein Feld in einem Zug, nicht in drei.",
    ["Holds 14 splashes. The bucket holds 5."] = "Fasst 14 Güsse. Der Eimer fasst 5.",
    ["Holds 36 splashes."] = "Fasst 36 Güsse.",
    ["Basket"] = "Korb",
    ["Carry 40 things, not 16."] = "Trag 40 Sachen statt 16.",
    ["Pack"] = "Rucksack",
    ["Carry 100 things."] = "Trag 100 Sachen.",
    ["Pickaxe"] = "Spitzhacke",
    ["Breaks the stones on your land."] = "Zerbricht die Steine auf deinem Land.",
    ["Axe"] = "Axt",
    ["Splits the old stumps on your land."] = "Spaltet die alten Stümpfe auf deinem Land.",
    ["Clockwork driver"] = "Uhrwerk-Fahrer",
    ["Drives the tractor along a route you teach it, and unloads at the silo."] = "Fährt den Traktor auf einer Route, die du ihm beibringst, und lädt am Silo ab.",
    ["Lantern"] = "Laterne",
    ["Lights more of the mine around you."] = "Leuchtet mehr von der Mine um dich aus.",
    ["Hen"] = "Huhn",
    ["Lays an egg a day when fed. Pet her for bigger eggs."] = "Legt satt ein Ei am Tag. Streichle es für größere Eier.",
    ["Goat"] = "Ziege",
    ["Gives milk every day when fed. Loved goats give creamy milk."] = "Gibt satt jeden Tag Milch. Geliebte Ziegen geben Rahmmilch.",
    ["Milk pail"] = "Melkeimer",
    ["You can't milk a goat into your hat."] = "In deinen Hut kannst du keine Ziege melken.",
    ["Deed: %s"] = "Urkunde: %s",
    ["# cells of wild land to clear."] = "# Felder wildes Land zum Roden.",
    ['Marrow: "%s. Look after it."'] = 'Marrow: "%s. Pass gut darauf auf."',
    ["You hand over # crop for the builders."] = "Du gibst # Ernte an die Bauleute.",
    ["You hand over # crops for the builders."] = "Du gibst # Ernten an die Bauleute.",
    ["The sails of Windrow turn again!"] = "Die Flügel von Windrow drehen sich wieder!",
    ["The frame stands! Next: the sails."] = "Das Gerüst steht! Als Nächstes: die Segel.",
    ["The sails are up! Grain now sells for double. Next: the millstone."] = "Die Segel hängen! Getreide bringt jetzt das Doppelte. Als Nächstes: der Mühlstein.",
    ["You fell asleep on your feet."] = "Du bist im Stehen eingeschlafen.",
    ["The tractor stays on the farm. Hop off with Y."] = "Der Traktor bleibt auf der Farm. Mit Y absteigen.",
    ["Pick what is ripe (A) and sell it at the crate."] = "Ernte Reifes (A) und verkauf es an der Kiste.",
    ["Sell what you carry at the crate by the hut."] = "Verkauf, was du trägst, an der Kiste bei der Hütte.",
    ["Dig a cell on your plot: press A three times."] = "Grab ein Feld auf deinem Beet: dreimal A.",
    ["Stand at dug soil: A plants a seed."] = "Vor umgegrabener Erde: A pflanzt einen Samen.",
    ["B waters. Wet crops grow overnight."] = "B gießt. Nasses wächst über Nacht.",
    ["Fill the bucket at the pond: face it, press B."] = "Füll den Eimer am Teich: hinschauen, B drücken.",
    ["Buy seeds from Marrow's wagon on the road."] = "Kauf Saatgut an Marrows Wagen an der Straße.",
    ["Forage in the woods: follow the road west."] = "Sammle im Wald: folge der Straße nach Westen.",
    ["All done? Sleep in the hut (A at the door)."] = "Alles erledigt? Schlaf in der Hütte (A an der Tür).",
    ["Pull weeds (A) to clear more of your plot."] = "Zieh Unkraut (A), um mehr Beet freizumachen.",
    ["Woods"] = "Wald",
    ["Mine #"] = "Mine #",
    ["No implement"] = "Kein Gerät",
    ["REC #"] = "AUFN #",
    ["bag #/#"] = "Sack #/#",
    ["Marrow's wagon"] = "Marrows Wagen",
    ["# coins"] = "# Münzen",
    ["Paying extra today: %s"] = "Heute extra gefragt: %s",
    ["more below"] = "mehr unten",
    ["more above"] = "mehr oben",
    ["A: buy   B: leave"] = "A: kaufen   B: gehen",
    ["Your bag"] = "Deine Tasche",
    ["%s %d, year %d"] = "%s %d, Jahr %d",
    ["No pickaxe"] = "Keine Spitzhacke",
    ["no axe"] = "keine Axt",
    ["Nothing yet. Pick, pull and forage."] = "Noch nichts. Ernten und sammeln!",
    ["# hens, # goats. Trough: #"] = "# Hühner, # Ziegen. Trog: #",
    ["Mill: %s   B: close"] = "Mühle: %s   B: zu",
    ["rebuilt"] = "wieder aufgebaut",
    ["The old windmill"] = "Die alte Windmühle",
    ["It turns again."] = "Sie dreht sich wieder.",
    ["Step %d of %d: %s"] = "Schritt %d von %d: %s",
    ["Coins"] = "Münzen",
    ["Crops for the builders"] = "Ernte für die Bauleute",
    ["B: back"] = "B: zurück",
    ["A: hand over crops   B: back"] = "A: Ernte abgeben   B: zurück",
    ["A: build it!   B: back"] = "A: bauen!   B: zurück",
    ["The millstone is lost somewhere"] = "Der Mühlstein liegt irgendwo",
    ["at the bottom of the old mine."] = "ganz unten in der alten Mine.",
    ["Wood: stumps and sticks."] = "Holz: Stümpfe und Stöcke.",
    ["Stone: stones and pebbles."] = "Stein: Steine und Kiesel.",
    ["Mend the %s"] = "%s reparieren",
    ["While you were away"] = "Während du weg warst",
    ["# min went by."] = "# Min vergingen.",
    ["# h # min went by."] = "# Std # Min vergingen.",
    ["# day passed on the farm."] = "# Tag verging auf der Farm.",
    ["# days passed on the farm."] = "# Tage vergingen auf der Farm.",
    ["It rained on # of them."] = "An # davon hat es geregnet.",
    ["No rain fell."] = "Es fiel kein Regen.",
    ["Your watered crops grew."] = "Deine gegossene Ernte ist gewachsen.",
    ["Nothing grew: dry soil."] = "Nichts wuchs: trockener Boden.",
    ["# crop is ready to pick."] = "# Ernte ist reif.",
    ["# crops are ready to pick."] = "# Ernten sind reif.",
    ["A: good morning"] = "A: guten Morgen",
    ["The clockwork driver"] = "Der Uhrwerk-Fahrer",
    ["Route: # cells"] = "Route: # Felder",
    ["It knows no route yet."] = "Er kennt noch keine Route.",
    ["In its hopper: # crops"] = "Im Behälter: # Ernten",
    ["A: choose   B: back"] = "A: wählen   B: zurück",
    ["The silo"] = "Das Silo",
    ["Empty. A tractor on a route unloads"] = "Leer. Ein Traktor auf seiner Route",
    ["here when it drives past."] = "lädt hier im Vorbeifahren ab.",
    ["# of # crops"] = "# von # Ernten",
    ["A: sell it all for #   B: back"] = "A: alles für # verkaufen   B: zurück",
    ["The old mine"] = "Die alte Mine",
    ["The winch still works."] = "Die Winde geht noch.",
    ["Floor #"] = "Ebene #",
    ["A: go down   B: back"] = "A: runter   B: zurück",
    ["The hut"] = "Die Hütte",
    ["Sleep until morning?"] = "Bis zum Morgen schlafen?",
    ["A: sleep   B: not yet"] = "A: schlafen   B: noch nicht",
    ["%s: %d more day."] = "%s: noch %d Tag.",
    ["%s: %d more days."] = "%s: noch %d Tage.",
    ["%s: %d more day. It needs water."] = "%s: noch %d Tag. Braucht Wasser.",
    ["%s: %d more days. It needs water."] = "%s: noch %d Tage. Braucht Wasser.",
    ["axe"] = "Axt",
    ["snow"] = "Schnee",
    ["rain"] = "Regen",
    ["Bit #"] = "Bit #",
    ["This is %s's farm. B waters their crops, the crate takes gifts, the north road leads home."] = "Das ist die Farm von %s. B gießt ihre Ernte, die Kiste nimmt Geschenke, die Nordstraße führt heim.",
    ["%s's farm. B waters their crops, the crate takes gifts, the north road leads home."] = "Farm von %s. B gießt ihre Ernte, die Kiste nimmt Geschenke, die Nordstraße führt heim.",
    ["Home again."] = "Wieder daheim.",
    ["The valley fair! The farms filled the basket together: # coins each, and every field is watered."] = "Das Talfest! Die Farmen haben den Korb zusammen gefüllt: # Münzen für jeden, und jedes Feld ist gegossen.",
    ["%s has come to visit your farm."] = "%s besucht deine Farm.",
    ["%s is watering your crops."] = "%s gießt deine Ernte.",
    ["%s left you a gift: %s."] = "%s hat dir ein Geschenk dagelassen: %s.",
    [" Just what you wished for!"] = " Genau, was du dir gewünscht hast!",
    ["It was %s's wish for today! The valley pays you %d coins."] = "Das war heute der Wunsch von %s! Das Tal zahlt dir %d Münzen.",
    ["You lost the way. The neighbour's farm is out of reach."] = "Du hast dich verlaufen. Die Farm nebenan ist außer Reichweite.",
    ["You lost sight of the neighbour's farm and walked home."] = "Du hast die Farm nebenan aus den Augen verloren und bist heimgelaufen.",
    ["Your gift did not arrive. It is back in your bag."] = "Dein Geschenk kam nicht an. Es ist wieder in deiner Tasche.",
    ["The north road"] = "Die Nordstraße",
    ["Fair basket: # of # crops reaped"] = "Festkorb: # von # Ernten eingebracht",
    ["%s's farm"] = "Farm von %s",
    ["Wishes for: %s"] = "Wünscht sich: %s",
    ["Wish granted today"] = "Wunsch heute erfüllt",
    ["mill #/#"] = "Mühle #/#",
    ["A: walk over   B: back"] = "A: hinlaufen   B: zurück",
    ["A gift for %s"] = "Ein Geschenk für %s",
    ["Their wish today: %s"] = "Heutiger Wunsch: %s",
    ["No wish left today."] = "Heute kein Wunsch mehr.",
    ["Your bag is empty."] = "Deine Tasche ist leer.",
    ["On its way..."] = "Unterwegs...",
    ["A: give one   B: back"] = "A: eins geben   B: zurück",
    ["Other Bits in reach are neighbours: the north road leads to their farms. Water for them, leave gifts."] = "Andere Bits in Reichweite sind Nachbarn: Die Nordstraße führt zu ihren Farmen. Gieß für sie, lass Geschenke da.",
    ["You take the neighbours' gifts out of the crate."] = "Du nimmst die Geschenke der Nachbarn aus der Kiste.",
    ["Gifts from the neighbours wait here. Your bag is full."] = "Hier warten Geschenke der Nachbarn. Deine Tasche ist voll.",
    ["The north road leads to the neighbours' farms. No other farm is in reach just now."] = "Die Nordstraße führt zu den Farmen der Nachbarn. Gerade ist keine andere Farm in Reichweite.",
    ["The north road leads home."] = "Die Nordstraße führt heim.",
    ["at %s"] = "bei %s",
    ["Fair #/#"] = "Fest #/#",
    ["Walking over to %s"] = "Unterwegs zu %s",
    ["Whelk shell"] = "Wellhornschnecke",
    ["Sea lettuce"] = "Meersalat",
    ["Pearl"] = "Perle",
    ["Bogberry"] = "Moosbeere",
    ["Marsh cap"] = "Sumpfhut",
    ["Hill thyme"] = "Bergthymian",
    ["Flint"] = "Feuerstein",
    ["Dates"] = "Datteln",
    ["Prickle fig"] = "Kaktusfeige",
    ["Amber"] = "Bernstein",
    ["Gull Shore"] = "Möwenstrand",
    ["Shore"] = "Strand",
    ["Sedge Fen"] = "Seggenmoor",
    ["Fen"] = "Moor",
    ["Flint Hills"] = "Feuersteinhügel",
    ["Hills"] = "Hügel",
    ["The Dry Reach"] = "Die Dürre Weite",
    ["Desert"] = "Wüste",
    ["The Dry Reach lies that way. Without a waterskin the sun turns you back."] = "Da liegt die Dürre Weite. Ohne Wasserschlauch treibt dich die Sonne zurück.",
    ["Minnow"] = "Elritze",
    ["Mirror carp"] = "Spiegelkarpfen",
    ["Bramble perch"] = "Brombeerbarsch",
    ["Brook trout"] = "Bachforelle",
    ["Sardine"] = "Sardine",
    ["Mackerel"] = "Makrele",
    ["Sand dab"] = "Kliesche",
    ["Lantern ray"] = "Laternenrochen",
    ["Fen eel"] = "Moor-Aal",
    ["Whisker cat"] = "Bartwels",
    ["Bog pike"] = "Moorhecht",
    ["Stone loach"] = "Bachschmerle",
    ["Tarn char"] = "Bergsaibling",
    ["Oasis perch"] = "Oasenbarsch",
    ["Golden koi"] = "Goldkoi",
    ["The valley is wide: the fen west of the woods, hills beyond it, the shore south (bring an axe), a desert east of that."] = "Das Tal ist weit: das Moor westlich vom Wald, dahinter Hügel, im Süden der Strand (nimm eine Axt mit), östlich davon eine Wüste.",
    ["Fishing: A at water with a rod. Strike on the bite, reel while the fish rests, ease off when it runs."] = "Angeln: A am Wasser mit einer Angel. Beim Biss anschlagen, einholen, wenn der Fisch ruht, nachlassen, wenn er zieht.",
    ["You found %s!"] = "Du hast %s gefunden!",
    ["Solid rock. A pickaxe would break it."] = "Massiver Fels. Eine Spitzhacke würde ihn brechen.",
    ["Your bag is full. No room for a fish."] = "Deine Tasche ist voll. Kein Platz für einen Fisch.",
    ["Too slow. It took the bait and left."] = "Zu langsam. Er hat den Köder genommen und ist weg.",
    ["Snap! The line broke. Ease off when the fish runs."] = "Schnapp! Die Schnur ist gerissen. Lass nach, wenn der Fisch zieht.",
    ["It swam too far and slipped the hook."] = "Er ist zu weit geschwommen und vom Haken.",
    ["A %s! A new kind: %d of %d caught."] = "%s! Eine neue Art: %d von %d gefangen.",
    ["You land a %s."] = "Du fängst: %s.",
    ["On the line"] = "An der Angel",
    ["Fishing"] = "Angeln",
    ["Wait for the bite"] = "Warte auf den Biss",
    ["B: pull in"] = "B: einholen",
    ["A bite! Press A!"] = "Ein Biss! Drück A!",
    ["It runs! Ease off"] = "Er zieht! Nachlassen",
    ["Reel! Hold A"] = "Einholen! A halten",
    ["A fallen pine blocks the path down to the shore. An axe would clear it."] = "Eine umgestürzte Kiefer versperrt den Weg zum Strand. Eine Axt würde ihn freimachen.",
    ["You chop through the fallen pine. The path to Gull Shore is open!"] = "Du hackst dich durch die Kiefer. Der Weg zum Möwenstrand ist frei!",
    ["A rusty tin box! Inside: %d coins and %d %s."] = "Eine rostige Blechdose! Darin: %d Münzen und %d %s.",
    ["Water. B fills your %s. With a rod from Marrow you could fish here."] = "Wasser. B füllt deine %s. Mit einer Angel von Marrow könntest du hier fischen.",
    ["A palm, bent by the wind."] = "Eine Palme, vom Wind gebeugt.",
    ["A drowned tree, long dead."] = "Ein ertrunkener Baum, längst tot.",
    ["A cactus. Mind the spines."] = "Ein Kaktus. Vorsicht, Stacheln.",
    ["Old bones, bleached by the sun."] = "Alte Knochen, von der Sonne gebleicht.",
    ["A boulder."] = "Ein Findling.",
    ["Splits the old stumps on your land, and fallen trees."] = "Spaltet die alten Stümpfe auf deinem Land, und umgestürzte Bäume.",
    ["Fishing rod"] = "Angel",
    ["A at any water casts the line. Every water has its own fish."] = "A an jedem Wasser wirft die Angel aus. Jedes Wasser hat seine eigenen Fische.",
    ["Waterskin"] = "Wasserschlauch",
    ["Lets you cross into the Dry Reach, east of Gull Shore."] = "Damit kommst du in die Dürre Weite, östlich vom Möwenstrand.",
    ["Fish: %d/%d kinds"] = "Fische: %d/%d Arten",
  },
}
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
