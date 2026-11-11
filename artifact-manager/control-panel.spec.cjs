// Browser tests: Super Artifact Manager on the example prototype, and the gate
// in front of it. Run with: npx playwright test (servers start from the config).
const { test, expect } = require('@playwright/test');

const PORT = +process.env.PM_E2E_PORT || 4641;
const BASE = 'http://localhost:' + PORT + '/artifact-manager/examples/expenses/';
const ui = page => page.locator('#sm-proto-panel');
const ctl = (page, name) => ui(page).locator('[data-control="' + name + '"]');
// Our own dropdowns: open one, pick a value; or read its options.
const pick = async (page, name, v) => { await ctl(page, name).click(); await page.locator('#sm-proto-panel [data-cs-list="' + name + '"] [data-value="' + v + '"]').click(); };
const optionsOf = async (page, name) => { await ctl(page, name).click(); return page.locator('#sm-proto-panel [data-cs-list="' + name + '"] [role=option]'); };
const rows = page => page.locator('main .row');
// The examples ship with comments (comments.json). Most tests start from none;
// the tests about those comments turn them back on.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { if (!window.__withFileComments) window.SM_ANNOTATE_SEED = false; }); });
const withFileComments = page => page.addInitScript(() => { window.__withFileComments = true; delete window.SM_ANNOTATE_SEED; });
const pickJourney = async (page, id) => {
  await ctl(page, 'journey').click();
  await ui(page).locator('[data-journey="' + id + '"]').click();
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  // Single-player comments in tests: the example is live, the relay isn't ours to test here.
  await page.addInitScript(() => { window.SM_PROTO_LIVE = false; });
});

test('default journey, bar with steps, drawer on J', async ({ page }) => {
  await page.goto(BASE);
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator('#uname')).toHaveText('Clara Voss');
  await expect(ctl(page, 'step-count')).toHaveText('1 of 6 steps');
  await expect(page.locator('html')).toHaveAttribute('data-sm-journey', 'approver-happy');
  await expect(ui(page).locator('#smp-panel')).toBeHidden();
  await page.keyboard.press('j');
  await expect(ui(page).locator('#smp-panel')).toBeVisible();
  await expect(ctl(page, 'journey')).toContainText('Approver, normal week');
  await expect(ctl(page, 'journey')).toContainText('6 steps');
  await expect(ui(page).locator('.meta')).toContainText('Sam Taylor');
});

test('journey picker: search, categories, one click to switch, remembered', async ({ page }) => {
  await page.goto(BASE);
  await page.keyboard.press('j');
  await ctl(page, 'journey').click();
  await expect(ui(page).locator('.chip')).toHaveText(['All', 'Approving', 'Requesting', 'Resilience']);
  await ui(page).locator('.chip', { hasText: 'Resilience' }).click();
  await expect(ui(page).locator('.jo')).toHaveCount(3);
  await ui(page).locator('.chip', { hasText: 'All' }).click();
  await ctl(page, 'journey-search').fill('own');
  await expect(ui(page).locator('.jo')).toHaveCount(1);
  await ui(page).locator('[data-journey="requester-own"]').click();
  await expect(page).toHaveURL(/journey=requester-own/);
  await expect(page.locator('#title')).toHaveText('My requests');
  await expect(rows(page)).toHaveCount(3);
  await page.goto(BASE);
  await expect(page.locator('#uname')).toHaveText('Ana Costa');
});

test('data sets: empty and 500 records', async ({ page }) => {
  await page.goto(BASE + '?journey=first-day');
  await expect(page.locator('.state b')).toHaveText('Nothing to approve');
  await page.goto(BASE + '?journey=power-user');
  await expect(page.locator('#pager')).toContainText('Page 1 of');
  await expect(rows(page)).toHaveCount(25);
});

test('feature flag: quick approve inline', async ({ page }) => {
  await page.goto(BASE + '?journey=quick-approve');
  await page.locator('main .row').first().locator('input').fill('ok');
  await page.locator('[data-approve]').first().click();
  await expect(page.locator('.banner.ok')).toContainText('Approved and paid out');
  await expect(rows(page)).toHaveCount(4);
});

test('failures: payout declined, search empty, API timeout', async ({ page }) => {
  await page.goto(BASE + '?journey=payout-declined');
  await page.locator('[data-review]').first().click();
  await page.locator('#dlg-ok').click();
  await expect(page.locator('.banner.bad')).toContainText('The company card was declined.');

  await page.goto(BASE + '?journey=no-results');
  await expect(rows(page)).toHaveCount(5); // the list itself still loads
  await page.fill('#q', 'Ana');
  await expect(page.locator('.state b')).toHaveText('No requests match "Ana"');

  await page.goto(BASE + '?journey=api-timeout');
  await expect(page.locator('.spin')).toBeVisible();
  await expect(page.locator('.state')).toContainText('took too long', { timeout: 9000 });
  await expect(page.locator('html')).toHaveAttribute('data-sm-journey', 'api-timeout');
});

test('infra: slow network and US region', async ({ page }) => {
  await page.goto(BASE + '?journey=slow-us');
  const t0 = Date.now();
  await expect(rows(page)).toHaveCount(5);
  expect(Date.now() - t0).toBeGreaterThan(1200);
  await expect(page.locator('#sum')).toContainText('$');
});

test('play: the cursor walks the journey, highlights, clicks and types for real', async ({ page }) => {
  await page.goto(BASE + '?journey=approver-happy');
  await page.evaluate(() => { localStorage.setItem('sm-proto:expenses-demo:speed', '2'); });
  await page.reload();
  await expect(rows(page)).toHaveCount(5);
  await ctl(page, 'play').click();
  await expect(ui(page).locator('.cursor.on')).toBeVisible();
  await expect(ui(page).locator('.ring.on .ring-l')).toContainText('The approval queue');
  await expect(page.locator('#q')).toHaveValue('Ana', { timeout: 8000 });
  await expect(page.locator('#dlg')).toHaveAttribute('open', '', { timeout: 8000 });
  await expect(page.locator('#dlg-note')).toHaveValue('Approved, thanks!', { timeout: 8000 });
  await expect(page.locator('.banner.ok')).toContainText('Approved and paid out', { timeout: 8000 });
  await expect(ctl(page, 'step-count')).toHaveText('6 of 6 steps', { timeout: 8000 });
  await expect(ui(page).locator('.toast')).toHaveText('Journey ended');
  // at the end Play turns into Replay, and there's no restart next to the count
  await expect(ctl(page, 'restart')).toHaveCount(0);
  await expect(ctl(page, 'play')).toHaveAttribute('aria-label', 'Replay journey');
  await ctl(page, 'play').click();
  await expect(ctl(page, 'play')).toHaveAttribute('aria-label', 'Pause', { timeout: 8000 });
  await expect(ctl(page, 'step-count')).toHaveText('1 of 6 steps');
});

