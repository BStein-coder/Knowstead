import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam } from '../../http.ts';
import { KeyParam, Nullable, requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import { badRequest } from '../../core/errors.ts';
import { receiveUploads } from '../../core/archive-entries.ts';

const Grant = Type.Object({
  subjectType: Type.Union([Type.Literal('user'), Type.Literal('group'), Type.Literal('authenticated'), Type.Literal('anonymous')]),
  subjectId: Type.Integer({ minimum: 0 }),
  role: Type.Union([Type.Literal('viewer'), Type.Literal('commenter'), Type.Literal('editor'), Type.Literal('admin')]),
});

export async function spaceRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Bereiche'];

  app.get(
    '/api/v1/spaces',
    {
      schema: {
        tags,
        summary: 'Bereiche auflisten',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 100 })),
          archived: Type.Optional(Type.Boolean()),
          kind: Type.Optional(Type.Union([Type.Literal('team'), Type.Literal('personal')])),
        }),
      },
    },
    async (req) => s.spaces.list(req.auth, { q: req.query.q, includeArchived: req.query.archived, kind: req.query.kind }),
  );

  app.post(
    '/api/v1/spaces',
    {
      schema: {
        tags,
        summary: 'Bereich anlegen',
        body: Type.Object({
          key: Type.String({ minLength: 2, maxLength: 20 }),
          name: Type.String({ minLength: 1, maxLength: 100 }),
          description: Type.Optional(Type.String({ maxLength: 1000 })),
          icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
          color: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
          preset: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('readonly'), Type.Literal('private')])),
          category: Type.Optional(Type.String({ maxLength: 60 })),
          reviewRequired: Type.Optional(Type.Boolean()),
          defaultEditMode: Type.Optional(Type.Union([Type.Literal('direct'), Type.Literal('suggest')])),
        }),
      },
    },
    async (req) => s.spaces.toDto(req.auth, await s.spaces.create(req.auth, req.body), { counts: true }),
  );

  /* ------------------------------ Kategorien ------------------------------ */

  const categoryTags = ['Bereiche'];
  const CategoryBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 60 }),
    icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
    description: Type.Optional(Type.String({ maxLength: 300 })),
  });

  app.get('/api/v1/space-categories', { schema: { tags: categoryTags, summary: 'Kategorien für Bereiche (sortiert)' } }, async (req) => s.categories.list(req.auth));

  app.post('/api/v1/admin/space-categories', { schema: { tags: categoryTags, summary: 'Kategorie anlegen', body: CategoryBody } }, async (req) =>
    s.categories.create(req.auth, req.body),
  );

  app.put(
    '/api/v1/admin/space-categories/order',
    { schema: { tags: categoryTags, summary: 'Reihenfolge der Kategorien festlegen', body: Type.Object({ ids: Type.Array(Type.Integer(), { maxItems: 500 }) }) } },
    async (req) => s.categories.reorder(req.auth, req.body.ids),
  );

  app.patch(
    '/api/v1/admin/space-categories/:id',
    { schema: { tags: categoryTags, summary: 'Kategorie umbenennen oder ändern', params: IdParam, body: Type.Partial(CategoryBody) } },
    async (req) => s.categories.update(req.auth, req.params.id, req.body),
  );

  app.delete('/api/v1/admin/space-categories/:id', { schema: { tags: categoryTags, summary: 'Kategorie entfernen (Bereiche bleiben erhalten)', params: IdParam } }, async (req) =>
    s.categories.delete(req.auth, req.params.id),
  );

  app.get('/api/v1/spaces/:key', { schema: { tags, summary: 'Bereich abrufen', params: KeyParam } }, async (req) =>
    s.spaces.toDto(req.auth, s.spaces.requireViewable(req.auth, req.params.key), { counts: true }),
  );

  app.patch(
    '/api/v1/spaces/:key',
    {
      schema: {
        tags,
        summary: 'Bereich ändern',
        params: KeyParam,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          description: Type.Optional(Type.String({ maxLength: 1000 })),
          icon: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
          color: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
          homePageId: Type.Optional(Nullable(Type.Integer())),
          category: Type.Optional(Type.String({ maxLength: 60 })),
          reviewRequired: Type.Optional(Type.Boolean()),
          defaultEditMode: Type.Optional(Type.Union([Type.Literal('direct'), Type.Literal('suggest')])),
        }),
      },
    },
    async (req) => s.spaces.toDto(req.auth, s.spaces.update(req.auth, req.params.key, req.body), { counts: true }),
  );

  app.delete(
    '/api/v1/spaces/:key',
    { schema: { tags, summary: 'Bereich endgültig löschen', params: KeyParam, querystring: Type.Object({ confirm: Type.String() }) } },
    async (req) => {
      if (req.query.confirm.toUpperCase() !== req.params.key.toUpperCase()) throw badRequest('Zur Bestätigung den Bereichsschlüssel angeben');
      const space = s.spaces.requireByKey(req.params.key);
      s.perms.requireSpace(req.auth, space, 'admin');
      // Sicherheitsnetz: Datenbank-Snapshot vor dem endgültigen Löschen (Dateien bleiben 30 Tage liegen)
      const backup = await s.backups.create(req.auth, 'vor-loeschung', { suffix: 'loeschung', includeUploads: false });
      s.spaces.delete(req.auth, req.params.key);
      return { ok: true, backup: backup.name };
    },
  );

  app.post(
    '/api/v1/spaces/:key/archive',
    { schema: { tags, summary: 'Bereich archivieren/reaktivieren', params: KeyParam, body: Type.Object({ archived: Type.Boolean() }) } },
    async (req) => s.spaces.toDto(req.auth, s.spaces.setArchived(req.auth, req.params.key, req.body.archived)),
  );

  app.get('/api/v1/spaces/:key/tree', { schema: { tags, summary: 'Seitenbaum (flach, sortiert)', params: KeyParam } }, async (req) => {
    const space = s.spaces.requireViewable(req.auth, req.params.key);
    return s.pages.tree(req.auth, space);
  });

  app.get('/api/v1/spaces/:key/permissions', { schema: { tags, summary: 'Berechtigungen des Bereichs', params: KeyParam } }, async (req) =>
    s.spaces.grants(req.auth, req.params.key),
  );

  app.put(
    '/api/v1/spaces/:key/permissions',
    { schema: { tags, summary: 'Berechtigungen setzen (ersetzt alle)', params: KeyParam, body: Type.Object({ grants: Type.Array(Grant) }) } },
    async (req) => s.spaces.setGrants(req.auth, req.params.key, req.body.grants),
  );

  app.get('/api/v1/spaces/:key/members', { schema: { tags, summary: 'Effektive Mitglieder', params: KeyParam } }, async (req) =>
    s.spaces.members(req.auth, req.params.key),
  );

  app.get('/api/v1/spaces/:key/restricted-pages', { schema: { tags, summary: 'Eingeschränkte Seiten', params: KeyParam } }, async (req) =>
    s.restrictions.restrictedPages(req.auth, s.spaces.requireByKey(req.params.key)),
  );

  app.get('/api/v1/spaces/:key/trash', { schema: { tags, summary: 'Papierkorb', params: KeyParam } }, async (req) =>
    s.trash.list(req.auth, s.spaces.requireViewable(req.auth, req.params.key)),
  );

  app.delete('/api/v1/spaces/:key/trash', { schema: { tags, summary: 'Papierkorb leeren', params: KeyParam } }, async (req) => ({
    purged: s.trash.empty(req.auth, s.spaces.requireViewable(req.auth, req.params.key)),
  }));

  app.get(
    '/api/v1/spaces/:key/changelog',
    {
      schema: {
        tags: ['Änderungsprotokoll'],
        summary: 'Änderungsprotokoll des Bereichs (JSON oder Markdown)',
        params: KeyParam,
        querystring: Type.Object({
          from: Type.Optional(Type.String()),
          to: Type.Optional(Type.String()),
          minor: Type.Optional(Type.Boolean()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
          pageId: Type.Optional(Type.Integer()),
          format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('md')])),
        }),
      },
    },
    async (req, reply) => {
      const space = s.spaces.requireViewable(req.auth, req.params.key);
      const opts = { from: req.query.from, to: req.query.to, includeMinor: req.query.minor, limit: req.query.limit, pageId: req.query.pageId };
      if (req.query.format === 'md') {
        reply
          .header('Content-Type', 'text/markdown; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="aenderungsprotokoll-${space.key}.md"`);
        return s.activity.changelogMarkdown(req.auth, space, opts);
      }
      return s.activity.changelog(req.auth, space, opts);
    },
  );

  app.get(
    '/api/v1/spaces/:key/activity',
    {
      schema: {
        tags: ['Aktivität'],
        summary: 'Aktivitäten im Bereich',
        params: KeyParam,
        querystring: Type.Object({ before: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
      },
    },
    async (req) => {
      const space = s.spaces.requireViewable(req.auth, req.params.key);
      return s.activity.feed(req.auth, { spaceId: space.id, before: req.query.before, limit: req.query.limit });
    },
  );

  app.get('/api/v1/spaces/:key/labels', { schema: { tags, summary: 'Stichwörter im Bereich', params: KeyParam } }, async (req) => {
    const space = s.spaces.requireViewable(req.auth, req.params.key);
    return s.labels.allLabels(req.auth, { spaceId: space.id });
  });

  app.post(
    '/api/v1/spaces/:key/watch',
    { schema: { tags, summary: 'Bereich beobachten', params: KeyParam, body: Type.Object({ on: Type.Boolean() }) } },
    async (req) => {
      const space = s.spaces.requireViewable(req.auth, req.params.key);
      return { watching: s.social.watch(req.auth, 'space', space.id, req.body.on) };
    },
  );

  app.get(
    '/api/v1/spaces/:key/export',
    {
      schema: {
        tags: ['Export & Import'],
        summary: 'Bereich als ZIP exportieren',
        params: KeyParam,
        querystring: Type.Object({
          format: Type.Union([Type.Literal('markdown'), Type.Literal('html'), Type.Literal('json')]),
          root: Type.Optional(Type.Integer()),
        }),
      },
    },
    async (req, reply) => {
      const { filename, stream } = s.transfer.spaceExport(req.auth, req.params.key, req.query.format, req.query.root);
      reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return reply.send(stream);
    },
  );

  app.post(
    '/api/v1/spaces/:key/import',
    { schema: { tags: ['Export & Import'], summary: 'Markdown/HTML/ZIP importieren (multipart, Feld „parentId“ optional)', params: KeyParam } },
    async (req) => {
      requireUser(req);
      const space = s.spaces.requireViewable(req.auth, req.params.key);
      // Das Recht vor dem Hochladen prüfen: Sonst könnte jede angemeldete Person Gigabytes auf die Platte des Servers schicken
      s.perms.requireSpace(req.auth, space, 'create');
      // Dateien liegen als Zwischendateien auf der Platte, nicht im Arbeitsspeicher
      const upload = await receiveUploads(req, s.config.dataDir);
      try {
        if (!upload.files.length) throw badRequest('Keine Dateien übermittelt');
        return await s.transfer.importFiles(req.auth, space, Number(upload.fields.get('parentId')) || null, upload.files);
      } finally {
        upload.cleanup();
      }
    },
  );

  app.post(
    '/api/v1/spaces/:key/import/wiki',
    {
      schema: {
        tags: ['Export & Import'],
        summary: 'MediaWiki, DokuWiki oder XWiki importieren (Hintergrundauftrag)',
        description:
          'multipart: file (MediaWiki-XML oder ZIP mit XML und Dateien, DokuWiki-Datenordner als ZIP, XWiki-XAR), ' +
          'format (auto|mediawiki|dokuwiki|xwiki), parentId, history (true = Versionsgeschichte übernehmen). ' +
          'Antwort 202 mit Auftrag – Fortschritt über GET /api/v1/imports/{id}.',
        params: KeyParam,
      },
    },
    async (req, reply) => {
      requireUser(req);
      const space = s.spaces.requireViewable(req.auth, req.params.key);
      s.perms.requireSpace(req.auth, space, 'create');
      // Das Archiv wird auf die Platte geschrieben und von dort stückweise gelesen – der Auftrag räumt es weg
      const upload = await receiveUploads(req, s.config.dataDir);
      try {
        const format = upload.fields.get('format') ?? 'auto';
        if (!upload.files.length) throw badRequest('Keine Datei übermittelt');
        if (!['auto', 'mediawiki', 'dokuwiki', 'xwiki', 'confluence'].includes(format)) throw badRequest('Unbekanntes Format');
        const job = s.imports.start(req.auth, space, upload, {
          format: format as 'auto',
          parentId: Number(upload.fields.get('parentId')) || null,
          history: upload.fields.get('history') === 'true',
        });
        return reply.status(202).send(job);
      } catch (err) {
        upload.cleanup();
        throw err;
      }
    },
  );

  app.get(
    '/api/v1/imports/:id',
    { schema: { tags: ['Export & Import'], summary: 'Fortschritt eines Imports', params: Type.Object({ id: Type.String({ maxLength: 64 }) }) } },
    async (req) => s.imports.get(req.auth, req.params.id),
  );

  app.post(
    '/api/v1/spaces/import-archive',
    { schema: { tags: ['Export & Import'], summary: 'Neuen Bereich aus Knowstead-Archiv anlegen (multipart: file, key, name)' } },
    async (req) => {
      requireUser(req);
      s.perms.requireGlobal(req.auth, 'spaces.create');
      const upload = await receiveUploads(req, s.config.dataDir);
      try {
        const file = upload.files[0];
        if (!file) throw badRequest('Keine Datei übermittelt');
        const result = await s.transfer.importAsNewSpace(req.auth, file, { key: upload.fields.get('key') ?? '', name: upload.fields.get('name') ?? '' });
        return { space: s.spaces.toDto(req.auth, result.space), pages: result.pages };
      } finally {
        upload.cleanup();
      }
    },
  );
}
