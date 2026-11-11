/* The studio's "My Bit" tab: make the Bit your own. Edits the Bit's theme (the same save file the Themes app on the
   Bit uses, "Bit theme") and the owner's profile (the Settings app's USER page, "Bit settings"), with a live preview:
   a second runtime that runs the real home screen and boot screen with the theme. Themes export and import as
   .bittheme files. The theme format and the Lua that draws it are studio/themes.js. MIT License. */
'use strict';
window.BKMyBit = (function () {
  const T = BKThemes;
  const BTN = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, z: 4, x: 5, a: 6, s: 7, q: 8, w: 9, Enter: 10, Shift: 11 };
  const PROFILE_COLORS = [27, 10, 26, 25, 5, 4, 21, 22, 17, 16, 18, 12, 13, 29];
  const BASE32 = ['000000', '1b1b2f', '3a2e5c', '5e3a8c', '8e4fb0', 'c06bd0', '2d1e1e', '5a2f2a', '8f3f2e', 'c75b39', 'f08a4b', 'ffc07a', 'fff3d6', 'ffffff',
    '1d3b2a', '2f6b3a', '4fa04a', '8ad35a', 'd5f07a', '0f2a4a', '1f4f8a', '3a86d0', '6ec3f0', 'bff0ff', '6b1d2e', 'b02a3a', 'e8504a', 'ffd23f', '7a7a8a', 'a8a8b8', '4a4a5a', '2a2a36'];
  const LABELS = {
    wall: { stars: 'Stars', hills: 'Rolling hills', waves: 'Waves', grid: 'Neon grid', bubbles: 'Bubbles', rain: 'Rain', checks: 'Checks', aurora: 'Aurora', plain: 'Plain colour', picture: 'Picture (paint it below)' },
    font: { classic: 'Classic', bold: 'Bold', slant: 'Slanted', heavy: 'Slanted bold' },
    card: { frame: 'Frame', round: 'Round', shadow: 'Drop shadow', outline: 'Outline', ticket: 'Ticket' },
    bar: { solid: 'Solid', line: 'Thin line', float: 'Floating', none: 'None' },
    sound: { blip: 'Blip', soft: 'Soft', chime: 'Chime', retro: 'Retro', clack: 'Clack', mute: 'Silent' },
    boot: { rise: 'Rise', pixels: 'Pixels', scan: 'TV switch-on', bounce: 'Bouncy letters', type: 'Typewriter', none: 'None (straight home)' },
    look: { game: "Game's own (no look)", off: 'Off', crt: 'CRT', arcade: 'Arcade', 'old tv': 'Old TV', handheld: 'Handheld', sepia: 'Sepia', night: 'Night', vivid: 'Vivid' },
  };
  let ctx = null, el = null, save = null, undo = [], redo = [], built = false;
  const pv = { M: null, loading: null, img: null, cv: null, ptrPress: 0, mask: 0, mode: 'home', ver: 0, loaded: -1, actx: null, node: null, left: 0, raf: 0 };
  const paint = { color: 1, tool: 'pen', down: false, px: null };

  /* ------------------------------------------------------------ data */
  function load() { save = T.readSave(); }
  function theme() { return save.theme; }
  function commit(label) {
    save.theme = T.fix(save.theme);
    try { T.writeSave(save); } catch (e) { ctx.toast(e.message); }
    pv.ver++;
    ctx.changed();
    if (label) renderSoon();
  }
  function snapshot() { undo.push(JSON.stringify(save)); if (undo.length > 80) undo.shift(); redo = []; }
  function edit(fn, rerender) { snapshot(); fn(theme()); commit(); if (rerender) render(); }
  function step(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(save));
    save = JSON.parse(from.pop());
    commit(); render();
  }
  function profile() {
    let o = {};
    try { const raw = localStorage.getItem('bitkit.save.Bit settings'); if (raw) o = BKMusic.parseLua(raw) || {}; } catch (e) { o = {}; }
    return Object.assign({ name: '', color: 27, bit: '' }, o);
  }
  function setProfile(k, v) {
    const o = profile();
    o[k] = v;
    try { localStorage.setItem('bitkit.save.Bit settings', T.toLua(o)); } catch (e) { ctx.toast('Could not save: ' + e.message); }
    pv.ver++;
    ctx.changed();
  }
  const cleanName = (s, n) => String(s || '').toUpperCase().replace(/[^\x20-\x7e]/g, '').slice(0, n);

  /* ------------------------------------------------------------ preview: a runtime of its own running the real home / boot carts */
  function ready() {
    if (pv.M) return Promise.resolve(pv.M);
    if (!pv.loading) pv.loading = window.BitKitRuntime({ onLog: (m, e) => { if (e) console.warn('my bit preview:', m); } }).then(M => {
      M._bkw_init();
      pv.ptrPress = M._malloc(16);
      pv.M = M;
      return M;
    });
    return pv.loading;
  }
  function luaStr(s) { return T.toLua(String(s)); }
  function previewGames() {
    const games = (window.BK_DEMOS || []).slice(0, 6).map((d, i) => ({ name: d.name, file: '', color: [3, 8, 15, 20, 25, 4][i % 6] }));
    const apps = (window.BK_APPS || []).map(a => ({ name: a.name, app: true, sub: a.sub || '', icon: a.icon }));
    return games.length ? games.concat(apps) : [{ name: 'My game', file: 'my-game.bitkit', color: 15 }].concat(apps);
  }
  function loadPreview() {
    const M = pv.M;
    if (!M) return;
    const p = profile(), t = theme();
    const me = { name: cleanName(p.name, 10), color: p.color | 0, bit: cleanName(p.bit, 14) };
    let code, data;
    if (pv.mode === 'boot') {
      M.HEAPU16[M._bkw_map() >> 1] = 0;
      code = T.LIB + T.BOOT + '\nfunction home() BOOT_DONE = true end';
      data = `BOOT = { theme = ${T.toLua(t)}, title = ${luaStr((t.boottext || me.bit || 'PocketBit').toUpperCase())}, sub = ${luaStr(me.name ? me.name + "'S BIT" : '')} }`;
    } else {
      const games = previewGames();
      const tiles = M._bkw_tiles(), H = M.HEAPU8;
      H.fill(0, tiles, tiles + 512 * 64);
      const rows = games.map((g, i) => {
        const slot = Math.floor(i / 8) * 32 + (i % 8) * 2;
        if (g.icon) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) H[tiles + (slot + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = (g.icon[y] || [])[x] || 0;
        return `{name=${luaStr(g.name)}, file=${luaStr(g.file || '')}, studio=false, paused=false, ${g.icon ? `icon=${slot}` : `color=${g.color}`}${g.app ? `, app=true, sub=${luaStr(g.sub)}` : ''}}`;
      });
      code = T.LIB + window.BK_HOME + '\nfunction launch() end function track() end';
      data = `BIT = { games = {${rows.join(',')}}, sel = 1, studio = false, link = false, source = "", theme = ${T.toLua(t)}, me = ${T.toLua(me)} }`;
    }
    if (t.look !== 'game') data += `\ndisplay(${luaStr(t.look)})`;
    const pc = M.stringToNewUTF8(code), pd = M.stringToNewUTF8(data);
    const rc = M._bkw_load_ex(pd, pc);
    M._free(pc); M._free(pd);
    if (rc !== 0) console.warn('my bit preview:', M.UTF8ToString(M._bkw_error()));
    pv.loaded = pv.ver;
  }
  function frame() {
    pv.raf = 0;
    if (!ctx.isActive() || !pv.M) return;
    pv.raf = requestAnimationFrame(frame);
    const M = pv.M;
    if (pv.loaded !== pv.ver) loadPreview();
    const H = M.HEAPU8;
    for (let i = 0; i < 12; i++) H[pv.ptrPress + i] = (pv.mask >> i) & 1 ? 255 : 0;
    if (!pv.actx) M._bkw_frame(pv.mask, pv.ptrPress);   // with sound on, the audio callback runs the frames
    if (pv.mode === 'boot') {
      const p = M.stringToNewUTF8('if BOOT_DONE then mset(0, 0, 1) end');
      M._bkw_eval(p); M._free(p);
      if (M.HEAPU16[M._bkw_map() >> 1]) { pv.mode = 'home'; pv.ver++; }
    }
    const r = M._bkw_render();
    pv.img.data.set(H.subarray(r, r + 320 * 240 * 4));
    pv.cv.getContext('2d').putImageData(pv.img, 0, 0);
  }
  function startPreview() { ready().then(() => { if (!pv.raf && ctx.isActive()) pv.raf = requestAnimationFrame(frame); }); }
  function audio() {          // sound for the preview, after a click (browsers want one)
    if (pv.actx) { if (pv.actx.state === 'suspended') pv.actx.resume(); return; }
    try {
      pv.actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      pv.node = pv.actx.createScriptProcessor(1024, 0, 2);
      pv.node.onaudioprocess = ev => {
        const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1), M = pv.M;
        if (!M || !ctx.isActive()) { L.fill(0); R.fill(0); return; }
        for (let i = 0; i < L.length;) {
          if (pv.left <= 0) { M._bkw_frame(pv.mask, pv.ptrPress); pv.left = 735; }
          const k = Math.min(L.length - i, pv.left), p = M._bkw_audio(k) >> 2, f = M.HEAPF32;
          for (let j = 0; j < k; j++) { L[i + j] = f[p + j * 2]; R[i + j] = f[p + j * 2 + 1]; }
          i += k; pv.left -= k;
        }
      };
      pv.node.connect(pv.actx.destination);
    } catch (e) { pv.actx = null; }
  }
  function lua(code) { const M = pv.M; if (!M) return; const p = M.stringToNewUTF8(code); M._bkw_eval(p); M._free(p); }

  /* ------------------------------------------------------------ wallpaper painter */
  function picPixels() { if (!paint.px) paint.px = T.picDecode(theme().pic); return paint.px; }
  function drawPaint() {
    const cv = el.querySelector('#mbPaint');
    if (!cv) return;
    const g = cv.getContext('2d'), px = picPixels(), t = theme();
    const im = g.createImageData(T.PIC_W, T.PIC_H);
    for (let i = 0; i < px.length; i++) {
      const h = t.c[T.KEYS[px[i]]];
      im.data[i * 4] = parseInt(h.slice(0, 2), 16); im.data[i * 4 + 1] = parseInt(h.slice(2, 4), 16); im.data[i * 4 + 2] = parseInt(h.slice(4, 6), 16); im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }
  function paintAt(e, start) {
    const cv = e.target, r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * T.PIC_W), y = Math.floor((e.clientY - r.top) / r.height * T.PIC_H);
    if (x < 0 || y < 0 || x >= T.PIC_W || y >= T.PIC_H) return;
    const px = picPixels(), i = y * T.PIC_W + x;
    if (e.button === 2 || paint.tool === 'pick') { paint.color = px[i]; renderPaintPal(); return; }
    if (start) snapshot();
    if (paint.tool === 'fill') {
      const from = px[i], to = paint.color;
      if (from === to) return;
      const st = [[x, y]];
      while (st.length) {
        const [a, b] = st.pop();
        if (a < 0 || b < 0 || a >= T.PIC_W || b >= T.PIC_H || px[b * T.PIC_W + a] !== from) continue;
        px[b * T.PIC_W + a] = to;
        st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
      }
    } else px[i] = paint.color;
    drawPaint();
  }
  function paintDone() {
    if (!paint.px) return;
    theme().pic = T.picEncode(paint.px);
    theme().wall = 'picture';
    commit();
    const sel = el.querySelector('[data-k="wall"]'); if (sel) sel.value = 'picture';
  }
  function renderPaintPal() {
    const box = el.querySelector('#mbPaintPal');
    if (!box) return;
    box.innerHTML = T.KEYS.map((k, i) => `<button class="mb-pc ${i === paint.color ? 'on' : ''}" data-pc="${i}" title="${T.KEY_NAMES[k]}" style="background:#${theme().c[k]}"></button>`).join('');
    box.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { paint.color = +b.dataset.pc; renderPaintPal(); });
  }
  // a picture from a file: scaled to 80x60 and turned into the theme's 16 colours
  function importImage(file) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = T.PIC_W; c.height = T.PIC_H;
      const g = c.getContext('2d');
      const s = Math.max(T.PIC_W / img.width, T.PIC_H / img.height), w = img.width * s, h = img.height * s;
      g.drawImage(img, (T.PIC_W - w) / 2, (T.PIC_H - h) / 2, w, h);
      const d = g.getImageData(0, 0, T.PIC_W, T.PIC_H).data, cols = T.KEYS.map(k => theme().c[k]).map(h => [0, 2, 4].map(o => parseInt(h.slice(o, o + 2), 16)));
      snapshot();
      const px = new Uint8Array(T.PIC_W * T.PIC_H);
      for (let i = 0; i < px.length; i++) {
        let best = 0, bd = 1e9;
        cols.forEach((c, j) => { const dd = (c[0] - d[i * 4]) ** 2 * 3 + (c[1] - d[i * 4 + 1]) ** 2 * 4 + (c[2] - d[i * 4 + 2]) ** 2 * 2; if (dd < bd) { bd = dd; best = j; } });
        px[i] = best;
      }
      paint.px = px; drawPaint(); paintDone();
      URL.revokeObjectURL(img.src);
      ctx.toast('Picture made from the theme\'s 16 colours: change them under Colours');
    };
    img.onerror = () => ctx.toast('Could not read that picture');
    img.src = URL.createObjectURL(file);
  }

  /* ------------------------------------------------------------ the page */
  const esc = s => ctx.escapeHtml(String(s));
  const opts = (k, v) => T.LISTS[k].map(x => `<option value="${x}" ${x === v ? 'selected' : ''}>${esc(LABELS[k][x] || x)}</option>`).join('');
  const strip = t => `<span class="mb-strip">${['bg', 'wall', 'wall2', 'card', 'edge', 'accent', 'text'].map(k => `<i style="background:#${t.c[k]}"></i>`).join('')}</span>`;
  let renderT = 0;
  function renderSoon() { clearTimeout(renderT); renderT = setTimeout(render, 30); }
  function render() {
    if (!el) return;
    const t = theme(), p = profile();
    paint.px = null;
    const sel = (k, title) => `<label class="mb-row"><span>${title}</span><select data-k="${k}">${opts(k, t[k])}</select></label>`;
    el.innerHTML = `
    <div class="mb-page">
      <div class="mb-left">
        <canvas id="mbScreen" width="320" height="240" tabindex="0" class="pix" title="The Bit's home screen with this theme. Click it, then use the arrow keys, Z (A) and X (B)."></canvas>
        <div class="mb-tools">
          <button id="mbHome" class="${pv.mode === 'home' ? 'active' : ''}">Home screen</button>
          <button id="mbBoot" title="Play the boot animation (when the Bit switches on)">▶ Boot</button>
          <button id="mbSound" title="Hear the theme's sounds">🔊 Sounds</button>
          <span class="grow"></span>
          <button id="mbExport" title="Save this theme as a .bittheme file to share">Export…</button>
          <button id="mbImport" title="Load a .bittheme file">Import…</button>
          <input type="file" id="mbFile" accept=".bittheme,application/json" hidden>
        </div>
        <p class="dim small">Changes go on the Bit straight away: switch it on in Play mode to see. On the Bit itself the <b>Themes</b> app (Utilities row, press Down on the home screen) does all this with buttons, and <b>Settings › USER</b> has your name.</p>
        <h4>You</h4>
        <div class="mb-grid">
          <label class="mb-row"><span>Your name</span><input id="mbName" maxlength="10" value="${esc(p.name)}" placeholder="shown to other players"></label>
          <label class="mb-row"><span>Bit name</span><input id="mbBit" maxlength="14" value="${esc(p.bit)}" placeholder="PocketBit"></label>
        </div>
        <div class="mb-row"><span>Your colour</span><span class="mb-colors">${PROFILE_COLORS.map(c => `<button class="mb-pc ${c === (p.color | 0) ? 'on' : ''}" data-pcol="${c}" style="background:#${BASE32[c]}"></button>`).join('')}</span></div>
        <p class="dim small">Your name and colour go to the other Bits when you link up, and games show it (<code>player_name(n)</code>). They stay on this Bit otherwise.</p>
      </div>
      <div class="mb-right">
        <h4>Start from</h4>
        <div class="mb-presets">${T.PRESETS.map((x, i) => `<button data-preset="${i}" class="${x.name === t.name ? 'active' : ''}">${strip(x)}${esc(x.name)}</button>`).join('')}</div>
        <div class="mb-presets">${save.mine.map((x, i) => `<button data-mine="${i}" class="${x.name === t.name ? 'active' : ''}">${strip(x)}${esc(x.name)} <span class="dim" data-del="${i}" title="Delete">✕</span></button>`).join('')}
          ${save.mine.length < 4 ? '<button id="mbKeep" title="Keep a copy of this theme in your own list (up to 4)">＋ Save as my theme</button>' : ''}</div>
        <h4>Theme</h4>
        <div class="mb-grid">
          <label class="mb-row"><span>Name</span><input id="mbTName" maxlength="16" value="${esc(t.name)}"></label>
          ${sel('look', 'Screen look')}
        </div>
        <h4>Colours</h4>
        <div class="mb-colorgrid">${T.KEYS.map(k => `<label title="${T.KEY_NAMES[k]}"><input type="color" data-c="${k}" value="#${t.c[k]}"><span>${T.KEY_NAMES[k]}</span></label>`).join('')}</div>
        <h4>Wallpaper</h4>
        <div class="mb-grid">
          ${sel('wall', 'Wallpaper')}
          <label class="mb-row"><span>Motion</span><input type="range" min="0" max="10" data-n="speed" value="${t.speed}"><span class="dim small">${t.speed ? t.speed : 'still'}</span></label>
        </div>
        <div class="mb-paint">
          <canvas id="mbPaint" width="${T.PIC_W}" height="${T.PIC_H}" class="pix" title="Paint: click or drag. Right click picks a colour."></canvas>
          <div>
            <div id="mbPaintPal" class="mb-colors"></div>
            <div class="mb-tools">
              <button data-tool="pen" class="${paint.tool === 'pen' ? 'active' : ''}">Pen</button>
              <button data-tool="fill" class="${paint.tool === 'fill' ? 'active' : ''}">Fill</button>
              <button data-tool="pick" class="${paint.tool === 'pick' ? 'active' : ''}">Pick</button>
              <button id="mbClear" title="Fill the whole picture with the chosen colour">Clear</button>
              <button id="mbPic" title="Make the wallpaper from a picture file">From a picture…</button>
              <input type="file" id="mbPicFile" accept="image/*" hidden>
            </div>
            <p class="dim small">80×60, drawn 4× on the Bit. It uses the 16 colours above, so changing a colour changes the picture.</p>
          </div>
        </div>
        <h4>Letters, cards and bars</h4>
        <div class="mb-grid">
          ${sel('font', 'Letters')}
          <label class="mb-row"><span>Letter outline</span><input type="checkbox" id="mbOutline" ${t.outline ? 'checked' : ''}> <span class="dim small">in the Bars colour</span></label>
          ${sel('card', 'Cards')}
          ${sel('bar', 'Bars')}
        </div>
        <h4>Sounds and boot</h4>
        <div class="mb-grid">
          ${sel('sound', 'Sounds')}
          ${sel('boot', 'Boot animation')}
          <label class="mb-row"><span>Boot text</span><input id="mbBootText" maxlength="16" value="${esc(t.boottext)}" placeholder="the Bit name"></label>
        </div>
      </div>
    </div>`;
    const q = s => el.querySelector(s);
    pv.cv = q('#mbScreen'); pv.img = pv.cv.getContext('2d').createImageData(320, 240);
    pv.cv.onkeydown = e => { const k = BTN[e.key] ?? BTN[e.key.toLowerCase()]; if (k !== undefined) { pv.mask |= 1 << k; e.preventDefault(); } };
    pv.cv.onkeyup = e => { const k = BTN[e.key] ?? BTN[e.key.toLowerCase()]; if (k !== undefined) { pv.mask &= ~(1 << k); e.preventDefault(); } };
    pv.cv.onblur = () => { pv.mask = 0; };
    pv.cv.onclick = () => { audio(); pv.cv.focus(); };
    q('#mbHome').onclick = () => { pv.mode = 'home'; pv.ver++; render(); };
    q('#mbBoot').onclick = () => { audio(); pv.mode = 'boot'; pv.ver++; };
    q('#mbSound').onclick = () => { audio(); ['move', 'row', 'open'].forEach((ev, i) => setTimeout(() => lua(`theme_sfx(theme_fix(BIT and BIT.theme or BOOT and BOOT.theme), "${ev}")`), i * 180)); };
    q('#mbExport').onclick = () => {
      const blob = new Blob([T.exportText(theme())], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = theme().name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.bittheme';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    q('#mbImport').onclick = () => q('#mbFile').click();
    q('#mbFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const t2 = T.importText(await f.text()); snapshot(); save.theme = t2; commit(); render(); ctx.toast(`Theme "${t2.name}" is on the Bit`); }
      catch (err) { ctx.toast(err.message); }
    };
    q('#mbName').onchange = e => { setProfile('name', cleanName(e.target.value, 10)); e.target.value = cleanName(e.target.value, 10); };
    q('#mbBit').onchange = e => { setProfile('bit', cleanName(e.target.value, 14)); e.target.value = cleanName(e.target.value, 14); };
    el.querySelectorAll('[data-pcol]').forEach(b => b.onclick = () => { setProfile('color', +b.dataset.pcol); render(); });
    el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { snapshot(); save.theme = JSON.parse(JSON.stringify(T.PRESETS[+b.dataset.preset])); commit(); render(); });
    el.querySelectorAll('[data-mine]').forEach(b => b.onclick = async e => {
      const i = +b.dataset.mine;
      if (e.target.dataset.del !== undefined) {
        if (!(await ctx.ask('Delete theme', `Delete "${save.mine[i].name}" from your themes?`, 'Delete'))) return;
        snapshot(); save.mine.splice(i, 1); commit(); render(); return;
      }
      snapshot(); save.theme = JSON.parse(JSON.stringify(save.mine[i])); commit(); render();
    });
    const keep = q('#mbKeep');
    if (keep) keep.onclick = () => {
      snapshot();
      const m = JSON.parse(JSON.stringify(theme()));
      if (T.PRESETS.some(x => x.name === m.name)) m.name = 'MY THEME ' + (save.mine.length + 1);
      save.mine.push(m); save.theme = JSON.parse(JSON.stringify(m)); commit(); render();
    };
    q('#mbTName').onchange = e => edit(t2 => { t2.name = e.target.value; }, true);
    q('#mbBootText').onchange = e => edit(t2 => { t2.boottext = e.target.value; }, true);
    q('#mbOutline').onchange = e => edit(t2 => { t2.outline = e.target.checked; });
    el.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => edit(t2 => { t2[s.dataset.k] = s.value; }, s.dataset.k === 'wall'));
    el.querySelectorAll('input[data-n]').forEach(r => r.oninput = () => { r.nextElementSibling.textContent = +r.value || 'still'; edit(t2 => { t2[r.dataset.n] = +r.value; }); });
    el.querySelectorAll('input[data-c]').forEach(inp => {
      inp.onfocus = () => snapshot();
      inp.oninput = () => { theme().c[inp.dataset.c] = inp.value.slice(1).toLowerCase(); commit(); drawPaint(); renderPaintPal(); };
    });
    // painter
    const pc = q('#mbPaint');
    pc.oncontextmenu = e => e.preventDefault();
    pc.onpointerdown = e => { paint.down = true; pc.setPointerCapture(e.pointerId); paintAt(e, true); };
    pc.onpointermove = e => { if (paint.down && paint.tool === 'pen' && e.button !== 2) paintAt(e, false); };
    pc.onpointerup = () => { if (paint.down) { paint.down = false; if (paint.tool !== 'pick') paintDone(); } };
    el.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { paint.tool = b.dataset.tool; el.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b)); });
    q('#mbClear').onclick = () => { snapshot(); picPixels().fill(paint.color); drawPaint(); paintDone(); };
    q('#mbPic').onclick = () => q('#mbPicFile').click();
    q('#mbPicFile').onchange = e => { const f = e.target.files[0]; if (f) importImage(f); e.target.value = ''; };
    drawPaint(); renderPaintPal();
    startPreview();
  }

  return {
    init(c) { ctx = c; el = c.el; load(); return this; },
    render() { load(); render(); },
    // the theme or the profile changed on the Bit (the Themes or Settings app): show it here too
    outside() { load(); pv.ver++; if (ctx && ctx.isActive() && !el.contains(document.activeElement)) renderSoon(); },
    undo() { step(undo, redo); },
    redo() { step(redo, undo); },
    stop() { if (pv.actx && pv.actx.state === 'running') pv.actx.suspend(); },
    get preview() { return pv; },
  };
})();
