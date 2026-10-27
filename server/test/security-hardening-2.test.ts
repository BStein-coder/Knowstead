import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Regressionstests zu den offenen Randpunkten der Gesamtprüfung vom 26.10.2026: Registrierung, Weitergabe von
 * Rechten durch die Benutzerverwaltung und Aufgabentermine (Ergänzung zu security-hardening.test.ts).
 */
const SETUP = { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false };

test('Registrierung: eine vorhandene E-Mail-Adresse verrät sich nicht', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', SETUP);
    assert.equal((await admin.post('/api/v1/admin/users', { username: 'anna', displayName: 'Anna', password: 'geheim-geheim', email: 'anna@example.com' })).status, 200);
    assert.equal((await admin.put('/api/v1/admin/settings', { allowRegistration: true })).status, 200);
    // E-Mail-Versand „eingerichtet“, ohne tatsächlich zu senden
    ctx.s.mailer.isConfigured = () => true;
    ctx.s.mail.processQueue = async () => {};

    const register = (username: string, email: string, password = 'geheim-geheim') =>
      new Client(ctx.app).post('/api/v1/auth/register', { username, displayName: username, email, password });
    const mails = (userId: number, kind: string) => ctx.s.db.all<{ text_body: string }>('SELECT text_body FROM mail_queue WHERE user_id = ? AND kind = ?', userId, kind);

    // Neue und vorhandene Adresse: dieselbe Antwort, und es entsteht kein zweites Konto
    const fresh = await register('neu', 'neu@example.com');
    const known = await register('andere', 'ANNA@example.com');
    assert.equal(fresh.status, 200, fresh.raw);
    assert.equal(known.status, 200, known.raw);
    assert.deepEqual(known.body, { user: null, pending: true, email: 'anna@example.com' });
    assert.deepEqual(Object.keys(known.body), Object.keys(fresh.body));
    assert.equal(ctx.s.users.byUsername('andere'), undefined, 'kein zweites Konto');
    assert.ok(ctx.s.users.byUsername('neu'), 'die neue Adresse legt ein Konto an');

    // Ungültige Eingaben ergeben bei vorhandener und neuer Adresse dieselbe Fehlermeldung
    for (const [username, password] of [['x y', 'geheim-geheim'], ['gueltig', 'k']]) {
      const a = await register(username, 'anna@example.com', password);
      const b = await register(username, 'nochnie@example.com', password);
      assert.equal(a.status, 400, a.raw);
      assert.equal(b.status, 400, b.raw);
      assert.equal(a.body.error.message, b.body.error.message);
    }
    // Ein vergebener Benutzername bleibt eine Meldung: Namen stehen in Personenliste und Erwähnungen ohnehin offen
    assert.equal((await register('anna', 'x@example.com')).status, 409);

    // Die Inhaberin bekommt eine Mail – höchstens eine je zehn Minuten
    const anna = ctx.s.users.byUsername('anna')!;
    assert.equal(mails(anna.id, 'registration-existing').length, 1);
    assert.match(mails(anna.id, 'registration-existing')[0].text_body, /anna/);
    await register('andere2', 'anna@example.com');
    assert.equal(mails(anna.id, 'registration-existing').length, 1, 'keine Flut von Mails');

    // Noch unbestätigte Registrierung: neuer Bestätigungslink statt Fehler
    await register('wartet', 'wartet@example.com');
    const waiting = ctx.s.users.byUsername('wartet')!;
    assert.equal(mails(waiting.id, 'registration').length, 1);
    await register('dritte', 'wartet@example.com');
    assert.equal(mails(waiting.id, 'registration').length, 1, 'innerhalb von zehn Minuten keine zweite Mail');
    ctx.s.db.run("UPDATE mail_queue SET created_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ?", waiting.id);
    assert.equal((await register('dritte', 'wartet@example.com')).status, 200);
    const resent = mails(waiting.id, 'registration');
    assert.equal(resent.length, 2, 'neuer Bestätigungslink');
    assert.match(resent[1].text_body, /\/verify-email\//);

    // Ohne E-Mail-Versand entsteht das Konto sofort – dort bleibt die Meldung (die Adresse ist unbestätigt)
    ctx.s.mailer.isConfigured = () => false;
    assert.equal((await register('ohne', 'anna@example.com')).status, 409);
  } finally {
    await ctx.close();
  }
});

