import Type from 'typebox';
import type { App } from '../../http.ts';
import { Nullable, requireUser, Offset } from '../../http.ts';
import type { Services } from '../../services.ts';
import { GLOBAL_PERMISSIONS } from '../../core/permissions.ts';
import { forbidden, notFound } from '../../core/errors.ts';
import { isLocalRequest } from './service.ts';
import { requestLocale } from '../../core/i18n.ts';
import { seedAfterSetup } from '../../seed/index.ts';

const rateLimited = { rateLimit: { max: 20, timeWindow: '10 minutes' } };

export async function authRoutes(app: App, s: Services): Promise<void> {
  /* ------------------------------ Ersteinrichtung ------------------------------ */

  app.get('/api/v1/setup/status', { schema: { tags: ['Einrichtung'], summary: 'Ist eine Ersteinrichtung nötig?' } }, async (req) => {
    const needsSetup = s.users.count() === 0;
    return { needsSetup, setupCodeRequired: needsSetup && !isLocalRequest(req), version: s.config.version };
  });

  app.post(
    '/api/v1/setup',
    {
      config: rateLimited,
      schema: {
        tags: ['Einrichtung'],
        summary: 'Ersteinrichtung: erstes Administratorkonto anlegen',
        body: Type.Object({
          siteName: Type.String({ minLength: 1, maxLength: 80 }),
          username: Type.String({ minLength: 2, maxLength: 40 }),
          displayName: Type.String({ minLength: 1, maxLength: 80 }),
          email: Type.Optional(Type.String({ maxLength: 200 })),
          password: Type.String({ minLength: 1, maxLength: 200 }),
          locale: Type.Optional(Type.Union([Type.Literal('de'), Type.Literal('en')])),
          accentColor: Type.Optional(Type.String({ maxLength: 20 })),
          sampleContent: Type.Optional(Type.Boolean()),
          setupCode: Type.Optional(Type.String({ maxLength: 40 })),
        }),
      },
    },
    async (req, reply) => {
      if (s.users.count() > 0) throw forbidden('Die Einrichtung wurde bereits abgeschlossen');
      s.auth.checkSetupCode(req, req.body.setupCode);
      const body = req.body;
      s.settings.update({
        siteName: body.siteName.trim(),
        defaultLocale: body.locale ?? 'de',
        ...(body.accentColor && /^#[0-9a-f]{6}$/i.test(body.accentColor) ? { accentColor: body.accentColor } : {}),
      });
      const adminGroup = s.groups.systemGroup('admin')!;
      const user = s.users.create({
        username: body.username,
        displayName: body.displayName,
        email: body.email || null,
        password: body.password,
        groupIds: [adminGroup.id],
      });
      const auth = s.perms.forUser(user, { ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
      s.emit(auth, { type: 'user.created', target: { type: 'user', id: user.id, label: user.username }, data: { setup: true } });
      await seedAfterSetup(s, auth, { sampleContent: body.sampleContent !== false });
      const session = s.auth.createSession(user.id, auth, true);
      s.auth.setCookie(req, reply, session.token, session.expiresAt, true);
      return { user: s.users.toDto(user, { includeGroups: true }) };
    },
  );

  /* -------------------------------- Anmeldung -------------------------------- */

  app.get('/api/v1/auth/me', { schema: { tags: ['Authentifizierung'], summary: 'Aktueller Benutzer, Rechte und öffentliche Einstellungen' } }, async (req) => {
    const auth = req.auth;
    const settings = s.settings.publicSettings();
    const needsSetup = s.users.count() === 0;
    const base = {
      settings,
      version: s.config.version,
      needsSetup,
      setupCodeRequired: needsSetup && !isLocalRequest(req),
      mailConfigured: s.mailer.isConfigured(),
      directoryLogin: s.directory.isEnabled(),
      sso: s.sso.publicInfo(req.auth.locale),
    };
    if (!auth.user) return { ...base, user: null };
    const row = s.users.require(auth.user.id);
    const personal = await s.spaces.personalSpace(auth, false);
    return {
      ...base,
      user: {
        ...s.users.toDto(row, { includeGroups: true }),
        /** lokales Passwort vorhanden (sonst Verzeichniskonto o. Ä.) – E-Mail-Wechsel verlangt dann das Passwort */
        hasPassword: !!row.password_hash,
        preferences: auth.user.preferences,
        permissions: auth.isAdmin ? Object.keys(GLOBAL_PERMISSIONS) : [...auth.permissions],
      },
      personalSpaceKey: personal?.key ?? null,
      unreadNotifications: s.notifications.unreadCount(auth),
      openReviews: s.reviews.openCount(auth),
      openTasks: s.tasks.openForUser(auth),
      dueReviews: s.reviewCycle.dueCount(auth),
      openReads: s.reads.openCount(auth),
      aiAvailable: s.ai.canUse(auth),
      emailNotificationsEnabled: s.mail.notificationsEnabled(),
      via: auth.via,
    };
  });

  app.post(
    '/api/v1/auth/login',
    {
      config: rateLimited,
      schema: {
        tags: ['Authentifizierung'],
        summary: 'Anmelden (setzt ein Sitzungs-Cookie)',
        body: Type.Object({
          login: Type.String({ minLength: 1, maxLength: 200 }),
          password: Type.String({ minLength: 1, maxLength: 200 }),
          remember: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const user = await s.auth.login(req.auth, req.body.login, req.body.password);
      const remember = req.body.remember !== false;
      const session = s.auth.createSession(user.id, req.auth, remember);
      s.auth.setCookie(req, reply, session.token, session.expiresAt, remember);
      return { user: s.users.toDto(user, { includeGroups: true }) };
    },
  );

  app.post('/api/v1/auth/logout', { schema: { tags: ['Authentifizierung'], summary: 'Abmelden' } }, async (req, reply) => {
    s.auth.logout(req.auth);
    s.auth.clearCookie(reply);
    return { ok: true };
  });

  app.post(
    '/api/v1/auth/register',
    {
      config: rateLimited,
      schema: {
        tags: ['Authentifizierung'],
        summary: 'Selbstregistrierung (falls aktiviert)',
        body: Type.Object({
          username: Type.String({ minLength: 2, maxLength: 40 }),
          displayName: Type.String({ minLength: 1, maxLength: 80 }),
          email: Type.String({ minLength: 3, maxLength: 200 }),
          password: Type.String({ minLength: 1, maxLength: 200 }),
        }),
      },
    },
    async (req, reply) => {
      const { user, pending } = s.auth.register(req.auth, req.body);
      // Mit E-Mail-Bestätigung erst nach dem Klick auf den Link anmelden
      if (pending) return { user: null, pending: true, email: user.email };
      const session = s.auth.createSession(user.id, req.auth, true);
      s.auth.setCookie(req, reply, session.token, session.expiresAt, true);
      return { user: s.users.toDto(user, { includeGroups: true }), pending: false };
    },
  );

  app.post(
    '/api/v1/auth/verify-email',
    {
      config: rateLimited,
      schema: {
        tags: ['Authentifizierung'],
        summary: 'E-Mail-Adresse einer Selbstregistrierung bestätigen (meldet an)',
        body: Type.Object({ token: Type.String({ minLength: 10, maxLength: 200 }) }),
      },
    },
    async (req, reply) => {
      const user = s.auth.verifyEmail(req.auth, req.body.token);
      const session = s.auth.createSession(user.id, req.auth, true);
      s.auth.setCookie(req, reply, session.token, session.expiresAt, true);
      return { user: s.users.toDto(user, { includeGroups: true }) };
    },
  );

  app.post(
    '/api/v1/auth/password',
    {
      // Wie die Anmeldung begrenzt: Eine fremde, offene Sitzung soll das aktuelle Passwort nicht durch Probieren erraten können
      config: rateLimited,
      schema: {
        tags: ['Authentifizierung'],
        summary: 'Eigenes Passwort ändern',
        body: Type.Object({ current: Type.String({ maxLength: 200 }), next: Type.String({ minLength: 1, maxLength: 200 }) }),
      },
    },
    async (req) => {
      await s.auth.changePassword(req.auth, req.body.current, req.body.next);
      return { ok: true };
    },
  );

  app.post(
    '/api/v1/auth/forgot',
    {
      config: rateLimited,
      schema: { tags: ['Authentifizierung'], summary: 'Link zum Zurücksetzen anfordern', body: Type.Object({ login: Type.String({ minLength: 1, maxLength: 200 }) }) },
    },
    async (req) => {
      try {
        await s.auth.requestReset(req.auth, req.body.login);
      } catch (err) {
        req.log.warn({ err }, 'Passwort-Reset-Mail fehlgeschlagen');
      }
      return { ok: true };
    },
  );

  app.post(
    '/api/v1/auth/reset',
    {
      config: rateLimited,
      schema: {
        tags: ['Authentifizierung'],
        summary: 'Neues Passwort über Reset-Link setzen',
        body: Type.Object({ token: Type.String({ minLength: 10, maxLength: 200 }), password: Type.String({ minLength: 1, maxLength: 200 }) }),
      },
    },
    async (req) => {
      s.auth.resetPassword(req.auth, req.body.token, req.body.password);
      return { ok: true };
    },
  );

  app.get('/api/v1/auth/sessions', { schema: { tags: ['Authentifizierung'], summary: 'Aktive Sitzungen' } }, async (req) => s.auth.listSessions(req.auth));

  app.delete(
    '/api/v1/auth/sessions/:id',
    { schema: { tags: ['Authentifizierung'], summary: 'Sitzung beenden', params: Type.Object({ id: Type.String({ maxLength: 64 }) }) } },
    async (req) => {
      s.auth.revokeSession(req.auth, req.params.id);
      return { ok: true };
    },
  );

  app.post('/api/v1/auth/sessions/revoke-others', { schema: { tags: ['Authentifizierung'], summary: 'Alle anderen Sitzungen beenden' } }, async (req) => ({
    revoked: s.auth.revokeOtherSessions(req.auth),
  }));

  /* ---------------------------------- Profil ---------------------------------- */

  app.patch(
    '/api/v1/me',
    {
      schema: {
        tags: ['Profil'],
        summary: 'Eigenes Profil ändern',
        body: Type.Object({
          displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          email: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
          bio: Type.Optional(Type.String({ maxLength: 2000 })),
          avatarColor: Type.Optional(Nullable(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }))),
          /** Pflicht beim Ändern der E-Mail-Adresse (Konten mit lokalem Passwort) */
          currentPassword: Type.Optional(Type.String({ maxLength: 200 })),
        }),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { currentPassword, ...changes } = req.body;
      if (changes.email !== undefined) {
        const row = s.users.require(user.id);
        if ((changes.email?.trim() || '').toLowerCase() !== (row.email ?? '').toLowerCase()) {
          await s.auth.confirmPassword(row, currentPassword, 'die neue E-Mail-Adresse');
        }
      }
      return s.users.toDto(s.users.update(user.id, changes, req.auth), { includeGroups: true });
    },
  );

  app.get('/api/v1/me/preferences', { schema: { tags: ['Profil'], summary: 'Persönliche Einstellungen' } }, async (req) => s.users.preferences(requireUser(req).id));

  app.patch(
    '/api/v1/me/preferences',
    { schema: { tags: ['Profil'], summary: 'Persönliche Einstellungen ändern', body: Type.Record(Type.String(), Type.Unknown()) } },
    async (req) => s.users.updatePreferences(requireUser(req).id, req.body as Record<string, unknown>),
  );

  app.get('/api/v1/me/tokens', { schema: { tags: ['Profil'], summary: 'Eigene API-Tokens' } }, async (req) => s.tokens.listForUser(requireUser(req).id));

  app.post(
    '/api/v1/me/tokens',
    {
      schema: {
        tags: ['Profil'],
        summary: 'API-Token erstellen (wird nur einmal angezeigt)',
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          scopes: Type.Array(Type.String(), { minItems: 1 }),
          expiresInDays: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 3650 }))),
        }),
      },
    },
    async (req) => s.tokens.create(req.auth, req.body),
  );

  app.delete(
    '/api/v1/me/tokens/:id',
    { schema: { tags: ['Profil'], summary: 'API-Token widerrufen', params: Type.Object({ id: Type.Integer() }) } },
    async (req) => {
      s.tokens.revoke(req.auth, req.params.id);
      return { ok: true };
    },
  );

  app.get('/api/v1/me/favorites', { schema: { tags: ['Profil'], summary: 'Favorisierte Seiten' } }, async (req) => s.social.favorites(req.auth));
  app.get(
    '/api/v1/me/recent',
    { schema: { tags: ['Profil'], summary: 'Zuletzt besuchte Seiten', querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) } },
    async (req) => s.social.recent(req.auth, req.query.limit ?? 20),
  );
  app.get('/api/v1/me/watching', { schema: { tags: ['Profil'], summary: 'Beobachtete Seiten und Bereiche' } }, async (req) => s.social.watching(req.auth));
  app.get('/api/v1/me/drafts', { schema: { tags: ['Profil'], summary: 'Eigene Entwürfe' } }, async (req) => s.drafts.mine(req.auth));

  app.post('/api/v1/me/personal-space', { schema: { tags: ['Profil'], summary: 'Persönlichen Bereich öffnen/anlegen' } }, async (req) => {
    const space = await s.spaces.personalSpace(req.auth, true);
    return s.spaces.toDto(req.auth, space!);
  });

  app.get(
    '/api/v1/me/notifications',
    {
      schema: {
        tags: ['Benachrichtigungen'],
        summary: 'Benachrichtigungen',
        querystring: Type.Object({
          unread: Type.Optional(Type.Boolean()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Offset),
        }),
      },
    },
    async (req) =>
      s.notifications.list(req.auth, {
        unreadOnly: req.query.unread,
        limit: req.query.limit,
        offset: req.query.offset,
        locale: requestLocale(req, s.settings.get('defaultLocale')),
      }),
  );

  app.post(
    '/api/v1/me/notifications/read',
    {
      schema: {
        tags: ['Benachrichtigungen'],
        summary: 'Als gelesen markieren',
        body: Type.Object({ ids: Type.Optional(Type.Array(Type.Integer(), { maxItems: 500 })), all: Type.Optional(Type.Boolean()) }),
      },
    },
    async (req) => {
      s.notifications.markRead(req.auth, req.body.all ? 'all' : (req.body.ids ?? []));
      return { unread: s.notifications.unreadCount(req.auth) };
    },
  );

  app.delete('/api/v1/me/notifications/read', { schema: { tags: ['Benachrichtigungen'], summary: 'Gelesene löschen' } }, async (req) => ({
    deleted: s.notifications.clearRead(req.auth),
  }));

  /* --------------------------------- Personen --------------------------------- */

  app.get(
    '/api/v1/users/search',
    {
      schema: {
        tags: ['Benutzer'],
        summary: 'Benutzer suchen (Erwähnungen, Auswahlfelder)',
        description:
          'Ohne `q` kommen die ersten nach Namen. Mit `task` oder `page` stehen Beteiligte vorn (`involved`), und `access` sagt, ob die Person den Ort sehen darf – eine Erwähnung erreicht sonst niemanden.',
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 100 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          task: Type.Optional(Type.Integer({ minimum: 1 })),
          page: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      },
    },
    async (req) => {
      requireUser(req);
      const context = req.query.task ? s.mentions.forTask(req.auth, req.query.task) : req.query.page ? s.mentions.forPage(req.auth, req.query.page) : null;
      const found = s.users.search(req.query.q ?? '', req.query.limit ?? 10, context?.involved ?? []);
      if (!context) return found;
      return found.map((user) => ({ ...user, access: context.canSee(user.id), involved: context.involved.includes(user.id) }));
    },
  );

  app.get(
    '/api/v1/users/:username',
    { schema: { tags: ['Benutzer'], summary: 'Öffentliches Profil', params: Type.Object({ username: Type.String({ maxLength: 60 }) }) } },
    async (req) => {
      requireUser(req);
      // Erwähnungen verweisen über die numerische Benutzer-ID.
      const row = s.users.byUsername(req.params.username) ?? (/^\d+$/.test(req.params.username) ? s.users.get(Number(req.params.username)) : undefined);
      if (!row) throw notFound('Benutzer nicht gefunden');
      const dto = s.users.toDto(row, { includeGroups: true, includeEmail: s.perms.hasGlobal(req.auth, 'users.manage') || req.auth.user?.id === row.id });
      const activity = s.activity.feed(req.auth, { userId: row.id, limit: 20 });
      const stats = {
        pagesCreated: s.db.value<number>("SELECT COUNT(*) FROM pages WHERE created_by = ? AND status = 'current' AND deleted_at IS NULL", row.id) ?? 0,
        edits: s.db.value<number>('SELECT COUNT(*) FROM page_revisions WHERE author_id = ?', row.id) ?? 0,
        comments: s.db.value<number>('SELECT COUNT(*) FROM comments WHERE author_id = ? AND deleted_at IS NULL', row.id) ?? 0,
      };
      return { user: dto, activity: activity.items, stats };
    },
  );
}
