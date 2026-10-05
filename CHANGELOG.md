# Änderungsprotokoll

Alle nennenswerten Änderungen an Knowstead werden hier festgehalten.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

Die Versionshinweise sind auch in der Oberfläche unter **Administration → Über** zu sehen.

> **Bis Version 1.9.0 hieß das Programm „Doku“.** Die Abschnitte bis dahin stehen so da, wie sie
> geschrieben wurden – mit dem damaligen Namen, den damaligen Dateinamen und Befehlen.

## [2.1.0] – 2026-10-05

Die Installation gibt es jetzt auch auf Englisch: Der Assistent unter Windows, `install.sh` und die
Startskripte sprechen Deutsch und Englisch und richten sich nach der Sprache des Systems. Dazu
aktualisierte Abhängigkeiten.

### Installation auf Englisch

- **Eine Regel für alle Skripte**: ausdrücklich gewählt (`--lang de|en` unter Linux, `-Language de|en`
  unter Windows), sonst die Umgebungsvariable `KNOWSTEAD_LANG`, sonst die Sprache des Systems – Deutsch,
  wenn sie Deutsch ist, sonst Englisch.
- **Windows**: Der grafische Assistent ist vollständig zweisprachig – alle acht Seiten, Plan, Protokoll,
  Rückfragen und Fehlermeldungen. Auf der ersten Seite wechselt *In English* / *Auf Deutsch* die Sprache.
  Dasselbe gilt für den Lauf ohne Rückfragen (`Knowstead-Installation.cmd -Unattended`) und für
  `Knowstead-Dienst.cmd`.
- **Linux**: `install.sh` fragt, meldet und hilft (`--help`) in beiden Sprachen – im Terminal wie in den
  Dialogen mit `whiptail` –, ebenso die Hinweise zu Tesseract und LibreOffice. Wer die Sprache nicht
  ausdrücklich gewählt hat, sieht zu Beginn, wie es in der anderen geht.
- **Installationskern und Start**: `scripts/install.mjs`, `scripts/prepare.mjs`, `start.sh` und `start.cmd`
  folgen derselben Regel. Die Assistenten reichen ihre Sprache an den Kern weiter.
- **Prüfung der Installation**: `npm run cli -- doctor --lang en` gibt die Prüfung auf Englisch aus; der
  englische Installer zeigt sie so an. Ohne `--lang` bleibt die Ausgabe deutsch – `update.sh` und der
  Installationskern werten sie aus.
- **Konfigurationsdatei**: Eine englische Installation legt die `.env` aus `.env.example.en` an – dieselben
  Werte, Kommentare auf Englisch.
- **Einrichtungscode**: Die Zeile im Serverprotokoll nennt ihn jetzt auch als „setup code“
  (`journalctl -u knowstead | grep -i "setup code"`); `grep Einrichtungscode` findet sie wie bisher.
- Weiterhin deutsch sind `update.sh`, die übrigen Befehle der Kommandozeile und das Serverprotokoll.

### Behoben

- **Datenverzeichnis als Netzfreigabe unter Linux**: Eine Angabe in Windows-Schreibweise
  (`\\server\freigabe\…`) weist der Installationskern jetzt auch unter Linux ab. Bisher galt sie dort als
  gewöhnlicher Name – es entstand ein Ordner dieses Namens im Programmordner.

### Sicherheit

- **Abhängigkeiten aktualisiert** – `npm audit` meldete fünf Hinweise hoher Schwere, drei mittlere und
  einen niedrigen: fastify 5.12.5, fast-uri 3.1.8 und 4.2.1, ip-address 10.7.3, dompurify 3.4.16,
  brace-expansion 5.0.12. Das für alle Versionen gemeldete `braces` kam nur über
  `@excalidraw/excalidraw → sass → chokidar 3` herein; `sass` ist jetzt auf 1.79.0 festgelegt und bringt
  chokidar 4 ohne `braces` mit. Betroffen war davon nur die Entwicklung – `sass` läuft nicht zur Laufzeit
  und gehört nicht zu den Installationspaketen. Danach meldet `npm audit` nichts mehr.

### Dokumentation

- `docs/QUICKSTART.md` und `docs/INSTALLATION.en.md` beschreiben die englischen Rückfragen und Seiten des
  Assistenten statt der Übersetzungstabellen; `docs/INSTALLATION.md` und beide README nennen die Sprachwahl.
- `docs/ENTWICKLUNG.md`: wie die zweisprachigen Texte in den Skripten gepflegt werden.

### Tests

- Sprachwahl (`server/test/install-language.test.ts`): gewählt, aus `KNOWSTEAD_LANG`, aus der Sprache des
  Systems – in den Node-Skripten und in `install.sh`.
- Installationskern auf Englisch: Schritte, Hinweise, Prüfung, Vorlage der `.env`; die Prüfung bleibt ohne
  `--lang` deutsch, auch wenn die Umgebung Englisch nennt.
- `install.sh` auf Englisch: Hilfe, Probelauf, Rückfragen, Hinweise zu den Zusatzprogrammen.
- Windows-Assistent auf Englisch: Probelauf, Beanstandungen, Wiederanlauf nach einem Fehlschlag; der
  CI-Lauf rendert alle acht Seiten in beiden Sprachen.
- Inhalt der Installationspakete (`server/test/package-contents.test.ts`): Was die mitgelieferten Skripte
  einbinden, steht in der Paketliste; beide Vorlagen der `.env` haben dieselben Einträge. Der Paketbau
  prüft dasselbe am fertigen Paket und startet den Installationskern daraus einmal im Probelauf.
- Die automatischen Prüfungen auf GitHub bauen die Oberfläche jetzt vor den Tests – der Test des
  Installationskerns braucht sie. Damit liefen die Server-Tests erstmals unter Linux; zwei Eigenheiten sind
  behoben (die Netzfreigabe oben und ein Wettlauf im Test zum Beenden mit offener WebSocket-Verbindung).

### Update-Hinweise

- Keine Migration, keine neuen Pflichteinstellungen. Update wie gewohnt mit dem installierten Skript:
  `sudo bash /opt/knowstead/update.sh /tmp/knowstead-2.1.0-linux-x64.tar.gz` – bei Installationen, die als
  Doku eingerichtet wurden, `/opt/doku/update.sh` (in Containern als root ohne `sudo`).
- **Sprache der Assistenten nach dem Update**: `install.sh`, der Windows-Assistent und die Startskripte
  richten sich jetzt nach der Sprache des Systems. Auf einem Server mit englischer oder nicht gesetzter
  Systemsprache (in Containern oft `LANG=C.UTF-8`) erscheinen sie auf Englisch. Bei Deutsch bleibt es mit
  `--lang de`, `-Language de` oder `KNOWSTEAD_LANG=de`. `update.sh` ist unverändert deutsch.
- Wer die Ausgabe von `install.sh` oder des Assistenten in eigenen Skripten auswertet, legt die Sprache
  ausdrücklich fest.

## [2.0.1] – 2026-10-05

Die englische Oberfläche ist jetzt durchgehend englisch: Stellen, die bisher fest in deutscher Schreibweise
standen, richten sich nach der gewählten Sprache. Dazu eine Korrektur am Wiki-Import.

### Englische Oberfläche

- **Aufgabenplan**: Fälligkeiten auf den Karten erscheinen als „14 Oct“ statt „14. Okt.“, die Kalenderwochen
  der Zeitachse als „Wk 42“ statt „KW 42“.
- **Editor**: Der Befehl „Heute“ („Today“) im Schrägstrich-Menü fügt das Datum in der Schreibweise der
  Sprache ein (05/10/2026 statt 05.10.2026); Dateikarten zeigen die Größe mit Dezimalpunkt.
- **Untertitel der Installation**: Solange niemand einen eigenen eingetragen hat, steht auf der Anmelde- und
  der Startseite „Documentation & knowledge“ statt „Dokumentation & Wissen“. Ein selbst gewählter Untertitel
  bleibt, wie er ist.
- **Mitgelieferte Vorgaben in der Administration**: Der Untertitel (Einstellungen), die Fußzeile der
  Export-Vorlage („… · Date {date} · …“ statt „… · Stand {date} · …“, im Feld und in der Vorschau) und die
  Beschriftungen der Anmeldeknöpfe (Single Sign-on) stehen in den Feldern in der Sprache der Oberfläche.
  Export und Anmeldeseite richten sich weiter nach der Sprache der Person – gleich, in welcher Sprache die
  Vorgabe gespeichert wurde.
- **Aufgabe zur Wiedervorlage**: In einer englisch eingerichteten Installation legt das System die Aufgabe
  auf Englisch an („Review page: …“, Notiz, Stichwort „review“).
- **Benachrichtigungen und Warnungen**: Datums- und Zahlenangaben in übersetzten Texten folgen der Sprache –
  „The deadline expired on 01/10/2026“ statt „… on 1.10.2026“, „100,000“ statt „100.000“.
- **Wiki-Import** (MediaWiki, DokuWiki, XWiki, Confluence): In einer englisch eingerichteten Installation
  schreibt der Import seine Hinweise auf Englisch in die Seiten – nicht übernommene Vorlagen, Makros und
  Plugins, fehlende Seiten, Dateien und Bilder, den Hinweis auf eine zu große Seite – und Datumsangaben aus
  Confluence in englischer Schreibweise. Der Bericht nach dem Import (Warnungen, übersprungene Seiten,
  Fehlermeldung) und die Änderungsnotizen der übernommenen Versionen erscheinen in der Sprache der Person,
  die sie liest.
- **Musterdokument der Exportvorlage**: Text, Dateiname und Datum folgen der Sprache der Person.
- **Handbuch (englisch)**: Die mitgelieferte Gruppe heißt dort wie in der Oberfläche „Users“.

### Behoben

- **Wiki-Import scheitert nicht mehr an einer zu großen Seite mit Verweisen**: Eine Seite über 4,5 MB wird
  beim Import durch einen Hinweis ersetzt. Enthielt sie Verweise oder Bilder, schrieb der zweite Durchlauf
  (Verweise auflösen) doch wieder den ganzen Inhalt – ab 5 MB endete der Import damit als „fehlgeschlagen“,
  obwohl alle Seiten schon angelegt waren, und der Bericht ging verloren.

### Dokumentation

- Der Vergleich mit anderen Systemen (`docs/VERGLEICH.md`, `docs/COMPARISON.md`) gehört nicht mehr zum
  Repository und zu den Installationspaketen.

### Tests

- Oberfläche auf Englisch: Fälligkeit auf Aufgabenkarten, Kalenderwochen der Zeitachse, Untertitel,
  mitgelieferte Vorgaben in den Feldern der Administration (deutsch und englisch).
- Beschriftung der Anmeldeknöpfe und Fußzeile der Export-Vorlage, wenn die Vorgabe auf Englisch gespeichert
  ist; Aufgabe zur Wiedervorlage in einer englisch eingerichteten Installation.
- Wiki-Import in eine englisch eingerichtete Installation: Hinweise in den Seiten, Bericht und
  Änderungsnotizen in beiden Sprachen, Fehlermeldung eines gescheiterten Imports, zu große Seite mit
  Verweisen.
- Musterdokument der Exportvorlage auf Englisch; Datums- und Zahlenangaben in übersetzten Texten.
- Neues Werkzeug `npm run test:english` (`e2e/english-scan.mjs`): startet einen Server mit englisch
  eingerichteter Datenbank und durchsucht 64 Ansichten der englischen Oberfläche nach deutschen Wörtern,
  Umlauten und deutscher Datums- und Zahlenschreibweise – in Text, Beschriftungen und Feldinhalten, bei
  deutsch eingestelltem Browser. Mit Gegenprobe (`E2E_SCAN_UI=de`), die fündig werden muss.

### Update-Hinweise

- Keine Migration, keine neuen Einstellungen. Update wie gewohnt mit dem installierten Skript:
  `sudo bash /opt/knowstead/update.sh /tmp/knowstead-2.0.1-linux-x64.tar.gz` – bei Installationen, die als
  Doku eingerichtet wurden, `/opt/doku/update.sh` (in Containern als root ohne `sudo`).
- Bereits importierte Seiten bleiben, wie sie sind: Hinweise, die ein früherer Import auf Deutsch
  hineingeschrieben hat, werden nicht nachträglich übersetzt.
- Weiterhin deutsch sind der Installer (`install.sh`, Assistent unter Windows), `update.sh`, die
  Kommandozeile und das Serverprotokoll. Die englischen Anleitungen erklären die Rückfragen.

## [2.0.0] – 2026-10-04

Aus Doku wird **Knowstead**. Am Funktionsumfang ändert sich nichts – neu ist der Name, und zwar überall: im
Programm, in Paketen und Skripten, in Einstellungen und Schnittstellen. Bestehende Installationen laufen
nach dem Update unverändert weiter.

### Neuer Name

- **Programm und Oberfläche** heißen Knowstead: Anmeldung, Kopfleiste, E-Mails, Exporte, Handbuch,
  Dokumentation und die Meldungen der Kommandozeile.
- **Pakete und Skripte**: `knowstead-<version>-linux-x64.tar.gz` und `knowstead-<version>-windows-x64.zip`,
  unter Windows `Knowstead-Installation.cmd` und `Knowstead-Dienst.cmd`.
- **Neue Installationen unter Linux**: Dienst und Konto `knowstead`, Programmordner `/opt/knowstead`,
  Datenverzeichnis `/var/lib/knowstead`, Datenbank `knowstead.db`. Docker: Dienst und Image `knowstead`,
  Volume `knowstead-data`.
- **Einstellungen in der `.env`**: `KNOWSTEAD_SECRET`, `KNOWSTEAD_SERVICE`, `KNOWSTEAD_ALLOW_KEY_CHANGE`,
  `KNOWSTEAD_ALLOW_DOWNGRADE` und `KNOWSTEAD_SKIP_UPDATE_BACKUP`.
- **Schnittstellen**: API-Tokens beginnen mit `knowstead_`, das Sitzungs-Cookie heißt `knowstead_session`,
  die Kopfzeilen `X-Knowstead-Client`, `X-Knowstead-Locale` und `X-Knowstead-Proxy-Secret`. Webhooks senden
  `X-Knowstead-Event`, `X-Knowstead-Delivery`, `X-Knowstead-Timestamp` und `X-Knowstead-Signature`; das
  Archiv eines Bereichs enthält `knowstead-space.json`.

### Bestehende Installationen laufen weiter

Wer Doku bis 1.9 installiert hat, muss nichts umstellen – das Update tauscht nur das Programm:

- **Dienst, Konto, Ordner und Datenbank behalten ihre Namen** (`doku`, `/opt/doku`, `/var/lib/doku`,
  `doku.db`). `update.sh` und `install.sh` finden den bestehenden Dienst selbst; ein zweiter Dienst daneben
  entsteht nicht. Hinweise des Programms („systemctl restart …“) nennen den Dienst, den es gibt.
- **`.env`**: Einträge mit `DOKU_` gelten weiter. Ein späterer Lauf von `install.sh` schreibt sie auf
  `KNOWSTEAD_` um; die bisherige Datei wird dabei wie immer gesichert.
- **Niemand wird abgemeldet**: Das Cookie `doku_session` gilt weiter, ebenso API-Tokens mit `doku_`.
- **Skripte und Proxys**: Die Kopfzeilen `X-Doku-Client`, `X-Doku-Locale` und `X-Doku-Proxy-Secret` werden
  weiter angenommen. Webhooks senden beide Sätze Kopfzeilen (`X-Knowstead-…` und `X-Doku-…`) mit derselben
  Signatur.
- **Sicherungen und Archive**: Sicherungen mit `doku.db` lassen sich einspielen. Eine Installation mit
  `doku.db` sichert weiter unter diesem Namen – so kann auch die Vorversion die Sicherung zurückspielen,
  wenn ein Update zurückgenommen wird. Archive mit `doku-space.json` lassen sich importieren.
- **Im Browser** ziehen die persönlichen Einstellungen (Farbschema, Sprache, Seitenleiste, aufgeklappte
  Zweige im Seitenbaum, Ansicht des Aufgabenplans) beim ersten Laden um.
- **Name der Installation**: Heißt sie noch „Doku“ (die Vorgabe), wird daraus beim Update einmalig
  „Knowstead“; ein selbst gewählter Name bleibt. Das mitgelieferte Handbuch wird wie bei jedem Update
  aktualisiert – Kapitel, die jemand bearbeitet hat, bleiben unangetastet.
