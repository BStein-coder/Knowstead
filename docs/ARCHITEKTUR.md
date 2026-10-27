# Architektur

Dieses Dokument beschreibt den inneren Aufbau von Knowstead: Bausteine, Datenfluss, Datenmodell und die
Entscheidungen dahinter. Zielgruppe sind Entwicklerinnen und Entwickler, die das System erweitern,
betreiben oder verstehen wollen.

## Leitgedanken

1. **Ein Prozess, eine Datei.** Server, Oberfläche, Suche und Dateiablage laufen in einem Node-Prozess
   mit einer SQLite-Datenbank. Kein Elasticsearch, kein Redis, keine Message-Queue.
2. **Kein Build auf dem Server.** Node 24 führt TypeScript direkt aus (native Typ-Entfernung).
   Gebaut wird nur die Oberfläche (Vite).
3. **Alles ist ein Ereignis.** Jede fachliche Aktion erzeugt ein `DomainEvent`. Aktivitätsfeed,
   Audit-Log, Benachrichtigungen, Webhooks, Live-Aktualisierung und Plugins hängen daran.
4. **Erweitern ohne Fork.** Filter-Hooks, Ereignisse, Plugin-Routen und eine Browser-API decken die
   üblichen Erweiterungswünsche ab.
5. **Rechte an genau einer Stelle.** Der `PermissionService` beantwortet jede Zugriffsfrage; Module
   fragen ihn, statt eigene Regeln zu erfinden.

## Bausteine

```
┌───────────────────────────── Browser ──────────────────────────────┐
│  React 19 · React Router · TanStack Query · TipTap 3 · Yjs         │
│  Editor, Seitenbaum, Planer, Whiteboard, Administration, Plugins   │
└──────────┬──────────────────────┬──────────────────────┬───────────┘
           │ REST (/api/v1)       │ SSE (/api/v1/stream) │ WebSocket (/api/v1/collab/:id)
┌──────────▼──────────────────────▼──────────────────────▼───────────┐
│                     Fastify 5 (server/src/app.ts)                  │
│  onRequest: Auth (Cookie/Token), Token-Umfänge, CSRF               │
│  onSend:    Sicherheits-Header, CSP · Upgrade → CollabService      │
│  Routen: modules/<modul>/routes.ts · Swagger /api/docs             │
├────────────────────────────────────────────────────────────────────┤
│                       Dienste (services.ts)                        │
│  pages · drafts · trash · links · spaces · categories · search ·   │
│  comments · attachments · attachmentText · revisions · labels ·    │
│  journal · restrictions · macros · reviews · reviewCycle ·         │
│  directory · templates · notifications · mail · webhooks ·         │
│  connectors · plugins · backups · admin · transfer · imports ·     │
│  exporter · realtime · collab · ai · tasks · calendar · clips ·    │
│  previews                                                          │
├─────────────────┬─────────────────┬────────────────┬───────────────┤
│  PermissionSvc  │    EventBus     │  HookRegistry  │   Settings    │
├─────────────────┴─────────────────┴────────────────┴───────────────┤
│   Db (node:sqlite, WAL) · Migrationen · FTS5 (Seiten, Anhänge)     │
├────────────────────────────────────────────────────────────────────┤
│  Worker-Threads: PDF/Word-Satz · Textgewinnung · DB-Snapshot       │
└────────────────────────────────────────────────────────────────────┘
            │                                   │
        data/knowstead.db                      data/uploads/
```

### Dienstcontainer

`server/src/services.ts` definiert das Interface `Services` und baut in `createServices(config, log)`
alle Dienste auf. Jeder Dienst ist eine Klasse, die genau ein Objekt bekommt: den Container selbst.

```ts
export class PageService {
  constructor(private readonly s: Services) {}
  // s.db, s.perms, s.events, s.settings … sind überall verfügbar
}
```

Vorteile: keine zyklischen Importe, jeder Dienst kann jeden anderen nutzen, und in Tests wird der
Container einmal gebaut (`createTestApp()`).

Große Fachbereiche sind in mehrere Dienste geschnitten, damit keine Klasse unüberschaubar wird. Beispiel
Seiten: `pages` (Seiten, Versionen, Rechte, Verschieben/Kopieren), `drafts` (persönliche Entwürfe),
`trash` (Papierkorb, endgültiges Löschen samt Dateien) und `links` (Seitenverweise, Rückverweise,
defekte Links). Routen liegen im Modul ihres Fachbereichs (`comments/routes.ts`, `attachments/routes.ts`).

`startServices()` startet danach Hintergrundaufgaben (Benachrichtigungs-Sammler, Webhook-Zusteller,
E-Mail-Warteschlange, Erinnerungen für Aufgaben und Wiedervorlagen, Indexierung von Anhängen,
Sicherungen, Aufräumarbeiten) und lädt die aktivierten Plugins; `stopServices()` beendet sie sauber
und schreibt gesammelte Seitenaufrufe sowie offene Bearbeitungsstände weg. Mit
`buildApp(config, { schedulers: false })` laufen nur die Dienste ohne Zeitsteuerung (Tests).

### Anfragefluss

Am Beispiel „Seite speichern“ (`PUT /api/v1/pages/42`):

1. **onRequest** – `auth.resolve(req)` liest Sitzungs-Cookie oder Bearer-Token und baut den
   `AuthContext` (Benutzer, Gruppen, globale Rechte, Umfänge, IP, User-Agent). Bei Cookie-Sitzungen
   wird zusätzlich der Header `X-Knowstead-Client` verlangt (CSRF-Schutz).
2. **Schema** – TypeBox validiert Parameter und Body; Fehler werden zu `400 validation`.
3. **Route** – `s.pages.requireAccess(req.auth, id, 'edit')` prüft Bereichsrolle und Seiteneinschränkungen.
4. **Hook** – `page.beforeSave` kann Titel, Inhalt oder Typ verändern oder mit einem `HttpError` abbrechen.
5. **Aufbereitung** – `prepareContent()` bereinigt das HTML (sanitize-html), erzeugt Klartext,
   Kurzfassung, Linkliste und Erwähnungen.
6. **Transaktion** – neue Version in `page_revisions`, Aktualisierung in `pages`, `page_links`,
   `page_labels`, `page_properties`, FTS-Index.
7. **Ereignis** – `s.emit(auth, { type: 'page.updated', … })` schreibt in `events` und verteilt
   asynchron an Benachrichtigungen, Webhooks, SSE-Kanäle und Plugins.
8. **Antwort** – `s.pages.dto()` liefert die Seite inklusive Rechteangaben; bei `render=true`
   zusätzlich das Anzeige-HTML, durch den Filter `page.render` gereicht.

### Ereignisse

`server/src/core/events.ts` enthält den Katalog `EVENT_TYPES` (Typ → Kategorie `content` |
`security` | `admin` | `system` und deutsche Bezeichnung). Der `EventBus`

- schreibt jedes Ereignis nach `events` (Grundlage für Aktivitätsfeed **und** Audit-Log),
- verteilt es danach asynchron (`setImmediate`) an Abonnenten – ein Fehler in einem Abonnenten
  bricht die auslösende Aktion nie ab,
- unterstützt Muster: `page.*`, `comment.created`, `*`.

Abonnenten sind Benachrichtigungen, Webhooks, die SSE-Verteilung und Plugins.

### Hooks

