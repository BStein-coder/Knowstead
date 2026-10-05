#!/usr/bin/env node
/**
 * Verweise in der Dokumentation prüfen: Jede relative Verknüpfung in einer Markdown-Datei muss auf eine
 * vorhandene Datei zeigen, jeder Anker (`#abschnitt`) auf eine vorhandene Überschrift – nach den Regeln, mit
 * denen GitHub Anker aus Überschriften bildet. Externe Adressen (http, mailto) werden nicht aufgerufen.
 *
 *   node scripts/check-docs.mjs            alle *.md im Projekt (ohne node_modules, release, data …)
 *   node scripts/check-docs.mjs README.md  nur die genannten Dateien
 *
 * Das Änderungsprotokoll ist ausgenommen: Es nennt Dateien und Abschnitte, wie sie zum jeweiligen Stand hießen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'release', 'data', 'dist', '.git', '.data', '.auth', 'reports', 'test-results', '.claude']);
const SKIP_FILES = new Set(['CHANGELOG.md']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(path.join(dir, entry.name));
    return entry.isFile() && entry.name.endsWith('.md') && !SKIP_FILES.has(entry.name) ? [path.join(dir, entry.name)] : [];
  });
}

/** Text ohne Codeblöcke und Inline-Code – dort stehen Beispiele, keine Verweise */
function withoutCode(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Anker einer Überschrift, wie GitHub ihn bildet */
function slug(heading) {
  return heading
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Verknüpfung in der Überschrift: nur der Text
    .replace(/[*_`~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

const anchorCache = new Map();
function anchors(file) {
  if (!anchorCache.has(file)) {
    const found = new Set();
    const seen = new Map();
    const text = fs.readFileSync(file, 'utf8').replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      const base = slug(match[1]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      found.add(count ? `${base}-${count}` : base);
    }
    for (const match of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) found.add(match[1]);
    anchorCache.set(file, found);
  }
  return anchorCache.get(file);
}

const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => path.resolve(f)) : walk(root);
const problems = [];
let checked = 0;
for (const file of files) {
  const text = withoutCode(fs.readFileSync(file, 'utf8'));
  // [Text](ziel) und ![Bild](ziel) – das Ziel endet am ersten Leerzeichen (danach käme ein Titel)
  for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = match[1];
    // Externe Adressen und Pfade ab der Wurzel (Adressen der laufenden Anwendung wie /api/docs) sind keine Dateien
    if (/^(https?:|mailto:|tel:|data:|\/)/i.test(target)) continue;
    checked++;
    const line = text.slice(0, match.index).split('\n').length;
    const [rawPath, rawAnchor] = target.split('#');
    let destination = file;
    if (rawPath) {
      destination = path.resolve(path.dirname(file), decodeURIComponent(rawPath));
      if (!fs.existsSync(destination)) {
        problems.push(`${path.relative(root, file)}:${line}  Ziel fehlt: ${target}`);
        continue;
      }
    }
    if (rawAnchor !== undefined && rawAnchor !== '' && fs.statSync(destination).isFile() && destination.endsWith('.md')) {
      const anchor = decodeURIComponent(rawAnchor).toLowerCase();
      if (!anchors(destination).has(anchor)) problems.push(`${path.relative(root, file)}:${line}  Anker fehlt: ${target}`);
    }
  }
}

if (problems.length) {
  console.error(`Verweise in der Dokumentation: ${problems.length} fehlerhaft`);
  for (const problem of problems) console.error(`  ${problem.replaceAll('\\', '/')}`);
  process.exit(1);
}
console.log(`Verweise in der Dokumentation in Ordnung (${files.length} Dateien, ${checked} Verweise).`);
