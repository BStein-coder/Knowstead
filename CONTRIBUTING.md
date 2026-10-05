# Mitarbeiten an Knowstead

Danke, dass du Knowstead verbessern möchtest! Fehlerberichte, Ideen, Übersetzungen, Dokumentation und Code
sind gleichermaßen willkommen.

## Bevor du loslegst

- **Fehler** meldest du über *Issues → Fehler melden*. Hilfreich sind Version, Betriebsart, Schritte zum
  Nachvollziehen und passende Zeilen aus dem Serverprotokoll (ohne Zugangsdaten).
- **Sicherheitslücken** bitte **nie** als öffentliches Issue – siehe [SECURITY.md](SECURITY.md).
- **Größere Änderungen** (neue Module, Datenbankänderungen, neue Abhängigkeiten) zuerst als Issue
  besprechen. So passt die Umsetzung zur Architektur, bevor viel Arbeit darin steckt.

## Entwicklungsumgebung

Voraussetzung ist **Node.js 24**. Sonst nichts – kein Datenbankserver, kein Docker.

```bash
npm install
npm run dev          # API auf :3000, Oberfläche mit Hot Reload auf :5173
```

Aufbau, Konventionen und typische Aufgaben (neues Modul, Makro, Migration, Recht) beschreibt
[docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md), den inneren Aufbau [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Regeln für Änderungen

| Thema | Regel |
| --- | --- |
| Sprache | Oberfläche, Kommentare, Commit-Nachrichten und Dokumentation auf Deutsch; Bezeichner im Code auf Englisch |
| Texte | alle Texte der Oberfläche in `web/src/i18n/de.ts` **und** `en.ts`; neue Fehlermeldungen des Servers zusätzlich in `server/src/i18n/en.ts` |
| Datenbank | Schemaänderungen nur als **neue** Migration unter `server/src/db/migrations/` – bestehende nie ändern |
| Rechte | nie selbst prüfen, sondern die Rechtedienste nutzen (`perms.requireGlobal`, `pages.requireAccess` …) und mit einer Person **ohne** Recht testen |
| Tests | neue Funktionen bekommen Server-Tests (`server/test/`), neue Seiten der Oberfläche einen Eintrag in `e2e/tests/support/routes.ts` |
| Abhängigkeiten | sparsam; neue Pakete im Pull Request begründen (Lizenz, Pflege, Größe) |
| Dokumentation | Handbuch (`docs/handbuch` und `docs/handbook`), `docs/API.md`, `docs/ADMINISTRATION.md` und `CHANGELOG.md` mitpflegen |

## Prüfen vor dem Pull Request

```bash
npm run lint         # ESLint und Vollständigkeit der Übersetzungen
npm run typecheck    # TypeScript für Server und Oberfläche
npm test             # Server-Tests
npm run test:e2e     # Oberflächentests (einmalig: npm --prefix e2e ci)
```

Dieselben Schritte laufen in GitHub Actions für jeden Pull Request.

## Commit-Nachrichten

Kurz und im Imperativ, auf Deutsch – z. B. „Lesebestätigung: Erinnerung vor Fristende“. Eine Änderung
je Commit; Formatierungsänderungen getrennt von inhaltlichen.

## Lizenz

Mit einem Beitrag erklärst du dich einverstanden, dass er unter der Lizenz des Projekts
([LICENSE](LICENSE)) veröffentlicht wird.
