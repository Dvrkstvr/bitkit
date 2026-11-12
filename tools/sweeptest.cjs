// CI check for Sweep Storm and network events (net_send / net_recv): runs several Bits in one process,
// passes their events between them like ESP-NOW broadcasts, and plays whole matches with bots.
const fs = require('fs'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/sweep.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const B = { left: 0, right: 1, up: 2, down: 3, a: 4, b: 5, x: 6, y: 7, l: 8, r: 9, start: 10, select: 11 };
const runtime = require('../studio/runtime.js');
const D = (window.BK_DEMOS || []).find(d => d.name === 'Sweep Storm');
if (!D) { fail('sweep.js did not register itself in BK_DEMOS'); process.exit(1); }
const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
D.buildGfx(cart);

// The human Bits play with the bots' brain (AUTO), so a match goes the distance. L prints the state.
const probe = `
AUTO = true
local _sm = step_me
function step_me() if AUTO and not me.out and not match.over then if me.stun == 0 then bot_think(me) end else _sm() end end
function opsum() local h = 0 for i = 1, S * S do h = (h * 3 + op[i]) % 1000003 end return h end
local _u = _update
function _update()
  _u()
  if btnp("l") then
    if scene == "match" then
      local alive, items = 0, 0
      for _, p in ipairs(slots) do if not p.out then alive = alive + 1 end end
      print("st", match.seed, S, #slots, me.k, opsum(), match.over and 1 or 0, me.score, match.mt, match.nh, match.nb, alive, SR, rank_of(me), GAME.won and 1 or 0, tricks_seen or 0, GAME.state)
    else print("st", "lobby", #lobby_ids(), bots) end
  end
end
`;
const OUT = 16, IN = 64, SLOT = 10, HDR = 4;

async function bit(id, save) {
  const b = { id, errors: [], logs: [], q: [], sent: 0 };
  const M = b.M = await runtime({ onLog: (m, e) => (e ? b.errors : b.logs).push(m) });
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags());
  b.press = M._malloc(16); b.net = M._bkw_net() >> 2; b.sv = M._bkw_save() >> 2;
  b.load = (boot, save) => {
    if (save == null) M.HEAP32[b.sv] = -1;
    else { const buf = Buffer.from(save, 'latin1'); M.HEAPU8.set(buf, (b.sv + 2) << 2); M.HEAP32[b.sv] = buf.length; }
    M.HEAP32[b.sv + 1] = 0;
    M.HEAP32.fill(0, b.net, b.net + 4); M.HEAP32[b.net] = b.id;
    if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities) + (boot ? `\nGAME_BOOT = ${boot}\n` : '')), s(D.code + probe)) !== 0) fail('Sweep Storm did not load: ' + b.errors);
  };
  b.save = () => { const n = M.HEAP32[b.sv]; return n < 0 ? null : Buffer.from(M.HEAPU8.subarray((b.sv + 2) << 2, ((b.sv + 2) << 2) + n)).toString('latin1'); };
  b.load(3, save);
  return b;
}
// one frame on every Bit, then deliver what each one sent to all the others
function tick(bits, masks) {
  bits.forEach((b, k) => {
    const H = b.M.HEAP32, base = b.net, inb = base + HDR + OUT * SLOT;
    let w = 0;
    while (w < IN && b.q.length) { const [from, ev] = b.q.shift(), o = inb + w * SLOT; H[o] = from; H[o + 1] = ev.length; ev.forEach((v, i) => H[o + 2 + i] = v); w++; }
    H[base + 2] = w; H[base + 3] = 0;
    const m = (masks && masks[k]) || 0;
    for (let i = 0; i < 12; i++) b.M.HEAPU8[b.press + i] = (m >> i) & 1 ? 255 : 0;
    if (b.M._bkw_frame(m, b.press) !== 0 && !b.dead) { b.dead = true; fail(`Bit ${b.id} stopped: ${b.errors.join('\n')}`); }
    const n = H[base + 1]; H[base + 1] = 0;
    for (let i = 0; i < n; i++) {
      const o = base + HDR + i * SLOT, ev = Array.from(H.subarray(o + 2, o + 2 + H[o + 1]));
      if (H[o] !== b.id) fail('event sent with the wrong id ' + H[o]);
      b.sent++;
      for (const other of bits) if (other !== b) other.q.push([b.id, ev]);
    }
  });
}
function state(bits) {
  bits.forEach(b => b.logs = []);
  tick(bits, bits.map(() => 1 << B.l)); tick(bits);
  return bits.map(b => { const l = b.logs.filter(x => x.startsWith('st')).pop(); return l ? l.split(/\s+/).slice(1) : null; });
}

