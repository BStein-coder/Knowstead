import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';
import { advance, daysBetween, shiftDay } from '../src/modules/tasks/service.ts';
import { icsFold, icsText } from '../src/modules/tasks/calendar.ts';

function localDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Planer: Wiederholung, Erinnerungen, Kalender-Abo', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  let tomId = 0;
  let boardId = 0;

  try {
    await t.test('Hilfsfunktionen', () => {
      assert.equal(advance('2027-01-31', { freq: 'monthly', interval: 1 }), '2027-02-28');
      assert.equal(advance('2028-02-29', { freq: 'yearly', interval: 1 }), '2029-02-28');
      assert.equal(advance('2026-12-30', { freq: 'weekly', interval: 2 }), '2027-01-13');
      assert.equal(shiftDay('2026-03-28', 2), '2026-03-30');
      assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2, 'Zeitumstellung zählt nicht');
      assert.equal(icsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
      assert.equal(icsText('Titel\rDESCRIPTION:eingeschleust'), 'Titel\\nDESCRIPTION:eingeschleust', 'einzelnes CR');
      const folded = icsFold(`SUMMARY:${'Überprüfung '.repeat(12)}`);
      for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'höchstens 75 Oktette');
      assert.equal(folded.replace(/\r\n /g, ''), `SUMMARY:${'Überprüfung '.repeat(12)}`);
    });

    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true })).status, 200);
      tomId = (await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' })).body.id;
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Betrieb' })).body.id;
    });

    await t.test('Wiederkehrende Aufgaben', async () => {
      const due = localDay(2);
      const task = await tom.post(`/api/v1/boards/${boardId}/tasks`, {
        title: 'Backup-Test',
        bucket: 'doing',
        assigneeId: tomId,
        startDate: localDay(1),
        dueDate: due,
        checklist: [{ text: 'Restore probieren', done: true }],
        recurrence: { freq: 'weekly', interval: 1 },
      });
      assert.equal(task.status, 200, task.raw);
      assert.deepEqual(task.body.recurrence, { freq: 'weekly', interval: 1 });

      const done = await tom.patch(`/api/v1/tasks/${task.body.id}`, { status: 'done' });
      assert.equal(done.body.recurrence, null, 'Wiederholung wandert weiter');
      const all = (await tom.get(`/api/v1/boards/${boardId}`)).body.tasks as { id: number; title: string; dueDate: string; startDate: string; status: string; bucket: string; checklist: { done: boolean }[]; recurrence: unknown; seriesId: number }[];
      const next = all.find((x) => x.title === 'Backup-Test' && x.id !== task.body.id)!;
      assert.ok(next, 'nächste Aufgabe angelegt');
      assert.equal(next.dueDate, shiftDay(due, 7));
      assert.equal(next.startDate, shiftDay(localDay(1), 7));
      assert.equal(next.status, 'open');
      assert.equal(next.bucket, 'todo');
      assert.equal(next.checklist[0].done, false, 'Checkliste zurückgesetzt');
      assert.deepEqual(next.recurrence, { freq: 'weekly', interval: 1 });
      assert.equal(next.seriesId, task.body.id);

      // Wieder öffnen und erneut erledigen erzeugt keine zweite Folgeaufgabe
      await tom.patch(`/api/v1/tasks/${task.body.id}`, { status: 'open' });
      await tom.patch(`/api/v1/tasks/${task.body.id}`, { status: 'done' });
      const count = (await tom.get(`/api/v1/boards/${boardId}`)).body.tasks.filter((x: { title: string }) => x.title === 'Backup-Test').length;
      assert.equal(count, 2);

      // Erledigen per Drag & Drop in „Erledigt“ setzt die Serie ebenfalls fort
      const moved = await tom.post(`/api/v1/tasks/${next.id}/move`, { bucket: 'done', index: 0 });
      assert.equal(moved.body.status, 'done');
      const after = (await tom.get(`/api/v1/boards/${boardId}`)).body.tasks.filter((x: { title: string }) => x.title === 'Backup-Test');
      assert.equal(after.length, 3);

      // Verpasste Termine werden übersprungen
      const late = await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Täglicher Check', dueDate: localDay(-10), recurrence: { freq: 'daily', interval: 1 } });
      await tom.patch(`/api/v1/tasks/${late.body.id}`, { status: 'done' });
      const daily = (await tom.get(`/api/v1/boards/${boardId}`)).body.tasks.find((x: { title: string; id: number }) => x.title === 'Täglicher Check' && x.id !== late.body.id);
      assert.equal(daily.dueDate, localDay(0));
    });

    await t.test('Erinnerungen vor und nach dem Termin', async () => {
      const tomorrow = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Zertifikat verlängern', assigneeId: tomId, dueDate: localDay(1) });
      const overdue = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Lizenz melden', assigneeId: tomId, dueDate: localDay(-1) });
      await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Später', assignee: tomId, dueDate: localDay(9) });
      assert.equal(tomorrow.status, 200, tomorrow.raw);
      assert.equal(overdue.status, 200, overdue.raw);

      const first = ctx.s.tasks.runReminders(new Date(), { force: true });
      assert.ok(first.before >= 1, 'Erinnerung für morgen');
      assert.ok(first.overdue >= 1, 'Erinnerung für überfällig');
      const again = ctx.s.tasks.runReminders(new Date(), { force: true });
      assert.deepEqual(again, { before: 0, overdue: 0 }, 'je Termin nur einmal');
      const notes = JSON.stringify((await tom.get('/api/v1/me/notifications')).body);
      assert.match(notes, /Aufgabe fällig morgen: Zertifikat verlängern/);
      assert.match(notes, /Aufgabe überfällig: Lizenz melden/);

      // Termin verschoben → neue Erinnerung; Vorlauf „keine“ → nichts
      await tom.patch('/api/v1/me/preferences', { taskReminderDays: -1 });
      await admin.patch(`/api/v1/tasks/${tomorrow.body.id}`, { dueDate: localDay(0) });
      assert.equal(ctx.s.tasks.runReminders(new Date(), { force: true }).before, 0);
      await tom.patch('/api/v1/me/preferences', { taskReminderDays: 1 });
      assert.equal(ctx.s.tasks.runReminders(new Date(), { force: true }).before, 1);
    });

    await t.test('Fortschritt aus der Checkliste und mehr Stichwörter', async () => {
      // Von Hand bleibt von Hand
      const manual = await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Von Hand', progress: 40, checklist: [{ text: 'A' }, { text: 'B' }] });
      assert.equal(manual.status, 200, manual.raw);
      assert.deepEqual([manual.body.progress, manual.body.progressFromChecklist], [40, false]);

      // Aus der Checkliste: zwei von vier erledigt → 50 %
      const auto = await tom.post(`/api/v1/boards/${boardId}/tasks`, {
        title: 'Aus Checkliste',
        progress: 90,
        progressFromChecklist: true,
        checklist: [{ text: 'A', done: true }, { text: 'B', done: true }, { text: 'C' }, { text: 'D' }],
      });
      assert.deepEqual([auto.body.progress, auto.body.progressFromChecklist], [50, true], 'Regler wird ignoriert');

      // Punkt abhaken → Fortschritt zieht nach, auch ohne „progress“ im Aufruf
      const ticked = await tom.patch(`/api/v1/tasks/${auto.body.id}`, {
        checklist: [{ text: 'A', done: true }, { text: 'B', done: true }, { text: 'C', done: true }, { text: 'D' }],
      });
      assert.equal(ticked.body.progress, 75);

      // Umschalten auf „von Hand“ gibt den Regler wieder frei
      const back = await tom.patch(`/api/v1/tasks/${auto.body.id}`, { progressFromChecklist: false, progress: 20 });
      assert.deepEqual([back.body.progress, back.body.progressFromChecklist], [20, false]);

      // Erledigt bleibt 100 %
      assert.equal((await tom.patch(`/api/v1/tasks/${auto.body.id}`, { status: 'done' })).body.progress, 100);

      // Ohne Checklistenpunkte bleibt der Wert vom Regler
      const empty = await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Ohne Punkte', progress: 30, progressFromChecklist: true });
      assert.deepEqual([empty.body.progress, empty.body.progressFromChecklist], [30, true]);

      // Stichwörter: 30 statt bisher 10, darüber eine klare Absage statt stillem Abschneiden
      const many = Array.from({ length: 30 }, (_, i) => `stichwort-${i + 1}`);
      const tagged = await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Viele Stichwörter', labels: many });
      assert.equal(tagged.status, 200, tagged.raw);
      assert.equal(tagged.body.labels.length, 30);
      assert.equal((await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Zu viele', labels: [...many, 'eins-zuviel'] })).status, 400);
    });

    await t.test('Kalender-Abo', async () => {
      assert.equal((await tom.get('/api/v1/me/calendar')).body.active, false);
      const created = await tom.post('/api/v1/me/calendar', {});
      assert.equal(created.status, 200, created.raw);
      assert.match(created.body.url, /^http:\/\/localhost:3999\/api\/v1\/calendar\/[A-Za-z0-9_-]+\.ics$/);
      assert.match(created.body.webcal, /^webcal:\/\//);
      const path = new URL(created.body.url).pathname;

      const anonymous = new Client(ctx.app);
      const feed = await anonymous.get(path);
      assert.equal(feed.status, 200, feed.raw);
      assert.match(String(feed.headers['content-type']), /text\/calendar/);
      assert.match(feed.raw, /^BEGIN:VCALENDAR\r\n/);
      assert.match(feed.raw, /SUMMARY:⚠ Lizenz melden/);
      assert.match(feed.raw, /DTSTART;VALUE=DATE:\d{8}/);
      assert.match(feed.raw, /UID:task-\d+@localhost:3999/);
      for (const line of feed.raw.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);

      const boardFeed = await anonymous.get(`${path}?board=${boardId}`);
      assert.match(boardFeed.raw, /X-WR-CALNAME:Test – Betrieb/);

      assert.equal((await anonymous.get('/api/v1/calendar/falsch-falsch-falsch-falsch.ics')).status, 404);
      // Neuer Link macht den alten ungültig, Widerruf beendet das Abo
      const rotated = await tom.post('/api/v1/me/calendar', {});
      assert.equal((await anonymous.get(path)).status, 404);
      assert.equal((await anonymous.get(new URL(rotated.body.url).pathname)).status, 200);
      await tom.del('/api/v1/me/calendar');
      assert.equal((await anonymous.get(new URL(rotated.body.url).pathname)).status, 404);
    });
  } finally {
    await ctx.close();
  }
});
