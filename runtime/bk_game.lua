
-- ================================================================ game shell
-- The menus every BitKit game shares (see GAME_RULES.md): a title screen, a pause menu with settings,
-- quick resume from a checkpoint and a "goal complete" screen. A cart turns them on with one call
-- in _init:
--
--   game{
--     title = "Sprout Hop",
--     goal  = "Reach the red flag at the end of Mossy Cave.",
--     help  = {"D-pad: move", "A: jump"},          -- optional "How to play" page
--     continue = function(cp) ... end,             -- put the player back at checkpoint cp (a checkpoint() table)
--     new_game = function() ... end,               -- optional: reset a game that loaded its own save
--     can_continue = function() return ... end,    -- optional: Continue for games that keep their own save
--     pause = {{"Back to checkpoint", function() ... end}},   -- optional extra pause menu items
--     menu = {{"Levels", function() ... end}},     -- optional extra title screen items (after New game)
--     settings = {{key = "laps", name = "Laps", min = 1, max = 5, value = 3},
--                 {key = "ai", name = "Rivals", values = {"Easy", "Normal", "Hard"}, value = 2}},
--     music = true,                                -- adds a Music level for notes played with mus()
--     title_draw = function(t) ... end,            -- optional: the game's own animated title screen art
--     look = {title = 27, panel = 1, edge = 13, ...},   -- optional: the menus' colours and layout
--     players = {1, 4},                            -- how many can play: 1 (the default), 4, or {min, max}
--     race = "time",                               -- one-player games: linked Bits race ("time" or "score")
--   }
--
-- players and race are read by the host from the code before the game runs (the home screen shows the count,
-- and a one-player game never starts in lockstep on linked Bits), so write them as plain numbers and strings.
-- Race: a one-player game with race = "time" or "score" started on linked Bits starts on every Bit at once,
-- each playing its own run (RACE is set: {kind, n, seat, names}). After a 3-2-1 countdown the shell times
-- the run; "time" ranks by who reaches game_win() first, "score" by the highest race_score(n) when the run
-- ends (game_win() or race_end()). The Bits tell each other how they are doing and the shell shows the
-- standings. race_score(n) and race_end() do nothing when not racing.
--
-- Title screen art: without title_draw the title screen is the game's first frame, darkened. With it, the
-- shell calls title_draw(t) every frame on the title screen (and behind Settings / How to play opened from
-- it) instead of the game's _draw, with t counting frames since the title screen opened, and draws the
-- name, goal and menu on top without darkening it. Draw in screen space: the camera and clip are reset.
-- look picks the colours of every menu (title, pause, settings) and where things sit on the title screen:
--   title, shadow    colour of the game's name and of its shadow (shadow = false: none)
--   panel, edge      menu box fill and border (edge = false: no border)
--   text, pick, hi   menu text, the picked item, and the bar behind it
--   goal             colour of the goal line, footer = colour of the hint at the bottom
--   name_y, scale    where the name is drawn and how big (1-4); name_y = false: title_draw draws the name
--   goal_y           where the goal box sits (default under the name)
--   menu             "center", "left" or "right": where the title menu sits
--   menu_y           top of the title menu (default: just above the footer)
--
--   checkpoint(t)   remember where to carry on (a table save() can store); checkpoint(nil) forgets it
--   game_win(text)  the goal is reached: shows the "goal complete" screen (after any cutscene ends)
--   setting(key)    a value from the Settings screen (volume and music are 0..10)
--   game_play()     skip the menus and go straight to gameplay
--   game_screen()   hand the whole screen to the game's own menu (a level select, a garage): _update and
--                   _draw run, but it isn't gameplay yet, so Continue still works. Leave with game_play()
--                   or game_title()
--   game_title()    back to the title screen
--   GAME.state      "title", "play", "screen", "pause", "settings", "help", "confirm" or "won"
--   GAME.items      the names in the menu on screen
--
-- Save file: the first play makes one. From then on the title screen shows Continue instead of New game,
-- and Settings has Delete save (it asks first), which wipes the progress and brings New game back.
--
-- Start opens the pause menu (Start+Select still goes to the Bit's home screen). Volume scales every
-- sfx() and tone(). The settings and the checkpoint are kept in the cart's save, next to (not inside)
-- whatever the cart stores with save(), so save() and saved() work exactly as before.
do
  local CFG = nil                  -- the table given to game{}
  local KIT = { vol = 10, music = 10, set = {} }   -- kept in the save: settings, checkpoint, won
  local ST, BACK = "off", "title"  -- menu state, and where B goes back to
  local SEL, ITEMS = 1, {}
  local DIRTY = false              -- gameplay has run since the cart loaded
  local TRIAL = false              -- started from an editor (GAME_BOOT 3): a test run doesn't make a save
  local CART_UPDATE, CART_DRAW = nil, nil
  local START_DOWN, COMBO = false, false
  local WIN_TEXT, WIN_PENDING = nil, false
  local CONFIRM = nil
  local TT = 0                     -- frames since the title screen opened (title_draw's t)
  local LOOK = {}                  -- the menus' colours and layout (game{look = ...})
  local function lk(k, d) local v = LOOK[k] if v == nil then return d end return v end
  local raw_save, raw_saved, raw_sfx, raw_tone = save, saved, sfx, tone
  local raw_shade = shade           -- a cart may define its own shade() (Beacon Keeper does): menus use the built-in one

  GAME = { state = "off", won = false, items = {} }

  -- linked: lockstep with other Bits, or racing them (a race run is a fresh run that never touches the save)
  local function linked() return (ME or 0) > 0 or type(RACE) == "table" end
  local function players() return math.max(1, math.min(PLAYERS or 1, 8)) end
  local function any_btnp(b)
    for p = 1, players() do if btnp(b, p) then return true end end
    return false
  end

  -- ------------------------------------------------ linked race (RACE is set by the host)
  local R = nil                    -- the race: {kind, n, seat, cd, t, score, done, val, res = {[seat] = {done, v, at}}}
  local RACE_CD = 180              -- frames of 3-2-1 before the run starts
  local function race_name(seat)
    local nm = type(RACE) == "table" and type(RACE.names) == "table" and RACE.names[seat] or nil
    if type(nm) ~= "string" or nm == "" then nm = "Bit " .. seat end
    return string.upper(string.sub(nm, 1, 10))
  end
  local function race_fmt(v)
    if R and R.kind == "score" then return tostring(math.floor(v)) end
    local s = math.max(0, v) / 60
    return string.format("%d:%04.1f", math.floor(s / 60), s % 60)
  end
  local function nth(n)
    local k = n % 100
    local suf = (k >= 11 and k <= 13) and "th" or ({ "st", "nd", "rd" })[n % 10] or "th"
    return n .. suf
  end
  local function race_send()
    local v = R.done and R.val or (R.kind == "score" and R.score or R.t)
    R.res[R.seat] = { done = R.done, v = v, at = R.f }
    net_send(-7701, R.seat, R.done and 1 or 0, v)
    R.sent = R.f
  end
  -- (bk_entities.lua's net pump hands these over: another Bit's progress)
  function _bk_race_heard(from, seat, done, v)
    if not R or math.type(seat) ~= "integer" or seat == R.seat or seat < 1 or seat > R.n then return end
    local e = R.res[seat]
    local was = e and e.done
    R.res[seat] = { done = done == 1, v = v or 0, at = R.f }
    if done == 1 and not was then R.news = race_name(seat) .. " FINISHED  " .. race_fmt(v or 0); R.newst = 180 end
  end
  local function race_init()
    if type(RACE) ~= "table" then return end
    R = { kind = RACE.kind == "score" and "score" or "time", n = math.max(1, math.min(math.floor(tonumber(RACE.n) or 1), 32)),
          seat = math.floor(tonumber(RACE.seat) or 1), cd = RACE_CD, t = 0, score = 0, done = false, val = 0,
          res = {}, f = 0, sent = -999, news = nil, newst = 0 }
    GAME.race = R                  -- (for tests and curious games: read it, don't change it)
  end
  local function race_tick()       -- every frame: in play and in the menus (the clock doesn't stop for a pause)
    if not R then return end
    R.f = R.f + 1
    if _bk_net_pump then _bk_net_pump() end
    if R.cd > 0 then R.cd = R.cd - 1 elseif not R.done then R.t = R.t + 1 end
    if R.newst > 0 then R.newst = R.newst - 1 end
    if R.f - R.sent >= (R.done and 30 or 20) then race_send() end
  end
  local function race_finish()
    if not R or R.done then return end
    R.done = true
    R.val = R.kind == "score" and R.score or R.t
    race_send()
  end
  -- the standings: finished runs first (fastest, or highest score), then the ones still going
  local function race_rows()
    local rows = {}
    for s = 1, R.n do
      local e = R.res[s]
      local done = (e and e.done) and true or false
      rows[#rows + 1] = { seat = s, done = done, v = e and e.v or 0, heard = e ~= nil,
        gone = (not done) and ((e and R.f - e.at > 240) or (not e and R.f > 300)) or false }
    end
    table.sort(rows, function(a, b)
      if a.done ~= b.done then return a.done end
      if a.v ~= b.v and (a.done or R.kind == "score") then
        if R.kind == "score" then return a.v > b.v end
        return a.v < b.v
      end
      return a.seat < b.seat
    end)
    return rows
  end
  function race_score(n) if R and not R.done then R.score = math.floor(tonumber(n) or 0) end end

  -- ------------------------------------------------ save: {_g = shell data, _c = the cart's own value}
  local function unwrap(d)
    if type(d) == "table" and d._bitkit_game then return d._c, d._g end
    return d, nil
  end
  local function cart_value() return (unwrap(raw_saved())) end
  local function persist()
    if not CFG then return end
    raw_save({ _bitkit_game = 1, _g = KIT, _c = cart_value() })
  end
  function save(v)
    if not CFG then return raw_save(v) end
    return raw_save({ _bitkit_game = 1, _g = KIT, _c = v })
  end
  function saved() return (unwrap(raw_saved())) end

  -- ------------------------------------------------ audio levels
  local function vol() return CFG and KIT.vol / 10 or 1 end
  function sfx(n, w, v, ...) return raw_sfx(n, w, (v or 0.8) * vol(), ...) end
  function tone(hz, w, v, ...) return raw_tone(hz, w, (v or 0.8) * vol(), ...) end
  -- mus(): sfx() for music, so the Music level turns it down separately
  function mus(n, w, v, ...) return raw_sfx(n, w, (v or 0.8) * vol() * (CFG and KIT.music / 10 or 1), ...) end

  function setting(key)
    if key == "volume" then return KIT.vol end
    if key == "music" then return KIT.music end
    return KIT.set[key]
  end

  local function set_state(s)
    if s == "title" and ST ~= "title" and ST ~= "settings" and ST ~= "help" and ST ~= "confirm" then TT = 0 end
    ST, GAME.state = s, s
    SEL = 1
  end

  -- the title screen, or Settings / How to play / a confirm opened from it: title_draw paints behind these
  local function on_title()
    if ST == "title" then return true end
    return (ST == "settings" or ST == "help" or ST == "confirm") and BACK == "title"
  end
  local function title_art() return CFG and CFG.title_draw and on_title() end

  -- ------------------------------------------------ the save file
  -- A game has a save file once it has been played (or holds a checkpoint, a win, or can_continue() says so).
  -- From then on the title screen offers Continue instead of New game; Delete save in Settings wipes it.
  local function has_save()
    if linked() then return false end
    if KIT.started or KIT.cp ~= nil or KIT.won then return true end
    return CFG.can_continue and CFG.can_continue() and true or false
  end

  -- ------------------------------------------------ menus
  local function can_resume()      -- there is somewhere to carry on from, not just a save file
    if DIRTY then return true end
    if KIT.cp ~= nil and not linked() then return true end
    return CFG.can_continue and CFG.can_continue() and true or false
  end

  local function play()
    DIRTY = true
    if not KIT.started and not TRIAL and not linked() then KIT.started = true; persist() end
    set_state("play")
  end

  local function start_new()
    KIT.cp = nil
    persist()
    if CFG.new_game then CFG.new_game() play()
    elseif DIRTY then _restart(2)               -- the host loads the cart again, straight into play
    else play() end
  end

  local function continue_game()
    -- with a save file but no checkpoint (played, but never reached one) the game starts from its beginning
    if can_resume() and not DIRTY and CFG.continue then CFG.continue(not linked() and KIT.cp or nil) end
    play()
  end

  -- Delete save: forget the checkpoint, the win and the cart's own save(), keep volume and settings
  local function delete_save()
    local had = DIRTY or cart_value() ~= nil
    KIT.cp, KIT.won, KIT.started = nil, false, nil
    GAME.won = false
    raw_save({ _bitkit_game = 1, _g = KIT, _c = nil })
    set_state("title")
    if had then _restart(1) end    -- the game in memory still has the old progress: the host loads it again
  end

  local function confirm(text, yes, fn)
    CONFIRM = { text = text, fn = fn, from = ST }
    set_state("confirm")
    ITEMS = { { yes, fn }, { "Cancel", function() set_state(CONFIRM.from) end } }
    GAME.items = { yes, "Cancel" }
    SEL = 2
  end

  local function build()
    ITEMS = {}
    GAME.items = {}
    local add = function(name, fn) ITEMS[#ITEMS + 1] = { name, fn }; GAME.items[#ITEMS] = name end
    if ST == "title" then
      BACK = "title"
      if DIRTY or has_save() then add("Continue", continue_game)
      else add("New game", start_new) end           -- no save file yet: the first play makes one
      for _, it in ipairs(CFG.menu or {}) do add(it[1], it[2]) end
      add("Settings", function() BACK = "title"; set_state("settings") end)
      if CFG.help then add("How to play", function() BACK = "title"; set_state("help") end) end
    elseif ST == "pause" then
      BACK = "pause"
      add("Resume", function() set_state("play") end)
      for _, it in ipairs(CFG.pause or {}) do add(it[1], function() set_state("play"); it[2]() end) end
      add("Settings", function() set_state("settings") end)
      if CFG.help then add("How to play", function() set_state("help") end) end
      if R then add("Leave race", function() home() end)
      elseif not linked() then add("Quit to title", function() set_state("title") end) end
    elseif ST == "won" then
      add("Keep playing", function() set_state("play") end)
      if R then add("Leave race", function() home() end)
      elseif not linked() then add("Back to title", function() set_state("title") end) end
    elseif ST == "settings" then
      add("Volume", nil)
      if CFG.music then add("Music", nil) end
      for _, s in ipairs(CFG.settings or {}) do add(s.name or s.key, nil) end
      if has_save() then
        add("Delete save", function()
          confirm("Delete your save? Your progress in this game is gone for good.", "Delete save", delete_save)
        end)
      end
      add("Back", function() set_state(BACK) end)
    elseif ST == "help" then
      add("Back", function() set_state(BACK) end)
    end
  end

  -- the setting behind settings row i, as {get, set, min, max, label}
  local function setting_row(i)
    if i == 1 then return { key = "vol", min = 0, max = 10, kit = true } end
    local n = i - 1
    if CFG.music then
      if n == 1 then return { key = "music", min = 0, max = 10, kit = true } end
      n = n - 1
    end
    local s = (CFG.settings or {})[n]
    if not s then return nil end
    return { key = s.key, min = s.values and 1 or (s.min or 0), max = s.values and #s.values or (s.max or 10), values = s.values }
  end
  local function row_value(r) if r.kit then return KIT[r.key] end return KIT.set[r.key] end

  local function menu_update()
    if ST ~= "confirm" then build() end
    if #ITEMS == 0 then return end
    if SEL > #ITEMS then SEL = #ITEMS end
    if any_btnp("up") then SEL = (SEL - 2) % #ITEMS + 1; raw_sfx("E5", 0, 0.15 * vol(), 3) end
    if any_btnp("down") then SEL = SEL % #ITEMS + 1; raw_sfx("E5", 0, 0.15 * vol(), 3) end
    if ST == "settings" then
      local r = setting_row(SEL)
      if r then
        local d = (any_btnp("right") and 1 or 0) - (any_btnp("left") and 1 or 0)
        if d ~= 0 then
          local v = math.max(r.min, math.min(r.max, (row_value(r) or r.min) + d))
          if r.kit then KIT[r.key] = v else KIT.set[r.key] = v end
          persist()
          raw_sfx("A5", 0, 0.2 * vol(), 4)
        end
      end
    end
    local it = ITEMS[SEL]
    if any_btnp("a") and it and it[2] then
      raw_sfx("C5", 4, 0.25 * vol(), 6)
      it[2]()
    elseif any_btnp("b") then
      if ST == "pause" or ST == "won" then set_state("play")
      elseif ST == "settings" or ST == "help" then set_state(BACK)
      elseif ST == "confirm" then set_state(CONFIRM.from) end
    end
  end

  -- ------------------------------------------------ drawing (screen space, over the game and its overlay)
  local function center(s, y, c, sc)
    sc = sc or 1
    text(s, 160 - #s * 4 * sc, y, c, sc)
  end
  local function shadow(s, y, c, sc)
    sc = sc or 1
    local sh = lk("shadow", 1)
    if sh then text(s, 161 - #s * 4 * sc, y + sc, sh, sc) end
    center(s, y, c, sc)
  end
  local function wrap(s, w)
    local lines, line = {}, ""
    for word in tostring(s):gmatch("%S+") do
      if #line + #word + 1 > w and #line > 0 then lines[#lines + 1] = line; line = word
      else line = #line > 0 and (line .. " " .. word) or word end
    end
    if #line > 0 then lines[#lines + 1] = line end
    return lines
  end
  local function dim(dense)      -- darken the game behind a menu (more on the title screen)
    raw_shade(dense and 0.72 or 0.5)
  end
  local function panel(x, y, w, h)
    local f, e = lk("panel", 1), lk("edge", 13)
    if f then rectfill(x, y, w, h, f) end
    if e then rect(x, y, w, h, e) end
  end
  local function bar(x, y, v, mx, on)
    for i = 0, mx - 1 do rectfill(x + i * 7, y, 5, 7, i < v and (on and lk("pick", 27) or lk("text", 13)) or lk("hi", 2)) end
  end

  local function draw_items(y0, w, x)
    x = x or 160 - w // 2
    local TC, PC = lk("text", 13), lk("pick", 27)
    for i, it in ipairs(ITEMS) do
      local y = y0 + (i - 1) * 14
      local on = i == SEL
      if on then rectfill(x + 4, y - 3, w - 8, 13, lk("hi", 2)) end
      local name = it[1]
      if ST == "settings" then
        local r = setting_row(i)
        if r then
          text(name, x + 14, y, on and PC or TC)
          local v = row_value(r) or r.min
          if r.values then
            local s = "< " .. tostring(r.values[v] or v) .. " >"
            text(s, x + w - 14 - #s * 8, y, on and PC or TC)
          elseif r.max <= 10 then bar(x + w - 14 - r.max * 7, y, v - r.min, r.max - r.min, on)
          else local s = "< " .. v .. " >"; text(s, x + w - 14 - #s * 8, y, on and PC or TC) end
        else
          text(name, x + 14, y, on and PC or TC)
        end
      else
        text(name, x + 14, y, on and PC or TC)
      end
      if on then text(">", x + 6, y, PC) end
    end
  end

  local function footer(s)
    local f = lk("panel", 1)
    if f then rectfill(0, 224, 320, 16, f) end
    center(s, 228, lk("footer", 29))
  end

  local function draw_menu()
    if not CFG.title_draw then dim(ST == "title" or ST == "help")
    elseif ST ~= "title" then dim(not on_title() or ST == "help") end   -- the art stays bright on the title itself
    if ST == "title" then
      local t = CFG.title or "BitKit game"
      local ny = lk("name_y", 30)
      local sc = lk("scale", #t <= 12 and 3 or (#t <= 19 and 2 or 1))
      if ny then shadow(t, ny, lk("title", 27), sc) end
      local g = wrap("Goal: " .. (CFG.goal or "?"), 34)
      local gy = lk("goal_y", ny and ny + 8 * sc + 10 or 64)
      panel(16, gy, 288, #g * 10 + 10)
      for i, l in ipairs(g) do center(l, gy + 6 + (i - 1) * 10, lk("goal", lk("text", 13))) end
      local h = #ITEMS * 14 + 10
      local side = lk("menu", "center")
      local mx = side == "left" and 12 or (side == "right" and 148 or 80)
      local my = lk("menu_y", 236 - 22 - h)
      panel(mx, my, 160, h)
      draw_items(my + 8, 160, mx)
      if GAME.won then text("* goal done *", 8, 228, lk("pick", 17)) end
      footer("A: choose")
    elseif ST == "won" and R then
      local rows = race_rows()
      local shown = math.min(#rows, 8)
      local h = shown * 11 + #ITEMS * 14 + 46
      local y = 120 - h // 2
      panel(50, y, 220, h)
      local mine = 1
      for i, r in ipairs(rows) do if r.seat == R.seat then mine = i end end
      local all = true
      for _, r in ipairs(rows) do if not r.done and not r.gone then all = false end end
      shadow(all and (nth(mine) .. " OF " .. R.n .. "!") or "FINISHED!", y + 8, lk("goal", 17), 2)
      for i = 1, shown do
        local r = rows[i]
        local yy = y + 28 + (i - 1) * 11
        local me = r.seat == R.seat
        local c = me and lk("pick", 27) or lk("text", 13)
        text((r.done and (i .. ".") or "-"), 60, yy, c)
        text(race_name(r.seat) .. (me and " (YOU)" or ""), 80, yy, c)
        local v = r.done and race_fmt(r.v) or (r.gone and "left" or (R.kind == "score" and r.heard and (race_fmt(r.v) .. "..") or "racing"))
        text(v, 260 - #v * 8, yy, r.done and c or lk("footer", 29))
      end
      draw_items(y + 34 + shown * 11, 220)
      footer(all and "A: choose" or "waiting for the others...   A: choose")
    elseif ST == "pause" or ST == "won" then
      local h = #ITEMS * 14 + 34
      local extra = 0
      local lines = {}
      if ST == "won" then lines = wrap(WIN_TEXT or "", 30); extra = #lines * 10 end
      local y = 120 - (h + extra) // 2
      panel(70, y, 180, h + extra)
      shadow(ST == "won" and "GOAL COMPLETE!" or "PAUSED", y + 8, ST == "won" and lk("goal", 17) or lk("title", 27), ST == "won" and 1 or 2)
      for i, l in ipairs(lines) do center(l, y + 22 + (i - 1) * 10, lk("text", 13)) end
      draw_items(y + 28 + extra, 180)
      footer("A: choose   B: back to the game")
    elseif ST == "settings" then
      local h = #ITEMS * 14 + 34
      local y = 120 - h // 2
      panel(50, y, 220, h)
      shadow("SETTINGS", y + 8, lk("title", 27), 2)
      draw_items(y + 28, 220)
      footer("left / right: change   B: back")
    elseif ST == "help" then
      local lines = {}
      for _, l in ipairs(CFG.help or {}) do for _, w in ipairs(wrap(l, 34)) do lines[#lines + 1] = w end end
      local g = wrap("Goal: " .. (CFG.goal or "?"), 34)
      local h = (#lines + #g) * 10 + 60
      local y = math.max(4, 120 - h // 2)
      panel(16, y, 288, math.min(h, 232 - y))
      shadow("HOW TO PLAY", y + 8, lk("title", 27), 2)
      for i, l in ipairs(g) do text(l, 24, y + 28 + (i - 1) * 10, lk("goal", 17)) end
      for i, l in ipairs(lines) do text(l, 24, y + 34 + (#g + i - 1) * 10, lk("text", 13)) end
      footer("B: back")
    elseif ST == "confirm" then
      local lines = wrap(CONFIRM.text, 26)
      local h = #lines * 10 + #ITEMS * 14 + 22
      local y = 120 - h // 2
      panel(60, y, 200, h)
      for i, l in ipairs(lines) do center(l, y + 8 + (i - 1) * 10, lk("text", 13)) end
      draw_items(y + 14 + #lines * 10, 200)
    end
  end

  -- ------------------------------------------------ the wrapped _update / _draw / overlay
  local function k_update() end
  local function k_draw() end
  local function adopt()        -- the cart may swap its own _update/_draw later: keep wrapping them
    local u, d = rawget(_G, "_update"), rawget(_G, "_draw")
    if u ~= k_update then CART_UPDATE = u; _G._update = k_update end
    if d ~= k_draw then CART_DRAW = d; _G._draw = k_draw end
  end
  k_update = function()
    race_tick()
    if R and R.cd > 0 and ST == "play" then adopt() return end   -- 3, 2, 1: the run hasn't started yet
    if ST == "screen" then           -- the game's own menu screen: no pause menu, and not gameplay yet
      if CART_UPDATE then CART_UPDATE() end
    elseif ST == "play" then
      if WIN_PENDING and not (cutscene_playing and cutscene_playing()) then
        WIN_PENDING = false; set_state("won")
        adopt()
        return
      end
      -- Start opens the pause menu when it's let go, unless it was part of Start+Select (home screen)
      -- (during a cutscene Start skips it instead)
      local down = false
      for p = 1, players() do if btn("start", p) then down = true end; if btn("select", p) then COMBO = true end end
      if down and cutscene_playing and cutscene_playing() then COMBO = true end
      if down then START_DOWN = true
      elseif START_DOWN then
        START_DOWN = false
        if not COMBO then set_state("pause"); adopt() return end
        COMBO = false
      else COMBO = false end
      DIRTY = true
      if CART_UPDATE then CART_UPDATE() end
    else
      if on_title() then TT = TT + 1 end
      menu_update()
    end
    adopt()
  end
  k_draw = function()
    if title_art() then
      camera() clip()
      CFG.title_draw(TT)
    elseif CART_DRAW then CART_DRAW() end
    adopt()
  end
  local overlay = _bk_overlay
  function _bk_overlay()
    if overlay and not title_art() then overlay() end   -- no cutscene bars or dialog over the title art
    if CFG and ST ~= "play" and ST ~= "screen" then
      if ST ~= "confirm" then build() end
      draw_menu()
    end
    if R and (ST == "play" or ST == "pause") then
      camera() clip()
      if R.cd > 0 or R.t < 45 then
        local s = R.cd > 0 and tostring((R.cd + 59) // 60) or "GO!"
        rectfill(160 - #s * 16 - 10, 88, #s * 32 + 20, 48, lk("panel", 1) or 1)
        shadow(s, 96, lk("title", 27), 4)
        if R.cd > 0 then center("RACE ON " .. R.n .. " BITS", 142, lk("text", 13)) end
      end
      local nd = 0
      for s = 1, R.n do local e = R.res[s] if e and e.done then nd = nd + 1 end end
      local hud = "RACE " .. race_fmt(R.done and R.val or (R.kind == "score" and R.score or R.t)) .. "  " .. nd .. "/" .. R.n .. " IN"
      rectfill(320 - #hud * 8 - 6, 228, #hud * 8 + 6, 12, 1)
      text(hud, 320 - #hud * 8 - 3, 230, R.done and 27 or 13)
      if R.newst > 0 and R.news then
        rectfill(160 - #R.news * 4 - 4, 2, #R.news * 8 + 8, 12, 1)
        center(R.news, 4, 27)
      end
    end
  end

  -- ------------------------------------------------ the cart's calls
  function game(cfg)
    local first = CFG == nil
    CFG = cfg or {}
    LOOK = type(CFG.look) == "table" and CFG.look or {}
    if first then
      local _, g = unwrap(raw_saved())
      if type(g) == "table" then
        KIT.vol = tonumber(g.vol) or 10
        KIT.music = tonumber(g.music) or 10
        if not linked() then           -- linked Bits must start the same: their own saves stay out of the game
          if type(g.set) == "table" then KIT.set = g.set end
          KIT.cp = g.cp
        end
        KIT.won = g.won and true or false
        KIT.started = g.started and true or nil
      end
      GAME.won = KIT.won
      for _, s in ipairs(CFG.settings or {}) do
        if KIT.set[s.key] == nil then KIT.set[s.key] = s.value or (s.values and 1) or s.min or 0 end
      end
      adopt()
      race_init()
      local boot = GAME_BOOT
      GAME_BOOT = nil
      TRIAL = boot == 3
      if boot == 2 then KIT.cp = nil; persist(); play()
      elseif boot then play()
      else set_state("title") end
    end
  end

  -- a score race ends here too (out of lives, out of time): the standings come up like at the goal
  function race_end()
    if not R or R.done or not CFG then return end
    race_finish()
    WIN_PENDING = true
  end
  function game_play() if CFG then play() end end
  function game_screen() if CFG then set_state("screen") end end
  function game_title() if CFG then set_state("title") end end

  function checkpoint(t)
    KIT.cp = t
    persist()
  end

  function game_win(s)
    if not CFG then return end
    race_finish()
    WIN_TEXT = s
    if not KIT.won then KIT.won = true; GAME.won = true; persist() end
    WIN_PENDING = true
  end
end

-- ================================================================ tunables
-- Numbers and switches a game lets you play with. The studio's Game tab finds every tune() in the code and
-- shows it as a slider, a switch or a list, so the feel of a game can be changed without reading its code.
--
--   local SPEED = tune("Kart speed", 2.4, 1, 5)        a slider from 1 to 5 (an optional 5th value is the step)
--   local GHOSTS = tune("Ghost karts", true)            a switch
--   local AI = tune("Rivals", "Normal", {"Easy", "Normal", "Hard"})   a list
--
-- Returns the value picked in the studio, or the default. The picked values travel with the cart (TUNE),
-- so the device plays it the way it was tuned.
TUNE = TUNE or {}
function tune(name, default)
  local v = TUNE[name]
  if v == nil or type(v) ~= type(default) then return default end
  return v
end
