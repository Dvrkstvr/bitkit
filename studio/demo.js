/* Demo cart "Sprout Hop": original art and code. MIT License. */
(function () {
  const code = `-- Sprout Hop: a tiny BitKit demo
-- Move: d-pad / left stick    Jump: A (hold for higher)
-- Run: squeeze R (analog!)    Throw a pebble: B
-- Everything that moves is an entity (see the Entities tab), including you.
-- Stay next to a sapling until it grows into a tree: that's your new checkpoint.
-- Water drops heal you, mud and sticky seeds slow you down.

MAP_W, MAP_H = 160, 30

function _init()
  ENT_WORLD_W, ENT_WORLD_H = MAP_W * 8, MAP_H * 8
  score, total, defeated = 0, #ents_all("drop"), 0
  spawn_x, spawn_y = 24, 160

  -- events sent by entities (their behavior trees use "Send event")
  on("pickup", function() score = score + 1 end)
  on("death", function(e) defeated = defeated + 1; sfx("G5", 3, 0.4, 6) end)
  on("open_door", function()
    if not gate_open then gate_open = true; print("the gate opens!") end
  end)
  on("checkpoint", function(sapling)
    spawn_x, spawn_y = sapling.x + 4, sapling.y + 8
    print("checkpoint! you will respawn at the tree")
  end)

  -- the player is the "sprout" entity
  ents_on("sprout", "hurt", function(p) sfx("A2", 2, 0.6, 14, nil, 0, -300) end)
  ents_on("sprout", "death", function(p)
    p.alive = true                 -- don't die: respawn at the last checkpoint
    p.hp = stat(p, "hp")
    p.x, p.y, p.vx, p.vy = spawn_x, spawn_y, 0, 0
    fx_clear(p)
    p.inv = 60
    sfx("C3", 2, 0.6, 20, nil, 0, -200)
  end)
end

function _update()
  ents_update()
end

function _draw()
  cls(21)
  local cx = ents_camera()       -- follow the player
  camera()
  for i = 0, 6 do                -- parallax clouds
    local x = (i * 97 - cx // 3) % 400 - 40
    local y = 20 + (i * 37) % 60
    circfill(x, y, 10, 23) circfill(x + 12, y + 2, 8, 23) circfill(x - 10, y + 3, 7, 23)
  end
  camera(cx, 0)
  map(cx // 8, 0, 41, 30, (cx // 8) * 8, 0)
  ents_draw()
  camera()
  hud()
end

function hud()
  rectfill(0, 0, 320, 12, 1)
  for i = 1, stat(PLAYER, "hp") do
    spr(i <= PLAYER.hp and 23 or 24, 4 + (i - 1) * 9, 2)
  end
  spr(3, 44, 2)
  text(score .. "/" .. total, 54, 2, 13)
  text("x" .. defeated, 110, 2, 26)
  if fx_has(PLAYER, "slow") then text("SLOW", 150, 2, 22) end
  text("L", 200, 2, 29) bar(210, 3, press("l"))
  text("R", 258, 2, 29) bar(268, 3, press("r"))
  if score == total and total > 0 then
    text("ALL DROPS! THE GARDEN BLOOMS", 48, 110, 27)
  end
end

function bar(x, y, v)
  rect(x, y, 44, 6, 29)
  rectfill(x + 1, y + 1, v * 42 // 255, 4, 17)
end
`;

  // Pixel art: one char per pixel, mapped to palette indices.
  const K = { '.': 0, k: 1, g: 16, G: 17, d: 15, y: 18, b: 22, B: 21, w: 13, c: 12, n: 8, N: 7,
              o: 9, O: 10, r: 26, R: 25, Y: 27, s: 29, S: 28, p: 5, P: 4 };
  const ART = {
    1: ['..g..Gg.', '..gGdG..', '....d...', '..kkkk..', '.kcccck.', '.kckkck.', '.kcccck.', '..k..k..'],
    2: ['.g..Gg..', '..gGdG..', '....d...', '..kkkk..', '.kcccck.', '.kckkck.', '.kcccck.', '...kk...'],
    3: ['...B....', '..BB....', '..BbB...', '.BbbwB..', '.BbbbB..', '.BbbbB..', '..BBB...', '........'],
    16: ['gGgGgggG', 'GdGdGGdG', 'dndndndn', 'nNnnNnnn', 'nnnNnnNn', 'NnnnnNnn', 'nnNnnnnN', 'nNnnNnnn'],
    17: ['nnnNnnnn', 'nNnnnnNn', 'nnnnNnnn', 'Nnnnnnnn', 'nnnNnnNn', 'nNnnnnnn', 'nnnnnNnn', 'NnnNnnnN'],
    18: ['OoooNOoo', 'oooONooo', 'NNNNNNNN', 'ooNOoooo', 'oONooooO', 'NNNNNNNN', 'OoooNOoo', 'oooONooo'],
    19: ['........', '..r.r...', '...Y....', '..r.r...', '...g....', '..gg....', '...g.g..', '...gg...'],
    20: ['........', '........', '...p....', '..pYp...', '...p....', '...g....', '..ggg...', '...g....'],
    4: ['........', '......k.', '.....k.k', '..pppp..', '.pPPPPp.', 'pPPPPPPp', 'pppppppp', '........'],
    5: ['........', '.......k', '......k.', '.pppppp.', 'pPPPPPPp', 'pPPPPPPp', 'pppppppp', '........'],
    6: ['.ww.ww..', '.wwwww..', '..YkYk..', '.YkYkYk.', '.YkYkYk.', '..YkYk..', '...k.k..', '........'],
    7: ['........', '.wwwww..', '.YkYkYk.', '.YkYkYk.', '.YkYkYk.', '..YkYk..', '...k.k..', '........'],
    8: ['...SS...', '..SSSS..', '..ckck..', '..cccc..', '.GGGGGG.', 'GGgGGgGG', '.GGGGGG.', '..c..c..'],
    9: ['...SS...', '..SSSS..', '..cccc..', '..cccc..', '.GGGGGG.', 'GGgGGgGG', '.GGGGGG.', '..c..c..'],
    10: ['..rrr...', '.rYYYr..', '.rYkYr..', '.rYYYr..', '..rrr...', '...g....', '.gGg....', '..gg....'],
    11: ['........', '........', '...nn...', '..nNNn..', '..nNNn..', '...nn...', '........', '........'],
    12: ['........', '........', '........', '...rr...', '..rrrr..', '.RrrrrR.', 'SSSSSSSS', 'ssssssss'],
    13: ['........', '........', '........', '........', '........', '.RRRRRR.', 'SSSSSSSS', 'ssssssss'],
    14: ['SSSSSSSS', 's.s.s.s.', 's.s.s.s.', 's.s.s.s.', 'SSSSSSSS', 's.s.s.s.', 's.s.s.s.', 's.s.s.s.'],
    15: ['........', '........', '...ss...', '..sSSs..', '..sSSs..', '...ss...', '........', '........'],
    22: ['........', '........', '........', '........', '........', '..NNNN..', '.NnNNnN.', 'NNNNNNNN'],
    23: ['........', '.rr.rr..', 'rwrrrrr.', 'rrrrrrr.', '.rrrrr..', '..rrr...', '...r....', '........'],
    24: ['........', '.SS.SS..', 'S..S..S.', 'S.....S.', '.S...S..', '..S.S...', '...S....', '........'],
    21: ['........', '...s....', '..sSs...', '.sSSSs..', 'sSSSSSs.', 'SSSSSSSS', '........', '........'],
  };

  // 16x16 pictures, stored as 2x2 tiles starting at the given tile
  const BIG = {
    40: ['', '', '', '', '', '', '', '.......g', '......gGg', '.....gG.Gg', '.......d', '.......d', '.......d',
         '.....nnNnn', '....nNnnnNn', '...nnnnnnnnn'],
    42: ['', '', '', '', '.......gg', '.....ggGGg', '....gGGgGGg', '.....gGdGg', '.......d', '......dd', '.......d',
         '.......d', '.......d', '.....nnNnn', '....nNnnnNn', '...nnnnnnnnn'],
    44: ['.....gGGGg', '...gGGgGGGGg', '..gGGGGGgGGGg', '.gGgGGGGGGGgGg', '.gGGGGGrGGGGGg', '..gGGgGGGGGgg', '...ggGGGrGGg',
         '.....gGGGg', '.......NN', '.......NN', '......NNN', '.......NN', '.......NN', '.....nnNNn', '....nNnnnNn', '...nnnnnnnnn'],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => { cart.tiles[n * 64 + y * 8 + x] = K[ch] ?? 0; }));
    for (const [n, rows] of Object.entries(BIG))
      rows.forEach((row, y) => [...row.padEnd(16, '.')].slice(0, 16).forEach((ch, x) => {
        const t = +n + (y >> 3) * 16 + (x >> 3);
        cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
      }));
    cart.flags[16] = 1; cart.flags[17] = 1; cart.flags[18] = 1; cart.flags[14] = 1;

    const W = 256, MW = 160;
    const set = (x, y, t) => { if (x >= 0 && x < MW && y >= 0 && y < 30) cart.map[y * W + x] = t; };
    const drops = [];
    const drop = (x, y) => drops.push([x, y]);
    // deterministic little terrain generator
    let s = 7;
    const r = n => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
    let h = 24;
    const heights = [];
    for (let x = 0; x < MW; x++) {
      if (x > 8 && x % 9 === 0) h = Math.max(20, Math.min(26, h + r(5) - 2));
      const gap = x > 12 && x < MW - 6 && (x % 23 === 0 || x % 23 === 1 || x % 37 === 2);
      heights[x] = gap ? -1 : h;
      if (!gap) {
        set(x, h, 16);
        for (let y = h + 1; y < 30; y++) set(x, y, 17);
        const d = r(10);
        if (d === 0) set(x, h - 1, 19); else if (d === 1) set(x, h - 1, 20); else if (d === 2) set(x, h - 1, 21);
      } else if (x % 23 === 0) {
        drop(x, h - 3);
      }
      if (x > 6 && x % 13 === 5) {
        const py = h - 4 - r(3), len = 3 + r(3);
        for (let i = 0; i < len; i++) set(x + i, py, 18);
        drop(x + 1, py - 1);
        if (len > 4) drop(x + 3, py - 1);
      }
    }
    drop(MW - 3, 21);

    // a flat yard with a gate (solid tiles 14) and a pressure button in front of it
    const H = 24;
    const flatten = (x0, x1, hh) => {
      for (let x = x0; x <= x1; x++) {
        for (let y = 0; y < 30; y++) set(x, y, 0);
        set(x, hh, 16);
        for (let y = hh + 1; y < 30; y++) set(x, y, 17);
        heights[x] = hh;
      }
      for (let i = drops.length - 1; i >= 0; i--) if (drops[i][0] >= x0 && drops[i][0] <= x1) drops.splice(i, 1);
    };
    flatten(70, 88, H);
    flatten(38, 44, heights[37] > 0 ? heights[37] : 23);
    for (let y = H - 4; y < H; y++) set(82, y, 14);
    for (let y = H - 9; y < H - 4; y++) set(82, y, 18);
    drop(79, H - 1); drop(80, H - 1);

    // entities
    const N = (t, p, c) => { const n = { t, p: p || {} }; if (c) n.c = c; return n; };
    const A = (name, frames, speed) => ({ name, frames, speed: speed || 8 });
    const base = { sw: 1, sh: 1, grav: true, collide: true, left: false, hp: 1, inset: 0, team: 'enemy', damage: 1, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [{ name: 'speed', value: 1 }, { name: 'jump', value: 1 }] };
    cart.entities = { effects: [
      { name: 'heal', dur: 0, stack: 'refresh', hp: 1, every: 0, tick: 0, tint: -1, mods: [] },
      { name: 'slow', dur: 120, stack: 'refresh', hp: 0, every: 0, tick: 0, tint: 22, mods: [{ stat: 'speed', op: 'mul', value: 0.5 }, { stat: 'jump', op: 'mul', value: 0.8 }] },
    ], types: [
      Object.assign({}, base, { name: 'sprout', player: true, team: 'friend', hp: 3, damage: 0, inset: 1, hurt: 60,
        anims: [A('idle', [1]), A('walk', [1, 2], 6), A('jump', [2])],
        tree: N('all', {}, [
          N('controls', { speed: 1, jump: 4.2, run: 'r', sound: 'C5' }),
          N('sequence', {}, [N('button', { button: 'b', mode: 'pressed' }), N('count_below', { count: 3, type: 'pebble' }),
            N('shoot', { type: 'pebble', speed: 3.5, aim: false }), N('sound', { note: 'A5', wave: 1, vol: 0.3 })])]) }),
      Object.assign({}, base, { name: 'drop', grav: false, collide: false, hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [3])],
        tree: N('sequence', {}, [N('touching', { what: 'player' }), N('apply_touching', { effect: 'heal', what: 'player' }),
          N('emit', { event: 'pickup' }), N('sound', { note: 'E6', wave: 4 }), N('remove')]) }),
      Object.assign({}, base, { name: 'mud', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [22])],
        tree: N('sequence', {}, [N('touching', { what: 'player' }), N('apply_touching', { effect: 'slow', what: 'player' })]) }),
      Object.assign({}, base, { name: 'sapling', sw: 2, sh: 2, hp: 0, team: 'neutral', damage: 0,
        anims: [A('idle', [40]), A('growing', [40, 42], 15), A('grown', [44])],
        tree: N('selector', {}, [
          N('sequence', {}, [N('is', { key: 'state', value: 'grown' }), N('anim', { name: 'grown' })]),
          N('sequence', {}, [N('circle', { what: 'player', radius: 28 }), N('all', {}, [
            N('anim', { name: 'growing' }),
            N('say', { text: 'Protect me!' }),
            N('sequence', {}, [N('every', { frames: 120 }), N('count_below', { count: 7, type: 'bee' }), N('spawn', { type: 'bee', dx: -72, dy: -48 })]),
            N('sequence', {}, [N('every', { frames: 170 }), N('count_below', { count: 7, type: 'bee' }), N('spawn', { type: 'bee', dx: 80, dy: -56 })]),
            N('sequence', {}, [N('count_up', { max: 360, key: 'grow', bar: true }), N('set', { key: 'state', value: 'grown' }),
              N('emit', { event: 'checkpoint' }), N('sound', { note: 'C6', wave: 4 })])])]),
          N('anim', { name: 'idle' })]) }),
      Object.assign({}, base, { name: 'slug', hp: 2, inset: 1, stomp: true, anims: [A('idle', [4]), A('walk', [4, 5], 10)],
        tree: N('selector', {}, [N('patrol', { speed: 0.4 })]) }),
      Object.assign({}, base, { name: 'bee', grav: false, stomp: true, anims: [A('idle', [6, 7], 4)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 80 }), N('chase', { speed: 0.7 })]), N('hover', { height: 10, speed: 0.06 })]) }),
      Object.assign({}, base, { name: 'flower', hp: 3, anims: [A('idle', [10])],
        tree: N('sequence', {}, [N('face_player'), N('ray', { what: 'player', dir: 'player', len: 140 }), N('every', { frames: 100 }), N('shoot', { type: 'seed', speed: 1.4, aim: false })]) }),
      Object.assign({}, base, { name: 'seed', grav: false, inset: 2, damage: 0, touch_fx: 'slow', anims: [A('idle', [11])], tree: null }),
      Object.assign({}, base, { name: 'pebble', grav: false, inset: 2, team: 'friend', anims: [A('idle', [15])], tree: null }),
      Object.assign({}, base, { name: 'sage', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [8, 8, 8, 8, 8, 9], 10)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 40 }), N('face_player'), N('say', { text: 'B throws pebbles!' })]), N('wander', { speed: 0.2, turn: 8 })]) }),
      Object.assign({}, base, { name: 'guide', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [8, 8, 8, 8, 8, 9], 10)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 40 }), N('face_player'), N('say', { text: 'Step on the button' })]), N('stop')]) }),
      Object.assign({}, base, { name: 'button', hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, anims: [A('idle', [12]), A('pressed', [13])],
        tree: N('selector', {}, [N('sequence', {}, [N('touching', { what: 'player' }), N('anim', { name: 'pressed' }), N('emit', { event: 'open_door' })]), N('anim', { name: 'idle' })]) }),
      Object.assign({}, base, { name: 'gate', sh: 4, hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, hidden: true, anims: [A('idle', [14])],
        tree: N('sequence', {}, [N('heard', { event: 'open_door' }), N('set_tile', { dx: 0, dy: 1, tile: 0 }), N('set_tile', { dx: 0, dy: 0, tile: 0 }),
          N('set_tile', { dx: 0, dy: -1, tile: 0 }), N('set_tile', { dx: 0, dy: -2, tile: 0 }), N('sound', { note: 'C4', wave: 1 }), N('remove')]) }),
    ], placed: [] };
    const place = (type, col, up, sh) => {
      const g = heights[col]; if (g === undefined || g < 0) return;
      cart.entities.placed.push({ type, x: col * 8, y: (g - (sh || 1) - (up || 0)) * 8 });
    };
    place('sprout', 3);
    place('sage', 6);
    drops.forEach(([x, y]) => cart.entities.placed.push({ type: 'drop', x: x * 8, y: y * 8 }));
    [30, 100, 134].forEach(c => place('mud', c));
    place('sapling', 40, 0, 2); place('sapling', 86, 0, 2);
    [24, 47, 64, 98, 128, 146].forEach(c => place('slug', c));
    [36, 90, 118, 140].forEach(c => place('bee', c, 7));
    [58, 112].forEach(c => place('flower', c));
    place('guide', 73); place('button', 77); place('gate', 82, 0, 4);
  }

  window.BK_DEMO = { name: 'Sprout Hop', code, buildGfx };
})();
