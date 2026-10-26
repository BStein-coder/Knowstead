import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { Client, createTestApp } from './helpers.ts';
import { userFilterFor } from '../src/modules/directory/service.ts';
import type { DirectorySettings } from '../src/core/settings.ts';
import { sniffImage } from '../src/modules/export/model.ts';
import { htmlToText, sanitizeComment, sanitizeRichText } from '../src/core/html.ts';
import { htmlDiff, lineDiff } from '../src/core/diff.ts';
import { renderMarkdown } from '../src/core/markdown.ts';
import { mediaWikiToHtml } from '../src/modules/transfer/wiki/mediawiki.ts';
import { dokuWikiToHtml } from '../src/modules/transfer/wiki/dokuwiki.ts';
import { xwikiToHtml } from '../src/modules/transfer/wiki/xwiki.ts';

/**
 * Regressionstests zur Gesamtprüfung vom 26.10.2026. Gefunden wurden sie mit Rundläufen über alle Routen
 * (kodierte Pfade, „Kanarien“-Scan, Fuzz mit seltsamen Werten) – nicht beim Lesen des Quelltexts.
 */
test('Kodierte Pfade erreichen dieselben Schutzmaßnahmen wie die normalen', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
    const cookie = (admin as unknown as { cookie: string }).cookie;
    const send = (method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}, payload?: object) => ctx.app.inject({ method, url, headers, payload });

    // Der Router dekodiert „%61“ zu „a“ – die Prüfungen dürfen sich nicht an der rohen Adresse festmachen
    const csrf = await send('POST', '/%61pi/v1/spaces', { cookie }, { key: 'NEU', name: 'Neu' });
    assert.equal(csrf.statusCode, 403, 'Cookie-Sitzung ohne Client-Kopf: CSRF-Schutz greift auch hier');
    assert.equal(JSON.parse(csrf.body).error.code, 'csrf');

    const me = await send('GET', '/%61pi/v1/auth/me', { cookie });
    assert.equal(me.statusCode, 200, 'die Anmeldung wird erkannt, statt mit Fehler 500 zu enden');
    assert.equal(JSON.parse(me.body).user.username, 'admin');
    assert.equal(me.headers['cache-control'], 'no-store', 'API-Antworten bleiben ungespeichert');

    // Die API-Beschreibung ist nur für Angemeldete – auch über den kodierten Pfad
    const docs = await send('GET', '/%61pi/docs/json');
    assert.equal(docs.statusCode, 401);
    assert.equal((await send('GET', '/%61pi/docs/json', { cookie })).statusCode, 200);

    // Ein Token ohne Schreibrecht bleibt auch hier ein Token ohne Schreibrecht
    admin.token = null;
    const created = await admin.post('/api/v1/me/tokens', { name: 'nur lesen', scopes: ['read'] });
    assert.equal(created.status, 200, created.raw);
    const readOnly = await send('POST', '/%61pi/v1/spaces', { authorization: `Bearer ${created.body.token}` }, { key: 'NEU', name: 'Neu' });
    assert.equal(readOnly.statusCode, 403);
    assert.equal(JSON.parse(readOnly.body).error.code, 'insufficient_scope');

    // Unbekannte Pfade unter /api bleiben JSON-Fehler, auch kodiert
    const missing = await send('GET', '/%61pi/v1/gibt-es-nicht', { cookie });
    assert.equal(missing.statusCode, 404);
    assert.equal(JSON.parse(missing.body).error.code, 'not_found');
  } finally {
    await ctx.close();
  }
});

