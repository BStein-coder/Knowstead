/**
 * Bildschirmfotos der Oberfläche – zum Ansehen beim Entwerfen und zum Vergleichen von Aussehen und Farbschema.
 * Startet wie english-scan.mjs einen eigenen Server mit Wegwerf-Datenbank (e2e/support/instance.mjs).
 *
 * Aufruf (die Oberfläche muss gebaut sein):
 *   node shots.mjs [--look classic,paper,frost] [--scheme light,dark] [--views home,page,board] [--width 1440] [--height 900] [--full]
 *
 * Die Bilder landen in reports/shots/<aussehen>-<schema>/<ansicht>.png (nicht im Repository).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startInstance } from './support/instance.mjs';
import { views } from './support/views.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const looks = option('look', 'classic').split(',');
const schemes = option('scheme', 'light,dark').split(',');
const width = Number(option('width', 1440));
const height = Number(option('height', 900));
const full = args.includes('--full');
const wanted = option('views', '')
  .split(',')
  .filter(Boolean);

const instance = await startInstance({ port: process.env.E2E_SCAN_PORT ?? 3897, ui: 'en' });
let browser = null;
try {
  const { base, cookie, ids } = instance;
  const name = cookie.slice(0, cookie.indexOf('='));
  const value = cookie.slice(cookie.indexOf('=') + 1);
  browser = await chromium.launch(channel ? { channel } : {});
  const list = views(ids).filter(([view]) => !wanted.length || wanted.includes(view));
  for (const look of looks) {
    for (const scheme of schemes) {
      const dir = path.join(here, 'reports', 'shots', `${look}-${scheme}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const [view, url, storage, action] of list) {
        // Ein frischer Browserkontext je Ansicht: Die Einstellungen für die Ansicht (Plan als Tafel, Liste …) bleiben getrennt
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'en-GB' });
        await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
        await context.addInitScript(
          ([lookName, schemeName, extra]) => {
            localStorage.setItem('knowstead.locale', 'en');
            localStorage.setItem('knowstead.theme', schemeName);
            localStorage.setItem('knowstead.appearance', lookName);
            localStorage.setItem('knowstead.motion', 'reduced');
            for (const [key, entry] of Object.entries(extra ?? {})) localStorage.setItem(key, entry);
          },
          [look, scheme, storage ?? null],
        );
        const page = await context.newPage();
        try {
          await page.goto(base + url, { waitUntil: 'networkidle', timeout: 30_000 });
          if (action) await action(page);
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(dir, `${view}.png`), fullPage: full });
          console.log('ok', look, scheme, view);
        } catch (err) {
          console.log('FEHLER', look, scheme, view, String(err instanceof Error ? err.message : err).split('\n')[0]);
        }
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  await instance.stop();
}
console.log(`\nBilder: ${path.join(here, 'reports', 'shots')}`);
