// Presses A at many different moments while running right; every press on the ground must jump.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
require('../studio/runtime.js')({ onLog: (m, e) => e && console.log('ERR', m) }).then(M => {
  M._mbw_init();
  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.MB_DEMO.buildGfx(cart);
  M.HEAPU8.set(cart.tiles, M._mbw_tiles()); M.HEAPU8.set(cart.flags, M._mbw_flags()); M.HEAPU16.set(cart.map, M._mbw_map() >> 1);
  const code = window.MB_DEMO.code.replace('sfx("C5"', 'print("JUMP") sfx("C5"');
  M._mbw_load(M.stringToNewUTF8(code));
  let jumps = 0, presses = 0; const press = M._malloc(12);
  const orig = M.onLog; M.onLog = (m, e) => { if (m === 'JUMP') jumps++; else if (e) console.log(m); };
  for (let f = 0; f < 2000; f++) {
    const a = (f % 47) < 2;   // tap A for 2 frames every 47 frames
    if (a && f % 47 === 0) presses++;
    const mask = (1 << 1) | (a ? 1 << 4 : 0);
    M._mbw_frame(mask, 0);
  }
  console.log('presses', presses, 'jumps', jumps);
});
