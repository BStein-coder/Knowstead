import { test, expect, ready, expectNoErrorView } from './support/fixtures';
import { AUTH } from './support/data';
import { adminRoutes, publicRoutes } from './support/routes';

/**
 * Flächendeckender Rundgang: Jede Seite der Oberfläche wird aufgerufen und muss ohne JavaScript-,
 * Konsolen- oder Serverfehler vollständig laden. Zu jeder Seite entsteht ein Bildschirmfoto im Bericht.
 */
test.describe('Rundgang über alle Seiten (Administration)', () => {
  test.use({ storageState: AUTH.admin });

  for (const route of adminRoutes) {
    test(route.name, async ({ page, seed }, testInfo) => {
      const response = await page.goto(route.path(seed));
      expect(response?.status(), 'Dokument lädt').toBeLessThan(400);
      await ready(page);
      if (route.redirectsTo) await expect(page).toHaveURL(route.redirectsTo);
      await expect(page.locator('main')).toBeVisible();
      await expectNoErrorView(page);
      const heading = page.locator('main h1').first();
      await expect(heading, 'Seite hat eine Überschrift').toBeVisible();
      if (route.heading) await expect(heading).toContainText(route.heading);
      await testInfo.attach('bildschirm.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});

test.describe('Rundgang über die öffentlichen Seiten', () => {
  for (const route of publicRoutes) {
    test(route.name, async ({ page, seed }, testInfo) => {
      await page.goto(route.path(seed));
      await ready(page);
      if (route.redirectsTo) await expect(page).toHaveURL(route.redirectsTo);
      await expect(page.locator('h1').first()).toBeVisible();
      if (route.heading) await expect(page.locator('h1').first()).toContainText(route.heading);
      await testInfo.attach('bildschirm.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});
