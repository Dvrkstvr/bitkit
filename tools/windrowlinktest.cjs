// CI check for Windrow's neighbours: several Bits in one process, each with its own farm, passing network
// events between them like ESP-NOW broadcasts (some of them lost). Visits, watering, gifts, wishes and the fair.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/windrow.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const runtime = require('../studio/runtime.js');
const D = (window.BK_DEMOS || []).find(d => d.name === 'Windrow');
const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
D.buildGfx(cart);
const shotDir = process.argv[2];
function png(rgba, w, h) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const OUT = 16, IN = 64, SLOT = 10, HDR = 4;
let loss = 0, seed = 99;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

async function bit(id) {
  const b = { id, errors: [], logs: [], q: [], sent: 0 };
  const M = b.M = await runtime({ onLog: (m, e) => (e ? b.errors : b.logs).push(m) });
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags());
  b.net = M._bkw_net() >> 2; b.sv = M._bkw_save() >> 2;
  M.HEAP32[b.sv] = -1; M.HEAP32[b.sv + 1] = 0;
  M.HEAP32.fill(0, b.net, b.net + 4); M.HEAP32[b.net] = id;
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities) + '\nGAME_BOOT = 3\n'), s(D.code)) !== 0) fail('Windrow did not load: ' + b.errors);
  b.ev = code => { if (M._bkw_eval(s(code)) !== 0) fail(`Bit ${id} eval failed: ${code}\n${b.errors.join('\n')}`); };
  b.get = expr => { b.logs = []; b.ev(`print("=", ${expr})`); const l = b.logs.filter(x => x.startsWith('=')).pop(); return l ? l.slice(1).trim().split(/\s+/).join(' ') : null; };
  b.num = expr => parseFloat(b.get(expr));
  b.shot = name => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(`${shotDir}/${name}.png`, png(new Uint8Array(M.HEAPU8.buffer, M._bkw_render(), 320 * 240 * 4).slice(), 320, 240));
  };
  return b;
}
// one frame on every Bit, then deliver what each one sent to all the others
function tick(bits, masks) {
  bits.forEach((b, k) => {
    const H = b.M.HEAP32, base = b.net, inb = base + HDR + OUT * SLOT;
    let w = 0;
    while (w < IN && b.q.length) { const [from, ev] = b.q.shift(), o = inb + w * SLOT; H[o] = from; H[o + 1] = ev.length; ev.forEach((v, i) => H[o + 2 + i] = v); w++; }
    H[base + 2] = w; H[base + 3] = 0;
    if (b.M._bkw_frame((masks && masks[k]) || 0, 0) !== 0 && !b.dead) { b.dead = true; fail(`Bit ${b.id} stopped: ${b.errors.join('\n')}`); }
    const n = H[base + 1]; H[base + 1] = 0;
    for (let i = 0; i < n; i++) {
      const o = base + HDR + i * SLOT, ev = Array.from(H.subarray(o + 2, o + 2 + H[o + 1]));
      b.sent++;
      for (const other of bits) if (other !== b && !other.off && rand() >= loss) other.q.push([b.id, ev]);
    }
  });
}
const run = (bits, n, masks) => { for (let i = 0; i < n; i++) tick(bits, masks); };
const tap = (bits, k, name, wait = 20) => { const m = bits.map(() => 0); m[k] = 1 << B[name]; tick(bits, m); run(bits, wait); };
const check = (what, got, want) => { if (String(got) !== String(want)) fail(`${what}: got ${got}, expected ${want}`); };

