// CI check for the Crossgate demo (studio/crossgate.js): shooting, parrying, stabbing, clashes, picking bolts up,
// reloading, the right of way, room changes, winning, the CPU rival, two players on one screen, and linked Bits
// staying in step. `node tools/crossgatetest.cjs shots/` also writes a few screenshots as PNGs.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'crossgate']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const bit = (...names) => names.reduce((m, n) => m | (1 << B[n]), 0);
const shotDir = process.argv[2];
const D = window.BK_DEMOS.find(d => d.name === 'Crossgate');
if (!D) { fail('Crossgate is not in BK_DEMOS'); process.exit(1); }
window.BKRules.check(D).filter(r => !r.ok).forEach(r => fail(`Crossgate breaks the rule "${r.name}"`));
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
  const s = x => M.stringToNewUTF8(x);
  const load = (R, probe, players = 1, me = 0, boot = 3) => {
    R._bkw_players(players, me);
    R.HEAP32[R._bkw_save() >> 2] = -1;                 // no save: every run (and every linked Bit) starts the same
    R.HEAPU8.set(cart.tiles, R._bkw_tiles()); R.HEAPU8.set(cart.flags, R._bkw_flags()); R.HEAPU16.set(cart.map, R._bkw_map() >> 1);
    const pre = window.BKEntities.toLua(cart.entities, [{ name: 'Town', w: 40, h: 30, placed: [] }], 0, boot ? `GAME_BOOT = ${boot}\n` : '');
    return R._bkw_load_ex(R.stringToNewUTF8(pre), R.stringToNewUTF8(D.code + '\n' + (probe || '')));
  };
  const shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    const p = M._bkw_render();
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, p, 320 * 240 * 4).slice(), 320, 240));
  };
  // run a scenario: `setup` (Lua) runs once at frame 90 (after the "DUEL!" count-in), `check` (Lua) prints at frame `at`
  const scenario = (name, setup, check, at, input) => {
    errors = []; logs = [];
    const probe = `local _u, _d = _update, _draw\nfunction _update() _u() if t() == 90 then ${setup} end end\nfunction _draw() _d() if t() == ${at} then print("res", ${check}) end end`;
    if (load(M, probe, 2)) { fail(name + ': did not load: ' + errors.join(' ')); return []; }
    for (let f = 0; f <= at + 2; f++) {
      const [m1, m2] = input ? input(f) : [0, 0];
      M._bkw_input(2, m2, 0);
      if (M._bkw_frame(m1, 0)) { fail(name + ': stopped at frame ' + f + ' ' + errors.join(' ')); break; }
    }
    errors.forEach(e => fail(name + ': ' + e));
    const l = logs.find(x => x.startsWith('res'));
    if (!l) { fail(name + ': no result'); return []; }
    return l.split(/\s+/).slice(1);
  };
  const expect = (name, got, want) => { if (got.join(' ') !== want) fail(`${name}: got "${got.join(' ')}", expected "${want}"`); };
  const at90 = (f, mask) => f >= 91 && f <= 92 ? mask : 0;   // a tap right after the setup frame

  // shooting at a different height than the rival's crossbow hits them, and the shooter gets the way
  expect('shot hits', scenario('shot hits',
    'F[1].x, F[2].x = 100, 200 F[1].stance, F[2].stance = 1, 2',
    'F[2].alive, runner, F[1].loaded, F[1].hand', 110, f => [at90(f, bit('a')), 0]), 'false 1 false false');
  // a bolt at the height of the rival's crossbow bounces off it and lies on the ground
  expect('parry', scenario('parry',
    'F[1].x, F[2].x = 100, 200 F[1].stance, F[2].stance = 2, 2 loose[room] = {}',
    'F[2].alive, runner, #loose[room]', 140, f => [at90(f, bit('a')), 0]), 'true 0 1');
  // a crouching rival ducks under a high bolt
  expect('duck', scenario('duck',
    'F[1].x, F[2].x = 100, 200 F[1].stance, F[2].stance = 1, 3',
    'F[2].alive, runner', 140, f => [at90(f, bit('a')), 0]), 'true 0');
  // a jumping rival clears a low bolt
  expect('jump', scenario('jump',
    'F[1].x, F[2].x = 100, 140 F[1].stance, F[2].stance = 3, 1',
    'F[2].alive', 140, f => [f >= 91 && f <= 92 ? bit('a') : 0, f >= 86 && f <= 87 ? bit('b') : 0]), 'true');
  // walking into an unarmed rival with a bolt loaded stabs them
  expect('stab', scenario('stab',
    'F[1].x, F[2].x = 120, 150 F[2].loaded, F[2].hand = false, false loose[room] = {}',
    'F[2].alive, runner, F[1].loaded', 120, f => [f > 90 ? bit('right') : 0, 0]), 'false 1 true');
  // two loaded crossbows at the same height clash: both are pushed back, nobody dies
  expect('clash', scenario('clash',
    'F[1].x, F[2].x = 120, 150 F[1].stance, F[2].stance = 2, 2',
    'F[1].alive, F[2].alive, F[2].x - F[1].x > 16', 115, f => [f > 90 && f < 105 ? bit('right') : 0, 0]), 'true true true');
  // walking over a bolt picks it up; an empty crossbow cranks the spare in
  expect('pickup + reload', scenario('pickup',
    'F[1].x = 60 F[1].loaded, F[1].hand = false, false F[2].x = 300 loose[room] = {{x = 90, y = 200, vy = 0, rest = true}}',
    'F[1].loaded, F[1].hand, #loose[room]', 160, f => [f > 90 && f < 110 ? bit('right') : 0, 0]), 'true false 0');
  // the runner walks off the edge into the next room; the rival comes back ahead of them
  expect('room change', scenario('room change',
    'runner = 1 F[1].x = 300 F[2].x = 40',
    'room, F[1].x < 60, F[2].alive, F[2].x > 280', 230, f => [f > 90 && f < 110 ? bit('right') : 0, 0]), '1 true true true');
  // the non-runner cannot leave the room
  expect('no way', scenario('no way',
    'runner = 1 F[1].x = 100 F[2].x = 20',
    'room, math.floor(F[2].x)', 160, f => [0, f > 90 ? bit('left') : 0]), '0 4');
  // getting out of the last gate wins
  expect('win', scenario('win',
    'room, runner = 3, 1 F[1].x = 290 F[2].alive, F[2].ghost, F[2].dead_t = false, true, 999',
    'mode, winner, GAME.state, wins[1]', 150, f => [f > 90 && f < 120 ? bit('right') : 0, 0]), 'over 1 won 1');

  // one player: a long fight against the CPU Rook. Nothing breaks, both sides shoot, somebody dies, and rooms change.
  {
    errors = []; logs = [];
    const probe = 'local _sh, _k = shoot, kill\nshots, kills = {0, 0}, 0\nfunction shoot(f) shots[f.n] = shots[f.n] + 1 _sh(f) end\nfunction kill(...) kills = kills + 1 _k(...) end\n' +
      'local _u = _update\nfunction _update() _u() if t() == 5990 then print("cpu", shots[1], shots[2], kills, room, mode) end end';
    if (load(M, probe, 1)) fail('1 player did not load: ' + errors.join(' '));
    const rooms = new Set();
    for (let f = 0; f < 6000; f++) {
      const mask = (f % 400 < 260 ? bit('right') : bit('left')) | (f % 37 === 0 ? bit('a') : 0) | (f % 90 === 0 ? bit('up') : 0) | (f % 130 === 0 ? bit('down') : 0) | (f % 71 === 0 ? bit('b') : 0);
      if (M._bkw_frame(mask, 0)) { fail('1 player stopped at frame ' + f + ' ' + errors.join(' ')); break; }
      if (f === 60) shot('ready');
      if (f === 700) shot('fight');
    }
    const c = (logs.find(l => l.startsWith('cpu')) || '').split(/\s+/);
    if (!(+c[1] > 5 && +c[2] > 5 && +c[3] > 1)) fail('1 player vs CPU: ' + c.join(' ') + ' (expected both to shoot and somebody to die)');
    errors.forEach(e => fail('1 player: ' + e));
  }
  // every room draws without errors (and makes a screenshot each)
  for (let r = -3; r <= 3; r++) {
    errors = []; logs = [];
    load(M, `local _u = _update\nfunction _update() _u() if t() == 90 then room = ${r} F[1].x, F[2].x = 100, 220 end end`, 2);
    for (let f = 0; f < 100; f++) M._bkw_frame(0, 0);
    shot('room' + r);
    errors.forEach(e => fail('room ' + r + ': ' + e));
  }
  // the title screen comes up first without GAME_BOOT
  {
    errors = []; logs = [];
    load(M, 'local _d = _draw\nfunction _draw() _d() print("gs", GAME.state) end', 1, 0, 0);
    for (let f = 0; f < 5; f++) M._bkw_frame(0, 0);
    if ((logs.pop() || '').split(/\s+/)[1] !== 'title') fail('Crossgate should open on its title screen');
    shot('title');
  }

  // two players on one screen: each side moves with its own pad
  {
    errors = []; logs = [];
    load(M, 'local _u = _update\nfunction _update() _u() if t() == 150 then print("two", math.floor(F[1].x), math.floor(F[2].x), F[1].cpu, F[2].cpu) end end', 2);
    for (let f = 0; f < 152; f++) { M._bkw_input(2, f > 90 ? bit('left') : 0, 0); M._bkw_frame(f > 90 ? bit('right') : 0, 0); }
    const t2 = (logs.find(l => l.startsWith('two')) || '').split(/\s+/);
    if (!(+t2[1] > 120 && +t2[2] < 200 && t2[3] === 'false' && t2[4] === 'false')) fail('two players on one screen: ' + t2.join(' '));
    errors.forEach(e => fail('2 players: ' + e));
  }

  // linked Bits: two runtimes fed the same inputs, each seeing its own player, stay identical
  {
    const M2 = await runtime({ onLog: (m, e) => { if (e) errors.push('bit 2: ' + m); else logs.push('B2 ' + m); } });
    M2._bkw_init();
    errors = []; logs = [];
    const probe = 'local _u = _update\nfunction _update() _u() if t() % 240 == 0 then local h = room * 1000 + (runner or 0) * 100 + #flying + #loose[room] * 7 for _, f in ipairs(F) do h = h + math.floor(f.x * 10) * f.n + math.floor(f.y) * 3 + (f.alive and 1 or 0) * 11 + f.stance end print("sync", t(), h, mode, rnd(1000)) end end';
    if (load(M, probe, 2, 1) || load(M2, probe, 2, 2)) fail('linked Bits did not load');
    let seed = 7;
    const rr = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let m1 = 0, m2 = 0;
    for (let f = 0; f < 6000; f++) {
      if (f % 9 === 0) {
        m1 = (rr() < 0.6 ? bit('right') : rr() < 0.5 ? bit('left') : 0) | (rr() < 0.15 ? bit('a') : 0) | (rr() < 0.1 ? bit('up') : 0) | (rr() < 0.1 ? bit('down') : 0) | (rr() < 0.08 ? bit('b') : 0);
        m2 = (rr() < 0.6 ? bit('left') : rr() < 0.5 ? bit('right') : 0) | (rr() < 0.15 ? bit('a') : 0) | (rr() < 0.1 ? bit('up') : 0) | (rr() < 0.1 ? bit('down') : 0) | (rr() < 0.08 ? bit('b') : 0);
      }
      M._bkw_input(2, m2, 0); M2._bkw_input(2, m2, 0);
      if (M._bkw_frame(m1, 0) || M2._bkw_frame(m1, 0)) { fail('linked Bits stopped at frame ' + f + ' ' + errors.join(' ')); break; }
    }
    const a = logs.filter(l => l.startsWith('sync')).map(l => l.split(/\s+/).slice(1).join(' '));
    const b = logs.filter(l => l.startsWith('B2 sync')).map(l => l.split(/\s+/).slice(2).join(' '));
    if (a.length < 20 || a.join('|') !== b.join('|')) fail('linked Bits drifted apart:\n  bit 1: ' + a.slice(0, 6).join(' | ') + '\n  bit 2: ' + b.slice(0, 6).join(' | '));
    errors.forEach(e => fail('linked: ' + e));
    if (process.env.VERBOSE) console.log(a.join('\n'));
  }

  if (!process.exitCode) console.log('ok: Crossgate shooting, parrying, ducking, jumping, stabbing, clashes, pickups, right of way, rooms, winning, CPU rival, 2 players and linked Bits passed');
})();
