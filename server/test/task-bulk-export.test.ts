import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

test('Sammeländerung und CSV-Export des Plans', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const lena = new Client(ctx.app);
  let boardId = 0;
  let lenaId = 0;
  const ids: number[] = [];
  const tasksOf = async (client: Client = admin) => (await client.get(`/api/v1/boards/${boardId}`)).body.tasks as Record<string, any>[];

  try {
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
    boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Rollout Nord' })).body.id;
    lenaId = (await admin.post('/api/v1/admin/users', { username: 'lena', displayName: 'Lena Lang', password: 'geheim-geheim' })).body.id;
    for (const title of ['Kabel ziehen', 'Switche setzen', 'Abnahme']) {
      ids.push((await admin.post(`/api/v1/boards/${boardId}/tasks`, { title })).body.id);
    }

    await t.test('Verantwortliche, Spalte und Priorität für mehrere Karten', async () => {
      const buckets = (await admin.get(`/api/v1/boards/${boardId}`)).body.board.buckets as { id: string }[];
      const res = await admin.post('/api/v1/tasks/bulk', { ids: ids.slice(0, 2), patch: { assigneeId: lenaId, bucket: buckets[1].id, priority: 'high' } });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.changed, 2);
      const tasks = await tasksOf();
      for (const id of ids.slice(0, 2)) {
        const task = tasks.find((x) => x.id === id);
        assert.equal(task?.assignee?.id, lenaId);
        assert.equal(task?.bucket, buckets[1].id);
        assert.equal(task?.priority, 'high');
      }
      assert.equal(tasks.find((x) => x.id === ids[2])?.assignee, null, 'nicht ausgewählte bleiben unberührt');
    });

    await t.test('Alles oder nichts', async () => {
      const before = await tasksOf();
      const res = await admin.post('/api/v1/tasks/bulk', { ids: [ids[0], 999_999], patch: { priority: 'urgent' } });
      assert.equal(res.status, 404, res.raw);
      const after = await tasksOf();
      assert.equal(after.find((x) => x.id === ids[0])?.priority, before.find((x) => x.id === ids[0])?.priority, 'keine halbe Änderung');
    });

    await t.test('Ohne Schreibrecht keine Sammeländerung', async () => {
      assert.equal((await lena.post('/api/v1/auth/login', { login: 'lena', password: 'geheim-geheim' })).status, 200);
      const privat = (await admin.post('/api/v1/spaces', { key: 'CHEF', name: 'Chefsache', preset: 'private' })).body;
      assert.equal(privat.key, 'CHEF');
      const chefBoard = (await admin.post('/api/v1/spaces/CHEF/boards', { name: 'Intern' })).body.id;
      const chefTask = (await admin.post(`/api/v1/boards/${chefBoard}/tasks`, { title: 'Vertraulich' })).body.id;
      const res = await lena.post('/api/v1/tasks/bulk', { ids: [chefTask], patch: { priority: 'low' } });
      assert.ok(res.status === 403 || res.status === 404, `erwartet 403/404, war ${res.status}`);
    });

    await t.test('Mehrere Aufgaben in den Papierkorb', async () => {
      const res = await admin.post('/api/v1/tasks/bulk', { ids: ids.slice(0, 2), delete: true });
      assert.equal(res.status, 200, res.raw);
      assert.equal((await tasksOf()).length, 1);
      assert.equal(((await admin.get('/api/v1/spaces/TEAM/task-trash')).body.items as unknown[]).length, 2);
    });

    await t.test('Grenzen: leere Auswahl, zu viele, ohne Änderung', async () => {
      assert.equal((await admin.post('/api/v1/tasks/bulk', { ids: [] })).status, 400);
      assert.equal((await admin.post('/api/v1/tasks/bulk', { ids: Array.from({ length: 101 }, (_, i) => i + 1), patch: { priority: 'low' } })).status, 400);
      assert.equal((await admin.post('/api/v1/tasks/bulk', { ids: [ids[2]] })).status, 400, 'ohne Änderung nichts tun');
    });

    await t.test('CSV-Export mit Spalten, Trennzeichen und Schutz vor Formeln', async () => {
      await admin.patch(`/api/v1/tasks/${ids[2]}`, {
        dueDate: '2027-09-09',
        startDate: '2027-09-01',
        assigneeId: lenaId,
        labels: ['technik'],
        notes: '=WENN(A1;1;2)',
        checklist: [{ text: 'Protokoll', done: true }, { text: 'Übergabe' }],
      });
      const res = await admin.get(`/api/v1/boards/${boardId}/export.csv`);
      assert.equal(res.status, 200, res.raw);
      assert.match(String(res.headers['content-type']), /text\/csv/);
      assert.match(String(res.headers['content-disposition']), /filename="Rollout-Nord-\d{4}-\d{2}-\d{2}\.csv"/);
      const lines = res.raw.replace(/^\uFEFF/, '').trim().split('\r\n');
      assert.equal(lines[0], 'Titel;Spalte;Status;Fortschritt %;Verantwortlich;Beginn;Fällig;Überfällig;Priorität;Stichwörter;Checkliste;Wartet auf;Beschreibung;Nachrichten');
      const row = lines[1].split(';');
      assert.equal(row[0], 'Abnahme');
      assert.equal(row[4], 'Lena Lang');
      assert.equal(row[5], '2027-09-01');
      assert.equal(row[6], '2027-09-09');
      assert.equal(row[9], 'technik');
      assert.equal(row[10], '1/2');
      assert.match(lines[1], /'=WENN/, 'Formeln werden entschärft');
    });

    await t.test('Export nur mit Leserecht auf den Bereich', async () => {
      const guest = new Client(ctx.app);
      assert.equal((await guest.get(`/api/v1/boards/${boardId}/export.csv`)).status, 401);
    });
  } finally {
    await ctx.close();
  }
});
