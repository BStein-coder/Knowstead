// Startet die Layout-Messung über alle Seiten (tests/sweep.spec.ts). Sie gehört nicht zum normalen Testlauf,
// weil sie einige Minuten dauert; dieses Skript schaltet sie über E2E_SWEEP frei – unter Windows wie Linux.
// Aufruf: node sweep.mjs [weitere Playwright-Argumente, z. B. -g "Startseite"]
// Anderes Aussehen: E2E_APPEARANCE=glass (oder paper); dunkel: E2E_SCHEME=dark
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(process.execPath, [cli, 'test', '--project=sweep', ...process.argv.slice(2)], {
  cwd: here,
  stdio: 'inherit',
  env: { ...process.env, E2E_SWEEP: '1' },
});
process.exit(result.status ?? 1);
