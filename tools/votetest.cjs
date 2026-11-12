// Browser test: the home screen's vote on linked Bits (studio windows, like PocketBits over ESP-NOW).
// With two or more Bits on their home screens, A on a game votes for it and B passes; a game starts on every
// Bit once at least 75% of the Bits that don't pass voted for it. Runs: three Bits split 2 to 1 (nothing starts),
// the odd Bit leaves and the two votes win; then a vote changed, a Bit joining mid-vote, and a pass deciding it
// (the passing Bit still plays). Uses real keys: Z is A, X is B, the arrows choose.
// Usage: node tools/votetest.cjs [screenshot dir]   (needs Playwright; serves studio/ itself)
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript(() => {
    const n = (location.search.match(/bit=(\d+)/) || [])[1] || '1';
    try { sessionStorage.setItem('bitkit.inputPick.bit' + n, '[{"k":"kb"}]'); } catch (e) {}
    try { localStorage.setItem('bitkit.mode', 'play'); } catch (e) {}
  });
  const errs = [];
  async function open(n) {
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(`Bit ${n}: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errs.push(`Bit ${n} console: ${m.text()}`); });
    await pg.goto(n === 1 ? url : `${url}?bit=${n}`);
    await pg.waitForFunction(() => window.bkStudio && bkStudio.bit.playing === 'home' && bkStudio.isRunning());
    return pg;
  }
  const wait = (pg, fn, arg, ms = 8000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const inGame = (pg, np) => wait(pg, np => { const s = bkStudio.link.s; return s && s.ready && s.f > 30 && (!np || s.np === np); }, np);
  const atHome = pg => wait(pg, () => !bkStudio.link.s && bkStudio.bit.playing === 'home' && bkStudio.isRunning());
  const home = pg => pg.evaluate(() => bkStudio.bit.playing === 'home' && !bkStudio.link.s);
  const gameIndex = (pg, name) => pg.evaluate(name => bkStudio.bit.games.findIndex(g => g.name === name) + 1, name);
  async function press(pg, key) {
    await pg.bringToFront();
    await pg.focus('#screen').catch(() => {});
    await pg.keyboard.down(key); await pg.waitForTimeout(90); await pg.keyboard.up(key); await pg.waitForTimeout(90);
  }
  async function pick(pg, name) {   // Right until the home screen has that game picked
    const i = await gameIndex(pg, name);
    for (let k = 0; k < 40 && await pg.evaluate(() => bkStudio.bit.sel) !== i; k++) await press(pg, 'ArrowRight');
    return await pg.evaluate(() => bkStudio.bit.sel) === i;
  }
  async function vote(pg, name) {
    if (!await pick(pg, name)) { fail(`could not pick ${name}`); return; }
    const i = await gameIndex(pg, name);
    for (let k = 0; k < 4; k++) {
      await press(pg, 'KeyZ');
      if (await pg.evaluate(i => { const g = bkStudio.bit.games[i - 1]; return bkStudio.link.vote === g.vkey; }, i)) return;
    }
    fail(`A on ${name} did not vote`);
  }
  // the home screen's rows: every Bit's vote as the cart sees it (a game number, 999 passes)
  const votes = pg => pg.evaluate(() => {
    const m = bkStudio.RT.HEAPU16, b = bkStudio.ptrMap(), W = 256, n = m[b];
    return Array.from({ length: n }, (_, i) => m[b + 2 * W + 2 + i]);
  });
  const snap = async (pg, name) => { if (shots) await pg.locator('#gameWrap').screenshot({ path: path.join(shots, name + '.png') }); };
  const stayHome = async (pgs, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const pg of pgs) if (!await home(pg)) return false;
      await pgs[0].waitForTimeout(150);
    }
    return true;
  };

  // ---- 1. three Bits: 2 votes to 1 is not 75%, so nothing starts
  const A = await open(1), B = await open(2), C = await open(3);
  if (await wait(A, () => bkStudio.link.peers.size === 2) && await wait(C, () => bkStudio.link.peers.size === 2)) ok('three Bits linked');
  else fail('Bits did not link');
  await A.waitForTimeout(600);
  const cross = 'Crossgate', kart = (await A.evaluate(() => bkStudio.bit.games.map(g => g.name))).find(n => /kart/i.test(n));
  const ci = await gameIndex(A, cross), ki = await gameIndex(A, kart);
  if (!ci || !ki) fail(`missing games: ${cross} ${kart}`);
  await vote(A, cross);
  if (await home(A)) ok('A on a game votes instead of starting it'); else fail('A started the game while Bits are linked');
  await vote(B, cross);
  await vote(C, kart);
  if (await wait(A, ([ci, ki]) => { const m = bkStudio.RT.HEAPU16, b = bkStudio.ptrMap(); return m[b + 512 + 2] === ci && m[b + 512 + 3] === ci && m[b + 512 + 4] === ki; }, [ci, ki]))
    ok('every Bit\'s vote shows on the home screen: ' + (await votes(A)).join(','));
  else fail('home rows show votes ' + (await votes(A)).join(','));
  await snap(A, 'vote-2-of-3');
  if (await stayHome([A, B, C], 2500)) ok('2 of 3 votes (67%): nothing starts'); else fail('a game started with 2 of 3 votes');

  // ---- 2. the Bit that voted for something else leaves: 2 of 2 wins, the game starts on both
  await C.close();
  if (await inGame(A, 2) && await inGame(B, 2)) ok(`C left mid-vote: ${cross} won 2 of 2 and runs on both Bits`);
  else fail('the game did not start after the odd Bit left');
  const nm = await A.evaluate(() => bkStudio.link.s && bkStudio.link.s.start && bkStudio.link.s.start.cart.name);
  if (nm === cross) ok('it is the game they voted for'); else fail('started ' + nm);
  const vAfter = await A.evaluate(() => [bkStudio.link.vote, bkStudio.link.pass]);
  if (!vAfter[0] && !vAfter[1]) ok('votes are cleared once the game starts'); else fail('vote kept in the game: ' + vAfter);
  await A.keyboard.down('Shift'); await A.keyboard.down('Enter'); await A.waitForTimeout(250); await A.keyboard.up('Enter'); await A.keyboard.up('Shift');
  if (await atHome(A) && await atHome(B)) ok('both home again'); else fail('Start+Select did not take both home');

  // ---- 3. a vote changed, a Bit joining mid-vote, and a pass that decides it
  await A.waitForTimeout(800);
  await vote(A, kart);
  await vote(B, cross);
  if (await stayHome([A, B], 2000)) ok('1 vote each: nothing starts'); else fail('a game started with split votes');
  const C2 = await open(3);
  await wait(A, () => bkStudio.link.peers.size === 2);
  await vote(C2, kart);
  await vote(A, cross);   // A changes its mind: A and B for Crossgate, C for Kart Lab
  if (await stayHome([A, B, C2], 2000)) ok('a Bit joined mid-vote and changed votes count: 2 of 3, nothing starts');
  else fail('a game started with 2 of 3 votes after a Bit joined');
  await C2.bringToFront();
  await press(C2, 'KeyX');   // C passes: A and B are all the Bits that count, both for Crossgate
  if (await C2.evaluate(() => bkStudio.link.pass)) ok('B on the home screen passes'); else fail('B did not pass');
  await snap(A, 'vote-pass');
  if (await inGame(A, 3) && await inGame(B, 3) && await inGame(C2, 3)) ok('C passed: 2 of 2 votes win, and all three Bits play (the passing Bit too)');
  else fail('the game did not start for all three after the pass');
  const seats = await A.evaluate(() => bkStudio.link.s && bkStudio.link.s.nums);
  console.log('     seats:', seats && seats.join(','));

  // ---- 4. one vote wins when every other Bit passes
  await A.keyboard.down('Shift'); await A.keyboard.down('Enter'); await A.waitForTimeout(250); await A.keyboard.up('Enter'); await A.keyboard.up('Shift');
  if (!(await atHome(A) && await atHome(B) && await atHome(C2))) fail('not home after the second game');
  await A.waitForTimeout(800);
  await press(B, 'KeyX'); await press(C2, 'KeyX');
  if (await stayHome([A, B, C2], 1500)) ok('everyone else passing and no vote yet: nothing starts'); else fail('a game started with no votes');
  await vote(A, kart);
  if (await inGame(A, 3) && await inGame(B) && await inGame(C2)) ok(`${kart} won with one vote while the others passed`);
  else fail('one vote did not win when the others passed');

  if (errs.length) { for (const e of errs.slice(0, 10)) fail(e); }
  await b.close(); srv.close();
  if (failed) { console.error(`${failed} vote check(s) failed`); process.exit(1); }
  console.log('vote test passed');
})().catch(e => { console.error(e); process.exit(1); });