test('Benutzerverwaltung gibt nur Rechte weiter, die sie selbst hat', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', SETUP);
    const user = async (username: string) => {
      const created = await admin.post('/api/v1/admin/users', { username, displayName: username, password: 'geheim-geheim', email: `${username}@example.com` });
      assert.equal(created.status, 200, created.raw);
      return created.body.id as number;
    };
    const group = async (name: string, permissions: string[]) => {
      const created = await admin.post('/api/v1/admin/groups', { name, permissions });
      assert.equal(created.status, 200, created.raw);
      return created.body.id as number;
    };
    const standard = ctx.s.groups.systemGroup('users');
    const defaults = standard ? (JSON.parse(standard.permissions) as string[]) : [];
    assert.ok(!defaults.includes('integrations.manage') && !defaults.includes('audit.view'), 'Voraussetzung des Tests');

    // Hilde: Benutzerverwaltung und KI – aber weder Integrationen noch Audit-Log
    const hilde = await user('hilde');
    const karl = await user('karl');
    const ines = await user('ines');
    const personal = await group('Personalstelle', ['users.manage', 'ai.use']);
    const ki = await group('KI-Nutzung', ['ai.use']);
    const integration = await group('Integrationen', ['integrations.manage']);
    const ohneRechte = await group('Ohne Rechte', []);
    assert.equal((await admin.put(`/api/v1/admin/groups/${personal}/members`, { userIds: [hilde] })).status, 200);
    assert.equal((await admin.put(`/api/v1/admin/groups/${integration}/members`, { userIds: [ines] })).status, 200);
    const h = new Client(ctx.app);
    assert.equal((await h.post('/api/v1/auth/login', { login: 'hilde', password: 'geheim-geheim' })).status, 200);

    // Gruppen anlegen und ändern: nur mit Rechten, die man selbst hat
    assert.equal((await h.post('/api/v1/admin/groups', { name: 'Selbstbedienung', permissions: ['integrations.manage'] })).status, 403, 'sich keine Gruppe mit fremden Rechten bauen');
    assert.equal((await h.post('/api/v1/admin/groups', { name: 'Erlaubt', permissions: ['ai.use'] })).status, 200);
    assert.equal((await h.patch(`/api/v1/admin/groups/${ki}`, { description: 'Nur umbenannt' })).status, 200, 'unveränderte Rechte stören nicht');
    assert.equal((await h.patch(`/api/v1/admin/groups/${ki}`, { permissions: ['ai.use', 'audit.view'] })).status, 403, 'Recht hinzufügen');
    assert.equal((await h.patch(`/api/v1/admin/groups/${integration}`, { permissions: [] })).status, 403, 'Recht entziehen');
    assert.equal((await h.patch(`/api/v1/admin/groups/${integration}`, { isDefault: true })).status, 403, 'zur Standardgruppe machen verteilt die Rechte');
    assert.equal((await h.patch(`/api/v1/admin/groups/${integration}`, { directoryGroups: ['CN=Alle'] })).status, 403, 'Verzeichnisabgleich verteilt die Rechte');
    const refused = await h.patch(`/api/v1/admin/groups/${ki}`, { permissions: ['ai.use', 'audit.view'] });
    assert.match(refused.body.error.message, /Audit-Log/, 'die Meldung nennt, was fehlt');

    // Mitglieder: sich selbst oder andere in eine Gruppe mit fremden Rechten setzen geht nicht
    assert.equal((await h.put(`/api/v1/admin/groups/${integration}/members`, { userIds: [ines, hilde] })).status, 403, 'sich selbst hinzufügen');
    assert.equal((await h.put(`/api/v1/admin/groups/${integration}/members`, { userIds: [] })).status, 403, 'Mitglieder entfernen');
    assert.equal((await h.put(`/api/v1/admin/groups/${integration}/members`, { userIds: [ines] })).status, 200, 'unverändert');
    assert.equal((await h.put(`/api/v1/admin/groups/${ki}/members`, { userIds: [karl] })).status, 200, 'Gruppe mit eigenen Rechten');
    assert.equal((await h.put(`/api/v1/admin/groups/${ohneRechte}/members`, { userIds: [karl] })).status, 200, 'Gruppe ohne Rechte');

    // Konten: Gruppen beim Anlegen und Ändern
    assert.equal((await h.post('/api/v1/admin/users', { username: 'neu1', displayName: 'Neu', password: 'geheim-geheim', groupIds: [integration] })).status, 403);
    assert.equal((await h.post('/api/v1/admin/users', { username: 'neu2', displayName: 'Neu', password: 'geheim-geheim', groupIds: [ki] })).status, 200);
    assert.equal((await h.patch(`/api/v1/admin/users/${karl}`, { groupIds: [integration] })).status, 403);
    assert.equal((await h.patch(`/api/v1/admin/users/${karl}`, { groupIds: [ki] })).status, 200);
    assert.equal((await h.patch(`/api/v1/admin/users/${hilde}`, { groupIds: [personal, integration] })).status, 403, 'sich selbst erweitern');

    // Konten mit Rechten, die man nicht hat, lassen sich nicht übernehmen (Adresse, Passwort, Zugangslink …)
    assert.equal((await h.patch(`/api/v1/admin/users/${ines}`, { email: 'ines-neu@example.com' })).status, 403);
    assert.equal((await h.post(`/api/v1/admin/users/${ines}/password`, { password: 'uebernommen-123' })).status, 403);
    assert.equal((await h.post(`/api/v1/admin/users/${ines}/reset-link`, {})).status, 403);
    assert.equal((await h.patch(`/api/v1/admin/users/${karl}`, { displayName: 'Karl K.' })).status, 200, 'Konten ohne fremde Rechte bleiben verwaltbar');

    // Die Systemadministration darf all das weiterhin
    assert.equal((await admin.put(`/api/v1/admin/groups/${integration}/members`, { userIds: [ines, karl] })).status, 200);
    assert.equal((await admin.patch(`/api/v1/admin/users/${karl}`, { groupIds: [ki, integration] })).status, 200);
    assert.equal((await admin.patch(`/api/v1/admin/users/${ines}`, { email: 'ines-neu@example.com' })).status, 200);
  } finally {
    await ctx.close();
  }
});

