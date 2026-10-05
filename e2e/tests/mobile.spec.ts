import { test, expect, ready, expectNoErrorView } from './support/fixtures';
import { AUTH } from './support/data';

/** Smartphone-Ansicht: Navigation erreichbar, nichts ragt über den Bildschirmrand. */
test.use({ storageState: AUTH.editor });

async function expectNoHorizontalScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'waagerechtes Scrollen').toBeLessThanOrEqual(1);
}

test('Seitenleiste über das Menü öffnen und eine Seite aufrufen', async ({ page, seed }) => {
  await page.goto(`/s/${seed.spaceKey}`);
  await ready(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Seitenleiste ein-/ausblenden' }).click();
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByText('Makroseite')).toBeVisible();
  await sidebar.getByText('Makroseite').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Makroseite' })).toBeVisible();
  await expect(sidebar.getByText('Makroseite')).not.toBeInViewport();
});

for (const path of ['/', '/spaces', '/search?q=Makro', '/tasks', '/profile', '/admin/setup']) {
  test(`Ansicht ohne Überlauf: ${path}`, async ({ page }, testInfo) => {
    await page.goto(path);
    await ready(page);
    await expectNoErrorView(page);
    await expectNoHorizontalScroll(page);
    await testInfo.attach('smartphone.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

test('Seite, Editor und Aufgabenplan ohne Überlauf', async ({ page, seed }, testInfo) => {
  for (const path of [`/s/${seed.spaceKey}/p/${seed.richPageId}`, `/s/${seed.spaceKey}/edit/${seed.childPageId}`, `/s/${seed.spaceKey}/tasks`]) {
    await page.goto(path);
    await ready(page);
    await expectNoErrorView(page);
    await expectNoHorizontalScroll(page);
    await testInfo.attach(`smartphone-${path.split('/')[3]}.png`, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
  }
});
