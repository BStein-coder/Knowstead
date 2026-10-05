import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

interface TaskHit {
  id: number;
  title: string;
  boardName: string;
  spaceKey: string;
  status: string;
  dueDate: string | null;
  overdue: boolean;
  labels: string[];
  url: string;
}

test('Suche findet Aufgaben aus sichtbaren Bereichen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const lena = new Client(ctx.app);
  let boardId = 0;
  let secretBoard = 0;
  const find = async (client: Client, q: string) => ((await client.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).body.tasks ?? []) as TaskHit[];

  try {
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
    boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Rollout' })).body.id;
    const task = async (title: string, body: Record<string, unknown> = {}) => (await admin.post(`/api/v1/boards/${boardId}/tasks`, { title, ...body })).body;

    await task('Serverschrank verkabeln', { notes: 'Patchfeld nach Plan auflegen', labels: ['technik'], dueDate: '2027-07-01' });
    const knowstead = await task('Dokumentation schreiben', { status: 'done' });
    await task('Schulung planen', { labels: ['organisation'] });

    await t.test('Treffer in Titel, Notizen und Stichwörtern', async () => {
      assert.deepEqual((await find(admin, 'Serverschrank')).map((x) => x.title), ['Serverschrank verkabeln']);
      assert.deepEqual((await find(admin, 'Patchfeld')).map((x) => x.title), ['Serverschrank verkabeln'], 'auch in den Notizen');
      assert.deepEqual((await find(admin, 'organisation')).map((x) => x.title), ['Schulung planen'], 'auch im Stichwort');
      assert.equal((await find(admin, 'gibtesnicht')).length, 0);
    });

    await t.test('Angaben für die Trefferliste', async () => {
      const [hit] = await find(admin, 'Serverschrank');
      assert.equal(hit.boardName, 'Rollout');
      assert.equal(hit.spaceKey, 'TEAM');
      assert.equal(hit.dueDate, '2027-07-01');
      assert.deepEqual(hit.labels, ['technik']);
      assert.equal(hit.url, `/s/TEAM/tasks?board=${boardId}&task=${hit.id}`, 'Link öffnet die Aufgabe im Plan');
    });

    await t.test('Erledigte stehen hinten, mehrere Wörter verknüpfen mit UND', async () => {
      const both = await find(admin, 'schreiben Dokumentation');
      assert.deepEqual(both.map((x) => x.id), [knowstead.id]);
      const mixed = await find(admin, 'planen');
      assert.equal(mixed[0].title, 'Schulung planen');
    });

    await t.test('Gelöschte Aufgaben erscheinen nicht', async () => {
      await admin.del(`/api/v1/tasks/${knowstead.id}`);
      assert.equal((await find(admin, 'Dokumentation schreiben')).length, 0);
      await admin.post(`/api/v1/tasks/${knowstead.id}/restore`, {});
      assert.equal((await find(admin, 'Dokumentation schreiben')).length, 1);
    });

    await t.test('Nur Bereiche, die man sehen darf', async () => {
      const privat = (await admin.post('/api/v1/spaces', { key: 'GEHEIM', name: 'Geheim', preset: 'private' })).body;
      assert.ok(privat.key);
      secretBoard = (await admin.post('/api/v1/spaces/GEHEIM/boards', { name: 'Intern' })).body.id;
      await admin.post(`/api/v1/boards/${secretBoard}/tasks`, { title: 'Gehaltsrunde vorbereiten' });
      assert.equal((await find(admin, 'Gehaltsrunde')).length, 1, 'für die Verwaltung sichtbar');

      await admin.post('/api/v1/admin/users', { username: 'lena', displayName: 'Lena', password: 'geheim-geheim' });
      assert.equal((await lena.post('/api/v1/auth/login', { login: 'lena', password: 'geheim-geheim' })).status, 200);
      assert.equal((await find(lena, 'Gehaltsrunde')).length, 0, 'ohne Zugriff auf den Bereich kein Treffer');
      assert.equal((await find(lena, 'Serverschrank')).length, 1, 'offener Bereich bleibt sichtbar');
    });

    await t.test('Groß- und Kleinschreibung spielt keine Rolle – auch bei Umlauten', async () => {
      await task('Ölwechsel am Stapler', { notes: 'Ähnlich wie im Vorjahr', labels: ['Überholung'] });
      for (const q of ['ölwechsel', 'ÖLWECHSEL', 'ähnlich', 'überholung']) {
        assert.deepEqual((await find(admin, q)).map((x) => x.title), ['Ölwechsel am Stapler'], q);
      }
    });

    await t.test('Nachrichten im Chat: gefunden, mit Auszug, Link springt zur Nachricht', async () => {
      type ChatHit = TaskHit & { chat: { id: number; author: { username: string } | null; createdAt: string; snippet: string } | null };
      const chatTask = await task('Messestand abstimmen');
      const message = async (body: string) => (await admin.post(`/api/v1/tasks/${chatTask.id}/comments`, { body })).body as { id: number };
      await message('<p>Der Lieferant bestätigt den Termin.</p>');
      const second = await message('<p>Für den Aufbau brauchen wir die <strong>Gabelstapler</strong>-Schulung &amp; zwei Helfer.</p>');

      const [hit] = (await find(admin, 'gabelstapler')) as ChatHit[];
      assert.equal(hit.title, 'Messestand abstimmen', 'Wort steht nur im Chat');
      assert.equal(hit.chat?.id, second.id);
      assert.equal(hit.chat?.author?.username, 'admin');
      assert.equal(hit.chat?.snippet, 'Für den Aufbau brauchen wir die <mark>Gabelstapler</mark>-Schulung &amp; zwei Helfer.', 'reiner Text, maskiert, Treffer hervorgehoben');
      assert.equal(hit.url, `/s/TEAM/tasks?board=${boardId}&task=${chatTask.id}&comment=${second.id}`);

      // Wörter dürfen sich auf Titel und Chat verteilen
      assert.deepEqual((await find(admin, 'Messestand Helfer')).map((x) => x.id), [chatTask.id]);
      // Treffer nur in der Aufgabe selbst: kein Auszug, Link wie bisher
      const [plain] = (await find(admin, 'Messestand')) as ChatHit[];
      assert.equal(plain.chat, null);
      assert.equal(plain.url, `/s/TEAM/tasks?board=${boardId}&task=${chatTask.id}`);

      // Tag- und Attributnamen des gespeicherten HTML sind kein Text
      assert.equal((await find(admin, 'strong')).length, 0);
      // „Nur im Titel“ lässt den Chat aus
      assert.equal((await find(admin, 'intitle:gabelstapler')).length, 0);

      // Bearbeitete Nachricht: gesucht wird der neue Text; gelöschte Nachricht: kein Treffer mehr
      await admin.patch(`/api/v1/task-comments/${second.id}`, { body: '<p>Aufbau mit Hubwagen statt Stapler.</p>' });
      assert.equal((await find(admin, 'gabelstapler')).length, 0);
      assert.equal(((await find(admin, 'hubwagen')) as ChatHit[])[0]?.chat?.id, second.id);
      await admin.del(`/api/v1/task-comments/${second.id}`);
      assert.equal((await find(admin, 'hubwagen')).length, 0);

      // Ohne Zugriff auf den Bereich verrät auch der Chat nichts
      const secret = (await admin.post(`/api/v1/boards/${secretBoard}/tasks`, { title: 'Personalgespräch' })).body;
      await admin.post(`/api/v1/tasks/${secret.id}/comments`, { body: '<p>Abfindung besprechen</p>' });
      assert.equal((await find(admin, 'abfindung')).length, 1);
      assert.equal((await find(lena, 'abfindung')).length, 0);
    });
  } finally {
    await ctx.close();
  }
});