(async () => {
  // 1. four Bits meet in the lobby and see each other; Bit 1 sets 8 bots and starts the match
  const ids = [101, 2002, 30003, 404];
  const bits = [];
  for (const id of ids) bits.push(await bit(id));
  for (let f = 0; f < 120; f++) tick(bits);
  let st = state(bits);
  st.forEach((v, k) => { if (!v || v[0] !== 'lobby' || v[1] !== '4') fail(`Bit ${k + 1} lobby sees ${v && v[1]} Bits (expected 4)`); });
  for (let k = 0; k < 3; k++) { tick(bits, [1 << B.left]); tick(bits); }
  st = state(bits);
  if (!st[0] || st[0][2] !== '8') fail('lobby bots setting: ' + (st[0] && st[0][2]));
  tick(bits, [1 << B.a]);
  for (let f = 0; f < 5; f++) tick(bits);
  st = state(bits);
  const seed = st[0] && st[0][0];
  st.forEach((v, k) => {
    if (!v || v[0] === 'lobby') { fail(`Bit ${k + 1} did not join the match`); return; }
    if (v[0] !== seed || v[2] !== '12' || v[4] !== st[0][4]) fail(`Bit ${k + 1} has a different island: ${v}`);
    if (v[3] !== String([...ids].sort((x, y) => x - y).indexOf(ids[k]) + 1)) fail(`Bit ${k + 1} plays slot ${v[3]}`);   // slots go by id
    if (v[8] !== '4' || v[9] !== '8') fail(`Bit ${k + 1}: ${v[8]} humans and ${v[9]} bots`);
  });
  if (bits.some(b => b.errors.length)) bits.forEach(b => b.errors.forEach(e => fail('start: ' + e)));

  // 2. play the whole match: the storm closes in, everyone ends up agreeing on the island and the scores
  let mid = null;
  for (let f = 0; f < 60 * 60 * 4 + 200; f++) {
    tick(bits);
    if (f === 60 * 60 * 2) mid = state(bits);
    if (bits.every(b => b.dead)) break;
  }
  for (let f = 0; f < 120; f++) tick(bits);     // let the last events arrive
  st = state(bits);
  // the winner's Bit shows "Goal complete" (game_win) over the results: after a moment, holding A
  // ("Keep playing") goes back to them; B and a quick A do nothing there
  const won = st.map(v => !v);
  if (won.filter(Boolean).length > 1) fail('more than one Bit thinks it won');
  if (won.some(Boolean)) {
    tick(bits, won.map(w => w ? 1 << B.b : 0)); tick(bits);
    if (state(bits).some((v, k) => won[k] && v)) fail('B should not leave the goal screen');
    for (let f = 0; f < 50; f++) tick(bits);
    for (let f = 0; f < 50; f++) tick(bits, won.map(w => w ? 1 << B.a : 0));
    tick(bits); st = state(bits);
  }
  st.forEach((v, k) => { if (v && (v[12] === '1') !== (v[13] === '1')) fail(`Bit ${k + 1} is #${v[12]} but won=${v[13]}`); });
  console.log('mid-match:', mid && mid[0].join(' '));
  console.log('end:', st.map(v => v && v.join(' ')).join(' | '));
  st.forEach((v, k) => {
    if (!v || v[5] !== '1') fail(`Bit ${k + 1}: the match did not end: ${v}`);
    if (v && v[4] !== st[0][4]) fail(`Bit ${k + 1} ended with a different island than Bit 1`);
  });
  if (mid && !(+mid[0][11] < +mid[0][1] / 2)) fail('the storm did not close in: ' + mid[0]);
  if (!st.some(v => v && +v[6] >= 20)) fail('nobody dug much: ' + st.map(v => v && v[6]));   // one Bit can hit a mine early
  // Confuse and Paint thrown by anyone reach every Bit
  const tr = st.map(v => v && +v[14]);
  if (!(tr[0] > 0) || tr.some(n => n !== tr[0])) fail('Bits saw different numbers of Confuse/Paint throws: ' + tr);
  const total = bits.reduce((n, b) => n + b.sent, 0);
  console.log('events sent:', bits.map(b => b.sent).join(', '), '(bots run on Bit 1)');
  if (total > 60 * 4 * 60 * 2) fail('too many network events for ESP-NOW: ' + total);
  // after the results: the after-match menu (Play again, Back to lobby, Quit to title), chosen by holding A
  // (a tap doesn't: it might be a dig still being mashed)
  tick(bits, bits.map(() => 1 << B.a)); tick(bits);
  st = state(bits);
  if (!st[0] || st[0][0] === 'lobby') fail('a tap of A on the results should not leave them');
  // Bit 4 picks Back to lobby (Right, hold A)
  tick(bits, [0, 0, 0, 1 << B.right]); tick(bits);
  for (let f = 0; f < 70; f++) tick(bits, [0, 0, 0, 1 << B.a]);
  tick(bits);
  st = state(bits);
  if (!st[3] || st[3][0] !== 'lobby') fail('Back to lobby on the results did not go back to the lobby: ' + st[3]);
  if (st[0] && st[0][0] === 'lobby') fail('Bit 1 left the results by itself');
  // Bit 2 picks Play again (hold A) and pulls in everyone: the Bits still on the results and Bit 4 in the lobby
  for (let f = 0; f < 70; f++) tick(bits, [0, 1 << B.a]);
  for (let f = 0; f < 5; f++) tick(bits);
  st = state(bits);
  st.forEach((v, k) => {
    if (!v || v[0] === 'lobby' || v[5] !== '0' || v[0] !== st[1][0]) fail(`Bit ${k + 1} is not in the rematch: ${v}`);
    else if (v[8] !== '4') fail(`Bit ${k + 1}: rematch has ${v[8]} humans`);
  });
  if (st[0] && st[0][0] === seed) fail('the rematch has the same island');
  if (st.some(v => v && v[15] !== 'play')) fail('the after-match menu is still open after Play again: ' + st.map(v => v && v[15]));
  // Bit 3 leaves through the pause menu (Start, Down to "Back to lobby", A): it is out on every Bit
  for (let f = 0; f < 30; f++) tick(bits);
  const alive0 = st[0] && +st[0][10];
  tick(bits, [0, 0, 1 << B.start]); tick(bits); tick(bits, [0, 0, 1 << B.down]); tick(bits); tick(bits, [0, 0, 1 << B.a]);
  for (let f = 0; f < 20; f++) tick(bits);
  st = state(bits);
  if (!st[2] || st[2][0] !== 'lobby') fail('"Back to lobby" in the pause menu did not leave the match: ' + st[2]);
  if (st[0] && !(+st[0][10] < alive0)) fail(`Bit 1 still counts Bit 3 as digging: ${st[0][10]} alive (was ${alive0})`);
  bits.forEach(b => b.errors.forEach(e => fail('match: ' + e)));

  // 3. no network (NET_ID 0): you against the bots, with a checkpoint for Continue
  const solo = await bit(0);
  tick([solo]); tick([solo], [1 << B.a]);
  for (let f = 0; f < 1000; f++) tick([solo]);
  let a = state([solo])[0];
  if (!a || a[0] === 'lobby' || a[9] !== '11') fail('solo match did not start with 11 bots: ' + a);
  const sv = solo.save();
  if (!sv || !/seed/.test(sv)) fail('solo match kept no checkpoint');
  solo.load(0, sv);                               // title screen: Continue is first, A picks it
  tick([solo]); tick([solo], [1 << B.a]); tick([solo]);
  let c = state([solo])[0];
  if (!c || c[0] !== a[0]) fail(`Continue did not go back to the same island: ${c} vs ${a}`);
  if (c && !(+c[7] > 0 && Math.abs(+c[7] - +a[7]) <= 600)) fail(`Continue lost the match clock: ${c[7]} vs ${a[7]}`);
  if (c && c[4] === '0') fail('Continue lost the dug cells');
  solo.errors.forEach(e => fail('solo: ' + e));
  if (!process.exitCode) console.log('sweep storm ok');
})().catch(e => fail(e.stack));
