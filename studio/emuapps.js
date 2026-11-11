/* PocketBit apps: emulators for the Game Boy, the Game Boy Color and the NES, on the Utilities row.
   One Lua app for all three (EMU says which console). The consoles themselves are native code in the runtime
   (runtime/bk_emu.c: Walnut-CGB, agnes and BitKit's own NES sound chip), driven with emu_* from here.
   The host keeps the games: in the studio studio/roms.js (drop ROM files on the Bit), on a PocketBit the
   SD card's /roms folder (runtime/bk_emu_fs.c). No games come with BitKit except its own test cards.
   MIT License. */
'use strict';
(function () {
  const APP = `
local S = {scale = nil, pal = 1, slot = 1, map = nil}   -- settings, kept with save()
local DEFAULT_MAP = {a = "a", b = "b", start = "start", select = "select", turbo_a = "x", turbo_b = "y", fast = "r", menu = "l"}
local MAP_ORDER = {
  {"a", "A"}, {"b", "B"}, {"start", "START"}, {"select", "SELECT"},
  {"turbo_a", "TURBO A"}, {"turbo_b", "TURBO B"}, {"fast", "FAST FORWARD"}, {"menu", "MENU"},
}
local BIT_BUTTONS = {"a", "b", "x", "y", "l", "r", "start", "select"}
local BITS = {a = 1, b = 2, select = 4, start = 8, right = 16, left = 32, up = 64, down = 128}
local PALS = {"PEA GREEN", "POCKET", "GREY", "COLOUR", "AMBER", "NIGHT"}
-- screen sizes: name and the picture's place on the 320x240 screen {x, y, w, h, crop top, crop bottom}
local SIZES = EMU.kind == "nes" and {
  {"1X", 32, 0, 256, 240}, {"TV", 14, 0, 292, 240}, {"CROPPED", 23, 0, 274, 240, 8, 8}, {"FULL", 0, 0, 320, 240},
} or {
  {"1X", 80, 48, 160, 144}, {"1.5X", 40, 12, 240, 216}, {"FIT", 27, 0, 266, 240}, {"FULL", 0, 0, 320, 240},
}

local mode = "list"              -- list, loading, play, menu, buttons
local roms, sel, top = {}, 1, 0
local msg, msg_t = nil, 0        -- a note at the bottom
local cur = nil                  -- the game playing: its entry in roms
local msel, bsel, waiting = 1, 1, false
local hint_t = 0
local PREV = {}
local function pressed(b) return btn(b) and not PREV[b] end
local function input_end() for _, b in ipairs({"a", "b", "x", "y", "l", "r", "start", "select", "up", "down", "left", "right"}) do PREV[b] = btn(b) end end
local function clamp(v, a, b) if v < a then return a elseif v > b then return b end return v end
local function note(s, t) msg, msg_t = s, t or 180 end

local function load_settings()
  local d = saved()
  if type(d) == "table" then for k, v in pairs(d) do S[k] = v end end
  if type(S.map) ~= "table" then S.map = {} end
  for k, v in pairs(DEFAULT_MAP) do if not S.map[k] then S.map[k] = v end end
  S.scale = clamp(S.scale or (EMU.kind == "nes" and 2 or 3), 1, #SIZES)
  S.pal = clamp(S.pal or 1, 1, #PALS)
  S.slot = clamp(S.slot or 1, 1, 9)
end
local function store() pcall(save, S) end
local function refresh()
  roms = emu_roms(EMU.kind)
  sel = clamp(sel, 1, math.max(1, #roms))
end

function _init()
  load_settings()
  refresh()
end

local function size_text(n)
  if n >= 1048576 then return string.format("%.1fMB", n / 1048576) end
  return (n // 1024) .. "KB"
end

local function start_game()
  local r = roms[sel]
  if not r then return end
  cur = r
  if emu_open(sel) then mode = "loading" else note("This Bit cannot load games") end
end

-- events from the host: a game opened, a state loaded, the list changed
local function poll()
  while true do
    local ev, ok = emu_poll()
    if not ev then return end
    if ev == "open" then
      if ok then
        mode = "play"; hint_t = 240
        emu_palette(S.pal)
      else
        mode = "list"; note("Could not start it: " .. tostring(emu_error()), 300)
      end
    elseif ev == "load" then
      note(ok and ("Loaded slot " .. S.slot) or ("Slot " .. S.slot .. " does not fit this game"))
      if ok then mode = "play" end
    elseif ev == "roms" then
      refresh()
    end
  end
end

local function pad_mask()
  local m = 0
  for _, d in ipairs({"up", "down", "left", "right"}) do if btn(d) then m = m | BITS[d] end end
  local map = S.map
  if btn(map.a) then m = m | BITS.a end
  if btn(map.b) then m = m | BITS.b end
  if btn(map.start) then m = m | BITS.start end
  if btn(map.select) then m = m | BITS.select end
  local on = (t() // 3) % 2 == 0
  if on and btn(map.turbo_a) then m = m | BITS.a end
  if on and btn(map.turbo_b) then m = m | BITS.b end
  return m
end

local function menu_items()
  local items = {
    {"RESUME"},
    {"SAVE STATE", function() return "SLOT " .. S.slot .. ((cur and cur.states and cur.states[S.slot]) and "  (USED)" or "") end, "slot"},
    {"LOAD STATE", function() return "SLOT " .. S.slot .. ((cur and cur.states and cur.states[S.slot]) and "" or "  (EMPTY)") end, "slot"},
    {"SCREEN", function() return SIZES[S.scale][1] end, "scale"},
  }
  if emu_kind() == "gb" then items[#items + 1] = {"COLOURS", function() return PALS[S.pal] end, "pal"} end
  items[#items + 1] = {"BUTTONS"}
  items[#items + 1] = {"RESET GAME"}
  items[#items + 1] = {"QUIT GAME"}
  return items
end

local function menu_change(it, d)
  if it[3] == "slot" then S.slot = (S.slot - 1 + d) % 9 + 1
  elseif it[3] == "scale" then S.scale = (S.scale - 1 + d) % #SIZES + 1
  elseif it[3] == "pal" then S.pal = (S.pal - 1 + d) % #PALS + 1; emu_palette(S.pal) end
  store()
end

local function menu_act(it)
  local n = it[1]
  if n == "RESUME" then mode = "play"
  elseif n == "SAVE STATE" then
    if emu_save_state(S.slot) then
      cur.states = cur.states or {}; cur.states[S.slot] = true
      note("Saved in slot " .. S.slot); mode = "play"
    else note("Could not save") end
  elseif n == "LOAD STATE" then
    if not emu_load_state(S.slot) then note("Could not load") end
  elseif n == "BUTTONS" then mode = "buttons"; bsel = 1; waiting = false
  elseif n == "RESET GAME" then emu_reset(); mode = "play"
  elseif n == "QUIT GAME" then emu_close(); cur = nil; mode = "list"; refresh()
  elseif it[3] then menu_change(it, 1) end
end

function _update()
  poll()
  if msg_t > 0 then msg_t = msg_t - 1 end
  if mode == "list" then
    if btnp("up") then sel = sel - 1 end
    if btnp("down") then sel = sel + 1 end
    if btnp("left") then sel = sel - 8 end
    if btnp("right") then sel = sel + 8 end
    sel = clamp(sel, 1, math.max(1, #roms))
    if pressed("a") then start_game() end
    if pressed("y") then refresh(); note(#roms .. " games") end
  elseif mode == "play" then
    if pressed(S.map.menu) then mode = "menu"; msel = 1
    else
      if not emu_run(pad_mask(), btn(S.map.fast) and 3 or 1) then
        note(tostring(emu_error()), 300); emu_close(); cur = nil; mode = "list"
      end
    end
    if hint_t > 0 then hint_t = hint_t - 1 end
  elseif mode == "menu" then
    local items = menu_items()
    if btnp("up") then msel = (msel - 2) % #items + 1 end
    if btnp("down") then msel = msel % #items + 1 end
    local it = items[msel]
    if it[3] and btnp("left") then menu_change(it, -1) end
    if it[3] and btnp("right") then menu_change(it, 1) end
    if pressed("a") then menu_act(it)
    elseif pressed("b") or pressed(S.map.menu) then mode = "play" end
  elseif mode == "buttons" then
    if waiting then
      for _, b in ipairs(BIT_BUTTONS) do
        if pressed(b) then S.map[MAP_ORDER[bsel][1]] = b; waiting = false; store() break end
      end
    else
      local n = #MAP_ORDER + 1
      if btnp("up") then bsel = (bsel - 2) % n + 1 end
      if btnp("down") then bsel = bsel % n + 1 end
      if pressed("a") then
        if bsel > #MAP_ORDER then for k, v in pairs(DEFAULT_MAP) do S.map[k] = v end; store(); note("Buttons back to normal")
        else waiting = true; PREV = {}; for _, b in ipairs(BIT_BUTTONS) do PREV[b] = true end end
      elseif pressed("b") then mode = "menu" end
    end
  end
  input_end()
end

local function bar(s, y, c)
  rectfill(0, y, 320, 12, 31)
  text(s, 4, y + 2, c or 28)
end

local function draw_list()
  cls(1)
  rectfill(0, 0, 320, 14, EMU.accent)
  text(EMU.title, 6, 3, 1)
  local sub = #roms == 1 and "1 GAME" or (#roms .. " GAMES")
  text(sub, 314 - #sub * 8, 3, 1)
  if #roms == 0 then
    local lines = {"No games here yet.", "", "In the studio: drop " .. EMU.ext .. " files on the", "Bit's screen, or press ROMs under it.", "",
      "On a PocketBit: put them in /roms", "on the SD card.", "", "Only play games you own."}
    for i, l in ipairs(lines) do text(l, 20, 40 + i * 12, i == 1 and 13 or 29) end
  else
    local rows = 15
    if sel <= top then top = sel - 1 end
    if sel > top + rows then top = sel - rows end
    for i = 1, rows do
      local k = top + i
      local r = roms[k]
      if not r then break end
      local y = 18 + (i - 1) * 13
      if k == sel then rectfill(2, y - 2, 316, 12, 30) end
      local name = r.name
      if #name > 30 then name = string.sub(name, 1, 29) .. "~" end
      text(name, 8, y, k == sel and 13 or 29)
      local tag = ""
      if r.states and next(r.states) then tag = "STATE " end
      if r.save then tag = tag .. "SAVE" end
      if tag ~= "" then text(tag, 312 - #tag * 8, y, 17) end
    end
    if #roms > rows then
      local h = math.max(8, 195 * rows // #roms)
      rectfill(317, 16 + (195 - h) * top // math.max(1, #roms - rows), 2, h, 28)
    end
  end
  if msg_t > 0 and msg then bar(msg, 214, 27) end
  bar("A PLAY   Y REFRESH   START+SELECT HOME", 228)
  local r = roms[sel]
  if r and msg_t == 0 then bar(string.upper(r.kind) .. "  " .. size_text(r.size or 0), 214, 28) end
end

local function draw_game()
  cls(1)
  local s = SIZES[S.scale]
  emu_draw(s[2], s[3], s[4], s[5], s[6] or 0, s[7] or 0)
end

local function draw_menu()
  draw_game()
  shade(0.65)
  local items = menu_items()
  local h = #items * 14 + 26
  local y0 = (240 - h) // 2
  rectfill(40, y0, 240, h, 31)
  rect(40, y0, 240, h, EMU.accent)
  local name = cur and cur.name or ""
  if #name > 28 then name = string.sub(name, 1, 27) .. "~" end
  text(name, 48, y0 + 6, EMU.accent)
  for i, it in ipairs(items) do
    local y = y0 + 20 + (i - 1) * 14
    if i == msel then rectfill(44, y - 3, 232, 13, 30) end
    text(it[1], 52, y, i == msel and 13 or 29)
    if it[2] then
      local v = it[2]()
      if i == msel and it[3] then v = "< " .. v .. " >" end
      text(v, 272 - #v * 8, y, i == msel and 27 or 28)
    end
  end
end

local function draw_buttons()
  cls(1)
  rectfill(0, 0, 320, 14, EMU.accent)
  text("BUTTONS", 6, 3, 1)
  for i, m in ipairs(MAP_ORDER) do
    local y = 24 + (i - 1) * 16
    if i == bsel then rectfill(20, y - 4, 280, 15, 30) end
    text(m[2], 28, y, i == bsel and 13 or 29)
    local v = string.upper(S.map[m[1]])
    if i == bsel and waiting then v = "PRESS A BUTTON" end
    text(v, 292 - #v * 8, y, i == bsel and 27 or 17)
  end
  local y = 24 + #MAP_ORDER * 16
  if bsel > #MAP_ORDER then rectfill(20, y - 4, 280, 15, 30) end
  text("BACK TO NORMAL", 28, y, bsel > #MAP_ORDER and 13 or 29)
  bar("The D-pad is always the D-pad.", 214)
  bar("A CHANGE   B BACK", 228)
end

function _draw()
  if mode == "list" then draw_list()
  elseif mode == "loading" then draw_list(); bar("Loading " .. (cur and cur.name or "") .. "...", 214, 27)
  elseif mode == "play" then
    draw_game()
    if hint_t > 0 and hint_t % 60 < 45 then
      local s = string.upper(S.map.menu) .. ": MENU"
      rectfill(0, 0, #s * 8 + 8, 12, 31); text(s, 4, 2, 29)
    end
    if msg_t > 0 and msg then bar(msg, 228, 27) end
  elseif mode == "menu" then
    draw_menu()
    if msg_t > 0 and msg then bar(msg, 228, 27) end
  elseif mode == "buttons" then draw_buttons() end
end
`;

  const PAL = { '.': 0, k: 1, w: 13, y: 27, o: 10, b: 21, l: 22, g: 17, G: 16, p: 4, P: 3, d: 31, r: 26, c: 12, s: 29, S: 28, n: 30 };
  function icon(rows) { return rows.map(r => [...r].map(ch => PAL[ch] || 0)); }
  // a grey handheld with a green screen; the same in purple; a grey console with a red stripe and a pad
  const GB_ICON = icon([
    '...dddddddddd...', '..dssssssssssd..', '..dsnnnnnnnnsd..', '..dsnGGGGGGnsd..', '..dsnGgggggnsd..', '..dsnGgGGggnsd..',
    '..dsnGgggggnsd..', '..dsnGGGGGGnsd..', '..dsnnnnnnnnsd..', '..dssssssssssd..', '..dsnssssssrsd..', '..dnnnssssrssd..',
    '..dsnssssssssd..', '..dssssSSsSSsd..', '..dssssssssssd..', '...dddddddddd...']);
  const GBC_ICON = icon([
    '...dddddddddd...', '..dPPPPPPPPPPd..', '..dPkkkkkkkkPd..', '..dPkbbllggkPd..', '..dPkbyyyrgkPd..', '..dPklyrrrlkPd..',
    '..dPkgggbbbkPd..', '..dPkkkkkkkkPd..', '..dPPPPPPPPPPd..', '..dPPPPPPPPPPd..', '..dPkPPPPPPyPd..', '..dkkkPPPPyPPd..',
    '..dPkPPPPPPPPd..', '..dPPPPkkPkkPd..', '..dPPPPPPPPPPd..', '...dddddddddd...']);
  const NES_ICON = icon([
    '................', '................', '.dddddddddddddd.', '.dssssssssssssd.', '.dssssssssssssd.', '.dSSSSSSSSSSSSd.',
    '.dnnnnnnnnnnnnd.', '.dssrrssssssssd.', '.dssssssssssssd.', '.dddddddddddddd.', '................', '..dddddddddddd..',
    '..dkskkkkkrkrd..', '..dssskkkkkkkd..', '..dkskkkkkkkkd..', '..dddddddddddd..']);

  const emu = (kind, title, accent, ext) => `EMU = {kind = "${kind}", title = "${title}", accent = ${accent}, ext = "${ext}"}\n` + APP;
  const apps = window.BK_APPS = window.BK_APPS || [];
  const at = apps.findIndex(a => a.settings);   // before Settings, which stays last
  apps.splice(at < 0 ? apps.length : at, 0, ...[
    { name: 'Game Boy', code: emu('gb', 'GAME BOY', 17, '.gb'), icon: GB_ICON, saveKey: 'Emulator GB', sub: 'emulator: your own ROMs', emu: 'gb',
      about: 'Plays Game Boy games you own (.gb files), with save states.' },
    { name: 'Game Boy Color', code: emu('gbc', 'GAME BOY COLOR', 22, '.gbc'), icon: GBC_ICON, saveKey: 'Emulator GBC', sub: 'emulator: your own ROMs', emu: 'gbc',
      about: 'Plays Game Boy Color games you own (.gbc files), with save states.' },
    { name: 'NES', code: emu('nes', 'NES', 26, '.nes'), icon: NES_ICON, saveKey: 'Emulator NES', sub: 'emulator: your own ROMs', emu: 'nes',
      about: 'Plays NES games you own (.nes files), with save states.' },
  ]);
  window.BK_EMU_APP = APP;
})();
