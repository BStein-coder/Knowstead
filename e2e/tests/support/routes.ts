import type { Seed } from './data';

export interface RouteCase {
  /** Adresse relativ zur Basis – als Funktion, weil die IDs erst nach dem Anlegen der Testdaten feststehen */
  path: (seed: Seed) => string;
  /** Kurzbeschreibung für Berichte */
  name: string;
  /** Erwartete Überschrift (h1) – Teilstring oder Muster */
  heading?: string | RegExp;
  /** Erwartete URL nach Weiterleitungen, falls abweichend */
  redirectsTo?: RegExp;
}

const sp = (seed: Seed) => `/s/${seed.spaceKey}`;

/** Alle Seiten der Oberfläche, die eine angemeldete Administratorin erreicht. */
export const adminRoutes: RouteCase[] = [
  { path: () => '/', name: 'Startseite', heading: /Guten|Hallo/ },
  { path: () => '/spaces', name: 'Bereiche', heading: 'Bereiche' },
  { path: sp, name: 'Bereich – Startseite' },
  { path: (x) => `${sp(x)}/p/${x.richPageId}`, name: 'Seite (Rich-Text mit Makros)', heading: 'Makroseite' },
  { path: (x) => `${sp(x)}/p/${x.markdownPageId}`, name: 'Seite (Markdown)', heading: 'Markdown-Notizen' },
  { path: (x) => `${sp(x)}/p/${x.codePageId}`, name: 'Seite (Code)', heading: 'Konfiguration' },
  { path: (x) => `${sp(x)}/p/${x.childPageId}`, name: 'Unterseite', heading: 'Unterseite Alpha' },
  { path: (x) => `${sp(x)}/edit/${x.childPageId}`, name: 'Editor' },
  { path: (x) => `${sp(x)}/new`, name: 'Neue Seite' },
  { path: (x) => `${sp(x)}/history/${x.richPageId}`, name: 'Versionen' },
  { path: (x) => `${sp(x)}/history/${x.richPageId}/v/1`, name: 'Alte Version' },
  { path: (x) => `${sp(x)}/diff/${x.richPageId}?from=1&to=2`, name: 'Versionsvergleich' },
  { path: (x) => `${sp(x)}/changelog`, name: 'Änderungsprotokoll des Bereichs' },
  { path: (x) => `${sp(x)}/trash`, name: 'Papierkorb' },
  { path: (x) => `${sp(x)}/tasks`, name: 'Aufgabenplaner des Bereichs' },
  { path: (x) => `${sp(x)}/settings`, name: 'Bereichseinstellungen – Allgemein' },
  { path: (x) => `${sp(x)}/settings/permissions`, name: 'Bereichseinstellungen – Berechtigungen' },
  { path: (x) => `${sp(x)}/settings/members`, name: 'Bereichseinstellungen – Mitglieder' },
  { path: (x) => `${sp(x)}/settings/approvals`, name: 'Bereichseinstellungen – Freigaben' },
  { path: (x) => `${sp(x)}/settings/restricted`, name: 'Bereichseinstellungen – Eingeschränkte Seiten' },
  { path: (x) => `${sp(x)}/settings/templates`, name: 'Bereichseinstellungen – Vorlagen' },
  { path: (x) => `${sp(x)}/settings/data`, name: 'Bereichseinstellungen – Daten' },
  { path: (x) => `${sp(x)}/settings/danger`, name: 'Bereichseinstellungen – Gefahrenzone' },
  { path: () => '/s/HANDBUCH', name: 'Handbuch' },
  { path: () => '/search?q=Makroseite', name: 'Suche' },
  { path: () => '/activity', name: 'Aktivität' },
  { path: () => '/notifications', name: 'Benachrichtigungen' },
  { path: () => '/drafts', name: 'Entwürfe' },
  { path: () => '/journal', name: 'Journal' },
  { path: () => '/reviews', name: 'Prüfungen' },
  { path: () => '/changes', name: 'Letzte Änderungen' },
  { path: () => '/tasks', name: 'Meine Aufgaben' },
  { path: () => '/projects', name: 'Projekte', heading: 'Projekte' },
  { path: () => '/calendar', name: 'Kalender', heading: 'Kalender' },
  { path: () => '/content-reviews', name: 'Wiedervorlage' },
  { path: () => '/read-confirmations', name: 'Lesebestätigungen', heading: 'Lesebestätigungen' },
  { path: () => '/analytics', name: 'Inhaltsanalyse', heading: 'Inhaltsanalyse' },
  { path: () => '/tags', name: 'Stichwörter' },
  { path: () => '/people/erika', name: 'Profil einer Person' },
  { path: () => '/profile', name: 'Profil' },
  { path: () => '/profile/preferences', name: 'Profil – Einstellungen' },
  { path: () => '/profile/password', name: 'Profil – Passwort' },
  { path: () => '/profile/tokens', name: 'Profil – API-Tokens' },
  { path: () => '/profile/sessions', name: 'Profil – Sitzungen' },
  { path: () => '/profile/sign-in', name: 'Profil – Anmeldung' },
  { path: () => '/profile/deputies', name: 'Profil – Vertretung' },
  { path: () => '/profile/notifications', name: 'Profil – Beobachtet' },
  { path: () => '/admin', name: 'Administration – Übersicht' },
  { path: () => '/admin/setup', name: 'Administration – Nächste Schritte', heading: 'Nächste Schritte' },
  { path: () => '/admin/users', name: 'Administration – Benutzer' },
  { path: () => '/admin/groups', name: 'Administration – Gruppen' },
  { path: () => '/admin/permissions', name: 'Administration – Rechte' },
  { path: () => '/admin/directory', name: 'Administration – Verzeichnis' },
  { path: () => '/admin/sso', name: 'Administration – Single Sign-on', heading: 'Single Sign-on' },
  { path: () => '/admin/ai', name: 'Administration – KI' },
  { path: () => '/admin/mail', name: 'Administration – E-Mail' },
  { path: () => '/admin/spaces', name: 'Administration – Bereiche' },
  { path: () => '/admin/settings', name: 'Administration – Einstellungen' },
  { path: () => '/admin/templates', name: 'Administration – Vorlagen' },
  { path: () => '/admin/export', name: 'Administration – Export-Vorlage' },
  { path: () => '/admin/webhooks', name: 'Administration – Webhooks' },
  { path: () => '/admin/connectors', name: 'Administration – Konnektoren' },
  { path: () => '/admin/plugins', name: 'Administration – Plugins' },
  { path: () => '/admin/audit', name: 'Administration – Audit-Log' },
  { path: () => '/admin/backups', name: 'Administration – Sicherungen' },
  { path: () => '/admin/maintenance', name: 'Administration – Wartung' },
  { path: () => '/admin/about', name: 'Administration – Über' },
  { path: () => '/gibt-es-nicht', name: 'Unbekannte Adresse (404)', heading: /nicht gefunden/i },
];

/** Seiten ohne Anmeldung. */
export const publicRoutes: RouteCase[] = [
  { path: () => '/login', name: 'Anmeldung', heading: /anmelden/i },
  { path: () => '/forgot-password', name: 'Passwort vergessen', heading: /Passwort/ },
  { path: () => '/reset-password/ungueltig', name: 'Passwort zurücksetzen', heading: /Passwort/ },
  { path: () => '/verify-email/ungueltig', name: 'E-Mail bestätigen', heading: /E-Mail/ },
  { path: () => '/register', name: 'Registrierung (abgeschaltet → Anmeldung)', redirectsTo: /\/login/ },
  { path: () => '/setup', name: 'Einrichtung (erledigt → Startseite/Anmeldung)', redirectsTo: /\/(login|$)/ },
  { path: () => '/', name: 'Startseite ohne Anmeldung → Anmeldung', redirectsTo: /\/login/ },
];
