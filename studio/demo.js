/* Demo cart "Sprout Hop": original art and code. MIT License. */
(function () {
  const code = `-- Sprout Hop: a tiny BitKit demo
-- Move: d-pad / left stick    Jump: A (hold for higher)
-- Run: squeeze R (analog!)    Throw a pebble: B
-- Stomp or pelt the critters, step on the red button to open the gate,
-- and collect the water drops. Enemies are made on the Entities tab.

SOLID = 0          -- sprite flag 0 = solid ground
DROP = 3           -- tile number of a water drop
MAP_W, MAP_H = 160, 30

function _init()
  p = {x = 24, y = 120, vx = 0, vy = 0, ry = 0, flip = false,
       ground = false, coyote = 0, jbuf = 0, inv = 0}
  score, total, stomps, gate_open = 0, 0, 0, false
  for y = 0, MAP_H - 1 do
    for x = 0, MAP_W - 1 do
      if mget(x, y) == DROP then total = total + 1 end
    end
  end

  -- events: entities tell us when they hurt the player or die
  on("player_hurt", function(damage, by)
    if p.inv > 0 then return end
    p.inv = 60
    p.vy = -2.5
    p.knock = by.x < p.x and 2 or -2
    sfx("A2", 2, 0.6, 14, nil, 0, -300)
  end)
  on("death", function(e)
    stomps = stomps + 1
    sfx("G5", 3, 0.4, 6)
  end)
  -- the button sends "open_door" every frame it is pressed; react only once
  on("open_door", function()
    if not gate_open then gate_open = true; print("the gate opens!") end
  end)
end

function solid(x, y)
  return fget(mget(x // 8, y // 8), SOLID)
end

function hits(x, y)
  -- hitbox: 6x7 pixels inside the 8x8 sprite
  return solid(x + 1, y + 1) or solid(x + 6, y + 1)
      or solid(x + 1, y + 7) or solid(x + 6, y + 7)
end

function _update()
  -- analog run: press("r") is 0..255, so speed goes from 1 to 3
  local speed = 1 + press("r") / 128
  local dir = 0
  if btn("left") then dir = -1; p.flip = true end
  if btn("right") then dir = 1; p.flip = false end
  p.vx = dir * speed
  if p.knock then p.vx = p.knock; p.knock = p.inv > 45 and p.knock or nil end
  if p.inv > 0 then p.inv = p.inv - 1 end

  -- move x one pixel at a time so we never pass through walls
  local step = p.vx > 0 and 1 or -1
  for i = 1, math.floor(math.abs(p.vx) + 0.5) do
    if hits(p.x + step, p.y) then break end
    p.x = p.x + step
  end

  -- "ground" = there is solid floor 1px below us (checked every frame)
  p.ground = hits(p.x, p.y + 1)
  if p.ground then p.coyote = 6 elseif p.coyote > 0 then p.coyote = p.coyote - 1 end
  -- remember a jump press for a few frames, so pressing slightly early still works
  if btnp("a") then p.jbuf = 6 elseif p.jbuf > 0 then p.jbuf = p.jbuf - 1 end
  if p.jbuf > 0 and p.coyote > 0 then
    p.vy = -4.2
    p.jbuf, p.coyote = 0, 0
    sfx("C5", 5, 0.5, 10, nil, 0, 600)
  elseif p.ground and p.vy > 0 then
    p.vy = 0
  else
    p.vy = math.min(p.vy + 0.25, 4)
  end
  if not btn("a") and p.vy < -1.5 then p.vy = -1.5 end

  -- move y with sub-pixel precision, stopping at floors and ceilings
  p.ry = p.ry + p.vy
  local n = math.floor(math.abs(p.ry))
  local stepy = p.ry > 0 and 1 or -1
  for i = 1, n do
    if hits(p.x, p.y + stepy) then p.vy, p.ry = 0, 0 break end
    p.y = p.y + stepy
    p.ry = p.ry - stepy
  end

  -- stomp: falling onto an enemy's head damages it and bounces us up
  if p.vy > 0 then
    for _, e in ipairs(ents_touch(p.x + 1, p.y + 5, 6, 3)) do
      if e.team == "enemy" and p.y + 4 < e.y then
        ents_damage(e, 1)
        p.vy, p.ry = -3.5, 0
        sfx("E5", 5, 0.5, 6)
      end
    end
  end

  -- B throws a pebble (an entity with touch damage, on our team)
  if btnp("b") and #ents_all("pebble") < 3 then
    local s = ents_spawn("pebble", p.x, p.y)
    s.proj, s.pvx, s.pvy = true, p.flip and -3.5 or 3.5, 0
    sfx("A5", 1, 0.3, 4)
  end

  -- let the entities think: they need to know where we are
  ents_player(p.x + 1, p.y + 1, 6, 7)
  ents_update()

  -- pick up drops
  local tx, ty = (p.x + 4) // 8, (p.y + 4) // 8
  if mget(tx, ty) == DROP then
    mset(tx, ty, 0)
    score = score + 1
    sfx("E6", 4, 0.6, 6)
    sfx("B6", 4, 0.4, 8)
  end

  -- fell off the world
  if p.y > MAP_H * 8 then
    p.x, p.y, p.vy, p.ry = 24, 120, 0, 0
    sfx("C3", 2, 0.6, 20, nil, 0, -200)
  end
end

function _draw()
  cls(21)
  -- parallax clouds
  local cx = math.max(0, math.min(p.x - 156, MAP_W * 8 - 320))
  for i = 0, 6 do
    local x = (i * 97 - cx // 3) % 400 - 40
    local y = 20 + (i * 37) % 60
    circfill(x, y, 10, 23) circfill(x + 12, y + 2, 8, 23) circfill(x - 10, y + 3, 7, 23)
  end

  camera(cx, 0)
  map(cx // 8, 0, 41, 30, (cx // 8) * 8, 0)
  ents_draw()
  local frame = (math.abs(p.vx) > 0 and (t() // 6) % 2 == 1) and 2 or 1
  if p.inv % 4 < 2 then spr(frame, p.x, p.y, 1, 1, p.flip) end
  camera()

  -- HUD
  rectfill(0, 0, 320, 12, 1)
  spr(DROP, 4, 2)
  text(score .. "/" .. total, 14, 2, 13)
  text("x" .. stomps, 80, 2, 26)
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
    21: ['........', '...s....', '..sSs...', '.sSSSs..', 'sSSSSSs.', 'SSSSSSSS', '........', '........'],
  };

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    for (const [n, rows] of Object.entries(ART))
      rows.forEach((row, y) => [...row].forEach((ch, x) => { cart.tiles[n * 64 + y * 8 + x] = K[ch] ?? 0; }));
    cart.flags[16] = 1; cart.flags[17] = 1; cart.flags[18] = 1; cart.flags[14] = 1;

    const W = 256, MW = 160;
    const set = (x, y, t) => { if (x >= 0 && x < MW && y >= 0 && y < 30) cart.map[y * W + x] = t; };
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
        set(x, h - 3, 3);
      }
      if (x > 6 && x % 13 === 5) {
        const py = h - 4 - r(3), len = 3 + r(3);
        for (let i = 0; i < len; i++) set(x + i, py, 18);
        set(x + 1, py - 1, 3);
        if (len > 4) set(x + 3, py - 1, 3);
      }
    }
    set(MW - 3, 21, 3);

    // a flat yard with a gate (solid tiles 14) and a pressure button in front of it
    const H = 24;
    for (let x = 70; x <= 86; x++) {
      for (let y = 0; y < 30; y++) set(x, y, 0);
      set(x, H, 16);
      for (let y = H + 1; y < 30; y++) set(x, y, 17);
      heights[x] = H;
    }
    for (let y = H - 4; y < H; y++) set(82, y, 14);
    for (let y = H - 9; y < H - 4; y++) set(82, y, 18);
    set(84, H - 1, 3); set(85, H - 1, 3);

    // entities
    const N = (t, p, c) => { const n = { t, p: p || {} }; if (c) n.c = c; return n; };
    const A = (name, frames, speed) => ({ name, frames, speed: speed || 8 });
    const base = { sw: 1, sh: 1, grav: true, collide: true, left: false, hp: 1, inset: 0, team: 'enemy', damage: 1, hidden: false };
    cart.entities = { types: [
      Object.assign({}, base, { name: 'slug', hp: 2, inset: 1, anims: [A('idle', [4]), A('walk', [4, 5], 10)],
        tree: N('selector', {}, [N('patrol', { speed: 0.4 })]) }),
      Object.assign({}, base, { name: 'bee', grav: false, anims: [A('idle', [6, 7], 4)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 80 }), N('chase', { speed: 0.7 })]), N('hover', { height: 10, speed: 0.06 })]) }),
      Object.assign({}, base, { name: 'flower', hp: 3, anims: [A('idle', [10])],
        tree: N('sequence', {}, [N('face_player'), N('ray', { what: 'player', dir: 'player', len: 140 }), N('every', { frames: 100 }), N('shoot', { type: 'seed', speed: 1.4, aim: false })]) }),
      Object.assign({}, base, { name: 'seed', grav: false, inset: 2, anims: [A('idle', [11])], tree: null }),
      Object.assign({}, base, { name: 'pebble', grav: false, inset: 2, team: 'friend', anims: [A('idle', [15])], tree: null }),
      Object.assign({}, base, { name: 'sage', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [8, 8, 8, 8, 8, 9], 10)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 40 }), N('face_player'), N('say', { text: 'B throws pebbles!' })]), N('wander', { speed: 0.2, turn: 8 })]) }),
      Object.assign({}, base, { name: 'guide', hp: 0, team: 'neutral', damage: 0, anims: [A('idle', [8, 8, 8, 8, 8, 9], 10)],
        tree: N('selector', {}, [N('sequence', {}, [N('near', { dist: 40 }), N('face_player'), N('say', { text: 'Step on the button' })]), N('stop')]) }),
      Object.assign({}, base, { name: 'button', hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, anims: [A('idle', [12]), A('pressed', [13])],
        tree: N('selector', {}, [N('sequence', {}, [N('touching', { what: 'any' }), N('anim', { name: 'pressed' }), N('emit', { event: 'open_door' })]), N('anim', { name: 'idle' })]) }),
      Object.assign({}, base, { name: 'gate', sh: 4, hp: 0, team: 'neutral', damage: 0, grav: false, collide: false, hidden: true, anims: [A('idle', [14])],
        tree: N('sequence', {}, [N('heard', { event: 'open_door' }), N('set_tile', { dx: 0, dy: 1, tile: 0 }), N('set_tile', { dx: 0, dy: 0, tile: 0 }),
          N('set_tile', { dx: 0, dy: -1, tile: 0 }), N('set_tile', { dx: 0, dy: -2, tile: 0 }), N('sound', { note: 'C4', wave: 1 }), N('remove')]) }),
    ], placed: [] };
    const place = (type, col, up, sh) => {
      const g = heights[col]; if (g === undefined || g < 0) return;
      cart.entities.placed.push({ type, x: col * 8, y: (g - (sh || 1) - (up || 0)) * 8 });
    };
    place('sage', 6);
    [24, 47, 64, 98, 128, 146].forEach(c => place('slug', c));
    [36, 90, 118, 140].forEach(c => place('bee', c, 7));
    [58, 112].forEach(c => place('flower', c));
    place('guide', 73); place('button', 77); place('gate', 82, 0, 4);
  }

  window.BK_DEMO = { name: 'Sprout Hop', code, buildGfx };
})();
