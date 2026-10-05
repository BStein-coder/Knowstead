/**
 * Plugin „Chat-Benachrichtigungen“.
 *
 * Hört auf Knowstead-Ereignisse und schickt sie als Nachricht an einen eingehenden
 * Webhook von Microsoft Teams, Slack, Mattermost oder Discord.
 *
 * Zeigt beispielhaft: Ereignis-Abonnements, verschlüsselte Einstellungen,
 * Plugin-Speicher und eine eigene Admin-Route.
 */
import type { DomainEvent } from '../../server/src/core/events.ts';
import { EVENT_TYPES } from '../../server/src/core/events.ts';
import type { PluginContext, PluginRegister } from '../../server/src/plugins/types.ts';
import { isLocale, translate, type Locale } from '../../server/src/core/i18n.ts';

interface PageInfo {
  title: string;
  excerpt: string;
  space_key: string;
  space_name: string;
}

interface Status {
  sent: number;
  failed: number;
  lastType: string | null;
  lastAt: string | null;
  lastError: string | null;
}

const EMPTY_STATUS: Status = { sent: 0, failed: 0, lastType: null, lastAt: null, lastError: null };

const COLORS: Record<string, string> = {
  content: '2563eb',
  security: 'dc2626',
  admin: '7c3aed',
  system: '64748b',
};

const matches = (pattern: string, type: string): boolean =>
  pattern === '*' || pattern === type || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1)));

const splitList = (value: unknown): string[] =>
  String(value ?? '')
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/** Nachrichten an den Chat in der Standardsprache der Installation */
const localeOf = (ctx: PluginContext): Locale => ctx.services.settings.get('defaultLocale');

function label(type: string, locale: Locale): string {
  return translate(EVENT_TYPES[type]?.label ?? type, locale);
}

/** Nachrichtentext ohne Formatierung – die Formate hängen Links selbst an. */
function describe(ctx: PluginContext, event: DomainEvent, page: PageInfo | null): { title: string; body: string; url: string | null } {
  const locale = localeOf(ctx);
  const actor = event.actor?.displayName ?? translate('System', locale);
  const targetLabel = page?.title ?? event.target?.label ?? '';
  const where = page?.space_name ? ` (${page.space_name})` : '';
  const url = event.pageId && page ? `${ctx.config.baseUrl}/s/${encodeURIComponent(page.space_key)}/p/${event.pageId}` : null;
  const lines: string[] = [];
  if (targetLabel) lines.push(`**${targetLabel}**${where}`);
  const note = typeof event.data.note === 'string' ? event.data.note : '';
  if (note) lines.push(`${translate('Änderungsnotiz', locale)}: ${note}`);
  const text = typeof event.data.text === 'string' ? event.data.text : '';
  if (text) lines.push(text.slice(0, 400));
  if (!text && page?.excerpt && ctx.settings.get<boolean>('includeExcerpt')) lines.push(page.excerpt.slice(0, 300));
  return { title: `${label(event.type, locale)} – ${actor}`, body: lines.join('\n'), url };
}

function buildPayload(format: string, event: DomainEvent, msg: { title: string; body: string; url: string | null }, locale: Locale): unknown {
  switch (format) {
    case 'slack':
    case 'mattermost':
      return {
        text: msg.url ? `*${msg.title}*\n${msg.body}\n<${msg.url}|${translate('Seite öffnen', locale)}>` : `*${msg.title}*\n${msg.body}`,
        username: 'Knowstead',
      };
    case 'discord':
      return {
        username: 'Knowstead',
        embeds: [
          {
            title: msg.title,
            description: msg.body.slice(0, 1800) || undefined,
            url: msg.url ?? undefined,
            color: Number.parseInt(COLORS[event.category] ?? '64748b', 16),
            timestamp: event.createdAt,
          },
        ],
      };
    case 'json':
      return { event, message: [msg.title, msg.body, msg.url].filter(Boolean).join('\n') };
    default:
      return {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: msg.title,
        themeColor: COLORS[event.category] ?? '2563eb',
        title: msg.title,
        text: msg.body.replace(/\n/g, '\n\n'),
        potentialAction: msg.url
          ? [{ '@type': 'OpenUri', name: translate('In Knowstead öffnen', locale), targets: [{ os: 'default', uri: msg.url }] }]
          : undefined,
      };
  }
}

