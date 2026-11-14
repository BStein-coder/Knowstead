import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginThrottle, sourceOf } from '../src/modules/auth/throttle.ts';
import { ACCOUNT_LOCK_FACTOR } from '../src/modules/auth/service.ts';
import { Client, createTestApp } from './helpers.ts';

test('Absender: IPv4 für sich, IPv6 je Anschluss (/64), ohne Adresse „unbekannt“', () => {
  assert.equal(sourceOf('10.0.0.5'), '10.0.0.5');
  assert.equal(sourceOf('::ffff:10.0.0.5'), '10.0.0.5');
  assert.equal(sourceOf('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(sourceOf('2001:db8:1:2::1'), sourceOf('2001:db8:1:2:ffff::9'), 'gleicher Anschluss');
  assert.notEqual(sourceOf('2001:db8:1:2::1'), sourceOf('2001:db8:1:3::1'));
  assert.equal(sourceOf('::1'), '0:0:0:0::/64');
  assert.equal(sourceOf('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(sourceOf(null), 'unbekannt');
  assert.equal(sourceOf(''), 'unbekannt');
});

test('Bremse: sperrt nur den Schlüssel, Fehlversuche verjähren, die Menge ist begrenzt', () => {
  let now = 1_000_000;
  const throttle = new LoginThrottle(() => now);
  const MIN = 60_000;
  const a = LoginThrottle.key(7, 'ada', '10.0.0.66');
  const b = LoginThrottle.key(7, 'ada', '10.0.0.7');
  assert.notEqual(a, b);
  assert.equal(LoginThrottle.key(undefined, ' Ada ', '10.0.0.66'), LoginThrottle.key(undefined, 'ada', '10.0.0.66'), 'unbekannte Namen ohne Groß-/Kleinschreibung');

  assert.equal(throttle.fail(a, 3, 10 * MIN), false);
  assert.equal(throttle.fail(a, 3, 10 * MIN), false);
  assert.equal(throttle.lockedFor(a), 0);
  assert.equal(throttle.fail(a, 3, 10 * MIN), true, 'dritter Fehlversuch sperrt');
  assert.equal(throttle.lockedFor(a), 10 * MIN);
  assert.equal(throttle.lockedFor(b), 0, 'ein anderer Absender ist nicht betroffen');
  now += 10 * MIN;
  assert.equal(throttle.lockedFor(a), 0, 'nach der Sperrdauer wieder frei');

  // Verjährung: zwei Fehlversuche, lange Pause, dann beginnt die Zählung neu
  throttle.fail(b, 3, 10 * MIN);
  throttle.fail(b, 3, 10 * MIN);
  now += 11 * MIN;
  assert.equal(throttle.fail(b, 3, 10 * MIN), false, 'alte Fehlversuche zählen nicht mehr');

  // Aufheben: ein Schlüssel bzw. alle eines Kontos – nicht die eines anderen
  const other = LoginThrottle.key(70, 'x', '10.0.0.66');
  for (const key of [a, b, other]) for (let i = 0; i < 3; i++) throttle.fail(key, 3, 10 * MIN);
  throttle.clear(a);
  assert.equal(throttle.lockedFor(a), 0);
  assert.ok(throttle.lockedFor(b) > 0);
  throttle.clearUser(7);
  assert.equal(throttle.lockedFor(b), 0);
  assert.ok(throttle.lockedFor(other) > 0, 'Konto 70 beginnt mit denselben Ziffern, ist aber ein anderes');

  // Eine Flut erfundener Namen lässt den Speicher nicht wachsen
  for (let i = 0; i < 25_000; i++) throttle.fail(LoginThrottle.key(undefined, `name-${i}`, '10.9.9.9'), 3, 10 * MIN);
  assert.ok(throttle.size <= 20_000, `${throttle.size} Einträge`);
});

test('Anmeldung: Fehlversuche sperren den Absender, nicht das Konto', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const PASSWORD = 'geheim-geheim';
  let victimId = 0;
  const attempt = async (ip: string, login: string, password: string) => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login, password }, headers: { 'x-knowstead-client': 'test' }, remoteAddress: ip });
    return res.statusCode;
  };
  const reasons = () =>
    ctx.s.db
      .all<{ data: string }>("SELECT data FROM events WHERE type = 'auth.login_failed' ORDER BY id")
      .map((e) => JSON.parse(e.data) as { reason: string; scope?: string })
      .map((d) => (d.scope ? `${d.reason}/${d.scope}` : d.reason));

  try {
    await t.test('Einrichtung: drei Fehlversuche erlaubt, fünf Minuten Sperre', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: PASSWORD, sampleContent: false })).status, 200);
      const created = await admin.post('/api/v1/admin/users', { username: 'opfer', displayName: 'Olga Opfer', password: PASSWORD, email: 'olga@example.com' });
      assert.equal(created.status, 200, created.raw);
      victimId = created.body.id;
      assert.equal((await admin.put('/api/v1/admin/settings', { maxLoginAttempts: 3, lockMinutes: 5 })).status, 200);
    });

    await t.test('Wer rät, sperrt nur sich selbst aus – die Person meldet sich von woanders weiter an', async () => {
      assert.equal(await attempt('10.0.0.66', 'opfer', 'falsch-1'), 401);
      assert.equal(await attempt('10.0.0.66', 'opfer', 'falsch-2'), 401);
      assert.equal(await attempt('10.0.0.66', 'opfer', 'falsch-3'), 401);
      assert.equal(await attempt('10.0.0.66', 'opfer', PASSWORD), 429, 'der Absender ist gesperrt – auch mit richtigem Kennwort');
      assert.equal(await attempt('10.0.0.7', 'opfer', PASSWORD), 200, 'von einer anderen Adresse klappt die Anmeldung');
      assert.equal(await attempt('10.0.0.66', 'opfer', PASSWORD), 429, 'die Anmeldung der Person hebt die fremde Sperre nicht auf');
      assert.equal(ctx.s.db.value('SELECT locked_until FROM users WHERE id = ?', victimId), null, 'das Konto selbst ist nicht gesperrt');
      assert.deepEqual(reasons().slice(-5), ['bad_password', 'bad_password', 'source_locked_now', 'locked/source', 'locked/source']);
      // Die Benutzerverwaltung sieht die Sperre des Absenders (und kann sie aufheben), das Konto gilt nicht als gesperrt
      const detail = await admin.get(`/api/v1/admin/users/${victimId}`);
      assert.equal(detail.body.lockedUntil, null);
      assert.equal(detail.body.sourceLocks.count, 1);
      assert.ok(detail.body.sourceLocks.until > new Date().toISOString());
      assert.deepEqual((await admin.get('/api/v1/admin/users/1')).body.sourceLocks, { count: 0, until: null });
    });

    await t.test('Auch über die E-Mail-Adresse gilt dieselbe Sperre', async () => {
      assert.equal(await attempt('10.0.0.66', 'olga@example.com', PASSWORD), 429);
    });

    await t.test('Ein erfundener Name wird genauso gebremst – die Sperre verrät kein Konto', async () => {
      assert.equal(await attempt('10.0.0.80', 'gibt-es-nicht', 'x'), 401);
      assert.equal(await attempt('10.0.0.80', 'Gibt-Es-Nicht', 'x'), 401);
      assert.equal(await attempt('10.0.0.80', ' gibt-es-nicht', 'x'), 401);
      assert.equal(await attempt('10.0.0.80', 'gibt-es-nicht', 'x'), 429);
      assert.equal(await attempt('10.0.0.80', 'opfer', PASSWORD), 200, 'andere Konten bleiben für diesen Absender offen');
    });

    await t.test('Eigene Fehlversuche beginnen nach einer gelungenen Anmeldung neu', async () => {
      assert.equal(await attempt('10.0.0.9', 'opfer', 'vertippt'), 401);
      assert.equal(await attempt('10.0.0.9', 'opfer', 'vertippt'), 401);
      assert.equal(await attempt('10.0.0.9', 'opfer', PASSWORD), 200);
      assert.equal(await attempt('10.0.0.9', 'opfer', 'vertippt'), 401);
      assert.equal(await attempt('10.0.0.9', 'opfer', 'vertippt'), 401);
      assert.equal(await attempt('10.0.0.9', 'opfer', PASSWORD), 200, 'Fehlversuche nach der Anmeldung zählen wieder von vorn');
    });

    await t.test('IPv6: Adressen desselben Anschlusses zählen zusammen', async () => {
      assert.equal(await attempt('2001:db8:1:2::1', 'opfer', 'falsch'), 401);
      assert.equal(await attempt('2001:db8:1:2:aaaa::2', 'opfer', 'falsch'), 401);
      assert.equal(await attempt('2001:db8:1:2:cccc::4', 'opfer', 'falsch'), 401);
      assert.equal(await attempt('2001:db8:1:2:bbbb::3', 'opfer', PASSWORD), 429);
      assert.equal(await attempt('2001:db8:1:3::1', 'opfer', PASSWORD), 200, 'ein anderer Anschluss');
    });

    await t.test('„Sperre aufheben“ und ein neues Kennwort heben auch die Sperren der Absender auf', async () => {
      assert.equal((await admin.post(`/api/v1/admin/users/${victimId}/unlock`)).status, 200);
      assert.equal(await attempt('10.0.0.66', 'opfer', PASSWORD), 200);
      for (let i = 0; i < 3; i++) assert.equal(await attempt('10.0.0.67', 'opfer', 'falsch'), 401);
      assert.equal(await attempt('10.0.0.67', 'opfer', PASSWORD), 429);
      ctx.s.users.setPassword(victimId, 'ganz-neues-kennwort');
      assert.equal(await attempt('10.0.0.67', 'opfer', 'ganz-neues-kennwort'), 200);
      ctx.s.users.setPassword(victimId, PASSWORD);
    });

    await t.test('Verteiltes Raten: Erst beim Zehnfachen wird das ganze Konto gesperrt', async () => {
      assert.equal(ACCOUNT_LOCK_FACTOR, 10);
      // 3 erlaubte Fehlversuche × 10 = 30 – aus zehn Richtungen je drei
      const fromManySides = async (net: string, sources: number) => {
        for (let i = 0; i < sources; i++) for (let n = 0; n < 3; n++) assert.equal(await attempt(`${net}.${i}`, 'opfer', 'falsch'), 401);
      };
      await fromManySides('10.1.0', 9);
      assert.equal(await attempt('10.2.0.1', 'opfer', PASSWORD), 200, 'nach 27 Fehlversuchen ist das Konto noch offen …');
      // … und die gelungene Anmeldung beginnt die Zählung für das Konto neu
      await fromManySides('10.3.0', 10);
      assert.ok(String(ctx.s.db.value('SELECT locked_until FROM users WHERE id = ?', victimId)) > new Date().toISOString(), 'Konto gesperrt');
      assert.equal(await attempt('10.2.0.1', 'opfer', PASSWORD), 429, 'jetzt ist das Konto für alle gesperrt');
      assert.equal(reasons().at(-1), 'locked/account');
      assert.equal(reasons().at(-2), 'locked_now');
      assert.equal((await admin.post(`/api/v1/admin/users/${victimId}/unlock`)).status, 200);
      assert.equal(await attempt('10.2.0.1', 'opfer', PASSWORD), 200);
    });
  } finally {
    await ctx.close();
  }
});
