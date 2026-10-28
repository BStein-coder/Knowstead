import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, createTestApp } from './helpers.ts';
import { compareVersions } from '../src/modules/system/updates.ts';

/** Hinweis auf neue Versionen (Administration → Über): nur auf Wunsch, nur für die Administration, gemerkt und gedrosselt. */
const SETUP = { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false };

const nextPatch = (version: string) => {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
};

test('Versionen vergleichen', () => {
  assert.equal(compareVersions('2.2.2', '2.2.2'), 0);
  assert.equal(compareVersions('2.2.3', '2.2.2'), 1);
  assert.equal(compareVersions('2.2.2', '2.10.0'), -1, 'Zahlen, keine Zeichenfolgen');
  assert.equal(compareVersions('3.0.0', '2.99.99'), 1);
});

test('Hinweis auf neue Versionen: nur auf Wunsch, nur für die Administration, gemerkt und gedrosselt', async () => {
  const ctx = await createTestApp();
  const requests: http.IncomingHttpHeaders[] = [];
  let reply = { status: 200, body: '' };
  const github = http.createServer((req, res) => {
    requests.push(req.headers);
    res.statusCode = reply.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => github.listen(0, '127.0.0.1', resolve));
  const { port } = github.address() as AddressInfo;
  ctx.s.updates.endpoint = `http://127.0.0.1:${port}/latest`;

  const current = ctx.s.config.version;
  const higher = nextPatch(current);
  const release = (version: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      tag_name: `v${version}`,
      name: `Knowstead ${version}`,
      html_url: `https://github.com/BStein-coder/Knowstead/releases/tag/v${version}`,
      published_at: '2030-01-02T10:00:00Z',
      draft: false,
      prerelease: false,
      ...extra,
    });
  /** Die Drosselung (ein Abruf je Minute) für den nächsten Abruf aufheben. */
  const again = () => {
    (ctx.s.updates as unknown as { lastAttempt: number }).lastAttempt = 0;
  };

  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', SETUP);
    assert.equal((await admin.post('/api/v1/admin/users', { username: 'mia', displayName: 'Mia', password: 'geheim-geheim', email: 'mia@example.com' })).status, 200);
    const mia = new Client(ctx.app);
    assert.equal((await mia.post('/api/v1/auth/login', { login: 'mia', password: 'geheim-geheim' })).status, 200);

    // Standard: aus – nichts geht hinaus, und ein Abruf wird abgelehnt
    assert.equal((await admin.get('/api/v1/admin/settings')).body.updateCheck, false);
    const off = await admin.get('/api/v1/admin/update-check');
    assert.equal(off.status, 200);
    assert.deepEqual({ ...off.body, current: undefined }, {
      enabled: false, latest: null, url: null, name: null, publishedAt: null, checkedAt: null, error: null, newer: false, source: 'github.com/BStein-coder/Knowstead', current: undefined,
    });
    assert.equal(off.body.current, current);
    assert.equal((await admin.post('/api/v1/admin/update-check', {})).status, 400);
    assert.equal(requests.length, 0, 'ausgeschaltet: kein Abruf');

    // Nur die Administration
    assert.equal((await mia.get('/api/v1/admin/update-check')).status, 403);
    assert.equal((await mia.post('/api/v1/admin/update-check', {})).status, 403);
    assert.equal((await new Client(ctx.app).get('/api/v1/admin/update-check')).status, 401);

    // Der Schalter wird nur bei „true“ eingeschaltet
    assert.equal((await admin.put('/api/v1/admin/settings', { updateCheck: 'ja' })).body.updateCheck, false);
    assert.equal((await admin.put('/api/v1/admin/settings', { updateCheck: true })).body.updateCheck, true);
    assert.equal(requests.length, 0, 'Einschalten allein ruft noch nichts ab');

    // Neuere Version: Hinweis mit Verweis; gesendet wird nur die Kennung – nichts über die Installation
    reply = { status: 200, body: release(higher) };
    const found = await admin.post('/api/v1/admin/update-check', {});
    assert.equal(found.status, 200, found.raw);
    assert.equal(found.body.enabled, true);
    assert.equal(found.body.latest, higher);
    assert.equal(found.body.newer, true);
    assert.equal(found.body.url, `https://github.com/BStein-coder/Knowstead/releases/tag/v${higher}`);
    assert.equal(found.body.publishedAt, '2030-01-02T10:00:00.000Z');
    assert.equal(found.body.error, null);
    assert.ok(found.body.checkedAt);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]['user-agent'], 'Knowstead-update-check');
    assert.ok(!JSON.stringify(requests[0]).includes(current), 'die eigene Version geht nicht hinaus');
    assert.ok(!requests[0].cookie && !requests[0].authorization, 'keine Zugangsdaten');

    // Gemerkt: Die Seite zeigt den Stand ohne neuen Abruf, und der Abruf ist auf einen je Minute gedrosselt
    const remembered = await admin.get('/api/v1/admin/update-check');
    assert.equal(remembered.body.latest, higher);
    assert.equal((await admin.post('/api/v1/admin/update-check', {})).body.latest, higher);
    assert.equal(requests.length, 1, 'Drosselung und gemerkter Stand');

    // Gleiche Version: kein Hinweis
    again();
    reply = { status: 200, body: release(current) };
    const same = await admin.post('/api/v1/admin/update-check', {});
    assert.equal(same.body.latest, current);
    assert.equal(same.body.newer, false);
    assert.equal(requests.length, 2);

    // Fehler: Der letzte bekannte Stand bleibt, der Fehler kommt dazu
    again();
    reply = { status: 500, body: '{}' };
    const failed = await admin.post('/api/v1/admin/update-check', {});
    assert.deepEqual(failed.body.error, { code: 'http', detail: '500' });
    assert.equal(failed.body.latest, current, 'letzter Stand bleibt');
    again();
    reply = { status: 200, body: 'kein json' };
    assert.equal((await admin.post('/api/v1/admin/update-check', {})).body.error.code, 'format');
    again();
    reply = { status: 200, body: release(higher, { prerelease: true }) };
    assert.equal((await admin.post('/api/v1/admin/update-check', {})).body.error.code, 'format', 'Vorabversionen zählen nicht');
    again();
    reply = { status: 200, body: JSON.stringify({ tag_name: 'nightly' }) };
    assert.equal((await admin.post('/api/v1/admin/update-check', {})).body.error.code, 'format');

    // Verweis nur auf GitHub (er wird in der Oberfläche zum Link)
    for (const url of ['https://evil.example/x', 'javascript:alert(1)', 'http://github.com/x']) {
      again();
      reply = { status: 200, body: release(higher, { html_url: url }) };
      const odd = await admin.post('/api/v1/admin/update-check', {});
      assert.equal(odd.body.latest, higher);
      assert.equal(odd.body.url, null, url);
    }

    // Nicht erreichbar
    again();
    ctx.s.updates.endpoint = 'http://127.0.0.1:1/latest';
    const unreachable = await admin.post('/api/v1/admin/update-check', {});
    assert.equal(unreachable.body.error.code, 'unreachable');
    assert.equal(unreachable.body.latest, higher, 'letzter Stand bleibt');

    // Wieder aus: Abrufe werden abgelehnt, die Anzeige zeigt „aus“
    assert.equal((await admin.put('/api/v1/admin/settings', { updateCheck: false })).body.updateCheck, false);
    assert.equal((await admin.get('/api/v1/admin/update-check')).body.enabled, false);
    assert.equal((await admin.post('/api/v1/admin/update-check', {})).status, 400);
  } finally {
    await ctx.close();
    await new Promise<void>((resolve) => github.close(() => resolve()));
  }
});
