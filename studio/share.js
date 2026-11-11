/* BitKit Studio: the Share hub.
   - Play links: a whole game packed into a link (compressed into the part after #), so a game can be shared
     with no server at all. Small games also fit in a QR code (encoder below, written for BitKit).
   - Captures: photos (.png) and clips (.gif) made by the runtime's capture module (runtime/bk_capture.c, the same
     code the PocketBit runs), kept on the memory card in captures/.
   - The hub: games, photos and clips people posted. Posting is a GitHub issue (free, no keys); a GitHub Action
     checks it and publishes it to the repository's "hub" branch, which this page reads (tools/hub_publish.cjs).
   MIT License. */
'use strict';
window.BKShare = (() => {
  const SITE = 'https://dvrkstvr.github.io/bitkit/';
  const REPO = 'Dvrkstvr/bitkit';
  const HUB_BRANCH = 'hub';
  const HUB_RAW = `https://raw.githubusercontent.com/${REPO}/${HUB_BRANCH}/`;
  const ISSUE_URL = `https://github.com/${REPO}/issues/new`;

  /* ---------------------------------------------------------------- play links */
  // A cart file (serialize()) holds its pictures and maps as base64 text, which does not compress. For a link the
  // base64 fields become raw bytes after a small JSON header, then everything is deflated and written as base64url.
  // Link: SITE#play=1.<data>. Version 1 layout: "BK" 1 | u32 json length | json | blobs.
  const B64_FIELDS = ['palette', 'tiles', 'flags'];
  function b64ToBytes(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function packCart(cartObj) {
    const o = JSON.parse(JSON.stringify(cartObj));
    delete o.entities_lua;                       // made again from the entities when the game loads
    const blobs = [];
    const take = s => { blobs.push(b64ToBytes(s)); return { $: blobs.length - 1 }; };
    B64_FIELDS.forEach(k => { if (typeof o[k] === 'string') o[k] = take(o[k]); });
    if (Array.isArray(o.levels)) o.levels.forEach(L => {
      if (typeof L.map === 'string') L.map = take(L.map);
      if (typeof L.height === 'string') L.height = take(L.height);
    });
    if (typeof o.map === 'string') o.map = o.levels && o.levels[0] && cartObj.levels && cartObj.levels[0].map === cartObj.map ? { $: 'L0' } : take(o.map);
    o.bin = blobs.map(b => b.length);
    const json = new TextEncoder().encode(JSON.stringify(o));
    const total = 7 + json.length + blobs.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    out[0] = 66; out[1] = 75; out[2] = 1;
    new DataView(out.buffer).setUint32(3, json.length);
    out.set(json, 7);
    let p = 7 + json.length; blobs.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }
  function unpackCart(u8) {
    if (u8[0] !== 66 || u8[1] !== 75) throw new Error('not a BitKit game link');
    if (u8[2] !== 1) throw new Error('this link is from a newer BitKit');
    const n = new DataView(u8.buffer, u8.byteOffset).getUint32(3);
    const o = JSON.parse(new TextDecoder().decode(u8.subarray(7, 7 + n)));
    const blobs = []; let p = 7 + n;
    (o.bin || []).forEach(len => { blobs.push(u8.subarray(p, p + len)); p += len; });
    delete o.bin;
    const give = v => (v && typeof v === 'object' && typeof v.$ === 'number') ? bytesToB64(blobs[v.$]) : v;
    B64_FIELDS.forEach(k => { o[k] = give(o[k]); });
    (o.levels || []).forEach(L => { L.map = give(L.map); if (L.height) L.height = give(L.height); });
    o.map = o.map && o.map.$ === 'L0' ? o.levels[0].map : give(o.map);
    return o;
  }
  async function streamBytes(u8, stream) {
    const s = new Blob([u8]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const deflate = u8 => streamBytes(u8, new CompressionStream('deflate-raw'));
  const inflate = u8 => streamBytes(u8, new DecompressionStream('deflate-raw'));
  const toB64url = u8 => bytesToB64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = s => b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  async function linkFor(cartObj) { return SITE + '#play=1.' + toB64url(await deflate(packCart(cartObj))); }
  // the cart in a link (or in any text holding one), or null
  function findPlay(text) { const m = /#play=1\.([A-Za-z0-9_-]+)/.exec(text || ''); return m ? m[1] : null; }
  async function cartFromLink(text) {
    const d = findPlay(text); if (!d) return null;
    return unpackCart(await inflate(fromB64url(d)));
  }

  /* ---------------------------------------------------------------- QR codes (byte mode, all 40 versions) */
  // ECC codewords per block and number of blocks, per version, for levels L and M (from the QR specification)
  const ECC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28] };
  const BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49] };
  const ECL_BITS = { L: 1, M: 0 };
  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return r;
  }
  const dataCodewords = (v, ecl) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[ecl][v] * BLOCKS[ecl][v];
  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(deg) {
    const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }
  function alignPos(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6]; for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
    return out;
  }
  // bytes -> { size, dark(x, y) } or null when it does not fit (max 2953 bytes at level L)
  function qrEncode(bytes, ecl) {
    ecl = ecl || 'M';
    let v = 1;
    for (; v <= 40; v++) { const cc = v < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(v, ecl) * 8) break; }
    if (v > 40) { if (ecl === 'M') return qrEncode(bytes, 'L'); return null; }
    const cap = dataCodewords(v, ecl) * 8, bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    // blocks + error correction, interleaved
    const nb = BLOCKS[ecl][v], eccLen = ECC_PER_BLOCK[ecl][v], raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dl = shortLen - eccLen + (i < nShort ? 0 : 1), d = data.slice(k, k + dl); k += dl;
      blocks.push({ d, e: rsRemainder(d, div) });
    }
    const words = [];
    for (let i = 0; i <= shortLen - eccLen; i++) blocks.forEach(b => { if (i < b.d.length) words.push(b.d[i]); });
    for (let i = 0; i < eccLen; i++) blocks.forEach(b => words.push(b.e[i]));
    // the grid
    const size = v * 4 + 17, m = new Uint8Array(size * size), fn = new Uint8Array(size * size);
    const set = (x, y, d) => { m[y * size + x] = d ? 1 : 0; fn[y * size + x] = 1; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPos(v);
    ap.forEach((ax, i) => ap.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = mask => {
      const d = ECL_BITS[ecl] << 3 | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => (b >>> i) & 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, 1);
    };
    format(0);
    if (v >= 7) {
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = v << 12 | r;
      for (let i = 0; i < 18; i++) { const d = (b >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); }
    }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y * size + x] && i < words.length * 8) { m[y * size + x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && MASKS[k](x, y)) m[y * size + x] ^= 1; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let a = 0; a < 2; a++) for (let u = 0; u < size; u++) {
        let run = 0, prev = -1;
        for (let w = 0; w < size; w++) {
          const c = a ? m[w * size + u] : m[u * size + w];
          if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = c; }
        }
      }
      for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) { const c = m[y * size + x]; if (c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) p += 3; }
      for (let k = 0; k < m.length; k++) dark += m[k];
      return p + Math.floor(Math.abs(dark * 20 - m.length * 10) / m.length) * 10;
    };
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) { applyMask(k); format(k); const p = penalty(); if (p < bestP) { bestP = p; best = k; } applyMask(k); }
    applyMask(best); format(best);
    return { size, version: v, ecl, dark: (x, y) => m[y * size + x] === 1 };
  }
  function qrCanvas(text, px) {
    const q = qrEncode(Array.from(new TextEncoder().encode(text)));
    if (!q) return null;
    const quiet = 4, n = q.size + quiet * 2, s = px || Math.max(2, Math.floor(296 / n));
    const cv = document.createElement('canvas'); cv.width = cv.height = n * s; cv.className = 'qr';
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) g.fillRect((x + quiet) * s, (y + quiet) * s, s, s);
    return cv;
  }

  /* ---------------------------------------------------------------- the hub panel */
  let api = null;          // from the studio: see init()
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const urls = new Set();
  const blobUrl = b => { const u = URL.createObjectURL(b); urls.add(u); return u; };
  function freeUrls() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); api.toast('Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); api.toast('Copied'); } catch (e2) { api.toast('Copy it by hand'); } ta.remove(); }
  }
  async function copyImage(blob) {
    try {
      if (blob.type !== 'image/png') throw new Error('only photos');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); api.toast('Photo copied: paste it anywhere');
    } catch (e) { download(blob, 'bitkit.png'); api.toast('Downloaded it instead'); }
  }
  const KIND = { game: '🎮 Game', app: '🧰 Utility app', photo: '📷 Photo', clip: '🎞 Clip' };
  const KINDS = { game: '🎮 Games', app: '🧰 Utility apps', photo: '📷 Photos', clip: '🎞 Clips' };

  let tab = 'hub', hubCache = null, hubFilter = 'all';
  async function open(which) {
    if (which) tab = which;
    api.modal('Share hub', `<div class="hub-tabs seg" role="tablist">
        <button data-ht="hub">🌍 Hub</button><button data-ht="share">⇪ Share this game</button><button data-ht="caps">📷 My photos and clips</button>
      </div><div id="hubBody" class="hub-body"></div>`, [['Close', () => { freeUrls(); api.closeModal(); }]], 'hub-box');
    document.querySelectorAll('[data-ht]').forEach(b => { b.onclick = () => { tab = b.dataset.ht; show(); }; });
    show();
  }
  function show() {
    document.querySelectorAll('[data-ht]').forEach(b => b.classList.toggle('active', b.dataset.ht === tab));
    const body = document.getElementById('hubBody'); if (!body) return;
    freeUrls();
    ({ hub: showHub, share: showShare, caps: showCaps })[tab](body);
  }

  // --- the hub: what people posted
  async function fetchHub(fresh) {
    if (hubCache && !fresh) return hubCache;
    const r = await fetch(HUB_RAW + 'index.json' + (fresh ? '?t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' });
    if (r.status === 404) return (hubCache = { items: [] });
    if (!r.ok) throw new Error('the hub answered ' + r.status);
    return (hubCache = await r.json());
  }
  async function getCart(it) {
    const r = await fetch(HUB_RAW + it.cart); if (!r.ok) throw new Error('could not download it (' + r.status + ')');
    const t = await r.text(); try { return JSON.parse(t); } catch (e) { const c = await cartFromLink(t); if (c) return c; throw new Error('that is not a game'); }
  }
  // SITE#hub=12: the hub's post 12 (a short link that fits any QR code). Its game, or null when it has none.
  async function hubItem(id) {
    const idx = await fetchHub(true), it = (idx.items || []).find(x => String(x.id) === String(id));
    if (!it) throw new Error('that post is not in the hub (yet)');
    return it;
  }
  async function showHub(body, fresh) {
    body.innerHTML = `<div class="hub-bar"><div class="seg">${['all', 'game', 'app', 'photo', 'clip'].map(k => `<button data-hf="${k}" class="${hubFilter === k ? 'active' : ''}">${k === 'all' ? 'Everything' : KINDS[k]}</button>`).join('')}</div>
      <span class="grow"></span><a class="small" href="${SITE}hub.html" target="_blank" rel="noopener" title="The Share hub as a website, to browse and pass around">website ↗</a><button id="hubRefresh" class="tiny" title="Load the hub again">⟳</button></div><div id="hubGrid" class="hub-grid"><p class="dim">Loading the hub…</p></div>`;
    body.querySelectorAll('[data-hf]').forEach(b => { b.onclick = () => { hubFilter = b.dataset.hf; showHub(body); }; });
    document.getElementById('hubRefresh').onclick = () => showHub(body, true);
    const grid = document.getElementById('hubGrid');
    let idx;
    try { idx = await fetchHub(fresh); }
    catch (e) { grid.innerHTML = `<p class="dim">Could not reach the hub (${esc(e.message)}). You can still share games by link on the Share tab.</p>`; return; }
    const items = (idx.items || []).filter(it => hubFilter === 'all' || it.kind === hubFilter || (hubFilter === 'game' && it.cart && it.kind !== 'app'));
    if (!items.length) {
      grid.innerHTML = `<p class="dim">Nothing here yet. Be the first: open the <b>Share this game</b> tab and post your game, a photo or a clip.</p>`;
      return;
    }
    grid.innerHTML = items.map((it, i) => {
      const m = (it.media || [])[0];
      const pic = m ? (/\.(mp4|webm)$/i.test(m) ? `<video src="${esc(HUB_RAW + m)}" muted loop autoplay playsinline></video>` : `<img src="${esc(HUB_RAW + m)}" alt="" loading="lazy">`) : `<div class="hub-noimg">${KIND[it.kind] || '🎮'}</div>`;
      return `<div class="hub-card">${pic}<div class="hub-meta"><b>${esc(it.title)}</b><span class="dim small">${KIND[it.kind] || ''} by ${esc(it.author || 'someone')}</span>
        ${it.text ? `<span class="small hub-text">${esc(it.text)}</span>` : ''}
        <div class="hub-actions">${it.cart ? `<button class="tiny primary" data-play="${i}">▶ Play</button><button class="tiny" data-edit="${i}" title="Open it in the editor to see how it is made">✎ Open</button>` : ''}
        <button class="tiny" data-qr="${i}" title="A short link and QR code to this post">Link / QR</button>
        ${it.url ? `<a class="small" href="${esc(it.url)}" target="_blank" rel="noopener">comments</a>` : ''}</div></div></div>`;
    }).join('');
    grid.querySelectorAll('[data-qr]').forEach(b => {
      b.onclick = () => {
        const it = items[+b.dataset.qr], link = SITE + '#hub=' + it.id, card = b.closest('.hub-card');
        let box = card.querySelector('.hub-qr');
        if (box) { box.remove(); return; }
        box = document.createElement('div'); box.className = 'hub-qr';
        const cv = qrCanvas(link, 4); if (cv) box.appendChild(cv);
        const row = document.createElement('div'); row.className = 'hub-actions';
        row.innerHTML = `<input readonly class="share-link" value="${esc(link)}"><button class="tiny">Copy</button>`;
        row.querySelector('button').onclick = () => copyText(link);
        box.appendChild(row); card.appendChild(box);
      };
    });
    grid.querySelectorAll('[data-play],[data-edit]').forEach(b => {
      b.onclick = async () => {
        const it = items[+(b.dataset.play || b.dataset.edit)];
        try { const c = await getCart(it); freeUrls(); await api.openCart(c, b.dataset.play !== undefined); } catch (e) { api.toast('Could not open it: ' + e.message); }
      };
    });
  }

  // --- share the open game: link, QR, file, post to the hub
  async function showShare(body) {
    const cartObj = api.serialize(), name = cartObj.name || 'my game';
    body.innerHTML = `<p class="dim">Share <b>${esc(name)}</b>. A <b>play link</b> holds the whole game, so it works without any server: whoever opens it plays it in their browser and can open it in the studio.</p>
      <div class="share-row"><input id="shareLink" readonly class="share-link" value="Making the link…"><button id="shareCopy" class="primary">Copy link</button></div>
      <div class="share-cols"><div id="shareQr" class="share-qr"></div><div class="share-side">
        <p id="shareSize" class="dim small"></p>
        <button id="shareFile">⤓ Download ${esc(api.fileName())}</button>
        <h4>Post it to the hub</h4>
        <p class="dim small">Posting opens a short form on GitHub (a free account is needed). Your game goes in with the link. Add photos or a clip by dragging them into the form: they are in <b>My photos and clips</b>. After a quick look it shows up in the hub for everyone.</p>
        <label class="small"><input type="checkbox" id="shareApp"> It is a utility app (a tool, not a game)</label>
        <label class="small"><input type="checkbox" id="shareMine" checked> I made this and it may be shown in the BitKit hub</label>
        <button id="sharePost">Post to the hub…</button>
      </div></div>`;
    let link = '';
    try { link = await linkFor(cartObj); } catch (e) { document.getElementById('shareLink').value = 'Could not make a link: ' + e.message; return; }
    const input = document.getElementById('shareLink'); input.value = link;
    input.onclick = () => input.select();
    document.getElementById('shareCopy').onclick = () => copyText(link);
    document.getElementById('shareFile').onclick = () => download(new Blob([JSON.stringify(cartObj)], { type: 'application/json' }), api.fileName());
    const kb = (link.length / 1024).toFixed(1);
    const qr = qrCanvas(link);
    const q = document.getElementById('shareQr');
    if (qr) { q.appendChild(qr); document.getElementById('shareSize').textContent = `The link is ${kb} KB. Scan the code with a phone to play it there.`; }
    else { q.innerHTML = `<div class="share-noqr dim small">This game is too big for a QR code (a code holds about 2.9 KB, the link is ${kb} KB). Share the link, or post it to the hub: every post gets a short link with a QR code.</div>`; document.getElementById('shareSize').textContent = `The link is ${kb} KB.`; }
    document.getElementById('sharePost').onclick = () => {
      if (!document.getElementById('shareMine').checked) { api.toast('Only post games you made'); return; }
      postToHub({ kind: document.getElementById('shareApp').checked ? 'app' : 'game', title: name, link });
    };
  }

  // GitHub's new-issue page takes the form's fields in the address (up to about 8 KB). A longer link goes into a
  // small text file to drag into the form; the publisher finds a play link in either.
  function postToHub(p) {
    const q = new URLSearchParams({ template: 'share.yml', title: `[Share] ${p.title}`, labels: 'share', kind: { game: 'Game', app: 'Utility app', photo: 'Photo', clip: 'Clip' }[p.kind] || 'Game', name: p.title });
    let note = '';
    if (p.link) {
      if (p.link.length < 6000) q.set('link', p.link);
      else {
        download(new Blob([p.link + '\n'], { type: 'text/plain' }), (p.title || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.link.txt');
        note = 'The link is long, so it was downloaded as a .txt file: drag it into the "Game" box of the form.';
      }
    }
    window.open(ISSUE_URL + '?' + q.toString(), '_blank', 'noopener');
    if (note) api.toast(note);
  }

  // --- captures
  async function showCaps(body) {
    body.innerHTML = `<p class="dim small">Photos and clips you took, on the memory card (${esc(api.storeLabel())}, in <code>captures/</code>). Take them while playing: <b>📷</b> and <b>⏺</b> under the screen, F8 and F9, or on the Bit hold <b>Select</b> and press <b>L</b> (photo) or <b>R</b> (clip). With the memory card set to a PocketBit's SD card, its photos and clips show here too.</p>
      <div id="capGrid" class="hub-grid"><p class="dim">Loading…</p></div>`;
    let list = [];
    try { list = await BKStore.captures.list(); } catch (e) { /* none */ }
    const grid = document.getElementById('capGrid');
    if (!list.length) { grid.innerHTML = '<p class="dim">No photos or clips yet.</p>'; return; }
    grid.innerHTML = list.map((c, i) => `<div class="hub-card"><img src="${blobUrl(c.blob)}" alt=""><div class="hub-meta"><b>${esc(c.name)}</b>
      <span class="dim small">${(c.size / 1024).toFixed(0)} KB · ${new Date(c.t).toLocaleString()}</span>
      <div class="hub-actions"><button class="tiny" data-dl="${i}">⤓ Save</button>${/\.png$/i.test(c.name) ? `<button class="tiny" data-cp="${i}">Copy</button>` : ''}
      <button class="tiny" data-post="${i}" title="Save the file, then open the hub form to drag it into">Post…</button><button class="tiny" data-del="${i}">Delete</button></div></div></div>`).join('');
    const act = (sel, fn) => grid.querySelectorAll(sel).forEach(b => { b.onclick = () => fn(list[+b.getAttribute(sel.slice(1, -1))], b); });
    act('[data-dl]', c => download(c.blob, c.name));
    act('[data-cp]', c => copyImage(c.blob));
    act('[data-post]', c => { download(c.blob, c.name); postToHub({ kind: /\.gif$/i.test(c.name) ? 'clip' : 'photo', title: c.name.replace(/\.\w+$/, '') }); });
    act('[data-del]', async c => { if (await api.ask('Delete ' + c.name + '?', 'It is removed from the memory card.', 'Delete')) { await BKStore.captures.remove(c.name).catch(() => {}); open('caps'); } });
  }

  // studio: { modal, closeModal, ask, toast, serialize, fileName, openCart(cartObj, play), storeLabel }
  function init(studio) { api = studio; }
  return { init, open, hubItem, getCart, linkFor, cartFromLink, findPlay, packCart, unpackCart, qrEncode, qrCanvas, SITE, REPO, HUB_RAW, ISSUE_URL, KIND };
})();
