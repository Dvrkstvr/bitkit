// CI check: loads the WASM runtime in Node, checks error handling, then plays the demo cart
// for 3000 frames with scripted input. Exits non-zero on any Lua error.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/tracks.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/kart.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/home.js', 'utf8'));
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const runtime = require('../studio/runtime.js');
runtime({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(async M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  if (M._bkw_load(s('function _draw() cls(1) text("hi",0,0) end')) !== 0) fail('simple cart did not load');
  if (M._bkw_frame(0, 0) !== 0) fail('simple cart frame failed');
  if (M._bkw_load(s('function (')) === 0) fail('syntax error was not reported');
  M._bkw_load(s('function _update() while true do end end'));
  if (M._bkw_frame(0, 0) === 0) fail('infinite loop was not stopped by the instruction budget');
  errors = [];

  // save data: save() fills the host's save block, saved() reads it back on the next run; clock() is unix time
  {
    const sv = M._bkw_save() >> 2;
    logs = [];
    M._bkw_load(s('save({coins = 12, name = "moss", plots = {true, false, 2.5}, [3] = "x"})'));
    if (M.HEAP32[sv + 1] !== 1 || M.HEAP32[sv] <= 0) fail('save() did not mark the save block');
    M.HEAP32[sv + 1] = 0;
    M._bkw_load(s('local d = saved() print("saved", d.coins, d.name, d.plots[1], d.plots[3], d[3], clock() > 1700000000)'));
    const l = logs.find(x => x.startsWith('saved')) || '';
    if (l.split(/\s+/).join(' ') !== 'saved 12 moss true 2.5 x true') fail('saved() round trip: ' + l);
    M.HEAP32[sv] = -1;
    M._bkw_load(s('print("none", saved() == nil)'));
    if (!logs.some(x => /^none\s+true/.test(x))) fail('saved() should be nil with no save');
    if (errors.length) { errors.forEach(e => fail('save: ' + e)); errors = []; }
  }

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

  // a behavior with several steps: a pebble that waits, then removes itself
  {
    logs = [];
    const ents = JSON.parse(JSON.stringify(cart.entities));
    ents.types.find(t => t.name === 'pebble').tree = window.BKEntities.PRESETS['Disappear after a while']();
    ents.types.find(t => t.name === 'pebble').tree.c[0].p.frames = 6;
    M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
    M._bkw_load_ex(s(window.BKEntities.toLua(ents, meta, 0)), s(window.BK_DEMO.code + '\nlocal _u = _update\nfunction _update() _u() if t() == 15 then print("peb", #ents_all("pebble")) end if t() == 22 then print("peb", #ents_all("pebble")) end end'));
    for (let f = 0; f < 24; f++) frame(f === 3 ? 1 << 10 : f >= 8 && f <= 10 ? 1 << 0 : f === 12 ? 1 << 5 : 0);   // skip intro, face left (away from the sage), throw
    const pb = logs.filter(l => l.startsWith('peb')).map(l => +l.split(/\s+/)[1]);
    if (pb[0] !== 1 || pb[1] !== 0) fail('pebble with Wait + Remove self: ' + pb.join(',') + ' (expected 1 then 0)');
  }

  // two players sharing one screen: player 2 gets its own sprout, driven by its own pad
  {
    logs = [];
    M._bkw_players(2, 0);
    M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
    const probe2 = '\nlocal _u = _update\nfunction _update() _u() if t() == 200 then local p = ents_players() print("two", #p, p[1].pnum, p[2].pnum, math.floor(p[2].x - p[1].x)) end end';
    M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0)), s(window.BK_DEMO.code + probe2));
    const pr = M._malloc(16);
    for (let f = 0; f < 210; f++) {
      M._bkw_input(2, f > 150 ? (1 << 1) : 0, 0);     // only player 2 walks right once the intro is skipped
      frame(f === 3 ? 1 << 10 : 0);
    }
    M._free(pr);
    const l2 = (logs.find(l => l.startsWith('two')) || '').split(/\s+/);
    if (l2[1] !== '2' || l2[2] !== '1' || l2[3] !== '2' || !(+l2[4] > 8)) fail('two players on one screen: ' + l2.join(' ') + ' (expected 2 players, player 2 to the right of player 1)');
    M._bkw_players(1, 0);
  }

  // linked Bits: two runtimes fed the same inputs (each seeing its own player) must stay identical
  {
    const M2 = await runtime({ onLog: (m, e) => { if (e) errors.push('bit 2: ' + m); else logs.push('B2 ' + m); } });
    M2._bkw_init();
    const sys2 = M2._bkw_sys() >> 2;
    const boot = (R, me) => {
      R._bkw_players(2, me);
      R.HEAPU8.set(cart.tiles, R._bkw_tiles()); R.HEAPU8.set(cart.flags, R._bkw_flags()); R.HEAPU16.set(levels[0].map, R._bkw_map() >> 1);
      const probe = '\nlocal _u = _update\nfunction _update() _u() if t() % 300 == 0 then local h = LEVEL * 7 + #ents_all() for _, p in ipairs(ents_players()) do h = h + math.floor(p.x) * 3 + math.floor(p.y) * 5 + p.hp end print("sync", t(), h, rnd(1000)) end end';
      return R._bkw_load_ex(R.stringToNewUTF8(window.BKEntities.toLua(cart.entities, meta, 0)), R.stringToNewUTF8(window.BK_DEMO.code + probe));
    };
    logs = [];
    if (boot(M, 1) || boot(M2, 2)) fail('linked bits did not load');
    const step = (R, sysp, m1, m2) => {
      R._bkw_input(2, m2, 0);
      const r = R._bkw_frame(m1, 0);
      if (R.HEAP32[sysp] === 4) R.HEAPU16.set(levels[R.HEAP32[sysp + 1] - 1].map, R._bkw_map() >> 1);
      return r;
    };
    for (let f = 0; f < 2400; f++) {
      const m1 = (1 << 1) | ((f % 30) < 12 ? 1 << 4 : 0) | (f % 20 === 0 ? 1 << 5 : 0);
      const m2 = (f % 200 < 120 ? 1 << 1 : 1 << 0) | ((f % 24) < 10 ? 1 << 4 : 0) | (f % 90 === 0 ? 1 << 10 : 0);
      if (step(M, sys, m1, m2) || step(M2, sys2, m1, m2)) { fail('linked bits stopped at frame ' + f); break; }
    }
    const a = logs.filter(l => l.startsWith('sync')).map(l => l.split(/\s+/).slice(1).join(' '));
    const b = logs.filter(l => l.startsWith('B2 sync')).map(l => l.split(/\s+/).slice(2).join(' '));
    if (a.length < 7 || a.join('|') !== b.join('|')) fail('linked bits drifted apart:\n  bit 1: ' + a.join(' | ') + '\n  bit 2: ' + b.join(' | '));
    M._bkw_players(1, 0);
  }


  errors.forEach(e => fail('Lua error: ' + e)); errors = [];

  // 2.5D: floor() fills the rows below the horizon from the map, project() matches it, sspr() scales
  {
    logs = [];
    const T = M._bkw_tiles(), MP = M._bkw_map() >> 1;
    M.HEAPU8.fill(7, T + 64, T + 128); M.HEAPU16.fill(1, MP, MP + 256 * 128);
    M._bkw_load(s('function _draw() cls(0) floor(1024, 512, 0, 20, 100, 160, 9) local x, y, k = project(1024 + 40, 512) local bx = project(1000, 512) sspr(1, 10, 10, 1, 1, 2.5) print("fl", pget(160, 99), pget(160, 110), pget(160, 239), math.floor(x + 0.5), math.floor(y + 0.5), k, bx == nil, pget(29, 29), pget(30, 30)) end'));
    M._bkw_frame(0, 0);
    const l = (logs.find(x => x.startsWith('fl')) || '').split(/\s+/).slice(1).join(' ');
    if (l !== '0 7 7 160 180 4.0 true 7 0') fail('floor/project/sspr: ' + l + ' (expected 0 7 7 160 180 4.0 true 7 0)');
    if (errors.length) { errors.forEach(e => fail('2.5D: ' + e)); errors = []; }
  }

  // Kart Lab: start a race from the garage, an autopilot drives your kart; it should finish a lap
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const kc = { tiles: new Uint8Array(512 * 64), flags: new Uint8Array(512), map: new Uint16Array(256 * 128) };
    kd.buildGfx(kc);
    M.HEAPU8.set(kc.tiles, M._bkw_tiles()); M.HEAPU8.set(kc.flags, M._bkw_flags()); M.HEAPU16.set(kc.map, M._bkw_map() >> 1);
    const auto = '\nlocal _sr = start_race\nfunction start_race() _sr() player.ai, player.skill, player.lane, player.lane_want = true, 1, 0, 0 end\nlocal _u = _update\nfunction _update() _u() if mode == "race" and gt % 150 == 0 then player.item, player.roll = (gt // 150) % #ITEMS + 1, 0 use_item(player) used = (used or 0) + 1 if #shots + #hazards > 0 then fired = true end end if t() == 2299 then print("kart", mode, player.lap, #karts, used, fired) end end';
    if (M._bkw_load(s(kd.code + auto)) !== 0) fail('Kart Lab did not load');
    for (let f = 0; f < 2300; f++) if (M._bkw_frame(f === 10 ? 1 << 4 : (f > 400 && f < 700 ? (1 << 8) | (f % 90 < 45 ? 1 : 2) : 0), 0)) { fail('Kart Lab stopped at frame ' + f); break; }
    const kl = (logs.find(x => x.startsWith('kart')) || '').split(/\s+/);
    if (kl[1] !== 'race' || !(+kl[2] >= 2) || kl[3] !== '4' || !(+kl[4] >= 5) || kl[5] !== 'true') fail('Kart Lab race: ' + kl.join(' ') + ' (expected racing on lap 2 with 4 karts, every item used)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab: ' + e)); errors = []; }
  }

  // Kart Lab, second track: picked in the garage, built with hills
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const probe = '\nlocal _i = _init\nfunction _init() _i() sel.track = 2 end\nlocal _u = _update\nfunction _update() _u() if mode == "count" and gt == 1 then local lo, hi = 999, 0 for y = 0, 1016, 64 do for x = 0, 2040, 64 do local h = hget(x, y) lo, hi = math.min(lo, h), math.max(hi, h) end end print("track2", TRACKS[sel.track].name, NWP > 100, #CRATES, hi - lo > 20, mget(WP[1].x // 8, WP[1].y // 8)) end end';
    if (M._bkw_load(s(kd.code + probe)) !== 0) fail('Kart Lab (track 2) did not load');
    for (let f = 0; f < 200; f++) if (M._bkw_frame(f === 10 ? 1 << 4 : 0, 0)) { fail('Kart Lab (track 2) stopped at frame ' + f); break; }
    const l = (logs.find(x => x.startsWith('track2')) || '').split('\t').slice(1).join(',');
    if (l !== 'Quarry Hills,true,12,true,5') fail('Kart Lab track 2: ' + l + ' (expected Quarry Hills,true,12,true,5)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab track 2: ' + e)); errors = []; }
  }

  // Kart Lab, race end with your own input: start on the last lap, drive over the line, the autopilot
  // takes over your kart while the rivals finish, then A goes back to the garage
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const fin = '\nlocal _sr = start_race\nfunction start_race() _sr() player.lap = LAPS end\nlocal _u = _update\nfunction _update() local m = mode _u() if m ~= mode then print("mode", mode) end end';
    if (M._bkw_load(s(kd.code + fin)) !== 0) fail('Kart Lab (finish) did not load');
    for (let f = 0; f < 1500; f++) {
      const mask = f === 10 ? 1 << 4 : (f > 200 && f < 1000 ? 1 << 9 : 0) | (f === 1400 ? 1 << 4 : 0);
      if (M._bkw_frame(mask, 0)) { fail('Kart Lab (finish) stopped at frame ' + f); break; }
    }
    const modes = logs.filter(x => x.startsWith('mode')).map(x => x.split(/\s+/)[1]).join(',');
    if (modes !== 'loading,count,race,results,garage') fail('Kart Lab race end: modes ' + modes + ' (expected loading,count,race,results,garage)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab finish: ' + e)); errors = []; }
  }

  // Kart Lab tracks from the Track tab: levels with a spline track and painted elevation, passed in as
  // LEVELS; "race it" (KART_QUICK) goes straight to the track; tile behaviours answer fget(tile, "name")
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const kc = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    kd.buildGfx(kc);
    kc.levels[1].track.pts[3] = [1200, 300];          // an edit on the Track tab
    window.BKTracks.paint(kc.levels[1].map, kc.levels[1].track);
    const meta = kc.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track, height: L.height }));
    M.HEAPU8.set(kc.tiles, M._bkw_tiles()); M.HEAPU8.set(kc.flags, M._bkw_flags()); M.HEAPU16.set(kc.levels[1].map, M._bkw_map() >> 1);
    const probe = '\nlocal _u = _update\nfunction _update() _u() if mode == "count" and gt == 1 then print("trk", #TRACKS, TRACKS[sel.track].name, LAPS, #CRATES, math.floor(hget(1500, 120)), fget(5, "start"), fget(6, "boost"), fget(1, "boost")) end end';
    const lua = window.BKEntities.toLua(kc.entities, meta, 1, 'KART_QUICK = 2\n');
    if (M._bkw_load_ex(s(lua), s(kd.code + probe)) !== 0) fail('Kart Lab (Track tab levels) did not load: ' + errors.join(' '));
    for (let f = 0; f < 200; f++) if (M._bkw_frame(0, 0)) { fail('Kart Lab (Track tab levels) stopped at frame ' + f); break; }
    const l = (logs.find(x => x.startsWith('trk')) || '').split('\t').slice(1).join(',');
    if (!/^2,Quarry Hills,3,12,(\d+),true,true,false$/.test(l) || +l.split(',')[4] < 70) fail('Kart Lab Track tab levels: ' + l + ' (expected 2 tracks, Quarry Hills straight away, 3 laps, 12 crates, raised ground near 1500,120, named behaviours)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab Track tab: ' + e)); errors = []; }
  }

  if (!process.exitCode) console.log('ok: runtime checks, home screen, 3000 demo frames, level switching, cutscenes, save data, multiplayer, 2.5D floor and Kart Lab passed');
});
