# Entwicklung

Kurzanleitung für alle, die an Knowstead selbst arbeiten: Umgebung, Konventionen, typische Aufgaben.
Den inneren Aufbau erklärt [ARCHITEKTUR.md](ARCHITEKTUR.md).

## Umgebung

```bash
npm install
npm run dev      # API auf :3000 (Neustart bei Änderungen), Oberfläche auf :5173
```

Die Oberfläche unter `http://localhost:5173` spricht über einen Proxy mit der API. Beim ersten Start
führt der Einrichtungsassistent durch die Kontoanlage.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsmodus (API + Oberfläche) |
| `npm test` | Testsuite (`node:test`) |
| `npm run lint` | ESLint (TypeScript, React Hooks) und Vollständigkeit der Übersetzungen |
| `npm run typecheck` | TypeScript für Server, Plugins und Oberfläche |
| `npm run test:e2e` | Oberfläche bauen und die Browsertests ausführen ([e2e/README.md](../e2e/README.md)) |
| `npm run test:english` | Oberfläche bauen und die englische Oberfläche nach deutschen Resten absuchen – Wörter, Datums- und Zahlenschreibweise, Feldinhalte ([e2e/README.md](../e2e/README.md)) |
| `npm run test:contrast` | Oberfläche bauen und den Kontrast jedes Textes gegen die gezeichneten Bildpunkte messen – klassisch, Glas und Papier, hell und dunkel ([e2e/README.md](../e2e/README.md)) |
| `npm run build` | Oberfläche nach `web/dist` bauen |
| `npm start` | Produktivstart aus dem Quelltext |
| `npm run cli -- help` | Verwaltungswerkzeug (`status`, `backup`, `backup:list`, `restore`, Konten) |
| `node scripts/prepare.mjs` | Abhängigkeiten und Oberfläche nur bei Änderungen installieren bzw. bauen (nutzen `start.cmd`/`start.sh`) |
| `node scripts/install.mjs --help` | Installationskern der Assistenten (`.env`, Verzeichnisse, Probestart, Prüfung) |
| `node scripts/package.mjs` | Installationspaket nach `release/` bauen (vorher `npm run build`); `--target linux-x64` bzw. `windows-x64`/`linux-arm64` für ein anderes System – npm lädt dann die nativen Module des Zielsystems |
| `node scripts/release-notes.mjs 2.2.0` | Versionshinweise einer Version aus `CHANGELOG.md` (nutzt der Release-Workflow) |
| `node scripts/loadtest.mjs` | Lasttest mit Testdaten in einem temporären Verzeichnis |

Ein einzelner Test:

```bash
node --disable-warning=ExperimentalWarning --test server/test/review.test.ts
```

## Konventionen

**Sprache.** Oberfläche, Kommentare, Commit-Nachrichten und Dokumentation auf Deutsch; Bezeichner im
Code auf Englisch (`PageService`, `reviewRequired`). Benutzertexte gehören in `web/src/i18n/de.ts`
und `en.ts` – keine festen Zeichenketten in Komponenten, auch nicht in der Administration
(`npm run lint` prüft, dass jeder verwendete Schlüssel in beiden Wörterbüchern steht, und meldet feste
deutsche Texte in Zeichenketten und JSX; bewusste Ausnahmen stehen mit Begründung in
`scripts/check-i18n.mjs`). Gespeicherte Systemtexte (automatische Änderungsnotizen, Standardspalten,
Systemgruppen) entstehen in der Sprache der Einrichtung bzw. werden beim Ausliefern übersetzt.
Plugins liefern eigene Übersetzungen über `translations` im Manifest und `api.locale` (siehe
[PLUGINS.md](PLUGINS.md)).

**Englisch auf dem Server.** Fehlermeldungen, Benachrichtigungen und E-Mail-Texte schreibt der Server
auf Deutsch; `server/src/i18n/en.ts` enthält die englische Fassung (Schlüssel = deutscher Text, `{}` für
eingesetzte Werte). Neue Meldungen dort ergänzen – `server/test/i18n.test.ts` findet fehlende
Übersetzungen automatisch. Die Sprache einer Anfrage steht in `auth.locale`; `translate(text, locale)`
überträgt beliebige Texte, `renderMail(…, locale)` ganze E-Mails. Handbuch und Vorlagen gibt es als
`docs/handbuch` bzw. `docs/handbook` und `seed/templates.ts` bzw. `seed/templates.en.ts`.

