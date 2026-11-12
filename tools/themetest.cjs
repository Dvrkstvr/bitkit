// CI check: Bit themes (studio/themes.js) and the owner's profile. Every preset and every wallpaper, card, bar and
// letter style on the real home screen cart; every boot animation reaching home(); the Themes app played with buttons
// (browse, edit, colours, painting a wallpaper) with a save that the studio reads back; the Settings app's USER page;
// font(), sget()/sset(); player_name() and names sent with network events. Exits non-zero on any failure.
const fs = require('fs'); global.window = {}; global.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = String(v); } };
for (const f of ['music.js', 'bitapps.js', 'themes.js', 'entities.js', 'home.js']) eval(fs.readFileSync(__dirname + '/../studio/' + f, 'utf8'));
const TH = window.BKThemes, MU = window.BKMusic;
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok  ', m);
const BTN = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const runtime = require('../studio/runtime.js');

(async () => {
  const M = await runtime({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } });
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const sys = M._bkw_sys() >> 2, sv = M._bkw_save() >> 2;
  const load = (data, code) => { errors = []; logs = []; M.HEAP32[sys] = 0; return M._bkw_load_ex(s(data), s(code)); };
  const frames = (n, mask = 0) => { for (let i = 0; i < n; i++) if (M._bkw_frame(mask, 0)) return false; return true; };
  const press = b => { M._bkw_frame(1 << BTN[b], 0); M._bkw_frame(0, 0); };
  const saveStr = () => { let str = ''; for (let i = 0; i < M.HEAP32[sv]; i++) str += String.fromCharCode(M.HEAPU8[((sv + 2) << 2) + i]); return str; };
  const screenHash = () => { const p = M._bkw_screen(); let h = 0; for (let i = 0; i < 320 * 240; i += 7) h = (h * 31 + M.HEAPU8[p + i]) >>> 0; return h; };

  // ------------------------------------------------ the format: JS and Lua agree
  {
    if (TH.PRESETS.length < 6) fail('fewer than 6 preset themes');
    TH.PRESETS.forEach(p => { if (JSON.stringify(TH.fix(p)) !== JSON.stringify(p)) fail(`preset ${p.name} is not a fixed theme`); });
    const odd = TH.fix({ name: 'odd', c: { bg: 'zzzzzz', text: 'ABCDEF' }, wall: 'lava', speed: 99, card: 'round', pic: '1g2h', boottext: 'héllo' });
    if (odd.c.bg !== TH.PRESETS[0].c.bg || odd.c.text !== 'abcdef' || odd.wall !== 'stars' || odd.speed !== 10 || odd.card !== 'round' || odd.name !== 'ODD' || odd.boottext !== 'HLLO')
      fail('fix() kept something wrong: ' + JSON.stringify(odd));
    const px = new Uint8Array(4800); for (let i = 0; i < 4800; i++) px[i] = (i * 7 >> 6) % 16;
    const enc = TH.picEncode(px);
    if (TH.picDecode(enc).join() !== px.join()) fail('picture run-length code does not round trip');
    if (JSON.stringify(TH.importText(TH.exportText(TH.PRESETS[2]))) !== JSON.stringify(TH.PRESETS[2])) fail('.bittheme export/import changed the theme');
    let threw = false; try { TH.importText('{"format":"bitkit-cart"}'); } catch (e) { threw = true; }
    if (!threw) fail('importText took a file that is not a theme');
    // Lua decodes what JS encoded, and fixes themes the same way
    load('', TH.LIB + `\nfunction _init() local p = pic_decode(${TH.toLua(enc)}) local s = 0 for i = 1, 4800 do s = s + p[i] * i end print("sum", s, pic_encode(p) == ${TH.toLua(enc)})
      print("fix", theme_fix({name = "odd", c = {bg = "zzzzzz", text = "ABCDEF"}, wall = "lava", speed = 99, card = "round"}).wall) end`);
    frames(1);
    let sum = 0; px.forEach((v, i) => { sum += v * (i + 1); });
    if (!logs.some(l => l === `sum\t${sum}\ttrue`)) fail('Lua picture code differs from JS: ' + logs.join(' | ') + errors.join(' '));
    if (!logs.some(l => l === 'fix\tstars')) fail('Lua theme_fix differs: ' + logs.join(' | '));
    ok('theme format: fix, pictures, .bittheme files, JS and Lua agree');
  }

  // ------------------------------------------------ font() and sget/sset
  {
    load('', `function _draw() cls(0) font("classic") text("A", 0, 0, 7) font("bold") text("A", 20, 0, 7) font("slant", 9) text("A", 40, 0, 7)
      font("heavy") local w = text("AB", 60, 0, 7) font() sset(5, 200, 77) print("px", pget(1, 1), sget(5, 200), sget(500, 0), w) end`);
    frames(1);
    const p = M._bkw_screen(), at = (x, y) => M.HEAPU8[p + y * 320 + x];
    let a = 0, b = 0, o = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { if (at(x, y) === 7) a++; if (at(20 + x, y) === 7) b++; if (at(39 + x, y) === 9) o++; }
    if (!(b > a)) fail(`bold letters are not heavier (${a} vs ${b})`);
    if (o < 10) fail('letter outline missing');
    if (!logs.some(l => /^px\t\d+\t77\t0\t16$/.test(l))) fail('sget/sset or text width wrong: ' + logs.join(' | ') + errors.join(' '));
    load('', 'function _init() font("comic") end'); frames(1);
    if (!errors.some(e => /no font called/.test(e))) fail('font() with an unknown name did not say so');
    ok('font() styles and outline, sget/sset');
  }

  // ------------------------------------------------ the home screen with every preset and every style
  const games = '{name="A", file="a.bitkit", studio=false, color=3}, {name="B", file="b.bitkit", studio=false, color=8, paused=true}, {name="Themes", file="", studio=false, color=9, app=true, sub="make it yours"}';
  const home = (t, me) => `BIT = { games = {${games}}, sel = 1, studio = true, source = "", theme = ${TH.toLua(t)}, me = ${TH.toLua(me || { name: 'CALVIN', color: 27, bit: 'ZIPPY' })} }`;
  {
    const pic = TH.picEncode(new Uint8Array(4800).map((_, i) => (i % 80 < 40 ? 1 : 2)));
    const looks = new Set();
    for (const p of TH.PRESETS) {
      if (load(home(p), TH.LIB + window.BK_HOME) !== 0 || !frames(90) || !frames(4, 1 << BTN.down) || !frames(30) || errors.length) fail(`home with ${p.name}: ${errors.join(' ')}`);
      looks.add(screenHash());
    }
    if (looks.size < TH.PRESETS.length) fail(`only ${looks.size} different home screens for ${TH.PRESETS.length} presets`);
    let n = 0;
    for (const k of ['wall', 'card', 'bar', 'font', 'sound']) for (const v of TH.LISTS[k]) {
      const t = Object.assign(JSON.parse(JSON.stringify(TH.PRESETS[0])), { [k]: v, pic, outline: n % 2 === 0 });
      if (load(home(t), TH.LIB + window.BK_HOME) !== 0 || !frames(40) || !frames(2, 1 << BTN.right) || errors.length) fail(`home with ${k} = ${v}: ${errors.join(' ')}`);
      n++;
    }
    // a picture wallpaper really is drawn from the picture
    const t = Object.assign(JSON.parse(JSON.stringify(TH.PRESETS[0])), { wall: 'picture', speed: 0, pic });
    load(home(t), TH.LIB + window.BK_HOME); frames(2);
    const sp = M._bkw_screen();
    if (M.HEAPU8[sp + 30 * 320 + 4] !== 232 + 1 || M.HEAPU8[sp + 30 * 320 + 300] !== 232 + 2) fail('picture wallpaper not drawn from the picture');
    // the theme's colours are in the palette
    const pal = M._bkw_palette(), r = parseInt(t.c.bg.slice(0, 2), 16);
    if (M.HEAPU8[pal + 232 * 3] !== r) fail('theme colours not in palette slots 232-247');
    // still launches games
    load(home(TH.PRESETS[1]), TH.LIB + window.BK_HOME); frames(2); press('right'); M._bkw_frame(1 << BTN.a, 0);
    if (M.HEAP32[sys] !== 1 || M.HEAP32[sys + 1] !== 2) fail(`themed home launched ${M.HEAP32[sys]},${M.HEAP32[sys + 1]} (expected 1,2)`);
    ok(`home screen: ${TH.PRESETS.length} presets look different, ${n} styles run, picture wallpaper, launching`);
  }

  // ------------------------------------------------ boot animations go home
  {
    for (const k of TH.LISTS.boot) for (const snd of ['blip', 'mute']) {
      const t = Object.assign(JSON.parse(JSON.stringify(TH.PRESETS[3])), { boot: k, sound: snd });
      load(`BOOT = { theme = ${TH.toLua(t)}, title = "ZIPPY", sub = "CALVIN'S BIT" }`, TH.LIB + TH.BOOT);
      let f = 0;
      while (f < 400 && M.HEAP32[sys] !== 2) { if (M._bkw_frame(0, 0)) break; f++; }
      if (M.HEAP32[sys] !== 2 || errors.length) fail(`boot "${k}" did not go home (${f} frames) ${errors.join(' ')}`);
      if (k !== 'none' && f < 100) fail(`boot "${k}" was over too soon (${f} frames)`);
    }
    // a button skips it
    load(`BOOT = { theme = ${TH.toLua(TH.PRESETS[0])}, title = "X" }`, TH.LIB + TH.BOOT); frames(20); M._bkw_frame(1 << BTN.a, 0);
    if (M.HEAP32[sys] !== 2) fail('a button did not skip the boot animation');
    ok(`boot animations: ${TH.LISTS.boot.join(', ')} all reach the home screen`);
  }

  // ------------------------------------------------ the Themes app, played with buttons
  {
    const app = window.BK_APPS.find(a => a.theme);
    M.HEAP32[sv] = -1; M.HEAP32[sv + 1] = 0;
    if (!app) fail('no Themes app on the Utilities row');
    else if (load('', app.code) !== 0) fail('Themes app did not load: ' + errors.join(' '));
    else {
      frames(5);
      press('down'); press('down'); press('a');               // the third preset: NEON DRIVE
      frames(40);
      let o = MU.parseLua(saveStr() || '{}');
      if (!o.theme || o.theme.name !== TH.PRESETS[2].name) fail('Themes: picking a preset did not save it: ' + saveStr().slice(0, 80));
      press('r');                                                // EDIT
      press('down'); press('right'); press('right');             // wallpaper -> +2
      press('down'); press('left');                              // motion -1
      press('down'); press('a');                                 // paint the wallpaper
      for (let i = 0; i < 10; i++) { M._bkw_frame((1 << BTN.a) | (1 << BTN.right), 0); M._bkw_frame(1 << BTN.a, 0); }
      press('r'); press('r'); press('y');                        // colour 3, fill everything under the cursor
      press('b');                                                // done painting
      press('down'); press('down'); press('down'); press('right');   // letters, outline, cards +1
      press('down'); press('down'); press('right');              // sounds +1
      press('down'); press('a'); press('a');                     // boot animation +2
      press('down'); press('a'); press('a'); press('right'); press('a'); press('start');   // boot text "AB"
      press('down'); press('a'); frames(20); press('a');         // play the boot here, skip it
      press('r');                                                // COLOURS
      press('right'); press('a'); press('down'); press('right'); press('right'); press('b');
      frames(40);
      o = MU.parseLua(saveStr() || '{}');
      const t = TH.fix(o.theme);
      if (t.wall !== 'picture' || !t.pic) fail('Themes: painting did not make a picture wallpaper: ' + JSON.stringify(t).slice(200, 600));
      else {
        const px = TH.picDecode(t.pic);
        if (!px.some(v => v === 3) || px[30 * 80 + 41] !== 3) fail('Themes: the painted picture is not what was painted');
      }
      if (t.boottext !== 'AB') fail('Themes: boot text is ' + t.boottext);
      if (t.c.bg === TH.PRESETS[2].c.bg) fail('Themes: colour change not saved');
      if (t.card === TH.PRESETS[2].card) fail('Themes: card change not saved');
      // save as my theme
      press('l'); press('l');
      for (let i = 3; i <= TH.PRESETS.length; i++) press('down');   // from NEON DRIVE (3rd) to "+ save as my theme"
      press('a'); frames(5);
      o = MU.parseLua(saveStr() || '{}');
      if (!Array.isArray(o.mine) || o.mine.length !== 1) fail('Themes: "save as my theme" did not keep it');
      if (errors.length) fail('Themes: ' + errors.join(' '));
      // the studio reads it back
      localStorage.setItem('bitkit.save.' + TH.SAVE_KEY, saveStr());
      const back = TH.readSave();
      if (back.theme.pic !== t.pic || back.mine.length !== 1) fail('studio could not read the Themes app\'s save: ' + JSON.stringify(back).slice(0, 300) + ' RAW ' + saveStr().slice(0, 300));
      ok(`Themes app: preset, edit, paint (${t.pic.length} chars), colours, boot, my theme; ${saveStr().length} byte save`);
    }
  }

  // ------------------------------------------------ the Settings app's USER page
  {
    const app = window.BK_APPS.find(a => a.settings);
    M.HEAP32[sv] = -1; M.HEAP32[sv + 1] = 0;
    load('', app.code); frames(2);
    press('r');                       // USER
    press('down');                    // past LANGUAGE
    press('a');                       // keyboard for YOUR NAME
    press('a'); press('right'); press('a'); press('down'); press('a'); press('start');   // "A", "B", "L"
    press('down'); press('right'); press('right');   // colour +2
    frames(5);
    const o = MU.parseLua(saveStr() || '{}');
    if (o.name !== 'ABL') fail('Settings USER: name saved as ' + JSON.stringify(o.name));
    if (o.color === 27) fail('Settings USER: colour not changed');
    if (errors.length) fail('Settings USER: ' + errors.join(' '));
    ok('Settings app USER page: name with the keyboard, colour');
  }

  // ------------------------------------------------ player names
  {
    load('NAMES = {"CALVIN", "SAM"}\nNAME_COLORS = {27, 21}', 'function _init() print("n", player_name(1), player_name(2), player_name(3), player_name(1, 3), player_color(2), player_color(5, 9)) end');
    frames(1);
    if (!logs.includes('n\tCALVIN\tSAM\tP3\tCAL\t21\t9')) fail('player_name: ' + logs.join(' | ') + errors.join(' '));
    load('', 'function _init() print("n", player_name(1), player_name(2)) end'); frames(1);
    if (!logs.includes('n\tP1\tP2')) fail('player_name without names: ' + logs.join(' | '));
    // names travel with network events: Bit 1 sends, Bit 2 hears the name and not the event
    const M2 = await runtime({ onLog: (m, e) => { if (e) errors.push('Bit 2: ' + m); else logs.push(m); } });
    M2._bkw_init();
    const n1 = M._bkw_net() >> 2, n2 = M2._bkw_net() >> 2;
    M.HEAP32[n1] = 11; M2.HEAP32[n2] = 22;
    load('NAMES = {"CALVIN"}\nNAME_COLORS = {26}', 'function _update() if t() == 1 then net_send(5, 6) end end');
    M.HEAP32[n1] = 11;
    frames(2);
    const outN = M.HEAP32[n1 + 1];
    const cs = x => M2.stringToNewUTF8(x);
    M2._bkw_load_ex(cs(''), cs('function _update() local got = {} while true do local r = {net_recv()} if not r[1] then break end got[#got + 1] = table.concat(r, ",") end if #got > 0 then print("got", table.concat(got, ";"), net_name(11), NET_COLORS[11]) end end'));
    M2.HEAP32[n2] = 22;
    const IN = n2 + 4 + 16 * 10;
    for (let k = 0; k < outN; k++) for (let j = 0; j < 10; j++) M2.HEAP32[IN + k * 10 + j] = M.HEAP32[n1 + 4 + k * 10 + j];
    M2.HEAP32[n2 + 2] = outN; M2.HEAP32[n2 + 3] = 0;
    M2._bkw_frame(0, 0);
    if (outN !== 2) fail(`expected the name and the game's event, Bit 1 sent ${outN}`);
    if (!logs.includes('got\t11,5,6\tCALVIN\t26')) fail('net names: ' + logs.join(' | ') + errors.join(' '));
    ok('player_name(), player_color(), names sent with network events');
  }

  if (!process.exitCode) console.log('themes ok: presets, styles, boot, Themes app, Settings USER, names');
})().catch(e => { fail(e.stack || e); });
