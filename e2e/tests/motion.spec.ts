import type { Page } from '@playwright/test';
import { test, expect, ready } from './support/fixtures';
import { AUTH, VIEWER } from './support/data';

/**
 * Bewegung und 3D-Szenen: Die Szene ist Dekoration (stört weder Bedienung noch Hilfstechnik), animiert nur
 * transform und opacity, steht bei reduzierter Bewegung still – und die Einstellung dazu bleibt erhalten.
 */
const running = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
const noHorizontalOverflow = async (page: Page) => {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll, 'kein waagerechter Überlauf').toBeLessThanOrEqual(size.client);
};

test.describe('Bühne der Anmeldung', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('3D-Szene ist Dekoration; Name links, Formular rechts und sofort bedienbar', async ({ page }) => {
    await page.goto('/login');
    await ready(page);
    const scene = page.locator('.scene[data-scene="stage"]');
    await expect(scene).toBeAttached();
    await expect(scene).toHaveAttribute('aria-hidden', 'true');
    expect(await scene.locator('a, button, input, select, textarea, [tabindex]').count(), 'nichts Fokussierbares in der Szene').toBe(0);
    expect(await scene.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

    // Name der Installation steht links neben der Karte, nicht darunter oder darüber
    await expect(page.locator('.auth-intro-title')).toBeVisible();
    const intro = (await page.locator('.auth-intro').boundingBox())!;
    const card = (await page.locator('.auth-card').boundingBox())!;
    expect(intro.x + intro.width, 'Text endet vor der Karte').toBeLessThanOrEqual(card.x + 1);

    // Die Szene läuft – und bewegt ausschließlich transform und opacity (Arbeit der Grafikkarte)
    await expect.poll(() => running(page)).toBeGreaterThan(20);
    const props = await page.evaluate(() => {
      const found = new Set<string>();
      for (const animation of document.getAnimations()) {
        if (!(animation.effect instanceof KeyframeEffect) || !animation.effect.target?.closest('.scene')) continue;
        for (const frame of animation.effect.getKeyframes()) for (const key of Object.keys(frame)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) found.add(key);
      }
      return [...found].sort();
    });
    expect(props).toEqual(['opacity', 'transform']);

    // Bedienung unverändert: Feld hat den Fokus, Tippen landet darin
    const login = page.getByLabel('Benutzername oder E-Mail');
    await expect(login).toBeFocused();
    await page.keyboard.type('ada');
    await expect(login).toHaveValue('ada');
    await noHorizontalOverflow(page);
  });

  test('Kamera folgt dem Zeiger', async ({ page }) => {
    await page.goto('/login');
    await ready(page);
    const rig = page.locator('.scene-rig');
    await page.mouse.move(640, 400);
    const before = await rig.evaluate((el) => getComputedStyle(el).transform);
    await page.mouse.move(1200, 80);
    await expect.poll(() => rig.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
  });
});

test.describe('Bühne der Anmeldung – schmal', () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test('nur die Karte, Name der Installation in der Karte, kein Überlauf', async ({ page }) => {
    await page.goto('/login');
    await ready(page);
    await expect(page.locator('.auth-intro')).toBeHidden();
    await expect(page.locator('.auth-brand')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    const card = (await page.locator('.auth-card').boundingBox())!;
    expect(card.x, 'Karte hat Abstand zum linken Rand').toBeGreaterThanOrEqual(8);
    expect(card.x + card.width, 'Karte hat Abstand zum rechten Rand').toBeLessThanOrEqual(400 - 8);
    await noHorizontalOverflow(page);
  });
});

test.describe('Reduzierte Bewegung (Betriebssystem)', () => {
  test.use({ storageState: AUTH.admin, reducedMotion: 'reduce' });

  test('nichts bewegt sich, nichts bleibt verborgen', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(page.locator('.hero .scene')).toBeAttached();
    await expect.poll(() => running(page)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains('motion-ok'))).toBe(false);
    const hidden = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => getComputedStyle(el).opacity !== '1').length);
    expect(hidden, 'alle Karten sind sofort sichtbar').toBe(0);
    // Auch der Zeiger bewegt nichts: keine Neigung, keine Kamerafahrt
    const tile = page.locator('.quick-action').first();
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    await page.waitForTimeout(200);
    expect(await tile.evaluate((el) => el.style.getPropertyValue('--ry'))).toBe('');
    expect(await page.locator('.hero .scene-rig').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  });
});

test.describe('Startseite', () => {
  test.use({ storageState: AUTH.admin });

  test('Kachel neigt sich zum Zeiger; Kennzahl führt zur Bereichsübersicht', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(page.locator('.hero-title')).toBeVisible();
    const tile = page.locator('.quick-action').first();
    await tile.scrollIntoViewIfNeeded();
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    await expect.poll(() => tile.evaluate((el) => el.style.getPropertyValue('--ry'))).not.toBe('');
    await page.mouse.move(5, 5);
    await expect.poll(() => tile.evaluate((el) => el.style.getPropertyValue('--ry'))).toBe('');

    await page.locator('.hero-stat', { hasText: /Bereich/ }).click();
    await expect(page).toHaveURL(/\/spaces$/);
    await expect(page.getByRole('heading', { name: 'Bereiche', level: 1 })).toBeVisible();
  });

  test('Karten unterhalb des Fensters erscheinen beim Scrollen – auch nach einem Sprung ans Ende', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto('/');
    await ready(page);
    const cards = page.locator('[data-reveal]');
    expect(await cards.count()).toBeGreaterThan(1);
    await page.locator('main.main').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => !el.hasAttribute('data-revealed') || getComputedStyle(el).opacity !== '1').length))
      .toBe(0);
    // Kopfleiste hebt sich ab, sobald Inhalt darunter liegt
    expect(await page.locator('.app').evaluate((el) => el.hasAttribute('data-scrolled'))).toBe(true);
  });
});

test.describe('Einstellung „Animationen und 3D-Effekte“', () => {
  test.use({ storageState: AUTH.viewer });

  test('Benutzermenü schaltet um; die Wahl bleibt nach dem Neuladen erhalten', async ({ page }) => {
    const saved = () => page.waitForResponse((res) => res.url().endsWith('/api/v1/me/preferences') && res.request().method() === 'PATCH');
    const toggle = async () => {
      await page.getByRole('button', { name: VIEWER.displayName }).click();
      const done = saved();
      await page.getByRole('menuitem', { name: 'Animationen und 3D-Effekte' }).click();
      expect((await done).ok()).toBe(true);
    };
    await page.goto('/');
    await ready(page);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-motion', 'full');

    await toggle();
    await expect(html).toHaveAttribute('data-motion', 'reduced');
    await expect.poll(() => running(page)).toBe(0);

    await page.reload();
    await ready(page);
    await expect(html).toHaveAttribute('data-motion', 'reduced');
    await expect.poll(() => running(page)).toBe(0);

    // Zurückstellen – andere Tests mit diesem Konto sollen die volle Oberfläche sehen
    await toggle();
    await expect(html).toHaveAttribute('data-motion', 'full');
  });
});

test.describe('Fehlerseite', () => {
  test.use({ storageState: AUTH.admin });

  test('unbekannte Adresse: Szene im Hintergrund, Überschrift und Weg zurück im Vordergrund', async ({ page }) => {
    await page.goto('/gibt-es-nicht');
    await ready(page);
    await expect(page.locator('.scene[data-scene="lost"]')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Zur Startseite' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
