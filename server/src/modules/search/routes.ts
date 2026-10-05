import Type from 'typebox';
import type { App } from '../../http.ts';
import type { Services } from '../../services.ts';

export async function searchRoutes(app: App, s: Services): Promise<void> {
  app.get(
    '/api/v1/search',
    {
      schema: {
        tags: ['Suche'],
        summary: 'Volltextsuche mit Filtern',
        description:
          'Syntax: Freitext, "Phrase", -ausschließen, ODER, space:KEY, label:name, author:benutzer, type:markdown|code|text, in:title, #eigenschaft, #eigenschaft=wert, #prio>2, #name~teil',
        querystring: Type.Object({
          q: Type.String({ maxLength: 500 }),
          space: Type.Optional(Type.String()),
          label: Type.Optional(Type.String()),
          type: Type.Optional(Type.String()),
          author: Type.Optional(Type.String()),
          updatedAfter: Type.Optional(Type.String()),
          sort: Type.Optional(Type.Union([Type.Literal('relevance'), Type.Literal('updated'), Type.Literal('title')])),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
    },
    async (req) => {
      const result = await s.search.search(req.auth, req.query);
      // Für die Inhaltsanalyse nur die erste Ergebnisseite zählen (Blättern ist keine neue Suche)
      if (!req.query.offset && req.auth.user) s.analytics.recordSearch(req.query.q, result.total + (result.attachments?.length ?? 0));
      return result;
    },
  );

  app.get(
    '/api/v1/search/quick',
    {
      schema: {
        tags: ['Suche'],
        summary: 'Schnellsuche (Titel, Bereiche) für die Befehlspalette',
        querystring: Type.Object({ q: Type.String({ maxLength: 200 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })) }),
      },
    },
    async (req) => s.search.quick(req.auth, req.query.q, req.query.limit ?? 8),
  );

  app.get(
    '/api/v1/labels',
    {
      schema: {
        tags: ['Stichwörter & Eigenschaften'],
        summary: 'Alle Stichwörter mit Häufigkeit',
        querystring: Type.Object({ q: Type.Optional(Type.String({ maxLength: 50 })), space: Type.Optional(Type.String()) }),
      },
    },
    async (req) => {
      const spaceId = req.query.space ? s.spaces.requireViewable(req.auth, req.query.space).id : undefined;
      return s.labels.allLabels(req.auth, { q: req.query.q, spaceId });
    },
  );

  app.post(
    '/api/v1/labels/rename',
    {
      schema: {
        tags: ['Stichwörter & Eigenschaften'],
        summary: 'Stichwort umbenennen oder zusammenführen (Administration)',
        body: Type.Object({ from: Type.String({ minLength: 1, maxLength: 50 }), to: Type.String({ minLength: 1, maxLength: 50 }) }),
      },
    },
    async (req) => s.labels.renameLabel(req.auth, req.body.from, req.body.to),
  );

  app.delete(
    '/api/v1/labels/:name',
    {
      schema: {
        tags: ['Stichwörter & Eigenschaften'],
        summary: 'Stichwort von allen Seiten entfernen (Administration)',
        params: Type.Object({ name: Type.String({ minLength: 1, maxLength: 50 }) }),
      },
    },
    async (req) => ({ pages: s.labels.deleteLabel(req.auth, req.params.name) }),
  );

  app.get(
    '/api/v1/properties/names',
    {
      schema: {
        tags: ['Stichwörter & Eigenschaften'],
        summary: 'Bekannte Eigenschaftsnamen',
        querystring: Type.Object({ space: Type.Optional(Type.String()) }),
      },
    },
    async (req) => {
      const spaceId = req.query.space ? s.spaces.requireViewable(req.auth, req.query.space).id : undefined;
      return s.labels.propertyNames(req.auth, spaceId);
    },
  );

  app.get(
    '/api/v1/activity',
    {
      schema: {
        tags: ['Aktivität'],
        summary: 'Globaler Aktivitätsfeed',
        querystring: Type.Object({
          before: Type.Optional(Type.Integer()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          space: Type.Optional(Type.String()),
          user: Type.Optional(Type.String()),
        }),
      },
    },
    async (req) => {
      const spaceId = req.query.space ? s.spaces.requireViewable(req.auth, req.query.space).id : undefined;
      const userId = req.query.user ? s.users.byUsername(req.query.user)?.id : undefined;
      return s.activity.feed(req.auth, { before: req.query.before, limit: req.query.limit, spaceId, userId });
    },
  );
}