test('storyboard: every step as its own screen on a canvas, titled, click one to open it', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await expect(rows(page)).toHaveCount(5);
  await page.keyboard.press('j');
  await ctl(page, 'view-board').click();
  const shots = ui(page).locator('.shot');
  await expect(shots).toHaveCount(6);
  await expect(shots.nth(0).locator('.shot-t')).toHaveText('Step 1 of 6The approval queue');
  await expect(ctl(page, 'board-this')).toHaveText('This journey · 6');
  await expect(ctl(page, 'board-this')).toHaveAttribute('aria-pressed', 'true');
  // each screen is the prototype replayed up to its step
  const shot = n => page.frameLocator('#sm-proto-panel >> .shot >> nth=' + n + ' >> iframe');
  await expect(shot(2).locator('#q')).toHaveValue('Ana', { timeout: 20000 });
  await expect(shot(4).locator('#dlg')).toHaveAttribute('open', '', { timeout: 20000 });
  await expect(shot(5).locator('.banner.ok')).toContainText('Approved and paid out', { timeout: 20000 });
  await expect(shot(0).locator('#q')).toHaveValue('');
  // zoom
  const w0 = (await ui(page).locator('.shot-f').first().boundingBox()).width;
  await ctl(page, 'zoom-in').click();
  expect((await ui(page).locator('.shot-f').first().boundingBox()).width).toBeGreaterThan(w0 * 1.2);
  // Comment stays in the storyboard: click inside a screen, the comment carries its step
  await ctl(page, 'comment').click();
  // no name yet: the panel asks for it, not a tiny screen
  await expect(ctl(page, 'name')).toBeFocused();
  await page.keyboard.type('Sam');
  // the bar sits under an open sidebar: close it from its own X
  await ui(page).locator('[aria-label="Close comments"]').click();
  await expect(ctl(page, 'stop-commenting')).toBeVisible();
  await expect(shots).toHaveCount(6);
  await shots.nth(2).scrollIntoViewIfNeeded();
  await expect(shot(2).locator('body')).toHaveClass(/annot-mode/);
  const t = await shot(2).locator('#title').boundingBox();
  await page.mouse.click(t.x + 8, t.y + 4);
  // the comment box opens here, at full size, not inside the scaled screen
  await expect(ctl(page, 'compose-text')).toBeFocused();
  await expect(shot(2).locator('.annot-popup')).toHaveCount(0);
  const cbox = await ui(page).locator('.cmpz').boundingBox();
  expect(cbox.width).toBeGreaterThan(330);
  await page.keyboard.type('Search box needs a label');
  await page.keyboard.press('Meta+Enter');
  await expect(ui(page).locator('.cmpz')).toHaveCount(0);
  await ctl(page, 'stop-commenting').click();
  // pins keep their size on screen at any zoom
  const pin = shot(2).locator('.annot-badge');
  await expect(pin).toHaveCount(1);
  await page.mouse.move(5, 5);   // the pin sits where you clicked: measure it un-hovered
  await page.waitForTimeout(300);
  const pw = (await pin.boundingBox()).height;
  expect(pw).toBeGreaterThan(17);
  await ctl(page, 'zoom-out').click();
  await expect.poll(async () => Math.round((await pin.boundingBox()).height)).toBe(Math.round(pw));
  // a pin opens its thread in the Comments panel
  const pb = await pin.boundingBox();
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await expect(ui(page).locator('#smp-comments .tv .tc p')).toHaveText('Search box needs a label');
  await ctl(page, 'thread-back').click();
  await ui(page).locator('[aria-label="Close comments"]').click();
  await expect(ui(page).locator('.stage.board')).toHaveCount(1);
  await expect(ctl(page, 'comments-panel').locator('.bd')).toHaveText('1');
  await ctl(page, 'comments-panel').click();
  const item = ui(page).locator('#smp-comments .cm');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.wh')).toContainText('Step 3');
  await ui(page).locator('[aria-label="Close comments"]').click();
  // click a screen: that step, on the page itself
  await page.keyboard.press('Escape');
  await shots.nth(2).locator('.shot-hit').click();
  await expect(ui(page).locator('.stage')).toHaveCount(0);
  await expect(ctl(page, 'step-count')).toHaveText('3 of 6 steps', { timeout: 15000 });
  await expect(page.locator('#q')).toHaveValue('Ana');
});

test('arrows: next does one step, previous replays up to the step before', async ({ page }) => {
  await page.goto(BASE + '?journey=approver-happy');
  await expect(rows(page)).toHaveCount(5);
  await expect(ctl(page, 'prev')).toBeDisabled();
  await ctl(page, 'next').click();                       // shows step 1
  await expect(ui(page).locator('.ring.on')).toBeVisible();
  await ctl(page, 'next').click();                       // does step 1, shows step 2
  await expect(ctl(page, 'step-count')).toHaveText('2 of 6 steps');
  await ctl(page, 'next').click();                       // types "Ana", shows step 3
  await expect(page.locator('#q')).toHaveValue('Ana');
  await expect(ctl(page, 'step-count')).toHaveText('3 of 6 steps');
  await ctl(page, 'prev').click();                       // fresh page, replays step 1 only
  await expect(ctl(page, 'step-count')).toHaveText('2 of 6 steps', { timeout: 8000 });
  await expect(page.locator('#q')).toHaveValue('');
  await expect(ui(page).locator('.ring.on .ring-l')).toContainText('Search for Ana');
});

