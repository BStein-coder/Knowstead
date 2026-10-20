import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, KeyParam, Nullable, requireUser } from '../../http.ts';
import { requestLocale } from '../../core/i18n.ts';
import type { Services } from '../../services.ts';
import type { Bucket, TaskInput } from './service.ts';

const Bucket = Type.Object({
  id: Type.Optional(Type.String({ maxLength: 30 })),
  name: Type.String({ minLength: 1, maxLength: 40 }),
  color: Type.Optional(Type.String({ maxLength: 20 })),
});

const ChecklistEntry = Type.Object({ text: Type.String({ maxLength: 200 }), done: Type.Optional(Type.Boolean()) });

const TaskBody = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 300 })),
  notes: Type.Optional(Type.String({ maxLength: 5000 })),
  bucket: Type.Optional(Type.String({ maxLength: 30 })),
  assigneeId: Type.Optional(Nullable(Type.Integer())),
  dueDate: Type.Optional(Nullable(Type.String({ maxLength: 30 }))),
  startDate: Type.Optional(Nullable(Type.String({ maxLength: 30 }))),
  priority: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('normal'), Type.Literal('high'), Type.Literal('urgent')])),
  status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('doing'), Type.Literal('done')])),
  progress: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  pageId: Type.Optional(Nullable(Type.Integer())),
  labels: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 30 })),
  checklist: Type.Optional(Type.Array(ChecklistEntry)),
  progressFromChecklist: Type.Optional(Type.Boolean()),
  predecessors: Type.Optional(
    Type.Array(
      Type.Object({
        taskId: Type.Integer(),
        type: Type.Optional(Type.Union([Type.Literal('FS'), Type.Literal('SS'), Type.Literal('FF'), Type.Literal('SF')])),
        lagDays: Type.Optional(Type.Integer({ minimum: -365, maximum: 365 })),
      }),
      { maxItems: 20 },
    ),
  ),
  recurrence: Type.Optional(
    Type.Union([
      Type.Object({
        freq: Type.Union([Type.Literal('daily'), Type.Literal('weekly'), Type.Literal('monthly'), Type.Literal('yearly')]),
        interval: Type.Integer({ minimum: 1, maximum: 52 }),
      }),
      Type.Null(),
    ]),
  ),
});

