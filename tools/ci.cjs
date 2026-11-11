// CI check: loads the WASM runtime in Node, checks error handling, then plays the demo cart
// for 3000 frames with scripted input. Exits non-zero on any Lua error.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
let errors = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
require('../studio/runtime.js')({ onLog: (m, e) => { if (e) errors.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  if (M._bkw_load(s('function _draw() cls(1) text("hi",0,0) end')) !== 0) fail('simple cart did not load');
  if (M._bkw_frame(0, 0) !== 0) fail('simple cart frame failed');
  if (M._bkw_load(s('function (')) === 0) fail('syntax error was not reported');
  M._bkw_load(s('function _update() while true do end end'));
  if (M._bkw_frame(0, 0) === 0) fail('infinite loop was not stopped by the instruction budget');
  errors = [];

  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.BK_DEMO.buildGfx(cart);
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(cart.map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities)), s(window.BK_DEMO.code)) !== 0) fail('demo did not load');
  for (let f = 0; f < 3000; f++) {
    const mask = (1 << 1) | ((f % 30) < 12 ? 1 << 4 : 0) | (f % 20 === 0 ? 1 << 5 : 0);
    if (M._bkw_frame(mask, 0)) { fail('demo stopped at frame ' + f); break; }
  }
  errors.forEach(e => fail('Lua error: ' + e));
  if (!process.exitCode) console.log('ok: runtime checks and 3000 demo frames passed');
});
