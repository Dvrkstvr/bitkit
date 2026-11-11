// Capture check: photos (PNG) and clips (GIF) from the runtime's capture module (runtime/bk_capture.c), the code
// the PocketBit uses too. Plays the demo, takes a photo at every scale and a clip, and checks both decode back to
// exactly the screen (PNG with zlib, GIF with an LZW decoder written here). Also checks the share link codec.
const fs = require('fs'), zlib = require('zlib'); global.window = {};
eval(fs.readFileSync(__dirname + '/../studio/demo.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../studio/entities.js', 'utf8'));
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const W = 320, H = 240;

function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no PNG signature');
  let o = 8, w, h, pal, idat = [];
  while (o < buf.length) {
    const n = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + n);
    const crc = zlib.crc32 ? zlib.crc32(buf.subarray(o + 4, o + 8 + n)) >>> 0 : null;
    if (crc !== null && crc !== buf.readUInt32BE(o + 8 + n)) throw new Error('bad CRC in ' + type);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 3) throw new Error('not 8-bit indexed'); }
    if (type === 'PLTE') pal = Buffer.from(data);
    if (type === 'IDAT') idat.push(data);
    o += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));      // throws on a bad stream or adler32
  if (raw.length !== (w + 1) * h) throw new Error('pixel data is ' + raw.length + ' bytes');
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { if (raw[y * (w + 1)] !== 0) throw new Error('filter byte'); px.set(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w); }
  return { w, h, pal, px };
}

function readGif(buf) {
  if (buf.toString('ascii', 0, 6) !== 'GIF89a') throw new Error('no GIF header');
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  let o = 13 + (buf[10] & 0x80 ? 3 << ((buf[10] & 7) + 1) : 0);
  const canvas = new Uint8Array(w * h), frames = []; let delay = 0, loop = false;
  const blocks = () => { const parts = []; while (buf[o]) { parts.push(buf.subarray(o + 1, o + 1 + buf[o])); o += buf[o] + 1; } o++; return Buffer.concat(parts); };
  while (o < buf.length) {
    const b = buf[o++];
    if (b === 0x3b) break;
    if (b === 0x21) { const l = buf[o++]; if (l === 0xf9) delay = buf.readUInt16LE(o + 2); if (l === 0xff && buf.toString('ascii', o + 1, o + 9) === 'NETSCAPE') loop = true; o += buf[o] + 1; blocks(); continue; }
    if (b !== 0x2c) throw new Error('unknown block ' + b + ' at ' + o);
    const x = buf.readUInt16LE(o), y = buf.readUInt16LE(o + 2), fw = buf.readUInt16LE(o + 4), fh = buf.readUInt16LE(o + 6), fl = buf[o + 8]; o += 9;
    if (fl & 0x80) o += 3 << ((fl & 7) + 1);
    const min = buf[o++], data = blocks();
    const out = lzwDecode(data, min, fw * fh);
    if (out.length !== fw * fh) throw new Error(`frame ${frames.length} decoded ${out.length} of ${fw * fh} pixels`);
    for (let r = 0; r < fh; r++) canvas.set(out.subarray(r * fw, (r + 1) * fw), (y + r) * w + x);
    frames.push({ x, y, w: fw, h: fh, delay, local: !!(fl & 0x80), px: canvas.slice() });
  }
  return { w, h, frames, loop };
}
function lzwDecode(d, min, n) {
  const clear = 1 << min, eoi = clear + 1, out = new Uint8Array(n); let size = min + 1, next = eoi + 1, bit = 0, oi = 0, prev = -1;
  let pre = new Int32Array(4096), suf = new Uint8Array(4096), len = new Int32Array(4096);
  const reset = () => { size = min + 1; next = eoi + 1; prev = -1; };
  for (let i = 0; i < clear; i++) { pre[i] = -1; suf[i] = i; len[i] = 1; }
  const first = c => { while (pre[c] >= 0) c = pre[c]; return suf[c]; };
  const emit = c => { const l = len[c]; for (let k = l - 1; k >= 0; k--) { if (oi + k < n) out[oi + k] = suf[c]; c = pre[c]; } oi += l; };
  for (;;) {
    if (bit + size > d.length * 8) break;
    let c = 0; for (let k = 0; k < size; k++, bit++) c |= ((d[bit >> 3] >> (bit & 7)) & 1) << k;
    if (c === clear) { reset(); continue; }
    if (c === eoi) break;
    if (prev < 0) { emit(c); prev = c; continue; }
    if (c < next) { if (next < 4096) { pre[next] = prev; suf[next] = first(c); len[next] = len[prev] + 1; next++; } emit(c); }
    else if (c === next) { if (next < 4096) { pre[next] = prev; suf[next] = first(prev); len[next] = len[prev] + 1; next++; } emit(c); }
    else throw new Error('bad LZW code ' + c);
    prev = c;
    if (next === (1 << size) && size < 12) size++;
  }
  return out.subarray(0, Math.min(oi, n));
}

