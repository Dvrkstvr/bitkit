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
  // the console is folded away until it is needed: its head shows the last line, and an error opens it
  let consoleErrs = 0, onErrorClick = () => {};
  function log(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    if (cls === 'err' && /cart:\d+:/.test(msg)) { line.classList.add('jump'); line.title = 'Click to go to this line in the code'; line.onclick = () => onErrorClick(msg); }
    consoleEl.appendChild(line);
    while (consoleEl.childNodes.length > 500) consoleEl.removeChild(consoleEl.firstChild);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    $('consoleLast').textContent = msg.split('\n')[0];
    $('consoleLast').classList.toggle('err', cls === 'err');
    if (cls === 'err') { consoleErrs++; showConsole(true); }
    $('consoleBadge').hidden = !consoleErrs; $('consoleBadge').textContent = consoleErrs;
  }
  function showConsole(open) {
    document.body.classList.toggle('console-open', open);
    $('consoleArrow').textContent = open ? '▾' : '▸';
    lsSet('bitkit.console', open ? '1' : '0');
    if (open) consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  $('consoleHead').onclick = e => { if (e.target.id !== 'btnClear') showConsole(!document.body.classList.contains('console-open')); };
  $('btnClear').onclick = () => { consoleEl.textContent = ''; consoleErrs = 0; $('consoleBadge').hidden = true; $('consoleLast').textContent = ''; };
  showConsole(lsGet('bitkit.console') === '1');

  /* ------------------------------------------------------------ runtime */
  let onRuntimeError = () => {};
  const RT = await BitKitRuntime({
    onLog: (msg, isErr) => { if (isErr) { log(msg, 'err'); onRuntimeError(msg); } else log(msg); }
  });
  RT._bkw_init();
  const ptr = {
    pal: RT._bkw_palette(), tiles: RT._bkw_tiles(), flags: RT._bkw_flags(), map: RT._bkw_map(),
    press: RT._malloc(16), track: RT._bkw_track() >> 2, sys: RT._bkw_sys() >> 2, save: RT._bkw_save() >> 2, press2: RT._malloc(16)
  };
  ptr.pressN = [0, ptr.press, ptr.press2].concat([3, 4, 5, 6, 7, 8].map(() => RT._malloc(16)));   // button pressure, per player
  const DEFAULT_PAL = RT.HEAPU8.slice(ptr.pal, ptr.pal + 768);

  /* ------------------------------------------------------------ emulator apps: the studio keeps their games
     (studio/roms.js), the runtime asks for them through these (runtime/bk_emu.h, platform/web/main_web.c) */
  const emuHost = { picks: [], token: 0 };
  function emuNotify(what, ok) { const p = RT.stringToNewUTF8(what); RT._bkw_emu_notify(p, ok ? 1 : 0); RT._free(p); }
  const emuStill = (tok, playing) => tok === emuHost.token && bit.playing === playing && running;
  RT.emuRoms = kind => { emuHost.picks = BKRoms.list(kind); return BKRoms.luaList(emuHost.picks); };
  RT.emuOpen = async i => {
    const r = emuHost.picks[i - 1], tok = ++emuHost.token, playing = bit.playing;
    let rom = null, sav = null;
    try { [rom, sav] = r ? await Promise.all([BKRoms.bytes(r.file), BKRoms.getSave(r.file)]) : [null, null]; } catch (e) { log('Could not read the game: ' + e.message, 'err'); }
    if (!emuStill(tok, playing)) return;
    const p = rom ? RT._bkw_emu_rom_alloc(rom.length) : 0;
    if (!p) { emuNotify('open', false); return; }
    RT.HEAPU8.set(rom, p);
    const np = RT.stringToNewUTF8(r.file), kind = RT._bkw_emu_start(np);
    RT._free(np);
    if (!kind) { log(`${r.file}: ${RT.UTF8ToString(RT._bkw_emu_error())}`, 'err'); emuNotify('open', false); return; }
    if (sav) {
      const lp = RT._malloc(4), sp = RT._bkw_emu_sram(lp), n = RT.HEAPU32[lp >> 2];
      RT._free(lp);
      if (sp && n) { RT.HEAPU8.set(new Uint8Array(sav).subarray(0, n), sp); RT._bkw_emu_sram_loaded(); }
    }
    log(`▶ ${r.name} (${['', 'Game Boy', 'Game Boy Color', 'NES'][kind]})`, 'sys');
    emuNotify('open', true);
  };
  RT.emuSram = (file, data) => { BKRoms.putSave(file, data).catch(e => log('Could not keep the battery save: ' + e.message, 'err')); };
  RT.emuStateSave = (file, slot, data) => { BKRoms.putState(file, slot, data).catch(e => log('Could not keep the save state: ' + e.message, 'err')); };
  RT.emuStateLoad = async (file, slot) => {
    const tok = emuHost.token, playing = bit.playing;
    let d = null;
    try { d = await BKRoms.getState(file, slot); } catch (e) { d = null; }
    if (!emuStill(tok, playing)) return;
    let ok = false;
    if (d) { const b = new Uint8Array(d), p = RT._malloc(b.length); RT.HEAPU8.set(b, p); ok = !!RT._bkw_emu_state_load(p, b.length); RT._free(p); }
    emuNotify('load', ok);
  };
  BKRoms.refresh().catch(() => {});
  BKRoms.onChange(() => { try { if (running && /^app:/.test(bit.playing || '')) emuNotify('roms', true); } catch (e) { /* not started yet */ } });

  /* ------------------------------------------------------------ cart */
  const NEW_CODE = `-- my game
-- _init runs once, _update and _draw run 60 times a second.
-- game{} adds the title screen, the pause menu (Start) and the settings every BitKit game has.
-- See the Checklist button and the Help tab.

function _init()
  game{
    title = "my game",
    goal = "Catch 10 stars.",
    help = {"D-pad: move. A: beep."},
    continue = function(cp) score = cp.score end,   -- Continue on the title screen
  }
  x, y, score = 152, 112, 0
  SPEED = tune("Speed", 2, 1, 6)       -- a slider on the Game tab
  new_star()
end

function new_star() sx, sy = rnd(16, 296), rnd(32, 216) end

function _update()
  if btn("left") then x = x - SPEED end
  if btn("right") then x = x + SPEED end
  if btn("up") then y = y - SPEED end
  if btn("down") then y = y + SPEED end
  if btnp("a") then sfx("C5") end
  if math.abs(x + 8 - sx) < 12 and math.abs(y + 8 - sy) < 12 then
    score = score + 1
    sfx("E6", 0, 0.5, 6)
    new_star()
    checkpoint({score = score})         -- remember the progress for Continue
    if score == 10 then game_win("You caught all 10 stars!") end
  end
end

function _draw()
  cls(1)
  circfill(sx, sy, 4, 27)
  rectfill(x, y, 16, 16, 17)
  text("stars " .. score .. "/10", 8, 8, 13)
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
  const levelsMeta = levels => levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track, height: L.height }));
  const HG_LEN = BKTracks.HG_W * BKTracks.HG_H;   // a track level's elevation grid (see tracks.js)

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
      levels: cart.levels.map(L => Object.assign({ name: L.name, w: L.w, h: L.h, map: rle(new Uint8Array(L.map.buffer.slice(0))), placed: L.placed },
        L.track ? { track: L.track } : {}, L.height ? { height: rle(L.height) } : {})),
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
          map: unmap(L.map), placed: Array.isArray(L.placed) ? L.placed : [],
          track: L.track && Array.isArray(L.track.pts) ? L.track : undefined, height: L.height ? unrle(L.height, HG_LEN) : undefined }))
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
  function deserialize(o) { setCart(decodeCart(o), 0); }
  function setCart(c, level) {
    cart.name = c.name; cart.code = c.code;
    cart.palette.set(c.palette); cart.tiles.set(c.tiles); cart.flags.set(c.flags);
    cart.entities = c.entities; cart.levels = c.levels;
    bindLevel(Math.max(0, Math.min(level | 0, c.levels.length - 1)));
  }

  // Every change is saved in this browser a moment later. cartChanged says the game in the editor differs from
  // where it came from (a built-in game, a file on the Bit): that is what gets kept when you switch games.
  let dirtySave = false, cartChanged = lsGet(LS.cart + '.changed') === '1', onDirty = () => {};
  function markDirty() { dirtySave = true; if (!cartChanged) setChanged(true); onDirty(); }
  function setChanged(v) { cartChanged = v; lsSet(LS.cart + '.changed', v ? '1' : '0'); }
  setInterval(() => { if (dirtySave && !/[?&]bit=\d/.test(location.search)) { saveLocal(); dirtySave = false; refreshTabs(); } }, 2000);
  function saveLocal() {
    lsSet(LS.cart, JSON.stringify(serialize()));
    const el = $('saveState'); el.textContent = '✓ saved'; el.classList.add('show'); clearTimeout(saveLocal.t); saveLocal.t = setTimeout(() => el.classList.remove('show'), 1500);
  }

  /* ------------------------------------------------------------ code editor */
  const API_NAMES = ['cls', 'pset', 'pget', 'line', 'rect', 'rectfill', 'circ', 'circfill', 'text', 'spr', 'map', 'mget', 'mset',
    'fget', 'fset', 'camera', 'clip', 'pal', 'palt', 'palette', 'btn', 'btnp', 'btnr', 'press', 't', 'time', 'rnd', 'srand',
    'sfx', 'tone', 'stop', 'print', '_init', '_update', '_draw', 'cutscene', 'cutscene_playing', 'cutscene_skip', 'cutscenes_reset', 'tune', 'game', 'checkpoint', 'game_win', 'game_play', 'game_screen', 'game_title', 'save', 'saved',
    'shade', 'tint', 'fog', 'dither', 'remap', 'wave', 'ripple', 'pixelate', 'glitch', 'display', 'sprfx', 'raster',
    'music', 'music_stop', 'music_pos', 'music_playing', 'music_note', 'voice'];
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
        'Ctrl-Enter': () => (mode === 'play' ? playStart(true) : run()), 'Cmd-Enter': () => (mode === 'play' ? playStart(true) : run()),
        'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
        Tab: c => c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ', 'end')
      }
    });
    cm.on('change', () => { markDirty(); clearErrLine(); });
    // ---- autocomplete (the API from the Help tab, Lua keywords, words already in the code) and a line of help
    const KEYWORDS = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
      'math.floor', 'math.abs', 'math.min', 'math.max', 'math.sin', 'math.cos', 'math.sqrt', 'math.pi', 'ipairs', 'pairs', 'tostring', 'tonumber', 'type', 'table.insert', 'table.remove', 'string.format'];
    let apiDocs = null;
    const docs = () => {
      if (apiDocs) return apiDocs;
      apiDocs = {};
      HELP.forEach(([, rows]) => rows.forEach(([sig, desc]) => {
        let args = '';
        sig.split(' / ').forEach((part, pi) => {
          const m = /^([A-Za-z_][\w.]*)\s*([({].*)?$/.exec(part.trim());
          if (!m) return;
          if (!m[2] && !(pi > 0 && args) && !/^[A-Z][A-Z_.a-z]*$/.test(m[1])) return;     // a heading like "Why", not a name
          if (!m[2] && pi === 0 && !/^[A-Z_]+(\.\w+)?$/.test(m[1])) return;
          if (m[2] && pi === 0) args = m[2];
          if (!apiDocs[m[1]]) apiDocs[m[1]] = { sig: m[1] + (m[2] || (pi > 0 ? args : '')), desc };
        });
      }));
      return apiDocs;
    };
    const docBar = $('codeDoc'), DOC_TIP = 'Ctrl+Space completes a word · Ctrl+F finds · Ctrl+/ comments a line · click an error in the console to jump to it';
    const showDoc = name => {
      const d = name && docs()[name];
      docBar.innerHTML = d ? `<code>${escapeHtml(d.sig)}</code> ${escapeHtml(d.desc)}` : `<span class="dim">${DOC_TIP}</span>`;
      docBar.title = d ? d.desc : '';
    };
    const luaHint = c => {
      const cur = c.getCursor(), line = c.getLine(cur.line), tok = c.getTokenAt(cur);
      if (tok.type === 'comment' || tok.type === 'string') return null;
      let st = cur.ch; while (st > 0 && /\w/.test(line[st - 1])) st--;
      const word = line.slice(st, cur.ch), lw = word.toLowerCase(), member = st > 0 && /[.:]/.test(line[st - 1]);
      if (!word) return null;
      const list = [], seen = new Set([word]);
      const render = (el, self, it) => { el.innerHTML = `<span class="h-name">${escapeHtml(it.text)}</span>${it.sig ? `<span class="h-sig">${escapeHtml(it.sig.slice(it.text.length))}</span>` : ''}`; };
      if (!member) Object.keys(docs()).sort().forEach(n => { if (n.toLowerCase().startsWith(lw) && !seen.has(n)) { seen.add(n); list.push({ text: n, sig: docs()[n].sig, render }); } });
      const extra = [];
      (member ? [] : KEYWORDS).concat(c.getValue().match(/[A-Za-z_]\w{2,}/g) || []).forEach(n => { if (n.toLowerCase().startsWith(lw) && !seen.has(n)) { seen.add(n); extra.push({ text: n, render }); } });
      list.push(...extra.slice(0, 14));
      if (!list.length) return null;
      const res = { list, from: CodeMirror.Pos(cur.line, st), to: cur };
      CodeMirror.on(res, 'select', it => showDoc(it.text));
      CodeMirror.on(res, 'close', () => codeDocHere());
      return res;
    };
    const codeDocHere = () => {      // the function the cursor is on, or the call it is inside
      const cur = cm.getCursor(), line = cm.getLine(cur.line);
      let a = cur.ch, b = cur.ch;
      while (a > 0 && /[\w.]/.test(line[a - 1])) a--;
      while (b < line.length && /[\w.]/.test(line[b])) b++;
      if (docs()[line.slice(a, b)]) return showDoc(line.slice(a, b));
      for (let i = cur.ch - 1, depth = 0; i >= 0; i--) {
        if (line[i] === ')' || line[i] === '}') depth++;
        else if (line[i] === '(' || line[i] === '{') {
          if (depth) { depth--; continue; }
          let e = i; while (e > 0 && line[e - 1] === ' ') e--;
          let st = e; while (st > 0 && /[\w.]/.test(line[st - 1])) st--;
          if (docs()[line.slice(st, e)]) return showDoc(line.slice(st, e));
        }
      }
      showDoc(null);
    };
    if (CodeMirror.showHint) {
      cm.addKeyMap({ 'Ctrl-Space': c => c.showHint({ hint: luaHint, completeSingle: false }) });
      cm.on('inputRead', (c, ch) => {
        if (c.state.completionActive || !ch.text || ch.text.length !== 1 || !/^\w$/.test(ch.text[0])) return;
        const cur = c.getCursor(), line = c.getLine(cur.line);
        let st = cur.ch; while (st > 0 && /\w/.test(line[st - 1])) st--;
        if (cur.ch - st >= 2 && /[A-Za-z_]/.test(line[st])) c.showHint({ hint: luaHint, completeSingle: false });
      });
    }
    cm.on('cursorActivity', () => { if (!cm.state.completionActive) codeDocHere(); });
    setTimeout(() => showDoc(null), 0);
  } else {
    ta = document.createElement('textarea');
    ta.spellcheck = false; ta.value = cart.code;
    $('codeHost').appendChild(ta);
    ta.addEventListener('input', markDirty);
  }
  function getCode() { return cm ? cm.getValue() : ta.value; }
  function setCode(s, keepUndo) { if (cm) { if (cm.getValue() === s) return; cm.setValue(s); if (!keepUndo) cm.clearHistory(); } else ta.value = s; }
  function clearErrLine() { if (cm && errLine !== null) { cm.removeLineClass(errLine, 'background', 'cm-error-line'); errLine = null; } }
  function showErrLine(msg, go) {
    const m = /cart:(\d+):/.exec(msg);
    if (!m || !cm) return;
    clearErrLine();
    errLine = Math.min(parseInt(m[1], 10) - 1, cm.lineCount() - 1);
    cm.addLineClass(errLine, 'background', 'cm-error-line');
    cm.scrollIntoView({ line: errLine, ch: 0 }, 80);
    if (go) { cm.setCursor({ line: errLine, ch: 0 }); cm.focus(); }
  }
  // click an error (in the console or on the screen) to go to its line
  onErrorClick = msg => { if (mode !== 'edit') setMode('edit'); showTab('code'); showErrLine(msg, true); };

  /* ------------------------------------------------------------ tabs */
  let activeTab = 'code';
  const tabBtns = [...document.querySelectorAll('.tabs button[data-tab]')];
  tabBtns.forEach(b => b.onclick = () => showTab(b.dataset.tab));
  function showTab(t) {
    if (!document.getElementById('tab-' + t)) t = 'code';
    activeTab = t;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === 'tab-' + t));
    if (t === 'code' && cm) cm.refresh();
    if (t === 'sprites') drawSprites();
    if (t === 'map') { refreshLevels(); refreshEntSelect(); fitMap(); drawMap(); }
    if (t === 'entities') entEd.render();
    if (t === 'cutscenes') csEd.render();
    if (t === 'track') trkEd.render();
    if (t === 'game') renderGameTab();
    if (t === 'hexbeat') hexEd.render();
    if (t === 'loops') loopEd.render();
    if (t !== 'hexbeat' && t !== 'loops') BKMusic.player.stop();
    lsSet(LS.settings + '.tab', t);
    if (typeof trkEd !== 'undefined') refreshTabs();
  }
  // The tabs fit the game: an editor the game does not use (Kart Lab has no entities, Sweep Storm no painted map)
  // waits under "More" until it is opened or the game starts using it.
  const TAB_WHY = { map: 'This game has no painted map', track: 'This game has no race tracks', entities: 'This game has no entities', cutscenes: 'This game has no cutscenes',
    hexbeat: 'This game has no music yet', loops: 'This game has no music yet' };
  function tabUsed(t) {
    if (!TAB_WHY[t]) return true;
    const tracks = BKTracks.uses(cart), ents = cart.entities, small = getCode().length < 5000;
    if (t === 'track') return tracks;
    if (t === 'hexbeat' || t === 'loops') return (ents.songs || []).length > 0;
    if (t === 'map') return !tracks && (small || cart.levels.some(L => L.placed.length || L.map.some(v => v)));
    // (an entity that is never placed or spawned is only there as the game's icon)
    if (t === 'entities') return (!tracks && small) || ((ents.types.length > 0 || (ents.effects || []).length > 0) &&
      (/\bents_(update|spawn)\s*\(/.test(getCode()) || cart.levels.some(L => L.placed.length)));
    return (ents.cutscenes || []).length > 0;
  }
  function refreshTabs() {
    const hidden = [];
    tabBtns.forEach(b => { const off = !tabUsed(b.dataset.tab) && activeTab !== b.dataset.tab; b.hidden = off; if (off) hidden.push(b); });
    $('tabMore').hidden = !hidden.length;
    $('tabMoreMenu').innerHTML = '<div class="menu-head">Not used by this game yet</div>' +
      hidden.map(b => `<button data-more="${b.dataset.tab}">${escapeHtml(b.textContent)} <span class="dim small">${TAB_WHY[b.dataset.tab]}</span></button>`).join('');
    $('tabMoreMenu').querySelectorAll('[data-more]').forEach(b => b.onclick = () => { $('tabMoreMenu').hidden = true; showTab(b.dataset.more); });
    if (!hidden.length) $('tabMoreMenu').hidden = true;
  }
  $('tabMore').onclick = e => { e.stopPropagation(); $('tabMoreMenu').hidden = !$('tabMoreMenu').hidden; };
  window.addEventListener('click', () => { $('tabMoreMenu').hidden = true; });

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
    const undo = [], redo = [];
    return {
      push() { undo.push(get().slice()); if (undo.length > 60) undo.shift(); redo.length = 0; },
      pop() { if (!undo.length) return toast('Nothing to undo'); redo.push(get().slice()); set(undo.pop()); },
      redo() { if (!redo.length) return toast('Nothing to redo'); undo.push(get().slice()); set(redo.pop()); },
      clear() { undo.length = 0; redo.length = 0; }
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
  const trkEd = BKTracks.init({
    cart, $, toast, escapeHtml, ask: (...a) => ask(...a), isActive: () => activeTab === 'track',
    changed: markDirty, gfxChanged: () => gfxChanged(), mapChanged: () => { mapDirtyRT = true; markDirty(); },
    syncLevel: () => syncLevel(), bindLevel: i => bindLevel(i), levelsChanged: () => { refreshLevels(); refreshTabs(); },
    run: (lvl, extra) => run(lvl, extra)
  });
  // music: Hexbeat (tracker) and Loopbox (loops) edit the same songs, cart.entities.songs (studio/music.js)
  const musicCtx = name => ({ cart, toast, escapeHtml, changed: markDirty, ask: (...a) => ask(...a), isActive: () => activeTab === name,
    pickFrom: (title, names, cb) => {
      modal(title, '<div class="pick-list">' + names.map((n, i) => `<button data-pick="${i}">${escapeHtml(n)}</button>`).join('') + '</div>', [['Cancel', closeModal]]);
      modalEl.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { closeModal(); cb(+b.dataset.pick); });
    } });
  const hexEd = BKHexbeat.init(musicCtx('hexbeat'));
  const loopEd = BKLoopbox.init(musicCtx('loops'));
  BKMusic.player.setMuted(() => settings.muted);
  const csEd = BKCutscenes.init({
    cart, $, toast, escapeHtml, changed: markDirty, ask: (...a) => ask(...a),
    levels: () => cart.levels,
    // run the game (on the cutscene's level, or the one open on the Map tab) and start the cutscene right away
    preview: (name, lvl) => run(typeof lvl === 'number' ? lvl : cart.level, `cutscene(${JSON.stringify(name)})\n`),
    placeOnMap: name => {
      showTab('map');
      mp.layer = 'ents'; $('mapLayer').value = 'ents'; $('mapEnt').hidden = false;
      mp.ent = name; refreshEntSelect(); setMapTool(mp.tool); drawMap();
    }
  });

  /* ------------------------------------------------------------ sprite editor */
  const spr = { tile: 1, size: 1, color: 13, tool: 'pen', clip: null };
  const sprEdit = $('sprEdit'), sprCtx = sprEdit.getContext('2d');
  const sheet = $('sheet'), sheetCtx = sheet.getContext('2d');
  const palC = $('palette'), palCtx = palC.getContext('2d');

  // tile behaviours: 8 on/off flags per tile, each with a name the game picks (stored with the cart's entities).
  // Code asks with fget(tile, "name") (or the number). Flag 0 ("solid") is what entities stand on.
  const flagsEl = $('sprFlags');
  const DEFAULT_FLAG_NAMES = ['solid', '', '', '', '', '', '', ''];
  const flagNames = () => cart.entities.flagNames || DEFAULT_FLAG_NAMES;
  // Shown as chips: click one to switch it on or off for this tile. Only named behaviours show, "+ add behaviour" names the next free one.
  let flagEdit = -1;                // the behaviour being named or renamed
  function nameFlag(b, raw) {
    const names = flagNames().slice();
    let n = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (/^\d/.test(n)) n = '_' + n;
    if (n && names.some((x, i) => x === n && i !== b)) { toast('That name is taken'); n = names[b] || ''; }
    if (n === (names[b] || '')) return;
    names[b] = n; cart.entities.flagNames = names; markDirty();
  }
  flagsEl.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.bit !== undefined) {
      cart.flags[spr.tile] ^= 1 << +t.dataset.bit;
      gfxDirtyRT = true; markDirty();
    } else if (t.dataset.ren !== undefined) flagEdit = +t.dataset.ren;
    else if (t.id === 'flagAdd') flagEdit = flagNames().findIndex((n, i) => !n && !flagUsed(i));
    showFlags();
  });
  const flagUsed = b => cart.flags.some(f => (f >> b) & 1);
  function showFlags() {
    const names = flagNames(), f = cart.flags[spr.tile];
    let html = '';
    for (let b = 0; b < 8; b++) {
      const on = (f >> b) & 1;
      if (b === flagEdit) { html += `<input class="flag-name" data-name="${b}" value="${escapeHtml(names[b] || '')}" placeholder="name, e.g. ice" spellcheck="false" maxlength="12">`; continue; }
      if (!names[b] && !flagUsed(b)) continue;           // a free slot
      const label = names[b] || `flag ${b}`;
      html += `<span class="chip${on ? ' on' : ''}"><button data-bit="${b}" title="${names[b] ? `Tiles with "${names[b]}" switched on. In code: fget(tile, &quot;${names[b]}&quot;)` : `Flag ${b} has no name yet. In code: fget(tile, ${b})`}${b === 0 ? '. Entities stand on solid tiles.' : ''}">${on ? '✓' : '○'} ${escapeHtml(label)}</button>` +
        `<button class="chip-ren" data-ren="${b}" title="Rename (empty the name to remove it)">✎</button></span>`;
    }
    if (flagEdit < 0 && names.some((n, i) => !n && !flagUsed(i))) html += '<button id="flagAdd" class="chip-add" title="Name a new behaviour, like ice, ladder or water. Your code asks fget(tile, &quot;name&quot;).">+ add behaviour</button>';
    flagsEl.innerHTML = html;
    const inp = flagsEl.querySelector('.flag-name');
    if (inp) {
      const b = flagEdit;
      const done = keep => { if (flagEdit !== b) return; flagEdit = -1; if (keep) nameFlag(b, inp.value); showFlags(); };
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      inp.focus(); inp.select();
    }
  }
  // which entity draws itself with a tile (from the animations on the Entities tab)
  function tileUsers() {
    const m = {};
    (cart.entities.types || []).forEach(t => (t.anims || []).forEach(a => (a.frames || []).forEach(fr => {
      for (let y = 0; y < (t.sh || 1); y++) for (let x = 0; x < (t.sw || 1); x++) {
        const n = (fr | 0) + y * 16 + x;
        (m[n] = m[n] || new Set()).add(t.name);
      }
    })));
    return m;
  }
  const SHEET_T = 24;               // pixels per tile on the sheet
  function sheetRows() {            // rows that have something drawn, and two spare ones
    if (spr.all) return 32;
    let last = 0;
    for (let n = TILES - 1; n > 0; n--) { let any = false; for (let i = n * 64; i < n * 64 + 64; i++) if (cart.tiles[i]) { any = true; break; } if (any) { last = n >> 4; break; } }
    return Math.min(32, Math.max(last + 3, (spr.tile >> 4) + spr.size + 1, 6));
  }

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
    const T = SHEET_T, rows = sheetRows();
    if (sheet.height !== rows * T || sheet.width !== 16 * T) { sheet.width = 16 * T; sheet.height = rows * T; }
    sheetCtx.imageSmoothingEnabled = false;
    sheetCtx.fillStyle = '#000'; sheetCtx.fillRect(0, 0, 16 * T, rows * T);
    sheetCtx.drawImage(atlas, 0, 0, 128, rows * 8, 0, 0, 16 * T, rows * T);
    sheetCtx.strokeStyle = 'rgba(255,255,255,.06)';
    sheetCtx.beginPath();
    for (let i = 1; i < 16; i++) { sheetCtx.moveTo(i * T + .5, 0); sheetCtx.lineTo(i * T + .5, rows * T); }
    for (let i = 1; i < rows; i++) { sheetCtx.moveTo(0, i * T + .5); sheetCtx.lineTo(16 * T, i * T + .5); }
    sheetCtx.stroke();
    sheetCtx.strokeStyle = '#ffd23f'; sheetCtx.lineWidth = 2;
    sheetCtx.strokeRect((spr.tile % 16) * T + 1, (spr.tile >> 4) * T + 1, spr.size * T - 2, spr.size * T - 2);
    sheetCtx.lineWidth = 1;
    $('sheetInfo').textContent = rows < 32 ? `Sprite sheet: the first ${rows * 16} of 512 tiles` : 'Sprite sheet: all 512 tiles, 16 per row';
    $('sheetAll').textContent = spr.all ? 'show less' : 'show all';
    // info
    const users = new Set();
    const um = tileUsers();
    for (let y = 0; y < spr.size; y++) for (let x = 0; x < spr.size; x++) (um[spr.tile + y * 16 + x] || []).forEach(n => users.add(n));
    $('sprInfo').textContent = `Tile ${spr.tile}`;
    $('sprUsed').textContent = users.size ? `used by ${[...users].join(', ')}` : '';
    $('sprHint').textContent = spr.size === 1 ? `spr(${spr.tile}, x, y)` : `spr(${spr.tile}, x, y, ${spr.size}, ${spr.size})`;
    if (BKTracks.uses(cart) && spr.tile >= BKTracks.TILE.EDGE && spr.tile <= BKTracks.TILE.EDGE_END)
      $('sprHint').textContent = 'road edge: built from the road look on the Track tab';
    showFlags();
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
    let tx = Math.floor((e.clientX - r.left) / r.width * 16), ty = Math.floor((e.clientY - r.top) / r.height * (sheet.height / SHEET_T));
    tx = Math.min(tx, 16 - spr.size); ty = Math.min(ty, 32 - spr.size);
    spr.tile = ty * 16 + tx;
    drawSprites();
  });
  sheet.addEventListener('mousemove', e => {       // hovering says which tile it is and who uses it
    const r = sheet.getBoundingClientRect();
    const n = Math.floor((e.clientY - r.top) / r.height * (sheet.height / SHEET_T)) * 16 + Math.floor((e.clientX - r.left) / r.width * 16);
    if (n === sheet._hover) return;
    sheet._hover = n;
    const u = tileUsers()[n];
    sheet.title = `Tile ${n}` + (u ? ` · used by ${[...u].join(', ')}` : '');
  });
  $('sheetAll').onclick = () => { spr.all = !spr.all; drawSprites(); };
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
  /* ------------------------------------------------------------ Game tab: the numbers a game lets you play with */
  // every tune("Name", default, ...) in the code becomes a control: a slider, a switch or a list
  function parseTunes(code) {
    const out = [], seen = {};
    const re = /\btune\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const ls = code.lastIndexOf('\n', m.index) + 1;
      if (code.slice(ls, m.index).includes('--')) continue;            // in a comment
      const args = []; let cur = '', depth = 0, q = null, i = re.lastIndex, ok = false;
      for (; i < code.length && i < re.lastIndex + 400; i++) {
        const ch = code[i];
        if (q) { cur += ch; if (ch === '\\') cur += code[++i] || ''; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === '{' || ch === '(') depth++;
        if (ch === '}' || ch === ')') { if (!depth) { ok = true; break; } depth--; }
        if (ch === ',' && !depth) { args.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      if (!ok) continue;
      args.push(cur.trim());
      const str = a => { const k = /^(["'])(.*)\1$/s.exec(a || ''); return k ? k[2].replace(/\\(.)/g, '$1') : null; };
      const name = str(args[0]);
      if (!name || seen[name] || args.length < 2) continue;
      const d = args[1], o = { name };
      if (d === 'true' || d === 'false') { o.kind = 'bool'; o.def = d === 'true'; }
      else if (str(d) !== null) {
        o.kind = 'list'; o.def = str(d);
        o.options = (/^\{(.*)\}$/s.exec(args[2] || '') || ['', ''])[1].split(',').map(x => str(x.trim())).filter(x => x !== null);
        if (!o.options.includes(o.def)) o.options.unshift(o.def);
      } else if (d !== '' && isFinite(+d)) {
        const num = (a, f) => (a !== undefined && a !== '' && isFinite(+a) ? +a : f);
        o.kind = 'num'; o.def = +d;
        o.min = num(args[2], Math.min(0, o.def * 2)); o.max = num(args[3], Math.max(o.def * 2, o.min + 10));
        if (o.max <= o.min) o.max = o.min + 1;
        const whole = [o.def, o.min, o.max].every(Number.isInteger) && !/\./.test(d);
        o.step = num(args[4], 0) > 0 ? +args[4] : (whole ? 1 : (o.max - o.min) > 20 ? 0.5 : (o.max - o.min) > 4 ? 0.1 : 0.01);
      } else continue;
      seen[name] = 1; out.push(o);
    }
    return out;
  }
  const fmtNum = v => String(Math.round(v * 1000) / 1000);
  let tuneTimer = 0;
  function tuneChanged() {            // a value moved: save it, and play the test game again with it
    markDirty();
    clearTimeout(tuneTimer);
    tuneTimer = setTimeout(() => { if (running && playingEditor && mode === 'edit') run(playingLevel || 0); }, 350);
  }
  function renderGameTab() {
    const body = $('gameBody');
    if (!body) return;
    const ents = cart.entities, tunes = parseTunes(getCode()), vals = ents.tune || {};
    const cur = t => (vals[t.name] !== undefined && typeof vals[t.name] === typeof t.def ? vals[t.name] : t.def);
    const row = (label, ctl, changed, attr) => `<div class="tune-row${changed ? ' changed' : ''}"><label>${escapeHtml(label)}</label>${ctl}` +
      `<button class="tiny tune-reset" ${attr} title="Back to the game's own value"${changed ? '' : ' disabled'}>↺</button></div>`;
    // "Group/Name" settings are listed under a Group heading (the game's own settings come first)
    let lastGroup = '';
    const rows = tunes.map((t, i) => ({ t, i, g: t.name.includes('/') ? t.name.slice(0, t.name.indexOf('/')) : '' }))
      .sort((a, b) => (a.g ? 1 : 0) - (b.g ? 1 : 0) || (a.g < b.g ? -1 : a.g > b.g ? 1 : a.i - b.i)).map(({ t, i, g }) => {
      const head = g !== lastGroup ? `<h4 class="tune-group">${escapeHtml(g)}</h4>` : '';
      lastGroup = g;
      return head + tuneRow(t, i);
    });
    function tuneRow(t, i) {
      const v = cur(t), ch = v !== t.def, label = t.name.includes('/') ? t.name.slice(t.name.indexOf('/') + 1) : t.name;
      if (t.kind === 'bool') return row(label, `<span class="tune-ctl"><label class="switch"><input type="checkbox" data-tune="${i}"${v ? ' checked' : ''}><span>${v ? 'On' : 'Off'}</span></label></span>`, ch, `data-treset="${i}"`);
      if (t.kind === 'list') return row(label, `<span class="tune-ctl"><select data-tune="${i}">${t.options.map(o => `<option${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></span>`, ch, `data-treset="${i}"`);
      return row(label, `<span class="tune-ctl"><input type="range" data-tune="${i}" min="${t.min}" max="${t.max}" step="${t.step}" value="${v}"><input type="number" data-tune="${i}" min="${t.min}" max="${t.max}" step="${t.step}" value="${fmtNum(v)}"></span>`, ch, `data-treset="${i}"`);
    }
    // games made with the Entities tab: the player's hearts and stats are sliders too
    const players = (ents.types || []).map((t, ti) => ({ t, ti })).filter(x => x.t.player);
    const prow = players.map(({ t, ti }) => {
      const stat = (label, key, v, min, max, step) => `<div class="tune-row"><label>${escapeHtml(label)}</label><span class="tune-ctl">` +
        `<input type="range" data-pl="${ti}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><input type="number" data-pl="${ti}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${fmtNum(v)}"></span><span class="tune-pad"></span></div>`;
      return `<h4>Player: ${escapeHtml(t.name)}</h4>` + stat('Hearts', 'hp', t.hp | 0, 1, 10, 1) +
        (t.stats || []).filter(q => q.name).map((q, qi) => stat(q.name[0].toUpperCase() + q.name.slice(1), 's' + qi, +q.value || 0, 0, Math.max(3, (+q.value || 0) * 2), 0.05)).join('');
    }).join('');
    const rules = window.BKRules ? BKRules.check({ code: getCode() }) : [], ok = rules.filter(x => x.ok).length;
    const any = rows.length || prow;
    body.innerHTML = `<h2>${escapeHtml(cart.name || 'untitled')}</h2>
      <p class="dim">Change how the game feels without touching its code. ${any ? 'Move a slider while the game runs and it starts again with the new value.' : ''}</p>
      <div class="game-sec"><h3>Settings to play with</h3>
        ${rows.join('')}${prow}
        ${any ? '' : `<p>This game has no settings here yet.</p>`}
        <details class="tune-how"${any ? '' : ' open'}><summary>How do I add a setting?</summary>
          <p>Wrap a number in your code in <code>tune()</code> and it shows up here as a slider:</p>
          <pre>SPEED = tune("Speed", 2, 1, 6)        -- name, starting value, lowest, highest
GHOST = tune("Ghost mode", false)     -- a switch
LEVEL = tune("Rivals", "Normal", {"Easy", "Normal", "Hard"})   -- a list
BOOST = tune("Items/Boost time", 1.5, 0.5, 4) -- "Group/Name": listed under Items</pre>
          <p class="dim">The values you pick are saved with the game, so the device plays it the same way.</p></details>
        ${rows.some((r, i) => cur(tunes[i]) !== tunes[i].def) ? '<p><button id="tuneResetAll">↺ Reset all to the game\'s own values</button></p>' : ''}
      </div>
      ${displaySection()}
      <div class="game-sec"><h3>${ok === rules.length ? '✓ Checklist: everything a BitKit game needs is here' : `Checklist: ${ok} of ${rules.length}`}</h3>
        <ul class="rules-list">${rules.map(x => `<li class="${x.ok ? 'ok' : 'todo'}"><b>${x.ok ? '✓' : '○'} ${escapeHtml(x.name)}</b>${x.ok ? '' : `<br><span class="dim">${escapeHtml(x.about)}</span>`}</li>`).join('')}</ul>
        <p class="dim small">This is a quick look at your code. <a href="${RULES_URL}" target="_blank" rel="noopener">Read the rules</a></p>
      </div>`;
    const setTune = (t, v) => {
      if (!ents.tune) ents.tune = {};
      if (v === t.def) delete ents.tune[t.name]; else ents.tune[t.name] = v;
      tuneChanged();
    };
    body.querySelectorAll('[data-tune]').forEach(el => {
      const t = tunes[+el.dataset.tune];
      el.oninput = el.onchange = e => {
        let v;
        if (t.kind === 'bool') { v = el.checked; el.nextElementSibling.textContent = v ? 'On' : 'Off'; }
        else if (t.kind === 'list') v = el.value;
        else {
          v = +el.value;
          if (!isFinite(v) || el.value === '') return;
          if (e.type === 'change') v = Math.max(t.min, Math.min(t.max, v));
          el.parentNode.querySelectorAll('input').forEach(x => { if (x !== el || e.type === 'change') x.value = x.type === 'number' ? fmtNum(v) : v; });
        }
        setTune(t, v);
        const rowEl = el.closest('.tune-row'), ch = v !== t.def;
        rowEl.classList.toggle('changed', ch); rowEl.querySelector('.tune-reset').disabled = !ch;
        if (e.type === 'change') renderGameTab.soon();
      };
    });
    body.querySelectorAll('[data-treset]').forEach(b => { b.onclick = () => { setTune(tunes[+b.dataset.treset], tunes[+b.dataset.treset].def); renderGameTab(); }; });
    if ($('tuneResetAll')) $('tuneResetAll').onclick = () => { ents.tune = {}; tuneChanged(); renderGameTab(); };
    wireDisplay(body);
    body.querySelectorAll('[data-pl]').forEach(el => {
      el.oninput = el.onchange = e => {
        const t = ents.types[+el.dataset.pl], key = el.dataset.key, v = +el.value;
        if (!t || !isFinite(v) || el.value === '') return;
        if (key === 'hp') t.hp = Math.max(1, v | 0); else if (t.stats[+key.slice(1)]) t.stats[+key.slice(1)].value = v;
        el.parentNode.querySelectorAll('input').forEach(x => { if (x !== el) x.value = x.type === 'number' ? fmtNum(v) : v; });
        tuneChanged();
      };
    });
  }
  /* Screen look: the display shader (display{} in Lua) as sliders. Saved with the game as cart.entities.display and
     handed to the game before its code runs, so a display{} call in the game's own code still wins. While the game
     runs the sliders change the running game's screen straight away. */
  const DISPLAY_FIELDS = [   // [Lua name, label, min, max, step]; the C side keeps them as whole percent in this order
    ['scanlines', 'Scanlines', 0, 1, 0.05], ['vignette', 'Dark corners', 0, 1, 0.05], ['curve', 'Curved glass', 0, 1, 0.05],
    ['split', 'Colour split (pixels)', 0, 4, 1], ['blur', 'Soft blur', 0, 1, 0.05], ['grain', 'Grain', 0, 1, 0.05],
    ['bright', 'Brightness', -1, 1, 0.05], ['contrast', 'Contrast', -1, 1, 0.05], ['saturation', 'Colour', -1, 1, 0.05], ['warm', 'Warm / cool', -1, 1, 0.05]];
  // the looks display("name") knows, same numbers as PRESETS in runtime/bk_core.c (CI checks they match)
  const DISPLAY_LOOKS = {
    off: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], crt: [45, 35, 30, 1, 35, 6, 8, 10, 10, 0], arcade: [60, 20, 12, 0, 20, 0, 12, 15, 25, 0],
    'old tv': [50, 60, 45, 2, 60, 35, 0, -5, -60, 15], handheld: [15, 0, 0, 0, 25, 0, -5, -15, -35, 10],
    sepia: [0, 40, 0, 0, 0, 10, 0, 0, -100, 55], night: [20, 55, 0, 0, 10, 25, -10, 10, -70, -45], vivid: [0, 15, 0, 0, 0, 0, 5, 20, 45, 0] };
  const lookToVals = name => { const v = DISPLAY_LOOKS[name] || DISPLAY_LOOKS.off; return DISPLAY_FIELDS.map((f, i) => (f[0] === 'split' ? v[i] : v[i] / 100)); };
  function displayLua(d) {
    if (!d || !d.vals) return '';
    return 'display{' + DISPLAY_FIELDS.map((f, i) => `${f[0]} = ${+d.vals[i] || 0}`).join(', ') + '}\n';
  }
  window.BKDisplay = { FIELDS: DISPLAY_FIELDS, LOOKS: DISPLAY_LOOKS, lua: displayLua };
  function pushDisplay() {           // into the running game, right now
    if (!running || !RT._bkw_display) return;
    const d = cart.entities.display, base = RT._bkw_display() >> 2;
    DISPLAY_FIELDS.forEach((f, i) => { const v = d && d.vals ? +d.vals[i] || 0 : 0; RT.HEAP32[base + i] = f[0] === 'split' ? Math.round(v) : Math.round(v * 100); });
  }
  function displaySection() {
    const d = cart.entities.display, vals = d && d.vals ? d.vals : lookToVals('off');
    const codeHas = /\bdisplay\s*[({"']/.test(getCode());
    const look = d ? d.look || 'custom' : 'game';
    const opts = [['game', "None (the game's own)"], ...Object.keys(DISPLAY_LOOKS).filter(k => k !== 'off').map(k => [k, k[0].toUpperCase() + k.slice(1)]), ['custom', 'Custom']];
    return `<div class="game-sec"><h3>Screen look</h3>
      <p class="dim">A shader on the whole screen: old CRT glass, a worn TV, sepia. It is applied as the picture goes to the screen, so it never slows the game down.${codeHas ? ' This game also sets its own look with display() in its code, which takes over once that line runs.' : ''}</p>
      <div class="tune-row"><label>Look</label><span class="tune-ctl"><select id="dispLook">${opts.map(([k, n]) => `<option value="${escapeHtml(k)}"${k === look ? ' selected' : ''}${k === 'custom' && look !== 'custom' ? ' hidden' : ''}>${escapeHtml(n)}</option>`).join('')}</select></span><span class="tune-pad"></span></div>
      ${d ? DISPLAY_FIELDS.map((f, i) => `<div class="tune-row"><label>${escapeHtml(f[1])}</label><span class="tune-ctl"><input type="range" data-disp="${i}" min="${f[2]}" max="${f[3]}" step="${f[4]}" value="${vals[i]}"><input type="number" data-disp="${i}" min="${f[2]}" max="${f[3]}" step="${f[4]}" value="${fmtNum(vals[i])}"></span><span class="tune-pad"></span></div>`).join('') : ''}
      <details class="tune-how"><summary>From code</summary><pre>display("crt")                              -- a ready look
display{scanlines = 0.4, curve = 0.2, warm = 0.3}  -- your own
display()                                   -- off</pre><p class="dim">The Help tab lists the other shaders (tint, fog, wave, ripple, pixelate, dither, glitch) that you call in _draw.</p></details>
    </div>`;
  }
  function wireDisplay(body) {
    const sel = body.querySelector('#dispLook');
    if (!sel) return;
    sel.onchange = () => {
      const v = sel.value;
      if (v === 'game') delete cart.entities.display;
      else if (v !== 'custom') cart.entities.display = { look: v, vals: lookToVals(v) };
      markDirty(); pushDisplay(); renderGameTab();
    };
    body.querySelectorAll('[data-disp]').forEach(el => {
      el.oninput = el.onchange = e => {
        const i = +el.dataset.disp, f = DISPLAY_FIELDS[i];
        let v = +el.value;
        if (!isFinite(v) || el.value === '') return;
        v = Math.max(f[2], Math.min(f[3], v));
        const d = cart.entities.display;
        if (!d) return;
        d.vals[i] = v; d.look = 'custom';
        el.parentNode.querySelectorAll('input').forEach(x => { if (x !== el || e.type === 'change') x.value = x.type === 'number' ? fmtNum(v) : v; });
        sel.querySelector('option[value="custom"]').hidden = false; sel.value = 'custom';
        markDirty(); pushDisplay();
      };
    });
  }
  // the Reset all button comes and goes: redraw once the pointer is up (never while a slider is being dragged)
  renderGameTab.soon = () => setTimeout(() => { if (activeTab === 'game' && !$('gameBody').contains(document.activeElement)) renderGameTab(); }, 50);

  /* ------------------------------------------------------------ map editor */
  const mv = $('mapView'), mvCtx = mv.getContext('2d');
  const mapSheet = $('mapSheet'), msCtx = mapSheet.getContext('2d');
  const mp = { x: 0, y: 0, zoom: 2, tile: 1, tool: 'paint', grid: true, hover: null, layer: 'tiles', ent: '', rect: null, space: false, autoz: true };
  let mapPainting = false, mapPanning = null;
  // the map fills the room the tab has: the canvas is as big as its box
  const mvBox = mv.parentNode;
  function fitMap() {
    const w = Math.max(160, mvBox.clientWidth | 0), h = Math.max(120, mvBox.clientHeight | 0);
    if (!mvBox.clientHeight) return;                 // the tab is not showing
    if (mp.autoz) {                                  // a level just opened: zoom so its height fits
      const L = cart.levels[cart.level];
      mp.autoz = false; mp.zoom = Math.max(2, Math.min(4, Math.floor(h / ((L ? L.h : 30) * 8))));
      mp.y = Math.max(0, (L ? L.h : 30) - Math.floor(h / (8 * mp.zoom)));     // a short view starts at the ground, not the sky
    } else if (mv.width === w && mv.height === h) return;
    mv.width = w; mv.height = h;
    if (activeTab === 'map') panMap(0, 0);
  }
  if (window.ResizeObserver) new ResizeObserver(fitMap).observe(mvBox);
  const MAP_HINT = { paint: 'Paint: drag to draw with the picked tile.', erase: 'Eraser: drag to clear tiles.', rect: 'Box: drag a rectangle and let go to fill it.', fill: 'Fill: click an area to flood it (only what you see).', pick: 'Pick: click a tile on the map to draw with it.' };

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
      if (mp.rect) {                 // the box being dragged
        const [x0, y0, x1, y1] = rectOf(mp.rect, mp.hover);
        mvCtx.fillStyle = mp.rect.erase ? 'rgba(255,107,94,.25)' : 'rgba(138,211,90,.25)';
        mvCtx.fillRect((x0 - mp.x) * s, (y0 - mp.y) * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
        mvCtx.strokeStyle = '#fff'; mvCtx.strokeRect((x0 - mp.x) * s + .5, (y0 - mp.y) * s + .5, (x1 - x0 + 1) * s - 1, (y1 - y0 + 1) * s - 1);
        $('mapPos').textContent = `${x1 - x0 + 1} × ${y1 - y0 + 1} tiles`;
      } else {
        if (mp.tool !== 'erase' && mp.tool !== 'pick') {
          mvCtx.globalAlpha = .6;
          mvCtx.drawImage(atlas, (mp.tile % 16) * 8, (mp.tile >> 4) * 8, 8, 8, (hx - mp.x) * s, (hy - mp.y) * s, s, s);
          mvCtx.globalAlpha = 1;
        }
        mvCtx.strokeStyle = mp.tool === 'erase' ? '#ff6b5e' : '#fff'; mvCtx.strokeRect((hx - mp.x) * s + .5, (hy - mp.y) * s + .5, s - 1, s - 1);
        const hit = entAt(hx * 8 + 4, hy * 8 + 4);
        $('mapPos').textContent = `x ${hx}, y ${hy}  tile ${cart.map[hy * MAPW + hx]}` + (hit >= 0 ? `  ·  ${cart.entities.placed[hit].type}` : '');
        if (hit >= 0) {              // say who stands here
          const pl = cart.entities.placed[hit], lx = (pl.x - mp.x * 8) * pz, ly = (pl.y - mp.y * 8) * pz;
          mvCtx.font = '11px system-ui'; const w = mvCtx.measureText(pl.type).width + 8;
          mvCtx.fillStyle = 'rgba(10,10,18,.85)'; mvCtx.fillRect(lx, ly - 16, w, 14);
          mvCtx.fillStyle = '#fff'; mvCtx.fillText(pl.type, lx + 4, ly - 5);
        }
      }
    } else $('mapPos').textContent = '';
    // picker
    const prow = Math.max(sheetRows(), (mp.tile >> 4) + 2);      // the rows in use, like on the Sprites tab
    if (mapSheet.height !== prow * 16) mapSheet.height = prow * 16;
    msCtx.imageSmoothingEnabled = false;
    msCtx.fillStyle = '#000'; msCtx.fillRect(0, 0, 256, prow * 16);
    msCtx.drawImage(atlas, 0, 0, 128, prow * 8, 0, 0, 256, prow * 16);
    msCtx.strokeStyle = '#ffd23f'; msCtx.lineWidth = 2;
    msCtx.strokeRect((mp.tile % 16) * 16 + 1, (mp.tile >> 4) * 16 + 1, 14, 14); msCtx.lineWidth = 1;
    $('mapTileInfo').textContent = mp.tile + (mp.tile === 0 ? ' (empty)' : '');
    $('mapZoom').value = mp.zoom;
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
  const rectOf = (a, b) => [Math.min(a.x, b[0]), Math.min(a.y, b[1]), Math.max(a.x, b[0]), Math.max(a.y, b[1])];
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
    if (mp.tool === 'pick' || e.altKey) { mp.tile = cart.map[y * MAPW + x]; if (first && mp.tool === 'pick') setMapTool('paint'); drawMap(); return; }
    const erase = e.buttons & 2 || e.button === 2 || mp.tool === 'erase';
    const t = erase ? 0 : mp.tile;
    if (mp.tool === 'rect') { if (first) mp.rect = { x, y, erase: !!(e.buttons & 2 || e.button === 2) }; drawMap(); return; }
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
  window.addEventListener('mouseup', () => {          // letting go fills the dragged box
    mapPainting = false;
    if (!mp.rect) return;
    const r = mp.rect; mp.rect = null;
    if (mp.hover) {
      const [x0, y0, x1, y1] = rectOf(r, mp.hover);
      mapHist.push();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cart.map[y * MAPW + x] = r.erase ? 0 : mp.tile;
      mapDirtyRT = true; markDirty();
    }
    drawMap();
  });
  mv.addEventListener('mousedown', e => {
    mv.focus();
    if (e.button === 1 || (e.button === 0 && mp.space)) { mapPanning = { x: e.clientX, y: e.clientY, mx: mp.x, my: mp.y }; e.preventDefault(); return; }
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
  mv.addEventListener('mouseleave', () => { if (mp.rect) return; mp.hover = null; drawMap(); });
  // the wheel zooms in and out around the pointer (Shift or a sideways swipe pans)
  let wheelAcc = 0;
  mv.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return panMap(Math.sign(e.shiftKey ? e.deltaY : e.deltaX) * 2, 0);
    wheelAcc += e.deltaMode ? e.deltaY * 40 : e.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    const z = Math.max(1, Math.min(4, mp.zoom + (wheelAcc < 0 ? 1 : -1)));
    wheelAcc = 0;
    if (z === mp.zoom) return;
    const r = mv.getBoundingClientRect(), cx = (e.clientX - r.left) / 8, cy = (e.clientY - r.top) / 8;
    const tx = mp.x + cx / mp.zoom, ty = mp.y + cy / mp.zoom;      // the tile under the pointer stays there
    mp.zoom = z; mp.x = Math.round(tx - cx / z); mp.y = Math.round(ty - cy / z);
    panMap(0, 0);
  }, { passive: false });
  function panMap(dx, dy) {
    const vw = Math.floor(mv.width / (8 * mp.zoom)), vh = Math.floor(mv.height / (8 * mp.zoom));
    mp.x = Math.max(0, Math.min(MAPW - vw, mp.x + dx));
    mp.y = Math.max(0, Math.min(MAPH - vh, mp.y + dy));
    drawMap();
  }
  mv.addEventListener('keyup', e => { if (e.key === ' ') { mp.space = false; mv.style.cursor = ''; } });
  mv.addEventListener('blur', () => { mp.space = false; mv.style.cursor = ''; });
  mv.addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), st = e.shiftKey ? 10 : 2;
    if (e.key === ' ') { mp.space = true; mv.style.cursor = 'grab'; e.preventDefault(); return; }
    const d = { arrowleft: [-st, 0], a: [-st, 0], arrowright: [st, 0], d: [st, 0], arrowup: [0, -st], w: [0, -st], arrowdown: [0, st], s: [0, st] }[k];
    if (d && !e.ctrlKey && !e.metaKey) { panMap(d[0], d[1]); e.preventDefault(); }
  });
  mapSheet.addEventListener('mousedown', e => {
    const r = mapSheet.getBoundingClientRect();
    mp.tile = Math.floor((e.clientY - r.top) / r.height * (mapSheet.height / 16)) * 16 + Math.floor((e.clientX - r.left) / r.width * 16);
    if (mp.tool === 'pick' || mp.tool === 'erase') setMapTool('paint');
    drawMap();
  });
  document.querySelectorAll('.mtool').forEach(b => b.onclick = () => setMapTool(b.dataset.mtool));
  function setMapTool(t) {
    mp.tool = t; document.querySelectorAll('.mtool').forEach(b => b.classList.toggle('active', b.dataset.mtool === t));
    $('mapHint').textContent = mp.layer === 'ents' ? 'Click to place the picked entity, right click removes one.' : MAP_HINT[t];
  }
  // ---- levels
  function refreshLevels() {
    $('mapLevel').innerHTML = cart.levels.map((L, i) => `<option value="${i}"${i === cart.level ? ' selected' : ''}>${i + 1}. ${escapeHtml(L.name)}</option>`).join('');
    $('mapPlayLevel').title = `Run the game starting on ${cart.levels[cart.level].name}`;
  }
  function switchLevel(i) {
    syncLevel(); bindLevel(i); mapHist.clear();
    mp.x = 0; mp.y = 0; mp.autoz = true; fitMap();
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
        cart.levels.splice(cart.level + 1, 0, { name: L.name + ' copy', w: L.w, h: L.h, map: L.map.slice(), placed: L.placed.map(p => Object.assign({}, p)),
          track: L.track ? JSON.parse(JSON.stringify(L.track)) : undefined, height: L.height ? L.height.slice() : undefined });
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
    refreshEntSelect(); setMapTool(mp.tool); drawMap();
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (mode === 'play') playStart(true); else run(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); saveLocal();
      if (cartFile) saveToBit(false); else toast('Saved in this browser');
      return;
    }
    if (inText || e.target === screen) return;
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      if (mode === 'edit') { undoHere(e.shiftKey || e.key.toLowerCase() === 'y'); e.preventDefault(); }
      return;
    }
    if (activeTab === 'sprites') { const t = { p: 'pen', f: 'fill', i: 'pick' }[e.key.toLowerCase()]; if (t) setTool(t); }
    if (activeTab === 'map') { const t = { p: 'paint', f: 'fill', i: 'pick', e: 'erase', r: 'rect', b: 'rect' }[e.key.toLowerCase()]; if (t && !e.ctrlKey && !e.metaKey) setMapTool(t); }
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

  // player 2 on the same keyboard: IJKL move, N = A, M = B, H = X, U = Y, Y = L, O = R, Backspace = Start, B = Select
  const KEYMAP2 = { KeyJ: 0, KeyL: 1, KeyI: 2, KeyK: 3, KeyN: 4, KeyM: 5, KeyH: 6, KeyU: 7, KeyY: 8, KeyO: 9, Backspace: 10, KeyB: 11 };
  const keys = new Uint8Array(12), keys2 = new Uint8Array(12);
  const input = { mask: 0, press: new Uint8Array(12), pads: [], mine: [] };
  const input2 = { mask: 0, press: new Uint8Array(12) };
  // Every studio window is a Bit. Extra Bits open as ?bit=N windows that show just the screen.
  const BIT_NO = Math.max(1, Math.min(99, parseInt((location.search.match(/[?&]bit=(\d+)/) || [])[1], 10) || 1));
  const IS_BIT2 = BIT_NO > 1;   // an extra Bit window (not the studio)
  // Play mode can show a second Bit next to the first: an extra Bit in a frame (?bit=N&embed=1). The studio
  // window reads the buttons for it (player 2's keys or controller) and hands them over, so one keyboard and
  // any controllers work for both without clicking between them.
  const EMBED = IS_BIT2 && /[?&]embed=1/.test(location.search);
  const ext = { mask: 0, press: new Uint8Array(12) };              // embedded Bit: buttons from the studio window
  const embed = { on: false, frame: null, api: null, num: 2 };     // studio window: the Bit next to this one
  const p2Local = () => playMode === '2' && !embed.on;             // two players sharing this screen
  const wantP2 = () => playMode === '2' || embed.on;               // player 2's buttons are read in this window
  let forceCombo = 0;                                              // frames of Start+Select from the Home button
  let playMode = lsGet('bitkit.players') === '2' ? '2' : '1';   // '2' = two players on this one screen
  const screen = $('screen');
  function gameHasFocus() { const a = document.activeElement; return a === screen || a === document.body || a === null; }
  window.addEventListener('keydown', e => {
    if (!gameHasFocus() || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = KEYMAP[e.code], j = wantP2() ? KEYMAP2[e.code] : undefined;
    if (i !== undefined) { keys[i] = 1; e.preventDefault(); }
    else if (j !== undefined) { keys2[j] = 1; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    const i = KEYMAP[e.code], j = KEYMAP2[e.code];
    if (i !== undefined) keys[i] = 0;
    if (j !== undefined) keys2[j] = 0;
  });
  window.addEventListener('blur', () => { keys.fill(0); keys2.fill(0); });

  function srcValue(pad, s) {
    if (s[0] === 'b') { const b = pad.buttons[s[1]]; return b ? (b.value || (b.pressed ? 1 : 0)) : 0; }
    const v = (pad.axes[s[1]] || 0) * s[2], dz = settings.dead / 100;
    return v <= dz ? 0 : Math.min(1, (v - dz) / (1 - dz));
  }
  function readInput(out, keyArr, pads) {
    let mask = 0;
    for (let i = 0; i < 12; i++) {
      let v = keyArr[i] ? 1 : 0;
      for (const pad of pads) for (const s of padmap[BTN[i]] || []) v = Math.max(v, srcValue(pad, s));
      const p = Math.round(v * 255);
      out.press[i] = p;
      if (p >= settings.thresh || keyArr[i]) mask |= 1 << i;
    }
    out.mask = mask;
  }
  // which input drives each player in this tab: 'auto', 'kb' (keyboard only) or one controller.
  // Kept per tab (sessionStorage), so two studio windows can each take their own controller, or one the keyboard.
  const PICK_KEY = 'bitkit.inputPick.bit' + BIT_NO;
  const picks = [{ k: 'auto' }, { k: 'auto' }];
  try { const v = EMBED ? null : JSON.parse(sessionStorage.getItem(PICK_KEY) || 'null'); if (Array.isArray(v)) v.slice(0, 2).forEach((o, i) => { if (o && o.k) picks[i] = o; }); } catch (e) { /* ignore */ }
  function savePicks() { try { sessionStorage.setItem(PICK_KEY, JSON.stringify(picks)); } catch (e) { /* ignore */ } }
  function pickedPad(pads, pk) { return pads.find(p => p.index === pk.i && p.id === pk.id) || pads.find(p => p.id === pk.id) || null; }
  // pads and keyboard for player n (0 or 1) in this tab
  function sourcesFor(n, pads) {
    const pk = picks[n];
    if (n === 0 && pk.k !== 'pad' && wantP2() && picks[1].k === 'pad') {   // a controller picked for player 2 is not player 1's too
      const p2 = pickedPad(pads, picks[1]); pads = pads.filter(p => p !== p2);
    }
    if (pk.k === 'pad') { const p = pickedPad(pads, pk); return { pads: p ? [p] : [], kb: false }; }
    const kb = n === 0 ? keys : (picks[0].k === 'pad' ? orKeys() : keys2);   // player 2 gets the arrow keys too when player 1 is on a controller
    if (pk.k === 'kb') return { pads: [], kb };
    if (n === 1) return { pads: pads.slice(1, 2), kb };   // auto, player 2: the second controller + I J K L
    if (link.peers.size) {              // linked Bit windows: one controller each
      const taken = peerPads(pads);
      if (taken.length) return { pads: pads.filter(p => !taken.includes(p)), kb };   // other Bits chose controllers: use the rest
      if (pads.length > 1) { const r = linkRank(); return { pads: pads.slice(r, r + 1), kb }; }
    }
    if (wantP2()) return { pads: pads.slice(0, 1), kb };
    return { pads, kb };
  }
  // controllers other Bits picked for themselves
  function peerPads(pads) { const out = []; for (const p of link.peers.values()) { const q = p.pick && p.pick.k === 'pad' ? pickedPad(pads, p.pick) : null; if (q) out.push(q); } return out; }
  function padOwner(pad) { for (const p of link.peers.values()) if (p.pick && p.pick.k === 'pad' && pickedPad(input.pads, p.pick) === pad) return p.num; return 0; }
  const keysBoth = new Uint8Array(12), noKeys = new Uint8Array(12);
  function orKeys() { for (let i = 0; i < 12; i++) keysBoth[i] = keys[i] | keys2[i]; return keysBoth; }
  function pollInput() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    input.pads = pads;
    if (EMBED) { input.mine = []; input.mask = ext.mask; input.press.set(ext.press); return; }
    const s1 = sourcesFor(0, pads);
    input.mine = s1.pads;
    readInput(input, s1.kb || noKeys, s1.pads);
    if (forceCombo > 0) { forceCombo--; input.mask |= START | SELECT; }
    if (wantP2()) { const s2 = sourcesFor(1, pads); readInput(input2, s2.kb || noKeys, s2.pads); }
    if (embed.on && embed.api) { try { embed.api.extInput(input2.mask, input2.press); } catch (e) { /* the frame is gone */ } }
    if (chooser.open) chooserPoll(pads);
  }

  // "Choose a controller" panel over the screen: opens by itself in a new Bit 2 window, and from the link bar.
  // Press any button on a controller to take it, or any key for the keyboard.
  const chooser = { open: false, base: new Map(), shown: 0, el: $('padChooser') };
  function chooserBase(pads) { chooser.base = new Map(pads.map(p => [p.index + '|' + p.id, p.buttons.map(b => b.value)])); }
  function openChooser() {
    chooser.open = true; chooserBase(input.pads); chooserDraw(); chooser.el.hidden = false;
  }
  function closeChooser() { chooser.open = false; chooser.el.hidden = true; screen.focus(); }
  function choose(pk) {
    picks[0] = pk; savePicks(); buildPickers(); sendPick(); closeChooser();
    toast(`${link.peers.size || IS_BIT2 ? 'Bit ' + BIT_NO : 'This tab'} uses ${pk.k === 'pad' ? padName(pk.id) : pk.k === 'kb' ? 'the keyboard' : 'auto input'}`);
  }
  function chooserPoll(pads) {
    // check presses first: a controller the browser only now shows (after its first press) is taken by that press
    for (const p of pads) {
      const base = chooser.base.get(p.index + '|' + p.id);
      if (p.buttons.some((b, j) => b.value > .6 && (!base || base[j] < .3))) return choose({ k: 'pad', i: p.index, id: p.id });
    }
    if (pads.length !== chooser.shown) chooserDraw();
    for (const p of pads) if (!chooser.base.has(p.index + '|' + p.id)) chooser.base.set(p.index + '|' + p.id, p.buttons.map(b => b.value));
  }
  function chooserDraw() {
    const pads = input.pads;
    const who = link.peers.size || IS_BIT2 ? 'Bit ' + BIT_NO : 'this tab';
    chooser.el.innerHTML = `<div class="pc-box"><b>Which controller plays on ${who}?</b>
      <div class="dim">Press any button on it, or press a key to use the keyboard.</div>
      <div class="pc-list">${pads.map(p => `<button data-i="${p.index}">🎮 ${p.index + 1}: ${escapeHtml(padName(p.id))}${padOwner(p) ? ` <span class="dim">(Bit ${padOwner(p)} has it)</span>` : ''}</button>`).join('')}
        <button data-k="kb">⌨ Keyboard</button><button data-k="auto" class="dim">Auto</button></div>
      <div class="dim">Controller missing? Press a button on it while this window is in front: browsers only show a controller to a window after a press there.</div></div>`;
    chooser.el.querySelectorAll('button').forEach(b => b.onclick = () => {
      if (b.dataset.k) return choose({ k: b.dataset.k });
      const p = input.pads.find(q => q.index === +b.dataset.i); if (p) choose({ k: 'pad', i: p.index, id: p.id });
    });
    chooser.shown = pads.length;
  }
  window.addEventListener('keydown', e => {
    if (!chooser.open || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') closeChooser(); else choose({ k: 'kb' });
  }, true);
  function sendPick() { linkHi(); }

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
    if (!input.mine.length) return toast(input.pads.length ? 'Pick a controller for this tab first (next to the screen)' : 'Connect a controller and press any button first');
    listening = i;
    const pad = input.mine[0];
    listenBase = { axes: pad.axes.slice(), buttons: pad.buttons.map(b => b.value) };
    refreshBindings();
  }
  function checkListen() {
    if (listening < 0 || !input.mine.length) return;
    const pad = input.mine[0];
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
      buildPickers();
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
  // the "Input" pickers next to the screen
  function padName(id) { return id.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 32) || 'Controller'; }
  function buildPickers() {
    const pads = input.pads, two = wantP2();
    [0, 1].forEach(n => {
      const sel = $(n ? 'inputPick2' : 'inputPick'), pk = picks[n];
      const who = embed.on ? '' : n ? 'P2: ' : two ? 'P1: ' : '';
      const autoTxt = n ? 'Auto: 2nd controller + keys I J K L' : (pads.length ? 'Auto: keyboard + controller' : 'Keyboard');
      let html = `<option value="auto">${who}${escapeHtml(autoTxt)}</option>` + (pads.length || n || pk.k === 'kb' ? `<option value="kb">${who}Keyboard only</option>` : '');
      html += pads.map(p => `<option value="pad:${p.index}">${who}🎮 ${p.index + 1}: ${escapeHtml(padName(p.id))}</option>`).join('');
      const cur = pk.k === 'pad' ? pickedPad(pads, pk) : null;
      if (pk.k === 'pad' && !cur) html += `<option value="missing">${who}🎮 ${escapeHtml(padName(pk.id))} (press a button on it)</option>`;
      sel.innerHTML = html;
      sel.value = pk.k === 'pad' ? (cur ? 'pad:' + cur.index : 'missing') : pk.k;
      sel.classList.toggle('on', pk.k === 'pad' ? !!cur : pads.length > 0 || pk.k === 'kb');
    });
    // player 2's picker sits under Bit 2 when there is one, else next to player 1's
    const p2 = $('inputPick2'), home = embed.on ? $('bitCol2').querySelector('.input-row') : $('inputPick').parentElement;
    if (p2.parentElement !== home) { if (embed.on) home.appendChild(p2); else home.insertBefore(p2, $('padHint')); }
    p2.hidden = !two;
    // browsers hide a controller from a page until a button on it is pressed: say so instead of showing nothing
    const h = $('padHint');
    if (pads.length) { h.className = 'pad-hint on'; h.textContent = `🎮 ${pads.map(p => padName(p.id)).join(', ')} connected`; }
    else { h.className = 'pad-hint wait'; h.innerHTML = '🎮 Have a controller? <b>Press any button on it</b> to connect it.'; }
    renderKeys();
  }
  // the keyboard keys for each button, under the screen they play on
  const KEYS1 = [['← ↑ ↓ →', 'move'], ['Z', 'A'], ['X', 'B'], ['A', 'X'], ['S', 'Y'], ['Q', 'L'], ['W', 'R'], ['Enter', 'Start'], ['Shift', 'Select']];
  const KEYS2 = [['I J K L', 'move'], ['N', 'A'], ['M', 'B'], ['H', 'X'], ['U', 'Y'], ['Y', 'L'], ['O', 'R'], ['Backspace', 'Start'], ['B', 'Select']];
  function renderKeys() {
    const row = (list, who) => `<div class="keys-row">${who ? `<b>${who}</b>` : ''}${list.map(([k, b]) => `<span class="k"><kbd>${k}</kbd>${b}</span>`).join('')}</div>`;
    const two = wantP2(), kb1 = picks[0].k !== 'pad', kb2 = picks[1].k !== 'pad';
    const home = bit.on ? '<div class="keys-row dim">Hold Start + Select to go back to the home screen.</div>' : '';
    let h1 = kb1 ? row(KEYS1, two && !embed.on ? 'P1' : '') : '', h2 = '';
    if (two && kb2) { const r = row(KEYS2, embed.on ? '' : 'P2') + (kb1 ? '' : '<div class="keys-row dim">The arrow keys, Z and X work for this player too.</div>'); if (embed.on) h2 = r; else h1 += r; }
    $('keys1').innerHTML = h1 + (h1 || !embed.on ? home : ''); $('keys2').innerHTML = h2;
  }
  ['inputPick', 'inputPick2'].forEach((id, n) => {
    $(id).onchange = e => {
      const v = e.target.value;
      if (v === 'missing') return;
      if (v.startsWith('pad:')) { const p = input.pads.find(q => q.index === +v.slice(4)); if (p) picks[n] = { k: 'pad', i: p.index, id: p.id }; }
      else picks[n] = { k: v };
      savePicks(); buildPickers(); if (n === 0) sendPick();
      screen.focus();
    };
  });
  function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  window.addEventListener('gamepadconnected', e => { log(`controller connected: ${e.gamepad.id}`, 'sys'); if (!EMBED) toast(`🎮 ${padName(e.gamepad.id)} connected`); });
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
        const p = RT._bkw_audio(L.length) >> 2, f = RT.HEAPF32, g = bit.on ? Math.max(0, Math.min(10, +bitSet.volume)) / 10 : 1;
        for (let i = 0; i < L.length; i++) { L[i] = f[p + i * 2] * g; R[i] = f[p + i * 2 + 1] * g; }
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
  let playingLevel = 0;       // the level it is on (kept with a paused game)
  function syncToRuntime(withMap, levelIdx) {
    RT.HEAPU8.set(cart.palette, ptr.pal);
    RT.HEAPU8.set(cart.tiles, ptr.tiles);
    RT.HEAPU8.set(cart.flags, ptr.flags);
    if (withMap) RT.HEAPU16.set(cart.levels[levelIdx || 0].map, ptr.map >> 1);
    gfxDirtyRT = false;
  }
  // save data (save()/saved() in Lua): kept per cart in this browser under bitkit.save.<name>
  const SAVE_MAX = 16384;
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
    return true;
  }
  function loadCode(code, data, key, players, me) {
    putSave(key || null);
    RT._bkw_players(players || 1, me || 0);
    BKNet.reset(RT, me ? null : key);      // network events (net_send) for games that don't run in lockstep
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
    // playing a level, a cutscene or a track from an editor skips the game's title screen (game shell, GAME_RULES.md)
    if (typeof startLevel === 'number' && !/GAME_BOOT/.test(extraLua || '')) extraLua = 'GAME_BOOT = 3\n' + (extraLua || '');
    syncLevel();
    if (BKTracks.beforeRun(cart)) atlasDirty = true;   // track carts: edge tiles come from the road segment tiles
    if (linkWanted() && !isNetGame(getCode())) {        // other Bits are linked: they all play it too
      linkLaunch({ cart: decodeCart(serialize()), level: start, extra: extraLua, saveKey: cart.name || 'untitled',
        key: gameKey(bit.games.find(g => g.studio) || { studio: true }), studio: true });
      return;
    }
    newRouteSegment(start);
    startAudio();
    overlay.classList.add('hidden');
    clearErrLine();
    syncToRuntime(true, start);
    mapDirtyRT = false;
    log(`▶ running "${cart.name}"` + (start ? ` from ${cart.levels[start].name}` : ''), 'sys');
    playingEditor = true; playingLevels = cart.levels; playingLevel = start;
    if (bit.on) bit.playing = 'studio';
    bit.cur = bit.on ? gameKey(bit.games.find(g => g.studio) || { studio: true }) : null;
    const np = p2Local() ? 2 : 1, me = 0;
    running = loadCode(getCode(), BKEntities.toLua(cart.entities, levelsMeta(cart.levels), start, extraLua), cart.name || 'untitled', np, me) === 0;
    acc = 0; last = performance.now();
    screen.focus();
  }
  function stop(quiet) {
    if (link.s) { linkSend({ t: 'end', sid: link.s.sid }); link.s = null; link.running = false; linkUI(); linkHi(); }
    if (activeTab === 'map') setTimeout(drawMap, 0);
    running = false; RT._bkw_stop(); BKNet.stop();
    if (quiet !== true) log('■ stopped', 'sys');
  }
  onRuntimeError = msg => {
    running = false;
    overlay.textContent = msg;
    overlay.classList.remove('hidden');
    showErrLine(msg);
  };
  $('btnRun').onclick = () => run();
  $('btnStop').onclick = () => { stop(); };
  overlay.onclick = () => { if (!IS_BIT2) onErrorClick(overlay.textContent); };
  screen.addEventListener('mousedown', () => screen.focus());
  $('btnFull').onclick = () => { const g = embed.on ? $('stage') : $('gameWrap'); (g.requestFullscreen || g.webkitRequestFullscreen).call(g); screen.focus(); };

  let routeTick = 0;
  let acc = 0, last = performance.now(), fpsCount = 0, fpsT = last;
  const STEP = 1000 / 60;
  /* The Bit's own settings (the Settings app on the home screen, saved as "Bit settings"): a screen look over every
     game and app, its strength, the backlight and the volume. Only while the studio is a Bit (bit.on). The look is
     put in just for drawing the frame, so the game's own display() value stays as it was (and in a paused game). */
  const bitSet = { look: 'game', strength: 10, bright: 10, volume: 10 };
  function loadBitSettings() {
    try { const raw = localStorage.getItem('bitkit.save.Bit settings'); if (raw) Object.assign(bitSet, BKMusic.parseLua(raw)); } catch (e) { /* keep the last ones */ }
    screen.style.filter = bit.on && bitSet.bright < 10 ? `brightness(${(0.35 + bitSet.bright * 0.065).toFixed(3)})` : '';
  }
  window.BKBitSettings = bitSet;
  function blit() {
    const look = bit.on && bitSet.look !== 'game' && RT._bkw_display ? (DISPLAY_LOOKS[bitSet.look] || DISPLAY_LOOKS.off) : null;
    let keep = null, base = 0;
    if (look) {
      base = RT._bkw_display() >> 2; keep = RT.HEAP32.slice(base, base + 10);
      const k = Math.max(0, Math.min(10, +bitSet.strength || 0)) / 10;
      look.forEach((v, i) => { RT.HEAP32[base + i] = Math.round(v * k); });
    }
    const p = RT._bkw_render();
    if (keep) RT.HEAP32.set(keep, base);
    img.data.set(RT.HEAPU8.subarray(p, p + W * H * 4));
    sctx.putImageData(img, 0, 0);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    pollInput();
    if (running) {
      if (gfxDirtyRT && playingEditor && !link.s) syncToRuntime(false);   // live sprite edits while the game runs
      acc += Math.min(now - last, 100);
      let ticks = 0;
      const ls = link.s;
      if (ls && ls.ready) linkPump();
      while (running && (acc >= STEP || (ls && ls.catching && ticks < 600))) {
        let m1 = input.mask, p1 = input.press;
        if (bit.hold) {             // a resumed game sees no buttons until the one that resumed it is let go
          if (m1) { m1 = 0; p1 = NO_PRESS; } else bit.hold = false;
        }
        if (ls) {                    // lockstep: only run a frame once every Bit's input for it is here
          if (!ls.ready || link.s !== ls) break;
          const r = linkTake(ls);
          if (!r) { ls.catching = false; acc = Math.min(acc, STEP * 3); linkWaiting(ls, now); break; }
          if (r.leave) { linkLeave(true); break; }
          const e = r.e;
          [m1, p1] = e[1];
          for (let k = 2; k <= ls.np; k++) { RT.HEAPU8.set(e[k][1], ptr.pressN[k]); RT._bkw_input(k, e[k][0], ptr.pressN[k]); }
        } else if (p2Local()) {
          RT.HEAPU8.set(input2.press, ptr.press2); RT._bkw_input(2, input2.mask, ptr.press2);
        }
        RT.HEAPU8.set(p1, ptr.press);
        BKNet.before(RT);
        if (RT._bkw_frame(m1, ptr.press) !== 0) running = false;
        BKNet.after(RT);
        if (cap.rec && ++cap.n % 2 === 0) clipFrame();
        if (takeSave() && saveKey === 'Bit settings') loadBitSettings();
        const tr = RT.HEAP32;
        if (playingEditor && tr[ptr.track + 2] && route.cur) route.cur.push(tr[ptr.track], tr[ptr.track + 1]);
        if (bit.playing === 'home' && tr[ptr.track + 2] && tr[ptr.track] < 0) {   // home screen: -1 = start game n over, -2 = n is selected
          const k = tr[ptr.track], n = tr[ptr.track + 1]; tr[ptr.track + 2] = 0;
          if (k === -2) bit.sel = n; else if (k === -1) { bitRestart(n); break; }
        }
        if (tr[ptr.sys]) { const cmd = tr[ptr.sys], arg = tr[ptr.sys + 1]; tr[ptr.sys] = 0; bitRequest(cmd, arg); break; }
        if (acc >= STEP) acc -= STEP;
        ticks++; fpsCount++;
      }
      if (ticks) blit();
      if (ticks && activeTab === 'map' && route.show && (++routeTick % 10) === 0) drawMap();
    }
    last = now;
    if (bit.playing === 'home' && running) homeRoster();
    bitCombo(); captureCombo();
    if (now - fpsT >= 1000) { $('fps').textContent = running ? `${fpsCount} fps` : ''; fpsCount = 0; fpsT = now; }
    updateInputUI();
  }

  /* ------------------------------------------------------------ capture: photos and clips (Share hub) */
  // The runtime's capture module (runtime/bk_capture.c) writes them, the same code the PocketBit runs: a PNG of the
  // screen, or a GIF clip at 30 fps that keeps only what changed between frames. They go to the memory card's
  // captures/ folder (on the PocketBit: the SD card), and the Share hub shows them.
  const CLIP_MAX = 60 * 60;          // game frames (60 s)
  const cap = { rec: false, n: 0, name: '' };
  function capGame() { return (bit.on && bit.playing && bit.playing !== 'home' && lastPlayed && lastPlayed.c && lastPlayed.c.name) || (bit.playing === 'home' ? 'home' : cart.name) || 'bit'; }
  function capBytes(which, n) { return new Uint8Array(RT.HEAPU8.subarray(RT._bkw_cap_buf(which), RT._bkw_cap_buf(which) + n)); }
  function flash() { const w = $('gameWrap'); w.classList.remove('cap-flash'); void w.offsetWidth; w.classList.add('cap-flash'); }
  async function keepCapture(blob, ext, what) {
    try {
      const name = await BKStore.captures.freeName(capGame(), ext);
      await BKStore.captures.put(name, blob);
      log(`${what} saved: captures/${name} (${(blob.size / 1024).toFixed(0)} KB). Find it in the Share hub.`, 'sys');
      toast(`${what} saved · Share hub`);
    } catch (e) { log(`Could not keep the ${what.toLowerCase()}: ${e.message}`, 'err'); }
  }
  function takePhoto() {
    if (!running && !bit.on) { toast('Run the game first'); return; }
    const n = RT._bkw_shot(1);
    if (n <= 0) { toast('Could not take a photo'); return; }
    flash();
    keepCapture(new Blob([capBytes(0, n)], { type: 'image/png' }), 'png', 'Photo');
    RT._bkw_cap_free(0);
  }
  function clipFrame() {
    RT._bkw_clip_frame(2);
    if (cap.n >= CLIP_MAX) toggleClip();
  }
  function toggleClip() {
    if (!cap.rec) {
      if (!running) { toast('Run the game first'); return; }
      if (RT._bkw_clip_begin() !== 0) { toast('Could not start a clip'); return; }
      cap.rec = true; cap.n = 0; cap.name = capGame();
      RT._bkw_clip_frame(2);
      log('⏺ Recording a clip (up to 60 s). Press ⏺ again, F9, or Select + R to stop.', 'sys');
    } else {
      cap.rec = false;
      const n = RT._bkw_clip_end();
      if (n > 0) keepCapture(new Blob([capBytes(1, n)], { type: 'image/gif' }), 'gif', `Clip (${(cap.n / 60).toFixed(1)} s)`);
      else toast('Could not finish the clip');
      RT._bkw_cap_free(1);
    }
    $('btnClip').classList.toggle('rec', cap.rec);
    $('btnClip').textContent = cap.rec ? '■ Stop clip' : '⏺ Clip';
    $('gameWrap').classList.toggle('cap-rec', cap.rec);
  }
  $('btnShot').onclick = () => { takePhoto(); screen.focus(); };
  $('btnClip').onclick = () => { toggleClip(); screen.focus(); };
  window.addEventListener('keydown', e => {
    if (e.code === 'F8' && !e.repeat) { e.preventDefault(); takePhoto(); }
    else if (e.code === 'F9' && !e.repeat) { e.preventDefault(); toggleClip(); }
  });
  // on the Bit: hold Select, press L for a photo or R for a clip (like the PocketBit)
  let capCombo = 0;
  function captureCombo() {
    const m = input.mask, L = 1 << 8, R = 1 << 9;
    const now = (m & SELECT) && !(m & START) ? m & (L | R) : 0;
    if (bit.on && running) {
      if ((now & L) && !(capCombo & L)) takePhoto();
      if ((now & R) && !(capCombo & R)) toggleClip();
    }
    capCombo = now;
  }

  /* ------------------------------------------------------------ multiplayer: linked Bits */
  // Every studio window is a Bit, and Bits find each other by themselves, like PocketBits over ESP-NOW
  // (here a BroadcastChannel). The home screen shows the linked Bits. Starting a game on one Bit starts it on
  // every Bit that is on its home screen (or idle), up to MAXP players: a session.
  // Deterministic lockstep: every Bit runs the same cart, and a frame runs only once every player's buttons for
  // it have arrived (sent DELAY frames ahead to hide the link's lag). Each Bit draws its own player's view (ME).
  // Start+Select or home() by any player takes every Bit home on the same frame, and each Bit keeps the game
  // paused, so picking it again carries on together.
  // The Bit that started the session (the host) keeps a copy of every other player's memory every CK_EVERY
  // frames (a checkpoint) and the buttons since. A Bit that reloads, or falls out of the session, gets its seat
  // back from there and fast-forwards to the others.
  const MAXP = 8, CK_EVERY = 600, DELAY = 3;
  const link = { id: Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8), num: BIT_NO,
    ch: null, inbox: null, out: new Map(), peers: new Map(), s: null, running: false, early: new Map() };
  function linkSend(o) { if (link.ch) { o.from = link.id; link.ch.postMessage(o); } }
  function linkSendTo(id, o) {           // to one Bit (big messages like checkpoints go only where they are needed)
    if (!link.ch) return;
    let c = link.out.get(id);
    if (!c) { c = new BroadcastChannel('bitkit-link-' + id); link.out.set(id, c); }
    o.from = link.id; c.postMessage(o);
  }
  function myState() { return link.s ? 'game' : bit.playing === 'home' ? 'home' : running ? 'game' : 'idle'; }
  function linkHi(to) {
    const o = { t: 'hi', num: link.num, pick: picks[0], st: myState(), sid: link.s ? link.s.sid : null };
    if (to) linkSendTo(to, o); else linkSend(o);
  }
  function linkOpen() {
    if (link.ch || !window.BroadcastChannel) return;
    link.ch = new BroadcastChannel('bitkit-link');
    link.ch.onmessage = e => linkMsg(e.data || {});
    link.inbox = new BroadcastChannel('bitkit-link-' + link.id);
    link.inbox.onmessage = e => linkMsg(e.data || {});
    linkHi();
  }
  // every Bit (this one too) as [id, number], in number order
  function bitsSorted() {
    return [[link.id, link.num]].concat([...link.peers].map(([id, p]) => [id, p.num]))
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  }
  function linkRank() { return bitsSorted().findIndex(b => b[0] === link.id); }
  function peerNum(id) { return id === link.id ? link.num : (link.peers.get(id) || {}).num || 0; }
  // who plays when this Bit starts a game: itself, then every Bit on its home screen (or idle, or in this Bit's game)
  function linkRoster() {
    const s = link.s;
    const others = [...link.peers].filter(([id, p]) => p.st === 'home' || p.st === 'idle' || (s && p.sid === s.sid))
      .sort((a, b) => a[1].num - b[1].num || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
    return [link.id].concat(others).slice(0, MAXP);
  }
  function linkWanted() { return !!link.ch && linkRoster().length > 1; }
  // games that talk with net_send (Sweep Storm) aren't run in lockstep: every Bit runs its own copy and they
  // meet in the game's own lobby (studio/net.js), which works for far more Bits than lockstep
  function isNetGame(code) { return /\bnet_send\s*\(/.test(code || ''); }
  const linkSnapId = (np, id, slot) => `link${np}:${id}#${slot}`;
  // the runtime memory without its unused (zero) end, and back
  function heapCopy() {
    const h = RT.HEAPU8, w = new Uint32Array(h.buffer, h.byteOffset, h.length >> 2);
    let n = w.length;
    while (n > 0 && w[n - 1] === 0) n--;
    return h.slice(0, n * 4);
  }
  function heapRestore(heap) {
    if (!heap || heap.length > RT.HEAPU8.length) return false;
    RT.HEAPU8.set(heap); RT.HEAPU8.fill(0, heap.length);
    return true;
  }

  function linkMsg(m) {
    if (!m.from || m.from === link.id) return;
    const now = performance.now();
    let p = link.peers.get(m.from);
    if (m.t === 'bye') { if (p) { link.peers.delete(m.from); log(`🔗 Bit ${p.num} left`, 'sys'); peersChanged(); } return; }
    if (!p && m.t === 'hi') {
      p = { num: m.num | 0, pick: null, st: 'idle', sid: null, seen: now };
      link.peers.set(m.from, p);
      linkHi(m.from);   // answer straight away, so both know each other
      log(`🔗 Bit ${p.num} linked`, 'sys');
    }
    if (p) p.seen = now;
    if (m.t === 'hi') {
      const pickChanged = JSON.stringify(p.pick) !== JSON.stringify(m.pick || null), stChanged = p.st !== m.st || p.num !== (m.num | 0);
      p.num = m.num | 0; p.pick = m.pick || null; p.st = m.st; p.sid = m.sid || null;
      if (p.isNew !== false) { p.isNew = false; peersChanged(); }
      else {
        if (pickChanged) { buildPickers(); if (chooser.open) chooserDraw(); }
        if (stChanged) { linkUI(); if (bit.playing === 'home') refreshHomeSoon(); }
      }
      hostCheck(m.from);
      return;
    }
    const s = link.s;
    if (m.t === 'start') linkEnter(m);
    else if (m.t === 'rejoin') linkRejoin(m);
    else if (m.t === 'in') {
      if (s && m.sid === s.sid) putInput(s, m.f, m.slot, m.m, m.p);
      else {   // a frame of a session whose start has not arrived here yet
        let q = link.early.get(m.sid);
        if (!q) { q = []; link.early.set(m.sid, q); if (link.early.size > 4) link.early.delete(link.early.keys().next().value); }
        if (q.length < 4000) q.push(m);
      }
    } else if (m.t === 'end') {
      if (s && m.sid === s.sid) { log(`■ Bit ${peerNum(m.from)} ${m.why || 'stopped the game'}`, 'sys'); linkLeave(false); }
    } else if (m.t === 'roster') {
      if (s && m.sid === s.sid) { s.roster = m.roster; s.nums = m.nums; linkUI(); }
    } else if (m.t === 'ck') {
      if (s && m.sid === s.sid && s.host === link.id) {
        const o = s.ck.get(m.slot);
        if (!o || o.f <= m.f) s.ck.set(m.slot, { f: m.f, heap: m.heap });
        pruneLog(s);
      }
    } else if (m.t === 'paused') { if (bit.playing === 'home') refreshHomeSoon(); }
  }
  function peersChanged() {
    const s = link.s;
    if (s && s.host !== link.id && !link.peers.has(s.host)) {
      log(`🔗 Bit ${s.nums[s.roster.indexOf(s.host)] || ''} started this game and is gone, so it ended`, 'sys');
      linkLeave(false);
    }
    buildPickers(); if (chooser.open) chooserDraw();
    linkUI();
    if (bit.playing === 'home') refreshHomeSoon();
  }
  setInterval(() => {          // heartbeat: tell the others how this Bit is doing, notice Bits that are gone
    if (!link.ch) return;
    linkHi();
    const now = performance.now();
    let gone = false;
    for (const [id, p] of link.peers) if (now - p.seen > 4000) { link.peers.delete(id); gone = true; log(`🔗 lost Bit ${p.num}`, 'sys'); }
    if (gone) peersChanged();
  }, 1000);
  window.addEventListener('pagehide', () => linkSend({ t: 'bye' }));

  /* sessions */
  function newSession(st, slot) {
    const s = { sid: st.sid, host: st.from, start: st, roster: st.roster.slice(), nums: st.nums.slice(), np: st.np, slot,
      f: 0, sent: 0, inp: new Map(), log: new Map(), ck: new Map(), rj: new Map(), combo: [], at: performance.now(),
      ready: false, catching: false, waitSince: 0, hold: false, ckDone: -1, gameId: st.gameId, fp: st.fp, name: st.cart.name };
    link.s = s; link.running = true;
    const q = link.early.get(s.sid);
    if (q) { link.early.delete(s.sid); for (const m of q) putInput(s, m.f, m.slot, m.m, m.p); }
    return s;
  }
  // leave whatever this Bit is doing for a linked game: a game of its own is paused first
  function clearForSession() {
    if (link.s) { link.s = null; link.running = false; }
    else if (bit.on && running && bit.cur && bit.playing !== 'home') suspendGame();
    if (chooser.open) closeChooser();
    running = false;
  }
  // this Bit starts a game for every Bit in linkRoster()
  // o: { cart (decoded), level, extra (Lua), saveKey, key {id, fp}, studio, resume (token), nums (seats when paused) }
  function linkLaunch(o) {
    let roster = linkRoster();
    const np = roster.length;
    if (o.resume && o.nums) {   // carry on with the same Bits in the same seats where they are all here
      const byNum = new Map(roster.map(id => [peerNum(id), id]));
      if (new Set(o.nums).size === np && o.nums.every(n => byNum.has(n)) && byNum.size === np) roster = o.nums.map(n => byNum.get(n));
    }
    const st = { t: 'start', sid: Date.now().toString(36) + '-' + link.id, roster, nums: roster.map(peerNum), np, cart: o.cart,
      level: o.level | 0, extra: o.extra || '', saveKey: o.saveKey || null, gameId: o.key.id, fp: o.key.fp, studio: !!o.studio, resume: o.resume || null };
    linkSend(st);
    linkEnter(st);
  }
  // the game shell's restart (retry, new game): the host starts the same game again for the same Bits
  function linkRelaunch(extra) {
    const st = link.s.start;
    linkLaunch({ cart: st.cart, level: st.level, extra: extra + (st.extra || '').replace(/^GAME_BOOT = \d+\n/, ''), saveKey: st.saveKey,
      key: { id: st.gameId, fp: st.fp }, studio: st.studio });
  }
  async function linkFromHome(g, c, key, fresh) {
    const np = linkRoster().length;
    let resume = null, nums = null;
    if (!fresh) {             // paused before with this many Bits? every seat must still have its copy
      bit.busy = true;
      try {
        const snaps = await Promise.all(Array.from({ length: np }, (_, i) => BKSnap.get(linkSnapId(np, key.id, i + 1), key.fp)));
        if (snaps.every(x => x && x.meta.token && x.meta.token === snaps[0].meta.token)) { resume = snaps[0].meta.token; nums = snaps[0].meta.nums; }
      } catch (e) { /* start fresh */ } finally { bit.busy = false; }
      if (bit.playing !== 'home' || linkRoster().length !== np) return;
    }
    linkLaunch({ cart: g.studio ? decodeCart(serialize()) : c, level: 0, saveKey: g.studio ? (cart.name || 'untitled') : (c.name || g.name),
      key, studio: !!g.studio, resume, nums });
  }
  // a start: every Bit in its roster (the starter too) begins the game
  async function linkEnter(st) {
    const slot = st.roster.indexOf(link.id) + 1, cur = link.s;
    if (!slot || (cur && cur.sid === st.sid)) return;
    if (st.from !== link.id) {
      if (cur && !cur.roster.includes(st.from)) return;                                   // a Bit from outside this game
      if (cur && cur.host !== st.from && performance.now() - cur.at < 300 && st.sid > cur.sid) return;   // two Bits started at the same moment: the first start wins
      if (!cur && myState() === 'game') return;                                           // busy with a game of its own
    }
    clearForSession();
    const s = newSession(st, slot), c = st.cart, L = c.levels[st.level] ? st.level : 0;
    startAudio(); overlay.classList.add('hidden'); clearErrLine();
    playingLevels = c.levels; playingLevel = L;
    playingEditor = st.from === link.id && st.studio;
    bit.playing = 'link'; bit.cur = null; bit.hold = false;
    if (st.resume) {
      const snap = await BKSnap.get(linkSnapId(st.np, st.gameId, slot), st.fp).catch(() => null);
      if (link.s !== s) return;
      if (!snap || snap.meta.token !== st.resume || !heapRestore(snap.heap)) {
        log('🔗 this Bit has no paused copy of that game, so the Bits cannot carry on together', 'err');
        linkSend({ t: 'end', sid: s.sid, why: 'could not carry on the paused game' }); linkLeave(false);
        return;
      }
      saveKey = snap.meta.saveKey || null; playingLevel = snap.meta.level | 0;
      gfxDirtyRT = true; mapDirtyRT = false;
      s.hold = true; running = true;
      log(`▶ carrying on with "${c.name}" on ${st.np} Bits: you are player ${slot}`, 'sys');
    } else {
      RT.HEAPU8.set(c.palette, ptr.pal); RT.HEAPU8.set(c.tiles, ptr.tiles); RT.HEAPU8.set(c.flags, ptr.flags);
      RT.HEAPU16.set(c.levels[L].map, ptr.map >> 1);
      gfxDirtyRT = !playingEditor; mapDirtyRT = false;
      if (playingEditor) newRouteSegment(L);
      log(`🔗 playing "${c.name}" on ${st.np} Bits: you are player ${slot}`, 'sys');
      running = loadCode(c.code, BKEntities.toLua(c.entities, levelsMeta(c.levels), L, st.extra), slot === 1 ? st.saveKey : null, st.np, slot) === 0;
    }
    s.ready = true; acc = 0; last = performance.now();
    linkUI(); linkHi(); screen.focus();
  }
  // back in a game after a reload (or after falling out of it): from the host's checkpoint of this seat
  function linkRejoin(m) {
    const st = m.start;
    if (link.s && link.s.sid === st.sid && link.s.ready) return;
    clearForSession();
    const s = newSession(st, m.slot);
    s.roster = m.roster; s.nums = m.nums;
    if (!heapRestore(m.ck.heap)) { link.s = null; link.running = false; log('🔗 could not take the seat back (memory too small)', 'err'); return; }
    startAudio(); overlay.classList.add('hidden'); clearErrLine();
    playingLevels = st.cart.levels; playingLevel = 0; playingEditor = false;
    bit.playing = 'link'; bit.cur = null; bit.hold = false; saveKey = null;
    gfxDirtyRT = true; mapDirtyRT = false;
    s.f = s.sent = m.ck.f; s.ckDone = s.f;
    for (const [f, e] of m.entries) for (let k = 1; k <= s.np; k++) if (e[k]) {
      putInput(s, f, k, e[k][0], e[k][1]);
      if (k === s.slot) s.sent = Math.max(s.sent, f + 1);   // buttons this seat already sent stay as they were
    }
    s.catching = true; s.ready = true; running = true; acc = 0; last = performance.now();
    log(`🔗 back in "${st.cart.name}" as player ${m.slot}, catching up…`, 'sys');
    linkUI(); linkHi(); screen.focus();
  }
  // host: a Bit says hello. Give a missing seat back, to a Bit that reloaded or fell out of the game.
  function hostCheck(id) {
    const s = link.s, p = link.peers.get(id), now = performance.now();
    if (!s || s.host !== link.id || !p || p.sid === s.sid || now - s.at < 2500 || (s.rj.get(id) || 0) > now - 3000) return;
    let slot = s.roster.indexOf(id) + 1;   // still in the roster: it fell out of step (or missed the start)
    if (!slot) {
      if (p.st === 'game') return;         // busy with another game
      for (let k = 1; k <= s.np && !slot; k++) if (s.roster[k - 1] !== link.id && !link.peers.has(s.roster[k - 1])) slot = k;
      if (!slot) return;
    }
    const ck = s.ck.get(slot);
    if (!ck) return;
    s.rj.set(id, now);
    const entries = [];
    for (const [f, e] of s.log) if (f >= ck.f) entries.push([f, e]);
    for (const [f, e] of s.inp) if (f >= ck.f) entries.push([f, e]);
    s.roster[slot - 1] = id; s.nums[slot - 1] = p.num;
    linkSend({ t: 'roster', sid: s.sid, roster: s.roster, nums: s.nums });
    linkSendTo(id, { t: 'rejoin', start: s.start, slot, roster: s.roster, nums: s.nums, ck, entries });
    log(`🔗 Bit ${p.num} takes seat ${slot} back`, 'sys');
    linkUI();
  }
  // everyone goes home together (pause: each Bit keeps its copy of the game)
  function linkLeave(pause) {
    const s = link.s;
    if (!s) return;
    link.s = null; link.running = false;
    if (pause && s.ready && running) {
      takeSave();
      BKSnap.put(linkSnapId(s.np, s.gameId, s.slot), s.fp, heapCopy(), { token: s.sid, nums: s.nums, level: playingLevel, saveKey })
        .then(() => linkSend({ t: 'paused' }));
      log(`⏸ "${s.name}" paused on every Bit`, 'sys');
    }
    running = false; RT._bkw_stop(); playingEditor = false;
    if (activeTab === 'map') setTimeout(drawMap, 0);
    if (bit.on) bootHome(); else { bit.playing = null; bootScreen(); }
    linkUI(); linkHi();
  }

  /* lockstep */
  function putInput(s, f, slot, m, p) {
    if (f < s.f || slot < 1 || slot > s.np) return;
    let e = s.inp.get(f);
    if (!e) { e = []; s.inp.set(f, e); }
    if (!e[slot]) e[slot] = [m, Uint8Array.from(p)];
  }
  function linkPump() {        // send this Bit's buttons a few frames ahead (input delay hides the link's lag)
    const s = link.s;
    while (s.sent <= s.f + DELAY) {
      let m = input.mask, p = input.press;
      if (s.hold) { if (m) { m = 0; p = NO_PRESS; } else s.hold = false; }   // a resumed game ignores the button that resumed it
      const pa = Array.from(p);
      putInput(s, s.sent, s.slot, m, pa);
      linkSend({ t: 'in', sid: s.sid, slot: s.slot, f: s.sent, m, p: pa });
      s.sent++;
    }
  }
  function sendCk(s) { linkSendTo(s.host, { t: 'ck', sid: s.sid, slot: s.slot, f: s.f, heap: heapCopy() }); }
  function pruneLog(s) {        // host: buttons older than every seat's checkpoint are not needed any more
    let lo = Infinity;
    for (let k = 1; k <= s.np; k++) if (s.roster[k - 1] !== link.id) { const c = s.ck.get(k); lo = Math.min(lo, c ? c.f : 0); }
    for (const f of s.log.keys()) { if (f >= lo) break; s.log.delete(f); }
  }
  // the next frame's buttons for every player, or null while some are still on the way
  function linkTake(s) {
    if (s.f % CK_EVERY === 0 && s.ckDone !== s.f) { s.ckDone = s.f; if (s.host !== link.id) sendCk(s); }
    const e = s.inp.get(s.f);
    if (!e) return null;
    for (let k = 1; k <= s.np; k++) if (!e[k]) return null;
    s.inp.delete(s.f);
    if (s.host === link.id) s.log.set(s.f, e);
    s.f++;
    if (s.waitSince) { s.waitSince = 0; linkUI(); }
    let leave = false;
    for (let k = 1; k <= s.np; k++) {   // Start+Select by any player: every Bit goes home on this same frame
      const both = (e[k][0] & (START | SELECT)) === (START | SELECT);
      if (both && !s.combo[k]) leave = true;
      s.combo[k] = both;
    }
    return { e, leave };
  }
  function linkWaiting(s, now) {
    if (!s.waitSince) { s.waitSince = now; return; }
    if (now - s.waitSince < 500 || now - (s.uiAt || 0) < 500) return;
    s.uiAt = now;
    const e = s.inp.get(s.f) || [], miss = [];
    for (let k = 1; k <= s.np; k++) if (!e[k]) miss.push('Bit ' + s.nums[k - 1]);
    const msg = `Waiting for ${miss.join(', ') || 'the other Bits'}…`;
    linkUI(msg + ' (Start+Select leaves the game)');
    if (now - s.waitSince > 1000) { const w = $('linkWait'); w.textContent = msg + '\nStart+Select leaves the game'; w.style.whiteSpace = 'pre-line'; w.hidden = false; }
  }

  /* home screen and link bar */
  // the home screen reads the linked Bits from map row 0 and 1 (it has no map of its own):
  // (0,0) how many Bits, (1,0) which one is this, (1+i,0) Bit i's number, (1+i,1) 1 home, 2 in a game, 3 idle
  function homeRoster() {
    const b = bitsSorted(), base = ptr.map >> 1, H16 = RT.HEAPU16;
    H16[base] = b.length; H16[base + 1] = b.findIndex(x => x[0] === link.id) + 1;
    b.slice(0, 40).forEach((x, i) => {
      const p = link.peers.get(x[0]), st = p ? p.st : 'home';
      H16[base + 2 + i] = x[1]; H16[base + MAPW + 2 + i] = st === 'home' ? 1 : st === 'game' ? 2 : 3;
    });
  }
  let homeRefreshT = 0;
  function refreshHomeSoon() {     // paused badges depend on who is linked: draw the home screen again
    clearTimeout(homeRefreshT);
    homeRefreshT = setTimeout(() => { if (bit.on && bit.playing === 'home' && !bit.busy && !link.s) bootHome(); }, 400);
  }
  function linkUI(msg) {
    // the bar is for Bits in other windows: alone, or with only the Bit next door in Play mode, it stays out of the way
    const outside = link.peers.size - (embed.on && embed.api && link.peers.has(embed.api.link.id) ? 1 : 0);
    $('linkBar').hidden = EMBED || (!IS_BIT2 && !outside && !msg);
    if (!msg) $('linkWait').hidden = true;
    $('linkBar').classList.toggle('ok', link.peers.size > 0);
    const s = link.s, others = bitsSorted().filter(b => b[0] !== link.id).map(b => 'Bit ' + b[1]);
    $('linkStatus').textContent = msg || (!link.ch ? 'This browser cannot link Bits'
      : s ? `Bit ${link.num} · playing with ${s.nums.filter((n, i) => s.roster[i] !== link.id).map(n => 'Bit ' + n).join(', ')} · you are player ${s.slot}`
      : others.length ? `Bit ${link.num} · linked with ${others.join(', ')}. A game started on one Bit starts on every Bit that is on its home screen.`
      : `Bit ${link.num} · no other Bits yet. Add a Bit to play together.`);
  }
  $('players').value = playMode;
  $('players').onchange = e => {
    if (e.target.value === 'win') { e.target.value = playMode; openBitWindow(); return; }
    if (running && !link.s) stop(true);
    playMode = e.target.value; lsSet('bitkit.players', playMode);
    buildPickers();
    if (playMode === '2') log('2 players on this screen: player 2 uses the second controller, or I J K L to move, N to jump, M to throw. Linked Bits play one player each instead.', 'sys');
  };
  $('linkPad').onclick = () => openChooser();
  $('linkOpen').onclick = openBitWindow;
  function openBitWindow() {
    const used = new Set(bitsSorted().map(b => b[1]));
    let n = 2;
    while (used.has(n)) n++;
    const w = window.open(location.pathname + '?bit=' + n, 'bitkit-bit' + n, 'width=720,height=640');
    if (!w) toast('The browser blocked the new window. Allow pop-ups, or open this page again in another window.');
  }

  /* ------------------------------------------------------------ boot screen */
  function bootScreen() {
    loadCode(`function _draw() cls(1)
  text("${APP.toUpperCase()}", 160 - ${APP.length * 12}, 84, 17, 3)
  text("Press Run to test your game", 52, 130, 29)
  text("Play shows it on a Bit", 72, 144, 29) end`);
    RT.HEAPU8.fill(0, ptr.press, ptr.press + 12);
    RT._bkw_frame(0, ptr.press);
    blit();
    RT._bkw_stop();
  }

  /* ------------------------------------------------------------ cart actions */
  function applyCart(keepUndo) {
    $('cartName').value = cart.name;
    const ch = cartChanged;
    setCode(cart.code, keepUndo);
    setChanged(ch);            // putting the code in the editor is not a change to the game
    atlasDirty = true; gfxDirtyRT = true;
    if (activeTab === 'sprites') drawSprites();
    mp.x = 0; mp.y = 0; mp.autoz = true;
    if (activeTab === 'map') { refreshLevels(); refreshEntSelect(); fitMap(); drawMap(); }
    if (activeTab === 'entities') entEd.render();
    if (activeTab === 'cutscenes') csEd.render();
    if (activeTab === 'track') trkEd.render();
    if (activeTab === 'game') renderGameTab();
    if (!tabUsed(activeTab)) showTab('code'); else refreshTabs();
  }
  // built-in demos: each demo file pushes {name, code, buildGfx, about} onto window.BK_DEMOS
  const DEMOS = () => (window.BK_DEMOS && window.BK_DEMOS.length ? window.BK_DEMOS : [BK_DEMO]);
  function blankInto(name, code) {
    cart.name = name; cart.code = code; cart.palette.set(DEFAULT_PAL);
    cart.tiles.fill(0); cart.flags.fill(0);
    cart.levels = null; cart.map = new Uint16Array(MAPW * MAPH);
    cart.entities = { types: [], placed: [] };
  }
  function loadDemo(d) { d = d || DEMOS()[0]; blankInto(d.name, d.code); d.buildGfx(cart); normalizeLevels(); }
  $('cartName').addEventListener('input', e => { cart.name = e.target.value || 'untitled'; markDirty(); });

  /* ------------------------------------------------------------ games: switch, new, open */
  // Switching games never loses work. Every game in the editor has an id (gid): a built-in game ("demo:Kart Lab"),
  // a file on the Bit's memory card ("file:my-game.bitkit") or a new game not saved as a file yet ("new:...").
  // Leaving a game you changed keeps your version as a draft (in this browser); opening it again brings it back.
  let gid = lsGet(LS.cart + '.gid') || '';
  function setGid(g) { gid = g; lsSet(LS.cart + '.gid', g); }
  const newGid = () => 'new:' + Date.now().toString(36);
  async function stashCurrent() {
    syncLevel(); saveLocal(); dirtySave = false;
    if (!cartChanged || !gid) return;
    try { await BKStore.drafts.put(gid, { name: cart.name, data: serialize(), t: Date.now() }); }
    catch (e) { log(`Could not keep your changes to "${cart.name}": ${e.message}`, 'err'); }
  }
  // ref: { demo } a built-in game, { file, data } a game on the Bit, { draft: gid }, { blank: true }, or { data } (a file or pasted text)
  async function openGame(ref) {
    await stashCurrent();
    const key = ref.demo ? 'demo:' + ref.demo.name : ref.file ? 'file:' + ref.file : ref.draft || newGid();
    let draft = null;
    try { draft = await BKStore.drafts.get(key); } catch (e) { /* no drafts here */ }
    try {
      if (draft) deserialize(draft.data);
      else if (ref.demo) loadDemo(ref.demo);
      else if (ref.blank) { blankInto('my game', NEW_CODE); normalizeLevels(); }
      else if (ref.data) deserialize(ref.data);
      else throw new Error('that game is gone');
    } catch (e) { toast('Could not open it: ' + e.message); return false; }
    setGid(key); setCartFile(ref.file || null);
    setChanged(!!draft || !(ref.demo || ref.file || ref.blank));
    applyCart(); saveLocal(); dirtySave = false; histReset();
    closeModal();
    toast(draft ? `Opened ${cart.name}, with your changes` : `Opened ${cart.name}`);
    if (mode !== 'edit') await setMode('edit'); else { stop(true); bootScreen(); }
    return true;
  }
  function cartFileName() { return (cart.name || 'cart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.bitkit'; }
  $('btnSave').onclick = () => {
    saveLocal();
    const text = JSON.stringify(serialize());
    modal('Save', `<p class="dim">Your work is saved in this browser as you go. <b>Save to my games</b> also puts it on the Bit's home screen${BKStore.state === 'folder' ? ` (the folder ${escapeHtml(BKStore.label())})` : ''}. To move it to another computer, download the file or copy the text below (open it there from the Games menu). To share it with people, use the <b>🌍 Share hub</b>.</p>
      <textarea id="mText" readonly></textarea>`, [
      ['Copy text', b => { const t = $('mText'); t.select(); (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Copied'), () => { document.execCommand && document.execCommand('copy'); toast('Text selected, press Ctrl+C'); }); }],
      ['Download ' + cartFileName(), () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = cartFileName(); a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }],
      [cartFile ? `Save to my games (${cartFile})` : 'Save to my games', async () => { if (await saveToBit(true)) closeModal(); }, 'primary'],
      ['Close', closeModal]]);
    $('mText').value = text;
  };
  function openDialog() {
    modal('Open a game file', `<p class="dim">Pick a .bitkit file, or paste the text of a game. The game you have open now is kept: find it again in the Games menu.</p><textarea id="mText" placeholder="Paste game text here"></textarea>`, [
      ['Choose file…', () => $('fileOpen').click()],
      ['Open pasted text', () => { let o; try { o = JSON.parse($('mText').value); decodeCart(o); } catch (err) { toast('That text is not a game: ' + err.message); return; } openGame({ data: o }); }, 'primary'],
      ['Cancel', closeModal]]);
  }
  $('fileOpen').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const o = JSON.parse(await f.text()); decodeCart(o); await openGame({ data: o }); }
    catch (err) { log('Could not open that file: ' + err.message, 'err'); toast('That file is not a game'); }
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
  const bit = { on: false, playing: null, games: [], sel: 1, cur: null, hold: false, busy: false };
  const NO_PRESS = new Uint8Array(12);
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
  // the built-in demos as ready-to-play carts (built once, on first use)
  const demoCarts = new Map();
  function demoCart(d) {
    if (demoCarts.has(d)) return demoCarts.get(d);
    const c = { name: d.name, code: d.code, palette: new Uint8Array(DEFAULT_PAL), tiles: new Uint8Array(TILES * 64), flags: new Uint8Array(TILES),
      map: new Uint16Array(MAPW * MAPH), entities: { types: [], placed: [] }, levels: null };
    d.buildGfx(c);
    if (!c.levels || !c.levels.length) c.levels = [{ name: 'Level 1', w: MAPW, h: MAPH, map: c.map, placed: c.entities.placed }];
    demoCarts.set(d, c);
    return c;
  }
  /* paused games: leaving a game for the home screen keeps it (studio/snapshots.js), picking it again carries on */
  // a game's id and fingerprint; a paused game only resumes while its contents are unchanged
  function gameKey(g) {
    if (g.studio) { syncLevel(); return { id: 'studio', fp: BKSnap.hash(JSON.stringify(serialize())) }; }
    if (g.demo) return { id: 'demo:' + g.name, fp: BKSnap.hash(g.demo.code) };
    if (g.app) return { id: 'app:' + g.name, fp: BKSnap.hash(g.app.code) };
    return { id: 'file:' + g.file, fp: BKSnap.hash(JSON.stringify(g.data)) };
  }
  // keep the game that is playing on the Bit (call before anything else runs in the runtime)
  function suspendGame() {
    if (!bit.on || !running || !bit.cur || bit.playing === 'home' || link.running) return;
    takeSave();
    BKSnap.put(bit.cur.id, bit.cur.fp, RT.HEAPU8.slice(), { saveKey, level: playingLevel });
    log(`⏸ Bit: paused "${bit.cur.name || bit.playing}"`, 'sys');
  }
  // carry on with a paused game: put its memory back and keep running frames
  function resumeGame(snap, g, c, key) {
    if (snap.heap.length > RT.HEAPU8.length) return false;
    stop(true);
    startAudio();
    overlay.classList.add('hidden');
    clearErrLine();
    RT.HEAPU8.set(snap.heap);
    saveKey = snap.meta.saveKey || null;
    BKNet.reset(RT, saveKey);
    playingLevel = snap.meta.level | 0;
    gfxDirtyRT = false; mapDirtyRT = false;
    playingEditor = !!g.studio; playingLevels = c.levels;
    bit.playing = g.studio ? 'studio' : g.demo ? 'demo:' + g.name : g.app ? 'app:' + g.name : g.file;
    bit.cur = key;
    if (g.studio) newRouteSegment(playingLevel);
    bit.hold = true;
    log(`▶ Bit: carrying on with "${c.name || g.name}" (X on the home screen starts it over)`, 'sys');
    running = true; acc = 0; last = performance.now();
    screen.focus();
    return true;
  }
  function bitRestart(n) {
    const g = bit.games[n - 1];
    if (!g) return;
    const id = gameKey(g).id;
    BKSnap.forget(id);
    for (let np = 2; np <= MAXP; np++) for (let k = 1; k <= np; k++) BKSnap.forget(linkSnapId(np, id, k));
    bitRequest(1, n, true);
  }
  // pause the game when the page is hidden (tab switched or closed), so a reload can carry on too
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !bit.on || !running || !bit.cur || bit.playing === 'home' || link.running) return;
    takeSave();
    BKSnap.put(bit.cur.id, bit.cur.fp, RT.HEAPU8.slice(), { saveKey, level: playingLevel });
  });

  async function bootHome() {
    bit.cur = null; bit.hold = false;
    loadBitSettings();
    const lib = await libraryGames();
    const libGames = lib.filter(g => g.file !== cartFile).map(g => ({ name: g.data.name || g.file, file: g.file, data: g.data }));
    // every built-in demo is on the Bit too, unless the studio or the memory card already has a game with that name
    const taken = new Set([cart.name].concat(libGames.map(g => g.name)));
    const demos = DEMOS().filter(d => !taken.has(d.name)).map(d => ({ name: d.name, demo: d }));
    // the Bit's own apps (studio/bitapps.js) go on the shelf under the games
    const apps = (window.BK_APPS || []).map(a => ({ name: a.name, app: a }));
    bit.games = [{ name: cart.name, studio: true, cart: null }].concat(libGames, demos, apps);
    const paused = await BKSnap.list(), np = linkRoster().length;   // linked: a game is paused when every player's Bit kept it
    const tiles = new Uint8Array(TILES * 64);
    const COLORS = [3, 8, 15, 20, 25, 4, 9, 16];
    const rows = bit.games.slice(0, 96).map((g, i) => {
      const slot = Math.floor(i / 8) * 32 + (i % 8) * 2 + 0;
      let c = null;
      if (g.app) { appIcon(g.app, slot, tiles); c = null; }
      else if (g.studio) c = cart; else if (g.demo) { try { c = demoCart(g.demo); } catch (e) { c = null; } } else { try { c = decodeCart(g.data); } catch (e) { c = null; } }
      const has = c && iconFor(c, slot, tiles);
      const k = gameKey(g), p = np > 1 ? Array.from({ length: np }, (_, j) => paused.get(linkSnapId(np, k.id, j + 1)) === k.fp).every(Boolean) : paused.get(k.id) === k.fp;
      return `{name=${luaStr(g.name)}, file=${luaStr(g.file || '')}, studio=${g.studio ? 'true' : 'false'}, paused=${p}, ${has || g.app ? `icon=${slot}` : `color=${COLORS[i % COLORS.length]}`}${g.app ? `, app=true, sub=${luaStr(g.app.sub || '')}` : ''}}`;
    });
    if (bit.sel > bit.games.length) bit.sel = 1;
    const data = `BIT = { games = {${rows.join(',')}}, sel = ${bit.sel}, studio = ${!IS_BIT2}, link = true, source = ${luaStr(BKStore.state === 'folder' ? BKStore.label() : '')} }`;
    startAudio();
    overlay.classList.add('hidden');
    RT.HEAPU8.set(DEFAULT_PAL, ptr.pal); RT.HEAPU8.set(tiles, ptr.tiles);
    RT.HEAPU8.fill(0, ptr.flags, ptr.flags + TILES); RT.HEAPU16.fill(0, ptr.map >> 1, (ptr.map >> 1) + MAPW * MAPH);
    gfxDirtyRT = true; playingEditor = false; bit.playing = 'home';
    running = loadCode(window.BK_HOME, data) === 0;
    acc = 0; last = performance.now();
    screen.focus();
  }
  function appIcon(a, slotTile, tiles) {   // an app's 16x16 icon into the home screen's tile sheet
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
      tiles[(slotTile + (y >> 3) * 16 + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7)] = (a.icon[y] || [])[x] || 0;
  }
  // an app as a cart (no graphics of its own: apps draw with shapes and text)
  const appCarts = new Map();
  function appCart(a) {
    if (!appCarts.has(a)) appCarts.set(a, { name: a.name, code: a.code, palette: new Uint8Array(DEFAULT_PAL), tiles: new Uint8Array(TILES * 64), flags: new Uint8Array(TILES),
      map: new Uint16Array(MAPW * MAPH), entities: { types: [], placed: [] }, levels: [{ name: 'App', w: MAPW, h: MAPH, map: new Uint16Array(MAPW * MAPH), placed: [] }] });
    return appCarts.get(a);
  }
  let lastPlayed = null;
  function playCart(c, label, extraLua, key) {
    lastPlayed = { c, label, key };
    startAudio();
    overlay.classList.add('hidden');
    RT.HEAPU8.set(c.palette, ptr.pal); RT.HEAPU8.set(c.tiles, ptr.tiles); RT.HEAPU8.set(c.flags, ptr.flags);
    RT.HEAPU16.set(c.levels[0].map, ptr.map >> 1);
    gfxDirtyRT = true; playingEditor = false; bit.playing = label; playingLevels = c.levels; playingLevel = 0;
    log(`▶ Bit: playing "${c.name}"`, 'sys');
    running = loadCode(c.code, BKEntities.toLua(c.entities, levelsMeta(c.levels), 0, extraLua), key || c.name || label, p2Local() ? 2 : 1, 0) === 0;
    acc = 0; last = performance.now();
    screen.focus();
  }
  // _restart(mode) from the game shell: load the playing game again (GAME_BOOT: 1 title, 2 new game, 3 play)
  function restartGame(mode) {
    if (link.s) { if (link.s.host === link.id) linkRelaunch(`GAME_BOOT = ${mode | 0}\n`); return; }   // linked: the Bit that started it starts it again for all
    const extra = `GAME_BOOT = ${mode | 0}\n`;
    const onBit = bit.on && bit.cur && bit.playing && bit.playing !== 'home' && bit.playing !== 'studio' && lastPlayed;
    if (onBit) {
      const key = bit.cur;
      BKSnap.forget(key.id);
      stop(true);
      playCart(lastPlayed.c, lastPlayed.label, extra, lastPlayed.key);
      bit.cur = key;
    } else if (playingEditor) {
      stop(true);
      run(undefined, extra);
    }
  }
  async function bitRequest(cmd, arg, fresh) {
    if (cmd === 5) { restartGame(arg); return; }
    if (cmd === 4) {   // level(n): load that level's map before the next frame
      const L = playingLevels && playingLevels[arg - 1];
      if (L) { RT.HEAPU16.set(L.map, ptr.map >> 1); playingLevel = arg - 1; if (playingEditor) newRouteSegment(arg - 1); }
      return;
    }
    if (cmd === 2) { if (link.s) linkLeave(true); else if (bit.on) { suspendGame(); bootHome(); } return; }
    const g = bit.games[arg - 1];
    if (!bit.on || bit.playing !== 'home' || !g || bit.busy) return;
    bit.sel = arg;
    if (cmd === 1) {
      const key = gameKey(g);
      key.name = g.name;
      let c = null;
      try { c = g.app ? appCart(g.app) : g.studio ? cart : g.demo ? demoCart(g.demo) : decodeCart(g.data); } catch (e) { log(`Could not start ${g.name}: ${e.message}`, 'err'); return; }
      if (linkWanted() && !isNetGame(c.code) && !g.app) { linkFromHome(g, c, key, fresh); return; }   // other Bits are on their home screens: play it together
      if (!fresh) {
        bit.busy = true;
        let snap = null;
        try { snap = await BKSnap.get(key.id, key.fp); } finally { bit.busy = false; }
        if (!bit.on || bit.playing !== 'home') return;
        if (snap && resumeGame(snap, g, c, key)) return;
      }
      if (g.studio) run();
      else if (g.app) playCart(c, 'app:' + g.name, '', g.app.saveKey);
      else playCart(c, g.demo ? 'demo:' + g.name : g.file);
      bit.cur = key;
    } else if (cmd === 3) {          // Y on the home screen: edit that game (the one open before is kept, see openGame)
      if (IS_BIT2 || g.app) return;
      bit.sel = 1;
      if (g.studio) setMode('edit'); else openGame(g.demo ? { demo: g.demo } : { file: g.file, data: g.data });
    }
  }
  function bitCombo() {
    const both = (input.mask & (START | SELECT)) === (START | SELECT);
    if (link.s) {   // linked: Start+Select travels with the buttons (see linkTake); here only a stuck game is left
      const s = link.s;
      if (both && !comboHeld && (!running || (s.waitSince && performance.now() - s.waitSince > 1000))) {
        linkSend({ t: 'end', sid: s.sid, why: 'left the game' }); linkLeave(false);
      }
    } else if (both && !comboHeld && bit.on && bit.playing !== 'home') { suspendGame(); stop(true); bootHome(); }
    comboHeld = both;
  }
  function setBitPower(on) {
    bit.on = on;
    loadBitSettings();
    if (on) { log('Bit on: home screen. Hold Start+Select in a game to pause it and come back; picking it again carries on.', 'sys'); bootHome(); }
    else { suspendGame(); stop(true); bit.playing = null; bit.cur = null; bootScreen(); }
  }
  async function saveToBit(confirmNew) {
    const file = cartFile || cartFileName();
    try {
      if (!cartFile && confirmNew && await BKStore.exists(file) &&
          !await ask(`Replace ${file}?`, 'A game with this file name is already on the Bit.', 'Replace')) return false;
      await BKStore.save(file, serialize());
      try { await BKStore.drafts.del(gid); await BKStore.drafts.del('file:' + file); } catch (e) { /* no drafts here */ }
      setCartFile(file); setGid('file:' + file); setChanged(false);
      toast(`Saved to my games: ${file}`);
      return true;
    } catch (e) { log('Could not save to the Bit: ' + e.message, 'err'); toast('Save failed'); return false; }
  }

  // a game's 16x16 icon on a small canvas
  function drawIcon(cv, c) {
    try {
      const x = cv.getContext('2d'), im = x.createImageData(16, 16), tl = new Uint8Array(64 * 18);
      if (!iconFor(c, 0, tl)) return false;
      for (let y = 0; y < 16; y++) for (let xx = 0; xx < 16; xx++) {
        const v = tl[((y >> 3) * 16 + (xx >> 3)) * 64 + (y & 7) * 8 + (xx & 7)], o = (y * 16 + xx) * 4;
        im.data[o] = c.palette[v * 3]; im.data[o + 1] = c.palette[v * 3 + 1]; im.data[o + 2] = c.palette[v * 3 + 2]; im.data[o + 3] = v ? 255 : 0;
      }
      x.putImageData(im, 0, 0);
      return true;
    } catch (e) { return false; }
  }
  // The Games menu: every game in one place. Your games (files on the Bit's memory card, and new games not saved
  // as a file yet), the built-in games, a new game, a file from somewhere else.
  async function showGames() {
    await stashCurrent();
    const lib = await BKStore.list().catch(e => { log(e.message, 'err'); return []; });
    const drafts = await BKStore.drafts.list().catch(() => []);
    const dmap = new Map(drafts.map(d => [d.key, d]));
    const st = BKStore.state;
    const tag = (t, cls) => ` <span class="lib-tag ${cls || ''}">${t}</span>`;
    const openTag = k => (k === gid ? tag('open in the editor') : '');
    const mine = lib.map(g => ({ key: 'file:' + g.file, name: g.data ? (g.data.name || g.file) : g.file, sub: g.file, bad: !g.data,
      data: (dmap.get('file:' + g.file) || {}).data || g.data, ref: { file: g.file, data: g.data }, file: g.file, edited: dmap.has('file:' + g.file) || ('file:' + g.file === gid && cartChanged) }));
    drafts.filter(d => d.key.startsWith('new:')).forEach(d => mine.push({ key: d.key, name: d.name, sub: 'not saved as a file yet', data: d.data, ref: { draft: d.key }, draft: true }));
    if (gid.startsWith('new:') && !dmap.has(gid)) mine.push({ key: gid, name: cart.name, sub: 'not saved as a file yet', data: serialize(), ref: { draft: gid }, draft: true });
    const rows = mine.map((g, i) => `<div class="lib-row${g.key === gid ? ' cur' : ''}"><canvas width="16" height="16" data-mine="${i}"></canvas>
        <div class="lib-name">${g.bad ? `<span class="err">${escapeHtml(g.name)} (unreadable)</span>` : escapeHtml(g.name)}${openTag(g.key)}${g.edited ? tag('unsaved changes', 'warn') : ''}<div class="dim small">${escapeHtml(g.sub)}</div></div>
        ${g.bad ? '' : `<button class="tiny" data-open="${i}" title="Edit this game">Edit</button>`}${g.bad || g.draft && g.key !== gid ? '' : `<button class="tiny" data-play="${i}" title="Play it on the Bit">Play</button>`}
        ${g.key === gid && g.draft ? '' : `<button class="tiny danger" data-del="${i}" title="Delete this game">✕</button>`}</div>`).join('')
      || '<div class="dim">Nothing here yet. Start a new game, or edit one of the built-in games: your version is kept for you.</div>';
    const demos = DEMOS();
    const cards = demos.map((d, i) => {
      const key = 'demo:' + d.name, edited = dmap.has(key) || (key === gid && cartChanged);
      return `<div class="game-card${key === gid ? ' cur' : ''}"><canvas width="16" height="16" data-demo="${i}"></canvas>
        <div class="gc-text"><div><b>${escapeHtml(d.name)}</b>${openTag(key)}${edited ? tag('your version', 'warn') : ''}</div><div class="dim small">${escapeHtml(d.about || '')}</div>
        <div class="gc-btns"><button class="tiny" data-dopen="${i}" title="Look inside and change it. Your changes are kept as your own version">Edit</button><button class="tiny" data-dplay="${i}" title="Play it on the Bit">Play</button>${edited ? `<button class="tiny danger" data-dreset="${i}" title="Throw away your changes and go back to the original">Reset</button>` : ''}</div></div></div>`;
    }).join('');
    const where = st === 'folder' ? `the folder 📁 <b>${escapeHtml(BKStore.label())}</b> on this computer`
      : st === 'reconnect' ? `the folder 📁 <b>${escapeHtml(BKStore.label())}</b> (needs reconnecting)`
      : `<b>this browser</b>${BKStore.canPickFolder ? '' : ' (this browser can\'t open folders; Chrome or Edge can)'}`;
    modal('Games', `<div class="games">
      <div class="games-head"><b>Your games</b><span class="grow"></span><button id="gmNew" class="tiny primary">＋ New game</button><button id="gmOpen" class="tiny">Open a file…</button></div>
      <div class="lib-list">${rows}</div>
      <div class="lib-where">Kept on the Bit's memory card: ${where}.
        ${BKStore.canPickFolder ? '<button id="libPick" class="tiny">Choose folder…</button>' : ''}
        ${st === 'reconnect' ? '<button id="libReconnect" class="tiny primary">Reconnect folder</button>' : ''}
        ${st !== 'browser' ? '<button id="libBrowser" class="tiny">Use this browser instead</button>' : ''}</div>
      <div class="games-head"><b>Built-in games</b><span class="dim small">Play them, or open one to see how it is made.</span></div>
      <div class="game-cards">${cards}</div>
      <p class="dim small">Switching games never loses work: a game you changed is kept as it was when you left it.</p></div>`,
      [['Close', closeModal, 'primary']], 'wide');
    document.querySelectorAll('canvas[data-mine]').forEach(cv => { const g = mine[+cv.dataset.mine]; if (g.data) { try { drawIcon(cv, decodeCart(g.data)); } catch (e) { /* no icon */ } } });
    document.querySelectorAll('canvas[data-demo]').forEach(cv => { try { drawIcon(cv, demoCart(demos[+cv.dataset.demo])); } catch (e) { /* no icon */ } });
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    const each = (attr, fn) => document.querySelectorAll(`#modal [data-${attr}]`).forEach(b => b.onclick = () => fn(+b.dataset[attr], b));
    on('gmNew', () => openGame({ blank: true }));
    on('gmOpen', openDialog);
    on('libPick', async () => {
      try { await BKStore.chooseFolder(); showCartFile(); toast(`Memory card: ${BKStore.label()}`); if (bit.on) bootHome(); showGames(); }
      catch (e) { if (e.name !== 'AbortError') { log('Folder not available here: ' + e.message, 'err'); toast('Folders are blocked here. Open the studio in its own tab.'); } }
    });
    on('libReconnect', async () => { try { await BKStore.reconnect(); } catch (e) { log(e.message, 'err'); } if (bit.on) bootHome(); showGames(); });
    on('libBrowser', async () => { await BKStore.useBrowser(); setCartFile(null); if (gid.startsWith('file:')) setGid(newGid()); if (bit.on) bootHome(); showGames(); });
    const openOrShow = g => (g.key === gid ? (closeModal(), setMode('edit')) : openGame(g.ref));
    each('open', i => openOrShow(mine[i]));
    each('play', i => { const g = mine[i]; playOnBit(x => (g.key === gid ? x.studio : x.file === g.file)); });
    each('del', async i => {
      const g = mine[i];
      const what = g.draft ? 'It was never saved as a file, so it is gone for good.' : BKStore.state === 'folder' ? 'The file is deleted from the folder on your computer. This cannot be undone.' : 'It is removed from this browser.';
      if (!await ask(`Delete ${g.name}?`, what, 'Delete')) { showGames(); return; }
      try {
        if (g.file) await BKStore.remove(g.file);
        await BKStore.drafts.del(g.key);
        if (g.key === gid) { setCartFile(null); setGid(newGid()); setChanged(true); }   // still open in the editor: it lives on as a new game
        toast('Deleted');
      } catch (e) { log(e.message, 'err'); }
      if (bit.on && bit.playing === 'home') bootHome();
      showGames();
    });
    each('dopen', i => openOrShow({ key: 'demo:' + demos[i].name, ref: { demo: demos[i] } }));
    each('dplay', i => { const d = demos[i]; playOnBit(x => x.demo === d || (x.studio && cart.name === d.name)); });
    each('dreset', async i => {
      const d = demos[i], key = 'demo:' + d.name;
      if (!await ask(`Reset ${d.name}?`, 'Your changes to it are thrown away and it goes back to the original.', 'Reset')) { showGames(); return; }
      try { await BKStore.drafts.del(key); } catch (e) { /* no drafts here */ }
      if (key === gid) { loadDemo(d); setChanged(false); applyCart(); saveLocal(); dirtySave = false; histReset(); if (!bit.on) { stop(true); bootScreen(); } }
      toast(`${d.name} is back to the original`);
      showGames();
    });
  }
  $('btnGames').onclick = showGames;
  // play a game from the Games menu: on the Bit, picked from its home screen
  async function playOnBit(match) {
    closeModal();
    await setMode('play', { start: false });
    if (bit.playing !== 'home') { suspendGame(); stop(true); await bootHome(); }
    if (!await homeReady()) return;
    if (embed.on) await childReady(5000);
    const i = bit.games.findIndex(match);
    if (i >= 0 && bit.playing === 'home') bitRequest(1, i + 1);
  }

  /* ------------------------------------------------------------ Edit and Play */
  // Edit: the editors, with a test screen that runs the game you are making (Run). Play: the screen is a Bit
  // (an emulated PocketBit: home screen, paused games), on its own or with a second Bit next to it. The two
  // Bits are linked like any two Bit windows, so a game started on one starts on both, a player each.
  let mode = 'edit';
  let playBits = lsGet('bitkit.playBits') === '2' ? 2 : 1;
  const waitFor = (test, ms) => new Promise(res => {
    const t0 = performance.now();
    (function tick() { if (test()) return res(true); if (performance.now() - t0 > ms) return res(false); setTimeout(tick, 60); })();
  });
  const homeReady = ms => waitFor(() => bit.on && bit.playing === 'home' && running && !bit.busy, ms || 5000);
  const childPeer = () => { try { return embed.api ? link.peers.get(embed.api.link.id) : null; } catch (e) { return null; } };
  const childReady = ms => waitFor(() => { const p = childPeer(); return !embed.on || !embed.frame || (p && (p.st === 'home' || p.st === 'idle')); }, ms || 8000);
  function setEmbed(on) {
    if (on === embed.on) return;
    if (!on && link.s) { linkSend({ t: 'end', sid: link.s.sid, why: 'went back to one Bit' }); linkLeave(false); }
    embed.on = on;
    $('bitCol2').hidden = !on;
    document.body.classList.toggle('two-bits', on);
    if (on) {
      if (running && playMode === '2' && !link.s) stop(true);
      const used = new Set(bitsSorted().map(b => b[1]));
      let n = 2;
      while (used.has(n)) n++;
      embed.num = n;
      const f = document.createElement('iframe');
      f.className = 'bit2-frame'; f.title = 'Bit ' + n; f.tabIndex = -1;
      f.src = location.pathname + '?bit=' + n + '&embed=1';
      const note = $('bit2Note');
      note.hidden = false; note.textContent = `Starting Bit ${n}…`;
      if (location.protocol === 'file:') {             // pages opened from a file cannot see each other
        note.innerHTML = 'Two Bits side by side need the studio from a web address. Opened as a file on your computer, the Bits cannot find each other.<br><br><a href="https://dvrkstvr.github.io/bitkit/" target="_blank" rel="noopener">Open the online studio</a>';
        embed.frame = null; embed.api = null; buildPickers(); linkUI();
        return;
      }
      $('gameWrap2').appendChild(f);
      embed.frame = f; embed.api = null;
      const t0 = performance.now();
      (function wait() {
        if (embed.frame !== f) return;
        let api = null;
        try { api = f.contentWindow.bkStudio; } catch (e) { /* not reachable */ }
        if (api && api.embedReady) { embed.api = api; note.hidden = true; linkUI(); return; }
        if (performance.now() - t0 > 12000) { note.innerHTML = 'A second Bit could not start here. Open the studio in its own browser tab to play on two Bits: <a href="https://dvrkstvr.github.io/bitkit/" target="_blank" rel="noopener">dvrkstvr.github.io/bitkit</a>'; return; }
        setTimeout(wait, 100);
      })();
    } else {
      try { if (embed.api) embed.api.bye(); } catch (e) { /* already gone */ }
      if (embed.frame) embed.frame.remove();
      embed.frame = null; embed.api = null;
    }
    buildPickers(); linkUI();
  }
  // start the game from the editor on the Bit (and on the Bit next to it)
  async function playStart(fresh) {
    if (bit.playing !== 'home') { if (link.s) { linkSend({ t: 'end', sid: link.s.sid, why: 'restarted the game' }); linkLeave(false); } else { if (!fresh) suspendGame(); stop(true); await bootHome(); } }
    if (!await homeReady()) return;
    if (embed.on && !await childReady()) toast('Bit 2 is not ready yet, starting on Bit 1');
    if (mode !== 'play' || bit.playing !== 'home') return;
    bit.sel = 1;
    if (fresh) bitRestart(1); else bitRequest(1, 1);
    if (embed.on && embed.api && isNetGame(getCode())) { try { embed.api.playData(serialize()); } catch (e) { /* the frame is gone */ } }   // these meet in the game's own lobby
  }
  async function setMode(m, opt) {
    opt = opt || {};
    if (IS_BIT2) return;
    mode = m; lsSet('bitkit.mode', m);
    document.body.classList.toggle('mode-play', m === 'play');
    document.body.classList.toggle('mode-edit', m === 'edit');
    $('modeEdit').classList.toggle('active', m === 'edit'); $('modePlay').classList.toggle('active', m === 'play');
    $('playOne').classList.toggle('active', playBits === 1); $('playTwo').classList.toggle('active', playBits === 2);
    if (m === 'play') {
      syncLevel(); saveLocal(); dirtySave = false;
      setEmbed(playBits === 2);
      if (!bit.on) setBitPower(true);
      buildPickers(); linkUI(); screen.focus();
      if (opt.start !== false) await playStart(false);
    } else {
      setEmbed(false);
      if (bit.on) setBitPower(false); else if (!running) bootScreen();
      buildPickers(); linkUI();
      showTab(activeTab);
    }
  }
  function setBits(n) {
    playBits = n; lsSet('bitkit.playBits', String(n));
    $('playOne').classList.toggle('active', n === 1); $('playTwo').classList.toggle('active', n === 2);
    if (mode !== 'play') return setMode('play');
    const had = link.s || (running && bit.playing !== 'home');
    setEmbed(n === 2);
    screen.focus();
    return had || n === 2 ? playStart(false) : null;
  }
  $('modeEdit').onclick = () => { if (mode !== 'edit') setMode('edit'); };
  $('modePlay').onclick = () => { if (mode !== 'play') setMode('play'); };
  $('playOne').onclick = () => setBits(1);
  $('playTwo').onclick = () => setBits(2);
  $('playRestart').onclick = () => { screen.focus(); playStart(true); };
  $('playHome').onclick = () => { screen.focus(); if (bit.playing !== 'home') forceCombo = 4; };
  $('stage').addEventListener('mousedown', e => { if (!/SELECT|INPUT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); screen.focus(); } });

  // what each screen is showing, in words, above it
  function screenText() {
    const s = link.s, me = `Bit ${link.num}`;
    if (mode === 'edit' && !IS_BIT2) {
      if (running && playingEditor) return `Test screen · running ${cart.name}` + (s ? `, with ${s.np - 1} more Bit${s.np > 2 ? 's' : ''}` : '');
      return `Test screen · press Run to try ${cart.name}`;
    }
    if (s) return `${me} · ${s.name} · player ${s.slot} of ${s.np}`;
    if (bit.playing === 'home') return `${me} · home screen: pick a game, A plays it`;
    if (running) return `${me} · ${bit.playing === 'studio' ? cart.name : (bit.cur && bit.cur.name) || (lastPlayed && lastPlayed.c.name) || 'a game'}`;
    return `${me} · stopped`;
  }
  let labelSeen = '';
  function updateLabels() {
    let two = '';
    if (embed.on) { try { two = embed.api ? embed.api.label() : `Bit ${embed.num} · starting…`; } catch (e) { two = ''; } }
    const one = screenText(), sig = one + '|' + two + '|' + running;
    if (sig === labelSeen) return;
    labelSeen = sig;
    $('screenLabel').textContent = one; $('screenLabel2').textContent = two;
    $('bitCol1').classList.toggle('live', running);
    $('playHint').textContent = embed.on ? 'Two linked Bits: a game started on one starts on both, one player each.' : '';
  }

  /* ------------------------------------------------------------ undo and redo, on every tab */
  // Sprites and map tiles keep their own history (see makeHistory). Entities, effects, cutscenes, placed
  // entities and race tracks share one: a snapshot is taken shortly after each change.
  const hist = { undo: [], redo: [], last: null, t: 0, levels: 0 };
  function docSnap() {
    syncLevel();
    return JSON.stringify({ e: Object.assign({}, cart.entities, { placed: undefined }),
      lv: cart.levels.map(L => ({ name: L.name, w: L.w, h: L.h, placed: L.placed, track: L.track || null, height: L.height ? b64(L.height) : null })) });
  }
  function histReset() { clearTimeout(hist.t); hist.t = 0; hist.undo.length = 0; hist.redo.length = 0; hist.last = docSnap(); hist.levels = cart.levels.length; }
  function histCheck() {
    clearTimeout(hist.t); hist.t = 0;
    if (cart.levels.length !== hist.levels) return histReset();   // a level was added or removed: start over
    const cur = docSnap();
    if (cur === hist.last) return;
    if (hist.last !== null) { hist.undo.push(hist.last); if (hist.undo.length > 80) hist.undo.shift(); }
    hist.redo.length = 0; hist.last = cur;
  }
  onDirty = () => { if (activeTab !== 'code') { clearTimeout(hist.t); hist.t = setTimeout(histCheck, 400); } };
  function docApply(str) {
    const o = JSON.parse(str);
    if (o.lv.length !== cart.levels.length) return false;
    cart.entities = Object.assign(o.e, { placed: [] });
    o.lv.forEach((l, i) => {
      const L = cart.levels[i], before = JSON.stringify(L.track || null);
      L.name = l.name; L.w = l.w; L.h = l.h; L.placed = l.placed;
      if (l.track) L.track = l.track; else delete L.track;
      if (l.height) L.height = unb64(l.height); else delete L.height;
      if (l.track && JSON.stringify(l.track) !== before) BKTracks.paint(L.map, L.track);
    });
    bindLevel(cart.level);
    mapDirtyRT = true; dirtySave = true; if (!cartChanged) setChanged(true);
    hist.last = docSnap();
    showTab(activeTab);
    return true;
  }
  function docStep(from, to, word) {
    histCheck();
    if (!from.length) return toast(`Nothing to ${word}`);
    to.push(hist.last);
    if (!docApply(from.pop())) { histReset(); return toast(`Nothing to ${word}`); }
  }
  // Undo / Redo act on whatever the open tab edits
  function undoHere(redo) {
    if (activeTab === 'code') { if (cm) (redo ? cm.redo() : cm.undo()); return; }
    if (activeTab === 'sprites') return redo ? tileHist.redo() : tileHist.pop();
    if (activeTab === 'map' && mp.layer === 'tiles') return redo ? mapHist.redo() : mapHist.pop();
    if (redo) docStep(hist.redo, hist.undo, 'redo'); else docStep(hist.undo, hist.redo, 'undo');
  }
  // behaviour steps explain themselves, unless that is switched off
  $('entExplain').checked = lsGet('bitkit.explain') !== '0';
  document.body.classList.toggle('bt-no-help', !$('entExplain').checked);
  $('entExplain').onchange = e => { lsSet('bitkit.explain', e.target.checked ? '1' : '0'); document.body.classList.toggle('bt-no-help', !e.target.checked); };
  $('undoBtn').onclick = () => undoHere(false);
  $('redoBtn').onclick = () => undoHere(true);

  /* ------------------------------------------------------------ game rules (GAME_RULES.md, studio/rules.js) */
  const RULES_URL = 'https://github.com/Dvrkstvr/bitkit/blob/main/GAME_RULES.md';
  let rulesSeen = null;
  function updateRulesBadge() {
    if (!window.BKRules) return;
    const code = getCode();
    if (code === rulesSeen) return;
    rulesSeen = code;
    const r = BKRules.check({ code }), ok = r.filter(x => x.ok).length;
    // quiet while everything is there, and it speaks up when something is missing
    $('btnRules').textContent = ok === r.length ? '✓ Checklist' : `Checklist ${ok}/${r.length}`;
    $('btnRules').classList.toggle('rules-ok', ok === r.length);
    $('btnRules').classList.toggle('rules-todo', ok !== r.length);
  }
  setInterval(updateRulesBadge, 1500);
  $('btnRules').onclick = () => {
    const r = BKRules.check({ code: getCode() });
    const rows = r.map(x => `<li class="${x.ok ? 'ok' : 'todo'}"><b>${x.ok ? '✓' : '○'} ${escapeHtml(x.name)}</b><br><span class="dim">${escapeHtml(x.about)}</span></li>`).join('');
    modal('Game checklist', `<p>Every BitKit game, built-in or from the community, has these. <code>game{}</code> gives you most of them in one call (see the Help tab).</p>
      <ul class="rules-list">${rows}</ul>
      <p class="dim small">This is a quick look at your code. Play it through once to be sure. <a href="${RULES_URL}" target="_blank" rel="noopener">Read the rules</a></p>`, [['Close', closeModal, 'primary']]);
  };
  BKStore.init().then(showCartFile, () => {});

  /* ------------------------------------------------------------ ROMs for the emulator apps (Game Boy, Game Boy Color, NES) */
  const romPick = document.createElement('input');
  romPick.type = 'file'; romPick.multiple = true; romPick.accept = '.gb,.gbc,.cgb,.nes'; romPick.hidden = true;
  document.body.appendChild(romPick);
  async function addRoms(files, reopen) {
    const { added, skipped } = await BKRoms.add([...files]);
    if (added.length) toast(added.length === 1 ? `Added ${added[0]}` : `Added ${added.length} games`);
    if (skipped.length) log(`Not a Game Boy, Game Boy Color or NES ROM (or too big): ${skipped.join(', ')}`, 'err');
    if (reopen) showRoms();
  }
  romPick.onchange = () => { if (romPick.files.length) addRoms(romPick.files, !modalEl.hidden); romPick.value = ''; };
  function showRoms() {
    const mine = BKRoms.all.filter(r => !r.test);
    const KIND = { gb: 'Game Boy', gbc: 'Game Boy Color', nes: 'NES' };
    const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
    const rows = mine.map((r, i) => `<div class="lib-row"><div class="grow"><b>${escapeHtml(r.name)}</b>
      <div class="dim small">${KIND[r.kind]} · ${size(r.size)}${r.save ? ' · battery save' : ''}${Object.keys(r.states).length ? ` · ${Object.keys(r.states).length} save state${Object.keys(r.states).length > 1 ? 's' : ''}` : ''}</div></div>
      <button class="tiny danger" data-romdel="${i}" title="Remove the game, its battery save and its save states from this browser">Delete</button></div>`).join('');
    modal('ROMs', `<div class="games">
      <div class="games-head"><b>Games for the emulators</b><span class="grow"></span><button id="romAdd" class="tiny primary">＋ Add ROM files…</button></div>
      <div class="lib-list">${rows || '<p class="dim">None yet. Add .gb, .gbc or .nes files, or drop them on the Bit\'s screen.</p>'}</div>
      <p class="dim small">They are played by the Game Boy, Game Boy Color and NES apps on the Bit's home screen (press Down for the Utilities row).
        They stay in this browser with their battery saves and save states. On a PocketBit, put them in <b>/roms</b> on the SD card.
        Only use games you own; BitKit brings just its own test cards.</p></div>`,
      [['Close', closeModal, 'primary']], 'wide');
    $('romAdd').onclick = () => romPick.click();
    document.querySelectorAll('#modal [data-romdel]').forEach(b => b.onclick = async () => {
      const r = mine[+b.dataset.romdel];
      if (!await ask(`Delete ${r.name}?`, 'The game, its battery save and its save states are removed from this browser.', 'Delete')) { showRoms(); return; }
      await BKRoms.remove(r.file); showRoms();
    });
  }
  $('btnRoms').onclick = () => { BKRoms.refresh().then(showRoms, showRoms); };
  // drop ROM files on the Bit's screen
  const dropOn = $('gameWrap');
  dropOn.addEventListener('dragover', e => { if ([...(e.dataTransfer.items || [])].some(it => it.kind === 'file')) { e.preventDefault(); dropOn.classList.add('drop'); } });
  dropOn.addEventListener('dragleave', () => dropOn.classList.remove('drop'));
  dropOn.addEventListener('drop', e => {
    dropOn.classList.remove('drop');
    const files = [...(e.dataTransfer.files || [])].filter(f => BKRoms.kindOf(f.name));
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation();
    addRoms(files, false);
  });

  /* in-page dialogs (native confirm() is unavailable in some embeds) */
  const modalEl = $('modal');
  let modalResolve = null;
  function modal(title, html, buttons, cls) {
    modalEl.querySelector('.m-box').className = 'm-box' + (cls ? ' ' + cls : '');
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
    ['Game shell: menus every game has (GAME_RULES.md)', [
      ['game{title=, goal=, help=, continue=, ...}', 'Call in _init. Adds the title screen (New game, or Continue once the game has a save file; Settings with Delete save; How to play), the pause menu on Start (Resume, Settings, Quit to title) and volume settings. Fields: title, goal, help (list of lines), continue(cp), new_game(), can_continue(), pause ({{"name", fn}}), menu (extra title items, {{"Levels", fn}}), settings ({{key=, name=, min=, max=, value=} or {key=, name=, values={...}}}), music, title_draw, look.'],
      ['game{title_draw = fn, look = {...}}', 'Your own title screen: fn(t) is called every frame on the title screen instead of _draw (t counts frames, so it can move), and the name, goal and menu go on top. look colours every menu: title, shadow, panel, edge, text, pick, hi, goal, footer; and places the title screen: name_y (false hides the name), scale, goal_y, menu ("center", "left", "right"), menu_y. Every built-in game has one.'],
      ['checkpoint(t)', 'Remember where to carry on: Continue on the title screen calls continue(t). checkpoint(nil) forgets it.'],
      ['game_win(text)', 'The goal is reached: shows the "goal complete" screen (after any cutscene ends) and puts a star on the title screen.'],
      ['setting(key)', 'A value from the Settings screen. "volume" and "music" are 0..10; volume already scales sfx() and tone().'],
      ['mus(note, ...)', 'sfx() for music: also turned down by the Music level (game{music=true}).'],
      ['game_play()', 'Skip the menus and go straight to gameplay.'],
      ['game_screen()', 'Your own menu screen (a level select, a shop): _update and _draw run, the shell draws nothing and Start does nothing. Leave with game_play() or game_title(). Sprout Hop\'s Levels screen uses it.'],
      ['game_title()', 'Back to the title screen.'],
      ['GAME.state', '"title", "play", "screen", "pause", "settings", "help", "confirm" or "won".']]],
    ['Game tab: numbers to play with', [
      ['tune(name, default, [min, max, step])', 'A number the Game tab shows as a slider: SPEED = tune("Speed", 2, 1, 6). Returns the value picked there, or the default. The picked values are saved with the game. A name like "Items/Speed" is listed under an Items heading.'],
      ['tune(name, true)', 'A switch on the Game tab. Returns true or false.'],
      ['tune(name, "b", {"a", "b"})', 'A list on the Game tab. Returns the picked text.']]],
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
      ['fget(n,[bit]) / fset(n,bit,on)', 'Tile behaviours (sprite flags). Name them on the Sprites tab and ask by name: fget(mget(x, y), "water"). Numbers 0-7 work too; FLAGS holds the names.'],
      ['camera([x,y])', 'Offset all drawing. camera() resets it (use for the HUD).'],
      ['clip([x,y,w,h])', 'Only draw inside this rectangle. clip() resets.'],
      ['pal([c0,c1])', 'Draw colour c0 as c1. pal() resets.'],
      ['palt([c,on])', 'Make colour c transparent for sprites and maps. palt() resets (only 0 is transparent).'],
      ['palette(i,[r,g,b])', 'Read or change palette colour i (0-255 each).'],
      ['shade([amount])', 'Darken everything drawn so far: 0 changes nothing, 1 is black (default 0.5). Good behind a menu or for night. Only inside clip().']]],
    ['Shaders: effects on what you have drawn', [
      ['How they work', 'Screen-space shaders. Call these in _draw after drawing the world and before the HUD: each one changes what is on the screen so far, inside clip(). They are cheap enough for the device at 60 fps. Colour shaders snap to the palette, so add colours to the palette for smoother blends.'],
      ['tint(c, [amount])', 'Blend everything toward palette colour c: 0 changes nothing, 1 is all c (default 0.5). A red flash when hurt, a blue underwater cast, an orange sunset.'],
      ['fog(c, y0, y1, [a0], [a1])', 'Tint that changes down the screen: amount a0 (default 1) at row y0 sliding to a1 (default 0) at row y1. Rows outside y0..y1 are untouched. Haze on a 2.5D horizon, deep water getting darker.'],
      ['dither(c, [amount])', 'Retro dissolve: a checker pattern of colour c covers amount of the screen (0.5 is every other pixel). For fades, wipes and fog with no new colours.'],
      ['remap({[from] = to, ...})', 'Swap colours on screen after drawing: remap({[27] = 8}) turns every yellow pixel red. Also remap(from, to, from2, to2, ...). For flashes and palette cycling.'],
      ['wave(amp, [len], [speed], [vertical])', 'Each row slides sideways on a sine wave: amp pixels, a wave every len rows (default 32), speed waves per second (default 1). vertical = true moves columns up and down. Heat haze, underwater, dreams.'],
      ['ripple(x, y, r, [amp], [width])', 'A shockwave ring of radius r around x, y (the camera applies), pushing pixels out by amp (default 4) across a band width pixels wide (default 10). Grow r each frame for an explosion or a sonar ping.'],
      ['pixelate(size)', 'Mosaic blocks of size x size pixels. Grow it and shrink it for a screen transition.'],
      ['glitch([amount], [seed])', 'Torn rows and colour slips (amount 0..1). It picks the pattern from seed (default: the frame), never from rnd(), so linked games stay in step.'],
      ['raster(fn)', 'Write your own scanline shader: fn(y) is called for every row on screen (inside clip()) and returns dx to slide the row sideways, and optionally c, amount to tint it. raster(function(y) return math.sin(y / 9 + t() / 10) * 3 end) is a heat haze; return 0, 1, y / 240 for a fade to dark. At most 240 calls a frame, so it is cheap on the device.'],
      ['display(look)', 'A screen look for the whole game, in full colour: "crt", "arcade", "old tv", "handheld", "sepia", "night", "vivid" or "off". It stays on until changed and costs the game nothing (it is applied while the frame goes to the screen). display() turns it off.'],
      ['display{...}', 'Build your own look: display{scanlines = 0.4, vignette = 0.3, curve = 0.2, split = 1, blur = 0.3, grain = 0.1, bright = 0, contrast = 0.1, saturation = -0.5, warm = 0.3}. All 0..1 except split (pixels, 0-4) and bright, contrast, saturation, warm (-1..1). look = "crt" starts from a look. The Game tab has sliders for it too.']]],
    ['Sprite shaders: shaded sprites', [
      ['sprfx{...}', 'Like pal(): every spr() and sspr() after it is drawn through these until sprfx() turns them off. Mix any of them: sprfx{outline = 1, light = 0.6}. They work in sprite pixels, so a big sprite costs no more than a small one.'],
      ['outline = c', 'A 1 pixel outline in colour c around the sprite (it grows with the scale).'],
      ['flash = c, flash_amount = 0..1', 'Blend the sprite toward colour c (amount defaults to 1). A white hit flash, a red "burning" tint.'],
      ['light = 0..1, light_x, light_y', 'Shades the sprite as if lit: a bright rim on the side facing the light and shade on the far side, from the sprite\'s own shape. light_x, light_y is the direction the light comes from (default -1, -1: top left).'],
      ['light_at = {x, y}', 'Light from a point in the world instead (a torch, a lamp): each sprite is lit from its own side of it.'],
      ['dissolve = 0..1', 'Dither the sprite away: for spawning, dying and teleporting.'],
      ['silhouette = c', 'Every pixel in colour c: a shadow figure, a "who\'s that" reveal, a player behind a wall.'],
      ['shadow = c, shadow_x, shadow_y', 'A drop shadow in colour c, offset by shadow_x, shadow_y sprite pixels (default 1, 1).'],
      ['shader = function(x, y, c, w, h) ... end', 'Your own sprite shader: called for every pixel of the sprite (x, y inside it, w x h its size) with its colour c (nil where it is see-through). Return a colour, or nil to leave the pixel out. Runs before the others.']]],
    ['2.5D (perspective floor)', [
      ['floor(x,y,angle,height,horizon,[focal],[outside],[step])', 'Draw the map as a floor seen in perspective, like a classic kart racer. x,y = camera position in world pixels, angle in radians (0 looks toward +x, turning toward +y), height = camera height in pixels, horizon = screen row of the horizon. focal (default 160) is the zoom. outside = colour past the map edge and far away (-1 leaves those pixels alone, so draw the sky first). step 2 draws every other column (faster on the device). Fills the rows below the horizon inside clip().'],
      ['project(x,y,[z])', 'Where world point x,y (z = height above the floor) lands on screen with the last floor() or floorh() camera. Returns sx, sy, scale (screen pixels per world pixel) and dist (how far away it is), or nil if it is behind the camera. Draw far things first.'],
      ['hset(cx,cy,h) / hget(x,y)', 'Hills: hset sets the height (0-255 pixels) of a tile corner (cx 0-256, cy 0-128). hget gives the smooth height at any world pixel, for putting karts and sprites on the ground. Heights reset to 0 when a cart starts.'],
      ['floorh(x,y,angle,camz,horizon,[focal],[outside],[step])', 'Like floor() but with the hills from hset(). camz is the camera height above 0, so add the ground height under the camera. Near hills hide far ones.'],
      ['depth([dist])', 'After floorh(): sspr() hides the pixels of a sprite that are behind a hill nearer than dist (use the dist from project()). depth() turns it off.'],
      ['sspr(n,x,y,[w,h],[scale],[flipx],[flipy])', 'Like spr but at any scale, including fractions (0.5 is half size). Use it with project() for karts, trees and other billboards.']]],
    ['Input', [
      ['btn(b)', 'True while the button is held. b is "left","right","up","down","a","b","x","y","l","r","start","select" or 0-11.'],
      ['btnp(b)', 'True on the frame the button goes down, then repeats while held.'],
      ['btnr(b)', 'True on the frame the button is released.'],
      ['press(b)', 'How hard the button is pressed, 0-255. Analog triggers (L/R) give the full range. On PocketBit L/R (and later ABXY) are Hall-effect sensors.']]],
    ['Sound (8 channels, stereo)', [
      ['sfx(note,[wave],[vol],[frames],[ch],[pan],[slide])', 'Play a note like "C4", "F#5" or a MIDI number. wave: 0 square, 1 triangle, 2 saw, 3 noise, 4 sine, 5 thin pulse. vol 0-1, frames = length (60 per second), pan -1..1, slide in Hz per second. Picks a free channel if ch is nil.'],
      ['tone(hz,...)', 'Like sfx but with a frequency in Hz.'],
      ['stop([ch])', 'Silence one channel or all.'],
      ['voice(ch, hz, vol, [wave], [pan])', 'A held note with no decay of its own (the music player uses it). Calling it again changes pitch, volume and pan smoothly; vol 0 ends it.']]],
    ['Music (made on the Tracker and Loops tabs)', [
      ['music(n, [opts])', 'Play song n from the Tracker/Loops tabs (or music("name")). It loops back to the song\'s loop point. opts: {loop=false} plays it once, {pos=, row=} starts somewhere, {pat=p} loops one pattern.'],
      ['music_stop([frames])', 'Stop the music, or fade it out over that many frames.'],
      ['music_pos()', 'Where the song is: order position (from 1) and row (from 0), or nil.'],
      ['music_playing()', 'The song that is playing (a table), or nil.'],
      ['music_note(n, inst, note, [frames])', 'Play one note with song n\'s instrument inst (from 1): jingles and menu sounds that match the music.'],
      ['SONGS', 'The game\'s songs. Music uses the top channels (a 4-channel song uses 7, 6, 5 and 4), so sfx() keeps the others. The Music and Volume settings turn it down.']]],
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
      ['cutscene_skip()', 'Jump to the end of the playing cutscene, like START. Call it from on("cutscene", fn) to skip cutscenes (Sprout Hop does on replays).'],
      ['cutscenes_reset()', 'Forget which cutscenes have played, so level intros and once-only cutscenes play again.'],
      ['on("cutscene_end", fn)', 'Called with the name when a cutscene finishes or is skipped. on("cutscene", fn) is called when one starts.'],
      ['Trigger zones', 'An invisible entity with the "Play cutscene" step. "Place a trigger zone" on the Cutscenes tab makes one for you. Level intros play when their level starts.'],
      ['Needs', 'ents_update() in _update (it runs the cutscene) and ents_camera() if the camera should pan. The dialog box, bars and fades are drawn for you on top of _draw. START skips.']]],
    ['Multiplayer', [
      ['2 players on this screen', 'Pick it in the list under the game screen: both play on one screen. Player 2 uses the second controller, or I J K L to move, N = A, M = B, H = X, U = Y, Y = L, O = R. The keys are shown under the screen.'],
      ['Linked Bits', 'Play (at the top) with "2 Bits side by side" shows two Bits next to each other, each with its own screen and controls. "+ Bit in a new window" opens more. Bits link by themselves like PocketBits over ESP-NOW and the home screen shows them. A game started on one Bit starts on every Bit on its home screen (up to 8 players), each with its own camera. Start+Select (or home()) on any Bit takes all of them home, paused; picking the game again carries on together. A Bit that reloads gets its seat back.'],
      ['btn(b, [p]) / btnp / btnr / press', 'The last argument picks the player (1-8, default 1). Player entities read their own player\'s buttons by themselves.'],
      ['PLAYERS / ME', 'How many play, and which player this screen belongs to (0 when everyone shares this screen). Use ME only for what you draw, never for game logic, or linked Bits drift apart.'],
      ['ents_players()', 'The player entities, player 1 first. PLAYER is player 1. Extra players start next to player 1 as copies of its entity; e.pnum is the player number.'],
      ['ents_player_pal(n, {from = to})', 'Recolour player n\'s sprite. Players 2-8 get their own leaf colours by default.'],
      ['Lockstep rules', 'Linked games run the same frames with the same buttons on every Bit, so the game must be deterministic: use rnd() and t(), not clock(), and avoid pairs() order in game logic. Enemies chase the nearest player; cutscenes listen to every player.']]],
    ['Network events (10-20 Bits)', [
      ['Why', 'Lockstep only works for a few Bits. Bigger games (Sweep Storm has up to 20) send small events instead, like "player 7 dug cell 40,12". Each Bit runs its own player and keeps the shared world up to date from what the others send. On PocketBit they go out as ESP-NOW broadcasts; in the studio every window running the same cart hears them.'],
      ['net_send(v1, ..., v8)', 'Broadcast up to 8 whole numbers to every other Bit running this cart. Returns false after 16 events in one frame. Keep it to a few events a second per Bit.'],
      ['net_recv()', 'The next event from another Bit as from, v1, v2, ... or nil when none is waiting. Read them in a loop every frame: while true do local from, a, b = net_recv() if not from then break end ... end'],
      ['NET_ID', 'This Bit\'s network id (from its radio\'s address on PocketBit). 0 when there is no network, for example in a lockstep-linked game.'],
      ['Rules of thumb', 'Events can arrive late, and Bits are not frame-synced, so every piece of state has one owner that sends it (your digger, your score). Things everyone can work out the same way, like a map from a shared seed, need only the seed. A good start: a lobby where Bits say hello, then one Bit sends the seed and who is playing.']]],
    ['Save data and clock', [
      ['save(t)', 'Keep a table (numbers, strings, booleans, nested tables; up to 4 KB) for the next time the cart runs. save(nil) deletes it. The studio keeps it per cart name in this browser; PocketBit keeps it in flash.'],
      ['saved()', 'The table from the last save(), or nil if there is none.'],
      ['clock()', 'Real time in unix seconds (the RTC on PocketBit). Use it for idle games and offline progress. It is not deterministic, so keep it out of multiplayer game logic.']]],
    ['The Bit (emulated PocketBit)', [
      ['Play (at the top)', 'Switches from editing to the emulated PocketBit: a home screen with the game you are editing and every game on its memory card. D-pad chooses, A plays, Y opens a game in the studio. Edit takes you back to the editors.'],
      ['Start + Select', 'Hold both in a game to go back to the home screen, like on the device.'],
      ['Paused games', 'Hold Start+Select (or call home()) to go back to the home screen: the game is paused, not closed. Pick it again and it carries on where you were, even after a reload. X on the home screen starts a paused game over. Changing a game\'s code or art starts it fresh.'],
      ['Memory card (Games menu)', 'The Bit\'s memory card: a folder on your computer (Chrome/Edge) or this browser. Save puts a game on it, then play or open it from the Games menu or the home screen. Ctrl+S saves the open game back to its file.'],
      ['launch(n, [edit]) / home()', 'System calls used by the home screen: start game n, or return home. A game can call home() from its own menu.']]],
    ['Share hub', [
      ['🌍 Share hub (at the top)', 'Share the open game by link or QR code, post it to the hub with photos and clips, and play what other people made.'],
      ['Photo: 📷, F8, or Select + L', 'A photo of the screen (PNG). On the Bit and on the PocketBit: hold Select and press L. It goes on the memory card in captures/.'],
      ['Clip: ⏺, F9, or Select + R', 'Starts recording a clip (GIF, 30 fps, up to 60 s); press again to stop. On the PocketBit it is written to the SD card while you play.'],
      ['Play link', 'The whole game packed into a link. Opening it plays the game, no server needed. Small games also fit a QR code; hub posts have a short link that always fits.'],
      ['Post to the hub', 'Opens a short GitHub form filled in for you (a free account is needed). Drag your photos and clips into it. It shows in the hub after a quick look.']]],
    ['Time and randomness', [
      ['t()', 'Frames since the cart started (60 per second).'],
      ['time()', 'Seconds since the cart started.'],
      ['rnd() / rnd(n) / rnd(a,b)', 'Random float 0-1, integer 1..n, or integer a..b. Deterministic: the same seed gives the same game, which multiplayer relies on.'],
      ['srand(seed)', 'Set the random seed. math.random uses the same generator.']]],
    ['Studio keys', [
      ['Ctrl+Enter', 'Run the game (works anywhere).'],
      ['Ctrl+S', 'Save to this browser (it also saves by itself). Use Save to keep a file.'],
      ['F8 / F9', 'Take a photo / start or stop a clip of the game screen.'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo and redo, on every tab.'],
      ['Code: Ctrl+Space', 'Complete the word you are typing. The line under the code says what a function does and what it needs.'],
      ['Code: Ctrl+F', 'Find in the code. Enter jumps to the next match, Ctrl+Shift+F replaces.'],
      ['Code: Ctrl+/', 'Comment or uncomment lines.'],
      ['Sprites: P / F / I', 'Pen, fill, pick colour.'],
      ['Map: P / E / R / F / I', 'Paint, eraser, box, fill, pick tile. WASD or the arrows move the view (Shift = faster), scrolling zooms.'],
      ['Keyboard as controller', 'Arrows, Z=A, X=B, A=X, S=Y, Q=L, W=R, Enter=Start, Shift=Select. Click the game screen first.']]]
  ];
  // Help: getting started first, then everything the code can call. The search box filters both.
  const FIRST_STEPS = [
    ['Pick a game', 'The <b>Games</b> menu at the top has the built-in games and your own. Open one to look inside, or start a new one. Each game keeps its own changes.', 'Open the Games menu', () => showGames()],
    ['Press Run', '<b>▶ Run</b> (or Ctrl+Enter) plays it on the left. Click the game screen, then use the arrow keys and Z / X. A controller works as soon as you press a button on it.', 'Run it', () => run()],
    ['Change something', 'The <b>Game</b> tab has sliders for how the game feels. <b>Sprites</b> is for drawing, <b>Map</b> for building levels, <b>Code</b> for everything else. Undo works on every tab.', 'Show the Game tab', () => showTab('game')],
    ['Play it like on the device', '<b>Play</b> at the top shows the game on a Bit, the emulated PocketBit, with its home screen. Pick <b>2 Bits side by side</b> to try a game that is played together.', 'Switch to Play', () => setMode('play')],
    ['Keep it', 'The studio saves as you go, in this browser. <b>Save</b> puts the game on the memory card or gives you a file.', null, null],
    ['Share it', '<b>🌍 Share hub</b> gives you a link and QR code that play your game anywhere, takes photos and clips, and posts them to the hub.', 'Open the Share hub', () => BKShare.open('share')],
    ['Finish it', 'The <b>Checklist</b> at the top says what every BitKit game needs, like a title screen and a goal.', null, null],
  ];
  $('helpBody').innerHTML = `<input id="helpSearch" class="help-search" type="search" placeholder="Search the help: try spr, jump, save, controller..." spellcheck="false">
    <div id="helpStart"><h2>Getting started</h2><ol class="start-list">${FIRST_STEPS.map(([h, t, b], i) => `<li><b>${h}</b><span>${t}</span>${b ? `<button class="tiny" data-start="${i}">${b}</button>` : ''}</li>`).join('')}</ol></div>
    <h2 id="helpApiHead">Everything your code can use</h2><p class="dim" id="helpApiIntro">Lua 5.4. The same runtime (C, compiled to WebAssembly here) runs on the PocketBit handheld. Carts are deterministic: no clock, no file access, seeded random.</p>` +
    HELP.map(([h, rowsH]) => `<div class="help-sec"><h3>${h}</h3><table>${rowsH.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join('')}</table></div>`).join('') +
    '<p id="helpNone" class="dim" hidden>Nothing found. Try a shorter word.</p>';
  $('helpBody').querySelectorAll('[data-start]').forEach(b => { b.onclick = () => FIRST_STEPS[+b.dataset.start][3](); });
  $('helpSearch').oninput = e => {
    const words = e.target.value.toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    $('helpStart').hidden = words.length > 0; $('helpApiIntro').hidden = words.length > 0; $('helpApiHead').hidden = words.length > 0;
    $('helpBody').querySelectorAll('.help-sec').forEach(sec => {
      const head = sec.querySelector('h3').textContent.toLowerCase();
      let shown = 0;
      sec.querySelectorAll('tr').forEach(tr => { const t = head + ' ' + tr.textContent.toLowerCase(), ok = words.every(w => t.includes(w)); tr.hidden = !ok; if (ok) shown++; });
      sec.hidden = !shown; if (shown) any = true;
    });
    $('helpNone').hidden = any;
  };

  /* ------------------------------------------------------------ start */
  try { localStorage.removeItem('bitkit.ai'); } catch (e) { /* storage unavailable */ }   // forget API keys the removed AI tab stored
  document.title = `${APP} Studio`;
  $('appName').textContent = APP;
  let restored = false;
  try { const s = lsGet(LS.cart); if (s) { deserialize(JSON.parse(s)); restored = true; } } catch (e) { log('Saved cart was unreadable, starting fresh', 'sys'); }
  if (!restored) { const d = DEMOS()[0]; cart.name = d.name; cart.code = d.code; d.buildGfx(cart); normalizeLevels(); setChanged(false); }
  if (!gid) {    // a cart from before games had ids
    const d = DEMOS().find(x => x.name === cart.name);
    setGid(cartFile ? 'file:' + cartFile : d ? 'demo:' + d.name : newGid());
    setChanged(restored && !(d && d.code === cart.code));
  }
  applyCart(); histReset();
  log(`${APP} Studio ready${window.BK_BUILD ? ` (build ${window.BK_BUILD})` : ''}. ${restored ? 'Restored your last cart.' : 'Loaded the demo cart.'} Press Run (Ctrl+Enter).`, 'sys');
  showTab(lsGet(LS.settings + '.tab') || 'code');
  linkOpen(); linkUI();          // link with the other Bit windows
  buildPickers();
  setInterval(updateLabels, 250);
  if (IS_BIT2) {                 // an extra Bit: just its screen, on its home screen
    document.body.classList.add('bit-only');
    if (EMBED) { document.body.classList.add('bit-embed'); settings.muted = true; }   // next to Bit 1 in the studio: that one makes the sound
    document.title = `${APP} · Bit ${BIT_NO}`;
    setBitPower(true);
    if (picks[0].k === 'auto' && !EMBED) openChooser();   // a new Bit window: ask which controller plays on it
  } else setMode(lsGet('bitkit.mode') === 'play' ? 'play' : 'edit', { start: false });   // Play carries on at the Bit's home screen
  // browsers only start sound after a click or key press: wake the audio up on the first one
  const wakeAudio = () => { if (actx && actx.state === 'suspended') actx.resume(); };
  window.addEventListener('pointerdown', wakeAudio);
  window.addEventListener('keydown', wakeAudio);
  requestAnimationFrame(frame);

  /* ------------------------------------------------------------ Share hub */
  BKShare.init({ modal, closeModal, ask, toast, serialize, fileName: cartFileName, storeLabel: () => BKStore.label(),
    async openCart(o, play) {
      decodeCart(o);
      if (!await openGame({ data: o })) return;
      if (play) await setMode('play');
    } });
  $('btnHub').onclick = () => BKShare.open();
  // a play link (#play=...) opens its game, and plays it. The game you had open is kept as a draft.
  async function openFromLink() {
    if (IS_BIT2) return;
    const hub = /#hub=(\d+)/.exec(location.hash);
    if (hub) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const it = await BKShare.hubItem(hub[1]);
        if (!it.cart) { BKShare.open('hub'); return; }
        const o = await BKShare.getCart(it);
        log(`Opened "${it.title}" by ${it.author} from the Share hub.`, 'sys');
        if (await openGame({ data: o })) await setMode('play');
      } catch (e) { log('That hub link did not work: ' + e.message, 'err'); toast('That hub link did not work'); }
      return;
    }
    if (!BKShare.findPlay(location.hash)) return;
    try {
      const o = await BKShare.cartFromLink(location.hash);
      history.replaceState(null, '', location.pathname + location.search);
      log(`Opened "${o.name}" from a play link.`, 'sys');
      if (await openGame({ data: o })) await setMode('play');
    } catch (e) { log('That play link did not work: ' + e.message, 'err'); toast('That play link did not work'); }
  }
  openFromLink();
  window.addEventListener('hashchange', openFromLink);
  if (/[?&]hub\b/.test(location.search) && !IS_BIT2) BKShare.open();

  // expose for tests / debugging
  window.bkStudio = { cart, run, stop, takePhoto, toggleClip, cap, serialize, input, input2, picks, link, RT, bitRequest, bootHome, ptrMap: () => ptr.map >> 1, isRunning: () => running, bit, setBitPower, showLibrary: showGames, showGames, saveToBit, BKStore,
    setMode, setBits, openGame, embed, mode: () => mode, gid: () => gid, label: screenText, showTab, undoHere,
    // for the studio window, when this Bit is the one shown next to it
    embedReady: true, extInput(m, p) { ext.mask = m; ext.press.set(p); }, bye() { linkSend({ t: 'bye' }); },
    playData(o) { try { stop(true); playCart(decodeCart(o), 'studio-copy'); } catch (e) { log(e.message, 'err'); } } };
})().catch(e => {
  document.body.innerHTML = `<pre style="color:#ff6b5e;padding:20px">Studio failed to start: ${e && e.stack || e}</pre>`;
});
