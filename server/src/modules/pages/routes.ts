import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, Nullable, requireUser, Offset } from '../../http.ts';
import type { Services } from '../../services.ts';
import { badRequest } from '../../core/errors.ts';
import { markdownToHtml } from '../../core/markdown.ts';

const ContentType = Type.Union([Type.Literal('richtext'), Type.Literal('markdown'), Type.Literal('code')]);
const Property = Type.Object({ name: Type.String({ minLength: 1, maxLength: 60 }), value: Type.String({ maxLength: 2000 }), type: Type.Optional(Type.String()) });
const Subject = Type.Object({ type: Type.Union([Type.Literal('user'), Type.Literal('group')]), id: Type.Integer({ minimum: 1 }) });

export async function pageRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Seiten'];

  app.post(
    '/api/v1/pages',
    {
      schema: {
        tags,
        summary: 'Seite anlegen (status "draft" erzeugt einen Entwurf)',
        body: Type.Object({
          spaceKey: Type.Optional(Type.String()),
          spaceId: Type.Optional(Type.Integer()),
          parentId: Type.Optional(Nullable(Type.Integer())),
          title: Type.Optional(Type.String({ maxLength: 255 })),
          content: Type.Optional(Type.String()),
          format: Type.Optional(Type.Union([Type.Literal('html'), Type.Literal('markdown')])),
          contentType: Type.Optional(ContentType),
          language: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
          icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
          templateId: Type.Optional(Nullable(Type.Integer())),
          status: Type.Optional(Type.Union([Type.Literal('draft'), Type.Literal('current')])),
          labels: Type.Optional(Type.Array(Type.String({ maxLength: 50 }))),
          properties: Type.Optional(Type.Array(Property)),
          changeNote: Type.Optional(Type.String({ maxLength: 500 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      const b = req.body;
      const space = b.spaceKey ? s.spaces.requireByKey(b.spaceKey) : b.spaceId ? s.spaces.require(b.spaceId) : null;
      if (!space) throw badRequest('spaceKey oder spaceId ist erforderlich');
      const content = b.format === 'markdown' && b.content !== undefined && (b.contentType ?? 'richtext') === 'richtext' ? markdownToHtml(b.content) : b.content;
      const page = await s.pages.create(req.auth, {
        spaceId: space.id,
        parentId: b.parentId ?? null,
        title: b.title ?? '',
        content,
        contentType: b.contentType,
        language: b.language,
        icon: b.icon,
        templateId: b.templateId,
        status: b.status,
        labels: b.labels,
        properties: b.properties,
        changeNote: b.changeNote,
      });
      return s.pages.dto(req.auth, page, space);
    },
  );

  app.get(
    '/api/v1/pages/:id',
    {
      schema: {
        tags,
        summary: 'Seite abrufen (render=true liefert zusätzlich Anzeige-HTML)',
        params: IdParam,
        querystring: Type.Object({ render: Type.Optional(Type.Boolean()), view: Type.Optional(Type.Boolean()), deleted: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      const { page, space } = s.pages.requireViewable(req.auth, req.params.id, { includeDeleted: req.query.deleted });
      // Seiten im Papierkorb sieht nur, wer dort auch wiederherstellen darf
      if (page.deleted_at) s.perms.requireSpace(req.auth, space, 'delete');
      if (req.query.view && page.status === 'current') s.pages.recordView(req.auth, page.id);
      const dto = await s.pages.dto(req.auth, page, space, { render: req.query.render });
      return { ...dto, presence: s.realtime.presenceOf(page.id).map((p) => ({ ...p.user, mode: p.mode })) };
    },
  );

  app.get(
    '/api/v1/pages/find',
    {
      schema: {
        tags,
        summary: 'Seite über Bereich und Titel finden (für Integrationen)',
        querystring: Type.Object({ space: Type.String(), title: Type.String() }),
      },
    },
    async (req) => {
      const space = s.spaces.requireViewable(req.auth, req.query.space);
      const row = s.db.get<{ id: number }>(
        "SELECT id FROM pages WHERE space_id = ? AND title = ? COLLATE NOCASE AND deleted_at IS NULL AND status = 'current' LIMIT 1",
        space.id,
        req.query.title,
      );
      if (!row) return { page: null };
      const { page } = s.pages.requireViewable(req.auth, row.id);
      return { page: await s.pages.dto(req.auth, page, space) };
    },
  );

  app.put(
    '/api/v1/pages/:id',
    {
      schema: {
        tags,
        summary: 'Neue Version veröffentlichen (baseVersion für Konflikterkennung)',
        params: IdParam,
        body: Type.Object({
          title: Type.Optional(Type.String({ maxLength: 255 })),
          content: Type.Optional(Type.String()),
          format: Type.Optional(Type.Union([Type.Literal('html'), Type.Literal('markdown')])),
          contentType: Type.Optional(ContentType),
          language: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
          icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
          fullWidth: Type.Optional(Type.Boolean()),
          changeNote: Type.Optional(Type.String({ maxLength: 500 })),
          minor: Type.Optional(Type.Boolean()),
          baseVersion: Type.Optional(Type.Integer({ minimum: 0 })),
          collab: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => {
      const b = req.body;
      const content = b.format === 'markdown' && b.content !== undefined && (b.contentType ?? 'richtext') === 'richtext' ? markdownToHtml(b.content) : b.content;
      const page = await s.pages.save(req.auth, req.params.id, { ...b, content });
      return s.pages.dto(req.auth, page, s.spaces.require(page.space_id));
    },
  );

  app.post(
    '/api/v1/pages/:id/append',
    {
      schema: {
        tags,
        summary: 'Inhalt an eine Seite anhängen (z. B. aus CI/CD für Changelogs)',
        params: IdParam,
        body: Type.Object({
          content: Type.String({ minLength: 1 }),
          format: Type.Optional(Type.Union([Type.Literal('html'), Type.Literal('markdown')])),
          position: Type.Optional(Type.Union([Type.Literal('start'), Type.Literal('end')])),
          changeNote: Type.Optional(Type.String({ maxLength: 500 })),
        }),
      },
    },
    async (req) => {
      const { page, space } = s.pages.requireAccess(req.auth, req.params.id, 'edit');
      const b = req.body;
      let fragment = b.format === 'markdown' ? markdownToHtml(b.content) : b.content;
      let content: string;
      if (page.content_type === 'richtext') content = b.position === 'start' ? fragment + page.content : page.content + fragment;
      else {
        fragment = b.content;
        content = b.position === 'start' ? `${fragment}\n\n${page.content}` : `${page.content}\n\n${fragment}`;
      }
      const updated = await s.pages.save(req.auth, page.id, { content, baseVersion: page.version, changeNote: b.changeNote ?? 'Inhalt ergänzt (API)' });
      return s.pages.dto(req.auth, updated, space);
    },
  );

  app.patch(
    '/api/v1/pages/:id/meta',
    {
      schema: {
        tags,
        summary: 'Symbol/Seitenbreite ändern (ohne neue Version)',
        params: IdParam,
        body: Type.Object({ icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))), fullWidth: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      const page = s.pages.updateMeta(req.auth, req.params.id, req.body);
      return { icon: page.icon, fullWidth: !!page.full_width };
    },
  );

  app.delete('/api/v1/pages/:id', { schema: { tags, summary: 'In den Papierkorb verschieben (inkl. Unterseiten)', params: IdParam } }, async (req) => ({
    deleted: s.trash.moveToTrash(req.auth, req.params.id),
  }));

  app.post('/api/v1/pages/:id/restore', { schema: { tags, summary: 'Aus dem Papierkorb wiederherstellen', params: IdParam } }, async (req) => {
    const page = s.trash.restore(req.auth, req.params.id);
    return { id: page.id, url: s.pages.url(page) };
  });

  app.delete('/api/v1/pages/:id/purge', { schema: { tags, summary: 'Endgültig löschen', params: IdParam } }, async (req) => {
    s.trash.purge(req.auth, req.params.id);
    return { ok: true };
  });

  app.post(
    '/api/v1/pages/:id/move',
    {
      schema: {
        tags,
        summary: 'Seite verschieben',
        params: IdParam,
        body: Type.Object({
          parentId: Nullable(Type.Integer()),
          spaceKey: Type.Optional(Type.String()),
          index: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
    },
    async (req) => {
      const spaceId = req.body.spaceKey ? s.spaces.requireByKey(req.body.spaceKey).id : undefined;
      const page = s.pages.move(req.auth, req.params.id, { parentId: req.body.parentId, spaceId, index: req.body.index });
      return { id: page.id, parentId: page.parent_id, spaceId: page.space_id, url: s.pages.url(page) };
    },
  );

  app.post(
    '/api/v1/pages/:id/copy',
    {
      schema: {
        tags,
        summary: 'Seite (optional mit Unterseiten) kopieren',
        params: IdParam,
        body: Type.Object({
          spaceKey: Type.Optional(Type.String()),
          parentId: Type.Optional(Nullable(Type.Integer())),
          title: Type.Optional(Type.String({ maxLength: 255 })),
          includeChildren: Type.Optional(Type.Boolean()),
          includeAttachments: Type.Optional(Type.Boolean()),
          includeLabels: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => {
      const spaceId = req.body.spaceKey ? s.spaces.requireByKey(req.body.spaceKey).id : undefined;
      const page = await s.pages.copy(req.auth, req.params.id, { ...req.body, spaceId });
      return { id: page.id, url: s.pages.url(page) };
    },
  );

  app.get(
    '/api/v1/pages/:id/children',
    {
      schema: {
        tags,
        summary: 'Unterseiten',
        params: IdParam,
        querystring: Type.Object({
          sort: Type.Optional(Type.Union([Type.Literal('position'), Type.Literal('title'), Type.Literal('updated'), Type.Literal('created')])),
          depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        }),
      },
    },
    async (req) => {
      const { page, space } = s.pages.requireViewable(req.auth, req.params.id);
      const parent = page.id === space.home_page_id ? null : page.id;
      const load = (parentId: number | null, depth: number): unknown[] =>
        s.pages.summaries(req.auth, s.pages.children(req.auth, parentId, space, { sort: req.query.sort })).map((sm) => ({
          ...sm,
          children: depth > 1 ? load(sm.id, depth - 1) : [],
        }));
      return load(parent, req.query.depth ?? 1);
    },
  );

  app.post(
    '/api/v1/pages/:id/duplicate',
    {
      schema: {
        tags,
        summary: 'Seite am selben Ort duplizieren (optional mit Unterseiten und Anhängen)',
        params: IdParam,
        body: Type.Object({
          includeChildren: Type.Optional(Type.Boolean()),
          includeAttachments: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => {
      const { page, space } = s.pages.requireViewable(req.auth, req.params.id);
      const copy = await s.pages.copy(req.auth, page.id, {
        spaceId: space.id,
        parentId: page.parent_id,
        title: `${page.title} (Kopie)`,
        includeChildren: req.body.includeChildren ?? false,
        includeAttachments: req.body.includeAttachments ?? true,
        includeLabels: true,
      });
      return s.pages.dto(req.auth, copy, space);
    },
  );

  /* ------------------------------ Entwürfe ------------------------------ */

  app.get('/api/v1/pages/:id/draft', { schema: { tags: ['Entwürfe'], summary: 'Eigenen Entwurf laden', params: IdParam } }, async (req) => ({
    draft: s.drafts.get(req.auth, req.params.id),
  }));

  app.put(
    '/api/v1/pages/:id/draft',
    {
      schema: {
        tags: ['Entwürfe'],
        summary: 'Entwurf automatisch speichern',
        params: IdParam,
        body: Type.Object({
          title: Type.String({ maxLength: 255 }),
          content: Type.String(),
          contentType: Type.Optional(ContentType),
          language: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
          baseVersion: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
    },
    async (req) => s.drafts.save(req.auth, req.params.id, req.body),
  );

  app.delete('/api/v1/pages/:id/draft', { schema: { tags: ['Entwürfe'], summary: 'Entwurf verwerfen', params: IdParam } }, async (req) => {
    s.drafts.discard(req.auth, req.params.id);
    return { ok: true };
  });

  /* ------------------------------ Vorschlagsmodus ------------------------------ */

  app.put(
    '/api/v1/pages/:id/edit-mode',
    {
      schema: {
        tags: ['Seiten'],
        summary: 'Bearbeitungsmodus: direkt oder nur Vorschläge (Autorin/Autor, Verantwortliche, Bereichsverwaltung)',
        params: IdParam,
        body: Type.Object({ mode: Type.Union([Type.Literal('direct'), Type.Literal('suggest')]), locked: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.suggestions.setMode(req.auth, req.params.id, req.body.mode, req.body.locked);
    },
  );

  app.get('/api/v1/pages/:id/suggestions', { schema: { tags: ['Seiten'], summary: 'Offene Änderungsvorschläge einer Seite', params: IdParam } }, async (req) => ({
    items: s.suggestions.list(req.auth, req.params.id),
  }));

  /* ------------------------------ Versionen ------------------------------ */

  app.get(
    '/api/v1/pages/:id/revisions',
    {
      schema: {
        tags: ['Versionen'],
        summary: 'Versionsgeschichte',
        params: IdParam,
        querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })), offset: Type.Optional(Offset) }),
      },
    },
    async (req) => s.revisions.list(req.auth, req.params.id, req.query),
  );

  app.get(
    '/api/v1/pages/:id/revisions/:version',
    { schema: { tags: ['Versionen'], summary: 'Bestimmte Version', params: Type.Object({ id: Type.Integer(), version: Type.Integer() }) } },
    async (req) => s.revisions.get(req.auth, req.params.id, req.params.version),
  );

  app.post(
    '/api/v1/pages/:id/revisions/:version/restore',
    { schema: { tags: ['Versionen'], summary: 'Version wiederherstellen', params: Type.Object({ id: Type.Integer(), version: Type.Integer() }) } },
    async (req) => {
      const page = await s.revisions.restore(req.auth, req.params.id, req.params.version);
      return { version: page.version };
    },
  );

  app.get(
    '/api/v1/pages/:id/diff',
    {
      schema: {
        tags: ['Versionen'],
        summary: 'Unterschiede zwischen zwei Versionen',
        params: IdParam,
        querystring: Type.Object({ from: Type.Integer({ minimum: 0 }), to: Type.Integer({ minimum: 0 }) }),
      },
    },
    async (req) => s.revisions.diff(req.auth, req.params.id, req.query.from, req.query.to),
  );

  /* ------------------------------ Wiedervorlage ------------------------------ */

  const cycleTags = ['Wiedervorlage'];

  app.post(
    '/api/v1/pages/:id/verify',
    { schema: { tags: cycleTags, summary: 'Seite als aktuell bestätigen (startet das Prüfintervall neu)', params: IdParam, body: Type.Object({ note: Type.Optional(Type.String({ maxLength: 500 })) }) } },
    async (req) => s.reviewCycle.verify(req.auth, req.params.id, { note: req.body.note }),
  );

  app.put(
    '/api/v1/pages/:id/review-cycle',
    {
      schema: {
        tags: cycleTags,
        summary: 'Verantwortliche Person und Prüfintervall festlegen',
        params: IdParam,
        body: Type.Object({
          ownerId: Type.Optional(Nullable(Type.Integer())),
          intervalMonths: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 36 }))),
        }),
      },
    },
    async (req) => s.reviewCycle.configure(req.auth, req.params.id, req.body),
  );

  app.get(
    '/api/v1/content-reviews',
    {
      schema: {
        tags: cycleTags,
        summary: 'Fällige und überfällige Seiten (Wiedervorlage)',
        querystring: Type.Object({
          scope: Type.Optional(Type.Union([Type.Literal('mine'), Type.Literal('all')])),
          space: Type.Optional(Type.String({ maxLength: 40 })),
          state: Type.Optional(Type.Union([Type.Literal('attention'), Type.Literal('overdue'), Type.Literal('due'), Type.Literal('all')])),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        }),
      },
    },
    async (req) => s.reviewCycle.overview(req.auth, req.query),
  );

  app.get('/api/v1/spaces/:key/review-cycle', { schema: { tags: cycleTags, summary: 'Wiedervorlage-Vorgabe des Bereichs', params: Type.Object({ key: Type.String() }) } }, async (req) =>
    s.reviewCycle.spaceSettings(req.auth, req.params.key),
  );

  app.put(
    '/api/v1/spaces/:key/review-cycle',
    {
      schema: {
        tags: cycleTags,
        summary: 'Wiedervorlage-Vorgabe des Bereichs ändern',
        params: Type.Object({ key: Type.String() }),
        body: Type.Object({
          intervalMonths: Type.Optional(Type.Integer({ minimum: 0, maximum: 36 })),
          boardId: Type.Optional(Nullable(Type.Integer())),
        }),
      },
    },
    async (req) => s.reviewCycle.configureSpace(req.auth, req.params.key, req.body),
  );

  /* ------------------------ Stichwörter & Eigenschaften ------------------------ */

  app.put(
    '/api/v1/pages/:id/labels',
    { schema: { tags: ['Stichwörter & Eigenschaften'], summary: 'Stichwörter setzen', params: IdParam, body: Type.Object({ labels: Type.Array(Type.String({ maxLength: 50 })) }) } },
    async (req) => ({ labels: s.labels.setLabels(req.auth, req.params.id, req.body.labels) }),
  );

  app.put(
    '/api/v1/pages/:id/properties',
    {
      schema: {
        tags: ['Stichwörter & Eigenschaften'],
        summary: 'Eigenschaften setzen (ersetzt alle)',
        params: IdParam,
        body: Type.Object({ properties: Type.Array(Property) }),
      },
    },
    async (req) => ({ properties: s.labels.setProperties(req.auth, req.params.id, req.body.properties) }),
  );

  /* ------------------------------ Einschränkungen ------------------------------ */

  app.get('/api/v1/pages/:id/restrictions', { schema: { tags: ['Berechtigungen'], summary: 'Seiteneinschränkungen', params: IdParam } }, async (req) =>
    s.restrictions.get(req.auth, req.params.id),
  );

  app.put(
    '/api/v1/pages/:id/restrictions',
    {
      schema: {
        tags: ['Berechtigungen'],
        summary: 'Seiteneinschränkungen setzen',
        params: IdParam,
        body: Type.Object({ view: Type.Array(Subject), edit: Type.Array(Subject) }),
      },
    },
    async (req) => s.restrictions.set(req.auth, req.params.id, req.body),
  );

  /* ------------------------------ Soziales ------------------------------ */

  app.post(
    '/api/v1/pages/:id/favorite',
    { schema: { tags, summary: 'Favorit setzen/entfernen', params: IdParam, body: Type.Object({ on: Type.Boolean() }) } },
    async (req) => ({ favorite: s.social.setFavorite(req.auth, req.params.id, req.body.on) }),
  );

  app.post(
    '/api/v1/pages/:id/watch',
    { schema: { tags, summary: 'Seite beobachten', params: IdParam, body: Type.Object({ on: Type.Boolean() }) } },
    async (req) => ({ watching: s.social.watch(req.auth, 'page', req.params.id, req.body.on) }),
  );

  app.get('/api/v1/pages/:id/backlinks', { schema: { tags, summary: 'Eingehende Verweise', params: IdParam } }, async (req) =>
    s.links.backlinks(req.auth, req.params.id),
  );
  app.get('/api/v1/pages/:id/links', { schema: { tags, summary: 'Ausgehende Verweise', params: IdParam } }, async (req) =>
    s.links.outgoing(req.auth, req.params.id),
  );
  app.get(
    '/api/v1/pages/:id/graph',
    { schema: { tags, summary: 'Link-Karte', params: IdParam, querystring: Type.Object({ depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })) }) } },
    async (req) => s.links.graph(req.auth, req.params.id, req.query.depth ?? 2),
  );

  app.get(
    '/api/v1/pages/:id/activity',
    { schema: { tags: ['Aktivität'], summary: 'Aktivitäten zur Seite', params: IdParam, querystring: Type.Object({ before: Type.Optional(Type.Integer()) }) } },
    async (req) => {
      s.pages.requireViewable(req.auth, req.params.id);
      return s.activity.feed(req.auth, { pageId: req.params.id, before: req.query.before, limit: 50 });
    },
  );

  app.post(
    '/api/v1/pages/:id/tasks',
    {
      schema: {
        tags,
        summary: 'Aufgabe in der Seite abhaken',
        params: IdParam,
        body: Type.Object({ index: Type.Integer({ minimum: 0 }), checked: Type.Boolean() }),
      },
    },
    async (req) => {
      const page = await s.pages.toggleTask(req.auth, req.params.id, req.body.index, req.body.checked);
      return { version: page.version, content: page.content };
    },
  );

  app.post(
    '/api/v1/pages/:id/presence',
    {
      schema: {
        tags,
        summary: 'Anwesenheit melden (view/edit/leave)',
        params: IdParam,
        body: Type.Object({ mode: Type.Union([Type.Literal('view'), Type.Literal('edit'), Type.Literal('leave')]) }),
      },
    },
    async (req) => {
      if (req.body.mode !== 'leave') s.pages.requireViewable(req.auth, req.params.id);
      return s.realtime.heartbeat(req.auth, req.params.id, req.body.mode).map((p) => ({ ...p.user, mode: p.mode }));
    },
  );

  app.get(
    '/api/v1/pages/:id/export',
    {
      schema: {
        tags: ['Export & Import'],
        summary: 'Seite exportieren',
        params: IdParam,
        querystring: Type.Object({ format: Type.Union([Type.Literal('md'), Type.Literal('html')]), inline: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req, reply) => {
      const out = await s.transfer.pageExport(req.auth, req.params.id, req.query.format);
      reply.header('Content-Type', out.contentType);
      // Eigenständiges HTML nie mit den Rechten der Anwendung ausführen (auch inline nicht)
      reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src data:; sandbox");
      if (!req.query.inline) reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
      return out.body;
    },
  );

  app.post(
    '/api/v1/pages/:id/save-as-template',
    {
      schema: {
        tags: ['Vorlagen'],
        summary: 'Seite als Vorlage speichern',
        params: IdParam,
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 100 }),
          description: Type.Optional(Type.String({ maxLength: 500 })),
          scope: Type.Union([Type.Literal('global'), Type.Literal('space')]),
        }),
      },
    },
    async (req) => s.templates.fromPage(req.auth, req.params.id, req.body),
  );

  /* ------------------------------ Makro-Daten ------------------------------ */

  app.get(
    '/api/v1/macros/recent-pages',
    {
      schema: {
        tags: ['Makros'],
        summary: 'Zuletzt geänderte Seiten',
        querystring: Type.Object({
          space: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          label: Type.Optional(Type.String()),
        }),
      },
    },
    async (req) => s.macros.recentPages(req.auth, { spaceKey: req.query.space, limit: req.query.limit, label: req.query.label }),
  );

  app.get(
    '/api/v1/macros/properties-report',
    {
      schema: {
        tags: ['Makros'],
        summary: 'Eigenschaften-Bericht',
        querystring: Type.Object({
          pageId: Type.Optional(Type.Integer()),
          scope: Type.Optional(Type.Union([Type.Literal('children'), Type.Literal('descendants'), Type.Literal('label')])),
          label: Type.Optional(Type.String()),
          space: Type.Optional(Type.String()),
          columns: Type.Optional(Type.String()),
        }),
      },
    },
    async (req) =>
      s.macros.propertiesReport(req.auth, {
        pageId: req.query.pageId,
        scope: req.query.scope,
        label: req.query.label,
        spaceKey: req.query.space,
        columns: req.query.columns?.split(',').map((c) => c.trim()).filter(Boolean),
      }),
  );

  app.post('/api/v1/journal/today', { schema: { tags: ['Journal'], summary: 'Tagesnotiz öffnen/anlegen', body: Type.Object({ date: Type.Optional(Type.String()) }) } }, async (req) => {
    requireUser(req);
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(date.getTime())) throw badRequest('Ungültiges Datum');
    const page = await s.journal.day(req.auth, date);
    return { id: page.id, url: s.pages.url(page) };
  });
}