test('speed lives in the … menu, 1.0x by default', async ({ page }) => {
  await page.goto(BASE);
  await ctl(page, 'more').click();
  await expect(ctl(page, 'speed-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(ui(page).locator('.menu [aria-label="Playback speed"] button')).toHaveText(['0.5x', '0.75x', '1.0x', '1.5x', '2.0x']);
  await ctl(page, 'speed-1.5').click();
  await expect(ctl(page, 'speed-1.5')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await ctl(page, 'more').click();
  await expect(ctl(page, 'speed-1.5')).toHaveAttribute('aria-pressed', 'true');
});

test('parameters: dropdowns, overrides travel in the link, reset always there', async ({ page, context }) => {
  await page.goto(BASE + '?journey=approver-happy');
  await page.keyboard.press('j');
  await ui(page).locator('summary').click();
  await expect(ui(page).locator('.pp .fl')).toHaveText(['Persona', 'Data', 'Region', 'Quick approve', 'Errors', 'Latency', 'Network']);
  await expect(ctl(page, 'reset')).toBeDisabled();
  await pick(page, 'offline', 'offline');
  await expect(page).toHaveURL(/pm=/);
  await expect(page.locator('.state')).toContainText('offline');
  await expect(ui(page).locator('.mod')).toHaveText('Modified');
  const shared = page.url();
  const other = await context.browser().newContext();
  const p2 = await other.newPage();
  await p2.addInitScript(() => { window.SM_PROTO_LIVE = false; });
  await p2.goto(shared);
  await expect(p2.locator('.state')).toContainText('offline');
  await other.close();
  await expect(ctl(page, 'reset')).toHaveAttribute('data-tip', 'Reset parameters');
  await ctl(page, 'reset').click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page).not.toHaveURL(/pm=/);
  await pickJourney(page, 'requester-own');
  await expect(ctl(page, 'reset')).toHaveAttribute('data-tip', 'Reset to default journey');
  await ctl(page, 'reset').click();
  await expect(page).toHaveURL(/journey=approver-happy/);
});

test('versioning: single view switches version, compare shows two side by side', async ({ page }) => {
  await page.goto(BASE + 'index.html?journey=requester-own');
  await page.keyboard.press('j');
  await ctl(page, 'view-compare').click();
  await expect(ui(page).locator('.stage iframe')).toHaveCount(2);
  await expect(ctl(page, 'version-left')).toHaveAttribute('data-value', 'v1');
  await expect(ctl(page, 'version-right')).toHaveAttribute('data-value', 'v2');
  const left = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=0');
  await expect(left.locator('#who')).toHaveText('Signed in as Ana Costa (requester)');
  const right = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=1');
  await expect(right.locator('#title')).toHaveText('My requests');
  await ctl(page, 'view-single').click();
  await expect(ui(page).locator('.stage')).toHaveCount(0);
  await pick(page, 'version', 'v1');
  await expect(page).toHaveURL(/v1\.html\?journey=requester-own/);
  await expect(page.locator('#t tr')).toHaveCount(3);
});

test('compare view: panes never start playing on their own', async ({ page }) => {
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await expect(rows(page)).toHaveCount(5);
  await ctl(page, 'play').click();                 // playing in single view…
  await expect(ui(page).locator('.ring.on')).toBeVisible();
  // …and the page reloads with compare view on while that run is still saved as playing
  await page.evaluate(() => sessionStorage.setItem('sm-proto:expenses-demo:view', JSON.stringify('compare')));
  await page.reload();
  const right = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=1');
  await expect(right.locator('main .row')).toHaveCount(5);
  await page.waitForTimeout(6000);
  await expect(right.locator('#q')).toHaveValue('');
  await expect(right.locator('#sm-proto-panel .cursor.on')).toHaveCount(0);
  await expect(ctl(page, 'play')).toHaveAttribute('aria-label', 'Play journey');
});

test('compare view: play runs the journey on both versions together', async ({ page }) => {
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await page.evaluate(() => { localStorage.setItem('sm-proto:expenses-demo:speed', '2'); });
  await page.keyboard.press('j');
  await ctl(page, 'view-compare').click();
  const left = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=0');
  const right = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=1');
  await expect(right.locator('main .row')).toHaveCount(5);
  await ctl(page, 'play').click();
  await expect(ctl(page, 'play')).toHaveAttribute('aria-label', 'Pause');
  // v2 (right) types the search; v1 (left) has no search box, so it says so and keeps pace
  await expect(right.locator('#q')).toHaveValue('Ana', { timeout: 10000 });
  await expect(left.locator('#sm-proto-panel .note.on')).toContainText('isn’t in this version', { timeout: 10000 });
  await expect(ui(page).locator('.toast')).toHaveText('Journey ended', { timeout: 30000 });
  await expect(ctl(page, 'step-count')).toHaveText('6 of 6 steps');
  await expect(ctl(page, 'play')).toHaveAttribute('aria-label', 'Replay journey');
});

for (const mode of ['single', 'compare']) {
  test(`export video (${mode}): replays the journey from step 1 without our UI and downloads it`, async ({ page }) => {
    test.setTimeout(90000);
    // Headless Chromium can't share a tab: hand the manager a canvas stream instead.
    await page.addInitScript(() => {
      window.SM_PROTO_CAPTURE = async () => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 200;
        const g = c.getContext('2d'); let t = 0;
        setInterval(() => { g.fillStyle = t++ % 2 ? '#111' : '#222'; g.fillRect(0, 0, 320, 200); }, 40);
        return c.captureStream(25);
      };
    });
    await page.goto(BASE + 'index.html?journey=approver-happy');
    await page.evaluate(() => { localStorage.setItem('sm-proto:expenses-demo:speed', '2'); });
    await expect(rows(page)).toHaveCount(5);
    await page.keyboard.press('j');
    if (mode === 'compare') await ctl(page, 'view-compare').click();
    const dl = page.waitForEvent('download', { timeout: 80000 });
    await ctl(page, 'share').click();
    await ctl(page, 'export-video').click();
    // options first: this journey, and the version on screen (both side by side in compare)
    await expect(ctl(page, 'video-this')).toHaveAttribute('aria-checked', 'true');
    await expect(ctl(page, 'video-version')).toHaveAttribute('data-value', mode === 'compare' ? 'compare' : 'v2');
    await ctl(page, 'video-record').click();
    // recording: no bar, no drawer, just the prototype pane(s), on a fresh step 1
    await expect(ui(page).locator('.root.rec')).toHaveCount(1);
    await expect(ui(page).locator('.bar')).toBeHidden();
    await expect(ui(page).locator('#smp-panel')).toBeHidden();
    await expect(ui(page).locator('.stage iframe')).toHaveCount(mode === 'compare' ? 2 : 1);
    const pane = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=' + (mode === 'compare' ? 1 : 0));
    await expect(pane.locator('#q')).toHaveValue('Ana', { timeout: 20000 });
    await expect(pane.locator('.banner.ok')).toContainText('Approved and paid out', { timeout: 30000 });
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(new RegExp('^expenses-demo-approver-happy' + (mode === 'compare' ? '-compare' : '') + '\\.(mp4|webm)$'));
    const path = await file.path();
    expect(require('fs').statSync(path).size).toBeGreaterThan(1000);
    // back to normal afterwards
    await expect(ui(page).locator('.root.rec')).toHaveCount(0);
    await expect(ui(page).locator('.bar')).toBeVisible();
  });
}

test('device: its own section at the bottom of the drawer, presets and a custom size', async ({ page }) => {
  await page.goto(BASE + '?journey=approver-happy');
  await page.keyboard.press('j');
  await expect(ui(page).locator('#smp-panel .sec').last().locator('.sh')).toContainText('Device');
  await ui(page).locator('summary').click();
  await expect(ui(page).locator('details.pp [data-control="device"]')).toHaveCount(0);
  // custom: type a size, the frame follows, rotate swaps it
  await pick(page, 'device', 'custom');
  await ctl(page, 'custom-w').fill('600');
  await ctl(page, 'custom-h').fill('500');
  await ctl(page, 'custom-h').press('Enter');
  await expect(ui(page).locator('.stage iframe')).toHaveCSS('width', '600px');
  await expect(ui(page).locator('.stage iframe')).toHaveCSS('height', '500px');
  await ctl(page, 'custom-rotate').click();
  await expect(ui(page).locator('.stage iframe')).toHaveCSS('width', '500px');
  await pick(page, 'device', 'desktop');
  await expect(ui(page).locator('.stage')).toHaveCount(0);
  await pick(page, 'device', 'mobile');
  const f = ui(page).locator('.stage iframe');
  await expect(f).toHaveCount(1);
  await expect(f).toHaveCSS('width', '390px');
  await expect(page.frameLocator('#sm-proto-panel >> .stage iframe').locator('#title')).toHaveText('Waiting for your approval');
  // a phone-sized frame on a desktop: annotate keeps its desktop UI, not phone sheets
  const phone = page.frameLocator('#sm-proto-panel >> .stage iframe');
  await expect(phone.locator('body')).not.toHaveClass(/annot-compact/);
  await ctl(page, 'comment').click();
  await expect(phone.locator('body')).toHaveClass(/annot-mode/);
  const tt = await phone.locator('#title').boundingBox();
  await page.mouse.click(tt.x + 8, tt.y + 4);
  const nm = phone.locator('.annot-modal input');
  if (await nm.isVisible().catch(() => false)) { await nm.fill('Sam'); await nm.press('Enter'); }
  await expect(phone.locator('.annot-popup textarea')).toBeVisible();
  await expect(phone.locator('body')).not.toHaveClass(/annot-sheet-open|annot-compact/);
});

test('comments: annotate embedded, Comment in the bar, list in the Comments panel, X stops', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(BASE);
  await expect(rows(page)).toHaveCount(5);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await expect(page.locator('.annot-fab-row')).toBeHidden();
  await ctl(page, 'next').click();
  await ctl(page, 'comment').click();
  await expect(ctl(page, 'stop-commenting')).toHaveText('Stop commenting');
  const box = await page.locator('#title').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 10);
  const name = page.locator('.annot-modal input');
  if (await name.isVisible().catch(() => false)) { await name.fill('Sam'); await name.press('Enter'); }
  await page.locator('.annot-popup textarea').fill('Say who is waiting');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.annot-card')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(ctl(page, 'comment')).toBeVisible();
  // X on the bar leaves comment mode without dropping a comment
  await ctl(page, 'comment').click();
  await ctl(page, 'stop-commenting').click();
  await expect(ctl(page, 'comment')).toBeVisible();
  await expect(page.locator('.annot-card')).toHaveCount(1);
  // the Comments panel lists it, tagged with the step it was left on
  await expect(ctl(page, 'comments-panel').locator('.bd')).toHaveText('1');
  await ctl(page, 'comments-panel').click();
  const item = ui(page).locator('#smp-comments .cm');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Say who is waiting');
  // and with where it was left: version, journey, step and the element
  await expect(item.locator('.wh')).toContainText('Approver, normal week');
  await expect(item.locator('.wh')).toContainText('Step 1');
  await expect(item.locator('.wh code')).toContainText('title');
  // the drawer's Share holds the exports too
  await page.keyboard.press('j');
  await ctl(page, 'share').click();
  await expect(ctl(page, 'copy-comments')).toBeEnabled();
  await expect(ctl(page, 'export')).toBeEnabled();
  await expect(ctl(page, 'copy-comments').locator('.kb')).toHaveText('⌥ C');
  // ⌥C copies, ⌥E downloads (⌘⇧C belongs to the browser's inspector)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Alt+KeyC');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Say who is waiting');
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Alt+KeyE');
  expect((await dl).suggestedFilename()).toMatch(/\.md$/);
});

