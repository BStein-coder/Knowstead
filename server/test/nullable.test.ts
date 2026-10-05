import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Regression: Mit `coerceTypes` wandelte AJV `null` in Unions (`Integer | Null`) in `0` bzw. `""` um.
 * Ausdrücklich geleerte Felder müssen als `null` beim Dienst ankommen.
 */
test('null in Anfragen bleibt null', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  try {
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });

    await t.test('Webhook: Bereichsfilter entfernen', async () => {
      const spaces = (await admin.get('/api/v1/spaces')).body;
      const spaceId = (spaces.items ?? spaces)[0].id as number;
      const created = await admin.post('/api/v1/admin/webhooks', { name: 'Hook', url: 'https://example.com/hook', events: ['page.*'], spaceId });
      assert.equal(created.status, 200, created.raw);
      const cleared = await admin.patch(`/api/v1/admin/webhooks/${created.body.webhook.id}`, { spaceId: null });
      assert.equal(cleared.status, 200, cleared.raw);
      assert.equal(cleared.body.spaceId, null);
      // Wieder entfernen – sonst liefen Zustellungen an example.com über das Testende hinaus
      assert.equal((await admin.del(`/api/v1/admin/webhooks/${created.body.webhook.id}`)).status, 200);
    });

    await t.test('Prüfung erneut anfordern ohne prüfende Person', async () => {
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Probe', content: '<p>x</p>' });
      assert.equal((await admin.post(`/api/v1/pages/${page.body.id}/reviews`, { reviewerId: null, note: 'Bitte prüfen' })).status, 200);
      const again = await admin.post(`/api/v1/pages/${page.body.id}/reviews`, { reviewerId: null, note: 'Nochmal' });
      assert.equal(again.status, 200, again.raw);
    });

    await t.test('Startseite eines Bereichs zurücksetzen', async () => {
      const res = await admin.patch('/api/v1/spaces/TEAM', { homePageId: null });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.homePageId, null);
    });

    await t.test('Aufgabe: Verantwortliche und Fälligkeit leeren', async () => {
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Plan' });
      assert.equal(board.status, 200, board.raw);
      const boardId = (board.body.board ?? board.body).id as number;
      const me = (await admin.get('/api/v1/auth/me')).body;
      const userId = (me.user ?? me).id as number;
      const task = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Aufgabe', assigneeId: userId, dueDate: '2026-10-01' });
      assert.equal(task.status, 200, task.raw);
      const cleared = await admin.patch(`/api/v1/tasks/${task.body.id}`, { assigneeId: null, dueDate: null });
      assert.equal(cleared.status, 200, cleared.raw);
      assert.equal(cleared.body.assignee, null);
      assert.equal(cleared.body.dueDate, null);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 50)); // Ereignisse (Benachrichtigungen) laufen asynchron
    await ctx.close();
  }
});
