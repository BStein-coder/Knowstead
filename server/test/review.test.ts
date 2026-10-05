import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Prüfung (Review), Wiederherstellung der letzten Änderungen,
 * Bereichskategorien und Verzeichnisanbindung.
 */
test('Prüfung, Wiederherstellung und Verzeichnis', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const autor = new Client(ctx.app);
  let spaceKey = 'REDAKTION';
  let pageId = 0;
  let autorId = 0;
  let reviewId = 0;

  try {
    await t.test('Einrichtung und Konten', async () => {
      const setup = await admin.post('/api/v1/setup', {
        siteName: 'Review-Test',
        username: 'admin',
        displayName: 'Ada Admin',
        password: 'geheim-geheim',
        sampleContent: false,
      });
      assert.equal(setup.status, 200, setup.raw);

      const user = await admin.post('/api/v1/admin/users', {
        username: 'tom',
        displayName: 'Tom Autor',
        password: 'geheim-geheim',
      });
      assert.equal(user.status, 200, user.raw);
      autorId = user.body.id;
      const login = await autor.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' });
      assert.equal(login.status, 200, login.raw);
    });

    await t.test('Bereich mit Kategorie und Prüfpflicht', async () => {
      const res = await admin.post('/api/v1/spaces', {
        key: spaceKey,
        name: 'Redaktion',
        category: 'Abteilungen',
        reviewRequired: true,
        preset: 'open',
      });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.category, 'Abteilungen');
      assert.equal(res.body.reviewRequired, true);
      spaceKey = res.body.key;

      const list = await autor.get('/api/v1/spaces');
      const found = list.body.find((s: { key: string }) => s.key === spaceKey);
      assert.equal(found.category, 'Abteilungen');
    });

    await t.test('Prüfpflicht erzeugt beim Speichern einen Auftrag', async () => {
      const created = await autor.post('/api/v1/pages', {
        spaceKey,
        title: 'Neue Richtlinie',
        content: '<p>Erster Entwurf</p>',
        changeNote: 'Angelegt',
      });
      assert.equal(created.status, 200, created.raw);
      pageId = created.body.id;
      assert.equal(created.body.review.status, 'pending', 'Seite steht in Prüfung');

      const inbox = await admin.get('/api/v1/reviews');
      assert.equal(inbox.body.items.length, 1);
      reviewId = inbox.body.items[0].id;
      assert.equal(inbox.body.items[0].pageId, pageId);
      assert.equal(inbox.body.items[0].canDecide, true);

      // Der Autor darf nicht selbst entscheiden.
      const denied = await autor.post(`/api/v1/reviews/${reviewId}/decision`, { approve: true });
      assert.equal(denied.status, 403, denied.raw);
    });

    await t.test('Freigeben setzt den Status', async () => {
      const res = await admin.post(`/api/v1/reviews/${reviewId}/decision`, { approve: true, note: 'Passt' });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.status, 'approved');

      const page = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(page.body.review.status, 'approved');
      assert.equal(page.body.review.approvedVersion, page.body.version);
      assert.equal(page.body.review.approvedBy.username, 'admin');

      const offen = await admin.get('/api/v1/reviews');
      assert.equal(offen.body.items.length, 0);
    });

    await t.test('Benannte prüfende Person entscheidet – nur nicht über die eigene Anforderung', async () => {
      const lena = new Client(ctx.app);
      const created = await admin.post('/api/v1/admin/users', { username: 'lena', displayName: 'Lena Lektorin', password: 'geheim-geheim' });
      assert.equal((await lena.post('/api/v1/auth/login', { login: 'lena', password: 'geheim-geheim' })).status, 200);
      const page = await admin.post('/api/v1/pages', { spaceKey, title: 'Freiwillig geprüft', content: '<p>x</p>' });

      // Tom (ohne Moderationsrecht) fordert an und benennt Lena
      const request = await autor.post(`/api/v1/pages/${page.body.id}/reviews`, { reviewerId: created.body.id, note: 'Bitte gegenlesen' });
      assert.equal(request.status, 200, request.raw);
      assert.equal(request.body.canDecide, false, 'Anfordernder entscheidet nicht selbst');
      const inbox = await lena.get('/api/v1/reviews?mine=true');
      const item = inbox.body.items.find((r: { pageId: number }) => r.pageId === page.body.id);
      assert.equal(item.canDecide, true, 'benannte Prüferin darf entscheiden');
      assert.equal((await lena.post(`/api/v1/reviews/${item.id}/decision`, { approve: true })).status, 200);

      // Selbst als Prüfer eintragen hilft nicht
      const own = await autor.post(`/api/v1/pages/${page.body.id}/reviews`, { reviewerId: autorId });
      assert.equal(own.status, 200, own.raw);
      assert.equal((await autor.post(`/api/v1/reviews/${own.body.id}/decision`, { approve: true })).status, 403);
      assert.equal((await admin.post(`/api/v1/reviews/${own.body.id}/decision`, { approve: false, note: 'Bitte andere Person benennen' })).status, 200);
    });

    await t.test('Neue Version fordert erneut Prüfung an', async () => {
      const save = await autor.put(`/api/v1/pages/${pageId}`, {
        content: '<p>Überarbeitet</p>',
        changeNote: 'Zweite Fassung',
        baseVersion: 1,
      });
      assert.equal(save.status, 200, save.raw);
      assert.equal(save.body.review.status, 'pending');

      const inbox = await admin.get('/api/v1/reviews');
      assert.equal(inbox.body.items.length, 1);
      const zurueck = await admin.post(`/api/v1/reviews/${inbox.body.items[0].id}/decision`, { approve: false, note: 'Bitte Quellen ergänzen' });
      assert.equal(zurueck.status, 200, zurueck.raw);

      const page = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(page.body.review.status, 'rejected');
      const verlauf = await admin.get(`/api/v1/pages/${pageId}/reviews`);
      assert.equal(verlauf.body.items.length, 2);
    });

    await t.test('Letzte Änderungen auflisten und zurücknehmen', async () => {
      const changes = await admin.get('/api/v1/changes?limit=50');
      assert.equal(changes.status, 200, changes.raw);
      const eintrag = changes.body.items.find((c: { pageId: number; version: number }) => c.pageId === pageId && c.version === 2);
      assert.ok(eintrag, 'Änderung ist gelistet');
      assert.equal(eintrag.previousVersion, 1);
      assert.equal(eintrag.canRestore, true);
      assert.equal(eintrag.spaceKey, spaceKey);

      const undo = await admin.post(`/api/v1/changes/${eintrag.id}/undo`, {});
      assert.equal(undo.status, 200, undo.raw);

      const page = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(page.body.version, 3, 'Rücknahme erzeugt eine neue Version');
      assert.match(page.body.content, /Erster Entwurf/);

      const versionen = await admin.get(`/api/v1/pages/${pageId}/revisions`);
      assert.equal(versionen.body.total, 3, 'nichts geht verloren');
    });

    await t.test('Fremde Bereiche bleiben unsichtbar', async () => {
      const privat = await admin.post('/api/v1/spaces', { key: 'GEHEIM', name: 'Geheim', preset: 'private' });
      assert.equal(privat.status, 200, privat.raw);
      const seite = await admin.post('/api/v1/pages', { spaceKey: 'GEHEIM', title: 'Intern', content: '<p>x</p>' });
      assert.equal(seite.status, 200, seite.raw);

      const changes = await autor.get('/api/v1/changes?limit=50');
      assert.ok(!changes.body.items.some((c: { spaceKey: string }) => c.spaceKey === 'GEHEIM'), 'keine fremden Änderungen');
    });

    await t.test('Gruppen mit AD-Zuordnung', async () => {
      const gruppe = await admin.post('/api/v1/admin/groups', {
        name: 'Redaktion',
        description: 'Aus dem Verzeichnis',
        permissions: ['spaces.create'],
        directoryGroups: ['CN=Knowstead-Redaktion,OU=Gruppen,DC=firma,DC=local', 'Knowstead-Redaktion'],
      });
      assert.equal(gruppe.status, 200, gruppe.raw);
      assert.equal(gruppe.body.directoryGroups.length, 2);
      assert.equal(gruppe.body.syncEnabled, true);

      // Abgleich anhand der Verzeichnisgruppen (ohne echten LDAP-Server).
      const result = ctx.s.directory.syncGroups(autorId, ['CN=Knowstead-Redaktion,OU=Gruppen,DC=firma,DC=local']);
      assert.deepEqual(result.added, ['Redaktion']);
      const members = await admin.get(`/api/v1/admin/groups/${gruppe.body.id}`);
      assert.ok(members.body.members.some((m: { username: string }) => m.username === 'tom'));

      const entfernt = ctx.s.directory.syncGroups(autorId, ['CN=Andere,DC=firma,DC=local']);
      assert.deepEqual(entfernt.removed, ['Redaktion']);
    });

    await t.test('Verzeichniseinstellungen werden geprüft und verschlüsselt', async () => {
      const ungueltig = await admin.put('/api/v1/admin/settings', { directory: { enabled: true, url: 'http://dc', baseDn: '' } });
      assert.equal(ungueltig.status, 400, ungueltig.raw);

      const schema = await admin.put('/api/v1/admin/settings', {
        directory: { enabled: false, url: 'ldaps://dc01.firma.local:636', baseDn: 'DC=firma,DC=local', bindPassword: 'super-geheim' },
      });
      assert.equal(schema.status, 200, schema.raw);
      assert.equal(schema.body.directory.bindPassword, '••••••••', 'Passwort wird nie zurückgegeben');
      const gespeichert = ctx.s.settings.get('directory').bindPassword;
      assert.ok(gespeichert.startsWith('v1:'), 'Passwort ist verschlüsselt abgelegt');
      assert.equal(ctx.s.directory.isEnabled(), false);
      assert.equal(ctx.s.directory.normalizeLogin('FIRMA\\anna'), 'anna');

      const filter = await admin.put('/api/v1/admin/settings', { directory: { userFilter: '(objectClass=user)' } });
      assert.equal(filter.status, 400, 'Filter ohne {login} wird abgelehnt');
    });

    await t.test('Persönliche Einstellungen sind begrenzt', async () => {
      const ok = await autor.patch('/api/v1/me/preferences', { onboarding: { done: ['profile'], tourDone: true } });
      assert.equal(ok.status, 200, ok.raw);
      assert.deepEqual(ok.body.onboarding.done, ['profile']);

      const gross = await autor.patch('/api/v1/me/preferences', { riesig: 'x'.repeat(40_000) });
      assert.equal(gross.status, 400, 'zu große Einstellungen werden abgelehnt');

      const proto = await autor.patch('/api/v1/me/preferences', { __proto__: { polluted: true } });
      assert.equal(proto.status, 200);
      assert.equal(({} as Record<string, unknown>).polluted, undefined, 'kein Prototyp-Leck');
    });
  } finally {
    await ctx.close();
  }
});
