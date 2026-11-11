// CI check for Snowbelly (studio/snowbelly.js): it loads, meets the game rules, a run plays from the start gate
// to the podium alone, with 4 players split screen and 8 on linked Bits (which must stay in step), and its own
// rules work: rings, flags, tricks, landings, crates, playstyles. `node tools/snowbellytest.cjs shots/` writes PNGs.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'snowbelly']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const bit = (...names) => names.reduce((m, n) => m | (1 << B[n]), 0);
const shotDir = process.argv[2];

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
  const M2 = await runtime({ onLog: (m, e) => { if (e) errors.push('bit 2: ' + m); else logs.push('B2 ' + m); } });
  M._bkw_init(); M2._bkw_init();
  let D = null, cart = null;
  const use = name => {
    D = window.BK_DEMOS.find(d => d.name === name);
    if (!D) { fail(name + ' is not in BK_DEMOS'); process.exit(1); }
    window.BKRules.check(D).filter(r => !r.ok).forEach(r => fail(`${name} breaks the rule "${r.name}"`));
    cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    D.buildGfx(cart);
  };
  // boot: 3 = straight into play (what the editors do), 2 = New game, 0 = the title screen. keep: don't wipe the save.
  const load = (R, probe, players = 1, me = 0, boot = 3, keep = false) => {
    R._bkw_players(players, me);
    if (!keep) R.HEAP32[R._bkw_save() >> 2] = -1;
    R.HEAPU8.set(cart.tiles, R._bkw_tiles()); R.HEAPU8.set(cart.flags, R._bkw_flags()); R.HEAPU16.set(cart.map, R._bkw_map() >> 1);
    const pre = window.BKEntities.toLua(cart.entities, [{ name: 'Level', w: 40, h: 30, placed: [] }], 0, boot ? `GAME_BOOT = ${boot}\n` : '');
    return R._bkw_load_ex(R.stringToNewUTF8(pre), R.stringToNewUTF8(D.code + '\n' + (probe || '')));
  };
  const shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    const p = M._bkw_render();
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, p, 320 * 240 * 4).slice(), 320, 240));
  };
  // run a scenario: `setup` (Lua) runs once at frame 5, `every` (Lua) runs every frame after it, `pads` (Lua) after the buttons are read, `check` (Lua) prints at frame `at`
  const scenario = (name, o) => {
    errors = []; logs = [];
    const probe = (o.pads ? `local _rp = read_pads\nfunction read_pads() _rp() if t() > 5 then ${o.pads} end end\n` : '') +
      `local _u, _d = _update, _draw\nfunction _update() if t() == 5 then ${o.setup || ''} end _u() if t() >= 5 then ${o.every || ''} end end\n` +
      `function _draw() _d() if t() == ${o.at} then print("res", ${o.check}) end end`;
    if (load(M, probe, o.players || 1)) { fail(name + ': did not load: ' + errors.join(' ')); return []; }
    for (let f = 0; f <= o.at + 2; f++) {
      const m = o.input ? o.input(f) : [0];
      for (let p = 2; p <= (o.players || 1); p++) M._bkw_input(p, m[p - 1] || 0, 0);
      if (M._bkw_frame(m[0] || 0, 0)) { fail(name + ': stopped at frame ' + f + ' ' + errors.join(' ')); break; }
      if (o.shot && f === o.shot[0]) shot(o.shot[1]);
    }
    errors.forEach(e => fail(name + ': ' + e));
    const l = logs.find(x => x.startsWith('res'));
    if (!l) { fail(name + ': no result'); return []; }
    return l.split(/\s+/).slice(1);
  };
  const expect = (name, o, want) => { const got = scenario(name, o).join(' '); if (got !== want) fail(`${name}: got "${got}", expected "${want}"`); };
  let seed = 7;
  const rr = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const randMask = () => (rr() < 0.4 ? bit('right') : rr() < 0.5 ? bit('left') : 0) | (rr() < 0.3 ? bit('down') : rr() < 0.4 ? bit('up') : 0) |
    (rr() < 0.3 ? bit('a') : 0) | (rr() < 0.1 ? bit('b') : 0) | (rr() < 0.25 ? bit('x') : 0);
  // players mash buttons for a while in the given mode: nothing may break
  const mash = (name, mode, players, frames, shotAt) => {
    errors = []; logs = []; seed = 11 + players;
    if (load(M, `local _u = _update\nfunction _update() if t() == 5 then ${mode} end _u() end`, players)) { fail(name + ': did not load: ' + errors.join(' ')); return; }
    const masks = new Array(9).fill(0);
    for (let f = 0; f < frames; f++) {
      if (f % 7 === 0) for (let p = 1; p <= players; p++) masks[p] = randMask();
      for (let p = 2; p <= players; p++) M._bkw_input(p, masks[p], 0);
      if (M._bkw_frame(masks[1], 0)) { fail(name + ': stopped at frame ' + f + ' ' + errors.join(' ')); break; }
      if (shotAt && f === shotAt[0]) shot(shotAt[1]);
    }
    errors.forEach(e => fail(name + ': ' + e));
  };
  // linked Bits: two runtimes fed the same buttons, each showing its own player, must stay identical
  const linked = (name, hash, players = 3) => {
    errors = []; logs = []; seed = 23;
    const probe = `local _u = _update\nfunction _update() _u() if t() % 240 == 0 then print("sync", t(), state, ${hash}, rnd(1000)) end end`;
    if (load(M, probe, players, 1) || load(M2, probe, players, 2)) { fail(name + ': linked Bits did not load'); return; }
    const masks = new Array(9).fill(0);
    for (let f = 0; f < 7200; f++) {
      if (f % 9 === 0) for (let p = 1; p <= players; p++) masks[p] = randMask();
      for (let p = 2; p <= players; p++) { M._bkw_input(p, masks[p], 0); M2._bkw_input(p, masks[p], 0); }
      if (M._bkw_frame(masks[1], 0) || M2._bkw_frame(masks[1], 0)) { fail(name + ': linked Bits stopped at frame ' + f + ' ' + errors.join(' ')); break; }
    }
    const a = logs.filter(l => l.startsWith('sync')).map(l => l.split(/\s+/).slice(1).join(' '));
    const b = logs.filter(l => l.startsWith('B2 sync')).map(l => l.split(/\s+/).slice(2).join(' '));
    if (a.length < 25 || a.join('|') !== b.join('|')) fail(name + ': linked Bits drifted apart:\n  bit 1: ' + a.slice(0, 6).join(' | ') + '\n  bit 2: ' + b.slice(0, 6).join(' | '));
    if (!a.some(l => l.split(' ')[1] !== 'pick')) fail(name + ': the linked players never got past the game picker');
    errors.forEach(e => fail(name + ' linked: ' + e));
  };
  // the title screen comes up first, New game makes a save, and after a reload Continue goes straight back into play
  const resume = (name, newGame, check, want) => {
    errors = []; logs = [];
    const probe = `local _o = _bk_overlay\nfunction _bk_overlay() if _o then _o() end print("gs", GAME.state, (table.concat(GAME.items or {}, "|"):gsub(" ", "_")), ${check}) end\n` +
      `local _u = _update\nfunction _update() if t() == 30 and GAME.state == "play" and not NOSETUP then ${newGame} end _u() end`;
    const last = () => (logs.filter(x => x.startsWith('gs')).pop() || '').split(/\s+/).slice(1);
    load(M, probe, 1, 0, 0);
    for (let f = 0; f < 3; f++) M._bkw_frame(0, 0);
    if (last()[0] !== 'title' || !last()[1].startsWith('New_game')) fail(`${name} should open on its title screen with New game, got ${last().join(' ')}`);
    shot(name.toLowerCase().replace(/\s+/g, '-') + '-title');
    M._bkw_frame(bit('a'), 0);
    for (let f = 0; f < 60; f++) M._bkw_frame(0, 0);
    if (last()[0] !== 'play') fail(`${name}: New game should start play, got ${last()[0]}`);
    load(M, 'NOSETUP = true\n' + probe, 1, 0, 0, true);          // the Bit was switched off and on again
    for (let f = 0; f < 3; f++) M._bkw_frame(0, 0);
    if (!last()[1].startsWith('Continue')) fail(`${name}: after playing, the title screen should offer Continue, got ${last()[1]}`);
    M._bkw_frame(bit('a'), 0);
    for (let f = 0; f < 3; f++) M._bkw_frame(0, 0);
    const got = last();
    if (got[0] !== 'play' || got.slice(2).join(' ') !== want) fail(`${name}: Continue should carry on (${want}), got ${got[0]} ${got.slice(2).join(' ')}`);
    errors.forEach(e => fail(name + ' resume: ' + e));
  };

  // ================================================================ Puffball

  use('Snowbelly');
  const T = 'state, state_t = "race", 0 race_t = 1 ';      // skip the countdown
  // a solo run with nobody touching anything: the slope carries you to the finish and the results come up
  expect('ride to the finish', { setup: 'start_run(1)', check: 'state, riders[1].fin ~= nil, riders[1].pts > 0, #riders', at: 6000,
    shot: [400, 'snowbelly-start'] }, 'results true true 4');
  shot('snowbelly-results');
  // the camera ride for screenshots of each slope
  for (const [n, f, nm] of [[1, 900, 'frostpine'], [2, 1100, 'gully'], [3, 900, 'aurora']])
    scenario('slope ' + n, { setup: 'start_run(' + n + ')', check: 'riders[1].z', at: f, shot: [f, 'snowbelly-' + nm] });
  // rings: flying through one scores, missing doesn't
  expect('ring', { setup: 'start_run(1) ' + T + 'local o = RINGS[1] local z = (o.s - 1 + (o.zf or 0.5)) * SL - 3 r = riders[1] r.z, r.x, r.v = z, o.x, 0.4 r.h = ground(z, o.x) + o.h - 0.5 r.vy = 0.003 r.air = true',
    check: 'riders[1].ring_n >= 1, riders[1].pts >= 100', at: 30 }, 'true true');
  // gates: between the flags +50
  expect('gate', { setup: 'start_run(1) ' + T + 'local o = GATES[1] r = riders[1] r.z, r.x, r.v = (o.s - 0.5) * SL - 2, o.x, 0.3 r.h = ground(r.z, r.x)',
    every: 'riders[1].x = GATES[1].x', check: 'riders[1].gate_n, riders[1].pts', at: 30 }, '1 50');
  // a trick finished in the air and landed right away is PERFECT; one still turning when you land is a wipeout
  expect('perfect twirl', { setup: 'start_run(1) ' + T + 'r = riders[1] r.air, r.h, r.vy = true, ground(r.z, r.x) + 4.6, 0',
    input: f => [f >= 8 && f < 20 ? bit('b') : 0], check: 'riders[1].trick_pts, riders[1].tumble, riders[1].air', at: 80 }, '120 0 false');
  expect('wipeout', { setup: 'start_run(1) ' + T + 'r = riders[1] r.air, r.h, r.vy = true, ground(r.z, r.x) + 2.5, 0.05',
    input: f => [f >= 8 ? bit('b') : 0], check: 'riders[1].trick_pts, riders[1].tumble > 0', at: 60 }, '0 true');
  expect('guard saves', { setup: 'start_run(1) ' + T + 'r = riders[1] r.guard = true r.air, r.h, r.vy = true, ground(r.z, r.x) + 2.5, 0.05',
    input: f => [f >= 8 ? bit('b') : 0], check: 'riders[1].tumble, riders[1].guard', at: 60 }, '0 false');
  // after a jump you land and stay on the snow (landing with vertical speed 0 used to relaunch you every frame)
  expect('lands and stays down', { setup: 'start_run(1) ' + T + 'airn = 0 r = riders[1] r.z, r.x, r.v = 200, 0, 0.45 r.h = ground(200, 0)', every: 'if t() > 80 and riders[1].air then airn = airn + 1 end',
    input: f => [f === 20 ? bit('a') : 0], check: 'airn < 20, riders[1].air', at: 380 }, 'true false');
  // a crate gives an item; X uses it
  expect('crate', { setup: 'start_run(1) ' + T + 'local o = CRATES[2] r = riders[1] r.z, r.x, r.v = (o.s - 0.5) * SL - 2, o.x, 0.3 r.h = ground(r.z, r.x)',
    every: 'riders[1].x = CRATES[2].x', check: '(riders[1].item or riders[1].guard) and "got" or "none"', at: 30 }, 'got');
  expect('snowball hits', { players: 1, setup: 'start_run(1) ' + T + 'r = riders[1] r.item, r.ammo = 1, 3 riders[2].z = r.z + 8 riders[2].x = r.x riders[2].v = r.v',
    every: 'riders[2].x = riders[1].x', input: f => [f === 10 ? bit('x') : 0], check: 'riders[1].ammo, riders[2].tumble > 0 or riders[2].v', at: 60 }, '2 true');
  // a perfect pop at the lip of a ramp
  expect('perfect pop', { setup: 'start_run(1) ' + T + 'local lip for s = 1, N do if RMP[s] == 99 then lip = s break end end r = riders[1] r.z, r.x, r.v = (lip - 1) * SL - 1.2, 0, 0.4 r.h = ground(r.z, 0)',
    input: f => [f === 6 ? bit('a') : 0], check: 'riders[1].air, riders[1].pts', at: 8 }, 'true 50');
  // playstyles: a seal gets faster on a long slope, a penguin turns sharper
  const race2 = (sp, chk, input, at = 400) => scenario('style ' + sp, { setup: 'looks[1].sp = ' + sp + ' start_run(1) ' + T, check: chk, at, input });
  const pv = +race2(1, 'riders[1].v')[0], sv = +race2(2, 'riders[1].v')[0];
  if (!(sv > pv)) fail(`seals should be faster at the top: seal ${sv} penguin ${pv}`);
  const px = +race2(1, 'riders[1].x', f => [f > 5 && f < 30 ? bit('right') : 0], 30)[0];
  const sx = +race2(2, 'riders[1].x', f => [f > 5 && f < 30 ? bit('right') : 0], 30)[0];
  if (!(px > sx)) fail(`penguins should turn sharper: penguin ${px} seal ${sx}`);
  // the rider yard and the slope picker: everyone picks a look, A ready, then player 1 picks the cup
  expect('yard', { players: 2, setup: '', check: 'state, looks[1].sp, looks[1].co, looks[2].sc, cup ~= nil', at: 120,
    input: f => [f === 10 ? bit('right') : f === 14 ? bit('down') : f === 18 ? bit('right') : f === 30 || f === 70 ? bit('a') : 0,
                 f === 12 ? bit('down') : f === 15 ? bit('down') : f === 20 ? bit('left') : f === 40 ? bit('a') : 0], shot: [25, 'snowbelly-yard'] }, 'count 2 2 1 true');
  // the cup: three runs, the points add up, then the podium
  expect('cup', { setup: 'cup = {run = 1, total = {}} start_run(1)', every: 'if state == "results" and state_t == 70 then btn_a = true end',
    pads: 'if state == "results" and state_t > 62 and state_t < 66 then edge[1].a = true end', check: 'state, cup and cup.run', at: 18000 }, 'podium 3');
  shot('snowbelly-podium');
  mash('1 player', 'start_run(2)', 1, 4000);
  mash('4 players split screen', 'start_run(1)', 4, 3000, [1200, 'snowbelly-4-players']);
  mash('8 players', 'start_run(3)', 8, 3000);
  mash('from the yard', '', 3, 2000);
  linked('snowbelly', '(riders[3] and (math.floor(riders[1].z * 100) + math.floor(riders[2].x * 100) * 3 + riders[1].pts * 7 + riders[2].pts + riders[3].pts * 11 + #balls) or 0)');
  resume('Snowbelly', 'cup = {run = 2, total = {p1 = 900}} start_run(2)', 'course_n, cup and cup.run, cup and cup.total.p1', '2 2 900');

  if (process.env.TIMING) {
    for (const [nm, setup] of [['race', 'start_run(1) state = "race"'], ['pipe race', 'start_run(2) state = "race"'], ['4 views', 'start_run(1) state = "race"']]) {
      const np = nm === '4 views' ? 4 : 1;
      load(M, `local _u = _update\nfunction _update() if t() == 5 then ${setup} end _u() end`, np);
      for (let f = 0; f < 200; f++) M._bkw_frame(0, 0);
      const t0 = process.hrtime.bigint();
      for (let f = 0; f < 1500; f++) M._bkw_frame(f % 40 < 20 ? bit('right') : bit('left'), 0);
      console.log(nm, (Number(process.hrtime.bigint() - t0) / 1e6 / 1500).toFixed(3), 'ms/frame');
    }
  }
  if (process.env.SHOWCASE) for (const f of process.env.SHOWCASE.split(',')) {
    const [c, fr] = f.split(':');
    scenario('showcase', { setup: 'start_run(' + c + ') riders[1].pn = 0 riders[1].skill = 0.95', check: 'riders[1].z', at: +fr, shot: [+fr, 'show-' + c + '-' + fr] });
  }
  if (!process.exitCode) console.log('ok: Snowbelly passed (rules, a full run, rings, flags, tricks, crates, playstyles, yard, cup, 4 and 8 players, linked Bits, Continue)');
})();
