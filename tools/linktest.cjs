// Browser test: linked Bits (studio windows playing together in lockstep, like PocketBits over ESP-NOW).
// Runs the edge cases: linking on the home screen, starting a game for everyone, leaving together with
// Start+Select and carrying on, a game shell restart, switching games, a Bit reloading mid-game, a Bit falling
// out of step, a third Bit joining, a Bit left behind while another plays, and Bit windows closing.
// Usage: node tools/linktest.cjs [screenshot dir]   (needs Playwright; serves studio/ itself)
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
  // every Bit uses the keyboard (no "which controller" panel), and the studio window starts with the Bit on
  await ctx.addInitScript(() => {
    const n = (location.search.match(/bit=(\d+)/) || [])[1] || '1';
    try { sessionStorage.setItem('bitkit.inputPick.bit' + n, '[{"k":"kb"}]'); } catch (e) {}
  });
  const errs = [];
  const pages = {};
  async function open(n) {
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(`Bit ${n}: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errs.push(`Bit ${n} console: ${m.text()}`); });
    await pg.goto(n === 1 ? url : `${url}?bit=${n}`);
    await pg.waitForFunction(() => window.bkStudio && bkStudio.bit.playing === 'home');
    pages[n] = pg;
    return pg;
  }
  const st = pg => pg.evaluate(() => {
    const s = bkStudio.link.s;
    return { playing: bkStudio.bit.playing, running: bkStudio.isRunning(), peers: bkStudio.link.peers.size,
      s: s && { sid: s.sid, f: s.f, slot: s.slot, np: s.np, ready: s.ready, name: s.name, roster: s.roster.length } };
  });
  const wait = (pg, fn, arg, ms = 8000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const inGame = (pg, sid) => wait(pg, sid => { const s = bkStudio.link.s; return s && s.ready && (!sid || s.sid === sid) && s.f > 30; }, sid);
  const atHome = pg => wait(pg, () => !bkStudio.link.s && bkStudio.bit.playing === 'home' && bkStudio.isRunning());
  const gameIndex = (pg, name) => pg.evaluate(name => bkStudio.bit.games.findIndex(g => g.name === name) + 1, name);
  async function launch(pg, name, fresh) {
    const i = await gameIndex(pg, name);
    if (!i) throw new Error('no game ' + name);
    await pg.evaluate(([i, fresh]) => bkStudio.bitRequest(1, i, fresh), [i, !!fresh]);
  }
  async function combo(pg) {   // hold Start+Select (Enter + Shift) for a moment
    await pg.bringToFront();
    await pg.keyboard.down('Shift'); await pg.keyboard.down('Enter');
    await pg.waitForTimeout(250);
    await pg.keyboard.up('Enter'); await pg.keyboard.up('Shift');
  }
  const snap = async (pg, name) => { if (shots) await pg.locator('#gameWrap').screenshot({ path: path.join(shots, name + '.png') }); };

  // ---- 1. two Bits link by themselves and the home screen lists both
  const A = await open(1), B = await open(2);
  if (await wait(A, () => bkStudio.link.peers.size === 1) && await wait(B, () => bkStudio.link.peers.size === 1)) ok('two Bits linked');
  else fail('Bits did not link');
  await A.waitForTimeout(300);
  const homeA = await A.evaluate(() => { const m = bkStudio.RT.HEAPU16, b = bkStudio.ptrMap(); return [m[b], m[b + 1], m[b + 2], m[b + 3]]; });
  if (homeA.join() === '2,1,1,2') ok('home screen sees 2 Bits, this is Bit 1'); else fail('home roster ' + homeA);
  await snap(A, 'home-linked');

  // ---- 2. a game started on Bit 1 starts on Bit 2 too, in lockstep
  const games = await A.evaluate(() => bkStudio.bit.games.map(g => g.name));
  const sprout = games.find(n => /sprout/i.test(n)) || games[1], kart = games.find(n => /kart/i.test(n)), beacon = games.find(n => /beacon/i.test(n));
  console.log('     games:', games.join(', '));
  await launch(A, sprout, true);
  if (await inGame(A) && await inGame(B)) ok(`${sprout} runs on both Bits`); else fail('linked game did not start on both');
  let sa = await st(A), sb = await st(B);
  if (sa.s && sb.s && sa.s.sid === sb.s.sid && sa.s.slot === 1 && sb.s.slot === 2 && sa.s.np === 2) ok('same session, players 1 and 2');
  else fail('session ' + JSON.stringify([sa.s, sb.s]));
  if (sa.s && sb.s && Math.abs(sa.s.f - sb.s.f) <= 6) ok(`lockstep frames ${sa.s.f} / ${sb.s.f}`); else fail('frames apart ' + JSON.stringify([sa.s, sb.s]));
  await snap(B, 'bit2-in-game');

  // ---- 3. Start+Select on Bit 2 takes both home, paused
  await A.waitForTimeout(400);
  await combo(B);
  if (await atHome(A) && await atHome(B)) ok('Start+Select on Bit 2 took both Bits home'); else fail('not both home after Start+Select');
  await A.waitForTimeout(1200);   // the paused copies are written, the home screens refresh their badges
  const ids = await A.evaluate(async () => [...(await BKSnap.list()).keys()].filter(k => k.startsWith('link2:')));
  if (ids.length === 2) ok('each Bit kept its paused copy: ' + ids.join(', ')); else fail('linked pause copies ' + ids);

  // ---- 4. picking it again (from Bit 2 this time) carries on together
  await launch(B, sprout);
  if (await inGame(A) && await inGame(B)) ok('carried on together'); else fail('resume did not start on both');
  const logA = await A.evaluate(() => document.getElementById('console').textContent);
  if (/carrying on with/.test(logA)) ok('Bit 1 restored its paused game'); else fail('Bit 1 started fresh instead of carrying on');
  sa = await st(A); sb = await st(B);
  if (sa.s.slot === 1 && sb.s.slot === 2) ok('same seats as before'); else fail('seats changed ' + JSON.stringify([sa.s, sb.s]));

  // ---- 5. game shell restart (cmd 5) from the game: the host restarts it for both
  const sid0 = sa.s.sid;
  await A.evaluate(() => bkStudio.bitRequest(5, 2));
  await B.evaluate(() => bkStudio.bitRequest(5, 2));
  if (await wait(A, sid => bkStudio.link.s && bkStudio.link.s.sid !== sid && bkStudio.link.s.f > 30, sid0) &&
      await wait(B, sid => bkStudio.link.s && bkStudio.link.s.sid !== sid && bkStudio.link.s.f > 30, sid0)) ok('restart restarted the game on both');
  else fail('restart did not restart both');

  // ---- 6. switching games: Run in the studio (Bit 1) while linked switches both
  sa = await st(A);
  await A.evaluate(() => bkStudio.run());
  if (await wait(B, sid => bkStudio.link.s && bkStudio.link.s.sid !== sid && bkStudio.link.s.f > 30, sa.s.sid)) ok('Run in the studio switched both Bits to the studio cart');
  else fail('Run did not switch Bit 2');
  // and home() from the game code (sys 2) takes both home
  await A.evaluate(() => bkStudio.bitRequest(2, 0)); await B.evaluate(() => bkStudio.bitRequest(2, 0));
  if (await atHome(A) && await atHome(B)) ok('home() took both home'); else fail('home() did not take both home');

  // ---- 7. Bit 2 reloads mid-game: Bit 1 waits, Bit 2 takes its seat back and catches up
  if (kart) {
    await launch(A, kart, true);
    if (await inGame(A) && await inGame(B)) ok(`${kart} runs on both`); else fail('kart did not start on both');
    await A.waitForTimeout(800);
    await B.reload();
    await B.waitForFunction(() => window.bkStudio);
    const back = await wait(B, () => bkStudio.link.s && bkStudio.link.s.ready && !bkStudio.link.s.catching && bkStudio.link.s.f > 60, null, 12000);
    if (back) ok('reloaded Bit 2 took its seat back'); else fail('reloaded Bit 2 did not get back in');
    const f0 = (await st(A)).s.f;
    await A.waitForTimeout(800);
    sa = await st(A); sb = await st(B);
    if (sa.s && sa.s.f > f0 + 20 && sb.s && sb.s.slot === 2 && Math.abs(sa.s.f - sb.s.f) <= 6) ok(`game moves on again (${sa.s.f} / ${sb.s.f})`);
    else fail('game did not move on after the reload ' + JSON.stringify([f0, sa.s, sb.s]));
    await snap(B, 'bit2-rejoined');

    // ---- 8. Bit 2 falls out of step (drops the session without a word): it is put back
    await B.evaluate(() => { const L = bkStudio.link; L.s = null; L.running = false; bkStudio.bootHome(); });
    if (await wait(B, () => bkStudio.link.s && bkStudio.link.s.ready && !bkStudio.link.s.catching, null, 12000)) ok('Bit 2 out of step was put back in the game');
    else fail('Bit 2 out of step was not put back');
    await combo(A);
    if (await atHome(A) && await atHome(B)) ok('both home again'); else fail('kart: not both home');
  }

  // ---- 8b. both Bits start a game at the same moment: they agree on one
  await Promise.all([launch(A, sprout, true), launch(B, beacon || sprout, true)]);
  await A.waitForTimeout(1500);
  sa = await st(A); sb = await st(B);
  if (sa.s && sb.s && sa.s.sid === sb.s.sid && sa.s.f > 30) ok('two starts at once: both Bits agree on one game'); else fail('simultaneous starts split ' + JSON.stringify([sa.s, sb.s]));
  await combo(A);
  if (await atHome(A) && await atHome(B)) ok('home again'); else fail('not home after simultaneous starts');

  // ---- 9. a third Bit: joins the home screens; a Bit in a game is left alone
  const C = await open(3);
  if (await wait(A, () => bkStudio.link.peers.size === 2) && await wait(C, () => bkStudio.link.peers.size === 2)) ok('third Bit linked');
  else fail('third Bit did not link');
  await C.waitForTimeout(400);
  await launch(C, beacon || sprout, true);
  if (await inGame(A) && await inGame(B) && await inGame(C)) ok('a game started on Bit 3 runs on all 3');
  else fail('3-Bit game did not start on all');
  sa = await st(A);
  if (sa.s && sa.s.np === 3) ok('3 players'); else fail('np ' + JSON.stringify(sa.s));
  await combo(C);
  if (await atHome(A) && await atHome(B) && await atHome(C)) ok('all 3 home'); else fail('3 Bits not all home');

  // ---- 9b. five Bits race Kart Lab (more than the 4 a shared screen allows)
  if (kart) {
    const D = await open(4), E = await open(5);
    await wait(A, () => bkStudio.link.peers.size === 4);
    await E.waitForTimeout(400);
    await launch(E, kart, true);
    let all = true;
    for (const pg of [A, B, C, D, E]) all = await inGame(pg) && all;
    sa = await st(A);
    if (all && sa.s.np === 5) ok('5 Bits play Kart Lab together'); else fail('5-Bit Kart Lab ' + JSON.stringify(sa.s));
    await snap(E, 'bit5-kart');
    await combo(E);
    if (await atHome(A) && await atHome(E)) ok('5 Bits home'); else fail('5 Bits not home');
    await D.close(); await E.close();
    await wait(A, () => bkStudio.link.peers.size === 2);
  }

  // ---- 10. a Bit closes mid-game: the host waits for it and can leave with Start+Select
  await launch(A, sprout, true);
  if (!(await inGame(A) && await inGame(C))) fail('3-Bit sprout did not start');
  await B.close();
  if (await wait(A, () => /Waiting for Bit 2/.test(document.getElementById('linkStatus').textContent), null, 8000)) ok('Bit 1 waits for the closed Bit 2');
  else fail('no waiting message for the closed Bit');
  await snap(A, 'waiting');
  // a new Bit window takes the empty seat
  const B2 = await open(2);
  if (await wait(B2, () => bkStudio.link.s && bkStudio.link.s.ready && !bkStudio.link.s.catching && bkStudio.link.s.slot === 2, null, 12000)) ok('a new Bit 2 window took the empty seat');
  else fail('new Bit 2 did not take the seat');
  await combo(A);
  if (await atHome(A) && await atHome(B2) && await atHome(C)) ok('all home after the new Bit took over'); else fail('not all home');

  // ---- 11. a Bit that leaves while the others wait for it: Start+Select on the host leaves the game
  await launch(A, sprout, true);
  await inGame(A);
  await C.close(); await B2.close();
  await A.waitForTimeout(1500);
  await combo(A);
  if (await atHome(A)) ok('Bit 1 left the stuck game with Start+Select'); else fail('Bit 1 stuck in a game with no other Bits');
  if (await wait(A, () => bkStudio.link.peers.size === 0, null, 6000)) ok('Bit 1 is on its own again'); else fail('closed Bits still listed');   // (a closed window that sends no goodbye drops out after 4 s)
  // alone again: games are single player and pausing works as before
  await launch(A, sprout, true);
  if (await wait(A, () => !bkStudio.link.s && bkStudio.isRunning() && bkStudio.bit.playing !== 'home')) ok('alone: plays on its own'); else fail('alone: game did not start');
  await snap(A, 'alone');

  if (errs.length) fail('page errors:\n  ' + errs.join('\n  '));
  console.log(failed ? `linktest: ${failed} failed` : 'linktest: ok');
  await b.close(); srv.close();
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
