---
title: Versionen und Änderungsprotokolle
icon: 🕓
---

# Versionen und Änderungsprotokolle

Nachvollziehbarkeit ist ein Kernprinzip von Knowstead: Jede veröffentlichte Änderung erzeugt eine neue **Version** – nichts geht verloren.

<!-- toc -->

## Versionen einer Seite

Über **… → Versionen** (oder <kbd>H</kbd>) öffnest du die Versionsgeschichte:

- Jede Version zeigt **Autor**, **Zeitpunkt**, **Art der Änderung** (erstellt, bearbeitet, umbenannt, wiederhergestellt …) und die **Änderungsnotiz**.
- **Ansehen** zeigt die Seite genau so, wie sie in dieser Version aussah.
- **Vergleichen** zeigt Unterschiede zwischen zwei Versionen – **visuell** (eingefügter Text grün, entfernter Text rot durchgestrichen) oder als **Quelltext** (Zeilen-Diff).
- **Wiederherstellen** übernimmt den Inhalt einer alten Version als neue Version. Die Geschichte bleibt dabei vollständig erhalten.

> [!TIP]
> Gute Änderungsnotizen sind kurz und konkret: „Kapitel 3 um Rollback-Anleitung ergänzt“ statt „Update“. Sie erscheinen in Benachrichtigungen, Webhooks und im Änderungsprotokoll.

**Kleine Änderungen** (Häkchen „Beobachter benachrichtigen“ entfernen) werden versioniert, lösen aber keine Benachrichtigungen aus und sind im Änderungsprotokoll standardmäßig ausgeblendet.

## Änderungsprotokoll eines Bereichs

In jedem Bereich findest du links **Änderungsprotokoll**. Es listet alle Änderungen chronologisch und nach Tagen gruppiert:

- neue und bearbeitete Seiten mit Version und Änderungsnotiz,
- verschobene, gelöschte und wiederhergestellte Seiten,
- hochgeladene und gelöschte Anhänge.

Filtere nach Zeitraum und exportiere das Protokoll als **Markdown** – z. B. für Release Notes, Audits oder die Übergabe an Kunden.

## Änderungshistorie auf der Seite

Das Makro **Änderungshistorie** (`/änderungshistorie`) zeigt die Versionen einer Seite als Tabelle direkt im Dokument – so wie man es von Richtlinien und Verfahrensanweisungen kennt:

<div data-type="changelog" data-limit="10"></div>

## Versionshinweise und Changelogs pflegen

Für Software-Releases bringt Knowstead die Vorlage **Versionshinweise (Changelog)** im Stil von *Keep a Changelog* mit. Über die REST-API können Build-Pipelines Einträge automatisch ergänzen:

```bash
curl -X POST "$KNOWSTEAD/api/v1/pages/42/append" \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"format":"markdown","position":"start","content":"## 2.4.0\n- Neue Exportfunktion","changeNote":"Release 2.4.0"}'
```

## Aktivität und Audit-Log

- **Aktivität** (Seitenleiste auf der Startseite) zeigt, was zuletzt in allen Bereichen passiert ist, auf die du Zugriff hast.
- Das **Audit-Log** (Administration) protokolliert zusätzlich sicherheitsrelevante Vorgänge: Anmeldungen, fehlgeschlagene Anmeldeversuche, Rechteänderungen, Tokens, Einstellungen und Integrationen – filterbar und als CSV exportierbar.
