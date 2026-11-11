// CI check for Windrow, the farming game: hand work on the plot (dig, plant, water, grow, pick, sell), foraging,
// the wagon, the mill goal, the save file with time away, and a long run of random buttons.
// `node tools/windrowtest.cjs shots/` also writes screenshots as PNGs.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
for (const f of ['entities', 'rules', 'windrow']) eval(fs.readFileSync(__dirname + '/../studio/' + f + '.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const shotDir = process.argv[2];
const D = (window.BK_DEMOS || []).find(d => d.name === 'Windrow');
if (!D) { fail('windrow.js did not register itself in BK_DEMOS'); process.exit(1); }
window.BKRules.check(D).filter(r => !r.ok).forEach(r => fail(`Windrow breaks the rule "${r.name}"`));
const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
D.buildGfx(cart);
function png(rgba, w, h) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let errors = [], logs = [];
require('../studio/runtime.js')({ onLog: (m, e) => { (e ? errors : logs).push(m); } }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init(); M._bkw_default_palette();
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags());
  const sv = M._bkw_save() >> 2;
  const ents = s(window.BKEntities.toLua(cart.entities, null, 0, 'GAME_BOOT = 3\n'));
  const shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, M._bkw_render(), 320 * 240 * 4).slice(), 320, 240));
  };
  const getSave = () => M.HEAP32[sv] < 0 ? null : Buffer.from(M.HEAPU8.subarray((sv + 2) << 2, ((sv + 2) << 2) + M.HEAP32[sv])).toString();
  const setSave = str => {
    if (str == null) { M.HEAP32[sv] = -1; return; }
    const b = Buffer.from(str); M.HEAPU8.set(b, (sv + 2) << 2); M.HEAP32[sv] = b.length; M.HEAP32[sv + 1] = 0;
  };
  const load = save => { setSave(save); logs = []; if (M._bkw_load_ex(ents, s(D.code)) !== 0) fail('Windrow did not load: ' + errors.join(' ')); };
  const run = (n, mask = 0) => { for (let i = 0; i < n; i++) if (M._bkw_frame(mask, 0)) { fail('the game stopped: ' + errors.join(' ')); errors = []; return false; } return true; };
  const tap = (name, wait = 20) => { run(1, 1 << B[name]); run(wait); };
  const ev = code => { if (M._bkw_eval(s(code)) !== 0) fail('eval failed: ' + code + ' ' + errors.join(' ')); };
  const get = expr => { logs = []; ev(`print("=", ${expr})`); const l = logs.find(x => x.startsWith('=')) || ''; return l.split(/\s+/).slice(1).join(' '); };
  const num = expr => Number(get(expr));
  const check = (what, got, want) => { if (String(got) !== String(want)) fail(`${what}: got ${got}, expected ${want}`); };

  // 1. a humble start: no coins, a stick, a bucket, four radish seeds, and a plot full of weeds
  load(null);
  run(10);
  check('coins at the start', num('G.coins'), 0);
  check('seeds at the start', get('G.seeds[1], G.hoe, G.can, G.water'), '4 1 1 5');
  if (num('(function() local n = 0 for i, f in ipairs(FIELD[1]) do if f.k ~= 0 then n = n + 1 end end return n end)()') < 25) fail('the home plot should start overgrown');
  shot('windrow-start');

  // 2. hand work: stand above cell (3, 8), face down. Three digs with the stick, plant, water.
  ev('px, py, dx, dy = 3 * 16 + 8, 7 * 16 + 14, 0, 1');
  tap('a'); tap('a');
  check('two digs with the stick are not enough', num('FIELD[1][1].k'), 0);
  tap('a');
  check('the third dig turns the soil', num('FIELD[1][1].k'), 4);
  tap('a');
  check('A on dug soil plants the picked seed', get('FIELD[1][1].c, G.seeds[1]'), '1 3');
  tap('b');
  check('B waters and uses the bucket', get('FIELD[1][1].wet, G.water'), 'true 4');
  // an unwatered neighbour does not grow
  ev('FIELD[1][2].k, FIELD[1][2].c, FIELD[1][2].age, FIELD[1][2].wet = 4, 1, 0, false');
  ev('G.rain = false new_day() FIELD[1][1].wet = true new_day()');
  check('the watered radish is ripe after two nights', get('ripe(FIELD[1][1])'), 'true');
  if (get('G.rain') === 'false' && num('FIELD[1][2].age') > 1) fail('a dry crop grew without rain');
  ev('G.clk = 100');
  tap('a');
  check('A picks the ripe radish', get('G.inv.radish, FIELD[1][1].c'), '1 0');
  shot('windrow-plot');
  // sell at the crate: stand under it, face up
  ev('px, py, dx, dy = 12 * 16 + 8, 4 * 16 + 14, 0, -1');
  const pay = num('price("radish")');
  tap('a');
  check('the crate pays for the radish', get('G.coins, G.inv.radish'), pay + ' nil');
  if (M.HEAP32[sv + 1] !== 1) fail('selling should save the farm');

  // 3. weeds, stones and stumps: weeds come out by hand, the rest needs tools from the wagon
  ev('FIELD[1][11].k, FIELD[1][11].hits = 1, 0 px, py, dx, dy = 3 * 16 + 8, 8 * 16 + 14, 0, 1');
  tap('a'); tap('a');
  check('two pulls clear a weed and give fibre', get('FIELD[1][11].k, G.inv.fibre'), '0 1');
  ev('FIELD[1][11].k, FIELD[1][11].hits = 2, 0');
  tap('a'); tap('a'); tap('a'); tap('a');
  check('a stone stays without a pickaxe', num('FIELD[1][11].k'), 2);
  ev('G.pick = 1 toast_t = 0');
  tap('a'); tap('a'); tap('a');
  check('the pickaxe breaks it', get('FIELD[1][11].k, G.inv.stone'), '0 2');

  // 4. foraging in Bramble Woods: walk off the west end of the road, pick something up
  ev('px, py = 12, 5 * 16 + 12');
  run(40, 1 << B.left); run(40);
  check('the road west leads to the woods', num('G.area'), 2);
  if (num('#FORAGE') < 8) fail('the woods should have things to find');
  ev('local o for i, f in ipairs(FORAGE) do if f.a == 2 then o = f break end end FK = o.k px, py, dx, dy = o.x * 16 + 8, o.y * 16 + 14, 0, 1 BEFORE = have(o.k)');
  tap('a');
  check('A picks up what you stand on', num('have(FK) - BEFORE'), 1);
  shot('windrow-woods');
  ev('px, py = AREAS[2].w * 16 - 12, 10 * 16 + 12');
  run(40, 1 << B.right); run(40);
  check('and the path east leads home', num('G.area'), 1);

  // 5. Marrow's wagon: seeds of the season and tools
  ev('G.coins = 200 px, py, dx, dy = 17 * 16 + 8, 5 * 16 + 14, 0, -1');
  tap('a');
  check('A at the wagon opens the shop', get('ui'), 'shop');
  shot('windrow-wagon');
  tap('a');
  check('buying a radish seed', get('G.seeds[1], G.coins'), '4 194');
  ev('local L = shop_items() for i, it in ipairs(L) do if it.name == "Hoe" then ui_sel = i end end');
  tap('a');
  check('buying the hoe', get('G.hoe, G.coins'), '2 114');
  tap('b');
  check('B leaves the shop', get('ui'), 'nil');
  ev('FIELD[1][21].k, FIELD[1][21].hits = 0, 0 px, py, dx, dy = 3 * 16 + 8, 9 * 16 + 14, 0, 1');
  tap('a');
  check('the hoe digs in one go', num('FIELD[1][21].k'), 4);
  if (errors.length) { errors.forEach(e => fail('play: ' + e)); errors = []; }

  // 6. the save file: everything comes back, and time away lets the farm carry on (three days at most).
  // Watered crops grow on the first night; after that only rain helps.
  ev('FIELD[1][1].c, FIELD[1][1].age, FIELD[1][1].wet = 2, 0, true persist()');
  const day = num('G.day'), saved = getSave();
  if (!saved || saved.length > 8000) fail('the save should exist and stay small: ' + (saved && saved.length));
  load(saved);
  run(5);
  check('a reload right away keeps the day', num('G.day'), day);
  check('and the tools and the field', get('G.hoe, G.pick, FIELD[1][1].c, FIELD[1][1].wet, FIELD[1][21].k, ui'), '2 1 2 true 4 nil');
  const now = Math.floor(Date.now() / 1000);
  load(saved.replace(/\["ts"\]=\d+/, `["ts"]=${now - 5 * 3600}`));
  run(5);
  check('five hours away: three days pass', get('G.day, ui, report.days'), `${day + 3} report 3`);
  if (num('FIELD[1][1].age') < 1) fail('the watered barley should have grown while away');
  shot('windrow-away');
  tap('a');
  check('A closes the report', get('ui'), 'nil');

  // 7. the goal: three steps of the mill, then the game is won and carries on
  ev('G.coins = 9999 G.inv = { wood = 99, stone = 99, fibre = 99, barley = 16 } G.bag = 3 px, py, dx, dy = 26 * 16 + 8, 4 * 16 + 14, 0, -1');
  tap('a'); check('A at the ruin opens the mill', get('ui'), 'mill');
  shot('windrow-mill');
  tap('a'); check('step 1: the frame', get('G.mill, G.inv.wood'), '1 83');
  tap('a'); check('step 2 wants crops first', get('ui, G.mill'), 'mill 1');
  tap('a'); check('crops in the bag go to the builders', get('G.millc, G.inv.barley'), '16 0');
  ev('G.millc = 40'); tap('a'); check('step 2: the sails', num('G.mill'), 2);
  check('with the sails up, grain sells for double', num('price("corn")') >= 124, true);
  tap('a'); ev('G.millc = 120'); tap('a');
  check('step 3: the millstone', num('G.mill'), 3);
  run(30);
  check('the goal is reached', get('GAME.state'), 'won');
  if (errors.length) { errors.forEach(e => fail('mill: ' + e)); errors = []; }

  // 8. all four seasons draw, with rain, snow and nightfall
  load(null);
  for (const [d, name] of [[3, 'spring'], [10, 'summer'], [17, 'autumn'], [24, 'winter']]) {
    ev(`G.day, G.rain, G.clk = ${d}, ${d > 15}, DAY_FRAMES * ${d === 10 ? 0.85 : 0.3} G.plots = { true, true, true } px, py = 15 * 16, 7 * 16 ` +
       'for p = 1, 3 do for i, f in ipairs(FIELD[p]) do if i % 3 > 0 then f.k, f.c, f.age, f.wet = 4, i % #CROPS + 1, i % 8, i % 2 == 0 end end end');
    run(3);
    shot('windrow-' + name);
  }
  if (errors.length) { errors.forEach(e => fail('seasons: ' + e)); errors = []; }

  // 9. a long run of random buttons over several short days, in the fields and in the woods
  load(null);
  ev('DAY_FRAMES = 2400 G.coins = 300 G.seeds = { 20, 20, 20, 20, 20, 20, 20, 20, 20 }');
  let seed = 12345, mask = 0;
  const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let f = 0; f < 16000; f++) {
    if (f % 12 === 0) mask = (1 << rand(4)) | (rand(3) === 0 ? 1 << (4 + rand(6)) : 0);
    if (f === 8000) ev('G.area, px, py = 2, 20 * 16, 10 * 16 + 12');
    if (M._bkw_frame(mask, 0)) { fail('random play stopped at frame ' + f + ': ' + errors.join(' ')); break; }
  }
  if (num('G.day') < 5) fail('days should pass on their own: day ' + get('G.day'));
  if (errors.length) errors.forEach(e => fail('random play: ' + e));
  console.log(process.exitCode ? 'Windrow: FAILED' : 'Windrow: ok');
});
