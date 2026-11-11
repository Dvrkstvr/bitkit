// CI check for the Tinwing demo (studio/tinwing.js): the town, the workbench, flying, pickups, landing,
// the battery running out, and the story to the end. `node tools/tinwingtest.cjs shots/` also writes screenshots.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'tinwing']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const bit = (...names) => names.reduce((m, n) => m | (1 << B[n]), 0);
const shotDir = process.argv[2];
const D = window.BK_DEMOS.find(d => d.name === 'Tinwing');
if (!D) { fail('Tinwing is not in BK_DEMOS'); process.exit(1); }
window.BKRules.check(D).filter(r => !r.ok).forEach(r => fail(`Tinwing breaks the rule "${r.name}"`));
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
  const sys = M._bkw_sys() >> 2;
  const meta = cart.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed }));
  // load the cart straight into play (GAME_BOOT = 3), with `probe` Lua appended to the code
  const load = (probe, boot = 3, keepSave = false) => {
    errors = []; logs = [];
    if (!keepSave) M.HEAP32[M._bkw_save() >> 2] = -1;
    M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(cart.levels[0].map, M._bkw_map() >> 1);
    const pre = window.BKEntities.toLua(cart.entities, meta, 0, boot ? `GAME_BOOT = ${boot}\n` : '');
    const rc = M._bkw_load_ex(M.stringToNewUTF8(pre), M.stringToNewUTF8(D.code + '\n' + (probe || '')));
    if (rc) fail('did not load: ' + errors.join(' '));
    return !rc;
  };
  const frame = (mask = 0) => {
    const r = M._bkw_frame(mask, 0);
    if (M.HEAP32[sys] === 4) M.HEAPU16.set(cart.levels[M.HEAP32[sys + 1] - 1].map, M._bkw_map() >> 1);
    if (r) fail('stopped: ' + errors.join(' '));
    return r;
  };
  const shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    const p = M._bkw_render();
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, p, 320 * 240 * 4).slice(), 320, 240));
  };
  const last = tag => { const l = logs.filter(x => x.startsWith(tag)).pop(); return l ? l.split(/\s+/).slice(1) : []; };
  const run = (n, input) => { for (let f = 0; f < n; f++) if (frame(input ? input(f) : 0)) return false; return true; };
  // the probe prints the state every frame
  const PROBE = 'local _pd = _draw\nfunction _draw() _pd() print("tw", MODE, LEVEL, S.scrap, S.built, S.coil, S.satchel, S.done, P and math.floor(P.z) or -1, P and string.format("%.2f", P.bat) or -1, GAME.state, cutscene_playing() and "cut" or "free") end\n';
  const state = () => last('tw');
  const init = c => `local _i = _init\nfunction _init() _i() ${c} end\n`;
  const A = bit('a');

  // 1. a new game opens on the intro cutscene in town; A skips through it
  load(PROBE);
  run(2);
  if (state()[0] !== 'town' || state()[10] !== 'cut') fail('new game should start in town with the intro: ' + state().join(' '));
  run(60); shot('intro');
  run(900, f => (f % 20 === 0 ? A : 0));
  if (state()[10] !== 'free') fail('the intro should end: ' + state().join(' '));
  shot('town');

  // 2. walk to the workbench and open it
  load(PROBE + init('INTRO = false'));
  run(2);
  run(15, f => bit('left'));
  run(4, f => (f === 1 ? A : 0));
  if (state()[0] !== 'bench') fail('A next to the workbench should open it: ' + state().join(' '));
  shot('bench');
  // buy nothing (no scrap), then Fly!
  run(4, f => (f === 1 ? bit('down') : 0)); run(4, f => (f === 1 ? bit('down') : 0)); run(4, f => (f === 1 ? bit('down') : 0)); run(4, f => (f === 1 ? bit('down') : 0));
  run(4, f => (f === 1 ? A : 0));
  run(4);
  if (state()[0] !== 'fly' || state()[1] !== '2' || state()[3] !== 'true') fail('Fly! should launch the plane: ' + state().join(' '));
  run(30); shot('launch');
  // 3. full throttle climbing: the battery drains, the plane climbs
  run(240, f => A | (f < 120 ? bit('up') : 0));
  const s3 = state();
  if (!(+s3[7] > 40) || !(+s3[8] < 0.9)) fail('flying with the motor should climb and use battery: ' + s3.join(' '));
  shot('flight');
  // 4. let go: the plane glides down without using battery
  run(40);
  const bat = +state()[8];
  run(120);
  if (+state()[8] !== bat) fail('gliding should not use battery: ' + state().join(' '));

  // 5. pickups: put the plane at the Belltower top and the coil is collected
  const go = 'level(SKY)';
  load(PROBE + init('INTRO = false S.built = true') + `local _u = _update\nfunction _update() _u() if gt == 2 then ${go} end if gt == 8 then local c = ents_get("coil") local x, y = ground(c) P.x, P.y, P.z, P.launch = x - 30, y, pick_z(c) + 9, 0 P.h = 0 end end\n`);
  run(40, f => A);
  if (state()[4] !== 'true') fail('flying through the Twin Cell should pick it up: ' + state().join(' '));
  shot('coil');
  // 6. the pad lands you in town; first time with the coil Tobin comes over
  load(PROBE + init('INTRO = false S.built = true') + `local _u = _update\nfunction _update() _u() if gt == 2 then level(SKY) end if gt == 8 then P.launch = 0 P.armed = true S.coil = true P.x, P.y, P.z = PAD.x - 20, PAD.y, 12 P.h = 0 end end\n`);
  run(20);
  if (state()[0] !== 'town' || state()[10] !== 'cut') fail('landing on the pad should go back to town and play the cutscene: ' + state().join(' '));
  // quick resume: the landing saved a checkpoint, Continue on the title screen goes straight back to town with the coil
  run(5);
  load(PROBE, 0, true); run(3);
  frame(A); run(3);
  if (state()[9] !== 'play' || state()[0] !== 'town' || state()[4] !== 'true') fail('Continue should carry on in town with the Twin Cell: ' + state().join(' '));
  // 7. battery flat over water: the plane splashes down and Tobin brings you home
  load(PROBE + init('INTRO = false S.built = true') + `local _u = _update\nfunction _update() _u() if gt == 2 then level(SKY) end if gt == 8 then P.launch = 0 P.bat = 0 P.x, P.y, P.z = 600, 400, 20 end end\n`);
  run(400);
  if (state()[0] !== 'town' || state()[10] !== 'cut') fail('a flat battery should end in the water and back in town: ' + state().join(' '));
  // 8. the satchel brought home wins the game
  load(PROBE + init('INTRO = false S.built = true') + `local _u = _update\nfunction _update() _u() if gt == 2 then level(SKY) end if gt == 8 then P.launch = 0 local c = ents_get("satchel") local x, y = ground(c) P.x, P.y, P.z, P.h = x - 30, y, pick_z(c) + 9, 0 end if gt == 30 then P.armed = true P.x, P.y, P.z = PAD.x - 20, PAD.y, 12 end end\n`);
  run(40, f => A);
  shot('satchel-home');
  if (state()[6] !== 'true' || state()[5] !== 'true') fail('bringing the satchel home should finish the story: ' + state().join(' '));
  for (let f = 0; f < 1500 && state()[10] === 'cut'; f++) frame(f % 20 === 0 ? A : 0);
  run(5);
  if (state()[9] !== 'won') fail('the goal complete screen should show: ' + state().join(' '));
  shot('won');
  // 9. the title screen draws over the town
  load(PROBE, 0); run(5); shot('title');
  if (state()[9] !== 'title') fail('should open on the title screen: ' + state().join(' '));
  load(PROBE + init('INTRO = false')); run(5); shot('town');
  if (!process.exitCode) console.log('tinwing ok');
})();
