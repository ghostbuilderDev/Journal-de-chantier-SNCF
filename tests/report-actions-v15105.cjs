const assert = require('node:assert/strict');
const path = require('node:path');

// Run against the real form and database in collaboration-v15101-browser.cjs.
async function verifyActions(page, out, touch = false) {
  const button = page.locator('#reportActionsButton'), dialog = page.locator('#reportActionsDialog');
  const before = await page.evaluate(() => JSON.stringify(RJTEST.get()));
  const report = new URL(page.url()).searchParams.get('reportId');
  assert.equal(await button.isVisible(), true);
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.locator('.app-shell [data-share-save]').count(), 0, 'Commands no longer take space in the main form');
  assert.equal(await page.locator('.stepper [role=tab]').count(), 5, 'No technical tab added');
  for (let i = 0; i < 5; i++) {
    await page.locator('.stepper [role=tab]').nth(i).click();
    if (touch) await button.tap(); else await button.click();
    assert.equal(await dialog.isVisible(), true);
    for (const name of ['transfer', 'save', 'validate', 'reload', 'backup']) {
      assert.equal(await dialog.locator('[data-share-' + name + ']').count(), 1);
    }
    await dialog.locator('[data-actions-close]').click();
    assert.equal(await dialog.isVisible(), false);
  }
  await page.locator('.stepper [role=tab]').first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: path.join(out, touch ? 'rapport-actions-mobile-ferme.png' : 'rapport-actions-ordinateur-ferme.png')});
  // Desktop uses a keyboard click; mobile uses real touchscreen input.
  if (touch) await button.tap(); else { await button.focus(); await page.keyboard.press('Enter'); }
  await page.screenshot({path: path.join(out, touch ? 'rapport-actions-mobile-menu.png' : 'rapport-actions-ordinateur-menu.png')});
  await dialog.locator('summary').click();
  assert.equal(await dialog.locator('details').evaluate(e => e.open), true);
  assert.ok((await dialog.locator('details').textContent()).length > 40);
  await dialog.locator('[data-actions-close]').click();
  await button.click();
  assert.equal(await dialog.locator('details').evaluate(e => e.open), true, 'History remains open when the menu is reopened');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await button.evaluate(e => e === document.activeElement), true);

  const start = await button.boundingBox();
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const point = (x, y) => [{x, y, id: 1}];
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: point(start.x + 32, start.y + 32)});
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: point(start.x + 32 - i * 30, start.y + 32 - i * 24)});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await cdp.detach();
  } else {
    await page.mouse.move(start.x + 32, start.y + 32); await page.mouse.down();
    await page.mouse.move(start.x - 150, start.y - 140, {steps: 6}); await page.mouse.up();
  }
  const moved = await button.boundingBox();
  assert.ok(moved.x < start.x - 100 && moved.y < start.y - 100);
  assert.equal(await dialog.isVisible(), false, 'Dragging must not click or submit');
  const stored = await page.evaluate(() => localStorage.getItem('journal-report-actions-position-v1'));
  assert.ok(stored);
  if (touch) await button.tap(); else await button.click();
  await dialog.locator('[data-actions-close]').click();
  assert.equal(await page.evaluate(() => JSON.stringify(RJTEST.get())), before, 'Menu navigation and dragging never change report data');
  assert.equal(new URL(page.url()).searchParams.get('reportId'), report);

  await page.reload();
  await page.waitForSelector('[data-share-save]:not([disabled])', {state: 'attached'});
  if (await page.locator('#startupScreen').isVisible()) { await page.click('#enterAppButton'); await page.waitForFunction(() => document.getElementById('startupScreen').hidden); }
  const restored = await button.boundingBox();
  assert.ok(Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2, 'Position survives reopening');
  const original = page.viewportSize();
  // Narrow/short viewport simulates orientation and keyboard space changes.
  await page.setViewportSize({width: 320, height: 430});
  await page.waitForFunction(() => { const r = document.getElementById('reportActionsButton').getBoundingClientRect(); return r.left >= 8 && r.top >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8; });
  await button.click();
  const size = await dialog.boundingBox();
  assert.ok(size.width <= 320 && size.height <= 430);
  await dialog.locator('[data-actions-close]').click();
  await page.setViewportSize(original);
  await page.waitForFunction(() => !document.documentElement.classList.contains('report-actions-open'));
  console.log('PASS V15.10.5 actions ' + (touch ? 'mobile' : 'desktop') + ': all tabs, history, close/Escape, drag, saved position, small viewport, report data intact.');
}
module.exports = {verifyActions};
