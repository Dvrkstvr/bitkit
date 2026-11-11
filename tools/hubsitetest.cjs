// Browser test: the Share website (studio/hub.html) with a stand-in hub index: games, utility apps, photos and
// clips, the filters and search, a post's page (#post=N) with its QR code, downloading a .bitkit, the play link
// into the studio, an empty hub, and phone width.
// Usage: node tools/hubsitetest.cjs [screenshot dir]   (needs Playwright; serves studio/ itself)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'studio');
const shots = process.argv[2] || null;
let failed = 0;
const fail = m => { console.error('FAIL', m); failed++; };
const ok = m => console.log('ok  ', m);
const B64 = (n, v) => Buffer.alloc(n, v).toString('base64');
const CART = JSON.stringify({ format: 'bitkit-cart', version: 1, name: 'Test Hop', code: 'function _draw() cls(3) end', palette: B64(768, 7),
  tiles: B64(4, 0), flags: B64(2, 0), map: B64(4, 0), levels: [{ name: 'Level 1', w: 256, h: 128, map: B64(4, 0), placed: [] }], entities: { types: [], placed: [] } });
const ITEMS = [
  { id: 7, kind: 'game', title: 'Test Hop', author: 'tester', text: 'A shared game', cart: 'items/7/game.bitkit', media: ['items/7/1.png'], url: 'https://github.com/x/y/issues/7', date: '2026-11-10T10:00:00Z' },
  { id: 8, kind: 'clip', title: 'Big jump', author: 'moss', media: ['items/8/1.gif'], date: '2026-11-09T10:00:00Z' },
  { id: 9, kind: 'app', title: 'Egg timer', author: 'fern', text: 'Counts down', cart: 'items/9/game.bitkit', media: [], date: '2026-11-11T10:00:00Z' },
  { id: 10, kind: 'photo', title: 'Sunset', author: 'tester', media: ['items/10/1.png'], date: '2026-11-08T10:00:00Z' },
];

