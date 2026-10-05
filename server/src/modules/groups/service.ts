import type { Services } from '../../services.ts';
import type { GroupRow, UserRef, UserRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { GLOBAL_PERMISSIONS } from '../../core/permissions.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.ts';

/** Zugeordnete Verzeichnisgruppen werden zeilenweise (oder mit „;“) gespeichert. */
export function splitDirectoryGroups(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[\r\n;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function joinDirectoryGroups(values: string[]): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, 50).join('\n');
}

export interface GroupDto {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  isDefault: boolean;
  memberCount: number;
  createdAt: string;
  /** Zugeordnete AD-/LDAP-Sicherheitsgruppen (eine je Zeile) */
  directoryGroups: string[];
  syncEnabled: boolean;
}

/** Interne Schlüssel, unter denen die IDs der Systemgruppen gespeichert sind. */
export const SYSTEM_GROUP_KEYS = { admin: 'groups:adminId', users: 'groups:usersId' } as const;

export class GroupService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  get(id: number): GroupRow | undefined {
    return this.s.db.get<GroupRow>('SELECT * FROM groups WHERE id = ?', id);
  }

  require(id: number): GroupRow {
    const g = this.get(id);
    if (!g) throw notFound('Gruppe nicht gefunden');
    return g;
  }

  /**
   * Eine der beiden Systemgruppen – über die beim Anlegen gemerkte ID, denn ihr Name hängt von der Sprache
   * der Einrichtung ab („Administratoren“ bzw. „Administrators“).
   */
  systemGroup(kind: 'admin' | 'users'): GroupRow | undefined {
    const id = this.s.settings.getInternal<number>(SYSTEM_GROUP_KEYS[kind], 0);
    return id ? this.get(id) : undefined;
  }

  byName(name: string): GroupRow | undefined {
    return this.s.db.get<GroupRow>('SELECT * FROM groups WHERE name = ?', name);
  }

  toDto(row: GroupRow & { member_count?: number }): GroupDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      permissions: parseJson<string[]>(row.permissions, []),
      isSystem: !!row.is_system,
      isDefault: !!row.is_default,
      memberCount: row.member_count ?? (this.s.db.value<number>('SELECT COUNT(*) FROM group_members WHERE group_id = ?', row.id) ?? 0),
      createdAt: row.created_at,
      directoryGroups: splitDirectoryGroups(row.directory_groups),
      syncEnabled: !!row.sync_enabled,
    };
  }

  list(q?: string): GroupDto[] {
    const rows = this.s.db.all<GroupRow & { member_count: number }>(
      `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
       FROM groups g ${q ? 'WHERE g.name LIKE ?' : ''} ORDER BY g.is_system DESC, g.name COLLATE NOCASE`,
      ...(q ? [`%${q}%`] : []),
    );
    return rows.map((r) => this.toDto(r));
  }

  members(groupId: number): UserRef[] {
    return this.s.db
      .all<UserRow>(
        `SELECT u.id, u.username, u.display_name, u.avatar_color FROM users u
         JOIN group_members m ON m.user_id = u.id WHERE m.group_id = ? ORDER BY u.display_name COLLATE NOCASE`,
        groupId,
      )
      .map((u) => this.s.users.ref(u));
  }

  private validatePermissions(perms: string[], auth: AuthContext): string[] {
    const clean = [...new Set(perms)].filter((p) => p in GLOBAL_PERMISSIONS);
    if (clean.includes('admin') && !auth.isAdmin) throw forbidden('Nur Administratoren dürfen Administratorrechte vergeben');
    return clean;
  }

  private cleanDirectoryGroups(value: string[] | undefined): string | null {
    if (value === undefined) return null;
    return joinDirectoryGroups(value);
  }

  create(
    input: { name: string; description?: string; permissions?: string[]; isDefault?: boolean; directoryGroups?: string[]; syncEnabled?: boolean },
    auth: AuthContext,
  ): GroupDto {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) throw badRequest('Der Gruppenname muss 2–60 Zeichen lang sein');
    if (this.byName(name)) throw conflict('Eine Gruppe mit diesem Namen existiert bereits');
    const perms = this.validatePermissions(input.permissions ?? [], auth);
    const now = nowIso();
    const res = this.s.db.run(
      `INSERT INTO groups (name, description, permissions, is_default, created_at, updated_at, directory_groups, sync_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      name,
      input.description ?? '',
      JSON.stringify(perms),
      input.isDefault ? 1 : 0,
      now,
      now,
      this.cleanDirectoryGroups(input.directoryGroups) ?? '',
      input.syncEnabled === false ? 0 : 1,
    );
    this.s.emit(auth, { type: 'group.created', target: { type: 'group', id: res.lastInsertRowid, label: name }, data: { permissions: perms } });
    return this.toDto(this.require(res.lastInsertRowid));
  }

  update(
    id: number,
    input: { name?: string; description?: string; permissions?: string[]; isDefault?: boolean; directoryGroups?: string[]; syncEnabled?: boolean },
    auth: AuthContext,
  ): GroupDto {
    const row = this.require(id);
    const name = input.name?.trim() ?? row.name;
    if (name !== row.name) {
      if (row.is_system) throw badRequest('Systemgruppen können nicht umbenannt werden');
      if (name.length < 2 || name.length > 60) throw badRequest('Der Gruppenname muss 2–60 Zeichen lang sein');
      const other = this.byName(name);
      if (other && other.id !== id) throw conflict('Eine Gruppe mit diesem Namen existiert bereits');
    }
    const before = parseJson<string[]>(row.permissions, []);
    let perms = before;
    if (input.permissions) {
      perms = this.validatePermissions(input.permissions, auth);
      if (before.includes('admin') !== perms.includes('admin') && !auth.isAdmin) {
        throw forbidden('Nur Administratoren dürfen Administratorrechte ändern');
      }
    }
    this.s.db.transaction(() => {
      this.s.db.run(
        `UPDATE groups SET name = ?, description = ?, permissions = ?, is_default = ?, updated_at = ?,
                           directory_groups = ?, sync_enabled = ? WHERE id = ?`,
        name,
        input.description ?? row.description,
        JSON.stringify(perms),
        input.isDefault === undefined ? row.is_default : input.isDefault ? 1 : 0,
        nowIso(),
        this.cleanDirectoryGroups(input.directoryGroups) ?? row.directory_groups,
        input.syncEnabled === undefined ? row.sync_enabled : input.syncEnabled ? 1 : 0,
        id,
      );
      if (before.includes('admin') && !perms.includes('admin') && this.s.users.countActiveAdmins() === 0) {
        throw badRequest('Es muss mindestens ein aktiver Administrator verbleiben');
      }
    });
    this.s.emit(auth, {
      type: 'group.updated',
      target: { type: 'group', id, label: name },
      data: { permissionsBefore: before, permissionsAfter: perms, renamed: name !== row.name ? row.name : undefined },
    });
    return this.toDto(this.require(id));
  }

  delete(id: number, auth: AuthContext): void {
    const row = this.require(id);
    if (row.is_system) throw badRequest('Systemgruppen können nicht gelöscht werden');
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM groups WHERE id = ?', id);
      this.s.db.run("DELETE FROM space_permissions WHERE subject_type = 'group' AND subject_id = ?", id);
      this.s.db.run("DELETE FROM page_restrictions WHERE subject_type = 'group' AND subject_id = ?", id);
      if (this.s.users.countActiveAdmins() === 0) throw badRequest('Es muss mindestens ein aktiver Administrator verbleiben');
    });
    this.s.perms.invalidateRestrictions();
    this.s.emit(auth, { type: 'group.deleted', target: { type: 'group', id, label: row.name } });
  }

  setMembers(id: number, userIds: number[], auth: AuthContext): UserRef[] {
    const row = this.require(id);
    const perms = parseJson<string[]>(row.permissions, []);
    if (perms.includes('admin') && !auth.isAdmin) throw forbidden('Nur Administratoren dürfen die Administratorgruppe ändern');
    const before = this.members(id).map((m) => m.id);
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM group_members WHERE group_id = ?', id);
      for (const uid of new Set(userIds)) {
        this.s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', id, uid, nowIso());
      }
      if (perms.includes('admin') && this.s.users.countActiveAdmins() === 0) {
        throw badRequest('Es muss mindestens ein aktiver Administrator verbleiben');
      }
    });
    const after = this.members(id).map((m) => m.id);
    this.s.emit(auth, {
      type: 'group.members_changed',
      target: { type: 'group', id, label: row.name },
      data: { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) },
    });
    return this.members(id);
  }
}
