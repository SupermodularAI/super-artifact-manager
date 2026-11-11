#!/usr/bin/env node
// Leave a comment on a prototype, document or deck from the command line: for
// agents (Claude Code, for example) and scripts. It writes to comments.json next
// to the artifact; the page loads it when the config says
// "comments": { "file": "comments.json" } (bin/add.js and the examples do).
//
//   node bin/comment.js <artifact dir> --text "The total should stand out" \
//        [--page index.html] [--selector "#total"] [--quote "words on the page"] \
//        [--point 0.4,0.2] [--area 0.1,0.2,0.5,0.3] \
//        [--link "WCAG contrast|https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum"] \
//        [--agent claude-code | --author "Sam Rivera"] [--version v2] [--journey id] [--step 3] \
//        [--reply-to <comment id>] [--resolved]
//   node bin/comment.js <artifact dir> --list
//
// What it points at: --selector (an element), plus --quote (words inside it), a
// --point or an --area (fractions of the element's box, or of the page without
// a selector). Without --author the comment is from Claude Code. --link repeats.
// Prints the new comment's id. The file merges by id, so it can keep growing.
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const flags = new Set(['--list', '--resolved', '--help', '-h']);
const dir = argv.find((a, i) => !a.startsWith('-') && (i === 0 || !argv[i - 1].startsWith('--') || flags.has(argv[i - 1])));
const one = k => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : undefined; };
const many = k => argv.reduce((out, a, i) => (a === '--' + k && argv[i + 1] !== undefined ? out.concat(argv[i + 1]) : out), []);
if (!dir || argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
  process.exit(dir ? 0 : 1);
}
const file = fs.statSync(dir).isDirectory() ? path.join(dir, 'comments.json') : dir;
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { comments: [] };
if (!Array.isArray(data.comments)) data.comments = [];

if (argv.includes('--list')) {
  for (const c of data.comments) {
    console.log(`${c.id}  ${c.page || 'index.html'}  ${c.author || c.agent || 'Reviewer'}: ${c.comment}` + ((c.replies || []).length ? `  (${c.replies.length} replies)` : ''));
  }
  process.exit(0);
}

const text = one('text');
if (!text || !text.trim()) { console.error('--text is required'); process.exit(1); }
const nums = (v, n) => { if (v === undefined) return undefined; const p = v.split(',').map(Number); if (p.length !== n || p.some(x => !isFinite(x))) { console.error('expected ' + n + ' numbers: ' + v); process.exit(1); } return p; };
const links = many('link').map(l => { const i = l.lastIndexOf('|'); const url = i > -1 ? l.slice(i + 1) : l; if (!/^https?:\/\//i.test(url)) { console.error('links must be http(s): ' + url); process.exit(1); } return i > -1 ? { label: l.slice(0, i), url } : { url }; });
const author = one('author');
const who = author ? { author } : { agent: one('agent') || 'claude-code' };
const id = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const now = new Date().toISOString();

const replyTo = one('reply-to');
if (replyTo) {
  const parent = data.comments.find(c => c.id === replyTo);
  if (!parent) { console.error('no comment with id ' + replyTo); process.exit(1); }
  parent.replies = (parent.replies || []).concat({ id, ...who, comment: text, createdAt: now, ...(links.length ? { links } : {}) });
} else {
  const point = nums(one('point'), 2), area = nums(one('area'), 4);
  const c = { id, page: (one('page') || 'index.html').toLowerCase(), ...who, comment: text, createdAt: now };
  if (one('selector')) c.selector = one('selector');
  if (one('quote')) c.quote = one('quote');
  if (point) c.point = { x: point[0], y: point[1] };
  if (area) c.area = { x: area[0], y: area[1], w: area[2], h: area[3] };
  if (!c.selector && (point || area || c.quote)) { console.error('--point, --area and --quote need a --selector (the element they are inside)'); process.exit(1); }
  if (links.length) c.links = links;
  for (const k of ['version', 'journey']) if (one(k)) c[k] = one(k);
  if (one('step')) c.step = +one('step');
  if (argv.includes('--resolved')) c.resolved = true;
  data.comments.push(c);
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(id);
