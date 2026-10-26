import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

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
