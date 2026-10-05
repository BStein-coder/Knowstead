/**
 * Inhaltsanalyse – eine Arbeitsliste für die Redaktion:
 *
 * - meistgelesene Seiten im Zeitraum (Aufrufe je Tag, Leserinnen und Leser),
 * - Seiten, die außer ihren Autorinnen und Autoren niemand liest,
 * - Suchbegriffe ohne Treffer (Tagessummen, ohne Personenbezug),
 * - verwaiste Seiten (kein Verweis von einer anderen Seite),
 * - defekte Verweise auf gelöschte oder nicht vorhandene Seiten und Anhänge.
 *
 * Sichtbar für die Bereichsverwaltung (Aktion `moderate`) in ihren Bereichen und für das globale
 * Recht `analytics.view` in allen lesbaren Bereichen. Seitenlisten beachten Seiteneinschränkungen;
 * Suchbegriffe sehen nur `analytics.view` und die Systemadministration.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow, SpaceRow } from '../../core/types.ts';
import { Db, nowIso } from '../../db/database.ts';
import { badRequest, forbidden } from '../../core/errors.ts';
import { extractPageLinks } from '../../core/html.ts';
import { parse } from 'node-html-parser';
import type { PageSummary } from '../pages/service.ts';
import { translator, type Locale } from '../../core/i18n.ts';

/** Version der Verweis-Ableitung – erhöhen, wenn `extractRefs` sich ändert (Neuberechnung beim Start). */
const REFS_VERSION = 1;
const VIEW_RETENTION_DAYS = 400;
const SEARCH_RETENTION_DAYS = 180;

export type DismissKind = 'search' | 'orphan' | 'link' | 'unread';

const ATTACHMENT_URL = /\/api\/v1\/attachments\/(\d+)/;

/** Seiten- und Anhangsverweise eines Inhalts (Links, eingebundene Seiten, Bilder, Datei- und PDF-Makros). */
export function extractRefs(html: string): { pages: number[]; attachments: number[] } {
  if (!html) return { pages: [], attachments: [] };
  const attachments = new Set<number>();
  const root = parse(html);
  for (const el of root.querySelectorAll('[data-attachment-id]')) {
    const id = Number(el.getAttribute('data-attachment-id'));
    if (Number.isInteger(id) && id > 0) attachments.add(id);
  }
  for (const el of root.querySelectorAll('a[href], img[src], [data-src]')) {
    for (const value of [el.getAttribute('href'), el.getAttribute('src'), el.getAttribute('data-src')]) {
      const m = value?.match(ATTACHMENT_URL);
      if (m) attachments.add(Number(m[1]));
    }
  }
  return { pages: extractPageLinks(html), attachments: [...attachments] };
}

