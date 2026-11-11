// The access gate, end to end against Web-standard Request/Response.
// Microsoft is faked: a local RSA key signs the id_token and serves the JWKS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';

const ORIGIN = 'https://proto.test';
const TENANT = 'tenant-123', CLIENT = 'client-abc';
const sha = s => createHash('sha256').update(s).digest('hex');

function setEnv(vars) {
  for (const k of Object.keys(process.env)) if (/^(PROTO_|MICROSOFT_)/.test(k)) delete process.env[k];
  Object.assign(process.env, { PROTO_SESSION_SECRET: 'x'.repeat(40) }, vars);
}
const { gate } = await import('./middleware.js');

const req = (p, init = {}) => new Request(ORIGIN + p, init);
const cookiesOf = res => (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
const loc = res => res.headers.get('location');

test('none: everything passes', async () => {
  setEnv({ PROTO_GATE: 'none' });
  assert.equal(await gate(req('/')), undefined);
});

test('password: redirect, wrong password, right password, session', async () => {
  setEnv({ PROTO_GATE: 'password', PROTO_PASSWORD_HASH: sha('open sesame'), PROTO_NAME: 'Expenses' });
  const r1 = await gate(req('/app?journey=x'));
  assert.equal(r1.status, 303);
  assert.equal(loc(r1), '/__gate/login?next=%2Fapp%3Fjourney%3Dx');

  const page = await gate(req('/__gate/login?next=/app'));
  const html = await page.text();
  assert.match(html, /Expenses/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /Sign in with Microsoft/);

  const form = p => new URLSearchParams({ password: p, next: '/app?journey=x' });
  const bad = await gate(req('/__gate/login', { method: 'POST', body: form('nope') }));
  assert.match(loc(bad), /error=wrong_password/);
  assert.equal(cookiesOf(bad), '');

  const ok = await gate(req('/__gate/login', { method: 'POST', body: form('open sesame') }));
  assert.equal(loc(ok), '/app?journey=x');
  const jar = cookiesOf(ok);
  assert.match(jar, /sm-proto-session=/);
  assert.equal(await gate(req('/app', { headers: { cookie: jar } })), undefined);

  // a tampered cookie is refused
  const forged = jar.replace(/\.[^.]+$/, '.AAAA');
  assert.equal((await gate(req('/app', { headers: { cookie: forged } }))).status, 303);
});

test('open redirects are refused', async () => {
  setEnv({ PROTO_GATE: 'password', PROTO_PASSWORD_HASH: sha('pw') });
  for (const next of ['//evil.test/x', 'https://evil.test', '/\\evil.test']) {
    const r = await gate(req('/__gate/login', { method: 'POST', body: new URLSearchParams({ password: 'pw', next }) }));
    assert.equal(loc(r), '/');
  }
});

test('sso without Entra yet: password fallback and a note', async () => {
  setEnv({ PROTO_GATE: 'sso', PROTO_PASSWORD_HASH: sha('pw') });
  const html = await (await gate(req('/__gate/login'))).text();
  assert.doesNotMatch(html, /Sign in with Microsoft/);
  assert.match(html, /Microsoft sign-in is coming/);
  const r = await gate(req('/__gate/microsoft/login'));
  assert.match(loc(r), /error=not_configured/);
});

test('sso with no password and no Entra: nobody gets in, page says why', async () => {
  setEnv({ PROTO_GATE: 'sso' });
  const html = await (await gate(req('/__gate/login'))).text();
  assert.match(html, /not set up yet/);
  assert.equal((await gate(req('/'))).status, 303);
});

/* fake Microsoft */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', use: 'sig' });
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function idToken(claims) {
  const h = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const p = b64u(Object.assign({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600 }, claims));
  const s = createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}
function fakeMicrosoft(claims) {
  return async (url, init) => {
    url = String(url);
    if (url.endsWith('/discovery/v2.0/keys')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/oauth2/v2.0/token')) {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('client_secret'), 'secret');
      assert.ok(body.get('code_verifier').length > 40);
      return Response.json({ id_token: idToken(claims(body)) });
    }
    throw new Error('unexpected fetch ' + url);
  };
}

async function roundTrip(email, extra = {}) {
  const start = await gate(req('/__gate/microsoft/login?next=/app'));
  const auth = new URL(loc(start));
  assert.equal(auth.origin, 'https://login.microsoftonline.com');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('redirect_uri'), ORIGIN + '/__gate/microsoft/callback');
  const state = auth.searchParams.get('state'), nonce = auth.searchParams.get('nonce');
  const flowJar = cookiesOf(start);
  const cb = await gate(req(`/__gate/microsoft/callback?code=c0de&state=${extra.state || state}`, { headers: { cookie: flowJar } }),
    { fetchImpl: fakeMicrosoft(() => Object.assign({ preferred_username: email, name: 'Test', nonce: extra.nonce || nonce }, extra.claims)) });
  return cb;
}