test('Zu große Versatzangaben und unbekannte Kennungen ergeben Fehler 400/404 statt 500', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const mia = (await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' })).body.id as number;

    // 99999999999999999999 lässt sich nicht als ganze Zahl an SQLite übergeben
    for (const url of ['/api/v1/me/notifications', '/api/v1/admin/users', '/api/v1/admin/audit', '/api/v1/admin/mail', '/api/v1/search']) {
      const res = await admin.get(`${url}?${url.endsWith('/search') ? 'q=a&' : ''}offset=99999999999999999999`);
      assert.equal(res.status, 400, `${url}: ${res.raw}`);
    }
    assert.equal((await admin.get('/api/v1/admin/users?offset=1000')).status, 200, 'normale Werte gehen weiter');

    // Gruppen und Personen, die es nicht gibt, bringen die Mitgliedschaft nicht durcheinander
    assert.equal((await admin.patch(`/api/v1/admin/users/${mia}`, { groupIds: [0] })).status, 404);
    assert.equal((await admin.patch(`/api/v1/admin/users/${mia}`, { groupIds: [99999] })).status, 404);
    assert.equal((await admin.put('/api/v1/admin/groups/2/members', { userIds: [0] })).status, 404);
    assert.equal((await admin.post('/api/v1/admin/users', { username: 'bob', displayName: 'Bob', password: 'geheim-geheim', groupIds: [99999] })).status, 404);
    // …und der Benutzer bleibt dabei, wie er war (die Änderung wird zurückgenommen)
    const groups = (await admin.get('/api/v1/admin/users?q=mia')).body.items[0].groups as { id: number }[];
    assert.ok(groups.length > 0, 'Mias Gruppen sind noch da');
    assert.equal((await admin.get('/api/v1/admin/users?q=bob')).body.items.length, 0, 'Bob wurde nicht halb angelegt');
  } finally {
    await ctx.close();
  }
});

test('Passwort ändern: nur in der Sitzung und mit Ratenbegrenzung', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const created = await admin.post('/api/v1/me/tokens', { name: 'schreiben', scopes: ['read', 'write'] });
    assert.equal(created.status, 200, created.raw);

    const viaToken = new Client(ctx.app);
    viaToken.token = created.body.token as string;
    const refused = await viaToken.post('/api/v1/auth/password', { current: 'geheim-geheim', next: 'ein-neues-passwort' });
    assert.equal(refused.status, 403, 'mit einem API-Token lässt sich das Passwort nicht ändern');

    // In der Sitzung geht es weiter – bis die Ratenbegrenzung (20 je 10 Minuten) greift
    const wrong = await admin.post('/api/v1/auth/password', { current: 'falsch', next: 'ein-neues-passwort' });
    assert.equal(wrong.status, 400);
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await admin.post('/api/v1/auth/password', { current: 'falsch', next: 'ein-neues-passwort' });
      if (res.status === 429) limited++;
    }
    assert.ok(limited > 0, 'zu viele Versuche werden gebremst');
  } finally {
    await ctx.close();
  }
});

