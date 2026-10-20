import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

interface Project {
  id: number;
  name: string;
  spaceKey: string;
  spaceIcon: string | null;
  counts: { total: number; done: number; overdue: number };
  summary: {
    doing: number;
    nextTask: { id: number; title: string; dueDate: string } | null;
    startDate: string | null;
    dueDate: string | null;
    assignees: { id: number; displayName: string }[];
    assigneeCount: number;
    updatedAt: string | null;
  };
}

test('Projekte: Kennzahlen, nächster Termin, Beteiligte und Sichtbarkeit', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  const ids: Record<string, number> = {};
  let boardId = 0;
  const task = async (title: string, body: Record<string, unknown> = {}) => {
    const res = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title, ...body });
    assert.equal(res.status, 200, res.raw);
    ids[title] = res.body.id;
    return res.body;
  };
  const projects = async (client: Client = admin) => {
    const res = await client.get('/api/v1/projects');
    assert.equal(res.status, 200, res.raw);
    return res.body.items as Project[];
  };

  try {
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const created = await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim', email: 'tom@example.com' });
    ids.tom = created.body.id;
    assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
    ids.admin = (await admin.get('/api/v1/auth/me')).body.user.id;
    assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open', icon: '🚀' })).status, 200);
    assert.equal((await admin.post('/api/v1/spaces', { key: 'GEHEIM', name: 'Geheim', preset: 'private' })).status, 200);
    boardId = (await admin.post('/api/v1/spaces/OFFEN/boards', { name: 'Intranet', description: 'Vom Konzept zum Start' })).body.id;

    await t.test('Ein leerer Plan ist ein Projekt in Planung', async () => {
      const [project] = await projects();
      assert.equal(project.name, 'Intranet');
      assert.equal(project.spaceKey, 'OFFEN');
      assert.equal(project.spaceIcon, '🚀');
      assert.deepEqual(project.counts, { total: 0, done: 0, overdue: 0 });
      assert.deepEqual(project.summary, { doing: 0, nextTask: null, startDate: null, dueDate: null, assignees: [], assigneeCount: 0, updatedAt: null });
    });

    await t.test('Kennzahlen: erledigt, in Arbeit, überfällig, nächster Termin, Beginn und Ende', async () => {
      await task('Konzept', { startDate: '2020-01-01', dueDate: '2020-01-10', status: 'done', assigneeId: ids.admin });
      await task('Alt', { startDate: '2020-02-01', dueDate: '2020-02-10', assigneeId: ids.admin });
      await task('Umsetzung', { startDate: '2099-03-01', dueDate: '2099-03-20', status: 'doing', assigneeId: ids.tom });
      await task('Abnahme', { dueDate: '2099-05-01', assigneeId: ids.admin });
      await task('Ohne Termin');
      const [project] = await projects();
      assert.deepEqual(project.counts, { total: 5, done: 1, overdue: 1 });
      assert.equal(project.summary.doing, 1);
      assert.deepEqual(project.summary.nextTask, { id: ids.Alt, title: 'Alt', dueDate: '2020-02-10' }, 'der früheste offene Termin – auch wenn er schon verstrichen ist');
      assert.equal(project.summary.startDate, '2020-01-01');
      assert.equal(project.summary.dueDate, '2099-05-01');
      assert.match(project.summary.updatedAt ?? '', /^\d{4}-\d{2}-\d{2}/);
    });

    await t.test('Beteiligte: wer die meisten Aufgaben hat, zuerst; insgesamt gezählt', async () => {
      const [project] = await projects();
      assert.deepEqual(project.summary.assignees.map((u) => u.displayName), ['Ada', 'Tom']);
      assert.equal(project.summary.assigneeCount, 2);
    });

    await t.test('Gelöschte Aufgaben zählen nicht mit', async () => {
      assert.equal((await admin.del(`/api/v1/tasks/${ids.Alt}`)).status, 200);
      const [project] = await projects();
      assert.equal(project.counts.total, 4);
      assert.equal(project.counts.overdue, 0);
      assert.equal(project.summary.nextTask?.title, 'Umsetzung');
    });

    await t.test('Pläne in Bereichen ohne Zugriff bleiben verborgen; ohne Anmeldung gibt es nichts', async () => {
      const secret = (await admin.post('/api/v1/spaces/GEHEIM/boards', { name: 'Vertraulich' })).body.id as number;
      assert.ok(secret);
      assert.deepEqual((await projects(admin)).map((p) => p.name).sort(), ['Intranet', 'Vertraulich']);
      assert.deepEqual((await projects(tom)).map((p) => p.name), ['Intranet'], 'Tom sieht den privaten Bereich nicht');
      assert.equal((await new Client(ctx.app).get('/api/v1/projects')).status, 401);
    });
  } finally {
    await ctx.close();
  }
});

test('Aufgaben im Zeitraum: dueFrom und dueBefore begrenzen nach unten und oben', async () => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  try {
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    assert.equal((await admin.post('/api/v1/spaces', { key: 'KAL', name: 'Kalender', preset: 'open' })).status, 200);
    const boardId = (await admin.post('/api/v1/spaces/KAL/boards', { name: 'Termine' })).body.id as number;
    for (const [title, dueDate] of [['Früh', '2099-01-05'], ['Mitte', '2099-01-15'], ['Spät', '2099-01-25'], ['Ohne', null]] as const) {
      assert.equal((await admin.post(`/api/v1/boards/${boardId}/tasks`, { title, dueDate })).status, 200);
    }
    const titles = async (query: string) => ((await admin.get(`/api/v1/tasks?board=${boardId}&${query}`)).body.items as { title: string }[]).map((x) => x.title);
    assert.deepEqual(await titles(''), ['Früh', 'Mitte', 'Spät', 'Ohne']);
    assert.deepEqual(await titles('dueFrom=2099-01-10'), ['Mitte', 'Spät'], 'ab dem Tag, einschließlich');
    assert.deepEqual(await titles('dueBefore=2099-01-15'), ['Früh', 'Mitte'], 'bis zum Tag, einschließlich');
    assert.deepEqual(await titles('dueFrom=2099-01-10&dueBefore=2099-01-20'), ['Mitte']);
    assert.deepEqual(await titles('dueFrom=2099-01-10&dueBefore=2099-01-14'), [], 'Aufgaben ohne Termin gehören nie in einen Zeitraum');
  } finally {
    await ctx.close();
  }
});
