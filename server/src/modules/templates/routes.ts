import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, Nullable } from '../../http.ts';
import type { Services } from '../../services.ts';

const Property = Type.Object({ name: Type.String(), value: Type.String(), type: Type.Optional(Type.String()) });

const TemplateBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
  category: Type.Optional(Type.String({ maxLength: 60 })),
  titlePattern: Type.Optional(Type.String({ maxLength: 200 })),
  contentType: Type.Optional(Type.Union([Type.Literal('richtext'), Type.Literal('markdown'), Type.Literal('code')])),
  content: Type.String(),
  labels: Type.Optional(Type.Array(Type.String())),
  properties: Type.Optional(Type.Array(Property)),
  spaceKey: Type.Optional(Nullable(Type.String())),
});

export async function templateRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Vorlagen'];

  app.get(
    '/api/v1/templates',
    {
      schema: {
        tags,
        summary: 'Vorlagen (global + Bereich)',
        querystring: Type.Object({
          space: Type.Optional(Type.String()),
          scope: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('global'), Type.Literal('space')])),
        }),
      },
    },
    async (req) => {
      const spaceId = req.query.space ? s.spaces.requireViewable(req.auth, req.query.space).id : undefined;
      return s.templates.list(req.auth, { spaceId, scope: req.query.scope });
    },
  );

  app.get('/api/v1/templates/:id', { schema: { tags, summary: 'Vorlage abrufen', params: IdParam } }, async (req) => s.templates.get(req.auth, req.params.id));

  app.post('/api/v1/templates', { schema: { tags, summary: 'Vorlage anlegen', body: TemplateBody } }, async (req) => {
    const { spaceKey, ...rest } = req.body;
    const spaceId = spaceKey ? s.spaces.requireByKey(spaceKey).id : null;
    return s.templates.create(req.auth, { ...rest, spaceId });
  });

  app.put('/api/v1/templates/:id', { schema: { tags, summary: 'Vorlage ändern', params: IdParam, body: Type.Partial(TemplateBody) } }, async (req) => {
    const { spaceKey: _ignored, ...rest } = req.body;
    return s.templates.update(req.auth, req.params.id, rest);
  });

  app.delete('/api/v1/templates/:id', { schema: { tags, summary: 'Vorlage löschen', params: IdParam } }, async (req) => {
    s.templates.delete(req.auth, req.params.id);
    return { ok: true };
  });
}