test('Gelöschte Personen und Gruppen vererben nichts – und ihre Nummern werden nicht wieder vergeben', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    const setup = await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const adminId = setup.body.user.id as number;
    const user = async (username: string) => {
      const res = await admin.post('/api/v1/admin/users', { username, displayName: username, password: 'geheim-geheim', email: `${username}@example.com` });
      assert.equal(res.status, 200, res.raw);
      return res.body.id as number;
    };
    const login = async (username: string) => {
      const client = new Client(ctx.app);
      assert.equal((await client.post('/api/v1/auth/login', { login: username, password: 'geheim-geheim' })).status, 200);
      return client;
    };

    const eva = await user('eva');
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
    assert.equal((await admin.post('/api/v1/spaces', { key: 'TEAM', name: 'Team', preset: 'open' })).status, 200);
    const secret = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Nur für Eva', content: '<p>vertraulich</p>' })).body.id as number;
    assert.equal((await admin.put(`/api/v1/pages/${secret}/restrictions`, { view: [{ type: 'user', id: eva }], edit: [{ type: 'user', id: eva }] })).status, 200);
    assert.equal((await admin.put('/api/v1/spaces/TEAM/permissions', { grants: [{ subjectType: 'user', subjectId: adminId, role: 'admin' }, { subjectType: 'user', subjectId: eva, role: 'editor' }] })).status, 200);
    assert.equal((await admin.put(`/api/v1/pages/${secret}/read-requirement`, { audience: [{ type: 'user', id: eva }, { type: 'user', id: adminId }] })).status, 200);

    assert.equal((await admin.del(`/api/v1/admin/users/${eva}`)).status, 200);
    const mia = await user('mia');
    assert.ok(mia > eva, `die Nummer ${eva} wird nicht wieder vergeben (Mia: ${mia})`);
    const miaClient = await login('mia');

    assert.equal((await miaClient.get(`/api/v1/pages/${secret}`)).status, 404, 'die Seite bleibt gesperrt – auch wenn die einzige berechtigte Person gelöscht wurde');
    assert.equal((await admin.get(`/api/v1/pages/${secret}`)).status, 200, 'Administratoren sehen sie weiter');
    const restrictions = (await admin.get(`/api/v1/pages/${secret}/restrictions`)).body.view as { id: number; label: string }[];
    assert.deepEqual(restrictions.map((r) => r.id), [eva], 'der Verweis ins Leere bleibt sichtbar, damit jemand die Seite neu vergibt');

    const grants = (await admin.get('/api/v1/spaces/TEAM/permissions')).body as { subjectType: string; subjectId: number }[];
    assert.ok(!grants.some((g) => g.subjectType === 'user' && g.subjectId === eva), 'Evas Bereichsrecht ist weg');
    const audience = (await admin.get(`/api/v1/pages/${secret}/read-requirement`)).body.requirement.audience as { id: number }[];
    assert.deepEqual(audience.map((a) => a.id), [adminId], 'die Zielgruppe verliert Eva und behält die übrigen');

    // Gruppen: gelöschte Gruppe, neue Gruppe – keine Erbschaft, die Seite bleibt gesperrt
    const vorstand = (await admin.post('/api/v1/admin/groups', { name: 'Vorstand' })).body.id as number;
    await admin.put(`/api/v1/admin/groups/${vorstand}/members`, { userIds: [adminId] });
    const board = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Vorstandssache', content: '<p>x</p>' })).body.id as number;
    assert.equal((await admin.put(`/api/v1/pages/${board}/restrictions`, { view: [{ type: 'group', id: vorstand }], edit: [] })).status, 200);
    assert.equal((await admin.del(`/api/v1/admin/groups/${vorstand}`)).status, 200);
    const neu = (await admin.post('/api/v1/admin/groups', { name: 'Neu' })).body.id as number;
    assert.ok(neu > vorstand, 'auch Gruppennummern werden nicht wieder vergeben');
    await admin.put(`/api/v1/admin/groups/${neu}/members`, { userIds: [mia] });
    assert.equal((await miaClient.get(`/api/v1/pages/${board}`)).status, 404, 'die neue Gruppe erbt die Einschränkung der alten nicht');
  } finally {
    await ctx.close();
  }
});