(async () => {
  const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png', json: 'application/json' };
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[f.split('.').pop()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  }).listen(0);
  const base = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch();
  const errs = [];
  async function newPage(items, viewport) {
    const ctx = await b.newContext({ viewport: viewport || { width: 1280, height: 900 }, acceptDownloads: true });
    await ctx.route('https://raw.githubusercontent.com/**', route => {
      const u = route.request().url();
      if (u.includes('/index.json')) return items ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items }) }) : route.fulfill({ status: 404, body: '' });
      if (u.endsWith('/game.bitkit')) return route.fulfill({ contentType: 'text/plain', body: CART });
      if (/\.(png|gif)$/.test(u)) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'docs/media/puffball.png')) });
      route.fulfill({ status: 404, body: '' });
    });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('bitkit.inputPick.bit1', '[{"k":"kb"}]'); localStorage.setItem('bitkit.mode', 'edit'); } catch (e) {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    return pg;
  }
  try {
    let pg = await newPage(ITEMS);
    await pg.goto(base + 'hub.html');
    await pg.waitForSelector('.card');
    const titles = await pg.$$eval('.card h3', a => a.map(x => x.textContent));
    if (titles.join() === 'Egg timer,Test Hop,Big jump,Sunset') ok('all four posts, newest first'); else fail('cards ' + titles);
    const counts = await pg.$$eval('#filters button', a => a.map(x => x.textContent));
    if (counts.join('|') === 'Everything4|🎮 Games1|🧰 Utility apps1|📷 Photos1|🎞 Clips1') ok('filters with counts: ' + counts.join(', ')); else fail('filters ' + counts.join('|'));
    if (shots) await pg.screenshot({ path: path.join(shots, 'hubsite.png') });
    await pg.click('#filters [data-f="app"]');
    let t = await pg.$$eval('.card h3', a => a.map(x => x.textContent));
    if (t.join() === 'Egg timer' && await pg.$eval('.card .tag', e => e.textContent) === '🧰 Utility app') ok('utility apps on their own'); else fail('apps filter ' + t);
    await pg.click('#filters [data-f="all"]');
    await pg.fill('#search', 'moss');
    t = await pg.$$eval('.card h3', a => a.map(x => x.textContent));
    if (t.join() === 'Big jump') ok('search finds a maker'); else fail('search ' + t);
    await pg.fill('#search', 'zzz');
    if (await pg.$('#clearF')) ok('nothing matches: a way back'); else fail('no empty search note');
    await pg.click('#clearF');
    // a post's page, the QR code, the download
    await pg.click('.card:nth-child(1) [data-open]');
    await pg.waitForSelector('dialog[open] #qr canvas');
    if (await pg.evaluate(() => location.hash) === '#post=9' && (await pg.$eval('#postLink', e => e.value)).endsWith('#hub=9')) ok('a post opens with a QR code and its play link, at #post=9'); else fail('post dialog');
    if (shots) await pg.screenshot({ path: path.join(shots, 'hubsite-post.png') });
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('dialog [data-dl]')]);
    const file = await dl.path();
    if (dl.suggestedFilename() === 'egg-timer.bitkit' && fs.readFileSync(file, 'utf8') === CART) ok('download gives egg-timer.bitkit, the cart as posted'); else fail('download ' + dl.suggestedFilename());
    await pg.click('#dlgClose');
    await pg.waitForFunction(() => location.hash === '', null, { timeout: 2000 }).catch(() => {});
    if (await pg.evaluate(() => location.hash) === '') ok('closing the post clears the address'); else fail('hash stays');
    const href = await pg.$eval('.card:nth-child(2) a.primary', a => a.getAttribute('href'));
    if (href === './#hub=7') ok('Play opens the studio with #hub=7'); else fail('play href ' + href);
    // a photo has no game: no Play, no download
    if (!await pg.$('.card:nth-child(4) a.primary') && !await pg.$('.card:nth-child(4) [data-dl]')) ok('photos have no Play or download'); else fail('photo actions');
    // a shared link straight to a post
    pg = await newPage(ITEMS);
    await pg.goto(base + 'hub.html#post=8');
    await pg.waitForSelector('dialog[open]');
    if (await pg.$eval('#dlgTitle', e => e.textContent) === 'Big jump') ok('hub.html#post=8 opens that post'); else fail('post link');
    // Play really plays it in the studio
    pg = await newPage(ITEMS);
    await pg.goto(base + 'hub.html');
    await pg.waitForSelector('.card');
    await Promise.all([pg.waitForURL(/index\.html|\/$|#hub/), pg.click('.card:nth-child(2) a.primary')]);
    await pg.waitForFunction(() => window.bkStudio && bkStudio.mode() === 'play' && bkStudio.cart.name === 'Test Hop', null, { timeout: 20000 })
      .then(() => ok('the studio opened "Test Hop" from the website'), () => fail('studio did not open the post'));
    // an empty hub and phone width
    pg = await newPage(null, { width: 375, height: 760 });
    await pg.goto(base + 'hub.html');
    await pg.waitForSelector('.empty');
    if (/Nothing here yet/.test(await pg.$eval('.empty', e => e.textContent))) ok('an empty hub asks you to be the first'); else fail('empty');
    pg = await newPage(ITEMS, { width: 375, height: 760 });
    await pg.goto(base + 'hub.html');
    await pg.waitForSelector('.card');
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over <= 0) ok('phone width: no sideways scrolling'); else fail('phone width overflows by ' + over + 'px');
    if (shots) await pg.screenshot({ path: path.join(shots, 'hubsite-phone.png'), fullPage: false });
    if (errs.length) fail('page errors: ' + errs.join(' | ')); else ok('no page errors');
  } catch (e) { fail(e.stack || e.message); }
  await b.close(); srv.close();
  if (failed) { console.error(failed + ' failed'); process.exit(1); }
  console.log('share website OK');
})();
