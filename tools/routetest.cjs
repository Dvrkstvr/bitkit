// Runs the demo with a fake pad and screenshots the map tab with the route overlay.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1400, height: 820 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => {
    window.__pad = { id: 'Fake Pad', mapping: 'standard', connected: true, index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.__pad];
  });
  await pg.goto(process.argv[3]);
  await pg.waitForFunction(() => window.bkStudio);
  await pg.click('.tabs button[data-tab=map]');
  await pg.click('#btnRun');
  await pg.evaluate(() => { __pad.buttons[15] = { pressed: true, value: 1 }; __pad.buttons[7] = { pressed: true, value: 0.6 };
    setInterval(() => { const on = (performance.now() % 900) < 350; __pad.buttons[0] = { pressed: on, value: on ? 1 : 0 }; }, 30); });
  await pg.waitForTimeout(4000);
  await pg.screenshot({ path: process.argv[2] + '/route.png' });
  console.log('errors', [...new Set(errs)]);
  await b.close();
})();
