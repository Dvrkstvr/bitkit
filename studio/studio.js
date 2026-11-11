/* BitKit Studio. MIT License. */
'use strict';
(async function () {
  const APP = 'BitKit';
  const W = 320, H = 240, TILES = 512, MAPW = 256, MAPH = 128;
  const BTN = ['left', 'right', 'up', 'down', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'];
  const BTN_LABEL = ['Left', 'Right', 'Up', 'Down', 'A', 'B', 'X', 'Y', 'L', 'R', 'Start', 'Select'];
  const LS = { cart: 'bitkit.cart', pad: 'bitkit.padmap', settings: 'bitkit.settings' };

  const $ = id => document.getElementById(id);
  const toastEl = $('toast');
  let toastT = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1600); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  // carry over data saved before the rename (MiniBoi -> BitKit)
  ['cart', 'padmap', 'settings', 'settings.tab'].forEach(k => { const old = lsGet('miniboi.' + k); if (old !== null && lsGet('bitkit.' + k) === null) lsSet('bitkit.' + k, old); });

  /* ------------------------------------------------------------ console */
  const consoleEl = $('console');
  function log(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    consoleEl.appendChild(line);
    while (consoleEl.childNodes.length > 500) consoleEl.removeChild(consoleEl.firstChild);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  $('btnClear').onclick = () => { consoleEl.textContent = ''; };

  /* ------------------------------------------------------------ runtime */
  let onRuntimeError = () => {};
  const RT = await BitKitRuntime({
    onLog: (msg, isErr) => { if (isErr) { log(msg, 'err'); onRuntimeError(msg); } else log(msg); }
  });
  RT._bkw_init();
  const ptr = {
    pal: RT._bkw_palette(), tiles: RT._bkw_tiles(), flags: RT._bkw_flags(), map: RT._bkw_map(),
    press: RT._malloc(16), track: RT._bkw_track() >> 2, sys: RT._bkw_sys() >> 2, save: RT._bkw_save() >> 2
  };
  const DEFAULT_PAL = RT.HEAPU8.slice(ptr.pal, ptr.pal + 768);

  /* ------------------------------------------------------------ cart */
  const NEW_CODE = `-- my game
-- _init runs once, _update and _draw run 60 times a second

function _init()
  x, y = 152, 112
end

function _update()
  if btn("left") then x = x - 2 end
  if btn("right") then x = x + 2 end
  if btn("up") then y = y - 2 end
  if btn("down") then y = y + 2 end
  if btnp("a") then sfx("C5") end
end

function _draw()
  cls(1)
  rectfill(x, y, 16, 16, 17)
  text("hello world", 8, 8, 13)
  text("L " .. press("l") .. "  R " .. press("r"), 8, 20, 29)
end
`;
  const cart = {
    name: 'my game', code: NEW_CODE,
    palette: new Uint8Array(DEFAULT_PAL), tiles: new Uint8Array(TILES * 64),
    flags: new Uint8Array(TILES), map: new Uint16Array(MAPW * MAPH),
    entities: { types: [], placed: [] }
  };

  // levels: each has its own map and placed entities. cart.map / cart.entities.placed always point at the level being edited.
  function bindLevel(i) {
    const L = cart.levels[i];
    cart.level = i; cart.map = L.map; cart.entities.placed = L.placed;
  }
  function syncLevel() { const L = cart.levels[cart.level]; L.map = cart.map; L.placed = cart.entities.placed; }
  function normalizeLevels() {   // after cart.map / cart.entities were rebuilt (new cart, demo, file)
    if (!cart.levels || !cart.levels.length) cart.levels = [{ name: 'Level 1', w: MAPW, h: MAPH, map: cart.map, placed: cart.entities.placed }];
    bindLevel(0);
  }
  const levelsMeta = levels => levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed }));

  // byte RLE: [count, value] pairs (count 1..255) then base64
  function rle(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length;) {
      let n = 1; while (n < 255 && i + n < bytes.length && bytes[i + n] === bytes[i]) n++;
      out.push(n, bytes[i]); i += n;
    }
    return b64(new Uint8Array(out));
  }
  function unrle(str, len) {
    const src = unb64(str), out = new Uint8Array(len);
    let o = 0;
    for (let i = 0; i + 1 < src.length && o < len; i += 2) for (let k = 0; k < src[i] && o < len; k++) out[o++] = src[i + 1];
    return out;
  }
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  function serialize() {
    syncLevel();
    const L0 = cart.levels[0];
    const entities = Object.assign({}, cart.entities, { placed: L0.placed });
    return {
      format: 'bitkit-cart', version: 1, name: cart.name, code: getCode(),
      palette: b64(cart.palette), tiles: rle(cart.tiles), flags: rle(cart.flags),
      map: rle(new Uint8Array(L0.map.buffer.slice(0))),
      levels: cart.levels.map(L => ({ name: L.name, w: L.w, h: L.h, map: rle(new Uint8Array(L.map.buffer.slice(0))), placed: L.placed })),
      entities, entities_lua: BKEntities.toLua(entities, levelsMeta(cart.levels), 0)
    };
  }
  // decode a cart file object into a fresh cart (does not touch the editor)
  function decodeCart(o) {
    if (!o || (o.format !== 'bitkit-cart' && o.format !== 'miniboi-cart')) throw new Error('Not a ' + APP + ' cart file');
    const entities = o.entities && o.entities.types ? o.entities : { types: [], placed: [] };
    const unmap = str => new Uint16Array((str ? unrle(str, MAPW * MAPH * 2) : new Uint8Array(MAPW * MAPH * 2)).buffer);
    const map = unmap(o.map);
    const levels = Array.isArray(o.levels) && o.levels.length
      ? o.levels.map((L, i) => ({ name: L.name || `Level ${i + 1}`, w: Math.max(1, Math.min(MAPW, L.w | 0 || MAPW)), h: Math.max(1, Math.min(MAPH, L.h | 0 || MAPH)),
          map: unmap(L.map), placed: Array.isArray(L.placed) ? L.placed : [] }))
      : [{ name: 'Level 1', w: MAPW, h: MAPH, map, placed: entities.placed || [] }];
    entities.placed = levels[0].placed;
    return {
      name: o.name || 'untitled', code: o.code || '', levels,
      palette: o.palette ? unb64(o.palette).subarray(0, 768) : DEFAULT_PAL.slice(),
      tiles: o.tiles ? unrle(o.tiles, TILES * 64) : new Uint8Array(TILES * 64),
      flags: o.flags ? unrle(o.flags, TILES) : new Uint8Array(TILES),
      entities, map: levels[0].map
    };
  }
  function deserialize(o) {
    const c = decodeCart(o);
    cart.name = c.name; cart.code = c.code;
    cart.palette.set(c.palette); cart.tiles.set(c.tiles); cart.flags.set(c.flags);
    cart.entities = c.entities; cart.levels = c.levels;
    bindLevel(0);
  }

  let dirtySave = false;
  function markDirty() { dirtySave = true; }
  setInterval(() => { if (dirtySave) { saveLocal(); dirtySave = false; } }, 2000);
  function saveLocal() { lsSet(LS.cart, JSON.stringify(serialize())); }

  /* ------------------------------------------------------------ code editor */
  const API_NAMES = ['cls', 'pset', 'pget', 'line', 'rect', 'rectfill', 'circ', 'circfill', 'text', 'spr', 'map', 'mget', 'mset',
    'fget', 'fset', 'camera', 'clip', 'pal', 'palt', 'palette', 'btn', 'btnp', 'btnr', 'press', 't', 'time', 'rnd', 'srand',
    'sfx', 'tone', 'stop', 'print', '_init', '_update', '_draw', 'cutscene', 'cutscene_playing'];
  let cm = null, ta = null, errLine = null;
  if (window.CodeMirror) {
    // highlight the engine API on top of the lua mode
    CodeMirror.defineMode('bklua', (config) => {
      const base = CodeMirror.getMode(config, 'lua');
      const api = new Set(API_NAMES);
      return Object.assign({}, base, {
        token(stream, state) {
          const style = base.token(stream, state);
          if (style === 'variable' && api.has(stream.current())) return 'bk-api';
          return style;
        }
      });
    });
    cm = CodeMirror($('codeHost'), {
      value: cart.code, mode: 'bklua', lineNumbers: true, indentUnit: 2, tabSize: 2,
      matchBrackets: true, lineWrapping: false,
      extraKeys: {
        'Ctrl-Enter': () => run(), 'Cmd-Enter': () => run(),
        'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
        Tab: c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ', 'end')
      }
    });
    cm.on('change', () => { markDirty(); clearErrLine(); });
  } else {
    ta = document.createElement('textarea');
    ta.spellcheck = false; ta.value = cart.code;
    $('codeHost').appendChild(ta);
    ta.addEventListener('input', markDirty);
  }
  function getCode() { return cm ? cm.getValue() : ta.value; }
  function setCode(s) { if (cm) { cm.setValue(s); cm.clearHistory(); } else ta.value = s; }
  function clearErrLine() { if (cm && errLine !== null) { cm.removeLineClass(errLine, 'background', 'cm-error-line'); errLine = null; } }
  function showErrLine(msg) {
    const m = /cart:(\d+):/.exec(msg);
    if (!m || !cm) return;
    clearErrLine();
    errLine = parseInt(m[1], 10) - 1;
    cm.addLineClass(errLine, 'background', 'cm-error-line');
    cm.scrollIntoView({ line: errLine, ch: 0 }, 80);
  }

  /* ------------------------------------------------------------ tabs */
  let activeTab = 'code';
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  function showTab(t) {
    activeTab = t;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === 'tab-' + t));
    if (t === 'code' && cm) cm.refresh();
    if (t === 'sprites') drawSprites();
    if (t === 'map') { refreshLevels(); refreshEntSelect(); drawMap(); }
    if (t === 'entities') entEd.render();
    if (t === 'cutscenes') csEd.render();
    lsSet(LS.settings + '.tab', t);
  }

  /* ------------------------------------------------------------ tile atlas (for editors) */
  const atlas = document.createElement('canvas'); atlas.width = 128; atlas.height = 256;
  const atlasCtx = atlas.getContext('2d');
  const atlasImg = atlasCtx.createImageData(128, 256);
  let atlasDirty = true;
  function rebuildAtlas() {
    const d = atlasImg.data, p = cart.palette;
    for (let n = 0; n < TILES; n++) {
      const ox = (n % 16) * 8, oy = (n >> 4) * 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const c = cart.tiles[n * 64 + y * 8 + x], o = ((oy + y) * 128 + ox + x) * 4;
        d[o] = p[c * 3]; d[o + 1] = p[c * 3 + 1]; d[o + 2] = p[c * 3 + 2]; d[o + 3] = c === 0 ? 0 : 255;
      }
    }
    atlasCtx.putImageData(atlasImg, 0, 0);
    atlasDirty = false;
  }
  function gfxChanged() { atlasDirty = true; gfxDirtyRT = true; markDirty(); }

  /* ------------------------------------------------------------ undo */
  function makeHistory(get, set) {
    const undo = [];
    return {
      push() { undo.push(get().slice()); if (undo.length > 60) undo.shift(); },
      pop() { if (!undo.length) return toast('Nothing to undo'); set(undo.pop()); },
      clear() { undo.length = 0; }
    };
  }
  const tileHist = makeHistory(() => cart.tiles, v => { cart.tiles.set(v); gfxChanged(); drawSprites(); });
  const mapHist = makeHistory(() => cart.map, v => { cart.map.set(v); mapDirtyRT = true; markDirty(); drawMap(); });

  function getAtlas() { if (atlasDirty) rebuildAtlas(); return atlas; }
  function tileThumb(n, scale) {
    const c = document.createElement('canvas');
    c.width = c.height = 8 * scale;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(getAtlas(), (n % 16) * 8, (n >> 4) * 8, 8, 8, 0, 0, 8 * scale, 8 * scale);
    return c;
  }
  const entEd = BKEntities.init({
    cart, $, toast, escapeHtml, tileThumb, getAtlas,
    changed: markDirty, ask: (...a) => ask(...a), isActive: () => activeTab === 'entities'
  });
  const csEd = BKCutscenes.init({
    cart, $, toast, escapeHtml, changed: markDirty, ask: (...a) => ask(...a),
    levels: () => cart.levels,
    // run the game (on the cutscene's level, or the one open on the Map tab) and start the cutscene right away
    preview: (name, lvl) => run(typeof lvl === 'number' ? lvl : cart.level, `cutscene(${JSON.stringify(name)})\n`),
    placeOnMap: name => {
      showTab('map');
      mp.layer = 'ents'; $('mapLayer').value = 'ents'; $('mapEnt').hidden = false;
      mp.ent = name; refreshEntSelect(); drawMap();
    }
  });

  /* ------------------------------------------------------------ sprite editor */
  const spr = { tile: 1, size: 1, color: 13, tool: 'pen', clip: null };
  const sprEdit = $('sprEdit'), sprCtx = sprEdit.getContext('2d');
  const sheet = $('sheet'), sheetCtx = sheet.getContext('2d');
  const palC = $('palette'), palCtx = palC.getContext('2d');

  const flagsEl = $('sprFlags');
  for (let b = 0; b < 8; b++) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" data-bit="${b}">${b}`;
    flagsEl.appendChild(l);
  }
  flagsEl.addEventListener('change', e => {
    const b = +e.target.dataset.bit;
    if (e.target.checked) cart.flags[spr.tile] |= 1 << b; else cart.flags[spr.tile] &= ~(1 << b);
    gfxDirtyRT = true; markDirty();
  });

  function tilePix(px, py) { // pixel inside current selection -> index in tiles[]
    const t = spr.tile + (py >> 3) * 16 + (px >> 3);
    return t * 64 + (py & 7) * 8 + (px & 7);
  }
  function selValid(t, s) { return (t % 16) + s <= 16 && (t >> 4) + s <= 32; }

  function drawSprites() {
    if (atlasDirty) rebuildAtlas();
    // editor
    const n = spr.size * 8, z = sprEdit.width / n;
    sprCtx.clearRect(0, 0, sprEdit.width, sprEdit.height);
    const p = cart.palette;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = cart.tiles[tilePix(x, y)];
      if (c === 0) continue;
      sprCtx.fillStyle = `rgb(${p[c * 3]},${p[c * 3 + 1]},${p[c * 3 + 2]})`;
      sprCtx.fillRect(x * z, y * z, z, z);
    }
    sprCtx.strokeStyle = 'rgba(255,255,255,.08)'; sprCtx.lineWidth = 1;
    sprCtx.beginPath();
    for (let i = 1; i < n; i++) { sprCtx.moveTo(i * z + .5, 0); sprCtx.lineTo(i * z + .5, n * z); sprCtx.moveTo(0, i * z + .5); sprCtx.lineTo(n * z, i * z + .5); }
    sprCtx.stroke();
    if (spr.size > 1) {
      sprCtx.strokeStyle = 'rgba(255,255,255,.25)'; sprCtx.beginPath();
      for (let i = 8; i < n; i += 8) { sprCtx.moveTo(i * z + .5, 0); sprCtx.lineTo(i * z + .5, n * z); sprCtx.moveTo(0, i * z + .5); sprCtx.lineTo(n * z, i * z + .5); }
      sprCtx.stroke();
    }
    // sheet
    sheetCtx.imageSmoothingEnabled = false;
    sheetCtx.fillStyle = '#000'; sheetCtx.fillRect(0, 0, 256, 512);
    sheetCtx.drawImage(atlas, 0, 0, 256, 512);
    sheetCtx.strokeStyle = 'rgba(255,255,255,.06)';
    sheetCtx.beginPath();
    for (let i = 1; i < 16; i++) { sheetCtx.moveTo(i * 16 + .5, 0); sheetCtx.lineTo(i * 16 + .5, 512); }
    for (let i = 1; i < 32; i++) { sheetCtx.moveTo(0, i * 16 + .5); sheetCtx.lineTo(256, i * 16 + .5); }
    sheetCtx.stroke();
    sheetCtx.strokeStyle = '#ffd23f'; sheetCtx.lineWidth = 2;
    sheetCtx.strokeRect((spr.tile % 16) * 16 + 1, (spr.tile >> 4) * 16 + 1, spr.size * 16 - 2, spr.size * 16 - 2);
    sheetCtx.lineWidth = 1;
    // info
    $('sprInfo').textContent = `Tile ${spr.tile}`;
    $('sprHint').textContent = spr.size === 1 ? `spr(${spr.tile}, x, y)` : `spr(${spr.tile}, x, y, ${spr.size}, ${spr.size})`;
    flagsEl.querySelectorAll('input').forEach(i => { i.checked = (cart.flags[spr.tile] >> +i.dataset.bit) & 1; });
    drawPalette();
  }

  function drawPalette() {
    const p = cart.palette;
    for (let i = 0; i < 256; i++) {
      const x = (i % 16) * 18, y = (i >> 4) * 18;
      palCtx.fillStyle = `rgb(${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]})`;
      palCtx.fillRect(x, y, 18, 18);
    }
    // mark colour 0 as transparent
    palCtx.strokeStyle = '#ff6b5e'; palCtx.beginPath(); palCtx.moveTo(2, 16); palCtx.lineTo(16, 2); palCtx.stroke();
    const sx = (spr.color % 16) * 18, sy = (spr.color >> 4) * 18;
    palCtx.strokeStyle = '#fff'; palCtx.lineWidth = 2; palCtx.strokeRect(sx + 1, sy + 1, 16, 16);
    palCtx.strokeStyle = '#000'; palCtx.lineWidth = 1; palCtx.strokeRect(sx + 3.5, sy + 3.5, 11, 11);
    const c = spr.color;
    const hex = '#' + [0, 1, 2].map(k => p[c * 3 + k].toString(16).padStart(2, '0')).join('');
    $('colInfo').textContent = `${c}${c === 0 ? ' (transparent)' : ''} ${hex}`;
    $('colEdit').value = hex;
  }

  palC.addEventListener('mousedown', e => {
    const r = palC.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * 16), y = Math.floor((e.clientY - r.top) / r.height * 16);
    spr.color = Math.max(0, Math.min(255, y * 16 + x));
    drawPalette();
  });
  $('colEdit').addEventListener('input', e => {
    const v = e.target.value, c = spr.color;
    cart.palette[c * 3] = parseInt(v.slice(1, 3), 16); cart.palette[c * 3 + 1] = parseInt(v.slice(3, 5), 16); cart.palette[c * 3 + 2] = parseInt(v.slice(5, 7), 16);
    gfxChanged(); drawSprites();
  });
  $('palReset').onclick = () => { cart.palette.set(DEFAULT_PAL); gfxChanged(); drawSprites(); };

  sheet.addEventListener('mousedown', e => {
    const r = sheet.getBoundingClientRect();
    let tx = Math.floor((e.clientX - r.left) / r.width * 16), ty = Math.floor((e.clientY - r.top) / r.height * 32);
    tx = Math.min(tx, 16 - spr.size); ty = Math.min(ty, 32 - spr.size);
    spr.tile = ty * 16 + tx;
    drawSprites();
  });
  $('sprSize').addEventListener('change', e => {
    spr.size = +e.target.value;
    if (!selValid(spr.tile, spr.size)) spr.tile = Math.min(spr.tile % 16, 16 - spr.size) + Math.min(spr.tile >> 4, 32 - spr.size) * 16;
    drawSprites();
  });
  document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  function setTool(t) { spr.tool = t; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t)); }

  let painting = false;
  function sprPos(e) {
    const r = sprEdit.getBoundingClientRect(), n = spr.size * 8;
    return [Math.floor((e.clientX - r.left) / r.width * n), Math.floor((e.clientY - r.top) / r.height * n)];
  }
  function sprApply(e, first) {
    const [x, y] = sprPos(e), n = spr.size * 8;
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const col = e.buttons & 2 || e.button === 2 ? 0 : spr.color;
    if (spr.tool === 'pick' || e.altKey) { spr.color = cart.tiles[tilePix(x, y)]; drawPalette(); return; }
    if (first) tileHist.push();
    if (spr.tool === 'fill') {
      if (!first) return;
      const target = cart.tiles[tilePix(x, y)];
      if (target === col) return;
      const st = [[x, y]];
      while (st.length) {
        const [cx, cy] = st.pop();
        if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
        const i = tilePix(cx, cy);
        if (cart.tiles[i] !== target) continue;
        cart.tiles[i] = col;
        st.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    } else {
      cart.tiles[tilePix(x, y)] = col;
    }
    gfxChanged(); drawSprites();
  }
  sprEdit.addEventListener('contextmenu', e => e.preventDefault());
  sprEdit.addEventListener('mousedown', e => { painting = true; sprApply(e, true); });
  sprEdit.addEventListener('mousemove', e => { if (painting && e.buttons) sprApply(e, false); });
  window.addEventListener('mouseup', () => { painting = false; mapPainting = false; mapPanning = null; });

  function selPixels() { const n = spr.size * 8, a = new Uint8Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = cart.tiles[tilePix(x, y)]; return a; }
  function putPixels(a, n) { tileHist.push(); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cart.tiles[tilePix(x, y)] = a[y * n + x]; gfxChanged(); drawSprites(); }
  $('sprFlipH').onclick = () => { const n = spr.size * 8, a = selPixels(), b = new Uint8Array(a.length); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y * n + x] = a[y * n + n - 1 - x]; putPixels(b, n); };
  $('sprFlipV').onclick = () => { const n = spr.size * 8, a = selPixels(), b = new Uint8Array(a.length); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[y * n + x] = a[(n - 1 - y) * n + x]; putPixels(b, n); };
  $('sprRot').onclick = () => { const n = spr.size * 8, a = selPixels(), b = new Uint8Array(a.length); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b[x * n + (n - 1 - y)] = a[y * n + x]; putPixels(b, n); };
  $('sprClear').onclick = () => putPixels(new Uint8Array(spr.size * spr.size * 64), spr.size * 8);
  $('sprCopy').onclick = () => { spr.clip = { n: spr.size * 8, a: selPixels() }; toast('Copied'); };
  $('sprPaste').onclick = () => {
    if (!spr.clip) return toast('Nothing copied');
    const n = spr.size * 8, b = selPixels();
    for (let y = 0; y < Math.min(n, spr.clip.n); y++) for (let x = 0; x < Math.min(n, spr.clip.n); x++) b[y * n + x] = spr.clip.a[y * spr.clip.n + x];
    putPixels(b, n);
  };
  $('sprUndo').onclick = () => tileHist.pop();

  /* ------------------------------------------------------------ map editor */
  const mv = $('mapView'), mvCtx = mv.getContext('2d');
  const mapSheet = $('mapSheet'), msCtx = mapSheet.getContext('2d');
  const mp = { x: 0, y: 0, zoom: 2, tile: 1, tool: 'paint', grid: true, hover: null, layer: 'tiles', ent: '' };
  let mapPainting = false, mapPanning = null;

  function mapViewTiles() { return [Math.ceil(mv.width / (8 * mp.zoom)), Math.ceil(mv.height / (8 * mp.zoom))]; }
  function drawMap() {
    if (atlasDirty) rebuildAtlas();
    const [vw, vh] = mapViewTiles(), s = 8 * mp.zoom;
    mvCtx.imageSmoothingEnabled = false;
    mvCtx.fillStyle = '#0a0a12'; mvCtx.fillRect(0, 0, mv.width, mv.height);
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
      const mx = mp.x + i, my = mp.y + j;
      if (mx >= MAPW || my >= MAPH) continue;
      const t = cart.map[my * MAPW + mx];
      if (t) mvCtx.drawImage(atlas, (t % 16) * 8, (t >> 4) * 8, 8, 8, i * s, j * s, s, s);
    }
    if (mp.grid) {
      mvCtx.strokeStyle = 'rgba(255,255,255,.05)'; mvCtx.beginPath();
      for (let i = 1; i < vw; i++) { mvCtx.moveTo(i * s + .5, 0); mvCtx.lineTo(i * s + .5, mv.height); }
      for (let j = 1; j < vh; j++) { mvCtx.moveTo(0, j * s + .5); mvCtx.lineTo(mv.width, j * s + .5); }
      mvCtx.stroke();
    }
    // outside this level's size: shaded (the world ends there for entities and the camera)
    const L = cart.levels[cart.level];
    if (L && (L.w < MAPW || L.h < MAPH)) {
      const ex = (L.w - mp.x) * s, ey = (L.h - mp.y) * s;
      mvCtx.fillStyle = 'rgba(5,5,12,.6)';
      if (ex < mv.width) mvCtx.fillRect(Math.max(0, ex), 0, mv.width, mv.height);
      if (ey < mv.height) mvCtx.fillRect(0, Math.max(0, ey), Math.max(0, Math.min(ex, mv.width)), mv.height);
      mvCtx.strokeStyle = 'rgba(138,211,90,.8)'; mvCtx.lineWidth = 2;
      mvCtx.strokeRect(-mp.x * s, -mp.y * s, L.w * s, L.h * s); mvCtx.lineWidth = 1;
    }
    // screen boundaries every 40x30 tiles, and the map edge
    mvCtx.setLineDash([6, 4]); mvCtx.strokeStyle = 'rgba(255,210,63,.5)'; mvCtx.beginPath();
    for (let i = 0; i <= vw; i++) if ((mp.x + i) % 40 === 0) { mvCtx.moveTo(i * s + .5, 0); mvCtx.lineTo(i * s + .5, mv.height); }
    for (let j = 0; j <= vh; j++) if ((mp.y + j) % 30 === 0) { mvCtx.moveTo(0, j * s + .5); mvCtx.lineTo(mv.width, j * s + .5); }
    mvCtx.stroke(); mvCtx.setLineDash([]);
    // placed entities
    const pz = mp.zoom;
    cart.entities.placed.forEach(pl => {
      const t = cart.entities.types.find(x => x.name === pl.type); if (!t) return;
      const a = t.anims.find(q => q.name === 'idle' && q.frames.length) || t.anims.find(q => q.frames.length);
      const sx = (pl.x - mp.x * 8) * pz, sy = (pl.y - mp.y * 8) * pz;
      if (sx < -64 || sy < -64 || sx > mv.width || sy > mv.height) return;
      mvCtx.globalAlpha = mp.layer === 'ents' ? 1 : .7;
      if (a) for (let j = 0; j < t.sh; j++) for (let i = 0; i < t.sw; i++) {
        const n = a.frames[0] + j * 16 + i;
        const fl = t.left;
        mvCtx.drawImage(atlas, (n % 16) * 8, (n >> 4) * 8, 8, 8, sx + (fl ? t.sw - 1 - i : i) * 8 * pz, sy + j * 8 * pz, 8 * pz, 8 * pz);
      }
      mvCtx.globalAlpha = 1;
      if (mp.layer === 'ents' || !a || t.hidden) {
        mvCtx.strokeStyle = t.hidden ? 'rgba(110,195,240,.9)' : 'rgba(255,107,94,.8)';
        mvCtx.strokeRect(sx + .5, sy + .5, t.sw * 8 * pz - 1, t.sh * 8 * pz - 1);
        if (mp.zoom > 1) { mvCtx.fillStyle = '#fff'; mvCtx.font = '10px system-ui'; mvCtx.fillText(pl.type, sx, sy - 2); }
      }
    });
    if (route.show) drawRoute();
    if (mp.hover && mp.layer === 'ents') {
      const [hx, hy] = mp.hover, s2 = 8 * mp.zoom;
      mvCtx.strokeStyle = '#fff'; mvCtx.strokeRect((hx - mp.x) * s2 + .5, (hy - mp.y) * s2 + .5, s2 - 1, s2 - 1);
      $('mapPos').textContent = `x ${hx * 8}, y ${hy * 8} px  (tile ${hx}, ${hy})`;
    } else if (mp.hover) {
      const [hx, hy] = mp.hover;
      mvCtx.globalAlpha = .6;
      mvCtx.drawImage(atlas, (mp.tile % 16) * 8, (mp.tile >> 4) * 8, 8, 8, (hx - mp.x) * s, (hy - mp.y) * s, s, s);
      mvCtx.globalAlpha = 1;
      mvCtx.strokeStyle = '#fff'; mvCtx.strokeRect((hx - mp.x) * s + .5, (hy - mp.y) * s + .5, s - 1, s - 1);
      $('mapPos').textContent = `x ${hx}, y ${hy}  tile ${cart.map[hy * MAPW + hx]}  (view ${mp.x},${mp.y})`;
    } else $('mapPos').textContent = `view ${mp.x},${mp.y}`;
    // picker
    msCtx.imageSmoothingEnabled = false;
    msCtx.fillStyle = '#000'; msCtx.fillRect(0, 0, 256, 512);
    msCtx.drawImage(atlas, 0, 0, 256, 512);
    msCtx.strokeStyle = '#ffd23f'; msCtx.lineWidth = 2;
    msCtx.strokeRect((mp.tile % 16) * 16 + 1, (mp.tile >> 4) * 16 + 1, 14, 14); msCtx.lineWidth = 1;
    $('mapTileInfo').textContent = mp.tile + (mp.tile === 0 ? ' (empty)' : '');
  }
  function drawRoute() {
    const z = mp.zoom, ox = mp.x * 8, oy = mp.y * 8;
    const runs = route.runs.filter(r => (r.level || 0) === cart.level).slice(-3);
    runs.forEach((pts, ri) => {
      const newest = ri === runs.length - 1;
      const col = newest ? '255,210,63' : '110,195,240';
      const alpha = newest ? .9 : .35;
      mvCtx.lineWidth = newest ? 2 : 1.5;
      mvCtx.strokeStyle = `rgba(${col},${alpha})`;
      mvCtx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const x = (pts[i] - ox) * z, y = (pts[i + 1] - oy) * z;
        const jump = i > 0 && (Math.abs(pts[i] - pts[i - 2]) > 24 || Math.abs(pts[i + 1] - pts[i - 1]) > 24);
        if (i === 0 || jump) mvCtx.moveTo(x, y); else mvCtx.lineTo(x, y);
      }
      mvCtx.stroke();
      // a dot every quarter second: wide spacing = fast, tight = slow
      mvCtx.fillStyle = `rgba(${col},${alpha})`;
      for (let i = 0; i < pts.length; i += 30) mvCtx.fillRect((pts[i] - ox) * z - z, (pts[i + 1] - oy) * z - z, 2 * z, 2 * z);
    });
    mvCtx.lineWidth = 1;
  }
  function mapPos(e) {
    const r = mv.getBoundingClientRect(), s = 8 * mp.zoom;
    const x = Math.floor((e.clientX - r.left) / r.width * mv.width / s) + mp.x;
    const y = Math.floor((e.clientY - r.top) / r.height * mv.height / s) + mp.y;
    return x >= 0 && y >= 0 && x < MAPW && y < MAPH ? [x, y] : null;
  }
  function entAt(px, py) {
    for (let i = cart.entities.placed.length - 1; i >= 0; i--) {
      const pl = cart.entities.placed[i], t = cart.entities.types.find(x => x.name === pl.type);
      const w = (t ? t.sw : 1) * 8, h = (t ? t.sh : 1) * 8;
      if (px >= pl.x && py >= pl.y && px < pl.x + w && py < pl.y + h) return i;
    }
    return -1;
  }
  function mapApply(e, first) {
    const p = mapPos(e); if (!p) return;
    const [x, y] = p;
    if (mp.layer === 'ents') {
      if (!first) return;
      const px = x * 8 + 4, py = y * 8 + 4, hit = entAt(px, py);
      if (e.button === 2 || e.buttons & 2) { if (hit >= 0) cart.entities.placed.splice(hit, 1); }
      else if (hit >= 0 && (mp.tool === 'pick' || e.altKey)) { mp.ent = cart.entities.placed[hit].type; $('mapEnt').value = mp.ent; }
      else if (hit < 0) {
        const t = cart.entities.types.find(q => q.name === mp.ent);
        if (!t) return toast('Make an entity on the Entities tab first');
        cart.entities.placed.push({ type: t.name, x: x * 8, y: (y - t.sh + 1) * 8 });
      }
      markDirty(); drawMap();
      return;
    }
    if (mp.tool === 'pick' || e.altKey) { mp.tile = cart.map[y * MAPW + x]; drawMap(); return; }
    const t = (e.buttons & 2 || e.button === 2) ? 0 : mp.tile;
    if (first) mapHist.push();
    if (mp.tool === 'fill') {
      if (!first) return;
      const target = cart.map[y * MAPW + x];
      if (target === t) return;
      const [vw, vh] = mapViewTiles();
      const st = [[x, y]];
      while (st.length) { // fill limited to the visible area so it never floods the whole map by accident
        const [cx, cy] = st.pop();
        if (cx < mp.x || cy < mp.y || cx >= Math.min(MAPW, mp.x + vw) || cy >= Math.min(MAPH, mp.y + vh)) continue;
        if (cart.map[cy * MAPW + cx] !== target) continue;
        cart.map[cy * MAPW + cx] = t;
        st.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    } else cart.map[y * MAPW + x] = t;
    mapDirtyRT = true; markDirty(); drawMap();
  }
  mv.addEventListener('contextmenu', e => e.preventDefault());
  mv.addEventListener('mousedown', e => {
    mv.focus();
    if (e.button === 1) { mapPanning = { x: e.clientX, y: e.clientY, mx: mp.x, my: mp.y }; e.preventDefault(); return; }
    mapPainting = true; mapApply(e, true);
  });
  mv.addEventListener('mousemove', e => {
    if (mapPanning) {
      const r = mv.getBoundingClientRect(), s = 8 * mp.zoom * r.width / mv.width;
      panMap(mapPanning.mx - Math.round((e.clientX - mapPanning.x) / s) - mp.x, mapPanning.my - Math.round((e.clientY - mapPanning.y) / s) - mp.y);
      return;
    }
    mp.hover = mapPos(e);
    if (mapPainting && e.buttons) mapApply(e, false); else drawMap();
  });
  mv.addEventListener('mouseleave', () => { mp.hover = null; drawMap(); });
  mv.addEventListener('wheel', e => { e.preventDefault(); panMap(Math.sign(e.shiftKey ? e.deltaY : e.deltaX) * 2, e.shiftKey ? 0 : Math.sign(e.deltaY) * 2); }, { passive: false });
  function panMap(dx, dy) {
    const [vw, vh] = mapViewTiles();
    mp.x = Math.max(0, Math.min(MAPW - vw, mp.x + dx));
    mp.y = Math.max(0, Math.min(MAPH - vh, mp.y + dy));
    drawMap();
  }
  mv.addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), st = e.shiftKey ? 10 : 2;
    const d = { arrowleft: [-st, 0], a: [-st, 0], arrowright: [st, 0], d: [st, 0], arrowup: [0, -st], w: [0, -st], arrowdown: [0, st], s: [0, st] }[k];
    if (d && !e.ctrlKey && !e.metaKey) { panMap(d[0], d[1]); e.preventDefault(); }
  });
  mapSheet.addEventListener('mousedown', e => {
    const r = mapSheet.getBoundingClientRect();
    mp.tile = Math.floor((e.clientY - r.top) / r.height * 32) * 16 + Math.floor((e.clientX - r.left) / r.width * 16);
    if (mp.tool === 'pick') setMapTool('paint');
    drawMap();
  });
  document.querySelectorAll('.mtool').forEach(b => b.onclick = () => setMapTool(b.dataset.mtool));
  function setMapTool(t) { mp.tool = t; document.querySelectorAll('.mtool').forEach(b => b.classList.toggle('active', b.dataset.mtool === t)); }
  // ---- levels
  function refreshLevels() {
    $('mapLevel').innerHTML = cart.levels.map((L, i) => `<option value="${i}"${i === cart.level ? ' selected' : ''}>${i + 1}. ${escapeHtml(L.name)}</option>`).join('');
    $('mapPlayLevel').title = `Run the game starting on ${cart.levels[cart.level].name}`;
  }
  function switchLevel(i) {
    syncLevel(); bindLevel(i); mapHist.clear();
    mp.x = 0; mp.y = 0;
    refreshLevels(); drawMap(); markDirty();
  }
  $('mapLevel').onchange = e => switchLevel(+e.target.value);
  $('mapLevelAdd').onclick = () => {
    syncLevel();
    const cur = cart.levels[cart.level];
    cart.levels.push({ name: `Level ${cart.levels.length + 1}`, w: cur.w, h: cur.h, map: new Uint16Array(MAPW * MAPH), placed: [] });
    switchLevel(cart.levels.length - 1);
    toast(`Added ${cart.levels[cart.level].name}`);
  };
  $('mapPlayLevel').onclick = () => run(cart.level);
  $('mapLevelEdit').onclick = () => {
    const L = cart.levels[cart.level], n = cart.levels.length;
    modal(`Level ${cart.level + 1} settings`, `<div class="prop-grid">
        <span>Name</span><span><input id="lvName" value="${escapeHtml(L.name)}" spellcheck="false"></span>
        <span>Size</span><span><input id="lvW" type="number" min="1" max="${MAPW}" value="${L.w}"> × <input id="lvH" type="number" min="1" max="${MAPH}" value="${L.h}"> tiles <span class="hint">(${MAPW}×${MAPH} max, one screen is 40×30)</span></span>
      </div>
      <p class="hint">In code, <code>level(n)</code> switches levels and <code>LEVEL</code> is the current one. The <b>Go to level</b> behavior step (or the <b>Exit</b> preset) does it from an entity.</p>`, [
      ...(n > 1 ? [['Delete level', async () => {
        if (!await ask(`Delete "${L.name}"?`, 'Its map and the entities placed on it are removed.', 'Delete')) return;
        cart.levels.splice(cart.level, 1); bindLevel(Math.min(cart.level, cart.levels.length - 1)); mapHist.clear();
        refreshLevels(); drawMap(); markDirty();
      }]] : []),
      ...(cart.level > 0 ? [['Move up', () => { const i = cart.level; syncLevel(); [cart.levels[i - 1], cart.levels[i]] = [cart.levels[i], cart.levels[i - 1]]; bindLevel(i - 1); refreshLevels(); markDirty(); closeModal(); }]] : []),
      ['Duplicate', () => {
        syncLevel();
        cart.levels.splice(cart.level + 1, 0, { name: L.name + ' copy', w: L.w, h: L.h, map: L.map.slice(), placed: L.placed.map(p => Object.assign({}, p)) });
        closeModal(); switchLevel(cart.level + 1);
      }],
      ['Save', () => {
        L.name = $('lvName').value.trim() || L.name;
        L.w = Math.max(1, Math.min(MAPW, Math.round(+$('lvW').value) || L.w));
        L.h = Math.max(1, Math.min(MAPH, Math.round(+$('lvH').value) || L.h));
        refreshLevels(); drawMap(); markDirty(); closeModal();
      }, 'primary'],
      ['Cancel', closeModal]]);
  };

  function refreshEntSelect() {
    const sel = $('mapEnt'), types = cart.entities.types;
    if (!types.some(t => t.name === mp.ent)) mp.ent = types.length ? types[0].name : '';
    sel.innerHTML = types.length ? types.map(t => `<option${t.name === mp.ent ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('') : '<option value="">(no entities yet)</option>';
  }
  $('mapLayer').onchange = e => {
    mp.layer = e.target.value;
    $('mapEnt').hidden = mp.layer !== 'ents';
    refreshEntSelect(); drawMap();
  };
  $('mapEnt').onchange = e => { mp.ent = e.target.value; };
  $('mapZoom').onchange = e => { mp.zoom = +e.target.value; panMap(0, 0); };
  $('mapGrid').onchange = e => { mp.grid = e.target.checked; drawMap(); };
  $('mapUndo').onclick = () => mapHist.pop();
  $('mapRoute').onchange = e => { route.show = e.target.checked; drawMap(); };
  $('mapRouteClear').onclick = () => { route.runs = []; route.cur = null; drawMap(); };

  // editor shortcuts
  window.addEventListener('keydown', e => {
    const inText = e.target.closest && (e.target.closest('.CodeMirror') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName));
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); saveLocal();
      if (cartFile) saveToBit(false); else toast('Saved in this browser');
      return;
    }
    if (inText || e.target === screen) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (activeTab === 'sprites') { tileHist.pop(); e.preventDefault(); }
      if (activeTab === 'map') { mapHist.pop(); e.preventDefault(); }
      return;
    }
    if (activeTab === 'sprites') { const t = { p: 'pen', f: 'fill', i: 'pick' }[e.key.toLowerCase()]; if (t) setTool(t); }
    if (activeTab === 'map' && e.target !== mv) { const t = { p: 'paint', f: 'fill', i: 'pick' }[e.key.toLowerCase()]; if (t) setMapTool(t); }
  });

  /* ------------------------------------------------------------ input */
  const DEFAULT_PADMAP = {
    left: [['b', 14], ['a', 0, -1]], right: [['b', 15], ['a', 0, 1]],
    up: [['b', 12], ['a', 1, -1]], down: [['b', 13], ['a', 1, 1]],
    a: [['b', 0]], b: [['b', 1]], x: [['b', 2]], y: [['b', 3]],
    l: [['b', 4], ['b', 6]], r: [['b', 5], ['b', 7]], start: [['b', 9]], select: [['b', 8]]
  };
  const KEYMAP = {
    ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, KeyZ: 4, KeyX: 5, KeyA: 6, KeyS: 7,
    KeyQ: 8, KeyW: 9, Enter: 10, ShiftLeft: 11, ShiftRight: 11
  };
  const KEY_LABEL = ['←', '→', '↑', '↓', 'Z', 'X', 'A', 'S', 'Q', 'W', 'Enter', 'Shift'];
  let padmap = JSON.parse(JSON.stringify(DEFAULT_PADMAP));
  const settings = { thresh: 64, dead: 25, muted: false };
  try { Object.assign(padmap, JSON.parse(lsGet(LS.pad) || '{}')); } catch (e) { /* ignore */ }
  try { Object.assign(settings, JSON.parse(lsGet(LS.settings) || '{}')); } catch (e) { /* ignore */ }
  function saveSettings() { lsSet(LS.settings, JSON.stringify(settings)); }

  const keys = new Uint8Array(12);
  const input = { mask: 0, press: new Uint8Array(12), pads: [] };
  const screen = $('screen');
  function gameHasFocus() { const a = document.activeElement; return a === screen || a === document.body || a === null; }
  window.addEventListener('keydown', e => {
    const i = KEYMAP[e.code];
    if (i === undefined || !gameHasFocus() || e.ctrlKey || e.metaKey || e.altKey) return;
    keys[i] = 1; e.preventDefault();
  });
  window.addEventListener('keyup', e => { const i = KEYMAP[e.code]; if (i !== undefined) keys[i] = 0; });
  window.addEventListener('blur', () => keys.fill(0));

  function srcValue(pad, s) {
    if (s[0] === 'b') { const b = pad.buttons[s[1]]; return b ? (b.value || (b.pressed ? 1 : 0)) : 0; }
    const v = (pad.axes[s[1]] || 0) * s[2], dz = settings.dead / 100;
    return v <= dz ? 0 : Math.min(1, (v - dz) / (1 - dz));
  }
  function pollInput() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    input.pads = pads;
    let mask = 0;
    for (let i = 0; i < 12; i++) {
      let v = keys[i] ? 1 : 0;
      for (const pad of pads) for (const s of padmap[BTN[i]] || []) v = Math.max(v, srcValue(pad, s));
      const p = Math.round(v * 255);
      input.press[i] = p;
      if (p >= settings.thresh || keys[i]) mask |= 1 << i;
    }
    input.mask = mask;
  }

  // controller tab UI
  const rows = $('btnRows'), rowEls = [];
  let listening = -1, listenBase = null;
  BTN.forEach((b, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${BTN_LABEL[i]}</b> <span class="dim">"${b}"</span></td><td><span class="dot"></span></td>
      <td><span class="bar"><i></i></span> <span class="pv">0</span></td><td class="dim">${KEY_LABEL[i]}</td>
      <td class="binding"></td><td><button class="tiny">bind</button></td>`;
    tr.querySelector('button').onclick = () => startListen(i);
    rows.appendChild(tr);
    rowEls.push({ dot: tr.querySelector('.dot'), bar: tr.querySelector('.bar i'), pv: tr.querySelector('.pv'), bind: tr.querySelector('.binding'), btn: tr.querySelector('button') });
  });
  function bindText(list) { return (list || []).map(s => s[0] === 'b' ? `button ${s[1]}` : `axis ${s[1]}${s[2] > 0 ? '+' : '-'}`).join(', ') || 'none'; }
  function refreshBindings() { rowEls.forEach((r, i) => { r.bind.textContent = bindText(padmap[BTN[i]]); r.btn.classList.toggle('listening', listening === i); r.btn.textContent = listening === i ? 'press…' : 'bind'; }); }
  function startListen(i) {
    if (!input.pads.length) return toast('Connect a controller and press any button first');
    listening = i;
    const pad = input.pads[0];
    listenBase = { axes: pad.axes.slice(), buttons: pad.buttons.map(b => b.value) };
    refreshBindings();
  }
  function checkListen() {
    if (listening < 0 || !input.pads.length) return;
    const pad = input.pads[0];
    let found = null;
    pad.buttons.forEach((b, j) => { if (!found && b.value > .6 && listenBase.buttons[j] < .3) found = ['b', j]; });
    pad.axes.forEach((a, j) => { if (!found && Math.abs(a - listenBase.axes[j]) > .6) found = ['a', j, a > listenBase.axes[j] ? 1 : -1]; });
    if (found) {
      padmap[BTN[listening]] = [found];
      lsSet(LS.pad, JSON.stringify(padmap));
      toast(`${BTN_LABEL[listening]} → ${bindText([found])}`);
      listening = -1; refreshBindings();
    }
  }
  $('padReset').onclick = () => { padmap = JSON.parse(JSON.stringify(DEFAULT_PADMAP)); lsSet(LS.pad, JSON.stringify(padmap)); refreshBindings(); toast('Mapping reset'); };
  const thr = $('padThresh'), dead = $('padDead');
  thr.value = settings.thresh; dead.value = settings.dead;
  function showSliders() { $('padThreshVal').textContent = settings.thresh; $('padDeadVal').textContent = settings.dead + '%'; }
  thr.oninput = () => { settings.thresh = +thr.value; showSliders(); saveSettings(); };
  dead.oninput = () => { settings.dead = +dead.value; showSliders(); saveSettings(); };
  showSliders(); refreshBindings();

  let lastPadSig = '';
  function updateInputUI() {
    const pads = input.pads;
    const sig = pads.map(p => p.id + p.mapping).join('|');
    if (sig !== lastPadSig) {
      lastPadSig = sig;
      const st = $('padStatus');
      if (pads.length) { st.textContent = `Controller: ${pads[0].id.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 40)}${pads.length > 1 ? ` +${pads.length - 1}` : ''}`; st.classList.add('on'); }
      else { st.textContent = 'No controller (press any button on it)'; st.classList.remove('on'); }
      $('padList').innerHTML = pads.length ? pads.map(p => `<div class="pad-card"><b>${escapeHtml(p.id)}</b><br><span class="dim">${p.buttons.length} buttons, ${p.axes.length} axes, mapping: ${p.mapping || 'none'}</span>${p.mapping !== 'standard' ? '<br><span class="warn">This controller has no standard mapping in this browser. Use "bind" below to set each button.</span>' : ''}</div>`).join('')
        : '<div class="pad-card">No controller found. Plug one in (or pair it) and <b>press any button</b>, browsers only show controllers after a press. Keyboard works too: arrows, Z=A, X=B, A=X, S=Y, Q=L, W=R, Enter=Start, Shift=Select.</div>';
    }
    if (activeTab !== 'input') return;
    rowEls.forEach((r, i) => {
      r.dot.classList.toggle('on', !!(input.mask >> i & 1));
      r.bar.style.width = (input.press[i] / 255 * 100) + '%';
      r.pv.textContent = input.press[i];
    });
    $('padRaw').textContent = pads.map(p => `${p.id}\naxes: ${p.axes.map(a => a.toFixed(2)).join('  ')}\nbuttons: ${p.buttons.map((b, i) => `${i}:${b.value.toFixed(2)}`).join('  ')}`).join('\n\n') || 'none';
    checkListen();
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  window.addEventListener('gamepadconnected', e => log(`controller connected: ${e.gamepad.id}`, 'sys'));
  window.addEventListener('gamepaddisconnected', e => log(`controller disconnected: ${e.gamepad.id}`, 'sys'));

  /* ------------------------------------------------------------ audio */
  let actx = null, audioNode = null;
  function startAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      audioNode = actx.createScriptProcessor(1024, 0, 2);
      audioNode.onaudioprocess = ev => {
        const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
        if (!running || settings.muted) { L.fill(0); R.fill(0); return; }
        const p = RT._bkw_audio(L.length) >> 2, f = RT.HEAPF32;
        for (let i = 0; i < L.length; i++) { L[i] = f[p + i * 2]; R[i] = f[p + i * 2 + 1]; }
      };
      audioNode.connect(actx.destination);
    } catch (e) { log('audio unavailable: ' + e.message, 'sys'); }
  }
  const muteBtn = $('btnMute');
  function showMute() { muteBtn.textContent = settings.muted ? 'Sound off' : 'Sound on'; }
  muteBtn.onclick = () => { settings.muted = !settings.muted; showMute(); saveSettings(); };
  showMute();

  /* ------------------------------------------------------------ run loop */
  const sctx = screen.getContext('2d');
  const img = sctx.createImageData(W, H);
  let running = false, gfxDirtyRT = false, mapDirtyRT = false;
  let playingEditor = false;   // the runtime is playing the studio's cart (not the home screen or a Bit game)
  const overlay = $('gameOverlay');

  let playingLevels = null;   // levels of the cart being played, for level() map swaps
  function syncToRuntime(withMap, levelIdx) {
    RT.HEAPU8.set(cart.palette, ptr.pal);
    RT.HEAPU8.set(cart.tiles, ptr.tiles);
    RT.HEAPU8.set(cart.flags, ptr.flags);
    if (withMap) RT.HEAPU16.set(cart.levels[levelIdx || 0].map, ptr.map >> 1);
    gfxDirtyRT = false;
  }
  // save data (save()/saved() in Lua): kept per cart in this browser under bitkit.save.<name>
  const SAVE_MAX = 4096;
  let saveKey = null;
  function putSave(key) {
    saveKey = key;
    const H = RT.HEAP32, base = ptr.save;
    H[base + 1] = 0;
    const str = key ? lsGet('bitkit.save.' + key) : null;
    if (str === null || str === undefined) { H[base] = -1; return; }
    const n = Math.min(str.length, SAVE_MAX), off = (base + 2) << 2;
    for (let i = 0; i < n; i++) RT.HEAPU8[off + i] = str.charCodeAt(i) & 255;
    H[base] = n;
  }
  function takeSave() {
    const H = RT.HEAP32, base = ptr.save;
    if (!H[base + 1]) return;
    H[base + 1] = 0;
    if (!saveKey) return;
    const n = H[base];
    if (n < 0) { try { localStorage.removeItem('bitkit.save.' + saveKey); } catch (e) {} return; }
    const off = (base + 2) << 2;
    let str = '';
    for (let i = 0; i < n; i++) str += String.fromCharCode(RT.HEAPU8[off + i]);
    lsSet('bitkit.save.' + saveKey, str);
  }
  function loadCode(code, data, key) {
    putSave(key || null);
    const p = RT.stringToNewUTF8(code), d = RT.stringToNewUTF8(data || '');
    const rc = RT._bkw_load_ex(d, p);
    RT._free(p); RT._free(d);
    return rc;
  }
  // player route: positions reported by ents_player()/track() in the last few runs
  const route = { runs: [], cur: null, show: true };
  function newRouteSegment(level) {
    route.cur = []; route.cur.level = level;
    route.runs.push(route.cur);
    if (route.runs.length > 24) route.runs.shift();
  }
  function run(startLevel, extraLua) {
    const start = typeof startLevel === 'number' ? startLevel : 0;
    syncLevel();
    newRouteSegment(start);
    startAudio();
    overlay.classList.add('hidden');
    clearErrLine();
    syncToRuntime(true, start);
    mapDirtyRT = false;
    log(`▶ running "${cart.name}"` + (start ? ` from ${cart.levels[start].name}` : ''), 'sys');
    playingEditor = true; playingLevels = cart.levels;
    if (bit.on) bit.playing = 'studio';
    running = loadCode(getCode(), BKEntities.toLua(cart.entities, levelsMeta(cart.levels), start, extraLua), cart.name || 'untitled') === 0;
    acc = 0; last = performance.now();
    screen.focus();
  }
  function stop(quiet) { if (activeTab === 'map') setTimeout(drawMap, 0); running = false; RT._bkw_stop(); if (quiet !== true) log('■ stopped', 'sys'); }
  onRuntimeError = msg => {
    running = false;
    overlay.textContent = msg;
    overlay.classList.remove('hidden');
    showErrLine(msg);
  };
  $('btnRun').onclick = () => run();
  $('btnStop').onclick = () => { stop(); if (bit.on) setBitPower(false); };
  screen.addEventListener('mousedown', () => screen.focus());
  $('btnFull').onclick = () => { const g = $('gameWrap'); (g.requestFullscreen || g.webkitRequestFullscreen).call(g); screen.focus(); };

  let routeTick = 0;
  let acc = 0, last = performance.now(), fpsCount = 0, fpsT = last;
  const STEP = 1000 / 60;
  function blit() {
    const p = RT._bkw_render();
    img.data.set(RT.HEAPU8.subarray(p, p + W * H * 4));
    sctx.putImageData(img, 0, 0);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    pollInput();
    if (running) {
      if (gfxDirtyRT && playingEditor) syncToRuntime(false);   // live sprite edits while the game runs
      acc += Math.min(now - last, 100);
      let ticks = 0;
      while (acc >= STEP && running) {
        RT.HEAPU8.set(input.press, ptr.press);
        if (RT._bkw_frame(input.mask, ptr.press) !== 0) running = false;
        takeSave();
        const tr = RT.HEAP32;
        if (playingEditor && tr[ptr.track + 2] && route.cur) route.cur.push(tr[ptr.track], tr[ptr.track + 1]);
        if (tr[ptr.sys]) { const cmd = tr[ptr.sys], arg = tr[ptr.sys + 1]; tr[ptr.sys] = 0; bitRequest(cmd, arg); break; }
        acc -= STEP; ticks++; fpsCount++;
      }
      if (ticks) blit();
      if (ticks && activeTab === 'map' && route.show && (++routeTick % 10) === 0) drawMap();
    }
    last = now;
    bitCombo();
    if (now - fpsT >= 1000) { $('fps').textContent = running ? `${fpsCount} fps` : ''; fpsCount = 0; fpsT = now; }
    updateInputUI();
  }

  /* ------------------------------------------------------------ boot screen */
  function bootScreen() {
    loadCode(`function _draw() cls(1)
  text("${APP.toUpperCase()}", 160 - ${APP.length * 12}, 84, 17, 3)
  text("Press Run or Ctrl+Enter", 68, 130, 29)
  text("or try the Demo", 100, 144, 29) end`);
    RT.HEAPU8.fill(0, ptr.press, ptr.press + 12);
    RT._bkw_frame(0, ptr.press);
    blit();
    RT._bkw_stop();
  }

  /* ------------------------------------------------------------ cart actions */
  function applyCart() {
    $('cartName').value = cart.name;
    setCode(cart.code);
    atlasDirty = true; gfxDirtyRT = true;
    if (activeTab === 'sprites') drawSprites();
    if (activeTab === 'map') { refreshLevels(); refreshEntSelect(); drawMap(); }
    if (activeTab === 'entities') entEd.render();
  }
  // built-in demos: each demo file pushes {name, code, buildGfx, about} onto window.BK_DEMOS
  const DEMOS = () => (window.BK_DEMOS && window.BK_DEMOS.length ? window.BK_DEMOS : [BK_DEMO]);
  function loadDemo(d) {
    d = d || DEMOS()[0];
    cart.name = d.name; cart.code = d.code; cart.palette.set(DEFAULT_PAL);
    cart.tiles.fill(0); cart.flags.fill(0);
    cart.levels = null; cart.map = new Uint16Array(MAPW * MAPH);
    cart.entities = { types: [], placed: [] };
    d.buildGfx(cart); normalizeLevels();
    applyCart(); saveLocal();
  }
  $('cartName').addEventListener('input', e => { cart.name = e.target.value || 'untitled'; markDirty(); });
  $('btnNew').onclick = async () => {
    if (!await ask('Start a new cart?', 'This replaces the current cart. Use Save / share first if you want to keep a copy.', 'Start new cart')) return;
    cart.name = 'my game'; cart.code = NEW_CODE; cart.palette.set(DEFAULT_PAL);
    cart.tiles.fill(0); cart.flags.fill(0);
    cart.levels = null; cart.map = new Uint16Array(MAPW * MAPH);
    cart.entities = { types: [], placed: [] };
    normalizeLevels();
    setCartFile(null); applyCart(); saveLocal();
  };
  $('btnDemo').onclick = async () => {
    const list = DEMOS();
    if (list.length === 1) {
      if (!await ask('Load the demo cart?', `This replaces the current cart with ${list[0].name}. Use Save / share first if you want to keep a copy.`, 'Load demo')) return;
      setCartFile(null); loadDemo(list[0]); run();
      return;
    }
    modal('Load a demo', '<p class="dim">This replaces the current cart. Use Save / share first if you want to keep a copy.</p>' +
      list.map(d => `<p><b>${escapeHtml(d.name)}</b>${d.about ? ' <span class="dim">' + escapeHtml(d.about) + '</span>' : ''}</p>`).join(''),
      list.map((d, i) => [d.name, () => { closeModal(); setCartFile(null); loadDemo(d); run(); }, i === 0 ? 'primary' : '']).concat([['Cancel', closeModal]]));
  };
  function cartFileName() { return (cart.name || 'cart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.bitkit'; }
  $('btnSave').onclick = () => {
    saveLocal();
    const text = JSON.stringify(serialize());
    modal('Save / share cart', `<p class="dim">Your cart is already saved in this browser. To keep a file or move it to another computer, download it or copy the text below (paste it back with Open).</p>
      <textarea id="mText" readonly></textarea>`, [
      ['Copy text', b => { const t = $('mText'); t.select(); (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copied'), () => { document.execCommand && document.execCommand('copy'); toast('Text selected, press Ctrl+C'); }); }],
      ['Download ' + cartFileName(), () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = cartFileName(); a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'primary'],
      ['Close', closeModal]]);
    $('mText').value = text;
  };
  $('btnOpen').onclick = () => {
    modal('Open cart', `<p class="dim">Pick a .bitkit file, or paste cart text. This replaces the current cart.</p><textarea id="mText" placeholder="Paste cart text here"></textarea>`, [
      ['Choose file…', () => $('fileOpen').click()],
      ['Load pasted text', () => { try { deserialize(JSON.parse($('mText').value)); setCartFile(null); applyCart(); saveLocal(); closeModal(); toast('Cart loaded'); } catch (err) { toast('That text is not a cart: ' + err.message); } }, 'primary'],
      ['Cancel', closeModal]]);
  };
  $('fileOpen').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { deserialize(JSON.parse(await f.text())); setCartFile(null); applyCart(); saveLocal(); closeModal(); toast(`Opened ${f.name}`); }
    catch (err) { log('Could not open cart: ' + err.message, 'err'); }
    e.target.value = '';
  };


  /* ------------------------------------------------------------ the Bit: emulated PocketBit + memory card */
  // The Bit boots into a home screen (studio/home.js, a normal cart) listing the games on its memory card:
  // a folder on this computer, or this browser where folders are not available.
  const LS_FILE = LS.cart + '.file';
  let cartFile = lsGet(LS_FILE) || null;   // memory-card file the editor cart came from / saves to
  function setCartFile(f) { cartFile = f; lsSet(LS_FILE, f || ''); showCartFile(); }
  function showCartFile() {
    const el = $('cartFile');
    el.textContent = cartFile ? `💾 ${cartFile}` : '';
    el.title = cartFile ? `Saves to ${cartFile} on the Bit (${BKStore.label()}). Ctrl+S saves.` : '';
  }
  const bit = { on: false, playing: null, games: [], sel: 1 };
  let comboHeld = false;
  const START = 1 << 10, SELECT = 1 << 11;

  async function libraryGames() {
    let list = [];
    try { list = await BKStore.list(); } catch (e) { log('Could not read the Bit memory card: ' + e.message, 'err'); }
    return list.filter(g => g.data && !g.error);
  }
  function iconFor(c, slotTile, tiles) {
    // the game's icon: the player's (or first entity's) first frame, else tile 1, scaled into a 16x16 slot
    // of the home screen's tile sheet. Returns false when it would be blank.
    const types = (c.entities && c.entities.types) || [];
    const t = types.find(x => x.player) || types[0];
    let f = 1, w = 1, h = 1;
    const fr = t && (t.anims.find(a => a.frames.length) || {}).frames;
    if (fr && fr.length) { f = fr[0]; w = Math.min(4, t.sw || 1); h = Math.min(4, t.sh || 1); }
    const sw = w * 8, sh = h * 8, sz = Math.max(sw, sh), ox = (sz - sw) >> 1, oy = (sz - sh) >> 1;
    let any = false;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const px = Math.floor(x * sz / 16) - ox, py = Math.floor(y * sz / 16) - oy;
      let v = 0;
      if (px >= 0 && py >= 0 && px < sw && py < sh) {
        const tile = f + (py >> 3) * 16 + (px >> 3);
        v = tile < TILES ? c.tiles[tile * 64 + (py & 7) * 8 + (px & 7)] : 0;
      }
      tiles[(slotTile + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = v;
      if (v) any = true;
    }
    return any;
  }
  const luaStr = s => '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/\n/g, ' ') + '"';
  async function bootHome() {
    const lib = await libraryGames();
    bit.games = [{ name: cart.name, studio: true, cart: null }].concat(
      lib.filter(g => g.file !== cartFile).map(g => ({ name: g.data.name || g.file, file: g.file, data: g.data })));
    const tiles = new Uint8Array(TILES * 64);
    const COLORS = [3, 8, 15, 20, 25, 4, 9, 16];
    const rows = bit.games.slice(0, 96).map((g, i) => {
      const slot = Math.floor(i / 8) * 32 + (i % 8) * 2 + 0;
      let c = null;
      if (g.studio) c = cart; else { try { c = decodeCart(g.data); } catch (e) { c = null; } }
      const has = c && iconFor(c, slot, tiles);
      return `{name=${luaStr(g.name)}, file=${luaStr(g.file || '')}, studio=${g.studio ? 'true' : 'false'}, ${has ? `icon=${slot}` : `color=${COLORS[i % COLORS.length]}`}}`;
    });
    if (bit.sel > bit.games.length) bit.sel = 1;
    const data = `BIT = { games = {${rows.join(',')}}, sel = ${bit.sel}, studio = true, source = ${luaStr(BKStore.state === 'folder' ? BKStore.label() : '')} }`;
    startAudio();
    overlay.classList.add('hidden');
    RT.HEAPU8.set(DEFAULT_PAL, ptr.pal); RT.HEAPU8.set(tiles, ptr.tiles);
    RT.HEAPU8.fill(0, ptr.flags, ptr.flags + TILES); RT.HEAPU16.fill(0, ptr.map >> 1, (ptr.map >> 1) + MAPW * MAPH);
    gfxDirtyRT = true; playingEditor = false; bit.playing = 'home';
    running = loadCode(window.BK_HOME, data) === 0;
    acc = 0; last = performance.now();
    screen.focus();
  }
  function playCart(c, label) {
    startAudio();
    overlay.classList.add('hidden');
    RT.HEAPU8.set(c.palette, ptr.pal); RT.HEAPU8.set(c.tiles, ptr.tiles); RT.HEAPU8.set(c.flags, ptr.flags);
    RT.HEAPU16.set(c.levels[0].map, ptr.map >> 1);
    gfxDirtyRT = true; playingEditor = false; bit.playing = label; playingLevels = c.levels;
    log(`▶ Bit: playing "${c.name}"`, 'sys');
    running = loadCode(c.code, BKEntities.toLua(c.entities, levelsMeta(c.levels), 0), c.name || label) === 0;
    acc = 0; last = performance.now();
    screen.focus();
  }
  async function bitRequest(cmd, arg) {
    if (cmd === 4) {   // level(n): load that level's map before the next frame
      const L = playingLevels && playingLevels[arg - 1];
      if (L) { RT.HEAPU16.set(L.map, ptr.map >> 1); if (playingEditor) newRouteSegment(arg - 1); }
      return;
    }
    if (cmd === 2) { if (bit.on) bootHome(); return; }
    const g = bit.games[arg - 1];
    if (!bit.on || bit.playing !== 'home' || !g) return;
    bit.sel = arg;
    if (cmd === 1) {
      if (g.studio) run();
      else { try { playCart(decodeCart(g.data), g.file); } catch (e) { log(`Could not start ${g.file}: ${e.message}`, 'err'); } }
    } else if (cmd === 3) {
      if (g.studio) { toast('That is the cart in the studio'); return; }
      openFromBit(g.file, g.data);
    }
  }
  function bitCombo() {
    const both = (input.mask & (START | SELECT)) === (START | SELECT);
    if (both && !comboHeld && bit.on && bit.playing !== 'home') { stop(true); bootHome(); }
    comboHeld = both;
  }
  function setBitPower(on) {
    bit.on = on;
    $('btnBit').classList.toggle('active', on);
    $('btnBit').textContent = on ? '⏻ Bit on' : '⏻ Bit';
    if (on) { log('Bit on: home screen. Hold Start+Select in a game to come back.', 'sys'); bootHome(); }
    else { stop(true); bit.playing = null; bootScreen(); }
  }
  $('btnBit').onclick = () => setBitPower(!bit.on);

  async function openFromBit(file, data) {
    if (!await ask(`Open "${data.name || file}" in the studio?`, 'This replaces the cart in the studio. If you want to keep it, save it to the Bit first.', 'Open')) return;
    try { deserialize(data); } catch (e) { toast(e.message); return; }
    setCartFile(file); applyCart(); saveLocal();
    closeModal(); toast(`Opened ${file}`);
    if (bit.on) bootHome();
  }
  async function saveToBit(confirmNew) {
    const file = cartFile || cartFileName();
    try {
      if (!cartFile && confirmNew && await BKStore.exists(file) &&
          !await ask(`Replace ${file}?`, 'A game with this file name is already on the Bit.', 'Replace')) return false;
      await BKStore.save(file, serialize());
      setCartFile(file);
      toast(`Saved to the Bit: ${file}`);
      return true;
    } catch (e) { log('Could not save to the Bit: ' + e.message, 'err'); toast('Save failed'); return false; }
  }

  async function showLibrary() {
    const games = await BKStore.list().catch(e => { log(e.message, 'err'); return []; });
    const st = BKStore.state;
    const where = st === 'folder' ? `📁 <b>${escapeHtml(BKStore.label())}</b> on this computer`
      : st === 'reconnect' ? `📁 <b>${escapeHtml(BKStore.label())}</b>`
      : `🌐 <b>this browser</b>${BKStore.canPickFolder ? '' : ' (this browser can\'t open folders; Chrome or Edge can)'}`;
    const rows = games.map((g, i) => {
      const nm = g.data ? escapeHtml(g.data.name || g.file) : `<span class="err">${escapeHtml(g.file)} (unreadable)</span>`;
      const cur = g.file === cartFile ? ' <span class="lib-tag">in studio</span>' : '';
      return `<div class="lib-row"><canvas width="16" height="16" data-i="${i}"></canvas><div class="lib-name">${nm}${cur}<div class="dim small">${escapeHtml(g.file)}</div></div>
        ${g.data ? `<button class="tiny" data-play="${i}">Play</button><button class="tiny" data-open="${i}">Open</button>` : ''}<button class="tiny danger" data-del="${i}">✕</button></div>`;
    }).join('') || '<div class="dim">No games yet. Save the current cart to put it on the Bit.</div>';
    modal('Bit library', `<div class="lib-where">Memory card: ${where}</div>
      <div class="lib-actions">
        ${BKStore.canPickFolder ? '<button id="libPick" class="tiny">Choose folder…</button>' : ''}
        ${st === 'reconnect' ? '<button id="libReconnect" class="tiny primary">Reconnect folder</button>' : ''}
        ${st !== 'browser' ? '<button id="libBrowser" class="tiny">Use this browser instead</button>' : ''}
      </div>
      <div class="lib-list">${rows}</div>`, [
      ['Save current cart to the Bit', async () => { if (await saveToBit(true)) showLibrary(); }, 'primary'],
      ['Close', closeModal]]);
    // icons
    document.querySelectorAll('.lib-row canvas').forEach(cv => {
      const g = games[+cv.dataset.i]; if (!g.data) return;
      try {
        const c = decodeCart(g.data), x = cv.getContext('2d'), im = x.createImageData(16, 16), tl = new Uint8Array(64 * 18);
        iconFor(c, 0, tl);
        for (let y = 0; y < 16; y++) for (let xx = 0; xx < 16; xx++) {
          const v = tl[((y >> 3) * 16 + (xx >> 3)) * 64 + (y & 7) * 8 + (xx & 7)], o = (y * 16 + xx) * 4;
          im.data[o] = c.palette[v * 3]; im.data[o + 1] = c.palette[v * 3 + 1]; im.data[o + 2] = c.palette[v * 3 + 2]; im.data[o + 3] = v ? 255 : 0;
        }
        x.putImageData(im, 0, 0);
      } catch (e) { /* no icon */ }
    });
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('libPick', async () => {
      try { await BKStore.chooseFolder(); showCartFile(); toast(`Memory card: ${BKStore.label()}`); if (bit.on) bootHome(); showLibrary(); }
      catch (e) { if (e.name !== 'AbortError') { log('Folder not available here: ' + e.message, 'err'); toast('Folders are blocked here. Open the studio in its own tab.'); } }
    });
    on('libReconnect', async () => { try { await BKStore.reconnect(); } catch (e) { log(e.message, 'err'); } if (bit.on) bootHome(); showLibrary(); });
    on('libBrowser', async () => { await BKStore.useBrowser(); setCartFile(null); if (bit.on) bootHome(); showLibrary(); });
    document.querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
      const g = games[+b.dataset.play]; closeModal();
      try { if (!bit.on) { bit.on = true; $('btnBit').classList.add('active'); $('btnBit').textContent = '⏻ Bit on'; } playCart(decodeCart(g.data), g.file); } catch (e) { log(e.message, 'err'); }
    });
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const g = games[+b.dataset.open]; openFromBit(g.file, g.data); });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const g = games[+b.dataset.del];
      if (!await ask(`Delete ${g.file}?`, BKStore.state === 'folder' ? 'The file is deleted from the folder on your computer. This cannot be undone.' : 'It is removed from this browser.', 'Delete')) { showLibrary(); return; }
      try { await BKStore.remove(g.file); if (g.file === cartFile) setCartFile(null); toast('Deleted'); } catch (e) { log(e.message, 'err'); }
      if (bit.on && bit.playing === 'home') bootHome();
      showLibrary();
    });
  }
  $('btnLib').onclick = showLibrary;
  BKStore.init().then(showCartFile, () => {});

  /* in-page dialogs (native confirm() is unavailable in some embeds) */
  const modalEl = $('modal');
  let modalResolve = null;
  function modal(title, html, buttons) {
    modalEl.querySelector('h3').textContent = title;
    modalEl.querySelector('.m-body').innerHTML = html;
    const bar = modalEl.querySelector('.m-buttons'); bar.innerHTML = '';
    buttons.forEach(([label, fn, cls]) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = () => fn(b); bar.appendChild(b); });
    modalEl.hidden = false;
    (bar.querySelector('.primary') || bar.firstChild).focus();
  }
  function closeModal() { modalEl.hidden = true; if (modalResolve) { modalResolve(false); modalResolve = null; } }
  function ask(title, text, okLabel) {
    return new Promise(res => {
      modal(title, `<p>${escapeHtml(text)}</p>`, [[okLabel, () => { modalResolve = null; modalEl.hidden = true; res(true); }, 'primary'], ['Cancel', closeModal]]);
      modalResolve = res;
    });
  }
  modalEl.addEventListener('mousedown', e => { if (e.target === modalEl) closeModal(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalEl.hidden) closeModal(); });

  /* ------------------------------------------------------------ help */
  const HELP = [
    ['Program', [
      ['_init()', 'Called once when the cart starts.'],
      ['_update()', 'Called 60 times a second. Put game logic here.'],
      ['_draw()', 'Called after every _update. Put drawing here.'],
      ['print(...)', 'Write to the studio console (for debugging).']]],
    ['Graphics (320x240, 256 colours)', [
      ['cls([c])', 'Clear the screen with colour c (default 0).'],
      ['pset(x,y,c) / pget(x,y)', 'Set or read a pixel.'],
      ['line(x0,y0,x1,y1,c)', 'Draw a line.'],
      ['rect(x,y,w,h,c) / rectfill', 'Rectangle outline or filled.'],
      ['circ(x,y,r,c) / circfill', 'Circle outline or filled.'],
      ['text(s,x,y,[c],[scale])', 'Draw text with the 8x8 font. Returns the width in pixels.'],
      ['spr(n,x,y,[w,h],[flipx],[flipy],[scale])', 'Draw sprite n. w,h are in tiles (2,2 draws a 16x16 sprite). Colour 0 is transparent.'],
      ['map([cx,cy,cw,ch,sx,sy])', 'Draw a cw x ch area of the map starting at tile cx,cy to screen sx,sy. Default draws one screen (40x30 tiles).'],
      ['mget(x,y) / mset(x,y,n)', 'Read or change a map tile (map is 256x128 tiles).'],
      ['fget(n,[bit]) / fset(n,bit,on)', 'Sprite flags. Use them to mark tiles as solid, deadly, etc.'],
      ['camera([x,y])', 'Offset all drawing. camera() resets it (use for the HUD).'],
      ['clip([x,y,w,h])', 'Only draw inside this rectangle. clip() resets.'],
      ['pal([c0,c1])', 'Draw colour c0 as c1. pal() resets.'],
      ['palt([c,on])', 'Make colour c transparent for sprites and maps. palt() resets (only 0 is transparent).'],
      ['palette(i,[r,g,b])', 'Read or change palette colour i (0-255 each).']]],
    ['Input', [
      ['btn(b)', 'True while the button is held. b is "left","right","up","down","a","b","x","y","l","r","start","select" or 0-11.'],
      ['btnp(b)', 'True on the frame the button goes down, then repeats while held.'],
      ['btnr(b)', 'True on the frame the button is released.'],
      ['press(b)', 'How hard the button is pressed, 0-255. Analog triggers (L/R) give the full range. On PocketBit L/R (and later ABXY) are Hall-effect sensors.']]],
    ['Sound (8 channels, stereo)', [
      ['sfx(note,[wave],[vol],[frames],[ch],[pan],[slide])', 'Play a note like "C4", "F#5" or a MIDI number. wave: 0 square, 1 triangle, 2 saw, 3 noise, 4 sine, 5 thin pulse. vol 0-1, frames = length (60 per second), pan -1..1, slide in Hz per second. Picks a free channel if ch is nil.'],
      ['tone(hz,...)', 'Like sfx but with a frequency in Hz.'],
      ['stop([ch])', 'Silence one channel or all.']]],
    ['Entities (made on the Entities tab)', [
      ['ents_update() / ents_draw()', 'Run every entity\'s behavior, physics and animation; draw them. Call in _update and _draw (after camera()).'],
      ['ents_player(x,y,[w,h])', 'Tell entities where the player is (for chasing, sensors, touch and damage). Call every frame before ents_update.'],
      ['ents_spawn(name,x,y)', 'Create an entity. Returns it: e.x, e.y, e.vx, e.vy, e.dir, e.hp, e.name, e.ground, e.data (your own table).'],
      ['ents_all([name])', 'List of living entities, optionally only one type.'],
      ['ents_touch(x,y,w,h)', 'Entities overlapping a box.'],
      ['ents_kill(e) / ents_reset()', 'Remove one entity / respawn everything placed on the map.'],
      ['ents_damage(e,n,[src])', 'Take n hp. Entities blink and can\'t be hurt again for 15 frames. HP 0 in the editor means can\'t be hurt.']]],
    ['Player, stats and effects', [
      ['PLAYER', 'The entity marked "is the player" (or the box from ents_player). Its x, y, hp, vx, vy work like any entity.'],
      ['ents_camera([w,h])', 'Point the camera at the player, kept inside the world. Returns cx, cy. Set ENT_WORLD_W / ENT_WORLD_H to your map size in pixels.'],
      ['ents_get(name)', 'First living entity of a type.'],
      ['stat(e, name)', 'Current value of a stat: hp (max), damage, speed, jump or your own, after effects.'],
      ['stat_set(e, name, v)', 'Change the base value of a stat for one entity.'],
      ['fx_apply(e, name) / fx_remove / fx_has / fx_clear(e)', 'Start, stop or check effects made on the Entities tab. Effects can change HP once, over time, change stats (times, plus, set) and flash a colour.'],
      ['Player death', 'When the player\'s HP hits 0 (or it falls out of the world) "death" fires. Set e.alive = true in an ents_on(name, "death") handler to respawn instead.']]],
    ['Events', [
      ['on(name, fn)', 'Call fn whenever the event happens. Built-in: "player_hurt" (damage, source), "death" (entity).'],
      ['emit(name, ...)', 'Send an event. Behavior trees can react with the "Heard event" check, and send events with "Send event".'],
      ['track(x, y)', 'Report the player position so the Map tab can draw the route you played. ents_player() does this for you.'],
      ['ents_on(type, ev, fn)', 'Per type events: "touch" fn(e, other), "hurt" fn(e, amount, source), "death" fn(e, source).']]],
    ['Sensors', [
      ['raycast(x,y,dx,dy,len,[what],[ignore])', 'Cast a line. Returns hit, hx, hy, thing. what: "wall", "player", "any", "enemy", "friend" or an entity name. Walls block it.'],
      ['circlecast(x,y,r,[what],[ignore])', 'List of things (entities or PLAYER) inside the circle.'],
      ['Teams and damage', 'Entities with touch damage hurt the other team when they first touch. The player is on the friend team, so enemy damage sends "player_hurt". Projectiles vanish after hitting.']]],
    ['Levels', [
      ['level(n)', 'Switch to level n (made on the Map tab) at the start of the next frame. Its map and entities load; the player keeps its HP and data. Returns false if there is no level n.'],
      ['LEVEL / LEVELS', 'The current level number, and the list of levels: LEVELS[n].name, .w and .h (in tiles).'],
      ['on("level", fn)', 'Called with (n, name) after a level loads. Use it to move the camera or reset a respawn point.'],
      ['Go to level', 'Behavior step that calls level(n). The Exit preset uses it when the player touches the entity.']]],
    ['Cutscenes', [
      ['Cutscenes tab', 'Make a list of steps: Say, Move camera to, Walk, Jump, Turn, Fade, Shake, Wait and more. Preview plays it right away.'],
      ['cutscene(name, [once])', 'Play a cutscene. With once = true it only plays the first time. Returns false if there is no such cutscene.'],
      ['cutscene_playing()', 'Returns true and the name while one plays. Behaviors pause, nothing takes damage and ents_camera() follows the cutscene.'],
      ['on("cutscene_end", fn)', 'Called with the name when a cutscene finishes or is skipped. on("cutscene", fn) is called when one starts.'],
      ['Trigger zones', 'An invisible entity with the "Play cutscene" step. "Place a trigger zone" on the Cutscenes tab makes one for you. Level intros play when their level starts.'],
      ['Needs', 'ents_update() in _update (it runs the cutscene) and ents_camera() if the camera should pan. The dialog box, bars and fades are drawn for you on top of _draw. START skips.']]],
    ['Save data and clock', [
      ['save(t)', 'Keep a table (numbers, strings, booleans, nested tables; up to 4 KB) for the next time the cart runs. save(nil) deletes it. The studio keeps it per cart name in this browser; PocketBit keeps it in flash.'],
      ['saved()', 'The table from the last save(), or nil if there is none.'],
      ['clock()', 'Real time in unix seconds (the RTC on PocketBit). Use it for idle games and offline progress. It is not deterministic, so keep it out of multiplayer game logic.']]],
    ['The Bit (emulated PocketBit)', [
      ['⏻ Bit button', 'Turns on the emulated PocketBit: a home screen with the studio cart and every game on its memory card. D-pad chooses, A plays, Y opens a game in the studio.'],
      ['Start + Select', 'Hold both in a game to go back to the home screen, like on the device.'],
      ['Library', 'The Bit\'s memory card: a folder on your computer (Chrome/Edge) or this browser. Save carts to it, then play or open them from the home screen. Ctrl+S saves the open cart back to its file.'],
      ['launch(n, [edit]) / home()', 'System calls used by the home screen: start game n, or return home. A game can call home() from its own menu.']]],
    ['Time and randomness', [
      ['t()', 'Frames since the cart started (60 per second).'],
      ['time()', 'Seconds since the cart started.'],
      ['rnd() / rnd(n) / rnd(a,b)', 'Random float 0-1, integer 1..n, or integer a..b. Deterministic: the same seed gives the same game, which multiplayer relies on.'],
      ['srand(seed)', 'Set the random seed. math.random uses the same generator.']]],
    ['Studio keys', [
      ['Ctrl+Enter', 'Run the cart (works anywhere).'],
      ['Ctrl+S', 'Save to this browser (it also autosaves). Use Save / share to keep a file.'],
      ['Ctrl+/', 'Comment or uncomment lines in the code editor.'],
      ['Sprites: P / F / I', 'Pen, fill, pick colour. Ctrl+Z undo.'],
      ['Map: P / F / I, WASD', 'Paint, fill, pick tile; pan the view (Shift = faster).'],
      ['Keyboard as controller', 'Arrows, Z=A, X=B, A=X, S=Y, Q=L, W=R, Enter=Start, Shift=Select. Click the game screen first.']]]
  ];
  $('helpBody').innerHTML = `<h2>${APP} API</h2><p class="dim">Lua 5.4. The same runtime (C, compiled to WebAssembly here) runs on the PocketBit handheld. Carts are deterministic: no clock, no file access, seeded random.</p>` +
    HELP.map(([h, rowsH]) => `<h3>${h}</h3><table>${rowsH.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join('')}</table>`).join('');

  /* ------------------------------------------------------------ start */
  document.title = `${APP} Studio`;
  $('appName').textContent = APP;
  let restored = false;
  try { const s = lsGet(LS.cart); if (s) { deserialize(JSON.parse(s)); restored = true; } } catch (e) { log('Saved cart was unreadable, starting fresh', 'sys'); }
  if (!restored) { const d = DEMOS()[0]; cart.name = d.name; cart.code = d.code; d.buildGfx(cart); normalizeLevels(); }
  applyCart();
  log(`${APP} Studio ready. ${restored ? 'Restored your last cart.' : 'Loaded the demo cart.'} Press Run (Ctrl+Enter).`, 'sys');
  showTab(lsGet(LS.settings + '.tab') || 'code');
  bootScreen();
  requestAnimationFrame(frame);

  // expose for tests / debugging
  window.bkStudio = { cart, run, stop, input, RT, isRunning: () => running, bit, setBitPower, showLibrary, saveToBit, BKStore };
})().catch(e => {
  document.body.innerHTML = `<pre style="color:#ff6b5e;padding:20px">Studio failed to start: ${e && e.stack || e}</pre>`;
});