test('Comments panel: a card opens its thread (reply, resolve), back to all comments', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await ctl(page, 'comment').click();
  const box = await page.locator('#title').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 10);
  const name = page.locator('.annot-modal input');
  if (await name.isVisible().catch(() => false)) { await name.fill('Sam'); await name.press('Enter'); }
  await page.locator('.annot-popup textarea').fill('Say who is waiting');
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Escape');
  await ctl(page, 'comments-panel').click();
  await ui(page).locator('#smp-comments .cm').click();
  const tv = ui(page).locator('#smp-comments .tv');
  await expect(tv.locator('.tc p')).toHaveText('Say who is waiting');
  await expect(tv.locator('.tg code')).toContainText('title');
  await ctl(page, 'thread-reply').fill('Ana, from Travel');
  await ctl(page, 'thread-reply').press('Enter');
  await expect(tv.locator('.tr')).toHaveCount(1);
  await expect(tv.locator('.tr p')).toHaveText('Ana, from Travel');
  await ctl(page, 'thread-resolve').click();
  await expect(ctl(page, 'thread-resolve')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => SMAnnotate.list()[0].resolved)).toBe(true);
  await ctl(page, 'thread-back').click();
  await expect(ui(page).locator('#smp-comments .cm .rp')).toContainText('1 reply');
});

test('Comments panel: a comment from another journey and step takes you there, opens it, scrolls to its pin', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(BASE + '?journey=approver-happy');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await ctl(page, 'next').click();
  await ctl(page, 'next').click();
  await expect(ctl(page, 'step-count')).toHaveText('2 of 6 steps');
  await ctl(page, 'comment').click();
  const box = await page.locator('#title').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 10);
  const name = page.locator('.annot-modal input');
  if (await name.isVisible().catch(() => false)) { await name.fill('Sam'); await name.press('Enter'); }
  await page.locator('.annot-popup textarea').fill('Title is too quiet');
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => SMAnnotate.list()[0]);
  expect(saved).toMatchObject({ journey: 'approver-happy', journeyTitle: 'Approver, normal week', step: 2, version: 'v2' });
  // somewhere else: another journey, no run
  await page.goto(BASE + '?journey=requester-own');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await ctl(page, 'comments-panel').click();
  const item = ui(page).locator('#smp-comments .cm');
  await expect(item.locator('.wh')).toContainText('v2');
  await expect(item.locator('.wh')).toContainText('Approver, normal week');
  await expect(item.locator('.wh')).toContainText('Step 2');
  await item.click();
  // back on its journey, replayed up to its step, thread open
  await expect(page).toHaveURL(/journey=approver-happy/, { timeout: 10000 });
  await expect(ctl(page, 'step-count')).toHaveText('2 of 6 steps', { timeout: 10000 });
  const tv = ui(page).locator('#smp-comments .tv');
  await expect(tv.locator('.tc p')).toHaveText('Title is too quiet', { timeout: 10000 });
  await expect(tv.locator('.tg')).toContainText('Step 2 · Search for Ana');
  await expect(tv.locator('.tg code')).toContainText('title');
  await expect(page.locator('#title.annot-target-active')).toHaveCount(1, { timeout: 5000 });
});

test('Comments panel filters: current version by default, people, status with archive', async ({ page }) => {
  test.setTimeout(60000);
  // v1 is closed in the example: open it for this test
  await page.route('**/expenses/journeys.json', async route => {
    const r = await route.fetch(); const j = await r.json();
    j.iterations.forEach(it => { delete it.status; });
    await route.fulfill({ response: r, json: j });
  });
  const leave = async (sel, text) => {
    await ctl(page, 'comment').click();
    const box = await page.locator(sel).first().boundingBox();
    await page.mouse.click(box.x + 10, box.y + 8);
    const name = page.locator('.annot-modal input');
    if (await name.isVisible().catch(() => false)) { await name.fill('Sam'); await name.press('Enter'); }
    await page.locator('.annot-popup textarea').fill(text);
    await page.keyboard.press('Meta+Enter');
    await page.keyboard.press('Escape');
  };
  // one comment on v1
  await page.goto(BASE + 'v1.html');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await leave('h1', 'v1 heading is vague');
  // two on v2 (current), one resolved later
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await leave('#title', 'Title is too quiet');
  await leave('#q', 'Search needs a hint');
  await ctl(page, 'comments-panel').click();
  const items = ui(page).locator('#smp-comments .cm');
  // the filters sit under one button, a summary next to it
  await expect(ui(page).locator('#smp-comments .fw:not(.sw) .fsum')).toHaveText('Current·Everyone·All'.replace(/·/g, ''));
  await expect(ctl(page, 'cfilter-version')).toHaveCount(0);
  const filt = async (name, v) => { if (!(await ctl(page, name).isVisible())) await ctl(page, 'cfilter').click(); await pick(page, name, v); await page.keyboard.press('Escape'); await expect(ctl(page, name)).toHaveCount(0); };
  await ctl(page, 'cfilter').click();
  await expect(ui(page).locator('.frow > span')).toHaveText(['Version', 'People', 'Status']);
  await expect(ctl(page, 'cfilter-version')).toHaveAttribute('data-value', 'current');
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(2);
  await filt('cfilter-version', 'all');
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: 'v1 heading is vague' }).locator('.wh')).toContainText('v1');
  await filt('cfilter-version', 'current');
  // people: Everyone, You, and each name
  await ctl(page, 'cfilter').click();
  await expect(await optionsOf(page, 'cfilter-people')).toHaveText(['Everyone', 'You', 'Reviewer']); await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(ctl(page, 'cfilter')).not.toHaveClass(/set/);
  await filt('cfilter-people', 'me');
  await expect(items).toHaveCount(2);
  await expect(ctl(page, 'cfilter')).toHaveClass(/set/);
  await filt('cfilter-people', 'all');
  // archive one: gone from the page and from All, there under Archived
  await items.filter({ hasText: 'Search needs a hint' }).click();
  // in the thread's ⋯: Copy link first, Archive last
  await ctl(page, 'thread-more').click();
  await expect(ui(page).locator('.cmm .dd .mi')).toHaveText(['Copy link', 'Archive']);
  await expect(ctl(page, 'thread-archive')).toHaveClass(/danger/);
  await ctl(page, 'thread-archive').click();
  await expect(ui(page).locator('#smp-comments .tc .rb')).toContainText('Archived');
  await ctl(page, 'thread-back').click();
  await expect(items).toHaveCount(1);
  await expect(page.locator('.annot-badge')).toHaveCount(1);
  await filt('cfilter-status', 'archived');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('Search needs a hint');
  // resolve the other: Open shows none, Resolved shows it
  await filt('cfilter-status', 'all');
  await items.first().click();
  await ctl(page, 'thread-resolve').click();
  await ctl(page, 'thread-back').click();
  await filt('cfilter-status', 'open');
  await expect(items).toHaveCount(0);
  await expect(ui(page).locator('#smp-comments .empty')).toHaveText('No comments match these filters.');
  await filt('cfilter-status', 'resolved');
  await expect(items).toHaveCount(1);
  // a comment from another version takes you to that version
  await filt('cfilter-status', 'all');
  await filt('cfilter-version', 'all');
  await items.filter({ hasText: 'v1 heading is vague' }).click();
  await expect(page).toHaveURL(/v1\.html/);
  await expect(ui(page).locator('#smp-comments .tv .tc p')).toHaveText('v1 heading is vague', { timeout: 10000 });
});

