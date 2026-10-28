# Installationsanleitung

Diese Anleitung führt zu einer produktiven Knowstead-Installation: Programm bereitstellen, als Dienst
betreiben, per HTTPS erreichbar machen, einrichten und absichern. Am schnellsten geht es mit dem
[Installationsassistenten](#installation-mit-dem-assistenten-empfohlen) – er fragt alle Angaben ab und
erledigt Konfiguration, Autostart, Firewall und Prüfung. Die Abschnitte 4 bis 6 beschreiben dieselben
Schritte von Hand. Alles Weitere zum laufenden Betrieb steht im [Administrationshandbuch](ADMINISTRATION.md).

**Zeitbedarf:** mit dem Assistenten etwa 15 Minuten plus Zertifikat und Reverse-Proxy; von Hand 30–60 Minuten.

## Inhalt

- [Schnellstart zum Ausprobieren](#schnellstart-zum-ausprobieren)
- [Installation mit dem Assistenten (empfohlen)](#installation-mit-dem-assistenten-empfohlen)
  – [Windows](#windows) · [Linux](#linux) · [Proxmox VE (LXC-Container)](#proxmox-ve-lxc-container)
1. [Überblick](#1-überblick)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Vor der Installation festlegen](#3-vor-der-installation-festlegen)
4. [Installation unter Windows](#4-installation-unter-windows)
5. [Installation unter Linux](#5-installation-unter-linux)
6. [Installation mit Docker](#6-installation-mit-docker)
7. [HTTPS und Reverse-Proxy](#7-https-und-reverse-proxy)
8. [Ersteinrichtung im Browser](#8-ersteinrichtung-im-browser)
9. [Optionale Anbindungen](#9-optionale-anbindungen)
10. [Sicherung einrichten und prüfen](#10-sicherung-einrichten-und-prüfen)
11. [Updates und Umzug](#11-updates-und-umzug)
12. [Prüfliste nach der Installation](#12-prüfliste-nach-der-installation)
13. [Fehlersuche bei der Installation](#13-fehlersuche-bei-der-installation)
14. [Referenz: Einstellungen in der `.env`](#14-referenz-einstellungen-in-der-env)

---

## Schnellstart zum Ausprobieren

Für einen Test auf dem eigenen Rechner – ohne Dienst, ohne HTTPS:

1. [Node.js 24 oder neuer](https://nodejs.org/) installieren.
2. Programmordner ablegen, z. B. `D:\Knowstead` oder `~/knowstead`.
3. **Windows:** Doppelklick auf `start.cmd`. **Linux/macOS:** `./start.sh`.
4. Der Browser öffnet `http://localhost:3000` – der Assistent legt das erste Administratorkonto an.

Beim ersten Start installiert das Skript die Abhängigkeiten und baut die Oberfläche (einige Minuten;
mit dem [Installationspaket](#programm-besorgen) entfällt das). Für den Produktivbetrieb den
[Installationsassistenten](#installation-mit-dem-assistenten-empfohlen) verwenden.

---

## Installation mit dem Assistenten (empfohlen)

Der Assistent richtet Knowstead auf dem Server vollständig ein und prüft das Ergebnis: Datenverzeichnis,
Konfiguration (`.env`), Abhängigkeiten und Oberfläche, Probestart, Autostart, Rechte, Firewall,
Virenscanner-Ausnahme und – falls vorhanden – Texterkennung und Office-Vorschau. Danach fehlen nur noch
das HTTPS-Zertifikat am Reverse-Proxy ([Abschnitt 7](#7-https-und-reverse-proxy)) und die
Ersteinrichtung im Browser. Er lässt sich jederzeit erneut ausführen, um Angaben zu ändern oder ein
Update abzuschließen; vorhandene Werte und der Serverschlüssel bleiben dabei erhalten.

### Programm besorgen

| Weg | Wann |
| --- | --- |
| **Installationspaket** aus den GitHub-Releases: `knowstead-<version>-windows-x64.zip` bzw. `knowstead-<version>-linux-x64.tar.gz` | empfohlen – Oberfläche fertig gebaut, nur Laufzeitbestandteile; auf dem Server kein npm-Download und kein Build |
| Paket selbst bauen: `npm run build`, dann `node scripts/package.mjs --target linux-x64` (bzw. `windows-x64`, `linux-arm64`) | vor dem ersten Release oder mit eigenen Anpassungen – auch unter Windows für einen Linux-Server; Ergebnis in `release/` |
| Quellcode (Git oder ZIP des Repositorys) | für Entwicklung oder eigene Anpassungen – Abhängigkeiten und Oberfläche werden beim ersten Lauf installiert bzw. gebaut (Internetzugang für npm) |

Die Prüfsumme steht jeweils in der `.sha256`-Datei daneben:

```powershell
Get-FileHash .\knowstead-2.2.3-windows-x64.zip -Algorithm SHA256
```

```bash
sha256sum -c knowstead-2.2.3-linux-x64.tar.gz.sha256
```

Ein Paket gilt für das Betriebssystem, für das es gebaut wurde. Wird es trotzdem auf einem anderen
System entpackt, installiert der erste Start die Abhängigkeiten passend nach (Internetzugang nötig).

### Windows

1. Paket nach z. B. `D:\Knowstead` entpacken (Programmordner – **nicht** das spätere Datenverzeichnis).
2. Doppelklick auf **`Knowstead-Installation.cmd`** und die Rückfrage der Benutzerkontensteuerung bestätigen.
3. Die Seiten des Assistenten. Er richtet sich nach der Anzeigesprache von Windows (Deutsch, sonst Englisch);
   der Verweis *In English* / *Auf Deutsch* auf der ersten Seite wechselt, und
   `Knowstead-Installation.cmd -Language de` legt die Sprache von vornherein fest:

| Seite | Inhalt |
| --- | --- |
| **Willkommen** | prüft Node.js 24 – fehlt es, installiert ein Knopf die LTS-Version über `winget`; erkennt eine vorhandene Installation und füllt alle Angaben vor |
| **Datenverzeichnis** | z. B. `D:\KnowsteadDaten` – lokales Laufwerk, außerhalb des Programmordners; zeigt den freien Speicher |
| **Erreichbarkeit** | *Reverse-Proxy auf diesem Server* (empfohlen, Knowstead lauscht nur auf 127.0.0.1), *Proxy auf einem anderen Rechner* (mit dessen IP-Adresse) oder *direkt im Netzwerk* (nur für Tests); Adresse für die Nutzenden und Port |
| **Betrieb** | Autostart als **geplante Aufgabe** (ohne Zusatzsoftware), als **Windows-Dienst mit NSSM** oder kein Autostart; Firewall-Regel; Ausnahme der Datenbankdateien in Microsoft Defender |
| **Zusatzfunktionen** | Tesseract (Texterkennung) und LibreOffice (Office-Vorschau) werden gesucht und auf Wunsch eingeschaltet. Fehlen sie, installiert der Assistent sie nach Ankreuzen mit `winget` – Tesseract samt deutschen und englischen Sprachdaten |
| **Zusammenfassung** | alle Schritte zum Prüfen, bevor etwas verändert wird |
| **Installation** | Fortschritt und vollständiges Protokoll (wird unter `<Datenverzeichnis>\logs\installation-*.log` gespeichert) |
| **Fertig** | Ergebnis der Prüfung und **„Ersteinrichtung im Browser öffnen“** – auf dem Server selbst ohne Einrichtungscode |

**Autostart als geplante Aufgabe:** Die Aufgabe `\Knowstead\Knowstead` startet beim Systemstart unter dem Konto
*Lokaler Dienst* – ohne Anmeldung, ohne Passwort und nur mit Leserechten auf den Programmordner und
Änderungsrechten auf das Datenverzeichnis. Nach einem Fehler startet sie Knowstead nach einer Minute neu. Das
Protokoll schreibt Knowstead selbst nach `<Datenverzeichnis>\logs\knowstead.log` (10 MB, fünf ältere Stände).
Beendet wird immer geordnet über `Knowstead-Dienst.cmd stop` – nicht über „Beenden“ in der Aufgabenplanung,
das den Prozess hart abbricht.

**Knowstead steuern:**

```powershell
.\Knowstead-Dienst.cmd status          # Betriebsart, Erreichbarkeit, Datenbankstand
.\Knowstead-Dienst.cmd restart
.\Knowstead-Dienst.cmd log -Follow     # Protokoll laufend anzeigen
```

**Ohne Rückfragen** – für Skripte, Softwareverteilung und Updates. Nicht angegebene Werte stammen aus der
vorhandenen `.env`, sonst aus den Vorgaben:

| Parameter | Bedeutung |
| --- | --- |
| `-Unattended` | ohne Oberfläche ausführen |
| `-DataDir D:\KnowsteadDaten` | Datenverzeichnis |
| `-BaseUrl https://knowstead.firma.de` | Adresse für die Nutzenden |
| `-Port 3000` | Port |
| `-Access LocalProxy` \| `RemoteProxy` \| `Direct` | Erreichbarkeit (`-ProxyAddress 10.0.0.5` bei `RemoteProxy`) |
| `-Service Task` \| `Nssm` \| `None` | Autostart (`-NssmPath C:\Tools\nssm\nssm.exe` bei `Nssm`) |
| `-NoFirewall`, `-NoDefenderExclusion` | Firewall-Regel bzw. Virenscanner-Ausnahme auslassen |
| `-InstallTesseract`, `-InstallLibreOffice` | Zusatzprogramme mit `winget` installieren, falls sie fehlen, und einschalten (`-OcrLanguages deu+eng+fra` für weitere Sprachen der Texterkennung) |
| `-TesseractPath …`, `-LibreOfficePath …` | vorhandene Zusatzprogramme an anderem Ort einschalten |
| `-WhatIf` | nur anzeigen, was geschehen würde |
| `-Uninstall` | Autostart, Firewall-Regel und Ausnahmen entfernen – Programm und Daten bleiben |

Die Zusatzprogramme sind keine Voraussetzung: Lässt sich eines nicht installieren oder eintragen, richtet
der Assistent Knowstead ohne diese Funktion ein und zeigt am Ende unter **Hinweise**, was offen blieb. Schlägt
die Einrichtung fehl, nachdem der Assistent ein laufendes Knowstead angehalten hat, startet er es wieder.

```powershell
.\Knowstead-Installation.cmd -Unattended -DataDir D:\KnowsteadDaten -BaseUrl https://knowstead.firma.de -Access LocalProxy
```

### Linux

```bash
sudo tar -xzf knowstead-2.2.3-linux-x64.tar.gz -C /opt && sudo mv /opt/knowstead-2.2.3-linux-x64 /opt/knowstead
```

```bash
cd /opt/knowstead && sudo bash install.sh
```

Das Skript fragt dieselben Angaben ab wie unter Windows – mit Dialogen, wenn `whiptail` installiert ist,
sonst im Terminal. Es legt das Systemkonto `knowstead` und das Datenverzeichnis (Standard `/var/lib/knowstead`) an,
schreibt die `.env` (nur für root und das Dienstkonto lesbar), macht einen Probestart, richtet den
systemd-Dienst `knowstead` mit Härtung ein und öffnet bei Bedarf den Port in `ufw` bzw. `firewalld`.
Fehlt Node.js 24, bietet das Skript an, es aus der Paketquelle von NodeSource zu installieren (ohne
Rückfragen: `--install-node`; von Hand siehe [Abschnitt 5.1](#51-nodejs-installieren)).

Die Meldungen erscheinen in der Sprache des Systems – Deutsch, wenn sie Deutsch ist, sonst Englisch. Ausdrücklich
wählen lässt sie sich mit `sudo bash install.sh --lang de` (bzw. `--lang en`) oder über die Umgebungsvariable
`KNOWSTEAD_LANG`; dieselbe Regel gilt für `start.sh` und `start.cmd`. `update.sh` und die Kommandozeile
(`npm run cli`) sprechen Deutsch – die Prüfung gibt es mit `npm run cli -- doctor --lang en` auch auf Englisch.

Ebenso fragt es nach den beiden **Zusatzprogrammen** und installiert sie auf Wunsch aus der Paketquelle
der Distribution (`apt` unter Debian und Ubuntu, `dnf` unter RHEL, Rocky, Alma und Fedora):

| Frage | Vorgabe | Was installiert wird | Ohne Rückfragen |
| --- | --- | --- | --- |
| **Texterkennung (OCR) installieren?** | Ja | Tesseract mit den Sprachdaten Deutsch und Englisch, rund 25 MB – macht eingescannte PDFs und Bilder durchsuchbar | `--install-ocr`, weitere Sprachen mit `--ocr-languages deu+eng+fra` |
| **LibreOffice installieren?** | Nein | LibreOffice ohne grafische Oberfläche samt Schriften, rund 400 MB – Vorschau für Word, Excel, PowerPoint und Visio | `--install-office` |

Ist ein Programm schon vorhanden, fragt das Skript nur, ob die Funktion eingeschaltet werden soll; fehlen
Tesseract einzelne Sprachdaten, bietet es das Nachinstallieren an. Die Pakete werden geladen, **bevor**
ein laufender Dienst angehalten wird; vorhandene Pakete entfernt das Skript dabei nie (`apt-get --no-remove`).

Die Zusatzprogramme sind keine Voraussetzung. Lässt sich eines nicht installieren oder eintragen (kein
Internetzugang, Paket nicht in der Paketquelle, Sprachdaten fehlen, LibreOffice nur als Snap), richtet das
Skript Knowstead ohne diese Funktion ein und nennt am Ende unter **Hinweise**, was offen blieb und wie es sich
nachholen lässt. Bricht die Einrichtung aus einem anderen Grund ab, nachdem der Dienst angehalten wurde,
startet das Skript den Dienst wieder – ein Update hinterlässt kein stehendes Knowstead.

**Nachrüsten** auf einer bestehenden Installation – die übrigen Einstellungen bleiben, wie sie sind:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-ocr --install-office
```

```bash
sudo bash install.sh --unattended --data-dir /var/lib/knowstead --base-url https://knowstead.firma.de --access local-proxy
```

Weitere Optionen zeigt `bash install.sh --help` (u. a. `--access remote-proxy --proxy-address 10.0.0.5`,
`--service none`, `--install-ocr`, `--install-office`, `--ocr-path`, `--office-path`, `--dry-run`,
`--uninstall`).

**Ersteinrichtung ohne Einrichtungscode** auf einem Server ohne Browser – über einen SSH-Tunnel vom
eigenen Rechner:

```bash
ssh -L 3000:127.0.0.1:3000 admin@knowstead-server
```

Danach im Browser `http://localhost:3000/setup` öffnen. Steuern mit `systemctl start|stop|restart|status knowstead`,
Protokoll mit `journalctl -u knowstead -f`.

### Proxmox VE (LXC-Container)

Knowstead läuft gut in einem unprivilegierten LXC-Container – ohne Docker und ohne eigene VM. `install.sh`
kommt mit den Besonderheiten eines Containers zurecht: Es läuft als root ohne `sudo`, installiert auf
Wunsch Node.js und prüft, welche Schutzoptionen für den Dienst verfügbar sind.

**1. Container anlegen** (*Create CT*):

| Einstellung | Empfehlung |
| --- | --- |
| Vorlage | `debian-12-standard` oder `debian-13-standard` (Ubuntu 24.04 geht ebenso) |
| Unprivileged container | ja |
| Nesting (*Options → Features*) | ja – bei neuen Containern meist voreingestellt; ohne Nesting läuft der Dienst ohne `PrivateTmp`/`ProtectSystem` |
| Kerne / Arbeitsspeicher | 2 / 2048 MB bis etwa 100 Personen, mit LibreOffice 4096 MB |
| Datenträger | ab 16 GB – Datenbank, Anhänge und Sicherungen liegen unter `/var/lib/knowstead` |
| Netzwerk | feste IP-Adresse oder DHCP-Reservierung, DNS-Name z. B. `knowstead.firma.de` |
| Start at boot (*Options*) | ja |

Wer die Daten getrennt vergrößern möchte, legt vor der Installation einen *Mount Point* mit dem Pfad
`/var/lib/knowstead` an. Für die Proxmox-Sicherung dort die Option *Backup* setzen.

**2. Programm in den Container bringen.** Alle Befehle in der Konsole des Containers (Proxmox-Oberfläche
→ Container → *Console* oder auf dem Host `pct enter <CT-ID>`):

```bash
apt update && apt install -y curl
```

```bash
cd /opt && curl -fLO https://github.com/BStein-coder/Knowstead/releases/download/v2.2.3/knowstead-2.2.3-linux-x64.tar.gz
```

Noch kein Release auf GitHub? Dann das Paket auf dem Windows-Rechner mit dem Programmordner bauen und
über den Proxmox-Host in den Container kopieren:

```powershell
cd D:\Knowstead
npm run build
node scripts/package.mjs --target linux-x64
scp release\knowstead-2.2.3-linux-x64.tar.gz root@proxmox:/tmp/
```

```bash
pct push <CT-ID> /tmp/knowstead-2.2.3-linux-x64.tar.gz /opt/knowstead-2.2.3-linux-x64.tar.gz
```

Das Paket enthält Oberfläche und Laufzeitbestandteile für Linux; Besitzer und Rechte stimmen auch, wenn
es unter Windows gebaut wurde. Danach im Container entpacken:

```bash
cd /opt && tar -xzf knowstead-2.2.3-linux-x64.tar.gz && mv knowstead-2.2.3-linux-x64 knowstead
```

**3. Installieren:**

```bash
cd /opt/knowstead && bash install.sh
```

Der Assistent fragt nach, ob Node.js 24 installiert werden soll, und danach dieselben Angaben wie auf
jedem Linux-Server. Für die Erreichbarkeit gibt es in Proxmox-Umgebungen meist zwei Wege:

| Aufbau | Auswahl im Assistenten | Einrichtung des Proxys |
| --- | --- | --- |
| Reverse-Proxy in einem anderen Container oder einer VM (Nginx Proxy Manager, Traefik, Caddy) | *Reverse-Proxy auf einem anderen Rechner* mit der IP-Adresse des Proxys | Ziel `http://<IP des Knowstead-Containers>:3000`; im Nginx Proxy Manager **Websockets Support** einschalten und für große Anhänge unter *Advanced* `client_max_body_size 2G;` eintragen |
| Caddy im selben Container | *Reverse-Proxy auf diesem Server* | `apt install -y caddy`, Caddyfile aus [Abschnitt 7.1](#71-caddy--die-einfachste-variante) nach `/etc/caddy/Caddyfile`, dann `systemctl reload caddy` |

**4. Ersteinrichtung:** die öffentliche Adresse im Browser öffnen, z. B. `https://knowstead.firma.de/setup`.
Den Einrichtungscode zeigt `journalctl -u knowstead | grep Einrichtungscode` in der Container-Konsole.

**Hinweise für den Betrieb:**

- **Zeitzone:** Container laufen oft in UTC. Die nächtliche Sicherung richtet sich nach der Zeitzone –
  prüfen mit `timedatectl`, ändern mit `timedatectl set-timezone Europe/Berlin` und `systemctl restart knowstead`.
- **Sicherung:** Die Proxmox-Sicherung (*Backup*) erfasst Programm und Daten. Knowstead legt zusätzlich
  eigene, in jedem Fall konsistente Sicherungen unter `/var/lib/knowstead/backups` an – sie sind damit auch
  in jeder Proxmox-Sicherung enthalten. Zum Wiederherstellen einzelner Stände `npm run cli -- restore`
  verwenden ([Abschnitt 10](#10-sicherung-einrichten-und-prüfen)).
- **Update:** vorher einen Snapshot anlegen (`pct snapshot <CT-ID> vor-update`, bei Speicher mit
  Snapshot-Unterstützung wie ZFS oder LVM-Thin), das neue Paket samt `.sha256`-Datei in den Container
  kopieren (`pct push <CT-ID> knowstead-<version>-linux-x64.tar.gz /tmp/knowstead-<version>-linux-x64.tar.gz`)
  und in der Container-Konsole `bash /opt/knowstead/update.sh /tmp/knowstead-<version>-linux-x64.tar.gz`
  ausführen – das Skript prüft, tauscht, startet und kontrolliert, und holt den bisherigen Stand
  zurück, wenn der neue nicht läuft ([Abschnitt 11](#11-updates-und-umzug); dort steht auch der Weg
  für Installationen vor 1.8.0, die das Skript noch nicht haben).
- Meldet `install.sh` „Schutzoptionen nicht verfügbar“, fehlt *Nesting*: einschalten, Container neu
  starten und `bash install.sh --unattended` erneut ausführen – danach stehen die Optionen wieder in
  der Dienstdatei.
- **Texterkennung und Office-Vorschau:** `bash install.sh --unattended --install-ocr --install-office`
  installiert Tesseract und LibreOffice im Container und schaltet beides ein. Für LibreOffice dem
  Container 4096 MB Arbeitsspeicher und rund 500 MB mehr Plattenplatz geben.

### Installation jederzeit prüfen

```bash
npm run cli -- doctor
```

prüft Node.js, gebaute Oberfläche, Datenverzeichnis (beschreibbar, freier Speicher, keine Netzfreigabe),
Port, Adresse und Proxy-Einstellung, Serverschlüssel, Datenbankstand, Ersteinrichtung und Sicherungen –
mit einem Hinweis, was zu tun ist. `--json` liefert das Ergebnis maschinenlesbar, der Rückgabewert ist
`1`, wenn ein Fehler gefunden wurde.

### Nach der Installation

Nach der Ersteinrichtung führt **Administration → Nächste Schritte** durch alles, was für den Betrieb
noch fehlt – mit Stand und direktem Sprung zur passenden Einstellung: HTTPS-Adresse, Autostart,
E-Mail-Versand, erste Sicherung, Personen einladen, ersten Bereich anlegen sowie optional Anmeldung mit
Firmenkonten (Active Directory, Entra ID, SAML) und Texterkennung/Office-Vorschau. Solange Punkte offen
sind, erinnert ein Hinweis in der Administrationsübersicht daran.

---

## 1. Überblick

Knowstead ist **ein einziger Node.js-Prozess**: Er liefert die Weboberfläche und die REST-API aus und
speichert alles in einer SQLite-Datenbank im Datenverzeichnis. Es gibt keinen separaten Datenbankserver,
keinen Cache-Dienst und keine Warteschlange.

```
 Browser ──HTTPS:443──▶ Reverse-Proxy ──HTTP──▶ Knowstead (Node.js, 127.0.0.1:3000) ──▶ Datenverzeichnis
                      (Caddy, nginx, IIS,                                           knowstead.db
                       Apache: Zertifikat)                                          uploads/  backups/
                                                                                    secret.key
 optional:  SMTP-Server · Active Directory/LDAP · LibreOffice (Office-Vorschau) · draw.io · KI-Anbieter
```

| Ordner | Inhalt | Sichern? |
| --- | --- | --- |
| **Programmordner** (z. B. `D:\Knowstead`, `/opt/knowstead`) | Programmdateien, `node_modules`, gebaute Oberfläche `web/dist`, `.env` | `.env` ja, Rest lässt sich neu installieren |
| **Datenverzeichnis** (z. B. `D:\KnowsteadDaten`, `/var/lib/knowstead`) | Datenbank, Anhänge, Sicherungen, Vorschauen, Serverschlüssel | **ja – das Wichtigste** |

> [!TIP]
> Das Datenverzeichnis gehört **außerhalb** des Programmordners (`DATA_DIR`). Dann lässt sich der
> Programmordner bei Updates gefahrlos ersetzen.

---

## 2. Voraussetzungen

### Software

| Komponente | Anforderung |
| --- | --- |
| Betriebssystem | Windows Server 2019/2022/2025 oder Windows 10/11 · Linux (z. B. Debian 12, Ubuntu 22.04/24.04, RHEL 9) · macOS (für Tests) · oder Docker |
| **Node.js** | **Version 24 oder neuer** (LTS empfohlen). Weitere Laufzeiten, Datenbanken oder Compiler sind nicht nötig. |
| Reverse-Proxy | für HTTPS: Caddy, nginx, IIS mit URL Rewrite und ARR, oder Apache ab 2.4.47 |
| Browser der Nutzenden | aktuelle Versionen von Edge, Chrome, Firefox oder Safari |
| Internetzugang bei der Installation | für `npm` (Paketquelle registry.npmjs.org) – ohne Internet siehe [Server ohne Internetzugang](#server-ohne-internetzugang) |

### Hardware

| Umfang | Server | Hinweis |
| --- | --- | --- |
| bis 100 Personen | 2 vCPU, 4 GB RAM, SSD | auch als VM neben anderen Diensten |
| bis 500 Personen | 4 vCPU, 8 GB RAM, SSD | eigene VM empfohlen |
| über 500 Personen | 8 vCPU, 16 GB RAM, NVMe-SSD | vorher mit `node scripts/loadtest.mjs` auf der Zielhardware prüfen |

- **Speicherplatz:** Datenbank und Anhänge, dazu die Sicherungen (je Stand eine Datenbankkopie und
  optional die Anhänge). Mit LibreOffice für die Office-Vorschau 1–2 GB RAM zusätzlich einplanen.
- Das Datenverzeichnis gehört auf eine **lokale SSD**, **nicht** auf eine Netzfreigabe (SMB/NFS) – SQLite
  braucht zuverlässige Dateisperren.

### Netzwerk

| Verbindung | Zweck |
| --- | --- |
| eingehend **443/TCP** (und 80 für die Weiterleitung) | Zugriff der Nutzenden über den Reverse-Proxy |
| intern **3000/TCP** | nur zwischen Proxy und Knowstead – nicht nach außen freigeben |
| ausgehend SMTP (25/465/587) | E-Mail-Versand (optional) |
| ausgehend LDAPS (636) bzw. LDAP (389) | Active Directory (optional) |
| ausgehend HTTPS | KI-Anbieter, Webhooks, API-Konnektoren, draw.io im Browser, Hinweis auf neue Versionen (`api.github.com`, nur auf Wunsch) (jeweils optional) |

Der Proxy muss **WebSockets** (gleichzeitiges Bearbeiten) und **Server-Sent Events** (Live-Aktualisierung)
durchreichen – die Beispielkonfigurationen in [Abschnitt 7](#7-https-und-reverse-proxy) erledigen das.

---

## 3. Vor der Installation festlegen

| Entscheidung | Beispiel | Hinweis |
| --- | --- | --- |
| Adresse (DNS-Name) | `https://knowstead.firma.de` | wird als `BASE_URL` eingetragen und steht in allen Links und E-Mails |
| TLS-Zertifikat | interne Zertifizierungsstelle, Let's Encrypt oder gekauft | Caddy kann öffentliche Zertifikate automatisch holen |
| Datenverzeichnis | `D:\KnowsteadDaten` bzw. `/var/lib/knowstead` | lokale SSD, außerhalb des Programmordners |
| Dienstkonto | lokales Konto `knowstead` | braucht Schreibrecht nur auf das Datenverzeichnis (und für Updates auf den Programmordner) |
| Serverschlüssel | `KNOWSTEAD_SECRET` **oder** automatisch erzeugte `secret.key` | verschlüsselt gespeicherte Zugangsdaten; **nach dem ersten Start nicht mehr wechseln** |
| E-Mail | SMTP-Server, Absender, ggf. Konto | für Passwort vergessen, Einladungen, Benachrichtigungen |
| Anmeldung | lokale Konten und/oder Active Directory | für AD: Dienstkonto mit Leserecht, LDAPS-Zertifikat |

**Serverschlüssel erzeugen** (falls `KNOWSTEAD_SECRET` genutzt werden soll – empfohlen für Docker und für
getrennte Aufbewahrung im Passwort-Tresor):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. Installation unter Windows

> [!TIP]
> Der [Installationsassistent](#windows) erledigt die Schritte 4.2 bis 4.6 automatisch. Diese Anleitung
> beschreibt sie von Hand – etwa für eigene Vorgaben oder zum Nachvollziehen.

Beispielpfade: Programm in `D:\Knowstead`, Daten in `D:\KnowsteadDaten`. Alle Befehle in einer
**PowerShell als Administrator**.

### 4.1 Node.js installieren

```powershell
winget install OpenJS.NodeJS.LTS
```

Alternativ den Installer von [nodejs.org](https://nodejs.org/) verwenden. Danach eine **neue**
PowerShell öffnen und prüfen:

```powershell
node --version    # v24.x oder neuer
```

### 4.2 Programm und Datenverzeichnis anlegen

1. Programmdateien nach `D:\Knowstead` entpacken bzw. kopieren (die Datei `package.json` liegt dann direkt in
   `D:\Knowstead`).
2. Datenverzeichnis anlegen:

   ```powershell
   New-Item -ItemType Directory -Force D:\KnowsteadDaten, D:\KnowsteadDaten\logs
   ```

### 4.3 Konfiguration

`D:\Knowstead\.env.example` nach `D:\Knowstead\.env` kopieren und anpassen – für den Betrieb hinter einem
Reverse-Proxy auf demselben Server:

```ini
PORT=3000
HOST=127.0.0.1
BASE_URL=https://knowstead.firma.de
TRUST_PROXY=loopback
COOKIE_SECURE=auto
DATA_DIR=D:\KnowsteadDaten
LOG_LEVEL=info
NODE_ENV=production
# KNOWSTEAD_SECRET=<64 Hex-Zeichen aus Abschnitt 3>
```

> [!WARNING]
> Windows-Pfade in der `.env` **ohne doppelte Anführungszeichen** schreiben (oder mit `/`). In
> doppelten Anführungszeichen wird `\n` als Zeilenumbruch gelesen – aus `"D:\KnowsteadDaten\neu"` würde ein
> ungültiger Pfad.

Läuft der Proxy auf einem **anderen** Rechner, `HOST=0.0.0.0` und `TRUST_PROXY=<IP des Proxys>` setzen und
Port 3000 in der Firewall nur für diesen Rechner öffnen.

### 4.4 Abhängigkeiten installieren, Oberfläche bauen, Probestart

```powershell
cd D:\Knowstead
node scripts\prepare.mjs     # installiert Abhängigkeiten und baut die Oberfläche (einige Minuten)
npm start                    # Probestart im Vordergrund
```

Im Protokoll erscheinen `Knowstead 2.2.3 läuft auf https://knowstead.firma.de` und – solange es noch kein Konto
gibt – der **Einrichtungscode**. Probestart mit `Strg`+`C` beenden. Die Ersteinrichtung folgt nach dem
Einrichten des Proxys ([Abschnitt 8](#8-ersteinrichtung-im-browser)).

> [!NOTE]
> Hinter einem Firmen-Proxy braucht `npm` dessen Adresse:
> `npm config set proxy http://proxy.firma.de:8080` und `npm config set https-proxy http://proxy.firma.de:8080`.
> Bricht TLS-Prüfung des Proxys die Verbindung ab: `npm config set cafile C:\Zertifikate\firma-ca.pem`.

### 4.5 Als Windows-Dienst einrichten (NSSM)

Knowstead läuft als Dienst mit dem kostenlosen Dienst-Wrapper [NSSM](https://nssm.cc/download). `nssm.exe`
(64 Bit) z. B. nach `C:\Tools\nssm\nssm.exe` kopieren, dann:

```powershell
$nssm = 'C:\Tools\nssm\nssm.exe'
& $nssm install Knowstead 'C:\Program Files\nodejs\node.exe' '--disable-warning=ExperimentalWarning server\src\index.ts'
& $nssm set Knowstead AppDirectory 'D:\Knowstead'
& $nssm set Knowstead DisplayName 'Knowstead – Dokumentation'
& $nssm set Knowstead Start SERVICE_AUTO_START
# Protokoll in Dateien mit Rotation (10 MB)
& $nssm set Knowstead AppStdout 'D:\KnowsteadDaten\logs\knowstead.log'
& $nssm set Knowstead AppStderr 'D:\KnowsteadDaten\logs\knowstead.log'
& $nssm set Knowstead AppRotateFiles 1
& $nssm set Knowstead AppRotateOnline 1
& $nssm set Knowstead AppRotateBytes 10485760
# Sauber beenden: Strg+C senden und bis zu 15 s warten (offene Bearbeitungsstände werden geschrieben)
& $nssm set Knowstead AppStopMethodConsole 15000
# Nach einem Fehlstart 5 s warten, bevor NSSM neu startet
& $nssm set Knowstead AppRestartDelay 5000
Start-Service Knowstead
```

Wichtig:

- Den Dienst **direkt mit `node`** starten (wie oben), nicht über `npm start` – nur so erreicht das
  Stoppsignal den Server.
- **Dienstkonto:** Standard ist „Lokales System“. Besser ein eigenes Konto verwenden
  (`& $nssm set Knowstead ObjectName '.\knowstead' '<Passwort>'`) und ihm Änderungsrechte auf das
  Datenverzeichnis geben:

  ```powershell
  icacls D:\KnowsteadDaten /grant 'knowstead:(OI)(CI)M'
  icacls D:\Knowstead /grant 'knowstead:(OI)(CI)RX'
  ```

- **Protokoll ansehen:** `Get-Content D:\KnowsteadDaten\logs\knowstead.log -Tail 50 -Wait`
- **Steuern:** `Start-Service Knowstead`, `Stop-Service Knowstead`, `Restart-Service Knowstead`

> [!NOTE]
> **Ohne NSSM:** Eine geplante Aufgabe „Beim Systemstart“ mit Programm `C:\Program Files\nodejs\node.exe`,
> Argumenten `--disable-warning=ExperimentalWarning server\src\index.ts` und Startverzeichnis `D:\Knowstead`
> funktioniert ebenfalls. Beim Beenden der Aufgabe wird der Prozess allerdings hart beendet; NSSM ist
> deshalb vorzuziehen.

### 4.6 Virenscanner und Firewall

```powershell
# Datenbankdateien vom Echtzeit-Scan ausnehmen (Anhänge unter uploads\ dürfen gescannt werden)
Add-MpPreference -ExclusionPath 'D:\KnowsteadDaten\knowstead.db','D:\KnowsteadDaten\knowstead.db-wal','D:\KnowsteadDaten\knowstead.db-shm'

# Nur nötig, wenn der Proxy auf einem anderen Rechner läuft:
New-NetFirewallRule -DisplayName 'Knowstead (nur Proxy)' -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 10.0.0.5 -Action Allow
```

Für andere Virenscanner die gleichen Ausnahmen setzen. Weiter mit [Abschnitt 7 (HTTPS)](#7-https-und-reverse-proxy) –
unter Windows passen [Caddy](#71-caddy--die-einfachste-variante) oder [IIS](#73-iis-windows-server).

---

## 5. Installation unter Linux

> [!TIP]
> Nach Abschnitt 5.1 erledigt [`install.sh`](#linux) die Schritte 5.2 bis 5.6 automatisch.

Beispiel für Debian/Ubuntu; Programm in `/opt/knowstead`, Daten in `/var/lib/knowstead`.

### 5.1 Node.js installieren

Über das Paketarchiv von NodeSource (Alternativen: Paketquelle der Distribution, sofern sie Node 24
liefert, oder die offiziellen Binärpakete von nodejs.org):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install -y nodejs
node --version    # v24.x oder neuer
```

### 5.2 Konto und Verzeichnisse

```bash
sudo useradd --system --home-dir /opt/knowstead --shell /usr/sbin/nologin knowstead
sudo mkdir -p /opt/knowstead /var/lib/knowstead
# Programmdateien nach /opt/knowstead kopieren bzw. entpacken, dann:
sudo chown -R knowstead:knowstead /opt/knowstead /var/lib/knowstead
sudo chmod 750 /var/lib/knowstead
```

### 5.3 Konfiguration

```bash
sudo -u knowstead cp /opt/knowstead/.env.example /opt/knowstead/.env
sudo -u knowstead nano /opt/knowstead/.env
sudo chmod 600 /opt/knowstead/.env
```

```ini
PORT=3000
HOST=127.0.0.1
BASE_URL=https://knowstead.firma.de
TRUST_PROXY=loopback
COOKIE_SECURE=auto
DATA_DIR=/var/lib/knowstead
LOG_LEVEL=info
NODE_ENV=production
# KNOWSTEAD_SECRET=<64 Hex-Zeichen aus Abschnitt 3>
# TZ=Europe/Berlin       # falls der Server in UTC läuft (Uhrzeit von Sicherung und Zusammenfassung)
```

### 5.4 Abhängigkeiten installieren, Oberfläche bauen, Probestart

```bash
cd /opt/knowstead
sudo -u knowstead node scripts/prepare.mjs
sudo -u knowstead npm start          # Probestart, beenden mit Strg+C
```

### 5.5 systemd-Dienst

`/etc/systemd/system/knowstead.service`:

```ini
[Unit]
Description=Knowstead – Dokumentation und Wissen
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=knowstead
Group=knowstead
WorkingDirectory=/opt/knowstead
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/src/index.ts
Environment=NODE_ENV=production
# Interne Zertifizierungsstelle für LDAPS/SMTP (siehe Abschnitt 9):
# Environment=NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/firma-ca.crt
Restart=always
RestartSec=5
# Genug Dateideskriptoren für viele Live-Verbindungen
LimitNOFILE=65536
# Offene Bearbeitungsstände vor dem Beenden schreiben lassen
TimeoutStopSec=20
# Härtung
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

In einem LXC-Container ohne *Nesting* startet der Dienst mit `PrivateTmp`/`ProtectSystem`/`ProtectHome`
nicht (`status=226/NAMESPACE`) – Nesting einschalten oder diese drei Zeilen weglassen.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now knowstead
sudo systemctl status knowstead
journalctl -u knowstead -f            # Protokoll verfolgen
```

Die `.env` im Programmordner liest Knowstead selbst; Werte aus der Dienstumgebung (`Environment=`) haben
Vorrang.

### 5.6 Firewall

```bash
sudo ufw allow 80,443/tcp        # Port 3000 bleibt geschlossen, der Proxy greift lokal zu
```

Weiter mit [Abschnitt 7 (HTTPS)](#7-https-und-reverse-proxy).

---

## 6. Installation mit Docker

Voraussetzung: Docker Engine mit Compose-Plugin (`docker compose version`).

```bash
cd /opt/knowstead                   # Programmordner mit Dockerfile und docker-compose.yml
cp .env.example .env
nano .env
```

In der `.env` für Docker mindestens:

```ini
BASE_URL=https://knowstead.firma.de
KNOWSTEAD_SECRET=<64 Hex-Zeichen aus Abschnitt 3>
# TZ=Europe/Berlin            # Vorgabe im Container; nur für andere Zeitzonen setzen
```

`DATA_DIR`, `HOST` und `PORT` im Container nicht ändern – das Datenverzeichnis ist das Volume
`knowstead-data` (`/app/data`), `TRUST_PROXY` steht auf `uniquelocal,loopback` (Proxy auf dem Host oder in
einem Container).

Läuft der Reverse-Proxy auf dem Docker-Host, den Port nur lokal veröffentlichen – in
`docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

Starten und Einrichtungscode anzeigen:

```bash
docker compose up -d --build
docker compose ps                                  # Status „healthy“ abwarten
docker compose logs knowstead | grep Einrichtungscode
```

| Aufgabe | Befehl |
| --- | --- |
| Protokoll | `docker compose logs -f knowstead` |
| Verwaltungswerkzeug | `docker compose exec knowstead node --disable-warning=ExperimentalWarning server/src/cli.ts status` |
| Update | `docker compose build --pull && docker compose up -d` |
| Sicherung nach außen kopieren | `docker compose cp knowstead:/app/data/backups ./knowstead-sicherungen` |

> [!NOTE]
> Das Container-Image enthält **kein LibreOffice** – die Office-Vorschau (Word, Excel, PowerPoint, Visio)
> steht im Container nicht zur Verfügung. Wer sie braucht, installiert Knowstead direkt auf dem Server
> oder erweitert das Image um LibreOffice.

---

## 7. HTTPS und Reverse-Proxy

Knowstead selbst spricht nur HTTP. HTTPS übernimmt ein Reverse-Proxy davor. Jede Proxy-Konfiguration muss:

1. **HTTPS** mit gültigem Zertifikat anbieten und HTTP auf HTTPS umleiten,
2. den **Host**-Header unverändert weitergeben sowie `X-Forwarded-For` und `X-Forwarded-Proto` setzen,
3. **WebSocket-Upgrades** für `/api/v1/collab/…` durchreichen (gleichzeitiges Bearbeiten),
4. **Server-Sent Events** (`/api/v1/stream`) **ungepuffert** und lange offen halten (Live-Aktualisierung),
5. **Uploads** bis zur eingestellten Grenze erlauben (Standard 50 MB je Anhang; Wiki-Importe bis 2 GB).

Passend dazu in der `.env`: `BASE_URL=https://…`, `TRUST_PROXY` auf die Adresse des Proxys (`loopback`
für denselben Rechner), `HOST=127.0.0.1` wenn der Proxy lokal läuft.

### 7.1 Caddy – die einfachste Variante

[Caddy](https://caddyserver.com/) (Windows und Linux) holt öffentliche Zertifikate selbst, leitet HTTP
auf HTTPS um und reicht WebSockets und Server-Sent Events ohne weitere Einstellungen durch.
`Caddyfile`:

```caddyfile
knowstead.firma.de {
    reverse_proxy 127.0.0.1:3000

    # Interne Zertifikate statt Let's Encrypt:
    # tls C:/Zertifikate/knowstead.pem C:/Zertifikate/knowstead-key.pem

    header Strict-Transport-Security "max-age=31536000"
    request_body {
        max_size 2GB
    }
}
```

Für automatische Zertifikate muss `knowstead.firma.de` öffentlich auflösbar und Port 80/443 aus dem Internet
erreichbar sein; im internen Netz ein Zertifikat der eigenen Zertifizierungsstelle mit `tls` angeben.

### 7.2 nginx

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name knowstead.firma.de;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name knowstead.firma.de;

  ssl_certificate     /etc/ssl/certs/knowstead.firma.de.pem;
  ssl_certificate_key /etc/ssl/private/knowstead.firma.de.key;
  add_header Strict-Transport-Security "max-age=31536000" always;

  client_max_body_size 2g;                         # Uploads und Wiki-Importe

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;          # WebSocket (gleichzeitiges Bearbeiten)
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;                             # Server-Sent Events sofort ausliefern
    proxy_read_timeout 1h;                           # lange offene Verbindungen nicht kappen
  }
}
```

Die Anweisung `http2 on;` gibt es ab nginx 1.25.1; ältere Versionen schreiben `listen 443 ssl http2;`.
Prüfen und laden: `sudo nginx -t && sudo systemctl reload nginx`.

### 7.3 IIS (Windows Server)

**Einmalig vorbereiten:**

1. Rolle und WebSocket-Unterstützung installieren:

   ```powershell
   Install-WindowsFeature Web-Server, Web-WebSockets -IncludeManagementTools
   ```

2. Von der Microsoft-Website **URL Rewrite 2.1** und **Application Request Routing (ARR) 3.0**
   installieren.
3. Proxy einschalten, Host-Header erhalten, Antwortpuffer abschalten (sonst kommen Live-Ereignisse
   verzögert an) und lange Verbindungen erlauben:

   ```powershell
   $appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
   & $appcmd set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /responseBufferLimit:"0" /timeout:"01:00:00" /commit:apphost
   # Server-Variable für X-Forwarded-Proto freigeben
   & $appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost
   ```

4. Eine Website `knowstead.firma.de` anlegen (leerer Ordner, z. B. `C:\inetpub\knowstead`) mit **HTTPS-Bindung**
   und Zertifikat.

**`web.config`** im Ordner der Website:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="HTTP auf HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="Knowstead" stopProcessing="true">
          <match url=".*" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
          <!-- UNENCODED_URL behält Sonderzeichen und Abfrage unverändert -->
          <action type="Rewrite" url="http://127.0.0.1:3000{UNENCODED_URL}" appendQueryString="false" />
        </rule>
      </rules>
    </rewrite>
    <!-- IIS soll nicht nachkomprimieren: Knowstead liefert vorkomprimiert aus, Live-Ereignisse nicht puffern -->
    <urlCompression doStaticCompression="false" doDynamicCompression="false" />
    <security>
      <requestFiltering allowDoubleEscaping="true">
        <requestLimits maxAllowedContentLength="2147483648" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

Für die Umleitung von HTTP auf HTTPS braucht die Website zusätzlich eine HTTP-Bindung (Port 80).
**HSTS** ab Windows Server 2019 im IIS-Manager unter *Website → HSTS* einschalten (`max-age` 31536000).
ARR ergänzt `X-Forwarded-For` von sich aus. In der `.env` passt `TRUST_PROXY=loopback`.

> [!IMPORTANT]
> Fehlt die Funktion **WebSocket-Protokoll**, funktioniert Knowstead trotzdem – der Editor arbeitet dann nach
> wenigen Sekunden ohne gemeinsame Bearbeitung mit persönlichen Entwürfen. „Live“ im Editor zeigt, dass
> WebSockets ankommen.

### 7.4 Apache (ab 2.4.47)

```apache
# a2enmod ssl proxy proxy_http headers
<VirtualHost *:80>
  ServerName knowstead.firma.de
  Redirect permanent / https://knowstead.firma.de/
</VirtualHost>

<VirtualHost *:443>
  ServerName knowstead.firma.de
  SSLEngine on
  SSLCertificateFile    /etc/ssl/certs/knowstead.firma.de.pem
  SSLCertificateKeyFile /etc/ssl/private/knowstead.firma.de.key
  Header always set Strict-Transport-Security "max-age=31536000"

  ProxyPreserveHost On
  RequestHeader set X-Forwarded-Proto "https"
  LimitRequestBody 0
  # upgrade=websocket: gleichzeitiges Bearbeiten · flushpackets=on: Live-Ereignisse sofort
  ProxyPass        / http://127.0.0.1:3000/ upgrade=websocket flushpackets=on timeout=3600
  ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

### 7.5 Proxy prüfen

```bash
curl https://knowstead.firma.de/api/v1/health                   # {"status":"ok","version":"2.2.3",…}
curl -s -o /dev/null -D - https://knowstead.firma.de/login      # 200, u. a. content-security-policy, strict-transport-security
```

Unter Windows: `Invoke-RestMethod https://knowstead.firma.de/api/v1/health` bzw.
`(Invoke-WebRequest https://knowstead.firma.de/login).Headers`.

Im Browser nach der Einrichtung: Seite bearbeiten → oben erscheint **„Live“** (WebSocket funktioniert);
eine Änderung in einem zweiten Fenster erscheint ohne Neuladen (Server-Sent Events funktionieren).

---

## 8. Ersteinrichtung im Browser

1. `https://knowstead.firma.de` öffnen – ohne Konten leitet Knowstead zum Einrichtungsassistenten `/setup`.
2. **Einrichtungscode** eingeben. Er schützt einen frisch gestarteten Server davor, von jemand anderem
   zuerst eingerichtet zu werden, und steht im Protokoll:

   | Installation | Code finden |
   | --- | --- |
   | Windows-Dienst (NSSM) | `Select-String -Path D:\KnowsteadDaten\logs\knowstead.log -Pattern Einrichtungscode` |
   | Linux (systemd) | `journalctl -u knowstead \| grep Einrichtungscode` |
   | Docker | `docker compose logs knowstead \| grep Einrichtungscode` |
   | Probestart im Fenster | steht direkt in der Ausgabe |

   Direkt auf dem Server unter `http://localhost:3000/setup` aufgerufen, ist kein Code nötig.
3. **Grunddaten:** Name der Installation, Sprache, Akzentfarbe, optional Beispielinhalte.
4. **Administratorkonto:** Anzeigename, Benutzername, E-Mail-Adresse, starkes Passwort.
5. **Fertig:** Knowstead legt die Gruppen *Administratoren* und *Benutzer*, den Bereich **Handbuch** und
   13 Vorlagen an.

**Danach in dieser Reihenfolge:**

1. **Administration → Einstellungen:** Selbstregistrierung (Standard: aus), Passwortregeln,
   Upload-Grenze, Aufbewahrungsfristen, anonymer Lesezugriff (Standard: aus).
2. **Administration → Einstellungen → Sicherungen:** Uhrzeit, Anzahl, Anhänge einschließen
   ([Abschnitt 10](#10-sicherung-einrichten-und-prüfen)).
3. **Administration → E-Mail** ([Abschnitt 9.1](#91-e-mail-smtp)).
4. **Administration → Verzeichnis** für Active Directory ([Abschnitt 9.2](#92-active-directory--ldap)).
5. **Gruppen und Bereiche** anlegen, Bereichsrollen vergeben, Personen einladen.

---

## 9. Optionale Anbindungen

### 9.1 E-Mail (SMTP)

**Administration → E-Mail:** Vorlage wählen (Microsoft 365, Exchange, Google Workspace, IONOS, STRATO),
Absender und Zugangsdaten eintragen, **Verbindung prüfen** und **Test-E-Mail** senden, dann
„Benachrichtigungen per E-Mail versenden“ einschalten. Das Passwort wird verschlüsselt gespeichert.

- **Microsoft 365** erlaubt die Anmeldung per Benutzername/Passwort oft nicht mehr – dann die Vorlage
  „Relay über Connector“ nutzen (Connector im Exchange Admin Center für die feste öffentliche IP des
  Servers).
- Ausführlich: [Administrationshandbuch → E-Mail](ADMINISTRATION.md#e-mail).

### 9.2 Active Directory / LDAP

**Administration → Verzeichnis (AD/LDAP):**

1. Server `ldaps://dc01.firma.local:636`, Basis-DN `DC=firma,DC=local`, Dienstkonto mit Leserecht.
2. **Verbindung prüfen** – optional mit einem Testkonto.
3. AD-Sicherheitsgruppen den Knowstead-Gruppen zuordnen (Administration → Gruppen).
4. **„Lokale Anmeldung zusätzlich erlauben“ eingeschaltet lassen** – sonst sperrt eine Störung im
   Verzeichnis alle aus.

> [!IMPORTANT]
> **Zertifikat der internen Zertifizierungsstelle:** Node.js vertraut standardmäßig nur öffentlichen
> Zertifizierungsstellen. Meldet die Prüfung `unable to verify the first certificate` oder
> `self-signed certificate in certificate chain`, das CA-Zertifikat bekannt machen – **nicht** die
> Zertifikatsprüfung abschalten:
>
> - **Linux:** `Environment=NODE_EXTRA_CA_CERTS=/pfad/firma-ca.pem` im systemd-Dienst.
> - **Windows:** im NSSM-Dienst `--use-system-ca` vor die übrigen Argumente setzen – dann gilt der
>   Zertifikatspeicher von Windows (per Gruppenrichlinie verteilte Stammzertifikate):
>   `& $nssm set Knowstead AppParameters '--use-system-ca --disable-warning=ExperimentalWarning server\src\index.ts'`.
>   Alternativ `& $nssm set Knowstead AppEnvironmentExtra 'NODE_EXTRA_CA_CERTS=C:\Zertifikate\firma-ca.pem'`.
> - **Docker:** CA-Datei einhängen und `NODE_EXTRA_CA_CERTS` im Abschnitt `environment` setzen.
>
> Diese Variablen wirken nur beim Prozessstart und gehören deshalb in die Dienstumgebung, nicht in die
> `.env`. Dasselbe gilt für SMTP-Server mit internem Zertifikat.

Ausführlich: [Administrationshandbuch → Active Directory](ADMINISTRATION.md#active-directory--ldap).

### 9.3 Office- und Visio-Vorschau (LibreOffice)

Am einfachsten über den Installationsassistenten – er installiert LibreOffice und schaltet die Vorschau ein:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-office      # Linux
```

```powershell
.\Knowstead-Installation.cmd -Unattended -InstallLibreOffice                 # Windows (winget)
```

Von Hand unter Debian und Ubuntu – ohne grafische Oberfläche, mit Schriften für einen stimmigen Umbruch:

```bash
sudo apt install --no-install-recommends libreoffice-core-nogui libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea
```

Unter Windows den LibreOffice-Installer verwenden (gefunden wird
`C:\Program Files\LibreOffice\program\soffice.exe`). Danach **Administration → KI & Dateien →
Office-Vorschau** aktivieren; die Statusanzeige meldet, ob LibreOffice gefunden wurde.

### 9.4 Single Sign-on (Microsoft Entra ID, SAML, Windows-Anmeldung)

**Administration → Single Sign-on** – Voraussetzung ist die HTTPS-Adresse in `BASE_URL`.

- **Entra ID**: App-Registrierung (Plattform *Web*) mit Umleitungs-URI
  `https://knowstead.firma.de/api/v1/auth/oidc/callback`, geheimer Clientschlüssel, Gruppenanspruch
  (Gruppen-IDs). In Knowstead Mandanten-ID, Client-ID und Schlüssel eintragen, prüfen, aktivieren; Objekt-IDs
  der Entra-Gruppen bei den Knowstead-Gruppen eintragen.
- **SAML**: Metadaten `https://knowstead.firma.de/api/v1/auth/saml/metadata` beim Anbieter importieren,
  Anmelde-URL, Entity-ID und Signaturzertifikat des Anbieters in Knowstead eintragen.
- **Windows-Anmeldung**: Der Reverse-Proxy (Apache mit `mod_auth_gssapi` oder IIS mit
  Windows-Authentifizierung) schützt nur `/api/v1/auth/kerberos` und reicht das Konto in `X-Remote-User`
  weiter; in Knowstead die Adresse des Proxys und ein gemeinsames Geheimnis eintragen.

Ausführlich mit Beispielkonfigurationen:
[Administrationshandbuch → Single Sign-on](ADMINISTRATION.md#single-sign-on-entra-id-saml-und-windows-anmeldung).

### 9.5 Texterkennung für Scans (Tesseract)

Am einfachsten über den Installationsassistenten – er installiert Tesseract mit den Sprachdaten, prüft,
welche Sprachen wirklich vorhanden sind, und schaltet die Texterkennung ein:

```bash
cd /opt/knowstead && sudo bash install.sh --unattended --install-ocr                              # Linux
cd /opt/knowstead && sudo bash install.sh --unattended --install-ocr --ocr-languages deu+eng+fra  # mit Französisch
```

```powershell
.\Knowstead-Installation.cmd -Unattended -InstallTesseract                    # Windows (winget)
```

> [!NOTE]
> Tesseract bricht bei einer einzigen fehlenden Sprache ganz ab. Der Assistent trägt deshalb nur Sprachen
> ein, deren Daten vorhanden sind, und meldet die übrigen. Unter Windows bringt das Installationsprogramm
> ohne Auswahl nur Englisch mit – der Assistent lädt die fehlenden Sprachdaten aus dem Tesseract-Projekt
> (`github.com/tesseract-ocr/tessdata_fast`) nach.

Von Hand:

```bash
# Debian/Ubuntu
sudo apt install tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng
```

Unter Windows den Tesseract-Installer (UB Mannheim) mit den Sprachdaten „German“ verwenden. Danach
**Administration → KI & Dateien → Texterkennung** aktivieren; vorhandene Scans werden im Hintergrund
nachträglich erkannt. Im Docker-Image lässt sich Tesseract über das Build-Argument `WITH_OCR=true`
mitinstallieren.

### 9.6 Weitere

- **draw.io** läuft standardmäßig im Browser von `embed.diagrams.net`; für Netze ohne Internet selbst
  betreiben ([Administrationshandbuch → draw.io](ADMINISTRATION.md#drawio)).
- **KI-Assistent** (Claude, OpenAI, Azure OpenAI, Ollama): nur nach Abstimmung mit dem Datenschutz
  einschalten ([Administrationshandbuch → KI-Anbindung](ADMINISTRATION.md#ki-anbindung)).
- **Warnungen und Überwachung**: Knowstead schreibt der Administration eine E-Mail, wenn die Sicherung
  ausbleibt, der Speicherplatz knapp wird oder nach einem Update der Neustart fehlt, und liefert
  denselben Stand für Überwachungssysteme unter `/api/v1/monitoring`
  ([Administrationshandbuch → Warnungen und Überwachung](ADMINISTRATION.md#warnungen-und-überwachung)).

---

## 10. Sicherung einrichten und prüfen

Knowstead sichert standardmäßig **jede Nacht um 3 Uhr** (Serverzeit) und behält sieben Stände, zusätzlich
automatisch vor jedem Update mit Datenbankänderungen und vor dem Löschen eines Bereichs. Die
Sicherungen liegen im Datenverzeichnis unter `backups/`.

1. **Administration → Einstellungen → Sicherungen:** Uhrzeit, Anzahl und „Anhänge in Sicherungen
   einschließen“ festlegen. Danach unter **Administration → Sicherungen** einmal **„Jetzt sichern“**.
2. **Externe Kopie:** den Ordner `backups/` regelmäßig auf ein anderes System übertragen (Backup-Software,
   Robocopy, rsync). Die Datenbank selbst nur bei **gestopptem** Dienst kopieren.
3. **Serverschlüssel getrennt aufbewahren:** `secret.key` aus dem Datenverzeichnis bzw. `KNOWSTEAD_SECRET` in
   den Passwort-Tresor. Sicherungen enthalten ihn absichtlich nicht – ohne ihn sind gespeicherte
   Zugangsdaten (SMTP, AD-Dienstkonto, Konnektoren) nicht mehr lesbar.
4. **Wiederherstellung einmal proben** – am besten auf einer Testmaschine:

   ```bash
   npm run cli -- backup:list
   npm run cli -- restore backup-JJJJMMTT-HHMMSS-auto --with-uploads   # nur bei gestopptem Dienst
   ```

Ausführlich: [Administrationshandbuch → Sicherungen](ADMINISTRATION.md#sicherungen).

---

## 11. Updates und Umzug

### Update

Updates verlieren keine Daten: Vor Datenbankänderungen legt Knowstead selbst eine Sicherung an, alle
Migrationen laufen in einer Transaktion, eine ältere Version startet nie auf einer neueren Datenbank.

**Mit einem Befehl (Linux, ab 1.8.0):** Jedes Installationspaket bringt `update.sh` mit. Paket und
`.sha256`-Datei auf den Server kopieren, dann:

```bash
sudo bash /opt/knowstead/update.sh /tmp/knowstead-2.2.3-linux-x64.tar.gz
```

| Schritt | Was geschieht |
| --- | --- |
| Prüfen | Prüfsumme gegen die `.sha256`-Datei neben dem Paket (oder `--sha256 <wert>`), Architektur und Node.js-Version. Stimmt etwas nicht, wird nichts angefasst. |
| Bereitlegen | Das neue Programm wird neben das alte gelegt – Knowstead läuft dabei weiter. `.env` (mit Eigentümer und Rechten) und eigene Plugins werden übernommen. |
| Tauschen | Dienst anhalten, bisherigen Ordner nach `/opt/knowstead.vor-<version>` schieben, neuen an seine Stelle, Dienst starten. Ein Datenverzeichnis im Programmordner zieht mit um. |
| Kontrollieren | Der Server muss laufen, auf seinem Port antworten und mit dem neuen Stand arbeiten (`doctor`, bis zu 120 Sekunden – `--wait`). |
| Sonst zurück | Antwortet der neue Stand nicht, kommt der bisherige Ordner zurück und startet. Hatte der neue Stand die Datenbank schon umgestellt, spielt das Skript die Sicherung `backup-…-update` dieses Updates zurück. Der gescheiterte Stand bleibt als `/opt/knowstead.fehlgeschlagen-<zeit>` zur Fehlersuche liegen. |
| Aufräumen | Handbuch ergänzen, frühere Programmordner bis auf die letzten zwei entfernen (`--keep`). |

- **Erstes Update mit dem Skript** – Installationen vor 1.8.0 haben noch kein `update.sh`: Paket
  entpacken und das Skript daraus starten. Es findet die Installation über den Dienst-Eintrag (sonst `--target /opt/knowstead`):

  ```bash
  cd /tmp && tar -xzf knowstead-2.2.3-linux-x64.tar.gz
  sudo bash /tmp/knowstead-2.2.3-linux-x64/update.sh
  ```

- **Installation aus der Zeit, als Knowstead noch „Doku“ hieß (bis 1.9):** Dienst, Konto, Ordner und
  Datenbank behalten ihre Namen – getauscht wird nur das Programm. Das installierte Skript nimmt das neue
  Paket an und findet den Dienst `doku` selbst:

  ```bash
  sudo bash /opt/doku/update.sh /tmp/knowstead-2.2.3-linux-x64.tar.gz
  ```

  Wo diese Anleitung `/opt/knowstead`, `/var/lib/knowstead` oder den Dienst `knowstead` nennt, heißt es bei
  einer solchen Installation weiter `/opt/doku`, `/var/lib/doku` und `doku` (`systemctl status doku`,
  `journalctl -u doku`). Einträge mit `DOKU_` in der `.env`, bestehende Anmeldungen, API-Tokens mit `doku_`
  und die Kopfzeilen `X-Doku-…` gelten weiter; was sich für eigene Skripte ändert, steht im
  [Änderungsprotokoll zu 2.0.0](../CHANGELOG.md).
- **Probelauf:** `bash update.sh <paket> --dry-run` zeigt die Schritte, ohne etwas zu verändern.
- **Zurück zum Stand davor:** `sudo bash /opt/knowstead/update.sh --rollback` holt den zuletzt aufbewahrten
  Programmordner zurück. Hat das Update die Datenbank umgestellt, sagt das Skript das **vor** der
  Rückfrage: Der frühere Stand braucht dann die Datenbank von vor dem Update – sie wird aus
  `backup-…-update` zurückgespielt, und was seither eingetragen wurde, steht nur noch in der Sicherung
  `backup-…-restore`, die dabei entsteht. Fehlt die Sicherung vom Update, lehnt das Skript ab, bevor es
  etwas anfasst.
- **Ohne Rückfrage** (Skript, Ansible): `--yes`. Alle Optionen zeigt `bash update.sh --help`
  (`--target`, `--sha256`, `--keep`, `--wait`, `--no-handbook`, `--force`).
- Eigene Dateien im Programmordner, die das Paket nicht kennt, wandern nicht stillschweigend mit: Das
  Skript nennt sie am Ende, sie liegen im aufbewahrten Ordner.
- Die Kommandozeile von Knowstead läuft dabei unter dem **Dienstkonto** (dem das Datenverzeichnis gehört),
  nicht als root – Sicherungen und eine zurückgespielte Datenbank gehören so dem Dienst.
- Bricht die SSH-Verbindung ab, läuft das Update zu Ende. `Strg`+`C` bricht ab; war der Ordner schon
  getauscht, kommt der bisherige Stand zurück.
- In Containern ohne `sudo` (Proxmox) als root ohne `sudo` aufrufen.

Ohne systemd-Dienst (Start über `start.sh`) tauscht das Skript nur die Ordner und bittet darum, Knowstead
selbst zu starten. Unter **Windows** und für Installationen aus dem Quelltext gilt der Weg mit dem
Assistenten bzw. von Hand.

**Mit dem Assistenten:**

1. Versionshinweise lesen (`CHANGELOG.md`, Abschnitt „Update-Hinweise“).
2. Knowstead beenden: `Knowstead-Dienst.cmd stop` bzw. `sudo systemctl stop knowstead`.
3. Neues Installationspaket über den Programmordner entpacken – `.env` und Datenverzeichnis bleiben
   unberührt.
4. `Knowstead-Installation.cmd -Unattended` bzw. `sudo bash install.sh --unattended` – übernimmt alle
   bisherigen Angaben, prüft, startet Knowstead und kontrolliert die Erreichbarkeit.
5. **Administration → Wartung → Handbuch aktualisieren.**

**Ist das Update angekommen?** Die Versionsnummer allein verrät es nicht, wenn zwei Pakete dieselbe
Version tragen. Verlässlich sind:

```bash
npm run cli -- status
```

Die erste Zeile nennt Version und **Bauzeitpunkt des Pakets** – er muss zum eingespielten Paket passen.
Läuft der Server noch mit dem alten Stand, weil der Dienst nach dem Einspielen nicht neu gestartet wurde,
steht darunter ein **ACHTUNG** mit dem Befehl für den Neustart; *Administration → Übersicht* zeigt in dem
Fall **Neustart erforderlich**.
Dieselbe Angabe steht in **Administration → Übersicht** unter *Paket gebaut am* sowie in
`npm run cli -- doctor`. Vor dem Entpacken lohnt sich der Abgleich der Prüfsumme (`sha256sum` bzw.
`Get-FileHash`) mit der `.sha256`-Datei des Pakets – dann ist ausgeschlossen, dass versehentlich ein
älteres Archiv gleichen Namens eingespielt wird.

**Von Hand:**

1. Versionshinweise lesen (`CHANGELOG.md`, Abschnitt „Update-Hinweise“).
2. `npm run cli -- status` – Version, Datenbankstand, letzte Sicherung.
3. Dienst stoppen (`npm run cli -- stop`, `Stop-Service Knowstead` bzw. `sudo systemctl stop knowstead`).
4. Neue Programmdateien über den Programmordner kopieren – `.env` bleibt erhalten.
5. `node scripts/prepare.mjs` (unter Linux als `sudo -u knowstead …`) – installiert geänderte Abhängigkeiten
   und baut die Oberfläche neu.
6. Dienst starten (lief er noch: **neu** starten – `sudo systemctl restart knowstead`), dann
   `npm run cli -- doctor` und Protokoll prüfen. Einen beiseitegelegten alten Programmordner erst
   danach löschen.
7. **Administration → Wartung → Handbuch aktualisieren.**

Docker: `docker compose build --pull && docker compose up -d`. Rückkehr zur Vorversion und Einzelheiten:
[Administrationshandbuch → Aktualisierung](ADMINISTRATION.md#aktualisierung).

### Umzug auf einen neuen Server

1. Knowstead auf dem neuen Server wie oben installieren, aber **nicht** einrichten.
2. Alten Dienst stoppen.
3. Das komplette **Datenverzeichnis** kopieren (inklusive `secret.key`) bzw. dasselbe `KNOWSTEAD_SECRET`
   verwenden; die `.env` übernehmen und Pfade anpassen.
4. Neuen Dienst starten – ist die neue Programmversion neuer, migriert der Start die Datenbank
   automatisch (mit Sicherung vorab).
5. DNS bzw. Proxy auf den neuen Server umstellen.

### Server ohne Internetzugang

Am einfachsten mit dem **Installationspaket** für das Betriebssystem des Servers: Es enthält Oberfläche
und Abhängigkeiten, der Assistent braucht keinen Internetzugang (Node.js muss installiert sein).

Das Paket lässt sich auf jedem Rechner mit Internetzugang bauen – auch für ein anderes Betriebssystem,
z. B. unter Windows für Linux: `npm run build` und `node scripts/package.mjs --target linux-x64`.

Ohne Paket: auf einem Rechner **mit demselben Betriebssystem** und Internetzugang den Programmordner
vorbereiten (`node scripts/prepare.mjs`), dann den gesamten Ordner einschließlich `node_modules` und
`web/dist` auf den Zielserver kopieren. `prepare.mjs` erkennt dort, dass nichts mehr zu tun ist.

---

## 12. Prüfliste nach der Installation

- [ ] `https://knowstead.firma.de` lädt mit gültigem Zertifikat, `http://` leitet auf `https://` um
- [ ] `BASE_URL` stimmt mit der Adresse im Browser überein; Links in E-Mails führen dorthin
- [ ] Port 3000 ist von außen **nicht** erreichbar (`HOST=127.0.0.1` oder Firewall)
- [ ] `TRUST_PROXY` enthält nur die Adresse des Proxys (nicht `true`, wenn der Port anders erreichbar ist)
- [ ] Anmelden, Abmelden und erneut anmelden funktionieren (Sitzungs-Cookie mit `Secure`)
- [ ] Beim Bearbeiten erscheint **„Live“**; Änderungen erscheinen in einem zweiten Fenster ohne Neuladen
- [ ] Dienst startet nach einem Neustart des Servers von selbst
- [ ] Datenverzeichnis auf lokaler SSD, außerhalb des Programmordners, Virenscanner-Ausnahmen gesetzt
- [ ] `secret.key` bzw. `KNOWSTEAD_SECRET` getrennt im Passwort-Tresor
- [ ] Nächtliche Sicherung aktiv, externe Kopie eingerichtet, Wiederherstellung einmal geprobt
- [ ] Test-E-Mail angekommen; „Passwort vergessen“ funktioniert
- [ ] Testwarnung angekommen (Administration → Einstellungen → Warnungen an die Administration)
- [ ] AD-Anmeldung mit Testkonto erfolgreich, lokales Notfall-Administratorkonto vorhanden
- [ ] Selbstregistrierung und anonymer Lesezugriff bewusst ein- oder ausgeschaltet
- [ ] Recht `admin` nur wenigen Personen
- [ ] Zeitzone des Servers stimmt (Uhrzeit der Sicherung, Datumsangaben in Exporten)

Die ausführliche Liste für den Dauerbetrieb steht im
[Administrationshandbuch](ADMINISTRATION.md#checkliste-für-den-produktivbetrieb).

---

## 13. Fehlersuche bei der Installation

Erster Schritt bei jedem Problem: `npm run cli -- doctor` im Programmordner – die Prüfung nennt
Ursache und Abhilfe für die häufigsten Fälle.

| Symptom | Ursache und Lösung |
| --- | --- |
| Windows warnt beim Doppelklick „Herausgeber konnte nicht verifiziert werden“ bzw. SmartScreen | das Paket ist nicht signiert und stammt aus dem Internet – vorher die Prüfsumme vergleichen, dann *Ausführen* bzw. *Weitere Informationen → Trotzdem ausführen*; alternativ vor dem Entpacken in den Eigenschaften der ZIP-Datei *Zulassen* ankreuzen |
| Assistent: „Administratorrechte wurden nicht erteilt“ | Rückfrage der Benutzerkontensteuerung bestätigen oder `Knowstead-Installation.cmd` per Rechtsklick „Als Administrator ausführen“ |
| Assistent: „Der Probestart ist fehlgeschlagen“ | die letzten Protokollzeilen stehen im Fenster; häufig belegter Port oder fehlende Rechte auf das Datenverzeichnis |
| Geplante Aufgabe läuft, Knowstead antwortet nicht | `Knowstead-Dienst.cmd status` und `Knowstead-Dienst.cmd log`; im Protokoll steht der Grund (z. B. Datenbank von neuerer Version) |
| `systemctl stop knowstead` dauert 20 Sekunden, `journalctl -u knowstead` zeigt `State 'stop-sigterm' timed out. Killing` | früher Programmstand (Pakete von 1.6.0 aus den ersten Tagen): Der Server wartete beim Beenden auf offene Live-Verbindungen der Browser. Aktuelles Paket einspielen – seit 1.7.0 trennt Knowstead sie selbst und beendet sich spätestens nach 8 Sekunden. Die Datenbank nimmt durch den harten Abbruch keinen Schaden |
| Export meldet `Export-Worker: ENOENT: process.cwd failed … uv_cwd`; Sicherung oder Textsuche in Anhängen bleiben aus | der Programmordner wurde bei einem Update ersetzt und der alte gelöscht, **ohne den Dienst neu zu starten** – der Server läuft noch mit dem alten Stand aus dem Arbeitsspeicher. Dienst neu starten (`sudo systemctl restart knowstead` bzw. `Knowstead-Dienst.cmd restart`). Ab 1.7.0 arbeitet der Server in diesem Fall weiter und meldet **Neustart erforderlich** in *Administration → Übersicht* sowie in `npm run cli -- status` |
| *Administration → Übersicht* zeigt **Neustart erforderlich**, `npm run cli -- status` meldet „Der laufende Server arbeitet noch mit …“ | Update eingespielt, Dienst aber nicht neu gestartet (`systemctl start` wirkt nicht auf einen laufenden Dienst) – `sudo systemctl restart knowstead` bzw. `Knowstead-Dienst.cmd restart` |
| `update.sh`: „Der neue Stand läuft nicht – der bisherige kommt zurück“ | der neue Server ist nicht gestartet oder antwortet nicht. Die Prüfung (`doctor`) des neuen Stands steht direkt darüber in der Ausgabe, der Grund im Protokoll (`journalctl -u knowstead -n 80`). Der gescheiterte Stand liegt in `/opt/knowstead.fehlgeschlagen-<zeit>`; das nächste gelungene Update räumt ihn weg. Braucht der Start nur länger (sehr große Datenbank), mit `--wait 600` wiederholen |
| `update.sh`: „Die Prüfsumme stimmt nicht“ | Paket unvollständig übertragen, oder daneben liegt die `.sha256`-Datei eines anderen Pakets – beides erneut kopieren |
| `update.sh`: „… ist keine Knowstead-Installation“ | das Skript hat den Programmordner nicht gefunden (kein Dienst-Eintrag `knowstead.service`, anderer Ort) – mit `--target <ordner>` angeben |
| `journalctl -u knowstead` zeigt `status=226/NAMESPACE` | LXC-Container ohne *Nesting*: in Proxmox einschalten (*Options → Features*), Container neu starten; `install.sh` erkennt das und richtet den Dienst sonst ohne diese Schutzoptionen ein |
| `bash: $'\r': command not found` beim Start von `install.sh` | die Datei hat Windows-Zeilenenden, z. B. nach dem Kopieren einzelner Dateien über ein Windows-Programm – das Installationspaket verwenden oder `sed -i 's/\r$//' install.sh` |
| `install.sh`: „Das Konto knowstead kann den Programmordner nicht lesen“ | Programm liegt z. B. in einem Home-Verzeichnis – nach `/opt/knowstead` verschieben und dort erneut ausführen |
| „Node.js … ist zu alt – benötigt wird Version 24“ | Node.js 24 oder neuer installieren, neue Konsole öffnen, `node --version` prüfen |
| `npm ci` bricht mit Netzwerk- oder Zertifikatsfehler ab | Firmen-Proxy: `npm config set proxy …` / `https-proxy …`; TLS-Prüfung des Proxys: `npm config set cafile <CA-Datei>` |
| „Die Weboberfläche wurde noch nicht gebaut“ | `node scripts/prepare.mjs` bzw. `npm run build` im Programmordner ausführen |
| `EADDRINUSE` – Port belegt | anderer Dienst auf Port 3000: `PORT` in der `.env` ändern und Proxy anpassen |
| `EACCES`/„Zugriff verweigert“ auf das Datenverzeichnis | Dienstkonto braucht Schreibrecht (`icacls` bzw. `chown knowstead:knowstead`) |
| „Datenbank wird bereits von einem laufenden Knowstead-Server verwendet“ | ein zweiter Prozess läuft (Probestart noch offen, alter Dienst) – beenden |
| „Serverschlüssel passt nicht“ | `KNOWSTEAD_SECRET` nach dem ersten Start gesetzt oder geändert – den ursprünglichen Schlüssel wieder verwenden |
| 502 Bad Gateway vom Proxy | Knowstead läuft nicht oder hört auf einer anderen Adresse: Dienststatus, `HOST`/`PORT`, Protokoll prüfen |
| Seite bleibt weiß oder zeigt „Das dauert ungewöhnlich lange“ | Programmdateien unter `/assets/` werden blockiert (Proxy, Webfilter) oder der Browser ist veraltet – F12 → Netzwerk |
| Anmeldung scheint zu klappen, man ist aber sofort abgemeldet | `COOKIE_SECURE=true` bei Aufruf über `http://` – HTTPS verwenden oder `COOKIE_SECURE=auto` |
| Links in E-Mails zeigen auf `localhost` | `BASE_URL` in der `.env` setzen, Dienst neu starten |
| Einrichtung fragt nach dem Code, Protokoll zeigt keinen | es existiert schon ein Konto (Code nur ohne Konten); sonst `LOG_LEVEL=info` prüfen |
| Einrichtung fragt über den Proxy **nicht** nach dem Code | Proxy auf demselben Rechner sendet kein `X-Forwarded-For` – Konfiguration aus Abschnitt 7 übernehmen |
| Kein „Live“ im Editor | WebSocket-Upgrade fehlt: nginx `Upgrade`/`Connection`-Header, IIS-Funktion „WebSocket-Protokoll“, Apache `upgrade=websocket` |
| Benachrichtigungen erscheinen erst nach Neuladen | Proxy puffert Server-Sent Events: nginx `proxy_buffering off`, IIS `responseBufferLimit=0`, Apache `flushpackets=on` |
| Uploads brechen bei großen Dateien ab (413) | Upload-Grenze des Proxys erhöhen (`client_max_body_size`, `maxAllowedContentLength`, `request_body max_size`) |
| AD/SMTP: „unable to verify the first certificate“ | interne Zertifizierungsstelle bekannt machen (`NODE_EXTRA_CA_CERTS` oder `--use-system-ca`, Abschnitt 9.2) |
| Sicherung läuft zur falschen Uhrzeit | Zeitzone des Servers prüfen; `TZ=Europe/Berlin` in der `.env` bzw. im Container |

Weitere Fälle: [Administrationshandbuch → Fehlersuche](ADMINISTRATION.md#fehlersuche).

---

## 14. Referenz: Einstellungen in der `.env`

Die `.env` liegt im Programmordner; Werte aus der Umgebung des Dienstes haben Vorrang. Inhaltliche
Einstellungen (Name, Registrierung, SMTP, Sicherungen …) stehen nicht hier, sondern in der Oberfläche
unter **Administration**.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Netzwerkschnittstelle; `127.0.0.1`, wenn nur ein lokaler Proxy zugreift |
| `BASE_URL` | `http://localhost:3000` | öffentliche Adresse für Links in E-Mails, Webhooks, Kalender-Abos und die API-Referenz |
| `TRUST_PROXY` | `false` | Proxy-Header auswerten: Adressen/Netze des Proxys (`loopback`, `127.0.0.1`, `10.0.0.5`, `10.0.0.0/8`, `uniquelocal`) oder `true` für jeden Absender |
| `COOKIE_SECURE` | `auto` | Sitzungs-Cookie nur über HTTPS: `auto` (sobald die Anfrage per HTTPS bzw. mit `X-Forwarded-Proto: https` ankommt), `true`, `false` |
| `DATA_DIR` | `data` | Datenbank, Anhänge, Sicherungen, Vorschauen, Serverschlüssel |
| `DB_FILE` | `DATA_DIR/knowstead.db` | abweichender Pfad der Datenbankdatei |
| `PLUGINS_DIR` | `plugins` | Plugin-Verzeichnis |
| `WEB_DIST_DIR` | `web/dist` | gebaute Oberfläche |
| `KNOWSTEAD_SECRET` | – (dann `secret.key`) | Serverschlüssel, mindestens 32 Zeichen; nach dem ersten Start nicht mehr ändern |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `LOG_FILE` | – (nur Konsole) | Protokolldatei mit Rotation (10 MB, fünf ältere Stände), relativ zum Datenverzeichnis, z. B. `logs/knowstead.log` – setzt der Assistent für die geplante Aufgabe |
| `KNOWSTEAD_SERVICE` | – | Betriebsart laut Assistent (`task`, `nssm`, `systemd`, `docker`) – nur Anzeige unter *Nächste Schritte* |
| `NODE_ENV` | – | `production` für den Betrieb |
| `TZ` | Zeitzone des Servers (Docker: `Europe/Berlin`) | Uhrzeit von Sicherung, täglicher Zusammenfassung und Datumsangaben in Exporten |

Nur in der **Dienstumgebung** wirksam (nicht in der `.env`): `NODE_EXTRA_CA_CERTS` (zusätzliche
Zertifizierungsstellen) und `NODE_OPTIONS`.

Notfall-Schalter, nur bewusst und vorübergehend: `KNOWSTEAD_ALLOW_DOWNGRADE=1`, `KNOWSTEAD_ALLOW_KEY_CHANGE=1`,
`KNOWSTEAD_SKIP_UPDATE_BACKUP=1` – siehe [Administrationshandbuch → Aktualisierung](ADMINISTRATION.md#aktualisierung).
