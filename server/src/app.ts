import fs from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config.ts';
import { headerValue } from './core/legacy.ts';
import type { App } from './http.ts';
import { createServices, startServices, stopServices, type Logger, type Services } from './services.ts';
import { HttpError } from './core/errors.ts';
import { requestLocale, translate } from './core/i18n.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { ssoRoutes } from './modules/auth/sso-routes.ts';
import { spaceRoutes } from './modules/spaces/routes.ts';
import { pageRoutes } from './modules/pages/routes.ts';
import { commentRoutes } from './modules/comments/routes.ts';
import { analyticsRoutes } from './modules/analytics/routes.ts';
import { readRoutes } from './modules/reads/routes.ts';
import { attachmentRoutes } from './modules/attachments/routes.ts';
import { searchRoutes } from './modules/search/routes.ts';
import { reviewRoutes } from './modules/review/routes.ts';
import { aiRoutes } from './modules/ai/routes.ts';
import { taskRoutes } from './modules/tasks/routes.ts';
import { templateRoutes } from './modules/templates/routes.ts';
import { adminRoutes } from './modules/admin/routes.ts';
import { mailRoutes } from './modules/mail/routes.ts';
import { exportRoutes } from './modules/export/routes.ts';
import { systemRoutes } from './modules/system/routes.ts';
import { RotatingLogStream } from './core/logfile.ts';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Formular-POST eines Identitätsanbieters (SAML) – geschützt durch Signatur, InResponseTo und das Vorgangs-Cookie */
const CSRF_EXEMPT = new Set(['/api/v1/auth/saml/acs']);

export interface BuildOptions {
  logger?: boolean;
  schedulers?: boolean;
}

