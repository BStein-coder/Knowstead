---
title: API und Integrationen
icon: 🔌
---

# API und Integrationen

Knowstead ist „API-first“: Die Weboberfläche nutzt dieselbe REST-API, die auch für Skripte und andere Systeme zur Verfügung steht.

<!-- toc -->

## REST-API

- **Dokumentation**: Die vollständige, interaktive API-Referenz (OpenAPI/Swagger) findest du unter [/api/docs](/api/docs).
- **Basis-URL**: `https://<dein-server>/api/v1`
- **Authentifizierung**: persönliches API-Token im Header `Authorization: Bearer knowstead_…` – erstellt unter **Profil → API-Tokens**.

```bash
# Alle Bereiche auflisten
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/spaces

# Seite suchen
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/search?q=label:runbook"

# Seite aus Markdown anlegen
curl -X POST https://knowstead.example.com/api/v1/pages \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"spaceKey":"DEV","title":"Deployment 2.4","format":"markdown","content":"# Ablauf\n1. Build\n2. Deploy","labels":["deployment"]}'

# Neue Version veröffentlichen (mit Konflikterkennung)
curl -X PUT https://knowstead.example.com/api/v1/pages/42 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"<p>Neuer Inhalt</p>","baseVersion":7,"changeNote":"Automatisch aktualisiert"}'
```

> [!IMPORTANT]
> Tokens werden nur einmal angezeigt. Bewahre sie wie Passwörter auf und verwende für Integrationen am besten ein Dienstkonto mit minimalen Rechten.

## Webhooks

Webhooks informieren andere Systeme in Echtzeit über Ereignisse wie `page.created`, `page.updated`, `comment.created` oder `space.permissions_changed`. Administratoren richten sie unter **Administration → Webhooks** ein – mit Ereignisfilter, optionalem Bereichsfilter, eigenen Headern, Testzustellung und Zustellprotokoll. Fehlgeschlagene Zustellungen werden automatisch bis zu dreimal wiederholt.

Jede Zustellung ist signiert:

| Header | Inhalt |
| --- | --- |
| `X-Knowstead-Event` | Ereignistyp, z. B. `page.updated` |
| `X-Knowstead-Delivery` | eindeutige Zustell-ID |
| `X-Knowstead-Timestamp` | Unix-Zeitstempel (Sekunden) |
| `X-Knowstead-Signature` | `sha256=` + HMAC-SHA256 über `Zeitstempel + "." + Body` |

Beispiel zur Prüfung (Node.js):

```javascript
import crypto from 'node:crypto';

function verify(req, rawBody, secret) {
  const ts = req.headers['x-knowstead-timestamp'];
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-knowstead-signature']));
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  return ok && fresh;
}
```

## API-Konnektoren und Live-Daten

Mit **API-Konnektoren** (Administration → API-Konnektoren) bindest du externe REST-Schnittstellen an – etwa Jira, GitLab, ein Monitoring oder ein ERP. Zugangsdaten (Bearer-Token, Basic Auth, API-Key) werden **verschlüsselt auf dem Server** gespeichert und gelangen nie in den Browser.

Im Editor fügst du dann das Makro **API-Daten** ein, wählst Konnektor und Pfad und bestimmst die Darstellung:

| Darstellung | Beispiel |
| --- | --- |
| Tabelle | offene Tickets mit Spalten `key:Ticket, fields.summary:Titel, fields.status.name:Status` |
| Liste | Vorlage `{{name}} – {{status}}` je Eintrag |
| Einzelwert | Anzahl offener Störungen |
| JSON | Rohdaten zur Fehlersuche |

Ergebnisse werden je Konnektor zwischengespeichert (Cache-Dauer einstellbar) und lassen sich per Knopfdruck aktualisieren. Administratoren können erlaubte Pfade einschränken.

Wer die Seite nur lesen darf, bekommt genau die Daten, die im Makro hinterlegt sind – eigene Abfragen mit den Zugangsdaten des Konnektors sind nicht möglich. Pfade ausprobieren und Makros einrichten können alle, die die Seite bearbeiten dürfen.

## Weitere Integrationswege

- **Plugins** können eigene API-Routen, Makros und Automatisierungen bereitstellen (siehe Kapitel „Plugins“).
- Das mitgelieferte Plugin **Chat-Benachrichtigungen** sendet Änderungen an Microsoft Teams, Slack, Mattermost oder Discord.
- **Export/Import** über ZIP-Archive ermöglicht Migrationen zwischen Installationen.
