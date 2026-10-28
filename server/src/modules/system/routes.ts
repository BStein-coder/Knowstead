import fs from 'node:fs';
import path from 'node:path';
import Type from 'typebox';
import type { App } from '../../http.ts';
import { requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import { notFound } from '../../core/errors.ts';

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/** Systemnahe Endpunkte: Health, Echtzeit-Stream, Plugins, Konnektor-Abfragen. */
export async function systemRoutes(app: App, s: Services): Promise<void> {
  app.get('/api/v1/health', { schema: { tags: ['System'], summary: 'Health-Check' } }, async () => {
    s.db.value('SELECT 1');
    return { status: 'ok', version: s.config.version, time: new Date().toISOString() };
  });

  app.get(
    '/api/v1/monitoring',
    {
      schema: {
        tags: ['System'],
        summary: 'Zustand für Überwachungssysteme: ok, warn oder error samt Messwerten',
        description:
          'Nur für Administratorkonten – z. B. mit einem API-Token des Umfangs „read“. `status` fasst die Betriebswarnungen zusammen ' +
          '(Sicherung, Speicherplatz, fehlender Neustart). Mit `strict=true` antwortet der Server bei „warn“ und „error“ mit HTTP 503, ' +
          'damit auch einfache Prüfungen ohne Auswertung des Inhalts anschlagen.',
        querystring: Type.Object({ strict: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req, reply) => {
      const result = s.alerts.monitoring(req.auth);
      if (req.query.strict && result.status !== 'ok') reply.status(503);
      return result;
    },
  );

  app.get('/api/v1/stream', { schema: { tags: ['System'], summary: 'Server-Sent Events (Benachrichtigungen, Live-Updates)', hide: true } }, async (req, reply) => {
    requireUser(req);
    s.realtime.connect(req, reply);
  });

  /* ------------------------- Hinweis auf neue Versionen ------------------------- */

  app.get(
    '/api/v1/admin/update-check',
    { schema: { tags: ['Administration'], summary: 'Stand der Suche nach neuen Versionen (gemerkt, ohne Abruf)' } },
    async (req) => s.updates.info(req.auth),
  );

  app.post(
    '/api/v1/admin/update-check',
    {
      schema: {
        tags: ['Administration'],
        summary: 'Jetzt bei GitHub nach einer neuen Version suchen',
        description: 'Nur wenn `updateCheck` eingeschaltet ist; höchstens ein Abruf je Minute, sonst kommt der gemerkte Stand.',
      },
    },
    async (req) => s.updates.refresh(req.auth),
  );

  /* ------------------------------ Konnektoren ------------------------------ */

  app.get('/api/v1/connectors/available', { schema: { tags: ['Integrationen'], summary: 'Verfügbare API-Konnektoren (für Makros)' } }, async (req) =>
    s.connectors.available(req.auth),
  );

  app.post(
    '/api/v1/connectors/:key/query',
    {
      schema: {
        tags: ['Integrationen'],
        summary: 'Daten über einen Konnektor abrufen (GET-Proxy mit Cache)',
        params: Type.Object({ key: Type.String({ maxLength: 40 }) }),
        body: Type.Object({
          path: Type.String({ maxLength: 2000 }),
          params: Type.Optional(Type.Record(Type.String(), Type.String())),
          pageId: Type.Optional(Type.Integer()),
          refresh: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req) => s.connectors.query(req.auth, req.params.key, req.body),
  );

  /* -------------------------------- Plugins -------------------------------- */

  app.get('/api/v1/plugins/client', { schema: { tags: ['Plugins'], summary: 'Aktive Client-Plugins' } }, async () => s.plugins.clientPlugins());

  for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
    app.route({
      method,
      url: '/api/v1/plugins/:pluginId/*',
      schema: { tags: ['Plugins'], summary: 'Plugin-Routen', hide: method !== 'GET' },
      handler: async (req, reply) => {
        const params = req.params as { pluginId: string; '*': string };
        return s.plugins.handle(req, reply, params.pluginId, params['*'] ?? '');
      },
    });
  }

  app.get('/plugin-assets/:pluginId/*', { schema: { hide: true } }, async (req, reply) => {
    const params = req.params as { pluginId: string; '*': string };
    const file = s.plugins.assetPath(params.pluginId, params['*'] ?? '');
    if (!file) throw notFound('Datei nicht gefunden');
    reply
      .header('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
      .header('Cache-Control', 'public, max-age=300')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(file));
  });
}