- **Update mit dem installierten Skript**: Pakete tragen ihre Beschreibung zusätzlich unter dem früheren
  Namen (`.doku-package.json`) – daran erkennt das `update.sh` einer Installation mit 1.8 oder 1.9 ein
  Installationspaket. Beim Beenden verstehen Server und Kommandozeile beide Namen der Stopp-Datei, auch über
  die Versionen hinweg.

### Betrieb

- **`install.sh` richtet nicht versehentlich eine zweite, leere Installation ein**: In einem frisch
  entpackten Paket bricht es ab, wenn der Dienst schon auf eine Installation in einem anderen Ordner zeigt,
  und nennt den richtigen Weg (`update.sh`) – statt den Dienst auf ein leeres Datenverzeichnis umzubiegen.
- **API-Tokens in der Liste**: Zum Wiedererkennen stehen die Kennung und sieben Zeichen des Tokens da.

### Dokumentation

- **Startseite auf Englisch**: `README.md` beschreibt Knowstead für englischsprachige Leserinnen und Leser –
  mit Bildschirmfotos, Funktionsübersicht, Einordnung („passt gut / passt nicht“) und Schnellstart. Die
  deutsche Fassung liegt in `README.de.md`.
- **Installationsanleitung auf Englisch** in zwei Fassungen: `docs/QUICKSTART.md` (Kurzfassung, etwa
  15 Minuten) und `docs/INSTALLATION.en.md` (vollständig). Beide erklären die deutschen Rückfragen des
  Installers und nennen die Befehle, die ohne Rückfragen auskommen.
- **Verweise werden geprüft**: `npm run lint` kontrolliert jetzt alle Verknüpfungen und Anker der
  Dokumentation (`scripts/check-docs.mjs`).

### Tests

- Verträglichkeit mit Installationen bis 1.9 (`legacy-names.test.ts`): Einträge mit `DOKU_`, `doku.db` beim
  Start, in Sicherungen und beim Zurückspielen, Sitzung und Token von vor dem Update, frühere Kopfzeilen,
  beide Sätze Kopfzeilen der Webhooks, Archiv mit `doku-space.json`, Name der Installation, Stopp-Datei in
  beide Richtungen.
- `update.sh` an einer nachgestellten Installation von 1.9 – mit dem unveränderten Skript aus dem Paket
  1.9.0 (`test/fixtures/update-1.9.0.sh`): Update über das installierte Skript und aus dem entpackten Paket,
  Rückkehr von selbst und mit `--rollback`, jeweils mit dem Dienst »doku«; dieselben Abläufe mit
  Root-Rechten (`test/linux/update-root-check.sh`).
- `install.sh` über einer früheren Installation: Dienst, Konto und Datenverzeichnis bleiben.
- Oberfläche: Einstellungen im Browser ziehen beim ersten Laden um.

### Update-Hinweise

- **Von Doku 1.8 oder 1.9**: wie gewohnt mit dem installierten Skript –
  `sudo bash /opt/doku/update.sh /tmp/knowstead-2.0.0-linux-x64.tar.gz` (in Containern ohne `sudo` als root
  ohne `sudo`). Von älteren Versionen: Paket entpacken und dessen `update.sh` starten. Keine Migration.
- **Dienst und Ordner heißen danach weiter `doku`**: `systemctl status doku`, `journalctl -u doku`,
  `/opt/doku`, `/var/lib/doku`. Zurück geht es wie bisher mit `sudo bash /opt/doku/update.sh --rollback`.
- **Eigene Skripte und Empfänger von Webhooks** nach und nach umstellen: `X-Knowstead-…` statt `X-Doku-…`.
  Die früheren Kopfzeilen entfallen mit Version 3. Wer Anfragen am `User-Agent` erkennt: Er lautet jetzt
  `Knowstead/<version>` bzw. `Knowstead-Webhooks/<version>`.
- **Docker**: Das mitgelieferte `docker-compose.yml` nennt Dienst und Volume jetzt `knowstead` und
  `knowstead-data`. Wer ein bestehendes Compose-Projekt weiterführt, behält dort den Namen seines Volumes
  (`doku-data`) bei – sonst startet der Container mit einem leeren Volume.
- **Windows**: Aufgabe bzw. Dienst und die Skripte tragen den neuen Namen. Eine Installation, die noch unter
  „Doku“ eingerichtet ist, vor dem Update mit dem **bisherigen** Paket aus dem Autostart nehmen
  (`Doku-Installation.cmd -Uninstall`; Daten und `.env` bleiben), dann das neue Paket über den
  Programmordner entpacken und `Knowstead-Installation.cmd -Unattended` starten.
- Nach dem Update lädt der Browser die neue Oberfläche von selbst; offene Fenster einmal neu laden.

## [1.9.0] – 2026-10-04

Die Navigation im Stil der 3D-Bühne: Kopfleiste und Seitenleisten schweben als Glasebenen über dem Inhalt –
und das Glas ist jetzt in jedem Browser wirklich Glas.

### Erscheinungsbild

- **Schwebende Glasebenen**: Kopfleiste und Seitenleiste stehen mit Abstand zum Fensterrand, haben runde
  Ecken, eine Glaskante mit Lichtsaum und einen weichen Schatten – wie die Seiten der 3D-Szene auf Anmeldung
  und Startseite. In der Seitenleiste liegt ein Lichtvolumen in der Akzentfarbe; Kopfleiste und Seitenleiste
  gleiten beim Laden kurz herein.
- **Lichtmarke am aktiven Eintrag**: Der aktive Eintrag trägt eine Fläche im Akzentverlauf, einen feinen
  Ring und links eine leuchtende Marke, die beim Wechsel aus der Mitte wächst. Unter dem Zeiger folgt ein
  Lichtkegel, das Symbol federt und nimmt die Akzentfarbe an. Zähler (offene Aufgaben, Benachrichtigungen)
  sind kleine Marken, Abschnittstitel haben eine auslaufende Linie, Bereiche zeigen ihr Symbol als Kachel.
- **Kopf eines Bereichs**: Symbol in einer Kachel mit Verlaufsring und Lichthof in der Farbe des Bereichs,
  das Kürzel als kleine Marke – ebenso der Kopf der Administration.
- **Seitenbaum mit Verbindungslinien**: Unterseiten hängen an einer Linie unter dem Pfeil ihrer Seite. Der
  Weg zur geöffneten Seite leuchtet im Akzentverlauf – wie die Verbindungen zwischen den Seiten der Szene.
- **Leiste über der Seite**: Brotkrumen und Aktionen stehen in einer schwebenden Glasleiste; beim Scrollen
  gleitet der Inhalt sichtbar darunter hindurch, der Lesefortschritt läuft an ihrer Unterkante. Hinweise
  darunter (Entwurf, Prüfung, archivierter Bereich) sind eingerückte Karten statt durchgehender Streifen.
- **„Auf dieser Seite“**: eine Glaskarte mit Schiene – der aktuelle Abschnitt leuchtet.
- **Reiter**: Der aktive Reiter hat eine Marke im Akzentverlauf, die beim Wechsel aufzieht.
- **Editor**: Menüband und Fußleiste schweben wie die übrige Navigation.
- **Handy**: Die Kopfleiste bleibt angedockt (jeder Pixel zählt) und bekommt eine Linie im Akzentverlauf. Die
  Seitenleiste ist eine schwebende Schublade über einem Schleier; ein Tipp daneben schließt sie.
- Eigene Gestaltung: Abstand und Radius der Ebenen sind Token (`--shell-gap`, `--shell-radius`); mit `0px`
  docken Kopf- und Seitenleiste wieder an den Rand.
- **Terminalserver und Fernzugriff**: Mit der Einstellung „Reduziert“ (Benutzermenü → *Animationen und
  3D-Effekte* bzw. *Administration → Einstellungen → Bewegung und Effekte*) entfällt neben den Animationen
  auch die Unschärfe hinter den Glasflächen; sie decken dann stärker. Die Unschärfe kostet bei jedem Bild
  Rechenzeit – über eine Fernsitzung macht sich das bemerkbar.

### Barrierefreiheit

- Die geschlossene Schublade der Seitenleiste ist auf dem Handy nicht mehr per Tastatur oder
  Vorleseprogramm erreichbar (bisher lag sie nur außerhalb des Bildes).
- Wer im Betriebssystem „Transparenz reduzieren“ gewählt hat, bekommt deckende Flächen statt Glas; im
  Kontrastmodus trägt der aktive Eintrag einen Rahmen in der Hervorhebungsfarbe des Systems.
- Bei reduzierter Bewegung (Betriebssystem oder Einstellung in Doku) stehen Ebenen und Marken sofort an
  ihrem Platz.

### Behoben

- **Glas war außerhalb von Safari klar**: Im ausgelieferten Build fehlte bei Kopfleiste, Seitenleiste,
  Menüs, Dialogen, der Anmeldekarte und dem Rundgang die Unschärfe – übrig blieb nur die Schreibweise mit
  `-webkit-`, die Edge, Chrome und Firefox nicht kennen. Im Entwicklungsmodus fiel das nicht auf. Am
  deutlichsten war es auf dem Handy: Durch die Schublade der Seitenleiste schien die Seite dahinter, im
  dunklen Design kaum lesbar. Die Stylesheets schreiben jetzt nur noch `backdrop-filter`, den Rest ergänzt
  der Build.

### Tests

- `e2e/tests/shell.spec.ts` prüft am ausgelieferten Build: Abstand und Rundung der Ebenen, Unschärfe von
  Kopfleiste, Seitenleiste, Menü, Dialog, Leiste über der Seite und Inhaltsverzeichnis, die Lichtmarke und
  den Lichtkegel, die leuchtende Verbindungslinie im Seitenbaum, das Haften der Leiste beim Scrollen, den
  Kontrastmodus und die Schublade auf dem Handy samt Schleier.

### Update-Hinweise

- Keine Migration. Einspielen wie gewohnt: `sudo bash /opt/doku/update.sh doku-1.9.0-linux-x64.tar.gz`.
- Nach dem Update lädt der Browser die neue Oberfläche von selbst; offene Fenster einmal neu laden.
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (Kapitel Erste Schritte und Administration
  ergänzt) – `update.sh` erledigt das selbst.
- Menüs, Dialoge und Leisten sind jetzt in jedem Browser unscharf hinterlegt. Wirkt die Oberfläche über
  Terminalserver oder Fernzugriff dadurch träge: unter *Administration → Einstellungen* die Vorgabe
  **Bewegung und Effekte** auf „Reduziert“ stellen.

## [1.8.0] – 2026-10-04

Update mit einem Befehl, Warnungen per E-Mail und für Überwachungssysteme, Wiki-Importe von der Platte
statt aus dem Arbeitsspeicher – und die Suche findet Aufgaben jetzt auch über ihren Chat.

### Betrieb

- **Update mit einem Befehl (Linux)**: Jedes Installationspaket bringt `update.sh` mit.
  `sudo bash /opt/doku/update.sh doku-1.8.0-linux-x64.tar.gz` prüft die Prüfsumme (`.sha256`-Datei neben
  dem Paket oder `--sha256`), Architektur und Node.js-Version, legt das neue Programm neben das alte –
  Doku läuft dabei weiter –, übernimmt `.env` (mit Eigentümer und Rechten) und eigene Plugins, hält den
  Dienst an, tauscht die Ordner, startet und prüft mit `doctor`, ob der neue Stand läuft, auf seinem Port
  antwortet und wirklich der neue ist. Der bisherige Programmordner bleibt als `<ordner>.vor-<version>`
  liegen (die letzten zwei, `--keep`), ein Datenverzeichnis im Programmordner zieht mit um, das Handbuch
  wird ergänzt. `--dry-run` zeigt die Schritte vorab, `--yes` verzichtet auf die Rückfrage.
- **Läuft der neue Stand nicht, kommt der bisherige zurück**: Antwortet der Server nach dem Tausch nicht
  binnen 120 Sekunden (`--wait`), schiebt das Skript den bisherigen Ordner zurück und startet ihn. Hatte
  der neue Stand die Datenbank schon umgestellt, wird die Sicherung `backup-…-update` dieses Updates
  zurückgespielt – die alte Version kann mit der neuen Datenbank nicht arbeiten. Der gescheiterte Stand
  bleibt als `<ordner>.fehlgeschlagen-<zeit>` zur Fehlersuche liegen; das nächste gelungene Update räumt
  ihn weg.
- **Zurück zum Stand davor**: `sudo bash /opt/doku/update.sh --rollback` holt den zuletzt aufbewahrten
  Programmordner zurück. Hat das Update die Datenbank umgestellt, steht das **vor** der Rückfrage da: Die
  Datenbank wird dann auf den Stand vor dem Update gesetzt, der jetzige Stand vorher als
  `backup-…-restore` gesichert. Die Datenbank wird zurückgespielt, bevor die Ordner getauscht werden –
  scheitert es, bleibt alles, wie es ist; fehlt die Sicherung vom Update, lehnt das Skript ab, ohne den
  Dienst anzuhalten.
- **Sorgfalt im Kleinen**: Die Kommandozeile von Doku läuft im Skript unter dem Dienstkonto (dem das
  Datenverzeichnis gehört) – eine als root zurückgespielte Datenbank könnte der Dienst nicht mehr
  schreiben. Node.js ist dasselbe, mit dem der Dienst läuft (aus dem Dienst-Eintrag). Bricht die
  SSH-Verbindung ab, läuft das Update zu Ende; `Strg`+`C` räumt auf und stellt nach dem Tausch den
  bisherigen Stand wieder her. Eigene Dateien im Programmordner, die das Paket nicht kennt, werden am
  Ende genannt statt stillschweigend zurückgelassen.
- **Warnungen an die Administration**: Doku prüft alle zehn Minuten, ob die automatische Sicherung
  gescheitert ist, die neueste Sicherung zu alt ist (Vorgabe zwei Tage), der freie Speicher auf dem
  Laufwerk der Daten knapp wird (Vorgabe unter 2 GB; unter 500 MB als Fehler) oder nach einem Update der
  Neustart fehlt. *Administration → Übersicht* zeigt jede Warnung mit Erklärung, Abhilfe und „seit“. Alle
  aktiven Administratorkonten mit E-Mail-Adresse bekommen eine Nachricht: beim Auftreten, bei einer
  Verschärfung, einmal täglich als Erinnerung und zum Schluss die Entwarnung – in der Sprache der Person.
  Unter *Einstellungen → Warnungen an die Administration* lassen sich die E-Mails abschalten, **weitere
  Empfänger** eintragen (Verteiler, Ticketsystem), die Schwellen ändern und eine **Testwarnung** senden.
- **Für Überwachungssysteme**: `GET /api/v1/monitoring` liefert `ok`, `warn` oder `error` samt Warnungen
  und Messwerten (freier Speicher, Alter der Sicherung, gescheiterte E-Mails, Laufzeit, fehlender
  Neustart). Mit `?strict=true` antwortet der Server bei `warn` und `error` mit HTTP 503 – dann genügt
  der Überwachung der Statuscode. Der Endpunkt verlangt ein Administratorkonto; ein Token mit dem Umfang
  `read` reicht.
- **Gescheiterte Sicherung wird wiederholt**: Schlägt die nächtliche Sicherung fehl, versucht Doku es
  nach einer Stunde erneut statt erst in der nächsten Nacht; die Warnung endet mit der ersten gelungenen
  Sicherung.
- **Antwortet der Server?** `npm run cli -- doctor` prüft bei laufendem Server jetzt auch, ob er auf
  seinem Port antwortet (neue Prüfung *Erreichbarkeit*) – ein Prozess, der die Datenbank hält, aber nicht
  antwortet, fiel bisher nicht auf.

### Import

- **Wiki-Import in Stücken**: Hochgeladene Archive wurden vollständig in den Arbeitsspeicher geladen und
  dort entpackt – ein Wiki mit vielen Bildern brauchte ein Mehrfaches seiner Größe an Speicher und konnte
  den Server auf kleinen Maschinen beenden. Jetzt schreibt Doku den Upload als Datenstrom ins
  Datenverzeichnis (`tmp/`), liest vom ZIP nur das Inhaltsverzeichnis und entpackt jede Datei einzeln und
  erst dann, wenn ihr Anhang angelegt wird; ein MediaWiki-Dump wird Seite für Seite gelesen. Gemessen mit
  einem MediaWiki-Archiv von 400 MB: Spitzenbedarf 235 MB statt 947 MB; ein Archiv von 1,2 GB belegt
  275 MB. Das gilt für alle Importe: MediaWiki, DokuWiki, XWiki, Confluence, Markdown/HTML/ZIP und
  Doku-Archive.
