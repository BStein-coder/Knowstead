import type { Db } from '../db/database.ts';
import { nowIso, parseJson } from '../db/database.ts';
import { matchesPattern } from './util.ts';

export type EventCategory = 'content' | 'security' | 'admin' | 'system';

/**
 * Katalog aller Ereignistypen. Er dient als Grundlage für Aktivitätsfeed,
 * Audit-Log, Webhooks und Plugins. Plugins können eigene Typen über
 * `registerEventType` ergänzen.
 */
export const EVENT_TYPES: Record<string, { category: EventCategory; label: string }> = {
  'space.created': { category: 'content', label: 'Bereich erstellt' },
  'space.updated': { category: 'content', label: 'Bereich geändert' },
  'space.archived': { category: 'content', label: 'Bereich archiviert' },
  'space.unarchived': { category: 'content', label: 'Bereich reaktiviert' },
  'space.deleted': { category: 'admin', label: 'Bereich gelöscht' },
  'space.permissions_changed': { category: 'security', label: 'Bereichsberechtigungen geändert' },
  'space.imported': { category: 'content', label: 'Inhalte importiert' },

  'page.created': { category: 'content', label: 'Seite erstellt' },
  'page.updated': { category: 'content', label: 'Seite aktualisiert' },
  'page.moved': { category: 'content', label: 'Seite verschoben' },
  'page.copied': { category: 'content', label: 'Seite kopiert' },
  'page.deleted': { category: 'content', label: 'Seite in den Papierkorb verschoben' },
  'page.restored': { category: 'content', label: 'Seite wiederhergestellt' },
  'page.purged': { category: 'content', label: 'Seite endgültig gelöscht' },
  'page.version_restored': { category: 'content', label: 'Seitenversion wiederhergestellt' },
  'page.labels_changed': { category: 'content', label: 'Stichwörter geändert' },
  'label.renamed': { category: 'admin', label: 'Stichwort umbenannt' },
  'label.deleted': { category: 'admin', label: 'Stichwort gelöscht' },
  'page.properties_changed': { category: 'content', label: 'Eigenschaften geändert' },
  'page.restrictions_changed': { category: 'security', label: 'Seiteneinschränkungen geändert' },
  'page.verified': { category: 'content', label: 'Seite als aktuell bestätigt' },
  'page.review_cycle_changed': { category: 'content', label: 'Wiedervorlage geändert' },
  'page.edit_mode_changed': { category: 'content', label: 'Bearbeitungsmodus geändert' },
  'page.read_requirement_changed': { category: 'admin', label: 'Lesebestätigung angefordert oder geändert' },
  'page.read_confirmed': { category: 'admin', label: 'Lesebestätigung abgegeben' },

  'review.requested': { category: 'content', label: 'Prüfung angefordert' },
  'review.approved': { category: 'content', label: 'Seite freigegeben' },
  'review.rejected': { category: 'content', label: 'Seite zurückgewiesen' },
  'review.cancelled': { category: 'content', label: 'Prüfauftrag zurückgezogen' },
  'review.stage_approved': { category: 'content', label: 'Freigabestufe abgeschlossen' },
  'review.stage_decision': { category: 'content', label: 'Freigabe in einer Stufe erteilt' },
  'space.approval_workflow_changed': { category: 'admin', label: 'Freigabeablauf geändert' },
  'user.deputy_set': { category: 'admin', label: 'Abwesenheitsvertretung eingetragen' },

  'task.board_created': { category: 'content', label: 'Plan angelegt' },
  'task.board_deleted': { category: 'content', label: 'Plan gelöscht' },
  'task.created': { category: 'content', label: 'Aufgabe angelegt' },
  'task.updated': { category: 'content', label: 'Aufgabe geändert' },
  'task.completed': { category: 'content', label: 'Aufgabe erledigt' },
  'task.deleted': { category: 'content', label: 'Aufgabe gelöscht' },
  'task.restored': { category: 'content', label: 'Aufgabe wiederhergestellt' },
  'task.purged': { category: 'content', label: 'Aufgabe endgültig gelöscht' },
  'task.commented': { category: 'content', label: 'Nachricht zur Aufgabe' },
  'task.comment_updated': { category: 'content', label: 'Nachricht zur Aufgabe bearbeitet' },
  'task.comment_deleted': { category: 'content', label: 'Nachricht zur Aufgabe gelöscht' },

  'comment.created': { category: 'content', label: 'Kommentar erstellt' },
  'comment.updated': { category: 'content', label: 'Kommentar bearbeitet' },
  'comment.deleted': { category: 'content', label: 'Kommentar gelöscht' },
  'comment.resolved': { category: 'content', label: 'Kommentar erledigt' },
  'comment.reopened': { category: 'content', label: 'Kommentar wieder geöffnet' },

  'attachment.uploaded': { category: 'content', label: 'Anhang hochgeladen' },
  'attachment.deleted': { category: 'content', label: 'Anhang gelöscht' },
  'attachment.restored': { category: 'content', label: 'Anhang wiederhergestellt' },

  'auth.login': { category: 'security', label: 'Anmeldung' },
  'auth.login_failed': { category: 'security', label: 'Fehlgeschlagene Anmeldung' },
  'auth.logout': { category: 'security', label: 'Abmeldung' },
  'auth.password_changed': { category: 'security', label: 'Passwort geändert' },
  'auth.password_reset_requested': { category: 'security', label: 'Passwort-Zurücksetzung angefordert' },
  'auth.registered': { category: 'security', label: 'Selbstregistrierung' },
  'auth.email_verified': { category: 'security', label: 'E-Mail-Adresse bestätigt' },
  'auth.identity_linked': { category: 'security', label: 'Anmeldekonto verknüpft' },
  'auth.identity_unlinked': { category: 'security', label: 'Anmeldekonto getrennt' },

  'user.created': { category: 'security', label: 'Benutzer angelegt' },
  'user.directory_synced': { category: 'security', label: 'Verzeichniskonto abgeglichen' },
  'user.updated': { category: 'security', label: 'Benutzer geändert' },
  'user.disabled': { category: 'security', label: 'Benutzer deaktiviert' },
  'user.enabled': { category: 'security', label: 'Benutzer aktiviert' },
  'user.deleted': { category: 'security', label: 'Benutzer gelöscht' },
  'group.created': { category: 'security', label: 'Gruppe angelegt' },
  'group.updated': { category: 'security', label: 'Gruppe geändert' },
  'group.deleted': { category: 'security', label: 'Gruppe gelöscht' },
  'group.members_changed': { category: 'security', label: 'Gruppenmitglieder geändert' },
  'token.created': { category: 'security', label: 'API-Token erstellt' },
  'token.revoked': { category: 'security', label: 'API-Token widerrufen' },

  'settings.updated': { category: 'admin', label: 'Einstellungen geändert' },
  'space.category_created': { category: 'admin', label: 'Bereichskategorie angelegt' },
  'space.category_updated': { category: 'admin', label: 'Bereichskategorie umbenannt' },
  'space.category_deleted': { category: 'admin', label: 'Bereichskategorie entfernt' },
  // Bewusst nicht im Aktivitätsfeed – KI-Nutzung erscheint nur im Audit-Log.
  'ai.used': { category: 'system', label: 'KI-Funktion genutzt' },
  'template.created': { category: 'admin', label: 'Vorlage erstellt' },
  'template.updated': { category: 'admin', label: 'Vorlage geändert' },
  'template.deleted': { category: 'admin', label: 'Vorlage gelöscht' },
  'webhook.created': { category: 'admin', label: 'Webhook erstellt' },
  'webhook.updated': { category: 'admin', label: 'Webhook geändert' },
  'webhook.deleted': { category: 'admin', label: 'Webhook gelöscht' },
  'connector.created': { category: 'admin', label: 'API-Konnektor erstellt' },
  'connector.updated': { category: 'admin', label: 'API-Konnektor geändert' },
  'connector.deleted': { category: 'admin', label: 'API-Konnektor gelöscht' },
  'plugin.enabled': { category: 'admin', label: 'Plugin aktiviert' },
  'plugin.disabled': { category: 'admin', label: 'Plugin deaktiviert' },
  'plugin.settings_updated': { category: 'admin', label: 'Plugin-Einstellungen geändert' },
  'backup.created': { category: 'system', label: 'Sicherung erstellt' },
  'backup.deleted': { category: 'system', label: 'Sicherung gelöscht' },
  'maintenance.run': { category: 'system', label: 'Wartungsaufgabe ausgeführt' },
  'system.started': { category: 'system', label: 'System gestartet' },
  'system.updated': { category: 'system', label: 'Knowstead aktualisiert' },
};

