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
  ev('G.coins = 9999 G.inv = { wood = 99, stone = 99, fibre = 99, barley = 16, millstone = 1 } G.bag = 3 px, py, dx, dy = 26 * 16 + 8, 4 * 16 + 14, 0, -1');
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

  // 7b. animals: mend the hen house by hand, buy a hen, fill the trough, gather the egg, pet her; goats give milk
  load(null); run(5);
  ev('G.coins = 1000 G.inv = { wood = 40, stone = 20, fibre = 10, radish = 3 } px, py, dx, dy = 19 * 16 + 8, 24 * 16 + 14, 0, -1');
  tap('a'); check('A at the ruined hen house offers to mend it', get('ui, ui_kind'), 'build coop');
  tap('a'); check('mending it takes coins, wood and fibre', get('G.coop, G.coins, G.inv.wood, G.inv.fibre'), '1 940 30 4');
  ev('ui = "shop" local L = shop_items() for i, it in ipairs(L) do if it.name == "Hen" then ui_sel = i end end');
  tap('a'); tap('b');
  check('Marrow sells a hen once the house stands', get('#G.an, G.an[1].k, G.coins, #ANIM'), '1 h 820 1');
  ev('px, py, dx, dy = 19 * 16 + 8, 26 * 16 + 14, 0, -1');
  tap('a');
  check('food from the bag goes in the trough', get('G.feed, G.inv.radish'), '2 2');
  ev('new_day() G.clk = 100');
  check('a fed hen lays an egg overnight and eats a helping', get('G.feed, (function() local n = 0 for _, o in ipairs(FORAGE) do if is_egg(o) then n = n + 1 end end return n end)()'), '1 1');
  ev('local o for _, f in ipairs(FORAGE) do if is_egg(f) then o = f end end ANIM[1].x, ANIM[1].y, ANIM[1].wait = 9999, 9999, 9999 px, py, dx, dy = o.x * 16 + 8, o.y * 16 + 14, 0, 1');
  tap('a');
  check('you gather the egg by hand', num('have("egg") + have("bigegg")'), 1);
  ev('ANIM[1].x, ANIM[1].y, ANIM[1].wait = 6 * 16 + 8, 24 * 16 + 12, 9999 px, py, dx, dy = 6 * 16 + 8, 23 * 16 + 12, 0, 1');
  tap('a');
  check('a pat a day wins her heart', get('G.an[1].love, G.an[1].p'), '16 1');
  tap('a');
  check('but only one a day', num('G.an[1].love'), 16);
  ev('toast_t = 0 G.shed = 1 add_animal("g") G.feed = 5 new_day() G.clk = 100 ANIM[1].x = 9999 ANIM[2].x, ANIM[2].y, ANIM[2].wait = 6 * 16 + 8, 24 * 16 + 12, 9999');
  if (shotDir) {
    ev('add_animal("h") SX, SY = px, py ANIM[1].x, ANIM[1].y = 14 * 16, 23 * 16 + 8 ANIM[3].x, ANIM[3].y, ANIM[3].wait = 11 * 16, 25 * 16, 9999 ANIM[2].x, ANIM[2].y = 16 * 16, 24 * 16 + 12 px, py, dx, dy = 18 * 16 + 8, 26 * 16 + 4, 0, -1 G.feed = 8');
    run(2); shot('windrow-pasture');
    ev('table.remove(G.an) table.remove(ANIM) px, py, dx, dy = SX, SY, 0, 1 ANIM[1].x = 9999 ANIM[2].x, ANIM[2].y = 6 * 16 + 8, 24 * 16 + 12 G.feed = 4');
  }
  tap('a');
  check('no pail, no milk', get('G.an[2].m, have("milk")'), '1 0');
  ev('G.pail = 1 toast_t = 0');
  tap('a');
  check('with a pail you milk the goat by hand', get('G.an[2].m, have("milk")'), '0 1');
  ev('G.feed = 0 G.an[1].love = 30 new_day()');
  check('hungry animals lose heart and give nothing', get('G.an[1].love, G.an[2].m'), '22 0');
  ev('persist()');
  load(getSave()); run(3);
  check('the animals are in the save', get('#G.an, G.an[2].k, G.coop, G.shed, G.pail, #ANIM'), '2 g 1 1 1 2');
  if (errors.length) { errors.forEach(e => fail('animals: ' + e)); errors = []; }

  // 7c. the old mine: a pickaxe opens it, rocks break into ore, a ladder leads down, things bite from floor 4,
  // and the mill's stone waits in the chest at the bottom
  load(null); run(5);
  ev('G.area, px, py, dx, dy = 2, 11 * 16 + 8, 2 * 16 + 14, 0, -1');
  tap('a'); check('the boards hold without a pickaxe', get('G.mine, G.area'), '0 2');
  ev('G.pick = 1 toast_t = 0');
  tap('a'); check('the pickaxe pries them off', num('G.mine'), 1);
  tap('a', 70); check('A goes down into the mine', get('G.area, mine_n, mine_hp'), '3 1 3');
  // every floor has a way down, and no rock is walled in
  for (let n = 1; n <= 10; n++) {
    ev(`mine_floor(${n})`);
    const ok = get('(function() local seen, q, n = {}, { { 2, 1 } }, 0 seen[2 + 20] = true ' +
      'while #q > 0 do local c = table.remove(q) for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do local x, y = c[1] + d[1], c[2] + d[2] ' +
      'local ch = tile(3, x, y) if ch ~= "#" and not seen[x + y * 20] then seen[x + y * 20] = true if ch ~= "<" and ch ~= "H" then q[#q + 1] = { x, y } end end end end ' +
      `local want = ${n} < 10 and seen[mine_down.x + mine_down.y * 20] or (${n} == 10 and seen[10 + 7 * 20]) return want and #MOBS or -1 end)()`);
    if (Number(ok) < 0) fail('mine floor ' + n + ' has no way on');
    if (n <= 3 && Number(ok) !== 0) fail('floors 1 to 3 should be quiet');
    if (n >= 5 && Number(ok) < 1) fail('floor ' + n + ' should have something living on it');
  }
  ev('G.deep = 0 mine_floor(1) MINE[2][2] = "C" px, py, dx, dy = 2 * 16 + 8, 1 * 16 + 14, 0, 1');
  tap('a'); tap('a'); check('copper takes three blows', get('MINE[2][2], have("copper")'), 'C 0');
  tap('a'); check('and then it is yours', get('MINE[2][2], have("copper")'), '. 1');
  ev('MINE[2][2] = "R" mine_down = { x = 2, y = 2 }');
  tap('a'); tap('a'); check('the ladder down hides under a rock', get('MINE[2][2]'), '>');
  shot('windrow-mine');
  tap('a', 70); check('A on the ladder goes one floor down', get('mine_n, G.deep'), '2 2');
  ev('mine_floor(6) MOBS = { { x = 2 * 16 + 8, y = 2 * 16 + 12, hp = 2, bat = false, hit = 0 } } px, py, dx, dy = 2 * 16 + 8, 1 * 16 + 14, 0, 1');
  ev('hurt_t = 999'); tap('a'); tap('a');
  check('two blows of the pickaxe see a gloomling off', get('#MOBS, have("dust")'), '0 1');
  ev('MOBS = { { x = px, y = py + 4, hp = 9, bat = true, hit = 0 } } hurt_t = 0');
  run(3); check('a bite costs a heart', num('mine_hp'), 2);
  if (shotDir) {
    ev('SX, SY, SM = px, py, MOBS G.lamp = 1 px, py = 9 * 16 + 8, 7 * 16 + 14 for y = 6, 8 do for x = 8, 11 do MINE[y][x] = "." end end MINE[8][8] = ">" MINE[6][11] = "Q" hurt_t = 0 ' +
       'MOBS = { { x = 12 * 16, y = 9 * 16, hp = 2, bat = false, hit = 0 }, { x = 6 * 16, y = 5 * 16, hp = 2, bat = true, hit = 0 }, { x = 13 * 16, y = 5 * 16 + 8, hp = 2, bat = false, hit = 0 } }');
    ev('floats = {}'); run(1); shot('windrow-dungeon');
    ev('px, py, MOBS, G.lamp = SX, SY, SM, 0');
  }
  ev('G.inv.copper = 10 mine_hp = 1 hurt_t = 0 MOBS[1].x, MOBS[1].y = px, py + 4');
  const dayIn = num('G.day');
  run(80);
  check('out of hearts: you wake at home the next morning with half the ore', get('G.area, G.day, G.inv.copper'), `1 ${dayIn + 1} 5`);
  ev('G.area, mine_hp = 3, 3 mine_floor(10) px, py, dx, dy = 10 * 16 + 8, 6 * 16 + 14, 0, 1 MOBS = {}');
  tap('a'); check('the chest at the bottom holds the millstone', get('have("millstone"), G.gotms, G.deep'), '1 1 10');
  ev('persist()');
  load(getSave()); run(3);
  check('a save made underground wakes at the mine door', get('G.area, G.mine, G.deep, have("millstone")'), '2 1 10 1');
  ev('px, py, dx, dy = 11 * 16 + 8, 2 * 16 + 14, 0, -1');
  tap('a'); check('the winch offers the floors you reached', get('ui, #lift_floors()'), 'lift 3');
  tap('down'); tap('a', 70); check('and takes you there', get('G.area, mine_n'), '3 5');
  if (errors.length) { errors.forEach(e => fail('mine: ' + e)); errors = []; }

  // 7d. the tractor: mend the wreck with ore, climb on, and work three cells at a time with each implement
  load(null); run(5);
  ev('G.coins = 5000 G.inv = { iron = 12, copper = 10, wood = 6 } G.plots = { true, true, true } px, py, dx, dy = 27 * 16 + 8, 15 * 16 + 14, 0, -1');
  tap('a'); check('A at the wreck offers to mend it', get('ui, ui_kind'), 'build trac');
  tap('a'); check('mending takes iron, copper, wood and coins', get('G.trac, G.coins, have("iron")'), '1 4200 0');
  ev('ui = "shop" local L = shop_items() for i, it in ipairs(L) do if it.name == "Plough" then ui_sel = i end end');
  tap('a'); tap('b');
  check('Marrow sells the plough once it runs', get('G.imp[1], G.impsel, G.coins'), '1 1 3800');
  ev('toast_t = 0'); tap('a');
  check('A climbs on', get('riding'), 'true');
  // drive along the middle row of the Long acre, plough down
  ev('for i, f in ipairs(FIELD[3]) do f.k, f.c = (i % 2), 0 end px, py, dx, dy = 5 * 16 + 8, 17 * 16 + 12, 1, 0');
  run(60, (1 << B.right) | (1 << B.a));
  const dug = num('(function() local n = 0 for i, f in ipairs(FIELD[3]) do if f.k == 4 then n = n + 1 end end return n end)()');
  if (dug < 18 || dug % 3 !== 0) fail('the plough should turn three rows as it drives: ' + dug + ' cells');
  check('it only works the three rows it crosses', get('FIELD[3][1].k + FIELD[3][22 * 4 + 1].k < 8'), 'true');
  shot('windrow-tractor');
  ev('G.imp = { 1, 1, 1, 1 } G.impsel = 2 G.sel = 1 G.seeds[1] = 50 G.tank = 90 px, py, dx, dy = 5 * 16 + 8, 17 * 16 + 12, 1, 0');
  run(60, (1 << B.right) | (1 << B.a));
  check('the seed drill sows what the plough turned', num('50 - G.seeds[1]'), dug);
  tap('l'); check('L changes the implement', num('G.impsel'), 3);
  ev('px, py, dx, dy = 5 * 16 + 8, 17 * 16 + 12, 1, 0');
  run(60, (1 << B.right) | (1 << B.a));
  check('the water tank waters them', num('90 - G.tank'), dug);
  ev('for i, f in ipairs(FIELD[3]) do if f.c > 0 then f.age = 9 end end G.bag = 3 G.impsel = 4 px, py, dx, dy = 5 * 16 + 8, 17 * 16 + 12, 1, 0');
  run(60, (1 << B.right) | (1 << B.a));
  check('and the reaper brings them in', num('have("radish")'), dug);
  if (shotDir) {
    ev('for i, f in ipairs(FIELD[3]) do f.k, f.c, f.age, f.wet = 4, (i // 22) % 2 == 0 and 2 or 1, (i % 22 < 9) and 0 or 9, i % 22 < 14 end px, py, dx, dy = 13 * 16 + 4, 17 * 16 + 12, 1, 0 floats = {} G.clk = DAY_FRAMES * 0.4');
    run(2); shot('windrow-reaper');
    ev('G.impsel = 1 px, py, dx, dy = 8 * 16 + 8, 13 * 16 + 12, 0, 1'); run(2); shot('windrow-tractor-down');
    ev('dx, dy = 0, -1 G.impsel = 3'); run(2); shot('windrow-tractor-up');
    ev('G.impsel = 4');
  }
  ev('px, py, dx = 20, 5 * 16 + 12, -1 toast_t = 0'); run(30, 1 << B.left);
  check('the tractor stays on the farm', get('G.area, riding'), '1 true');
  tap('y'); check('Y hops off and leaves it where it stands', get('riding, G.tx == 12 or G.tx > 0'), 'false true');
  ev('persist()'); load(getSave()); run(3);
  check('the tractor and its implements are in the save', get('G.trac, G.imp[4], riding'), '1 1 false');
  if (errors.length) { errors.forEach(e => fail('tractor: ' + e)); errors = []; }

  // 7e. very late: the silo, the clockwork driver, and a route the tractor drives by itself
  load(null); run(5);
  ev('G.coins = 9000 G.inv = { wood = 30, stone = 30, iron = 10 } G.plots = { true, true, true } G.trac, G.imp, G.impsel = 1, { 1, 1, 1, 1 }, 1 ' +
     'G.tx, G.ty = 4 * 16 + 8, 20 * 16 + 12 px, py, dx, dy = 13 * 16 + 8, 21 * 16 + 14, 0, -1');
  tap('a'); check('the silo waits for the mill', get('ui, G.silo_b'), 'nil 0');
  ev('G.mill = #MILL toast_t = 0'); run(20); tap('a'); check('then A at the footings offers to build it', get('ui, ui_kind'), 'build silo');
  tap('a'); check('the silo takes wood, stone, iron and coins', get('G.silo_b, G.coins, have("stone")'), '1 7500 0');
  ev('ui = "shop" local L = shop_items() for i, it in ipairs(L) do if it.name == "Clockwork driver" then ui_sel = i end end');
  tap('a'); tap('b');
  check('Marrow sells the clockwork driver once the silo stands', get('G.auto, G.coins'), '1 5000');
  // teach it: Y at the tractor, drive one row of the Long acre with the plough down, hop off
  ev('for i, f in ipairs(FIELD[3]) do f.k, f.c = (i % 2), 0 end toast_t = 0 px, py, dx, dy = 4 * 16 + 8, 21 * 16 + 14, 0, -1');
  tap('y'); check('Y at the tractor opens the clockwork driver', get('ui'), 'auto');
  tap('a'); check('teaching puts you on the tractor', get('riding, teaching'), 'true true');
  ev('px, py, dx, dy = 5 * 16 + 8, 18 * 16 + 12, 1, 0');
  run(150, (1 << B.right) | (1 << B.a));
  const dug2 = num('(function() local n = 0 for i, f in ipairs(FIELD[3]) do if f.k == 4 then n = n + 1 end end return n end)()');
  tap('y');
  const len = num('route_len()');
  check('hopping off ends the lesson', get('riding, teaching'), 'false false');
  if (len < 15 || len > 22) fail('the route should be the cells driven: ' + len);
  // send it round: it ploughs the same cells by itself
  ev('for i, f in ipairs(FIELD[3]) do f.k, f.c = (i % 2), 0 end toast_t = 0 px, py = 11 * 16, 20 * 16 + 8 route_start()');
  check('the tractor sets off alone', get('auto_i ~= nil, riding'), 'true false');
  run(90); shot('windrow-route');
  run(400);
  check('and ploughs what you ploughed', num('(function() local n = 0 for i, f in ipairs(FIELD[3]) do if f.k == 4 then n = n + 1 end end return n end)()'), dug2);
  check('then stops at the end of the route', get('auto_i, fl(G.tx / 16) > 15'), 'nil true');
  // a reaping round past the silo, taught the same way
  ev('toast_t = 0 G.impsel = 4 px, py, dx, dy = G.tx, G.ty + 20, 0, -1'); run(20);
  tap('y'); tap('a');
  ev('px, py, dx, dy = 5 * 16 + 8, 18 * 16 + 12, 1, 0');
  run(150, (1 << B.right) | (1 << B.a)); tap('y');
  ev('for i, f in ipairs(FIELD[3]) do f.k, f.c, f.age, f.wet = 4, 1, 9, true end G.inv = {} G.daily = 1 toast_t = 0');
  const before = num('G.grown');
  ev('new_day(true)');
  const reaped = num('G.grown') - before;
  if (reaped < 40) fail('a morning round while the Bit is off should reap three rows: ' + reaped);
  check('what it reaps goes to the silo, not your bag', get('silo_count() + hopper_count(), have("radish"), auto_i'), reaped + ' 0 nil');
  if (num('silo_count()') < 20) fail('it should unload as it passes the silo: ' + get('silo_count()'));
  ev('for i, f in ipairs(FIELD[3]) do f.k, f.c, f.age, f.wet = 4, 1, 9, true end new_day(false)');
  check('after a night at home the round starts in the morning', get('auto_i ~= nil'), 'true');
  tap('a', 5); ev('if not riding then mount() end');
  check('climbing on stops the round', get('auto_i, riding'), 'nil true');
  ev('dismount()');
  // the silo sells at today's prices, and feeds the animals when the trough is empty
  ev('G.silo = { radish = 10 } G.an = {} G.coop = 1 add_animal("hen") G.feed = 0 animals_night()');
  check('an empty trough is filled from the silo', get('G.silo.radish, G.an[1].p > 0 or G.feed > 0'), '9 true');
  ev('toast_t = 0 ui = nil px, py, dx, dy = 13 * 16 + 8, 21 * 16 + 14, 0, -1'); run(20);
  const c0 = num('G.coins');
  tap('a'); check('A at the silo shows what it holds', get('ui'), 'silo');
  shot('windrow-silo');
  tap('a'); check('and sells it all', get('ui, silo_count(), G.coins'), 'nil 0 ' + (c0 + 9 * num('price("radish")')));
  ev('G.silo = { pea = 3 } persist()'); load(getSave()); run(3);
  check('the silo, the driver and the route are in the save', get('G.silo_b, G.auto, G.daily, G.silo.pea, route_len() > 10'), '1 1 1 3 true');
  if (errors.length) { errors.forEach(e => fail('route: ' + e)); errors = []; }

  // 7f. the wider valley: shore, fen, hills and desert, and what is found there
  load(null); run(5);
  ev('G.area, px, py, dx, dy = 2, 15 * 16 + 8, 18 * 16 + 14, 0, 1 toast_t = 0'); run(3);
  tap('a'); check('the fallen pine wants an axe', get('G.pine, toast:find("axe") ~= nil'), '0 true');
  ev('G.axe = 1 toast_t = 0'); tap('a'); check('the axe clears it', get('G.pine, have("wood")'), '1 4');
  run(40, 1 << B.down); run(40);
  check('the path south leads to Gull Shore', get('G.area, AREAS[G.area].name, G.seen.Shore'), '4 Gull Shore 1');
  shot('windrow-shore');
  ev('px, py, dx, dy = 3 * 16 + 8, 7 * 16 + 14, 0, -1 toast_t = 0'); run(3); tap('a');
  check('a tin box on the shore', get('G.coins, have("pearl"), G.tins:sub(4, 4)'), '60 1 1');
  ev('px, py = 26 * 16, 8 * 16 + 12 toast_t = 0'); run(40, 1 << B.right);
  check('the desert turns you back without a waterskin', get('G.area, toast:find("waterskin") ~= nil'), '4 true');
  ev('G.skin = 1'); run(40, 1 << B.right); run(40);
  check('with one you cross into the Dry Reach', get('G.area, fl(px / 16) < 3'), '7 true');
  ev('px, py = 17 * 16, 9 * 16 + 12'); run(3); shot('windrow-desert');
  ev('px, py = 20, 8 * 16 + 12'); run(40, 1 << B.left); run(40);
  check('and back to the shore', get('G.area, fl(px / 16)'), '4 27');
  ev('px, py = 13 * 16 + 8, 30'); run(40, 1 << B.up); run(40);
  check('north again into the woods', get('G.area, fl(px / 16), fl(py / 16)'), '2 15 19');
  ev('px, py = 20, 9 * 16 + 12'); run(40, 1 << B.left); run(40);
  check('west of the woods lies Sedge Fen', get('G.area, fl(px / 16), fl(py / 16)'), '5 25 10');
  ev('px, py = 12 * 16, 10 * 16 + 12 G.clk = DAY_FRAMES * 0.8'); run(3); shot('windrow-fen');
  ev('G.clk = 100 px, py = 6 * 16 + 8, 30'); run(40, 1 << B.up); run(40);
  check('and north of the fen the Flint Hills', get('G.area, fl(px / 16), fl(py / 16)'), '6 6 19');
  // surface mining: rocks break with the pickaxe and are back the next morning
  ev('px, py, dx, dy = 8 * 16 + 8, 4 * 16 + 12, 1, 0 toast_t = 0'); run(3);
  check('a rock stands there', get('tile(6, 9, 4)'), 'R');
  tap('a'); check('rocks want a pickaxe', get('toast:find("pickaxe") ~= nil, tile(6, 9, 4)'), 'true R');
  ev('G.pick = 1'); tap('a'); tap('a'); tap('a');
  check('three blows break it', get('tile(6, 9, 4), have("stone") + have("flint")'), ', 1');
  shot('windrow-hills');
  ev('px, py, dx, dy = 19 * 16 + 8, 4 * 16 + 12, 0, 1'); run(3);
  check('copper lies in the hills', get('tile(6, 19, 5)'), 'C');
  for (let i = 0; i < 4; i++) tap('a');
  check('and comes out', get('have("copper")'), '1');
  ev('persist()'); load(getSave()); run(3);
  check('you wake where you were, with the way open', get('G.area, G.pine, G.skin, G.seen.Hills'), '6 1 1 1');
  ev('new_day()');
  check('the rocks are back in the morning', get('tile(6, 9, 4), tile(6, 19, 5)'), 'R C');
  for (const a of [4, 5, 6, 7]) {
    const n = num(`(function() local n = 0 for i, o in ipairs(FORAGE) do if o.a == ${a} then n = n + 1 end end return n end)()`);
    if (n < 4) fail(`things should grow wild in ${get(`AREAS[${a}].name`)}: ${n}`);
  }
  ev('G.inv = {} for i, o in ipairs(FORAGE) do if o.a == 7 then G.area, px, py, WANT = 7, o.x * 16 + 8, o.y * 16 + 12, o.k break end end'); run(3); tap('a');
  check('and can be picked', get('have(WANT)'), '1');
  ev('ui = "bag"'); run(2); shot('windrow-bag-finds'); ev('ui = nil');
  if (errors.length) { errors.forEach(e => fail('valley: ' + e)); errors = []; }

  // 7g. fishing
  load(null); run(5);
  ev('G.area, px, py, dx, dy = 4, 8 * 16 + 8, 14 * 16 + 12, 1, 0 toast_t = 0'); run(3);
  tap('a'); check('no rod, no fishing', get('ui, toast:find("rod") ~= nil'), 'nil true');
  ev('ui = "shop" for i, it in ipairs(shop_items()) do if it.name == "Fishing rod" then ui_sel = i end end G.coins = 200'); tap('a'); tap('b');
  check('Marrow sells a rod', get('G.rod, G.coins'), '1 50');
  ev('toast_t = 0'); tap('a', 2); check('A at the water casts', get('ui, FISHING.phase'), 'fish wait');
  shot('windrow-fishing-wait');
  let waited = 0;
  while (get('FISHING and FISHING.phase') === 'wait' && waited++ < 300) run(1);
  check('after a while something bites', get('FISHING.phase'), 'bite');
  tap('a', 0); check('A strikes', get('FISHING.phase, FISHING.f.a'), 'reel 4');
  // reel while it rests, ease off while it runs
  let frames = 0, shotDone = false;
  while (get('ui') === 'fish' && frames++ < 3000) {
    run(1, get('FISHING.run') === 'true' ? 0 : 1 << B.a);
    if (!shotDone && frames === 40) { shot('windrow-fishing'); shotDone = true; }
  }
  check('played well, the fish is landed', get('ui, G.caught, fish_kinds(), count_bag()'), 'nil 1 1 1');
  // a strong fish and a tight line
  ev('fish_rest = nil start_fishing(9, 14) FISHING.phase, FISHING.f, FISHING.dist, FISHING.ten, FISHING.run, FISHING.runt = "reel", FISH_BY.sunray, 90, 20, true, 9999');
  run(120, 1 << B.a);
  check('reeling against a run snaps the line', get('ui, G.caught, toast:find("Snap") ~= nil'), 'nil 1 true');
  ev('fish_rest = nil start_fishing(9, 14) FISHING.phase, FISHING.f, FISHING.dist, FISHING.ten, FISHING.run, FISHING.runt = "reel", FISH_BY.sunray, 90, 20, true, 9999');
  run(200);
  check('doing nothing lets it get away', get('ui, G.caught, toast:find("slipped") ~= nil'), 'nil 1 true');
  ev('fish_rest = nil start_fishing(9, 14) FISHING.phase, FISHING.t = "bite", 5'); run(20);
  check('a missed bite is gone', get('ui, toast:find("slow") ~= nil'), 'nil true');
  for (const a of [1, 2, 4, 5, 6, 7]) check('every water has its own fish: area ' + a, get(`pick_fish(${a}).a`), a);
  check('fish sell at the crate', num('price("sunray")') > 100, true);
  if (errors.length) { errors.forEach(e => fail('fishing: ' + e)); errors = []; }

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
    if (f === 12000) ev('G.area, mine_hp = 3, 3 mine_floor(7)');
    if (f === 13000) ev('ui = nil G.area, G.rod, G.pick, px, py = 4, 1, 1, 8 * 16 + 8, 13 * 16 + 12');
    if (f === 14000) ev('ui, FISHING = nil, nil G.area, px, py = 6, 8 * 16, 5 * 16 + 12');
    if (f === 15000) ev('ui, FISHING = nil, nil G.area, px, py = 5, 12 * 16, 10 * 16 + 12');
    if (f === 4000) ev('G.trac, G.imp, G.impsel, G.plots = 1, { 1, 1, 1, 1 }, 1, { true, true, true } G.area, px, py = 1, 10 * 16, 17 * 16 mount()');
    if (M._bkw_frame(mask, 0)) { fail('random play stopped at frame ' + f + ': ' + errors.join(' ')); break; }
  }
  if (num('G.day') < 5) fail('days should pass on their own: day ' + get('G.day'));
  if (errors.length) errors.forEach(e => fail('random play: ' + e));
  console.log(process.exitCode ? 'Windrow: FAILED' : 'Windrow: ok');
});
