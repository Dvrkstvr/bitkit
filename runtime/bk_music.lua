
-- ---------------------------------------------------------------- music
-- Songs made with the studio's Tracker (Hexbeat) and Loops (Loopbox) tabs, or with the Bit's music apps.
-- They all share one song format, so any song plays in any game:
--   music(n)              play SONGS[n] (or music("name"), or music(song_table)); loops back to song.loop
--   music(n, {loop = false, pos = 1, row = 0, pat = p})   play once / start somewhere / loop one pattern
--   music_stop([frames])  stop, or fade out over that many frames
--   music_pos()           order position (from 1), row (from 0), or nil when nothing plays
--   music_playing()       the song table that is playing, or nil
--   music_note(song, inst, note, [frames])  play one note with a song's instrument (editors, jingles)
-- Music uses the top channels (a 4-channel song plays on channels 7, 6, 5 and 4), so sfx() keeps the rest.
-- The Music and Volume settings of the game shell turn it down.
--
-- A song: {name, bpm = 120, rpb = 4 (rows per beat), rows = 32 (rows per pattern), ch = 4 (channels),
--   loop = 1 (order position to loop to), inst = {instrument, ...}, pat = {pattern, ...}, ord = {pattern number, ...}}
-- An instrument: {name, w = wave (0 square, 1 triangle, 2 saw, 3 noise, 4 sine, 5 thin pulse), v = volume 0..1,
--   a = attack, d = decay (frames), s = sustain level 0..1, r = release (frames), sw = pitch sweep (semitones a frame),
--   vb = vibrato depth (semitones), p = pan -1..1, n = the note it plays on a drum grid}
-- A pattern: one entry per channel, each a string of 11-character cells "RRNNIIVVFPP":
--   RR row, NN note (01-7F MIDI, FF note off), II instrument (00 keep), VV volume 00-FF (.. none),
--   F effect letter (. none) and PP its value, all in hex. (A decoded channel is a table row -> {note, inst, vol, fx, fv}.)
-- Effects: A arpeggio xy, U slide up, D slide down, G glide to the note, V vibrato xy (speed, depth), W volume up x down y,
--   P pan (00 left, 80 middle, FF right), C cut after PP frames, R retrigger every PP frames, S tempo (bpm),
--   J jump to order position PP (from 00), B break to the next pattern.
-- MIT License.
SONGS = SONGS or {}
MUSIC = { mute = {} }

local HW = 8
local M = nil          -- the song that is playing
local PREVIEW = nil    -- music_note()
local FX_ROW = { S = true, J = true, B = true, P = true }

local function hz(n) return 440 * 2 ^ ((n - 69) / 12) end
local function clamp(v, a, b) if v < a then return a elseif v > b then return b end return v end

function music_cells(str)
  if type(str) ~= "string" then return str or {} end
  local t = {}
  for i = 1, #str - 10, 11 do
    local nn, vv, fx = str:sub(i + 2, i + 3), str:sub(i + 6, i + 7), str:sub(i + 8, i + 8)
    t[tonumber(str:sub(i, i + 1), 16)] = { nn == "FF" and -1 or (tonumber(nn, 16) or 0), tonumber(str:sub(i + 4, i + 5), 16) or 0,
      vv == ".." and -1 or (tonumber(vv, 16) or -1), fx ~= "." and fx or nil, tonumber(str:sub(i + 9, i + 10), 16) or 0 }
  end
  return t
