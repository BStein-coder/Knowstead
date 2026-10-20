/**
 * Englische Oberfläche nach deutschen Resten absuchen: deutsche Wörter, Umlaute, deutsche Datums- und
 * Zahlenschreibweise – in sichtbarem Text, in Beschriftungen (title, aria-label, placeholder) und in dem, was in
 * Feldern steht. Der Browser läuft dabei auf Deutsch, die Oberfläche auf Englisch: So fällt auch auf, was der
 * Sprache des Browsers statt der der Oberfläche folgt.
 *
 * Das Skript startet selbst einen Server mit frischer, englisch eingerichteter Datenbank (Beispielinhalte und
 * Handbuch auf Englisch) in einem Wegwerf-Ordner und räumt ihn danach weg. Es gehört nicht zum normalen
 * Testlauf – die Wortliste ist eine Heuristik, Befunde brauchen einen Blick. Bewusst Deutsches steht unten in
 * ERLAUBT, jeweils mit Begründung.
 *
 * Aufruf (die Oberfläche muss gebaut sein):  node english-scan.mjs [Filter als regulärer Ausdruck]
 * Im Projektordner:                          npm run test:english
 *
 * Gegenprobe: Mit E2E_SCAN_UI=de läuft die Oberfläche auf Deutsch – dann MUSS die Suche fündig werden. Bleibt
 * sie auch dort leer, sieht sie die Seiten nicht mehr (Anmeldung, Selektoren) und ein leeres Ergebnis der
 * eigentlichen Suche wäre nichts wert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startInstance } from './support/instance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
/** Sprache der Oberfläche: Englisch – oder Deutsch für die Gegenprobe */
const ui = process.env.E2E_SCAN_UI === 'de' ? 'de' : 'en';

/* ---------- Seiten ---------- */

const ADMIN = ['', 'setup', 'users', 'groups', 'permissions', 'directory', 'sso', 'ai', 'mail', 'spaces', 'settings', 'templates', 'export', 'webhooks', 'connectors', 'plugins', 'audit', 'backups', 'maintenance'];

/** [Name, Adresse, angemeldet, Einstellungen im Browser, Aktion nach dem Laden] */
function views({ pageId, boardId }) {
  const plan = `/s/TEAM/tasks?board=${boardId}`;
  const click = (selector) => async (page) => {
    await page.locator(selector).first().click();
    await page.waitForTimeout(500);
  };
  return [
    ['login', '/login', false],
    ['forgot-password', '/forgot-password', false],
    ['home', '/', true],
    ['spaces', '/spaces', true],
    ['search', '/search?q=page', true],
    ['activity', '/activity', true],
    ['tags', '/tags', true],
    ['my-tasks', '/tasks', true],
    ['projects', '/projects', true],
    ['calendar', '/calendar', true],
    ['plan-calendar', plan, true, { 'knowstead.tasks.view': 'calendar' }],
    ['content-reviews', '/content-reviews', true],
    ['read-confirmations', '/read-confirmations', true],
    ['changes', '/changes', true],
    ['analytics', '/analytics', true],
    ['reviews', '/reviews', true],
    ['drafts', '/drafts', true],
    ['notifications', '/notifications', true],
    ['journal', '/journal', true],
    ['profile', '/profile', true],
    ['profile-preferences', '/profile/preferences', true],
    ['profile-password', '/profile/password', true],
    ['profile-tokens', '/profile/tokens', true],
    ['profile-sessions', '/profile/sessions', true],
    ['profile-sign-in', '/profile/sign-in', true],
    ['space', '/s/TEAM', true],
    ['page', `/s/TEAM/p/${pageId}`, true],
    ['editor', `/s/TEAM/edit/${pageId}`, true],
    ['new-page', '/s/TEAM/new', true],
    ['history', `/s/TEAM/history/${pageId}`, true],
    ['changelog', '/s/TEAM/changelog', true],
    ['trash', '/s/TEAM/trash', true],
    ['board', plan, true, { 'knowstead.tasks.view': 'board' }],
    ['list', plan, true, { 'knowstead.tasks.view': 'list' }],
    ['timeline-days', plan, true, { 'knowstead.tasks.view': 'timeline', 'knowstead.tasks.zoom': 'week' }],
    ['timeline-weeks', plan, true, { 'knowstead.tasks.view': 'timeline', 'knowstead.tasks.zoom': 'month' }],
    ['timeline-months', plan, true, { 'knowstead.tasks.view': 'timeline', 'knowstead.tasks.zoom': 'quarter' }],
    ['task-dialog', plan, true, { 'knowstead.tasks.view': 'board' }, click('.task-card')],
    ['space-settings', '/s/TEAM/settings', true],
    ['space-permissions', '/s/TEAM/settings/permissions', true],
    ['space-members', '/s/TEAM/settings/members', true],
    ['space-approvals', '/s/TEAM/settings/approvals', true],
    ['space-templates', '/s/TEAM/settings/templates', true],
    ['space-data', '/s/TEAM/settings/data', true],
    ['space-danger', '/s/TEAM/settings/danger', true],
    ['user-menu', '/', true, null, click('.user-button')],
    [
      'palette',
      '/',
      true,
      null,
      async (page) => {
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(500);
      },
    ],
    [
      'slash-menu',
      `/s/TEAM/edit/${pageId}`,
      true,
      null,
      async (page) => {
        await page.locator('.ProseMirror').first().click();
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/');
        await page.waitForTimeout(600);
      },
    ],
    ...ADMIN.map((name) => [`admin-${name || 'overview'}`, `/admin/${name}`.replace(/\/$/, ''), true]),
  ];
}

