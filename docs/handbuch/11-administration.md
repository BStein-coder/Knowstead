---
title: Administration
icon: 🛠️
---

# Administration

Die Administration erreichst du über das Benutzermenü. Welche Bereiche sichtbar sind, hängt von deinen globalen Rechten ab.

<!-- toc -->

## Übersicht

Kennzahlen zu Benutzern, Bereichen, Seiten, Versionen und Speicherbedarf, die Bearbeitungsaktivität der letzten 30 Tage, die aktivsten Autoren, meistgelesenen Seiten sowie Systeminformationen (Version, Bauzeitpunkt des eingespielten Pakets, Laufzeit, Datenverzeichnis, Betriebsart und Protokolldatei).

**Warnungen** stehen ganz oben – mit Erklärung, Abhilfe und seit wann sie bestehen. Knowstead prüft alle zehn Minuten:

| Warnung | Bedeutung |
| --- | --- |
| **Neustart erforderlich** | Die Programmdateien wurden seit dem Start des Servers ersetzt – typisch nach einem Update, bei dem der Dienst nicht neu gestartet wurde. Knowstead läuft dann noch mit dem alten Stand; die Warnung nennt den Befehl für den Neustart (z. B. `sudo systemctl restart knowstead`). |
| **Automatische Sicherung fehlgeschlagen** | Die geplante Sicherung ist gescheitert – meist fehlt Speicherplatz. Knowstead versucht es nach einer Stunde erneut. |
| **Keine aktuelle Sicherung** | Die neueste Sicherung ist älter als zwei Tage. |
| **Wenig freier Speicherplatz** | Auf dem Laufwerk der Daten sind weniger als 2 GB frei. |

Dieselben Warnungen gehen **per E-Mail** an alle Administratorkonten: sofort beim Auftreten, einmal täglich als Erinnerung und zum Schluss als Entwarnung. Schwellen, weitere Empfänger und eine Testwarnung findest du unter **Einstellungen → Warnungen an die Administration**. Ein Überwachungssystem fragt den Stand unter `/api/v1/monitoring` ab (Administrationshandbuch, `docs/ADMINISTRATION.md`).

## Nächste Schritte

Nach der Ersteinrichtung zeigt **Administration → Nächste Schritte**, was für den Betrieb noch fehlt. Jeder Punkt springt direkt zur passenden Einstellung und hakt sich von selbst ab, sobald er erledigt ist:

- **Adresse mit HTTPS** – die öffentliche Adresse (`BASE_URL`) beginnt mit `https://`.
- **Autostart** – Knowstead startet mit dem Server (vom Installationsassistenten eingerichtet oder im Docker-Container).
- **E-Mail-Versand** – SMTP-Server und Absender sind eingetragen.
- **Sicherung** – automatische Sicherungen sind eingeschaltet und die letzte ist jünger als zwei Tage. Mit **Jetzt sichern** legst du sofort eine an.
- **Personen einladen** – es gibt neben deinem Konto weitere Benutzer.
- **Ersten Bereich anlegen** – es gibt einen eigenen Bereich (Handbuch und Beispielbereich zählen nicht).
- *Optional:* **Anmeldung mit Firmenkonto** (Active Directory oder Single Sign-on) sowie **Texterkennung und Office-Vorschau**.

Solange Pflichtpunkte offen sind, erinnert ein Hinweis in der **Übersicht** daran. Du kannst ihn dort ausblenden und unter *Nächste Schritte* wieder einschalten.

## Benutzer und Gruppen

- **Benutzer anlegen** – mit Passwort oder ohne (dann einen Link zum Setzen des Passworts erzeugen und weitergeben).
- **Dienstkonten** – Konten ohne Anmeldung, nur für API-Tokens (Integrationen, Automatisierungen).
- **Sperren/Aktivieren**, Passwort setzen, Anmeldesperre aufheben, Tokens einsehen und widerrufen, **verknüpfte Anmeldekonten** (Single Sign-on) einsehen und trennen.
- **Gruppen** mit globalen Rechten und Mitgliedern; eine Gruppe kann **Standardgruppe** für neue Konten sein.
- **Berechtigungen** zeigt eine Matrix „Recht × Gruppe“ zum schnellen Anpassen.

> [!WARNING]
> Knowstead verhindert, dass der letzte aktive Administrator gesperrt, gelöscht oder aus der Administratorgruppe entfernt wird.

## Verzeichnis (Active Directory / LDAP)

Unter **Administration → Verzeichnis** wird die Anmeldung mit Windows-Konten eingerichtet:

