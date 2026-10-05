import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Die Liste aus scripts/package.mjs – das Skript selbst baut beim Einbinden sofort ein Paket, deshalb hier gelesen. */
function included(): string[] {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'package.mjs'), 'utf8');
  const list = /const INCLUDE = \[([\s\S]*?)\n\];/.exec(source);
  assert.ok(list, 'Liste INCLUDE in scripts/package.mjs gefunden');
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('Installationspaket: Was die mitgelieferten Skripte einbinden, gehört zum Paket', () => {
  const entries = included();
  const covered = (file: string) => entries.some((entry) => file === entry || file.startsWith(`${entry}/`));
  assert.ok(entries.includes('scripts/install.mjs') && entries.includes('scripts/prepare.mjs'));

  // Verweise der Skripte untereinander: Fehlt eine eingebundene Datei im Paket, bricht der Assistent erst beim
  // Installieren ab – im Quelltext läuft alles
  const missing: string[] = [];
  for (const entry of entries.filter((name) => /^scripts\/[^/]+\.mjs$/.test(name))) {
    const source = fs.readFileSync(path.join(ROOT, entry), 'utf8');
    for (const match of source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      // Bezugsort ist der Ordner des Skripts – oder der Programmordner bei Code, den es mit »node -e« dort startet
      const candidates = [path.posix.normalize(path.posix.join(path.posix.dirname(entry), match[1])), path.posix.normalize(match[1])];
      const target = candidates.find((file) => !file.startsWith('..') && fs.existsSync(path.join(ROOT, file)));
      assert.ok(target, `${entry} bindet ${match[1]} ein – die Datei gibt es nicht`);
      if (!covered(target)) missing.push(`${entry} → ${target}`);
    }
  }
  assert.deepEqual(missing, [], 'in scripts/package.mjs (INCLUDE) aufnehmen');

  // Was Assistenten und Startskripte aufrufen
  for (const file of ['scripts/lang.mjs', 'scripts/install/linux/extras.sh', 'scripts/install/windows/Install-Knowstead.ps1', 'scripts/install/windows/Knowstead-Dienst.ps1', '.env.example', '.env.example.en', 'update.sh']) {
    assert.ok(covered(file), `${file} gehört ins Paket`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} ist vorhanden`);
  }
});

test('Vorlagen der Konfiguration: deutsch und englisch mit denselben Einträgen', () => {
  const entriesOf = (name: string) =>
    fs
      .readFileSync(path.join(ROOT, name), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^#?[A-Z_]+=/.test(line))
      // Der Platzhalter für den Serverschlüssel ist ein Text – er unterscheidet sich je Sprache
      .map((line) => (line.startsWith('#KNOWSTEAD_SECRET=') ? '#KNOWSTEAD_SECRET=…' : line));
  assert.deepEqual(entriesOf('.env.example.en'), entriesOf('.env.example'));
  assert.ok(entriesOf('.env.example').length >= 12);
});
