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
| `appearance.spec.ts` | **Aussehen** „Papier“ und „Frost“: Wahl im Benutzermenü und im Profil, Speicherung im Konto und auf dem Gerät, Rückfälle bei reduzierter Bewegung, axe-Prüfung jeder Kombination aus Aussehen und Farbschema auf elf Seiten, kein seitlicher Überlauf |
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
| `npm run scan:english` | Englische Oberfläche nach deutschen Resten absuchen (siehe unten); einzelne Ansichten mit `npm run scan:english -- admin` |
| `npm run scan:perf` | Was kostet ein Aussehen? Leerlauf, Bilder je Sekunde, CPU- und Grafikarbeit beim Scrollen je Aussehen (siehe unten); `-- --software` ohne Grafikkarte, `-- --throttle 6` stärker gebremst |
| `npm run scan:contrast` | Kontrast jedes Textes gegen die tatsächlich gezeichneten Bildpunkte messen (siehe unten); `-- --look frost --scheme dark --views home,board` schränkt ein |
| `npm run shots` | Bildschirmfotos der Oberfläche je Aussehen und Farbschema nach `reports/shots/` (`-- --look paper,frost --scheme light,dark --views home,board --width 1440`) |
| `npm run report` | HTML-Bericht mit Bildschirmfotos und Aufzeichnungen fehlgeschlagener Tests |
| `npm run typecheck` | TypeScript der Tests prüfen |

Umgebungsvariablen: `E2E_PORT` (Standard 3899), `E2E_WORKERS` (Standard 2), `E2E_CHANNEL`, `E2E_LOG_LEVEL`,
`E2E_RETRIES` (Standard 1 unter Windows und in CI, sonst 0).
`E2E_CPU_THROTTLE=<Faktor>` bremst den Browser künstlich (z. B. `4` = viermal so langsam) und stellt so die langsameren
Läufer von GitHub nach: Ein Test, der nur auf einem schnellen Rechner besteht, ist meist einer, der mitten in einer
Animation misst – dann vorher `settled(page)` aus `tests/support/fixtures.ts` aufrufen.

**Wiederholungen.** Windows meldet unter Last gelegentlich `net::ERR_NO_BUFFER_SPACE` (Engpass bei
Netzwerk-Sockets des Betriebssystems) – die Seite bleibt dann leer. Ein fehlgeschlagener Test wird deshalb
einmal wiederholt; besteht er beim zweiten Mal, steht er im Ergebnis als **flaky**. Solche Tests im Bericht
ansehen (Anhang `browser-fehler.txt`): Nur der genannte Netzwerkfehler ist harmlos, alles andere ist ein
echter Befund. Ohne Wiederholung: `E2E_RETRIES=0`.

**Englische Oberfläche.** `english-scan.mjs` sucht in der englischen Oberfläche nach deutschen Resten:
deutsche Wörter und Umlaute, deutsche Datums- und Zahlenschreibweise („14. Okt.“, „05.10.2026“, „100.000“) –
in sichtbarem Text, in Beschriftungen (`title`, `aria-label`, `placeholder`) und in dem, was in Feldern steht.
Der Browser läuft dabei auf Deutsch, die Oberfläche auf Englisch; so fällt auch auf, was der Sprache des
Browsers folgt. Das Skript startet einen eigenen Server (Port 3898, `E2E_SCAN_PORT`) mit frischer, englisch
eingerichteter Datenbank in einem Wegwerf-Ordner, geht rund 65 Ansichten durch und schreibt Auffälligkeiten
nach `reports/english-scan.txt`. Es gehört nicht zum normalen Lauf: Die Wortliste ist eine Heuristik, ein
Befund braucht einen Blick. Bewusst Deutsches (Schlüssel `HANDBUCH`, „Deutsch“ in der Sprachwahl) steht im
Skript unter `ERLAUBT`. Seiteninhalte und die Versionshinweise werden nicht durchsucht.

**Kontrast.** axe-core misst Schrift gegen die Hintergrundfarbe der Elemente darüber – Lichtflecken, Verläufe und
Glas mit Unschärfe dahinter sieht es nicht, weil ein Pseudo-Element für axe kein Hintergrund ist. `contrast-scan.mjs`
macht deshalb das Gegenteil: Es blendet alle Schrift aus, fotografiert die Seite und misst für jeden Text den
ungünstigsten Bildpunkt hinter seinem Rahmen gegen die tatsächliche Schriftfarbe (4,5 : 1, große Schrift 3 : 1).
Gemessen wird, was im Fenster zu sehen ist: bei offenem Dialog nur der Dialog, ohne verdeckte oder abgeschnittene
Texte und ohne deaktivierte Bedienelemente. Das Werkzeug gehört nicht zum normalen Lauf – nach Änderungen an Farben,
Hintergründen oder Aussehen ausführen (`npm run test:contrast`, auch `-- --width 400 --height 800` für das Handy).

**Kosten eines Aussehens.** `perf-probe.mjs` lädt Startseite, Plan und Seite je Aussehen, misst 3 Sekunden Leerlauf und 3 Sekunden Scrollen und wertet
den Ablauf des Browsers aus: Hauptthread-Last im Leerlauf (Dauerbewegung wie die 3D-Szene fällt hier auf), Bilder je Sekunde,
Anteil der Bilder über 33 ms und die Arbeit (alle Threads bzw. Grafikprozess) je Sekunde Scrollen. Die Zahlen sind
Vergleichswerte; auf einem Rechner mit Grafikkarte liegen die Aussehen eng beieinander – ohne (`--software`, wie im
Terminalserver) zeigen Unschärfe, Masken und große Schatten, was sie kosten.

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
