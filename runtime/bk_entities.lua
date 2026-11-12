-- BitKit entity system. Built into the runtime and loaded before every cart.
-- Entity types (sprites, animations, behavior trees) come from the studio's Entities tab.
-- MIT License.
local tr, lang, lang_nth = tr, lang, lang_nth   -- the Bit's language (bk_lang.lua): kept here so a cart's own tr = ... can't break the shell

ENT_SOLID_FLAG = 0       -- map tiles with this sprite flag block entities
ENT_GRAVITY = 0.25
ENT_MAX_FALL = 4
ENT_WORLD_W, ENT_WORLD_H = 256 * 8, 128 * 8   -- entities leaving this area are removed (the player dies)

local DEFS, PLACED, LIST = {}, {}, {}
local TX, TY = 0, 0
local nid = 0

local function solid(x, y) return fget(mget(x // 8, y // 8), ENT_SOLID_FLAG) end

local function hits(x, y, w, h)
  local x1, y1 = x + w - 1, y + h - 1
  local xx = x
  while true do
    if solid(xx, y) or solid(xx, y1) then return true end
    if xx >= x1 then break end
    xx = math.min(xx + 8, x1)
  end
  local yy = y
  while true do
    if solid(x, yy) or solid(x1, yy) then return true end
    if yy >= y1 then break end
    yy = math.min(yy + 8, y1)
  end
  return false
end

local function center(e) return e.x + e.w / 2, e.y + e.h / 2 end
local function sign(v) return v > 0 and 1 or (v < 0 and -1 or 0) end
local function wall_ahead(e) return e.collide and hits(e.x + e.dir, e.y, e.w, e.h) end
local function ledge_ahead(e)
  local fx = e.dir > 0 and e.x + e.w or e.x - 1
  return not solid(fx, e.y + e.h)
end
-- players: PL[n] is player n's entity (n = 1..PLAYERS). PLAYER is player 1.
local PL = {}
-- the point enemies aim at: the nearest living player (or ents_target's point when there is no player entity)
local function target_of(e)
  local cx, cy = center(e)
  local bx, by, bd = TX, TY, nil
  for i = 1, #PL do
    local p = PL[i]
    if p.alive then
      local px, py = p.x + p.w / 2, p.y + p.h / 2
      local d = (px - cx) * (px - cx) + (py - cy) * (py - cy)
      if not bd or d < bd then bx, by, bd = px, py, d end
    end
  end
  return bx, by
end
local function dist(e)
  local cx, cy = center(e)
  local tx, ty = target_of(e)
  local dx, dy = tx - cx, ty - cy
  return math.sqrt(dx * dx + dy * dy), dx, dy
end

-- ---------------------------------------------------------------- events
local HANDLERS, PENDING, HEARD, TH = {}, {}, {}, {}
-- on(name, fn): call fn whenever emit(name, ...) happens
function on(name, fn)
  local h = HANDLERS[name] or {}
  h[#h + 1] = fn
  HANDLERS[name] = h
end
-- emit(name, ...): call handlers now; entities can react with a "Heard event" check next frame
function emit(name, ...)
  PENDING[name] = true
  local h = HANDLERS[name]
  if h then for i = 1, #h do h[i](...) end end
end
-- ents_on(type, event, fn): event is "touch", "hurt" or "death"
function ents_on(name, ev, fn)
  TH[name] = TH[name] or {}
  local l = TH[name][ev] or {}
  l[#l + 1] = fn
  TH[name][ev] = l
end
local function fire(e, ev, a, b)
  local t = TH[e.name]
  local l = t and t[ev]
  if l then for i = 1, #l do l[i](e, a, b) end end
end

-- the player is not an entity, but sensors and touches can see it
local DUMMY = {name = "player", is_player = true, dummy = true, team = "friend", alive = true, x = -999, y = -999, w = 8, h = 8, vy = 0}
PLAYER = DUMMY
-- ---------------------------------------------------------------- stats and effects
local FX = {}
function ents_effects(list)
  FX = {}
  for i = 1, #list do FX[list[i].name] = list[i] end
end

local function base_stat(e, name)
  if e.base and e.base[name] ~= nil then return e.base[name] end
  local d = e.def
  if not d then return 0 end
  if name == "hp" then return d.hp or 1 end
  if name == "damage" then return d.damage or 0 end
  if d.stats and d.stats[name] ~= nil then return d.stats[name] end
  if name == "speed" or name == "jump" then return 1 end
  return 0
end

-- stat(e, name): base value from the entity type, changed by active effects (+ first, then x)
function stat(e, name)
  local v, add, mul = base_stat(e, name), 0, 1
  local l = e.fx
  if l then
    for i = 1, #l do
      local m = l[i].def.mods
      if m then
        for k = 1, #m do
          local q = m[k]
          if q.stat == name then
            if q.op == "mul" then mul = mul * q.value
            elseif q.op == "set" then v = q.value
            else add = add + q.value end
          end
        end
      end
    end
  end
  return (v + add) * mul
end
function stat_set(e, name, v) e.base = e.base or {}; e.base[name] = v end

local function kill_by(e, src)
  if not e.alive then return end
  e.alive = false
  fire(e, "death", src)
  if not e.alive then emit("death", e) end
end

local function change_hp(e, n, src)
  if not e.def then return end
  if n >= 0 then e.hp = math.min(stat(e, "hp"), e.hp + n)
  elseif not e.invincible then
    e.hp = e.hp + n
    if e.hp <= 0 then kill_by(e, src) end
  end
end

-- fx_apply(e, name, [source]): start an effect made on the Entities tab
function fx_apply(e, name, src)
  local d = FX[name]
  if not d or not e.fx or not e.alive then return false end
  if (d.hp or 0) ~= 0 then change_hp(e, d.hp, src) end
  if (d.dur or 0) <= 0 then return true end
  for i = 1, #e.fx do
    if e.fx[i].name == name then
      if d.stack == "keep" then return true end
      if d.stack ~= "stack" then e.fx[i].t = 0 return true end
    end
  end
  e.fx[#e.fx + 1] = {name = name, def = d, t = 0}
  fire(e, "effect", name, src)
  return true
end
function fx_has(e, name)
  for i = 1, #(e.fx or {}) do if e.fx[i].name == name then return true end end
  return false
end
function fx_remove(e, name)
  local l = e.fx or {}
  for i = #l, 1, -1 do if l[i].name == name then table.remove(l, i) end end
end
function fx_clear(e) e.fx = {} end

local function update_fx(e)
  local l = e.fx
  for i = #l, 1, -1 do
    local f = l[i]
    f.t = f.t + 1
    local d = f.def
    if (d.every or 0) > 0 and f.t % d.every == 0 and (d.tick or 0) ~= 0 then change_hp(e, d.tick) end
    if f.t >= (d.dur or 0) then table.remove(l, i) end
  end
end

local function tint_of(e)
  local l = e.fx
  if not l then return nil end
  for i = #l, 1, -1 do
    local c = l[i].def.tint
    if c and c >= 0 then return c end
  end
  return nil
end

function ents_player(x, y, w, h)
  PLAYER.x, PLAYER.y, PLAYER.w, PLAYER.h = x, y, w or 8, h or 8
  TX, TY = x + PLAYER.w / 2, y + PLAYER.h / 2
  track(TX, TY)
end

local function matches(o, what)
  if not what or what == "" or what == "any" then return true end
  if what == "player" then return o.is_player == true end
  if what == "enemy" or what == "friend" then return o.team == what end
  return o.name == what
end
local function inside(o, x, y) return x >= o.x and y >= o.y and x < o.x + o.w and y < o.y + o.h end

-- raycast(x, y, dx, dy, len, [what], [ignore]) -> hit, hx, hy, thing
-- what: "wall", "player", "any", "enemy", "friend" or an entity type name. Walls block the ray.
function raycast(x, y, dx, dy, len, what, ignore)
  local d = math.sqrt(dx * dx + dy * dy)
  if d == 0 then return false end
  dx, dy = dx / d, dy / d
  local step = 0
  while step <= (len or 64) do
    local px, py = x + dx * step, y + dy * step
    if solid(px, py) then
      if what == "wall" then return true, px, py, "wall" end
      return false, px, py
    end
    if what ~= "wall" then
      if PLAYER.dummy and matches(PLAYER, what) and inside(PLAYER, px, py) then return true, px, py, PLAYER end
      for i = 1, #LIST do
        local o = LIST[i]
        if o.alive and o ~= ignore and matches(o, what) and inside(o, px, py) then return true, px, py, o end
      end
    end
    step = step + 2
  end
  return false, x + dx * len, y + dy * len
end

-- circlecast(x, y, r, [what], [ignore]) -> list of things inside the circle
function circlecast(x, y, r, what, ignore)
  local out = {}
  local function test(o)
    if o ~= ignore and o.alive and matches(o, what) then
      local cx = math.max(o.x, math.min(x, o.x + o.w))
      local cy = math.max(o.y, math.min(y, o.y + o.h))
      if (cx - x) ^ 2 + (cy - y) ^ 2 <= r * r then out[#out + 1] = o end
    end
  end
  if PLAYER.dummy then test(PLAYER) end
  for i = 1, #LIST do test(LIST[i]) end
  return out
end

-- ents_damage(e, amount, [source]): lowers hp, fires "hurt", and "death" at 0 hp
function ents_damage(e, n, src)
  if not e.alive or (e.inv or 0) > 0 or e.invincible then return false end
  e.hp = e.hp - (n or 1)
  e.inv = e.hurt_cd or 15
  if e.def and e.def.player then
    e.knock = 10
    e.knockdir = src and (src.x + src.w / 2 < e.x + e.w / 2 and 1 or -1) or -e.dir
    e.vy = -2.5
  end
  fire(e, "hurt", n, src)
  if e.hp <= 0 then kill_by(e, src) end
  return true
end

local function overlap(a, b) return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h end

local function contacts()
  for i = 1, #LIST do LIST[i].touch_now = {} end
  for i = 1, #LIST do
    local a = LIST[i]
    if a.alive then
      if PLAYER.dummy and overlap(a, PLAYER) then a.touch_now[#a.touch_now + 1] = PLAYER end
      for j = i + 1, #LIST do
        local b = LIST[j]
        if b.alive and overlap(a, b) then
          a.touch_now[#a.touch_now + 1] = b
          b.touch_now[#b.touch_now + 1] = a
        end
      end
    end
  end
  for i = 1, #LIST do
    local e = LIST[i]
    local was = e.touching or {}
    e.touching = {}
    for k = 1, #e.touch_now do
      local o = e.touch_now[k]
      e.touching[o] = true
      if not was[o] and e.alive then
        fire(e, "touch", o)
        local foe = o.team ~= e.team and not o.hidden and e.team ~= "neutral" and o.team ~= "neutral"
        if foe and e.def.stomp and o.is_player and not o.dummy and (o.vy_pre or 0) > 0 and o.y + o.h - e.y <= 6 then
          -- landed on its head
          ents_damage(e, 1, o)
          o.vy = -3.5
          o.mem.coyote = 0
        elseif foe then
          local hit = false
          if e.def.touch_fx and e.def.touch_fx ~= "" and o.fx then hit = fx_apply(o, e.def.touch_fx, e) end
          local dmg = stat(e, "damage")
          if dmg > 0 then
            if o.dummy then emit("player_hurt", dmg, e) else ents_damage(o, dmg, e) end
            hit = true
          end
          if hit and e.proj then e.alive = false end
        end
      end
    end
  end
end

local function cast_dir(e, dir)
  if dir == "up" then return 0, -1 elseif dir == "down" then return 0, 1
  elseif dir == "player" then local cx, cy = center(e); local tx, ty = target_of(e); return tx - cx, ty - cy end
  return e.dir, 0
end

local function assign_ids(n)
  if not n then return end
  nid = nid + 1
  n.id = nid
  n.p = n.p or {}
  n.c = n.c or {}
  for i = 1, #n.c do assign_ids(n.c[i]) end
end

-- ---------------------------------------------------------------- behavior nodes
-- each returns 1 = success, 0 = failure, 2 = running
local N = {}
local function tick(e, n)
  local f = N[n.t]
  if not f then return 0 end
  return f(e, n, n.p)
end

N.sequence = function(e, n)
  for i = 1, #n.c do local r = tick(e, n.c[i]); if r ~= 1 then return r end end
  return 1
end
N.selector = function(e, n)
  for i = 1, #n.c do local r = tick(e, n.c[i]); if r ~= 0 then return r end end
  return 0
end
N.invert = function(e, n)
  local c = n.c[1]; if not c then return 0 end
  local r = tick(e, c)
  if r == 2 then return 2 end
  return 1 - r
end

-- checks
N.near = function(e, n, p) return dist(e) < (p.dist or 48) and 1 or 0 end
N.far = function(e, n, p) return dist(e) >= (p.dist or 48) and 1 or 0 end
N.sees = function(e, n, p)
  local d, dx, dy = dist(e)
  return (d < (p.dist or 96) and math.abs(dy) < e.h + 8 and sign(dx) == e.dir) and 1 or 0
end
N.player_above = function(e, n, p) local _, dx, dy = dist(e); return (dy < -4 and math.abs(dx) < (p.dist or 24)) and 1 or 0 end
N.on_ground = function(e) return e.ground and 1 or 0 end
N.wall_ahead = function(e) return wall_ahead(e) and 1 or 0 end
N.ledge_ahead = function(e) return (e.ground and ledge_ahead(e)) and 1 or 0 end
N.chance = function(e, n, p) return rnd(100) <= (p.pct or 50) and 1 or 0 end
N.every = function(e, n, p) return ((e.age + e.phase) % math.max(1, p.frames or 60) == 0) and 1 or 0 end
N.hp_below = function(e, n, p) return e.hp < (p.hp or 2) and 1 or 0 end

-- actions
N.patrol = function(e, n, p)
  if wall_ahead(e) or (e.grav and e.ground and ledge_ahead(e)) then e.dir = -e.dir end
  e.vx = e.dir * (p.speed or 0.5) * stat(e, "speed")
  return 1
end
N.chase = function(e, n, p)
  local d, dx, dy = dist(e)
  local s = (p.speed or 0.7) * stat(e, "speed")
  if math.abs(dx) > 1 then e.dir = sign(dx) end
  if e.grav then
    e.vx = math.abs(dx) > 1 and e.dir * s or 0
  elseif d > 1 then
    e.vx, e.vy = dx / d * s, dy / d * s
  end
  return 1
end
N.flee = function(e, n, p)
  local d, dx, dy = dist(e)
  local s = (p.speed or 0.7) * stat(e, "speed")
  e.dir = dx > 0 and -1 or 1
  if e.grav then e.vx = e.dir * s
  elseif d > 0 then e.vx, e.vy = -dx / d * s, -dy / d * s end
  return 1
end
N.wander = function(e, n, p)
  if rnd(1000) <= (p.turn or 10) or wall_ahead(e) or (e.grav and e.ground and ledge_ahead(e)) then e.dir = -e.dir end
  e.vx = e.dir * (p.speed or 0.4) * stat(e, "speed")
  return 1
end
N.hover = function(e, n, p)
  e.vy = math.sin((e.age + e.phase) * (p.speed or 0.06)) * (p.height or 8) * (p.speed or 0.06)
  return 1
end
N.stop = function(e) e.vx = 0; if not e.grav then e.vy = 0 end return 1 end
N.jump = function(e, n, p)
  if not e.ground then return 0 end
  e.vy = -(p.power or 3.5)
  e.ground = false
  return 1
end
N.turn = function(e) e.dir = -e.dir return 1 end
N.face_player = function(e) local _, dx = dist(e); if dx ~= 0 then e.dir = sign(dx) end return 1 end
N.wait = function(e, n, p)
  local v = (e.mem[n.id] or 0) + 1
  if v >= (p.frames or 30) then e.mem[n.id] = 0 return 1 end
  e.mem[n.id] = v
  return 2
end
N.anim = function(e, n, p) e.anim_req = p.name return 1 end
N.say = function(e, n, p) e.say, e.say_t = tr(p.text or "..."), p.frames or 2 return 1 end
N.sound = function(e, n, p) sfx(p.note or "C5", p.wave or 0, p.vol or 0.4, p.frames or 8) return 1 end
N.shoot = function(e, n, p)
  local b = ents_spawn(p.type or "", 0, 0)
  if not b then return 0 end
  local cx, cy = center(e)
  b.x = e.dir > 0 and e.x + e.w or e.x - b.w
  b.y = cy - b.h / 2
  b.dir = e.dir
  b.team = e.team
  b.proj, b.pvx, b.pvy = true, e.dir * (p.speed or 1.5), 0
  if p.aim then
    local d, dx, dy = dist(e)
    if d > 0 then b.pvx, b.pvy = dx / d * (p.speed or 1.5), dy / d * (p.speed or 1.5) end
  end
  return 1
end
N.remove = function(e) e.alive = false return 1 end
N.set = function(e, n, p) e.data[p.key or "state"] = p.value return 1 end
N.is = function(e, n, p) return (tostring(e.data[p.key or "state"]) == tostring(p.value)) and 1 or 0 end

-- sensors and events
N.touching = function(e, n, p)
  local l = e.touch_now or {}
  for i = 1, #l do if matches(l[i], p.what) then return 1 end end
  return 0
end
N.ray = function(e, n, p)
  local cx, cy = center(e)
  local dx, dy = cast_dir(e, p.dir)
  return raycast(cx, cy, dx, dy, p.len or 64, p.what or "player", e) and 1 or 0
end
N.circle = function(e, n, p)
  local cx, cy = center(e)
  return #circlecast(cx, cy, p.radius or 24, p.what or "player", e) > 0 and 1 or 0
end
N.got_hurt = function(e) return (e.inv or 0) > 10 and 1 or 0 end
N.heard = function(e, n, p) return HEARD[p.event or ""] and 1 or 0 end
N.emit = function(e, n, p) emit(p.event or "event", e) return 1 end
N.level = function(e, n, p) level(math.floor(tonumber(p.n) or 1)) return 1 end
N.damage_touching = function(e, n, p)
  local l, hit = e.touch_now or {}, 0
  for i = 1, #l do
    local o = l[i]
    if matches(o, p.what) and o ~= e then
      if o.is_player then emit("player_hurt", p.amount or 1, e) hit = 1
      elseif ents_damage(o, p.amount or 1, e) then hit = 1 end
    end
  end
  return hit
end
N.set_tile = function(e, n, p)
  local cx, cy = center(e)
  mset(cx // 8 + (p.dx or 0), cy // 8 + (p.dy or 0), p.tile or 0)
  return 1
end

-- flow: run every child no matter what (good for the player: move AND shoot)
N.all = function(e, n)
  for i = 1, #n.c do tick(e, n.c[i]) end
  return 1
end
-- input
N.button = function(e, n, p)
  local b, pn = p.button or "a", e.pnum or 1   -- a player's entity reads its own player's buttons
  if p.mode == "held" then return btn(b, pn) and 1 or 0 end
  if p.mode == "released" then return btnr(b, pn) and 1 or 0 end
  return btnp(b, pn) and 1 or 0
end
N.controls = function(e, n, p)
  local m = e.mem
  local pn = e.pnum or 1         -- which player's buttons drive this entity
  local sp = (p.speed or 1) * stat(e, "speed")
  if p.run and p.run ~= "" and p.run ~= "none" then sp = sp * (1 + press(p.run, pn) / 128) end
  local dir = 0
  if btn("left", pn) then dir = -1 end
  if btn("right", pn) then dir = dir + 1 end
  if dir ~= 0 then e.dir = dir end
  e.vx = dir * sp
  if e.grav then
    m.coyote = e.ground and 6 or math.max(0, (m.coyote or 0) - 1)
    m.jbuf = btnp("a", pn) and 6 or math.max(0, (m.jbuf or 0) - 1)
    if m.jbuf > 0 and m.coyote > 0 then
      e.vy = -(p.jump or 4.2) * stat(e, "jump")
      m.jbuf, m.coyote = 0, 0
      e.ground = false
      if p.sound and p.sound ~= "" then sfx(p.sound, 5, 0.5, 10, nil, 0, 600) end
    end
    if not btn("a", pn) and e.vy < -1.5 then e.vy = -1.5 end
  else
    local dy = 0
    if btn("up", pn) then dy = -1 end
    if btn("down", pn) then dy = dy + 1 end
    e.vy = dy * sp
  end
  return 1
end
-- counters and spawning
-- count_up: adds 1 to a memory value each time it runs; succeeds once it reaches max (and keeps succeeding)
N.count_up = function(e, n, p)
  local k, mx = p.key or "count", math.max(1, p.max or 60)
  local v = math.min(mx, (tonumber(e.data[k]) or 0) + 1)
  e.data[k] = v
  if p.bar then e.bar = v / mx end
  return v >= mx and 1 or 0
end
N.spawn = function(e, n, p)
  local b = ents_spawn(p.type or "", e.x + (p.dx or 0), e.y + (p.dy or 0))
  if not b then return 0 end
  b.team = b.def.team or e.team
  return 1
end

-- stats and effects
N.has_effect = function(e, n, p) return fx_has(e, p.effect or "") and 1 or 0 end
N.count_below = function(e, n, p) return #ents_all(p.type) < (p.count or 3) and 1 or 0 end
N.apply_effect = function(e, n, p) return fx_apply(e, p.effect or "") and 1 or 0 end
N.remove_effect = function(e, n, p) fx_remove(e, p.effect or "") return 1 end
N.apply_touching = function(e, n, p)
  local l, hit = e.touch_now or {}, 0
  for i = 1, #l do
    local o = l[i]
    if o ~= e and matches(o, p.what) and o.fx and fx_apply(o, p.effect or "", e) then hit = 1 end
  end
  return hit
end

-- ---------------------------------------------------------------- public api
function ents_define(defs)
  DEFS = {}
  for i = 1, #defs do
    local d = defs[i]
    assign_ids(d.tree)
    d.anims = d.anims or {}
    DEFS[d.name] = d
  end
end

function ents_place(list)
  PLACED = list
  ents_reset()
end

function ents_reset()
  LIST = {}
  PLAYER = DUMMY
  PL = {}
  for i = 1, #PLACED do
    local p = PLACED[i]
    ents_spawn(p[1], p[2], p[3])
  end
  -- multiplayer: players 2..PLAYERS start next to player 1 as copies of its entity
  if PLAYER ~= DUMMY then
    for n = #PL + 1, PLAYERS or 1 do
      ents_spawn(PLAYER.name, PLAYER.x - PLAYER.ox - (n - 1) * 12, PLAYER.y - PLAYER.oy)
    end
  end
end

-- ents_players(): the list of player entities, player 1 first
function ents_players() return PL end
PLAYER_COL = {17, 22, 26, 27, 8, 3, 20, 12}
-- ents_player_pal(n, {from = to, ...}): recolour player n's sprite so players can tell themselves apart
PLAYER_PAL = { nil, {[16] = 22, [17] = 21, [15] = 21}, {[16] = 26, [17] = 25, [15] = 25}, {[16] = 27, [17] = 10, [15] = 10},
  {[16] = 8, [17] = 9, [15] = 9}, {[16] = 3, [17] = 4, [15] = 4}, {[16] = 20, [17] = 19, [15] = 19}, {[16] = 12, [17] = 11, [15] = 11} }
function ents_player_pal(n, map) PLAYER_PAL[n] = map end

function ents_spawn(name, x, y)
  local d = DEFS[name]
  if not d then return nil end
  local e = {
    name = name, def = d, x = x, y = y, vx = 0, vy = 0,
    w = (d.sw or 1) * 8 - (d.inset or 0) * 2, h = (d.sh or 1) * 8 - (d.inset or 0),
    ox = d.inset or 0, oy = d.inset or 0,
    dir = d.left and -1 or 1, hp = d.hp or 1, grav = d.grav ~= false, collide = d.collide ~= false,
    ground = false, alive = true, age = 0, phase = #LIST * 17, mem = {}, data = {},
    anim = "idle", anim_t = 0, team = d.team or "enemy", dmg = d.damage or 0, hidden = d.hidden, inv = 0,
    invincible = (d.hp or 1) <= 0, base = {}, fx = {},
    hurt_cd = d.hurt or (d.player and 60 or 15)
  }
  if d.player then
    e.is_player, e.team = true, "friend"
    if PLAYER == DUMMY then PLAYER = e end
    PL[#PL + 1] = e
    e.pnum = #PL
  end
  e.x = x + e.ox
  e.y = y + e.oy
  LIST[#LIST + 1] = e
  return e
end

-- ---------------------------------------------------------------- save data
-- save(t): keep a table (numbers, strings, booleans, nested tables) for next time. save(nil) clears it.
-- saved(): the table from the last save(), or nil. The host stores it per cart (browser storage, flash on the device).
local lua_load = load
local function ser(v, depth)
  local ty = type(v)
  if ty == "number" then
    if math.type(v) == "integer" then return tostring(v) end
    if v ~= v or v == math.huge or v == -math.huge then return "0" end
    return string.format("%.17g", v)
  elseif ty == "string" then return string.format("%q", v)
  elseif ty == "boolean" then return tostring(v)
  elseif ty == "table" then
    if depth > 16 then error("save: tables nested too deep", 3) end
    local keys = {}
    for k in pairs(v) do
      local kt = type(k)
      if kt ~= "number" and kt ~= "string" then error("save: keys must be numbers or strings", 3) end
      keys[#keys + 1] = k
    end
    table.sort(keys, function(a, b)
      if type(a) == type(b) then return a < b end
      return type(a) == "number"
    end)
    local out = {}
    for i = 1, #keys do out[i] = "[" .. ser(keys[i], depth + 1) .. "]=" .. ser(v[keys[i]], depth + 1) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  error("save: can't store a " .. ty, 3)
end
function save(v)
  if v == nil then _save_raw(nil) return true end
  _save_raw(ser(v, 0))
  return true
end
function saved()
  local s = _load_raw()
  if not s or s == "" then return nil end
  local f = lua_load("return " .. s, "save", "t", {})
  if not f then return nil end
  local ok, v = pcall(f)
  if ok then return v end
  return nil
end

-- ---------------------------------------------------------------- player names
-- Each Bit's owner sets a name and colour in the Settings app (USER). The host puts them in NAMES / NAME_COLORS
-- (player n's, the same on every linked Bit); on one Bit, player 1 is the owner. player_name(n, [max letters]).
function player_name(n, max)
  n = n or (((ME or 0) > 0) and ME or 1)
  local s = type(NAMES) == "table" and NAMES[n] or nil
  if type(s) ~= "string" or s == "" then s = "P" .. n end
  if max and #s > max then s = s:sub(1, max) end
  return s
end
function player_color(n, default)
  n = n or (((ME or 0) > 0) and ME or 1)
  local c = type(NAME_COLORS) == "table" and NAME_COLORS[n] or nil
  return math.type(c) == "integer" and c or (default or 13)
end
-- network event games (net_send): every Bit tells the others its owner's name now and then, as a reserved
-- event (-7700) that net_recv() keeps to itself. net_name(id, [max]) is the name of the Bit with that NET_ID.
-- -7701 is the game shell's linked race (bk_game.lua): _bk_net_pump() reads everything waiting each frame,
-- hands race events to the shell and keeps the rest for the game's own net_recv().
NET_NAMES, NET_COLORS = {}, {}
do
  local raw_send, raw_recv, said = net_send, net_recv, -1000
  local held = {}
  local function reserved(r)
    if r[2] == -7700 then
      local out = {}
      for k = 3, 6 do
        local v = r[k] or 0
        for _, x in ipairs({ v // 65536 % 256, v // 256 % 256, v % 256 }) do if x >= 32 and x < 127 then out[#out + 1] = string.char(x) end end
      end
      NET_NAMES[r[1]] = table.concat(out); NET_COLORS[r[1]] = r[7]
      return true
    end
    if r[2] == -7701 then
      if _bk_race_heard then _bk_race_heard(r[1], r[3], r[4], r[5]) end
      return true
    end
    return false
  end
  function _bk_net_pump()
    while true do
      local r = table.pack(raw_recv())
      if r[1] == nil then return end
      if not reserved(r) and #held < 256 then held[#held + 1] = r end
    end
  end
  local function pack(s, i)
    local v = 0
    for k = 0, 2 do v = v * 256 + (s:byte(i + k) or 0) end
    return v
  end
  function net_send(...)
    local me = type(NAMES) == "table" and NAMES[1] or ""
    if me ~= "" and (t() - said >= 120 or t() < said) then
      said = t()
      raw_send(-7700, pack(me, 1), pack(me, 4), pack(me, 7), pack(me, 10), type(NAME_COLORS) == "table" and NAME_COLORS[1] or 13)
    end
    return raw_send(...)
  end
  function net_recv()
    if #held > 0 then local r = table.remove(held, 1) return table.unpack(r, 1, r.n) end
    while true do
      local r = table.pack(raw_recv())
      if r[1] == nil then return nil end
      if not reserved(r) then return table.unpack(r, 1, r.n) end
    end
  end
end
function net_name(id, max)
  local s = id == NET_ID and type(NAMES) == "table" and NAMES[1] or NET_NAMES[id]
  if type(s) ~= "string" or s == "" then return nil end
  if max and #s > max then s = s:sub(1, max) end
  return s
end

-- ---------------------------------------------------------------- cutscenes
-- A cutscene is a list of steps made on the studio's Cutscenes tab (or by hand):
--   ents_cutscenes({ intro = {level = 1, steps = {{t = "say", p = {who = "sage", text = "Hi!"}}, ...}} })
-- cutscene(name) plays one. While it plays, behavior trees pause, nothing takes damage,
-- and the runtime draws letterbox bars, dialog boxes and fades on top of your game.
CUTSCENES = {}
local CUT, CUT_SEEN = nil, {}
local CAM, SHAKE, SHAKE_POW = nil, 0, 3    -- camera override {x, y}, shake frames and strength
local CAM_RETURN = nil                     -- {x, y, t}: easing back to the player after a cutscene
local CAM_LAST = {0, 0}                   -- where ents_camera last pointed
local FADE, FADE_TO, FADE_STEP = 0, 0, 0  -- 0 clear .. 1 black
local BARS, BOX = 0, nil                  -- letterbox height, dialog box {who, name, text, n}
local CUT_STEP = {}

function ents_cutscenes(list) CUTSCENES = list or {} end

-- any player pressed this button (cutscenes listen to everyone)
function anyp(b)
  for n = 1, PLAYERS or 1 do if btnp(b, n) then return true end end
  return false
end
local function who(name)
  if not name or name == "" then return nil end
  if name == "player" then return PLAYER ~= DUMMY and PLAYER or nil end
  return ents_get(name)
end
local function tilepos(p, key)
  local v = tonumber(p[key])
  return v and v * 8 or nil
end
local function cam_target(p)
  if p.target == "tile" then
    return (tonumber(p.x) or 0) * 8 + 4 - 160, (tonumber(p.y) or 0) * 8 + 4 - 120
  end
  local e = (p.target == nil or p.target == "" or p.target == "player") and PLAYER or who(p.target)
  if not e or e.dummy then return CAM_LAST[1], CAM_LAST[2] end
  return math.floor(e.x + e.w / 2 - 160), math.floor(e.y + e.h / 2 - 120)
end
local function clamp_cam(x, y)
  return math.max(0, math.min(x, ENT_WORLD_W - 320)), math.max(0, math.min(y, ENT_WORLD_H - 240))
end

-- each step: start(s, p) once, then update(s, p, skip) every frame until it returns true
CUT_STEP.say = {
  start = function(s, p)
    local e = who(p.who)
    local name = p.name
    if not name or name == "" then name = (e and p.who ~= "player") and p.who:gsub("^%l", string.upper):gsub("_", " ") or "" end
    BOX = {who = e, name = tr(name), text = tr(tostring(p.text or "")), n = 0}   -- the Bit's language (texts{})
    if e and e ~= PLAYER and PLAYER ~= DUMMY then e.dir = (PLAYER.x > e.x) and 1 or -1 end
  end,
  update = function(s, p, skip)
    if skip then BOX = nil return true end
    BOX.n = math.min(#BOX.text, BOX.n + 1)
    if BOX.n % 2 == 1 and BOX.n < #BOX.text and BOX.text:sub(BOX.n, BOX.n) ~= " " then sfx(p.voice or "A5", 1, 0.06, 2) end
    local auto = tonumber(p.frames) or 0
    if s.t > 4 and (anyp("a") or anyp("b")) then
      if BOX.n < #BOX.text then BOX.n = #BOX.text else BOX = nil return true end
    end
    if auto > 0 and BOX.n >= #BOX.text and s.t >= auto then BOX = nil return true end
  end,
}
CUT_STEP.wait = { update = function(s, p, skip) return skip or s.t >= (tonumber(p.frames) or 30) end }
CUT_STEP.camera = {
  start = function(s, p)
    s.fx, s.fy = CAM and CAM[1] or CAM_LAST[1], CAM and CAM[2] or CAM_LAST[2]
    s.back = (p.target == nil or p.target == "" or p.target == "player")
  end,
  update = function(s, p, skip)
    local tx, ty = clamp_cam(cam_target(p))
    local n = math.max(1, tonumber(p.frames) or 60)
    local k = skip and 1 or math.min(1, s.t / n)
    k = k * k * (3 - 2 * k)
    CAM = {s.fx + (tx - s.fx) * k, s.fy + (ty - s.fy) * k}
    if k >= 1 then
      if s.back then CAM = nil end
      return true
    end
  end,
}
CUT_STEP.move = {
  start = function(s, p) s.e = who(p.who) end,
  update = function(s, p, skip)
    local e = s.e
    if not e or not e.alive then return true end
    local tx, ty = tilepos(p, "x"), tilepos(p, "y")
    local sp = tonumber(p.speed) or 1
    if skip or s.t > 900 then
      if tx then e.x = tx end
      if ty and not e.grav then e.y = ty end
      e.cut_vx, e.cut_vy = nil, nil
      return true
    end
    local done = true
    e.cut_vx, e.cut_vy = 0, nil
    if tx and math.abs(tx - e.x) > sp then e.cut_vx = sign(tx - e.x) * sp; e.dir = sign(tx - e.x); done = false end
    if ty and not e.grav and math.abs(ty - e.y) > sp then e.cut_vy = sign(ty - e.y) * sp; done = false end
    if done then
      if tx then e.x = tx end
      if ty and not e.grav then e.y = ty end
      e.cut_vx, e.cut_vy = nil, nil
    end
    return done
  end,
}
CUT_STEP.jump = { start = function(s, p) local e = who(p.who); if e and e.grav then e.vy = -(tonumber(p.power) or 3.5); e.ground = false end end }
CUT_STEP.face = {
  start = function(s, p)
    local e = who(p.who)
    if not e then return end
    if p.dir == "left" then e.dir = -1 elseif p.dir == "right" then e.dir = 1
    elseif PLAYER ~= DUMMY and e ~= PLAYER then e.dir = (PLAYER.x > e.x) and 1 or -1 end
  end,
}
CUT_STEP.anim = { start = function(s, p) local e = who(p.who); if e then e.cut_anim = (p.name ~= "" and p.name) or nil end end }
CUT_STEP.fade = {
  start = function(s, p)
    FADE_TO = p.to == "clear" and 0 or 1
    local n = tonumber(p.frames) or 30
    if n <= 0 then FADE = FADE_TO end
    FADE_STEP = 1 / math.max(1, n)
  end,
  update = function(s, p, skip)
    if skip then FADE = FADE_TO end
    return FADE == FADE_TO
  end,
}
CUT_STEP.shake = { start = function(s, p) SHAKE = tonumber(p.frames) or 20; SHAKE_POW = tonumber(p.power) or 3 end }
CUT_STEP.sound = { start = function(s, p) sfx(p.note or "C5", tonumber(p.wave) or 0, 0.4, 10) end }
CUT_STEP.emit = { start = function(s, p) emit(p.event or "event") end }
CUT_STEP.tile = { start = function(s, p) mset(tonumber(p.x) or 0, tonumber(p.y) or 0, tonumber(p.tile) or 0) end }
CUT_STEP.spawn = { start = function(s, p) ents_spawn(p.type or "", (tonumber(p.x) or 0) * 8, (tonumber(p.y) or 0) * 8) end }
CUT_STEP.remove = { start = function(s, p) local e = who(p.who); if e and not e.is_player then e.alive = false end end }
CUT_STEP.level = { start = function(s, p) level(math.floor(tonumber(p.n) or 1)) end }
CUT_STEP.code = { start = function(s, p) emit(p.event or "cutscene_code") end }

local function cut_begin()
  local st = CUT.steps[CUT.i]
  CUT.s = {t = 0}
  local d = st and CUT_STEP[st.t]
  if d and d.start then d.start(CUT.s, st.p or {}) end
end

local function cut_finish()
  local name = CUT.name
  CUT = nil
  BOX = nil
  FADE_TO = 0; FADE_STEP = math.max(FADE_STEP, 1 / 20)
  if CAM then CAM_RETURN = {CAM[1], CAM[2], 0} end
  CAM = nil
  for i = 1, #LIST do LIST[i].cut_vx, LIST[i].cut_vy, LIST[i].cut_anim = nil, nil, nil end
  emit("cutscene_end", name)
end

-- runs inside ents_update; returns true while a cutscene is playing
local function cut_update()
  if FADE ~= FADE_TO then
    FADE = FADE < FADE_TO and math.min(FADE_TO, FADE + FADE_STEP) or math.max(FADE_TO, FADE - FADE_STEP)
  end
  if SHAKE > 0 then SHAKE = SHAKE - 1 end
  if not CUT then BARS = math.max(0, BARS - 2) return false end
  BARS = math.min(20, BARS + 2)
  if anyp("start") then CUT.skip = true end
  for _ = 1, CUT.skip and 400 or 1 do
    local st = CUT.steps[CUT.i]
    if not st then cut_finish() return false end
    local d = CUT_STEP[st.t]
    local done = true
    if d and d.update then done = d.update(CUT.s, st.p or {}, CUT.skip) end
    CUT.s.t = CUT.s.t + 1
    if not done then return true end
    CUT.i = CUT.i + 1
    if not CUT.steps[CUT.i] then cut_finish() return false end
    cut_begin()
  end
  return CUT ~= nil
end

-- cutscene(name, [once]): play a cutscene. With once, it plays only the first time.
function cutscene(name, once)
  local c = CUTSCENES[name]
  if not c then print("no cutscene called " .. tostring(name)) return false end
  if once and CUT_SEEN[name] then return false end
  CUT_SEEN[name] = true
  if CUT then cut_finish() end
  CUT = {name = name, steps = c.steps or c, i = 1}
  if not CUT.steps[1] then CUT = nil return false end
  cut_begin()
  emit("cutscene", name)
  return true
end
function cutscene_playing() return CUT ~= nil, CUT and CUT.name end
-- cutscene_skip(): jump to the end of the playing cutscene, as if Start was pressed
function cutscene_skip() if CUT then CUT.skip = true end end
-- cutscenes_reset(): forget which cutscenes have played, so level intros and once-only cutscenes play again
function cutscenes_reset() CUT_SEEN = {} end

local function level_intro(n)
  for name, c in pairs(CUTSCENES) do
    if tonumber(c.level) == n then cutscene(name, true) return end
  end
end

N.cutscene = function(e, n, p) cutscene(p.name or "", p.once ~= false) return 1 end

-- word wrap for the dialog box
local function wrap(s, w)
  local out, line = {}, ""
  for word in s:gmatch("%S+") do
    if line == "" then line = word
    elseif #line + 1 + #word <= w then line = line .. " " .. word
    else out[#out + 1] = line; line = word end
  end
  if line ~= "" then out[#out + 1] = line end
  return out
end

local DITHER = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5}
function _bk_overlay()
  if FADE > 0 then
    if FADE >= 1 then rectfill(0, 0, 320, 240, 1)
    else
      local lvl = math.floor(FADE * 16)
      for y = 0, 239 do
        if DITHER[y % 16 + 1] < lvl then rectfill(0, y, 320, 1, 1) end
      end
    end
  end
  if BARS > 0 then
    rectfill(0, 0, 320, BARS, 1)
    rectfill(0, 240 - BARS, 320, BARS, 1)
  end
  if BOX then
    local x, y, w, h = 8, 240 - 20 - 66, 304, 62
    -- keep the speaker visible: if they stand in the lower half of the screen, the box goes to the top
    if BOX.who and BOX.who.alive and BOX.who.y + BOX.who.h / 2 - CAM_LAST[2] > 130 then y = 24 end
    rectfill(x, y, w, h, 1)
    rect(x, y, w, h, 13)
    rect(x + 2, y + 2, w - 4, h - 4, 29)
    local tx = x + 10
    if BOX.who and BOX.who.alive then
      local e = BOX.who
      rectfill(x + 8, y + 10, 36, 36, 31)
      rect(x + 8, y + 10, 36, 36, 29)
      local sw, sh = e.def.sw or 1, e.def.sh or 1
      local sc = (sw > 2 or sh > 2) and 1 or 2
      local px = x + 26 - sw * 4 * sc
      local py = y + 28 - sh * 4 * sc
      spr(ents_frame(e), px, py, sw, sh, e.def.left or false, false, sc)
      tx = x + 52
    end
    local ty = y + 8
    if BOX.name ~= "" then text(BOX.name, tx, ty, 27) ty = ty + 12 end
    local shown = BOX.text:sub(1, BOX.n)
    local lines = wrap(shown, (x + w - 8 - tx) // 8)
    for i = 1, math.min(#lines, BOX.name ~= "" and 4 or 5) do text(lines[i], tx, ty + (i - 1) * 10, 13) end
    if BOX.n >= #BOX.text and (time() * 2) % 2 < 1.2 then text("v", x + w - 14, y + h - 12, 27) end
  end
  if CUT and BARS >= 20 then local s = tr("START skip") text(s, 312 - #s * 8, 226, 29) end
end

function ents_target(x, y) TX, TY = x, y end
function ents_get(name) return ents_all(name)[1] end

-- ents_camera([world_w], [world_h]): centre the camera on the player, clamped to the world. Returns cx, cy.
-- where the camera looks: this device's player, or (sharing one screen) the middle of all living players
local function view_point()
  if (ME or 0) > 0 and PL[ME] then local p = PL[ME]; return p.x + p.w / 2, p.y + p.h / 2 end
  if #PL > 1 then
    local x0, x1, y0, y1
    for i = 1, #PL do
      local p = PL[i]
      if p.alive then
        x0 = math.min(x0 or p.x, p.x); x1 = math.max(x1 or p.x + p.w, p.x + p.w)
        y0 = math.min(y0 or p.y, p.y); y1 = math.max(y1 or p.y + p.h, p.y + p.h)
      end
    end
    if x0 then return (x0 + x1) / 2, (y0 + y1) / 2 end
  end
  local p = PLAYER
  return p.x + p.w / 2, p.y + p.h / 2
end
-- sharing a screen: nobody may walk out of the view (deterministic, so linked games skip it)
local function keep_together()
  local mx = view_point()
  local cx = math.max(0, math.min(math.floor(mx - 160), ENT_WORLD_W - 320))
  for i = 1, #PL do
    local p = PL[i]
    if p.alive then
      if p.x < cx then p.x = cx end
      if p.x + p.w > cx + 320 then p.x = cx + 320 - p.w end
    end
  end
end

function ents_camera(ww, wh)
  ww, wh = ww or ENT_WORLD_W, wh or ENT_WORLD_H
  local vx, vy = view_point()
  local cx = math.floor(vx - 160)
  local cy = math.floor(vy - 120)
  cx = math.max(0, math.min(cx, ww - 320))
  cy = math.max(0, math.min(cy, wh - 240))
  if CAM then
    cx, cy = math.floor(CAM[1]), math.floor(CAM[2])
  elseif CAM_RETURN then          -- ease back to the player after a cutscene moved the camera
    local r = CAM_RETURN
    r[3] = r[3] + 1
    local k = math.min(1, r[3] / 24)
    k = k * k * (3 - 2 * k)
    cx, cy = math.floor(r[1] + (cx - r[1]) * k), math.floor(r[2] + (cy - r[2]) * k)
    if k >= 1 then CAM_RETURN = nil end
  end
  CAM_LAST[1], CAM_LAST[2] = cx, cy
  if SHAKE > 0 then
    cx = math.max(0, cx + rnd(SHAKE_POW * 2 + 1) - SHAKE_POW - 1)
    cy = math.max(0, cy + rnd(SHAKE_POW * 2 + 1) - SHAKE_POW - 1)
  end
  camera(cx, cy)
  return cx, cy
end
function ents_kill(e) e.alive = false end
function ents_all(name)
  local out = {}
  for i = 1, #LIST do
    local e = LIST[i]
    if e.alive and (not name or e.name == name) then out[#out + 1] = e end
  end
  return out
end
function ents_touch(x, y, w, h)
  local out = {}
  for i = 1, #LIST do
    local e = LIST[i]
    if e.alive and x < e.x + e.w and e.x < x + w and y < e.y + e.h and e.y < y + h then out[#out + 1] = e end
  end
  return out
end

local function move(e)
  e.hitwall = false
  local dx = e.vx
  local steps = math.ceil(math.abs(dx))
  if steps > 0 then
    local s = dx / steps
    for i = 1, steps do
      if e.collide and hits(e.x + s, e.y, e.w, e.h) then e.hitwall = true break end
      e.x = e.x + s
    end
  end
  local dy = e.vy
  steps = math.ceil(math.abs(dy))
  if steps > 0 then
    local s = dy / steps
    for i = 1, steps do
      if e.collide and hits(e.x, e.y + s, e.w, e.h) then
        e.hitwall = e.hitwall or not e.grav
        e.vy = 0
        break
      end
      e.y = e.y + s
    end
  end
  e.ground = e.grav and e.collide and hits(e.x, e.y + 1, e.w, e.h)
end

-- ---- levels: each has its own map (swapped in by the host) and its own placed entities
LEVEL, LEVELS = 1, {}
local LEVEL_PENDING = nil

-- called by the studio's generated data: LEVELS[n] = {name=, w=, h=, placed={...}}
function ents_levels(list, start)
  LEVELS = list
  LEVEL = (list[start or 1] and (start or 1)) or 1
  local L = LEVELS[LEVEL]
  if L then
    ENT_WORLD_W, ENT_WORLD_H = L.w * 8, L.h * 8
    ents_place(L.placed)
  end
  level_intro(LEVEL)
end

-- level(n): switch to level n at the start of the next frame. The player keeps its HP and data.
function level(n)
  if not LEVELS[n] or LEVEL_PENDING then return false end
  _level_map(n)
  LEVEL_PENDING = n
  return true
end

local function apply_level()
  local n = LEVEL_PENDING
  LEVEL_PENDING = nil
  local L = LEVELS[n]
  LEVEL = n
  ENT_WORLD_W, ENT_WORLD_H = L.w * 8, L.h * 8
  local old = {}
  for i = 1, #PL do old[i] = PL[i] end
  PLACED = L.placed
  ents_reset()
  if #old > 0 then
    if PLAYER ~= DUMMY then
      for i = 1, #old do
        if PL[i] then PL[i].hp, PL[i].data = old[i].hp, old[i].data end
      end
    else
      for i = 1, #old do LIST[#LIST + 1] = old[i] end
      PL, PLAYER = old, old[1]
    end
  end
  emit("level", n, L.name)
  level_intro(n)
end

function ents_update()
  if LEVEL_PENDING then apply_level() end
  local cut = cut_update()      -- a cutscene pauses behavior trees and damage
  HEARD, PENDING = PENDING, {}
  if not PLAYER.dummy and PLAYER.alive then
    TX, TY = PLAYER.x + PLAYER.w / 2, PLAYER.y + PLAYER.h / 2
    track(TX, TY)
  end
  if (ME or 0) == 0 and #PL > 1 then keep_together() end
  for i = 1, #LIST do
    local e = LIST[i]
    if e.alive then
      e.age = e.age + 1
      if e.inv > 0 then e.inv = e.inv - 1 end
      e.anim_req = nil
      if e.proj then e.vx, e.vy = e.pvx, e.pvy
      else
        e.vx = 0
        if not e.grav then e.vy = 0 end
      end
      update_fx(e)
      if cut then
        if e.cut_vx then e.vx = e.cut_vx end
        if e.cut_vy then e.vy = e.cut_vy end
        e.anim_req = e.cut_anim
      elseif e.def.tree and e.alive then tick(e, e.def.tree) end
      if (e.knock or 0) > 0 then e.vx = e.knockdir * 1.5; e.knock = e.knock - 1 end
      e.vy_pre = e.vy
      if e.grav then
        if e.ground and e.vy > 0 then e.vy = 0 end
        e.vy = math.min(e.vy + ENT_GRAVITY, ENT_MAX_FALL)
      end
      move(e)
      if e.proj and (e.hitwall or e.age > 600) then e.alive = false end
      if e.y > ENT_WORLD_H + 16 or e.x < -64 or e.x > ENT_WORLD_W + 64 then
        if e.is_player then kill_by(e) else e.alive = false end
      end
      if e.say_t then
        e.say_t = e.say_t - 1
        if e.say_t <= 0 then e.say, e.say_t = nil, nil end
      end
      -- pick an animation: one requested by the tree, else walk / jump / idle if they exist
      local a = e.def.anims
      local want = e.anim_req
      if not want then
        if not e.ground and e.grav and a.jump then want = "jump"
        elseif math.abs(e.vx) > 0.05 and a.walk then want = "walk"
        else want = "idle" end
      end
      if want ~= e.anim then e.anim, e.anim_t = want, 0 else e.anim_t = e.anim_t + 1 end
    end
  end
  if not cut then contacts() end
  -- drop dead entities, keeping order (deterministic)
  local j = 0
  for i = 1, #LIST do
    if LIST[i].alive then j = j + 1; LIST[j] = LIST[i] end
  end
  for i = #LIST, j + 1, -1 do LIST[i] = nil end
end

function ents_frame(e)
  local a = e.def.anims[e.anim] or e.def.anims.idle
  if not a or not a.f or #a.f == 0 then
    for _, v in pairs(e.def.anims) do a = v break end
    if not a or not a.f or #a.f == 0 then return 0 end
  end
  return a.f[(e.anim_t // math.max(1, a.s or 8)) % #a.f + 1]
end

function ents_draw()
  for i = 1, #LIST do
    local e = LIST[i]
    if e.alive and not e.hidden and not (e.inv > 0 and e.inv % 4 < 2) then
      local flip = e.dir < 0
      if e.def.left then flip = not flip end
      local tint = tint_of(e)
      local swap = e.pnum and e.pnum > 1 and PLAYER_PAL[e.pnum]
      if swap then for a, b in pairs(swap) do pal(a, b) end end
      if tint and (e.age // 6) % 2 == 0 then pal(tint) end
      spr(ents_frame(e), math.floor(e.x - e.ox), math.floor(e.y - e.oy), e.def.sw or 1, e.def.sh or 1, flip)
      if tint or swap then pal() end
    end
  end
  for i = 1, #LIST do
    local e = LIST[i]
    if e.alive and e.bar and e.bar < 1 then
      local x, y = math.floor(e.x + e.w / 2 - 10), math.floor(e.y - e.oy) - 6
      rectfill(x, y, 20, 4, 1)
      rectfill(x + 1, y + 1, math.floor(18 * e.bar), 2, 17)
    end
  end
  -- with several players, a little arrow in each player's colour shows who is who
  if #PL > 1 then
    for i = 1, #PL do
      local e = PL[i]
      if e.alive then
        local x, y = math.floor(e.x + e.w / 2), math.floor(e.y - e.oy) - 6
        local c = PLAYER_COL[i] or 13
        line(x - 2, y, x + 2, y, c) line(x - 1, y + 1, x + 1, y + 1, c) pset(x, y + 2, c)
      end
    end
  end
  for i = 1, #LIST do
    local e = LIST[i]
    if e.alive and e.say then
      local w = #e.say * 8 + 6
      local x = math.floor(e.x + e.w / 2 - w / 2)
      local y = math.floor(e.y - e.oy) - 14
      rectfill(x, y, w, 11, 13)
      rect(x, y, w, 11, 1)
      text(e.say, x + 3, y + 2, 1)
    end
  end
end
