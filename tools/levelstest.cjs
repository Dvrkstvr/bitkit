// CI check for Sprout Hop's Levels screen: the title and pause menus open it, locked levels stay shut,
// clearing a level unlocks the next, per-level stats (clears, deaths, best time) survive a reload,
// and the skip-cutscenes switch skips cutscenes only on levels you have already cleared.
// Also covers the shell calls it uses: game{menu=}, game_screen(), game_title(), cutscene_skip(), cutscenes_reset().
const fs = require('fs'); global.window = {};
for (const f of ['demo', 'entities']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const bit = (...names) => names.reduce((m, n) => m | (1 << B[n]), 0);
require('../studio/runtime.js')({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const sv = M._bkw_save() >> 2, sys = M._bkw_sys() >> 2;
  const d = window.BK_DEMOS.find(x => x.name === 'Sprout Hop');
  const c = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  d.buildGfx(c);
  M.HEAPU8.set(c.tiles, M._bkw_tiles()); M.HEAPU8.set(c.flags, M._bkw_flags());
  const meta = c.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed }));
  const PROBE = 'local _pd = _draw\nfunction _draw() if _pd then _pd() end print("gs", GAME.state, LEVEL, cutscene_playing() and "cut" or "nocut", SKIP, rec(1).clears, rec(1).deaths, rec(1).time or -1, mode, sel, unlocked(2)) end';
  const load = (probe, extra) => {
    M.HEAPU16.set(c.levels[0].map, M._bkw_map() >> 1);
    logs = [];
    if (M._bkw_load_ex(s(window.BKEntities.toLua(c.entities, meta, 0, extra || '')), s(d.code + '\n' + PROBE + '\n' + (probe || ''))) !== 0) fail('did not load: ' + errors.join(' '));
  };
  const frame = (mask = 0) => {
    M._bkw_frame(mask, 0);
    if (M.HEAP32[sys] === 4) M.HEAPU16.set(c.levels[M.HEAP32[sys + 1] - 1].map, M._bkw_map() >> 1);
    M.HEAP32[sys] = 0;
  };
  const tap = (...n) => { frame(bit(...n)); frame(0); };
  const run = n => { for (let i = 0; i < n; i++) frame(0); };
  const st = () => { const l = logs.filter(x => x.startsWith('gs')).pop(); return l ? l.split(/\s+/).slice(1) : []; };
  const [STATE, LEVEL, CUT, SKIP, CLEARS, DEATHS, TIME, MODE, SEL, OPEN2] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // 1. a fresh game: the title has New game, Levels, ...; Levels opens the level screen, level 2 is locked, B goes back
  M.HEAP32[sv] = -1;
  load();
  run(3);
  if (st()[STATE] !== 'title') fail('should start on the title screen, got ' + st()[STATE]);
  tap('down'); tap('a'); run(1);
  if (st()[STATE] !== 'screen' || st()[MODE] !== 'levels') fail('Levels should open the level screen, got ' + st().join(' '));
  if (st()[OPEN2] !== 'false') fail('level 2 should be locked in a fresh game');
  tap('down'); tap('a'); run(2);
  if (st()[STATE] !== 'screen') fail('A on a locked level should do nothing, got ' + st()[STATE]);
  tap('b'); run(1);
  if (st()[STATE] !== 'title') fail('B on the level screen opened from the title should go back to it, got ' + st()[STATE]);

  // 2. play level 1 from the level screen: its intro plays; die once; touch the flag
  tap('down'); tap('a'); tap('a'); run(5);      // Levels, [Sunny Meadow]
  if (st()[STATE] !== 'play' || st()[LEVEL] !== '1' || st()[CUT] !== 'cut') fail('picking level 1 should play it with its intro, got ' + st().join(' '));
  tap('start'); run(30);                        // skip the intro, then play a moment
  load('local _u = _update\nfunction _update() _u() if GAME.state == "play" and not dd then dd = true ents_damage(PLAYER, 99) end end', 'GAME_BOOT = 3\n');
  run(5); tap('start'); run(5); tap('start'); run(2);   // skip the intro, then pause: pausing saves the stats
  if (st()[DEATHS] !== '1') fail('a death should count in level 1\'s stats, got ' + st()[DEATHS]);
  tap('b'); run(2);
  load('local _u = _update\nfunction _update() _u() if GAME.state == "play" and not cl and t() > 40 then cl = true emit("clear") level(2) end end', 'GAME_BOOT = 3\n');
  run(5); tap('start'); run(60);
  if (st()[LEVEL] !== '2' || st()[CLEARS] !== '1' || +st()[TIME] <= 0) fail('clearing level 1 should record a clear and a time and go to level 2, got ' + st().join(' '));
  if (st()[DEATHS] !== '1') fail('the deaths from the earlier run should still be in the save, got ' + st()[DEATHS]);

  // 3. after a reload level 2 is open; the skip switch skips cutscenes on cleared levels only
  load();
  run(3);
  if (st()[OPEN2] !== 'true' || st()[CLEARS] !== '1') fail('the stats and the unlock should survive a reload, got ' + st().join(' '));
  // title: Continue, [Levels] (a save file: no New game)
  tap('down'); tap('a'); run(1);
  if (st()[MODE] !== 'levels') fail('Levels should be second on the title once there is a save, got ' + st().join(' '));
  tap('down'); tap('down'); tap('a'); run(1);   // Sunny Meadow, Mossy Cave, [Skip cutscenes]
  if (st()[SKIP] !== 'true') fail('A on the switch should turn skipping on, got ' + st()[SKIP]);
  tap('down'); tap('a'); run(4);                // wraps to [Sunny Meadow] (cleared): no cutscene
  if (st()[STATE] !== 'play' || st()[LEVEL] !== '1' || st()[CUT] !== 'nocut') fail('a cleared level with skipping on should start without its intro, got ' + st().join(' '));
  // pause -> Level select -> Mossy Cave (not cleared yet): its intro still plays
  tap('start'); run(1);
  tap('down'); tap('down'); tap('a'); run(1);   // Resume, Back to checkpoint, [Level select]
  if (st()[STATE] !== 'screen') fail('Level select in the pause menu should open the level screen, got ' + st().join(' '));
  tap('b'); run(1);
  if (st()[STATE] !== 'play') fail('B on the level screen opened from the pause menu should go back to the game, got ' + st()[STATE]);
  tap('start'); run(1); tap('down'); tap('down'); tap('a'); run(1);
  tap('down'); tap('a'); run(4);                // [Mossy Cave]
  if (st()[LEVEL] !== '2' || st()[CUT] !== 'cut') fail('a level not cleared yet should play its intro even with skipping on, got ' + st().join(' '));
  // switch skipping off: a replay of level 1 plays its intro again
  run(5); tap('start'); run(5);
  tap('start'); run(1); tap('down'); tap('down'); tap('a'); run(1);
  tap('down'); tap('a'); tap('up'); tap('up'); tap('a'); run(4);   // [Skip] off, then [Sunny Meadow]
  if (st()[SKIP] !== 'false' || st()[LEVEL] !== '1' || st()[CUT] !== 'cut') fail('with skipping off a replay should play the intro again, got ' + st().join(' '));
  if (errors.length) errors.forEach(e => fail(e));
  if (!process.exitCode) console.log('ok: Sprout Hop levels screen (unlocks, per-level stats in the save, skip cutscenes on replays) passed');
});