test('Aufgaben: Der Beginn darf nicht nach der Fälligkeit liegen', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { ...SETUP, sampleContent: true });
    const board = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Termine' })).body.id as number;
    const create = (body: Record<string, unknown>) => admin.post(`/api/v1/boards/${board}/tasks`, { title: 'Aufgabe', ...body });

    const bad = await create({ startDate: '2027-03-10', dueDate: '2027-03-05' });
    assert.equal(bad.status, 400, bad.raw);
    assert.match(bad.body.error.message, /Beginn/);
    assert.equal((await create({ startDate: '2027-03-05', dueDate: '2027-03-05' })).status, 200, 'gleicher Tag ist erlaubt');
    const task = (await create({ startDate: '2027-03-01', dueDate: '2027-03-05' })).body.id as number;
    assert.equal((await create({ dueDate: '2027-03-05' })).status, 200, 'nur Fälligkeit');
    assert.equal((await create({ startDate: '2027-03-05' })).status, 200, 'nur Beginn');

    // Ändern: jede der beiden Angaben allein kann die Reihenfolge verletzen
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { startDate: '2027-03-09' })).status, 400, 'Beginn nach der bisherigen Fälligkeit');
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { dueDate: '2027-02-20' })).status, 400, 'Fälligkeit vor dem bisherigen Beginn');
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { startDate: '2027-03-09', dueDate: '2027-03-12' })).status, 200, 'beide zusammen verschieben');
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { startDate: null })).status, 200, 'Beginn entfernen');

    // Ältere Aufgaben mit vertauschten Terminen bleiben änderbar, solange die Termine unberührt bleiben
    ctx.s.db.run("UPDATE tasks SET start_date = '2027-04-10', due_date = '2027-04-01' WHERE id = ?", task);
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { title: 'Umbenannt' })).status, 200);
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { dueDate: '2027-04-02' })).status, 400, 'bliebe vertauscht');
    assert.equal((await admin.patch(`/api/v1/tasks/${task}`, { dueDate: '2027-04-12' })).status, 200, 'behoben');

    // Wiederkehrende Aufgabe mit vertauschten Terminen bekommt trotzdem eine Nachfolgerin (ohne den Beginn)
    const series = (await create({ title: 'Serie', startDate: '2027-05-01', dueDate: '2027-05-03', recurrence: { freq: 'weekly', interval: 1 } })).body.id as number;
    ctx.s.db.run("UPDATE tasks SET start_date = '2027-05-09', due_date = '2027-05-03' WHERE id = ?", series);
    assert.equal((await admin.patch(`/api/v1/tasks/${series}`, { status: 'done' })).status, 200);
    const next = ctx.s.db.get<{ start_date: string | null; due_date: string | null }>('SELECT start_date, due_date FROM tasks WHERE series_id = ? AND id != ?', series, series);
    assert.ok(next, 'Nachfolgerin angelegt');
    assert.equal(next.start_date, null);
    assert.ok(next.due_date);
  } finally {
    await ctx.close();
  }
});
