-- BitKit entity system. Built into the runtime and loaded before every cart.
-- Entity types (sprites, animations, behavior trees) come from the studio's Entities tab.
-- MIT License.

ENT_SOLID_FLAG = 0       -- map tiles with this sprite flag block entities
ENT_GRAVITY = 0.25
ENT_MAX_FALL = 4

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
local function dist(e)
  local cx, cy = center(e)
  local dx, dy = TX - cx, TY - cy
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
PLAYER = {name = "player", is_player = true, team = "friend", alive = true, x = -999, y = -999, w = 8, h = 8}
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
      if PLAYER ~= ignore and matches(PLAYER, what) and inside(PLAYER, px, py) then return true, px, py, PLAYER end
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
  test(PLAYER)
  for i = 1, #LIST do test(LIST[i]) end
  return out
end

-- ents_damage(e, amount, [source]): lowers hp, fires "hurt", and "death" at 0 hp
function ents_damage(e, n, src)
  if not e.alive or (e.inv or 0) > 0 or e.invincible then return false end
  e.hp = e.hp - (n or 1)
  e.inv = 15
  fire(e, "hurt", n, src)
  if e.hp <= 0 then
    e.alive = false
    fire(e, "death", src)
    emit("death", e)
  end
  return true
end

local function overlap(a, b) return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h end

local function contacts()
  for i = 1, #LIST do LIST[i].touch_now = {} end
  for i = 1, #LIST do
    local a = LIST[i]
    if a.alive then
      if overlap(a, PLAYER) then a.touch_now[#a.touch_now + 1] = PLAYER end
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
        local dmg = e.dmg or 0
        if dmg > 0 and o.team ~= e.team and not o.hidden and e.team ~= "neutral" then
          if o.is_player then emit("player_hurt", dmg, e) else ents_damage(o, dmg, e) end
          if e.proj then e.alive = false end
        end
      end
    end
  end
end

local function cast_dir(e, dir)
  if dir == "up" then return 0, -1 elseif dir == "down" then return 0, 1
  elseif dir == "player" then local cx, cy = center(e); return TX - cx, TY - cy end
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
  e.vx = e.dir * (p.speed or 0.5)
  return 1
end
N.chase = function(e, n, p)
  local d, dx, dy = dist(e)
  local s = p.speed or 0.7
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
  local s = p.speed or 0.7
  e.dir = dx > 0 and -1 or 1
  if e.grav then e.vx = e.dir * s
  elseif d > 0 then e.vx, e.vy = -dx / d * s, -dy / d * s end
  return 1
end
N.wander = function(e, n, p)
  if rnd(1000) <= (p.turn or 10) or wall_ahead(e) or (e.grav and e.ground and ledge_ahead(e)) then e.dir = -e.dir end
  e.vx = e.dir * (p.speed or 0.4)
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
N.say = function(e, n, p) e.say, e.say_t = p.text or "...", p.frames or 2 return 1 end
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
  for i = 1, #PLACED do
    local p = PLACED[i]
    ents_spawn(p[1], p[2], p[3])
  end
end

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
    invincible = (d.hp or 1) <= 0
  }
  e.x = x + e.ox
  e.y = y + e.oy
  LIST[#LIST + 1] = e
  return e
end

function ents_target(x, y) TX, TY = x, y end
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

function ents_update()
  HEARD, PENDING = PENDING, {}
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
      if e.def.tree then tick(e, e.def.tree) end
      if e.grav then
        if e.ground and e.vy > 0 then e.vy = 0 end
        e.vy = math.min(e.vy + ENT_GRAVITY, ENT_MAX_FALL)
      end
      move(e)
      if e.proj and (e.hitwall or e.age > 600) then e.alive = false end
      if e.y > 128 * 8 + 64 or e.x < -64 or e.x > 256 * 8 + 64 then e.alive = false end
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
  contacts()
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
      spr(ents_frame(e), math.floor(e.x - e.ox), math.floor(e.y - e.oy), e.def.sw or 1, e.def.sh or 1, flip)
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
