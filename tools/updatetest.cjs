// Browser test: a built-in game kept from an older studio. The studio remembers the game you had open (in this
// browser), so after a built-in game gets better (e.g. its own title screen) the old copy would keep playing.
// Untouched, the old copy is swapped for the new version on start; edited, it is kept and the Games menu says
// a newer one is out (Reset gets it).
// Usage: node tools/updatetest.cjs   (needs Playwright; serves studio/ itself)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'studio');
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
  for (const changed of ['0', '1']) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await p.waitForFunction(() => window.bkStudio, null, { timeout: 30000 });
    // an old copy of Sprout Hop: from before it had its own title screen
    await p.evaluate(ch => {
      const o = window.bkStudio.serialize(); o.code = o.code.replace(/title_draw = draw_title,/, '');
      localStorage.setItem('bitkit.cart', JSON.stringify(o)); localStorage.setItem('bitkit.cart.gid', 'demo:Sprout Hop');
      localStorage.setItem('bitkit.cart.changed', ch); localStorage.removeItem('bitkit.cart.base');
    }, changed);
    await p.reload(); await p.waitForFunction(() => window.bkStudio, null, { timeout: 30000 }); await p.waitForTimeout(1000);
    const fresh = await p.evaluate(() => /title_draw = draw_title,/.test(window.bkStudio.cart.code));
    await p.evaluate(() => window.bkStudio.showGames()); await p.waitForTimeout(500);
    const tag = await p.evaluate(() => [...document.querySelectorAll('.lib-tag')].some(e => /updated since/.test(e.textContent)));
    if (changed === '0') {
      if (fresh) ok('an untouched old copy of Sprout Hop becomes the new version'); else fail('the untouched old copy was kept');
      if (tag) fail('the new version should not say it is out of date');
    } else {
      if (!fresh) ok('an edited old copy is kept'); else fail('an edited copy was thrown away');
      if (tag) ok('the Games menu says a newer Sprout Hop is out'); else fail('no "updated since" note in the Games menu');
    }
    errs.forEach(e => fail('page error: ' + e));
    await ctx.close();
  }
  await b.close(); srv.close();
  if (failed) process.exit(1);
  console.log('built-in game updates ok');
})();
