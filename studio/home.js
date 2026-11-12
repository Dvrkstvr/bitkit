/* PocketBit home screen. Runs as a normal cart inside the BitKit runtime.
   The host fills BIT = { games = {{name, file, icon, studio, paused}, ...}, sel, source, studio }
   and draws each game's 16x16 icon into this cart's tiles. A paused game carries on where it was left
   when launched; track(-1, n) is the host's private signal to forget game n's pause and start it over,
   track(-2, n) tells the host game n is selected. With BIT.link the host keeps the linked Bits in map rows 0-1:
   mget(0,0) how many, mget(1,0) which one is this Bit, mget(1+i,0) Bit i's number, mget(1+i,1) 1 home 2 in a game 3 idle.
   A game started here starts on every linked Bit that is on its home screen, as many as it takes: each game entry
   carries pmin/pmax (how many can play, from its game{players = ...}), race ("time"/"score" when a one-player game
   can be raced on linked Bits) and net (net_send games meet in their own lobby). plan() below mirrors the host's
   linkPlan (studio.js) and link_plan (bk_host.c): together in lockstep, a race, or alone. Select flips a game that
   can do both between together and race (track(-3, 1 race / 0 together); BIT.race_pick is the last choice).
   The vote: while two or more linked Bits are on their home screens, A on a game that would start on the others
   (together, a race, or a net game's lobby) votes for it instead of starting it, and B passes. The host counts the
   votes (studio.js "voting", bk_host.c "voting"): a game wins once at least 75% of the Bits that don't pass voted for it,
   then it starts on every Bit. Its rows: mget(1+i,2) Bit i's vote (a game's number in BIT.games, 0 none, 998 a game
   this Bit doesn't have, 999 passes), mget(1+i,3) its name colour, row 4+i its name (a letter a cell),
   mget(0,4) frames until the winner starts (0 = none yet), mget(1,4) the winner, mget(2,4) the wait,
   mget(3,4) votes it takes, mget(4,4) Bits that don't pass, mget(5,4) Bits on their home screens.
   track(-4, n) votes for game n (0 takes the vote back), track(-5, 1 / 0) passes or stops passing.
   Entries with app = true (utilities such as Hexbeat and Loopbox: studio/bitapps.js) are a second row below the games: Down scrolls to it.
   It is drawn with the Bit's theme (studio/themes.js, whose Lua LIB is loaded in front of this cart): BIT.theme is the theme,
   BIT.me = {name, color, bit} the owner's profile from the Settings app.
   MIT License. */
