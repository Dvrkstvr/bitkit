// Share hub publisher (runs in .github/workflows/hub.yml). Reads every share issue, and writes the hub into a
// checkout of the "hub" branch: index.json plus items/<issue>/ with the game (game.bitkit) and its pictures.
// It is rebuilt from all issues each time, so edits, closes and labels just work.
// Rules: a post shows when its issue is open and either its author is a maintainer (owner, member, collaborator)
// or it has the label "hub-ok"; the label "hub-hide" hides it.
// Usage: node tools/hub_publish.cjs <hub dir>   (env: GITHUB_TOKEN, REPO, EVENT_*)
// MIT License.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// the play-link codec is the studio's own (studio/share.js), run here with zlib instead of the browser's streams
global.window = global.window || {};
eval(fs.readFileSync(path.join(__dirname, '..', 'studio', 'share.js'), 'utf8'));
const Share = window.BKShare;

const LIMITS = { media: 4, image: 5 << 20, video: 12 << 20, cart: 2 << 20 };
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const ATTACH = /https:\/\/(?:github\.com\/user-attachments\/(?:assets|files)\/[^\s)"'<>\]]+|(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>\]]+)/g;

// issue form body: "### Label\n\nvalue" sections
function formFields(body) {
  const out = {}, parts = String(body || '').split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n'), k = p.slice(0, nl).trim().toLowerCase(), v = p.slice(nl + 1).trim();
    out[k] = v === '_No response_' ? '' : v;
  }
  return out;
}
const field = (f, ...names) => { for (const n of names) if (f[n] !== undefined) return f[n]; return ''; };
function sniff(buf) {
  const b = buf.subarray(0, 12), s = b.toString('latin1');
  if (s.startsWith('\x89PNG')) return 'png';
  if (s.startsWith('GIF8')) return 'gif';
  if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
  if (s.slice(4, 8) === 'ftyp') return 'mp4';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm';
  return null;
}
async function cartFromText(t) {
  const d = Share.findPlay(t);
  if (d) {
    const b64 = d.replace(/-/g, '+').replace(/_/g, '/');
    return Share.unpackCart(new Uint8Array(zlib.inflateRawSync(Buffer.from(b64, 'base64'))));
  }
  const o = JSON.parse(t);
  return o;
}
function checkCart(o) {
  if (!o || (o.format !== 'bitkit-cart' && o.format !== 'miniboi-cart')) throw new Error('that is not a BitKit game');
  if (typeof o.code !== 'string' || !o.code.trim()) throw new Error('the game has no code');
  return o;
}
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, n);

// one issue -> { item } or { error }; download(url) -> Buffer
async function readIssue(issue, download, log) {
  const f = formFields(issue.body);
  const kindRaw = field(f, 'what is it?').toLowerCase();
  const kind = /photo/.test(kindRaw) ? 'photo' : /clip/.test(kindRaw) ? 'clip' : 'game';
  const title = clean(field(f, 'name') || issue.title.replace(/^\[share\]\s*/i, ''), 60) || 'Untitled';
  const item = { id: issue.number, kind, title, author: clean(field(f, 'show me as'), 40) || issue.user.login,
    github: issue.user.login, text: clean(field(f, 'about it'), 280), url: issue.html_url, date: issue.created_at, media: [], files: {} };
  const problems = [];
  // the game: a play link in the Game box, or an attached .txt/.json holding a link or a cart
  const gameBox = field(f, 'game');
  let cart = null;
  try {
    if (Share.findPlay(gameBox)) cart = checkCart(await cartFromText(gameBox));
    else for (const u of gameBox.match(ATTACH) || []) {
      const buf = await download(u, LIMITS.cart);
      if (sniff(buf)) continue;
      cart = checkCart(await cartFromText(buf.toString('utf8'))); break;
    }
  } catch (e) { problems.push('The game could not be read: ' + e.message + '.'); }
  if (cart) { item.files['game.bitkit'] = Buffer.from(JSON.stringify(cart)); item.cart = 'game.bitkit'; if (!field(f, 'name')) item.title = clean(cart.name, 60) || item.title; }
  else if (kind === 'game' && !problems.length) problems.push('No game found: paste the play link from the studio into the Game box.');
  // pictures and clips
  const mediaUrls = [...new Set((field(f, 'photos and clips') + '\n' + (cart ? '' : gameBox)).match(ATTACH) || [])];
  for (const u of mediaUrls) {
    if (item.media.length >= LIMITS.media) break;
    try {
      const buf = await download(u, LIMITS.video);
      const t = sniff(buf);
      if (!t) continue;
      if ((t === 'png' || t === 'jpg') && buf.length > LIMITS.image) { problems.push('A photo is over 5 MB and was left out.'); continue; }
      const name = `${item.media.length + 1}.${t}`;
      item.files[name] = buf; item.media.push(name);
    } catch (e) { problems.push(`A file could not be downloaded (${e.message}).`); }
  }
  if (kind !== 'game' && !item.media.length) problems.push('No photo or clip found: drag the .png or .gif into the Photos and clips box.');
  if (!item.cart && !item.media.length) return { error: problems.join(' ') || 'Nothing to show.' };
  return { item, problems };
}
function visible(issue) {
  const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name);
  if (issue.state !== 'open' || labels.includes('hub-hide')) return false;
  return TRUSTED.has(issue.author_association) || labels.includes('hub-ok');
}
function isShare(issue) {
  const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name);
  return !issue.pull_request && (labels.includes('share') || /^\[share\]/i.test(issue.title || ''));
}

