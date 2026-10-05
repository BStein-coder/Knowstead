import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Mehrstufige Freigaben mit Vertretung', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const c: Record<string, Client> = {};
  const ids: Record<string, number> = {};
  const groups: Record<string, number> = {};
  let pageId = 0;
  let reviewId = 0;

  const notes = async (name: string) => JSON.stringify((await c[name].get('/api/v1/me/notifications')).body);
  const review = async (name = 'autor') => (await c[name].get(`/api/v1/pages/${pageId}/reviews`)).body.items[0];
  const decide = (name: string, approve = true, note = '') => c[name].post(`/api/v1/reviews/${reviewId}/decision`, { approve, note });

  try {
    await t.test('Einrichtung', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      c.admin = admin;
      for (const name of ['autor', 'fach1', 'fach2', 'qm', 'vertretung', 'leser']) {
        ids[name] = (await admin.post('/api/v1/admin/users', { username: name, displayName: name.toUpperCase(), password: 'geheim-geheim' })).body.id;
        c[name] = new Client(ctx.app);
        await c[name].post('/api/v1/auth/login', { login: name, password: 'geheim-geheim' });
      }
      groups.fach = (await admin.post('/api/v1/admin/groups', { name: 'Fachbereich', permissions: [] })).body.id;
      groups.leer = (await admin.post('/api/v1/admin/groups', { name: 'Veröffentlichung', permissions: [] })).body.id;
      await admin.put(`/api/v1/admin/groups/${groups.fach}/members`, { userIds: [ids.fach1, ids.fach2] });
      await admin.post('/api/v1/spaces', { key: 'QM', name: 'Qualitätshandbuch', preset: 'open' });
      pageId = (await c.autor.post('/api/v1/pages', { spaceKey: 'QM', title: 'Verfahrensanweisung', content: '<p>Version 1</p>' })).body.id;
      assert.ok(pageId);
    });

    await t.test('Ablauf festlegen: nur Bereichsverwaltung, Stufen werden geprüft', async () => {
      const stages = [
        { name: 'Fachbereich', approvers: [{ type: 'group', id: groups.fach }], minApprovals: 2, escalateDays: 3 },
        { name: 'Qualitätsmanagement', approvers: [{ type: 'user', id: ids.qm }, { type: 'group', id: groups.fach }] },
        { name: 'Veröffentlichung', approvers: [{ type: 'group', id: groups.leer }] },
      ];
      assert.equal((await c.autor.put('/api/v1/spaces/QM/approval-workflow', { enabled: true, stages })).status, 403);
      assert.equal((await admin.put('/api/v1/spaces/QM/approval-workflow', { enabled: true, stages: [{ name: 'Leer', approvers: [] }] })).status, 400);
      const res = await admin.put('/api/v1/spaces/QM/approval-workflow', { enabled: true, stages, distinctApprovers: true });
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(res.body.stages.map((s: any) => s.name), ['Fachbereich', 'Qualitätsmanagement', 'Veröffentlichung']);
      assert.equal(res.body.stages[0].approvers[0].label, 'Fachbereich');
    });

    await t.test('Vertretung eintragen und prüfen', async () => {
      assert.equal((await c.qm.post('/api/v1/me/deputies', { deputyId: ids.qm, startsOn: day(0), endsOn: day(5) })).status, 400, 'nicht sich selbst');
      assert.equal((await c.qm.post('/api/v1/me/deputies', { deputyId: ids.vertretung, startsOn: day(-10), endsOn: day(-5) })).status, 400, 'Vergangenheit');
      const res = await c.qm.post('/api/v1/me/deputies', { deputyId: ids.vertretung, startsOn: day(0), endsOn: day(7), note: 'Urlaub' });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.active, true);
      assert.match(await notes('vertretung'), /Vertretung für QM/);
      assert.equal((await c.vertretung.get('/api/v1/me/deputies')).body.actingFor.length, 1);
      assert.equal((await c.leser.del(`/api/v1/me/deputies/${res.body.id}`)).status, 403, 'fremde Vertretung');
    });

    await t.test('Stufe 1: zwei Freigaben aus dem Fachbereich, Vier-Augen-Prinzip', async () => {
      const requested = await c.autor.post(`/api/v1/pages/${pageId}/reviews`, { note: 'Bitte freigeben' });
      assert.equal(requested.status, 200, requested.raw);
      reviewId = requested.body.id;
      assert.equal(requested.body.workflow.currentStage, 0);
      assert.equal(requested.body.workflow.stages[0].state, 'current');
      assert.match(await notes('fach1'), /Freigabe erbeten \(Stufe 1 von 3 „Fachbereich“\)/);
      assert.doesNotMatch(await notes('qm'), /Verfahrensanweisung/, 'QM erst in Stufe 2');
      assert.equal((await c.fach1.get('/api/v1/auth/me')).body.openReviews, 1);
      assert.equal((await c.qm.get('/api/v1/auth/me')).body.openReviews, 0);

      assert.equal((await decide('autor')).status, 403, 'eigene Anforderung');
      assert.equal((await decide('qm')).status, 403, 'nicht in Stufe 1');
      const first = await decide('fach1', true, 'fachlich ok');
      assert.equal(first.status, 200, first.raw);
      assert.equal(first.body.status, 'open');
      assert.equal(first.body.workflow.currentStage, 0, 'zweite Freigabe fehlt');
      assert.equal((await decide('fach1')).status, 403, 'nicht zweimal');
      const second = await decide('fach2');
      assert.equal(second.body.workflow.currentStage, 1);
      assert.match(await notes('autor'), /Stufe 1 von 3 „Fachbereich“ freigegeben/);
    });

    await t.test('Stufe 2: andere Person als in Stufe 1, Vertretung entscheidet für QM', async () => {
      assert.equal((await decide('fach1')).status, 403, 'hat Stufe 1 freigegeben');
      assert.match(await notes('vertretung'), /In Vertretung für QM/);
      const r = await review('vertretung');
      assert.equal(r.canDecide, true);
      assert.equal(r.workflow.onBehalfOf.username, 'qm');
      const res = await decide('vertretung', true, 'für QM geprüft');
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.workflow.currentStage, 2);
      const decision = res.body.workflow.stages[1].decisions[0];
      assert.equal(decision.user.username, 'vertretung');
      assert.equal(decision.onBehalfOf.username, 'qm');
      assert.equal((await decide('qm')).status, 403, 'QM wurde bereits vertreten');
    });

    await t.test('Stufe 3 ohne erreichbare Personen: Bereichsverwaltung entscheidet', async () => {
      assert.equal((await decide('leser')).status, 403);
      const res = await decide('admin');
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.status, 'approved');
      assert.ok(res.body.workflow.stages.every((s: any) => s.state === 'done'));
      const page = (await c.leser.get(`/api/v1/pages/${pageId}`)).body;
      assert.equal(page.review.status, 'approved');
      assert.equal(page.review.approvedVersion, 1);
    });

    await t.test('Neue Version beginnt wieder bei Stufe 1, Zurückweisung beendet den Auftrag', async () => {
      reviewId = (await c.autor.post(`/api/v1/pages/${pageId}/reviews`, {})).body.id;
      await decide('fach1');
      const page = (await c.autor.get(`/api/v1/pages/${pageId}`)).body;
      await c.autor.put(`/api/v1/pages/${pageId}`, { title: page.title, content: '<p>Version 2</p>', baseVersion: page.version });
      const restarted = await review();
      assert.equal(restarted.workflow.currentStage, 0);
      assert.equal(restarted.workflow.stages[0].decisions.length, 0, 'Freigaben der alten Version zählen nicht');
      assert.equal((await decide('fach1')).status, 200, 'darf für die neue Version erneut entscheiden');
      const rejected = await decide('fach2', false, 'Abschnitt 3 fehlt');
      assert.equal(rejected.body.status, 'rejected');
      assert.match(await notes('autor'), /Zurückgewiesen: Verfahrensanweisung/);
      assert.equal((await c.autor.get(`/api/v1/pages/${pageId}`)).body.review.status, 'rejected');
    });

    await t.test('Eskalation nach Ablauf der Frist – einmal je Stufe', async () => {
      reviewId = (await c.autor.post(`/api/v1/pages/${pageId}/reviews`, {})).body.id;
      const later = new Date(Date.now() + 4 * 86400_000);
      assert.equal(ctx.s.approvals.runEscalations(later), 1);
      assert.equal(ctx.s.approvals.runEscalations(later), 0);
      assert.match(await notes('admin'), /Freigabe überfällig \(Stufe 1 von 3/);
    });

    await t.test('Verwaltung setzt Vertretungen für andere; ohne Ablauf bleibt die einfache Prüfung', async () => {
      assert.equal((await c.leser.post(`/api/v1/admin/users/${ids.fach1}/deputies`, { deputyId: ids.leser, startsOn: day(0), endsOn: day(1) })).status, 403);
      const res = await admin.post(`/api/v1/admin/users/${ids.fach1}/deputies`, { deputyId: ids.leser, startsOn: day(1), endsOn: day(3) });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.active, false, 'beginnt morgen');

      await admin.put('/api/v1/spaces/QM/approval-workflow', { enabled: false, stages: [] });
      await c.autor.del(`/api/v1/reviews/${reviewId}`);
      const simple = await c.autor.post(`/api/v1/pages/${pageId}/reviews`, { reviewerId: ids.qm });
      assert.equal(simple.body.workflow, null);
      assert.equal(simple.body.reviewer.username, 'qm');
    });
  } finally {
    await ctx.close();
  }
});
