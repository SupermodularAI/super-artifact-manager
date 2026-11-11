// node --test control-panel.test.js gate/gate.test.mjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('./control-panel.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'examples/expenses/journeys.json'), 'utf8'));

test('defaults fill in what a journey leaves out', () => {
  const s = C.resolveState(cfg, 'first-day', {});
  assert.equal(s.role, 'approver');
  assert.equal(s.data, 'empty');
  assert.equal(s.region, 'EU');
  assert.equal(s.user.name, 'Clara Voss');
  assert.deepEqual(s.flags, { quickApprove: false });
  assert.equal(s.modified, false);
});

test('unknown journey falls back to the default journey', () => {
  assert.equal(C.resolveState(cfg, 'nope', {}).journey, 'approver-happy');
  assert.equal(C.resolveState({}, 'x', {}).journey, 'default');
});

test('overrides win and mark the state modified', () => {
  const s = C.resolveState(cfg, 'approver-happy', { role: 'requester', flags: { quickApprove: true }, network: { offline: true } });
  assert.equal(s.role, 'requester');
  assert.equal(s.user.name, 'Ana Costa');
  assert.equal(s.flags.quickApprove, true);
  assert.equal(s.network.offline, true);
  assert.equal(s.network.latencyMs, 0);
  assert.equal(s.modified, true);
});

test('unknown failure ids are dropped', () => {
  assert.deepEqual(C.resolveState(cfg, 'approver-happy', { failures: ['payoutDeclined', 'ghost'] }).failures, ['payoutDeclined']);
});

test('diffOverrides keeps only what differs from the journey', () => {
  const base = C.resolveState(cfg, 'quick-approve', {});
  assert.deepEqual(C.diffOverrides(cfg, 'quick-approve', base), {});
  const want = { ...base, data: 'power', flags: { quickApprove: true }, failures: ['searchEmpty'], network: { latencyMs: 1500, offline: false } };
  assert.deepEqual(C.diffOverrides(cfg, 'quick-approve', want), { data: 'power', failures: ['searchEmpty'], network: { latencyMs: 1500 } });
});

test('matching: path prefix, substring, regex, method', () => {
  const u = s => new URL(s, 'https://p.test/');
  assert.ok(C.matches({ match: '/api/requests' }, 'GET', u('/api/requests')));
  assert.ok(C.matches({ match: '/api/requests' }, 'GET', u('/api/requests/EXP-1?x=1')));
  assert.ok(!C.matches({ match: '/api/requests' }, 'GET', u('/api/requestsX')));
  assert.ok(C.matches({ match: 'stripe.com/v1' }, 'GET', u('https://api.stripe.com/v1/charges')));
  assert.ok(C.matches({ match: 're:^/api/r\\w+/\\d+$' }, 'GET', u('/api/requests/12')));
  assert.ok(!C.matches({ match: '/api/payouts', method: 'POST' }, 'GET', u('/api/payouts')));
});

test('plan: failure beats route beats network, offline breaks everything', () => {
  const s = C.resolveState(cfg, 'payout-declined', {});
  const p = C.planRequest(cfg, s, 'POST', '/api/payouts', 'https://p.test/');
  assert.equal(p.kind, 'fail'); assert.equal(p.status, 402); assert.equal(p.body.error, 'card_declined');
  assert.equal(C.planRequest(cfg, s, 'GET', '/api/requests', 'https://p.test/').kind, 'route');
  assert.equal(C.planRequest(cfg, s, 'GET', '/static/app.js', 'https://p.test/').kind, 'pass');
  const off = C.resolveState(cfg, 'approver-happy', { network: { offline: true } });
  assert.equal(C.planRequest(cfg, off, 'GET', '/api/requests', 'https://p.test/').kind, 'neterr');
});

test('plan: timeout waits, then 504', () => {
  const p = C.planRequest(cfg, C.resolveState(cfg, 'api-timeout', {}), 'GET', '/api/requests', 'https://p.test/');
  assert.equal(p.kind, 'fail'); assert.equal(p.status, 504); assert.equal(p.delay, 6000);
});