`HookRegistry` (`core/hooks.ts`) verwaltet Filter mit Priorität und Besitzer. Ein Filter bekommt einen
Wert und gibt ihn (verändert) zurück:

| Hook | Wert | Kontext |
| --- | --- | --- |
| `page.beforeSave` | `{ title, content, contentType }` | `{ page, space, auth }` |
| `page.render` | Anzeige-HTML | `{ page, space, auth }` |
| `page.export` | Export-HTML | `{ page, space, auth }` |
| `search.results` | Trefferliste | `{ query, auth }` |

Beim Deaktivieren eines Plugins werden alle Filter und Abonnements über den Besitzer
(`plugin:<id>`) wieder entfernt – deshalb funktioniert Aktivieren/Deaktivieren ohne Neustart.

### Rechte

Drei Ebenen, ausgewertet in `core/permissions.ts`:

1. **Global** über Gruppen: `admin`, `spaces.create`, `users.manage`, `templates.manage`,
   `integrations.manage`, `audit.view`, `api.tokens`. Gruppen können an AD-Sicherheitsgruppen
   gebunden sein (`groups.directory_groups`) – die Mitgliedschaft wird dann bei jeder Anmeldung
   aus dem Verzeichnis übernommen.
2. **Bereich**: Rollen `viewer` < `commenter` < `editor` < `admin`, vergeben an Gruppen, Benutzer,
   „alle angemeldeten Benutzer“ oder „anonym“. Daraus leiten sich die Aktionen ab
   (`view`, `export`, `comment`, `create`, `edit`, `move`, `delete`, `attach`, `restrict`,
   `moderate`, `purge`, `admin`). In archivierten Bereichen bleiben nur `view`, `export`, `admin`.
3. **Seite**: Einschränkungen auf Benutzer/Gruppen. Ansichtsbeschränkungen vererben sich an
   Unterseiten, Bearbeitungsbeschränkungen gelten nur für die Seite selbst. Globale Administratoren
   sehen und bearbeiten immer.

Ergebnis jeder Prüfung ist ein `PageAccess`-Objekt (`view`, `edit`, `create`, `move`, `delete`, …),
das auch an die Oberfläche geht – Knöpfe erscheinen nur, wenn die Aktion erlaubt ist.

## Datenmodell

SQLite mit Fremdschlüsseln und WAL. Die wichtigsten Tabellen:

| Tabelle | Inhalt |
| --- | --- |
| `users`, `groups`, `group_members` | Konten, Gruppen mit globalen Rechten (JSON) |
| `sessions`, `password_resets`, `api_tokens` | Anmeldung, Zurücksetzen, Tokens (nur Hash gespeichert) |
| `spaces`, `space_permissions` | Bereiche und ihre Rollenvergabe |
| `pages` | Seitenbaum (`parent_id`, `position`), Inhalt, Klartext, Kurzfassung, Status, Version |
| `page_revisions` | jede veröffentlichte Version mit Änderungsnotiz und Autor |
| `page_drafts` | persönliche Entwürfe (auto-save) |
| `page_links` | interne Verweise für Backlinks und Link-Karte |
| `page_restrictions` | Seiteneinschränkungen (`view` / `edit`) |
| `page_reviews` | Prüfaufträge mit Version, Status, Anforderndem, Prüfer und Begründung |
| `labels`, `page_labels`, `page_properties` | Stichwörter und Eigenschaften |
| `comments` | Seiten- und Inline-Kommentare (Thread über `parent_id`, Anker im Text) |
| `attachments` | Anhänge mit Version, Prüfsumme und Löschmarkierung |
| `templates` | Vorlagen (global oder je Bereich) |
| `favorites`, `watches`, `page_views` | persönliche Listen und Zugriffszähler |
| `notifications` | Benachrichtigungen je Benutzer |
| `events` | Ereignisprotokoll = Aktivitätsfeed + Audit-Log |
| `webhooks`, `webhook_deliveries` | Zieladressen und Zustellprotokoll |
| `connectors` | API-Konnektoren mit verschlüsselten Zugangsdaten |
| `plugins`, `plugin_storage` | Aktivierung, Einstellungen und Datenablage der Plugins |
| `pages_fts` | FTS5-Index (Titel, Klartext) |
| `task_boards`, `tasks` | Aufgabenplaner: Pläne je Bereich mit Spalten (JSON) und Aufgaben (Verantwortlich, Fristen, Priorität, Status, Fortschritt, Checkliste, Seite, Wiederholung `recurrence`, Serie `series_id`) |
| `task_reminders`, `calendar_feeds` | verschickte Aufgaben-Erinnerungen (je Termin einmal), Kalender-Abos (nur Hash des Geheimnisses) |
| `clips` | persönliche Zwischenablage (HTML bereinigt, Text, Link) |
| `ai_usage` | Protokoll jeder KI-Anfrage (Aktion, Modell, Token, Dauer, Fehler) für Limits und Statistik |
| `mail_queue`, `mail_digests` | E-Mail-Warteschlange mit Status, Versuchen und Fehlern; Zeitpunkt der letzten Zusammenfassung je Person |
| `space_categories` | Kategorien der Bereiche mit Symbol und Reihenfolge (Bereiche verweisen per Name in `spaces.category`) |
| `pages.owner_id`, `review_*`, `verified_*` | Wiedervorlage je Seite; Vorgabe und Plan je Bereich in `spaces.review_interval_months`, `review_board_id` |
| `page_review_reminders` | verschickte Wiedervorlage-Erinnerungen und angelegte Aufgaben je Fälligkeit |
| `attachment_texts`, `attachments_fts` | Stand der Textgewinnung je Anhang und FTS5-Index über Dateiname und Inhalt |
| `collab_documents` | gemeinsamer Bearbeitungsstand je Seite (Yjs-Update), Basisversion, „unveröffentlicht“-Kennzeichen |
| `file_deletions` | Dateien endgültig gelöschter Anhänge mit Zeitpunkt – vom Datenträger entfernt erst nach 30 Tagen |
| `task_dependencies`, `task_boards.auto_schedule` | Abhängigkeiten zwischen Aufgaben (Art FS/SS/FF/SF, Versatz) und automatische Terminplanung je Plan |
| `page_view_days`, `search_queries`, `page_refs`, `analytics_dismissed` | Inhaltsanalyse: Aufrufe je Seite und Tag, erfolglose Suchbegriffe (ohne Personenbezug), ausgewertete Verweise, erledigte Einträge |
| `read_requirements`, `read_confirmations`, `read_reminders` | Lesebestätigungen: Zielgruppe, Text, Frist und Runde je Seite; Bestätigungen mit Version und Text; verschickte Erinnerungen |
| `approval_workflows`, `review_decisions`, `review_escalations`, `user_deputies`, `page_reviews.stages` | mehrstufige Freigabeabläufe je Bereich, Momentaufnahme der Stufen und aktuelle Stufe am Prüfauftrag, Entscheidungen je Stufe (auch in Vertretung), verschickte Eskalationen, Abwesenheiten mit Vertretung |
| `pages.edit_mode`, `edit_mode_locked`, `spaces.default_edit_mode` | Vorschlagsmodus je Seite und Vorgabe je Bereich |
| `user_identities`, `auth_flows` | verknüpfte Anmeldekonten bei Identitätsanbietern (Anbieter, Aussteller, Kennung); kurzlebige, an ein Cookie gebundene Anmeldevorgänge |
| `settings` | Systemeinstellungen je Schlüssel (JSON) und interne Werte (`internal:app:version`, `internal:security:keyCheck`, `internal:templates:removedBuiltins`) |
| `schema_migrations` | angewendete Migrationen mit Zeitpunkt |

