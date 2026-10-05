import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Eine eingeschränkte Seite in einem offenen Bereich: Inhalt, Titel und Suche waren dicht – aber
 * Stichwörter, Eigenschaftsnamen und ältere Benachrichtigungen verrieten die Seite weiterhin.
 * Gefunden mit einem „Kanarien“-Scan: eindeutige Geheimtexte anlegen, als normales Mitglied alle
 * lesenden Endpunkte abfragen und jede Antwort danach durchsuchen.
 */
test('Eingeschränkte Seiten: keine Spuren in Stichwörtern, Eigenschaften und Benachrichtigungen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const mia = new Client(ctx.app);
  let adminId = 0;
  let secretId = 0;
  let childId = 0;
  let miaId = 0;

  const names = async (client: Client, url: string) => ((await client.get(url)).body as { name: string }[]).map((x) => x.name);
  const notes = async (client: Client) => {
    const res = await client.get('/api/v1/me/notifications');
    assert.equal(res.status, 200, res.raw);
    return res.body as { items: { title: string; body: string }[]; unread: number };
  };

  // Benachrichtigungen entstehen kurz nach dem auslösenden Ereignis – darauf warten, statt zu raten
  const notified = async (client: Client, needle: string) => {
    for (let i = 0; i < 100; i++) {
      if (JSON.stringify((await notes(client)).items).includes(needle)) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

  try {
    await t.test('Einrichtung: Mia beobachtet den offenen Bereich', async () => {
      const setup = await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      assert.equal(setup.status, 200, setup.raw);
      adminId = setup.body.user.id;
      const created = await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' });
      assert.equal(created.status, 200, created.raw);
      miaId = created.body.id;
      assert.equal((await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
      assert.equal((await mia.post('/api/v1/spaces/OFFEN/watch', { on: true })).status, 200);
    });

    await t.test('Vor der Einschränkung sieht Mia alles – das ist der Ausgangspunkt', async () => {
      const secret = await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Personalsache Schmidt', content: '<p>vertraulich</p>', labels: ['kuendigung-schmidt'] });
      assert.equal(secret.status, 200, secret.raw);
      secretId = secret.body.id;
      await admin.put(`/api/v1/pages/${secretId}/properties`, { properties: [{ name: 'Abfindung', value: '50000' }] });
      await admin.post(`/api/v1/pages/${secretId}/comments`, { body: '<p>Betriebsrat ist informiert</p>' });
      const child = await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', parentId: secretId, title: 'Gesprächsnotiz', content: '<p>x</p>', labels: ['gespraech-schmidt'] });
      childId = child.body.id;
      // Eine zweite, harmlose Seite – sie darf später NICHT mitverschwinden
      await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Kantinenplan', content: '<p>Montag: Suppe</p>', labels: ['kantine'] });
      await admin.put(`/api/v1/pages/${(await admin.get('/api/v1/search?q=Kantinenplan')).body.items[0].id}/properties`, { properties: [{ name: 'Woche', value: '38' }] });

      assert.ok((await names(mia, '/api/v1/labels')).includes('kuendigung-schmidt'));
      assert.ok((await names(mia, '/api/v1/properties/names')).includes('Abfindung'));
      assert.ok(await notified(mia, 'Personalsache Schmidt'), 'Mia wurde als Beobachterin benachrichtigt');
      assert.ok(await notified(mia, 'Kantinenplan'));
      assert.ok((await notes(mia)).unread >= 2);
    });

    await t.test('Nach der Einschränkung bleibt keine Spur', async () => {
      const res = await admin.put(`/api/v1/pages/${secretId}/restrictions`, { view: [{ type: 'user', id: adminId }], edit: [{ type: 'user', id: adminId }] });
      assert.equal(res.status, 200, res.raw);
      assert.equal((await mia.get(`/api/v1/pages/${secretId}`)).status, 404, 'die Seite gibt es für Mia nicht mehr');

      for (const url of ['/api/v1/labels', '/api/v1/spaces/OFFEN/labels', '/api/v1/labels?q=schmidt']) {
        const list = await names(mia, url);
        assert.ok(!list.includes('kuendigung-schmidt'), `${url} nennt das Stichwort der eingeschränkten Seite nicht`);
        assert.ok(!list.includes('gespraech-schmidt'), `${url}: Unterseiten erben die Einschränkung`);
      }
      assert.ok((await names(mia, '/api/v1/labels')).includes('kantine'), 'andere Stichwörter bleiben');
      const props = await names(mia, '/api/v1/properties/names');
      assert.ok(!props.includes('Abfindung'));
      assert.ok(props.includes('Woche'), 'andere Eigenschaften bleiben');

      const after = await notes(mia);
      const text = JSON.stringify(after.items);
      assert.ok(!/Schmidt|Betriebsrat|Gesprächsnotiz/.test(text), `Benachrichtigungen zurückgezogen: ${text}`);
      assert.ok(after.items.some((n) => n.title.includes('Kantinenplan')), 'Nachrichten zu sichtbaren Seiten bleiben');
      assert.equal(after.unread, after.items.filter((n) => !('read' in n) || !(n as { read?: boolean }).read).length, 'Zähler passt zur Liste');
    });

    await t.test('Die Administration sieht weiterhin alles', async () => {
      assert.ok((await names(admin, '/api/v1/labels')).includes('kuendigung-schmidt'));
      assert.ok((await names(admin, '/api/v1/properties/names')).includes('Abfindung'));
    });

    await t.test('Auch die tägliche Zusammenfassung verrät nichts nachträglich', async () => {
      // Neue Seite, Mia wird benachrichtigt, liest aber nicht – dann wird eingeschränkt, danach geht die Sammelmail raus
      const saved = await admin.put('/api/v1/admin/settings', {
        emailNotifications: true,
        smtp: { host: '127.0.0.1', port: 2525, security: 'none', user: '', password: '', from: 'Knowstead <knowstead@example.org>' },
      });
      assert.equal(saved.status, 200, saved.raw);
      await mia.patch('/api/v1/me/preferences', { emailMode: 'daily', emailOnlyMentions: false });
      const late = await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Standortschließung Nord', content: '<p>x</p>' });
      assert.ok(await notified(mia, 'Standortschließung'), 'Mia wurde benachrichtigt, solange die Seite offen war');
      await admin.put(`/api/v1/pages/${late.body.id}/restrictions`, { view: [{ type: 'user', id: adminId }], edit: [] });
      // Gegenprobe: eine sichtbare Seite landet in der Sammelmail, die eingeschränkte nicht
      await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Betriebsausflug', content: '<p>x</p>' });
      assert.ok(await notified(mia, 'Betriebsausflug'));
      await ctx.s.mail.sendDigests({ force: true });
      const queued = JSON.stringify(ctx.s.db.all('SELECT * FROM mail_queue'));
      assert.ok(queued.includes('Betriebsausflug'), 'die Sammelmail wurde erzeugt');
      assert.ok(!queued.includes('Standortschließung'), 'Titel der eingeschränkten Seite steht in keiner wartenden Mail');
    });

    await t.test('Wird die Einschränkung aufgehoben, sind die Stichwörter wieder da', async () => {
      await admin.put(`/api/v1/pages/${secretId}/restrictions`, { view: [], edit: [] });
      assert.ok((await names(mia, '/api/v1/labels')).includes('kuendigung-schmidt'));
      assert.equal((await mia.get(`/api/v1/pages/${childId}`)).status, 200);
    });

    await t.test('Rechte im Bereich entzogen: Benachrichtigungen aus dem Bereich verschwinden', async () => {
      assert.equal((await admin.post('/api/v1/spaces', { key: 'PROJ', name: 'Projekt', preset: 'private' })).status, 200);
      const grants = (await admin.get('/api/v1/spaces/PROJ/permissions')).body as { subjectType: string; subjectId: number; role: string }[];
      const granted = await admin.put('/api/v1/spaces/PROJ/permissions', { grants: [...grants, { subjectType: 'user', subjectId: miaId, role: 'viewer' }] });
      assert.equal(granted.status, 200, granted.raw);
      const watch = await mia.post('/api/v1/spaces/PROJ/watch', { on: true });
      assert.equal(watch.status, 200, watch.raw);
      await admin.post('/api/v1/pages', { spaceKey: 'PROJ', title: 'Übernahme Firma Y', content: '<p>x</p>' });
      assert.ok(await notified(mia, 'Übernahme Firma Y'), 'Mia wurde benachrichtigt, solange sie Zugriff hatte');
      await admin.put('/api/v1/spaces/PROJ/permissions', { grants });
      assert.ok(!JSON.stringify((await notes(mia)).items).includes('Übernahme Firma Y'), 'mit dem Recht geht auch die Nachricht');
    });
  } finally {
    await ctx.close();
  }
});
