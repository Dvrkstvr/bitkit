// Browser test: the Share hub. Photos and clips from the test screen and from the Bit (Select + L / R), the
// memory card's captures/, play links for every built-in game (size, QR fit), opening a play link in a fresh
// browser, and the hub tab with a stand-in hub index.
// Usage: node tools/sharetest.cjs [screenshot dir]   (needs Playwright; serves studio/ itself)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'studio');
const shots = process.argv[2] || null;
let failed = 0;
const fail = m => { console.error('FAIL', m); failed++; };
const ok = m => console.log('ok  ', m);

(async () => {
  const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png', gif: 'image/gif', json: 'application/json' };
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[f.split('.').pop()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  }).listen(0);
  const url = `http://localhost:${srv.address().port}/index.html`;
  const b = await chromium.launch();
  const errs = [];
  async function newPage(mode) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(m => {
      try { sessionStorage.setItem('bitkit.inputPick.bit1', '[{"k":"kb"}]'); localStorage.setItem('bitkit.mode', m); } catch (e) {}
    }, mode);
    // a stand-in for the hub branch on GitHub
    await ctx.route('https://raw.githubusercontent.com/**', async route => {
      const u = route.request().url();
      if (u.includes('/index.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [
        { id: 7, kind: 'game', title: 'Test Hop', author: 'tester', text: 'A shared game', cart: 'items/7/game.bitkit', media: ['items/7/1.png'], url: 'https://github.com/x/y/issues/7' },
        { id: 8, kind: 'clip', title: 'Big jump', author: 'tester', media: ['items/8/1.gif'] }] }) });
      if (u.endsWith('/game.bitkit')) return route.fulfill({ contentType: 'text/plain', body: global.hubCart });
      if (u.endsWith('.png') || u.endsWith('.gif')) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'docs/media/puffball.png')) });
      route.fulfill({ status: 404, body: '' });
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });
    return pg;
  }

  // ---- test screen: photo and clip
  const pg = await newPage('edit');
  await pg.goto(url);
  await pg.waitForFunction(() => window.bkStudio && window.BKShare);
  await pg.evaluate(() => bkStudio.run());
  await pg.waitForTimeout(500);
  await pg.keyboard.press('F8');
  await pg.waitForTimeout(300);
  await pg.click('#btnClip');
  await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(1500); await pg.keyboard.up('ArrowRight');
  await pg.keyboard.press('F9');
  await pg.waitForTimeout(500);
  let caps = await pg.evaluate(async () => (await BKStore.captures.list()).map(c => ({ name: c.name, size: c.size, type: c.blob.type })));
  const png = caps.find(c => /\.png$/.test(c.name)), gif = caps.find(c => /\.gif$/.test(c.name));
  if (png && png.size > 1000) ok(`photo kept: ${png.name} (${png.size} bytes)`); else fail('no photo: ' + JSON.stringify(caps));
  if (gif && gif.size > 5000) ok(`clip kept: ${gif.name} (${(gif.size / 1024).toFixed(0)} KB)`); else fail('no clip: ' + JSON.stringify(caps));
  const dims = await pg.evaluate(async () => {
    const c = (await BKStore.captures.list()).find(x => /\.gif$/.test(x.name));
    const im = new Image(); im.src = URL.createObjectURL(c.blob); await im.decode(); return [im.naturalWidth, im.naturalHeight];
  });
  if (dims[0] === 320 && dims[1] === 240) ok('the browser decodes the clip (320x240)'); else fail('clip size ' + dims);

  // ---- the Bit: Select + L takes a photo, Select + R records
  await pg.evaluate(() => bkStudio.setMode('play', { start: false }));
  await pg.waitForFunction(() => bkStudio.bit.playing === 'home');
  await pg.evaluate(() => bkStudio.bitRequest(1, 2));   // start the 2nd game on the shelf
  await pg.waitForFunction(() => bkStudio.bit.playing && bkStudio.bit.playing !== 'home', null, { timeout: 5000 });
  await pg.waitForTimeout(400);
  await pg.focus('#screen');
  const before = (await pg.evaluate(async () => (await BKStore.captures.list()).length));
  // Select is Shift, L is Q, R is W on the keyboard
  await pg.keyboard.down('ShiftLeft'); await pg.waitForTimeout(100);
  await pg.keyboard.down('KeyQ'); await pg.waitForTimeout(100); await pg.keyboard.up('KeyQ'); await pg.waitForTimeout(100);
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(100); await pg.keyboard.up('KeyW');
  await pg.keyboard.up('ShiftLeft');
  await pg.waitForTimeout(1200);
  const rec = await pg.evaluate(() => bkStudio.cap.rec);
  if (rec) ok('Select + R started a clip on the Bit'); else fail('Select + R did not start a clip');
  await pg.evaluate(() => bkStudio.toggleClip());
  await pg.waitForTimeout(400);
  caps = await pg.evaluate(async () => (await BKStore.captures.list()).map(c => c.name));
  if (caps.length >= before + 2) ok('Bit photo and clip kept: ' + caps.slice(0, 2).join(', ')); else fail(`Bit captures: ${before} -> ${caps.length}`);

  // ---- play links for every built-in game
  const sizes = await pg.evaluate(async () => {
    const out = [];
    for (const d of (window.BK_DEMOS || [])) {
      await bkStudio.openGame({ demo: d });
      const o = JSON.parse(JSON.stringify(window.bkStudio.serialize()));
      const link = await BKShare.linkFor(o);
      const back = await BKShare.cartFromLink(link);
      const same = JSON.stringify(Object.assign({}, o, { entities_lua: undefined })) === JSON.stringify(Object.assign({}, back, { entities_lua: undefined }));
      out.push({ name: d.name, file: JSON.stringify(o).length, link: link.length, same, qr: !!BKShare.qrEncode(Array.from(new TextEncoder().encode(link))) });
    }
    return out;
  });
  sizes.forEach(s => (s.same ? ok : fail)(`${s.name}: file ${(s.file / 1024).toFixed(0)} KB -> link ${(s.link / 1024).toFixed(1)} KB${s.qr ? ', fits a QR code' : ''}${s.same ? '' : ' (DOES NOT ROUND-TRIP)'}`));

  // a small game fits a QR code
  const small = await pg.evaluate(async () => {
    await bkStudio.openGame({ blank: true });
    const link = await BKShare.linkFor(bkStudio.serialize());
    return { len: link.length, qr: !!BKShare.qrEncode(Array.from(new TextEncoder().encode(link))), link };
  });
  if (small.qr) ok(`a new game's link is ${small.len} characters and fits a QR code`); else fail('a new game does not fit a QR code: ' + small.len);

  // ---- the Share tab
  await pg.evaluate(() => bkStudio.setMode('edit'));
  await pg.evaluate(() => bkStudio.openGame({ demo: window.BK_DEMOS[0] }));
  await pg.click('#btnHub');
  await pg.click('[data-ht="share"]');
  await pg.waitForFunction(() => /#play=1\./.test((document.getElementById('shareLink') || {}).value || ''));
  ok('Share tab makes a play link');
  if (shots) await pg.screenshot({ path: path.join(shots, 'share-tab.png') });
  await pg.click('[data-ht="caps"]');
  await pg.waitForSelector('#capGrid .hub-card img');
  ok('photos and clips tab lists ' + await pg.locator('#capGrid .hub-card').count() + ' captures');
  if (shots) await pg.screenshot({ path: path.join(shots, 'captures-tab.png') });

  // ---- the hub tab: play a shared game
  global.hubCart = await pg.evaluate(() => JSON.stringify((() => { const o = bkStudio.serialize(); o.name = 'Test Hop'; return o; })()));
  await pg.click('[data-ht="hub"]');
  await pg.waitForSelector('[data-play]');
  if (shots) await pg.screenshot({ path: path.join(shots, 'hub-tab.png') });
  await pg.click('[data-play]');
  await pg.waitForFunction(() => bkStudio.mode() === 'play' && bkStudio.cart.name === 'Test Hop', null, { timeout: 8000 });
  ok('Play on a hub game opens it and plays it');

  // ---- a short hub link (#hub=7), and the Link / QR button
  const pg3 = await newPage('edit');
  await pg3.goto(url + '#hub=7');
  await pg3.waitForFunction(() => window.bkStudio && bkStudio.mode() === 'play' && bkStudio.cart.name === 'Test Hop', null, { timeout: 10000 });
  ok('a #hub= link opens and plays the post\'s game');
  await pg3.evaluate(() => BKShare.open('hub'));
  await pg3.click('[data-qr]');
  await pg3.waitForSelector('.hub-qr canvas');
  ok('Link / QR shows a QR code for the post');
  if (shots) await pg3.screenshot({ path: path.join(shots, 'hub-qr.png') });

  // ---- a play link in a fresh browser
  const pg2 = await newPage('edit');
  await pg2.goto(url + '#play=1.' + small.link.split('#play=1.')[1]);
  await pg2.waitForFunction(() => window.bkStudio && bkStudio.mode() === 'play' && bkStudio.cart.name === 'my game', null, { timeout: 10000 });
  await pg2.waitForFunction(() => bkStudio.bit.playing && bkStudio.bit.playing !== 'home', null, { timeout: 8000 });
  ok('a play link opens and plays its game in a fresh browser');
  if (await pg2.evaluate(() => location.hash)) fail('the link was left in the address bar');

  errs.forEach(e => fail(e));
  await b.close(); srv.close();
  console.log(failed ? `${failed} failed` : 'share hub OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
