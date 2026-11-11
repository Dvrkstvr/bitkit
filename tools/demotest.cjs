// Plays the demo headlessly for 3000 frames with scripted input and reports errors and events.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
require('../studio/runtime.js')({ onLog: (m, e) => console.log(e ? 'ERR' : 'LOG', m) }).then(M => {
  M._bkw_init();
  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.BK_DEMO.buildGfx(cart);
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(cart.map, M._bkw_map() >> 1);
  const data = window.BKEntities.toLua(cart.entities, cart.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed })), 0, 'GAME_BOOT = 3\n');
  const code = window.BK_DEMO.code.replace('function _draw()', 'function _draw() if t() % 500 == 0 then print("t", t(), "x", math.floor(PLAYER.x), "y", math.floor(PLAYER.y), "hp", PLAYER.hp, "score", score, "defeated", defeated, "ents", #ents_all(), "gate", #ents_all("gate"), "slow", fx_has(PLAYER, "slow")) end');
  console.log('load', M._bkw_load_ex(M.stringToNewUTF8(data), M.stringToNewUTF8(code)));
  for (let f = 0; f < 3000; f++) {
    const a = (f % 30) < 12, b = f % 20 === 0;
    const mask = (1 << 1) | (a ? 1 << 4 : 0) | (b ? 1 << 5 : 0);
    if (M._bkw_frame(mask, 0)) { console.log('stopped at', f); break; }
  }
});
