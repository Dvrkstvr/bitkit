/* Track editor: race tracks drawn as a smooth loop (a spline) over a level's map.
   A level becomes a track when it has level.track = {pts, road, kerb, laps, items}:
     pts    control points [[x, y], ...] in world pixels (the map is 2048 x 1024). The loop runs through
            them in order and closes back to the first one, which is the start line. [x, y, road, kerb]
            gives a point its own widths; the road blends smoothly between points.
     road   half the width of the road, kerb: width of the kerb on each side (pixels)
     laps   laps per race
     items  [{k, t, o}]: k is boost, crate (a row of 3), hill, bump, dip or ramp; t is how far round the lap
            (0..1 from the start line), o the offset to the right of the centre line (pixels).
            Hills, bumps, dips and ramps may also have h (height), r (size: radius, or a ramp's length),
            c (shape: a preset name or 5 heights from the top out to the edge) and, for a ramp, w (half width).
   Elevation is painted with the height brush: level.height is a grid of 129 x 65 heights (0..255, one
   every 16 pixels, flat ground is 40); hill, bump, dip and ramp items are added on top of it.
   The road is painted onto the map from "segment" tiles: road, kerb A/B, grass, start line and boost pad.
   You paint those few tiles and the 162 edge tiles (road meeting kerb meeting grass at any angle) are
   built from them. The game reads LEVELS[n].track and builds the same road when a race starts.
   MIT License. */