- **Größere Archive**: Entpackt sind jetzt 8 GB erlaubt (bisher 2 GB), weiterhin höchstens 100 000
  Dateien; eine hochgeladene Datei darf 2 GB groß sein, ein einzelner Anhang im Archiv 512 MB. ZIP64 wird
  gelesen, die Prüfsumme jedes Eintrags geprüft, verschlüsselte Einträge werden abgelehnt.
- **Klare Meldungen**: Fehlt auf dem Server der Platz für den Upload, sagt Doku das (HTTP 507) statt mit
  einem allgemeinen Fehler abzubrechen. Lässt sich eine einzelne Mediendatei nicht lesen, steht sie als
  Warnung im Bericht – der Import läuft weiter.
- Zwischendateien verschwinden nach jedem Import; nach einem Absturz mitten im Import räumt der nächste
  Start des Servers auf.

### Aufgabenplaner und Suche

- **Chat in der Suche**: Die Suche findet Aufgaben jetzt auch über die Nachrichten in ihrem Chat. Der
  Treffer zeigt unter *Im Chat* den Ausschnitt mit dem Namen der Person und springt beim Öffnen zu genau
  dieser Nachricht (sie ist kurz hervorgehoben). Gelöschte Nachrichten und Aufgaben im Papierkorb
  erscheinen nicht; sichtbar ist nur, was der Bereich erlaubt.
- **Ungelesenes auf der Karte**: Haben andere im Chat geschrieben, seit man zuletzt hineingesehen hat,
  ist der Zähler auf der Karte und unter *Meine Aufgaben* hervorgehoben und trägt einen Punkt. Mit dem
  Öffnen der Aufgabe gilt der Chat als gelesen, eigene Nachrichten zählen nie
  (`unreadComments` an jeder Aufgabe, `POST /api/v1/tasks/{id}/comments/read`, Migration 024).

### Behoben

- **Aufgabensuche und Umlaute**: „überstunden“ fand die Aufgabe „Überstunden“ nicht – SQLite vergleicht
  nur die Buchstaben A bis Z ohne Rücksicht auf Groß- und Kleinschreibung. Titel, Beschreibung,
  Stichwörter und Chat werden jetzt einheitlich klein verglichen.
- **Hinweise von `install.sh`**: Die Befehle am Ende der Ausgabe nannten `sudo` auch dort, wo es keines
  gibt (Proxmox-Container); als Weg für Updates steht dort jetzt `update.sh`.

### Tests

- `server/test/update-script.test.ts` spielt das Update-Skript an einer nachgestellten Installation
  durch (elf Abläufe: aus der Installation und aus dem entpackten Paket, falsche Prüfsumme, neuer Stand
  antwortet nicht, Datenbank schon umgestellt, `--rollback` mit und ohne Datenbank, Datenverzeichnis im
  Programmordner, Probelauf, falsches Paket, Aufräumen) – auch unter Windows mit der Bash von Git.
- `server/test/linux/update-root-check.sh` prüft dasselbe Skript unter Linux mit echten Root-Rechten:
  Eigentümer und Rechte des neuen Ordners und der `.env`, Wechsel zum Dienstkonto, Leerzeichen im Pfad,
  abgebrochene Verbindung (SIGHUP, Ausgabe nicht mehr lesbar) und Abbruch vor und nach dem Tausch
  (83 Prüfungen).
- Neue Serversuiten für Warnungen (Auftreten, Verschärfung, Erinnerung, Entwarnung, Empfänger,
  Überwachung), das Lesen von ZIP-Archiven von der Platte (ZIP64, Grenzen, beschädigte Archive), Importe
  von der Platte, die Suche im Chat und das Ungelesen-Zeichen samt Migration 024; ein Browsertest für
  Chat-Treffer und Ungelesen-Zeichen.

### Dokumentation

- Installationsanleitung: Abschnitt *Updates* mit `update.sh` (Ablauf, erstes Update, Probelauf,
  Rückkehr), Proxmox, Fehlersuche. Administrationshandbuch: neuer Abschnitt *Warnungen und Überwachung*,
  *Update auf 1.8*, Grenzen der Importe. API-Anleitung: Überwachung, Warnungen, Chat-Treffer der Suche,
  Lesestand des Chats. Handbuch (Deutsch und Englisch): Kapitel Suche, Aufgabenplaner, Administration und
  Export/Import.

### Update-Hinweise

- **Erstes Update mit dem Skript** – die laufende Installation hat noch kein `update.sh`, deshalb das
  aus dem neuen Paket starten:
  `cd /tmp && tar -xzf doku-1.8.0-linux-x64.tar.gz && sudo bash /tmp/doku-1.8.0-linux-x64/update.sh`
  (in Containern ohne `sudo` als root ohne `sudo`). Ab dem nächsten Update genügt
  `sudo bash /opt/doku/update.sh <paket.tar.gz>`. Der bisherige Weg – Paket über den Programmordner
  entpacken, `install.sh --unattended` – funktioniert weiter.
- Migration 024 (Suchtext und Lesestand für den Chat der Aufgaben). Vor der Migration legt der Server wie
  gewohnt eine Sicherung an. Nachrichten von vor dem Update gelten als gelesen.
- **Warnungen sind eingeschaltet**: Ist der E-Mail-Versand eingerichtet, bekommen die Administratorkonten
  ab jetzt Warnungen per E-Mail. Empfänger und Schwellen unter *Administration → Einstellungen →
  Warnungen an die Administration* prüfen und einmal **Testwarnung senden**.
- Importe brauchen im Datenverzeichnis so viel freien Platz, wie das hochgeladene Archiv groß ist.
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (Kapitel Suche, Aufgabenplaner,
  Administration und Export/Import ergänzt) – `update.sh` erledigt das selbst.

## [1.7.0] – 2026-10-04

Chat je Aufgabe mit Erwähnungen, eine 3D-Bühne mit Bewegung, Papierkorb, Suche und Sammeländerung im
Aufgabenplaner, Tesseract und LibreOffice auf Wunsch gleich mitinstalliert, drei geschlossene Datenlecks –
und Doku merkt jetzt selbst, wenn nach einem Update der Neustart fehlt.

> Diese Version fasst zusammen, was seit dem 15.09.2026 als Zwischenstände von 1.6.0 ausgeliefert wurde
> (Pakete `b5` bis `b13`), und ergänzt die Punkte unter „Betrieb“ sowie die erste Korrektur unter „Behoben“.
> Ab jetzt bekommt jedes ausgelieferte Paket eine eigene Versionsnummer und einen eigenen Abschnitt.

### Betrieb

- **Update ohne Neustart wird erkannt**: Wird der Programmordner ersetzt, der Dienst aber nicht neu
  gestartet, arbeitet der alte Prozess aus dem Arbeitsspeicher weiter – mit altem Programm, aber neuer
  Oberfläche und neuen Dateien. Doku meldet das jetzt an drei Stellen: *Administration → Übersicht* zeigt
  **Neustart erforderlich** samt dem passenden Befehl, `npm run cli -- status` und `doctor` nennen den Stand
  des laufenden Servers und den im Programmordner (neue Prüfung *Programmstand*), und im Protokoll steht eine
  Warnung. Erkannt werden ein ersetzter Ordner (alter verschoben, neuer an derselben Stelle), ein über den
  Ordner entpacktes neues Paket und ein entfernter Ordner.
- **Welcher Stand läuft?** Stammt die Installation aus einem Paket, zeigen *Administration → Übersicht*,
  `npm run cli -- status` und `doctor` den **Bauzeitpunkt des Pakets**. Zwei Pakete derselben Version
  ließen sich sonst nicht unterscheiden – nach einem Update war nicht erkennbar, ob es angekommen ist.

### Installation

- **Tesseract und LibreOffice auf Wunsch mitinstallieren**: Die Assistenten erkannten die beiden
  Zusatzprogramme bisher nur, wenn sie schon vorhanden waren. Jetzt fragen sie, ob installiert werden soll:
  `install.sh` über die Paketverwaltung (`apt` bzw. `dnf`; Tesseract mit den Sprachdaten Deutsch und
  Englisch, LibreOffice ohne grafische Oberfläche samt Schriften – der Kern `libreoffice-core-nogui` wird
  ausdrücklich angefordert, weil apt sonst den mit Oberfläche wählt), der Windows-Assistent über `winget`.
  Die Paketinstallation fügt nur hinzu (`apt-get --no-remove`): Vorhandene Pakete bleiben unangetastet.
  Ohne Rückfragen: `--install-ocr`, `--install-office`, `--ocr-languages deu+eng+fra` bzw.
  `-InstallTesseract`, `-InstallLibreOffice`, `-OcrLanguages`. Nachrüsten auf einer bestehenden
  Installation: `sudo bash install.sh --unattended --install-ocr --install-office`. Die Pakete werden
  geladen, bevor der Dienst anhält; scheitert die Installation, läuft die Einrichtung ohne die
  Zusatzfunktion weiter.
- **Zusatzprogramme halten die Installation nicht mehr auf**: Ließ sich Tesseract oder LibreOffice nicht
  eintragen (Pfad falsch, keine passenden Sprachdaten, LibreOffice nur als Snap-Starter), brach der
  Installationskern ab – bei einem Update, **nachdem** der Dienst angehalten war; Doku blieb aus. Jetzt
  bleibt die Einstellung, wie sie ist, die Einrichtung läuft durch, und am Ende steht unter „Hinweise“,
  was offen blieb (Linux am Schluss der Ausgabe, Windows auf der Seite „Fertig“ bzw. in der Konsole).
- **Nach einem Fehlschlag läuft Doku wieder**: Bricht die Einrichtung aus einem anderen Grund ab, nachdem
  der Assistent ein laufendes Doku angehalten hat, startet er es wieder (systemd-Dienst, geplante Aufgabe
  oder NSSM-Dienst) und meldet, falls auch das nicht gelingt.
- **LibreOffice wird als `soffice` eingetragen**: `install.sh` nahm ersatzweise einen Starter namens
  `libreoffice` – den lehnt der Server als Konverter ab. Verweist der Starter auf `soffice` (Debian,
  Fedora), wird das Ziel eingetragen; der Snap-Starter gilt nicht als LibreOffice, weil die Umwandlung im
  Snap das Arbeitsverzeichnis des Dienstes nicht sieht.
- **Sprachdaten der Texterkennung werden geprüft**: Tesseract bricht bei einer einzigen fehlenden Sprache
  ganz ab – wer bisher ein Tesseract nur mit Englisch einschaltete, bekam mit der Vorgabe `deu+eng` gar
  keine Texterkennung. Der Installationskern fragt Tesseract jetzt nach den vorhandenen Sprachen, trägt nur
  diese ein und meldet die fehlenden; `install.sh` bietet das Nachinstallieren an, der Windows-Assistent
  lädt fehlende Sprachdaten aus dem Tesseract-Projekt nach.

### Aufgabenplaner

- **Chat je Aufgabe**: Jede Aufgabe hat rechts neben den Feldern (auf schmalen Bildschirmen darunter)
  einen Verlauf für Fragen, Zwischenstände und Absprachen – derselbe Editor wie bei Seitenkommentaren, also mit **@-Erwähnungen**. Erwähnte, die
  verantwortliche Person, wer die Aufgabe angelegt hat und wer schon mitgeschrieben hat, werden
  benachrichtigt (auch per E-Mail, mit Sprung in den Dialog). Schreiben darf ab der Rolle
  *Kommentieren* – auch, wer die Aufgabe selbst nicht bearbeiten darf; Lesende lesen mit. Eigene
  Nachrichten lassen sich ändern und löschen, die Bereichsverwaltung darf alle löschen. Karten zeigen
  die Anzahl der Nachrichten, der CSV-Export bekommt die Spalte *Nachrichten*; das bisherige Notizfeld
  heißt jetzt **Beschreibung**. Der Chat wandert mit der Aufgabe in den Papierkorb und zurück
  (`GET/POST /api/v1/tasks/{id}/comments`, `PATCH/DELETE /api/v1/task-comments/{id}`, Migration 023).
- **Aufgaben in der Suche**: Die Suche findet jetzt auch Aufgaben über Titel, Notizen und Stichwörter;
  der Treffer öffnet die Karte im Plan. Sichtbar ist nur, was der Bereich erlaubt.
- **Papierkorb für Aufgaben**: Löschen ist umkehrbar. Gelöschte Aufgaben stehen im Papierkorb des
  Bereichs, kommen mit ihren Abhängigkeiten zurück und werden nach der Aufbewahrungszeit
  (`trashRetentionDays`) von der Wartung endgültig entfernt. Bis dahin halten sie keine Nachfolgerin auf.
- **Mehrere Karten gleichzeitig**: Karten mit Strg oder Umschalt anklicken, dann Verantwortliche, Spalte,
  Fälligkeit oder Priorität für alle setzen, auf erledigt stellen oder löschen – über
  `POST /api/v1/tasks/bulk`, alles oder nichts, höchstens 100 Aufgaben.
- **Abhängigkeiten über Pläne hinweg**: Vorgängerinnen dürfen in anderen Plänen und Bereichen liegen
  (Programm mit Teilprojekten). Die Auswahl im Dialog zeigt erst den Plan, dann die Aufgabe; Pfeile und
  Namen erscheinen in beiden Plänen. Aufgaben aus Bereichen ohne Zugriff bleiben verborgen. Verschoben
  wird nur, wo im eigenen Plan „automatisch planen“ eingeschaltet ist.
- **Plan als CSV**: Export mit allen Spalten für Excel und Besprechungen, mit Schutz vor eingeschleusten
  Formeln.
- **Live-Aktualisierung im Plan**: Änderungen anderer erscheinen ohne Neuladen – für alle, die den
  Bereich sehen dürfen.
- **Fortschritt aus der Checkliste**: Ein Schalter im Aufgabendialog rechnet den Fortschritt aus dem
  Anteil erledigter Punkte (4 Punkte, 1 erledigt = 25 %) und hält ihn beim Abhaken aktuell. Ohne den
  Schalter bleibt der Regler wie bisher von Hand bedienbar.
- **Mehr Stichwörter**: bis zu 30 statt 10 je Aufgabe. Bereits im Plan verwendete Stichwörter werden
  beim Tippen vorgeschlagen; zu viele lehnt die Schnittstelle mit einer klaren Meldung ab, statt sie
  stillschweigend abzuschneiden.
- **Abhängigkeiten auf der Karte sichtbar**: ein Zeichen mit der Zahl verknüpfter Aufgaben, mit Namen
  und Richtung beim Darüberfahren. Bisher war nur die wartende Seite am Kennzeichen *Wartet* erkennbar.
- **Vorgängerin auswählen genügt**: Bisher musste danach zusätzlich ein Pluszeichen gedrückt werden. Wer
  das übersah, hatte die Abhängigkeit scheinbar eingetragen – gespeichert wurde sie nicht. Die Auswahl
  fügt die Aufgabe jetzt sofort hinzu, das Pluszeichen entfällt.

### Erscheinungsbild: 3D-Szenen und Bewegung

- **3D-Bühne „Wissensraum“** auf Anmeldung, Ersteinrichtung, Startseite und Fehlerseite: Seiten schweben in
  der Tiefe und sind – wie im Seitenbaum – durch Linien verbunden, über die Lichtpunkte laufen. Mit
  Tiefenschärfe, Dunst, weichen Lichtvolumen und einem Punktraster bis zum Horizont. Die Kamera fährt beim
  Erscheinen hinein, gleitet langsam, folgt leicht dem Mauszeiger und fährt beim Scrollen in die Szene.
  Reines CSS-3D – kein WebGL, keine Bibliothek, keine neue Abhängigkeit; die Farben folgen Akzentfarbe und
  Farbschema.
- **Anmeldung als Bühne**: links Name und Untertitel der Installation, rechts das Formular als Karte aus
  Glas; auf Tablet und Handy steht die Karte allein vor der Szene.
- **Startseite**: Kopf mit Datum, Begrüßung und Kennzahlen (Bereiche, Seiten, offene Aufgaben, neue
  Benachrichtigungen) – die Zahlen zählen hoch und führen per Klick zur passenden Übersicht. Schnellzugriffe
  auf dem Handy zwei- statt einspaltig.
- **Interaktion**: Kacheln neigen sich zum Mauszeiger, Karten bekommen einen Lichtkegel, Inhalte erscheinen
  beim Seitenwechsel und beim Scrollen mit kurzer Fahrt, die Kopfleiste hebt sich ab, sobald Inhalt
  darunter liegt, in der Seitenansicht zeigt eine Linie unter den Brotkrumen den Lesefortschritt.
