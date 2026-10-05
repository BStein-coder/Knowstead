# Knowstead

*[English version](README.md)*

**Webbasiertes Dokumentations- und Wissensmanagementsystem** – Bereiche und Seitenbäume wie in Confluence,
Notizfunktionen wie in Trilium (Attribute, Journal, Link-Karte, Skripting), ein vollständiges Rechtesystem
mit **Active Directory, Microsoft Entra ID, SAML und Windows-Anmeldung (Kerberos)**, **gleichzeitiges
Bearbeiten in Echtzeit** mit **Vorschlagsmodus**, Redaktionsprüfung mit **mehrstufigen Freigaben und
Vertretungen**, **Lesebestätigungen für Pflichtdokumente**, **Wiedervorlage mit Verantwortlichen**,
**Inhaltsanalyse** für die Redaktion, **Aufgabenplaner** mit Zeitachse, Abhängigkeiten und Kalender-Abo,
**KI-Assistent** (Claude, OpenAI, Azure, Ollama), **Volltextsuche in Anhängen mit Texterkennung**,
**PDF-/Word-Export mit Firmenvorlage**, **draw.io** und **Whiteboard**, Importer für **Confluence,
MediaWiki, DokuWiki und XWiki**, E-Mail-Benachrichtigungen, eine dokumentierte REST-API, Webhooks,
API-Konnektoren und ein Plugin-System – auf **Deutsch und Englisch**.

Alles läuft in einem einzigen Node-Prozess mit einer SQLite-Datenbank – ohne Docker-Zwang, ohne externe
Dienste, ohne Build-Werkzeugkette auf dem Server – und trägt im Lasttest **500 Personen und mehr**.

> Bis Version 1.9 hieß Knowstead „Doku“. Bestehende Installationen laufen nach dem Update unverändert
> weiter – siehe [Änderungsprotokoll zu 2.0.0](CHANGELOG.md).

---

## Inhalt

