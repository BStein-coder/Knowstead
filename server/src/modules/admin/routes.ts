import fs from 'node:fs';
import path from 'node:path';
import Type from 'typebox';
import type { App } from '../../http.ts';
import { IdParam, Nullable, Offset } from '../../http.ts';
import type { Services } from '../../services.ts';
import { EVENT_TYPES } from '../../core/events.ts';
import { GLOBAL_PERMISSIONS, ROLE_LABELS, SPACE_ACTIONS, SPACE_ROLES } from '../../core/permissions.ts';
import { TOKEN_SCOPES } from '../tokens/service.ts';
import { badRequest } from '../../core/errors.ts';
import { syncHandbook } from '../../seed/index.ts';
import { renderMail } from '../mail/templates.ts';
import { localeOfPreferences, requestLocale, translator } from '../../core/i18n.ts';
import { CHECKLIST_DISMISSED_KEY, setupChecklist } from '../system/checklist.ts';

const StrMap = Type.Record(Type.String(), Type.String());

export async function adminRoutes(app: App, s: Services): Promise<void> {
  const tags = ['Administration'];

  app.get('/api/v1/admin/stats', { schema: { tags, summary: 'Kennzahlen' } }, async (req) => s.admin.stats(req.auth));
  app.get('/api/v1/admin/system', { schema: { tags, summary: 'Systeminformationen' } }, async (req) => s.admin.system(req.auth));

  app.get('/api/v1/admin/alerts', { schema: { tags, summary: 'Betriebswarnungen: was gerade vorliegt und ob E-Mails hinausgehen' } }, async (req) => s.alerts.overview(req.auth));

  app.post('/api/v1/admin/alerts/test', { schema: { tags, summary: 'Testwarnung an alle Empfänger der Betriebswarnungen schicken' } }, async (req) => s.alerts.sendTest(req.auth));

  app.get('/api/v1/admin/setup-checklist', { schema: { tags, summary: 'Nächste Schritte nach der Einrichtung: offene und erledigte Punkte' } }, async (req) => setupChecklist(s, req.auth));

  app.put(
    '/api/v1/admin/setup-checklist',
    { schema: { tags, summary: 'Hinweis „Einrichtung vervollständigen“ in der Übersicht aus- oder einblenden', body: Type.Object({ dismissed: Type.Boolean() }) } },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'admin');
      s.settings.setInternal(CHECKLIST_DISMISSED_KEY, req.body.dismissed);
      return setupChecklist(s, req.auth);
    },
  );

  app.get('/api/v1/catalog', { schema: { tags: ['System'], summary: 'Rechte-, Rollen- und Ereigniskatalog' } }, async (req) => {
    s.perms.requireUser(req.auth);
    const tr = translator(requestLocale(req, s.settings.get('defaultLocale')));
    return {
      globalPermissions: Object.fromEntries(Object.entries(GLOBAL_PERMISSIONS).map(([key, p]) => [key, { label: tr(p.label), description: tr(p.description) }])),
      spaceRoles: SPACE_ROLES.map((r) => ({ role: r, label: tr(ROLE_LABELS[r]), actions: Object.entries(SPACE_ACTIONS).filter(([, min]) => SPACE_ROLES.indexOf(min) <= SPACE_ROLES.indexOf(r)).map(([a]) => a) })),
      events: Object.entries(EVENT_TYPES).map(([type, meta]) => ({ type, ...meta, label: tr(meta.label) })),
      tokenScopes: Object.fromEntries(Object.entries(TOKEN_SCOPES).map(([key, label]) => [key, tr(label)])),
    };
  });

  /* ------------------------------ Einstellungen ------------------------------ */

  app.get('/api/v1/admin/settings', { schema: { tags, summary: 'Systemeinstellungen' } }, async (req) => s.admin.getSettings(req.auth));

  app.put(
    '/api/v1/admin/settings',
    { schema: { tags, summary: 'Systemeinstellungen ändern', body: Type.Record(Type.String(), Type.Unknown()) } },
    async (req) => s.admin.updateSettings(req.auth, req.body as never),
  );

  app.post(
    '/api/v1/admin/settings/test-mail',
    { schema: { tags, summary: 'Test-E-Mail senden', body: Type.Object({ to: Type.String({ minLength: 3 }) }) } },
    async (req) => {
      await s.admin.testMail(req.auth, req.body.to);
      return { ok: true };
    },
  );

  /* -------------------------------- Benutzer -------------------------------- */

  app.get(
    '/api/v1/admin/users',
    {
      schema: {
        tags,
        summary: 'Benutzer verwalten',
        querystring: Type.Object({
          q: Type.Optional(Type.String()),
          status: Type.Optional(Type.String()),
          kind: Type.Optional(Type.String()),
          group: Type.Optional(Type.Integer()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
          offset: Type.Optional(Offset),
        }),
      },
    },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      return s.users.list({ ...req.query, groupId: req.query.group });
    },
  );

  app.post(
    '/api/v1/admin/users',
    {
      schema: {
        tags,
        summary: 'Benutzer oder Dienstkonto anlegen',
        body: Type.Object({
          username: Type.String({ minLength: 2, maxLength: 40 }),
          displayName: Type.String({ minLength: 1, maxLength: 80 }),
          email: Type.Optional(Nullable(Type.String())),
          password: Type.Optional(Nullable(Type.String())),
          kind: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('bot')])),
          groupIds: Type.Optional(Type.Array(Type.Integer())),
        }),
      },
    },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      const adminGroupIds = s.groups.list().filter((g) => g.permissions.includes('admin')).map((g) => g.id);
      if (!req.auth.isAdmin && (req.body.groupIds ?? []).some((id) => adminGroupIds.includes(id))) {
        throw badRequest('Nur Administratoren dürfen Administratoren anlegen');
      }
      const row = s.users.create({ ...req.body, skipDefaultGroups: req.body.kind === 'bot' }, req.auth);
      return s.users.toDto(row, { includeGroups: true });
    },
  );

  app.get('/api/v1/admin/users/:id', { schema: { tags, summary: 'Benutzerdetails', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    const row = s.users.require(req.params.id);
    return {
      user: s.users.toDto(row, { includeGroups: true }),
      tokens: s.tokens.listForUser(row.id),
      sessions: s.db.value<number>('SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ?', row.id, new Date().toISOString()) ?? 0,
      lockedUntil: row.locked_until,
      registrationPendingAt: row.registration_pending_at,
    };
  });

  app.patch(
    '/api/v1/admin/users/:id',
    {
      schema: {
        tags,
        summary: 'Benutzer ändern',
        params: IdParam,
        body: Type.Object({
          displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          email: Type.Optional(Nullable(Type.String())),
          groupIds: Type.Optional(Type.Array(Type.Integer())),
        }),
      },
    },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      s.users.requireManageable(req.auth, req.params.id);
      return s.users.toDto(s.users.update(req.params.id, req.body, req.auth), { includeGroups: true });
    },
  );

  app.post(
    '/api/v1/admin/users/:id/status',
    {
      schema: {
        tags,
        summary: 'Benutzer aktivieren/deaktivieren',
        params: IdParam,
        body: Type.Object({ status: Type.Union([Type.Literal('active'), Type.Literal('disabled')]) }),
      },
    },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      s.users.requireManageable(req.auth, req.params.id);
      s.users.setStatus(req.params.id, req.body.status, req.auth);
      return { ok: true };
    },
  );

  app.post(
    '/api/v1/admin/users/:id/password',
    { schema: { tags, summary: 'Passwort setzen', params: IdParam, body: Type.Object({ password: Type.String({ minLength: 1, maxLength: 200 }) }) } },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      s.users.requireManageable(req.auth, req.params.id);
      const row = s.users.require(req.params.id);
      s.users.setPassword(row.id, req.body.password);
      s.db.run('DELETE FROM sessions WHERE user_id = ?', row.id);
      s.emit(req.auth, { type: 'auth.password_changed', target: { type: 'user', id: row.id, label: row.username }, data: { byAdmin: true } });
      return { ok: true };
    },
  );

  app.post('/api/v1/admin/users/:id/reset-link', { schema: { tags, summary: 'Link zum Zurücksetzen erzeugen', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    s.users.requireManageable(req.auth, req.params.id);
    const row = s.users.require(req.params.id);
    const token = s.auth.createResetToken(row.id, 48);
    s.emit(req.auth, { type: 'auth.password_reset_requested', target: { type: 'user', id: row.id, label: row.username }, data: { byAdmin: true } });
    return { url: `${s.config.baseUrl}/reset-password/${token}`, expiresInHours: 48 };
  });

  app.post('/api/v1/admin/users/:id/invite', { schema: { tags, summary: 'Einladung mit Link zum Festlegen des Passworts per E-Mail senden', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    s.users.requireManageable(req.auth, req.params.id);
    const row = s.users.require(req.params.id);
    if (!row.email) throw badRequest('Für dieses Konto ist keine E-Mail-Adresse hinterlegt');
    if (row.kind === 'bot') throw badRequest('Dienstkonten melden sich nicht an');
    if (!s.mailer.isConfigured()) throw badRequest('Der E-Mail-Versand ist noch nicht eingerichtet (Administration → E-Mail)');
    const token = s.auth.createResetToken(row.id, 72);
    const site = s.settings.get('siteName');
    s.mail.enqueue({
      to: row.email,
      userId: row.id,
      kind: 'invite',
      mail: renderMail(s.mail.brand(), `Einladung zu ${site}`, {
        heading: `Willkommen bei ${site}`,
        paragraphs: [
          `Hallo ${row.display_name},`,
          `${req.auth.user?.displayName ?? 'Die Administration'} hat für dich ein Konto angelegt. Dein Benutzername: ${row.username}`,
          'Lege über den folgenden Link dein Passwort fest. Der Link ist drei Tage gültig.',
        ],
        action: { label: 'Passwort festlegen', url: `/reset-password/${token}` },
        reason: `Du erhältst diese E-Mail, weil für dich ein Konto in ${site} angelegt wurde.`,
      }, localeOfPreferences(s.users.preferences(row.id), s.settings.get('defaultLocale'))),
    });
    s.emit(req.auth, { type: 'auth.password_reset_requested', target: { type: 'user', id: row.id, label: row.username }, data: { byAdmin: true, invite: true } });
    return { ok: true, to: row.email };
  });

  app.post('/api/v1/admin/users/:id/unlock', { schema: { tags, summary: 'Anmeldesperre aufheben, unbestätigte Registrierung freischalten', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    s.users.requireManageable(req.auth, req.params.id);
    s.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, registration_pending_at = NULL WHERE id = ?', req.params.id);
    return { ok: true };
  });

  app.delete('/api/v1/admin/users/:id', { schema: { tags, summary: 'Benutzer löschen', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    s.users.requireManageable(req.auth, req.params.id);
    s.users.delete(req.params.id, req.auth);
    return { ok: true };
  });

  app.post(
    '/api/v1/admin/users/:id/tokens',
    {
      schema: {
        tags,
        summary: 'Token für ein Dienstkonto erzeugen',
        params: IdParam,
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          scopes: Type.Array(Type.String(), { minItems: 1 }),
          expiresInDays: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
        }),
      },
    },
    async (req) => s.tokens.create(req.auth, { ...req.body, userId: req.params.id }),
  );

  /* --------------------------------- Gruppen --------------------------------- */

  app.get('/api/v1/groups', { schema: { tags: ['Benutzer'], summary: 'Gruppen (für Auswahlfelder)', querystring: Type.Object({ q: Type.Optional(Type.String()) }) } }, async (req) => {
    s.perms.requireUser(req.auth);
    return s.groups.list(req.query.q);
  });

  app.get('/api/v1/admin/groups/:id', { schema: { tags, summary: 'Gruppe mit Mitgliedern', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    return { group: s.groups.toDto(s.groups.require(req.params.id)), members: s.groups.members(req.params.id) };
  });

  const GroupBody = Type.Object({
    name: Type.String({ minLength: 2, maxLength: 60 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    permissions: Type.Optional(Type.Array(Type.String())),
    isDefault: Type.Optional(Type.Boolean()),
    /** Zugeordnete AD-/LDAP-Sicherheitsgruppen (DN, CN oder sAMAccountName) */
    directoryGroups: Type.Optional(Type.Array(Type.String({ maxLength: 400 }))),
    syncEnabled: Type.Optional(Type.Boolean()),
  });

  app.post('/api/v1/admin/groups', { schema: { tags, summary: 'Gruppe anlegen', body: GroupBody } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    return s.groups.create(req.body, req.auth);
  });

  app.patch('/api/v1/admin/groups/:id', { schema: { tags, summary: 'Gruppe ändern', params: IdParam, body: Type.Partial(GroupBody) } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    return s.groups.update(req.params.id, req.body, req.auth);
  });

  app.delete('/api/v1/admin/groups/:id', { schema: { tags, summary: 'Gruppe löschen', params: IdParam } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    s.groups.delete(req.params.id, req.auth);
    return { ok: true };
  });

  app.put(
    '/api/v1/admin/groups/:id/members',
    { schema: { tags, summary: 'Mitglieder setzen', params: IdParam, body: Type.Object({ userIds: Type.Array(Type.Integer()) }) } },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      return s.groups.setMembers(req.params.id, req.body.userIds, req.auth);
    },
  );

  app.get('/api/v1/admin/office-preview', { schema: { tags, summary: 'Status der Office-Vorschau (LibreOffice)' } }, async (req) =>
    s.previews.status(req.auth),
  );

  app.get('/api/v1/admin/ocr', { schema: { tags, summary: 'Status der Texterkennung (Tesseract)' } }, async (req) => s.attachmentText.ocrStatus(req.auth));

  /* --------------------------- Verzeichnis (AD/LDAP) --------------------------- */

  app.post(
    '/api/v1/admin/directory/test',
    {
      schema: {
        tags,
        summary: 'Verbindung zum Verzeichnis prüfen (optional mit Testkonto)',
        body: Type.Object({
          login: Type.Optional(Type.String({ maxLength: 200 })),
          password: Type.Optional(Type.String({ maxLength: 200 })),
        }),
      },
    },
    async (req) => {
      const result = await s.directory.test(req.auth, req.body);
      const tr = translator(req.auth.locale ?? 'de');
      return { ...result, steps: result.steps.map((step) => ({ ...step, label: tr(step.label), detail: tr(step.detail) })) };
    },
  );

  app.get(
    '/api/v1/admin/directory/groups',
    {
      schema: {
        tags,
        summary: 'Sicherheitsgruppen im Verzeichnis suchen',
        querystring: Type.Object({ q: Type.Optional(Type.String({ maxLength: 100 })) }),
      },
    },
    async (req) => ({ items: await s.directory.searchGroups(req.auth, req.query.q ?? '') }),
  );

  app.post(
    '/api/v1/admin/directory/sync/:id',
    { schema: { tags, summary: 'Gruppenmitgliedschaften eines Benutzers neu abgleichen', params: IdParam } },
    async (req) => {
      s.perms.requireGlobal(req.auth, 'users.manage');
      const user = s.users.require(req.params.id);
      if (user.auth_source !== 'ldap') throw badRequest('Dieses Konto stammt nicht aus dem Verzeichnis');
      const result = await s.directory.resync(req.auth, user);
      return result;
    },
  );

  /* ------------------------------ Bereiche & Tokens ------------------------------ */

  app.get('/api/v1/admin/spaces', { schema: { tags, summary: 'Alle Bereiche' } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'admin');
    return s.spaces.list(req.auth, { includeArchived: true });
  });

  app.get('/api/v1/admin/tokens', { schema: { tags, summary: 'Alle API-Tokens' } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'users.manage');
    return s.tokens.listAll();
  });

  app.delete('/api/v1/admin/tokens/:id', { schema: { tags, summary: 'Token widerrufen', params: IdParam } }, async (req) => {
    s.tokens.revoke(req.auth, req.params.id);
    return { ok: true };
  });

  /* -------------------------------- Webhooks -------------------------------- */

  const WebhookBody = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 100 }),
    url: Type.String({ minLength: 8, maxLength: 2000 }),
    events: Type.Array(Type.String(), { minItems: 1 }),
    spaceId: Type.Optional(Nullable(Type.Integer())),
    headers: Type.Optional(StrMap),
    active: Type.Optional(Type.Boolean()),
  });

  app.get('/api/v1/admin/webhooks', { schema: { tags: ['Integrationen'], summary: 'Webhooks' } }, async (req) => s.webhooks.list(req.auth));
  app.post('/api/v1/admin/webhooks', { schema: { tags: ['Integrationen'], summary: 'Webhook anlegen', body: WebhookBody } }, async (req) =>
    s.webhooks.create(req.auth, req.body),
  );
  app.patch(
    '/api/v1/admin/webhooks/:id',
    { schema: { tags: ['Integrationen'], summary: 'Webhook ändern', params: IdParam, body: Type.Partial(WebhookBody) } },
    async (req) => s.webhooks.update(req.auth, req.params.id, req.body),
  );
  app.delete('/api/v1/admin/webhooks/:id', { schema: { tags: ['Integrationen'], summary: 'Webhook löschen', params: IdParam } }, async (req) => {
    s.webhooks.delete(req.auth, req.params.id);
    return { ok: true };
  });
  app.post('/api/v1/admin/webhooks/:id/test', { schema: { tags: ['Integrationen'], summary: 'Testzustellung', params: IdParam } }, async (req) =>
    s.webhooks.test(req.auth, req.params.id),
  );
  app.post('/api/v1/admin/webhooks/:id/rotate-secret', { schema: { tags: ['Integrationen'], summary: 'Signaturgeheimnis erneuern', params: IdParam } }, async (req) => ({
    secret: s.webhooks.rotateSecret(req.auth, req.params.id),
  }));
  app.get('/api/v1/admin/webhooks/:id/deliveries', { schema: { tags: ['Integrationen'], summary: 'Zustellprotokoll', params: IdParam } }, async (req) =>
    s.webhooks.deliveries(req.auth, req.params.id),
  );
  app.post('/api/v1/admin/webhooks/deliveries/:id/redeliver', { schema: { tags: ['Integrationen'], summary: 'Zustellung wiederholen', params: IdParam } }, async (req) =>
    s.webhooks.redeliver(req.auth, req.params.id),
  );

  /* ------------------------------ API-Konnektoren ------------------------------ */

  const ConnectorBody = Type.Object({
    key: Type.String({ minLength: 2, maxLength: 40 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    baseUrl: Type.String({ minLength: 8, maxLength: 2000 }),
    authType: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('bearer'), Type.Literal('basic'), Type.Literal('header'), Type.Literal('query')])),
    auth: Type.Optional(
      Type.Union([
        Type.Object({
          token: Type.Optional(Type.String()),
          username: Type.Optional(Type.String()),
          password: Type.Optional(Type.String()),
          name: Type.Optional(Type.String()),
          value: Type.Optional(Type.String()),
        }),
        Type.Null(),
      ]),
    ),
    headers: Type.Optional(StrMap),
    allowedPaths: Type.Optional(Type.Array(Type.String())),
    cacheTtl: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000 })),
    active: Type.Optional(Type.Boolean()),
  });

  app.get('/api/v1/admin/connectors', { schema: { tags: ['Integrationen'], summary: 'API-Konnektoren' } }, async (req) => s.connectors.list(req.auth));
  app.post('/api/v1/admin/connectors', { schema: { tags: ['Integrationen'], summary: 'Konnektor anlegen', body: ConnectorBody } }, async (req) =>
    s.connectors.create(req.auth, req.body),
  );
  app.patch(
    '/api/v1/admin/connectors/:id',
    { schema: { tags: ['Integrationen'], summary: 'Konnektor ändern', params: IdParam, body: Type.Partial(ConnectorBody) } },
    async (req) => s.connectors.update(req.auth, req.params.id, req.body),
  );
  app.delete('/api/v1/admin/connectors/:id', { schema: { tags: ['Integrationen'], summary: 'Konnektor löschen', params: IdParam } }, async (req) => {
    s.connectors.delete(req.auth, req.params.id);
    return { ok: true };
  });
  app.post(
    '/api/v1/admin/connectors/:id/test',
    { schema: { tags: ['Integrationen'], summary: 'Testabfrage', params: IdParam, body: Type.Object({ path: Type.String({ maxLength: 2000 }) }) } },
    async (req) => s.connectors.test(req.auth, req.params.id, req.body.path),
  );

  /* --------------------------------- Plugins --------------------------------- */

  app.get('/api/v1/admin/plugins', { schema: { tags: ['Plugins'], summary: 'Installierte Plugins' } }, async (req) => s.plugins.list(req.auth));
  app.post('/api/v1/admin/plugins/rescan', { schema: { tags: ['Plugins'], summary: 'Plugin-Verzeichnis neu einlesen' } }, async (req) => s.plugins.rescan(req.auth));
  app.post(
    '/api/v1/admin/plugins/:pluginId/enabled',
    {
      schema: {
        tags: ['Plugins'],
        summary: 'Plugin aktivieren/deaktivieren',
        params: Type.Object({ pluginId: Type.String() }),
        body: Type.Object({ enabled: Type.Boolean() }),
      },
    },
    async (req) => s.plugins.setEnabled(req.auth, req.params.pluginId, req.body.enabled),
  );
  app.put(
    '/api/v1/admin/plugins/:pluginId/settings',
    {
      schema: {
        tags: ['Plugins'],
        summary: 'Plugin-Einstellungen speichern',
        params: Type.Object({ pluginId: Type.String() }),
        body: Type.Record(Type.String(), Type.Unknown()),
      },
    },
    async (req) => s.plugins.updateSettings(req.auth, req.params.pluginId, req.body as Record<string, unknown>),
  );

  /* -------------------------------- Audit-Log -------------------------------- */

  const AuditQuery = Type.Object({
    category: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    actor: Type.Optional(Type.Integer()),
    q: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    offset: Type.Optional(Offset),
  });

  app.get('/api/v1/admin/audit', { schema: { tags, summary: 'Audit-Log', querystring: AuditQuery } }, async (req) =>
    s.activity.audit(req.auth, { ...req.query, actorId: req.query.actor }),
  );

  app.get('/api/v1/admin/audit.csv', { schema: { tags, summary: 'Audit-Log als CSV', querystring: AuditQuery } }, async (req, reply) => {
    const csv = s.activity.auditCsv(req.auth, { ...req.query, actorId: req.query.actor });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return csv;
  });

  /* -------------------------------- Sicherungen -------------------------------- */

  app.get('/api/v1/admin/backups', { schema: { tags, summary: 'Sicherungen' } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'admin');
    return s.backups.list();
  });

  app.post('/api/v1/admin/backups', { schema: { tags, summary: 'Sicherung erstellen' } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'admin');
    return s.backups.create(req.auth, 'manuell');
  });

  app.delete('/api/v1/admin/backups/:name', { schema: { tags, summary: 'Sicherung löschen', params: Type.Object({ name: Type.String() }) } }, async (req) => {
    s.perms.requireGlobal(req.auth, 'admin');
    s.backups.delete(req.auth, req.params.name);
    return { ok: true };
  });

  app.get(
    '/api/v1/admin/backups/:name/download',
    { schema: { tags, summary: 'Sicherung als ZIP herunterladen', params: Type.Object({ name: Type.String() }) } },
    async (req, reply) => {
      s.perms.requireGlobal(req.auth, 'admin');
      const stream = s.backups.zip(req.params.name);
      reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${req.params.name}.zip"`);
      return reply.send(stream);
    },
  );

  /* -------------------------------- Wartung -------------------------------- */

  app.get('/api/v1/admin/attachments/index', { schema: { tags, summary: 'Stand der Volltextindexierung von Anhängen' } }, async (req) => s.attachmentText.status(req.auth));

  app.post(
    '/api/v1/admin/maintenance/sync-handbook',
    { schema: { tags, summary: 'Handbuch aktualisieren (fehlende Kapitel anlegen, unveränderte Kapitel erneuern)' } },
    async (req) => {
      const result = await syncHandbook(s, req.auth);
      s.emit(req.auth, { type: 'maintenance.run', target: { type: 'maintenance', id: 'sync-handbook', label: 'sync-handbook' }, data: result });
      return result;
    },
  );

  app.post(
    '/api/v1/admin/maintenance/:task',
    {
      schema: {
        tags,
        summary: 'Wartungsaufgabe ausführen',
        params: Type.Object({
          task: Type.Union([
            Type.Literal('reindex'),
            Type.Literal('reindex-attachments'),
            Type.Literal('vacuum'),
            Type.Literal('purge-trash'),
            Type.Literal('prune-events'),
            Type.Literal('cleanup-sessions'),
          ]),
        }),
      },
    },
    async (req) => s.admin.runMaintenance(req.auth, req.params.task),
  );

  app.get('/api/v1/release-notes', { schema: { tags: ['System'], summary: 'Versionshinweise (CHANGELOG.md)' } }, async (req) => {
    s.perms.requireUser(req.auth);
    const file = path.join(s.config.rootDir, 'CHANGELOG.md');
    return { version: s.config.version, markdown: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
  });
}
