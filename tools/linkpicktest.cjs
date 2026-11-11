// Browser test: a new linked Bit 2 window asks which controller it uses; the two Bits share their picks.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.addInitScript(() => {
    const mk = (i, id) => ({ id, mapping: 'standard', connected: true, index: i, axes: [0,0,0,0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
    window.__pads = [mk(0, 'Xbox Wireless Controller (STANDARD GAMEPAD)'), mk(1, 'DualSense Wireless Controller (STANDARD GAMEPAD)')];
    navigator.getGamepads = () => window.__pads;
    try { localStorage.setItem('bitkit.players', 'link'); } catch (e) {}
  });
  const errs = [], fail = m => { console.error('FAIL', m); process.exitCode = 1; };
  const url = process.argv[2] || 'http://localhost:8765/index.html';
  const a = await ctx.newPage(); a.on('pageerror', e => errs.push('A ' + e.message));
  await a.goto(url); await a.waitForFunction(() => window.bkStudio);
  const c = await ctx.newPage(); c.on('pageerror', e => errs.push('B ' + e.message));
  await c.goto(url + '?bit=2'); await c.waitForFunction(() => window.bkStudio); await c.waitForTimeout(400);
  if (!await c.$eval('#padChooser', e => !e.hidden)) fail('chooser not shown in Bit 2');
  if (await a.$eval('#padChooser', e => !e.hidden)) fail('chooser shown in Bit 1');
  await c.screenshot({ path: (process.argv[3] || '.') + '/bit2-chooser.png' });
  // press A on the DualSense: Bit 2 takes it
  await c.evaluate(() => { __pads[1].buttons[0] = { pressed: true, value: 1 }; }); await c.waitForTimeout(150);
  await c.evaluate(() => { __pads[1].buttons[0] = { pressed: false, value: 0 }; });
  if (await c.$eval('#padChooser', e => !e.hidden)) fail('chooser still open after a press');
  const pk = await c.evaluate(() => bkStudio.picks[0]);
  if (pk.k !== 'pad' || pk.i !== 1) fail('Bit 2 pick ' + JSON.stringify(pk));
  await a.waitForTimeout(300);
  if ((await a.evaluate(() => bkStudio.link.peerPick || {})).i !== 1) fail('Bit 1 did not hear the pick');
  // Bit 1 on auto now uses only the Xbox pad
  // each window has its own fake pads: hold the DualSense's A in both
  for (const pg of [a, c]) await pg.evaluate(() => { __pads[1].buttons[0] = { pressed: true, value: 1 }; });
  await a.waitForTimeout(100);
  if (await a.evaluate(() => bkStudio.input.mask) !== 0) fail('Bit 1 reacted to Bit 2\'s controller');
  if (await c.evaluate(() => bkStudio.input.mask) !== 16) fail('Bit 2 did not read its controller');
  await c.evaluate(() => { __pads[1].buttons[0] = { pressed: false, value: 0 }; });
  await a.evaluate(() => { __pads[1].buttons[0] = { pressed: false, value: 0 }; __pads[0].buttons[0] = { pressed: true, value: 1 }; }); await a.waitForTimeout(100);
  if (await a.evaluate(() => bkStudio.input.mask) !== 16) fail('Bit 1 did not read the Xbox pad');
  await a.evaluate(() => { __pads[0].buttons[0] = { pressed: false, value: 0 }; });
  // reopen and pick the keyboard with a key
  await c.click('#linkPad'); await c.keyboard.press('KeyZ'); await c.waitForTimeout(100);
  if ((await c.evaluate(() => bkStudio.picks[0])).k !== 'kb') fail('key did not pick the keyboard');
  // a controller the browser only shows after its first press is taken by that press
  const d = await ctx.newPage(); d.on('pageerror', e => errs.push('D ' + e.message));
  await d.addInitScript(() => { window.__hidden = true; const real = navigator.getGamepads; navigator.getGamepads = () => window.__hidden ? [] : real(); });
  await d.goto(url + '?bit=2'); await d.waitForFunction(() => window.bkStudio); await d.waitForTimeout(300);
  await d.evaluate(() => { __pads[0].buttons[1] = { pressed: true, value: 1 }; window.__hidden = false; }); await d.waitForTimeout(150);
  const pk2 = await d.evaluate(() => bkStudio.picks[0]);
  if (pk2.k !== 'pad' || pk2.i !== 0) fail('first press of a newly shown pad did not pick it: ' + JSON.stringify(pk2));
  if (errs.length) fail(errs.join('\n'));
  console.log(process.exitCode ? 'linkpick: failed' : 'linkpick: ok');
  await b.close();
})();