**Bewegung.** Drei Ebenen: Rückmeldung der Bedienelemente, Auftritt von Inhalten, die 3D-Szene
(`web/src/styles/motion.css`, `scene.css`, `web/src/lib/motion.ts`, `components/Scene3D.tsx`). Regeln:

- Animiert werden nur `transform` und `opacity` – der Browser überlässt das der Grafikkarte, der
  Hauptthread bleibt frei. Nichts, was man anklicken soll, bewegt sich dauerhaft.
- Die Ruhestellung ohne Animation ist der gestaltete Zustand. Bei reduzierter Bewegung (Betriebssystem
  oder `data-motion="reduced"` an `<html>`) setzt `tokens.css` alle Dauern auf null; Effekte, die Inhalte
  zunächst verbergen, greifen nur mit der Klasse `motion-ok`.
- Bausteine: `data-tilt="5"` (Kachel neigt sich zum Zeiger, Wert = Grad), `data-spot` bzw. `<Card spot>`
  (Lichtkegel), `<Reveal index={n}>` (Einblenden beim Scrollen), Klasse `stagger` (Kinder erscheinen
  gestaffelt), `useCountUp(zahl)` (hochzählende Zahl), `<Scene3D variant="stage|hero|lost" />`.
- Die Szene besteht aus CSS-3D-Transformationen ohne WebGL und ohne Bibliothek. Alle Maße hängen an der
  Welt-Einheit `--u`; die Komposition steht als Tabelle `NODES` in `Scene3D.tsx`. Sie ist Dekoration
  (`aria-hidden`, nicht anklickbar) und pausiert außerhalb des Bildes und nach einer Minute ohne Eingabe.

**Navigation.** Kopfleiste, Seitenleiste, die Leiste über einer Seite, „Auf dieser Seite“ und die Leisten des
Editors sind schwebende Glasebenen (`web/src/styles/shell.css`; der Aufbau – Raster, Schublade auf dem Handy –
steht in `layout.css`). Regeln:

- Maße und Kanten hängen an Token aus `tokens.css`: `--shell-gap` (Abstand zum Fensterrand), `--shell-radius`,
  `--glass-edge` (Lichtsaum als 1 px breiter Ring), `--panel-shadow`, `--nav-active-bg`. Mit
  `--shell-gap: 0px; --shell-radius: 0px` docken die Ebenen wieder an – etwa in einem Plugin-Stylesheet.
- Der Hauptbereich beginnt bündig unter der Kopfleiste; haftende Leisten darin (`position: sticky`) brauchen
  deshalb keinen Versatz. Die Leiste über einer Seite schwebt mit `top: var(--shell-gap)` über dem Inhalt.
- Aktive Einträge tragen die Lichtmarke (`.nav-link.active::before`). Im Seitenbaum übernimmt das die
  Verbindungslinie zur geöffneten Seite (`.tree .tree:has(.tree-row.active)::before`) – die Pseudo-Elemente der
  Zeile zeigen dort beim Ziehen die Einfügestelle.
- Für Glas nur `backdrop-filter` schreiben. Die Schreibweise mit `-webkit-` ergänzt der Build selbst; steht
  sie zusätzlich im Quelltext, bleibt im Build nur sie übrig – außerhalb von Safari fehlt dann die Unschärfe.
  `e2e/tests/shell.spec.ts` prüft das am ausgelieferten Build.
- `prefers-reduced-transparency` macht aus Glas deckende Flächen, `forced-colors` gibt aktiven Einträgen
  einen Rahmen statt der Fläche.
- Prüfen: `e2e/tests/motion.spec.ts` (nur `transform`/`opacity`, Stillstand bei reduzierter Bewegung).

**Dateien.** UTF-8, Zeilenenden LF, zwei Leerzeichen Einrückung (`.editorconfig`, `.gitattributes`);
nur Windows-Batchdateien (`*.cmd`) mit CRLF – `cmd.exe` findet Sprungmarken sonst nicht zuverlässig.

**Server.** Node 24 führt TypeScript direkt aus. Daraus folgt:

