import type { Services } from '../../services.ts';
import type { SpaceRow, UserRow, GroupRow } from '../../core/types.ts';
import type { AuthContext, SpaceRole } from '../../core/permissions.ts';
import { ROLE_RANK, SPACE_ROLES } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.ts';
import { nextRowId, rememberRowId } from '../../core/subjects.ts';

export const SPACE_KEY_RE = /^[A-Z][A-Z0-9_]{1,19}$/;

export interface SpaceGrant {
  subjectType: 'user' | 'group' | 'authenticated' | 'anonymous';
  subjectId: number;
  role: SpaceRole;
  label?: string;
  detail?: string;
}

export interface SpaceDto {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  color: string | null;
  kind: 'team' | 'personal';
  ownerId: number | null;
  homePageId: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Gliederung der Bereichsliste (Hauptmenü, Bereichsverzeichnis) */
  category: string;
  /** Änderungen müssen freigegeben werden */
  reviewRequired: boolean;
  /** Bearbeitungsmodus neuer Rich-Text-Seiten */
  defaultEditMode: 'direct' | 'suggest';
  role: SpaceRole | null;
  can: { view: boolean; create: boolean; comment: boolean; admin: boolean; purge: boolean; export: boolean };
  pageCount?: number;
  isWatching?: boolean;
  lastActivityAt?: string | null;
}

export type SpacePreset = 'open' | 'readonly' | 'private';

interface SpaceStats {
  pages: Map<number, { count: number; last: string | null }>;
  watched: Set<number>;
}

