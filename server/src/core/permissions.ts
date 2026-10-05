import type { Db } from '../db/database.ts';
import type { Locale } from './i18n.ts';
import { Db as DbClass, parseJson } from '../db/database.ts';
import type { SettingsService } from './settings.ts';
import type { PageRow, SpaceRow, UserRow } from './types.ts';
import { forbidden, unauthorized } from './errors.ts';

/* ------------------------------------------------------------------ *
 * Globale Berechtigungen (werden Gruppen zugewiesen)
 * ------------------------------------------------------------------ */
export const GLOBAL_PERMISSIONS: Record<string, { label: string; description: string }> = {
  admin: {
    label: 'Systemadministration',
    description: 'Vollzugriff auf alle Bereiche, Seiten, Einstellungen und die gesamte Verwaltung.',
  },
  'spaces.create': { label: 'Bereiche erstellen', description: 'Darf neue Team-Bereiche anlegen.' },
  'users.manage': { label: 'Benutzer & Gruppen verwalten', description: 'Benutzer anlegen, sperren und Gruppen pflegen.' },
  'templates.manage': { label: 'Globale Vorlagen verwalten', description: 'Systemweite Seitenvorlagen erstellen und ändern.' },
  'integrations.manage': {
    label: 'Integrationen verwalten',
    description: 'Webhooks und API-Konnektoren einrichten und testen.',
  },
  'audit.view': { label: 'Audit-Log einsehen', description: 'Sicherheits- und Verwaltungsereignisse einsehen.' },
  'analytics.view': {
    label: 'Inhaltsanalyse einsehen',
    description: 'Meistgelesene und ungelesene Seiten, Suchbegriffe ohne Treffer, verwaiste Seiten und defekte Verweise in allen lesbaren Bereichen.',
  },
  'api.tokens': { label: 'API-Tokens erstellen', description: 'Persönliche Zugriffstokens für die REST-API erzeugen.' },
  'ai.use': {
    label: 'KI-Funktionen nutzen',
    description: 'Darf Texte zusammenfassen, verbessern, übersetzen und Fragen an Seiten stellen (sofern eine KI eingerichtet ist).',
  },
};

/* ------------------------------------------------------------------ *
 * Bereichsrollen und die daraus abgeleiteten Aktionen
 * ------------------------------------------------------------------ */
export const SPACE_ROLES = ['viewer', 'commenter', 'editor', 'admin'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

export const ROLE_RANK: Record<SpaceRole, number> = { viewer: 1, commenter: 2, editor: 3, admin: 4 };

export const ROLE_LABELS: Record<SpaceRole, string> = {
  viewer: 'Lesen',
  commenter: 'Kommentieren',
  editor: 'Bearbeiten',
  admin: 'Bereich verwalten',
};

/** Mindestrolle je Aktion innerhalb eines Bereichs. */
export const SPACE_ACTIONS = {
  view: 'viewer',
  export: 'viewer',
  comment: 'commenter',
  create: 'editor',
  edit: 'editor',
  move: 'editor',
  delete: 'editor',
  attach: 'editor',
  restrict: 'editor',
  moderate: 'admin',
  purge: 'admin',
  admin: 'admin',
} as const satisfies Record<string, SpaceRole>;

export type SpaceAction = keyof typeof SPACE_ACTIONS;

/** Aktionen, die in archivierten Bereichen weiterhin möglich sind. */
const ARCHIVE_SAFE: SpaceAction[] = ['view', 'export', 'admin'];

export function roleAtLeast(role: SpaceRole | null, min: SpaceRole): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

/* ------------------------------------------------------------------ *
 * Anfragekontext
 * ------------------------------------------------------------------ */
export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  kind: 'user' | 'bot';
  avatarColor: string | null;
  preferences: Record<string, unknown>;
}

export interface AuthContext {
  user: AuthUser | null;
  groupIds: number[];
  permissions: Set<string>;
  isAdmin: boolean;
  via: 'session' | 'token' | 'anonymous' | 'system';
  scopes: Set<string> | null;
  sessionId: string | null;
  tokenId: number | null;
  ip: string | null;
  userAgent: string | null;
  cache: Map<string, unknown>;
  /** Sprache der Anfrage (Oberfläche bzw. Profil) – für Beschriftungen in Antworten */
  locale?: Locale;
}

export interface Subject {
  type: 'user' | 'group';
  id: number;
}

export interface PageRestrictions {
  view: Subject[];
  edit: Subject[];
}

export interface PageAccess {
  view: boolean;
  export: boolean;
  comment: boolean;
  edit: boolean;
  create: boolean;
  move: boolean;
  delete: boolean;
  attach: boolean;
  restrict: boolean;
  moderate: boolean;
  purge: boolean;
  admin: boolean;
}

