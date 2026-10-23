import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, VIEWER } from './support/data';
import { adminRoutes } from './support/routes';

/**
 * Aussehen der Oberfläche („Klassisch“, „Glas“, „Papier“, „Frost“): Wahl im Benutzermenü und im Profil, Speicherung im Konto
 * und auf dem Gerät, Rückfälle bei reduzierter Bewegung – und Barrierefreiheit (Kontrast!) jeder Kombination aus
 * Aussehen und Farbschema auf den wichtigsten Seiten.
 */
const LOOKS = ['glass', 'paper', 'frost'] as const;
const SCHEMES = ['light', 'dark'] as const;

/** Seiten mit unterschiedlichen Bausteinen: Karten, Tabellen, Reiter, Tafel, Editor, Formulare, Verwaltung */
const AUDITED = [
  'Startseite',
  'Bereiche',
  'Seite (Rich-Text mit Makros)',
  'Editor',
  'Aufgabenplaner des Bereichs',
  'Projekte',
  'Kalender',
  'Suche',
  'Profil – Einstellungen',
  'Administration – Übersicht',
  'Administration – Benutzer',
  'Administration – Einstellungen',
  'Bereichseinstellungen – Allgemein',
];

const radiusOf = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim());

test.describe('Wahl des Aussehens', () => {
  test.use({ storageState: AUTH.viewer });

  test('Benutzermenü und Profil wechseln das Aussehen; die Wahl gilt im Konto und bleibt nach dem Neuladen', async ({ page }) => {
    const html = page.locator('html');
    const saved = () => page.waitForResponse((res) => res.url().endsWith('/api/v1/me/preferences') && res.request().method() === 'PATCH');
    const choose = async (name: string) => {
      await page.getByRole('button', { name: VIEWER.displayName }).click();
      const done = saved();
      await page.getByRole('menuitem', { name }).click();
      expect((await done).ok()).toBe(true);
    };

    await page.goto('/');
    await ready(page);
    await expect(html).toHaveAttribute('data-appearance', 'classic');
    expect(await radiusOf(page)).toBe('16px');

    await choose('Glas');
    await expect(html).toHaveAttribute('data-appearance', 'glass');
    expect(await radiusOf(page), 'Glas rundet weiter').toBe('22px');
    // Aussehen und Farbschema sind unabhängig: Der Wechsel lässt hell/dunkel unangetastet
    const scheme = await html.getAttribute('data-theme');
    expect(['light', 'dark']).toContain(scheme);

    await page.reload();
    await ready(page);
    await expect(html).toHaveAttribute('data-appearance', 'glass');

    // Wahl des Kontos gilt auch auf einem Gerät ohne gespeicherte Wahl
    await page.evaluate(() => localStorage.removeItem('knowstead.appearance'));
    await page.reload();
    await ready(page);
    await expect(html).toHaveAttribute('data-appearance', 'glass');

    await choose('Papier');
    await expect(html).toHaveAttribute('data-appearance', 'paper');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()), 'Papier bringt die Tintenfarbe mit').not.toBe('');
    expect(await html.getAttribute('data-theme')).toBe(scheme);

    // Frost: die Glasoptik ohne Glas – keine Unschärfe hinter den Flächen, keine 3D-Szene, deckende Kopfleiste
    await choose('Frost');
    await expect(html).toHaveAttribute('data-appearance', 'frost');
    const lean = await page.evaluate(() => ({
      topbarBlur: getComputedStyle(document.querySelector('.topbar')!).backdropFilter,
      cardBlur: getComputedStyle(document.querySelector('.card')!).backdropFilter,
      scene: getComputedStyle(document.querySelector('.hero .scene')!).display,
      ring: getComputedStyle(document.querySelector('.topbar')!, '::before').display,
    }));
    expect(lean, 'Frost zeichnet ohne Unschärfe, Maske und Szene').toEqual({ topbarBlur: 'none', cardBlur: 'none', scene: 'none', ring: 'none' });

    // Dieselbe Wahl im Profil
    await page.goto('/profile/preferences');
    await ready(page);
    const select = page.getByLabel('Aussehen');
    await expect(select).toHaveValue('frost');
    const done = saved();
    await select.selectOption({ label: 'Glas' });
    expect((await done).ok()).toBe(true);
    await expect(html).toHaveAttribute('data-appearance', 'glass');

    // Zurückstellen – andere Tests mit diesem Konto sollen die klassische Oberfläche sehen
    await choose('Klassisch');
    await expect(html).toHaveAttribute('data-appearance', 'classic');
  });
});

test.describe('Wahl des Aussehens – ohne Anmeldung', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('ohne Anmeldung gilt die Wahl dieses Geräts', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('knowstead.appearance', 'paper'));
    await page.goto('/login');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  });

  test('Unbekanntes auf diesem Gerät fällt auf „Klassisch“ zurück', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('knowstead.appearance', 'neon'));
    await page.goto('/login');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'classic');
  });
});

test.describe('Aussehen – Rückfälle', () => {
  test.use({ storageState: AUTH.admin });

  for (const look of LOOKS) {
    test(`${look}: bei „Bewegung reduziert“ entfällt die Unschärfe hinter dem Glas`, async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('knowstead.appearance', value);
        localStorage.setItem('knowstead.motion', 'reduced');
      }, look);
      await page.goto('/');
      await ready(page);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', look);
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
      const blur = await page.evaluate(() => ({
        topbar: getComputedStyle(document.querySelector('.topbar')!).backdropFilter,
        card: getComputedStyle(document.querySelector('.card')!).backdropFilter,
      }));
      expect(blur).toEqual({ topbar: 'none', card: 'none' });
    });
  }
});

for (const look of LOOKS) {
  for (const scheme of SCHEMES) {
    test.describe(`Barrierefreiheit – ${look}, ${scheme === 'dark' ? 'dunkel' : 'hell'}`, () => {
      // Ohne Bewegung: Einblendende Hinweise würden sonst mitten in der Animation mit halber Deckkraft gemessen
      test.use({ storageState: AUTH.admin, colorScheme: scheme, reducedMotion: 'reduce' });

      for (const route of adminRoutes.filter((r) => AUDITED.includes(r.name))) {
        test(route.name, async ({ page, seed }) => {
          await page.addInitScript((value) => localStorage.setItem('knowstead.appearance', value), look);
          await page.goto(route.path(seed));
          await ready(page);
          await expect(page.locator('html')).toHaveAttribute('data-appearance', look);
          await expectAccessible(page);
        });
      }
    });
  }
}

test.describe('Aussehen – Layout', () => {
  test.use({ storageState: AUTH.admin });

  for (const look of LOOKS) {
    for (const width of [400, 1280]) {
      test(`${look}: kein waagerechter Überlauf bei ${width} px`, async ({ page, seed }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.addInitScript((value) => localStorage.setItem('knowstead.appearance', value), look);
        for (const path of ['/', `/s/${seed.spaceKey}/tasks`, '/profile/preferences', '/admin']) {
          await page.goto(path);
          await ready(page);
          const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(size.scroll, `${path}: kein waagerechter Überlauf`).toBeLessThanOrEqual(size.client);
        }
      });
    }
  }
});