test('Gelöschte Seiten und Bereiche: Nummern bleiben vergeben, ihr Verlauf gerät nicht an neue', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    const mia = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' });
    await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' });
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);

    // Seite: bearbeitet, gelöscht, endgültig entfernt – die nächste Seite bekommt eine neue Nummer und keinen fremden Verlauf
    const secret = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Personalsache Schmidt', content: '<p>geheim</p>' })).body.id as number;
    await admin.put(`/api/v1/pages/${secret}`, { title: 'Personalsache Schmidt', content: '<p>geheim 2</p>', changeNote: 'Kündigung vorbereitet' });
    assert.equal((await admin.del(`/api/v1/pages/${secret}`)).status, 200);
    assert.equal((await admin.del(`/api/v1/pages/${secret}/purge`)).status, 200);
    const fresh = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Kantinenplan', content: '<p>Suppe</p>' })).body.id as number;
    assert.ok(fresh > secret, `die Seitennummer ${secret} wird nicht wieder vergeben (neu: ${fresh})`);
    const feed = JSON.stringify((await mia.get(`/api/v1/pages/${fresh}/activity`)).body);
    assert.ok(!feed.includes('Personalsache') && !feed.includes('Kündigung'), 'der Verlauf der gelöschten Seite taucht nicht bei der neuen auf');

    // Bereich: gelöscht, der nächste bekommt eine neue Nummer und sieht den Verlauf des alten nicht
    const old = (await admin.post('/api/v1/spaces', { key: 'ALT', name: 'Altes Projekt Falke', preset: 'open' })).body.id as number;
    await admin.post('/api/v1/pages', { spaceKey: 'ALT', title: 'Falke Planung', content: '<p>x</p>' });
    assert.equal((await admin.del('/api/v1/spaces/ALT?confirm=ALT')).status, 200);
    const next = (await admin.post('/api/v1/spaces', { key: 'NEU', name: 'Neu', preset: 'open' })).body.id as number;
    assert.ok(next > old, `die Bereichsnummer ${old} wird nicht wieder vergeben (neu: ${next})`);
    const spaceFeed = JSON.stringify((await mia.get('/api/v1/spaces/NEU/activity')).body);
    assert.ok(!spaceFeed.includes('Falke'), 'der Verlauf des gelöschten Bereichs taucht beim neuen nicht auf');
  } finally {
    await ctx.close();
  }
});

test('Eingeschränkte Seiten verraten sich nicht: Titelsuche, Anwesenheit, Fehlermeldung', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    const mia = new Client(ctx.app);
    const anonymous = new Client(ctx.app);
    const adminId = (await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).body.user.id as number;
    await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' });
    await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' });
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
    const secret = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Streng vertraulich', content: '<p>x</p>' })).body.id as number;
    assert.equal((await admin.put(`/api/v1/pages/${secret}/restrictions`, { view: [{ type: 'user', id: adminId }], edit: [{ type: 'user', id: adminId }] })).status, 200);

    // Titelsuche: kein Unterschied zwischen „gibt es nicht“ und „darfst du nicht sehen“
    const find = (client: Client, title: string) => client.get(`/api/v1/pages/find?space=OFFEN&title=${encodeURIComponent(title)}`);
    assert.deepEqual((await find(mia, 'Streng vertraulich')).body, { page: null });
    assert.deepEqual((await find(mia, 'Gibt es nicht')).body, { page: null });
    assert.equal((await find(admin, 'Streng vertraulich')).body.page.id, secret, 'Administratoren finden sie');

    // Anwesenheit: Wer eine Seite nicht sehen darf, erfährt nicht, wer dort liest
    assert.equal((await admin.post(`/api/v1/pages/${secret}/presence`, { mode: 'view' })).body.length, 1);
    assert.deepEqual((await mia.post(`/api/v1/pages/${secret}/presence`, { mode: 'leave' })).body, []);
    assert.deepEqual((await anonymous.post(`/api/v1/pages/${secret}/presence`, { mode: 'leave' })).body, []);

    // Dieselbe Fehlermeldung für eine eingeschränkte und eine nicht vorhandene Seite
    const restricted = await mia.get(`/api/v1/pages/${secret}`);
    const missing = await mia.get('/api/v1/pages/99999');
    assert.equal(restricted.status, 404);
    assert.deepEqual(restricted.body, missing.body);
  } finally {
    await ctx.close();
  }
});

