---
name: artifact-manager
description: Super Artifact Manager. Add a control panel to any prototype, document or presentation so anyone demoing or building can walk through every journey it supports, not just the happy path. A journey says who you are (role), what state the data is in (mock data set), which feature flags are on, what fails (payment declined, API timeout, empty search) and how the network behaves (slow, offline, region). One click switches journeys, links carry the journey, and earlier iterations of the prototype are one dropdown away. Optional access gate in front of the deployed prototype, picked per prototype - no password, a simple shared password, or Sign in with Microsoft (Entra ID, set up later). Documents and decks get pages or slides, a storyboard, versions and the same comments. Use when asked to add a control panel, comments or review to a prototype, document or deck, scenarios, journeys, mock data switching, feature flags, error states, roles, or a password or SSO gate to a prototype. Triggers on "/artifact-manager", "artifact manager", "control panel for the prototype", "switch journeys", "simulate every state", "gate the prototype".
---

# Super Artifact Manager

Super Artifact Manager works on prototypes, documents and presentations.

A prototype usually shows one story: one role, one data set, everything working.
The real product supports many more. This skill wraps a prototype in a small
engine (the way `/superslides` wraps a deck) so every story is defined once and
switched in one click.

- **`control-panel.js`**: one dependency-free file. It exposes `window.SMProto`
  to the prototype, answers or breaks the prototype's `fetch`/XHR calls
  according to the active journey, and draws the controls:
  - **Bottom bar**: drawer toggle (left), `3 of 17 steps`, previous /
    play / next (at the end Play turns into Replay, and a "Journey ended" toast
    shows), **Comment** (primary), `…`, and the Comments toggle (right, with
    the comment count). It stays in the middle; open sidebars slide over it.
    `…` holds the Share actions (Copy link, Copy all comments ⌥C, Export
    comments as .MD ⌥E, Export journey as MP4), playback speed and **Show
    cursor highlight** (prototypes only), and **Show Super Artifact Manager UI**
    (`⌘\` / `Ctrl \` hides and brings back every control, for presenting).
  - **Comments**: in the **Sidebar** (default) or **Floating** (a card opens
    next to the pin you click). The Comments header has the other commenters,
    you (click to set your name and avatar) and a `…` with Comments UI
    (Sidebar / Floating), Show comment pins (`P`) and Clear comments. In
    Floating mode the bar's right button is a comment icon with the same
    options. Every comment card, in the list, the thread or floating, has a
    `…` with **Copy link** (opens that version, journey, step and comment) and
    **Archive**.
  - **Left drawer** (`J`): close, name, Share; metadata (Status, which reviewers
    can change, last updated, workspace / project, owner, any `meta`); **Versioning** (Single view, or
    Compare view with Left and Right versions side by side, or **Storyboard**:
    every step of the journey as its own screen on a dark canvas, titled "Step
    2 of 6 · Search for Ana", each the real prototype replayed up to that step;
    drag or scroll to pan, ⌘/Ctrl + scroll or the zoom pill to zoom, click a
    screen to open that step; Comment works there too: click the screen you
    mean, the comment carries its step. The bar switches between **This
    journey** and **All journeys**: a lane per journey, a column per step,
    screens journeys share drawn once, arrows between screens, a lane that
    branches starting under the screen it parts from, the current journey's
    path lit; click any screen to open that journey at that step); **Journey** (a
    searchable picker grouped by category, showing the step count) with
    **Parameters** below it; **Device** last (Responsive is the window itself;
    Laptop, Desktop HD, Tablet, Tablet landscape, Mobile, Mobile large, Mobile
    small, Android frame the prototype at that size; **Custom** takes a width
    and height, with a rotate button). A device is a view: switching never
    reloads, and it doesn't count as a modified parameter.
    Device frames, compare and the storyboard share one **zoom** control (top
    right): **Scale to Fit** by default, or 50%, 75% and 100% (− and + step
    between). A fixed zoom scrolls the pane; on Responsive, zooming out shows a
    wider viewport. Version labels sit right above their frame. Comments inside a
    frame keep annotate's desktop popovers on a desktop screen
    (`window.SM_ANNOTATE_COMPACT = false`).
  - **Export journey as MP4**: a dialog asks for this journey or **all
    journeys** (one video, a title card before each), and which **version**
    (any one, or two side by side). It replays from step 1 and records MP4
    (WebM where the browser can't), with none of the manager's controls in the
    shot: just the prototype, the journey's cursor and its step highlights.
    Chrome asks once to share the tab; Esc cancels. Built for quick shares.
  - **Comments sidebar** (right): every comment with author, time, replies, a
    picture of what it points at, and where it was left (version, journey, step,
    or page, section, slide); filters (version, people, status) and sort (open
    first, then latest); click to jump to it.
  - **Play**: a simulated cursor walks the journey's steps in the real
    prototype, highlights what it works on, and really clicks, types and
    selects. The arrows move one step: forward does the current step, back
    replays the journey from the start up to the step before, so the screen is
    always in the state that step expects.
- **`journeys.json`**: the journeys, written once per prototype.
- **`gate/middleware.js`**: optional access gate (Edge middleware, Web Crypto only).
- **`bin/add.js`**: adds all of the above to an existing prototype.

Canonical source: this folder. Copy files from here, never re-implement them.

## Documents and presentations

Not every artifact is a prototype. Set `"type"` in the config:

| `type` | Drawer | Bar | Comments are tagged with |
|---|---|---|---|
| `prototype` (default) | Single, Compare, Storyboard; Versioning; Journey and Parameters; Device | Journey steps: back, play, next | Version, journey, step, element |
| `document` | Single, Compare, Storyboard (paginated only); Versioning; Device | Pages: back, "Page 3 of 12", next (← →); a continuous document: "Section 3 of 8" | Version, page (paginated), the heading the element sits under ("1.5 Lorem ipsum"), element, quoted text |
| `presentation` | Single, Compare, Storyboard; Versioning; Device | Slides: back, "Slide 3 of 12", next (← →) | Version, slide and its title, element, quoted text |

Documents come paginated or continuous, and both work. Paginated: pages are
`.page` or `[data-page]` elements; they sit on the same dark dotted canvas as
the storyboard (`"canvas": false` keeps the page's own background; decks sit on it too), and the
Storyboard shows every page as its own screen. Continuous: no page elements,
so the bar steps through the `h1` and `h2` headings as sections, and there is
no storyboard. Slides are `.slide` or `[data-slide]` (a deck), with a
storyboard of every slide. A deck shows one slide at a time, like a
presentation: back and next (or the arrow keys, Page Up / Down, Space) slide
the next one in sideways, nothing scrolls, and a comment picked in the panel
brings its slide back. `"deck": false` keeps the slides scrolling instead.
The slides need to share one parent for this. `"pages": { "selector": "..." }` changes either
selector. Headings that don't carry a number are numbered as an outline (h2,
h3). In compare, both versions page together. No journeys, steps or video
export. Compare and device views also sit on the dotted canvas.

```json
{ "id": "approval-rules", "type": "document", "name": "Approval rules", "comments": true,
  "iterations": [{ "id": "v2", "url": "index.html", "status": "review" }, { "id": "v1", "url": "v1.html", "status": "closed" }] }
```

Examples: `examples/document/` and `examples/presentation/`.

## Comments from agents

Agents comment too. An agent (Claude Code, or any script) leaves a comment the same
way a person would, pointing at the same things, and it shows with the agent's
avatar and an **Agent** badge. Turn it on with
`"comments": { "file": "comments.json" }` in the config (with `"live": true` too,
for a live room).

**From the command line** (no browser needed), from the artifact's folder:

```bash
node artifact-manager/bin/comment.js path/to/artifact \
  --page index.html --selector "#sum" --quote "2045 €" \
  --text "Say whether this total is pending or approved." \
  --link "MDN: Intl.NumberFormat|https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat" \
  --version v2 --journey approver-happy --step 1
node artifact-manager/bin/comment.js path/to/artifact --reply-to <id> --text "Fixed in v3."
node artifact-manager/bin/comment.js path/to/artifact --list
```

- What it points at: `--selector` (an element), plus `--quote` (words inside it),
  `--point x,y` or `--area x,y,w,h` (fractions of that element's box). Without a
  point or an area, the pin goes on the element's corner.
- Without `--author` the comment is from Claude Code (`--agent claude-code`).
  `--author "Sam Rivera"` writes a person's comment.
- `--link "Label|https://..."` repeats. Links show as badges under the comment; URLs
  in the text show as the same badges. Only http(s) links are kept.
- It prints the new id. The file merges into the page by id, so it can keep
  growing; replies an agent adds later show up in the thread.

**From a browser** (an agent driving Playwright, for example):
`SMAnnotate.add({ comment, selector, quote | point | area, links, agent })` returns
the new id, and `SMAnnotate.add({ replyTo: id, comment })` replies. In a live room
these go to everyone, like any comment.

**comments.json** is `{ "comments": [ ... ] }`. Each comment: `id`, `page`
(`index.html`, `v1.html`), `comment`, `agent` or `author`, `selector`, `quote`,
`point` or `area`, `links`, `replies`, `resolved`, `createdAt`, and optionally
`version`, `journey`, `step`. Someone who deletes a comment from the file doesn't
get it back on the next load.

Other agents: `window.SM_ANNOTATE_AGENTS = { "my-agent": { "name": "My agent",
"avatar": "data:image/svg+xml;base64,..." } }` before the annotator loads, then
`--agent my-agent`.

In a live room, comments from the file are read from the file by everyone who opens
the page; replies to them stay in the reviewer's browser. Comments added through
`SMAnnotate.add` are real room comments.

## What a journey controls

| Dimension | In `journeys.json` | The prototype sees |
|---|---|---|
| **Who you are** | `roles`, journey `role` | `SMProto.role`, `SMProto.user`, `SMProto.is('approver')` |
| **Data state** | `datasets` (folders of mock `.json` or `.md` files), journey `data` | Its normal API calls answered from that folder via `routes`, or `await SMProto.data('requests')` |
| **Feature flags** | `flags`, journey `flags` | `SMProto.flag('quickApprove')` |
| **What fails** | `failures` (named, matched by method + URL), journey `failures` | The real request comes back 402 / 504 / empty / network error |
| **Infra** | `network` to show the controls (`true`, or `{ "latencies": [0, 2000], "offline": false }`), journey `network` (`latencyMs`, `offline`), `region` | Every request is slowed or fails; `SMProto.region`. Latency and Offline only appear when `network` is set or a journey uses it. |
| **Steps** | journey `steps`: a list, or the name of a shared flow in `flows` | Play, previous and next walk them with the simulated cursor (see [Steps](#steps-and-playback)) |
| **Parameters** | `parameters`: named macros, each option sets several dimensions at once (`{ "label": "Payment method", "options": { "stored": { "label": "Already stored", "set": { "flags": {…}, "failures": [] } } } }`); journey `params` | Dropdowns under the Journey, the prototype's own first; `SMProto.param('payment')` |
| **Base parameters** | always there: **Device** (Desktop, Tablet, Mobile; `devices` to change), **Latency** (`network.latencies`), **Network** (online / offline) | Mobile and tablet render the prototype in a device-sized frame |
| **Header** | `owner`, `workspace`, `project`, `meta` (any key/values), `updated` (or per iteration) | The metadata grid under the name |
| **Categories** | journey `category` | The journey picker groups and filters by it |
| **Version** | `iterations` (`[{id, label, description, url, keepPath, status}]`). `keepPath: true` when the version is another copy of the same app (another port or deployment), so the same screen opens there. `status`: `draft`, `review` (Open for review), `changes` (Changes requested), `approved` or `closed`; anything else shows as written, `statusLabel` renames it. Shown as the Status field at the top of the drawer, in the version picker and in compare. Reviewers can change it from the drawer (it sticks in their browser and fires a `smp:status` event, `{ version, status }`, for a host that saves it for everyone); `"statusEditable": false` makes it read only. A `closed` version takes no new comments or replies. | Opens that version with the same journey |
| **Comments** | `"comments": true` (single-player) or `"comments": { "live": true }` (live multiplayer through your own Super Annotator relay: `"url": "wss://<your-relay>/sync"` is required, one room per version, `room` overrides) | `/annotate` runs embedded: its own toolbar and bubble hide; Comment sits in the bar, the list in the Comments panel, copy and export under Share. Show pinned comments only hides pins and cards; Comment always works (and shows them again). In compare view Comment turns on in both versions: click the side you mean, the list labels each comment with its version. |

Journeys only list what differs from `defaults`. Parameters below the Journey
change any dimension on top of the active journey: the prototype's own
parameters, then role (`labels.role` renames it, e.g. "Persona"), data, region,
one dropdown per flag, Errors (one failure at a time), then the base Device,
Latency and Network. Share carries the changes (`?journey=…&pm=…`). **Reset**
sits at the bottom: "Reset to journey" drops your changes, then "Reset to
default" goes back to the default journey; greyed out when there is nothing to
reset.

Don't make a journey that only repeats an older version (a flag off that equals
v1): that belongs in `iterations`, so each question lives in one section.
While commenting, Comment becomes a red "Stop commenting" (Esc works too). Add `panel=0` to a link for clean screen recordings and client demos. `J`
still opens the panel there.

## Workflow

### 1. Ask how the prototype is accessed

Ask once per prototype with `AskUserQuestion`, unless the user already said.
Recommend the first option for internal reviews.

| Option | What happens | Setup |
|---|---|---|
| **Simple password** (recommended) | One shared password on a sign-in page in front of everything, data included. | `bin/add.js --gate password` prints the password once and the env vars for Vercel. Share the password with your reviewers. |
| **Microsoft SSO** | "Sign in with Microsoft" with your organisation's work account. Entra ID is set up later: until it is, the gate runs on a password so the prototype isn't blocked. | `--gate sso`. Then [Microsoft SSO setup](#microsoft-sso-setup), when a tenant admin can register the app. |
| **No password** | No gate. Anyone with the link sees it. | `--gate none` (default). Only for prototypes with nothing confidential. |

Never pick "No password" for anything with client data or client names. When
unsure, ask; don't default to open.

### 2. Add it

```bash
node artifact-manager/bin/add.js <prototype dir> --gate password --name "Expenses"
```

- **Static / plain HTML**: it copies `control-panel.js` next to the pages and puts
  `<script src="control-panel.js" data-config="journeys.json"></script>` right after
  `<meta charset>` in each page's `<head>`. It must load before the prototype's own
  scripts; it reads `journeys.json` synchronously so `SMProto` is ready when they run.
- **Next.js**: it copies into `public/` and prints the `<script>` line for
  `app/layout.tsx`. Server components and route handlers read the active journey
  from the `sm-proto` cookie:
  `JSON.parse(Buffer.from(cookies().get('sm-proto')!.value, 'base64url').toString())`.
  Set `"serverRendered": true` in `journeys.json` when the server uses it: a pasted
  journey link then reloads once so the server render and the panel agree. Make
  those pages dynamic (no `generateStaticParams`), and set `devIndicators: false`
  in `next.config` so the Next badge doesn't sit on the panel.
- It writes a starter `journeys.json` and `mocks/default`, `mocks/empty`. It never
  overwrites an existing `journeys.json`, and it never writes a secret into the project.

### 3. Write the journeys

Read the prototype first: its roles, entities, API calls, empty states, error
handling. Then write `journeys.json`, starting from `examples/expenses/journeys.json`.
Aim for 5 to 10 journeys that each prove one thing:

1. The happy path (the default demo).
2. Each role that sees something different.
3. Empty data (first day) and heavy data (power user, hundreds of rows).
4. Each feature flag the team is deciding on.
5. One journey per failure the product must handle: a declined payment, a slow or
   timed-out upstream, no search results, offline.
6. Infra conditions that change behaviour: slow network, another region.

Mock data lives in files, one folder per data set (`mocks/<set>/<name>.json`, or
`.md` with the data in a `json` code block so a mock reads like a document). Set
`"format": "md"` on a data set that only has `.md` files.

**Routes** let the prototype keep calling its own API. The panel answers from the
active data set before the request leaves the browser:

```json
"routes": [
  { "method": "GET",  "match": "re:^/api/requests/[^/]+$", "data": "requests", "byId": true },
  { "method": "GET",  "match": "/api/requests", "data": "requests" },
  { "method": "GET",  "match": "/api/search",   "data": "requests", "search": "q" },
  { "method": "POST", "match": "/api/payouts",  "respond": { "ok": true } }
]
```

**Failures** are named once and reused by journeys:

```json
"failures": {
  "payoutDeclined":  { "label": "Payout declined", "method": "POST", "match": "/api/payouts", "status": 402, "body": { "error": "card_declined" } },
  "requestsTimeout": { "label": "Requests API times out", "match": "/api/requests", "timeout": true, "timeoutMs": 6000 },
  "searchEmpty":     { "label": "Search finds nothing", "match": "/api/search", "status": 200, "body": [] },
  "authDown":        { "label": "Auth service down", "match": "/api/auth", "networkError": true }
}
```

`match`: `"/api/x"` is that path and everything under it, `"re:^/api/x/\\d+$"` is a
regex on path + query, anything else is a substring of the full URL (third-party
calls like `"api.stripe.com"`). The first matching route answers, so put the specific ones first. Failures win over routes; routes win over the network.

### 3b. Write the steps

Give the journeys that tell a story `steps` (5 to 15). Put shared ones in
`flows` and point journeys at them by name, so "Merge blocked by CI" replays the
same steps as the happy path and only the outcome changes.

```json
"flows": {
  "merge": [
    { "title": "The review queue", "path": "/", "target": "#title", "action": "look" },
    { "title": "Search for billing", "target": "#q", "action": "type", "text": "billing" },
    { "title": "Review the migration", "target": "text:Review" },
    { "title": "Approve and merge", "target": "#dlg-ok" },
    { "title": "What the reviewer sees", "target": "#banner .banner", "action": "look", "ms": 1800 }
  ]
},
"journeys": [{ "id": "merge-blocked", "category": "Reviewing", "steps": "merge", "failures": ["mergeBlocked"] }]
```

In the storyboard's **All journeys** view, journeys share screens while they
are the same so far (same steps and the same role, data, region, flags,
failures and network) and fork where they part. A journey that only differs
later says where it branches, so its earlier screens are drawn once:

```json
{ "id": "payout-declined", "steps": "approve", "failures": ["payoutDeclined"],
  "branch": { "from": "approver-happy", "step": 5 } }
```

Its steps before `step` must match the other journey's (it parts at the first
that doesn't). Write `branch` for every journey that is a variation on another
one: a failure that only shows late, a flag that only changes the last screen.

- `target`: a CSS selector, or `text:Label` (a button, link, tab, option or
  heading by its text; an open dialog is searched first).
- `action`: `click` (default), `type` (`text`), `select` (`value`), `press`
  (`key`), `look` (point at it), `hover`.
- `path`: the page the step happens on. The runner opens it when needed, and a
  reviewer who wanders off it sees "This page isn't part of the journey" with a
  way back.
- `ms`: how long to dwell before acting (default 1.1s, divided by the speed).
- The runner fires real pointer, mouse and input events, so React, Radix and
  native `<dialog>` all respond. The cursor stays above native modals.
- `?journey=x&pmstep=3` opens a link on step 3. Comments left during a run are
  tagged with the step.

### 3c. Comments: single-player or live

Ask once, like the access question. Single-player (`"comments": true`) keeps
notes in each reviewer's browser and exports Markdown. Live
(`"comments": { "live": true }`) puts everyone in one room per version through a
[Super Annotator relay](https://github.com/SupermodularAI/super-annotator) you
run yourself (Node, or your own Cloudflare account): set
`"comments": { "live": true, "url": "wss://<your-relay>/sync" }`. Comments,
replies and resolves land for everyone at once, with "N here". Allow the
prototype's origin in the relay's `ALLOWED_ORIGINS`.

### 4. Make the prototype read the journey

Keep the prototype ignorant of the panel where possible: routes and failures act on
its normal requests. Where it must branch, read `SMProto`:

```js
const P = window.SMProto;
P.user.name; P.role; P.is('approver'); P.flag('quickApprove'); P.region;
const rows = await P.data('requests');          // straight from the active data set
P.on('change', (state, prev) => rerender());    // only with "reload": false
```

Switching a journey reloads the page by default, so app state always starts clean.
Set `"reload": false` in the config to switch in place and handle `on('change')`.

### 5. Check it

```bash
cd artifact-manager
node bin/serve.js <prototype dir>                 # local server; add PROTO_GATE=password … to try the gate
npm test && npx playwright test --config playwright.config.cjs   # the skill's own tests
```

Click through every journey once. Each should show what its description promises,
and each failure should land in a designed error state, not a blank page. If a
failure shows nothing, that's a finding for the prototype, not for the panel.

### 6. Deploy

Deploy as the prototype normally deploys (for example Vercel; never without the
user's approval). Set the env vars `bin/add.js` printed on the Vercel project first, then
deploy, then open the URL in a private window to see the gate. Keep the URL and the
password wherever your team tracks prototypes.

## Microsoft SSO setup

Optional, and later. Entra ID proves the person holds a work account in your
organisation, single-tenant, OIDC code flow with
PKCE, state and nonce in a signed 10-minute cookie, `id_token` verified against
Microsoft's keys, and a domain check (`PROTO_ALLOWED_DOMAIN`, for example `example.com`) that refuses
guest accounts in your tenant. Set it or `PROTO_ALLOWED_EMAILS`: with neither,
nobody gets in.

1. A tenant admin registers a web app in Entra ID,
   single tenant, or adds a redirect URI to an existing one:
   `https://<prototype domain>/__gate/microsoft/callback`
2. Set on the Vercel project: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`, `PROTO_ALLOWED_DOMAIN` (and `MICROSOFT_REDIRECT_URI` if the domain differs
   from the request origin). Redeploy.
3. The sign-in page now shows "Sign in with Microsoft" above the password. A human
   tests it in a real browser: conditional access blocks automated ones.
4. To make SSO the only way in, remove `PROTO_PASSWORD_HASH` and redeploy. Existing
   password sessions stop working at once.

Narrow access further with `PROTO_ALLOWED_EMAILS` (comma list).

## Gate reference

| Env var | Meaning |
|---|---|
| `PROTO_GATE` | `none`, `password` or `sso` |
| `PROTO_SESSION_SECRET` | 32+ random chars, signs sessions (HMAC-SHA256) |
| `PROTO_PASSWORD_HASH` | sha256 hex of the shared password |
| `PROTO_NAME` | Title on the sign-in page |
| `PROTO_SESSION_HOURS` | Session length, default 168 |
| `MICROSOFT_*`, `PROTO_ALLOWED_DOMAIN`, `PROTO_ALLOWED_EMAILS` | See above |

The gate runs before anything is served, so mock data and `journeys.json` are
protected too. `/__gate/logout` signs out. If the project already has a
middleware, merge by hand: call `gate(request)` first and return its response
when it gives one. A shared password is a light gate; use a long one, and SSO
for anything sensitive.

## Composes with

- **`/annotate`** runs embedded for comments (single-player or live). A shared
  review link can carry a journey and a step (`?journey=…&pmstep=3`) so every
  reviewer comments on the same state.
- **Screen recordings**: to film one journey per take, open `?journey=<id>&panel=0` and
  call `SMProto.play()`. The cursor and highlight stay visible with the panel
  hidden, so the take is the journey itself.

## Files

| Path | What it is |
|---|---|
| `control-panel.js` | Runtime + panel. Pure logic is exported for node tests. |
| `gate/middleware.js` | The access gate (Vercel Routing Middleware / Next.js middleware). |
| `bin/add.js` | Adds the manager (and optionally the gate) to a prototype. |
| `bin/serve.js` | Local static server, with the gate in front when `PROTO_GATE` is set. |
| `templates/journeys.template.json` | Starter config. |
| `examples/expenses/` | Expense-approval prototype with 9 journeys covering roles, data, flags, failures and infra, a v1 to switch to, and `/annotate` embedded. `npm run demo`, then open `/artifact-manager/examples/expenses/`. `examples/migrations/` is a repo-migration review app with the same kinds of journeys. |
| `control-panel.test.js`, `gate/gate.test.mjs`, `control-panel.spec.cjs` | Unit, gate (with a faked Microsoft) and browser tests. |