export function registerEventType(type: string, category: EventCategory, label: string): void {
  if (!EVENT_TYPES[type]) EVENT_TYPES[type] = { category, label };
}

export interface ActorRef {
  id: number;
  username: string;
  displayName: string;
}

export interface DomainEvent {
  id: number;
  type: string;
  category: EventCategory;
  actor: ActorRef | null;
  spaceId: number | null;
  pageId: number | null;
  target: { type: string; id: string; label: string | null } | null;
  data: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface EmitInput {
  type: string;
  actor?: ActorRef | null;
  spaceId?: number | null;
  pageId?: number | null;
  target?: { type: string; id: string | number; label?: string | null } | null;
  data?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

interface Subscription {
  pattern: string;
  handler: EventHandler;
  owner?: string;
}

export interface EventRow {
  id: number;
  type: string;
  category: EventCategory;
  actor_id: number | null;
  actor_name: string | null;
  space_id: number | null;
  page_id: number | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  data: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/**
 * Zentraler Ereignisbus: Jedes Ereignis wird im `events`-Table persistiert
 * (Aktivitätsfeed + Audit-Log) und anschließend asynchron an alle
 * Abonnenten (Benachrichtigungen, Webhooks, Echtzeit, Plugins) verteilt.
 */
export class EventBus {
  private readonly subs: Subscription[] = [];
  private readonly db: Db;
  private readonly onError: (err: unknown, event: DomainEvent) => void;

  constructor(db: Db, onError: (err: unknown, event: DomainEvent) => void) {
    this.db = db;
    this.onError = onError;
  }

  on(pattern: string, handler: EventHandler, owner?: string): () => void {
    const sub: Subscription = { pattern, handler, owner };
    this.subs.push(sub);
    return () => {
      const idx = this.subs.indexOf(sub);
      if (idx >= 0) this.subs.splice(idx, 1);
    };
  }

  removeByOwner(owner: string): void {
    for (let i = this.subs.length - 1; i >= 0; i--) {
      if (this.subs[i].owner === owner) this.subs.splice(i, 1);
    }
  }

  emit(input: EmitInput): DomainEvent {
    const meta = EVENT_TYPES[input.type] ?? { category: 'system' as EventCategory, label: input.type };
    const createdAt = nowIso();
    const data = input.data ?? {};
    const target = input.target
      ? { type: input.target.type, id: String(input.target.id), label: input.target.label ?? null }
      : null;
    const res = this.db.run(
      `INSERT INTO events (type, category, actor_id, actor_name, space_id, page_id, target_type, target_id, target_label, data, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.type,
      meta.category,
      input.actor?.id ?? null,
      input.actor?.displayName ?? null,
      input.spaceId ?? null,
      input.pageId ?? null,
      target?.type ?? null,
      target?.id ?? null,
      target?.label ?? null,
      JSON.stringify(data),
      input.ip ?? null,
      input.userAgent?.slice(0, 300) ?? null,
      createdAt,
    );
    const event: DomainEvent = {
      id: res.lastInsertRowid,
      type: input.type,
      category: meta.category,
      actor: input.actor ?? null,
      spaceId: input.spaceId ?? null,
      pageId: input.pageId ?? null,
      target,
      data,
      ip: input.ip ?? null,
      createdAt,
    };
    this.dispatch(event);
    return event;
  }

  private dispatch(event: DomainEvent): void {
    const handlers = this.subs.filter((s) => matchesPattern(s.pattern, event.type));
    if (!handlers.length) return;
    setImmediate(() => {
      for (const sub of handlers) {
        try {
          const res = sub.handler(event);
          if (res instanceof Promise) res.catch((err) => this.onError(err, event));
        } catch (err) {
          this.onError(err, event);
        }
      }
    });
  }

  static fromRow(row: EventRow): DomainEvent {
    return {
      id: row.id,
      type: row.type,
      category: row.category,
      actor: row.actor_id ? { id: row.actor_id, username: '', displayName: row.actor_name ?? '' } : null,
      spaceId: row.space_id,
      pageId: row.page_id,
      target: row.target_type ? { type: row.target_type, id: row.target_id ?? '', label: row.target_label } : null,
      data: parseJson<Record<string, unknown>>(row.data, {}),
      ip: row.ip,
      createdAt: row.created_at,
    };
  }
}