test('plan: latency applies to routes and real requests', () => {
  const s = C.resolveState(cfg, 'slow-us', {});
  assert.equal(C.planRequest(cfg, s, 'GET', '/api/requests', 'https://p.test/').delay, 1500);
  assert.equal(C.planRequest(cfg, s, 'GET', '/img.png', 'https://p.test/').delay, 1500);
});

test('routes: search and byId', () => {
  const rows = [{ id: 'A', who: 'Ana' }, { id: 'B', who: 'Rui' }];
  const u = s => new URL(s, 'https://p.test/');
  assert.deepEqual(C.routeBody({ search: 'q' }, u('/api/search?q=an'), rows).body, [rows[0]]);
  assert.deepEqual(C.routeBody({ search: 'q' }, u('/api/search'), rows).body, rows);
  assert.deepEqual(C.routeBody({ byId: true }, u('/api/requests/B'), rows), { status: 200, body: rows[1] });
  assert.equal(C.routeBody({ byId: true }, u('/api/requests/Z'), rows).status, 404);
  assert.deepEqual(C.routeBody({ respond: { ok: true }, status: 201 }, u('/x')), { status: 201, body: { ok: true } });
});

test('mock files: JSON, Markdown with a json block, plain Markdown', () => {
  assert.deepEqual(C.parseMock('[1,2]', 'json'), [1, 2]);
  const md = fs.readFileSync(path.join(__dirname, 'examples/expenses/mocks/team/requests.md'), 'utf8');
  assert.equal(C.parseMock(md, 'md').length, 8);
  assert.deepEqual(C.parseMock('# just notes', 'md'), { markdown: '# just notes' });
});

test('base64url round trip, unicode included', () => {
  const s = JSON.stringify({ name: 'Inês · €' });
  assert.equal(C.b64urlDecode(C.b64urlEncode(s)), s);
  assert.ok(!/[+/=]/.test(C.b64urlEncode(s)));
});

test('example journeys all resolve to real roles and data sets', () => {
  for (const j of cfg.journeys) {
    const s = C.resolveState(cfg, j.id, {});
    assert.ok(cfg.roles[s.role], j.id + ' role');
    assert.ok(cfg.datasets[s.data], j.id + ' data');
    (j.failures || []).forEach(f => assert.ok(cfg.failures[f], j.id + ' failure ' + f));
  }
});

test('latency and network are base parameters, choices configurable', () => {
  assert.equal(C.networkCfg({}).latencies.length, 4);
  assert.deepEqual(C.networkCfg({ network: { latencies: [0, 2000], offline: false } }), { latencies: [[0, 'Normal'], [2000, '2s']], offline: false });
  assert.ok(C.devicesCfg({}).mobile.width);
});

test('parameters are macros: an option sets several dimensions, layered right', () => {
  const cfg = {
    flags: { saved: { default: true } },
    failures: { declined: { match: '/api/pay', status: 402 } },
    parameters: { payment: { label: 'Payment method', default: 'stored', options: {
      stored: { label: 'Already stored', set: { flags: { saved: true } } },
      declined: { label: 'Card declined', set: { flags: { saved: false }, failures: ['declined'] } },
    } } },
    journeys: [{ id: 'a' }, { id: 'b', params: { payment: 'declined' } }, { id: 'c', params: { payment: 'declined' }, flags: { saved: true } }],
  };
  assert.deepEqual(C.resolveState(cfg, 'a', {}).params, { payment: 'stored' });
  const b = C.resolveState(cfg, 'b', {});
  assert.equal(b.flags.saved, false); assert.deepEqual(b.failures, ['declined']);
  // the journey's own dimensions win over its parameter presets
  assert.equal(C.resolveState(cfg, 'c', {}).flags.saved, true);
  // a reviewer's pick wins over the journey
  const o = C.diffOverrides(cfg, 'c', { params: { payment: 'stored' } });
  assert.deepEqual(o, { params: { payment: 'stored' } });
  const picked = C.resolveState(cfg, 'b', { params: { payment: 'stored' } });
  assert.deepEqual(picked.failures, []); assert.equal(picked.modified, true);
  assert.equal(C.resolveState(cfg, 'a', { params: { payment: 'nope' } }).params.payment, 'stored');
});

