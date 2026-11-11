/* PocketBit apps: Hexbeat (a tracker) and Loopbox (a loop maker) on the Bit's home screen, played with buttons.
   They are carts like any game. Both keep their songs in one save file ("Music"), so a song started in one
   opens in the other, and the studio's Tracker and Loops tabs can send songs over (→ Bit / ← Bit).
   The song format and the player are runtime/bk_music.lua. MIT License. */
'use strict';
(function () {
  // shared by both apps: the song library, presets, drawing and list helpers
  const LIB = `
WAVES = {"SQUARE", "TRIANGLE", "SAW", "NOISE", "SINE", "PULSE"}
PRESETS = {
  {name = "LEAD", w = 5, v = 0.5, a = 0, d = 14, s = 0.55, r = 10, sw = 0, vb = 0.15, p = 0, n = 72},
  {name = "BASS", w = 1, v = 0.9, a = 0, d = 8, s = 0.7, r = 5, sw = 0, vb = 0, p = 0, n = 45},
  {name = "KICK", w = 4, v = 1, a = 0, d = 10, s = 0, r = 0, sw = -1.3, vb = 0, p = 0, n = 52, drum = true},
  {name = "SNARE", w = 3, v = 0.55, a = 0, d = 9, s = 0, r = 0, sw = -0.3, vb = 0, p = 0, n = 86, drum = true},
  {name = "HAT", w = 3, v = 0.28, a = 0, d = 3, s = 0, r = 0, sw = 0, vb = 0, p = 0.3, n = 112, drum = true},
  {name = "PAD", w = 2, v = 0.3, a = 14, d = 20, s = 0.6, r = 30, sw = 0, vb = 0.1, p = -0.2, n = 60},
  {name = "PLUCK", w = 0, v = 0.45, a = 0, d = 10, s = 0, r = 0, sw = 0, vb = 0, p = 0.2, n = 72},
  {name = "CLAP", w = 3, v = 0.45, a = 0, d = 6, s = 0, r = 0, sw = 0, vb = 0, p = -0.2, n = 96, drum = true},
  {name = "TOM", w = 4, v = 0.8, a = 0, d = 14, s = 0, r = 0, sw = -0.5, vb = 0, p = 0, n = 57, drum = true},
}
FXL = "AUDGVWPCRSJB"
local NOTES = {"C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"}
function nn(n) if n < 0 then return "OFF" elseif n == 0 then return "---" end return NOTES[n % 12 + 1] .. (n // 12 - 1) end
function hx(v) return string.format("%02X", v) end
function clamp(v, a, b) if v < a then return a elseif v > b then return b end return v end
function copy(t) local o = {} for k, v in pairs(t) do o[k] = type(v) == "table" and copy(v) or v end return o end
function blank(ch) local p = {} for c = 1, 8 do p[c] = {} end return p end

function new_song(name)
  local s = {name = name, bpm = 120, rpb = 4, rows = 32, ch = 4, loop = 1, inst = {}, pat = {blank()}, ord = {1},
    tr = {{name = "LEAD", kind = "keys", inst = 1}, {name = "BASS", kind = "keys", inst = 2}, {name = "DRUMS", kind = "drums", inst = 3}, {name = "HATS", kind = "drums", inst = 5}}}
  for i = 1, 6 do s.inst[i] = copy(PRESETS[i]) end
  local p = s.pat[1]
  for r = 0, 31, 4 do p[3][r] = {r % 8 == 0 and 52 or 86, r % 8 == 0 and 3 or 4, -1, nil, 0} end
  for r = 0, 31, 2 do p[4][r] = {112, 5, r % 4 == 0 and 255 or 150, nil, 0} end
  local roots = {45, 41, 48, 43}
  for k = 0, 3 do
    p[2][k * 8] = {roots[k + 1], 2, -1, nil, 0}; p[2][k * 8 + 2] = {-1, 0, -1, nil, 0}
    p[2][k * 8 + 4] = {roots[k + 1] + 12, 2, -1, nil, 0}; p[2][k * 8 + 6] = {-1, 0, -1, nil, 0}
  end
  return s
end
function fix_song(s)
  s.inst = s.inst or {}; s.pat = s.pat or {}; s.ord = s.ord or {1}; s.tr = s.tr or {}
  s.ch = clamp(s.ch or 4, 1, 8); s.rows = clamp(s.rows or 32, 4, 128); s.bpm = s.bpm or 120; s.rpb = s.rpb or 4; s.loop = s.loop or 1
  s.name = s.name or "SONG"
  if #s.pat == 0 then s.pat[1] = blank() end
  for _, p in ipairs(s.pat) do for c = 1, 8 do p[c] = music_cells(p[c] or "") end end
  for c = 1, 8 do s.tr[c] = s.tr[c] or {name = "TRACK " .. c, kind = "keys", inst = 1} end
  if #s.inst == 0 then s.inst[1] = copy(PRESETS[1]) end
  if #s.ord == 0 then s.ord = {1} end
  return s
end

LIB = nil
local DIRTY, SAVE_T, FULL = false, 0, 0
function lib_load()
  local d = saved()
  if type(d) == "table" and type(d.songs) == "table" and #d.songs > 0 then
    LIB = {songs = d.songs, cur = d.cur or 1}
    for _, s in ipairs(LIB.songs) do fix_song(s) end
  else
    LIB = {songs = {new_song("SONG 1")}, cur = 1}
  end
  LIB.cur = clamp(LIB.cur, 1, #LIB.songs)
end
function S() return LIB.songs[LIB.cur] end
function touch() DIRTY = true; SAVE_T = 45 end
function lib_save()
  DIRTY = false
  local out = {songs = {}, cur = LIB.cur}
  for i, s in ipairs(LIB.songs) do
    local o = {name = s.name, bpm = s.bpm, rpb = s.rpb, rows = s.rows, ch = s.ch, loop = s.loop, inst = s.inst, ord = s.ord, tr = {}, pat = {}}
    for c = 1, s.ch do o.tr[c] = s.tr[c] end
    for p, pat in ipairs(s.pat) do o.pat[p] = {}; for c = 1, s.ch do o.pat[p][c] = music_pack(pat[c] or {}, s.rows) end end
    out.songs[i] = o
  end
  if not pcall(save, out) then FULL = 180 end
end
function lib_tick()
  if DIRTY then SAVE_T = SAVE_T - 1; if SAVE_T <= 0 then lib_save() end end
end

-- buttons: pressed() is true once when a button goes down
local PREV = {}
function pressed(b) return btn(b) and not PREV[b] end
function input_end() for _, b in ipairs({"a", "b", "x", "y", "l", "r", "start", "select", "up", "down", "left", "right"}) do PREV[b] = btn(b) end end

PLAY, PLAYO = nil, {}   -- "song" or "loop", and how it started
function play_toggle(kind, o)
  if PLAY then music_stop(); PLAY = nil return end
  music(S(), o); PLAY, PLAYO = kind, o
end
function play_stop() music_stop(); PLAY = nil end

-- the top bar with the screen names, the bottom bar with what the buttons do
function topbar(app, screens, cur, col)
  rectfill(0, 0, 320, 12, 31)
  text(app, 3, 2, col)
  local x = #app * 8 + 12
  for i, n in ipairs(screens) do
    if i == cur then rectfill(x - 2, 1, #n * 8 + 4, 10, col); text(n, x, 2, 1) else text(n, x, 2, 28) end
    x = x + #n * 8 + 8
  end
  if PLAY then
    local p, r = music_pos()
    if p then local s = ">" .. hx(p - 1) .. ":" .. hx(r) text(s, 317 - #s * 8, 2, 17) end
  end
end
function hint(s)
  rectfill(0, 228, 320, 12, 31)
  if FULL > 0 then FULL = FULL - 1; text("SAVE FULL: delete a song", 3, 230, 26) return end
  text(s, 3, 230, 28)
end

-- a list of settings: {label, get(), change(d, big), act()}
function list_draw(items, sel, x, y, w, focus)
  for i, it in ipairs(items) do
    local yy = y + (i - 1) * 11
    if i == sel and focus then rectfill(x - 2, yy - 2, w + 4, 11, 2) end
    text(it[1], x, yy, it[4] and 27 or (i == sel and focus and 13 or 29))
    if it[2] then local v = tostring(it[2]()) text(v, x + w - #v * 8, yy, 13) end
  end
end
function list_input(items, st)
  local it = items[st.sel]
  if btn("a") then
    if it and it[3] then
      if btnp("up") then it[3](1) elseif btnp("down") then it[3](-1)
      elseif btnp("right") then it[3](1, true) elseif btnp("left") then it[3](-1, true) end
    end
    if pressed("a") and it and it[4] then it[4]() end
    return
  end
  if btnp("up") then st.sel = (st.sel - 2) % #items + 1 end
  if btnp("down") then st.sel = st.sel % #items + 1 end
end

-- the song settings both apps show
local CONFIRM = 0
function song_items(chname)
  return {
    {"SONG", function() return LIB.cur .. "/" .. #LIB.songs .. " " .. string.sub(S().name, 1, 10) end,
      function(d) play_stop(); LIB.cur = (LIB.cur - 1 + d) % #LIB.songs + 1; touch() end},
    {"TEMPO", function() return S().bpm end, function(d, big) S().bpm = clamp(S().bpm + d * (big and 10 or 1), 30, 300); touch() end},
    {"STEPS A BEAT", function() return S().rpb end, function(d) S().rpb = clamp(S().rpb + d, 1, 16); touch() end},
    {"STEPS", function() return S().rows end, function(d, big)
      local s = S(); s.rows = clamp(s.rows + d * (big and 16 or 4), 4, 128)
      for _, p in ipairs(s.pat) do for c = 1, 8 do for r in pairs(p[c]) do if r >= s.rows then p[c][r] = nil end end end end
      touch() end},
    {chname or "CHANNELS", function() return S().ch end, function(d) play_stop(); S().ch = clamp(S().ch + d, 1, 8); touch() end},
    {"NEW SONG", nil, nil, function() play_stop(); LIB.songs[#LIB.songs + 1] = new_song("SONG " .. (#LIB.songs + 1)); LIB.cur = #LIB.songs; touch() end},
    {"COPY SONG", nil, nil, function()
      play_stop(); local c = copy(S()); c.name = string.sub(c.name, 1, 8) .. " B"; LIB.songs[#LIB.songs + 1] = c; LIB.cur = #LIB.songs; touch() end},
    {"DELETE SONG", function() return CONFIRM > 0 and "A AGAIN" or "" end, nil, function()
      if #LIB.songs < 2 then return end
      if CONFIRM > 0 then play_stop(); table.remove(LIB.songs, LIB.cur); LIB.cur = clamp(LIB.cur, 1, #LIB.songs); CONFIRM = 0; touch()
      else CONFIRM = 90 end end},
  }
end
function confirm_tick() if CONFIRM > 0 then CONFIRM = CONFIRM - 1 end end
`;

  /* ------------------------------------------------------------ Hexbeat: the tracker */
  const HEXBEAT = LIB + `
local SCR, SCREENS = 1, {"PATTERN", "SONG", "INSTR"}
local cur = {pos = 1, row = 0, ch = 1, col = 1}
local last = {note = 60, inst = 1, vol = 192, fx = 1, fv = 0}
local ord = {sel = 1, side = false}
local set = {sel = 1}
local ins = {sel = 1, side = false, psel = 1, preset = 1}
local FXNAME = {A = "ARPEGGIO", U = "SLIDE UP", D = "SLIDE DOWN", G = "GLIDE", V = "VIBRATO", W = "VOL SLIDE",
  P = "PAN", C = "CUT", R = "RETRIGGER", S = "TEMPO", J = "JUMP", B = "BREAK"}

local function P() local s = S() local p = s.ord[clamp(cur.pos, 1, #s.ord)] return s.pat[p] end
local function get() return P()[cur.ch][cur.row] end
local function put(c)
  if c and c[1] == 0 and (c[2] or 0) == 0 and (c[3] or -1) < 0 and not c[4] then c = nil end
  P()[cur.ch][cur.row] = c; touch()
end
local function newcell() return {0, 0, -1, nil, 0} end
local function hear(c) if c and c[1] > 0 and not PLAY then music_note(S(), (c[2] or 0) > 0 and c[2] or last.inst, c[1], 14) end end

function _init() lib_load() end

-- A held + a direction changes the field under the cursor
local function change(d, big)
  local s, c = S(), get() or newcell()
  if cur.col == 1 then
    if c[1] <= 0 then c[1] = last.note else c[1] = clamp(c[1] + d * (big and 12 or 1), 1, 127) end
    if c[2] == 0 then c[2] = last.inst end
    last.note = c[1]; put(c); hear(c)
  elseif cur.col == 2 then c[2] = clamp(c[2] + d * (big and 4 or 1), 0, #s.inst); if c[2] > 0 then last.inst = c[2] end put(c)
  elseif cur.col == 3 then c[3] = c[3] < 0 and 255 or clamp(c[3] + d * (big and 16 or 1), 0, 255); last.vol = c[3]; put(c)
  elseif cur.col == 4 then
    local i = c[4] and string.find(FXL, c[4], 1, true) or last.fx
    i = (i - 1 + d) % #FXL + 1
    c[4] = string.sub(FXL, i, i); last.fx = i; put(c)
  else c[5] = clamp(c[5] + d * (big and 16 or 1), 0, 255); if not c[4] then c[4] = string.sub(FXL, last.fx, last.fx) end last.fv = c[5]; put(c) end
end
-- A pressed on an empty field puts the last value there
local function place()
  local c = get() or newcell()
  if cur.col == 1 and c[1] == 0 then c[1] = last.note; c[2] = last.inst; put(c); hear(c)
  elseif cur.col == 2 and c[2] == 0 then c[2] = last.inst; put(c)
  elseif cur.col == 3 and c[3] < 0 then c[3] = last.vol; put(c)
  elseif cur.col >= 4 and not c[4] then c[4] = string.sub(FXL, last.fx, last.fx); c[5] = last.fv; put(c)
  elseif cur.col == 1 then hear(c) end
end
local function clear()
  local c = get()
  if cur.col == 1 then
    if not c or c[1] == 0 then c = c or newcell(); c[1] = -1; c[2] = 0 else c[1] = 0; c[2] = 0 end
  elseif not c then return
  elseif cur.col == 2 then c[2] = 0
  elseif cur.col == 3 then c[3] = -1
  else c[4] = nil; c[5] = 0 end
  put(c)
end

local function upd_pattern()
  local s = S()
  if btn("a") then
    if pressed("a") then place() end
    if btnp("up") then change(1) elseif btnp("down") then change(-1)
    elseif btnp("right") then change(1, true) elseif btnp("left") then change(-1, true) end
    return
  end
  if btn("b") then
    if btnp("up") then cur.row = clamp(cur.row - s.rpb, 0, s.rows - 1) end
    if btnp("down") then cur.row = clamp(cur.row + s.rpb, 0, s.rows - 1) end
    if btnp("left") then cur.ch = clamp(cur.ch - 1, 1, s.ch) end
    if btnp("right") then cur.ch = clamp(cur.ch + 1, 1, s.ch) end
    return
  end
  if btnp("up") then cur.row = (cur.row - 1) % s.rows end
  if btnp("down") then cur.row = (cur.row + 1) % s.rows end
  if btnp("left") then cur.col = cur.col - 1; if cur.col < 1 then if cur.ch > 1 then cur.ch = cur.ch - 1; cur.col = 5 else cur.col = 1 end end end
  if btnp("right") then cur.col = cur.col + 1; if cur.col > 5 then if cur.ch < s.ch then cur.ch = cur.ch + 1; cur.col = 1 else cur.col = 5 end end end
  if pressed("x") then clear() end
  if btnp("l") then cur.pos = clamp(cur.pos - 1, 1, #s.ord) end
  if btnp("r") then cur.pos = clamp(cur.pos + 1, 1, #s.ord) end
  if pressed("y") then play_toggle("loop", {pat = s.ord[cur.pos], row = cur.row}) end
end

local function upd_song()
  local s = S()
  if btnp("left") and not btn("a") then ord.side = false end
  if btnp("right") and not btn("a") then ord.side = true end
  if ord.side then list_input(song_items(), set) return end
  ord.sel = clamp(ord.sel, 1, #s.ord)
  if btn("a") then
    local d = btnp("up") and 1 or btnp("down") and -1 or btnp("right") and 4 or btnp("left") and -4 or 0
    if d ~= 0 then
      local v = s.ord[ord.sel] + d
      if v > #s.pat then s.pat[#s.pat + 1] = blank(); v = #s.pat end
      s.ord[ord.sel] = clamp(v, 1, #s.pat); touch()
    end
    return
  end
  if btnp("up") then ord.sel = clamp(ord.sel - 1, 1, #s.ord) end
  if btnp("down") then ord.sel = clamp(ord.sel + 1, 1, #s.ord) end
  if pressed("y") then table.insert(s.ord, ord.sel + 1, s.ord[ord.sel]); ord.sel = ord.sel + 1; touch() end
  if pressed("x") and #s.ord > 1 then table.remove(s.ord, ord.sel); ord.sel = clamp(ord.sel, 1, #s.ord); s.loop = clamp(s.loop, 1, #s.ord); touch() end
  if pressed("l") then s.loop = ord.sel; touch() end
  if pressed("b") then cur.pos = ord.sel; SCR = 1 end
end

local IFIELDS = {
  {"WAVE", function(I) return WAVES[(I.w or 0) + 1] end, function(I, d) I.w = (I.w + d) % 6 end},
  {"VOLUME", function(I) return math.floor(I.v * 100 + 0.5) end, function(I, d, b) I.v = clamp(I.v + d * (b and 0.1 or 0.05), 0, 1) end},
  {"ATTACK", function(I) return I.a end, function(I, d, b) I.a = clamp(I.a + d * (b and 10 or 1), 0, 120) end},
  {"DECAY", function(I) return I.d end, function(I, d, b) I.d = clamp(I.d + d * (b and 10 or 1), 0, 120) end},
  {"SUSTAIN", function(I) return math.floor(I.s * 100 + 0.5) end, function(I, d, b) I.s = clamp(I.s + d * (b and 0.1 or 0.05), 0, 1) end},
  {"RELEASE", function(I) return I.r end, function(I, d, b) I.r = clamp(I.r + d * (b and 10 or 1), 0, 120) end},
  {"SWEEP", function(I) return string.format("%.1f", I.sw or 0) end, function(I, d, b) I.sw = clamp((I.sw or 0) + d * (b and 1 or 0.1), -4, 4) end},
  {"VIBRATO", function(I) return string.format("%.2f", I.vb or 0) end, function(I, d) I.vb = clamp((I.vb or 0) + d * 0.05, 0, 2) end},
  {"PAN", function(I) return string.format("%.1f", I.p or 0) end, function(I, d) I.p = clamp((I.p or 0) + d * 0.1, -1, 1) end},
  {"DRUM", function(I) return I.drum and "YES" or "NO" end, function(I) I.drum = not I.drum end},
  {"NOTE", function(I) return nn(I.n or 60) end, function(I, d, b) I.n = clamp((I.n or 60) + d * (b and 12 or 1), 1, 127) end},
}
local function upd_inst()
  local s = S()
  ins.sel = clamp(ins.sel, 1, #s.inst + 1)
  if btnp("left") and not btn("a") then ins.side = false end
  if btnp("right") and not btn("a") and ins.sel <= #s.inst then ins.side = true end
  local I = s.inst[ins.sel]
  if ins.side and I then
    if btn("a") then
      local f = IFIELDS[ins.psel]
      local d = btnp("up") and 1 or btnp("down") and -1 or btnp("right") and 1 or btnp("left") and -1 or 0
      if d ~= 0 then f[3](I, d, btnp("left") or btnp("right")); touch() end
      if pressed("a") or d ~= 0 then music_note(s, ins.sel, I.drum and I.n or 60, 20) end
      return
    end
    if btnp("up") then ins.psel = (ins.psel - 2) % #IFIELDS + 1 end
    if btnp("down") then ins.psel = ins.psel % #IFIELDS + 1 end
    return
  end
  if ins.sel > #s.inst then   -- the add row
    if btn("a") then
      if btnp("up") or btnp("right") then ins.preset = ins.preset % #PRESETS + 1 end
      if btnp("down") or btnp("left") then ins.preset = (ins.preset - 2) % #PRESETS + 1 end
      return
    end
    if pressed("y") and #s.inst < 32 then s.inst[#s.inst + 1] = copy(PRESETS[ins.preset]); touch() end
  else
    if pressed("a") and I then music_note(s, ins.sel, I.drum and I.n or 60, 20); last.inst = ins.sel end
    if pressed("x") and #s.inst > 1 then
      table.remove(s.inst, ins.sel)
      for _, p in ipairs(s.pat) do for c = 1, 8 do for _, cell in pairs(p[c]) do
        if cell[2] == ins.sel then cell[2] = 0 elseif cell[2] > ins.sel then cell[2] = cell[2] - 1 end end end end
      touch()
    end
  end
  if btnp("up") then ins.sel = (ins.sel - 2) % (#s.inst + 1) + 1 end
  if btnp("down") then ins.sel = ins.sel % (#s.inst + 1) + 1 end
end

function _update()
  local s = S()
  cur.pos = clamp(cur.pos, 1, #s.ord); cur.ch = clamp(cur.ch, 1, s.ch); cur.row = clamp(cur.row, 0, s.rows - 1)
  if pressed("select") then SCR = SCR % #SCREENS + 1 end
  if pressed("start") then play_toggle("song", {pos = SCR == 2 and not ord.side and ord.sel or cur.pos}) end
  if SCR == 1 then upd_pattern() elseif SCR == 2 then upd_song() else upd_inst() end
  if PLAY and not music_playing() then PLAY = nil end
  confirm_tick(); lib_tick(); input_end()
end

-- ------------------------------------------------ drawing
local function draw_pattern()
  local s = S()
  local p = P()
  local pp, pr = music_pos()
  local playrow = -1
  if pp and ((PLAY == "loop" and PLAYO.pat == s.ord[cur.pos]) or (PLAY == "song" and pp == cur.pos)) then playrow = pr end
  -- which channels fit: the cursor's in full, the others short
  local first = clamp(cur.ch - 1, 1, math.max(1, s.ch - 3))
  local x, cols = 22, {}
  for c = first, math.min(s.ch, first + 3) do
    cols[#cols + 1] = {c = c, x = x, full = c == cur.ch}
    x = x + (c == cur.ch and 110 or 54)
  end
  text("PAT " .. hx(s.ord[cur.pos] - 1) .. "  POS " .. hx(cur.pos - 1) .. "/" .. hx(#s.ord - 1), 4, 15, 29)
  for _, k in ipairs(cols) do
    local name = string.sub(s.tr[k.c].name or ("CH" .. k.c), 1, k.full and 12 or 6)
    text(name, k.x, 26, k.c == cur.ch and 27 or 28)
  end
  if first > 1 then text("<", 12, 26, 28) end
  if first + 3 < s.ch then text(">", 312, 26, 28) end
  local mid, top = 10, 36
  for i = 0, 19 do
    local r = cur.row - mid + i
    if r >= 0 and r < s.rows then
      local y = top + i * 9
      local bg = r == playrow and 19 or (r % (s.rpb * 4) == 0 and 2 or (r % s.rpb == 0 and 31 or nil))
      if bg then rectfill(0, y - 1, 320, 9, bg) end
      text(hx(r), 2, y, r % s.rpb == 0 and 29 or 30)
      for _, k in ipairs(cols) do
        local cell = p[k.c][r]
        local note = cell and nn(cell[1]) or "---"
        local inst = cell and cell[2] > 0 and hx(cell[2]) or ".."
        if r == cur.row and k.c == cur.ch then
          local fx = ({0, 32, 56, 80, 88})[cur.col]
          rectfill(k.x + fx - 1, y - 1, (cur.col == 1 and 24 or cur.col == 4 and 8 or 16) + 2, 9, 21)
        end
        text(note, k.x, y, cell and cell[1] < 0 and 26 or (cell and cell[1] > 0 and 13 or 30))
        text(inst, k.x + 32, y, cell and cell[2] > 0 and 22 or 30)
        if k.full then
          text(cell and cell[3] >= 0 and hx(cell[3]) or "..", k.x + 56, y, cell and cell[3] >= 0 and 17 or 30)
          text(cell and cell[4] or ".", k.x + 80, y, cell and cell[4] and 10 or 30)
          text(cell and cell[4] and hx(cell[5]) or "..", k.x + 88, y, cell and cell[4] and 10 or 30)
        end
      end
    end
  end
  rect(0, top + mid * 9 - 2, 320, 11, 21)
  -- what the cursor is on
  local c = get()
  local info
  if cur.col == 1 then info = "NOTE " .. (c and nn(c[1]) or "---")
  elseif cur.col == 2 then local I = s.inst[c and c[2] or 0] info = "INSTRUMENT " .. (I and (hx(c[2]) .. " " .. I.name) or "(KEEP)")
  elseif cur.col == 3 then info = "VOLUME " .. (c and c[3] >= 0 and hx(c[3]) or "FULL")
  else info = "EFFECT " .. (c and c[4] and (c[4] .. hx(c[5]) .. " " .. FXNAME[c[4]]) or "NONE") end
  rectfill(0, 214, 320, 12, 1)
  text(info, 4, 216, 27)
  hint("A+DIR EDIT X CLEAR Y LOOP L/R POS")
end

local function draw_song()
  local s = S()
  text("ORDER", 8, 16, 28)
  local pp = PLAY == "song" and music_pos() or nil
  local first = clamp(ord.sel - 8, 1, math.max(1, #s.ord - 16))
  for i = first, math.min(#s.ord, first + 16) do
    local y = 28 + (i - first) * 11
    if i == ord.sel and not ord.side then rectfill(6, y - 2, 92, 11, 2) end
    if i == pp then text(">", 0, y, 17) end
    text(hx(i - 1), 8, y, 29)
    text("PAT " .. hx(s.ord[i] - 1), 32, y, 13)
    if i == s.loop then text("<", 96, y, 27) end
  end
  text("SONG", 120, 16, 28)
  list_draw(song_items(), set.sel, 120, 28, 190, ord.side)
  hint(ord.side and "A+DIR CHANGE  < ORDER" or "A+DIR PAT Y ADD X DEL L LOOP")
end

local function draw_inst()
  local s = S()
  text("INSTRUMENTS", 8, 16, 28)
  local first = clamp(ins.sel - 8, 1, math.max(1, #s.inst + 1 - 16))
  for i = first, math.min(#s.inst + 1, first + 16) do
    local y = 28 + (i - first) * 11
    if i == ins.sel then rectfill(6, y - 2, 116, 11, ins.side and 31 or 2) end
    if i <= #s.inst then
      text(hx(i), 8, y, 22); text(string.sub(s.inst[i].name, 1, 10), 28, y, 13)
    else text("+ " .. PRESETS[ins.preset].name, 8, y, 27) end
  end
  local I = s.inst[ins.sel]
  if I then
    for i, f in ipairs(IFIELDS) do
      local y = 28 + (i - 1) * 11
      if ins.side and i == ins.psel then rectfill(134, y - 2, 182, 11, 2) end
      text(f[1], 136, y, 29)
      local v = tostring(f[2](I))
      text(v, 312 - #v * 8, y, 13)
    end
    hint(ins.side and "A+DIR CHANGE  < LIST" or "A HEAR  X DELETE  > EDIT")
  else
    text("A+UP/DOWN: PICK A SOUND", 136, 28, 29)
    text("Y: ADD IT", 136, 40, 29)
    hint("A+DIR PICK  Y ADD")
  end
end

function _draw()
  cls(1)
  topbar("HEXBEAT", SCREENS, SCR, 27)
  if SCR == 1 then draw_pattern() elseif SCR == 2 then draw_song() else draw_inst() end
end
`;

  /* ------------------------------------------------------------ Loopbox: the loop maker */
  const LOOPBOX = LIB + `
local SCR, SCREENS = 1, {"LOOP", "SONG", "TRACKS"}
local COL = {26, 22, 27, 17, 5, 10, 23, 11}
local cur = {pat = 1, tr = 1, step = 0, note = 60, lane = 1, top = 72}
local LASTLEN, SEL = 2, nil
local arr = {sel = 1}
local trk = {sel = 1}
local function LET(i) return i <= 26 and string.char(64 + i) or tostring(i) end

local function rows_t() local s = S() return s.pat[cur.pat][cur.tr] end
local function drums()
  local l = {}
  for i, I in ipairs(S().inst) do if I.drum then l[#l + 1] = i end end
  return l
end
-- a channel's cells as notes {r, len, n, cell}: a note lasts until the next note or note off
local function notes_of(t, len)
  local ev, out = {}, {}
  for r = 0, len - 1 do local c = t[r] if c and c[1] ~= 0 then ev[#ev + 1] = r end end
  for i, r in ipairs(ev) do
    local c = t[r]
    if c[1] > 0 then out[#out + 1] = {r = r, len = (ev[i + 1] or len) - r, n = c[1], cell = c} end
  end
  return out
end
local function write_notes(t, notes, len)
  for r = 0, len - 1 do local c = t[r] if c and c[1] ~= 0 then if c[4] then c[1] = 0; c[2] = 0 else t[r] = nil end end end
  table.sort(notes, function(a, b) return a.r < b.r end)
  for i, nt in ipairs(notes) do
    local nx = notes[i + 1]
    if not (nx and nx.r == nt.r) and nt.r >= 0 and nt.r < len then
      local old = nt.cell or {}
      t[nt.r] = {nt.n, (old[2] or 0) > 0 and old[2] or nt.inst or 1, old[3] or -1, old[4] or (t[nt.r] and t[nt.r][4]), old[5] or (t[nt.r] and t[nt.r][5]) or 0}
      local e = math.min(nt.r + nt.len, nx and nx.r or len)
      if e < len and (not nx or e < nx.r) then if t[e] then t[e][1] = -1 else t[e] = {-1, 0, -1, nil, 0} end end
    end
  end
end
local function note_at(step, n)
  for _, nt in ipairs(notes_of(rows_t(), S().rows)) do
    if (not n or nt.n == n) and step >= nt.r and step < nt.r + nt.len then return nt end
  end
end

function _init() lib_load() end

local function upd_keys()
  local s, t = S(), rows_t()
  local tr = s.tr[cur.tr]
  if btn("a") then
    if pressed("a") then
      SEL = note_at(cur.step, cur.note)
      if not SEL then
        local notes = notes_of(t, s.rows)
        notes[#notes + 1] = {r = cur.step, len = LASTLEN, n = cur.note, inst = tr.inst or 1}
        write_notes(t, notes, s.rows); touch()
        SEL = note_at(cur.step, cur.note)
      end
      if SEL then music_note(s, SEL.cell[2] > 0 and SEL.cell[2] or tr.inst or 1, SEL.n, 14) end
    end
    if SEL then
      local notes = notes_of(t, s.rows)
      local me
      for _, nt in ipairs(notes) do if nt.r == SEL.r then me = nt end end
      if me then
        local ch = false
        if btnp("right") then me.len = clamp(me.len + 1, 1, s.rows - me.r); LASTLEN = me.len; ch = true end
        if btnp("left") then me.len = clamp(me.len - 1, 1, s.rows - me.r); LASTLEN = me.len; ch = true end
        if btnp("up") then me.n = clamp(me.n + 1, 1, 127); cur.note = me.n; ch = true; music_note(s, me.cell[2], me.n, 10) end
        if btnp("down") then me.n = clamp(me.n - 1, 1, 127); cur.note = me.n; ch = true; music_note(s, me.cell[2], me.n, 10) end
        if ch then write_notes(t, notes, s.rows); SEL = note_at(me.r); touch() end
      end
    end
    return
  end
  SEL = nil
  if btn("b") then
    if btnp("up") then cur.note = clamp(cur.note + 12, 1, 127) end
    if btnp("down") then cur.note = clamp(cur.note - 12, 1, 127) end
    if btnp("left") then cur.step = clamp(cur.step - s.rpb, 0, s.rows - 1) end
    if btnp("right") then cur.step = clamp(cur.step + s.rpb, 0, s.rows - 1) end
    return
  end
  if btn("y") then
    local nt = note_at(cur.step)
    if nt and (btnp("up") or btnp("down")) then
      local v = nt.cell[3] < 0 and 255 or nt.cell[3]
      nt.cell[3] = clamp(v + (btnp("up") and 32 or -32), 15, 255); if nt.cell[3] >= 255 then nt.cell[3] = -1 end touch()
    end
    if btnp("left") then cur.pat = clamp(cur.pat - 1, 1, #s.pat) end
    if btnp("right") then cur.pat = clamp(cur.pat + 1, 1, #s.pat) end
    return
  end
  if btnp("up") then cur.note = clamp(cur.note + 1, 1, 127) end
  if btnp("down") then cur.note = clamp(cur.note - 1, 1, 127) end
  if btnp("left") then cur.step = (cur.step - 1) % s.rows end
  if btnp("right") then cur.step = (cur.step + 1) % s.rows end
  if pressed("x") then
    local nt = note_at(cur.step, cur.note) or note_at(cur.step)
    if nt then
      local notes = notes_of(t, s.rows)
      for i, x in ipairs(notes) do if x.r == nt.r then table.remove(notes, i) break end end
      write_notes(t, notes, s.rows); touch()
    end
  end
end

local function upd_drums()
  local s, t, lanes = S(), rows_t(), drums()
  cur.lane = clamp(cur.lane, 1, math.max(1, #lanes))
  local k = lanes[cur.lane]
  local function hit(on)
    if not k then return end
    local c = t[cur.step]
    if on then t[cur.step] = {s.inst[k].n or 60, k, c and c[3] or -1, c and c[4], c and c[5] or 0}; music_note(s, k, s.inst[k].n or 60, 12)
    elseif c and c[2] == k then if c[4] then c[1] = 0; c[2] = 0 else t[cur.step] = nil end end
    touch()
  end
  if btn("a") then
    if pressed("a") then local c = t[cur.step] hit(not (c and c[1] > 0 and c[2] == k)) end
    if btnp("right") then cur.step = (cur.step + 1) % s.rows; hit(true) end
    if btnp("left") then cur.step = (cur.step - 1) % s.rows; hit(true) end
    return
  end
  if btn("y") then
    local c = t[cur.step]
    if c and c[1] > 0 and (btnp("up") or btnp("down")) then
      local v = c[3] < 0 and 255 or c[3]
      c[3] = clamp(v + (btnp("up") and 32 or -32), 15, 255); if c[3] >= 255 then c[3] = -1 end touch()
    end
    if btnp("left") then cur.pat = clamp(cur.pat - 1, 1, #s.pat) end
    if btnp("right") then cur.pat = clamp(cur.pat + 1, 1, #s.pat) end
    return
  end
  if btnp("up") then cur.lane = clamp(cur.lane - 1, 1, math.max(1, #lanes)) end
  if btnp("down") then cur.lane = clamp(cur.lane + 1, 1, math.max(1, #lanes)) end
  if btnp("left") then cur.step = (cur.step - 1) % s.rows end
  if btnp("right") then cur.step = (cur.step + (btn("b") and s.rpb or 1)) % s.rows end
  if pressed("x") then hit(false) end
end

local function upd_song()
  local s = S()
  arr.sel = clamp(arr.sel, 1, #s.ord)
  if btn("a") then
    local d = btnp("up") and 1 or btnp("down") and -1 or 0
    if d ~= 0 then
      local v = s.ord[arr.sel] + d
      if v > #s.pat then s.pat[#s.pat + 1] = blank(); v = #s.pat end
      s.ord[arr.sel] = clamp(v, 1, #s.pat); touch()
    end
    if btnp("right") and arr.sel < #s.ord then s.ord[arr.sel], s.ord[arr.sel + 1] = s.ord[arr.sel + 1], s.ord[arr.sel]; arr.sel = arr.sel + 1; touch() end
    if btnp("left") and arr.sel > 1 then s.ord[arr.sel], s.ord[arr.sel - 1] = s.ord[arr.sel - 1], s.ord[arr.sel]; arr.sel = arr.sel - 1; touch() end
    return
  end
  if btnp("left") then arr.sel = clamp(arr.sel - 1, 1, #s.ord) end
  if btnp("right") then arr.sel = clamp(arr.sel + 1, 1, #s.ord) end
  if btnp("up") then arr.sel = clamp(arr.sel - 8, 1, #s.ord) end
  if btnp("down") then arr.sel = clamp(arr.sel + 8, 1, #s.ord) end
  if pressed("y") then table.insert(s.ord, arr.sel + 1, s.ord[arr.sel]); arr.sel = arr.sel + 1; touch() end
  if pressed("x") and #s.ord > 1 then table.remove(s.ord, arr.sel); arr.sel = clamp(arr.sel, 1, #s.ord); s.loop = clamp(s.loop, 1, #s.ord); touch() end
  if pressed("l") then s.loop = arr.sel; touch() end
  if pressed("r") then   -- a copy of this loop, to change without changing the first
    local p = copy(s.pat[s.ord[arr.sel]]); s.pat[#s.pat + 1] = p; s.ord[arr.sel] = #s.pat; touch()
  end
  if pressed("b") then cur.pat = s.ord[arr.sel]; SCR = 1 end
end

local function track_items()
  local s, items = S(), {}
  for c = 1, s.ch do
    local tr = s.tr[c]
    items[#items + 1] = {string.sub(tr.name, 1, 6) .. " " .. (tr.kind == "drums" and "DRUMS" or "KEYS") .. (MUSIC.mute[c] and " MUTE" or ""),
      function() return tr.kind == "drums" and "" or string.sub((s.inst[tr.inst] or {name = "?"}).name, 1, 8) end,
      function(d) tr.inst = (tr.inst - 1 + d) % #s.inst + 1; music_note(s, tr.inst, 60, 14); touch() end, nil, c}
  end
  for _, it in ipairs(song_items("TRACKS")) do items[#items + 1] = it end
  return items
end
local function upd_tracks()
  local items = track_items()
  local it = items[trk.sel]
  if it and it[5] and not btn("a") then
    local tr = S().tr[it[5]]
    if pressed("y") then tr.kind = tr.kind == "drums" and "keys" or "drums"; touch() end
    if pressed("x") then MUSIC.mute[it[5]] = not MUSIC.mute[it[5]] or nil end
  end
  list_input(items, trk)
end

function _update()
  local s = S()
  cur.pat = clamp(cur.pat, 1, #s.pat); cur.tr = clamp(cur.tr, 1, s.ch); cur.step = clamp(cur.step, 0, s.rows - 1)
  if pressed("select") then SCR = SCR % #SCREENS + 1 end
  if SCR == 1 then
    if pressed("start") then play_toggle("loop", {pat = cur.pat}) end
    if btnp("l") then cur.tr = (cur.tr - 2) % s.ch + 1 end
    if btnp("r") then cur.tr = cur.tr % s.ch + 1 end
    if s.tr[cur.tr].kind == "drums" then upd_drums() else upd_keys() end
  elseif SCR == 2 then
    if pressed("start") then play_toggle("song", {pos = arr.sel}) end
    upd_song()
  else
    if pressed("start") then play_toggle("song", {pos = 1}) end
    upd_tracks()
  end
  if PLAY and not music_playing() then PLAY = nil end
  confirm_tick(); lib_tick(); input_end()
end

-- ------------------------------------------------ drawing
local GX, GY = 28, 26
local function grid_geom(s)
  local vis = math.min(s.rows, 32)
  local sw = (316 - GX) // vis
  local first = clamp(cur.step - vis // 2, 0, s.rows - vis)
  return vis, sw, first
end
local function steps_bg(s, vis, sw, first, y0, h, dark)
  for i = 0, vis - 1 do
    local r = first + i
    rectfill(GX + i * sw, y0, sw - 1, h, r % (s.rpb * 4) == 0 and 3 or (r % s.rpb == 0 and 2 or (dark and 1 or 31)))
  end
end
local function playhead(s, vis, sw, first, y0, h)
  local p, r = music_pos()
  if not p then return end
  local pat = PLAY == "loop" and PLAYO.pat or s.ord[p]
  if pat == cur.pat and r >= first and r < first + vis then rectfill(GX + (r - first) * sw, y0, 1, h, 13) end
end

local function draw_keys()
  local s, t = S(), rows_t()
  local vis, sw, first = grid_geom(s)
  local lanes, lh = 22, 8
  if cur.note > cur.top + lanes - 1 then cur.top = cur.note - lanes + 1 end
  if cur.note < cur.top then cur.top = cur.note end
  local y0 = GY
  for i = 0, lanes - 1 do
    local n = cur.top + lanes - 1 - i
    local y = y0 + i * lh
    local black = ({false, true, false, true, false, false, true, false, true, false, true, false})[n % 12 + 1]
    rectfill(0, y, GX - 2, lh - 1, black and 30 or 29)
    if n % 12 == 0 then text("C" .. (n // 12 - 1), 1, y, 1) end
    steps_bg(s, vis, sw, first, y, lh - 1, black)
  end
  -- the other key tracks, faint
  for c = 1, s.ch do
    if c ~= cur.tr and s.tr[c].kind ~= "drums" then
      for _, nt in ipairs(notes_of(s.pat[cur.pat][c], s.rows)) do
        local i = cur.top + lanes - 1 - nt.n
        if i >= 0 and i < lanes then
          local a, b = math.max(nt.r, first), math.min(nt.r + nt.len, first + vis)
          if b > a then rectfill(GX + (a - first) * sw, y0 + i * lh + 3, (b - a) * sw - 1, 2, 30) end
        end
      end
    end
  end
  local col = COL[(cur.tr - 1) % 8 + 1]
  for _, nt in ipairs(notes_of(t, s.rows)) do
    local i = cur.top + lanes - 1 - nt.n
    if i >= 0 and i < lanes then
      local a, b = math.max(nt.r, first), math.min(nt.r + nt.len, first + vis)
      if b > a then
        rectfill(GX + (a - first) * sw, y0 + i * lh, (b - a) * sw - 1, lh - 1, col)
        if nt.cell[3] >= 0 and nt.cell[3] < 160 then rect(GX + (a - first) * sw, y0 + i * lh, (b - a) * sw - 1, lh - 1, 1) end
      end
    end
  end
  playhead(s, vis, sw, first, y0, lanes * lh)
  local ci = cur.top + lanes - 1 - cur.note
  rect(GX + (cur.step - first) * sw - 1, y0 + ci * lh - 1, sw + 1, lh + 1, 13)
  local nt = note_at(cur.step)
  rectfill(0, 214, 320, 12, 1)
  text(nn(cur.note) .. "  STEP " .. (cur.step + 1) .. (nt and ("  LEN " .. nt.len .. "  VEL " .. (nt.cell[3] < 0 and "FF" or hx(nt.cell[3]))) or ""), 4, 216, 27)
  hint(SEL and "A+</> LENGTH  A+UP/DN PITCH" or "A NOTE X DEL B+DIR JUMP Y+</> LOOP")
end

local function draw_drums()
  local s, t, lanes = S(), rows_t(), drums()
  local vis, sw, first = grid_geom(s)
  local lh = math.min(22, 180 // math.max(1, #lanes))
  if #lanes == 0 then text("NO DRUM SOUNDS IN THIS SONG", 30, 80, 29) text("ADD ONE ON TRACKS OR IN HEXBEAT", 30, 92, 29) end
  local col = COL[(cur.tr - 1) % 8 + 1]
  for i, k in ipairs(lanes) do
    local y = GY + (i - 1) * lh
    text(string.sub(S().inst[k].name, 1, 3), 2, y + lh // 2 - 4, i == cur.lane and 13 or 29)
    steps_bg(s, vis, sw, first, y, lh - 2)
    for j = 0, vis - 1 do
      local c = t[first + j]
      if c and c[1] > 0 and c[2] == k then
        rectfill(GX + j * sw + 1, y + 1, sw - 3, lh - 4, (c[3] >= 0 and c[3] < 160) and 30 or col)
      end
    end
  end
  playhead(s, vis, sw, first, GY, #lanes * lh)
  if #lanes > 0 then rect(GX + (cur.step - first) * sw - 1, GY + (cur.lane - 1) * lh - 1, sw + 1, lh, 13) end
  rectfill(0, 214, 320, 12, 1)
  text("STEP " .. (cur.step + 1) .. "  " .. ((lanes[cur.lane] and S().inst[lanes[cur.lane]].name) or ""), 4, 216, 27)
  hint("A HIT  A+</> PAINT  X CLEAR  Y+</> LOOP")
end

local function draw_loop()
  local s = S()
  local tr = s.tr[cur.tr]
  rectfill(0, 13, 320, 11, 1)
  text("LOOP " .. LET(cur.pat), 4, 15, 27)
  text(string.sub(tr.name, 1, 8), 80, 15, COL[(cur.tr - 1) % 8 + 1])
  text("L/R TRACK", 240, 15, 30)
  if tr.kind == "drums" then draw_drums() else draw_keys() end
end

local function mini(p, x, y, w, h, s)
  rectfill(x, y, w, h, 31)
  local lh = math.max(1, h // s.ch)
  for c = 1, s.ch do
    for r, cell in pairs(p[c]) do
      if cell[1] > 0 then pset(x + r * w // s.rows, y + (c - 1) * lh + lh // 2, COL[(c - 1) % 8 + 1]) end
    end
  end
end
local function draw_song()
  local s = S()
  text("SONG: " .. string.sub(s.name, 1, 16), 8, 16, 28)
  local pp = PLAY == "song" and music_pos() or nil
  for i, pi in ipairs(s.ord) do
    local x, y = 8 + ((i - 1) % 8) * 38, 30 + ((i - 1) // 8) * 40
    if y < 200 then
      if i == arr.sel then rectfill(x - 2, y - 2, 38, 38, 21) end
      rectfill(x, y, 34, 34, i == pp and 15 or 2)
      text(LET(pi), x + 3, y + 3, 13)
      if i == s.loop then text("<", x + 25, y + 3, 27) end
      mini(s.pat[pi], x + 2, y + 14, 30, 18, s)
    end
  end
  hint("A+UD LOOP Y ADD X DEL R COPY L LOOP")
end
local function draw_tracks()
  text("TRACKS AND SONG", 8, 16, 28)
  local items = track_items()
  local first = clamp(trk.sel - 8, 1, math.max(1, #items - 16))
  local vis = {}
  for i = first, math.min(#items, first + 16) do vis[#vis + 1] = items[i] end
  list_draw(vis, trk.sel - first + 1, 10, 30, 300, true)
  local it = items[trk.sel]
  hint(it and it[5] and "A+DIR SOUND  Y KEYS/DRUMS  X MUTE" or "A+DIR CHANGE  A DO IT")
end

function _draw()
  cls(1)
  topbar("LOOPBOX", SCREENS, SCR, 22)
  if SCR == 1 then draw_loop() elseif SCR == 2 then draw_song() else draw_tracks() end
end
`;

  // 16x16 icons: one character per pixel, '.' transparent, others palette colours
  const PAL = { '.': 0, k: 1, w: 13, y: 27, o: 10, b: 21, l: 22, g: 17, p: 4, d: 31, r: 26, c: 12 };
  function icon(rows) { return rows.map(r => [...r].map(ch => PAL[ch] || 0)); }
  const HEXBEAT_ICON = icon([
    'dddddddddddddddd', 'dyyyyyyyyyyyyyyd', 'dkkkkkkkkkkkkkkd', 'dkwwkbbkgkwwkbbd', 'dkkkkkkkkkkkkkkd', 'dkokkkkkkkokkkkd', 'dkkkkkkkkkkkkkkd',
    'dywwywwywwywwyyd', 'dkkkkkkkkkkkkkkd', 'dkwwkbbkgkkkkkkd', 'dkkkkkkkkkkkkkkd', 'dkkkkkkkkkwwkbbd', 'dkokkkkkkkkkkkkd', 'dkkkkkkkkkkkkkkd',
    'dkwwkbbkgkokkkkd', 'dddddddddddddddd']);
  const LOOPBOX_ICON = icon([
    '................', '.dddddddddddddd.', '.dkkkkkkkkkkkkd.', '.dkrrrkkkkkkkkd.', '.dkkkkllllkkkkd.', '.dkkkkkkkkggkkd.', '.dkyykkkkkkkkkd.',
    '.dkkkkkkpppkkkd.', '.dkkkkkkkkkkkkd.', '.ddddddddddddddd', '.dwkwkwkwkwkwkd.', '.dwkwkwkwkwkwkd.', '.dwwwwwwwwwwwwd.', '.dwwwwwwwwwwwwd.',
    '.dddddddddddddd.', '................']);

  window.BK_APPS = [
    { name: 'Hexbeat', code: HEXBEAT, icon: HEXBEAT_ICON, saveKey: 'Music', about: 'A tracker: rows of notes and hex effects, played with buttons.' },
    { name: 'Loopbox', code: LOOPBOX, icon: LOOPBOX_ICON, saveKey: 'Music', about: 'Loops, a piano roll and a drum grid, played with buttons.' },
  ];
})();
