import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client, createTestApp } from './helpers.ts';
import { sanitizeFilename } from '../src/modules/attachments/service.ts';
import { loadConfig } from '../src/config.ts';

/** Regressionstests zur Sicherheitsprüfung (Rechte, Datenschutz, Datensicherheit). */
test('Sicherheitsprüfung: Rechte, Datenschutz, Datensicherheit', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app); // Bearbeiter, später Benutzerverwalter
  const eva = new Client(ctx.app); // nur Leserin
  const ids: Record<string, number> = {};
  const servers: http.Server[] = [];

  const multipart = (name: string, content: string) => {
    const boundary = '----knowstead-sec';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, type: `multipart/form-data; boundary=${boundary}` };
  };
  const upload = async (client: Client, pageId: number, name: string, content: string) => {
    const form = multipart(name, content);
    return client.request('POST', `/api/v1/pages/${pageId}/attachments`, form.body, { 'content-type': form.type });
  };

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      for (const [username, displayName] of [['tom', 'Tom'], ['eva', 'Eva'], ['chef', 'Chef']]) {
        const res = await admin.post('/api/v1/admin/users', { username, displayName, password: 'geheim-geheim', email: `${username}@example.com` });
        ids[username] = res.body.id;
      }
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      assert.equal((await eva.post('/api/v1/auth/login', { login: 'eva', password: 'geheim-geheim' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'SEC', name: 'Sicherheit', preset: 'readonly' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'ZWEI', name: 'Zweiter Bereich', preset: 'open' })).status, 200);
      // Tom darf in SEC bearbeiten, Eva nur lesen (readonly für alle Angemeldeten)
      const grants = (await admin.get('/api/v1/spaces/SEC/permissions')).body as { subjectType: string; subjectId: number; role: string }[];
      const put = await admin.put('/api/v1/spaces/SEC/permissions', { grants: [...grants, { subjectType: 'user', subjectId: ids.tom, role: 'editor' }] });
      assert.equal(put.status, 200, put.raw);
    });

    await t.test('Entwurf lässt sich nach Rechteentzug nicht mehr veröffentlichen', async () => {
      const draft = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Entwurf', content: '<p>x</p>', status: 'draft' });
      assert.equal(draft.status, 200, draft.raw);
      const grants = ((await admin.get('/api/v1/spaces/SEC/permissions')).body as { subjectType: string; subjectId: number; role: string }[]).filter(
        (g) => !(g.subjectType === 'user' && g.subjectId === ids.tom),
      );
      assert.equal((await admin.put('/api/v1/spaces/SEC/permissions', { grants })).status, 200);
      const publish = await tom.put(`/api/v1/pages/${draft.body.id}`, { title: 'Entwurf', content: '<p>veröffentlicht</p>' });
      assert.equal(publish.status, 403, 'ohne Anlegerecht kein Veröffentlichen');
      assert.equal((await tom.del(`/api/v1/pages/${draft.body.id}/draft`)).status, 200, 'eigenen Entwurf verwerfen geht weiter');
      // Rechte für die folgenden Tests wiederherstellen
      await admin.put('/api/v1/spaces/SEC/permissions', { grants: [...grants, { subjectType: 'user', subjectId: ids.tom, role: 'editor' }] });
    });

    await t.test('Kopieren in den eigenen Teilbaum bleibt endlich; anderer Bereich ohne Eltern-ID', async () => {
      const parent = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Eltern', content: '<p>a</p>' });
      const child = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Kind', content: '<p>b</p>', parentId: parent.body.id });
      const before = ctx.s.db.value<number>("SELECT COUNT(*) FROM pages WHERE space_id = (SELECT id FROM spaces WHERE key = 'SEC')")!;
      const copy = await tom.post(`/api/v1/pages/${parent.body.id}/copy`, { parentId: child.body.id, includeChildren: true });
      assert.equal(copy.status, 200, copy.raw);
      const after = ctx.s.db.value<number>("SELECT COUNT(*) FROM pages WHERE space_id = (SELECT id FROM spaces WHERE key = 'SEC')")!;
      assert.equal(after - before, 2, 'genau Eltern und Kind kopiert');
      const other = await tom.post(`/api/v1/pages/${child.body.id}/copy`, { spaceKey: 'ZWEI' });
      assert.equal(other.status, 200, other.raw);
    });

    await t.test('Gelöschte Seiten und Anhänge nur mit Lösch- bzw. Anhangsrecht', async () => {
      const page = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Vertraulich', content: '<p>geheim</p>' });
      ids.page = page.body.id;
      const att = await upload(tom, page.body.id, 'notiz.txt', 'Inhalt');
      assert.equal(att.status, 200, att.raw);
      const attachmentId = att.body[0].id as number;
      assert.equal((await tom.del(`/api/v1/attachments/${attachmentId}`)).status, 200);
      assert.equal((await eva.get(`/api/v1/pages/${page.body.id}/attachments?deleted=true`)).status, 403);
      assert.equal((await eva.get(`/api/v1/attachments/${attachmentId}/raw`)).status, 403);
      assert.equal((await tom.get(`/api/v1/attachments/${attachmentId}/raw`)).status, 200);

      assert.equal((await tom.del(`/api/v1/pages/${page.body.id}`)).status, 200);
      assert.equal((await eva.get(`/api/v1/pages/${page.body.id}?deleted=true`)).status, 403, 'Leser sehen den Papierkorb nicht');
      assert.equal((await tom.get(`/api/v1/pages/${page.body.id}?deleted=true`)).status, 200);
    });

    await t.test('Wiederherstellen und endgültig Löschen verraten keine fremden Seiten', async () => {
      const guest = new Client(ctx.app);
      const hidden = await admin.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Gehaltsliste Vorstand', content: '<p>geheim</p>' });
      assert.equal((await admin.put(`/api/v1/pages/${hidden.body.id}/restrictions`, { view: [{ type: 'user', id: 1 }], edit: [] })).status, 200);
      for (const [who, client] of [['Leserin', eva], ['Bearbeiter', tom], ['Gast', guest]] as const) {
        for (const [method, url] of [['POST', `/api/v1/pages/${hidden.body.id}/restore`], ['DELETE', `/api/v1/pages/${hidden.body.id}/purge`]] as const) {
          const res = await client.request(method, url, method === 'POST' ? {} : undefined);
          assert.equal(res.status, 404, `${who}: ${method} ${url}`);
          assert.doesNotMatch(res.raw, /gehaltsliste/i, `${who}: kein Titel in der Antwort`);
        }
      }
      const open = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Offene Seite', content: '<p>x</p>' });
      assert.equal((await eva.post(`/api/v1/pages/${open.body.id}/restore`)).status, 403, 'ohne Löschrecht nicht einmal für nicht gelöschte Seiten');
      assert.equal((await guest.post(`/api/v1/pages/${open.body.id}/restore`)).status, 404);
      assert.equal((await tom.post(`/api/v1/pages/${open.body.id}/restore`)).status, 200, 'mit Löschrecht weiterhin ohne Wirkung erfolgreich');
      assert.equal((await eva.post(`/api/v1/pages/${ids.page}/restore`)).status, 403, 'gelöschte Seite nur mit Löschrecht');
    });

    await t.test('Vertretung für unbekannte Person: 404 statt Serverfehler, ohne Recht 403', async () => {
      const body = { deputyId: ids.tom, startsOn: '2099-01-01', endsOn: '2099-01-02' };
      assert.equal((await admin.post('/api/v1/admin/users/999999/deputies', body)).status, 404);
      assert.equal((await eva.post('/api/v1/admin/users/999999/deputies', body)).status, 403);
      assert.equal((await admin.post('/api/v1/me/deputies', { ...body, deputyId: 999999 })).status, 404);
    });

    await t.test('Vorlagen und KI-Details nur für Angemeldete', async () => {
      const guest = new Client(ctx.app);
      const list = await eva.get('/api/v1/templates');
      assert.equal(list.status, 200);
      assert.ok(list.body.length > 0, 'Angemeldete sehen die Vorlagen');
      assert.deepEqual((await guest.get('/api/v1/templates')).body, []);
      assert.equal((await guest.get(`/api/v1/templates/${list.body[0].id}`)).status, 401);
      const ai = await guest.get('/api/v1/ai/status');
      assert.equal(ai.status, 200);
      assert.equal(ai.body.provider, '');
      assert.equal(ai.body.model, '');
      assert.notEqual((await eva.get('/api/v1/ai/status')).body.provider, '');
    });

    await t.test('Gelöschte Anhänge verfallen mit der Papierkorb-Frist', async () => {
      const page = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Anhangsfrist', content: '<p>x</p>' });
      const kept = await upload(tom, page.body.id, 'bleibt.txt', 'bleibt');
      const gone = await upload(tom, page.body.id, 'weg.txt', 'weg');
      const goneId = gone.body[0].id as number;
      const key = ctx.s.db.value<string>('SELECT storage_key FROM attachments WHERE id = ?', goneId)!;
      assert.equal((await tom.del(`/api/v1/attachments/${goneId}`)).status, 200);
      ctx.s.admin.runMaintenance(null, 'purge-trash');
      assert.ok(ctx.s.db.value('SELECT 1 FROM attachments WHERE id = ?', goneId), 'innerhalb der Frist wiederherstellbar');

      ctx.s.db.run("UPDATE attachments SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", goneId);
      const result = ctx.s.admin.runMaintenance(null, 'purge-trash') as { attachments: number };
      assert.equal(result.attachments, 1);
      assert.ok(!ctx.s.db.value('SELECT 1 FROM attachments WHERE id = ?', goneId), 'endgültig entfernt');
      assert.ok(ctx.s.db.value('SELECT 1 FROM file_deletions WHERE storage_key = ?', key), 'Datei erst nach der Karenzzeit gelöscht');
      assert.ok(ctx.s.db.value('SELECT 1 FROM attachments WHERE id = ?', kept.body[0].id), 'andere Anhänge bleiben');
      assert.deepEqual(ctx.s.attachments.purgeRemovedFiles(-1), { removed: 1, kept: 0 });
      assert.equal(fs.existsSync(path.join(ctx.s.config.uploadsDir, key)), false);
    });

    await t.test('API-Referenz nur nach Anmeldung', async () => {
      const page = await ctx.app.inject({ method: 'GET', url: '/api/docs' });
      assert.equal(page.statusCode, 302);
      assert.match(String(page.headers.location), /^\/login\?next=/);
      assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/docs/json' })).statusCode, 401);
      assert.equal((await tom.get('/api/docs/json')).status, 200, 'angemeldet');
    });

    await t.test('Sicherheits-Header auf allen Antworten', async () => {
      for (const url of ['/api/v1/health', '/login', '/api/v1/auth/me']) {
        const res = await ctx.app.inject({ method: 'GET', url });
        assert.equal(res.headers['x-content-type-options'], 'nosniff', url);
        assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin', url);
        assert.match(String(res.headers['permissions-policy']), /camera=\(\)/, url);
        assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin', url);
      }
    });

    await t.test('Sitzungs-Cookie hinter HTTPS-Proxy als „Secure“ markiert', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-knowstead-client': 'test', 'x-forwarded-proto': 'https' },
        payload: { login: 'eva', password: 'geheim-geheim' },
      });
      assert.equal(res.statusCode, 200, res.body);
      const cookie = String(res.headers['set-cookie']);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Secure/);
    });

    await t.test('HTML-Export läuft auch inline in einer Sandbox', async () => {
      const page = await tom.post('/api/v1/pages', { spaceKey: 'SEC', title: 'Export', content: '<p>x</p>' });
      const res = await eva.get(`/api/v1/pages/${page.body.id}/export?format=html&inline=true`);
      assert.equal(res.status, 200);
      assert.match(String(res.headers['content-security-policy']), /sandbox/);
    });

    await t.test('Benutzerverwaltung ohne Adminrechte kann Administratoren nicht ändern', async () => {
      const group = await admin.post('/api/v1/admin/groups', { name: 'Personalstelle', permissions: ['users.manage'] });
      assert.equal(group.status, 200, group.raw);
      assert.equal((await admin.put(`/api/v1/admin/groups/${group.body.id}/members`, { userIds: [ids.tom] })).status, 200);
      const adminId = (await admin.get('/api/v1/auth/me')).body.user.id as number;
      assert.equal((await tom.patch(`/api/v1/admin/users/${adminId}`, { email: 'tom-privat@example.com' })).status, 403);
      assert.equal((await tom.post(`/api/v1/admin/users/${adminId}/status`, { status: 'disabled' })).status, 403);
      assert.equal((await tom.del(`/api/v1/admin/users/${adminId}`)).status, 403);
      assert.equal((await tom.post(`/api/v1/admin/users/${adminId}/password`, { password: 'uebernommen-123' })).status, 403);
      assert.equal((await tom.post(`/api/v1/admin/users/${adminId}/reset-link`, {})).status, 403);
      assert.equal((await tom.post(`/api/v1/admin/users/${adminId}/invite`, {})).status, 403);
      assert.equal((await tom.post(`/api/v1/admin/users/${adminId}/unlock`, {})).status, 403);
      // normale Konten weiter verwaltbar
      assert.equal((await tom.patch(`/api/v1/admin/users/${ids.chef}`, { displayName: 'Chefin' })).status, 200);
    });

    await t.test('Passwort-Reset: Verzeichniskonten ausgeschlossen, alte Links verfallen', async () => {
      const first = ctx.s.auth.createResetToken(ids.chef);
      const second = ctx.s.auth.createResetToken(ids.chef);
      const anon = new Client(ctx.app);
      assert.equal((await anon.post('/api/v1/auth/reset', { token: first, password: 'neues-passwort-1' })).status, 200);
      assert.equal((await anon.post('/api/v1/auth/reset', { token: second, password: 'neues-passwort-2' })).status, 400, 'zweiter Link ungültig');

      ctx.s.db.run("UPDATE users SET auth_source = 'ldap' WHERE id = ?", ids.chef);
      const ldapToken = ctx.s.auth.createResetToken(ids.chef);
      assert.equal((await anon.post('/api/v1/auth/reset', { token: ldapToken, password: 'neues-passwort-3' })).status, 400);
      ctx.s.db.run("UPDATE users SET auth_source = 'local' WHERE id = ?", ids.chef);
    });

    await t.test('Verzeichnisabgleich übernimmt keine fremden oder Administratorkonten', () => {
      ctx.s.settings.update({ directory: { ...ctx.s.settings.get('directory'), adoptLocalUsers: true } });
      const profile = { dn: 'CN=Admin', username: 'admin', displayName: 'Admin', email: null, externalId: 'guid-1', groups: [] };
      assert.throws(() => ctx.s.directory.syncUser(profile), /Administratorkonten/);
      ctx.s.db.run("UPDATE users SET auth_source = 'ldap', external_id = 'guid-alt' WHERE id = ?", ids.eva);
      assert.throws(() => ctx.s.directory.syncUser({ ...profile, dn: 'CN=Eva', username: 'eva', externalId: 'guid-neu' }), /passt nicht/);
      ctx.s.db.run("UPDATE users SET auth_source = 'local', external_id = NULL WHERE id = ?", ids.eva);
    });

    await t.test('API-Konnektoren: Leser nur für hinterlegte Makros', async () => {
      const api = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path: req.url }));
      });
      servers.push(api);
      await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
      const { port } = api.address() as AddressInfo;
      const connector = await admin.post('/api/v1/admin/connectors', { key: 'hr', name: 'Personal', baseUrl: `http://127.0.0.1:${port}/` });
      assert.equal(connector.status, 200, connector.raw);
      const page = await tom.post('/api/v1/pages', {
        spaceKey: 'SEC',
        title: 'Kennzahlen',
        content: '<div data-type="api-data" data-connector="hr" data-path="/stats"></div>',
      });
      assert.equal((await eva.post('/api/v1/connectors/hr/query', { path: '/stats', pageId: page.body.id })).status, 200, 'hinterlegtes Makro');
      assert.equal((await eva.post('/api/v1/connectors/hr/query', { path: '/gehaelter', pageId: page.body.id })).status, 403, 'anderer Pfad');
      assert.equal((await eva.post('/api/v1/connectors/hr/query', { path: '/stats' })).status, 403, 'ohne Seite');
      assert.equal((await tom.post('/api/v1/connectors/hr/query', { path: '/vorschau', pageId: page.body.id })).status, 200, 'Bearbeitende dürfen Makros einrichten');
    });

    await t.test('Einstellungen: Hosts und Konverter werden geprüft', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { allowedEmbedHosts: ['example.com; script-src *'] })).status, 400);
      assert.equal((await admin.put('/api/v1/admin/settings', { sessionDays: 0 })).status, 400);
      assert.equal((await admin.put('/api/v1/admin/settings', { officePreview: { enabled: true, sofficePath: 'C:\\Windows\\System32\\cmd.exe' } })).status, 400);
      assert.equal((await admin.put('/api/v1/admin/settings', { allowedEmbedHosts: ['www.youtube-nocookie.com', 'intranet.example.com:8443'] })).status, 200);
    });

    await t.test('Audit-CSV ist gegen Formel-Injektion geschützt', async () => {
      const anon = new Client(ctx.app);
      await anon.post('/api/v1/auth/login', { login: '=HYPERLINK("http://example.com")', password: 'x' });
      const csv = await admin.get('/api/v1/admin/audit.csv');
      assert.equal(csv.status, 200);
      assert.ok(csv.raw.includes(`"'=HYPERLINK`), 'Formel mit Apostroph entschärft');
      assert.ok(!/;"=HYPERLINK/.test(csv.raw));
    });

    await t.test('Endgültig gelöschte Dateien bleiben bis zur Karenzzeit erhalten; Sicherung vor Bereichslöschung', async () => {
      const page = await admin.post('/api/v1/pages', { spaceKey: 'ZWEI', title: 'Mit Datei', content: '<p>x</p>' });
      const att = await upload(admin, page.body.id, 'bericht.txt', 'Bericht');
      const key = ctx.s.db.value<string>('SELECT storage_key FROM attachments WHERE id = ?', att.body[0].id)!;
      const file = path.join(ctx.s.config.uploadsDir, key);
      assert.equal((await admin.del(`/api/v1/pages/${page.body.id}`)).status, 200);
      assert.equal((await admin.del(`/api/v1/pages/${page.body.id}/purge`)).status, 200);
      assert.ok(fs.existsSync(file), 'Datei liegt noch');
      assert.ok(ctx.s.db.value('SELECT 1 FROM file_deletions WHERE storage_key = ?', key));
      assert.deepEqual(ctx.s.attachments.purgeRemovedFiles(30), { removed: 0, kept: 0 }, 'innerhalb der Karenzzeit');
      assert.deepEqual(ctx.s.attachments.purgeRemovedFiles(-1), { removed: 1, kept: 0 });
      assert.equal(fs.existsSync(file), false);

      const del = await admin.del('/api/v1/spaces/ZWEI?confirm=ZWEI');
      assert.equal(del.status, 200, del.raw);
      assert.match(del.body.backup, /^backup-\d{8}-\d{6}-loeschung$/);
      assert.ok(fs.existsSync(path.join(ctx.s.config.backupsDir, del.body.backup, 'knowstead.db')));
    });

    await t.test('Dateinamen: Punkte und Leerzeichen am Ende entfernt', () => {
      assert.equal(sanitizeFilename('rechnung.exe.'), 'rechnung.exe');
      assert.equal(sanitizeFilename('bericht.pdf . '), 'bericht.pdf');
      assert.equal(sanitizeFilename('  .versteckt'), 'versteckt');
    });
  } finally {
    for (const server of servers) server.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await ctx.close();
  }
});

