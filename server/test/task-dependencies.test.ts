import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';
import { requiredShift } from '../src/modules/tasks/dependencies.ts';

const day = (d: string) => ({ id: 0, title: '', status: 'open' as const, progress: 0, start_date: d, due_date: d, board_id: 1 });

test('Planer: Abhängigkeiten, automatische Planung, Kreise', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  let boardId = 0;
  const ids: Record<string, number> = {};
  const task = async (key: string, body: Record<string, unknown>) => {
    const res = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: key, ...body });
    assert.equal(res.status, 200, res.raw);
    ids[key] = res.body.id;
    return res.body;
  };
  const get = async (key: string) => ((await admin.get(`/api/v1/boards/${boardId}`)).body.tasks as { id: number }[]).find((x) => x.id === ids[key]) as Record<string, any>;

  try {
    await t.test('Bedingungen je Typ', () => {
      assert.equal(requiredShift({ ...day('2027-01-10') }, { ...day('2027-01-10') }, 'FS', 0), 1, 'FS: am Folgetag');
      assert.equal(requiredShift({ ...day('2027-01-10') }, { ...day('2027-01-12') }, 'FS', 2), 1, 'FS mit Versatz');
      assert.equal(requiredShift({ ...day('2027-01-10') }, { ...day('2027-01-10') }, 'SS', 0), 0);
      assert.equal(requiredShift({ ...day('2027-01-10') }, { ...day('2027-01-08') }, 'FF', 0), 2);
      assert.equal(requiredShift({ ...day('2027-01-10') }, { ...day('2027-01-09') }, 'SF', 0), 1);
      assert.equal(requiredShift({ ...day('2027-01-10'), start_date: null, due_date: null }, { ...day('2027-01-01') }, 'FS', 0), 0, 'ohne Termine keine Bedingung');
    });

    await t.test('Einrichtung', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
      boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Einführung' })).body.id;
      assert.equal((await admin.get(`/api/v1/boards/${boardId}`)).body.board.autoSchedule, true, 'automatische Planung ist Standard');
    });

    await t.test('Nachfolgerin wird hinter die Vorgängerin gelegt und mitgezogen', async () => {
      await task('Konzept', { startDate: '2027-03-01', dueDate: '2027-03-05' });
      await task('Umsetzung', { startDate: '2027-03-03', dueDate: '2027-03-10', predecessors: [{ taskId: ids.Konzept }] });
      await task('Abnahme', { dueDate: '2027-03-11', predecessors: [{ taskId: ids.Umsetzung, type: 'FS', lagDays: 2 }] });

      let umsetzung = await get('Umsetzung');
      assert.equal(umsetzung.startDate, '2027-03-06', 'beginnt nach dem Konzept');
      assert.equal(umsetzung.dueDate, '2027-03-13', 'Dauer bleibt erhalten');
      assert.equal(umsetzung.blocked, true, 'Konzept ist nicht erledigt');
      assert.deepEqual(
        umsetzung.predecessors.map((p: any) => [p.taskId, p.type, p.lagDays, p.violated]),
        [[ids.Konzept, 'FS', 0, false]],
      );
      const abnahme = await get('Abnahme');
      assert.equal(abnahme.dueDate, '2027-03-16', 'Meilenstein nach Umsetzung + 2 Tage Versatz');

      // Konzept verlängert sich → Umsetzung und Abnahme rücken nach
      const moved = await admin.patch(`/api/v1/tasks/${ids.Konzept}`, { dueDate: '2027-03-08' });
      assert.equal(moved.status, 200, moved.raw);
      umsetzung = await get('Umsetzung');
      assert.equal(umsetzung.startDate, '2027-03-09');
      assert.equal(umsetzung.dueDate, '2027-03-16');
      assert.equal((await get('Abnahme')).dueDate, '2027-03-19');
      assert.deepEqual((await get('Konzept')).successors.map((s: any) => s.taskId), [ids.Umsetzung]);

      // Früher fertig → Nachfolgerinnen bleiben, wo sie sind
      await admin.patch(`/api/v1/tasks/${ids.Konzept}`, { dueDate: '2027-03-02', status: 'done' });
      assert.equal((await get('Umsetzung')).startDate, '2027-03-09');
      assert.equal((await get('Umsetzung')).blocked, false, 'Vorgängerin erledigt');
    });

    await t.test('Kreise und Selbstbezug werden abgelehnt', async () => {
      const cycle = await admin.patch(`/api/v1/tasks/${ids.Konzept}`, { predecessors: [{ taskId: ids.Abnahme }] });
      assert.equal(cycle.status, 400);
      assert.match(cycle.body.error.message, /Kreis/);
      assert.equal((await admin.patch(`/api/v1/tasks/${ids.Konzept}`, { predecessors: [{ taskId: ids.Konzept }] })).status, 400);
    });

    await t.test('Abhängigkeiten über Pläne hinweg', async () => {
      const programm = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Programm' })).body.id;
      const teilplan = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Teilprojekt Technik' })).body.id;
      const meilenstein = (await admin.post(`/api/v1/boards/${programm}/tasks`, { title: 'Meilenstein', startDate: '2027-08-01', dueDate: '2027-08-05' })).body;
      const arbeitspaket = (
        await admin.post(`/api/v1/boards/${teilplan}/tasks`, { title: 'Arbeitspaket', startDate: '2027-08-02', dueDate: '2027-08-04', predecessors: [{ taskId: meilenstein.id }] })
      ).body;
      assert.deepEqual([arbeitspaket.startDate, arbeitspaket.dueDate], ['2027-08-06', '2027-08-08'], 'rückt hinter den Meilenstein im anderen Plan');
      assert.equal(arbeitspaket.predecessors[0].boardName, 'Programm', 'zeigt den Plan der Vorgängerin');

      // Verschiebt sich der Meilenstein, zieht der andere Plan nach
      await admin.patch(`/api/v1/tasks/${meilenstein.id}`, { dueDate: '2027-08-10' });
      const nachgezogen = ((await admin.get(`/api/v1/boards/${teilplan}`)).body.tasks as { id: number; startDate: string }[]).find((x) => x.id === arbeitspaket.id);
      assert.equal(nachgezogen?.startDate, '2027-08-11');

      // Beide Pläne zeigen die Verbindung – auch der Plan der Vorgängerin
      const imProgramm = ((await admin.get(`/api/v1/boards/${programm}`)).body.tasks as { id: number; successors: { taskId: number; boardName: string }[] }[]).find(
        (x) => x.id === meilenstein.id,
      );
      assert.deepEqual(imProgramm?.successors.map((s) => [s.taskId, s.boardName]), [[arbeitspaket.id, 'Teilprojekt Technik']]);

      // Ohne automatische Planung im eigenen Plan bleibt die Nachfolgerin liegen
      await admin.patch(`/api/v1/boards/${teilplan}`, { autoSchedule: false });
      await admin.patch(`/api/v1/tasks/${meilenstein.id}`, { dueDate: '2027-08-20' });
      const liegen = ((await admin.get(`/api/v1/boards/${teilplan}`)).body.tasks as { id: number; startDate: string; predecessors: { violated: boolean }[] }[]).find(
        (x) => x.id === arbeitspaket.id,
      );
      assert.equal(liegen?.startDate, '2027-08-11', 'unverändert');
      assert.equal(liegen?.predecessors[0].violated, true, 'wird als Konflikt angezeigt');
      await admin.patch(`/api/v1/boards/${teilplan}`, { autoSchedule: true });

      // Kreise auch über Plangrenzen hinweg
      const rueck = await admin.patch(`/api/v1/tasks/${meilenstein.id}`, { predecessors: [{ taskId: arbeitspaket.id }] });
      assert.equal(rueck.status, 400);
      assert.match(rueck.body.error.message, /Kreis/);
    });

    await t.test('Vorgängerinnen aus fremden Bereichen nur mit Zugriff', async () => {
      const geheim = (await admin.post('/api/v1/spaces', { key: 'VERTRAULICH', name: 'Vertraulich', preset: 'private' })).body;
      assert.equal(geheim.key, 'VERTRAULICH');
      const geheimBoard = (await admin.post('/api/v1/spaces/VERTRAULICH/boards', { name: 'Intern' })).body.id;
      const geheimTask = (await admin.post(`/api/v1/boards/${geheimBoard}/tasks`, { title: 'Vertrauliche Vorarbeit' })).body.id;
      assert.equal((await admin.patch(`/api/v1/tasks/${ids.Umsetzung}`, { predecessors: [{ taskId: geheimTask }] })).status, 200, 'die Verwaltung darf');

      await admin.post('/api/v1/admin/users', { username: 'nina', displayName: 'Nina', password: 'geheim-geheim' });
      const nina = new Client(ctx.app);
      assert.equal((await nina.post('/api/v1/auth/login', { login: 'nina', password: 'geheim-geheim' })).status, 200);
      const versuch = await nina.patch(`/api/v1/tasks/${ids.Abnahme}`, { predecessors: [{ taskId: geheimTask }] });
      assert.equal(versuch.status, 400, versuch.raw);
      assert.match(versuch.body.error.message, /ohne Zugriff/);
      // Und in der Anzeige bleibt die fremde Aufgabe verborgen
      const fuerNina = ((await nina.get(`/api/v1/boards/${boardId}`)).body.tasks as { id: number; predecessors: unknown[] }[]).find((x) => x.id === ids.Umsetzung);
      assert.deepEqual(fuerNina?.predecessors, [], 'Titel aus einem fremden Bereich bleiben unsichtbar');
      await admin.patch(`/api/v1/tasks/${ids.Umsetzung}`, { predecessors: [{ taskId: ids.Konzept }] });
    });

    await t.test('Automatische Planung hält den Plan frei von Konflikten', async () => {
      await task('Entwurf', { startDate: '2027-04-01', dueDate: '2027-04-05' });
      await task('Druck', { startDate: '2027-04-06', dueDate: '2027-04-08', predecessors: [{ taskId: ids.Entwurf }] });

      // Nachfolgerin vor die Vorgängerin gezogen (z. B. auf der Zeitachse) → rückt samt Dauer wieder dahinter
      const early = await admin.patch(`/api/v1/tasks/${ids.Druck}`, { startDate: '2027-04-02', dueDate: '2027-04-04' });
      assert.equal(early.status, 200, early.raw);
      assert.deepEqual([early.body.startDate, early.body.dueDate, early.body.predecessors[0].violated], ['2027-04-06', '2027-04-08', false]);

      // Erledigte Aufgaben bleiben liegen – wieder geöffnet, rücken sie hinter die inzwischen verlängerte Vorgängerin
      await admin.patch(`/api/v1/tasks/${ids.Druck}`, { status: 'done' });
      await admin.patch(`/api/v1/tasks/${ids.Entwurf}`, { dueDate: '2027-04-12' });
      assert.equal((await get('Druck')).startDate, '2027-04-06');
      const reopened = await admin.patch(`/api/v1/tasks/${ids.Druck}`, { status: 'open' });
      assert.deepEqual([reopened.body.startDate, reopened.body.dueDate], ['2027-04-13', '2027-04-15']);

      // Dasselbe beim Ziehen aus der Erledigt-Spalte
      await admin.patch(`/api/v1/tasks/${ids.Druck}`, { status: 'done' });
      await admin.patch(`/api/v1/tasks/${ids.Entwurf}`, { dueDate: '2027-04-20' });
      const buckets = (await admin.get(`/api/v1/boards/${boardId}`)).body.board.buckets;
      const moved = await admin.post(`/api/v1/tasks/${ids.Druck}/move`, { bucket: buckets[0].id, index: 0 });
      assert.equal(moved.status, 200, moved.raw);
      assert.deepEqual([moved.body.status, moved.body.startDate, moved.body.dueDate], ['open', '2027-04-21', '2027-04-23']);
    });

    await t.test('Eine erledigte Vorgängerin bindet nicht mehr', async () => {
      await task('Vorbereitung', { startDate: '2027-05-01', dueDate: '2027-05-10' });
      await task('Start', { startDate: '2027-05-11', dueDate: '2027-05-12', predecessors: [{ taskId: ids.Vorbereitung }] });
      await admin.patch(`/api/v1/tasks/${ids.Vorbereitung}`, { status: 'done' });
      // Früher fertig, Termin nicht nachgetragen: Die Nachfolgerin darf vorziehen – ohne Konflikt und ohne Zurückschieben
      const early = await admin.patch(`/api/v1/tasks/${ids.Start}`, { startDate: '2027-05-06', dueDate: '2027-05-07' });
      assert.deepEqual([early.body.startDate, early.body.predecessors[0].violated, early.body.blocked], ['2027-05-06', false, false]);
      await admin.patch(`/api/v1/tasks/${ids.Vorbereitung}`, { dueDate: '2027-05-20' });
      assert.equal((await get('Start')).startDate, '2027-05-06', 'späterer Termin einer erledigten Aufgabe schiebt nichts');
      assert.equal((await get('Vorbereitung')).successors[0].violated, false);
    });

    await t.test('Abgelehnte Änderungen bleiben ohne Wirkung, ungültige Termine werden abgewiesen', async () => {
      const konzept = await get('Konzept');
      const cycle = await admin.patch(`/api/v1/tasks/${ids.Konzept}`, { title: 'Konzept neu', dueDate: '2027-03-30', predecessors: [{ taskId: ids.Abnahme }] });
      assert.equal(cycle.status, 400);
      assert.deepEqual(await get('Konzept'), konzept, 'Titel und Termin bleiben unverändert');

      const half = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Halbe Aufgabe', predecessors: [{ taskId: 999_999 }] });
      assert.equal(half.status, 400);
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM tasks WHERE title = ?', 'Halbe Aufgabe'), 0, 'keine Aufgabe ohne ihre Abhängigkeiten');

      const umsetzung = await get('Umsetzung');
      for (const dueDate of ['2027-02-30', '2027-13-01', '0099-01-01', 'morgen']) {
        const res = await admin.patch(`/api/v1/tasks/${ids.Umsetzung}`, { dueDate });
        assert.equal(res.status, 400, `${dueDate}: ${res.raw}`);
      }
      assert.deepEqual(await get('Umsetzung'), umsetzung);
      assert.equal((await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Schaltjahr', dueDate: '2028-02-29' })).status, 200);
    });

    await t.test('Ohne automatische Planung werden Verletzungen nur angezeigt', async () => {
      assert.equal((await admin.patch(`/api/v1/boards/${boardId}`, { autoSchedule: false })).body.autoSchedule, false);
      await task('Schulung', { startDate: '2027-03-01', dueDate: '2027-03-02', predecessors: [{ taskId: ids.Abnahme }] });
      const schulung = await get('Schulung');
      assert.equal(schulung.startDate, '2027-03-01', 'nicht verschoben');
      assert.equal(schulung.predecessors[0].violated, true);
      assert.equal((await get('Abnahme')).successors[0].violated, true);

      // Wieder einschalten löst bestehende Verletzungen auf
      await admin.patch(`/api/v1/boards/${boardId}`, { autoSchedule: true });
      assert.equal((await get('Schulung')).startDate, '2027-03-20');
    });

    await t.test('Gelöschte Aufgaben halten niemanden mehr auf, kommen aber verknüpft zurück', async () => {
      await admin.del(`/api/v1/tasks/${ids.Abnahme}`);
      assert.deepEqual((await get('Schulung')).predecessors, [], 'im Papierkorb zählt die Abhängigkeit nicht');
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM task_dependencies WHERE predecessor_id = ?', ids.Abnahme), 1, 'bleibt für das Wiederherstellen erhalten');

      await admin.post(`/api/v1/tasks/${ids.Abnahme}/restore`, {});
      assert.deepEqual((await get('Schulung')).predecessors.map((p: any) => p.taskId), [ids.Abnahme]);

      // Endgültig gelöscht verschwindet auch die Verknüpfung
      await admin.del(`/api/v1/tasks/${ids.Abnahme}`);
      await admin.del(`/api/v1/tasks/${ids.Abnahme}/purge`);
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM task_dependencies WHERE predecessor_id = ?', ids.Abnahme), 0);
    });
  } finally {
    await ctx.close();
  }
});
