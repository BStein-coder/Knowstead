import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

test('Bereichskategorien verwalten', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
    });

    await t.test('Anlegen, sortieren, zuordnen', async () => {
      const dept = await admin.post('/api/v1/admin/space-categories', { name: 'Abteilungen', icon: '🏢' });
      assert.equal(dept.status, 200, dept.raw);
      const projects = await admin.post('/api/v1/admin/space-categories', { name: 'Projekte' });
      assert.equal((await admin.post('/api/v1/admin/space-categories', { name: 'projekte' })).status, 409, 'doppelt (ohne Groß/Klein)');
      assert.equal((await tom.post('/api/v1/admin/space-categories', { name: 'Heimlich' })).status, 403);

      const ordered = await admin.put('/api/v1/admin/space-categories/order', { ids: [projects.body.id, dept.body.id] });
      assert.deepEqual(ordered.body.map((c: { name: string }) => c.name), ['Projekte', 'Abteilungen']);

      const it = await admin.post('/api/v1/spaces', { key: 'IT', name: 'IT-Abteilung', category: 'abteilungen', preset: 'open' });
      assert.equal(it.status, 200, it.raw);
      assert.equal(it.body.category, 'Abteilungen', 'Schreibweise der gepflegten Kategorie');

      const list = await tom.get('/api/v1/space-categories');
      assert.equal(list.body.find((c: { name: string }) => c.name === 'Abteilungen').spaceCount, 1);
    });

    await t.test('Nur Administratoren legen neue Kategorien an', async () => {
      // Tom darf Bereiche anlegen, aber keine neuen Kategorien erfinden
      const created = await tom.post('/api/v1/spaces', { key: 'TOM', name: 'Toms Team', category: 'Fantasie' });
      assert.equal(created.status, 400, created.raw);
      assert.match(created.body.error.message, /Administration/);
      const ok = await tom.post('/api/v1/spaces', { key: 'TOM', name: 'Toms Team', category: 'Projekte' });
      assert.equal(ok.status, 200, ok.raw);

      // Administratoren bekommen unbekannte Kategorien automatisch angelegt (z. B. per API)
      const auto = await admin.patch('/api/v1/spaces/TOM', { category: 'Archiv' });
      assert.equal(auto.body.category, 'Archiv');
      assert.ok((await admin.get('/api/v1/space-categories')).body.some((c: { name: string }) => c.name === 'Archiv'));
    });

    await t.test('Umbenennen und Entfernen wirken auf die Bereiche', async () => {
      const cats = (await admin.get('/api/v1/space-categories')).body as { id: number; name: string }[];
      const dept = cats.find((c) => c.name === 'Abteilungen')!;
      const renamed = await admin.patch(`/api/v1/admin/space-categories/${dept.id}`, { name: 'Fachbereiche' });
      assert.equal(renamed.status, 200, renamed.raw);
      assert.equal((await admin.get('/api/v1/spaces/IT')).body.category, 'Fachbereiche');

      const removed = await admin.del(`/api/v1/admin/space-categories/${dept.id}`);
      assert.equal(removed.body.spaces, 1);
      const space = await admin.get('/api/v1/spaces/IT');
      assert.equal(space.status, 200, 'Bereich bleibt erhalten');
      assert.equal(space.body.category, '');

      const clear = await admin.patch('/api/v1/spaces/TOM', { category: '' });
      assert.equal(clear.body.category, '');
    });
  } finally {
    await ctx.close();
  }
});