test('typing a name in the Comments panel: shortcut letters go into the field', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await ctl(page, 'comments-panel').click();
  // you are the avatar next to Share: click it to edit your name
  await ctl(page, 'me').click();
  const name = ctl(page, 'name');
  await name.click();
  await page.keyboard.type('Ana Hajj CA');
  await expect(ctl(page, 'name')).toHaveValue('Ana Hajj CA');
  await expect(ctl(page, 'stop-commenting')).toHaveCount(0);
});

test('comments as Sidebar (default) or Cards; the right button and C show and hide whichever; P hides pins', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await ctl(page, 'comment').click();
  const box = await page.locator('#title').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 10);
  const name = page.locator('.annot-modal input');
  if (await name.isVisible().catch(() => false)) { await name.fill('Sam'); await name.press('Enter'); }
  await page.locator('.annot-popup textarea').fill('A pin and a card');
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('.annot-badge')).toHaveCount(1);
  // Sidebar by default (in the comments ⋯), not in the bar's ⋯: no cards on the page
  await ctl(page, 'more').click();
  await expect(ctl(page, 'cmode-sidebar')).toHaveCount(0);
  await expect(ctl(page, 'clear')).toHaveCount(0);
  await expect(ctl(page, 'copy-link')).toBeVisible();
  await page.keyboard.press('Escape');
  await ctl(page, 'comments-panel').click();
  await ctl(page, 'cmore').click();
  await expect(ctl(page, 'cmode-sidebar')).toHaveAttribute('aria-pressed', 'true');
  await expect(ctl(page, 'cmode-cards')).toHaveText('Floating');
  await page.keyboard.press('Escape');
  await ctl(page, 'comments-panel').click();
  await expect(page.locator('.annot-card').first()).toHaveCSS('opacity', '0');
  await page.locator('.annot-badge').click();
  await expect(ui(page).locator('#smp-comments.open .tv .tc p')).toHaveText('A pin and a card');
  await expect(page.locator('#title')).toHaveClass(/annot-flash/);
  // the button and C open and close the sidebar
  await ctl(page, 'comments-panel').click();
  await expect(ui(page).locator('#smp-comments.open')).toHaveCount(0);
  await page.mouse.click(5, 300);
  await page.keyboard.press('c');
  await expect(ui(page).locator('#smp-comments.open')).toHaveCount(1);
  await page.keyboard.press('c');
  await expect(ui(page).locator('#smp-comments.open')).toHaveCount(0);
  // Floating: no column of cards, the button and C show and hide the pins
  await page.keyboard.press('c');
  await ctl(page, 'cmore').click();
  await ctl(page, 'cmode-cards').click();
  await expect(ui(page).locator('#smp-comments.open')).toHaveCount(0);
  expect(await page.evaluate(() => SMAnnotate.state.cards)).toBe(false);
  await expect(page.locator('.annot-card').first()).toHaveCSS('opacity', '0');
  // the bar's comment button opens the options: pins, and back to the sidebar
  await expect(ctl(page, 'comments-panel')).toHaveAttribute('aria-label', 'Comment options');
  await ctl(page, 'comments-panel').click();
  await ctl(page, 'comments').click();
  expect(await page.evaluate(() => SMAnnotate.state.pins)).toBe(false);
  await expect(ui(page).locator('#smp-comments.open')).toHaveCount(0);
  await page.mouse.click(5, 300);
  await page.keyboard.press('c');
  expect(await page.evaluate(() => SMAnnotate.state.pins)).toBe(true);
  // hovering a pin doesn't show a card; clicking it opens the card right next to it
  await page.locator('.annot-badge').hover();
  await expect(page.locator('.annot-card').first()).toHaveCSS('opacity', '0');
  const pin = await page.locator('.annot-badge').boundingBox();
  await page.locator('.annot-badge').click();
  const card = page.locator('.annot-card.annot-card-at-pin');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveCSS('opacity', '1');
  const cb = await card.boundingBox();
  expect(Math.abs(cb.x - (pin.x + pin.width + 10))).toBeLessThan(4);
  await page.mouse.click(5, 300);
  await expect(page.locator('.annot-card').first()).toHaveCSS('opacity', '0');
  // pins off with P, remembered with the mode
  await page.mouse.click(5, 300);
  await page.keyboard.press('p');
  await expect(page.locator('.annot-badge')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => !!window.SMAnnotate);
  expect(await page.evaluate(() => SMAnnotate.state.pins)).toBe(false);
  // Floating has no sidebar: the bar's comment button is the way back, not its ⋯
  await ctl(page, 'more').click();
  await expect(ctl(page, 'cmode-cards')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await ctl(page, 'comments-panel').click();
  await expect(ctl(page, 'cmode-cards')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  // Comment always works, and shows the pins again; it turns red to stop
  await ctl(page, 'comment').click();
  const stop = ctl(page, 'stop-commenting');
  await expect(stop).toHaveText('Stop commenting');
  await page.mouse.move(5, 5);
  await expect(stop).toHaveCSS('background-color', 'rgb(240, 71, 88)');
  expect(await page.evaluate(() => SMAnnotate.state.pins)).toBe(true);
  await stop.click();
});

test('compare view: Comment works on both versions, the list says which', async ({ page }) => {
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await page.keyboard.press('j');
  await ctl(page, 'view-compare').click();
  const right = page.frameLocator('#sm-proto-panel >> .stage iframe >> nth=1');
  await expect(right.locator('main .row')).toHaveCount(5);
  await page.waitForTimeout(800);
  await expect(ctl(page, 'comment')).toBeEnabled();
  await ctl(page, 'comment').click();
  await expect(ctl(page, 'stop-commenting')).toBeVisible();
  const box = await right.locator('#title').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 8);
  const name = right.locator('.annot-modal input');
  if (await name.isVisible().catch(() => false)) { await name.fill('Sam'); await name.press('Enter'); }
  await right.locator('.annot-popup textarea').fill('v2 title reads better');
  await right.locator('.annot-popup textarea').press('Meta+Enter');
  await ctl(page, 'stop-commenting').click();
  await ctl(page, 'comments-panel').click();
  const item = ui(page).locator('#smp-comments .cm');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('v2 title reads better');
  await expect(item.locator('.st').first()).toHaveText('v2 (current)');
});

test('live comments: no relay is assumed, the example stays single-player', async ({ browser }) => {
  const c = await browser.newContext();
  const page = await c.newPage();
  await page.goto(BASE);
  const sync = await page.evaluate(() => window.SM_ANNOTATE_SYNC);
  expect(sync ?? null).toBeNull();
  await c.close();
});

test('share copies a link to this journey', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BASE + '?journey=power-user');
  await page.keyboard.press('j');
  await ctl(page, 'share').click();
  await expect(ctl(page, 'export-video')).toBeVisible();
  await ctl(page, 'copy-link').click();
  await expect(ui(page).locator('.toast')).toHaveText('Link copied');
  await expect(ctl(page, 'copy-link')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('journey=power-user');
});

test('… menu: show/hide the cursor highlight and the whole UI (⌘\\ toggles)', async ({ page }) => {
  await page.goto(BASE + '?journey=approver-happy');
  await expect(rows(page)).toHaveCount(5);
  await ctl(page, 'more').click();
  await expect(ctl(page, 'comments-panel')).toBeVisible();
  await expect(ui(page).locator('.menu')).not.toContainText('All comments');
  await expect(ctl(page, 'highlight')).toHaveAttribute('aria-checked', 'true');
  await ctl(page, 'highlight').click();
  await ctl(page, 'next').click();
  await expect(ui(page).locator('.ring.on')).toBeHidden();
  await ctl(page, 'more').click();
  await ctl(page, 'highlight').click();
  await expect(ui(page).locator('.ring.on')).toBeVisible();
  // hide the UI from the menu, bring it back with the shortcut
  await ctl(page, 'show-ui').click();
  await expect(ui(page).locator('.bar')).toBeHidden();
  await expect(ui(page).locator('.toast')).toContainText('brings them back');
  await expect(ui(page).locator('.ring.on')).toBeVisible();
  await page.keyboard.press('Meta+Backslash');
  await expect(ui(page).locator('.bar')).toBeVisible();
  await page.keyboard.press('Control+Backslash');
  await expect(ui(page).locator('.bar')).toBeHidden();
});