- [Auf einen Blick](#auf-einen-blick)
- [Neu in 1.6](#neu-in-16)
- [Neu in 1.5](#neu-in-15)
- [Schnellstart](#schnellstart)
- [Betrieb](#betrieb)
- [Projektstruktur](#projektstruktur)
- [Skripte](#skripte)
- [Konfiguration](#konfiguration)
- [Dokumentation](#dokumentation)
- [Sicherung und Wiederherstellung](#sicherung-und-wiederherstellung)
- [Technik](#technik)

---

## Auf einen Blick

| Bereich | Funktionen |
| --- | --- |
| **Inhalte** | Bereiche (Spaces) mit Seitenbaum, Rich-Text-Editor mit Makros, Markdown- und Code-Seiten, Vorlagen, Anhänge, Entwürfe, Papierkorb |
| **Editor** | Slash-Menü, Tabellen, Aufgabenlisten, Hinweisboxen, Aufklappbereiche, Status-Etiketten, **Bildergalerien mit Lightbox**, Mermaid-Diagramme, Formeln (KaTeX), Code mit Syntaxhervorhebung, Bilder per Drag & Drop, `@`-Erwähnungen, `[[`-Seitenlinks |
| **Makros** | Inhaltsverzeichnis, Unterseiten, Seite einbinden, Änderungshistorie, zuletzt geändert, Anhänge, Eigenschaften-Bericht, API-Daten, Einbettungen, PDF/Office, draw.io, **Whiteboard** (Excalidraw), Aufgaben |
| **Bearbeiten** | **Gleichzeitiges Bearbeiten in Echtzeit** mit sichtbaren Cursorn (Yjs), **Vorschlagsmodus** („Änderungen nachverfolgen“ mit Annehmen/Ablehnen, vom Autor einstellbar, von der Bereichsverwaltung festschreibbar), Papierbogen-Ansicht mit Gliederung, Stichwörter direkt im Editor, persönliche **Zwischenablage** über Seiten hinweg, Seiten kopieren, duplizieren und verschieben |
| **Dateien** | Uploads direkt im Beitrag (Drag & Drop), **PDF-Betrachter** (pdf.js), **Video und Ton abspielen** (mit Springen), Vorschau für PowerPoint, Word, Excel und **Visio** (mit LibreOffice), **Volltextsuche in Anhängen** (PDF, Office, OpenDocument, Text) mit **Texterkennung (OCR)** für Scans und Bilder über Tesseract, **draw.io**-Editor eingebettet oder selbst betrieben |
| **Planung** | **Aufgabenplaner** wie Microsoft Planner: Pläne je Bereich, Board, Liste und **Zeitachse** mit **Abhängigkeiten** (Ende→Anfang u. a., Versatz, automatische Terminverschiebung, Konfliktanzeige), Drag & Drop, Verantwortliche, Start/Fällig, Priorität, Fortschritt, Checklisten, **Chat je Aufgabe mit @-Erwähnungen**, **wiederkehrende Aufgaben**, **Erinnerungen** vor dem Termin, **Kalender-Abo (ICS)**, Seitenverknüpfung, „Meine Aufgaben“, Makro für Seiten |
| **KI** | Verbessern, Kürzen, Übersetzen, Zusammenfassen, Gliederung, Aufgaben und Stichwörter ableiten, Fragen an eine Seite – Anbieter frei wählbar (auch lokal), Recht `ai.use`, Tageslimits, Protokoll |
| **Wissen** | Stichwörter (mit Übersicht, Umbenennen und Zusammenführen), Eigenschaften (Schlüssel/Wert), Volltextsuche mit Filtern, Backlinks, Link-Karte, Journal/Tagesnotizen, persönliche Bereiche, Favoriten, Beobachtungen |
| **Änderungsprotokolle** | Versionsgeschichte je Seite mit Änderungsnotiz, visueller Versionsvergleich, Wiederherstellen, Änderungsprotokoll je Bereich, globaler Aktivitätsfeed, Audit-Log |
| **Zusammenarbeit** | Kommentare (Seite und Textstellen), Erwähnungen, Benachrichtigungen, **E-Mail** sofort oder als tägliche Zusammenfassung (Warteschlange, Versandprotokoll), Anwesenheitsanzeige und Live-Aktualisierung über SSE |
| **Rechte** | Gruppen mit globalen Rechten, Bereichsrollen (Betrachter/Kommentator/Bearbeiter/Administrator), Seiteneinschränkungen mit Vererbung, anonymer Lesezugriff optional |
| **Anmeldung** | Lokale Konten, **Active Directory/LDAP**, **Microsoft Entra ID bzw. OpenID Connect**, **SAML 2.0** und **Windows-Anmeldung (Kerberos)** über den Reverse-Proxy – automatische Kontoanlage, Gruppen aus AD, Entra ID und SAML werden auf Knowstead-Gruppen abgebildet, Konten im Profil verknüpfbar |
| **Qualität** | Redaktionsprüfung (freiwillig oder verpflichtend je Bereich), **mehrstufige Freigabeabläufe** (z. B. Fachbereich → QM → Veröffentlichung) mit Eskalation und **Abwesenheitsvertretungen**, **Lesebestätigungen** für Pflichtdokumente mit Zielgruppe, Frist, Erinnerungen und Nachweisliste, **Wiedervorlage** mit Verantwortlichen, **Inhaltsanalyse** (meistgelesen, ungelesen, Suchen ohne Treffer, verwaiste Seiten, defekte Verweise), „Letzte Änderungen“ mit Ein-Klick-Rücknahme |
| **Onboarding** | Dreistufiger Einrichtungsassistent, geführter Rundgang, Einstiegs-Checkliste auf der Startseite, Handbuch-Bereich |
| **Schnittstellen** | REST-API mit OpenAPI-Oberfläche unter `/api/docs`, API-Tokens mit Umfängen, signierte Webhooks mit Wiederholungen, API-Konnektoren für Live-Daten in Seiten |
| **Erweiterbarkeit** | Plugins mit Server- und Browser-Teil (Hooks, Ereignisse, Routen, Makros, Aktionen, Panels) – ohne Neustart aktivierbar |
| **Administration** | Benutzer, Gruppen, Bereiche und **Kategorien**, Vorlagen, Einstellungen, **E-Mail (SMTP)**, **Export-Vorlage**, Webhooks, Konnektoren, Plugins, Audit-Log, Sicherungen, Wartung, Systeminfo |
| **Import/Export** | **PDF und Word mit Firmenvorlage** (Deckblatt, Kopf- und Fußzeile, Inhaltsverzeichnis), Markdown, HTML, ZIP-Archiv je Bereich, Import von Markdown/HTML/ZIP und aus **Confluence (XML/HTML), MediaWiki, DokuWiki und XWiki** (mit Versionsgeschichte) |
| **Betrieb** | Ein Prozess, eine SQLite-Datei; im Lasttest rund 500 Anfragen/s mit 500 Konten und 8 000 Seiten, rechenintensive Arbeit in Worker-Threads, Lasttest-Werkzeug inklusive |

Die Oberfläche gibt es vollständig auf **Deutsch und Englisch** – einschließlich Administration,
Fehlermeldungen, E-Mails, Exporten und Handbuch –, mit hellem und dunklem Design, Tastenkürzeln und
Befehlspalette (`Strg`+`K`), **barrierearm nach WCAG 2.1 AA** und mit über 280 automatischen Browsertests
abgesichert. Anmeldung und Startseite stehen auf einer **3D-Bühne** aus schwebenden Seiten (reines CSS,
ohne WebGL und ohne Bibliothek), die Oberfläche reagiert mit weichen Bewegungen – wer es ruhiger mag,
schaltet das im Benutzermenü ab, und die Administration kann „reduziert“ als Vorgabe setzen.

---

## Neu in 1.9

| Funktion | Kurz |
| --- | --- |
| **Navigation im neuen Stil** | Kopfleiste, Seitenleiste und die Leiste über einer Seite schweben als Glasebenen über dem Inhalt – mit Lichtmarke am aktiven Eintrag, Lichtkegel unter dem Zeiger und Verbindungslinien im Seitenbaum, passend zur 3D-Bühne der Startseite |
| **Echtes Glas** | Menüs, Dialoge und Leisten sind jetzt auch in Edge, Chrome und Firefox unscharf hinterlegt (bisher nur in Safari) |

## Neu in 1.8

| Funktion | Kurz |
| --- | --- |
| **Update mit einem Befehl** | Linux: `sudo bash /opt/knowstead/update.sh <paket>` prüft das Paket, tauscht den Programmordner, startet und kontrolliert – und holt den bisherigen Stand samt Datenbank zurück, wenn der neue nicht läuft; `--rollback` kehrt später zurück |
| **Warnungen per E-Mail** | Sicherung gescheitert oder veraltet, Speicherplatz knapp, Neustart nach einem Update vergessen: Die Administration erfährt es per E-Mail und in der Übersicht, Überwachungssysteme unter `/api/v1/monitoring` |
| **Wiki-Import in Stücken** | Archive werden von der Platte gelesen statt in den Arbeitsspeicher geladen – Importe bis 8 GB entpackt auch auf kleinen Servern |
| **Chat in der Suche** | Die Suche findet Aufgaben auch über Nachrichten im Chat; Karten zeigen, wo es Ungelesenes gibt |

## Neu in 1.7

| Funktion | Kurz |
| --- | --- |
| **Chat je Aufgabe** | Fragen und Absprachen mit @-Erwähnungen direkt an der Aufgabe |
| **Planer** | Papierkorb, Suche, Sammeländerung, Fortschritt aus der Checkliste |
| **3D-Bühne und Bewegung** | Anmeldung und Startseite mit schwebenden Seiten, abschaltbar |
| **Zusatzprogramme** | Die Assistenten installieren Tesseract und LibreOffice auf Wunsch mit |
| **Neustart erkannt** | Knowstead merkt, wenn nach einem Update der Neustart fehlt |

## Neu in 1.6

| Funktion | Kurz |
| --- | --- |
| **Installationsassistent** | Windows: Doppelklick auf `Knowstead-Installation.cmd` – grafischer Assistent für Datenverzeichnis, Erreichbarkeit, Autostart (geplante Aufgabe oder NSSM), Firewall, Virenscanner-Ausnahme und Zusatzprogramme; Linux: `sudo bash install.sh` mit systemd-Dienst – auch im Proxmox-LXC-Container, Node.js installiert es auf Wunsch mit. Beide auch ohne Rückfragen – ideal für Updates |
| **Installationspaket** | fertig gebaute Pakete für Windows und Linux in den GitHub-Releases – auf dem Server kein Build und kein npm-Download |
| **Nächste Schritte** | Administration → Nächste Schritte führt nach der Ersteinrichtung durch HTTPS, Autostart, E-Mail, Sicherung, Personen und Bereiche |
| **Prüfen und Steuern** | `npm run cli -- doctor` prüft die Installation, `cli stop` beendet Knowstead geordnet, `Knowstead-Dienst.cmd` steuert den Autostart unter Windows |
| **Sicherheit der Archive** | Bereichsexporte und heruntergeladene Sicherungen konnten bei bestimmten Dateien beschädigt sein – behoben |

## Neu in 1.5

| Funktion | Kurz |
| --- | --- |
| **Single Sign-on** | Microsoft Entra ID (OIDC), SAML 2.0, Windows-Anmeldung (Kerberos) – Gruppen wie beim AD |
| **Lesebestätigungen** | Pflichtdokumente „gelesen und verstanden“, Frist, Erinnerungen, Nachweis als CSV |
| **Mehrstufige Freigaben** | Stufen mit Freigebenden, Mindestanzahl, Eskalation und Vertretungsregeln |
| **Vorschlagsmodus** | Änderungen vorschlagen, annehmen oder ablehnen – auch in der Echtzeit-Bearbeitung |
| **Inhaltsanalyse** | Arbeitsliste für die Redaktion |
| **Abhängigkeiten im Planer** | wie Microsoft Planner Premium, mit Pfeilen auf der Zeitachse |
| **Confluence-Import** | Bereichsexport als XML oder HTML |
| **Texterkennung** | eingescannte PDFs und Bilder durchsuchbar (Tesseract, optional) |
| **Englisch** | Oberfläche, Server, E-Mails, Exporte, Handbuch und Vorlagen |

Alle Änderungen: [CHANGELOG.md](CHANGELOG.md).

---

## Schnellstart

Voraussetzung: **Node.js 24 oder neuer** (`node --version`). Sonst nichts. Die ausführliche Anleitung
für den Produktivbetrieb (Dienst, HTTPS, Proxy, Docker, E-Mail, AD) steht in
**[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

### Auf einem Server installieren (empfohlen)

1. Installationspaket für das Betriebssystem aus den **Releases** laden und entpacken, z. B. nach
   `D:\Knowstead` bzw. `/opt/knowstead`.
2. **Windows:** Doppelklick auf **`Knowstead-Installation.cmd`** – der Assistent fragt Datenverzeichnis,
   Erreichbarkeit, Autostart und Zusatzprogramme ab, richtet alles ein und prüft das Ergebnis.
   **Linux:** `sudo bash install.sh` – auch in einem Proxmox-LXC-Container
   ([Anleitung](docs/INSTALLATION.md#proxmox-ve-lxc-container)); fehlt Node.js 24, bietet das Skript die Installation an.
3. Am Ende öffnet der Assistent die Ersteinrichtung im Browser. Danach führt **Administration → Nächste
   Schritte** durch E-Mail, Sicherung, Personen und Bereiche.

Für HTTPS gehört ein Reverse-Proxy davor ([Installationsanleitung, Abschnitt 7](docs/INSTALLATION.md#7-https-und-reverse-proxy)).

### Zum Ausprobieren oder Entwickeln

```bash
npm install
npm run build
npm start
```

Danach `http://localhost:3000/setup` im Browser öffnen und das erste Administratorkonto anlegen. Von einem
anderen Rechner aus fragt der Assistent nach dem **Einrichtungscode** aus dem Serverprotokoll.
Beim Einrichten wird automatisch der Bereich **Handbuch** mit der kompletten Benutzerdokumentation angelegt.

Unter Windows genügt ein Doppelklick auf **`start.cmd`** (Linux/macOS: `./start.sh`) – das Skript
installiert die Abhängigkeiten, baut die Oberfläche und startet den Server. Nach einem Update erkennt
es geänderte Abhängigkeiten und Quelltexte und holt beides automatisch nach.

### Entwicklungsmodus

```bash
npm run dev
```

Startet den API-Server auf Port 3000 (Neustart bei Dateiänderungen) und die Oberfläche auf
`http://localhost:5173` mit Hot Reload.

---

## Betrieb

Autostart, Firewall und Protokoll richtet der Installationsassistent ein (Windows: geplante Aufgabe oder
NSSM, Linux: systemd). Unter Windows steuert `Knowstead-Dienst.cmd start|stop|restart|status|log` den Betrieb.

### Als Dienst von Hand (Linux, systemd)

```ini
[Unit]
Description=Knowstead
After=network.target

[Service]
WorkingDirectory=/opt/knowstead
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.ts
Environment=NODE_ENV=production
EnvironmentFile=/opt/knowstead/.env
Restart=always
RestartSec=5
User=knowstead

[Install]
WantedBy=multi-user.target
```

### Mit Docker

```bash
cp .env.example .env      # BASE_URL und KNOWSTEAD_SECRET setzen
docker compose up -d
```

Die Daten liegen im Volume `knowstead-data` (`/app/data` im Container). Den Einrichtungscode für die
Ersteinrichtung zeigt `docker compose logs knowstead`.

### Aktualisieren

Updates verlieren keine Daten: Vor Datenbankänderungen legt der Server selbst eine Sicherung an, alle
Migrationen laufen gemeinsam in einer Transaktion, und eine ältere Version startet nie auf einer neueren
Datenbank. Kurzfassung:

Linux mit einem Befehl: `sudo bash /opt/knowstead/update.sh knowstead-<version>-linux-x64.tar.gz` – prüft, tauscht,
startet, kontrolliert und holt den bisherigen Stand zurück, wenn der neue nicht läuft (beim ersten Update
auf 1.8.0 das `update.sh` aus dem entpackten Paket starten;
[Installationsanleitung → Updates](docs/INSTALLATION.md#11-updates-und-umzug)).

Mit dem Assistenten: Knowstead beenden (`Knowstead-Dienst.cmd stop` bzw. `systemctl stop knowstead`), neues Paket über
den Programmordner entpacken, dann `Knowstead-Installation.cmd -Unattended` bzw. `sudo bash install.sh --unattended`.
Von Hand:

```bash
npm run cli -- status          # Version, Datenbankstand, letzte Sicherung
npm run cli -- stop            # geordnet beenden (oder Dienst stoppen)
# neue Programmdateien einspielen (git pull, Paket entpacken oder docker compose build --pull)
node scripts/prepare.mjs       # geänderte Abhängigkeiten installieren, Oberfläche neu bauen
# Dienst starten, dann: npm run cli -- doctor
```

Ablauf, Rückkehr zur Vorversion und Hinweise je Version: [Administrationshandbuch → Aktualisierung](docs/ADMINISTRATION.md#aktualisierung).

### Hinter einem Reverse-Proxy

`BASE_URL=https://knowstead.example.com` und `TRUST_PROXY` auf die Adresse des Proxys setzen (z. B. `127.0.0.1`
oder `true`). Der Proxy muss
`X-Forwarded-For` und `X-Forwarded-Proto` weiterreichen, Server-Sent Events (`/api/v1/stream`)
ungepuffert durchlassen (nginx: `proxy_buffering off;`) und für die Echtzeit-Bearbeitung
WebSocket-Upgrades (`/api/v1/collab/…`) durchreichen – Beispielkonfiguration für nginx, IIS und Apache
im [Administrationshandbuch](docs/ADMINISTRATION.md#reverse-proxy).

---

## Projektstruktur

```
knowstead/
├─ server/               API-Server (Fastify, TypeScript ohne Build-Schritt)
│  ├─ src/core/          Kernbausteine: Rechte, Ereignisse, Hooks, HTML, Markdown, Diff, Krypto
│  ├─ src/db/            SQLite-Zugriff und Migrationen
│  ├─ src/modules/       Fachmodule (pages, spaces, search, comments, webhooks, admin …)
│  ├─ src/plugins/       Plugin-Laufzeit
│  ├─ src/seed/          Startdaten: Gruppen, Vorlagen, Handbuch-Bereich
│  └─ test/              Tests (node:test)
├─ web/                  Oberfläche (React 19, Vite, TipTap)
│  └─ src/               api/ components/ editor/ layout/ pages/ styles/ i18n/
├─ e2e/                  Browsertests (Playwright, axe-core) – nicht Teil der Installation
├─ plugins/              Beispiel-Plugins (auto-links, chat-notify, example-extension)
├─ docs/                 Projektdokumentation, Handbuch (handbuch/ deutsch, handbook/ englisch)
├─ .github/              CI (GitHub Actions), Dependabot, Vorlagen für Issues und Pull Requests
├─ Knowstead-Installation.cmd  Installationsassistent für Windows (grafisch oder ohne Rückfragen)
├─ Knowstead-Dienst.cmd       Knowstead unter Windows starten, beenden, Zustand und Protokoll anzeigen
├─ install.sh            Installationsassistent für Linux (systemd)
├─ scripts/install/      Assistent für Windows (PowerShell)
├─ scripts/install.mjs   gemeinsamer Installationskern: .env, Verzeichnisse, Probestart, Prüfung
├─ scripts/package.mjs   Installationspaket bauen (für GitHub-Releases)
├─ scripts/dev.mjs       Entwicklungsmodus
├─ scripts/prepare.mjs   Installation und Build nur bei Änderungen (Startskripte)
├─ scripts/loadtest.mjs  Lasttest mit Testdaten (Durchsatz, p50/p95/p99)
├─ scripts/check-i18n.mjs  Prüft, ob alle Texte übersetzt sind
└─ data/                 Laufzeitdaten: knowstead.db, uploads/, backups/, secret.key
```

---

## Skripte

| Befehl | Wirkung |
| --- | --- |
| `npm run dev` | Entwicklungsmodus (API + Oberfläche mit Hot Reload) |
| `npm run build` | Oberfläche nach `web/dist` bauen |
| `npm start` | Server starten (liefert API und Oberfläche aus) |
| `npm test` | Testsuite (node:test) |
| `npm run lint` | ESLint und Vollständigkeit der Übersetzungen |
| `npm run typecheck` | TypeScript-Prüfung für Server, Plugins und Oberfläche |
| `npm run test:e2e` | Oberfläche bauen und die Browsertests ausführen (einmalig `npm --prefix e2e ci`, siehe [e2e/README.md](e2e/README.md)) |
| `npm run test:sweep` | Layout-Messung: alle Seiten in fünf Fensterbreiten auf Überlappungen, Überstände und abgeschnittene Beschriftungen prüfen (einige Minuten) |
| `npm run cli -- help` | Verwaltungswerkzeug: Status, Benutzer, Sicherung und Wiederherstellung, Reindex, Einstellungen |
| `node scripts/prepare.mjs` | Abhängigkeiten und Oberfläche nur bei Änderungen installieren bzw. bauen (nutzen die Startskripte) |
| `npm run cli -- doctor` | Installation prüfen (Node.js, Oberfläche, Datenverzeichnis, Port, Adresse, Datenbank, Sicherungen) |
| `npm run cli -- stop` | laufenden Server geordnet beenden – auch ohne Konsole |
| `node scripts/install.mjs --help` | Installationskern ohne Rückfragen (von den Assistenten genutzt) |
| `node scripts/package.mjs` | Installationspaket für das aktuelle Betriebssystem bauen (nach `npm run build`); mit `--target linux-x64` für ein anderes System, z. B. unter Windows für Linux |
| `node scripts/loadtest.mjs` | Lasttest in einem temporären Verzeichnis (Optionen: `--users`, `--pages`, `--stages`, `--seconds`) |

Beispiele für das Verwaltungswerkzeug:

```bash
npm run cli -- status
npm run cli -- user:create --username anna --name "Anna Beispiel" --admin
npm run cli -- user:password anna
npm run cli -- backup
npm run cli -- backup:list
npm run cli -- restore backup-20260913-030000-auto --with-uploads   # nur bei gestopptem Server
npm run cli -- reindex
npm run cli -- settings:set allowRegistration true
```

---

## Konfiguration

Betriebsparameter kommen aus Umgebungsvariablen bzw. einer `.env` im Projektverzeichnis
(siehe [`.env.example`](.env.example)):

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Netzwerkschnittstelle |
| `BASE_URL` | `http://localhost:3000` | Öffentliche Adresse (Links, Webhooks, API-Doku) |
| `DATA_DIR` | `data` | Datenbank, Anhänge, Sicherungen, Serverschlüssel |
| `PLUGINS_DIR` | `plugins` | Plugin-Verzeichnis |
| `WEB_DIST_DIR` | `web/dist` | Gebaute Oberfläche |
| `KNOWSTEAD_SECRET` | erzeugt | Schlüssel für verschlüsselte Zugangsdaten und Signaturen |
| `TRUST_PROXY` | `false` | Reverse-Proxy-Header auswerten: `true` oder Adressen/Netze des Proxys (`127.0.0.1`, `10.0.0.0/8`, `uniquelocal`) |
| `COOKIE_SECURE` | `auto` | Sitzungs-Cookie nur über HTTPS (`auto`: sobald die Anfrage per HTTPS bzw. mit `X-Forwarded-Proto: https` ankommt) |
| `LOG_LEVEL` | `info` | Protokolltiefe |

Alles Inhaltliche – Seitenname, Registrierung, Passwortregeln, Uploads, Aufbewahrung, SMTP,
Sicherungen – steht in der Oberfläche unter **Administration → Einstellungen**.

---

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | **Installationsanleitung**: Voraussetzungen, Windows (Dienst), Linux (systemd), Docker, HTTPS und Reverse-Proxy, Ersteinrichtung, E-Mail, AD, Sicherung, Updates, Prüfliste |
| [docs/QUICKSTART.md](docs/QUICKSTART.md), [docs/INSTALLATION.en.md](docs/INSTALLATION.en.md) | Installationsanleitung auf Englisch – Kurzfassung und vollständige Fassung |
| [docs/NUTZUNG.md](docs/NUTZUNG.md) | **Nutzung** im Alltag – nach Aufgaben und Rollen, mit typischen Abläufen |
| [Handbuch im System](docs/handbuch/) | Benutzerhandbuch (wird beim Einrichten als Bereich **Handbuch** angelegt); englisch unter [docs/handbook](docs/handbook/) |
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Aufbau, Datenmodell, Anfragefluss, Entwurfsentscheidungen |
| [docs/API.md](docs/API.md) | REST-API, Authentifizierung, Beispiele, Webhooks, Konnektoren |
| [docs/PLUGINS.md](docs/PLUGINS.md) | Plugins entwickeln: Hooks, Ereignisse, Routen, Makros, Panels |
| [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md) | Betrieb mit vielen Personen, Rechte, Active Directory, **Single Sign-on** (Entra ID, SAML, Kerberos mit Proxy-Beispielen), E-Mail, Freigaben, Lesebestätigungen, Inhaltsanalyse, Echtzeit-Bearbeitung, Texterkennung, Export und Import, Sicherungen, Wartung, Fehlersuche |
| [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md) | Entwicklungsumgebung, Konventionen, neue Module und Makros, Tests und Oberflächentests |
| [CHANGELOG.md](CHANGELOG.md) | Versionshinweise (auch in der Oberfläche unter Administration → Über) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Mitarbeiten: Umgebung, Regeln, Prüfungen vor dem Pull Request |
| [SECURITY.md](SECURITY.md) | Sicherheitslücken vertraulich melden, Sicherheitsmerkmale |
| [docs/GITHUB.md](docs/GITHUB.md) | Projekt auf GitHub veröffentlichen: erster Upload, Einstellungen, Prüfungen, Releases |

---

## Sicherung und Wiederherstellung

Knowstead legt automatisch Sicherungen an (Administration → Sicherungen, standardmäßig nachts um 3 Uhr,
sieben Stände), zusätzlich vor jedem Update mit Datenbankänderungen und vor dem Löschen eines Bereichs.
Eine Sicherung enthält eine konsistente Datenbankkopie und optional die Anhänge; in der Oberfläche lässt
sie sich als ZIP herunterladen.

Wiederherstellen: Server stoppen, `npm run cli -- restore <sicherung>` (optional `--with-uploads`),
Server starten. Der Befehl prüft die Sicherung und legt den bisherigen Stand vorher als eigene Sicherung
ab. Den Serverschlüssel (`data/secret.key` bzw. `KNOWSTEAD_SECRET`) enthalten Sicherungen bewusst nicht –
ihn getrennt aufbewahren. Für eine externe Sicherung genügt es, das gesamte Verzeichnis `data/` bei
gestopptem Server zu kopieren.

---

## Technik

- **Server:** Node.js 24, Fastify 5, TypeScript direkt aus dem Quelltext (native Typ-Entfernung, kein Build)
- **Datenbank:** SQLite über `node:sqlite` (WAL), Volltextsuche mit FTS5, versionierte Migrationen
- **Oberfläche:** React 19, Vite, TanStack Query, React Router, TipTap 3, Yjs, CodeMirror 6, Mermaid, KaTeX, pdf.js, Excalidraw
- **Dokumente und Versand:** pdfmake und docx (Export), nodemailer (E-Mail), ws (WebSocket)
- **Anmeldung:** ldapts (Active Directory), openid-client (Entra ID/OIDC), @node-saml/node-saml (SAML 2.0)
- **Optional:** LibreOffice (Office-/Visio-Vorschau, ältere Office-Formate in der Suche), Tesseract (Texterkennung), draw.io (eingebettet oder selbst betrieben), KI-Anbieter nach Wahl
- **Sicherheit:** scrypt-Passwörter, Sitzungs-Cookies mit gleitender Gültigkeit, CSRF-Header-Prüfung,
  API-Tokens mit Umfängen, HTML-Bereinigung (sanitize-html), Content-Security-Policy und weitere
  Sicherheits-Header, AES-256-GCM für gespeicherte Zugangsdaten (auch KI-Schlüssel), Ratenbegrenzung an
  Anmelde- und KI-Routen
- **Qualität:** 445 Server-Tests (node:test), 298 Browsertests mit Barrierefreiheitsprüfung (hell, dunkel, mobil)
  (Playwright, axe-core), dazu eine Layout-Messung über alle Seiten in fünf Fensterbreiten, ESLint,
  TypeScript im strikten Modus
- **Lizenz:** MIT
- **Herausgeber:** SteinTecDev – <info@steintecdev.com>
