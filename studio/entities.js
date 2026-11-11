/* MiniBoi Studio: entity maker (sprites, animations, behavior trees). MIT License. */
'use strict';
window.MBEntities = (function () {
  // Behavior tree node catalog. p: [key, kind, default, unit]
  const NODES = {
    selector: { g: 'Flow', label: 'Try each, first that works', kids: 'many', help: 'Runs children top to bottom and stops at the first one that succeeds.' },
    sequence: { g: 'Flow', label: 'Do in order', kids: 'many', help: 'Runs children top to bottom and stops at the first one that fails.' },
    invert: { g: 'Flow', label: 'Not', kids: 'one', help: 'Flips the result of its child.' },

    near: { g: 'Check', label: 'Player closer than', p: [['dist', 'num', 48, 'px']] },
    far: { g: 'Check', label: 'Player farther than', p: [['dist', 'num', 96, 'px']] },
    sees: { g: 'Check', label: 'Sees player ahead within', p: [['dist', 'num', 96, 'px']] },
    player_above: { g: 'Check', label: 'Player is above, within', p: [['dist', 'num', 24, 'px sideways']] },
    on_ground: { g: 'Check', label: 'On the ground' },
    wall_ahead: { g: 'Check', label: 'Wall ahead' },
    ledge_ahead: { g: 'Check', label: 'Ledge ahead' },
    chance: { g: 'Check', label: 'Random chance', p: [['pct', 'num', 2, '% per frame']] },
    every: { g: 'Check', label: 'Every', p: [['frames', 'num', 60, 'frames']] },
    hp_below: { g: 'Check', label: 'HP below', p: [['hp', 'num', 2, '']] },
    touching: { g: 'Sense', label: 'Touching', p: [['what', 'what', 'player', '']] },
    ray: { g: 'Sense', label: 'Ray hits', p: [['what', 'what', 'player', ''], ['dir', 'dir', 'ahead', ''], ['len', 'num', 64, 'px']], help: 'Casts a line from the middle of the entity. Walls block it.' },
    circle: { g: 'Sense', label: 'Circle contains', p: [['what', 'what', 'player', ''], ['radius', 'num', 24, 'px']] },
    got_hurt: { g: 'Sense', label: 'Just got hurt' },
    heard: { g: 'Sense', label: 'Heard event', p: [['event', 'text', 'open_door', '']], help: 'True on the frame after any entity or your code calls emit("name").' },
    is: { g: 'Check', label: 'Memory is', p: [['key', 'text', 'state', ''], ['value', 'text', 'angry', '']] },

    patrol: { g: 'Do', label: 'Patrol (turn at walls and ledges)', p: [['speed', 'num', 0.5, 'px/frame']] },
    wander: { g: 'Do', label: 'Wander', p: [['speed', 'num', 0.4, 'px/frame'], ['turn', 'num', 10, 'turn chance ‰']] },
    chase: { g: 'Do', label: 'Chase player', p: [['speed', 'num', 0.7, 'px/frame']] },
    flee: { g: 'Do', label: 'Run from player', p: [['speed', 'num', 0.7, 'px/frame']] },
    hover: { g: 'Do', label: 'Bob up and down', p: [['height', 'num', 8, 'px'], ['speed', 'num', 0.06, '']] },
    jump: { g: 'Do', label: 'Jump', p: [['power', 'num', 3.5, '']] },
    stop: { g: 'Do', label: 'Stand still' },
    turn: { g: 'Do', label: 'Turn around' },
    face_player: { g: 'Do', label: 'Face the player' },
    wait: { g: 'Do', label: 'Wait', p: [['frames', 'num', 30, 'frames']] },
    anim: { g: 'Do', label: 'Play animation', p: [['name', 'anim', 'idle', '']] },
    say: { g: 'Do', label: 'Say', p: [['text', 'text', 'Hello!', '']] },
    sound: { g: 'Do', label: 'Play sound', p: [['note', 'text', 'C5', ''], ['wave', 'num', 0, 'wave 0-5']] },
    shoot: { g: 'Do', label: 'Shoot', p: [['type', 'ent', '', ''], ['speed', 'num', 1.5, 'px/frame'], ['aim', 'bool', false, 'aim at player']] },
    set: { g: 'Do', label: 'Remember', p: [['key', 'text', 'state', ''], ['value', 'text', 'angry', '']] },
    emit: { g: 'Do', label: 'Send event', p: [['event', 'text', 'open_door', '']], help: 'Your code can listen with on("name", function(e) ... end).' },
    damage_touching: { g: 'Do', label: 'Damage what it touches', p: [['what', 'what', 'enemy', ''], ['amount', 'num', 1, 'hp']] },
    set_tile: { g: 'Do', label: 'Change map tile', p: [['dx', 'num', 0, 'tiles right'], ['dy', 'num', 1, 'tiles down'], ['tile', 'num', 0, 'tile']] },
    remove: { g: 'Do', label: 'Remove self' },
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
    'Projectile (no behavior)': () => null,
  };

  function newType(name) {
    return {
      name, sw: 1, sh: 1, grav: true, collide: true, left: false, hp: 1, inset: 0, team: 'enemy', damage: 0, hidden: false,
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
  function toLua(data) {
    if (!data || !data.types.length) return '';
    const defs = data.types.map(t => {
      const anims = {};
      t.anims.forEach(a => { if (a.name && /^[A-Za-z_]\w*$/.test(a.name)) anims[a.name] = { f: a.frames, s: a.speed }; });
      return { name: t.name, sw: t.sw, sh: t.sh, grav: t.grav, collide: t.collide, left: t.left, hp: t.hp, inset: t.inset, team: t.team || 'enemy', damage: t.damage || 0, hidden: !!t.hidden, anims, tree: treeOut(t.tree) };
    });
    const lines = ['-- generated by the studio Entities tab', 'ents_define({'];
    defs.forEach(d => lines.push('  ' + luaVal(d) + ','));
    lines.push('})', 'ents_place({');
    data.placed.forEach(p => lines.push(`  {${luaStr(p.type)}, ${p.x | 0}, ${p.y | 0}},`));
    lines.push('})');
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------ editor
  function init(ctx) {
    const { cart, $, toast, changed, getAtlas, escapeHtml, tileThumb } = ctx;
    const st = { sel: 0, anim: 0, tile: 1 };
    const listEl = $('entList'), formEl = $('entForm'), treeEl = $('entTree');
    const prev = $('entPreview'), pctx = prev.getContext('2d');
    const sheet = $('entSheet'), sctx = sheet.getContext('2d');

    function cur() { return cart.entities.types[st.sel]; }
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
        b.className = 'ent-item' + (i === st.sel ? ' active' : '');
        const f = (t.anims.find(a => a.frames.length) || { frames: [0] }).frames[0];
        b.appendChild(tileThumb(f, 2));
        const s = document.createElement('span'); s.textContent = t.name; b.appendChild(s);
        const n = cart.entities.placed.filter(p => p.type === t.name).length;
        const c = document.createElement('span'); c.className = 'dim small'; c.textContent = n ? `${n} on map` : ''; b.appendChild(c);
        b.onclick = () => { st.sel = i; st.anim = 0; render(); };
        listEl.appendChild(b);
      });
    }
    $('entNew').onclick = () => {
      const t = newType(uniqueName('enemy'));
      t.anims[0].frames = [st.tile];
      cart.entities.types.push(t); st.sel = cart.entities.types.length - 1; st.anim = 0;
      changed(); render();
    };
    $('entDup').onclick = () => {
      if (!cur()) return;
      const t = JSON.parse(JSON.stringify(cur())); t.name = uniqueName(t.name);
      cart.entities.types.push(t); st.sel = cart.entities.types.length - 1; changed(); render();
    };
    $('entDel').onclick = async () => {
      const t = cur(); if (!t) return;
      const n = cart.entities.placed.filter(p => p.type === t.name).length;
      if (!await ctx.ask(`Delete "${t.name}"?`, n ? `This also removes the ${n} placed on the map.` : 'It is not placed on the map.', 'Delete')) return;
      cart.entities.types.splice(st.sel, 1);
      cart.entities.placed = cart.entities.placed.filter(p => p.type !== t.name);
      st.sel = Math.max(0, st.sel - 1); changed(); render();
    };

    // ---- properties
    function renderForm() {
      const t = cur();
      formEl.hidden = !t;
      if (!t) return;
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
      cart.entities.types.forEach(x => walk(x.tree, nd => { if (nd.t === 'shoot' && nd.p.type === old) nd.p.type = n; }));
      changed(); renderList(); renderTree();
    });
    function bindProp(id, key, conv) {
      $(id).addEventListener('change', e => { const t = cur(); if (!t) return; t[key] = conv(e.target); changed(); renderList(); drawPreview(); });
    }
    bindProp('entW', 'sw', el => +el.value); bindProp('entH', 'sh', el => +el.value);
    bindProp('entGrav', 'grav', el => el.checked); bindProp('entCollide', 'collide', el => el.checked);
    bindProp('entLeft', 'left', el => el.checked);
    bindProp('entTeam', 'team', el => el.value); bindProp('entDmg', 'damage', el => Math.max(0, +el.value || 0));
    bindProp('entHidden', 'hidden', el => el.checked);
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
          <button class="tiny a-add" title="Add the tile picked on the right">+ tile</button>
          <button class="tiny a-del" title="Delete animation">✕</button>`;
        const fr = row.querySelector('.a-frames');
        a.frames.forEach((f, k) => {
          const c = tileThumb(f, 2);
          c.title = `tile ${f} (click to remove)`;
          c.onclick = ev => { ev.stopPropagation(); a.frames.splice(k, 1); changed(); renderAnims(); renderList(); };
          fr.appendChild(c);
        });
        if (!a.frames.length) fr.innerHTML = '<span class="dim small">no frames</span>';
        row.onclick = () => { if (st.anim !== i) { st.anim = i; renderAnims(); } };
        row.querySelector('.a-name').onchange = e => { a.name = e.target.value.trim().replace(/\W/g, '_') || 'anim'; e.target.value = a.name; changed(); renderTree(); };
        row.querySelector('.a-speed').onchange = e => { a.speed = Math.max(1, +e.target.value || 8); changed(); };
        row.querySelector('.a-add').onclick = ev => { ev.stopPropagation(); a.frames.push(st.tile); st.anim = i; changed(); renderAnims(); renderList(); };
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
    function paramInput(n, [key, kind, def, unit], t) {
      const v = n.p[key] ?? def;
      let html;
      if (kind === 'num') html = `<input type="number" step="any" data-k="${key}" value="${v}">`;
      else if (kind === 'bool') html = `<input type="checkbox" data-k="${key}"${v ? ' checked' : ''}>`;
      else if (kind === 'anim') html = `<select data-k="${key}">${t.anims.map(a => `<option${a.name === v ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select>`;
      else if (kind === 'what') html = `<select data-k="${key}">${['player', 'any', 'enemy', 'friend', 'wall'].concat(cart.entities.types.map(x => x.name)).map(o => `<option${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
      else if (kind === 'dir') html = `<select data-k="${key}">${['ahead', 'up', 'down', 'player'].map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      else if (kind === 'ent') html = `<select data-k="${key}"><option value="">(pick)</option>${cart.entities.types.map(x => `<option${x.name === v ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>`;
      else html = `<input type="text" data-k="${key}" value="${escapeHtml(String(v))}">`;
      return `<label class="np">${html}${unit ? `<span class="dim small">${escapeHtml(unit)}</span>` : ''}</label>`;
    }
    function nodeEl(n, parent, idx, t) {
      const meta = NODES[n.t] || { g: 'Do', label: n.t };
      const el = document.createElement('div');
      el.className = 'bt-node g-' + meta.g.toLowerCase();
      const head = document.createElement('div');
      head.className = 'bt-head';
      head.innerHTML = `<span class="bt-tag">${{ Flow: '◆', Check: '?', Sense: '◎', Do: '▶' }[meta.g]}</span>
        <select class="bt-type" title="${escapeHtml(meta.help || '')}">${typeOptions(n.t)}</select>
        ${(meta.p || []).map(pp => paramInput(n, pp, t)).join('')}
        <span class="grow"></span>
        ${meta.kids ? '<button class="tiny bt-add" title="Add a step inside">+ step</button>' : ''}
        ${parent ? '<button class="tiny bt-up" title="Move up">↑</button><button class="tiny bt-down" title="Move down">↓</button><button class="tiny bt-del" title="Delete">✕</button>' : ''}`;
      el.appendChild(head);
      head.querySelector('.bt-type').onchange = e => {
        const nn = node(e.target.value);
        if (nn.c && n.c) nn.c = NODES[nn.t].kids === 'one' ? n.c.slice(0, 1) : n.c;
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
      $('entTreeBox').hidden = !t;
      if (!t) return;
      if (!t.tree) {
        treeEl.innerHTML = '<div class="dim small">No behavior: it only moves if something pushes it (good for projectiles). <button class="tiny" id="entTreeStart">Add behavior</button></div>';
        $('entTreeStart').onclick = () => { t.tree = node('selector', {}, []); changed(); renderTree(); };
        return;
      }
      treeEl.appendChild(nodeEl(t.tree, null, 0, t));
      const clear = document.createElement('button');
      clear.className = 'tiny'; clear.textContent = 'Remove behavior';
      clear.onclick = () => { t.tree = null; changed(); renderTree(); };
      treeEl.appendChild(clear);
    }

    function render() {
      if (st.sel >= cart.entities.types.length) st.sel = Math.max(0, cart.entities.types.length - 1);
      renderList(); renderForm(); renderTree(); drawSheet(); drawPreview();
    }
    setInterval(() => { if (ctx.isActive()) { pt++; drawPreview(); } }, 1000 / 60);
    return { render, refreshGfx() { if (ctx.isActive()) { renderList(); renderAnims && cur() && renderAnims(); drawSheet(); } } };
  }

  return { init, toLua, newType, node, NODES };
})();
