import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';

/** Interner Schlüssel: Checkliste in der Übersicht ausgeblendet */
export const CHECKLIST_DISMISSED_KEY = 'setupChecklist:dismissed';

export type ChecklistState = 'done' | 'open' | 'optional';

export interface ChecklistItem {
  id: 'address' | 'service' | 'mail' | 'backup' | 'users' | 'spaces' | 'login' | 'extras';
  state: ChecklistState;
  /** Zusatzangabe zum aktuellen Stand (Adresse, neueste Sicherung …) */
  detail: string | null;
  /** Wohin „Einrichten“ führt */
  link: string;
}

const BACKUP_MAX_AGE_MS = 2 * 86400000;
const OPTIONAL_ITEMS = new Set<ChecklistItem['id']>(['login', 'extras']);

/**
 * Was nach der Ersteinrichtung noch zu tun ist – für die Seite „Einrichtung abschließen“ und den Hinweis
 * in der Administration. Optionale Punkte zählen nicht als offen.
 */
export function setupChecklist(s: Services, auth: AuthContext) {
  s.perms.requireGlobal(auth, 'admin');
  const settings = s.settings.all();
  const items: ChecklistItem[] = [];

  let address: ChecklistState = 'open';
  try {
    const url = new URL(s.config.baseUrl);
    if (url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) address = 'done';
  } catch {
    address = 'open';
  }
  items.push({ id: 'address', state: address, detail: s.config.baseUrl, link: '/admin/about' });

  items.push({ id: 'service', state: s.config.service ? 'done' : 'open', detail: s.config.service, link: '/admin/about' });

  items.push({ id: 'mail', state: s.mailer.isConfigured() ? 'done' : 'open', detail: settings.smtp.host || null, link: '/admin/mail' });

  const newest = s.backups.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const recent = !!newest && Date.now() - new Date(newest.createdAt).getTime() < BACKUP_MAX_AGE_MS;
  items.push({ id: 'backup', state: settings.backupEnabled && recent ? 'done' : 'open', detail: newest?.createdAt ?? null, link: '/admin/backups' });

  const people = s.db.value<number>("SELECT COUNT(*) FROM users WHERE kind = 'user'") ?? 0;
  items.push({ id: 'users', state: people > 1 ? 'done' : 'open', detail: String(people), link: '/admin/users' });

  // Eigene Bereiche: ohne Handbuch, Beispielbereich und persönliche Bereiche
  const spaces = s.db.value<number>("SELECT COUNT(*) FROM spaces WHERE kind = 'team' AND UPPER(key) NOT IN ('HANDBUCH', 'TEAM')") ?? 0;
  items.push({ id: 'spaces', state: spaces > 0 ? 'done' : 'open', detail: String(spaces), link: '/spaces' });

  const login = s.directory.isEnabled() || s.sso.publicInfo().providers.length > 0;
  items.push({ id: 'login', state: login ? 'done' : 'optional', detail: null, link: settings.directory.enabled ? '/admin/directory' : '/admin/sso' });

  const extras = settings.ocr.enabled || settings.officePreview.enabled;
  items.push({ id: 'extras', state: extras ? 'done' : 'optional', detail: null, link: '/admin/ai' });

  // Anmeldung mit Firmenkonten und Zusatzprogramme bleiben optional – auch wenn sie eingerichtet sind
  const required = items.filter((item) => !OPTIONAL_ITEMS.has(item.id));
  return {
    items,
    done: required.filter((item) => item.state === 'done').length,
    total: required.length,
    dismissed: s.settings.getInternal<boolean>(CHECKLIST_DISMISSED_KEY, false),
  };
}
