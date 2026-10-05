import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Bewegung und 3D-Effekte der Oberfläche: Vorgabe der Installation (öffentlich lesbar, weil schon die
 * Anmeldeseite sie braucht) und eigene Wahl je Konto.
 */
test('Bewegung und Effekte: Vorgabe der Installation und Wahl je Konto', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const anon = new Client(ctx.app);
  const mia = new Client(ctx.app);
  try {
    assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
    assert.equal((await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' })).status, 200);
    assert.equal((await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' })).status, 200);

    await t.test('Vorgabe ist „voll“ und ohne Anmeldung lesbar', async () => {
      const me = await anon.get('/api/v1/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.body.user, null);
      assert.equal(me.body.settings.uiMotion, 'full');
    });

    await t.test('Administration stellt auf „reduziert“ – gilt sofort für alle, auch vor der Anmeldung', async () => {
      const res = await admin.put('/api/v1/admin/settings', { uiMotion: 'reduced' });
      assert.equal(res.status, 200, res.raw);
      assert.equal((await anon.get('/api/v1/auth/me')).body.settings.uiMotion, 'reduced');
      assert.equal((await mia.get('/api/v1/auth/me')).body.settings.uiMotion, 'reduced');
    });

    await t.test('ungültige Werte werden abgelehnt, die Vorgabe bleibt', async () => {
      for (const value of ['schnell', '', 1, null, { a: 1 }]) {
        const res = await admin.put('/api/v1/admin/settings', { uiMotion: value });
        assert.equal(res.status, 400, `${JSON.stringify(value)}: ${res.raw}`);
      }
      assert.equal((await anon.get('/api/v1/auth/me')).body.settings.uiMotion, 'reduced');
      const en = await admin.request('PUT', '/api/v1/admin/settings', { uiMotion: 'schnell' }, { 'x-knowstead-locale': 'en' });
      assert.equal(en.status, 400);
      assert.match(en.body.error.message, /Motion and effects/);
    });

    await t.test('nur die Administration darf die Vorgabe ändern', async () => {
      assert.equal((await mia.put('/api/v1/admin/settings', { uiMotion: 'full' })).status, 403);
      assert.equal((await anon.put('/api/v1/admin/settings', { uiMotion: 'full' })).status, 401);
      assert.equal((await anon.get('/api/v1/auth/me')).body.settings.uiMotion, 'reduced');
    });

    await t.test('eigene Wahl je Konto: wird gespeichert und ändert nichts für andere', async () => {
      assert.equal((await mia.patch('/api/v1/me/preferences', { motion: 'full' })).status, 200);
      assert.equal((await mia.get('/api/v1/auth/me')).body.user.preferences.motion, 'full');
      assert.equal((await admin.get('/api/v1/auth/me')).body.user.preferences.motion, undefined);
      // Wahl zurücknehmen: dann gilt wieder die Vorgabe
      assert.equal((await mia.patch('/api/v1/me/preferences', { motion: null })).status, 200);
      assert.equal((await mia.get('/api/v1/auth/me')).body.user.preferences.motion, undefined);
    });

    await t.test('Vorgabe steht im Audit-Protokoll', async () => {
      const res = await admin.put('/api/v1/admin/settings', { uiMotion: 'full' });
      assert.equal(res.status, 200);
      assert.equal((await anon.get('/api/v1/auth/me')).body.settings.uiMotion, 'full');
      const audit = await admin.get('/api/v1/admin/audit?limit=20');
      assert.equal(audit.status, 200);
      assert.match(JSON.stringify(audit.body), /settings\.updated/);
    });
  } finally {
    await ctx.close();
  }
});