function dayOffset(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

export interface AnalyticsOptions {
  spaceKey?: string;
  days?: number;
}

export interface TopPage {
  page: PageSummary;
  views: number;
  readers: number;
}

export interface UnreadPage {
  page: PageSummary;
  lastReadAt: string | null;
}

export interface FailedSearch {
  query: string;
  searches: number;
  lastDay: string;
}

export interface OrphanPage {
  page: PageSummary;
  children: number;
  topLevel: boolean;
}

export interface BrokenLink {
  source: PageSummary;
  kind: 'page' | 'attachment';
  targetId: number;
  reason: 'missing' | 'deleted' | 'draft';
  /** Titel bzw. Dateiname, wenn das Ziel noch (im Papierkorb) existiert und sichtbar ist */
  targetLabel: string | null;
  item: string;
}

export class AnalyticsService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /* ------------------------------ Erfassung ------------------------------ */

  /** Suchanfrage zählen (nur die erste Ergebnisseite; Begriffe unter zwei Zeichen nicht). */
  recordSearch(query: string, results: number): void {
    const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
    if (normalized.length < 2) return;
    try {
      this.s.db.run(
        `INSERT INTO search_queries (day, query, searches, results) VALUES (?, ?, 1, ?)
         ON CONFLICT(day, query) DO UPDATE SET searches = searches + 1, results = excluded.results`,
        new Date().toISOString().slice(0, 10),
        normalized,
        Math.max(0, results),
      );
    } catch (err) {
      this.s.log.warn({ err }, 'Suchbegriff konnte nicht gezählt werden');
    }
  }

  /** Aufrufe eines Tages hinzufügen – läuft innerhalb der Transaktion von `pages.flushViews`. */
  recordViews(views: [number, number][]): void {
    const day = new Date().toISOString().slice(0, 10);
    for (const [pageId, count] of views) {
      this.s.db.run(
        `INSERT INTO page_view_days (page_id, day, views) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM pages WHERE id = ?)
         ON CONFLICT(page_id, day) DO UPDATE SET views = views + excluded.views`,
        pageId,
        day,
        count,
        pageId,
      );
    }
  }

  /** Verweise einer Seite nach dem Speichern ersetzen. */
  replaceRefs(pageId: number, contentType: string, content: string): void {
    const refs = contentType === 'richtext' ? extractRefs(content) : { pages: [], attachments: [] };
    this.s.db.run('DELETE FROM page_refs WHERE source_id = ?', pageId);
    for (const id of refs.pages) if (id !== pageId) this.s.db.run('INSERT OR IGNORE INTO page_refs (source_id, kind, target_id) VALUES (?, ?, ?)', pageId, 'page', id);
    for (const id of refs.attachments) this.s.db.run('INSERT OR IGNORE INTO page_refs (source_id, kind, target_id) VALUES (?, ?, ?)', pageId, 'attachment', id);
  }

  /** Nach einem Update einmalig alle Verweise aus den gespeicherten Inhalten ableiten. */
  refreshDerived(): number {
    if (this.s.settings.getInternal<number>('analytics:refsVersion', 0) >= REFS_VERSION) return 0;
    let lastId = 0;
    let count = 0;
    for (;;) {
      const rows = this.s.db.all<{ id: number; content_type: string; content: string }>('SELECT id, content_type, content FROM pages WHERE id > ? ORDER BY id LIMIT 500', lastId);
      if (!rows.length) break;
      this.s.db.transaction(() => {
        for (const row of rows) this.replaceRefs(row.id, row.content_type, row.content);
      });
      lastId = rows[rows.length - 1].id;
      count += rows.length;
    }
    this.s.settings.setInternal('analytics:refsVersion', REFS_VERSION);
    return count;
  }

  /** Alte Tagessummen entfernen (Wartung). */
  prune(): { views: number; searches: number } {
    return {
      views: this.s.db.run('DELETE FROM page_view_days WHERE day < ?', dayOffset(VIEW_RETENTION_DAYS)).changes,
      searches: this.s.db.run('DELETE FROM search_queries WHERE day < ?', dayOffset(SEARCH_RETENTION_DAYS)).changes,
    };
  }

  /* ------------------------------ Auswertung ------------------------------ */

  canSeeSearches(auth: AuthContext): boolean {
    return this.s.perms.hasGlobal(auth, 'analytics.view');
  }

  /** Bereiche, die die Person auswerten darf. */
  spaces(auth: AuthContext): SpaceRow[] {
    this.s.perms.requireUser(auth);
    const global = this.s.perms.hasGlobal(auth, 'analytics.view');
    const ids = this.s.perms.viewableSpaceIds(auth);
    if (!ids.length) return [];
    return this.s.db
      .all<SpaceRow>(`SELECT * FROM spaces WHERE id IN ${Db.placeholders(ids.length)} ORDER BY name COLLATE NOCASE`, ...ids)
      .filter((space) => global || this.s.perms.canSpace(auth, space, 'moderate'));
  }

  private scope(auth: AuthContext, spaceKey?: string): SpaceRow[] {
    const spaces = this.spaces(auth);
    if (!spaceKey) {
      if (!spaces.length && !this.canSeeSearches(auth)) throw forbidden('Die Inhaltsanalyse steht der Bereichsverwaltung und Personen mit dem Recht „Inhaltsanalyse einsehen“ zur Verfügung');
      return spaces;
    }
    const space = spaces.find((sp) => sp.key.toLowerCase() === spaceKey.toLowerCase());
    if (!space) throw forbidden('Für diesen Bereich fehlt das Recht, die Inhaltsanalyse zu sehen');
    return [space];
  }

  private pageRows(sql: string, ...params: (string | number)[]): PageRow[] {
    return this.s.db.all<PageRow>(sql, ...params);
  }

  private dismissed(kind: DismissKind): Set<string> {
    return new Set(this.s.db.all<{ item: string }>('SELECT item FROM analytics_dismissed WHERE kind = ?', kind).map((r) => r.item));
  }

  report(auth: AuthContext, options: AnalyticsOptions = {}) {
    const days = Math.max(7, Math.min(365, Math.round(options.days ?? 90)));
    const from = dayOffset(days);
    const spaces = this.scope(auth, options.spaceKey);
    this.s.pages.flushViews();
    const spaceIds = spaces.map((sp) => sp.id);
    const inSpaces = spaceIds.length ? `IN ${Db.placeholders(spaceIds.length)}` : 'IN (NULL)';
    const homeIds = new Set(spaces.map((sp) => sp.home_page_id).filter((id): id is number => !!id));

    /* Meistgelesen */
    const viewRows = this.s.db.all<{ page_id: number; views: number }>(
      `SELECT d.page_id, SUM(d.views) AS views FROM page_view_days d JOIN pages p ON p.id = d.page_id
        WHERE d.day >= ? AND p.space_id ${inSpaces} AND p.deleted_at IS NULL AND p.status = 'current'
        GROUP BY d.page_id ORDER BY views DESC LIMIT 80`,
      from,
      ...spaceIds,
    );
    const viewsById = new Map(viewRows.map((r) => [r.page_id, r.views]));
    const topCandidates = viewRows.length ? this.pageRows(`SELECT * FROM pages WHERE id IN ${Db.placeholders(viewRows.length)}`, ...viewRows.map((r) => r.page_id)) : [];
    const topVisible = this.s.pages.filterVisible(auth, topCandidates).sort((a, b) => (viewsById.get(b.id) ?? 0) - (viewsById.get(a.id) ?? 0)).slice(0, 25);
    const readers = new Map(
      topVisible.length
        ? this.s.db
            .all<{ page_id: number; readers: number }>(
              `SELECT page_id, COUNT(*) AS readers FROM page_views WHERE viewed_at >= ? AND page_id IN ${Db.placeholders(topVisible.length)} GROUP BY page_id`,
              from,
              ...topVisible.map((p) => p.id),
            )
            .map((r) => [r.page_id, r.readers] as const)
        : [],
    );
    const topPages: TopPage[] = this.s.pages.summaries(auth, topVisible).map((page) => ({ page, views: viewsById.get(page.id) ?? 0, readers: readers.get(page.id) ?? 0 }));

    /* Außer den Autorinnen und Autoren niemand gelesen (Seiten älter als der Zeitraum) */
    const dismissedUnread = this.dismissed('unread');
    const unreadRows = this.pageRows(
      `SELECT p.* FROM pages p
        WHERE p.space_id ${inSpaces} AND p.deleted_at IS NULL AND p.status = 'current' AND p.created_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM page_views v WHERE v.page_id = p.id AND v.viewed_at >= ?
              AND v.user_id NOT IN (SELECT author_id FROM page_revisions r WHERE r.page_id = p.id AND r.author_id IS NOT NULL)
              AND (p.created_by IS NULL OR v.user_id != p.created_by))
        ORDER BY p.updated_at LIMIT 400`,
      ...spaceIds,
      from,
      from,
    ).filter((p) => !dismissedUnread.has(String(p.id)));
    const unreadVisible = this.s.pages.filterVisible(auth, unreadRows).slice(0, 100);
    const lastRead = new Map(
      unreadVisible.length
        ? this.s.db
            .all<{ page_id: number; last: string }>(
              `SELECT v.page_id, MAX(v.viewed_at) AS last FROM page_views v JOIN pages p ON p.id = v.page_id
                WHERE v.page_id IN ${Db.placeholders(unreadVisible.length)}
                  AND v.user_id NOT IN (SELECT author_id FROM page_revisions r WHERE r.page_id = v.page_id AND r.author_id IS NOT NULL)
                  AND (p.created_by IS NULL OR v.user_id != p.created_by)
                GROUP BY v.page_id`,
              ...unreadVisible.map((p) => p.id),
            )
            .map((r) => [r.page_id, r.last] as const)
        : [],
    );
    const unreadPages: UnreadPage[] = this.s.pages
      .summaries(auth, unreadVisible)
      .map((page) => ({ page, lastReadAt: lastRead.get(page.id) ?? null }))
      .sort((a, b) => (a.lastReadAt ?? '').localeCompare(b.lastReadAt ?? ''));

    /* Suchbegriffe ohne Treffer */
    const canSeeSearches = this.canSeeSearches(auth);
    const dismissedSearches = this.dismissed('search');
    const failedSearches: FailedSearch[] = canSeeSearches
      ? this.s.db
          .all<{ query: string; searches: number; last_day: string }>(
            `SELECT query, SUM(searches) AS searches, MAX(day) AS last_day FROM search_queries WHERE day >= ?
              GROUP BY query HAVING MAX(results) = 0 ORDER BY searches DESC, last_day DESC LIMIT 200`,
            from,
          )
          .filter((r) => !dismissedSearches.has(r.query))
          .slice(0, 100)
          .map((r) => ({ query: r.query, searches: r.searches, lastDay: r.last_day }))
      : [];

    /* Verwaist: keine eingehenden Verweise von einer anderen aktuellen Seite */
    const dismissedOrphans = this.dismissed('orphan');
    const orphanRows = this.pageRows(
      `SELECT p.* FROM pages p
        WHERE p.space_id ${inSpaces} AND p.deleted_at IS NULL AND p.status = 'current'
          AND NOT EXISTS (
            SELECT 1 FROM page_refs r JOIN pages src ON src.id = r.source_id
             WHERE r.kind = 'page' AND r.target_id = p.id AND src.id != p.id AND src.deleted_at IS NULL AND src.status = 'current')
        ORDER BY CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END, p.title COLLATE NOCASE LIMIT 600`,
      ...spaceIds,
    ).filter((p) => !homeIds.has(p.id) && !dismissedOrphans.has(String(p.id)));
    const orphanVisible = this.s.pages.filterVisible(auth, orphanRows).slice(0, 100);
    const children = new Map(
      orphanVisible.length
        ? this.s.db
            .all<{ parent_id: number; n: number }>(
              `SELECT parent_id, COUNT(*) AS n FROM pages WHERE parent_id IN ${Db.placeholders(orphanVisible.length)} AND deleted_at IS NULL AND status = 'current' GROUP BY parent_id`,
              ...orphanVisible.map((p) => p.id),
            )
            .map((r) => [r.parent_id, r.n] as const)
        : [],
    );
    const parentOf = new Map(orphanVisible.map((p) => [p.id, p.parent_id]));
    const orphans: OrphanPage[] = this.s.pages
      .summaries(auth, orphanVisible)
      .map((page) => ({ page, children: children.get(page.id) ?? 0, topLevel: !parentOf.get(page.id) || homeIds.has(parentOf.get(page.id)!) }));

    /* Defekte Verweise */
    const brokenLinks = this.brokenLinks(auth, spaceIds, inSpaces);

    return {
      days,
      from,
      spaces: spaces.map((sp) => ({ key: sp.key, name: sp.name })),
      canSeeSearches,
      summary: {
        views: this.s.db.value<number>(
          `SELECT COALESCE(SUM(d.views), 0) FROM page_view_days d JOIN pages p ON p.id = d.page_id WHERE d.day >= ? AND p.space_id ${inSpaces}`,
          from,
          ...spaceIds,
        ) ?? 0,
        pages: this.s.db.value<number>(`SELECT COUNT(*) FROM pages WHERE space_id ${inSpaces} AND deleted_at IS NULL AND status = 'current'`, ...spaceIds) ?? 0,
        unread: unreadPages.length,
        failedSearches: failedSearches.length,
        orphans: orphans.length,
        brokenLinks: brokenLinks.length,
      },
      topPages,
      unreadPages,
      failedSearches,
      orphans,
      brokenLinks,
    };
  }

  private brokenLinks(auth: AuthContext, spaceIds: number[], inSpaces: string): BrokenLink[] {
    const dismissed = this.dismissed('link');
    const rows = this.s.db.all<{
      source_id: number;
      kind: 'page' | 'attachment';
      target_id: number;
      page_exists: number | null;
      page_deleted: string | null;
      page_status: string | null;
      page_title: string | null;
      att_exists: number | null;
      att_deleted: string | null;
      att_name: string | null;
      att_page: number | null;
    }>(
      `SELECT r.source_id, r.kind, r.target_id,
              tp.id AS page_exists, tp.deleted_at AS page_deleted, tp.status AS page_status, tp.title AS page_title,
              ta.id AS att_exists, ta.deleted_at AS att_deleted, ta.filename AS att_name, ta.page_id AS att_page
         FROM page_refs r
         JOIN pages src ON src.id = r.source_id
         LEFT JOIN pages tp ON r.kind = 'page' AND tp.id = r.target_id
         LEFT JOIN attachments ta ON r.kind = 'attachment' AND ta.id = r.target_id
        WHERE src.space_id ${inSpaces} AND src.deleted_at IS NULL AND src.status = 'current'
          AND ((r.kind = 'page' AND (tp.id IS NULL OR tp.deleted_at IS NOT NULL OR tp.status != 'current'))
            OR (r.kind = 'attachment' AND (ta.id IS NULL OR ta.deleted_at IS NOT NULL)))
        LIMIT 2000`,
      ...spaceIds,
    );
    const open = rows.filter((r) => !dismissed.has(`${r.source_id}:${r.kind}:${r.target_id}`));
    if (!open.length) return [];
    const sources = this.s.pages.filterVisible(auth, this.pageRows(`SELECT * FROM pages WHERE id IN ${Db.placeholders(new Set(open.map((r) => r.source_id)).size)}`, ...new Set(open.map((r) => r.source_id))));
    const summaries = new Map(this.s.pages.summaries(auth, sources).map((sm) => [sm.id, sm]));
    const result: BrokenLink[] = [];
    for (const r of open) {
      const source = summaries.get(r.source_id);
      if (!source) continue;
      let reason: BrokenLink['reason'];
      let label: string | null = null;
      if (r.kind === 'page') {
        reason = !r.page_exists ? 'missing' : r.page_deleted ? 'deleted' : 'draft';
        // Titel nur zeigen, wenn die Person die Zielseite (auch im Papierkorb) sehen dürfte
        if (r.page_exists) {
          const target = this.s.pages.get(r.target_id);
          const space = target ? this.s.spaces.get(target.space_id) : undefined;
          if (target && space && this.s.perms.canViewPage(auth, target, space, { includeDeleted: true })) label = r.page_title;
        }
      } else {
        reason = r.att_exists ? 'deleted' : 'missing';
        if (r.att_exists && r.att_page) {
          const owner = this.s.pages.get(r.att_page);
          const space = owner ? this.s.spaces.get(owner.space_id) : undefined;
          if (owner && space && this.s.perms.canViewPage(auth, owner, space, { includeDeleted: true })) label = r.att_name;
        }
      }
      result.push({ source, kind: r.kind, targetId: r.target_id, reason, targetLabel: label, item: `${r.source_id}:${r.kind}:${r.target_id}` });
      if (result.length >= 200) break;
    }
    return result;
  }

  /* ------------------------------ Arbeitsliste ------------------------------ */

  /** Eintrag als erledigt markieren (verschwindet aus der Liste) bzw. wieder aufnehmen. */
  dismiss(auth: AuthContext, kind: DismissKind, item: string, dismissed: boolean): void {
    const user = this.s.perms.requireUser(auth);
    if (!['search', 'orphan', 'link', 'unread'].includes(kind)) throw badRequest('Unbekannte Liste');
    if (kind === 'search') {
      if (!this.canSeeSearches(auth)) throw forbidden('Suchbegriffe sieht nur, wer das Recht „Inhaltsanalyse einsehen“ hat');
    } else {
      // Die Seite (bzw. die Quellseite des Verweises) muss in einem auswertbaren Bereich liegen
      const pageId = Number(item.split(':')[0]);
      const page = Number.isInteger(pageId) ? this.s.pages.get(pageId) : undefined;
      if (!page || !this.spaces(auth).some((sp) => sp.id === page.space_id)) throw forbidden('Für diese Seite fehlt das Recht, die Inhaltsanalyse zu bearbeiten');
    }
    if (dismissed) {
      this.s.db.run(
        'INSERT INTO analytics_dismissed (kind, item, dismissed_by, dismissed_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, item) DO UPDATE SET dismissed_by = excluded.dismissed_by, dismissed_at = excluded.dismissed_at',
        kind,
        item.slice(0, 200),
        user.id,
        nowIso(),
      );
    } else {
      this.s.db.run('DELETE FROM analytics_dismissed WHERE kind = ? AND item = ?', kind, item);
    }
  }

  /** Eine Liste als CSV (Semikolon, UTF-8 mit BOM – öffnet sich direkt in Excel). */
  csv(auth: AuthContext, list: 'top' | 'unread' | 'searches' | 'orphans' | 'links', options: AnalyticsOptions, locale: Locale = 'de'): string {
    const tr = translator(locale);
    const r = this.report(auth, options);
    const cell = (v: unknown) => {
      let text = String(v ?? '');
      // Formel-Injektion verhindern (wie im Audit-Export)
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const base = this.s.config.baseUrl;
    let rows: unknown[][];
    switch (list) {
      case 'top':
        rows = [['Seite', 'Bereich', 'Aufrufe', 'Leser', 'Adresse'].map(tr), ...r.topPages.map((x) => [x.page.title, x.page.spaceName, x.views, x.readers, base + x.page.url])];
        break;
      case 'unread':
        rows = [['Seite', 'Bereich', 'Zuletzt gelesen', 'Geändert', 'Adresse'].map(tr), ...r.unreadPages.map((x) => [x.page.title, x.page.spaceName, x.lastReadAt?.slice(0, 10) ?? tr('nie'), x.page.updatedAt.slice(0, 10), base + x.page.url])];
        break;
      case 'searches':
        rows = [['Suchbegriff', 'Suchen', 'Zuletzt'].map(tr), ...r.failedSearches.map((x) => [x.query, x.searches, x.lastDay])];
        break;
      case 'orphans':
        rows = [['Seite', 'Bereich', 'Oberste Ebene', 'Unterseiten', 'Adresse'].map(tr), ...r.orphans.map((x) => [x.page.title, x.page.spaceName, tr(x.topLevel ? 'ja' : 'nein'), x.children, base + x.page.url])];
        break;
      default:
        rows = [
          ['Seite', 'Bereich', 'Art', 'Ziel', 'Grund', 'Adresse'].map(tr),
          ...r.brokenLinks.map((x) => [x.source.title, x.source.spaceName, tr(x.kind === 'page' ? 'Seite' : 'Anhang'), x.targetLabel ?? `#${x.targetId}`, tr({ missing: 'existiert nicht', deleted: 'gelöscht', draft: 'nicht veröffentlicht' }[x.reason]), base + x.source.url]),
        ];
    }
    return `\ufeff${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
  }
}
