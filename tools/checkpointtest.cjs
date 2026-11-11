// Puts the player next to the first sapling, waits for it to grow, then kills the player and checks the respawn point.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
require('../studio/runtime.js')({ onLog: (m, e) => console.log(e ? 'ERR' : 'LOG', m) }).then(M => {
  M._bkw_init();
  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.BK_DEMO.buildGfx(cart);
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(cart.map, M._bkw_map() >> 1);
  const data = window.BKEntities.toLua(cart.entities);
  const code = window.BK_DEMO.code.replace('function _update()\n  ents_update()', `function _update()
  local s = ents_all("sapling")[1]
  if t() == 1 then PLAYER.x, PLAYER.y = s.x + 20, s.y; PLAYER.invincible = true end
  if t() == 2 then local b = ents_all("button")[1] for _, o in ipairs(b.touch_now or {}) do print("button touched by", o.name, o.x, o.y) end print("button at", b.x, b.y) end
  if t() == 300 then print("bees alive", #ents_all("bee"), "sapling bar", s.bar, "player hp", PLAYER.hp) end
  if t() == 450 then print("state", s.data.state, "spawn", spawn_x, spawn_y) PLAYER.y = 400 end
  if t() == 460 then print("respawned at", PLAYER.x, PLAYER.y, "hp", PLAYER.hp) end
  if t() == 470 then local m = ents_all("mud")[1]; PLAYER.x, PLAYER.y = m.x, m.y - 2 end
  if t() == 480 then print("slowed", fx_has(PLAYER, "slow"), "speed", stat(PLAYER, "speed")) end
  if t() == 485 then local d = ents_all("drop")[1]; PLAYER.hp = 1; PLAYER.x, PLAYER.y = d.x, d.y end
  if t() == 490 then print("after drop hp", PLAYER.hp, "score", score) end
  ents_update()`);
  M._bkw_load_ex(M.stringToNewUTF8(data), M.stringToNewUTF8(code));
  for (let f = 0; f < 500; f++) if (M._bkw_frame(f % 40 === 0 ? 1 << 5 : 0, 0)) { console.log('stopped', f); break; }
});
