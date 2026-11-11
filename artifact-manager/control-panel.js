/* Super Artifact Manager: control panel (the /artifact-manager skill).
 *
 * One dependency-free file. Load it in <head>, before the prototype's own
 * scripts, with a journeys config next to it:
 *
 *   <script>window.SM_PROTO_CONFIG = { ...journeys.json... }</script>
 *   <script src="control-panel.js"></script>
 *
 * A journey says who you are (role), what state the data is in (data set),
 * which feature flags are on, what fails, and how the network behaves. The
 * panel switches journeys in one click. The prototype reads the active one
 * through window.SMProto, and the panel answers or breaks its fetch/XHR calls
 * so the prototype's code does not have to know a panel exists.
 *
 * Canonical source: artifact-manager/control-panel.js in github.com/SupermodularAI
 */
(function (root) {
  'use strict';

  /* ── pure logic (also exported for node tests) ─────────────────────────── */

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  // Layers, lowest first: defaults, the journey's parameter presets, the
  // journey, then what the reviewer changed (their parameter picks, then raw
  // overrides). A parameter is a macro: each option sets several dimensions.
  function resolveState(config, journeyId, overrides) {
    config = config || {};
    const journeys = config.journeys || [];
    const journey = journeys.find(j => j.id === journeyId)
      || journeys.find(j => j.id === config.defaultJourney)
      || journeys[0]
      || { id: 'default', label: 'Default' };
    const d = config.defaults || {};
    const o = isObj(overrides) ? overrides : {};
    const defs = config.parameters || {};

    const acc = { role: null, data: null, region: null, device: 'desktop', flags: {}, failures: [], network: { latencyMs: 0, offline: false } };
    Object.entries(config.flags || {}).forEach(([k, def]) => { acc.flags[k] = !!(isObj(def) ? def.default : def); });
    const layer = src => {
      if (!isObj(src)) return;
      ['role', 'data', 'region', 'device'].forEach(k => { if (src[k] !== undefined) acc[k] = src[k]; });
      if (src.flags) Object.assign(acc.flags, src.flags);
      if (src.failures !== undefined) acc.failures = [].concat(src.failures || []);
      if (src.network) Object.assign(acc.network, src.network);
    };
    const optionOf = (k, v) => { const def = defs[k] || {}; return (def.options || {})[v]; };
    const baseParams = {};
    Object.keys(defs).forEach(k => {
      const def = defs[k] || {};
      const pick = [(journey.params || {})[k], (d.params || {})[k], def.default, Object.keys(def.options || {})[0]].find(v => v !== undefined && optionOf(k, v));
      if (pick !== undefined) baseParams[k] = pick;
    });
    const params = Object.assign({}, baseParams);
    Object.entries(o.params || {}).forEach(([k, v]) => { if (optionOf(k, v)) params[k] = v; });

    layer(d);
    // A parameter the reviewer changed drops the journey's preset for it entirely.
    Object.keys(baseParams).forEach(k => { if (params[k] !== baseParams[k]) return; const opt = optionOf(k, baseParams[k]); layer(opt && opt.set); });
    layer(journey);
    Object.keys(params).forEach(k => { if (params[k] !== baseParams[k]) { const opt = optionOf(k, params[k]); layer(opt && opt.set); } });
    layer(o);

    const roleDef = (config.roles || {})[acc.role] || {};
    const user = Object.assign({ name: roleDef.label || acc.role || 'Guest' }, roleDef.user || {});

    return {
      journey: journey.id,
      label: journey.label || journey.id,
      role: acc.role || null,
      user,
      data: acc.data || null,
      region: acc.region || null,
      device: acc.device || 'desktop',
      params,
      flags: acc.flags,
      failures: acc.failures.filter(id => (config.failures || {})[id]),
      network: acc.network,
      modified: Object.keys(o).some(k => k !== 'device'), // the device is a view, not a parameter
    };
  }

  // Latency, network and device are base parameters: every prototype has
  // them. "network": { "latencies": [0, 2000] } changes the choices.
  function networkCfg(config) {
    config = config || {};
    const n = isObj(config.network) ? config.network : {};
    const ms = Array.isArray(n.latencies) ? n.latencies : [0, 400, 1500, 4000];
    const name = v => (v === 0 ? 'Normal' : v < 1000 ? v + 'ms' : (v / 1000) + 's');
    return { latencies: ms.map(v => [+v, name(+v)]), offline: n.offline !== false };
  }
  // Device presets (a journey or the reviewer picks one). Desktop is the
  // window itself; the rest frame the prototype at that size. Custom takes
  // the reviewer's own width and height.
  const DEVICES = {
    desktop: { label: 'Responsive' },
    laptop: { label: 'Laptop', width: 1440, height: 900 },
    'desktop-hd': { label: 'Desktop HD', width: 1920, height: 1080 },
    tablet: { label: 'Tablet', width: 834, height: 1112 },
    'tablet-landscape': { label: 'Tablet landscape', width: 1112, height: 834 },
    mobile: { label: 'Mobile', width: 390, height: 844 },
    'mobile-large': { label: 'Mobile large', width: 430, height: 932 },
    'mobile-small': { label: 'Mobile small', width: 375, height: 667 },
    android: { label: 'Android', width: 412, height: 915 },
    custom: { label: 'Custom' },
  };
  function devicesCfg(config) { return Object.assign({}, DEVICES, (config && config.devices) || {}); }

  // Overrides keep only what differs from the journey, so "modified" is honest.
  function diffOverrides(config, journeyId, wanted) {
    const base = resolveState(config, journeyId, {});
    const out = {};
    ['role', 'data', 'region', 'device'].forEach(k => { if (wanted[k] !== undefined && wanted[k] !== base[k]) out[k] = wanted[k]; });
    if (wanted.params) {
      const p = {};
      Object.keys(wanted.params).forEach(k => { if (wanted.params[k] !== base.params[k]) p[k] = wanted.params[k]; });
      if (Object.keys(p).length) out.params = p;
    }
    if (wanted.flags) {
      const f = {};
      Object.keys(wanted.flags).forEach(k => { if (!!wanted.flags[k] !== !!base.flags[k]) f[k] = !!wanted.flags[k]; });
      if (Object.keys(f).length) out.flags = f;
    }
    if (wanted.failures) {
      const a = [...wanted.failures].sort().join(','), b = [...base.failures].sort().join(',');
      if (a !== b) out.failures = [...wanted.failures];
    }
    if (wanted.network) {
      const n = {};
      ['latencyMs', 'offline'].forEach(k => { if (wanted.network[k] !== undefined && wanted.network[k] !== base.network[k]) n[k] = wanted.network[k]; });
      if (Object.keys(n).length) out.network = n;
    }
    return out;
  }

  // A journey step happens on a page: "/repos/a1", or "re:^/repos/[^/]+$".
  function pathMatches(pattern, href, base) {
    if (!pattern) return true;
    const u = new URL(href, base || 'http://x/');
    const here = u.pathname.replace(/\/$/, '') || '/';
    // nosemgrep: detect-non-literal-regexp -- 're:' patterns come from the prototype's own journeys.json
    if (pattern.startsWith('re:')) { try { return new RegExp(pattern.slice(3)).test(u.pathname); } catch (e) { return false; } }
    const want = new URL(pattern, u.origin).pathname.replace(/\/$/, '') || '/';
    return want === here;
  }

  function matches(rule, method, url) {
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) return false;
    const m = rule.match;
    if (!m) return false;
    // "/api/x" = that path and anything under it; "re:^/api/x/\\d+$" = a regex
    // on path + query; anything else = a substring of the full URL.
    if (m instanceof RegExp) return m.test(url.pathname + url.search);
    if (typeof m !== 'string') return false;
    // nosemgrep: detect-non-literal-regexp -- 're:' patterns come from the prototype's own journeys.json
    if (m.startsWith('re:')) { try { return new RegExp(m.slice(3)).test(url.pathname + url.search); } catch (e) { return false; } }
    if (m[0] === '/') { const p = m.replace(/\/$/, ''); return url.pathname === p || url.pathname.startsWith(p + '/'); }
    return url.href.includes(m);
  }

  // What should happen to a request under the active state. Failures beat
  // routes, routes beat the real network.
  function planRequest(config, state, method, href, base) {
    let url;
    try { url = new URL(href, base || 'http://localhost/'); } catch (e) { return { kind: 'pass', delay: 0 }; }
    const latency = Math.max(0, +state.network.latencyMs || 0);
    for (const id of state.failures) {
      const f = (config.failures || {})[id];
      if (f && matches(f, method, url)) {
        if (f.timeout) return { kind: 'fail', id, delay: f.timeoutMs != null ? f.timeoutMs : 8000, status: f.status || 504, body: f.body !== undefined ? f.body : { error: 'Gateway Timeout' } };
        if (f.status === 0 || f.networkError) return { kind: 'neterr', id, delay: f.delayMs != null ? f.delayMs : latency };
        return { kind: 'fail', id, delay: f.delayMs != null ? f.delayMs : latency, status: f.status || 500, body: f.body !== undefined ? f.body : { error: f.label || id } };
      }
    }
    if (state.network.offline) return { kind: 'neterr', id: 'offline', delay: 0 };
    for (const r of config.routes || []) {
      if (matches(r, method, url)) return { kind: 'route', route: r, url, delay: latency };
    }
    return { kind: 'pass', delay: latency };
  }

  function textSearch(rows, q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return rows;
    const hit = v => v != null && (typeof v === 'object' ? Object.values(v).some(hit) : String(v).toLowerCase().includes(q));
    return rows.filter(hit);
  }

  // A route answers from the active data set. `data` names the file, `search`
  // filters by a query parameter, `byId` returns one record from the last
  // path segment, `respond` is a fixed body.
  function routeBody(route, url, payload) {
    if (route.respond !== undefined) return { status: route.status || 200, body: route.respond };
    let body = payload;
    if (Array.isArray(body) && route.byId) {
      const id = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
      const row = body.find(r => r && String(r[route.byId === true ? 'id' : route.byId]) === id);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'Not found' } };
    }
    if (Array.isArray(body) && route.search) body = textSearch(body, url.searchParams.get(route.search));
    return { status: route.status || 200, body: body === undefined ? null : body };
  }

  // Mock files may be JSON, or Markdown carrying the data in a ```json block
  // (so a mock reads like a document and still loads as data).
  function parseMock(text, ext) {
    if (ext === 'json') return JSON.parse(text);
    const m = /```json\s*\n([\s\S]*?)\n```/.exec(text);
    if (m) return JSON.parse(m[1]);
    return { markdown: text };
  }

  function b64urlEncode(s) {
    const b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8');
  }

  /* Storyboard, all journeys: one lane per journey, steps as columns. Screens
     are shared while journeys are the same so far, and fork where they part.
     The same so far means the same steps and the same role, data, region,
     flags, failures and network, or a journey that says so:
       "branch": { "from": "approver-happy", "step": 5 }   parts at step 5
     (its steps before 5 must match, else it parts at the first that doesn't). */
  function boardGraph(config) {
    config = config || {};
    const js = config.journeys || [];
    const byId = new Map(js.map(j => [j.id, j]));
    const stepsOf = j => { const v = j && j.steps; return (typeof v === 'string' ? (config.flows || {})[v] : v) || []; };
    const sig = j => { const st = resolveState(config, j.id, {}); return JSON.stringify([st.role, st.data, st.region, st.params, st.flags, st.failures, st.network]); };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const prefix = (a, b, max) => { let i = 0; while (i < Math.min(a.length, b.length, max) && same(a[i], b[i])) i++; return i; };
    const info = new Map(); // id -> { parent, shared, keys }
    const busy = new Set();
    function visit(j) {
      if (info.has(j.id)) return info.get(j.id);
      busy.add(j.id);
      const ss = stepsOf(j);
      let parent = null, shared = 0;
      const b = j.branch && byId.get(j.branch.from);
      if (b && b !== j && !busy.has(b.id)) {
        visit(b);
        shared = prefix(ss, stepsOf(b), Math.max(0, (+j.branch.step || 1) - 1));
        if (shared) parent = b;
      } else if (ss.length) {
        const me = sig(j);
        js.slice(0, js.indexOf(j)).forEach(q => {
          if (busy.has(q.id)) return;
          const L = prefix(ss, stepsOf(q), Infinity);
          if (L > shared && sig(q) === me) { shared = L; parent = q; }
        });
        if (parent) visit(parent);
      }
      const keys = [];
      const n = Math.max(1, ss.length);
      for (let i = 0; i < n; i++) keys.push(parent && i < shared ? info.get(parent.id).keys[i] : j.id + '#' + i);
      const out = { parent: parent && parent.id, shared, keys, steps: ss };
      busy.delete(j.id); info.set(j.id, out);
      return out;
    }
    js.forEach(visit);
    // Rows: each journey under the one it branches from, in config order.
    const kids = new Map();
    js.forEach(j => { const p = info.get(j.id).parent; if (p) kids.set(p, (kids.get(p) || []).concat(j.id)); });
    const order = [];
    const walk = id => { order.push(id); (kids.get(id) || []).forEach(walk); };
    js.filter(j => !info.get(j.id).parent).forEach(j => walk(j.id));
    const nodes = [], lanes = [], edges = [], seen = new Set();
    let row = 0;
    order.forEach(id => {
      const j = byId.get(id), f = info.get(id), own = f.keys.length - f.shared;
      const lane = { journey: id, label: j.label || id, category: j.category || null, from: f.parent, at: f.shared, row: own > 0 ? row : null, steps: f.steps.length };
      lanes.push(lane);
      if (own <= 0) return;
      for (let i = f.shared; i < f.keys.length; i++) {
        const s = f.steps[i];
        nodes.push({ key: f.keys[i], journey: id, col: i, row, step: s ? i : null, title: s ? s.title || '' : j.label || id });
      }
      row++;
    });
    js.forEach(j => { const k = info.get(j.id).keys; for (let i = 1; i < k.length; i++) { const e = k[i - 1] + '>' + k[i]; if (!seen.has(e)) { seen.add(e); edges.push({ from: k[i - 1], to: k[i], journeys: [j.id] }); } else edges.find(x => x.from + '>' + x.to === e).journeys.push(j.id); } });
    return { nodes, edges, lanes, rows: row, cols: nodes.reduce((m, n) => Math.max(m, n.col + 1), 0), path: id => (info.get(id) || { keys: [] }).keys };
  }

  // A version's review status: "status": "review" in iterations[]. Anything
  // else shows as written; "statusLabel" renames one.
  const VERSION_STATUS = { draft: 'Draft', review: 'Open for review', changes: 'Changes requested', approved: 'Approved', closed: 'Closed' };
  function versionStatus(it) {
    if (!it || !it.status) return null;
    const id = String(it.status);
    return { id, label: it.statusLabel || VERSION_STATUS[id] || id, closed: id === 'closed' };
  }

  const core = { boardGraph, versionStatus, resolveState, diffOverrides, networkCfg, devicesCfg, pathMatches, planRequest, routeBody, parseMock, textSearch, matches, b64urlEncode, b64urlDecode };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof window === 'undefined' || root !== window) return;
  if (window.SMProto) return; // loaded twice

  /* ── browser runtime ───────────────────────────────────────────────────── */

  const cfgEl = document.getElementById('sm-proto-config');
  let config = window.SM_PROTO_CONFIG;
  if (!config && cfgEl) { try { config = JSON.parse(cfgEl.textContent); } catch (e) { console.warn('[artifact-manager] bad #sm-proto-config JSON', e); } }
  // <script src="control-panel.js" data-config="journeys.json">: a blocking
  // load on purpose, so SMProto is ready before any prototype script runs.
  const me = document.currentScript;
  if (!config && me && me.dataset.config) {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', new URL(me.dataset.config, location.href).href, false);
      x.send();
      if (x.status >= 200 && x.status < 300) config = JSON.parse(x.responseText);
      else console.warn('[artifact-manager] ' + me.dataset.config + ' answered ' + x.status);
    } catch (e) { console.warn('[artifact-manager] could not load', me.dataset.config, e); }
  }
  if (!config) { console.warn('[artifact-manager] no SM_PROTO_CONFIG, control panel off'); return; }
  config.journeys = config.journeys || [];

  const KEY = 'sm-proto:' + (config.id || location.pathname);
  const store = {
    get(k, s) { try { return JSON.parse((s || localStorage).getItem(KEY + ':' + k)); } catch (e) { return null; } },
    set(k, v, s) { try { (s || localStorage).setItem(KEY + ':' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  const params = new URLSearchParams(location.search);
  let journeyId = params.get('journey') || store.get('journey') || config.defaultJourney || (config.journeys && config.journeys[0] && config.journeys[0].id);
  let overrides = store.get('overrides') || {};
  if (params.has('journey')) overrides = {};
  if (params.has('pm')) { try { overrides = JSON.parse(b64urlDecode(params.get('pm'))); } catch (e) { overrides = {}; } }
  if (!(config.journeys || []).some(j => j.id === journeyId)) { journeyId = config.defaultJourney || (config.journeys[0] && config.journeys[0].id) || 'default'; overrides = {}; }
  store.set('journey', journeyId);
  store.set('overrides', overrides);
  // A status changed from the drawer sticks on this browser ("statusEditable": false turns that off).
  if (config.statusEditable !== false) (config.iterations || []).forEach(it => { const s = store.get('status:' + it.id); if (s) it.status = s; });

  let state = resolveState(config, journeyId, overrides);
  const CUSTOM = { w: 1280, h: 800 };
  function deviceSize(id) {
    id = id || state.device;
    if (id === 'custom') { const c = store.get('custom') || {}; return { label: 'Custom', width: +c.w || CUSTOM.w, height: +c.h || CUSTOM.h }; }
    return devicesCfg(config)[id] || {};
  }
  const listeners = new Set();

  // Server code (Next.js route handlers, server components) reads the same
  // state from a cookie: JSON.parse(base64url-decode(cookies.get('sm-proto'))).
  function cookieValue() {
    const s = { journey: state.journey, role: state.role, data: state.data, region: state.region, device: state.device, params: state.params, flags: state.flags, failures: state.failures, network: state.network };
    return b64urlEncode(JSON.stringify(s));
  }
  function writeCookie() { document.cookie = 'sm-proto=' + cookieValue() + '; path=/; SameSite=Lax'; }
  const sentCookie = (document.cookie.match(/(?:^|;\s*)sm-proto=([^;]*)/) || [])[1] || '';
  writeCookie();
  // Server-rendered prototypes ("serverRendered": true) built this page from
  // the cookie the browser sent. If that was a different journey (a pasted
  // link, a first visit), load once more so server and panel agree.
  if (config.serverRendered && sentCookie !== cookieValue()) {
    const guard = KEY + ':synced';
    let tries = 0;
    try { tries = +sessionStorage.getItem(guard) || 0; } catch (e) { /* ignore */ }
    if (tries < 2) {
      try { sessionStorage.setItem(guard, String(tries + 1)); } catch (e) { /* ignore */ }
      location.reload();
      return;
    }
  }
  try { sessionStorage.removeItem(KEY + ':synced'); } catch (e) { /* ignore */ }
  document.documentElement.setAttribute('data-sm-journey', state.journey);
  if (state.role) document.documentElement.setAttribute('data-sm-role', state.role);

  /* data sets */
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const cache = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function dataset(id) { return (config.datasets || {})[id || state.data] || null; }
  async function loadData(name, setId) {
    const ds = dataset(setId);
    if (!ds) throw new Error('[artifact-manager] no data set "' + (setId || state.data) + '"');
    const key = (setId || state.data) + '/' + name;
    if (cache.has(key)) return structuredClone(cache.get(key));
    let value;
    if (ds.files && name in ds.files) value = ds.files[name];
    else if (ds.path) {
      const base = ds.path.replace(/\/$/, '') + '/' + name;
      for (const ext of ds.format ? [ds.format] : ['json', 'md']) {
        const res = await nativeFetch(base + '.' + ext).catch(() => null);
        if (res && res.ok) { value = parseMock(await res.text(), ext); break; }
      }
      if (value === undefined) throw new Error('[artifact-manager] no mock "' + name + '" in ' + ds.path);
    } else throw new Error('[artifact-manager] data set has no file "' + name + '"');
    cache.set(key, value);
    return structuredClone(value);
  }

  function materialize(plan) {
    return Promise.resolve(plan.kind === 'route' && plan.route.data && plan.route.respond === undefined
      ? loadData(plan.route.data).then(p => routeBody(plan.route, plan.url, p))
      : plan.kind === 'route' ? routeBody(plan.route, plan.url) : { status: plan.status, body: plan.body });
  }
  function bodyText(b) { return typeof b === 'string' ? b : JSON.stringify(b); }
  function contentType(b) { return typeof b === 'string' ? 'text/plain' : 'application/json'; }

  /* fetch */
  if (nativeFetch) {
    window.fetch = async function (input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      const plan = planRequest(config, state, method, href, location.href);
      if (plan.delay) await sleep(plan.delay);
      if (plan.kind === 'pass') return nativeFetch(input, init);
      if (plan.kind === 'neterr') throw new TypeError('Failed to fetch (artifact-manager: ' + plan.id + ')');
      const r = await materialize(plan);
      return new Response(r.status === 204 ? null : bodyText(r.body), { status: r.status, headers: { 'content-type': contentType(r.body), 'x-sm-proto': plan.kind + (plan.id ? ':' + plan.id : '') } });
    };
  }

  /* XHR (axios and older code) */
  if (window.XMLHttpRequest) {
    const XP = XMLHttpRequest.prototype, open = XP.open, send = XP.send;
    XP.open = function (method, url) { this.__smp = { method: method || 'GET', url: String(url) }; return open.apply(this, arguments); };
    XP.send = function (body) {
      const xhr = this, info = xhr.__smp;
      if (!info) return send.call(xhr, body);
      const plan = planRequest(config, state, info.method, info.url, location.href);
      if (plan.kind === 'pass') { if (plan.delay) setTimeout(() => send.call(xhr, body), plan.delay); else send.call(xhr, body); return; }
      const fire = t => { const ev = new Event(t); if (typeof xhr['on' + t] === 'function') xhr['on' + t](ev); xhr.dispatchEvent(ev); };
      const def = (k, v) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
      setTimeout(async () => {
        if (plan.kind === 'neterr') { def('readyState', 4); def('status', 0); fire('readystatechange'); fire('error'); fire('loadend'); return; }
        const r = await materialize(plan);
        const text = bodyText(r.body);
        def('readyState', 4); def('status', r.status); def('statusText', String(r.status)); def('responseURL', info.url);
        def('responseText', text);
        def('response', xhr.responseType === 'json' ? r.body : text);
        xhr.getAllResponseHeaders = () => 'content-type: ' + contentType(r.body) + '\r\n';
        xhr.getResponseHeader = n => (/content-type/i.test(n) ? contentType(r.body) : null);
        fire('readystatechange'); fire('load'); fire('loadend');
      }, plan.delay);
    };
  }

  /* switching */
  function go(nextJourney, nextOverrides) {
    if (nextJourney !== journeyId) store.set('run', null, sessionStorage); // a new journey starts at step 1
    store.set('journey', nextJourney);
    store.set('overrides', nextOverrides || {});
    const prev = state;
    journeyId = nextJourney; overrides = nextOverrides || {};
    state = resolveState(config, journeyId, overrides);
    if (config.reload === false) {
      cache.clear(); writeCookie();
      document.documentElement.setAttribute('data-sm-journey', state.journey);
      listeners.forEach(fn => { try { fn(state, prev); } catch (e) { console.error(e); } });
      if (ui) ui.render();
      return;
    }
    writeCookie(); // the next page load (and its server render) sees the new journey
    location.href = shareUrl(location.href);
  }
  function shareUrl(href, keepState) {
    const u = new URL(href || location.href, location.href);
    u.searchParams.set('journey', journeyId);
    u.searchParams.delete('pmframe'); u.searchParams.delete('pmstep');
    if (Object.keys(overrides).length) u.searchParams.set('pm', b64urlEncode(JSON.stringify(overrides)));
    else u.searchParams.delete('pm');
    return u.href;
  }

  // pmframe=<pane>: this page is a pane of compare / device view (1 = left or only, 2 = right).
  const inFrame = !!params.get('pmframe') && window.parent !== window;
  // pmpage=<n>: a storyboard screen of a document or deck shows that page alone.
  const SOLO = inFrame && KIND_OF(config) !== 'prototype' ? +params.get('pmpage') || 0 : 0;
  function KIND_OF(c) { return ['document', 'presentation'].includes(c.type) ? c.type : 'prototype'; }
  function pageSetup() {
    const css = SOLO
      ? 'html,body{margin:0!important;padding:0!important;overflow:hidden!important;scroll-snap-type:none!important}.smp-solo{margin:0!important;width:100%!important;max-width:none!important;min-height:100vh!important;box-sizing:border-box}'
      // Pages sit on the same dark dotted canvas as the storyboard ("canvas": false keeps the page's own).
      : 'html.smp-canvas{background-color:#1e1e1e;background-image:radial-gradient(#2e2e2e 1px,transparent 1px);background-size:22px 22px}html.smp-canvas body{background:transparent!important}';
    const st = document.createElement('style'); st.setAttribute('data-sm-proto', ''); st.textContent = css; document.head.append(st);
    if (SOLO) {
      const ps = [...document.querySelectorAll(PAGE_SEL_OF(config))];
      ps.forEach((p, i) => { if (i === SOLO - 1) p.classList.add('smp-solo'); else p.style.display = 'none'; });
    } else {
      // A page without its own background keeps the one it had from the body.
      const bg = getComputedStyle(document.body).backgroundColor;
      document.querySelectorAll(PAGE_SEL_OF(config)).forEach(p => { if (/rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(p).backgroundColor)) p.style.backgroundColor = bg; });
      document.documentElement.classList.add('smp-canvas');
    }
  }
  // Slides stacked in one grid cell, one shown at a time, sliding sideways.
  function deckSetup() {
    const ps = [...document.querySelectorAll(PAGE_SEL_OF(config))];
    const host = ps[0] && ps[0].parentElement;
    if (!host || ps.some(p => p.parentElement !== host)) return;   // slides in different places: keep scrolling
    host.classList.add('smp-deck-host');
    ps.forEach(p => p.classList.add('smp-slide'));
    const st = document.createElement('style'); st.setAttribute('data-sm-proto', '');
    st.textContent = 'html.smp-deck,html.smp-deck body{height:100%;overflow:hidden!important;scroll-snap-type:none!important}' +
      '.smp-deck-host{display:grid!important;grid-template:minmax(0,1fr)/minmax(0,1fr);place-items:center;height:100vh;margin:0;overflow:hidden}' +
      '.smp-slide{grid-area:1/1;transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .35s ease,visibility 0s .5s}' +
      '.smp-slide.smp-before{transform:translateX(-6%);opacity:0;visibility:hidden;pointer-events:none}' +
      '.smp-slide.smp-after{transform:translateX(6%);opacity:0;visibility:hidden;pointer-events:none}' +
      '.smp-slide.smp-on{transform:none;opacity:1;visibility:visible;transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .35s ease,visibility 0s}' +
      '@media (prefers-reduced-motion:reduce){.smp-slide{transition:none!important}}';
    document.head.append(st);
    document.documentElement.classList.add('smp-deck');
    pager.deck = true;
    pager.show(pager.index, 1);
  }
  function PAGE_SEL_OF(c) { const p = c.pages && typeof c.pages === 'object' ? c.pages : {}; return p.selector || (KIND_OF(c) === 'presentation' ? '.slide, [data-slide]' : '.page, [data-page]'); }
  if (KIND_OF(config) !== 'prototype') {
    const go = () => {
      if (SOLO || (config.canvas !== false && document.querySelector(PAGE_SEL_OF(config)))) pageSetup();
      if (!SOLO && KIND_OF(config) === 'presentation' && config.deck !== false) deckSetup();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
  const currentJourney = () => config.journeys.find(j => j.id === state.journey) || {};
  // A journey's steps, or the name of a shared flow ("steps": "approve").
  const stepsOf = j => { const v = j && j.steps; return (typeof v === 'string' ? (config.flows || {})[v] : v) || []; };
  const steps = () => stepsOf(currentJourney());

  /* What kind of artifact this is: "type": "prototype" (default), "document" or
     "presentation". Documents and decks have pages or slides instead of
     journeys: the bar pages through them, comments say which section or slide. */
  const KIND = ['document', 'presentation'].includes(config.type) ? config.type : 'prototype';
  const pagesCfg = isObj(config.pages) ? config.pages : {};
  const PAGE_SEL = pagesCfg.selector || (KIND === 'presentation' ? '.slide, [data-slide]' : '.page, [data-page]');
  const HEAD_SEL = 'h1, h2, h3, h4';
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
  const pager = {
    index: 1,
    fns: new Set(),
    // Paginated (pages or slides you can see apart) or one continuous document,
    // paged by its headings: "Section n of N", no storyboard.
    paged() { return KIND === 'presentation' || (KIND === 'document' && !!document.querySelector(PAGE_SEL)); },
    word() { return KIND === 'presentation' ? 'Slide' : this.paged() ? 'Page' : 'Section'; },
    list() {
      if (KIND === 'prototype') return [];
      let ps = [...document.querySelectorAll(PAGE_SEL)];
      if (!ps.length) ps = [...document.querySelectorAll(KIND === 'presentation' ? 'body > section, main > section' : 'h1, h2')];
      return ps;
    },
    // A deck shows one slide at a time, like a presentation ("deck": false scrolls instead).
    deck: false,
    show(i, dir) {
      const ps = this.list();
      ps.forEach((p, k) => {
        p.classList.toggle('smp-on', k === i - 1);
        p.classList.toggle('smp-before', k < i - 1);
        p.classList.toggle('smp-after', k > i - 1);
        p.setAttribute('aria-hidden', String(k !== i - 1));
      });
      document.documentElement.dataset.smpDir = dir > 0 ? 'next' : 'prev';
      // Pins follow the slide on screen once it has moved in.
      clearTimeout(this.rt); this.rt = setTimeout(() => window.dispatchEvent(new Event('resize')), 560);
    },
    go(i) {
      const ps = this.list();
      if (!ps.length || SOLO) return;
      if (this.deck) {
        const k = Math.max(1, Math.min(ps.length, i));
        if (k !== this.index) { this.show(k, k - this.index); this.index = k; this.fns.forEach(f => f()); }
        return;
      }
      this.index = Math.max(1, Math.min(ps.length, i));
      // While the smooth scroll runs, the page passing by isn't where we're going.
      this.hold = Date.now() + 900;
      clearTimeout(this.t); this.t = setTimeout(() => { this.hold = 0; }, 900);
      ps[this.index - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.fns.forEach(f => f());
    },
    // The page on screen: the last one whose top has passed the upper third.
    track() {
      const ps = this.list();
      if (!ps.length || this.deck || Date.now() < (this.hold || 0)) return;
      const line = window.innerHeight * 0.35;
      let k = 1;
      ps.forEach((p, i) => { if (p.getBoundingClientRect().top <= line) k = i + 1; });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) k = ps.length;
      if (k !== this.index) { this.index = k; this.fns.forEach(f => f()); }
    },
  };
  if (KIND !== 'prototype') {
    let tick = 0;
    window.addEventListener('scroll', () => { if (!tick) tick = requestAnimationFrame(() => { tick = 0; pager.track(); }); }, { passive: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => pager.track()); else setTimeout(() => pager.track());
  }
  // A heading as an outline label: "1.5 Lorem ipsum". Headings that already
  // carry a number keep it; otherwise h2 and h3 are numbered in order.
  function headingLabel(h) {
    const t = clean(h.textContent);
    if (h.tagName === 'H1' || /^\d+(\.\d+)*\.?\s/.test(t)) return t;
    let a = 0, b = 0;
    for (const x of document.querySelectorAll('h2, h3')) {
      if (x.tagName === 'H2') { a++; b = 0; } else b++;
      if (x === h) return (x.tagName === 'H2' ? a : a + '.' + b) + ' ' + t;
    }
    return t;
  }
  // Where in the artifact an element is, saved with a comment left on it.
  function contextFor(el) {
    const it = currentIteration();
    const out = { version: it ? it.id : '' };
    if (KIND === 'document') {
      let h = el.closest && el.closest(HEAD_SEL);
      if (!h) for (const x of document.querySelectorAll(HEAD_SEL)) { if (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) h = x; else break; }
      if (h) out.section = headingLabel(h).slice(0, 200);
      if (pager.paged()) { const ps = pager.list(); const pg = ps.find(p => p === el || p.contains(el)); if (pg) out.pageNo = ps.indexOf(pg) + 1; }
    } else if (KIND === 'presentation') {
      const ps = pager.list();
      const sl = ps.find(p => p === el || p.contains(el));
      if (sl) { out.slide = ps.indexOf(sl) + 1; const t = sl.querySelector(HEAD_SEL); out.slideTitle = t ? clean(t.textContent).slice(0, 200) : ''; }
    }
    return out;
  }

  const api = {
    get state() { return structuredClone(state); },
    get config() { return config; },
    get journey() { return state.journey; },
    get role() { return state.role; },
    get user() { return { ...state.user }; },
    get region() { return state.region; },
    get device() { return state.device; },
    get dataSet() { return state.data; },
    // The journey step on screen, while a run is active: { index (1-based), title }.
    get step() { return runner && runner.active ? runner.current() : null; },
    // Where a comment is being left, saved with it: version, journey, step.
    get context() {
      const it = currentIteration(), j = currentJourney(), s = this.step;
      return { version: it ? it.id : '', journey: state.journey || '', journeyTitle: j.label || j.id || '', ...(s ? { step: s.index, stepTitle: s.title } : {}) };
    },
    get kind() { return KIND; },
    pager,
    contextFor: KIND === 'prototype' ? undefined : contextFor,
    // Bring the page or slide holding an element on screen (a deck switches slides).
    reveal(el) { if (!pager.deck || !el) return false; const ps = pager.list(); const k = ps.findIndex(p => p === el || p.contains(el)); if (k < 0) return false; pager.go(k + 1); return true; },
    param: name => state.params[name],
    flag: name => !!state.flags[name],
    data: loadData,
    is: (role) => state.role === role,
    on(ev, fn) { if (ev === 'change') listeners.add(fn); return () => listeners.delete(fn); },
    setJourney: id => go(id, {}),
    override: patch => go(journeyId, diffOverrides(config, journeyId, { ...resolveState(config, journeyId, overrides), ...patch })),
    reset: () => go(journeyId, {}),
    link: () => shareUrl(location.href),
    open: () => ui && ui.toggle(true),
    close: () => ui && ui.toggle(false),
    play: () => runner && runner.play(),
    pause: () => runner && runner.pause(),
    next: () => runner && runner.next(),
    prev: () => runner && runner.prev(),
    restart: () => runner && runner.restart(),
  };
  window.SMProto = api;

  /* ── shared DOM helpers ─────────────────────────────────────────────── */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'style' && isObj(v)) Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    // Our fields aren't logins or forms: keep autofill and password-manager pop-ups off them.
    if ((tag === 'input' && el.type !== 'checkbox') || tag === 'textarea') {
      if (!el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
      el.setAttribute('data-1p-ignore', ''); el.setAttribute('data-lpignore', 'true'); el.setAttribute('data-bwignore', ''); el.setAttribute('data-form-type', 'other');
    }
    kids.flat().forEach(k => { if (k != null && k !== false) el.append(k.nodeType ? k : String(k)); });
    return el;
  }
  const lbl = (map, id) => (map && map[id] && (map[id].label || map[id])) || id;
  const fmtDate = d => {
    if (!d) return '';
    const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00' : d);
    return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const ago = iso => {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
  };

  /* ── the overlay layer: cursor + highlight ring (also inside compare frames) ── */

  let layer = null;
  // "Show cursor highlight" off: the journey still runs, without the cursor and ring.
  const hlOn = () => store.get('hl') !== false;
  function applyHl() { if (layer) layer.host.classList.toggle('nohl', !hlOn()); }
  function overlay() {
    if (layer) return layer;
    const host = h('div', { id: 'sm-proto-panel', 'data-sm-proto': '' });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(h('style', null, CSS));
    const root = h('div', { class: 'root' });
    const cursor = h('div', { class: 'cursor', html: ICON_CURSOR });
    const ring = h('div', { class: 'ring' }, h('span', { class: 'ring-l' }));
    const note = h('div', { class: 'note' });
    shadow.append(root, ring, cursor, note);
    document.body.append(host);
    // Native modal dialogs live in the browser's top layer, above any
    // z-index. As a manual popover this layer joins the top layer too, and
    // re-raises itself whenever a dialog opens, so the cursor stays visible.
    if (host.showPopover) {
      host.setAttribute('popover', 'manual');
      Object.assign(host.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible', pointerEvents: 'none' });
      const raise = () => { try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); } catch (e) { /* ignore */ } };
      raise();
      new MutationObserver(muts => { if (muts.some(m => m.target.tagName === 'DIALOG' && m.target.open)) raise(); })
        .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    layer = { host, shadow, root, cursor, ring, note };
    applyHl();
    return layer;
  }

  /* ── the journey runner: steps, cursor, highlight, play ─────────────── */
  // A step: { "title": "Archive every error", "path": "/repos/a1",
  //           "target": "text:Archive all" | "<css selector>",
  //           "action": "click" | "type" | "select" | "press" | "hover" | "look",
  //           "text": "…" (type), "value": "…" (select), "key": "Enter" (press), "ms": 1500 }
  // Play walks the steps with a simulated cursor that really clicks and types
  // in the prototype. The arrows jump one step: forward does the current step,
  // back replays the journey from the start up to the step before, so the
  // screen is always in the state that step expects.

  const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
  let runner = null;

  function makeRunner() {
    // A pane on the same origin as the page around it shares its sessionStorage,
    // so each pane keeps its own run state. Panes never resume playing on their
    // own: in compare view the top window's Play drives them, step by step.
    const RK = inFrame ? 'run:pane' + params.get('pmframe') : 'run';
    const speedPref = () => { const v = +store.get('speed'); return SPEEDS.includes(v) ? v : 1; };
    let run = store.get(RK, sessionStorage);
    if (!run || run.journey !== state.journey) run = { journey: state.journey, idx: 0, active: false, playing: false, done: false, seek: null, lost: false };
    if (inFrame) run.playing = false;
    // Storyboard panes (pmseek=2): replay quickly from the start up to that step.
    if (inFrame && params.has('pmseek')) {
      const k = Math.max(0, +params.get('pmseek') || 0);
      run = { ...run, idx: 0, active: true, seek: k || null, playing: false, done: false, lost: false };
      try { const u = new URL(location.href); u.searchParams.delete('pmseek'); history.replaceState(history.state, '', u.href); } catch (e) { /* ignore */ }
    }
    // A link that names a step (pmstep=3) opens on that step.
    if (params.has('pmstep')) {
      const k = Math.max(0, (+params.get('pmstep') || 1) - 1);
      run = { ...run, idx: k, active: true, seek: null, playing: false, done: false };
      try { const u = new URL(location.href); u.searchParams.delete('pmstep'); history.replaceState(history.state, '', u.href); } catch (e) { /* ignore */ }
    }
    let speed = speedPref(), busy = false, timer = null, token = 0;
    const subs = new Set();
    const save = () => store.set(RK, run, sessionStorage);
    const emit = () => { save(); subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); };
    const n = () => steps().length;
    const wait = ms => new Promise(r => { timer = setTimeout(r, ms); });

    function visible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    }
    // Skip /annotate's own pins, cards and popups (not its classes on <body>).
    const notOurs = el => !el.closest('[data-sm-proto],.annot-fab-row,.annot-icon-fab,.annot-actions-panel,.annot-popup,.annot-badge,.annot-card,.annot-card-menu,.annot-confirm-pop,.annot-toast,.annot-collapser,.annot-modal-overlay,.annot-tooltip,.annot-stack-list');
    function find(t) {
      if (!t) return null;
      if (t.startsWith('text:')) {
        const want = t.slice(5).trim().toLowerCase();
        // An open dialog is where the next click goes: look there first.
        const dlg = [...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]')].filter(visible).pop();
        const scope = dlg && [...dlg.querySelectorAll('button,a,[role=button]')].some(e => (e.textContent || '').toLowerCase().includes(want)) ? dlg : document;
        const els = [...scope.querySelectorAll('button,a,[role=button],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=option],[role=checkbox],[role=switch],label,summary,input[type=submit],h1,h2,h3')].filter(e => notOurs(e) && visible(e));
        const txt = e => (e.textContent || e.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return els.find(e => txt(e) === want) || els.find(e => txt(e).startsWith(want)) || els.find(e => txt(e).includes(want)) || null;
      }
      try { return [...document.querySelectorAll(t)].find(e => notOurs(e) && visible(e)) || null; } catch (e) { return null; }
    }
    async function waitFor(t, ms) {
      const end = Date.now() + ms;
      for (;;) { const el = find(t); if (el || Date.now() > end) return el; await new Promise(r => setTimeout(r, 120)); }
    }
    async function waitPath(pattern, ms) {
      const end = Date.now() + ms;
      while (!pathMatches(pattern, location.href) && Date.now() < end) await new Promise(r => setTimeout(r, 120));
      return pathMatches(pattern, location.href);
    }
    function stepUrl(step) {
      const u = new URL(step.path, location.href);
      const here = new URL(location.href);
      ['journey', 'pm'].forEach(k => { if (here.searchParams.has(k)) u.searchParams.set(k, here.searchParams.get(k)); });
      if (inFrame) u.searchParams.set('pmframe', params.get('pmframe'));
      return u.href;
    }

    /* cursor + ring */
    let cx = window.innerWidth * 0.62, cy = window.innerHeight * 0.7, tracked = null, raf = 0;
    function place(x, y, ms) {
      const L = overlay();
      L.cursor.style.transition = ms ? 'transform ' + ms + 'ms cubic-bezier(.45,.05,.25,1),opacity .2s' : 'opacity .2s';
      L.cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      L.cursor.classList.add('on');
      cx = x; cy = y;
    }
    function track() {
      cancelAnimationFrame(raf);
      const L = overlay();
      const tick = () => {
        if (!tracked || !tracked.isConnected) { L.ring.classList.remove('on'); return; }
        const r = tracked.getBoundingClientRect();
        L.ring.classList.toggle('on', r.width > 0 && r.height > 0);
        Object.assign(L.ring.style, { left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px' });
        raf = requestAnimationFrame(tick);
      };
      tick();
    }
    function highlight(el, title) {
      const L = overlay();
      tracked = el;
      L.ring.querySelector('.ring-l').textContent = title || '';
      L.ring.classList.toggle('on', !!el);
      if (el) track();
    }
    function clear() {
      tracked = null; cancelAnimationFrame(raf);
      if (layer) { layer.ring.classList.remove('on'); layer.cursor.classList.remove('on'); }
    }
    async function moveTo(el, fast) {
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
      if (inFrame) {
        // Inside a pane, scrollIntoView would also scroll the page around the
        // pane (the storyboard canvas). Scroll this document only.
        const b = el.getBoundingClientRect();
        const dy = tall ? Math.min(0, b.top) || Math.max(0, b.bottom - window.innerHeight) : b.top + b.height / 2 - window.innerHeight / 2;
        if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: fast ? 'auto' : 'smooth' });
      } else el.scrollIntoView({ block: tall ? 'nearest' : 'center', inline: 'nearest', behavior: fast ? 'auto' : 'smooth' });
      if (!fast) await new Promise(r => setTimeout(r, 260));
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 28 + r.width * 0.2), y = r.top + r.height / 2;
      const ms = fast ? 0 : Math.round(Math.min(900, 300 + Math.hypot(x - cx, y - cy) * 0.6) / speed);
      place(x, y, ms);
      if (ms) await new Promise(r => setTimeout(r, ms + 40));
    }
    function ripple() {
      const L = overlay();
      L.cursor.classList.remove('click'); void L.cursor.offsetWidth; L.cursor.classList.add('click');
    }
    function setValue(el, v) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function realClick(el) {
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      const P = window.PointerEvent || MouseEvent;
      el.dispatchEvent(new P('pointerdown', { pointerType: 'mouse', isPrimary: true, ...o }));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      if (el.focus) el.focus({ preventScroll: true });
      el.dispatchEvent(new P('pointerup', { pointerType: 'mouse', isPrimary: true, ...o }));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.click();
    }
    async function act(step, el, fast) {
      const a = step.action || 'click';
      if (!el) return;
      if (a === 'look' || a === 'hover') return;
      if (a === 'click') { if (!fast) ripple(); realClick(el); return; }
      if (a === 'type') {
        const text = String(step.text || '');
        realClick(el);
        if (fast) { setValue(el, text); return; }
        for (let i = 1; i <= text.length; i++) { setValue(el, text.slice(0, i)); await new Promise(r => setTimeout(r, 45 / speed)); }
        return;
      }
      if (a === 'select') { setValue(el, step.value); el.dispatchEvent(new Event('change', { bubbles: true })); return; }
      if (a === 'press') {
        const k = step.key || 'Enter';
        ['keydown', 'keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: k, bubbles: true, cancelable: true })));
        if (k === 'Enter' && el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
      }
    }

    // Bring step i on screen: its page, its element, the cursor on it.
    async function show(i, fast) {
      const step = steps()[i];
      if (!step) return null;
      if (step.path && !(await waitPath(step.path, fast ? 300 : 1500))) {
        run.idx = i; save();
        location.assign(stepUrl(step)); // resumes on the next page load
        return 'nav';
      }
      const el = step.target ? await waitFor(step.target, fast ? 4000 : inFrame ? 2500 : 6000) : null;
      // In compare view the other version may not have this step (v1 had no
      // bulk actions): say so and keep pace with the other side.
      if (layer) layer.note.classList.remove('on');
      if (step.target && !el && inFrame) {
        const L = overlay(); L.note.textContent = 'Step ' + (i + 1) + ' isn’t in this version'; L.note.classList.add('on');
        highlight(null); run.lost = false; return 'none';
      }
      if (step.target && !el) { run.lost = true; run.playing = false; emit(); return null; }
      run.lost = false;
      if (el) { await moveTo(el, fast); highlight(el, fast ? '' : (i + 1) + '. ' + (step.title || '')); }
      else highlight(null);
      return el || 'none';
    }

    // The loop. Each pass: show the step, wait, do it, move on. A page load in
    // the middle (a link, a form) ends this pass; the next load resumes it.
    async function loop() {
      if (busy) return;
      busy = true;
      const my = ++token;
      try {
        // Seeking: replay steps quickly, without dwelling, up to the target.
        while (run.seek != null && run.idx < run.seek && my === token) {
          const el = await show(run.idx, true);
          if (el === 'nav' || el == null) return;
          const step = steps()[run.idx];
          run.idx++; save();
          await act(step, el === 'none' ? null : el, true);
          await new Promise(r => setTimeout(r, 420));
        }
        if (run.seek != null) { run.seek = null; emit(); }
        if (my !== token) return;
        const el = await show(run.idx, false);
        emit();
        if (el === 'nav' || el == null) return;
        while (run.playing && my === token) {
          const step = steps()[run.idx];
          await wait((step.ms || 1100) / speed);
          if (!run.playing || my !== token) return;
          run.idx++;
          run.done = run.idx >= n();
          if (run.done) { run.idx = n() - 1; run.playing = false; }
          save();
          await act(step, el === 'none' ? null : el, false);
          if (run.done) { emit(); return; }
          await new Promise(r => setTimeout(r, 450 / speed));
          const nx = await show(run.idx, false);
          emit();
          if (nx === 'nav' || nx == null) return;
          return void (busy = false, loop());
        }
      } finally { if (my === token) busy = false; }
    }
    function stop() { token++; clearTimeout(timer); busy = false; }

    function start() {
      // A replay starts from the journey's first page with a clean app.
      const first = steps()[0];
      run.idx = 0; run.done = false; run.lost = false; run.active = true; save();
      if (first && first.path) location.assign(stepUrl(first));
      else location.reload();
    }

    const R = {
      get active() { return !!run.active; },
      get state() { return { idx: run.idx, n: n(), playing: !!run.playing, done: !!run.done, lost: !!run.lost, active: !!run.active, speed, seeking: run.seek != null }; },
      current() { const s = steps()[run.idx]; return s ? { index: run.idx + 1, title: s.title || '' } : null; },
      onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
      async play() {
        if (!n()) return;
        if (run.done) { run.playing = true; run.seek = null; return start(); }
        run.active = true; run.playing = true; stop(); emit(); loop();
      },
      pause() { run.playing = false; stop(); emit(); },
      async next() {
        if (!n()) return;
        run.playing = false; stop();
        if (!run.active) { run.active = true; emit(); return loop(); }
        if (run.done) return;
        const step = steps()[run.idx];
        const el = step.target ? find(step.target) : null;
        if (step.target && !el && !inFrame) { run.lost = true; emit(); return; }
        if (el) await moveTo(el, false);
        run.idx++;
        run.done = run.idx >= n();
        if (run.done) run.idx = n() - 1;
        save();
        await act(step, el, false);
        emit();
        if (!run.done) { await new Promise(r => setTimeout(r, 350 / speed)); loop(); }
      },
      prev() { if (!n()) return; this.seek(Math.max(0, run.idx - (run.done ? 0 : 1))); },
      seek(k) {
        run.playing = false; stop();
        if (k <= 0) { run.seek = null; return start(); }
        run.seek = k; start();
      },
      restart() { run.playing = false; run.seek = null; stop(); start(); },
      setSpeed(v) { speed = SPEEDS.includes(+v) ? +v : 1; store.set('speed', speed); emit(); },
      exit() { stop(); run = { journey: state.journey, idx: 0, active: false, playing: false, done: false, seek: null, lost: false }; clear(); emit(); },
      // A step's page, when the reviewer has wandered off it.
      offPage() {
        if (!run.active || run.seek != null) return false;
        const s = steps()[run.idx];
        return !!(s && s.path && !pathMatches(s.path, location.href));
      },
      backToStep() { const s = steps()[run.idx]; if (s && s.path) location.assign(stepUrl(s)); },
      resume() { if (run.active && n()) loop(); },
    };
    return R;
  }

  /* ── compare frames talk to the top window ──────────────────────────── */
  // Inside a compare / device frame (pmframe=1) the manager runs headless:
  // journeys, mocks and the runner work, the UI lives in the top window.
  function bridgeChild() {
    const post = msg => { try { window.parent.postMessage({ smp: 1, ...msg }, location.origin); } catch (e) { /* ignore */ } };
    const A = () => window.SMAnnotate;
    const sendAnn = () => { const a = A(); if (a) post({ ann: a.state, list: a.list ? a.list() : [] }); };
    runner.onChange(() => post({ run: runner.state, step: runner.current() }));
    (function hook(tries) {
      if (A() && A().onChange) { A().onChange(() => sendAnn()); return; }
      if (tries < 60) setTimeout(() => hook(tries + 1), 250);
    })(0);
    window.addEventListener('message', e => {
      const m = e.data;
      if (e.origin !== location.origin || !m || m.smp !== 1 || e.source !== window.parent) return;
      if (m.cmd && typeof runner[m.cmd] === 'function') runner[m.cmd](m.arg);
      if (m.ann && A() && typeof A()[m.ann] === 'function') { if (m.ann === 'reply' || m.ann === 'resolve') A()[m.ann](...m.arg); else A()[m.ann](m.arg); }
      if (m.cfg) { if (m.cfg.journeys) config.journeys = m.cfg.journeys; if (m.cfg.flows) config.flows = m.cfg.flows; }
      if (m.page) pager.go(m.page);
      if (m.hello) { post({ run: runner.state, step: runner.current() }); sendAnn(); }
      if ('hl' in m) { store.set('hl', !!m.hl); applyHl(); }
      // Storyboard zoom: annotate's pins keep their size on screen.
      if (m.uiScale) { document.documentElement.style.setProperty('--annot-ui-scale', String(m.uiScale)); window.dispatchEvent(new Event('resize')); }
    });
    // Storyboard screens are scaled down: annotate hands its comment box and
    // its threads to the top window, which shows them at full size.
    if (params.get('pmboard')) {
      const waiting = new Map(); let n = 0;
      window.SM_ANNOTATE_HOST = {
        compose(info, done) { const token = ++n; waiting.set(token, done); post({ compose: { token, ...info } }); },
        openThread(id) { post({ openThread: id }); },
      };
      window.addEventListener('message', e => {
        const m = e.data;
        if (e.origin === location.origin && m && m.smp === 1 && e.source === window.parent && m.composeDone) { const d = waiting.get(m.composeDone.token); waiting.delete(m.composeDone.token); if (d) d(m.composeDone.text || ''); }
      });
      document.body.classList.add('annot-hosted');
    }
    // The hide-UI shortcut, and Esc to stop a recording, work while focus is inside a pane too.
    document.addEventListener('keydown', e => {
      if (e.code === 'Backslash' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post({ key: 'bare' }); }
      else if (e.key === 'Escape') post({ key: 'esc' });
    });
    post({ run: runner.state, step: runner.current() });
  }

  /* ── the UI: bottom bar, left drawer, comments panel, compare stage ── */

  let ui = null;
  const hidden = params.get('panel') === '0' || config.panel === false;

  // Comments = /annotate in plugin mode: it ships dormant and reads one
  // localStorage flag on load, so the drawer flips that flag and reloads.
  const commentsCfg = config.comments === false ? null
    : isObj(config.comments) ? config.comments
    : (window.SM_ANNOTATE_PLUGIN || config.comments === true) ? {} : null;
  const COMMENTS_KEY = (commentsCfg && commentsCfg.key) || 'sm-annotator:plugin-active';
  // /annotate is always on when comments are configured: hiding comments only
  // hides pins and cards, it never stops anyone from adding one.
  if (commentsCfg) { try { localStorage.setItem(COMMENTS_KEY, '1'); } catch (e) { /* ignore */ } }
  // Comments an agent wrote to a file ("comments": { "file": "comments.json" }), next to the config.
  if (commentsCfg && typeof commentsCfg.file === 'string' && commentsCfg.file && window.SM_ANNOTATE_SEED === undefined) {
    try { window.SM_ANNOTATE_SEED = new URL(commentsCfg.file, new URL((me && me.dataset.config) || location.href, location.href)).href; } catch (e) { /* ignore */ }
  }
  // A pane (device frame, compare, storyboard) is narrow, but the reviewer is
  // on a desktop with room to spare: keep annotate's desktop popovers and
  // cards instead of its phone bottom sheets.
  if (inFrame && commentsCfg && window.SM_ANNOTATE_COMPACT === undefined) {
    try { if (!window.parent.matchMedia('(hover: none) and (pointer: coarse)').matches) window.SM_ANNOTATE_COMPACT = false; } catch (e) { window.SM_ANNOTATE_COMPACT = false; }
  }
  // Live multiplayer comments ("comments": { "live": true }): everyone on the
  // prototype sees each other's comments as they land, through a Super
  // Annotator relay you run (comments.url, required; without it comments stay
  // single-player). One room per prototype version, so v1's comments stay on v1.
  // Set before annotate loads (it reads SM_ANNOTATE_SYNC once, at start).
  if (commentsCfg && commentsCfg.live && !commentsCfg.url) console.warn('[artifact-manager] comments.live needs comments.url (your Super Annotator relay); staying single-player.');
  if (commentsCfg && commentsCfg.live && commentsCfg.url && window.SM_PROTO_LIVE !== false && !window.SM_ANNOTATE_SYNC) {
    const it = currentIteration();
    window.SM_ANNOTATE_SYNC = {
      url: commentsCfg.url,
      room: commentsCfg.room || [config.id || location.host, (it && it.id) || config.iteration].filter(Boolean).join(':'),
    };
  }
  // One set of controls on the page: annotate hides its own toolbar and
  // bubble and hands its controls to this UI (window.SMAnnotate).
  if (commentsCfg) window.SM_ANNOTATE_EMBED = true;

  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.root,.cursor,.ring{--brand:#f6ff9a;--brand-h:#e8f24a;--bg:#000;--bg1:#161616;--bg2:#232323;--bd:#3a3a3a;--bd2:#2a2a2a;--tx:#fff;--tx2:#ededed;--mut:#c4c4c4;--sub:#8a8a8a;--bad:#f04758;--ok:#64de3c;--warn:#f6c56a;
  --sans:'Denim INK',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--mono:'Aeonik Fono',ui-monospace,Menlo,Monaco,Consolas,monospace}
.root{position:fixed;inset:0;pointer-events:none;z-index:2147483002;font:13px/1.45 var(--sans);color:var(--tx2);-webkit-font-smoothing:antialiased}
.root>*{pointer-events:auto}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}

/* simulated cursor + what it is working on: above the prototype, below our own UI */
.cursor{position:fixed;left:0;top:0;width:26px;height:26px;margin:-3px 0 0 -5px;z-index:2147483001;pointer-events:none;opacity:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
.cursor.on{opacity:1}
.cursor svg{width:26px;height:26px;display:block}
.cursor::after{content:"";position:absolute;left:3px;top:1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--brand);opacity:0;transform:scale(.4)}
.cursor.click::after{animation:rp .5s ease-out}
@keyframes rp{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(3)}}
.ring{position:fixed;z-index:2147483000;pointer-events:none;border:2px solid var(--brand);border-radius:10px;box-shadow:0 0 0 4px rgba(246,255,154,.22),0 0 24px rgba(246,255,154,.35);opacity:0;transition:opacity .2s}
.ring.on{opacity:1}
:host(.nohl) .ring,:host(.nohl) .cursor{visibility:hidden!important}
.ring-l{position:absolute;left:-2px;bottom:calc(100% + 6px);background:var(--brand);color:#000;font:600 11.5px/1 var(--sans);padding:5px 8px;border-radius:999px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
.ring-l:empty{display:none}
.note{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:2147483001;pointer-events:none;background:#161616;color:#ededed;border:1px solid #f6c56a;border-radius:999px;padding:7px 14px;font:600 12.5px/1 'Denim INK',system-ui,sans-serif;opacity:0;transition:opacity .2s;white-space:nowrap}
.note.on{opacity:1}

/* bottom bar */
.bar{position:fixed;z-index:1;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;background:var(--bg1);border:1px solid var(--bd);border-radius:999px;padding:6px;box-shadow:0 10px 34px rgba(0,0,0,.45);white-space:nowrap}
.ib{width:36px;height:36px;border-radius:50%;border:1px solid transparent;background:none;display:grid;place-items:center;cursor:pointer;color:var(--tx2);padding:0;flex:none}
.ib:hover{background:var(--bg2)}
.ib.ol{border-color:var(--bd)}
.ib:disabled{opacity:.35;cursor:default;background:none}
.ib svg{width:17px;height:17px;display:block}
.ib.play{background:var(--tx);color:#000}
.ib.play:hover{background:var(--mut)}
.steps{display:flex;align-items:center;gap:4px;padding:0 4px 0 10px;font-weight:600;font-size:13px;color:var(--tx)}
.steps .ib{width:28px;height:28px}
.steps .ib svg{width:15px;height:15px}
.sep{width:1px;height:22px;background:var(--bd);margin:0 4px}
.cta{height:36px;border-radius:999px;border:1px solid var(--brand);background:var(--brand);color:#000;font-weight:600;font-size:13px;padding:0 16px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
.cta:hover{background:var(--brand-h)}
.cta:disabled{opacity:.4;cursor:default}
.cta.stop{background:var(--bad);border-color:var(--bad);color:#fff}
/* icon spans in buttons: centred on the label, not on its baseline */
.cta>span,.pb>span{display:inline-flex;align-items:center;justify-content:center;line-height:0}
.cta svg,.pb svg{display:block;flex:none}
.cta,.pb{line-height:1}
.cta.stop:hover{background:#d93a4b}
.cta svg{width:15px;height:15px}
.menu{position:fixed;bottom:76px;left:50%;transform:translateX(-50%);max-height:calc(100vh - 100px);overflow-y:auto;box-sizing:border-box;background:var(--bg1);border:1px solid var(--bd);border-radius:16px;padding:14px;width:300px;box-shadow:0 16px 40px rgba(0,0,0,.5)}
.menu .ml{font-size:12px;color:var(--sub);margin-bottom:8px}
.menu .row{min-height:36px}
.menu hr{border:0;border-top:1px solid var(--bd2);margin:10px 0}
.mi{display:flex;width:100%;align-items:center;justify-content:space-between;background:none;border:0;padding:8px 6px;border-radius:8px;cursor:pointer;text-align:left;color:var(--tx2)}
.mi:hover{background:var(--bg2)}
.mi.danger:hover,.mi.danger:hover svg{color:var(--bad)}
.mi:disabled{opacity:.4;cursor:default;background:none}
.warn{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:var(--bg1);border:1px solid var(--warn);color:var(--tx);border-radius:999px;padding:6px 6px 6px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.warn b{color:var(--warn);font-weight:600}
.warn .lk{height:30px;border-radius:999px;border:0;background:var(--warn);color:#000;font-weight:600;padding:0 12px;cursor:pointer}

/* drawers */
.panel{position:fixed;z-index:2;top:12px;bottom:12px;width:372px;max-width:calc(100vw - 24px);background:rgba(16,16,16,.84);-webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;visibility:hidden;opacity:0;transition:transform .24s cubic-bezier(.4,0,.6,1),opacity .2s ease .04s,visibility 0s .24s}
/* On glass, solid greys vanish against a light page behind: translucent white lines read on any page. */
.panel{--bd:rgba(255,255,255,.22);--bd2:rgba(255,255,255,.14)}
.panel .pb:hover,.panel .x:hover{border-color:rgba(255,255,255,.4)}
.panel.l{left:12px;transform:translateX(calc(-100% - 24px))}
.panel.r{right:12px;transform:translateX(calc(100% + 24px))}
.panel.open{transform:none;visibility:visible;opacity:1;transition:transform .34s cubic-bezier(.16,1,.3,1),opacity .18s ease}
.hd{padding:16px 12px 14px 18px;border-bottom:1px solid rgba(255,255,255,.14)}
.hr{display:flex;align-items:center;gap:8px}
.nm{flex:1;min-width:0;font-size:15px;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.x{background:none;border:1px solid var(--bd);color:var(--sub);cursor:pointer;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;flex:none;padding:0}
.x:hover{color:var(--tx);background:var(--bg2)}
.x svg{width:14px;height:14px}
/* Closing a sidebar: its own icon, no ring. */
.panel .x.cls{border-color:transparent;color:var(--mut)}
.panel .x.cls:hover{border-color:transparent;background:var(--bg2);color:var(--tx)}
.x.cls svg{width:18px;height:18px}
.x.cls.l{margin-left:-6px}
.pb{height:32px;border-radius:999px;border:1px solid var(--bd);background:none;cursor:pointer;font-size:12.5px;font-weight:600;padding:0 14px;display:inline-flex;align-items:center;gap:6px;flex:none;color:var(--tx)}
.pb:hover{border-color:#6b6b6b;background:var(--bg2)}
.pb:disabled{opacity:.4;cursor:default;background:none}
.pb svg{width:14px;height:14px}
.kb{font:500 12px/1 var(--sans);background:none;border:0;padding:0;color:var(--sub);letter-spacing:.04em}
.pb:disabled .kb{color:var(--sub)}
.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin-top:12px;padding-right:6px}
.meta>div{min-width:0}
.meta span{display:block;font-size:10.5px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta b{display:block;font-size:12px;font-weight:500;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.body{flex:1;overflow:auto;padding:0 18px 14px}
.sec{padding:16px 0 14px;border-bottom:1px solid rgba(255,255,255,.14)}
.sec:last-child{border-bottom:0}
.sh{font-size:13px;font-weight:600;color:var(--tx);display:flex;align-items:center;justify-content:space-between;min-height:28px;margin-bottom:10px;gap:8px}
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:999px;padding:3px;gap:2px;background:#000}
.seg button{border:0;background:none;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;color:var(--sub);cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--tx);color:#000}
.dz{font:500 11.5px/1 var(--mono);color:var(--sub)}
.cust{display:flex;align-items:center;gap:8px;margin-top:10px}
.nf{flex:1;min-width:0;display:flex;align-items:center;gap:6px;height:40px;background:var(--bg);border:1px solid var(--bd);border-radius:999px;padding:0 12px}
.nf:focus-within{border-color:var(--brand)}
.nf span{font-size:11.5px;font-weight:600;color:var(--sub)}
.nf em{font-style:normal;font-size:11.5px;color:var(--sub)}
.nf input{flex:1;min-width:0;width:100%;border:0;background:none;color:var(--tx);font:600 13px/1 var(--sans);padding:0;-moz-appearance:textfield}
.nf input::-webkit-inner-spin-button,.nf input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.nf input:focus{outline:none}
.cust .by{color:var(--sub)}
.seg.wide{display:flex;width:100%;margin-bottom:14px}
.sh.vh{margin-bottom:8px}
.seg.wide button{flex:1}
.fld{display:block;margin:0 0 10px}
.fld:last-child{margin-bottom:0}
.fl{display:block;font-size:12px;color:var(--sub);margin-bottom:6px}
.selw{position:relative;display:block}
.csb{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:40px;background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:999px;padding:0 12px 0 14px;font-size:13px;font-weight:600;cursor:pointer;text-align:left}
.csb:hover{border-color:#6b6b6b}
.csb[aria-expanded=true]{border-color:var(--mut)}
.csb .csv{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.csb .chev{display:inline-flex;color:var(--mut);flex:none}.csb .chev svg{width:14px;height:14px}
.csl{position:fixed;z-index:20;overflow-y:auto;background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.55);font-size:13px}
.cso{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;background:none;border:0;border-radius:8px;padding:8px 10px;color:var(--tx2);text-align:left;cursor:pointer;font-weight:500}
.cso:hover,.cso:focus-visible{background:var(--bg2);color:var(--tx)}
.cso[aria-selected=true]{color:var(--tx);font-weight:600}
.cso .ck{display:inline-flex;color:var(--brand)}.cso .ck svg{width:14px;height:14px}
.selw::after{content:"";position:absolute;right:15px;top:50%;width:7px;height:7px;border-right:1.5px solid var(--mut);border-bottom:1.5px solid var(--mut);transform:translateY(-70%) rotate(45deg);pointer-events:none}
select{appearance:none;-webkit-appearance:none;width:100%;height:40px;background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:999px;padding:0 36px 0 14px;font-size:13px;font-weight:600;cursor:pointer;text-overflow:ellipsis}
select:hover{border-color:#6b6b6b}
.jb{width:100%;min-height:48px;background:var(--bg);border:1px solid var(--bd);border-radius:24px;padding:7px 38px 7px 14px;text-align:left;cursor:pointer;position:relative;display:block}
.jb:hover{border-color:#6b6b6b}
.jb::after{content:"";position:absolute;right:15px;top:50%;width:7px;height:7px;border-right:1.5px solid var(--mut);border-bottom:1.5px solid var(--mut);transform:translateY(-70%) rotate(45deg)}
.jb b{display:block;font-size:13px;font-weight:600;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jb span{display:block;font-size:11.5px;color:var(--sub)}
.jw{position:relative}
.jp{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:8;border:1px solid var(--bd);border-radius:14px;background:var(--bg1);overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.55)}
.jp input{width:100%;height:38px;border:0;border-bottom:1px solid var(--bd2);background:none;padding:0 12px;color:var(--tx);font-size:13px}
.jp input:focus{outline:none}
.chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--bd2)}
.chip{border:1px solid var(--bd);background:none;border-radius:999px;padding:3px 9px;font-size:11.5px;color:var(--mut);cursor:pointer}
.chip[aria-pressed="true"]{background:var(--tx);color:#000;border-color:var(--tx)}
.jl{max-height:300px;overflow:auto;padding:4px}
.jg{font-size:10.5px;color:var(--sub);text-transform:uppercase;letter-spacing:.06em;padding:8px 8px 4px}
.jo{display:block;width:100%;text-align:left;border:0;background:none;border-radius:10px;padding:7px 8px;cursor:pointer}
.jo:hover,.jo.kb-on{background:var(--bg2)}
.jo[aria-selected="true"] b{color:var(--brand)}
.jo b{display:block;font-size:12.5px;font-weight:600;color:var(--tx)}
.jo span{display:block;font-size:11.5px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.none{padding:12px;color:var(--sub);font-size:12px}
details.pp{margin-top:12px}
details.pp>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--mut);min-height:30px}
details.pp>summary::-webkit-details-marker{display:none}
details.pp>summary::after{content:"";width:7px;height:7px;border-right:1.5px solid var(--mut);border-bottom:1.5px solid var(--mut);transform:rotate(45deg);margin-right:8px;transition:transform .15s}
details.pp[open]>summary::after{transform:rotate(-135deg)}
details.pp[open]>summary{margin-bottom:8px}
.pt{display:inline-flex;align-items:center;gap:8px;flex:1}
.mod{font-size:10.5px;font-weight:600;line-height:1;color:#000;background:var(--warn);border-radius:999px;padding:4px 8px;letter-spacing:.01em}
.rst{position:relative;width:28px;height:28px;border-radius:50%;border:1px solid transparent;background:none;color:var(--bad);display:grid;place-items:center;cursor:pointer;padding:0;margin-right:8px;flex:none}
.rst svg{width:15px;height:15px;display:block}
.rst:hover{background:rgba(240,71,88,.12);border-color:rgba(240,71,88,.35)}
.rst:disabled{color:var(--sub);opacity:.45;cursor:default;background:none;border-color:transparent}
.rst::after{content:attr(data-tip);position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%) translateX(4px);background:#000;color:var(--tx);border:1px solid var(--bd);font-size:11.5px;font-weight:600;white-space:nowrap;padding:5px 9px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
.rst:hover::after,.rst:focus-visible::after{opacity:1;transform:translateY(-50%)}
.reset{background:none;border:0;color:var(--sub);cursor:pointer;padding:6px 0;font-size:12px}
.reset:hover{color:var(--tx)}
.reset:disabled{opacity:.4;cursor:default}
.ex{display:flex;gap:8px;flex-wrap:wrap}
.ex{flex-direction:column;gap:8px}
.ex .pb{width:100%;height:38px;padding:0 6px 0 14px;font-size:12.5px;justify-content:space-between;white-space:nowrap}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px}
.tog{width:36px;height:22px;border-radius:999px;background:#2d2d2d;border:1px solid var(--bd);position:relative;cursor:pointer;flex:none;padding:0}
.tog::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#8a8a8a;transition:transform .15s}
.tog[aria-checked="true"]{background:var(--brand);border-color:var(--brand)}
.tog[aria-checked="true"]::after{transform:translateX(14px);background:#000}
.cnt{font:11px/18px var(--mono);color:var(--mut);background:var(--bg2);border-radius:999px;padding:0 7px;margin-left:6px}
.pres{display:inline-flex;align-items:center;height:32px;padding:0 6px 0 4px;border:1px solid transparent;border-radius:999px;background:none;cursor:pointer;flex:none}
.pres:hover,.pres[aria-expanded="true"]{border-color:var(--bd);background:rgba(255,255,255,.05)}
.pres img{width:24px;height:24px;border-radius:50%;display:block;position:relative;box-shadow:0 0 0 2px #151515}
.pres img+img{margin-left:-8px}
.pres .more{font:600 11px/24px var(--mono);color:var(--tx2);background:var(--bg2);border-radius:999px;min-width:24px;padding:0 6px;margin-left:-6px;position:relative;box-shadow:0 0 0 2px #151515}
.hr{position:relative}
.hr .sp{flex:1}
.hr .nm.cn{flex:none}
/* The header's dropdowns hang from the header's right edge, inside the panel. */
.hr .shw.hdd{position:static}
.hr .shw.hdd .dd{left:auto;right:0}
/* Header avatars are the size of its icon buttons (32px), centred on the same line. */
.hr .pres{height:32px;padding:0;border:0;gap:0}
.hr .pres:hover,.hr .pres[aria-expanded="true"]{background:none}
.hr .pres img,.hr .pres .ini,.hr .pres .more{width:32px;height:32px;min-width:32px;padding:0;box-sizing:border-box;border-radius:50%;box-shadow:0 0 0 2px #1d1d1d}
.hr .pres .more{display:inline-grid;place-items:center;font:600 11.5px/1 var(--mono);margin-left:-8px;z-index:0}
.hr .pres img+img,.hr .pres img+.ini,.hr .pres .ini+img,.hr .pres .ini+.ini{margin-left:-8px}
.hr .pres{border-radius:999px}
.hr .pres:hover,.hr .pres[aria-expanded="true"]{background:none;border-color:transparent}
.hr .pres:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.hr .me-av{width:32px;height:32px;box-sizing:border-box;border:2px solid var(--brand);box-shadow:none;margin-left:4px}
.hr .pb.ic{width:32px;height:32px;padding:0;justify-content:center}
.me-av{width:30px;height:30px;box-shadow:0 0 0 2px var(--brand)}
.me-av img{width:100%;height:100%;display:block}
.pres .ini,.wr .ini{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--bg2);color:var(--tx);font:600 11px/1 var(--mono);position:relative;box-shadow:0 0 0 2px #151515}
.pres .ini+img,.pres img+.ini,.pres .ini+.ini{margin-left:-8px}
.hr .shw+.shw{margin-left:2px}
.dd.mine{width:260px;padding:8px;display:flex;align-items:center;gap:8px}
.dd.mine>input,.dd.mine>.mrow{flex:1;min-width:0;margin:0}
.eav{position:relative;width:32px;height:32px;flex:none;overflow:visible}
.eav img{width:32px;height:32px;border-radius:50%;display:block}
.eav .pen{position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;display:grid;place-items:center;opacity:0;transition:opacity .12s}
.eav .pen svg{width:14px;height:14px}
.eav:hover .pen,.eav:focus-visible .pen{opacity:1}
.dd.cmenu{width:290px;padding:8px 10px}
.bar .shw.bcm .dd{top:auto;bottom:calc(100% + 14px);right:-8px}
.dd.cmenu .row{min-height:38px;font-size:13px;color:var(--tx)}
.dd.cmenu .seg button{padding:5px 10px}
.dd.mine input{width:100%;box-sizing:border-box;height:30px;background:var(--bg);border:1px solid var(--bd);border-radius:999px;padding:0 11px;color:var(--tx);font-size:12.5px;margin-bottom:2px}
.mrow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:4px 4px 4px 8px;min-height:32px;font-size:12.5px;color:var(--tx);background:none;border:0;border-radius:8px;text-align:left}
.mrow .nm2{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mrow .nm2.off{color:var(--sub);font-weight:500}
.pb.sm{height:26px;padding:0 10px;font-size:12px}
.mrow.mav{cursor:pointer;font-weight:600;color:var(--tx2);padding-left:4px}
.mrow.mav:hover{background:rgba(255,255,255,.06);color:var(--tx)}
.mrow.mav img{width:22px;height:22px;border-radius:50%}
.dd.mine input:focus{outline:none;border-color:var(--brand)}

.nm.cn{flex:0 1 auto}
.cmpz{position:fixed;z-index:4;width:340px;background:rgba(16,16,16,.9);-webkit-backdrop-filter:blur(22px) saturate(160%);backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);--bd:rgba(255,255,255,.22)}
.cmpz .ch{display:flex;align-items:center;gap:8px}
.cmpz .ch b{font-size:13.5px;color:var(--tx)}
.cmpz .ch .x{margin-left:auto;width:28px;height:28px}
.cmpz .tg{display:flex;gap:6px;margin-top:10px}
.cmpz .tg code{font:11px/1 var(--mono);color:var(--mut);background:#000;border:1px solid var(--bd);border-radius:999px;padding:4px 8px}
.cmpz .qt{font-size:12px;color:var(--sub);margin-top:8px}
.cmpz textarea{display:block;width:100%;min-height:84px;margin-top:10px;background:#000;border:1px solid var(--brand);border-radius:12px;padding:10px 12px;color:var(--tx);font:13.5px/1.45 var(--sans);resize:vertical}
.cmpz textarea:focus{outline:none}
.cmpz .acts{margin-top:12px}
.kb.dk{background:none;border:0;color:rgba(0,0,0,.5);margin-left:4px}
.dd.who{width:260px;padding:8px;left:0;right:auto}
/* thread mode */
.tv{flex:1;min-height:0;display:flex;flex-direction:column}
.back{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;margin:10px 10px 0;height:30px;padding:0 10px 0 6px;border:0;border-radius:999px;background:none;color:var(--mut);font-size:12.5px;font-weight:600;cursor:pointer}
.back:hover{background:rgba(255,255,255,.06);color:var(--tx)}
.back span{display:inline-flex;width:16px;height:16px}
.tsc{flex:1;overflow:auto;padding:8px 12px 12px}
.tc{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);border-radius:14px;padding:14px}
.tc.res{opacity:.75}
.tc .ch,.tr .ch{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--sub)}
.tc .ch b,.tr .ch b{color:var(--tx);font-size:13px;font-weight:600}
.tm{margin-left:auto}
.rs{width:30px;height:30px;border-radius:50%;border:1px solid var(--bd);background:none;color:var(--mut);display:grid;place-items:center;cursor:pointer;padding:0;flex:none}
.rs svg{width:15px;height:15px;display:block}
.rs:hover{border-color:var(--brand);color:var(--brand)}
.rs.on{background:var(--brand);border-color:var(--brand);color:#000}
.tg{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.tg .st{margin:0}
.cm .wh{margin-top:8px;gap:4px;align-items:center}
.cm .qt{margin-top:6px;font-size:12px;color:var(--sub);font-style:italic;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cm .wh .st{margin:0}
.cm .wh code{background:none;border:1px solid var(--bd);color:var(--mut)}
@keyframes smp-flash{0%{box-shadow:0 0 0 0 rgba(246,255,154,0)}25%{box-shadow:0 0 0 2px var(--brand),0 0 0 8px rgba(246,255,154,.25)}100%{box-shadow:0 0 0 2px rgba(246,255,154,0),0 0 0 14px rgba(246,255,154,0)}}
.tc.flash,.cm.flash{animation:smp-flash 1.2s ease-out 1}
.cm .wh .st,.cm .wh code{font-size:10.5px;padding:3px 6px}
.tg code{font:11px/1 var(--mono);color:var(--mut);background:#000;border:1px solid var(--bd);border-radius:999px;padding:4px 8px}
.qt{font-size:12px;color:var(--sub);margin-top:10px}
img.shot{display:block;width:auto;max-width:100%;max-height:150px;object-fit:contain;border-radius:10px;border:1px solid var(--bd2);background:#0b0b0b;margin-top:8px}
.tc img.shot{max-height:220px;margin:10px 0 4px}
.tc p{font-size:14px;line-height:1.5;color:var(--tx);margin-top:8px;white-space:pre-wrap;word-break:break-word}
.rb{margin-top:10px;font-size:11.5px;color:var(--brand)}
.trs{display:flex;flex-direction:column;gap:2px;margin:8px 0 0 14px;border-left:1px solid rgba(255,255,255,.1);padding-left:12px}
.tr{padding:8px 0}
.tr p{font-size:13px;line-height:1.45;color:var(--tx2);margin-top:4px;white-space:pre-wrap;word-break:break-word}
.tcmp{display:flex;align-items:center;gap:8px;padding:10px 12px 14px;border-top:1px solid rgba(255,255,255,.08)}
.tcmp input{flex:1;min-width:0;height:38px;background:#000;border:1px solid var(--bd);border-radius:999px;padding:0 14px;color:var(--tx);font-size:13px}
.tcmp input:focus{outline:none;border-color:var(--brand)}
.snd{width:38px;height:38px;border-radius:50%;border:0;background:var(--brand);color:#000;display:grid;place-items:center;cursor:pointer;flex:none;padding:0}
.snd svg{width:17px;height:17px;display:block}
.dd.who .ml{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--sub);padding:4px 6px 8px}
.dd.who .ml i{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.wr{display:flex;align-items:center;gap:9px;padding:6px;border-radius:8px;font-size:13px;color:var(--tx);font-weight:500}
.wr img{width:24px;height:24px;border-radius:50%}
.wr em{margin-left:auto;font-style:normal;font-size:11px;color:var(--sub)}
.wr.more{color:var(--sub);font-weight:400}
.live{font-size:12px;color:var(--sub);margin-left:8px;display:inline-flex;align-items:center;gap:5px}
.live i{width:6px;height:6px;border-radius:50%;background:var(--ok)}

/* comments panel */
.me{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.14)}
.av{width:30px;height:30px;border-radius:50%;border:0;padding:0;background:var(--bg2);cursor:pointer;flex:none;overflow:hidden}
.av img{width:30px;height:30px;display:block}
.me input{flex:1;min-width:0;height:34px;background:var(--bg);border:1px solid var(--bd);border-radius:999px;padding:0 12px;color:var(--tx);font-size:12.5px}
.me input:focus{outline:none;border-color:var(--brand)}
.me .who{flex:1;color:var(--tx);font-weight:600}
.cf{padding:10px 18px 0}
.flts{display:flex;align-items:center;padding:10px 18px 0}
.flts .fw{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.flts .sw{justify-content:flex-end;flex:0 1 auto;margin-left:10px}
.flts .dd.flt-dd.sort-dd{left:auto;right:0}
.flts .fb{position:relative}
.flts .fb svg{width:15px;height:15px}
.flts .fb.set::after{content:"";position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--brand)}
.fsum{min-width:0;font-size:12px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fsum span+span::before{content:"·";margin:0 6px;color:var(--mut)}
.fsum .on{color:var(--tx)}
.dd.flt-dd{left:0;right:auto;width:250px;padding:6px}
.frow{display:flex;align-items:center;gap:10px;padding:2px 2px 2px 8px;border-radius:8px}
.frow>span{width:56px;flex:none;font-size:12px;color:var(--sub)}
.flts .frow .flt{flex:1 1 0;width:0;min-width:0;height:30px;background-color:transparent;border-color:transparent;color:var(--tx);font-size:12px;padding:0 8px 0 11px}
.flts .frow:hover .flt{border-color:var(--bd)}
.flts .flt{flex:1 0 auto;min-width:0;height:30px;border:1px solid var(--bd);border-radius:999px;background:#000;color:var(--tx2);font:600 12px/1 var(--sans);padding:0 26px 0 11px;appearance:none;-webkit-appearance:none;cursor:pointer;text-overflow:ellipsis;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23999' stroke-width='1.5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
.flts .flt:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.cl{flex:1;overflow:auto;padding:12px 12px 16px;display:flex;flex-direction:column;gap:8px}
.cm{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);border-radius:14px;padding:12px 14px;cursor:pointer;color:var(--tx2);box-shadow:0 1px 0 rgba(255,255,255,.03) inset;transition:border-color .15s,background .15s}
.cm:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18)}
.cm:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.cmm{margin-left:auto}
.agt{display:inline-block;padding:1px 6px;border-radius:999px;font:600 9.5px/1.5 var(--sans);letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#D97757}
.lnk{display:inline-flex;align-items:center;gap:4px;max-width:100%;margin:1px 2px;padding:1px 8px 1px 6px;border-radius:999px;border:1px solid var(--bd);background:var(--bg2);color:var(--brand);font:600 11px/1.6 var(--sans);text-decoration:none;vertical-align:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lnk:hover{border-color:var(--brand)}
.lnk span{display:inline-flex}.lnk svg{width:11px;height:11px}
.prop{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.pp2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.prop figure{margin:0;display:flex;flex-direction:column;gap:3px;min-width:0}
.prop figcaption{font:600 9.5px/1.2 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--sub)}
.prop figure.on figcaption{color:var(--brand)}
.prop img{display:block;width:100%;height:auto;max-height:90px;object-fit:contain;object-position:left top;background:#fff;border-radius:8px;border:1px solid var(--bd2)}
.prop figure.on img{border-color:var(--brand)}
.prop.big img{max-height:180px}
.tfoot{border-top:1px solid rgba(255,255,255,.08)}
.tfoot .tcmp{border-top:0}
.rchips{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px 0}
.rchips .chip{height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--bd);background:none;color:var(--tx2);font:500 12px/1 var(--sans);cursor:pointer}
.rchips .chip:hover{border-color:var(--mut);color:var(--tx)}
.pcap{display:block;font:11px/1.45 var(--mono);color:var(--tx2);background:var(--bg2);border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word}
.lnks{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.lnks .lnk{margin:0}
.cm .cmm .rs{width:26px;height:26px;border-color:transparent;opacity:0;transition:opacity .12s}
.cm:hover .cmm .rs,.cm:focus-within .cmm .rs,.cmm .rs[aria-expanded=true]{opacity:1}
.cmm .rs svg{width:15px;height:15px}
.cmm .dd{right:0;left:auto;width:200px}
.av2{width:22px;height:22px;border-radius:50%;display:block;flex:none}
.tcmp .av2{width:28px;height:28px}
.cm .rp{display:flex;align-items:center;gap:6px;border-top:1px solid rgba(255,255,255,.07);margin-top:10px!important;padding-top:8px}
.cm.res{opacity:.5}
.cm .ch{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--sub);margin-bottom:3px}
.cm .ch b{color:var(--tx);font-weight:600;font-size:12.5px}
.cm .st2{margin-left:4px!important}
.cm .st{margin-left:auto;font:10.5px/1 var(--mono);border:1px solid var(--bd);border-radius:999px;padding:3px 6px;color:var(--mut)}
.tv .tg .st{font:10.5px/1 var(--mono);border:1px solid var(--bd);border-radius:999px;padding:4px 7px;color:var(--mut)}
.tv .tg code{font:10.5px/1 var(--mono);background:none;padding:4px 7px}
.tv .tg{align-items:center}
.cm p{font-size:13px;line-height:1.45;color:var(--tx);white-space:pre-wrap;word-break:break-word}
.cm .ch{margin-bottom:6px!important}
.cm .rp{font-size:11.5px;color:var(--sub);margin-top:4px}
.empty{padding:28px 14px;text-align:center;color:var(--sub);font-size:12.5px}

/* compare stage */
.stage{position:fixed;inset:0;background-color:#1e1e1e;background-image:radial-gradient(#2e2e2e 1px,transparent 1px);background-size:22px 22px;display:flex;gap:12px;padding:12px}
.pane{flex:1;min-width:0;position:relative;border-radius:14px;overflow:auto;background:transparent;display:flex;overscroll-behavior:contain}
.pane .pg{margin:auto;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0}
.stage:not(:has(.pf.dev)) .pane .pg{width:100%;height:100%}
.pane .pf{position:relative;flex:none;overflow:hidden;border-radius:14px;background:#fff}
.pane .pf.dev{border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.45)}
.pane:has(.pf.dev){padding:12px}
.pane iframe{border:0;background:#fff;display:block;position:absolute;left:0;top:0;transform-origin:0 0}
.pane .pl{flex:none;background:rgba(22,22,22,.9);border:1px solid var(--bd);color:var(--tx);border-radius:999px;padding:4px 10px;font-size:11.5px;font-weight:600;white-space:nowrap}
.stage.board{display:block;overflow:auto;padding:0;background-color:#1e1e1e;background-image:radial-gradient(#2e2e2e 1px,transparent 1px);background-size:22px 22px;cursor:grab;overscroll-behavior:contain}
.stage.board.grab{cursor:grabbing;user-select:none}
.bsw{margin:0 4px;white-space:nowrap}
.stage.board.all .bgrid{position:relative}
.bgrid>.shot{position:absolute}
.barrows{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.barrows .ln{fill:none;stroke:#4a4a4a;stroke-width:2;stroke-linecap:round}
.barrows .hd{fill:#4a4a4a;stroke:none}
.barrows .on .ln{stroke:var(--brand)}
.barrows .on .hd{fill:var(--brand)}
.lane-l{display:flex;align-items:baseline;gap:8px;height:26px;font-size:14px;white-space:nowrap}
.lane-l b{color:var(--tx);font-weight:700}
.lane-l span{color:var(--sub);font-size:12px}
.shot.cur .lane-l b{color:var(--brand)}
.lane-l+.shot-t{margin-top:0}
.bgrid>.shot:not(:has(.lane-l)) .shot-t{margin-top:26px}
.vst{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bd);border-radius:999px;padding:3px 9px;font-size:11.5px;font-weight:600;color:var(--tx);white-space:nowrap}
.vst::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--sub)}
.vst.review::before{background:var(--brand)}
.vst.changes::before{background:#ffb35c}
.vst.approved::before{background:#5fd38a}
.vst.closed{color:var(--sub)}
button.vst.ed{background:var(--bg);cursor:pointer;font-size:11.5px;font-weight:600;padding:3px 7px 3px 9px}
button.vst.ed:hover{border-color:var(--mut)}
.vst.none::before{display:none}
.vst .chev{display:inline-flex;opacity:.6}.vst .chev svg{width:12px;height:12px}
.meta .mst>span{margin-bottom:3px}
.stw .dd{min-width:180px;left:0;right:auto;top:calc(100% + 6px)}
.stw .dd .mi{padding:8px 10px;font-size:13px;font-weight:500}
.stw .dd .mi .vst{border:0;padding:0;font-size:13px;font-weight:500;color:var(--tx2)}
.stw .dd .mi[aria-checked=true]{background:var(--bg2)}
.vst.closed::before{background:#6b6b6b}
.hr .vst{flex:none;margin-right:2px}
.pane .pl .vst{margin-left:8px;padding:1px 7px;font-size:10.5px}
.vrow{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--sub)}
.cclosed{margin:10px 18px 0;padding:9px 12px;border:1px solid var(--bd);border-radius:10px;font-size:12.5px;color:var(--sub)}
.brow{display:flex;gap:56px;align-items:center;width:max-content;min-height:100%;padding:76px 80px 130px}
.shot{flex:none}
.shot-t{display:flex;align-items:baseline;gap:8px;margin:0 0 10px 2px;font-size:13px;white-space:nowrap}
.shot-t span{color:var(--sub);font-weight:500}
.shot-t span::after{content:"·";margin-left:8px}
.shot-t b{color:var(--tx);font-weight:600}
.shot-f{position:relative;overflow:hidden;border-radius:10px;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 14px 40px rgba(0,0,0,.45);transition:box-shadow .15s}
.shot-f:hover{box-shadow:0 0 0 2px var(--brand),0 14px 40px rgba(0,0,0,.45)}
.shot-f iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;pointer-events:none;background:#fff}
.board.commenting .shot-hit{display:none}
.board.commenting .shot-f iframe{pointer-events:auto}
.board.commenting{cursor:default}
.shot-hit{position:absolute;inset:0;border:0;background:none;padding:0;cursor:pointer}
.grab .shot-hit{cursor:grabbing}
.zoom{position:fixed;top:16px;right:16px;display:flex;align-items:center;gap:2px;background:var(--bg1);border:1px solid var(--bd);border-radius:999px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:default}
.zoom button{height:28px;min-width:28px;border:0;background:none;color:var(--tx2);border-radius:999px;font-size:15px;font-weight:600;cursor:pointer;padding:0 8px}
.zoom button:hover{background:var(--bg2)}
.zoom .fit{font-size:12px}
.zoom .csb.zsel{width:auto;height:28px;border:0;background:none;padding:0 6px 0 8px;font-size:12px;gap:4px;font-variant-numeric:tabular-nums}
.zoom .csb.zsel:hover{background:var(--bg2)}
.stage .zoom{z-index:1}   /* above the storyboard canvas, below the sidebars */
/* room for the zoom pill above and the bar below (not while recording a video) */
.root:not(.rec) .stage:not(.board){padding:58px 12px 84px}
.zl{font:600 12px/1 var(--mono);color:var(--mut);min-width:44px;text-align:center}
.root.rec>:not(.stage):not(.toast):not(.slate){display:none!important}
.root.bare>:not(.stage):not(.toast){display:none!important}
.slate{position:fixed;inset:0;z-index:3;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}
.slate span{font:600 13px/1 var(--mono);color:var(--brand);letter-spacing:.08em;text-transform:uppercase}
.slate b{font-size:34px;font-weight:600;color:var(--tx);max-width:760px;line-height:1.15}
.slate p{font-size:15px;color:var(--mut);max-width:620px}
/* Share dropdown */
.shw{position:relative;flex:none}
.dd{position:absolute;top:calc(100% + 6px);right:0;z-index:5;width:268px;background:var(--bg1);border:1px solid var(--bd);border-radius:14px;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.55)}
.dd .mi,.menu .mi{gap:10px;font-size:12.5px;font-weight:600;padding:9px 8px}
.dd .mi>span:first-child,.menu .mi>span:first-child{display:inline-flex;align-items:center;gap:9px}
.dd .mi svg,.menu .mi svg{width:15px;height:15px;display:block;flex:none;color:var(--mut)}
/* In a menu with icons, rows without one sit in a little (12px). */
:is(.menu,.dd):has(.mi svg) .mi:not(:has(svg)){padding-left:12px}
:is(.menu,.dd):has(.mi svg) .row>span:first-child,:is(.menu,.dd):has(.mi svg) .ml{padding-left:12px}
.dd hr{border:0;border-top:1px solid var(--bd2);margin:5px 2px}
/* Export video options */
.scrim{position:fixed;inset:0;z-index:6;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}
.modal{width:420px;max-width:100%;background:var(--bg1);border:1px solid var(--bd);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.6);padding:20px}
.modal h2{font-size:16px;font-weight:600;color:var(--tx);margin-bottom:4px}
.modal .lead{font-size:12.5px;color:var(--sub);margin-bottom:16px;line-height:1.45}
.opt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;background:var(--bg);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer;color:var(--tx2)}
.opt[aria-checked="true"]{border-color:var(--brand)}
.opt i{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--sub);flex:none;margin-top:1px}
.opt[aria-checked="true"] i{border:5px solid var(--brand)}
.opt b{display:block;font-size:13px;font-weight:600;color:var(--tx)}
.opt span{display:block;font-size:11.5px;color:var(--sub);margin-top:2px}
.modal .fl{margin-top:8px}
.acts{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.acts .pb,.acts .cta{height:36px}
.ib.on{color:var(--brand)}
.ib .bd{position:absolute;top:2px;right:0;font:600 9.5px/15px var(--mono);min-width:15px;padding:0 3px;border-radius:999px;background:var(--brand);color:#000}
.ib{position:relative}
.root.rec .stage{padding:0;gap:2px;background:#000}
.root.rec .pane{border-radius:0}
.toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:var(--brand);color:#000;border-radius:999px;padding:8px 14px;font-size:12.5px;font-weight:600;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.4)}
@media (prefers-reduced-motion:reduce){.panel,.panel.open,.tog::after,.cursor{transition:none!important}}
@media (max-width:640px){.bar{bottom:12px;max-width:calc(100vw - 16px)}.steps>span{display:none}}
`;

  const I = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
  const ICON_COMMENT = I('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>');
  const ICON_SHARE = I('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>');
  const ICON_X = I('<path d="M6 6l12 12M18 6L6 18"/>');
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/></svg>';
  const ICON_PREV = I('<path d="M6 5v14"/><path d="M18 6l-8 6 8 6z" fill="currentColor"/>');
  const ICON_NEXT = I('<path d="M18 5v14"/><path d="M6 6l8 6-8 6z" fill="currentColor"/>');
  const ICON_RESTART = I('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>');
  const ICON_PENCIL = I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>');
  const ICON_MORE = I('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>');
  const ICON_SIDEBAR = I('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>');
  const ICON_SIDEBAR_R = I('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>');
  const ICON_LINK = I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>');
  const ICON_COPY = I('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>');
  const ICON_DOWNLOAD = I('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>');
  const ICON_VIDEO = I('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>');
  const ICON_ROTATE = I('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>');
  const ICON_BACK = I('<path d="M15 18l-6-6 6-6"/>');
  const ICON_CHECK = I('<path d="M20 6 9 17l-5-5"/>');
  const ICON_CHEVRON = I('<path d="m6 9 6 6 6-6"/>');
  const ICON_TRASH = I('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>');
  const ICON_SORT = I('<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>');
  const ICON_FILTER = I('<path d="M4 6h16M7 12h10M10 18h4"/>');
  const ICON_ARCHIVE = I('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>');
  const ICON_SEND = I('<path d="M12 19V5M5 12l7-7 7 7"/>');
  const ICON_LIST = I('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 10h6M9 13.5h4"/>');
  const ICON_CURSOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 7.5-6.2 1.6L9.6 18z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  function currentIteration() {
    const its = config.iterations || [];
    const here = new URL(location.href);
    const norm = p => p.replace(/\/index\.html?$/, '/');
    return its.find(it => it.id === config.iteration)
      || its.find(it => { const u = new URL(it.url, location.href); return u.origin === here.origin && (norm(u.pathname) === norm(here.pathname) || it.keepPath); })
      || null;
  }
  function iterationHref(it, extra) {
    const u = new URL(it.url, location.href);
    // keepPath: the iteration is another copy of the same app (another
    // deployment or port), so open the same screen there.
    if (it.keepPath) { const here = new URL(location.href); u.pathname = here.pathname; u.search = here.search; }
    const out = new URL(shareUrl(u.href));
    Object.entries(extra || {}).forEach(([k, v]) => out.searchParams.set(k, v));
    return out.href;
  }

  function mount() {
    const L = overlay();
    const { root, shadow, host } = L;
    let open = store.get('open', sessionStorage) === true;
    let cOpen = store.get('copen', sessionStorage) === true;
    let menu = false, jOpen = false, jq = '', jcat = '';
    const v0 = store.get('view', sessionStorage);
    let view = v0 === 'compare' && (config.iterations || []).length > 1 ? 'compare' : v0 === 'board' && (KIND === 'prototype' ? config.journeys.some(j => stepsOf(j).length) : pager.paged()) ? 'board' : 'single';
    let zoom = +store.get('zoom', sessionStorage) || 0; // storyboard zoom, 0 = fit
    let szoom = +store.get('szoom', sessionStorage) || 0; // compare / device zoom, 0 = scale to fit
    let cmp = store.get('cmp', sessionStorage) || {};
    let cFilter = store.get('cfilter', sessionStorage) || 'all';
    let ann = null, list = [];      // annotate state + comments, local or from a frame
    let frames = [], frameRun = null, frameStep = null, stageKey = '';
    let rec = null; // an Export video in progress
    let shareOpen = null; // 'l' | 'r' | 'p': which dropdown is open (Share, Share, who's here)
    let thread = null;    // the comment open in thread mode in the Comments panel
    // Comments panel filters: version (current / all), people (everyone / you / a name), status.
    let vFilter = store.get('cver', sessionStorage) || 'current';
    let pFilter = store.get('cwho', sessionStorage) || 'all';
    let sFilter = store.get('cstatus', sessionStorage) || 'all';
    // Sorting: first by status (open first by default), then by time (latest by default).
    let sort1 = store.get('csort1') || 'open', sort2 = store.get('csort2') || 'latest';
    let peeked = null, peeking = false;   // other versions' comments, read-only
    let composing = null; // a storyboard screen's comment box, shown here at full size
    let vopt = null;      // the Export video options dialog, while open
    let bare = store.get('bare', sessionStorage) === true; // Super Artifact Manager UI hidden
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const BARE_KEY = MAC ? '⌘ \\' : 'Ctrl \\';
    const boardOn = () => !rec && view === 'board';
    const anySteps = () => config.journeys.some(j => stepsOf(j).length);
    // A closed version takes no new comments or replies (compare panes aside).
    const closedHere = () => { const st = versionStatus(currentIteration()); return !!(st && st.closed) && view !== 'compare'; };
    const vLabel = it => { const st = versionStatus(it); return (it.label || it.id) + (st ? ' · ' + st.label : ''); };
    const vPill = (it, ctl) => { const st = versionStatus(it); return st ? h('span', { class: 'vst ' + st.id, 'data-control': ctl || 'version-status', title: (it.label || it.id) + ': ' + st.label }, st.label) : null; };
    // Storyboard of every journey at once (lanes, shared screens, forks), or just this one.
    let boardAll = store.get('boardall', sessionStorage) === true;
    const allOn = () => boardAll || !steps().length;
    const setBoardAll = on => { boardAll = on; store.set('boardall', on, sessionStorage); render(true); };
    const stageOn = () => !!rec || view === 'compare' || view === 'board' || deviceSize().width;

    function toast(msg) {
      const t = h('div', { class: 'toast', role: 'status' }, msg);
      root.append(t); setTimeout(() => t.remove(), 1600);
    }
    function copy(text, msg) {
      const done = () => toast(msg);
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
      else fallback();
      function fallback() {
        const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        ta.remove(); done();
      }
    }
    function share() {
      const url = shareUrl(location.href);
      if (navigator.share && window.matchMedia && matchMedia('(hover: none)').matches) navigator.share({ title: config.name || document.title, url }).catch(() => {});
      else copy(url, 'Link copied');
    }

    /* annotate: local, or the one inside the device frame */
    const localA = () => window.SMAnnotate;
    // In compare / device view each frame has its own /annotate (its own
    // version's room). Commenting turns on in every frame: click the side you
    // mean. Exports come from the current version (the last pane).
    const frameAnns = new Map();
    function A() {
      if (!stageOn()) return localA();
      if (!frames.length) return null;
      const send = (f, fn, arg) => { try { f.contentWindow.postMessage({ smp: 1, ann: fn, arg }, location.origin); } catch (e) { /* ignore */ } };
      const all = (fn, arg) => frames.forEach(f => send(f, fn, arg));
      const main = (fn, arg) => send(frames[frames.length - 1], fn, arg);
      return {
        comment: v => all('comment', v), show: v => all('show', v), showPins: v => all('showPins', v), showCards: v => all('showCards', v), spotlight: v => all('spotlight', v), setName: v => all('setName', v), newAvatar: () => all('newAvatar'),
        copy: () => main('copy'), exportMarkdown: () => main('exportMarkdown'), saveVersion: () => main('saveVersion'), clearAll: () => main('clearAll'),
        reply: (id, text) => { const f = frames.find(f => { const x = frameAnns.get(f.contentWindow); return x && x.list.some(c => c.id === id); }); if (f) send(f, 'reply', [id, text]); },
        resolve: (id, on) => { const f = frames.find(f => { const x = frameAnns.get(f.contentWindow); return x && x.list.some(c => c.id === id); }); if (f) send(f, 'resolve', [id, on]); },
        focus: id => {
          if (boardOn()) {
            const c = list.find(x => x.id === id);
            const f = frames[Math.max(0, Math.min(frames.length - 1, ((c && (KIND === 'prototype' ? c.step : c.slide || c.pageNo)) || 1) - 1))];
            const shot = f && f.closest('.shot');
            if (shot) shot.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            return f && send(f, 'focus', id);
          }
          frames.forEach(f => { const x = frameAnns.get(f.contentWindow); if (x && x.list.some(c => c.id === id)) send(f, 'focus', id); });
        },
      };
    }
    function mergeFrameAnns() {
      const parts = frames.map((f, i) => Object.assign({ label: f.title }, frameAnns.get(f.contentWindow) || {})).filter(x => x.ann);
      if (!parts.length) return;
      const main = parts[parts.length - 1];
      const one = boardOn(); // every storyboard screen is the same version, the same room
      ann = Object.assign({}, main.ann, {
        commenting: parts.some(x => x.ann.commenting),
        hidden: parts.every(x => x.ann.hidden),
        count: parts.reduce((n, x) => n + (x.ann.count || 0), 0),
      });
      // Storyboard screens share one room (live) or one browser store: the same
      // comment can come from several screens. Keep each once.
      if (one) {
        const seen = new Map();
        parts.forEach(x => (x.list || []).forEach(c => { if (!seen.has(c.id)) seen.set(c.id, c); }));
        list = [...seen.values()];
        ann.count = list.length;
        return;
      }
      // Two versions can share one store: keep each comment once, tagged with the version it was left on.
      const seen = new Map();
      parts.forEach(x => (x.list || []).forEach(c => { if (!seen.has(c.id)) seen.set(c.id, Object.assign({}, c, view === 'compare' && !c.version ? { version: x.label } : {})); }));
      list = [...seen.values()];
      ann.count = list.filter(c => !c.archived).length;
    }
    // In compare / device view the frames run the journey. The top window
    // conducts: one step at a time on every frame, waiting for all of them,
    // so both versions move together.
    const frameRuns = new Map();
    let conducting = false, conductToken = 0;
    const postAll = (cmd, arg) => frames.forEach(f => { try { f.contentWindow.postMessage({ smp: 1, cmd, arg }, location.origin); } catch (e) { /* ignore */ } });
    const allRuns = () => frames.map(f => frameRuns.get(f.contentWindow)).filter(Boolean);
    function settled(before) {
      const runs = allRuns();
      return runs.length === frames.length && runs.every((r, i) => r.done || r.lost || r.idx !== before[i]);
    }
    async function stepAll() {
      const before = frames.map(f => (frameRuns.get(f.contentWindow) || {}).idx);
      postAll('next');
      const end = Date.now() + 15000;
      while (!settled(before) && Date.now() < end) await new Promise(r => setTimeout(r, 120));
    }
    async function conduct() {
      const my = ++conductToken;
      conducting = true; later();
      const speed = +store.get('speed') || 1;
      if (!(frameRun && frameRun.active)) { postAll('next'); await new Promise(r => setTimeout(r, 900)); }
      while (conducting && my === conductToken) {
        const cur = frameRun ? curSteps()[frameRun.idx] : null;
        await new Promise(r => setTimeout(r, ((cur && cur.ms) || 1100) / speed));
        if (!conducting || my !== conductToken) return;
        await stepAll();
        await new Promise(r => setTimeout(r, 450 / speed));
        if (frameRun && frameRun.done) break;
      }
      if (my === conductToken) { conducting = false; later(); }
    }
    function R() {
      if (!stageOn()) return runner;
      const stop = () => { conducting = false; conductToken++; };
      return {
        play: () => { if (frameRun && frameRun.done) { postAll('restart'); setTimeout(conduct, 1800); } else conduct(); },
        pause: () => { stop(); later(); },
        next: () => { stop(); stepAll(); },
        prev: () => { stop(); postAll('prev'); },
        restart: () => { stop(); postAll('restart'); },
        setSpeed: v => { store.set('speed', v); postAll('setSpeed', v); },
        exit: () => { stop(); postAll('exit'); },
      };
    }
    const curSteps = () => (rec && rec.journey ? stepsOf(config.journeys.find(j => j.id === rec.journey)) : steps());
    const runState = () => (stageOn() ? frameRun && { ...frameRun, playing: conducting } : runner.state) || { idx: 0, n: steps().length, playing: conducting, speed: +store.get('speed') || 1 };

    // Pins and cards hide separately (annotate's P and C). Annotate remembers
    // the choice; older annotate builds only know show(), which does both.
    function setPins(v) { const a = A(); if (a) (a.showPins ? a.showPins(v) : a.show(v)); if (ann) ann.pins = !!v; render(); }
    // How comments show: in the sidebar (default), or floating: a card opens
    // next to the pin you click, and nowhere else. The bar's right button shows
    // and hides the sidebar, or (floating) the pins.
    let cmode = store.get('cmode') === 'cards' ? 'cards' : 'sidebar';
    function setCmode(m) {
      cmode = m; store.set('cmode', m); shareOpen = null;
      setCards(false);
      if (m === 'cards') { cOpen = false; store.set('copen', false, sessionStorage); setPins(true); }
      else { cOpen = true; store.set('copen', true, sessionStorage); }
      render();
    }
    // Opened from a comment's link (#comment=<id>): its thread opens in the sidebar once the comments are in.
    { const m = /(?:^#|&)comment=([^&]+)/.exec(location.hash || ''); if (m && !inFrame && cmode === 'sidebar') store.set('cfocus', { id: decodeURIComponent(m[1]), step: null, seeked: true, t: Date.now() }, sessionStorage); }
    const sideOn = () => (cmode === 'cards' ? pinsOn() : cOpen);
    const sideToggle = () => { menu = false; if (cmode === 'cards') setPins(!pinsOn()); else toggleComments(); };
    // A pin opens its thread in the sidebar, the card there flashing.
    if (!inFrame) window.SM_ANNOTATE_ON_PIN = id => {
      if (cmode !== 'sidebar' || stageOn()) return false;
      thread = id; cOpen = true; store.set('copen', true, sessionStorage); render();
      requestAnimationFrame(() => { const c = shadow.querySelector('#smp-comments .tv .tc'); if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); } });
      return true;
    };
    // C shows and hides the chosen way, like the button.
    if (!inFrame) window.addEventListener('keydown', e => {
      if (!commentsCfg || e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.composedPath()[0];
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault(); e.stopImmediatePropagation(); sideToggle();
    }, true);
    function setCards(v) { const a = A(); if (a) (a.showCards ? a.showCards(v) : a.show(v)); if (ann) ann.cards = !!v; render(); }
    const pinsOn = () => (ann && ann.pins !== undefined ? ann.pins : ann ? !ann.hidden : true);
    const cardsOn = () => (ann && ann.cards !== undefined ? ann.cards : ann ? !ann.hidden : true);
    // annotate loads after this script; pick it up when it arrives. While
    // someone types in our UI, don't re-render under them.
    let pending = false;
    const typing = () => { const a = shadow.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
    shadow.addEventListener('focusout', e => {
      const inPair = n => n && n.closest && n.closest('.cust');
      if (inPair(e.target) && inPair(e.relatedTarget)) return; // W to H: keep typing
      if (pending) { pending = false; setTimeout(render); }
    });
    const later = () => { if (typing()) pending = true; else render(); };
    // (deferred: annotate calls back at once, and mount() isn't finished yet)
    setTimeout(function hook(tries) {
      if (!commentsCfg) return;
      tries = tries || 0;
      const a = localA();
      if (a && a.onChange) {
        a.onChange(st => { if (stageOn()) return; ann = st;
          if (st && st.commenting && closedHere() && a.comment) { a.comment(false); toast('This version is closed: no new comments'); } list = a.list ? a.list() : []; later(); resumeFocus(); });
        if (store.get('shown') === false) { (a.showPins ? (a.showPins(false), a.showCards(false)) : a.show(false)); store.set('shown', null); }
        if (a.showCards && a.state && a.state.cards !== false) a.showCards(false); // no column of cards: the sidebar, or a card at the pin
        return;
      }
      if (tries < 60) setTimeout(() => hook(tries + 1), 250);
    }, 0);
    runner.onChange(() => { if (!stageOn()) { later(); resumeFocus(); } });
    setTimeout(resumeOpen, 0);
    // nosemgrep: insufficient-postmessage-origin-validation -- origin and source are both checked on the first lines
    window.addEventListener('message', e => {
      if (e.origin !== location.origin) { return; }
      const m = e.data;
      if (!m || m.smp !== 1 || !frames.some(f => f.contentWindow === e.source)) return;
      const primary = e.source === (frames[frames.length - 1] && frames[frames.length - 1].contentWindow);
      if (m.run) frameRuns.set(e.source, m.run);
      if (m.run && primary) { frameRun = m.run; frameStep = m.step; }
      if (m.ann) { frameAnns.set(e.source, { ann: m.ann, list: m.list || [] }); mergeFrameAnns(); }
      if (m.key === 'bare') { toggleBare(); return; }
      if (m.key === 'esc' && rec) { cancelExport(); return; }
      if (m.compose) { if (composing) finishCompose(''); composing = { f: e.source, token: m.compose.token, info: m.compose }; render(); setTimeout(() => { const t = shadow.querySelector('[data-control=compose-text]'); if (t) t.focus(); }, 30); return; }
      if (m.openThread) { thread = m.openThread; cOpen = true; store.set('copen', true, sessionStorage); render(); return; }
      later();
    });

    function toggle(v) { open = v === undefined ? !open : v; store.set('open', open, sessionStorage); root.style.display = ''; render(); }
    function toggleComments(v) { cOpen = v === undefined ? !cOpen : v; if (cOpen) peeked = null; store.set('copen', cOpen, sessionStorage); render(); }
    function toggleBare(v) {
      bare = v === undefined ? !bare : !!v; store.set('bare', bare, sessionStorage);
      menu = false; shareOpen = null; render();
      toast(bare ? 'Controls hidden. ' + BARE_KEY + ' brings them back' : 'Controls back');
    }
    function setHl(v) {
      store.set('hl', !!v); applyHl();
      frames.forEach(f => { try { f.contentWindow.postMessage({ smp: 1, hl: !!v }, location.origin); } catch (e) { /* ignore */ } });
      render();
    }

    /* building blocks */
    // Our own dropdown, not the system one: a button, and a list floating over the UI.
    let csOpen = null, csPending = null, lastSpot = null;
    function cs(ctl, label, value, opts, onChange, cls) {
      const cur = opts.find(o => o[0] === value) || opts[0] || ['', ''];
      const on = csOpen === ctl;
      const pick = v => { csOpen = null; if (v !== cur[0]) onChange(v); render(); };
      const btn = h('button', { type: 'button', class: 'csb' + (cls ? ' ' + cls : ''), 'data-control': ctl, 'data-value': cur[0], 'aria-label': label || ctl, 'aria-haspopup': 'listbox', 'aria-expanded': String(on), title: cur[1],
        // Open without a render: the drawer keeps its scroll, the list floats over it.
        onclick: e => { const was = csOpen === ctl; closeCs(); if (!was) { csOpen = ctl; csPending = { btn: e.currentTarget, list: mkList() }; e.currentTarget.setAttribute('aria-expanded', 'true'); placeCs(); } },
        onkeydown: e => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const i = opts.findIndex(o => o[0] === cur[0]), n = opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (n && n[0] !== cur[0]) { onChange(n[0]); render(); requestAnimationFrame(() => { const b = shadow.querySelector('[data-control="' + ctl + '"]'); if (b) b.focus(); }); }
        } },
        h('span', { class: 'csv' }, cur[1]), h('span', { class: 'chev', html: ICON_CHEVRON }));
      const mkList = () => h('div', { class: 'csl', role: 'listbox', 'aria-label': label || ctl, 'data-cs-list': ctl }, opts.map(([v, t]) =>
        h('button', { type: 'button', role: 'option', class: 'cso', 'data-value': v, 'aria-selected': String(v === cur[0]), onclick: () => pick(v) },
          h('span', null, t), v === cur[0] ? h('span', { class: 'ck', html: ICON_CHECK }) : null)));
      if (on) csPending = { btn, list: mkList() };
      return btn;
    }
    function closeCs() {
      csOpen = null;
      shadow.querySelectorAll('.csl').forEach(l => l.remove());
      shadow.querySelectorAll('.csb[aria-expanded=true]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    }
    // The open list goes on top of everything, under its button (or above it, near the bottom).
    function placeCs() {
      const p = csPending; csPending = null;
      if (!p || !p.btn.isConnected) { csOpen = null; return; }
      root.append(p.list);
      const r = p.btn.getBoundingClientRect(), L = p.list;
      const w = Math.max(r.width, 180);
      L.style.width = w + 'px';
      L.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12, hgt = Math.min(L.scrollHeight, 300);
      if (below >= hgt || below >= above) { L.style.top = (r.bottom + 6) + 'px'; L.style.maxHeight = Math.max(120, below) + 'px'; }
      else { L.style.bottom = (window.innerHeight - r.top + 6) + 'px'; L.style.maxHeight = Math.max(120, above) + 'px'; }
      const sel = L.querySelector('[aria-selected=true]'); if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
    const field = (label, options, value, onchange, name) => h('div', { class: 'fld' },
      label ? h('span', { class: 'fl' }, label) : null,
      cs(name, label || name, value, options, onchange));
    const tog = (label, on, onchange, name) => h('div', { class: 'row' }, h('span', null, label),
      h('button', { class: 'tog', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, 'data-control': name, onclick: () => onchange(!on) }));

    function journeyPicker() {
      const js = config.journeys;
      const cur = js.find(j => j.id === state.journey) || {};
      const count = j => stepsOf(j).length;
      const sub = j => [j.category, count(j) ? count(j) + ' steps' : ''].filter(Boolean).join(' · ');
      const wrap = h('div', { class: 'jw' },
        h('button', { class: 'jb', 'data-control': 'journey', 'aria-haspopup': 'listbox', 'aria-expanded': String(jOpen), onclick: () => { jOpen = !jOpen; render(); } },
          h('b', null, cur.label || cur.id), sub(cur) ? h('span', null, sub(cur)) : null));
      if (!jOpen) return wrap;
      const cats = [...new Set(js.map(j => j.category).filter(Boolean))];
      const q = jq.trim().toLowerCase();
      const hits = js.filter(j => (!jcat || j.category === jcat) && (!q || [j.label, j.id, j.description, j.category].join(' ').toLowerCase().includes(q)));
      const box = h('div', { class: 'jp' });
      const input = h('input', { 'data-control': 'journey-search', placeholder: 'Search ' + js.length + ' journeys', 'aria-label': 'Search journeys', value: jq,
        oninput: e => { jq = e.target.value; const at = e.target.selectionStart; render(); const n = shadow.querySelector('[data-control=journey-search]'); if (n) { n.focus(); n.setSelectionRange(at, at); } },
        onkeydown: e => { if (e.key === 'Enter' && hits[0]) go(hits[0].id, {}); if (e.key === 'Escape') { e.stopPropagation(); jOpen = false; render(); } } });
      box.append(input);
      if (cats.length > 1) box.append(h('div', { class: 'chips' }, [['', 'All']].concat(cats.map(c => [c, c])).map(([c, t]) =>
        h('button', { class: 'chip', 'aria-pressed': String(jcat === c), onclick: () => { jcat = c; render(); } }, t))));
      const l = h('div', { class: 'jl', role: 'listbox' });
      const groups = cats.length ? [...new Set(hits.map(j => j.category || 'Other'))] : [null];
      groups.forEach(g => {
        if (g && !jcat) l.append(h('div', { class: 'jg' }, g));
        hits.filter(j => !g || (j.category || 'Other') === g).forEach(j => l.append(
          h('button', { class: 'jo', role: 'option', 'aria-selected': String(j.id === state.journey), 'data-journey': j.id, onclick: () => { jOpen = false; go(j.id, {}); } },
            h('b', null, j.label || j.id), h('span', null, [count(j) ? count(j) + ' steps' : '', j.description].filter(Boolean).join(' · ')))));
      });
      if (!hits.length) l.append(h('div', { class: 'none' }, 'No journey matches'));
      box.append(l);
      wrap.append(box);
      return wrap;
    }

    function parametersBlock() {
      const s = state;
      const set = patch => api.override(patch);
      const det = h('details', { class: 'pp', open: store.get('params', sessionStorage) ? true : null, ontoggle: e => store.set('params', e.target.open, sessionStorage) });
      // Reset sits in the title row: a red refresh icon, named in its tooltip.
      const home = config.defaultJourney || (config.journeys[0] && config.journeys[0].id);
      const rs = s.modified ? ['Reset parameters', () => api.reset()] : s.journey !== home ? ['Reset to default journey', () => go(home, {})] : ['Reset parameters', null];
      det.append(h('summary', null, h('span', { class: 'pt' }, 'Parameters', s.modified ? h('span', { class: 'mod' }, 'Modified') : null),
        h('button', { class: 'rst', 'data-control': 'reset', 'aria-label': rs[0], 'data-tip': rs[0], disabled: rs[1] ? null : true, html: ICON_RESTART,
          onclick: e => { e.preventDefault(); e.stopPropagation(); if (rs[1]) rs[1](); } })));
      // Built from journeys.json: the prototype's own parameters first.
      Object.entries(config.parameters || {}).forEach(([k, def]) => det.append(field(def.label || k, Object.entries(def.options || {}).map(([v, o]) => [v, lbl({ [v]: o }, v)]), s.params[k], v => set({ params: { ...s.params, [k]: v } }), 'param:' + k)));
      const L2 = config.labels || {};
      if (config.roles) det.append(field(L2.role || 'Role', Object.keys(config.roles).map(k => [k, lbl(config.roles, k)]), s.role, v => set({ role: v }), 'role'));
      if (config.datasets) det.append(field(L2.data || 'Data', Object.keys(config.datasets).map(k => [k, lbl(config.datasets, k)]), s.data, v => set({ data: v }), 'data'));
      if (config.regions) det.append(field(L2.region || 'Region', config.regions.map(r => [r, r]), s.region, v => set({ region: v }), 'region'));
      Object.keys(config.flags || {}).forEach(k => det.append(field(lbl(config.flags, k), [['on', 'On'], ['off', 'Off']], s.flags[k] ? 'on' : 'off', v => set({ flags: { ...s.flags, [k]: v === 'on' } }), 'flag:' + k)));
      const fs = Object.keys(config.failures || {});
      if (fs.length) {
        const opts = [['', 'None']].concat(fs.map(id => [id, lbl(config.failures, id)]));
        const v = s.failures.length > 1 ? '*' : (s.failures[0] || '');
        if (v === '*') opts.push(['*', s.failures.length + ' errors at once']);
        det.append(field(L2.errors || 'Errors', opts, v, x => { if (x !== '*') set({ failures: x ? [x] : [] }); }, 'errors'));
      }
      // Base parameters, on every prototype.
      const net = networkCfg(config);
      const lat = net.latencies.slice();
      if (!lat.some(([v]) => v === s.network.latencyMs)) lat.push([s.network.latencyMs, s.network.latencyMs + 'ms']);
      det.append(field('Latency', lat.map(([v, t]) => [String(v), t]), String(s.network.latencyMs), v => set({ network: { ...s.network, latencyMs: +v } }), 'latency'));
      if (net.offline) det.append(field('Network', [['online', 'Online'], ['offline', 'Offline']], s.network.offline ? 'offline' : 'online', v => set({ network: { ...s.network, offline: v === 'offline' } }), 'offline'));
      return det;
    }

    /* Share: a link, the comments, the journey as a video. Same dropdown in
       both panels, top right. */
    function shareButton(side) {
      const on = shareOpen === side;
      const w = h('div', { class: 'shw' },
        // In the comments header Share is an icon, so the people and you fit beside it.
        h('button', { class: 'pb' + (side === 'r' ? ' ic' : ''), 'data-control': side === 'r' ? 'share-r' : 'share', 'aria-haspopup': 'menu', 'aria-expanded': String(on), 'aria-label': 'Share', title: 'Share',
          onclick: () => { shareOpen = on ? null : side; menu = false; render(); } }, h('span', { html: ICON_SHARE }), side === 'r' ? null : 'Share'));
      if (!on) return w;
      w.append(h('div', { class: 'dd', role: 'menu' }, shareItems(() => { shareOpen = null; render(); })));
      return w;
    }
    // The Share actions: in the drawer's Share and in the bar's ⋯ menu.
    function shareItems(done) {
      const a = A(), n = ann ? ann.count : 0;
      const item = (name, icon, label, kb, disabled, fn) => h('button', { class: 'mi', role: 'menuitem', 'data-control': name, disabled: disabled ? true : null,
        onclick: () => { done(); fn(); } }, h('span', null, h('span', { html: icon }), label), kb ? h('span', { class: 'kb' }, kb) : null);
      const out = [item('copy-link', ICON_LINK, 'Copy ' + KIND + ' link', null, false, share)];
      if (commentsCfg) out.push(h('hr'),
        item('copy-comments', ICON_COPY, 'Copy all comments', '⌥ C', !(n && a), () => a.copy()),
        item('export', ICON_DOWNLOAD, 'Export comments as .MD', '⌥ E', !(n && a), () => a.exportMarkdown()));
      if (KIND === 'prototype') out.push(h('hr'), item('export-video', ICON_VIDEO, 'Export journey as MP4', null, !recordable().length || rec, () => { vopt = videoDefaults(); render(); }));
      return out;
    }
    // The comments header's ⋯: how comments show, pins, clear.
    function commentsMenu(a) {
      const on = shareOpen === 'cm';
      const w = h('div', { class: 'shw hdd' },
        h('button', { class: 'pb ic', 'data-control': 'cmore', 'aria-haspopup': 'menu', 'aria-expanded': String(on), 'aria-label': 'Comment options', title: 'Comment options', html: ICON_MORE,
          onclick: () => { shareOpen = on ? null : 'cm'; menu = false; render(); } }));
      if (!on) return w;
      const n = ann ? ann.count : 0;
      w.append(h('div', { class: 'dd cmenu', role: 'menu' },
        ...cmodeRows(),
        h('hr'),
        h('button', { class: 'mi danger', 'data-control': 'clear', disabled: a && n ? null : true, onclick: () => { shareOpen = null; a.clearAll(); render(); } }, h('span', null, h('span', { html: ICON_TRASH }), 'Clear comments'))));
      return w;
    }
    // Comments UI (Sidebar / Floating) and the pins switch: the sidebar's ⋯, or (floating) the bar's comment button.
    function cmodeRows() {
      return [
        h('div', { class: 'row' }, h('span', null, 'Comments UI'),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Show comments as' },
            h('button', { 'aria-pressed': String(cmode === 'sidebar'), 'data-control': 'cmode-sidebar', title: 'Threads in this sidebar', onclick: () => setCmode('sidebar') }, 'Sidebar'),
            h('button', { 'aria-pressed': String(cmode === 'cards'), 'data-control': 'cmode-cards', title: 'Cards floating next to the page', onclick: () => setCmode('cards') }, 'Floating'))),
        h('div', { class: 'row' }, h('span', null, 'Show comment pins'),
          h('span', { style: 'display:inline-flex;align-items:center;gap:8px' }, h('span', { class: 'kb' }, 'P'),
            h('button', { class: 'tog', role: 'switch', 'aria-checked': String(!!pinsOn()), 'aria-label': 'Show comment pins (P)', 'data-control': 'comments', onclick: () => setPins(!pinsOn()) })))];
    }

    // Panels are rebuilt on every render. One that just opened or closed is
    // built in its previous position, then slides, so the move animates.
    const was = { l: open, r: cOpen };
    function slide(panel, side, now) {
      if (was[side] === now) return;
      was[side] = now;
      panel.classList.toggle('open', !now);
      requestAnimationFrame(() => { void panel.offsetWidth; panel.classList.toggle('open', now); });
    }

    // Device: a frame the size of a real screen, or the window itself. It's a
    // view of the same journey, so switching never reloads the page.
    function setDevice(v) {
      if (v === state.device) return render(true);
      const prev = state;
      overrides = diffOverrides(config, journeyId, { ...resolveState(config, journeyId, overrides), device: v });
      store.set('overrides', overrides);
      state = resolveState(config, journeyId, overrides);
      writeCookie();
      try { history.replaceState(history.state, '', shareUrl(location.href)); } catch (e) { /* ignore */ }
      listeners.forEach(fn => { try { fn(state, prev); } catch (e) { console.error(e); } });
      if (deviceSize().width && runner.active) runner.exit();
      render(true);
    }
    function deviceBlock() {
      const devs = devicesCfg(config);
      const dims = d => (d.width ? ' · ' + d.width + ' × ' + d.height : '');
      const sec = h('div', { class: 'sec' }, h('div', { class: 'sh' }, h('span', null, 'Device'),
        deviceSize().width ? h('span', { class: 'dz' }, deviceSize().width + ' × ' + deviceSize().height) : null));
      sec.append(field(null, Object.keys(devs).map(k => [k, (devs[k].label || k) + (k === 'custom' ? '' : dims(devs[k]))]), state.device, setDevice, 'device'));
      if (state.device === 'custom') {
        const c = deviceSize();
        const num = (name, label, val) => h('label', { class: 'nf' }, h('span', null, label),
          h('input', { type: 'number', min: '200', max: '4000', step: '1', inputmode: 'numeric', 'data-control': name, 'aria-label': label === 'W' ? 'Width' : 'Height', value: String(val),
            onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
            onchange: () => {
              const w = +shadow.querySelector('[data-control=custom-w]').value, hh = +shadow.querySelector('[data-control=custom-h]').value;
              const ok = x => x >= 200 && x <= 4000;
              store.set('custom', { w: ok(w) ? Math.round(w) : c.width, h: ok(hh) ? Math.round(hh) : c.height });
              // Still in the W / H pair: apply when focus leaves it.
              // (a tick later, once focus has landed)
              setTimeout(() => { const f = shadow.activeElement; if (f && f.closest('.cust')) pending = true; else render(true); });
            } }), h('em', null, 'px'));
        sec.append(h('div', { class: 'cust' }, num('custom-w', 'W', c.width), h('span', { class: 'by' }, '×'), num('custom-h', 'H', c.height),
          h('button', { class: 'ib ol', 'aria-label': 'Swap width and height', title: 'Rotate', 'data-control': 'custom-rotate', html: ICON_ROTATE,
            onclick: () => { store.set('custom', { w: c.height, h: c.width }); render(true); } })));
      }
      return sec;
    }

    // Status as a drawer field. Editable by default: pick one, it applies here and
    // fires "smp:status" ({ version, status }) so a host can save it for everyone.
    function statusField(it) {
      if (config.statusEditable === false) return vPill(it) || h('b', null, 'None');
      const on = shareOpen === 'st';
      const st = versionStatus(it);
      const w = h('div', { class: 'shw stw' },
        h('button', { class: 'vst ed ' + (st ? st.id : 'none'), 'data-control': 'version-status', 'aria-haspopup': 'menu', 'aria-expanded': String(on), title: 'Change status',
          onclick: () => { shareOpen = on ? null : 'st'; menu = false; render(); } }, st ? st.label : 'Set status', h('span', { class: 'chev', html: ICON_CHEVRON })));
      if (on) w.append(h('div', { class: 'dd', role: 'menu' }, Object.entries(VERSION_STATUS).map(([id, label]) =>
        h('button', { class: 'mi', role: 'menuitemradio', 'aria-checked': String(!!st && st.id === id), 'data-control': 'status-' + id, onclick: () => {
          it.status = id; delete it.statusLabel; store.set('status:' + it.id, id); shareOpen = null;
          try { window.dispatchEvent(new CustomEvent('smp:status', { detail: { version: it.id, status: id } })); } catch (e) { /* old browser */ }
          toast((it.label || it.id) + ': ' + label); render(true);
        } }, h('span', { class: 'vst ' + id }, label)))));
      return w;
    }

    function drawer() {
      const panel = h('aside', { class: 'panel l' + (open ? ' open' : ''), id: 'smp-panel', role: 'dialog', 'aria-label': 'Super Artifact Manager', 'aria-hidden': String(!open) });
      const it = currentIteration();
      const meta = [];
      const updated = fmtDate((it && it.updated) || config.updated);
      if (it && (it.status || config.statusEditable !== false)) meta.push(['Status', statusField(it)]);
      if (updated) meta.push(['Last updated', updated]);
      if (config.workspace || config.project) meta.push(['Workspace / Project', [config.workspace, config.project].filter(Boolean).join(' / ')]);
      if (config.owner) meta.push(['Owner', config.owner]);
      Object.entries(config.meta || {}).forEach(([k, v]) => meta.push([k, String(v)]));
      panel.append(h('div', { class: 'hd' },
        h('div', { class: 'hr' },
          h('button', { class: 'x cls l', 'aria-label': 'Close', title: 'Close sidebar (J)', html: ICON_SIDEBAR, onclick: () => toggle(false) }),
          h('div', { class: 'nm' }, config.name || document.title || 'Prototype'),
          shareButton('l')),
        meta.length ? h('div', { class: 'meta' }, meta.map(([k, v]) => typeof v === 'string' ? h('div', null, h('span', null, k), h('b', { title: v }, v)) : h('div', { class: 'mst' }, h('span', null, k), v))) : null));

      const body = h('div', { class: 'body' });
      // View + Versioning
      const its = config.iterations || [];
      const views = [['single', 'Single'], its.length > 1 ? ['compare', 'Compare'] : null, (KIND === 'prototype' ? anySteps() : pager.paged() && pager.list().length > 1) ? ['board', 'Storyboard'] : null].filter(Boolean);
      if (its.length || views.length > 1) {
        const sec = h('div', { class: 'sec' });
        // The view switch first, then what it shows.
        if (views.length > 1) sec.append(h('div', { class: 'seg wide', role: 'group', 'aria-label': 'View' }, views.map(([v, t]) =>
          h('button', { 'aria-pressed': String(view === v), 'data-control': 'view-' + v, title: v === 'board' ? (KIND === 'prototype' ? 'Every step as its own screen: this journey, or all of them with their branches' : 'Every ' + pager.word().toLowerCase() + ' side by side on a canvas') : null, onclick: () => setView(v) }, t))));
        if (its.length) sec.append(h('div', { class: 'sh vh' }, h('span', null, 'Versioning')));
        const opts = its.map(i => [i.id, i.label || i.id]);
        if (its.length && view === 'compare') {
          sec.append(field('Left', opts, cmp.left, v => { cmp.left = v; store.set('cmp', cmp, sessionStorage); render(true); }, 'version-left'));
          sec.append(field('Right', opts, cmp.right, v => { cmp.right = v; store.set('cmp', cmp, sessionStorage); render(true); }, 'version-right'));
        } else if (its.length) {
          sec.append(field(null, opts, it && it.id, v => { const t = its.find(i => i.id === v); if (t && t !== it) location.href = iterationHref(t); }, 'version'));
        }
        body.append(sec);
      }
      // Journey + Parameters: prototypes only
      if (KIND === 'prototype') {
        const js = h('div', { class: 'sec' }, h('div', { class: 'sh' }, 'Journey'));
        if (config.journeys.length) js.append(journeyPicker());
        js.append(parametersBlock());
        body.append(js);
      }
      body.append(deviceBlock());
      panel.append(body);
      slide(panel, 'l', open);
      return panel;
    }

    // Who's here: up to three avatars, stacked; click for the list.
    // The comments header: other people (who's here now, who commented), then you.
    function peopleStack() {
      const r = ann.reviewer || {};
      const me = r.name || 'Reviewer';
      const live = ann.live && ann.live.status === 'live';
      const by = new Map();
      const add = (name, avatar, here) => {
        if (!name || (live ? false : name === me)) return;
        const p = by.get(name) || { name, avatar: null, here: false, count: 0 };
        p.avatar = p.avatar || avatar; p.here = p.here || here; by.set(name, p); return p;
      };
      // The room lists you too (as Guest until you add a name): skip one of you.
      if (live) { let skipped = false; ((ann.live && ann.live.viewers) || []).forEach(v => { if (!skipped && v.name === (r.name || 'Guest')) { skipped = true; return; } add(v.name, v.avatar, true); }); }
      (list || []).forEach(c => { const n = c.author || 'Reviewer'; if (live ? c.mine : n === me) return; const p = add(n, c.avatar, false); if (p) p.count++; });
      const ps = [...by.values()].sort((x, y) => (y.here - x.here) || (y.count - x.count) || x.name.localeCompare(y.name));
      if (!ps.length) return null;
      const on = shareOpen === 'p';
      const shown = ps.length > 3 ? ps.slice(0, 2) : ps;
      const stack = h('button', { class: 'pres', 'data-control': 'people', 'aria-haspopup': 'menu', 'aria-expanded': String(on), 'aria-label': ps.length + (ps.length === 1 ? ' other person' : ' other people'), title: ps.map(p => p.name).join(', '),
        onclick: () => { shareOpen = on ? null : 'p'; menu = false; render(); } });
      shown.forEach((p, i) => stack.append(p.avatar ? h('img', { src: p.avatar, alt: '', style: 'z-index:' + (3 - i) }) : h('span', { class: 'ini', style: 'z-index:' + (3 - i) }, p.name.slice(0, 1).toUpperCase())));
      if (ps.length > 3) stack.append(h('span', { class: 'more' }, '+' + (ps.length - 2)));
      const w = h('div', { class: 'shw hdd' }, stack);
      if (on) {
        const here = ps.filter(p => p.here).length;
        const dd = h('div', { class: 'dd who', role: 'menu' }, h('div', { class: 'ml' }, here ? h('i') : null, here ? here + ' here now' : 'Commented here'));
        ps.forEach(p => dd.append(h('div', { class: 'wr' }, p.avatar ? h('img', { src: p.avatar, alt: '' }) : h('span', { class: 'ini' }, p.name.slice(0, 1).toUpperCase()), h('span', null, p.name),
          h('em', null, [p.here ? 'here' : null, p.count ? p.count + (p.count === 1 ? ' comment' : ' comments') : null].filter(Boolean).join(' · ')))));
        w.append(dd);
      }
      return w;
    }
    // You: your avatar; click it to change your name or get a new avatar.
    function meButton(a) {
      const r = ann.reviewer || {};
      const on = shareOpen === 'me';
      const btn = h('button', { class: 'av me-av', 'data-control': 'me', 'aria-haspopup': 'menu', 'aria-expanded': String(on), 'aria-label': 'You: ' + (r.name || 'add your name'), title: r.name ? 'You (' + r.name + ')' : 'Add your name',
        onclick: () => { shareOpen = on ? null : 'me'; menu = false; render(); if (!on) setTimeout(() => { const n = shadow.querySelector('[data-control=name]'); if (n) n.focus(); }, 30); } },
        r.avatar ? h('img', { src: r.avatar, alt: '' }) : null);
      const w = h('div', { class: 'shw hdd' }, btn);
      if (on) {
        w.append(h('div', { class: 'dd mine', role: 'menu' },
          h('button', { class: 'av eav', 'data-control': 'avatar', title: 'New avatar', 'aria-label': 'New avatar', onclick: () => a.newAvatar() },
            r.avatar ? h('img', { src: r.avatar, alt: '' }) : null, h('span', { class: 'pen', html: ICON_PENCIL })),
          r.editable
            ? h('input', { 'data-control': 'name', placeholder: 'Your name', 'aria-label': 'Your name', value: r.name || '', oninput: e => a.setName(e.target.value), onkeydown: e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shareOpen = null; const d = e.target.closest('.dd'); if (d) d.style.display = 'none'; e.target.blur(); } } })
            : h('div', { class: 'mrow' }, h('span', { class: r.name ? 'nm2' : 'nm2 off' }, r.name || 'Not signed in'), h('button', { class: 'pb sm', 'data-control': 'switch-name', onclick: () => a.setName() }, r.name ? 'Switch' : 'Add name'))));
      }
      return w;
    }

    function commentsPanel() {
      const panel = h('aside', { class: 'panel r' + (cOpen ? ' open' : ''), id: 'smp-comments', role: 'dialog', 'aria-label': 'Comments', 'aria-hidden': String(!cOpen) });
      const a = A();
      panel.append(h('div', { class: 'hd' }, h('div', { class: 'hr' },
        h('div', { class: 'nm cn' }, 'Comments', ann && ann.count ? h('span', { class: 'cnt' }, String(ann.count)) : null),
        h('div', { class: 'sp' }),
        a && ann ? peopleStack() : null,
        a && ann ? meButton(a) : null,
        a && ann ? commentsMenu(a) : null,
        h('button', { class: 'x cls', 'aria-label': 'Close comments', title: 'Close sidebar (C)', html: ICON_SIDEBAR_R, onclick: () => toggleComments(false) }))));
      if (!a || !ann) {
        panel.append(h('div', { class: 'empty' }, 'Loading comments…'));
        slide(panel, 'r', cOpen);
        return panel;
      }
      const r = ann.reviewer || {};
      const fr = stageOn() && !boardOn();
      const cur = (fr ? frameStep : runner.current()) || null;
      const active = fr ? frameRun && frameRun.active : runner.active;
      if (steps().length && active && cur) panel.append(h('div', { class: 'cf' }, h('div', { class: 'seg' },
        h('button', { 'aria-pressed': String(cFilter === 'step'), 'data-control': 'cfilter-step', onclick: () => { cFilter = 'step'; store.set('cfilter', cFilter, sessionStorage); render(); } }, 'Step ' + cur.index),
        h('button', { 'aria-pressed': String(cFilter !== 'step'), 'data-control': 'cfilter-all', onclick: () => { cFilter = 'all'; store.set('cfilter', cFilter, sessionStorage); render(); } }, 'All'))));
      const open1 = thread && list.find(c => c.id === thread);
      if (thread && !open1) thread = null;
      if (open1) { panel.append(threadView(open1, a)); slide(panel, 'r', cOpen); return panel; }
      const its = config.iterations || [];
      const curV = (currentIteration() || {}).id || '';
      const multiV = its.length > 1 && !stageOn() && !(commentsCfg && commentsCfg.room);
      let pool = list.map(c => (c.version || stageOn() ? c : { ...c, version: curV }));
      if (multiV && vFilter === 'all') { loadPeek(); pool = pool.concat(peeked || []); }
      const meName = r.name || 'Reviewer';
      const isMe = c => (ann.live ? c.mine : (c.author || 'Reviewer') === meName);
      const people = [...new Set(pool.map(c => c.author || 'Reviewer'))].sort((x, y) => x.localeCompare(y));
      if (pFilter.startsWith('name:') && !people.includes(pFilter.slice(5))) pFilter = 'all';
      const sel = (ctl, label, val, opts, set) => cs(ctl, label, val, opts, set, 'flt');
      if (closedHere()) panel.append(h('div', { class: 'cclosed', 'data-control': 'comments-closed' }, (currentIteration().label || currentIteration().id) + ' is closed for review. You can read its comments, not add new ones.'));
      // Filters live under one icon button: each row is its name in grey, then its value.
      const F = [
        multiV ? ['cfilter-version', 'Version', vFilter, 'current', [['current', 'Current'], ['all', 'All versions']], v => { vFilter = v; store.set('cver', v, sessionStorage); }] : null,
        ['cfilter-people', 'People', pFilter, 'all', [['all', 'Everyone'], ['me', 'You'], ...people.map(n => ['name:' + n, n])], v => { pFilter = v; store.set('cwho', v, sessionStorage); }],
        ['cfilter-status', 'Status', sFilter, 'all', [['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved'], ['archived', 'Archived']], v => { sFilter = v; store.set('cstatus', v, sessionStorage); }],
      ].filter(Boolean);
      const changed = F.filter(f => f[2] !== f[3]);
      const fOn = shareOpen === 'f';
      const fw = h('div', { class: 'shw fw' },
        h('button', { class: 'x fb' + (changed.length ? ' set' : ''), 'data-control': 'cfilter', 'aria-haspopup': 'menu', 'aria-expanded': String(fOn), 'aria-label': 'Filters', title: 'Filters', html: ICON_FILTER,
          onclick: () => { shareOpen = fOn ? null : 'f'; menu = false; render(); } }),
        h('span', { class: 'fsum' }, F.map(f => { const o = f[4].find(x => x[0] === f[2]); return h('span', { class: f[2] !== f[3] ? 'on' : null }, o ? o[1] : f[2]); })));
      if (fOn) fw.append(h('div', { class: 'dd flt-dd', role: 'menu' }, F.map(f => h('label', { class: 'frow' }, h('span', null, f[1]), sel(f[0], f[1], f[2], f[4], f[5])))));
      const S1 = [['open', 'Open first'], ['resolved', 'Resolved first'], ['none', 'Any status']], S2 = [['latest', 'Latest'], ['oldest', 'Oldest']];
      const lab = (o, v) => (o.find(x => x[0] === v) || [, v])[1];
      const sOn = shareOpen === 's';
      const sw = h('div', { class: 'shw fw sw' },
        h('span', { class: 'fsum' }, h('span', null, lab(S1, sort1)), h('span', null, lab(S2, sort2))),
        h('button', { class: 'x fb' + (sort1 !== 'open' || sort2 !== 'latest' ? ' set' : ''), 'data-control': 'csort', 'aria-haspopup': 'menu', 'aria-expanded': String(sOn), 'aria-label': 'Sort', title: 'Sort', html: ICON_SORT,
          onclick: () => { shareOpen = sOn ? null : 's'; menu = false; render(); } }));
      if (sOn) sw.append(h('div', { class: 'dd flt-dd sort-dd', role: 'menu' },
        h('label', { class: 'frow' }, h('span', null, 'First'), sel('csort-1', 'Sort first by', sort1, S1, v => { sort1 = v; store.set('csort1', v); })),
        h('label', { class: 'frow' }, h('span', null, 'Then'), sel('csort-2', 'Then by', sort2, S2, v => { sort2 = v; store.set('csort2', v); }))));
      panel.append(h('div', { class: 'flts' }, fw, sw));
      const byStatus = c => sFilter === 'archived' ? c.archived : !c.archived && (sFilter === 'open' ? !c.resolved : sFilter === 'resolved' ? c.resolved : true);
      const byWho = c => pFilter === 'all' || (pFilter === 'me' ? isMe(c) : (c.author || 'Reviewer') === pFilter.slice(5));
      const byVer = c => !multiV || vFilter === 'all' || c.version === curV;
      const shown = pool.filter(c => byVer(c) && byWho(c) && byStatus(c))
        .filter(c => c.other || cFilter !== 'step' || !active || !cur || c.step === cur.index)
        .map((c, i) => [c, i]).sort(([a, ia], [b, ib]) => {
          const done = c => (c.resolved || c.archived ? 1 : 0);
          if (sort1 !== 'none') { const d = sort1 === 'open' ? done(a) - done(b) : done(b) - done(a); if (d) return d; }
          const t = c => Date.parse(c.createdAt) || 0;
          return (sort2 === 'oldest' ? t(a) - t(b) : t(b) - t(a)) || ia - ib;
        }).map(([c]) => c);
      const l = h('div', { class: 'cl' });
      if (!shown.length) l.append(h('div', { class: 'empty' }, !pool.length ? (peeking ? 'Loading comments…' : 'No comments yet. Hit Comment and click anything.') : 'No comments match these filters.'));
      shown.forEach(c => l.append(h('div', { class: 'cm' + (c.resolved || c.archived ? ' res' : ''), role: 'button', tabindex: '0', 'data-comment': c.id,
          onclick: e => { if (!e.target.closest('.cmm')) jumpTo(c); }, onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); jumpTo(c); } } },
        h('div', { class: 'ch' }, c.avatar ? h('img', { class: 'av2', src: c.avatar, alt: '' }) : null, h('b', null, c.author || 'Reviewer'), agentTag(c), ago(c.createdAt), commentMenu(c, a, 'l')),
        richP(c.comment), proposalBox(c.proposal), linkChips(c.links),
        KIND !== 'prototype' && c.quote ? h('div', { class: 'qt' }, '“' + c.quote + '”') : null,
        c.shot ? h('img', { class: 'shot', src: c.shot, alt: 'What this comment points at', loading: 'lazy' }) : null,
        whereTags(c),
        c.replies ? h('div', { class: 'rp' }, h('span', { html: ICON_COMMENT, style: 'display:inline-flex;width:13px;height:13px' }), c.replies + (c.replies === 1 ? ' reply' : ' replies')) : null)));
      panel.append(l);
      slide(panel, 'r', cOpen);
      return panel;
    }

    function finishCompose(text) {
      const c = composing; composing = null;
      if (c) { try { c.f.postMessage({ smp: 1, composeDone: { token: c.token, text } }, location.origin); } catch (e) { /* ignore */ } }
      render();
      if (c && text) toast('Comment saved');
    }
    // The comment box for a storyboard screen, at normal size beside what was clicked.
    function composer() {
      const c = composing, info = c.info;
      const fr = frames.find(f => f.contentWindow === c.f);
      if (!fr) { composing = null; return null; }
      const b = fr.getBoundingClientRect(), k = b.width / (fr.offsetWidth || 1);
      const t = { x: b.left + info.rect.x * k, y: b.top + info.rect.y * k, w: info.rect.w * k, h: info.rect.h * k };
      const W = 340, H = 220, gap = 12;
      const left = t.x + t.w + gap + W < innerWidth - 12 ? t.x + t.w + gap : Math.max(12, t.x - gap - W);
      const top = Math.min(Math.max(12, t.y), innerHeight - H - 96);
      const save = () => { const v = shadow.querySelector('[data-control=compose-text]').value; if (v.trim()) finishCompose(v); };
      const el = info.el ? info.el.split(' > ').pop() : '';
      return h('div', { class: 'cmpz', role: 'dialog', 'aria-label': 'New comment', style: 'left:' + Math.round(left) + 'px;top:' + Math.round(top) + 'px' },
        h('div', { class: 'ch' }, h('b', null, 'New comment'), frames.indexOf(fr) >= 0 ? h('span', { class: 'st' }, 'Step ' + (frames.indexOf(fr) + 1)) : null,
          h('button', { class: 'x', 'aria-label': 'Cancel', html: ICON_X, onclick: () => finishCompose('') })),
        el ? h('div', { class: 'tg' }, h('code', null, el)) : null,
        info.quote ? h('div', { class: 'qt' }, '“' + (info.quote.length > 90 ? info.quote.slice(0, 90) + '…' : info.quote) + '”') : null,
        h('textarea', { 'data-control': 'compose-text', placeholder: 'Your comment…', 'aria-label': 'Your comment',
          onkeydown: e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishCompose(''); } } }),
        h('div', { class: 'acts' }, h('button', { class: 'pb', 'data-control': 'compose-cancel', onclick: () => finishCompose('') }, 'Cancel'),
          h('button', { class: 'cta', 'data-control': 'compose-save', onclick: save }, 'Save', h('span', { class: 'kb dk' }, MAC ? '⌘ ↵' : 'Ctrl ↵'))));
    }

    // Where a comment was left: version, journey, step and the element it's pinned to.
    function whereTags(c, full) {
      const its = config.iterations || [];
      const it = its.find(x => x.id === c.version);
      const ver = c.version ? (it ? it.label || it.id : c.version) : '';
      const j = c.journey ? config.journeys.find(x => x.id === c.journey) : null;
      const jt = j ? j.label || j.id : c.journeyTitle || c.journey || '';
      const el = c.el ? c.el.split(' > ').pop() : '';
      const step = c.step ? 'Step ' + c.step + (full && c.stepTitle ? ' · ' + c.stepTitle : '') : '';
      const slide = c.slide ? 'Slide ' + c.slide + (c.slideTitle ? ' · ' + c.slideTitle : '') : '';
      const pg = KIND === 'document' && c.pageNo ? 'Page ' + c.pageNo : '';
      const t = h('div', { class: 'tg wh' },
        ver && its.length > 1 ? h('span', { class: 'st', title: 'Version' }, ver) : null,
        KIND === 'prototype' && jt ? h('span', { class: 'st', title: 'Journey' }, jt) : null,
        step ? h('span', { class: 'st', title: c.stepTitle || 'Step' }, step) : null,
        pg ? h('span', { class: 'st', title: 'Page' }, pg) : null,
        c.section ? h('span', { class: 'st', title: 'Section' }, c.section) : null,
        slide ? h('span', { class: 'st', title: 'Slide' }, slide) : null,
        el ? h('code', { title: c.el }, el) : null);
      return t.childNodes.length ? t : null;
    }

    // Other versions' comments (read-only), for "All versions". Fetched once per panel open.
    function loadPeek() {
      if (peeked || peeking) return;
      const a = localA();
      if (!a || !a.peek) { peeked = []; return; }
      const cur = currentIteration();
      const others = (config.iterations || []).filter(it => !cur || it.id !== cur.id);
      peeking = true;
      Promise.all(others.map(it => a.peek({ url: iterationHref(it), room: [config.id || location.host, it.id].join(':') })
        .then(items => items.map(c => ({ ...c, version: c.version || it.id, other: it.id })))
        .catch(() => [])))
        .then(parts => { const have = new Set(list.map(c => c.id)); peeked = parts.flat().filter(c => !have.has(c.id)); peeking = false; later(); });
    }

    // Open a comment where it was left: its version, journey and step, then its pin.
    function jumpTo(c) {
      const a = A();
      thread = c.id; cOpen = true; store.set('copen', true, sessionStorage);
      if (!stageOn()) {
        const pend = seeked => store.set('cfocus', { id: c.id, step: c.step || null, seeked, t: Date.now() }, sessionStorage);
        // Another version: open that version on the comment's journey; resumeFocus does the rest.
        const here = (currentIteration() || {}).id;
        const vid = c.other || (c.version && here && c.version !== here ? c.version : null);
        const it = vid && (config.iterations || []).find(x => x.id === vid);
        if (it) {
          pend(false);
          if (c.journey && config.journeys.some(j => j.id === c.journey)) { store.set('journey', c.journey); store.set('overrides', {}); store.set('run', null, sessionStorage); }
          const u = new URL(iterationHref(it));
          if (c.journey) { u.searchParams.set('journey', c.journey); u.searchParams.delete('pm'); }
          location.href = u.href;
          return;
        }
        // Another journey: switch (a reload), and resumeFocus takes it to the step.
        if (c.journey && c.journey !== state.journey && config.journeys.some(j => j.id === c.journey)) { pend(false); go(c.journey, {}); return render(); }
        const cur = runner.active ? runner.current() : null;
        if (c.step && steps().length >= c.step && (!cur || cur.index !== c.step)) { pend(true); runner.seek(c.step - 1); return render(); }
      }
      if (a) a.focus(c.id);
      render();
    }
    // After the jump (a reload, or a replay up to the step): scroll to the pin.
    function resumeFocus() {
      const p = store.get('cfocus', sessionStorage);
      if (!p || stageOn()) return;
      if (Date.now() - p.t > 30000) { store.set('cfocus', null, sessionStorage); return; }
      const cur = runner.active ? runner.current() : null;
      if (p.step && !p.seeked && steps().length >= p.step && (!cur || cur.index !== p.step)) {
        store.set('cfocus', { ...p, seeked: true }, sessionStorage); runner.seek(p.step - 1); return;
      }
      const a = localA();
      if (!a || !a.list || runner.state.seeking) return;
      if (!a.list().some(x => x.id === p.id)) return;
      store.set('cfocus', null, sessionStorage);
      thread = p.id; cOpen = true; store.set('copen', true, sessionStorage);
      setTimeout(() => a.focus(p.id), 300);
      later();
    }

    // Agent comments carry a badge; links show as badges, in the text and under it.
    const agentTag = x => (x && x.authorKind === 'agent' ? h('span', { class: 'agt', title: x.agent === 'claude-code' ? 'Claude Code' : 'An agent left this' }, 'Agent') : null);
    const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
    const prettyUrl = u => { try { const x = new URL(u); const p = x.pathname.replace(/\/$/, ''); return x.hostname.replace(/^www\./, '') + (p ? (p.length > 28 ? p.slice(0, 27) + '…' : p) : ''); } catch (e) { return u.slice(0, 40); } };
    const linkChip = (url, label) => h('a', { class: 'lnk', href: url, target: '_blank', rel: 'noopener noreferrer', title: url, onclick: e => e.stopPropagation() }, h('span', { html: ICON_LINK }), label || prettyUrl(url));
    function richP(text) {
      const p = h('p', null), t = String(text || ''); let i = 0, m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(t))) { p.append(t.slice(i, m.index), linkChip(m[0])); i = m.index + m[0].length; }
      p.append(t.slice(i));
      return p;
    }
    // A proposal: the element now, the design system component adjusted to it, and the component to use.
    const proposalBox = (p, big) => (p && (p.current || p.proposed) ? h('div', { class: 'prop' + (big ? ' big' : '') },
      h('div', { class: 'pp2' }, [['Current', p.current], ['Proposed', p.proposed]].filter(x => x[1]).map(([k, u]) =>
        h('figure', { class: k === 'Proposed' ? 'on' : null }, h('figcaption', null, k), h('img', { src: u, alt: k, loading: 'lazy' })))),
      p.caption ? h('code', { class: 'pcap' }, p.caption) : null) : null);
    const linkChips = ls => (Array.isArray(ls) && ls.length ? h('div', { class: 'lnks' }, ls.filter(l => /^https?:\/\//i.test(l.url || '')).map(l => linkChip(l.url, l.label))) : null);
    // A comment's ⋯: Copy link, then Archive (red, last). Wherever a comment card shows.
    function commentMenu(c, a, where) {
      const key = 'cmm:' + where + ':' + c.id, on = shareOpen === key;
      const w = h('div', { class: 'shw cmm' },
        h('button', { class: 'rs cmb', 'data-control': where === 't' ? 'thread-more' : 'comment-more', 'aria-haspopup': 'menu', 'aria-expanded': String(on), 'aria-label': 'Comment options', title: 'More', html: ICON_MORE,
          onclick: e => { e.stopPropagation(); shareOpen = on ? null : key; menu = false; render(); } }));
      if (!on) return w;
      const close = () => { shareOpen = null; render(); };
      w.append(h('div', { class: 'dd', role: 'menu' },
        h('button', { class: 'mi', role: 'menuitem', 'data-control': 'comment-link', onclick: e => { e.stopPropagation(); close(); copy(commentLink(c), 'Link to comment copied'); } }, h('span', null, h('span', { html: ICON_LINK }), 'Copy link')),
        a && a.archive ? h('hr') : null,
        a && a.archive ? h('button', { class: 'mi danger', role: 'menuitem', 'data-control': where === 't' ? 'thread-archive' : 'comment-archive', onclick: e => { e.stopPropagation(); close(); a.archive(c.id, !c.archived); } }, h('span', null, h('span', { html: ICON_ARCHIVE }), c.archived ? 'Unarchive' : 'Archive')) : null));
      return w;
    }
    // A link straight to a comment: its version, journey and step, then the comment.
    function commentLink(c) {
      const its = config.iterations || [];
      const it = c.version ? its.find(x => x.id === c.version) : null;
      const u = new URL(it && it !== currentIteration() ? iterationHref(it) : shareUrl(location.href));
      if (c.journey && config.journeys.some(j => j.id === c.journey)) { u.searchParams.set('journey', c.journey); u.searchParams.delete('pm'); }
      if (c.step) u.searchParams.set('pmstep', String(c.step)); else u.searchParams.delete('pmstep');
      u.hash = 'comment=' + encodeURIComponent(c.id);
      return u.href;
    }
    api.commentLink = c => commentLink(c);

    // One comment, in full: resolve it, read the replies, reply. Back to the list.
    function threadView(c, a) {
      const el = c.el ? c.el.split(' > ').pop() : '';
      const box = h('div', { class: 'tv' },
        h('button', { class: 'back', 'data-control': 'thread-back', onclick: () => { thread = null; render(); } }, h('span', { html: ICON_BACK }), 'All comments'));
      const head = h('div', { class: 'ch' }, c.avatar ? h('img', { class: 'av2', src: c.avatar, alt: '' }) : null, h('b', null, c.author || 'Reviewer'), agentTag(c),
        h('span', { class: 'tm' }, ago(c.createdAt)),
        h('button', { class: 'rs' + (c.resolved ? ' on' : ''), 'data-control': 'thread-resolve', 'aria-pressed': String(!!c.resolved), title: c.resolved ? 'Reopen' : 'Resolve', 'aria-label': c.resolved ? 'Reopen' : 'Resolve', html: ICON_CHECK,
          onclick: () => a.resolve(c.id, !c.resolved) }),
        commentMenu(c, a, 't'));
      const tags = whereTags(c, true);
      const card = h('div', { class: 'tc' + (c.resolved ? ' res' : '') }, head, tags.childNodes.length ? tags : null,
        c.quote ? h('div', { class: 'qt' }, '“' + c.quote + '”') : null,
        c.shot ? h('img', { class: 'shot', src: c.shot, alt: 'What this comment points at' }) : null,
        richP(c.comment), proposalBox(c.proposal, true), linkChips(c.links),
        c.resolved ? h('div', { class: 'rb' }, 'Resolved' + (c.resolvedBy ? ' by ' + c.resolvedBy : '')) : null,
        c.archived ? h('div', { class: 'rb' }, 'Archived' + (c.archivedBy ? ' by ' + c.archivedBy : '') + '. Hidden on the page.') : null);
      const replies = h('div', { class: 'trs' });
      (c.thread || []).forEach(r => replies.append(h('div', { class: 'tr' },
        h('div', { class: 'ch' }, h('img', { class: 'av2', src: r.avatar, alt: '' }), h('b', null, r.author), agentTag(r), h('span', { class: 'tm' }, ago(r.createdAt))),
        richP(r.comment), linkChips(r.links))));
      const send = () => { const i = shadow.querySelector('[data-control=thread-reply]'); const v = i && i.value.trim(); if (!v) return; a.reply(c.id, v); i.value = ''; i.blur(); };
      const me = ann.reviewer || {};
      // Quick replies above the box, like the comment box's chips.
      const quick = h('div', { class: 'rchips' }, ['Agreed', 'Disagree', 'Done'].map(t => h('button', { class: 'chip', 'data-control': 'quick-reply', onclick: () => {
        const i = shadow.querySelector('[data-control=thread-reply]'); if (!i) return;
        i.value = t + (t === 'Disagree' ? ': ' : ''); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
      } }, t)));
      const composer = h('div', { class: 'tcmp' }, me.avatar ? h('img', { class: 'av2', src: me.avatar, alt: '' }) : null,
        h('input', { 'data-control': 'thread-reply', placeholder: 'Reply…', 'aria-label': 'Reply', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); send(); } if (e.key === 'Escape') { e.stopPropagation(); e.target.blur(); } } }),
        h('button', { class: 'snd', 'data-control': 'thread-send', 'aria-label': 'Send reply', html: ICON_SEND, onclick: send }));
      box.append(h('div', { class: 'tsc' }, card, replies), closedHere() ? h('div', { class: 'cclosed', 'data-control': 'thread-closed' }, 'This version is closed. Replies are off.') : h('div', { class: 'tfoot' }, quick, composer));
      return box;
    }

    let wasDone = null;
    function bar() {
      const rs = runState();
      const n = steps().length;
      const a = A();
      const commenting = !!(ann && ann.commenting);
      const R0 = R();
      // Driving the journey closes the drawer, so nothing covers what the cursor works on.
      const clear = fn => () => { if (open) { open = false; store.set('open', false, sessionStorage); } menu = false; fn(); render(); };
      const r = { restart: clear(() => R0.restart()), prev: clear(() => R0.prev()), next: clear(() => R0.next()), play: clear(() => R0.play()), pause: () => R0.pause() };
      const b = h('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Super Artifact Manager' },
        h('button', { class: 'ib', 'aria-label': 'Super Artifact Manager', title: 'Super Artifact Manager (J)', 'data-control': 'drawer', 'aria-expanded': String(open), html: ICON_SIDEBAR, onclick: () => toggle() }));
      // The end of a journey gets a toast, once, not a label in the bar.
      if (rs.done && wasDone === false && !rec) toast('Journey ended');
      wasDone = !!rs.done;
      if (KIND === 'prototype' && (n || boardOn())) {
        const shownIdx = rs.active ? rs.idx + 1 : 1;
        if (boardOn()) b.append(h('div', { class: 'sep' }), boardSwitch());
        else b.append(h('div', { class: 'sep' }),
          h('div', { class: 'steps' }, h('span', { 'data-control': 'step-count' }, shownIdx + ' of ' + n + ' steps')),
          h('button', { class: 'ib ol', 'aria-label': 'Previous step', title: 'Previous step', 'data-control': 'prev', disabled: rs.active && (rs.idx > 0 || rs.done) ? null : true, html: ICON_PREV, onclick: () => r.prev() }),
          // At the end, Play becomes Replay: from step 1 again.
          rs.done && !rs.playing
            ? h('button', { class: 'ib play', 'aria-label': 'Replay journey', title: 'Replay from step 1', 'data-control': 'play', html: ICON_RESTART, onclick: () => r.play() })
            : h('button', { class: 'ib play', 'aria-label': rs.playing ? 'Pause' : 'Play journey', title: rs.playing ? 'Pause' : 'Play', 'data-control': 'play', html: rs.playing ? ICON_PAUSE : ICON_PLAY, onclick: () => (rs.playing ? r.pause() : r.play()) }),
          h('button', { class: 'ib ol', 'aria-label': 'Next step', title: 'Next step', 'data-control': 'next', disabled: rs.done ? true : null, html: ICON_NEXT, onclick: () => r.next() }));
      }
      if (KIND !== 'prototype' && pager.list().length) b.append(h('div', { class: 'sep' }), pagerControls());
      if (commentsCfg) {
        b.append(h('div', { class: 'sep' }));
        if (commenting) b.append(h('button', { class: 'cta stop', 'data-control': 'stop-commenting', title: 'Click anything on the page to comment. Esc also stops.', onclick: () => a && a.comment(false) }, h('span', { html: ICON_X }), 'Stop commenting'));
        else b.append(h('button', { class: 'cta', 'data-control': 'comment', disabled: a && !closedHere() ? null : true, title: closedHere() ? (currentIteration().label || currentIteration().id) + ' is closed: no new comments' : view === 'compare' ? 'Comment (click the version you mean)' : boardOn() ? 'Comment (click the screen you mean)' : 'Comment (A)',
          // Commenting shows comments again: you see the pin you add.
          onclick: () => {
            const a = A(); if (!a) return;
            // Storyboard screens are small: ask for the name in the panel, not inside a screen.
            const r = ann && ann.reviewer;
            const askName = boardOn() && r && r.editable && !r.name;
            if (askName) { cOpen = true; store.set('copen', true, sessionStorage); }
            if (!pinsOn()) setPins(true); a.comment(true); open = false; store.set('open', false, sessionStorage); render();
            if (askName) { toast('Add your name, then click the screen you mean'); setTimeout(() => { shareOpen = 'me'; render(); const n = shadow.querySelector('[data-control=name]'); if (n) n.focus(); }, 80); } // after this click, which closes open dropdowns // after the panel starts sliding in (hidden can't take focus)
          } }, h('span', { html: ICON_COMMENT }), 'Comment'));
      }
      b.append(h('button', { class: 'ib ol', 'aria-label': 'More', 'data-control': 'more', 'aria-expanded': String(menu), html: ICON_MORE, onclick: () => { menu = !menu; shareOpen = null; render(); } }));
      if (commentsCfg) {
        let cb;
        if (cmode === 'cards') {
          // Floating: no sidebar to open, so a comment button with the comments options.
          const on = shareOpen === 'cb';
          const btn = h('button', { class: 'ib' + (on ? ' on' : ''), 'aria-label': 'Comment options', title: 'Comment options', 'data-control': 'comments-panel', 'aria-haspopup': 'menu', 'aria-expanded': String(on), html: ICON_COMMENT,
            onclick: () => { shareOpen = on ? null : 'cb'; menu = false; render(); } });
          if (ann && ann.count) btn.append(h('span', { class: 'bd' }, String(ann.count)));
          cb = h('div', { class: 'shw bcm' }, btn, on ? h('div', { class: 'dd cmenu', role: 'menu' }, ...cmodeRows()) : null);
        } else {
          cb = h('button', { class: 'ib' + (sideOn() ? ' on' : ''), 'aria-label': 'Comments', title: 'Comments (C)', 'data-control': 'comments-panel', 'aria-expanded': String(sideOn()), html: ICON_SIDEBAR_R, onclick: sideToggle });
          if (ann && ann.count) cb.append(h('span', { class: 'bd' }, String(ann.count)));
        }
        b.append(h('div', { class: 'sep' }), cb);
      }
      return b;
    }

    function moreMenu() {
      const rs = runState();
      const a = A();
      const m = h('div', { class: 'menu', role: 'menu' });
      if (steps().length) {
        const sp = +(rs.speed || store.get('speed') || 1);
        m.append(h('div', { class: 'ml' }, 'Playback speed'),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Playback speed' }, SPEEDS.map(v =>
            h('button', { 'aria-pressed': String(sp === v), 'data-control': 'speed-' + v, onclick: () => { R().setSpeed(v); render(); } }, v.toFixed(v % 1 ? (v * 100 % 10 ? 2 : 1) : 1) + 'x'))),
          h('hr'));
      }
      if (steps().length) m.append(tog('Show cursor highlight', hlOn(), v => setHl(v), 'highlight'), h('hr'));
      // Share, then the one switch for the whole UI.
      m.append(...shareItems(() => { menu = false; render(); }), h('hr'));
      const uiName = 'Super Artifact Manager UI';
      m.append(h('div', { class: 'row' }, h('span', null, 'Show ' + uiName),
        h('span', { style: 'display:inline-flex;align-items:center;gap:8px' }, h('span', { class: 'kb' }, BARE_KEY),
          h('button', { class: 'tog', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Show ' + uiName + ' (' + BARE_KEY + ')', 'data-control': 'show-ui', onclick: () => toggleBare(true) }))));
      return m;
    }

    /* compare / device stage */
    function stage() {
      if (boardOn()) return board();
      const dev = deviceSize();
      const its = config.iterations || [];
      const cur = currentIteration();
      if (view === 'compare') cmpPair();
      const pane = (id, i, label) => { const it = its.find(x => x.id === id); return { label: label ? it.label || it.id : null, status: label ? versionStatus(it) : null, src: iterationHref(it, { pmframe: String(i + 1), panel: '0' }) }; };
      const here = () => { const u = new URL(shareUrl(location.href)); u.searchParams.set('pmframe', '1'); u.searchParams.set('panel', '0'); return { label: null, src: u.href }; };
      const vs = rec ? rec.versions : view === 'compare' ? [cmp.left, cmp.right] : null;
      const sources = vs && vs.length > 1 ? vs.map((id, i) => pane(id, i, true))
        : vs && vs[0] && cur && vs[0] !== cur.id ? [pane(vs[0], 0, false)]
        : [here()];
      if (rec) sources.forEach(x => {
        const u = new URL(x.src);
        u.searchParams.set('pmstep', '1');
        // Another journey than the one on screen: its own preset, no tweaks.
        if (rec.journey !== state.journey) { u.searchParams.set('journey', rec.journey); u.searchParams.delete('pm'); }
        x.src = u.href;
      });
      const key = JSON.stringify([sources.map(s => s.src), state.device, dev.width, dev.height, !!rec]);
      const el = shadow.querySelector('.stage');
      if (el && key === stageKey) return el; // keep the frames alive between renders
      stageKey = key;
      const st = h('div', { class: 'stage' });
      frames = []; frameRuns.clear(); frameRun = null; frameStep = null;
      sources.forEach(s => {
        const pane = h('div', { class: 'pane' });
        // The version label sits right above its frame, not at the top of the pane.
        const grp = h('div', { class: 'pg' });
        if (s.label) grp.append(h('div', { class: 'pl' }, s.label, s.status ? h('span', { class: 'vst ' + s.status.id, title: s.status.label }, s.status.label) : null));
        const f = h('iframe', { src: s.src, title: s.label || 'Prototype', 'data-frame': '' });
        frames.push(f);
        f.addEventListener('load', () => {
          try {
            f.contentWindow.postMessage({ smp: 1, cfg: { journeys: config.journeys, flows: config.flows }, hello: 1 }, location.origin);
            if (commentsCfg) {
              f.contentWindow.postMessage({ smp: 1, ann: 'show', arg: !rec }, location.origin);
              if (!rec && ann) { f.contentWindow.postMessage({ smp: 1, ann: 'showPins', arg: pinsOn() }, location.origin); f.contentWindow.postMessage({ smp: 1, ann: 'showCards', arg: cardsOn() }, location.origin); }
            }
          } catch (e) { /* ignore */ }
          fit();
        });
        grp.append(h('div', { class: 'pf' + (dev.width ? ' dev' : '') }, f));
        pane.append(grp);
        st.append(pane);
      });
      // Each frame is drawn at its own size and scaled from its corner into a box
      // of the scaled size: it never spills out of its pane. Scale to Fit (default)
      // fits the device in the pane; 50/75/100% are fixed, and the pane scrolls.
      // Without a device the frame is the pane: zooming out shows a wider viewport.
      const fitK = () => {
        const pane = st.querySelector('.pane'); if (!pane || !dev.width) return 1;
        const L = pane.querySelector('.pl'), lab = L ? L.offsetHeight + 8 : 0;
        return Math.min(1, (pane.clientWidth - 24) / dev.width, (pane.clientHeight - 24 - lab) / dev.height);
      };
      function fit() {
        const z = rec ? 0 : szoom;
        st.querySelectorAll('.pane').forEach((pane, i) => {
          const f = frames[i]; if (!f) return;
          const box = f.parentElement, L = pane.querySelector('.pl'), lab = L ? L.offsetHeight + 8 : 0;
          const pw = pane.clientWidth - (dev.width ? 24 : 0), ph = pane.clientHeight - (dev.width ? 24 : 0) - lab;
          let W, H, k;
          if (dev.width) { W = dev.width; H = dev.height; k = z || Math.min(1, pw / W, ph / H); }
          else { k = z || 1; W = Math.round(pw / k); H = Math.round(ph / k); }
          Object.assign(box.style, { width: Math.round(W * k) + 'px', height: Math.round(H * k) + 'px' });
          Object.assign(f.style, { width: W + 'px', height: H + 'px', transform: k === 1 ? '' : 'scale(' + k + ')' });
        });
        if (zc) zc.label();
      }
      const zc = rec ? null : zoomCtl(() => szoom, k => { szoom = k; store.set('szoom', k, sessionStorage); fit(); }, fitK, 2);
      if (zc) st.append(zc.el);
      requestAnimationFrame(fit);
      window.addEventListener('resize', () => { if (st.isConnected) fit(); });
      return st;
    }
    /* Storyboard: every step of the journey as its own screen, side by side
       on a canvas. Each screen is the real prototype, replayed up to that step.
       Scroll or drag to pan, ⌘/Ctrl + scroll to zoom, click a screen to open
       that step. */
    function board() {
      if (KIND !== 'prototype') return pageBoard();
      if (allOn()) return boardAllView();
      const dev = deviceSize();
      const ss = steps(), n = ss.length;
      const base = (() => { const u = new URL(shareUrl(location.href)); u.searchParams.set('panel', '0'); u.searchParams.set('pmboard', '1'); return u.href; })();
      const key = JSON.stringify(['board', base, state.device, dev.width, dev.height, n]);
      const el = shadow.querySelector('.stage.board');
      if (el && key === stageKey) return el;
      stageKey = key;
      frames = []; frameRuns.clear(); frameRun = null; frameStep = null;
      const W = () => dev.width || window.innerWidth, H = () => dev.height || window.innerHeight;
      // Fit: about three screens across, never taller than the window.
      const fitZoom = () => Math.max(0.12, Math.min(0.5, (window.innerWidth - 272) / (3 * W()), (window.innerHeight - 230) / H()));
      const st = h('div', { class: 'stage board', 'data-control': 'storyboard' });
      const row = h('div', { class: 'brow' });
      const zl = h('span', { class: 'zl' });
      const hits = [];
      ss.forEach((s, i) => {
        const u = new URL(base); u.searchParams.set('pmframe', String(i + 1)); u.searchParams.set('pmseek', String(i));
        const f = boardFrame(u.href, 'Step ' + (i + 1), fr => fr.contentWindow.postMessage({ smp: 1, uiScale: 1 / (zoom || fitZoom()) }, location.origin));
        f.removeAttribute('loading');
        const hit = h('button', { class: 'shot-hit', 'aria-label': 'Open step ' + (i + 1) + ': ' + (s.title || '') });
        hits.push([hit, f, i]);
        row.append(h('div', { class: 'shot', 'data-step': String(i + 1) },
          h('div', { class: 'shot-t' }, h('span', null, 'Step ' + (i + 1) + ' of ' + n), h('b', null, s.title || '')),
          h('div', { class: 'shot-f' }, f, hit)));
      });
      function layout() {
        const k = zoom || fitZoom();
        zl.textContent = Math.round(k * 100) + '%';
        frames.forEach(f => { try { f.contentWindow.postMessage({ smp: 1, uiScale: 1 / k }, location.origin); } catch (e) { /* ignore */ } });
        st.querySelectorAll('.shot-f').forEach((box, i) => {
          Object.assign(box.style, { width: Math.round(W() * k) + 'px', height: Math.round(H() * k) + 'px' });
          Object.assign(frames[i].style, { width: W() + 'px', height: H() + 'px', transform: 'scale(' + k + ')' });
        });
      }
      st.append(row);
      const isDrag = canvasControls(st, zl, fitZoom, layout);
      hits.forEach(([hit, f, i]) => { hit.onclick = shotClick(f, isDrag, () => openStep(i)); });
      return st;
    }
    // Documents and decks: every page or slide as its own screen, side by side.
    function pageBoard() {
      const ps = pager.list(), n = ps.length, word = pager.word();
      const base = (() => { const u = new URL(shareUrl(location.href)); u.searchParams.set('panel', '0'); u.searchParams.set('pmboard', '1'); return u.href; })();
      const key = JSON.stringify(['pboard', base, n, window.innerWidth]);
      const el = shadow.querySelector('.stage.board');
      if (el && key === stageKey) return el;
      stageKey = key;
      frames = [];
      // Each screen is the page's own size, laid out as it is here.
      const sz = ps.map(p => ({ w: Math.max(200, Math.round(p.offsetWidth || window.innerWidth)), h: Math.max(150, Math.round(p.offsetHeight || window.innerHeight)) }));
      const maxW = Math.max(...sz.map(x => x.w)), maxH = Math.max(...sz.map(x => x.h));
      const fitZoom = () => Math.max(0.1, Math.min(0.6, (window.innerWidth - 272) / (3 * maxW), (window.innerHeight - 230) / maxH));
      const st = h('div', { class: 'stage board pages', 'data-control': 'storyboard' });
      const row = h('div', { class: 'brow' });
      const zl = h('span', { class: 'zl' });
      const hits = [];
      ps.forEach((p, i) => {
        const u = new URL(base); u.searchParams.set('pmframe', String(i + 1)); u.searchParams.set('pmpage', String(i + 1));
        const f = boardFrame(u.href, word + ' ' + (i + 1), fr => fr.contentWindow.postMessage({ smp: 1, uiScale: 1 / (zoom || fitZoom()) }, location.origin));
        f.removeAttribute('loading');
        const hd = p.querySelector(HEAD_SEL);
        const title = hd ? (KIND === 'document' ? headingLabel(hd) : clean(hd.textContent)) : '';
        const hit = h('button', { class: 'shot-hit', 'aria-label': 'Open ' + word.toLowerCase() + ' ' + (i + 1) + (title ? ': ' + title : '') });
        hits.push([hit, f, i]);
        row.append(h('div', { class: 'shot', 'data-page': String(i + 1) },
          h('div', { class: 'shot-t' }, h('span', null, word + ' ' + (i + 1) + ' of ' + n), title ? h('b', null, title) : null),
          h('div', { class: 'shot-f' }, f, hit)));
      });
      function layout() {
        const k = zoom || fitZoom();
        zl.textContent = Math.round(k * 100) + '%';
        frames.forEach(f => { try { f.contentWindow.postMessage({ smp: 1, uiScale: 1 / k }, location.origin); } catch (e) { /* ignore */ } });
        st.querySelectorAll('.shot-f').forEach((box, i) => {
          Object.assign(box.style, { width: Math.round(sz[i].w * k) + 'px', height: Math.round(sz[i].h * k) + 'px' });
          Object.assign(frames[i].style, { width: sz[i].w + 'px', height: sz[i].h + 'px', transform: 'scale(' + k + ')' });
        });
      }
      st.append(row);
      const isDrag = canvasControls(st, zl, fitZoom, layout);
      hits.forEach(([hit, f, i]) => { hit.onclick = shotClick(f, isDrag, () => { setView('single'); setTimeout(() => pager.go(i + 1), 60); }); });
      return st;
    }
    // Documents and decks: back and next through pages or slides, where a
    // prototype has its journey controls. In compare, both versions follow.
    let cmpPage = 1;
    function pageGo(k) {
      const n = pager.list().length;
      if (boardOn()) {
        cmpPage = Math.max(1, Math.min(n, k));
        const shot = shadow.querySelectorAll('.stage.board .shot')[cmpPage - 1];
        if (shot) shot.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        render();
      } else if (stageOn()) {
        cmpPage = Math.max(1, Math.min(n, k));
        frames.forEach(f => { try { f.contentWindow.postMessage({ smp: 1, page: cmpPage }, location.origin); } catch (e) { /* ignore */ } });
        render();
      } else pager.go(k);
    }
    function pagerControls() {
      const n = pager.list().length, i = stageOn() ? cmpPage : pager.index;
      const word = pager.word();
      return h('div', { class: 'steps' },
        h('button', { class: 'ib ol', 'aria-label': 'Previous ' + word.toLowerCase(), title: 'Previous ' + word.toLowerCase() + ' (←)', 'data-control': 'page-prev', disabled: i > 1 ? null : true, html: ICON_PREV, onclick: () => pageGo(i - 1) }),
        h('span', { 'data-control': 'page-count' }, word + ' ' + i + ' of ' + n),
        h('button', { class: 'ib ol', 'aria-label': 'Next ' + word.toLowerCase(), title: 'Next ' + word.toLowerCase() + ' (→)', 'data-control': 'page-next', disabled: i < n ? null : true, html: ICON_NEXT, onclick: () => pageGo(i + 1) }));
    }
    if (KIND !== 'prototype') {
      pager.fns.add(() => later());
      window.addEventListener('keydown', e => {
        const fwd = ['ArrowRight', 'PageDown'].concat(pager.deck ? ['ArrowDown', ' '] : []), back = ['ArrowLeft', 'PageUp'].concat(pager.deck ? ['ArrowUp'] : []);
        if (e.metaKey || e.ctrlKey || e.altKey || !(fwd.includes(e.key) || back.includes(e.key))) return;
        const t = e.composedPath()[0];
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault();
        pageGo((stageOn() ? cmpPage : pager.index) + (fwd.includes(e.key) ? 1 : -1));
      });
    }

    // The bar in storyboard view: this journey's steps, or every journey.
    function boardSwitch() {
      const n = steps().length;
      return h('div', { class: 'seg bsw', role: 'group', 'aria-label': 'Storyboard' },
        n ? h('button', { 'aria-pressed': String(!allOn()), 'data-control': 'board-this', title: 'Every step of this journey', onclick: () => setBoardAll(false) }, 'This journey · ' + n) : null,
        h('button', { 'aria-pressed': String(allOn()), 'data-control': 'board-all', title: 'Every journey, with the screens they share and where they branch', onclick: () => setBoardAll(true) }, 'All journeys · ' + config.journeys.length));
    }

    // One zoom control for every staged view: − / Scale to Fit, 50%, 75%, 100% / +.
    const ZOOMS = [['fit', 'Scale to Fit'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']];
    function zoomCtl(getZ, setZ, fitK, max) {
      const val = () => (getZ() ? String(getZ()) : 'fit');
      const btn = cs('zoom', 'Zoom', val(), ZOOMS, v => setZ(v === 'fit' ? 0 : +v), 'zsel');
      const label = () => {
        const z = getZ(), t = btn.querySelector('.csv');
        if (t) t.textContent = z ? Math.round(z * 100) + '%' : 'Fit · ' + Math.round(fitK() * 100) + '%';
        btn.setAttribute('data-value', val()); btn.title = z ? 'Zoom ' + Math.round(z * 100) + '%' : 'Scale to Fit';
      };
      const step = d => setZ(Math.max(0.1, Math.min(max || 2, (getZ() || fitK()) * d)));
      const el = h('div', { class: 'zoom', role: 'group', 'aria-label': 'Zoom' },
        h('button', { 'aria-label': 'Zoom out', 'data-control': 'zoom-out', onclick: () => step(1 / 1.25) }, '−'), btn,
        h('button', { 'aria-label': 'Zoom in', 'data-control': 'zoom-in', onclick: () => step(1.25) }, '+'));
      return { el, label };
    }
    // Pan and zoom for a storyboard canvas: ⌘/Ctrl + scroll or the buttons to
    // zoom, drag to pan. A drag never counts as a click on a screen.
    function canvasControls(st, zl, fitZoom, layout) {
      const zc = zoomCtl(() => zoom, k => { zoom = k ? Math.max(0.1, Math.min(1, k)) : 0; store.set('zoom', zoom, sessionStorage); layout(); zc.label(); }, fitZoom, 1);
      const setZoom = k => { zoom = Math.max(0.1, Math.min(1, k)); store.set('zoom', zoom, sessionStorage); layout(); zc.label(); };
      st.append(zc.el);
      requestAnimationFrame(() => zc.label());
      st.addEventListener('wheel', e => { if (!(e.metaKey || e.ctrlKey)) return; e.preventDefault(); setZoom((zoom || fitZoom()) * Math.exp(-e.deltaY * 0.0025)); }, { passive: false });
      let drag = null, dragged = false;
      st.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('.zoom')) return; drag = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop }; dragged = false; });
      st.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!dragged && Math.hypot(dx, dy) < 5) return;
        dragged = true; st.classList.add('grab'); st.scrollLeft = drag.l - dx; st.scrollTop = drag.t - dy;
      });
      const end = () => { drag = null; st.classList.remove('grab'); setTimeout(() => { dragged = false; }); };
      st.addEventListener('pointerup', end); st.addEventListener('pointerleave', end);
      requestAnimationFrame(layout);
      window.addEventListener('resize', () => { if (st.isConnected && !zoom) layout(); });
      return () => dragged;
    }
    // One storyboard screen: the real prototype in a frame, replayed up to the step.
    function boardFrame(src, title, onLoad) {
      const f = h('iframe', { src, title, tabindex: '-1', loading: 'lazy', 'data-frame': '' });
      frames.push(f);
      f.addEventListener('load', () => { try {
        f.contentWindow.postMessage({ smp: 1, cfg: { journeys: config.journeys, flows: config.flows }, hello: 1 }, location.origin);
        onLoad(f);
        if (commentsCfg) {
          f.contentWindow.postMessage({ smp: 1, ann: 'show', arg: true }, location.origin);
          if (ann) { f.contentWindow.postMessage({ smp: 1, ann: 'showPins', arg: pinsOn() }, location.origin); f.contentWindow.postMessage({ smp: 1, ann: 'showCards', arg: cardsOn() }, location.origin); }
        }
      } catch (e) { /* ignore */ } });
      return f;
    }
    // A click on a screen: a comment pin under the pointer opens its thread, anywhere else runs open().
    const shotClick = (f, isDrag, open) => e => {
      if (isDrag()) return;
      try {
        const r = f.getBoundingClientRect(), k = r.width / (f.offsetWidth || 1);
        const hit = f.contentDocument.elementFromPoint((e.clientX - r.left) / k, (e.clientY - r.top) / k);
        const pin = hit && hit.closest('.annot-badge');
        if (pin) { pin.click(); return; }
      } catch (err) { /* another origin: just open */ }
      open();
    };

    /* Storyboard, all journeys: a lane per journey, a column per step. Screens
       journeys share are drawn once, arrows show the way through, and a lane
       that branches starts under the screen it parts from. */
    function boardAllView() {
      const dev = deviceSize();
      const g = boardGraph(config);
      const base = (() => { const u = new URL(location.href); u.searchParams.set('panel', '0'); u.searchParams.set('pmboard', '1'); u.searchParams.delete('pm'); u.searchParams.delete('pmframe'); u.searchParams.delete('pmstep'); return u; })();
      const key = JSON.stringify(['boardall', base.href, state.journey, state.device, dev.width, dev.height]);
      const el = shadow.querySelector('.stage.board');
      if (el && key === stageKey) return el;
      stageKey = key;
      frames = []; frameRuns.clear(); frameRun = null; frameStep = null;
      const W = () => dev.width || window.innerWidth, H = () => dev.height || window.innerHeight;
      const GX = 96, GY = 80, HEAD = 30, LANE = 26, PAD = { l: 80, t: 76, r: 120, b: 130 };
      const fitZoom = () => Math.max(0.1, Math.min(0.3, (window.innerWidth - 272) / (4 * W())));
      const st = h('div', { class: 'stage board all', 'data-control': 'storyboard', 'data-mode': 'all' });
      const grid = h('div', { class: 'bgrid' });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'barrows'); svg.setAttribute('aria-hidden', 'true');
      grid.append(svg);
      const zl = h('span', { class: 'zl' });
      const mine = new Set(g.path(state.journey));
      const laneOf = new Map(g.lanes.filter(l => l.row !== null).map(l => [l.row, l]));
      const shots = new Map();
      g.nodes.forEach(n => {
        const j = config.journeys.find(x => x.id === n.journey) || {};
        const total = stepsOf(j).length;
        const u = new URL(base); u.searchParams.set('journey', n.journey); u.searchParams.set('pmframe', String(shots.size + 1));
        if (n.step !== null) u.searchParams.set('pmseek', String(n.step));
        const f = boardFrame(u.href, (j.label || j.id) + (n.step !== null ? ', step ' + (n.step + 1) : ''), fr => fr.contentWindow.postMessage({ smp: 1, uiScale: 1 / (zoom || fitZoom()) }, location.origin));
        const lane = laneOf.get(n.row);
        const first = lane && n.col === lane.at;
        const from = first && lane.from ? config.journeys.find(x => x.id === lane.from) : null;
        const shot = h('div', { class: 'shot' + (mine.has(n.key) ? ' cur' : ''), 'data-step': n.step !== null ? String(n.step + 1) : '', 'data-journey': n.journey },
          first ? h('div', { class: 'lane-l' }, h('b', null, j.label || j.id), from ? h('span', null, 'branches from ' + (from.label || from.id) + ' at step ' + (n.col + 1)) : j.category ? h('span', null, j.category) : null) : null,
          h('div', { class: 'shot-t' }, n.step !== null ? h('span', null, 'Step ' + (n.step + 1) + ' of ' + total) : h('span', null, 'No steps'), h('b', null, n.step !== null ? n.title : 'Start screen')),
          h('div', { class: 'shot-f' }, f, h('button', { class: 'shot-hit', 'aria-label': 'Open ' + (j.label || j.id) + (n.step !== null ? ', step ' + (n.step + 1) : '') })));
        shots.set(n.key, { n, shot, f });
        grid.append(shot);
      });
      const isDrag = canvasControls(st, zl, fitZoom, layout);
      shots.forEach(({ n, shot, f }) => { shot.querySelector('.shot-hit').onclick = shotClick(f, isDrag, () => openAt(n.journey, n.step)); });
      st.append(grid);
      function layout() {
        const k = zoom || fitZoom();
        zl.textContent = Math.round(k * 100) + '%';
        const cw = Math.round(W() * k), ch = Math.round(H() * k);
        const x = c => PAD.l + c * (cw + GX), y = r => PAD.t + r * (ch + HEAD + LANE + GY);
        shots.forEach(({ n, shot, f }) => {
          Object.assign(shot.style, { left: x(n.col) + 'px', top: y(n.row) + 'px', width: cw + 'px' });
          Object.assign(shot.querySelector('.shot-f').style, { width: cw + 'px', height: ch + 'px' });
          Object.assign(f.style, { width: W() + 'px', height: H() + 'px', transform: 'scale(' + k + ')' });
          try { f.contentWindow.postMessage({ smp: 1, uiScale: 1 / k }, location.origin); } catch (e) { /* ignore */ }
        });
        const wd = PAD.l + g.cols * (cw + GX) - GX + PAD.r, ht = PAD.t + g.rows * (ch + HEAD + LANE + GY) - GY + PAD.b;
        grid.style.width = wd + 'px'; grid.style.height = ht + 'px';
        svg.setAttribute('width', wd); svg.setAttribute('height', ht); svg.setAttribute('viewBox', '0 0 ' + wd + ' ' + ht);
        const mid = n => y(n.row) + LANE + HEAD + ch / 2;
        // A connector: a line from one screen to the next and a solid head of
        // the same colour, its tip just short of the next screen. Lines always
        // arrive horizontally, so the head points right. The current journey's
        // path is drawn last, on top.
        const HL = 10, HW = 6;   // head length and half width
        const edges = g.edges.map(e => {
          const a = shots.get(e.from).n, b = shots.get(e.to).n;
          const x1 = x(a.col) + cw + 8, y1 = mid(a), tip = x(b.col) - 8, y2 = mid(b), x2 = tip - HL + 1;
          const d = y1 === y2 ? 'M' + x1 + ' ' + y1 + 'H' + x2 : 'M' + x1 + ' ' + y1 + 'C' + (x1 + GX * 0.55) + ' ' + y1 + ' ' + (x2 - GX * 0.55) + ' ' + y2 + ' ' + x2 + ' ' + y2;
          const head = 'M' + tip + ' ' + y2 + 'L' + (tip - HL) + ' ' + (y2 - HW) + 'Q' + (tip - HL + 2) + ' ' + y2 + ' ' + (tip - HL) + ' ' + (y2 + HW) + 'Z';
          const on = e.journeys.includes(state.journey);
          return { on, svg: '<g class="' + (on ? 'on' : '') + '"><path class="ln" d="' + d + '"/><path class="hd" d="' + head + '"/></g>' };
        });
        svg.innerHTML = edges.filter(e => !e.on).concat(edges.filter(e => e.on)).map(e => e.svg).join('');
      }
      return st;
    }
    // Open a screen from the all-journeys storyboard: that journey, at that step.
    function openAt(journey, step) {
      if (journey === state.journey) { if (step === null) setView('single'); else openStep(step); return; }
      store.set('bopen', { journey, step, t: Date.now() }, sessionStorage);
      store.set('view', 'single', sessionStorage);
      go(journey, {});
    }
    // After the reload openAt caused: replay up to the step.
    function resumeOpen() {
      const p = store.get('bopen', sessionStorage);
      if (!p) return;
      store.set('bopen', null, sessionStorage);
      if (p.journey !== state.journey || Date.now() - p.t > 30000 || p.step === null) return;
      if (p.step < steps().length) openStep(p.step);
    }

    // Open one step of the journey on the page itself.
    function openStep(i) {
      setView('single');
      if (i > 0) runner.seek(i); else runner.restart();
    }

    // Compare default: the version before this one on the left, this one on the right.
    function cmpPair() {
      const its = config.iterations || [];
      const at = Math.max(0, its.indexOf(currentIteration()));
      const prevIt = its[at + 1] || its[at - 1] || its[0];
      cmp.left = its.some(i => i.id === cmp.left) ? cmp.left : prevIt.id;
      cmp.right = its.some(i => i.id === cmp.right) ? cmp.right : its[at].id;
      store.set('cmp', cmp, sessionStorage);
      return [cmp.left, cmp.right];
    }
    function setView(v) {
      view = v; store.set('view', v, sessionStorage);
      if (v !== 'single' && runner.active) runner.exit();
      render(true);
    }

    /* Export video: replay the journey from step 1 and record it, without
       any of our controls. The prototype runs in panes (one, or two in
       compare view) so page loads inside the journey don't stop the
       recording. Uses the browser's own tab capture: one permission prompt. */
    const recordable = () => config.journeys.filter(j => stepsOf(j).length);
    function videoDefaults() {
      const its = config.iterations || [], cur = currentIteration();
      return {
        all: false,
        version: view === 'compare' && its.length > 1 ? 'compare' : (cur && cur.id) || '',
      };
    }
    // Before recording: one journey or all of them, and which version.
    function videoDialog() {
      const o = vopt;
      const js = recordable(), its = config.iterations || [];
      const cur = config.journeys.find(j => j.id === state.journey) || {};
      const hasCur = stepsOf(cur).length > 0;
      if (!hasCur) o.all = true;
      const radio = (on, name, title, sub, fn) => h('button', { class: 'opt', role: 'radio', 'aria-checked': String(on), 'data-control': name, onclick: () => { fn(); render(); } },
        h('i'), h('span', null, h('b', null, title), sub ? h('span', null, sub) : null));
      const card = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export journey as MP4' },
        h('h2', null, 'Export journey as MP4'),
        h('p', { class: 'lead' }, 'Replays the journey from step 1 and records it, without the Super Artifact Manager UI. Your browser asks which tab to record: pick this one. Esc stops.'));
      if (js.length > 1 || !hasCur) {
        card.append(h('div', { class: 'fl' }, 'Journeys'), h('div', { role: 'radiogroup', 'aria-label': 'Journeys' },
          hasCur ? radio(!o.all, 'video-this', 'This journey', (cur.label || cur.id) + ' · ' + stepsOf(cur).length + ' steps', () => { o.all = false; }) : null,
          radio(o.all, 'video-all', 'All journeys', js.length + ' journeys, one after the other, in one video', () => { o.all = true; })));
      }
      if (its.length) {
        const opts = its.map(it => [it.id, it.label || it.id]);
        if (its.length > 1) { const [l, r] = cmpPair(); const lb = id => { const it = its.find(x => x.id === id); return it.label || it.id; }; opts.push(['compare', 'Compare: ' + lb(l) + ' and ' + lb(r) + ', side by side']); }
        card.append(field('Version', opts, o.version, v => { o.version = v; render(); }, 'video-version'));
      }
      card.append(h('div', { class: 'acts' },
        h('button', { class: 'pb', 'data-control': 'video-cancel', onclick: () => { vopt = null; render(); } }, 'Cancel'),
        h('button', { class: 'cta', 'data-control': 'video-record', onclick: () => {
          const versions = o.version === 'compare' ? cmpPair() : o.version ? [o.version] : null;
          const journeys = o.all ? js.map(j => j.id) : [state.journey];
          vopt = null; render();
          exportVideo({ journeys, versions });
        } }, h('span', { html: ICON_VIDEO }), 'Record')));
      return h('div', { class: 'scrim', onclick: e => { if (e.target === e.currentTarget) { vopt = null; render(); } } }, card);
    }
    const pause = ms => new Promise(r => setTimeout(r, ms));
    async function until(fn, ms) { const end = Date.now() + ms; while (!fn() && Date.now() < end) await pause(150); return fn(); }
    function pickMime() {
      const R = window.MediaRecorder;
      if (!R || !R.isTypeSupported) return '';
      return ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => R.isTypeSupported(t)) || '';
    }
    async function exportVideo(opt) {
      opt = opt || { journeys: [state.journey], versions: null };
      const list = opt.journeys.filter(id => stepsOf(config.journeys.find(j => j.id === id)).length);
      if (rec || !list.length) return;
      let stream;
      try {
        stream = window.SM_PROTO_CAPTURE ? await window.SM_PROTO_CAPTURE()
          : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' });
      } catch (e) { toast('Recording needs permission to capture this tab'); return; }
      if (runner.active) runner.exit();
      conducting = false; conductToken++;
      const multi = list.length > 1;
      rec = { stream, chunks: [], cancelled: false, versions: opt.versions, journey: list[0], all: multi, compare: !!(opt.versions && opt.versions.length > 1) };
      open = false; cOpen = false; menu = false; shareOpen = null;
      const track = stream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', () => cancelExport());
      const startRecorder = () => {
        const mime = pickMime();
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : {});
        rec.recorder = recorder; rec.mime = recorder.mimeType || mime || 'video/webm';
        recorder.ondataavailable = e => { if (e.data && e.data.size) rec && rec.chunks.push(e.data); };
        recorder.start(250);
      };
      for (let i = 0; i < list.length; i++) {
        const j = config.journeys.find(x => x.id === list[i]);
        rec.journey = j.id;
        // All journeys: a title card between them, while the next one loads.
        rec.slate = multi ? { k: 'Journey ' + (i + 1) + ' of ' + list.length, t: j.label || j.id, d: j.description || '' } : null;
        render(true);
        const shown = Date.now();
        if (multi && !rec.recorder) { await pause(300); startRecorder(); }
        // Fresh panes, every one on step 1 and ready.
        const ready = await until(() => rec && frames.length && frames.every(f => { const r = frameRuns.get(f.contentWindow); return r && r.active && r.idx === 0 && !r.seeking; }), 30000);
        if (!rec || rec.cancelled) return;
        if (!ready) { finishExport(!!rec.chunks.length); toast('“' + (j.label || j.id) + '” didn’t start, recording stopped'); return; }
        if (multi) { await pause(Math.max(0, 1800 - (Date.now() - shown))); rec.slate = null; render(); await pause(600); }
        else { await pause(900); startRecorder(); await pause(700); }
        if (!rec || rec.cancelled) return;
        await conduct();
        if (!rec || rec.cancelled) return;
        await pause(1500);
      }
      finishExport(true);
    }
    function finishExport(save) {
      const r = rec;
      if (!r) return;
      const done = () => {
        r.stream.getTracks().forEach(t => t.stop());
        rec = null;
        store.set('journey', journeyId); store.set('overrides', overrides); writeCookie();
        conducting = false; conductToken++;
        render(true);
        if (!save) return;
        const mp4 = /mp4/.test(r.mime);
        const blob = new Blob(r.chunks, { type: mp4 ? 'video/mp4' : 'video/webm' });
        const cur = currentIteration();
        const one = r.versions && r.versions.length === 1 && (!cur || r.versions[0] !== cur.id) ? r.versions[0] : '';
        const name = [config.id || 'prototype', r.all ? 'all-journeys' : r.journey, r.compare ? 'compare' : one].filter(Boolean).join('-') + (mp4 ? '.mp4' : '.webm');
        const a = h('a', { href: URL.createObjectURL(blob), download: name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        toast(mp4 ? 'Video saved' : 'Video saved as WebM (this browser can’t record MP4)');
      };
      if (r.recorder && r.recorder.state !== 'inactive') { r.recorder.onstop = done; r.recorder.stop(); } else done();
    }
    function cancelExport() {
      if (!rec || rec.cancelled) return;
      rec.cancelled = true;
      finishExport(false);
      toast('Recording cancelled');
    }

    function render(restage) {
      const keepStage = !restage && shadow.querySelector('.stage');
      root.className = 'root' + (rec ? ' rec' : '') + (bare && !rec ? ' bare' : '');
      // Toasts outlive a render (they remove themselves).
      [...root.children].forEach(c => { if (!(keepStage && c.classList.contains('stage')) && !c.classList.contains('toast')) c.remove(); });
      if (stageOn()) { const old = shadow.querySelector('.stage'); const st = stage(); if (old && old !== st) old.remove(); if (!st.isConnected) root.prepend(st); st.classList.toggle('commenting', !!(ann && ann.commenting)); }
      else { frames = []; stageKey = ''; }
      if (!stageOn() && runner.offPage()) root.append(h('div', { class: 'warn', role: 'status' }, h('span', null, h('b', null, 'This page isn’t part of the journey. ')), h('button', { class: 'lk', onclick: () => runner.backToStep() }, 'Back to step ' + (runner.state.idx + 1))));
      if (!stageOn() && runner.state.lost) root.append(h('div', { class: 'warn', role: 'status' }, h('span', null, h('b', null, 'Can’t find step ' + (runner.state.idx + 1) + ' on this page. ')), h('button', { class: 'lk', onclick: () => runner.restart() }, 'Restart')));
      root.append(drawer(), commentsPanel(), bar());
      if (menu) root.append(moreMenu());
      if (vopt && !rec) root.append(videoDialog());
      if (composing && boardOn()) { const cz = composer(); if (cz) root.append(cz); } else if (composing) finishCompose('');
      placeCs();
      // A thread open in the sidebar puts its pin in the spotlight on the page.
      { const a = A(); const id = cOpen && thread && cmode !== 'cards' ? thread : null; if (a && a.spotlight && id !== lastSpot) { lastSpot = id; a.spotlight(id); } }
      if (rec && rec.slate) root.append(h('div', { class: 'slate', 'data-control': 'slate' }, h('span', null, rec.slate.k), h('b', null, rec.slate.t), rec.slate.d ? h('p', null, rec.slate.d) : null));
    }

    document.addEventListener('keydown', e => {
      const t = e.composedPath()[0];
      if (e.code === 'Backslash' && (e.metaKey || e.ctrlKey) && !e.altKey && !rec) { e.preventDefault(); toggleBare(); return; }
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'KeyC' || e.code === 'KeyE') && commentsCfg) {
        const a = A();
        if (a && ann && ann.count) { e.preventDefault(); if (e.code === 'KeyC') a.copy(); else a.exportMarkdown(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); toggle(); }
      else if (e.key === 'Escape' && rec) { e.preventDefault(); cancelExport(); }
      else if (e.key === 'Escape' && csOpen) closeCs();
      else if (e.key === 'Escape') { if (vopt) { vopt = null; render(); } else if (shareOpen) { shareOpen = null; render(); } else if (thread && cOpen) { thread = null; render(); } else if (menu) { menu = false; render(); } else if (open) toggle(false); else if (cOpen) toggleComments(false); }
    });
    document.addEventListener('pointerdown', e => {
      const path = e.composedPath();
      if (menu && !path.includes(host)) { menu = false; render(); }
      // An open list closes on a click anywhere else (without a render inside our UI, as below).
      const inCs = path.some(n => n.classList && (n.classList.contains('csl') || n.classList.contains('csb')));
      if (csOpen && !inCs) closeCs();
      // A click anywhere but the dropdown (or its button) closes Share.
      // Inside our UI, hide it without a render: a render now would replace the
      // button under the pointer and swallow its click.
      if (shareOpen && !inCs && !path.some(n => n.classList && n.classList.contains('shw'))) {
        shareOpen = null;
        if (path.includes(host)) shadow.querySelectorAll('.shw .dd').forEach(d => { d.style.display = 'none'; }); else render();
      }
    }, true);
    // Single-page apps change the URL without a load: keep the off-journey note honest.
    let lastHref = location.href;
    setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; later(); } }, 500);

    if (hidden) root.style.display = 'none';
    render();
    return { render, toggle, host };
  }

  // Mount after load: frameworks that hydrate the server HTML (Next, Remix)
  // are done by then, so the UI never shows up as a hydration mismatch.
  // SMProto itself is ready immediately.
  function boot() {
    runner = makeRunner();
    if (inFrame) { bridgeChild(); runner.resume(); return; }
    ui = mount();
    // In compare / device view the frames run the journey; this page doesn't.
    if (!(ui && ui.host && (['compare', 'board'].includes(store.get('view', sessionStorage)) || deviceSize().width))) runner.resume();
  }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})(typeof window !== 'undefined' ? window : globalThis);
