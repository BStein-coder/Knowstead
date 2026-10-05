---
title: API and integrations
icon: 🔌
---

# API and integrations

Knowstead is "API first": the web interface uses the same REST API that is also available to scripts and other systems.

<!-- toc -->

## REST API

- **Documentation**: the complete, interactive API reference (OpenAPI/Swagger) is available at [/api/docs](/api/docs).
- **Base URL**: `https://<your-server>/api/v1`
- **Authentication**: personal API token in the header `Authorization: Bearer knowstead_…` – created under **Profile → API tokens**.
- **Language**: error messages follow the header `X-Knowstead-Locale: en` (or `Accept-Language` for token requests).

```bash
# List all spaces
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" https://knowstead.example.com/api/v1/spaces

# Search pages
curl -H "Authorization: Bearer $KNOWSTEAD_TOKEN" "https://knowstead.example.com/api/v1/search?q=label:runbook"

# Create a page from Markdown
curl -X POST https://knowstead.example.com/api/v1/pages \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"spaceKey":"DEV","title":"Deployment 2.4","format":"markdown","content":"# Steps\n1. Build\n2. Deploy","labels":["deployment"]}'

# Publish a new version (with conflict detection)
curl -X PUT https://knowstead.example.com/api/v1/pages/42 \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"<p>New content</p>","baseVersion":7,"changeNote":"Updated automatically"}'
```

> [!IMPORTANT]
> Tokens are shown only once. Keep them like passwords and preferably use a service account with minimal permissions for integrations.

## Webhooks

Webhooks inform other systems in real time about events such as `page.created`, `page.updated`, `comment.created` or `space.permissions_changed`. Administrators set them up under **Administration → Webhooks** – with event filter, optional space filter, custom headers, test delivery and delivery log. Failed deliveries are retried automatically up to three times.

Every delivery is signed:

| Header | Content |
| --- | --- |
| `X-Knowstead-Event` | event type, e.g. `page.updated` |
| `X-Knowstead-Delivery` | unique delivery ID |
| `X-Knowstead-Timestamp` | Unix timestamp (seconds) |
| `X-Knowstead-Signature` | `sha256=` + HMAC-SHA256 over `timestamp + "." + body` |

Verification example (Node.js):

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

## API connectors and live data

With **API connectors** (Administration → API connectors) you connect external REST interfaces – such as Jira, GitLab, monitoring or an ERP. Credentials (bearer token, basic auth, API key) are stored **encrypted on the server** and never reach the browser.

In the editor you then insert the **API data** macro, choose connector and path and define the display:

| Display | Example |
| --- | --- |
| Table | open tickets with columns `key:Ticket, fields.summary:Title, fields.status.name:Status` |
| List | template `{{name}} – {{status}}` per entry |
| Single value | number of open incidents |
| JSON | raw data for troubleshooting |

Results are cached per connector (cache duration adjustable) and can be refreshed at the push of a button. Administrators can restrict allowed paths.

Whoever may only read the page gets exactly the data configured in the macro – own queries with the connector's credentials are not possible. Everyone who may edit the page can try paths and set up macros.

## Further integration options

- **Plugins** can provide their own API routes, macros and automations (see chapter "Plugins").
- The included **Chat notifications** plugin sends changes to Microsoft Teams, Slack, Mattermost or Discord.
- **Export/import** via ZIP archives enables migrations between installations.
