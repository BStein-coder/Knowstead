import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/** Ersteinrichtung, Selbstregistrierung mit E-Mail-Bestätigung, E-Mail-Wechsel und Kommentarrechte. */
test('Konten: Einrichtung, Registrierung, Profil', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const remote = { remoteAddress: '203.0.113.7' };
  const setupBody = { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false };

  try {
    await t.test('Ersteinrichtung über das Netzwerk nur mit Einrichtungscode', async () => {
      const status = await ctx.app.inject({ method: 'GET', url: '/api/v1/setup/status', ...remote });
      assert.equal(status.json().setupCodeRequired, true);
      const local = await ctx.app.inject({ method: 'GET', url: '/api/v1/setup/status' });
      assert.equal(local.json().setupCodeRequired, false, 'vom Server selbst ohne Code');
      // Über einen Proxy (oder mit gefälschtem Header) nie „lokal“
      const proxied = await ctx.app.inject({ method: 'GET', url: '/api/v1/setup/status', headers: { 'x-forwarded-for': '127.0.0.1' } });
      assert.equal(proxied.json().setupCodeRequired, true);
      const spoofed = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/setup',
        payload: setupBody,
        headers: { 'x-knowstead-client': 'test', 'x-forwarded-for': '127.0.0.1' },
      });
      assert.equal(spoofed.statusCode, 403);

      const post = (payload: object) =>
        ctx.app.inject({ method: 'POST', url: '/api/v1/setup', payload, headers: { 'x-knowstead-client': 'test' }, ...remote });
      const without = await post(setupBody);
      assert.equal(without.statusCode, 403);
      assert.equal(without.json().error.code, 'setup_code');
      assert.equal((await post({ ...setupBody, setupCode: 'AAAA-AAAA' })).statusCode, 403);
      assert.equal(ctx.s.users.count(), 0, 'nichts angelegt');

      const code = ctx.s.auth.setupCode();
      assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const ok = await post({ ...setupBody, setupCode: code.toLowerCase().replace('-', ' ') });
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal((await admin.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' })).status, 200);
    });

    await t.test('Domain-Beschränkung ohne E-Mail-Versand: keine Registrierung', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { allowRegistration: true, registrationDomains: ['firma.de'] })).status, 200);
      const guest = new Client(ctx.app);
      const res = await guest.post('/api/v1/auth/register', { username: 'mallory', displayName: 'Mallory', email: 'chef@firma.de', password: 'geheim-geheim' });
      assert.equal(res.status, 403, res.raw);
      assert.equal(ctx.s.users.byUsername('mallory'), undefined);
    });

    await t.test('Offene Registrierung ohne E-Mail-Versand meldet sofort an', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { registrationDomains: [] })).status, 200);
      const guest = new Client(ctx.app);
      const res = await guest.post('/api/v1/auth/register', { username: 'olga', displayName: 'Olga', email: 'olga@example.com', password: 'geheim-geheim' });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.pending, false);
      assert.equal((await guest.get('/api/v1/auth/me')).body.user.username, 'olga');
    });

    // E-Mail-Versand „eingerichtet“, ohne tatsächlich zu senden
    ctx.s.mailer.isConfigured = () => true;
    ctx.s.mail.processQueue = async () => {};
    const linkFor = (username: string) => {
      const user = ctx.s.users.byUsername(username)!;
      const body = ctx.s.db.value<string>("SELECT text_body FROM mail_queue WHERE user_id = ? AND kind = 'registration' ORDER BY id DESC LIMIT 1", user.id)!;
      return /\/verify-email\/([A-Za-z0-9_-]+)/.exec(body)![1];
    };

    await t.test('Mit E-Mail-Versand: Anmeldung erst nach Bestätigung der Adresse', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { registrationDomains: ['firma.de'] })).status, 200);
      const guest = new Client(ctx.app);
      const res = await guest.post('/api/v1/auth/register', { username: 'paul', displayName: 'Paul', email: 'Paul@Firma.de', password: 'geheim-geheim' });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.pending, true);
      assert.equal(res.body.user, null);
      assert.equal((await guest.get('/api/v1/auth/me')).body.user, null, 'keine Sitzung vor der Bestätigung');

      const login = await guest.post('/api/v1/auth/login', { login: 'paul', password: 'geheim-geheim' });
      assert.equal(login.status, 403);
      assert.equal(login.body.error.code, 'email_unverified');

      const token = linkFor('paul');
      const verified = await guest.post('/api/v1/auth/verify-email', { token });
      assert.equal(verified.status, 200, verified.raw);
      assert.equal((await guest.get('/api/v1/auth/me')).body.user.username, 'paul');
      assert.equal((await new Client(ctx.app).post('/api/v1/auth/verify-email', { token })).status, 400, 'Link nur einmal');
      assert.equal((await new Client(ctx.app).post('/api/v1/auth/login', { login: 'paul', password: 'geheim-geheim' })).status, 200);
    });

    await t.test('Unbestätigte Registrierungen: Zurücksetzen bestätigt, Frist räumt auf, Admin schaltet frei', async () => {
      const guest = new Client(ctx.app);
      await guest.post('/api/v1/auth/register', { username: 'rita', displayName: 'Rita', email: 'rita@firma.de', password: 'geheim-geheim' });
      await guest.post('/api/v1/auth/register', { username: 'sven', displayName: 'Sven', email: 'sven@firma.de', password: 'geheim-geheim' });
      await guest.post('/api/v1/auth/register', { username: 'udo', displayName: 'Udo', email: 'udo@firma.de', password: 'geheim-geheim' });

      // Link aus „Passwort vergessen“ beweist die Adresse ebenfalls
      const rita = ctx.s.users.byUsername('rita')!;
      const resetToken = ctx.s.auth.createResetToken(rita.id);
      assert.equal((await guest.post('/api/v1/auth/reset', { token: resetToken, password: 'neu-geheim-geheim' })).status, 200);
      assert.equal((await new Client(ctx.app).post('/api/v1/auth/login', { login: 'rita', password: 'neu-geheim-geheim' })).status, 200);

      // Administration schaltet frei
      const udo = ctx.s.users.byUsername('udo')!;
      assert.equal((await admin.get(`/api/v1/admin/users/${udo.id}`)).body.registrationPendingAt !== null, true);
      assert.equal((await admin.post(`/api/v1/admin/users/${udo.id}/unlock`)).status, 200);
      assert.equal((await new Client(ctx.app).post('/api/v1/auth/login', { login: 'udo', password: 'geheim-geheim' })).status, 200);

      // Nach Ablauf der Frist gelöscht – Name und Adresse sind wieder frei
      ctx.s.db.run("UPDATE users SET registration_pending_at = '2020-01-01T00:00:00.000Z' WHERE username = 'sven'");
      assert.equal(ctx.s.auth.pruneUnverifiedRegistrations(), 1);
      assert.equal(ctx.s.users.byUsername('sven'), undefined);
      assert.ok(ctx.s.users.byUsername('paul'), 'bestätigte Konten bleiben');
    });

    await t.test('E-Mail-Adresse ändern nur mit aktuellem Passwort', async () => {
      const paul = new Client(ctx.app);
      assert.equal((await paul.post('/api/v1/auth/login', { login: 'paul', password: 'geheim-geheim' })).status, 200);
      const missing = await paul.patch('/api/v1/me', { email: 'angreifer@example.com' });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.error.code, 'password_required');
      const wrong = await paul.patch('/api/v1/me', { email: 'angreifer@example.com', currentPassword: 'falsch' });
      assert.equal(wrong.body.error.code, 'password_wrong');
      assert.equal(ctx.s.users.byUsername('paul')!.email, 'paul@firma.de');
      // Andere Felder und unveränderte Adresse ohne Passwort
      assert.equal((await paul.patch('/api/v1/me', { displayName: 'Paul P.', email: 'PAUL@firma.de' })).status, 200);
      const ok = await paul.patch('/api/v1/me', { email: 'paul.neu@firma.de', currentPassword: 'geheim-geheim' });
      assert.equal(ok.status, 200, ok.raw);
      assert.equal(ok.body.email, 'paul.neu@firma.de');
    });

    await t.test('Kommentare: ohne Kommentarrecht nicht mehr bearbeiten oder erledigen', async () => {
      assert.equal((await admin.post('/api/v1/spaces', { key: 'KOM', name: 'Kommentare', preset: 'readonly' })).status, 200);
      const paulId = ctx.s.users.byUsername('paul')!.id;
      const grants = (await admin.get('/api/v1/spaces/KOM/permissions')).body as { subjectType: string; subjectId: number; role: string }[];
      await admin.put('/api/v1/spaces/KOM/permissions', { grants: [...grants, { subjectType: 'user', subjectId: paulId, role: 'commenter' }] });
      const page = await admin.post('/api/v1/pages', { spaceKey: 'KOM', title: 'Diskussion', content: '<p>x</p>' });
      const paul = new Client(ctx.app);
      await paul.post('/api/v1/auth/login', { login: 'paul', password: 'geheim-geheim' });
      const comment = await paul.post(`/api/v1/pages/${page.body.id}/comments`, { body: '<p>Frage</p>' });
      assert.equal(comment.status, 200, comment.raw);
      assert.equal((await paul.patch(`/api/v1/comments/${comment.body.id}`, { body: '<p>Frage, präziser</p>' })).status, 200);

      // Rolle entzogen: nur noch lesen
      await admin.put('/api/v1/spaces/KOM/permissions', { grants });
      assert.equal((await paul.patch(`/api/v1/comments/${comment.body.id}`, { body: '<p>nachträglich</p>' })).status, 403);
      assert.equal((await paul.post(`/api/v1/comments/${comment.body.id}/resolve`, { resolved: true })).status, 403);
      const listed = (await paul.get(`/api/v1/pages/${page.body.id}/comments`)).body as { id: number; can: { edit: boolean; resolve: boolean; delete: boolean } }[];
      assert.deepEqual(listed.find((c) => c.id === comment.body.id)!.can, { edit: false, delete: true, resolve: false, reply: false });
      assert.equal((await paul.del(`/api/v1/comments/${comment.body.id}`)).status, 200, 'eigene Kommentare löschen bleibt möglich');
    });
  } finally {
    await ctx.close();
  }
});
