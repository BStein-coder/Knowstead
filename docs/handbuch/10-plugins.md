---
title: Plugins
icon: 🧩
---

# Plugins

Plugins erweitern Knowstead, ohne den Kern anzupassen. Administratoren aktivieren sie unter **Administration → Plugins** – ohne Neustart.

<!-- toc -->

## Mitgelieferte Plugins

| Plugin | Funktion |
| --- | --- |
| **Automatische Verlinkung** | Wandelt Muster wie Ticketnummern (`ABC-123`) beim Anzeigen automatisch in Links um |
| **Chat-Benachrichtigungen** | Sendet Seiten- und Kommentarereignisse an Teams, Slack, Mattermost oder Discord |
| **Beispiel-Erweiterung** | Lesezeit im Seitenkopf, Aktion „Wörter zählen“, Makro „Countdown“ und eine eigene API-Route – als Vorlage für eigene Plugins |

## Was Plugins können

**Auf dem Server**

- auf Ereignisse reagieren (`page.updated`, `comment.created`, …),
- Inhalte beim Speichern prüfen oder verändern (`page.beforeSave`),
- die Anzeige anreichern (`page.render`) oder Exporte anpassen (`page.export`),
- eigene REST-Routen unter `/api/v1/plugins/<id>/…` bereitstellen,
- Einstellungen definieren, die in der Administration als Formular erscheinen,
- eigene Daten im Plugin-Speicher ablegen.

**Im Browser**

- neue **Makros** für den Editor (erscheinen im Slash-Menü),
- **Seitenaktionen** im Menü „…“,
- Angaben im **Seitenkopf** (z. B. Lesezeit),
- eigene **Panels** unter dem Seiteninhalt.

> [!NOTE]
> Plugins laufen mit vollen Rechten im Serverprozess. Installiere nur Plugins aus vertrauenswürdigen Quellen. Eine Entwickleranleitung mit Beispielen findest du in `docs/PLUGINS.md` im Projektverzeichnis.
