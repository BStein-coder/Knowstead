# Administrationshandbuch

Dieses Dokument richtet sich an alle, die Knowstead installieren und betreiben: Installation, Betrieb mit
vielen Personen, Benutzer und Rechte, Active Directory, E-Mail, Redaktionsprüfung und Wiedervorlage,
Echtzeit-Bearbeitung, Export und Import, Sicherungen, Wartung und Fehlersuche.

## Inhalt

- [Installation](#installation)
- [Erste Einrichtung](#erste-einrichtung)
- [Betrieb](#betrieb)
- [Betrieb mit vielen Personen](#betrieb-mit-vielen-personen)
- [Benutzer, Gruppen, Rechte](#benutzer-gruppen-rechte)
- [Active Directory / LDAP](#active-directory--ldap)
- [Single Sign-on: Entra ID, SAML und Windows-Anmeldung](#single-sign-on-entra-id-saml-und-windows-anmeldung)
- [E-Mail](#e-mail)
- [Bereiche und Struktur](#bereiche-und-struktur)
- [Redaktionsprüfung, Wiedervorlage, Freigaben, Lesebestätigungen und Inhaltsanalyse](#redaktionsprüfung-wiedervorlage-und-wiederherstellung)
- [Gleichzeitiges Bearbeiten in Echtzeit](#gleichzeitiges-bearbeiten-in-echtzeit)
- [Systemeinstellungen](#systemeinstellungen)
- [KI-Anbindung](#ki-anbindung)
- [Dateien: Vorschau, Anhangsuche, draw.io, Whiteboard](#dateien-vorschau-anhangsuche-drawio-whiteboard)
- [Export-Vorlage für PDF und Word](#export-vorlage-für-pdf-und-word)
- [Import aus anderen Wikis](#import-aus-anderen-wikis)
- [Sicherungen](#sicherungen)
- [Wartung](#wartung)
- [Protokolle und Nachvollziehbarkeit](#protokolle-und-nachvollziehbarkeit)
- [Fehlersuche](#fehlersuche)
- [Checkliste für den Produktivbetrieb](#checkliste-für-den-produktivbetrieb)

---

## Installation

**Voraussetzung:** Node.js 24 oder neuer. Sonst nichts – keine Datenbank, kein Webserver, kein Docker.

> [!TIP]
> Die ausführliche Schritt-für-Schritt-Anleitung – Windows-Dienst, Linux mit systemd, Docker,
> Reverse-Proxy mit HTTPS (nginx, IIS, Apache), E-Mail, Active Directory und Prüfliste – steht in
> [INSTALLATION.md](INSTALLATION.md). Hier folgt die Kurzfassung.

### Windows

1. Installationspaket (GitHub-Releases) entpacken, z. B. nach `D:\Knowstead`.
2. Doppelklick auf **`Knowstead-Installation.cmd`** – der Assistent fragt Datenverzeichnis, Erreichbarkeit,
   Autostart, Firewall und Zusatzprogramme ab, richtet alles ein, prüft das Ergebnis und öffnet die
   Ersteinrichtung. Node.js installiert er auf Wunsch per `winget`.

Nur zum Ausprobieren: Doppelklick auf **`start.cmd`** – startet den Server im Fenster.

### Linux/macOS

```bash
sudo bash install.sh   # Assistent mit systemd-Dienst, auch im Proxmox-LXC-Container; zum Ausprobieren: ./start.sh
```

### Docker

```bash
cp .env.example .env      # BASE_URL und KNOWSTEAD_SECRET setzen
docker compose up -d
```

Daten liegen im Volume `knowstead-data` (`/app/data`).

### Als Dienst

Den Autostart richten die Installationsassistenten ein: unter Windows als geplante Aufgabe `\Knowstead\Knowstead`
(Konto *Lokaler Dienst*, Protokoll über `LOG_FILE` in `<Datenverzeichnis>\logs\knowstead.log`) oder als
Windows-Dienst mit [NSSM](https://nssm.cc/), unter Linux als systemd-Dienst `knowstead`.

| Aufgabe | Windows | Linux |
| --- | --- | --- |
| Zustand | `Knowstead-Dienst.cmd status` | `systemctl status knowstead` |
| Starten / neu starten | `Knowstead-Dienst.cmd start` / `restart` | `systemctl start knowstead` / `restart knowstead` |
| Geordnet beenden | `Knowstead-Dienst.cmd stop` | `systemctl stop knowstead` |
| Protokoll | `Knowstead-Dienst.cmd log -Follow` | `journalctl -u knowstead -f` |
| Installation prüfen | `npm run cli -- doctor` | `sudo -u knowstead node server/src/cli.ts doctor` |

`npm run cli -- stop` beendet einen laufenden Server auf jeder Plattform geordnet: Es legt die Datei
`knowstead.stop` im Datenverzeichnis an, der Server schreibt offene Bearbeitungsstände und beendet sich.
Das ist nötig, weil Windows Prozessen ohne Konsole kein „Strg+C“ senden kann – „Beenden“ in der
Aufgabenplanung bricht den Prozess dagegen hart ab.

Von Hand eingerichtete Dienste: Den Dienst direkt mit
`node --disable-warning=ExperimentalWarning server/src/index.ts` im Programmordner starten (nicht über
`npm start`): Dann erreicht das Stoppsignal den Server, und er schreibt offene Bearbeitungsstände vor
dem Beenden weg. Nach einem Fehlstart einige Sekunden bis zum Neustart warten lassen (systemd
`RestartSec=5`, NSSM „Restart delay“) – verweigert der Update-Schutz den Start, steht der Grund im
Protokoll.

---

## Erste Einrichtung

Beim ersten Aufruf führt ein Assistent in drei Schritten durch die Einrichtung:

1. **Grunddaten** – Name der Installation, Sprache, Akzentfarbe, optional Beispielinhalte.
2. **Administratorkonto** – Anzeigename, Benutzername, E-Mail, Passwort.
3. **Fertig** – weiter zu **Nächste Schritte** oder in den geführten Rundgang.

> [!IMPORTANT]
> Wird die Einrichtung **nicht direkt auf dem Server** aufgerufen (anderer Rechner, Docker, jeder
> Reverse-Proxy), fragt der Assistent nach dem **Einrichtungscode**. Er steht beim Start im
> Protokoll („Einrichtungscode: XXXX-XXXX“ – Startfenster, Dienstprotokoll bzw.
> `docker compose logs knowstead`) und verhindert, dass jemand anderes einen frisch gestarteten Server zuerst
> in Besitz nimmt.

Dabei entstehen automatisch:

- die Gruppen **Administratoren** (alle Rechte) und **Benutzer** (Standardgruppe),
- der Bereich **Handbuch** mit der vollständigen Benutzerdokumentation,
- 13 Vorlagen (Besprechung, Entscheidung, Runbook, Onboarding …),
- optional der Beispielbereich **Team-Bereich**.

### Nächste Schritte

**Administration → Nächste Schritte** zeigt, was nach der Ersteinrichtung für den Betrieb noch fehlt,
und springt direkt zur passenden Einstellung:

| Punkt | erledigt, wenn |
| --- | --- |
| Adresse mit HTTPS | `BASE_URL` beginnt mit `https://` und ist nicht `localhost` |
| Autostart | der Installationsassistent die Betriebsart eingetragen hat (`KNOWSTEAD_SERVICE`) bzw. Knowstead im Docker-Container läuft |
| E-Mail-Versand | SMTP-Server und Absender eingetragen |
| Sicherung | automatische Sicherung eingeschaltet und eine Sicherung jünger als zwei Tage – „Jetzt sichern“ direkt in der Liste |
| Personen einladen | es gibt mehr als ein Personenkonto |
| Ersten Bereich anlegen | es gibt einen eigenen Bereich (Handbuch und Beispielbereich zählen nicht) |
| Anmeldung mit Firmenkonto *(optional)* | Active Directory oder ein Single-Sign-on-Anbieter ist eingerichtet |
| Texterkennung und Office-Vorschau *(optional)* | Tesseract oder LibreOffice ist eingeschaltet |

Solange Pflichtpunkte offen sind, erinnert ein Hinweis in der **Übersicht** daran; er lässt sich dort
ausblenden und unter *Nächste Schritte* wieder einschalten.

---

## Betrieb

### Konfiguration

Betriebsparameter stehen in der `.env` (siehe [`.env.example`](../.env.example)):
`PORT`, `HOST`, `BASE_URL`, `DATA_DIR`, `PLUGINS_DIR`, `WEB_DIST_DIR`, `KNOWSTEAD_SECRET`, `TRUST_PROXY`,
`COOKIE_SECURE`, `LOG_LEVEL`.

> [!IMPORTANT]
> `KNOWSTEAD_SECRET` verschlüsselt gespeicherte Zugangsdaten (SMTP, API-Konnektoren, AD-Dienstkonto,
> Plugin-Passwörter) und signiert Webhooks. Ohne Angabe wird `data/secret.key` erzeugt – diese Datei
> gehört in die Sicherung. Geht sie verloren, müssen alle Zugangsdaten neu eingetragen werden.

### Reverse-Proxy

Neben normalen Anfragen hält Knowstead zwei Arten lang offener Verbindungen: **Server-Sent Events** für
Live-Aktualisierung und Benachrichtigungen (`/api/v1/stream`) und **WebSockets** für das gleichzeitige
Bearbeiten (`/api/v1/collab/<seite>`). Der Proxy muss beide ungepuffert durchreichen.

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  server_name knowstead.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;          # Echtzeit-Bearbeitung (WebSocket)
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;                             # Live-Aktualisierung (SSE)
    proxy_read_timeout 1h;                           # lange offene Verbindungen nicht kappen
    client_max_body_size 512m;                       # Upload-Grenze; für große Wiki-Importe ggf. erhöhen
  }
}
```

Dazu `BASE_URL=https://knowstead.example.com` und `TRUST_PROXY` setzen – am besten auf die Adresse des Proxys
(`TRUST_PROXY=127.0.0.1`, mehrere durch Komma, Netze wie `10.0.0.0/8` oder `uniquelocal` für alle
privaten Netze); `true` glaubt jedem Absender. Mit einer Adressliste kann niemand, der den Port direkt
erreicht, per `X-Forwarded-For` eine fremde Client-Adresse vortäuschen (Ratenbegrenzung, Audit-Log). Der Server nimmt
WebSocket-Verbindungen nur an, wenn der `Origin` des Browsers zur eigenen Adresse passt – deshalb
`Host` unverändert weitergeben.

- **IIS mit Application Request Routing**: die Windows-Funktion **WebSocket-Protokoll** installieren
  (sonst bleibt es beim Bearbeiten mit persönlichen Entwürfen) und im ARR-Proxy die Antwortpufferung
  abschalten (`responseBufferLimit="0"`), damit Live-Ereignisse sofort ankommen.
- **Apache 2.4.47 oder neuer**: `ProxyPreserveHost On` und `ProxyPass / http://127.0.0.1:3000/ upgrade=websocket`.

Kommt keine WebSocket-Verbindung zustande, arbeitet der Editor nach wenigen Sekunden automatisch ohne
gemeinsame Bearbeitung weiter – es geht nichts verloren.

### Aktualisierung

Ein Update verändert Daten nie ungesichert. Beim Start einer neuen Version gilt:

| Schutz | Wirkung |
| --- | --- |
| **Sicherung vor dem Update** | Stehen Datenbankänderungen (Migrationen) an, legt der Server vorher automatisch eine vollständige Kopie der Datenbank unter `backups/backup-…-update` an (die letzten fünf bleiben). Scheitert die Sicherung, wird nichts verändert. |
| **Alles oder nichts** | Alle Migrationen eines Updates laufen in einer Transaktion. Bricht eine ab, bleibt die Datenbank vollständig auf dem alten Stand. |
| **Schutz vor Rückstufung** | Stammt die Datenbank von einer neueren Knowstead-Version, verweigert eine ältere den Start – sie würde sonst in ein ihr unbekanntes Schema schreiben. |
| **Nur ein Server je Datenbank** | Läuft noch ein Knowstead-Server auf derselben Datenbank (z. B. der alte Dienst), bricht der Start ab, bevor migriert wird. |
| **Schlüsselprüfung** | Passt der Serverschlüssel (`KNOWSTEAD_SECRET` bzw. `secret.key`) nicht zur Datenbank, startet der Server nicht – verschlüsselte Zugangsdaten blieben sonst unbemerkt unbrauchbar. |
| **Programm und Oberfläche** | `start.cmd`, `start.sh` bzw. `node scripts/prepare.mjs` erkennen geänderte Abhängigkeiten und Quelltexte und holen Installation und Build nach. |
| **Nachvollziehbarkeit** | Protokoll und Audit-Log vermerken „Knowstead aktualisiert: alte → neue Version“ mit Name der Sicherung. |
| **Neustart vergessen?** | Wurden die Programmdateien ersetzt, der Dienst aber nicht neu gestartet, läuft der alte Stand aus dem Arbeitsspeicher weiter. Knowstead erkennt das: *Administration → Übersicht* zeigt **Neustart erforderlich**, `npm run cli -- status` und `doctor` nennen den Stand des laufenden Servers. Export, Sicherung und Textgewinnung arbeiten bis zum Neustart weiter. |

> [!IMPORTANT]
> Das **Datenverzeichnis** (Datenbank, Anhänge, Sicherungen, `secret.key`) gehört am besten
> **außerhalb des Programmordners**, z. B. `DATA_DIR=D:\KnowsteadDaten` in der `.env`. Dann kann der
> Programmordner bei einem Update gefahrlos ersetzt werden. Liegt es im Programmordner (Standard
> `data/`), diesen Ordner beim Update **nie löschen**.

**Mit einem Befehl (Linux)**

Ab 1.8.0 liegt im Programmordner `update.sh`:

```bash
sudo bash /opt/knowstead/update.sh /tmp/knowstead-<version>-linux-x64.tar.gz    # einspielen
sudo bash /opt/knowstead/update.sh --rollback                              # zurück zum Stand davor
```

Das Skript prüft die Prüfsumme, legt das neue Programm neben das alte, hält den Dienst an, tauscht die
Ordner, startet und prüft mit `doctor`, ob der neue Stand läuft und antwortet. Gelingt das nicht, kommt
der bisherige Ordner zurück – samt Datenbank, falls die neue Version sie schon umgestellt hatte. Der
bisherige Programmordner bleibt als `<ordner>.vor-<version>` liegen (die letzten zwei). Ablauf, erstes
Update einer Installation vor 1.8.0, Probelauf und alle Optionen:
[Installationsanleitung → Updates](INSTALLATION.md#11-updates-und-umzug).

**Vorgehen von Hand**

1. Stand prüfen: `npm run cli -- status` (Version, Datenbankstand, letzte Sicherung).
2. Optional vollständige Sicherung inklusive Anhänge: Administration → Sicherungen → „Jetzt sichern“
   oder `npm run cli -- backup`. Die Datenbank sichert der Server beim Update ohnehin selbst.
3. Dienst **stoppen**.
4. Neue Programmdateien einspielen:
   - **Git:** `git pull`
   - **ZIP-Paket:** neuen Stand über den Programmordner entpacken; `.env` (und `data/`, falls es im
     Programmordner liegt) bleiben erhalten.
   - **Docker:** `docker compose build --pull && docker compose up -d` – die Daten liegen im Volume.
5. `node scripts/prepare.mjs` ausführen (unter Windows erledigt das `start.cmd`): installiert
   geänderte Abhängigkeiten und baut die Oberfläche neu.
6. Dienst **starten**. Im Protokoll erscheinen „Sicherung vor dem Update angelegt: …“ und die
   angewendeten Migrationen. Lief der Dienst noch, genügt `start` nicht – dann **neu starten**
   (`sudo systemctl restart knowstead` bzw. `Knowstead-Dienst.cmd restart`). `npm run cli -- status` zeigt, ob der
   laufende Server mit dem neuen Stand arbeitet; einen beiseitegelegten alten Programmordner erst danach
   löschen.
7. **Administration → Wartung → Handbuch aktualisieren** (oder `npm run cli -- handbook:sync`) übernimmt neue Kapitel; von Hand angepasste
   Kapitel bleiben unverändert.

**Zurück zur vorherigen Version**

Mit `update.sh`: `sudo bash /opt/knowstead/update.sh --rollback` tauscht den aufbewahrten Programmordner
zurück. Hat das Update die Datenbank umgestellt, warnt das Skript vor der Rückfrage und spielt dann die
Sicherung von vor dem Update ein – was seither eingetragen wurde, steht danach nur noch in der dabei
angelegten Sicherung `backup-…-restore`. Von Hand:

1. Dienst stoppen und die vorherige Programmversion einspielen (Schritte 4–5).
2. `npm run cli -- backup:list` zeigt die Sicherungen; die vor dem Update heißt `backup-…-update`.
3. `npm run cli -- restore backup-JJJJMMTT-HHMMSS-update` spielt sie zurück (der aktuelle Stand wird
   dabei zusätzlich als `backup-…-restore` gesichert).
4. Dienst starten.

Notfall-Schalter (nur bewusst und vorübergehend setzen): `KNOWSTEAD_ALLOW_DOWNGRADE=1` startet trotz neuerer
Datenbank, `KNOWSTEAD_ALLOW_KEY_CHANGE=1` übernimmt einen neuen Serverschlüssel (Zugangsdaten danach neu
eintragen), `KNOWSTEAD_SKIP_UPDATE_BACKUP=1` überspringt die Sicherung vor dem Update.

**Update auf 1.1:** Das neue Recht `ai.use` (KI-Funktionen nutzen) erhalten nur neu eingerichtete
Installationen automatisch für die Gruppe „Benutzer“. Bestehende Installationen vergeben es bei
Bedarf unter Administration → Gruppen bzw. Berechtigungen.

**Update auf 1.2:**

1. Vorher eine Sicherung anlegen – die Migrationen `004` bis `010` ergänzen mehrere Tabellen.
2. Den Reverse-Proxy um die WebSocket-Header ergänzen (siehe [Reverse-Proxy](#reverse-proxy)).
3. Unter **Administration → E-Mail** Verbindung prüfen und festlegen, ob Benachrichtigungen per E-Mail
   verschickt werden.
4. Unter **Administration → Bereiche → Kategorien** die übernommenen Kategorien sichten und sortieren.
5. Optional die **Export-Vorlage** (Logo, Farbe, Kopf- und Fußzeile) einrichten.
6. **Wartung → Handbuch aktualisieren** ausführen.

Bestehende Anhänge werden nach dem Start im Hintergrund für die Volltextsuche gelesen. Bei vielen
Dateien dauert das eine Weile; der Fortschritt steht unter `GET /api/v1/admin/attachments/index`.

**Update auf 1.3:**

- Migration `011` (verzögertes Löschen von Dateien) – die Sicherung davor legt der Server selbst an.
- Beim ersten Start merkt sich Knowstead einen Prüfwert des Serverschlüssels. Wird `KNOWSTEAD_SECRET` bzw.
  `secret.key` später bewusst gewechselt, den Start einmalig mit `KNOWSTEAD_ALLOW_KEY_CHANGE=1` bestätigen.
- **API-Konnektoren:** Leser erhalten nur noch Daten, die als Makro in der Seite hinterlegt sind.
  Skripte, die `POST /api/v1/connectors/{key}/query` ohne `pageId` aufrufen, brauchen ein Konto mit
  `integrations.manage`.
- **Benutzerverwaltung:** Gruppen mit `users.manage`, aber ohne `admin`, können Administratorkonten
  nicht mehr bearbeiten, sperren oder löschen und keine Tokens für Administrator-Dienstkonten anlegen.
- **Verzeichniskonten** können ihr Passwort nicht mehr über „Passwort vergessen“ setzen – das Passwort
  verwaltet das AD.
- **Selbstregistrierung:** Mit eingerichtetem E-Mail-Versand müssen neue Konten ihre Adresse bestätigen;
  ist eine Domain-Beschränkung gesetzt, braucht die Registrierung den E-Mail-Versand (sonst gesperrt).
- **Profil:** Die E-Mail-Adresse lässt sich nur noch mit dem aktuellen Passwort ändern; Skripte senden
  dafür `currentPassword` mit.
- **Ersteinrichtung** neuer Installationen über das Netzwerk verlangt den Einrichtungscode aus dem Protokoll.
- Passwort-Hashes werden bei der nächsten Anmeldung automatisch auf die stärkeren Parameter gehoben;
  nichts zu tun.

**Update auf 1.4:**

- Keine Migration. Beim ersten Start berechnet der Server Suchtexte und Kurzfassungen aller Seiten
  einmalig neu („Suchtexte von … Seiten nach dem Update neu berechnet“) – bei vielen Tausend Seiten
  einige Sekunden, danach ist der Server wie gewohnt erreichbar.
- Die **API-Referenz** unter `/api/docs` verlangt eine Anmeldung (außer bei anonymem Lesezugriff).
  Werkzeuge, die `/api/docs/json` abrufen, senden ein API-Token mit.
- **Gemeinsames Bearbeiten**: Ein gemeinsames Dokument darf höchstens 32 MB groß werden. Seiten mit
  sehr vielen direkt eingefügten Bildern melden das beim Bearbeiten – Bilder als Anhang hochladen oder
  die Seite aufteilen.
- **Prüfung und Freigabe**: Eine ausdrücklich als prüfend eingetragene Person darf den Auftrag jetzt
  auch ohne Moderationsrecht freigeben oder zurückweisen – nicht aber eine selbst angeforderte Prüfung.
- **Sitzungs-Cookie** hinter einem HTTPS-Proxy: Mit `COOKIE_SECURE=auto` genügt jetzt
  `X-Forwarded-Proto: https`, auch ohne `TRUST_PROXY`.
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (ergänzte Kapitel zu Prüfung und
  Freigabe).

**Update auf 1.5:**

- Migrationen 013–019 laufen beim ersten Start in einer Transaktion (vorher automatische Sicherung).
  Danach wertet der Server einmalig die Verweise aller Seiten für die Inhaltsanalyse aus.
- Neue Abhängigkeiten (`openid-client`, `@node-saml/node-saml`) – `start.cmd` bzw.
  `node scripts/prepare.mjs` installieren sie; bei manuellen Updates `npm ci` ausführen.
- Die Verzeichnisanmeldung lehnt Filter ab, die mehr als ein Konto finden – solche Filter präzisieren.
- Das Feld der Gruppenzuordnung heißt jetzt **Verzeichnis- und SSO-Gruppen**; vorhandene AD-Zuordnungen
  bleiben unverändert.
- Neues globales Recht **Inhaltsanalyse einsehen** – bei Bedarf der Redaktion zuweisen.
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (neue Kapitel Lesebestätigungen und
  Inhaltsanalyse).

**Update auf 1.8:**

- Migration `024` (Suchtext und Lesestand für den Chat der Aufgaben) – die Sicherung davor legt der
  Server selbst an. Nachrichten, die vor dem Update geschrieben wurden, gelten als gelesen.
- **Warnungen an die Administration** sind eingeschaltet: Alle aktiven Administratorkonten mit
  E-Mail-Adresse bekommen eine Nachricht, wenn die automatische Sicherung scheitert oder ausbleibt, der
  freie Speicher unter 2 GB fällt oder nach einem Update der Neustart fehlt. Schwellen, weitere
  Empfänger und Abschalten: *Administration → Einstellungen → Warnungen an die Administration*
  ([Warnungen und Überwachung](#warnungen-und-überwachung)).
- **Importe** schreiben hochgeladene Archive ins Datenverzeichnis (`tmp/`) statt in den Arbeitsspeicher.
  Dort muss so viel Platz frei sein, wie das Archiv groß ist; der Ordner wird nach jedem Import und
  beim Start des Servers geleert.
- Linux: Ab dieser Version liegt `update.sh` im Programmordner. Beim ersten Mal aus dem entpackten
  Paket starten ([Installationsanleitung → Updates](INSTALLATION.md#11-updates-und-umzug)).
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (Kapitel Suche, Aufgabenplaner,
  Administration und Export/Import ergänzt) – `update.sh` erledigt das selbst.

### Warnungen und Überwachung

Knowstead prüft alle zehn Minuten vier Dinge und meldet, wenn eines nicht stimmt:

| Warnung | Wann | Stufe |
| --- | --- | --- |
| **Neustart erforderlich** | Die Programmdateien wurden seit dem Start des Servers ersetzt (Update ohne Neustart) – oder der Programmordner ist nicht mehr vorhanden | Hinweis; bei fehlendem Ordner Fehler |
| **Automatische Sicherung fehlgeschlagen** | Die geplante Sicherung ist gescheitert (Knowstead versucht es nach einer Stunde erneut) | Fehler |
| **Keine aktuelle Sicherung** | Die neueste Sicherung ist älter als zwei Tage (einstellbar) – nur bei eingeschalteter automatischer Sicherung | Hinweis |
| **Wenig freier Speicherplatz** | Auf dem Laufwerk des Datenverzeichnisses sind weniger als 2 GB frei (einstellbar) | Hinweis; unter 500 MB Fehler |

- **Übersicht:** *Administration → Übersicht* zeigt jede Warnung mit Erklärung, Abhilfe und „seit“.
- **E-Mail:** Alle aktiven Administratorkonten mit E-Mail-Adresse bekommen eine Nachricht, sobald eine
  Warnung auftritt oder sich verschärft, danach einmal täglich eine Erinnerung und zum Schluss die
  Entwarnung – jeweils in der Sprache der Person. Voraussetzung ist der eingerichtete E-Mail-Versand;
  ohne ihn stehen die Warnungen nur in der Übersicht.
- **Einstellungen:** *Administration → Einstellungen → Warnungen an die Administration* – E-Mails ein
  oder aus, **weitere Empfänger** (z. B. ein Verteiler oder das Postfach eines Ticketsystems), die
  Schwelle für den freien Speicher und das Höchstalter der Sicherung (`0` = nicht warnen).
  **Testwarnung senden** zeigt, ob die E-Mails ankommen.
- **Protokoll:** Beginn und Ende jeder Warnung stehen im Serverprotokoll („Warnung: …“, „Warnung
  behoben: …“).

**Überwachungssysteme** (Uptime Kuma, Zabbix, Icinga, PRTG …) fragen denselben Stand ab:

```bash
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/monitoring
```

```json
{
  "status": "warn",
  "version": "1.8.0",
  "time": "2026-10-04T12:00:00.000Z",
  "alerts": [
    { "id": "backup-old", "severity": "warn", "title": "Keine aktuelle Sicherung",
      "message": "Die neueste Sicherung ist 3 Tage alt.", "since": "2026-10-03T03:10:00.000Z" }
  ],
  "checks": {
    "uptimeSeconds": 86400, "restartRequired": null, "diskFreeBytes": 52428800000,
    "backupAgeHours": 80.5, "backupFailed": false, "mailConfigured": true, "mailsFailed": 0
  }
}
```

- `status` ist `ok`, `warn` oder `error`. Mit `?strict=true` antwortet der Server bei `warn` und `error`
  mit **HTTP 503** – dann genügt der Überwachung der Statuscode.
- Der Endpunkt verlangt ein **Administratorkonto**. Für die Überwachung am besten ein Dienstkonto in
  der Administratorgruppe anlegen und ihm ein API-Token mit dem Umfang `read` geben.
- `alerts[].id`: `restart`, `backup-failed`, `backup-old`, `disk`. `restartRequired` ist `null` oder
  `updated`, `replaced`, `missing`; `mailsFailed` zählt endgültig gescheiterte E-Mails im Versandprotokoll.
- Ob Knowstead überhaupt antwortet, prüft wie bisher `GET /api/v1/health` – ohne Anmeldung.

---

## Betrieb mit vielen Personen

Knowstead ist für **500 und mehr Personen** ausgelegt, die gleichzeitig angemeldet sind, lesen, suchen und
schreiben. Alles läuft weiterhin in einem Node-Prozess mit SQLite; rechenintensive Arbeit
(PDF- und Word-Erzeugung, Textgewinnung aus Anhängen, Datenbank-Snapshots) erledigen Worker-Threads,
damit keine Anfrage darauf warten muss.

### Messwerte

Lasttest mit `scripts/loadtest.mjs` auf einem Arbeitsplatzrechner (AMD Ryzen 7 7700X, NVMe-SSD,
Windows 11, Node.js 24) mit **500 Konten, 40 Bereichen und 8 000 Seiten**. Simuliert werden
Seitenaufrufe, Navigation im Seitenbaum, Suchen und Speichern – **ohne Denkpausen**: Jeder Client
schickt die nächste Anfrage sofort nach der Antwort.

| Gleichzeitige Clients | Anfragen/s | Seite öffnen (p95) | Speichern (p95) | Suche (p95) | Fehler |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 531 | 95 ms | 99 ms | 107 ms | 0 |
| 50 | 520 | 175 ms | 180 ms | 182 ms | 0 |
| 100 | 485 | 341 ms | 338 ms | 352 ms | 0 |

*p95: 95 % der Anfragen waren schneller.* Vor den Leistungsoptimierungen in Version 1.2 lag der
Durchsatz bei 142, 121 bzw. 105 Anfragen pro Sekunde.

Als Faustregel erzeugt eine Person beim Lesen und Schreiben im Mittel eine Anfrage alle fünf bis zehn
Sekunden. **500 gleichzeitig aktive Personen entsprechen damit etwa 50–100 Anfragen pro Sekunde** –
ein Bruchteil des gemessenen Durchsatzes, mit Reserve für Spitzen, Exporte und Importe. Nicht im
Lasttest enthalten sind die WebSocket-Verbindungen der Echtzeit-Bearbeitung; sie übertragen je
geöffnetem Editor nur kleine Änderungen.

### Eigene Messung

Der Lasttest legt Testdaten in einem temporären Verzeichnis an, startet einen eigenen Server auf einem
freien Port und räumt danach auf – die produktiven Daten bleiben unberührt. Er eignet sich, um die
Zielhardware vor der Einführung zu prüfen:

```bash
node scripts/loadtest.mjs                                    # 500 Konten, 8 000 Seiten, 25/50/100 Clients
node scripts/loadtest.mjs --users 1000 --pages 20000 --stages 50,100,200 --seconds 30
```

Weitere Optionen: `--spaces` (Anzahl Bereiche), `--keep` (Testdaten behalten).

### Empfohlene Ausstattung

| Umfang | Server | Hinweis |
| --- | --- | --- |
| bis 100 Personen | 2 vCPU, 4 GB RAM, SSD | auch als VM neben anderen Diensten |
| bis 500 Personen | 4 vCPU, 8 GB RAM, SSD | eigene VM empfohlen |
| über 500 Personen | 8 vCPU, 16 GB RAM, NVMe-SSD | vorher mit dem Lasttest auf der Zielhardware prüfen |

- Anfragen verarbeitet ein Prozess – es zählt vor allem die **Einzelkernleistung**. Weitere Kerne nutzen
  die Worker-Threads und LibreOffice.
- **Speicherplatz**: Datenbank plus Anhänge, dazu die Sicherungen (je Stand eine Datenbankkopie und
  optional die Anhänge). Mit LibreOffice für die Office-Vorschau 1–2 GB RAM zusätzlich einplanen.

### Hinweise für den Betrieb

- Das Datenverzeichnis gehört auf eine **lokale SSD**, nicht auf eine Netzfreigabe (SMB/NFS) – SQLite
  braucht zuverlässige Dateisperren.
- **Virenscanner**: `knowstead.db`, `knowstead.db-wal` und `knowstead.db-shm` vom Echtzeit-Scan ausnehmen; Anhänge
  unter `data/uploads/` dürfen gescannt werden.
- Die Oberfläche liegt **vorkomprimiert** (Brotli und gzip) vor und wird mit langer Cache-Dauer
  ausgeliefert; der Proxy muss nichts nachkomprimieren.
- **Sicherungen** laufen im Hintergrund und blockieren den Betrieb nicht; die Uhrzeit trotzdem in eine
  ruhige Zeit legen, weil das Kopieren der Anhänge Plattenlast erzeugt.
- **Überwachung**: `GET /api/v1/health` für Verfügbarkeitsprüfungen; Kennzahlen unter
  Administration → Übersicht.
- **Grenzen**: Knowstead läuft als eine Instanz ohne Cluster. Ausfallsicherheit entsteht auf VM-Ebene
  (Neustart-Richtlinie, Snapshots) und über getestete Wiederherstellung aus der Sicherung.

---

## Benutzer, Gruppen, Rechte

Das Rechtesystem hat drei Ebenen:

### 1. Globale Rechte (über Gruppen)

| Recht | Bedeutung |
| --- | --- |
| `admin` | volle Administration |
| `spaces.create` | darf neue Bereiche anlegen |
| `users.manage` | Benutzer und Gruppen verwalten |
| `templates.manage` | globale Vorlagen pflegen |
| `integrations.manage` | Webhooks und API-Konnektoren |
| `audit.view` | Audit-Log einsehen |
| `api.tokens` | eigene API-Tokens erstellen |
| `ai.use` | KI-Assistent nutzen (wenn die KI eingerichtet ist) |

### 2. Bereichsrollen

| Rolle | Darf |
| --- | --- |
| **Betrachter** | lesen, exportieren |
| **Kommentator** | zusätzlich kommentieren |
| **Bearbeiter** | Seiten anlegen, ändern, verschieben, löschen, Dateien anhängen, Einschränkungen setzen |
| **Bereichsadministrator** | zusätzlich Berechtigungen, Prüfungen freigeben, Papierkorb leeren, Bereich verwalten |

Rollen lassen sich an Gruppen, einzelne Benutzer, „alle angemeldeten Benutzer“ und „anonyme Gäste“
vergeben (Bereich → Bereichseinstellungen → Berechtigungen).

### 3. Seiteneinschränkungen

Auf jeder Seite („…“ → Einschränkungen):

- **Ansicht einschränken** – vererbt sich an alle Unterseiten,
- **Bearbeitung einschränken** – gilt nur für diese Seite.

Globale Administratoren sehen und bearbeiten immer alles; eingeschränkte Seiten sind in den
Bereichseinstellungen unter „Eingeschränkte Seiten“ aufgelistet.

### Konten

- **Benutzer** melden sich mit Passwort oder über das Verzeichnis an.
- **Dienstkonten** (Typ „bot“) haben kein Passwort und dienen Automatisierungen – Tokens dafür legt
  ein Administrator an (Administration → Benutzer → Konto → Token erzeugen).
- Nach zu vielen Fehlversuchen sperrt sich ein Konto vorübergehend; Administratoren können die Sperre
  sofort aufheben (auch per `npm run cli -- user:unlock <name>`).
- **Selbstregistrierung** (Einstellungen → Zugriff & Sicherheit): Ist der E-Mail-Versand eingerichtet,
  bestätigen neue Konten ihre Adresse über einen Link und können sich erst danach anmelden. Eine
  Beschränkung auf **E-Mail-Domains** wirkt nur so – ohne E-Mail-Versand ist die Registrierung dann
  gesperrt. Unbestätigte Konten zeigt die Benutzerverwaltung mit „Freischalten“; nach sieben Tagen
  werden sie automatisch gelöscht.
- Die eigene **E-Mail-Adresse** lässt sich im Profil nur mit dem aktuellen Passwort ändern.

---

## Active Directory / LDAP

**Administration → Verzeichnis (AD/LDAP)**

### Einrichtung in vier Schritten

1. **Verbindung**: Server-URL (`ldaps://dc01.firma.local:636` empfohlen), Basis-DN
   (`DC=firma,DC=local`), Dienstkonto mit Leserecht und dessen Passwort.
2. **Felder** prüfen: Standardwerte passen für Active Directory
   (`sAMAccountName`, `displayName`, `mail`, `memberOf`).
3. **Testen**: „Verbindung prüfen“ – optional mit einem Testkonto samt Passwort. Das Ergebnis zeigt
   Schritt für Schritt, was gefunden wurde, inklusive der zugeordneten Knowstead-Gruppen.
4. **Gruppen zuordnen**: unter „Sicherheitsgruppen finden“ suchen, die Kennung kopieren und bei der
   passenden Knowstead-Gruppe (Administration → Gruppen) im Feld **AD-/LDAP-Sicherheitsgruppen**
   eintragen – je Zeile eine Kennung (CN, sAMAccountName oder vollständiger DN).

### Wie die Anmeldung abläuft

1. Knowstead sucht das Konto mit dem Dienstkonto im Verzeichnis.
2. Es meldet sich mit dem gefundenen DN und dem eingegebenen Passwort an – das ist die Passwortprüfung.
   Leere Passwörter werden nie akzeptiert.
3. Existiert das Konto in Knowstead noch nicht, wird es angelegt (abschaltbar).
4. Die Sicherheitsgruppen werden gelesen (optional inklusive verschachtelter Gruppen) und mit den
   Zuordnungen verglichen: passende Knowstead-Gruppen werden zugewiesen, nicht mehr passende entfernt.

### Empfehlungen

- **„Lokale Anmeldung zusätzlich erlauben“ aktiviert lassen** – sonst sperrt eine Störung im
  Verzeichnis alle aus, auch Administratoren.
- **„Pflicht-Sicherheitsgruppe“** setzen, wenn nur ein Teil der Belegschaft Zugang haben soll.
- **Zertifikatsprüfung** nur in Testumgebungen abschalten.
- Gruppen, die *nicht* aus dem Verzeichnis kommen sollen, bekommen keine Zuordnung oder den Haken
  „Mitgliedschaften automatisch abgleichen“ entfernt.
- Es werden **keine Verzeichnis-Passwörter gespeichert**; das Passwort des Dienstkontos liegt
  verschlüsselt in der Datenbank.

---

## Single Sign-on: Entra ID, SAML und Windows-Anmeldung

**Administration → Single Sign-on**

Neben Passwort und Active Directory kann sich die Belegschaft über den Identitätsanbieter des
Unternehmens anmelden. Alle drei Wege sind optional und lassen sich kombinieren; Gruppen werden wie beim
Active Directory über das Feld **Verzeichnis- und SSO-Gruppen** der Knowstead-Gruppen zugeordnet.

| Weg | Geeignet für | Technik |
| --- | --- | --- |
| **Microsoft Entra ID / OpenID Connect** | Microsoft 365, Keycloak, Okta, ADFS 2019 | Autorisierungscode mit PKCE, `state` und `nonce`; ID-Token-Prüfung mit `openid-client` |
| **SAML 2.0** | ADFS, Shibboleth, ältere Identitätsanbieter | signierte Assertions, Prüfung von Aussteller, Zielgruppe, Gültigkeit und `InResponseTo` (`@node-saml/node-saml`) |
| **Windows-Anmeldung (Kerberos)** | Arbeitsplätze in der Domäne, ohne Passworteingabe | vorgeschalteter Webserver prüft Kerberos und reicht das Konto weiter |

> [!IMPORTANT]
> Voraussetzung ist die öffentliche **HTTPS-Adresse** in `BASE_URL` – aus ihr entstehen Umleitungs-URI,
> Antwort-URL und Entity-ID. Nach einem Wechsel der Adresse die Angaben beim Identitätsanbieter anpassen.

### Microsoft Entra ID

1. Im **Microsoft Entra Admin Center** unter *Anwendungen → App-Registrierungen → Neue Registrierung*:
   - Name „Knowstead“, Kontotypen **„Nur Konten in diesem Organisationsverzeichnis“**,
   - Umleitungs-URI Plattform **Web**: `https://knowstead.firma.de/api/v1/auth/oidc/callback`.
2. *Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel* – den **Wert** kopieren (nicht die ID).
3. *Tokenkonfiguration → Gruppenanspruch hinzufügen*: **Sicherheitsgruppen**, im ID-Token als
   **Gruppen-ID**. Bei vielen Gruppen besser **„Der Anwendung zugewiesene Gruppen“** wählen und die
   gewünschten Gruppen unter *Unternehmensanwendungen → Knowstead → Benutzer und Gruppen* zuweisen.
4. Optional *Tokenkonfiguration → Optionalen Anspruch hinzufügen*: `email`, `preferred_username`.
5. In Knowstead: Anbieter **Microsoft Entra ID**, **Verzeichnis-ID (Mandanten-ID)** und **Anwendungs-ID
   (Client-ID)** aus der Übersicht der App-Registrierung, den **Clientschlüssel** eintragen,
   **Einstellungen speichern und prüfen**, aktivieren.
6. Unter **Administration → Gruppen** bei jeder Knowstead-Gruppe die **Objekt-ID** der Entra-Gruppe eintragen
   (eine je Zeile – AD-Namen für die Verzeichnisanmeldung dürfen daneben stehen).

| Knowstead-Feld | Vorgabe | Hinweis |
| --- | --- | --- |
| Claim für den Benutzernamen | `preferred_username` | UPN, z. B. `anna.schmidt@firma.de`; „Domain entfernen“ macht daraus `anna.schmidt` |
| Claim für den Anzeigenamen | `name` | |
| Claim für die E-Mail-Adresse | `email` | nur zum Befüllen des Profils – verknüpft wird **nie** über die E-Mail-Adresse |
| Claims mit Gruppen | `groups` | mehrere möglich, z. B. `groups roles` für App-Rollen |

- Kennung der Person ist die unveränderliche **Objekt-ID** (`oid`). Umbenennungen in Entra ID ändern die
  Zuordnung also nicht.
- **Mehr als 200 Gruppen**: Entra ID lässt den Gruppen-Claim dann weg. Knowstead lädt die Gruppen über
  Microsoft Graph nach, wenn die App die delegierte Berechtigung `GroupMember.Read.All` (mit
  Administratorzustimmung) hat und die Scopes um `https://graph.microsoft.com/GroupMember.Read.All`
  ergänzt sind. Ohne diese Berechtigung werden die Gruppen dieser Person nicht abgeglichen (Protokoll-
  Warnung) – einfacher ist „Der Anwendung zugewiesene Gruppen“.
- **Fehlt der Gruppen-Claim ganz**, gilt die Person als Mitglied keiner zugeordneten Gruppe: Mitgliedschaften
  in abgeglichenen Knowstead-Gruppen werden entzogen. So wirkt das Entfernen aus einer Entra-Gruppe zuverlässig.
- Mandantenübergreifende Anmeldung (`common`, `organizations`) ist gesperrt: Sonst könnte sich jedes
  Microsoft-Konto weltweit anmelden.

**Andere OpenID-Connect-Anbieter** (Keycloak, Okta, ADFS 2019): Anbieter „Anderer OpenID-Connect-Anbieter“,
**Aussteller-URL** (z. B. `https://sso.firma.de/realms/firma` – unter dieser Adresse muss
`/.well-known/openid-configuration` erreichbar sein), Client-ID und -Geheimnis. Bei Keycloak einen
„Group Membership“-Mapper mit Claim-Name `groups` anlegen. Kennung der Person ist `sub`.

### SAML 2.0

1. Beim Identitätsanbieter Knowstead als Anwendung/Relying Party anlegen – am einfachsten über die
   **Metadaten-Adresse** `https://knowstead.firma.de/api/v1/auth/saml/metadata`, sonst manuell:
   - **Bezeichner (Entity-ID)**: `https://knowstead.firma.de/api/v1/auth/saml/metadata`
   - **Antwort-URL (ACS)**: `https://knowstead.firma.de/api/v1/auth/saml/acs` (HTTP-POST)
   - **Anmelde-URL**: `https://knowstead.firma.de/api/v1/auth/saml/start`
2. Assertions **signieren** lassen (SHA-256). Knowstead verlangt eine signierte Assertion.
3. Attribute/Claims freigeben: Benutzername (oder als NameID), Anzeigename, E-Mail, Gruppen.
4. In Knowstead **Anmelde-URL** des Anbieters, dessen **Entity-ID** und das **Signaturzertifikat** (PEM oder
   Base64 aus den Metadaten) eintragen, **Einstellungen speichern und prüfen**, aktivieren.

| Knowstead-Feld | Vorgabe (Entra ID) |
| --- | --- |
| Attribut für den Benutzernamen | leer = NameID |
| Attribut für den Anzeigenamen | `http://schemas.microsoft.com/identity/claims/displayname` |
| Attribut für die E-Mail-Adresse | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` |
| Attribut mit Gruppen | `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` |

- **Vom Anbieter angestoßene Anmeldung** (z. B. Kachel im Microsoft-365-Portal ohne Anmelde-URL) wird
  abgelehnt – sie wäre anfällig für untergeschobene Anmeldungen. Mit eingetragener **Anmelde-URL**
  funktioniert die Kachel trotzdem.
- **Zertifikatswechsel**: neues Zertifikat unter dem alten einfügen, speichern, beim Anbieter umstellen,
  später das alte entfernen. **SAML: Einstellungen prüfen** zeigt Ablaufdatum und Fingerabdruck.
- Transiente NameIDs wechseln bei jeder Anmeldung – dann das Benutzername-Attribut als Kennung eintragen.

### Windows-Anmeldung (Kerberos)

Browser in der Domäne melden sich per Kerberos (SPNEGO) an, ohne dass ein Passwort eingegeben wird.
Die Kerberos-Prüfung übernimmt ein **vorgeschalteter Webserver**, der ohnehin als Reverse-Proxy vor
Knowstead steht. Er schützt nur die Adresse `/api/v1/auth/kerberos` und reicht das geprüfte Konto in einer
Kopfzeile weiter:

```text
Browser ──Kerberos──▶ Webserver (Apache / IIS) ──X-Remote-User: FIRMA\anna──▶ Knowstead (nur von dieser IP)
```

**In Knowstead:**

| Feld | Wert |
| --- | --- |
| Kopfzeile mit dem Konto | `X-Remote-User` (Vorgabe) |
| Vertrauenswürdige Webserver | IP-Adresse(n) des Proxys, z. B. `127.0.0.1` und `::1`, wenn er auf demselben Rechner läuft |
| Gemeinsames Geheimnis | lange Zufallszeichenfolge – der Proxy sendet sie in `X-Knowstead-Proxy-Secret` |
| Automatisch anmelden | Anmeldeseite startet die Windows-Anmeldung selbst (nur, wenn alle Arbeitsplätze in der Domäne sind) |

Knowstead wertet die Kopfzeile **nur** auf dieser einen Adresse, **nur** von den eingetragenen IP-Adressen
(maßgeblich ist die Socket-Adresse, nicht `X-Forwarded-For`) und – falls gesetzt – nur mit passendem
Geheimnis aus. Ist die Verzeichnisanbindung eingerichtet, kommen Anzeigename, E-Mail und Gruppen aus dem
Active Directory (per Dienstkonto, ohne Passwort); sonst wird das Konto über den Benutzernamen gefunden
bzw. – falls erlaubt – angelegt.

**Dienstprinzipal und Keytab** (einmalig, auf einem Domänencontroller):

```powershell
# Dienstkonto svc-knowstead anlegen (Kennwort läuft nicht ab), dann:
setspn -S HTTP/knowstead.firma.de FIRMA\svc-knowstead
ktpass -princ HTTP/knowstead.firma.de@FIRMA.LOCAL -mapuser FIRMA\svc-knowstead -crypto AES256-SHA1 `
       -ptype KRB5_NT_PRINCIPAL -pass * -out knowstead.keytab
```

**Apache mit `mod_auth_gssapi`** (Linux: Paket `libapache2-mod-auth-gssapi`):

```apache
# Eine vom Browser mitgeschickte Kopfzeile nie durchreichen
RequestHeader unset X-Remote-User early
RequestHeader unset X-Knowstead-Proxy-Secret early

<Location "/api/v1/auth/kerberos">
  AuthType GSSAPI
  AuthName "Knowstead – Windows-Anmeldung"
  GssapiCredStore keytab:/etc/apache2/knowstead.keytab
  GssapiAllowedMech krb5
  GssapiLocalName On
  Require valid-user
  RequestHeader set X-Remote-User "%{REMOTE_USER}s"
  RequestHeader set X-Knowstead-Proxy-Secret "HIER-DAS-GEHEIMNIS"
</Location>
```

**IIS**: Die Windows-Authentifizierung ist dort erst nach der URL-Umschreibung bekannt; ARR kann das
Konto deshalb nicht direkt in eine Kopfzeile schreiben. Bewährt hat sich ein kleines ASP.NET-Modul, das
nach der Anmeldung die Kopfzeile setzt (Rolle *ASP.NET 4.8* und *Windows-Authentifizierung* installieren):

```csharp
// App_Code\KnowsteadRemoteUser.cs im Ordner der Website
using System;
using System.Web;

public class KnowsteadRemoteUser : IHttpModule
{
    public void Init(HttpApplication app)
    {
        app.PostAuthenticateRequest += (sender, e) =>
        {
            var ctx = ((HttpApplication)sender).Context;
            ctx.Request.Headers.Remove("X-Remote-User");
            ctx.Request.Headers.Remove("X-Knowstead-Proxy-Secret");
            if (ctx.Request.Path.StartsWith("/api/v1/auth/kerberos", StringComparison.OrdinalIgnoreCase)
                && ctx.User != null && ctx.User.Identity.IsAuthenticated)
            {
                ctx.Request.Headers.Set("X-Remote-User", ctx.User.Identity.Name);
                ctx.Request.Headers.Set("X-Knowstead-Proxy-Secret", "HIER-DAS-GEHEIMNIS");
            }
        };
    }
    public void Dispose() { }
}
```

```xml
<!-- web.config: Ergänzungen zur Proxy-Konfiguration aus der Installationsanleitung -->
<system.webServer>
  <modules>
    <add name="KnowsteadRemoteUser" type="KnowsteadRemoteUser" />
  </modules>
</system.webServer>
<location path="api/v1/auth/kerberos">
  <system.webServer>
    <security>
      <authentication>
        <anonymousAuthentication enabled="false" />
        <windowsAuthentication enabled="true" useKernelMode="true">
          <providers><clear /><add value="Negotiate" /></providers>
        </windowsAuthentication>
      </authentication>
    </security>
  </system.webServer>
</location>
```

Die Abschnitte `authentication` müssen in `applicationHost.config` zum Überschreiben freigegeben sein
(`appcmd unlock config -section:system.webServer/security/authentication/windowsAuthentication`).

> [!WARNING]
> Diese Proxy-Beispiele hängen von Domäne, Webserver-Version und Gruppenrichtlinien ab und sollten vor dem
> Produktivbetrieb in einer Testumgebung geprüft werden. **Administration → Single Sign-on** zeigt am
> Seitenende, von welcher Adresse die Anfrage kam und ob sie als vertrauenswürdiger Webserver gilt.

**Browser**: Die Knowstead-Adresse muss für Kerberos freigegeben sein – per Gruppenrichtlinie in der Zone
„Lokales Intranet“ (Edge/Chrome: Richtlinie `AuthServerAllowlist` = `knowstead.firma.de`), in Firefox über
`network.negotiate-auth.trusted-uris`. Die Adresse muss der Name aus dem SPN sein, keine IP-Adresse.

### Kontoregeln und Sicherheit

| Regel | Vorgabe | Wirkung |
| --- | --- | --- |
| Konten bei der ersten Anmeldung anlegen | an | sonst nur für bereits verknüpfte Konten |
| Vorhandene Konten gleichen Namens übernehmen | aus | verknüpft ein lokales Konto über den Benutzernamen und entfernt dessen Passwort |
| Gruppen abgleichen | an | setzt und entzieht Mitgliedschaften in Knowstead-Gruppen mit Zuordnung |
| Pflichtgruppe | leer | nur Mitglieder dürfen sich anmelden |
| Domain vom Benutzernamen entfernen | an | `anna.schmidt@firma.de` → `anna.schmidt` |
| Anmeldeformular für lokale Konten anzeigen | an | ausgeschaltet nur SSO-Knöpfe, Formular über „Mit lokalem Konto anmelden“ |

- **Administratorkonten** werden nie automatisch verknüpft. Sie verknüpfen sich selbst unter
  **Profil → Anmeldung** (Anmeldung beim Anbieter in derselben Browsersitzung).
- Jeder Anmeldevorgang ist über ein kurzlebiges Cookie an den Browser gebunden, der ihn begonnen hat;
  Antworten sind nur einmal verwendbar.
- Verknüpfte Konten einer Person sieht und trennt die Benutzerverwaltung unter
  **Administration → Benutzer → Sicherheit**.
- SSO-Konten setzen kein Passwort über „Passwort vergessen“ – gesperrte Konten beim Anbieter bleiben
  so gesperrt.
- Audit-Log: `auth.login` (mit `via`), `auth.login_failed` (Grund `sso_…`), `auth.identity_linked`,
  `auth.identity_unlinked`.

---

## E-Mail

**Administration → E-Mail**

Knowstead verschickt E-Mails für Benachrichtigungen (Erwähnungen, Kommentare, beobachtete Seiten, Prüfungen,
Aufgaben, Wiedervorlagen), tägliche Zusammenfassungen, Einladungen und Links zum Zurücksetzen des
Passworts.

### Einrichtung

1. **Vorlage** wählen – sie setzt Server, Port und Verschlüsselung gängiger Anbieter.
2. **Absender** (z. B. `knowstead@firma.de` oder `Knowstead <knowstead@firma.de>`), bei Bedarf **Antwortadresse**,
   **Benutzer** und **Passwort** eintragen. Das Passwort wird verschlüsselt gespeichert und nie wieder
   angezeigt.
3. **Verbindung prüfen** meldet sich am Server an, ohne etwas zu verschicken; **Test-E-Mail** schickt
   sofort eine Nachricht an eine Adresse. Fehler werden verständlich erklärt (Port passt nicht zur
   Verschlüsselung, Zertifikat, Anmeldung, Firewall).
4. **Benachrichtigungen per E-Mail versenden** einschalten und die Uhrzeit der **täglichen
   Zusammenfassung** festlegen (Serverzeit).

| Vorlage | Server und Port | Hinweise |
| --- | --- | --- |
| Microsoft 365 (mit Anmeldung) | `smtp.office365.com:587`, STARTTLS | Postfach mit erlaubtem „Authentifiziertem SMTP“; Absender = dieses Postfach oder „Senden als“-Recht |
| Microsoft 365 – Relay über Connector | `<domain>.mail.protection.outlook.com:25`, STARTTLS | ohne Anmeldung; im Exchange Admin Center einen Connector für die feste öffentliche IP des Knowstead-Servers anlegen |
| Exchange im eigenen Netz | eigener Server, Port 25, STARTTLS | Knowstead-Server als Relay zulassen, meist ohne Anmeldung |
| Google Workspace | `smtp.gmail.com:587`, STARTTLS | App-Passwort oder SMTP-Relay-Dienst |
| IONOS / STRATO | `smtp.ionos.de:587` STARTTLS / `smtp.strato.de:465` TLS | vollständige E-Mail-Adresse als Benutzer |

> [!IMPORTANT]
> Microsoft schaltet die Anmeldung mit Benutzername und Passwort (Basic Auth) für SMTP in Exchange
> Online schrittweise ab. Meldet die Verbindungsprüfung, dass die Anmeldung nicht erlaubt ist, den
> **Relay über einen Connector** oder einen internen SMTP-Relay verwenden.

### Zustellung und Protokoll

- E-Mails werden nie während einer Anfrage verschickt, sondern in eine **Warteschlange** gelegt und im
  Hintergrund über eine wiederverwendete Verbindung zugestellt – auch wenn eine Änderung an Hunderte
  Beobachter geht, bleibt die Oberfläche schnell.
- Fehlgeschlagene Zustellungen werden bis zu **fünfmal** wiederholt (nach 1, 5, 30 und 120 Minuten).
- Das **Versandprotokoll** zeigt die letzten 30 Tage mit Status, Versuchen und Fehlermeldung; einzelne
  oder alle fehlgeschlagenen E-Mails lassen sich erneut senden.

### Persönliche Einstellungen

Jede Person legt unter **Profil & Einstellungen → Einstellungen** fest, ob sie E-Mails **sofort**, als **tägliche
Zusammenfassung** oder **gar nicht** erhält, und ob nur Persönliches kommen soll (Erwähnungen,
Antworten, Prüfungen, Aufgaben, Wiedervorlagen). Dort steht auch der Vorlauf für
**Aufgaben-Erinnerungen**. Erinnerungen (Aufgaben, Wiedervorlage) und Zusammenfassungen werden erst ab
der Uhrzeit der täglichen Zusammenfassung verschickt.

---

## Bereiche und Struktur

- **Bereich** = abgeschlossener Raum mit eigenem Seitenbaum und eigenen Berechtigungen.
- **Kategorie**: gliedert die Navigation links und das Bereichsverzeichnis, z. B. „Abteilungen“,
  „Projekte“, „Archiv“ (siehe unten).
- **Startseite**: jede Seite der obersten Ebene ohne Unterseiten kann Startseite werden.
- **Persönliche Bereiche** (`~benutzername`) entstehen auf Wunsch automatisch und sind nur für die
  Besitzerin bzw. den Besitzer sichtbar.
- **Archivieren** friert einen Bereich ein (nur noch lesen und exportieren), **Löschen** entfernt ihn
  mit allen Seiten und Dateien unwiderruflich (Bereichseinstellungen → Archivieren & Löschen).

### Kategorien verwalten

Die Gruppen in der Navigation (etwa „Abteilungen“ und „Projekte“) sind **Kategorien**. Sie werden unter
**Administration → Bereiche → Kategorien** gepflegt:

| Aufgabe | So geht’s |
| --- | --- |
| Kategorie hinzufügen | Namen eintragen, **Hinzufügen** |
| Umbenennen | auf den Namen klicken – alle zugeordneten Bereiche wandern mit |
| Symbol ändern | auf das Symbol links klicken |
| Reihenfolge | Pfeile nach oben/unten – die Reihenfolge gilt in Navigation und Bereichsverzeichnis |
| Entfernen | Papierkorb-Symbol – die Bereiche bleiben erhalten und erscheinen unter „Weitere Bereiche“ |

Einem Bereich wird die Kategorie in der Bereichsliste darunter, in den **Bereichseinstellungen →
Allgemein** oder direkt beim Anlegen zugeordnet. Ein **Bereich** selbst verschwindet aus der Navigation,
wenn er archiviert oder gelöscht wird; ein neuer Bereich entsteht über **Bereiche → Neuer Bereich**
(Recht `spaces.create`).

Bewährte Struktur:

```
Kategorie „Unternehmen“    → Handbuch, Richtlinien, Organisation
Kategorie „Abteilungen“    → IT, Personal, Vertrieb
Kategorie „Projekte“       → Projekt A, Projekt B
Kategorie „Archiv“         → abgeschlossene Projekte (archiviert)
```

---

## Redaktionsprüfung, Wiedervorlage und Wiederherstellung

### Prüfung (Review)

- **Freiwillig**: jede Seite kann über „…“ → **Prüfung anfordern** zur Freigabe gegeben werden.
- **Verpflichtend**: In den Bereichseinstellungen **„Änderungen müssen freigegeben werden“**
  aktivieren. Dann landet jede Änderung von Personen ohne Prüfrecht automatisch als Auftrag in der
  Liste **Prüfaufträge**; die Seite bleibt sichtbar und ist als „In Prüfung“ markiert.
- Prüfen darf, wer im Bereich moderieren kann (Bereichsadministratoren und globale Administratoren).
- Entscheidungen (freigegeben/zurückgewiesen) landen im Seitenkopf, in den Benachrichtigungen und im
  Ereignisprotokoll.

### Wiedervorlage

Die Wiedervorlage sorgt dafür, dass Inhalte regelmäßig geprüft werden – etwa „alle 12 Monate“ für
Richtlinien und Arbeitsanweisungen.

- **Vorgabe je Bereich** (Bereichseinstellungen → Allgemein → Wiedervorlage): Prüfintervall für alle
  Seiten ohne eigene Einstellung, optional ein **Plan**, in dem überfällige Prüfungen als Aufgabe
  angelegt werden.
- **Je Seite** (**… → Verantwortung & Wiedervorlage**): verantwortliche Person und eigenes Intervall
  (1, 3, 6, 12, 24, 36 Monate oder keine Wiedervorlage).
- **Als geprüft gilt eine Seite**, wenn die verantwortliche Person oder jemand mit Schreibrecht **„Als
  aktuell bestätigen“** wählt, die verantwortliche Person eine nicht als geringfügig markierte Änderung
  veröffentlicht, eine Redaktionsprüfung freigegeben oder die Wiedervorlage-Aufgabe im Plan erledigt
  wird.
- **Erinnerungen** gehen 14 Tage vor der Fälligkeit und bei Überfälligkeit an die verantwortliche
  Person – ist keine festgelegt, an die zuletzt bearbeitende Person. Ein stündlicher Lauf verschickt
  jede Erinnerung nur einmal und erst ab der Uhrzeit der täglichen Zusammenfassung.
- Die Übersicht **Wiedervorlage** (linke Navigation) zeigt eigene oder alle sichtbaren Seiten mit
  Handlungsbedarf; Fälligkeiten erscheinen auch im **Kalender-Abo** der Verantwortlichen.

### Mehrstufige Freigabeabläufe und Vertretungen

**Bereichseinstellungen → Freigaben** legt fest, welche Stufen eine Prüfung durchläuft (z. B.
*Fachbereich → Qualitätsmanagement → Veröffentlichung*): je Stufe Freigebende (Gruppen oder Personen),
nötige Anzahl an Freigaben (1–10) und optional eine Eskalation nach Tagen. „Jede Stufe durch eine andere
Person“ verhindert, dass dieselbe Person mehrere Stufen einer Version freigibt.

- Der Ablauf gilt für angeforderte Prüfungen und – bei Prüfpflicht – für jede Änderung, auch von
  Moderatoren. Eine neue Version setzt den Ablauf auf die erste Stufe zurück.
- **Vertretungen** trägt jede Person unter **Profil → Vertretung** ein; die Benutzerverwaltung kann das
  auch für andere tun (`POST /api/v1/admin/users/:id/deputies`). Entscheidungen in Vertretung werden mit
  „in Vertretung für …“ protokolliert.
- Eskalationen und Erinnerungen laufen stündlich mit den übrigen Hintergrundaufgaben.

### Lesebestätigungen

Pflichtdokumente (Richtlinien, Unterweisungen, Datenschutz) fordert die Bereichsverwaltung über
**… → Lesebestätigung …** an: Zielgruppe, Text der Bestätigung, Frist, optionale Wiederholung (z. B. alle
12 Monate) und erneute Bestätigung bei neuen Versionen. Knowstead erinnert bei der Anforderung, drei Tage vor
der Frist und einmalig bei Überschreitung – über die vorhandenen Benachrichtigungs- und E-Mail-Wege.

- **Nachweis**: je Person Status, Zeitpunkt, Version und bestätigter Text; Export als CSV.
- Personen, die die Seite nicht lesen dürfen, werden gesondert ausgewiesen und nicht erinnert.
- Die Übersicht **Lesebestätigungen** zeigt jeder Person ihre offenen Dokumente und der
  Bereichsverwaltung den Fortschritt aller Anforderungen.

### Vorschlagsmodus

Seiten lassen sich auf **„Nur Vorschläge“** stellen (**… → Bearbeitungsmodus …**, Vorgabe für neue Seiten
in den Bereichseinstellungen). Änderungen anderer Personen erscheinen dann als markierte Vorschläge, die
Autorin bzw. Autor, verantwortliche Person oder Bereichsverwaltung annehmen oder ablehnen. Die
Bereichsverwaltung kann den Modus festschreiben. Der Server prüft beim Speichern, dass Personen ohne
Entscheidungsrecht wirklich nur Vorschläge eintragen; Ansicht, Suche und Exporte zeigen den Text ohne
offene Vorschläge.

### Inhaltsanalyse

Die **Inhaltsanalyse** (Hauptmenü) liefert der Redaktion Arbeitslisten: meistgelesene und ungelesene
Seiten, Suchbegriffe ohne Treffer, verwaiste Seiten und defekte Verweise. Die Bereichsverwaltung sieht
ihre Bereiche, das globale Recht **Inhaltsanalyse einsehen** (`analytics.view`) alle lesbaren Bereiche
samt Suchbegriffen.

- Gespeichert werden Aufrufe je Seite und Tag sowie erfolglose Suchbegriffe – **ohne** Personenbezug.
- Aufbewahrung: Aufrufe 400 Tage, Suchbegriffe 180 Tage (**Wartung → Alte Protokolle entfernen** räumt
  zusätzlich auf).
- Verweise werden beim Speichern jeder Seite ausgewertet; nach einem Update baut Knowstead sie einmalig für
  alle Seiten auf.

### Wiederherstellung

- **Letzte Änderungen** (Hauptmenü) zeigt die jüngsten 25–200 Bearbeitungen aller sichtbaren Bereiche.
  Ein Klick auf **Rückgängig** setzt die Seite auf den Stand vor dieser Änderung zurück – als **neue**
  Version, es geht also nichts verloren.
- Jede Seite hat zusätzlich ihre vollständige **Versionsgeschichte** mit Vergleich und
  Wiederherstellung.
- Gelöschte Seiten liegen im **Papierkorb** des Bereichs, gelöschte Anhänge in der Anhangsliste der Seite
  (Aufbewahrung einstellbar, Standard 30 Tage – danach werden beide endgültig entfernt).
- Nach dem **endgültigen Löschen** (Papierkorb leeren, Bereich löschen) bleiben die Dateien der
  Anhänge noch 30 Tage auf dem Datenträger – eine zurückgespielte Sicherung findet sie also noch.
- Vor dem **Löschen eines Bereichs** sichert Knowstead die Datenbank automatisch (`backup-…-loeschung`).

---

## Gleichzeitiges Bearbeiten in Echtzeit

Mehrere Personen können eine **Rich-Text-Seite** gleichzeitig bearbeiten: Änderungen erscheinen sofort
bei allen, farbige Cursor zeigen, wer wo schreibt. Markdown- und Code-Seiten werden weiterhin
nacheinander bearbeitet (mit Konflikterkennung beim Veröffentlichen).

- **Einschalten/Ausschalten**: Administration → Einstellungen → Zugriff & Sicherheit →
  „Gleichzeitiges Bearbeiten in Echtzeit“ (Standard: an).
- **Voraussetzung**: WebSocket-Verbindungen zu `/api/v1/collab/<seite>` – ein Reverse-Proxy muss
  Upgrade-Anfragen durchreichen (siehe [Reverse-Proxy](#reverse-proxy)). Ohne Verbindung arbeitet der
  Editor automatisch wie bisher mit persönlichen Entwürfen.
- **Speichern und Veröffentlichen**: Der gemeinsame Stand wird laufend in der Datenbank gesichert
  (Tabelle `collab_documents`) und übersteht Neuladen, Verbindungsabbrüche und Neustarts. Eine neue
  **Version** entsteht erst beim Veröffentlichen; wer veröffentlicht, wird im Änderungsprotokoll
  genannt.
- **Rechte**: Verbinden darf nur, wer die Seite bearbeiten darf; das wird alle 30 Sekunden erneut
  geprüft (entzogene Rechte, gesperrte Konten, abgelaufene Sitzungen trennen die Verbindung).
- **Grenzen**: bis zu 40 Verbindungen je Seite und 12 je Person; ein gemeinsames Dokument darf
  höchstens 32 MB groß werden (sonst trennt der Server mit einem Hinweis – große Bilder als Anhang
  hochladen).
- Wird eine Seite außerhalb der gemeinsamen Bearbeitung geändert (API, Wiederherstellen einer Version),
  sehen die Bearbeitenden einen Hinweis und können den gemeinsamen Stand verwerfen oder bewusst
  darüber veröffentlichen.

---

## Systemeinstellungen

**Administration → Einstellungen**

| Gruppe | Wichtige Werte |
| --- | --- |
| Allgemein | Name, Untertitel, Standardsprache (Deutsch/Englisch), Akzentfarbe, Fußzeile |
| Zugriff & Sicherheit | Selbstregistrierung (mit Domain-Filter), anonymer Lesezugriff, persönliche Bereiche, gleichzeitiges Bearbeiten in Echtzeit, Sitzungsdauer, Passwortregeln, Sperre nach Fehlversuchen |
| Inhalte & Dateien | Upload-Grenze, gesperrte Dateiendungen, erlaubte Einbettungs-Hosts, Aufbewahrung von Papierkorb, Versionen und Ereignissen |
| Sicherungen | automatisch, Uhrzeit, Anzahl, Anhänge einschließen |
| Warnungen an die Administration | E-Mail an alle Administratorkonten, weitere Empfänger, Schwelle für freien Speicher, Höchstalter der Sicherung, Testwarnung ([Warnungen und Überwachung](#warnungen-und-überwachung)) |

Eigene Seiten haben **E-Mail** (SMTP, Benachrichtigungen, Versandprotokoll), **Single Sign-on**,
**KI & Dateien** (KI, Office-Vorschau, Texterkennung, draw.io) und **Export-Vorlage** (PDF und Word).

**Sprache**: Die Oberfläche gibt es auf Deutsch und Englisch. Jede Person wählt die Sprache im
Benutzermenü; sie wird im Profil gespeichert und gilt auch für E-Mails, Benachrichtigungen, Fehlermeldungen
und Exporte. Die **Standardsprache** gilt für alle ohne eigene Wahl. Wird bei der Ersteinrichtung Englisch
gewählt, legt Knowstead Handbuch, Vorlagen und Beispielinhalte auf Englisch an (`docs/handbook` statt
`docs/handbuch`).

Einstellungen lassen sich auch per Kommandozeile setzen:

```bash
npm run cli -- settings:get
npm run cli -- settings:set maxUploadMb 200
```

---

## KI-Anbindung

**Administration → KI & Dateien**. Die KI ist ausgeschaltet, bis sie ausdrücklich aktiviert wird.

| Anbieter | Basis-URL | Schlüssel | Hinweis |
| --- | --- | --- | --- |
| Anthropic (Claude) | leer = `https://api.anthropic.com` | API-Schlüssel aus der Anthropic Console | Modelle z. B. `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` |
| OpenAI | leer = `https://api.openai.com` | API-Schlüssel | Modellname laut Anbieter |
| Azure OpenAI | `https://<ressource>.openai.azure.com/openai/deployments/<deployment>` | Schlüssel der Ressource | Daten bleiben im gewählten Azure-Rechenzentrum |
| Ollama | `http://<server>:11434` | – | vollständig lokal, z. B. `llama3.1`, `mistral`, `qwen2.5` |
| OpenAI-kompatibel | Adresse des Dienstes (ohne `/v1`) | falls nötig | z. B. vLLM, LM Studio, LiteLLM-Proxy |

Empfohlenes Vorgehen:

1. Anbieter, Modell und Schlüssel eintragen, **Verbindung testen**.
2. **Freigeschaltete Funktionen** auswählen, **Tageslimit je Person** festlegen (Standard 100, `0` = unbegrenzt).
3. Optional eine **zusätzliche Anweisung** hinterlegen (Tonalität, Fachbegriffe, Duzen/Siezen).
4. **Aktivieren** und speichern, dann das Recht `ai.use` den gewünschten Gruppen geben.

Datenschutz und Nachvollziehbarkeit:

- Übertragen wird nur, was eine Person ausdrücklich an die KI schickt (Markierung bzw. geöffnete
  Seite, max. 24 000 Zeichen) – und nur Inhalte, die diese Person lesen darf.
- Jede Anfrage wird in `ai_usage` (Aktion, Modell, Token, Dauer, Fehler) und im **Audit-Log**
  (`ai.used`) festgehalten; die Statistik der letzten 30 Tage steht auf der Einstellungsseite.
- Der Schlüssel liegt AES-256-GCM-verschlüsselt in der Datenbank und wird nie wieder angezeigt.
- Für vertrauliche Bereiche eignet sich ein lokales Modell (Ollama) im eigenen Netz. Prüft bei
  Cloud-Anbietern Auftragsverarbeitung, Speicherort und Aufbewahrung beim Anbieter.

Wenn die Firewall ausgehende Verbindungen beschränkt, muss der **Server** (nicht der Browser) den
Anbieter erreichen können.

---

## Dateien: Vorschau, Anhangsuche, draw.io, Whiteboard

### Office- und Visio-Vorschau

PowerPoint, Word, Excel, Visio und OpenDocument werden für die Anzeige serverseitig in PDF
umgewandelt. Dafür wird **LibreOffice** benötigt. Am einfachsten installiert es der Installationsassistent
und schaltet die Vorschau gleich ein (`sudo bash install.sh --unattended --install-office` bzw.
`Knowstead-Installation.cmd -Unattended -InstallLibreOffice`). Von Hand:

```bash
# Debian/Ubuntu – ohne grafische Oberfläche, mit Schriften für einen stimmigen Umbruch
sudo apt install --no-install-recommends libreoffice-core-nogui libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea
```

Eingetragen wird das Programm `soffice`. LibreOffice als Snap-Paket eignet sich nicht: Im Snap sieht es das
Arbeitsverzeichnis des Dienstes nicht.

Unter Windows den LibreOffice-Installer verwenden; gesucht wird automatisch unter
`C:\Program Files\LibreOffice\program\soffice.exe`.

Danach unter **Administration → KI & Dateien** die Office-Vorschau aktivieren (Pfad optional). Die
Statusanzeige meldet, ob der Konverter gefunden wurde. Umgewandelte Dateien liegen in
`data/previews/` (pro Dateiinhalt einmal); das Verzeichnis darf jederzeit geleert werden.

> Jede Umwandlung läuft als eigener Prozess ohne Shell, mit Zeitlimit und separatem Profil.
> Dateien über 60 MB werden nicht umgewandelt. Visio-Dateien werden von LibreOffice gut, aber nicht
> immer pixelgenau dargestellt.

### draw.io

Standardmäßig wird der Editor von `https://embed.diagrams.net` geladen; die Diagrammdaten werden im
Browser übergeben und nur in Knowstead gespeichert. Für Netze ohne Internet oder aus Datenschutzgründen
lässt sich draw.io selbst betreiben:

```bash
docker run -d --name drawio -p 8080:8080 jgraph/drawio
```

Die Adresse (z. B. `https://drawio.firma.local`) unter **Administration → KI & Dateien → draw.io**
eintragen. Knowstead ergänzt sie automatisch in der Content-Security-Policy (`frame-src`).

### Volltextsuche in Anhängen

Knowstead liest den Text hochgeladener Dateien und nimmt ihn in einen eigenen Suchindex auf
(`attachments_fts`). Treffer erscheinen in der Suche mit Textauszug – nur für Anhänge auf Seiten, die
die suchende Person lesen darf, und nur in der jeweils neuesten Version der Datei.

| Format | Gelesen |
| --- | --- |
| PDF | Textebene; gescannte Seiten über die Texterkennung (siehe unten) |
| Bilder | nur über die Texterkennung |
| Word, Excel, PowerPoint, Visio (`.docx`, `.xlsx`, `.pptx`, `.vsdx`) | direkt, inklusive Tabellenblättern und Notizen |
| OpenDocument, RTF, HTML, Text-, CSV-, Code- und Konfigurationsdateien | direkt |
| `.doc`, `.xls`, `.ppt`, `.vsd` | über LibreOffice, wenn die Office-Vorschau eingerichtet ist |

- Die Textgewinnung läuft in einem **Worker-Thread** im Hintergrund, mit Zeitlimit je Datei; Dateien
  über 150 MB werden übersprungen, je Datei werden höchstens 2 Mio. Zeichen indexiert.
- Neue Dateien sind nach wenigen Sekunden auffindbar, bestehende werden nach einem Update nach und
  nach gelesen.
- **Wartung → Anhänge neu indexieren** liest alle Dateien erneut (z. B. nachdem LibreOffice
  eingerichtet wurde); den Stand zeigt `GET /api/v1/admin/attachments/index`.

### Texterkennung (OCR) für Scans und Bilder

Gescannte PDFs und Bilder (PNG, JPEG, TIFF, BMP, GIF, WebP) enthalten keine Textebene. Mit **Tesseract**
auf dem Server erkennt Knowstead den Text und nimmt ihn in die Anhangsuche auf.

```bash
# Debian/Ubuntu – deutsche und englische Sprachdaten
sudo apt install tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng
# Alpine (eigenes Docker-Image)
apk add tesseract-ocr tesseract-ocr-data-deu tesseract-ocr-data-eng
```

Unter Windows den Installer von *Tesseract at UB Mannheim* verwenden und bei der Installation die
Sprachdaten „German“ auswählen (gefunden wird `C:\Program Files\Tesseract-OCR\tesseract.exe`).

**Administration → KI & Dateien → Texterkennung**: aktivieren, bei Bedarf Pfad, **Sprachen**
(`deu+eng`) und **Seiten je PDF** (Vorgabe 30) festlegen. Die Statusanzeige meldet Version, installierte
und fehlende Sprachen sowie die Zahl erkannter Dateien.

- Beim Aktivieren werden vorhandene Anhänge ohne Textebene erneut eingereiht und im Hintergrund erkannt.
- Die Erkennung läuft außerhalb des Serverprozesses (`tesseract` mit einem Thread je Aufruf) mit
  Zeitlimit; Bilder werden aus den PDF-Seiten extrahiert, kleine Grafiken (unter 64 Pixel) übersprungen.
- Die Erkennungsqualität hängt von der Scanauflösung ab (empfohlen 300 dpi).

### Whiteboard

Das Makro **Whiteboard** (Excalidraw) ist ohne Einrichtung verfügbar. Editor und Schriften liefert
Knowstead selbst aus, es werden keine externen Dienste geladen – das Whiteboard funktioniert auch in Netzen
ohne Internetzugang. Gespeichert werden die Zeichnung (bearbeitbar) und eine SVG-Grafik für Anzeige,
Versionsvergleich und Export.

---

## Export-Vorlage für PDF und Word

**Administration → Export-Vorlage** legt fest, wie Seiten und ganze Bereiche als **PDF** oder
**Word-Dokument** aussehen:

| Einstellung | Wirkung |
| --- | --- |
| Firma, Logo, Hausfarbe | Deckblatt, Überschriften, Tabellenköpfe und Linien |
| Schriftart | Schrift im Word-Dokument (das PDF bettet seine Schrift selbst ein) |
| Deckblatt, Inhaltsverzeichnis | Voreinstellung im Exportdialog – im Einzelfall abwählbar |
| Kopf- und Fußzeile | Text mit Platzhaltern, rechts ergänzt um Seitenzahlen |
| Vertraulichkeit | z. B. „Intern“ oder „Vertraulich“ auf Deckblatt und in der Kopfzeile |
| Papierformat | A4 oder Letter |

Platzhalter: `{company}`, `{title}`, `{space}`, `{date}`, `{version}`, `{author}`, `{owner}`,
`{classification}`. Leere Werte samt überflüssiger Trennzeichen entfallen automatisch.
**Musterdokument** erzeugt ein PDF oder Word-Dokument mit der noch nicht gespeicherten Vorlage.

- Personen exportieren über **… → Exportieren** eine Seite (optional mit Unterseiten); ein ganzer
  Bereich entsteht als Handbuch unter **Bereichseinstellungen → Export & Import**.
- Ein Export umfasst höchstens 300 Seiten. Bilder werden nur übernommen, wenn die exportierende Person
  sie sehen darf.
- Die Dokumente werden in einem **Worker-Thread** gesetzt (Zeitlimit 3 Minuten); je Person sind
  40 Exporte in 10 Minuten möglich.
- Mermaid-Diagramme und Formeln erscheinen als Quelltext, eingebettete PDFs und Dateien als Hinweis –
  draw.io-Diagramme, Whiteboards und Galerien als Grafik.

---

## Import aus anderen Wikis

**Bereichseinstellungen → Export & Import → Aus anderem Wiki übernehmen** (Recht zum Anlegen von Seiten
im Bereich)

| Quelle | Was hochladen | Übernommen |
| --- | --- | --- |
| **MediaWiki** | XML aus *Spezial:Exportieren* oder `dumpBackup.php` (`--full` für Versionen); mit Bildern als ZIP zusammen mit dem Ordner `images` | Seiten der Inhaltsnamensräume, Unterseiten `A/B` als Hierarchie, Kategorien als Stichwörter, Dateien, Weiterleitungen als Verweise; Hinweis-Vorlagen werden zu Hinweisboxen, andere Vorlagen als Vermerk sichtbar |
| **DokuWiki** | den Ordner `data` als ZIP (`pages`, `media`, für Versionen `attic` und `meta`) | Namensräume als Hierarchie, `start`-Seiten als Seite des Namensraums, Medien, Hinweis- und Tabellen-Syntax |
| **XWiki** | XAR-Paket aus *Administration → Inhalt → Export* | verschachtelte Seiten, Anhänge, Tags als Stichwörter; XWiki-Syntax 2.x, HTML und Markdown; Skript-Makros werden nur vermerkt |
| **Confluence** | Bereichsexport als ZIP: **XML** (`entities.xml` mit Anhängen, empfohlen) oder **HTML** | Seitenbaum, Speicherformat mit Makros (Info/Tipp/Hinweis/Warnung, Code, Aufgabenlisten, Aufklappen, Inhaltsverzeichnis), Seiten- und Anhangverweise, Stichwörter, Anhänge, frühere Versionen (XML); nicht übertragbare Makros werden vermerkt |

- Das Format wird erkannt; die neuen Seiten landen wahlweise unter einer bestehenden Seite.
- **Versionsgeschichte** auf Wunsch (bis 50 Versionen je Seite, mit ursprünglichem Datum). Autorinnen
  und Autoren werden gleichnamigen Knowstead-Konten zugeordnet, sonst in der Änderungsnotiz vermerkt.
- Der Import läuft als **Hintergrundauftrag** nacheinander (höchstens zwei offene Aufträge je Person,
  bis 20 000 Seiten je Import) und schließt mit einem Bericht: Seiten, Ordnerseiten, Anhänge, ältere
  Versionen, nicht auflösbare Verweise, fehlende und ungenutzte Dateien.
- **Große Archive**: Eine hochgeladene Datei darf bis zu 2 GB groß sein, ein ZIP- oder XAR-Archiv
  entpackt bis zu 8 GB mit höchstens 100 000 Dateien (ein einzelner Anhang darin bis 512 MB). Knowstead
  schreibt den Upload ins Datenverzeichnis (`tmp/`) und liest daraus Stück für Stück – der
  Arbeitsspeicher des Servers muss nicht zum Archiv passen (gemessen: ein Archiv mit 1,2 GB belegt beim
  Import rund 275 MB). Auf dem Laufwerk muss dafür so viel Platz frei sein, wie das Archiv groß ist;
  der Ordner wird nach jedem Import und beim Start des Servers geleert.
- Große Importe vorher in einem Testbereich ausprobieren; Upload-Grenze des Reverse-Proxys beachten
  (`client_max_body_size`).

---

## Sicherungen

- **Automatisch**: standardmäßig nachts um 3 Uhr, sieben Stände, inklusive Anhänge.
- **Manuell**: Administration → Sicherungen → „Jetzt sichern“ oder `npm run cli -- backup`.
- Eine Sicherung enthält eine konsistente Kopie der Datenbank (`VACUUM INTO`, in einem Worker-Thread –
  der Betrieb läuft währenddessen weiter) und optional `uploads/`. Download als ZIP direkt in der
  Oberfläche.
- Der gemeinsame Bearbeitungsstand (`collab_documents`), der Anhang-Suchindex und die
  E-Mail-Warteschlange sind Teil der Datenbank und damit in jeder Sicherung enthalten.

- Sicherungen enthalten **nicht** den Serverschlüssel (`secret.key`) – sonst ließen sich die
  verschlüsselten Zugangsdaten mit jedem heruntergeladenen Sicherungspaket entschlüsseln. Den Schlüssel
  einmalig getrennt aufbewahren (z. B. im Passwort-Tresor) oder `KNOWSTEAD_SECRET` setzen.

Am Namen ist erkennbar, wie eine Sicherung entstanden ist:

| Name endet auf | Entsteht | Inhalt | Aufbewahrung |
| --- | --- | --- | --- |
| `-auto` | nächtlich | Datenbank, Anhänge laut Einstellung | Anzahl laut Einstellung (Standard 7) |
| – | „Jetzt sichern“ bzw. `npm run cli -- backup` | Datenbank, Anhänge laut Einstellung | bis zum Löschen |
| `-update` | vor den Datenbankänderungen eines Updates | Datenbank | die letzten fünf |
| `-loeschung` | vor dem Löschen eines Bereichs | Datenbank | die letzten zehn |
| `-restore` | vor dem Zurückspielen einer Sicherung | Datenbank | bis zum Löschen |

Sicherungen ohne Anhänge genügen zum Zurückspielen, weil Knowstead Dateien gelöschter Anhänge erst nach
30 Tagen vom Datenträger entfernt.

**Wiederherstellen**

```bash
npm run cli -- backup:list                                    # verfügbare Sicherungen
npm run cli -- restore backup-20260913-030000-auto            # nur Datenbank
npm run cli -- restore backup-20260913-030000-auto --with-uploads   # zusätzlich Anhänge
```

Der Befehl verlangt einen gestoppten Server, prüft die Sicherung (`integrity_check`), sichert den
aktuellen Stand als `backup-…-restore`, entfernt die Dateien `knowstead.db-wal`/`knowstead.db-shm` und ersetzt
die Datenbank atomar. Anhänge werden nur ergänzt, nie gelöscht. Stammt die Sicherung von einer älteren
Version, migriert der nächste Start sie automatisch.

Von Hand (z. B. auf einem neuen Server): Dienst stoppen, `knowstead.db` aus der Sicherung nach `data/`
kopieren, **`knowstead.db-wal` und `knowstead.db-shm` löschen** (eine alte Write-Ahead-Datei würde sonst auf die
zurückgespielte Datenbank angewendet), bei Bedarf `uploads/` zurückkopieren, den bisherigen
`secret.key` bzw. `KNOWSTEAD_SECRET` verwenden, Dienst starten.

Für eine externe Sicherung genügt es, das gesamte Verzeichnis `data/` bei **gestopptem** Server zu
kopieren; im laufenden Betrieb die erzeugten Sicherungspakete verwenden.

---

## Wartung

**Administration → Wartung** bzw. per CLI:

| Aufgabe | Wirkung |
| --- | --- |
| `reindex` | Suchindex neu aufbauen (nach Import oder Störung) |
| `reindex-attachments` | Text aller Anhänge neu lesen und den Anhang-Suchindex neu aufbauen |
| `purge-trash` | abgelaufene Papierkorbeinträge (Seiten und gelöschte Anhänge) endgültig löschen; Dateien, die seit mehr als 30 Tagen zu keinem Anhang mehr gehören, entfernen |
| `prune-events` | alte Ereignisse gemäß Aufbewahrung entfernen |
| `cleanup-sessions` | abgelaufene Sitzungen und Reset-Links aufräumen, unbestätigte Selbstregistrierungen nach sieben Tagen löschen |
| `vacuum` | Datenbank verdichten |
| `sync-handbook` | Handbuch nach einem Update ergänzen (von Hand geänderte Kapitel bleiben unangetastet); per CLI `handbook:sync` |

Papierkorb, Ereignisse und Sitzungen werden zusätzlich täglich automatisch aufgeräumt, verschickte
E-Mails nach 30 Tagen aus dem Versandprotokoll entfernt.

---

## Protokolle und Nachvollziehbarkeit

| Ort | Inhalt |
| --- | --- |
| **Aktivität** (Hauptmenü) | inhaltliche Ereignisse, gefiltert nach Bereich und Person |
| **Änderungsprotokoll** (je Bereich) | alle Versionen mit Änderungsnotiz, auch als Markdown |
| **Audit-Log** (Administration) | sicherheits- und verwaltungsrelevante Ereignisse inklusive IP und KI-Nutzung, als CSV exportierbar |
| **Serverprotokoll** | technische Meldungen (`LOG_LEVEL=debug` für mehr Details) |
| **Zustellprotokoll** (Webhooks) | Status, Antwort, Dauer und Wiederholungen je Zustellung |
| **Versandprotokoll** (E-Mail) | Empfänger, Betreff, Status, Versuche und Fehlermeldung der letzten 30 Tage |

---

## Fehlersuche

Zuerst `npm run cli -- doctor` ausführen: Die Prüfung nennt für die häufigsten Ursachen (Oberfläche nicht
gebaut, Datenverzeichnis nicht beschreibbar, Port belegt, Adresse ohne HTTPS, fehlende Sicherung) auch die
Abhilfe.

| Symptom | Ursache und Lösung |
| --- | --- |
| „Die Weboberfläche wurde noch nicht gebaut“ | `npm run build` ausführen |
| Geplante Aufgabe „Knowstead“ läuft, Seite nicht erreichbar | `Knowstead-Dienst.cmd status` und `Knowstead-Dienst.cmd log` – der Grund steht im Protokoll unter `<Datenverzeichnis>\logs\knowstead.log` |
| Port belegt | `PORT` in der `.env` ändern |
| Start bricht ab: „Datenbank wird bereits von einem laufenden Knowstead-Server verwendet“ | Alter Dienst läuft noch (Dienstverwaltung, Taskmanager: `node`). Erst beenden, dann starten. |
| Start bricht ab: „Datenbank wurde bereits von einer neueren Knowstead-Version verwendet“ | Neuere Programmversion einspielen – oder mit `npm run cli -- restore` eine zur Version passende Sicherung zurückspielen |
| Start bricht ab: „Serverschlüssel passt nicht“ | `KNOWSTEAD_SECRET` bzw. `data/secret.key` wurde geändert. Bisherigen Schlüssel wiederherstellen oder bewusst `KNOWSTEAD_ALLOW_KEY_CHANGE=1` setzen und Zugangsdaten neu eintragen |
| Start bricht ab: „Sicherung vor dem Update fehlgeschlagen“ | Speicherplatz im Datenverzeichnis prüfen; die Datenbank ist unverändert |
| Start bricht ab: „Migration … fehlgeschlagen“ | Datenbank ist unverändert. Protokoll an den Support geben; bis zur Klärung die vorherige Version weiter betreiben |
| Einrichtung fragt nach einem Einrichtungscode | Zugriff kommt nicht vom Server selbst: Code aus dem Serverprotokoll übernehmen („Einrichtungscode: …“) |
| Einrichtung fragt **nicht** nach dem Code, obwohl über den Proxy aufgerufen | Proxy auf demselben Rechner sendet kein `X-Forwarded-For` – Header ergänzen (nginx: `proxy_set_header X-Forwarded-For …`) oder die Einrichtung vor dem Freischalten des Proxys abschließen |
| Seite bleibt weiß oder zeigt „Das dauert ungewöhnlich lange“ | Programmdateien unter `/assets/` werden nicht geladen: Proxy, Webfilter oder Virenscanner blockieren sie, oder der Browser ist veraltet (aktuelle Versionen von Edge, Chrome, Firefox, Safari nötig). In den Entwicklerwerkzeugen (F12 → Netzwerk) nach fehlgeschlagenen `.js`-Dateien suchen |
| `/api/docs` leitet zur Anmeldung | Seit 1.4 gewollt: API-Referenz nur für Angemeldete; Skripte senden ein API-Token |
| Hinweis „Seite ist für die gemeinsame Bearbeitung zu groß“ | Gemeinsames Dokument über 32 MB – eingefügte Bilder als Anhang hochladen oder Inhalte auf Unterseiten verteilen |
| Anmeldung klappt, aber man ist sofort wieder abgemeldet | `COOKIE_SECURE=true`, aufgerufen wird aber per `http://` – HTTPS nutzen oder `COOKIE_SECURE=auto` |
| Registrierung meldet „fehlt der E-Mail-Versand“ | Domain-Beschränkung ist gesetzt, SMTP aber nicht eingerichtet – E-Mail einrichten oder Domains leeren |
| „Bitte bestätige zuerst deine E-Mail-Adresse“ | Link aus der Registrierungs-E-Mail öffnen; notfalls in der Benutzerverwaltung „Freischalten“ |
| Anmeldung nicht möglich, Konto gesperrt | `npm run cli -- user:unlock <name>` |
| Passwort vergessen (ohne SMTP) | `npm run cli -- user:password <name>` |
| Kein Administrator mehr | `npm run cli -- user:admin <name>` |
| AD-Anmeldung schlägt fehl | Administration → Verzeichnis → „Verbindung prüfen“ mit Testkonto; Filter, Basis-DN und Zertifikat prüfen |
| Suche findet nichts | Wartung → „Suchindex neu aufbauen“ |
| Live-Aktualisierung fehlt | Proxy puffert SSE – `proxy_buffering off;` setzen |
| Uploads scheitern | Upload-Grenze in den Einstellungen und `client_max_body_size` im Proxy prüfen |
| E-Mails kommen nicht an | Administration → E-Mail: „Verbindung prüfen“ und Test-E-Mail; Versandprotokoll auf Fehler prüfen; Absender muss zum Konto passen |
| Microsoft 365 meldet „basic authentication is disabled“ | Vorlage „Microsoft 365 – Relay über Connector“ oder internen SMTP-Relay verwenden |
| Keine E-Mail-Benachrichtigungen, Test-E-Mail geht | „Benachrichtigungen per E-Mail versenden“ eingeschaltet? Im Profil der Person „sofort“ bzw. „täglich“ gewählt? |
| Kein „Live“ im Editor, andere Cursor fehlen | Proxy reicht WebSocket-Upgrades nicht durch (`Upgrade`-/`Connection`-Header, IIS: Funktion „WebSocket-Protokoll“); Einstellung „Gleichzeitiges Bearbeiten“ aktiv? |
| Anhänge werden in der Suche nicht gefunden | Stand unter `GET /api/v1/admin/attachments/index` prüfen; gescannte PDFs ohne Textebene; ältere Office-Formate brauchen LibreOffice; ggf. Wartung → „Anhänge neu indexieren“ |
| PDF-/Word-Export bricht ab | mehr als 300 Seiten oder sehr große Bilder? Ratenbegrenzung (40 Exporte in 10 Minuten)? Serverprotokoll prüfen |
| Wiki-Import scheitert | Bericht bzw. Fehlermeldung im Import-Dialog; Datei über 2 GB oder Archiv entpackt über 8 GB? Genug Platz im Datenverzeichnis (der Upload liegt während des Imports unter `tmp/`)? Proxy-Upload-Grenze (`client_max_body_size`) |
| Warnungen kommen nicht per E-Mail | E-Mail-Versand eingerichtet? Unter *Einstellungen → Warnungen an die Administration* eingeschaltet und Empfängerzahl größer 0 (Administratorkonten brauchen eine E-Mail-Adresse)? **Testwarnung senden**, dann das Versandprotokoll unter *E-Mail* prüfen |
| Überwachung bekommt `503` von `/api/v1/monitoring?strict=true` | gewollt: Es liegt mindestens eine Warnung vor – `alerts` in der Antwort nennt sie |
| `/api/v1/monitoring` antwortet mit `403` | das Token gehört keinem Administratorkonto |
| Keine Erinnerungen zur Wiedervorlage | Intervall für Seite oder Bereich gesetzt? Erinnerungen kommen 14 Tage vorher und bei Überfälligkeit, jeweils einmal |
| Plugin lädt nicht | Fehlermeldung in Administration → Plugins; Serverprotokoll prüfen |
| KI-Assistent fehlt | KI aktiviert? Recht `ai.use` in einer Gruppe der Person? Aktion freigeschaltet? |
| KI meldet Fehler | „Verbindung testen“; Basis-URL ohne Pfadende, Schlüssel, Modellname, ausgehende Firewall prüfen |
| Office-Datei ohne Vorschau | Office-Vorschau aktiviert und LibreOffice gefunden (Statusanzeige)? Datei unter 60 MB? |
| draw.io bleibt leer | Browser erreicht die draw.io-Adresse nicht (Proxy/Firewall) – ggf. selbst betreiben |

---

## Checkliste für den Produktivbetrieb

- [ ] `BASE_URL` auf die öffentliche HTTPS-Adresse gesetzt, `TRUST_PROXY` auf die Adresse des Proxys, Port 3000 nur für den Proxy erreichbar
- [ ] `KNOWSTEAD_SECRET` gesetzt **oder** `data/secret.key` getrennt gesichert (nicht in den Sicherungspaketen enthalten)
- [ ] Datenverzeichnis außerhalb des Programmordners (`DATA_DIR`), Rücksicherung mit `npm run cli -- restore` einmal geprobt
- [ ] HTTPS aktiv, `COOKIE_SECURE` passend
- [ ] Sicherungen aktiviert und wiederhergestellt getestet
- [ ] Warnungen an die Administration: Testwarnung angekommen, bei Bedarf weitere Empfänger eingetragen und die Überwachung an `/api/v1/monitoring` angebunden
- [ ] SMTP eingerichtet, Verbindung geprüft, Test-E-Mail angekommen (Passwort-Zurücksetzung, Benachrichtigungen)
- [ ] Reverse-Proxy reicht SSE ungepuffert und WebSocket-Upgrades durch („Live“ im Editor sichtbar)
- [ ] Verzeichnisanmeldung bzw. Single Sign-on getestet, lokale Notfallkennung vorhanden, Administratorkonten im Profil verknüpft
- [ ] Bei Windows-Anmeldung: nur `/api/v1/auth/kerberos` im Proxy geschützt, vertrauenswürdige Adresse und gemeinsames Geheimnis gesetzt
- [ ] Gruppen und Bereichsrollen festgelegt, Selbstregistrierung bewusst aktiviert oder aus
- [ ] Recht `admin` nur wenigen Personen, `users.manage` und `integrations.manage` bewusst vergeben
- [ ] Aufbewahrungsfristen (Papierkorb, Ereignisse) mit dem Datenschutz abgestimmt
- [ ] Handbuch-Bereich gesichtet, Startseite und Kategorien eingerichtet
- [ ] Wiedervorlage für verbindliche Bereiche (Richtlinien, Arbeitsanweisungen) und Export-Vorlage festgelegt
- [ ] Zielhardware mit `node scripts/loadtest.mjs` geprüft, Datenverzeichnis auf lokaler SSD, Virenscanner-Ausnahmen gesetzt
- [ ] KI nur nach Abstimmung mit Datenschutz aktiviert, Tageslimit und Gruppen mit `ai.use` festgelegt
- [ ] Office-Vorschau (LibreOffice), Texterkennung (Tesseract) und draw.io-Adresse geprüft
- [ ] Lesebestätigungen, Freigabeabläufe und Inhaltsanalyse mit Datenschutz und ggf. Betriebsrat abgestimmt