/* ---------- Erkennung ---------- */

// Deutsche Wörter, die in englischen Texten nicht vorkommen (bewusst ohne „die“, „war“, „hat“, „in“, „an“ …)
const WORDS =
  /(?<![A-Za-z])(und|oder|nicht|kein|keine|mit|für|von|auf|ist|sind|wird|werden|wurde|Seite|Seiten|Bereich|Bereiche|Aufgabe|Aufgaben|Speichern|Abbrechen|Löschen|Bearbeiten|Schließen|Hinzufügen|Woche|KW|Heute|Morgen|Gestern|Uhr|Sicherung|Einstellungen|Benutzer|Gruppe|Gruppen|Datei|Dateien|Anhang|Anhänge|Suche|Vorlage|Vorlagen|bitte|Bitte|Fehler|Hinweis|Dokumentation|Wissen|fällig|erledigt|offen|neu|alle|aus|ein|eine|zur|zum|bei|nach|vor|über|unter|Mit|anmelden|Stand)(?![A-Za-z])/;
const UMLAUT = /[äöüÄÖÜß]/;
// „14. Okt.“, „05.10.2026“, „05.10.“ (nicht: Versionsnummern und IP-Adressen), „100.000“
const DATE = /\b\d{1,2}\.\s?(Jan|Feb|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez)\b\.?|\b\d{1,2}\.\d{1,2}\.(?:\d{4}\b|(?![\d.]))|(?<![\d.])\d{1,3}\.\d{3}(?![\d.])/;

/** Bewusst Deutsches in der englischen Oberfläche – mit Begründung */
const ERLAUBT = [
  [/^(HANDBUCH|@value: HANDBUCH)$/, 'Schlüssel des Handbuch-Bereichs (Adresse bestehender Verweise)'],
  [/^Deutsch( \(German\))?$/, 'Sprachwahl nennt jede Sprache in ihrer eigenen'],
  [/Europe\/Berlin/, 'Zeitzone'],
  [/deu\+eng/, 'Sprachkürzel der Texterkennung'],
];

function finding(text) {
  if (ERLAUBT.some(([pattern]) => pattern.test(text))) return null;
  if (UMLAUT.test(text)) return 'Umlaut';
  if (DATE.test(text)) return 'Datum/Zahl';
  const word = WORDS.exec(text);
  return word ? `Wort „${word[0]}“` : null;
}

/* global document, NodeFilter -- collect() läuft im Browser, nicht in Node.js */

