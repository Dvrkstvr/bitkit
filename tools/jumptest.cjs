// Taps A at many moments while running right; every press on the ground should jump.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
require('../studio/runtime.js')({ onLog: (m, e) => e && console.log('ERR', m) }).then(M => {
  M._bkw_init();
  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.BK_DEMO.buildGfx(cart);
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(cart.map, M._bkw_map() >> 1);
  const code = window.BK_DEMO.code.replace('function _update()\n  ents_update()', `jumps, grounded_presses = 0, 0
function _update()
  local before = PLAYER.vy
  local on_ground = PLAYER.ground
  if btnp("a") and on_ground then grounded_presses = grounded_presses + 1 end
  PLAYER.invincible = true
  ents_update()
  if PLAYER.vy < -3 and before > -3 then jumps = jumps + 1 end
  if t() == 1999 then print("grounded presses", grounded_presses, "jumps", jumps) end`);
  M._bkw_load_ex(M.stringToNewUTF8(window.BKEntities.toLua(cart.entities)), M.stringToNewUTF8(code));
  M.onLog = (m, e) => console.log(e ? 'ERR ' + m : m);
  for (let f = 0; f < 2000; f++) M._bkw_frame((1 << 1) | ((f % 47) < 2 ? 1 << 4 : 0), 0);
});
