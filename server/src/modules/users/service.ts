import type { Services } from '../../services.ts';
import type { UserRef, UserRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db, nowIso, parseJson } from '../../db/database.ts';
import { hashPassword } from '../../core/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.ts';
import { colorFor, isValidEmail } from '../../core/util.ts';

export /** Schlüssel, die niemals in gespeicherte Objekte gelangen dürfen. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,39}$/;

export interface UserDto {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  kind: 'user' | 'bot';
  status: 'active' | 'disabled';
  avatarColor: string | null;
  bio: string;
  createdAt: string;
  lastLoginAt: string | null;
  groups?: { id: number; name: string }[];
  isAdmin?: boolean;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  email?: string | null;
  password?: string | null;
  kind?: 'user' | 'bot';
  status?: 'active' | 'disabled';
  groupIds?: number[];
  skipDefaultGroups?: boolean;
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string | null;
  bio?: string;
  avatarColor?: string | null;
  groupIds?: number[];
}

export class UserService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  get(id: number): UserRow | undefined {
    return this.s.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  require(id: number): UserRow {
    const row = this.get(id);
    if (!row) throw notFound('Benutzer nicht gefunden');
    return row;
  }

  byUsername(username: string): UserRow | undefined {
    return this.s.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
  }

  byLogin(login: string): UserRow | undefined {
    return this.s.db.get<UserRow>('SELECT * FROM users WHERE username = ? OR email = ?', login, login);
  }

  ref(row: Pick<UserRow, 'id' | 'username' | 'display_name' | 'avatar_color'>): UserRef {
    return { id: row.id, username: row.username, displayName: row.display_name, avatarColor: row.avatar_color };
  }

  /** Lädt mehrere Benutzer-Referenzen auf einmal. */
  refs(ids: Iterable<number | null | undefined>): Map<number, UserRef> {
    const list = [...new Set([...ids].filter((id): id is number => typeof id === 'number'))];
    const map = new Map<number, UserRef>();
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const rows = this.s.db.all<UserRow>(
        `SELECT id, username, display_name, avatar_color FROM users WHERE id IN ${Db.placeholders(chunk.length)}`,
        ...chunk,
      );
      for (const r of rows) map.set(r.id, this.ref(r));
    }
    return map;
  }

  refOf(id: number | null | undefined): UserRef | null {
    if (!id) return null;
    return this.refs([id]).get(id) ?? null;
  }

  groupsOf(userId: number): { id: number; name: string }[] {
    return this.s.db.all<{ id: number; name: string }>(
      'SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name',
      userId,
    );
  }

  isAdmin(userId: number): boolean {
    const rows = this.s.db.all<{ permissions: string }>(
      'SELECT g.permissions FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?',
      userId,
    );
    return rows.some((r) => parseJson<string[]>(r.permissions, []).includes('admin'));
  }

  toDto(row: UserRow, options: { includeGroups?: boolean; includeEmail?: boolean } = {}): UserDto {
    const dto: UserDto = {
      id: row.id,
      username: row.username,
      email: options.includeEmail === false ? null : row.email,
      displayName: row.display_name,
      kind: row.kind,
      status: row.status,
      avatarColor: row.avatar_color,
      bio: row.bio,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    };
    if (options.includeGroups) {
      dto.groups = this.groupsOf(row.id);
      dto.isAdmin = this.isAdmin(row.id);
    }
    return dto;
  }

  list(filter: { q?: string; status?: string; kind?: string; groupId?: number; limit?: number; offset?: number }) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.q) {
      where.push('(u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)');
      const like = `%${filter.q}%`;
      params.push(like, like, like);
    }
    if (filter.status) {
      where.push('u.status = ?');
      params.push(filter.status);
    }
    if (filter.kind) {
      where.push('u.kind = ?');
      params.push(filter.kind);
    }
    if (filter.groupId) {
      where.push('EXISTS (SELECT 1 FROM group_members m WHERE m.user_id = u.id AND m.group_id = ?)');
      params.push(filter.groupId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const total = this.s.db.value<number>(`SELECT COUNT(*) FROM users u ${whereSql}`, ...params) ?? 0;
    const rows = this.s.db.all<UserRow>(
      `SELECT u.* FROM users u ${whereSql} ORDER BY u.display_name COLLATE NOCASE LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    return { items: rows.map((r) => this.toDto(r, { includeGroups: true })), total, limit, offset };
  }

  /**
   * Schnellsuche für Erwähnungen und Auswahlfelder (nur aktive Benutzer). Ohne Suchtext kommen die ersten
   * nach Namen. `first` nennt Personen, die vorn stehen sollen (Beteiligte einer Aufgabe oder Seite) –
   * sofern sie zum Suchtext passen.
   */
  search(q: string, limit = 10, first: number[] = []): UserRef[] {
    const needle = q.trim();
    const fold = (text: string) => text.toLocaleLowerCase('de-DE');
    const folded = fold(needle);
    const columns = 'id, username, display_name, avatar_color';
    const startsWith = (r: UserRow) => (folded && (fold(r.display_name).startsWith(folded) || fold(r.username).startsWith(folded)) ? 0 : 1);
    // Reihenfolge für die Anzeige: Treffer am Namensanfang zuerst, dann nach deutschem Alphabet („Özlem“ bei O, nicht hinter Z)
    const forDisplay = (a: UserRow, b: UserRow) => startsWith(a) - startsWith(b) || a.display_name.localeCompare(b.display_name, 'de', { sensitivity: 'base' });
    let rows: UserRow[];
    let boosted: UserRow[] = [];
    // Druckbare ASCII-Zeichen (Leerzeichen bis Tilde) vergleicht SQLite ohne Rücksicht auf Groß- und Kleinschreibung
    if (!needle || /^[ -~]+$/.test(needle)) {
      // „!“ als Maskierzeichen: Prozent und Unterstrich im Suchtext sind Text, keine Platzhalter
      const escaped = needle.replace(/[!%_]/g, '!$&');
      const where = needle ? `status = 'active' AND (username LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!')` : `status = 'active'`;
      const params = needle ? [`%${escaped}%`, `%${escaped}%`] : [];
      // Treffer am Wortanfang zuerst, dann nach Namen – sortiert und begrenzt die Datenbank (auch bei vielen Konten schnell)
      const order = needle
        ? `CASE WHEN username LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!' THEN 0 ELSE 1 END, display_name COLLATE NOCASE`
        : 'display_name COLLATE NOCASE';
      const orderParams = needle ? [`${escaped}%`, `${escaped}%`] : [];
      rows = this.s.db.all<UserRow>(`SELECT ${columns} FROM users WHERE ${where} ORDER BY ${order} LIMIT ?`, ...params, ...orderParams, limit).sort(forDisplay);
      // Beteiligte gehören auch dann nach vorn, wenn sie alphabetisch weit hinten stehen
      if (first.length) {
        boosted = this.s.db.all<UserRow>(`SELECT ${columns} FROM users WHERE ${where} AND id IN ${Db.placeholders(first.length)}`, ...params, ...first);
      }
    } else {
      // Umlaute und andere Sonderzeichen: SQLite fände mit „öz“ kein „Özlem“ – deshalb hier vergleichen
      const all = this.s.db
        .all<UserRow>(`SELECT ${columns} FROM users WHERE status = 'active'`)
        .filter((r) => fold(r.display_name).includes(folded) || fold(r.username).includes(folded))
        .sort(forDisplay);
      boosted = all.filter((r) => first.includes(r.id));
      rows = all.slice(0, limit);
    }
    boosted.sort((a, b) => first.indexOf(a.id) - first.indexOf(b.id));
    const seen = new Set(boosted.map((r) => r.id));
    return [...boosted, ...rows.filter((r) => !seen.has(r.id))].slice(0, limit).map((r) => this.ref(r));
  }

  validatePassword(password: string): void {
    const min = this.s.settings.get('passwordMinLength');
    if (password.length < min) throw badRequest(`Das Passwort muss mindestens ${min} Zeichen lang sein`);
    if (password.length > 200) throw badRequest('Das Passwort ist zu lang');
  }

  private validateIdentity(username: string, email: string | null | undefined, excludeId?: number): void {
    if (!USERNAME_RE.test(username)) {
      throw badRequest('Der Benutzername darf nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich enthalten (2–40 Zeichen)');
    }
    const existing = this.byUsername(username);
    if (existing && existing.id !== excludeId) throw conflict('Dieser Benutzername ist bereits vergeben');
    if (email) {
      if (!isValidEmail(email)) throw badRequest('Ungültige E-Mail-Adresse');
      const byMail = this.s.db.get<UserRow>('SELECT id FROM users WHERE email = ?', email);
      if (byMail && byMail.id !== excludeId) throw conflict('Diese E-Mail-Adresse wird bereits verwendet');
    }
  }

  create(input: CreateUserInput, auth?: AuthContext): UserRow {
    const username = input.username.trim();
    const email = input.email?.trim() || null;
    const displayName = input.displayName.trim() || username;
    this.validateIdentity(username, email);
    if (input.password) this.validatePassword(input.password);
    const now = nowIso();
    const id = this.s.db.transaction(() => {
      const res = this.s.db.run(
        `INSERT INTO users (username, email, display_name, password_hash, kind, status, avatar_color, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        username,
        email,
        displayName,
        input.password ? hashPassword(input.password) : null,
        input.kind ?? 'user',
        input.status ?? 'active',
        colorFor(username),
        now,
        now,
        input.password ? now : null,
      );
      const userId = res.lastInsertRowid;
      const groupIds = new Set(input.groupIds ?? []);
      if (!input.skipDefaultGroups) {
        for (const g of this.s.db.all<{ id: number }>('SELECT id FROM groups WHERE is_default = 1')) groupIds.add(g.id);
      }
      for (const gid of groupIds) {
        this.s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', gid, userId, now);
      }
      return userId;
    });
    const row = this.require(id);
    if (auth) {
      this.s.emit(auth, {
        type: 'user.created',
        target: { type: 'user', id: row.id, label: row.username },
        data: { kind: row.kind, groups: input.groupIds ?? [] },
      });
    }
    return row;
  }

  update(id: number, input: UpdateUserInput, auth: AuthContext): UserRow {
    const row = this.require(id);
    const email = input.email === undefined ? row.email : input.email?.trim() || null;
    this.validateIdentity(row.username, email, id);
    const changes: Record<string, unknown> = {};
    this.s.db.transaction(() => {
      this.s.db.run(
        'UPDATE users SET display_name = ?, email = ?, bio = ?, avatar_color = ?, updated_at = ? WHERE id = ?',
        input.displayName?.trim() || row.display_name,
        email,
        input.bio ?? row.bio,
        input.avatarColor === undefined ? row.avatar_color : input.avatarColor,
        nowIso(),
        id,
      );
      if (input.displayName !== undefined && input.displayName !== row.display_name) changes.displayName = input.displayName;
      if (email !== row.email) changes.email = email;
      if (input.groupIds) {
        this.s.perms.requireGlobal(auth, 'users.manage');
        const before = this.groupsOf(id).map((g) => g.id);
        const wasAdmin = this.isAdmin(id);
        this.s.db.run('DELETE FROM group_members WHERE user_id = ?', id);
        for (const gid of new Set(input.groupIds)) {
          this.s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', gid, id, nowIso());
        }
        if (wasAdmin && !this.isAdmin(id) && this.countActiveAdmins() === 0) {
          throw badRequest('Es muss mindestens ein aktiver Administrator verbleiben');
        }
        if (wasAdmin !== this.isAdmin(id) && !auth.isAdmin) {
          throw forbidden('Nur Administratoren dürfen Administratorrechte vergeben oder entziehen');
        }
        const after = [...new Set(input.groupIds)];
        if (before.sort().join() !== after.sort().join()) changes.groups = { before, after };
      }
    });
    if (Object.keys(changes).length) {
      this.s.emit(auth, { type: 'user.updated', target: { type: 'user', id, label: row.username }, data: changes });
    }
    return this.require(id);
  }

  /**
   * Administratorkonten ändern (Name, E-Mail, Status, Löschen, Tokens) dürfen nur Administratoren –
   * sonst könnte „Benutzer verwalten“ z. B. die E-Mail eines Admins umstellen und das Konto über
   * „Passwort vergessen“ übernehmen.
   */
  requireManageable(auth: AuthContext, id: number): void {
    if (auth.via === 'system' || auth.isAdmin) return;
    if (this.isAdmin(id)) throw forbidden('Administratorkonten dürfen nur Administratoren ändern');
  }

  setPassword(id: number, password: string): void {
    this.validatePassword(password);
    this.s.db.run(
      'UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      hashPassword(password),
      nowIso(),
      nowIso(),
      id,
    );
  }

  setStatus(id: number, status: 'active' | 'disabled', auth: AuthContext): void {
    const row = this.require(id);
    if (row.status === status) return;
    if (status === 'disabled') {
      if (auth.user?.id === id) throw badRequest('Du kannst dich nicht selbst deaktivieren');
      if (this.isAdmin(id) && this.countActiveAdmins() <= 1) {
        throw badRequest('Der letzte aktive Administrator kann nicht deaktiviert werden');
      }
    }
    this.s.db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
    if (status === 'disabled') {
      this.s.db.run('DELETE FROM sessions WHERE user_id = ?', id);
    }
    this.s.emit(auth, {
      type: status === 'disabled' ? 'user.disabled' : 'user.enabled',
      target: { type: 'user', id, label: row.username },
    });
  }

  delete(id: number, auth: AuthContext): void {
    const row = this.require(id);
    if (auth.user?.id === id) throw badRequest('Du kannst dein eigenes Konto nicht löschen');
    if (this.isAdmin(id) && this.countActiveAdmins() <= 1) throw badRequest('Der letzte Administrator kann nicht gelöscht werden');
    this.s.db.transaction(() => {
      // Persönlichen Bereich an den ausführenden Administrator übergeben.
      this.s.db.run("UPDATE spaces SET owner_id = ? WHERE owner_id = ? AND kind = 'personal'", auth.user?.id ?? null, id);
      this.s.db.run('DELETE FROM users WHERE id = ?', id);
    });
    this.s.emit(auth, { type: 'user.deleted', target: { type: 'user', id, label: row.username } });
  }

  updatePreferences(id: number, patch: Record<string, unknown>): Record<string, unknown> {
    const row = this.require(id);
    const prefs = { ...parseJson<Record<string, unknown>>(row.preferences, {}) };
    for (const [key, value] of Object.entries(patch)) {
      // Schlüssel, die Objekt-Interna betreffen, nie übernehmen.
      if (DANGEROUS_KEYS.has(key) || key.length > 60) continue;
      if (value === null || value === undefined) delete prefs[key];
      else prefs[key] = value;
    }
    for (const key of Object.keys(prefs)) if (DANGEROUS_KEYS.has(key)) delete prefs[key];
    const json = JSON.stringify(prefs);
    // Einstellungen sind keine Datenablage: Größe begrenzen.
    if (Buffer.byteLength(json) > 32_000 || Object.keys(prefs).length > 120) {
      throw badRequest('Die persönlichen Einstellungen sind zu umfangreich');
    }
    this.s.db.run('UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?', json, nowIso(), id);
    return prefs;
  }

  preferences(id: number): Record<string, unknown> {
    const row = this.get(id);
    return row ? parseJson<Record<string, unknown>>(row.preferences, {}) : {};
  }

  countActiveAdmins(): number {
    const groups = this.s.db
      .all<{ id: number; permissions: string }>('SELECT id, permissions FROM groups')
      .filter((g) => parseJson<string[]>(g.permissions, []).includes('admin'))
      .map((g) => g.id);
    if (!groups.length) return 0;
    return (
      this.s.db.value<number>(
        `SELECT COUNT(DISTINCT u.id) FROM users u JOIN group_members m ON m.user_id = u.id
         WHERE u.status = 'active' AND m.group_id IN ${Db.placeholders(groups.length)}`,
        ...groups,
      ) ?? 0
    );
  }

  count(): number {
    return this.s.db.value<number>('SELECT COUNT(*) FROM users') ?? 0;
  }
}