export async function buildApp(config: Config, options: BuildOptions = {}): Promise<{ app: App; services: Services }> {
  const fastify = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            transport: undefined,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            // Dienst ohne Konsole (Aufgabenplanung): zusätzlich in eine rotierende Datei
            ...(config.logFile ? { stream: new RotatingLogStream(config.logFile) } : {}),
          },
    trustProxy: config.trustProxy,
    bodyLimit: 12 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: config.logLevel !== 'debug' }),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true, allErrors: false } },
  }).withTypeProvider<TypeBoxTypeProvider>();
  const app = fastify as unknown as App;

  const log = (options.logger === false ? silentLogger() : app.log) as unknown as Logger;
  const s = createServices(config, log);

  app.decorateRequest('auth', null as never);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 50, fields: 20 } });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Zu viele Anfragen. Bitte in ${Math.ceil(ctx.ttl / 60000)} Minute(n) erneut versuchen.` },
    }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Knowstead REST-API',
        version: config.version,
        description:
          'REST-API von Knowstead. Authentifizierung per Sitzungs-Cookie (Web-Oberfläche) oder persönlichem API-Token: `Authorization: Bearer knowstead_…`. ' +
          'Tokens erzeugst du im Profil unter „API-Tokens“. Siehe docs/API.md für Beispiele, Webhooks und Signaturen.',
      },
      servers: [{ url: config.baseUrl }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'Persönliches API-Token (knowstead_…)' },
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'knowstead_session' },
        },
      },
      security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs', uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true } });

  /* ------------------------ Authentifizierung & Schutz ------------------------ */

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (!url.startsWith('/api/') && !url.startsWith('/plugin-assets/')) return;
    if (url.startsWith('/api/docs')) {
      // API-Referenz nur für Angemeldete (Sitzung oder Token) – anonyme Besucher sollen die Schnittstelle nicht
      // auskundschaften können. Mit anonymem Lesezugriff bleibt sie wie die Inhalte öffentlich.
      req.auth = s.auth.resolve(req);
      req.auth.locale = requestLocale(req, s.settings.get('defaultLocale'));
      if (!req.auth.user && !s.settings.get('anonymousAccess')) {
        if (/^\/api\/docs\/(json|yaml)/.test(url)) throw new HttpError(401, 'unauthorized', 'Bitte anmelden oder ein API-Token mitsenden');
        return reply.redirect(`/login?next=${encodeURIComponent('/api/docs')}`);
      }
      return;
    }
    req.auth = s.auth.resolve(req);
    req.auth.locale = requestLocale(req, s.settings.get('defaultLocale'));
    const method = req.method.toUpperCase();
    if (req.auth.via === 'token') {
      const scopes = req.auth.scopes ?? new Set<string>();
      if (url.startsWith('/api/v1/admin') && !scopes.has('admin')) {
        throw new HttpError(403, 'insufficient_scope', 'Das Token benötigt den Umfang „admin“');
      }
      if (UNSAFE_METHODS.has(method) && !scopes.has('write') && !scopes.has('admin')) {
        throw new HttpError(403, 'insufficient_scope', 'Das Token benötigt den Umfang „write“');
      }
    } else if (UNSAFE_METHODS.has(method) && !headerValue(req.headers, 'client') && !CSRF_EXEMPT.has(url.split('?')[0])) {
      // CSRF-Schutz für Cookie-Sitzungen: nur der eigene Client setzt diesen Header.
      reply.header('Cache-Control', 'no-store');
      throw new HttpError(403, 'csrf', 'Anfrage ohne X-Knowstead-Client-Header abgelehnt (CSRF-Schutz). Für Skripte bitte ein API-Token verwenden.');
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    // Fehlermeldungen in der Sprache der Person (Texte im Code sind deutsch)
    if (reply.statusCode >= 400 && typeof payload === 'string' && payload.startsWith('{') && String(reply.getHeader('Content-Type') ?? '').includes('json')) {
      const locale = requestLocale(req, s.settings.get('defaultLocale'));
      if (locale !== 'de') {
        try {
          const data = JSON.parse(payload) as { error?: { message?: unknown } };
          if (data.error && typeof data.error.message === 'string') {
            data.error.message = translate(data.error.message, locale);
            payload = JSON.stringify(data);
          }
        } catch {
          /* keine JSON-Antwort */
        }
      }
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!reply.hasHeader('X-Frame-Options')) reply.header('X-Frame-Options', 'SAMEORIGIN');
    // Keine Browserfunktionen, die Knowstead nicht braucht – auch nicht für eingebettete Inhalte
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()');
    // Fremde Fenster erhalten keinen Zugriff auf Knowstead-Fenster (window.opener)
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    const type = String(reply.getHeader('Content-Type') ?? '');
    if (type.startsWith('text/html') && !req.url.startsWith('/api/')) {
      const frameHosts = s.settings.get('allowedEmbedHosts').map((h) => `https://${h}`);
      // Der draw.io-Editor läuft in einem iframe (auch selbst betrieben möglich).
      try {
        frameHosts.push(new URL(s.settings.get('drawioUrl')).origin);
      } catch {
        /* ungültige Adresse ignorieren */
      }
      const frames = [...new Set(frameHosts)].join(' ');
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https: http:",
          "font-src 'self' data:",
          "connect-src 'self'",
          `frame-src 'self' ${frames}`,
          "media-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
        ].join('; '),
      );
    }
    return payload;
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const fe = err as FastifyError;
    if (fe.validation) {
      return reply.status(400).send({ error: { code: 'validation', message: `Ungültige Eingabe: ${fe.message}`, details: fe.validation } });
    }
    if (fe.statusCode && fe.statusCode < 500) {
      const message = fe.statusCode === 413 ? 'Die Anfrage ist zu groß' : fe.message;
      return reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'error', message } });
    }
    req.log.error({ err }, 'Unbehandelter Fehler');
    return reply.status(500).send({ error: { code: 'internal', message: 'Interner Serverfehler' } });
  });

  /* --------------------------------- Routen --------------------------------- */

  await authRoutes(app, s);
  await ssoRoutes(app, s);
  await spaceRoutes(app, s);
  await pageRoutes(app, s);
  await commentRoutes(app, s);
  await attachmentRoutes(app, s);
  await searchRoutes(app, s);
  await reviewRoutes(app, s);
  await aiRoutes(app, s);
  await taskRoutes(app, s);
  await templateRoutes(app, s);
  await adminRoutes(app, s);
  await mailRoutes(app, s);
  await exportRoutes(app, s);
  await systemRoutes(app, s);
  await analyticsRoutes(app, s);
  await readRoutes(app, s);

  /* ------------------------------ Web-Oberfläche ------------------------------ */

  const indexFile = path.join(config.webDistDir, 'index.html');
  const hasWeb = fs.existsSync(indexFile);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: '/',
      wildcard: false,
      index: false,
      // .br/.gz aus dem Build ausliefern, wenn der Browser sie akzeptiert
      preCompressed: true,
      setHeaders: (reply, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        else reply.header('Cache-Control', 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    // HEAD wie GET beantworten (Verfügbarkeitsprüfungen, Proxys) – Node lässt den Inhalt dabei weg
    if (req.url.startsWith('/api/') || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url.split('?')[0]} existiert nicht` } });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Ungültige Adresse' } });
    }
    const assetPath = path.resolve(config.webDistDir, `.${path.posix.normalize(decoded)}`);
    // Muss wirklich *innerhalb* des Verzeichnisses liegen (nicht nur mit dem Namen beginnen).
    const inWebDist = assetPath === config.webDistDir || assetPath.startsWith(config.webDistDir + path.sep);
    if (hasWeb && inWebDist && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
      // Dateien, die nach dem Start entstanden sind (neuer Build); send erwartet „/“ als Trenner.
      return reply.sendFile(path.relative(config.webDistDir, assetPath).split(path.sep).join('/'));
    }
    if (decoded.startsWith('/assets/')) {
      // Fehlende Programmdatei (z. B. veralteter Verweis nach einem Update): kein HTML mit Status 200 ausliefern –
      // der Browser meldet sonst einen falschen MIME-Typ, und Zwischenspeicher könnten die Seite als Skript ablegen.
      reply.header('Cache-Control', 'no-store');
      return reply.status(404).type('text/plain; charset=utf-8').send('Datei nicht gefunden');
    }
    if (!hasWeb) {
      return reply
        .type('text/html; charset=utf-8')
        .send('<h1>Knowstead</h1><p>Die Weboberfläche wurde noch nicht gebaut. Bitte <code>npm run build</code> ausführen oder im Entwicklungsmodus <code>npm run dev</code> nutzen.</p><p><a href="/api/docs">API-Dokumentation</a></p>');
    }
    reply.header('Cache-Control', 'no-cache');
    return reply.type('text/html; charset=utf-8').send(fs.readFileSync(indexFile));
  });

  // Gemeinsames Bearbeiten: WebSocket-Upgrade für /api/v1/collab/:pageId
  app.server.on('upgrade', (req, socket, head) => {
    if (!s.collab.handleUpgrade(req, socket, head)) socket.destroy();
  });

  // Fastify schließt zuerst den HTTP-Server und wartet dabei auf das Ende aller Verbindungen. Live-Verbindungen
  // (Benachrichtigungen per SSE, gemeinsames Bearbeiten per WebSocket) enden nie von selbst – ohne diesen
  // Schritt hinge das Beenden, bis systemd bzw. die Aufgabenplanung den Prozess hart abbrechen.
  app.addHook('preClose', async () => {
    s.realtime.disconnectAll();
    s.collab.disconnectAll();
  });

  app.addHook('onClose', async () => {
    await stopServices(s);
  });

  await startServices(s, { schedulers: options.schedulers });
  return { app, services: s };
}

function silentLogger(): Logger {
  const noop = () => {};
  const l: Logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => l };
  return l;
}
