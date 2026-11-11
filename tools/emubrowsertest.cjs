// Browser test: the emulator apps in the studio. Adds a ROM with the ROMs button's file picker, finds the three
// apps on the Bit's Utilities row, plays the Game Boy test card and a dropped-in NES ROM with the keyboard,
// saves and loads a state (kept in IndexedDB), and leaves with Start+Select and comes back (the game carries on).
// Usage: node tools/emubrowsertest.cjs [screenshot dir]   (needs Playwright; serves studio/ itself)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', 'studio');
const shots = process.argv[2] || null;
let failed = 0;
const fail = m => { console.error('FAIL', m); failed++; };
const ok = m => console.log('ok  ', m);

(async () => {
  const romDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-roms-'));
  execFileSync('python3', [path.join(__dirname, 'make_test_roms.py'), romDir]);
  const nesFile = path.join(romDir, 'Block Party.nes');
  fs.copyFileSync(path.join(romDir, 'bitkit-test.nes'), nesFile);
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : 'text/javascript' });
    fs.createReadStream(f).pipe(r);
  }).listen(0);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('bitkit.inputPick.bit1', '[{"k":"kb"}]'); } catch (e) {}
    try { localStorage.setItem('bitkit.mode', 'play'); } catch (e) {}
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(`http://localhost:${srv.address().port}/index.html`);
  await pg.waitForFunction(() => window.bkStudio && bkStudio.bit.playing === 'home');
  const wait = (fn, arg, ms = 8000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const key = async (k, ms = 90) => { await pg.keyboard.down(k); await pg.waitForTimeout(ms); await pg.keyboard.up(k); await pg.waitForTimeout(60); };
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await pg.locator('#screen').screenshot({ path: path.join(shots, name + '.png') }); } };
  const kind = () => pg.evaluate(() => bkStudio.RT._bkw_emu_kind());
  const blockX = c => pg.evaluate(c => {
    const R = bkStudio.RT, p = R._bkw_screen(); let sx = 0, n = 0;
    for (let i = 0; i < 320 * 240; i++) if (R.HEAPU8[p + i] === c) { sx += i % 320; n++; }
    return n ? sx / n : -1;
  }, c);

  // the apps are on the home screen's Utilities row
  const names = await pg.evaluate(() => bkStudio.bit.games.filter(g => g.app).map(g => g.name));
  for (const n of ['Game Boy', 'Game Boy Color', 'NES']) if (!names.includes(n)) fail(`no ${n} app on the Bit (${names})`);
  await pg.locator('#screen').focus();
  await key('ArrowDown'); await pg.waitForTimeout(400);
  await shot('emu-home-utilities');

  // add a ROM with the ROMs button
  await pg.click('#btnRoms');
  await pg.locator('input[type=file][accept*=".nes"]').setInputFiles(nesFile);
  if (!await wait(() => document.querySelector('#modal .lib-list') && /Block Party/.test(document.querySelector('#modal .lib-list').textContent))) fail('the added ROM is not in the ROMs list');
  else ok('ROMs: a .nes file added with the file picker');
  if (shots) await pg.locator('#modal .m-box').screenshot({ path: path.join(shots, 'emu-roms-dialog.png') });
  await pg.keyboard.press('Escape');

  // Game Boy app: the test card
  const launch = name => pg.evaluate(name => bkStudio.bitRequest(1, bkStudio.bit.games.findIndex(g => g.name === name) + 1, true), name);
  await launch('Game Boy');
  await wait(() => /^app:/.test(bkStudio.bit.playing));
  await pg.locator('#screen').focus();
  await pg.waitForTimeout(300);
  await shot('emu-gb-list');
  await key('KeyZ');
  if (!await wait(() => bkStudio.RT._bkw_emu_kind() === 1)) fail('the Game Boy test card did not start');
  await pg.waitForTimeout(500);
  const x0 = await blockX(195);
  await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(500); await pg.keyboard.up('ArrowRight');
  const x1 = await blockX(195);
  if (!(x1 > x0 + 10)) fail(`Game Boy: the block did not move with the arrow keys (${x0} -> ${x1})`); else ok(`Game Boy: test card plays in the browser (${Math.round(x0)} -> ${Math.round(x1)})`);
  await shot('emu-gb-play');

  // save a state in slot 1 (Q = L opens the menu), move, load it back
  await key('KeyQ'); await pg.waitForTimeout(150);
  await shot('emu-gb-menu');
  await key('ArrowDown'); await key('KeyZ');
  if (!await wait(() => bkStudio.RT && window.BKRoms.all.some(r => r.test && r.kind === 'gb' && r.states[1]))) fail('save state not kept');
  const xs = await blockX(195);
  await pg.keyboard.down('ArrowLeft'); await pg.waitForTimeout(400); await pg.keyboard.up('ArrowLeft');
  await key('KeyQ'); await key('ArrowDown'); await key('ArrowDown'); await key('KeyZ');
  await pg.waitForTimeout(300);
  const xl = await blockX(195);
  if (Math.abs(xl - xs) > 3) fail(`load state: block at ${xl}, saved at ${xs}`); else ok('Game Boy: save state and load state through IndexedDB');

  // leave with Start+Select, come back: carries on (whole runtime kept, emulator included)
  const xb = await blockX(195);
  await pg.keyboard.down('Shift'); await pg.keyboard.down('Enter'); await pg.waitForTimeout(250); await pg.keyboard.up('Enter'); await pg.keyboard.up('Shift');
  if (!await wait(() => bkStudio.bit.playing === 'home')) fail('Start+Select did not go home');
  await pg.waitForTimeout(300);
  await pg.evaluate(name => bkStudio.bitRequest(1, bkStudio.bit.games.findIndex(g => g.name === name) + 1, false), 'Game Boy');
  await wait(() => /^app:/.test(bkStudio.bit.playing));
  await pg.waitForTimeout(400);
  const xr = await blockX(195);
  if (await kind() !== 1 || Math.abs(xr - xb) > 3) fail(`Game Boy did not carry on after going home (kind ${await kind()}, block ${xb} -> ${xr})`);
  else ok('Game Boy: going home pauses the game, picking the app again carries on');

  // NES app: the added ROM
  await pg.evaluate(() => bkStudio.bootHome());
  await wait(() => bkStudio.bit.playing === 'home');
  await launch('NES');
  await wait(() => /^app:/.test(bkStudio.bit.playing));
  await pg.locator('#screen').focus();
  await pg.waitForTimeout(300);
  await shot('emu-nes-list');
  await key('KeyZ');   // Block Party is first (the test card comes last)
  await wait(() => bkStudio.RT._bkw_emu_kind() === 3);
  if (!(await pg.evaluate(() => bkStudio.RT.UTF8ToString(bkStudio.RT._bkw_emu_error()) === '' && window.BKRoms.list('nes')[0].name === 'Block Party'))) fail('your own games should come before the test card');
  if (!await wait(() => bkStudio.RT._bkw_emu_kind() === 3)) fail('the NES ROM did not start');
  await pg.waitForTimeout(600);
  const n0 = await blockX(192 + 0x30);
  await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(500); await pg.keyboard.up('ArrowRight');
  const n1 = await blockX(192 + 0x30);
  if (!(n1 > n0 + 10)) fail(`NES: the block did not move (${n0} -> ${n1})`); else ok('NES: a dropped-in ROM plays');
  await shot('emu-nes-play');

  if (errs.length) errs.forEach(e => fail('page: ' + e));
  await b.close(); srv.close();
  if (failed) { console.error(`${failed} failed`); process.exit(1); }
  ok('emulator apps in the browser');
})().catch(e => { console.error(e); process.exit(1); });
