/* Demo cart "Sprout Hop": original art and code. MIT License. */
(function () {
  const code = `-- Sprout Hop: a tiny BitKit demo
-- Move: d-pad / left stick    Jump: A (hold for higher)
-- Run: squeeze R (analog!)    Throw a pebble: B
-- Everything that moves is an entity (see the Entities tab), including you.
-- Stay next to a sapling until it grows into a tree: that's your new checkpoint.
-- Water drops heal you, mud and sticky seeds slow you down.
-- Reach the red flag to go to the next level (levels are made on the Map tab).
-- Cutscenes (Cutscenes tab) play when a level starts, when you walk into a trigger zone, or from code.
-- Levels (title screen or pause menu) replays any level you have reached and shows its stats,
-- which are kept with save(). Replays can skip the cutscenes.
-- Two players: pick 2 under Players. Each player's sprout reads its own controller.

-- the title screen (game{title_draw = ...}): a sunny meadow scrolls by while a sprout hops along,
-- picks up water drops and grows each sapling it passes into a tree
function draw_title(t)
  cls(22)
  rectfill(0, 0, 320, 34, 21)
  rectfill(0, 34, 320, 16, 22)
  local sx, sy = 40, 112                                     -- the sun and its turning rays
  for k = 0, 11 do
    local a = t / 240 + k * math.pi / 6
    line(sx + math.cos(a) * 19, sy + math.sin(a) * 19, sx + math.cos(a) * 27, sy + math.sin(a) * 27, 27)
  end
  circfill(sx, sy, 15, 27) circfill(sx - 4, sy - 4, 6, 12)
  for i = 0, 3 do                                             -- clouds
    local cx = (i * 113 - t // 4) % 440 - 60
    local cy = 92 + (i * 29) % 40
    circfill(cx, cy, 9, 13) circfill(cx + 11, cy - 3, 11, 13) circfill(cx + 24, cy + 1, 8, 13) rectfill(cx, cy + 2, 26, 7, 13)
  end
  for x = 0, 319, 2 do                                        -- far and near hills
    local u = x + t * 0.25
    local h1 = 150 + math.sin(u / 40) * 10 + math.sin(u / 17) * 4
    rectfill(x, h1, 2, 240 - h1, 15)
    local v = x + t * 0.6
    local h2 = 172 + math.sin(v / 55 + 2) * 9
    rectfill(x, h2, 2, 240 - h2, 16)
  end
  local o = t % 16                                            -- the ground scrolls under the sprout
  for x = -16, 320, 16 do
    spr(16, x - o, 200, 1, 1, false, false, 2)
    spr(17, x - o, 216, 1, 1, false, false, 2)
    spr(17, x - o, 232, 1, 1, false, false, 2)
  end
  local PX = 58
  for i = 0, 5 do                                             -- flowers
    local fx = (i * 83 + 40 - t) % 500 - 20
    spr(19 + i % 2, fx, 184, 1, 1, false, false, 2)
  end
  for i = 0, 1 do                                             -- saplings grow into trees as the sprout passes
    local tx = (i * 250 + 300 - t) % 500 - 20
    local n = tx > PX + 40 and 40 or (tx > PX - 10 and 42 or 44)
    spr(n, tx, 168, 2, 2, false, false, 2)
  end
  local ph = (t % 44) / 44                                    -- the sprout hops
  local hy = 176 - math.sin(ph * math.pi) * 34
  local w = 10 - (176 - hy) // 6
  rectfill(PX + 12 - w, 199, w * 2, 2, 15)
  spr(hy > 170 and 2 or 1, PX, hy, 1, 1, false, false, 3)
  for i = 0, 4 do                                             -- water drops, picked up when the sprout gets there
    local dx = (i * 97 + 150 - t * 1) % 480 - 20
    local dy = 150 + (i * 23) % 26 + math.sin(t / 12 + i) * 3
    if dx > PX + 20 or dx < PX - 40 then spr(3, dx, dy, 1, 1, false, false, 2)
    elseif dx > PX - 30 then text("+1", PX + 6, hy - 12 - (PX + 20 - dx) // 2, 13) end
  end
end

function _init()
  score, total, defeated = 0, #ents_all("drop"), 0
  spawn_x, spawn_y = PLAYER.x, PLAYER.y
  banner, banner_t = LEVELS[LEVEL].name, 120
  mode, clear_t = "play", 0
  load_records()
  new_run(LEVEL)
  if skip_cutscenes() then cutscene_skip() end    -- level 1's intro is already playing

  -- title screen, pause menu (Start), settings and Continue: the game shell (see GAME_RULES.md)
  game{
    title = "Sprout Hop",
    title_draw = draw_title,          -- its own animated title screen (above)
    look = { title = 18, shadow = 14, panel = 14, edge = 17, hi = 15, text = 12, pick = 27, goal = 18, footer = 18, menu = "right" },
    goal = "Hop through Sunny Meadow and Mossy Cave and reach the red flag.",
    help = {
      "D-pad or stick: move. A: jump (hold for higher). Squeeze R to run. B: throw a pebble.",
      "Stand by a sapling until it grows into a tree: that's your checkpoint.",
      "Water drops heal you, mud and sticky seeds slow you down.",
      "Levels replays any level you have reached and shows your best time, drops, deaths and more.",
    },
    continue = function(cp)       -- carry on from the last checkpoint
      if not cp then return end
      resume = cp
      if cp.level == LEVEL then place_at(cp) else level(cp.level) end
    end,
    menu = {{"Levels", function() open_levels(false) end}},
    pause = {
      {"Back to checkpoint", function() respawn(PLAYER) end},
      {"Level select", function() open_levels(true) end},
    },
  }

  -- a new level loaded (an Exit flag uses the "Go to level" step)
  on("level", function(n, name)
    spawn_x, spawn_y = PLAYER.x, PLAYER.y
    if picked then                 -- started from the Levels screen: a fresh run of just this level
      picked = nil
      score, total, defeated, won = 0, #ents_all("drop"), 0, false
      for _, p in ipairs(ents_players()) do p.hp = stat(p, "hp") end
    else
      total = total + #ents_all("drop")
    end
    banner, banner_t = name, 120
    new_run(n)
    if resume then place_at(resume) end
    save_checkpoint()
  end)
  on("clear", function() finish_run() end)     -- the exit flag sends "clear" before it changes level
  on("win", function()
    finish_run()
    if not won then
      won = true; sfx("C6", 4, 0.4, 30); cutscene("ending")
      game_win("You reached the flag with " .. score .. "/" .. total .. " water drops.")
    end
  end)
  -- replaying a level you have cleared: skip its cutscenes if the Levels screen says so
  on("cutscene", function() if skip_cutscenes() then cutscene_skip() end end)

  -- events sent by entities (their behavior trees use "Send event")
  on("pickup", function() score = score + 1; run.drops = run.drops + 1 end)
  on("death", function(e)
    defeated = defeated + 1; sfx("G5", 3, 0.4, 6)
    if e.team == "enemy" and not e.proj then add_stat("kills") end
  end)
  on("open_door", function()
    if not gate_open then gate_open = true; print("the gate opens!") end
  end)
  on("checkpoint", function(sapling)
    spawn_x, spawn_y = sapling.x + 4, sapling.y + 8
    print("checkpoint! you will respawn at the tree")
    save_checkpoint()
  end)

  -- the player is the "sprout" entity
  ents_on("sprout", "hurt", function(p) sfx("A2", 2, 0.6, 14, nil, 0, -300); add_stat("hits") end)
  ents_on("sprout", "death", function(p)
    add_stat("deaths")
    respawn(p)                     -- don't die: respawn at the last checkpoint
    -- with a friend still standing, pop back in next to them instead
    for _, q in ipairs(ents_players()) do
      if q ~= p and q.alive and q.ground then p.x, p.y = q.x, q.y - 12 break end
    end
  end)
end

-- ---- level records: one table per level, kept with save() (the shell keeps the checkpoint next to it)
-- Linked Bits must play the same game, so they keep records for this session only (GAME_RULES.md).
function load_records()
  REC, SKIP = {}, false
  local d = (ME or 0) == 0 and saved() or nil
  if type(d) == "table" and type(d.levels) == "table" then
    REC, SKIP = d.levels, d.skip and true or false
  end
end
function save_records()
  if (ME or 0) == 0 then save({levels = REC, skip = SKIP}) end
  rec_dirty = false
end
function rec(n)
  REC[n] = REC[n] or {plays = 0, clears = 0, deaths = 0, kills = 0, hits = 0}
  return REC[n]
end
function add_stat(k)
  run[k] = run[k] + 1
  local r = rec(run.level)
  r[k] = (r[k] or 0) + 1
  rec_dirty = true
end
function unlocked(n)
  return n == 1 or (ME or 0) > 0 or rec(n).seen or rec(n - 1).clears > 0
end

-- one try at a level, from its start (or from Continue) to its flag
function new_run(n)
  run = {level = n, t = 0, drops = 0, kills = 0, deaths = 0, hits = 0, total = #ents_all("drop"),
         replay = rec(n).clears > 0}
  rec(n).seen = true
  rec_dirty = true
end
function skip_cutscenes() return SKIP and run.replay end

function finish_run()
  if run.done then return end
  run.done = true
  local r = rec(run.level)
  r.clears = r.clears + 1
  r.total = run.total
  local best = not r.time or run.t < r.time
  if best then r.time = run.t end
  r.drops = math.max(r.drops or 0, run.drops)
  r.fewest = math.min(r.fewest or 999, run.deaths)
  save_records()
  clear_t = 300
  clear_lines = {
    LEVELS[run.level].name .. " clear!",
    "time " .. clock_text(run.t) .. (best and "  NEW BEST" or "  best " .. clock_text(r.time)),
    "drops " .. run.drops .. "/" .. run.total .. "  defeated " .. run.kills .. "  deaths " .. run.deaths,
  }
end

function clock_text(f)
  if not f then return "--" end
  local s = f // 6                 -- tenths of a second
  return string.format("%d:%02d.%d", s // 600, (s // 10) % 60, s % 10)
end

-- ---- the Levels screen (a game_screen(): the shell stays out of the way until game_play() or game_title())
function open_levels(from_pause)
  if rec_dirty then save_records() end
  mode, levels_from_pause = "levels", from_pause
  sel = LEVEL
  game_screen()
end
function close_levels()
  mode = "play"
  if levels_from_pause then game_play() else game_title() end
end
function start_level(n)
  mode, picked = "play", n
  cutscenes_reset()                -- its intro plays again (unless you skip cutscenes)
  level(n)
  game_play()
end
function levels_update()
  local rows = #LEVELS + 1         -- the levels, then the skip-cutscenes switch
  if anyp("up") then sel = (sel - 2) % rows + 1; sfx("E5", 0, 0.15, 3) end
  if anyp("down") then sel = sel % rows + 1; sfx("E5", 0, 0.15, 3) end
  if sel == rows then
    if anyp("a") or anyp("left") or anyp("right") then
      SKIP = not SKIP; save_records(); sfx("A5", 0, 0.2, 4)
    end
  elseif anyp("a") then
    if unlocked(sel) then sfx("C5", 4, 0.25, 6); start_level(sel) return end
    sfx("C3", 1, 0.2, 6)
  end
  if anyp("b") then close_levels() end
end

function levels_draw()
  shade(0.75)
  text("LEVELS", 112, 8, 1, 2) text("LEVELS", 111, 7, 27, 2)
  for i, L in ipairs(LEVELS) do
    local y, on, open = 36 + (i - 1) * 26, sel == i, unlocked(i)
    local r = rec(i)
    rectfill(8, y, 148, 22, on and 2 or 1)
    if on then rect(8, y, 148, 22, 27) end
    text(i .. " " .. (open and L.name or "???"), 14, y + 3, open and (on and 27 or 13) or 29)
    local note = not open and "locked" or (r.clears > 0 and ("cleared x" .. r.clears) or "not cleared yet")
    text(note, 14, y + 12, r.clears > 0 and 17 or 29)
    if r.clears > 0 then spr(3, 144, y + 7) end
  end
  -- the picked level's stats
  local n = math.min(sel, #LEVELS)
  local r = rec(n)
  rectfill(162, 36, 150, 158, 1) rect(162, 36, 150, 158, 13)
  if not unlocked(n) then
    text("Locked", 170, 44, 29)
    text("Clear " .. LEVELS[n - 1].name, 170, 60, 13)
    text("to open it.", 170, 70, 13)
  else
    text(LEVELS[n].name, 170, 42, 27)
    local rows = {
      {"Best time", clock_text(r.time)},
      {"Most drops", r.total and ((r.drops or 0) .. "/" .. r.total) or "--"},
      {"Deaths", r.deaths or 0},
      {"Fewest deaths", r.fewest or "--"},
      {"Defeated", r.kills or 0},
      {"Hits taken", r.hits or 0},
      {"Cleared", r.clears .. "x"},
      {"Played", (r.plays or 0) .. "x"},
    }
    for i, row in ipairs(rows) do
      local y, v = 44 + i * 16, tostring(row[2])
      text(row[1], 170, y, 29)
      text(v, 304 - #v * 8, y, 13)
    end
  end
  -- the skip-cutscenes switch
  local on = sel == #LEVELS + 1
  rectfill(8, 200, 304, 16, on and 2 or 1)
  if on then rect(8, 200, 304, 16, 27) end
  text("Skip cutscenes on replays", 16, 204, on and 27 or 13)
  local v = SKIP and "< ON >" or "< OFF >"
  text(v, 304 - #v * 8, 204, SKIP and 17 or 29)
  rectfill(0, 224, 320, 16, 1)
  local help = on and "A or left/right: switch   B: back" or "A: play this level   B: back"
  text(help, 160 - #help * 4, 228, 29)
end

function respawn(p)
  p.alive = true
  p.hp = stat(p, "hp")
  p.x, p.y, p.vx, p.vy = spawn_x, spawn_y, 0, 0
  fx_clear(p)
  p.inv = 60
  sfx("C3", 2, 0.6, 20, nil, 0, -200)
end

-- the title screen's Continue starts here: the level, the spot and the drops collected so far
function save_checkpoint()
  if rec_dirty then save_records() end
  checkpoint({level = LEVEL, x = spawn_x, y = spawn_y, score = score})
end
function place_at(cp)
  resume = nil
  spawn_x, spawn_y, score = cp.x, cp.y, cp.score or score
  for _, p in ipairs(ents_players()) do p.x, p.y, p.vx, p.vy = cp.x, cp.y, 0, 0 end
end

function _update()
  if mode == "levels" then levels_update() return end
  ents_update()
  if not run.counted then run.counted = true; rec(run.level).plays = (rec(run.level).plays or 0) + 1 end
  if not run.done and not cutscene_playing() then run.t = run.t + 1 end
  if rec_dirty and t() % 600 == 0 then save_records() end    -- and every 10 seconds
end

function _draw()
  local cave = LEVEL == 2
  cls(cave and 31 or 21)
  local cx = ents_camera()       -- follow the player
  camera()
  for i = 0, 6 do                -- parallax clouds (or glowing moss in the cave)
    local x = (i * 97 - cx // 3) % 400 - 40
    local y = 20 + (i * 37) % 60
    if cave then
      circfill(x, y + 40, 2, 15) circfill(x + 30, y + 70, 1, 16)
    else
      circfill(x, y, 10, 23) circfill(x + 12, y + 2, 8, 23) circfill(x - 10, y + 3, 7, 23)
    end
  end
  camera(cx, 0)
  map(cx // 8, 0, 41, 30, (cx // 8) * 8, 0)
  ents_draw()
  camera()
  if mode == "levels" then levels_draw() return end
  hud()
  if rec_dirty and GAME.state ~= "play" then save_records() end   -- keep the stats when the game is paused
end

function hearts(p, x)
  for i = 1, stat(p, "hp") do
    spr(i <= p.hp and 23 or 24, x + (i - 1) * 9, 2)
  end
end

function hud()
  rectfill(0, 0, 320, 12, 1)
  local pl = ents_players()
  hearts(PLAYER, 4)
  spr(3, 44, 2)
  text(score .. "/" .. total, 54, 2, 13)
  text("x" .. defeated, 110, 2, 26)
  if fx_has(PLAYER, "slow") then text("SLOW", 150, 2, 22) end
  if #pl > 1 then                -- two players: player 2's hearts on the right
    text("P2", 262, 2, 22)
    hearts(pl[2], 282)
  else
    text("L", 200, 2, 29) bar(210, 3, press("l"))
    text("R", 258, 2, 29) bar(268, 3, press("r"))
  end
  if won then
    text("YOU MADE IT!", 112, 100, 27)
    text(score .. "/" .. total .. " drops", 124, 114, 13)
  elseif score == total and total > 0 then
    text("ALL DROPS! THE GARDEN BLOOMS", 48, 110, 27)
  end
  if clear_t > 0 then             -- the level-clear card: this run's time, drops, enemies and deaths
    if not cutscene_playing() then clear_t = clear_t - 1 end
    rectfill(8, 150, 304, 40, 1) rect(8, 150, 304, 40, 17)
    for i, l in ipairs(clear_lines) do text(l, 160 - #l * 4, 142 + i * 11, i == 1 and 17 or 13) end
  end
  if banner_t > 0 then
    banner_t = banner_t - 1
    rectfill(0, 40, 320, 20, 1)
    text(banner, 160 - #banner * 8, 42, 13, 2)
  end
end

function bar(x, y, v)
  rect(x, y, 44, 6, 29)
  rectfill(x + 1, y + 1, v * 42 // 255, 4, 17)
end
`;

  // Pixel art: one char per pixel, mapped to palette indices.
  const K = { '.': 0, k: 1, g: 16, G: 17, d: 15, y: 18, b: 22, B: 21, w: 13, c: 12, n: 8, N: 7,
              o: 9, O: 10, r: 26, R: 25, Y: 27, s: 29, S: 28, p: 5, P: 4 };
  const ART = {
    1: ['..g..Gg.', '..gGdG..', '....d...', '..kkkk..', '.kcccck.', '.kckkck.', '.kcccck.', '..k..k..'],
    2: ['.g..Gg..', '..gGdG..', '....d...', '..kkkk..', '.kcccck.', '.kckkck.', '.kcccck.', '...kk...'],
    3: ['...B....', '..BB....', '..BbB...', '.BbbwB..', '.BbbbB..', '.BbbbB..', '..BBB...', '........'],
    16: ['gGgGgggG', 'GdGdGGdG', 'dndndndn', 'nNnnNnnn', 'nnnNnnNn', 'NnnnnNnn', 'nnNnnnnN', 'nNnnNnnn'],
    17: ['nnnNnnnn', 'nNnnnnNn', 'nnnnNnnn', 'Nnnnnnnn', 'nnnNnnNn', 'nNnnnnnn', 'nnnnnNnn', 'NnnNnnnN'],
    18: ['OoooNOoo', 'oooONooo', 'NNNNNNNN', 'ooNOoooo', 'oONooooO', 'NNNNNNNN', 'OoooNOoo', 'oooONooo'],
    19: ['........', '..r.r...', '...Y....', '..r.r...', '...g....', '..gg....', '...g.g..', '...gg...'],
    20: ['........', '........', '...p....', '..pYp...', '...p....', '...g....', '..ggg...', '...g....'],
    4: ['........', '......k.', '.....k.k', '..pppp..', '.pPPPPp.', 'pPPPPPPp', 'pppppppp', '........'],
    5: ['........', '.......k', '......k.', '.pppppp.', 'pPPPPPPp', 'pPPPPPPp', 'pppppppp', '........'],
    6: ['.ww.ww..', '.wwwww..', '..YkYk..', '.YkYkYk.', '.YkYkYk.', '..YkYk..', '...k.k..', '........'],
    7: ['........', '.wwwww..', '.YkYkYk.', '.YkYkYk.', '.YkYkYk.', '..YkYk..', '...k.k..', '........'],
    8: ['...SS...', '..SSSS..', '..ckck..', '..cccc..', '.GGGGGG.', 'GGgGGgGG', '.GGGGGG.', '..c..c..'],
    9: ['...SS...', '..SSSS..', '..cccc..', '..cccc..', '.GGGGGG.', 'GGgGGgGG', '.GGGGGG.', '..c..c..'],
    10: ['..rrr...', '.rYYYr..', '.rYkYr..', '.rYYYr..', '..rrr...', '...g....', '.gGg....', '..gg....'],
    11: ['........', '........', '...nn...', '..nNNn..', '..nNNn..', '...nn...', '........', '........'],
    12: ['........', '........', '........', '...rr...', '..rrrr..', '.RrrrrR.', 'SSSSSSSS', 'ssssssss'],
    13: ['........', '........', '........', '........', '........', '.RRRRRR.', 'SSSSSSSS', 'ssssssss'],
    14: ['SSSSSSSS', 's.s.s.s.', 's.s.s.s.', 's.s.s.s.', 'SSSSSSSS', 's.s.s.s.', 's.s.s.s.', 's.s.s.s.'],
    15: ['........', '........', '...ss...', '..sSSs..', '..sSSs..', '...ss...', '........', '........'],
    22: ['........', '........', '........', '........', '........', '..NNNN..', '.NnNNnN.', 'NNNNNNNN'],
    23: ['........', '.rr.rr..', 'rwrrrrr.', 'rrrrrrr.', '.rrrrr..', '..rrr...', '...r....', '........'],
    24: ['........', '.SS.SS..', 'S..S..S.', 'S.....S.', '.S...S..', '..S.S...', '...S....', '........'],
    30: ['.sRRRR..', '.sRrrrR.', '.sRrrRR.', '.sRRRR..', '.s......', '.s......', '.s......', '.s......'],
    46: ['.s......', '.s......', '.s......', '.s......', '.s......', '.s......', 'SSS.....', 'sss.....'],
    21: ['........', '...s....', '..sSs...', '.sSSSs..', 'sSSSSSs.', 'SSSSSSSS', '........', '........'],
  };

  // 16x16 pictures, stored as 2x2 tiles starting at the given tile
  const BIG = {
    40: ['', '', '', '', '', '', '', '.......g', '......gGg', '.....gG.Gg', '.......d', '.......d', '.......d',
         '.....nnNnn', '....nNnnnNn', '...nnnnnnnnn'],
    42: ['', '', '', '', '.......gg', '.....ggGGg', '....gGGgGGg', '.....gGdGg', '.......d', '......dd', '.......d',
         '.......d', '.......d', '.....nnNnn', '....nNnnnNn', '...nnnnnnnnn'],
    44: ['.....gGGGg', '...gGGgGGGGg', '..gGGGGGgGGGg', '.gGgGGGGGGGgGg', '.gGGGGGrGGGGGg', '..gGGgGGGGGgg', '...ggGGGrGGg',
         '.....gGGGg', '.......NN', '.......NN', '......NNN', '.......NN', '.......NN', '.....nnNNn', '....nNnnnNn', '...nnnnnnnnn'],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => { cart.tiles[n * 64 + y * 8 + x] = K[ch] ?? 0; }));
    for (const [n, rows] of Object.entries(BIG))
      rows.forEach((row, y) => [...row.padEnd(16, '.')].slice(0, 16).forEach((ch, x) => {
        const t = +n + (y >> 3) * 16 + (x >> 3);
        cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
      }));
    cart.flags[16] = 1; cart.flags[17] = 1; cart.flags[18] = 1; cart.flags[14] = 1;

    const W = 256, MW = 160;
    const set = (x, y, t) => { if (x >= 0 && x < MW && y >= 0 && y < 30) cart.map[y * W + x] = t; };
    const drops = [];
    const drop = (x, y) => drops.push([x, y]);
    // deterministic little terrain generator
    let s = 7;
    const r = n => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
    let h = 24;
    const heights = [];
    for (let x = 0; x < MW; x++) {
      if (x > 8 && x % 9 === 0) h = Math.max(20, Math.min(26, h + r(5) - 2));
      const gap = x > 12 && x < MW - 6 && (x % 23 === 0 || x % 23 === 1 || x % 37 === 2);
      heights[x] = gap ? -1 : h;
      if (!gap) {
        set(x, h, 16);
        for (let y = h + 1; y < 30; y++) set(x, y, 17);
        const d = r(10);
        if (d === 0) set(x, h - 1, 19); else if (d === 1) set(x, h - 1, 20); else if (d === 2) set(x, h - 1, 21);
      } else if (x % 23 === 0) {
        drop(x, h - 3);
      }
      if (x > 6 && x % 13 === 5) {
        const py = h - 4 - r(3), len = 3 + r(3);
        for (let i = 0; i < len; i++) set(x + i, py, 18);
        drop(x + 1, py - 1);
        if (len > 4) drop(x + 3, py - 1);
      }
    }
    drop(MW - 3, 21);

    // a flat yard with a gate (solid tiles 14) and a pressure button in front of it
    const H = 24;
    const flatten = (x0, x1, hh) => {
      for (let x = x0; x <= x1; x++) {
        for (let y = 0; y < 30; y++) set(x, y, 0);
        set(x, hh, 16);
        for (let y = hh + 1; y < 30; y++) set(x, y, 17);
        heights[x] = hh;
      }
      for (let i = drops.length - 1; i >= 0; i--) if (drops[i][0] >= x0 && drops[i][0] <= x1) drops.splice(i, 1);
    };
    flatten(70, 88, H);
    flatten(38, 44, heights[37] > 0 ? heights[37] : 23);
    for (let y = H - 4; y < H; y++) set(82, y, 14);
    for (let y = H - 9; y < H - 4; y++) set(82, y, 18);
    drop(79, H - 1); drop(80, H - 1);

    // entities
    const N = (t, p, c) => { const n = { t, p: p || {} }; if (c) n.c = c; return n; };
    const A = (name, frames, speed) => ({ name, frames, speed: speed || 8 });
    const base = { sw: 1, sh: 1, grav: true, collide: true, left: false, hp: 1, inset: 0, team: 'enemy', damage: 1, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [{ name: 'speed', value: 1 }, { name: 'jump', value: 1 }] };
    cart.entities = { effects: [
      { name: 'heal', dur: 0, stack: 'refresh', hp: 1, every: 0, tick: 0, tint: -1, mods: [] },
      { name: 'slow', dur: 120, stack: 'refresh', hp: 0, every: 0, tick: 0, tint: 22, mods: [{ stat: 'speed', op: 'mul', value: 0.5 }, { stat: 'jump', op: 'mul', value: 0.8 }] },
    ], types: [
      Object.assign({}, base, { name: 'sprout', player: true, team: 'friend', hp: 3, damage: 0, inset: 1, hurt: 60,
        anims: [A('idle', [1]), A('walk', [1, 2], 6), A('jump', [2])],
        tree: N('all', {}, [
          N('controls', { speed: 1, jump: 4.2, run: 'r', sound: 'C5' }),
          N('sequence', {}, [N('button', { button: 'b', mode: 'pressed' }), N('count_below', { count: 3, type: 'pebble' }),
            N('shoot', { type: 'pebble', speed: 3.5, aim: false }), N('sound', { note: 'A5', wave: 1, vol: 0.3 })])]) }),
      Object.assign({}, base, { name: 'drop', grav: false, collide: false, hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [3])],
        tree: N('sequence', {}, [N('touching', { what: 'player' }), N('apply_touching', { effect: 'heal', what: 'player' }),
          N('emit', { event: 'pickup' }), N('sound', { note: 'E6', wave: 4 }), N('remove')]) }),
      Object.assign({}, base, { name: 'mud', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [22])],
        tree: N('sequence', {}, [N('touching', { what: 'player' }), N('apply_touching', { effect: 'slow', what: 'player' })]) }),
      Object.assign({}, base, { name: 'sapling', sw: 2, sh: 2, hp: 0, team: 'neutral', damage: 0,
        anims: [A('idle', [40]), A('growing', [40, 42], 15), A('grown', [44])],
        tree: N('selector', {}, [
          N('sequence', {}, [N('is', { key: 'state', value: 'grown' }), N('anim', { name: 'grown' })]),
          N('sequence', {}, [N('circle', { what: 'player', radius: 28 }), N('all', {}, [
            N('anim', { name: 'growing' }),
            N('say', { text: 'Protect me!' }),
            N('sequence', {}, [N('every', { frames: 120 }), N('count_below', { count: 7, type: 'bee' }), N('spawn', { type: 'bee', dx: -72, dy: -48 })]),
            N('sequence', {}, [N('every', { frames: 170 }), N('count_below', { count: 7, type: 'bee' }), N('spawn', { type: 'bee', dx: 80, dy: -56 })]),
            N('sequence', {}, [N('count_up', { max: 360, key: 'grow', bar: true }), N('set', { key: 'state', value: 'grown' }),
              N('emit', { event: 'checkpoint' }), N('sound', { note: 'C6', wave: 4 })])])]),
          N('anim', { name: 'idle' })]) }),
      Object.assign({}, base, { name: 'slug', hp: 2, inset: 1, stomp: true, anims: [A('idle', [4]), A('walk', [4, 5], 10)],
        tree: N('selector', {}, [N('patrol', { speed: 0.4 })]) }),
      Object.assign({}, base, { name: 'bee', grav: false, stomp: true, anims: [A('idle', [6, 7], 4)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 80 }), N('chase', { speed: 0.7 })]), N('hover', { height: 10, speed: 0.06 })]) }),
      Object.assign({}, base, { name: 'flower', hp: 3, anims: [A('idle', [10])],
        tree: N('sequence', {}, [N('face_player'), N('ray', { what: 'player', dir: 'player', len: 140 }), N('every', { frames: 100 }), N('shoot', { type: 'seed', speed: 1.4, aim: false })]) }),
      Object.assign({}, base, { name: 'seed', grav: false, inset: 2, damage: 0, touch_fx: 'slow', anims: [A('idle', [11])], tree: null }),
      Object.assign({}, base, { name: 'pebble', grav: false, inset: 2, team: 'friend', anims: [A('idle', [15])], tree: null }),
      Object.assign({}, base, { name: 'sage', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [8, 8, 8, 8, 8, 9], 10)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 40 }), N('face_player'), N('say', { text: 'B throws pebbles!' })]), N('wander', { speed: 0.2, turn: 8 })]) }),
      Object.assign({}, base, { name: 'guide', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [8, 8, 8, 8, 8, 9], 10)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 40 }), N('face_player'), N('say', { text: 'Step on the button' })]), N('stop')]) }),
      Object.assign({}, base, { name: 'button', hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, anims: [A('idle', [12]), A('pressed', [13])],
        tree: N('selector', {}, [N('sequence', {}, [N('touching', { what: 'player' }), N('anim', { name: 'pressed' }), N('emit', { event: 'open_door' })]), N('anim', { name: 'idle' })]) }),
      Object.assign({}, base, { name: 'gate', sh: 4, hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, hidden: true, anims: [A('idle', [14])],
        tree: N('sequence', {}, [N('heard', { event: 'open_door' }), N('set_tile', { dx: 0, dy: 1, tile: 0 }), N('set_tile', { dx: 0, dy: 0, tile: 0 }),
          N('set_tile', { dx: 0, dy: -1, tile: 0 }), N('set_tile', { dx: 0, dy: -2, tile: 0 }), N('sound', { note: 'C4', wave: 1 }), N('remove')]) }),
    ], placed: [] };
    const place = (type, col, up, sh) => {
      const g = heights[col]; if (g === undefined || g < 0) return;
      cart.entities.placed.push({ type, x: col * 8, y: (g - (sh || 1) - (up || 0)) * 8 });
    };
    place('sprout', 3);
    place('sage', 6);
    drops.forEach(([x, y]) => cart.entities.placed.push({ type: 'drop', x: x * 8, y: y * 8 }));
    [30, 100, 134].forEach(c => place('mud', c));
    place('sapling', 40, 0, 2); place('sapling', 86, 0, 2);
    [24, 47, 64, 98, 128, 146].forEach(c => place('slug', c));
    [36, 90, 118, 140].forEach(c => place('bee', c, 7));
    [58, 112].forEach(c => place('flower', c));
    place('guide', 73); place('button', 77); place('gate', 82, 0, 4);
    place('exit', 156, 0, 2);
    place('cut_gate', 66, 0, 4);

    // the exit flag and the goal flag
    const flag = { sh: 2, hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, anims: [A('idle', [30])] };
    cart.entities.types.push(
      Object.assign({}, base, flag, { name: 'exit',
        tree: N('sequence', {}, [N('touching', { what: 'player' }), N('emit', { event: 'clear' }), N('sound', { note: 'C6', wave: 4 }), N('level', { n: 2 })]) }),
      Object.assign({}, base, flag, { name: 'goal',
        tree: N('selector', {}, [N('sequence', {}, [N('touching', { what: 'player' }), N('emit', { event: 'win' })]),
          N('sequence', {}, [N('near', { dist: 48 }), N('say', { text: 'Almost there!' })])]) }),
      // an invisible zone on the map that plays the "gate" cutscene the first time the player walks in
      Object.assign({}, base, { name: 'cut_gate', sh: 4, hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, hidden: true, anims: [A('idle', [])],
        tree: N('sequence', {}, [N('touching', { what: 'player' }), N('cutscene', { name: 'gate', once: true })]) }));

    // cutscenes (Cutscenes tab). level: plays when that level starts (0 = only when triggered)
    const S = (t, p) => ({ t, p });
    cart.entities.cutscenes = [
      { name: 'intro', level: 1, steps: [
        S('wait', { frames: 20 }),
        S('say', { who: 'sage', text: 'Good morning, little sprout! Did you sleep well?' }),
        S('say', { who: 'sprout', text: 'Mm-hm! What is that red thing, far away?' }),
        S('camera', { target: 'exit', frames: 150 }),
        S('say', { who: '', text: 'Far across the meadow, a red flag waves in the wind.' }),
        S('camera', { target: 'player', frames: 90 }),
        S('say', { who: 'sage', text: 'Reach the flag and the garden will bloom. Mind the slugs!' }),
        S('jump', { who: 'sprout', power: 3.5 }),
        S('wait', { frames: 30 }),
      ] },
      { name: 'gate', level: 0, steps: [
        S('camera', { target: 'tile', x: 82, y: 19, frames: 60 }),
        S('say', { who: 'guide', text: 'This gate is shut tight. Step on the button to open it!' }),
        S('camera', { target: 'player', frames: 50 }),
      ] },
      { name: 'cave', level: 2, steps: [
        S('fade', { to: 'black', frames: 0 }),
        S('fade', { to: 'clear', frames: 60 }),
        S('say', { who: 'sprout', text: 'It is so dark in here...' }),
        S('move', { who: 'sage', x: 5, speed: 0.6 }),
        S('say', { who: 'sage', text: 'Follow the glowing moss. The last flag is at the far end!' }),
        S('camera', { target: 'goal', frames: 120 }),
        S('wait', { frames: 40 }),
        S('camera', { target: 'player', frames: 80 }),
      ] },
      { name: 'ending', level: 0, steps: [
        S('wait', { frames: 10 }),
        S('jump', { who: 'sprout', power: 3.5 }),
        S('sound', { note: 'E6', wave: 4 }),
        S('say', { who: '', text: 'You made it! The whole garden is blooming. Thanks for playing Sprout Hop!' }),
      ] },
    ];

    // ---- level 2: a short mossy cave
    const map2 = new Uint16Array(256 * 128), CW = 84;
    const set2 = (x, y, t) => { if (x >= 0 && x < CW && y >= 0 && y < 30) map2[y * W + x] = t; };
    const h2 = [];
    for (let x = 0; x < CW; x++) {
      const hh = x < 10 ? 24 : x < 30 ? 22 + ((x >> 2) % 2) : x < 50 ? 25 : x < 66 ? 21 + ((x >> 3) % 3) : 24;
      const gap = (x >= 44 && x <= 46);
      h2[x] = gap ? -1 : hh;
      for (let y = 0; y < 3 + ((x * 7) % 3 === 0 ? 1 : 0); y++) set2(x, y, 18);      // brick ceiling
      if (!gap) { set2(x, hh, 16); for (let y = hh + 1; y < 30; y++) set2(x, y, 17); if (x % 7 === 3) set2(x, hh - 1, 19); }
    }
    [[14, 18, 4], [36, 19, 5], [52, 20, 4], [60, 16, 3]].forEach(([x, y, len]) => { for (let i = 0; i < len; i++) set2(x + i, y, 18); });
    const placed2 = [];
    const place2 = (type, col, up, sh) => { const g = h2[col]; if (g === undefined || g < 0) return; placed2.push({ type, x: col * 8, y: (g - (sh || 1) - (up || 0)) * 8 }); };
    place2('sprout', 3); place2('sage', 7);
    [[15, 17], [37, 18], [38, 18], [53, 19], [61, 15], [45, 22]].forEach(([x, y]) => placed2.push({ type: 'drop', x: x * 8, y: y * 8 }));
    [20, 33, 56, 70].forEach(c => place2('slug', c));
    [28, 48, 64].forEach(c => place2('bee', c, 6));
    place2('flower', 40); place2('mud', 26);
    place2('sapling', 50, 0, 2);
    place2('goal', 80, 0, 2);
    cart.levels = [
      { name: 'Sunny Meadow', w: MW, h: 30, map: cart.map, placed: cart.entities.placed },
      { name: 'Mossy Cave', w: CW, h: 30, map: map2, placed: placed2 },
    ];
  }

  window.BK_DEMO = { name: 'Sprout Hop', code, buildGfx, about: 'A small platformer with two levels, cutscenes, and a Levels screen with stats for every level.' };
  // the studio's Demo button lists every entry; other demo files add themselves with window.BK_DEMOS.push(...)
  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.unshift(window.BK_DEMO);
})();
