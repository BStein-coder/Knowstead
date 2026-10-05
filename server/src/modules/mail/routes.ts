import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam } from '../../http.ts';
import type { Services } from '../../services.ts';
import { translate } from '../../core/i18n.ts';

/** Administration → E-Mail: Versandprotokoll, Verbindungstest, Test-Mail, Wiederholen. */
export async function mailRoutes(app: App, s: Services): Promise<void> {
  const tags = ['E-Mail'];

  app.get(
    '/api/v1/admin/mail',
    {
      schema: {
        tags,
        summary: 'Versandprotokoll und Kennzahlen',
        querystring: Type.Object({
          status: Type.Optional(Type.String({ maxLength: 20 })),
          q: Type.Optional(Type.String({ maxLength: 200 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
    },
    async (req) => s.mail.overview(req.auth, req.query),
  );

  app.post('/api/v1/admin/mail/verify', { schema: { tags, summary: 'Verbindung und Anmeldung am SMTP-Server prüfen' } }, async (req) =>
    s.mail.verify(req.auth).then((result) => ({ ...result, message: translate(result.message, req.auth.locale ?? 'de') })),
  );

  app.post(
    '/api/v1/admin/mail/test',
    { schema: { tags, summary: 'Test-E-Mail sofort senden', body: Type.Object({ to: Type.String({ minLength: 3, maxLength: 254 }) }) } },
    async (req) => s.mail.sendTest(req.auth, req.body.to),
  );

  app.post('/api/v1/admin/mail/:id/retry', { schema: { tags, summary: 'E-Mail erneut senden', params: IdParam } }, async (req) =>
    s.mail.retry(req.auth, req.params.id),
  );

  app.post('/api/v1/admin/mail/retry-failed', { schema: { tags, summary: 'Alle fehlgeschlagenen und wartenden E-Mails jetzt senden' } }, async (req) => {
    const queued = s.mail.retryFailed(req.auth);
    await s.mail.processQueue();
    return { queued };
  });
}
