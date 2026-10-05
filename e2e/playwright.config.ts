import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_PORT ?? 3899);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Browser: unter Windows das vorhandene Microsoft Edge (kein Download nötig), sonst das von
 * Playwright installierte Chromium (`npx playwright install chromium`). Überschreibbar mit E2E_CHANNEL.
 */
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './tests',
  outputDir: './reports/artifacts',
  // Ein gemeinsamer Server mit einer Datenbank – die Tests legen eigene Daten mit eindeutigen Namen an.
  workers: Number(process.env.E2E_WORKERS ?? 2),
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Windows meldet unter Last gelegentlich net::ERR_NO_BUFFER_SPACE (Socket-Engpass des Betriebssystems, kein
  // Anwendungsfehler). Ein Wiederholungsversuch fängt das ab; so bestandene Tests stehen im Bericht als „flaky“.
  retries: Number(process.env.E2E_RETRIES ?? (process.env.CI || process.platform === 'win32' ? 1 : 0)),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    baseURL,
    channel,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testIgnore: [/global\.setup\.ts/, /mobile\.spec\.ts/, /sweep\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], channel },
    },
    // Layout-Messung über alle Seiten und Breiten: dauert einige Minuten, läuft nur auf Wunsch (npm run test:sweep)
    ...(process.env.E2E_SWEEP
      ? [
          {
            name: 'sweep',
            dependencies: ['setup'],
            testMatch: /sweep\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } },
          },
        ]
      : []),
  ],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server.mjs',
    cwd: here,
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(port) },
  },
});
