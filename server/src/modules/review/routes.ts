import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, Nullable, requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';

/** Redaktionsprüfung und Wiederherstellung der letzten Änderungen. */
export async function reviewRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Prüfung'];

  app.get(
    '/api/v1/reviews',
    {
      schema: {
        tags,
        summary: 'Prüfaufträge (Standard: offene, die ich entscheiden darf)',
        querystring: Type.Object({
          status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('approved'), Type.Literal('rejected'), Type.Literal('cancelled')])),
          space: Type.Optional(Type.String()),
          mine: Type.Optional(Type.Boolean()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      const items = s.reviews.list(req.auth, {
        status: req.query.status,
        spaceKey: req.query.space,
        mine: req.query.mine,
        limit: req.query.limit,
      });
      return { items, total: items.length };
    },
  );

  app.get(
    '/api/v1/pages/:id/reviews',
    { schema: { tags, summary: 'Prüfaufträge einer Seite', params: IdParam } },
    async (req) => ({ items: s.reviews.forPage(req.auth, req.params.id) }),
  );

  app.post(
    '/api/v1/pages/:id/reviews',
    {
      schema: {
        tags,
        summary: 'Prüfung anfordern',
        params: IdParam,
        body: Type.Object({
          reviewerId: Type.Optional(Nullable(Type.Integer())),
          note: Type.Optional(Type.String({ maxLength: 2000 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.reviews.request(req.auth, req.params.id, req.body);
    },
  );

  app.post(
    '/api/v1/reviews/:id/decision',
    {
      schema: {
        tags,
        summary: 'Prüfauftrag freigeben oder zurückweisen',
        params: IdParam,
        body: Type.Object({ approve: Type.Boolean(), note: Type.Optional(Type.String({ maxLength: 2000 })) }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.reviews.decide(req.auth, req.params.id, req.body.approve, req.body.note ?? '');
    },
  );

  app.delete('/api/v1/reviews/:id', { schema: { tags, summary: 'Prüfauftrag zurückziehen', params: IdParam } }, async (req) => {
    requireUser(req);
    return s.reviews.cancel(req.auth, req.params.id);
  });

  /* ----------------------- Letzte Änderungen wiederherstellen ----------------------- */

  app.get(
    '/api/v1/changes',
    {
      schema: {
        tags: ['Änderungsprotokoll'],
        summary: 'Letzte Änderungen mit Wiederherstellungspunkt (Standard: 50)',
        querystring: Type.Object({
          space: Type.Optional(Type.String()),
          page: Type.Optional(Type.Integer()),
          user: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.revisions.recentChanges(req.auth, {
        spaceKey: req.query.space,
        pageId: req.query.page,
        username: req.query.user,
        limit: req.query.limit ?? 50,
      });
    },
  );

  app.post(
    '/api/v1/changes/:id/undo',
    {
      schema: {
        tags: ['Änderungsprotokoll'],
        summary: 'Eine Änderung rückgängig machen (stellt den Stand davor wieder her)',
        params: IdParam,
      },
    },
    async (req) => {
      requireUser(req);
      return s.revisions.undoChange(req.auth, req.params.id);
    },
  );

  /* ------------------------------ Mehrstufige Freigaben ------------------------------ */

  const Approver = Type.Object({ type: Type.Union([Type.Literal('group'), Type.Literal('user')]), id: Type.Integer() });
  const StageBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 60 }),
    approvers: Type.Array(Approver, { maxItems: 50 }),
    minApprovals: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    escalateDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 60 })),
  });

  app.get('/api/v1/spaces/:key/approval-workflow', { schema: { tags, summary: 'Freigabeablauf des Bereichs', params: Type.Object({ key: Type.String() }) } }, async (req) =>
    s.approvals.get(req.auth, req.params.key),
  );

  app.put(
    '/api/v1/spaces/:key/approval-workflow',
    {
      schema: {
        tags,
        summary: 'Freigabeablauf festlegen (Bereichsverwaltung)',
        params: Type.Object({ key: Type.String() }),
        body: Type.Object({ enabled: Type.Boolean(), stages: Type.Array(StageBody, { maxItems: 6 }), distinctApprovers: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.approvals.set(req.auth, req.params.key, {
        enabled: req.body.enabled,
        distinctApprovers: req.body.distinctApprovers,
        stages: req.body.stages.map((st) => ({ name: st.name, approvers: st.approvers as { type: 'group' | 'user'; id: number }[], minApprovals: st.minApprovals ?? 1, escalateDays: st.escalateDays ?? 0 })),
      });
    },
  );

  /* ------------------------------ Vertretungen ------------------------------ */

  const DeputyBody = Type.Object({
    deputyId: Type.Integer(),
    startsOn: Type.String({ maxLength: 10 }),
    endsOn: Type.String({ maxLength: 10 }),
    note: Type.Optional(Type.String({ maxLength: 300 })),
  });

  app.get('/api/v1/me/deputies', { schema: { tags: ['Profil'], summary: 'Eigene Abwesenheiten mit Vertretung und übernommene Vertretungen' } }, async (req) => {
    requireUser(req);
    return s.approvals.listDeputies(req.auth);
  });

  app.post('/api/v1/me/deputies', { schema: { tags: ['Profil'], summary: 'Abwesenheit mit Vertretung eintragen', body: DeputyBody } }, async (req) => {
    requireUser(req);
    return s.approvals.setDeputy(req.auth, req.body);
  });

  app.delete('/api/v1/me/deputies/:id', { schema: { tags: ['Profil'], summary: 'Vertretung entfernen', params: IdParam } }, async (req) => {
    requireUser(req);
    s.approvals.removeDeputy(req.auth, req.params.id);
    return { ok: true };
  });

  app.get('/api/v1/admin/users/:id/deputies', { schema: { tags: ['Administration'], summary: 'Vertretungen einer Person', params: IdParam } }, async (req) => {
    requireUser(req);
    return s.approvals.listDeputies(req.auth, req.params.id);
  });

  app.post('/api/v1/admin/users/:id/deputies', { schema: { tags: ['Administration'], summary: 'Vertretung für eine Person eintragen', params: IdParam, body: DeputyBody } }, async (req) => {
    requireUser(req);
    return s.approvals.setDeputy(req.auth, { ...req.body, userId: req.params.id });
  });
}