test('Vorschlagsmodus: auch Link-Ziele, Bilder und Makros lassen sich nur als Vorschlag ändern', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    const eva = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    await admin.post('/api/v1/admin/users', { username: 'eva', displayName: 'Eva', password: 'geheim-geheim', email: 'eva@example.com' });
    await eva.post('/api/v1/auth/login', { login: 'eva', password: 'geheim-geheim' });
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
    const base = '<p><a href="https://example.com/gut">Hier klicken</a></p>';
    const id = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Anleitung', content: base })).body.id as number;
    assert.equal((await admin.put(`/api/v1/pages/${id}/edit-mode`, { mode: 'suggest', locked: true })).status, 200);
    const save = (content: string) => eva.put(`/api/v1/pages/${id}`, { title: 'Anleitung', content, baseVersion: 1 });

    // Derselbe Text, ein anderes Ziel: früher durchgewunken, jetzt abgelehnt
    const swapped = await save('<p><a href="https://example.com/boese">Hier klicken</a></p>');
    assert.equal(swapped.status, 403, swapped.raw);
    // Ein neues Bild ohne Text ebenso
    assert.equal((await save(`${base}<p><img src="https://example.com/x.png" alt=""></p>`)).status, 403);
    // Ein echter Vorschlag geht weiter
    const proposal = await save('<p><a href="https://example.com/gut">Hier klicken</a> <ins data-suggestion="1" data-sid="s1">oder hier</ins></p>');
    assert.equal(proposal.status, 200, proposal.raw);

    // Sich selbst zur verantwortlichen Person zu machen, würde den Modus aushebeln – das darf nur, wer ohnehin entscheidet
    const evaId = (await eva.get('/api/v1/auth/me')).body.user.id as number;
    const takeover = await eva.put(`/api/v1/pages/${id}/review-cycle`, { ownerId: evaId });
    assert.equal(takeover.status, 403, takeover.raw);
    assert.equal((await admin.put(`/api/v1/pages/${id}/review-cycle`, { ownerId: evaId })).status, 200, 'die Bereichsverwaltung darf es');
  } finally {
    await ctx.close();
  }
});

test('Zurückgerollte Sammeländerung löst keine Ereignisse aus', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    const eva = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    await admin.post('/api/v1/admin/users', { username: 'eva', displayName: 'Eva', password: 'geheim-geheim', email: 'eva@example.com' });
    await eva.post('/api/v1/auth/login', { login: 'eva', password: 'geheim-geheim' });
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
    assert.equal((await admin.post('/api/v1/spaces', { key: 'LESEN', name: 'Lesen', preset: 'readonly' })).status, 200);
    const board = async (space: string) => (await admin.post(`/api/v1/spaces/${space}/boards`, { name: 'Plan' })).body.id as number;
    const task = async (boardId: number, title: string) => (await admin.post(`/api/v1/boards/${boardId}/tasks`, { title })).body.id as number;
    const mine = await task(await board('OFFEN'), 'Darf Eva ändern');
    const theirs = await task(await board('LESEN'), 'Darf Eva nicht ändern');

    const seen: number[] = [];
    ctx.s.events.on('task.updated', (event) => void seen.push(Number(event.target?.id)));
    const res = await eva.post('/api/v1/tasks/bulk', { ids: [mine, theirs], patch: { priority: 'high' } });
    assert.equal(res.status, 403, res.raw);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(seen, [], 'die zurückgerollte Änderung an der ersten Aufgabe wurde nicht gemeldet');
    assert.equal((await admin.get(`/api/v1/boards/${await board('OFFEN')}`)).status, 200);

    // Gegenprobe: Eine gelungene Änderung wird weiter gemeldet
    assert.equal((await eva.post('/api/v1/tasks/bulk', { ids: [mine], patch: { priority: 'high' } })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(seen, [mine]);
  } finally {
    await ctx.close();
  }
});

