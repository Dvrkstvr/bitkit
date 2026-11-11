/* PocketBit home screen. Runs as a normal cart inside the BitKit runtime.
   The host fills BIT = { games = {{name, file, icon, studio, paused}, ...}, sel, source, studio }
   and draws each game's 16x16 icon into this cart's tiles. A paused game carries on where it was left
   when launched; track(-1, n) is the host's private signal to forget game n's pause and start it over,
   track(-2, n) tells the host game n is selected. With BIT.link the host keeps the linked Bits in map rows 0-1:
   mget(0,0) how many, mget(1,0) which one is this Bit, mget(1+i,0) Bit i's number, mget(1+i,1) 1 home 2 in a game 3 idle.
   A game started here starts on every linked Bit that is on its home screen.
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

function _init()
  for i, g in ipairs(BIT.games) do if g.app then APPS[#APPS + 1] = i else GAMES[#GAMES + 1] = i end end
  local want = math.max(1, math.min(BIT.sel or 1, #BIT.games))
  for k, i in ipairs(GAMES) do if i == want then sel = k end end
  for k, i in ipairs(APPS) do if i == want then asel = k; row = 1 end end
  if #GAMES == 0 and #APPS > 0 then row = 1 end
  vy = row * ROWH
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
    if btnp("a") or btnp("start") then theme_sfx(T, "open"); launch(i) end
    if BIT.games[i].paused and btnp("x") then theme_sfx(T, "back"); track(-1, i) end
    return
  end
  local n = #GAMES
  if n == 0 then return end
  local was = sel
  if btnp("right") then sel = sel % n + 1; slide = 24; theme_sfx(T, "move") end
  if btnp("left") then sel = (sel - 2) % n + 1; slide = -24; theme_sfx(T, "move") end
  if sel ~= was then track(-2, GAMES[sel]) end
  local i = GAMES[sel]
  if btnp("a") or btnp("start") then theme_sfx(T, "open"); launch(i) end
  if BIT.games[i].paused and btnp("x") then theme_sfx(T, "back"); track(-1, i) end
  if BIT.studio and btnp("y") then theme_sfx(T, "row"); launch(i, true) end
end

-- one row of the home screen: the picked card in the middle, its neighbours as silhouettes, page dots
local function draw_row(list, s, sl, dy, label, sub)
  local n = #list
  text(label, 8, 22 + dy, TC.dim)
  local g = BIT.games[list[s]]
  if n > 2 then icon(BIT.games[list[(s - 2) % n + 1]], 40 + sl, 76 + dy, 2, true) end
  if n > 1 then icon(BIT.games[list[s % n + 1]], 248 + sl, 76 + dy, 2, true) end
  local bob = math.floor(math.sin(tt / 20) * 2 + 0.5)
  local cx, cy = 120 + math.floor(sl), 48 + bob + dy
  theme_card(T, cx - 4, cy - 4, 88, 88)
  icon(g, cx + 8, cy + 8, 4)
  if g.paused then   -- pause badge on the card's corner
    rectfill(cx + 64, cy - 2, 16, 14, TC.accent)
    rectfill(cx + 68, cy + 1, 3, 8, TC.card) rectfill(cx + 73, cy + 1, 3, 8, TC.card)
  end
  local name = g.name
  if #name > 18 then name = string.sub(name, 1, 17) .. "." end
  ctext(name, 146 + dy, TC.text, 2)
  if g.paused then ctext("paused where you left it", 168 + dy, TC.accent)
  elseif g.studio then ctext("open in the studio", 168 + dy, TC.accent)
  else ctext(sub(g), 168 + dy, TC.dim) end
  local w = math.min(n, 20) * 8
  for i = 1, math.min(n, 20) do
    local x = 160 - w / 2 + (i - 1) * 8 + 2
    if i == s then rectfill(x, 186 + dy, 4, 4, TC.accent) else rect(x, 186 + dy, 4, 4, TC.dim) end
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
    draw_row(GAMES, sel, slide, dy, #APPS > 0 and "GAMES" or "", function(g) return g.file or "" end)
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
  local hint = n > 0 and (ready > 1 and ("A play on " .. math.min(ready, 8) .. " Bits") or "A play   < > choose") or ""
  if n > 0 and BIT.games[GAMES[sel]].paused then hint = "A continue   X restart" end
  if BIT.studio and n > 0 then hint = hint .. "   Y edit" end
  if row == 1 then
    hint = BIT.games[APPS[asel]].paused and "A continue   X restart" or "A open   < > choose"
  end
  text(hint, 8, 227, bt)
  if #APPS == 0 and n > 0 then ctext("hold START+SELECT to come back", 204, TC.dim) end
end
`;
