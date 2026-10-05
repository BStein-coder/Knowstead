import type { Services } from '../../services.ts';
import type { ApiTokenRow, UserRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { randomToken, sha256 } from '../../core/crypto.ts';
import { LEGACY_TOKEN_PREFIX } from '../../core/legacy.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';

/** Kennung am Anfang jedes API-Tokens – daran erkennen es auch Werkzeuge, die nach versehentlich veröffentlichten Geheimnissen suchen */
const TOKEN_PREFIX = 'knowstead_';

export const TOKEN_SCOPES = {
  read: 'Lesen (GET-Anfragen)',
  write: 'Schreiben (Seiten, Kommentare, Anhänge …)',
  admin: 'Verwaltung (/api/v1/admin/*, nur für Administratoren)',
} as const;

export type TokenScope = keyof typeof TOKEN_SCOPES;

export interface TokenDto {
  id: number;
  userId: number;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
  user?: { id: number; username: string; displayName: string };
}

export class TokenService {
  private readonly s: Services;
  private readonly touched = new Map<number, number>();

  constructor(s: Services) {
    this.s = s;
  }

  private toDto(row: ApiTokenRow & { username?: string; display_name?: string }): TokenDto {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      prefix: row.prefix,
      scopes: parseJson<string[]>(row.scopes, []),
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      lastUsedIp: row.last_used_ip,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      user: row.username ? { id: row.user_id, username: row.username, displayName: row.display_name ?? row.username } : undefined,
    };
  }

  create(
    auth: AuthContext,
    input: { name: string; scopes: string[]; expiresInDays?: number | null; userId?: number },
  ): { token: string; info: TokenDto } {
    const actor = this.s.perms.requireUser(auth);
    const targetUserId = input.userId ?? actor.id;
    if (targetUserId !== actor.id) {
      // Tokens für Dienstkonten (Bots) dürfen nur Benutzerverwalter erzeugen.
      this.s.perms.requireGlobal(auth, 'users.manage');
      const target = this.s.users.require(targetUserId);
      if (target.kind !== 'bot') throw badRequest('Tokens für andere Konten sind nur für Dienstkonten möglich');
      this.s.users.requireManageable(auth, targetUserId);
    } else if (!this.s.perms.hasGlobal(auth, 'api.tokens')) {
      throw forbidden('Du darfst keine API-Tokens erstellen');
    }
    if (auth.via === 'token') throw forbidden('Tokens können nicht mit einem Token erzeugt werden');
    const name = input.name.trim();
    if (!name) throw badRequest('Bitte einen Namen angeben');
    const scopes = [...new Set(input.scopes)].filter((sc): sc is TokenScope => sc in TOKEN_SCOPES);
    if (!scopes.length) throw badRequest('Mindestens ein Berechtigungsumfang ist erforderlich');
    if (scopes.includes('admin') && !this.s.users.isAdmin(targetUserId)) {
      throw forbidden('Der Umfang „admin“ ist nur für Administratoren verfügbar');
    }
    const token = `${TOKEN_PREFIX}${randomToken(30)}`;
    const now = new Date();
    const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86400000).toISOString() : null;
    const res = this.s.db.run(
      `INSERT INTO api_tokens (user_id, name, token_hash, prefix, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      targetUserId,
      name,
      sha256(token),
      // Anfang zum Wiedererkennen in der Liste: Kennung und sieben Zeichen des Tokens
      token.slice(0, TOKEN_PREFIX.length + 7),
      JSON.stringify(scopes),
      expiresAt,
      now.toISOString(),
    );
    this.s.emit(auth, {
      type: 'token.created',
      target: { type: 'token', id: res.lastInsertRowid, label: name },
      data: { scopes, userId: targetUserId, expiresAt },
    });
    const row = this.s.db.get<ApiTokenRow>('SELECT * FROM api_tokens WHERE id = ?', res.lastInsertRowid)!;
    return { token, info: this.toDto(row) };
  }

  listForUser(userId: number): TokenDto[] {
    return this.s.db
      .all<ApiTokenRow>('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC', userId)
      .map((r) => this.toDto(r));
  }

  listAll(): TokenDto[] {
    return this.s.db
      .all<ApiTokenRow & { username: string; display_name: string }>(
        `SELECT t.*, u.username, u.display_name FROM api_tokens t JOIN users u ON u.id = t.user_id
         ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC`,
      )
      .map((r) => this.toDto(r));
  }

  revoke(auth: AuthContext, id: number): void {
    const user = this.s.perms.requireUser(auth);
    const row = this.s.db.get<ApiTokenRow>('SELECT * FROM api_tokens WHERE id = ?', id);
    if (!row) throw notFound('Token nicht gefunden');
    if (row.user_id !== user.id) this.s.perms.requireGlobal(auth, 'users.manage');
    if (row.revoked_at) return;
    this.s.db.run('UPDATE api_tokens SET revoked_at = ? WHERE id = ?', nowIso(), id);
    this.s.emit(auth, { type: 'token.revoked', target: { type: 'token', id, label: row.name }, data: { userId: row.user_id } });
  }

  /** Prüft ein Token und liefert Token und Benutzer, falls gültig. */
  verify(token: string, ip: string | null): { row: ApiTokenRow; user: UserRow; scopes: string[] } | null {
    // Tokens aus der Zeit vor der Umbenennung beginnen mit „doku_“ und gelten weiter
    if (!token.startsWith(TOKEN_PREFIX) && !token.startsWith(LEGACY_TOKEN_PREFIX)) return null;
    const row = this.s.db.get<ApiTokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?', sha256(token));
    if (!row || row.revoked_at) return null;
    if (row.expires_at && row.expires_at < nowIso()) return null;
    const user = this.s.users.get(row.user_id);
    if (!user || user.status !== 'active') return null;
    const last = this.touched.get(row.id) ?? 0;
    if (Date.now() - last > 60_000) {
      this.touched.set(row.id, Date.now());
      this.s.db.run('UPDATE api_tokens SET last_used_at = ?, last_used_ip = ? WHERE id = ?', nowIso(), ip, row.id);
    }
    return { row, user, scopes: parseJson<string[]>(row.scopes, []) };
  }
}
