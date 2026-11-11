// Exports everything the studio's Bit plays, as files the PocketBit firmware reads from its memory:
//   carts/NN-name.bitkit   every built-in game, in the same format the studio saves (Save → Download)
//   apps/NN-name.bitkit    the Bit's apps (Hexbeat, Loopbox, Settings...) with their icon, line and save file
//   sys/home.lua           the home screen cart (with the theme code, studio/themes.js, in front)
//   sys/boot.lua           the theme's power-on animation
// Usage: node tools/export_device.cjs [out dir]   (default platform/esp32s3/flash, which the firmware build
// packs into the internal flash). MIT License.
const fs = require('fs'), path = require('path');
global.window = {};
const ROOT = path.join(__dirname, '..');
// the same files, in the same order, as studio/index.html (the ones that register games, apps and tools)
for (const f of ['demo', 'windrow', 'harbour', 'sweep', 'tracks', 'kart', 'crossgate', 'tinwing', 'deepglow', 'music', 'hexbeat',
  'loopbox', 'bitapps', 'emuapps', 'themes', 'puffball', 'hedgehogs', 'cauldron', 'entities', 'cutscenes', 'home', 'rules']) {
  const file = path.join(ROOT, 'studio', f + '.js');
  if (fs.existsSync(file)) eval(fs.readFileSync(file, 'utf8'));
}
const out = path.resolve(process.argv[2] || path.join(ROOT, 'platform/esp32s3/flash'));
const TILES = 512, MAPW = 256, MAPH = 128;

const b64 = u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
function rle(bytes) {            // byte RLE: [count, value] pairs then base64 (studio.js rle())
  const o = [];
  for (let i = 0; i < bytes.length;) {
    let n = 1; while (n < 255 && i + n < bytes.length && bytes[i + n] === bytes[i]) n++;
    o.push(n, bytes[i]); i += n;
  }
  return b64(new Uint8Array(o));
}
const slug = s => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'cart';
const levelsMeta = levels => levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track, height: L.height }));

require(path.join(ROOT, 'studio/runtime.js'))({ onLog: () => {} }).then(M => {
  M._bkw_init(); M._bkw_default_palette();
  const DEFAULT_PAL = M.HEAPU8.slice(M._bkw_palette(), M._bkw_palette() + 768);
  // a game as the studio's serialize() writes it
  function serialize(c) {
    const L0 = c.levels[0], entities = Object.assign({}, c.entities, { placed: L0.placed });
    return {
      format: 'bitkit-cart', version: 1, name: c.name, code: c.code,
      palette: b64(c.palette), tiles: rle(c.tiles), flags: rle(c.flags),
      map: rle(new Uint8Array(L0.map.buffer.slice(0))),
      levels: c.levels.map(L => Object.assign({ name: L.name, w: L.w, h: L.h, map: rle(new Uint8Array(L.map.buffer.slice(0))), placed: L.placed },
        L.track ? { track: L.track } : {}, L.height ? { height: rle(L.height) } : {})),
      entities, entities_lua: window.BKEntities.toLua(entities, levelsMeta(c.levels), 0)
    };
  }
  function blank(name, code) {
    return { name, code, palette: new Uint8Array(DEFAULT_PAL), tiles: new Uint8Array(TILES * 64), flags: new Uint8Array(TILES),
      map: new Uint16Array(MAPW * MAPH), entities: { types: [], placed: [] }, levels: null };
  }
  for (const d of ['carts', 'apps', 'sys']) { fs.rmSync(path.join(out, d), { recursive: true, force: true }); fs.mkdirSync(path.join(out, d), { recursive: true }); }
  let bytes = 0;
  const write = (rel, text) => { fs.writeFileSync(path.join(out, rel), text); bytes += Buffer.byteLength(text); };
  const nn = i => String(i + 1).padStart(2, '0');

  const demos = window.BK_DEMOS && window.BK_DEMOS.length ? window.BK_DEMOS : [window.BK_DEMO];
  demos.forEach((d, i) => {
    const c = blank(d.name, d.code);
    d.buildGfx(c);
    if (!c.levels || !c.levels.length) c.levels = [{ name: 'Level 1', w: MAPW, h: MAPH, map: c.map, placed: c.entities.placed }];
    if (window.BKTracks && window.BKTracks.beforeRun) window.BKTracks.beforeRun(c);   // track carts: edge tiles from the road segments
    write(`carts/${nn(i)}-${slug(d.name)}.bitkit`, JSON.stringify(Object.assign(serialize(c), { builtin: true })));   // builtin: the home screen shows no file name, as in the studio
  });
  (window.BK_APPS || []).forEach((a, i) => {
    const c = blank(a.name, a.code);
    c.levels = [{ name: 'App', w: MAPW, h: MAPH, map: c.map, placed: [] }];
    const icon = new Uint8Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) icon[y * 16 + x] = (a.icon[y] || [])[x] || 0;
    const o = serialize(c);
    o.builtin = true;
    o.app = { icon: b64(icon), sub: a.sub || '', saveKey: a.saveKey || a.name, settings: !!a.settings };
    write(`apps/${nn(i)}-${slug(a.name)}.bitkit`, JSON.stringify(o));
  });
  const LIB = window.BKThemes ? window.BKThemes.LIB : '';
  write('sys/home.lua', LIB + window.BK_HOME);
  if (window.BKThemes && window.BKThemes.BOOT) write('sys/boot.lua', LIB + window.BKThemes.BOOT);
  console.log(`exported ${demos.length} games, ${(window.BK_APPS || []).length} apps and the home screen to ${path.relative(process.cwd(), out) || '.'} (${(bytes / 1024).toFixed(0)} KB)`);
});