- **Abschaltbar**: Benutzermenü → *Animationen und 3D-Effekte* bzw. Profil → *Bewegung und Effekte*; die Wahl
  gilt je Konto auf allen Geräten. Die Administration setzt unter *Einstellungen → Allgemein* die Vorgabe
  (`uiMotion`: „Voll“ oder „Reduziert“, z. B. für Terminalserver). „Bewegung reduzieren“ im Betriebssystem
  hat immer Vorrang. Reduziert heißt: nichts bewegt sich, nichts bleibt verborgen, die Szene steht als
  Standbild.
- **Sparsam**: Animiert werden nur `transform` und `opacity` (Arbeit der Grafikkarte). Die Szene ist
  Dekoration (`aria-hidden`, nicht anklickbar), hält außerhalb des Bildes und nach einer Minute ohne
  Eingabe an und lässt auf schwachen Geräten Details und Unschärfe weg. Gemessen im Testbrowser: kein Bild
  über 25 ms; der Hauptthread arbeitet im Leerlauf rund 4 % auf der Anmeldeseite und 2 bis 3 % auf der
  Startseite, bei reduzierter Bewegung und im angehaltenen Zustand praktisch gar nicht.
- Die **Fußzeile** aus den Einstellungen erscheint jetzt auf der Anmeldeseite.

### Dateien, Tempo und Barrierefreiheit

- **Video und Ton abspielen**: Dateikarten mit Video oder Ton bekommen den Knopf **Abspielen** und
  öffnen den Player des Browsers – mit Springen, Lautstärke und Vollbild.
- **Auslieferung in Bereichen** (`Range`, `206`, `Accept-Ranges`): Anhänge kommen auf Wunsch
  ausschnittweise. Erst dadurch lässt sich in Aufzeichnungen springen, Safari spielt sie überhaupt ab,
  und abgebrochene Downloads setzen fort statt neu zu beginnen. Ungültige Bereiche beantwortet der
  Server mit `416`, unverständliche Angaben mit der ganzen Datei.
- **Bilder laden verzögert** (`loading="lazy"`): Eine bebilderte Anleitung mit zwanzig Screenshots
  holt beim Öffnen nur noch, was sichtbar ist.
- **Vier neue Indizes** (Migration 022): Das Profil einer Person zählt Seiten, Bearbeitungen und
  Kommentare, die Inhaltsanalyse sucht ungelesene Seiten – all das las bisher ganze Tabellen.
  `page_revisions` wächst mit jedem Speichern und ist auf Dauer die größte Tabelle überhaupt.
- **„Meine Aufgaben“ ohne Einzelabfragen**: Abhängigkeiten und Pläne werden gebündelt geladen
  (vorher eine zusätzliche Abfrage je Treffer).
- **Barrierefreiheit**: Die Mehrfachauswahl im Plan meldet die Auswahl jetzt als vorgelesenen Hinweis
  statt über ein auf `<article>` unzulässiges `aria-selected`.

### Sicherheit

Gefunden mit einem „Kanarien“-Scan: eindeutige Geheimtexte in einer eingeschränkten Seite und in einem
privaten Bereich anlegen, dann als normales Mitglied alle 344 lesenden Aufrufe der API abfragen und
**jede Antwort** nach diesen Texten durchsuchen – auch ZIP-Exporte, den Live-Strom, das Kalender-Abo,
Benachrichtigungen und die Mail-Warteschlange. Inhalt, Titel, Suche, Seitenbaum, Feeds, Exporte und
Live-Strom waren dicht; drei Stellen verrieten eine eingeschränkte Seite trotzdem:

- **Stichwörter**: Die Stichwortlisten (gesamt, je Bereich, Autovervollständigung) zählten auch Seiten
  mit, die die Person nicht sehen darf – ein Stichwort wie „kündigung-müller“ stand damit für alle da.
- **Eigenschaftsnamen**: dasselbe in der Liste bekannter Eigenschaften.
- **Benachrichtigungen**: Wurde eine Seite nachträglich eingeschränkt oder das Recht im Bereich
  entzogen, blieben ältere Benachrichtigungen mit Titel, Kommentartext und Änderungsnotiz sichtbar –
  und wären auch noch in die tägliche Zusammenfassung per E-Mail gewandert. Doku zieht solche
  Benachrichtigungen jetzt zurück, sobald der Zugriff fehlt. Prüfaufträge zu Entwürfen und Hinweise auf
  gelöschte Seiten bleiben erhalten.

Im Normalfall (keine eingeschränkten Seiten) laufen die bisherigen schnellen Abfragen unverändert.

Ohne Befund geprüft: **gespeichertes XSS** (Schadcode in 19 Eingabefeldern, 41 Seiten im echten Browser –
nichts ausgeführt, keine Reste im DOM, die CSP musste nie eingreifen; HTML- und SVG-Anhänge werden nur als
Download mit Sandbox-Richtlinie ausgeliefert), **offene Weiterleitung** nach der Anmeldung (zehn
Umgehungsvarianten) und die Zuweisung von Aufgaben an Personen ohne Zugriff auf den Bereich.

- **Absturzsicherung**: Ein unbehandelter Fehler in einer Hintergrundaufgabe (Mailversand, Webhooks,
  Anhang-Indexierung) hätte den ganzen Server beendet. Er landet jetzt im Protokoll, das Wiki läuft weiter.
- Verbogene `?next=`-Werte auf der Anmeldeseite (Rückstrich, Tabulator, Zeilenumbruch) führten zwar
  nirgends hin, endeten aber in einem Fehlerbildschirm – jetzt auf der Startseite.

### Behoben

- **Export scheiterte mit „Export-Worker: ENOENT: process.cwd failed … uv_cwd“**: Nach einem Update ohne
  Neustart, bei dem der alte Programmordner gelöscht wurde, gab es das Arbeitsverzeichnis des laufenden
  Servers nicht mehr – Node.js konnte dann keinen Worker mehr starten. Betroffen waren neben dem Export nach
  PDF und Word auch die **Sicherung** (Abbild der Datenbank) und die **Textgewinnung aus Anhängen** für die
  Suche. Der Server wechselt jetzt vor jedem Start eines Workers in den Programmordner unter seinem Pfad und
  arbeitet damit weiter; fehlt der Ordner ganz, nennt die Meldung den Grund und den nötigen Neustart statt
  eines Systemfehlers. Anhänge, die in dieser Zeit als „nicht lesbar“ vermerkt wurden, liest der Server beim
  nächsten Start erneut ein.
- **Erwähnungen im Chat einer Aufgabe**: Das Vorschlagsmenü nach dem **@** lag im Aufgabendialog hinter
  dem Dialog und war nicht zu sehen – wer nicht blind weitertippte und Enter drückte, konnte niemanden
  erwähnen. Außerdem schloss **Esc** im Menü den ganzen Dialog samt getipptem Text. Beides behoben; das
  Menü liegt jetzt über Dialogen, Esc schließt nur das Menü.
- **Erwähnungen allgemein** (Chat, Seitenkommentare, Editor): Ohne Suchtext zeigte das Menü nur Personen
  mit einem „a“ im Namen. Klein getippte Umlaute fanden groß geschriebene Namen nicht („öz“ → „Özlem“).
  Prozent und Unterstrich im Suchtext wirkten als Platzhalter. Das Menü zeigt jetzt die Beteiligten der
  Aufgabe bzw. Seite zuerst, sortiert nach deutschem Alphabet und kennzeichnet Personen **ohne Zugriff**;
  wer trotzdem erwähnt wird, erscheint nach dem Senden in einem Hinweis („… hat hier keinen Zugriff und
  wurde nicht benachrichtigt“). Wer erst beim **Bearbeiten** erwähnt wird, bekommt jetzt die
  Benachrichtigung; ein Klick auf eine Erwähnung in Kommentaren und im Chat öffnet das Profil.
- **Installationsassistent für Windows**: Das „&“ in „Administration → KI & Dateien“ wurde verschluckt.
- **Reduzierte Bewegung**: Übergänge waren auf „fast null“ (0,01 ms) gestellt statt abgeschaltet – jede
  Stiländerung an jedem Element griff dadurch ein Bild später. Beim Laden im dunklen Design stand Text einen
  Augenblick in der hellen Schriftfarbe auf dunklem Grund (von der Barrierefreiheitsprüfung als Kontrast
  1,15 : 1 gemessen, in jedem vierten Lauf). Übergänge entfallen bei reduzierter Bewegung jetzt ganz.
- **Zähler an der Glocke**: Ein Klick genau auf die rote Zahl der Benachrichtigungen öffnete nichts – der
  Zähler lag über der Schaltfläche und fing den Klick ab. Gefunden von der Layout-Messung („verdeckt“).
- **Suche**: Das Eingabefeld drückte die Schaltfläche „Suchen“ schmaler als ihre Beschriftung.
- **Konfigurierte Verzeichnisse werden normalisiert** (`DATA_DIR`, `WEB_DIST_DIR`, `PLUGINS_DIR` …): Mit einem
  Schrägstrich am Ende oder „..“ in der `.env` – unter Windows auch mit Schrägstrichen statt Backslashes –
  beantwortete der Server Programmdateien, die erst nach dem Start im Web-Verzeichnis entstanden (neuer Build
  ohne Neustart), mit 404, obwohl sie vorhanden waren. Regressionstest `server/test/web-static.test.ts` prüft
  Auslieferung, Fehlerfall und dass kein Pfad aus dem Verzeichnis herausführt.
- **Oberfläche – überlappende und abgeschnittene Elemente** (gemessen über alle 71 Seiten in fünf
  Fensterbreiten):
  - Der Aufgabenplaner hatte keinen Seitenrand: „Neuer Plan“ klebte oben rechts an der Kopfzeile, die
    Spalten an der Seitenleiste, und bei 1280 px war der Knopf rechts angeschnitten.
  - Auf dem Handy lag der Bereichsname der Brotkrumen unter dem Knopf „Bearbeiten“ und das Tastenkürzel
    „Strg K“ über der Lupe in der Kopfzeile.
  - Die Reiter der Bereichseinstellungen und des Profils verschwanden ab 1024 px hinter dem rechten Rand
    („Export & Import“, „Benachrichtigungen“); sie brechen jetzt um.
  - Die Leiste einer alten Version ragte auf dem Handy über den Rand.
  - **Zeitstrahl:** Beim seitlichen Scrollen schoben sich die Balken über die feststehende
    Namensspalte und verdeckten die Aufgabennamen. Ursache war der Einbau der Abhängigkeitspfeile:
    Die Balken bekamen dieselbe Ebene wie die Namensspalte, und bei Gleichstand gewinnt das später
    gezeichnete Element. Die Ebenen des Zeitstrahls sind jetzt durchgängig festgelegt (Raster →
    Pfeile → Balken → gezogener Balken → Namensspalte → Skala → Ecke).

- **Aufgabenplaner – Abhängigkeiten:**
  - Die Pfeile auf der Zeitachse erschienen erst nach dem ersten Ziehen oder Zoomen, nicht beim Öffnen.
    Pfeile zu früher liegenden Aufgaben liefen durch den Balken dazwischen und wirkten wie eine falsche
    Verbindung – sie führen jetzt zwischen den Zeilen entlang.
  - Mit automatischer Planung ließ sich eine wartende Aufgabe vor ihre Vorgängerin legen (Zeitachse,
    Dialog) oder wieder öffnen, ohne dass der Konflikt aufgelöst wurde. Sie rückt jetzt dahinter, mit Hinweis.
  - Eine erledigte Vorgängerin mit noch zukünftigem Termin galt weiter als Konflikt und schob Nachfolgerinnen.
  - Wurde eine Änderung wegen einer ungültigen Vorgängerin abgelehnt (Kreis, anderer Plan), waren die
    übrigen Felder trotzdem gespeichert bzw. die neue Aufgabe angelegt. Änderungen gelten jetzt ganz oder gar nicht.
  - Ein negativer Versatz ließ sich nicht eintippen: Aus „-2“ wurde „+2“.
  - Aufgaben ohne Beginn und Fälligkeit haben auf der Zeitachse keinen Balken – die Abhängigkeit war
    dort deshalb unsichtbar und wirkte wie „nicht gespeichert“. Der Aufgabendialog weist jetzt darauf
    hin, und die Einträge unter *ohne Termin* tragen ein Zeichen für ihre Abhängigkeiten.
  - Termine wie der 30. Februar oder das Jahr 0099 werden abgewiesen statt gespeichert.
  - Ziehen einer Aufgabe nur mit Beginn setzte ungewollt eine Fälligkeit; „1 Terminkonflikte“ → „1 Terminkonflikt“.

- **Dienst ließ sich nicht geordnet beenden**, solange ein Browser mit Doku verbunden war: Beim Beenden
  wartete der Server auf das Ende der Live-Verbindungen (Benachrichtigungen, gemeinsames Bearbeiten), die
  nie von selbst enden – systemd meldete `State 'stop-sigterm' timed out. Killing`, die Aufgabenplanung
  unter Windows brach nach dem Zeitlimit ab. Doku trennt diese Verbindungen jetzt selbst, sichert offene
  Bearbeitungsstände und beendet sich notfalls nach 8 Sekunden mit einem Hinweis im Protokoll.

### Tests

- **Layout-Messung als Testlauf** (`npm run test:sweep`): öffnet alle Seiten in fünf Fensterbreiten und meldet
  Überlappungen, verdeckte Bedienelemente, Überstände, abgeschnittene Beschriftungen und seitliches
  Scrollen. Bisher ein Hilfsskript außerhalb des Projekts, jetzt Teil der Oberflächentests
  (`e2e/tests/sweep.spec.ts`, läuft wegen der Dauer nur auf Wunsch).
- `e2e/tests/motion.spec.ts` prüft die 3D-Szene (reine Dekoration, nur `transform`/`opacity`), den Stillstand
  bei reduzierter Bewegung, die Einstellung im Benutzermenü und das Einblenden beim Scrollen; die
  Barrierefreiheitsprüfung deckt die Seiten vor der Anmeldung jetzt auch im dunklen Design ab.
- `server/test/program.test.ts` stellt das Update ohne Neustart nach (Ordner ersetzt, über den Ordner
  entpackt, entfernt), prüft die Meldungen in `status`, `doctor` und Administration und – unter Linux und
  macOS – dass nach gelöschtem Arbeitsverzeichnis wieder Worker starten.
- `server/test/install-extras.test.ts` prüft die Installationsroutine im echten Ablauf ohne Root-Rechte:
  `install.sh` mit nachgestellter Paketverwaltung und nachgestelltem `systemctl`, den Windows-Assistenten in
  einem Prüfstand, der seine Funktionen unverändert aus der Datei holt und nur die Dienstbefehle nachstellt.

### Dokumentation

- **`docs/VERGLEICH.md` auf den Stand 1.6 gebracht** und erstmals auch auf Englisch
  (`docs/COMPARISON.md`). Das Dokument führte bis zuletzt Dinge als „Lücke“, die längst eingebaut sind
  (Single Sign-on, Confluence-Import, Texterkennung, Vorschlagsmodus, Lesebestätigungen). Neu sind ein
  Abschnitt mit **gemessenen Antwortzeiten** (10.000 Seiten, 12.000 Versionen, 2.000 Aufgaben) und ein
  Abschnitt **„Grenzen und Risiken“**, der offen benennt, was vor einem produktiven Einsatz geklärt sein
  sollte – Einzelserver ohne Ausfallsicherheit, kleiner Entwicklerkreis, fehlende Praxiserprobung,
  Browser-Abdeckung der Tests.

### Update-Hinweise

- **Nach dem Einspielen den Dienst neu starten** (`sudo systemctl restart doku` bzw.
  `Doku-Dienst.cmd restart`) – `start` genügt nicht, wenn der Dienst noch läuft. Den alten Programmordner
  erst danach löschen. `npm run cli -- status` zeigt, ob der laufende Server schon mit dem neuen Stand
  arbeitet.
- Migrationen 020 bis 023 (Fortschritt aus der Checkliste, Papierkorb für Aufgaben, zusätzliche Indizes, Chat je Aufgabe). Vor der Migration legt der Server wie gewohnt eine Sicherung an.
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (Kapitel Administration und Aufgabenplaner ergänzt).
- Pläne, in denen trotz automatischer Planung schon Terminkonflikte stehen (entstanden durch den behobenen
  Fehler), bereinigt ein Aus- und wieder Einschalten von *Abhängige Aufgaben automatisch verschieben*.

## [1.6.0] – 2026-09-15