window.BKTracks = (function () {
  'use strict';
  const MAPW = 256, MAPH = 128, WW = MAPW * 8, WH = MAPH * 8;
  // tiles a track cart uses
  const TILE = { ROAD: 1, GRASS: 2, GRASS2: 3, GRASS3: 4, START: 5, BOOST: 6, EDGE: 7, EDGE_END: 168, KERB_A: 169, KERB_B: 170 };
  const FLAG = { ROAD: 1, KERB: 2, GRASS: 4, BOOST: 8, START: 16 };
  const FLAG_NAMES = ['road', 'kerb', 'grass', 'boost', 'start', '', '', ''];
  const PARTS = [
    { tile: TILE.ROAD, name: 'Road', about: 'The middle of the track. Repeats along the whole road.' },
    { tile: TILE.KERB_A, name: 'Kerb A', about: 'The sides. Kerb A and B take turns every 16 pixels, for stripes.' },
    { tile: TILE.KERB_B, name: 'Kerb B', about: 'The sides. Kerb A and B take turns every 16 pixels, for stripes.' },
    { tile: TILE.GRASS, name: 'Grass', about: 'Everything off the road.' },
    { tile: TILE.GRASS2, name: 'Grass 2', about: 'Sprinkled now and then off the road.' },
    { tile: TILE.GRASS3, name: 'Grass 3', about: 'Sprinkled now and then off the road.' },
    { tile: TILE.START, name: 'Start line', about: 'Painted across the road at the first point.' },
    { tile: TILE.BOOST, name: 'Boost pad', about: 'Painted where you put a boost pad.' },
  ];
  const HG_W = 129, HG_H = 65, HG_CELL = 16, HG_FLAT = 40;   // height grid
  // hills, bumps, dips and ramps (same as the game): default height, size (radius, or a ramp's length), shape
  const ITEM_HILLS = { hill: [36, 360, 'round'], bump: [14, 88, 'round'], dip: [-26, 320, 'round'], ramp: [22, 72, 'straight'] };
  const RAMP_W = 24;
  // a shape is 5 heights (0..1) from the top (the middle, or a ramp's lip) out to the edge
  const SHAPES = { round: [1, 0.78, 0.37, 0.1, 0], dome: [1, 0.95, 0.75, 0.4, 0], cone: [1, 0.75, 0.5, 0.25, 0],
    mesa: [1, 1, 0.95, 0.4, 0], spike: [1, 0.35, 0.12, 0.03, 0], straight: [1, 0.75, 0.5, 0.25, 0], kicker: [1, 0.55, 0.25, 0.07, 0] };
  const SHAPE_NAMES = { round: 'Round', dome: 'Dome', cone: 'Cone', mesa: 'Flat top', spike: 'Spike', straight: 'Straight', kicker: 'Kicker' };
  const ITEM_KINDS = {
    boost: { name: 'Boost pad', color: '#ffd23f', side: true },
    crate: { name: 'Item crates', color: '#c98a4b', side: true },
    hill: { name: 'Hill', color: '#8ad35a' },
    bump: { name: 'Bump (jump)', color: '#e0e070' },
    dip: { name: 'Dip', color: '#3a86d0' },
    ramp: { name: 'Ramp (jump)', color: '#ff9f43', side: true },
  };
  // smooth curve through a shape's 5 heights, u from 0 (top) to 1 (edge)
  function shapeAt(c, u) {
    if (u >= 1) return c[4];
    const f = u * 4, i = Math.floor(f), t = f - i;
    const p0 = c[Math.max(i - 1, 0)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(i + 2, 4)];
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  }
  const shapeOf = it => (Array.isArray(it.c) && it.c.length === 5 ? it.c : SHAPES[it.c || ITEM_HILLS[it.k][2]] || SHAPES.round);
  const hillSize = it => Math.max(it.r || ITEM_HILLS[it.k][1], 8);
  const hillHeight = it => (it.h === undefined ? ITEM_HILLS[it.k][0] : it.h);

  // ------------------------------------------------------------ geometry
  // Catmull-Rom through the closed loop of points, 'sub' samples per segment (the game uses 8)
  function spline(ctrl, sub) {
    const pts = [], n = ctrl.length;
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (let j = 0; j < sub; j++) {
        const t = j / sub, t2 = t * t, t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
        pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const S = [0];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; S.push(S[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    return { pts, S, len: S[pts.length], sub };
  }
  // point, direction and right-hand normal at arc length s
  function at(sp, s) {
    s = ((s % sp.len) + sp.len) % sp.len;
    let lo = 0, hi = sp.pts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (sp.S[m] <= s) lo = m; else hi = m - 1; }
    const a = sp.pts[lo], b = sp.pts[(lo + 1) % sp.pts.length], seg = sp.S[lo + 1] - sp.S[lo];
    const f = seg > 0 ? (s - sp.S[lo]) / seg : 0, dx = (b[0] - a[0]) / (seg || 1), dy = (b[1] - a[1]) / (seg || 1);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx, dy, nx: -dy, ny: dx };
  }
  // closest point of the curve to (x, y): arc length, distance, signed side offset, segment index
  function nearest(sp, x, y) {
    let best = 1e18, bs = 0, bo = 0, bi = 0;
    const n = sp.pts.length;
    for (let i = 0; i < n; i++) {
      const a = sp.pts[i], b = sp.pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let f = l2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0; f = f < 0 ? 0 : f > 1 ? 1 : f;
      const ex = x - (a[0] + dx * f), ey = y - (a[1] + dy * f), d = ex * ex + ey * ey;
      if (d < best) {
        best = d; bs = sp.S[i] + f * (sp.S[i + 1] - sp.S[i]); bi = i;
        const l = Math.sqrt(l2) || 1; bo = (ex * -dy + ey * dx) / l;
      }
    }
    return { s: bs, d: Math.sqrt(best), o: bo, seg: Math.floor(bi / sp.sub) };
  }
  const itemPos = (sp, it) => { const p = at(sp, it.t * sp.len); return { x: p.x + p.nx * it.o, y: p.y + p.ny * it.o }; };
  // a hill piece placed on the curve, and what it adds to the ground at (x, y)
  function hillOf(sp, it) {
    const p = at(sp, it.t * sp.len);
    return { x: p.x + p.nx * it.o, y: p.y + p.ny * it.o, h: hillHeight(it), r: hillSize(it), c: shapeOf(it),
      ramp: it.k === 'ramp', dx: p.dx, dy: p.dy, nx: p.nx, ny: p.ny, w: it.w || RAMP_W };
  }
  function hillH(hl, x, y) {
    const ex = x - hl.x, ey = y - hl.y;
    if (hl.ramp) {
      const a = ex * hl.dx + ey * hl.dy, c = Math.abs(ex * hl.nx + ey * hl.ny);
      if (a < -hl.r || a > 8 || c > hl.w + 12) return 0;
      const side = c <= hl.w ? 1 : 1 - (c - hl.w) / 12;
      const v = a <= 0 ? shapeAt(hl.c, -a / hl.r) : hl.c[0] * (1 - a / 8);
      return hl.h * v * side * side * (3 - 2 * side);
    }
    const d2 = (ex * ex + ey * ey) / (hl.r * hl.r);
    return d2 >= 1 ? 0 : hl.h * shapeAt(hl.c, Math.sqrt(d2));
  }
  // road and kerb width at every sample of the curve: each point can set its own ([x, y, road, kerb])
  function widths(tk, sub) {
    const P = tk.pts, n = P.length, R0 = tk.road || 44, K0 = tk.kerb || 7, RW = [], KW = [];
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const ra = a[2] ?? R0, rb = b[2] ?? R0, ka = a[3] ?? K0, kb = b[3] ?? K0;
      for (let j = 0; j < sub; j++) { let u = j / sub; u = u * u * (3 - 2 * u); RW.push(ra + (rb - ra) * u); KW.push(ka + (kb - ka) * u); }
    }
    return { RW, KW };
  }

  // ------------------------------------------------------------ tiles
  // the edge tiles: the classes of a tile's 4 corners (0 road, 1 kerb, 2 grass) are blended across it
  // (marching squares), so road edges run at any angle. Tile = 7 + combo * 2 + kerb stripe (A or B).
  function genEdges(cart) {
    const T = cart.tiles, src = n => T.subarray(n * 64, n * 64 + 64);
    const road = src(TILE.ROAD), grass = src(TILE.GRASS), kerb = [src(TILE.KERB_A), src(TILE.KERB_B)];
    for (let combo = 0; combo < 81; combo++) {
      const c00 = Math.floor(combo / 27), c10 = Math.floor(combo / 9) % 3, c01 = Math.floor(combo / 3) % 3, c11 = combo % 3;
      for (let stripe = 0; stripe < 2; stripe++) {
        const id = TILE.EDGE + combo * 2 + stripe;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const u = (x + 0.5) / 8, v = (y + 0.5) / 8;
          const val = c00 * (1 - u) * (1 - v) + c10 * u * (1 - v) + c01 * (1 - u) * v + c11 * u * v;
          const k = val < 0.5 ? 0 : val < 1.5 ? 1 : 2, i = y * 8 + x;
          T[id * 64 + i] = k === 0 ? road[i] : k === 1 ? kerb[stripe][i] : grass[i];
        }
        const val = (c00 + c10 + c01 + c11) / 4;
        cart.flags[id] = val < 0.5 ? FLAG.ROAD : val < 1.5 ? FLAG.KERB : FLAG.GRASS;
      }
    }
    cart.flags[TILE.ROAD] = FLAG.ROAD; cart.flags[TILE.START] = FLAG.ROAD | FLAG.START; cart.flags[TILE.BOOST] = FLAG.ROAD | FLAG.BOOST;
    cart.flags[TILE.GRASS] = cart.flags[TILE.GRASS2] = cart.flags[TILE.GRASS3] = FLAG.GRASS;
    cart.flags[TILE.KERB_A] = cart.flags[TILE.KERB_B] = FLAG.KERB;
  }
  const grassTile = (tx, ty) => { const v = (tx * 31 + ty * 17 + (tx * ty) % 7) % 40; return v === 0 ? TILE.GRASS2 : v < 3 ? TILE.GRASS3 : TILE.GRASS; };

  // paint the road of a track onto a map (the same way build_world() in the game does it)
  function paint(map, tk) {
    for (let ty = 0; ty < MAPH; ty++) for (let tx = 0; tx < MAPW; tx++) if (map[ty * MAPW + tx] <= TILE.EDGE_END) map[ty * MAPW + tx] = grassTile(tx, ty);
    if (!tk || !tk.pts || tk.pts.length < 3) return;
    const sp = spline(tk.pts, 8), RAW = sp.pts, RAWS = sp.S, LEN = sp.len, n = RAW.length, { RW, KW } = widths(tk, 8);
    const CS = 64, grid = new Map();
    for (let i = 0; i < n; i++) {
      const a = RAW[i], b = RAW[(i + 1) % n];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / CS) - 1; gx <= Math.floor(Math.max(a[0], b[0]) / CS) + 1; gx++)
        for (let gy = Math.floor(Math.min(a[1], b[1]) / CS) - 1; gy <= Math.floor(Math.max(a[1], b[1]) / CS) + 1; gy++) {
          const k = gx * 1000 + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
        }
    }
    const near = (x, y) => {
      const list = grid.get(Math.floor(x / CS) * 1000 + Math.floor(y / CS));
      if (!list) return [1e9, 0, 44, 7];
      let best = 1e18, s = 0, rw = 44, kw = 7;
      for (const i of list) {
        const a = RAW[i], b = RAW[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        let f = l2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0; f = f < 0 ? 0 : f > 1 ? 1 : f;
        const ex = x - (a[0] + dx * f), ey = y - (a[1] + dy * f), d = ex * ex + ey * ey;
        if (d < best) { const j = (i + 1) % n; best = d; s = RAWS[i] + f * (RAWS[i + 1] - RAWS[i]); rw = RW[i] + (RW[j] - RW[i]) * f; kw = KW[i] + (KW[j] - KW[i]) * f; }
      }
      return [Math.sqrt(best), s, rw, kw];
    };
    let mw = 0; for (let i = 0; i < n; i++) mw = Math.max(mw, RW[i] + KW[i]);
    const CL = new Map(), CSV = new Map(), M = mw + 4;
    for (let i = 0; i < n; i++) {
      const a = RAW[i], b = RAW[(i + 1) % n];
      for (let cy = Math.max(0, Math.floor((Math.min(a[1], b[1]) - M) / 8)); cy <= Math.min(MAPH, Math.floor((Math.max(a[1], b[1]) + M) / 8) + 1); cy++)
        for (let cx = Math.max(0, Math.floor((Math.min(a[0], b[0]) - M) / 8)); cx <= Math.min(MAPW, Math.floor((Math.max(a[0], b[0]) + M) / 8) + 1); cx++) {
          const k = cy * 257 + cx;
          if (!CL.has(k)) { const [d, s, rw, kw] = near(cx * 8, cy * 8); CL.set(k, d < rw ? 0 : d < rw + kw ? 1 : 2); CSV.set(k, s); }
        }
    }
    const done = new Set();
    CL.forEach((c, k) => {
      if (c >= 2) return;
      const cy = Math.floor(k / 257), cx = k % 257;
      for (let ty = cy - 1; ty <= cy; ty++) for (let tx = cx - 1; tx <= cx; tx++) {
        const tk2 = ty * MAPW + tx;
        if (tx < 0 || ty < 0 || tx >= MAPW || ty >= MAPH || done.has(tk2)) continue;
        done.add(tk2);
        const k00 = ty * 257 + tx, g = kk => (CL.has(kk) ? CL.get(kk) : 2);
        const c00 = g(k00), c10 = g(k00 + 1), c01 = g(k00 + 257), c11 = g(k00 + 258);
        const sv = [k00, k00 + 1, k00 + 257, k00 + 258].find(kk => CSV.has(kk));
        const s = sv === undefined ? 0 : CSV.get(sv);
        map[tk2] = c00 + c10 + c01 + c11 === 0 ? ((s < 7 || s > LEN - 7) ? TILE.START : TILE.ROAD)
          : TILE.EDGE + (c00 * 27 + c10 * 9 + c01 * 3 + c11) * 2 + (Math.floor(s / 16) % 2);
      }
    });
    (tk.items || []).filter(it => it.k === 'boost').forEach(it => {
      const p = itemPos(sp, it), bx = Math.floor(p.x), by = Math.floor(p.y);
      for (let ty = Math.floor(by / 8) - 2; ty <= Math.floor(by / 8) + 2; ty++) for (let tx = Math.floor(bx / 8) - 2; tx <= Math.floor(bx / 8) + 2; tx++)
        if (tx >= 0 && ty >= 0 && tx < MAPW && ty < MAPH && map[ty * MAPW + tx] === TILE.ROAD && (tx * 8 + 4 - bx) ** 2 + (ty * 8 + 4 - by) ** 2 < 14 * 14) map[ty * MAPW + tx] = TILE.BOOST;
    });
  }

  // ------------------------------------------------------------ heights
  const newHeights = () => new Uint8Array(HG_W * HG_H).fill(HG_FLAT);
  // ground height at a world point: the painted grid (blended) plus the hill items
  function heightFn(lv) {
    const g = lv.height, tk = lv.track, sp = tk && tk.pts && tk.pts.length >= 3 ? spline(tk.pts, 8) : null;
    const hills = sp ? (tk.items || []).filter(it => ITEM_HILLS[it.k]).map(it => hillOf(sp, it)) : [];
    return (x, y) => {
      let h = HG_FLAT;
      if (g) {
        const fx = Math.max(0, Math.min(HG_W - 1.001, x / HG_CELL)), fy = Math.max(0, Math.min(HG_H - 1.001, y / HG_CELL));
        const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, i = iy * HG_W + ix;
        h = (g[i] * (1 - u) + g[i + 1] * u) * (1 - v) + (g[i + HG_W] * (1 - u) + g[i + HG_W + 1] * u) * v;
      }
      for (const hl of hills) h += hillH(hl, x, y);
      return h;
    };
  }
  // the grid as a hex string for the game (2 characters per height)
  function heightHex(g) { let s = ''; for (let i = 0; i < g.length; i++) s += (g[i] < 16 ? '0' : '') + g[i].toString(16); return s; }

  function defaultTrack() {   // an oval with a kink, in the middle of the map
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 - Math.PI / 2;
      pts.push([Math.round(1024 + Math.cos(a) * 700), Math.round(512 + Math.sin(a) * 330 * (i === 5 ? 0.55 : 1))]);
    }
    return { pts, road: 44, kerb: 7, laps: 3, items: [{ k: 'boost', t: 0.25, o: 0 }, { k: 'crate', t: 0.5, o: 0 }, { k: 'bump', t: 0.75, o: 0 }] };
  }
  const uses = cart => !!(cart.levels && cart.levels.some(L => L.track));
  // before a run: rebuild the edge tiles from the segment tiles (they may have been painted on the Sprites tab)
  function beforeRun(cart) { if (uses(cart)) { genEdges(cart); return true; } return false; }

  // ------------------------------------------------------------ editor
  function init(ctx) {
    const { cart, $, toast, escapeHtml } = ctx;
    const view = $('trkView'), vctx = view.getContext('2d');
    const bg = document.createElement('canvas'); bg.width = WW; bg.height = WH;
    const bgctx = bg.getContext('2d');
    const st = { lvl: -1, tool: 'move', sel: null, drag: null, part: 0, col: 13, s: 0.4, ox: 0, oy: 0, fitted: false, bgDirty: true, sp: null, br: 72, showH: true, hDirty: true };
    const hc = document.createElement('canvas'); hc.width = HG_W; hc.height = HG_H;
    const hctx = hc.getContext('2d');
    const HTOOLS = { raise: 1, lower: 1, flat: 1, smooth: 1 };
    const tracks = () => cart.levels.map((L, i) => (L.track ? i : -1)).filter(i => i >= 0);
    const L = () => cart.levels[st.lvl];
    const tk = () => (L() ? L().track : null);

    // -- background: the level map drawn with the cart's tiles
    function renderBg() {
      const lv = L(); if (!lv) return;
      const pal = cart.palette, tiles = cart.tiles, cache = new Map();
      const img = bgctx.createImageData(WW, WH), d32 = new Uint32Array(img.data.buffer);
      const tileRGBA = n => {
        let c = cache.get(n); if (c) return c;
        c = new Uint32Array(64);
        for (let i = 0; i < 64; i++) { const p = tiles[n * 64 + i]; c[i] = p ? (255 << 24) | (pal[p * 3 + 2] << 16) | (pal[p * 3 + 1] << 8) | pal[p * 3] : 0xff000000; }
        cache.set(n, c); return c;
      };
      for (let ty = 0; ty < MAPH; ty++) for (let tx = 0; tx < MAPW; tx++) {
        const c = tileRGBA(lv.map[ty * MAPW + tx] & 511);
        for (let y = 0; y < 8; y++) d32.set(c.subarray(y * 8, y * 8 + 8), (ty * 8 + y) * WW + tx * 8);
      }
      bgctx.putImageData(img, 0, 0);
      st.bgDirty = false; st.hDirty = true;
    }
    // elevation as a relief map: brighter is higher, lit from the top left
    function renderHeights() {
      const hf = heightFn(L()), img = hctx.createImageData(HG_W, HG_H), d = img.data;
      const H = new Float32Array(HG_W * HG_H);
      for (let y = 0; y < HG_H; y++) for (let x = 0; x < HG_W; x++) H[y * HG_W + x] = hf(x * HG_CELL, y * HG_CELL);
      for (let y = 0; y < HG_H; y++) for (let x = 0; x < HG_W; x++) {
        const i = y * HG_W + x, h = H[i];
        const gx = H[y * HG_W + Math.min(HG_W - 1, x + 1)] - H[y * HG_W + Math.max(0, x - 1)];
        const gy = H[Math.min(HG_H - 1, y + 1) * HG_W + x] - H[Math.max(0, y - 1) * HG_W + x];
        const shade = Math.max(-1, Math.min(1, -(gx + gy) / 24));
        const e = Math.max(-1, Math.min(1, (h - HG_FLAT) / 60));
        const r = e > 0 ? 255 : 60, g2 = e > 0 ? 220 : 120, b = e > 0 ? 140 : 255;
        const a = Math.min(200, Math.abs(e) * 150 + Math.abs(shade) * 120);
        const lit = shade > 0 ? 255 : 0;
        d[i * 4] = Math.abs(e) > Math.abs(shade) ? r : lit; d[i * 4 + 1] = Math.abs(e) > Math.abs(shade) ? g2 : lit;
        d[i * 4 + 2] = Math.abs(e) > Math.abs(shade) ? b : lit; d[i * 4 + 3] = a;
      }
      hctx.putImageData(img, 0, 0);
      st.hDirty = false;
    }
    function brush(wx, wy) {
      const lv = L(); if (!lv.height) lv.height = newHeights();
      const g = lv.height, r = st.br / HG_CELL, cx = wx / HG_CELL, cy = wy / HG_CELL, tool = st.tool;
      const src = tool === 'smooth' ? g.slice() : null;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(HG_H - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(HG_W - 1, Math.ceil(cx + r)); x++) {
          const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
          const w = (1 - d * d) * (1 - d * d), i = y * HG_W + x;
          let v = g[i];
          if (tool === 'raise') v += 3 * w;
          else if (tool === 'lower') v -= 3 * w;
          else if (tool === 'flat') v += (st.flatTo - v) * 0.35 * w;
          else {
            let sum = 0, n = 0;
            for (let yy = Math.max(0, y - 1); yy <= Math.min(HG_H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(HG_W - 1, x + 1); xx++) { sum += src[yy * HG_W + xx]; n++; }
            v += (sum / n - v) * 0.5 * w;
          }
          g[i] = Math.max(0, Math.min(255, Math.round(v + (Math.random() - 0.5) * 0.01)));
        }
      st.hDirty = true;
    }

    // re-paint the road onto the level (after an edit), at most every 120 ms while dragging
    let repaintT = 0, repaintQ = null;
    function repaint(now) {
      const t = tk(); if (!t) return;
      if (!now) { clearTimeout(repaintQ); repaintQ = setTimeout(() => repaint(true), 120); return; }
      paint(L().map, t); st.bgDirty = true; ctx.mapChanged(); draw();
    }
    function edited() { st.sp = null; st.hDirty = true; ctx.changed(); repaint(); draw(); }
    const spl = () => (st.sp || (st.sp = spline(tk().pts, 8)));

    // -- view transform
    const toScr = (x, y) => [(x - st.ox) * st.s, (y - st.oy) * st.s];
    const toWorld = (sx, sy) => [sx / st.s + st.ox, sy / st.s + st.oy];
    function fit() {
      const w = view.clientWidth || view.width, h = view.clientHeight || view.height;
      st.s = Math.min(w / WW, h / WH); st.ox = -(w / st.s - WW) / 2; st.oy = -(h / st.s - WH) / 2;
    }
    function resize() {
      const r = view.parentElement.getBoundingClientRect();
      const w = Math.max(320, Math.floor(r.width)), h = Math.max(240, Math.min(Math.floor(w / 2), window.innerHeight - 260));
      if (view.width !== w || view.height !== h) { view.width = w; view.height = h; view.style.width = w + 'px'; view.style.height = h + 'px'; if (!st.fitted) { fit(); st.fitted = true; } }
    }

    function draw() {
      resize();
      const g = vctx; g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0c0c14'; g.fillRect(0, 0, view.width, view.height);
      const t = tk();
      if (!t) return;
      if (st.bgDirty) renderBg();
      g.imageSmoothingEnabled = false;
      g.drawImage(bg, -st.ox * st.s, -st.oy * st.s, WW * st.s, WH * st.s);
      if (st.showH || HTOOLS[st.tool]) {
        if (st.hDirty) renderHeights();
        g.imageSmoothingEnabled = true;
        g.drawImage(hc, (-HG_CELL / 2 - st.ox) * st.s, (-HG_CELL / 2 - st.oy) * st.s, HG_W * HG_CELL * st.s, HG_H * HG_CELL * st.s);
        g.imageSmoothingEnabled = false;
      }
      const sp = spl();
      // centre line
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.setLineDash([6, 6]); g.beginPath();
      sp.pts.forEach((p, i) => { const [x, y] = toScr(p[0], p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath(); g.stroke(); g.setLineDash([]);
      // direction arrows along the lap
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let k = 1; k < 12; k++) {
        const p = at(sp, sp.len * k / 12), [x, y] = toScr(p.x, p.y), a = Math.atan2(p.dy, p.dx);
        g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-4, 4); g.fill(); g.restore();
      }
      // items
      (t.items || []).forEach((it, i) => {
        const K = ITEM_KINDS[it.k] || ITEM_KINDS.boost, p = itemPos(sp, it), [x, y] = toScr(p.x, p.y);
        const selected = st.sel && st.sel.item === i;
        if (ITEM_HILLS[it.k]) {
          const hl = hillOf(sp, it);
          g.strokeStyle = K.color; g.globalAlpha = 0.6; g.beginPath();
          if (hl.ramp) {   // the ramp's footprint: from its foot up to the lip
            const c = [[-hl.r, -hl.w], [0, -hl.w], [0, hl.w], [-hl.r, hl.w]].map(([a, o]) => toScr(hl.x + hl.dx * a + hl.nx * o, hl.y + hl.dy * a + hl.ny * o));
            c.forEach(([cx, cy], j) => (j ? g.lineTo(cx, cy) : g.moveTo(cx, cy))); g.closePath(); g.stroke();
            g.lineWidth = 3; g.beginPath(); g.moveTo(c[1][0], c[1][1]); g.lineTo(c[2][0], c[2][1]);
          } else g.arc(x, y, hl.r * st.s, 0, Math.PI * 2);
          g.stroke(); g.globalAlpha = 1;
        }
        g.fillStyle = K.color; g.strokeStyle = selected ? '#fff' : '#000'; g.lineWidth = selected ? 2 : 1;
        if (it.k === 'crate') {
          const q = at(sp, it.t * sp.len);
          [-22, 0, 22].forEach(o => { const [cx, cy] = toScr(q.x + q.nx * (it.o + o), q.y + q.ny * (it.o + o)); g.fillRect(cx - 4, cy - 4, 8, 8); g.strokeRect(cx - 4, cy - 4, 8, 8); });
        } else if (it.k === 'boost') {
          g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.closePath(); g.fill(); g.stroke();
        } else { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke(); }
      });
      // control points
      t.pts.forEach((p, i) => {
        const [x, y] = toScr(p[0], p[1]), selected = st.sel && st.sel.pt === i;
        g.fillStyle = i === 0 ? '#ff6b5e' : '#ffffff'; g.strokeStyle = selected ? '#ffd23f' : '#000'; g.lineWidth = selected ? 3 : 1.5;
        g.beginPath(); g.arc(x, y, i === 0 ? 8 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#000'; g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(i === 0 ? 'S' : String(i), x, y + 0.5);
      });
      // start line
      const s0 = at(sp, 0), w = (t.road || 44) + (t.kerb || 7);
      const [ax, ay] = toScr(s0.x + s0.nx * w, s0.y + s0.ny * w), [bx, by] = toScr(s0.x - s0.nx * w, s0.y - s0.ny * w);
      g.strokeStyle = '#ff6b5e'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      if (HTOOLS[st.tool] && st.mouse) {
        const [mx, my] = toScr(st.mouse[0], st.mouse[1]);
        g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(mx, my, st.br * st.s, 0, Math.PI * 2); g.stroke();
      }
      $('trkLen').textContent = `${t.pts.length} points, ${Math.round(sp.len)} px per lap`;
    }

    // -- picking
    function hitPoint(sx, sy) {
      const t = tk(); let best = -1, bd = 12 * 12;
      t.pts.forEach((p, i) => { const [x, y] = toScr(p[0], p[1]), d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function hitItem(sx, sy) {
      const t = tk(), sp = spl(); let best = -1, bd = 10 * 10;
      (t.items || []).forEach((it, i) => { const p = itemPos(sp, it), [x, y] = toScr(p.x, p.y), d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    }
    const clampW = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    function itemFrom(k, wx, wy) {
      const t = tk(), sp = spl(), nr = nearest(sp, wx, wy), K = ITEM_KINDS[k];
      const lim = K.side ? Math.max(0, (t.road || 44) - (k === 'crate' ? 30 : 10)) : 400;
      return { k, t: Math.round(nr.s / sp.len * 1000) / 1000, o: Math.round(clampW(nr.o, -lim, lim)) };
    }
    const evPos = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) * view.width / r.width, (e.clientY - r.top) * view.height / r.height]; };

    view.addEventListener('contextmenu', e => e.preventDefault());
    view.addEventListener('mousedown', e => {
      const t = tk(); if (!t) return;
      view.focus();
      const [sx, sy] = evPos(e), [wx, wy] = toWorld(sx, sy);
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) { st.drag = { pan: true, sx, sy, ox: st.ox, oy: st.oy }; return; }
      const pi = hitPoint(sx, sy), ii = pi < 0 ? hitItem(sx, sy) : -1;
      if (e.button === 2 || st.tool === 'erase') {          // right click (or the eraser) deletes
        if (pi >= 0) delPoint(pi); else if (ii >= 0) { t.items.splice(ii, 1); st.sel = null; edited(); }
        return;
      }
      if (st.tool === 'move' || st.tool === 'point') {
        if (pi >= 0) { st.sel = { pt: pi }; st.drag = { pt: pi }; draw(); updateSel(); return; }
        if (ii >= 0 && st.tool === 'move') { st.sel = { item: ii }; st.drag = { item: ii }; draw(); updateSel(); return; }
        if (st.tool === 'point' || e.detail === 2) { addPoint(wx, wy); return; }
        st.sel = null; updateSel();
        st.drag = { pan: true, sx, sy, ox: st.ox, oy: st.oy }; draw(); return;
      }
      if (HTOOLS[st.tool]) {
        st.flatTo = heightFn(L())(wx, wy);
        st.drag = { height: true, moved: true }; brush(wx, wy); draw(); return;
      }
      if (ITEM_KINDS[st.tool]) {
        t.items = t.items || [];
        t.items.push(itemFrom(st.tool, wx, wy));
        st.sel = { item: t.items.length - 1 }; st.drag = { item: t.items.length - 1 };
        edited(); updateSel();
      }
    });
    window.addEventListener('mousemove', e => {
      const t = tk();
      if (!t || !ctx.isActive()) return;
      const [sx, sy] = evPos(e), [wx, wy] = toWorld(sx, sy);
      if (e.target === view) {
        $('trkPos').textContent = `x ${Math.round(wx)}  y ${Math.round(wy)}  height ${Math.round(heightFn(L())(wx, wy))}`;
        st.mouse = [wx, wy];
        if (HTOOLS[st.tool] && !st.drag) draw();
      }
      const d = st.drag; if (!d) return;
      if (d.height) { brush(wx, wy); draw(); return; }
      if (d.pan) { st.ox = d.ox - (sx - d.sx) / st.s; st.oy = d.oy - (sy - d.sy) / st.s; draw(); return; }
      if (d.pt !== undefined) {
        t.pts[d.pt] = [Math.round(clampW(wx, 8, WW - 8)), Math.round(clampW(wy, 8, WH - 8))].concat(t.pts[d.pt].slice(2));
        d.moved = true; st.sp = null; st.hDirty = true; repaint(); draw();
      } else if (d.item !== undefined) {
        const it = t.items[d.item], n = itemFrom(it.k, wx, wy);
        it.t = n.t; it.o = n.o; d.moved = true; st.hDirty = true; repaint(); draw();
      }
    });
    window.addEventListener('mouseup', () => {
      if (st.drag && st.drag.height) ctx.changed();
      else if (st.drag && st.drag.moved) { st.sp = null; ctx.changed(); repaint(true); }
      st.drag = null;
    });
    view.addEventListener('wheel', e => {
      if (!tk()) return;
      e.preventDefault();
      const [sx, sy] = evPos(e), [wx, wy] = toWorld(sx, sy);
      st.s = clampW(st.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.15, 4);
      st.ox = wx - sx / st.s; st.oy = wy - sy / st.s; draw();
    }, { passive: false });
    view.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) {
        e.preventDefault();
        if (st.sel.pt !== undefined) delPoint(st.sel.pt);
        else { tk().items.splice(st.sel.item, 1); st.sel = null; edited(); updateSel(); }
      }
    });

    function addPoint(wx, wy) {
      const t = tk(), sp = spl(), nr = nearest(sp, wx, wy);
      // insert into the stretch of road nearest the click (after its first point)
      remapItems(() => { t.pts.splice(nr.seg + 1, 0, [Math.round(wx), Math.round(wy)]); });
      st.sel = { pt: nr.seg + 1 }; st.drag = { pt: nr.seg + 1 };
      edited(); updateSel();
    }
    function delPoint(i) {
      const t = tk();
      if (t.pts.length <= 4) { toast('A track needs at least 4 points'); return; }
      remapItems(() => t.pts.splice(i, 1));
      st.sel = null; edited(); updateSel();
    }
    // keep items where they are on the map when the curve changes shape
    function remapItems(change) {
      const t = tk(), before = spl(), pos = (t.items || []).map(it => itemPos(before, it));
      change(); st.sp = null;
      const sp = spl();
      (t.items || []).forEach((it, i) => { const n = itemFrom(it.k, pos[i].x, pos[i].y); it.t = n.t; it.o = n.o; });
      void sp;
    }

    // -- side panel
    function updateSel() {
      const box = $('trkSel'), t = tk();
      if (!t || !st.sel) { box.innerHTML = '<span class="dim">Click a point or item to select it.</span>'; return; }
      if (st.sel.pt !== undefined) {
        const i = st.sel.pt;
        const P = t.pts[i], own = P.length > 2;
        box.innerHTML = `<b>${i === 0 ? 'Start point' : 'Point ' + i}</b> <span class="dim">(${P[0]}, ${P[1]})</span><br>` +
          '<div class="prop-grid">' +
          `<span>Road width</span><span><input id="trkPtRoad" type="range" min="12" max="96" value="${P[2] ?? (t.road || 44)}"> <b id="trkPtRoadV">${(P[2] ?? (t.road || 44)) * 2}</b> px</span>` +
          `<span>Kerb width</span><span><input id="trkPtKerb" type="range" min="0" max="20" value="${P[3] ?? (t.kerb || 7)}"> <b id="trkPtKerbV">${P[3] ?? (t.kerb || 7)}</b> px</span></div>` +
          `<span class="dim">${own ? 'This point has its own width; the road blends to the next point.' : 'Uses the track width. Move a slider to give this point its own.'}</span><br>` +
          (own ? '<button id="trkPtReset" class="tiny">Use track width</button> ' : '') +
          (i ? '<button id="trkMakeStart" class="tiny">Start here</button> ' : '') + '<button id="trkDelPt" class="tiny danger">Delete</button>';
        const setW = () => {
          const r = +$('trkPtRoad').value, k = +$('trkPtKerb').value;
          t.pts[i] = [t.pts[i][0], t.pts[i][1], r, k];
          $('trkPtRoadV').textContent = r * 2; $('trkPtKerbV').textContent = k;
          st.sp = null; ctx.changed(); repaint();
        };
        $('trkPtRoad').oninput = setW; $('trkPtKerb').oninput = setW;
        $('trkPtRoad').onchange = $('trkPtKerb').onchange = () => { if (!own) updateSel(); };
        if (own) $('trkPtReset').onclick = () => { t.pts[i] = t.pts[i].slice(0, 2); edited(); updateSel(); };
        if (i) $('trkMakeStart').onclick = () => {
          remapItems(() => { t.pts = t.pts.slice(i).concat(t.pts.slice(0, i)); L().track.pts = t.pts; });
          st.sel = { pt: 0 }; edited(); updateSel();
        };
        $('trkDelPt').onclick = () => delPoint(i);
      } else {
        const it = t.items[st.sel.item]; if (!it) { st.sel = null; updateSel(); return; }
        box.innerHTML = `<b>${escapeHtml(ITEM_KINDS[it.k].name)}</b> <span class="dim">${Math.round(it.t * 100)}% round the lap, ${it.o} px ${it.o < 0 ? 'left' : 'right'}</span><br>` +
          `<select id="trkItemKind">${Object.keys(ITEM_KINDS).map(k => `<option value="${k}"${k === it.k ? ' selected' : ''}>${ITEM_KINDS[k].name}</option>`).join('')}</select> <button id="trkDelItem" class="tiny danger">Delete</button>`;
        $('trkItemKind').onchange = e => {
          it.k = e.target.value; delete it.h; delete it.r; delete it.c; delete it.w;
          const p = itemPos(spl(), it), n = itemFrom(it.k, p.x, p.y); it.o = n.o; edited(); updateSel();
        };
        $('trkDelItem').onclick = () => { t.items.splice(st.sel.item, 1); st.sel = null; edited(); updateSel(); };
        if (ITEM_HILLS[it.k]) hillPanel(box, it);
      }
    }
    // size, height and shape of a hill, bump, dip or ramp
    function hillPanel(box, it) {
      const ramp = it.k === 'ramp', c = shapeOf(it);
      const preset = Array.isArray(it.c) ? '' : (it.c || ITEM_HILLS[it.k][2]);
      const div = document.createElement('div');
      div.innerHTML = '<div class="prop-grid">' +
        `<span>Height</span><span><input id="trkHH" type="range" min="-60" max="80" value="${hillHeight(it)}"> <b id="trkHHV">${hillHeight(it)}</b></span>` +
        `<span>${ramp ? 'Length' : 'Size'}</span><span><input id="trkHR" type="range" min="16" max="${ramp ? 240 : 640}" step="4" value="${hillSize(it)}"> <b id="trkHRV">${hillSize(it)}</b> px</span>` +
        (ramp ? `<span>Width</span><span><input id="trkHW" type="range" min="8" max="80" value="${it.w || RAMP_W}"> <b id="trkHWV">${(it.w || RAMP_W) * 2}</b> px</span>` : '') +
        `<span>Shape</span><span><select id="trkHS">${Object.keys(SHAPES).map(k => `<option value="${k}"${k === preset ? ' selected' : ''}>${SHAPE_NAMES[k]}</option>`).join('')}` +
        `${preset ? '' : '<option value="" selected>Custom</option>'}</select></span></div>` +
        `<canvas id="trkHC" class="trk-curve" width="264" height="84" title="Drag the dots to change the shape: ${ramp ? 'the lip is on the left, the foot of the ramp on the right' : 'the top is on the left, the edge on the right'}"></canvas>`;
      box.appendChild(div);
      const cv = $('trkHC'), cg = cv.getContext('2d'), PAD = 10;
      const px = j => PAD + j * (cv.width - 2 * PAD) / 4, py = v => cv.height - PAD - v * (cv.height - 2 * PAD);
      function drawCurve() {
        const cc = shapeOf(it);
        cg.clearRect(0, 0, cv.width, cv.height);
        cg.strokeStyle = 'rgba(255,255,255,0.15)'; cg.beginPath(); cg.moveTo(PAD, py(0)); cg.lineTo(cv.width - PAD, py(0)); cg.stroke();
        cg.fillStyle = ITEM_KINDS[it.k].color + '55'; cg.strokeStyle = ITEM_KINDS[it.k].color; cg.lineWidth = 2; cg.beginPath();
        for (let x = PAD; x <= cv.width - PAD; x++) { const v = shapeAt(cc, (x - PAD) / (cv.width - 2 * PAD)); if (x === PAD) cg.moveTo(x, py(v)); else cg.lineTo(x, py(v)); }
        cg.stroke(); cg.lineTo(cv.width - PAD, py(0)); cg.lineTo(PAD, py(0)); cg.fill();
        if (ramp) { cg.beginPath(); cg.moveTo(PAD, py(cc[0])); cg.lineTo(PAD - 6, py(0)); cg.stroke(); }
        cc.forEach((v, j) => { cg.fillStyle = '#fff'; cg.beginPath(); cg.arc(px(j), py(v), 4, 0, Math.PI * 2); cg.fill(); });
      }
      drawCurve();
      const changed = () => { st.hDirty = true; ctx.changed(); draw(); };
      $('trkHH').oninput = e => { it.h = +e.target.value; $('trkHHV').textContent = it.h; changed(); };
      $('trkHR').oninput = e => { it.r = +e.target.value; $('trkHRV').textContent = it.r; changed(); };
      if (ramp) $('trkHW').oninput = e => { it.w = +e.target.value; $('trkHWV').textContent = it.w * 2; changed(); };
      $('trkHS').onchange = e => { if (e.target.value) { it.c = e.target.value; changed(); updateSel(); } };
      let dragJ = -1;
      const cpos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
      cv.onmousedown = e => {
        const [x, y] = cpos(e), cc = shapeOf(it);
        dragJ = -1; let bd = 14 * 14;
        cc.forEach((v, j) => { const d = (px(j) - x) ** 2 + (py(v) - y) ** 2; if (d < bd) { bd = d; dragJ = j; } });
        if (dragJ < 0) dragJ = Math.round((x - PAD) / ((cv.width - 2 * PAD) / 4));
        dragJ = clampW(dragJ, 0, 4); cv.onmousemove(e);
      };
      cv.onmousemove = e => {
        if (dragJ < 0 || !(e.buttons & 1)) { dragJ = -1; return; }
        const [, y] = cpos(e), cc = shapeOf(it).slice();
        cc[dragJ] = Math.round(clampW((cv.height - PAD - y) / (cv.height - 2 * PAD), 0, 1) * 100) / 100;
        it.c = cc; drawCurve(); changed();
        const sel = $('trkHS'); if (sel.value) { sel.insertAdjacentHTML('beforeend', '<option value="" selected>Custom</option>'); }
      };
      cv.onmouseup = cv.onmouseleave = () => { dragJ = -1; };
    }
    function setTool(t) {
      st.tool = t;
      document.querySelectorAll('#tab-track .ttool').forEach(b => b.classList.toggle('active', b.dataset.ttool === t));
      view.style.cursor = t === 'move' ? 'default' : HTOOLS[t] ? 'none' : 'crosshair';
      $('trkBrushBox').hidden = !HTOOLS[t];
      if (ctx.isActive()) draw();
    }
    document.querySelectorAll('#tab-track .ttool').forEach(b => b.onclick = () => setTool(b.dataset.ttool));

    function refreshList() {
      const list = tracks();
      if (!list.includes(st.lvl)) st.lvl = list.length ? list[0] : -1;
      $('trkLevel').innerHTML = list.map(i => `<option value="${i}"${i === st.lvl ? ' selected' : ''}>${escapeHtml(cart.levels[i].name)}</option>`).join('');
      const t = tk();
      $('trkEmpty').hidden = !!t; $('trkBody').hidden = !t;
      if (!t) return;
      $('trkName').value = L().name;
      $('trkLaps').value = t.laps || 3; $('trkRoad').value = t.road || 44; $('trkKerb').value = t.kerb || 7;
      $('trkRoadV').textContent = (t.road || 44) * 2; $('trkKerbV').textContent = t.kerb || 7;
    }
    $('trkLevel').onchange = e => { st.lvl = +e.target.value; st.sel = null; st.sp = null; st.bgDirty = true; st.hDirty = true; refreshList(); updateSel(); draw(); };
    $('trkName').onchange = e => { L().name = e.target.value.trim() || L().name; ctx.changed(); ctx.levelsChanged(); refreshList(); };
    $('trkLaps').onchange = e => { tk().laps = clampW(Math.round(+e.target.value) || 3, 1, 9); ctx.changed(); refreshList(); };
    $('trkRoad').oninput = e => { tk().road = +e.target.value; $('trkRoadV').textContent = tk().road * 2; ctx.changed(); repaint(); };
    $('trkKerb').oninput = e => { tk().kerb = +e.target.value; $('trkKerbV').textContent = tk().kerb; ctx.changed(); repaint(); };
    $('trkReverse').onclick = () => {
      const t = tk(); if (!t) return;
      remapItems(() => { t.pts = [t.pts[0]].concat(t.pts.slice(1).reverse()); });
      (t.items || []).forEach(it => { if (ITEM_KINDS[it.k].side) it.o = Math.round(it.o); });
      st.sel = null; edited(); updateSel(); toast('The race now runs the other way');
    };
    $('trkBrush').oninput = e => { st.br = +e.target.value; $('trkBrushV').textContent = st.br; };
    $('trkShowH').onchange = e => { st.showH = e.target.checked; draw(); };
    $('trkFlatAll').onclick = async () => {
      if (!tk() || !L().height) return;
      if (!await ctx.ask('Flatten the whole map?', 'Painted elevation is removed. Hill, bump and dip pieces stay.', 'Flatten')) return;
      delete L().height; st.hDirty = true; ctx.changed(); draw();
    };
    $('trkFit').onclick = () => { fit(); draw(); };
    $('trkNew').onclick = () => {
      ctx.syncLevel();
      const n = tracks().length + 1;
      const lv = { name: `Track ${n}`, w: MAPW, h: MAPH, map: new Uint16Array(MAPW * MAPH), placed: [], track: defaultTrack() };
      paint(lv.map, lv.track);
      cart.levels.push(lv); st.lvl = cart.levels.length - 1; st.sel = null; st.sp = null; st.bgDirty = true;
      ctx.changed(); ctx.levelsChanged(); refreshList(); updateSel(); draw();
      toast(`Added ${lv.name}. Drag the points to shape it.`);
    };
    $('trkDup').onclick = () => {
      if (!tk()) return;
      ctx.syncLevel();
      const src = L(), lv = { name: src.name + ' copy', w: src.w, h: src.h, map: src.map.slice(), placed: src.placed.map(p => Object.assign({}, p)), track: JSON.parse(JSON.stringify(src.track)), height: src.height ? src.height.slice() : undefined };
      cart.levels.splice(st.lvl + 1, 0, lv);
      if (cart.level > st.lvl) ctx.bindLevel(cart.level + 1);
      st.lvl++; st.sp = null; st.bgDirty = true; ctx.changed(); ctx.levelsChanged(); refreshList(); draw();
    };
    $('trkDel').onclick = async () => {
      if (!tk()) return;
      if (cart.levels.length < 2) { toast('A cart needs at least one level'); return; }
      if (!await ctx.ask(`Delete "${L().name}"?`, 'The track and its level are removed.', 'Delete')) return;
      ctx.syncLevel();
      const i = st.lvl;
      cart.levels.splice(i, 1);
      ctx.bindLevel(cart.level > i ? cart.level - 1 : Math.min(cart.level, cart.levels.length - 1));
      st.lvl = -1; st.sp = null; st.bgDirty = true; ctx.changed(); ctx.levelsChanged(); refreshList(); updateSel(); draw();
    };
    $('trkPlay').onclick = () => { if (tk()) ctx.run(st.lvl, `KART_QUICK = ${st.lvl + 1}\n`); };
    $('trkMakeTrack').onclick = () => {
      ctx.syncLevel();
      const lv = cart.levels[cart.level];
      lv.track = defaultTrack(); paint(lv.map, lv.track); genEdges(cart); ctx.gfxChanged();
      st.lvl = cart.level; st.sp = null; st.bgDirty = true; ctx.changed(); ctx.mapChanged(); refreshList(); updateSel(); render();
    };

    // -- segment painter: the few tiles the road is made of
    const segC = $('trkSeg'), segX = segC.getContext('2d'), palC = $('trkPal'), palX = palC.getContext('2d'), partsEl = $('trkParts');
    const PX = 22;
    function rgb(i) { const p = cart.palette; return `rgb(${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]})`; }
    function drawTile(g, n, x0, y0, z) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const c = cart.tiles[n * 64 + y * 8 + x];
        g.fillStyle = c ? rgb(c) : '#000'; g.fillRect(x0 + x * z, y0 + y * z, z, z);
      }
    }
    function drawParts() {
      partsEl.innerHTML = '';
      PARTS.forEach((p, i) => {
        const b = document.createElement('button');
        b.className = 'trk-part' + (i === st.part ? ' active' : ''); b.title = p.about;
        const c = document.createElement('canvas'); c.width = c.height = 32; c.className = 'pix';
        drawTile(c.getContext('2d'), p.tile, 0, 0, 4);
        b.appendChild(c); b.appendChild(document.createTextNode(p.name));
        b.onclick = () => { st.part = i; drawParts(); drawSeg(); };
        partsEl.appendChild(b);
      });
      $('trkPartAbout').textContent = PARTS[st.part].about;
    }
    function drawSeg() {
      segX.fillStyle = '#000'; segX.fillRect(0, 0, segC.width, segC.height);
      drawTile(segX, PARTS[st.part].tile, 0, 0, PX);
      segX.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let i = 1; i < 8; i++) { segX.beginPath(); segX.moveTo(i * PX + 0.5, 0); segX.lineTo(i * PX + 0.5, 8 * PX); segX.moveTo(0, i * PX + 0.5); segX.lineTo(8 * PX, i * PX + 0.5); segX.stroke(); }
      // a little road cross-section preview: grass | kerb | road | road | kerb | grass, 2 rows
      const pv = $('trkPreview').getContext('2d'), z = 3;
      const row = [TILE.GRASS, TILE.KERB_A, TILE.ROAD, TILE.ROAD, TILE.ROAD, TILE.ROAD, TILE.KERB_A, TILE.GRASS];
      for (let r = 0; r < 4; r++) row.forEach((n, i) => drawTile(pv, (n === TILE.KERB_A && r % 2) ? TILE.KERB_B : n, i * 8 * z, r * 8 * z, z));
      drawPal();
    }
    function drawPal() {
      const z = 12;
      for (let i = 0; i < 256; i++) { palX.fillStyle = i ? rgb(i) : '#000'; palX.fillRect((i % 16) * z, Math.floor(i / 16) * z, z, z); }
      palX.strokeStyle = '#fff'; palX.lineWidth = 2; palX.strokeRect((st.col % 16) * z + 1, Math.floor(st.col / 16) * z + 1, z - 2, z - 2);
      $('trkCol').style.background = rgb(st.col);
    }
    palC.addEventListener('mousedown', e => {
      const r = palC.getBoundingClientRect(), z = r.width / 16;
      st.col = Math.floor((e.clientY - r.top) / z) * 16 + Math.floor((e.clientX - r.left) / z); drawPal();
    });
    let painting = false;
    function segPaint(e) {
      const r = segC.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * 8), y = Math.floor((e.clientY - r.top) / r.height * 8);
      if (x < 0 || y < 0 || x > 7 || y > 7) return;
      const i = PARTS[st.part].tile * 64 + y * 8 + x;
      if (e.button === 2 || e.altKey) { st.col = cart.tiles[i]; drawPal(); return; }
      if (cart.tiles[i] === st.col) return;
      cart.tiles[i] = st.col; drawSeg();
      segDirty = true;
    }
    let segDirty = false;
    segC.addEventListener('contextmenu', e => e.preventDefault());
    segC.addEventListener('mousedown', e => { painting = e.button === 0 && !e.altKey; segPaint(e); });
    segC.addEventListener('mousemove', e => { if (painting) segPaint(e); });
    window.addEventListener('mouseup', () => {
      painting = false;
      if (segDirty) { segDirty = false; genEdges(cart); ctx.gfxChanged(); drawParts(); st.bgDirty = true; draw(); }
    });

    function render() {
      $('trkNone').hidden = uses(cart);
      $('trkMain').hidden = !uses(cart);
      if (!uses(cart)) return;
      refreshList(); updateSel(); drawParts(); drawSeg();
      st.bgDirty = true; st.hDirty = true; st.sp = null;
      requestAnimationFrame(draw);
    }
    window.addEventListener('resize', () => { if (ctx.isActive()) draw(); });
    setTool('move');
    return { render, refreshGfx() { st.bgDirty = true; if (ctx.isActive()) { drawParts(); drawSeg(); draw(); } } };
  }

  return { init, spline, at, nearest, paint, genEdges, defaultTrack, uses, beforeRun, heightHex, heightFn, newHeights, HG_W, HG_H, HG_CELL, TILE, FLAG, FLAG_NAMES, PARTS, ITEM_KINDS, ITEM_HILLS, SHAPES, shapeAt };
})();
