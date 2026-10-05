import Type from 'typebox';
import type { App } from '../../http.ts';
import { requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import type { DismissKind } from './service.ts';
import { requestLocale } from '../../core/i18n.ts';

const Query = Type.Object({
  space: Type.Optional(Type.String({ maxLength: 40 })),
  days: Type.Optional(Type.Integer({ minimum: 7, maximum: 365 })),
});

/** Inhaltsanalyse: Arbeitsliste für die Redaktion. */
export async function analyticsRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Inhaltsanalyse'];

  app.get('/api/v1/analytics', { schema: { tags, summary: 'Auswertung (meistgelesen, ungelesen, Suchbegriffe ohne Treffer, verwaist, defekte Verweise)', querystring: Query } }, async (req) => {
    requireUser(req);
    return s.analytics.report(req.auth, { spaceKey: req.query.space, days: req.query.days });
  });

  app.get('/api/v1/analytics/spaces', { schema: { tags, summary: 'Auswertbare Bereiche' } }, async (req) => {
    requireUser(req);
    return { items: s.analytics.spaces(req.auth).map((sp) => ({ key: sp.key, name: sp.name })), canSeeSearches: s.analytics.canSeeSearches(req.auth) };
  });

  app.get(
    '/api/v1/analytics/export/:list',
    {
      schema: {
        tags,
        summary: 'Liste als CSV',
        params: Type.Object({ list: Type.Union([Type.Literal('top'), Type.Literal('unread'), Type.Literal('searches'), Type.Literal('orphans'), Type.Literal('links')]) }),
        querystring: Query,
      },
    },
    async (req, reply) => {
      requireUser(req);
      const csv = s.analytics.csv(req.auth, req.params.list, { spaceKey: req.query.space, days: req.query.days }, requestLocale(req, s.settings.get('defaultLocale')));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="inhaltsanalyse-${req.params.list}.csv"`);
      return csv;
    },
  );

  app.put(
    '/api/v1/analytics/dismissed',
    {
      schema: {
        tags,
        summary: 'Eintrag als erledigt markieren oder wieder aufnehmen',
        body: Type.Object({
          kind: Type.Union([Type.Literal('search'), Type.Literal('orphan'), Type.Literal('link'), Type.Literal('unread')]),
          item: Type.String({ minLength: 1, maxLength: 200 }),
          dismissed: Type.Boolean(),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      s.analytics.dismiss(req.auth, req.body.kind as DismissKind, req.body.item, req.body.dismissed);
      return { ok: true };
    },
  );
}
