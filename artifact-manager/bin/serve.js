#!/usr/bin/env node
// Local static server for a prototype, with the access gate in front of it
// when PROTO_GATE is set (same middleware that runs on Vercel).
//   node bin/serve.js <root> [--port 4630] [--open <path>]
const http = require('http'), fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const root = path.resolve(args.find(a => !a.startsWith('--')) || '.');
const port = +(args[args.indexOf('--port') + 1] || 0) || 4630;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.otf': 'font/otf' };

let gate = null;
const gateReady = (process.env.PROTO_GATE && process.env.PROTO_GATE !== 'none')
  ? import(path.join(__dirname, '..', 'gate', 'middleware.js')).then(m => { gate = m.gate; })
  : Promise.resolve();

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

// Local preview server only (localhost); deployed prototypes are served by their host over HTTPS.
http.createServer(async (req, res) => { // nosemgrep: using-http-server
  try {
    await gateReady;
    if (gate) {
      const out = await gate(await toRequest(req));
      if (out) {
        const headers = {};
        out.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
        const cookies = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
        if (cookies.length) headers['set-cookie'] = cookies;
        res.writeHead(out.status, headers);
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
    }
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // nosemgrep: path-join-resolve-traversal -- resolved, then refused unless it stays inside root
    let file = path.resolve(root, '.' + p);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); // nosemgrep: path-join-resolve-traversal -- file is already inside root
    if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
}).listen(port, () => console.log(`artifact-manager: http://localhost:${port}/ (root ${root}${gate || process.env.PROTO_GATE ? ', gate ' + process.env.PROTO_GATE : ''})`));
