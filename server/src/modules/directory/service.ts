/**
 * Verzeichnisanmeldung gegen Active Directory bzw. einen LDAP-Server.
 *
 * Ablauf einer Anmeldung:
 *  1. Mit dem Dienstkonto anmelden (oder anonym, wenn keins hinterlegt ist).
 *  2. Den Benutzer über den konfigurierten Filter suchen.
 *  3. Mit dem gefundenen DN und dem eingegebenen Passwort erneut anmelden
 *     („Bind“) – das ist die eigentliche Passwortprüfung.
 *  4. Sicherheitsgruppen lesen und auf Knowstead-Gruppen abbilden.
 *
 * Es werden nie Passwörter aus dem Verzeichnis gespeichert; lokale Konten
 * bleiben unabhängig davon bestehen.
 */
import { Client } from 'ldapts';
import type { Entry } from 'ldapts';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { GroupRow, UserRow } from '../../core/types.ts';
import type { DirectorySettings } from '../../core/settings.ts';
import { nowIso } from '../../db/database.ts';
import { decryptSecret } from '../../core/crypto.ts';
import { badRequest, unauthorized } from '../../core/errors.ts';
import { colorFor } from '../../core/util.ts';
import { nextRowId } from '../../core/subjects.ts';

export interface DirectoryProfile {
  dn: string;
  username: string;
  displayName: string;
  email: string | null;
  externalId: string | null;
  /** Alle gefundenen Gruppenkennungen: DN, CN und schlichter Name. */
  groups: string[];
}

export interface DirectoryTestStep {
  label: string;
  ok: boolean;
  detail: string;
}

const USERNAME_SAFE = /[^a-zA-Z0-9._-]/g;

/** RFC 4515: Sonderzeichen in Suchfiltern maskieren. */
function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0/]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/**
 * Suchfilter für einen Anmeldenamen. Der Name wird per Funktion eingesetzt: Als Ersatztext würde JavaScript
 * Folgen wie `$'` oder `$&` auswerten und Teile des Filters in den Filter kopieren.
 */
export function userFilterFor(d: DirectorySettings, login: string): string {
  const escaped = escapeFilter(login);
  return (d.userFilter || '(&(objectClass=user)(sAMAccountName={login}))').replaceAll('{login}', () => escaped);
}

/** CN aus einem DN lesen: „CN=Redaktion,OU=Gruppen,DC=…“ → „Redaktion“. */
function cnOf(dn: string): string {
  const match = /^\s*CN=([^,]+)/i.exec(dn);
  return match ? match[1].replace(/\\,/g, ',').trim() : dn.trim();
}

function attr(entry: Entry, name: string): string {
  const value = entry[name] as unknown;
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.length ? String(value[0]) : '';
  if (Buffer.isBuffer(value)) return value.toString('hex');
  return String(value);
}

function attrList(entry: Entry, name: string): string[] {
  const value = entry[name] as unknown;
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => (Buffer.isBuffer(v) ? v.toString('hex') : String(v)));
}

