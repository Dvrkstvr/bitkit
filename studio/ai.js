/* BitKit Studio: AI helper chat (Claude or Gemini, with the user's own API key). MIT License.
 *
 * The studio is a static site with no server, so the chat talks to the provider's API straight from the
 * browser with a key the user pastes in. The key stays in this browser (localStorage, or only in memory
 * if "remember" is off) and is only ever sent to that provider.
 *
 * The AI works on a copy of the cart. Everything it changes is collected into a proposal that the user
 * reviews and applies (or discards). Applying can be undone.
 */
'use strict';
window.BKAI = (function () {
  const LS_KEY = 'bitkit.ai';
  const MAX_ROUNDS = 40;   // tool rounds per message

  const PROVIDERS = {
    claude: {
      label: 'Claude', by: 'Anthropic', keyUrl: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…',
      models: [['claude-opus-5-5', 'Claude Opus 5.5 (smartest)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']]
    },
    gemini: {
      label: 'Gemini', by: 'Google', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…',
      models: [['gemini-4-argon', 'Gemini 4 Argon (smartest)'], ['gemini-3.8-flash', 'Gemini 3.8 Flash (fast)']]
    }
  };

  /* ------------------------------------------------------------ settings (key stays in this browser) */
  function loadSettings() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { /* storage unavailable */ }
    s = s || {};
    return {
      provider: PROVIDERS[s.provider] ? s.provider : 'claude',
      model: Object.assign({ claude: 'claude-opus-5-5', gemini: 'gemini-4-argon' }, s.model || {}),
      keys: Object.assign({ claude: '', gemini: '' }, s.keys || {}),
      remember: s.remember !== false,
      autoApply: !!s.autoApply
    };
  }
  const settings = loadSettings();
  const memKeys = { claude: settings.keys.claude, gemini: settings.keys.gemini };
  function saveSettings() {
    const out = { provider: settings.provider, model: settings.model, remember: settings.remember, autoApply: settings.autoApply,
      keys: settings.remember ? memKeys : { claude: '', gemini: '' } };
    try { localStorage.setItem(LS_KEY, JSON.stringify(out)); } catch (e) { /* storage unavailable */ }
  }
  const keyFor = p => (memKeys[p] || '').trim();

  /* ------------------------------------------------------------ tools the AI can use */
  const T = (name, description, properties, required) => ({ name, description, schema: { type: 'object', properties: properties || {}, required: required || [] } });
  const num = d => ({ type: 'integer', description: d });
  const str = d => ({ type: 'string', description: d });
  const TOOLS = [
    T('read_code', 'Read the cart\'s Lua code with line numbers. Optionally only a range of lines.', { start_line: num('First line (1-based)'), end_line: num('Last line') }),
    T('edit_code', 'Replace one exact piece of the Lua code. old_text must appear exactly once (include a few lines of context). Use this for most code changes.',
      { old_text: str('Exact text to find, including whitespace'), new_text: str('Replacement text') }, ['old_text', 'new_text']),
    T('write_code', 'Replace the whole Lua code. Use for new carts or big rewrites; prefer edit_code for small changes.', { code: str('The complete new code') }, ['code']),
    T('read_entities', 'Read entity types (sprites, animations, stats, behavior trees), effects and cutscenes as JSON. Placed entities are read per level with read_map.'),
    T('set_entity', 'Create or replace an entity type (matched by name). Give the full object in the same shape read_entities returns; missing fields get defaults.',
      { entity: { type: 'object', description: 'Entity type object: name, sw, sh, grav, collide, hp, team, damage, player, anims [{name, frames:[tile numbers], speed}], stats, tree (behavior tree) ...' } }, ['entity']),
    T('set_effect', 'Create or replace an effect (matched by name).', { effect: { type: 'object', description: 'Effect: name, dur, stack, hp, every, tick, tint, mods [{stat, op: mul|add|set, value}]' } }, ['effect']),
    T('set_cutscene', 'Create or replace a cutscene (matched by name).', { cutscene: { type: 'object', description: 'Cutscene: name, level (1-based level that plays it on start, 0 = only when triggered), steps [{t, p}]' } }, ['cutscene']),
    T('delete', 'Delete an entity type, effect or cutscene by name.', { kind: { type: 'string', enum: ['entity', 'effect', 'cutscene'] }, name: str('Name') }, ['kind', 'name']),
    T('read_sprite', 'Read pixels of a sprite tile (or a block of size x size tiles starting at tile). Each row is 2 hex digits per pixel = palette index (00 = transparent).',
      { tile: num('Tile number 0-511 (16 tiles per sheet row)'), size: num('1 = 8x8, 2 = 16x16, 4 = 32x32') }, ['tile']),
    T('draw_sprite', 'Set the pixels of a sprite tile or block. rows: size*8 strings, each size*8 pixels of 2 hex digits (palette index, 00 = transparent). Optionally set the tile flags byte.',
      { tile: num('Top-left tile number 0-511'), size: num('1, 2 or 4 (tiles per side)'), rows: { type: 'array', items: { type: 'string' }, description: 'Pixel rows' }, flags: num('Optional flags byte for every tile in the block (bit 0 = solid in entity physics)') }, ['tile', 'rows']),
    T('read_map', 'Read a rectangle of a level\'s map (tile numbers, 0 = empty) and the entities placed in it. Max 64x48 tiles per call.',
      { level: num('Level number, 1-based'), x: num('Left tile column'), y: num('Top tile row'), w: num('Width in tiles'), h: num('Height in tiles') }, ['level', 'x', 'y', 'w', 'h']),
    T('set_map', 'Write tiles into a level\'s map. rows is a list of rows, each a list of tile numbers, starting at x,y. Use -1 to leave a cell unchanged.',
      { level: num('Level number, 1-based'), x: num('Left tile column'), y: num('Top tile row'), rows: { type: 'array', items: { type: 'array', items: { type: 'integer' } } } }, ['level', 'x', 'y', 'rows']),
    T('fill_map', 'Fill a rectangle of a level\'s map with one tile (0 clears).',
      { level: num('Level number, 1-based'), x: num('Left tile column'), y: num('Top tile row'), w: num('Width'), h: num('Height'), tile: num('Tile number') }, ['level', 'x', 'y', 'w', 'h', 'tile']),
    T('place_entity', 'Place an entity on a level. x, y are in PIXELS (tile * 8), top-left of the entity.',
      { level: num('Level number, 1-based'), type: str('Entity type name'), x: num('x in pixels'), y: num('y in pixels') }, ['level', 'type', 'x', 'y']),
    T('remove_entities', 'Remove placed entities in a pixel rectangle on a level, optionally only one type.',
      { level: num('Level number, 1-based'), x: num('x in pixels'), y: num('y in pixels'), w: num('width in pixels'), h: num('height in pixels'), type: str('Only this type (optional)') }, ['level', 'x', 'y', 'w', 'h']),
    T('set_level', 'Add a level or change a level\'s name and size (in tiles, max 256x128). Use level = number of levels + 1 to add one.',
      { level: num('Level number, 1-based'), name: str('Name'), w: num('Width in tiles'), h: num('Height in tiles') }, ['level']),
    T('read_palette', 'List the 256 palette colours as hex RGB (index: colour).'),
    T('test_game', 'Run your current version of the cart (with your changes) for some frames with scripted buttons. Returns console output, Lua errors and a screenshot of the last frame. Use it after changes to catch errors.',
      { frames: num('How many frames to run (60 = 1 second, max 1800). Default 120.'), level: num('Level to start on (1-based). Default 1.'),
        buttons: { type: 'array', description: 'Button presses: [{from, to, press: ["right","a",...]}] with frame numbers.', items: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' }, press: { type: 'array', items: { type: 'string' } } } } } }),
    T('set_cart_name', 'Rename the cart.', { name: str('New name') }, ['name'])
  ];
  const WRITES = new Set(['edit_code', 'write_code', 'set_entity', 'set_effect', 'set_cutscene', 'delete', 'draw_sprite', 'set_map', 'fill_map', 'place_entity', 'remove_entities', 'set_level', 'set_cart_name']);
  const BTN = ['left', 'right', 'up', 'down', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'];

  /* ------------------------------------------------------------ system prompt */
  function systemPrompt(ctx) {
    const help = (ctx.help || []).filter(([h]) => !/Studio keys|The Bit/.test(h))
      .map(([h, rows]) => `## ${h}\n` + rows.map(([a, b]) => `- ${a}: ${b}`).join('\n')).join('\n\n');
    const nodes = Object.entries(window.BKEntities.NODES).map(([k, n]) =>
      `- ${k} (${n.g}${n.kids ? ', children in c' : ''}): ${n.label}` + (n.p ? ' p={' + n.p.map(([pk, , d, u]) => `${pk}: ${JSON.stringify(d)}${u ? ' ' + u : ''}`).join(', ') + '}' : '') + (n.help ? ' ' + n.help : '')).join('\n');
    const steps = window.BKCutscenes ? Object.entries(window.BKCutscenes.STEPS).map(([k, s]) =>
      `- ${k}: ${s.label} p={` + s.p.map(([pk, , d, u]) => `${pk}: ${JSON.stringify(d)}${u ? ' ' + u : ''}`).join(', ') + '}').join('\n') : '';
    return `You are the game-making helper inside BitKit Studio, a browser studio for making games for BitKit, a small open-source fantasy console that also runs on PocketBit, a DIY ESP32-S3 handheld. You help people (often beginners) make their own original games: you explain, write Lua, draw sprites, build maps and set up entities.

How you work
- You change the cart with tools. Your changes go into a proposal that the person reviews before it is applied, so make the changes directly instead of pasting long code for them to copy.
- Read before you edit. Prefer edit_code for small code changes. Keep the person's style and existing features unless they ask otherwise.
- After changing code or entities, call test_game to make sure the cart runs without Lua errors and looks right. Fix errors you find.
- Keep replies short and friendly. Say what you changed in a few lines; no need to repeat the code. Answer in the person's language.
- Make original games and art. If asked to copy a commercial game's characters, art or levels, suggest an original twist instead.
- Every message from the person starts with a [Studio] note showing the current state of the cart. It is generated by the studio, not typed by the person.

BitKit basics
- Screen 320x240, 60 frames per second, Lua 5.4. Callbacks: _init(), _update(), _draw().
- 256-colour palette: 0 is black (and transparent in sprites), 1-31 hand-picked colours (1 dark navy, 2-5 purples, 6-11 browns/oranges, 12 cream, 13 white, 14-18 greens dark to light, 19-23 blues dark to light, 24-26 reds, 27 yellow, 28-31 greys), 32-247 a 6x6x6 colour cube (index = 32 + r*36 + g*6 + b, each 0-5), 248-255 greys. read_palette gives exact colours (the cart may change them).
- Sprite sheet: 512 tiles of 8x8 pixels, 16 per row. A 16x16 sprite at tile n uses n, n+1, n+16, n+17 (spr(n,x,y,2,2)). Tile flags: bit 0 = solid for entity physics.
- Maps: each level has its own map of up to 256x128 tiles (tile 0 = empty) and its own placed entities. One screen is 40x30 tiles.
- Carts are deterministic: use rnd(), t(); no os/io.

Game rules (GAME_RULES.md): every BitKit game has a main menu, one level you can play from start to end, quick resume, a pause menu with settings and a clear goal.
- Call game{title=..., goal=..., help={...}, continue=function(cp) ... end} in _init: it adds the title screen, the pause menu on Start (so don't use Start for anything else) and the volume setting.
- Call checkpoint({...}) at safe spots so Continue goes straight back there, and game_win("...") when the goal is reached.
- test_game skips the title screen and starts in play.

Entities (Entities tab)
- Entity types have sprites (anims: name, frames = tile numbers, speed), size in tiles (sw, sh), gravity (grav), collide with solid tiles, hp (0 = can't be hurt), team (enemy, friend, neutral), damage on touch, player (is the player), stomp, hidden (invisible trigger), stats [{name, value}] and a behavior tree.
- The code must call ents_update() in _update and ents_draw() in _draw (after camera()), usually with ents_camera() for scrolling.
- Behavior tree node = {t: kind, p: {params}, c: [children]}. Kinds:
${nodes}

Cutscene steps ({t, p}):
${steps}

Lua API
${help}`;
  }

  /* ------------------------------------------------------------ cart workspace helpers */
  const clone = o => JSON.parse(JSON.stringify(o));
  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
  function lvl(ws, n) {
    const L = ws.levels[(n | 0) - 1];
    if (!L) throw new Error(`There is no level ${n}. Levels: 1-${ws.levels.length}`);
    return L;
  }
  function clampInt(v, lo, hi, d) { v = Math.round(+v); if (!isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); }

  function overview(ws, pending) {
    const lines = ws.code.split('\n').length;
    const used = []; for (let n = 0; n < 512; n++) { const o = n * 64; for (let i = 0; i < 64; i++) if (ws.tiles[o + i]) { used.push(n); break; } }
    const ranges = []; for (let i = 0; i < used.length;) { let j = i; while (j + 1 < used.length && used[j + 1] === used[j] + 1) j++; ranges.push(used[i] === used[j] ? `${used[i]}` : `${used[i]}-${used[j]}`); i = j + 1; }
    const e = ws.entities;
    return `[Studio] Cart "${ws.name}": ${lines} lines of code. ` +
      `Levels: ${ws.levels.map((L, i) => `${i + 1} "${L.name}" ${L.w}x${L.h} tiles, ${L.placed.length} placed`).join('; ')}. ` +
      `Entity types: ${e.types.map(t => t.name + (t.player ? ' (player)' : '')).join(', ') || 'none'}. ` +
      `Effects: ${(e.effects || []).map(f => f.name).join(', ') || 'none'}. Cutscenes: ${(e.cutscenes || []).map(c => c.name).join(', ') || 'none'}. ` +
      `Sprite tiles in use: ${ranges.join(', ') || 'none'}.` +
      (pending ? ` Your earlier proposal (${pending} changes) has not been applied yet; you are still working on top of it.` : '');
  }

  // line diff (LCS) for the review card
  function lineDiff(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const a2 = A.slice(s, ea), b2 = B.slice(s, eb), out = [];
    if (a2.length * b2.length > 4e6) { a2.forEach(l => out.push(['-', l])); b2.forEach(l => out.push(['+', l])); }
    else {
      const n = a2.length, m = b2.length, dp = new Uint32Array((n + 1) * (m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
        dp[i * (m + 1) + j] = a2[i] === b2[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && a2[i] === b2[j]) { out.push([' ', a2[i]]); i++; j++; }
        else if (j < m && (i === n || dp[i * (m + 1) + j + 1] >= dp[(i + 1) * (m + 1) + j])) out.push(['+', b2[j++]]);
        else out.push(['-', a2[i++]]);
      }
    }
    // keep 2 lines of context around changes
    const ctxBefore = A.slice(Math.max(0, s - 2), s).map(l => [' ', l]), ctxAfter = A.slice(ea, ea + 2).map(l => [' ', l]);
    return { start: Math.max(0, s - 2) + 1, lines: ctxBefore.concat(out, ctxAfter), added: out.filter(x => x[0] === '+').length, removed: out.filter(x => x[0] === '-').length };
  }

  /* ------------------------------------------------------------ tool implementations */
  function runTool(name, input, job, ctx) {
    const ws = job.ws, ent = ws.entities;
    const note = (kind, label) => job.changes.push({ kind, label });
    switch (name) {
      case 'read_code': {
        const L = ws.code.split('\n');
        const a = clampInt(input.start_line || 1, 1, L.length, 1), b = clampInt(input.end_line || L.length, a, L.length, L.length);
        return L.slice(a - 1, b).map((l, i) => `${String(a + i).padStart(4)}| ${l}`).join('\n') + (b < L.length ? `\n(${L.length} lines in total)` : '');
      }
      case 'edit_code': {
        const o = String(input.old_text), n = String(input.new_text);
        if (!o) throw new Error('old_text is empty');
        const at = ws.code.indexOf(o);
        if (at < 0) throw new Error('old_text was not found. Read the code again and copy the text exactly.');
        if (ws.code.indexOf(o, at + 1) >= 0) throw new Error('old_text appears more than once. Include more surrounding lines.');
        ws.code = ws.code.slice(0, at) + n + ws.code.slice(at + o.length);
        note('code', 'Edited code');
        return 'Done. Line ' + ws.code.slice(0, at).split('\n').length + ' onwards changed.';
      }
      case 'write_code':
        ws.code = String(input.code); note('code', 'Rewrote code');
        return `Done. ${ws.code.split('\n').length} lines.`;
      case 'read_entities':
        return JSON.stringify({ types: ent.types, effects: ent.effects || [], cutscenes: ent.cutscenes || [] });
      case 'set_entity': case 'set_effect': case 'set_cutscene': {
        const kind = name.slice(4), obj = input[kind];
        if (!obj || typeof obj !== 'object' || !obj.name) throw new Error(`${kind} needs a name`);
        const key = kind === 'entity' ? 'types' : kind === 'effect' ? 'effects' : 'cutscenes';
        const list = ent[key] = ent[key] || [];
        const base = kind === 'entity' ? window.BKEntities.newType(obj.name) : kind === 'effect' ? window.BKEntities.newEffect(obj.name) : { name: obj.name, level: 0, steps: [] };
        const i = list.findIndex(x => x.name === obj.name);
        const val = Object.assign(base, i >= 0 ? clone(list[i]) : {}, clone(obj));
        if (kind === 'entity' && val.tree && !NODEOK(val.tree)) throw new Error('Behavior tree has an unknown node kind. Use the kinds listed in your instructions.');
        if (i >= 0) list[i] = val; else list.push(val);
        note('ents', `${i >= 0 ? 'Changed' : 'Added'} ${kind} "${obj.name}"`);
        return 'Done.';
      }
      case 'delete': {
        const key = input.kind === 'entity' ? 'types' : input.kind === 'effect' ? 'effects' : 'cutscenes';
        const list = ent[key] || [], i = list.findIndex(x => x.name === input.name);
        if (i < 0) throw new Error(`No ${input.kind} called "${input.name}"`);
        list.splice(i, 1);
        if (input.kind === 'entity') ws.levels.forEach(L => { for (let k = L.placed.length - 1; k >= 0; k--) if (L.placed[k].type === input.name) L.placed.splice(k, 1); });
        note('ents', `Deleted ${input.kind} "${input.name}"`);
        return 'Done.';
      }
      case 'read_sprite': {
        const size = [1, 2, 4].includes(+input.size) ? +input.size : 1, t = clampInt(input.tile, 0, 511, 0);
        if ((t % 16) + size > 16 || (t >> 4) + size > 32) throw new Error('That block runs off the sprite sheet');
        const rows = [];
        for (let y = 0; y < size * 8; y++) {
          let r = '';
          for (let x = 0; x < size * 8; x++) { const n = t + (y >> 3) * 16 + (x >> 3); r += hex2(ws.tiles[n * 64 + (y & 7) * 8 + (x & 7)]); }
          rows.push(r);
        }
        return JSON.stringify({ tile: t, size, flags: ws.flags[t], rows });
      }
      case 'draw_sprite': {
        const rows = Array.isArray(input.rows) ? input.rows.map(r => String(r).replace(/\s+/g, '')) : [];
        const size = [1, 2, 4].includes(+input.size) ? +input.size : Math.max(1, Math.min(4, Math.ceil(rows.length / 8)));
        const t = clampInt(input.tile, 0, 511, 0), n = size * 8;
        if ((t % 16) + size > 16 || (t >> 4) + size > 32) throw new Error('That block runs off the sprite sheet');
        if (rows.length !== n || rows.some(r => r.length !== n * 2 || /[^0-9a-f]/i.test(r))) throw new Error(`Need exactly ${n} rows of ${n * 2} hex digits`);
        job.tilesBefore = job.tilesBefore || {};
        for (let by = 0; by < size; by++) for (let bx = 0; bx < size; bx++) { const k = t + by * 16 + bx; if (!(k in job.tilesBefore)) job.tilesBefore[k] = true; }
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const k = t + (y >> 3) * 16 + (x >> 3);
          ws.tiles[k * 64 + (y & 7) * 8 + (x & 7)] = parseInt(rows[y].substr(x * 2, 2), 16);
        }
        if (input.flags !== undefined && input.flags !== null) for (let by = 0; by < size; by++) for (let bx = 0; bx < size; bx++) ws.flags[t + by * 16 + bx] = clampInt(input.flags, 0, 255, 0);
        note('gfx', `Drew sprite ${t}` + (size > 1 ? ` (${n}x${n})` : ''));
        return 'Done.';
      }
      case 'read_map': {
        const L = lvl(ws, input.level), x0 = clampInt(input.x, 0, L.w - 1, 0), y0 = clampInt(input.y, 0, L.h - 1, 0);
        const w = clampInt(input.w, 1, Math.min(64, L.w - x0), 1), h = clampInt(input.h, 1, Math.min(48, L.h - y0), 1);
        const rows = [];
        for (let y = y0; y < y0 + h; y++) { const r = []; for (let x = x0; x < x0 + w; x++) r.push(L.map[y * 256 + x]); rows.push(r.join(',')); }
        const placed = L.placed.filter(p => p.x >= x0 * 8 && p.x < (x0 + w) * 8 && p.y >= y0 * 8 && p.y < (y0 + h) * 8);
        return JSON.stringify({ level: input.level, name: L.name, size: [L.w, L.h], x: x0, y: y0, rows, placed });
      }
      case 'set_map': case 'fill_map': {
        const L = lvl(ws, input.level), x0 = input.x | 0, y0 = input.y | 0;
        let count = 0;
        const put = (x, y, t) => { if (x < 0 || y < 0 || x >= L.w || y >= L.h || t < 0) return; t = Math.min(511, t | 0); if (L.map[y * 256 + x] !== t) { L.map[y * 256 + x] = t; count++; } };
        if (name === 'set_map') (input.rows || []).forEach((r, dy) => (r || []).forEach((t, dx) => put(x0 + dx, y0 + dy, +t)));
        else for (let y = 0; y < (input.h | 0); y++) for (let x = 0; x < (input.w | 0); x++) put(x0 + x, y0 + y, +input.tile);
        job.mapCount[input.level] = (job.mapCount[input.level] || 0) + count;
        note('map', `Changed ${count} map tiles on ${L.name}`);
        return `Done. ${count} tiles changed.`;
      }
      case 'place_entity': {
        const L = lvl(ws, input.level);
        if (!ent.types.some(t => t.name === input.type)) throw new Error(`No entity type "${input.type}". Make it with set_entity first.`);
        L.placed.push({ type: input.type, x: input.x | 0, y: input.y | 0 });
        note('place', `Placed ${input.type} on ${L.name}`);
        return 'Done.';
      }
      case 'remove_entities': {
        const L = lvl(ws, input.level); let n = 0;
        for (let k = L.placed.length - 1; k >= 0; k--) {
          const p = L.placed[k];
          if (p.x >= input.x && p.x < input.x + input.w && p.y >= input.y && p.y < input.y + input.h && (!input.type || p.type === input.type)) { L.placed.splice(k, 1); n++; }
        }
        note('place', `Removed ${n} placed entities from ${L.name}`);
        return `Removed ${n}.`;
      }
      case 'set_level': {
        const i = (input.level | 0) - 1;
        if (i < 0 || i > ws.levels.length) throw new Error(`Level must be 1-${ws.levels.length + 1}`);
        if (i === ws.levels.length) ws.levels.push({ name: input.name || `Level ${i + 1}`, w: 256, h: 128, map: new Uint16Array(256 * 128), placed: [] });
        const L = ws.levels[i];
        if (input.name) L.name = String(input.name);
        if (input.w) L.w = clampInt(input.w, 1, 256, L.w);
        if (input.h) L.h = clampInt(input.h, 1, 128, L.h);
        note('map', `Level ${i + 1} "${L.name}" (${L.w}x${L.h})`);
        return 'Done.';
      }
      case 'read_palette': {
        const out = [];
        for (let i = 0; i < 256; i++) out.push(`${i}:${hex2(ws.palette[i * 3])}${hex2(ws.palette[i * 3 + 1])}${hex2(ws.palette[i * 3 + 2])}`);
        return out.join(' ');
      }
      case 'test_game': {
        const frames = clampInt(input.frames || 120, 1, 1800, 120);
        const r = ctx.testCart(ws, { frames, level: clampInt(input.level || 1, 1, ws.levels.length, 1) - 1, buttons: Array.isArray(input.buttons) ? input.buttons : [] });
        job.shots.push(r.png);
        const out = { ran_frames: r.frames, ok: r.ok, errors: r.errors, console: r.logs.slice(-40) };
        return { text: JSON.stringify(out), png: r.png };
      }
      case 'set_cart_name':
        ws.name = String(input.name || ws.name); note('name', `Renamed cart to "${ws.name}"`);
        return 'Done.';
    }
    throw new Error('Unknown tool ' + name);
  }
  function NODEOK(n) {
    if (!n || typeof n !== 'object' || !window.BKEntities.NODES[n.t]) return false;
    n.p = n.p || {};
    if (window.BKEntities.NODES[n.t].kids) n.c = Array.isArray(n.c) ? n.c : [];
    return (n.c || []).every(NODEOK);
  }

  /* ------------------------------------------------------------ SSE reader */
  async function readSSE(res, onData, signal) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = chunk.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (data && data !== '[DONE]') onData(JSON.parse(data));
      }
    }
  }
  async function apiError(res, who) {
    let msg = `${who} said ${res.status}`;
    try { const j = await res.json(); const m = (j.error && (j.error.message || j.error.type)) || j.message; if (m) msg += ': ' + m; } catch (e) { /* not json */ }
    if (res.status === 401 || res.status === 403) msg += ' (check your API key in AI settings)';
    if (res.status === 429) msg += ' (rate limit or out of credit, try again in a moment)';
    return new Error(msg);
  }

  /* ------------------------------------------------------------ Claude (Anthropic Messages API) */
  // history items: {role:'user', text} | {role:'assistant', provider, raw, text, calls:[{id,name,input}]} | {role:'tool', results:[{id,name,text,png,isError}]}
  function claudeMessages(history) {
    const msgs = [];
    history.forEach(h => {
      if (h.role === 'user') msgs.push({ role: 'user', content: [{ type: 'text', text: h.text }] });
      else if (h.role === 'assistant') {
        const content = h.provider === 'claude' && h.raw ? h.raw
          : [].concat(h.text ? [{ type: 'text', text: h.text }] : [], h.calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })));
        msgs.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no reply)' }] });
      } else if (h.role === 'tool') {
        msgs.push({ role: 'user', content: h.results.map(r => ({
          type: 'tool_result', tool_use_id: r.id, is_error: !!r.isError,
          content: [{ type: 'text', text: r.text }].concat(r.png ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: r.png.split(',')[1] } }] : [])
        })) });
      }
    });
    return msgs;
  }
  async function claudeTurn(job, onText) {
    const model = settings.model.claude;
    const gen5 = /^claude-(opus|sonnet|haiku|fable|mythos)-5/.test(model);
    const body = {
      model, max_tokens: 64000, stream: true,
      system: job.system,
      cache_control: { type: 'ephemeral' },
      tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true })),
      messages: claudeMessages(job.history)
    };
    const headers = {
      'content-type': 'application/json', 'x-api-key': keyFor('claude'), 'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (gen5) { body.thinking = { type: 'adaptive' }; body.output_config = { effort: 'medium' }; }
    if (/^claude-(opus-5-5|sonnet-5-5|opus-5|fable-5)/.test(model)) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal: job.abort.signal });
    if (!res.ok) throw await apiError(res, 'Claude');
    const blocks = [], json = {};
    let stop = null;
    await readSSE(res, ev => {
      if (ev.type === 'content_block_start') { blocks[ev.index] = clone(ev.content_block); if (ev.content_block.type === 'tool_use') json[ev.index] = ''; }
      else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onText(d.text); }
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = d.signature;
        else if (d.type === 'input_json_delta') json[ev.index] += d.partial_json;
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b && b.type === 'tool_use') { try { b.input = json[ev.index] ? JSON.parse(json[ev.index]) : {}; } catch (e) { b.input = {}; b._bad = true; } }
      } else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; }
      else if (ev.type === 'error') throw new Error('Claude: ' + ((ev.error && ev.error.message) || 'stream error'));
    }, job.abort.signal);
    const raw = blocks.filter(Boolean).map(b => { const c = Object.assign({}, b); delete c._bad; return c; });
    return {
      raw, stop: stop === 'tool_use' ? 'tools' : stop === 'refusal' ? 'refusal' : stop === 'max_tokens' ? 'max_tokens' : 'end',
      text: raw.filter(b => b.type === 'text').map(b => b.text).join(''),
      calls: blocks.filter(b => b && b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input, bad: !!b._bad }))
    };
  }

  /* ------------------------------------------------------------ Gemini (generateContent API) */
  function geminiContents(history) {
    const out = [];
    history.forEach(h => {
      if (h.role === 'user') out.push({ role: 'user', parts: [{ text: h.text }] });
      else if (h.role === 'assistant') {
        const parts = h.provider === 'gemini' && h.raw ? h.raw
          : [].concat(h.text ? [{ text: h.text }] : [], h.calls.map(c => ({ functionCall: { name: c.name, args: c.input } })));
        out.push({ role: 'model', parts: parts.length ? parts : [{ text: '(no reply)' }] });
      } else if (h.role === 'tool') {
        out.push({ role: 'user', parts: h.results.map(r => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.text } : { result: r.text } } })) });
      }
    });
    return out;
  }
  async function geminiTurn(job, onText) {
    const model = settings.model.gemini;
    const body = {
      systemInstruction: { parts: [{ text: job.system }] },
      contents: geminiContents(job.history),
      tools: [{ functionDeclarations: TOOLS.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema })) }],
      generationConfig: { maxOutputTokens: 32768 }
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': keyFor('gemini') }, body: JSON.stringify(body), signal: job.abort.signal
    });
    if (!res.ok) throw await apiError(res, 'Gemini');
    const parts = [];
    let finish = null, blocked = null;
    await readSSE(res, ev => {
      if (ev.error) throw new Error('Gemini: ' + (ev.error.message || 'stream error'));
      if (ev.promptFeedback && ev.promptFeedback.blockReason) blocked = ev.promptFeedback.blockReason;
      const c = ev.candidates && ev.candidates[0];
      if (!c) return;
      if (c.finishReason) finish = c.finishReason;
      ((c.content && c.content.parts) || []).forEach(p => {
        const last = parts[parts.length - 1];
        if (typeof p.text === 'string' && !p.thought && !p.functionCall && last && typeof last.text === 'string' && !last.thought) {
          last.text += p.text;                             // streamed text arrives in pieces: keep one part
          if (p.thoughtSignature) last.thoughtSignature = p.thoughtSignature;
        } else parts.push(clone(p));
        if (typeof p.text === 'string' && !p.thought) onText(p.text);
      });
    }, job.abort.signal);
    const calls = parts.filter(p => p.functionCall).map((p, i) => ({ id: 'g' + Date.now().toString(36) + i, name: p.functionCall.name, input: p.functionCall.args || {} }));
    return {
      raw: parts, stop: blocked || (finish && /SAFETY|PROHIBITED|BLOCK/.test(finish)) ? 'refusal' : calls.length ? 'tools' : finish === 'MAX_TOKENS' ? 'max_tokens' : 'end',
      text: parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join(''), calls
    };
  }

  // model lists straight from the provider (so new models show up without a studio update)
  async function listModels(p) {
    const key = keyFor(p);
    if (!key) return null;
    if (p === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' } });
      if (!res.ok) throw await apiError(res, 'Claude');
      const j = await res.json();
      return (j.data || []).map(m => [m.id, m.display_name || m.id]);
    }
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await apiError(res, 'Gemini');
    const j = await res.json();
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !/tts|image|embedding|live|audio|transcribe|translate|robotics/.test(m.name))
      .map(m => [m.name.replace(/^models\//, ''), m.displayName || m.name]);
  }

  /* ------------------------------------------------------------ tiny markdown */
  function md(s, esc) {
    const parts = String(s).split(/```[\w-]*\n?/);
    return parts.map((p, i) => i % 2 ? `<pre class="ai-code">${esc(p.replace(/\n$/, ''))}</pre>` : esc(p)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,4} (.+)$/gm, '<b>$1</b>')
      .replace(/^\s*[-*] (.+)$/gm, '• $1')
      .replace(/\n/g, '<br>')).join('');
  }

  /* ------------------------------------------------------------ UI */
  function init(ctx) {
    const { $, escapeHtml: esc, toast } = ctx;
    const el = { log: $('aiLog'), input: $('aiInput'), send: $('aiSend'), prov: $('aiProvider'), model: $('aiModel'), setup: $('aiSetup'), status: $('aiStatus') };
    let history = [];      // provider-neutral conversation
    let job = null;        // the running request
    let proposal = null;   // {ws, base, changes, tilesBefore, mapCount}
    let undoSnap = null;   // serialized cart from before the last apply
    let system = null;

    function scroll() { el.log.scrollTop = el.log.scrollHeight; }
    function add(cls, html) { const d = document.createElement('div'); d.className = 'ai-msg ' + cls; d.innerHTML = html; el.log.appendChild(d); scroll(); return d; }

    function fillModels(extra) {
      const p = settings.provider, cur = settings.model[p];
      const opts = (extra && extra.length ? extra : PROVIDERS[p].models).slice();
      if (!opts.some(o => o[0] === cur)) opts.unshift([cur, cur]);
      el.model.innerHTML = opts.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
      el.model.value = cur;
    }
    function refreshHeader() {
      el.prov.value = settings.provider;
      fillModels();
      const has = !!keyFor(settings.provider);
      el.setup.hidden = has;
      el.input.disabled = !has;
      el.input.placeholder = has ? `Ask ${PROVIDERS[settings.provider].label} to make or change something… (Enter sends, Shift+Enter new line)` : 'Add an API key first';
      if (!has) renderSetup();
    }
    function renderSetup() {
      const p = PROVIDERS[settings.provider];
      el.setup.innerHTML = `<b>Connect ${p.label}</b>
        <p>BitKit has no server, so the studio talks to ${p.by} directly with your own API key. The key is kept only in this browser and is sent only to ${p.by}. Usage is billed to your ${p.by} API account.</p>
        <p class="dim small">A ${p.label} app subscription (like ${settings.provider === 'claude' ? 'Claude Pro or Max' : 'Gemini Advanced / Google AI Pro'}) can't be used here: those plans don't include API access for other apps. You need an API key: <a href="${p.keyUrl}" target="_blank" rel="noopener">get one here</a>${settings.provider === 'gemini' ? ' (there is a free tier)' : ''}.</p>
        <div class="ai-keyrow"><input type="password" id="aiKey" placeholder="${p.keyHint}" autocomplete="off" spellcheck="false"><button id="aiKeySave" class="primary">Save key</button></div>
        <label class="chk small"><input type="checkbox" id="aiRemember" ${settings.remember ? 'checked' : ''}> Remember on this computer (otherwise it is forgotten when you close the tab)</label>`;
      $('aiKeySave').onclick = () => {
        const k = $('aiKey').value.trim();
        if (!k) return toast('Paste a key first');
        memKeys[settings.provider] = k; settings.remember = $('aiRemember').checked; saveSettings();
        refreshHeader(); el.input.focus();
        toast(`${p.label} connected`);
        listModels(settings.provider).then(fillModels).catch(e => add('ai-err', esc(e.message)));
      };
    }
    function openSettings() {
      const rows = Object.entries(PROVIDERS).map(([id, p]) => `<p><b>${p.label}</b> <span class="dim">${keyFor(id) ? 'key saved' : 'no key'}</span>
        <input type="password" id="aiK_${id}" placeholder="${keyFor(id) ? '••••••••' + esc(keyFor(id).slice(-4)) : p.keyHint}" autocomplete="off" style="width:100%">
        <a class="small" href="${p.keyUrl}" target="_blank" rel="noopener">Get a ${p.label} API key</a></p>`).join('');
      ctx.modal('AI settings', `<p class="dim">Keys stay in this browser and are only sent to Anthropic (Claude) or Google (Gemini). Leave a box empty to keep the saved key.</p>${rows}
        <p><label class="chk"><input type="checkbox" id="aiRem" ${settings.remember ? 'checked' : ''}> Remember keys on this computer</label></p>
        <p><label class="chk"><input type="checkbox" id="aiAuto" ${settings.autoApply ? 'checked' : ''}> Apply AI changes right away (you can still undo)</label></p>`, [
        ['Forget all keys', () => { memKeys.claude = memKeys.gemini = ''; saveSettings(); ctx.closeModal(); refreshHeader(); toast('Keys removed'); }, 'danger'],
        ['Save', () => {
          Object.keys(PROVIDERS).forEach(id => { const v = $('aiK_' + id).value.trim(); if (v) memKeys[id] = v; });
          settings.remember = $('aiRem').checked; settings.autoApply = $('aiAuto').checked;
          saveSettings(); ctx.closeModal(); refreshHeader();
        }, 'primary']]);
    }

    el.prov.onchange = () => { settings.provider = el.prov.value; saveSettings(); refreshHeader(); if (keyFor(settings.provider)) listModels(settings.provider).then(fillModels).catch(() => {}); };
    el.model.onchange = () => { settings.model[settings.provider] = el.model.value; saveSettings(); };
    $('aiSettings').onclick = openSettings;
    $('aiNew').onclick = () => {
      if (job) return;
      history = []; el.log.innerHTML = '';
      if (proposal) { proposal = null; }
      welcome();
    };
    el.send.onclick = () => job ? stopJob() : send();
    el.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (!job) send(); }
    });
    function welcome() {
      add('ai-sys', `<b>Make games with AI.</b> Ask for things like <i>"add a coin the player can collect"</i>, <i>"draw a 16x16 slime and make it patrol"</i> or <i>"why does my player fall through the floor?"</i>. The AI can read and change your code, sprites, maps and entities. You review its changes before they go into your cart.`);
    }

    function stopJob() { if (job) job.abort.abort(); }
    function busy(on) {
      el.send.textContent = on ? '■ Stop' : 'Send';
      el.send.classList.toggle('primary', !on);
      el.status.textContent = on ? 'thinking…' : '';
    }

    const TOOL_LABEL = {
      read_code: 'Reading the code', edit_code: 'Editing the code', write_code: 'Writing the code', read_entities: 'Looking at entities',
      set_entity: 'Making an entity', set_effect: 'Making an effect', set_cutscene: 'Making a cutscene', delete: 'Deleting', read_sprite: 'Looking at a sprite',
      draw_sprite: 'Drawing a sprite', read_map: 'Looking at the map', set_map: 'Building the map', fill_map: 'Filling the map', place_entity: 'Placing an entity',
      remove_entities: 'Removing entities', set_level: 'Setting up a level', read_palette: 'Checking colours', test_game: 'Testing the game', set_cart_name: 'Renaming the cart'
    };

    async function send() {
      const text = el.input.value.trim();
      if (!text || !keyFor(settings.provider)) return;
      el.input.value = '';
      add('ai-user', esc(text).replace(/\n/g, '<br>'));
      if (!proposal) proposal = { ws: ctx.workspace(), base: ctx.signature(), changes: [], mapCount: {}, tilesBefore: null, shots: [] };
      system = system || systemPrompt(ctx);
      const startLen = history.length;
      history.push({ role: 'user', text: overview(proposal.ws, proposal.changes.length) + '\n\n' + text });
      job = { abort: new AbortController(), history, system, ws: proposal.ws, changes: proposal.changes, mapCount: proposal.mapCount, shots: proposal.shots };
      Object.defineProperty(job, 'tilesBefore', { get: () => proposal.tilesBefore, set: v => { proposal.tilesBefore = v; } });
      busy(true);
      const provider = settings.provider, before = proposal.changes.length;
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const bubble = add('ai-bot', '<span class="dim">…</span>');
          let shown = '';
          const r = await (provider === 'claude' ? claudeTurn : geminiTurn)(job, t => { shown += t; bubble.innerHTML = md(shown, esc); scroll(); });
          if (!shown.trim()) bubble.remove();
          history.push({ role: 'assistant', provider, raw: r.raw, text: r.text, calls: r.calls.map(c => ({ id: c.id, name: c.name, input: c.input })) });
          if (r.stop === 'refusal') { add('ai-err', `${PROVIDERS[provider].label} declined to answer that. Try asking in a different way.`); break; }
          if (r.stop === 'max_tokens' && !r.calls.length) { add('ai-sys', 'The reply was cut off because it got too long. Say "go on" to continue.'); break; }
          if (!r.calls.length) break;
          const results = r.calls.map(c => {
            const line = add('ai-tool', `<span class="ai-spin"></span> ${esc(TOOL_LABEL[c.name] || c.name)}…`);
            try {
              if (c.bad) throw new Error('The tool input was not valid JSON (maybe cut off). Send smaller pieces.');
              const out = runTool(c.name, c.input || {}, job, ctx);
              const res = typeof out === 'string' ? { text: out } : out;
              line.innerHTML = `✓ ${esc(toolDone(c))}`;
              if (res.png) { const img = new Image(); img.src = res.png; img.className = 'ai-shot'; img.title = 'What the game looked like at the end of the test'; line.appendChild(img); scroll(); }
              return { id: c.id, name: c.name, text: res.text, png: provider === 'claude' ? res.png : null };
            } catch (e) {
              line.innerHTML = `⚠ ${esc(TOOL_LABEL[c.name] || c.name)}: <span class="dim">${esc(e.message)}</span>`;
              return { id: c.id, name: c.name, text: 'Error: ' + e.message, isError: true };
            }
          });
          history.push({ role: 'tool', results });
          if (round === MAX_ROUNDS - 1) add('ai-sys', 'Stopped after many steps. Say "go on" if it should keep working.');
        }
      } catch (e) {
        if (e.name === 'AbortError') add('ai-sys', 'Stopped.');
        else add('ai-err', esc(e.message || String(e)));
        // keep the conversation well formed for the next message: this message, then a short note in place of the unfinished reply
        const mine = history[startLen];
        history.length = startLen;
        history.push(mine, { role: 'assistant', provider: null, text: '(I was interrupted before I finished. Changes I made so far are still in the proposal.)', calls: [] });
      } finally {
        job = null; busy(false);
        if (proposal && proposal.changes.length > before) showProposal();
        else if (proposal && !proposal.changes.length) proposal = null;
      }
    }
    function toolDone(c) {
      const i = c.input || {};
      switch (c.name) {
        case 'read_code': return i.start_line ? `Read code lines ${i.start_line}-${i.end_line || 'end'}` : 'Read the code';
        case 'draw_sprite': return `Drew sprite ${i.tile}`;
        case 'set_entity': return `Set up entity "${(i.entity || {}).name}"`;
        case 'place_entity': return `Placed ${i.type} on level ${i.level}`;
        case 'test_game': return `Tested the game for ${i.frames || 120} frames`;
        default: return (TOOL_LABEL[c.name] || c.name).replace(/^(\w+)ing\b/, m => ({ Reading: 'Read', Editing: 'Edited', Writing: 'Wrote', Looking: 'Looked', Making: 'Made', Deleting: 'Deleted', Drawing: 'Drew', Building: 'Built', Filling: 'Filled', Placing: 'Placed', Removing: 'Removed', Setting: 'Set', Checking: 'Checked', Testing: 'Tested', Renaming: 'Renamed' }[m] || m));
      }
    }

    // ------------------------------------------------------------ review card
    let cardEl = null;
    function showProposal() {
      if (cardEl) cardEl.remove();
      if (settings.autoApply) { apply(false); return; }
      const p = proposal, cur = ctx.workspace();
      const groups = {};
      p.changes.forEach(c => { groups[c.label] = (groups[c.label] || 0) + 1; });
      let html = `<div class="ai-card-head"><b>Proposed changes</b><span class="dim small">${p.changes.length} edit${p.changes.length === 1 ? '' : 's'}</span></div><ul>` +
        Object.entries(groups).filter(([l]) => !/^Edited code|^Rewrote code|^Changed \d+ map|^Drew sprite/.test(l)).map(([l, n]) => `<li>${esc(l)}${n > 1 ? ` ×${n}` : ''}</li>`).join('');
      if (p.ws.code !== cur.code) {
        const d = lineDiff(cur.code, p.ws.code);
        html += `<li>Code: <span class="ai-add">+${d.added}</span> <span class="ai-del">−${d.removed}</span> lines <details><summary>show changes</summary><pre class="ai-diff">` +
          d.lines.map(([k, l]) => `<span class="${k === '+' ? 'ai-add' : k === '-' ? 'ai-del' : 'dim'}">${k} ${esc(l)}</span>`).join('\n') + '</pre></details></li>';
      }
      const tiles = p.tilesBefore ? Object.keys(p.tilesBefore).map(Number).filter(n => { for (let i = 0; i < 64; i++) if (p.ws.tiles[n * 64 + i] !== cur.tiles[n * 64 + i]) return true; return false; }) : [];
      if (tiles.length) html += `<li>Sprites: ${tiles.length} tile${tiles.length === 1 ? '' : 's'} <span class="ai-tiles"></span></li>`;
      const mc = Object.entries(p.mapCount).filter(([, n]) => n);
      if (mc.length) html += `<li>Map: ${mc.map(([l, n]) => `${n} tiles on level ${l}`).join(', ')}</li>`;
      html += `</ul><div class="ai-card-buttons"><button class="primary" data-a="apply">Apply</button><button data-a="run">Apply and run</button><button data-a="discard" class="danger">Discard</button></div>`;
      cardEl = add('ai-card', html);
      const tl = cardEl.querySelector('.ai-tiles');
      if (tl) tiles.slice(0, 32).forEach(n => tl.appendChild(tileCanvas(p.ws, n)));
      cardEl.querySelector('[data-a=apply]').onclick = () => apply(false);
      cardEl.querySelector('[data-a=run]').onclick = () => apply(true);
      cardEl.querySelector('[data-a=discard]').onclick = () => {
        proposal = null; cardEl.querySelector('.ai-card-buttons').innerHTML = '<span class="dim">Discarded.</span>'; cardEl = null;
        history.push({ role: 'user', text: '[Studio] The person discarded your proposed changes; the cart is back to how it was before them.' }, { role: 'assistant', provider: null, text: 'OK, the changes were discarded.', calls: [] });
      };
    }
    function tileCanvas(ws, n) {
      const c = document.createElement('canvas'); c.width = c.height = 8; c.className = 'pix';
      const x = c.getContext('2d'), im = x.createImageData(8, 8);
      for (let i = 0; i < 64; i++) { const k = ws.tiles[n * 64 + i]; im.data.set([ws.palette[k * 3], ws.palette[k * 3 + 1], ws.palette[k * 3 + 2], k ? 255 : 0], i * 4); }
      x.putImageData(im, 0, 0); c.title = 'tile ' + n;
      return c;
    }
    async function apply(andRun) {
      const p = proposal;
      if (!p) return;
      if (ctx.signature() !== p.base && !await ctx.ask('Replace your newer edits?', 'You changed the cart after the AI started. Applying puts the AI\'s version in, which undoes those edits (Undo brings them back).', 'Apply anyway')) return;
      undoSnap = ctx.snapshot();
      ctx.replaceCart(p.ws);
      proposal = null;
      const done = cardEl ? cardEl.querySelector('.ai-card-buttons') : add('ai-card', '<div class="ai-card-buttons"></div>').querySelector('.ai-card-buttons');
      done.innerHTML = '<span class="ai-ok">✓ Applied.</span> <button class="tiny">Undo</button>';
      done.querySelector('button').onclick = () => {
        if (!undoSnap) return;
        ctx.loadSnapshot(undoSnap); undoSnap = null;
        done.innerHTML = '<span class="dim">Undone.</span>';
        history.push({ role: 'user', text: '[Studio] The person undid your last applied changes.' }, { role: 'assistant', provider: null, text: 'OK, those changes were undone.', calls: [] });
      };
      cardEl = null;
      toast('AI changes applied');
      if (andRun) ctx.run();
    }

    refreshHeader();
    welcome();
    if (keyFor(settings.provider)) listModels(settings.provider).then(fillModels).catch(() => {});
    return { focus() { if (!el.input.disabled) el.input.focus(); }, settings, history: () => history };
  }

  return { init, TOOLS, PROVIDERS, systemPrompt, runTool, lineDiff, claudeMessages, geminiContents, md };
})();