test('export video options: all journeys get a title card each, any version, Esc cancels', async ({ page }) => {
  await page.addInitScript(() => {
    window.SM_PROTO_CAPTURE = async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64); return c.captureStream(10); };
  });
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await expect(rows(page)).toHaveCount(5);
  await ctl(page, 'more').click();
  await ctl(page, 'export-video').click();
  await expect(await optionsOf(page, 'video-version')).toHaveText(['v4 (exploration)', 'v3 (bulk review)', 'v2 (current)', 'v1 (first pass)', 'Compare: v1 (first pass) and v2 (current), side by side']); await page.keyboard.press('Escape');
  await ctl(page, 'video-all').click();
  await pick(page, 'video-version', 'v1');
  await ctl(page, 'video-record').click();
  await expect(ctl(page, 'slate')).toContainText('Journey 1 of 6');
  await expect(ui(page).locator('.stage iframe')).toHaveAttribute('src', /v1\.html/);
  await expect(ctl(page, 'slate')).toBeHidden({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await expect(ui(page).locator('.toast')).toHaveText('Recording cancelled');
  await expect(ui(page).locator('.root.rec')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-sm-journey', 'approver-happy');
});

test('panel=0 hides the UI for clean recordings, J brings it back', async ({ page }) => {
  await page.goto(BASE + '?journey=power-user&panel=0');
  await expect(page.locator('#pager')).toContainText('Page 1 of');
  await expect(ui(page).locator('.bar')).toBeHidden();
  await page.keyboard.press('j');
  await expect(ui(page).locator('#smp-panel')).toBeVisible();
});

test('off the journey: a page the step is not on says so, with a way back', async ({ page }) => {
  await page.goto(BASE + '?journey=approver-happy');
  await ctl(page, 'next').click();
  await expect(ui(page).locator('.ring.on')).toBeVisible();
  // as if the reviewer had clicked away to a page this step isn't on
  await page.evaluate(() => { SMProto.config.flows.approve[0].path = '/elsewhere'; });
  await page.keyboard.press('j');
  await expect(ui(page).locator('.warn')).toContainText('isn’t part of the journey');
});

test('typing in the prototype does not toggle the panel', async ({ page }) => {
  await page.goto(BASE);
  await page.fill('#q', 'jjj');
  await expect(ui(page).locator('#smp-panel')).toBeHidden();
});

test('server code sees the journey in the sm-proto cookie', async ({ page, context }) => {
  await page.goto(BASE + '?journey=slow-us');
  const c = (await context.cookies()).find(c => c.name === 'sm-proto');
  const s = JSON.parse(Buffer.from(c.value, 'base64url').toString());
  expect(s).toMatchObject({ journey: 'slow-us', region: 'US', network: { latencyMs: 1500 } });
});

test('XHR (axios-style) gets the same answers as fetch', async ({ page }) => {
  await page.goto(BASE + '?journey=payout-declined');
  const out = await page.evaluate(() => new Promise(res => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/payouts');
    x.onload = () => res({ status: x.status, body: JSON.parse(x.responseText) });
    x.send('{}');
  }));
  expect(out).toEqual({ status: 402, body: { error: 'card_declined', message: 'The company card was declined.' } });
});

test('gate: password page in front of the prototype', async ({ page }) => {
  const G = 'http://localhost:' + (PORT + 1) + '/artifact-manager/examples/expenses/?journey=first-day';
  await page.goto(G);
  await expect(page).toHaveURL(/__gate\/login/);
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await page.fill('#pw', 'wrong');
  await page.click('button[type=submit]');
  await expect(page.getByRole('alert')).toHaveText('That password is not right.');
  await page.fill('#pw', 'let me in');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/examples\/expenses\/\?journey=first-day/);
  await expect(page.locator('.state b')).toHaveText('Nothing to approve');
});

test('storyboard, all journeys: lanes, shared screens, a fork, and a click opens that journey at that step', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await page.keyboard.press('j');
  await ctl(page, 'view-board').click();
  await ctl(page, 'board-all').click();
  await expect(ui(page).locator('[data-mode=all]')).toHaveCount(1);
  const lanes = ui(page).locator('.lane-l');
  await expect(lanes).toHaveCount(9);
  await expect(lanes.nth(1)).toContainText('Payout declined');
  await expect(lanes.nth(1)).toContainText('branches from Approver, normal week at step 5');
  // payout declined shares steps 1 to 4: its lane has only steps 5 and 6
  await expect(ui(page).locator('.shot[data-journey=payout-declined]')).toHaveCount(2);
  // one arrow per link, the fork included; the current journey's path is lit
  await expect(ui(page).locator('.barrows g.on')).toHaveCount(5);
  await expect(ui(page).locator('.barrows > g')).toHaveCount(17);
  await expect(ui(page).locator('.barrows g .hd')).toHaveCount(17);   // every connector has its head
  // stays on All journeys after a reload
  await page.reload();
  await expect(ui(page).locator('[data-mode=all]')).toHaveCount(1);
  const fork = ui(page).locator('.shot[data-journey=payout-declined][data-step="5"]');
  await fork.scrollIntoViewIfNeeded();
  await fork.locator('.shot-hit').click();
  await expect(page).toHaveURL(/journey=payout-declined/);
  await expect(ctl(page, 'step-count')).toHaveText('5 of 6 steps', { timeout: 15000 });
  await expect(ui(page).locator('.stage.board')).toHaveCount(0);
});

test('version status: a drawer field you can change, a closed version takes no comments', async ({ page }) => {
  await page.goto(BASE + 'index.html?journey=approver-happy');
  await page.keyboard.press('j');
  const st = ui(page).locator('#smp-panel .meta [data-control=version-status]');
  await expect(st).toHaveText('Open for review');
  await expect(ui(page).locator('.bar [data-control=version-status], #smp-panel .hr [data-control=version-status]')).toHaveCount(0);
  await expect(await optionsOf(page, 'version')).toHaveText(['v4 (exploration)', 'v3 (bulk review)', 'v2 (current)', 'v1 (first pass)']); await page.keyboard.press('Escape');
  // change it here: it sticks and tells the host
  await page.evaluate(() => { window.__st = null; addEventListener('smp:status', e => { window.__st = e.detail; }); });
  await st.click();
  await ctl(page, 'status-approved').click();
  await expect(st).toHaveText('Approved');
  expect(await page.evaluate(() => window.__st)).toEqual({ version: 'v2', status: 'approved' });
  await page.reload();
  await page.keyboard.press('j');
  await expect(ui(page).locator('#smp-panel .meta [data-control=version-status]')).toHaveText('Approved');
  await page.goto(BASE + 'v1.html?journey=approver-happy');
  await page.keyboard.press('j');
  await expect(st).toHaveText('Closed');
  await expect(ctl(page, 'comment')).toBeDisabled();
  await ctl(page, 'comments-panel').click();
  await expect(ctl(page, 'comments-closed')).toContainText('closed for review');
});

test('Comments header: other commenters stacked, you next to Share, your name in a dropdown', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find(k => k.startsWith('sm-annotator:')) || 'sm-annotator:expenses-demo';
    const mk = (id, author) => ({ id, author, comment: 'from ' + author, page: location.pathname.split('/').slice(-2).join('/') || 'expenses/index.html', createdAt: Date.now() });
    window.__seed = [mk('a1', 'Maya'), mk('a2', 'Jonas'), mk('a3', 'Priya'), mk('a4', 'Tomás'), mk('a5', 'Maya')];
  });
  await ctl(page, 'comments-panel').click();
  // no row with your name under the header any more
  await expect(ui(page).locator('#smp-comments .me')).toHaveCount(0);
  const order = await ui(page).locator('#smp-comments .hr').evaluate(el => [...el.querySelectorAll('[data-control]')].map(x => x.getAttribute('data-control')));
  expect(order.indexOf('me')).toBe(order.indexOf('cmore') - 1);
  await ctl(page, 'me').click();
  await expect(ctl(page, 'name')).toBeFocused();
  await page.keyboard.type('Sam');
  await page.keyboard.press('Enter');
  await expect(ctl(page, 'name')).toHaveCount(0);
  await expect(ctl(page, 'me')).toHaveAttribute('title', 'You (Sam)');
});