export class DirectoryService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  settings(): DirectorySettings {
    return this.s.settings.get('directory');
  }

  isEnabled(): boolean {
    const d = this.settings();
    return d.enabled && !!d.url && !!d.baseDn;
  }

  /** Passwort des Dienstkontos entschlüsseln. */
  private bindPassword(): string {
    return decryptSecret(this.s.config.secret, this.settings().bindPassword) ?? '';
  }

  private async connect(d: DirectorySettings): Promise<Client> {
    const client = new Client({
      url: d.url,
      timeout: 10_000,
      connectTimeout: 8_000,
      tlsOptions: { rejectUnauthorized: d.rejectUnauthorized },
    });
    if (d.startTls) await client.startTLS({ rejectUnauthorized: d.rejectUnauthorized });
    if (d.bindDn) await client.bind(d.bindDn, this.bindPassword());
    return client;
  }

  /** Anmeldenamen aufräumen: „DOMAIN\\anna“ oder „anna@example.com“ → „anna“. */
  normalizeLogin(login: string): string {
    const raw = login.trim();
    const domain = this.settings().defaultDomain.trim().toLowerCase();
    const withoutPrefix = raw.includes('\\') ? raw.slice(raw.lastIndexOf('\\') + 1) : raw;
    if (domain && withoutPrefix.toLowerCase().endsWith(`@${domain}`)) return withoutPrefix.slice(0, -(domain.length + 1));
    return withoutPrefix;
  }

  /**
   * Prüft Anmeldedaten gegen das Verzeichnis.
   * Rückgabe `null` bedeutet „nicht zuständig“ (Verzeichnis aus oder Benutzer unbekannt),
   * eine Ausnahme bedeutet „zuständig, aber abgelehnt“.
   */
  async authenticate(login: string, password: string): Promise<DirectoryProfile | null> {
    if (!this.isEnabled()) return null;
    // Leeres Passwort niemals an den Server schicken: Ein LDAP-Bind ohne
    // Passwort gilt dort als anonyme Anmeldung und würde „erfolgreich“ sein.
    if (!password) return null;
    const d = this.settings();
    const account = this.normalizeLogin(login);
    if (!account) return null;
    let client: Client | null = null;
    try {
      client = await this.connect(d);
      const filter = userFilterFor(d, account);
      const { searchEntries } = await client.search(d.baseDn, {
        scope: 'sub',
        filter,
        sizeLimit: 2,
        attributes: [d.userIdAttribute, d.nameAttribute, d.mailAttribute, d.groupAttribute, 'objectGUID', 'userAccountControl'].filter(Boolean),
      });
      if (!searchEntries.length) return null;
      // Mehrdeutiger Filter: lieber ablehnen als das falsche Konto prüfen
      if (searchEntries.length > 1) throw unauthorized('Der Anmeldename ist im Verzeichnis nicht eindeutig');
      const entry = searchEntries[0];
      const dn = String(entry.dn);

      // Deaktivierte Konten (Bit 2 in userAccountControl) gar nicht erst prüfen.
      const uac = Number(attr(entry, 'userAccountControl') || 0);
      if (uac && (uac & 2) !== 0) throw unauthorized('Dieses Verzeichniskonto ist deaktiviert');

      // Eigentliche Passwortprüfung: Anmeldung als der gefundene Benutzer.
      const userClient = new Client({
        url: d.url,
        timeout: 10_000,
        connectTimeout: 8_000,
        tlsOptions: { rejectUnauthorized: d.rejectUnauthorized },
      });
      try {
        if (d.startTls) await userClient.startTLS({ rejectUnauthorized: d.rejectUnauthorized });
        await userClient.bind(dn, password);
      } catch {
        throw unauthorized('Benutzername oder Passwort ist falsch');
      } finally {
        await userClient.unbind().catch(() => {});
      }

      const groups = await this.groupsOf(client, d, dn, entry);
      if (d.requireGroup.trim() && !this.matchesAny(groups, [d.requireGroup])) {
        throw unauthorized('Für dieses Konto fehlt die erforderliche Verzeichnisgruppe');
      }

      const username = (attr(entry, d.userIdAttribute) || account).replace(USERNAME_SAFE, '.').slice(0, 40);
      return {
        dn,
        username,
        displayName: attr(entry, d.nameAttribute) || username,
        email: attr(entry, d.mailAttribute) || null,
        externalId: attr(entry, 'objectGUID') || dn,
        groups,
      };
    } finally {
      await client?.unbind().catch(() => {});
    }
  }

  /**
   * Konto ohne Passwort nachschlagen – für die Windows-Anmeldung, bei der ein vorgeschalteter Webserver
   * das Konto bereits per Kerberos geprüft hat. Liefert Profil und Gruppen wie eine Passwortanmeldung.
   */
  async lookup(login: string): Promise<DirectoryProfile | null> {
    if (!this.isEnabled()) return null;
    const d = this.settings();
    const account = this.normalizeLogin(login);
    if (!account) return null;
    let client: Client | null = null;
    try {
      client = await this.connect(d);
      const filter = userFilterFor(d, account);
      const { searchEntries } = await client.search(d.baseDn, {
        scope: 'sub',
        filter,
        sizeLimit: 2,
        attributes: [d.userIdAttribute, d.nameAttribute, d.mailAttribute, d.groupAttribute, 'objectGUID', 'userAccountControl'].filter(Boolean),
      });
      if (!searchEntries.length) return null;
      if (searchEntries.length > 1) throw unauthorized('Der Anmeldename ist im Verzeichnis nicht eindeutig');
      const entry = searchEntries[0];
      const dn = String(entry.dn);
      const uac = Number(attr(entry, 'userAccountControl') || 0);
      if (uac && (uac & 2) !== 0) throw unauthorized('Dieses Verzeichniskonto ist deaktiviert');
      const groups = await this.groupsOf(client, d, dn, entry);
      if (d.requireGroup.trim() && !this.matchesAny(groups, [d.requireGroup])) {
        throw unauthorized('Für dieses Konto fehlt die erforderliche Verzeichnisgruppe');
      }
      const username = (attr(entry, d.userIdAttribute) || account).replace(USERNAME_SAFE, '.').slice(0, 40);
      return {
        dn,
        username,
        displayName: attr(entry, d.nameAttribute) || username,
        email: attr(entry, d.mailAttribute) || null,
        externalId: attr(entry, 'objectGUID') || dn,
        groups,
      };
    } finally {
      await client?.unbind().catch(() => {});
    }
  }

  /** Gruppen des Benutzers – direkt aus `memberOf` und optional verschachtelt. */
  private async groupsOf(client: Client, d: DirectorySettings, userDn: string, entry: Entry): Promise<string[]> {
    const found = new Set<string>();
    const add = (value: string) => {
      if (!value) return;
      found.add(value);
      found.add(cnOf(value));
    };
    for (const g of attrList(entry, d.groupAttribute || 'memberOf')) add(g);
    if (d.nestedGroups) {
      try {
        // AD-Sonderfilter: alle (auch verschachtelten) Gruppen eines Benutzers.
        const { searchEntries } = await client.search(d.baseDn, {
          scope: 'sub',
          filter: `(member:1.2.840.113556.1.4.1941:=${escapeFilter(userDn)})`,
          attributes: ['cn', 'sAMAccountName'],
          sizeLimit: 500,
        });
        for (const g of searchEntries) {
          add(String(g.dn));
          add(attr(g, 'sAMAccountName'));
        }
      } catch (err) {
        this.s.log.warn({ err }, 'Verschachtelte Gruppen konnten nicht gelesen werden');
      }
    }
    return [...found];
  }

  /** Enthält die Gruppenliste eine der Kennungen? Vergleicht ohne Groß-/Kleinschreibung, auch den CN eines DN. */
  matchesAny(groups: string[], identifiers: string[]): boolean {
    const have = new Set(groups.map((g) => g.trim().toLowerCase()));
    return identifiers.some((id) => {
      const needle = id.trim().toLowerCase();
      return !!needle && (have.has(needle) || have.has(cnOf(needle).toLowerCase()));
    });
  }

  /**
   * Legt den Benutzer an bzw. aktualisiert ihn und gleicht die
   * Gruppenmitgliedschaften mit den AD-Sicherheitsgruppen ab.
   */
  syncUser(profile: DirectoryProfile): UserRow {
    const d = this.settings();
    const now = nowIso();
    const byExternalId = this.s.db.get<UserRow>('SELECT * FROM users WHERE external_id = ? AND auth_source = ?', profile.externalId ?? '', 'ldap');
    const byName = byExternalId ? undefined : this.s.users.byUsername(profile.username);
    const existing = byExternalId ?? byName;

    // Gleicher Anmeldename, aber anderes Verzeichniskonto (z. B. wiederverwendeter sAMAccountName):
    // nicht still übernehmen – das neue Konto erbte sonst Inhalte und Rechte der früheren Person.
    if (byName && byName.auth_source === 'ldap' && byName.external_id && profile.externalId && byName.external_id !== profile.externalId) {
      throw unauthorized('Dieses Verzeichniskonto passt nicht zum vorhandenen Knowstead-Konto gleichen Namens. Bitte die Administration informieren.');
    }
    if (existing && existing.auth_source !== 'ldap') {
      if (!d.adoptLocalUsers) throw unauthorized('Für diesen Benutzernamen existiert bereits ein lokales Konto');
      // Lokale Administratorkonten nie automatisch an das Verzeichnis binden
      if (this.s.users.isAdmin(existing.id)) throw unauthorized('Lokale Administratorkonten werden nicht mit dem Verzeichnis verknüpft');
    }
    if (!existing && !d.autoCreateUsers) {
      throw unauthorized('Für dieses Verzeichniskonto ist kein Zugang eingerichtet');
    }

    // E-Mail aus dem Verzeichnis nur übernehmen, wenn kein anderes Konto sie schon nutzt (eindeutige Spalte)
    const emailOwner = profile.email ? this.s.db.value<number>('SELECT id FROM users WHERE email = ?', profile.email) : undefined;
    const email = emailOwner === undefined || emailOwner === existing?.id ? profile.email : null;
    if (profile.email && !email) this.s.log.warn({ username: profile.username }, 'E-Mail-Adresse aus dem Verzeichnis wird bereits von einem anderen Konto verwendet');

    const userId = this.s.db.transaction(() => {
      if (existing) {
        this.s.db.run(
          `UPDATE users SET display_name = ?, email = COALESCE(?, email), auth_source = 'ldap', external_id = ?, external_dn = ?,
                            synced_at = ?, updated_at = ?, failed_logins = 0, locked_until = NULL,
                            password_hash = CASE WHEN auth_source = 'ldap' THEN password_hash ELSE NULL END WHERE id = ?`,
          profile.displayName || existing.display_name,
          email,
          profile.externalId,
          profile.dn,
          now,
          now,
          existing.id,
        );
        return existing.id;
      }
      const res = this.s.db.run(
        `INSERT INTO users (id, username, email, display_name, password_hash, kind, status, avatar_color, created_at, updated_at,
                            auth_source, external_id, external_dn, synced_at)
         VALUES (?, ?, ?, ?, NULL, 'user', 'active', ?, ?, ?, 'ldap', ?, ?, ?)`,
        nextRowId(this.s.db, 'users'),
        profile.username,
        email,
        profile.displayName || profile.username,
        colorFor(profile.username),
        now,
        now,
        profile.externalId,
        profile.dn,
        now,
      );
      const id = res.lastInsertRowid;
      for (const g of this.s.db.all<{ id: number }>('SELECT id FROM groups WHERE is_default = 1')) {
        this.s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', g.id, id, now);
      }
      return id;
    });

    this.syncGroups(userId, profile.groups);
    return this.s.users.require(userId);
  }

  /** Nur Gruppen mit hinterlegter AD-Zuordnung werden angefasst. */
  syncGroups(userId: number, directoryGroups: string[]): { added: string[]; removed: string[] } {
    const managed = this.s.db.all<GroupRow>("SELECT * FROM groups WHERE sync_enabled = 1 AND TRIM(directory_groups) != ''");
    const added: string[] = [];
    const removed: string[] = [];
    const now = nowIso();
    this.s.db.transaction(() => {
      for (const group of managed) {
        const identifiers = group.directory_groups.split(/[\r\n;]+/).map((v) => v.trim()).filter(Boolean);
        const shouldBeMember = this.matchesAny(directoryGroups, identifiers);
        const isMember = !!this.s.db.value('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', group.id, userId);
        if (shouldBeMember && !isMember) {
          this.s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', group.id, userId, now);
          added.push(group.name);
        } else if (!shouldBeMember && isMember) {
          this.s.db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', group.id, userId);
          removed.push(group.name);
        }
      }
    });
    return { added, removed };
  }

  /**
   * Gleicht ein bestehendes Verzeichniskonto erneut ab (ohne Passwort):
   * Anzeigename, E-Mail und Gruppenmitgliedschaften.
   */
  async resync(auth: AuthContext, user: UserRow): Promise<{ user: UserRow; added: string[]; removed: string[] }> {
    this.s.perms.requireGlobal(auth, 'users.manage');
    if (!this.isEnabled()) throw badRequest('Die Verzeichnisanmeldung ist nicht aktiviert');
    const d = this.settings();
    const client = await this.connect(d);
    try {
      const filter = user.external_dn
        ? '(objectClass=*)'
        : userFilterFor(d, user.username);
      const { searchEntries } = await client.search(user.external_dn || d.baseDn, {
        scope: user.external_dn ? 'base' : 'sub',
        filter,
        sizeLimit: 2,
        attributes: [d.userIdAttribute, d.nameAttribute, d.mailAttribute, d.groupAttribute, 'objectGUID'],
      });
      const entry = searchEntries[0];
      if (!entry) throw badRequest('Das Konto wurde im Verzeichnis nicht gefunden');
      const groups = await this.groupsOf(client, d, String(entry.dn), entry);
      const now = nowIso();
      const mail = attr(entry, d.mailAttribute) || null;
      const mailOwner = mail ? this.s.db.value<number>('SELECT id FROM users WHERE email = ?', mail) : undefined;
      this.s.db.run(
        'UPDATE users SET display_name = ?, email = COALESCE(?, email), external_dn = ?, synced_at = ?, updated_at = ? WHERE id = ?',
        attr(entry, d.nameAttribute) || user.display_name,
        mailOwner === undefined || mailOwner === user.id ? mail : null,
        String(entry.dn),
        now,
        now,
        user.id,
      );
      const changes = this.syncGroups(user.id, groups);
      this.s.emit(auth, {
        type: 'user.directory_synced',
        target: { type: 'user', id: user.id, label: user.username },
        data: changes,
      });
      return { user: this.s.users.require(user.id), ...changes };
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  /* ------------------------------ Administration ------------------------------ */

  /** Verbindungstest für die Administrationsoberfläche. */
  async test(auth: AuthContext, sample?: { login?: string; password?: string }): Promise<{ ok: boolean; steps: DirectoryTestStep[] }> {
    this.s.perms.requireGlobal(auth, 'admin');
    const d = this.settings();
    const steps: DirectoryTestStep[] = [];
    if (!d.url || !d.baseDn) {
      return { ok: false, steps: [{ label: 'Konfiguration', ok: false, detail: 'Server-URL und Basis-DN sind erforderlich' }] };
    }
    let client: Client | null = null;
    try {
      client = await this.connect(d);
      // Erst eine echte Abfrage beweist, dass Verbindung und Anmeldung stehen
      // (ohne Dienstkonto verbindet der Client sonst erst beim ersten Zugriff).
      const { searchEntries } = await client.search(d.baseDn, { scope: 'sub', filter: '(objectClass=*)', sizeLimit: 1, attributes: ['dn'] });
      steps.push({ label: 'Verbindung und Anmeldung', ok: true, detail: d.bindDn ? `${d.url} – Dienstkonto ${d.bindDn}` : `${d.url} – anonyme Suche` });
      steps.push({ label: 'Basis-DN lesbar', ok: true, detail: searchEntries.length ? `${d.baseDn} – Einträge gefunden` : `${d.baseDn} – keine Einträge` });

      if (sample?.login) {
        const account = this.normalizeLogin(sample.login);
        const filter = userFilterFor(d, account);
        const res = await client.search(d.baseDn, { scope: 'sub', filter, sizeLimit: 2, attributes: [d.userIdAttribute, d.nameAttribute, d.mailAttribute, d.groupAttribute] });
        const entry = res.searchEntries[0];
        steps.push({
          label: `Benutzer „${account}“ gefunden`,
          ok: !!entry,
          detail: entry ? String(entry.dn) : 'Kein Treffer – Filter oder Basis-DN prüfen',
        });
        if (entry) {
          const groups = attrList(entry, d.groupAttribute || 'memberOf').map(cnOf);
          steps.push({ label: 'Sicherheitsgruppen', ok: true, detail: groups.slice(0, 12).join(', ') || 'keine' });
          const mapped = this.s.db
            .all<GroupRow>("SELECT * FROM groups WHERE sync_enabled = 1 AND TRIM(directory_groups) != ''")
            .filter((g) => this.matchesAny(attrList(entry, d.groupAttribute || 'memberOf'), g.directory_groups.split(/[\r\n;]+/)))
            .map((g) => g.name);
          steps.push({ label: 'Zugeordnete Knowstead-Gruppen', ok: true, detail: mapped.join(', ') || 'keine Zuordnung getroffen' });
          if (sample.password) {
            const profile = await this.authenticate(sample.login, sample.password).catch((err) => {
              steps.push({ label: 'Passwortprüfung', ok: false, detail: err instanceof Error ? err.message : String(err) });
              return null;
            });
            if (profile) steps.push({ label: 'Passwortprüfung', ok: true, detail: `Anmeldung als ${profile.displayName} erfolgreich` });
          }
        }
      }
      return { ok: steps.every((s) => s.ok), steps };
    } catch (err) {
      steps.push({ label: 'Verbindung', ok: false, detail: err instanceof Error ? err.message : String(err) });
      return { ok: false, steps };
    } finally {
      await client?.unbind().catch(() => {});
    }
  }

  /** Gruppensuche für die Zuordnung in der Gruppenverwaltung. */
  async searchGroups(auth: AuthContext, query: string): Promise<{ dn: string; name: string; description: string }[]> {
    this.s.perms.requireGlobal(auth, 'users.manage');
    if (!this.isEnabled()) throw badRequest('Die Verzeichnisanmeldung ist nicht aktiviert');
    const d = this.settings();
    const client = await this.connect(d);
    try {
      const term = escapeFilter(query.trim());
      const filter = term ? `(&(objectClass=group)(|(cn=*${term}*)(sAMAccountName=*${term}*)))` : '(objectClass=group)';
      const { searchEntries } = await client.search(d.groupBaseDn || d.baseDn, {
        scope: 'sub',
        filter,
        sizeLimit: 50,
        attributes: ['cn', 'description', 'sAMAccountName'],
      });
      return searchEntries
        .map((e) => ({ dn: String(e.dn), name: attr(e, 'cn') || attr(e, 'sAMAccountName'), description: attr(e, 'description') }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      await client.unbind().catch(() => {});
    }
  }
}
