import type { Page } from '@playwright/test';
import { test, expect, ready } from './support/fixtures';
import { AUTH, type Seed } from './support/data';
import { adminRoutes, publicRoutes, type RouteCase } from './support/routes';
import { measureLayout, type LayoutFindings } from './support/layout-measure';

/**
 * Layout-Messung über alle Seiten in mehreren Fensterbreiten: keine Überlappungen, nichts verdeckt, nichts
 * über den Rand, kein abgeschnittener Text, kein seitliches Scrollen.
 *
 * Läuft nur auf Wunsch (rund 80 Seiten × 5 Breiten dauern einige Minuten):
 *   npm run test:sweep            – alles
 *   npm --prefix e2e run sweep -- -g "Startseite"
 *   E2E_SWEEP_WIDTHS=1280,400     – andere Breiten
 *   E2E_APPEARANCE=frost          – mit dem Aussehen „Papier“ oder „Frost“ (Vorgabe: Klassisch); Farbschema dunkel: E2E_SCHEME=dark
 * Die einzelnen Fälle, die dabei schon einmal aufgefallen sind, hält layout.spec.ts dauerhaft fest.
 */
const WIDTHS = (process.env.E2E_SWEEP_WIDTHS ?? '1600,1280,1024,820,400').split(',').map(Number);

// Gemessen wird der Ruhezustand: Einstiegs- und Einblendanimationen würden Positionen verfälschen
test.use({ reducedMotion: 'reduce', colorScheme: process.env.E2E_SCHEME === 'dark' ? 'dark' : 'light' });

const APPEARANCE = process.env.E2E_APPEARANCE;
test.beforeEach(async ({ page }) => {
  if (APPEARANCE) await page.addInitScript((value) => localStorage.setItem('knowstead.appearance', value), APPEARANCE);
});

function report(width: number, f: LayoutFindings): string[] {
  return [
    ...f.overlaps.map((o) => `@${width}: überlappt – ${o.a} × ${o.b} (oben: ${o.onTop})`),
    ...f.covered.map((c) => `@${width}: verdeckt – ${c.element} von ${c.by}`),
    ...f.offscreen.map((o) => `@${width}: über den Rand – ${o.element}`),
    ...f.clipped.map((c) => `@${width}: abgeschnitten – ${c.element} (${c.content} px Inhalt in ${c.width} px)`),
    ...(f.horizontalScroll ? [`@${width}: Seite lässt sich ${f.horizontalScroll} px seitlich scrollen`] : []),
  ];
}

async function measureAt(page: Page, url: string, settle?: (page: Page) => Promise<void>): Promise<string[]> {
  const problems: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 800 ? 820 : 900 });
    await page.goto(url);
    await ready(page);
    if (settle) await settle(page);
    await page.waitForTimeout(350);
    problems.push(...report(width, await page.evaluate(measureLayout)));
  }
  return problems;
}

function sweep(routes: RouteCase[]) {
  for (const route of routes) {
    test(route.name, async ({ page, seed }) => {
      test.setTimeout(180_000);
      expect(await measureAt(page, route.path(seed)), 'Befunde der Layout-Messung').toEqual([]);
    });
  }
}

test.describe('Layout-Messung – angemeldet', () => {
  test.use({ storageState: AUTH.admin });
  sweep(adminRoutes);

  // Der Aufgabenplan hat drei Ansichten und einen Dialog mit zwei Spalten
  const board = (seed: Seed) => `/s/${seed.spaceKey}/tasks?board=${seed.boardId}`;
  for (const view of ['board', 'list', 'timeline'] as const) {
    test(`Aufgabenplan – Ansicht ${view}`, async ({ page, seed }) => {
      test.setTimeout(180_000);
      await page.addInitScript((v) => localStorage.setItem('knowstead.tasks.view', v), view);
      expect(await measureAt(page, board(seed)), 'Befunde der Layout-Messung').toEqual([]);
    });
  }
  test('Aufgabenplan – Aufgabendialog', async ({ page, seed }) => {
    test.setTimeout(180_000);
    const problems = await measureAt(page, `${board(seed)}&task=${seed.taskId}`, async (p) => {
      await p.getByRole('dialog', { name: 'Aufgabe' }).waitFor();
    });
    expect(problems, 'Befunde der Layout-Messung').toEqual([]);
  });
});

test.describe('Layout-Messung – ohne Anmeldung', () => {
  sweep(publicRoutes);
});
