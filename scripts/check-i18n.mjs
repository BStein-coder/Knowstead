/**
 * Prüft die Übersetzungen der Oberfläche (Teil von npm run lint):
 *  1. Jeder verwendete Textschlüssel t('bereich.schluessel') existiert im deutschen und englischen Wörterbuch –
 *     fehlende Schlüssel würden sonst unbemerkt als Rohtext erscheinen.
 *  2. Keine fest eingebauten deutschen Texte außerhalb der Wörterbücher (Zeichenketten, Vorlagen, JSX-Text) –
 *     sie blieben in der englischen Oberfläche deutsch.
 * Aufruf: node scripts/check-i18n.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const load = async (name) => (await import(pathToFileURL(path.join(root, 'i18n', name)).href)).default;
const dictionaries = { de: await load('de.ts'), en: await load('en.ts') };
const ts = createRequire(import.meta.url)('typescript');

/** Bewusst deutsche Texte – mit Begründung */
const ALLOWED_FILES = {
  'api/client.ts': 'zweisprachige Netzwerkmeldungen, die vor dem Laden der Wörterbücher gebraucht werden',
  'editor/suggestions.tsx': 'Suchbegriffe des Befehlsmenüs sind absichtlich deutsch und englisch',
};
const GERMAN =
  /[äöüÄÖÜß]|\b(und|oder|nicht|Bitte|Seite|Seiten|Bereich|Speichern|Abbrechen|Löschen|Einstellungen|Benutzer|Gruppe|Vorlage|Aufgabe|Neue|Keine|Kein|Zurück|Schließen|Hinzufügen|Bearbeiten|Erstellen|Datei|Anhang|Kommentar|Fehler|Wird|wird|werden|kann|Zur|Zum|Diese|dieser|Hilfe|anzeigen|einfügen|umschalten|Fett|Kursiv|Zitat|Aufzählung|Überschrift)\b/;

const has = (dict, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict) !== undefined;
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : walk(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });

const problems = [];
for (const file of walk(root)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file).split(path.sep).join('/');
  for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g)) {
    const missing = Object.entries(dictionaries)
      .filter(([, dict]) => !has(dict, match[1]))
      .map(([lang]) => lang);
    if (missing.length) problems.push(`${relative}: ${match[1]} fehlt in ${missing.join(', ')}`);
  }

  if (ALLOWED_FILES[relative]) continue;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
    else if (ts.isJsxText(node)) text = node.text.trim();
    const parent = node.parent;
    const technical = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || (ts.isCallExpression(parent) && /^console\./.test(parent.expression.getText(sf))));
    if (text && !technical && GERMAN.test(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      problems.push(`${relative}:${line + 1}: fester deutscher Text „${text.replace(/\s+/g, ' ').slice(0, 60)}“ – bitte über t() und die Wörterbücher`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(`Übersetzungen unvollständig:\n${[...new Set(problems)].join('\n')}`);
  process.exit(1);
}
console.log('Übersetzungen vollständig.');
