/* BitKit Studio: cutscene editor. A cutscene is a list of steps the runtime plays in order. MIT License. */
'use strict';
window.BKCutscenes = (function () {
  // step catalog. p: [key, kind, default, label]
  const STEPS = {
    say: { icon: '💬', label: 'Say', p: [['who', 'who', '', ''], ['text', 'long', 'Hello!', ''], ['frames', 'num', 0, 'auto-next after (0 = wait for A)']],
      help: 'Shows a dialog box. The speaker\'s sprite and name are shown next to the text. A or B goes on.' },
    wait: { icon: '⏱', label: 'Wait', p: [['frames', 'num', 30, 'frames']] },
    camera: { icon: '🎥', label: 'Move camera to', p: [['target', 'target', 'player', ''], ['x', 'num', 0, 'tile x'], ['y', 'num', 0, 'tile y'], ['frames', 'num', 60, 'frames']],
      help: 'Pans the camera. Pan back to "player" to give control back smoothly (it also eases back on its own at the end).' },
    move: { icon: '🚶', label: 'Walk', p: [['who', 'who', 'player', ''], ['x', 'num', 0, 'to tile x'], ['y', 'num', '', 'tile y (flyers)'], ['speed', 'num', 1, 'px/frame']],
      help: 'Walks an entity to a tile column and waits until it gets there.' },
    jump: { icon: '⤴', label: 'Jump', p: [['who', 'who', 'player', ''], ['power', 'num', 3.5, '']] },
    face: { icon: '↔', label: 'Turn', p: [['who', 'who', '', ''], ['dir', 'dir', 'player', '']] },
    anim: { icon: '🎞', label: 'Play animation', p: [['who', 'who', '', ''], ['name', 'text', 'idle', 'until the end']] },
    fade: { icon: '🌘', label: 'Fade', p: [['to', 'fade', 'black', ''], ['frames', 'num', 30, 'frames']] },
    shake: { icon: '💥', label: 'Shake screen', p: [['frames', 'num', 20, 'frames'], ['power', 'num', 3, 'px']] },
    sound: { icon: '🔔', label: 'Play sound', p: [['note', 'text', 'C5', ''], ['wave', 'num', 0, 'wave 0-5']] },
    emit: { icon: '📣', label: 'Send event', p: [['event', 'text', 'my_event', '']], help: 'Your code can react with on("name", function() ... end).' },
    tile: { icon: '🧱', label: 'Change map tile', p: [['x', 'num', 0, 'tile x'], ['y', 'num', 0, 'tile y'], ['tile', 'num', 0, 'tile']] },
    spawn: { icon: '✨', label: 'Spawn', p: [['type', 'ent', '', ''], ['x', 'num', 0, 'tile x'], ['y', 'num', 0, 'tile y']] },
    remove: { icon: '🗑', label: 'Remove', p: [['who', 'who', '', '']] },
    level: { icon: '🚪', label: 'Go to level', p: [['n', 'num', 2, '']] },
  };
  function step(t, p) {
    const s = { t, p: {} };
    STEPS[t].p.forEach(([k, , d]) => { s.p[k] = d; });
    Object.assign(s.p, p || {});
    return s;
  }

  function init(ctx) {
    const { cart, $, toast, escapeHtml, changed, ask, preview, levels, placeOnMap } = ctx;
    const st = { sel: 0 };
    const list = () => (cart.entities.cutscenes = cart.entities.cutscenes || []);
    const cur = () => list()[st.sel];
    const listEl = $('csList'), stepsEl = $('csSteps');

    function uniqueName(base) {
      let n = base, i = 2;
      while (list().some(c => c.name === n)) n = base + '_' + i++;
      return n;
    }
    function renameRefs(old, nw) {
      const walk = n => { if (!n) return; if (n.t === 'cutscene' && n.p.name === old) n.p.name = nw; (n.c || []).forEach(walk); };
      cart.entities.types.forEach(t => walk(t.tree));
    }

    function renderList() {
      listEl.innerHTML = '';
      list().forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'ent-item' + (i === st.sel ? ' active' : '');
        const lv = c.level ? (levels()[c.level - 1] || {}).name : '';
        b.innerHTML = `<span>🎬</span><span>${escapeHtml(c.name)}</span><span class="dim small">${lv ? '▶ ' + escapeHtml(lv) : (c.steps || []).length}</span>`;
        b.title = lv ? `Plays when ${lv} starts` : `${(c.steps || []).length} steps`;
        b.onclick = () => { st.sel = i; render(); };
        listEl.appendChild(b);
      });
      if (!list().length) listEl.innerHTML = '<div class="dim small">No cutscenes yet.</div>';
    }

    $('csNew').onclick = () => {
      const c = { name: uniqueName('scene'), level: 0, steps: [step('say', { who: '', text: 'Once upon a time...' })] };
      list().push(c); st.sel = list().length - 1; changed(); render();
      $('csName').focus(); $('csName').select();
    };

    function whoOptions(v, withNarrator) {
      const o = (withNarrator ? [['', 'Narrator (no one)']] : []).concat([['player', 'the player']]).concat(cart.entities.types.filter(t => !t.player).map(t => [t.name, t.name]));
      const pl = cart.entities.types.find(t => t.player);
      if (pl) o.splice(withNarrator ? 2 : 1, 0, [pl.name, pl.name + ' (player)']);
      return o.map(([k, l]) => `<option value="${escapeHtml(k)}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
    }
    function input(s, [key, kind, def, label]) {
      const v = s.p[key] ?? def;
      let h;
      if (kind === 'num') h = `<input type="number" step="any" data-k="${key}" value="${escapeHtml(String(v))}">`;
      else if (kind === 'long') h = `<textarea data-k="${key}" rows="2" spellcheck="true">${escapeHtml(String(v))}</textarea>`;
      else if (kind === 'who') h = `<select data-k="${key}">${whoOptions(v, s.t === 'say')}</select>`;
      else if (kind === 'target') h = `<select data-k="${key}">${[['player', 'the player'], ['tile', 'a tile…']].concat(cart.entities.types.filter(t => !t.player).map(t => [t.name, t.name]))
        .map(([k, l]) => `<option value="${escapeHtml(k)}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
      else if (kind === 'ent') h = `<select data-k="${key}"><option value="">(pick)</option>${cart.entities.types.map(t => `<option${t.name === v ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>`;
      else if (kind === 'dir') h = `<select data-k="${key}">${[['player', 'to the player'], ['left', 'left'], ['right', 'right']].map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
      else if (kind === 'fade') h = `<select data-k="${key}">${[['black', 'to black'], ['clear', 'back in']].map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
      else h = `<input type="text" data-k="${key}" value="${escapeHtml(String(v))}">`;
      const hide = s.t === 'camera' && (key === 'x' || key === 'y') && s.p.target !== 'tile';
      return `<label class="np${kind === 'long' ? ' cs-long' : ''}"${hide ? ' hidden' : ''}>${h}${label ? `<span class="dim small">${escapeHtml(label)}</span>` : ''}</label>`;
    }
    function typeSelect(t) {
      return `<select class="cs-type">${Object.entries(STEPS).map(([k, d]) => `<option value="${k}"${k === t ? ' selected' : ''}>${d.icon} ${escapeHtml(d.label)}</option>`).join('')}</select>`;
    }

    function renderSteps() {
      const c = cur();
      stepsEl.innerHTML = '';
      if (!c) return;
      c.steps.forEach((s, i) => {
        const d = STEPS[s.t] || { icon: '?', label: s.t, p: [] };
        const row = document.createElement('div');
        row.className = 'cs-step';
        row.innerHTML = `<span class="cs-num">${i + 1}</span>
          <span class="bt-params">${typeSelect(s.t)}${d.p.map(pp => input(s, pp)).join('')}</span>
          <span class="bt-ctl"><button class="tiny cs-up" title="Move up">↑</button><button class="tiny cs-down" title="Move down">↓</button><button class="tiny cs-dup" title="Copy step">⧉</button><button class="tiny cs-del" title="Delete step">✕</button></span>`;
        if (d.help) row.title = d.help;
        row.querySelector('.cs-type').onchange = e => {
          const keep = {}; ['who', 'frames', 'x', 'y'].forEach(k => { if (k in s.p) keep[k] = s.p[k]; });
          const ns = step(e.target.value);
          Object.keys(keep).forEach(k => { if (k in ns.p) ns.p[k] = keep[k]; });
          c.steps[i] = ns; changed(); renderSteps();
        };
        row.querySelectorAll('[data-k]').forEach(el => {
          el.onchange = () => {
            const k = el.dataset.k;
            s.p[k] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
            changed();
            if (s.t === 'camera' && k === 'target') renderSteps();
          };
        });
        const mv = to => { if (to < 0 || to >= c.steps.length) return; c.steps.splice(to, 0, c.steps.splice(i, 1)[0]); changed(); renderSteps(); };
        row.querySelector('.cs-up').onclick = () => mv(i - 1);
        row.querySelector('.cs-down').onclick = () => mv(i + 1);
        row.querySelector('.cs-dup').onclick = () => { c.steps.splice(i + 1, 0, JSON.parse(JSON.stringify(s))); changed(); renderSteps(); };
        row.querySelector('.cs-del').onclick = () => { c.steps.splice(i, 1); changed(); renderSteps(); };
        stepsEl.appendChild(row);
      });
      if (!c.steps.length) stepsEl.innerHTML = '<div class="dim small">No steps yet. Add one below.</div>';
      $('csCount').textContent = c.steps.length;
      renderList();
    }

    const addSel = $('csAdd');
    addSel.innerHTML = '<option value="">+ Add a step…</option>' + Object.entries(STEPS).map(([k, d]) => `<option value="${k}">${d.icon} ${escapeHtml(d.label)}</option>`).join('');
    addSel.onchange = () => {
      const c = cur(); const t = addSel.value; addSel.value = '';
      if (!c || !t) return;
      const last = c.steps[c.steps.length - 1];
      const s = step(t);
      if (last && last.p.who !== undefined && s.p.who !== undefined && t !== 'say') s.p.who = last.p.who || s.p.who;
      c.steps.push(s); changed(); renderSteps();
      stepsEl.lastElementChild && stepsEl.lastElementChild.scrollIntoView({ block: 'nearest' });
    };

    $('csName').onchange = e => {
      const c = cur(); if (!c) return;
      const n = e.target.value.trim().replace(/[^\w ]/g, '').replace(/\s+/g, '_');
      if (!n) { e.target.value = c.name; return; }
      if (n === c.name) return;
      if (list().some(x => x !== c && x.name === n)) { toast('There is already a cutscene called ' + n); e.target.value = c.name; return; }
      renameRefs(c.name, n); c.name = n; changed(); render();
    };
    $('csWhen').onchange = e => {
      const c = cur(); if (!c) return;
      const v = +e.target.value;
      if (v) list().forEach(x => { if (x !== c && x.level === v) x.level = 0; });   // one intro per level
      c.level = v; changed(); render();
    };
    $('csPlay').onclick = () => { const c = cur(); if (c) preview(c.name, c.level ? c.level - 1 : null); };
    $('csDup').onclick = () => {
      const c = cur(); if (!c) return;
      const d = JSON.parse(JSON.stringify(c)); d.name = uniqueName(c.name); d.level = 0;
      list().splice(st.sel + 1, 0, d); st.sel++; changed(); render();
    };
    $('csDel').onclick = async () => {
      const c = cur(); if (!c) return;
      if (!(await ask('Delete cutscene', `Delete "${c.name}"? Triggers that play it will do nothing.`, 'Delete'))) return;
      list().splice(st.sel, 1); st.sel = Math.max(0, st.sel - 1); changed(); render();
    };
    $('csZone').onclick = () => {
      const c = cur(); if (!c) return;
      const name = 'cut_' + c.name;
      if (!cart.entities.types.some(t => t.name === name)) {
        const t = window.BKEntities.newType(name);
        Object.assign(t, { sw: 1, sh: 4, grav: false, collide: false, hp: 0, team: 'neutral', damage: 0, hidden: true,
          anims: [{ name: 'idle', frames: [], speed: 8 }],
          tree: window.BKEntities.node('sequence', {}, [window.BKEntities.node('touching', { what: 'player' }), window.BKEntities.node('cutscene', { name: c.name, once: true })]) });
        cart.entities.types.push(t); changed();
      }
      placeOnMap(name);
      toast(`Click on the map to place the "${name}" zone. It plays "${c.name}" the first time the player walks in.`);
    };

    function render() {
      if (st.sel >= list().length) st.sel = Math.max(0, list().length - 1);
      renderList();
      const c = cur();
      $('csForm').hidden = !c;
      $('csEmpty').hidden = !!c;
      if (!c) return;
      $('csName').value = c.name;
      $('csWhen').innerHTML = '<option value="0">When triggered (zone, behavior or code)</option>' +
        levels().map((L, i) => `<option value="${i + 1}"${c.level === i + 1 ? ' selected' : ''}>When ${escapeHtml(L.name)} starts</option>`).join('');
      $('csWhen').value = String(c.level | 0);
      $('csCode').textContent = `cutscene("${c.name}")`;
      $('csZoneRow').hidden = !!c.level;
      renderSteps();
    }
    return { render };
  }

  return { init, STEPS, step };
})();