**Migrationen:** `server/src/db/migrations/` enthält nummerierte Module
(`001_initial.ts`, …), `MIGRATIONS` in `migrate.ts` listet sie. Neue Felder also nie direkt am Schema
ändern, sondern als neue Migration ergänzen – Hinweise dazu in [ENTWICKLUNG.md](ENTWICKLUNG.md).

### Start, Update und Wiederherstellung

Ein Update darf keine Daten verlieren. Der Start in `createServices()` läuft deshalb in dieser
Reihenfolge ab:

| Schritt | Modul | Wirkung |
| --- | --- | --- |
| 1. Instanzsperre | `db/lock.ts` | Exklusive SQLite-Sperre auf `knowstead.db.lock`. Läuft schon ein Server auf derselben Datenbank, bricht der Start ab. Das Betriebssystem gibt die Sperre auch nach einem Absturz frei – keine veralteten PID-Dateien. Die Kommandozeile darf neben dem Server laufen, solange nichts migriert werden muss. |
| 2. Stand bestimmen | `db/migrate.ts` | `migrationStatus()` vergleicht `schema_migrations` mit `MIGRATIONS`: angewendet, ausstehend, **unbekannt**. Unbekannte Versionen heißen: Die Datenbank stammt von einer neueren Knowstead – `DatabaseVersionError`, außer mit `KNOWSTEAD_ALLOW_DOWNGRADE=1`. |
| 3. Serverschlüssel prüfen | `services.ts` | HMAC-Prüfwert des Schlüssels gegen `internal:security:keyCheck`. Passt er nicht, endet der Start, **bevor** etwas geschrieben wird. |
| 4. Sicherung | `db/upgrade.ts` | Nur bei ausstehenden Migrationen einer bestehenden Datenbank: `VACUUM INTO` nach `backups/backup-…-update` mit Manifest (Schema und Version vorher/nachher), die letzten fünf bleiben. Schlägt die Sicherung fehl, wird nicht migriert. |
| 5. Migrationen | `db/migrate.ts` | Alle ausstehenden Migrationen in **einer** Transaktion – ein Fehler rollt das ganze Update zurück. |
| 6. Dienste | `services.ts` | Dienste aufbauen, Prüfwert festhalten, bei Versionswechsel Ereignis `system.updated` und `internal:app:version` schreiben. |
| 7. Abgeleitete Daten | `search/service.ts` | Hat sich die Klartext-Ableitung geändert (`TEXT_VERSION` größer als `internal:search:textVersion`), werden Suchtext und Kurzfassung aller Seiten aus dem gespeicherten Inhalt neu berechnet und der Index neu aufgebaut – in Blöcken zu 500 Seiten, ohne Migration. |

Weitere Bausteine gegen Datenverlust:

- **Wiederherstellen** (`db/restore.ts`, `npm run cli -- restore`): verlangt die Instanzsperre, prüft die
  Sicherung (`PRAGMA integrity_check`, Knowstead-Schema vorhanden und nicht neuer als das Programm), sichert
  den aktuellen Stand (`backup-…-restore`; ist die Datenbank beschädigt, als unveränderte Dateikopie),
  entfernt `-wal`/`-shm` und ersetzt die Datenbank per Umbenennen. Anhänge werden nur ergänzt.
- **Verzögertes Löschen von Dateien**: Endgültiges Löschen von Seiten, Bereichen und abgelaufenen
  gelöschten Anhängen trägt die Dateien in `file_deletions` ein; die tägliche Wartung entfernt sie nach
  30 Tagen – und nur, wenn kein Anhang mehr auf sie verweist (etwa nach dem Zurückspielen einer Sicherung).
- **Sicherung vor dem Löschen eines Bereichs** (`backup-…-loeschung`, nur Datenbank, die letzten zehn).
- **Sicherungsnamen** (`db/backup-names.ts`): `backup-JJJJMMTT-HHMMSS[-zusatz]`, bei Kollision eine
  Sekunde später – Pfade werden immer gegen dieses Muster geprüft.
- **Programmstand** (`scripts/prepare.mjs`): Prüfsummen über Lockfiles und Quelltexte der Oberfläche in
  `node_modules/.knowstead-install.json` bzw. `web/dist/.knowstead-build.json`; bei Abweichung `npm ci` bzw.
  `npm run build`.
- **Seed-Daten** respektieren Löschungen: Entfernte Standardvorlagen stehen in
  `internal:templates:removedBuiltins` und werden nicht neu angelegt.

**Suche:** `pages_fts` nutzt `unicode61 remove_diacritics 2` und `prefix '2 3 4'` – damit finden
„Anderung“ und „Änderung“ dasselbe, und Präfixsuche ab zwei Zeichen ist schnell. Die Suchsyntax
(`space:`, `label:`, `#eigenschaft>wert`, `-ausschluss`, `"phrase"`) wird in
`modules/search/service.ts` geparst und in eine FTS-Anfrage plus SQL-Filter übersetzt.

Die Suche arbeitet **zweistufig**: Stufe 1 holt aus dem FTS-Index die besten 1 000 Treffer (Unterabfrage
mit `bm25`, danach Join auf `pages`) und liest dabei nur die Spalten für Rechteprüfung, Facetten und
Sortierung. Erst Stufe 2 lädt vollständige Zeilen für die angezeigte Trefferseite; der Textauszug
entsteht in JavaScript (`makeSnippet`) statt über eine zweite FTS-Abfrage. Anhänge werden parallel in
`attachments_fts` gesucht und nach Leserecht der Seite gefiltert.

## Verzeichnisanmeldung (AD/LDAP)

`modules/directory/service.ts` kapselt die gesamte Verzeichnislogik (Bibliothek: `ldapts`):

1. **Suchen** – Anmeldung mit dem Dienstkonto, Benutzersuche über den konfigurierten Filter
   (`{login}` wird maskiert eingesetzt, RFC 4515).
2. **Prüfen** – erneuter Bind mit dem gefundenen DN und dem eingegebenen Passwort. Leere Passwörter
   werden vorher abgewiesen, weil ein LDAP-Bind ohne Passwort als anonyme Anmeldung gilt.
3. **Abgleichen** – `memberOf` (optional inklusive verschachtelter Gruppen über
   `LDAP_MATCHING_RULE_IN_CHAIN`) wird mit den Zuordnungen der Knowstead-Gruppen verglichen; nur Gruppen
   mit hinterlegter Kennung und aktivem Abgleich werden verändert.

`AuthService.login()` versucht das Verzeichnis zuerst (sofern aktiv und das Konto dort geführt wird)
und fällt danach auf das lokale Passwort zurück. Verzeichniskonten haben kein Passwort in der
Datenbank (`users.auth_source = 'ldap'`).

## Single Sign-on

`modules/auth/sso.ts` (`SsoService`) und `sso-routes.ts` ergänzen die Passwort- und Verzeichnisanmeldung:

| Weg | Ablauf |
| --- | --- |
| **OIDC / Entra ID** | `startOidc` erzeugt `state`, `nonce` und PKCE-Verifier, legt sie in `auth_flows` ab (Schlüssel = SHA-256 eines HttpOnly-Cookies `knowstead_sso`, Pfad `/api/v1/auth`, 10 Minuten) und leitet zum Anbieter. `finishOidc` liest den Vorgang über das Cookie, löst den Code mit `openid-client` ein (Discovery zwischengespeichert) und prüft das ID-Token. Kennung ist `oid` (Entra) bzw. `sub`. |
| **SAML 2.0** | `startSaml` erzeugt die AuthnRequest-ID vorab und speichert sie am Vorgang. Der Anbieter postet an `/api/v1/auth/saml/acs` (einzige CSRF-Ausnahme); `@node-saml/node-saml` prüft Signatur, Zielgruppe, Gültigkeit und über einen datenbankgestützten Cache `InResponseTo`, Knowstead zusätzlich den Aussteller. Das Ergebnis landet am Vorgang, angemeldet wird erst in `/saml/finish`, das das SameSite-Cookie wieder mitbringt. |
| **Kerberos** | Ein Reverse-Proxy prüft Kerberos und setzt eine Kopfzeile. `kerberos()` wertet sie nur von eingetragenen Socket-Adressen (`net.BlockList`) und mit optionalem Geheimnis aus; mit Verzeichnisanbindung liefert `directory.lookup()` Profil und Gruppen ohne Passwort. |

`complete()` ordnet die bestätigte Person zu: vorhandene Verknüpfung → Konto gleichen Namens (nur mit
„übernehmen“, nie Administratoren, nie ein zweites Konto desselben Anbieters) → neues Konto. Gruppen
gleicht `directory.syncGroups()` mit denselben Zuordnungen wie beim Active Directory ab. Verknüpfungen
aus dem Profil entstehen über einen per CSRF-Header geschützten POST und enden nur in derselben Sitzung.

## Sprache

Oberflächentexte liegen in `web/src/i18n/de.ts` und `en.ts`. Der Server schreibt deutsch und übersetzt
beim Ausliefern: `core/i18n.ts` bestimmt die Sprache einer Anfrage (`X-Knowstead-Locale`, Profil,
`Accept-Language` nur ohne Sitzung, Standardsprache) und legt sie in `auth.locale` ab. `translate()`
nutzt den Katalog `i18n/en.ts` – exakte Texte und Muster mit `{}` für eingesetzte Werte, spezifischere
Muster zuerst, Werte aus Freitext nur mit ausreichend festem Mustertext. Angewendet wird das auf
Fehlerantworten (`onSend`-Hook), Kataloge, Benachrichtigungen beim Abruf, E-Mails (`renderMail(…, locale)`
mit der Sprache der empfangenden Person), PDF-/Word-Beschriftungen, CSV-Kopfzeilen, Aktivitätsfeed und
Prüfschritte. Handbuch, Vorlagen, Beispielinhalte und Journal wählen die Sprache bei der Einrichtung
bzw. je Person.

## Redaktionsprüfung

`modules/review/service.ts` verwaltet Prüfaufträge:

- `request()` – ausdrückliche Anforderung (benötigt Schreibrecht auf der Seite),
- `onPageSaved()` – wird von `pages.create`/`pages.save` gerufen und setzt die Prüfpflicht eines
  Bereichs um bzw. hebt einen offenen Auftrag auf die neue Version,
- `decide()` – Freigabe oder Rückweisung (benötigt die Bereichsaktion `moderate` – oder die Person ist als
  prüfend eingetragen und hat die Prüfung nicht selbst angefordert; `canDecideReview()`),
- Der Stand liegt redundant an der Seite (`pages.review_status`, `approved_version`) – das hält die
  Anzeige des Seitenkopfs und Listen ohne zusätzliche Abfragen schnell.

**Mehrstufige Freigaben** (`review/workflow.ts`): Der Ablauf eines Bereichs wird beim Anfordern als
Momentaufnahme an den Auftrag gehängt; `decide()` zählt Freigaben je Stufe (`review_decisions`, auch in
Vertretung über `user_deputies`) und schaltet zur nächsten Stufe, `runEscalations()` erinnert stündlich.
Eine neue Version setzt den Auftrag auf Stufe 1 zurück.

**Vorschlagsmodus** (`pages/suggestions.ts`, Editor `web/src/editor/suggestionMode.ts`): Vorschläge sind
Marken `<ins|del data-suggestion>` im Inhalt. Beim Speichern prüft `SuggestionService.review()`, dass
Personen ohne Entscheidungsrecht den Text nur durch neue Vorschläge ändern (Vergleich des Texts ohne
Vorschläge) und fremde Vorschläge nicht entfernen; Autorenangaben neuer Vorschläge setzt der Server.
Suchtext, Anzeige für Lesende und Exporte verwenden `rejectAllSuggestions()`.

**Lesebestätigungen** (`reads/service.ts`): Anforderung mit Zielgruppe und Runde (`cycle_started_at`,
`required_version`); der Status je Person ergibt sich aus der letzten Bestätigung. Erinnerungen laufen
stündlich über `read_reminders` (je Art und Runde einmal).

**Inhaltsanalyse** (`analytics/service.ts`): Aufrufe werden gebündelt je Tag gezählt, Verweise beim
Speichern in `page_refs` ausgewertet (`REFS_VERSION` löst nach Updates eine einmalige Neuberechnung aus).

Für die Rücknahme einzelner Änderungen liefert `revisions.recentChanges()` die jüngsten Versionen
aller sichtbaren Bereiche; `undoChange()` stellt den Stand **vor** einer Version wieder her – als
neue Version, damit nichts verloren geht.

## Aufgabenplaner

`modules/tasks/service.ts` hält Pläne (`task_boards`) und Aufgaben (`tasks`). Rechte kommen
ausschließlich vom Bereich: `view` zum Lesen, `edit` zum Planen, `admin` zum Löschen eines Plans.

- **Spalten** liegen als JSON am Plan (max. 12, Kennungen eindeutig, Farben nur `#rrggbb`). Karten
  aus entfernten Spalten wandern in die erste Spalte.
- **Letzte Spalte = erledigt**: `move()`, `create()` und `update()` halten Spalte, `status`,
  `progress` und `completed_at` synchron – Drag & Drop, Abhaken und Dialog verhalten sich gleich.
- **Reihenfolge** über `position` je Spalte; `move()` nummeriert die Zielspalte neu.
- **Vertraulichkeit**: Verantwortliche müssen den Bereich sehen dürfen (sonst würde die
  Benachrichtigung Interna verraten); die verknüpfte Seite erscheint in Antworten nur für Personen,
  die sie lesen dürfen. `toDto(auth, …)` bekommt deshalb immer den Anfragekontext.
- „Meine Aufgaben“ und das Makro nutzen `query()` über alle sichtbaren Bereiche.
- **Wiederholung**: Wird eine Aufgabe mit `recurrence` erledigt, legt `spawnNext()` die nächste Aufgabe
  der Serie an (Termine verschoben, verpasste Termine übersprungen, Checkliste zurückgesetzt) und nimmt
  die Regel von der erledigten Aufgabe – so entsteht nie eine doppelte Folgeaufgabe.
- **Erinnerungen**: `runReminders()` läuft stündlich ab der Uhrzeit der täglichen Zusammenfassung,
  berücksichtigt den Vorlauf je Person (`preferences.taskReminderDays`) und merkt sich jede Meldung in
  `task_reminders` (je Aufgabe, Art und Termin einmal).
