import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

test('Papierkorb für Aufgaben: löschen, wiederherstellen, endgültig entfernen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  let boardId = 0;
  const ids: Record<string, number> = {};
  const task = async (key: string, body: Record<string, unknown> = {}) => {
    const res = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: key, ...body });
    assert.equal(res.status, 200, res.raw);
    ids[key] = res.body.id;
    return res.body;
  };
  const board = async () => (await admin.get(`/api/v1/boards/${boardId}`)).body as { board: { counts: { total: number } }; tasks: { id: number; title: string }[] };
  const trash = async () => (await admin.get('/api/v1/spaces/TEAM/task-trash')).body.items as { id: number; title: string; boardName: string; dependencies: number; deletedAt: string }[];

  try {
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
    boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Umzug' })).body.id;

    await t.test('Gelöschte Aufgaben verschwinden aus Plan, Kennzahlen und Abhängigkeiten', async () => {
      await task('Konzept', { startDate: '2027-06-01', dueDate: '2027-06-05' });
      await task('Umsetzung', { startDate: '2027-06-06', dueDate: '2027-06-10', predecessors: [{ taskId: ids.Konzept }] });
      await task('Abnahme', { dueDate: '2027-06-20' });
      assert.equal((await board()).board.counts.total, 3);

      assert.equal((await admin.del(`/api/v1/tasks/${ids.Konzept}`)).status, 200);
      const after = await board();
      assert.equal(after.board.counts.total, 2, 'zählt nicht mehr mit');
      assert.deepEqual(after.tasks.map((x) => x.title).sort(), ['Abnahme', 'Umsetzung']);
      const umsetzung = after.tasks.find((x) => x.title === 'Umsetzung') as unknown as { predecessors: unknown[]; blocked: boolean };
      assert.deepEqual(umsetzung.predecessors, [], 'wartet nicht mehr auf eine gelöschte Aufgabe');
      assert.equal(umsetzung.blocked, false);
      assert.equal(((await admin.get('/api/v1/tasks?board=' + boardId)).body.items as unknown[]).length, 2, 'auch in „Meine Aufgaben“ weg');
      assert.equal((await admin.get(`/api/v1/tasks/${ids.Konzept}`)).status, 404, 'nicht mehr abrufbar');
    });

    await t.test('Im Papierkorb mit Plan, Zeitpunkt und Anzahl der Abhängigkeiten', async () => {
      const items = await trash();
      assert.equal(items.length, 1);
      assert.equal(items[0].title, 'Konzept');
      assert.equal(items[0].boardName, 'Umzug');
      assert.equal(items[0].dependencies, 1, 'Verknüpfung bleibt erhalten');
      assert.match(items[0].deletedAt, /^\d{4}-\d{2}-\d{2}/);
    });

    await t.test('Wiederherstellen bringt die Abhängigkeit zurück', async () => {
      const restored = await admin.post(`/api/v1/tasks/${ids.Konzept}/restore`, {});
      assert.equal(restored.status, 200, restored.raw);
      assert.equal(restored.body.title, 'Konzept');
      const after = await board();
      assert.equal(after.board.counts.total, 3);
      const umsetzung = after.tasks.find((x) => x.title === 'Umsetzung') as unknown as { predecessors: { taskId: number }[]; blocked: boolean };
      assert.deepEqual(umsetzung.predecessors.map((p) => p.taskId), [ids.Konzept]);
      assert.equal(umsetzung.blocked, true);
      assert.equal((await trash()).length, 0);
    });

    await t.test('Endgültig löschen nur aus dem Papierkorb und nur mit Bereichsverwaltung', async () => {
      assert.equal((await admin.del(`/api/v1/tasks/${ids.Abnahme}/purge`)).status, 400, 'nicht gelöschte Aufgaben nicht');
      await admin.del(`/api/v1/tasks/${ids.Abnahme}`);
      assert.equal((await admin.del(`/api/v1/tasks/${ids.Abnahme}/purge`)).status, 200);
      assert.equal((await trash()).length, 0);
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM tasks WHERE id = ?', ids.Abnahme), 0);
    });

    await t.test('Wartung entfernt abgelaufene Aufgaben', async () => {
      await admin.del(`/api/v1/tasks/${ids.Umsetzung}`);
      ctx.s.db.run("UPDATE tasks SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", ids.Umsetzung);
      const res = await admin.post('/api/v1/admin/maintenance/purge-trash', {});
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.tasks, 1);
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM tasks WHERE id = ?', ids.Umsetzung), 0);
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM task_dependencies'), 0, 'Verknüpfungen verschwinden mit');
    });

    await t.test('Ohne Schreibrecht kein Papierkorb', async () => {
      const guest = new Client(ctx.app);
      assert.equal((await guest.get('/api/v1/spaces/TEAM/task-trash')).status, 401);
    });
  } finally {
    await ctx.close();
  }
});
