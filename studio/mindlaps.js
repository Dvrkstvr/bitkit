/* Demo cart "Mind Laps": a daily brain jog of five quick exercises, alone or with 2-8 players. Original art and code. MIT License. */
(function () {
  const code = `-- Mind Laps: a daily brain jog. Five laps, one quick exercise each (30 seconds):
--   Quick Sums (maths), Arrow Echo (memory), Next Up (logic), Firefly Jars (counting at a glance), Lanterns (reaction).
-- Answers sit on the d-pad: press the direction of the right answer. Lanterns: A when the lantern glows green.
-- Alone: the Daily Jog (the same five laps for everybody on a given day, a medal, and a streak of days in a row,
-- dated by the Bit's clock) or Practice (one exercise; each exercise gets harder as you get better at it).
-- 2-8 players, on one screen or on linked Bits: Race (first right answer scores) or Team (every right answer
-- counts towards one shared medal).
-- Linked Bits run in lockstep: the game logic only uses rnd() and the frame count (clock() only decides the
-- solo Daily Jog), and drawing never calls rnd().

LAP_T = tune("Seconds per lap", 30, 10, 60, 5) * 60
GOLD, SILVER, BRONZE = 400, 300, 200
DIRS = { "up", "right", "down", "left" }
KEYS = { "up", "right", "down", "left", "a", "b" }
PC = { 21, 26, 16, 27, 5, 10, 22, 13 }     -- player colours
EX = {
  { name = "QUICK SUMS", kind = "maths", how = "Press the direction of the right answer." },
  { name = "ARROW ECHO", kind = "memory", how = "Watch the arrows, then press them in the same order." },
  { name = "NEXT UP", kind = "logic", how = "What comes next? Press the direction of it." },
  { name = "FIREFLY JARS", kind = "counting", how = "Which jar has more fireflies? Left or right." },
  { name = "LANTERNS", kind = "reaction", how = "A as soon as a lantern glows green. Not on red!" },
}

function _init()
  game{
    title = "Mind Laps",
    players = {1, 8},
    goal = "Run a Daily Jog of five brain laps and earn a gold medal (" .. GOLD .. " points).",
    help = {
      "Five laps of 30 seconds, one exercise each: maths, memory, logic, counting and reaction.",
      "Answers sit on the d-pad: press the direction of the right one. Lanterns: A on green, never on red.",
      "Daily Jog: a new jog every day, the same for everybody. Run one every day to grow your streak.",
      "Practice: one exercise at a time. Each exercise gets harder as you get better at it.",
      "Together: Race (the first right answer scores, a wrong one locks you out of that question) or Team.",
    },
    continue = function(cp) resume(cp) end,
    title_draw = function(t) draw_title(t) end,
    look = { title = 27, shadow = 2, panel = 19, edge = 22, hi = 20, text = 23, pick = 27, goal = 13, footer = 22, menu = "right" },
  }
  NP = math.max(1, math.min(PLAYERS or 1, 8))
  SOLO = NP == 1 and (ME or 0) == 0
  gt, last_t, pick_t = 0, -9, 0
  pad, edge = {}, {}
  sel, psel = 1, 1
  load_stats()
  state = "pick"
end

-- ---------------------------------------------------------------- helpers
function mid(a, v, b) return math.max(a, math.min(v, b)) end
function ctext(s, y, c, sc) sc = sc or 1 s = tr(s) text(s, 160 - #s * 4 * sc, y, c, sc) end
function stext(s, y, c, sc) sc = sc or 1 s = tr(s) text(s, 161 - #s * 4 * sc, y + sc, 1, sc) ctext(s, y, c, sc) end
function ttext(s, x, y, c, sc) sc = sc or 1 s = tr(s) text(s, x - #s * 4 * sc, y, c, sc) end
function shuffle(t) for i = #t, 2, -1 do local j = rnd(i) t[i], t[j] = t[j], t[i] end return t end
function today() return clock and (clock() // 86400) or 0 end

function read_pads()
  local fresh = t() ~= last_t + 1          -- back from a menu: what is held now doesn't count as a new press
  last_t = t()
  for p = 1, NP do
    local now, was = {}, pad[p] or {}
    edge[p] = {}
    for _, k in ipairs(KEYS) do
      now[k] = btn(k, p)
      edge[p][k] = now[k] and not was[k] and not fresh
    end
    pad[p] = now
  end
end
function any_edge(k) for p = 1, NP do if edge[p][k] then return p end end end
function dir_edge(p) for d, k in ipairs(DIRS) do if edge[p][k] then return d end end end

-- ---------------------------------------------------------------- stats kept in the save (solo only)
function load_stats()
  local s = SOLO and saved() or nil
  if type(s) ~= "table" then s = {} end
  S = {
    lv = s.lv or { 1, 1, 1, 1, 1 },          -- each exercise's level (1-9), grows as you get better
    best = s.best or { 0, 0, 0, 0, 0 },      -- best lap score per exercise
    streak = s.streak or 0, top = s.top or 0, last = s.last or -9,
    hist = s.hist or {},                     -- [day] = that day's best jog score
    jog_best = s.jog_best or 0, golds = s.golds or 0,
  }
end
function keep_stats()
  if not SOLO then return end
  local h, d = {}, today()
  for k, v in pairs(S.hist) do if k > d - 14 then h[k] = v end end   -- two weeks is plenty
  S.hist = h
  save(S)
end
function medal(sc) return sc >= GOLD and 3 or (sc >= SILVER and 2 or (sc >= BRONZE and 1 or 0)) end
MEDAL = { [0] = { "NO MEDAL", 29 }, { "BRONZE", 9 }, { "SILVER", 29 }, { "GOLD", 27 } }

-- ---------------------------------------------------------------- runs
-- run = {mode = "daily" | "practice" | "race" | "team", laps = {exercise...}, n = lap number, pts = {per player}, lap_pts = {...}}
function start_run(mode, ex, cp)
  run = { mode = mode, n = 1, pts = {}, scores = {}, day = today() }
  for p = 1, NP do run.pts[p] = 0 end
  if mode == "daily" then
    srand(run.day * 7919 + 17)                 -- the same jog for everybody today
    run.laps = shuffle({ 1, 2, 3, 4, 5 })
    run.seed = rnd(1, 1000000)
  elseif mode == "practice" then
    run.laps = { ex }
  else
    run.laps = shuffle({ 1, 2, 3, 4, 5 })
  end
  if cp then run.n, run.scores, run.laps = cp.lap, cp.scores or {}, cp.laps or run.laps end
  begin_lap()
end

function resume(cp)
  if cp and cp.mode == "daily" and cp.day == today() and (cp.lap or 9) <= 5 and SOLO then
    start_run("daily", nil, cp)
  else
    state, pick_t = "pick", 0
  end
end

function level_of(e)
  if SOLO then return S.lv[e] end
  return math.min(9, 1 + run.n)                -- together: every lap a little harder
end

function begin_lap()
  local e = run.laps[run.n]
  if run.mode == "daily" then srand(run.seed + run.n * 101) end
  lap = { e = e, lv = level_of(e), left = LAP_T, pts = {}, right = 0, wrong = 0, qn = 0 }
  for p = 1, NP do lap.pts[p] = 0 end
  state, state_t = "intro", 0
end

function end_lap()
  local e = lap.e
  local sc = 0
  if run.mode == "race" then
    for p = 1, NP do run.pts[p] = run.pts[p] + lap.pts[p] end
  else
    sc = mid(0, lap.pts[1], 100)
    run.scores[#run.scores + 1] = sc
  end
  if SOLO then
    if sc > S.best[e] then S.best[e] = sc end
    if sc >= 75 then S.lv[e] = math.min(9, S.lv[e] + 1) elseif sc < 35 then S.lv[e] = math.max(1, S.lv[e] - 1) end
  end
  lap.score = sc
  state, state_t = "lapdone", 0
  sfx("C5", 1, 0.3, 6) sfx("G5", 1, 0.3, 12)
  if run.mode == "daily" then
    checkpoint({ mode = "daily", day = run.day, lap = run.n + 1, scores = run.scores, laps = run.laps })
    keep_stats()
  elseif SOLO then keep_stats() end
end

function next_lap()
  if run.n < #run.laps then run.n = run.n + 1 begin_lap() return end
  finish_run()
end

function total() local s = 0 for _, v in ipairs(run.scores) do s = s + v end return s end

function finish_run()
  state, state_t = "done", 0
  run.total = total()
  local m = medal(run.total)
  if run.mode == "daily" then
    local d = run.day
    if S.last ~= d then
      S.streak = (S.last == d - 1) and S.streak + 1 or 1
      S.last = d
      run.new_day = true
    end
    S.top = math.max(S.top, S.streak)
    S.hist[d] = math.max(S.hist[d] or 0, run.total)
    S.jog_best = math.max(S.jog_best, run.total)
    if m == 3 then S.golds = S.golds + 1 end
    keep_stats()
    checkpoint({ mode = "menu" })
    if m == 3 then game_win(tr("A gold medal jog: %d points!", run.total)) end
  elseif run.mode == "team" then
    if m == 3 then game_win(tr("Gold together: %d points as a team!", run.total)) end
  elseif run.mode == "race" then
    local best, who = -999, {}
    for p = 1, NP do
      if run.pts[p] > best then best, who = run.pts[p], { p } elseif run.pts[p] == best then who[#who + 1] = p end
    end
    run.winners = who
    if #who == 1 then game_win(tr("%s won the race with %d points!", player_name(who[1], 10), best)) end
  end
  sfx("C5", 1, 0.4, 8) sfx("E5", 1, 0.4, 16) sfx("G5", 1, 0.4, 30)
end

-- ---------------------------------------------------------------- questions
-- every question: q.lock[p] (that player is out of this question), q.done (answered, waiting for the next)
function new_q()
  lap.qn = lap.qn + 1
  local lv = lap.lv
  local q = { lock = {}, done = 0, t = 0 }
  local e = lap.e
  if e == 1 then sums_q(q, lv)
  elseif e == 2 then echo_q(q, lv)
  elseif e == 3 then next_q(q, lv)
  elseif e == 4 then jars_q(q, lv)
  else lantern_q(q, lv) end
  Q = q
end

-- four answers on the d-pad: the right one and three near misses
function choices(q, ans, near)
  local opts, seen = { ans }, { [ans] = true }
  local tries = 0
  while #opts < 4 and tries < 60 do
    tries = tries + 1
    local d = near[rnd(#near)] * (rnd(2) == 1 and 1 or -1)
    local v = ans + d
    if v >= 0 and not seen[v] then opts[#opts + 1] = v seen[v] = true end
  end
  local v = ans + 1
  while #opts < 4 do if not seen[v] then opts[#opts + 1] = v seen[v] = true end v = v + 1 end
  shuffle(opts)
  q.opts = opts
  for d = 1, 4 do if opts[d] == ans then q.ans = d end end
end

function sums_q(q, lv)
  local a, b, c, s, ans
  local k = lv <= 1 and 1 or (lv <= 3 and rnd(1, 2) or (lv <= 4 and 3 or (lv <= 6 and rnd(1, 3) or rnd(1, 5))))
  local big = ({ 9, 15, 25, 25, 40, 60, 80, 99, 99 })[lv]
  if k == 1 then a, b = rnd(1, big), rnd(1, big) s, ans = a .. " + " .. b, a + b
  elseif k == 2 then a, b = rnd(2, big), rnd(1, big) if b > a then a, b = b, a end s, ans = a .. " - " .. b, a - b
  elseif k == 3 then a, b = rnd(2, lv <= 4 and 5 or 9), rnd(2, 9) s, ans = a .. " x " .. b, a * b
  elseif k == 4 then a, b, c = rnd(2, 30), rnd(2, 30), rnd(1, 20) if c > a + b then c = a + b - 1 end s, ans = a .. " + " .. b .. " - " .. c, a + b - c
  else a, b, c = rnd(2, 9), rnd(2, 9), rnd(1, 20) s, ans = a .. " x " .. b .. " + " .. c, a * b + c end
  q.text = s .. " = ?"
  choices(q, ans, k == 3 and { 1, 2, a, b } or { 1, 2, 10, 3 })
  q.worth = 10
end

function next_q(q, lv)
  local k = rnd(1, math.min(6, 1 + (lv + 1) // 2 + (lv >= 7 and 1 or 0)))
  local s, step = {}, rnd(1, 2 + lv)
  if k == 1 then local a = rnd(0, 10) for i = 1, 5 do s[i] = a + step * (i - 1) end
  elseif k == 2 then local a = step * 5 + rnd(0, 12) for i = 1, 5 do s[i] = a - step * (i - 1) end
  elseif k == 3 then local r, a = rnd(2, 3), rnd(1, 3) s[1] = a for i = 2, 5 do s[i] = s[i - 1] * r end step = a
  elseif k == 4 then local u, d = rnd(3, 6 + lv), rnd(1, 3) s[1] = rnd(2, 9) for i = 2, 5 do s[i] = s[i - 1] + (i % 2 == 0 and u or -d) end
  elseif k == 5 then s[1] = rnd(1, 9) for i = 2, 5 do s[i] = s[i - 1] + step + (i - 2) end
  else s[1], s[2] = rnd(1, 4), rnd(1, 5) for i = 3, 5 do s[i] = s[i - 1] + s[i - 2] end end
  q.seq = { s[1], s[2], s[3], s[4] }
  choices(q, s[5], { 1, 2, step, step + 1 })
  q.worth = 10
end

function jars_q(q, lv)
  local base = 3 + lv * 2
  local diff = math.max(1, (base * (10 - lv)) // 22)
  local m = rnd(base - diff // 2, base + 2)
  local n = { m, m + diff }
  if rnd(2) == 1 then n = { m + diff, m } end
  q.jars = {}
  for j = 1, 2 do
    local cells = {}
    for i = 0, 6 * 8 - 1 do cells[#cells + 1] = i end
    shuffle(cells)
    local f = {}
    for i = 1, n[j] do
      local c = cells[i]
      f[i] = { x = (c % 6) * 11 + rnd(0, 5), y = (c // 6) * 11 + rnd(0, 5), ph = rnd(0, 59) }
    end
    q.jars[j] = f
  end
  q.ans = n[1] > n[2] and 4 or 2         -- left (4) or right (2)
  q.n = n
  q.worth = 4
end

function echo_q(q, lv)
  q.seq = {}
  local len = math.min(9, 2 + (lv + 1) // 2 + (lv >= 8 and 1 or 0))
  for i = 1, len do q.seq[i] = rnd(1, 4) end
  q.show = math.max(14, 32 - lv * 2)      -- frames each arrow shows
  q.gap = 6
  q.watch = len * (q.show + q.gap) + 20    -- frames before players may answer
  q.at = {}                                -- how far each player has got
  for p = 1, NP do q.at[p] = 0 end
  q.worth = len * 4
end

function lantern_q(q, lv)
  q.wait = rnd(30, 100)                    -- dark frames before it lights
  q.win = math.max(24, 62 - lv * 4)        -- how long it stays lit
  q.red = rnd(100) <= 30
  q.side = rnd(1, 3)                       -- which of three lanterns
  q.hit = {}
end

-- ---------------------------------------------------------------- answering
function score(p, v) lap.pts[p] = lap.pts[p] + v end

function answer_right(p, v)
  if run.mode == "team" then score(1, v) else score(p, v) end
  lap.right = lap.right + 1
  Q.done, Q.who, Q.ok = 18, p, true
  sfx(72 + math.min(lap.right, 12), 4, 0.35, 5)
end

function answer_wrong(p, penalty)
  lap.wrong = lap.wrong + 1
  sfx("C3", 2, 0.3, 8, nil, 0, -40)
  if NP == 1 then
    score(1, -penalty)
    Q.done, Q.who, Q.ok = lap.e == 2 and 60 or 24, p, false
  else
    Q.lock[p] = true
    local all = true
    for i = 1, NP do if not Q.lock[i] then all = false end end
    if all then Q.done, Q.who, Q.ok = lap.e == 2 and 60 or 24, 0, false end
  end
end

function update_q()
  local q = Q
  q.t = q.t + 1
  if q.done > 0 then
    q.done = q.done - 1
    if q.done == 0 then new_q() end
    return
  end
  local e = lap.e
  if e == 1 or e == 3 or e == 4 then
    for p = 1, NP do
      local d = dir_edge(p)
      if d and not q.lock[p] and (e ~= 4 or d == 2 or d == 4) then
        if d == q.ans then answer_right(p, q.worth) return end
        q.pick = q.pick or {}
        q.pick[p] = d
        answer_wrong(p, e == 4 and 4 or 5)
        if q.done > 0 then return end
      end
    end
  elseif e == 2 then
    if q.t < q.watch then return end
    for p = 1, NP do
      local d = dir_edge(p)
      if d and not q.lock[p] then
        if q.seq[q.at[p] + 1] == d then
          q.at[p] = q.at[p] + 1
          sfx(60 + d * 3, 0, 0.2, 3)
          if q.at[p] == #q.seq then answer_right(p, q.worth) return end
        else
          answer_wrong(p, 0)
          if q.done > 0 then return end
        end
      end
    end
  else
    local lit = q.t > q.wait
    for p = 1, NP do
      if edge[p].a and not q.lock[p] then
        if not lit then
          q.lock[p] = "soon" score(run.mode == "team" and 1 or p, -3) sfx("C3", 2, 0.3, 8)
        elseif q.red then
          q.lock[p] = "red" score(run.mode == "team" and 1 or p, -6) sfx("C3", 2, 0.3, 8)
        else
          local rt = q.t - q.wait
          q.rt = rt
          answer_right(p, math.max(3, 14 - rt // 3))
          return
        end
      end
    end
    if q.t > q.wait + q.win then
      if q.red then
        local calm = true
        for p = 1, NP do if q.lock[p] == "red" then calm = false end end
        if calm then score(1, run.mode == "race" and 0 or 2) end
        q.done, q.who, q.ok = 14, 0, calm
      else
        q.done, q.who, q.ok = 18, 0, false        -- nobody pressed: missed
      end
    end
  end
end

-- ---------------------------------------------------------------- update
function _update()
  gt = gt + 1
  read_pads()
  if state == "pick" then
    pick_t = pick_t + 1
    if any_edge("left") or any_edge("up") then sel = sel == 1 and 2 or 1 sfx("E5", 0, 0.15, 3) end
    if any_edge("right") or any_edge("down") then sel = sel == 2 and 1 or 2 sfx("E5", 0, 0.15, 3) end
    if any_edge("a") and pick_t > 10 then
      sfx("C5", 4, 0.3, 6)
      if SOLO then
        if sel == 1 then start_run("daily") else state, pick_t = "practice", 0 end
      else
        start_run(sel == 1 and "race" or "team")
      end
    end
    return
  end
  if state == "practice" then
    pick_t = pick_t + 1
    if any_edge("up") then psel = psel == 1 and #EX or psel - 1 sfx("E5", 0, 0.15, 3) end
    if any_edge("down") then psel = psel % #EX + 1 sfx("E5", 0, 0.15, 3) end
    if any_edge("b") then state, pick_t = "pick", 0 end
    if any_edge("a") and pick_t > 8 then sfx("C5", 4, 0.3, 6) start_run("practice", psel) end
    return
  end
  state_t = state_t + 1
  if state == "intro" then
    if state_t > 150 or (state_t > 20 and any_edge("a")) then state, state_t = "lap", 0 new_q() end
  elseif state == "lap" then
    lap.left = lap.left - 1
    update_q()
    if lap.left <= 0 then end_lap() end
  elseif state == "lapdone" then
    if state_t > 150 or (state_t > 30 and any_edge("a")) then next_lap() end
  elseif state == "done" then
    if state_t > 60 then
      if any_edge("a") then
        if run.mode == "practice" then start_run("practice", run.laps[1])
        else state, pick_t = "pick", 0 end
      elseif any_edge("b") then state, pick_t = run.mode == "practice" and "practice" or "pick", 0 end
    end
  end
end

-- ---------------------------------------------------------------- drawing (never calls rnd)
function draw_park(dark)
  cls(dark and 19 or 22)
  rectfill(0, 150, 320, 90, dark and 14 or 16)
  rectfill(0, 150, 320, 3, dark and 15 or 17)
  -- the running track, seen from the side
  rectfill(0, 196, 320, 26, dark and 7 or 9)
  for i = 0, 3 do rectfill(0, 199 + i * 6, 320, 1, dark and 6 or 11) end
  for i = 0, 6 do                          -- trees in the back
    local x = i * 52 + 10
    rectfill(x + 6, 132, 4, 20, 6)
    circfill(x + 8, 128, 14, dark and 14 or 15)
    circfill(x + 4, 122, 8, dark and 15 or 16)
  end
end

function draw_runner(x, y, f, c, sc)
  sc = sc or 1
  local step = (f // 6) % 2
  local lift = step == 0 and 0 or 2
  rectfill(x - 7 * sc, y + 1, 14 * sc, 2, 6)               -- shadow
  rectfill(x - 4 * sc, y - 4 * sc - lift, 3 * sc, 4 * sc, 1)   -- legs
  rectfill(x + 1 * sc, y - 4 * sc - (2 - lift), 3 * sc, 4 * sc, 1)
  circfill(x, y - 11 * sc - lift, 8 * sc, c)                -- round body
  circfill(x - 2 * sc, y - 13 * sc - lift, 3 * sc, 13)      -- shine
  rectfill(x - 8 * sc, y - 16 * sc - lift, 16 * sc, 3 * sc, 25)  -- sweatband
  circfill(x + 3 * sc, y - 12 * sc - lift, 2 * sc, 13)      -- eye
  pset(x + 4 * sc, y - 12 * sc - lift, 1)
  line(x - 8 * sc, y - 15 * sc - lift, x - 13 * sc, y - 18 * sc - lift + step * 2, 25)   -- band tails
end

function draw_arrow(x, y, d, c, s)
  s = s or 12
  local dx, dy = ({ 0, 1, 0, -1 })[d], ({ -1, 0, 1, 0 })[d]
  local px, py = -dy, dx
  for i = 0, s do                          -- the head: lines that get shorter towards the tip
    local h = (s - i) * 0.9
    local cx, cy = x + dx * i, y + dy * i
    line(cx + px * h, cy + py * h, cx - px * h, cy - py * h, c)
  end
  for o = -2, 2 do line(x + px * o - dx * s, y + py * o - dy * s, x + px * o, y + py * o, c) end   -- the shaft
end

BOX = { { 160, 120 }, { 236, 152 }, { 160, 184 }, { 84, 152 } }   -- where each d-pad answer sits
function draw_choices(q)
  for d = 1, 4 do
    local x, y = BOX[d][1], BOX[d][2]
    local c, b = 13, 20
    if q.done > 0 and d == q.ans then c, b = 1, 17 end
    if q.done > 0 and NP == 1 and not q.ok and q.pick and q.pick[1] == d then c, b = 13, 25 end
    rectfill(x - 30, y - 12, 60, 24, 1)
    rectfill(x - 29, y - 11, 58, 22, b)
    local s = tostring(q.opts[d])
    ttext(s, x, y - 7, c, 2)
    -- who picked this wrong answer (together)
    if q.pick then
      local k = 0
      for p = 1, NP do if q.pick[p] == d then k = k + 1 circfill(x - 26 + k * 6, y + 14, 2, PC[p]) end end
    end
  end
  -- a little d-pad in the middle shows which way is which
  rectfill(154, 146, 12, 12, 1) rectfill(148, 150, 24, 4, 30) rectfill(158, 140, 4, 24, 30)
end

function draw_q()
  local q = Q
  if not q then return end
  local e = lap.e
  if e == 1 then
    rectfill(30, 52, 260, 44, 1) rectfill(32, 54, 256, 40, 12)
    ttext(q.text, 160, 64, 1, #q.text > 12 and 2 or 3)
    draw_choices(q)
  elseif e == 3 then
    for i = 1, 5 do
      local x = 22 + (i - 1) * 58
      rectfill(x, 56, 50, 34, 1) rectfill(x + 1, 57, 48, 32, i == 5 and 27 or 12)
      local s = i == 5 and "?" or tostring(q.seq[i])
      ttext(s, x + 25, 65, 1, #s > 3 and 1 or 2)
      if i < 5 then text(">", x + 51, 68, 13) end
    end
    draw_choices(q)
  elseif e == 4 then
    for j = 1, 2 do
      local x = j == 1 and 40 or 200
      rectfill(x - 2, 52, 84, 112, 23)                       -- glass
      rectfill(x, 54, 80, 108, 19)
      rectfill(x + 6, 46, 68, 8, 8) rectfill(x + 10, 42, 60, 4, 9)   -- lid
      for _, f in ipairs(q.jars[j]) do
        local glow = ((gt + f.ph) // 15) % 4 ~= 0
        local fx, fy = x + 7 + f.x, 60 + f.y + (((gt + f.ph) // 20) % 2)
        if glow then circfill(fx + 2, fy + 2, 3, 18) end
        rectfill(fx + 1, fy + 1, 3, 3, 27)
      end
      local hl = q.done > 0 and ((q.ans == 4 and j == 1) or (q.ans == 2 and j == 2))
      if hl then rect(x - 4, 40, 88, 128, 17) rect(x - 5, 39, 90, 130, 17) end
      if q.done > 0 then ttext(tostring(q.n[j]), x + 40, 172, 13, 2) end
      text(j == 1 and "<" or ">", x + 36, 192, 13, 2)
      if q.pick then
        local k = 0
        for p = 1, NP do if q.pick[p] == (j == 1 and 4 or 2) then k = k + 1 circfill(x + k * 6, 184, 2, PC[p]) end end
      end
    end
  elseif e == 2 then
    if q.t < q.watch then
      local per = q.show + q.gap
      local i, f = q.t // per + 1, q.t % per
      stext("WATCH", 60, 22, 2)
      if i <= #q.seq and f < q.show then
        circfill(160, 140, 34, 1) circfill(160, 140, 32, 20)
        draw_arrow(160, 140, q.seq[i], 27, 20)
      end
      for k = 1, #q.seq do circfill(160 - (#q.seq - 1) * 7 + (k - 1) * 14, 196, 4, (k < i or (k == i and f < q.show)) and 27 or 30) end
    else
      stext(q.done > 0 and (q.ok and "RIGHT!" or "THE ARROWS WERE") or "YOUR TURN", 60, q.done > 0 and (q.ok and 17 or 26) or 27, 2)
      if q.done > 0 and not q.ok then
        for k = 1, #q.seq do draw_arrow(160 - (#q.seq - 1) * 16 + (k - 1) * 32, 130, q.seq[k], 27, 11) end
      end
      for p = 1, NP do
        local y = NP == 1 and 196 or 92 + p * 14
        local x0 = 160 - (#q.seq - 1) * 7
        if NP > 1 then text(player_name(p, 6), x0 - 60, y - 4, PC[p]) end
        for k = 1, #q.seq do circfill(x0 + (k - 1) * 14, y, 4, k <= q.at[p] and PC[p] or (q.lock[p] and 24 or 30)) end
      end
    end
  else
    stext("A ON GREEN", 52, 13, 2)
    for i = 1, 3 do
      local x = 70 + (i - 1) * 90
      line(x, 84, x, 100, 30)
      rectfill(x - 16, 100, 32, 6, 30)
      local lit = i == q.side and q.t > q.wait and q.t <= q.wait + q.win and q.done == 0
      local c = lit and (q.red and 26 or 17) or 2
      if lit then circfill(x, 128, 30, q.red and 24 or 15) end
      rectfill(x - 14, 106, 28, 44, 1)
      rectfill(x - 12, 108, 24, 40, c)
      rectfill(x - 16, 150, 32, 6, 30)
    end
    if q.done > 0 then
      local s = q.ok and (q.rt and (q.rt * 1000 // 60) .. " ms" or "WELL HELD!") or (q.red and "OOPS, RED!" or "MISSED!")
      if q.who and q.who > 0 and NP > 1 and q.ok and q.rt then s = player_name(q.who, 8) .. "  " .. tr(s) end
      stext(s, 172, q.ok and 17 or 26, 2)
    end
    for p = 1, NP do
      if q.lock[p] then
        local s = q.lock[p] == "soon" and "TOO SOON" or "RED!"
        if NP == 1 then stext(s, 196, 26) else ttext(s, 20 + (p - 1) * 40, 196, PC[p]) end
      end
    end
  end
  if q.done > 0 and q.who and q.who > 0 and NP > 1 and e ~= 5 then
    local nm = player_name(q.who, 10)
    stext(nm .. (q.ok and " +" .. q.worth or ""), 40, PC[q.who], 1)
  end
end

function draw_hud()
  -- lap dots and the clock
  rectfill(0, 0, 320, 20, 1)
  for i = 1, #run.laps do
    local c = i < run.n and 17 or (i == run.n and 27 or 30)
    circfill(10 + (i - 1) * 12, 10, 4, c)
  end
  local w = 132 * math.max(0, lap.left) // LAP_T
  rectfill(72, 6, 132, 8, 30) rectfill(72, 6, w, 8, lap.left < 300 and 26 or 22)
  local s = tr(EX[lap.e].name)
  text(s, 314 - #s * 8, 6, 13)
  if NP == 1 or run.mode == "team" then
    local p = lap.pts[1]
    ttext(tostring(p), 160, 22, 27, 2)
  end
  if NP > 1 then
    local w2 = 320 // NP
    rectfill(0, 224, 320, 16, 1)
    for p = 1, NP do
      local x = (p - 1) * w2
      rectfill(x + 1, 225, w2 - 2, 14, (ME or 0) == p and 2 or 31)
      rectfill(x + 1, 225, 3, 14, PC[p])
      local nm = player_name(p, math.max(2, (w2 - 30) // 8))
      text(nm, x + 6, 229, Q and Q.lock[p] and 28 or 13)
      if run.mode == "race" then
        local v = tostring(run.pts[p] + lap.pts[p])
        text(v, x + w2 - 3 - #v * 8, 229, 27)
      end
    end
  end
end

function draw_card(x, y, w, h) rectfill(x, y, w, h, 1) rect(x, y, w, h, 22) end

function draw_week(y)
  local d = today()
  for i = 0, 6 do
    local day = d - 6 + i
    local x = 160 - 3 * 22 + i * 22 - 8
    local v = S.hist[day]
    local c = v and ({ [0] = 21, 9, 29, 27 })[medal(v)] or 30
    rectfill(x, y, 16, 16, c)
    if day == d then rect(x - 2, y - 2, 20, 20, 13) end
  end
end

function _draw()
  if state == "pick" then
    draw_park(false)
    draw_runner(40 + (gt // 2) % 280, 210, gt, 21)
    draw_card(30, 26, 260, 156)
    stext(SOLO and "TODAY'S JOG" or "PICK A GAME", 34, 27, 2)
    local names = SOLO and { "DAILY JOG", "PRACTICE" } or { "RACE", "TEAM" }
    for i, m in ipairs(names) do
      local x = 48 + (i - 1) * 116
      rectfill(x, 58, 108, 24, i == sel and 20 or 2)
      rect(x, 58, 108, 24, i == sel and 13 or 30)
      ttext(m, x + 54, 66, i == sel and 27 or 29)
    end
    if SOLO then
      local h = S.hist[today()]
      ctext(sel == 1 and (h and tr("today: %d points, %s", h, tr(MEDAL[medal(h)][1])) or "five laps, a new jog every day") or "one exercise at a time", 90, 13)
      ctext("days in a row: " .. ((S.last >= today() - 1) and S.streak or 0) .. "   (best " .. S.top .. ")", 106, 23)
      draw_week(124)
      ctext("best jog " .. S.jog_best .. "    golds " .. S.golds, 150, 29)
    else
      ctext(sel == 1 and "First right answer scores." or "Every right answer counts for all.", 92, 13)
      ctext(sel == 1 and "A wrong one locks you out of it." or "Earn a medal together.", 104, 29)
      ctext(NP .. " players", 128, 23)
    end
    ctext("left / right: pick    A: go", 168, 29)
    return
  end
  if state == "practice" then
    draw_park(false)
    draw_card(30, 20, 260, 196)
    stext("PRACTICE", 28, 27, 2)
    for i, x in ipairs(EX) do
      local y = 50 + (i - 1) * 26
      rectfill(40, y, 240, 22, i == psel and 20 or 2)
      text(x.name, 48, y + 3, i == psel and 27 or 13)
      text(x.kind, 48, y + 12, 29)
      local s = tr("lv " .. S.lv[i] .. "  best " .. S.best[i])
      text(s, 272 - #s * 8, y + 7, 23)
    end
    ctext(EX[psel].how, 186, 13)
    ctext("A: go    B: back", 202, 29)
    return
  end
  draw_park(lap and lap.e == 4 or lap and lap.e == 5)
  if state == "intro" then
    local x = EX[lap.e]
    draw_runner(160, 210, gt, 21, 2)
    draw_card(30, 40, 260, 110)
    stext((run.mode == "practice" and "PRACTICE" or ("LAP " .. run.n .. " OF " .. #run.laps)), 48, 22)
    stext(x.name, 66, 27, 3)
    ctext(tr("%s, level %d", tr(x.kind), lap.lv), 96, 29)
    ctext(x.how, 112, 13)
    local c = 3 - state_t // 50
    if c > 0 then stext(tostring(c), 128, 13, 2) end
    return
  end
  if state == "lap" then
    draw_q()
    draw_hud()
    return
  end
  if state == "lapdone" then
    draw_card(40, 50, 240, 120)
    stext(tr("%s DONE", tr(EX[lap.e].name)), 60, 27, 1)
    if run.mode == "race" then
      local y = 80
      for p = 1, NP do
        if y < 160 then text(player_name(p, 10) .. "  +" .. lap.pts[p], 70 + ((p - 1) % 2) * 100, y, PC[p]) end
        if p % 2 == 0 then y = y + 12 end
      end
    else
      stext(lap.score .. " / 100", 84, 13, 3)
      ctext(lap.right .. " right, " .. lap.wrong .. " wrong", 120, 23)
      if run.mode == "practice" or SOLO then ctext("best " .. S.best[lap.e] .. "   next level " .. (SOLO and S.lv[lap.e] or lap.lv), 136, 29) end
    end
    ctext("A: on", 154, 29)
    return
  end
  if state == "done" then
    draw_runner(40 + (state_t * 2) % 260, 210, gt, 21)
    draw_card(30, 20, 260, 168)
    if run.mode == "race" then
      stext("RACE OVER", 30, 27, 2)
      local order = {}
      for p = 1, NP do order[p] = p end
      table.sort(order, function(a, b) if run.pts[a] ~= run.pts[b] then return run.pts[a] > run.pts[b] end return a < b end)
      for i, p in ipairs(order) do
        local y = 52 + (i - 1) * 14
        local s = i .. ". " .. player_name(p, 12)
        text(s, 70, y, PC[p])
        ttext(tostring(run.pts[p]), 250, y, 27)
      end
      local w = run.winners
      if #w > 1 then ctext("a tie at the top!", 172, 13) end
    else
      stext(run.mode == "practice" and "PRACTICE DONE" or (run.mode == "team" and "TEAM JOG DONE" or "JOG DONE"), 30, 27, 2)
      for i, sc in ipairs(run.scores) do
        local y = 52 + (i - 1) * 14
        text(EX[run.laps[i]].name, 50, y, 13)
        rectfill(170, y, 100 * sc // 100, 8, 22)
        ttext(tostring(sc), 286, y, 27)
      end
      if run.mode ~= "practice" then
        local m = medal(run.total)
        stext(run.total .. " POINTS", 128, 13, 2)
        stext(MEDAL[m][1], 148, MEDAL[m][2], 2)
        if run.mode == "daily" then
          ctext(run.new_day and ("days in a row: " .. S.streak .. "!") or "already counted today: come back tomorrow", 170, 23)
        end
      end
    end
    if state_t > 60 then ctext("A: again    B: back", 180, 29) end
  end
end

-- the title screen (game{title_draw = ...}): a little runner laps a park track at sunrise while the
-- exercises float by in thought bubbles. It only draws, from the frame count t it is given.
function draw_title(t)
  local sky = { 3, 4, 5, 10, 11, 12 }
  for i, c in ipairs(sky) do rectfill(0, (i - 1) * 25, 320, 25, c) end
  circfill(160, 150, 40, 27) circfill(160, 150, 34, 12)
  rectfill(0, 150, 320, 90, 15)
  rectfill(0, 150, 320, 3, 16)
  for i = 0, 6 do local x = i * 52 + 10 rectfill(x + 6, 132, 4, 20, 6) circfill(x + 8, 128, 14, 14) end
  -- the track
  rectfill(0, 200, 320, 40, 9)
  for i = 0, 3 do rectfill(0, 204 + i * 8, 320, 1, 11) end
  -- the runner goes round and round
  local x = (t * 2) % 400 - 40
  draw_runner(x, 222, t, 21, 2)
  -- thought bubbles drift up from the runner
  local bubbles = { "7+5", "?", "<^>", "2 4 8", "!" }
  for i = 0, 4 do
    local k = (t // 40 + i) % 5 + 1
    local p = (t + i * 40) % 200
    local bx = 30 + i * 62 + math.sin((t + i * 30) / 25) * 6
    local by = 190 - p
    if by > 116 and by < 176 then
      circfill(bx, by, 16, 13)
      circfill(bx - 10, by + 14, 3, 13)
      local s = bubbles[k]
      text(s, bx - #s * 4, by - 4, 2)
    end
  end
end
-- this game's words in other languages (the Bit's language, LANGUAGE in Settings; runtime/bk_lang.lua)
texts{
  de = {
    ["Seconds per lap"] = "Sekunden pro Runde",
    ["QUICK SUMS"] = "KOPFRECHNEN",
    ["Press the direction of the right answer."] = "Drück die Richtung der Antwort.",
    ["ARROW ECHO"] = "PFEIL-ECHO",
    ["Watch the arrows, then press them in the same order."] = "Pfeile merken, dann gleich nachdrücken.",
    ["NEXT UP"] = "WAS KOMMT?",
    ["What comes next? Press the direction of it."] = "Was kommt als Nächstes? Drück dorthin.",
    ["FIREFLY JARS"] = "GLÜHWÜRMCHEN",
    ["Which jar has more fireflies? Left or right."] = "Wo sind mehr Glühwürmchen? Links/rechts",
    ["LANTERNS"] = "LATERNEN",
    ["A as soon as a lantern glows green. Not on red!"] = "A, sobald es grün leuchtet. Nie bei Rot!",
    ["maths"] = "Rechnen",
    ["memory"] = "Gedächtnis",
    ["logic"] = "Logik",
    ["counting"] = "Zählen",
    ["reaction"] = "Reaktion",
    ["Run a Daily Jog of five brain laps and earn a gold medal (# points)."] = "Lauf einen Tageslauf aus fünf Denkrunden und hol eine Goldmedaille (# Punkte).",
    ["Five laps of 30 seconds, one exercise each: maths, memory, logic, counting and reaction."] = "Fünf Runden à 30 Sekunden, je eine Übung: Rechnen, Gedächtnis, Logik, Zählen und Reaktion.",
    ["Answers sit on the d-pad: press the direction of the right one. Lanterns: A on green, never on red."] = "Die Antworten liegen auf dem Steuerkreuz: Drück die Richtung der richtigen. Laternen: A bei Grün, nie bei Rot.",
    ["Daily Jog: a new jog every day, the same for everybody. Run one every day to grow your streak."] = "Tageslauf: jeden Tag ein neuer Lauf, für alle gleich. Lauf jeden Tag, damit deine Serie wächst.",
    ["Practice: one exercise at a time. Each exercise gets harder as you get better at it."] = "Training: eine Übung nach der anderen. Jede Übung wird schwerer, je besser du wirst.",
    ["Together: Race (the first right answer scores, a wrong one locks you out of that question) or Team."] = "Zusammen: Rennen (die erste richtige Antwort punktet, eine falsche sperrt dich für diese Frage) oder Team.",
    ["NO MEDAL"] = "KEINE MEDAILLE",
    ["BRONZE"] = "BRONZE",
    ["SILVER"] = "SILBER",
    ["GOLD"] = "GOLD",
    ["A gold medal jog: %d points!"] = "Ein Lauf für Gold: %d Punkte!",
    ["Gold together: %d points as a team!"] = "Gold zusammen: %d Punkte als Team!",
    ["%s won the race with %d points!"] = "%s gewinnt das Rennen mit %d Punkten!",
    ["WATCH"] = "AUFPASSEN",
    ["RIGHT!"] = "RICHTIG!",
    ["THE ARROWS WERE"] = "DIE PFEILE WAREN",
    ["YOUR TURN"] = "DU BIST DRAN",
    ["A ON GREEN"] = "A BEI GRÜN",
    ["# ms"] = "# ms",
    ["WELL HELD!"] = "GUT GEHALTEN!",
    ["OOPS, RED!"] = "UPS, ROT!",
    ["MISSED!"] = "VERPASST!",
    ["TOO SOON"] = "ZU FRÜH",
    ["RED!"] = "ROT!",
    ["TODAY'S JOG"] = "TAGESLAUF",
    ["PICK A GAME"] = "WÄHL EIN SPIEL",
    ["DAILY JOG"] = "TAGESLAUF",
    ["PRACTICE"] = "TRAINING",
    ["RACE"] = "RENNEN",
    ["TEAM"] = "TEAM",
    ["today: %d points, %s"] = "heute: %d Punkte, %s",
    ["five laps, a new jog every day"] = "fünf Runden, täglich neu",
    ["one exercise at a time"] = "eine Übung nach der anderen",
    ["days in a row: #   (best #)"] = "Tage am Stück: #   (Rekord #)",
    ["days in a row: #!"] = "Tage am Stück: #!",
    ["best jog #    golds #"] = "bester Lauf #    Gold #",
    ["First right answer scores."] = "Erste richtige Antwort punktet.",
    ["Every right answer counts for all."] = "Richtige Antworten zählen für alle.",
    ["A wrong one locks you out of it."] = "Falsch? Dann bist du raus.",
    ["Earn a medal together."] = "Holt zusammen eine Medaille.",
    ["# players"] = "# Spieler",
    ["left / right: pick    A: go"] = "links / rechts: wählen    A: los",
    ["lv #  best #"] = "Lv #  Rekord #",
    ["A: go    B: back"] = "A: los    B: zurück",
    ["LAP # OF #"] = "RUNDE # VON #",
    ["%s, level %d"] = "%s, Level %d",
    ["%s DONE"] = "%s FERTIG",
    ["# right, # wrong"] = "# richtig, # falsch",
    ["best #   next level #"] = "Rekord #   nächstes Level #",
    ["A: on"] = "A: weiter",
    ["RACE OVER"] = "RENNEN VORBEI",
    ["a tie at the top!"] = "Gleichstand an der Spitze!",
    ["PRACTICE DONE"] = "TRAINING FERTIG",
    ["TEAM JOG DONE"] = "TEAMLAUF FERTIG",
    ["JOG DONE"] = "LAUF FERTIG",
    ["# POINTS"] = "# PUNKTE",
    ["already counted today: come back tomorrow"] = "heute schon gezählt: komm morgen wieder",
    ["A: again    B: back"] = "A: nochmal    B: zurück",
  },
}
`;

  // the icon: the round runner in a headband
  const K = { '.': 0, b: 21, d: 20, w: 13, e: 1, r: 25, k: 1 };
  const ICON = [
    '................',
    '.....dddddd.....',
    '...ddbbbbbbdd...',
    '..dbbwwbbbbbbd..',
    'rrrrrrrrrrrrrrr.',
    'r.rrrrrrrrrrrrr.',
    '.dbbbbbbbbwwbbd.',
    '.dbbbbbbbbwebbd.',
    '.dbbbbbbbbbbbbd.',
    '.dbbbbbbbbbbbbd.',
    '..dbbbbbbbbbbd..',
    '...ddbbbbbbdd...',
    '.....dddddd.....',
    '.....kk..kk.....',
    '....kk....kk....',
    '................',
  ];

  function buildGfx(cart) {
    cart.tiles.fill(0); cart.flags.fill(0); cart.map.fill(0);
    ICON.forEach((row, y) => [...row].forEach((ch, x) => {
      const t = 64 + (y >> 3) * 16 + (x >> 3);
      cart.tiles[t * 64 + (y & 7) * 8 + (x & 7)] = K[ch] ?? 0;
    }));
    // Mind Laps draws everything itself. The runner entity type is the game's icon on the Bit's home screen.
    const base = { sw: 2, sh: 2, grav: false, collide: false, left: false, hp: 0, inset: 0, team: 'neutral', damage: 0, hidden: false,
      player: false, stomp: false, touch_fx: '', hurt: 15, stats: [] };
    cart.entities = { effects: [], cutscenes: [], placed: [],
      types: [Object.assign({}, base, { name: 'runner', anims: [{ name: 'idle', frames: [64], speed: 8 }], tree: null })] };
    cart.levels = [{ name: 'Park', w: 40, h: 30, map: cart.map, placed: cart.entities.placed }];
  }

  window.BK_DEMOS = window.BK_DEMOS || [];
  window.BK_DEMOS.push({ name: 'Mind Laps', code, buildGfx,
    about: 'A daily brain jog: five quick exercises (maths, memory, logic, counting, reaction), a streak of days in a row, and Race or Team for 2-8 players.' });
})();
