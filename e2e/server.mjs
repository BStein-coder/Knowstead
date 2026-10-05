/**
 * Startet einen frischen Knowstead-Server für die Oberflächentests: eigenes Datenverzeichnis (e2e/.data),
 * die gebaute Oberfläche aus web/dist und feste Adresse. Playwright beendet den Prozess nach dem Lauf.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = process.env.E2E_PORT ?? '3899';
const dataDir = path.join(here, '.data');

if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) {
  console.error('Die Oberfläche ist nicht gebaut – bitte zuerst im Projektordner „npm run build“ ausführen.');
  process.exit(1);
}

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

Object.assign(process.env, {
  NODE_ENV: 'production',
  KNOWSTEAD_SKIP_ENV_FILE: '1',
  DATA_DIR: dataDir,
  PORT: port,
  HOST: '127.0.0.1',
  BASE_URL: `http://127.0.0.1:${port}`,
  WEB_DIST_DIR: path.join(root, 'web', 'dist'),
  PLUGINS_DIR: path.join(root, 'plugins'),
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  TRUST_PROXY: 'false',
  COOKIE_SECURE: 'false',
});

await import(pathToFileURL(path.join(root, 'server', 'src', 'index.ts')).href);