type PageLike = Pick<PageRow, 'id' | 'space_id' | 'parent_id' | 'status' | 'created_by' | 'deleted_at'>;

export class PermissionService {
  private readonly db: Db;
  private readonly settings: SettingsService;
  /** Seiten mit Leseeinschränkung (meist wenige) – spart Baum-Abfragen, wenn es keine gibt */
  private viewRestricted: { ids: Set<number>; loadedAt: number } | null = null;

  constructor(db: Db, settings: SettingsService) {
    this.db = db;
    this.settings = settings;
  }

  /** Nach Änderungen an Seiteneinschränkungen aufrufen. */
  invalidateRestrictions(): void {
    this.viewRestricted = null;
  }

  /**
   * Gibt es überhaupt Seiten mit Leseeinschränkung? Auswertungen über viele Seiten (Stichwörter,
   * Eigenschaftsnamen, Benachrichtigungen) sparen sich im Normalfall damit die Einzelprüfung.
   */
  hasViewRestrictions(): boolean {
    return this.viewRestrictedIds().size > 0;
  }

  private viewRestrictedIds(): Set<number> {
    // Sicherheitsnetz: nach spätestens einer Minute neu laden (z. B. Änderungen per CLI)
    if (!this.viewRestricted || Date.now() - this.viewRestricted.loadedAt > 60_000) {
      const ids = this.db.all<{ page_id: number }>("SELECT DISTINCT page_id FROM page_restrictions WHERE kind = 'view'").map((r) => r.page_id);
      this.viewRestricted = { ids: new Set(ids), loadedAt: Date.now() };
    }
    return this.viewRestricted.ids;
  }

  /* ----------------------------- Kontext ----------------------------- */

  anonymous(ip: string | null = null, userAgent: string | null = null): AuthContext {
    return {
      user: null,
      groupIds: [],
      permissions: new Set(),
      isAdmin: false,
      via: 'anonymous',
      scopes: null,
      sessionId: null,
      tokenId: null,
      ip,
      userAgent,
      cache: new Map(),
    };
  }

  /** Systemkontext für interne Aufgaben (Seed, CLI, Jobs). */
  system(): AuthContext {
    return { ...this.anonymous(), via: 'system', isAdmin: true, permissions: new Set(['admin']) };
  }

