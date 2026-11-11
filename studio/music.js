/* BitKit Studio: songs shared by the two music makers (Hexbeat, the tracker, and Loopbox, the loop maker).
   A song lives in cart.entities.songs (so it is saved, undone and sent to the game like everything else),
   and the runtime's music player (runtime/bk_music.lua) plays it in games as SONGS[n].

   Song (JS): { name, bpm, rpb (rows per beat), rows (rows per pattern), ch (channels 1-8), loop (order position, from 0),
     inst: [{name, w, v, a, d, s, r, sw, vb, p, n, drum}], pats: [[cells of channel 1], [cells of channel 2], ...],
     ord: [pattern index, ...], tracks: [{name, kind: 'keys'|'drums', inst}] }
   A cell: [row, note (1-127 MIDI, -1 note off, 0 none), inst (from 1, 0 keep), vol (0-255, -1 none), fx ('' or a letter), fv (0-255)].
   MIT License. */
'use strict';
window.BKMusic = (function () {
  const NOTE = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  const NOTE_PLAIN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = n => n < 0 ? 'OFF' : n > 0 ? NOTE[n % 12] + (Math.floor(n / 12) - 1) : '---';
  const notePlain = n => NOTE_PLAIN[n % 12] + (Math.floor(n / 12) - 1);
  const WAVES = ['square', 'triangle', 'saw', 'noise', 'sine', 'thin pulse'];
  const FX = {
    A: ['Arpeggio', 'xy: the note, +x and +y semitones, one each frame (chords on one channel)'],
    U: ['Slide up', 'PP/16 semitones a frame'],
    D: ['Slide down', 'PP/16 semitones a frame'],
    G: ['Glide', 'slide to this row\'s note at PP/16 semitones a frame instead of starting it again'],
    V: ['Vibrato', 'x speed, y depth (eighths of a semitone)'],
    W: ['Volume slide', 'x up, y down, every frame'],
    P: ['Pan', '00 left, 80 middle, FF right'],
    C: ['Cut', 'silence the note after PP frames'],
    R: ['Retrigger', 'start the note again every PP frames (rolls, stutters)'],
    S: ['Tempo', 'set the tempo to PP bpm (hex: 78 = 120)'],
    J: ['Jump', 'after this row, go to order position PP'],
    B: ['Break', 'after this row, go to the next pattern'],
  };
  const hex2 = v => (v & 255).toString(16).toUpperCase().padStart(2, '0');

  /* ------------------------------------------------------------ songs */
  const INST = {
    lead: { name: 'Lead', w: 5, v: 0.5, a: 0, d: 14, s: 0.55, r: 10, sw: 0, vb: 0.15, p: 0, n: 72 },
    bass: { name: 'Bass', w: 1, v: 0.9, a: 0, d: 8, s: 0.7, r: 5, sw: 0, vb: 0, p: 0, n: 45 },
    kick: { name: 'Kick', w: 4, v: 1, a: 0, d: 10, s: 0, r: 0, sw: -1.3, vb: 0, p: 0, n: 52, drum: true },
    snare: { name: 'Snare', w: 3, v: 0.55, a: 0, d: 9, s: 0, r: 0, sw: -0.3, vb: 0, p: 0, n: 86, drum: true },
    hat: { name: 'Hat', w: 3, v: 0.28, a: 0, d: 3, s: 0, r: 0, sw: 0, vb: 0, p: 0.3, n: 112, drum: true },
    pad: { name: 'Pad', w: 2, v: 0.3, a: 14, d: 20, s: 0.6, r: 30, sw: 0, vb: 0.1, p: -0.2, n: 60 },
    pluck: { name: 'Pluck', w: 0, v: 0.45, a: 0, d: 10, s: 0, r: 0, sw: 0, vb: 0, p: 0.2, n: 72 },
    clap: { name: 'Clap', w: 3, v: 0.45, a: 0, d: 6, s: 0, r: 0, sw: 0, vb: 0, p: -0.2, n: 96, drum: true },
    tom: { name: 'Tom', w: 4, v: 0.8, a: 0, d: 14, s: 0, r: 0, sw: -0.5, vb: 0, p: 0, n: 57, drum: true },
  };
  const inst = k => Object.assign({}, INST[k]);
  function blankPattern(ch) { return Array.from({ length: ch }, () => []); }
  // a small original groove so a new song makes a sound straight away
  function newSong(name) {
    const s = { name: name || 'Song 1', bpm: 120, rpb: 4, rows: 32, ch: 4, loop: 1,
      inst: [inst('lead'), inst('bass'), inst('kick'), inst('snare'), inst('hat'), inst('pad')],
      pats: [blankPattern(4), blankPattern(4)], ord: [0, 1, 1],
      tracks: [{ name: 'Lead', kind: 'keys', inst: 1 }, { name: 'Bass', kind: 'keys', inst: 2 }, { name: 'Drums', kind: 'drums', inst: 3 }, { name: 'Hats', kind: 'drums', inst: 5 }] };
    const roots = [45, 41, 48, 43];   // A F C G
    s.pats.forEach((p, pi) => {
      roots.forEach((rt, k) => {
        const r0 = k * 8;
        [0, 3, 6].forEach((o, j) => { p[1].push([r0 + o, j === 2 ? rt + 12 : rt, 2, -1, '', 0]); if (j < 2) p[1].push([r0 + o + 2, -1, 0, -1, '', 0]); });
      });
      for (let r = 0; r < 32; r += 4) p[2].push([r, r % 8 === 0 ? 52 : 86, r % 8 === 0 ? 3 : 4, -1, '', 0]);
      for (let r = 0; r < 32; r += 2) p[3].push([r, 112, 5, r % 4 === 0 ? 255 : 150, '', 0]);
      if (pi === 1) {
        const mel = [[0, 76, 3], [4, 72, 2], [6, 74, 2], [8, 72, 4], [12, 69, 4], [16, 67, 3], [20, 69, 2], [22, 72, 2], [24, 74, 6], [30, 71, 2]];
        mel.forEach(([r, n, len]) => { p[0].push([r, n, 1, -1, r === 24 ? 'V' : '', r === 24 ? 0x42 : 0]); if (r + len < 32 && !mel.some(m => m[0] === r + len)) p[0].push([r + len, -1, 0, -1, '', 0]); });
      } else {
        p[0].push([0, 69, 6, -1, '', 0], [8, 65, 6, -1, '', 0], [16, 72, 6, -1, '', 0], [24, 67, 6, -1, '', 0], [31, -1, 0, -1, '', 0]);
      }
      p.forEach(c => c.sort((a, b) => a[0] - b[0]));
    });
    return s;
  }
  function fix(s) {     // fill in anything an older or hand-made song lacks
    s.name = s.name || 'Song'; s.bpm = s.bpm || 120; s.rpb = s.rpb || 4; s.rows = Math.max(1, Math.min(128, s.rows || 32));
    s.ch = Math.max(1, Math.min(8, s.ch || 4)); s.inst = s.inst || []; s.pats = s.pats && s.pats.length ? s.pats : [blankPattern(s.ch)];
    s.pats.forEach(p => { while (p.length < s.ch) p.push([]); });
    s.ord = s.ord && s.ord.length ? s.ord : [0]; s.loop = Math.max(0, Math.min(s.ord.length - 1, s.loop | 0));
    s.tracks = s.tracks || [];
    for (let c = 0; c < s.ch; c++) if (!s.tracks[c]) s.tracks[c] = { name: 'Track ' + (c + 1), kind: 'keys', inst: 1 };
    return s;
  }
  // cells of one channel as a row -> cell map (and back)
  const cellAt = (list, r) => list.find(c => c[0] === r) || null;
  function setCell(list, cell) {
    const i = list.findIndex(c => c[0] === cell[0]);
    const empty = !cell[1] && !cell[2] && cell[3] < 0 && !cell[4];
    if (i >= 0) { if (empty) list.splice(i, 1); else list[i] = cell; }
    else if (!empty) { list.push(cell); list.sort((a, b) => a[0] - b[0]); }
  }

  /* ------------------------------------------------------------ Lua */
  function pack(list) {
    return list.map(c => hex2(c[0]) + hex2(c[1] < 0 ? 255 : c[1]) + hex2(c[2] || 0) + (c[3] < 0 ? '..' : hex2(c[3])) + (c[4] || '.') + hex2(c[5] || 0)).join('');
  }
  function unpack(str) {
    const out = [];
    for (let i = 0; i + 11 <= str.length; i += 11) {
      const nn = str.substr(i + 2, 2), vv = str.substr(i + 6, 2), fx = str[i + 8];
      out.push([parseInt(str.substr(i, 2), 16), nn === 'FF' ? -1 : parseInt(nn, 16) || 0, parseInt(str.substr(i + 4, 2), 16) || 0,
        vv === '..' ? -1 : parseInt(vv, 16), fx === '.' ? '' : fx, parseInt(str.substr(i + 9, 2), 16) || 0]);
    }
    return out;
  }
  const num = v => { v = +v || 0; return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000); };
  const qs = s => '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/\n/g, ' ') + '"';
  function instLua(I) {
    return `{name=${qs(I.name || '')}, w=${I.w | 0}, v=${num(I.v)}, a=${num(I.a)}, d=${num(I.d)}, s=${num(I.s)}, r=${num(I.r)}, sw=${num(I.sw)}, vb=${num(I.vb)}, p=${num(I.p)}, n=${I.n | 0}${I.drum ? ', drum=true' : ''}}`;
  }
  function songLua(s) {
    fix(s);
    return `{name=${qs(s.name)}, bpm=${num(s.bpm)}, rpb=${s.rpb | 0}, rows=${s.rows | 0}, ch=${s.ch | 0}, loop=${(s.loop | 0) + 1},\n` +
      `  inst={${s.inst.map(instLua).join(', ')}},\n` +
      `  pat={${s.pats.map(p => '{' + p.slice(0, s.ch).map(c => qs(pack(c))).join(', ') + '}').join(',\n    ')}},\n` +
      `  ord={${s.ord.map(o => o + 1).join(', ')}},\n` +
      `  tr={${s.tracks.slice(0, s.ch).map(t => `{name=${qs(t.name)}, kind=${qs(t.kind)}, inst=${t.inst | 0}}`).join(', ')}}}`;
  }
  function toLua(songs) {
    if (!songs || !songs.length) return '';
    return '-- songs from the studio\'s Tracker and Loops tabs: music(1) plays the first\nSONGS = {\n' + songs.map(s => '  ' + songLua(s)).join(',\n') + '\n}\n';
  }
  // a Lua value as save() writes it ({[k]=v,...}, %q strings) -> JS (arrays for 1..n keys)
  function parseLua(str) {
    let i = 0;
    const ws = () => { while (i < str.length && /\s/.test(str[i])) i++; };
    function val() {
      ws();
      const ch = str[i];
      if (ch === '{') {
        i++;
        const o = {}; let n = 1, arr = true;
        for (;;) {
          ws();
          if (str[i] === '}') { i++; break; }
          let k;
          if (str[i] === '[') { i++; k = val(); ws(); i++; ws(); i++; }
          else if (/[A-Za-z_]/.test(str[i]) && /^[A-Za-z_]\w*\s*=(?!=)/.test(str.slice(i))) { const m = /^([A-Za-z_]\w*)\s*=/.exec(str.slice(i)); k = m[1]; i += m[0].length; }
          else k = n++;
          o[k] = val();
          ws();
          if (str[i] === ',' || str[i] === ';') i++;
        }
        const keys = Object.keys(o);
        keys.forEach((k, j) => { if (String(j + 1) !== k) arr = false; });
        return arr && keys.length ? keys.map(k => o[k]) : o;
      }
      if (ch === '"' || ch === "'") {
        i++; let s = '';
        while (i < str.length && str[i] !== ch) {
          if (str[i] === '\\') {
            i++;
            const e = str[i];
            if (/\d/.test(e)) { const m = /^\d{1,3}/.exec(str.slice(i)); s += String.fromCharCode(+m[0]); i += m[0].length; continue; }
            s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\n' ? '\n' : e; i++; continue;
          }
          s += str[i++];
        }
        i++;
        return s;
      }
      const m = /^(true|false|nil|-?(?:0x[0-9a-fA-F]+|[\d.]+(?:[eE][-+]?\d+)?))/.exec(str.slice(i));
      if (!m) throw new Error('bad save data at ' + i);
      i += m[0].length;
      return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'nil' ? null : Number(m[0]);
    }
    return val();
  }
  // a song as the Bit's music apps keep it (Lua format: from 1, patterns as packed strings) -> JS song
  function fromLuaSong(o) {
    const list = x => Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : [];
    const s = { name: o.name || 'Bit song', bpm: +o.bpm || 120, rpb: +o.rpb || 4, rows: +o.rows || 32, ch: +o.ch || 4, loop: Math.max(0, (+o.loop || 1) - 1),
      inst: list(o.inst).map(I => ({ name: I.name || '', w: I.w | 0, v: +I.v || 0, a: +I.a || 0, d: +I.d || 0, s: +I.s || 0, r: +I.r || 0, sw: +I.sw || 0, vb: +I.vb || 0, p: +I.p || 0, n: I.n | 0, drum: !!I.drum })),
      pats: list(o.pat).map(p => list(p).map(c => typeof c === 'string' ? unpack(c) : [])),
      ord: list(o.ord).map(v => Math.max(0, (v | 0) - 1)),
      tracks: list(o.tr).map(t => ({ name: t.name || 'Track', kind: t.kind === 'drums' ? 'drums' : 'keys', inst: t.inst | 0 || 1 })) };
    return fix(s);
  }
  // Lua table text the way save() writes it (the Bit apps read it with saved())
  function luaSave(v) {
    if (Array.isArray(v)) return '{' + v.map((x, i) => `[${i + 1}]=` + luaSave(x)).join(',') + '}';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).map(k => `[${qs(k)}]=` + luaSave(v[k])).join(',') + '}';
    if (typeof v === 'string') return qs(v);
    if (typeof v === 'boolean') return String(v);
    return num(v);
  }
  function toLuaSong(s) {
    fix(s);
    return { name: s.name, bpm: s.bpm, rpb: s.rpb, rows: s.rows, ch: s.ch, loop: s.loop + 1,
      inst: s.inst.map(I => Object.assign({}, I, { drum: I.drum ? true : undefined })), pat: s.pats.map(p => p.slice(0, s.ch).map(pack)),
      ord: s.ord.map(o => o + 1), tr: s.tracks.slice(0, s.ch) };
  }
  // The Bit's music apps keep their songs in one save file: "Music" (see bitapps.js)
  const BIT_KEY = 'bitkit.save.Music';
  function bitSongs() {
    let raw = null;
    try { raw = localStorage.getItem(BIT_KEY); } catch (e) { /* storage unavailable */ }
    if (!raw) return [];
    try { const o = parseLua(raw); return (Array.isArray(o.songs) ? o.songs : []).map(fromLuaSong); } catch (e) { return []; }
  }
  function putBitSong(song) {
    let o = { songs: [], cur: 1 };
    try { const raw = localStorage.getItem(BIT_KEY); if (raw) o = parseLua(raw); } catch (e) { /* start a new list */ }
    const songs = Array.isArray(o.songs) ? o.songs : [];
    const i = songs.findIndex(x => x && x.name === song.name);
    const lua = toLuaSong(JSON.parse(JSON.stringify(song)));
    if (i >= 0) songs[i] = lua; else songs.push(lua);
    const str = luaSave({ songs, cur: o.cur || 1 });
    if (str.length > 16384) throw new Error('The Bit\'s music save is full (16 KB)');
    localStorage.setItem(BIT_KEY, str);
    return i >= 0 ? 'replaced' : 'added';
  }

  /* ------------------------------------------------------------ player: a second runtime that only plays music */
  const PLAYER = `function _update() local p, r = music_pos() mset(0, 0, p or 0) mset(1, 0, r or 0) end`;
  const eng = { M: null, loading: null, actx: null, node: null, left: 0, idle: 0, song: null, ver: 0, sent: -1, muted: () => false };
  function ready() {
    if (eng.M) return Promise.resolve(eng.M);
    if (!eng.loading) eng.loading = window.BitKitRuntime({ onLog: (m, e) => { if (e) console.warn('music player:', m); } }).then(M => {
      M._bkw_init();
      const d = M.stringToNewUTF8(''), c = M.stringToNewUTF8(PLAYER);
      M._bkw_load_ex(d, c); M._free(d); M._free(c);
      eng.M = M;
      return M;
    });
    return eng.loading;
  }
  function audio() {
    if (eng.actx) { if (eng.actx.state === 'suspended') eng.actx.resume(); return; }
    try {
      eng.actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      eng.node = eng.actx.createScriptProcessor(1024, 0, 2);
      eng.node.onaudioprocess = ev => {
        const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1), M = eng.M;
        if (!M) { L.fill(0); R.fill(0); return; }
        const n = L.length, quiet = eng.muted();
        for (let i = 0; i < n;) {
          if (eng.left <= 0) { M._bkw_frame(0, 0); eng.left = 735; }   // 44100 / 60: one runtime frame
          const k = Math.min(n - i, eng.left), p = M._bkw_audio(k) >> 2, f = M.HEAPF32;
          for (let j = 0; j < k; j++) { L[i + j] = quiet ? 0 : f[p + j * 2]; R[i + j] = quiet ? 0 : f[p + j * 2 + 1]; }
          i += k; eng.left -= k;
        }
      };
      eng.node.connect(eng.actx.destination);
    } catch (e) { console.warn('music: no audio', e); }
  }
  function lua(code) {
    const M = eng.M;
    if (!M) return;
    const p = M.stringToNewUTF8(code);
    M._bkw_eval(p); M._free(p);
  }
  function sendSong(song) {     // keep the player's SONG up to date with the editor
    if (eng.song === song && eng.sent === eng.ver) return;
    eng.song = song; eng.sent = eng.ver;
    lua(`SONG = ${songLua(song)}\nif music_playing() then music_swap(SONG) end`);
  }
  const player = {
    async play(song, o) {
      audio(); await ready();
      eng.sent = -1; sendSong(song);
      o = o || {};
      lua(`music(SONG, {pos = ${(o.pos | 0) + 1}, row = ${o.row | 0}${o.pat !== undefined ? `, pat = ${(o.pat | 0) + 1}` : ''}})`);
      const m = eng.M._bkw_map() >> 1;   // where it starts, until the player's first frame reports it
      eng.M.HEAPU16[m] = o.pat !== undefined ? 1 : (o.pos | 0) + 1; eng.M.HEAPU16[m + 1] = o.row | 0;
      player.playing = true; player.pat = o.pat;
    },
    stop() { lua('music_stop()'); player.playing = false; },
    changed(song) { eng.ver++; if (eng.M) sendSong(song); },   // call after every edit
    async note(song, instIdx, note, frames) {
      audio(); await ready();
      sendSong(song);
      lua(`music_note(SONG, ${instIdx | 0}, ${note | 0}, ${frames || 14})`);
    },
    mute(c, on) { lua(`MUSIC.mute[${c + 1}] = ${on ? 'true' : 'nil'}`); },
    pos() {   // [order position from 0, row] or null
      const M = eng.M;
      if (!M || !player.playing) return null;
      const m = M._bkw_map() >> 1, p = M.HEAPU16[m];
      if (!p) { player.playing = false; return null; }
      return [p - 1, M.HEAPU16[m + 1]];
    },
    setMuted(fn) { eng.muted = fn; },
    playing: false, pat: undefined,
  };

  /* ------------------------------------------------------------ shared song bar (both tabs) */
  // ctx: { cart, toast, changed, ask, escapeHtml } ; opts: { el, onSong, which }
  const shared = { sel: 0, views: [] };
  function songs(cart) { return (cart.entities.songs = cart.entities.songs || []); }
  function current(cart) { const l = songs(cart); if (shared.sel >= l.length) shared.sel = Math.max(0, l.length - 1); return l[shared.sel] ? fix(l[shared.sel]) : null; }
  function uniqueName(cart, base) { let n = base, i = 2; while (songs(cart).some(s => s.name === n)) n = base.replace(/\s*\d*$/, '') + ' ' + i++; return n; }
  function songBar(el, ctx, rerender) {
    const { cart, toast, changed, escapeHtml } = ctx;
    const l = songs(cart), s = current(cart);
    el.innerHTML = `<label class="dim small">Song</label>
      <select class="mus-song">${l.map((x, i) => `<option value="${i}" ${i === shared.sel ? 'selected' : ''}>${i + 1}. ${escapeHtml(x.name)}</option>`).join('')}${l.length ? '' : '<option>(no songs yet)</option>'}</select>
      <input class="mus-name" value="${s ? escapeHtml(s.name) : ''}" ${s ? '' : 'disabled'} title="Song name: music(&quot;name&quot;) plays it too" size="12">
      <button class="mus-new" title="Start a new song with a little groove in it">＋ New</button>
      <button class="mus-dup" ${s ? '' : 'disabled'} title="Copy this song">Copy</button>
      <button class="mus-del" ${s ? '' : 'disabled'} title="Delete this song">Delete</button>
      <span class="sep"></span>
      <button class="mus-tobit" ${s ? '' : 'disabled'} title="Put this song in the Bit's music apps (Hexbeat and Loopbox on the home screen)">→ Bit</button>
      <button class="mus-frombit" title="Bring a song made in the Bit's music apps into this game">← Bit</button>
      <span class="dim small mus-use">${s ? `In your code: <code>music(${shared.sel + 1})</code>` : ''}</span>`;
    const q = c => el.querySelector(c);
    q('.mus-song').onchange = e => { player.stop(); shared.sel = +e.target.value; rerender(); };
    q('.mus-name').onchange = e => { s.name = e.target.value.trim() || s.name; changed(); rerender(); };
    q('.mus-new').onclick = () => { l.push(newSong(uniqueName(cart, 'Song ' + (l.length + 1)))); shared.sel = l.length - 1; changed(); rerender(); toast('New song: play it with Space'); };
    q('.mus-dup').onclick = () => { const c = JSON.parse(JSON.stringify(s)); c.name = uniqueName(cart, s.name + ' copy'); l.push(c); shared.sel = l.length - 1; changed(); rerender(); };
    q('.mus-del').onclick = async () => {
      if (ctx.ask && !(await ctx.ask('Delete song', `Delete "${s.name}"? Undo brings it back.`, 'Delete'))) return;
      player.stop(); l.splice(shared.sel, 1); shared.sel = Math.max(0, shared.sel - 1); changed(); rerender();
    };
    q('.mus-tobit').onclick = () => { try { toast(`"${s.name}" ${putBitSong(s)} in the Bit's music apps`); } catch (e) { toast(e.message); } };
    q('.mus-frombit').onclick = () => {
      const bs = bitSongs();
      if (!bs.length) return toast('No songs on the Bit yet: make one in Hexbeat or Loopbox on the home screen');
      const pick = ctx.pickFrom ? ctx.pickFrom : null;
      const take = i => { const c = bs[i]; c.name = uniqueName(cart, c.name); l.push(c); shared.sel = l.length - 1; changed(); rerender(); toast(`"${c.name}" came from the Bit`); };
      if (pick) pick('Songs on the Bit', bs.map(x => x.name), take); else take(bs.length - 1);
    };
  }

  return { NOTE, noteName, notePlain, WAVES, FX, INST, hex2, newSong, fix, blankPattern, cellAt, setCell, pack, unpack, songLua, toLua,
    parseLua, fromLuaSong, toLuaSong, luaSave, bitSongs, putBitSong, player, shared, songs, current, songBar, uniqueName };
})();
