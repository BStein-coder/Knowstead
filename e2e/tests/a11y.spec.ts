import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, ready } from './support/fixtures';
import { AUTH } from './support/data';
import { adminRoutes, publicRoutes, type RouteCase } from './support/routes';

/**
 * Barrierefreiheit (WCAG 2.1 A/AA) mit axe-core für jede Seite. Schwerwiegende Verstöße („critical“,
 * „serious“) lassen den Test scheitern; alle Befunde landen gesammelt in reports/a11y.json.
 */
const BLOCKING = new Set(['critical', 'serious']);

// Ohne Bewegung: Einblendende Hinweise (z. B. Live-Benachrichtigungen aus parallelen Tests) würden
// sonst mitten in der Animation mit halber Deckkraft gemessen.
test.use({ reducedMotion: 'reduce' });
const findings: Record<string, { id: string; impact: string; help: string; nodes: string[] }[]> = {};

test.afterAll(() => {
  const file = path.join(test.info().project.outputDir, '..', 'a11y.json');
  let existing: typeof findings = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* erster Lauf */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...findings }, null, 2));
});

async function audit(page: import('@playwright/test').Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Inhalte Dritter (eingebettete Diagramme) prüft axe nicht sinnvoll
    .exclude('.mermaid svg')
    .analyze();
  findings[name] = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  const blocking = result.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
  // Bei Kontrastfehlern die gemessenen Farben mit ausgeben – sonst lässt sich ein Befund nicht nachvollziehen
  const measured = (n: (typeof result.violations)[number]['nodes'][number]) => {
    const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
    return d?.contrastRatio ? ` [${d.fgColor} auf ${d.bgColor}: ${d.contrastRatio}]` : '';
  };
  expect(
    blocking.map((v) => `${v.impact}: ${v.id} – ${v.help} (${v.nodes.slice(0, 3).map((n) => n.target.join(' ') + measured(n)).join(' | ')})`),
    'schwerwiegende Barrieren',
  ).toEqual([]);
}

function sweep(routes: RouteCase[]) {
  for (const route of routes) {
    test(route.name, async ({ page, seed }) => {
      await page.goto(route.path(seed));
      await ready(page);
      await audit(page, route.name);
    });
  }
}

test.describe('Barrierefreiheit – angemeldet', () => {
  test.use({ storageState: AUTH.admin });
  sweep(adminRoutes);
});

test.describe('Barrierefreiheit – öffentlich', () => {
  sweep(publicRoutes);
});

test.describe('Barrierefreiheit – dunkles Design', () => {
  test.use({ storageState: AUTH.admin, colorScheme: 'dark' });
  sweep(adminRoutes.map((route) => ({ ...route, name: `${route.name} (dunkel)` })));
});

// Die Seiten vor der Anmeldung stehen auf der 3D-Bühne – deren Farben unterscheiden sich je Farbschema
test.describe('Barrierefreiheit – öffentlich, dunkles Design', () => {
  test.use({ colorScheme: 'dark' });
  sweep(publicRoutes.map((route) => ({ ...route, name: `${route.name} (dunkel)` })));
});