test('sso: Microsoft round trip lets an allowed-domain account in', async () => {
  setEnv({ PROTO_GATE: 'sso', MICROSOFT_TENANT_ID: TENANT, MICROSOFT_CLIENT_ID: CLIENT, MICROSOFT_CLIENT_SECRET: 'secret', PROTO_ALLOWED_DOMAIN: 'example.com' });
  const html = await (await gate(req('/__gate/login'))).text();
  assert.match(html, /Sign in with Microsoft/);
  assert.doesNotMatch(html, /type="password"/);
  const cb = await roundTrip('Sam.Taylor@example.com');
  assert.equal(loc(cb), '/app');
  assert.equal(await gate(req('/app', { headers: { cookie: cookiesOf(cb) } })), undefined);
});

test('sso: other domains, wrong state, wrong nonce, wrong audience are refused', async () => {
  setEnv({ PROTO_GATE: 'sso', MICROSOFT_TENANT_ID: TENANT, MICROSOFT_CLIENT_ID: CLIENT, MICROSOFT_CLIENT_SECRET: 'secret', PROTO_ALLOWED_DOMAIN: 'example.com' });
  assert.match(loc(await roundTrip('guest@gmail.com')), /error=not_authorized/);
  assert.match(loc(await roundTrip('a@example.com', { state: 'other' })), /error=failed/);
  assert.match(loc(await roundTrip('a@example.com', { nonce: 'other' })), /error=failed/);
  assert.match(loc(await roundTrip('a@example.com', { claims: { aud: 'someone-else' } })), /error=failed/);
});

test('sso: with no allowed domain or emails set, nobody gets in', async () => {
  setEnv({ PROTO_GATE: 'sso', MICROSOFT_TENANT_ID: TENANT, MICROSOFT_CLIENT_ID: CLIENT, MICROSOFT_CLIENT_SECRET: 'secret' });
  assert.match(loc(await roundTrip('a@example.com')), /error=not_authorized/);
});

test('sso: allow-list narrows further', async () => {
  setEnv({ PROTO_GATE: 'sso', MICROSOFT_TENANT_ID: TENANT, MICROSOFT_CLIENT_ID: CLIENT, MICROSOFT_CLIENT_SECRET: 'secret', PROTO_ALLOWED_DOMAIN: 'example.com', PROTO_ALLOWED_EMAILS: 'alex.kim@example.com' });
  assert.match(loc(await roundTrip('a@example.com')), /error=not_authorized/);
  assert.equal(loc(await roundTrip('alex.kim@example.com')), '/app');
});

test('switching password to sso-only retires password sessions', async () => {
  setEnv({ PROTO_GATE: 'password', PROTO_PASSWORD_HASH: sha('pw') });
  const ok = await gate(req('/__gate/login', { method: 'POST', body: new URLSearchParams({ password: 'pw', next: '/' }) }));
  const jar = cookiesOf(ok);
  setEnv({ PROTO_GATE: 'sso', MICROSOFT_TENANT_ID: TENANT, MICROSOFT_CLIENT_ID: CLIENT, MICROSOFT_CLIENT_SECRET: 'secret', PROTO_ALLOWED_DOMAIN: 'example.com' });
  assert.equal((await gate(req('/', { headers: { cookie: jar } }))).status, 303);
});
