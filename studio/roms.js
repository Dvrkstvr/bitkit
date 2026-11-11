/* BitKit Studio: the games for the emulator apps (Game Boy, Game Boy Color, NES), kept in this browser
   (IndexedDB), like the /roms folder on a PocketBit's SD card. Also their battery saves and save states.
   You add your own ROM files (drop them on the Bit, or the ROMs button); BitKit only brings its test cards
   (studio/emuroms.js). MIT License. */
window.BKRoms = (() => {
  const DB = 'bitkit-roms', VER = 1, TEST = 'BitKit test card';
  let dbp = null;
  let cache = [];             // [{file, name, kind, size, save, states: {slot: true}}] without the bytes
  const listeners = [];
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('no IndexedDB')); return; }
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { ['roms', 'saves', 'states'].forEach(n => r.result.createObjectStore(n)); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  }
  async function keys(store) { try { return (await tx(store, 'readonly', s => s.getAllKeys())) || []; } catch (e) { return []; } }

  function kindOf(file) {
    const m = /\.(gbc|cgb|gb|nes)$/i.exec(file || '');
    if (!m) return null;
    const x = m[1].toLowerCase();
    return x === 'cgb' ? 'gbc' : x;
  }
  const baseName = f => f.replace(/\.[^.]+$/, '');
  function testCard(kind) {
    const t = (window.BK_TEST_ROMS || {})[kind];
    if (!t) return null;
    const b = new Uint8Array(t.size);
    for (const [off, b64] of t.runs) { const s = atob(b64); for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i); }
    return b;
  }

  async function refresh() {
    let metas = [];
    try { metas = (await tx('roms', 'readonly', s => s.getAll())) || []; } catch (e) { metas = []; }
    const saves = new Set(await keys('saves')), states = await keys('states');
    const st = new Map();
    for (const k of states) { const i = String(k).lastIndexOf('#'); const f = String(k).slice(0, i); if (!st.has(f)) st.set(f, {}); st.get(f)[+String(k).slice(i + 1)] = true; }
    cache = metas.map(m => ({ file: m.file, name: baseName(m.file), kind: m.kind, size: m.size, save: saves.has(m.file), states: st.get(m.file) || {} }));
    for (const kind of ['gb', 'gbc', 'nes']) {
      const t = (window.BK_TEST_ROMS || {})[kind], file = `${TEST}.${kind}`;
      if (t) cache.push({ file, name: TEST, kind, size: t.size, test: true, save: saves.has(file), states: st.get(file) || {} });
    }
    cache.sort((a, b) => (!!a.test - !!b.test) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    listeners.forEach(f => f());
    return cache;
  }
  const list = kind => cache.filter(r => !kind || r.kind === kind);

  // add ROM files (File objects); returns {added: [names], skipped: [names]}
  async function add(files) {
    const added = [], skipped = [];
    for (const f of files) {
      const kind = kindOf(f.name);
      if (!kind || f.size > 8 * 1024 * 1024 || f.size < 16) { skipped.push(f.name); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const file = f.name.replace(/[\\/]/g, '_');
      await tx('roms', 'readwrite', s => s.put({ file, kind, size: bytes.length, bytes, added: Date.now() }, file));
      added.push(file);
    }
    await refresh();
    return { added, skipped };
  }
  async function remove(file) {
    await tx('roms', 'readwrite', s => s.delete(file));
    await tx('saves', 'readwrite', s => s.delete(file));
    const sk = (await keys('states')).filter(k => String(k).startsWith(file + '#'));
    if (sk.length) await tx('states', 'readwrite', s => sk.forEach(k => s.delete(k)));
    await refresh();
  }
  async function bytes(file) {
    const c = cache.find(r => r.file === file);
    if (c && c.test) return testCard(c.kind);
    const r = await tx('roms', 'readonly', s => s.get(file));
    return r && r.bytes ? new Uint8Array(r.bytes) : null;
  }
  const getSave = file => tx('saves', 'readonly', s => s.get(file)).catch(() => null);
  async function putSave(file, data) {
    await tx('saves', 'readwrite', s => s.put(data, file));
    const c = cache.find(r => r.file === file); if (c) c.save = true;
  }
  const getState = (file, slot) => tx('states', 'readonly', s => s.get(file + '#' + slot)).catch(() => null);
  async function putState(file, slot, data) {
    await tx('states', 'readwrite', s => s.put(data, file + '#' + slot));
    const c = cache.find(r => r.file === file); if (c) c.states[slot] = true;
  }

  // the list as a Lua table for emu_roms() (see runtime/bk_emu.h)
  const luaStr = s => '"' + String(s).replace(/[\\"]/g, m => '\\' + m).replace(/[\x00-\x1f]/g, ' ') + '"';
  function luaList(rows) {
    return '{' + rows.map(r => `{name=${luaStr(r.name)},file=${luaStr(r.file)},kind="${r.kind}",size=${r.size | 0},save=${!!r.save},test=${!!r.test},states={${
      Object.keys(r.states).map(k => `[${k | 0}]=true`).join(',')}}}`).join(',') + '}';
  }

  return { refresh, list, add, remove, bytes, getSave, putSave, getState, putState, luaList, kindOf, testCard, onChange: f => listeners.push(f),
    get all() { return cache; } };
})();
