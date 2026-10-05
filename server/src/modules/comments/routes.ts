import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, Nullable } from '../../http.ts';
import type { Services } from '../../services.ts';

export async function commentRoutes(app: App, s: Services): Promise<void> {
  app.get('/api/v1/pages/:id/comments', { schema: { tags: ['Kommentare'], summary: 'Kommentare der Seite', params: IdParam } }, async (req) =>
    s.comments.list(req.auth, req.params.id),
  );

  app.post(
    '/api/v1/pages/:id/comments',
    {
      schema: {
        tags: ['Kommentare'],
        summary: 'Kommentar schreiben',
        params: IdParam,
        body: Type.Object({
          body: Type.String({ minLength: 1, maxLength: 50000 }),
          parentId: Type.Optional(Nullable(Type.Integer())),
          quote: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
        }),
      },
    },
    async (req) => s.comments.create(req.auth, req.params.id, req.body),
  );

  app.patch(
    '/api/v1/comments/:id',
    { schema: { tags: ['Kommentare'], summary: 'Kommentar bearbeiten', params: IdParam, body: Type.Object({ body: Type.String({ minLength: 1, maxLength: 50000 }) }) } },
    async (req) => ({ ok: true, ...s.comments.update(req.auth, req.params.id, req.body.body) }),
  );

  app.delete('/api/v1/comments/:id', { schema: { tags: ['Kommentare'], summary: 'Kommentar löschen', params: IdParam } }, async (req) => {
    s.comments.delete(req.auth, req.params.id);
    return { ok: true };
  });

  app.post(
    '/api/v1/comments/:id/resolve',
    { schema: { tags: ['Kommentare'], summary: 'Thread erledigen/wieder öffnen', params: IdParam, body: Type.Object({ resolved: Type.Boolean() }) } },
    async (req) => {
      s.comments.resolve(req.auth, req.params.id, req.body.resolved);
      return { ok: true };
    },
  );
}
