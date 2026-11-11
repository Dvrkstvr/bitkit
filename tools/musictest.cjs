// CI check: the music player (runtime/bk_music.lua), the shared song format (studio/music.js), Loopbox's note
// editing, and the Bit's music apps (studio/bitapps.js) played with buttons. Exits non-zero on any failure.
const fs = require('fs'); global.window = {}; global.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = String(v); } };
for (const f of ['music.js', 'loopbox.js', 'bitapps.js', 'entities.js', 'home.js']) eval(fs.readFileSync(__dirname + '/../studio/' + f, 'utf8'));
const MU = window.BKMusic;
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok  ', m);
const runtime = require('../studio/runtime.js');
const BTN = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };

runtime({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const sys = M._bkw_sys() >> 2, sv = M._bkw_save() >> 2;
  const peak = frames => {
    let p = 0;
    for (let f = 0; f < frames; f++) {
      if (M._bkw_frame(0, 0)) return -1;
      const a = M._bkw_audio(735) >> 2;
      for (let i = 0; i < 1470; i++) p = Math.max(p, Math.abs(M.HEAPF32[a + i]));
    }
    return p;
  };

  // ------------------------------------------------ format round trips
  {
    const song = MU.newSong('Test');
    const cells = song.pats[1][0];
    if (JSON.stringify(MU.unpack(MU.pack(cells))) !== JSON.stringify(cells)) fail('pack/unpack changed the cells');
    const back = MU.fromLuaSong(MU.parseLua(MU.luaSave(MU.toLuaSong(JSON.parse(JSON.stringify(song))))));
    ['bpm', 'rpb', 'rows', 'ch', 'loop'].forEach(k => { if (back[k] !== song[k]) fail(`Bit song round trip changed ${k}: ${back[k]} vs ${song[k]}`); });
    if (JSON.stringify(back.pats) !== JSON.stringify(song.pats)) fail('Bit song round trip changed the patterns');
    if (JSON.stringify(back.ord) !== JSON.stringify(song.ord)) fail('Bit song round trip changed the order');
    if (back.inst.length !== song.inst.length || back.inst[2].drum !== true) fail('Bit song round trip lost instruments');
    ok('song format: pack, Lua save and back');
  }

  // ------------------------------------------------ Loopbox: notes in a channel
  {
    const LB = window.BKLoopbox, list = [];
    LB.writeNotes(list, [{ r: 0, len: 4, n: 60, inst: 1 }, { r: 4, len: 2, n: 62, inst: 1 }, { r: 10, len: 3, n: 64, inst: 2 }], 16);
    const want = '[[0,60,1,-1,"",0],[4,62,1,-1,"",0],[6,-1,0,-1,"",0],[10,64,2,-1,"",0],[13,-1,0,-1,"",0]]';
    if (JSON.stringify(list) !== want) fail('writeNotes: ' + JSON.stringify(list));
    const notes = LB.notesOf(list, 16).map(n => [n.r, n.len, n.n].join(':')).join(' ');
    if (notes !== '0:4:60 4:2:62 10:3:64') fail('notesOf: ' + notes);
    ok('Loopbox notes <-> cells');
  }

  // ------------------------------------------------ the player in a game
  {
    const songs = [MU.newSong('Groove')];
    const fx = songs[0].pats[0];
    // every effect once, so none of them errors
    'AUDGVWPCRSJ'.split('').forEach((f, i) => MU.setCell(fx[0], [i * 2 + 1, 60 + i, 1, 200, f, f === 'S' ? 0x90 : f === 'J' ? 1 : 0x21]));
    const data = window.BKEntities.toLua({ types: [], placed: [], songs }, null, 0, '');
    if (!/SONGS = \{/.test(data)) fail('toLua did not emit SONGS');
    logs = []; errors = [];
    const code = `music("Groove") function _update() local p, r = music_pos() if t() % 20 == 0 then print("at", p, r) end end`;
    if (M._bkw_load_ex(s(data), s(code)) !== 0) fail('a cart with SONGS did not load: ' + errors.join(' '));
    const p = peak(400);
    if (p < 0) fail('music cart stopped: ' + errors.join(' '));
    else if (p < 0.05) fail('music made no sound (peak ' + p + ')');
    const at = logs.filter(l => l.startsWith('at')).map(l => l.split(/\s+/).slice(1).join(':'));
    if (!at.some(a => a.startsWith('2:'))) fail('the song never reached order position 2: ' + at.join(' '));
    if (errors.length) fail('music errors: ' + errors.join(' '));
    // stop, fade, note, voice
    M._bkw_eval(s('music_stop(30)'));
    peak(40);
    M._bkw_eval(s('print("stopped", music_pos() == nil)'));
    if (!logs.some(l => /^stopped\s+true/.test(l))) fail('music_stop(frames) did not stop after the fade');
    if (peak(30) > 0.001) fail('sound kept playing after music_stop');
    M._bkw_eval(s('music_note(1, 3, 52, 10)'));
    if (peak(5) < 0.05) fail('music_note made no sound');
    M._bkw_eval(s('voice(2, 440, 0.8, 4) for i = 1, 10 do end'));
    if (peak(3) < 0.05) fail('voice() made no sound');
    M._bkw_eval(s('voice(2, 440, 0)'));
    peak(3);
    if (peak(3) > 0.001) fail('voice(ch, hz, 0) did not end the note');
    M._bkw_eval(s('music(1, {loop = false, pos = 3})'));
    peak(400);
    M._bkw_eval(s('print("once", music_pos() == nil)'));
    if (!logs.some(l => /^once\s+true/.test(l))) fail('music(n, {loop = false}) did not stop at the end');
    if (errors.length) fail('music errors: ' + errors.join(' '));
    ok('music(), effects, music_stop, music_note, voice');
  }

  // ------------------------------------------------ the home screen's apps shelf
  {
    errors = [];
    const home = 'BIT = { games = {{name="A", file="a.bitkit", studio=false, color=3}, {name="Hexbeat", file="", studio=false, color=8, app=true}, {name="Loopbox", file="", studio=false, color=9, app=true}}, sel = 1, studio = true, source = "" }';
    M._bkw_load_ex(s(home), s(window.BK_HOME));
    M._bkw_frame(0, 0); M._bkw_frame(1 << BTN.down, 0); M._bkw_frame(0, 0); M._bkw_frame(1 << BTN.right, 0); M._bkw_frame(0, 0);
    M._bkw_frame(1 << BTN.a, 0);
    if (M.HEAP32[sys] !== 1 || M.HEAP32[sys + 1] !== 3) fail(`apps shelf launched ${M.HEAP32[sys]},${M.HEAP32[sys + 1]} (expected 1,3)`);
    if (errors.length) fail('home screen: ' + errors.join(' '));
    ok('home screen apps shelf');
  }

  // ------------------------------------------------ the Bit apps, played with buttons
  for (const app of window.BK_APPS) {
    errors = []; logs = [];
    M.HEAP32[sv] = -1; M.HEAP32[sv + 1] = 0;
    if (M._bkw_load_ex(s(''), s(app.code)) !== 0) { fail(`${app.name} did not load: ${errors.join(' ')}`); continue; }
    // a scripted session: every screen, edits with A held, play and stop, deletes
    const script = [];
    const hold = (b, n) => { for (let i = 0; i < n; i++) script.push(b); };
    const tap = b => { hold(b, 2); hold([], 2); };
    for (let scr = 0; scr < 3; scr++) {
      for (let k = 0; k < 6; k++) {
        tap(['right']); tap(['down']);
        hold(['a'], 3); hold(['a', 'up'], 2); hold(['a'], 2); hold(['a', 'right'], 2); hold(['a'], 2); hold(['a', 'down'], 2); hold([], 2);
        tap(['x']); tap(['y']); tap(['down']);
        hold(['y', 'right'], 2); hold([], 2); tap(['r']); tap(['l']);
      }
      tap(['start']); hold([], 60); tap(['start']);
      tap(['select']);
    }
    let bad = false;
    for (let f = 0; f < script.length + 120; f++) {
      const bs = script[f] || [];
      const mask = bs.reduce((m, b) => m | (1 << BTN[b]), 0);
      if (M._bkw_frame(mask, 0)) { fail(`${app.name} stopped at frame ${f}: ${errors.join(' ')}`); bad = true; break; }
    }
    if (bad) continue;
    if (M.HEAP32[sv] <= 0) { fail(`${app.name} did not save its songs`); continue; }
    let str = '';
    for (let i = 0; i < M.HEAP32[sv]; i++) str += String.fromCharCode(M.HEAPU8[((sv + 2) << 2) + i]);
    let songs = [];
    try { songs = MU.parseLua(str).songs.map(MU.fromLuaSong); } catch (e) { fail(`${app.name}'s save does not parse: ${e.message}`); }
    if (!songs.length || !songs[0].pats.length) fail(`${app.name}'s save has no songs`);
    if (errors.length) fail(`${app.name}: ${errors.join(' ')}`);
    ok(`${app.name}: ${script.length} frames of button presses, ${songs.length} song(s) saved (${str.length} bytes)`);
  }
});