1. **Verbindung**: Server-URL (`ldaps://dc01.firma.local:636`), Basis-DN, Dienstkonto und Passwort.
2. **Felder** prüfen – die Vorgaben passen für Active Directory.
3. **Verbindung prüfen** (gern mit einem Testkonto): Jeder Schritt wird einzeln bestätigt, inklusive
   der Gruppen, die gefunden wurden.
4. **Gruppen zuordnen**: Sicherheitsgruppen suchen und die Kennung bei der passenden Knowstead-Gruppe
   eintragen.

> [!IMPORTANT]
> „Lokale Anmeldung zusätzlich erlauben“ aktiviert lassen – sonst sperrt eine Störung im Verzeichnis
> alle aus, auch Administratoren.

## Single Sign-on (Entra ID, SAML, Windows-Anmeldung)

Unter **Administration → Single Sign-on** richtest du bis zu drei Anmeldewege ein. Die Seite zeigt
die Adressen, die beim Identitätsanbieter eingetragen werden (zum Kopieren).

**Microsoft Entra ID / OpenID Connect**

1. In Entra ID eine **App-Registrierung** (Plattform *Web*) mit der angezeigten **Umleitungs-URI** anlegen.
2. Einen **geheimen Clientschlüssel** erzeugen und unter *Tokenkonfiguration* den **Gruppenanspruch**
   hinzufügen (Sicherheitsgruppen, am besten „nur der Anwendung zugewiesene Gruppen“).
3. In Knowstead **Verzeichnis-ID (Mandanten-ID)**, **Anwendungs-ID (Client-ID)** und **Clientschlüssel**
   eintragen, **Einstellungen speichern und prüfen**, dann aktivieren.
4. Unter **Gruppen** bei den Knowstead-Gruppen die **Objekt-IDs** der Entra-Gruppen eintragen.

Andere Anbieter (Keycloak, ADFS, Okta …) funktionieren über „Anderer OpenID-Connect-Anbieter“ mit der
Aussteller-URL. Mandantenübergreifende Anmeldung („common“) ist aus Sicherheitsgründen nicht möglich.

**SAML 2.0**

Knowstead als Service Provider eintragen – **Bezeichner (Entity-ID)** und **Antwort-URL** stehen auf der
Seite, viele Anbieter lesen alles direkt aus der **Metadaten**-Adresse. In Knowstead die **Anmelde-URL**, die
**Entity-ID** und das **Signaturzertifikat** des Anbieters eintragen. Beim Zertifikatswechsel altes und
neues Zertifikat untereinander einfügen.

**Windows-Anmeldung (Kerberos)**

Ein vorgeschalteter Webserver (IIS mit Windows-Authentifizierung oder Apache/nginx mit SPNEGO) prüft
das Windows-Konto und reicht es in einer Kopfzeile an Knowstead weiter. Nur die **geschützte Adresse**
`/api/v1/auth/kerberos` wird dort geschützt. In Knowstead trägst du die **vertrauenswürdigen Webserver**
(IP-Adressen) und am besten ein **gemeinsames Geheimnis** ein. Mit Verzeichnisanbindung kommen Name und
Gruppen aus dem Active Directory. Beispielkonfigurationen stehen im Administrationshandbuch
(`docs/ADMINISTRATION.md`).

**Kontoregeln** (je Anbieter): Konten bei der ersten Anmeldung anlegen, vorhandene Konten gleichen Namens
übernehmen (nie Administratoren), Gruppen abgleichen, Pflichtgruppe, Domain vom Benutzernamen entfernen.
Unter **Allgemein** lässt sich das Anmeldeformular für lokale Konten ausblenden – es bleibt über „Mit
lokalem Konto anmelden“ als Notfallzugang erreichbar.

> [!IMPORTANT]
> Single Sign-on setzt voraus, dass Knowstead unter seiner **HTTPS-Adresse** (`BASE_URL`) erreichbar ist.
> Jede Anmeldung, jede Verknüpfung und jede abgelehnte Anmeldung steht im Audit-Log.

## Bereiche, Kategorien und Struktur

Unter **Administration → Bereiche** stehen alle Bereiche mit Kategorie, Seitenzahl und Status.

**Kategorien** gliedern die linke Navigation und das Bereichsverzeichnis – etwa „Abteilungen“, „Projekte“ oder „Archiv“:

| Aufgabe | So geht’s |
| --- | --- |
| Kategorie hinzufügen | im Abschnitt **Kategorien** Namen eintragen und **Hinzufügen** |
| Umbenennen | auf den Namen klicken – zugeordnete Bereiche wandern mit |
| Symbol ändern | auf das Symbol klicken |
| Reihenfolge ändern | Pfeile nach oben oder unten |
| Entfernen | Papierkorb-Symbol – die Bereiche bleiben erhalten und stehen unter „Weitere Bereiche“ |
| Bereich zuordnen | in der Bereichsliste darunter die Kategorie wählen (oder in den Bereichseinstellungen) |

Weitere Einstellungen je Bereich:

- **Änderungen müssen freigegeben werden** schaltet die Prüfpflicht ein – siehe Kapitel „Prüfung und Freigabe“.
- **Freigaben**: mehrstufiger Freigabeablauf – siehe Kapitel „Prüfung und Freigabe“.
- **Wiedervorlage**: Prüfintervall für alle Seiten und optional ein Plan für Prüfaufgaben – siehe Kapitel „Wiedervorlage“.
- **Archivieren & Löschen**: Archivierte Bereiche sind nur noch lesbar; Löschen entfernt einen Bereich endgültig.

## Einstellungen

| Abschnitt | Inhalte |
| --- | --- |
| Allgemein | Name, Untertitel, **Standardsprache** (Deutsch oder Englisch – gilt für neue Personen, E-Mails und Exporte, solange niemand im Profil eine andere Sprache wählt), Akzentfarbe, Fußzeile (erscheint auch auf der Anmeldeseite), **Bewegung und Effekte** (Vorgabe „Voll“ oder „Reduziert“ für alle, die selbst nichts gewählt haben, und für die Anmeldeseite – „Reduziert“ empfiehlt sich für Terminalserver und Fernzugriff, wo jede Animation Bandbreite kostet; damit entfällt auch die Unschärfe hinter den Glasflächen von Navigation, Menüs und Dialogen) |
| Zugriff & Sicherheit | Selbstregistrierung (optional mit Domain-Filter – neue Konten bestätigen ihre E-Mail-Adresse, sobald der E-Mail-Versand eingerichtet ist), anonymer Lesezugriff, persönliche Bereiche, **gleichzeitiges Bearbeiten in Echtzeit**, Passwortlänge, Sitzungsdauer, Sperre nach Fehlversuchen |
| Inhalte & Dateien | Upload-Grenze, gesperrte Dateiendungen, erlaubte Einbettungs-Hosts, Papierkorb-Frist, Versionslimit, Protokollaufbewahrung |
| Sicherungen | tägliche Sicherung, Uhrzeit, Anzahl, Anhänge einschließen |
| Warnungen an die Administration | E-Mail an alle Administratorkonten ein oder aus, **weitere Empfänger** (z. B. ein Verteiler), ab wie wenig freiem Speicher und ab welchem Alter der Sicherung gewarnt wird (`0` = nie), **Testwarnung senden** |

> [!NOTE]
> Für das gleichzeitige Bearbeiten muss ein vorgeschalteter Webserver (Reverse-Proxy) WebSocket-Verbindungen durchreichen. Die Einrichtung beschreibt das Administrationshandbuch (`docs/ADMINISTRATION.md`).

## E-Mail

Unter **Administration → E-Mail** wird der Versand eingerichtet:

1. **Vorlage** wählen (Microsoft 365 mit Anmeldung oder als Relay über einen Connector, Exchange im eigenen Netz, Google Workspace, IONOS, STRATO) oder einen eigenen Server eintragen.
2. **Absender**, bei Bedarf **Benutzer** und **Passwort** eintragen – das Passwort wird verschlüsselt gespeichert.
3. **Verbindung prüfen** meldet sich am Server an, ohne etwas zu verschicken; **Test-E-Mail** schickt sofort eine Nachricht. Fehler werden verständlich erklärt.
4. **Benachrichtigungen per E-Mail versenden** einschalten und die Uhrzeit der **täglichen Zusammenfassung** festlegen.

Das **Versandprotokoll** zeigt alle E-Mails der letzten 30 Tage mit Status. Fehlgeschlagene Zustellungen wiederholt Knowstead automatisch bis zu fünfmal; über **Erneut senden** geht es sofort. Neue Personen lassen sich unter **Benutzer** per E-Mail **einladen** – sie erhalten einen Link zum Festlegen des Passworts. E-Mails gehen in der Sprache der jeweiligen Person hinaus.

> [!IMPORTANT]
> Microsoft schaltet die Anmeldung mit Benutzername und Passwort für SMTP schrittweise ab. Scheitert die Anmeldung bei Microsoft 365, die Vorlage **Relay über Connector** verwenden.

## Export-Vorlage

