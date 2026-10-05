import Type from 'typebox';
import type { App } from '../../http.ts';
import { requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import { AI_ACTIONS, type AiAction } from './service.ts';
import { translate, translator } from '../../core/i18n.ts';

/** KI-Funktionen für Autorinnen und Autoren sowie die Verwaltung. */
export async function aiRoutes(app: App, s: Services): Promise<void> {
  const tags = ['KI'];

  app.get('/api/v1/ai/status', { schema: { tags, summary: 'Verfügbarkeit und Tageslimit der KI-Funktionen' } }, async (req) => s.ai.status(req.auth));

  app.post(
    '/api/v1/ai/run',
    {
      config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
      schema: {
        tags,
        summary: 'KI-Aktion ausführen (Zusammenfassen, Verbessern, Übersetzen, Fragen …)',
        body: Type.Object({
          action: Type.String({ maxLength: 30 }),
          text: Type.Optional(Type.String({ maxLength: 100_000 })),
          pageId: Type.Optional(Type.Integer()),
          language: Type.Optional(Type.String({ maxLength: 40 })),
          question: Type.Optional(Type.String({ maxLength: 2000 })),
          instruction: Type.Optional(Type.String({ maxLength: 2000 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      return s.ai.run(req.auth, { ...req.body, action: req.body.action as AiAction });
    },
  );

  /* ------------------------------ Administration ------------------------------ */

  app.post('/api/v1/admin/ai/test', { schema: { tags, summary: 'Verbindung zur KI prüfen' } }, async (req) => {
    const result = await s.ai.test(req.auth);
    return { ...result, message: translate(result.message, req.auth.locale ?? 'de') };
  });

  app.get('/api/v1/admin/ai/usage', { schema: { tags, summary: 'KI-Nutzung der letzten 30 Tage' } }, async (req) => ({
    ...s.ai.stats(req.auth),
    actions: Object.fromEntries(Object.entries(AI_ACTIONS).map(([key, label]) => [key, translator(req.auth.locale ?? 'de')(label)])),
  }));
}
