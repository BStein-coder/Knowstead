import type { Services } from '../../services.ts';
import type { PageRow, SpaceRow, UserRef } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { EVENT_TYPES, type EventRow } from '../../core/events.ts';
import { parseJson } from '../../db/database.ts';
import { pageUrl } from '../pages/service.ts';
import { FREE_TEXT_MIN_FIXED, formatDay, translate } from '../../core/i18n.ts';

export interface ActivityDto {
  id: number;
  type: string;
  label: string;
  category: string;
  actor: UserRef | null;
  actorName: string | null;
  space: { key: string; name: string; icon: string | null } | null;
  page: { id: number; title: string; url: string; deleted: boolean } | null;
  target: { type: string; id: string; label: string | null } | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ChangelogEntry {
  kind: 'revision' | 'event';
  id: string;
  createdAt: string;
  actor: UserRef | null;
  page: { id: number; title: string; url: string; deleted: boolean };
  version?: number;
  changeType: string;
  changeNote: string;
  minor: boolean;
  label: string;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  create: 'Erstellt',
  edit: 'Bearbeitet',
  rename: 'Umbenannt',
  restore: 'Version wiederhergestellt',
  task: 'Aufgabe aktualisiert',
  import: 'Importiert',
  copy: 'Kopiert',
};

export class ActivityService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private toDto(auth: AuthContext, rows: EventRow[]): ActivityDto[] {
    const actors = this.s.users.refs(rows.map((r) => r.actor_id));
    const spaces = new Map<number, SpaceRow | undefined>();
    const pages = new Map<number, PageRow | undefined>();
    return rows.map((r) => {
      let space: SpaceRow | undefined;
      if (r.space_id) {
        if (!spaces.has(r.space_id)) spaces.set(r.space_id, this.s.spaces.get(r.space_id));
        space = spaces.get(r.space_id);
      }
      let page: PageRow | undefined;
      if (r.page_id) {
        if (!pages.has(r.page_id)) pages.set(r.page_id, this.s.pages.get(r.page_id));
        page = pages.get(r.page_id);
      }
      const pageSpace = page ? (spaces.get(page.space_id) ?? this.s.spaces.get(page.space_id)) : undefined;
      return {
        id: r.id,
        type: r.type,
        label: translate(EVENT_TYPES[r.type]?.label ?? r.type, auth.locale ?? 'de'),
        category: r.category,
        actor: actors.get(r.actor_id ?? 0) ?? null,
        actorName: r.actor_name,
        space: space ? { key: space.key, name: space.name, icon: space.icon } : null,
        page:
          page && pageSpace
            ? { id: page.id, title: page.title, url: pageUrl(pageSpace.key, page.id, page.title), deleted: !!page.deleted_at }
            : null,
        target: r.target_type ? { type: r.target_type, id: r.target_id ?? '', label: r.target_label } : null,
        data: parseJson<Record<string, unknown>>(r.data, {}),
        createdAt: r.created_at,
      };
    });
  }

  private visible(auth: AuthContext, row: EventRow): boolean {
    if (row.page_id) {
      const page = this.s.pages.get(row.page_id);
      if (!page) {
        // Endgültig gelöschte Seite: Einschränkungen lassen sich nicht mehr prüfen – Titel nur für
        // Personen, die im Bereich endgültig löschen dürfen (sonst verrät der Feed eingeschränkte Seiten)
        const space = row.space_id ? this.s.spaces.get(row.space_id) : undefined;
        return !!space && this.s.perms.canSpace(auth, space, 'purge');
      }
      const space = this.s.spaces.get(page.space_id);
      if (!space) return false;
      return this.s.perms.canViewPage(auth, page, space, { includeDeleted: true });
    }
    if (row.space_id) {
      const space = this.s.spaces.get(row.space_id);
      return !!space && this.s.perms.canSpace(auth, space, 'view');
    }
    return false;
  }

  /** Aktivitätsfeed (nur Inhaltsereignisse, gefiltert nach Leserechten). */
  feed(auth: AuthContext, options: { spaceId?: number; pageId?: number; userId?: number; before?: number; limit?: number; types?: string[] } = {}) {
    const limit = Math.min(options.limit ?? 30, 100);
    const where: string[] = ["category = 'content'"];
    const params: (string | number)[] = [];
    if (options.spaceId) {
      where.push('space_id = ?');
      params.push(options.spaceId);
    }
    if (options.pageId) {
      where.push('page_id = ?');
      params.push(options.pageId);
    }
    if (options.userId) {
      where.push('actor_id = ?');
      params.push(options.userId);
    }
    if (options.types?.length) {
      where.push(`type IN (${options.types.map(() => '?').join(',')})`);
      params.push(...options.types);
    }
    const result: EventRow[] = [];
    let cursor = options.before ?? Number.MAX_SAFE_INTEGER;
    for (let round = 0; round < 10 && result.length < limit; round++) {
      const rows = this.s.db.all<EventRow>(
        `SELECT * FROM events WHERE ${where.join(' AND ')} AND id < ? ORDER BY id DESC LIMIT ?`,
        ...params,
        cursor,
        limit * 3,
      );
      if (!rows.length) break;
      for (const r of rows) {
        if (this.visible(auth, r)) result.push(r);
        if (result.length >= limit) break;
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < limit * 3) break;
    }
    const items = this.toDto(auth, result);
    return { items, nextBefore: result.length >= limit ? result[result.length - 1].id : null };
  }