Unter **Administration → Export-Vorlage** legst du fest, wie PDF- und Word-Dokumente aussehen: **Firma**, **Logo**, **Hausfarbe**, **Schriftart** (Word), **Vertraulichkeit** (z. B. „Intern“), **Papierformat**, ob **Deckblatt** und **Inhaltsverzeichnis** vorausgewählt sind, sowie **Kopf- und Fußzeile** mit Platzhaltern:

| Platzhalter | Wird ersetzt durch |
| --- | --- |
| `{company}` | Firmenname |
| `{title}` | Titel des Dokuments |
| `{space}` | Name des Bereichs |
| `{date}` | Exportdatum |
| `{version}` | Version der Seite |
| `{author}` | zuletzt bearbeitet von |
| `{owner}` | verantwortliche Person (Wiedervorlage) |
| `{classification}` | Vertraulichkeit |

Mit **Musterdokument** siehst du das Ergebnis als PDF oder Word, bevor du speicherst.

## KI & Dateien

Unter **Administration → KI & Dateien** werden vier optionale Bausteine eingerichtet:

**KI-Anbindung**

1. **Anbieter** wählen: Anthropic (Claude), OpenAI, Azure OpenAI, Ollama (lokal, ohne Internet) oder eine beliebige OpenAI-kompatible Schnittstelle.
2. **Modell**, bei Bedarf **Basis-URL** und **API-Schlüssel** eintragen (der Schlüssel wird verschlüsselt gespeichert und nie wieder angezeigt).
3. **Tageslimit je Person**, **maximale Antwortlänge** und die **freigeschalteten Funktionen** festlegen; optional eine **zusätzliche Anweisung** für Tonalität und Fachbegriffe.
4. **Verbindung testen**, dann **KI-Funktionen aktivieren** und speichern.
5. Unter **Gruppen** das Recht **KI-Funktionen nutzen** vergeben. Neue Installationen geben es der Gruppe „Benutzer“; bei bestehenden Installationen muss es einmalig ergänzt werden.

Die Nutzung (Anfragen, Token, Fehler, aktivste Personen) ist auf derselben Seite zu sehen; jede Anfrage steht zusätzlich im Audit-Log.

> [!IMPORTANT]
> Bei Cloud-Anbietern verlassen markierte Texte bzw. Seiteninhalte das Unternehmen. Klärt vorab mit Datenschutz und Betriebsrat, welche Inhalte übertragen werden dürfen – oder nutzt ein lokales Modell über Ollama.

**Office-Vorschau**

Für die Vorschau von PowerPoint-, Word-, Excel- und Visio-Dateien braucht der Server **LibreOffice**. Am einfachsten installiert es der Installationsassistent und schaltet die Vorschau gleich ein (Linux: `sudo bash install.sh --unattended --install-office`, Windows: Seite *Zusatzfunktionen* bzw. `Knowstead-Installation.cmd -Unattended -InstallLibreOffice`). Nach einer Installation von Hand die Vorschau aktivieren; der Pfad zu `soffice` wird automatisch gesucht oder kann eingetragen werden. Die Statusanzeige meldet, ob der Konverter gefunden wurde. Umgewandelte Dateien werden zwischengespeichert.

**Texterkennung (OCR)**

Eingescannte PDFs und Bilder enthalten keinen durchsuchbaren Text. Ist auf dem Server **Tesseract**
installiert (Windows: *Tesseract-OCR*, Linux: Paket `tesseract-ocr` mit Sprachpaketen `deu` und `eng`),
erkennt Knowstead den Text im Hintergrund und nimmt ihn in die Anhangsuche auf. Der Installationsassistent
installiert Tesseract samt Sprachdaten auf Wunsch mit (Linux: `sudo bash install.sh --unattended
--install-ocr`, Windows: Seite *Zusatzfunktionen* bzw. `Knowstead-Installation.cmd -Unattended
-InstallTesseract`) und trägt nur Sprachen ein, deren Daten wirklich vorhanden sind. Nach dem Aktivieren werden
vorhandene Anhänge nachträglich verarbeitet. Einstellbar sind Pfad, **Sprachen** (z. B. `deu+eng`) und
die **höchste Seitenzahl je PDF**; die Statusanzeige meldet gefundene Version, installierte Sprachen und
die Zahl erkannter Dateien.

**draw.io-Editor**

Standard ist `https://embed.diagrams.net`. Wer draw.io selbst betreibt (z. B. als Container `jgraph/drawio`), trägt hier dessen Adresse ein – dann funktionieren Diagramme auch ohne Internetzugang.

## Sicherungen und Wiederherstellung

