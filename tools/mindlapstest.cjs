// CI check for Mind Laps (studio/mindlaps.js), the daily brain jog: it loads, meets the game rules, every exercise
// scores right answers and costs for wrong ones, a perfect Daily Jog earns gold and counts towards the streak of
// days, Practice levels up, Race and Team work for 2-8 players and linked Bits stay in step. `node tools/mindlapstest.cjs shots/` writes PNGs.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'mindlaps']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
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


  use('Mind Laps');
  // a perfect player: always the right direction, A the moment a green lantern lights, A on every between-laps screen
  const PERFECT = (p) => `if (state == "intro" or state == "lapdone") and state_t > 40 then edge[${p}].a = true end ` +
    `if state == "lap" and Q and Q.done == 0 then ` +
    `if Q.ans then edge[${p}][DIRS[Q.ans]] = true ` +
    `elseif lap.e == 2 and Q.t >= Q.watch then edge[${p}][DIRS[Q.seq[Q.at[${p}] + 1]]] = true ` +
    `elseif lap.e == 5 and Q.t >= Q.wait and not Q.red then edge[${p}].a = true end end`;
  const DAY = 'function today() return 20000 end ';
  // a perfect Daily Jog: five laps, every one maxed out, gold, the goal, and the day counts (streak 4 -> 5)
  expect('daily jog: gold', { setup: DAY + 'S.last, S.streak = 19999, 4 start_run("daily")', pads: PERFECT(1),
    check: 'state, #run.scores, run.total, MEDAL[medal(run.total)][1], S.streak, S.hist[20000], S.golds, GAME.state', at: 11500, shot: [800, 'mind-laps-sums'] },
    'done 5 500 GOLD 5 500 1 won');
  // a missed day starts the streak again; a second jog on the same day doesn't count twice
  expect('daily jog: streak breaks', { setup: DAY + 'S.last, S.streak, S.top = 19990, 9, 9 start_run("daily") run.scores = {80, 80, 80, 80} run.n = 5', pads: PERFECT(1),
    every: 'if state == "done" and not first then first = S.streak start_run("daily") run.scores = {10, 10, 10, 10} run.n = 5 end',
    check: 'first, S.streak, S.top, S.hist[20000], S.last', at: 4800 }, '1 1 9 420 20000');
  // the daily laps are the same for everybody on the same day, and different the next day
  expect('daily jog: same jog for everyone', { setup: DAY + 'start_run("daily") a = table.concat(run.laps, "") .. run.seed start_run("daily") b = table.concat(run.laps, "") .. run.seed ' +
      'function today() return 20001 end start_run("daily") c = table.concat(run.laps, "") .. run.seed',
    check: 'a == b, a ~= c', at: 8 }, 'true true');
  // each exercise on its own (Practice): a perfect lap is 100 and the exercise levels up; wrong answers cost points
  for (let e = 1; e <= 5; e++) {
    expect(`practice ${e}: perfect`, { setup: `start_run("practice", ${e})`, pads: PERFECT(1),
      check: 'lap.score, S.lv[' + e + '], S.best[' + e + '], lap.wrong', at: 2200, shot: e === 2 ? [400, 'mind-laps-echo'] : e === 4 ? [300, 'mind-laps-jars'] : e === 5 ? [600, 'mind-laps-lanterns'] : e === 3 ? [300, 'mind-laps-next'] : null },
      `100 2 100 0`);
  }
  // wrong answers: sums cost 5, the lap score never goes below 0, and the level drops
  expect('practice: wrong answers', { setup: 'S.lv[1] = 4 start_run("practice", 1)',
    pads: 'if (state == "intro") and state_t > 40 then edge[1].a = true end if state == "lap" and Q.done == 0 and lap.right + lap.wrong < 3 then edge[1][DIRS[Q.ans % 4 + 1]] = true end',
    every: 'if state == "lap" and lap.left == 600 then mid_pts = lap.pts[1] end', check: 'mid_pts, lap.score, lap.wrong, S.lv[1]', at: 2100 }, '-15 0 3 3');
  // lanterns: pressing early or on red costs points and locks you out of that lantern
  expect('lanterns: too soon and red', { setup: 'start_run("practice", 5) state, state_t = "lap", 0 new_q() Q.wait, Q.red = 50, true',
    pads: 'if t() == 20 or t() == 70 then edge[1].a = true end', every: 'if t() == 21 then soon = Q.lock[1] .. lap.pts[1] Q.lock[1] = nil end',
    check: 'soon, Q.lock[1], lap.pts[1]', at: 72 }, 'soon-3 red -9');
  // a race: player 1 answers wrong and is locked out of that question, player 2 answers right and scores
  expect('race: lock out', { players: 2, setup: 'start_run("race") run.laps = {1, 3} state, state_t = "lap", 0 lap = nil begin_lap() state = "lap" new_q()',
    pads: 'if state == "lap" and Q.done == 0 and lap.qn == 1 then if not Q.lock[1] then edge[1][DIRS[Q.ans % 4 + 1]] = true else edge[2][DIRS[Q.ans]] = true end end',
    check: 'lap.pts[1], lap.pts[2], lap.qn', at: 30 }, '0 10 2');
  // a whole race between two players: the faster one wins the goal
  expect('race: winner', { players: 2, setup: 'start_run("race")', pads: PERFECT(2),
    check: 'state, run.pts[1], run.pts[2] > 300, run.winners[1], GAME.state', at: 11500, shot: [900, 'mind-laps-race'] }, 'done 0 true 2 won');
  // team: four players share one score and earn gold together
  expect('team: gold together', { players: 4, setup: 'start_run("team")', pads: PERFECT(3),
    check: 'state, run.total, GAME.state', at: 11500, shot: [3000, 'mind-laps-team'] }, 'done 500 won');
  // the picker: alone it offers Daily Jog and Practice, together Race and Team
  expect('picker: alone', { setup: '', input: f => [f === 20 ? bit('right') : f === 40 ? bit('a') : f === 60 ? bit('down') : f === 70 ? bit('a') : 0],
    check: 'state, run.mode, run.laps[1]', at: 120, shot: [10, 'mind-laps-today'] }, 'intro practice 2');
  expect('picker: together', { players: 3, setup: '', input: f => [f === 20 ? bit('right') : 0, 0, f === 40 ? bit('a') : 0],
    check: 'state, run.mode, #run.laps', at: 50, shot: [10, 'mind-laps-pick-together'] }, 'intro team 5');
  mash('mind laps: 1 player daily', 'start_run("daily")', 1, 6000);
  mash('mind laps: 1 player practice picker', '', 1, 3000);
  mash('mind laps: 4 players race', 'start_run("race")', 4, 6000);
  mash('mind laps: 8 players team', 'start_run("team")', 8, 6000, [2500, 'mind-laps-8-players']);
  linked('mind laps', '(run and (run.pts[1] * 3 + run.pts[2] * 5 + run.n * 7) or 0) + (lap and (lap.pts[1] * 11 + lap.left + lap.qn * 13) or 0)');
  resume('Mind Laps', 'start_run("daily") end_lap()', 'state, run and run.mode, run and run.n', 'intro daily 2');

  if (!process.exitCode) console.log('ok: Mind Laps passed (rules, five exercises, daily jog + streak, practice levels, race, team, 1-8 players, linked Bits, Continue)');
})();
