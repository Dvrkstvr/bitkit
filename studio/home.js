/* PocketBit home screen. Runs as a normal cart inside the BitKit runtime.
   The host fills BIT = { games = {{name, file, icon, studio, paused}, ...}, sel, source, studio }
   and draws each game's 16x16 icon into this cart's tiles. A paused game carries on where it was left
   when launched; track(-1, n) is the host's private signal to forget game n's pause and start it over,
   track(-2, n) tells the host game n is selected. With BIT.link the host keeps the linked Bits in map rows 0-1:
   mget(0,0) how many, mget(1,0) which one is this Bit, mget(1+i,0) Bit i's number, mget(1+i,1) 1 home 2 in a game 3 idle.
   A game started here starts on every linked Bit that is on its home screen.
   Entries with app = true (Hexbeat, Loopbox: studio/bitapps.js) sit on the apps shelf below the games: Down goes there.
   MIT License. */
window.BK_HOME = `
local sel, tt, slide = 1, 0, 0
local stars = {}
local GAMES, APPS = {}, {}     -- games and apps, as indexes into BIT.games
local row, asel = 0, 1         -- 0 the games, 1 the apps shelf

function _init()
  for i, g in ipairs(BIT.games) do if g.app then APPS[#APPS + 1] = i else GAMES[#GAMES + 1] = i end end
  local want = math.max(1, math.min(BIT.sel or 1, #BIT.games))
  for k, i in ipairs(GAMES) do if i == want then sel = k end end
  for k, i in ipairs(APPS) do if i == want then asel = k; row = 1 end end
  for i = 1, 40 do stars[i] = { rnd(320) - 1, rnd(200) + 18, rnd(3) } end
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

local function draw_linked()
  local n, ready = linked()
  if n < 2 then return end
  local me = mget(1, 0)
  text("LINKED", 8, 23, 28)
  local x = 58
  for i = 1, math.min(n, 12) do
    local num, st = mget(1 + i, 0), mget(1 + i, 1)
    local s = tostring(num)
    local w = #s * 8 + 6
    rectfill(x, 21, w, 11, i == me and 17 or (st == 2 and 30 or 19))
    if i == me then rect(x - 1, 20, w + 2, 13, 13) end
    text(s, x + 3, 23, st == 2 and 28 or 13)
    x = x + w + 4
  end
  if n > 12 then text("+" .. (n - 12), x, 23, 28) end
  local busy = n - ready
  if busy > 0 then text(busy .. " in a game", 320 - 8 - #(busy .. " in a game") * 8, 23, 28) end
end

local function icon(g, x, y, sc, ghost)
  if ghost then pal(30) end
  if g.icon then
    spr(g.icon, x, y, 2, 2, false, false, sc)
  else
    rectfill(x, y, 16 * sc, 16 * sc, ghost and 30 or g.color)
    if not ghost then
      local ch = string.upper(string.sub(g.name, 1, 1))
      text(ch, x + 8 * sc - 4 * sc, y + 8 * sc - 4 * sc, 13, sc)
    end
  end
  if ghost then pal() end
end

function _update()
  tt = tt + 1
  for _, s in ipairs(stars) do
    s[1] = s[1] - s[3] * 0.15
    if s[1] < 0 then s[1] = 320 end
  end
  slide = slide * 0.7
  if #APPS > 0 then
    if btnp("down") and row == 0 then row = 1; sfx("G5", 4, 0.2, 4); track(-2, APPS[asel]) end
    if (btnp("up") or #GAMES == 0) and row == 1 and #GAMES > 0 then row = 0; sfx("G5", 4, 0.2, 4); track(-2, GAMES[sel]) end
    if #GAMES == 0 then row = 1 end
  end
  if row == 1 then
    local was = asel
    if btnp("right") then asel = asel % #APPS + 1 end
    if btnp("left") then asel = (asel - 2) % #APPS + 1 end
    if asel ~= was then sfx("E5", 4, 0.2, 4); track(-2, APPS[asel]) end
    local i = APPS[asel]
    if btnp("a") or btnp("start") then sfx("C6", 1, 0.3, 10); launch(i) end
    if BIT.games[i].paused and btnp("x") then sfx("C5", 1, 0.3, 10); track(-1, i) end
    return
  end
  local n = #GAMES
  if n == 0 then return end
  local was = sel
  if btnp("right") then sel = sel % n + 1; slide = 24; sfx("E5", 4, 0.2, 4) end
  if btnp("left") then sel = (sel - 2) % n + 1; slide = -24; sfx("E5", 4, 0.2, 4) end
  if sel ~= was then track(-2, GAMES[sel]) end
  local i = GAMES[sel]
  if btnp("a") or btnp("start") then sfx("C6", 1, 0.3, 10); launch(i) end
  if BIT.games[i].paused and btnp("x") then sfx("C5", 1, 0.3, 10); track(-1, i) end
  if BIT.studio and btnp("y") then sfx("G5", 1, 0.3, 6); launch(i, true) end
end

local function draw_apps()
  if #APPS == 0 then return end
  rectfill(0, 196, 320, 26, 31)
  text("APPS", 8, 205, row == 1 and 13 or 30)
  local x = 48
  for k, i in ipairs(APPS) do
    local g = BIT.games[i]
    local on = row == 1 and k == asel
    local w = #g.name * 8 + 26
    if on then rectfill(x - 3, 198, w + 2, 22, 21) end
    icon(g, x, 201, 1, row == 0)
    text(g.name, x + 20, 205, on and 13 or 29)
    if g.paused then rectfill(x + w - 8, 200, 2, 6, 13) rectfill(x + w - 5, 200, 2, 6, 13) end
    x = x + w + 8
  end
end

function _draw()
  cls(1)
  for _, s in ipairs(stars) do pset(s[1], s[2], s[3] > 1.5 and 29 or 30) end

  -- top bar
  rectfill(0, 0, 320, 17, 31)
  rectfill(8, 5, 3, 8, 17) rectfill(12, 5, 3, 8, 21)
  text("PocketBit", 20, 5, 13)
  rect(290, 5, 20, 9, 29) rectfill(310, 7, 2, 5, 29) rectfill(292, 7, 13, 5, 17)
  local src = BIT.source or ""
  text(src, 284 - #src * 8, 5, 28)
  draw_linked()

  local n = #GAMES
  if n == 0 then
    ctext("No games on this Bit yet", 92, 13)
    ctext("Save a cart to the Bit from the studio,", 116, 29)
    ctext("or choose a folder in the Library.", 128, 29)
  else
    local g = BIT.games[GAMES[sel]]
    -- neighbours as silhouettes
    if n > 2 then icon(BIT.games[GAMES[(sel - 2) % n + 1]], 40 + slide, 76, 2, true) end
    if n > 1 then icon(BIT.games[GAMES[sel % n + 1]], 248 + slide, 76, 2, true) end
    -- selected card
    local bob = math.floor(math.sin(tt / 20) * 2 + 0.5)
    local cx = 120 + math.floor(slide)
    rectfill(cx - 4, 48 + bob - 4, 88, 88, 19)
    rect(cx - 4, 48 + bob - 4, 88, 88, 21)
    rect(cx - 5, 48 + bob - 5, 90, 90, 31)
    icon(g, cx + 8, 56 + bob, 4)
    if g.paused then   -- pause badge on the card's corner
      rectfill(cx + 64, 48 + bob - 2, 16, 14, 31)
      rectfill(cx + 68, 48 + bob + 1, 3, 8, 13) rectfill(cx + 73, 48 + bob + 1, 3, 8, 13)
    end

    local name = g.name
    if #name > 18 then name = string.sub(name, 1, 17) .. "." end
    ctext(name, 146, 13, 2)
    if g.paused then ctext("paused where you left it", 168, 21)
    elseif g.studio then ctext("open in the studio", 168, 27)
    else ctext(g.file or "", 168, 28) end

    -- page dots
    local w = math.min(n, 20) * 8
    for i = 1, math.min(n, 20) do
      local x = 160 - w / 2 + (i - 1) * 8 + 2
      if i == sel then rectfill(x, 186, 4, 4, 13) else rect(x, 186, 4, 4, 30) end
    end
  end

  -- bottom bar
  rectfill(0, 222, 320, 18, 31)
  local _, ready = linked()
  local hint = n > 0 and (ready > 1 and ("A play on " .. math.min(ready, 8) .. " Bits") or "A play   < > choose") or ""
  if n > 0 and BIT.games[GAMES[sel]].paused then hint = "A continue   X restart" end
  if BIT.studio and n > 0 then hint = hint .. "   Y edit" end
  if row == 1 then
    hint = BIT.games[APPS[asel]].paused and "A continue   X restart" or "A open   < > choose"
    hint = hint .. "   UP games"
  elseif #APPS > 0 then hint = hint .. "  DOWN apps" end
  if #APPS > 0 then hint = string.gsub(hint, "   ", "  ") end
  text(hint, 8, 227, 29)
  if #APPS > 0 then draw_apps()
  elseif n > 0 then ctext("hold START+SELECT to come back", 204, 30) end
end
`;
