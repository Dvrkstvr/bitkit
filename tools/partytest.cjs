// CI check for the three party demos (studio/puffball.js, hedgehogs.js, cauldron.js): each one loads, meets the
// game rules, plays alone, with four players on one screen and on linked Bits (which must stay in step), and its
// own rules work: scoring, the co-op goal and the versus mode. `node tools/partytest.cjs shots/` also writes PNGs.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'puffball', 'hedgehogs', 'cauldron']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
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
  use('Puffball');
  // the puffer lands on the left sand: the right side scores, and the next serve goes to the left
  expect('puffball: landing scores', { players: 2, setup: 'start(1)', every: 'if t() == 10 then ball.x, ball.y, ball.carry = 30, 150, nil end',
    check: 'score[1], score[2], state, GAME.state, ball.carry and ball.carry.side', at: 80 }, '0 1 play play 1');
  // a fourth touch in a row on one side is a fault
  expect('puffball: 4 touches', { players: 2, setup: 'start(1)', every: 'if t() == 10 then touches, last_side = 3, 1 ball.x, ball.y, ball.carry = P[1].x, 150, nil end',
    check: 'score[2], why_text', at: 60 }, '1 4 TOUCHES!');
  // a touch sends the puffer up, puffs it up and counts
  expect('puffball: touch', { players: 2, setup: 'start(1)', every: 'if t() == 10 then ball.x, ball.y, ball.carry = P[1].x, 150, nil end',
    check: 'hits, touches, last_side, ball.vy < 0, ball.r > 8', at: 40 }, '1 1 1 true true');
  // rally: a pass over the net counts once it has been touched, a drop costs a life, three drops end the run
  expect('puffball: rally pass', { players: 2, setup: 'start(2)', every: 'if t() == 10 then ball.x, ball.y, ball.vx, ball.vy, ball.carry, last_side = 150, 60, 3, 0, nil, 1 end',
    check: 'streak, best, lives', at: 20 }, '1 1 3');
  expect('puffball: rally drops', { players: 2, setup: 'start(2)', every: 'if state == "play" then ball.x, ball.y, ball.carry = 30, 190, nil end',
    check: 'lives, state', at: 400 }, '0 over');
  expect('puffball: rally goal', { players: 2, setup: 'start(2) streak = 29', every: 'if t() == 10 then ball.x, ball.y, ball.vx, ball.vy, ball.carry, last_side = 150, 60, 3, 0, nil, 1 end',
    check: 'streak, GAME.state', at: 30 }, '30 won');
  // serving: nobody is frozen after a point. The side that lost it carries the puffer, walks where it likes,
  // and a jump starts the timer that lets the puffer go
  expect('puffball: carry the serve', { players: 2, setup: 'start(1)', every: 'if t() == 10 then ball.x, ball.y, ball.carry = 30, 150, nil x0, x2 = P[1].x, P[2].x end',
    check: 'score[2], state, ball.carry == P[1], ball.x == P[1].x, ball.y == P[1].y - CARRY, P[1].x > x0 + 40, P[2].x < x2 - 40', at: 80,
    input: f => [f > 20 ? bit('right') : 0, f > 20 ? bit('left') : 0] }, '1 play true true true true true');
  expect('puffball: jump serves', { players: 2, setup: 'start(1)', every: 'if t() == 40 + SERVE_T - 2 then held = ball.carry == P[1] and ball.count ~= nil end',
    check: 'held, ball.carry, ball.vy < 0 or ball.y < 100, ball.vx > 0, hits', at: 40 + 10 + 4,
    input: f => [(f > 20 ? bit('right') : 0) | (f === 40 ? bit('a') : 0), 0] }, 'true nil true true 0');
  // a server who never jumps doesn't hold the game up
  expect('puffball: serve by itself', { players: 2, setup: 'start(1)', check: 'ball.carry, SERVE_WAIT', at: 330 }, 'nil 300');
  // A jumps, B dives, and nobody gets past the net
  expect('puffball: moves', { players: 2, setup: 'start(1)',
    check: 'P[1].x <= NETX - NET_W - PR, P[2].x >= NETX + NET_W + PR, jumped, P[1].cd > 0 or dived', at: 200,
    every: 'if not P[1].ground then jumped = true end if P[1].dive_t > 0 then dived = true end',
    input: f => [bit('right') | (f === 30 ? bit('a') : 0) | (f === 90 ? bit('b') : 0), bit('left')] }, 'true true true true');
  // alone, an idle player loses the match to the crab; the win only counts for the player's side
  expect('puffball: crab wins', { players: 1, setup: 'start(1)', check: 'state, winner, score[2], GAME.state', at: 9000,
    every: 'P[1].x = 20', shot: [300, 'puffball-match'] }, 'over 2 7 play');
  // two crabs keep a rally going (the crab on the player's side is switched on for the test)
  {
    const r = scenario('puffball: crabs rally', { players: 1, setup: 'start(1) P[1].pl = 0 most = 0', every: 'most = math.max(most, hits)', check: 'most, score[1] + score[2]', at: 3000 });
    if (!(+r[0] >= 4)) fail('puffball: two crabs should manage a rally of 4 touches, got ' + r.join(' '));
  }
  // the setup screen: each player picks a colour (never one another player has), the net and the puffer can be
  // changed, A starts the game with them, and New match starts over with the same setup
  expect('puffball: setup screen', { players: 2, setup: 'go_setup(1)', check: 'state, col[1], col[2], NET_TOP, opt.float, R0, BALL_G < BALL_G0, target', at: 200,
    input: f => {
      const p1 = [30, 'right'], seq = { 30: 'right', 40: 'down', 50: 'right', 60: 'down', 70: 'left', 80: 'down', 90: 'right', 100: 'down', 110: 'left', 112: 0, 120: 'a' };
      const k = seq[f];
      return [k ? bit(k) : 0, f === 34 ? bit('left') : 0];
    }, shot: [115, 'puffball-setup'] }, 'play 3 1 134 1 11 true 6');
  expect('puffball: setup 4 players', { players: 4, setup: 'go_setup(2)', check: 'state', at: 40, shot: [38, 'puffball-setup-4'] }, 'setup');
  expect('puffball: setup back', { players: 1, setup: 'go_setup(2)', check: 'state, #setup_rows()', at: 60, input: f => [f === 40 ? bit('b') : 0] }, 'pick 4');
  expect('puffball: new match', { players: 2, setup: 'opt.net = 1 start(1) score = {4, 5}',
    check: 'score[1], score[2], state, NET_TOP, GAME.state', at: 80,
    input: f => [f === 30 ? bit('start') : f === 45 ? bit('down') : f === 55 ? bit('a') : 0, 0] }, '0 0 play 164 play');
  mash('puffball: 1 player match', 'start(1)', 1, 3000);
  mash('puffball: 4 players match', 'start(1)', 4, 3000, [400, 'puffball-4-players']);
  mash('puffball: 4 players rally', 'start(2)', 4, 3000);
  mash('puffball: 8 players from the picker', '', 8, 2000);
  linked('puffball', 'math.floor(ball.x * 100) + math.floor(ball.y * 100) * 3 + score[1] * 7 + score[2] * 11 + streak + lives + math.floor(P[1].x * 10) + math.floor(P[3].x * 10)');
  resume('Puffball', 'start(1) score = {3, 2} checkpoint({mode = 1, s1 = 3, s2 = 2, best = 0})', 'score[1], score[2], state, mode', '3 2 play 1');

  // ================================================================ Hedge Hogs
  use('Hedge Hogs');
  const STILL = 'MOLE_SPEED = 0 for _, m in ipairs(MOLES) do m.x, m.y = 300, 190 end';
  // garden: walk a box out from the border and back: the box and what it fences off become land
  const BOX = 'local h = HOGS[1] want[1] = 0 if h.cx == 20 and h.cy < 5 and #h.path < 6 then want[1] = 2 elseif h.cy == 5 and h.cx < 26 then want[1] = 1 elseif h.cx == 26 and h.cy > 0 then want[1] = 4 end';
  expect('hedge hogs: fencing off', { setup: 'start(1, 1) ' + STILL, pads: BOX,
    check: 'land[1] - RING, percent(1), #HOGS[1].path, own[idx(23, 3)], own[idx(30, 10)], mget(23, 3) >= 32', at: 260, shot: [200, 'hedge-hogs-garden'] }, '35 3 0 1 0 true');
  // a mole on an unfinished line eats it: a heart is gone and the hog is sent home
  expect('hedge hogs: mole', { setup: 'start(1, 1) ' + STILL, pads: BOX,
    every: 'if t() == 110 then MOLES[1].x, MOLES[1].y = 20 * 8 + 4, 2 * 8 + 4 end',
    check: 'hearts, HOGS[1].alive, land[1] - RING, trail[idx(20, 2)]', at: 130 }, '2 false 0 0');
  // three hearts gone: the moles win, and A starts the garden again
  expect('hedge hogs: moles win', { setup: 'start(1, 1) hearts = 1 ' + STILL, pads: BOX,
    every: 'if t() == 110 then MOLES[1].x, MOLES[1].y = 20 * 8 + 4, 2 * 8 + 4 end', check: 'state, hearts', at: 130 }, 'over 0');
  // reaching the land needed clears the garden; the third garden is the goal
  expect('hedge hogs: garden cleared', { setup: 'start(1, 3) ' + STILL + ' for y = 1, 20 do for x = 1, 38 do give(idx(x, y), 1) end end',
    check: 'state, percent(1) >= NEED, GAME.state', at: 90 }, 'clear true won');
  // land grab: walking over a rival's unfinished line sends them home; your own land is safe
  expect('hedge hogs: cutting a line', { players: 2, setup: 'start(2, 1)',
    pads: 'if state == "play" and not placed then placed = true local a, b = HOGS[1], HOGS[2] a.cx, a.cy, a.px, a.py = 13, 6, 13, 6 b.cx, b.cy, b.px, b.py = 10, 10, 10, 10 end want[1], want[2] = placed and 2 or 0, placed and 1 or 0',
    check: 'HOGS[2].alive, HOGS[1].alive, #HOGS[2].path, land[2]', at: 110 }, 'false true 0 9');
  // land grab: the biggest patch is never filled, the small one is
  expect('hedge hogs: only the small patch', { players: 2, setup: 'start(2, 1) for x = 0, 39 do if x ~= 20 then give(idx(x, 8), 1) end end HOGS[1].cx, HOGS[1].cy = 19, 8 HOGS[1].px, HOGS[1].py = 19, 8',
    pads: 'want[1] = HOGS[1].cx < 21 and 1 or 0', check: 'own[idx(10, 3)], own[idx(10, 20)], land[1] >= 360', at: 110 }, '1 0 true');
  // CPU hogs take land by themselves, and the clock ends the round with a winner
  {
    const r = scenario('hedge hogs: CPU hogs', { setup: 'start(2, 1)', every: 'if t() == 3000 then time_left = 2 end',
      check: 'land[2] + land[3] + land[4], state, rank and #rank, winner', at: 3010, shot: [2400, 'hedge-hogs-land-grab'] });
    if (!(+r[0] > 60) || r[1] !== 'over' || r[2] !== '4') fail('hedge hogs: CPU hogs should take land and the round should end, got ' + r.join(' '));
  }
  mash('hedge hogs: 1 player garden', 'start(1, 1)', 1, 4000);
  mash('hedge hogs: 4 players garden', 'start(1, 2)', 4, 4000, [900, 'hedge-hogs-4-players']);
  mash('hedge hogs: 8 players land grab', 'start(2, 1)', 8, 4000);
  linked('hedge hogs', 'land[1] + land[2] * 3 + land[3] * 5 + HOGS[1].cx * 7 + HOGS[2].cy * 11 + (hearts or 0) + (time_left or 0)');
  resume('Hedge Hogs', 'start(1, 2) checkpoint({mode = 1, lvl = 2})', 'mode, lvl, state', '1 2 ready');

  // ================================================================ Cauldron Crew
  use('Cauldron Crew');
  const AT = 'function at(p, tx, ty, fx, fy) p.x, p.y, p.fx, p.fy = tx * 16 + 8, ty * 16 + 8, fx, fy end ';
  // three ingredients in a cauldron brew a potion; serving the right one pays
  const BREW3 = 'local p = P[1] for i = 1, 3 do at(p, 4, 1, 0, -1) use(p) at(p, 3, 11, 0, 1) use(p) end';
  expect('cauldron crew: brew and serve', { setup: AT + 'start(1) SEQ[1] = {1, 1, 1}',
    every: 'local p = P[1] if t() == 100 then ' + BREW3 + ' end if t() == 100 + BREW + 20 then at(p, 3, 11, 0, 1) use(p) got = p.hold and p.hold.k .. tostring(p.hold.bad) at(p, 18, 3, 1, 0) use(p) end',
    check: 'got, score[1] >= 20, ORD[1].served, #CAULS[1].items, P[1].hold', at: 100 + 300 + 40, shot: [250, 'cauldron-crew-kitchen'] }, 'potfalse true 1 0 nil');
  // stirring (hold X facing the cauldron) brews faster
  expect('cauldron crew: stirring', { setup: AT + 'start(1)', every: 'local p = P[1] if t() == 100 then ' + BREW3 + ' end if t() > 100 then at(p, 3, 11, 0, 1) end',
    check: 'CAULS[1].prog >= BREW, P[1].stir or CAULS[1].prog >= BREW', at: 100 + 150, input: f => [f > 100 ? bit('x') : 0] }, 'true true');
  // a potion left on the fire burns; burnt and wrong potions pay nothing, and the bin takes them
  expect('cauldron crew: burning', { setup: AT + 'start(1) SEQ[1] = {1, 1, 1}',
    every: 'local p = P[1] if t() == 100 then ' + BREW3 + ' end if t() == 100 + BREW + BURN + 20 then at(p, 3, 11, 0, 1) use(p) bad = p.hold.bad at(p, 18, 3, 1, 0) use(p) s1 = score[1] ' +
      'at(p, 4, 1, 0, -1) use(p) at(p, 1, 7, -1, 0) use(p) end',
    check: 'bad, s1, ORD[1].served, P[1].hold', at: 100 + 300 + 540 + 40 }, 'true 0 0 nil');
  // a customer who waits too long leaves, and that costs coins
  expect('cauldron crew: impatient', { setup: 'start(1) score[1] = 50', every: 'if t() == 100 then ORD[1].list[1].t = 2 end',
    check: 'score[1], ORD[1].streak', at: 110 }, '40 0');
  // counters hold one thing, so cooks can pass things on
  expect('cauldron crew: counters', { setup: AT + 'start(1)',
    every: 'local p = P[1] if t() == 100 then at(p, 4, 1, 0, -1) use(p) at(p, 5, 3, 0, 1) use(p) a = p.hold == nil and ST[4 * GW + 5 + 1].item.t use(p) b = p.hold and p.hold.t end',
    check: 'a, b', at: 105 }, '1 1');
  // walls stop the cooks, and walking turns them to what they walk into
  expect('cauldron crew: walking', { setup: 'start(1) P[1].x = 72', check: 'P[1].y > 16, P[1].y < 30, P[1].fy, facing(P[1]) ~= nil', at: 200, input: f => [f > 90 ? bit('up') : 0] }, 'true true -1 true');
  // teams: two kitchens with the same orders, and the kitchen with more coins wins
  expect('cauldron crew: teams', { players: 4, setup: 'start(2) score = {40, 90} time_left = 100',
    check: 'P[1].team, P[2].team, P[3].team, P[1].x < 160, P[2].x > 160, key(ORD[1].list[1].r) == key(ORD[2].list[1].r), state, winner, GAME.state', at: 300 },
    '1 2 1 true true true over 2 won');
  // one kitchen: reaching the target by the end of the shift is the goal
  expect('cauldron crew: target', { setup: 'start(1) score[1] = target time_left = 100', check: 'state, GAME.state, best >= 150', at: 300 }, 'over won true');
  mash('cauldron crew: 1 player', 'start(1)', 1, 4000);
  mash('cauldron crew: 4 players one kitchen', 'start(1)', 4, 4000, [1500, 'cauldron-crew-4-players']);
  mash('cauldron crew: 8 players teams', 'start(2)', 8, 4000, [1500, 'cauldron-crew-teams']);
  linked('cauldron crew', 'score[1] * 3 + score[2] * 5 + math.floor(P[1].x * 10) + math.floor(P[2].y * 10) * 7 + #ORD[1].list + time_left + CAULS[1].prog + #CAULS[2].items');
  resume('Cauldron Crew', 'score[1] = 60 time_left = 5000 save_point()', 'score[1], time_left > 4000 and time_left <= 5000, mode', '60 true 1');

  if (!process.exitCode) console.log('ok: Puffball, Hedge Hogs and Cauldron Crew passed (rules, solo, 4 and 8 players, linked Bits, co-op goals, versus, Continue)');
})();
