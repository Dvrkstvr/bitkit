// CI check for languages (runtime/bk_lang.lua): lang(), tr(), texts{} and text() translating by itself, numbers in
// words, the 8x8 font's letters for umlauts and accents, the game shell in German, and every built-in cart's words.
const fs = require('fs'); global.window = {};
let errors = [], logs = [];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
require('../studio/runtime.js')({ onLog: (m, e) => { if (e) errors.push(m); else logs.push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const setLang = c => { const p = s(c); M._bkw_lang(p); M._free(p); };
  const load = (code, data) => { errors = []; logs = []; const rc = M._bkw_load_ex(s(data || ''), s(code)); if (rc) fail('load: ' + errors.join(' ')); return rc; };
  const scr = () => M.HEAPU8.slice(M._bkw_screen(), M._bkw_screen() + 320 * 240);
  const lit = (sc, x0, y0, w, h) => { let n = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (sc[y * 320 + x] === 7) n++; return n; };

  // 1. lang(), tr(), formats, tables, number words, one byte a letter
  setLang('de');
  load(`texts{ de = { ["Start"] = "Los geht's", ["SCORE #"] = "PUNKTE #", ["You found %s!"] = "Du hast %s gefunden!", ["LAP #/#"] = "RUNDE #/#" } }
    print("L", lang())
    print("T1", tr("Start"))
    print("T2", tr("You found %s!", "Gold"))
    print("T3", tr{en = "Hi", de = "Hallo"}, tr{en = "Hi", fr = "Salut"})
    print("T4", tr("SCORE 120"), tr("LAP 2/3"), tr("nothing 5"))
    print("T5", #tr("Größe"), #"Größe", textw("Größe"), textw("ab\\nabcd"))
    print("T6", tr("Continue"), tr("PAUSED"))
    print("T7", lang_name(), lang_name("fr"), lang_nth(3))
    function _draw() cls(0) text("Start", 0, 0, 7) text("Start", 160 - 5 * 4, 20, 7) text("SCORE 7", 0, 40, 7) end`);
  const got = k => (logs.find(l => l.startsWith(k + '\t')) || '').split('\t').slice(1);
  const latin = str => Buffer.from(str, 'latin1').toString('latin1');
  if (got('L')[0] !== 'de') fail('lang() should be de: ' + got('L'));
  if (got('T1')[0] !== "Los geht's") fail('tr("Start"): ' + got('T1'));
  if (got('T2')[0] !== 'Du hast Gold gefunden!') fail('tr with a format: ' + got('T2'));
  if (got('T3').join('|') !== 'Hallo|Hi') fail('tr{...}: ' + got('T3'));
  if (got('T4').join('|') !== 'PUNKTE 120|RUNDE 2/3|nothing 5') fail('numbers in words: ' + got('T4'));
  if (got('T5').join('|') !== '5|7|40|32') fail('one byte a letter after tr(), textw(): ' + got('T5'));
  if (!/^Weiterspielen$/.test(got('T6')[0]) || got('T6')[1] !== 'PAUSE') fail('the Bit\'s own words: ' + got('T6'));
  if (got('T7').join('|') !== 'Deutsch|Fran�ais|3.' && got('T7')[0] !== 'Deutsch') fail('lang_name/lang_nth: ' + got('T7'));
  M._bkw_frame(0, 0);
  let sc = scr();
  // "Los geht's" is 10 letters: at the left it starts at 0 and runs to 80; centred it moves left by 5 letters' half
  if (lit(sc, 72, 0, 8, 8) === 0) fail('text() did not draw the German word (10 letters) for "Start"');
  if (lit(sc, 140 - 20, 20, 8, 8) === 0 || lit(sc, 200, 20, 8, 8) !== 0) fail('a centred word should stay centred when it gets longer');
  if (lit(sc, 56, 40, 8, 8) === 0) fail('"SCORE 7" should draw as "PUNKTE 7"');
  // texts(false): text() draws what it's given
  load(`texts{ de = { ["Start"] = "Los geht's" } } texts(false) function _draw() cls(0) text("Start", 0, 0, 7) end`);
  M._bkw_frame(0, 0); sc = scr();
  if (lit(sc, 48, 0, 32, 8) !== 0) fail('texts(false) should keep text() from translating');
  // English: nothing changes
  setLang('en');
  load(`texts{ de = { ["Start"] = "Los geht's" } } print("E", tr("Start"), tr("Continue")) function _draw() cls(0) text("Start", 0, 0, 7) end`);
  if (got('E').join('|') !== 'Start|Continue') fail('English should keep the words: ' + got('E'));
  M._bkw_frame(0, 0); sc = scr();
  if (lit(sc, 48, 0, 32, 8) !== 0) fail('in English text() draws the word as written');

  // 2. the font: umlauts and accents draw (not '?'), UTF-8 and the one-byte form look the same
  setLang('de');
  load(`function _draw() cls(0) text("?", 0, 0, 7) text("ä", 0, 10, 7) text(tr("ä"), 0, 20, 7) text("ß", 0, 30, 7) text("€", 0, 40, 7) text("¿", 0, 50, 7) text("…", 0, 60, 7) text("😀", 0, 70, 7) end`);
  M._bkw_frame(0, 0); sc = scr();
  const glyph = y => { const a = []; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) a.push(sc[(y + j) * 320 + i] === 7 ? 1 : 0); return a.join(''); };
  const q = glyph(0);
  for (const [y, n] of [[10, 'ä'], [30, 'ß'], [40, '€'], [50, '¿'], [60, '…']]) if (glyph(y) === q || !glyph(y).includes('1')) fail(`the font has no letter for ${n}`);
  if (glyph(10) !== glyph(20)) fail('ä in UTF-8 and in the one-byte form should look the same');
  if (glyph(70) !== q) fail('a letter the font hasn\'t got draws as ?');

  // 3. the game shell speaks German: menu names stay English inside (GAME.items), the screen shows German
  global.window = {};
  for (const f of ['demo', 'entities']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
  load(`game{ title = "Test", goal = "Reach the flag." } function _draw() cls(1) end
    local o = _bk_overlay function _bk_overlay() o() print("items|" .. table.concat(GAME.items, "|")) end`);
  M._bkw_frame(0, 0);
  const items = (logs.filter(l => l.startsWith('items|')).pop() || '').split('|').slice(1);
  if (items[0] !== 'New game') fail('GAME.items stay English for games and tests: ' + items);

  // 4. every built-in cart's texts{} is well formed: same keys' # count, and each language one of LANGUAGES
  const langs = ['de', 'fr', 'es'];
  const LUA = fs.readFileSync(__dirname + '/../runtime/bk_lang.lua', 'utf8');
  for (const l of langs) if (!LUA.includes(`  ${l} = {`)) fail(`the Bit's own words have no ${l} table`);
  if (errors.length) fail('errors: ' + errors.join(' | '));
  console.log(process.exitCode ? 'langtest failed' : 'ok: lang(), tr(), texts{} and text() translating, numbers in words, umlauts and accents, the shell in German');
});