/** Aufgabenplaner: Pläne (Boards), Aufgaben und persönliche Sicht. */
export async function taskRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Aufgaben'];

  app.get('/api/v1/spaces/:key/boards', { schema: { tags, summary: 'Pläne eines Bereichs', params: KeyParam } }, async (req) => ({
    items: s.tasks.listBoards(req.auth, req.params.key),
  }));

  app.post(
    '/api/v1/spaces/:key/boards',
    {
      schema: {
        tags,
        summary: 'Plan anlegen',
        params: KeyParam,
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          description: Type.Optional(Type.String({ maxLength: 500 })),
          buckets: Type.Optional(Type.Array(Bucket)),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.tasks.createBoard(req.auth, req.params.key, req.body as { name: string; description?: string; buckets?: Bucket[] });
    },
  );

  app.get('/api/v1/boards', { schema: { tags, summary: 'Alle sichtbaren Pläne' } }, async (req) => ({ items: s.tasks.allBoards(req.auth) }));

  app.get(
    '/api/v1/projects',
    { schema: { tags, summary: 'Projekte: Pläne aller sichtbaren Bereiche mit Fortschritt, nächstem Termin und Beteiligten' } },
    async (req) => {
      requireUser(req);
      return { items: s.tasks.projects(req.auth) };
    },
  );

  app.get('/api/v1/boards/:id', { schema: { tags, summary: 'Plan mit Aufgaben', params: IdParam } }, async (req) => {
    const board = s.tasks.boardDto(req.auth, s.tasks.boardRow(req.params.id));
    return { board, tasks: s.tasks.list(req.auth, req.params.id) };
  });

  app.patch(
    '/api/v1/boards/:id',
    {
      schema: {
        tags,
        summary: 'Plan ändern (Name, Beschreibung, Spalten)',
        params: IdParam,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          description: Type.Optional(Type.String({ maxLength: 500 })),
          buckets: Type.Optional(Type.Array(Bucket)),
          autoSchedule: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.tasks.updateBoard(req.auth, req.params.id, req.body as { name?: string; description?: string; buckets?: Bucket[]; autoSchedule?: boolean });
    },
  );

  app.delete('/api/v1/boards/:id', { schema: { tags, summary: 'Plan löschen', params: IdParam } }, async (req) => {
    requireUser(req);
    s.tasks.deleteBoard(req.auth, req.params.id);
    return { ok: true };
  });

  app.get(
    '/api/v1/boards/:id/export.csv',
    // Ein Export liest den ganzen Plan – nicht unbegrenzt oft hintereinander
    { schema: { tags, summary: 'Plan als CSV (Excel, Besprechungen)', params: IdParam }, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireUser(req);
      const { filename, csv } = s.tasks.exportCsv(req.auth, req.params.id, requestLocale(req, s.settings.get('defaultLocale')));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return csv;
    },
  );

  app.post('/api/v1/boards/:id/tasks', { schema: { tags, summary: 'Aufgabe anlegen', params: IdParam, body: TaskBody } }, async (req) => {
    requireUser(req);
    return s.tasks.create(req.auth, req.params.id, req.body as TaskInput);
  });

  app.get(
    '/api/v1/tasks',
    {
      schema: {
        tags,
        summary: 'Aufgaben über alle sichtbaren Bereiche filtern (z. B. assignee=me&status=open-all)',
        querystring: Type.Object({
          assignee: Type.Optional(Type.String({ maxLength: 20 })),
          status: Type.Optional(Type.String({ maxLength: 20 })),
          dueFrom: Type.Optional(Type.String({ maxLength: 30 })),
          dueBefore: Type.Optional(Type.String({ maxLength: 30 })),
          space: Type.Optional(Type.String({ maxLength: 40 })),
          board: Type.Optional(Type.Integer()),
          page: Type.Optional(Type.Integer()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      const q = req.query;
      const assignee = q.assignee === 'me' ? 'me' : q.assignee && /^\d+$/.test(q.assignee) ? Number(q.assignee) : undefined;
      const status = q.status === 'open' || q.status === 'doing' || q.status === 'done' || q.status === 'open-all' ? q.status : undefined;
      return {
        items: s.tasks.query(req.auth, {
          assignee,
          status,
          dueFrom: q.dueFrom,
          dueBefore: q.dueBefore,
          spaceKey: q.space,
          boardId: q.board,
          pageId: q.page,
          limit: q.limit,
        }),
      };
    },
  );

  app.patch('/api/v1/tasks/:id', { schema: { tags, summary: 'Aufgabe ändern', params: IdParam, body: TaskBody } }, async (req) => {
    requireUser(req);
    return s.tasks.update(req.auth, req.params.id, req.body as TaskInput);
  });

  app.post(
    '/api/v1/tasks/:id/move',
    {
      schema: {
        tags,
        summary: 'Aufgabe in eine andere Spalte oder Position schieben',
        params: IdParam,
        body: Type.Object({ bucket: Type.String({ maxLength: 30 }), index: Type.Integer({ minimum: 0 }) }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.tasks.move(req.auth, req.params.id, req.body.bucket, req.body.index);
    },
  );

  app.post(
    '/api/v1/tasks/bulk',
    {
      schema: {
        tags,
        summary: 'Mehrere Aufgaben ändern oder in den Papierkorb legen',
        body: Type.Object({
          ids: Type.Array(Type.Integer(), { minItems: 1, maxItems: 100 }),
          patch: Type.Optional(TaskBody),
          delete: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.tasks.bulk(req.auth, req.body.ids, { patch: req.body.patch as TaskInput | undefined, delete: req.body.delete });
    },
  );

  app.delete('/api/v1/tasks/:id', { schema: { tags, summary: 'Aufgabe in den Papierkorb legen', params: IdParam } }, async (req) => {
    requireUser(req);
    s.tasks.delete(req.auth, req.params.id);
    return { ok: true };
  });

  /* ------------------------------- Papierkorb ------------------------------- */

  app.get('/api/v1/spaces/:key/task-trash', { schema: { tags, summary: 'Gelöschte Aufgaben eines Bereichs', params: KeyParam } }, async (req) => {
    requireUser(req);
    return { items: s.taskTrash.list(req.auth, s.spaces.requireViewable(req.auth, req.params.key)) };
  });

  app.post('/api/v1/tasks/:id/restore', { schema: { tags, summary: 'Aufgabe aus dem Papierkorb holen', params: IdParam } }, async (req) => {
    requireUser(req);
    const row = s.taskTrash.restore(req.auth, req.params.id);
    return s.tasks.toDto(req.auth, row);
  });

  app.delete('/api/v1/tasks/:id/purge', { schema: { tags, summary: 'Aufgabe endgültig löschen', params: IdParam } }, async (req) => {
    requireUser(req);
    s.taskTrash.purge(req.auth, req.params.id);
    return { ok: true };
  });

  /* ------------------------------ Chat je Aufgabe ------------------------------ */

  const MessageBody = Type.Object({ body: Type.String({ minLength: 1, maxLength: 20_000 }) });

  app.get('/api/v1/tasks/:id/comments', { schema: { tags, summary: 'Chat der Aufgabe (Nachrichten in zeitlicher Reihenfolge)', params: IdParam } }, async (req) => ({
    items: s.taskComments.list(req.auth, req.params.id),
  }));

  app.post(
    '/api/v1/tasks/:id/comments',
    { schema: { tags, summary: 'Nachricht in den Chat der Aufgabe schreiben (HTML, @-Erwähnungen benachrichtigen)', params: IdParam, body: MessageBody } },
    async (req) => {
      requireUser(req);
      return s.taskComments.create(req.auth, req.params.id, req.body.body);
    },
  );

  app.post('/api/v1/tasks/:id/comments/read', { schema: { tags, summary: 'Chat der Aufgabe als gelesen markieren (Ungelesen-Zeichen auf der Karte)', params: IdParam } }, async (req) => {
    requireUser(req);
    s.taskComments.markRead(req.auth, req.params.id);
    return { ok: true };
  });

  app.patch('/api/v1/task-comments/:id', { schema: { tags, summary: 'Eigene Nachricht bearbeiten', params: IdParam, body: MessageBody } }, async (req) => {
    requireUser(req);
    return s.taskComments.update(req.auth, req.params.id, req.body.body);
  });

  app.delete('/api/v1/task-comments/:id', { schema: { tags, summary: 'Nachricht löschen (eigene; Bereichsverwaltung alle)', params: IdParam } }, async (req) => {
    requireUser(req);
    s.taskComments.delete(req.auth, req.params.id);
    return { ok: true };
  });

  /* ---------------------------- Zwischenablage ---------------------------- */

  const clipTags = ['Zwischenablage'];

  app.get('/api/v1/clips', { schema: { tags: clipTags, summary: 'Eigene Zwischenablage' } }, async (req) => {
    requireUser(req);
    return { items: s.clips.list(req.auth) };
  });

  app.post(
    '/api/v1/clips',
    {
      schema: {
        tags: clipTags,
        summary: 'Ausschnitt ablegen',
        body: Type.Object({
          content: Type.String({ minLength: 1, maxLength: 100_000 }),
          title: Type.Optional(Type.String({ maxLength: 120 })),
          kind: Type.Optional(Type.Union([Type.Literal('html'), Type.Literal('text'), Type.Literal('link')])),
          sourcePageId: Type.Optional(Nullable(Type.Integer())),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.clips.create(req.auth, req.body);
    },
  );

  app.patch(
    '/api/v1/clips/:id',
    {
      schema: {
        tags: clipTags,
        summary: 'Ausschnitt umbenennen oder anheften',
        params: IdParam,
        body: Type.Object({ title: Type.Optional(Type.String({ maxLength: 120 })), pinned: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      requireUser(req);
      if (req.body.pinned !== undefined) s.clips.setPinned(req.auth, req.params.id, req.body.pinned);
      if (req.body.title !== undefined) return s.clips.rename(req.auth, req.params.id, req.body.title);
      return s.clips.list(req.auth).find((c) => c.id === req.params.id) ?? null;
    },
  );

  app.delete('/api/v1/clips/:id', { schema: { tags: clipTags, summary: 'Ausschnitt löschen', params: IdParam } }, async (req) => {
    requireUser(req);
    s.clips.delete(req.auth, req.params.id);
    return { ok: true };
  });

  app.delete('/api/v1/clips', { schema: { tags: clipTags, summary: 'Zwischenablage leeren (angeheftete bleiben)' } }, async (req) => {
    requireUser(req);
    return { removed: s.clips.clear(req.auth) };
  });

  /* ------------------------------ Kalender-Abo ------------------------------ */

  const calendarTags = ['Kalender'];

  app.get('/api/v1/me/calendar', { schema: { tags: calendarTags, summary: 'Status des persönlichen Kalender-Abos' } }, async (req) => s.calendar.status(req.auth));

  app.post('/api/v1/me/calendar', { schema: { tags: calendarTags, summary: 'Kalender-Link erzeugen (ersetzt einen bestehenden)' } }, async (req) => s.calendar.rotate(req.auth));

  app.delete('/api/v1/me/calendar', { schema: { tags: calendarTags, summary: 'Kalender-Abo widerrufen' } }, async (req) => {
    s.calendar.revoke(req.auth);
    return { ok: true };
  });

  app.get(
    '/api/v1/calendar/:file',
    {
      config: { rateLimit: { max: 120, timeWindow: '10 minutes' } },
      schema: {
        tags: calendarTags,
        summary: 'ICS-Feed (für Outlook, Apple, Google, Thunderbird) – Zugriff über den geheimen Link',
        params: Type.Object({ file: Type.String({ maxLength: 120 }) }),
        querystring: Type.Object({ board: Type.Optional(Type.Integer()) }),
      },
    },
    async (req, reply) => {
      const token = req.params.file.replace(/\.ics$/i, '');
      const { body } = s.calendar.feed(token, { board: req.query.board });
      return reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', 'inline; filename="knowstead.ics"')
        .header('Cache-Control', 'private, max-age=300')
        .send(body);
    },
  );
}
