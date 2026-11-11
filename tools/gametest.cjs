// CI check for the game shell (runtime/bk_game.lua, GAME_RULES.md): every demo has a title screen and a goal,
// the pause menu and settings work, settings and checkpoints survive a reload, and Continue picks up from them.
const fs = require('fs'); global.window = {};
for (const f of ['demo', 'harbour', 'sweep', 'tracks', 'kart', 'crossgate', 'entities', 'rules']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const bit = (...names) => names.reduce((m, n) => m | (1 << B[n]), 0);
require('../studio/runtime.js')({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const sv = M._bkw_save() >> 2, sys = M._bkw_sys() >> 2;
  const demo = name => window.BK_DEMOS.find(d => d.name === name);
  const gfx = d => {
    const c = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
    d.buildGfx(c);
    const levels = c.levels || [{ name: 'Level 1', w: 256, h: 128, map: c.map, placed: c.entities.placed }];
    M.HEAPU8.set(c.tiles, M._bkw_tiles()); M.HEAPU8.set(c.flags, M._bkw_flags()); M.HEAPU16.set(levels[0].map, M._bkw_map() >> 1);
    return { c, levels, meta: levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track, height: L.height })) };
  };
  let cur = null;
  const load = (name, probe, extra) => {
    const d = demo(name);
    cur = gfx(d);
    logs = [];
    const rc = M._bkw_load_ex(s(window.BKEntities.toLua(cur.c.entities, cur.meta, 0, extra || '')), s(d.code + '\n' + (probe || '')));
    if (rc !== 0) fail(name + ' did not load: ' + errors.join(' '));
  };
  let sysReq = null;
  const frame = (mask = 0) => {
    const r = M._bkw_frame(mask, 0);
    if (M.HEAP32[sys] === 4) M.HEAPU16.set(cur.levels[M.HEAP32[sys + 1] - 1].map, M._bkw_map() >> 1);
    else if (M.HEAP32[sys]) sysReq = [M.HEAP32[sys], M.HEAP32[sys + 1]];
    return r;
  };
  const tap = (...names) => { frame(bit(...names)); frame(0); };
  const run = n => { for (let i = 0; i < n; i++) frame(0); };
  // the probe prints the shell state every frame from the cart's _draw
  const PROBE = 'local _pd = _draw\nfunction _draw() if _pd then _pd() end print("gs", GAME.state, setting("volume"), PLAYER and math.floor(PLAYER.x) or -1, score or -1, LEVEL or -1) end';
  const st = () => { const l = logs.filter(x => x.startsWith('gs')).pop(); return l ? l.split(/\s+/).slice(1) : []; };

  // 0. the rules (studio/rules.js, the studio's Rules button): every built-in demo meets all of them
  for (const d of window.BK_DEMOS) {
    window.BKRules.check(d).filter(r => !r.ok).forEach(r => fail(`${d.name} breaks the rule "${r.name}": ${r.about}`));
  }
  if (window.BKRules.check({ code: 'function _draw() cls(1) end' }).some(r => r.ok)) fail('an empty cart should not pass any rule');
  // the New cart template meets the rules too, and runs
  const NEW_CODE = (/const NEW_CODE = `([\s\S]*?)`;/.exec(fs.readFileSync(__dirname + '/../studio/studio.js', 'utf8')) || [])[1] || '';
  window.BKRules.check({ code: NEW_CODE }).filter(r => !r.ok).forEach(r => fail(`the New cart template breaks the rule "${r.name}"`));
  M.HEAP32[sv] = -1;
  if (M._bkw_load_ex(s('GAME_BOOT = 3'), s(NEW_CODE)) !== 0) fail('the New cart template did not load: ' + errors.join(' '));
  for (let f = 0; f < 120; f++) M._bkw_frame(f % 20 < 10 ? bit('right') : bit('down'), 0);
  if (errors.length) { errors.forEach(e => fail('New cart template: ' + e)); errors = []; }

  // 1. Sprout Hop starts on its title screen; A on "New game" starts playing
  M.HEAP32[sv] = -1;
  load('Sprout Hop', PROBE);
  run(3);
  if (st()[0] !== 'title') fail('Sprout Hop should start on the title screen, got ' + st()[0]);
  tap('a'); run(2);
  if (st()[0] !== 'play') fail('A on the title screen should start the game, got ' + st()[0]);

  // 2. Start opens the pause menu (Start during the intro cutscene skips it instead), Settings changes the volume
  run(10);
  tap('start'); run(5);
  if (st()[0] !== 'play') fail('Start during a cutscene should skip it, not pause, got ' + st()[0]);
  tap('start'); run(1);
  if (st()[0] !== 'pause') fail('Start should open the pause menu, got ' + st()[0]);
  tap('down'); tap('down'); tap('a');               // Resume, Back to checkpoint, [Settings]
  if (st()[0] !== 'settings') fail('Settings should open from the pause menu, got ' + st()[0]);
  tap('left'); tap('left'); tap('left');
  if (st()[1] !== '7') fail('left x3 should turn the volume down to 7, got ' + st()[1]);
  tap('b'); tap('b');
  if (st()[0] !== 'play') fail('B, B should go back to the game, got ' + st()[0]);
  // Start+Select is the home screen combo, not pause
  frame(bit('start')); frame(bit('start', 'select')); frame(0); run(1);
  if (st()[0] !== 'play') fail('Start+Select should not open the pause menu, got ' + st()[0]);

  // 3. a checkpoint and the volume survive a reload; Continue carries on from the checkpoint
  load('Sprout Hop', PROBE + '\nlocal _u = _update\nfunction _update() _u() if GAME.state == "play" and not cp_done then cp_done = true score = 3 checkpoint({level = 1, x = 120, y = 40, score = 3}) end end');
  run(2); tap('a'); run(5); tap('start'); run(5);   // no checkpoint yet, so A is New game; Start skips the intro
  const saveStr = M.HEAP32[sv] > 0 ? Buffer.from(M.HEAPU8.slice((sv + 2) << 2, ((sv + 2) << 2) + M.HEAP32[sv])).toString() : '';
  if (!/_bitkit_game/.test(saveStr) || !/"vol"\]=7/.test(saveStr)) fail('the save should hold the shell data with volume 7: ' + saveStr.slice(0, 120));
  load('Sprout Hop', PROBE);
  run(2);
  if (st()[0] !== 'title' || st()[1] !== '7') fail('after a reload: expected the title screen with volume 7, got ' + st().join(' '));
  tap('a'); run(3); tap('start'); run(3);   // Continue is first now
  const s3 = st();
  if (s3[0] !== 'play' || Math.abs(+s3[2] - 120) > 4 || s3[3] !== '3') fail('Continue should put the player at the checkpoint (x 120, 3 drops), got ' + s3.join(' '));

  // 4. Quit to title, then New game asks the host to load the cart again (sys 5, mode 2)
  tap('start'); run(1);
  for (let i = 0; i < 4; i++) tap('down');          // Resume, Back to checkpoint, Settings, How to play, [Quit to title]
  tap('a'); run(1);
  if (st()[0] !== 'title') fail('Quit to title should show the title screen, got ' + st()[0]);
  sysReq = null;
  tap('down'); tap('a'); run(1);                    // Continue, [New game] -> confirm
  if (st()[0] !== 'confirm') fail('New game with progress should ask first, got ' + st()[0]);
  tap('up'); tap('a');                              // [Start over], Cancel
  if (!sysReq || sysReq[0] !== 5 || sysReq[1] !== 2) fail('New game after playing should ask the host to restart (5, 2), got ' + sysReq);
  load('Sprout Hop', PROBE, 'GAME_BOOT = 2\n');
  run(2);
  if (st()[0] !== 'play') fail('GAME_BOOT = 2 should go straight into play, got ' + st()[0]);
  load('Sprout Hop', PROBE);
  run(2);
  tap('a'); run(2);
  if (st()[0] !== 'play' || st()[3] !== '0') fail('after starting over there should be no checkpoint (New game first): ' + st().join(' '));

  // 5. reaching the goal shows the goal screen once the ending cutscene is over
  load('Sprout Hop', PROBE + '\nlocal _u = _update\nfunction _update() _u() if GAME.state == "play" and not w then w = true emit("win") end end', 'GAME_BOOT = 3\n');
  for (let f = 0; f < 900 && st()[0] !== 'won'; f++) frame(f % 8 === 0 ? bit('a') : 0);
  if (st()[0] !== 'won') fail('game_win() should show the goal screen, got ' + st()[0]);
  if (errors.length) { errors.forEach(e => fail('Sprout Hop: ' + e)); errors = []; }

  // 6. Beacon Keeper keeps its own save: Continue when there is one, New game wipes it
  M.HEAP32[sv] = -1;
  const BP = 'local _pd = _draw\nfunction _draw() if _pd then _pd() end print("gs", GAME.state, G.docked, G.coins) end';
  load('Beacon Keeper', BP);
  run(2);
  if (st()[0] !== 'title') fail('Beacon Keeper should start on the title screen, got ' + st()[0]);
  tap('a'); run(400);                            // New game, then play a little (it saves every 300 frames)
  load('Beacon Keeper', BP + '\nlocal _i = _init\nfunction _init() _i() if not once then once = true G.coins = 77 end end');
  run(2);
  tap('down'); tap('a'); run(1);                  // Continue, [New game] -> confirm
  if (st()[0] !== 'confirm') fail('Beacon Keeper New game with a save should ask first, got ' + st()[0]);
  tap('up'); tap('a'); run(2);
  if (st()[0] !== 'play' || st()[2] !== '0') fail('Beacon Keeper New game should start over with 0 coins, got ' + st().join(' '));
  if (errors.length) { errors.forEach(e => fail('Beacon Keeper: ' + e)); errors = []; }

  // 7. Kart Lab: Continue goes straight into a race with the saved kart
  M.HEAP32[sv] = -1;
  const KP = 'local _pd = _draw\nfunction _draw() if _pd then _pd() end print("gs", GAME.state, mode) end';
  load('Kart Lab', KP);
  run(2);
  tap('a'); run(12);                              // New game -> garage
  if (st()[1] !== 'garage') fail('Kart Lab New game should open the garage, got ' + st().join(' '));
  for (let i = 0; i < 5; i++) tap('down');
  tap('a'); run(5);                               // RACE! -> saves the kart
  load('Kart Lab', KP);
  run(2); tap('a'); run(2);                       // Continue
  if (st()[0] !== 'play' || !['loading', 'count'].includes(st()[1])) fail('Kart Lab Continue should go straight to a race, got ' + st().join(' '));
  if (errors.length) { errors.forEach(e => fail('Kart Lab: ' + e)); errors = []; }

  if (!process.exitCode) console.log('ok: game shell (title, pause, settings, checkpoints, Continue, goal) in every demo passed');
});
