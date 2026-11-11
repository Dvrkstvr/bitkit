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
  const PROBE = 'local _pd = _draw\nfunction _draw() _pd() print("tw", MODE, S.scrap, S.coil, S.satchel, S.done, P and math.floor(P.z) or -1, P and string.format("%.2f", P.bat) or -1, GAME.state, cutscene_playing() and "cut" or "free", #problems(), H and H.tab or 0, S.shape.nose, S.sel.m, S.sel.c) end\n';
  const st = () => last('tw');
  const init = c => `local _i = _init\nfunction _init() _i() ${c} end\n`;
  const A = bit('a');
  const tap = (...n) => { frame(bit(...n)); frame(0); };
  const skipCut = () => { for (let f = 0; f < 2000 && st()[8] === 'cut'; f++) frame(f % 12 === 0 ? A : 0); run(2); };
  const fly = (setup, at) => `local _u = _update\nfunction _update() _u() if gt == ${at || 30} then ${setup} end end\n`;

  // 1. a new game opens in the hangar with the intro; the default plane is ready to fly
  load(PROBE);
  run(3);
  if (st()[0] !== 'hangar' || st()[8] !== 'cut') fail('a new game should start in the hangar with the intro: ' + st().join(' '));
  run(60); shot('intro');
  skipCut();
  if (st()[8] !== 'free' || st()[9] !== '0') fail('after the intro the default plane should be ready: ' + st().join(' '));
  shot('blueprint-side');

  // 2. the blueprint: A grabs the nose, right moves it forward a quarter step per press, A drops it
  tap('a'); for (let i = 0; i < 4; i++) tap('right'); tap('a');
  if (+st()[11] !== 12) fail('moving the nose should lengthen the plane to 12: ' + st().join(' '));
  tap('r'); shot('blueprint-top');
  if (st()[10] !== '2') fail('R should switch to the top view: ' + st().join(' '));

  // 3. parts: buy the Buzzer with scrap; it doesn't fit the stock nose, so FLY refuses until the body grows
  load(PROBE + init('INTRO = false S.scrap = 6'));
  run(3);
  tap('r'); tap('r');                     // PARTS
  tap('right'); tap('a');                 // Buzzer: bought and fitted
  if (st()[1] !== '0' || st()[12] !== '2') fail('A should buy and fit the Buzzer: ' + st().join(' '));
  if (st()[9] !== '1') fail('the Buzzer should not fit the stock nose: ' + st().join(' '));
  shot('parts');
  tap('r'); tap('a'); run(2);             // FLY: refused
  if (st()[0] !== 'hangar') fail('FLY should refuse while a part does not fit: ' + st().join(' '));
  shot('preflight');
  // make the front of the body taller and wider on the blueprint (side view: front top up, front bottom down)
  tap('r');                               // round to SIDE
  tap('left');                            // nose -> the next corner back (front top)
  tap('a'); for (let i = 0; i < 4; i++) tap('up'); tap('a');
  tap('down');                            // front bottom
  tap('a'); for (let i = 0; i < 4; i++) tap('down'); tap('a');
  tap('r');                               // TOP: front width
  tap('a'); for (let i = 0; i < 4; i++) tap('right'); tap('a');
  shot('reshaped');
  if (st()[9] !== '0') fail('a bigger front should fit the Buzzer: ' + st().join(' ') + ' ' + logs.filter(l => l.startsWith('ERR')).join(' '));
  tap('r'); tap('r'); tap('a'); run(3);   // FLY
  if (st()[0] !== 'fly') fail('FLY should launch once everything fits: ' + st().join(' '));
  run(30); shot('launch');

  // 4. full throttle climbing uses battery; gliding doesn't
  run(240, f => A | (f < 120 ? bit('up') : 0));
  if (!(+st()[5] > 40) || !(+st()[6] < 0.95)) fail('flying with the motor should climb and use battery: ' + st().join(' '));
  run(30, f => A | bit('right'));
  shot('flight');
  run(40);
  const bat = +st()[6];
  run(120);
  if (+st()[6] !== bat) fail('gliding should not use battery: ' + st().join(' '));

  // 5. flying through the Twin Cell on the Belltower picks it up
  load(PROBE + init('INTRO = false fly_start()') + fly('local c = ents_get("coil") local x, y = ground(c) P.x, P.y, P.z, P.launch, P.h = x - 30, y, pick_z(c) + 9, 0, 0'));
  run(45, () => A);
  if (st()[2] !== 'true') fail('flying through the Twin Cell should pick it up: ' + st().join(' '));
  shot('coil');
  // 6. landing on the pad goes back to the hangar, and Tobin talks about the Twin Cell
  load(PROBE + init('INTRO = false fly_start()') + fly('P.launch = 0 P.armed = true S.coil = true S.own.c2 = true P.x, P.y, P.z, P.h = PAD.x - 20, PAD.y, 12, 0'));
  run(40);
  if (st()[0] !== 'hangar' || st()[8] !== 'cut') fail('landing should return to the hangar with a cutscene: ' + st().join(' '));
  skipCut();
  // the Twin Cell is too wide for the stock body
  tap('r'); tap('r'); tap('down'); tap('right'); tap('a');
  if (st()[13] !== '2' || st()[9] !== '1') fail('the Twin Cell should be fitted but too wide for the stock body: ' + st().join(' '));
  // quick resume: Continue goes straight back to the hangar with the Twin Cell
  run(5);
  load(PROBE, 0, true); run(3);
  frame(A); run(3);
  if (st()[7] !== 'play' || st()[0] !== 'hangar' || st()[2] !== 'true' || st()[13] !== '2') fail('Continue should carry on in the hangar with the Twin Cell: ' + st().join(' '));

  // 7. a flat battery over the sea: splash, and Tobin brings the plane back to the hangar
  load(PROBE + init('INTRO = false fly_start()') + fly('P.launch = 0 P.bat = 0 P.x, P.y, P.z = 600, 400, 20'));
  run(400);
  if (st()[0] !== 'hangar' || st()[8] !== 'cut') fail('a flat battery should end in the water and back in the hangar: ' + st().join(' '));

  // 8. the satchel brought home wins the game
  load(PROBE + init('INTRO = false fly_start()') + fly('P.launch = 0 local c = ents_get("satchel") local x, y = ground(c) P.x, P.y, P.z, P.h = x - 30, y, pick_z(c) + 9, 0') +
    fly('P.armed = true P.x, P.y, P.z, P.h = PAD.x - 20, PAD.y, 12, 0', 60));
  run(70, () => A);
  if (st()[4] !== 'true' || st()[3] !== 'true') fail('bringing the satchel home should finish the story: ' + st().join(' '));
  skipCut(); run(3);
  if (st()[7] !== 'won') fail('the goal complete screen should show: ' + st().join(' '));
  shot('won');

  // 9. the title screen
  load(PROBE, 0); run(5); shot('title');
  if (st()[7] !== 'title') fail('should open on the title screen: ' + st().join(' '));
  if (!process.exitCode) console.log('tinwing ok');
})();
