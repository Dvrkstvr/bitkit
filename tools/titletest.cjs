// CI check for title screens: every demo opens on its own animated title screen (game{title_draw = ...}),
// the shell's menu still works on it, and nothing errors while it animates.
// `node tools/titletest.cjs shots/` also writes a screenshot of each title screen.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['demo', 'harbour', 'sweep', 'tracks', 'kart', 'crossgate', 'tinwing', 'deepglow', 'windrow', 'puffball', 'hedgehogs', 'cauldron', 'mindlaps', 'entities']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
const shotDir = process.argv[2];
const SHOTS = (process.argv[3] || '150').split(',').map(Number);   // which frames to shoot
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
function png(rgba, w, h) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let errors = [], logs = [];
require('../studio/runtime.js')({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const sv = M._bkw_save() >> 2;
  const shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    const p = M._bkw_render();
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, p, 320 * 240 * 4).slice(), 320, 240));
  };
  const hash = () => { const a = M.HEAPU8.subarray(M._bkw_screen(), M._bkw_screen() + 320 * 240); let h = 0; for (let i = 0; i < a.length; i += 7) h = (h * 31 + a[i]) | 0; return h; };
  for (const d of window.BK_DEMOS) {
    const c = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    d.buildGfx(c);
    const levels = c.levels || [{ name: 'Level 1', w: 256, h: 128, map: c.map, placed: c.entities.placed }];
    const meta = levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track, height: L.height }));
    M._bkw_default_palette();
    M.HEAPU8.set(c.tiles, M._bkw_tiles()); M.HEAPU8.set(c.flags, M._bkw_flags()); M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
    M.HEAP32[sv] = -1;
    errors = []; logs = [];
    const probe = '\nlocal _pd = _bk_overlay\nfunction _bk_overlay() if _pd then _pd() end print("gs", GAME.state) print("items|" .. table.concat(GAME.items or {}, "|")) end';
    if (M._bkw_load_ex(s(window.BKEntities.toLua(c.entities, meta, 0, '')), s(d.code + probe)) !== 0) { fail(d.name + ' did not load: ' + errors.join(' ')); continue; }
    const seen = new Set();
    for (let f = 0; f < Math.max(240, ...SHOTS) + 1; f++) {
      if (M._bkw_frame(0, 0)) { fail(d.name + ' title screen stopped at frame ' + f + ': ' + errors.join(' ')); break; }
      if (f % 30 === 0) seen.add(hash());
      if (SHOTS.includes(f)) shot('title-' + d.name.toLowerCase().replace(/\s+/g, '-') + (SHOTS.length > 1 ? '-' + String(f).padStart(4, '0') : ''));
    }
    const st = (logs.filter(x => x.startsWith('gs')).pop() || '').split(/\s+/)[1];
    if (st !== 'title') fail(`${d.name} should open on its title screen, got ${st}`);
    if (seen.size < 3) fail(`${d.name}'s title screen should be animated`);
    if (!/\btitle_draw\s*=/.test(d.code)) fail(`${d.name} should draw its own title screen (game{title_draw = ...})`);
    // Settings opened from the title keeps the art moving behind it; B goes back to the title
    const B = { up: 4, down: 8, a: 16, b: 32 };
    const tap = m => { M._bkw_frame(m, 0); M._bkw_frame(0, 0); };
    const items = () => ((logs.filter(x => x.startsWith('items|')).pop() || '').split('|').slice(1));
    const k = items().indexOf('Settings');
    if (k < 0) fail(`${d.name}: no Settings on the title screen (${items().join(', ')})`);
    for (let i = 0; i < k; i++) tap(B.down);
    tap(B.a);
    const h0 = hash();
    for (let f = 0; f < 40; f++) M._bkw_frame(0, 0);
    const st2 = (logs.filter(x => x.startsWith('gs')).pop() || '').split(/\s+/)[1];
    if (st2 !== 'settings') fail(`${d.name}: Settings should open from the title, got ${st2}`);
    if (hash() === h0) fail(`${d.name}: the title art should keep moving behind Settings`);
    shot('settings-' + d.name.toLowerCase().replace(/\s+/g, '-'));
    tap(B.b); M._bkw_frame(0, 0);
    const st3 = (logs.filter(x => x.startsWith('gs')).pop() || '').split(/\s+/)[1];
    if (st3 !== 'title') fail(`${d.name}: B in Settings should go back to the title, got ${st3}`);
    if (shotDir) {                                         // the pause menu in the game's colours
      tap(B.a); for (let f = 0; f < 60; f++) M._bkw_frame(0, 0);
      for (let n = 0; n < 2; n++) { tap(1 << 10); for (let f = 0; f < 3; f++) M._bkw_frame(0, 0); }
      shot('pause-' + d.name.toLowerCase().replace(/\s+/g, '-'));
    }
    if (errors.length) errors.forEach(e => fail(d.name + ': ' + e));
  }
  if (!process.exitCode) console.log('title screens ok: ' + window.BK_DEMOS.map(d => d.name).join(', '));
});
