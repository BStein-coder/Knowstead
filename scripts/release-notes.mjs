#!/usr/bin/env node
/**
 * Versionshinweise einer Version aus CHANGELOG.md ausgeben (für GitHub-Releases).
 *   node scripts/release-notes.mjs 2.0.0 > notes.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version).replace(/^v/, '');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`Version ${version} steht nicht in CHANGELOG.md.`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith('## ['));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
console.log(`${body}

---

**Installation:** Paket für das Betriebssystem herunterladen und entpacken, dann unter Windows
\`Knowstead-Installation.cmd\` bzw. unter Linux \`sudo bash install.sh\` ausführen – Anleitung in
[docs/INSTALLATION.md](https://github.com/${process.env.GITHUB_REPOSITORY ?? 'BStein-coder/Knowstead'}/blob/v${version}/docs/INSTALLATION.md).
Prüfsummen stehen in den \`.sha256\`-Dateien.`);
