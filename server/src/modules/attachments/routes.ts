import fs from 'node:fs';
import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import { badRequest } from '../../core/errors.ts';
import { uploadError } from '../../core/archive-entries.ts';

export async function attachmentRoutes(app: App, s: Services): Promise<void> {
  app.get(
    '/api/v1/pages/:id/attachments',
    { schema: { tags: ['Anhänge'], summary: 'Anhänge der Seite', params: IdParam, querystring: Type.Object({ deleted: Type.Optional(Type.Boolean()) }) } },
    async (req) => s.attachments.list(req.auth, req.params.id, { includeDeleted: req.query.deleted }),
  );

  app.post(
    '/api/v1/pages/:id/attachments',
    { schema: { tags: ['Anhänge'], summary: 'Dateien hochladen (multipart/form-data)', params: IdParam } },
    async (req) => {
      requireUser(req);
      const results = [];
      let comment = '';
      try {
        for await (const part of req.parts()) {
          if (part.type === 'field' && part.fieldname === 'comment') comment = String(part.value ?? '');
          if (part.type === 'file') {
            results.push(await s.attachments.upload(req.auth, req.params.id, { filename: part.filename, mimetype: part.mimetype, stream: part.file }, comment));
          }
        }
      } catch (err) {
        throw uploadError(err);
      }
      if (!results.length) throw badRequest('Keine Datei übermittelt');
      return results;
    },
  );

  app.get(
    '/api/v1/attachments/:id/preview',
    {
      schema: {
        tags: ['Anhänge'],
        summary: 'PDF-Vorschau (PDF direkt, Office-Dateien über LibreOffice umgewandelt)',
        params: IdParam,
      },
    },
    async (req, reply) => {
      const { file, filename } = await s.previews.pdfFor(req.auth, req.params.id);
      const encoded = encodeURIComponent(filename);
      reply
        .header('Content-Type', 'application/pdf')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, max-age=3600')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Content-Disposition', `inline; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encoded}`);
      return reply.send(fs.createReadStream(file));
    },
  );

  app.get(
    '/api/v1/attachments/:id/raw',
    { schema: { tags: ['Anhänge'], summary: 'Datei herunterladen/anzeigen', params: IdParam, querystring: Type.Object({ download: Type.Optional(Type.Boolean()) }) } },
    async (req, reply) => s.attachments.serve(req.auth, req.params.id, reply, !!req.query.download),
  );

  app.delete('/api/v1/attachments/:id', { schema: { tags: ['Anhänge'], summary: 'Anhang löschen (alle Versionen)', params: IdParam } }, async (req) => {
    s.attachments.delete(req.auth, req.params.id);
    return { ok: true };
  });

  app.post('/api/v1/attachments/:id/restore', { schema: { tags: ['Anhänge'], summary: 'Anhang wiederherstellen', params: IdParam } }, async (req) => {
    s.attachments.restore(req.auth, req.params.id);
    return { ok: true };
  });
}
