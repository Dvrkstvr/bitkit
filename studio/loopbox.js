/* BitKit Studio: Loopbox, the loop maker. Tracks down the side, a piano roll (or a drum grid) for the loop you
   are on, and the song as a row of loops at the bottom. It edits the same songs as Hexbeat (studio/hexbeat.js):
   a loop is a pattern, a track is a channel, the song row is the order list. studio/music.js has the format.
   MIT License. */
'use strict';
window.BKLoopbox = (function () {
  const MU = () => window.BKMusic;
  const TRACK_COLORS = ['#ff7a5c', '#5cc8ff', '#ffd23f', '#8ad35a', '#c58aff', '#ff8ad8', '#5cffc8', '#ffa94d'];
  const LETTER = i => i < 26 ? String.fromCharCode(65 + i) : 'L' + (i + 1);

  // a channel's cells as notes {r, len, n, cell} (a note lasts until the next note or note off)
  function notesOf(list, rows) {
    const out = [];
    const ev = list.filter(c => c[1] !== 0).sort((a, b) => a[0] - b[0]);
    ev.forEach((c, i) => {
      if (c[1] <= 0) return;
      const nx = ev[i + 1];
      out.push({ r: c[0], len: (nx ? nx[0] : rows) - c[0], n: c[1], cell: c });
    });
    return out;
  }
  function writeNotes(list, notes, rows) {
    const keep = list.filter(c => c[1] === 0);
    notes = notes.filter(n => n.r >= 0 && n.r < rows && n.len > 0).sort((a, b) => a.r - b.r);
    const out = [];
    notes.forEach((n, i) => {
      const nx = notes[i + 1];
      if (nx && nx.r === n.r) return;             // two notes on one step: the later one wins
      const c = n.cell ? n.cell.slice() : [0, 0, 0, -1, '', 0];
      c[0] = n.r; c[1] = n.n; if (!c[2]) c[2] = n.inst || 1;
      out.push(c);
      const end = Math.min(n.r + n.len, nx ? nx.r : rows);
      if (end < rows && (!nx || end < nx.r)) out.push([end, -1, 0, -1, '', 0]);
    });
    keep.forEach(c => { if (!out.some(o => o[0] === c[0])) out.push(c); });
    out.sort((a, b) => a[0] - b[0]);
    list.length = 0; out.forEach(c => list.push(c));
  }

  function init(ctx) {
    const { cart, toast, changed, escapeHtml } = ctx;
    const root = document.getElementById('tab-loops');
    const st = { pat: 0, arr: 0, track: 0, top: 84, len: 2, mute: [], solo: -1, drag: null, hover: null };
    root.innerHTML = `
      <div class="mus-bar" id="lbSongs"></div>
      <div class="mus-bar lb-transport">
        <button id="lbPlay" class="primary" title="Play the whole song (Space)">▶ Song</button>
        <button id="lbPlayLoop" title="Play this loop over and over (Enter)">⟳ Loop</button>
        <button id="lbStop" title="Stop (Esc)">■</button>
        <span class="sep"></span>
        <label class="small">Tempo <input type="range" id="lbBpm" min="50" max="220" step="1"> <b id="lbBpmV"></b> bpm</label>
        <label class="small" title="Steps in one beat">Steps/beat <select id="lbRpb"><option>2</option><option>3</option><option>4</option><option>6</option><option>8</option></select></label>
        <label class="small" title="How many steps every loop has">Loop length <select id="lbRows"><option>8</option><option>16</option><option>32</option><option>48</option><option>64</option></select></label>
        <span class="dim small" id="lbTip">Click to add a note, drag to move it, drag its end to make it longer, right-click to delete.</span>
      </div>
      <div class="lb-main">
        <div class="lb-tracks"><div id="lbTracks"></div><button id="lbAddTrack" title="Another track (a song has up to 8)">＋ Track</button></div>
        <div class="lb-editor" id="lbWrap"><canvas id="lbRoll" tabindex="0"></canvas></div>
      </div>
      <div class="lb-bottom">
        <div><div class="hx-head">Loops · <span class="lb-sub">click one to edit it</span></div><div id="lbLoops" class="lb-strip"></div></div>
        <div><div class="hx-head">Song · <span class="lb-sub">the loops in the order they play</span></div><div id="lbArr" class="lb-strip"></div></div>
      </div>`;
    const $ = id => document.getElementById(id);
    const cv = $('lbRoll'), g = cv.getContext('2d');
    const song = () => MU().current(cart);
    const loopCells = () => { const s = song(); return s.pats[st.pat] || s.pats[0]; };
    const track = () => song().tracks[st.track];
    function edited(full) { changed(); MU().player.changed(song()); if (full) render(); else { draw(); renderStrips(); } }

    /* ------------------------------------------------ editor canvas */
    let dpr = 1, W = 600, H = 400;
    const KEYW = 44, VELH = 46, RH = 12;
    function size() {
      const wrap = $('lbWrap');
      dpr = window.devicePixelRatio || 1;
      W = Math.max(400, wrap.clientWidth - 4); H = Math.max(240, wrap.clientHeight - 4);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    const stepW = () => (W - KEYW) / song().rows;
    const gridH = () => H - VELH - 4;
    const drums = () => { const s = song(); const l = []; s.inst.forEach((I, i) => { if (I.drum) l.push(i + 1); }); return l; };
    const isDrums = () => track() && track().kind === 'drums';
    function rowsVisible() { return isDrums() ? Math.max(1, drums().length) : Math.floor(gridH() / RH); }
    function laneH() { return isDrums() ? Math.min(34, gridH() / rowsVisible()) : RH; }
    function noteAtY(y) { return st.top + rowsVisible() - 1 - Math.floor(y / RH); }
    function draw() {
      const s = song();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0d0d16'; g.fillRect(0, 0, W, H);
      g.font = '11px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'middle';
      if (!s) { g.fillStyle = '#d9d6ea'; g.fillText('No songs yet: press ＋ New above.', 12, 20); return; }
      const sw = stepW(), gh = gridH(), col = TRACK_COLORS[st.track % 8], rpb = s.rpb || 4;
      const list = loopCells()[st.track] || [];
      // beat lines
      for (let r = 0; r <= s.rows; r++) {
        const x = KEYW + r * sw;
        g.fillStyle = r % (rpb * 4) === 0 ? '#3b3b58' : r % rpb === 0 ? '#2a2a40' : '#181826';
        g.fillRect(Math.round(x), 0, 1, gh);
      }
      if (isDrums()) {
        const lanes = drums(), lh = laneH();
        if (!lanes.length) { g.fillStyle = '#8d8aa6'; g.fillText('No drum sounds in this song: add a Kick, Snare or Hat on the Tracker tab, or tick "drum".', KEYW + 8, 20); }
        lanes.forEach((k, i) => {
          const y = i * lh, I = s.inst[k - 1];
          g.fillStyle = i % 2 ? '#14141f' : '#11111b'; g.fillRect(KEYW, y, W - KEYW, lh);
          g.fillStyle = '#232336'; g.fillRect(0, y, KEYW - 2, lh - 1);
          g.fillStyle = '#d9d6ea'; g.fillText((I.name || '').slice(0, 6), 4, y + lh / 2);
          for (let r = 0; r < s.rows; r++) {
            const c = MU().cellAt(list, r), on = c && c[1] > 0 && c[2] === k;
            const x = KEYW + r * sw;
            g.fillStyle = on ? col : (r % rpb === 0 ? '#262638' : '#1c1c2b');
            if (on) g.globalAlpha = 0.45 + 0.55 * (c[3] >= 0 ? c[3] / 255 : 1);
            g.fillRect(x + 2, y + 3, sw - 4, lh - 6);
            g.globalAlpha = 1;
          }
        });
      } else {
        const nrows = rowsVisible();
        for (let i = 0; i < nrows; i++) {
          const n = st.top + nrows - 1 - i, y = i * RH, black = [1, 3, 6, 8, 10].includes(n % 12);
          g.fillStyle = black ? '#121220' : '#161624'; g.fillRect(KEYW, y, W - KEYW, RH);
          if (n % 12 === 0) { g.fillStyle = '#2f2f48'; g.fillRect(KEYW, y + RH - 1, W - KEYW, 1); }
          g.fillStyle = black ? '#2a2a3c' : '#d6d3e6'; g.fillRect(0, y, KEYW - 2, RH - 1);
          if (n % 12 === 0) { g.fillStyle = '#12121c'; g.fillText(MU().notePlain(n), 4, y + RH / 2); }
        }
        // the other tracks, faint, so parts fit together
        loopCells().forEach((cl, c) => {
          if (c === st.track || c >= s.ch || s.tracks[c].kind === 'drums') return;
          g.fillStyle = TRACK_COLORS[c % 8]; g.globalAlpha = 0.18;
          notesOf(cl, s.rows).forEach(nt => { const y = (st.top + nrows - 1 - nt.n) * RH; if (y >= 0 && y < gh) g.fillRect(KEYW + nt.r * sw, y + 2, nt.len * sw, RH - 4); });
          g.globalAlpha = 1;
        });
        notesOf(list, s.rows).forEach(nt => {
          const y = (st.top + nrows - 1 - nt.n) * RH;
          if (y < -RH || y >= gh) return;
          const v = nt.cell[3] >= 0 ? nt.cell[3] / 255 : 1;
          g.fillStyle = col; g.globalAlpha = 0.5 + 0.5 * v;
          g.fillRect(KEYW + nt.r * sw + 1, y + 1, nt.len * sw - 2, RH - 2);
          g.globalAlpha = 1;
          g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(KEYW + (nt.r + nt.len) * sw - 4, y + 2, 2, RH - 4);
          if (nt.cell[4]) { g.fillStyle = '#12121c'; g.fillText(nt.cell[4], KEYW + nt.r * sw + 3, y + RH / 2); }
        });
      }
      // velocity lane
      const vy = gh + 4;
      g.fillStyle = '#12121c'; g.fillRect(0, vy, W, VELH);
      g.fillStyle = '#8d8aa6'; g.fillText('vel', 4, vy + 10);
      list.forEach(c => {
        if (c[1] <= 0) return;
        const v = c[3] >= 0 ? c[3] / 255 : 1;
        g.fillStyle = col; g.fillRect(KEYW + c[0] * sw + 2, vy + VELH - v * (VELH - 4), Math.max(2, sw - 4), v * (VELH - 4));
      });
      // playhead
      const p = MU().player.pos();
      if (p) {
        const on = MU().player.pat !== undefined ? MU().player.pat === st.pat : s.ord[p[0]] === st.pat;
        if (on) { g.fillStyle = '#fff'; g.globalAlpha = 0.7; g.fillRect(KEYW + p[1] * sw, 0, 2, gh); g.globalAlpha = 1; }
      }
    }
    function hit(e) {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, s = song(), sw = stepW();
      return { x, y, step: Math.floor((x - KEYW) / sw), fx: (x - KEYW) / sw, inVel: y > gridH() + 4, inKeys: x < KEYW };
    }
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      const s = song(); if (!s) return;
      cv.focus();
      const h = hit(e), list = loopCells()[st.track] = loopCells()[st.track] || [];
      if (h.inVel) { st.drag = { kind: 'vel' }; velAt(h); return; }
      if (isDrums()) {
        const lanes = drums(), lane = Math.floor(h.y / laneH()), k = lanes[lane];
        if (!k) return;
        if (h.inKeys) { MU().player.note(s, k, s.inst[k - 1].n, 20); return; }
        if (h.step < 0 || h.step >= s.rows) return;
        const c = MU().cellAt(list, h.step), on = c && c[1] > 0 && c[2] === k;
        st.drag = { kind: 'drum', k, add: !on, last: -1 };
        drumAt(h);
        return;
      }
      const n = noteAtY(h.y);
      if (h.inKeys) { MU().player.note(s, track().inst || 1, n, 20); return; }
      if (h.step < 0 || h.step >= s.rows || n < 1 || n > 127) return;
      const notes = notesOf(list, s.rows), at = notes.find(nt => nt.n === n && h.fx >= nt.r && h.fx < nt.r + nt.len);
      if (e.button === 2 || e.ctrlKey) {   // delete
        if (at) { writeNotes(list, notes.filter(nt => nt !== at), s.rows); edited(); }
        return;
      }
      if (at) {
        const edge = (at.r + at.len - h.fx) * stepW() < 7;
        st.drag = { kind: edge ? 'len' : 'move', note: at, notes, r0: at.r, n0: at.n, s0: h.fx, y0: h.y };
        if (!edge) MU().player.note(s, at.cell[2] || track().inst || 1, at.n, 14);
      } else {
        const nt = { r: h.step, len: st.len, n, inst: track().inst || 1, cell: [h.step, n, track().inst || 1, -1, '', 0] };
        notes.push(nt);
        writeNotes(list, notes, s.rows);
        st.drag = { kind: 'len', note: nt, notes: notesOf(list, s.rows), fresh: true };
        st.drag.note = st.drag.notes.find(x => x.r === nt.r);
        MU().player.note(s, nt.inst, n, 14);
        edited();
      }
    });
    function velAt(h) {
      const s = song(), list = loopCells()[st.track] || [], c = MU().cellAt(list, h.step);
      if (!c || c[1] <= 0) return;
      const v = Math.max(0, Math.min(1, (gridH() + 4 + VELH - h.y) / (VELH - 4)));
      c[3] = v >= 0.99 ? -1 : Math.round(v * 255);
      edited();
    }
    function drumAt(h) {
      const s = song(), list = loopCells()[st.track], d = st.drag;
      if (h.step < 0 || h.step >= s.rows || h.step === d.last) return;
      d.last = h.step;
      const c = MU().cellAt(list, h.step);
      if (d.add) { MU().setCell(list, [h.step, s.inst[d.k - 1].n || 60, d.k, c ? c[3] : -1, c ? c[4] : '', c ? c[5] : 0]); MU().player.note(s, d.k, s.inst[d.k - 1].n, 12); }
      else if (c && c[2] === d.k) MU().setCell(list, [h.step, 0, 0, -1, c[4], c[5]]);
      edited();
    }
    window.addEventListener('mousemove', e => {
      const d = st.drag; if (!d || !song()) return;
      const h = hit(e), s = song(), list = loopCells()[st.track];
      if (d.kind === 'vel') return velAt(h);
      if (d.kind === 'drum') return drumAt(h);
      if (d.kind === 'len') {
        const len = Math.max(1, Math.min(s.rows - d.note.r, Math.round(h.fx - d.note.r + 0.5)));
        if (len !== d.note.len) { d.note.len = len; st.len = len; writeNotes(list, d.notes, s.rows); edited(); }
      } else if (d.kind === 'move') {
        const r = Math.max(0, Math.min(s.rows - d.note.len, d.r0 + Math.round(h.fx - d.s0)));
        const n = Math.max(1, Math.min(127, d.n0 + Math.round((d.y0 - h.y) / RH)));
        if (r !== d.note.r || n !== d.note.n) {
          const moved = n !== d.note.n;
          d.note.r = r; d.note.n = n;
          writeNotes(list, d.notes, s.rows);
          d.notes = notesOf(list, s.rows); d.note = d.notes.find(x => x.r === r) || d.note;
          if (moved) MU().player.note(s, d.note.cell[2] || 1, n, 10);
          edited();
        }
      }
    });
    window.addEventListener('mouseup', () => { st.drag = null; });
    cv.addEventListener('wheel', e => {
      if (isDrums()) return;
      e.preventDefault();
      st.top = Math.max(1, Math.min(127 - rowsVisible() + 1, st.top - Math.sign(e.deltaY) * 2));
      draw();
    }, { passive: false });
    cv.addEventListener('keydown', e => {
      const s = song(); if (!s) return;
      if (e.key === ' ') { e.preventDefault(); toggle(() => MU().player.play(s, { pos: 0 })); }
      else if (e.key === 'Enter') { e.preventDefault(); toggle(() => MU().player.play(s, { pat: st.pat })); }
      else if (e.key === 'Escape') { MU().player.stop(); draw(); }
      else if (e.key === 'ArrowUp' && !isDrums()) { e.preventDefault(); st.top = Math.min(127 - rowsVisible() + 1, st.top + 12); draw(); }
      else if (e.key === 'ArrowDown' && !isDrums()) { e.preventDefault(); st.top = Math.max(1, st.top - 12); draw(); }
    });
    function toggle(start) { if (MU().player.playing) { MU().player.stop(); draw(); } else { start(); loop(); } }

    /* ------------------------------------------------ panels */
    function renderTracks() {
      const s = song(), el = $('lbTracks');
      if (!s) { el.innerHTML = ''; return; }
      el.innerHTML = s.tracks.slice(0, s.ch).map((t, i) => `<div class="lb-track ${i === st.track ? 'sel' : ''}" data-i="${i}" style="--tc:${TRACK_COLORS[i % 8]}">
        <div class="lb-trow"><span class="lb-dot"></span><input class="lb-tname" value="${escapeHtml(t.name)}" data-i="${i}">
          <button class="hx-mini ${st.mute[i] ? 'on' : ''}" data-mute="${i}" title="Mute">M</button><button class="hx-mini ${st.solo === i ? 'on' : ''}" data-solo="${i}" title="Solo">S</button></div>
        <div class="lb-trow"><button class="hx-mini" data-kind="${i}" title="Piano roll or drum grid">${t.kind === 'drums' ? '🥁 drums' : '🎹 keys'}</button>
          ${t.kind === 'drums' ? '' : `<select data-inst="${i}" title="The sound new notes use">${s.inst.map((I, k) => `<option value="${k + 1}" ${k + 1 === t.inst ? 'selected' : ''}>${escapeHtml(I.name)}</option>`).join('')}</select>`}</div></div>`).join('');
      el.querySelectorAll('.lb-track').forEach(d => d.onclick = e => { if (e.target.closest('button,select,input')) return; st.track = +d.dataset.i; render(); cv.focus(); });
      el.querySelectorAll('.lb-tname').forEach(inp => { inp.onfocus = () => { if (st.track !== +inp.dataset.i) { st.track = +inp.dataset.i; draw(); el.querySelectorAll('.lb-track').forEach(d => d.classList.toggle('sel', d.dataset.i === inp.dataset.i)); } }; inp.onchange = () => { s.tracks[+inp.dataset.i].name = inp.value.trim() || 'Track'; edited(); }; });
      el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { const t = s.tracks[+b.dataset.kind]; t.kind = t.kind === 'drums' ? 'keys' : 'drums'; st.track = +b.dataset.kind; edited(true); });
      el.querySelectorAll('[data-inst]').forEach(sel => sel.onchange = () => { s.tracks[+sel.dataset.inst].inst = +sel.value; edited(); MU().player.note(s, +sel.value, 60, 20); });
      el.querySelectorAll('[data-mute]').forEach(b => b.onclick = () => { const i = +b.dataset.mute; st.mute[i] = !st.mute[i]; applyMutes(); renderTracks(); });
      el.querySelectorAll('[data-solo]').forEach(b => b.onclick = () => { const i = +b.dataset.solo; st.solo = st.solo === i ? -1 : i; applyMutes(); renderTracks(); });
      $('lbAddTrack').disabled = s.ch >= 8;
    }
    function applyMutes() { const s = song(); for (let i = 0; i < s.ch; i++) MU().player.mute(i, st.mute[i] || (st.solo >= 0 && st.solo !== i)); }
    function mini(cvs, p) {
      const s = song(), c = cvs.getContext('2d'), w = cvs.width, h = cvs.height;
      c.fillStyle = '#12121c'; c.fillRect(0, 0, w, h);
      const lh = h / s.ch;
      p.slice(0, s.ch).forEach((cl, ch) => {
        c.fillStyle = TRACK_COLORS[ch % 8];
        cl.forEach(cell => { if (cell[1] > 0) c.fillRect(cell[0] / s.rows * w, ch * lh + 1, Math.max(1, w / s.rows - 0.5), lh - 2); });
      });
    }
    function renderStrips() {
      const s = song(), lp = $('lbLoops'), ar = $('lbArr');
      if (!s) { lp.innerHTML = ''; ar.innerHTML = ''; return; }
      lp.innerHTML = s.pats.map((p, i) => `<div class="lb-pad ${i === st.pat ? 'sel' : ''}" data-i="${i}"><b>${LETTER(i)}</b><canvas width="64" height="28"></canvas></div>`).join('') +
        `<div class="lb-padbtns"><button id="lbNewLoop" title="A new empty loop">＋ New</button><button id="lbDupLoop" title="Copy this loop">Copy</button><button id="lbAddToSong" title="Play this loop at the end of the song">Add to song ↓</button></div>`;
      lp.querySelectorAll('.lb-pad').forEach(d => { mini(d.querySelector('canvas'), s.pats[+d.dataset.i]); d.onclick = () => { st.pat = +d.dataset.i; renderStrips(); render(); cv.focus(); }; });
      const p = MU().player.pos();
      ar.innerHTML = s.ord.map((pi, i) => `<div class="lb-block ${i === st.arr ? 'sel' : ''} ${p && MU().player.pat === undefined && p[0] === i ? 'now' : ''}" data-i="${i}" title="Click: edit this loop">
        ${i === s.loop ? '<span class="hx-loop" title="the song loops back to here">↺</span>' : ''}<b>${LETTER(pi)}</b><canvas width="40" height="20"></canvas>
        <button class="hx-mini" data-left="${i}" title="Move earlier">‹</button><button class="hx-mini" data-x="${i}" title="Remove from the song">×</button></div>`).join('') +
        `<div class="lb-padbtns"><button id="lbLoopHere" title="When the song ends it carries on from the selected loop">↺ Loop from here</button></div>`;
      ar.querySelectorAll('.lb-block').forEach(d => {
        mini(d.querySelector('canvas'), s.pats[s.ord[+d.dataset.i]] || []);
        d.onclick = e => { if (e.target.dataset.x || e.target.dataset.left) return; st.arr = +d.dataset.i; st.pat = s.ord[st.arr]; render(); };
      });
      ar.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { if (s.ord.length < 2) return toast('A song needs at least one loop'); s.ord.splice(+b.dataset.x, 1); if (s.loop >= s.ord.length) s.loop = s.ord.length - 1; st.arr = Math.min(st.arr, s.ord.length - 1); edited(); });
      ar.querySelectorAll('[data-left]').forEach(b => b.onclick = () => { const i = +b.dataset.left; if (i < 1) return; [s.ord[i - 1], s.ord[i]] = [s.ord[i], s.ord[i - 1]]; st.arr = i - 1; edited(); });
      $('lbNewLoop').onclick = () => { s.pats.push(MU().blankPattern(s.ch)); st.pat = s.pats.length - 1; edited(); };
      $('lbDupLoop').onclick = () => { s.pats.push(JSON.parse(JSON.stringify(loopCells()))); st.pat = s.pats.length - 1; edited(); };
      $('lbAddToSong').onclick = () => { s.ord.push(st.pat); st.arr = s.ord.length - 1; edited(); };
      $('lbLoopHere').onclick = () => { s.loop = st.arr; edited(); };
    }
    function renderTransport() {
      const s = song();
      ['lbBpm', 'lbRpb', 'lbRows'].forEach(id => $(id).disabled = !s);
      if (!s) return;
      $('lbBpm').value = s.bpm; $('lbBpmV').textContent = s.bpm;
      const ensure = (sel, v) => { if (![...sel.options].some(o => +o.value === v)) { const o = document.createElement('option'); o.textContent = v; sel.appendChild(o); } sel.value = String(v); };
      ensure($('lbRpb'), s.rpb); ensure($('lbRows'), s.rows);
    }
    // scroll the piano roll to where this track's notes are
    function center() {
      const s = song();
      if (!s || isDrums()) return;
      const ns = notesOf(loopCells()[st.track] || [], s.rows).map(n => n.n), vis = rowsVisible();
      const mid = ns.length ? Math.round((Math.min(...ns) + Math.max(...ns)) / 2) : 60;
      st.top = Math.max(1, Math.min(127 - vis + 1, mid - (vis >> 1)));
    }
    let seen = '';
    function render() {
      MU().songBar($('lbSongs'), ctx, render);
      const s = song();
      if (s) { st.pat = Math.min(st.pat, s.pats.length - 1); st.track = Math.min(st.track, s.ch - 1); st.arr = Math.min(st.arr, s.ord.length - 1); }
      renderTransport(); renderTracks(); renderStrips();
      size();
      const now = s ? [MU().shared.sel, st.pat, st.track].join() : '';
      if (now !== seen) { seen = now; center(); }
      draw();
    }

    $('lbBpm').oninput = e => { $('lbBpmV').textContent = e.target.value; };
    $('lbBpm').onchange = e => { song().bpm = +e.target.value; edited(); };
    $('lbRpb').onchange = e => { song().rpb = +e.target.value; edited(); };
    $('lbRows').onchange = e => {
      const s = song(), v = +e.target.value;
      s.rows = v; s.pats.forEach(p => p.forEach(c => { for (let i = c.length - 1; i >= 0; i--) if (c[i][0] >= v) c.splice(i, 1); }));
      edited(true);
    };
    $('lbPlay').onclick = () => { MU().player.stop(); MU().player.play(song(), { pos: 0 }); loop(); cv.focus(); };
    $('lbPlayLoop').onclick = () => { MU().player.stop(); MU().player.play(song(), { pat: st.pat }); loop(); cv.focus(); };
    $('lbStop').onclick = () => { MU().player.stop(); draw(); renderStrips(); };
    $('lbAddTrack').onclick = () => {
      const s = song(); if (!s || s.ch >= 8) return;
      s.ch++; MU().fix(s); s.tracks[s.ch - 1] = { name: 'Track ' + s.ch, kind: 'keys', inst: 1 }; st.track = s.ch - 1; edited(true);
    };

    let looping = false, lastArr = -2;
    function loop() {
      if (looping) return;
      looping = true;
      const tick = () => {
        const p = MU().player.pos();
        if (!p || !ctx.isActive()) { looping = false; draw(); renderStrips(); return; }
        draw();
        const a = MU().player.pat === undefined ? p[0] : -1;
        if (a !== lastArr) { lastArr = a; renderStrips(); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    new ResizeObserver(() => { if (ctx.isActive() && song()) { size(); draw(); } }).observe($('lbWrap'));
    return { render };
  }
  return { init, notesOf, writeNotes };
})();
