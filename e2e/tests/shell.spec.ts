import type { Locator, Page } from '@playwright/test';
import { test, expect, ready } from './support/fixtures';
import { AUTH } from './support/data';

/**
 * Navigation als schwebende Glasebenen: Kopf- und Seitenleiste stehen mit Abstand zum Fensterrand, das Glas
 * ist im ausgelieferten Build wirklich unscharf (die Eigenschaft ging dort schon einmal verloren), der aktive
 * Eintrag trägt die Lichtmarke, im Seitenbaum leuchtet die Verbindungslinie zur geöffneten Seite – und auf
 * dem Handy ist die Seitenleiste eine Schublade über einem Schleier.
 */
const css = (locator: Locator, property: string, pseudo = '') =>
  locator.evaluate((el, [prop, ps]) => getComputedStyle(el, ps || undefined).getPropertyValue(prop), [property, pseudo]);
/** Die Ebenen erscheinen beim Laden mit kurzer Fahrt – gemessen wird erst, wenn sie an ihrem Platz stehen. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  expect(b, 'Element ist sichtbar').not.toBeNull();
  return b!;
};

test.describe('Schwebende Navigation', () => {
  test.use({ storageState: AUTH.admin, viewport: { width: 1440, height: 900 } });

  test('Kopf- und Seitenleiste schweben; das Glas ist unscharf; der aktive Eintrag trägt die Lichtmarke', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    const topbar = page.locator('.topbar');
    const sidebar = page.locator('.sidebar');
    // Beim Laden gleiten beide Ebenen herein (nur transform und opacity)
    const entering = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect instanceof KeyframeEffect && a.effect.target?.matches('.topbar, .sidebar'))
        .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((frame) => Object.keys(frame)))
        .filter((key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key)),
    );
    expect([...new Set(entering)].sort()).toEqual(['opacity', 'transform']);
    await settled(page);
    const top = await box(topbar);
    const side = await box(sidebar);
    const main = await box(page.locator('#main'));

    // Abstand zum Fensterrand ringsum, runde Ecken
    expect(top.x, 'Kopfleiste: Abstand links').toBeGreaterThanOrEqual(8);
    expect(top.y, 'Kopfleiste: Abstand oben').toBeGreaterThanOrEqual(8);
    expect(top.x + top.width, 'Kopfleiste: Abstand rechts').toBeLessThanOrEqual(1440 - 8);
    expect(side.x, 'Seitenleiste: Abstand links').toBeGreaterThanOrEqual(8);
    expect(side.y, 'Seitenleiste: Abstand zur Kopfleiste').toBeGreaterThanOrEqual(top.y + top.height + 8);
    expect(side.y + side.height, 'Seitenleiste: Abstand unten').toBeLessThanOrEqual(900 - 8);
    expect(parseFloat(await css(topbar, 'border-top-left-radius'))).toBeGreaterThan(8);
    expect(parseFloat(await css(sidebar, 'border-top-left-radius'))).toBeGreaterThan(8);
    // Der Hauptbereich beginnt bündig unter der Kopfleiste: Inhalt verschwindet an ihrer Kante, nicht im Freien
    expect(Math.abs(main.y - (top.y + top.height)), 'Hauptbereich schließt an die Kopfleiste an').toBeLessThanOrEqual(1);

    // Glas: Im Build stand zeitweise nur die Schreibweise mit -webkit- – außerhalb von Safari blieb es dann klar
    for (const surface of [topbar, sidebar]) expect(await css(surface, 'backdrop-filter')).toContain('blur(');
    await page.locator('.user-button').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await css(page.locator('.popover').last(), 'backdrop-filter')).toContain('blur(');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await css(page.locator('.modal').last(), 'backdrop-filter')).toContain('blur(');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Aktiver Eintrag: Lichtmarke links, als aktuelle Seite ausgewiesen; andere Einträge ohne Marke
    const active = sidebar.locator('.nav-link.active');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('aria-current', 'page');
    expect(await css(active, 'content', '::before')).not.toBe('none');
    expect(await css(active, 'width', '::before')).toBe('3px');
    const other = sidebar.locator('.nav-link:not(.active)').first();
    expect(await css(other, 'content', '::before')).toBe('none');

    // Lichtkegel folgt dem Zeiger auf einem Eintrag
    await other.hover();
    await expect(other).toHaveAttribute('data-pointer', '');

    // Kontrastmodus des Betriebssystems: Der aktive Eintrag bleibt erkennbar (Rahmen statt Fläche)
    await page.emulateMedia({ forcedColors: 'active' });
    expect(await css(active, 'outline-style')).toBe('solid');
    await page.emulateMedia({ forcedColors: 'none' });

    // Einstellung „reduziert“ (Terminalserver, Fernzugriff): keine Unschärfe, dafür deckendere Flächen
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduced'));
    for (const surface of [topbar, sidebar]) expect(await css(surface, 'backdrop-filter')).toBe('none');
    const alpha = await topbar.evaluate((el) => Number(/[\d.]+\)$/.exec(getComputedStyle(el).backgroundColor)?.[0].slice(0, -1) ?? 1));
    expect(alpha, 'Kopfleiste deckt stärker').toBeGreaterThanOrEqual(0.88);
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'full'));
  });

  test('Seitenbaum: Verbindungslinie zur geöffneten Seite leuchtet; die Leiste über der Seite schwebt über dem Inhalt', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.childPageId}`);
    await ready(page);
    await settled(page);
    const sidebar = page.locator('.sidebar');
    const row = sidebar.locator('.tree-row.active');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Unterseite Alpha');
    // Der Zweig mit der geöffneten Seite trägt die breitere Linie im Akzentverlauf, ein anderer Zweig die schmale
    const branch = sidebar.locator('.tree .tree').filter({ has: page.locator('.tree-row.active') }).first();
    expect(await css(branch, 'width', '::before')).toBe('2px');
    expect(await css(branch, 'background-image', '::before')).toContain('gradient');
    // Zeile im Baum: dieselbe aktive Fläche wie die Einträge darüber, aber ohne Marke (dort liegt beim Ziehen die Einfügelinie)
    expect(await css(row, 'background-image')).toContain('gradient');
    expect(await css(row, 'content', '::before')).toBe('none');

    // Leiste mit Brotkrumen: Glas mit Abstand, bleibt beim Scrollen oben stehen
    const toolbar = page.locator('.page-toolbar');
    expect(await css(toolbar, 'backdrop-filter')).toContain('blur(');
    expect(parseFloat(await css(toolbar, 'border-top-left-radius'))).toBeGreaterThan(8);
    const main = page.locator('#main');
    const before = await box(toolbar);
    await main.evaluate((el) => el.scrollTo(0, 400));
    await expect.poll(async () => (await box(toolbar)).y).toBeLessThanOrEqual(before.y);
    const mainBox = await box(main);
    const after = await box(toolbar);
    expect(after.y - mainBox.y, 'Leiste haftet mit Abstand unter der Kopfleiste').toBeGreaterThanOrEqual(8);
    expect(after.y - mainBox.y).toBeLessThanOrEqual(14);
  });

  test('„Auf dieser Seite“: Schiene mit leuchtendem Abschnitt', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.richPageId}`);
    await ready(page);
    const toc = page.locator('.toc-float');
    await expect(toc).toBeVisible();
    const links = toc.locator('a');
    expect(await links.count()).toBeGreaterThanOrEqual(3);
    // Jeder Eintrag trägt sein Stück der Schiene; beim aktiven Abschnitt (oben: der erste) ist es breiter und im Verlauf
    await expect(links.first()).toHaveClass(/active/);
    expect(await css(links.first(), 'width', '::before')).toBe('2px');
    expect(await css(links.first(), 'background-image', '::before')).toContain('gradient');
    expect(await css(links.nth(1), 'width', '::before')).toBe('1px');
    expect(await css(toc, 'backdrop-filter')).toContain('blur(');
  });
});

test.describe('Schublade der Seitenleiste auf dem Handy', () => {
  test.use({ storageState: AUTH.editor, viewport: { width: 400, height: 800 } });

  test('angedockte Kopfleiste; Schublade über einem Schleier, Tippen daneben schließt sie', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}`);
    await ready(page);
    const top = await box(page.locator('.topbar'));
    expect([top.x, top.y, top.width]).toEqual([0, 0, 400]);

    const sidebar = page.locator('.sidebar');
    const backdrop = page.locator('.sidebar-backdrop');
    // Geschlossen: weder sichtbar noch per Tastatur erreichbar; der Schleier fängt keine Klicks ab
    await expect(sidebar).toBeHidden();
    expect(await css(backdrop, 'pointer-events')).toBe('none');

    await page.getByRole('button', { name: 'Seitenleiste ein-/ausblenden' }).click();
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => (await box(sidebar)).x).toBeGreaterThanOrEqual(8);
    const side = await box(sidebar);
    expect(side.x + side.width, 'neben der Schublade bleibt Platz zum Schließen').toBeLessThanOrEqual(400 - 40);
    await expect.poll(() => css(backdrop, 'opacity')).toBe('1');
    // Deckend genug, dass der Inhalt dahinter die Einträge nicht stört
    expect(await css(sidebar, 'backdrop-filter')).toContain('blur(');

    await page.mouse.click(385, 500);
    await expect(sidebar).toBeHidden();
    await expect.poll(() => css(backdrop, 'pointer-events')).toBe('none');
  });
});