require('../studio/runtime.js')({ onLog: () => {} }).then(M => {
  const s = x => M.stringToNewUTF8(x);
  M._bkw_init();
  const cart = { tiles: new Uint8Array(32768), flags: new Uint8Array(512), map: new Uint16Array(32768) };
  window.BK_DEMO.buildGfx(cart);
  const meta = cart.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed }));
  M.HEAPU8.set(cart.tiles, M._bkw_tiles()); M.HEAPU8.set(cart.flags, M._bkw_flags()); M.HEAPU16.set(cart.levels[0].map, M._bkw_map() >> 1);
  if (M._bkw_load_ex(s(window.BKEntities.toLua(cart.entities, meta, 0, 'GAME_BOOT = 3\n')), s(window.BK_DEMO.code)) !== 0) return fail('demo did not load');
  const screen = () => M.HEAPU8.slice(M._bkw_screen(), M._bkw_screen() + W * H);
  const palette = () => M.HEAPU8.slice(M._bkw_palette(), M._bkw_palette() + 768);
  for (let f = 0; f < 120; f++) M._bkw_frame(1 << 1, 0);

  // photos
  for (const sc of [1, 2, 3, 4]) {
    const n = M._bkw_shot(sc);
    if (n <= 0) { fail('photo at scale ' + sc + ' failed'); continue; }
    const png = Buffer.from(M.HEAPU8.subarray(M._bkw_cap_buf(0), M._bkw_cap_buf(0) + n));
    try {
      const p = readPng(png), scr = screen();
      if (p.w !== W * sc || p.h !== H * sc) fail(`photo x${sc} is ${p.w}x${p.h}`);
      let bad = 0; for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.px[y * p.w + x] !== scr[((y / sc) | 0) * W + ((x / sc) | 0)]) bad++;
      if (bad) fail(`photo x${sc}: ${bad} pixels differ from the screen`);
      if (!p.pal.equals(Buffer.from(palette()))) fail('photo palette differs');
      if (sc === 1) { fs.writeFileSync(require('os').tmpdir() + '/bk-shot.png', png); console.log(`photo x1: ${n} bytes (raw would be ${W * H})`); }
    } catch (e) { fail(`photo x${sc}: ${e.message}`); }
  }

  // clip: 150 captured frames (5 s at 30 fps), a palette change in the middle, and a still stretch
  const shots = [];
  if (M._bkw_clip_begin() !== 0) return fail('clip did not start');
  for (let f = 0; f < 300; f++) {
    M._bkw_frame((1 << 1) | ((f % 40) < 10 ? 1 << 4 : 0), 0);
    if (f === 150) M._bkw_eval(s('palette(1, 255, 0, 0)'));
    if (f % 2 === 0) { M._bkw_clip_frame(2); shots.push(screen()); }
  }
  M._bkw_load(s('function _draw() cls(3) end')); M._bkw_frame(0, 0);
  for (let f = 0; f < 60; f++) { M._bkw_frame(0, 0); if (f % 2 === 0) { M._bkw_clip_frame(2); shots.push(screen()); } }
  const n = M._bkw_clip_end();
  if (n <= 0) return fail('clip did not finish');
  const gif = Buffer.from(M.HEAPU8.subarray(M._bkw_cap_buf(1), M._bkw_cap_buf(1) + n));
  fs.writeFileSync(require('os').tmpdir() + '/bk-clip.gif', gif);
  try {
    const g = readGif(gif);
    if (g.w !== W || g.h !== H || !g.loop) fail('clip header');
    // play the GIF back on a timeline and compare with what was on screen at each captured frame
    const total = g.frames.reduce((a, f) => a + f.delay, 0);
    if (Math.abs(total - shots.length * 2 * 100 / 60) > 2) fail(`clip lasts ${total} cs, expected ${(shots.length * 200 / 60).toFixed(1)}`);
    let t = 0, fi = 0, bad = 0;
    const starts = []; for (const f of g.frames) { starts.push(t); t += f.delay; }
    for (let i = 0; i < shots.length; i++) {
      const at = Math.round(i * 200 / 60) + 0.5;
      while (fi + 1 < g.frames.length && starts[fi + 1] <= at) fi++;
      const px = g.frames[fi].px; for (let k = 0; k < W * H; k++) if (px[k] !== shots[i][k]) { bad++; break; }
    }
    if (bad) fail(`${bad} of ${shots.length} clip frames differ from the screen`);
    if (!g.frames.some(f => f.local)) fail('palette change did not give a frame its own colours');
    const small = g.frames.filter(f => f.w * f.h < W * H).length;
    console.log(`clip: ${shots.length} frames -> ${g.frames.length} GIF frames (${small} partial), ${(n / 1024).toFixed(0)} KB, ${(total / 100).toFixed(2)} s`);
  } catch (e) { fail('clip: ' + e.message); }
  M._bkw_cap_free(0); M._bkw_cap_free(1);
  if (!process.exitCode) console.log('capture OK');
});