- Importe **mit** Dateiendung: `import { x } from './datei.ts'`
- Typimporte als `import type { … }`
- keine `enum`s und keine Parameter-Eigenschaften im Konstruktor (`erasableSyntaxOnly`)
- Fachdienste sind Klassen mit `constructor(s: Services)`
- Routen liegen im Modul, dem sie fachlich gehören (`comments/routes.ts`, nicht in `pages/routes.ts`)

**Seitenmodul.** `pages/service.ts` verwaltet Seiten, Versionen und Rechte. Entwürfe (`s.drafts`),
Papierkorb und endgültiges Löschen (`s.trash`) sowie Seitenverweise und Rückverweise (`s.links`) sind
eigene Dienste – neue Funktionen dort ergänzen, statt `PageService` wieder wachsen zu lassen.

**Abgeleitete Daten.** Suchtext und Kurzfassung einer Seite entstehen beim Speichern
(`pages/content.ts → plainText`). Ändert sich diese Ableitung, `TEXT_VERSION` in
`search/service.ts` erhöhen: Der nächste Start berechnet dann alle Seiten einmalig neu – ohne Migration.

**Datenbank.** Jede Änderung am Schema kommt als **neue** Migration unter
`server/src/db/migrations/` und wird in `migrate.ts` registriert (siehe [Migration schreiben](#migration-schreiben)).
Bestehende Migrationen bleiben unverändert. Zeitstempel sind ISO-8601-Strings in UTC, Listen werden
als JSON-Text gespeichert. Transaktionen (`db.transaction`) sind synchron – kein `await` darin.

**Rechte.** Nie selbst prüfen, sondern fragen:
`perms.requireGlobal`, `spaces.requireViewable`, `pages.requireAccess`, `perms.canSpace`. Aktionen an
fremden Konten (ändern, sperren, löschen, Tokens) laufen zusätzlich über `users.requireManageable` –
sonst könnte `users.manage` Administratoren übernehmen.

**Dateien.** Anhänge nie direkt vom Datenträger löschen, sondern mit
`attachments.scheduleFileRemoval(keys)` vormerken: Die Wartung entfernt sie nach 30 Tagen, damit
zurückgespielte Sicherungen ihre Dateien noch finden. Pfade immer gegen das Zielverzeichnis prüfen.

**Fehler.** `badRequest`, `forbidden`, `notFound`, `conflict` aus `core/errors.ts` mit einer
verständlichen deutschen Meldung – sie erscheint direkt in der Oberfläche.

**Schemas.** Felder, die `null` annehmen dürfen, immer mit `Nullable(…)` aus `server/src/http.ts`
beschreiben, nie als `Type.Union([…, Type.Null()])`: Fastify validiert mit `coerceTypes`, und AJV
würde `null` im ersten Zweig der Union in `0` bzw. `""` umwandeln. `Nullable` erzeugt
`nullable: true` – `null` bleibt erhalten.

**Oberfläche.** Datenzugriff über TanStack Query (`api/hooks.ts`), Gestaltung ausschließlich über die
Token aus `styles/tokens.css` (keine festen Farben), Komponenten aus `components/ui`. Neue Ansichten in
`App.tsx` mit `lazyPage(() => import(…))` einbinden – sie laden erst bei Bedarf und nach einem Update
automatisch neu.

**Barrierefreiheit.** Jede Ansicht hat eine `h1` (notfalls `className="sr-only"`). Schaltflächen nur mit
Symbol brauchen `aria-label` oder `title`, Schalter ohne sichtbares Label `ariaLabel`, Auswahllisten und
Eingabefelder ein Label. Farbige **Schrift** über die `*-fg`-Token (`--accent-fg`, `--danger-fg` …) –
die Grundfarben sind für kleinen Text oft zu hell. Die Browsertests prüfen das für jede Seite.

## Typische Aufgaben

### Neues Feld an einer Seite

1. Migration mit der neuen Spalte anlegen und registrieren.
2. `core/types.ts` (`PageRow`) und `PageDto` in `modules/pages/service.ts` erweitern.
3. Route(n) in `modules/pages/routes.ts` um das Feld ergänzen (TypeBox-Schema).
4. `web/src/api/types.ts` nachziehen und in der Oberfläche verwenden.
5. Test in `server/test/` ergänzen.

### Migration schreiben

Neue Datei `server/src/db/migrations/012_kurzname.ts`, die `migration012: Migration` exportiert, und
Eintrag in `MIGRATIONS`:

```ts
export const migration012: Migration = {
  version: 12,
  name: 'kurzname',
  up: (db) => {
    db.exec(`ALTER TABLE pages ADD COLUMN archived_at TEXT`);
  },
};
```

Beim Start laufen **alle ausstehenden Migrationen in einer Transaktion** mit ausgeschalteten
Fremdschlüsseln; davor sichert der Server die Datenbank. Daraus folgt:

- Kein `BEGIN`/`COMMIT`, kein `PRAGMA foreign_keys`, kein `VACUUM` und nichts Asynchrones in `up`.
- Keine Dateien anlegen oder löschen – das ließe sich bei einem Fehler nicht zurückrollen.
- **Additiv bevorzugen**: neue Tabellen, neue Spalten mit Standardwert. Dann läuft die Vorversion im
  Notfall mit der zurückgespielten Sicherung weiter.
- **Tabellen umbauen** nach dem SQLite-Muster: neue Tabelle anlegen, Daten kopieren, alte Tabelle
  löschen, neue umbenennen, Indizes und Trigger (FTS!) neu anlegen. Abhängige Zeilen bleiben erhalten,
  weil `ON DELETE CASCADE` währenddessen nicht greift; vor dem Commit prüft `foreign_key_check` alle
  Verweise.
- Grunddaten (Gruppen, Vorlagen, Handbuch) gehören nicht in Migrationen, sondern in `seed/index.ts` –
  und müssen Löschungen der Administration respektieren (vgl. `internal:templates:removedBuiltins`).
- **Test:** `server/test/upgrade.test.ts` baut eine Datenbank im Stand von 1.1 mit Inhalten und prüft,
  dass nach dem Update alles erhalten ist. Neue Migrationen mit Datenumzug dort ergänzen.

### Neues Makro

1. Knoten in `web/src/editor/extensions.tsx` über `macroNode(name, 'data-type', attrs, View)`.
2. React-NodeView unter `web/src/editor/views/` (nutzt `MacroFrame`).
3. Eintrag im Slash-Menü (`slashItems`) und Texte in beiden Sprachdateien.
4. Falls der Server das Makro kennen muss: `core/diff.ts` (Marker), `core/markdown.ts`
   (Markdown-Runde) und ggf. eine Datenroute in `modules/pages/macros.ts`.
5. Stil in `web/src/styles/content.css` bzw. `modern.css`.

### Neues Fachmodul

1. Ordner unter `server/src/modules/<modul>/` mit `service.ts` (und `routes.ts`).
2. Dienst in `services.ts` deklarieren und instanziieren.
3. `routes.ts` in `app.ts` registrieren.
4. Ereignistypen in `core/events.ts` ergänzen, damit Aktivität, Audit und Webhooks sie kennen.

### Neue Systemeinstellung

`core/settings.ts` um Feld und Standardwert erweitern, bei Bedarf Validierung in
`modules/admin/service.ts`, dann Feld in `web/src/pages/admin/Settings.tsx`. Geheimnisse immer
verschlüsseln (`encryptSecret`) und beim Ausliefern maskieren.

## Tests

`server/test/` nutzt `node:test` mit `app.inject` – kein laufender Server nötig:

```ts
const ctx = await createTestApp();
const admin = new Client(ctx.app);
await admin.post('/api/v1/setup', { … });
const res = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Test' });
assert.equal(res.status, 200, res.raw);
await ctx.close();
```

Gut abgedeckt gehören: Rechteprüfungen (erlaubt **und** verboten), Fehlerfälle, Ereignisse und alles,
was Daten verändert. Bei Fehlschlägen hilft `res.raw` in der Assertion-Meldung.

### Oberflächentests

`e2e/` enthält Browsertests mit Playwright (eigene Abhängigkeiten, nicht Teil der Installation):
Rundgang über alle Seiten, Barrierefreiheit (WCAG 2.1 AA, hell und dunkel) und die wichtigsten
Arbeitsabläufe. Sie starten einen eigenen Server mit frischer Datenbank.

```bash
npm --prefix e2e ci            # einmalig (unter Linux/macOS zusätzlich: npm --prefix e2e run install-browser)
npm run test:e2e               # baut die Oberfläche und führt alle Tests aus
npm run test:sweep             # Layout-Messung über alle Seiten in fünf Fensterbreiten (einige Minuten)
npm --prefix e2e run report    # HTML-Bericht mit Bildschirmfotos
```

Die **Layout-Messung** (`e2e/tests/sweep.spec.ts`) öffnet jede Seite aus `routes.ts` in 1600, 1280, 1024,
820 und 400 px Breite und meldet überlappende oder verdeckte Bedienelemente, Elemente über dem
Fensterrand, abgeschnittene Beschriftungen und seitliches Scrollen. Sie gehört wegen ihrer Dauer nicht
zum normalen Lauf – vor einem Release und nach Änderungen an Layout oder Gestaltung ausführen. Einzelne
Seiten: `npm --prefix e2e run sweep -- -g "Startseite"`; andere Breiten: `E2E_SWEEP_WIDTHS=1280,400`;
anderes Aussehen: `E2E_APPEARANCE=glass` oder `paper` (dunkel: `E2E_SCHEME=dark`).
Fälle, die dabei schon einmal aufgefallen sind, hält `layout.spec.ts` dauerhaft fest.

Eine neue Ansicht gehört in `e2e/tests/support/routes.ts`, ein neuer Arbeitsablauf in die passende
`*.spec.ts` – Einzelheiten in [e2e/README.md](../e2e/README.md).

Das Update-Skript (`update.sh`) prüft `server/test/update-script.test.ts` an einer nachgestellten
Installation: Programmordner mit eigener Kommandozeile, ein `systemctl`, das sich merkt, welcher Stand
läuft, und ein Paket – ohne Root-Rechte, unter Windows mit der Bash von Git. Was nur als root sichtbar
wird (Eigentümer und Rechte, Wechsel zum Dienstkonto, Signale), prüft unter Linux
`sudo bash server/test/linux/update-root-check.sh`; es braucht nur bash, coreutils und python3 und
verändert nichts am System (auch in einer WSL-Umgebung ohne Node.js lauffähig). Nach jeder Änderung an
`update.sh` beide laufen lassen.

Update, Sicherung und Wiederherstellung testet `server/test/upgrade.test.ts`. Für Neustarts auf
demselben Datenverzeichnis: `ctx.close({ keepDir: true })` und danach `createTestApp({ dir: ctx.dir })`;
Umgebungsvariablen (z. B. `KNOWSTEAD_SECRET`) nimmt `createTestApp({ env })` entgegen.

WebSocket-Funktionen (Echtzeit-Bearbeitung) testet `server/test/collab.test.ts` gegen einen echten
Port (`ctx.app.listen({ port: 0 })`) mit einem minimalen Yjs-Client. Zeitgesteuerte Abläufe
(Erinnerungen, Zusammenfassungen) bieten Methoden mit festem Zeitpunkt bzw. `{ force: true }`, etwa
`ctx.s.reviewCycle.runReminders(new Date(...))`.

### Leistung messen

```bash
node scripts/loadtest.mjs --users 500 --pages 8000 --stages 25,50,100 --seconds 20
node scripts/loadtest.mjs --stages 50 --seconds 20 --profile ./profil    # CPU-Profil (.cpuprofile) im Ordner ./profil
```

Das Skript legt Testdaten in einem temporären Verzeichnis an, startet den Server als eigenen Prozess
und gibt Durchsatz sowie p50/p95/p99 je Anfrageart aus. Das CPU-Profil lässt sich in den Chrome
DevTools (Performance) oder in VS Code öffnen. Vor Änderungen an Suche, Rechteprüfung oder
Seitenauslieferung einmal vorher und nachher messen.

## Qualität vor dem Abschluss

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```

Zusätzlich prüfen: Funktioniert die Oberfläche in hell **und** dunkel? Ist sie mit der Tastatur
bedienbar? Hat eine neue Ansicht einen Eintrag in `e2e/tests/support/routes.ts`?
Braucht die Änderung einen Eintrag im [CHANGELOG](../CHANGELOG.md) und im Handbuch
(`docs/handbuch/`)? Das Handbuch wird beim Einrichten als Bereich angelegt – neue Funktionen gehören
dort in das passende Kapitel.

### Installationsassistenten

`scripts/install/windows/Install-Knowstead.ps1` und `Knowstead-Dienst.ps1` müssen als UTF-8 **mit BOM** und CRLF
gespeichert sein (Windows PowerShell 5.1 liest sie sonst als ANSI). Typografische Anführungszeichen „…“
beenden dort Zeichenketten – im Text »…« verwenden. Die gemeinsame Logik (`.env`, Probestart, Prüfung)
gehört in `scripts/install.mjs`, nicht in die Assistenten. Die Installation von Tesseract und LibreOffice
unter Linux (Paketnamen je Distribution, Sprachdaten) steht in `scripts/install/linux/extras.sh`, das
`install.sh` einbindet – geprüft von `server/test/install-extras.test.ts` mit nachgestellter
Paketverwaltung, also ohne Root-Rechte und ohne etwas zu installieren.

**Zwei Sprachen.** Die Assistenten, der Installationskern, `scripts/prepare.mjs` und die Startskripte
sprechen Deutsch und Englisch. Jeder Text steht an Ort und Stelle in beiden Sprachen:
`L "deutsch" "english"` in den Bash-Skripten, `T 'deutsch' 'english'` in PowerShell, `L('deutsch',
'english')` in den Node-Skripten – wer einen Text ändert oder ergänzt, schreibt beide Fassungen. Die Sprache
bestimmt überall dieselbe Regel (`scripts/lang.mjs`): ausdrücklich gewählt (`--lang`, `-Language`), sonst
`KNOWSTEAD_LANG`, sonst die Sprache des Systems – Deutsch, wenn sie mit »de« beginnt, sonst Englisch.
Die Tests legen die Sprache fest (`KNOWSTEAD_LANG=de`) und prüfen Englisch ausdrücklich.
Die Kommandozeile (`server/src/cli.ts`) bleibt dagegen bei Deutsch, solange niemand `--lang en` angibt:
`update.sh` und der Installationskern werten Meldungen der Prüfung aus (»läuft«) – auch das `update.sh`
einer älteren, schon installierten Version. Für englische PowerShell-Texte gilt dasselbe wie für
deutsche: keine typografischen Anführungszeichen.

Zwei Regeln für alles, was die Assistenten tun, **nachdem** sie ein laufendes Knowstead angehalten haben:

- **Zusatzprogramme sind keine Voraussetzung.** Was sich nicht installieren oder eintragen lässt, wird
  ein Hinweis (`warn()` im Installationskern, `note` in `install.sh`, `Add-Note` im Windows-Assistenten)
  und steht am Ende noch einmal – kein `fail`. Der Kern reicht seine Hinweise im Abschlussereignis
  (`warnings`, mit `--json-progress`) bzw. in der Datei von `--report` an den Aufrufer weiter.
- **Ein Fehlschlag hinterlässt kein stehendes Knowstead.** `install.sh` startet den Dienst über eine
  `EXIT`-Falle wieder, der Windows-Assistent über `Restore-Knowstead`.

Beides prüft derselbe Test im echten Ablauf (kein Probelauf): `install.sh` in einem eigenen Programmordner
mit nachgestelltem Kern, `id`, `systemctl` und umgelenktem Dienst-Eintrag (`KNOWSTEAD_UNIT_FILE`); der
Windows-Assistent in einem Prüfstand, der seine Funktionen unverändert aus der Datei holt und nur Dienst,
Aufgabe und Node nachstellt. Die Bash von Git stellt `/usr/bin` vor den Suchpfad – nachgestellte
Programme, die es dort wirklich gibt (`id`), brauchen deshalb `PATH=…` in der Shell selbst.

Paketnamen lassen sich ohne Installation gegen eine echte Paketquelle prüfen:
`apt-get install --simulate --no-install-recommends --no-remove …` (z. B. in WSL) zeigt, welche Pakete
apt wirklich wählt – so fiel auf, dass die Teilpakete `-nogui` allein den Kern mit Oberfläche nachziehen.

```bash
powershell -File scripts/install/windows/Install-Knowstead.ps1 -SelfTest ./assistent        # alle Seiten als PNG
powershell -File scripts/install/windows/Install-Knowstead.ps1 -SelfTest ./assistent-en -Language en
powershell -File scripts/install/windows/Install-Knowstead.ps1 -Unattended -WhatIf -NoElevate -SkipPrepare
bash install.sh --unattended --dry-run --skip-prepare
bash install.sh --lang en --unattended --dry-run --skip-prepare
```
