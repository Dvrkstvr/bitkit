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
  const PROBE = 'local _pd = _bk_overlay\nfunction _bk_overlay() _pd() print("tw", MODE, S.scrap, S.coil, S.satchel, S.done, P and math.floor(P.z) or -1, P and string.format("%.2f", P.bat) or -1, GAME.state, cutscene_playing() and "cut" or "free", #problems(), H and H.tab or 0, S.shape.nose, S.sel.m, S.sel.c, MODE == "fly" and P and string.format("%.2f", math.abs(angdiff(P.h, VIEW.a))) or -1, H and H.tab <= 2 and handles(H.tab)[H.sel[H.tab]].name:gsub(" ", "_") or "-", S.place.m, S.place.c, S.place.g, S.sel.g) end\n' +
    // Y (unused by the game) selects the next blueprint handle named in PICKQ, so the test needn't steer the cursor
    'local _pu = _update\nfunction _update() if btnp("y") and PICKQ and #PICKQ > 0 and H then local n = table.remove(PICKQ, 1) for i, h in ipairs(handles(H.tab)) do if h.name == n then H.sel[H.tab] = i end end end _pu() end\n';
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

  // 3. parts: buy the Buzzer with scrap; it doesn't fit in the thin nose, so FLY refuses until it moves
  load(PROBE + init('INTRO = false S.scrap = 6 PICKQ = {"Motor", "Motor", "Battery"}'));
  run(3);
  tap('r'); tap('r');                     // PARTS
  tap('right'); tap('a');                 // Buzzer: bought and fitted
  if (st()[1] !== '0' || st()[12] !== '2') fail('A should buy and fit the Buzzer: ' + st().join(' '));
  if (st()[9] !== '1') fail('the Buzzer should not fit the stock nose: ' + st().join(' '));
  shot('parts');
  tap('r'); tap('a'); run(2);             // FLY: refused
  if (st()[0] !== 'hangar') fail('FLY should refuse while a part does not fit: ' + st().join(' '));
  shot('preflight');
  // the motor can't go behind the middle of the plane, however far you push it
  tap('r');                               // round to SIDE
  tap('y'); if (st()[15] !== 'Motor') fail('Y should pick the Motor handle: ' + st().join(' '));
  tap('a'); for (let i = 0; i < 30; i++) tap('left'); tap('a');
  if (Math.abs(+st()[16] - 2.75) > 0.01) fail('the motor should stop with its back end at the Middle corners (2.75): ' + st().join(' '));
  // slide the motor back into the fat part of the body and the battery out of its way: now it fits, no reshaping
  tap('y'); tap('a'); for (let i = 0; i < 4; i++) tap('right'); tap('a');   // motor at 3.75
  tap('y'); tap('a'); for (let i = 0; i < 8; i++) tap('left'); tap('a');    // battery at -1
  shot('moved');
  if (st()[9] !== '0') fail('moving the Buzzer back and the battery out of the way should fit: ' + st().join(' '));
  tap('l'); tap('a'); run(3);            // FLY (L goes round from SIDE)
  if (st()[0] !== 'fly') fail('FLY should launch once everything fits: ' + st().join(' '));
  run(30); shot('launch');

  // 4. full throttle climbing uses battery; gliding doesn't
  run(240, f => A | (f < 120 ? bit('up') : 0));
  if (!(+st()[5] > 40) || !(+st()[6] < 0.95)) fail('flying with the motor should climb and use battery: ' + st().join(' '));
  run(30, f => A | bit('right'));
  shot('flight');
  // the chase camera stays behind the plane while it turns (it used to share a field with the model maths)
  for (let f = 0; f < 90; f++) { run(1, () => A | bit(f < 60 ? 'right' : 'left')); if (!(+st()[14] < 0.12)) { fail('the camera should stay right behind the plane in a turn, lag ' + st()[14]); break; } }
  run(40);
  const bat = +st()[6];
  run(120);
  if (+st()[6] !== bat) fail('gliding should not use battery: ' + st().join(' '));

  // 4b. the "Invert up/down" setting: Up climbs normally, and dives when it is on
  for (const [inv, climbs] of [[1, true], [2, false]]) {
    load(PROBE + init('INTRO = false fly_start()') + fly(`P.launch = 0 P.x, P.y, P.z, P.h, P.pitch, P.pv = 800, 500, 90, 0, 0, 0 local _s = setting setting = function(k) if k == "pitch" then return ${inv} end return _s(k) end`));
    run(31, () => A);
    const z0 = +st()[5];
    run(60, () => A | bit('up'));
    const up = +st()[5] > z0;
    if (up !== climbs) fail(`with Invert up/down ${inv === 2 ? 'on' : 'off'} Up should ${climbs ? 'climb' : 'dive'}: z ${z0} -> ${st()[5]}`);
  }

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

  // 10. what you see on the blueprint is what fits: fits() agrees with a fine scan of the box against the body,
  // for many random shapes and places (it used to guess the box's height and miss corners)
  load(PROBE + init(`INTRO = false
    local bad, n = 0, 0
    for k = 1, 400 do
      local s = default_shape()
      for i, st in ipairs(s.st) do st[2] = 0.6 + math.random() * 3.5 st[3] = -0.4 - math.random() * 3.5 st[4] = 0.5 + math.random() * 4 end
      s.nose = s.st[1][1] + 1.5 + math.random() * 6
      local part = (k % 2 == 0) and MOTORS[1 + k % 3] or CELLS[1 + k % 3]
      local pl = {m = s.tail + math.random() * (s.nose - s.tail), c = 99, g = 6}
      local ok, _, why = fits(s, "m", part, pl)
      local x0, x1 = slot("m", part, pl)
      local good = x0 < s.nose and x1 > s.tail
      if good then
        local lo, hi, wm = -99, 99, 99
        for i = 0, 400 do local t, b, w = section(s, x1 + (x0 - x1) * i / 400) lo, hi, wm = math.max(lo, b), math.min(hi, t), math.min(wm, w) end
        good = hi - lo >= part.h - 0.01 and wm * 2 >= part.w - 0.01
      end
      local geo = ok or why == "front" or why == "overlap"
      if geo ~= good then bad = bad + 1 end
      n = n + 1
    end
    print("fitprop", bad, n)`));
  run(2);
  if (last('fitprop')[0] !== '0') fail('fits() should match the blueprint for every shape, mismatches: ' + last('fitprop').join(' '));

  // 11. cannons: buy the Cork Popper, they go on the wings; slid off the tip they don't fit
  load(PROBE + init('INTRO = false S.scrap = 4 PICKQ = {"Cannons"}'));
  run(3);
  tap('r'); tap('r'); tap('down'); tap('down'); tap('right'); tap('a');
  if (st()[19] !== '2' || st()[1] !== '0' || st()[9] !== '0') fail('A should buy the Cork Popper and it should fit: ' + st().join(' '));
  shot('cannon-parts');
  tap('l'); tap('y');                     // TOP: the Cannons handle
  if (st()[15] !== 'Cannons') fail('Y should pick the Cannons handle on TOP: ' + st().join(' '));
  tap('a'); for (let i = 0; i < 30; i++) tap('right'); tap('a');
  if (st()[9] !== '1') fail('cannons past the wing tip should be a problem: ' + st().join(' '));
  tap('a'); for (let i = 0; i < 4; i++) tap('left'); tap('a');
  if (st()[9] !== '0') fail('cannons back on the wing should fit: ' + st().join(' '));
  shot('cannon-top');
  // B fires; a balloon in front pops for 1 scrap
  load(PROBE + init('INTRO = false S.sel.g = 2 S.own.g2 = true fly_start()') +
    fly('P.launch = 0 local e = ents_all("balloon")[1] TARGET = e local x, y = ground(e) P.x, P.y, P.z, P.h, P.pitch, P.pv, P.bank, P.bv = x - 70, y, pick_z(e) + 20, 0, 0, 0, 0, 0'));
  run(31);
  run(30, f => (f < 3 ? bit('b') : 0) | A);
  shot('cannon-pop');
  if (st()[1] !== '1') fail('a cannon ball should pop the balloon for 1 scrap: ' + st().join(' '));
  if (errors.length) fail('errors: ' + errors.join(' '));

  // 9. the title screen
  load(PROBE, 0); run(5); shot('title');
  if (st()[7] !== 'title') fail('should open on the title screen: ' + st().join(' '));
  if (!process.exitCode) console.log('tinwing ok');
})();
