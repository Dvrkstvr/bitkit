// Browser test: each studio tab picks its own controller or the keyboard (and player 2 in 2-player mode).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 820 } });
  await ctx.addInitScript(() => {
    const mk = (i, id) => ({ id, mapping: 'standard', connected: true, index: i, axes: [0,0,0,0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
    window.__pads = [mk(0, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'), mk(1, 'DualSense Wireless Controller (STANDARD GAMEPAD)')];
    navigator.getGamepads = () => window.__pads;
  });
  const errs = [];
  const a = await ctx.newPage(); a.on('pageerror', e => errs.push('A ' + e.message));
  await a.goto('http://localhost:8765/index.html'); await a.waitForFunction(() => window.bkStudio); await a.waitForTimeout(300);
  console.log('A options', await a.$$eval('#inputPick option', o => o.map(x => x.textContent)));
  await a.selectOption('#inputPick', 'pad:1');
  await a.evaluate(() => { __pads[0].buttons[0] = { pressed: true, value: 1 }; }); await a.waitForTimeout(100);
  console.log('A (DualSense) mask while Xbox A held', await a.evaluate(() => bkStudio.input.mask));
  await a.evaluate(() => { __pads[0].buttons[0] = { pressed: false, value: 0 }; __pads[1].buttons[0] = { pressed: true, value: 1 }; }); await a.waitForTimeout(100);
  console.log('A mask while DualSense A held', await a.evaluate(() => bkStudio.input.mask));
  await a.evaluate(() => { __pads[1].buttons[0] = { pressed: false, value: 0 }; });
  await a.focus('#screen'); await a.keyboard.down('KeyZ'); await a.waitForTimeout(100);
  console.log('A mask with Z (should be 0)', await a.evaluate(() => bkStudio.input.mask)); await a.keyboard.up('KeyZ');
  const bb = await ctx.newPage(); bb.on('pageerror', e => errs.push('B ' + e.message));
  await bb.goto('http://localhost:8765/index.html'); await bb.waitForFunction(() => window.bkStudio); await bb.waitForTimeout(300);
  console.log('B pick (fresh tab)', await bb.$eval('#inputPick', s => s.value));
  await bb.selectOption('#inputPick', 'kb');
  await bb.evaluate(() => { __pads[0].buttons[0] = { pressed: true, value: 1 }; }); await bb.waitForTimeout(100);
  console.log('B (kb) mask with Xbox A (0)', await bb.evaluate(() => bkStudio.input.mask));
  await bb.focus('#screen'); await bb.keyboard.down('KeyZ'); await bb.waitForTimeout(100);
  console.log('B mask with Z (16)', await bb.evaluate(() => bkStudio.input.mask)); await bb.keyboard.up('KeyZ');
  await a.reload(); await a.waitForFunction(() => window.bkStudio); await a.waitForTimeout(300);
  console.log('A after reload', await a.$eval('#inputPick', s => s.value));
  // 2 players
  await a.selectOption('#players', '2'); await a.waitForTimeout(100);
  console.log('P2 visible', await a.$eval('#inputPick2', s => !s.hidden));
  await a.selectOption('#inputPick2', 'kb');
  await a.focus('#screen'); await a.keyboard.down('ArrowLeft'); await a.waitForTimeout(100);
  console.log('P2 arrow (1)', await a.evaluate(() => bkStudio.input2.mask), 'P1', await a.evaluate(() => bkStudio.input.mask));
  await a.keyboard.up('ArrowLeft');
  await a.screenshot({ path: (process.argv[2] || '.') + '/input-pick.png', clip: { x: 0, y: 270, width: 720, height: 360 } });
  console.log('errors', errs);
  await b.close();
})();
