# Knowstead auf GitHub veröffentlichen

Diese Anleitung führt vom lokalen Ordner zum fertig eingerichteten GitHub-Repository – mit laufenden
Prüfungen, Vorlagen für Issues und vertraulichen Sicherheitsmeldungen. Sie ist für die erste
Veröffentlichung gedacht; für spätere Änderungen gilt [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Vorbereiten

| Schritt | Warum |
| --- | --- |
| In `LICENSE` den Rechteinhaber prüfen (`Copyright (c) 2026 Knowstead contributors`) | eigener Name oder Organisation, falls gewünscht |
| Adresse des Repositorys prüfen: `BStein-coder/Knowstead` steht in `.github/ISSUE_TEMPLATE/config.yml`, `SECURITY.md`, `docs/INSTALLATION.md` und `scripts/release-notes.mjs` | Links zu Sicherheitsmeldungen, Installationsanleitung und Paketen – bei einem Fork oder Umzug dort ersetzen |
| Kontaktweg in `SECURITY.md` und `CODE_OF_CONDUCT.md` prüfen (`info@steintecdev.com`) | dort steht, wie Lücken und Verstöße gemeldet werden |
| Kontrollieren, dass keine Laufzeitdaten im Ordner landen (siehe unten) | Datenbank, Anhänge und Schlüssel gehören nie ins Repository |

Die mitgelieferte `.gitignore` schließt bereits aus: `node_modules/`, `data/` (Datenbank, Anhänge,
Sicherungen, Serverschlüssel), `web/dist/`, `.env` und `.env.*` (außer `.env.example`), Editor- und
Werkzeugordner (`.vscode/`, `.idea/`, `.claude/`) sowie in `e2e/` die Testdaten, Anmeldezustände und
Berichte.

## 2. Repository anlegen

1. Auf GitHub **New repository** wählen, Name `Knowstead`, Sichtbarkeit nach Wunsch.
2. **Kein** README, keine `.gitignore` und keine Lizenz erzeugen lassen – das bringt Knowstead mit.

## 3. Erster Upload

Voraussetzung ist [Git](https://git-scm.com/). Im Projektordner:

```bash
git init -b main
```

Name und E-Mail-Adresse, unter denen die Commits erscheinen, nur für dieses Repository festlegen:

```bash
git config user.email "info@steintecdev.com"
```

```bash
git add .
```

Unter Windows kennt das Dateisystem kein Ausführungsrecht. Damit `./start.sh` nach einem `git clone` unter
Linux direkt startet, das Recht einmal im Repository vermerken:

```bash
git update-index --chmod=+x start.sh install.sh update.sh
```

Vor dem ersten Commit die Liste der vorgemerkten Dateien prüfen – darin dürfen weder `data/` noch
`.env` noch `node_modules/` auftauchen:

```bash
git status --short
```

```bash
git commit -m "Knowstead 2.1.0"
```

```bash
git remote add origin https://github.com/BStein-coder/Knowstead.git
```

```bash
git push -u origin main
```

`.gitattributes` sorgt dafür, dass Textdateien mit LF-Zeilenenden gespeichert werden (Windows-Skripte
wie `start.cmd` mit CRLF) und Bilder, PDFs und Word-Dateien als Binärdateien gelten – egal, auf welchem
System eingecheckt wird.

## 4. Repository einrichten

Unter **Settings** des Repositorys:

| Bereich | Einstellung |
| --- | --- |
| *Security → Private vulnerability reporting* | **Enable** – dann funktioniert der Link „Sicherheitslücke melden“ |
| *Security → Dependabot alerts / security updates* | aktivieren; `.github/dependabot.yml` schlägt zusätzlich Updates vor (npm wöchentlich, Testumgebung, GitHub Actions und Docker-Basisimage monatlich) |
| *Actions → General* | Actions zulassen; die Prüfungen brauchen nur Leserechte (`permissions: contents: read`), nur der Job *GitHub-Release* fordert für sich Schreibrechte an |
| *Branches → Add branch ruleset* für `main` | Pull Request vor dem Zusammenführen verlangen und die Prüfungen **Lint, Typen, Tests, Build**, **Installationsassistenten** (Windows und Linux) und **Oberflächentests (Playwright)** als erforderlich markieren |
| *General → Features* | Issues aktivieren; Discussions optional für Fragen |

Die **About**-Angaben (rechts auf der Startseite des Repositorys) mit einer kurzen Beschreibung und
Themen wie `documentation`, `wiki`, `knowledge-base`, `self-hosted`, `nodejs`, `react` füllen.

## 5. Was bei jedem Push passiert

Der Workflow `.github/workflows/ci.yml` läuft bei Pushes auf `main`, bei jedem Pull Request und auf
Knopfdruck (*Actions → CI → Run workflow*):

| Job | Inhalt | Dauer (ca.) |
| --- | --- | --- |
| **Lint, Typen, Tests, Build** | `npm ci`, ESLint mit Übersetzungsprüfung, TypeScript, Server-Tests, Build der Oberfläche, `npm audit` für Laufzeitabhängigkeiten (ab hoher Schwere) | 3–5 Minuten |
| **Installationsassistenten** (Windows, Linux) | Windows: PowerShell-Syntax, alle acht Seiten des grafischen Assistenten im Selbsttest gerendert, Probelauf ohne Rückfragen (`-WhatIf`); Linux: `bash -n`, `shellcheck`, Probelauf von `install.sh`, `update.sh` mit Root-Rechten an einer nachgestellten Installation (Eigentümer, Dienstkonto, Abbruch) | 3–4 Minuten |
| **Oberflächentests (Playwright)** | Playwright mit Chromium über alle Seiten, Barrierefreiheit hell/dunkel, mobile Ansicht; der HTML-Bericht liegt als Artefakt am Lauf | 5–8 Minuten |

Scheitert ein Test, enthält das Artefakt `playwright-report` Screenshots und Traces des Fehlers.

## 6. Versionen veröffentlichen

1. Version in `package.json`, `server/package.json` und `web/package.json` erhöhen und den Abschnitt
   *Unveröffentlicht* in `CHANGELOG.md` in die neue Version umbenennen bzw. – wenn es ihn nicht gibt –
   den Abschnitt der Version oben anlegen (`## [2.1.0] – JJJJ-MM-TT`). Das Protokoll erscheint so, wie es
   ist, unter *Administration → Über*.
2. Commit und Tag anlegen und hochladen:

```bash
git tag -a v2.1.0 -m "Knowstead 2.1.0"
```

```bash
git push origin main --tags
```

3. Den Rest erledigt der Workflow `.github/workflows/release.yml` (ca. 15 Minuten): Er prüft, dass Tag
   und `package.json` zusammenpassen und das Änderungsprotokoll einen Abschnitt für die Version hat,
   führt auf Windows und Linux Lint, Tests und Build aus, baut die **Installationspakete** und legt das
   Release mit den Versionshinweisen aus `CHANGELOG.md` an:

| Datei | Inhalt |
| --- | --- |
| `knowstead-2.1.0-windows-x64.zip` | Programm mit vorgebauter Oberfläche und installierten Laufzeitabhängigkeiten, `Knowstead-Installation.cmd` |
| `knowstead-2.1.0-linux-x64.tar.gz` | dasselbe für Linux mit `install.sh` und `update.sh` |
| `*.sha256` | Prüfsummen zum Abgleich nach dem Herunterladen |

Die Pakete sind betriebssystemabhängig, weil eine Abhängigkeit (PDF-Vorschaubilder) native Programmteile
mitbringt. Auf dem Server ist daher weder ein Build noch ein Download von npm nötig – nur Node.js 24.
Scheitert der Workflow, entsteht kein Release; nach der Korrektur den Tag löschen und neu setzen oder den
Lauf unter *Actions → Release → Re-run* wiederholen.

Ein Paket lässt sich auch lokal bauen, z. B. zum Testen:

```bash
npm run build && node scripts/package.mjs --out release
```

Wer Knowstead als Docker-Image anbieten möchte, kann es aus dem mitgelieferten `Dockerfile` bauen und in der
GitHub Container Registry veröffentlichen; ein Workflow dafür ist bewusst nicht enthalten, weil Name,
Sichtbarkeit und Signierung Entscheidungen des Betreibers sind.

## Checkliste

- [ ] `LICENSE`, `SECURITY.md` und die Adresse des Repositorys geprüft
- [ ] `git status` zeigt weder `data/` noch `.env` noch `node_modules/`
- [ ] erster Push erfolgreich, CI grün
- [ ] private Sicherheitsmeldungen und Dependabot aktiviert
- [ ] Branch-Regel für `main` mit erforderlichen Prüfungen
- [ ] erstes Release `v2.1.0` über den Tag angelegt, beide Installationspakete am Release
