/* PocketBit app: Share. On the Utilities row. Sends games, apps, photos and clips to a nearby Bit, Bit to Bit:
   ESP-NOW on the PocketBit (platform/device/bk_host.c, "sharing"), the BroadcastChannel between studio windows.
   Both Bits open Share; one picks something and the other Bit, the other says yes, and it arrives on its home
   screen (games, apps) or with its photos and clips. The host does the sending and tells the app what is going on
   in the SHARE table; the app asks with share(op, a, b). MIT License. */
'use strict';
(function () {
  const CODE = `
-- SHARE (from the host): v, me {name, num, color}, items {{name, kind, size}}, bits {{name, num, color, ready}},
-- offer {from, kind, name, size} or nil, xfer {dir, name, kind, peer, size, done, state, why} or nil
local col, isel, bsel, top, tt, last_v, said = 1, 1, 1, 1, 0, -1, nil
local KIND = {game = "GAME", app = "APP", photo = "PHOTO", clip = "CLIP"}
local KCOL = {game = 21, app = 17, photo = 27, clip = 26}
local ROWS = 9

local function kb(n) if n < 1024 then return n .. " B" end return math.floor(n / 1024 + 0.5) .. " KB" end
local function S() return SHARE or {items = {}, bits = {}} end
local function beep(n) sfx(n or "G5", 4, 0.15, 3) end

function _init() share(0) end

function _update()
  tt = tt + 1
  if tt % 60 == 0 then share(0) end            -- still here: keep the state coming
  local s = S()
  if btnp("start") and not s.offer then home() return end
  -- an offer from another Bit comes first
  if s.offer then
    if btnp("a") then share(2, 1) beep("C6") elseif btnp("b") then share(2, 0) beep("C4") end
    return
  end
  local x = s.xfer
  if x and (x.state == "ask" or x.state == "go") then
    if btnp("b") then share(3) beep("C4") end
    return
  end
  if x and btnp("a") and (x.state == "ok" or x.state == "no" or x.state == "fail") then share(3) beep() return end
  local ni, nb = #s.items, #s.bits
  if isel > ni then isel = math.max(1, ni) end
  if bsel > nb then bsel = math.max(1, nb) end
  if col == 1 then
    if btnp("down") and ni > 0 then isel = isel % ni + 1 beep() end
    if btnp("up") and ni > 0 then isel = (isel - 2) % ni + 1 beep() end
    if isel < top then top = isel elseif isel >= top + ROWS then top = isel - ROWS + 1 end
    if btnp("a") and ni > 0 then
      if nb == 0 then said = "NO BITS NEARBY" beep("C4") else col = 2 beep("E5") end
    end
    if btnp("b") then home() end
  else
    if btnp("down") and nb > 0 then bsel = bsel % nb + 1 beep() end
    if btnp("up") and nb > 0 then bsel = (bsel - 2) % nb + 1 beep() end
    if btnp("b") then col = 1 beep() end
    if btnp("a") and nb > 0 then
      local b = s.bits[bsel]
      if not b.ready then said = "OPEN SHARE ON " .. b.name beep("C4")
      else share(1, isel, bsel) col = 1 said = nil beep("C6") end
    end
  end
end

local function panel(x, y, w, h, title, on)
  rectfill(x, y, w, h, 2)
  rect(x, y, w, h, on and 21 or 30)
  text(title, x + 6, y + 5, on and 22 or 28)
end

local function bar(x, y, w, done, size, c)
  rect(x, y, w, 10, 13)
  local f = size > 0 and math.floor((w - 4) * math.min(1, done / size)) or 0
  rectfill(x + 2, y + 2, f, 6, c)
end

function _draw()
  cls(1)
  local s = S()
  rectfill(0, 0, 320, 14, 31)
  text("SHARE", 6, 4, 13)
  local nb = #s.bits
  local t = nb == 0 and "no Bits nearby" or (nb == 1 and "1 Bit nearby" or nb .. " Bits nearby")
  text(t, 314 - #t * 8, 4, nb > 0 and 17 or 28)
  -- your stuff
  panel(4, 20, 184, 196, "ON THIS BIT", col == 1)
  if not SHARE then text("LOOKING...", 14, 40, 28)
  elseif #s.items == 0 then
    text("Nothing to share yet.", 12, 40, 29)
    text("Make a game in the", 12, 56, 28) text("studio, or take a", 12, 68, 28)
    text("photo: SELECT + L.", 12, 80, 28)
  end
  for i = top, math.min(#s.items, top + ROWS - 1) do
    local it, y = s.items[i], 36 + (i - top) * 20
    local on = i == isel
    if on then rectfill(8, y - 3, 176, 18, col == 1 and 21 or 30) end
    rectfill(12, y, 4, 12, KCOL[it.kind] or 13)
    local nm = it.name if #nm > 13 then nm = nm:sub(1, 12) .. "." end
    text(nm, 22, y + 2, on and col == 1 and 1 or 13)
    local k = KIND[it.kind] or ""
    text(k, 180 - #k * 8, y + 2, on and col == 1 and 1 or (KCOL[it.kind] or 28))
  end
  if #s.items > ROWS then
    local h = math.max(8, 176 * ROWS // #s.items)
    rectfill(185, 34 + (176 - h) * (top - 1) // math.max(1, #s.items - ROWS), 2, h, 29)
  end
  -- nearby Bits
  panel(194, 20, 122, 196, "SEND TO", col == 2)
  if nb == 0 then
    text("Switch on", 202, 40, 28) text("another Bit", 202, 52, 28) text("and open", 202, 64, 28) text("Share on it.", 202, 76, 28)
  end
  for i, b in ipairs(s.bits) do
    local y = 36 + (i - 1) * 26
    local on = col == 2 and i == bsel
    if on then rectfill(198, y - 3, 114, 24, 21) end
    circfill(206, y + 5, 4, b.color or 13)
    local nm = b.name if #nm > 11 then nm = nm:sub(1, 10) .. "." end
    text(nm, 214, y + 1, on and 1 or 13)
    text(b.ready and "READY" or "open Share", 214, y + 11, on and 1 or (b.ready and 17 or 28))
  end
  -- footer
  rectfill(0, 222, 320, 18, 31)
  local x = s.xfer
  local help = col == 1 and "A send   B home" or "A send to this Bit   B back"
  if said and not x then help = said end
  text(help, 8, 227, said and not x and 27 or 29)
  -- a transfer
  if x then
    rectfill(30, 70, 260, 100, 31) rect(30, 70, 260, 100, 13)
    local verb = x.dir == "send" and "SENDING" or "GETTING"
    local head = ({ask = "WAITING FOR " .. (x.peer or "THE BIT"), go = verb .. " " .. (KIND[x.kind] or ""), ok = x.dir == "send" and "SENT!" or "GOT IT!",
      no = (x.peer or "THEY") .. " SAID NO", fail = "THAT DID NOT WORK"})[x.state] or ""
    text(head, 160 - #head * 4, 80, x.state == "ok" and 17 or (x.state == "fail" or x.state == "no") and 26 or 13)
    local nm = x.name if #nm > 28 then nm = nm:sub(1, 27) .. "." end
    text(nm, 160 - #nm * 4, 100, KCOL[x.kind] or 13)
    if x.state == "go" or x.state == "ask" then
      bar(50, 118, 220, x.done or 0, x.size or 1, KCOL[x.kind] or 21)
      local p = kb(x.done or 0) .. " of " .. kb(x.size or 0)
      text(p, 160 - #p * 4, 134, 29)
      text("B stop", 160 - 24, 152, 28)
    else
      local why = x.why or ""
      if x.state == "ok" and x.dir == "recv" then why = (x.kind == "game" or x.kind == "app") and "IT IS ON YOUR HOME SCREEN" or "SAVED WITH YOUR PHOTOS" end
      text(why, 160 - #why * 4, 124, 29)
      text("A ok", 160 - 16, 152, 28)
    end
  end
  -- an offer
  if s.offer then
    local o = s.offer
    rectfill(20, 60, 280, 120, 31) rect(20, 60, 280, 120, (tt // 15) % 2 == 0 and 27 or 13)
    local a = o.from .. " WANTS TO SEND YOU"
    text(a, 160 - #a * 4, 74, 13)
    local nm = o.name if #nm > 30 then nm = nm:sub(1, 29) .. "." end
    text(nm, 160 - #nm * 4, 98, KCOL[o.kind] or 13)
    local d = (KIND[o.kind] or "") .. ", " .. kb(o.size)
    text(d, 160 - #d * 4, 114, 28)
    text("A TAKE IT      B NO THANKS", 160 - 13 * 8, 150, 22)
  end
end
`;
  // 16x16 icon: two Bits and an arrow
  const C = { '.': 0, d: 31, w: 13, b: 21, g: 17, y: 27, k: 1 };
  const ICON = [
    '................', '.ddddd....ddddd.', '.dbbbd....dgggd.', '.dbbbd....dgggd.', '.dbbbd....dgggd.', '.ddddd....ddddd.', '.dwkwd....dwkwd.', '.ddddd....ddddd.',
    '................', '....yyyyyyyy....', '...yy......yy...', '..yy........yy..', '.yyyyy....yyyyy.', '..yyy......yyy..', '...y........y...', '................',
  ].map(r => [...r].map(ch => C[ch] || 0));
  window.BK_APPS = window.BK_APPS || [];
  window.BK_APPS.push({ name: 'Share', code: CODE, icon: ICON, saveKey: 'Share', sub: 'send to a nearby Bit', share: true,
    about: 'Send games, apps, photos and clips to a Bit next to you. Both open Share; pick something, pick the Bit, and the other Bit says yes.' });
})();
