import type { MyReadState } from '../reads/service.ts';
import type { ReviewCycleDto } from './reviewcycle.ts';
import type { Services } from '../../services.ts';
import type { ContentType, PageRow, SpaceRow, UserRef } from '../../core/types.ts';
import type { AuthContext, PageAccess } from '../../core/permissions.ts';
import { Db, nowIso } from '../../db/database.ts';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../core/errors.ts';
import { slugify } from '../../core/util.ts';
import { nextRowId } from '../../core/subjects.ts';
import { sanitizeRichText, toggleTaskItem } from '../../core/html.ts';
import { CONTENT_TYPES, prepareContent, toDisplayHtml } from './content.ts';
import type { PropertyInput } from './labels.ts';

export interface CreatePageInput {
  spaceId: number;
  parentId?: number | null;
  title: string;
  content?: string;
  contentType?: ContentType;
  language?: string | null;
  icon?: string | null;
  fullWidth?: boolean;
  status?: 'current' | 'draft';
  changeNote?: string;
  labels?: string[];
  properties?: PropertyInput[];
  templateId?: number | null;
  /** Keine Ereignisse/Benachrichtigungen auslösen (Seed, interne Anlage). */
  silent?: boolean;
  /** false = Seite nicht automatisch beobachten (z. B. bei Massenimporten) */
  watch?: boolean;
  position?: number;
}

export interface SavePageInput {
  title?: string;
  content?: string;
  contentType?: ContentType;
  language?: string | null;
  icon?: string | null;
  fullWidth?: boolean;
  changeNote?: string;
  minor?: boolean;
  baseVersion?: number;
  changeType?: string;
  /** Veröffentlichung aus der gemeinsamen Bearbeitung */
  collab?: boolean;
}

export interface TreeNode {
  id: number;
  parentId: number | null;
  title: string;
  icon: string | null;
  position: number;
  contentType: ContentType;
  restricted: boolean;
  updatedAt: string;
}

export interface PageSummary {
  id: number;
  title: string;
  icon: string | null;
  spaceId: number;
  spaceKey: string;
  spaceName: string;
  parentId: number | null;
  excerpt: string;
  contentType: ContentType;
  status: 'current' | 'draft';
  version: number;
  updatedAt: string;
  createdAt: string;
  updatedBy: UserRef | null;
  url: string;
}

export interface PageDto {
  id: number;
  spaceId: number;
  space: { id: number; key: string; name: string; icon: string | null; color: string | null; homePageId: number | null; archived: boolean; kind: string };
  parentId: number | null;
  title: string;
  icon: string | null;
  contentType: ContentType;
  language: string | null;
  content: string;
  html?: string;
  excerpt: string;
  status: 'current' | 'draft';
  version: number;
  fullWidth: boolean;
  isHome: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  ancestors: { id: number; title: string; icon: string | null }[];
  labels: string[];
  properties: { name: string; value: string; type: string }[];
  restrictions: { view: boolean; edit: boolean; inheritedView: boolean };
  access: PageAccess;
  isFavorite: boolean;
  isWatching: boolean;
  childCount: number;
  attachmentCount: number;
  commentCount: number;
  viewCount: number;
  tasks: { total: number; done: number };
  hasDraft: boolean;
  /** Gemeinsame Bearbeitung: wer bearbeitet gerade, gibt es Unveröffentlichtes */
  collab: { editors: { id: number; name: string; color: string }[]; unpublished: boolean };
  url: string;
  /** Stand der Redaktionsprüfung */
  review: {
    status: 'none' | 'pending' | 'approved' | 'rejected';
    openId: number | null;
    approvedVersion: number | null;
    approvedAt: string | null;
    approvedBy: UserRef | null;
    /** Darf der Aufrufende freigeben? */
    canDecide: boolean;
    /** Ist im Bereich eine Freigabe vorgeschrieben? */
    required: boolean;
  };
  /** Verantwortliche und Wiedervorlage */
  reviewCycle: ReviewCycleDto;
  /** Lesebestätigung, die von der angemeldeten Person verlangt wird */
  readConfirmation: MyReadState | null;
  /** Bearbeitungsmodus (direkt oder nur Vorschläge) und offene Vorschläge */
  editMode: ReturnType<Services['suggestions']['info']>;
}

/** Obergrenze für „Seite kopieren“ mit Unterseiten */
export const MAX_COPY_PAGES = 1000;

export function pageUrl(spaceKey: string, pageId: number, title: string): string {
  return `/s/${encodeURIComponent(spaceKey)}/p/${pageId}/${slugify(title)}`;
}

export class PageService {
  private readonly s: Services;
  /** Seitenaufrufe werden gesammelt und gebündelt geschrieben (spart einen Schreibzugriff je Aufruf) */
  private readonly pendingViews = new Map<number, number>();
  private readonly pendingUserViews = new Map<string, { userId: number; pageId: number; count: number; at: string }>();
  private viewTimer: NodeJS.Timeout | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  /* ------------------------------ Laden ------------------------------ */

  get(id: number): PageRow | undefined {
    return this.s.db.get<PageRow>('SELECT * FROM pages WHERE id = ?', id);
  }

