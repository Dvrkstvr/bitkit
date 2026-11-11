// CI check: loads the WASM runtime in Node, checks error handling, then plays the demo cart
// for 3000 frames with scripted input. Exits non-zero on any Lua error.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/home.js', 'utf8'));
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
require('../studio/runtime.js')({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  if (M._bkw_load(s('function _draw() cls(1) text("hi",0,0) end')) !== 0) fail('simple cart did not load');
  if (M._bkw_frame(0, 0) !== 0) fail('simple cart frame failed');
  if (M._bkw_load(s('function (')) === 0) fail('syntax error was not reported');
  M._bkw_load(s('function _update() while true do end end'));
  if (M._bkw_frame(0, 0) === 0) fail('infinite loop was not stopped by the instruction budget');
  errors = [];

  // home screen: lists games and asks the host to launch the selected one
  if (M._bkw_load_ex(s('BIT = { games = {{name="A", file="a.bitkit", studio=false, color=3}, {name="B", file="b.bitkit", studio=false, color=8}}, sel = 1, studio = true, source = "" }'), s(window.BK_HOME)) !== 0) fail('home screen did not load');
  const sys = M._bkw_sys() >> 2;
  M._bkw_frame(0, 0); M._bkw_frame(1 << 1, 0); M._bkw_frame(0, 0);   // right: select game 2
  M._bkw_frame(1 << 4, 0);                                         // A: launch
  if (M.HEAP32[sys] !== 1 || M.HEAP32[sys + 1] !== 2) fail(`home screen launch request was ${M.HEAP32[sys]},${M.HEAP32[sys + 1]} (expected 1,2)`);
  M._bkw_frame(0, 0);
  if (M.HEAP32[sys] !== 0) fail('system request was not cleared on the next frame');
  if (errors.length) { errors.forEach(e => fail('home screen: ' + e)); errors = []; }

  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.BK_DEMO.buildGfx(cart);
  const levels = cart.levels;
  if (!levels || levels.length < 2) fail('demo should have two levels');
  const meta = levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed }));
  // host side of level(n): copy that level's map in before the next frame
  const frame = mask => { const r = M._bkw_frame(mask, 0); if (M.HEAP32[sys] === 4) M.HEAPU16.set(levels[M.HEAP32[sys + 1] - 1].map, M._bkw_map() >> 1); return r; };
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0)), s(window.BK_DEMO.code)) !== 0) fail('demo did not load');
  for (let f = 0; f < 3000; f++) {
    const mask = (1 << 1) | ((f % 30) < 12 ? 1 << 4 : 0) | (f % 20 === 0 ? 1 << 5 : 0);
    if (frame(mask)) { fail('demo stopped at frame ' + f); break; }
  }

  // switching levels: level(2) loads the cave map and its entities, the player keeps its HP
  const probe = '\nlocal _u = _update\nfunction _update() if t() == 5 then PLAYER.hp = 2; level(2) end _u() if t() == 8 then print("probe", LEVEL, #ents_all("goal"), #ents_all("exit"), PLAYER.hp, mget(0, 0)) end end';
  M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0)), s(window.BK_DEMO.code + probe)) !== 0) fail('demo with probe did not load');
  for (let f = 0; f < 12; f++) frame(0);
  const line = logs.find(l => l.startsWith('probe'));
  const v = line ? line.split(/\s+/).slice(1).map(Number) : [];
  if (!line || v[0] !== 2 || v[1] !== 1 || v[2] !== 0 || v[3] !== 2 || v[4] !== 18) fail('level switch probe: ' + line + ' (expected level 2, 1 goal, 0 exits, hp 2, brick tile 18 at 0,0)');

  // cutscenes: the intro plays when level 1 starts, freezes the player, A advances it, START skips the rest
  logs = [];
  const cutProbe = '\nlocal _u = _update\nfunction _update() _u() local on_, nm = cutscene_playing() if t() == 2 then x0 = PLAYER.x print("cut", on_ and 1 or 0, nm) end if t() == 60 then print("frozen", PLAYER.x == x0 and 1 or 0) end end\non("cutscene_end", function(n) print("cutend", n, t()) end)';
  M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0)), s(window.BK_DEMO.code + cutProbe)) !== 0) fail('demo with cutscene probe did not load');
  for (let f = 0; f < 1200 && !logs.some(l => l.startsWith('cutend')); f++) frame((1 << 1) | ((f % 20) < 2 ? 1 << 4 : 0));
  const cl = logs.find(l => /^cut\s/.test(l)), fz = logs.find(l => l.startsWith('frozen')), ce = logs.find(l => l.startsWith('cutend'));
  if (!cl || cl.split(/\s+/)[1] !== '1' || cl.split(/\s+/)[2] !== 'intro') fail('intro cutscene did not start: ' + cl);
  if (!fz || fz.split(/\s+/)[1] !== '1') fail('player moved during a cutscene: ' + fz);
  if (!ce || ce.split(/\s+/)[1] !== 'intro') fail('intro cutscene did not finish with A presses: ' + ce);
  // START skips; a trigger-only cutscene plays from code
  logs = [];
  M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0)), s(window.BK_DEMO.code + '\non("cutscene_end", function(n) print("cutend", n, t()) end)\nlocal _u = _update\nfunction _update() _u() if t() == 30 then cutscene("gate") end end'));
  for (let f = 0; f < 40; f++) frame(f === 5 || f === 35 ? 1 << 10 : 0);
  const ends = logs.filter(l => l.startsWith('cutend')).map(l => l.split(/\s+/)[1]);
  if (ends.join() !== 'intro,gate') fail('START did not skip cutscenes: ' + ends.join());
  if (errors.length) { errors.forEach(e => fail('cutscene: ' + e)); errors = []; }

  // playing level 2 from the start
  for (let f = 0; f < 1500; f++) if (frame((1 << 1) | ((f % 30) < 12 ? 1 << 4 : 0))) { fail('level 2 stopped at frame ' + f); break; }
  errors.forEach(e => fail('Lua error: ' + e));
  if (!process.exitCode) console.log('ok: runtime checks, home screen, 3000 demo frames, level switching and cutscenes passed');
});
