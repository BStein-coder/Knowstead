import { test, expect, ready } from './support/fixtures';

/** Start der Anwendung: Startanzeige, Hinweis bei blockierten Programmdateien, saubere Antwort für veraltete Verweise. */
test.describe('Start der Anwendung', () => {
  test('Startanzeige verschwindet nach dem Laden', async ({ page }) => {
    await page.goto('/login');
    await ready(page);
    await expect(page.getByText('Knowstead wird geladen')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('Hinweis, wenn Programmdateien nicht laden', async ({ page, browserErrors }) => {
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto('/login');
    // Die Verzögerung der Hinweise überspringen
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
    await expect(page.getByRole('status')).toContainText('Das dauert ungewöhnlich lange');
    await expect(page.getByRole('link', { name: 'neu laden' })).toBeVisible();
    // Die absichtlich blockierten Dateien erzeugen erwartete Konsolenmeldungen
    browserErrors.splice(0);
  });

  test('Einstellungen im Browser aus der Zeit vor der Umbenennung ziehen beim ersten Laden um', async ({ page }) => {
    // So lagen sie bis Version 1.9 im Speicher des Browsers (Schlüssel mit „doku.“)
    await page.addInitScript(() => {
      if (sessionStorage.getItem('probe.umzug')) return;
      sessionStorage.setItem('probe.umzug', '1');
      localStorage.setItem('doku.theme', 'dark');
      localStorage.setItem('doku.locale', 'en');
      sessionStorage.setItem('doku.sso.skipAuto', '1');
    });
    await page.goto('/login');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(stored.local['knowstead.theme']).toBe('dark');
    expect(stored.local['knowstead.locale']).toBe('en');
    expect(stored.session['knowstead.sso.skipAuto']).toBe('1');
    expect([...Object.keys(stored.local), ...Object.keys(stored.session)].filter((key) => key.startsWith('doku.'))).toEqual([]);
  });

  test('Veraltete Programmdatei liefert 404 statt der Startseite', async ({ request }) => {
    const response = await request.get('/assets/veraltet-0000.js');
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).not.toContain('html');
  });
});
