async function clickReportAction(page, name) {
  if (!await page.locator('#reportActionsDialog').isVisible()) await page.click('#reportActionsButton');
  await page.click('[data-share-' + name + ']');
}
module.exports = {clickReportAction};
