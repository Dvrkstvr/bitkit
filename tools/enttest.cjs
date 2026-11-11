// Headless test of the entity system: walker, flyer, shooter, button + door, damage.
require('../studio/runtime.js')({ onLog: (m, e) => console.log(e ? 'ERR' : 'LOG', m) }).then(M => {
  M._bkw_init();
  const tiles = M._bkw_tiles(), flags = M._bkw_flags(), map = M._bkw_map() >> 1;
  M.HEAPU8.fill(7, tiles + 64 * 16, tiles + 64 * 17); M.HEAPU8[flags + 16] = 1;
  for (let x = 0; x < 60; x++) M.HEAPU16[map + 20 * 256 + x] = 16;          // floor at row 20
  M.HEAPU16[map + 19 * 256 + 30] = 16;                                       // wall at x=30
  const data = `ents_define({
    {name="slug", grav=true, hp=2, anims={idle={f={1},s=8}}, tree={t="selector", c={{t="patrol", p={speed=1}}}}},
    {name="seed", grav=false, damage=1, anims={idle={f={2},s=8}}},
    {name="flower", grav=true, team="enemy", anims={idle={f={3},s=8}}, tree={t="sequence", c={{t="face_player"},{t="every",p={frames=20}},{t="shoot",p={type="seed",speed=2}}}}},
    {name="button", grav=false, hidden=true, hp=0, team="friend", anims={}, tree={t="sequence", c={{t="touching",p={what="player"}},{t="emit",p={event="open"}}}}},
    {name="door", grav=false, anims={idle={f={4},s=8}}, tree={t="sequence", c={{t="heard",p={event="open"}},{t="remove"}}}},
    {name="bullet", grav=false, team="friend", damage=1, anims={}},
  })
  ents_place({{"slug", 40, 152}, {"flower", 200, 152}, {"button", 100, 152}, {"door", 120, 152}})`;
  const code = `
  hurts, deaths, opened = 0, 0, false
  on("player_hurt", function(d, src) hurts = hurts + 1 end)
  on("open", function() opened = true end)
  ents_on("slug", "death", function(e) deaths = deaths + 1 end) ents_on("slug","hurt",function(e,n,src) print("slug hurt by", src.name, "at", t(), "hp", e.hp) end)
  px = 60
  function _update()
    if t() == 10 then local b = ents_spawn("bullet", 0, 150); b.proj, b.pvx, b.pvy = true, 3, 0 end
    if t() == 40 then local b = ents_spawn("bullet", 0, 150); b.proj, b.pvx, b.pvy = true, 3, 0 end
    if t() > 100 then px = 100 end
    ents_player(px, 152, 8, 8)
    ents_update() if t() >= 10 and t() < 30 then for _, b in ipairs(ents_all("bullet")) do print("b", t(), b.x, b.y, b.alive) end for _, s in ipairs(ents_all("slug")) do print("s", s.x, s.y) end end
  end
  function _draw() cls() ents_draw() if t() == 199 then report() end end
  function report()
    local hit, hx, hy, th = raycast(0, 156, 1, 0, 300, "wall")
    local b = ents_all("button")[1] print("btn", b and b.x, b and b.y, b and #b.touch_now, PLAYER.x, PLAYER.y) for _, s in ipairs(ents_all("seed")) do print("seed", s.x, s.y, s.vx, s.age) end print("slugs", #ents_all("slug"), "deaths", deaths, "hurts", hurts, "opened", opened, "doors", #ents_all("door"), "seeds", #ents_all("seed"), "ray wall at", hx, "circle", #circlecast(104, 156, 10, "any"))
  end`;
  const rc = M._bkw_load_ex(M.stringToNewUTF8(data), M.stringToNewUTF8(code));
  console.log('load', rc);
  for (let f = 0; f < 200; f++) if (M._bkw_frame(0, 0)) break;
  M._bkw_load; // keep
  const r = M.stringToNewUTF8('report()');
  // run report via a frame hook: redefine _update
  M._bkw_frame(0, 0);
  // simple way: evaluate by reloading is not possible; use _draw override trick
});