  require(id: number): PageRow {
    const row = this.get(id);
    if (!row) throw notFound('Seite nicht gefunden');
    return row;
  }

  /** Seite laden und Leserecht prüfen. Liefert Seite und Bereich. */
  requireViewable(auth: AuthContext, id: number, options: { includeDeleted?: boolean } = {}): { page: PageRow; space: SpaceRow } {
    // Dieselbe Antwort, ob es die Seite nicht gibt oder sie nicht sichtbar ist – sonst verriete der Unterschied eingeschränkte Seiten
    const page = this.get(id);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!page || !space || !this.s.perms.canViewPage(auth, page, space, options)) {
      if (!auth.user) throw new HttpError(401, 'unauthorized', 'Anmeldung erforderlich');
      throw notFound('Seite nicht gefunden oder keine Berechtigung');
    }
    return { page, space };
  }

  access(auth: AuthContext, page: PageRow, space?: SpaceRow): PageAccess {
    return this.s.perms.pageAccess(auth, page, space ?? this.s.spaces.require(page.space_id));
  }

  requireAccess(auth: AuthContext, id: number, action: keyof PageAccess, options: { includeDeleted?: boolean } = {}) {
    const { page, space } = this.requireViewable(auth, id, options);
    const access = this.access(auth, page, space);
    if (!access[action]) {
      if (space.archived_at) throw forbidden('Der Bereich ist archiviert und kann nicht bearbeitet werden');
      throw forbidden(action === 'edit' ? 'Diese Seite ist für dich nicht bearbeitbar' : 'Dafür fehlt dir die Berechtigung');
    }
    return { page, space, access };
  }

  ancestors(page: PageRow): { id: number; title: string; icon: string | null }[] {
    const chain = this.s.perms.ancestorChain(page.id).slice(1).reverse();
    if (!chain.length) return [];
    const rows = this.s.db.all<{ id: number; title: string; icon: string | null }>(
      `SELECT id, title, icon FROM pages WHERE id IN ${Db.placeholders(chain.length)}`,
      ...chain,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return chain.map((id) => byId.get(id)).filter((x): x is { id: number; title: string; icon: string | null } => !!x);
  }

  descendantIds(pageId: number, includeDeleted = false): number[] {
    return this.s.db
      .all<{ id: number }>(
        `WITH RECURSIVE sub(id, depth) AS (
           SELECT id, 0 FROM pages WHERE parent_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
           UNION ALL
           SELECT p.id, s.depth + 1 FROM pages p JOIN sub s ON p.parent_id = s.id
           WHERE s.depth < 100 ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
         ) SELECT id FROM sub`,
        pageId,
      )
      .map((r) => r.id);
  }

  url(page: Pick<PageRow, 'id' | 'title' | 'space_id'>, spaceKey?: string): string {
    const key = spaceKey ?? this.s.spaces.require(page.space_id).key;
    return pageUrl(key, page.id, page.title);
  }

  summaries(auth: AuthContext, rows: PageRow[]): PageSummary[] {
    const users = this.s.users.refs(rows.map((r) => r.updated_by));
    const spaces = new Map<number, SpaceRow>();
    return rows.map((r) => {
      let space = spaces.get(r.space_id);
      if (!space) {
        space = this.s.spaces.require(r.space_id);
        spaces.set(r.space_id, space);
      }
      return {
        id: r.id,
        title: r.title,
        icon: r.icon,
        spaceId: r.space_id,
        spaceKey: space.key,
        spaceName: space.name,
        parentId: r.parent_id,
        excerpt: r.excerpt,
        contentType: r.content_type,
        status: r.status,
        version: r.version,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
        updatedBy: users.get(r.updated_by ?? 0) ?? null,
        url: pageUrl(space.key, r.id, r.title),
      };
    });
  }

  /** Filtert Seiten (auch bereichsübergreifend) auf die für den Nutzer sichtbaren. */
  filterVisible<T extends Pick<PageRow, 'id' | 'space_id' | 'parent_id' | 'status' | 'created_by' | 'deleted_at'>>(auth: AuthContext, rows: T[]): T[] {
    const bySpace = new Map<number, T[]>();
    for (const r of rows) {
      const list = bySpace.get(r.space_id) ?? [];
      list.push(r);
      bySpace.set(r.space_id, list);
    }
    const visible = new Set<number>();
    for (const [spaceId, list] of bySpace) {
      const space = this.s.spaces.get(spaceId);
      if (!space) continue;
      for (const id of this.s.perms.visiblePageIds(auth, space, list)) visible.add(id);
    }
    return rows.filter((r) => visible.has(r.id) && !r.deleted_at);
  }

  async dto(auth: AuthContext, page: PageRow, space: SpaceRow, options: { render?: boolean } = {}): Promise<PageDto> {
    const pendingViews = this.pendingViews.get(page.id) ?? 0;
    const users = this.s.users.refs([page.created_by, page.updated_by]);
    const restrictions = this.s.perms.restrictionsFor(this.s.perms.ancestorChain(page.id));
    const own = restrictions.get(page.id);
    let inheritedView = false;
    for (const [id, r] of restrictions) if (id !== page.id && r.view.length) inheritedView = true;
    const userId = auth.user?.id ?? 0;
    const settings = this.s.settings.all();
    const dto: PageDto = {
      id: page.id,
      spaceId: space.id,
      space: {
        id: space.id,
        key: space.key,
        name: space.name,
        icon: space.icon,
        color: space.color,
        homePageId: space.home_page_id,
        archived: !!space.archived_at,
        kind: space.kind,
      },
      parentId: page.parent_id,
      title: page.title,
      icon: page.icon,
      contentType: page.content_type,
      language: page.language,
      content: page.content,
      excerpt: page.excerpt,
      status: page.status,
      version: page.version,
      fullWidth: !!page.full_width,
      isHome: space.home_page_id === page.id,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
      publishedAt: page.published_at,
      deletedAt: page.deleted_at,
      createdBy: users.get(page.created_by ?? 0) ?? null,
      updatedBy: users.get(page.updated_by ?? 0) ?? null,
      ancestors: this.ancestors(page),
      labels: this.s.labels.labelsOf(page.id),
      properties: this.s.labels.propertiesOf(page.id),
      restrictions: { view: !!own?.view.length, edit: !!own?.edit.length, inheritedView },
      access: this.access(auth, page, space),
      isFavorite: !!this.s.db.value('SELECT 1 FROM favorites WHERE user_id = ? AND page_id = ?', userId, page.id),
      isWatching: !!this.s.db.value("SELECT 1 FROM watches WHERE user_id = ? AND target_type = 'page' AND target_id = ?", userId, page.id),
      childCount: this.s.db.value<number>("SELECT COUNT(*) FROM pages WHERE parent_id = ? AND deleted_at IS NULL AND status = 'current'", page.id) ?? 0,
      attachmentCount:
        this.s.db.value<number>(
          'SELECT COUNT(DISTINCT filename) FROM attachments WHERE page_id = ? AND deleted_at IS NULL',
          page.id,
        ) ?? 0,
      commentCount: this.s.db.value<number>('SELECT COUNT(*) FROM comments WHERE page_id = ? AND deleted_at IS NULL', page.id) ?? 0,
      viewCount: page.view_count + pendingViews,
      tasks: page.content_type === 'richtext' ? countTasksFast(page.content) : { total: 0, done: 0 },
      hasDraft: !!this.s.db.value('SELECT 1 FROM page_drafts WHERE page_id = ? AND user_id = ?', page.id, userId),
      collab: this.s.collab.status(page),
      url: pageUrl(space.key, page.id, page.title),
      review: {
        status: page.review_status ?? 'none',
        openId: this.s.db.value<number>("SELECT id FROM page_reviews WHERE page_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", page.id) ?? null,
        approvedVersion: page.approved_version,
        approvedAt: page.approved_at,
        approvedBy: this.s.users.refOf(page.approved_by),
        canDecide: this.s.perms.canSpace(auth, space, 'moderate'),
        required: !!space.review_required,
      },
      reviewCycle: this.s.reviewCycle.dto(auth, page, space),
      readConfirmation: this.s.reads.forPage(auth, page, space),
      editMode: this.s.suggestions.info(auth, page, space),
    };
    if (options.render) {
      const html = toDisplayHtml(page.content_type, page.content, page.language, settings.allowedEmbedHosts);
      dto.html = await this.s.hooks.apply('page.render', html, { page, space, auth });
    }
    return dto;
  }

  /* ------------------------------ Baum ------------------------------ */

  tree(auth: AuthContext, space: SpaceRow): TreeNode[] {
    this.s.perms.requireSpace(auth, space, 'view');
    const rows = this.s.db.all<PageRow>(
      `SELECT id, space_id, parent_id, title, icon, position, content_type, status, created_by, deleted_at, updated_at
       FROM pages WHERE space_id = ? AND deleted_at IS NULL AND status = 'current' ORDER BY position, id`,
      space.id,
    );
    const visible = this.s.perms.visiblePageIds(auth, space, rows);
    const restricted = new Set(this.s.perms.restrictionsFor(rows.map((r) => r.id)).keys());
    return rows
      .filter((r) => visible.has(r.id) && r.id !== space.home_page_id)
      .map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        title: r.title,
        icon: r.icon,
        position: r.position,
        contentType: r.content_type,
        restricted: restricted.has(r.id),
        updatedAt: r.updated_at,
      }));
  }

  children(auth: AuthContext, parentId: number | null, space: SpaceRow, options: { sort?: 'position' | 'title' | 'updated' | 'created' } = {}): PageRow[] {
    const order = { position: 'position, id', title: 'title COLLATE NOCASE', updated: 'updated_at DESC', created: 'created_at DESC' }[
      options.sort ?? 'position'
    ];
    const rows = this.s.db.all<PageRow>(
      `SELECT * FROM pages WHERE space_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}
       AND deleted_at IS NULL AND status = 'current' ORDER BY ${order}`,
      ...(parentId === null ? [space.id] : [space.id, parentId]),
    );
    return this.filterVisible(auth, rows).filter((r) => r.id !== space.home_page_id);
  }

  /* ------------------------------ Anlegen ------------------------------ */

  private resolveParent(auth: AuthContext, space: SpaceRow, parentId: number | null | undefined): number | null {
    if (!parentId || parentId === space.home_page_id) return null;
    const parent = this.get(parentId);
    if (!parent || parent.space_id !== space.id || parent.deleted_at) throw badRequest('Die übergeordnete Seite existiert nicht in diesem Bereich');
    if (!this.s.perms.canViewPage(auth, parent, space)) throw forbidden('Kein Zugriff auf die übergeordnete Seite');
    if (parent.status === 'draft') throw badRequest('Unter einem Entwurf können keine Seiten angelegt werden');
    return parent.id;
  }

  private nextPosition(spaceId: number, parentId: number | null): number {
    return (
      (this.s.db.value<number>(
        `SELECT MAX(position) FROM pages WHERE space_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`,
        ...(parentId === null ? [spaceId] : [spaceId, parentId]),
      ) ?? 0) + 1
    );
  }

  async create(auth: AuthContext, input: CreatePageInput): Promise<PageRow> {
    const user = auth.user;
    const space = this.s.spaces.require(input.spaceId);
    this.s.perms.requireSpace(auth, space, 'create');
    const status = input.status ?? 'current';
    let title = input.title.trim();
    let content = input.content ?? '';
    let contentType: ContentType = input.contentType ?? 'richtext';
    let labels = input.labels ?? [];
    let properties = input.properties ?? [];

    if (input.templateId) {
      const applied = this.s.templates.apply(auth, input.templateId, space);
      content = input.content ?? applied.content;
      contentType = applied.contentType;
      title = title || applied.title;
      labels = [...new Set([...applied.labels, ...labels])];
      properties = [...applied.properties, ...properties];
    }
    if (!CONTENT_TYPES.includes(contentType)) throw badRequest('Unbekannter Inhaltstyp');
    if (!title && status === 'current') throw badRequest('Bitte einen Titel angeben');
    if (title.length > 255) throw badRequest('Der Titel darf höchstens 255 Zeichen lang sein');

    const parentId = this.resolveParent(auth, space, input.parentId);
    const filtered = await this.s.hooks.apply(
      'page.beforeSave',
      { title, content, contentType },
      { page: null, space, auth },
    );
    const prepared = prepareContent(filtered.contentType, filtered.content, this.s.settings.get('allowedEmbedHosts'));
    const now = nowIso();
    const version = status === 'current' ? 1 : 0;

    const page = this.s.db.transaction(() => {
      const position = input.position ?? this.nextPosition(space.id, parentId);
      const res = this.s.db.run(
        `INSERT INTO pages (id, space_id, parent_id, title, icon, content_type, language, content, content_text, excerpt, status, version,
                            position, full_width, created_by, updated_by, created_at, updated_at, published_at, edit_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nextRowId(this.s.db, 'pages'),
        space.id,
        parentId,
        filtered.title || (status === 'draft' ? '' : 'Unbenannte Seite'),
        input.icon ?? null,
        filtered.contentType,
        input.language ?? null,
        prepared.content,
        prepared.text,
        prepared.excerpt,
        status,
        version,
        position,
        input.fullWidth ? 1 : 0,
        user?.id ?? null,
        user?.id ?? null,
        now,
        now,
        status === 'current' ? now : null,
        filtered.contentType === 'richtext' ? (space.default_edit_mode ?? 'direct') : 'direct',
      );
      const id = res.lastInsertRowid;
      if (status === 'current') {
        this.insertRevision(id, 1, {
          title: filtered.title,
          contentType: filtered.contentType,
          language: input.language ?? null,
          content: prepared.content,
          changeNote: input.changeNote ?? 'Seite erstellt',
          changeType: 'create',
          minor: false,
          authorId: user?.id ?? null,
        });
        this.s.links.replace(id, prepared.links);
        this.s.analytics.replaceRefs(id, filtered.contentType, prepared.content);
      }
      if (labels.length) this.s.labels.writeLabels(id, labels);
      if (properties.length) this.s.labels.writeProperties(id, properties);
      if (status === 'current') this.s.search.index(id);
      if (user && status === 'current' && input.watch !== false && this.autoWatch(user.id)) this.s.social.setWatch(user.id, 'page', id, true);
      return this.require(id);
    });

    if (status === 'current') this.s.reviewCycle.refresh(page.id);
    if (status === 'current' && !input.silent) {
      // Prüfpflicht des Bereichs gilt auch für neu angelegte Seiten.
      this.s.reviews.onPageSaved(auth, page, space);
      this.s.emit(auth, {
        type: 'page.created',
        spaceId: space.id,
        pageId: page.id,
        target: { type: 'page', id: page.id, label: page.title },
        data: { title: page.title, version: 1, parentId, mentions: prepared.mentions, url: pageUrl(space.key, page.id, page.title) },
      });
    }
    return status === 'current' && !input.silent ? this.require(page.id) : page;
  }

  private autoWatch(userId: number): boolean {
    const prefs = this.s.users.preferences(userId);
    return prefs.autoWatch !== false;
  }

  private insertRevision(
    pageId: number,
    version: number,
    r: {
      title: string;
      contentType: ContentType;
      language: string | null;
      content: string;
      changeNote: string;
      changeType: string;
      minor: boolean;
      authorId: number | null;
    },
  ): void {
    this.s.db.run(
      `INSERT INTO page_revisions (page_id, version, title, content_type, language, content, change_note, change_type, minor, size, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pageId,
      version,
      r.title,
      r.contentType,
      r.language,
      r.content,
      r.changeNote.slice(0, 500),
      r.changeType,
      r.minor ? 1 : 0,
      Buffer.byteLength(r.content, 'utf8'),
      r.authorId,
      nowIso(),
    );
    const limit = this.s.settings.get('revisionLimit');
    if (limit > 0 && version > limit) {
      this.s.db.run('DELETE FROM page_revisions WHERE page_id = ? AND version <= ?', pageId, version - limit);
    }
  }

  /** Inhalt ohne neue Version ersetzen (Importe: Verweise nachträglich auflösen). */
  replaceContentInPlace(pageId: number, html: string): void {
    const page = this.require(pageId);
    const prepared = prepareContent('richtext', html, this.s.settings.get('allowedEmbedHosts'));
    this.s.db.transaction(() => {
      this.s.db.run('UPDATE pages SET content = ?, content_text = ?, excerpt = ? WHERE id = ?', prepared.content, prepared.text, prepared.excerpt, pageId);
      this.s.db.run('UPDATE page_revisions SET content = ?, size = ? WHERE page_id = ? AND version = ?', prepared.content, Buffer.byteLength(prepared.content, 'utf8'), pageId, page.version);
      this.s.links.replace(pageId, prepared.links);
      this.s.analytics.replaceRefs(pageId, 'richtext', prepared.content);
    });
    this.s.search.index(pageId);
  }

  /**
   * Versionsgeschichte und Zeitstempel aus einem anderen System übernehmen. Die
   * aktuelle Fassung bleibt die neueste Version; ältere Fassungen werden davor
   * einsortiert (älteste zuerst).
   */
  importHistory(
    pageId: number,
    history: { title: string; content: string; authorId: number | null; changeNote: string; createdAt: string | null }[],
    current: { authorId: number | null; changeNote: string; createdAt: string | null; updatedAt: string | null },
  ): void {
    const page = this.require(pageId);
    const hosts = this.s.settings.get('allowedEmbedHosts');
    const now = nowIso();
    this.s.db.transaction(() => {
      const latest = this.s.db.get<{ content: string; title: string; change_note: string }>('SELECT content, title, change_note FROM page_revisions WHERE page_id = ? AND version = ?', pageId, page.version);
      this.s.db.run('DELETE FROM page_revisions WHERE page_id = ?', pageId);
      const insert = (version: number, r: { title: string; content: string; authorId: number | null; changeNote: string; createdAt: string | null }, type: string) =>
        this.s.db.run(
          `INSERT INTO page_revisions (page_id, version, title, content_type, language, content, change_note, change_type, minor, size, author_id, created_at)
           VALUES (?, ?, ?, 'richtext', NULL, ?, ?, ?, 0, ?, ?, ?)`,
          pageId,
          version,
          r.title.slice(0, 255),
          r.content,
          r.changeNote.slice(0, 500),
          type,
          Buffer.byteLength(r.content, 'utf8'),
          r.authorId,
          r.createdAt ?? now,
        );
      let version = 0;
      for (const r of history) insert(++version, { ...r, content: sanitizeRichText(r.content, hosts) }, version === 1 ? 'create' : 'update');
      insert(
        ++version,
        { title: latest?.title ?? page.title, content: latest?.content ?? page.content, authorId: current.authorId, changeNote: current.changeNote, createdAt: current.updatedAt ?? current.createdAt },
        version === 1 ? 'create' : 'update',
      );
      const createdAt = history[0]?.createdAt ?? current.createdAt ?? page.created_at;
      const createdBy = history.length ? (history[0].authorId ?? page.created_by) : (current.authorId ?? page.created_by);
      this.s.db.run(
        'UPDATE pages SET version = ?, created_at = ?, updated_at = ?, published_at = ?, created_by = ?, updated_by = ? WHERE id = ?',
        version,
        createdAt,
        current.updatedAt ?? current.createdAt ?? page.updated_at,
        current.updatedAt ?? current.createdAt ?? page.updated_at,
        createdBy,
        current.authorId ?? page.updated_by,
        pageId,
      );
    });
  }

  /* ------------------------------ Speichern ------------------------------ */

  /**
   * Veröffentlicht eine neue Version. Bei Entwurfsseiten wird die Seite erstmals
   * veröffentlicht. Ist `baseVersion` veraltet, wird ein Konflikt (409) gemeldet.
   */
  async save(auth: AuthContext, id: number, input: SavePageInput): Promise<PageRow> {
    const user = this.s.perms.requireUser(auth);
    const { page, space } = this.requireAccess(auth, id, 'edit');
    const isFirstPublish = page.status === 'draft';

    if (!isFirstPublish && input.baseVersion !== undefined && input.baseVersion !== page.version) {
      const updatedBy = this.s.users.refOf(page.updated_by);
      throw conflict(`Die Seite wurde zwischenzeitlich von ${updatedBy?.displayName ?? 'jemand anderem'} geändert (Version ${page.version})`, {
        currentVersion: page.version,
        updatedBy,
        updatedAt: page.updated_at,
      });
    }

    const title = (input.title ?? page.title).trim();
    if (!title) throw badRequest('Bitte einen Titel angeben');
    if (title.length > 255) throw badRequest('Der Titel darf höchstens 255 Zeichen lang sein');
    const contentType = input.contentType ?? page.content_type;
    if (!CONTENT_TYPES.includes(contentType)) throw badRequest('Unbekannter Inhaltstyp');
    const language = input.language === undefined ? page.language : input.language;

    const filtered = await this.s.hooks.apply(
      'page.beforeSave',
      { title, content: input.content ?? page.content, contentType },
      { page, space, auth },
    );
    // Vorschlagsmodus: neue Vorschläge zuordnen, direkte Änderungen im Vorschlagsmodus ablehnen
    const reviewedContent = this.s.suggestions.review(auth, page, space, filtered);
    const prepared = prepareContent(filtered.contentType, reviewedContent, this.s.settings.get('allowedEmbedHosts'));

    const contentChanged =
      prepared.content !== page.content || filtered.contentType !== page.content_type || (language ?? null) !== (page.language ?? null);
    const titleChanged = filtered.title !== page.title;
    const metaChanged =
      (input.icon !== undefined && input.icon !== page.icon) ||
      (input.fullWidth !== undefined && (input.fullWidth ? 1 : 0) !== page.full_width);

    if (!isFirstPublish && !contentChanged && !titleChanged) {
      if (metaChanged) {
        this.s.db.run(
          'UPDATE pages SET icon = ?, full_width = ? WHERE id = ?',
          input.icon === undefined ? page.icon : input.icon,
          input.fullWidth === undefined ? page.full_width : input.fullWidth ? 1 : 0,
          id,
        );
      }
      this.s.db.run('DELETE FROM page_drafts WHERE page_id = ? AND user_id = ?', id, user.id);
      this.s.collab.afterSave(id, page.version, user.displayName, !!input.collab);
      return this.require(id);
    }

    const oldMentions = new Set(isFirstPublish ? [] : prepareMentions(page));
    const now = nowIso();
    const version = isFirstPublish ? 1 : page.version + 1;
    const changeType = input.changeType ?? (isFirstPublish ? 'create' : !contentChanged && titleChanged ? 'rename' : 'edit');

    this.s.db.transaction(() => {
      this.s.db.run(
        `UPDATE pages SET title = ?, content_type = ?, language = ?, content = ?, content_text = ?, excerpt = ?, version = ?,
                icon = ?, full_width = ?, status = 'current', updated_by = ?, updated_at = ?,
                published_at = COALESCE(published_at, ?), created_at = CASE WHEN status = 'draft' THEN ? ELSE created_at END
         WHERE id = ?`,
        filtered.title,
        filtered.contentType,
        language ?? null,
        prepared.content,
        prepared.text,
        prepared.excerpt,
        version,
        input.icon === undefined ? page.icon : input.icon,
        input.fullWidth === undefined ? page.full_width : input.fullWidth ? 1 : 0,
        user.id,
        now,
        now,
        now,
        id,
      );
      this.insertRevision(id, version, {
        title: filtered.title,
        contentType: filtered.contentType,
        language: language ?? null,
        content: prepared.content,
        changeNote: input.changeNote?.trim() || (isFirstPublish ? 'Seite erstellt' : ''),
        changeType,
        minor: !!input.minor,
        authorId: user.id,
      });
      this.s.links.replace(id, prepared.links);
      this.s.analytics.replaceRefs(id, filtered.contentType, prepared.content);
      this.s.search.index(id);
      this.s.db.run('DELETE FROM page_drafts WHERE page_id = ? AND user_id = ?', id, user.id);
      if (this.autoWatch(user.id)) this.s.social.setWatch(user.id, 'page', id, true);
    });

    const updated = this.require(id);
    // Prüfpflicht des Bereichs bzw. offener Prüfauftrag auf den neuen Stand heben.
    this.s.reviews.onPageSaved(auth, updated, space);
    this.s.reviewCycle.onPageSaved(auth, updated, !!input.minor);
    this.s.reads.onPageSaved(updated, !!input.minor);
    if (contentChanged) this.s.suggestions.notifyNew(auth, page.content, updated, space);
    const mentionsAdded = prepared.mentions.filter((m) => !oldMentions.has(m));
    this.s.emit(auth, {
      type: isFirstPublish ? 'page.created' : 'page.updated',
      spaceId: space.id,
      pageId: id,
      target: { type: 'page', id, label: updated.title },
      data: {
        title: updated.title,
        previousTitle: titleChanged && !isFirstPublish ? page.title : undefined,
        version,
        changeNote: input.changeNote?.trim() || undefined,
        changeType,
        minor: !!input.minor,
        mentions: mentionsAdded,
        url: pageUrl(space.key, id, updated.title),
      },
    });
    this.s.collab.afterSave(id, version, user.displayName, !!input.collab);
    // Nach der Prüf-Logik erneut lesen (Prüfstatus kann sich geändert haben).
    return this.require(id);
  }

  /** Metadaten ohne neue Version (Symbol, Seitenbreite). */
  updateMeta(auth: AuthContext, id: number, input: { icon?: string | null; fullWidth?: boolean }): PageRow {
    const { page } = this.requireAccess(auth, id, 'edit');
    this.s.db.run(
      'UPDATE pages SET icon = ?, full_width = ? WHERE id = ?',
      input.icon === undefined ? page.icon : input.icon,
      input.fullWidth === undefined ? page.full_width : input.fullWidth ? 1 : 0,
      id,
    );
    return this.require(id);
  }

  /* ------------------------------ Verschieben & Kopieren ------------------------------ */

  move(auth: AuthContext, id: number, input: { parentId: number | null; spaceId?: number; index?: number }): PageRow {
    const { page, space } = this.requireAccess(auth, id, 'move');
    if (space.home_page_id === page.id && (input.parentId || (input.spaceId && input.spaceId !== space.id))) {
      throw badRequest('Die Startseite eines Bereichs kann nicht verschoben werden');
    }
    const targetSpace = input.spaceId ? this.s.spaces.require(input.spaceId) : space;
    this.s.perms.requireSpace(auth, targetSpace, 'create');
    const parentId = this.resolveParent(auth, targetSpace, input.parentId);
    if (parentId !== null) {
      if (parentId === page.id || this.descendantIds(page.id, true).includes(parentId)) {
        throw badRequest('Eine Seite kann nicht unter sich selbst oder eine ihrer Unterseiten verschoben werden');
      }
    }
    const fromParent = page.parent_id;
    const movedIds = targetSpace.id !== space.id ? [page.id, ...this.descendantIds(page.id, true)] : [];
    this.s.db.transaction(() => {
      if (movedIds.length) {
        const ids = movedIds;
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          this.s.db.run(`UPDATE pages SET space_id = ? WHERE id IN ${Db.placeholders(chunk.length)}`, targetSpace.id, ...chunk);
        }
      }
      const siblings = this.s.db
        .all<{ id: number }>(
          `SELECT id FROM pages WHERE space_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'} AND id != ? AND deleted_at IS NULL
           ORDER BY position, id`,
          ...(parentId === null ? [targetSpace.id, page.id] : [targetSpace.id, parentId, page.id]),
        )
        .map((r) => r.id);
      const index = input.index === undefined ? siblings.length : Math.max(0, Math.min(siblings.length, input.index));
      siblings.splice(index, 0, page.id);
      siblings.forEach((sid, i) => this.s.db.run('UPDATE pages SET position = ? WHERE id = ?', i + 1, sid));
      this.s.db.run('UPDATE pages SET parent_id = ? WHERE id = ?', parentId, page.id);
    });
    // In einem anderen Bereich kann eine andere Wiedervorlage-Vorgabe gelten.
    for (const pid of movedIds) this.s.reviewCycle.refresh(pid);
    if (fromParent !== parentId || targetSpace.id !== space.id) {
      this.s.emit(auth, {
        type: 'page.moved',
        spaceId: targetSpace.id,
        pageId: page.id,
        target: { type: 'page', id: page.id, label: page.title },
        data: {
          fromParentId: fromParent,
          toParentId: parentId,
          fromSpace: space.key,
          toSpace: targetSpace.key,
          url: pageUrl(targetSpace.key, page.id, page.title),
        },
      });
    }
    return this.require(id);
  }

  async copy(
    auth: AuthContext,
    id: number,
    input: { spaceId?: number; parentId?: number | null; title?: string; includeChildren?: boolean; includeAttachments?: boolean; includeLabels?: boolean },
  ): Promise<PageRow> {
    const { page, space } = this.requireViewable(auth, id);
    const targetSpace = input.spaceId ? this.s.spaces.require(input.spaceId) : space;
    this.s.perms.requireSpace(auth, targetSpace, 'create');
    // Ohne Angabe: gleiche Ebene im selben Bereich, oberste Ebene in einem anderen Bereich
    const parentId = input.parentId === undefined ? (targetSpace.id === space.id ? page.parent_id : null) : input.parentId;
    const user = this.s.perms.requireUser(auth);
    let count = 0;

    // Teilbaum vor dem Kopieren festhalten: Sonst würden Kopien, die (beim Kopieren in den eigenen
    // Teilbaum) unter einer Quellseite entstehen, erneut mitkopiert.
    type Node = { page: PageRow; children: Node[] };
    let planned = 1;
    const snapshot = (source: PageRow, depth: number): Node => {
      const children: Node[] = [];
      if (input.includeChildren && depth < 50) {
        for (const child of this.children(auth, source.id, this.s.spaces.require(source.space_id))) {
          if (++planned > MAX_COPY_PAGES) throw badRequest(`Zu viele Seiten für eine Kopie (höchstens ${MAX_COPY_PAGES})`);
          children.push(snapshot(child, depth + 1));
        }
      }
      return { page: source, children };
    };
    const tree = snapshot(page, 0);

    const copyOne = async (node: Node, newParent: number | null, title: string): Promise<PageRow> => {
      const source = node.page;
      const created = await this.create(auth, {
        spaceId: targetSpace.id,
        parentId: newParent,
        title,
        content: source.content,
        contentType: source.content_type,
        language: source.language,
        icon: source.icon,
        fullWidth: !!source.full_width,
        changeNote: `Kopie von „${source.title}“ (Version ${source.version})`,
        labels: input.includeLabels === false ? [] : this.s.labels.labelsOf(source.id),
        properties: this.s.labels.propertiesOf(source.id),
        silent: true,
      });
      count++;
      if (input.includeAttachments !== false) this.s.attachments.copyAll(source.id, created.id, user.id);
      for (const child of node.children) await copyOne(child, created.id, child.page.title);
      return created;
    };

    const root = await copyOne(tree, parentId === targetSpace.home_page_id ? null : parentId, input.title?.trim() || `Kopie von ${page.title}`);
    this.s.emit(auth, {
      type: 'page.copied',
      spaceId: targetSpace.id,
      pageId: root.id,
      target: { type: 'page', id: root.id, label: root.title },
      data: { sourceId: page.id, sourceTitle: page.title, pages: count, url: pageUrl(targetSpace.key, root.id, root.title) },
    });
    return root;
  }

  /* ------------------------------ Sonstiges ------------------------------ */

  recordView(auth: AuthContext, id: number): void {
    this.pendingViews.set(id, (this.pendingViews.get(id) ?? 0) + 1);
    if (auth.user) {
      const key = `${auth.user.id}:${id}`;
      const entry = this.pendingUserViews.get(key);
      if (entry) {
        entry.count++;
        entry.at = nowIso();
      } else this.pendingUserViews.set(key, { userId: auth.user.id, pageId: id, count: 1, at: nowIso() });
    }
    if (!this.viewTimer) {
      this.viewTimer = setTimeout(() => this.flushViews(), 3000);
      this.viewTimer.unref();
    }
  }

  /** Gesammelte Seitenaufrufe in einer Transaktion schreiben (auch vor Auswertungen und beim Beenden). */
  flushViews(): void {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.viewTimer = null;
    if (!this.pendingViews.size && !this.pendingUserViews.size) return;
    const views = [...this.pendingViews];
    const userViews = [...this.pendingUserViews.values()];
    this.pendingViews.clear();
    this.pendingUserViews.clear();
    try {
      this.s.db.transaction(() => {
        for (const [pageId, count] of views) this.s.db.run('UPDATE pages SET view_count = view_count + ? WHERE id = ?', count, pageId);
        this.s.analytics.recordViews(views);
        for (const v of userViews) {
          this.s.db.run(
            // Person oder Seite können in den letzten Sekunden gelöscht worden sein – ein Fremdschlüsselfehler würde sonst alle gesammelten Aufrufe verwerfen
            `INSERT INTO page_views (user_id, page_id, count, viewed_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pages WHERE id = ?) AND EXISTS (SELECT 1 FROM users WHERE id = ?)
             ON CONFLICT(user_id, page_id) DO UPDATE SET count = count + excluded.count, viewed_at = excluded.viewed_at`,
            v.userId,
            v.pageId,
            v.count,
            v.at,
            v.pageId,
            v.userId,
          );
        }
      });
    } catch (err) {
      this.s.log.warn({ err }, 'Seitenaufrufe konnten nicht gespeichert werden');
    }
  }

  async toggleTask(auth: AuthContext, id: number, index: number, checked: boolean): Promise<PageRow> {
    const { page } = this.requireAccess(auth, id, 'edit');
    if (page.content_type !== 'richtext') throw badRequest('Aufgaben gibt es nur in Rich-Text-Seiten');
    const html = toggleTaskItem(page.content, index, checked);
    if (html === null) throw badRequest('Aufgabe nicht gefunden');
    return this.save(auth, id, {
      content: html,
      baseVersion: page.version,
      minor: true,
      changeNote: checked ? 'Aufgabe erledigt' : 'Aufgabe wieder geöffnet',
      changeType: 'task',
    });
  }

}

function prepareMentions(page: PageRow): number[] {
  if (page.content_type !== 'richtext') return [];
  const ids: number[] = [];
  for (const m of page.content.matchAll(/data-type="mention"[^>]*data-id="(\d+)"|data-id="(\d+)"[^>]*data-type="mention"/g)) {
    ids.push(Number(m[1] ?? m[2]));
  }
  return ids;
}

function countTasksFast(html: string): { total: number; done: number } {
  const total = (html.match(/data-type="taskItem"/g) ?? []).length;
  if (!total) return { total: 0, done: 0 };
  const done = (html.match(/<li[^>]*data-checked="true"[^>]*>/g) ?? []).length;
  return { total, done };
}
