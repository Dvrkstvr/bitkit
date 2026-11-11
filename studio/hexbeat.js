/* BitKit Studio: Hexbeat, the tracker. Rows run down the screen, one column per channel, every cell is
   note, instrument, volume and an effect, written in hex. The song plays through the order list on the left.
   It edits the same songs as Loopbox (studio/loopbox.js); studio/music.js holds the format and the player.
   MIT License. */
'use strict';
window.BKHexbeat = (function () {
  const MU = () => window.BKMusic;
  // piano keys on a QWERTY keyboard (by key position, so other layouts work the same): two octaves
  const KEYS = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28 };
  // sub-columns of a channel: note, instrument (2 digits), volume (2), effect letter, effect value (2)
  const COL_X = [0, 4, 5, 7, 8, 10, 11, 12], COL_W = [3, 1, 1, 1, 1, 1, 1, 1];
  const CH_W = 15, ROWNUM = 4;

  function init(ctx) {
    const { cart, toast, changed, escapeHtml } = ctx;
    const root = document.getElementById('tab-hexbeat');
    const st = { pos: 0, row: 0, ch: 0, col: 0, oct: 4, step: 1, inst: 1, follow: true, clip: null, mute: [], playView: null };
    root.innerHTML = `
      <div class="mus-bar" id="hxSongs"></div>
      <div class="mus-bar hx-transport">
        <button id="hxPlay" class="primary" title="Play the song from the selected order position (Space)">▶ Song</button>
        <button id="hxPlayPat" title="Loop this pattern from the cursor (Enter)">▶ Pattern</button>
        <button id="hxStop" title="Stop (Esc)">■</button>
        <label class="small"><input type="checkbox" id="hxFollow" checked> follow</label>
        <span class="sep"></span>
        <label class="small" title="Beats a minute">Tempo <input type="number" id="hxBpm" min="20" max="400" style="width:54px"></label>
        <label class="small" title="Rows in one beat">Rows/beat <input type="number" id="hxRpb" min="1" max="16" style="width:42px"></label>
        <label class="small" title="Rows in every pattern">Rows <input type="number" id="hxRows" min="4" max="128" style="width:48px"></label>
        <label class="small" title="Channels (voices) this song uses: music takes the top channels, sfx() keeps the rest">Channels <input type="number" id="hxCh" min="1" max="8" style="width:40px"></label>
        <span class="sep"></span>
        <label class="small" title="Octave of the lower piano row (Z X C ...): [ and ] change it">Octave <input type="number" id="hxOct" min="0" max="8" style="width:40px"></label>
        <label class="small" title="Rows the cursor moves down after you type a note">Step <input type="number" id="hxStep" min="0" max="16" style="width:40px"></label>
      </div>
      <div class="hx-main">
        <div class="hx-order">
          <div class="hx-head">Order</div>
          <div id="hxOrder" class="hx-list"></div>
          <div class="hx-btns">
            <button id="hxOrdAdd" title="Play the same pattern again after this one">＋</button>
            <button id="hxOrdDel" title="Take this position out of the order">－</button>
            <button id="hxOrdNew" title="A new empty pattern after this position">New</button>
            <button id="hxOrdClone" title="Copy this pattern into a new one after this position">Clone</button>
            <button id="hxOrdLoop" title="When the song ends it carries on from here">↺ Loop here</button>
          </div>
          <div class="dim small">Click a position to edit its pattern. − and + on a position change which pattern it plays.</div>
        </div>
        <div class="hx-gridwrap" id="hxWrap"><canvas id="hxGrid" tabindex="0" title="Click here, then type notes on the keyboard"></canvas></div>
        <div class="hx-side">
          <div class="hx-head">Instruments</div>
          <div id="hxInstList" class="hx-list"></div>
          <div class="hx-btns"><select id="hxInstAdd"><option value="">＋ Add…</option></select><button id="hxInstDel" title="Delete this instrument">Delete</button></div>
          <div id="hxInstEd" class="hx-inst"></div>
        </div>
      </div>
      <details class="hx-help"><summary>Keys and effects</summary><div id="hxHelp"></div></details>`;
    const $ = id => document.getElementById(id);
    const cv = $('hxGrid'), g = cv.getContext('2d');
    const song = () => MU().current(cart);
    const pat = () => { const s = song(); return s ? s.pats[s.ord[Math.min(st.pos, s.ord.length - 1)]] : null; };

    function edited(redrawAll) {
      const s = song();
      changed(); MU().player.changed(s);
      if (redrawAll) render(); else draw();
    }

    /* ------------------------------------------------ grid drawing */
    let CW = 8, LH = 16, dpr = 1, visRows = 30;
    const COLORS = { bg: '#0d0d16', beat: '#161624', bar: '#1f1f33', text: '#d9d6ea', dim: '#4a4866', note: '#f2efe0', inst: '#6fb6ff', vol: '#8ad35a',
      fx: '#ffb35c', cur: '#3a86d0', play: '#3b2f12', head: '#232336', mute: '#ff6b5e', off: '#ff8a80' };
    function size() {
      const s = song(), wrap = $('hxWrap');
      dpr = window.devicePixelRatio || 1;
      g.font = '13px ui-monospace, Menlo, Consolas, monospace';
      CW = Math.ceil(g.measureText('0').width);
      const w = (ROWNUM + (s ? s.ch : 4) * CH_W) * CW + 8;
      const h = Math.max(200, wrap.clientHeight - 4);
      visRows = Math.floor((h - LH - 6) / LH);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    function cellText(c) {
      const H = MU().hex2;
      if (!c) return ['---', '..', '..', '...'];
      return [MU().noteName(c[1]), c[2] ? H(c[2]) : '..', c[3] >= 0 ? H(c[3]) : '..', c[4] ? c[4] + H(c[5]) : '...'];
    }
    function draw() {
      const s = song();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = cv.width / dpr, Hh = cv.height / dpr;
      g.fillStyle = COLORS.bg; g.fillRect(0, 0, W, Hh);
      g.font = '13px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'top';
      if (!s) { g.fillStyle = COLORS.text; g.fillText('No songs yet: press ＋ New above.', 12, 12); return; }
      const p = pat(), rows = s.rows, H = MU().hex2;
      const playing = MU().player.playing ? MU().player.pos() : null;
      const playRow = playing && (MU().player.pat !== undefined ? s.ord[st.pos] === MU().player.pat : playing[0] === st.pos) ? playing[1] : -1;
      // header: channel names (click: mute)
      g.fillStyle = COLORS.head; g.fillRect(0, 0, W, LH + 2);
      for (let c = 0; c < s.ch; c++) {
        const x = (ROWNUM + c * CH_W) * CW + 4;
        const name = (s.tracks[c] && s.tracks[c].name || 'Ch ' + (c + 1)).slice(0, 10);
        g.fillStyle = st.mute[c] ? COLORS.mute : c === st.ch ? COLORS.text : COLORS.dim;
        g.fillText((st.mute[c] ? '✕ ' : (c + 1) + ' ') + name, x, 2);
      }
      // rows, the cursor row stays in the middle
      const mid = Math.floor(visRows / 2), top = LH + 4;
      for (let i = 0; i < visRows; i++) {
        const r = st.row - mid + i;
        if (r < 0 || r >= rows) continue;
        const y = top + i * LH;
        const rpb = s.rpb || 4;
        g.fillStyle = r === playRow ? COLORS.play : r % (rpb * 4) === 0 ? COLORS.bar : r % rpb === 0 ? COLORS.beat : COLORS.bg;
        g.fillRect(0, y, W, LH);
        if (r === st.row) { g.fillStyle = 'rgba(58,134,208,0.18)'; g.fillRect(0, y, W, LH); }
        g.fillStyle = r % rpb === 0 ? COLORS.text : COLORS.dim;
        g.fillText(H(r), 4, y + 1);
        for (let c = 0; c < s.ch; c++) {
          const x0 = (ROWNUM + c * CH_W) * CW + 4;
          const cell = MU().cellAt(p[c] || [], r), t = cellText(cell);
          if (r === st.row && c === st.ch) {
            g.fillStyle = COLORS.cur; g.fillRect(x0 + COL_X[st.col] * CW - 1, y, COL_W[st.col] * CW + 2, LH);
          }
          const dimc = st.mute[c] ? 0.35 : 1;
          g.globalAlpha = dimc;
          g.fillStyle = !cell || !cell[1] ? COLORS.dim : cell[1] < 0 ? COLORS.off : COLORS.note; g.fillText(t[0], x0, y + 1);
          g.fillStyle = cell && cell[2] ? COLORS.inst : COLORS.dim; g.fillText(t[1], x0 + 4 * CW, y + 1);
          g.fillStyle = cell && cell[3] >= 0 ? COLORS.vol : COLORS.dim; g.fillText(t[2], x0 + 7 * CW, y + 1);
          g.fillStyle = cell && cell[4] ? COLORS.fx : COLORS.dim; g.fillText(t[3], x0 + 10 * CW, y + 1);
          g.globalAlpha = 1;
          g.fillStyle = '#2a2a40'; g.fillRect(x0 - 6, y, 1, LH);
        }
      }
      // what the cursor is on
      const cell = MU().cellAt(p[st.ch] || [], st.row);
      let tip = '';
      if (st.col === 0) tip = 'Note: piano keys (Z S X D C … and Q 2 W 3 E …), 1 = note off, Delete clears';
      else if (st.col <= 2) { const I = s.inst[(cell && cell[2] || st.inst) - 1]; tip = 'Instrument: type hex' + (I ? ` (${H(cell && cell[2] || st.inst)} ${I.name})` : ''); }
      else if (st.col <= 4) tip = 'Volume 00-FF (.. = full)';
      else { const f = cell && cell[4] && MU().FX[cell[4]]; tip = f ? `${cell[4]} ${f[0]}: ${f[1]}` : 'Effect: type a letter (A U D G V W P C R S J B), then its value in hex'; }
      $('hxTip') && ($('hxTip').textContent = tip);
    }
    function scrollTo() { const wrap = $('hxWrap'); const x = (ROWNUM + st.ch * CH_W) * CW; if (x < wrap.scrollLeft || x + CH_W * CW > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = Math.max(0, x - 40); }

    /* ------------------------------------------------ panels */
    function renderOrder() {
      const s = song(), el = $('hxOrder');
      if (!s) { el.innerHTML = ''; return; }
      const H = MU().hex2;
      el.innerHTML = s.ord.map((p, i) => `<div class="hx-item ${i === st.pos ? 'sel' : ''}" data-i="${i}"><span class="dim">${H(i)}</span>
        <button class="hx-mini" data-dn="${i}">−</button><b>${H(p)}</b><button class="hx-mini" data-up="${i}">+</button>${i === s.loop ? '<span class="hx-loop" title="loops back to here">↺</span>' : ''}</div>`).join('') +
        `<div class="dim small">${s.pats.length} pattern${s.pats.length === 1 ? '' : 's'}</div>`;
      el.querySelectorAll('.hx-item').forEach(d => d.onclick = e => {
        if (e.target.dataset.up || e.target.dataset.dn) return;
        st.pos = +d.dataset.i; renderOrder(); draw(); cv.focus();
      });
      const bump = (i, d) => {
        let v = s.ord[i] + d;
        if (v >= s.pats.length) { if (d > 0) { s.pats.push(MU().blankPattern(s.ch)); } else v = s.pats.length - 1; }
        s.ord[i] = Math.max(0, v); st.pos = i; edited(true);
      };
      el.querySelectorAll('[data-up]').forEach(b => b.onclick = () => bump(+b.dataset.up, 1));
      el.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => bump(+b.dataset.dn, -1));
    }
    const INST_FIELDS = [['v', 'Volume', 0, 1, 0.05], ['a', 'Attack', 0, 60, 1], ['d', 'Decay', 0, 120, 1], ['s', 'Sustain', 0, 1, 0.05], ['r', 'Release', 0, 120, 1],
      ['sw', 'Pitch sweep', -4, 4, 0.1], ['vb', 'Vibrato', 0, 2, 0.05], ['p', 'Pan', -1, 1, 0.1]];
    function renderInst() {
      const s = song(), list = $('hxInstList'), ed = $('hxInstEd');
      if (!s) { list.innerHTML = ''; ed.innerHTML = ''; return; }
      if (st.inst > s.inst.length) st.inst = Math.max(1, s.inst.length);
      const H = MU().hex2;
      list.innerHTML = s.inst.map((I, i) => `<div class="hx-item ${i + 1 === st.inst ? 'sel' : ''}" data-i="${i + 1}"><span class="inst-n">${H(i + 1)}</span> ${escapeHtml(I.name || '')} <span class="dim small">${MU().WAVES[I.w] || ''}</span></div>`).join('');
      list.querySelectorAll('.hx-item').forEach(d => d.onclick = () => { st.inst = +d.dataset.i; renderInst(); MU().player.note(s, st.inst, s.inst[st.inst - 1].drum ? s.inst[st.inst - 1].n : 60); cv.focus(); });
      const I = s.inst[st.inst - 1];
      if (!I) { ed.innerHTML = '<p class="dim small">No instruments: add one.</p>'; return; }
      ed.innerHTML = `<label>Name <input id="hxIName" value="${escapeHtml(I.name || '')}" size="10"></label>
        <label>Wave <select id="hxIWave">${MU().WAVES.map((w, i) => `<option value="${i}" ${i === (I.w | 0) ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        ${INST_FIELDS.map(([k, label, mn, mx, stp]) => `<label title="${label}">${label} <input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${stp}" value="${+I[k] || 0}"><span class="dim small" data-v="${k}">${+I[k] || 0}</span></label>`).join('')}
        <label title="A drum plays this note on Loopbox's drum grid"><input type="checkbox" id="hxIDrum" ${I.drum ? 'checked' : ''}> drum, note <input type="number" id="hxINote" min="1" max="127" value="${I.n | 0}" style="width:48px"> <span class="dim small">${MU().notePlain(I.n | 0 || 60)}</span></label>
        <button id="hxITest">▶ Hear it</button>`;
      $('hxIName').onchange = e => { I.name = e.target.value; edited(true); };
      $('hxIWave').onchange = e => { I.w = +e.target.value; edited(); test(); };
      ed.querySelectorAll('input[type=range]').forEach(r => {
        r.oninput = () => { I[r.dataset.k] = +r.value; ed.querySelector(`[data-v="${r.dataset.k}"]`).textContent = r.value; };
        r.onchange = () => { edited(); test(); };
      });
      $('hxIDrum').onchange = e => { I.drum = e.target.checked; edited(); };
      $('hxINote').onchange = e => { I.n = Math.max(1, Math.min(127, +e.target.value | 0)); edited(true); test(); };
      $('hxITest').onclick = test;
      function test() { MU().player.note(s, st.inst, I.drum ? I.n : 12 * (st.oct + 1), I.drum ? 20 : 30); }
    }
    function renderTransport() {
      const s = song();
      ['hxBpm', 'hxRpb', 'hxRows', 'hxCh'].forEach(id => $(id).disabled = !s);
      if (s) { $('hxBpm').value = s.bpm; $('hxRpb').value = s.rpb; $('hxRows').value = s.rows; $('hxCh').value = s.ch; }
      $('hxOct').value = st.oct; $('hxStep').value = st.step;
    }
    function render() {
      MU().songBar($('hxSongs'), ctx, () => { st.pos = Math.min(st.pos, (song() || { ord: [0] }).ord.length - 1); render(); });
      const s = song();
      if (s) { st.pos = Math.max(0, Math.min(st.pos, s.ord.length - 1)); st.row = Math.min(st.row, s.rows - 1); st.ch = Math.min(st.ch, s.ch - 1); }
      renderTransport(); renderOrder(); renderInst();
      size(); draw();
    }

    /* ------------------------------------------------ transport and song settings */
    const play = (o) => { const s = song(); if (!s) return; MU().player.play(s, o); loop(); };
    $('hxPlay').onclick = () => { play({ pos: st.pos }); cv.focus(); };
    $('hxPlayPat').onclick = () => { const s = song(); play({ pat: s.ord[st.pos], row: st.row }); cv.focus(); };
    $('hxStop').onclick = () => { MU().player.stop(); draw(); cv.focus(); };
    $('hxFollow').onchange = e => { st.follow = e.target.checked; };
    const setNum = (id, key, mn, mx, after) => { $(id).onchange = e => { const s = song(); if (!s) return; s[key] = Math.max(mn, Math.min(mx, +e.target.value || mn)); if (after) after(s); edited(true); }; };
    setNum('hxBpm', 'bpm', 20, 400);
    setNum('hxRpb', 'rpb', 1, 16);
    setNum('hxRows', 'rows', 4, 128, s => s.pats.forEach(p => p.forEach(c => { for (let i = c.length - 1; i >= 0; i--) if (c[i][0] >= s.rows) c.splice(i, 1); })));
    setNum('hxCh', 'ch', 1, 8, s => MU().fix(s));
    $('hxOct').onchange = e => { st.oct = Math.max(0, Math.min(8, +e.target.value | 0)); };
    $('hxStep').onchange = e => { st.step = Math.max(0, Math.min(16, +e.target.value | 0)); };

    $('hxOrdAdd').onclick = () => { const s = song(); if (!s) return; s.ord.splice(st.pos + 1, 0, s.ord[st.pos]); st.pos++; edited(true); };
    $('hxOrdDel').onclick = () => { const s = song(); if (!s || s.ord.length < 2) return; s.ord.splice(st.pos, 1); if (s.loop >= s.ord.length) s.loop = s.ord.length - 1; st.pos = Math.min(st.pos, s.ord.length - 1); edited(true); };
    $('hxOrdNew').onclick = () => { const s = song(); if (!s) return; s.pats.push(MU().blankPattern(s.ch)); s.ord.splice(st.pos + 1, 0, s.pats.length - 1); st.pos++; edited(true); };
    $('hxOrdClone').onclick = () => { const s = song(); if (!s) return; s.pats.push(JSON.parse(JSON.stringify(pat()))); s.ord.splice(st.pos + 1, 0, s.pats.length - 1); st.pos++; edited(true); };
    $('hxOrdLoop').onclick = () => { const s = song(); if (!s) return; s.loop = st.pos; edited(true); };

    const addSel = $('hxInstAdd');
    Object.keys(MU().INST).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = MU().INST[k].name; addSel.appendChild(o); });
    addSel.onchange = () => { const s = song(), k = addSel.value; addSel.value = ''; if (!s || !k) return; if (s.inst.length >= 255) return toast('255 instruments at most'); s.inst.push(Object.assign({}, MU().INST[k])); st.inst = s.inst.length; edited(true); };
    $('hxInstDel').onclick = () => {
      const s = song(); if (!s || !s.inst.length) return;
      const k = st.inst;
      s.inst.splice(k - 1, 1);
      s.pats.forEach(p => p.forEach(c => c.forEach(cell => { if (cell[2] === k) cell[2] = 0; else if (cell[2] > k) cell[2]--; })));
      s.tracks.forEach(t => { if (t.inst === k) t.inst = 1; else if (t.inst > k) t.inst--; });
      st.inst = Math.max(1, k - 1); edited(true);
    };

    // playhead: redraw while the music plays
    let looping = false;
    function loop() {
      if (looping) return;
      looping = true;
      const tick = () => {
        const s = song(), p = MU().player.pos();
        if (!p || !ctx.isActive()) { looping = false; draw(); return; }
        if (st.follow && s) {
          if (MU().player.pat === undefined) { if (st.pos !== p[0]) { st.pos = p[0]; renderOrder(); } }
          st.row = p[1];
        }
        draw();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    /* ------------------------------------------------ editing */
    function cur() {
      const s = song(), p = pat();
      const list = p[st.ch] = p[st.ch] || [];
      return MU().cellAt(list, st.row) ? MU().cellAt(list, st.row).slice() : [st.row, 0, 0, -1, '', 0];
    }
    function put(cell) { MU().setCell(pat()[st.ch], cell); }
    function move(dr, dc) {
      const s = song();
      if (dr) st.row = Math.max(0, Math.min(s.rows - 1, st.row + dr));
      if (dc) {
        st.col += dc;
        if (st.col < 0) { if (st.ch > 0) { st.ch--; st.col = 7; } else st.col = 0; }
        if (st.col > 7) { if (st.ch < s.ch - 1) { st.ch++; st.col = 0; } else st.col = 7; }
        scrollTo();
      }
      draw();
    }
    function advance() { const s = song(); if (st.step) st.row = (st.row + st.step) % s.rows; }
    function setNibble(v, hi, d) { v = v < 0 ? 0 : v; return hi ? (d << 4) | (v & 15) : (v & 0xf0) | d; }
    cv.addEventListener('keydown', e => {
      const s = song();
      if (!s) return;
      const k = e.key, code = e.code, ctrl = e.ctrlKey || e.metaKey;
      let used = true;
      if (k === 'ArrowUp' && ctrl) { transpose(e.shiftKey ? 12 : 1); }
      else if (k === 'ArrowDown' && ctrl) { transpose(e.shiftKey ? -12 : -1); }
      else if (k === 'ArrowUp') move(-1, 0);
      else if (k === 'ArrowDown') move(1, 0);
      else if (k === 'ArrowLeft') move(0, -1);
      else if (k === 'ArrowRight') move(0, 1);
      else if (k === 'Tab') { st.ch = (st.ch + (e.shiftKey ? s.ch - 1 : 1)) % s.ch; st.col = 0; scrollTo(); draw(); }
      else if (k === 'PageUp') move(-(s.rpb * 4), 0);
      else if (k === 'PageDown') move(s.rpb * 4, 0);
      else if (k === 'Home') { st.row = 0; draw(); }
      else if (k === 'End') { st.row = s.rows - 1; draw(); }
      else if (k === ' ') { if (MU().player.playing) { MU().player.stop(); draw(); } else play({ pos: st.pos }); }
      else if (k === 'Enter') { if (MU().player.playing) { MU().player.stop(); draw(); } else play({ pat: s.ord[st.pos], row: st.row }); }
      else if (k === 'Escape') { MU().player.stop(); draw(); }
      else if (k === '[') { st.oct = Math.max(0, st.oct - 1); renderTransport(); toast('Octave ' + st.oct); }
      else if (k === ']') { st.oct = Math.min(8, st.oct + 1); renderTransport(); toast('Octave ' + st.oct); }
      else if (ctrl && k.toLowerCase() === 'c') { st.clip = e.shiftKey ? { all: JSON.parse(JSON.stringify(pat())) } : { one: JSON.parse(JSON.stringify(pat()[st.ch] || [])) }; toast(e.shiftKey ? 'Copied the pattern' : 'Copied this channel'); }
      else if (ctrl && k.toLowerCase() === 'v') {
        if (!st.clip) return toast('Copy with Ctrl+C first (Ctrl+Shift+C: whole pattern)');
        const p = pat();
        if (st.clip.all) st.clip.all.forEach((c, i) => { if (i < s.ch) p[i] = JSON.parse(JSON.stringify(c)); });
        else p[st.ch] = JSON.parse(JSON.stringify(st.clip.one));
        edited();
      }
      else if (ctrl) used = false;
      else if (k === 'Delete' || (k === 'Backspace' && !e.shiftKey && st.col > 0)) {
        const c = cur();
        if (e.shiftKey) { c[1] = 0; c[2] = 0; c[3] = -1; c[4] = ''; c[5] = 0; }
        else if (st.col === 0) { c[1] = 0; c[2] = 0; } else if (st.col <= 2) c[2] = 0; else if (st.col <= 4) c[3] = -1; else { c[4] = ''; c[5] = 0; }
        put(c); advance(); edited();
      }
      else if (k === 'Insert' || (k === 'Backspace')) {     // Insert pushes rows down, Backspace pulls them up
        const list = pat()[st.ch], ins = k === 'Insert';
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i];
          if (ins && c[0] >= st.row) { c[0]++; if (c[0] >= s.rows) list.splice(i, 1); }
          else if (!ins && c[0] === st.row - 1 && st.row > 0) list.splice(i, 1);
          else if (!ins && c[0] >= st.row && st.row > 0) c[0]--;
        }
        if (!ins && st.row > 0) st.row--;
        edited();
      }
      else if (st.col === 0 && code === 'Digit1') { const c = cur(); c[1] = -1; c[2] = 0; put(c); advance(); edited(); }
      else if (st.col === 0 && KEYS[code] !== undefined && !e.altKey) {
        const n = 12 * (st.oct + 1) + KEYS[code];
        if (n > 127) return;
        const c = cur(); c[1] = n; c[2] = st.inst;
        put(c); MU().player.note(s, st.inst, n, 16); advance(); edited();
      }
      else if (st.col > 0 && st.col !== 5 && /^[0-9a-fA-F]$/.test(k)) {
        const d = parseInt(k, 16), c = cur();
        if (st.col <= 2) { c[2] = setNibble(c[2], st.col === 1, d); if (c[2]) st.inst = Math.min(c[2], Math.max(1, s.inst.length)); }
        else if (st.col <= 4) c[3] = setNibble(c[3], st.col === 3, d);
        else { c[5] = setNibble(c[5], st.col === 6, d); if (!c[4]) c[4] = 'A'; }
        put(c); advance(); edited(); renderInst();
      }
      else if (st.col === 5 && /^[a-zA-Z]$/.test(k) && MU().FX[k.toUpperCase()]) { const c = cur(); c[4] = k.toUpperCase(); put(c); advance(); edited(); }
      else if (st.col === 5 && k === '.') { const c = cur(); c[4] = ''; c[5] = 0; put(c); advance(); edited(); }
      else used = false;
      if (used) e.preventDefault();
    });
    function transpose(d) {
      const c = cur();
      if (c[1] > 0) { c[1] = Math.max(1, Math.min(127, c[1] + d)); put(c); MU().player.note(song(), c[2] || st.inst, c[1], 14); edited(); }
    }
    cv.addEventListener('mousedown', e => {
      const s = song(); if (!s) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      cv.focus();
      if (y < LH + 4) {   // header: mute a channel
        const c = Math.floor((x / CW - ROWNUM) / CH_W);
        if (c >= 0 && c < s.ch) { st.mute[c] = !st.mute[c]; MU().player.mute(c, st.mute[c]); draw(); }
        return;
      }
      const i = Math.floor((y - LH - 4) / LH), mid = Math.floor(visRows / 2), row = st.row - mid + i;
      if (row < 0 || row >= s.rows) return;
      const cx = x / CW - ROWNUM, c = Math.floor(cx / CH_W);
      if (c < 0 || c >= s.ch) return;
      const within = cx - c * CH_W - 0.5;
      let col = 0;
      COL_X.forEach((cxp, j) => { if (within >= cxp - 0.5) col = j; });
      st.row = row; st.ch = c; st.col = col; draw();
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); move(Math.sign(e.deltaY) * (e.shiftKey ? 4 : 1), 0); }, { passive: false });
    new ResizeObserver(() => { if (ctx.isActive()) { size(); draw(); } }).observe($('hxWrap'));

    $('hxHelp').innerHTML = `<div class="hx-helpcols"><div><b>Keys</b> (click the pattern first)<br>
      Piano: <code>Z S X D C V G B H N J M</code> and <code>Q 2 W 3 E R 5 T 6 Y 7 U I</code> (an octave up). <code>1</code> note off.<br>
      <code>[</code> <code>]</code> octave · arrows move · <code>Tab</code> next channel · <code>PgUp</code>/<code>PgDn</code> a bar<br>
      Hex digits in the instrument, volume and effect value columns · a letter in the effect column<br>
      <code>Delete</code> clear (Shift: whole cell) · <code>Insert</code>/<code>Backspace</code> push rows down/pull up<br>
      <code>Ctrl+↑/↓</code> transpose (Shift: octave) · <code>Ctrl+C</code>/<code>Ctrl+V</code> channel (Shift: whole pattern)<br>
      <code>Space</code> play song · <code>Enter</code> loop pattern · <code>Esc</code> stop · click a channel name to mute it<br>
      Games play songs with <code>music(1)</code>, <code>music("name")</code> and <code>music_stop()</code>.</div>
      <div><b>Effects</b><br>${Object.keys(MU().FX).map(k => `<code>${k}</code> ${MU().FX[k][0]}: <span class="dim">${MU().FX[k][1]}</span>`).join('<br>')}</div></div>`;
    root.querySelector('.hx-transport').insertAdjacentHTML('beforeend', '<span class="dim small" id="hxTip"></span>');

    return { render, focus: () => cv.focus() };
  }
  return { init };
})();
