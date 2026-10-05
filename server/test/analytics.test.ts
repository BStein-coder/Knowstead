import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';
import { extractRefs } from '../src/modules/analytics/service.ts';

test('Inhaltsanalyse: Arbeitsliste für die Redaktion', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app); // Bereichsverwaltung ANA
  const eva = new Client(ctx.app); // nur lesen
  const ids: Record<string, number> = {};

  const upload = async (pageId: number) => {
    const boundary = '----knowstead-ana';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="plan.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('Inhalt'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await admin.request('POST', `/api/v1/pages/${pageId}/attachments`, body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    assert.equal(res.status, 200, res.raw);
    return res.body[0].id as number;
  };

  try {
    await t.test('Verweise erkennen', () => {
      const refs = extractRefs(
        '<p><a href="/s/TEAM/p/12/start">x</a> <a data-page-id="13">y</a><img src="/api/v1/attachments/7/raw"></p><div data-type="file" data-attachment-id="8"></div><div data-type="include-page" data-page-id="14"></div>',
      );
      assert.deepEqual(refs.pages.sort(), [12, 13, 14]);
      assert.deepEqual(refs.attachments.sort(), [7, 8]);
    });

    await t.test('Einrichtung', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      for (const name of ['tom', 'eva']) {
        ids[name] = (await admin.post('/api/v1/admin/users', { username: name, displayName: name, password: 'geheim-geheim' })).body.id;
      }
      await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' });
      await eva.post('/api/v1/auth/login', { login: 'eva', password: 'geheim-geheim' });
      assert.equal((await admin.post('/api/v1/spaces', { key: 'ANA', name: 'Analyse', preset: 'readonly' })).status, 200);
      const grants = (await admin.get('/api/v1/spaces/ANA/permissions')).body;
      await admin.put('/api/v1/spaces/ANA/permissions', { grants: [...grants, { subjectType: 'user', subjectId: ids.tom, role: 'admin' }] });

      const page = async (key: string, content: string, parentId?: number) => {
        const res = await admin.post('/api/v1/pages', { spaceKey: 'ANA', title: key, content, parentId });
        assert.equal(res.status, 200, res.raw);
        ids[key] = res.body.id;
      };
      await page('Ziel', '<p>Ziel</p>');
      await page('Start', `<p><a href="/s/ANA/p/${ids.Ziel}/ziel">Ziel</a></p>`);
      await page('Einsam', '<p>Niemand verweist hierher</p>');
      await page('Weg', '<p>wird gelöscht</p>');
      ids.anhang = await upload(ids.Einsam);
      await page('Kaputt', `<p><a href="/s/ANA/p/${ids.Weg}/weg">weg</a> <a href="/s/ANA/p/999999/nie">nie</a> <a href="/api/v1/attachments/${ids.anhang}/raw">Datei</a></p>`);
      assert.equal((await admin.del(`/api/v1/pages/${ids.Weg}`)).status, 200);
      assert.equal((await admin.del(`/api/v1/attachments/${ids.anhang}`)).status, 200);
    });

    await t.test('Meistgelesen mit Aufrufen und Leserzahl', async () => {
      for (let i = 0; i < 3; i++) await eva.get(`/api/v1/pages/${ids.Ziel}?view=true`);
      await tom.get(`/api/v1/pages/${ids.Ziel}?view=true`);
      await eva.get(`/api/v1/pages/${ids.Start}?view=true`);
      const report = await admin.get('/api/v1/analytics?space=ANA&days=30');
      assert.equal(report.status, 200, report.raw);
      assert.deepEqual(
        report.body.topPages.map((x: any) => [x.page.title, x.views, x.readers]),
        [
          ['Ziel', 4, 2],
          ['Start', 1, 1],
        ],
      );
      assert.equal(report.body.summary.views, 5);
    });

    await t.test('Ungelesen: nur ältere Seiten, Lesen durch Autorinnen zählt nicht', async () => {
      ctx.s.db.run("UPDATE pages SET created_at = '2020-01-01T00:00:00.000Z' WHERE space_id = (SELECT id FROM spaces WHERE key = 'ANA')");
      await admin.get(`/api/v1/pages/${ids.Einsam}?view=true`); // Autor
      const report = (await admin.get('/api/v1/analytics?space=ANA&days=30')).body;
      const unread = report.unreadPages.map((x: any) => x.page.title);
      assert.ok(unread.includes('Einsam'), 'nur vom Autor gelesen');
      assert.ok(!unread.includes('Ziel'), 'von anderen gelesen');
    });

    await t.test('Verwaiste Seiten und defekte Verweise', async () => {
      const report = (await tom.get('/api/v1/analytics?space=ANA')).body;
      const orphans = report.orphans.map((x: any) => x.page.title);
      assert.ok(orphans.includes('Einsam'));
      assert.ok(!orphans.includes('Ziel'), 'Ziel hat einen Verweis');
      assert.deepEqual(
        report.brokenLinks.map((x: any) => [x.kind, x.reason, x.targetLabel]).sort(),
        [
          ['attachment', 'deleted', 'plan.txt'],
          ['page', 'deleted', 'Weg'],
          ['page', 'missing', null],
        ],
      );

      // Als erledigt markieren blendet aus, wieder aufnehmen zeigt erneut
      const item = report.brokenLinks.find((x: any) => x.reason === 'missing').item;
      assert.equal((await tom.put('/api/v1/analytics/dismissed', { kind: 'link', item, dismissed: true })).status, 200);
      assert.equal((await tom.put('/api/v1/analytics/dismissed', { kind: 'orphan', item: String(ids.Einsam), dismissed: true })).status, 200);
      const after = (await tom.get('/api/v1/analytics?space=ANA')).body;
      assert.equal(after.brokenLinks.length, 2);
      assert.ok(!after.orphans.some((x: any) => x.page.id === ids.Einsam));
      await tom.put('/api/v1/analytics/dismissed', { kind: 'link', item, dismissed: false });
      assert.equal((await tom.get('/api/v1/analytics?space=ANA')).body.brokenLinks.length, 3);

      // Reparierter Verweis verschwindet
      const page = (await admin.get(`/api/v1/pages/${ids.Kaputt}`)).body;
      await admin.put(`/api/v1/pages/${ids.Kaputt}`, { title: 'Kaputt', content: `<p><a href="/s/ANA/p/${ids.Ziel}/ziel">jetzt richtig</a></p>`, baseVersion: page.version });
      assert.equal((await tom.get('/api/v1/analytics?space=ANA')).body.brokenLinks.length, 0);
    });

    await t.test('Suchbegriffe ohne Treffer nur mit dem Recht „Inhaltsanalyse einsehen“', async () => {
      await eva.get('/api/v1/search?q=Urlaubsantrag');
      await eva.get('/api/v1/search?q=urlaubsantrag');
      await eva.get('/api/v1/search?q=Urlaubsantrag&offset=20'); // Blättern zählt nicht
      await eva.get('/api/v1/search?q=Ziel');
      await eva.get('/api/v1/search?q==HYPERLINK("x")');
      const report = (await admin.get('/api/v1/analytics?days=30')).body;
      assert.equal(report.canSeeSearches, true);
      const urlaub = report.failedSearches.find((x: any) => x.query === 'urlaubsantrag');
      assert.equal(urlaub?.searches, 2);
      assert.ok(!report.failedSearches.some((x: any) => x.query === 'ziel'), 'Begriff mit Treffern');
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM search_queries WHERE query LIKE ?', '%eva%'), 0, 'keine Person gespeichert');

      const csv = await admin.get('/api/v1/analytics/export/searches?days=30');
      assert.match(csv.raw, /^\ufeffSuchbegriff;Suchen;Zuletzt/);
      assert.match(csv.raw, /\n"'=hyperlink/, 'Formel-Injektion entschärft');

      const moderator = (await tom.get('/api/v1/analytics?space=ANA')).body;
      assert.equal(moderator.canSeeSearches, false);
      assert.deepEqual(moderator.failedSearches, []);
      assert.equal((await tom.put('/api/v1/analytics/dismissed', { kind: 'search', item: 'urlaubsantrag', dismissed: true })).status, 403);
    });

    await t.test('Rechte: Leserinnen sehen keine Auswertung, fremde Bereiche sind gesperrt', async () => {
      assert.equal((await eva.get('/api/v1/analytics')).status, 403);
      assert.equal((await eva.get('/api/v1/analytics?space=ANA')).status, 403);
      assert.equal((await eva.put('/api/v1/analytics/dismissed', { kind: 'orphan', item: String(ids.Start), dismissed: true })).status, 403);
      assert.deepEqual((await tom.get('/api/v1/analytics/spaces')).body.items.map((x: any) => x.key), ['ANA']);
      assert.equal((await tom.get('/api/v1/analytics?space=HANDBUCH')).status, 403);
    });

    await t.test('Update: Verweise bestehender Seiten werden einmalig nachgetragen; alte Daten verfallen', async () => {
      ctx.s.db.run('DELETE FROM page_refs');
      ctx.s.settings.setInternal('analytics:refsVersion', 0);
      assert.ok(ctx.s.analytics.refreshDerived() >= 4);
      assert.ok((ctx.s.db.value<number>('SELECT COUNT(*) FROM page_refs') ?? 0) >= 1);
      assert.equal(ctx.s.analytics.refreshDerived(), 0, 'nur einmal');

      ctx.s.db.run("INSERT INTO search_queries (day, query, searches, results) VALUES ('2020-01-01', 'uralt', 1, 0)");
      assert.equal(ctx.s.analytics.prune().searches, 1);
    });
  } finally {
    await ctx.close();
  }
});
