import Type from 'typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { App } from '../../http.ts';
import { requireUser } from '../../http.ts';
import type { Services } from '../../services.ts';
import { SsoError, safeNext } from './sso.ts';
import { HttpError } from '../../core/errors.ts';
import type { SsoProvider } from './sso.ts';
import { translator, type Locale } from '../../core/i18n.ts';

/** Prüfschritte: Beschriftungen übersetzt die Oberfläche, Details der Server. */
function localizeSteps<T extends { steps: { detail: string }[] }>(result: T, locale: Locale | undefined): T {
  const tr = translator(locale ?? 'de');
  return { ...result, steps: result.steps.map((step) => ({ ...step, detail: tr(step.detail) })) };
}

/** Browser-Weiterleitungen dürfen öfter vorkommen als Passwortversuche – ein Proxy bündelt oft viele Personen. */
const ssoRateLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

const StartQuery = Type.Object({
  next: Type.Optional(Type.String({ maxLength: 2000 })),
  remember: Type.Optional(Type.Boolean()),
});

export async function ssoRoutes(app: App, s: Services): Promise<void> {
  /** Fehler einer Browser-Weiterleitung: zur Anmeldeseite (bzw. zum Profil) mit einer Fehlerkennung. */
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown, link = false) => {
    const code = err instanceof SsoError ? err.code : 'provider';
    req.log.warn({ err, code }, 'Single Sign-on fehlgeschlagen');
    return reply.redirect(`${link ? '/profile/sign-in' : '/login'}?sso_error=${code}`, 302);
  };

  const signIn = (req: FastifyRequest, reply: FastifyReply, result: { user: { id: number }; flow: { next: string; remember: boolean; linkUserId: number | null } }) => {
    if (result.flow.linkUserId) return reply.redirect('/profile/sign-in?linked=1', 302);
    const session = s.auth.createSession(result.user.id, req.auth, result.flow.remember);
    s.auth.setCookie(req, reply, session.token, session.expiresAt, result.flow.remember);
    return reply.redirect(safeNext(result.flow.next), 302);
  };

  app.get('/api/v1/auth/sso', { schema: { tags: ['Authentifizierung'], summary: 'Verfügbare Anmeldewege (Single Sign-on)' } }, async (req) => s.sso.publicInfo(req.auth.locale));

  /* ----------------------------------- OIDC ----------------------------------- */

  app.get(
    '/api/v1/auth/oidc/start',
    { config: ssoRateLimit, schema: { tags: ['Authentifizierung'], summary: 'Anmeldung über OpenID Connect / Entra ID beginnen (Weiterleitung)', querystring: StartQuery } },
    async (req, reply) => {
      try {
        const url = await s.sso.startOidc(req, reply, { next: req.query.next ?? '/', remember: req.query.remember !== false });
        return reply.redirect(url, 302);
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );

  app.get(
    '/api/v1/auth/oidc/callback',
    { config: ssoRateLimit, schema: { tags: ['Authentifizierung'], summary: 'Rückkehr vom OpenID-Connect-Anbieter', hide: true } },
    async (req, reply) => {
      let linking = false;
      try {
        const result = await s.sso.finishOidc(req, reply);
        linking = !!result.flow.linkUserId;
        return signIn(req, reply, result);
      } catch (err) {
        return fail(req, reply, err, linking || !!req.auth.user);
      }
    },
  );

  /* ----------------------------------- SAML ----------------------------------- */

  app.get(
    '/api/v1/auth/saml/start',
    { config: ssoRateLimit, schema: { tags: ['Authentifizierung'], summary: 'Anmeldung über SAML 2.0 beginnen (Weiterleitung)', querystring: StartQuery } },
    async (req, reply) => {
      try {
        const url = await s.sso.startSaml(req, reply, { next: req.query.next ?? '/', remember: req.query.remember !== false });
        return reply.redirect(url, 302);
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );

  // Der Identitätsanbieter sendet ein HTML-Formular (application/x-www-form-urlencoded)
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2_000_000 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
    scope.post(
      '/api/v1/auth/saml/acs',
      { config: ssoRateLimit, schema: { tags: ['Authentifizierung'], summary: 'SAML Assertion Consumer Service', hide: true } },
      async (req, reply) => {
        try {
          await s.sso.acceptSamlResponse(req.body);
          // 303: Der Browser ruft die Abschlussseite per GET auf – dann mit dem SameSite-Cookie des Vorgangs
          return reply.redirect('/api/v1/auth/saml/finish', 303);
        } catch (err) {
          req.log.warn({ err }, 'SAML-Antwort abgelehnt');
          return reply.redirect(`/login?sso_error=${err instanceof SsoError ? err.code : 'provider'}`, 303);
        }
      },
    );
  });

  app.get('/api/v1/auth/saml/finish', { config: ssoRateLimit, schema: { tags: ['Authentifizierung'], summary: 'SAML-Anmeldung abschließen', hide: true } }, async (req, reply) => {
    try {
      return signIn(req, reply, await s.sso.finishSaml(req, reply));
    } catch (err) {
      return fail(req, reply, err, !!req.auth.user);
    }
  });

  app.get('/api/v1/auth/saml/metadata', { schema: { tags: ['Authentifizierung'], summary: 'SAML-Metadaten dieses Dienstes (Service Provider)' } }, async (_req, reply) => {
    reply.header('Content-Type', 'application/samlmetadata+xml; charset=utf-8');
    reply.header('Content-Disposition', 'inline; filename="knowstead-saml-metadata.xml"');
    return s.sso.metadata();
  });

  /* ---------------------------- Windows-Anmeldung ---------------------------- */

  app.get(
    '/api/v1/auth/kerberos',
    { config: ssoRateLimit, schema: { tags: ['Authentifizierung'], summary: 'Windows-integrierte Anmeldung über den vorgeschalteten Webserver', querystring: StartQuery } },
    async (req, reply) => {
      const linking = !!req.auth.user && !!req.cookies?.knowstead_sso;
      try {
        return signIn(req, reply, await s.sso.kerberos(req, reply, { next: req.query.next ?? '/', remember: req.query.remember !== false }));
      } catch (err) {
        return fail(req, reply, err, linking);
      }
    },
  );

  /* ---------------------------- Verknüpfte Konten ---------------------------- */

  app.get('/api/v1/me/identities', { schema: { tags: ['Profil'], summary: 'Verknüpfte Anmeldekonten (Single Sign-on)' } }, async (req) => ({
    items: s.sso.myIdentities(req.auth),
    available: s.sso.publicInfo(req.auth.locale).providers,
  }));

  app.post(
    '/api/v1/me/identities/:provider/link',
    {
      schema: {
        tags: ['Profil'],
        summary: 'Anmeldekonto verknüpfen – liefert die Adresse, zu der der Browser wechselt',
        params: Type.Object({ provider: Type.Union([Type.Literal('oidc'), Type.Literal('saml'), Type.Literal('kerberos')]) }),
      },
    },
    async (req, reply) => {
      requireUser(req);
      try {
        return { url: await s.sso.startLink(req, reply, req.params.provider as SsoProvider) };
      } catch (err) {
        if (err instanceof SsoError) throw new HttpError(400, err.code, err.message);
        throw err;
      }
    },
  );

  app.delete(
    '/api/v1/me/identities/:id',
    { schema: { tags: ['Profil'], summary: 'Verknüpfung lösen', params: Type.Object({ id: Type.Integer() }) } },
    async (req) => {
      s.sso.unlink(req.auth, requireUser(req).id, req.params.id);
      return { ok: true };
    },
  );

  /* ------------------------------ Administration ------------------------------ */

  app.get('/api/v1/admin/sso', { schema: { tags: ['Administration'], summary: 'Single Sign-on: Adressen für die Registrierung beim Anbieter' } }, async (req) =>
    s.sso.adminInfo(req.auth, req),
  );

  app.post('/api/v1/admin/sso/oidc/test', { schema: { tags: ['Administration'], summary: 'OpenID Connect: Verbindung prüfen' } }, async (req) => localizeSteps(await s.sso.testOidc(req.auth), req.auth.locale));

  app.post('/api/v1/admin/sso/saml/test', { schema: { tags: ['Administration'], summary: 'SAML: Einstellungen und Zertifikat prüfen' } }, async (req) => localizeSteps(s.sso.testSaml(req.auth), req.auth.locale));

  app.get(
    '/api/v1/admin/users/:id/identities',
    { schema: { tags: ['Administration'], summary: 'Verknüpfte Anmeldekonten eines Benutzers', params: Type.Object({ id: Type.Integer() }) } },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      s.users.require(req.params.id);
      return { items: s.sso.identities(req.params.id) };
    },
  );

  app.delete(
    '/api/v1/admin/users/:id/identities/:identityId',
    { schema: { tags: ['Administration'], summary: 'Verknüpfung eines Benutzers lösen', params: Type.Object({ id: Type.Integer(), identityId: Type.Integer() }) } },
    async (req) => {
      s.sso.unlink(req.auth, req.params.id, req.params.identityId);
      return { ok: true };
    },
  );
}