/** Sichtbarer Text, Beschriftungen und Feldinhalte – ohne Seiteninhalte, die Menschen geschrieben haben. */
function collect() {
  const out = new Set();
  const content = '.ProseMirror, .page-content, .doc-view, .release-notes, [aria-hidden="true"]';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest(`script, style, ${content}`)) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text.length > 1) out.add(text);
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    if (el.closest(content)) continue;
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const text = el.getAttribute(attr);
      if (text && text.trim().length > 1) out.add(`@${attr}: ${text.trim()}`);
    }
  }
  // Auch was in Feldern steht: Vorgaben, die der Server liefert, erscheinen dort als Wert
  for (const el of document.querySelectorAll('input, textarea')) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['password', 'hidden', 'checkbox', 'radio', 'file', 'color', 'range'].includes(type) || el.closest(content)) continue;
    const text = (el.value || '').replace(/\s+/g, ' ').trim();
    if (text.length > 1) out.add(`@value: ${text}`);
  }
  return [...out];
}

/* ---------- Ablauf ---------- */

const findings = [];
let visited = 0;
let browser = null;
let instance = null;
try {
  instance = await startInstance({ port: process.env.E2E_SCAN_PORT ?? 3898, ui });
  const { base, cookie, ids } = instance;
  browser = await chromium.launch(channel ? { channel } : {});
  const name = cookie.slice(0, cookie.indexOf('='));
  const value = cookie.slice(cookie.indexOf('=') + 1);
  for (const [view, url, signedIn, storage, action] of views(ids)) {
    if (only && !only.test(view)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    if (signedIn) await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(
      ([locale, extra]) => {
        localStorage.setItem('knowstead.locale', locale);
        for (const [key, entry] of Object.entries(extra ?? {})) localStorage.setItem(key, entry);
      },
      [ui, storage ?? null],
    );
    const page = await context.newPage();
    try {
      await page.goto(base + url, { waitUntil: 'networkidle', timeout: 30_000 });
      if (action) await action(page);
      await page.waitForTimeout(600);
      // Eine Ansicht, die zur Anmeldung umleitet, wäre nicht durchsucht – das darf nicht still durchgehen
      if (signedIn && new URL(page.url()).pathname === '/login') throw new Error('nicht angemeldet – zur Anmeldeseite umgeleitet');
      visited++;
      for (const text of await page.evaluate(collect)) {
        const hit = finding(text);
        if (hit) findings.push(`${view.padEnd(22)} ${hit.padEnd(18)} ${text.slice(0, 140)}`);
      }
    } catch (err) {
      findings.push(`${view.padEnd(22)} ${'nicht geladen'.padEnd(18)} ${String(err instanceof Error ? err.message : err).split('\n')[0].slice(0, 140)}`);
    }
    await context.close();
  }
} catch (err) {
  findings.push(`Abbruch: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser?.close();
  await instance?.stop();
}

const unique = [...new Set(findings)];
fs.mkdirSync(path.join(here, 'reports'), { recursive: true });
fs.writeFileSync(path.join(here, 'reports', 'english-scan.txt'), unique.length ? `${unique.join('\n')}\n` : '');
if (ui === 'de') {
  // Gegenprobe: In der deutschen Oberfläche muss die Suche fündig werden – auf jeder Ansicht mehrfach
  const seen = unique.length >= visited * 3 && visited > 0;
  console.log(`Gegenprobe mit deutscher Oberfläche: ${visited} Ansichten, ${unique.length} Auffälligkeiten – ${seen ? 'die Suche sieht die Seiten' : 'ZU WENIGE: Die Suche sieht die Seiten nicht mehr'}.`);
  process.exit(seen ? 0 : 1);
}
for (const line of unique) console.log(line);
console.log(`\n${visited} Ansichten der englischen Oberfläche durchsucht – ${unique.length ? `${unique.length} Auffälligkeiten (reports/english-scan.txt)` : 'keine deutschen Reste gefunden'}.`);
process.exit(unique.length || !visited ? 1 : 0);
