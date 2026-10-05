import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import type { AudienceEntry } from './service.ts';
import { requestLocale } from '../../core/i18n.ts';

/** Lesebestätigungen für Pflichtdokumente. */
export async function readRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Lesebestätigungen'];

  app.get('/api/v1/pages/:id/read-requirement', { schema: { tags, summary: 'Anforderung und eigener Stand', params: IdParam } }, async (req) => s.reads.get(req.auth, req.params.id));

  app.put(
    '/api/v1/pages/:id/read-requirement',
    {
      schema: {
        tags,
        summary: 'Lesebestätigung anfordern bzw. ändern (Bereichsverwaltung)',
        params: IdParam,
        body: Type.Object({
          audience: Type.Array(
            Type.Object({ type: Type.Union([Type.Literal('group'), Type.Literal('user'), Type.Literal('space')]), id: Type.Integer({ minimum: 0 }) }),
            { minItems: 1, maxItems: 200 },
          ),
          statement: Type.Optional(Type.String({ maxLength: 500 })),
          dueDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
          reconfirmOnChange: Type.Optional(Type.Boolean()),
          repeatMonths: Type.Optional(Type.Integer({ minimum: 0, maximum: 60 })),
          restart: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.reads.set(req.auth, req.params.id, { ...req.body, audience: req.body.audience as AudienceEntry[] });
    },
  );

  app.delete('/api/v1/pages/:id/read-requirement', { schema: { tags, summary: 'Anforderung entfernen (Nachweise bleiben erhalten)', params: IdParam } }, async (req) => {
    requireUser(req);
    s.reads.remove(req.auth, req.params.id);
    return { ok: true };
  });

  app.post('/api/v1/pages/:id/read-confirmations', { schema: { tags, summary: '„Gelesen und verstanden“ bestätigen', params: IdParam } }, async (req) => {
    requireUser(req);
    return s.reads.confirm(req.auth, req.params.id);
  });

  app.get(
    '/api/v1/pages/:id/read-confirmations',
    { schema: { tags, summary: 'Nachweisliste (Bereichsverwaltung); format=csv für den Export', params: IdParam, querystring: Type.Object({ format: Type.Optional(Type.Literal('csv')) }) } },
    async (req, reply) => {
      requireUser(req);
      if (req.query.format === 'csv') {
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="lesebestaetigungen-${req.params.id}.csv"`);
        return s.reads.evidenceCsv(req.auth, req.params.id, requestLocale(req, s.settings.get('defaultLocale')));
      }
      return s.reads.evidence(req.auth, req.params.id);
    },
  );

  app.post('/api/v1/pages/:id/read-reminders', { schema: { tags, summary: 'Offene Personen jetzt erinnern', params: IdParam } }, async (req) => {
    requireUser(req);
    return s.reads.remindNow(req.auth, req.params.id);
  });

  app.get('/api/v1/me/read-requirements', { schema: { tags, summary: 'Eigene Pflichtdokumente' } }, async (req) => {
    requireUser(req);
    return { items: s.reads.mine(req.auth) };
  });

  app.get('/api/v1/read-requirements', { schema: { tags, summary: 'Anforderungen in verwalteten Bereichen mit Fortschritt' } }, async (req) => {
    requireUser(req);
    return { items: s.reads.managed(req.auth) };
  });
}
