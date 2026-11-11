// Browser test for the AI chat: fakes the Claude and Gemini APIs (no keys, no network) and checks the
// tool loop, the review card, apply / undo, and what is sent to each provider.
// Usage: node tools/aitest.cjs [screenshot dir]   (serves studio/ itself)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'studio');
const shots = process.argv[2];
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };

const sse = events => events.map(e => `event: ${e.type || 'message'}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const claudeReply = blocks => {
  const ev = [{ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } }];
  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
      b.text.match(/.{1,7}/gs).forEach(t => ev.push({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } }));
    } else if (b.type === 'thinking') {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '' } });
      ev.push({ type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'sig123' } });
    } else {
      ev.push({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      const j = JSON.stringify(b.input);
      for (let k = 0; k < j.length; k += 20) ev.push({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: j.slice(k, k + 20) } });
    }
    ev.push({ type: 'content_block_stop', index: i });
  });
  ev.push({ type: 'message_delta', delta: { stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  return sse(ev);
};

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : 'text/javascript' });
    fs.createReadStream(f).pipe(r);
  }).listen(0);
  const url = `http://localhost:${srv.address().port}/index.html`;
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1400, height: 860 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));

  // ---- fake Claude: turn 1 reads code, turn 2 edits code + draws a sprite + tests, turn 3 answers
  const claudeBodies = [];
  await pg.route('https://api.anthropic.com/v1/models**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] }) }));
  await pg.route('https://api.anthropic.com/v1/messages', async r => {
    const req = r.request(), body = JSON.parse(req.postData());
    claudeBodies.push({ body, headers: req.headers() });
    const n = claudeBodies.length;
    let out;
    if (n === 1) out = claudeReply([{ type: 'thinking' }, { type: 'text', text: 'Let me look at your code first.' }, { type: 'tool_use', id: 'tu_1', name: 'read_code', input: { start_line: 1, end_line: 5 } }]);
    else if (n === 2) out = claudeReply([
      { type: 'tool_use', id: 'tu_2', name: 'edit_code', input: { old_text: 'function _init()', new_text: 'function _init()\n  print("hello from ai")' } },
      { type: 'tool_use', id: 'tu_3', name: 'draw_sprite', input: { tile: 500, size: 1, rows: Array(8).fill('1b1b1b1b1b1b1b1b') } },
      { type: 'tool_use', id: 'tu_4', name: 'test_game', input: { frames: 30, buttons: [{ from: 0, to: 20, press: ['right'] }] } }]);
    else out = claudeReply([{ type: 'text', text: 'Done! I added a **print** and drew `tile 500`.' }]);
    await r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: out });
  });

  await pg.goto(url);
  await pg.waitForFunction(() => window.bkStudio);
  await pg.click('.tabs button[data-tab=ai]');
  if (!await pg.isVisible('#aiSetup')) fail('key setup should show without a key');
  if (await pg.isEnabled('#aiInput')) fail('input should be disabled without a key');
  if (shots) await pg.screenshot({ path: shots + '/ai-setup.png' });
  await pg.fill('#aiKey', 'sk-ant-test-key');
  await pg.click('#aiKeySave');
  if (!await pg.isEnabled('#aiInput')) fail('input should be enabled after saving a key');
  const stored = await pg.evaluate(() => JSON.parse(localStorage.getItem('bitkit.ai')));
  if (stored.keys.claude !== 'sk-ant-test-key') fail('key should be remembered in localStorage');

  const codeBefore = await pg.evaluate(() => bkStudio.cart.code === undefined ? null : document.querySelector('.CodeMirror').CodeMirror.getValue());
  await pg.fill('#aiInput', 'Add a hello print and a dark tile');
  await pg.press('#aiInput', 'Enter');
  await pg.waitForSelector('.ai-card button[data-a=apply]', { timeout: 15000 });
  if (shots) await pg.screenshot({ path: shots + '/ai-proposal.png' });

  // the proposal must not have touched the cart yet
  const codeMid = await pg.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  if (codeMid !== codeBefore) fail('cart changed before Apply');
  if (claudeBodies.length !== 3) fail('expected 3 Claude requests, got ' + claudeBodies.length);
  const c1 = claudeBodies[0], c2 = claudeBodies[1], c3 = claudeBodies[2];
  if (c1.headers['x-api-key'] !== 'sk-ant-test-key') fail('api key header');
  if (c1.headers['anthropic-dangerous-direct-browser-access'] !== 'true') fail('browser access header');
  if (c1.body.model !== 'claude-opus-5-5') fail('default model should be claude-opus-5-5, was ' + c1.body.model);
  if (!c1.body.stream || !c1.body.tools.length || !/BitKit/.test(c1.body.system)) fail('request shape');
  if (!/^\[Studio\] Cart/.test(c1.body.messages[0].content[0].text)) fail('first user message should start with the studio note');
  const a1 = c2.body.messages[1];
  if (a1.role !== 'assistant' || a1.content[0].type !== 'thinking' || a1.content[0].signature !== 'sig123') fail('thinking block should be passed back unchanged');
  const tr = c2.body.messages[2].content[0];
  if (tr.type !== 'tool_result' || tr.tool_use_id !== 'tu_1' || !/^   1| --/.test(tr.content[0].text)) fail('read_code tool result: ' + JSON.stringify(tr).slice(0, 200));
  const tr3 = c3.body.messages[4].content;
  if (tr3.length !== 3) fail('all three tool results should go back in one message');
  const testRes = tr3[2];
  if (!testRes.content.some(x => x.type === 'image')) fail('test_game should return a screenshot to Claude');
  const testJson = JSON.parse(testRes.content[0].text);
  if (!testJson.console.some(l => /hello from ai/.test(l))) fail('test_game should run the AI version of the code: ' + testRes.content[0].text.slice(0, 300));
  const cardText = await pg.textContent('.ai-card');
  if (!/Code: \+1/.test(cardText) || !/Sprites: 1 tile/.test(cardText)) fail('review card: ' + cardText);

  await pg.click('.ai-card button[data-a=apply]');
  const after = await pg.evaluate(() => ({ code: document.querySelector('.CodeMirror').CodeMirror.getValue(), px: bkStudio.cart.tiles[500 * 64] }));
  if (!/hello from ai/.test(after.code)) fail('code not applied');
  if (after.px !== 0x1b) fail('sprite not applied: ' + after.px);
  await pg.click('.ai-card .ai-card-buttons button');   // Undo
  const undone = await pg.evaluate(() => ({ code: document.querySelector('.CodeMirror').CodeMirror.getValue(), px: bkStudio.cart.tiles[500 * 64] }));
  if (undone.code !== codeBefore || undone.px !== 0) fail('undo did not restore the cart');
  if (shots) await pg.screenshot({ path: shots + '/ai-applied.png' });

  // ---- fake Gemini: one function call (with a thought signature), then text
  const gemBodies = [];
  await pg.route('https://generativelanguage.googleapis.com/**', async r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-4-argon', displayName: 'Gemini 4 Argon', supportedGenerationMethods: ['generateContent'] }] }) });
    gemBodies.push({ url: req.url(), body: JSON.parse(req.postData()), headers: req.headers() });
    const chunk = o => `data: ${JSON.stringify(o)}\r\n\r\n`;
    const out = gemBodies.length === 1
      ? chunk({ candidates: [{ content: { role: 'model', parts: [{ text: 'Renaming ' }] } }] }) + chunk({ candidates: [{ content: { role: 'model', parts: [{ text: 'it.' }, { functionCall: { name: 'set_cart_name', args: { name: 'Gem Game' } }, thoughtSignature: 'gsig' }] }, finishReason: 'STOP' }] })
      : chunk({ candidates: [{ content: { role: 'model', parts: [{ text: 'Renamed.' }] }, finishReason: 'STOP' }] });
    await r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: out });
  });
  await pg.click('#aiNew');
  await pg.selectOption('#aiProvider', 'gemini');
  if (!await pg.isVisible('#aiSetup')) fail('gemini key setup should show');
  await pg.fill('#aiKey', 'AIza-test'); await pg.click('#aiKeySave');
  await pg.fill('#aiInput', 'rename my game'); await pg.press('#aiInput', 'Enter');
  await pg.waitForSelector('.ai-card button[data-a=apply]', { timeout: 15000 });
  if (gemBodies.length !== 2) fail('expected 2 Gemini requests, got ' + gemBodies.length);
  const g1 = gemBodies[0], g2 = gemBodies[1];
  if (!/models\/gemini-4-argon:streamGenerateContent\?alt=sse/.test(g1.url)) fail('gemini url ' + g1.url);
  if (g1.headers['x-goog-api-key'] !== 'AIza-test') fail('gemini key header');
  const model = g2.body.contents[1];
  if (model.role !== 'model' || model.parts[0].text !== 'Renaming it.' || model.parts[1].thoughtSignature !== 'gsig') fail('gemini model turn replay: ' + JSON.stringify(model));
  const fr = g2.body.contents[2].parts[0].functionResponse;
  if (!fr || fr.name !== 'set_cart_name' || fr.response.result !== 'Done.') fail('gemini function response: ' + JSON.stringify(fr));
  await pg.click('.ai-card button[data-a=discard]');
  if (await pg.evaluate(() => bkStudio.cart.name) === 'Gem Game') fail('discard should leave the cart alone');
  if (shots) await pg.screenshot({ path: shots + '/ai-gemini.png' });

  errs.forEach(e => fail('page error: ' + e));
  await b.close(); srv.close();
  if (!process.exitCode) console.log('AI chat test passed');
})().catch(e => { fail(e.stack || e); process.exit(1); });