test('Weboberfläche: Programmdateien, Seitenaufrufe und fehlende Dateien', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-web-'));
  fs.mkdirSync(path.join(dir, 'web', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(dir, 'web', 'assets', 'app-abc123.js'), 'export {};');
  fs.writeFileSync(path.join(dir, 'geheim.txt'), 'nicht ausliefern');
  const ctx = await createTestApp({ dir });
  try {
    const get = (url: string) => ctx.app.inject({ method: 'GET', url });

    const route = await get('/s/TEAM/pages/1');
    assert.equal(route.statusCode, 200);
    assert.match(String(route.headers['content-type']), /text\/html/);
    assert.equal(route.headers['cache-control'], 'no-cache', 'Startseite wird nach Updates neu geladen');
    assert.match(String(route.headers['content-security-policy']), /script-src 'self'/);
    const head = await ctx.app.inject({ method: 'HEAD', url: '/login' });
    assert.equal(head.statusCode, 200, 'HEAD für Verfügbarkeitsprüfungen (den Inhalt lässt Node bei HEAD weg)');

    const asset = await get('/assets/app-abc123.js');
    assert.equal(asset.statusCode, 200);
    assert.match(String(asset.headers['content-type']), /javascript/);
    assert.match(String(asset.headers['cache-control']), /immutable/);

    const missing = await get('/assets/app-veraltet.js');
    assert.equal(missing.statusCode, 404, 'fehlende Programmdatei ist kein HTML');
    assert.doesNotMatch(String(missing.headers['content-type']), /html/);

    for (const url of ['/../geheim.txt', '/%2e%2e/geheim.txt', '/assets/..%2f..%2fgeheim.txt']) {
      const res = await get(url);
      assert.doesNotMatch(res.body, /nicht ausliefern/, url);
    }
  } finally {
    await ctx.close();
  }
});

