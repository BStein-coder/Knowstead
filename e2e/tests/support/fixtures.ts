import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readSeed, type Seed } from './data';

/** Konsolenmeldungen, die kein Fehler der Anwendung sind. */
const IGNORED_CONSOLE = [
  /Failed to load resource: the server responded with a status of 4\d\d/, // erwartete 4xx (Rechte, Validierung) prüfen die Tests selbst
  /Download the React DevTools/,
];

interface Fixtures {
  seed: Seed;
  /** Fehler, die während des Tests im Browser auftraten (JavaScript, Konsole, Serverfehler 5xx). */
  browserErrors: string[];
}

export const test = base.extend<Fixtures>({
  seed: async ({}, use) => {
    await use(readSeed());
  },
  browserErrors: async ({}, use) => {
    await use([]);
  },
  page: async ({ page, browserErrors }, use, testInfo) => {
    // Langsamen Läufer nachstellen: E2E_CPU_THROTTLE=4 lässt den Browser viermal so langsam rechnen
    const throttle = Number(process.env.E2E_CPU_THROTTLE ?? 1);
    if (throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
    page.on('pageerror', (err) => browserErrors.push(`JavaScript-Fehler: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) browserErrors.push(`Konsole: ${msg.text()}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 500) browserErrors.push(`Serverfehler ${res.status()}: ${res.request().method()} ${res.url()}`);
    });
    await use(page);
    if (browserErrors.length) {
      await testInfo.attach('browser-fehler.txt', { body: browserErrors.join('\n'), contentType: 'text/plain' });
    }
    expect(browserErrors, 'Fehler im Browser während des Tests').toEqual([]);
  },
});

export { expect };

/** Wartet, bis die Anwendung geladen hat (keine Ladeanzeige im Hauptbereich). */
export async function ready(page: Page): Promise<void> {
  // Die Startanzeige aus index.html verschwindet, sobald React zum ersten Mal rendert
  await expect(page.locator('#root > .boot')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('main .loading, .auth-page .loading, #root > .loading')).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Wartet, bis Ein- und Ausblendanimationen fertig sind. Wer Positionen misst, braucht das: Dialoge gleiten beim
 * Öffnen ein, und zwei getrennte Messungen (jede ein eigener Aufruf an den Browser) liegen auf einem langsamen
 * Rechner in verschiedenen Phasen der Bewegung – ein Versatz, den es im Ruhezustand nicht gibt. Auch halbtransparente
 * Zwischenstände verfälschen die Kontrastprüfung.
 * Nur laufende Animationen auf der Zeitachse des Dokuments: Endlosschleifen (3D-Szene), angehaltene und an das
 * Scrollen gekoppelte Animationen (Lesefortschritt, Kamerafahrt) werden von selbst nie fertig.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** Barrierefreiheit eines geöffneten Zustands (z. B. Dialog) nach WCAG 2.1 AA – ohne schwerwiegende Verstöße. */
export async function expectAccessible(page: Page, include?: string): Promise<void> {
  await settled(page);
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  const blocking = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  // Bei Kontrastfehlern die gemessenen Farben mit ausgeben – sonst lässt sich ein Befund nicht nachvollziehen
  const measured = (n: (typeof result.violations)[number]['nodes'][number]) => {
    const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
    return d?.contrastRatio ? ` [${d.fgColor} auf ${d.bgColor}: ${d.contrastRatio}]` : '';
  };
  expect(
    blocking.map((v) => `${v.impact}: ${v.id} – ${v.help} (${v.nodes.map((n) => n.target.join(' ') + measured(n)).slice(0, 3).join(' | ')})`),
    `Barrieren${include ? ` in ${include}` : ''}`,
  ).toEqual([]);
}

/** Prüft, dass keine Fehleransicht (Router-Absturz, Ladefehler einer Ansicht) zu sehen ist. */
export async function expectNoErrorView(page: Page): Promise<void> {
  // Überschrift des Standard-Absturzbildschirms von React Router – nicht bloß der Text (steht z. B. im Änderungsprotokoll)
  await expect(page.getByRole('heading', { name: /Unexpected Application Error/ })).toHaveCount(0);
  await expect(page.locator('[data-error-view]')).toHaveCount(0);
}
