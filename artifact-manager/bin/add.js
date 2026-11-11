#!/usr/bin/env node
// Add Super Artifact Manager to a prototype, document or deck.
//   node bin/add.js <prototype dir> [--gate none|password|sso] [--html a.html,b.html] [--name "Expenses"]
// Static sites: copies control-panel.js next to the pages and adds one script
// tag to each page's <head>. Next.js: copies it to public/ and prints the line
// for app/layout. Either way: a journeys.json to fill in, and, for a gate,
// middleware.js at the project root plus the env vars to set on Vercel.
// Secrets are printed once, never written into the project.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SKILL = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : d; };
const dir = path.resolve(argv.find(a => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--')) || '.');
const gateMode = opt('gate', 'none');
if (!['none', 'password', 'sso'].includes(gateMode)) { console.error('--gate must be none, password or sso'); process.exit(1); }
const pkg = fs.existsSync(path.join(dir, 'package.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) : {};
const isNext = !!((pkg.dependencies || {}).next || (pkg.devDependencies || {}).next);
const name = opt('name', pkg.name || path.basename(dir));
const log = [];

// 1. the runtime
const pub = isNext ? path.join(dir, 'public') : dir;
fs.mkdirSync(pub, { recursive: true });
fs.copyFileSync(path.join(SKILL, 'control-panel.js'), path.join(pub, 'control-panel.js'));
log.push('copied control-panel.js -> ' + path.relative(dir, path.join(pub, 'control-panel.js')));

// 2. journeys.json (never overwritten)
const jPath = path.join(pub, 'journeys.json');
if (!fs.existsSync(jPath)) {
  const t = fs.readFileSync(path.join(SKILL, 'templates/journeys.template.json'), 'utf8')
    .replace('PROTOTYPE_ID', name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace('PROTOTYPE_NAME', name);
  fs.writeFileSync(jPath, t);
  for (const d of ['default', 'empty']) fs.mkdirSync(path.join(pub, 'mocks', d), { recursive: true });
  log.push('wrote journeys.json + mocks/default, mocks/empty (fill these in)');
} else log.push('kept existing journeys.json');

// 3. load it before the prototype's own scripts
const TAG = '<script src="/control-panel.js" data-config="/journeys.json"></script>';
if (isNext) {
  log.push('Next.js: add to app/layout.tsx <head> (before anything else):\n    <script src="/control-panel.js" data-config="/journeys.json" />\n  or with next/script: <Script src="/control-panel.js" data-config="/journeys.json" strategy="beforeInteractive" />');
} else {
  // nosemgrep: path-join-resolve-traversal -- a local CLI writing into the folder its own user named
  const pages = (opt('html') ? opt('html').split(',') : fs.readdirSync(dir).filter(f => f.endsWith('.html'))).map(f => path.join(dir, f));
  for (const p of pages) {
    let html = fs.readFileSync(p, 'utf8');
    if (html.includes('control-panel.js')) { log.push('already loaded in ' + path.basename(p)); continue; }
    const rel = path.relative(path.dirname(p), dir) || '.';
    const tag = TAG.replace(/"\//g, '"' + (rel === '.' ? '' : rel + '/'));
    const m = /<head[^>]*>/i.exec(html);
    if (!m) { log.push('!! no <head> in ' + path.basename(p) + ', add by hand: ' + tag); continue; }
    // after <meta charset> if present, so the charset stays first
    const cs = /<meta[^>]+charset[^>]*>/i.exec(html.slice(m.index));
    const at = cs ? m.index + cs.index + cs[0].length : m.index + m[0].length;
    html = html.slice(0, at) + '\n' + tag + html.slice(at);
    fs.writeFileSync(p, html);
    log.push('added the script tag to ' + path.basename(p));
  }
}

// 4. the gate
if (gateMode !== 'none') {
  const mw = path.join(dir, fs.existsSync(path.join(dir, 'src', 'app')) ? 'src' : '', 'middleware.js');
  if (fs.existsSync(mw) || fs.existsSync(mw.replace(/\.js$/, '.ts'))) log.push('!! a middleware already exists at ' + path.relative(dir, mw) + '. Merge gate/middleware.js into it by hand: call gate(request) first and return its Response when it gives one.');
  else { fs.copyFileSync(path.join(SKILL, 'gate/middleware.js'), mw); log.push('copied the gate -> ' + path.relative(dir, mw)); }
  const env = { PROTO_GATE: gateMode, PROTO_NAME: name, PROTO_SESSION_SECRET: crypto.randomBytes(32).toString('hex') };
  let password = null;
  if (gateMode === 'password' || opt('fallback-password') !== 'no') {
    password = opt('password') || crypto.randomBytes(9).toString('base64url');
    env.PROTO_PASSWORD_HASH = crypto.createHash('sha256').update(password).digest('hex');
  }
  log.push('\nSet these on the Vercel project (Production), not in the repo:');
  Object.entries(env).forEach(([k, v]) => log.push(`  vercel env add ${k} production   # ${k === 'PROTO_SESSION_SECRET' ? '(random, shown once) ' : ''}${v}`));
  if (password) log.push(`\nPassword to share: ${password}\n(only its hash goes to Vercel; share it with your reviewers)`);
  if (gateMode === 'sso') log.push('\nMicrosoft sign-in stays off until these exist (see SKILL.md, "Microsoft SSO setup"):\n  MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, PROTO_ALLOWED_DOMAIN\nUntil then the password above keeps working.');
}
console.log(log.join('\n'));
