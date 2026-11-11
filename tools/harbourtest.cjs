// CI check for the Beacon Keeper demo: plays day and night with scripted input, then checks the
// clockwork lens, pirates and cannons, the shop, and save data with offline earnings.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/harbour.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const runtime = require('../studio/runtime.js');
runtime({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(async M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const D = (window.BK_DEMOS || []).find(d => d.name === 'Beacon Keeper');
  if (!D) { fail('harbour.js did not register itself in BK_DEMOS'); return; }
  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  D.buildGfx(cart);
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags());
  const ents = s(window.BKEntities.toLua(cart.entities));
  const press = M._malloc(16), sv = M._bkw_save() >> 2;
  const frame = (mask, analog) => {
    for (let i = 0; i < 12; i++) M.HEAPU8[press + i] = (mask >> i) & 1 ? 255 : 0;
    for (const k in analog || {}) { M.HEAPU8[press + B[k]] = analog[k]; if (analog[k]) mask |= 1 << B[k]; }
    return M._bkw_frame(mask, press);
  };
  const setSave = str => {
    if (str == null) { M.HEAP32[sv] = -1; return; }
    const b = Buffer.from(str); M.HEAPU8.set(b, (sv + 2) << 2); M.HEAP32[sv] = b.length; M.HEAP32[sv + 1] = 0;
  };
  const probe = '\nlocal _u = _update\nfunction _update() _u() if t() % 600 == 0 then print("st", G.coins, G.docked, G.lost, #ships, #pirates, G.day, is_night() and 1 or 0, G.tank, report and report.earned or -1, scared or 0, sunk or 0) end end\n' +
    'local _f = float\nfunction float(x, y, s, c) if s == "scared!" then scared = (scared or 0) + 1 elseif s == "+12" then sunk = (sunk or 0) + 1 end _f(x, y, s, c) end\n';
  const last = () => { const l = logs.filter(x => x.startsWith('st')).pop(); return l ? l.split(/\s+/).slice(1).map(Number) : null; };
  const load = save => { setSave(save); logs = []; if (M._bkw_load_ex(ents, s(D.code + probe)) !== 0) fail('Beacon Keeper did not load'); };

  // 1. a full day and night of sweeping, squeezing R and L, the foghorn and the shop, from a fresh start
  load(null);
  for (let f = 0; f < 7400; f++) {
    const ph = Math.floor(f / 90) % 4;
    let mask = ph === 0 ? 1 << B.left : ph === 2 ? 1 << B.right : 0;
    if (f % 1500 === 700) mask |= 1 << B.b;
    if (f === 3000 || f === 3040) mask |= 1 << B.x;                 // open and close the shop
    if (f > 3000 && f < 3040 && f % 8 === 0) mask |= 1 << B.down;
    if (frame(mask, { r: (f % 400) < 150 ? 200 : 0, l: (f % 700) < 100 ? 255 : 0 })) { fail('game stopped at frame ' + f); break; }
  }
  let v = last();
  if (!v || v[1] + v[2] < 10) fail('too few ships came by in a day and a night: ' + v);
  if (!v || v[5] !== 2 || v[6] !== 0) fail('the day/night cycle did not reach day 2: ' + v);
  if (M.HEAP32[sv + 1] !== 1) fail('the game never called save()');
  if (errors.length) { errors.forEach(e => fail('play: ' + e)); errors = []; }

  // 2. hands off with the best clockwork lens and four cannons: more ships dock than are lost, pirates get dealt with
  load('{coins=0, auto=3, cannon=4, lens=5, harbour=2, day=3, clk=0}');
  for (let f = 0; f < 7200; f++) if (frame(0)) { fail('auto play stopped at frame ' + f); break; }
  v = last();
  if (!v || v[1] <= v[2]) fail(`clockwork lens docked ${v && v[1]} ships but lost ${v && v[2]}`);
  if (!v || v[9] + v[10] < 1) fail('no pirate was scared off or sunk in a whole night: ' + v);
  if (errors.length) { errors.forEach(e => fail('auto: ' + e)); errors = []; }

  // 3. the shop: X opens it, A buys the oil tank
  load('{coins=500}');
  frame(0); frame(1 << B.x); frame(0); frame(1 << B.a); frame(0);
  for (let f = 0; f < 600; f++) frame(0);
  v = last();
  if (!v || v[7] !== 1 || v[0] !== 480) fail('buying the oil tank: ' + v);

  // 4. offline earnings: a save from two hours ago pays out on start
  const now = Math.floor(Date.now() / 1000);
  load(`{coins=100, auto=2, lantern=2, harbour=1, ts=${now - 7200}}`);
  for (let f = 0; f < 600; f++) frame(0);
  v = last();
  if (!v || !(v[8] > 0) || v[0] <= 100) fail('offline earnings: ' + v);
  frame(1 << B.a); frame(0);
  if (errors.length) { errors.forEach(e => fail('offline: ' + e)); errors = []; }

  // 5. three players: rowboats pick up crates, unload them at the island, spill them on rocks;
  //    wrecks drop crates; player 1 hops into a boat with Y
  M._bkw_players(3, 0);
  const mp = '\nlocal _u = _update\nfunction _update()\n' +
    ' if t() == 5 then local b = boats[2] loot = {} drop_loot(b.x + 14, b.y, 1, 7) loot[1].x, loot[1].y = b.x + 14, b.y end\n' +
    ' if t() == 40 then print("pick", boats[2].cargo, boats[2].val, #loot) end\n' +
    ' if t() == 41 then c0 = G.coins boats[2].x, boats[2].y, boats[2].vx, boats[2].vy = ISLE.x, ISLE.y + ISLE.r + 8, 0, 0 end\n' +
    ' if t() == 43 then print("unload", G.coins - c0, boats[2].cargo) end\n' +
    ' if t() == 50 then local r = rocks[1] local b = boats[3] b.cargo, b.val = 3, 9 b.x, b.y, b.vx, b.vy = r.x + r.r + 7, r.y, -1.5, 0 n0 = #loot end\n' +
    ' if t() == 53 then print("spill", boats[3].cargo, #loot - n0) end\n' +
    ' if t() == 60 then local r = rocks[2] n1 = #loot ships[#ships + 1] = { k = KINDS[1], x = r.x, y = r.y, dock = DOCKS[1], a = 0, seen = 0, bob = 0 } end\n' +
    ' if t() == 62 then print("wreck", #loot - n1) end\n' +
    ' if t() == 90 then bx = boats[1].x end\n' +
    ' _u()\n' +
    ' if t() == 130 then print("p1", p1_boat and 1 or 0, math.floor(boats[1].x - bx)) end\n' +
    'end\n';
  logs = []; setSave(null);
  if (M._bkw_load_ex(ents, s(D.code + mp)) !== 0) fail('3-player game did not load');
  for (let f = 1; f <= 140; f++) {
    M._bkw_input(2, f >= 5 && f < 40 ? 1 << B.right : 0, 0);
    M._bkw_input(3, 0, 0);
    frame(f === 92 ? 1 << B.y : f > 95 ? 1 << B.right : 0);
  }
  const L = k => (logs.find(l => l.startsWith(k + '\t') || l.startsWith(k + ' ')) || '').split(/\s+/).slice(1).map(Number);
  let q = L('pick'); if (q[0] !== 1 || q[1] !== 7 || q[2] !== 0) fail('rowboat picking up a crate: ' + q);
  q = L('unload'); if (q[0] !== 7 || q[1] !== 0) fail('unloading at the island: ' + q);
  q = L('spill'); if (q[0] !== 0 || q[1] !== 3) fail('spilling cargo on a rock: ' + q);
  q = L('wreck'); if (!(q[0] >= 2)) fail('a wreck should drop crates: ' + q);
  q = L('p1'); if (q[0] !== 1 || !(q[1] > 10)) fail('player 1 hopping into a rowboat with Y: ' + q);
  if (errors.length) { errors.forEach(e => fail('3 players: ' + e)); errors = []; }

  // 6. two linked Bits fed the same buttons stay identical
  {
    const M2 = await runtime({ onLog: (m, e) => { if (e) errors.push('bit 2: ' + m); else logs.push('B2 ' + m); } });
    M2._bkw_init();
    const sync = '\nlocal _u = _update\nfunction _update() _u() if t() % 500 == 0 then local h = G.coins * 7 + #ships * 3 + #loot + #pirates for _, b in ipairs(boats) do h = h + math.floor(b.x) * 3 + math.floor(b.y) * 5 + b.cargo end for _, s in ipairs(ships) do h = h + math.floor(s.x) end print("sync", t(), h, rnd(1000)) end end';
    const boot = (R, me) => {
      R._bkw_players(2, me);
      R.HEAPU8.set(cart.tiles, R._bkw_tiles());
      R.HEAP32[R._bkw_save() >> 2] = -1;
      return R._bkw_load_ex(R.stringToNewUTF8(window.BKEntities.toLua(cart.entities)), R.stringToNewUTF8(D.code + sync));
    };
    logs = [];
    if (boot(M, 1) || boot(M2, 2)) fail('linked Bits did not load');
    for (let f = 0; f < 7400; f++) {
      const m1 = (Math.floor(f / 90) % 4 === 0 ? 1 << B.left : 0) | (f % 1500 === 700 ? 1 << B.b : 0) | (f === 3000 || f === 4500 ? 1 << B.y : 0);
      const m2 = [1 << B.left, 1 << B.up, 1 << B.right, 1 << B.down][Math.floor(f / 70) % 4];
      for (const R of [M, M2]) { R._bkw_input(2, m2, 0); if (R._bkw_frame(m1, 0)) { fail('linked Bits stopped at frame ' + f); f = 1e9; break; } }
    }
    const a = logs.filter(l => l.startsWith('sync')).map(l => l.split(/\s+/).slice(1).join(' '));
    const b = logs.filter(l => l.startsWith('B2 sync')).map(l => l.split(/\s+/).slice(2).join(' '));
    if (a.length < 10 || a.join('|') !== b.join('|')) fail('linked Bits drifted apart:\n  ' + a.join(' / ') + '\n  ' + b.join(' / '));
  }
  errors.forEach(e => fail('Lua error: ' + e));
  if (!process.exitCode) console.log('ok: Beacon Keeper day and night, clockwork lens, pirates, shop, offline earnings, rowboats, loot and linked Bits passed');
});
