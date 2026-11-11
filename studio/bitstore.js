/* BitKit Studio: the Bit's memory card. Games live as .bitkit files in a folder on your computer
   (File System Access API, Chrome/Edge) or, where folders are not available, in this browser (IndexedDB).
   MIT License. */
window.BKStore = (() => {
  const DB = 'bitkit-bit', VER = 1;
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('carts'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  }
  const kvGet = k => tx('kv', 'readonly', s => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
  const kvDel = k => tx('kv', 'readwrite', s => s.delete(k));

  const canPickFolder = typeof window.showDirectoryPicker === 'function';
  let dir = null;          // FileSystemDirectoryHandle when a folder is in use
  let state = 'browser';   // 'browser' | 'folder' | 'reconnect' (folder known, permission needed)

  async function init() {
    try {
      const h = await kvGet('dir');
      if (h && canPickFolder) {
        dir = h;
        const p = await h.queryPermission({ mode: 'readwrite' });
        state = p === 'granted' ? 'folder' : 'reconnect';
      }
    } catch (e) { state = 'browser'; }
    return state;
  }
  async function chooseFolder() {
    const h = await window.showDirectoryPicker({ id: 'bitkit-bit', mode: 'readwrite' });
    dir = h; state = 'folder';
    try { await kvSet('dir', h); } catch (e) { /* handle not storable: works until reload */ }
  }
  async function reconnect() {
    if (!dir) return false;
    const p = await dir.requestPermission({ mode: 'readwrite' });
    state = p === 'granted' ? 'folder' : 'reconnect';
    return state === 'folder';
  }
  async function useBrowser() { dir = null; state = 'browser'; try { await kvDel('dir'); } catch (e) { /* ignore */ } }
  function label() {
    if (state === 'folder') return dir.name;
    if (state === 'reconnect') return dir.name + ' (needs permission)';
    return 'this browser';
  }
  const isCart = n => /\.(bitkit|mboi)$/i.test(n);

  async function list() {
    const out = [];
    if (state === 'folder') {
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !isCart(name)) continue;
        try { const f = await h.getFile(); out.push({ file: name, data: JSON.parse(await f.text()), modified: f.lastModified }); }
        catch (e) { out.push({ file: name, error: e.message }); }
      }
    } else if (state === 'browser') {
      const d = await db();
      await new Promise((res, rej) => {
        const t = d.transaction('carts', 'readonly'), r = t.objectStore('carts').openCursor();
        r.onsuccess = () => { const c = r.result; if (c) { out.push({ file: c.key, data: c.value.data, modified: c.value.modified }); c.continue(); } };
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    }
    out.sort((a, b) => (a.data && b.data ? String(a.data.name).localeCompare(String(b.data.name)) : 0) || a.file.localeCompare(b.file));
    return out;
  }
  async function exists(file) {
    if (state === 'folder') { try { await dir.getFileHandle(file); return true; } catch (e) { return false; } }
    return !!(await tx('carts', 'readonly', s => s.get(file)));
  }
  async function save(file, data) {
    if (state === 'reconnect') throw new Error('The folder needs permission again. Press Reconnect folder in the Games menu.');
    if (state === 'folder') {
      const h = await dir.getFileHandle(file, { create: true });
      const w = await h.createWritable();
      await w.write(JSON.stringify(data)); await w.close();
    } else {
      await tx('carts', 'readwrite', s => s.put({ data, modified: Date.now() }, file));
    }
  }
  async function remove(file) {
    if (state === 'folder') await dir.removeEntry(file);
    else await tx('carts', 'readwrite', s => s.delete(file));
  }
  // drafts: games you changed and then left for another one, kept in this browser so nothing is lost
  // (the studio keys them by game: "demo:Kart Lab", "file:my-game.bitkit", "new:abc123")
  const drafts = {
    get: k => kvGet('draft:' + k),
    put: (k, v) => kvSet('draft:' + k, v),
    del: k => kvDel('draft:' + k),
    async list() {
      const d = await db(), out = [];
      await new Promise((res, rej) => {
        const t = d.transaction('kv', 'readonly'), r = t.objectStore('kv').openCursor(IDBKeyRange.bound('draft:', 'draft:\uffff'));
        r.onsuccess = () => { const c = r.result; if (c) { out.push(Object.assign({ key: String(c.key).slice(6) }, c.value)); c.continue(); } };
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      return out.sort((a, b) => (b.t || 0) - (a.t || 0));
    }
  };
  // captures: photos (.png) and clips (.gif) from the Bit, in captures/ on the memory card, like the PocketBit's SD card
  // (so pointing the studio at the SD card shows the device's captures too), or in this browser
  const isCap = n => /\.(png|gif)$/i.test(n);
  async function capDir(create) { return dir.getDirectoryHandle('captures', { create: !!create }); }
  const captures = {
    async list() {
      const out = [];
      if (state === 'folder') {
        let d; try { d = await capDir(false); } catch (e) { return out; }
        for await (const [name, h] of d.entries()) {
          if (h.kind !== 'file' || !isCap(name)) continue;
          const f = await h.getFile(); out.push({ name, blob: f, t: f.lastModified, size: f.size });
        }
      } else {
        const d = await db();
        await new Promise((res, rej) => {
          const t = d.transaction('kv', 'readonly'), r = t.objectStore('kv').openCursor(IDBKeyRange.bound('cap:', 'cap:\uffff'));
          r.onsuccess = () => { const c = r.result; if (c) { out.push({ name: String(c.key).slice(4), blob: c.value.blob, t: c.value.t, size: c.value.blob.size }); c.continue(); } };
          t.oncomplete = res; t.onerror = () => rej(t.error);
        });
      }
      return out.sort((a, b) => b.t - a.t);
    },
    async put(name, blob) {
      if (state === 'folder') {
        const h = await (await capDir(true)).getFileHandle(name, { create: true });
        const w = await h.createWritable(); await w.write(blob); await w.close();
      } else await kvSet('cap:' + name, { blob, t: Date.now() });
    },
    async remove(name) {
      if (state === 'folder') await (await capDir(false)).removeEntry(name);
      else await kvDel('cap:' + name);
    },
    // a free name like captures/kart-lab-3.png
    async freeName(game, ext) {
      const base = String(game || 'bit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bit';
      const have = new Set((await captures.list().catch(() => [])).map(c => c.name));
      let n = 1; while (have.has(`${base}-${n}.${ext}`)) n++;
      return `${base}-${n}.${ext}`;
    }
  };
  return { init, chooseFolder, reconnect, useBrowser, list, save, remove, exists, label, canPickFolder, drafts, captures, get state() { return state; } };
})();