(async () => {
  const bits = [await bit(1201), await bit(1302), await bit(1403)];
  const [a, b, c] = bits;
  // three different farms
  a.ev('G.coins = 100 G.day = 3');
  b.ev('G.day = 12 G.mill = 2 G.coop = 1 G.trac = 1 G.plots = { true, true, false } add_animal("h") add_animal("h") ' +
       'for i, f in ipairs(FIELD[1]) do f.k, f.c, f.age, f.wet = 4, 4, i % 6, false end FIELD[2][7].k = 3');
  run(bits, 150);
  check('farms in reach hear each other', a.get('#near_ids(), NEAR[1302].day, NEAR[1302].mill'), '2 12 2');
  check('each farm has a wish', b.num('my_wish()') >= 1, true);

  // 1. Bit A walks up the north road to B's farm
  a.ev('px, py, dx, dy = 14 * 16 + 8, 1 * 16 + 14, 0, -1 toast_t = 0');
  tap(bits, 0, 'a'); check('A at the north road lists the neighbours', a.get('ui'), 'near');
  tap(bits, 0, 'a', 2); check('choosing one sets off', a.get('ui'), 'fetch');
  a.shot('windrow-walking');
  run(bits, 200);
  check('A arrives on B\'s farm', a.get('visiting, ui, G.day, G.mill, G.coop, G.trac, #G.an, G.plots[2], G.plots[3]'), '1302 nil 12 2 1 1 2 true false');
  check('and sees B\'s fields as they are', a.get('FIELD[1][5].k, FIELD[1][5].c, FIELD[1][5].age, FIELD[2][7].k'), b.get('FIELD[1][5].k, FIELD[1][5].c, FIELD[1][5].age, FIELD[2][7].k'));
  check('with their own bag and coins', a.get('G.coins, G.seeds[1]'), '100 4');
  check('B is told', b.get('NEAR[1201].at, toast:find("visit") ~= nil'), '1302 true');
  // both see each other walk
  b.ev('px, py = 12 * 16, 7 * 16 + 8'); a.ev('px, py = 10 * 16, 7 * 16 + 8');
  run(bits, 40, [1 << B.right, 0, 0]);
  check('the host sees the guest walking', b.get('GUESTS[1201] ~= nil and math.abs(GUESTS[1201].x - ' + a.num('px') + ') < 12'), 'true');
  check('the guest sees the host', a.get('GUESTS[1302] ~= nil'), 'true');
  check('a third farm sees neither', c.get('next(GUESTS)'), 'nil');
  a.shot('windrow-visit'); b.shot('windrow-host');

  // 2. watering for the neighbour
  a.ev('G.water = 5 px, py, dx, dy = 5 * 16 + 8, 14 * 16 + 4, 0, -1 toast_t = 0'); run(bits, 3);
  tap(bits, 0, 'b', 30);
  check('the guest waters a crop', a.get('FIELD[1][5 * 10 + 3].wet, G.water'), 'true 4');
  check('and it is wet on the host\'s farm', b.get('FIELD[1][5 * 10 + 3].wet'), 'true');
  tap(bits, 0, 'a'); check('a guest cannot dig or pick', a.get('FIELD[1][5 * 10 + 3].c, ui'), '4 nil');
  // the farm stays live: what B does shows up on A within a few seconds
  b.ev('FIELD[1][1].c, FIELD[1][1].age = 7, 2'); run(bits, 320);
  check('the host\'s changes reach the guest', a.get('FIELD[1][1].c, FIELD[1][1].age'), '7 2');
  check('the guest\'s own farm is untouched', a.get('HOME.G.day, HOME.FIELD[1][5].c'), '3 0');

  // 3. gifts: a plain one, then the neighbour's wish (paid back), with packets lost on the way
  loss = 0.3;
  const wish = b.num('my_wish()'), wkey = b.get(`CROPS[${wish}].key`);
  a.ev(`G.inv = { berry = 2, ${wkey} = 2 } px, py, dx, dy = 12 * 16 + 8, 4 * 16 + 14, 0, -1 toast_t = 0`); run(bits, 3);
  tap(bits, 0, 'a'); check('A at their crate opens the gift list', a.get('ui, #gift_items()'), 'gift 2');
  a.ev('for i, k in ipairs(gift_items()) do if k == "berry" then ui_sel = i end end'); tap(bits, 0, 'a', 200);
  check('a gift leaves the bag and reaches the neighbour once', a.get('have("berry"), #outbox') + ' ' + b.get('have("berry")'), '1 0 1');
  a.ev(`for i, k in ipairs(gift_items()) do if k == "${wkey}" then ui_sel = i end end`); tap(bits, 0, 'a', 200);
  const pay = 40 + b.num(`price("${wkey}")`) * 4;
  check('the wished gift is paid back', a.get(`have("${wkey}"), G.coins`) + ' ' + b.get(`have("${wkey}"), my_wish()`), `1 ${100 + pay} 1 0`);
  a.ev(`for i, k in ipairs(gift_items()) do if k == "${wkey}" then ui_sel = i end end`); tap(bits, 0, 'a', 200);
  check('a wish is granted once a day', a.get('G.coins') + ' ' + b.get(`have("${wkey}")`), `${100 + pay} 2`);
  a.shot('windrow-gift');
  loss = 0;
  // a gift to a full bag waits in the crate
  b.ev('G.inv = { radish = BAG[G.bag] }'); a.ev('G.inv = { berry = 1 }'); tap(bits, 0, 'a', 60);
  check('with a full bag the gift waits in the crate', b.get('have("berry"), G.post.berry'), '0 1');
  b.ev('G.inv = {} px, py, dx, dy = 12 * 16 + 8, 4 * 16 + 14, 0, -1 toast_t = 0 ui = nil'); run(bits, 3); tap(bits, 1, 'a');
  check('and is taken out later', b.get('have("berry"), next(G.post)'), '1 nil');

  // 4. home again by the north road, with the coins earned
  tap(bits, 0, 'b');
  a.ev('px, py, dx, dy = 14 * 16 + 8, 1 * 16 + 14, 0, -1 toast_t = 0'); run(bits, 3); tap(bits, 0, 'a', 70);
  check('the north road leads home', a.get('visiting, G.day, G.coins, HOME, FIELD[1][5].c'), `nil 3 ${100 + pay} nil 0`);
  run(bits, 120);
  check('the host no longer shows the guest', b.get('NEAR[1201].at, next(GUESTS)'), '0 nil');
  const sv = a.M.HEAP32[a.sv];
  if (sv < 100 || sv > 8000) fail('the save should be the home farm: ' + sv);

  // 5. the fair: what the three farms reap fills one basket, and all of them win
  bits.forEach(x => x.ev('G.coins = 0 toast_t = 0 for i, f in ipairs(FIELD[1]) do f.k, f.c, f.age, f.wet = 4, 1, 1, false end'));
  a.ev('G.grown = G.grown + 40'); b.ev('G.grown = G.grown + 30'); run(bits, 150);
  check('the basket counts every farm', c.get('fair_total()'), '70 75 3');
  check('not full yet', a.get('G.coins'), '0');
  loss = 0.3;
  c.ev('G.grown = G.grown + 6'); run(bits, 200);
  loss = 0;
  check('a full basket pays every farm in reach', bits.map(x => x.get('G.coins, FIELD[1][9].wet')).join(' '), '150 true 150 true 150 true');
  run(bits, 1000);
  check('and only once', bits.map(x => x.get('G.coins, fair_count()')).join(' '), '150 0 150 0 150 0');
  c.shot('windrow-fair');

  // 6. the neighbour goes out of reach while you visit: you walk home
  a.ev('start_visit(1302)'); run(bits, 200);
  check('visiting again', a.get('visiting'), '1302');
  b.off = true; run([a, c], 500);
  check('a farm that falls silent sends you home', a.get('visiting, G.day'), 'nil 3');
  b.off = false; b.q = [];
  // 7. alone (no network) the north road only says so
  const solo = await bit(0);
  solo.ev('px, py, dx, dy = 14 * 16 + 8, 1 * 16 + 14, 0, -1'); run([solo], 5); tap([solo], 0, 'a');
  check('without a network nobody is in reach', solo.get('ui, toast:find("reach") ~= nil'), 'nil true');
  // 8. random buttons on all three for a while, one of them visiting
  a.ev('start_visit(1403)'); loss = 0.15;
  let masks = [0, 0, 0];
  for (let f = 0; f < 4000 && !process.exitCode; f++) {
    if (f % 12 === 0) masks = bits.map(() => (1 << Math.floor(rand() * 4)) | (rand() < 0.33 ? 1 << (4 + Math.floor(rand() * 6)) : 0));
    tick(bits, masks);
  }
  bits.concat(solo).forEach(x => { if (x.errors.length) fail(`Bit ${x.id}: ${x.errors.join('\n')}`); });
  console.log(process.exitCode ? 'Windrow neighbours: FAILED' : `Windrow neighbours: ok (${bits.map(x => x.sent).join(', ')} events sent)`);
})();
