/* Super Artifact Manager: access gate.
 *
 * One Edge middleware, no dependencies (Web Crypto only), for Vercel Routing
 * Middleware (any static or framework project) and Next.js `middleware.js`.
 * It gates every request before the prototype or its data is served.
 *
 *   PROTO_GATE=none       no gate (or just don't deploy this file)
 *   PROTO_GATE=password   one shared password
 *   PROTO_GATE=sso        "Sign in with Microsoft" (Entra ID, single tenant).
 *                         Until the Entra app is registered, a password set in
 *                         PROTO_PASSWORD_HASH keeps working as the fallback.
 *
 * Environment (Vercel project env, never in the repo):
 *   PROTO_SESSION_SECRET     required for password/sso, 32+ random chars
 *   PROTO_PASSWORD_HASH      sha256 hex of the password
 *   PROTO_NAME               shown on the sign-in page
 *   PROTO_SESSION_HOURS      default 168 (7 days)
 *   MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_REDIRECT_URI   optional, default <origin>/__gate/microsoft/callback
 *   PROTO_ALLOWED_DOMAIN     e.g. example.com (guest accounts are refused)
 *   PROTO_ALLOWED_EMAILS     comma list; if set, only these get in
 *                            Set at least one of the two, or nobody gets in.
 *
 * Sign-in: OIDC code flow + PKCE, state and nonce
 * in a short-lived signed cookie, id_token verified against Microsoft's JWKS,
 * domain-suffix check as the backstop to single-tenant.
 */

const SESSION = 'sm-proto-session';
const FLOW = 'sm-proto-flow';
const PREFIX = '/__gate';
const enc = new TextEncoder();

export const config = {
  // Everything, except Next/Vercel internals and the favicon.
  matcher: ['/((?!_next/static|_next/image|_vercel|favicon.ico).*)'],
};

const env = k => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined) || '';

/* ── small crypto helpers ─────────────────────────────────────────────────── */

const b64u = buf => {
  let s = '';
  new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = str => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
};
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function hmacKey() {
  const secret = env('PROTO_SESSION_SECRET');
  if (secret.length < 32) throw new Error('PROTO_SESSION_SECRET missing or shorter than 32 chars');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function seal(data, ttlSeconds) {
  const body = b64u(enc.encode(JSON.stringify(Object.assign({}, data, { exp: Math.floor(Date.now() / 1000) + ttlSeconds }))));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body)));
  return body + '.' + sig;
}
export async function unseal(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch (e) { return null; }
}

function readCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function cookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/* ── Entra ID ─────────────────────────────────────────────────────────────── */

export const entraConfigured = () => Boolean(env('MICROSOFT_TENANT_ID') && env('MICROSOFT_CLIENT_ID') && env('MICROSOFT_CLIENT_SECRET'));
const authority = () => `https://login.microsoftonline.com/${env('MICROSOFT_TENANT_ID')}`;
const redirectUri = origin => env('MICROSOFT_REDIRECT_URI') || `${origin}${PREFIX}/microsoft/callback`;
const SCOPE = 'openid profile email';

let jwksCache = null;
async function jwks(fetchImpl) {
  if (jwksCache && jwksCache.at > Date.now() - 3600e3) return jwksCache.keys;
  const res = await fetchImpl(`${authority()}/discovery/v2.0/keys`);
  if (!res.ok) throw new Error('jwks ' + res.status);
  jwksCache = { at: Date.now(), keys: (await res.json()).keys || [] };
  return jwksCache.keys;
}

export async function verifyIdToken(idToken, fetchImpl = fetch) {
  const [h, p, s] = idToken.split('.');
  const header = JSON.parse(new TextDecoder().decode(unb64u(h)));
  const payload = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (header.alg !== 'RS256') throw new Error('alg');
  let jwk = (await jwks(fetchImpl)).find(k => k.kid === header.kid);
  if (!jwk) { jwksCache = null; jwk = (await jwks(fetchImpl)).find(k => k.kid === header.kid); }
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), enc.encode(h + '.' + p));
  if (!ok) throw new Error('signature');
  const now = Date.now() / 1000;
  if (payload.iss !== `${authority()}/v2.0`) throw new Error('issuer');
  if (payload.aud !== env('MICROSOFT_CLIENT_ID')) throw new Error('audience');
  if (!(payload.exp > now - 60) || (payload.nbf && payload.nbf > now + 60)) throw new Error('expired');
  const email = String(payload.preferred_username || payload.email || payload.upn || '').toLowerCase();
  return { email: email || null, name: payload.name || null, nonce: payload.nonce };
}