const ART = BASE.replace(/expenses\/$/, '');
const leaveOn = async (page, loc, text) => {
  await ctl(page, 'comment').click();
  await loc.scrollIntoViewIfNeeded();
  const bx = await loc.boundingBox();
  await page.mouse.click(bx.x + 20, bx.y + 6);
  const nm = page.locator('.annot-modal input');
  if (await nm.isVisible().catch(() => false)) { await nm.fill('Sam'); await nm.press('Enter'); }
  await page.locator('.annot-popup textarea').fill(text);
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Escape');
};

test('document: pages instead of journeys, comments say version, section and quote', async ({ page }) => {
  await page.goto(ART + 'document/');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await expect(ctl(page, 'page-count')).toHaveText('Page 1 of 4');
  await expect(ctl(page, 'play')).toHaveCount(0);
  await ctl(page, 'page-next').click();
  await expect(ctl(page, 'page-count')).toHaveText('Page 2 of 4');
  await page.keyboard.press('ArrowRight');
  await expect(ctl(page, 'page-count')).toHaveText('Page 3 of 4');
  await page.keyboard.press('ArrowLeft');
  await expect(ctl(page, 'page-count')).toHaveText('Page 2 of 4');
  await page.keyboard.press('j');
  await expect(ctl(page, 'view-board')).toHaveCount(1);
  await expect(ctl(page, 'view-compare')).toHaveCount(1);
  await expect(ui(page).locator('#smp-panel .sh')).toHaveText(['Versioning', 'Device']);
  // the pages sit on the dark dotted canvas
  await expect(page.locator('html')).toHaveClass(/smp-canvas/);
  await page.keyboard.press('j');
  await leaveOn(page, page.locator('h3:has-text("2.1") + p'), 'Who approves a raised limit?');
  await ctl(page, 'comments-panel').click();
  const card = ui(page).locator('#smp-comments .cm').first();
  await expect(card.locator('.qt')).toContainText('Team leads can raise their own limit');
  await expect(card.locator('.st')).toHaveText(['v2 (revised)', 'Page 2', '2.1 Team limits']);
});

test('presentation: slides in the bar, comments say version, slide and quote', async ({ page }) => {
  await page.goto(ART + 'presentation/');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await expect(ctl(page, 'page-count')).toHaveText('Slide 1 of 6');
  await ctl(page, 'page-next').click();
  await ctl(page, 'page-next').click();
  await expect(ctl(page, 'page-count')).toHaveText('Slide 3 of 6');
  // one slide at a time, nothing scrolls
  await expect(page.locator('.slide.smp-on')).toHaveCount(1);
  await expect(page.locator('.slide >> nth=2')).toHaveClass(/smp-on/);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect(ctl(page, 'page-count')).toHaveText('Slide 4 of 6');
  await page.keyboard.press('ArrowUp');
  await expect(ctl(page, 'page-count')).toHaveText('Slide 3 of 6');
  await expect(page.locator('.slide >> nth=3')).toBeHidden();
  await leaveOn(page, page.locator('.slide >> nth=2').locator('p'), 'Label the bars');
  await ctl(page, 'comments-panel').click();
  const card = ui(page).locator('#smp-comments .cm').first();
  await expect(card.locator('.qt')).toContainText('Waiting for the manager');
  await expect(card.locator('.st')).toHaveText(['v2 (final)', 'Slide 3 · Where the time went']);
  // its pin shows on its slide only; picking the comment from another slide brings the slide back
  await page.keyboard.press('Escape');
  await ctl(page, 'page-prev').click();
  await expect(ctl(page, 'page-count')).toHaveText('Slide 2 of 6');
  await expect(page.locator('.annot-badge')).toBeHidden();
  await ctl(page, 'comments-panel').click();
  await ui(page).locator('#smp-comments .cm').first().click();
  await expect(ctl(page, 'page-count')).toHaveText('Slide 3 of 6');
  await expect(page.locator('.annot-badge')).toBeVisible();
  await ctl(page, 'thread-back').click().catch(() => {});
  // compare: both versions page together
  await page.keyboard.press('j');
  await ctl(page, 'view-compare').click();
  await ctl(page, 'page-next').click();
  await expect(ctl(page, 'page-count')).toHaveText('Slide 2 of 6');
});

test('comments sort: open first, then latest, by default; both changeable', async ({ page }) => {
  await page.goto(ART + 'document/');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await leaveOn(page, page.locator('h1'), 'first');
  await page.waitForTimeout(20);
  await leaveOn(page, page.locator('h2 >> nth=0'), 'second');
  await page.waitForTimeout(20);
  await leaveOn(page, page.locator('h3 >> nth=0'), 'third');
  const id = await page.evaluate(() => SMAnnotate.list().find(c => c.comment === 'third').id);
  await page.evaluate(id => SMAnnotate.resolve(id, true), id);
  await ctl(page, 'comments-panel').click();
  const texts = () => ui(page).locator('#smp-comments .cm > p');
  await expect(ui(page).locator('#smp-comments .sw .fsum')).toHaveText('Open firstLatest');
  await expect(texts()).toHaveText(['second', 'first', 'third']);
  await ctl(page, 'csort').click();
  await pick(page, 'csort-2', 'oldest');
  await expect(texts()).toHaveText(['first', 'second', 'third']);
  await pick(page, 'csort-1', 'none');
  await expect(texts()).toHaveText(['first', 'second', 'third'].sort(() => 0));
  await pick(page, 'csort-1', 'resolved');
  await expect(texts()).toHaveText(['third', 'first', 'second']);
  await expect(ctl(page, 'csort')).toHaveClass(/set/);
});

test('paginated documents and decks: a storyboard of every page or slide, click one to open it', async ({ page }) => {
  for (const [path, n, word] of [['document/', 4, 'Page'], ['presentation/', 6, 'Slide']]) {
    await page.goto(ART + path);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.SMAnnotate);
    await page.keyboard.press('j');
    await ctl(page, 'view-board').click();
    await page.keyboard.press('j');
    const shots = ui(page).locator('.stage.board .shot');
    await expect(shots).toHaveCount(n);
    await expect(shots.nth(1).locator('.shot-t span')).toHaveText(word + ' 2 of ' + n);
    // each screen shows its own page only
    const f = page.frameLocator('#sm-proto-panel .stage.board .shot >> nth=2 >> iframe');
    await expect(f.locator('.smp-solo')).toHaveCount(1);
    await expect(ctl(page, 'page-count')).toHaveText(word + ' 1 of ' + n);
    await ctl(page, 'page-next').click();
    await expect(ctl(page, 'page-count')).toHaveText(word + ' 2 of ' + n);
    await shots.nth(2).locator('.shot-hit').click();
    await expect(ui(page).locator('.stage.board')).toHaveCount(0);
    await expect(ctl(page, 'page-count')).toHaveText(word + ' 3 of ' + n, { timeout: 5000 });
  }
});

test('continuous documents: paged by section, no storyboard, no canvas', async ({ page }) => {
  await page.goto(ART + 'document-continuous/');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await expect(ctl(page, 'page-count')).toHaveText('Section 1 of 5');
  await ctl(page, 'page-next').click();
  await expect(ctl(page, 'page-count')).toHaveText('Section 2 of 5');
  await expect(page.locator('html')).not.toHaveClass(/smp-canvas/);
  await page.keyboard.press('j');
  await expect(ctl(page, 'view-board')).toHaveCount(0);
});

