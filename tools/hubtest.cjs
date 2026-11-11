// Share hub publisher check (tools/hub_publish.cjs) with made-up issues and downloads: games by play link and by
// attached .txt / .json, photos and clips, the approval rules, edits, and taking posts down.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { build, formFields } = require('./hub_publish.cjs');
const Share = window.BKShare;
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok  ', m);

const cart = { format: 'bitkit-cart', version: 1, name: 'Tiny', code: 'function _draw() cls(3) end', palette: Buffer.alloc(768, 7).toString('base64'),
  tiles: Buffer.from([255, 0, 255, 0]).toString('base64'), flags: Buffer.from([255, 0]).toString('base64'), map: Buffer.from([255, 0, 255, 0]).toString('base64'),
  levels: [{ name: 'Level 1', w: 256, h: 128, map: Buffer.from([255, 0, 255, 0]).toString('base64'), placed: [] }], entities: { types: [], placed: [] } };
cart.map = cart.levels[0].map;
const link = Share.SITE + '#play=1.' + zlib.deflateRawSync(Buffer.from(Share.packCart(cart))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(100)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100)]);
const files = {
  'https://github.com/user-attachments/assets/aaa': PNG,
  'https://github.com/user-attachments/assets/bbb': GIF,
  'https://github.com/user-attachments/files/1/long.link.txt': Buffer.from(link + '\n'),
  'https://github.com/user-attachments/files/2/tiny.bitkit.json': Buffer.from(JSON.stringify(Object.assign({}, cart, { name: 'From file' }))),
  'https://github.com/user-attachments/files/3/bad.json': Buffer.from('{"hello": 1}'),
};
const download = async u => { if (!files[u]) throw new Error('404'); return files[u]; };
const body = f => Object.entries(f).map(([k, v]) => `### ${k}\n\n${v || '_No response_'}`).join('\n\n');
const issue = (number, f, extra) => Object.assign({ number, title: '[Share] ' + (f.Name || ''), state: 'open', author_association: 'OWNER', labels: [{ name: 'share' }],
  user: { login: 'maker' + number }, html_url: 'https://github.com/x/y/issues/' + number, created_at: `2026-11-${10 + number}T10:00:00Z`, updated_at: 'u1', body: body(f) }, extra || {});
const issues = [
  issue(1, { 'What is it?': 'Game', Name: 'Linked game', Game: link, 'Photos and clips': '![shot](https://github.com/user-attachments/assets/aaa)', 'About it': 'Jump around.' }),
  issue(2, { 'What is it?': 'Game', Name: '', Game: '[long.link.txt](https://github.com/user-attachments/files/1/long.link.txt)', 'Show me as': 'Moss' }, { author_association: 'NONE', labels: [{ name: 'share' }, { name: 'hub-ok' }] }),
  issue(3, { 'What is it?': 'Clip', Name: 'Big jump', 'Photos and clips': 'https://github.com/user-attachments/assets/bbb' }),
  issue(4, { 'What is it?': 'Game', Name: 'Waiting', Game: link }, { author_association: 'NONE' }),
  issue(5, { 'What is it?': 'Game', Name: 'Json file', Game: '[tiny.bitkit.json](https://github.com/user-attachments/files/2/tiny.bitkit.json)' }),
  issue(6, { 'What is it?': 'Game', Name: 'Broken', Game: '[bad.json](https://github.com/user-attachments/files/3/bad.json)' }),
  issue(7, { 'What is it?': 'Photo', Name: 'Hidden', 'Photos and clips': '![x](https://github.com/user-attachments/assets/aaa)' }, { labels: [{ name: 'share' }, { name: 'hub-hide' }] }),
  issue(8, { 'What is it?': 'Game', Name: 'Not a share' }, { title: 'Bug: crash', labels: [] }),
  issue(9, { 'What is it?': 'Utility app', Name: 'Egg timer', Game: link, 'About it': 'Counts down.' }),
];

(async () => {
  if (formFields(issues[0].body)['what is it?'] !== 'Game') fail('form fields');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  const logs = [];
  let res = await build(dir, issues, download, m => logs.push(m));
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const ids = idx.items.map(i => i.id).sort();
  if (JSON.stringify(ids) === '[1,2,3,5,9]') ok('shown: maintainer posts and the approved one; not waiting, broken, hidden or other issues'); else fail('shown ids ' + ids);
  const one = idx.items.find(i => i.id === 1);
  const g1 = JSON.parse(fs.readFileSync(path.join(dir, one.cart), 'utf8'));
  if (g1.code === cart.code && g1.tiles === cart.tiles && one.media[0] === 'items/1/1.png' && fs.existsSync(path.join(dir, one.media[0]))) ok('game from a play link, with its photo'); else fail('item 1 ' + JSON.stringify(one));
  const two = idx.items.find(i => i.id === 2);
  if (two.author === 'Moss' && two.title === 'Tiny' && two.cart) ok('game from an attached .link.txt, credited as asked, named after the game'); else fail('item 2 ' + JSON.stringify(two));
  const three = idx.items.find(i => i.id === 3);
  if (three.kind === 'clip' && three.media[0] === 'items/3/1.gif' && !three.cart) ok('clip post'); else fail('item 3 ' + JSON.stringify(three));
  if (JSON.parse(fs.readFileSync(path.join(dir, 'items/5/game.bitkit'), 'utf8')).name === 'From file') ok('game from an attached .json cart'); else fail('item 5');
  if (res.get(6).error && /not a BitKit game/.test(res.get(6).error)) ok('a broken game is refused with a reason: ' + res.get(6).error); else fail('item 6 ' + JSON.stringify(res.get(6)));
  const nine = idx.items.find(i => i.id === 9);
  if (nine.kind === 'app' && nine.cart && nine.title === 'Egg timer') ok('a utility app post'); else fail('item 9 ' + JSON.stringify(nine));
  if (res.get(4).hidden) ok('a new person\'s post waits for hub-ok'); else fail('item 4');

  // approve 4, close 1, edit 3: the hub follows
  issues[3].labels.push({ name: 'hub-ok' }); issues[3].updated_at = 'u2';
  issues[0].state = 'closed';
  issues[2].body = body({ 'What is it?': 'Clip', Name: 'Bigger jump', 'Photos and clips': 'https://github.com/user-attachments/assets/bbb' }); issues[2].updated_at = 'u2';
  res = await build(dir, issues, download, m => logs.push(m));
  const idx2 = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const ids2 = idx2.items.map(i => i.id).sort();
  if (JSON.stringify(ids2) === '[2,3,4,5,9]' && !fs.existsSync(path.join(dir, 'items/1'))) ok('approving adds a post, closing takes one down (files too)'); else fail('after changes ' + ids2);
  if (idx2.items.find(i => i.id === 3).title === 'Bigger jump') ok('an edited post is updated'); else fail('edit');
  if (res.get(5).same) ok('unchanged posts are not downloaded again'); else fail('item 5 was rebuilt');
  fs.rmSync(dir, { recursive: true, force: true });
  if (!process.exitCode) console.log('hub publisher OK');
})();