- **Kalender** (`modules/tasks/calendar.ts`): ICS nach RFC 5545 (Maskierung, Zeilenfaltung nach
  75 Oktetten), ganztägige Termine, `REFRESH-INTERVAL` eine Stunde. Der Feed wird mit dem
  `AuthContext` der Person gebaut – er enthält nur, was sie sehen darf.
- **Zeitachse** (`web/src/pages/tasks/TaskTimeline.tsx`): reine Darstellung im Browser; Ziehen ändert
  `startDate`/`dueDate` über dieselbe `PATCH`-Route.

## Wiedervorlage

`modules/pages/reviewcycle.ts` berechnet die Fälligkeit je Seite (`review_due_at`) aus letzter
Bestätigung bzw. Veröffentlichung und dem geltenden Intervall (Seite oder Bereich; Monatsenden werden
begrenzt, 31.01. + 1 Monat = 28./29.02.). Die Fälligkeit liegt als indizierte Spalte an der Seite, damit
Übersicht, Zähler und Erinnerungen ohne Berechnung über alle Seiten auskommen.

- **Bestätigen** setzt `verified_at` und startet das Intervall neu. Dasselbe passiert bei einer nicht
  geringfügigen Veröffentlichung der verantwortlichen Person (`onPageSaved`) und über Ereignisse:
  `review.approved` und `task.completed` einer verknüpften Wiedervorlage-Aufgabe. Eine Menge
  `verifying` verhindert Rückkopplungen (Bestätigen erledigt die Aufgabe, deren Erledigen bestätigt).
- **Erinnerungen** (stündlich, ab der Uhrzeit der Zusammenfassung): „bald fällig“ 14 Tage vorher und
  „überfällig“, je Fälligkeit einmal (`page_review_reminders`). Ist im Bereich ein Plan hinterlegt,
  entsteht bei Überfälligkeit eine Aufgabe mit Stichwort `wiedervorlage` und Seitenverknüpfung.
- Empfänger ist `owner_id`, ersatzweise die zuletzt bearbeitende Person.

## E-Mail

`modules/mail/service.ts` entkoppelt den Versand vollständig von Anfragen:

1. Fachdienste rufen `mail.notify()` bzw. `mail.enqueue()` – das prüft globale Schalter und persönliche
   Einstellungen (`emailMode`: `instant` | `daily` | `off`, `emailOnlyMentions`) und schreibt in
   `mail_queue`.
2. Ein Hintergrundlauf (alle 20 s und sofort nach dem Einreihen) versendet fällige Mails in Stapeln
   über eine wiederverwendete nodemailer-Verbindung, vier parallel.
3. Fehlschläge werden mit wachsendem Abstand (1, 5, 30, 120 Minuten) bis zu fünfmal wiederholt;
   `describeMailError()` (`core/mailer.ts`) übersetzt SMTP-Fehler in verständliche Hinweise.
4. `sendDigests()` bündelt ungelesene Benachrichtigungen der letzten 24 Stunden einmal täglich ab
   `mailDigestHour`.

Nach einem Absturz „hängende“ Mails (`sending`) werden beim Start wieder eingereiht. Vorlagen in
`modules/mail/templates.ts` erzeugen HTML (maskiert, Tabellenlayout für Outlook) und Textfassung.

## Volltextsuche in Anhängen

`modules/attachments/fulltext.ts` sucht Anhänge ohne Eintrag in `attachment_texts` (nach Uploads sofort,
sonst alle zehn Minuten) und schickt sie an einen Worker-Thread (`extract-worker.ts`), Zeitlimit
zwei Minuten je Datei. `textract.ts` liest:

- PDF über pdf.js (Textebene, bis 2 000 Seiten),
- OOXML (`docx`, `xlsx`, `pptx`, `vsdx`) und OpenDocument als ZIP mit XML – entpackt werden nur die
  benötigten Teile mit Größenlimit je Eintrag,
- RTF, HTML und Textformate direkt,
- Altformate (`doc`, `xls`, `ppt`, `vsd`) über die PDF-Umwandlung der Office-Vorschau.

Der Text (höchstens 2 Mio. Zeichen) landet in `attachments_fts`; der Status (`done`, `empty`,
`unsupported`, `failed`) in `attachment_texts`.

## Export nach PDF und Word

`modules/export/` erzeugt Dokumente in drei Schritten:

1. **Sammeln** (`service.ts`): Seite und – auf Wunsch – Unterseiten bis 300 Stück, jeweils mit
   Leserechtprüfung; Bilder werden nur geladen, wenn die Person den zugehörigen Anhang sehen darf
   (einzeln bis 20 MB, zusammen bis 150 MB).
2. **Modell** (`model.ts`): Seiten-HTML wird in ein neutrales Block-Modell übersetzt (Absätze,
   Überschriften, Listen, Tabellen, Hinweisboxen, Code, Bilder); Makros werden aufgelöst oder als Hinweis
   dargestellt, SVG-Grafiken von draw.io und Whiteboard bereinigt. Überschriften werden je Kapitel
   verschoben, damit das Inhaltsverzeichnis stimmt.
3. **Satz** in einem Worker-Thread (`render-worker.ts`, Zeitlimit 180 s): `pdf.ts` mit pdfmake
   (eingebettete Schriften, Ersatzschrift für fehlende Zeichen aus `glyphs.ts`, Kopf-/Fußzeile,
   Inhaltsverzeichnis mit Seitenzahlen), `docx.ts` mit docx (Formatvorlagen, Inhaltsverzeichnis-Feld,
   eigene erste Seite, Seitenzahlfelder).

Die Firmenvorlage liegt in den Einstellungen (`exportTemplate`) und wird in `template.ts` geprüft.

## Import aus anderen Wikis

`modules/transfer/wiki/` enthält je Quelle einen Konverter und einen gemeinsamen Importer:

- `mediawiki.ts` liest XML-Dumps per regulärer Extraktion (speicherschonend, ohne DOM) und wandelt
  Wikitext in Editor-HTML; `dokuwiki.ts` liest das Datenverzeichnis (Seiten, Medien, `attic`/`meta` für
  Versionen); `xwiki.ts` liest XAR-Pakete (XWiki-Syntax 2.x, HTML, Markdown).
- Die Konverter schützen bereits umgewandelte Teile mit Platzhaltern vor weiteren Ersetzungen und
  schreiben interne Verweise zunächst als `/__wiki/<schlüssel>`, Medien als `/__media/<name>`.
- `importer.ts` legt in einem ersten Durchlauf Seiten, Ordnerseiten, Stichwörter, Anhänge und
  Versionen an und ersetzt im zweiten die Platzhalter durch echte Seiten- und Anhangsadressen.
- `jobs.ts` führt Importe nacheinander als Hintergrundaufträge aus (Fortschritt im Speicher, zwei
  Stunden abrufbar).