test('TRUST_PROXY: Proxy-Header nur von vertrauenswürdigen Adressen', async () => {
  process.env.KNOWSTEAD_SKIP_ENV_FILE = '1'; // keine .env des Entwicklungsrechners einlesen
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-proxy-'));
  try {
    assert.equal(loadConfig({ DATA_DIR: dir, TRUST_PROXY: 'true' }).trustProxy, true);
    assert.equal(loadConfig({ DATA_DIR: dir, TRUST_PROXY: 'nein' }).trustProxy, false);
    assert.equal(loadConfig({ DATA_DIR: dir, TRUST_PROXY: ' 127.0.0.1, 10.0.0.0/8 ,uniquelocal' }).trustProxy, '127.0.0.1,10.0.0.0/8,uniquelocal');
    assert.equal(loadConfig({ DATA_DIR: dir, TRUST_PROXY: 'proxy.intern' }).trustProxy, false, 'unbekannte Werte wie bisher: aus');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const ctx = await createTestApp({ env: { TRUST_PROXY: 'uniquelocal,loopback' } });
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const login = (remoteAddress: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress,
        headers: { 'x-knowstead-client': 'test', 'x-forwarded-for': '198.51.100.23' },
        payload: { login: 'admin', password: 'geheim-geheim' },
      });
    assert.equal((await login('203.0.113.9')).statusCode, 200);
    assert.equal((await login('10.0.0.2')).statusCode, 200);
    const ips = ctx.s.db.all<{ ip: string }>('SELECT ip FROM sessions').map((r) => r.ip);
    assert.ok(ips.includes('203.0.113.9'), 'direkter Zugriff: gefälschter Header wird ignoriert');
    assert.ok(ips.includes('198.51.100.23'), 'Proxy im privaten Netz: Client-Adresse aus dem Header');
  } finally {
    await ctx.close();
  }
});
