// CI check: the emulator apps (studio/emuapps.js) in the WASM runtime, with the studio's way of keeping games
// (the same host hooks as studio/studio.js) and BitKit's own test cards (studio/emuroms.js). Each app lists its
// test card, starts it, plays it with the D-pad and A (picture moves, sound plays), opens the menu, saves a state,
// loads it back, keeps a battery save, remaps a button, and quits to the list. Exits non-zero on any failure.
const fs = require('fs'); global.window = {};
for (const f of ['emuroms.js', 'bitapps.js', 'emuapps.js']) eval(fs.readFileSync(__dirname + '/../studio/' + f, 'utf8'));
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok  ', m);
const runtime = require('../studio/runtime.js');
const BTN = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const mask = (...b) => b.reduce((m, k) => m | (1 << BTN[k]), 0);

function testCard(kind) {
  const t = window.BK_TEST_ROMS[kind], b = new Uint8Array(t.size);
  for (const [off, b64] of t.runs) b.set(Buffer.from(b64, 'base64'), off);
  return b;
}

runtime({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const apps = window.BK_APPS.filter(a => a.emu);
  if (apps.map(a => a.name).join() !== 'Game Boy,Game Boy Color,NES') fail('emulator apps on the Utilities row: ' + apps.map(a => a.name));
  if (window.BK_APPS[window.BK_APPS.length - 1].name !== 'Settings') fail('Settings should stay the last app');

  // the studio's host, in memory: a list per kind, saves and states by file name
  const store = { saves: new Map(), states: new Map() };
  let picks = [];
  const notify = (what, okv) => { const p = s(what); M._bkw_emu_notify(p, okv ? 1 : 0); M._free(p); };
  const lua = r => `{name="${r.name}",file="${r.file}",kind="${r.kind}",size=${r.size},save=${store.saves.has(r.file)},states={${
    [...store.states.keys()].filter(k => k.startsWith(r.file + '#')).map(k => `[${k.split('#')[1]}]=true`).join(',')}}}`;
  M.emuRoms = kind => { picks = [{ name: 'BitKit test card', file: 'BitKit test card.' + kind, kind, size: window.BK_TEST_ROMS[kind].size }]; return '{' + picks.map(lua).join(',') + '}'; };
  const pending = [];
  M.emuOpen = i => pending.push(() => {      // the studio loads asynchronously: do it between frames
    const r = picks[i - 1], rom = testCard(r.kind), p = M._bkw_emu_rom_alloc(rom.length);
    M.HEAPU8.set(rom, p);
    const np = s(r.file), k = M._bkw_emu_start(np); M._free(np);
    if (store.saves.has(r.file)) {
      const lp = M._malloc(4), sp = M._bkw_emu_sram(lp), n = M.HEAPU32[lp >> 2]; M._free(lp);
      if (sp && n) { M.HEAPU8.set(store.saves.get(r.file).subarray(0, n), sp); M._bkw_emu_sram_loaded(); }
    }
    notify('open', k > 0);
  });
  M.emuSram = (file, data) => store.saves.set(file, data);
  M.emuStateSave = (file, slot, data) => store.states.set(file + '#' + slot, data);
  M.emuStateLoad = (file, slot) => pending.push(() => {
    const d = store.states.get(file + '#' + slot);
    let k = 0;
    if (d) { const p = M._malloc(d.length); M.HEAPU8.set(d, p); k = M._bkw_emu_state_load(p, d.length); M._free(p); }
    notify('load', k);
  });

  const scr = M._bkw_screen();
  const frame = m => { const r = M._bkw_frame(m || 0, 0); while (pending.length) pending.shift()(); return r; };
  const frames = (n, m) => { for (let i = 0; i < n; i++) if (frame(m)) return false; return true; };
  const tap = b => { frame(mask(b)); frame(0); };
  const blockX = c => { let sx = 0, n = 0; for (let i = 0; i < 320 * 240; i++) if (M.HEAPU8[scr + i] === c) { sx += i % 320; n++; } return n ? sx / n : -1; };
  const loud = n => { M._bkw_audio(4096); let p = 0; for (let f = 0; f < n; f++) { frame(mask('a')); const a = M._bkw_audio(735) >> 2; for (let i = 0; i < 1470; i++) p = Math.max(p, Math.abs(M.HEAPF32[a + i])); } return p; };
  const screenText = () => logs.join('\n');

  const sv = M._bkw_save() >> 2;
  for (const app of apps) {
    errors = [];
    M.HEAP32[sv] = -1;                                  // each app starts with no settings saved
    const block = app.emu === 'nes' ? 192 + 0x30 : app.emu === 'gbc' ? 192 + 32 + 3 : 192 + 3;
    if (M._bkw_load_ex(s(''), s(app.code)) !== 0) { fail(`${app.name}: did not load: ${errors.join('; ')}`); continue; }
    frames(5);
    tap('a');                                           // the list has the test card: play it
    frames(30);
    if (M._bkw_emu_kind() !== { gb: 1, gbc: 2, nes: 3 }[app.emu]) { fail(`${app.name}: the test card did not start (kind ${M._bkw_emu_kind()})`); continue; }
    const x0 = blockX(block);
    frames(40, mask('right'));
    const x1 = blockX(block);
    if (x0 < 0 || x1 < x0 + 10) fail(`${app.name}: the block did not move right (${x0} -> ${x1})`);
    const p = loud(8);
    if (p < 0.01) fail(`${app.name}: no sound after A (${p})`);
    frames(4);
    ok(`${app.name}: plays the test card (block ${Math.round(x0)} -> ${Math.round(x1)}, sound ${p.toFixed(3)})`);

    // menu: L opens it, the game stops; save a state in slot 1, move, load it back
    tap('l');
    const xm = blockX(block);
    frames(20, mask('left'));                           // in the menu the D-pad moves the cursor, not the game
    if (Math.abs(blockX(block) - xm) > 1) fail(`${app.name}: the game kept running under the menu`);
    errors = [];
    tap('b'); tap('l'); tap('down'); tap('a');          // B resumes; L opens the menu at RESUME; Down, A: SAVE STATE, slot 1
    if (![...store.states.keys()].some(k => k.endsWith('#1'))) fail(`${app.name}: saving a state did not reach the host`);
    const xs = blockX(block);
    frames(30, mask('left'));
    const xmv = blockX(block);
    tap('l'); tap('down'); tap('down'); tap('a');       // LOAD STATE, slot 1
    frames(2);
    const xl = blockX(block);
    if (!(xmv < xs - 5) || Math.abs(xl - xs) > 3) fail(`${app.name}: load state did not bring the block back (saved ${xs}, moved ${xmv}, loaded ${xl})`);
    else ok(`${app.name}: save state and load state (block ${Math.round(xs)} -> ${Math.round(xmv)} -> ${Math.round(xl)})`);

    // screen sizes: the picture's width follows SCREEN
    const width = () => { let a = 320, b = -1; for (let y = 100; y < 101; y++) for (let x = 0; x < 320; x++) if (M.HEAPU8[scr + y * 320 + x] >= 192) { a = Math.min(a, x); b = Math.max(b, x); } return b - a + 1; };
    const w1 = width();
    tap('l'); tap('down'); tap('down'); tap('down'); tap('right'); tap('b');   // SCREEN: next size
    frames(2);
    const w2 = width();
    if (w1 === w2) fail(`${app.name}: SCREEN did not change the picture size (${w1})`);
    else ok(`${app.name}: screen size ${w1} -> ${w2} pixels wide`);

    // buttons: map the game's A to the Bit's X, then the test card beeps on X
    const items = app.emu === 'gb' ? 5 : 4;            // BUTTONS comes after COLOURS on the Game Boy
    tap('l'); for (let i = 0; i < items; i++) tap('down'); tap('a');   // BUTTONS
    tap('a'); tap('x');                                 // A -> press X
    tap('b'); tap('b');                                 // back to the menu, back to the game
    frames(10);
    let px = 0;
    M._bkw_audio(4096);
    for (let f = 0; f < 8; f++) { frame(mask('x')); const a = M._bkw_audio(735) >> 2; for (let i = 0; i < 1470; i++) px = Math.max(px, Math.abs(M.HEAPF32[a + i])); }
    if (px < 0.01) fail(`${app.name}: the game's A on the Bit's X did not beep`);
    else ok(`${app.name}: buttons can be remapped (A on X)`);

    // quit: back to the list, the emulator is closed
    tap('l'); tap('up'); tap('a');                      // up from RESUME wraps to QUIT GAME
    frames(3);
    if (M._bkw_emu_kind() !== 0) fail(`${app.name}: QUIT GAME left the emulator running`);
    if (errors.length) fail(`${app.name}: Lua errors: ${errors.join('; ')}`);
  }

  // a battery save reaches the host when the emulator closes, and comes back when the game starts again
  {
    // a tiny MBC1+RAM+BATTERY game: writes 0x42 to cartridge RAM and loops
    const rom = new Uint8Array(32768);
    rom.set([0x00, 0xC3, 0x50, 0x01], 0x100);
    rom.set([...'SAVETEST'].map(c => c.charCodeAt(0)), 0x134);
    rom[0x147] = 0x03; rom[0x148] = 0; rom[0x149] = 2;
    let x = 0; for (let i = 0x134; i < 0x14D; i++) x = (x - rom[i] - 1) & 255; rom[0x14D] = x;
    // ld a,$0a / ld ($0000),a (RAM on) / ld a,($a000) / inc a / ld ($a000),a / jr -2 (spin)
    rom.set([0x3E, 0x0A, 0xEA, 0x00, 0x00, 0xFA, 0x00, 0xA0, 0x3C, 0xEA, 0x00, 0xA0, 0x18, 0xFE], 0x150);
    const saved = [];
    M.emuSram = (file, data) => saved.push(data[0]);
    const run = () => {
      const p = M._bkw_emu_rom_alloc(rom.length); M.HEAPU8.set(rom, p);
      const np = s('savetest.gb'); const k = M._bkw_emu_start(np); M._free(np);
      if (saved.length) { const lp = M._malloc(4), sp = M._bkw_emu_sram(lp); M._free(lp); M.HEAPU8[sp] = saved[saved.length - 1]; M._bkw_emu_sram_loaded(); }
      return k;
    };
    M._bkw_load(s('function _update() emu_run(0) end'));
    if (run() !== 1) fail('battery save test ROM did not start');
    frames(3);
    M._bkw_emu_close();
    if (saved[0] !== 1) fail(`battery save: expected the counter 1 to reach the host, got ${saved}`);
    run(); frames(3); M._bkw_emu_close();
    if (saved[1] !== 2) fail(`battery save: the saved counter did not come back (got ${saved})`);
    else ok('battery saves go to the host when a game closes and come back when it starts');
  }

  if (!process.exitCode) ok('emulator apps');
});