window.BK_HOME = `
local sel, tt, slide = 1, 0, 0
local T = nil                  -- the theme
local GAMES, APPS = {}, {}     -- games and apps, as indexes into BIT.games
local row, asel = 0, 1         -- 0 the games, 1 the utilities (Down / Up)
local aslide, vy = 0, 0        -- the utilities' sideways slide; how far the screen has scrolled down
local ROWH = 200               -- the utilities row sits one screen below the games
local rpick = false            -- Select: race instead of playing together (games that can do both)
-- X (start over) and Y (edit) act only when held for two seconds, so a stray press can't lose a paused game
local HOLD = 120
local hold = { x = 0, y = 0 }
local function held(b, ok)
  if ok and btn(b) then
    hold[b] = hold[b] + 1
    return hold[b] == HOLD           -- once: let go to do it again
  end
  hold[b] = 0
  return false
end

function _init()
  for i, g in ipairs(BIT.games) do if g.app then APPS[#APPS + 1] = i else GAMES[#GAMES + 1] = i end end
  local want = math.max(1, math.min(BIT.sel or 1, #BIT.games))
  for k, i in ipairs(GAMES) do if i == want then sel = k end end
  for k, i in ipairs(APPS) do if i == want then asel = k; row = 1 end end
  if #GAMES == 0 and #APPS > 0 then row = 1 end
  vy = row * ROWH
  rpick = BIT.race_pick and true or false
  T = theme_fix(BIT.theme)
  theme_apply(T)
end

local function ctext(s, y, c, sc)
  sc = sc or 1
  text(s, 160 - #s * 4 * sc, y, c, sc)
end

-- linked Bits: how many are here, and how many would join a game started now
local function linked()
  if not BIT.link then return 0, 0 end
  local n, ready = mget(0, 0), 0
  for i = 1, n do if mget(1 + i, 1) ~= 2 then ready = ready + 1 end end
  return n, ready
end

-- how game g starts now: "together" on n Bits, "race" on n Bits, or "alone" (see the note at the top)
local function plan(g)
  local _, ready = linked()
  if ready < 2 or g.app or g.net or not g.pmax then return "alone", 1 end
  if g.pmax >= 2 and not (g.race and rpick) then return "together", math.min(ready, g.pmax, 8) end
  if g.race then return "race", math.min(ready, 8) end
  return "alone", 1
end
local function both_modes(g) return g.race and (g.pmax or 1) >= 2 end

-- the vote (see the note at the top)
local VOTE_ELSE, VOTE_PASS = 998, 999
local function voting()
  return BIT.link and mget(5, 4) >= 2 and mget(1 + mget(1, 0), 1) == 1
end
local function my_vote() return mget(1 + mget(1, 0), 2) end
local function votable(g) return not g.app and (g.net or plan(g) ~= "alone") end
local function bitname(i)
  local s = ""
  for c = 0, 9 do
    local ch = mget(c, 4 + i)
    if ch < 32 or ch > 126 then break end
    s = s .. string.char(ch)
  end
  if s == "" then s = "BIT " .. mget(1 + i, 0) end
  return string.upper(s)
end
-- the Bits voting for game gi (an index into BIT.games)
local function voters(gi)
  local out = {}
  for i = 1, math.min(mget(0, 0), 40) do
    if mget(1 + i, 1) == 1 and mget(1 + i, 2) == gi then out[#out + 1] = i end
  end
  return out
end

-- "1 player", "1-8 players"
local function plabel(g)
  if not g.pmax then return nil end
  if g.pmax == 1 then return "1 player" end
  return (g.pmin == g.pmax and tostring(g.pmax) or (g.pmin .. "-" .. g.pmax)) .. " players"
end

local function draw_linked()
  local n, ready = linked()
  if n < 2 then return end
  local me = mget(1, 0)
  text("LINKED", 8, 23, TC.dim)
  local x = 58
  for i = 1, math.min(n, 12) do
    local num, st = mget(1 + i, 0), mget(1 + i, 1)
    local s = tostring(num)
    local w = #s * 8 + 6
    rectfill(x, 21, w, 11, i == me and TC.accent or (st == 2 and TC.shade or TC.card))
    if i == me then rect(x - 1, 20, w + 2, 13, TC.text) end
    text(s, x + 3, 23, i == me and TC.card or (st == 2 and TC.dim or TC.text))
    if voting() and st == 1 then   -- under each Bit: a bar when it voted, a dash when it passes
      local v = mget(1 + i, 2)
      if v == VOTE_PASS then rectfill(x + w / 2 - 2, 35, 4, 1, TC.dim)
      elseif v > 0 then rectfill(x, 34, w, 2, TC.accent) end
    end
    x = x + w + 4
  end
  if n > 12 then text("+" .. (n - 12), x, 23, TC.dim) end
  local busy = n - ready
  if busy > 0 then text(busy .. " in a game", 320 - 8 - #(busy .. " in a game") * 8, 23, TC.dim) end
end

local function icon(g, x, y, sc, ghost)
  if ghost then pal(TC.dim) end
  if g.icon then
    spr(g.icon, x, y, 2, 2, false, false, sc)
  else
    rectfill(x, y, 16 * sc, 16 * sc, ghost and TC.dim or g.color)
    if not ghost then
      local ch = string.upper(string.sub(g.name, 1, 1))
      text(ch, x + 8 * sc - 4 * sc, y + 8 * sc - 4 * sc, 13, sc)
    end
  end
  if ghost then pal() end
end

function _update()
  tt = tt + 1
  slide = slide * 0.7
  aslide = aslide * 0.7
  vy = vy + (row * ROWH - vy) * 0.3
  if math.abs(row * ROWH - vy) < 0.5 then vy = row * ROWH end
  if #APPS > 0 then
    if btnp("down") and row == 0 then row = 1; theme_sfx(T, "row"); track(-2, APPS[asel]) end
    if btnp("up") and row == 1 and #GAMES > 0 then row = 0; theme_sfx(T, "row"); track(-2, GAMES[sel]) end
    if #GAMES == 0 then row = 1 end
  end
  if row == 1 then
    local was = asel
    if btnp("right") then asel = asel % #APPS + 1; aslide = 24 end
    if btnp("left") then asel = (asel - 2) % #APPS + 1; aslide = -24 end
    if asel ~= was then theme_sfx(T, "move"); track(-2, APPS[asel]) end
    local i = APPS[asel]
    if asel ~= was then hold.x = 0 end
    if btnp("a") then theme_sfx(T, "open"); launch(i) end
    if held("x", BIT.games[i].paused) then theme_sfx(T, "back"); track(-1, i) end
    held("y", false)
    return
  end
  local n = #GAMES
  if n == 0 then return end
  local was = sel
  if btnp("right") then sel = sel % n + 1; slide = 24; theme_sfx(T, "move") end
  if btnp("left") then sel = (sel - 2) % n + 1; slide = -24; theme_sfx(T, "move") end
  if sel ~= was then track(-2, GAMES[sel]); hold.x, hold.y = 0, 0 end
  local i = GAMES[sel]
  local vote = voting() and votable(BIT.games[i])
  if btnp("a") then
    if vote then   -- linked: a vote, not a start (A again takes it back)
      theme_sfx(T, my_vote() == i and "back" or "open"); track(-4, my_vote() == i and 0 or i)
    else theme_sfx(T, "open"); launch(i) end
  end
  if btnp("b") and voting() then theme_sfx(T, "row"); track(-5, my_vote() == VOTE_PASS and 0 or 1) end
  if held("x", BIT.games[i].paused and not vote) then theme_sfx(T, "back"); track(-1, i) end
  if held("y", BIT.studio) then theme_sfx(T, "row"); launch(i, true) end
  if btnp("select") and both_modes(BIT.games[i]) then
    rpick = not rpick; theme_sfx(T, "row"); track(-3, rpick and 1 or 0)
  end
end

-- the card's player count: a little person and "1-8", and a flag for games that can be raced
local function draw_players(g, x, y)
  if not g.pmax then return end
  local s = g.pmax == 1 and "1" or (g.pmin == g.pmax and tostring(g.pmax) or (g.pmin .. "-" .. g.pmax))
  local w = #s * 8 + 14
  rectfill(x, y, w, 12, TC.accent)
  rectfill(x + 4, y + 2, 3, 3, TC.card) rectfill(x + 3, y + 6, 5, 4, TC.card)
  text(s, x + 11, y + 2, TC.card)
  if g.race then
    local rx = x + w + 3
    rectfill(rx, y, 44, 12, TC.card) rect(rx, y, 44, 12, TC.accent)
    rectfill(rx + 3, y + 2, 1, 8, TC.text) rectfill(rx + 4, y + 2, 4, 3, TC.accent)
    text("RACE", rx + 10, y + 2, TC.text)
  end
end

-- one row of the home screen: the picked card in the middle, its neighbours as silhouettes, page dots
local function draw_row(list, s, sl, dy, label, sub)
  local n = #list
  if not (dy > -ROWH and linked() >= 2) then text(label, 8, 22 + dy, TC.dim) end   -- (the linked Bits are there)
  local g = BIT.games[list[s]]
  local vt = voting() and not g.app
  if n > 2 then icon(BIT.games[list[(s - 2) % n + 1]], 40 + sl, 76 + dy, 2, true) end
  if n > 1 then icon(BIT.games[list[s % n + 1]], 248 + sl, 76 + dy, 2, true) end
  if vt then   -- the neighbours' votes: a count on their silhouettes
    for _, k in ipairs(n > 2 and { -1, 1 } or (n > 1 and { 1 } or {})) do
      local c = #voters(list[(s - 1 + k) % n + 1])
      if c > 0 then
        local bx = (k < 0 and 40 or 248) + sl + 24
        rectfill(bx, 70 + dy, 16, 12, TC.accent) text(tostring(c), bx + 4, 72 + dy, TC.card)
      end
    end
  end
  local bob = math.floor(math.sin(tt / 20) * 2 + 0.5)
  local cx, cy = 120 + math.floor(sl), 48 + bob + dy
  theme_card(T, cx - 4, cy - 4, 88, 88)
  icon(g, cx + 8, cy + 8, 4)
  if not g.app then draw_players(g, cx - 2, cy + 71) end
  if g.paused then   -- pause badge on the card's corner
    rectfill(cx + 64, cy - 2, 16, 14, TC.accent)
    rectfill(cx + 68, cy + 1, 3, 8, TC.card) rectfill(cx + 73, cy + 1, 3, 8, TC.card)
  end
  local name = g.name
  if #name > 18 then name = string.sub(name, 1, 17) .. "." end
  ctext(name, 146 + dy, TC.text, 2)
  local vs = vt and voters(list[s]) or {}
  if #vs > 0 then   -- who voted for this game: a tag with each Bit's name, in its colour
    local tags, wsum = {}, 0
    for _, b in ipairs(vs) do
      local t = bitname(b)
      tags[#tags + 1] = t; wsum = wsum + #t * 8 + 10
    end
    while wsum > 300 and #tags > 1 do wsum = wsum - (#tags[#tags] * 8 + 10); tags[#tags] = nil end
    local x = 160 - wsum / 2
    for k, t in ipairs(tags) do
      local w = #t * 8 + 6
      rectfill(x, 166 + dy, w, 11, mget(1 + vs[k], 3))
      text(t, x + 3, 168 + dy, 13)
      x = x + w + 4
    end
  elseif g.paused then ctext("paused where you left it", 168 + dy, TC.accent)
  elseif g.studio then ctext("open in the studio", 168 + dy, TC.accent)
  else ctext(sub(g), 168 + dy, TC.dim) end
  local w = math.min(n, 20) * 8
  for i = 1, math.min(n, 20) do
    local x = 160 - w / 2 + (i - 1) * 8 + 2
    if i == s then rectfill(x, 186 + dy, 4, 4, TC.accent) else rect(x, 186 + dy, 4, 4, TC.dim) end
    if vt and #voters(list[i]) > 0 then rectfill(x + 1, 183 + dy, 2, 2, TC.accent) end   -- a game with votes
  end
end

function _draw()
  theme_wall(T, tt, vy)

  local n = #GAMES
  local dy = -math.floor(vy + 0.5)
  clip(0, 18, 320, 204)
  if n == 0 then
    ctext("No games on this Bit yet", 92 + dy, TC.text)
    ctext("Save a cart to the Bit from the studio,", 116 + dy, TC.dim)
    ctext("or choose a folder in the Library.", 128 + dy, TC.dim)
  else
    draw_row(GAMES, sel, slide, dy, #APPS > 0 and "GAMES" or "", function(g)
      local s = plabel(g) or ""
      if g.race then s = s .. (g.pmax > 1 and ", or race" or ", race when linked") end
      if g.file and g.file ~= "" then s = s .. (s ~= "" and "   " or "") .. g.file end
      if #s > 38 then s = string.sub(s, 1, 37) .. "." end
      return s
    end)
  end
  if #APPS > 0 then
    draw_row(APPS, asel, aslide, dy + ROWH, "UTILITIES", function(g) return g.sub or "utility" end)
    -- the edge of the other row, so it is clear there is more
    if row == 0 then ctext("v  UTILITIES  v", 205 + dy + math.floor(math.sin(tt / 15) * 1.5), TC.accent)
    elseif n > 0 then text("^ GAMES", 312 - 7 * 8, 22 + dy + ROWH + math.floor(math.sin(tt / 15) * 1.5), TC.accent) end
  end
  clip()

  -- top bar
  theme_bar(T, 0, 17, true)
  local bt = theme_bartext(T)
  local me = BIT.me or {}
  rectfill(8, 5, 3, 8, TC.accent) rectfill(12, 5, 3, 8, TC.edge)
  local title = (me.bit and me.bit ~= "") and me.bit or "PocketBit"
  text(title, 20, 5, bt)
  rect(290, 5, 20, 9, bt) rectfill(310, 7, 2, 5, bt) rectfill(292, 7, 13, 5, TC.accent)
  local who = (me.name and me.name ~= "") and me.name or (BIT.source or "")
  text(who, 284 - #who * 8, 5, (me.name and me.name ~= "" and me.color) or bt)
  draw_linked()

  -- bottom bar
  theme_bar(T, 222, 18, false)
  local _, ready = linked()
  local hint = n > 0 and "A play   < > choose" or ""
  if n > 0 and ready > 1 then
    local g = BIT.games[GAMES[sel]]
    local how, np = plan(g)
    if how == "together" then hint = "A play on " .. np .. " Bits"
    elseif how == "race" then hint = "A race on " .. np .. " Bits"
    elseif g.net then hint = "A play   the others join in the game"
    else hint = "A play alone (1 player)" end
    if both_modes(g) then hint = hint .. (how == "race" and "   SEL together" or "   SEL race") end
  end
  local vote = n > 0 and voting() and votable(BIT.games[GAMES[sel]])
  if n > 0 and BIT.games[GAMES[sel]].paused and not vote then hint = "A continue  hold X restart" end
  if vote then
    local mv, need, of = my_vote(), mget(3, 4), mget(4, 4)
    local got = #voters(GAMES[sel])
    if mv == VOTE_PASS then hint = "B unpass  A vote"
    elseif mv == GAMES[sel] then hint = "A undo  B pass"
    else hint = "A vote  B pass" end
    hint = hint .. "  " .. got .. "/" .. need .. " votes"
  elseif voting() and n > 0 and row == 0 then
    hint = hint .. (my_vote() == VOTE_PASS and "  B stop pass" or "  B pass")
  end
  if BIT.studio and n > 0 then hint = hint .. "  hold Y edit" end
  if row == 1 then
    hint = BIT.games[APPS[asel]].paused and "A continue  hold X restart" or "A open   < > choose"
  end
  text(hint, 8, 227, bt)
  if #APPS == 0 and n > 0 then ctext("hold START+SELECT to come back", 204, TC.dim) end
  -- a game won the vote: it starts in a moment
  local left = BIT.link and mget(0, 4) or 0
  if left > 0 then
    local w = mget(1, 4)
    local wg = BIT.games[w]
    local nm = (w ~= VOTE_ELSE and wg) and string.upper(wg.name) or "A GAME"
    if #nm > 22 then nm = string.sub(nm, 1, 21) .. "." end
    rectfill(30, 92, 260, 46, TC.card) rect(30, 92, 260, 46, TC.accent) rect(31, 93, 258, 44, TC.accent)
    ctext(nm, 98, TC.text)
    ctext("WON THE VOTE", 110, TC.accent)
    local wait = math.max(1, mget(2, 4))
    rectfill(40, 126, math.floor(240 * math.min(1, (wait - left) / wait)), 4, TC.accent)
  end
  -- holding X or Y: a bar fills up over two seconds
  local hb = hold.x > 0 and "x" or (hold.y > 0 and "y" or nil)
  if hb and hold[hb] < HOLD then
    local label = hb == "x" and "KEEP HOLDING X TO START OVER" or "KEEP HOLDING Y TO EDIT"
    rectfill(40, 196, 240, 22, TC.card) rect(40, 196, 240, 22, TC.edge)
    rectfill(44, 210, math.floor(232 * hold[hb] / HOLD), 4, TC.accent)
    ctext(label, 200, TC.text)
  end
end
`;