test('comment links: every card has ⋯ with Copy link; the link opens its thread', async ({ page }) => {
  await page.goto(ART + 'document/');
  await page.waitForFunction(() => !!window.SMAnnotate);
  await leaveOn(page, page.locator('h3:has-text("2.1") + p'), 'Who approves a raised limit?');
  await ctl(page, 'comments-panel').click();
  const item = ui(page).locator('#smp-comments .cm').first();
  await item.hover();
  await item.locator('[data-control=comment-more]').click();
  await expect(ui(page).locator('.cmm .dd .mi')).toHaveText(['Copy link', 'Archive']);
  await page.keyboard.press('Escape');
  const link = await page.evaluate(() => SMProto.commentLink(SMAnnotate.list()[0]));
  expect(link).toMatch(/#comment=/);
  await page.goto(ART + 'presentation/');
  await page.goto(link);
  await page.waitForFunction(() => !!window.SMAnnotate);
  await expect(ui(page).locator('#smp-comments.open .tv .tc p')).toHaveText('Who approves a raised limit?');
});

test('compare and devices: frames fit their pane, labels sit on them, zoom is Scale to Fit or 50/75/100%', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + '?journey=payout-declined');
  await page.keyboard.press('j');
  await ctl(page, 'view-compare').click();
  await pick(page, 'device', 'tablet');
  await page.keyboard.press('j');
  const panes = ui(page).locator('.stage .pane');
  await expect(panes).toHaveCount(2);
  const geo = () => panes.evaluateAll(ps => ps.map(p => { const P = p.getBoundingClientRect(), F = p.querySelector('.pf').getBoundingClientRect(), L = p.querySelector('.pl').getBoundingClientRect(); return { P, F, L }; }));
  await expect(ctl(page, 'zoom')).toHaveAttribute('data-value', 'fit');
  await expect.poll(async () => (await geo()).every(({ P, F, L }) => F.left >= P.left - 1 && F.right <= P.right + 1 && F.bottom <= P.bottom + 1 && L.bottom <= F.top + 1 && Math.abs((L.left + L.right) / 2 - (F.left + F.right) / 2) < 2)).toBe(true);
  // fixed levels: the frame is the device size times the zoom; the pane scrolls
  await pick(page, 'zoom', '0.5');
  await expect.poll(async () => Math.round((await geo())[0].F.width)).toBe(417);
  await pick(page, 'zoom', '1');
  await expect.poll(async () => Math.round((await geo())[0].F.width)).toBe(834);
  expect(await panes.first().evaluate(p => p.scrollHeight > p.clientHeight)).toBe(true);
  await pick(page, 'zoom', 'fit');
  // Responsive at 50%: each frame is twice as wide as its box (a wider viewport, zoomed out)
  await page.keyboard.press('j');
  await pick(page, 'device', 'desktop');
  await page.keyboard.press('j');
  await pick(page, 'zoom', '0.5');
  const f = ui(page).locator('.stage .pane iframe').first();
  await expect.poll(async () => { const w = await f.evaluate(x => x.offsetWidth), b = await f.evaluate(x => x.parentElement.offsetWidth); return Math.round(w / b * 10) / 10; }).toBe(2);
});

test('examples ship with comments of every kind, from people and agents, on 4 versions each', async ({ page }) => {
  await withFileComments(page);
  for (const [path, file] of [['expenses/', 'journeys.json'], ['document/', 'artifact.json'], ['document-continuous/', 'artifact.json'], ['presentation/', 'artifact.json']]) {
    await page.goto(ART + path);
    await page.waitForFunction(() => window.SMAnnotate && SMAnnotate.list().length > 5, null, { timeout: 8000 });
    const s = await page.evaluate(() => { const l = SMAnnotate.list(); return { agents: l.filter(c => c.authorKind === 'agent').length, people: l.filter(c => c.authorKind !== 'agent').length, links: l.filter(c => (c.links || []).length).length, replies: l.reduce((n, c) => n + c.replies, 0), resolved: l.filter(c => c.resolved).length }; });
    expect(s.agents, path).toBeGreaterThan(0); expect(s.people, path).toBeGreaterThan(2); expect(s.links, path).toBeGreaterThan(0); expect(s.replies, path).toBeGreaterThan(2); expect(s.resolved, path).toBeGreaterThan(0);
    const cfg = await (await page.request.get(ART + path + file)).json();
    expect(cfg.iterations.length, path).toBeGreaterThanOrEqual(4);
    const all = (await (await page.request.get(ART + path + 'comments.json')).json()).comments;
    expect(all.some(c => c.point), path).toBe(true); expect(all.some(c => c.area), path).toBe(true); expect(all.some(c => c.quote), path).toBe(true);
    expect(new Set(all.map(c => c.page)).size, path).toBeGreaterThanOrEqual(3);
  }
  // agent comments: the badge, the Claude Code avatar, links as badges that open in a new tab
  await page.goto(ART + 'document/');
  await page.waitForFunction(() => window.SMAnnotate && SMAnnotate.list().length > 5);
  await ctl(page, 'comments-panel').click();
  const agentCard = ui(page).locator('#smp-comments .cm', { has: page.locator('.agt') }).first();
  await expect(agentCard.locator('.agt')).toHaveText('Agent');
  await expect(agentCard.locator('.lnks .lnk').first()).toHaveAttribute('target', '_blank');
  expect(await agentCard.locator('img.av2').getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  // a thread with an agent reply shows the same treatment
  await ui(page).locator('#smp-comments .cm', { hasText: 'Who approves a raised limit' }).click();
  await expect(ui(page).locator('#smp-comments .tv .tr .agt')).toHaveCount(1);
});

test('a thread open in the sidebar puts its pin in the spotlight: the others fade, it pulses', async ({ page }) => {
  await withFileComments(page);
  await page.goto(ART + 'design-review/');
  await page.waitForFunction(() => window.SMAnnotate && SMAnnotate.list().length > 10);
  await ctl(page, 'comments-panel').click();
  await ui(page).locator('#smp-comments .cm', { hasText: 'Two primary buttons' }).click();
  await expect(page.locator('body')).toHaveClass(/annot-spotlight/);
  const spot = page.locator('.annot-badge.annot-pin-spot');
  await expect(spot).toHaveCount(1);
  expect(await spot.evaluate(b => getComputedStyle(b, '::before').animationName)).toBe('annot-pin-pulse');
  await expect.poll(() => page.locator('.annot-badge:not(.annot-pin-spot)').first().evaluate(b => +getComputedStyle(b).opacity)).toBeLessThan(0.5);
  // the proposal: current and proposed side by side, the component to use under them
  await expect(ui(page).locator('#smp-comments .tv .prop figure')).toHaveCount(2);
  await expect(ui(page).locator('#smp-comments .tv .prop .pcap')).toContainText('variant="ghost"');
  // back to the list: no spotlight
  await ctl(page, 'thread-back').click();
  await expect(page.locator('body')).not.toHaveClass(/annot-spotlight/);
  // compare and storyboard are there: two versions, journeys with steps
  await page.keyboard.press('j');
  await expect(ctl(page, 'view-compare')).toHaveCount(1);
  await expect(ctl(page, 'view-board')).toHaveCount(1);
});

test('quick replies above the thread reply box fill it in', async ({ page }) => {
  await withFileComments(page);
  await page.goto(ART + 'design-review/');
  await page.waitForFunction(() => window.SMAnnotate && SMAnnotate.list().length > 10);
  await ctl(page, 'comments-panel').click();
  await ui(page).locator('#smp-comments .cm', { hasText: 'Two primary buttons' }).click();
  await expect(ctl(page, 'quick-reply')).toHaveText(['Agreed', 'Disagree', 'Done']);
  await ctl(page, 'quick-reply').nth(1).click();
  await expect(ctl(page, 'thread-reply')).toHaveValue('Disagree: ');
  await expect(ctl(page, 'thread-reply')).toBeFocused();
});
