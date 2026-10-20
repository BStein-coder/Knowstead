# REST-API

Knowstead ist vollständig über HTTP steuerbar – alles, was die Oberfläche kann, kann auch ein Skript.
Die interaktive Referenz mit allen Endpunkten läuft im System selbst unter **`/api/docs`**
(OpenAPI 3.0, JSON unter `/api/docs/json`). Sie steht nur angemeldeten Personen bzw. mit API-Token zur
Verfügung – öffentlich nur, wenn der anonyme Lesezugriff eingeschaltet ist.

Dieses Dokument erklärt die Grundlagen und zeigt die typischen Abläufe.

## Inhalt

- [Grundlagen](#grundlagen)
- [Authentifizierung](#authentifizierung)
- [Fehler und Grenzen](#fehler-und-grenzen)
- [Seiten](#seiten)
- [Bereiche](#bereiche)
- [Suche](#suche)
- [Anhänge](#anhänge)
- [Kommentare, Stichwörter, Eigenschaften](#kommentare-stichwörter-eigenschaften)
- [Versionen und Änderungsprotokolle](#versionen-und-änderungsprotokolle)
- [Prüfung und Wiederherstellung](#prüfung-und-wiederherstellung)
- [Wiedervorlage](#wiedervorlage)
- [Aufgabenplaner](#aufgabenplaner)
- [Kalender-Abo (ICS)](#kalender-abo-ics)
- [Export als PDF und Word](#export-als-pdf-und-word)
- [Import aus anderen Wikis](#import-aus-anderen-wikis)
- [Lesebestätigungen](#lesebestätigungen)
- [Freigabeabläufe und Vertretungen](#freigabeabläufe-und-vertretungen)
- [Vorschlagsmodus](#vorschlagsmodus)
- [Inhaltsanalyse](#inhaltsanalyse)
- [Single Sign-on](#single-sign-on)
- [Sprache der Antworten](#sprache-der-antworten)
- [KI-Funktionen](#ki-funktionen)
- [Zwischenablage](#zwischenablage)
- [Administration](#administration)
- [Webhooks](#webhooks)
- [API-Konnektoren](#api-konnektoren)
- [Live-Ereignisse (SSE)](#live-ereignisse-sse)
- [Gemeinsame Bearbeitung (WebSocket)](#gemeinsame-bearbeitung-websocket)
- [Rezepte](#rezepte)

---

## Grundlagen

| | |
| --- | --- |
| Basis-URL | `https://knowstead.example.com/api/v1` |
| Format | JSON (`Content-Type: application/json`), UTF-8 |
| Zeitangaben | ISO-8601 in UTC, z. B. `2026-09-12T08:15:00.000Z` |
| Versionierung | Pfadpräfix `/api/v1`; neue Felder können jederzeit dazukommen |
| Dokumentation | `/api/docs` (Oberfläche), `/api/docs/json` (Schema) – mit Anmeldung oder Token, sonst `401` bzw. Weiterleitung zur Anmeldung |
| Health-Check | `GET /api/v1/health` – ohne Anmeldung |

---

## Authentifizierung

### API-Token (für Skripte und Integrationen)

Tokens werden im **Profil → API-Tokens** erstellt (Recht `api.tokens`) oder von Administratoren für
**Dienstkonten** unter Administration → Benutzer. Der Wert beginnt mit `knowstead_` und wird **nur einmal**
angezeigt. Tokens aus der Zeit, als Knowstead noch „Doku“ hieß (bis 1.9), beginnen mit `doku_` und gelten
weiter.

```bash
curl -H "Authorization: Bearer knowstead_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
     https://knowstead.example.com/api/v1/spaces
```

Umfänge (Scopes):

| Umfang | Erlaubt |
| --- | --- |
| `read` | alle lesenden Anfragen |
| `write` | zusätzlich schreibende Anfragen (POST/PUT/PATCH/DELETE) |
| `admin` | zusätzlich `/api/v1/admin/**` (nur für Konten, die selbst Administrator sind) |

Ein Token hat immer die Rechte seines Benutzers – der Umfang begrenzt sie zusätzlich, er erweitert
sie nie. Tokens können befristet werden und sind unter Administration → Benutzer jederzeit widerrufbar.

### Sitzungs-Cookie (Oberfläche)

`POST /api/v1/auth/login` setzt das Cookie `knowstead_session`. Für Cookie-Sitzungen verlangt der Server
bei schreibenden Anfragen zusätzlich den Header **`X-Knowstead-Client: web`** (CSRF-Schutz). Skripte
verwenden besser ein Token – dort entfällt diese Anforderung.

> Die früheren Namen `X-Doku-Client`, `X-Doku-Locale` und `X-Doku-Proxy-Secret` sowie das Cookie
> `doku_session` nimmt der Server bis einschließlich Version 2 weiter an; mit Version 3 entfallen sie.

```bash
curl -c cookies.txt -X POST https://knowstead.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" -H "X-Knowstead-Client: script" \
  -d '{"login":"anna","password":"geheim"}'
```

### Anonymer Zugriff

Ist unter Administration → Einstellungen „Anonymer Lesezugriff“ aktiv und hat ein Bereich die Rolle
„Anonym: Betrachter“, sind dessen Seiten ohne Anmeldung lesbar.

### Registrierung, Profil und Ersteinrichtung

```bash
# Selbstregistrierung (falls aktiviert). Mit E-Mail-Versand: { "user": null, "pending": true, "email": "…" }
# – angemeldet wird erst über den Link aus der E-Mail; ohne E-Mail-Versand sofort mit Sitzung.
curl -X POST https://knowstead.example.com/api/v1/auth/register \
  -H "Content-Type: application/json" -H "X-Knowstead-Client: script" \
  -d '{"username":"paul","displayName":"Paul","email":"paul@firma.de","password":"…"}'

# Link /verify-email/<token> einlösen (setzt das Sitzungs-Cookie)
curl -X POST https://knowstead.example.com/api/v1/auth/verify-email \
  -H "Content-Type: application/json" -H "X-Knowstead-Client: script" -d '{"token":"…"}'

# Eigene E-Mail-Adresse ändern – bei Konten mit lokalem Passwort nur mit dem aktuellen Passwort
curl -X PATCH https://knowstead.example.com/api/v1/me \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"paul.neu@firma.de","currentPassword":"…"}'
```

| Fehlercode | Bedeutung |
| --- | --- |
| `email_unverified` (403) | Anmeldung vor Bestätigung der E-Mail-Adresse |
| `password_required` / `password_wrong` (400) | E-Mail-Wechsel ohne bzw. mit falschem `currentPassword` |
| `setup_code` (403) | Ersteinrichtung von einem anderen Rechner ohne gültigen Einrichtungscode |

Die **Ersteinrichtung** (`POST /api/v1/setup`) verlangt bei Aufrufen, die nicht vom Server selbst kommen,
das Feld `setupCode` – der Code steht beim Start im Serverprotokoll. `GET /api/v1/setup/status` meldet
dafür `setupCodeRequired`.

---

## Fehler und Grenzen

Fehler kommen immer in derselben Form:

```json
{ "error": { "code": "forbidden", "message": "Keine Berechtigung für diese Aktion", "details": null } }
```

| Status | Code (Beispiele) | Bedeutung |
| --- | --- | --- |
| 400 | `validation`, `bad_request` | Eingabe fehlerhaft (`details` enthält die Feldfehler) |
| 401 | `unauthorized` | keine oder ungültige Anmeldung |
| 403 | `forbidden`, `csrf`, `insufficient_scope` | Recht, CSRF-Header oder Token-Umfang fehlt |
| 404 | `not_found` | Objekt existiert nicht oder ist nicht sichtbar |
| 409 | `conflict` | Versionskonflikt (`baseVersion`) oder Schlüssel bereits vergeben |
| 413 | – | Datei größer als erlaubt |
| 429 | `rate_limited` | zu viele Anfragen (Anmelderouten: 20 in 10 Minuten) |
| 500 | `internal` | unerwarteter Fehler (Details stehen im Serverprotokoll) |

**Listen** liefern `{ items: [...], total: n }` und verstehen `limit` (Standard 25–50, je nach Route)
und `offset`. **Konflikte** beim Speichern vermeidest du, indem du `baseVersion` mitschickst –
passt die Version nicht mehr, antwortet der Server mit `409`.

---

## Seiten

### Anlegen

```bash
curl -X POST https://knowstead.example.com/api/v1/pages \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{
        "spaceKey": "TEAM",
        "parentId": null,
        "title": "Betriebshandbuch",
        "format": "markdown",
        "content": "# Überblick\n\nDieser Text kommt aus einem Skript.\n\n- [ ] Ablauf prüfen\n",
        "labels": ["betrieb", "handbuch"],
        "properties": [{ "name": "status", "value": "entwurf" }]
      }'
```

- `format: "markdown"` wandelt den Inhalt in Editor-HTML um (inklusive Hinweisboxen, Aufgabenlisten,
  Mermaid-Blöcken und `<!-- toc -->`). Ohne `format` wird `content` als HTML verstanden.
- `contentType` steuert den Seitentyp: `richtext` (Standard), `markdown` (Quelltext bleibt Markdown),
  `code` (zusätzlich `language`).
- `status: "draft"` legt einen Entwurf an, der nur für dich sichtbar ist.
- `templateId` füllt die Seite aus einer Vorlage (Platzhalter werden ersetzt).

### Lesen

```bash
# Rohinhalt
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/pages/42"

# zusätzlich fertiges Anzeige-HTML (Makros aufgelöst, Plugins angewandt)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/pages/42?render=true"

# Seite über Bereich + Titel finden (ohne die ID zu kennen)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/pages/find?space=TEAM&title=Betriebshandbuch"
```

Die Antwort enthält neben Inhalt und Metadaten immer `access` – die Rechte des aufrufenden Kontos
auf dieser Seite (`view`, `edit`, `create`, `move`, `delete`, `comment`, `attach`, `restrict`).

### Ändern

```bash
curl -X PUT https://knowstead.example.com/api/v1/pages/42 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{
        "title": "Betriebshandbuch",
        "content": "<h2>Überblick</h2><p>Aktualisiert.</p>",
        "baseVersion": 7,
        "changeNote": "Abschnitt Überblick überarbeitet",
        "minor": false
      }'
```

Jede Änderung erzeugt eine neue Version mit Änderungsnotiz – das ist das Änderungsprotokoll der Seite.
`minor: true` markiert eine Kleinigkeit (keine Benachrichtigung).

Wird die Seite gerade gemeinsam im Editor bearbeitet, erhalten die Bearbeitenden nach einer Änderung
über die API den Hinweis, dass es eine neuere Version gibt. Das Feld `collab: true` setzt nur der
Editor selbst, wenn er aus der gemeinsamen Bearbeitung veröffentlicht – Skripte lassen es weg.

### Anhängen statt Überschreiben

Für Pipelines, die ein Protokoll fortschreiben:

```bash
curl -X POST https://knowstead.example.com/api/v1/pages/42/append \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{
        "format": "markdown",
        "position": "start",
        "content": "## Version 2.3.0 (2026-09-12)\n\n- Neue Suche\n- Fehlerbehebungen\n",
        "changeNote": "Release 2.3.0 aus CI"
      }'
```

### Weitere Seitenoperationen

| Zweck | Aufruf |
| --- | --- |
| Unterseiten | `GET /pages/{id}/children` |
| Verschieben | `POST /pages/{id}/move` `{ "parentId": 12, "index": 0 }` |
| Kopieren | `POST /pages/{id}/copy` `{ "spaceKey": "TEAM", "includeChildren": true }` |
| Duplizieren (am selben Ort, Titel „… (Kopie)“) | `POST /pages/{id}/duplicate` `{ "includeChildren": false, "includeAttachments": true }` |
| In den Papierkorb | `DELETE /pages/{id}` |
| Wiederherstellen | `POST /pages/{id}/restore` |
| Endgültig löschen | `DELETE /pages/{id}/purge` (Dateien der Anhänge bleiben noch 30 Tage auf dem Datenträger) |
| Symbol/Breite | `PATCH /pages/{id}/meta` (ohne neue Version) |
| Einschränkungen | `GET`/`PUT /pages/{id}/restrictions` |
| Backlinks / Verweise | `GET /pages/{id}/backlinks`, `GET /pages/{id}/links`, `GET /pages/{id}/graph` |
| Export | `GET /pages/{id}/export?format=md\|html`, als PDF/Word siehe [Export](#export-als-pdf-und-word) |
| Verantwortung und Wiedervorlage | `PUT /pages/{id}/review-cycle`, `POST /pages/{id}/verify` – siehe [Wiedervorlage](#wiedervorlage) |

---

## Bereiche

```bash
# Bereiche auflisten
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/spaces

# Bereich anlegen
curl -X POST https://knowstead.example.com/api/v1/spaces \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"TEAM","name":"Teamraum","description":"Interne Ablage","icon":"👥"}'

# Seitenbaum (flach, sortiert – ideal für Navigationen)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  https://knowstead.example.com/api/v1/spaces/TEAM/tree

# Änderungsprotokoll des Bereichs als Markdown
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/spaces/TEAM/changelog?format=md&from=2026-08-01"

# Kompletter Export als ZIP (Markdown + Anhänge + Metadaten)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -o team.zip \
  "https://knowstead.example.com/api/v1/spaces/TEAM/export?format=markdown"

# Import (Markdown, HTML oder ZIP)
curl -X POST https://knowstead.example.com/api/v1/spaces/TEAM/import \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  -F "file=@handbuch.md" -F "parentId=12"

# Bereich löschen (Bereichsadministration) – vorher sichert Knowstead die Datenbank
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/spaces/TEAM?confirm=TEAM"
# → { "ok": true, "backup": "backup-20260913-101500-loeschung" }
```

Berechtigungen eines Bereichs liest und setzt `GET`/`PUT /spaces/{key}/permissions`:

```json
{
  "grants": [
    { "subjectType": "group", "subjectId": 2, "role": "editor" },
    { "subjectType": "user",  "subjectId": 7, "role": "admin" },
    { "subjectType": "authenticated", "subjectId": 0, "role": "viewer" },
    { "subjectType": "anonymous", "subjectId": 0, "role": "viewer" }
  ]
}
```

`subjectType`: `user` | `group` | `authenticated` (alle angemeldeten) | `anonymous` (Gäste);
`role`: `viewer` | `commenter` | `editor` | `admin`. Bei `authenticated`/`anonymous` ist `subjectId` 0.

### Kategorien

Kategorien gliedern Navigation und Bereichsverzeichnis. Lesen darf jede angemeldete Person, pflegen
nur die Administration.

```bash
# Kategorien in der festgelegten Reihenfolge: [{ "id": 2, "name": "Abteilungen", "icon": "🏢", "position": 0, "spaceCount": 4 }, …]
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/space-categories

# Anlegen, ändern, sortieren, entfernen (Bereiche einer entfernten Kategorie bleiben erhalten)
curl -X POST https://knowstead.example.com/api/v1/admin/space-categories \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Projekte","icon":"🚀","description":"Laufende Vorhaben"}'
curl -X PATCH https://knowstead.example.com/api/v1/admin/space-categories/3 \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"name":"Laufende Projekte"}'
curl -X PUT https://knowstead.example.com/api/v1/admin/space-categories/order \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"ids":[2,3,1]}'
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/space-categories/3

# Bereich zuordnen ("" = ohne Kategorie)
curl -X PATCH https://knowstead.example.com/api/v1/spaces/IT \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"category":"Abteilungen"}'
```

Beim Umbenennen wandern alle Bereiche mit. Eine unbekannte Kategorie in `category` legt nur ein
Administratorkonto automatisch an; alle anderen erhalten `400`.

---

## Suche

```bash
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  --get https://knowstead.example.com/api/v1/search \
  --data-urlencode 'q=backup "genaue phrase" -test space:TEAM label:anleitung #status=aktiv' \
  --data-urlencode 'limit=20'
```

| Syntax | Wirkung |
| --- | --- |
| `wort` | Volltext (Präfixsuche ab zwei Zeichen) |
| `"genaue phrase"` | exakte Wortfolge |
| `-wort` | schließt Treffer aus |
| `space:KEY` | nur dieser Bereich (mehrfach möglich) |
| `label:name` | nur mit diesem Stichwort |
| `author:@benutzer` | nur von dieser Person |
| `in:title` | nur Titel durchsuchen |
| `#name=wert` | Eigenschaft gleich; auch `>`, `<`, `>=`, `<=`, `!=` |

Zusätzliche Parameter (wirken wie die Filter in der Anfrage): `space`, `label`, `author`,
`type` (`text`/`markdown`/`code`), `updatedAfter` (ISO-Datum), `sort` (`relevance`, `updated`,
`title`), `limit` (max. 100), `offset`.

Die Antwort enthält `items` (Seiten mit markiertem Textauszug), `total`, `facets` (Bereiche, Stichwörter,
Typen) und `attachments` – passende Anhänge nach Dateiname **und Inhalt** (PDF, Office, OpenDocument,
Text):

```json
{
  "id": 81, "filename": "Wartungsvertrag.pdf", "mimeType": "application/pdf", "size": 184233,
  "page": { "id": 42, "title": "Verträge", "url": "/s/IT/p/42/vertraege" },
  "snippet": "… die <mark>Wartung</mark> erfolgt quartalsweise …"
}
```

Es erscheinen nur Anhänge von Seiten, die das Konto lesen darf, jeweils in der neuesten Version.

`tasks` enthält bis zu 20 passende **Aufgaben** aus Plänen der sichtbaren Bereiche – gefunden über
Titel, Beschreibung, Stichwörter und die **Nachrichten im Chat** (Groß- und Kleinschreibung spielt keine
Rolle, auch nicht bei Umlauten). Steckt der Treffer im Chat, nennt `chat` die neueste passende Nachricht,
und `url` führt direkt zu ihr; sonst ist `chat` `null`:

```json
{
  "id": 15, "title": "Tool-Auswahl treffen", "boardId": 3, "boardName": "Ticketsystem-Rollout",
  "spaceKey": "IT", "spaceName": "IT", "status": "doing", "dueDate": "2026-10-15", "overdue": false,
  "assignee": { "id": 7, "username": "anna", "displayName": "Anna Beispiel" }, "labels": ["analyse"],
  "chat": { "id": 88, "author": { "id": 9, "username": "jonas", "displayName": "Jonas Muster" },
            "createdAt": "2026-10-02T09:14:00.000Z",
            "snippet": "… das <mark>Angebot</mark> von Anbieter B liegt vor …" },
  "url": "/s/IT/tasks?board=3&task=15&comment=88"
}
```

`GET /api/v1/search/quick` liefert die schlanke Variante für Auswahlfelder.

---

## Anhänge

```bash
# Hochladen (mehrere Dateien möglich)
curl -X POST https://knowstead.example.com/api/v1/pages/42/attachments \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  -F "file=@diagramm.png"

# Auflisten
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  https://knowstead.example.com/api/v1/pages/42/attachments

# Herunterladen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -o diagramm.png \
  https://knowstead.example.com/api/v1/attachments/8/raw

# Nur einen Ausschnitt (fortgesetzter Download, Springen in Video und Ton)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Range: bytes=1048576-2097151" \
  -o teil.mp4 https://knowstead.example.com/api/v1/attachments/8/raw
```

Gleichnamige Dateien erzeugen eine neue **Version** des Anhangs; die alte bleibt erhalten.
Maximalgröße und gesperrte Dateiendungen stehen in den Systemeinstellungen.

**Auslieferung in Bereichen**: `/raw` meldet `Accept-Ranges: bytes`. Mit einer `Range`-Kopfzeile
antwortet der Server mit `206` und `Content-Range`, bei einem Bereich außerhalb der Datei mit `416`.
Ohne oder mit unverständlicher Angabe kommt die ganze Datei. Nötig für Video und Ton (Springen) und
für Downloads, die fortgesetzt werden sollen.

**Vorschau als PDF**: Jeder Anhang meldet im Feld `preview`, ob er sich im Browser anzeigen lässt
(`"pdf"`, `"office"` oder `null`), und liefert dazu `previewUrl`.

```bash
# PDF direkt, Office-/Visio-Dateien werden serverseitig mit LibreOffice umgewandelt (Zwischenspeicher)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -o vorschau.pdf \
  https://knowstead.example.com/api/v1/attachments/8/preview
```

Ohne eingerichtete Office-Vorschau antwortet der Endpunkt für Office-Dateien mit `501 preview_unavailable`.
Die Antwort trägt `Content-Security-Policy: default-src 'none'; sandbox`.

---

## Kommentare, Stichwörter, Eigenschaften

```bash
# Kommentar schreiben (Antwort mit "parentId")
curl -X POST https://knowstead.example.com/api/v1/pages/42/comments \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"<p>Bitte noch die Rufnummern ergänzen.</p>"}'

# Stichwörter ersetzen
curl -X PUT https://knowstead.example.com/api/v1/pages/42/labels \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"labels":["betrieb","handbuch","2026"]}'

# Eigenschaften ersetzen
curl -X PUT https://knowstead.example.com/api/v1/pages/42/properties \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"properties":[{"name":"status","value":"freigegeben"},{"name":"review","value":"2026-12-01","type":"date"}]}'
```

Eigenschaften sind die Grundlage für den Makro „Eigenschaften-Bericht“ und für `#name=wert` in der Suche.

Stichwörter systemweit pflegen (nur Administration):

```bash
# Umbenennen – existiert das Ziel schon, werden beide zusammengeführt
curl -X POST https://knowstead.example.com/api/v1/labels/rename \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"from":"howto","to":"anleitung"}'
# → { "pages": 12, "merged": true }

# Von allen Seiten entfernen
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" \
  https://knowstead.example.com/api/v1/labels/veraltet
```

---

## Versionen und Änderungsprotokolle

```bash
# Versionsliste
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/revisions

# Eine bestimmte Version
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/revisions/5

# Unterschied zwischen zwei Versionen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/pages/42/diff?from=5&to=7"

# Version wiederherstellen (erzeugt eine neue Version)
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  https://knowstead.example.com/api/v1/pages/42/revisions/5/restore
```

Für Auswertungen über mehrere Seiten hinweg: `GET /api/v1/activity` (globaler Feed, filterbar nach
`space` (Schlüssel), `user` (Benutzername), `before` (Ereignis-ID für Blättern), `limit`) und
`GET /api/v1/spaces/{key}/changelog` (`from`, `to`, `minor`, `pageId`, `limit`, `format=json|md`).
Administratoren bekommen unter `GET /api/v1/admin/audit` zusätzlich sicherheitsrelevante Ereignisse.

---

## Prüfung und Wiederherstellung

```bash
# Prüfung für eine Seite anfordern (optional mit prüfender Person)
curl -X POST https://knowstead.example.com/api/v1/pages/42/reviews \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"note":"Bitte Abschnitt 2 gegenlesen","reviewerId":7}'

# Offene Prüfaufträge (mine=true: nur solche, die ich entscheiden darf)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/reviews?status=open&mine=true"

# Freigeben oder zurückweisen – mit Recht „Moderieren“ im Bereich oder als eingetragene prüfende Person
# (nicht bei selbst angeforderten Prüfungen: Vier-Augen-Prinzip, sonst 403)
curl -X POST https://knowstead.example.com/api/v1/reviews/3/decision \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"approve":false,"note":"Bitte Quellen ergänzen"}'

# Prüfverlauf einer Seite
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/reviews
```

Der Prüfstand steht auch in jeder Seitenantwort unter `review`:

```json
{
  "review": {
    "status": "pending",
    "openId": 3,
    "approvedVersion": 7,
    "approvedAt": "2026-09-12T08:15:00.000Z",
    "approvedBy": { "id": 1, "username": "ada", "displayName": "Ada Admin" },
    "canDecide": true,
    "required": true
  }
}
```

**Letzte Änderungen** mit Rücknahme:

```bash
# Die letzten 50 Änderungen aller sichtbaren Bereiche
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/changes?limit=50&space=TEAM"

# Eine Änderung zurücknehmen (erzeugt eine neue Version mit dem alten Stand)
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  https://knowstead.example.com/api/v1/changes/812/undo
```

---

## Wiedervorlage

Seiten können eine verantwortliche Person und ein Prüfintervall haben; ohne eigenes Intervall gilt die
Vorgabe des Bereichs. Der aktuelle Stand steht in jeder Seitenantwort unter `reviewCycle`:

```json
"reviewCycle": {
  "owner": { "id": 7, "username": "anna", "displayName": "Anna Beispiel", "avatarColor": null },
  "intervalMonths": 12, "pageIntervalMonths": null, "spaceIntervalMonths": 12,
  "verifiedAt": "2025-10-01T08:12:00.000Z",
  "verifiedBy": { "id": 7, "username": "anna", "displayName": "Anna Beispiel", "avatarColor": null },
  "dueAt": "2026-10-01T08:12:00.000Z", "state": "due",
  "responsible": { "id": 7, "username": "anna", "displayName": "Anna Beispiel", "avatarColor": null },
  "canVerify": true, "canConfigure": true
}
```

`state`: `none` (keine Wiedervorlage), `ok`, `due` (innerhalb von 14 Tagen fällig), `overdue`.

```bash
# Verantwortliche Person und eigenes Intervall setzen (intervalMonths: 0 = keine, null = Vorgabe des Bereichs)
curl -X PUT https://knowstead.example.com/api/v1/pages/42/review-cycle \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"ownerId":7,"intervalMonths":12}'

# Seite als aktuell bestätigen – startet das Intervall neu, erledigt verknüpfte Wiedervorlage-Aufgaben
curl -X POST https://knowstead.example.com/api/v1/pages/42/verify \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"note":"Geprüft, unverändert gültig"}'

# Fällige und überfällige Seiten: { "items": [ … ], "counts": { "overdue": 3, "due": 5, "ok": 40 } }
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/content-reviews?scope=all&state=overdue&space=IT"

# Vorgabe des Bereichs, optional mit Plan für automatisch angelegte Prüfaufgaben
curl -X PUT https://knowstead.example.com/api/v1/spaces/IT/review-cycle \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"intervalMonths":12,"boardId":3}'
```

| Parameter | Werte |
| --- | --- |
| `intervalMonths` | `0`, `1`, `3`, `6`, `12`, `24`, `36` (Seite zusätzlich `null` = Vorgabe des Bereichs) |
| `scope` | `mine` (Standard: Seiten, für die man verantwortlich ist) oder `all` (alle sichtbaren) |
| `state` | `attention` (Standard: fällig und überfällig), `overdue`, `due`, `all` |

Festlegen dürfen Personen mit Schreibrecht auf der Seite (Bereichsvorgabe: Bereichsadministration);
bestätigen dürfen die verantwortliche Person und alle mit Schreibrecht. Benachrichtigungen:
`page.review_due`, `page.review_overdue`, `page.owner_assigned`.

---

## Aufgabenplaner

Pläne gehören zu einem Bereich. Lesen darf, wer den Bereich sehen darf; anlegen, ändern und
verschieben darf, wer dort bearbeiten darf. Die **letzte Spalte** gilt als „erledigt“.

```bash
# Plan anlegen (ohne "buckets" gibt es: todo, doing, review, done)
curl -X POST https://knowstead.example.com/api/v1/spaces/IT/boards \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Ticketsystem-Rollout","description":"Einführung Q4"}'

# Pläne eines Bereichs bzw. aller sichtbaren Bereiche
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/spaces/IT/boards
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/boards

# Plan mit allen Aufgaben: { "board": {…}, "tasks": [ … ] }
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/boards/3

# Spalten ändern (Karten aus entfernten Spalten wandern in die erste Spalte)
curl -X PATCH https://knowstead.example.com/api/v1/boards/3 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"buckets":[{"id":"backlog","name":"Backlog","color":"#64748b"},{"id":"done","name":"Fertig","color":"#16a34a"}]}'

# Aufgabe anlegen
curl -X POST https://knowstead.example.com/api/v1/boards/3/tasks \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Tool-Auswahl treffen","bucket":"todo","assigneeId":7,"dueDate":"2026-10-15",
       "priority":"high","pageId":42,"labels":["analyse"],"checklist":[{"text":"Angebote einholen"}]}'

# Ändern (nur gesendete Felder), verschieben, löschen
curl -X PATCH https://knowstead.example.com/api/v1/tasks/15 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"status":"done"}'
curl -X POST https://knowstead.example.com/api/v1/tasks/15/move \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"bucket":"review","index":0}'
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/tasks/15

# Abhängigkeiten: wartet auf Aufgabe 14 (FS = Ende → Anfang, SS, FF, SF; lagDays = Versatz in Tagen).
# Die Liste ersetzt alle Vorgängerinnen; [] entfernt sie. Mit automatischer Terminplanung des Plans
# (PATCH /api/v1/boards/3 {"autoSchedule": true}) rücken wartende Aufgaben nach.
curl -X PATCH https://knowstead.example.com/api/v1/tasks/15 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"predecessors":[{"taskId":14,"type":"FS","lagDays":1}]}'
# Aufgaben enthalten "predecessors", "successors" und "blocked" (offene Vorgängerin vorhanden)

# Filtern über alle sichtbaren Bereiche – z. B. meine offenen, bis Monatsende fälligen Aufgaben
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/tasks?assignee=me&status=open-all&dueBefore=2026-10-31"
# Zeitraum (beide Grenzen einschließlich; Aufgaben ohne Fälligkeit gehören nie dazu) – so lädt der Kalender seinen Monat
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/tasks?dueFrom=2026-10-01&dueBefore=2026-10-31&limit=500"
# Terminzeitraum (Beginn bis Fälligkeit; fehlt eines, zählt das andere als einziger Tag): alles, was den Ausschnitt berührt
# oder ganz überspannt – so lädt der Kalender seinen Monat, damit auch lange Aufgaben als Balken erscheinen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "https://knowstead.example.com/api/v1/tasks?spanFrom=2026-10-01&spanTo=2026-10-31&limit=500"

# Projekte: alle Pläne der sichtbaren Bereiche mit Kennzahlen, nächstem Termin und Beteiligten (Übersicht „Projekte“)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/projects
# { "items": [ { …Plan…, "spaceIcon": "🚀", "spaceColor": "#2563eb",
#     "summary": { "doing": 2, "nextTask": { "id": 15, "title": "…", "dueDate": "2026-10-15" },
#                  "startDate": "2026-09-01", "dueDate": "2026-12-18",
#                  "assignees": [ { "id": 7, … } ], "assigneeCount": 4, "updatedAt": "…" } } ] }
```

| Feld | Werte |
| --- | --- |
| `priority` | `low`, `normal`, `high`, `urgent` |
| `status` | `open`, `doing`, `done` (Filter zusätzlich `open-all` = alles außer erledigt) |
| `progress` | 0–100 (erledigt setzt 100) |
| `dueDate`, `startDate` | `YYYY-MM-DD` |
| `assigneeId` | Person mit Lesezugriff auf den Bereich, sonst `400` |
| `recurrence` | `{"freq":"daily\|weekly\|monthly\|yearly","interval":1}` (1–52) oder `null` |
| `page` (Antwort) | verknüpfte Seite – nur, wenn die anfragende Person sie sehen darf |

**Wiederkehrende Aufgaben**: Wird eine Aufgabe mit `recurrence` erledigt, legt Knowstead die nächste Aufgabe
der Serie in der ersten Spalte an – Termine um das Intervall verschoben (verpasste Termine werden
übersprungen), Checkliste zurückgesetzt. Die Wiederholung wandert zur neuen Aufgabe. „Alle 2 Wochen“
ist `{"freq":"weekly","interval":2}`, „vierteljährlich“ `{"freq":"monthly","interval":3}`.

**Chat je Aufgabe**: `GET /api/v1/tasks/{id}/comments` liefert die Nachrichten, `POST` schreibt eine
(`{"body":"<p>…</p>"}`, ab der Rolle *Kommentieren*), `PATCH`/`DELETE /api/v1/task-comments/{id}` ändern
und löschen. Aufgaben tragen `commentCount` und `unreadComments` – die Zahl der Nachrichten anderer seit
dem letzten Blick der anfragenden Person in den Chat. `POST /api/v1/tasks/{id}/comments/read` setzt
diesen Lesestand (die Oberfläche ruft das beim Öffnen des Chats auf); eigene Nachrichten zählen nie als
ungelesen.

Ereignisse für Webhooks: `task.board_created`, `task.board_deleted`, `task.created`, `task.updated`,
`task.completed`, `task.deleted`. Verantwortliche erhalten eine Benachrichtigung bei Zuweisung, vor
der Fälligkeit (`task.due`, Vorlauf je Person im Profil) und bei Überfälligkeit (`task.overdue`).

---

## Kalender-Abo (ICS)

Kalenderprogramme können sich nicht anmelden. Jede Person erzeugt deshalb einen **geheimen Link**, der
ohne Anmeldung funktioniert und genau das zeigt, was die Person sehen darf.

```bash
# Link erzeugen (ersetzt einen bestehenden – der alte wird ungültig): { "url": "https://…/api/v1/calendar/<geheimnis>.ics", "webcal": "webcal://…" }
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/me/calendar

# Status { "active": true, "createdAt": "…", "lastUsedAt": "…" } und widerrufen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/me/calendar
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/me/calendar

# Feed abrufen: eigene offene Aufgaben mit Fälligkeit und eigene Wiedervorlagen …
curl "https://knowstead.example.com/api/v1/calendar/<geheimnis>.ics"
# … oder alle offenen Aufgaben eines Plans (Team-Kalender)
curl "https://knowstead.example.com/api/v1/calendar/<geheimnis>.ics?board=3"
```

Aufgaben erscheinen als ganztägige Termine (von Beginn bis Fälligkeit) mit Link in Knowstead, Wiedervorlagen
am Fälligkeitstag. Der Feed empfiehlt Kalenderprogrammen eine stündliche Aktualisierung. Gespeichert
wird nur ein Hash des Geheimnisses; der Link lässt sich nicht wieder anzeigen, nur neu erzeugen.

---

## Export als PDF und Word

```bash
# Seite als PDF – mit Unterseiten, Deckblatt und Inhaltsverzeichnis
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -o betriebshandbuch.pdf \
  "https://knowstead.example.com/api/v1/pages/42/export/document?format=pdf&children=true&cover=true&toc=true"

# Als Word-Dokument ohne Deckblatt
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -o protokoll.docx \
  "https://knowstead.example.com/api/v1/pages/42/export/document?format=docx&cover=false"

# Ganzer Bereich als Handbuch: Startseite des Bereichs mit allen Unterseiten
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -o it-handbuch.pdf \
  "https://knowstead.example.com/api/v1/pages/$(curl -s -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/spaces/IT | jq .homePageId)/export/document?format=pdf&children=true"
```

| Parameter | Bedeutung |
| --- | --- |
| `format` | `pdf` oder `docx` (Pflicht) |
| `children` | Unterseiten einbeziehen (höchstens 300 Seiten; nur Seiten, die das Konto lesen darf) |
| `cover`, `toc` | Deckblatt bzw. Inhaltsverzeichnis – ohne Angabe gilt die Firmenvorlage |

Gestaltung (Logo, Farbe, Kopf- und Fußzeile) kommt aus der Firmenvorlage: `GET /api/v1/export/template`
liefert die Voreinstellungen, geändert wird sie über `PUT /api/v1/admin/settings` (`exportTemplate`).
`POST /api/v1/admin/export-template/sample` mit `{"format":"pdf","template":{…}}` erzeugt ein
Musterdokument mit einer ungespeicherten Vorlage. Exporte sind auf 40 je Person in 10 Minuten
begrenzt (`429`).

---

## Import aus anderen Wikis

MediaWiki, DokuWiki und XWiki werden als **Hintergrundauftrag** importiert. Voraussetzung ist das
Recht, im Bereich Seiten anzulegen.

```bash
# Hochladen – Antwort 202 mit dem Auftrag
curl -X POST https://knowstead.example.com/api/v1/spaces/IT/import/wiki \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  -F "file=@mediawiki-export.zip" -F "format=auto" -F "history=true" -F "parentId=12"

# Fortschritt abfragen, bis state "done" oder "failed" ist
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/imports/3f6c…
```

| Feld | Werte |
| --- | --- |
| `file` | MediaWiki-XML oder ZIP mit XML und Dateien, DokuWiki-Ordner `data` als ZIP, XWiki-XAR |
| `format` | `auto` (Standard), `mediawiki`, `dokuwiki`, `xwiki` |
| `history` | `true` übernimmt bis zu 50 ältere Versionen je Seite |
| `parentId` | optionale Seite, unter der die importierten Seiten landen |

Antwort von `GET /api/v1/imports/{id}` (sichtbar für die Person, die den Import gestartet hat, und für
Administratoren; zwei Stunden nach Abschluss verworfen):

```json
{
  "id": "3f6c…", "format": "mediawiki", "state": "done", "phase": "done", "done": 214, "total": 214,
  "createdAt": "2026-09-13T09:30:00.000Z", "finishedAt": "2026-09-13T09:31:12.000Z",
  "space": { "id": 4, "key": "IT", "name": "IT" },
  "report": {
    "pages": 180, "folders": 12, "attachments": 96, "revisions": 1240, "unresolvedLinks": 7,
    "missingMedia": ["Altes_Logo.png"], "unusedMedia": 3, "skipped": [], "warnings": [],
    "root": [{ "id": 512, "title": "Hauptseite", "url": "/s/IT/p/512/hauptseite" }]
  },
  "error": null
}
```

`state`: `queued`, `running`, `done`, `failed`. Höchstens zwei offene Aufträge je Person (`429`),
höchstens 20 000 Seiten je Import. Eine hochgeladene Datei darf 2 GB groß sein (`413` darüber),
Archive entpackt 8 GB mit 100 000 Dateien. Der Upload wird auf die Platte des Servers geschrieben und
von dort stückweise gelesen; fehlt der Platz dafür, antwortet der Server mit `507`.

---

## KI-Funktionen

Voraussetzungen: KI in der Administration aktiviert, Recht `ai.use`, Aktion freigeschaltet.

```bash
# Verfügbarkeit und verbleibendes Tageslimit
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/ai/status

# Seite zusammenfassen
curl -X POST https://knowstead.example.com/api/v1/ai/run \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"summarize","pageId":42}'

# Frage an eine Seite
curl -X POST https://knowstead.example.com/api/v1/ai/run \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ask","pageId":42,"question":"Wer ist für die Sicherung verantwortlich?"}'

# Text übersetzen
curl -X POST https://knowstead.example.com/api/v1/ai/run \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"translate","text":"Die Sicherung läuft nachts.","language":"Englisch"}'
```

| Aktion | Eingabe | Antwort |
| --- | --- | --- |
| `summarize`, `improve`, `shorten`, `outline` | `text` oder `pageId` | `text` (Markdown) |
| `translate` | `text` oder `pageId`, `language` | `text` |
| `ask` | `pageId` (oder `text`), `question` | `text` |
| `tags`, `title`, `tasks` | `text` oder `pageId` | `text` und `items` (Liste) |

Optional nimmt jede Aktion eine `instruction` zum Nachbessern („förmlicher“, „als Tabelle“).
Die Antwort enthält außerdem `model`, `provider`, `usage` (Token, Dauer) und `remaining`.
Wird `pageId` angegeben, prüft Knowstead immer die Leserechte – auch wenn zusätzlich `text` gesendet wird.

| Status | Code | Bedeutung |
| --- | --- | --- |
| 400 | `bad_request` | KI nicht aktiv, unvollständig eingerichtet oder Aktion nicht freigeschaltet |
| 403 | `forbidden` | Recht `ai.use` fehlt |
| 404 | `not_found` | Seite existiert nicht oder ist für die Person nicht sichtbar |
| 422 | `ai_refusal` | Das Modell hat die Anfrage abgelehnt |
| 429 | `ai_limit`, `rate_limited` | Tageslimit der Person erreicht bzw. mehr als 30 Anfragen in 5 Minuten |
| 502 | `ai_error` | Anbieter nicht erreichbar oder Fehler beim Anbieter |

---

## Zwischenablage

Persönliche Ablage für Ausschnitte – nur für die eigene Person sichtbar, HTML wird bereinigt,
Links nur mit `http(s)`, `mailto` oder internen Pfaden. Nicht angeheftete Einträge über 50 werden entfernt.

```bash
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/clips
curl -X POST https://knowstead.example.com/api/v1/clips \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"html","content":"<p>Rufbereitschaft: 0800 123</p>","sourcePageId":42}'
curl -X PATCH https://knowstead.example.com/api/v1/clips/5 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"pinned":true}'
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/clips/5
# Alle nicht angehefteten entfernen → { "removed": 3 }
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/clips
```

---

## Administration

Alle Endpunkte unter `/api/v1/admin/**` verlangen ein Administratorkonto **und** ein Token mit dem
Umfang `admin`.

```bash
# Benutzer anlegen
curl -X POST https://knowstead.example.com/api/v1/admin/users \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"anna","displayName":"Anna Beispiel","email":"anna@example.com","password":"…","groupIds":[2]}'

# Dienstkonto mit Token (für Automatisierungen ohne Personenbezug)
curl -X POST https://knowstead.example.com/api/v1/admin/users \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"ci-bot","displayName":"CI-Bot","kind":"bot"}'
curl -X POST https://knowstead.example.com/api/v1/admin/users/9/tokens \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Pipeline","scopes":["read","write"]}'

# Kennzahlen, Systeminfo (u. a. version, dataDir, service, logFile), Audit-Log
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/stats
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/system

# Nächste Schritte nach der Ersteinrichtung – z. B. für eine Überwachung
# → { "items": [{ "id": "backup", "state": "open", "link": "/admin/backups", … }], "done": 4, "total": 6, "dismissed": false }
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/setup-checklist
# Hinweis in der Übersicht ausblenden (false blendet ihn wieder ein)
curl -X PUT https://knowstead.example.com/api/v1/admin/setup-checklist \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"dismissed":true}'
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -o audit.csv \
  "https://knowstead.example.com/api/v1/admin/audit.csv?category=security&from=2026-06-01"

# Betriebswarnungen (Sicherung, Speicherplatz, fehlender Neustart) und ob E-Mails hinausgehen
# → { "alerts": [{ "id": "disk", "severity": "warn", "title": "…", "message": "…", "hint": "…", "since": "…" }],
#     "mail": { "enabled": true, "configured": true, "recipients": 2 } }
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/alerts
# Testwarnung an alle Empfänger → { "recipients": 2 }
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/alerts/test
# Für Überwachungssysteme: ok, warn oder error samt Messwerten – Administratorkonto, Token-Umfang "read" genügt;
# mit ?strict=true antwortet der Server bei warn und error mit 503
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/monitoring?strict=true"

# Sicherung anstoßen und herunterladen
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" \
  https://knowstead.example.com/api/v1/admin/backups
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -O -J \
  https://knowstead.example.com/api/v1/admin/backups/knowstead-2026-09-12.zip/download

# Verzeichnis (AD/LDAP) prüfen und Gruppen suchen
curl -X POST https://knowstead.example.com/api/v1/admin/directory/test \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"login":"anna"}'
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" \
  "https://knowstead.example.com/api/v1/admin/directory/groups?q=knowstead"
# Gruppenmitgliedschaften eines Verzeichniskontos neu abgleichen
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" \
  https://knowstead.example.com/api/v1/admin/directory/sync/9

# Aufgaben: mehrere auf einmal ändern oder in den Papierkorb legen (alles oder nichts, höchstens 100)
curl -X POST https://knowstead.example.com/api/v1/tasks/bulk   -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json"   -d '{"ids":[12,13,14],"patch":{"assigneeId":7,"priority":"high"}}'

# Papierkorb des Bereichs, wiederherstellen, endgültig löschen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/spaces/TEAM/task-trash

# Chat je Aufgabe: Nachrichten lesen, schreiben (HTML; @-Erwähnungen als <span data-type="mention" data-id="…">), ändern, löschen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/tasks/12/comments
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"<p>Stand: Kabel liegen, <span data-type=\"mention\" data-id=\"7\" data-label=\"Mia\">@Mia</span> bitte prüfen</p>"}' \
  https://knowstead.example.com/api/v1/tasks/12/comments
curl -X PATCH -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"body":"<p>korrigiert</p>"}' https://knowstead.example.com/api/v1/task-comments/3
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/task-comments/3
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/tasks/12/restore
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/tasks/12/purge

# Plan als CSV (Semikolon und BOM – Excel öffnet die Datei direkt richtig)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -O -J https://knowstead.example.com/api/v1/boards/3/export.csv

# Wartungsaufgabe: reindex | reindex-attachments | vacuum | purge-trash | prune-events | cleanup-sessions | sync-handbook
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" \
  https://knowstead.example.com/api/v1/admin/maintenance/reindex

# Stand der Volltextindexierung von Anhängen
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/attachments/index

# E-Mail: SMTP-Anmeldung prüfen, Test-E-Mail, Versandprotokoll, erneut senden
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/mail/verify
curl -X POST https://knowstead.example.com/api/v1/admin/mail/test \
  -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"to":"it@example.com"}'
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" "https://knowstead.example.com/api/v1/admin/mail?status=failed&limit=50"
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/mail/17/retry
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/mail/retry-failed

# Einladung mit Link zum Festlegen des Passworts per E-Mail
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/users/9/invite
# Anmeldesperre aufheben bzw. unbestätigte Selbstregistrierung freischalten
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/users/9/unlock

# KI-Verbindung testen und Nutzung der letzten 30 Tage abrufen
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/ai/test
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/ai/usage

# Status der Office-Vorschau (LibreOffice gefunden?)
curl -H "Authorization: Bearer $KNOWSTEAD_ADMIN_TOKEN" https://knowstead.example.com/api/v1/admin/office-preview
```

Die KI wird wie alle Einstellungen über `PUT /api/v1/admin/settings` konfiguriert
(`{"ai": {"enabled": true, "provider": "anthropic", "model": "claude-opus-5", "apiKey": "…"}}`);
der Schlüssel wird verschlüsselt gespeichert und beim Lesen maskiert. Ebenso E-Mail
(`emailNotifications`, `mailDigestHour`, `smtp: { host, port, security: "starttls"|"tls"|"none", user,
password, from, replyTo, rejectUnauthorized }`), Echtzeit-Bearbeitung (`realtimeCollaboration`) und
Firmenvorlage (`exportTemplate: { company, logo, primaryColor, font, coverPage, toc, headerText,
footerText, classification, paper }`).

---

## Webhooks

Administration → Webhooks. Ein Webhook hat eine Ziel-URL, eine Liste von Ereignismustern
(`page.*`, `comment.created`, `*`), optional einen Bereichsfilter, eigene Header und ein
Signaturgeheimnis.

### Zustellung

`POST` mit JSON-Körper und diesen Kopfzeilen:

| Header | Inhalt |
| --- | --- |
| `X-Knowstead-Event` | Ereignistyp, z. B. `page.updated` |
| `X-Knowstead-Delivery` | eindeutige UUID der Zustellung |
| `X-Knowstead-Timestamp` | Unix-Zeit in Sekunden |
| `X-Knowstead-Signature` | `sha256=<HMAC>` über `"<timestamp>.<body>"` |
| `User-Agent` | `Knowstead-Webhooks/<version>` |

Für Empfänger aus der Zeit vor Version 2.0 stehen dieselben Werte zusätzlich in `X-Doku-Event`,
`X-Doku-Delivery`, `X-Doku-Timestamp` und `X-Doku-Signature` – bis einschließlich Version 2.

Körper:

```json
{
  "id": "evt_1234",
  "event": "page.updated",
  "label": "Seite aktualisiert",
  "createdAt": "2026-09-12T08:15:00.000Z",
  "instance": { "name": "Knowstead", "url": "https://knowstead.example.com" },
  "actor": { "id": 3, "username": "anna", "displayName": "Anna Beispiel" },
  "space": { "id": 2, "key": "TEAM", "name": "Teamraum" },
  "page": { "id": 42, "title": "Betriebshandbuch", "url": "https://knowstead.example.com/s/TEAM/p/42/betriebshandbuch", "version": 8 },
  "target": { "type": "page", "id": "42", "label": "Betriebshandbuch" },
  "data": { "changeNote": "Abschnitt Überblick überarbeitet", "minor": false }
}
```

Antwortet der Empfänger nicht mit 2xx, wiederholt Knowstead die Zustellung nach **10 s, 60 s und 300 s**.
Nach 25 aufeinanderfolgenden Fehlschlägen wird der Webhook automatisch deaktiviert. Das
Zustellprotokoll (Status, Antwort, Dauer, Versuch) steht in der Oberfläche und unter
`GET /api/v1/admin/webhooks/{id}/deliveries`; einzelne Zustellungen lassen sich wiederholen.

### Signatur prüfen

```js
import crypto from 'node:crypto';

export function verify(req, rawBody, secret) {
  const timestamp = req.headers['x-knowstead-timestamp'];
  const signature = String(req.headers['x-knowstead-signature'] ?? '').replace('sha256=', '');
  // Wiedereinspielungen abwehren: nicht älter als fünf Minuten
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

```python
import hashlib, hmac, time

def verify(headers, raw_body: bytes, secret: str) -> bool:
    ts = headers["X-Knowstead-Timestamp"]
    sig = headers["X-Knowstead-Signature"].removeprefix("sha256=")
    if abs(time.time() - int(ts)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
```

> [!IMPORTANT]
> Webhooks werden von Administratoren eingerichtet und erhalten alle passenden Ereignisse – auch zu
> Seiten mit Einschränkungen. Mit dem Bereichsfilter lässt sich der Umfang eingrenzen.

---

## API-Konnektoren

Konnektoren holen Daten aus Fremdsystemen **serverseitig** ab, damit Zugangsdaten nie im Browser
landen. Administration → API-Konnektoren: Basis-URL, Authentifizierung (keine, Basic, Bearer,
Header, Query-Parameter), erlaubte Pfade, feste Header, Cache-Dauer.

Im Editor zeigt das Makro **API-Daten** das Ergebnis als Tabelle, Liste oder Wert. Programmatisch:

```bash
curl -X POST https://knowstead.example.com/api/v1/connectors/status/query \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"/incidents","pageId":42,"refresh":false}'
```

Es sind nur GET-Abfragen auf freigegebene Pfade möglich; die Antwort wird zwischengespeichert
(`refresh: true` erzwingt eine frische Abfrage).

Damit die Zugangsdaten eines Konnektors nicht für beliebige Abfragen missbraucht werden, gilt:

| Wer | Darf abfragen |
| --- | --- |
| Globales Recht `integrations.manage` | jeden freigegebenen Pfad, mit oder ohne `pageId` und `params` |
| Schreibrecht auf der Seite `pageId` | jeden freigegebenen Pfad mit beliebigen `params` (zum Einrichten des Makros) |
| Leserecht auf der Seite `pageId` | nur Konnektor und Pfad, die in der Seite als Makro **API-Daten** stehen, ohne `params` |

Ohne `pageId` antworten alle anderen Konten mit `403`.

---

## Live-Ereignisse (SSE)

`GET /api/v1/stream` liefert einen Server-Sent-Events-Strom für angemeldete Benutzer:

```js
const stream = new EventSource('/api/v1/stream', { withCredentials: true });
stream.addEventListener('notification', (e) => console.log(JSON.parse(e.data)));
stream.addEventListener('page', (e) => console.log('Seite geändert', JSON.parse(e.data)));
stream.addEventListener('presence', (e) => console.log('Anwesenheit', JSON.parse(e.data)));
```

Ereignisse: `hello` (Begrüßung mit Verbindungsinfo), `notification`, `page`, `presence`.
Der Strom folgt den Rechten des Benutzers: Sitzung bzw. Token, Kontostatus und Rechte werden alle
25 Sekunden neu geprüft – nach Abmelden, Sperren oder Widerruf endet die Verbindung. Höchstens
20 gleichzeitige Verbindungen je Person.

---

## Gemeinsame Bearbeitung (WebSocket)

Die Echtzeit-Bearbeitung nutzt [Yjs](https://yjs.dev) über einen WebSocket je Seite:

```
wss://knowstead.example.com/api/v1/collab/<pageId>
```

- **Anmeldung** über das Sitzungs-Cookie oder `Authorization: Bearer knowstead_…` mit Umfang `write`. Sendet
  der Client einen `Origin`, muss er zur Adresse von Knowstead passen. Läuft die Sitzung ab oder wird das
  Token widerrufen, trennt der Server die Verbindung.
- **Voraussetzungen**: Schreibrecht auf der Seite, Rich-Text-Seite, veröffentlicht, Einstellung
  `realtimeCollaboration` aktiv. Abgelehnt wird mit HTTP-Status beim Upgrade: `401`, `403`, `404`,
  `409` (anderer Seitentyp oder Entwurf), `429` (zu viele Verbindungen), `503` (ausgeschaltet).
- **Nachrichten** sind binär und kompatibel zu `y-websocket`: Typ `0` = Sync (`y-protocols/sync`),
  `1` = Awareness (Cursor, Auswahl), `3` = Steuerung (JSON-Zeichenkette).
- Der Editor-Inhalt liegt im XML-Fragment `default` (TipTap/ProseMirror-Schema), Titel, Symbol,
  Stichwörter und Seitenbreite in der Map `meta`.

Steuerungsnachrichten des Servers:

| `type` | Bedeutung |
| --- | --- |
| `welcome` | Verbindung steht; eigener Name und Farbe, `initialized` = gemeinsamer Stand vorhanden |
| `init` | Dieser Client soll den veröffentlichten Inhalt (Version `version`) einspielen |
| `published` | Version `version` wurde aus der gemeinsamen Bearbeitung veröffentlicht (`by`) |
| `outdated` | Die Seite wurde außerhalb geändert, der gemeinsame Stand enthält Unveröffentlichtes |
| `restart` | Der gemeinsame Stand wurde verworfen oder neu geladen – Client baut ihn neu auf |
| `closed` | Verbindung wird beendet: `reason: "forbidden"` nach Entzug der Rechte (Code 4003), `reason: "too_large"` wenn das gemeinsame Dokument die Obergrenze überschreitet (Code 1009) |

Der Client kann `{"type":"reset"}` senden, um den gemeinsamen Stand zu verwerfen. Veröffentlicht wird
nicht über den WebSocket, sondern wie gewohnt per `PUT /api/v1/pages/{id}` mit `collab: true`. Namen und
Farben in der Awareness setzt der Server aus dem Konto – eigene Angaben werden überschrieben.
Grenzen: 40 Verbindungen je Seite, 12 je Person, 16 MB je Nachricht, 32 MB je gemeinsamem Dokument.

---

## Lesebestätigungen

Pflichtdokumente „gelesen und verstanden“ bestätigen lassen. Anfordern und Nachweise einsehen darf die
Bereichsverwaltung; bestätigen darf, wer zur Zielgruppe gehört und die Seite lesen darf.

```bash
# Anfordern: Zielgruppe aus Gruppen, Personen oder allen mit Leserecht im Bereich ({"type":"space","id":0})
curl -X PUT https://knowstead.example.com/api/v1/pages/42/read-requirement \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"audience":[{"type":"group","id":5}],"statement":"Ich habe die Richtlinie gelesen und verstanden.",
       "dueDays":14,"reconfirmOnChange":true,"repeatMonths":12}'

# Neue Runde (alle bestätigen erneut): dieselbe Anfrage mit "restart": true
# Eigener Stand und Anforderung einer Seite
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/read-requirement

# Bestätigen (als Person der Zielgruppe)
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/read-confirmations

# Nachweis als JSON oder CSV (Semikolon, UTF-8 mit BOM – öffnet direkt in Excel)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/read-confirmations
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/pages/42/read-confirmations?format=csv" -o nachweis.csv

# Offene Personen sofort erinnern (höchstens einmal täglich je Person) → { "reminded": 3 }
curl -X POST -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/read-reminders

# Eigene Pflichtdokumente bzw. alle Anforderungen verwalteter Bereiche mit Fortschritt
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/me/read-requirements
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/read-requirements

# Anforderung entfernen – Nachweise bleiben erhalten
curl -X DELETE -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/read-requirement
```

Webhook-Ereignisse: `page.read_requirement_changed`, `page.read_confirmed`.

---

## Freigabeabläufe und Vertretungen

```bash
# Mehrstufigen Ablauf festlegen (bis 6 Stufen; Freigebende sind Gruppen oder Personen)
curl -X PUT https://knowstead.example.com/api/v1/spaces/QM/approval-workflow \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":true,"distinctApprovers":true,"stages":[
        {"name":"Fachbereich","approvers":[{"type":"group","id":7}],"minApprovals":1,"escalateDays":3},
        {"name":"Qualitätsmanagement","approvers":[{"type":"user","id":12}],"minApprovals":1}]}'

# Prüfung anfordern und entscheiden wie gewohnt (/api/v1/pages/:id/reviews, /api/v1/reviews/:id/decision).
# Der Prüfauftrag enthält dann "workflow": aktuelle Stufe, Freigaben je Stufe und wer in Vertretung entschied.

# Abwesenheit mit Vertretung (eigene) – und für andere mit dem Recht „Benutzer & Gruppen verwalten“
curl -X POST https://knowstead.example.com/api/v1/me/deputies \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"deputyId":9,"startsOn":"2026-12-22","endsOn":"2027-01-06","note":"Urlaub"}'
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/me/deputies
curl -X POST https://knowstead.example.com/api/v1/admin/users/12/deputies \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"deputyId":9,"startsOn":"2026-12-22","endsOn":"2027-01-06"}'
```

Webhook-Ereignisse: `review.stage_approved`, `review.stage_decision`, `space.approval_workflow_changed`,
`user.deputy_set`.

---

## Vorschlagsmodus

```bash
# Nur Vorschläge zulassen; "locked": true schreibt den Modus fest (nur Bereichsverwaltung)
curl -X PUT https://knowstead.example.com/api/v1/pages/42/edit-mode \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"mode":"suggest","locked":true}'

# Offene Vorschläge: [{ "sid": "…", "author": 7, "authorName": "Erika", "inserted": "…", "deleted": "…" }]
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/pages/42/suggestions

# Vorgabe für neue Seiten eines Bereichs
curl -X PATCH https://knowstead.example.com/api/v1/spaces/QM \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"defaultEditMode":"suggest"}'
```

Vorschläge stehen im Seiteninhalt als `<ins data-suggestion="insert" data-sid="…">` bzw.
`<del data-suggestion="delete" …>`. Bei Seiten im Modus `suggest` akzeptiert `PUT /api/v1/pages/:id` von
Personen ohne Entscheidungsrecht nur Änderungen in dieser Form; `?render=true`, Suche und Exporte liefern
immer den Text **ohne** offene Vorschläge. Das Seitenobjekt enthält `editMode` (`mode`, `locked`,
`canChange`, `canResolve`, `pending`).

---

## Inhaltsanalyse

Für die Bereichsverwaltung (eigene Bereiche) und Personen mit dem Recht `analytics.view` (alle lesbaren
Bereiche, zusätzlich Suchbegriffe ohne Treffer).

```bash
# Alle Listen eines Bereichs der letzten 90 Tage (days: 7–365)
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/analytics?space=IT&days=90"
# → { "summary": {…}, "topPages": […], "unreadPages": […], "failedSearches": […], "orphans": […], "brokenLinks": […] }

# Eine Liste als CSV: top | unread | searches | orphans | links
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/analytics/export/links?space=IT" -o verweise.csv

# Eintrag aus der Arbeitsliste nehmen (kind: search | orphan | link | unread)
curl -X PUT https://knowstead.example.com/api/v1/analytics/dismissed \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" -d '{"kind":"search","item":"vpn","dismissed":true}'
```

---

## Single Sign-on

Die Anmeldung über Entra ID, SAML und Kerberos läuft über Browser-Weiterleitungen – für Skripte gibt es
dafür keine Token-Anmeldung (Skripte nutzen API-Tokens).

| Adresse | Zweck |
| --- | --- |
| `GET /api/v1/auth/sso` | eingerichtete Anmeldewege für die Anmeldeseite |
| `GET /api/v1/auth/oidc/start?next=/pfad` | Anmeldung über OpenID Connect beginnen |
| `GET /api/v1/auth/oidc/callback` | Umleitungs-URI (beim Anbieter eintragen) |
| `GET /api/v1/auth/saml/start?next=/pfad` | Anmeldung über SAML beginnen (auch als Anmelde-URL im Anbieter) |
| `POST /api/v1/auth/saml/acs` | Assertion Consumer Service (beim Anbieter eintragen) |
| `GET /api/v1/auth/saml/metadata` | SAML-Metadaten dieses Dienstes |
| `GET /api/v1/auth/kerberos?next=/pfad` | Windows-Anmeldung – im vorgeschalteten Webserver schützen |
| `GET /api/v1/me/identities` | verknüpfte Anmeldekonten |
| `POST /api/v1/me/identities/:provider/link` | Verknüpfung beginnen (`oidc`, `saml`, `kerberos`) → `{ "url": "…" }` |
| `DELETE /api/v1/me/identities/:id` | Verknüpfung lösen (nie die letzte Anmeldemöglichkeit) |
| `GET /api/v1/admin/sso` | Adressen und Prüfung der aktuellen Anfrage (Administration) |
| `POST /api/v1/admin/sso/oidc/test`, `…/saml/test` | Einstellungen prüfen |
| `GET`/`DELETE /api/v1/admin/users/:id/identities[/:identityId]` | Verknüpfungen einer Person |

Die Einstellungen stehen unter den Schlüsseln `oidc`, `saml`, `kerberos` und `showLocalLogin` in
`PUT /api/v1/admin/settings`; Geheimnisse werden verschlüsselt gespeichert und maskiert (`••••••••`)
zurückgegeben. Fehlgeschlagene Anmeldungen leiten auf `/login?sso_error=<code>` um (Codes: `unavailable`,
`flow`, `provider`, `no_account`, `account_exists`, `admin_link`, `conflict`, `group`, `disabled`,
`identity_taken`, `proxy`, `no_user`). Webhook-Ereignisse: `auth.identity_linked`, `auth.identity_unlinked`.

---

## Sprache der Antworten

Fehlermeldungen, Kataloge (`/api/v1/catalog`), Benachrichtigungen, CSV-Exporte, PDF- und Word-Beschriftungen
und E-Mails gibt es auf Deutsch und Englisch. Maßgeblich ist – in dieser Reihenfolge:

1. die Kopfzeile `X-Knowstead-Locale: de` bzw. `en`,
2. die Spracheinstellung im Profil der angemeldeten Person,
3. bei Anfragen ohne Sitzung (API-Token, anonym) `Accept-Language`,
4. die Standardsprache der Installation.

Fehlercodes (`error.code`) sind sprachunabhängig – Skripte sollten auf den Code prüfen, nicht auf den Text.

```bash
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "X-Knowstead-Locale: en" https://knowstead.example.com/api/v1/pages/999999
# → { "error": { "code": "not_found", "message": "Page not found or no permission" } }
```

---

## Rezepte

### Release-Notes aus der CI ergänzen

```bash
#!/usr/bin/env bash
set -euo pipefail
PAGE=$(curl -sf -H "Authorization: Bearer $KNOWSTEAD_TOKEN" \
  "$KNOWSTEAD_URL/api/v1/pages/find?space=TEAM&title=Release%20Notes" | jq -r .id)
curl -sf -X POST "$KNOWSTEAD_URL/api/v1/pages/$PAGE/append" \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --arg v "$CI_COMMIT_TAG" --arg log "$(git log -20 --pretty='- %s')" \
        '{format:"markdown",position:"start",content:("## " + $v + "\n\n" + $log + "\n"),changeNote:("Release " + $v)}')"
```

### Wöchentlicher Bericht über geänderte Seiten (PowerShell)

```powershell
$headers = @{ Authorization = "Bearer $env:KNOWSTEAD_TOKEN" }
$feed    = Invoke-RestMethod "$env:KNOWSTEAD_URL/api/v1/activity?space=TEAM&limit=100" -Headers $headers
$feed.items | Where-Object { $_.type -eq 'page.updated' } |
  Group-Object { $_.page.title } | Sort-Object Count -Descending |
  Select-Object Count, Name | Format-Table
```

### Seitenbaum eines Bereichs als Markdown-Liste

`GET /spaces/{key}/tree` liefert eine flache, bereits sortierte Liste mit `id`, `parentId`, `title`,
`icon`, `contentType` und `restricted` – die Verschachtelung baust du über `parentId` auf:

```bash
curl -sf -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "$KNOWSTEAD_URL/api/v1/spaces/TEAM/tree" \
 | jq -r '.[] | "- [" + .title + "](/s/TEAM/p/" + (.id|tostring) + ")  (parentId: " + (.parentId|tostring) + ")"'
```

### Neue Kommentare in ein Ticketsystem spiegeln

Webhook auf `comment.created` einrichten, Signatur prüfen (siehe oben) und `page.url` plus
`data.excerpt` weiterreichen – oder ein Plugin mit `ctx.events.on('comment.created', …)` schreiben,
wenn die Verarbeitung im selben Prozess laufen soll (siehe [PLUGINS.md](PLUGINS.md)).