test('steps match their page', () => {
  assert.ok(C.pathMatches('/repos/a1', 'http://x/repos/a1/?journey=z'));
  assert.ok(!C.pathMatches('/repos/a1', 'http://x/repos/a2'));
  assert.ok(C.pathMatches('re:^/repos/[^/]+$', 'http://x/repos/zz'));
  assert.ok(C.pathMatches(undefined, 'http://x/anything'));
});

test('storyboard graph: a branch shares the screens before it and forks at its step', () => {
  const g = C.boardGraph(cfg);
  const pd = g.lanes.find(l => l.journey === 'payout-declined');
  assert.equal(pd.from, 'approver-happy');
  assert.equal(pd.at, 4);
  assert.equal(pd.row, 1, 'right under the journey it branches from');
  assert.deepEqual(g.path('payout-declined').slice(0, 4), g.path('approver-happy').slice(0, 4));
  assert.notEqual(g.path('payout-declined')[4], g.path('approver-happy')[4]);
  const fork = g.edges.filter(e => e.from === 'approver-happy#3');
  assert.deepEqual(fork.map(e => e.to).sort(), ['approver-happy#4', 'payout-declined#4']);
  const stepless = g.nodes.filter(n => n.journey === 'requester-own');
  assert.equal(stepless.length, 1);
  assert.equal(stepless[0].step, null);
});

test('storyboard graph: same steps and settings share screens without being told', () => {
  const c = { flows: { f: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }, journeys: [
    { id: 'one', steps: 'f' },
    { id: 'two', steps: [{ title: 'a' }, { title: 'b' }, { title: 'other' }] },
    { id: 'three', steps: 'f', role: 'requester' },
    { id: 'four', steps: [{ title: 'a' }, { title: 'x' }], branch: { from: 'one', step: 3 } },
  ] };
  const g = C.boardGraph(c);
  const lane = id => g.lanes.find(l => l.journey === id);
  assert.equal(lane('two').from, 'one');
  assert.equal(lane('two').at, 2);
  assert.equal(lane('three').from, null, 'another role is another screen');
  assert.equal(lane('four').at, 1, 'a branch parts at the first step that differs');
  assert.deepEqual(g.lanes.map(l => l.journey), ['one', 'two', 'four', 'three']);
});

test('version status: known ones get a label, others show as written', () => {
  assert.deepEqual(C.versionStatus({ status: 'review' }), { id: 'review', label: 'Open for review', closed: false });
  assert.equal(C.versionStatus({ status: 'closed' }).closed, true);
  assert.equal(C.versionStatus({ status: 'qa', statusLabel: 'In QA' }).label, 'In QA');
  assert.equal(C.versionStatus({ status: 'qa' }).label, 'qa');
  assert.equal(C.versionStatus({}), null);
});

test('bin/comment.js: agents leave comments and replies in comments.json', () => {
  const { execFileSync } = require('child_process');
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-comment-'));
  const run = (...a) => execFileSync(process.execPath, [path.join(__dirname, 'bin', 'comment.js'), dir, ...a], { encoding: 'utf8' }).trim();
  const id = run('--text', 'Raise the contrast', '--selector', '#total', '--quote', '2045 €', '--link', 'WCAG|https://www.w3.org/WAI/', '--version', 'v2', '--step', '3');
  const r = run('--reply-to', id, '--author', 'Sam Rivera', '--text', 'Agreed');
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8'));
  assert.equal(d.comments.length, 1);
  const c = d.comments[0];
  assert.equal(c.id, id); assert.equal(c.agent, 'claude-code'); assert.equal(c.selector, '#total'); assert.equal(c.quote, '2045 €');
  assert.deepEqual(c.links, [{ label: 'WCAG', url: 'https://www.w3.org/WAI/' }]); assert.equal(c.version, 'v2'); assert.equal(c.step, 3);
  assert.equal(c.replies[0].id, r); assert.equal(c.replies[0].author, 'Sam Rivera');
  assert.throws(() => run('--text', 'x', '--link', 'javascript:alert(1)'));
  assert.throws(() => run('--text', 'x', '--point', '0.1,0.2'));
});
