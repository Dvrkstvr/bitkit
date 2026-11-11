/* PocketBit home screen. Runs as a normal cart inside the BitKit runtime.
   The host fills BIT = { games = {{name, file, icon, studio}, ...}, sel, source, studio }
   and draws each game's 16x16 icon into this cart's tiles. MIT License. */
window.BK_HOME = `
local sel, tt, slide = 1, 0, 0
local stars = {}

function _init()
  sel = math.max(1, math.min(BIT.sel or 1, #BIT.games))
  for i = 1, 40 do stars[i] = { rnd(320) - 1, rnd(200) + 18, rnd(3) } end
end

local function ctext(s, y, c, sc)
  sc = sc or 1
  text(s, 160 - #s * 4 * sc, y, c, sc)
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
  local n = #BIT.games
  if n == 0 then return end
  if btnp("right") then sel = sel % n + 1; slide = 24; sfx("E5", 4, 0.2, 4) end
  if btnp("left") then sel = (sel - 2) % n + 1; slide = -24; sfx("E5", 4, 0.2, 4) end
  if btnp("a") or btnp("start") then sfx("C6", 1, 0.3, 10); launch(sel) end
  if BIT.studio and btnp("y") then sfx("G5", 1, 0.3, 6); launch(sel, true) end
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

  local n = #BIT.games
  if n == 0 then
    ctext("No games on this Bit yet", 92, 13)
    ctext("Save a cart to the Bit from the studio,", 116, 29)
    ctext("or choose a folder in the Library.", 128, 29)
  else
    local g = BIT.games[sel]
    -- neighbours as silhouettes
    if n > 2 then icon(BIT.games[(sel - 2) % n + 1], 40 + slide, 76, 2, true) end
    if n > 1 then icon(BIT.games[sel % n + 1], 248 + slide, 76, 2, true) end
    -- selected card
    local bob = math.floor(math.sin(tt / 20) * 2 + 0.5)
    local cx = 120 + math.floor(slide)
    rectfill(cx - 4, 48 + bob - 4, 88, 88, 19)
    rect(cx - 4, 48 + bob - 4, 88, 88, 21)
    rect(cx - 5, 48 + bob - 5, 90, 90, 31)
    icon(g, cx + 8, 56 + bob, 4)

    local name = g.name
    if #name > 18 then name = string.sub(name, 1, 17) .. "." end
    ctext(name, 146, 13, 2)
    if g.studio then ctext("open in the studio", 168, 27)
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
  local hint = n > 0 and "A play   < > choose" or ""
  if BIT.studio and n > 0 then hint = hint .. "   Y edit" end
  text(hint, 8, 227, 29)
  if n > 0 then ctext("hold START+SELECT to come back", 204, 30) end
end
`;
