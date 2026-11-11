// Browser test: load studio, run demo with a fake gamepad, screenshot.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1400, height: 820 } });
  const logs = [];
  pg.on('console', m => logs.push(m.type() + ': ' + m.text()));
  pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await pg.addInitScript(() => {
    window.__pad = { id: 'Fake Pad (STANDARD GAMEPAD)', mapping: 'standard', connected: true, index: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.__pad];
  });
  await pg.goto(process.argv[3] || 'http://localhost:8765/index.html');
  await pg.waitForFunction(() => window.mbStudio);
  await pg.screenshot({ path: process.argv[2] + '/boot.png' });
  await pg.click('#btnRun');
  // hold right on d-pad + R trigger half
  await pg.evaluate(() => { __pad.buttons[15] = { pressed: true, value: 1 }; __pad.buttons[7] = { pressed: true, value: 0.5 }; __pad.buttons[6] = { pressed: false, value: 0.2 }; });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { __pad.buttons[0] = { pressed: true, value: 1 }; });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: process.argv[2] + '/run.png' });
  console.log('running', await pg.evaluate(() => mbStudio.isRunning()), 'press', await pg.evaluate(() => [...mbStudio.input.press].join(',')));
  for (const t of ['sprites', 'map', 'input', 'help']) {
    await pg.click(`.tabs button[data-tab=${t}]`);
    await pg.waitForTimeout(200);
    await pg.screenshot({ path: process.argv[2] + `/${t}.png` });
  }
  await pg.click('#btnSave'); await pg.waitForTimeout(200); await pg.screenshot({ path: process.argv[2] + '/save.png' }); await pg.keyboard.press('Escape');
  await pg.click('#btnDemo'); await pg.click('.m-buttons .primary'); await pg.waitForTimeout(300); console.log('demo running', await pg.evaluate(() => mbStudio.isRunning()));
  // error path
  await pg.click('.tabs button[data-tab=code]');
  await pg.evaluate(() => { document.querySelector('.CodeMirror').CodeMirror.setValue('function _draw()\n  cls(1)\n  foo()\nend'); });
  await pg.click('#btnRun');
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: process.argv[2] + '/error.png' });
  console.log(logs.join('\n'));
  await b.close();
})();
