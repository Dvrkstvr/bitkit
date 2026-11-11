/* BitKit Studio: paused games on the Bit. When you leave a game for the home screen, the whole runtime
   memory (Lua state, screen, sprites, map, sound) is kept, so picking the game again carries on where you
   left it. Snapshots are gzipped into IndexedDB, so they survive a reload too. Each snapshot remembers the
   runtime build and the game's contents; if either changed, the game starts fresh. MIT License. */
window.BKSnap = (() => {
  const DB = 'bitkit-snapshots', VER = 1, KEEP = 8;
  const mem = new Map();   // id -> { fp, heap, meta, at }
  let dbp = null, rtId = null;

  // FNV-1a over a string, as 8 hex digits
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  // the runtime build: a snapshot only fits the exact build that made it
  function runtimeId() {
    if (rtId === null) {
      try { rtId = hash(String(window.BitKitRuntime)) + ':' + String(window.BitKitRuntime).length; } catch (e) { rtId = 'unknown'; }
    }
    return rtId;
  }
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('no IndexedDB')); return; }
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => r.result.createObjectStore('snap');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('snap', mode), r = fn(t.objectStore('snap'));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  }
  const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  async function zip(bytes) {
    if (!canZip) return bytes;
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  }
  async function unzip(bytes, zipped) {
    if (!zipped) return bytes;
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  function trim() {
    while (mem.size > KEEP) {
      let old = null;
      for (const [id, s] of mem) if (!old || s.at < mem.get(old).at) old = id;
      mem.delete(old);
    }
  }
  const valid = (s, fp) => s && s.fp === fp && s.rt === runtimeId();

  // keep a paused game. heap is a copy of the runtime memory; meta is the host's own state for it
  function put(id, fp, heap, meta) {
    const s = { fp, rt: runtimeId(), heap, meta: meta || {}, at: Date.now() };
    mem.set(id, s); trim();
    return (async () => {
      try {
        const z = await zip(heap);
        if (mem.get(id) !== s) return;   // replaced or forgotten meanwhile
        await tx('readwrite', st => st.put({ fp: s.fp, rt: s.rt, meta: s.meta, at: s.at, zipped: canZip, data: z }, id));
      } catch (e) { /* memory copy still works for this session */ }
    })();
  }
  // the paused game, or null if there is none (or it no longer fits the game or the runtime)
  async function get(id, fp) {
    const m = mem.get(id);
    if (valid(m, fp)) return m;
    try {
      const r = await tx('readonly', st => st.get(id));
      if (!valid(r, fp)) return null;
      const s = { fp: r.fp, rt: r.rt, meta: r.meta || {}, at: r.at, heap: await unzip(r.data, r.zipped) };
      mem.set(id, s); trim();
      return s;
    } catch (e) { return null; }
  }
  // ids of every paused game with its fingerprint (cheap: no memory is unpacked)
  async function list() {
    const out = new Map();
    try {
      const d = await db();
      await new Promise((res, rej) => {
        const t = d.transaction('snap', 'readonly'), c = t.objectStore('snap').openCursor();
        c.onsuccess = () => { const cur = c.result; if (!cur) return; if (cur.value.rt === runtimeId()) out.set(cur.key, cur.value.fp); cur.continue(); };
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    } catch (e) { /* only this session's snapshots */ }
    for (const [id, s] of mem) if (s.rt === runtimeId()) out.set(id, s.fp);
    return out;
  }
  function forget(id) {
    mem.delete(id);
    return tx('readwrite', st => st.delete(id)).catch(() => {});
  }
  return { put, get, list, forget, hash };
})();
