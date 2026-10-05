import Type from 'typebox';
import type { FastifyRequest } from 'fastify';
import type { App } from '../../http.ts';
import { IdParam } from '../../http.ts';
import type { Services } from '../../services.ts';
import { unauthorized } from '../../core/errors.ts';
import { validateExportTemplate } from './template.ts';
import { requestLocale } from '../../core/i18n.ts';

const Format = Type.Union([Type.Literal('pdf'), Type.Literal('docx')]);

/** Dokumente sind rechenintensiv: Begrenzung je Benutzer statt je IP (viele Nutzer hinter einem Proxy). */
const perUser = {
  rateLimit: {
    max: 40,
    timeWindow: '10 minutes',
    keyGenerator: (req: FastifyRequest) => (req.auth?.user ? `export:${req.auth.user.id}` : `export-ip:${req.ip}`),
  },
};

function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Export nach Word/PDF mit Firmenvorlage. */
export async function exportRoutes(app: App, s: Services): Promise<void> {
  app.get(
    '/api/v1/pages/:id/export/document',
    {
      config: perUser,
      schema: {
        tags: ['Export & Import'],
        summary: 'Seite als PDF oder Word-Dokument (Firmenvorlage)',
        description: 'Mit `children=true` werden alle sichtbaren Unterseiten als Kapitel angehängt (höchstens 300 Seiten).',
        params: IdParam,
        querystring: Type.Object({
          format: Format,
          children: Type.Optional(Type.Boolean()),
          cover: Type.Optional(Type.Boolean()),
          toc: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const out = await s.exporter.pageDocument(req.auth, req.params.id, req.query, requestLocale(req, s.settings.get('defaultLocale')));
      return reply.header('Content-Type', out.contentType).header('Content-Disposition', attachment(out.filename)).send(out.body);
    },
  );

  app.get('/api/v1/export/template', { schema: { tags: ['Export & Import'], summary: 'Voreinstellungen der Firmenvorlage' } }, async (req) => {
    if (!req.auth.user && !s.settings.get('anonymousAccess')) throw unauthorized();
    const tpl = s.exporter.template();
    return { company: tpl.company, coverPage: tpl.coverPage, toc: tpl.toc, hasLogo: !!tpl.logo };
  });

  app.post(
    '/api/v1/admin/export-template/sample',
    {
      config: perUser,
      schema: {
        tags: ['Administration'],
        summary: 'Musterdokument mit (ungespeicherter) Vorlage erzeugen',
        body: Type.Object({ format: Format, template: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }),
      },
    },
    async (req, reply) => {
      s.perms.requireGlobal(req.auth, 'admin');
      const template = validateExportTemplate({ ...s.exporter.template(), ...(req.body.template ?? {}) });
      const out = await s.exporter.sample(req.auth, req.body.format, template);
      return reply.header('Content-Type', out.contentType).header('Content-Disposition', attachment(out.filename)).send(out.body);
    },
  );
}
