# Oberflächentests (Playwright)

Flächendeckende Tests der Weboberfläche in einem echten Browser. Sie gehören **nicht** zur
Produktivinstallation – der Ordner hat eigene Abhängigkeiten und wird von `npm ci` im Projektordner
nicht angefasst.

## Was geprüft wird

| Datei | Inhalt |
| --- | --- |
| `routes.spec.ts` | Rundgang über **alle Seiten** (Administration eingeschlossen) und die öffentlichen Seiten: lädt ohne JavaScript-, Konsolen- oder Serverfehler, hat eine Überschrift, Bildschirmfoto im Bericht |
| `a11y.spec.ts` | **Barrierefreiheit** nach WCAG 2.1 A/AA (axe-core) für jede Seite, hell und dunkel – schwerwiegende Verstöße lassen den Test scheitern, alle Befunde stehen in `reports/a11y.json` |
| `auth.spec.ts` | Anmeldung, falsches Passwort, Abmelden, Weiterleitung nach der Anmeldung, offene Weiterleitungen, 404 |
| `pages.spec.ts` | Seite anlegen, bearbeiten, Versionen vergleichen und wiederherstellen, Papierkorb, Makros, Favoriten |
| `editor.spec.ts` | Markdown-Kürzel, Tastenkürzel, Slash-Befehle, Entwurfsspeicherung, Pflichtfelder, Markdown-Seiten |
| `collaboration.spec.ts` | Kommentare mit Antwort und Erledigt, Leserechte, **gleichzeitiges Bearbeiten** in zwei Browsern |
| `navigation.spec.ts` | Befehlspalette, Volltext- und Anhangsuche, Stichwort-Filter, Tastenkürzel, Seitenbaum, dunkles Design |
| `work.spec.ts` | Aufgabenplaner, Prüfung und Freigabe, Anhänge hochladen/löschen/wiederherstellen, Export als PDF und Markdown |
| `admin.spec.ts` | Bereich anlegen und einstellen, Benutzer, Gruppen, Einstellungen, Sicherung, Wartung, Webhooks, Audit-Log |
| `profile.spec.ts` | Profil, E-Mail-Wechsel mit Passwortbestätigung, Sitzungen, Einstellungen |
| `mobile.spec.ts` | Smartphone-Ansicht: Navigation und kein waagerechtes Scrollen |
| `startup.spec.ts` | Start der Anwendung: Startanzeige, Hinweis bei blockierten Programmdateien, 404 für veraltete Dateien |
| `layout.spec.ts` | Festgehaltene Layoutfälle: Seitenränder, Brotkrumen auf dem Handy, Zeitstrahl, umbrechende Reiter, Aufgabendialog mit Chatspalte |
| `motion.spec.ts` | 3D-Szene (reine Dekoration, nur `transform`/`opacity`), Stillstand bei reduzierter Bewegung, Einstellung im Benutzermenü, Neigung und Einblenden |
| `sweep.spec.ts` | **Layout-Messung** über alle Seiten in fünf Fensterbreiten: Überlappungen, verdeckte Bedienelemente, Überstände, abgeschnittene Beschriftungen, seitliches Scrollen – läuft nur auf Wunsch (`npm run test:sweep`) |

Jeder Test schlägt zusätzlich fehl, wenn im Browser ein JavaScript-Fehler, eine Konsolen-Fehlermeldung
oder eine Serverantwort 5xx auftritt. Geöffnete Dialoge, Menüs und der Editor werden ebenfalls auf
Barrieren geprüft.

## Ausführen

```bash
cd e2e
npm ci                        # einmalig
npm run install-browser       # nur Linux/macOS: Chromium für Playwright laden
cd .. && npm run test:e2e     # baut die Oberfläche und startet alle Tests
```

Unter Windows nutzen die Tests das installierte **Microsoft Edge** – ein Browser-Download ist nicht
nötig. Andere Browser: `E2E_CHANNEL=chrome` (installiertes Chrome) oder leer für Playwrights Chromium.

Die Tests starten selbst einen Knowstead-Server auf Port 3899 mit frischer Datenbank in `e2e/.data` und legen
Testkonten und -inhalte an (`tests/global.setup.ts`). Die eigene Installation bleibt unberührt.

| Befehl | Zweck |
| --- | --- |
| `npx playwright test tests/pages.spec.ts` | eine Datei |
| `npx playwright test --headed` | Browser sichtbar |
| `npx playwright test --project=mobile` | nur Smartphone-Ansicht |
| `npm run sweep` | Layout-Messung über alle Seiten (einige Minuten); einzelne Seiten mit `npm run sweep -- -g "Startseite"` |
| `npm run report` | HTML-Bericht mit Bildschirmfotos und Aufzeichnungen fehlgeschlagener Tests |
| `npm run typecheck` | TypeScript der Tests prüfen |

Umgebungsvariablen: `E2E_PORT` (Standard 3899), `E2E_WORKERS` (Standard 2), `E2E_CHANNEL`, `E2E_LOG_LEVEL`,
`E2E_RETRIES` (Standard 1 unter Windows und in CI, sonst 0).

**Wiederholungen.** Windows meldet unter Last gelegentlich `net::ERR_NO_BUFFER_SPACE` (Engpass bei
Netzwerk-Sockets des Betriebssystems) – die Seite bleibt dann leer. Ein fehlgeschlagener Test wird deshalb
einmal wiederholt; besteht er beim zweiten Mal, steht er im Ergebnis als **flaky**. Solche Tests im Bericht
ansehen (Anhang `browser-fehler.txt`): Nur der genannte Netzwerkfehler ist harmlos, alles andere ist ein
echter Befund. Ohne Wiederholung: `E2E_RETRIES=0`.

## Tests erweitern

- **Neue Seite der Oberfläche**: Eintrag in `tests/support/routes.ts` – sie ist damit automatisch im
  Rundgang und in der Barrierefreiheitsprüfung (hell und dunkel).
- **Neuer Arbeitsablauf**: in die passende `*.spec.ts`; `test`, `expect`, `ready` und `expectAccessible`
  aus `tests/support/fixtures.ts` verwenden. Testdaten mit `unique()` benennen – alle Tests teilen sich
  eine Datenbank.
- Vorbereitete Inhalte (Konten, Bereich `E2E`, Seiten mit Makros, Plan, Prüfauftrag) stehen über das
  Fixture `seed` bereit; Anmeldungen als `AUTH.admin`, `AUTH.editor`, `AUTH.viewer` per `test.use({ storageState })`.
- Bedienelemente über Rollen und Namen ansprechen (`getByRole('button', { name: 'Speichern' })`) – das
  prüft nebenbei, dass sie für Screenreader benannt sind.
