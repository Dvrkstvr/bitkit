/* BitKit Studio: entity maker (sprites, animations, behavior trees). MIT License. */
'use strict';
window.BKEntities = (function () {
  // Behavior tree node catalog. p: [key, kind, default, unit]
  const NODES = {
    selector: { g: 'Flow', label: 'Try each, first that works', kids: 'many', help: 'Runs children top to bottom and stops at the first one that succeeds.' },
    sequence: { g: 'Flow', label: 'Do in order', kids: 'many', help: 'Runs children top to bottom and stops at the first one that fails.' },
    invert: { g: 'Flow', label: 'Not', kids: 'one', help: 'Flips the result of its child.' },
    all: { g: 'Flow', label: 'Do all', kids: 'many', help: 'Runs every child every frame, whatever they return. Use it to move AND shoot.' },

    near: { g: 'Check', label: 'Player closer than', p: [['dist', 'num', 48, 'px']], help: 'Works while the player is closer than this.' },
    far: { g: 'Check', label: 'Player farther than', p: [['dist', 'num', 96, 'px']], help: 'Works while the player is this far away or further.' },
    sees: { g: 'Check', label: 'Sees player ahead within', p: [['dist', 'num', 96, 'px']], help: 'Works while the player is in front of it, at about the same height.' },
    player_above: { g: 'Check', label: 'Player is above, within', p: [['dist', 'num', 24, 'px sideways']], help: 'Works while the player is higher up and nearly straight above.' },
    on_ground: { g: 'Check', label: 'On the ground', help: 'Works while it stands on something solid.' },
    wall_ahead: { g: 'Check', label: 'Wall ahead', help: 'Works when a solid tile is right in front of it.' },
    ledge_ahead: { g: 'Check', label: 'Ledge ahead', help: 'Works when the ground ends right in front of it.' },
    chance: { g: 'Check', label: 'Random chance', p: [['pct', 'num', 2, '% per frame']], help: 'Works now and then: a dice roll every frame.' },
    every: { g: 'Check', label: 'Every', p: [['frames', 'num', 60, 'frames']], help: 'Works once every so many frames (60 frames are one second).' },
    hp_below: { g: 'Check', label: 'HP below', p: [['hp', 'num', 2, '']], help: 'Works while it has fewer hit points than this.' },
    touching: { g: 'Sense', label: 'Touching', p: [['what', 'what', 'player', '']], help: 'Works while it overlaps one of these.' },
    ray: { g: 'Sense', label: 'Ray hits', p: [['what', 'what', 'player', ''], ['dir', 'dir', 'ahead', '', 'towards'], ['len', 'num', 64, 'px', 'length']], help: 'Casts a line from the middle of the entity. Walls block it.' },
    circle: { g: 'Sense', label: 'Circle contains', p: [['what', 'what', 'player', ''], ['radius', 'num', 24, 'px', 'radius']], help: 'Works while one of these is inside a circle around it.' },
    got_hurt: { g: 'Sense', label: 'Just got hurt', help: 'Works for a moment right after it took damage.' },
    heard: { g: 'Sense', label: 'Heard event', p: [['event', 'text', 'open_door', '']], help: 'True on the frame after any entity or your code calls emit("name").' },
    button: { g: 'Check', label: 'Button', p: [['button', 'btn', 'b', ''], ['mode', 'mode', 'pressed', '', 'when']], help: 'Works when the player presses, holds or lets go of a button.' },
    has_effect: { g: 'Check', label: 'Has effect', p: [['effect', 'fx', '', '']], help: 'Works while this effect (Effects, at the top of the tab) is on it.' },
    count_below: { g: 'Check', label: 'Fewer than', p: [['count', 'num', 3, ''], ['type', 'ent', '', 'alive']], help: 'Works while fewer than this many of an entity are alive.' },
    count_up: { g: 'Check', label: 'Count up to', p: [['max', 'num', 300, 'frames'], ['key', 'text', 'grow', '', 'remember as'], ['bar', 'bool', true, 'show bar']], help: 'Adds 1 each frame it runs. Succeeds once the count is reached, and stays done.' },
    is: { g: 'Check', label: 'Memory is', p: [['key', 'text', 'state', ''], ['value', 'text', 'angry', '', '=']], help: 'Works when a value it remembered (with Remember) matches.' },

    controls: { g: 'Do', label: 'Player controls', p: [['speed', 'num', 1, 'px/frame', 'speed'], ['jump', 'num', 4.2, '', 'jump power'], ['run', 'run', 'r', '', 'run button'], ['sound', 'text', 'C5', '', 'jump sound']], help: 'D-pad moves, A jumps (with gravity) or up/down moves (without gravity).' },
    patrol: { g: 'Do', label: 'Patrol (turn at walls and ledges)', p: [['speed', 'num', 0.5, 'px/frame', 'speed']], help: 'Walks ahead and turns around at walls and ledges.' },
    wander: { g: 'Do', label: 'Wander', p: [['speed', 'num', 0.4, 'px/frame', 'speed'], ['turn', 'num', 10, 'in 1000', 'turn chance']], help: 'Walks ahead and turns around now and then.' },
    chase: { g: 'Do', label: 'Chase player', p: [['speed', 'num', 0.7, 'px/frame', 'speed']], help: 'Moves towards the player.' },
    flee: { g: 'Do', label: 'Run from player', p: [['speed', 'num', 0.7, 'px/frame', 'speed']], help: 'Moves away from the player.' },
    hover: { g: 'Do', label: 'Bob up and down', p: [['height', 'num', 8, 'px', 'height'], ['speed', 'num', 0.06, '', 'speed']], help: 'Floats gently up and down (for entities without gravity).' },
    jump: { g: 'Do', label: 'Jump', p: [['power', 'num', 3.5, '', 'power']], help: 'Jumps, if it stands on the ground.' },
    stop: { g: 'Do', label: 'Stand still', help: 'Stops moving.' },
    turn: { g: 'Do', label: 'Turn around', help: 'Faces the other way.' },
    face_player: { g: 'Do', label: 'Face the player', help: 'Turns to look at the player.' },
    wait: { g: 'Do', label: 'Wait', p: [['frames', 'num', 30, 'frames']], help: 'Pauses the steps below it for this long.' },
    anim: { g: 'Do', label: 'Play animation', p: [['name', 'anim', 'idle', '']], help: 'Shows one of its animations (Animations, above).' },
    say: { g: 'Do', label: 'Say', p: [['text', 'text', 'Hello!', '']], help: 'Shows a speech bubble while this step runs.' },
    sound: { g: 'Do', label: 'Play sound', p: [['note', 'text', 'C5', '', 'note'], ['wave', 'num', 0, '0 to 5', 'wave']], help: 'Plays a note, like C5 or A3.' },
    shoot: { g: 'Do', label: 'Shoot', p: [['type', 'ent', '', '', 'what'], ['speed', 'num', 1.5, 'px/frame', 'speed'], ['aim', 'bool', false, 'aim at player']], help: 'Fires another entity ahead of it, like a pebble or a seed.' },
    set: { g: 'Do', label: 'Remember', p: [['key', 'text', 'state', ''], ['value', 'text', 'angry', '', '=']], help: 'Stores a value under a name. Check it later with Memory is.' },
    emit: { g: 'Do', label: 'Send event', p: [['event', 'text', 'open_door', '']], help: 'Your code can listen with on("name", function(e) ... end).' },
    damage_touching: { g: 'Do', label: 'Damage what it touches', p: [['what', 'what', 'enemy', ''], ['amount', 'num', 1, 'hp', 'damage']], help: 'Hurts everything of this kind that it overlaps.' },
    set_tile: { g: 'Do', label: 'Change map tile', p: [['dx', 'num', 0, 'tiles', 'right'], ['dy', 'num', 1, 'tiles', 'down'], ['tile', 'num', 0, '', 'to tile']], help: 'Swaps a tile of the map near it, for doors and switches.' },
    spawn: { g: 'Do', label: 'Spawn', p: [['type', 'ent', '', ''], ['dx', 'num', 0, 'px', 'right'], ['dy', 'num', -16, 'px', 'down']], help: 'Creates another entity next to it.' },
    apply_effect: { g: 'Do', label: 'Apply effect to self', p: [['effect', 'fx', '', '']], help: 'Puts an effect on itself.' },
    apply_touching: { g: 'Do', label: 'Apply effect to what it touches', p: [['effect', 'fx', '', ''], ['what', 'what', 'player', '', 'to']], help: 'Puts an effect on what it overlaps, like heal or slow.' },
    remove_effect: { g: 'Do', label: 'Remove effect', p: [['effect', 'fx', '', '']], help: 'Takes an effect off itself.' },
    remove: { g: 'Do', label: 'Remove self', help: 'Disappears for good (a pickup that was collected).' },
    level: { g: 'Do', label: 'Go to level', p: [['n', 'num', 2, '']], help: 'Switches to another level (Map tab). The player keeps its HP.' },
    cutscene: { g: 'Do', label: 'Play cutscene', p: [['name', 'scene', '', ''], ['once', 'bool', true, 'only once']], help: 'Plays a cutscene from the Cutscenes tab. Behaviors pause until it ends.' },
  };

  function node(t, p, c) {
    const n = { t, p: {} };
    (NODES[t].p || []).forEach(([k, , d]) => { n.p[k] = d; });
    Object.assign(n.p, p || {});
    if (NODES[t].kids) n.c = c || [];
    return n;
  }
  const PRESETS = {
    'Patrol walker': () => node('selector', {}, [node('patrol', { speed: 0.4 })]),
    'Chaser': () => node('selector', {}, [
      node('sequence', {}, [node('near', { dist: 72 }), node('chase', { speed: 0.9 })]),
      node('patrol', { speed: 0.4 })]),
    'Jumper': () => node('selector', {}, [
      node('sequence', {}, [node('on_ground'), node('every', { frames: 90 }), node('face_player'), node('jump', { power: 3.5 })]),
      node('sequence', {}, [node('on_ground'), node('stop')]),
      node('chase', { speed: 0.6 })]),
    'Flyer (chases when close)': () => node('selector', {}, [
      node('sequence', {}, [node('near', { dist: 80 }), node('chase', { speed: 0.8 })]),
      node('hover', { height: 10, speed: 0.06 })]),
    'Shooter': () => node('sequence', {}, [node('face_player'), node('near', { dist: 140 }), node('every', { frames: 90 }), node('shoot', { speed: 1.5 })]),
    'Talker NPC': () => node('selector', {}, [
      node('sequence', {}, [node('near', { dist: 32 }), node('face_player'), node('say', { text: 'Hi there!' })]),
      node('wander', { speed: 0.2, turn: 8 })]),
    'Shy (runs away)': () => node('selector', {}, [
      node('sequence', {}, [node('near', { dist: 56 }), node('flee', { speed: 1 })]),
      node('wander', { speed: 0.3 })]),
    'Pressure button': () => node('selector', {}, [
      node('sequence', {}, [node('touching', { what: 'any' }), node('anim', { name: 'pressed' }), node('emit', { event: 'open_door' })]),
      node('anim', { name: 'idle' })]),
    'Door (opens on event)': () => node('sequence', {}, [node('heard', { event: 'open_door' }), node('sound', { note: 'G4', wave: 1 }), node('remove')]),
    'Player (platformer)': () => node('all', {}, [
      node('controls', { speed: 1, jump: 4.2, run: 'r', sound: 'C5' }),
      node('sequence', {}, [node('button', { button: 'b', mode: 'pressed' }), node('count_below', { count: 3, type: '' }), node('shoot', { type: '', speed: 3.5 })])]),
    'Pickup (heals the player)': () => node('sequence', {}, [node('touching', { what: 'player' }), node('apply_touching', { effect: 'heal', what: 'player' }), node('emit', { event: 'pickup' }), node('sound', { note: 'E6', wave: 4 }), node('remove')]),
    'Checkpoint (grow while the player stays)': () => node('selector', {}, [
      node('sequence', {}, [node('is', { key: 'state', value: 'grown' }), node('anim', { name: 'grown' })]),
      node('sequence', {}, [node('circle', { what: 'player', radius: 20 }), node('all', {}, [
        node('anim', { name: 'growing' }),
        node('sequence', {}, [node('every', { frames: 120 }), node('spawn', { type: '', dx: -64, dy: -48 })]),
        node('sequence', {}, [node('count_up', { max: 300, key: 'grow', bar: true }), node('set', { key: 'state', value: 'grown' }), node('emit', { event: 'checkpoint' }), node('sound', { note: 'C6', wave: 4 })])])]),
      node('anim', { name: 'idle' })]),
    'Cutscene trigger (invisible zone)': () => node('sequence', {}, [node('touching', { what: 'player' }), node('cutscene', { once: true })]),
    'Exit (go to next level)': () => node('sequence', {}, [node('touching', { what: 'player' }), node('sound', { note: 'C6', wave: 4 }), node('level', { n: 2 })]),
    'Disappear after a while': () => node('sequence', {}, [node('wait', { frames: 90 }), node('remove')]),
    'Projectile (no behavior)': () => null,
  };

  function newEffect(name) {
    return { name, dur: 120, stack: 'refresh', hp: 0, every: 60, tick: 0, tint: -1, mods: [{ stat: 'speed', op: 'mul', value: 0.5 }] };
  }
  function newType(name) {
    return {
      name, sw: 1, sh: 1, grav: true, collide: true, left: false, hp: 1, inset: 0, team: 'enemy', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [{ name: 'speed', value: 1 }, { name: 'jump', value: 1 }],
      anims: [{ name: 'idle', frames: [1], speed: 8 }, { name: 'walk', frames: [], speed: 8 }],
      tree: PRESETS['Patrol walker']()
    };
  }

  // ------------------------------------------------------------ Lua export
  function luaStr(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
  }
  function luaVal(v) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '0';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return luaStr(v);
    if (Array.isArray(v)) return '{' + v.map(luaVal).join(', ') + '}';
    return '{' + Object.keys(v).filter(k => /^[A-Za-z_]\w*$/.test(k)).map(k => `${k} = ${luaVal(v[k])}`).join(', ') + '}';
  }
  function treeOut(n) {
    if (!n) return null;
    const o = { t: n.t, p: n.p || {} };
    if (n.c) o.c = n.c.map(treeOut);
    return o;
  }
  // levels: optional [{name, w, h, placed}]; start: index (0-based) of the level to begin on
  // cutscenes: data.cutscenes = [{name, level (1-based, 0 = only when triggered), steps: [{t, p}]}]
  function cutscenesLua(list) {
    return (list || []).filter(c => c.name).map(c => `  [${luaStr(c.name)}] = {level = ${c.level | 0}, steps = {` +
      (c.steps || []).map(st => luaVal({ t: st.t, p: st.p || {} })).join(', ') + '}},').join('\n');
  }
  // tile behaviours: named sprite flags, so code can say fget(tile, "boost")
  function flagsLua(data) {
    const names = (data && data.flagNames) || ['solid'];
    const pairs = names.map((n, i) => (n && /^[A-Za-z_]\w*$/.test(n) ? `${n} = ${i}` : '')).filter(Boolean);
    const tune = (data && data.tune) || {};     // values picked on the Game tab, read by tune()
    return `FLAGS = {${pairs.join(', ')}}\n` +
      `TUNE = {${Object.keys(tune).map(k => `[${luaStr(k)}] = ${luaVal(tune[k])}`).join(', ')}}\n` +
      'do local raw_fget, raw_fset = fget, fset\n' +
      '  function fget(n, b) if type(b) == "string" then b = FLAGS[b] if b == nil then return false end end if b == nil then return raw_fget(n) end return raw_fget(n, b) end\n' +
      '  function fset(n, b, on) if type(b) == "string" then b = FLAGS[b] if b == nil then return end end return raw_fset(n, b, on) end\n' +
      'end\n';
  }
  // a level's extra data: a race track and its elevation grid (see tracks.js)
  function levelExtraLua(L) {
    let s = '';
    if (L.track) s += `, track = ${luaVal(L.track)}`;
    if (L.height && window.BKTracks) s += `, height = "${window.BKTracks.heightHex(L.height)}"`;
    return s;
  }
  function toLua(data, levels, start, extra) {
    const hasTracks = (levels || []).some(L => L.track);
    if (!data || (!data.types.length && !(data.effects || []).length && !(data.cutscenes || []).length && !hasTracks)) return flagsLua(data) + (extra || '');
    const defs = data.types.map(t => {
      const anims = {};
      t.anims.forEach(a => { if (a.name && /^[A-Za-z_]\w*$/.test(a.name)) anims[a.name] = { f: a.frames, s: a.speed }; });
      const stats = {};
      (t.stats || []).forEach(q => { if (q.name && /^[A-Za-z_]\w*$/.test(q.name)) stats[q.name] = +q.value || 0; });
      return { name: t.name, sw: t.sw, sh: t.sh, grav: t.grav, collide: t.collide, left: t.left, hp: t.hp, inset: t.inset, team: t.team || 'enemy',
        damage: t.damage || 0, hidden: !!t.hidden, player: !!t.player, stomp: !!t.stomp, touch_fx: t.touch_fx || '', hurt: t.hurt || (t.player ? 60 : 15),
        stats, anims, tree: treeOut(t.tree) };
    });
    const lines = ['-- generated by the studio Entities, Cutscenes and Track tabs', flagsLua(data), 'ents_cutscenes({', cutscenesLua(data.cutscenes), '})', 'ents_effects({'];
    (data.effects || []).forEach(f => lines.push('  ' + luaVal({ name: f.name, dur: +f.dur || 0, stack: f.stack || 'refresh', hp: +f.hp || 0,
      every: +f.every || 0, tick: +f.tick || 0, tint: f.tint === '' || f.tint === undefined ? -1 : +f.tint, mods: (f.mods || []).filter(m => m.stat).map(m => ({ stat: m.stat, op: m.op, value: +m.value || 0 })) }) + ','));
    lines.push('})', 'ents_define({');
    defs.forEach(d => lines.push('  ' + luaVal(d) + ','));
    const placedLua = list => list.map(p => `{${luaStr(p.type)}, ${p.x | 0}, ${p.y | 0}}`).join(', ');
    if (levels && levels.length) {
      lines.push('})', 'ents_levels({');
      levels.forEach(L => lines.push(`  {name = ${luaStr(L.name)}, w = ${L.w | 0}, h = ${L.h | 0}, placed = {${placedLua(L.placed || [])}}${levelExtraLua(L)}},`));
      lines.push(`}, ${((start | 0) + 1)})`);
    } else {
      lines.push('})', 'ents_place({');
      data.placed.forEach(p => lines.push(`  {${luaStr(p.type)}, ${p.x | 0}, ${p.y | 0}},`));
      lines.push('})');
    }
    return lines.join('\n') + '\n' + (extra || '');
  }

  // ------------------------------------------------------------ editor
  function init(ctx) {
    const { cart, $, toast, changed, getAtlas, escapeHtml, tileThumb } = ctx;
    let savedPage = 'look';
    try { savedPage = localStorage.getItem('bitkit.entPage') || 'look'; } catch (e) {}
    const st = { sel: 0, anim: 0, tile: 1, mode: 'ent', fx: 0, page: savedPage };
    cart.entities.effects = cart.entities.effects || [];
    const listEl = $('entList'), formEl = $('entForm'), treeEl = $('entTree');
    const prev = $('entPreview'), pctx = prev.getContext('2d');
    const sheet = $('entSheet'), sctx = sheet.getContext('2d');

    function cur() { return cart.entities.types[st.sel]; }
    function placedCount(name) {
      const lv = cart.levels && cart.levels.length ? cart.levels.map((L, i) => i === cart.level ? cart.entities.placed : L.placed) : [cart.entities.placed];
      return lv.reduce((k, list) => k + list.filter(p => p.type === name).length, 0);
    }
    const subBtns = [...document.querySelectorAll('#entForm .subtabs [data-sub]')];
    function showPage() {
      subBtns.forEach(b => b.classList.toggle('active', b.dataset.sub === st.page));
      document.querySelectorAll('#entForm .subpage').forEach(pg => { pg.hidden = pg.dataset.page !== st.page; });
    }
    subBtns.forEach(b => b.onclick = () => {
      st.page = b.dataset.sub; showPage();
      try { localStorage.setItem('bitkit.entPage', st.page); } catch (e) {}
      if (st.page === 'behavior') renderTree();
    });
    function countSteps(n) { let k = 0; walk(n, () => k++); return k; }
    function renderHead() {
      const t = cur(); if (!t) return;
      const c = $('entHeadThumb'), x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false;
      const f = (t.anims.find(a => a.frames.length) || { frames: [0] }).frames[0];
      const th = thumb(t, f, 32);
      const sc = Math.min(c.width / th.width, c.height / th.height);
      x.drawImage(th, (c.width - th.width * sc) / 2, (c.height - th.height * sc) / 2, th.width * sc, th.height * sc);
      const n = placedCount(t.name);
      $('entPlaced').textContent = n ? `${n} on the map` : 'not on the map yet';
      const k = t.tree ? countSteps(t.tree) : 0;
      $('entStepCount').textContent = k ? k : '';
    }
    // picture of a whole multi-tile sprite starting at tile f
    function thumb(t, f, px) {
      const w = t.sw || 1, h = t.sh || 1, s = Math.max(1, Math.floor(px / (8 * Math.max(w, h))));
      const c = document.createElement('canvas'); c.width = w * 8 * s; c.height = h * 8 * s;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      const a = getAtlas();
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const n = f + j * 16 + i;
        x.drawImage(a, (n % 16) * 8, (n >> 4) * 8, 8, 8, i * 8 * s, j * 8 * s, 8 * s, 8 * s);
      }
      return c;
    }
    function uniqueName(base) {
      let n = base, i = 2;
      while (cart.entities.types.some(t => t.name === n)) n = base + i++;
      return n;
    }

    // ---- list
    function renderList() {
      const types = cart.entities.types;
      listEl.innerHTML = '';
      if (!types.length) listEl.innerHTML = '<div class="dim small">No entities yet. Press New to make one.</div>';
      types.forEach((t, i) => {
        const b = document.createElement('button');
        b.className = 'ent-item' + (i === st.sel && st.mode === 'ent' ? ' active' : '');
        const f = (t.anims.find(a => a.frames.length) || { frames: [0] }).frames[0];
        b.appendChild(thumb(t, f, 16));
        const s = document.createElement('span'); s.textContent = t.name; b.appendChild(s);
        const n = placedCount(t.name);
        const c = document.createElement('span'); c.className = 'dim small'; c.textContent = n ? `${n} on map` : ''; b.appendChild(c);
        b.onclick = () => { st.sel = i; st.anim = 0; st.mode = 'ent'; render(); };
        listEl.appendChild(b);
      });
      const fl = $('fxList');
      fl.innerHTML = '';
      const effects = cart.entities.effects || [];
      if (!effects.length) fl.innerHTML = '<div class="dim small">No effects yet.</div>';
      effects.forEach((f, i) => {
        const b = document.createElement('button');
        b.className = 'ent-item' + (i === st.fx && st.mode === 'fx' ? ' active' : '');
        const sw = document.createElement('span'); sw.className = 'swatch';
        sw.style.background = f.tint >= 0 ? palHex(f.tint) : 'transparent';
        b.appendChild(sw);
        const s = document.createElement('span'); s.textContent = f.name; b.appendChild(s);
        const d = document.createElement('span'); d.className = 'dim small'; d.textContent = f.dur > 0 ? `${(f.dur / 60).toFixed(1)}s` : 'instant'; b.appendChild(d);
        b.onclick = () => { st.fx = i; st.mode = 'fx'; render(); };
        fl.appendChild(b);
      });
    }
    function palHex(c) { const p = cart.palette; return `rgb(${p[c * 3]},${p[c * 3 + 1]},${p[c * 3 + 2]})`; }
    $('fxNew').onclick = () => {
      let n = 'slow', i = 2;
      while (cart.entities.effects.some(f => f.name === n)) n = 'effect' + i++;
      cart.entities.effects.push(newEffect(n)); st.fx = cart.entities.effects.length - 1; st.mode = 'fx';
      changed(); render();
    };
    $('entNew').onclick = () => {
      const t = newType(uniqueName('enemy'));
      t.anims[0].frames = [st.tile];
      cart.entities.types.push(t); st.sel = cart.entities.types.length - 1; st.anim = 0; st.mode = 'ent'; st.page = 'look';
      changed(); render();
    };
    $('entDup').onclick = () => {
      if (!cur()) return;
      const t = JSON.parse(JSON.stringify(cur())); t.name = uniqueName(t.name);
      cart.entities.types.push(t); st.sel = cart.entities.types.length - 1; changed(); render();
    };
    $('entDel').onclick = async () => {
      const t = cur(); if (!t) return;
      const n = placedCount(t.name);
      if (!await ctx.ask(`Delete "${t.name}"?`, n ? `This also removes the ${n} placed on the map.` : 'It is not placed on the map.', 'Delete')) return;
      cart.entities.types.splice(st.sel, 1);
      cart.entities.placed = cart.entities.placed.filter(p => p.type !== t.name);
      (cart.levels || []).forEach((L, i) => { L.placed = i === cart.level ? cart.entities.placed : L.placed.filter(p => p.type !== t.name); });
      st.sel = Math.max(0, st.sel - 1); changed(); render();
    };

    // ---- properties
    function renderForm() {
      const t = cur();
      formEl.hidden = !t || st.mode !== 'ent';
      $('fxForm').hidden = st.mode !== 'fx';
      $('entEmpty').hidden = !(st.mode === 'ent' && !t);
      $('entEmpty').innerHTML = cart.entities.types.length ? 'No entity selected. Press <b>+ new</b> to make one.'
        : 'This game has no entities. Press <b>+ new</b> to make one' + (window.BKTracks && window.BKTracks.uses(cart)
          ? '. Its race tracks, boost pads, crates and hills are on the <b>Track</b> tab.' : '.');
      if (st.mode === 'fx') { renderFx(); return; }
      if (!t) return;
      showPage(); renderHead();
      $('entPlayer').checked = !!t.player; $('entStomp').checked = !!t.stomp; $('entHurt').value = t.hurt ?? (t.player ? 60 : 15);
      $('entTouchFx').innerHTML = '<option value="">none</option>' + cart.entities.effects.map(f => `<option${f.name === t.touch_fx ? ' selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
      renderStats(t);
      $('entName').value = t.name;
      $('entW').value = t.sw; $('entH').value = t.sh;
      $('entGrav').checked = t.grav; $('entCollide').checked = t.collide; $('entLeft').checked = t.left;
      $('entHp').value = t.hp; $('entInset').value = t.inset;
      $('entTeam').value = t.team || 'enemy'; $('entDmg').value = t.damage || 0; $('entHidden').checked = !!t.hidden;
      renderAnims();
    }
    $('entName').addEventListener('change', e => {
      const t = cur(), old = t.name;
      let n = e.target.value.trim().replace(/[^\w\- ]/g, '') || old;
      if (n !== old && cart.entities.types.some(x => x.name === n)) { toast('That name is taken'); n = old; }
      t.name = n; e.target.value = n;
      cart.entities.placed.forEach(p => { if (p.type === old) p.type = n; });
      (cart.levels || []).forEach(L => L.placed.forEach(p => { if (p.type === old) p.type = n; }));
      (cart.entities.cutscenes || []).forEach(c => c.steps.forEach(s => ['who', 'type', 'target'].forEach(k => { if (s.p[k] === old) s.p[k] = n; })));
      cart.entities.types.forEach(x => walk(x.tree, nd => { if (nd.p && nd.p.type === old) nd.p.type = n; if (nd.p && nd.p.what === old) nd.p.what = n; }));
      changed(); renderList(); renderTree();
    });
    function bindProp(id, key, conv) {
      $(id).addEventListener('change', e => { const t = cur(); if (!t) return; t[key] = conv(e.target); changed(); renderList(); renderHead(); drawPreview(); });
    }
    bindProp('entW', 'sw', el => +el.value); bindProp('entH', 'sh', el => +el.value);
    bindProp('entGrav', 'grav', el => el.checked); bindProp('entCollide', 'collide', el => el.checked);
    bindProp('entLeft', 'left', el => el.checked);
    bindProp('entTeam', 'team', el => el.value); bindProp('entDmg', 'damage', el => Math.max(0, +el.value || 0));
    bindProp('entHidden', 'hidden', el => el.checked);
    bindProp('entPlayer', 'player', el => el.checked); bindProp('entStomp', 'stomp', el => el.checked);
    bindProp('entTouchFx', 'touch_fx', el => el.value); bindProp('entHurt', 'hurt', el => Math.max(0, +el.value || 0));

    // ---- stats
    function renderStats(t) {
      t.stats = t.stats || [];
      const box = $('entStats'); box.innerHTML = '';
      t.stats.forEach((q, i) => {
        const c = document.createElement('span'); c.className = 'stat-chip';
        c.innerHTML = `<input value="${escapeHtml(q.name)}" title="stat name"><input type="number" step="any" value="${q.value}"><button class="tiny" title="Remove">✕</button>`;
        const [nm, vl] = c.querySelectorAll('input');
        nm.onchange = () => { q.name = nm.value.trim().replace(/\W/g, '_'); nm.value = q.name; changed(); };
        vl.onchange = () => { q.value = +vl.value || 0; changed(); };
        c.querySelector('button').onclick = () => { t.stats.splice(i, 1); changed(); renderStats(t); };
        box.appendChild(c);
      });
    }
    $('entStatAdd').onclick = () => { const t = cur(); if (!t) return; t.stats = t.stats || []; t.stats.push({ name: 'stat' + (t.stats.length + 1), value: 0 }); changed(); renderStats(t); };

    // ---- effects
    function curFx() { return cart.entities.effects[st.fx]; }
    function renderFx() {
      const f = curFx();
      if (!f) { $('fxForm').hidden = true; return; }
      $('fxName').value = f.name; $('fxDur').value = f.dur; $('fxStack').value = f.stack || 'refresh';
      $('fxHp').value = f.hp || 0; $('fxEvery').value = f.every || 0; $('fxTick').value = f.tick || 0; $('fxTint').value = f.tint ?? -1;
      $('fxTintSw').style.background = f.tint >= 0 ? palHex(f.tint) : 'transparent';
      $('fxHeadSw').style.background = f.tint >= 0 ? palHex(f.tint) : 'transparent';
      const box = $('fxMods'); box.innerHTML = '';
      const statNames = new Set(['speed', 'jump', 'damage', 'hp']);
      cart.entities.types.forEach(t => (t.stats || []).forEach(q => statNames.add(q.name)));
      (f.mods || []).forEach((m, i) => {
        const r = document.createElement('div'); r.className = 'fx-mod';
        r.innerHTML = `<input list="fxStatNames" value="${escapeHtml(m.stat)}" title="stat"><select><option value="mul"${m.op === 'mul' ? ' selected' : ''}>times</option><option value="add"${m.op === 'add' ? ' selected' : ''}>plus</option><option value="set"${m.op === 'set' ? ' selected' : ''}>set to</option></select><input type="number" step="any" value="${m.value}"><button class="tiny">✕</button>`;
        const [st1, op] = [r.querySelector('input'), r.querySelector('select')], val = r.querySelectorAll('input')[1];
        st1.onchange = () => { m.stat = st1.value.trim(); changed(); };
        op.onchange = () => { m.op = op.value; changed(); };
        val.onchange = () => { m.value = +val.value || 0; changed(); };
        r.querySelector('button').onclick = () => { f.mods.splice(i, 1); changed(); renderFx(); };
        box.appendChild(r);
      });
      let dl = document.getElementById('fxStatNames');
      if (!dl) { dl = document.createElement('datalist'); dl.id = 'fxStatNames'; document.body.appendChild(dl); }
      dl.innerHTML = [...statNames].map(n => `<option value="${escapeHtml(n)}">`).join('');
    }
    function bindFx(id, key, conv) { $(id).addEventListener('change', e => { const f = curFx(); if (!f) return; f[key] = conv(e.target); changed(); renderList(); renderFx(); }); }
    bindFx('fxDur', 'dur', el => Math.max(0, +el.value || 0)); bindFx('fxStack', 'stack', el => el.value);
    bindFx('fxHp', 'hp', el => +el.value || 0); bindFx('fxEvery', 'every', el => Math.max(0, +el.value || 0));
    bindFx('fxTick', 'tick', el => +el.value || 0); bindFx('fxTint', 'tint', el => Math.max(-1, Math.min(255, Math.round(+el.value))));
    $('fxName').addEventListener('change', e => {
      const f = curFx(), old = f.name;
      let n = e.target.value.trim().replace(/[^\w\- ]/g, '') || old;
      if (n !== old && cart.entities.effects.some(x => x.name === n)) { toast('That name is taken'); n = old; }
      f.name = n;
      cart.entities.types.forEach(t => { if (t.touch_fx === old) t.touch_fx = n; walk(t.tree, nd => { if (nd.p && nd.p.effect === old) nd.p.effect = n; }); });
      changed(); renderList(); renderFx();
    });
    $('fxModAdd').onclick = () => { const f = curFx(); if (!f) return; (f.mods = f.mods || []).push({ stat: 'speed', op: 'mul', value: 0.5 }); changed(); renderFx(); };
    $('fxDel').onclick = async () => {
      const f = curFx(); if (!f) return;
      if (!await ctx.ask(`Delete effect "${f.name}"?`, 'Behavior steps that use it will do nothing until you pick another effect.', 'Delete')) return;
      cart.entities.effects.splice(st.fx, 1); st.fx = 0; st.mode = cart.entities.effects.length ? 'fx' : 'ent'; changed(); render();
    };
    bindProp('entHp', 'hp', el => Math.max(0, +el.value || 0)); bindProp('entInset', 'inset', el => Math.max(0, Math.min(3, +el.value || 0)));

    // ---- animations
    const animsEl = $('entAnims');
    function renderAnims() {
      const t = cur();
      animsEl.innerHTML = '';
      t.anims.forEach((a, i) => {
        const row = document.createElement('div');
        row.className = 'anim-row' + (i === st.anim ? ' active' : '');
        row.innerHTML = `<input class="a-name" value="${escapeHtml(a.name)}" title="Animation name (idle, walk and jump play automatically)">
          <label class="dim small">speed <input class="a-speed" type="number" min="1" max="60" value="${a.speed}" title="Frames per picture (lower is faster)"></label>
          <span class="a-frames"></span>
          <span class="a-ctl"><button class="tiny a-add" title="Add the tile picked on the right">+ tile</button><button class="tiny a-del" title="Delete animation">✕</button></span>`;
        const fr = row.querySelector('.a-frames');
        a.frames.forEach((f, k) => {
          const c = thumb(t, f, 16);
          c.title = `tile ${f} (click to remove)`;
          c.onclick = ev => { ev.stopPropagation(); a.frames.splice(k, 1); changed(); renderAnims(); renderList(); renderHead(); };
          fr.appendChild(c);
        });
        if (!a.frames.length) fr.innerHTML = '<span class="dim small">no frames</span>';
        row.onclick = () => { if (st.anim !== i) { st.anim = i; renderAnims(); } };
        row.querySelector('.a-name').onchange = e => { a.name = e.target.value.trim().replace(/\W/g, '_') || 'anim'; e.target.value = a.name; changed(); renderTree(); };
        row.querySelector('.a-speed').onchange = e => { a.speed = Math.max(1, +e.target.value || 8); changed(); };
        row.querySelector('.a-add').onclick = ev => { ev.stopPropagation(); a.frames.push(st.tile); st.anim = i; changed(); renderAnims(); renderList(); renderHead(); };
        row.querySelector('.a-del').onclick = ev => { ev.stopPropagation(); t.anims.splice(i, 1); st.anim = 0; changed(); renderAnims(); };
        animsEl.appendChild(row);
      });
    }
    $('entAnimAdd').onclick = () => {
      const t = cur(); if (!t) return;
      const names = ['idle', 'walk', 'jump', 'attack', 'hurt'];
      const name = names.find(n => !t.anims.some(a => a.name === n)) || 'anim' + t.anims.length;
      t.anims.push({ name, frames: [st.tile], speed: 8 }); st.anim = t.anims.length - 1;
      changed(); renderAnims();
    };

    // ---- preview
    let pt = 0;
    function drawPreview() {
      const t = cur();
      pctx.imageSmoothingEnabled = false;
      pctx.clearRect(0, 0, prev.width, prev.height);
      if (!t) return;
      const a = t.anims[st.anim] || t.anims[0];
      if (!a || !a.frames.length) { pctx.fillStyle = '#8d8aa6'; pctx.font = '12px system-ui'; pctx.fillText('no frames yet', 24, 68); return; }
      const f = a.frames[Math.floor(pt / Math.max(1, a.speed)) % a.frames.length];
      const atlas = getAtlas();
      const s = Math.floor(Math.min(prev.width / (t.sw * 8), prev.height / (t.sh * 8)));
      const ox = (prev.width - t.sw * 8 * s) / 2, oy = (prev.height - t.sh * 8 * s) / 2;
      for (let j = 0; j < t.sh; j++) for (let i = 0; i < t.sw; i++) {
        const n = f + j * 16 + i;
        pctx.drawImage(atlas, (n % 16) * 8, (n >> 4) * 8, 8, 8, ox + i * 8 * s, oy + j * 8 * s, 8 * s, 8 * s);
      }
      if (t.inset) {
        pctx.strokeStyle = 'rgba(255,107,94,.8)';
        pctx.strokeRect(ox + t.inset * s + .5, oy + t.inset * s + .5, (t.sw * 8 - t.inset * 2) * s - 1, (t.sh * 8 - t.inset) * s - 1);
      }
    }

    // ---- tile picker
    function drawSheet() {
      sctx.imageSmoothingEnabled = false;
      sctx.fillStyle = '#000'; sctx.fillRect(0, 0, 256, 512);
      sctx.drawImage(getAtlas(), 0, 0, 256, 512);
      sctx.strokeStyle = '#ffd23f'; sctx.lineWidth = 2;
      const t = cur(), w = t ? t.sw : 1, h = t ? t.sh : 1;
      sctx.strokeRect((st.tile % 16) * 16 + 1, (st.tile >> 4) * 16 + 1, w * 16 - 2, h * 16 - 2);
      sctx.lineWidth = 1;
      $('entTileInfo').textContent = st.tile;
    }
    sheet.addEventListener('mousedown', e => {
      const r = sheet.getBoundingClientRect();
      st.tile = Math.floor((e.clientY - r.top) / r.height * 32) * 16 + Math.floor((e.clientX - r.left) / r.width * 16);
      drawSheet();
    });

    // ---- behavior tree
    function walk(n, fn) { if (!n) return; fn(n); (n.c || []).forEach(c => walk(c, fn)); }
    const presetSel = $('entPreset');
    presetSel.innerHTML = '<option value="">Start from a preset…</option>' + Object.keys(PRESETS).map(k => `<option>${escapeHtml(k)}</option>`).join('');
    presetSel.onchange = async () => {
      const k = presetSel.value; presetSel.value = '';
      const t = cur(); if (!k || !t) return;
      if (t.tree && !await ctx.ask('Replace this behavior?', `The current behavior tree is replaced with "${k}".`, 'Replace')) return;
      t.tree = PRESETS[k]();
      changed(); renderTree();
    };

    function typeOptions(sel) {
      const groups = {};
      Object.entries(NODES).forEach(([k, v]) => { (groups[v.g] = groups[v.g] || []).push(`<option value="${k}"${k === sel ? ' selected' : ''}>${escapeHtml(v.label)}</option>`); });
      return Object.entries(groups).map(([g, o]) => `<optgroup label="${g}">${o.join('')}</optgroup>`).join('');
    }
    function paramInput(n, [key, kind, def, unit, label], t) {
      const v = n.p[key] ?? def;
      let html;
      if (kind === 'num') html = `<input type="number" step="any" data-k="${key}" value="${v}">`;
      else if (kind === 'bool') html = `<input type="checkbox" data-k="${key}"${v ? ' checked' : ''}>`;
      else if (kind === 'anim') html = `<select data-k="${key}">${t.anims.map(a => `<option${a.name === v ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select>`;
      else if (kind === 'btn') html = `<select data-k="${key}">${['a', 'b', 'x', 'y', 'l', 'r', 'start', 'select', 'up', 'down', 'left', 'right'].map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      else if (kind === 'mode') html = `<select data-k="${key}">${['pressed', 'held', 'released'].map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      else if (kind === 'run') html = `<select data-k="${key}">${['r', 'l', 'none'].map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      else if (kind === 'fx') html = `<select data-k="${key}"><option value="">(pick)</option>${(cart.entities.effects || []).map(x => `<option${x.name === v ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>`;
      else if (kind === 'what') html = `<select data-k="${key}">${['player', 'any', 'enemy', 'friend', 'wall'].concat(cart.entities.types.map(x => x.name)).map(o => `<option${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
      else if (kind === 'dir') html = `<select data-k="${key}">${['ahead', 'up', 'down', 'player'].map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      else if (kind === 'scene') html = `<select data-k="${key}"><option value="">(pick)</option>${(cart.entities.cutscenes || []).map(x => `<option${x.name === v ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>`;
      else if (kind === 'ent') html = `<select data-k="${key}"><option value="">(pick)</option>${cart.entities.types.map(x => `<option${x.name === v ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>`;
      else html = `<input type="text" data-k="${key}" value="${escapeHtml(String(v))}">`;
      // what the field is comes first, its unit after: speed [1] px/frame
      return `<label class="np">${label ? `<span class="np-l">${escapeHtml(label)}</span>` : ''}${html}${unit ? `<span class="dim small">${escapeHtml(unit)}</span>` : ''}</label>`;
    }
    function nodeEl(n, parent, idx, t) {
      const meta = NODES[n.t] || { g: 'Do', label: n.t };
      const el = document.createElement('div');
      el.className = 'bt-node g-' + meta.g.toLowerCase();
      const head = document.createElement('div');
      head.className = 'bt-head';
      head.innerHTML = `<span class="bt-tag">${{ Flow: '◆', Check: '?', Sense: '◎', Do: '▶' }[meta.g]}</span>
        <span class="bt-params"><select class="bt-type" title="${escapeHtml(meta.help || '')}">${typeOptions(n.t)}</select>
        ${(meta.p || []).map(pp => paramInput(n, pp, t)).join('')}${meta.help ? `<span class="bt-help">${escapeHtml(meta.help)}</span>` : ''}</span>
        <span class="bt-ctl">${meta.kids ? '<button class="tiny bt-add" title="Add a step inside">+ step</button>' : ''}${parent ? '<button class="tiny bt-after" title="Add a step below this one">+ below</button><button class="tiny bt-up" title="Move up">↑</button><button class="tiny bt-down" title="Move down">↓</button><button class="tiny bt-del" title="Delete step">✕</button>' : ''}</span>`;
      el.appendChild(head);
      head.querySelector('.bt-type').onchange = e => {
        let nn = node(e.target.value);
        if (nn.c && n.c) nn.c = NODES[nn.t].kids === 'one' ? n.c.slice(0, 1) : n.c;
        // the top of a behavior always holds steps: picking a single step there puts it inside "Do in order"
        if (!parent && !nn.c) { nn = node('sequence', {}, [nn].concat(n.c || [])); toast('Put it inside "Do in order". Use + step to add more.'); }
        if (parent) parent.c[idx] = nn; else t.tree = nn;
        changed(); renderTree();
      };
      head.querySelectorAll('[data-k]').forEach(inp => {
        inp.onchange = () => {
          const k = inp.dataset.k;
          n.p[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value;
          changed();
        };
      });
      const add = head.querySelector('.bt-add');
      if (add) add.onclick = () => {
        if (meta.kids === 'one' && n.c.length) return toast('"Not" holds one step');
        n.c.push(node(n.c.length ? 'patrol' : 'near')); changed(); renderTree();
      };
      if (parent) {
        head.querySelector('.bt-after').onclick = () => {
          if (NODES[parent.t].kids === 'one') return toast('"Not" holds one step');
          parent.c.splice(idx + 1, 0, node(meta.g === 'Do' ? 'wait' : 'patrol')); changed(); renderTree();
        };
        head.querySelector('.bt-up').onclick = () => { if (idx > 0) { [parent.c[idx - 1], parent.c[idx]] = [parent.c[idx], parent.c[idx - 1]]; changed(); renderTree(); } };
        head.querySelector('.bt-down').onclick = () => { if (idx < parent.c.length - 1) { [parent.c[idx + 1], parent.c[idx]] = [parent.c[idx], parent.c[idx + 1]]; changed(); renderTree(); } };
        head.querySelector('.bt-del').onclick = () => { parent.c.splice(idx, 1); changed(); renderTree(); };
      }
      if (n.c) {
        const kids = document.createElement('div');
        kids.className = 'bt-kids';
        n.c.forEach((c, i) => kids.appendChild(nodeEl(c, n, i, t)));
        if (!n.c.length) kids.innerHTML = '<div class="dim small bt-empty">empty: press + step</div>';
        el.appendChild(kids);
      }
      return el;
    }
    function renderTree() {
      const t = cur();
      treeEl.innerHTML = '';
      if (t) renderHead();
      $('entTreeBox').hidden = !t;
      if (!t) return;
      if (!t.tree) {
        treeEl.innerHTML = '<div class="dim small">No behavior: it only moves if something pushes it (good for projectiles). <button class="tiny" id="entTreeStart">Add behavior</button></div>';
        $('entTreeStart').onclick = () => { t.tree = node('sequence', {}, []); changed(); renderTree(); };
        return;
      }
      treeEl.appendChild(nodeEl(t.tree, null, 0, t));
      const clear = document.createElement('button');
      clear.className = 'tiny danger bt-clear'; clear.textContent = 'Remove behavior';
      clear.onclick = () => { t.tree = null; changed(); renderTree(); };
      treeEl.appendChild(clear);
    }

    function render() {
      cart.entities.effects = cart.entities.effects || [];
      if (st.sel >= cart.entities.types.length) st.sel = Math.max(0, cart.entities.types.length - 1);
      if (st.mode === 'fx' && !curFx()) st.mode = 'ent';
      renderList(); renderForm(); drawSheet();
      if (st.mode === 'ent') { renderTree(); drawPreview(); } else { $('entTreeBox').hidden = true; }
    }
    setInterval(() => { if (ctx.isActive()) { pt++; drawPreview(); } }, 1000 / 60);
    return { render, refreshGfx() { if (ctx.isActive()) { renderList(); renderAnims && cur() && renderAnims(); drawSheet(); } } };
  }

  return { init, toLua, newType, newEffect, node, NODES, PRESETS };
})();
