/* Bit themes: the look and feel of a PocketBit's own screens, so every Bit can be its owner's.
   A theme is a small table (colours, wallpaper, letters, cards, bars, sounds, boot animation, screen look):
     { name = "POCKET", c = {bg = "1b1b2f", ...16 colours}, wall = "stars", speed = 5, pic = "", font = "classic", outline = false,
       card = "frame", bar = "solid", sound = "blip", boot = "rise", boottext = "", look = "game" }
   The Bit keeps the one in use (and up to four of its owner's own) in the save file "Bit theme": {theme = T, mine = {T, ...}}.
   Everything that draws a theme is Lua (LIB below), shared by the home screen (studio/home.js), the boot screen and
   the Themes app, so the same code runs in the studio and on the ESP32-S3. File format and device notes: docs/THEMES.md.
   MIT License. */
'use strict';
window.BKThemes = (function () {
  const KEYS = ['bg', 'wall', 'wall2', 'card', 'edge', 'shade', 'accent', 'text', 'dim', 'bar', 'bartext', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const KEY_NAMES = {
    bg: 'Background', wall: 'Wallpaper 1', wall2: 'Wallpaper 2', card: 'Cards', edge: 'Card edge', shade: 'Card shadow',
    accent: 'Accent', text: 'Text', dim: 'Soft text', bar: 'Bars', bartext: 'Bar text',
    p1: 'Paint 1', p2: 'Paint 2', p3: 'Paint 3', p4: 'Paint 4', p5: 'Paint 5',
  };
  const LISTS = {
    wall: ['stars', 'hills', 'waves', 'grid', 'bubbles', 'rain', 'checks', 'aurora', 'plain', 'picture'],
    font: ['classic', 'bold', 'slant', 'heavy'],
    card: ['frame', 'round', 'shadow', 'outline', 'ticket'],
    bar: ['solid', 'line', 'float', 'none'],
    sound: ['blip', 'soft', 'chime', 'retro', 'clack', 'mute'],
    boot: ['rise', 'pixels', 'scan', 'bounce', 'type', 'none'],
    look: ['game', 'off', 'crt', 'arcade', 'old tv', 'handheld', 'sepia', 'night', 'vivid'],
  };
  const PIC_W = 80, PIC_H = 60;
  const paints = 'p1 p2 p3 p4 p5'.split(' ');
  function preset(name, c, rest) {
    const o = { name, c: {}, wall: 'stars', speed: 5, pic: '', font: 'classic', outline: false, card: 'frame', bar: 'solid', sound: 'blip', boot: 'rise', boottext: '', look: 'game' };
    const extra = ['000000', 'ffffff', 'e8504a', 'ffd23f', '3a86d0'];
    KEYS.forEach((k, i) => { o.c[k] = c[i] || extra[paints.indexOf(k)] || '000000'; });
    return Object.assign(o, rest);
  }
  //                  bg        wall      wall2     card      edge      shade     accent    text      dim       bar       bartext
  const PRESETS = [
    preset('POCKET', ['1b1b2f', 'a8a8b8', '4a4a5a', '0f2a4a', '3a86d0', '2a2a36', '6ec3f0', 'ffffff', '7a7a8a', '2a2a36', 'ffffff']),
    preset('MEADOW', ['bfe8ff', '4fa04a', '8ad35a', 'fff3d6', '8f3f2e', '2f6b3a', 'ffd23f', '2d1e1e', '5a2f2a', '2f6b3a', 'fff3d6'],
      { wall: 'hills', speed: 3, font: 'bold', card: 'round', bar: 'float', sound: 'soft', boot: 'bounce' }),
    preset('NEON DRIVE', ['0d0221', 'ff2a6d', 'ffb347', '1a0b3b', 'ff2a6d', '05d9e8', '05d9e8', 'fdf5ff', 'b388eb', '0d0221', '05d9e8'],
      { wall: 'grid', speed: 6, font: 'slant', card: 'outline', bar: 'line', sound: 'retro', boot: 'scan', look: 'arcade' }),
    preset('DEEP SEA', ['031b2e', '0e4d6e', '6ec3f0', '0a2f47', '2fb5a7', '021220', 'f7d070', 'e8fbff', '7fb8c9', '021220', 'e8fbff'],
      { wall: 'bubbles', speed: 4, card: 'round', bar: 'float', sound: 'soft', boot: 'rise' }),
    preset('PAPER', ['f3ead7', 'e9dcc0', 'd8c7a1', 'fffaf0', '3b3024', 'b8a582', 'd9472b', '3b3024', '8a7a62', '3b3024', 'f3ead7'],
      { wall: 'checks', speed: 1, card: 'ticket', bar: 'solid', sound: 'clack', boot: 'type' }),
    preset('NIGHT RAIN', ['141418', '3a3f58', '8a93b8', '22232c', 'e0a458', '0a0a0d', 'e0a458', 'f1ece2', '8d8a85', '0e0e11', 'e0a458'],
      { wall: 'rain', speed: 5, font: 'heavy', card: 'shadow', bar: 'line', sound: 'chime', boot: 'pixels' }),
    preset('AURORA', ['06101f', '3dd68c', '8f6cf0', '0d1d33', '3dd68c', '040a14', 'f2f4ff', 'f2f4ff', '8fa3c0', '06101f', 'f2f4ff'],
      { wall: 'aurora', speed: 4, card: 'frame', bar: 'none', sound: 'chime', boot: 'rise', look: 'night' }),
    preset('PEA SOUP', ['c4cfa1', 'aab585', '8b956d', 'c4cfa1', '1f1f1f', '4d533c', '4d533c', '1f1f1f', '4d533c', '4d533c', 'c4cfa1'],
      { wall: 'plain', speed: 0, font: 'bold', card: 'shadow', bar: 'solid', sound: 'retro', boot: 'type', look: 'handheld' }),
  ];

  // a JS value as a Lua literal (strings, numbers, booleans, arrays and tables with name keys)
  function toLua(v) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '0';
    if (typeof v === 'string') return '"' + v.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/[\x00-\x1f\x7f-\uffff]/g, '?') + '"';
    if (Array.isArray(v)) return '{' + v.map(toLua).join(', ') + '}';
    return '{' + Object.keys(v).filter(k => /^[A-Za-z_]\w*$/.test(k)).map(k => k + ' = ' + toLua(v[k])).join(', ') + '}';
  }

  // the same checks as theme_fix() in Lua: anything missing or wrong comes from POCKET
  const isHex = s => typeof s === 'string' && /^[0-9a-fA-F]{6}$/.test(s);
  function fix(t) {
    const base = PRESETS[0], o = JSON.parse(JSON.stringify(base));
    if (!t || typeof t !== 'object') return o;
    o.name = typeof t.name === 'string' && t.name.trim() ? t.name.toUpperCase().replace(/[^\x20-\x7e]/g, '').slice(0, 16) : 'MY THEME';
    KEYS.forEach(k => { if (t.c && isHex(t.c[k])) o.c[k] = t.c[k].toLowerCase(); });
    Object.keys(LISTS).forEach(k => { if (LISTS[k].includes(t[k])) o[k] = t[k]; });
    o.speed = Math.max(0, Math.min(10, Math.floor(+t.speed))); if (!isFinite(o.speed)) o.speed = base.speed;
    o.outline = t.outline === true;
    o.pic = typeof t.pic === 'string' && /^[0-9a-fg-z]*$/.test(t.pic) ? t.pic : '';
    o.boottext = typeof t.boottext === 'string' ? t.boottext.toUpperCase().replace(/[^\x20-\x7e]/g, '').slice(0, 16) : '';
    return o;
  }

  // wallpaper pictures: 80x60 pixels, each 0-15 (the theme's 16 colours), run-length coded:
  // a hex digit is a pixel, letters g-z after it are how many times it repeats (base 20)
  const RUN = 'ghijklmnopqrstuvwxyz';
  function picDecode(s) {
    const px = new Uint8Array(PIC_W * PIC_H);
    let i = 0, n = 0;
    s = s || '';
    while (i < s.length && n < px.length) {
      const c = parseInt(s[i++], 16);
      if (isNaN(c)) continue;
      let r = 0, m = false;
      while (i < s.length && RUN.includes(s[i])) { r = r * 20 + RUN.indexOf(s[i++]); m = true; }
      if (!m) r = 1;
      for (let k = 0; k < r && n < px.length; k++) px[n++] = c;
    }
    return px;
  }
  function picEncode(px) {
    let out = '';
    for (let i = 0; i < px.length;) {
      let j = i;
      while (j + 1 < px.length && px[j + 1] === px[i]) j++;
      let r = j - i + 1, d = '';
      if (r > 1) while (r > 0) { d = RUN[r % 20] + d; r = Math.floor(r / 20); }
      out += px[i].toString(16) + d;
      i = j + 1;
    }
    return out;
  }

  /* ------------------------------------------------------------------ Lua shared by home, boot and the Themes app */
  const LIB = `
-- Bit themes (studio/themes.js, docs/THEMES.md). MIT License.
THEME_KEYS = {${KEYS.map(k => '"' + k + '"').join(', ')}}
TC = {}
for i, k in ipairs(THEME_KEYS) do TC[k] = 231 + i end   -- the theme's 16 colours live in palette slots 232-247
THEME_LISTS = ${toLua(LISTS)}
THEME_PRESETS = ${toLua(PRESETS)}

local function tcopy(t) local o = {} for k, v in pairs(t) do o[k] = type(v) == "table" and tcopy(v) or v end return o end
theme_copy = tcopy
local function is_hex(s) return type(s) == "string" and #s == 6 and not s:find("[^0-9a-fA-F]") end
local function in_list(l, v) for _, x in ipairs(l) do if x == v then return true end end return false end
function theme_index(list, v) for i, x in ipairs(list) do if x == v then return i end end return 1 end

function theme_fix(t)
  local base = THEME_PRESETS[1]
  local o = tcopy(base)
  if type(t) ~= "table" then return o end
  if type(t.name) == "string" and t.name ~= "" then o.name = string.upper(t.name):sub(1, 16) else o.name = "MY THEME" end
  if type(t.c) == "table" then for _, k in ipairs(THEME_KEYS) do if is_hex(t.c[k]) then o.c[k] = string.lower(t.c[k]) end end end
  for k, l in pairs(THEME_LISTS) do if in_list(l, t[k]) then o[k] = t[k] end end
  o.speed = math.max(0, math.min(10, math.floor(tonumber(t.speed) or base.speed)))
  o.outline = t.outline == true
  o.pic = type(t.pic) == "string" and t.pic or ""
  o.boottext = type(t.boottext) == "string" and string.upper(t.boottext):sub(1, 16) or ""
  return o
end

function theme_rgb(h) return tonumber(h:sub(1, 2), 16), tonumber(h:sub(3, 4), 16), tonumber(h:sub(5, 6), 16) end
function theme_hex(r, g, b) return string.format("%02x%02x%02x", r, g, b) end

-- wallpaper pictures: 80x60, kept in the tile sheet at x 0-79, y 192-251 (tiles 384-463) and drawn 4x with one spr()
PIC_W, PIC_H, PIC_Y = 80, 60, 192
local RUN = "ghijklmnopqrstuvwxyz"
function pic_decode(s)
  local px, i, n = {}, 1, #s
  while i <= n and #px < 4800 do
    local c = tonumber(s:sub(i, i), 16); i = i + 1
    if c then
      local r, m = 0, false
      while i <= n do
        local d = RUN:find(s:sub(i, i), 1, true)
        if not d then break end
        r = r * 20 + d - 1; m = true; i = i + 1
      end
      if not m then r = 1 end
      for _ = 1, math.min(r, 4800 - #px) do px[#px + 1] = c end
    end
  end
  for k = #px + 1, 4800 do px[k] = 0 end
  return px
end
function pic_encode(px)
  local out, i = {}, 1
  while i <= 4800 do
    local c, j = px[i], i
    while j < 4800 and px[j + 1] == c do j = j + 1 end
    local r, s = j - i + 1, string.format("%x", c)
    if r > 1 then
      local d = ""
      while r > 0 do d = RUN:sub(r % 20 + 1, r % 20 + 1) .. d; r = r // 20 end
      s = s .. d
    end
    out[#out + 1] = s
    i = j + 1
  end
  return table.concat(out)
end
function pic_to_sheet(px)
  for y = 0, 59 do for x = 0, 79 do sset(x, PIC_Y + y, 232 + (px[y * 80 + x + 1] or 0)) end end
  for y = 60, 63 do for x = 0, 79 do sset(x, PIC_Y + y, 0) end end
end
function pic_from_sheet()
  local px = {}
  for y = 0, 59 do for x = 0, 79 do px[y * 80 + x + 1] = math.max(0, math.min(15, sget(x, PIC_Y + y) - 232)) end end
  return px
end

local PIC_ON = nil
-- put a theme's colours and letters in, and its picture in the sheet
function theme_apply(t)
  for _, k in ipairs(THEME_KEYS) do palette(TC[k], theme_rgb(t.c[k])) end
  font(t.font, t.outline and TC.bar or -1)
  if t.wall == "picture" and PIC_ON ~= t.pic then pic_to_sheet(pic_decode(t.pic)); PIC_ON = t.pic end
end
function theme_pic_changed() PIC_ON = nil end

-- ---------------------------------------------------------------- wallpapers
local WS = {}
local function wall_init(k)
  WS = {kind = k}
  if k == "stars" then for i = 1, 50 do WS[i] = {rnd(320), rnd(240), rnd(3)} end
  elseif k == "bubbles" then for i = 1, 22 do WS[i] = {rnd(320), rnd(260), 2 + rnd(7), rnd(628) / 100} end
  elseif k == "rain" then for i = 1, 60 do WS[i] = {rnd(340), rnd(240), 4 + rnd(6)} end end
end
-- tt: frames so far, py: how far the screen has scrolled down (the wallpaper moves a little with it)
function theme_wall(t, tt, py)
  py = py or 0
  local k, sp = t.wall, t.speed / 5
  if WS.kind ~= k then wall_init(k) end
  rectfill(0, 0, 320, 240, TC.bg)
  if k == "stars" then
    for _, s in ipairs(WS) do
      s[1] = s[1] - s[3] * 0.15 * sp
      if s[1] < 0 then s[1] = s[1] + 320 end
      pset(s[1], (s[2] - py * s[3] * 0.1) % 240, s[3] > 1.5 and TC.wall or TC.wall2)
    end
  elseif k == "hills" then
    circfill(252, 52 - py * 0.05, 20, TC.accent)
    local o = tt * sp
    for x = 0, 319, 4 do
      local h = 74 + math.sin((x + o * 0.2) / 40) * 14 + math.sin((x + o * 0.2) / 17) * 5
      rectfill(x, 240 - h - py * 0.1, 4, h + 60, TC.wall2)
    end
    for x = 0, 319, 4 do
      local h = 42 + math.sin((x + o * 0.5) / 55 + 2) * 12 + math.sin((x + o * 0.5) / 23) * 4
      rectfill(x, 240 - h - py * 0.2, 4, h + 80, TC.wall)
    end
  elseif k == "waves" then
    local ph = tt * 0.03 * sp
    for i = 0, 10 do
      local y0 = 10 + i * 24 - (py * 0.15) % 24
      local c = i % 2 == 0 and TC.wall or TC.wall2
      local lx, ly = 0, y0 + math.sin(ph + i) * 6
      for x = 16, 320, 16 do
        local y = y0 + math.sin(x / 40 + ph + i) * 6
        line(lx, ly, x, y, c); lx, ly = x, y
      end
    end
  elseif k == "grid" then
    local hz = 116 - math.floor(py * 0.1)
    circfill(160, hz - 8, 42, TC.wall2)
    for i = 0, 4 do rectfill(110, hz - 26 + i * 8 + (tt * sp * 0.2) % 8, 100, 2, TC.bg) end
    rectfill(0, hz, 320, 240 - hz, TC.bg)
    for i = -10, 10 do line(160 + i * 10, hz, 160 + i * 64, 240, TC.wall) end
    local o = (tt * 0.008 * sp) % 1
    for i = 0, 11 do
      local f = (i + o) / 12
      local y = hz + math.floor(f * f * (240 - hz))
      line(0, y, 319, y, TC.wall)
    end
    line(0, hz, 319, hz, TC.wall2)
  elseif k == "bubbles" then
    for _, b in ipairs(WS) do
      b[2] = b[2] - (0.2 + b[3] * 0.05) * sp
      if b[2] < -10 then b[2] = 250; b[1] = rnd(320) end
      local x = b[1] + math.sin(tt * 0.03 + b[4]) * 6
      circ(x, b[2] - py * 0.1, b[3], b[3] > 5 and TC.wall2 or TC.wall)
      if b[3] > 4 then pset(x - b[3] // 2, b[2] - py * 0.1 - b[3] // 2, TC.wall2) end
    end
  elseif k == "rain" then
    for _, r in ipairs(WS) do
      r[2] = r[2] + r[3] * sp * 0.6; r[1] = r[1] - r[3] * sp * 0.15
      if r[2] > 250 then r[2] = r[2] - 260; r[1] = rnd(340) end
      if r[1] < -10 then r[1] = r[1] + 340 end
      line(r[1], r[2], r[1] + r[3] * 0.25, r[2] - r[3] * 1.2, r[3] > 7 and TC.wall2 or TC.wall)
    end
  elseif k == "checks" then
    local o = (tt * 0.25 * sp) % 64
    local oy = (o + py * 0.2) % 64
    for y = -64, 240, 32 do for x = -64, 320, 32 do
      if ((x + y) // 32) % 2 == 0 then rectfill(x + o, y + oy, 32, 32, TC.wall)
      else rectfill(x + o + 14, y + oy + 14, 4, 4, TC.wall2) end
    end end
  elseif k == "aurora" then
    for i = 1, 40 do pset((i * 97) % 320, (i * 53) % 150, i % 3 == 0 and TC.wall2 or TC.dim) end
    local ph = tt * 0.02 * sp
    for b = 0, 1 do
      local c = b == 0 and TC.wall or TC.wall2
      for x = 0, 319, 4 do
        local y = 50 + b * 34 + math.sin(x / 50 + ph + b * 2) * 20 + math.sin(x / 23 - ph * 0.7) * 7 - py * 0.1
        local h = 22 + math.sin(x / 31 + ph * 1.5 + b) * 12
        rectfill(x, y, 4, h, c)
        if (x // 4 + b) % 3 == 0 then rectfill(x, y + h, 4, 6, c) end
      end
    end
  elseif k == "picture" then
    if t.pic == "" then return end
    local o = sp > 0 and math.floor(tt * 0.1 * sp) % 320 or 0
    spr(384, -o, 0, 10, 8, false, false, 4)
    if o > 0 then spr(384, 320 - o, 0, 10, 8, false, false, 4) end
  end
end

-- ---------------------------------------------------------------- cards, bars, text
function rrect(x, y, w, h, r, c)
  r = math.max(0, math.min(r, w // 2, h // 2))
  rectfill(x + r, y, w - 2 * r, h, c); rectfill(x, y + r, w, h - 2 * r, c)
  circfill(x + r, y + r, r, c); circfill(x + w - 1 - r, y + r, r, c)
  circfill(x + r, y + h - 1 - r, r, c); circfill(x + w - 1 - r, y + h - 1 - r, r, c)
end
-- a card (the home screen's game cards, the apps' panels)
-- solid: a panel with text on it, so even the outline style gets a background
function theme_card(t, x, y, w, h, solid)
  local s = t.card
  if s == "frame" then
    rectfill(x, y, w, h, TC.card); rect(x, y, w, h, TC.edge); rect(x - 1, y - 1, w + 2, h + 2, TC.shade)
  elseif s == "round" then
    rrect(x + 3, y + 4, w, h, 8, TC.shade); rrect(x - 2, y - 2, w + 4, h + 4, 9, TC.edge); rrect(x, y, w, h, 7, TC.card)
  elseif s == "shadow" then
    rectfill(x + 5, y + 5, w, h, TC.shade); rectfill(x, y, w, h, TC.card); rectfill(x, y, w, 3, TC.edge)
  elseif s == "outline" then
    if solid then rectfill(x, y, w, h, TC.card) end
    rect(x, y, w, h, TC.edge); rect(x + 1, y + 1, w - 2, h - 2, TC.edge)
    rect(x + 4, y + 4, w - 8, h - 8, TC.shade)
    for _, p in ipairs({{x - 2, y - 2}, {x + w - 4, y - 2}, {x - 2, y + h - 4}, {x + w - 4, y + h - 4}}) do rectfill(p[1], p[2], 6, 6, TC.accent) end
  else -- ticket
    rectfill(x + 3, y + 3, w, h, TC.shade)
    rectfill(x, y, w, h, TC.card)
    for i = x + 6, x + w - 8, 6 do rectfill(i, y + 3, 3, 1, TC.edge); rectfill(i, y + h - 4, 3, 1, TC.edge) end
    circfill(x, y + h // 2, 6, TC.bg); circfill(x + w - 1, y + h // 2, 6, TC.bg)
  end
end
-- the top and bottom bars (the Bit's system bars)
function theme_bar(t, y, h, top)
  local s = t.bar
  if s == "solid" then rectfill(0, y, 320, h, TC.bar)
  elseif s == "line" then rectfill(0, top and y + h - 1 or y, 320, 1, TC.accent)
  elseif s == "float" then rrect(4, y + 2, 312, h - 3, 5, TC.bar) end
end
-- what the bars' text is drawn on, so it can be read on any wallpaper
function theme_bartext(t) return (t.bar == "solid" or t.bar == "float") and TC.bartext or TC.text end
function theme_ctext(s, y, c, sc)
  sc = sc or 1
  text(s, 160 - #s * 4 * sc, y, c, sc)
end

-- ---------------------------------------------------------------- sounds
THEME_SOUNDS = {
  blip = {move = {"E5", 4, 0.2, 4}, row = {"G5", 4, 0.2, 4}, open = {"C6", 1, 0.3, 10}, back = {"C5", 1, 0.3, 10}, boot = {"C5", "E5", "G5", "C6"}, bw = 1},
  soft = {move = {"A4", 4, 0.12, 6}, row = {"D5", 4, 0.12, 6}, open = {"A5", 4, 0.22, 14}, back = {"E4", 4, 0.2, 12}, boot = {"A4", "C#5", "E5", "A5"}, bw = 4},
  chime = {move = {"B5", 1, 0.14, 8}, row = {"E6", 1, 0.14, 8}, open = {"E6", 1, 0.25, 20}, back = {"B4", 1, 0.25, 14}, boot = {"E5", "B5", "E6", "G#6"}, bw = 1},
  retro = {move = {"C5", 0, 0.1, 3}, row = {"G5", 0, 0.1, 3}, open = {"C6", 5, 0.18, 8}, back = {"G4", 5, 0.18, 8}, boot = {"C4", "C5", "G5", "C6"}, bw = 0},
  clack = {move = {"C3", 3, 0.15, 2}, row = {"F3", 3, 0.15, 2}, open = {"G2", 3, 0.3, 4}, back = {"D2", 3, 0.3, 4}, boot = {"C3", "C3", "G3", "C4"}, bw = 3},
}
function theme_sfx(t, ev)
  local s = THEME_SOUNDS[t.sound]
  local e = s and s[ev]
  if e then sfx(e[1], e[2], e[3], e[4]) end
end

-- ---------------------------------------------------------------- boot animation
BOOT_LEN = 150
local function bounce_ease(e)
  if e < 0.5 then return 4 * e * e end
  e = e - 0.75
  return 1 - math.abs(e) * 0.5
end
-- f: frames since power on. Plays the jingle too. Returns true once it is over.
function theme_boot(t, f, title, sub)
  local k = t.boot
  if k == "none" then return true end
  local s = THEME_SOUNDS[t.sound]
  if s then
    if k == "type" then
      if f % 4 == 0 and f // 4 < #title and title:sub(f // 4 + 1, f // 4 + 1) ~= " " then theme_sfx(t, "move") end
      if f == #title * 4 + 30 then sfx(s.boot[4], s.bw, 0.3, 24) end
    else
      local at = {40, 48, 56, 66}
      for i = 1, 4 do if f == at[i] then sfx(s.boot[i], s.bw, 0.3, i == 4 and 30 or 8) end end
    end
  end
  local sc = #title > 13 and 2 or 3
  local w = #title * 8 * sc
  local x, y = 160 - w // 2, 96
  if k == "scan" then
    cls(0)
    if f < 14 then local wd = math.min(320, f * 26) rectfill(160 - wd // 2, 119, wd, 2, TC.text) return false end
    local h = math.min(240, (f - 14) * 10)
    clip(0, 120 - h // 2, 320, h)
  end
  theme_wall(t, f, 0)
  if k == "rise" or k == "scan" then
    local e = k == "rise" and math.min(1, f / 50) or 1
    e = 1 - (1 - e) ^ 3
    text(title, x, math.floor(240 - (240 - y) * e), TC.text, sc)
    local lw = math.floor(math.max(0, math.min(1, (f - 40) / 30)) * w)
    rectfill(160 - lw // 2, y + 8 * sc + 6, lw, 2, TC.accent)
  elseif k == "bounce" then
    for i = 1, #title do
      local e = math.max(0, math.min(1, (f - i * 4) / 30))
      local yy = y - math.floor((1 - bounce_ease(e)) * 160)
      if e > 0 then text(title:sub(i, i), x + (i - 1) * 8 * sc, yy, i % 2 == 0 and TC.accent or TC.text, sc) end
    end
  elseif k == "type" then
    local n = math.min(#title, f // 4)
    text(title:sub(1, n), x, y, TC.text, sc)
    if (f // 10) % 2 == 0 then rectfill(x + n * 8 * sc, y, 2 * sc, 8 * sc, TC.accent) end
  elseif k == "pixels" then
    text(title, x, y, TC.text, sc)
    local p = f / 80
    for by = 0, 14 do for bx = 0, 19 do
      if ((bx * 7 + by * 13) % 20) / 20 > p then rectfill(bx * 16, by * 16, 16, 16, (bx + by) % 2 == 0 and TC.bg or TC.card) end
    end end
  end
  if sub and sub ~= "" and f > 70 then theme_ctext(sub, y + 8 * sc + 16, TC.dim) end
  clip()
  return f >= BOOT_LEN
end
`;

  /* ------------------------------------------------------------------ an on-screen keyboard (Themes and Settings apps) */
  const KB = `
-- kb_open(title, text, max, done(text)) shows a keyboard; while kb_update() returns true it has the buttons
KB = nil
KB_COL = {panel = 19, edge = 21, text = 13, dim = 29, key = 2, sel = 27}
local KB_ROWS = {"ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ-_.!", "0123456789", "'&?+:#*/()"}
local KB_LAST = {"SPACE", "DELETE", "DONE"}
function kb_open(title, s, max, done) KB = {title = title, s = s or "", max = max or 12, done = done, r = 1, c = 1} end
local function kb_add(ch) if #KB.s < KB.max then KB.s = KB.s .. ch end end
local function kb_finish(ok)
  local k = KB
  KB = nil
  if ok and k.done then k.done((k.s:gsub("^%s+", ""):gsub("%s+$", ""))) end
end
function kb_update()
  if not KB then return false end
  local nr = #KB_ROWS + 1
  local w = KB.r == nr and #KB_LAST or 10
  if btnp("up") then KB.r = (KB.r - 2) % nr + 1 end
  if btnp("down") then KB.r = KB.r % nr + 1 end
  w = KB.r == nr and #KB_LAST or 10
  if btnp("left") then KB.c = (KB.c - 2) % w + 1 end
  if btnp("right") then KB.c = KB.c % w + 1 end
  KB.c = math.min(KB.c, w)
  if btnp("a") then
    if KB.r == nr then
      if KB.c == 1 then kb_add(" ") elseif KB.c == 2 then KB.s = KB.s:sub(1, -2) else kb_finish(true) return true end
    else kb_add(KB_ROWS[KB.r]:sub(KB.c, KB.c)) end
    sfx("E5", 4, 0.15, 3)
  end
  if btnp("y") then kb_add(" ") end
  if btnp("b") then if KB.s == "" then kb_finish(false) else KB.s = KB.s:sub(1, -2) end end
  if btnp("start") then kb_finish(true) end
  return true
end
function kb_draw()
  if not KB then return end
  local C = KB_COL
  rectfill(16, 30, 288, 184, C.panel); rect(16, 30, 288, 184, C.edge)
  text(KB.title, 28, 38, C.dim)
  rectfill(28, 52, 264, 16, C.key)
  local s = KB.s .. ((t() // 15) % 2 == 0 and "_" or "")
  text(s, 34, 56, C.text)
  text(#KB.s .. "/" .. KB.max, 284 - #(#KB.s .. "/" .. KB.max) * 8, 38, C.dim)
  for r, row in ipairs(KB_ROWS) do
    for c = 1, #row do
      local x, y = 32 + (c - 1) * 26, 78 + (r - 1) * 20
      local on = KB.r == r and KB.c == c
      rectfill(x, y, 22, 16, on and C.sel or C.key)
      text(row:sub(c, c), x + 7, y + 4, on and C.panel or C.text)
    end
  end
  for c, l in ipairs(KB_LAST) do
    local x, y = 32 + (c - 1) * 88, 180
    local on = KB.r == #KB_ROWS + 1 and KB.c == c
    rectfill(x, y, 80, 16, on and C.sel or C.key)
    text(l, x + 40 - #l * 4, y + 4, on and C.panel or C.text)
  end
  text("B delete  Y space  START done", 44, 202, C.dim)
end
`;

  /* ------------------------------------------------------------------ the boot screen: plays once when the Bit is switched on */
  // BOOT = {theme = T, title = "...", sub = "..."} from the host; home() when it is done or a button is pressed
  const BOOT = `
local T, f, gone = nil, 0, false
function _init() T = theme_fix(BOOT and BOOT.theme) theme_apply(T) if T.look ~= "game" then display(T.look) end end
function _update()
  f = f + 1
  local any = false
  for _, b in ipairs({"a", "b", "x", "y", "start", "select"}) do if btnp(b) then any = true end end
  if not gone and (T.boot == "none" or f > BOOT_LEN + 20 or (f > 12 and any)) then gone = true; home() end
end
function _draw()
  local title = BOOT and BOOT.title or ""
  if title == "" then title = "POCKETBIT" end
  theme_boot(T, f, title, BOOT and BOOT.sub)
end
`;

  /* ------------------------------------------------------------------ the Themes app (Utilities row) */
  const APP = `
local SAVE = {theme = nil, mine = {}}
T = nil                 -- the theme in use (what the app is drawn with, and what it edits)
local SCREENS = {"PICK", "EDIT", "COLOURS"}
local SCR, tt, dirty, msg, msgt = 1, 0, 0, "", 0
local lsel, esel, csel = 1, 1, 1
local mix = nil          -- fine-tuning one colour: {ch = 1..3}
local paint = nil        -- painting the wallpaper picture
local boot = nil         -- playing the boot animation here
local saved_theme = nil  -- the theme before browsing the list (B puts it back)
local confirm_del = 0

local function apply()
  theme_apply(T)
  if T.look == "game" then display() else display(T.look) end
  KB_COL = {panel = TC.card, edge = TC.edge, text = TC.text, dim = TC.dim, key = TC.bg, sel = TC.accent}
end
local function say(s) msg, msgt = s, 90 end
local function touch() dirty = 30 end
local function store()
  SAVE.theme = T
  if not pcall(save, SAVE) then say("SAVE FULL: delete one of your themes") end
end

function _init()
  local d = saved()
  if type(d) == "table" then
    SAVE.theme = d.theme
    if type(d.mine) == "table" then for _, m in ipairs(d.mine) do if #SAVE.mine < 4 then SAVE.mine[#SAVE.mine + 1] = theme_fix(m) end end end
  end
  T = theme_fix(SAVE.theme)
  for i, p in ipairs(THEME_PRESETS) do if p.name == T.name then lsel = i end end
  for i, m in ipairs(SAVE.mine) do if m.name == T.name then lsel = #THEME_PRESETS + i end end
  apply()
end

-- the list: presets, the owner's own themes, then "save as my theme"
local function list_items()
  local l = {}
  for i, p in ipairs(THEME_PRESETS) do l[#l + 1] = {name = p.name, theme = p} end
  for i, m in ipairs(SAVE.mine) do l[#l + 1] = {name = m.name, theme = m, mine = i} end
  if #SAVE.mine < 4 then l[#l + 1] = {name = "+ SAVE AS MY THEME", add = true} end
  return l
end
local function same(a, b)
  if a.name ~= b.name or a.wall ~= b.wall or a.pic ~= b.pic or a.font ~= b.font or a.card ~= b.card then return false end
  for _, k in ipairs(THEME_KEYS) do if a.c[k] ~= b.c[k] then return false end end
  return true
end

-- the rows on EDIT: {label, value(), change(d), act()}
local function cyc(key) return function(d) T[key] = THEME_LISTS[key][(theme_index(THEME_LISTS[key], T[key]) - 1 + d) % #THEME_LISTS[key] + 1] end end
local EDIT = {
  {"NAME", function() return T.name end, nil, function() kb_open("THEME NAME", T.name, 16, function(s) if s ~= "" then T.name = string.upper(s) touch() end end) end},
  {"WALLPAPER", function() return string.upper(T.wall) end, cyc("wall")},
  {"MOTION", function() return T.speed == 0 and "STILL" or T.speed end, function(d) T.speed = math.max(0, math.min(10, T.speed + d)) end},
  {"PAINT WALLPAPER", function() return T.pic ~= "" and "A EDIT" or "A START" end, nil, function()
    if T.pic == "" then pic_to_sheet(pic_decode("")) else theme_apply(T) pic_to_sheet(pic_decode(T.pic)) end
    T.wall = "picture"; paint = {x = 40, y = 30, c = 1, dirty = false}
  end},
  {"LETTERS", function() return string.upper(T.font) end, cyc("font")},
  {"LETTER OUTLINE", function() return T.outline and "ON" or "OFF" end, function() T.outline = not T.outline end},
  {"CARDS", function() return string.upper(T.card) end, cyc("card")},
  {"BARS", function() return string.upper(T.bar) end, cyc("bar")},
  {"SOUNDS", function() return string.upper(T.sound) end, function(d) cyc("sound")(d) theme_sfx(T, "open") end},
  {"BOOT ANIMATION", function() return string.upper(T.boot) end, cyc("boot")},
  {"BOOT TEXT", function() return T.boottext == "" and "BIT NAME" or T.boottext end, nil, function()
    kb_open("BOOT TEXT (EMPTY = BIT NAME)", T.boottext, 16, function(s) T.boottext = string.upper(s) touch() end) end},
  {"PLAY BOOT", function() return "A" end, nil, function() boot = 0 end},
  {"SCREEN LOOK", function() return T.look == "game" and "GAME'S OWN" or string.upper(T.look) end, cyc("look")},
}

local function paint_update()
  local p = paint
  local moved = false
  if btnp("left") then p.x = math.max(0, p.x - 1) moved = true end
  if btnp("right") then p.x = math.min(79, p.x + 1) moved = true end
  if btnp("up") then p.y = math.max(0, p.y - 1) moved = true end
  if btnp("down") then p.y = math.min(59, p.y + 1) moved = true end
  if btnp("l") then p.c = (p.c - 1) % 16 end
  if btnp("r") then p.c = (p.c + 1) % 16 end
  if btn("a") then sset(p.x, PIC_Y + p.y, 232 + p.c) p.dirty = true end
  if btnp("x") then p.c = math.max(0, sget(p.x, PIC_Y + p.y) - 232) end
  if btnp("y") then   -- fill the area under the cursor
    local from, to = sget(p.x, PIC_Y + p.y), 232 + p.c
    if from ~= to then
      local st = {{p.x, p.y}}
      while #st > 0 do
        local q = table.remove(st)
        local x, y = q[1], q[2]
        if x >= 0 and x < 80 and y >= 0 and y < 60 and sget(x, PIC_Y + y) == from then
          sset(x, PIC_Y + y, to)
          st[#st + 1] = {x + 1, y}; st[#st + 1] = {x - 1, y}; st[#st + 1] = {x, y + 1}; st[#st + 1] = {x, y - 1}
        end
      end
      p.dirty = true
    end
  end
  if btnp("select") then for y = 0, 59 do for x = 0, 79 do sset(x, PIC_Y + y, 232 + p.c) end end p.dirty = true end
  if btnp("b") or btnp("start") then
    if p.dirty or T.pic == "" then T.pic = pic_encode(pic_from_sheet()); theme_pic_changed() end
    paint = nil; touch(); say("WALLPAPER SAVED")
  end
end

function _update()
  tt = tt + 1
  if msgt > 0 then msgt = msgt - 1 end
  if confirm_del > 0 then confirm_del = confirm_del - 1 end
  if dirty > 0 then dirty = dirty - 1; if dirty == 0 then store() end end
  if boot then
    boot = boot + 1
    if boot > BOOT_LEN + 20 or (boot > 10 and (btnp("a") or btnp("b"))) then boot = nil end
    return
  end
  if kb_update() then return end
  if paint then paint_update() return end
  if mix then
    local k = THEME_KEYS[csel]
    local rgb = {theme_rgb(T.c[k])}
    if btnp("up") then mix.ch = (mix.ch - 2) % 3 + 1 end
    if btnp("down") then mix.ch = mix.ch % 3 + 1 end
    local d = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
    if d ~= 0 then
      rgb[mix.ch] = math.max(0, math.min(255, (rgb[mix.ch] // 17 + d) * 17))
      T.c[k] = theme_hex(rgb[1], rgb[2], rgb[3]); apply(); touch()
    end
    if btnp("a") or btnp("b") then mix = nil end
    return
  end
  local was = SCR
  if btnp("r") then SCR = SCR % #SCREENS + 1 end
  if btnp("l") then SCR = (SCR - 2) % #SCREENS + 1 end
  if SCR ~= was then
    if saved_theme then T = saved_theme; saved_theme = nil; apply() end
    for i, it in ipairs(list_items()) do if it.theme and it.theme.name == T.name then lsel = i end end
    theme_sfx(T, "row")
  end
  if SCR == 1 then
    local items = list_items()
    local was_l = lsel
    if btnp("down") then lsel = lsel % #items + 1 end
    if btnp("up") then lsel = (lsel - 2) % #items + 1 end
    local it = items[lsel]
    if lsel ~= was_l then
      theme_sfx(T, "move")
      if it.theme then   -- show it straight away; A keeps it, B goes back
        saved_theme = saved_theme or T
        T = theme_fix(it.theme); apply()
      elseif saved_theme then T = saved_theme; saved_theme = nil; apply() end
    end
    if btnp("a") then
      if it.add then
        local m = theme_copy(saved_theme or T)
        for _, p in ipairs(THEME_PRESETS) do if p.name == m.name then m.name = "MY THEME " .. (#SAVE.mine + 1) end end
        SAVE.mine[#SAVE.mine + 1] = m
        T = theme_copy(m); saved_theme = nil; apply(); store(); say("SAVED AS " .. m.name)
        lsel = #THEME_PRESETS + #SAVE.mine
      else
        saved_theme = nil; store(); theme_sfx(T, "open"); say("NOW USING " .. T.name)
      end
    end
    if btnp("b") and saved_theme then T = saved_theme; saved_theme = nil; apply(); theme_sfx(T, "back") end
    if btnp("x") and it.mine then
      if confirm_del > 0 then
        table.remove(SAVE.mine, it.mine); confirm_del = 0
        if saved_theme then T = saved_theme; saved_theme = nil; apply() end
        store(); say("DELETED"); lsel = math.min(lsel, #list_items())
      else confirm_del = 90; say("PRESS X AGAIN TO DELETE") end
    end
    if btnp("y") and it.mine then   -- keep the changes made since in this slot
      SAVE.mine[it.mine] = theme_copy(saved_theme or T); store(); say("UPDATED " .. it.name)
    end
  elseif SCR == 2 then
    if btnp("down") then esel = esel % #EDIT + 1; theme_sfx(T, "move") end
    if btnp("up") then esel = (esel - 2) % #EDIT + 1; theme_sfx(T, "move") end
    local it = EDIT[esel]
    local d = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
    if d ~= 0 and it[3] then it[3](d); apply(); touch() end
    if btnp("a") then if it[4] then it[4]() elseif it[3] then it[3](1); apply(); touch() end end
  else
    if btnp("down") then csel = csel % #THEME_KEYS + 1; theme_sfx(T, "move") end
    if btnp("up") then csel = (csel - 2) % #THEME_KEYS + 1; theme_sfx(T, "move") end
    local d = (btnp("right") and 1 or 0) - (btnp("left") and 1 or 0)
    if d ~= 0 then   -- quick pick: the Bit's 32 base colours
      local k = THEME_KEYS[csel]
      local best, cur = 0, -1
      for i = 0, 31 do local r, g, b = palette(i) if theme_hex(r, g, b) == T.c[k] then cur = i end end
      best = cur < 0 and 0 or (cur + d) % 32
      T.c[k] = theme_hex(palette(best)); apply(); touch()
    end
    if btnp("a") then mix = {ch = 1} end
  end
end

local NAMES = {bg = "BACKGROUND", wall = "WALLPAPER 1", wall2 = "WALLPAPER 2", card = "CARDS", edge = "CARD EDGE", shade = "CARD SHADOW",
  accent = "ACCENT", text = "TEXT", dim = "SOFT TEXT", bar = "BARS", bartext = "BAR TEXT", p1 = "PAINT 1", p2 = "PAINT 2", p3 = "PAINT 3", p4 = "PAINT 4", p5 = "PAINT 5"}

local function topbar()
  theme_bar(T, 0, 16, true)
  local c = theme_bartext(T)
  text("THEMES", 6, 4, TC.accent)
  local x = 70
  for i, n in ipairs(SCREENS) do
    if i == SCR then rectfill(x - 3, 2, #n * 8 + 6, 12, TC.accent) text(n, x, 4, TC.bar) else text(n, x, 4, c) end
    x = x + #n * 8 + 12
  end
  text("L R", 314 - 24, 4, TC.dim)
end
local function hint(s)
  theme_bar(T, 222, 18, false)
  if msgt > 0 then text(msg, 8, 227, TC.accent) else text(s, 8, 227, theme_bartext(T)) end
end
-- a small copy of a home screen card, to show the card style
local function sample(x, y)
  theme_card(T, x, y, 72, 72)
  rectfill(x + 12, y + 12, 48, 48, TC.accent)
  rectfill(x + 20, y + 20, 32, 32, TC.bg)
  text("BIT", x + 24, y + 32, TC.text)
  local n = T.name
  text(n, x + 36 - #n * 4, y + 82, TC.text)
  for i = 1, 5 do local dx = x + 36 - 20 + (i - 1) * 8 if i == 2 then rectfill(dx, y + 96, 4, 4, TC.accent) else rect(dx, y + 96, 4, 4, TC.dim) end end
end

local function draw_paint()
  local p = paint
  cls(TC.bg)
  rectfill(0, 0, 320, 14, 0)
  text("PAINT THE WALLPAPER", 6, 3, 13)
  clip(4, 18, 240, 180)
  spr(384, 4, 18, 10, 8, false, false, 3)
  clip()
  rect(3, 17, 242, 182, 13)
  local cx, cy = 4 + p.x * 3, 18 + p.y * 3
  rect(cx - 1, cy - 1, 5, 5, (tt // 8) % 2 == 0 and 13 or 0)
  for i = 0, 15 do
    local x, y = 254 + (i % 2) * 32, 20 + (i // 2) * 22
    rectfill(x, y, 26, 18, 232 + i)
    if i == p.c then rect(x - 2, y - 2, 30, 22, 13) rect(x - 1, y - 1, 28, 20, 0) end
  end
  text(p.x .. "," .. p.y, 254, 200, 13)
  rectfill(0, 210, 320, 30, 0)
  text("A paint  Y fill  X pick  L R colour", 6, 214, 13)
  text("SELECT fill all  B done", 6, 226, 29)
end

function _draw()
  if boot then
    local ok = theme_boot(T, boot, T.boottext ~= "" and T.boottext or "POCKETBIT", "PREVIEW")
    return
  end
  if paint then draw_paint() return end
  theme_wall(T, tt, 0)
  topbar()
  if SCR == 1 then
    local items = list_items()
    theme_card(T, 8, 24, 168, 190, true)
    local first = math.max(1, math.min(lsel - 6, #items - 12))
    for i = first, math.min(#items, first + 12) do
      local it, y = items[i], 30 + (i - first) * 14
      if i == lsel then rectfill(12, y - 2, 160, 12, TC.accent) end
      local c = i == lsel and TC.card or (it.add and TC.dim or TC.text)
      text((it.mine and "* " or "") .. it.name, 16, y, c)
    end
    sample(212, 40)
    local cur = items[lsel]
    text(saved_theme and "A USE IT  B BACK" or (cur.add and "A SAVE COPY" or "IN USE"), 190, 150, TC.dim)
    for i, k in ipairs(THEME_KEYS) do if i <= 11 then rectfill(190 + (i - 1) * 11, 166, 9, 9, TC[k]) rect(190 + (i - 1) * 11, 166, 9, 9, TC.dim) end end
    hint(cur.mine and "A use  X delete  Y keep changes" or "UP DOWN look  A use  L R edit")
  elseif SCR == 2 then
    theme_card(T, 8, 24, 210, 192, true)
    for i, it in ipairs(EDIT) do
      local y = 30 + (i - 1) * 14
      local on = i == esel
      if on then rectfill(12, y - 2, 202, 12, TC.accent) end
      text(it[1], 16, y, on and TC.card or TC.text)
      local v = tostring(it[2]())
      if #v > 10 then v = v:sub(1, 9) .. "." end
      text(v, 210 - #v * 8, y, on and TC.card or TC.dim)
    end
    sample(234, 52)
    local it = EDIT[esel]
    hint(it[4] and "A open   UP DOWN choose" or "LEFT RIGHT change   UP DOWN choose")
  else
    theme_card(T, 8, 24, 168, 192, true)
    local first = math.max(1, math.min(csel - 6, #THEME_KEYS - 12))
    for i = first, math.min(#THEME_KEYS, first + 12) do
      local k, y = THEME_KEYS[i], 30 + (i - first) * 14
      if i == csel then rectfill(12, y - 2, 160, 12, TC.accent) end
      rectfill(16, y, 8, 8, TC[k]) rect(16, y, 8, 8, i == csel and TC.card or TC.dim)
      text(NAMES[k], 30, y, i == csel and TC.card or TC.text)
    end
    local k = THEME_KEYS[csel]
    theme_card(T, 190, 28, 120, 112, true)
    rectfill(198, 36, 104, 36, TC[k]) rect(198, 36, 104, 36, TC.dim)
    text("#" .. T.c[k], 214, 78, TC.text)
    local rgb = {theme_rgb(T.c[k])}
    for ch = 1, 3 do
      local y = 92 + (ch - 1) * 14
      local on = mix and mix.ch == ch
      text(({"R", "G", "B"})[ch], 198, y, on and TC.accent or TC.dim)
      rect(210, y, 92, 8, on and TC.accent or TC.dim)
      rectfill(211, y + 1, math.floor(rgb[ch] / 255 * 90), 6, on and TC.accent or TC.text)
    end
    hint(mix and "UP DOWN R G B   LEFT RIGHT change   A done" or "LEFT RIGHT quick colours   A mix")
  end
  kb_draw()
end
`;

  const PALI = { '.': 0, k: 1, w: 13, y: 27, o: 10, b: 21, l: 22, g: 17, p: 4, d: 31, r: 26, c: 12, m: 5 };
  const APP_ICON = [
    '................', '..dddddddddddd..', '.dbbbbbbbbbbbbd.', '.dblllllllllbbd.', '.dbllywlllllbbd.', '.dblllllllggbbd.', '.dbllllllgggbbd.', '.dbgggggggggbbd.',
    '.dddddddddddddd.', '.dwwwwwwwwwwwwd.', '.dwrwywgwbwmwwd.', '.dwwwwwwwwwwwwd.', '.dddddddddddddd.', '......dddd......', '....dddddddd....', '................',
  ].map(r => [...r].map(ch => PALI[ch] || 0));

  /* ------------------------------------------------------------------ host side (studio): read and write the Bit's theme */
  const SAVE_KEY = 'Bit theme';
  function readSave() {
    try {
      const raw = localStorage.getItem('bitkit.save.' + SAVE_KEY);
      if (raw) { const o = window.BKMusic.parseLua(raw); return { theme: o && o.theme ? fix(o.theme) : fix(null), mine: Array.isArray(o && o.mine) ? o.mine.slice(0, 4).map(fix) : [] }; }
    } catch (e) { /* a broken save: start again */ }
    return { theme: fix(null), mine: [] };
  }
  function writeSave(s) {
    const str = toLua({ theme: fix(s.theme), mine: (s.mine || []).slice(0, 4).map(fix) });
    if (str.length > 16384) throw new Error('The Bit\'s theme save is full (16 KB): delete one of your themes');
    localStorage.setItem('bitkit.save.' + SAVE_KEY, str);
  }
  const current = () => readSave().theme;
  // a .bittheme file: JSON, so it can be shared (and read by people)
  function exportText(t) { return JSON.stringify({ format: 'bitkit-theme', version: 1, theme: fix(t) }, null, 1); }
  function importText(str) {
    const o = JSON.parse(str);
    if (!o || o.format !== 'bitkit-theme' || !o.theme) throw new Error('This is not a BitKit theme file');
    return fix(o.theme);
  }

  // the Settings app (studio/bitapps.js) types names with the same keyboard
  const st = (window.BK_APPS || []).find(a => a.settings);
  if (st && !st.kb) { st.code = KB + st.code; st.kb = true; }
  // the Themes app on the home screen's Utilities row (studio/bitapps.js has the others)
  if (window.BK_APPS) {
    window.BK_APPS.push({ name: 'Themes', code: LIB + KB + APP, icon: APP_ICON, saveKey: SAVE_KEY, sub: 'make this Bit yours', theme: true,
      about: 'Colours, wallpaper (painted or moving), letters, cards, bars, sounds and the boot animation of this Bit.' });
  }

  return { KEYS, KEY_NAMES, LISTS, PRESETS, PIC_W, PIC_H, LIB, KB, BOOT, APP, APP_ICON, SAVE_KEY, toLua, fix, picDecode, picEncode,
    readSave, writeSave, current, exportText, importText };
})();
