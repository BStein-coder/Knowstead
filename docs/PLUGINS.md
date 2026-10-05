# Plugins entwickeln

Plugins erweitern Knowstead, ohne den Kern zu verändern: auf dem Server über Hooks, Ereignisse und eigene
Routen, im Browser über Makros, Seitenaktionen, Angaben im Seitenkopf und Panels. Administratoren
aktivieren sie unter **Administration → Plugins** – ohne Neustart.

## Inhalt

- [Aufbau eines Plugins](#aufbau-eines-plugins)
- [Serverteil](#serverteil)
- [Browserteil](#browserteil)
- [Einstellungen](#einstellungen)
- [Mitgelieferte Beispiele](#mitgelieferte-beispiele)
- [Verteilen und Betreiben](#verteilen-und-betreiben)
- [Sicherheit](#sicherheit)

---

## Aufbau eines Plugins

Ein Plugin ist ein Ordner unter `plugins/`:

```
plugins/mein-plugin/
├─ plugin.json      Pflicht: Kennung, Name, Version, Einstellungen
├─ server.ts        optional: läuft im Serverprozess
├─ client.js        optional: läuft im Browser (reines JavaScript!)
└─ assets/          optional: Bilder, CSS … (erreichbar unter /plugin-assets/<id>/…)
```

`plugin.json`:

```json
{
  "id": "mein-plugin",
  "name": "Mein Plugin",
  "version": "1.0.0",
  "description": "Kurz erklärt, was es tut.",
  "author": "Team Wissen",
  "homepage": "https://intern.example.com/knowstead-plugins",
  "server": "server.ts",
  "client": "client.js",
  "settings": [
    { "key": "ziel", "label": "Ziel-URL", "type": "text", "required": true },
    { "key": "aktiv", "label": "Aktiv", "type": "boolean", "default": true, "public": true }
  ]
}
```

**Mehrsprachig:** Unter `translations` stehen Name, Beschreibung und Beschriftungen der Einstellungen
für weitere Sprachen. Die Administration zeigt sie in der Sprache der Person; fehlende Angaben fallen
auf die Texte oben zurück. Bei `select`-Feldern werden die Beschriftungen der Optionen über ihren
`value` übersetzt.

```json
"translations": {
  "en": {
    "name": "My plugin",
    "description": "What it does, briefly.",
    "settings": { "ziel": { "label": "Target URL", "help": "…" } }
  }
}
```

Die `id` besteht aus Kleinbuchstaben, Ziffern und Bindestrichen. Der Serverteil darf TypeScript sein
(Node 24 führt ihn direkt aus), der Browserteil muss **reines JavaScript** sein – er wird unverändert
ausgeliefert.

---

## Serverteil

Das Server-Modul exportiert eine `register`-Funktion (als `default` oder benannt):

```ts
import type { PluginRegister } from '../../server/src/plugins/types.ts';

const register: PluginRegister = (ctx) => {
  ctx.log.info('Plugin gestartet');

  // 1. Ereignisse abonnieren
  ctx.events.on('page.updated', (event) => {
    ctx.log.info(`Seite ${event.pageId} geändert von ${event.actor?.displayName}`);
  });

  // 2. Inhalte filtern
  ctx.hooks.addFilter<string>('page.render', (html) => html.replaceAll('(c)', '©'));

  // 3. Eigene Route: /api/v1/plugins/mein-plugin/status
  ctx.routes.get('/status', () => ({ ok: true, zeit: new Date().toISOString() }));

  // 4. Aufräumen beim Deaktivieren
  return {
    dispose: () => ctx.log.info('Plugin beendet'),
  };
};

export default register;
```

### Der Kontext (`ctx`)

| Bereich | Inhalt |
| --- | --- |
| `ctx.id`, `ctx.manifest` | Kennung und Manifest |
| `ctx.log` | `info` / `warn` / `error` – landet im Serverprotokoll |
| `ctx.config` | `baseUrl`, `version`, `dataDir` |
| `ctx.settings` | `get(key)`, `all()` – Werte aus dem Einstellungsformular |
| `ctx.storage` | `get`, `set`, `delete`, `list(prefix)` – eigene Datenablage (JSON) |
| `ctx.hooks` | `addFilter(name, fn, priority?)` |
| `ctx.events` | `on(pattern, handler)` – `page.*`, `comment.created`, `*` |
| `ctx.routes` | `get`, `post`, `put`, `delete` mit `{ auth?, admin? }` |
| `ctx.respond` | eigene Antwort mit Status und Kopfzeilen |
| `ctx.services` | voller Zugriff auf alle internen Dienste – z. B. `ctx.services.settings.get('defaultLocale')` für die Standardsprache der Installation |

### Hooks

| Name | Wert | Kontext | Zweck |
| --- | --- | --- | --- |
| `page.beforeSave` | `{ title, content, contentType }` | `{ page, space, auth }` | prüfen, ergänzen, ablehnen (`throw`) |
| `page.render` | Anzeige-HTML | `{ page, space, auth }` | Anzeige anreichern |
| `page.export` | Export-HTML | `{ page, space, auth }` | Exporte anpassen |
| `search.results` | Trefferliste | `{ query, auth }` | Treffer umsortieren oder ergänzen |

Filter laufen nach Priorität (kleine Zahl zuerst, Standard 10). Wirft ein Filter einen `HttpError`,
bricht die Aktion mit dieser Meldung ab:

```ts
import { badRequest } from '../../server/src/core/errors.ts';

ctx.hooks.addFilter('page.beforeSave', (value: { title: string; content: string }) => {
  if (/geheim/i.test(value.content)) throw badRequest('Bitte keine Geheimnisse in Seiten schreiben.');
  return value;
});
```

### Routen

Routen liegen unter `/api/v1/plugins/<id>/…` und sind standardmäßig nur für angemeldete Benutzer
erreichbar:

```ts
ctx.routes.get('/berichte/:jahr', (req) => {
  const jahr = Number(req.params.jahr);
  return { jahr, seiten: ctx.services.db.value('SELECT COUNT(*) FROM pages') };
});

ctx.routes.post('/aufraeumen', () => ctx.respond({ ok: true }, 202), { admin: true });
ctx.routes.get('/oeffentlich', () => ({ hinweis: 'ohne Anmeldung' }), { auth: false });
```

`req` enthält `method`, `path`, `params`, `query`, `body`, `headers`, `user`, `isAdmin`.

> [!IMPORTANT]
> Rechte werden **nicht** automatisch geprüft. Wer Inhalte ausliefert, prüft sie selbst – am
> einfachsten über die Dienste:
> ```ts
> const row = req.user ? ctx.services.users.get(req.user.id) : undefined;
> const auth = row ? ctx.services.perms.forUser(row) : ctx.services.perms.anonymous();
> const { page } = ctx.services.pages.requireViewable(auth, Number(req.params.id));
> ```

---

## Browserteil

`client.js` exportiert `activate(api)`:

```js
export function activate(api) {
  api.registerPageMeta({
    id: 'lesezeit',
    render: (ctx) => `⏱ ${Math.ceil(ctx.text.split(/\s+/).length / 220)} Min.`,
  });

  api.registerPageAction({
    id: 'melden',
    label: 'Seite melden',
    onClick: async (ctx) => {
      await api.fetch('melden', { method: 'POST', body: { pageId: ctx.page.id } });
      api.toast('Danke für den Hinweis!', 'success');
    },
  });

  api.registerMacro({
    name: 'wetter',
    label: 'Wetter',
    description: 'Zeigt das aktuelle Wetter',
    params: [{ key: 'ort', label: 'Ort', type: 'text', default: 'Berlin' }],
    render: (el, params) => {
      el.textContent = `Wetter in ${params.ort} …`;
      const timer = setInterval(() => el.classList.toggle('blink'), 1000);
      return () => clearInterval(timer); // Aufräumfunktion
    },
  });

  api.registerPagePanel({
    id: 'hinweise',
    title: 'Hinweise',
    render: (el, ctx) => {
      el.textContent = `Seite ${ctx.page.id} in ${ctx.page.spaceKey}`;
    },
  });
}
```

### Browser-API

| Funktion | Wirkung |
| --- | --- |
| `api.registerMacro(def)` | neues Makro; erscheint im Slash-Menü unter „Plugins“ |
| `api.registerPageAction(def)` | Eintrag im Seitenmenü „…“ |
| `api.registerPageMeta(def)` | Angabe im Seitenkopf (Text oder `null`) |
| `api.registerPagePanel(def)` | Panel unter dem Seiteninhalt |
| `api.fetch(pfad, init?)` | ruft eigene Server-Routen auf |
| `api.http` | allgemeine REST-API mit den Rechten des Benutzers |
| `api.toast(text, kind?)` | Hinweis einblenden (`success`, `error`, `info`) |
| `api.navigate(pfad)` | interne Navigation |
| `api.settings` | Einstellungen mit `"public": true` |
| `api.id` | eigene Plugin-Kennung |
| `api.locale` | aktuelle Sprache der Oberfläche (`de` oder `en`) – für eigene Beschriftungen bei jeder Ausgabe neu lesen |

Der Seitenkontext (`ctx`) enthält `page` (`id`, `title`, `spaceKey`, `contentType`, `version`,
`labels`, `url`) und `text` (Klartext der Seite).

Makro-Parameter erscheinen automatisch als Formular (Zahnrad am Makro): `text`, `number`, `date`,
`textarea`, `select` (mit `options`), `boolean`.

---

## Einstellungen

Jeder Eintrag unter `settings` wird in der Administration zu einem Formularfeld:

| `type` | Feld |
| --- | --- |
| `text`, `textarea`, `number`, `boolean` | einfache Eingaben |
| `password` | wird **verschlüsselt** gespeichert und nie zurückgegeben |
| `select` | Auswahlliste (`options: [{ value, label }]`) |
| `json` | freies JSON (validiert beim Speichern) |

`"required": true` erzwingt eine Eingabe, `"public": true` liefert den Wert auch an das Browser-Modul
(niemals für Geheimnisse verwenden), `"help"` erklärt das Feld.

Werte liest der Server mit `ctx.settings.get('key')`. Nach dem Speichern wird ein aktives Plugin
automatisch neu geladen.

---

## Mitgelieferte Beispiele

| Plugin | Zeigt |
| --- | --- |
| [`plugins/auto-links`](../plugins/auto-links) | `page.render`- und `page.export`-Filter, JSON-Einstellungen, Textersetzung ohne Tag-Schäden |
| [`plugins/chat-notify`](../plugins/chat-notify) | Ereignis-Abonnement, verschlüsselte Zugangsdaten, Nachrichtenformate für Teams/Slack/Mattermost/Discord, Admin-Route zum Testen |
| [`plugins/example-extension`](../plugins/example-extension) | kompletter Bausatz: Route mit Rechteprüfung, Plugin-Speicher, `page.beforeSave`, Lesezeit im Seitenkopf, Aktion, Makro mit Parametern, Panel |

Zum Ausprobieren: Ordner kopieren, `id` und `name` in der `plugin.json` ändern, unter
Administration → Plugins **Neu einlesen** und aktivieren.

---

## Verteilen und Betreiben

- Plugins liegen im Ordner aus `PLUGINS_DIR` (Standard `plugins/`). Ein Plugin ist ein Unterordner –
  mehr braucht es nicht: kein Build, keine Registrierung, kein Neustart.
- **Neu einlesen** erkennt neue Ordner, **Aktivieren/Deaktivieren** lädt sie zur Laufzeit.
- Fehler beim Laden erscheinen direkt in der Liste (rote Meldung) und im Serverprotokoll.
- Für eigene Abhängigkeiten: relative Importe innerhalb des Plugin-Ordners oder Pakete, die bereits
  im Projekt vorhanden sind. Zusätzliche npm-Pakete gehören in die `package.json` des Servers.
- Beim Deaktivieren werden Hooks, Ereignis-Abonnements und Routen automatisch entfernt; eine
  `dispose`-Funktion räumt eigene Timer oder Verbindungen auf.

---

## Sicherheit

> [!WARNING]
> Server-Plugins laufen mit **vollen Rechten** im Serverprozess: Datenbank, Dateisystem, Netzwerk.
> Installiere nur Plugins, deren Quelle du kennst, und lies den Code vor dem Aktivieren.

Empfehlungen für eigene Plugins:

- **Rechte prüfen** (`perms.requireGlobal`, `pages.requireViewable`, `perms.requireSpace`), bevor
  Daten ausgeliefert werden.
- **Eingaben prüfen**: `req.body` und `req.query` sind ungeprüft.
- **Kein `innerHTML`** mit fremden Daten im Browserteil – `textContent` verwenden oder Elemente
  erzeugen (siehe `example-extension`).
- **Geheimnisse** als `password`-Einstellung ablegen, nicht im Code.
- **Ausgehende Aufrufe** mit Zeitlimit (`AbortSignal.timeout`) und ohne Weiterleitungen
  (`redirect: 'manual'`).
- Beim Filtern von HTML nur in Textknoten eingreifen (Beispiel: `auto-links`), damit keine
  ungültigen oder gefährlichen Strukturen entstehen.
