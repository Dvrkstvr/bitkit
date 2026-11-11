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
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code)) !== 0) fail('demo did not load');
  for (let f = 0; f < 3000; f++) {
    const mask = (1 << 1) | ((f % 30) < 12 ? 1 << 4 : 0) | (f % 20 === 0 ? 1 << 5 : 0);
    if (frame(mask)) { fail('demo stopped at frame ' + f); break; }
  }

  // switching levels: level(2) loads the cave map and its entities, the player keeps its HP
  const probe = '\nlocal _u = _update\nfunction _update() if t() == 5 then PLAYER.hp = 2; level(2) end _u() if t() == 8 then print("probe", LEVEL, #ents_all("goal"), #ents_all("exit"), PLAYER.hp, mget(0, 0)) end end';
  M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code + probe)) !== 0) fail('demo with probe did not load');
  for (let f = 0; f < 12; f++) frame(0);
  const line = logs.find(l => l.startsWith('probe'));
  const v = line ? line.split(/\s+/).slice(1).map(Number) : [];
  if (!line || v[0] !== 2 || v[1] !== 1 || v[2] !== 0 || v[3] !== 2 || v[4] !== 18) fail('level switch probe: ' + line + ' (expected level 2, 1 goal, 0 exits, hp 2, brick tile 18 at 0,0)');

  // cutscenes: the intro plays when level 1 starts, freezes the player, A advances it, START skips the rest
  logs = [];
  const cutProbe = '\nlocal _u = _update\nfunction _update() _u() local on_, nm = cutscene_playing() if t() == 2 then x0 = PLAYER.x print("cut", on_ and 1 or 0, nm) end if t() == 60 then print("frozen", PLAYER.x == x0 and 1 or 0) end end\non("cutscene_end", function(n) print("cutend", n, t()) end)';
  M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code + cutProbe)) !== 0) fail('demo with cutscene probe did not load');
  for (let f = 0; f < 1200 && !logs.some(l => l.startsWith('cutend')); f++) frame((1 << 1) | ((f % 20) < 2 ? 1 << 4 : 0));
  const cl = logs.find(l => /^cut\s/.test(l)), fz = logs.find(l => l.startsWith('frozen')), ce = logs.find(l => l.startsWith('cutend'));
  if (!cl || cl.split(/\s+/)[1] !== '1' || cl.split(/\s+/)[2] !== 'intro') fail('intro cutscene did not start: ' + cl);
  if (!fz || fz.split(/\s+/)[1] !== '1') fail('player moved during a cutscene: ' + fz);
  if (!ce || ce.split(/\s+/)[1] !== 'intro') fail('intro cutscene did not finish with A presses: ' + ce);
  // START skips; a trigger-only cutscene plays from code
  logs = [];
  M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
  M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code + '\non("cutscene_end", function(n) print("cutend", n, t()) end)\nlocal _u = _update\nfunction _update() _u() if t() == 30 then cutscene("gate") end end'));
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
    M._bkw_load_ex(s(window.BKEntities.toLua(ents, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code + '\nlocal _u = _update\nfunction _update() _u() if t() == 15 then print("peb", #ents_all("pebble")) end if t() == 22 then print("peb", #ents_all("pebble")) end end'));
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
    M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code + probe2));
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
      return R._bkw_load_ex(R.stringToNewUTF8(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), R.stringToNewUTF8(window.BK_DEMO.code + probe));
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

  // Kart Lab menus: A on the main menu (Race), A twice on the rules screen (jump to Next, then Next),
  // A in the garage. KGO(f) is true on the frames that press A.
  const KGO = f => f === 10 || f === 25 || f === 40 || f === 55;

  // Kart Lab: start a race from the garage, an autopilot drives your kart; it should finish a lap
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const kc = { tiles: new Uint8Array(512 * 64), flags: new Uint8Array(512), map: new Uint16Array(256 * 128) };
    kd.buildGfx(kc);
    M.HEAPU8.set(kc.tiles, M._bkw_tiles()); M.HEAPU8.set(kc.flags, M._bkw_flags()); M.HEAPU16.set(kc.map, M._bkw_map() >> 1);
    const auto = '\nlocal _sr = start_race\nfunction start_race() _sr() player.ai, player.skill, player.lane, player.lane_want = true, 1, 0, 0 end\nlocal _u = _update\nfunction _update() _u() if mode == "race" and gt % 150 == 0 then player.item, player.roll = (gt // 150) % #ITEMS + 1, 0 use_item(player) used = (used or 0) + 1 if #shots + #hazards > 0 then fired = true end end if t() == 2299 then print("kart", mode, player.lap, #karts, used, fired) end end';
    if (M._bkw_load(s('GAME_BOOT = 3 ' + kd.code + auto)) !== 0) fail('Kart Lab did not load');
    for (let f = 0; f < 2300; f++) if (M._bkw_frame(KGO(f) ? 1 << 4 : (f > 400 && f < 700 ? (1 << 8) | (f % 90 < 45 ? 1 : 2) : 0), 0)) { fail('Kart Lab stopped at frame ' + f); break; }
    const kl = (logs.find(x => x.startsWith('kart')) || '').split(/\s+/);
    if (kl[1] !== 'race' || !(+kl[2] >= 2) || kl[3] !== '8' || !(+kl[4] >= 5) || kl[5] !== 'true') fail('Kart Lab race: ' + kl.join(' ') + ' (expected racing on lap 2 with 8 karts, every item used)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab: ' + e)); errors = []; }
  }

  // Kart Lab, second track: picked in the garage, built with hills
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const probe = '\nlocal _i = _init\nfunction _init() _i() sel.track = 2 end\nlocal _u = _update\nfunction _update() _u() if mode == "count" and gt == 1 then local lo, hi = 999, 0 for y = 0, 1016, 64 do for x = 0, 2040, 64 do local h = hget(x, y) lo, hi = math.min(lo, h), math.max(hi, h) end end print("track2", TRACKS[sel.track].name, NWP > 100, #CRATES, hi - lo > 20, mget(WP[1].x // 8, WP[1].y // 8)) end end';
    if (M._bkw_load(s('GAME_BOOT = 3 ' + kd.code + probe)) !== 0) fail('Kart Lab (track 2) did not load');
    for (let f = 0; f < 300; f++) if (M._bkw_frame(KGO(f) ? 1 << 4 : 0, 0)) { fail('Kart Lab (track 2) stopped at frame ' + f); break; }
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
    if (M._bkw_load(s('GAME_BOOT = 3 ' + kd.code + fin)) !== 0) fail('Kart Lab (finish) did not load');
    for (let f = 0; f < 1500; f++) {
      const mask = KGO(f) ? 1 << 4 : (f > 250 && f < 1000 ? 1 << 9 : 0) | (f === 1400 ? 1 << 4 : 0);
      if (M._bkw_frame(mask, 0)) { fail('Kart Lab (finish) stopped at frame ' + f); break; }
    }
    const modes = logs.filter(x => x.startsWith('mode')).map(x => x.split(/\s+/)[1]).join(',');
    if (modes !== 'setup,garage,loading,count,race,results,setup') fail('Kart Lab race end: modes ' + modes + ' (expected setup,garage,loading,count,race,results,setup)');
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
    if (M._bkw_load_ex(s(lua), s('GAME_BOOT = 3 ' + kd.code + probe)) !== 0) fail('Kart Lab (Track tab levels) did not load: ' + errors.join(' '));
    for (let f = 0; f < 200; f++) if (M._bkw_frame(0, 0)) { fail('Kart Lab (Track tab levels) stopped at frame ' + f); break; }
    const l = (logs.find(x => x.startsWith('trk')) || '').split('\t').slice(1).join(',');
    if (!/^2,Quarry Hills,3,12,(\d+),true,true,false$/.test(l) || +l.split(',')[4] < 70) fail('Kart Lab Track tab levels: ' + l + ' (expected 2 tracks, Quarry Hills straight away, 3 laps, 12 crates, raised ground near 1500,120, named behaviours)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab Track tab: ' + e)); errors = []; }
  }

  // Kart Lab: per-point road width, hill size/shape and ramps build the same road and ground in the game
  // as on the Track tab
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab'), T = window.BKTracks;
    const kc = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    kd.buildGfx(kc);
    const tk = kc.levels[0].track;
    tk.pts[2] = tk.pts[2].slice(0, 2).concat([80, 12]);           // a wide stretch
    tk.pts[8] = tk.pts[8].slice(0, 2).concat([16, 0]);            // a narrow one with no kerb
    tk.items.push({ k: 'ramp', t: 0.4, o: 6, h: 30, r: 90, w: 30, c: [1, 0.9, 0.5, 0.2, 0] });
    tk.items.push({ k: 'hill', t: 0.5, o: 200, h: 50, r: 240, c: 'mesa' });
    tk.items.push({ k: 'dip', t: 0.8, o: -150, h: -20, r: 120, c: 'spike' });
    T.paint(kc.levels[0].map, tk);
    const meta = kc.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track, height: L.height }));
    M.HEAPU8.set(kc.tiles, M._bkw_tiles()); M.HEAPU8.set(kc.flags, M._bkw_flags()); M.HEAPU16.set(kc.levels[0].map, M._bkw_map() >> 1);
    const probe = '\nlocal _u = _update\nfunction _update() _u() if mode == "count" and gt == 1 then ' +
      'local m, h = {}, {} for ty = 0, 127 do for tx = 0, 255 do local v = mget(tx, ty) m[#m + 1] = v <= 170 and v or 0 end end ' +
      'for cy = 0, 128, 2 do for cx = 0, 256, 2 do h[#h + 1] = math.floor(hget(cx * 8, cy * 8)) end end ' +
      'print("tmap", table.concat(m, ",")) print("thgt", table.concat(h, ",")) end end';
    const lua = window.BKEntities.toLua(kc.entities, meta, 0, 'KART_QUICK = 1\n');
    if (M._bkw_load_ex(s(lua), s('GAME_BOOT = 3 ' + kd.code + probe)) !== 0) fail('Kart Lab (shapes) did not load: ' + errors.join(' '));
    for (let f = 0; f < 200; f++) if (M._bkw_frame(0, 0)) { fail('Kart Lab (shapes) stopped at frame ' + f); break; }
    const gm = (logs.find(x => x.startsWith('tmap')) || '').split('\t')[1], gh = (logs.find(x => x.startsWith('thgt')) || '').split('\t')[1];
    if (!gm || !gh) fail('Kart Lab shapes: no map/height report');
    else {
      const lm = gm.split(',').map(Number), jm = kc.levels[0].map;
      let bad = 0; for (let i = 0; i < jm.length; i++) if ((jm[i] <= 170 ? jm[i] : 0) !== lm[i]) bad++;
      const hf = T.heightFn(kc.levels[0]), lh = gh.split(',').map(Number);
      let i = 0, worst = 0, top = 0;
      for (let cy = 0; cy <= 128; cy += 2) for (let cx = 0; cx <= 256; cx += 2) { const v = hf(cx * 8, cy * 8); worst = Math.max(worst, Math.abs(Math.floor(v + 0.5) - lh[i++])); top = Math.max(top, v); }
      const wide = jm.filter(v => v === T.TILE.ROAD).length;
      if (bad > 20 || worst > 1) fail(`Kart Lab shapes: game and Track tab differ (${bad} tiles, height off by ${worst})`);
      if (!(top > 85)) fail('Kart Lab shapes: the flat-top hill is missing (highest ' + top + ')');
      if (wide < 1000) fail('Kart Lab shapes: too little road painted (' + wide + ')');
    }
    if (errors.length) { errors.forEach(e => fail('Kart Lab shapes: ' + e)); errors = []; }
  }

  // Kart Lab items: two slots (Y swaps), the homing Tire, Golden Tires and the slippery Oil Slick
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const kc = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    kd.buildGfx(kc);
    M._bkw_players(1, 0);
    M.HEAPU8.set(kc.tiles, M._bkw_tiles()); M.HEAPU8.set(kc.flags, M._bkw_flags()); M.HEAPU16.set(kc.map, M._bkw_map() >> 1);
    const probe = '\nlocal _u = _update\nlocal R = {}\nfunction _update() _u() if mode ~= "race" then return end local p = humans[1] ' +
      'if gt == 2 then p.item, p.item2 = 1, 5 end ' +
      'if gt > 2 and gt < 8 and p.item == 5 and p.item2 == 1 then R.swap = true end ' +
      'if gt == 8 then p.item, p.item2 = 7, nil use_item(p) R.gold = p.gold > 0 and p.item == nil end ' +
      'if gt == 10 then local r = karts[1] == p and karts[2] or karts[1] hazards[#hazards + 1] = {kind = "oil", x = r.x, y = r.y, life = 100, owner = p} R.oilk = r end ' +
      'if gt == 12 then R.oil = R.oilk.oil > 0 and R.oilk.spin == 0 end ' +
      'if gt == 14 then local r = R.oilk for _, k in ipairs(karts) do k.spin = 0 k.shield = 0 end shots[#shots + 1] = {kind = "tire", x = r.x - math.cos(r.a) * 40 + 12, y = r.y - math.sin(r.a) * 40, vx = math.cos(r.a) * 5, vy = math.sin(r.a) * 5, life = 300, owner = p, wp = r.wp, dir = 1, bounce = 0} end ' +
      'if gt > 15 and gt < 80 then for _, k in ipairs(karts) do if k.spin > 0 then R.hit = true end end end ' +
      'if gt == 80 then print("kitems", R.swap, R.gold, R.oil, R.hit, #ITEMS) end end';
    if (M._bkw_load(s(kd.code + probe)) !== 0) fail('Kart Lab items did not load: ' + errors.join(' '));
    for (let f = 0; f < 600; f++) {
      if (M._bkw_frame(KGO(f) ? 16 : (f > 70 && f % 2 ? 1 << 7 : 0), 0)) { fail('Kart Lab items stopped at frame ' + f); break; }   // then Y now and then
    }
    const ki = (logs.find(x => x.startsWith('kitems')) || '').split('\t').slice(1).join(' ');
    if (ki !== 'true true true true 7') fail('Kart Lab items: ' + ki + ' (expected Y swap, Golden Tires, slippery oil, a tire hit, 7 items)');
    if (errors.length) { errors.forEach(e => fail('Kart Lab items: ' + e)); errors = []; }
  }

  // Kart Lab Rumble: the arena builds, rivals fight (helmets come off), a kart with no helmets is KO,
  // and the match ends when one kart is left
  {
    logs = [];
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const kc = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    kd.buildGfx(kc);
    M._bkw_players(1, 0);
    M.HEAPU8.set(kc.tiles, M._bkw_tiles()); M.HEAPU8.set(kc.flags, M._bkw_flags()); M.HEAPU16.set(kc.map, M._bkw_map() >> 1);
    const probe = '\nlocal _u = _update\nfunction _update() local m = mode _u() if m ~= mode then print("rmode", mode) end ' +
      'if mode == "race" then for _, k in ipairs(karts) do wall_d = math.max(wall_d or -999, arena_d(ARENA, k.x, k.y)) end end ' +
      'if mode == "race" and gt == 1 then print("rstart", GMODE, ARENA.name, #karts, karts[2].helmets, math.floor(arena_d(ARENA, player.x, player.y))) end ' +
      'if mode == "race" and gt == 1500 then local lost = 0 for _, k in ipairs(karts) do lost = lost + rules.helmets - k.helmets end print("rfight", lost) print("rwall", wall_d) ' +
      'local v = karts[1] == player and karts[2] or karts[1] while not v.ko do v.spin = 0 v.shield = 0 hit(v, player) end print("rko", v.ko, v.helmets) ' +
      'for _, k in ipairs(karts) do if k ~= player then k.ko = true k.ko_t = race_t end end end end';
    if (M._bkw_load(s('GAME_BOOT = 3 ' + kd.code + probe)) !== 0) fail('Kart Lab Rumble did not load: ' + errors.join(' '));
    for (let f = 0; f < 2200; f++) {
      if (M._bkw_frame(f === 5 ? 1 << 3 : KGO(f) ? 1 << 4 : (f > 250 ? 1 << 9 : 0), 0)) { fail('Kart Lab Rumble stopped at frame ' + f); break; }
    }
    const g = k => (logs.find(x => x.startsWith(k)) || '').split('\t').slice(1).join(' ');
    if (g('rstart') !== 'rumble Quarry Bowl 8 3 ' + g('rstart').split(' ').pop() || !(+g('rstart').split(' ').pop() < 0)) fail('Kart Lab Rumble start: ' + g('rstart') + ' (expected 8 karts with 3 helmets inside Quarry Bowl)');
    if (!(+g('rfight') > 0)) fail('Kart Lab Rumble: no helmets lost in 25 s of fighting (' + g('rfight') + ')');
    // the player holds the throttle and never steers, so they drive straight into the kerb: it must hold them
    if (!(+g('rwall') <= -3.9)) fail('Kart Lab Rumble: a kart got past the arena kerb (' + g('rwall') + ' from the edge, the wall is at -4)');
    if (g('rko') !== 'true 0') fail('Kart Lab Rumble KO: ' + g('rko'));
    const rm = logs.filter(x => x.startsWith('rmode')).map(x => x.split('\t')[1]).join(',');
    if (rm !== 'setup,garage,loading,count,race,results') fail('Kart Lab Rumble modes: ' + rm);
    if (errors.length) { errors.forEach(e => fail('Kart Lab Rumble: ' + e)); errors = []; }
  }

  // Kart Lab with two players: both karts race in the same race. Linked Bits (each sees its own player)
  // must stay identical; on one screen the players take turns in the garage and the screen is split.
  {
    const kd = window.BK_DEMOS.find(d => d.name === 'Kart Lab');
    const probe = '\nlocal _u = _update\nfunction _update() _u() if mode == "race" and gt % 120 == 0 then local h = 0 for i, k in ipairs(karts) do h = h + math.floor(k.x) * i + math.floor(k.y) * 3 * i end print("ksync", gt, h, rnd(1000)) end if mode == "race" and gt == 600 then print("k2p", #humans, #karts, humans[1].lap, humans[2].lap, humans[1].fwd > 1, humans[2].fwd > 1, humans[2].ai, #views()) end end';
    const M2 = await runtime({ onLog: (m, e) => { if (e) errors.push('bit 2: ' + m); else logs.push('B2 ' + m); } });
    M2._bkw_init();
    const kg = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    kd.buildGfx(kg);
    const boot = (R, me) => {
      R._bkw_players(2, me);
      R.HEAPU8.set(kg.tiles, R._bkw_tiles()); R.HEAPU8.set(kg.flags, R._bkw_flags()); R.HEAPU16.set(kg.map, R._bkw_map() >> 1);
      R.HEAP32[(R._bkw_save() >> 2)] = -1;              // no save data: every Bit starts the same
      return R._bkw_load(R.stringToNewUTF8('GAME_BOOT = 3 ' + kd.code + probe));
    };
    const inputs = f => [KGO(f) ? 1 << 4 : (f > 245 ? 1 << 9 : 0), f === 57 || f === 59 ? 1 << 4 : (f > 245 ? 1 << 4 : 0)];
    logs = [];
    if (boot(M, 1) || boot(M2, 2)) fail('Kart Lab linked did not load');
    for (let f = 0; f < 1100; f++) {
      const [m1, m2] = inputs(f);
      M._bkw_input(2, m2, 0); M2._bkw_input(2, m2, 0);
      if (M._bkw_frame(m1, 0) || M2._bkw_frame(m1, 0)) { fail('Kart Lab linked stopped at frame ' + f); break; }
    }
    const a = logs.filter(l => l.startsWith('ksync')).map(l => l.split(/\s+/).slice(1).join(' '));
    const b = logs.filter(l => l.startsWith('B2 ksync')).map(l => l.split(/\s+/).slice(2).join(' '));
    if (a.length < 4 || a.join('|') !== b.join('|')) fail('Kart Lab linked Bits drifted apart:\n  bit 1: ' + a.join(' | ') + '\n  bit 2: ' + b.join(' | '));
    const k2 = (logs.find(l => l.startsWith('k2p')) || '').split(/\s+/).slice(1).join(' ');
    if (k2 !== '2 8 1 1 true true false 1') fail('Kart Lab linked race: ' + k2 + ' (expected 2 players + 6 rivals racing, both driving, one view per Bit)');
    // one screen: player 1 picks, then player 2, then the race runs split-screen
    logs = [];
    M._bkw_players(2, 0);
    if (boot(M, 0)) fail('Kart Lab 2 players did not load');
    for (let f = 0; f < 1100; f++) {
      const [m1, m2] = inputs(f);
      M._bkw_input(2, f === 57 ? 0 : m2, 0);
      if (M._bkw_frame(m1, 0)) { fail('Kart Lab 2 players stopped at frame ' + f); break; }
    }
    const k3 = (logs.find(l => l.startsWith('k2p')) || '').split(/\s+/).slice(1).join(' ');
    if (k3 !== '2 8 1 1 true true false 2') fail('Kart Lab split screen: ' + k3 + ' (expected 2 players racing in 2 views)');
    M._bkw_players(1, 0);
    if (errors.length) { errors.forEach(e => fail('Kart Lab 2 players: ' + e)); errors = []; }
  }

  if (!process.exitCode) console.log('ok: runtime checks, home screen, 3000 demo frames, level switching, cutscenes, save data, multiplayer, 2.5D floor and Kart Lab passed');
});