end
-- the other way: rows -> packed string (the Bit's apps save songs like this)
function music_pack(rows, len)
  local out = {}
  for r = 0, (len or 256) - 1 do
    local c = rows[r]
    if c and (c[1] ~= 0 or (c[2] or 0) ~= 0 or (c[3] or -1) >= 0 or c[4]) then
      out[#out + 1] = string.format("%02X%02X%02X%s%s%02X", r, c[1] < 0 and 255 or c[1], c[2] or 0,
        (c[3] or -1) < 0 and ".." or string.format("%02X", c[3]), c[4] or ".", c[5] or 0)
    end
  end
  return table.concat(out)
end

local function chan(song, p, c)
  local pat = song.pat[p]
  if not pat then return nil end
  local v = pat[c]
  if type(v) == "string" then v = music_cells(v); pat[c] = v end
  return v
end
local function find(n)
  if type(n) == "table" then return n end
  if type(n) == "string" then for _, s in ipairs(SONGS) do if s.name == n then return s end end return nil end
  return SONGS[n]
end
local function level()
  local v, m = 10, 10
  if setting then v = setting("volume") or 10; m = setting("music") or 10 end
  return v / 10 * m / 10
end

local function trigger(c, song, note, inst)
  local I = song.inst[inst] or song.inst[c.inst] or {}
  c.inst = song.inst[inst] and inst or c.inst
  c.I = I
  c.note, c.bend, c.age = note, 0, 0
  c.stage, c.env = "a", c.env or 0
  if (I.a or 0) <= 0 then c.env = 1; c.stage = "d" end
  c.vph = 0
end
local function release(c)
  if c.stage and c.stage ~= "r" then
    c.stage = "r"
    local r = c.I and c.I.r or 0
    c.rstep = r > 0 and c.env / r or 1
  end
end

-- one channel, one frame: envelope, effects, then the voice
local function step(c, hw, gain, tick)
  local I = c.I
  if not I or not c.stage then voice(hw, 1, 0) return end
  local fx, fv = c.fx, c.fv or 0
  -- envelope
  if c.stage == "a" then c.env = c.env + 1 / math.max(1, I.a or 0); if c.env >= 1 then c.env = 1; c.stage = "d" end
  elseif c.stage == "d" then
    local s, d = I.s or 1, I.d or 0
    if d <= 0 then c.env = s else c.env = c.env - (1 - s) / d end
    if c.env <= s then c.env = s; c.stage = "s" end
  elseif c.stage == "r" then c.env = c.env - c.rstep end
  if c.stage == "s" and (I.s or 1) <= 0 then c.env = 0 end
  if c.env <= 0 and c.stage ~= "a" then c.env = 0; c.stage = nil; voice(hw, 1, 0) return end
  -- effects that run every frame
  local semi, x, y = 0, fv // 16, fv % 16
  if fx == "A" then semi = ({ 0, x, y })[tick % 3 + 1]
  elseif fx == "U" then c.bend = c.bend + fv / 16
  elseif fx == "D" then c.bend = c.bend - fv / 16
  elseif fx == "G" and c.target then
    local d = c.target - c.note
    local sp = math.max(fv, 1) / 16
    if math.abs(d) <= sp then c.note = c.target else c.note = c.note + (d > 0 and sp or -sp) end
  elseif fx == "V" then c.vph = c.vph + x * 0.05; semi = math.sin(c.vph * 6.2832) * y / 8
  elseif fx == "W" then c.vol = clamp(c.vol + (x - y) / 64, 0, 1)
  elseif fx == "C" and tick >= fv then c.env = 0; c.stage = nil; voice(hw, 1, 0) return
  elseif fx == "R" and fv > 0 and tick > 0 and tick % fv == 0 then c.env = (I.a or 0) > 0 and 0 or 1; c.stage = (I.a or 0) > 0 and "a" or "d"; c.age = 0 end
  if (I.vb or 0) > 0 then semi = semi + math.sin(c.age * 0.35) * I.vb * math.min(1, c.age / 20) end
  local n = c.note + c.bend + semi + (I.sw or 0) * c.age
  c.age = c.age + 1
  local pan = c.pan or I.p or 0
  voice(hw, hz(clamp(n, 1, 135)), clamp((I.v or 0.8) * c.vol * c.env * gain, 0, 1), I.w or 0, pan)
end

local function row_start()
  local s = M.song
  local p = M.pat or s.ord[M.pos]
  M.jump = nil
  for i = 1, s.ch or 4 do
    local c = M.ch[i]
    local rows = chan(s, p, i)
    local cell = rows and rows[M.row]
    c.fx, c.fv, c.target = nil, 0, nil
    if cell then
      local note, inst, vol, fx, fv = cell[1], cell[2], cell[3], cell[4], cell[5] or 0
      c.fx, c.fv = fx, fv
      if note > 0 then
        if fx == "G" and c.stage then c.target = note
        else trigger(c, s, note, inst); c.vol = 1 end
      elseif note < 0 then release(c) end
      if inst > 0 and note == 0 and s.inst[inst] then c.inst = inst end
      if vol >= 0 then c.vol = vol / 255 end
      if fx == "P" then c.pan = (fv - 128) / 127 end
      if fx == "S" and fv > 0 then M.bpm = fv end
      if fx == "J" then M.jump = fv + 1 end
      if fx == "B" then M.jump = (M.pat and M.pos or M.pos + 1) end
    end
  end
end

local function next_row()
  local s = M.song
  if M.jump then
    M.row = 0
    if not M.pat then M.pos = M.jump end
  else
    M.row = M.row + 1
    if M.row >= (s.rows or 32) then M.row = 0; if not M.pat then M.pos = M.pos + 1 end end
  end
  if not M.pat and M.pos > #s.ord then
    if M.once then music_stop() return false end
    M.pos = clamp(s.loop or 1, 1, #s.ord)
  end
  return true
end

function music(n, o)
  if n == nil or n == 0 then music_stop() return end
  local s = find(n)
  if not s then error("music: no song " .. tostring(n), 2) end
  o = o or {}
  if M then for i = 1, HW do if M.ch[i] then voice(HW - i, 1, 0) end end end
  s.inst, s.pat, s.ord = s.inst or {}, s.pat or {}, s.ord or { 1 }
  if #s.ord == 0 then s.ord = { 1 } end
  M = { song = s, pos = clamp(o.pos or 1, 1, #s.ord), row = o.row or 0, t = 0, tick = 0, bpm = s.bpm or 120,
    pat = o.pat, once = o.loop == false, ch = {}, fade = 1, fstep = 0 }
  for i = 1, math.min(s.ch or 4, HW) do M.ch[i] = { inst = 1, vol = 1, env = 0, bend = 0, note = 60, age = 0, vph = 0 } end
  row_start()
end
-- swap in an edited copy of the playing song (editors), keeping the place and the notes that sound
function music_swap(s)
  if not M then return end
  M.song = s
  for i = 1, math.min(s.ch or 4, HW) do M.ch[i] = M.ch[i] or { inst = 1, vol = 1, env = 0, bend = 0, note = 60, age = 0, vph = 0 } end
  for i = (s.ch or 4) + 1, HW do if M.ch[i] then voice(HW - i, 1, 0); M.ch[i] = nil end end
  if not M.pat and M.pos > #s.ord then M.pos = 1 end
  if M.row >= (s.rows or 32) then M.row = 0 end
end
function music_stop(frames)
  if not M then return end
  if frames and frames > 0 then M.fstep = M.fade / frames return end
  for i = 1, HW do if M.ch[i] then voice(HW - i, 1, 0) end end
  M = nil
end
function music_pos() if M then return M.pos, M.row end return nil end
function music_playing() return M and M.song or nil end
function music_note(s, inst, note, frames)
  s = find(s)
  if not s then return end
  PREVIEW = PREVIEW or { inst = 1, vol = 1, env = 0, bend = 0, note = 60, age = 0, vph = 0 }
  trigger(PREVIEW, s, note, inst)
  PREVIEW.vol, PREVIEW.left, PREVIEW.fx = 1, frames or 12, nil
end

function _bk_music_tick()
  local g = level()
  if PREVIEW then
    PREVIEW.left = PREVIEW.left - 1
    if PREVIEW.left == 0 then release(PREVIEW) end
    step(PREVIEW, 0, g, 0)
    if not PREVIEW.stage then PREVIEW = nil end
  end
  if not M then return end
  local s = M.song
  for i = 1, #M.ch do step(M.ch[i], HW - i, MUSIC.mute[i] and 0 or g * M.fade, M.tick) end
  if M.fstep > 0 then M.fade = M.fade - M.fstep; if M.fade <= 0 then music_stop() return end end
  M.tick = M.tick + 1
  M.t = M.t + 1
  local rowt = 3600 / (clamp(M.bpm, 20, 400) * clamp(s.rpb or 4, 1, 16))
  if M.t >= rowt then
    M.t = M.t - rowt
    M.tick = 0
    if next_row() then row_start() end
  end
end

do
  local overlay = _bk_overlay
  function _bk_overlay()
    _bk_music_tick()
    if overlay then overlay() end
  end
end