Unter **Sicherungen** erstellst du jederzeit einen konsistenten Snapshot der Datenbank (optional inklusive Anhänge) und lädst ihn als ZIP herunter. Automatische Sicherungen laufen täglich zur eingestellten Stunde; ältere automatische Sicherungen werden entsprechend der Aufbewahrung entfernt.

**Wiederherstellen:** Server stoppen und `npm run cli -- restore <name der sicherung>` ausführen (mit `--with-uploads` auch die Anhänge). Der Befehl prüft die Sicherung, sichert vorher den aktuellen Stand und ersetzt die Datenbank sicher. Danach den Server starten.

> [!NOTE]
> Sicherungen enthalten den Serverschlüssel (`secret.key`) bewusst nicht. Bewahre ihn getrennt auf – ohne ihn sind gespeicherte Zugangsdaten (SMTP, Verzeichnis, KI, Single Sign-on) nach einer Wiederherstellung auf einem neuen Server neu einzutragen.

## Updates

Updates sind so abgesichert, dass keine Daten verloren gehen:

- Vor jeder Änderung an der Datenbank legt der Server automatisch eine Sicherung `backup-…-update` an.
- Alle Datenbankänderungen eines Updates gelingen vollständig oder gar nicht.
- Eine ältere Programmversion startet nicht auf einer Datenbank, die schon eine neuere benutzt hat.
- Solange der alte Dienst noch läuft, startet die neue Version nicht.
- `start.cmd` bzw. `start.sh` installieren geänderte Abhängigkeiten und bauen die Oberfläche neu.

**Linux, mit einem Befehl:** `sudo bash /opt/knowstead/update.sh <paket.tar.gz>` prüft das Paket (Prüfsumme), legt das neue Programm neben das alte, hält den Dienst an, tauscht die Ordner, startet und kontrolliert, ob Knowstead läuft und antwortet – und ergänzt das Handbuch. Läuft der neue Stand nicht, kommt der bisherige zurück, samt Datenbank. Der alte Programmordner bleibt als `/opt/knowstead.vor-<version>` liegen; `sudo bash /opt/knowstead/update.sh --rollback` kehrt dorthin zurück, `--dry-run` zeigt vorab, was geschähe. Beim ersten Update auf 1.8.0 das `update.sh` aus dem entpackten Paket starten.

Mit dem Installationsassistenten: Knowstead beenden (Windows `Knowstead-Dienst.cmd stop`, Linux `systemctl stop knowstead`) → neues Installationspaket über den Programmordner entpacken → `Knowstead-Installation.cmd -Unattended` bzw. `sudo bash install.sh --unattended` → **Wartung → Handbuch aktualisieren**. Der Assistent übernimmt die bisherigen Einstellungen, startet Knowstead wieder und prüft die Installation.

Von Hand: Dienst stoppen → neue Programmdateien einspielen → `start.cmd` bzw. `node scripts/prepare.mjs` → Dienst starten → **Wartung → Handbuch aktualisieren**. Zurück zur vorherigen Version: alte Programmdateien einspielen und `npm run cli -- restore backup-…-update`. Die ausführliche Anleitung steht im Administrationshandbuch (`docs/ADMINISTRATION.md`).

## Wartung

Suchindex neu aufbauen, **Anhänge neu indexieren** (liest den Text aller Dateien für die Suche neu ein), Papierkorb bereinigen (Seiten, Dateien **und Aufgaben** nach der eingestellten Frist), alte Protokolle entfernen, Sitzungen aufräumen, die Datenbank optimieren und das Handbuch nach einem Update aktualisieren. Aufräumen und Indexieren neuer Dateien laufen zusätzlich automatisch.

## Kommandozeile

Für Notfälle und Automatisierung gibt es ein Verwaltungswerkzeug:

```bash
npm run cli -- help
npm run cli -- status
npm run cli -- doctor          # Installation prüfen, mit --json maschinenlesbar
npm run cli -- stop            # laufenden Server geordnet beenden
npm run cli -- user:create --username anna --name "Anna Admin" --password "…" --admin
npm run cli -- user:password anna
npm run cli -- backup
npm run cli -- backup:list
npm run cli -- restore backup-20260913-030000-auto
npm run cli -- reindex
npm run cli -- handbook:sync
```

`doctor` prüft Node.js, Oberfläche, Datenverzeichnis, Speicherplatz, Adresse, Port, Serverschlüssel, Datenbank, Sicherungen und Protokoll und nennt zu jedem Problem die Abhilfe. Unter Windows steuert `Knowstead-Dienst.cmd start|stop|restart|status|log` den vom Assistenten eingerichteten Autostart.
