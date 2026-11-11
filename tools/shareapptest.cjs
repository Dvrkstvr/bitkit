// Browser test: the Share app on the Bit (studio/shareapp.js) between two linked Bit windows. Both open Share,
// Bit 1 sends the game being made to Bit 2, which says yes and gets it on its memory card; then a photo; then
// Bit 2 says no to one; then Bit 1 stops one half way. The PocketBit side is platform/sim's --share test.
// Usage: node tools/shareapptest.cjs [screenshot dir]   (needs Playwright; serves studio/ itself)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'studio');
const shots = process.argv[2] || null;
let failed = 0;
const fail = m => { console.error('FAIL', m); failed++; };
const ok = m => console.log('ok  ', m);

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : 'text/javascript' });
    fs.createReadStream(f).pipe(r);
  }).listen(0);
  const url = `http://localhost:${srv.address().port}/index.html`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 860 } });
  await ctx.addInitScript(() => {
    const n = (location.search.match(/bit=(\d+)/) || [])[1] || '1';
    try { sessionStorage.setItem('bitkit.inputPick.bit' + n, '[{"k":"kb"}]'); localStorage.setItem('bitkit.mode', 'play'); } catch (e) {}
  });
  const errs = [];
  async function open(n) {
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(`Bit ${n}: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errs.push(`Bit ${n} console: ${m.text()}`); });
    await pg.goto(n === 1 ? url : `${url}?bit=${n}`);
    await pg.waitForFunction(() => window.bkStudio && bkStudio.bit.playing === 'home', null, { timeout: 15000 });
    return pg;
  }
  const wait = (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const req = (pg, op, a, bb) => pg.evaluate(([op, a, bb]) => bkStudio.bitRequest(6, (op << 24) | (a << 12) | bb), [op, a || 0, bb || 0]);
  const lua = (pg, expr) => pg.evaluate(e => { const R = bkStudio.RT, p = R.stringToNewUTF8(`print("@@" .. tostring(${e}))`); R._bkw_eval(p); R._free(p); }, expr);
  const snap = async (pg, name) => { if (shots) await pg.locator('#gameWrap').screenshot({ path: path.join(shots, name + '.png') }); };
  async function openShare(pg) {
    const i = await pg.evaluate(() => bkStudio.bit.games.findIndex(g => g.name === 'Share') + 1);
    if (!i) throw new Error('no Share app on the home screen');
    await pg.evaluate(i => bkStudio.bitRequest(1, i, true), i);
    return wait(pg, () => bkStudio.bit.playing === 'app:Share' && bkStudio.shr.open);
  }

  const A = await open(1), B = await open(2);
  if (!(await wait(A, () => bkStudio.link.peers.size === 1))) fail('Bits did not link');
  const cardBefore = await B.evaluate(async () => (await bkStudio.BKStore.list()).length);
  if (await openShare(A) && await openShare(B)) ok('both Bits opened Share from the Utilities row'); else fail('Share did not open');
  if (await wait(A, () => bkStudio.shr.bits.length === 1 && bkStudio.shr.bits[0].ready)) ok('Bit 1 sees Bit 2, ready'); else fail('Bit 1 does not see Bit 2 as ready: ' + JSON.stringify(await A.evaluate(() => bkStudio.shr.bits)));
  await A.waitForTimeout(300);
  await snap(A, 'share-app');

  // 1. a game: offer, yes, arrives
  const item = await A.evaluate(() => bkStudio.shr.items[0]);
  await req(A, 1, 1, 1);
  if (await wait(B, () => !!bkStudio.shr.offer)) ok(`Bit 2 got the offer: ${await B.evaluate(() => JSON.stringify(bkStudio.shr.offer && { from: bkStudio.shr.offer.from, kind: bkStudio.shr.offer.kind, name: bkStudio.shr.offer.name }))}`); else fail('no offer on Bit 2');
  await B.waitForTimeout(200);
  await snap(B, 'share-offer');
  await req(B, 2, 1);
  if (await wait(B, () => bkStudio.shr.xfer && bkStudio.shr.xfer.state === 'ok') && await wait(A, () => bkStudio.shr.xfer && bkStudio.shr.xfer.state === 'ok')) ok(`"${item.name}" sent and received`); else fail('game transfer did not finish: ' + JSON.stringify(await B.evaluate(() => bkStudio.shr.xfer)));
  await snap(B, 'share-got-it');
  const cardAfter = await B.evaluate(async () => (await bkStudio.BKStore.list()).length);
  if (cardAfter === cardBefore + 1) ok('the game is on Bit 2\'s memory card'); else fail(`memory card ${cardBefore} -> ${cardAfter}`);
  // the app sees the state (SHARE table in Lua)
  const logs = [];
  B.on('console', m => logs.push(m.text()));
  await req(A, 3); await req(B, 3);
  await wait(B, () => !bkStudio.shr.xfer);

  // 2. a photo
  await A.evaluate(() => bkStudio.takePhoto());
  await wait(A, async () => (await bkStudio.BKStore.captures.list()).length > 0);
  console.log('     captures on Bit 1:', await A.evaluate(async () => (await bkStudio.BKStore.captures.list()).map(c => c.name).join(', ')), await A.evaluate(() => bkStudio.shr.items.map(i => i.kind).join(',')));
  await req(A, 0);                                   // the app asks again: the list is read again when Share opens
  await A.evaluate(() => { bkStudio.shr.open = false; });
  await req(A, 0);
  await wait(A, () => bkStudio.shr.items.some(i => i.kind === 'photo'));
  const pi = await A.evaluate(() => bkStudio.shr.items.findIndex(i => i.kind === 'photo') + 1);
  const capsB = await B.evaluate(async () => (await bkStudio.BKStore.captures.list()).length);
  if (!pi) fail('no photo in the list'); else {
    await req(A, 1, pi, 1);
    await wait(B, () => !!bkStudio.shr.offer); await req(B, 2, 1);
    if (await wait(A, () => bkStudio.shr.xfer && bkStudio.shr.xfer.state === 'ok') && await wait(B, async () => (await bkStudio.BKStore.captures.list()).length > 0)) {
      const after = await B.evaluate(async () => (await bkStudio.BKStore.captures.list()).length);
      if (after === capsB + 1) ok('a photo went across and is with Bit 2\'s photos'); else fail(`captures ${capsB} -> ${after}`);
    } else fail('photo transfer did not finish');
    await req(A, 3); await req(B, 3);
  }

  // 3. Bit 2 says no
  await req(A, 1, 1, 1);
  await wait(B, () => !!bkStudio.shr.offer); await req(B, 2, 0);
  if (await wait(A, () => bkStudio.shr.xfer && bkStudio.shr.xfer.state === 'no')) ok('"no thanks" reaches Bit 1'); else fail('no answer on Bit 1');
  await req(A, 3);

  // 4. the Lua app draws the state
  const tableOk = await A.evaluate(() => { const R = bkStudio.RT, p = R.stringToNewUTF8('assert(SHARE and #SHARE.bits == 1 and #SHARE.items >= 2)'); const r = R._bkw_eval(p); R._free(p); return r === 0; });
  if (tableOk) ok('the app has the SHARE table: Bits and items'); else fail('SHARE table missing in the app');

  // 5. leaving Share tells the other Bit
  await A.evaluate(() => bkStudio.bitRequest(2, 0));
  if (await wait(B, () => bkStudio.shr.bits.length === 1 && !bkStudio.shr.bits[0].ready)) ok('Bit 2 sees that Bit 1 left Share'); else fail('Bit 2 still sees Bit 1 in Share');

  errs.forEach(e => fail(e));
  await b.close(); srv.close();
  console.log(failed ? `${failed} failed` : 'share app OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
