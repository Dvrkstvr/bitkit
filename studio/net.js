/* Network events for big games (net_send / net_recv in Lua). MIT License.
 *
 * Lockstep linking (studio.js) keeps up to a few Bits frame-identical, which can't scale to 10-20.
 * Event games instead broadcast small events ("player 7 opened cell 40,12") and each Bit keeps its
 * own state. On a PocketBit the events go out as ESP-NOW broadcasts; in the studio every window
 * (same browser) running the same cart hears them through a BroadcastChannel.
 *
 * Runtime block (bkw_net): int32 id, out_n, in_n, in_r, out[16][10], in[64][10]; a slot is {from, n, v1..v8}.
 */
(function () {
  const OUT = 16, IN = 64, SLOT = 10, HDR = 4;
  let ch = null, key = null, queue = [], sent = 0, heard = 0;
  const peers = new Map();            // net id -> last time heard
  let id = 0;
  try { id = +sessionStorage.getItem('bitkit.netid') || 0; } catch (e) {}
  if (!id) { id = 1 + Math.floor(Math.random() * 65534); try { sessionStorage.setItem('bitkit.netid', id); } catch (e) {} }

  function open() {
    if (ch || typeof BroadcastChannel === 'undefined') return;
    ch = new BroadcastChannel('bitkit-net');
    ch.onmessage = e => {
      const m = e.data || {};
      if (m.k !== key || m.f === id || !Array.isArray(m.e)) return;
      peers.set(m.f, performance.now());
      for (const ev of m.e) if (queue.length < 4096) queue.push([m.f, ev]);
    };
  }

  const BKNet = {
    get id() { return id; },
    // a cart was (re)loaded or resumed: give it this Bit's id and empty queues. k = the cart's key (its name)
    reset(RT, k) {
      open();
      const b = RT._bkw_net() >> 2, H = RT.HEAP32;
      key = k || null; queue = []; peers.clear();
      H[b] = ch && key ? id : 0; H[b + 1] = 0; H[b + 2] = 0; H[b + 3] = 0;
    },
    stop() { key = null; queue = []; },
    // before a frame: keep what the cart hasn't read yet and add waiting events
    before(RT) {
      if (!key) return;
      const b = RT._bkw_net() >> 2, H = RT.HEAP32, inb = b + HDR + OUT * SLOT;
      let n = H[b + 2], r = Math.max(0, Math.min(H[b + 3], n)), w = 0;
      for (; r < n; r++, w++) if (w !== r) H.copyWithin(inb + w * SLOT, inb + r * SLOT, inb + r * SLOT + SLOT);
      while (w < IN && queue.length) {
        const [from, ev] = queue.shift(), o = inb + w * SLOT, c = Math.min(ev.length, SLOT - 2);
        H[o] = from; H[o + 1] = c;
        for (let i = 0; i < c; i++) H[o + 2 + i] = ev[i] | 0;
        w++; heard++;
      }
      H[b + 2] = w; H[b + 3] = 0;
    },
    // after a frame: broadcast what the cart sent
    after(RT) {
      const b = RT._bkw_net() >> 2, H = RT.HEAP32, n = Math.min(H[b + 1], OUT);
      if (n <= 0) return;
      H[b + 1] = 0;
      if (!ch || !key) return;
      const e = [];
      for (let i = 0; i < n; i++) {
        const o = b + HDR + i * SLOT, c = Math.max(0, Math.min(H[o + 1], SLOT - 2));
        e.push(Array.from(H.subarray(o + 2, o + 2 + c)));
      }
      sent += n;
      ch.postMessage({ k: key, f: id, e });
    },
    peers() { const now = performance.now(); let n = 0; for (const t of peers.values()) if (now - t < 5000) n++; return n; },
    stats() { return { sent, heard, peers: BKNet.peers() }; },
  };
  window.BKNet = BKNet;
})();