test('Kaputte Importe und Eingaben enden mit einer Meldung statt mit Fehler 500', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
    const upload = (url: string, data: Buffer, fields: Record<string, string> = {}) => {
      const boundary = '----knowstead-hardening';
      const crlf = '\r\n';
      const parts: Buffer[] = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`));
      parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="a.zip"${crlf}Content-Type: application/octet-stream${crlf}${crlf}`), data, Buffer.from(`${crlf}--${boundary}--${crlf}`));
      return admin.request('POST', url, Buffer.concat(parts), { 'content-type': `multipart/form-data; boundary=${boundary}` });
    };

    // Archiv ohne brauchbare Beschreibung: 400, und es bleibt kein halb angelegter Bereich zurück
    for (const meta of ['{}', 'kein json', '{"format":"knowstead-space","space":5}']) {
      const res = await upload('/api/v1/spaces/import-archive', zip({ 'knowstead-space.json': meta }), { key: 'KAPUTT', name: 'Kaputt' });
      assert.equal(res.status, 400, `${meta}: ${res.raw}`);
    }
    assert.equal((await admin.get('/api/v1/spaces/KAPUTT')).status, 404, 'kein halb angelegter Bereich');

    // Verweise mit ungültiger Prozent-Kodierung („100%.png“) brachten den ganzen Import zu Fall
    assert.equal((await admin.post('/api/v1/spaces', { key: 'IMP', name: 'Import' })).status, 200);
    const res = await upload('/api/v1/spaces/IMP/import', zip({ 'seite.md': '# Seite\n\n![Bild](100%.png) und [Link](50%25%.pdf)\n' }));
    assert.equal(res.status, 200, res.raw);

    // Ein beschädigter Multipart-Body (hier: Zeilenenden ohne Wagenrücklauf) ist ein Aufruffehler, kein Serverfehler
    const page = (await admin.post('/api/v1/pages', { spaceKey: 'IMP', title: 'Anhang', content: '<p>x</p>' })).body.id as number;
    const broken = Buffer.from('--b\nContent-Disposition: form-data; name="file"; filename="a.txt"\n\nabc\n--b--\n');
    for (const url of ['/api/v1/spaces/import-archive', '/api/v1/spaces/IMP/import', `/api/v1/pages/${page}/attachments`]) {
      const bad = await admin.request('POST', url, broken, { 'content-type': 'multipart/form-data; boundary=b' });
      assert.equal(bad.status, 400, `${url}: ${bad.raw}`);
    }

    // Ein Webhook für einen Bereich, den es nicht gibt
    const hook = await admin.post('/api/v1/admin/webhooks', { name: 'x', url: 'https://example.com/hook', events: ['*'], spaceId: 99999 });
    assert.equal(hook.status, 400, hook.raw);
  } finally {
    await ctx.close();
  }
});

test('Entwürfe, Zwischenablage und Eigenschaftsnamen verraten nichts über fremde Seiten', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    const mia = new Client(ctx.app);
    const adminId = (await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).body.user.id as number;
    await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' });
    await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' });
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
    const secret = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Streng vertraulich', content: '<p>x</p>' })).body.id as number;

    // „Entwurf verwerfen“: dieselbe Antwort für fremde, eingeschränkte und nicht vorhandene Seiten
    assert.equal((await admin.put(`/api/v1/pages/${secret}/restrictions`, { view: [{ type: 'user', id: adminId }], edit: [{ type: 'user', id: adminId }] })).status, 200);
    const discarded = await mia.del(`/api/v1/pages/${secret}/draft`);
    const missing = await mia.del('/api/v1/pages/99999/draft');
    assert.equal(discarded.status, 200);
    assert.deepEqual(discarded.body, missing.body);
    // Ein fremder, noch unveröffentlichter Entwurf bleibt dabei unangetastet
    const draft = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Entwurf', content: '<p>x</p>', status: 'draft' })).body.id as number;
    assert.equal((await mia.del(`/api/v1/pages/${draft}/draft`)).status, 200);
    assert.equal((await admin.get(`/api/v1/pages/${draft}`)).status, 200, 'der Entwurf von Ada ist noch da');

    // Eigenschaften eines fremden Entwurfs tauchen in den Namen der Eigenschaften nicht auf
    await admin.put(`/api/v1/pages/${draft}/properties`, { properties: [{ name: 'Geheimprojekt', value: 'x' }] });
    const names = (await mia.get('/api/v1/properties/names')).body as { name: string }[];
    assert.ok(!names.some((n) => n.name === 'Geheimprojekt'), 'Eigenschaften unveröffentlichter Entwürfe bleiben verborgen');

    // Zwischenablage: Die Quelle verschwindet, sobald die Person die Seite nicht mehr sehen darf
    const shared = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Später gesperrt', content: '<p>Text</p>' })).body.id as number;
    assert.equal((await mia.post('/api/v1/clips', { content: '<p>Text</p>', kind: 'html', sourcePageId: shared })).status, 200);
    assert.equal(((await mia.get('/api/v1/clips')).body as { items: { source: { title: string } | null }[] }).items[0].source?.title, 'Später gesperrt');
    assert.equal((await admin.put(`/api/v1/pages/${shared}/restrictions`, { view: [{ type: 'user', id: adminId }], edit: [{ type: 'user', id: adminId }] })).status, 200);
    assert.equal(((await mia.get('/api/v1/clips')).body as { items: { source: unknown }[] }).items[0].source, null);
  } finally {
    await ctx.close();
  }
});