const register: PluginRegister = (ctx) => {
  const status = (): Status => ctx.storage.get<Status>('status', EMPTY_STATUS) ?? EMPTY_STATUS;

  const pageInfo = (pageId: number | null): PageInfo | null =>
    pageId
      ? ctx.services.db.get<PageInfo>(
          `SELECT p.title, p.excerpt, s.key AS space_key, s.name AS space_name
             FROM pages p JOIN spaces s ON s.id = p.space_id WHERE p.id = ?`,
          pageId,
        ) ?? null
      : null;

  const post = async (payload: unknown): Promise<void> => {
    const url = String(ctx.settings.get<string>('url') ?? '');
    if (!/^https:\/\//i.test(url)) throw new Error('Es ist keine gültige https-Webhook-URL hinterlegt');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `Knowstead/${ctx.config.version}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      // Keine Weiterleitungen folgen (sonst landet die Nachricht evtl. woanders).
      redirect: 'manual',
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  };

  const send = async (event: DomainEvent): Promise<void> => {
    const format = String(ctx.settings.get<string>('format') ?? 'teams');
    const payload = buildPayload(format, event, describe(ctx, event, pageInfo(event.pageId)), localeOf(ctx));
    const before = status();
    try {
      await post(payload);
      ctx.storage.set('status', { ...before, sent: before.sent + 1, lastType: event.type, lastAt: new Date().toISOString(), lastError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.storage.set('status', { ...before, failed: before.failed + 1, lastType: event.type, lastAt: new Date().toISOString(), lastError: message });
      ctx.log.warn(`Nachricht konnte nicht zugestellt werden: ${message}`);
    }
  };

  ctx.events.on('*', async (event) => {
    const patterns = splitList(ctx.settings.get('events'));
    if (!patterns.some((p) => matches(p, event.type))) return;
    const spaces = splitList(ctx.settings.get('spaces')).map((s) => s.toUpperCase());
    if (spaces.length) {
      const key = event.spaceId
        ? ctx.services.db.value<string>('SELECT key FROM spaces WHERE id = ?', event.spaceId)
        : null;
      if (!key || !spaces.includes(key.toUpperCase())) return;
    }
    await send(event);
  });

  ctx.routes.get('/status', () => ({ ...status(), configured: !!ctx.settings.get<string>('url') }), { admin: true });

  ctx.routes.post(
    '/test',
    async (req) => {
      const requested = req.headers['x-knowstead-locale'] ?? req.headers['x-doku-locale'];
      const locale: Locale = isLocale(requested) ? requested : localeOf(ctx);
      const now = new Date().toISOString();
      const demo: DomainEvent = {
        id: 0,
        type: 'page.updated',
        category: 'content',
        actor: { id: 0, username: 'knowstead', displayName: 'Knowstead' },
        spaceId: null,
        pageId: null,
        target: { type: 'page', id: '0', label: translate('Testnachricht', locale) },
        data: { text: translate('Wenn du das liest, funktioniert die Verbindung zum Chat.', locale) },
        ip: null,
        createdAt: now,
      };
      try {
        await post(buildPayload(String(ctx.settings.get<string>('format') ?? 'teams'), demo, describe(ctx, demo, null), localeOf(ctx)));
        return { ok: true, message: translate('Testnachricht wurde gesendet.', locale) };
      } catch (err) {
        return ctx.respond({ ok: false, message: err instanceof Error ? err.message : String(err) }, 502);
      }
    },
    { admin: true },
  );
};

export default register;