Installation ohne Kommandozeile: ein grafischer Assistent für Windows, ein geführtes Skript für Linux,
fertig gebaute Installationspakete und eine Liste der nächsten Schritte nach der Ersteinrichtung.

### Installation

- **Installationsassistent für Windows** (`Doku-Installation.cmd`): grafischer Assistent mit
  Datenverzeichnis, Port, Erreichbarkeit (Reverse-Proxy auf demselben oder einem anderen Server, direkt
  im Netz), Autostart als geplante Aufgabe unter *Lokaler Dienst* oder als Windows-Dienst mit NSSM,
  Firewall-Regel, Ausnahme im Microsoft Defender sowie Tesseract und LibreOffice (automatisch gesucht).
  Er zeigt vor dem Start eine Zusammenfassung, installiert Node.js auf Wunsch per `winget`, vergibt die
  Rechte am Datenverzeichnis, startet Doku, prüft das Ergebnis und öffnet die Ersteinrichtung.
- **Ohne Rückfragen** für Updates und Verteilung: `Doku-Installation.cmd -Unattended` übernimmt die
  bisherigen Werte aus `.env`; `-WhatIf` zeigt nur, was geschehen würde; `-Uninstall` entfernt Autostart,
  Firewall-Regel und Ausnahme, lässt Daten und Programm aber stehen. Jede Installation hinterlässt ein
  Protokoll `installation-*.log`.
- **Installationsassistent für Linux** (`sudo bash install.sh`): Dialoge mit `whiptail` oder einfache
  Rückfragen, Systemkonto `doku`, systemd-Dienst mit Schutzoptionen, Firewall (ufw/firewalld), Probelauf
  mit `--dry-run`, ebenfalls ohne Rückfragen und mit `--uninstall`.
- **Proxmox VE / LXC-Container**: `install.sh` bietet an, Node.js 24 aus der Paketquelle von NodeSource
  zu installieren (`--install-node`), und prüft vor dem Einrichten des Dienstes, ob dessen Schutzoptionen
  verfügbar sind – in Containern ohne *Nesting* scheiterte der Start sonst mit `226/NAMESPACE`; dann
  läuft der Dienst ohne sie, mit Hinweis. Eigener Abschnitt in der Installationsanleitung.
- **Doku-Dienst.cmd** `start|stop|restart|status|log` steuert den Autostart unter Windows.
- **Gemeinsamer Installationskern** `scripts/install.mjs`: ergänzt `.env`, ohne unbekannte Einträge oder
  den Serverschlüssel anzutasten (vorher Sicherungskopie, Dateirechte nur für den Besitzer), legt
  Verzeichnisse an, installiert und baut bei Bedarf, macht einen Probestart und prüft die Installation.
- **Installationspakete** in den GitHub-Releases für Windows und Linux: Oberfläche vorgebaut,
  Laufzeitabhängigkeiten installiert, mit SHA-256-Prüfsumme – auf dem Server genügt Node.js 24.
  Gebaut mit `node scripts/package.mjs`, veröffentlicht vom neuen Workflow `release.yml` beim Tag `v*`.
  `--target linux-x64` baut ein Paket für ein anderes System, z. B. unter Windows für einen Linux-Server;
  der Paketbau prüft, dass die nativen Module zum Zielsystem passen.
- **Rechte im Paket**: tar.gz-Pakete haben unabhängig vom Build-Rechner Besitzer root und Rechte 644/755
  (GNU tar übernimmt beim Entpacken als root sonst Benutzerkennung und Rechte aus dem Archiv).
  `install.sh` entfernt Schreibrechte für Gruppe und andere im Programmordner – ein mit dem `tar` von
  Windows gepacktes Archiv brächte 666/777 mit.

### Betrieb

- **Administration → Nächste Schritte**: Adresse mit HTTPS, Autostart, E-Mail-Versand, Sicherung
  (mit „Jetzt sichern“), Personen einladen, ersten Bereich anlegen sowie optional Anmeldung mit
  Firmenkonto und Zusatzprogramme – jeweils mit Sprung zur Einstellung. Hinweis in der Übersicht, bis alle
  Pflichtpunkte erledigt sind (ausblendbar); Link am Ende der Ersteinrichtung.
- **`npm run cli -- doctor`** prüft die Installation (Node.js, Oberfläche, Datenverzeichnis und Ablageort,
  Speicherplatz, Adresse, Proxy, Port, Serverschlüssel, Datenbank, Ersteinrichtung, Sicherungen,
  Protokoll) und nennt die Abhilfe; `--json` für Überwachungen, Rückgabewert 1 bei Fehlern.
- **`npm run cli -- stop`** beendet einen laufenden Server geordnet – auch ohne Konsole, etwa als
  geplante Aufgabe (Datei `doku.stop` im Datenverzeichnis).
- **`LOG_FILE`**: Protokoll zusätzlich in eine Datei mit Rotation (10 MB, fünf ältere Stände).
- Systeminformationen der Übersicht zeigen Betriebsart und Protokolldatei.

### Behoben

- **Beschädigte ZIP-Archive**: Bereichsexporte (Doku-Archiv, Markdown, HTML) und heruntergeladene
  Sicherungen konnten bei bestimmten Dateien fehlerhafte Daten enthalten, die sich nicht entpacken
  ließen – ausgelöst durch einen Fehler im Streaming-Packer der Bibliothek `fflate`. Doku packt jetzt mit
  der zlib von Node.js; ein Test mit den betroffenen Dateien sichert das ab. Die Sicherungen selbst liegen
  als Ordner im Datenverzeichnis und waren nicht betroffen, ebenso `restore`. Früher heruntergeladene
  Sicherungs-ZIPs und Exporte nach dem Update erneut herunterladen, wenn sie aufbewahrt werden sollen.

### Dokumentation

- Installationsanleitung mit Abschnitt zu den Assistenten, Updates mit dem Assistenten, Offline-Installation
  und Fehlersuche mit `doctor`; Administrationshandbuch, Handbuch (Deutsch und Englisch), README,
  API-Dokumentation und `docs/GITHUB.md` (Release-Workflow) ergänzt.
- CI prüft die Installationsassistenten auf Windows (Syntax, alle Seiten im Selbsttest, Probelauf) und
  Linux (`shellcheck`, Probelauf).

### Update-Hinweise

- Update mit dem Assistenten: Doku beenden, neues Paket über den Programmordner entpacken, dann
  `Doku-Installation.cmd -Unattended` bzw. `sudo bash install.sh --unattended`. Bestehende von Hand
  eingerichtete Dienste funktionieren unverändert weiter.

## [1.5.0] – 2026-09-14

Anmeldung mit Microsoft Entra ID, SAML und dem Windows-Konto, Lesebestätigungen, mehrstufige Freigaben
mit Vertretungen, Vorschlagsmodus, Inhaltsanalyse, Abhängigkeiten im Aufgabenplaner, Confluence-Import,
Texterkennung für Scans – und Doku vollständig auf Englisch.

### Single Sign-on

- **Microsoft Entra ID / OpenID Connect**: Autorisierungscode mit PKCE, `state` und `nonce`,
  mandantengebunden (kein „common“), Kennung über die Objekt-ID, Gruppen- und Rollen-Claims,
  Gruppenüberlauf über Microsoft Graph. Andere Anbieter (Keycloak, Okta, ADFS) über die Aussteller-URL.
- **SAML 2.0**: signierte Assertions, Prüfung von Aussteller, Zielgruppe, Gültigkeit und `InResponseTo`,
  Wiederholungsschutz, Metadaten unter `/api/v1/auth/saml/metadata`, mehrere Zertifikate für den Wechsel.
- **Windows-Anmeldung (Kerberos)** über den Reverse-Proxy: Kopfzeile nur von eingetragenen Adressen und
  mit gemeinsamem Geheimnis, Profil und Gruppen aus dem Active Directory, optional automatische Anmeldung.
- **Gruppen wie beim AD**: Entra-Objekt-IDs, SAML-Gruppenwerte und AD-Namen stehen im selben Feld der
  Doku-Gruppe; Mitgliedschaften werden bei jeder Anmeldung gesetzt und entzogen. Pflichtgruppe je Anbieter.
- **Konten verknüpfen** unter *Profil → Anmeldung*; Administratorkonten werden nie automatisch
  verknüpft, die letzte Anmeldemöglichkeit lässt sich nicht trennen. Verknüpfungen auch in der
  Benutzerverwaltung.
- **Administration → Single Sign-on** mit Adressen zum Kopieren, Prüfung der Einstellungen und Anzeige,
  ob eine Anfrage vom vertrauenswürdigen Proxy kommt. Anmeldeformular für lokale Konten ausblendbar.
- Anmeldeseite mit SSO-Knöpfen und verständlichen Fehlerhinweisen (nie Text aus der Adresse).

### Lesebestätigungen

- Pflichtdokumente „gelesen und verstanden“ bestätigen lassen: Zielgruppe (Gruppen, Personen oder alle
  mit Leserecht), eigener Bestätigungstext, Frist, Wiederholung (z. B. jährlich), erneute Bestätigung bei
  neuen Versionen.
- Erinnerungen bei Anforderung, drei Tage vor der Frist und bei Überschreitung – über Glocke und E-Mail;
  „Offene jetzt erinnern“ auf Knopfdruck.
- Nachweisliste mit Zeitpunkt, Version und Text, Export als CSV; Übersicht *Lesebestätigungen* mit
  eigenen offenen Dokumenten und dem Fortschritt aller Anforderungen.

### Mehrstufige Freigaben und Vertretungen

- Freigabeabläufe je Bereich (*Bereichseinstellungen → Freigaben*), z. B. Fachbereich → Qualitäts-
  management → Veröffentlichung: Freigebende je Stufe, Mindestanzahl, Eskalation nach Tagen,
  „jede Stufe durch eine andere Person“.
- Fortschrittsanzeige an der Seite; eine neue Version beginnt wieder bei der ersten Stufe.
- **Abwesenheitsvertretungen** (*Profil → Vertretung*, auch durch die Benutzerverwaltung): Vertretungen
  entscheiden in Vertretung – nachvollziehbar protokolliert.

### Vorschlagsmodus

- Änderungen vorschlagen statt direkt ändern: eingefügter Text grün, gelöschter rot, mit Name und Zeit;
  Annehmen, Ablehnen, Alle annehmen/ablehnen, eigene Vorschläge zurückziehen.
- Modus je Seite durch Autorin/Autor, verantwortliche Person oder Bereichsverwaltung einstellbar, von der
  Bereichsverwaltung festschreibbar; Vorgabe für neue Seiten je Bereich.
- Funktioniert in der Echtzeit-Bearbeitung; der Server lässt Personen ohne Entscheidungsrecht nur
  Vorschläge speichern. Ansicht für Lesende, Suche und Exporte zeigen den Text ohne offene Vorschläge.

### Inhaltsanalyse

- Arbeitsliste für die Redaktion: meistgelesene und ungelesene Seiten, Suchbegriffe ohne Treffer
  (mit „Seite anlegen“), verwaiste Seiten, defekte Verweise – je Bereich und Zeitraum, als CSV.
- Neues Recht **Inhaltsanalyse einsehen**; die Bereichsverwaltung sieht ihre Bereiche.
- Ohne Personenbezug gespeichert, automatische Löschung nach 400 bzw. 180 Tagen.

### Aufgabenplaner

- **Abhängigkeiten** wie in Microsoft Planner Premium: Ende → Anfang, Anfang → Anfang, Ende → Ende,
  Anfang → Ende mit Versatz in Tagen, bis 20 Vorgängerinnen, Kreise werden abgelehnt.
- Automatisches Verschieben abhängiger Aufgaben (je Plan abschaltbar), Kennzeichen „Wartet“ auf Karten,
  Pfeile und Terminkonflikte auf der Zeitachse.

### Import und Dateien

- **Confluence-Import** (Bereichsexport als XML oder HTML): Seitenbaum, Speicherformat mit Makros
  (Info/Tipp/Hinweis/Warnung, Code, Aufgabenlisten, Aufklappen, Inhaltsverzeichnis), Seiten- und
  Anhangverweise, Stichwörter, Anhänge, frühere Versionen.
- **Texterkennung (OCR)** mit Tesseract für eingescannte PDFs und Bilder in der Anhangsuche –
  optional, mit Statusanzeige, Sprachwahl und nachträglicher Verarbeitung vorhandener Anhänge;
  Docker-Build-Argument `WITH_OCR=true`.

### Englisch

- Oberfläche vollständig übersetzt, einschließlich aller Administrationsseiten.
- Server liefert Fehlermeldungen, Kataloge (Rechte, Rollen, Ereignisse), Benachrichtigungen, Aktivität,
  Prüfschritte und CSV-Kopfzeilen in der Sprache der Anfrage (`X-Doku-Locale`, Profil, Standardsprache).
- E-Mails in der Sprache der empfangenden Person; PDF- und Word-Beschriftungen in der Sprache der
  exportierenden Person.
- Englische Installationen erhalten Handbuch (`docs/handbook`), Vorlagen, Beispielinhalte, Startseiten
  neuer Bereiche und Journal auf Englisch; englische Platzhalter für Vorlagen (`{{date}}`, `{{me}}` …).
- Ein Test stellt sicher, dass jede Fehlermeldung des Servers übersetzt ist.
- Beim ersten Aufruf ohne gespeicherte Sprachwahl fragt die Oberfläche Serverdaten ohne feste Sprache
  an (vorher kamen die ersten Antworten einer englischen Installation auf Deutsch); nach einem
  Sprachwechsel werden Aktivität, Kataloge und Meldungen neu geladen.
- Englische Einrichtung: Systemgruppen heißen „Administrators“ und „Users“, neue Aufgabenpläne haben
  englische Spalten; automatische Änderungsnotizen („Seite erstellt“, „Importiert aus …“) und das
  Markdown-Änderungsprotokoll erscheinen in der Sprache der Person.
- Exporte: Beschriftungen in Markdown und HTML (Inhalt, Unterseiten, Kopfdaten), Überschriften der
  Hinweiskästen in PDF und Word sowie die unveränderte Standard-Fußzeile der Firmenvorlage übersetzt.
- Tastenkürzel-Dialog, „Strg“/„Ctrl“, Beispiel-Platzhalter und einige Fehlermeldungen der Oberfläche
  übersetzt; `npm run lint` meldet künftig feste deutsche Texte in Komponenten.
- Plugins: Übersetzungen für Name, Beschreibung und Einstellungen im Manifest (`translations`), aktuelle
  Sprache im Browser über `api.locale`; die mitgelieferten Plugins sind zweisprachig.

### Dokumentation und Projekt

- Handbuch um die Kapitel *Lesebestätigungen* und *Inhaltsanalyse* sowie SSO, Freigaben, Vorschläge,
  Abhängigkeiten, Confluence und OCR ergänzt – auf Deutsch und Englisch.
- Administrationshandbuch mit Schritt-für-Schritt-Anleitungen für Entra ID und SAML sowie Beispielen für
  Apache (`mod_auth_gssapi`) und IIS; API-Dokumentation für alle neuen Schnittstellen.