test('Anmeldenamen verändern weder den LDAP-Filter noch lösen Pfade im Konnektor Serverfehler aus', async () => {
  // „$'“ und „$`“ wären als Ersatztext Anweisungen für replaceAll und kopierten Teile des Filters in den Filter
  const settings = { userFilter: '' } as DirectorySettings;
  assert.equal(userFilterFor(settings, "$'"), "(&(objectClass=user)(sAMAccountName=$'))");
  assert.equal(userFilterFor(settings, '$`'), '(&(objectClass=user)(sAMAccountName=$`))');
  assert.equal(userFilterFor(settings, 'a)(uid=*'), '(&(objectClass=user)(sAMAccountName=a\\29\\28uid=\\2a))');
  assert.equal(userFilterFor({ userFilter: '(mail={login})' } as DirectorySettings, '$&'), '(mail=$&)');

  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const created = await admin.post('/api/v1/admin/connectors', { key: 'wetter', name: 'Wetter', baseUrl: 'http://127.0.0.1:9' });
    assert.equal(created.status, 200, created.raw);
    const res = await admin.post(`/api/v1/admin/connectors/${created.body.id}/test`, { path: '/%zz' });
    assert.equal(res.status, 400, res.raw);
  } finally {
    await ctx.close();
  }
});

test('Bösartige Dateien und Wiki-Texte legen den Server nicht lahm', () => {
  // Rund 40 leere Kommentare am Dateianfang ließen den alten Ausdruck zur SVG-Erkennung Stunden rechnen
  const started = Date.now();
  assert.equal(sniffImage(Buffer.from(`${'<!---->'.repeat(140)}x`)), null);
  assert.equal(sniffImage(Buffer.from(`${'<!---->'.repeat(200)}<svg></svg>`)), null, 'bei 1 KB Kopf ist hier Schluss – kein SVG-Anfang mehr zu sehen');
  assert.equal(sniffImage(Buffer.from(`${'<!---->'.repeat(100)}<svg></svg>`)), 'image/svg+xml');
  assert.ok(Date.now() - started < 1000, 'SVG-Erkennung braucht linear lange');
  // …und die Erkennung bleibt, wie sie war
  assert.equal(sniffImage(Buffer.from('﻿<?xml version="1.0"?>\n<!-- a --> <!-- b -->\n<!DOCTYPE svg PUBLIC "x" "y">\n<svg width="1"></svg>')), 'image/svg+xml');
  assert.equal(sniffImage(Buffer.from('<svg></svg>')), 'image/svg+xml');
  assert.equal(sniffImage(Buffer.from('<!-- nie geschlossen <svg>')), null);

  // Tief verschachtelte Tags (100 KB): Die Textumwandlung rechnet kubisch in der Tiefe – die Bereinigung kappt die Tiefe
  const deepStart = Date.now();
  for (const tag of ['div', 'table', 'ul', 'blockquote', 'span']) {
    const clean = sanitizeRichText(`${`<${tag}>`.repeat(30_000)}Text`);
    assert.ok((clean.match(new RegExp(`<${tag}>`, 'g')) ?? []).length <= 100, `Tiefe von <${tag}> begrenzt`);
    assert.equal(htmlToText(clean), 'Text');
  }
  assert.ok((sanitizeComment('<blockquote>'.repeat(60) + 'x').match(/<blockquote>/g) ?? []).length <= 30);
  assert.ok(Date.now() - deepStart < 3000, 'tiefe Verschachtelung bleibt schnell');
  // Was der Editor erzeugt, bleibt unverändert: verschachtelte Listen, Tabellen in Hinweisen …
  const nestedList = `${'<ul><li><p>Punkt</p>'.repeat(20)}${'</li></ul>'.repeat(20)}`;
  assert.equal(sanitizeRichText(nestedList), nestedList);
  const table = '<div data-type="callout" data-variant="info"><table><tbody><tr><td><p>a</p></td><td><ul><li><p>b</p></li></ul></td></tr></tbody></table></div>';
  assert.equal(sanitizeRichText(table), table);

  // Anfänge ohne Ende („[[Datei:“, „[http://“, „<ref name="“): jeder Versuch suchte bis zum Textende
  const ctx = { filePrefixes: ['file', 'datei'], categoryPrefixes: ['category', 'kategorie'], mediaPrefixes: ['media'], resolve: (t: string) => t, pageTitle: 'X' };
  for (const open of ['[[Datei:', '[http://', '<ref name="', '<pre ', '<gallery ']) {
    const begin = Date.now();
    mediaWikiToHtml(open.repeat(20_000), ctx);
    assert.ok(Date.now() - begin < 1500, `MediaWiki: ${open} ohne Ende`);
  }
  for (const open of ['<file ', '<WRAP ', '[[a|', '{{wiki:x.png?']) {
    const begin = Date.now();
    dokuWikiToHtml(open.repeat(20_000), { ns: 'a', page: (id) => id, media: (id) => id });
    assert.ok(Date.now() - begin < 1500, `DokuWiki: ${open} ohne Ende`);
  }
  const begin = Date.now();
  xwikiToHtml('{{code language="'.repeat(20_000), { space: ['A'], docKey: 'A.B', resolveDoc: (r) => r });
  assert.ok(Date.now() - begin < 1500, 'XWiki: Makro ohne Ende');

  // Ein Markdown-Absatz aus einzelnen Betonungszeichen („_x_x_x…“) rechnet quadratisch: nach dem Zeitbudget eine Meldung
  const mdStart = Date.now();
  assert.throws(() => renderMarkdown('_x'.repeat(1_000_000)), /zu aufwendig/);
  assert.ok(Date.now() - mdStart < 8000, 'Markdown bricht nach dem Zeitbudget ab');
  assert.equal(renderMarkdown('Hallo **Welt** und _du_'), '<p>Hallo <strong>Welt</strong> und <em>du</em></p>\n');

  // Versionsvergleich zweier völlig verschiedener, langer Fassungen: nach dem Zeitlimit Rückfall statt Minuten Rechenzeit
  const paragraphs = (seed: number, n: number) => Array.from({ length: n }, (_, i) => `<p>w${(i * 7919 + seed * 104729) % 100_003} x${(i * seed) % 977}</p>`).join('');
  const diffStart = Date.now();
  htmlDiff(paragraphs(1, 3000), paragraphs(2, 3000));
  const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${i * (prefix === 'a' ? 1 : 7)}`).join('\n');
  const changed = lineDiff(lines('a', 40_000), lines('b', 40_000));
  assert.ok(changed.stats.added > 0 && changed.stats.removed > 0);
  assert.ok(Date.now() - diffStart < 6000, 'Vergleich bricht nach dem Zeitlimit ab');
  assert.deepEqual(htmlDiff('<p>Hallo Welt</p>', '<p>Hallo schöne Welt</p>')?.stats, { added: 1, removed: 0 });
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nx\nc').stats, { added: 1, removed: 1 });
});