export function emailAllowed(email) {
  if (!email) return false;
  const domain = env('PROTO_ALLOWED_DOMAIN').trim().toLowerCase();
  const list = env('PROTO_ALLOWED_EMAILS').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!domain && list.length === 0) return false;   // fail closed: nothing configured, nobody in
  if (domain && !email.endsWith('@' + domain)) return false;
  return list.length === 0 || list.includes(email);
}

/* ── pages ────────────────────────────────────────────────────────────────── */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ERRORS = {
  wrong_password: 'That password is not right.',
  not_configured: "Microsoft sign-in isn't set up for this prototype yet.",
  not_authorized: "Your account doesn't have access to this prototype.",
  expired: 'The sign-in took too long. Try again.',
  failed: "Microsoft sign-in didn't complete. Try again.",
};

function loginPage({ next, error, password, microsoft, ssoPending }) {
  const name = env('PROTO_NAME') || 'Prototype';
  const ms = '<svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>';
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(name)} · sign in</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f2f2f0;font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{width:100%;max-width:360px;background:#121212;border:1px solid #262626;border-radius:16px;padding:28px}
.k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a8a86}
h1{font-size:22px;font-weight:600;margin:6px 0 20px}
label{display:block;font-size:13px;color:#b5b5b0;margin-bottom:6px}
input{width:100%;height:42px;border-radius:10px;border:1px solid #333;background:#0b0b0b;color:#f2f2f0;padding:0 12px;font:inherit}
input:focus{outline:2px solid #f6ff9a;outline-offset:1px;border-color:transparent}
button,.ms{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:42px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;margin-top:12px}
button{background:#f6ff9a;color:#111;border:0}
.ms{background:#fff;color:#111;border:0}
.or{display:flex;align-items:center;gap:10px;color:#6a6a66;font-size:12px;margin:18px 0 6px}.or::before,.or::after{content:"";flex:1;height:1px;background:#262626}
.err{background:#2a1714;border:1px solid #4a221c;color:#ffb3a8;border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:14px}
.note{color:#8a8a86;font-size:12.5px;margin-top:14px}
</style></head><body><main class="card">
<div class="k">Prototype</div><h1>${esc(name)}</h1>
${error ? `<div class="err" role="alert">${esc(ERRORS[error] || ERRORS.failed)}</div>` : ''}
${microsoft ? `<a class="ms" href="${PREFIX}/microsoft/login?next=${encodeURIComponent(next)}">${ms}Sign in with Microsoft</a>` : ''}
${microsoft && password ? '<div class="or">or</div>' : ''}
${password ? `<form method="post" action="${PREFIX}/login"><input type="hidden" name="next" value="${esc(next)}">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Enter</button></form>` : ''}
${ssoPending ? '<p class="note">Microsoft sign-in is coming. Use the password for now.</p>' : ''}
${!microsoft && !password ? '<p class="note">Access to this prototype is not set up yet. Ask whoever shared it.</p>' : ''}
</main></body></html>`;
  return new Response(body, { status: error === 'not_authorized' ? 403 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !n.startsWith(PREFIX) ? n : '/');
const redirect = (to, cookies = []) => {
  const headers = new Headers({ location: to, 'cache-control': 'no-store' });
  cookies.forEach(c => headers.append('set-cookie', c));
  return new Response(null, { status: 303, headers });
};

/* ── the middleware ───────────────────────────────────────────────────────── */

export async function gate(request, { fetchImpl = fetch } = {}) {
  const mode = (env('PROTO_GATE') || 'none').toLowerCase();
  if (mode === 'none') return undefined;

  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const hours = +env('PROTO_SESSION_HOURS') || 168;
  const passwordOn = Boolean(env('PROTO_PASSWORD_HASH')) && (mode === 'password' || mode === 'sso');
  const msOn = mode === 'sso' && entraConfigured();
  const opts = { password: passwordOn, microsoft: msOn, ssoPending: mode === 'sso' && !msOn && passwordOn };
  const path = url.pathname;

  if (path === PREFIX + '/logout') return redirect('/', [cookie(SESSION, '', 0, secure)]);

  if (path === PREFIX + '/login' && request.method === 'GET') {
    return loginPage(Object.assign({ next: safeNext(url.searchParams.get('next')), error: url.searchParams.get('error') }, opts));
  }

  if (path === PREFIX + '/login' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const next = safeNext(form && form.get('next'));
    if (!passwordOn) return redirect(`${PREFIX}/login?next=${encodeURIComponent(next)}`);
    const given = await sha256(String((form && form.get('password')) || ''));
    const want = env('PROTO_PASSWORD_HASH').trim().toLowerCase();
    if (!sameBytes(enc.encode(hex(given)), enc.encode(want))) {
      await new Promise(r => setTimeout(r, 400)); // slows guessing a little; use a long password
      return redirect(`${PREFIX}/login?error=wrong_password&next=${encodeURIComponent(next)}`);
    }
    return redirect(next, [cookie(SESSION, await seal({ sub: 'password', via: 'password' }, hours * 3600), hours * 3600, secure)]);
  }

  if (path === PREFIX + '/microsoft/login') {
    const next = safeNext(url.searchParams.get('next'));
    if (!msOn) return redirect(`${PREFIX}/login?error=not_configured&next=${encodeURIComponent(next)}`);
    const flow = { state: rand(24), nonce: rand(24), verifier: rand(48), next };
    const q = new URLSearchParams({
      client_id: env('MICROSOFT_CLIENT_ID'), response_type: 'code', response_mode: 'query',
      redirect_uri: redirectUri(url.origin), scope: SCOPE, state: flow.state, nonce: flow.nonce,
      code_challenge: b64u(await sha256(flow.verifier)), code_challenge_method: 'S256', prompt: 'select_account',
    });
    return redirect(`${authority()}/oauth2/v2.0/authorize?${q}`, [cookie(FLOW, await seal(flow, 600), 600, secure)]);
  }

  if (path === PREFIX + '/microsoft/callback') {
    const fail = (e, next = '/') => redirect(`${PREFIX}/login?error=${e}&next=${encodeURIComponent(next)}`, [cookie(FLOW, '', 0, secure)]);
    if (!msOn) return fail('not_configured');
    const flow = await unseal(readCookie(request, FLOW));
    if (!flow) return fail('expired');
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== flow.state) return fail('failed', flow.next);
    let who;
    try {
      const res = await fetchImpl(`${authority()}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env('MICROSOFT_CLIENT_ID'), client_secret: env('MICROSOFT_CLIENT_SECRET'), grant_type: 'authorization_code',
          code, redirect_uri: redirectUri(url.origin), code_verifier: flow.verifier, scope: SCOPE,
        }),
      });
      if (!res.ok) return fail('failed', flow.next);
      who = await verifyIdToken((await res.json()).id_token, fetchImpl);
    } catch (e) { return fail('failed', flow.next); }
    if (who.nonce !== flow.nonce) return fail('failed', flow.next);
    if (!emailAllowed(who.email)) return fail('not_authorized', flow.next);
    return redirect(flow.next, [
      cookie(FLOW, '', 0, secure),
      cookie(SESSION, await seal({ sub: who.email, name: who.name, via: 'microsoft' }, hours * 3600), hours * 3600, secure),
    ]);
  }

  const session = await unseal(readCookie(request, SESSION));
  // A password session stops counting once the gate is SSO-only.
  if (session && (session.via === 'microsoft' ? msOn : passwordOn)) return undefined;
  return redirect(`${PREFIX}/login?next=${encodeURIComponent(path + url.search)}`);
}

export default function middleware(request) {
  return gate(request);
}