- **Von der Platte statt aus dem Speicher**: `core/archive-entries.ts` nimmt Uploads als Datenstrom
  entgegen und schreibt sie nach `<Datenverzeichnis>/tmp/import-*` (`receiveUploads`), der Auftrag räumt
  den Ordner am Ende weg, der Serverstart entfernt Reste (`clearUploadTemp`). `core/zip-file.ts` liest
  nur das Inhaltsverzeichnis des Archivs und entpackt Einträge einzeln und erst bei Bedarf (ZIP64,
  Prüfsumme je Eintrag, Obergrenzen für Anzahl, Gesamtgröße und Größe je Eintrag); die Konverter sehen
  das Archiv über die Schnittstelle `ArchiveEntries` (`names`, `read`, `head`, `materialize`). Medien
  reichen sie als `lazyMedia` weiter – geladen wird eine Datei erst, wenn ihr Anhang angelegt wird. Ein
  MediaWiki-Dump wird Seite für Seite aus der Datei gelesen (`fileDump`). So bestimmt nicht mehr die
  Größe des Archivs den Speicherbedarf, sondern die der größten einzelnen Datei.

## Gemeinsame Bearbeitung in Echtzeit

`modules/realtime/collab.ts` hängt am `upgrade`-Ereignis des HTTP-Servers (`ws` im `noServer`-Modus)
und hält je Seite einen Raum mit einem Yjs-Dokument:

- **Protokoll** kompatibel zu `y-websocket`: Sync (`y-protocols/sync`), Awareness und eigene
  Steuerungsnachrichten (JSON). Namen und Farben in der Awareness setzt der Server aus dem Konto.
- **Erstbefüllung im Browser**: Ist ein Raum leer, beauftragt der Server genau einen Client (`init`),
  den veröffentlichten Inhalt einzuspielen – die Umwandlung HTML → ProseMirror-Schema bleibt dort, wo
  das Schema definiert ist. Titel, Symbol, Stichwörter und Breite liegen in der Map `meta`.
- **Persistenz**: Änderungen werden entprellt (1,5 s, spätestens 8 s) als Yjs-Update in
  `collab_documents` gespeichert; ungenutzte Räume werden nach 20 s entladen.
- **Veröffentlichen** läuft über `PUT /pages/:id` mit `collab: true`; `afterSave()` setzt danach die
  Basisversion und meldet `published`. Änderungen von außen führen zu `outdated` (bei ungespeicherten
  Änderungen) oder `restart`.
- **Sicherheit**: Anmeldung aus Cookie oder Token (Umfang `write`), Herkunftsprüfung, Schreibrecht beim
  Verbinden und alle 30 s (auch Sitzung bzw. Token), Grenzen je Raum, Person und Nachricht. Das Dokument
  darf höchstens 32 MB groß werden (`CollabService.limits`); geprüft wird jeweils nach 4 MB empfangener
  Daten, bei Überschreitung endet die Verbindung mit `closed`/`too_large` und Code 1009.

Im Browser verbindet `web/src/editor/collab/session.ts` Dokument, Awareness und Wiederverbindung;
`PageEdit.tsx` fällt nach sechs Sekunden ohne Verbindung auf den klassischen Editor mit Entwürfen zurück.

## Leistung