export class SpaceService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  get(id: number): SpaceRow | undefined {
    return this.s.db.get<SpaceRow>('SELECT * FROM spaces WHERE id = ?', id);
  }

  require(id: number): SpaceRow {
    const row = this.get(id);
    if (!row) throw notFound('Bereich nicht gefunden');
    return row;
  }

  byKey(key: string): SpaceRow | undefined {
    return this.s.db.get<SpaceRow>('SELECT * FROM spaces WHERE key = ?', key);
  }

  requireByKey(key: string): SpaceRow {
    const row = this.byKey(key);
    if (!row) throw notFound('Bereich nicht gefunden');
    return row;
  }

  /** Bereich laden und Leserecht prüfen. */
  requireViewable(auth: AuthContext, key: string): SpaceRow {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'view');
    return space;
  }

  toDto(auth: AuthContext, row: SpaceRow, extras: { counts?: boolean; stats?: SpaceStats } = {}): SpaceDto {
    const perms = this.s.perms;
    const dto: SpaceDto = {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      kind: row.kind,
      ownerId: row.owner_id,
      homePageId: row.home_page_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      category: row.category ?? '',
      reviewRequired: !!row.review_required,
      defaultEditMode: row.default_edit_mode ?? 'direct',
      role: perms.spaceRole(auth, row),
      can: {
        view: perms.canSpace(auth, row, 'view'),
        create: perms.canSpace(auth, row, 'create'),
        comment: perms.canSpace(auth, row, 'comment'),
        admin: perms.canSpace(auth, row, 'admin'),
        purge: perms.canSpace(auth, row, 'purge'),
        export: perms.canSpace(auth, row, 'export'),
      },
    };
    if (extras.stats) {
      const stat = extras.stats.pages.get(row.id);
      dto.pageCount = stat?.count ?? 0;
      dto.lastActivityAt = stat?.last ?? null;
      if (auth.user) dto.isWatching = extras.stats.watched.has(row.id);
    } else if (extras.counts) {
      dto.pageCount =
        this.s.db.value<number>("SELECT COUNT(*) FROM pages WHERE space_id = ? AND deleted_at IS NULL AND status = 'current'", row.id) ?? 0;
      dto.lastActivityAt = this.s.db.value<string>(
        "SELECT MAX(updated_at) FROM pages WHERE space_id = ? AND deleted_at IS NULL AND status = 'current'",
        row.id,
      ) ?? null;
      if (auth.user) {
        dto.isWatching = !!this.s.db.value(
          "SELECT 1 FROM watches WHERE user_id = ? AND target_type = 'space' AND target_id = ?",
          auth.user.id,
          row.id,
        );
      }
    }
    return dto;
  }

  list(auth: AuthContext, filter: { q?: string; includeArchived?: boolean; kind?: 'team' | 'personal' } = {}): SpaceDto[] {
    const rows = this.s.db.all<SpaceRow>('SELECT * FROM spaces ORDER BY name COLLATE NOCASE');
    const q = filter.q?.toLowerCase();
    return rows
      .filter((r) => (filter.includeArchived ? true : !r.archived_at))
      .filter((r) => (filter.kind ? r.kind === filter.kind : true))
      .filter((r) => (q ? r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) : true))
      .filter((r) => this.s.perms.canSpace(auth, r, 'view'))
      .map((r) => this.toDto(auth, r, { stats: this.stats(auth) }));
  }

  /** Seitenzahl, letzte Änderung und Beobachtung aller Bereiche in zwei Abfragen (statt drei je Bereich). */
  private stats(auth: AuthContext): SpaceStats {
    const cacheKey = 'space-stats';
    const cached = auth.cache.get(cacheKey) as SpaceStats | undefined;
    if (cached) return cached;
    const pages = new Map<number, { count: number; last: string | null }>();
    for (const r of this.s.db.all<{ space_id: number; count: number; last: string | null }>(
      "SELECT space_id, COUNT(*) AS count, MAX(updated_at) AS last FROM pages WHERE deleted_at IS NULL AND status = 'current' GROUP BY space_id",
    )) {
      pages.set(r.space_id, { count: r.count, last: r.last });
    }
    const watched = new Set(
      auth.user ? this.s.db.all<{ target_id: number }>("SELECT target_id FROM watches WHERE user_id = ? AND target_type = 'space'", auth.user.id).map((r) => r.target_id) : [],
    );
    const stats = { pages, watched };
    auth.cache.set(cacheKey, stats);
    return stats;
  }

  /* ------------------------------ Anlegen & Ändern ------------------------------ */

  async create(
    auth: AuthContext,
    input: {
      key: string;
      name: string;
      description?: string;
      icon?: string | null;
      color?: string | null;
      preset?: SpacePreset;
      homeContent?: string;
      category?: string;
      reviewRequired?: boolean;
    },
  ): Promise<SpaceRow> {
    const user = this.s.perms.requireUser(auth);
    this.s.perms.requireGlobal(auth, 'spaces.create');
    const key = input.key.trim().toUpperCase();
    if (!SPACE_KEY_RE.test(key)) {
      throw badRequest('Der Schlüssel muss mit einem Buchstaben beginnen und darf nur A–Z, 0–9 und _ enthalten (2–20 Zeichen)');
    }
    if (this.byKey(key)) throw conflict(`Der Bereichsschlüssel „${key}“ ist bereits vergeben`);
    const name = input.name.trim();
    if (!name) throw badRequest('Bitte einen Namen angeben');
    const space = this.insert({
      key,
      name,
      description: input.description ?? '',
      icon: input.icon ?? '📘',
      color: input.color ?? null,
      kind: 'team',
      ownerId: user.id,
      createdBy: user.id,
      category: this.s.categories.resolve(auth, input.category),
      reviewRequired: !!input.reviewRequired,
    });
    const preset = input.preset ?? 'open';
    this.s.db.transaction(() => {
      this.s.db.run("INSERT INTO space_permissions (space_id, subject_type, subject_id, role) VALUES (?, 'user', ?, 'admin')", space.id, user.id);
      if (preset === 'open') {
        this.s.db.run("INSERT INTO space_permissions (space_id, subject_type, subject_id, role) VALUES (?, 'authenticated', 0, 'editor')", space.id);
      } else if (preset === 'readonly') {
        this.s.db.run("INSERT INTO space_permissions (space_id, subject_type, subject_id, role) VALUES (?, 'authenticated', 0, 'viewer')", space.id);
      }
    });
    auth.cache.clear();
    await this.createHomePage(auth, space, input.homeContent);
    this.s.emit(auth, {
      type: 'space.created',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: `${space.name} (${space.key})` },
      data: { key: space.key, preset },
    });
    return this.require(space.id);
  }

  private insert(input: {
    key: string;
    name: string;
    description: string;
    icon: string | null;
    color: string | null;
    kind: 'team' | 'personal';
    ownerId: number | null;
    createdBy: number | null;
    category?: string;
    reviewRequired?: boolean;
  }): SpaceRow {
    const now = nowIso();
    const res = this.s.db.run(
      `INSERT INTO spaces (id, key, name, description, icon, color, kind, owner_id, created_by, created_at, updated_at, category, review_required)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nextRowId(this.s.db, 'spaces'),
      input.key,
      input.name,
      input.description,
      input.icon,
      input.color,
      input.kind,
      input.ownerId,
      input.createdBy,
      now,
      now,
      input.category ?? '',
      input.reviewRequired ? 1 : 0,
    );
    return this.require(res.lastInsertRowid);
  }

  private async createHomePage(auth: AuthContext, space: SpaceRow, content?: string): Promise<void> {
    const en = (auth.locale ?? this.s.settings.get('defaultLocale')) === 'en';
    const html =
      content ??
      (en
        ? `<h2>Welcome to the space ${escape(space.name)}</h2>
<p>${escape(space.description || 'This is the home page of the space. Describe its purpose, contacts and the most important entry points here.')}</p>
<div data-type="callout" data-variant="info"><p>Tip: create new pages via <strong>"+ Page"</strong> in the sidebar. In the editor, <code>/</code> opens the macro menu.</p></div>
<h3>Content</h3>
<div data-type="children" data-depth="2" data-scope="space"></div>
<h3>Recently changed</h3>
<div data-type="recent-pages" data-limit="8" data-scope="space"></div>`
        : `<h2>Willkommen im Bereich ${escape(space.name)}</h2>
<p>${escape(space.description || 'Dies ist die Startseite des Bereichs. Beschreibe hier Zweck, Ansprechpartner und die wichtigsten Einstiegspunkte.')}</p>
<div data-type="callout" data-variant="info"><p>Tipp: Über <strong>„+ Seite“</strong> in der Seitenleiste legst du neue Seiten an. Mit <code>/</code> öffnest du im Editor das Makro-Menü.</p></div>
<h3>Inhalte</h3>
<div data-type="children" data-depth="2" data-scope="space"></div>
<h3>Zuletzt geändert</h3>
<div data-type="recent-pages" data-limit="8" data-scope="space"></div>`);
    const page = await this.s.pages.create(auth, {
      spaceId: space.id,
      parentId: null,
      title: space.kind === 'personal' ? space.name : en ? 'Overview' : 'Übersicht',
      icon: '🏠',
      content: html,
      contentType: 'richtext',
      changeNote: en ? 'Space created' : 'Bereich angelegt',
      silent: true,
    });
    this.s.db.run('UPDATE spaces SET home_page_id = ? WHERE id = ?', page.id, space.id);
  }

  update(
    auth: AuthContext,
    key: string,
    input: {
      name?: string;
      description?: string;
      icon?: string | null;
      color?: string | null;
      homePageId?: number | null;
      category?: string;
      reviewRequired?: boolean;
      defaultEditMode?: 'direct' | 'suggest';
    },
  ): SpaceRow {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'admin');
    const changes: Record<string, unknown> = {};
    if (input.name !== undefined && input.name.trim() && input.name.trim() !== space.name) changes.name = input.name.trim();
    if (input.description !== undefined && input.description !== space.description) changes.description = input.description;
    if (input.icon !== undefined && input.icon !== space.icon) changes.icon = input.icon;
    if (input.color !== undefined && input.color !== space.color) changes.color = input.color;
    if (input.category !== undefined) {
      const category = this.s.categories.resolve(auth, input.category);
      if (category !== space.category) changes.category = category;
    }
    if (input.reviewRequired !== undefined && input.reviewRequired !== !!space.review_required) changes.reviewRequired = input.reviewRequired;
    if (input.defaultEditMode !== undefined && input.defaultEditMode !== space.default_edit_mode) changes.defaultEditMode = input.defaultEditMode;
    if (input.homePageId !== undefined && input.homePageId !== space.home_page_id) {
      if (input.homePageId !== null) {
        const page = this.s.pages.get(input.homePageId);
        if (!page || page.space_id !== space.id || page.deleted_at || page.status !== 'current') throw badRequest('Ungültige Startseite');
        if (page.parent_id !== null) throw badRequest('Die Startseite muss eine Seite der obersten Ebene sein');
        const childCount = this.s.db.value<number>('SELECT COUNT(*) FROM pages WHERE parent_id = ? AND deleted_at IS NULL', page.id) ?? 0;
        if (childCount > 0) throw badRequest('Die Startseite darf keine Unterseiten haben');
      }
      changes.homePageId = input.homePageId;
    }
    if (!Object.keys(changes).length) return space;
    this.s.db.run(
      `UPDATE spaces SET name = ?, description = ?, icon = ?, color = ?, home_page_id = ?, updated_at = ?,
                        category = ?, review_required = ?, default_edit_mode = ? WHERE id = ?`,
      (changes.name as string) ?? space.name,
      (changes.description as string) ?? space.description,
      'icon' in changes ? (changes.icon as string | null) : space.icon,
      'color' in changes ? (changes.color as string | null) : space.color,
      'homePageId' in changes ? (changes.homePageId as number | null) : space.home_page_id,
      nowIso(),
      'category' in changes ? (changes.category as string) : space.category,
      'reviewRequired' in changes ? ((changes.reviewRequired as boolean) ? 1 : 0) : space.review_required,
      'defaultEditMode' in changes ? (changes.defaultEditMode as string) : space.default_edit_mode,
      space.id,
    );
    this.s.emit(auth, { type: 'space.updated', spaceId: space.id, target: { type: 'space', id: space.id, label: space.name }, data: changes });
    return this.require(space.id);
  }

  setArchived(auth: AuthContext, key: string, archived: boolean): SpaceRow {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'admin');
    if (!!space.archived_at === archived) return space;
    this.s.db.run('UPDATE spaces SET archived_at = ?, updated_at = ? WHERE id = ?', archived ? nowIso() : null, nowIso(), space.id);
    this.s.emit(auth, {
      type: archived ? 'space.archived' : 'space.unarchived',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
    });
    return this.require(space.id);
  }

  /** Löscht einen Bereich endgültig inklusive aller Seiten und Dateien. */
  delete(auth: AuthContext, key: string): void {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'admin');
    if (space.kind === 'personal' && !auth.isAdmin && space.owner_id !== auth.user?.id) throw forbidden();
    const files = this.s.db.all<{ storage_key: string }>(
      'SELECT a.storage_key FROM attachments a JOIN pages p ON p.id = a.page_id WHERE p.space_id = ?',
      space.id,
    );
    const pageIds = this.s.db.all<{ id: number }>('SELECT id FROM pages WHERE space_id = ?', space.id).map((r) => r.id);
    this.s.db.transaction(() => {
      // Die Nummern bleiben vergeben: Der Verlauf der gelöschten Seiten darf nicht an neue Seiten oder Bereiche geraten
      rememberRowId(this.s.db, 'spaces', space.id);
      if (pageIds.length) rememberRowId(this.s.db, 'pages', Math.max(...pageIds));
      for (const id of pageIds) this.s.search.remove(id);
      this.s.db.run('DELETE FROM attachments_fts WHERE rowid IN (SELECT a.id FROM attachments a JOIN pages p ON p.id = a.page_id WHERE p.space_id = ?)', space.id);
      this.s.db.run('DELETE FROM watches WHERE target_type = ? AND target_id = ?', 'space', space.id);
      this.s.db.run('UPDATE pages SET parent_id = NULL WHERE space_id = ?', space.id);
      this.s.db.run('DELETE FROM pages WHERE space_id = ?', space.id);
      this.s.db.run('DELETE FROM spaces WHERE id = ?', space.id);
    });
    // Dateien erst nach der Karenzzeit entfernen – zusammen mit der Sicherung vor dem Löschen
    // lässt sich ein versehentlich gelöschter Bereich so vollständig zurückholen.
    this.s.attachments.scheduleFileRemoval(files.map((f) => f.storage_key));
    this.s.emit(auth, {
      type: 'space.deleted',
      target: { type: 'space', id: space.id, label: `${space.name} (${space.key})` },
      data: { pages: pageIds.length, files: files.length },
    });
  }

  /* ------------------------------- Berechtigungen ------------------------------- */

  grants(auth: AuthContext, key: string): SpaceGrant[] {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'admin');
    return this.grantsOf(space.id);
  }

  grantsOf(spaceId: number): SpaceGrant[] {
    const rows = this.s.db.all<{ subject_type: SpaceGrant['subjectType']; subject_id: number; role: SpaceRole }>(
      'SELECT subject_type, subject_id, role FROM space_permissions WHERE space_id = ?',
      spaceId,
    );
    const users = this.s.users.refs(rows.filter((r) => r.subject_type === 'user').map((r) => r.subject_id));
    const groupIds = rows.filter((r) => r.subject_type === 'group').map((r) => r.subject_id);
    const groups = new Map<number, GroupRow>();
    for (const id of groupIds) {
      const g = this.s.groups.get(id);
      if (g) groups.set(id, g);
    }
    const order = { anonymous: 0, authenticated: 1, group: 2, user: 3 };
    return rows
      .map((r) => {
        let label: string;
        let detail = '';
        if (r.subject_type === 'user') {
          const u = users.get(r.subject_id);
          label = u?.displayName ?? `Benutzer #${r.subject_id}`;
          detail = u ? `@${u.username}` : '';
        } else if (r.subject_type === 'group') {
          label = groups.get(r.subject_id)?.name ?? `Gruppe #${r.subject_id}`;
          detail = 'Gruppe';
        } else if (r.subject_type === 'authenticated') {
          label = 'Alle angemeldeten Benutzer';
        } else {
          label = 'Anonyme Besucher (öffentlich)';
        }
        return { subjectType: r.subject_type, subjectId: r.subject_id, role: r.role, label, detail };
      })
      .sort((a, b) => order[a.subjectType] - order[b.subjectType] || ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.label.localeCompare(b.label));
  }

  setGrants(auth: AuthContext, key: string, grants: SpaceGrant[]): SpaceGrant[] {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'admin');
    const clean = new Map<string, SpaceGrant>();
    for (const g of grants) {
      if (!SPACE_ROLES.includes(g.role)) throw badRequest(`Unbekannte Rolle: ${g.role}`);
      const subjectId = g.subjectType === 'authenticated' || g.subjectType === 'anonymous' ? 0 : g.subjectId;
      if (g.subjectType === 'user' && !this.s.users.get(subjectId)) throw badRequest(`Benutzer #${subjectId} existiert nicht`);
      if (g.subjectType === 'group' && !this.s.groups.get(subjectId)) throw badRequest(`Gruppe #${subjectId} existiert nicht`);
      if (g.subjectType === 'anonymous' && ROLE_RANK[g.role] > ROLE_RANK.viewer) {
        throw badRequest('Anonyme Besucher können höchstens Leserechte erhalten');
      }
      clean.set(`${g.subjectType}:${subjectId}`, { subjectType: g.subjectType, subjectId, role: g.role });
    }
    const hasAdmin = [...clean.values()].some((g) => g.role === 'admin' && (g.subjectType === 'user' || g.subjectType === 'group'));
    if (!hasAdmin && space.kind === 'team') throw badRequest('Mindestens ein Benutzer oder eine Gruppe muss die Rolle „Bereich verwalten“ behalten');
    const before = this.grantsOf(space.id);
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM space_permissions WHERE space_id = ?', space.id);
      for (const g of clean.values()) {
        this.s.db.run(
          'INSERT INTO space_permissions (space_id, subject_type, subject_id, role) VALUES (?, ?, ?, ?)',
          space.id,
          g.subjectType,
          g.subjectId,
          g.role,
        );
      }
    });
    auth.cache.clear();
    // Der ausführende Nutzer darf sich nicht selbst aussperren (außer Systemadmins).
    if (!this.s.perms.canSpace(auth, space, 'admin')) {
      this.s.db.transaction(() => {
        this.s.db.run('DELETE FROM space_permissions WHERE space_id = ?', space.id);
        for (const g of before) {
          this.s.db.run(
            'INSERT INTO space_permissions (space_id, subject_type, subject_id, role) VALUES (?, ?, ?, ?)',
            space.id,
            g.subjectType,
            g.subjectId,
            g.role,
          );
        }
      });
      auth.cache.clear();
      throw badRequest('Mit dieser Änderung würdest du dir selbst die Verwaltungsrechte entziehen');
    }
    const after = this.grantsOf(space.id);
    this.s.emit(auth, {
      type: 'space.permissions_changed',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
      data: {
        before: before.map((g) => `${g.label}: ${g.role}`),
        after: after.map((g) => `${g.label}: ${g.role}`),
      },
    });
    return after;
  }

  /**
   * Benutzer, die im Bereich moderieren dürfen (Bereichsadministratoren,
   * Eigentümer und globale Administratoren) – Empfänger für Prüfaufträge.
   */
  moderatorIds(space: SpaceRow): number[] {
    const ids = new Set<number>();
    if (space.owner_id) ids.add(space.owner_id);
    for (const g of this.grantsOf(space.id)) {
      if (g.role !== 'admin') continue;
      if (g.subjectType === 'user') ids.add(g.subjectId);
      if (g.subjectType === 'group') for (const m of this.s.groups.members(g.subjectId)) ids.add(m.id);
    }
    for (const row of this.s.db.all<{ id: number }>(
      `SELECT DISTINCT u.id FROM users u
         JOIN group_members m ON m.user_id = u.id
         JOIN groups g ON g.id = m.group_id
        WHERE u.status = 'active' AND u.kind = 'user' AND g.permissions LIKE '%"admin"%'`,
    )) {
      ids.add(row.id);
    }
    return [...ids];
  }

  /** Mitglieder mit ihrer effektiven Rolle (für die Übersicht in den Bereichseinstellungen). */
  members(auth: AuthContext, key: string): { user: ReturnType<Services['users']['ref']>; role: SpaceRole; via: string[] }[] {
    const space = this.requireByKey(key);
    this.s.perms.requireSpace(auth, space, 'admin');
    const grants = this.grantsOf(space.id);
    const result = new Map<number, { role: SpaceRole; via: string[] }>();
    const add = (userId: number, role: SpaceRole, via: string) => {
      const current = result.get(userId);
      if (!current) result.set(userId, { role, via: [via] });
      else {
        if (ROLE_RANK[role] > ROLE_RANK[current.role]) current.role = role;
        current.via.push(via);
      }
    };
    for (const g of grants) {
      if (g.subjectType === 'user') add(g.subjectId, g.role, 'direkt');
      if (g.subjectType === 'group') {
        for (const m of this.s.groups.members(g.subjectId)) add(m.id, g.role, `Gruppe ${g.label}`);
      }
    }
    const refs = this.s.users.refs(result.keys());
    return [...result.entries()]
      .filter(([id]) => refs.has(id))
      .map(([id, v]) => ({ user: refs.get(id)!, role: v.role, via: v.via }))
      .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.user.displayName.localeCompare(b.user.displayName));
  }

  /* ------------------------------ Persönlicher Bereich ------------------------------ */

  async personalSpace(auth: AuthContext, create = true): Promise<SpaceRow | null> {
    const user = this.s.perms.requireUser(auth);
    const existing = this.s.db.get<SpaceRow>("SELECT * FROM spaces WHERE kind = 'personal' AND owner_id = ? ORDER BY id LIMIT 1", user.id);
    if (existing || !create) return existing ?? null;
    if (!this.s.settings.get('personalSpaces')) throw forbidden('Persönliche Bereiche sind deaktiviert');
    const row = this.s.users.require(user.id) as UserRow;
    let key = `~${row.username}`.toUpperCase().replace(/[^~A-Z0-9_]/g, '_').slice(0, 30);
    let n = 1;
    while (this.byKey(key)) key = `${key.slice(0, 26)}_${++n}`;
    const space = this.insert({
      key,
      name: (auth.locale ?? this.s.settings.get('defaultLocale')) === 'en' ? `${row.display_name} (personal)` : `${row.display_name} (persönlich)`,
      description:
        (auth.locale ?? this.s.settings.get('defaultLocale')) === 'en'
          ? 'Personal space for notes, drafts and the journal.'
          : 'Persönlicher Bereich für Notizen, Entwürfe und das Journal.',
      icon: '👤',
      color: row.avatar_color,
      kind: 'personal',
      ownerId: user.id,
      createdBy: user.id,
    });
    auth.cache.clear();
    await this.createHomePage(
      auth,
      space,
      `<h2>Mein persönlicher Bereich</h2><p>Hier ist Platz für eigene Notizen, Entwürfe und dein <strong>Journal</strong>. Nur du hast Zugriff – außer du gibst den Bereich in den Einstellungen frei.</p><div data-type="children" data-depth="2" data-scope="space"></div>`,
    );
    this.s.emit(auth, { type: 'space.created', spaceId: space.id, target: { type: 'space', id: space.id, label: space.name }, data: { personal: true } });
    return this.require(space.id);
  }
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
