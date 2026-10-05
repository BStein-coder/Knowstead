import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client, createTestApp } from './helpers.ts';
import { EN_TEXTS } from '../src/i18n/en.ts';
import { FREE_TEXT_MIN_FIXED, localizeValue, translate } from '../src/core/i18n.ts';
import { GLOBAL_PERMISSIONS, ROLE_LABELS } from '../src/core/permissions.ts';
import { EVENT_TYPES } from '../src/core/events.ts';
import { TOKEN_SCOPES } from '../src/modules/tokens/service.ts';
import { renderMail } from '../src/modules/mail/templates.ts';
import { ensureBaseData } from '../src/seed/index.ts';

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ERROR_FACTORIES = new Set(['badRequest', 'unauthorized', 'forbidden', 'notFound', 'conflict', 'tooLarge', 'unprocessable']);

/** Alle Fehlermeldungen im Servercode – Zeichenketten und Vorlagen (eingesetzte Werte als „{}“). */
function errorMessages(): { text: string; file: string }[] {
  const found: { text: string; file: string }[] = [];
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  const texts = (node: import('typescript').Node): string[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) return [[node.head.text, ...node.templateSpans.map((span) => `{}${span.literal.text}`)].join('')];
    if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue), ...texts(node.whenFalse)];
    return [];
  };
  for (const file of walk(SRC)) {
    if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: import('typescript').Node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression.getText(source).split('.').pop() ?? '';
        const args = node.arguments ?? [];
        const message = ERROR_FACTORIES.has(callee) ? args[0] : callee === 'HttpError' ? args[2] : callee === 'SsoError' ? args[1] : undefined;
        if (message) for (const text of texts(message)) found.push({ text, file: path.relative(SRC, file) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

test('Englisch: Katalog vollständig, Übersetzung und Serverantworten', async (t) => {
  await t.test('Jede Fehlermeldung im Code ist übersetzt', () => {
    const messages = errorMessages();
    assert.ok(messages.length > 250, `nur ${messages.length} Meldungen gefunden`);
    const missing = messages.filter((m) => /[a-zäöüß]{3}/i.test(m.text) && !Object.hasOwn(EN_TEXTS, m.text)).map((m) => `${m.file}: ${m.text}`);
    assert.deepEqual([...new Set(missing)], [], 'fehlende englische Texte in server/src/i18n/en.ts');
  });

  await t.test('Kataloge der Oberfläche sind übersetzt', () => {
    const labels = [
      ...Object.values(GLOBAL_PERMISSIONS).flatMap((p) => [p.label, p.description]),
      ...Object.values(ROLE_LABELS),
      ...Object.values(TOKEN_SCOPES),
      ...Object.values(EVENT_TYPES).map((e) => e.label),
    ];
    assert.deepEqual(labels.filter((l) => !Object.hasOwn(EN_TEXTS, l)), []);
  });

  await t.test('Platzhalter stimmen überein', () => {
    const broken = Object.entries(EN_TEXTS).filter(([de, en]) => {
      const count = (s: string) => (s.match(/\{\}/g) ?? []).length;
      return count(de) !== count(en) && !/\{\d\}/.test(en);
    });
    assert.deepEqual(broken, []);
  });

  await t.test('Übersetzen mit eingesetzten Werten', () => {
    assert.equal(translate('Seite nicht gefunden', 'en'), 'Page not found');
    assert.equal(translate('Seite nicht gefunden', 'de'), 'Seite nicht gefunden');
    assert.equal(translate('Die Seite wurde zwischenzeitlich von Anna Schmidt geändert (Version 7)', 'en'), 'The page has been changed by Anna Schmidt in the meantime (version 7)');
    assert.equal(translate('Erika hat „Richtlinie: Passwörter (v2)“ kommentiert', 'en'), 'Erika commented on “Richtlinie: Passwörter (v2)”');
    assert.equal(translate('Aufgabe fällig morgen: Server patchen', 'en'), 'Task due tomorrow: Server patchen');
    assert.equal(translate('Freigegeben: Handbuch', 'en'), 'Approved: Handbuch');
    assert.equal(translate('Ein eigener Text ohne Übersetzung', 'en'), 'Ein eigener Text ohne Übersetzung');
    assert.equal(translate('Ungültige Eingabe: body/title must NOT have fewer than 1 characters', 'en'), 'Invalid input: body/title must NOT have fewer than 1 characters');
    // Freitext (Kommentarauszüge, Notizen) bleibt unangetastet
    assert.equal(translate('Bitte als Vorlage nutzen', 'en'), 'Bitte als Vorlage nutzen');
    assert.equal(translate('Bild: siehe Anhang', 'en', FREE_TEXT_MIN_FIXED), 'Bild: siehe Anhang');
    assert.equal(translate('Die Frist ist am 01.10.2026 abgelaufen.', 'en', FREE_TEXT_MIN_FIXED), 'The deadline expired on 01/10/2026.');
  });

  await t.test('Datums- und Zahlenangaben in eingesetzten Werten folgen der Sprache', () => {
    // Benachrichtigungen werden auf Deutsch gespeichert – das Datum darin entsteht, bevor die Sprache feststeht
    assert.equal(translate('Die Frist ist am 5.10.2026 abgelaufen.', 'en'), 'The deadline expired on 05/10/2026.');
    assert.equal(translate('Vertretung für Ada Lovelace: 5.10.2026 – 19.10.2026', 'en'), 'Deputy for Ada Lovelace: 05/10/2026 – 19/10/2026');
    assert.equal(translate('Die Sicherung vom 5.10.2026, 03:00:12 ist gescheitert: Platte voll', 'en'), 'The backup of 05/10/2026, 03:00:12 failed: Platte voll');
    assert.equal(translate('Aufgabe fällig am Montag, 05.10.: Bericht abgeben', 'en'), 'Task due on Monday, 05/10: Bericht abgeben');
    assert.equal(translate('Die Aufgabe war am Freitag, 02.10. fällig.', 'en'), 'The task was due on Friday, 02/10.');
    assert.equal(translate('Das Archiv enthält zu viele Dateien (höchstens 100.000).', 'en'), 'The archive contains too many files (at most 100,000).');
    // Nur ganze Werte: Ein Datum in einem Seitentitel bleibt, wie es geschrieben wurde
    assert.equal(translate('Lesebestätigung bis 5.10.2026: „Protokoll vom 5.10.2026“', 'en'), 'Read confirmation by 05/10/2026: “Protokoll vom 5.10.2026”');
    assert.equal(localizeValue('Version 1.250'), 'Version 1.250');
    assert.equal(localizeValue('10.0.0.5'), '10.0.0.5');
    // Deutsch bleibt unverändert
    assert.equal(translate('Die Frist ist am 5.10.2026 abgelaufen.', 'de'), 'Die Frist ist am 5.10.2026 abgelaufen.');
  });

  await t.test('E-Mail in der Sprache der empfangenden Person', () => {
    const brand = { siteName: 'Wiki', accent: '#2563eb', baseUrl: 'https://wiki.example' };
    const mail = renderMail(
      brand,
      'Wiki: Passwort zurücksetzen',
      { heading: 'Neues Passwort festlegen', paragraphs: ['Hallo Ada,'], action: { label: 'Passwort festlegen', url: '/reset' }, reason: 'Du erhältst diese E-Mail, weil jemand ein neues Passwort für dein Konto angefordert hat. Warst du das nicht, kannst du sie ignorieren.' },
      'en',
    );
    assert.equal(mail.subject, 'Wiki: reset password');
    assert.match(mail.html, /<html lang="en">/);
    assert.match(mail.html, /Set a new password/);
    assert.match(mail.text, /Hello Ada,/);
    assert.match(mail.text, /Settings: https:\/\/wiki\.example\/profile/);
    assert.doesNotMatch(mail.html, /Benachrichtigungen einstellen/);
  });

  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await t.test('Serverantworten folgen Kopfzeile, Profil und Browsersprache', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      const login = (headers: Record<string, string>) =>
        ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: 'admin', password: 'falsch' }, headers: { 'x-knowstead-client': 'test', ...headers } });
      assert.equal((await login({})).json().error.message, 'Benutzername oder Passwort ist falsch');
      assert.equal((await login({ 'x-knowstead-locale': 'en' })).json().error.message, 'Username or password is incorrect');
      assert.equal((await login({ 'accept-language': 'en-US,en;q=0.9' })).json().error.message, 'Username or password is incorrect');
      assert.equal((await login({ 'accept-language': 'en-US', 'x-knowstead-locale': 'de' })).json().error.message, 'Benutzername oder Passwort ist falsch');

      const german = await ctx.app.inject({ method: 'GET', url: '/api/v1/pages/99999' });
      const english = await ctx.app.inject({ method: 'GET', url: '/api/v1/pages/99999', headers: { 'x-knowstead-locale': 'en' } });
      assert.equal(english.statusCode, german.statusCode);
      assert.notEqual(english.json().error.message, german.json().error.message);
      assert.equal(english.json().error.message, translate(german.json().error.message, 'en'));
      const route = await ctx.app.inject({ method: 'GET', url: '/api/v1/gibt-es-nicht', headers: { 'x-knowstead-locale': 'en' } });
      assert.equal(route.json().error.message, 'Route GET /api/v1/gibt-es-nicht does not exist');

      // Persönliche Einstellung gilt ohne Kopfzeile
      await admin.patch('/api/v1/me/preferences', { locale: 'en' });
      const notFound = await admin.get('/api/v1/pages/99999');
      assert.match(notFound.body.error.message, /^Page not found/);
      const catalog = await admin.get('/api/v1/catalog');
      assert.equal(catalog.body.globalPermissions.admin.label, 'System administration');
      assert.equal(catalog.body.spaceRoles.find((r: { role: string }) => r.role === 'admin').label, 'Manage space');
      assert.equal(catalog.body.events.find((e: { type: string }) => e.type === 'auth.login').label, 'Sign-in');
      assert.equal(catalog.body.tokenScopes.read, 'Read (GET requests)');
      await admin.patch('/api/v1/me/preferences', { locale: 'de' });
      assert.equal((await admin.get('/api/v1/catalog')).body.globalPermissions.admin.label, 'Systemadministration');

      // Beschriftungen der Exporte (Makros, Kopfdaten) folgen der Sprache
      await admin.post('/api/v1/spaces', { key: 'LANG', name: 'Sprache' });
      const page = await admin.post('/api/v1/pages', { spaceKey: 'LANG', title: 'Makros', content: '<h2>Eins</h2><div data-type="toc"></div><div data-type="children"></div>' });
      const exportHtml = (locale: string) =>
        admin.request('GET', `/api/v1/pages/${page.body.id}/export?format=html`, undefined, { 'x-knowstead-locale': locale }).then((res) => res.raw);
      const de = await exportHtml('de');
      assert.match(de, /<html lang="de">/);
      assert.match(de, /<strong>Inhalt<\/strong>/);
      assert.match(de, /Keine Unterseiten/);
      assert.match(de, /zuletzt geändert am/);
      const en = await exportHtml('en');
      assert.match(en, /<html lang="en">/);
      assert.match(en, /<strong>Contents<\/strong>/);
      assert.match(en, /No child pages/);
      assert.match(en, /last changed on .* by Ada/);
      const readme = await ctx.app.inject({ method: 'GET', url: '/api/v1/spaces/LANG/export?format=markdown', headers: { cookie: (admin as unknown as { cookie: string }).cookie, 'x-knowstead-client': 'test', 'x-knowstead-locale': 'en' } });
      const { strFromU8, unzipSync } = await import('fflate');
      assert.match(strFromU8(unzipSync(new Uint8Array(readme.rawPayload))['README.md']), /## Contents[\s\S]*_Exported on /);
    });

    await t.test('Benachrichtigungen werden beim Abruf übersetzt', async () => {
      const me = (await admin.get('/api/v1/auth/me')).body.user;
      ctx.s.notifications.push({ userId: me.id, type: 'task.assigned', title: 'Aufgabe für dich: Server patchen', body: 'Fälligkeitsdatum: 2026-10-01', link: '/' });
      const de = await admin.get('/api/v1/me/notifications');
      assert.equal(de.body.items[0].title, 'Aufgabe für dich: Server patchen');
      const en = await admin.request('GET', '/api/v1/me/notifications', undefined, { 'x-knowstead-locale': 'en' });
      assert.equal(en.body.items[0].title, 'Task for you: Server patchen');
      assert.equal(en.body.items[0].body, 'Due date: 2026-10-01');
    });
  } finally {
    await ctx.close();
  }

  await t.test('Plugins: Name, Beschreibung und Einstellungen in der Sprache der Person', async () => {
    const withPlugins = await createTestApp({ env: { PLUGINS_DIR: path.join(SRC, '..', '..', 'plugins') } });
    try {
      const admin = new Client(withPlugins.app);
      await admin.post('/api/v1/setup', { siteName: 'Wiki', username: 'admin', displayName: 'Ada', password: 'secret-secret', sampleContent: false });
      const list = async (locale: string) =>
        (await admin.request('GET', '/api/v1/admin/plugins', undefined, { 'x-knowstead-locale': locale })).body as { id: string; name: string; description: string; settingsSchema: { key: string; label: string; help?: string; options?: { value: string; label: string }[] }[] }[];
      const de = await list('de');
      const en = await list('en');
      assert.equal(de.find((p) => p.id === 'chat-notify')?.name, 'Chat-Benachrichtigungen');
      const chat = en.find((p) => p.id === 'chat-notify')!;
      assert.equal(chat.name, 'Chat notifications');
      assert.equal(chat.settingsSchema.find((s) => s.key === 'url')?.label, 'Webhook URL');
      assert.equal(chat.settingsSchema.find((s) => s.key === 'format')?.options?.find((o) => o.value === 'json')?.label, 'Raw JSON (custom receiver)');
      assert.equal(chat.settingsSchema.find((s) => s.key === 'format')?.options?.find((o) => o.value === 'teams')?.label, 'Microsoft Teams');
      for (const plugin of en) {
        const texts = [plugin.name, plugin.description, ...plugin.settingsSchema.flatMap((s) => [s.label, s.help ?? '', ...(s.options ?? []).map((o) => o.label)])];
        assert.ok(texts.every((text) => !/[äöüß]|\b(und|oder|der|die|das|für)\b/.test(text)), `${plugin.id}: ${texts.join(' | ')}`);
      }
      // Pflichtfeld-Meldung mit übersetzter Beschriftung
      const missing = await admin.request('PUT', '/api/v1/admin/plugins/chat-notify/settings', { url: '' }, { 'x-knowstead-locale': 'en' });
      assert.equal(missing.status, 400);
      assert.match(missing.body.error.message, /Webhook URL/);
    } finally {
      await withPlugins.close();
    }
  });

  await t.test('Englische Installation: Handbuch, Vorlagen, Beispiele und Journal auf Englisch', async () => {
    const en = await createTestApp();
    try {
      const admin = new Client(en.app);
      const setup = await admin.post('/api/v1/setup', { siteName: 'Wiki', username: 'admin', displayName: 'Ada', password: 'secret-secret', locale: 'en', sampleContent: true });
      assert.equal(setup.status, 200, setup.raw);
      const spaces = (await admin.get('/api/v1/spaces')).body as { key: string; name: string }[];
      assert.equal(spaces.find((sp) => sp.key === 'HANDBUCH')?.name, 'Handbook');
      assert.equal(spaces.find((sp) => sp.key === 'TEAM')?.name, 'Team space');
      const tree = (await admin.get('/api/v1/spaces/HANDBUCH/tree')).body as { title: string }[];
      const titles = JSON.stringify(tree);
      assert.match(titles, /Getting started/);
      assert.match(titles, /Read confirmations/);
      assert.doesNotMatch(titles, /Erste Schritte/);
      const templates = en.s.db.all<{ name: string }>("SELECT name FROM templates WHERE builtin_key IN ('meeting', 'journal')");
      assert.deepEqual(templates.map((x) => x.name).sort(), ['Daily note', 'Meeting minutes']);
      const day = await admin.request('POST', '/api/v1/journal/today', { date: '2026-03-02' }, { 'x-knowstead-locale': 'en' });
      assert.equal(day.status, 200, day.raw);
      assert.equal(en.s.pages.get(day.body.id)?.title, '2026-03-02 Monday');

      // Systemgruppen englisch – und beim nächsten Start nicht erneut auf Deutsch angelegt
      const groups = (await admin.get('/api/v1/groups')).body as { name: string; description: string; isSystem: boolean }[];
      assert.deepEqual(groups.filter((g) => g.isSystem).map((g) => g.name).sort(), ['Administrators', 'Users']);
      assert.ok(groups.every((g) => !/Benutzer|Administratoren/.test(`${g.name} ${g.description}`)), JSON.stringify(groups));
      ensureBaseData(en.s);
      assert.equal(en.s.db.value<number>('SELECT COUNT(*) FROM groups WHERE is_system = 1'), 2);
      assert.equal(en.s.groups.systemGroup('admin')?.name, 'Administrators');
      assert.ok((await admin.get('/api/v1/auth/me')).body.user.isAdmin);

      // Spalten neuer Pläne und automatische Änderungsnotizen
      const board = await admin.request('POST', '/api/v1/spaces/TEAM/boards', { name: 'Plan' }, { 'x-knowstead-locale': 'en' });
      assert.deepEqual(board.body.buckets.map((b: { name: string }) => b.name), ['To do', 'In progress', 'Review', 'Done']);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Notes', content: '<p>x</p>' });
      const revisions = await admin.request('GET', `/api/v1/pages/${page.body.id}/revisions`, undefined, { 'x-knowstead-locale': 'en' });
      assert.equal(revisions.body.items[0].changeNote, 'Page created');
      assert.equal(en.s.db.value<string>('SELECT change_note FROM page_revisions WHERE page_id = ?', page.body.id), 'Seite erstellt', 'gespeichert bleibt der Originaltext');
      const german = await admin.request('GET', `/api/v1/pages/${page.body.id}/revisions`, undefined, { 'x-knowstead-locale': 'de' });
      assert.equal(german.body.items[0].changeNote, 'Seite erstellt');

      // Aktualisieren bleibt in der Sprache der Einrichtung, auch wenn die Standardsprache später wechselt
      en.s.settings.update({ defaultLocale: 'de' });
      const sync = await admin.post('/api/v1/admin/maintenance/sync-handbook');
      assert.equal(sync.status, 200, sync.raw);
      assert.doesNotMatch(JSON.stringify((await admin.get('/api/v1/spaces/HANDBUCH/tree')).body), /Erste Schritte/);
    } finally {
      await en.close();
    }
  });
});