Für den Betrieb mit vielen Personen (Messwerte im [Administrationshandbuch](ADMINISTRATION.md#betrieb-mit-vielen-personen)):

- **Rechte**: Seiten mit Leseeinschränkungen werden 60 s zwischengespeichert (`viewRestrictedIds`,
  invalidiert bei jeder Änderung an Einschränkungen oder Gruppen). Gibt es keine Leseeinschränkungen,
  entfällt die Prüfung je Seite ganz.
- **Kennzahlen je Bereich** in einer gruppierten Abfrage, im `AuthContext` der Anfrage zwischengespeichert.
- **SQLite**: 64 MB Seitencache, 256 MB Memory-Mapping, zusammengesetzter Index
  `idx_pages_space_status`, `ANALYZE` nach der Migration; vorbereitete Anweisungen in einem LRU-Cache
  (800 Einträge).
- **Seitenaufrufe** werden gesammelt und alle drei Sekunden in einer Transaktion geschrieben.
- **Worker-Threads** für Dokumentsatz, Textgewinnung und den Datenbank-Snapshot der Sicherung – der
  Hauptthread bleibt für Anfragen frei.
- **Auslieferung**: Der Build erzeugt `.br`- und `.gz`-Fassungen, `@fastify/static` liefert sie direkt
  aus (`preCompressed`); Dateien unter `/assets/` sind `immutable`, fehlende antworten mit 404.
- **Oberfläche**: Alle Ansichten werden erst bei Bedarf geladen; beim ersten Aufruf lädt der Browser rund
  170 KB JavaScript (Brotli). Die Seitenansicht wird im Leerlauf vorgeladen (`AppShell`), Editor, Yjs,
  pdf.js, Mermaid und Excalidraw erst beim Öffnen.
- `scripts/loadtest.mjs` erzeugt Testdaten, startet einen eigenen Server und misst Durchsatz sowie
  p50/p95/p99 je Laststufe; mit `--profile <ordner>` entsteht zusätzlich ein CPU-Profil.

## KI-Anbindung

`modules/ai/service.ts` spricht die Anbieter ohne SDK direkt per `fetch` an – so bleibt der Server
abhängigkeitsarm und Anbieter lassen sich leicht ergänzen:

| Anbieter | Endpunkt | Besonderheiten |
| --- | --- | --- |
| Anthropic | `POST {base}/v1/messages` | Header `x-api-key`, `anthropic-version: 2023-06-01`; keine `temperature` (aktuelle Modelle lehnen sie ab), `stop_reason: "refusal"` wird als `422 ai_refusal` gemeldet |
| OpenAI / kompatibel | `POST {base}/v1/chat/completions` | `Authorization: Bearer`, `max_completion_tokens` |
| Azure OpenAI | `POST {base}/chat/completions?api-version=2024-10-21` | Header `api-key`, Modell = Deployment |
| Ollama | `POST {base}/api/chat` | `stream: false`, ohne Schlüssel |

Ablauf von `run()`: aktiviert und eingerichtet? → Recht `ai.use` → Aktion freigeschaltet →
Tageslimit (`ai_usage`) → Inhalt bestimmen (Markierung bzw. Klartext der Seite, **Leserecht wird
immer geprüft**, gekürzt auf 24 000 Zeichen) → Anfrage mit Zeitlimit 60 s und ohne Weiterleitungen →
Protokoll in `ai_usage` und Ereignis `ai.used` (Kategorie `system`, also nur im Audit-Log).

Die Oberfläche (`web/src/lib/ai.tsx`) zeigt Ergebnisse immer erst als Vorschau; Markdown wird mit
DOMPurify bereinigt, bevor es angezeigt oder in den Editor übernommen wird.

## Dateien, Vorschau und Diagramme

- **PDF-Betrachter** (`web/src/components/PdfViewer.tsx`): pdf.js wird erst bei Bedarf geladen,
  ohne WebAssembly (sonst bräuchte die CSP `wasm-unsafe-eval`); Schriften und CMaps liefert
  `/pdfjs/` aus (Vite-Plugin kopiert sie beim Build nach `web/dist/pdfjs`).
- **Office-Vorschau** (`modules/attachments/preview.ts`): LibreOffice (`soffice --headless
  --convert-to pdf`) über `execFile` ohne Shell, mit eigenem Profilverzeichnis, Zeitlimit,
  Größenlimit (60 MB) und Zwischenspeicher `data/previews/<sha256>.pdf`; parallele Anfragen für
  dieselbe Datei teilen sich einen Umwandlungsauftrag. Ausgeliefert wird mit
  `Content-Security-Policy: default-src 'none'; sandbox`.
- **draw.io** (`web/src/editor/views/FileViews.tsx`): Einbettung über das JSON-Protokoll von
  diagrams.net (`embed=1&proto=json`). Nachrichten werden nur vom eigenen iframe und der
  konfigurierten Herkunft angenommen; gespeichert werden `data-xml` (bearbeitbar) und `data-svg`
  (Anzeige, nur `data:image/svg+xml|png;base64`). Die Adresse des Editors (`drawioUrl`) fließt in
  `frame-src` der CSP ein.
- **Whiteboard** (`web/src/editor/views/WhiteboardEditor.tsx`): Excalidraw wird erst beim Öffnen geladen.
  Gespeichert werden die Szene als JSON (bearbeitbar) und ein SVG (Anzeige, Diff, Export). Schriften
  liefert Knowstead selbst aus (`/excalidraw/`, Vite-Plugin kopiert sie beim Build), React wird per
  `resolve.dedupe` nur einmal gebündelt.

## Inhaltsverarbeitung

- **Speicherformat** ist HTML für Rich-Text-Seiten, Markdown-Quelltext für Markdown-Seiten und
  Rohtext für Code-Seiten (`content_type`: `richtext` | `markdown` | `code`).
- **Bereinigung**: `core/html.ts` erlaubt eine feste Liste von Elementen, `data-*`-Attributen und
  Stilen; `iframe` nur für freigegebene Hosts (Administration → Einstellungen).
- **Makros** sind `div`/`span` mit `data-type` und Parametern in `data-*`. Der Server kennt sie für
  Suche, Diff und Export, die Oberfläche rendert sie als TipTap-NodeViews. Die **Galerie** legt ihre
  Bilder als JSON in `data-items` ab; beim Anzeigen werden nur Quellen aus `http(s)`, relativen
  Pfaden und `data:image/...` akzeptiert.
- **Markdown-Brücke**: `core/markdown.ts` wandelt Markdown nach Editor-HTML (inklusive
  GitHub-Hinweisboxen, Aufgabenlisten, Mermaid-Blöcken, `<!-- toc -->`) und über Turndown zurück.
  Das ist die Grundlage für Import, Export und die Handbuch-Auslieferung.
- **Vergleich**: `core/diff.ts` erzeugt für Rich-Text einen Wort-Diff über HTML-Token
  (`<ins>`/`<del>`, Makros als Marker) und für Markdown/Code einen Zeilen-Diff.

## Oberfläche

- **Routing** in `web/src/App.tsx` (React Router, Lazy Loading pro Seite).
  Schema: `/s/:key/p/:id/:slug?`, `/s/:key/edit/:id`, `/s/:key/history/:id`, `/s/:key/diff/:id`,
  `/search`, `/journal`, `/admin/*`.
- **Robustheit**: `lazyPage()` lädt nach einem Update einmalig neu, wenn ein Programmteil nicht mehr
  existiert; `RouteError` fängt Abstürze einer Ansicht ab (`errorElement`), die Navigation bleibt.
  `index.html` enthält eine Startanzeige, die React beim ersten Rendern ersetzt – laden die
  Programmdateien nicht, erscheint nach einigen Sekunden ein Hinweis (reines CSS, CSP-verträglich).
- **Datenzugriff** über TanStack Query (`web/src/api/hooks.ts`); `api.get/post/put/patch/del`
  setzt den CSRF-Header und wirft `ApiError` mit Code und Meldung.
- **Editor**: `web/src/editor/` – `extensions.tsx` stellt Knoten und Marken zusammen, `suggestions.tsx`
  Slash-Menü und `[[Seitenlinks]]`, `views/` enthält die React-NodeViews der Makros
  (`MacroViews`, `EmbedViews`, `FileViews` …). `DocumentView`
  zeigt Inhalte schreibgeschützt mit denselben Komponenten, damit Ansicht und Bearbeitung
  identisch aussehen.
- **Live**: `lib/realtime.tsx` hält eine SSE-Verbindung und verteilt Ereignisse als
  `knowstead:page-event` bzw. Benachrichtigungen im Fenster. Die gemeinsame Bearbeitung nutzt zusätzlich je
  geöffnetem Editor einen WebSocket (`editor/collab/session.ts`, TipTap Collaboration und
  CollaborationCaret).
- **Gestaltung**: CSS-Variablen in `styles/tokens.css`, Themenwechsel über `data-theme`,
  Akzentfarbe aus den Einstellungen. Kopf- und Seitenleiste sind schwebende Glasebenen (`styles/shell.css`),
  Bewegung und 3D-Szene stehen in `motion.css` und `scene.css`. Schriftfarben mit eigenem Token (`--accent-fg`, `--danger-fg` …)
  halten den Kontrast nach WCAG AA in beiden Designs ein.
- **Qualität**: `e2e/` prüft mit Playwright jede Ansicht (lädt fehlerfrei, Barrierefreiheit mit axe-core
  in hell und dunkel) und die wichtigsten Arbeitsabläufe in einem echten Browser.

## Sicherheit

| Thema | Umsetzung |
| --- | --- |
| Passwörter | scrypt (N = 2^15, r = 8, p = 1) mit Zufallssalz, Prüfung im Thread-Pool, ältere Hashes werden beim Anmelden erneuert, gleiche Antwortzeit für unbekannte Konten, Sperre nach konfigurierbarer Fehlversuchszahl |
| Passwort zurücksetzen | Link mit 256-Bit-Geheimnis (nur Hash gespeichert), befristet, einmalig – das Benutzen entwertet alle offenen Links der Person; nicht für Verzeichniskonten |
| Kontenverwaltung | `users.manage` ohne `admin` darf Administratorkonten weder ändern noch sperren, löschen, entsperren, ihr Passwort setzen oder Rücksetz-Links und Einladungen erzeugen (`UserService.requireManageable`) – und allgemein nichts weitergeben, was es selbst nicht hat: Gruppen anlegen/ändern, Mitglieder setzen, Konten in Gruppen anlegen und Konten mit fremden Rechten verwalten brauchen alle dort vergebenen Rechte (`PermissionService.uncovered`, `GroupService.requireDelegable`) |
| Ersteinrichtung | Solange kein Konto existiert, verlangt `POST /setup` den Einrichtungscode aus dem Serverprotokoll (zufällig je Prozess, zeitkonstanter Vergleich) – außer bei Anfragen direkt vom Server: Socket-Adresse localhost und keine Proxy-Header, damit `X-Forwarded-For` nichts vortäuschen kann |
| Registrierung | Mit E-Mail-Versand erst nach Bestätigung der Adresse anmeldbar (`users.registration_pending_at`, Link über `password_resets`), Domain-Beschränkung nur mit E-Mail-Versand, unbestätigte Konten nach 7 Tagen gelöscht; eine vorhandene Adresse wird nicht verraten: gleiche Antwort, gleiche Formfehler, gleiche Rechenzeit, Hinweis-Mail an die Inhaberin (höchstens eine je 10 Minuten, `AuthService.notifyExistingOwner`) |
| Profil | E-Mail-Wechsel nur mit aktuellem Passwort (`AuthService.confirmPassword`) – schützt vor Kontoübernahme über „Passwort vergessen“ |
| Sitzungen | Cookie `knowstead_session` (`HttpOnly`, `SameSite=Lax`; `Secure` bei HTTPS – auch hinter einem Proxy, der `X-Forwarded-Proto: https` setzt), serverseitig als SHA-256 gespeichert, gleitende Gültigkeit, einzeln kündbar |
| HTTP-Header | Content-Security-Policy (nur eigene Skripte), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (keine Kamera, Mikrofon, Standort, Zahlungen, USB …), `Cross-Origin-Opener-Policy: same-origin`; API-Antworten `no-store` |
| API-Referenz | `/api/docs` nur nach Anmeldung (Sitzung oder Token), öffentlich nur bei anonymem Lesezugriff |
| CSRF | Unsichere Methoden brauchen bei Cookie-Sitzungen den Header `X-Knowstead-Client` |
| API-Tokens | Format `knowstead_…`, nur als Hash gespeichert, Umfänge `read`/`write`/`admin`, optional befristet |
| XSS | sanitize-html beim Speichern, erneut beim Ausliefern importierter Versionen, dazu feste Content-Security-Policy |
| Single Sign-on | OIDC mit PKCE, `state`, `nonce` und mandantengebundenem Aussteller; SAML mit signierter Assertion, Aussteller-, Zielgruppen-, Zeit- und `InResponseTo`-Prüfung, keine vom Anbieter angestoßene Anmeldung; jeder Vorgang an ein HttpOnly-Cookie gebunden und einmalig; Verknüpfung über unveränderliche Kennungen statt E-Mail, keine automatische Verknüpfung von Administratoren; Kerberos-Kopfzeile nur von eingetragenen Socket-Adressen mit optionalem Geheimnis; Rücksprungziele nur innerhalb von Knowstead; Geheimnisse verschlüsselt und maskiert |
| Sprache | `X-Knowstead-Locale` nur `de`/`en`; Fehlertexte werden nach der Serialisierung übersetzt, Muster mit Längengrenze und festem Mustertext für Freitextfelder |
| Lesebestätigungen, Freigaben | Anfordern und Nachweise nur mit Bereichsverwaltung; bestätigen nur mit Leserecht und Zugehörigkeit zur Zielgruppe; Vier-Augen-Prinzip auch in Vertretung; CSV gegen Formel-Injektion geschützt |
| Texterkennung | nur `tesseract` als Programm, Aufruf ohne Shell mit Zeitlimit und begrenzter Ausgabe, ein Thread je Aufruf, temporäre Dateien im eigenen Verzeichnis |
| Verzeichnis | Suchfilter maskiert, leere Passwörter abgewiesen, mehrdeutige Treffer abgelehnt, TLS-Zertifikate standardmäßig geprüft; Zuordnung über `objectGUID` – ein wiederverwendeter Anmeldename übernimmt kein fremdes Konto, lokale Administratoren werden nie verknüpft |
| Uploads | Größenlimit, gesperrte Dateiendungen, Auslieferung mit `Content-Disposition` und `nosniff` |
| Geheimnisse | AES-256-GCM mit `KNOWSTEAD_SECRET` bzw. `data/secret.key` (SMTP-Passwort, Konnektoren, Plugin-Passwörter); Prüfwert erkennt einen gewechselten Schlüssel beim Start |
| API-Konnektoren | nur GET auf freigegebene Pfade; Leser erhalten nur die in der Seite hinterlegten Makro-Abfragen, freie Abfragen nur mit Schreibrecht auf der Seite oder `integrations.manage` |
| Papierkorb | Inhalte gelöschter Seiten nur mit Löschrecht, gelöschte Anhänge nur mit Anhangsrecht; endgültig gelöschte Seiten im Aktivitätsfeed nur mit Recht `purge` |
| Webhooks | HMAC-SHA256 über `timestamp.body`, Header `X-Knowstead-Signature` |
| Ratenbegrenzung | Anmeldung, Registrierung und Passwortrouten: 20 Anfragen / 10 Minuten; KI: 30 Anfragen / 5 Minuten plus Tageslimit |
| KI | Recht `ai.use`, Leserecht auf Seiten wird immer geprüft, Schlüssel verschlüsselt, keine Weiterleitungen, Ergebnisse nur nach Bereinigung angezeigt |
| Eingebettete Editoren | draw.io nur von der konfigurierten Herkunft, Nachrichten mit Herkunfts- und Quellprüfung, Bilddaten per Muster geprüft |
| Vorschauen | PDF und HTML-Export mit `sandbox`-CSP; Office-Umwandlung nur mit LibreOffice (`soffice`), ohne Shell, mit Zeit- und Größenlimit, höchstens zwei gleichzeitig, eigenes Profil ohne Makros und externe Verweise |
| Live-Kanal (SSE) | Sitzung, Token, Kontostatus und Rechte alle 25 s neu geprüft, höchstens 20 Verbindungen je Person |
| Echtzeit-Bearbeitung | Herkunftsprüfung (Cross-Site-WebSocket-Hijacking), Token-Umfang `write`, Rechte-, Sitzungs- und Tokenprüfung alle 30 s, Awareness-Namen vom Server, Grenzen je Raum/Person/Nachricht, Dokument höchstens 32 MB |
| Kalender-Abo | 256-Bit-Geheimnis im Link, nur SHA-256 gespeichert, widerrufbar, Feed mit den Rechten der Person, Ratenbegrenzung; Texte nach RFC 5545 maskiert (auch einzelne CR), damit Titel keine Kalenderzeilen einschleusen |
| Redaktionsprüfung | Vier-Augen-Prinzip: Wer eine Prüfung anfordert, kann sie nicht selbst als benannte prüfende Person freigeben |
| Export | Leserecht je Seite und Bild, SVG bereinigt, Satz im Worker mit Zeit- und Speichergrenze, 40 Exporte je Person in 10 Minuten; Audit-CSV gegen Formel-Injektion geschützt |
| Importe | Obergrenzen für Dateianzahl und entpackte Größe (ZIP-Bomben), Inhalte durch dieselbe HTML-Bereinigung, zwei offene Aufträge je Person |
| E-Mail | SMTP-Passwort verschlüsselt, HTML-Vorlagen maskieren alle Werte, Versand nie im Anfrage-Kontext |

## Erweiterungspunkte

| Ziel | Weg |
| --- | --- |
| Neues Fachmodul | Ordner unter `server/src/modules/`, Dienst in `services.ts` registrieren, `routes.ts` in `app.ts` einhängen |
| Freigabe-Workflow anpassen | `modules/review/service.ts` (Zuständigkeit, Benachrichtigungen, Automatik) |
| Neues Makro | Knoten in `web/src/editor/extensions.tsx`, NodeView in `views/`, Eintrag im Slash-Menü, ggf. Serverunterstützung in `modules/pages/macros.ts` |
| Neues Ereignis | `EVENT_TYPES` ergänzen (oder `registerEventType` im Plugin) |
| Fremdsystem lesen | API-Konnektor anlegen und Makro „API-Daten“ verwenden |
| Fremdsystem benachrichtigen | Webhook oder Plugin mit Ereignis-Abonnement |
| Verhalten ändern | Plugin mit Filter-Hook (`page.beforeSave`, `page.render`, …) |

Siehe [PLUGINS.md](PLUGINS.md) für die Plugin-Schnittstelle und [ENTWICKLUNG.md](ENTWICKLUNG.md)
für Konventionen und Abläufe.
