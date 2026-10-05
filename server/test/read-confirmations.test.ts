import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

test('Lesebestätigungen: Zielgruppe, Frist, Erinnerungen, Runden, Nachweis', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const clients: Record<string, Client> = {};
  const ids: Record<string, number> = {};
  let pageId = 0;
  let groupId = 0;

  const login = async (name: string) => {
    ids[name] = (await admin.post('/api/v1/admin/users', { username: name, displayName: name[0].toUpperCase() + name.slice(1), password: 'geheim-geheim' })).body.id;
    clients[name] = new Client(ctx.app);
    assert.equal((await clients[name].post('/api/v1/auth/login', { login: name, password: 'geheim-geheim' })).status, 200);
  };
  const notes = async (name: string) => JSON.stringify((await clients[name].get('/api/v1/me/notifications')).body);

  try {
    await t.test('Einrichtung', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      for (const name of ['tom', 'eva', 'max', 'leo']) await login(name);
      await admin.post('/api/v1/spaces', { key: 'QM', name: 'Qualität', preset: 'readonly' });
      const grants = (await admin.get('/api/v1/spaces/QM/permissions')).body;
      await admin.put('/api/v1/spaces/QM/permissions', { grants: [...grants, { subjectType: 'user', subjectId: ids.tom, role: 'admin' }] });
      groupId = (await admin.post('/api/v1/admin/groups', { name: 'Pflege', permissions: [] })).body.id;
      await admin.put(`/api/v1/admin/groups/${groupId}/members`, { userIds: [ids.eva, ids.max] });
      pageId = (await admin.post('/api/v1/pages', { spaceKey: 'QM', title: 'Hygienerichtlinie', content: '<p>Hände waschen.</p>' })).body.id;
    });

    await t.test('Nur die Bereichsverwaltung fordert an', async () => {
      const body = { audience: [{ type: 'group', id: groupId }, { type: 'user', id: ids.leo }], dueDays: 10, statement: 'Ich habe die Hygienerichtlinie gelesen und verstanden.' };
      assert.equal((await clients.eva.put(`/api/v1/pages/${pageId}/read-requirement`, body)).status, 403);
      assert.equal((await clients.tom.put(`/api/v1/pages/${pageId}/read-requirement`, { ...body, audience: [] })).status, 400);
      const res = await clients.tom.put(`/api/v1/pages/${pageId}/read-requirement`, body);
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(res.body.requirement.counts, { total: 3, confirmed: 0, open: 3, overdue: 0, noAccess: 0 });
      assert.deepEqual(res.body.requirement.audience.map((a: any) => a.label).sort(), ['Leo', 'Pflege']);
      assert.match(await notes('eva'), /Bitte lesen und bestätigen: „Hygienerichtlinie“/, 'Zuweisung sofort gemeldet');
      assert.doesNotMatch(await notes('tom'), /Hygienerichtlinie/, 'nicht in der Zielgruppe');
    });

    await t.test('Seitenkopf und Bestätigen', async () => {
      const page = (await clients.eva.get(`/api/v1/pages/${pageId}`)).body;
      assert.equal(page.readConfirmation.status, 'open');
      assert.match(page.readConfirmation.statement, /Hygienerichtlinie/);
      assert.equal((await clients.tom.get(`/api/v1/pages/${pageId}`)).body.readConfirmation, null);
      assert.equal((await clients.tom.post(`/api/v1/pages/${pageId}/read-confirmations`, {})).status, 403, 'nicht Teil der Zielgruppe');

      const confirmed = await clients.eva.post(`/api/v1/pages/${pageId}/read-confirmations`, {});
      assert.equal(confirmed.status, 200, confirmed.raw);
      assert.equal(confirmed.body.status, 'confirmed');
      assert.equal(confirmed.body.confirmedVersion, 1);
      // zweimal bestätigen erzeugt keinen zweiten Eintrag
      await clients.eva.post(`/api/v1/pages/${pageId}/read-confirmations`, {});
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM read_confirmations WHERE page_id = ?', pageId), 1);
      assert.equal((await clients.eva.get('/api/v1/auth/me')).body.openReads, 0);
      assert.equal((await clients.max.get('/api/v1/auth/me')).body.openReads, 1);
      const audit = JSON.stringify((await admin.get('/api/v1/admin/audit?limit=50')).body);
      assert.match(audit, /page\.read_confirmed/, 'im Audit-Log nachvollziehbar');
    });

    await t.test('Erinnerungen vor und nach der Frist – je Runde einmal', async () => {
      const soon = new Date(Date.now() + 8 * 86400_000);
      const first = ctx.s.reads.runReminders(soon);
      assert.equal(first.due, 2, 'Max und Leo');
      assert.equal(ctx.s.reads.runReminders(soon).due, 0, 'nur einmal');
      const late = ctx.s.reads.runReminders(new Date(Date.now() + 12 * 86400_000));
      assert.equal(late.overdue, 2);
      assert.match(await notes('leo'), /Lesebestätigung überfällig/);
      assert.doesNotMatch(await notes('eva'), /überfällig/);

      const evidence = (await clients.tom.get(`/api/v1/pages/${pageId}/read-confirmations`)).body;
      assert.deepEqual(
        evidence.rows.map((r: any) => [r.userName, r.status]),
        [
          ['Leo', 'open'],
          ['Max', 'open'],
          ['Eva', 'confirmed'],
        ],
      );
      assert.equal((await clients.eva.get(`/api/v1/pages/${pageId}/read-confirmations`)).status, 403, 'Nachweis nur für die Verwaltung');
      const reminded = await clients.tom.post(`/api/v1/pages/${pageId}/read-reminders`, {});
      assert.equal(reminded.body.reminded, 2);
      assert.equal((await clients.tom.post(`/api/v1/pages/${pageId}/read-reminders`, {})).body.reminded, 0, 'höchstens einmal täglich');
    });

    await t.test('Neue Version verlangt erneute Bestätigung, geringfügige nicht', async () => {
      let page = (await admin.get(`/api/v1/pages/${pageId}`)).body;
      await admin.put(`/api/v1/pages/${pageId}`, { title: page.title, content: '<p>Hände waschen und desinfizieren.</p>', minor: true, baseVersion: page.version });
      assert.equal((await clients.eva.get(`/api/v1/pages/${pageId}`)).body.readConfirmation.status, 'confirmed', 'geringfügig');
      page = (await admin.get(`/api/v1/pages/${pageId}`)).body;
      await admin.put(`/api/v1/pages/${pageId}`, { title: page.title, content: '<p>Neue Regeln ab sofort.</p>', baseVersion: page.version });
      const state = (await clients.eva.get(`/api/v1/pages/${pageId}`)).body.readConfirmation;
      assert.equal(state.status, 'open');
      assert.equal((await clients.eva.post(`/api/v1/pages/${pageId}/read-confirmations`, {})).body.confirmedVersion, 3);
      const evidence = (await clients.tom.get(`/api/v1/pages/${pageId}/read-confirmations?format=csv`)).raw;
      assert.match(evidence, /^\ufeffSeite;Person;Benutzername;Status/);
      assert.match(evidence, /Hygienerichtlinie;Eva;eva;bestätigt;[^;]+;3;/);
    });

    await t.test('Jährliche Wiederholung startet eine neue Runde', async () => {
      await clients.tom.put(`/api/v1/pages/${pageId}/read-requirement`, { audience: [{ type: 'group', id: groupId }], dueDays: 30, repeatMonths: 12 });
      const nextYear = new Date(Date.now() + 370 * 86400_000);
      assert.equal(ctx.s.reads.runReminders(nextYear).cycles, 1);
      assert.equal((await clients.eva.get(`/api/v1/pages/${pageId}`)).body.readConfirmation.status, 'open');
    });

    await t.test('Alle mit Leserecht, fehlendes Leserecht, Entfernen behält Nachweise', async () => {
      const secret = (await admin.post('/api/v1/pages', { spaceKey: 'QM', title: 'Vertraulich', content: '<p>x</p>' })).body.id;
      await admin.put(`/api/v1/pages/${secret}/restrictions`, { view: [{ type: 'user', id: ids.tom }], edit: [] });
      const res = await clients.tom.put(`/api/v1/pages/${secret}/read-requirement`, { audience: [{ type: 'user', id: ids.leo }, { type: 'space', id: 0 }] });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.requirement.counts.noAccess, 1, 'Leo ist Zielgruppe, darf aber nicht lesen');
      assert.equal(res.body.requirement.counts.total, 3, 'Tom und Ada (Leserecht) sowie Leo');
      assert.doesNotMatch(await notes('leo'), /Vertraulich/, 'keine Benachrichtigung ohne Leserecht');

      assert.equal((await clients.tom.del(`/api/v1/pages/${pageId}/read-requirement`)).status, 200);
      assert.equal((await clients.eva.get(`/api/v1/pages/${pageId}`)).body.readConfirmation, null);
      const evidence = (await clients.tom.get(`/api/v1/pages/${pageId}/read-confirmations`)).body;
      assert.ok(evidence.rows.some((r: any) => r.userName === 'Eva' && r.status === 'former'), 'Nachweis bleibt');
      await admin.del(`/api/v1/admin/users/${ids.eva}`);
      assert.ok(ctx.s.db.value("SELECT 1 FROM read_confirmations WHERE user_name = 'Eva' AND user_id IS NULL"), 'auch nach Löschen des Kontos');
    });
  } finally {
    await ctx.close();
  }
});
