import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MailMessage } from '../src/core/mailer.ts';
import { parseRecipients } from '../src/modules/system/alerts.ts';
import { Client, createTestApp } from './helpers.ts';

/**
 * Betriebswarnungen: Sicherung gescheitert oder veraltet, wenig Speicherplatz, Neustart nach einem Update.
 * Geprüft wird der ganze Weg – erkennen, in der Übersicht zeigen, per E-Mail melden (einmal, nicht bei jeder
 * Prüfung), erinnern, verschärfen, entwarnen – und der Zustand für Überwachungssysteme.
 */
const GB = 1024 ** 3;

test('Empfänger aus den Einstellungen: Trennzeichen, Dubletten, ungültige Adressen', () => {
  assert.deepEqual(parseRecipients('a@example.com, b@example.com;c@example.com\n a@example.com'), { valid: ['a@example.com', 'b@example.com', 'c@example.com'], invalid: [] });
  assert.deepEqual(parseRecipients(''), { valid: [], invalid: [] });
  assert.deepEqual(parseRecipients('betrieb@firma.de, kaputt, @x.de').invalid, ['kaputt', '@x.de']);
});

test('Betriebswarnungen: erkennen, melden, erinnern, entwarnen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const mia = new Client(ctx.app);
  const s = ctx.s;

  // E-Mails landen nicht im Netz, sondern hier
  const outbox: MailMessage[] = [];
  s.mailer.send = async (message) => void outbox.push(message);
  const mails = async () => {
    await s.mail.processQueue();
    return outbox.splice(0);
  };
  let free = 500 * GB;
  s.alerts.probes.freeBytes = () => free;
  let programChange: 'missing' | 'replaced' | 'updated' | null = null;
  s.program.change = () => programChange;

  let clock = new Date('2026-10-05T08:00:00.000Z');
  const later = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));
  const alerts = async (client: Client = admin, headers: Record<string, string> = {}) =>
    (await client.request('GET', '/api/v1/admin/alerts', undefined, headers)).body as {
      alerts: { id: string; severity: string; title: string; message: string; hint: string; since: string }[];
      mail: { enabled: boolean; configured: boolean; recipients: number };
    };

  try {
    await t.test('Einrichtung: zwei Verwaltende, ein Verteiler, ein Mitglied', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Wiki', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', email: 'ada@example.com', sampleContent: false })).status, 200);
      const adminGroup = s.db.all<{ id: number; permissions: string }>('SELECT id, permissions FROM groups').find((g) => (JSON.parse(g.permissions) as string[]).includes('admin'))!;
      const ben = await admin.post('/api/v1/admin/users', { username: 'ben', displayName: 'Ben', password: 'geheim-geheim', email: 'ben@example.com', groupIds: [adminGroup.id] });
      assert.equal(ben.status, 200, ben.raw);
      // Ben liest Englisch – seine Warnungen kommen auf Englisch
      s.users.updatePreferences(ben.body.id as number, { locale: 'en' });
      assert.equal((await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' })).status, 200);
      assert.equal((await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' })).status, 200);
      const saved = await admin.put('/api/v1/admin/settings', {
        smtp: { host: '127.0.0.1', port: 2525, from: 'wiki@example.com', security: 'none' },
        alerts: { recipients: 'betrieb@example.com; ada@example.com' },
        backupEnabled: false,
      });
      assert.equal(saved.status, 200, saved.raw);
      assert.deepEqual(saved.body.alerts, { email: true, recipients: 'betrieb@example.com, ada@example.com', diskMinGb: 2, backupMaxAgeDays: 2 });
      assert.deepEqual(s.alerts.recipients().map((r) => `${r.email}:${r.locale}`).sort(), ['ada@example.com:de', 'ben@example.com:en', 'betrieb@example.com:de'], 'Administratorkonten und Verteiler, ohne Dubletten und ohne Mitglieder');
    });

    await t.test('Ohne Befund: nichts zu melden', async () => {
      assert.deepEqual(s.alerts.evaluate(clock), { alerts: [], mailed: 0 });
      assert.deepEqual(await mails(), []);
      const overview = await alerts();
      assert.deepEqual(overview.alerts, []);
      assert.deepEqual(overview.mail, { enabled: true, configured: true, recipients: 3 });
      assert.equal((await admin.get('/api/v1/monitoring')).body.status, 'ok');
    });

    await t.test('Wenig Speicherplatz: eine E-Mail beim Auftreten, nicht bei jeder Prüfung', async () => {
      free = 1.2 * GB;
      const first = s.alerts.evaluate(later(10));
      assert.equal(first.alerts.length, 1);
      assert.equal(first.mailed, 3);
      const sent = await mails();
      assert.deepEqual(sent.map((m) => m.to).sort(), ['ada@example.com', 'ben@example.com', 'betrieb@example.com']);
      const ada = sent.find((m) => m.to === 'ada@example.com')!;
      assert.equal(ada.subject, 'Wiki: Warnung – Wenig freier Speicherplatz');
      assert.match(ada.text, /Auf dem Laufwerk des Datenverzeichnisses sind nur noch 1,2 GB frei\./);
      assert.match(ada.text, /Platz schaffen oder das Laufwerk vergrößern/);
      assert.match(ada.text, /Übersicht öffnen: http:\/\/localhost:3999\/admin/);
      assert.match(ada.html ?? '', /nur noch 1,2 GB frei/);
      const ben = sent.find((m) => m.to === 'ben@example.com')!;
      assert.equal(ben.subject, 'Wiki: Alert – Low disk space');
      assert.match(ben.text, /Only 1,2 GB are left on the drive of the data directory\./);

      // Zehn Minuten später: dieselbe Lage, keine weitere E-Mail
      assert.equal(s.alerts.evaluate(later(10)).mailed, 0);
      assert.deepEqual(await mails(), []);

      const shown = (await alerts()).alerts;
      assert.deepEqual(shown.map((a) => [a.id, a.severity, a.title]), [['disk', 'warn', 'Wenig freier Speicherplatz']]);
      assert.equal(shown[0].since, new Date('2026-10-05T08:10:00.000Z').toISOString(), 'seit dem ersten Auftreten');
      // Die Übersicht spricht die Sprache der Anfrage
      assert.equal((await alerts(admin, { 'x-knowstead-locale': 'en' })).alerts[0].title, 'Low disk space');
    });

    await t.test('Erinnerung nach einem Tag, sofortige E-Mail bei Verschärfung', async () => {
      assert.equal(s.alerts.evaluate(later(23 * 60)).mailed, 0, 'noch kein ganzer Tag');
      assert.equal(s.alerts.evaluate(later(60)).mailed, 3, 'Erinnerung nach 24 Stunden');
      assert.equal((await mails()).length, 3);

      free = 200 * 1024 ** 2;
      const worse = s.alerts.evaluate(later(10));
      assert.equal(worse.alerts[0].severity, 'error');
      assert.equal(worse.mailed, 3, 'aus der Warnung wurde ein Fehler');
      assert.match((await mails())[0].text, /nur noch 200 MB frei/);
      const monitoring = await admin.get('/api/v1/monitoring');
      assert.equal(monitoring.status, 200);
      assert.equal(monitoring.body.status, 'error');
      assert.equal(monitoring.body.checks.diskFreeBytes, free);
      assert.equal((await admin.get('/api/v1/monitoring?strict=true')).status, 503, 'für Prüfungen, die nur den Statuscode auswerten');
    });

    await t.test('Entwarnung, sobald die Ursache behoben ist', async () => {
      free = 300 * GB;
      const result = s.alerts.evaluate(later(10));
      assert.deepEqual([result.alerts.length, result.mailed], [0, 3]);
      const sent = await mails();
      assert.equal(sent.find((m) => m.to === 'ada@example.com')!.subject, 'Wiki: Wieder in Ordnung – Wenig freier Speicherplatz');
      assert.equal(sent.find((m) => m.to === 'ben@example.com')!.subject, 'Wiki: Back to normal – Low disk space');
      assert.equal(s.alerts.evaluate(later(10)).mailed, 0);
      assert.equal((await admin.get('/api/v1/monitoring?strict=true')).status, 200);
    });

    await t.test('Gescheiterte Sicherung: Warnung bis zur nächsten gelungenen, kein Dauerfeuer', async () => {
      await admin.put('/api/v1/admin/settings', { backupEnabled: true, backupHour: 0 });
      const create = s.backups.create.bind(s.backups);
      s.backups.create = async () => {
        throw new Error('ENOSPC: no space left on device');
      };
      // Echte Uhrzeit: Die Sicherung trägt ihr tatsächliches Entstehungsdatum – eine erfundene Zukunft ließe sie alt aussehen
      const night = new Date();
      assert.equal(await s.backups.runScheduled(night), 'failed');
      assert.equal(await s.backups.runScheduled(new Date(night.getTime() + 15 * 60_000)), 'skipped', 'erst nach einer Stunde erneut');
      const failed = s.alerts.evaluate(new Date(night.getTime() + 60_000));
      assert.deepEqual(failed.alerts.map((a) => [a.id, a.severity]), [['backup-failed', 'error']]);
      assert.match(failed.alerts[0].message, /ist gescheitert: ENOSPC: no space left on device$/);
      assert.equal(failed.mailed, 3);
      assert.equal((await mails()).find((m) => m.to === 'betrieb@example.com')!.subject, 'Wiki: Warnung – Automatische Sicherung fehlgeschlagen');

      s.backups.create = create;
      assert.equal(await s.backups.runScheduled(new Date(night.getTime() + 61 * 60_000)), 'done');
      const healed = s.alerts.evaluate(new Date(night.getTime() + 62 * 60_000));
      assert.deepEqual([healed.alerts.length, healed.mailed], [0, 3]);
      assert.match((await mails())[0].subject, /Wieder in Ordnung – Automatische Sicherung fehlgeschlagen|Back to normal – Automatic backup failed/);
    });

    await t.test('Keine aktuelle Sicherung – aber nicht bei einer frischen Installation', async () => {
      for (const backup of s.backups.list()) s.backups.delete(s.perms.system(), backup.name);
      clock = new Date();
      assert.deepEqual(s.alerts.evaluate(clock).alerts, [], 'heute eingerichtet: noch nichts zu beanstanden');
      // Die Installation ist zehn Tage alt und hat keine Sicherung
      s.db.run('UPDATE users SET created_at = ?', new Date(clock.getTime() - 10 * 86_400_000).toISOString());
      const old = s.alerts.evaluate(clock);
      assert.deepEqual(old.alerts.map((a) => [a.id, a.severity, a.message]), [['backup-old', 'warn', 'Es gibt noch keine Sicherung.']]);
      await mails();
      // Abgeschaltete Sicherung ist eine Entscheidung, kein Fehler
      await admin.put('/api/v1/admin/settings', { backupEnabled: false });
      assert.deepEqual(s.alerts.check(clock), []);
      await admin.put('/api/v1/admin/settings', { backupEnabled: true });
      await s.backups.create(null, 'manual');
      assert.deepEqual(s.alerts.evaluate(clock).alerts, []);
      await mails();
    });

    await t.test('Neustart erforderlich – mit dem passenden Befehl', async () => {
      programChange = 'replaced';
      const result = s.alerts.evaluate(later(10));
      assert.deepEqual(result.alerts.map((a) => [a.id, a.severity, a.title]), [['restart', 'warn', 'Neustart erforderlich']]);
      assert.equal(result.alerts[0].hint, 'Bitte den Dienst neu starten: Server beenden und neu starten');
      assert.match((await mails()).find((m) => m.to === 'ben@example.com')!.text, /Please restart the service: stop the server and start it again/);
      programChange = 'missing';
      assert.equal(s.alerts.check(clock)[0].severity, 'error');
      programChange = null;
      s.alerts.evaluate(later(10));
      await mails();
    });

    await t.test('E-Mail abgeschaltet: Warnung bleibt sichtbar, die E-Mail folgt beim Einschalten', async () => {
      await admin.put('/api/v1/admin/settings', { alerts: { email: false } });
      free = 1 * GB;
      const quiet = s.alerts.evaluate(later(10));
      assert.deepEqual([quiet.alerts.length, quiet.mailed], [1, 0]);
      assert.deepEqual(await mails(), []);
      assert.equal((await alerts()).mail.enabled, false);
      await admin.put('/api/v1/admin/settings', { alerts: { email: true } });
      assert.equal(s.alerts.evaluate(later(10)).mailed, 3, 'noch nie gemeldet: jetzt');
      await mails();
      free = 300 * GB;
      s.alerts.evaluate(later(10));
      await mails();
    });

    await t.test('Testwarnung an alle Empfänger', async () => {
      const res = await admin.post('/api/v1/admin/alerts/test', {});
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(res.body, { recipients: 3 });
      const sent = await mails();
      assert.equal(sent.find((m) => m.to === 'ada@example.com')!.subject, 'Wiki: Testwarnung');
      assert.equal(sent.find((m) => m.to === 'ben@example.com')!.subject, 'Wiki: Test alert');
    });

    await t.test('Einstellungen: Eingaben werden geprüft', async () => {
      for (const [alertsPatch, message] of [
        [{ recipients: 'betrieb@example.com, kaputt' }, /Ungültige E-Mail-Adresse bei den Empfängern der Warnungen: kaputt/],
        [{ diskMinGb: -1 }, /0–1000 GB/],
        [{ backupMaxAgeDays: 1.5 }, /0–60 Tage/],
      ] as const) {
        const res = await admin.put('/api/v1/admin/settings', { alerts: alertsPatch });
        assert.equal(res.status, 400, JSON.stringify(alertsPatch));
        assert.match(res.body.error.message, message);
      }
      // 0 schaltet die jeweilige Prüfung ab
      await admin.put('/api/v1/admin/settings', { alerts: { diskMinGb: 0 } });
      free = 1024;
      assert.deepEqual(s.alerts.check(clock), []);
      await admin.put('/api/v1/admin/settings', { alerts: { diskMinGb: 2 } });
      free = 300 * GB;
    });

    await t.test('Nur für die Verwaltung – Überwachung auch mit einem Lese-Token', async () => {
      assert.equal((await mia.get('/api/v1/admin/alerts')).status, 403);
      assert.equal((await mia.get('/api/v1/monitoring')).status, 403);
      assert.equal((await mia.post('/api/v1/admin/alerts/test', {})).status, 403);
      assert.equal((await new Client(ctx.app).get('/api/v1/monitoring')).status, 401);
      const token = (await admin.post('/api/v1/me/tokens', { name: 'Überwachung', scopes: ['read'] })).body.token as string;
      const probe = new Client(ctx.app);
      probe.token = token;
      const res = await probe.get('/api/v1/monitoring');
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(Object.keys(res.body).sort(), ['alerts', 'checks', 'status', 'time', 'version']);
      assert.deepEqual(Object.keys(res.body.checks).sort(), ['backupAgeHours', 'backupFailed', 'diskFreeBytes', 'mailConfigured', 'mailsFailed', 'restartRequired', 'uptimeSeconds']);
      assert.equal(res.body.status, 'ok');
      assert.equal(typeof res.body.checks.backupAgeHours, 'number');
    });
  } finally {
    await ctx.close();
  }
});
