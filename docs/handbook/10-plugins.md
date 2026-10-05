---
title: Plugins
icon: 🧩
---

# Plugins

Plugins extend Knowstead without modifying the core. Administrators enable them under **Administration → Plugins** – without a restart.

<!-- toc -->

## Included plugins

| Plugin | Function |
| --- | --- |
| **Auto-linking** | Turns patterns such as ticket numbers (`ABC-123`) into links automatically when displaying |
| **Chat notifications** | Sends page and comment events to Teams, Slack, Mattermost or Discord |
| **Example extension** | Reading time in the page header, action "Count words", macro "Countdown" and its own API route – as a template for your own plugins |

## What plugins can do

**On the server**

- react to events (`page.updated`, `comment.created`, …),
- check or modify content when saving (`page.beforeSave`),
- enrich the display (`page.render`) or adapt exports (`page.export`),
- provide their own REST routes under `/api/v1/plugins/<id>/…`,
- define settings that appear as a form in the administration,
- store their own data in the plugin storage.

**In the browser**

- new **macros** for the editor (appear in the slash menu),
- **page actions** in the "…" menu,
- information in the **page header** (e.g. reading time),
- their own **panels** below the page content.

> [!NOTE]
> Plugins run with full permissions in the server process. Only install plugins from trustworthy sources. A developer guide with examples is available in `docs/PLUGINS.md` in the project directory.