// build the hub in dir from the list of issues
async function build(dir, issues, download, log) {
  log = log || console.log;
  const results = new Map(), items = [];
  const old = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch (e) { return { items: [] }; } })();
  const oldById = new Map((old.items || []).map(it => [it.id, it]));
  const keep = new Set();
  for (const issue of issues.filter(isShare).sort((a, b) => b.number - a.number)) {
    if (!visible(issue)) { results.set(issue.number, { hidden: true }); continue; }
    const prev = oldById.get(issue.number), folder = path.join(dir, 'items', String(issue.number));
    if (prev && prev.updated === issue.updated_at && fs.existsSync(folder)) { items.push(prev); keep.add(issue.number); results.set(issue.number, { item: prev, same: true }); continue; }
    let r;
    try { r = await readIssue(issue, download, log); } catch (e) { r = { error: e.message }; }
    results.set(issue.number, r);
    if (r.error) { log(`#${issue.number}: ${r.error}`); continue; }
    fs.rmSync(folder, { recursive: true, force: true }); fs.mkdirSync(folder, { recursive: true });
    for (const [n, b] of Object.entries(r.item.files)) fs.writeFileSync(path.join(folder, n), b);
    const it = Object.assign({}, r.item, { updated: issue.updated_at });
    delete it.files;
    if (it.cart) it.cart = `items/${it.id}/${it.cart}`;
    it.media = it.media.map(m => `items/${it.id}/${m}`);
    items.push(it); keep.add(issue.number);
    log(`#${issue.number}: ${it.kind} "${it.title}" by ${it.author}${it.cart ? ' + game' : ''}, ${it.media.length} picture(s)`);
  }
  // take down what is no longer shown
  const itemsDir = path.join(dir, 'items');
  if (fs.existsSync(itemsDir)) for (const d of fs.readdirSync(itemsDir)) if (!keep.has(+d)) { fs.rmSync(path.join(itemsDir, d), { recursive: true, force: true }); log(`#${d}: taken down`); }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ updated: new Date().toISOString(), items }, null, 1));
  fs.writeFileSync(path.join(dir, 'README.md'), '# BitKit Share hub\n\nBuilt by `.github/workflows/hub.yml` from the share issues. Do not edit by hand: it is rebuilt every time.\n');
  return results;
}

/* ---------------------------------------------------------------- GitHub */
async function main() {
  const dir = process.argv[2] || 'hubdata', repo = process.env.REPO, token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('REPO and GITHUB_TOKEN are needed');
  const api = async (p, opt) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${p}`, Object.assign({ headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' } }, opt));
    if (!r.ok && !(opt && opt.ok && opt.ok.includes(r.status))) throw new Error(`GitHub ${p}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  // labels the form and the rules use
  for (const [name, color, description] of [['share', '1d76db', 'Posted to the Share hub'], ['hub-ok', '0e8a16', 'Share hub: approved, shows in the hub'], ['hub-hide', 'b60205', 'Share hub: hidden']])
    await api('/labels', { method: 'POST', body: JSON.stringify({ name, color, description }), ok: [422] });
  const issues = [];
  for (let page = 1; page < 50; page++) {
    const batch = await api(`/issues?state=all&per_page=100&page=${page}`);
    issues.push(...batch.filter(isShare));
    if (batch.length < 100) break;
  }
  const download = async (url, max) => {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'bitkit-hub' } });
    if (!r.ok) throw new Error(String(r.status));
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > max) throw new Error(`over ${max >> 20} MB`);
    return b;
  };
  const results = await build(dir, issues, download);

  // tell the poster what happened (when it is posted, and when it is approved)
  const n = +process.env.EVENT_ISSUE, act = process.env.EVENT_ACTION, issue = issues.find(i => i.number === n);
  if (!issue) return;
  const labels = (issue.labels || []).map(l => l.name);
  if (!labels.includes('share')) await api(`/issues/${n}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['share'] }) });
  const r = results.get(n) || {};
  const studio = `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/`;
  let msg = null;
  if (r.error && (act === 'opened' || act === 'edited')) msg = `Hmm, this could not go in the hub: ${r.error}\n\nEdit the post to fix it and the hub tries again.`;
  else if (r.hidden && act === 'opened') msg = 'Thanks for sharing! A maintainer has a quick look, then it shows up in the Share hub.';
  else if (r.item && !r.same && (act === 'opened' || (act === 'labeled' && process.env.EVENT_LABEL === 'hub-ok')))
    msg = `It's in the Share hub! Play it at ${studio}#hub=${n} (the hub updates within a few minutes).` + (r.problems && r.problems.length ? '\n\nNote: ' + r.problems.join(' ') : '');
  if (msg) await api(`/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body: msg }) });
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { build, readIssue, formFields, visible, isShare };