  forUser(
    row: UserRow,
    extras: Partial<Pick<AuthContext, 'via' | 'scopes' | 'sessionId' | 'tokenId' | 'ip' | 'userAgent'>> = {},
  ): AuthContext {
    const groups = this.db.all<{ id: number; permissions: string }>(
      'SELECT g.id, g.permissions FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?',
      row.id,
    );
    const permissions = new Set<string>();
    for (const g of groups) for (const p of parseJson<string[]>(g.permissions, [])) permissions.add(p);
    return {
      user: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        email: row.email,
        kind: row.kind,
        avatarColor: row.avatar_color,
        preferences: parseJson<Record<string, unknown>>(row.preferences, {}),
      },
      groupIds: groups.map((g) => g.id),
      permissions,
      isAdmin: permissions.has('admin'),
      via: extras.via ?? 'session',
      scopes: extras.scopes ?? null,
      sessionId: extras.sessionId ?? null,
      tokenId: extras.tokenId ?? null,
      ip: extras.ip ?? null,
      userAgent: extras.userAgent ?? null,
      cache: new Map(),
    };
  }

  /* ------------------------ Globale Rechte ------------------------ */

  hasGlobal(auth: AuthContext, permission: string): boolean {
    if (!auth.user && auth.via !== 'system') return false;
    return auth.isAdmin || auth.permissions.has(permission);
  }

  requireUser(auth: AuthContext): AuthUser {
    if (!auth.user) throw unauthorized();
    return auth.user;
  }

  requireGlobal(auth: AuthContext, permission: string): void {
    if (!auth.user && auth.via !== 'system') throw unauthorized();
    if (!this.hasGlobal(auth, permission)) throw forbidden();
  }

  /* ------------------------- Bereichsrechte ------------------------- */

  spaceRole(auth: AuthContext, space: SpaceRow): SpaceRole | null {
    const cacheKey = `role:${space.id}`;
    if (auth.cache.has(cacheKey)) return auth.cache.get(cacheKey) as SpaceRole | null;

    let role: SpaceRole | null = null;
    if (auth.isAdmin) role = 'admin';
    else if (auth.user && space.kind === 'personal' && space.owner_id === auth.user.id) role = 'admin';
    else {
      const clauses: string[] = [];
      const params: (number | string)[] = [space.id];
      if (this.settings.get('anonymousAccess')) clauses.push("subject_type = 'anonymous'");
      if (auth.user) {
        clauses.push("subject_type = 'authenticated'");
        clauses.push("(subject_type = 'user' AND subject_id = ?)");
        params.push(auth.user.id);
        if (auth.groupIds.length) {
          clauses.push(`(subject_type = 'group' AND subject_id IN ${DbClass.placeholders(auth.groupIds.length)})`);
          params.push(...auth.groupIds);
        }
      }
      if (clauses.length) {
        const rows = this.db.all<{ role: SpaceRole }>(
          `SELECT role FROM space_permissions WHERE space_id = ? AND (${clauses.join(' OR ')})`,
          ...params,
        );
        for (const r of rows) if (!role || ROLE_RANK[r.role] > ROLE_RANK[role]) role = r.role;
      }
    }
    auth.cache.set(cacheKey, role);
    return role;
  }

  canSpace(auth: AuthContext, space: SpaceRow, action: SpaceAction): boolean {
    // Interne Hintergrundaufgaben (z. B. Wiedervorlage) handeln im Systemkontext.
    if (auth.via === 'system') return true;
    const role = this.spaceRole(auth, space);
    if (!roleAtLeast(role, SPACE_ACTIONS[action])) return false;
    if (space.archived_at && !ARCHIVE_SAFE.includes(action)) return false;
    // Anonyme Besucher dürfen niemals schreiben.
    if (!auth.user && action !== 'view' && action !== 'export') return false;
    return true;
  }

  requireSpace(auth: AuthContext, space: SpaceRow, action: SpaceAction): void {
    if (!this.canSpace(auth, space, action)) {
      if (!auth.user && !this.canSpace(auth, space, 'view')) throw unauthorized();
      throw forbidden(
        space.archived_at && action !== 'view'
          ? 'Der Bereich ist archiviert und kann nicht bearbeitet werden'
          : 'Dafür fehlt dir die Berechtigung in diesem Bereich',
      );
    }
  }

  /** IDs aller Bereiche, die der Benutzer mindestens lesen darf. */
  viewableSpaceIds(auth: AuthContext): number[] {
    const cacheKey = 'viewableSpaces';
    if (auth.cache.has(cacheKey)) return auth.cache.get(cacheKey) as number[];
    const spaces = this.db.all<SpaceRow>('SELECT * FROM spaces');
    const ids = spaces.filter((s) => this.canSpace(auth, s, 'view')).map((s) => s.id);
    auth.cache.set(cacheKey, ids);
    return ids;
  }

  /* ------------------------ Seiteneinschränkungen ------------------------ */

  restrictionsFor(pageIds: number[]): Map<number, PageRestrictions> {
    const map = new Map<number, PageRestrictions>();
    if (!pageIds.length) return map;
    // In Blöcken abfragen, um das Parameterlimit von SQLite nicht zu überschreiten.
    for (let i = 0; i < pageIds.length; i += 500) {
      const chunk = pageIds.slice(i, i + 500);
      const rows = this.db.all<{ page_id: number; kind: 'view' | 'edit'; subject_type: 'user' | 'group'; subject_id: number }>(
        `SELECT page_id, kind, subject_type, subject_id FROM page_restrictions WHERE page_id IN ${DbClass.placeholders(chunk.length)}`,
        ...chunk,
      );
      for (const r of rows) {
        let entry = map.get(r.page_id);
        if (!entry) {
          entry = { view: [], edit: [] };
          map.set(r.page_id, entry);
        }
        entry[r.kind].push({ type: r.subject_type, id: r.subject_id });
      }
    }
    return map;
  }

  /** Kette aus Seite und allen Vorfahren (Seite zuerst). */
  ancestorChain(pageId: number): number[] {
    return this.db
      .all<{ id: number }>(
        `WITH RECURSIVE chain(id, parent_id, depth) AS (
           SELECT id, parent_id, 0 FROM pages WHERE id = ?
           UNION ALL
           SELECT p.id, p.parent_id, c.depth + 1 FROM pages p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 100
         )
         SELECT id FROM chain ORDER BY depth`,
        pageId,
      )
      .map((r) => r.id);
  }

  matchesSubjects(auth: AuthContext, subjects: Subject[]): boolean {
    if (!auth.user) return false;
    return subjects.some(
      (s) => (s.type === 'user' && s.id === auth.user!.id) || (s.type === 'group' && auth.groupIds.includes(s.id)),
    );
  }

  /**
   * Nur die Leseeinschränkungen der Seite und ihrer Vorfahren – ohne Bereichsrecht, Entwurfs- und
   * Papierkorbstatus. Öffentlich, weil auch Benachrichtigungen daran gemessen werden.
   */
  passesViewRestrictions(auth: AuthContext, pageId: number): boolean {
    if (auth.isAdmin || !this.viewRestrictedIds().size) return true;
    const cacheKey = `viewr:${pageId}`;
    if (auth.cache.has(cacheKey)) return auth.cache.get(cacheKey) as boolean;
    const chain = this.ancestorChain(pageId);
    const restrictions = this.restrictionsFor(chain);
    let ok = true;
    for (const id of chain) {
      const r = restrictions.get(id);
      if (r && r.view.length && !this.matchesSubjects(auth, r.view)) {
        ok = false;
        break;
      }
    }
    auth.cache.set(cacheKey, ok);
    return ok;
  }

  canViewPage(auth: AuthContext, page: PageLike, space: SpaceRow, options: { includeDeleted?: boolean } = {}): boolean {
    if (page.deleted_at && !options.includeDeleted) return false;
    if (page.status === 'draft') return !!auth.user && page.created_by === auth.user.id;
    if (!this.canSpace(auth, space, 'view')) return false;
    return this.passesViewRestrictions(auth, page.id);
  }

  pageAccess(auth: AuthContext, page: PageLike, space: SpaceRow): PageAccess {
    const view = this.canViewPage(auth, page, space, { includeDeleted: true });
    const none: PageAccess = {
      view: false,
      export: false,
      comment: false,
      edit: false,
      create: false,
      move: false,
      delete: false,
      attach: false,
      restrict: false,
      moderate: false,
      purge: false,
      admin: false,
    };
    if (!view) return none;
    const isDraftOwner = page.status === 'draft' && !!auth.user && page.created_by === auth.user.id;
    // Eigene Entwürfe: lesen und verwerfen immer, bearbeiten und veröffentlichen nur mit dem Recht,
    // im Bereich Seiten anzulegen (sonst bliebe nach Rechteentzug oder Archivierung ein Hintertürchen).
    let editAllowed = isDraftOwner ? this.canSpace(auth, space, 'create') : this.canSpace(auth, space, 'edit');
    if (editAllowed && !auth.isAdmin && page.status !== 'draft') {
      const r = this.restrictionsFor([page.id]).get(page.id);
      if (r && r.edit.length && !this.matchesSubjects(auth, r.edit)) editAllowed = false;
    }
    const can = (a: SpaceAction) => this.canSpace(auth, space, a);
    return {
      view: true,
      export: can('export'),
      comment: page.status !== 'draft' && can('comment'),
      edit: editAllowed && !page.deleted_at,
      create: can('create'),
      move: editAllowed && can('move'),
      delete: (editAllowed && can('delete')) || isDraftOwner,
      attach: editAllowed && (can('attach') || isDraftOwner),
      restrict: editAllowed && can('restrict'),
      moderate: can('moderate'),
      purge: can('purge'),
      admin: can('admin'),
    };
  }

  /**
   * Filtert eine Liste von Seiten eines Bereichs auf die sichtbaren Seiten.
   * Einschränkungen werden entlang des Baums vererbt.
   */
  visiblePageIds(auth: AuthContext, space: SpaceRow, pages: PageLike[]): Set<number> {
    const visible = new Set<number>();
    if (!this.canSpace(auth, space, 'view')) {
      // Nur eigene Entwürfe bleiben sichtbar.
      return visible;
    }
    const noRestrictions = auth.isAdmin || !this.viewRestrictedIds().size;
    const restrictions = noRestrictions ? new Map<number, PageRestrictions>() : this.restrictionsFor(pages.map((p) => p.id));
    const byId = new Map(pages.map((p) => [p.id, p]));
    const decided = new Map<number, boolean>();

    const allowed = (page: PageLike, depth = 0): boolean => {
      const known = decided.get(page.id);
      if (known !== undefined) return known;
      let ok = true;
      if (page.status === 'draft' && !(auth.user && page.created_by === auth.user.id)) ok = false;
      const r = restrictions.get(page.id);
      if (ok && r && r.view.length && !this.matchesSubjects(auth, r.view)) ok = false;
      if (ok && page.parent_id && depth < 100 && !noRestrictions) {
        const parent = byId.get(page.parent_id);
        if (parent) ok = allowed(parent, depth + 1);
        else if (!auth.isAdmin) ok = this.passesViewRestrictions(auth, page.parent_id);
      }
      decided.set(page.id, ok);
      return ok;
    };

    for (const p of pages) if (allowed(p)) visible.add(p.id);
    return visible;
  }
}
