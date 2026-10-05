import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

const DAY = 86400_000;

test('Wiedervorlage: Verantwortliche, Intervalle, Erinnerungen, Aufgaben', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  const guest = new Client(ctx.app);
  let tomId = 0;
  let pageId = 0;
  let boardId = 0;

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true })).status, 200);
      tomId = (await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' })).body.id;
      await admin.post('/api/v1/admin/users', { username: 'gast', displayName: 'Gast', password: 'geheim-geheim' });
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      assert.equal((await guest.post('/api/v1/auth/login', { login: 'gast', password: 'geheim-geheim' })).status, 200);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Notfallhandbuch', content: '<p>Stand 2026</p>' });
      pageId = page.body.id;
      assert.equal(page.body.reviewCycle.state, 'none', 'ohne Vorgabe keine Wiedervorlage');
    });

    await t.test('Vorgabe des Bereichs und eigenes Intervall', async () => {
      const space = await admin.put('/api/v1/spaces/TEAM/review-cycle', { intervalMonths: 12 });
      assert.equal(space.status, 200, space.raw);
      let page = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(page.body.reviewCycle.intervalMonths, 12);
      assert.equal(page.body.reviewCycle.pageIntervalMonths, null, 'geerbt');
      const expected = new Date(page.body.publishedAt);
      expected.setUTCMonth(expected.getUTCMonth() + 12);
      assert.equal(page.body.reviewCycle.dueAt.slice(0, 10), expected.toISOString().slice(0, 10));
      assert.equal(page.body.reviewCycle.state, 'ok');

      assert.equal((await tom.put('/api/v1/spaces/TEAM/review-cycle', { intervalMonths: 3 })).status, 403, 'nur Bereichsadministration');
      assert.equal((await admin.put('/api/v1/spaces/TEAM/review-cycle', { intervalMonths: 5 })).status, 400, 'nur erlaubte Intervalle');

      const configured = await admin.put(`/api/v1/pages/${pageId}/review-cycle`, { ownerId: tomId, intervalMonths: 6 });
      assert.equal(configured.status, 200, configured.raw);
      assert.equal(configured.body.owner.username, 'tom');
      assert.equal(configured.body.intervalMonths, 6);
      const notes = await tom.get('/api/v1/me/notifications');
      assert.ok(JSON.stringify(notes.body).includes('verantwortlich für „Notfallhandbuch“'));

      page = await tom.get(`/api/v1/pages/${pageId}`);
      assert.equal(page.body.reviewCycle.canVerify, true);
    });

    await t.test('Erinnerung vor und nach der Fälligkeit – je Fälligkeit nur einmal', async () => {
      const page = await admin.get(`/api/v1/pages/${pageId}`);
      const due = new Date(page.body.reviewCycle.dueAt).getTime();
      const before = ctx.s.reviewCycle.runReminders(new Date(due - 5 * DAY));
      assert.equal(before.upcoming, 1);
      assert.equal(ctx.s.reviewCycle.runReminders(new Date(due - 4 * DAY)).upcoming, 0, 'keine doppelte Erinnerung');
      const notes = await tom.get('/api/v1/me/notifications');
      assert.ok(JSON.stringify(notes.body).includes('Wiedervorlage bald fällig'));

      // Plan für Wiedervorlage-Aufgaben hinterlegen, dann überfällig
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Redaktion' });
      boardId = board.body.id;
      assert.equal((await admin.put('/api/v1/spaces/TEAM/review-cycle', { boardId })).status, 200);
      const after = ctx.s.reviewCycle.runReminders(new Date(due + DAY));
      assert.deepEqual([after.overdue, after.tasks], [1, 1]);
      const tasks = await tom.get(`/api/v1/tasks?board=${boardId}`);
      const task = tasks.body.items[0];
      assert.match(task.title, /Seite prüfen: Notfallhandbuch/);
      assert.equal(task.assignee.username, 'tom');
      assert.equal(task.page.id, pageId);
      assert.deepEqual(task.labels, ['wiedervorlage']);
    });

    await t.test('Bestätigen startet neu und erledigt die Aufgabe', async () => {
      // Bearbeiten nur für Ada und Tom – der Gast darf lesen, aber nicht bestätigen
      const me = await admin.get('/api/v1/auth/me');
      const restricted = await admin.put(`/api/v1/pages/${pageId}/restrictions`, { view: [], edit: [{ type: 'user', id: me.body.user.id }, { type: 'user', id: tomId }] });
      assert.equal(restricted.status, 200, restricted.raw);
      assert.equal((await guest.post(`/api/v1/pages/${pageId}/verify`, {})).status, 403, 'ohne Schreibrecht und nicht verantwortlich');
      const verified = await tom.post(`/api/v1/pages/${pageId}/verify`, { note: 'Rufnummern geprüft' });
      assert.equal(verified.status, 200, verified.raw);
      assert.equal(verified.body.verifiedBy.username, 'tom');
      assert.equal(verified.body.state, 'ok');
      const tasks = await tom.get(`/api/v1/tasks?board=${boardId}`);
      assert.equal(tasks.body.items[0].status, 'done', 'verknüpfte Aufgabe erledigt');
    });

    await t.test('Erledigte Aufgabe bestätigt die Seite', async () => {
      // Fälligkeit künstlich in die Vergangenheit legen
      ctx.s.db.run("UPDATE pages SET verified_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", pageId);
      ctx.s.reviewCycle.refresh(pageId);
      const res = ctx.s.reviewCycle.runReminders();
      assert.equal(res.tasks, 1);
      const open = (await tom.get(`/api/v1/tasks?board=${boardId}&status=open-all`)).body.items[0];
      const moved = await tom.post(`/api/v1/tasks/${open.id}/move`, { bucket: 'done', index: 0 });
      assert.equal(moved.body.status, 'done');
      await new Promise((resolve) => setTimeout(resolve, 30)); // Ereignisse laufen asynchron
      const page = await tom.get(`/api/v1/pages/${pageId}`);
      assert.equal(page.body.reviewCycle.state, 'ok', 'Seite wieder aktuell');
      assert.ok(page.body.reviewCycle.verifiedAt > '2026-01-01');
    });

    await t.test('Übersicht, Zähler und Freigabe', async () => {
      ctx.s.db.run("UPDATE pages SET verified_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", pageId);
      ctx.s.reviewCycle.refresh(pageId);
      const mine = await tom.get('/api/v1/content-reviews');
      assert.equal(mine.status, 200, mine.raw);
      assert.equal(mine.body.items.length, 1);
      assert.equal(mine.body.items[0].state, 'overdue');
      assert.equal(mine.body.counts.overdue, 1);
      assert.equal((await tom.get('/api/v1/auth/me')).body.dueReviews, 1);
      assert.equal((await guest.get('/api/v1/content-reviews')).body.items.length, 0, 'fremde Seiten nicht in „meine“');
      assert.ok((await admin.get('/api/v1/content-reviews?scope=all&state=all')).body.items.length >= 1);

      // Verantwortliche veröffentlicht eine wesentliche Änderung → gilt als geprüft
      const page = await tom.get(`/api/v1/pages/${pageId}?render=false`);
      await tom.put(`/api/v1/pages/${pageId}`, { content: '<p>Stand 2027</p>', baseVersion: page.body.version });
      assert.equal((await tom.get(`/api/v1/pages/${pageId}`)).body.reviewCycle.state, 'ok');

      // Kleine Änderung anderer zählt nicht
      ctx.s.db.run("UPDATE pages SET verified_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", pageId);
      ctx.s.reviewCycle.refresh(pageId);
      const current = await admin.get(`/api/v1/pages/${pageId}?render=false`);
      await admin.put(`/api/v1/pages/${pageId}`, { content: '<p>Stand 2027 (Tippfehler)</p>', baseVersion: current.body.version, minor: true });
      assert.equal((await admin.get(`/api/v1/pages/${pageId}`)).body.reviewCycle.state, 'overdue');
    });

    await t.test('Verantwortliche müssen die Seite sehen dürfen', async () => {
      const secret = await admin.post('/api/v1/spaces', { key: 'VERTR', name: 'Vertraulich', preset: 'private' });
      assert.equal(secret.status, 200, secret.raw);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'VERTR', title: 'Gehälter', content: '<p>x</p>' });
      const res = await admin.put(`/api/v1/pages/${page.body.id}/review-cycle`, { ownerId: tomId });
      assert.equal(res.status, 400, res.raw);
    });

    await t.test('null entfernt Verantwortliche, erbt die Vorgabe und löst den Plan', async () => {
      // Regression: AJV wandelte null in Unions mit coerceTypes in 0 um
      const set = await admin.put(`/api/v1/pages/${pageId}/review-cycle`, { ownerId: tomId, intervalMonths: 6 });
      assert.equal(set.status, 200, set.raw);
      const cleared = await admin.put(`/api/v1/pages/${pageId}/review-cycle`, { ownerId: null, intervalMonths: null });
      assert.equal(cleared.status, 200, cleared.raw);
      assert.equal(cleared.body.owner, null);
      assert.equal(cleared.body.pageIntervalMonths, null, 'Vorgabe des Bereichs statt „keine Wiedervorlage“');
      assert.equal(cleared.body.intervalMonths, 12);
      const none = await admin.put(`/api/v1/pages/${pageId}/review-cycle`, { intervalMonths: 0 });
      assert.equal(none.body.pageIntervalMonths, 0, '0 bleibt „keine Wiedervorlage“');
      assert.equal(none.body.state, 'none');
      const space = await admin.put('/api/v1/spaces/TEAM/review-cycle', { boardId: null });
      assert.equal(space.status, 200, space.raw);
      assert.equal(space.body.boardId, null);
    });
  } finally {
    await ctx.close();
  }
});