- Neu: `docs/NUTZUNG.md`, `README.en.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `LICENSE`, GitHub-Actions-Workflow (Lint, Typen, Tests, Build, Oberflächentests), Dependabot sowie
  Vorlagen für Issues und Pull Requests.

### Barrierefreiheit

- Die Systemeinstellung „Bewegung reduzieren“ gilt jetzt für alle Animationen, auch für eingeblendete
  Hinweise, Menüs und Ladeanzeigen mit fester Dauer.

### Sicherheit

- SAML: Aussteller der Antwort wird geprüft (die Bibliothek tut das nur bei Abmeldungen).
- Verzeichnisanmeldung: mehrdeutige Suchtreffer werden abgelehnt statt den ersten zu verwenden.
- Passwort zurücksetzen ist für alle extern angemeldeten Konten gesperrt (bisher nur Verzeichniskonten).
- Übersetzungsmuster mit Längengrenze; Freitext wie Kommentarauszüge wird nur über eindeutige Muster
  übersetzt.
- Papierkorb: *Wiederherstellen* und *endgültig löschen* prüfen die Rechte vor jeder Antwort – bisher
  lieferte das Wiederherstellen einer nicht gelöschten Seite ohne Prüfung deren Adresse samt Titel,
  auch für eingeschränkte Seiten und ohne Anmeldung.
- Vorlagen sind nur noch für angemeldete Personen abrufbar; Anbieter und Modell der KI sieht nur, wer
  angemeldet ist.
- Import: Pfade im ZIP mit `..`, absolutem Pfad oder Laufwerk werden bereinigt (vorher Serverfehler bzw.
  Seiten namens „..“); Textdateien über 5 MB werden abgewiesen, bevor sie entpackt werden
  (Schutz vor ZIP-Bomben, vorher Serverfehler und hoher Speicherbedarf).

### Behoben

- Vertretung für ein nicht vorhandenes Konto eintragen: „nicht gefunden“ statt Serverfehler.
- Markdown-Export eines Bereichs lässt sich wieder importieren, ohne dass Anhänge als Seiten entstehen.
- Doku-Archiv als neuer Bereich: Die Startseite des Archivs wird übernommen (vorher zwei „Übersicht“-Seiten).
- Die automatische Sicherung vor einer Wiederherstellung zeigt ihren Schemastand in `backup:list`.

### Update-Hinweise

- Migrationen 013–019 (Abhängigkeiten, Inhaltsanalyse, Lesebestätigungen, Texterkennung,
  Freigabeabläufe, Vorschlagsmodus, Single Sign-on). Vor der Migration legt der Server wie gewohnt eine
  Sicherung an.
- Neue Abhängigkeiten `openid-client` und `@node-saml/node-saml` – `start.cmd`/`scripts/prepare.mjs`
  installieren sie automatisch.
- Nach dem Update **Wartung → Handbuch aktualisieren** ausführen (neue Kapitel).

## [1.4.0] – 2026-09-14

Flächendeckende Oberflächentests, Barrierefreiheit nach WCAG 2.1 AA, ein deutlich schnellerer erster
Aufruf, aufgeräumter Code, eine zweite Sicherheitsprüfung und eine Installationsanleitung.

### Oberflächentests

- **235 automatische Browsertests** (Playwright, `npm run test:e2e`) gegen eine frisch eingerichtete
  Testinstanz mit Administrator, Bearbeiterin und Leserin:
  - **Rundgang über alle 66 Seiten** – Administration, Bereichseinstellungen, Profil, öffentliche
    Seiten, 404 – ohne JavaScript-, Konsolen- oder Serverfehler, mit Bildschirmfoto je Seite.
  - **Barrierefreiheit** (axe-core, WCAG 2.1 A/AA) für jede Seite im hellen und dunklen Design sowie für
    Dialoge, Editor, Slash-Menü und Kommentare.
  - **Arbeitsabläufe**: Anmelden/Abmelden, Seiten anlegen, bearbeiten, vergleichen, wiederherstellen,
    Papierkorb, Editor (Slash-Befehle, Markdown-Kürzel), gemeinsames Bearbeiten mit zwei Browsern,
    Kommentare, Prüfung und Freigabe, Anhänge, PDF-/Markdown-Export, Suche, Befehlspalette,
    Tastenkürzel, Aufgabenplaner, Profil, Administration (Benutzer, Gruppen, Einstellungen, Sicherung,
    Webhooks, Audit-Log), Leserechte und die Handy-Ansicht ohne Überlauf.
- Die Tests laufen in einem eigenen Ordner (`e2e/`) und verändern keine vorhandenen Daten.

### Barrierefreiheit

- **Kontraste** nach WCAG AA (mindestens 4,5 : 1) für gedämpfte Texte, Akzent- und Statusfarben,
  Gefahr-Schaltflächen und Avatare (Schriftfarbe richtet sich nach der Hintergrundfarbe) – im hellen
  und im dunklen Design.
- **Namen für alle Bedienelemente**: Symbol-Schaltflächen, Schalter, Auswahllisten, Suchfeld,
  Fortschrittsanzeige, Befehlspalette, Seitenbaum, Brotkrumen, Dialoge (über ihre Überschrift).
- **Editor und Seitenansicht** sind für Screenreader als Eingabefeld bzw. benannter Inhaltsbereich
  ausgezeichnet; jede Seite hat eine Hauptüberschrift.

### Leistung

- **Rund zwei Drittel weniger JavaScript beim ersten Aufruf** (komprimiert etwa 490 KB → 170 KB): Alle
  Ansichten – auch die Seitenansicht – werden erst bei Bedarf geladen; die Seitenansicht lädt der
  Browser im Leerlauf vor, damit der erste Klick nicht wartet.

### Stabilität

- **Verständliche Fehlerseite** statt „Unexpected Application Error“, wenn eine Ansicht abstürzt – mit
  „Neu laden“ und dem Weg zur Startseite; die Navigation bleibt erhalten.
- **Nach einem Update** lädt der Browser einmalig neu, wenn ältere Programmteile nicht mehr existieren,
  statt einen Fehler zu zeigen.
- **Startanzeige**: Laden Programmdateien nicht (Proxy, Filter, veralteter Browser), erscheint nach
  einigen Sekunden ein Hinweis mit „Neu laden“ statt einer leeren Seite; ohne JavaScript ein
  entsprechender Hinweis.
- Fehlende Programmdateien (`/assets/…`) antworten mit 404 statt mit der Startseite; `HEAD`-Anfragen auf
  Seiten der Oberfläche (Verfügbarkeitsprüfungen) mit 200 statt 404.
- **Docker: Zeitzone** `Europe/Berlin` als Vorgabe (`TZ`). Container laufen sonst in UTC – die nächtliche
  Sicherung („3 Uhr“), die tägliche Zusammenfassung und Uhrzeiten in Exporten lagen dann ein bis zwei
  Stunden daneben.

### Behoben

- **Prüfung und Freigabe**: Die ausdrücklich benannte prüfende Person konnte ohne Moderationsrecht
  nicht freigeben oder ablehnen. Jetzt darf sie das – außer sie hat die Prüfung selbst angefordert
  (Vier-Augen-Prinzip).
- **Suche**: Seiten mit Codeblöcken enthielten im Suchindex und in der Kurzfassung HTML-Markup
  (`<code class=…>`). Bestehende Seiten werden beim ersten Start einmalig neu berechnet.
- **Kommentare**: Nach dem Absenden einer Antwort trat ein Fehler auf (Editor bereits geschlossen).
- Die Schaltfläche zum Schließen von Meldungen war nur auf Deutsch beschriftet.

### Sicherheit

- **Gemeinsames Bearbeiten**: Ein gemeinsames Dokument darf höchstens 32 MB groß werden – sonst ließe
  sich der Arbeitsspeicher des Servers mit großen Nachrichten erschöpfen. Die Verbindung wird dann mit
  einer verständlichen Meldung getrennt.
- **API-Referenz** (`/api/docs`) nur noch nach Anmeldung (oder bei aktiviertem anonymem Lesezugriff).
- **Sitzungs-Cookie** wird hinter einem HTTPS-Proxy auch ohne `TRUST_PROXY` als `Secure` markiert.
- **Zusätzliche Header**: `Permissions-Policy` (keine Kamera, kein Mikrofon, kein Standort …) und
  `Cross-Origin-Opener-Policy: same-origin`.
- **Kalender-Abo**: Einzelne Wagenrücklauf-Zeichen in Aufgabentiteln werden maskiert – eigene
  Kalenderzeilen lassen sich nicht mehr einschleusen.
- **Benutzerverwaltung**: Passwort setzen, Rücksetz-Link und Einladung für Administratorkonten prüfen
  einheitlich das Administratorrecht (403 statt 400); Passwörter höchstens 200 Zeichen.

### Code und Struktur

- **Seitendienst aufgeteilt**: Entwürfe (`pages/drafts.ts`), Papierkorb (`pages/trash.ts`) und
  Seitenverweise (`pages/links.ts`) sind eigene Dienste; Kommentar- und Anhang-Routen liegen in ihren
  Modulen. `pages/service.ts` schrumpft von 1.240 auf 925 Zeilen, `pages/routes.ts` von 733 auf 622.
- **Editor aufgeteilt**: Vorschläge (Slash-Menü, `[[Seitenlinks]]`) in `editor/suggestions.tsx`,
  Einbettungen in `views/EmbedViews.tsx` – `extensions.tsx` von 752 auf 392 Zeilen.
- **ESLint** (TypeScript, React Hooks) und eine **Prüfung der Übersetzungen** (jeder verwendete
  Schlüssel auf Deutsch und Englisch vorhanden): `npm run lint`. Alle Befunde sind behoben.

### Hinweise zum Update

- Keine Datenbankmigration. Beim ersten Start berechnet der Server Suchtexte und Kurzfassungen aller
  Seiten einmalig neu (bei vielen Seiten einige Sekunden).
- `/api/docs` verlangt eine Anmeldung; Skripte nutzen `/api/docs/json` mit API-Token.
- Ein gemeinsames Dokument über 32 MB (z. B. viele eingebettete Bilder) lässt sich nicht mehr gemeinsam
  bearbeiten – Bilder als Anhang hochladen oder die Seite aufteilen.
- **Docker**: Sicherung und tägliche Zusammenfassung laufen jetzt zur eingestellten Uhrzeit in deutscher
  Zeit statt in UTC. Andere Zeitzone: `TZ` in der `.env` setzen.
- **Installationsanleitung**: [docs/INSTALLATION.md](docs/INSTALLATION.md).

## [1.3.0] – 2026-09-14

Updates ohne Datenverlust und eine vollständige Sicherheits- und Codeprüfung.

### Sicher aktualisieren

- **Sicherung vor jedem Update**: Stehen Datenbankänderungen an, legt der Server vorher automatisch eine
  vollständige Kopie der Datenbank an (`backup-…-update`, die letzten fünf bleiben). Scheitert die
  Sicherung, wird nichts verändert.
- **Alles oder nichts**: Alle Migrationen eines Updates laufen in einer Transaktion – bei einem Fehler
  bleibt die Datenbank vollständig auf dem alten Stand. Fremdschlüssel sind dabei ausgeschaltet und
  werden vor dem Abschluss geprüft: Künftige Tabellenumbauten können abhängige Daten (Versionen,
  Kommentare, Anhänge) nicht mehr über `ON DELETE CASCADE` mitlöschen.
- **Schutz vor Rückstufung**: Eine ältere Programmversion startet nicht auf einer Datenbank, die schon
  von einer neueren Version benutzt wurde.
- **Nur ein Server je Datenbank**: Läuft der alte Dienst noch, bricht die neue Version vor jeder
  Änderung ab (Dateisperre, die das Betriebssystem auch nach Abstürzen freigibt).
- **Schlüsselprüfung**: Passt `DOKU_SECRET` bzw. `secret.key` nicht zur Datenbank, startet der Server
  nicht – geprüft vor Sicherung und Migrationen –, statt gespeicherte Zugangsdaten unbemerkt unbrauchbar
  zu machen; beschädigte Schlüsseldateien werden erkannt.
- **Startskripte** (`start.cmd`, `start.sh`, neu `node scripts/prepare.mjs`) erkennen geänderte
  Abhängigkeiten und Quelltexte und holen Installation und Build nach einem Update automatisch nach.
- **Kommandozeile**: `status` (Version, Datenbankstand, ausstehende Migrationen, laufender Server),
  `backup:list` und `restore <sicherung> [--with-uploads]` – prüft die Sicherung (Integrität, Doku-Schema,
  nicht neuer als das Programm), sichert den aktuellen Stand – auch eine beschädigte Datenbank als
  Dateikopie – und entfernt WAL-Reste, bevor die Datenbank ersetzt wird; `handbook:sync` ergänzt das
  Handbuch nach einem Update ohne Oberfläche.
- **Klare Meldung statt Stacktrace**, wenn der Update-Schutz den Start verhindert (laufender Server,
  neuere Datenbank, anderer Schlüssel).
- Audit-Log und Protokoll vermerken „Doku aktualisiert: alte → neue Version“.
- Gelöschte **Standardvorlagen** bleiben gelöscht (wurden bisher bei jedem Start neu angelegt).

### Datensicherheit

- **Dateien endgültig gelöschter Anhänge** (Papierkorb geleert, Bereich gelöscht) bleiben 30 Tage auf
  dem Datenträger, damit zurückgespielte Sicherungen sie noch finden.
- **Sicherung vor dem Löschen eines Bereichs** (`backup-…-loeschung`, die letzten zehn bleiben).
- **Sicherungen laufen im Hintergrund** (Worker-Thread) und halten den Server nicht mehr an.
- **Gelöschte Anhänge** verfallen mit der Papierkorb-Frist (Standard 30 Tage) – bisher blieben sie
  unbegrenzt gespeichert, auch wenn sie aus Datenschutzgründen entfernt wurden.

### Sicherheit

- **Selbstregistrierung mit E-Mail-Bestätigung**: Eine Beschränkung auf E-Mail-Domains ließ sich mit
  einer fremden Firmenadresse umgehen – wer `chef@firma.de` angab, erhielt sofort Zugang. Ist der
  E-Mail-Versand eingerichtet, melden sich neue Konten erst nach dem Klick auf den Bestätigungslink an;
  eine Domain-Beschränkung setzt den E-Mail-Versand voraus. Unbestätigte Konten werden nach sieben
  Tagen gelöscht, die Administration kann sie vorher freischalten.
- **E-Mail-Adresse ändern nur mit aktuellem Passwort**: Sonst genügte eine fremde, offene Sitzung, um
  die Adresse umzustellen und das Konto über „Passwort vergessen“ dauerhaft zu übernehmen.
- **Ersteinrichtung über das Netzwerk nur mit Einrichtungscode** aus dem Serverprotokoll – wer einen
  frisch gestarteten Server zuerst erreichte, konnte sich zum Administrator machen. Vom Server selbst
  aus (localhost) bleibt die Einrichtung ohne Code möglich.
- **Kommentare**: Nach Entzug des Kommentarrechts (oder in archivierten Bereichen) lassen sich eigene
  Kommentare nicht mehr ändern oder als erledigt markieren; löschen bleibt möglich.
- **Benutzerverwaltung ohne Administratorrecht** konnte Administratorkonten deaktivieren, löschen und
  deren E-Mail-Adresse ändern (und so über „Passwort vergessen“ übernehmen) – jetzt Administratoren
  vorbehalten, ebenso Tokens für Administrator-Dienstkonten.
- **API-Konnektoren**: Leser erhalten nur noch Daten, die in der Seite als Makro hinterlegt sind;
  bisher konnte jede angemeldete Person beliebige Pfade eines Konnektors mit dessen Zugangsdaten
  abfragen. Frei abfragen dürfen Bearbeitende der Seite und die Integrationsverwaltung.
- **Echtzeit-Bearbeitung**: API-Tokens nur mit Umfang `write`; widerrufene Tokens trennen die Verbindung.
- **Live-Kanal (SSE)**: Rechte, Sitzung und Konto werden alle 25 Sekunden neu geprüft – abgemeldete oder
  gesperrte Konten erhalten keine Ereignisse mehr; höchstens 20 Verbindungen je Person.
- **Entwürfe** lassen sich nach Entzug der Bereichsrechte (oder in archivierten Bereichen) nicht mehr
  veröffentlichen.
- **Papierkorb**: Inhalte gelöschter Seiten und gelöschte Anhänge nur noch für Personen mit Lösch- bzw.
  Anhangsrecht; Titel endgültig gelöschter Seiten erscheinen im Aktivitätsfeed nur für diese.
- **Passwörter**: scrypt mit doppelten Kosten (N = 2^15), Prüfung ohne Blockieren des Servers, ältere
  Hashes werden beim Anmelden automatisch erneuert; gleiche Antwortzeit für unbekannte Konten.
- **Passwort zurücksetzen**: nicht mehr für Verzeichniskonten (ein lokales Passwort bliebe sonst nach dem
  Löschen im AD gültig); alle offenen Links verfallen mit dem ersten benutzten.
- **Active Directory**: kein stilles Übernehmen bei wiederverwendetem Anmeldenamen (andere objectGUID),
  lokale Administratorkonten werden nie mit dem Verzeichnis verknüpft, übernommene Konten verlieren ihr
  lokales Passwort; E-Mail-Konflikte führen nicht mehr zu Anmeldefehlern.
- **Leere Felder** (`null`) wurden als `0` bzw. leere Zeichenkette übernommen – Webhook-Bereichsfilter,
  Startseite zurücksetzen, erneute Prüfanforderung und „Vorgabe des Bereichs“ bei der Wiedervorlage
  schlugen fehl.
- **`TRUST_PROXY`** nimmt auch die Adressen der Proxys an (`127.0.0.1`, `10.0.0.0/8`, `uniquelocal`):
  Dann lässt sich die Client-Adresse nicht mehr per `X-Forwarded-For` fälschen, wenn der Port auch
  direkt erreichbar ist (Ratenbegrenzung der Anmeldung, Audit-Log). Docker nutzt standardmäßig
  `uniquelocal,loopback` statt `true`.
- **Office-Vorschau**: nur LibreOffice als Konverter, höchstens zwei Umwandlungen gleichzeitig, Profil
  mit abgeschalteten Makros und blockierten externen Verweisen.
- **Weitere Härtungen**: HTML-Export läuft auch inline in einer Sandbox; Einbettungs-Hosts und
  Zahlenwerte der Einstellungen werden geprüft; Audit-CSV gegen Formel-Injektion geschützt;
  Webhook-Antworten nur begrenzt gelesen; Worker-Threads mit Speichergrenze; Dateinamen ohne Punkte am
  Ende; Doku-Archive übernehmen fremde Autorenschaft nur bei Administratoren; ungültige Adressen liefern
  404 statt 500.

### Behoben

- **YouTube-Einbettungen**: Links wurden nicht in Einbett-Adressen umgewandelt (Platzhalter zeigte eine
  falsche Adresse).
- **Seite kopieren** mit Unterseiten in den eigenen Teilbaum erzeugte immer weitere Kopien; Kopieren in
  einen anderen Bereich ohne Zielseite schlug fehl.
- **Verschieben in einen anderen Bereich** berechnete die Wiedervorlage aller Seiten des Zielbereichs neu.
- Anhang-Suchindex wurde beim endgültigen Löschen nicht bereinigt.
- Aufgabenplaner stürzte ab, wenn der Browser den lokalen Speicher sperrt.
- Kommandozeile `settings:set` überschrieb Objekt-Einstellungen vollständig und speicherte Passwörter
  unverschlüsselt.
- Plugin-Routen mit ungültig kodierter Adresse antworteten mit 500 statt 400.
- Eine beschädigte Datenbankdatei blieb nach dem Fehlschlag geöffnet und unter Windows gesperrt.

### Leistung

- Die Seitenansicht lädt Yjs und die Echtzeit-Erweiterungen nicht mehr mit (rund 120 KB weniger
  JavaScript beim ersten Aufruf).

### Hinweise zum Update

- Migrationen `011` (verzögerte Dateilöschung) und `012` (Bestätigung der Registrierung) – vorher wird
  automatisch gesichert.
- **Selbstregistrierung mit Domain-Beschränkung** funktioniert nur noch mit eingerichtetem E-Mail-Versand.
- **Docker**: Ohne eigenen Wert gilt `TRUST_PROXY=uniquelocal,loopback`. Erreicht ein Proxy den Container
  von einer öffentlichen Adresse aus, diese Adresse in `TRUST_PROXY` eintragen.
- **API**: `PATCH /api/v1/me` verlangt beim Ändern der E-Mail-Adresse `currentPassword`;
  `POST /api/v1/auth/register` antwortet mit E-Mail-Versand `{ "pending": true }` statt einer Sitzung.
- Nach dem ersten Start mit 1.3 schützt die Schlüsselprüfung künftige Starts; einen bewusst neuen
  Schlüssel übernimmt `DOKU_ALLOW_KEY_CHANGE=1`.
- API-Konnektoren: Abfragen ohne Seite (`pageId`) stehen nur noch der Integrationsverwaltung zur
  Verfügung.

## [1.2.0] – 2026-09-13

Gemeinsam in Echtzeit schreiben, Inhalte verlässlich aktuell halten, sauber als PDF und Word
ausgeben, aus anderen Wikis umziehen – und genug Luft für 500 Personen und mehr.

### Gleichzeitiges Bearbeiten in Echtzeit

- Mehrere Personen bearbeiten eine Rich-Text-Seite **gleichzeitig**: Änderungen erscheinen sofort bei
  allen, farbige Cursor und Markierungen zeigen, wer wo schreibt. Titel, Symbol, Stichwörter und
  Seitenbreite werden ebenfalls geteilt.
- Der gemeinsame Stand wird laufend gespeichert und übersteht Neuladen, Verbindungsabbrüche und
  Neustarts. **Veröffentlichen** erzeugt wie gewohnt eine Version – alle Beteiligten sehen, wer sie
  veröffentlicht hat.
- Die Seitenansicht zeigt, wer gerade bearbeitet und ob **unveröffentlichte Änderungen** vorliegen.
  Wurde die Seite zwischendurch anders geändert (API, Wiederherstellen), weist der Editor darauf hin;
  **„Gemeinsamen Stand verwerfen“** lädt die veröffentlichte Fassung.
- Ohne WebSocket-Verbindung (z. B. Proxy ohne Upgrade) arbeitet der Editor automatisch wie bisher mit
  persönlichen Entwürfen. Abschaltbar unter **Administration → Einstellungen**.

### E-Mail

- **Administration → E-Mail**: SMTP-Server mit Vorlagen für Microsoft 365 (mit Anmeldung oder als
  Relay über einen Connector), Exchange im eigenen Netz, Google Workspace, IONOS und STRATO; STARTTLS,
  TLS oder unverschlüsselt, Zertifikatsprüfung, Antwortadresse.
- **Verbindung prüfen** (Anmeldung ohne Versand) und **Test-E-Mail** mit verständlichen Fehlermeldungen.
- **Versandwarteschlange** mit bis zu fünf Versuchen und wachsendem Abstand, **Versandprotokoll** der
  letzten 30 Tage mit Suche, Filter und „Erneut senden“.
- Gestaltete **HTML-Mails** (mit Textfassung) in der Akzentfarbe der Installation.
- Im **Profil** wählt jede Person: sofort, **tägliche Zusammenfassung** (Uhrzeit legt die
  Administration fest) oder keine E-Mails – auf Wunsch nur Persönliches (Erwähnungen, Antworten,
  Prüfungen, Aufgaben, Wiedervorlagen).
- **Einladung per E-Mail** mit Link zum Festlegen des Passworts (Administration → Benutzer).

### Kategorien für Bereiche

- **Administration → Bereiche → Kategorien**: Kategorien wie „Abteilungen“ oder „Projekte“ anlegen,
  umbenennen, mit Symbol versehen, sortieren und entfernen. Die Reihenfolge gilt in der Navigation und
  im Bereichsverzeichnis; Bereiche einer entfernten Kategorie erscheinen unter „Weitere Bereiche“.
- Zuordnung direkt in der Bereichsliste der Administration, in den Bereichseinstellungen oder beim
  Anlegen eines Bereichs – als Auswahl statt Freitext.

### Wiedervorlage und Verantwortliche

- Jede Seite kann eine **verantwortliche Person** und ein **Prüfintervall** haben (1, 3, 6, 12, 24
  oder 36 Monate) – oder die **Vorgabe des Bereichs** erben.
- Der Seitenkopf zeigt, wann zuletzt geprüft wurde und bis wann die nächste Prüfung fällig ist; bald
  fällige und überfällige Seiten tragen einen Hinweis mit **„Als aktuell bestätigen“**. Auch wesentliche
  Änderungen der Verantwortlichen und Freigaben einer Redaktionsprüfung zählen als Prüfung.
- Neue Übersicht **Wiedervorlage** (linke Navigation, mit Zähler): eigene oder alle sichtbaren Seiten,
  gefiltert nach Handlungsbedarf, überfällig oder bald fällig.
- **Erinnerungen** 14 Tage vor der Fälligkeit und bei Überfälligkeit – als Benachrichtigung und per
  E-Mail. Ohne verantwortliche Person geht die Erinnerung an die zuletzt bearbeitende Person.
- **Verbindung zum Aufgabenplaner**: Überfällige Prüfungen werden auf Wunsch als Aufgabe im Plan des
  Bereichs angelegt; Bestätigen der Seite erledigt die Aufgabe und umgekehrt.

### Aufgabenplaner

- **Zeitachse** (Gantt-light) als dritte Ansicht neben Board und Liste: Balken ziehen verschiebt den
  Zeitraum, die Enden ändern Beginn und Fälligkeit; Maßstab Tage, Wochen oder Monate.
- **Wiederkehrende Aufgaben** (täglich, wöchentlich, alle 2 Wochen, monatlich, vierteljährlich,
  jährlich): Beim Erledigen entsteht die nächste Aufgabe mit verschobenen Terminen und
  zurückgesetzter Checkliste.
- **Erinnerung vor dem Termin** – der Vorlauf ist je Person im Profil wählbar (am Tag, 1, 2, 3 Tage
  oder eine Woche vorher) – plus eine Meldung bei Überfälligkeit, als Benachrichtigung und per E-Mail.
- **Kalender-Abo (ICS)** für Outlook, Apple-Kalender, Google Kalender und Thunderbird: persönlich
  (eigene Aufgaben und Wiedervorlagen) oder je Plan als Team-Kalender, über einen geheimen,
  jederzeit erneuer- und widerrufbaren Link.

### Volltextsuche in Anhängen

- Die Suche findet Inhalte von **PDF, Word, Excel, PowerPoint, Visio, OpenDocument, RTF, HTML und
  Textdateien**; ältere Office-Formate (`.doc`, `.xls`, `.ppt`, `.vsd`) werden gelesen, wenn LibreOffice
  eingerichtet ist.
- Treffer erscheinen mit **Textauszug** und dem Hinweis „im Inhalt“, nur für Anhänge auf Seiten, die
  die suchende Person lesen darf.
- Neue und bestehende Dateien werden im Hintergrund indexiert; **Administration → Wartung → Anhänge
  neu indexieren** baut den Index vollständig neu auf.

### Export nach PDF und Word mit Firmenvorlage

- **… → Exportieren** bietet PDF, Word (`.docx`), Markdown und HTML – wahlweise mit Unterseiten,
  **Deckblatt** und **Inhaltsverzeichnis** mit Seitenzahlen.
- **Administration → Export-Vorlage**: Firmenname, Logo, Hausfarbe, Schriftart für Word,
  Vertraulichkeitsstufe, Papierformat sowie **Kopf- und Fußzeile** mit Platzhaltern (`{company}`,
  `{title}`, `{space}`, `{date}`, `{version}`, `{author}`, `{owner}`, `{classification}`); ein
  Musterdokument zeigt das Ergebnis vor dem Speichern.
- **Handbuch als PDF oder Word**: alle Seiten eines Bereichs in einem Dokument
  (Bereichseinstellungen → Export & Import).
- Tabellen, Hinweisboxen, Code, Aufgabenlisten, Bilder, Galerien, draw.io-Diagramme und Whiteboards
  werden übernommen; Word-Dokumente bleiben mit echten Formatvorlagen weiter bearbeitbar.

### Whiteboard

- Neues Makro **Whiteboard** (`/whiteboard`) mit Excalidraw für freie Skizzen: Handzeichnungen,
  Formen, Pfeile und Text im Skizzenstil – neben draw.io für exakte Diagramme.
- Das Whiteboard wird als Grafik in der Seite gespeichert, bleibt bearbeitbar, erscheint in der
  Versionsgeschichte und im Export. Editor und Schriften liefert Doku selbst aus – kein Internetzugang
  nötig.

### Import aus MediaWiki, DokuWiki und XWiki

- **Bereichseinstellungen → Export & Import → Aus anderem Wiki übernehmen**: MediaWiki-XML (optional als
  ZIP mit Bildern), DokuWiki-Datenordner als ZIP oder XWiki-XAR – das Format wird automatisch erkannt.
- Übernommen werden Seitenhierarchie (Unterseiten, Namensräume, verschachtelte Seiten), Formatierungen,
  Tabellen, Hinweisboxen, interne Verweise, Bilder und Dateien als Anhänge, Kategorien bzw. Tags als
  Stichwörter und auf Wunsch die **Versionsgeschichte** (bis 50 Versionen je Seite).
- Der Import läuft im Hintergrund mit Fortschrittsanzeige und endet mit einem Bericht (übernommene
  Seiten und Dateien, nicht auflösbare Verweise, fehlende Dateien).

### Leistung und Betrieb mit vielen Personen

- **Lasttest** mit 500 Konten, 40 Bereichen und 8 000 Seiten: rund **500 Anfragen pro Sekunde** bei
  100 gleichzeitig ohne Pause arbeitenden Clients, 95 % der Seitenaufrufe, Speichervorgänge und
  Suchen unter 0,4 Sekunden, keine Fehler – drei- bis viereinhalbmal so viel wie vor den
  Optimierungen. Das Werkzeug liegt bei: `node scripts/loadtest.mjs`.
- **Suche** zweistufig: erst Treffer und Rechte, dann Inhalte nur für die angezeigte Seite;
  Textauszüge ohne zweite Volltextabfrage.
- **Rechteprüfung** mit Zwischenspeicher für Seiteneinschränkungen, gebündelte Kennzahlen je Bereich,
  zusätzlicher Index, größerer SQLite-Seitencache und Memory-Mapping.
- **Seitenaufrufe** werden gesammelt geschrieben statt mit jedem Aufruf.
- **Vorkomprimierte Oberfläche** (Brotli und gzip): Beim ersten Aufruf werden rund 0,5 MB statt gut 2 MB JavaScript übertragen.
- Rechenintensive Arbeit (PDF/Word-Erzeugung, Textgewinnung aus Anhängen, Datenbank-Snapshot der
  Sicherung) läuft in eigenen Worker-Threads und blockiert keine Anfragen.

### Sicherheit

- **Echtzeit-Bearbeitung**: Anmeldung über die bestehende Sitzung oder ein API-Token mit Umfang
  `write`, Prüfung der Herkunft (Schutz vor Cross-Site-WebSocket-Hijacking), Schreibrecht beim
  Verbinden und alle 30 Sekunden erneut (auch abgelaufene Sitzungen und widerrufene Tokens trennen die
  Verbindung); Grenzen je Seite, je Person und Nachrichtengröße; Namen und Farben anderer
  Teilnehmender lassen sich nicht fälschen.
- **Kalender-Abo**: Der Link enthält ein zufälliges Geheimnis, gespeichert wird nur dessen Hash; der
  Feed zeigt ausschließlich, was die Person selbst sehen darf.
- **Export**: Bilder nur mit Leserecht, SVG-Grafiken werden bereinigt, Erzeugung mit Zeitlimit und
  Ratenbegrenzung je Person.
- **Importe**: Obergrenzen für Dateianzahl und entpackte Größe von ZIP-Archiven (Schutz vor
  „ZIP-Bomben“), Inhalte werden wie jeder Seiteninhalt bereinigt, höchstens zwei laufende Importe je
  Person.
- **E-Mail**: SMTP-Passwort verschlüsselt gespeichert und nie angezeigt; Inhalte in HTML-Mails werden
  maskiert.
- **Anhangsuche**: Textgewinnung in einem Worker-Thread mit Zeit- und Größenlimit; Treffer werden
  nach Leserechten gefiltert.

### Behoben

- Felder, die ausdrücklich geleert werden (`null`), kamen bisher als `0` bzw. leere Zeichenkette beim
  Server an. Dadurch schlugen unter anderem das Entfernen des Bereichsfilters eines Webhooks, das
  Zurücksetzen der Startseite eines Bereichs und eine erneute Prüfanforderung ohne prüfende Person
  fehl. Alle betroffenen Schnittstellen übernehmen `null` jetzt unverändert (auch in der
  OpenAPI-Beschreibung als `nullable`).
- Sicherungen hielten bei großen Datenbanken den Server für die Dauer des Snapshots an; der Snapshot
  läuft jetzt in einem Worker-Thread.

### Hinweise zum Update

- Die Migrationen `004` bis `010` legen Versandwarteschlange, Kategorien, Wiedervorlage,
  Planer-Erweiterungen, Anhang-Index, gemeinsame Bearbeitungsstände und einen Leistungsindex an. Vorher
  eine Sicherung erstellen.
- Bisherige Kategorien der Bereiche werden automatisch in die neue Kategorienliste übernommen.
- **Reverse-Proxy**: Für die Echtzeit-Bearbeitung muss der Proxy WebSocket-Upgrades durchreichen
  (nginx: Header `Upgrade` und `Connection` weitergeben, IIS: Windows-Funktion „WebSocket-Protokoll“) –
  siehe [Administrationshandbuch](docs/ADMINISTRATION.md#reverse-proxy).
- E-Mail-Benachrichtigungen gehen nur hinaus, wenn unter **Administration → E-Mail** ein SMTP-Server
  eingerichtet und der Versand von Benachrichtigungen eingeschaltet ist.
- Anhänge werden nach dem Start im Hintergrund indexiert; bei vielen Dateien kann das eine Weile dauern.
- Danach **Administration → Wartung → Handbuch aktualisieren** ausführen. Neue Kapitel:
  *Wiedervorlage*; erweitert wurden unter anderem *Aufgabenplaner*, *Zusammenarbeit* und
  *Export und Import*.

## [1.1.0] – 2026-09-13

Planen, Dateien und KI – plus eine aufgeräumte Bearbeitungsansicht.

### Aufgabenplaner

- **Pläne je Bereich** mit frei benennbaren, farbigen Spalten (bis 12), Board- und Listenansicht,
  Filter *Alle / Meine / Offen / Überfällig* und Kennzahlen (Anzahl, Anteil erledigt, überfällig).
- **Aufgaben** mit Verantwortlichen, Beginn und Fälligkeit, Priorität, Status, Fortschritt,
  Beschreibung, Checkliste, Stichwörtern und Verknüpfung zu einer Seite; Karten per Drag & Drop
  verschieben, Schnellerfassung je Spalte.
- Die **letzte Spalte gilt als erledigt**: Spalte, Status und Fortschritt bleiben beim Ziehen,
  Abhaken und Bearbeiten stimmig. Karten aus gelöschten Spalten wandern in die erste Spalte.
- **Meine Aufgaben** über alle Bereiche, gruppiert nach Überfällig, Heute, Nächste 7 Tage, Später.
- **Benachrichtigung** bei Zuweisung, Zähler offener Aufgaben in der Navigation.
- Makro **Aufgaben** zeigt offene, alle oder die mit der Seite verknüpften Aufgaben direkt im Beitrag.

### KI-Assistent

- Anbieterneutrale Anbindung: **Anthropic (Claude)**, **OpenAI**, **Azure OpenAI**, **Ollama**
  (lokal) und OpenAI-kompatible Dienste; Einrichtung mit Verbindungstest unter
  **Administration → KI & Dateien**.
- **Im Editor**: Sprachlich verbessern, Kürzen, Übersetzen, Zusammenfassen, Gliederung erstellen,
  Aufgaben ableiten, Titel vorschlagen – immer mit Vorschau, Ersetzen/Einfügen und Nachbessern.
- **Auf Seiten**: Zusammenfassen, Fragen zur Seite, Stichwörter vorschlagen und übernehmen.
- Neues Recht **„KI-Funktionen nutzen“** (`ai.use`), freischaltbare Aktionen, Tageslimit je Person,
  zusätzliche Hausanweisung, Nutzungsstatistik; Schlüssel verschlüsselt gespeichert.

### Dateien, PDF und Diagramme

- **Dateien hochladen im Beitrag**: PDFs erscheinen als Betrachter, andere Dateien als Karte mit
  Vorschau und Download; mehrere Dateien auf einmal behalten ihre Reihenfolge.
- **PDF-Betrachter** (pdf.js) mit Blättern, Zoom, Seitenbreite, Vollbild und Download.
- **Office- und Visio-Vorschau** (PowerPoint, Word, Excel, Visio, OpenDocument) über LibreOffice
  mit Zwischenspeicher – optional, Status in der Administration.
- **draw.io-Diagramme** direkt in Doku zeichnen und bearbeiten; eigene draw.io-Installation
  hinterlegbar, die Content-Security-Policy wird automatisch angepasst.

### Bearbeiten und Organisieren

- **Neue Bearbeitungsansicht**: Seite als Papierbogen, einblendbare **Gliederung** mit Sprung zu
  Überschriften, Wortanzahl und Lesezeit; **Stichwörter direkt unter dem Titel**.
- **Zwischenablage**: Ausschnitte (mit Formatierung), Links und KI-Ergebnisse ablegen, anheften und
  in beliebige Seiten einfügen – privat je Person.
- **Duplizieren** von Seiten mit einem Klick (neben Kopieren und Verschieben).
- **Stichwörter-Übersicht** als Wolke oder Liste; Administratoren können Stichwörter umbenennen,
  zusammenführen und löschen.
- **Handbuch aktualisieren** (Administration → Wartung): ergänzt neue Kapitel nach einem Update und
  lässt von Hand geänderte Kapitel unangetastet. Neue Kapitel: *Dateien, PDF und Diagramme*,
  *Aufgabenplaner*, *KI-Assistent*.

### Sicherheit

Prüfung der neuen Funktionen vor der Veröffentlichung (alle Punkte behoben bzw. abgesichert):

- **KI**: Wird eine Seite angegeben, prüft Doku das Leserecht immer – auch wenn zusätzlich Text
  mitgeschickt wird. Anfragen folgen keinen Weiterleitungen, laufen mit Zeitlimit und
  Ratenbegrenzung; Ergebnisse werden vor der Anzeige bereinigt (DOMPurify). KI-Nutzung erscheint nur
  im Audit-Log, nicht im öffentlichen Aktivitätsfeed.
- **Aufgaben**: Verantwortliche müssen den Bereich sehen dürfen (sonst verrieten Benachrichtigungen
  Interna); verknüpfte Seiten werden nur Personen mit Leserecht angezeigt, der Link zeigt immer in
  den richtigen Bereich.
- **Zwischenablage**: HTML wird wie Seiteninhalt bereinigt, Links nur mit `http(s)`, `mailto` oder
  internen Pfaden.
- **Vorschau**: PDFs werden mit `sandbox`-CSP ausgeliefert; die Office-Umwandlung läuft ohne Shell,
  mit Zeit- und Größenlimit und eigenem Profil.
- **draw.io**: Nachrichten nur vom eigenen iframe und der konfigurierten Herkunft, Bilddaten per
  Muster geprüft.
- **pdf.js 6.3** (behebt die Schwachstelle der 5er-Reihe beim Öffnen präparierter PDFs), ohne
  WebAssembly – die strenge CSP bleibt unverändert.

### Behoben

- Wurden mehrere Bilder am Seitenende hochgeladen, ersetzte jedes Bild das zuvor eingefügte.
- Reiterleisten zeigten in manchen Breiten einen überflüssigen senkrechten Rollbalken.

### Hinweise zum Update

- Die Datenbankmigration `003` legt die Tabellen für Aufgaben, Zwischenablage und KI-Protokoll an.
- Bestehende Installationen: Recht `ai.use` bei Bedarf den Gruppen geben, danach
  **Administration → Wartung → Handbuch aktualisieren** ausführen.

## [1.0.0] – 2026-09-12

Erste vollständige Ausgabe.

### Inhalte und Editor

- Bereiche (Spaces) mit Schlüssel, Symbol, Beschreibung, Startseite, Archivierung und persönlichen Bereichen.
- Seitenbaum mit Drag & Drop, Sortierung, Filter, Verschieben und Kopieren (wahlweise mit Unterseiten).
- Rich-Text-Editor auf Basis von TipTap: Überschriften, Listen, Aufgabenlisten, Tabellen, Bilder,
  Zitate, Trennlinien, Textfarben, Hervorhebungen, Hoch-/Tiefstellung, Tastenkürzel-Auszeichnung.
- Slash-Menü, `@`-Erwähnungen, `[[`-Seitenverweise, Einfügen per Drag & Drop und Zwischenablage.
- Makros: Inhaltsverzeichnis, Unterseiten, Seite einbinden, Änderungshistorie, zuletzt geändert,
  Anhänge, Eigenschaften-Bericht, Hinweisboxen, Aufklappbereich, Status-Etikett, Einbettung,
  Mermaid-Diagramm, Formeln (KaTeX), API-Daten und Plugin-Makros.
- Seitentypen Rich-Text, Markdown und Code (CodeMirror mit Syntaxhervorhebung).
- **Bildergalerien**: Raster, Mauerwerk oder Streifen, Bildunterschriften, Reihenfolge per
  Ziehen, Upload direkt im Makro und Lightbox mit Tastatursteuerung.
- Vorlagen: 13 mitgelieferte deutsche Vorlagen, eigene Vorlagen global oder je Bereich,
  Platzhalter für Datum, Kalenderwoche, Benutzer.
- Anhänge mit Versionierung, Vorschau, Größenbegrenzung und gesperrten Dateiendungen.
- Entwürfe mit automatischem Zwischenspeichern, Papierkorb mit Aufbewahrungsfrist.

### Wissen und Suche

- Volltextsuche (SQLite FTS5) mit Filtern: `space:`, `label:`, `author:@`, `in:title`,
  `#eigenschaft=wert`, Phrasen in Anführungszeichen, Ausschluss mit `-`.
- Stichwörter und Eigenschaften (Schlüssel/Wert) je Seite, Eigenschaften-Bericht als Tabelle.
- Backlinks, ausgehende Verweise und interaktive Link-Karte.
- Journal/Tagesnotizen mit automatischer Jahres- und Monatsstruktur.
- Favoriten, beobachtete Seiten und Bereiche, zuletzt besuchte Seiten.

### Versionen und Änderungsprotokolle

- Versionsgeschichte je Seite mit Änderungsnotiz, kleinen Änderungen und Autor.
- Visueller Vergleich zweier Versionen (Wort-Diff für Rich-Text, Zeilen-Diff für Markdown/Code).
- Wiederherstellen alter Versionen, Änderungsprotokoll je Bereich (auch als Markdown abrufbar).
- Globaler Aktivitätsfeed und Audit-Log mit CSV-Export.

### Zusammenarbeit

- Kommentare an der Seite und an markierten Textstellen, Antworten, Erledigen und Wiederöffnen.
- Benachrichtigungen im System und optional per E-Mail (SMTP), Erwähnungen, Beobachtungen.
- Anwesenheitsanzeige und Live-Aktualisierung über Server-Sent Events.

### Anmeldung und Verzeichnis

- Anmeldung über **Active Directory bzw. LDAP**: Suche über ein Dienstkonto, Passwortprüfung per
  Bind, optionale automatische Kontoanlage, Pflicht-Sicherheitsgruppe, StartTLS und Zertifikatsprüfung.
- **AD-Sicherheitsgruppen** lassen sich Doku-Gruppen zuordnen; Mitgliedschaften werden bei jeder
  Anmeldung abgeglichen (auch verschachtelte Gruppen).
- Verbindungstest mit Testkonto und Gruppensuche direkt in der Administration.
- Zugangsdaten des Dienstkontos werden verschlüsselt gespeichert; lokale Anmeldung bleibt möglich.

### Redaktionsprüfung und Wiederherstellung

- **Prüfung anfordern** auf jeder Seite, mit optionaler prüfender Person und Nachricht.
- Bereichseinstellung **„Änderungen müssen freigegeben werden“**: Änderungen ohne Prüfrecht landen
  automatisch als Auftrag bei der Bereichsredaktion.
- Postfach **Prüfaufträge** mit Freigeben, Zurückweisen (mit Begründung) und Versionsvergleich.
- Statusband auf der Seite, Benachrichtigungen und Ereignisse für jede Entscheidung.
- **Letzte Änderungen**: die jüngsten 25–200 Bearbeitungen aller sichtbaren Bereiche mit
  Ein-Klick-Rücknahme (als neue Version, nichts geht verloren).

### Rechte

- Gruppen mit globalen Rechten (`admin`, `spaces.create`, `users.manage`, `templates.manage`,
  `integrations.manage`, `audit.view`, `api.tokens`).
- Bereichsrollen Betrachter, Kommentator, Bearbeiter, Bereichsadministrator – für Gruppen,
  einzelne Benutzer, angemeldete Benutzer oder anonyme Gäste.
- Seiteneinschränkungen für Ansicht (vererbt sich an Unterseiten) und Bearbeitung.
- Anmeldeschutz mit Sperre nach Fehlversuchen, Sitzungsverwaltung, Passwort-Zurücksetzung.

### Schnittstellen

- REST-API mit über 165 Endpunkten und OpenAPI-Oberfläche unter `/api/docs`.
- Persönliche API-Tokens mit den Umfängen `read`, `write`, `admin` und optionaler Ablaufzeit,
  Dienstkonten für Automatisierungen.
- Webhooks mit HMAC-SHA256-Signatur, Ereignisfilter, Zustellprotokoll, Wiederholungen und
  automatischer Deaktivierung nach dauerhaften Fehlern.
- API-Konnektoren: verschlüsselte Zugangsdaten, serverseitiger GET-Proxy mit Cache und
  Pfadfreigaben, Anzeige der Daten über das Makro „API-Daten“.
- Endpunkt `POST /api/v1/pages/:id/append` zum Anhängen von Inhalten aus CI/CD-Pipelines.

### Erweiterbarkeit

- Plugin-System mit Server- und Browser-Teil, aktivierbar ohne Neustart.
- Hooks `page.beforeSave`, `page.render`, `page.export`, `search.results`, Ereignis-Abonnements,
  eigene Routen unter `/api/v1/plugins/<id>/…`, Plugin-Speicher und Einstellungsformulare.
- Browser-API für eigene Makros, Seitenaktionen, Angaben im Seitenkopf und Panels.
- Mitgelieferte Beispiele: **Automatische Verlinkung**, **Chat-Benachrichtigungen**,
  **Beispiel-Erweiterung**.

### Administration und Betrieb

- Administrationsbereich für Benutzer, Gruppen, Berechtigungen, Bereiche, Vorlagen, Einstellungen,
  Webhooks, Konnektoren, Plugins, Audit-Log, Sicherungen, Wartung und Systeminformationen.
- Automatische nächtliche Sicherungen (Datenbank und optional Anhänge) mit Aufbewahrungsregel,
  Download und Löschung über die Oberfläche.
- Wartungsaufgaben: Papierkorb leeren, Suchindex neu aufbauen, alte Ereignisse entfernen,
  verwaiste Anhänge aufräumen, Datenbank optimieren.
- Verwaltungswerkzeug `npm run cli` für Benutzer, Sicherungen, Reindex, Migrationen und Einstellungen.
- Import und Export: Markdown, HTML, ZIP-Archiv je Bereich, Druckansicht/PDF.

### Sicherheit

Ergebnisse der Sicherheitsdurchsicht vor der Veröffentlichung (alle Punkte behoben):

- **Importierte Versionen** aus fremden ZIP-Archiven werden jetzt beim Import **und** beim Anzeigen
  bereinigt – zuvor hätte ein präpariertes Archiv Skriptcode in eine alte Version schmuggeln können.
- **Statische Auslieferung**: Der Pfadvergleich prüft echtes Enthaltensein statt nur den Namensanfang
  (verhinderte Zugriffe auf Nachbarverzeichnisse mit gleichem Präfix). Gleiches gilt für Plugin-Dateien.
- **API-Konnektoren** folgen keinen Weiterleitungen mehr (SSRF-Schutz); Umleitungen werden als Fehler
  gemeldet. Auch das Chat-Plugin sendet ohne Weiterleitungen.
- **Persönliche Einstellungen** sind in Größe und Schlüsselzahl begrenzt; Schlüssel wie `__proto__`
  werden abgewiesen (Prototype Pollution, Speicher-Missbrauch).
- **System- und Plugin-Einstellungen** übernehmen nur eigene, bekannte Schlüssel.
- **Verzeichnisanmeldung**: leere Passwörter werden nie an den LDAP-Server geschickt (ein Bind ohne
  Passwort gilt dort als anonyme Anmeldung), Suchfilter werden nach RFC 4515 maskiert, deaktivierte
  AD-Konten abgewiesen, TLS-Zertifikate standardmäßig geprüft.
- **Galerien** akzeptieren nur Bildquellen aus `http(s)`, relativen Pfaden und `data:image/...`.
- **Beispiel-Plugin** setzt Werte per `textContent` statt `innerHTML` (Vorbildfunktion).

### Oberfläche

- Ruhiges, modernes Erscheinungsbild: Glasflächen mit Unschärfe, weiche Radien, Verlaufsakzente,
  zurückhaltende Bewegung (abschaltbar über die Systemeinstellung „Bewegung reduzieren“ des Geräts).
- **Kategorien für Bereiche** gliedern Seitenleiste und Bereichsverzeichnis.
- **Onboarding**: dreistufiger Einrichtungsassistent, geführter Rundgang und Einstiegs-Checkliste
  auf der Startseite; der Rundgang lässt sich jederzeit erneut starten.
- Deutsch (Standard) und Englisch, helles und dunkles Design, konfigurierbare Akzentfarbe.
- Befehlspalette (`Strg`+`K`), Tastenkürzel, Übersicht mit `?`.
- Startseite mit Favoriten, Zuletzt, Entwürfen und Aktivität; Bereichsübersicht; Personenprofile.
- Selbstdokumentierend: Beim Einrichten wird der Bereich **Handbuch** mit 14 Kapiteln angelegt.

[1.1.0]: https://example.com/doku/compare/v1.0.0...v1.1.0
[1.0.0]: https://example.com/doku/releases/tag/v1.0.0