  /** Änderungsprotokoll eines Bereichs: Versionen + strukturelle Ereignisse. */
  changelog(
    auth: AuthContext,
    space: SpaceRow,
    options: { from?: string; to?: string; limit?: number; includeMinor?: boolean; pageId?: number } = {},
  ): ChangelogEntry[] {
    this.s.perms.requireSpace(auth, space, 'view');
    const limit = Math.min(options.limit ?? 200, 2000);
    const from = options.from ?? '0000';
    const to = options.to ?? '9999';
    const revisions = this.s.db.all<{
      id: number;
      page_id: number;
      version: number;
      title: string;
      change_note: string;
      change_type: string;
      minor: number;
      author_id: number | null;
      created_at: string;
    }>(
      `SELECT r.id, r.page_id, r.version, r.title, r.change_note, r.change_type, r.minor, r.author_id, r.created_at
       FROM page_revisions r JOIN pages p ON p.id = r.page_id
       WHERE p.space_id = ? AND r.created_at >= ? AND r.created_at <= ? ${options.includeMinor ? '' : 'AND r.minor = 0'}
       ${options.pageId ? 'AND r.page_id = ?' : ''}
       ORDER BY r.created_at DESC LIMIT ?`,
      ...(options.pageId ? [space.id, from, to, options.pageId, limit] : [space.id, from, to, limit]),
    );
    const events = this.s.db.all<EventRow>(
      `SELECT * FROM events WHERE space_id = ? AND type IN ('page.moved', 'page.deleted', 'page.restored', 'page.purged', 'attachment.uploaded', 'attachment.deleted', 'page.copied')
       AND created_at >= ? AND created_at <= ? ${options.pageId ? 'AND page_id = ?' : ''} ORDER BY created_at DESC LIMIT ?`,
      ...(options.pageId ? [space.id, from, to, options.pageId, limit] : [space.id, from, to, limit]),
    );
    const pageIds = new Set<number>([...revisions.map((r) => r.page_id), ...events.map((e) => e.page_id ?? 0)]);
    const pageRows = new Map<number, PageRow>();
    for (const id of pageIds) {
      const p = id ? this.s.pages.get(id) : undefined;
      if (p) pageRows.set(id, p);
    }
    const visiblePages = new Set(
      [...pageRows.values()]
        .filter((p) => this.s.perms.canViewPage(auth, p, space, { includeDeleted: true }))
        .map((p) => p.id),
    );
    const actors = this.s.users.refs([...revisions.map((r) => r.author_id), ...events.map((e) => e.actor_id)]);
    const entries: ChangelogEntry[] = [];
    for (const r of revisions) {
      const p = pageRows.get(r.page_id);
      if (!p || !visiblePages.has(p.id)) continue;
      entries.push({
        kind: 'revision',
        id: `r${r.id}`,
        createdAt: r.created_at,
        actor: actors.get(r.author_id ?? 0) ?? null,
        page: { id: p.id, title: p.title, url: pageUrl(space.key, p.id, p.title), deleted: !!p.deleted_at },
        version: r.version,
        changeType: r.change_type,
        changeNote: translate(r.change_note, auth.locale ?? 'de', FREE_TEXT_MIN_FIXED),
        minor: !!r.minor,
        label: translate(CHANGE_TYPE_LABELS[r.change_type] ?? r.change_type, auth.locale ?? 'de'),
      });
    }
    for (const e of events) {
      const p = e.page_id ? pageRows.get(e.page_id) : undefined;
      if (e.page_id && (!p || !visiblePages.has(p.id))) {
        // Endgültig gelöschte Seiten nur für Personen mit Löschrecht (Titel eingeschränkter Seiten)
        if (e.type !== 'page.purged' || !this.s.perms.canSpace(auth, space, 'purge')) continue;
      }
      const data = parseJson<Record<string, unknown>>(e.data, {});
      let note = '';
      if (e.type === 'attachment.uploaded' || e.type === 'attachment.deleted') note = `${e.target_label ?? ''}`;
      if (e.type === 'page.moved') note = data.fromSpace !== data.toSpace ? `aus Bereich ${data.fromSpace} nach ${data.toSpace}` : '';
      entries.push({
        kind: 'event',
        id: `e${e.id}`,
        createdAt: e.created_at,
        actor: actors.get(e.actor_id ?? 0) ?? null,
        page: p
          ? { id: p.id, title: p.title, url: pageUrl(space.key, p.id, p.title), deleted: !!p.deleted_at }
          : { id: Number(e.target_id ?? 0), title: e.target_label ?? '', url: '', deleted: true },
        changeType: e.type,
        changeNote: note,
        minor: false,
        label: translate(EVENT_TYPES[e.type]?.label ?? e.type, auth.locale ?? 'de'),
      });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  changelogMarkdown(auth: AuthContext, space: SpaceRow, options: { from?: string; to?: string; includeMinor?: boolean } = {}): string {
    const entries = this.changelog(auth, space, { ...options, limit: 2000 });
    const locale = auth.locale ?? this.s.settings.get('defaultLocale');
    const lines: string[] = [`# ${translate('Änderungsprotokoll', locale)} – ${space.name}`, ''];
    const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' });
    let currentDay = '';
    for (const e of entries) {
      const d = new Date(e.createdAt);
      const day = formatDay(d, locale);
      if (day !== currentDay) {
        lines.push('', `## ${day}`, '');
        currentDay = day;
      }
      const link = e.page.url ? `[${e.page.title}](${this.s.config.baseUrl}${e.page.url})` : e.page.title;
      const version = e.version ? ` (v${e.version})` : '';
      const note = e.changeNote ? ` – ${e.changeNote}` : '';
      lines.push(`- ${time.format(d)} · **${e.label}**: ${link}${version}${note} · _${e.actor?.displayName ?? translate('System', locale)}_`);
    }
    if (!entries.length) lines.push(`_${translate('Keine Änderungen im gewählten Zeitraum.', locale)}_`);
    return lines.join('\n') + '\n';
  }

  /* ------------------------------ Audit-Log ------------------------------ */

  audit(
    auth: AuthContext,
    filter: { category?: string; type?: string; actorId?: number; q?: string; from?: string; to?: string; limit?: number; offset?: number },
  ) {
    this.s.perms.requireGlobal(auth, 'audit.view');
    const where: string[] = ['1 = 1'];
    const params: (string | number)[] = [];
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter.type) {
      where.push(filter.type.endsWith('.*') ? 'type LIKE ?' : 'type = ?');
      params.push(filter.type.endsWith('.*') ? `${filter.type.slice(0, -1)}%` : filter.type);
    }
    if (filter.actorId) {
      where.push('actor_id = ?');
      params.push(filter.actorId);
    }
    if (filter.q) {
      where.push('(target_label LIKE ? OR actor_name LIKE ? OR data LIKE ? OR ip LIKE ?)');
      const like = `%${filter.q}%`;
      params.push(like, like, like, like);
    }
    if (filter.from) {
      where.push('created_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('created_at <= ?');
      params.push(filter.to);
    }
    const limit = Math.min(filter.limit ?? 50, 1000);
    const offset = filter.offset ?? 0;
    const total = this.s.db.value<number>(`SELECT COUNT(*) FROM events WHERE ${where.join(' AND ')}`, ...params) ?? 0;
    const rows = this.s.db.all<EventRow>(
      `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    return {
      items: this.toDto(auth, rows).map((dto, i) => ({ ...dto, ip: rows[i].ip, userAgent: rows[i].user_agent })),
      total,
      limit,
      offset,
    };
  }

  auditCsv(auth: AuthContext, filter: Parameters<ActivityService['audit']>[1]): string {
    const { items } = this.audit(auth, { ...filter, limit: 1000, offset: 0 });
    const esc = (v: unknown) => {
      let str = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      // Formel-Injektion verhindern: Tabellenprogramme führen Zellen mit = + - @ als Formel aus
      // (z. B. ein Benutzername „=HYPERLINK(…)“ aus einem fehlgeschlagenen Anmeldeversuch)
      if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      return `"${str.replace(/"/g, '""')}"`;
    };
    const header = ['Zeitpunkt', 'Kategorie', 'Ereignis', 'Beschreibung', 'Akteur', 'Ziel', 'Bereich', 'IP', 'Details'].map((h) => translate(h, auth.locale ?? 'de'));
    const lines = items.map((i) =>
      [i.createdAt, i.category, i.type, i.label, i.actorName ?? i.actor?.displayName ?? '', i.target?.label ?? '', i.space?.key ?? '', i.ip ?? '', i.data]
        .map(esc)
        .join(';'),
    );
    return '\uFEFF' + [header.map(esc).join(';'), ...lines].join('\r\n');
  }

  pruneOld(): number {
    const days = this.s.settings.get('eventRetentionDays');
    if (days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return this.s.db.run('DELETE FROM events WHERE created_at < ?', cutoff).changes;
  }
}
