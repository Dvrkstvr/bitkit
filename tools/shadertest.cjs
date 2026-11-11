// CI check for shaders: the screen shaders (tint, fog, dither, remap, wave, ripple, pixelate, glitch, raster),
// the display{} look, the sprite shaders (sprfx{}) and the Deepglow demo that shows them off.
// `node tools/shadertest.cjs shots/` also writes screenshots as PNGs.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'deepglow']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const bit = (...names) => names.reduce((m, n) => m | (1 << B[n]), 0);
const shotDir = process.argv[2];
const D = window.BK_DEMOS.find(d => d.name === 'Deepglow');
if (!D) { fail('Deepglow is not in BK_DEMOS'); process.exit(1); }
window.BKRules.check(D).filter(r => !r.ok).forEach(r => fail(`Deepglow breaks the rule "${r.name}"`));
const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
D.buildGfx(cart);

function png(rgba, w, h) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const runtime = require('../studio/runtime.js');
(async () => {
  let errors = [], logs = [];
  const M = await runtime({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } });
  M._bkw_init();
  const s = x => M.stringToNewUTF8(x);
  M.HEAPU8.set(cart.tiles, M._bkw_tiles());
  const shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    const p = M._bkw_render();
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, p, 320 * 240 * 4).slice(), 320, 240));
  };
  const screen = () => M.HEAPU8.slice(M._bkw_screen(), M._bkw_screen() + 320 * 240);
  // run a cart one frame (or n) and return what it printed
  const run = (code, n = 1) => {
    errors = []; logs = [];
    M.HEAP32[M._bkw_save() >> 2] = -1;
    if (M._bkw_load(s(code))) { fail('did not load: ' + errors.join(' ') + '\n' + code); return []; }
    for (let i = 0; i < n; i++) if (M._bkw_frame(0, 0)) { fail('frame failed: ' + errors.join(' ')); return []; }
    errors.forEach(e => fail(e));
    return logs;
  };
  const expect = (name, got, want) => { if (String(got) !== String(want)) fail(`${name}: got "${got}", expected "${want}"`); };
  const scene = 'cls(19) for i = 0, 15 do rectfill(i * 20, 0, 20, 120, 32 + i * 13) end circfill(160, 160, 40, 27) ';
  const count = (c, x0 = 0, y0 = 0, x1 = 320, y1 = 240) => `local n = 0 for y = ${y0}, ${y1 - 1} do for x = ${x0}, ${x1 - 1} do if pget(x, y) == ${c} then n = n + 1 end end end`;

  // ---- screen shaders
  run(`function _draw() ${scene} tint(26, 1) ${count(26)} print("tint", n) end`).forEach(l => l.startsWith('tint') && expect('tint 1 covers the screen', l.split(/\s+/)[1], 76800));
  run(`function _draw() ${scene} dither(1, 0.5) ${count(1)} print("dither", n) end`).forEach(l => l.startsWith('dither') && expect('dither 0.5 is half', l.split(/\s+/)[1], 38400));
  run(`function _draw() ${scene} clip(0, 0, 160, 240) dither(1, 1) clip() ${count(1, 160, 0, 320, 240)} print("clip", n) end`).forEach(l => l.startsWith('clip') && expect('shaders stay inside clip()', l.split(/\s+/)[1], 0));
  run(`function _draw() ${scene} remap(27, 8) ${count(27)} local a = n ${count(8)} print("remap", a, n > 4000) end`).forEach(l => l.startsWith('remap') && expect('remap swaps colours', l.split(/\s+/).slice(1).join(' '), '0 true'));
  run(`function _draw() ${scene} fog(0, 0, 100, 1, 1) ${count(0, 0, 0, 320, 101)} local a = n ${count(19, 0, 160, 10, 240)} print("fog", a, n) end`).forEach(l => l.startsWith('fog') && expect('fog covers its rows only', l.split(/\s+/).slice(1).join(' '), '32320 800'));
  run(`function _draw() cls(1) rectfill(0, 0, 320, 120, 5) pixelate(8) local ok = true for by = 0, 232, 8 do for bx = 0, 312, 8 do local c = pget(bx, by) for y = by, by + 7 do for x = bx, bx + 7 do if pget(x, y) ~= c then ok = false end end end end end print("pix", ok) end`)
    .forEach(l => l.startsWith('pix') && expect('pixelate makes even blocks', l.split(/\s+/)[1], 'true'));
  {
    const a = run(`function _draw() ${scene} wave(4, 30, 1) ripple(160, 160, 40, 6, 12) end`, 5) && screen();
    run(`function _draw() ${scene} end`, 5); const b = screen();
    let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff < 2000) fail('wave/ripple barely moved anything: ' + diff);
    run(`function _draw() ${scene} wave(0) ripple(160, 160, 40, 0) end`, 5); const c = screen();
    if (!c.every((v, i) => v === b[i])) fail('wave(0) and ripple with amp 0 should change nothing');
    run(`function _draw() ${scene} glitch(0.6, 42) end`, 1); const g1 = screen();
    run(`function _draw() ${scene} glitch(0.6, 42) end`, 3); const g2 = screen();
    if (!g1.every((v, i) => v === g2[i])) fail('glitch with the same seed should give the same picture');
    if (g1.every((v, i) => v === b[i])) fail('glitch changed nothing');
  }
  run(`function _draw() cls(0) raster(function(y) return 0, 26, 1 end) ${count(26)} print("raster", n) end`).forEach(l => l.startsWith('raster') && expect('raster tints rows', l.split(/\s+/)[1], 76800));
  run(`function _draw() cls(0) rectfill(0, 0, 10, 240, 7) raster(function(y) return 5 end) print("rshift", pget(12, 3), pget(16, 3)) end`).forEach(l => l.startsWith('rshift') && expect('raster slides rows', l.split(/\s+/).slice(1).join(' '), '7 0'));
  shot('screen-shaders');

  // ---- display looks: same numbers in the C runtime and on the Game tab; never touch screen[]
  {
    const src = fs.readFileSync(__dirname + '/../studio/studio.js', 'utf8');
    const m = /const DISPLAY_LOOKS = (\{[\s\S]*?\});/.exec(src);
    const looks = m ? Function('return ' + m[1])() : {};
    if (!Object.keys(looks).length) fail('DISPLAY_LOOKS not found in studio.js');
    for (const [name, vals] of Object.entries(looks)) {
      run(`function _draw() display("${name}") end`);
      const got = Array.from(M.HEAP32.subarray(M._bkw_display() >> 2, (M._bkw_display() >> 2) + 10));
      expect(`display("${name}") matches the Game tab`, got.join(','), vals.join(','));
    }
    run(`function _draw() ${scene} end`, 2); const plain = screen();
    run(`function _init() display("old tv") end function _draw() ${scene} end`, 2); const tv = screen();
    if (!tv.every((v, i) => v === plain[i])) fail('display() must not change screen[]');
    shot('display-old-tv');
    run(`function _init() display{look = "crt", grain = 0, saturation = -1} end function _draw() print("d", 1) end`);
    const d = Array.from(M.HEAP32.subarray(M._bkw_display() >> 2, (M._bkw_display() >> 2) + 10));
    expect('display{look=, fields}', d.join(','), '45,35,30,1,35,0,8,10,-100,0');
  }
  errors = [];
  M._bkw_load(s('display("nope")'));
  if (!errors.some(e => /no look called/.test(e))) fail('display with an unknown look should say so');

  // ---- sprite shaders
  const sprCount = (fx, c) => {
    const l = run(`function _draw() cls(0) ${fx} spr(64, 100, 100, 2, 2) sprfx() ${count(c, 90, 90, 130, 130)} print("n", n) end`).find(x => x.startsWith('n'));
    return l ? +l.split(/\s+/)[1] : -1;
  };
  const plainBody = sprCount('', 10);
  if (plainBody < 30) fail('test sprite should have orange pixels: ' + plainBody);
  if (sprCount('sprfx{outline = 9}', 9) < 40) fail('outline drew no outline');
  expect('silhouette', sprCount('sprfx{silhouette = 10}', 10) > plainBody, true);
  expect('flash to white leaves no orange', sprCount('sprfx{flash = 13}', 10), 0);
  expect('dissolve 1 hides everything', sprCount('sprfx{dissolve = 1}', 10), 0);
  expect('own shader', sprCount('sprfx{shader = function(x, y, c) if c then return 3 end end}', 3) > plainBody, true);
  if (sprCount('sprfx{light = 1}', 10) >= plainBody) fail('light did not shade the sprite');
  if (sprCount('sprfx{shadow = 2, shadow_x = 3, shadow_y = 3}', 2) < 20) fail('no drop shadow');
  // sprfx stays on across the game shell's menu overlay, and sspr goes through it too
  {
    const l = run(`function _init() game{title = "x", goal = "y"} sprfx{silhouette = 3} end
      function _draw() cls(0) sspr(64, 100, 100, 2, 2, 1.5) ${count(3, 90, 90, 140, 140)} print("n", n) end`, 3).filter(x => x.startsWith('n')).map(x => +x.split(/\s+/)[1]);
    if (!(l.length === 3 && l.every(v => v > 100))) fail('sprfx should survive the menu overlay and apply to sspr: ' + l.join(','));
  }

  // ---- Deepglow
  const meta = [{ name: 'Sea cave', w: 40, h: 30, placed: [] }];
  const load = (probe, boot = 3) => {
    errors = []; logs = [];
    M.HEAP32[M._bkw_save() >> 2] = -1;
    const pre = window.BKEntities.toLua(cart.entities, meta, 0, boot ? `GAME_BOOT = ${boot}\n` : '');
    return M._bkw_load_ex(s(pre), s(D.code + '\n' + (probe || '')));
  };
  if (load()) fail('Deepglow did not load: ' + errors.join(' '));
  for (let f = 0; f < 4000; f++) {
    const dive = f < 10 ? 0 : f < 2600 ? bit('down') | ((f >> 6) & 1 ? bit('left') : bit('right')) : bit('up');
    const mask = dive | (f % 120 === 0 ? bit('a') : 0) | (f % 90 === 45 ? bit('b') : 0);
    if (M._bkw_frame(mask, 0)) { fail('Deepglow stopped at frame ' + f + ': ' + errors.join(' ')); break; }
    if (f === 300) shot('deepglow-dive');
    if (f === 1500) shot('deepglow-deep');
  }
  errors.forEach(e => fail('Deepglow: ' + e));
  // win: carry the last pearls to the boat
  {
    const probe = `local _u, _d = _update, _draw
function _update() if t() == 5 then for i = 1, 5 do pearls[i].got, pearls[i].carried = true, true end px, py = 170, SURF end _u() end
function _draw() _d() if t() == 20 then print("res", banked(), GAME.state) end end`;
    if (load(probe)) fail('win probe did not load');
    for (let f = 0; f < 22; f++) M._bkw_frame(0, 0);
    expect('bringing 5 pearls up wins', (logs.find(x => x.startsWith('res')) || '').split(/\s+/).slice(1).join(' '), '5 won');
  }
  // running out of air drops the pearls you carry and wakes you at the boat
  {
    const probe = `local _u, _d = _update, _draw
function _update() if t() == 5 then pearls[2].got, pearls[2].carried = true, true py = 600 air = 3 end _u() end
function _draw() _d() if t() == 200 then print("res", pearls[2].got, carried(), py <= SURF + 4 and air == AIR_MAX) end end`;
    if (load(probe)) fail('air probe did not load');
    for (let f = 0; f < 202; f++) { M._bkw_frame(0, 0); if (f === 40) shot('deepglow-blackout'); }
    expect('blacking out', (logs.find(x => x.startsWith('res')) || '').split(/\s+/).slice(1).join(' '), 'false 0 true');
    errors.forEach(e => fail('Deepglow air: ' + e));
  }
  // the Shader gallery: every entry draws without errors
  {
    const probe = `local _u = _update
function _update() if t() == 2 then gallery_open() end _u() end`;
    if (load(probe)) fail('gallery probe did not load');
    let n = 0;
    for (let f = 0; f < 3 + 30 * 40; f++) {
      const m = f > 3 && f % 30 === 0 ? bit('right') : (f % 30 === 10 ? bit('up') : 0);
      if (M._bkw_frame(m, 0)) { fail('gallery stopped at frame ' + f + ': ' + errors.join(' ')); break; }
      if (f % 30 === 20) { n++; if (n === 13) shot('gallery-light'); if (n === 21) shot('gallery-crt'); }
    }
    errors.forEach(e => fail('gallery: ' + e));
  }
  if (!process.exitCode) console.log('shader checks passed');
})();
